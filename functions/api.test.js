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
  members: {
    profile: async (username, viewer) => calls.push(["members.profile", username, viewer?.uid ?? null]) && { username, counts: { pizza: 1, bikes: 0 } },
    posts: async (username, query) => calls.push(["members.posts", username, { ...query }]) && { username, posts: [] },
  },
  search: async (query) => {
    calls.push(["search", { ...query }]);
    if (!query.q) throw new ValidationError("Type something to search for.");
    return { query: query.q, members: [], titles: [], details: [], text: [] };
  },
  threads: {
    list: async (user) => calls.push(["threads.list", user.uid]) && { threads: [] },
    open: async (data, user) => calls.push(["threads.open", data, user.uid]) && { thread: { id: "t1" }, created: true },
    messages: async (id, query, user) => calls.push(["threads.messages", id, { ...query }, user.uid]) && { messages: [], more: false },
    send: async (id, data, user) => calls.push(["threads.send", id, data, user.uid]) && { message: { id: "m1" } },
    edit: async (id, mid, data, user) => calls.push(["threads.edit", id, mid, data, user.uid]) && { message: { id: mid } },
    remove: async (id, mid, user) => calls.push(["threads.remove", id, mid, user.uid]) && { deleted: mid },
    seen: async (id, user) => calls.push(["threads.seen", id, user.uid]) && { seen: true },
    requestEmail: async (id, user) => calls.push(["threads.requestEmail", id, user.uid]) && { requested: true },
    withdrawEmail: async (id, user) => calls.push(["threads.withdrawEmail", id, user.uid]) && { withdrawn: true },
    agreeEmail: async (id, user) => calls.push(["threads.agreeEmail", id, user.uid]) && { emailed: true, conversation: 2 },
    report: async (id, data, user) => calls.push(["threads.report", id, data, user.uid]) && { reported: true },
    block: async (username, on, user) => calls.push(["threads.block", username, on, user.uid]) && { blocked: on, username },
    blocks: async (user) => calls.push(["threads.blocks", user.uid]) && { blocked: [] },
    queue: async (query, admin) => calls.push(["threads.queue", { ...query }, admin.uid]) && { queue: "reported", threads: [] },
    get: async (id, admin) => calls.push(["threads.get", id, admin.uid]) && { id, messages: [] },
  },
  comments: {
    list: async (id, query, user) => calls.push(["comments.list", id, { ...query }, user.uid]) && { count: 0, comments: [], next: null },
    create: async (id, data, user) => {
      calls.push(["comments.create", id, data, user.uid]);
      if (data.text === "bad") throw new AppError("invalid-argument", "That comment can't be posted.");
      return { comment: { id: "c1", status: "published" } };
    },
    edit: async (id, cid, data, user) => calls.push(["comments.edit", id, cid, data, user.uid]) && { comment: { id: cid } },
    remove: async (id, cid, actor) => calls.push(["comments.remove", id, cid, actor.uid, actor.admin]) && { removed: cid },
    replies: async (id, cid, user) => calls.push(["comments.replies", id, cid, user.uid]) && { id: cid, replies: [] },
    like: async (id, cid, user) => calls.push(["comments.like", id, cid, user.uid]) && { liked: true, likeCount: 1 },
    likes: async (id, cid, user) => calls.push(["comments.likes", id, cid, user.uid]) && { likes: [] },
    report: async (id, cid, data, user) => calls.push(["comments.report", id, cid, data, user.uid]) && { reported: true, hidden: false },
    notices: async (user, query) => calls.push(["comments.notices", user.uid, { ...query }]) && { notices: [] },
    exportData: async (user) => calls.push(["comments.export", user.uid]) && { member: { uid: user.uid } },
    queue: async (query, admin) => calls.push(["comments.queue", { ...query }, admin.uid]) && { queue: query.queue ?? "pending", comments: [] },
    act: async (id, cid, action, admin) => calls.push(["comments.act", id, cid, action, admin.uid]) && { comment: { id: cid } },
    moderation: async (admin) => calls.push(["comments.moderation", admin.uid]) && { banned: [], suspicious: [] },
    setModeration: async (data, admin) => calls.push(["comments.setModeration", data, admin.uid]) && data,
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

test("comment routes reach the service with the caller and answer its result", async () => {
  calls.length = 0;
  const post = (path, body, token = "member") => call(path, { token, method: "POST", body });
  assert.equal((await call("/api/posts/p1/comments?after=c0", { token: "member" })).status, 200);
  const created = await post("/api/posts/p1/comments", { text: "hi", parentId: "c0" });
  assert.deepEqual([created.status, created.body.comment.id], [200, "c1"]);
  const blocked = await post("/api/posts/p1/comments", { text: "bad" });
  assert.deepEqual([blocked.status, blocked.body.error.code], [400, "invalid-argument"]);
  assert.equal((await call("/api/posts/p1/comments/c1", { token: "member", method: "PATCH", body: { text: "edited" } })).status, 200);
  assert.equal((await call("/api/posts/p1/comments/c1/replies", { token: "member" })).status, 200);
  assert.equal((await post("/api/posts/p1/comments/c1/like")).status, 200);
  assert.equal((await call("/api/posts/p1/comments/c1/likes", { token: "member" })).status, 200);
  assert.equal((await post("/api/posts/p1/comments/c1/report", { reason: "spam" })).status, 200);
  assert.equal((await call("/api/me/notices?since=2026-09-01T00:00:00.000Z", { token: "member" })).status, 200);
  assert.equal((await call("/api/me/export", { token: "member" })).status, 200);
  assert.deepEqual(calls, [
    ["comments.list", "p1", { after: "c0" }, "u1"],
    ["comments.create", "p1", { text: "hi", parentId: "c0" }, "u1"],
    ["comments.create", "p1", { text: "bad" }, "u1"],
    ["comments.edit", "p1", "c1", { text: "edited" }, "u1"],
    ["comments.replies", "p1", "c1", "u1"],
    ["comments.like", "p1", "c1", "u1"],
    ["comments.likes", "p1", "c1", "u1"],
    ["comments.report", "p1", "c1", { reason: "spam" }, "u1"],
    ["comments.notices", "u1", { since: "2026-09-01T00:00:00.000Z" }],
    ["comments.export", "u1"],
  ]);
  assert.equal((await call("/api/posts/p1/comments", { token: "unverified" })).status, 409);
});

test("deleting a comment passes an admin's powers only with a second factor", async () => {
  calls.length = 0;
  assert.equal((await call("/api/posts/p1/comments/c1", { token: "member", method: "DELETE" })).status, 200);
  assert.equal((await call("/api/posts/p1/comments/c1", { token: "admin", method: "DELETE" })).status, 200);
  assert.equal((await call("/api/posts/p1/comments/c1", { token: "admin2fa", method: "DELETE" })).status, 200);
  assert.deepEqual(calls, [
    ["comments.remove", "p1", "c1", "u1", false],
    ["comments.remove", "p1", "c1", "a1", false],
    ["comments.remove", "p1", "c1", "a1", true],
  ]);
});

test("the comment review endpoints need an admin with a second factor", async () => {
  calls.length = 0;
  assert.equal((await call("/api/admin/comments?queue=reported", { token: "member" })).status, 403);
  assert.equal((await call("/api/admin/comments?queue=reported", { token: "admin" })).status, 403);
  assert.equal((await call("/api/admin/comments?queue=reported", { token: "admin2fa" })).status, 200);
  assert.equal((await call("/api/admin/comments/p1/c1/approve", { token: "admin2fa", method: "POST" })).status, 200);
  assert.equal((await call("/api/admin/moderation", { token: "admin2fa" })).status, 200);
  const put = await call("/api/admin/moderation", { token: "admin2fa", method: "PUT", body: { banned: ["x"], suspicious: [] } });
  assert.deepEqual([put.status, put.body], [200, { banned: ["x"], suspicious: [] }]);
  assert.equal((await call("/api/admin/moderation", { token: "member", method: "PUT", body: {} })).status, 403);
  assert.deepEqual(calls, [
    ["comments.queue", { queue: "reported" }, "a1"],
    ["comments.act", "p1", "c1", "approve", "a1"],
    ["comments.moderation", "a1"],
    ["comments.setModeration", { banned: ["x"], suspicious: [] }, "a1"],
  ]);
});

test("profiles are public, and say who is looking when a token is sent", async () => {
  calls.length = 0;
  const anon = await call("/api/members/ada_bikes");
  assert.equal(anon.status, 200);
  assert.equal(anon.body.username, "ada_bikes");
  const seen = await call("/api/members/ada_bikes", { token: "member" });
  assert.equal(seen.status, 200);
  const bad = await call("/api/members/ada_bikes", { token: "nope" });
  assert.equal(bad.status, 200);
  const unverified = await call("/api/members/ada_bikes", { token: "unverified" });
  assert.equal(unverified.status, 200);
  assert.equal((await call("/api/members/ada_bikes/posts?feed=pizza&page=2")).status, 200);
  assert.deepEqual(calls, [
    ["members.profile", "ada_bikes", null],
    ["members.profile", "ada_bikes", "u1"],
    ["members.profile", "ada_bikes", null],
    ["members.profile", "ada_bikes", null],
    ["members.posts", "ada_bikes", { feed: "pizza", page: "2" }],
  ]);
});

test("direct message routes reach the service with the caller", async () => {
  calls.length = 0;
  const post = (path, body, token = "member") => call(path, { token, method: "POST", body });
  assert.equal((await call("/api/me/threads", { token: "member" })).status, 200);
  assert.equal((await post("/api/me/threads", { username: "bob" })).status, 200);
  assert.equal((await call("/api/threads/t1/messages?before=2026-09-01T00:00:00.000Z", { token: "member" })).status, 200);
  assert.equal((await post("/api/threads/t1/messages", { text: "hi" })).status, 200);
  assert.equal((await call("/api/threads/t1/messages/m1", { token: "member", method: "PATCH", body: { text: "hey" } })).status, 200);
  assert.equal((await call("/api/threads/t1/messages/m1", { token: "member", method: "DELETE" })).status, 200);
  assert.equal((await post("/api/threads/t1/seen")).status, 200);
  assert.equal((await post("/api/threads/t1/report", { reason: "spam" })).status, 200);
  assert.equal((await post("/api/members/bob/block")).status, 200);
  assert.equal((await call("/api/members/bob/block", { token: "member", method: "DELETE" })).status, 200);
  assert.equal((await call("/api/me/blocks", { token: "member" })).status, 200);
  assert.deepEqual(calls, [
    ["threads.list", "u1"],
    ["threads.open", { username: "bob" }, "u1"],
    ["threads.messages", "t1", { before: "2026-09-01T00:00:00.000Z" }, "u1"],
    ["threads.send", "t1", { text: "hi" }, "u1"],
    ["threads.edit", "t1", "m1", { text: "hey" }, "u1"],
    ["threads.remove", "t1", "m1", "u1"],
    ["threads.seen", "t1", "u1"],
    ["threads.report", "t1", { reason: "spam" }, "u1"],
    ["threads.block", "bob", true, "u1"],
    ["threads.block", "bob", false, "u1"],
    ["threads.blocks", "u1"],
  ]);
  assert.equal((await call("/api/me/threads")).status, 401);
  assert.equal((await call("/api/me/threads", { token: "unverified" })).status, 409);
});

test("reported threads are for admins with a second factor", async () => {
  calls.length = 0;
  assert.equal((await call("/api/admin/threads", { token: "member" })).status, 403);
  assert.equal((await call("/api/admin/threads", { token: "admin" })).status, 403);
  assert.equal((await call("/api/admin/threads?queue=reported", { token: "admin2fa" })).status, 200);
  assert.equal((await call("/api/admin/threads/t1", { token: "admin2fa" })).status, 200);
  assert.deepEqual(calls, [
    ["threads.queue", { queue: "reported" }, "a1"],
    ["threads.get", "t1", "a1"],
  ]);
});

test("the continue-by-email routes reach the service", async () => {
  calls.length = 0;
  assert.equal((await call("/api/threads/t1/email", { token: "member", method: "POST" })).status, 200);
  assert.equal((await call("/api/threads/t1/email", { token: "member", method: "DELETE" })).status, 200);
  const agreed = await call("/api/threads/t1/email/agree", { token: "member", method: "POST" });
  assert.deepEqual([agreed.status, agreed.body], [200, { emailed: true, conversation: 2 }]);
  assert.deepEqual(calls, [
    ["threads.requestEmail", "t1", "u1"],
    ["threads.withdrawEmail", "t1", "u1"],
    ["threads.agreeEmail", "t1", "u1"],
  ]);
});


test("search is public, passes the query string through and is not cached", async () => {
  calls.length = 0;
  const res = await fetch(base + "/api/search?q=red%20trek&limit=5");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res.json(), { query: "red trek", members: [], titles: [], details: [], text: [] });
  assert.deepEqual(calls, [["search", { q: "red trek", limit: "5" }]]);
  const empty = await fetch(base + "/api/search");
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error.code, "invalid-argument");
});
