import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { ValidationError } from "./account.js";
import { createApi, describe } from "./api.js";
import { AppError } from "./errors.js";

const TOKENS = {
  admin: { uid: "a1", email: "admin@example.com", email_verified: true, admin: true },
  member: { uid: "u1", email: "ada@example.com", email_verified: true },
  unverified: { uid: "u2", email: "new@example.com", email_verified: false },
};

const calls = [];
const service = {
  list: async (query) => {
    calls.push(["list", { ...query }]);
    return { items: [{ id: "s1" }], nextCursor: null };
  },
  get: async (id) => {
    if (id === "missing") throw new AppError("not-found", "That submission no longer exists.");
    return { id };
  },
  review: async (input, admin) => {
    calls.push(["review", input, admin.uid]);
    if (input.action === "again") throw new AppError("failed-precondition", "Already posted.");
    if (input.action === "bad") throw new ValidationError("Unknown review action.");
    if (input.action === "boom") throw new Error("ghost down");
    return { status: "rejected" };
  },
  create: async (data, user) => {
    calls.push(["create", data.title, user.uid]);
    return { submissionId: "s9", notified: false };
  },
};

let base;
let server;
before(async () => {
  const app = createApi({
    verifyToken: async (token) => {
      if (!(token in TOKENS)) throw new Error("bad token");
      return TOKENS[token];
    },
    service,
  });
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function call(path, { token, method = "GET", body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

test("requests without a valid token are refused", async () => {
  assert.equal((await call("/api/me")).status, 401);
  const bad = await call("/api/me", { token: "nope" });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error.code, "unauthenticated");
});

test("/api/me describes the caller", async () => {
  const r = await call("/api/me", { token: "member" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { uid: "u1", email: "ada@example.com", admin: false });
  const u = await call("/api/me", { token: "unverified" });
  assert.equal(u.status, 409);
  assert.match(u.body.error.message, /Verify your email/);
});

test("listing and fetching need the admin claim", async () => {
  const denied = await call("/api/submissions", { token: "member" });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "permission-denied");
  calls.length = 0;
  const ok = await call("/api/submissions?status=pending&limit=5", { token: "admin" });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.items, [{ id: "s1" }]);
  assert.deepEqual(calls, [["list", { status: "pending", limit: "5" }]]);
  assert.equal((await call("/api/submissions/s1", { token: "admin" })).status, 200);
  assert.equal((await call("/api/submissions/missing", { token: "admin" })).status, 404);
});

test("review maps service errors to statuses", async () => {
  calls.length = 0;
  const ok = await call("/api/submissions/s1/review", { token: "admin", method: "POST", body: { action: "reject", note: "n" } });
  assert.equal(ok.status, 200);
  assert.deepEqual(calls, [["review", { action: "reject", note: "n", id: "s1" }, "a1"]]);
  const again = await call("/api/submissions/s1/review", { token: "admin", method: "POST", body: { action: "again" } });
  assert.equal(again.status, 409);
  const bad = await call("/api/submissions/s1/review", { token: "admin", method: "POST", body: { action: "bad" } });
  assert.equal(bad.status, 400);
  const boom = await call("/api/submissions/s1/review", { token: "admin", method: "POST", body: { action: "boom" } });
  assert.equal(boom.status, 503);
  assert.equal(boom.body.error.message, "Something went wrong. Please try again.");
  const member = await call("/api/submissions/s1/review", { token: "member", method: "POST", body: { action: "reject" } });
  assert.equal(member.status, 403);
});

test("members can create submissions; bad JSON is a 400", async () => {
  calls.length = 0;
  const r = await call("/api/submissions", { token: "member", method: "POST", body: { title: "T" } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { submissionId: "s9", notified: false });
  assert.deepEqual(calls, [["create", "T", "u1"]]);
  const junk = await call("/api/submissions", { token: "member", method: "POST", body: "{not json" });
  assert.equal(junk.status, 400);
});

test("unknown endpoints are JSON 404s", async () => {
  const r = await call("/api/nothing", { token: "admin" });
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, "not-found");
  assert.equal((await call("/elsewhere")).status, 404);
});

test("describe hides unexpected errors", () => {
  assert.deepEqual(describe(new Error("secret")), {
    code: "unavailable",
    message: "Something went wrong. Please try again.",
  });
  assert.equal(describe(new AppError("weird-code", "x")).code, "unavailable");
});
