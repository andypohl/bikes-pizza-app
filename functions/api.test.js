import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { ValidationError } from "./account.js";
import { createApi, describe } from "./api.js";
import { AppError } from "./errors.js";

const TOKENS = {
  admin: { uid: "a1", email: "admin@example.com", email_verified: true, admin: true },
  admin2fa: { uid: "a1", email: "admin@example.com", email_verified: true, admin: true, firebase: { sign_in_second_factor: "totp" } },
  member: { uid: "u1", email: "ada@example.com", email_verified: true },
  unverified: { uid: "u2", email: "new@example.com", email_verified: false },
};

const calls = [];
const settingsState = { submitButton: true };

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
    if (input.action === "boom") throw new Error("publisher down");
    return { status: "rejected" };
  },
  create: async (data, user) => {
    calls.push(["create", data.title, user.uid]);
    return { submissionId: "s9", notified: false };
  },
  site: {
    settings: async () => ({ submitButton: settingsState.submitButton }),
    updateSettings: async (data, admin) => {
      calls.push(["settings", data, admin.uid]);
      if (typeof data?.submitButton !== "boolean") throw new ValidationError("Nothing to update.");
      settingsState.submitButton = data.submitButton;
      return { submitButton: settingsState.submitButton };
    },
  },
  users: {
    list: async (query) => calls.push(["users.list", { ...query }]) && { page: 1, users: [{ uid: "u1" }] },
    get: async (uid) => {
      if (uid === "nope") throw new AppError("not-found", "No such user.");
      return { uid };
    },
    update: async (uid, data, admin) => calls.push(["users.update", uid, data, admin.uid]) && { uid, ...data },
    remove: async (uid, admin) => calls.push(["users.remove", uid, admin.uid]) && { deleted: uid },
  },
  posts: {
    mine: async (user) => calls.push(["posts.mine", user.uid]) && { posts: [{ id: "p1" }] },
    get: async (id, actor) => {
      calls.push(["posts.get", id, actor.uid, actor.admin]);
      if (id === "gone") throw new AppError("not-found", "That post no longer exists.");
      return { id };
    },
    update: async (id, data, actor) => calls.push(["posts.update", id, data, actor.uid, actor.admin]) && { id, ...data },
    remove: async (id, admin) => calls.push(["posts.remove", id, admin.uid]) && { removed: id },
    list: async (query, admin) => calls.push(["posts.list", { ...query }, admin.uid]) && { feed: query.feed ?? "news", posts: [] },
    create: async (data, admin) => calls.push(["posts.create", data.title, admin.uid]) && { status: "applied", post: { id: "p9" } },
    upload: async (data, admin) => calls.push(["posts.upload", Object.keys(data), admin.uid]) && { url: "https://files.test/x.jpg", width: 1, height: 1 },
    reactions: async (id, user) => calls.push(["posts.reactions", id, user.uid]) && { counts: {}, mine: {}, who: {} },
    react: async (id, data, user) => calls.push(["posts.react", id, data, user.uid]) && { counts: {}, mine: data.picks, who: {} },
  },
  queue: {
    info: async (feed) => {
      if (feed === "news") throw new ValidationError("Unknown feed.");
      return { feed, length: 2, nextPostAt: "2026-09-04T17:00:00.000Z", seconds: 5400, countdown: "1h 30m 0s", clock: "01:30:00" };
    },
    items: async (feed) => ({ feed, length: 1, items: [{ position: 1, id: "s1" }] }),
    add: async (input, admin) => calls.push(["add", input, admin.uid]) && { status: "queued", position: 3 },
    remove: async (input, admin) => calls.push(["remove", input, admin.uid]) && { status: "pending" },
    submitNext: async (feed) => calls.push(["submit-next", feed]) && { posted: { id: "s1" }, length: 0 },
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
  assert.equal((await call("/api/posts")).status, 401);
  const bad = await call("/api/posts", { token: "nope" });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error.code, "unauthenticated");
});

test("an unverified email is refused with a message", async () => {
  const u = await call("/api/posts", { token: "unverified" });
  assert.equal(u.status, 409);
  assert.match(u.body.error.message, /Verify your email/);
});

test("listing and fetching need the admin claim", async () => {
  const denied = await call("/api/submissions", { token: "member" });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "permission-denied");
  calls.length = 0;
  const ok = await call("/api/submissions?status=pending&limit=5", { token: "admin2fa" });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.items, [{ id: "s1" }]);
  assert.deepEqual(calls, [["list", { status: "pending", limit: "5" }]]);
  assert.equal((await call("/api/submissions/s1", { token: "admin2fa" })).status, 200);
  assert.equal((await call("/api/submissions/missing", { token: "admin2fa" })).status, 404);
});

test("review maps service errors to statuses", async () => {
  calls.length = 0;
  const ok = await call("/api/submissions/s1/review", { token: "admin2fa", method: "POST", body: { action: "reject", note: "n" } });
  assert.equal(ok.status, 200);
  assert.deepEqual(calls, [["review", { action: "reject", note: "n", id: "s1" }, "a1"]]);
  const again = await call("/api/submissions/s1/review", { token: "admin2fa", method: "POST", body: { action: "again" } });
  assert.equal(again.status, 409);
  const bad = await call("/api/submissions/s1/review", { token: "admin2fa", method: "POST", body: { action: "bad" } });
  assert.equal(bad.status, 400);
  const boom = await call("/api/submissions/s1/review", { token: "admin2fa", method: "POST", body: { action: "boom" } });
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

test("queue reads are for members, queue changes for admins", async () => {
  const cd = await call("/api/queue/bikes/countdown-time", { token: "member" });
  assert.equal(cd.status, 200);
  assert.equal(cd.body.countdown, "1h 30m 0s");
  assert.equal(cd.body.nextPostAt, "2026-09-04T17:00:00.000Z");
  assert.equal((await call("/api/queue/news/countdown-time", { token: "member" })).status, 400);

  calls.length = 0;
  assert.equal((await call("/api/queue/bikes/remove", { token: "member", method: "POST", body: { id: "s2" } })).status, 403);
  const rm = await call("/api/queue/bikes/remove", { token: "admin2fa", method: "POST", body: { id: "s2" } });
  assert.equal(rm.status, 200);
  assert.deepEqual(calls, [["remove", { id: "s2", feed: "bikes" }, "a1"]]);
});

test("unknown endpoints are JSON 404s", async () => {
  const r = await call("/api/nothing", { token: "admin2fa" });
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

test("site settings: public read, admin-only write, validated", async () => {
  const anonRes = await fetch(base + "/api/site/settings");
  assert.equal(anonRes.status, 200);
  assert.equal(anonRes.headers.get("cache-control"), "no-store");
  assert.deepEqual(await anonRes.json(), { submitButton: true });

  const user = await call("/api/site/settings", { token: "member", method: "POST", body: { submitButton: false } });
  assert.equal(user.status, 403);
  const bad = await call("/api/site/settings", { token: "admin2fa", method: "POST", body: { submitButton: "no" } });
  assert.equal(bad.status, 400);
  const off = await call("/api/site/settings", { token: "admin2fa", method: "POST", body: { submitButton: false } });
  assert.equal(off.status, 200);
  assert.deepEqual(off.body, { submitButton: false });
  assert.deepEqual((await call("/api/site/settings")).body, { submitButton: false });
  await call("/api/site/settings", { token: "admin2fa", method: "POST", body: { submitButton: true } });
});

test("admin user routes need an admin who used a second factor, and pass the body through", async () => {
  for (const token of ["member", "admin"]) {
    assert.equal((await call("/api/admin/users", { token })).status, 403);
    assert.equal((await call("/api/admin/users/u1", { token })).status, 403);
    assert.equal((await call("/api/admin/users/u1", { token, method: "PATCH", body: { username: "x" } })).status, 403);
    assert.equal((await call("/api/admin/users/u1", { token, method: "DELETE" })).status, 403);
  }
  const refused = await call("/api/admin/users", { token: "admin" });
  assert.match(refused.body.error.message, /Two-factor/);
  // Every other admin route asks the same.
  assert.equal((await call("/api/submissions", { token: "admin" })).status, 403);
  assert.equal((await call("/api/submissions/s1", { token: "admin" })).status, 403);
  assert.equal((await call("/api/site/settings", { token: "admin", method: "POST", body: { submitButton: true } })).status, 403);

  const list = await call("/api/admin/users?page=2&pageSize=10", { token: "admin2fa" });
  assert.equal(list.status, 200);
  assert.deepEqual(calls.at(-1), ["users.list", { page: "2", pageSize: "10" }]);

  assert.equal((await call("/api/admin/users/nope", { token: "admin2fa" })).status, 404);
  assert.equal((await call("/api/admin/users/u1", { token: "admin2fa" })).status, 200);

  const patched = await call("/api/admin/users/u1", { token: "admin2fa", method: "PATCH", body: { username: "ada", newsletters: [] } });
  assert.equal(patched.status, 200);
  assert.deepEqual(calls.at(-1), ["users.update", "u1", { username: "ada", newsletters: [] }, "a1"]);

  const removed = await call("/api/admin/users/u1", { token: "admin2fa", method: "DELETE" });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body, { deleted: "u1" });
  assert.deepEqual(calls.at(-1), ["users.remove", "u1", "a1"]);
});

test("posts: members see their own; admins count as admins only with a second factor", async () => {
  calls.length = 0;
  const mine = await call("/api/posts", { token: "member" });
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body, { posts: [{ id: "p1" }] });
  assert.deepEqual(calls[0], ["posts.mine", "u1"]);

  const one = await call("/api/posts/p1", { token: "member" });
  assert.equal(one.status, 200);
  assert.deepEqual(calls[1], ["posts.get", "p1", "u1", false]);
  await call("/api/posts/p1", { token: "admin" });
  assert.deepEqual(calls[2], ["posts.get", "p1", "a1", false], "one-step admin session edits as a member");
  await call("/api/posts/p1", { token: "admin2fa" });
  assert.deepEqual(calls[3], ["posts.get", "p1", "a1", true]);

  const gone = await call("/api/posts/gone", { token: "member" });
  assert.equal(gone.status, 404);
  assert.equal((await call("/api/posts", { token: "unverified" })).status, 409);
  assert.equal((await call("/api/posts/p1")).status, 401);

  const patched = await call("/api/posts/p1", { token: "member", method: "PATCH", body: { title: "New" } });
  assert.equal(patched.status, 200);
  assert.deepEqual(patched.body, { id: "p1", title: "New" });
  assert.deepEqual(calls.at(-1), ["posts.update", "p1", { title: "New" }, "u1", false]);
});

test("reactions are for any verified member", async () => {
  calls.length = 0;
  const seen = await call("/api/posts/p1/reactions", { token: "member" });
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.body, { counts: {}, mine: {}, who: {} });
  assert.deepEqual(calls[0], ["posts.reactions", "p1", "u1"]);

  const set = await call("/api/posts/p1/reactions", { method: "POST", token: "member", body: { picks: { had: ["yes"] } } });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.mine, { had: ["yes"] });
  assert.deepEqual(calls[1], ["posts.react", "p1", { picks: { had: ["yes"] } }, "u1"]);

  const anonymous = await call("/api/posts/p1/reactions", { method: "POST", body: { picks: {} } });
  assert.equal(anonymous.status, 401);
  const unverified = await call("/api/posts/p1/reactions", { token: "unverified" });
  assert.equal(unverified.status, 409);
});

test("the admin page's post routes need an admin with a second factor", async () => {
  calls.length = 0;
  assert.equal((await call("/api/admin/posts", { token: "member" })).status, 403);
  assert.equal((await call("/api/admin/posts", { token: "admin" })).status, 403, "one-step admin session");
  const list = await call("/api/admin/posts?feed=news", { token: "admin2fa" });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body, { feed: "news", posts: [] });
  assert.deepEqual(calls.at(-1), ["posts.list", { feed: "news" }, "a1"]);

  const created = await call("/api/admin/posts", { token: "admin2fa", method: "POST", body: { title: "Hello" } });
  assert.equal(created.status, 200);
  assert.deepEqual(created.body, { status: "applied", post: { id: "p9" } });
  assert.deepEqual(calls.at(-1), ["posts.create", "Hello", "a1"]);
  assert.equal((await call("/api/admin/posts", { token: "member", method: "POST", body: { title: "Hello" } })).status, 403);

  const upload = await call("/api/admin/uploads", { token: "admin2fa", method: "POST", body: { image: { data: "AA==", contentType: "image/png" } } });
  assert.equal(upload.status, 200);
  assert.equal(upload.body.url, "https://files.test/x.jpg");
  assert.deepEqual(calls.at(-1), ["posts.upload", ["image"], "a1"]);
  assert.equal((await call("/api/admin/uploads", { token: "admin", method: "POST", body: {} })).status, 403);

  const removed = await call("/api/posts/p1", { token: "admin2fa", method: "DELETE" });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body, { removed: "p1" });
  assert.deepEqual(calls.at(-1), ["posts.remove", "p1", "a1"]);
  assert.equal((await call("/api/posts/p1", { token: "member", method: "DELETE" })).status, 403);
});
