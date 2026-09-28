// Resetting a member's two-factor authentication (the authenticator app)
// when they can no longer produce its code. An administrator asks for it
// from Manage Users, but that only sends an email: the reset happens when
// whoever reads the account's mail opens the link in it and confirms,
// within the hour. Someone who talks an administrator into it while posing
// as the member therefore gets nothing unless they also have the mailbox.
//
// The link carries a random token; only its hash is kept, so the stored
// record cannot be turned back into a working link. Passkeys are not
// touched. Pure: the Firebase Auth admin API, the store and the mail sender
// are injected.

import { createHash, randomBytes } from "node:crypto";

import { AppError } from "./errors.js";

/** How long the link in the email works. */
export const RESET_TTL_MS = 60 * 60 * 1000;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const INVALID_LINK = "This link is not valid or has expired. Ask for a new one.";

/**
 * @typedef {object} ResetStore
 * @property {(id: string, record: object) => Promise<void>} put
 * @property {(id: string) => Promise<object|null>} take  Reads and deletes
 * @property {(uid: string) => Promise<void>} deleteFor  Drops a member's pending resets
 * @property {(before: Date) => Promise<number>} purge  Drops the expired ones
 */

export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token) => createHash("sha256").update(token).digest("hex");

/** Where the link in the email goes: the confirmation page of the account pages. */
export function resetLink(siteUrl, token) {
  return `${siteUrl.replace(/\/+$/, "")}/account/reset-two-factor/#token=${token}`;
}

async function userOrThrow(auth, uid) {
  try {
    return await auth.getUser(uid);
  } catch (error) {
    if (error?.code === "auth/user-not-found") throw new AppError("not-found", "No such user.");
    throw error;
  }
}

const enrolled = (user) => user.multiFactor?.enrolledFactors ?? [];

/** The email with the link. */
export function resetRequestEmail({ email, link, contact = "contact@bikes.pizza" }) {
  const lines = [
    `Someone asked us to reset two-factor authentication for the bikes.pizza account ${email}.`,
    "",
    "If that was you, open this link within one hour and confirm:",
    link,
    "",
    "After that, signing in no longer asks for a code from your authenticator",
    "app, and you can set two-factor authentication up again from your account.",
    "Your password and passkeys stay as they are.",
    "",
    "If you did not ask for this, do nothing: without the link nothing changes.",
    `You can tell us at ${contact}.`,
    "",
    "bikes.pizza",
  ];
  return { subject: "Confirm resetting two-factor authentication", text: lines.join("\n") };
}

/** The email that says it has happened. */
export function resetDoneEmail({ email, contact = "contact@bikes.pizza" }) {
  const lines = [
    `Two-factor authentication for the bikes.pizza account ${email} has been reset.`,
    "",
    "Signing in no longer asks for a code from an authenticator app. To turn it",
    "on again, sign in and open your account.",
    "",
    `If you did not do this, change your password and write to ${contact} straight away.`,
    "",
    "bikes.pizza",
  ];
  return { subject: "Two-factor authentication has been reset", text: lines.join("\n") };
}

/**
 * An administrator's request: emails the account's owner the link. Nothing
 * about the account changes here.
 *
 * @param {string} uid
 * @param {{auth: object, store: ResetStore, send: ((message: object) => Promise<unknown>)|null,
 *   siteUrl: string, by: {uid: string}, now?: () => Date, token?: () => string,
 *   log?: (message: string, data?: object) => void}} deps
 * @returns {Promise<{sent: true, email: string, expiresAt: string}>}
 */
export async function requestReset(uid, { auth, store, send, siteUrl, by, now = () => new Date(), token = newToken, log = () => {} }) {
  const user = await userOrThrow(auth, uid);
  if (!enrolled(user).length) {
    throw new AppError("failed-precondition", "This account has no two-factor authentication to reset.");
  }
  if (!user.email || !user.emailVerified) {
    throw new AppError("failed-precondition", "This account has no verified email address to confirm the reset with.");
  }
  if (!send) throw new AppError("failed-precondition", "Email is not set up, so the reset cannot be confirmed.");

  const secret = token();
  const id = hashToken(secret);
  const expiresAt = new Date(now().getTime() + RESET_TTL_MS);
  // One pending reset per member: asking again retires the earlier link.
  await store.deleteFor(uid);
  await store.put(id, { uid, email: user.email, requestedBy: by.uid, createdAt: now(), expiresAt });
  try {
    await send({ to: user.email, ...resetRequestEmail({ email: user.email, link: resetLink(siteUrl, secret) }) });
  } catch (error) {
    await store.deleteFor(uid);
    log("two-factor reset email failed", { uid, message: error.message });
    throw new AppError("unavailable", "The email could not be sent. Try again.");
  }
  log("two-factor reset requested", { uid, by: by.uid });
  return { sent: true, email: user.email, expiresAt: expiresAt.toISOString() };
}

/**
 * The owner's confirmation, from the link: removes the account's enrolled
 * second factors. The token works once.
 *
 * @param {unknown} token
 * @param {{auth: object, store: ResetStore, send?: ((message: object) => Promise<unknown>)|null,
 *   now?: () => Date, log?: (message: string, data?: object) => void}} deps
 * @returns {Promise<{reset: true}>}
 */
export async function confirmReset(token, { auth, store, send, now = () => new Date(), log = () => {} }) {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) throw new AppError("failed-precondition", INVALID_LINK);
  const record = await store.take(hashToken(token));
  if (!record || new Date(record.expiresAt).getTime() <= now().getTime()) {
    throw new AppError("failed-precondition", INVALID_LINK);
  }
  let user;
  try {
    user = await userOrThrow(auth, record.uid);
  } catch (error) {
    if (error instanceof AppError) throw new AppError("failed-precondition", INVALID_LINK);
    throw error;
  }
  // The link was sent to the address the account had then; a changed
  // address means the mailbox that got it no longer speaks for the account.
  if (user.email !== record.email) throw new AppError("failed-precondition", INVALID_LINK);

  await auth.updateUser(record.uid, { multiFactor: { enrolledFactors: null } });
  log("two-factor reset confirmed", { uid: record.uid, requestedBy: record.requestedBy });
  if (send) {
    try {
      await send({ to: user.email, ...resetDoneEmail({ email: user.email }) });
    } catch (error) {
      log("two-factor reset notice failed", { uid: record.uid, message: error.message });
    }
  }
  return { reset: true };
}

/** Drops the links that have expired. */
export async function purgeResets({ store, now = () => new Date() }) {
  return store.purge(now());
}

/** [ResetStore] on Firestore: `secondFactorResets/{hash of the token}`. */
export function firestoreResetStore(db) {
  const col = db.collection("secondFactorResets");
  const removeAll = async (snap) => {
    if (snap.empty) return 0;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    return snap.size;
  };
  return {
    async put(id, record) {
      await col.doc(id).set(record);
    },
    async take(id) {
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(col.doc(id));
        if (!snap.exists) return null;
        tx.delete(snap.ref);
        const data = snap.data();
        return { ...data, expiresAt: data.expiresAt?.toDate?.() ?? data.expiresAt };
      });
    },
    async deleteFor(uid) {
      await removeAll(await col.where("uid", "==", uid).get());
    },
    async purge(before) {
      return removeAll(await col.where("expiresAt", "<", before).limit(500).get());
    },
  };
}

/** [ResetStore] in memory, for tests. */
export function memoryResetStore() {
  const docs = new Map();
  return {
    docs,
    async put(id, record) {
      docs.set(id, { ...record });
    },
    async take(id) {
      const record = docs.get(id) ?? null;
      docs.delete(id);
      return record;
    },
    async deleteFor(uid) {
      for (const [id, record] of docs) if (record.uid === uid) docs.delete(id);
    },
    async purge(before) {
      let purged = 0;
      for (const [id, record] of docs) {
        if (record.expiresAt.getTime() < before.getTime()) {
          docs.delete(id);
          purged++;
        }
      }
      return purged;
    },
  };
}
