import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "./errors.js";
import {
  RESET_TTL_MS,
  confirmReset,
  hashToken,
  memoryResetStore,
  newToken,
  purgeResets,
  requestReset,
  resetLink,
} from "./second_factor_reset.js";

const START = new Date("2026-01-02T03:04:05Z");
const SITE = "https://example.com/";
const ADMIN = { uid: "admin1" };

function setup({ user = {}, failing = false } = {}) {
  const users = new Map([
    [
      "u1",
      {
        uid: "u1",
        email: "ada@example.com",
        emailVerified: true,
        multiFactor: { enrolledFactors: [{ uid: "f1", factorId: "totp" }] },
        ...user,
      },
    ],
  ]);
  const sent = [];
  const log = [];
  const updates = [];
  let time = START;
  let tokens = 0;
  return {
    users,
    sent,
    log,
    updates,
    store: memoryResetStore(),
    advance: (ms) => (time = new Date(time.getTime() + ms)),
    deps() {
      return {
        store: this.store,
        siteUrl: SITE,
        by: ADMIN,
        now: () => time,
        token: () => `${"t".repeat(42)}${++tokens}`,
        log: (message, data) => log.push([message, data]),
        send: async (message) => {
          if (failing) throw new Error("mail down");
          sent.push(message);
        },
        auth: {
          async getUser(uid) {
            if (!users.has(uid)) throw Object.assign(new Error("no user"), { code: "auth/user-not-found" });
            return users.get(uid);
          },
          async updateUser(uid, props) {
            updates.push([uid, props]);
            if (props.multiFactor?.enrolledFactors === null) users.get(uid).multiFactor = { enrolledFactors: [] };
          },
        },
      };
    },
  };
}

const tokenIn = (message) => /#token=([A-Za-z0-9_-]+)/.exec(message.text)[1];
const rejects = (promise, code, pattern) =>
  assert.rejects(promise, (error) => error instanceof AppError && error.code === code && (!pattern || pattern.test(error.message)));

test("newToken is long and random, and resetLink carries it in the fragment", () => {
  const token = newToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(token, newToken());
  assert.equal(resetLink("https://example.com/", "abc"), "https://example.com/account/reset-two-factor/#token=abc");
});

test("requestReset only emails the owner: the account is not changed", async () => {
  const t = setup();
  const out = await requestReset("u1", t.deps());
  assert.deepEqual(out, { sent: true, email: "ada@example.com", expiresAt: new Date(START.getTime() + RESET_TTL_MS).toISOString() });
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0].to, "ada@example.com");
  assert.match(t.sent[0].text, /https:\/\/example\.com\/account\/reset-two-factor\/#token=/);
  assert.deepEqual(t.updates, []);
  assert.equal(t.users.get("u1").multiFactor.enrolledFactors.length, 1);
  // Only the hash of the token is kept.
  const token = tokenIn(t.sent[0]);
  assert.deepEqual([...t.store.docs.keys()], [hashToken(token)]);
  assert.equal(JSON.stringify([...t.store.docs.values()]).includes(token), false);
  assert.deepEqual(t.log, [["two-factor reset requested", { uid: "u1", by: "admin1" }]]);
});

test("requestReset refuses accounts it cannot work for", async () => {
  await rejects(requestReset("nobody", setup().deps()), "not-found");
  await rejects(requestReset("u1", setup({ user: { multiFactor: { enrolledFactors: [] } } }).deps()), "failed-precondition", /no two-factor/);
  await rejects(requestReset("u1", setup({ user: { multiFactor: undefined } }).deps()), "failed-precondition", /no two-factor/);
  await rejects(requestReset("u1", setup({ user: { emailVerified: false } }).deps()), "failed-precondition", /verified email/);
  await rejects(requestReset("u1", { ...setup().deps(), send: null }), "failed-precondition", /Email is not set up/);
});

test("requestReset leaves no link behind when the email fails", async () => {
  const t = setup({ failing: true });
  await rejects(requestReset("u1", t.deps()), "unavailable");
  assert.equal(t.store.docs.size, 0);
});

test("confirmReset removes the second factor, once, and tells the owner", async () => {
  const t = setup();
  await requestReset("u1", t.deps());
  const token = tokenIn(t.sent[0]);
  assert.deepEqual(await confirmReset(token, t.deps()), { reset: true });
  assert.deepEqual(t.updates, [["u1", { multiFactor: { enrolledFactors: null } }]]);
  assert.equal(t.sent.length, 2);
  assert.equal(t.sent[1].subject, "Two-factor authentication has been reset");
  assert.deepEqual(t.log.at(-1), ["two-factor reset confirmed", { uid: "u1", requestedBy: "admin1" }]);
  // The link does not work twice.
  await rejects(confirmReset(token, t.deps()), "failed-precondition", /not valid or has expired/);
  assert.equal(t.updates.length, 1);
});

test("confirmReset refuses a wrong, malformed or expired token", async () => {
  const t = setup();
  await requestReset("u1", t.deps());
  const token = tokenIn(t.sent[0]);
  for (const bad of [undefined, 42, "", "short", `${"x".repeat(43)}`, `${token}x`]) {
    await rejects(confirmReset(bad, t.deps()), "failed-precondition", /not valid or has expired/);
  }
  t.advance(RESET_TTL_MS);
  await rejects(confirmReset(token, t.deps()), "failed-precondition", /not valid or has expired/);
  assert.deepEqual(t.updates, []);
});

test("asking again retires the earlier link", async () => {
  const t = setup();
  await requestReset("u1", t.deps());
  await requestReset("u1", t.deps());
  const [first, second] = t.sent.map(tokenIn);
  assert.notEqual(first, second);
  await rejects(confirmReset(first, t.deps()), "failed-precondition");
  assert.deepEqual(await confirmReset(second, t.deps()), { reset: true });
});

test("confirmReset refuses when the account's address changed or the account is gone", async () => {
  const changed = setup();
  await requestReset("u1", changed.deps());
  changed.users.get("u1").email = "other@example.com";
  await rejects(confirmReset(tokenIn(changed.sent[0]), changed.deps()), "failed-precondition");
  assert.deepEqual(changed.updates, []);

  const gone = setup();
  await requestReset("u1", gone.deps());
  gone.users.delete("u1");
  await rejects(confirmReset(tokenIn(gone.sent[0]), gone.deps()), "failed-precondition");
});

test("a failed notice afterwards does not undo or fail the reset", async () => {
  const t = setup();
  await requestReset("u1", t.deps());
  const deps = { ...t.deps(), send: async () => { throw new Error("mail down"); } };
  assert.deepEqual(await confirmReset(tokenIn(t.sent[0]), deps), { reset: true });
  assert.deepEqual(t.log.at(-1), ["two-factor reset notice failed", { uid: "u1", message: "mail down" }]);
});

test("purgeResets drops the expired links", async () => {
  const t = setup();
  await requestReset("u1", t.deps());
  assert.equal(await purgeResets(t.deps()), 0);
  t.advance(RESET_TTL_MS + 1);
  assert.equal(await purgeResets(t.deps()), 1);
  assert.equal(t.store.docs.size, 0);
});
