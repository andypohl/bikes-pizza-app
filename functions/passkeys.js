// Passkeys (WebAuthn) as a way to sign in. A member adds a passkey on a
// device from the account page or the app; from then on that device can
// sign them in with its screen lock or biometrics. The sign-in ends in a
// Firebase custom token carrying `passkey: true`, which the clients trade
// for a session. Custom-token sign-ins skip Firebase's multi-factor step,
// so a passkey stands in for the authenticator code on accounts that have
// two-factor authentication on; the admin pages accept the claim in place
// of `firebase.sign_in_second_factor` (see errors.js).
//
// Pure: the WebAuthn library, the credential store and the token minting
// are injected, so the flows are unit-tested without Firebase.
//
// Storage (server-only, see firestorePasskeyStore):
//   passkeys/{credentialId}      one per passkey, with the owning uid
//   passkeyChallenges/{id}       a challenge waiting for its response

import { AppError, ValidationError } from "./errors.js";

/** How long a challenge stays valid. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** Passkeys per account. */
export const MAX_PASSKEYS = 10;
/** Longest name kept for a passkey (the device, as the client describes it). */
export const NAME_MAX = 60;

/**
 * @typedef {object} PasskeyRecord
 * @property {string} id  The credential ID (base64url); the document ID
 * @property {string} uid  The member it signs in
 * @property {string} publicKey  COSE public key, base64url
 * @property {number} counter  Signature counter, to spot cloned authenticators
 * @property {string[]} transports
 * @property {string} name  What the member sees, e.g. "Safari on Mac"
 * @property {boolean} backedUp  Whether the authenticator syncs it (iCloud, Google)
 * @property {Date} createdAt
 * @property {Date|null} lastUsedAt
 */

/**
 * @typedef {object} PasskeyStore
 * @property {(uid: string) => Promise<PasskeyRecord[]>} listForUser
 * @property {(id: string) => Promise<PasskeyRecord|null>} get
 * @property {(record: PasskeyRecord) => Promise<void>} put
 * @property {(id: string, patch: object) => Promise<void>} update
 * @property {(id: string) => Promise<void>} delete
 * @property {(id: string, data: {challenge: string, uid: string|null, expiresAt: Date}) => Promise<void>} putChallenge
 * @property {(id: string) => Promise<{challenge: string, uid: string|null, expiresAt: Date}|null>} takeChallenge  Reads and deletes
 */

/**
 * @typedef {object} PasskeyDeps
 * @property {PasskeyStore} store
 * @property {{rpID: string, rpName: string}} rp
 * @property {object} webauthn  `@simplewebauthn/server` (or a fake)
 * @property {string[]} [extraOrigins]  Origins allowed besides the rp's own
 *   hosts, e.g. `android:apk-key-hash:...` for the Android app
 * @property {(uid: string, claims: object) => Promise<string>} [createToken]
 * @property {() => Date} [now]
 * @property {() => string} [randomId]
 */

/** The relying party for a site URL: `https://bikes.pizza` → `bikes.pizza`. */
export function rpFromSiteUrl(siteUrl) {
  const host = new URL(siteUrl).hostname;
  return { rpID: host, rpName: host };
}

/**
 * Whether a WebAuthn origin may register or use passkeys for this rp: the
 * rp's own host or a subdomain of it over https, or one of the extra
 * origins (the native apps).
 */
export function originAllowed(origin, rpID, extraOrigins = []) {
  if (typeof origin !== "string") return false;
  if (extraOrigins.includes(origin)) return true;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return url.hostname === rpID || url.hostname.endsWith(`.${rpID}`);
}

/** The origin the browser recorded in the response's clientDataJSON. */
export function clientOrigin(response) {
  try {
    const json = Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8");
    return JSON.parse(json).origin;
  } catch {
    return null;
  }
}

const b64 = (bytes) => Buffer.from(bytes).toString("base64url");
const unb64 = (text) => new Uint8Array(Buffer.from(text, "base64url"));

function cleanName(value) {
  const name = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return (name || "Passkey").slice(0, NAME_MAX);
}

/** What the clients see of a passkey. */
export function summary(record) {
  return {
    id: record.id,
    name: record.name,
    backedUp: Boolean(record.backedUp),
    createdAt: record.createdAt?.toISOString?.() ?? null,
    lastUsedAt: record.lastUsedAt?.toISOString?.() ?? null,
  };
}

function requireResponse(data) {
  if (!data || typeof data !== "object") throw new ValidationError("Nothing to verify.");
  const { challengeId, response } = data;
  if (typeof challengeId !== "string" || !challengeId) throw new ValidationError("Missing challenge.");
  if (!response || typeof response !== "object" || typeof response.id !== "string" || !response.response) {
    throw new ValidationError("Missing passkey response.");
  }
  return { challengeId, response };
}

async function takeValidChallenge(store, id, now) {
  const challenge = await store.takeChallenge(id);
  if (!challenge || challenge.expiresAt.getTime() < now.getTime()) {
    throw new AppError("failed-precondition", "That took too long. Start again.");
  }
  return challenge;
}

function checkOrigin(response, deps) {
  const origin = clientOrigin(response);
  if (!originAllowed(origin, deps.rp.rpID, deps.extraOrigins)) {
    throw new AppError("permission-denied", "That passkey was made for a different site.");
  }
  return origin;
}

const defaultRandomId = () => b64(crypto.getRandomValues(new Uint8Array(24)));

/** The member's passkeys, newest first. */
export async function listPasskeys(uid, { store }) {
  const records = await store.listForUser(uid);
  return records.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)).map(summary);
}

/**
 * Step one of adding a passkey: options for `navigator.credentials.create`,
 * with a challenge kept for step two. Platform authenticators only (the
 * device's own screen lock or biometrics), discoverable so signing in
 * needs no email first.
 *
 * @param {{uid: string, email: string}} user
 * @param {{username?: string}} member
 * @param {PasskeyDeps} deps
 */
export async function registrationOptions(user, member, deps) {
  const { store, rp, webauthn, now = () => new Date(), randomId = defaultRandomId } = deps;
  const existing = await store.listForUser(user.uid);
  if (existing.length >= MAX_PASSKEYS) {
    throw new AppError("failed-precondition", `An account can have up to ${MAX_PASSKEYS} passkeys. Remove one first.`);
  }
  const options = await webauthn.generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: user.email,
    userDisplayName: member?.username || user.email,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "required",
      userVerification: "required",
    },
  });
  const challengeId = randomId();
  await store.putChallenge(challengeId, {
    challenge: options.challenge,
    uid: user.uid,
    expiresAt: new Date(now().getTime() + CHALLENGE_TTL_MS),
  });
  return { challengeId, options };
}

/**
 * Step two: verifies the authenticator's response and keeps the credential.
 * Returns the member's passkeys.
 *
 * @param {{uid: string}} user
 * @param {{challengeId: string, response: object, name?: string}} data
 * @param {PasskeyDeps} deps
 */
export async function register(user, data, deps) {
  const { store, rp, webauthn, now = () => new Date() } = deps;
  const { challengeId, response } = requireResponse(data);
  const challenge = await takeValidChallenge(store, challengeId, now());
  if (challenge.uid !== user.uid) throw new AppError("permission-denied", "That challenge is not yours.");
  const origin = checkOrigin(response, deps);
  let verification;
  try {
    verification = await webauthn.verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
  } catch (error) {
    throw new ValidationError(`That passkey could not be verified: ${error.message}`);
  }
  if (!verification.verified) throw new ValidationError("That passkey could not be verified.");
  const { credential, credentialBackedUp } = verification.registrationInfo;
  await store.put({
    id: credential.id,
    uid: user.uid,
    publicKey: b64(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    name: cleanName(data.name),
    backedUp: Boolean(credentialBackedUp),
    createdAt: now(),
    lastUsedAt: null,
  });
  return listPasskeys(user.uid, deps);
}

/**
 * Step one of signing in: options for `navigator.credentials.get`. No
 * account is named; the authenticator offers the passkeys it holds for
 * this site (discoverable credentials).
 */
export async function signInOptions(deps) {
  const { store, rp, webauthn, now = () => new Date(), randomId = defaultRandomId } = deps;
  const options = await webauthn.generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: "required",
  });
  const challengeId = randomId();
  await store.putChallenge(challengeId, {
    challenge: options.challenge,
    uid: null,
    expiresAt: new Date(now().getTime() + CHALLENGE_TTL_MS),
  });
  return { challengeId, options };
}

/**
 * Step two: verifies the assertion against the stored credential and
 * returns a Firebase custom token for its owner, with `passkey: true`.
 *
 * @param {{challengeId: string, response: object}} data
 * @param {PasskeyDeps} deps
 */
export async function signIn(data, deps) {
  const { store, rp, webauthn, createToken, now = () => new Date(), log = () => {} } = deps;
  const { challengeId, response } = requireResponse(data);
  const challenge = await takeValidChallenge(store, challengeId, now());
  if (challenge.uid !== null) throw new AppError("permission-denied", "That challenge is not for signing in.");
  const origin = checkOrigin(response, deps);
  const record = await store.get(response.id);
  if (!record) throw new AppError("not-found", "That passkey is no longer registered. Sign in another way and add it again.");
  let verification;
  try {
    verification = await webauthn.verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
      credential: {
        id: record.id,
        publicKey: unb64(record.publicKey),
        counter: record.counter,
        transports: record.transports,
      },
    });
  } catch (error) {
    throw new AppError("permission-denied", `That passkey could not be verified: ${error.message}`);
  }
  if (!verification.verified) throw new AppError("permission-denied", "That passkey could not be verified.");
  await store.update(record.id, { counter: verification.authenticationInfo.newCounter, lastUsedAt: now() });
  log("passkey sign-in", { uid: record.uid, passkey: record.id });
  const token = await createToken(record.uid, { passkey: true });
  return { token };
}

/** Removes one of the member's passkeys; returns the rest. */
export async function removePasskey(uid, data, deps) {
  const id = data?.id;
  if (typeof id !== "string" || !id) throw new ValidationError("Which passkey?");
  const record = await deps.store.get(id);
  if (!record || record.uid !== uid) throw new AppError("not-found", "No such passkey.");
  await deps.store.delete(id);
  return listPasskeys(uid, deps);
}

/** Removes every passkey of a member (when the account is deleted). */
export async function removeAllPasskeys(uid, { store }) {
  const records = await store.listForUser(uid);
  await Promise.all(records.map((r) => store.delete(r.id)));
  return records.length;
}

const toDate = (value) => (value && typeof value.toDate === "function" ? value.toDate() : (value ?? null));

/** Firestore-backed {@link PasskeyStore}. */
export function firestorePasskeyStore(db) {
  const passkeys = db.collection("passkeys");
  const challenges = db.collection("passkeyChallenges");
  const fromDoc = (doc) => {
    const data = doc.data();
    return { ...data, id: doc.id, createdAt: toDate(data.createdAt), lastUsedAt: toDate(data.lastUsedAt) };
  };
  return {
    async listForUser(uid) {
      const snap = await passkeys.where("uid", "==", uid).get();
      return snap.docs.map(fromDoc);
    },
    async get(id) {
      const snap = await passkeys.doc(id).get();
      return snap.exists ? fromDoc(snap) : null;
    },
    async put(record) {
      const { id, ...data } = record;
      await passkeys.doc(id).set(data);
    },
    async update(id, patch) {
      await passkeys.doc(id).set(patch, { merge: true });
    },
    async delete(id) {
      await passkeys.doc(id).delete();
    },
    async putChallenge(id, data) {
      await challenges.doc(id).set(data);
    },
    async takeChallenge(id) {
      const ref = challenges.doc(id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        tx.delete(ref);
        const data = snap.data();
        return { ...data, expiresAt: toDate(data.expiresAt) };
      });
    },
  };
}
