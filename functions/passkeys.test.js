import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError, ValidationError, secondFactorAdminFromClaims } from "./errors.js";
import {
  CHALLENGE_TTL_MS,
  MAX_PASSKEYS,
  clientOrigin,
  listPasskeys,
  originAllowed,
  register,
  registrationOptions,
  removeAllPasskeys,
  removePasskey,
  rpFromSiteUrl,
  signIn,
  signInOptions,
} from "./passkeys.js";

const RP = rpFromSiteUrl("https://bikes.pizza");
const user = { uid: "u1", email: "andy@example.com" };

/** A WebAuthn response as a browser would send it, from `origin`. */
function response(id, origin = "https://bikes.pizza") {
  const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", origin })).toString("base64url");
  return { id, rawId: id, type: "public-key", response: { clientDataJSON } };
}

function fakes({ records = [], now = new Date("2026-09-07T00:00:00Z") } = {}) {
  const passkeys = new Map(records.map((r) => [r.id, { ...r }]));
  const challenges = new Map();
  const calls = [];
  let clock = now;
  const store = {
    async listForUser(uid) {
      return [...passkeys.values()].filter((r) => r.uid === uid).map((r) => ({ ...r }));
    },
    async get(id) {
      return passkeys.has(id) ? { ...passkeys.get(id) } : null;
    },
    async put(record) {
      passkeys.set(record.id, { ...record });
    },
    async update(id, patch) {
      passkeys.set(id, { ...passkeys.get(id), ...patch });
    },
    async delete(id) {
      passkeys.delete(id);
    },
    async putChallenge(id, data) {
      challenges.set(id, data);
    },
    async takeChallenge(id) {
      const data = challenges.get(id) ?? null;
      challenges.delete(id);
      return data;
    },
  };
  const webauthn = {
    async generateRegistrationOptions(opts) {
      calls.push(["register-options", opts]);
      return { challenge: "reg-challenge", rp: { id: opts.rpID }, user: { name: opts.userName } };
    },
    async verifyRegistrationResponse(opts) {
      calls.push(["verify-registration", opts]);
      if (opts.response.id === "bad") return { verified: false };
      return {
        verified: true,
        registrationInfo: {
          credential: { id: opts.response.id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] },
          credentialBackedUp: true,
        },
      };
    },
    async generateAuthenticationOptions(opts) {
      calls.push(["auth-options", opts]);
      return { challenge: "auth-challenge", rpId: opts.rpID };
    },
    async verifyAuthenticationResponse(opts) {
      calls.push(["verify-authentication", opts]);
      if (opts.response.id === "stale") throw new Error("Response counter value 1 was lower than expected 5");
      return { verified: true, authenticationInfo: { newCounter: opts.credential.counter + 1 } };
    },
  };
  const tokens = [];
  const accounts = new Map([["andy@example.com", "u1"], ["someone@example.com", "u2"]]);
  const deps = {
    store,
    rp: RP,
    webauthn,
    lookupUidByEmail: async (email) => accounts.get(email) ?? null,
    now: () => clock,
    randomId: () => `id-${challenges.size + 1}`,
    createToken: async (uid, claims) => {
      tokens.push({ uid, claims });
      return `token-for-${uid}`;
    },
  };
  return { deps, passkeys, challenges, calls, tokens, tick: (ms) => (clock = new Date(clock.getTime() + ms)) };
}

test("rpFromSiteUrl takes the host", () => {
  assert.deepEqual(rpFromSiteUrl("https://bikes-pizza.dev/"), { rpID: "bikes-pizza.dev", rpName: "bikes-pizza.dev" });
});

test("originAllowed accepts the rp host, its subdomains and listed app origins only", () => {
  assert.ok(originAllowed("https://bikes.pizza", "bikes.pizza"));
  assert.ok(originAllowed("https://account.bikes.pizza", "bikes.pizza"));
  assert.ok(!originAllowed("http://bikes.pizza", "bikes.pizza"));
  assert.ok(!originAllowed("https://evilbikes.pizza", "bikes.pizza"));
  assert.ok(!originAllowed("https://bikes-pizza.dev", "bikes.pizza"));
  assert.ok(!originAllowed("android:apk-key-hash:abc", "bikes.pizza"));
  assert.ok(originAllowed("android:apk-key-hash:abc", "bikes.pizza", ["android:apk-key-hash:abc"]));
  assert.ok(!originAllowed(undefined, "bikes.pizza"));
});

test("clientOrigin reads the origin out of clientDataJSON", () => {
  assert.equal(clientOrigin(response("c1", "https://account.bikes.pizza")), "https://account.bikes.pizza");
  assert.equal(clientOrigin({ response: { clientDataJSON: "!!" } }), null);
});

test("registration: options exclude existing passkeys and the response is stored", async () => {
  const f = fakes({ records: [{ id: "old", uid: "u1", transports: ["internal"], createdAt: new Date(0) }] });
  const { challengeId, options } = await registrationOptions(user, { username: "andy" }, f.deps);
  assert.equal(challengeId, "id-1");
  assert.equal(options.challenge, "reg-challenge");
  const [, opts] = f.calls.find(([name]) => name === "register-options");
  assert.equal(opts.rpID, "bikes.pizza");
  assert.equal(opts.userName, "andy@example.com");
  assert.equal(opts.userDisplayName, "andy");
  assert.deepEqual(opts.excludeCredentials, [{ id: "old", transports: ["internal"] }]);
  assert.equal(opts.authenticatorSelection.authenticatorAttachment, "platform");
  assert.equal(opts.authenticatorSelection.userVerification, "required");
  assert.equal(f.challenges.get("id-1").uid, "u1");

  const list = await register(user, { challengeId, response: response("new"), name: "  Safari   on Mac " }, f.deps);
  const [, verify] = f.calls.find(([name]) => name === "verify-registration");
  assert.equal(verify.expectedChallenge, "reg-challenge");
  assert.equal(verify.expectedOrigin, "https://bikes.pizza");
  assert.equal(verify.expectedRPID, "bikes.pizza");
  const stored = f.passkeys.get("new");
  assert.equal(stored.uid, "u1");
  assert.equal(stored.publicKey, Buffer.from([1, 2, 3]).toString("base64url"));
  assert.equal(stored.counter, 0);
  assert.equal(stored.name, "Safari on Mac");
  assert.equal(stored.backedUp, true);
  assert.deepEqual(
    list.map((p) => p.id),
    ["new", "old"],
  );
  assert.equal(list[0].createdAt, "2026-09-07T00:00:00.000Z");
  assert.equal(list[0].lastUsedAt, null);
  assert.equal(f.challenges.size, 0, "the challenge is single-use");
});

test("registration refuses a reused, expired, foreign or off-site challenge, and a failed verification", async () => {
  const f = fakes();
  const { challengeId } = await registrationOptions(user, {}, f.deps);
  await assert.rejects(register(user, { challengeId, response: response("x", "https://elsewhere.example") }, f.deps), (e) => e instanceof AppError && e.code === "permission-denied");
  // Taken by the attempt above.
  await assert.rejects(register(user, { challengeId, response: response("x") }, f.deps), (e) => e instanceof AppError && e.code === "failed-precondition");

  const second = await registrationOptions(user, {}, f.deps);
  f.tick(CHALLENGE_TTL_MS + 1);
  await assert.rejects(register(user, { challengeId: second.challengeId, response: response("x") }, f.deps), /took too long/);

  const third = await registrationOptions(user, {}, f.deps);
  await assert.rejects(register({ uid: "someone-else" }, { challengeId: third.challengeId, response: response("x") }, f.deps), (e) => e.code === "permission-denied");

  const fourth = await registrationOptions(user, {}, f.deps);
  await assert.rejects(register(user, { challengeId: fourth.challengeId, response: response("bad") }, f.deps), ValidationError);
  await assert.rejects(register(user, { response: response("x") }, f.deps), ValidationError);
  assert.equal(f.passkeys.size, 0);
});

test("registration stops at the passkey limit", async () => {
  const records = Array.from({ length: MAX_PASSKEYS }, (_, i) => ({ id: `k${i}`, uid: "u1", transports: [] }));
  const f = fakes({ records });
  await assert.rejects(registrationOptions(user, {}, f.deps), /up to 10 passkeys/);
});

test("sign-in: options name no account; a verified assertion bumps the counter and mints a token", async () => {
  const f = fakes({ records: [{ id: "c1", uid: "u1", publicKey: Buffer.from([9]).toString("base64url"), counter: 4, transports: ["internal"], createdAt: new Date(0) }] });
  const { challengeId, options } = await signInOptions({}, f.deps);
  assert.equal(options.challenge, "auth-challenge");
  const [, opts] = f.calls.find(([name]) => name === "auth-options");
  assert.equal(opts.rpID, "bikes.pizza");
  assert.equal(opts.allowCredentials, undefined);
  assert.equal(f.challenges.get(challengeId).uid, null);

  const result = await signIn({ challengeId, response: response("c1", "https://account.bikes.pizza") }, f.deps);
  assert.deepEqual(result, { token: "token-for-u1" });
  assert.deepEqual(f.tokens, [{ uid: "u1", claims: { passkey: true } }]);
  const [, verify] = f.calls.find(([name]) => name === "verify-authentication");
  assert.equal(verify.expectedOrigin, "https://account.bikes.pizza");
  assert.deepEqual(verify.credential, { id: "c1", publicKey: new Uint8Array([9]), counter: 4, transports: ["internal"] });
  assert.equal(f.passkeys.get("c1").counter, 5);
  assert.equal(f.passkeys.get("c1").lastUsedAt.toISOString(), "2026-09-07T00:00:00.000Z");
});

test("sign-in for a named account offers only its passkeys and refuses the rest", async () => {
  const f = fakes({
    records: [
      { id: "mine", uid: "u1", publicKey: Buffer.from([9]).toString("base64url"), counter: 0, transports: ["internal"], createdAt: new Date(0) },
      { id: "theirs", uid: "u2", publicKey: Buffer.from([9]).toString("base64url"), counter: 0, transports: [], createdAt: new Date(0) },
    ],
  });
  const { challengeId, options, hasPasskeys } = await signInOptions({ email: " andy@example.com " }, f.deps);
  assert.equal(hasPasskeys, true);
  assert.equal(options.challenge, "auth-challenge");
  const [, opts] = f.calls.find(([name]) => name === "auth-options");
  assert.deepEqual(opts.allowCredentials, [{ id: "mine", transports: ["internal"] }]);
  assert.equal(f.challenges.get(challengeId).expectedUid, "u1");

  // Another member's passkey cannot finish this account's sign-in.
  await assert.rejects(
    signIn({ challengeId, response: response("theirs") }, f.deps),
    (e) => e.code === "permission-denied" && /different account/.test(e.message),
  );
  assert.deepEqual(f.tokens, []);

  const next = await signInOptions({ email: "andy@example.com" }, f.deps);
  assert.deepEqual(await signIn({ challengeId: next.challengeId, response: response("mine") }, f.deps), { token: "token-for-u1" });
});

test("a uid names the account directly, without an email lookup", async () => {
  const f = fakes({
    records: [
      { id: "mine", uid: "u1", publicKey: Buffer.from([9]).toString("base64url"), counter: 0, transports: ["internal"], createdAt: new Date(0) },
      { id: "theirs", uid: "u2", publicKey: Buffer.from([9]).toString("base64url"), counter: 0, transports: [], createdAt: new Date(0) },
    ],
  });
  const { challengeId, hasPasskeys } = await signInOptions({ uid: "u1" }, f.deps);
  assert.equal(hasPasskeys, true);
  const [, opts] = f.calls.find(([name]) => name === "auth-options");
  assert.deepEqual(opts.allowCredentials, [{ id: "mine", transports: ["internal"] }]);
  await assert.rejects(signIn({ challengeId, response: response("theirs") }, f.deps), (e) => e.code === "permission-denied");

  // A uid with nothing on it is the same answer as an unknown address.
  assert.deepEqual(await signInOptions({ uid: "nobody" }, f.deps), { hasPasskeys: false });
});

test("an account with no passkeys, and an address with no account, get no challenge", async () => {
  const f = fakes({ records: [{ id: "mine", uid: "u1", transports: [], createdAt: new Date(0) }] });
  assert.deepEqual(await signInOptions({ email: "someone@example.com" }, f.deps), { hasPasskeys: false });
  assert.deepEqual(await signInOptions({ email: "nobody@example.com" }, f.deps), { hasPasskeys: false });
  assert.equal(f.challenges.size, 0);
  assert.equal(
    f.calls.filter(([name]) => name === "auth-options").length,
    0,
  );
});

test("sign-in refuses unknown passkeys, registration challenges and failed verification, and never mints a token", async () => {
  const f = fakes({ records: [{ id: "stale", uid: "u1", publicKey: "AA", counter: 5, transports: [] }] });
  let { challengeId } = await signInOptions({}, f.deps);
  await assert.rejects(signIn({ challengeId, response: response("unknown") }, f.deps), (e) => e instanceof AppError && e.code === "not-found");

  ({ challengeId } = await signInOptions({}, f.deps));
  await assert.rejects(signIn({ challengeId, response: response("stale") }, f.deps), (e) => e.code === "permission-denied" && /counter/.test(e.message));

  ({ challengeId } = await registrationOptions(user, {}, f.deps));
  await assert.rejects(signIn({ challengeId, response: response("stale") }, f.deps), (e) => e.code === "permission-denied");

  await assert.rejects(signIn({ challengeId: "nope", response: response("stale") }, f.deps), (e) => e.code === "failed-precondition");
  assert.deepEqual(f.tokens, []);
});

test("passkeys are listed newest first, removed only by their owner, and cleared with the account", async () => {
  const f = fakes({
    records: [
      { id: "a", uid: "u1", name: "Old", createdAt: new Date("2026-01-01T00:00:00Z") },
      { id: "b", uid: "u1", name: "New", createdAt: new Date("2026-06-01T00:00:00Z") },
      { id: "c", uid: "u2", name: "Theirs", createdAt: new Date("2026-03-01T00:00:00Z") },
    ],
  });
  assert.deepEqual(
    (await listPasskeys("u1", f.deps)).map((p) => p.name),
    ["New", "Old"],
  );
  await assert.rejects(removePasskey("u1", { id: "c" }, f.deps), (e) => e.code === "not-found");
  await assert.rejects(removePasskey("u1", {}, f.deps), ValidationError);
  const rest = await removePasskey("u1", { id: "b" }, f.deps);
  assert.deepEqual(
    rest.map((p) => p.id),
    ["a"],
  );
  assert.equal(await removeAllPasskeys("u1", f.deps), 1);
  assert.deepEqual([...f.passkeys.keys()], ["c"]);
});

test("a passkey sign-in counts as the admin pages' second factor", () => {
  const base = { uid: "a1", email: "admin@example.com", email_verified: true, admin: true };
  assert.throws(() => secondFactorAdminFromClaims({ ...base, firebase: {} }), /Two-factor/);
  assert.equal(secondFactorAdminFromClaims({ ...base, passkey: true, firebase: { sign_in_provider: "custom" } }).uid, "a1");
  assert.equal(secondFactorAdminFromClaims({ ...base, firebase: { sign_in_second_factor: "totp" } }).uid, "a1");
});
