import assert from "node:assert/strict";
import { test } from "node:test";

import {
  REASONS,
  RULES,
  adminAct,
  adminQueue,
  createComment,
  deleteComment,
  deleteMemberData,
  editComment,
  exportMember,
  getModeration,
  listComments,
  listLikes,
  listNotices,
  listReplies,
  postCounts,
  purgeNotices,
  rateCheck,
  removal,
  reportComment,
  setModeration,
  threadPage,
  toggleLike,
  validateReason,
  withinEditWindow,
} from "./comments.js";
import { AppError, ValidationError } from "./errors.js";
import { memoryCommentStore, memoryMemberStore, memoryPostStore } from "./fakes.js";
import { postDocument } from "./post.js";

const ada = { uid: "u1", email: "ada@example.com", admin: false };
const bob = { uid: "u2", email: "bob@example.com", admin: false };
const cal = { uid: "u3", email: "cal@example.com", admin: false }; // posted the pizza
const dan = { uid: "u4", email: "dan@example.com", admin: false }; // no username yet
const admin = { uid: "a1", email: "admin@example.com", admin: true };

const pizza = postDocument({
  slug: "detroit-slice",
  feed: "pizza",
  title: "Detroit slice",
  publishedAt: "2026-09-01T12:00:00.000Z",
  body: "Good.",
  credit: { uid: "u3", username: "cal", name: "" },
});
const bike = postDocument({ slug: "gt-outpost", feed: "bikes", title: "GT Outpost", publishedAt: "2026-09-01T12:00:00.000Z", body: "Fast." });
const news = postDocument({ slug: "welcome", feed: "news", title: "Welcome", publishedAt: "2026-09-02T12:00:00.000Z", body: "Hi." });

/** A world with the three posts, four members and a controllable clock and screening. */
async function setup({ scores = {}, settings = { comments: true } } = {}) {
  const posts = memoryPostStore();
  for (const doc of [pizza, bike, news]) await posts.create(doc.slug, doc);
  const members = memoryMemberStore({
    u1: { username: "ada_bikes", email: "ada@example.com", newsletters: ["news"], createdAt: "2026-01-01T00:00:00.000Z" },
    u2: { username: "bob", email: "bob@example.com" },
    u3: { username: "cal", email: "cal@example.com" },
    u4: { username: "", email: "dan@example.com" },
    a1: { username: "admin", email: "admin@example.com" },
  });
  const comments = memoryCommentStore(posts, members);
  const clock = { at: new Date("2026-09-10T10:00:00.000Z") };
  let seq = 0;
  const logged = [];
  const screening = { scores };
  const deps = {
    posts,
    comments,
    members,
    settings: async () => settings,
    moderate: async () => ({ language: "en", scores: screening.scores }),
    newId: () => `c${++seq}`,
    now: () => clock.at,
    siteUrl: "https://bikes.pizza",
    log: (message, data) => logged.push([message, data]),
  };
  /** Moves the clock past the rate limit and returns the new time. */
  const tick = (ms = (RULES.rateLimit.seconds + 1) * 1000) => (clock.at = new Date(clock.at.getTime() + ms));
  const say = async (user, text, extra = {}) => {
    tick();
    return (await createComment("detroit-slice", { text, ...extra }, user, deps)).comment;
  };
  return { posts, members, comments, deps, clock, tick, say, screening, logged, settings };
}

const rejects = (promise, code, pattern) =>
  assert.rejects(promise, (e) => {
    assert.ok(e instanceof AppError, `expected AppError, got ${e?.constructor?.name}: ${e?.message}`);
    assert.equal(e.code, code);
    if (pattern) assert.match(e.message, pattern);
    return true;
  });

// ---- pure helpers -------------------------------------------------------------

test("postCounts counts published comments and keeps the newest times", () => {
  const comments = [
    { status: "published", createdAt: "2026-09-01T00:00:00.000Z" },
    { status: "pending", createdAt: "2026-09-02T00:00:00.000Z" },
    { status: "published", createdAt: "2026-09-03T00:00:00.000Z" },
    { status: "removed", createdAt: "2026-09-04T00:00:00.000Z" },
  ];
  assert.deepEqual(postCounts(comments), {
    commentCount: 2,
    commentedAt: "2026-09-03T00:00:00.000Z",
    commentTimes: ["2026-09-03T00:00:00.000Z", "2026-09-01T00:00:00.000Z"],
  });
  assert.deepEqual(postCounts([]), { commentCount: 0, commentedAt: null, commentTimes: [] });
  const many = Array.from({ length: 30 }, (_, i) => ({ status: "published", createdAt: `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }));
  assert.equal(postCounts(many).commentTimes.length, RULES.timesKept);
});

test("withinEditWindow and rateCheck follow the contract", () => {
  const at = new Date("2026-09-10T10:00:00.000Z");
  assert.equal(withinEditWindow("2026-09-10T09:55:01.000Z", at), true);
  assert.equal(withinEditWindow("2026-09-10T09:54:59.000Z", at), false);
  assert.deepEqual(rateCheck(null, at), { commentRate: { day: "2026-09-10", count: 1, lastAt: at.toISOString() } });
  assert.deepEqual(rateCheck({ commentRate: { day: "2026-09-09", count: 199, lastAt: "2026-09-09T23:00:00.000Z" } }, at).commentRate.count, 1);
  assert.throws(() => rateCheck({ commentRate: { day: "2026-09-10", count: 1, lastAt: "2026-09-10T09:59:50.000Z" } }, at), /wait/);
  assert.throws(() => rateCheck({ commentRate: { day: "2026-09-10", count: RULES.rateLimit.perDay, lastAt: "2026-09-10T09:00:00.000Z" } }, at), /limit/);
});

test("validateReason accepts the contract's reasons only", () => {
  for (const r of REASONS) assert.equal(validateReason(r), r);
  assert.throws(() => validateReason("rude"), ValidationError);
  assert.throws(() => validateReason(undefined), ValidationError);
});

test("threadPage pages top-level comments, nests replies and hides what the viewer may not see", () => {
  const c = (id, extra = {}) => ({ id, parentId: null, status: "published", createdAt: `2026-09-01T00:00:${id.padStart(2, "0")}.000Z`, uid: "u9", username: "x", html: "<p>x</p>", likedBy: [], ...extra });
  const all = [
    c("01"),
    c("02", { parentId: "01" }),
    c("03", { parentId: "01", status: "pending", uid: "u1" }),
    c("04", { parentId: "01", status: "pending", uid: "u2" }),
    c("05", { status: "removed" }),
    c("06", { status: "removed" }),
    c("07", { parentId: "06" }),
    c("08", { status: "hidden" }),
    c("09", { status: "pending", uid: "u1" }),
    c("10"),
    c("11", { parentId: "01" }),
    c("12", { parentId: "01" }),
    c("13", { parentId: "01" }),
  ];
  const page = threadPage(all, { viewer: ada, pageSize: 3 });
  assert.deepEqual(
    page.comments.map((x) => [x.id, x.status, x.replyCount, x.replies.map((r) => r.id)]),
    [
      ["01", "published", 5, ["02", "03", "11"]],
      ["06", "removed", 1, ["07"]],
      ["09", "pending", 0, []],
    ],
  );
  assert.equal(page.next, "09");
  assert.equal(page.comments[0].replies[1].hold, null);
  const rest = threadPage(all, { viewer: ada, pageSize: 3, after: "09" });
  assert.deepEqual(rest.comments.map((x) => x.id), ["10"]);
  assert.equal(rest.next, null);
  const other = threadPage(all, { viewer: bob, pageSize: 10 });
  assert.deepEqual(other.comments.map((x) => [x.id, x.replies.map((r) => r.id)]), [
    ["01", ["02", "04", "11"]],
    ["06", ["07"]],
    ["10", []],
  ]);
  assert.throws(() => threadPage(all, { viewer: ada, after: "nope" }), (e) => e.code === "not-found");
});

test("removal deletes replies and childless comments, and keeps a placeholder over published replies", () => {
  const top = { id: "t", parentId: null, status: "published", text: "x", html: "<p>x</p>", mentions: ["u2"], likedBy: ["u2"], reportCount: 1 };
  const reply = { id: "r", parentId: "t", status: "published" };
  const pendingReply = { id: "p", parentId: "t", status: "pending" };
  assert.deepEqual(removal([top, reply], reply, "author"), { r: null });
  assert.deepEqual(removal([top, pendingReply], top, "admin"), { t: null, p: null });
  const kept = removal([top, reply], top, "postAuthor");
  assert.equal(kept.t.status, "removed");
  assert.deepEqual([kept.t.removedBy, kept.t.text, kept.t.html, kept.t.mentions, kept.t.likedBy, kept.t.reportCount], ["postAuthor", "", "", [], [], 0]);
});

// ---- reading ------------------------------------------------------------------

test("listing needs a published gallery post with comments switched on", async () => {
  const { deps, settings } = await setup();
  assert.deepEqual(await listComments("detroit-slice", {}, ada, deps), { count: 0, comments: [], next: null });
  await rejects(listComments("welcome", {}, ada, deps), "failed-precondition", /no comments/);
  await rejects(listComments("nope", {}, ada, deps), "not-found");
  await assert.rejects(listComments("Bad Slug", {}, ada, deps), ValidationError);
  await deps.posts.patch("detroit-slice", { commentsEnabled: false });
  await rejects(listComments("detroit-slice", {}, ada, deps), "failed-precondition", /off for this post/);
  await deps.posts.patch("detroit-slice", { commentsEnabled: true });
  settings.comments = false;
  await rejects(listComments("detroit-slice", {}, ada, deps), "failed-precondition", /off for now/);
});

// ---- writing ------------------------------------------------------------------

test("a comment is rendered, published, counted on the post and its mentions get notices", async () => {
  const { deps, say, comments, posts, logged } = await setup();
  const first = await say(ada, "Great slice, @bob and @Cal! https://x.y/z");
  assert.equal(first.id, "c1");
  assert.deepEqual([first.username, first.status, first.mine, first.parentId, first.likeCount, first.liked, first.replyCount], ["ada_bikes", "published", true, null, 0, false, 0]);
  assert.equal(first.text, "Great slice, @bob and @Cal! [[link](https://x.y/z)]");
  assert.match(first.html, /<strong>@bob<\/strong> and <strong>@cal<\/strong>/);
  const post = await posts.get("detroit-slice");
  assert.equal(post.commentCount, 1);
  assert.equal(post.commentedAt, first.createdAt);
  assert.deepEqual(post.commentTimes, [first.createdAt]);
  assert.equal(post.changedAt, pizza.changedAt);
  assert.deepEqual(
    (await comments.listNotices("u2")).map((n) => [n.kind, n.post, n.comment]),
    [["mention", "detroit-slice", "c1"]],
  );
  assert.equal((await comments.listNotices("u3")).length, 1);
  assert.equal((await comments.listNotices("u1")).length, 0);
  assert.deepEqual(logged.at(-1)[0], "comment written");
  const listed = await listComments("detroit-slice", {}, bob, deps);
  assert.equal(listed.count, 1);
  assert.equal(listed.comments[0].mine, false);
  assert.equal("text" in listed.comments[0], false);
});

test("replies hang under the top-level comment, even when written to a reply", async () => {
  const { deps, say, posts } = await setup();
  const top = await say(ada, "First");
  const reply = await say(bob, "Second", { parentId: top.id });
  assert.equal(reply.parentId, top.id);
  const nested = await say(cal, "Third", { parentId: reply.id });
  assert.equal(nested.parentId, top.id);
  const listed = await listComments("detroit-slice", {}, ada, deps);
  assert.deepEqual(listed.comments.map((c) => [c.id, c.replyCount, c.replies.map((r) => r.id)]), [[top.id, 2, [reply.id, nested.id]]]);
  assert.equal((await posts.get("detroit-slice")).commentCount, 3);
  assert.deepEqual((await listReplies("detroit-slice", top.id, ada, deps)).replies.map((r) => r.id), [reply.id, nested.id]);
  await rejects(listReplies("detroit-slice", reply.id, ada, deps), "not-found");
  await rejects(say(ada, "Nope", { parentId: "missing" }), "not-found");
});

test("writing needs a username, some text and a breather between comments", async () => {
  const { deps, say, tick } = await setup();
  await rejects(say(dan, "Hi"), "failed-precondition", /username/);
  await assert.rejects(say(ada, ""), ValidationError);
  await assert.rejects(createComment("detroit-slice", null, ada, deps), ValidationError);
  await say(ada, "One");
  tick(1000);
  await rejects(createComment("detroit-slice", { text: "Two" }, ada, deps), "failed-precondition", /wait/);
  await say(bob, "Bob is not held up by Ada");
});

test("screening blocks or holds a comment; a held one is visible only to its author and not counted", async () => {
  const { deps, say, screening, posts, comments } = await setup();
  screening.scores = { Toxic: 0.95 };
  await rejects(say(ada, "awful"), "invalid-argument", /can't be posted/);
  await comments.setModeration({ banned: ["nasty"], suspicious: ["election"] });
  screening.scores = {};
  await rejects(say(ada, "you NASTY thing"), "invalid-argument");
  screening.scores = { Politics: 0.6 };
  const held = await say(ada, "About the mayor @bob");
  assert.deepEqual([held.status, held.hold], ["pending", "screen"]);
  screening.scores = {};
  const words = await say(bob, "the election");
  assert.deepEqual([words.status, words.hold], ["pending", "words"]);
  assert.equal((await posts.get("detroit-slice")).commentCount, 0);
  assert.equal((await comments.listNotices("u2")).length, 0);
  const mine = await listComments("detroit-slice", {}, ada, deps);
  assert.deepEqual(mine.comments.map((c) => [c.id, c.status, c.hold]), [[held.id, "pending", "screen"]]);
  const theirs = await listComments("detroit-slice", {}, cal, deps);
  assert.deepEqual(theirs.comments, []);
  await rejects(say(cal, "reply to held", { parentId: held.id }), "not-found");
});

test("the author can edit within the window; the edit is screened again", async () => {
  const { deps, say, tick, screening, posts, comments, clock } = await setup();
  const c = await say(ada, "Hello @bob");
  tick(60 * 1000);
  await rejects(editComment("detroit-slice", c.id, { text: "Nope" }, bob, deps), "permission-denied");
  const edited = (await editComment("detroit-slice", c.id, { text: "Hello @bob and @cal" }, ada, deps)).comment;
  assert.equal(edited.editedAt, clock.at.toISOString());
  assert.equal(edited.text, "Hello @bob and @cal");
  assert.equal((await comments.listNotices("u3")).length, 1);
  assert.equal((await comments.listNotices("u2")).length, 1);
  screening.scores = { Insult: 0.6 };
  const held = (await editComment("detroit-slice", c.id, { text: "Hello @bob, you goose" }, ada, deps)).comment;
  assert.equal(held.status, "pending");
  assert.equal((await posts.get("detroit-slice")).commentCount, 0);
  screening.scores = {};
  const back = (await editComment("detroit-slice", c.id, { text: "Hello @bob" }, ada, deps)).comment;
  assert.equal(back.status, "published");
  assert.equal((await posts.get("detroit-slice")).commentCount, 1);
  tick(RULES.editWindowMinutes * 60 * 1000);
  await rejects(editComment("detroit-slice", c.id, { text: "Too late" }, ada, deps), "failed-precondition", /minutes/);
});

test("deleting: the author, the post's author or an admin; replies vanish, a parent with replies leaves its place", async () => {
  const { deps, say, posts, comments } = await setup();
  const top = await say(ada, "Top");
  const reply = await say(bob, "Reply", { parentId: top.id });
  await rejects(deleteComment("detroit-slice", reply.id, ada, deps), "permission-denied");
  await rejects(deleteComment("detroit-slice", top.id, { ...admin, admin: false }, deps), "permission-denied");
  assert.deepEqual(await deleteComment("detroit-slice", top.id, cal, deps), { removed: top.id, by: "postAuthor" });
  let listed = await listComments("detroit-slice", {}, ada, deps);
  assert.deepEqual(listed.comments.map((c) => [c.id, c.removed, c.username, c.html, c.replies.length]), [[top.id, true, null, "", 1]]);
  assert.equal((await posts.get("detroit-slice")).commentCount, 1);
  assert.deepEqual(await deleteComment("detroit-slice", reply.id, admin, deps), { removed: reply.id, by: "admin" });
  listed = await listComments("detroit-slice", {}, ada, deps);
  assert.deepEqual(listed.comments, []);
  assert.equal((await comments.all("detroit-slice")).length, 1); // the placeholder stays until nothing hangs off it
  const alone = await say(bob, "Alone");
  assert.deepEqual(await deleteComment("detroit-slice", alone.id, bob, deps), { removed: alone.id, by: "author" });
  assert.equal((await comments.all("detroit-slice")).length, 1);
  await rejects(deleteComment("detroit-slice", alone.id, bob, deps), "not-found");
  assert.equal((await posts.get("detroit-slice")).commentCount, 0);
});

test("likes toggle, are listed by username and only apply to published comments", async () => {
  const { deps, say, comments, screening } = await setup();
  const c = await say(ada, "Likeable");
  assert.deepEqual(await toggleLike("detroit-slice", c.id, bob, deps), { liked: true, likeCount: 1 });
  assert.deepEqual(await toggleLike("detroit-slice", c.id, cal, deps), { liked: true, likeCount: 2 });
  const listed = await listComments("detroit-slice", {}, bob, deps);
  assert.deepEqual([listed.comments[0].likeCount, listed.comments[0].liked], [2, true]);
  assert.deepEqual((await listLikes("detroit-slice", c.id, ada, deps)).likes.map((l) => l.username), ["bob", "cal"]);
  assert.deepEqual(await toggleLike("detroit-slice", c.id, bob, deps), { liked: false, likeCount: 1 });
  assert.equal((await comments.likes("detroit-slice", c.id)).length, 1);
  await rejects(toggleLike("detroit-slice", c.id, dan, deps), "failed-precondition", /username/);
  screening.scores = { Politics: 0.7 };
  const held = await say(ada, "Held");
  await rejects(toggleLike("detroit-slice", held.id, bob, deps), "not-found");
  await rejects(listLikes("detroit-slice", held.id, bob, deps), "not-found");
});

test("two reports hide a comment; an admin can approve it back or remove it", async () => {
  const { deps, say, posts, comments } = await setup();
  const c = await say(ada, "Edgy");
  await assert.rejects(reportComment("detroit-slice", c.id, { reason: "rude" }, bob, deps), ValidationError);
  await rejects(reportComment("detroit-slice", c.id, { reason: "spam" }, ada, deps), "failed-precondition", /own/);
  assert.deepEqual(await reportComment("detroit-slice", c.id, { reason: "spam" }, bob, deps), { reported: true, hidden: false });
  await rejects(reportComment("detroit-slice", c.id, { reason: "spam" }, bob, deps), "failed-precondition", /already/);
  assert.deepEqual(await reportComment("detroit-slice", c.id, { reason: "politics" }, cal, deps), { reported: true, hidden: true });
  assert.deepEqual((await listComments("detroit-slice", {}, ada, deps)).comments, []);
  assert.equal((await posts.get("detroit-slice")).commentCount, 0);
  const reported = await adminQueue({ queue: "reported" }, admin, deps);
  assert.deepEqual(
    reported.comments.map((x) => [x.id, x.status, x.reportCount, x.reports, x.post.id, x.post.url, x.text]),
    [[c.id, "hidden", 2, ["spam", "politics"], "detroit-slice", "https://bikes.pizza/post/detroit-slice/", "Edgy"]],
  );
  const approved = (await adminAct("detroit-slice", c.id, "approve", admin, deps)).comment;
  assert.deepEqual([approved.status, approved.reportCount], ["published", 0]);
  assert.equal((await comments.reports("detroit-slice", c.id)).length, 0);
  assert.equal((await posts.get("detroit-slice")).commentCount, 1);
  await rejects(adminAct("detroit-slice", c.id, "approve", admin, deps), "failed-precondition");
  const removed = (await adminAct("detroit-slice", c.id, "remove", admin, deps)).comment;
  assert.equal(removed.removed, true);
  await assert.rejects(adminAct("detroit-slice", c.id, "explode", admin, deps), ValidationError);
});

test("the pending queue lists held comments; approving one publishes it and sends its notices", async () => {
  const { deps, say, screening, comments, posts } = await setup();
  screening.scores = { Politics: 0.9 };
  const held = await say(ada, "Vote for @bob");
  screening.scores = {};
  await say(cal, "Fine");
  const pending = await adminQueue({ queue: "pending" }, admin, deps);
  assert.deepEqual(pending.comments.map((x) => [x.id, x.hold, x.screening.reasons, x.mentions]), [[held.id, "screen", ["Politics"], ["u2"]]]);
  const recent = await adminQueue({ queue: "recent" }, admin, deps);
  assert.deepEqual(recent.comments.map((x) => x.id), ["c2"]);
  await assert.rejects(adminQueue({ queue: "odd" }, admin, deps), ValidationError);
  assert.equal((await comments.listNotices("u2")).length, 0);
  await adminAct("detroit-slice", held.id, "approve", admin, deps);
  assert.equal((await comments.listNotices("u2")).length, 1);
  assert.equal((await posts.get("detroit-slice")).commentCount, 2);
});

test("the moderation lists are validated and normalised", async () => {
  const { deps } = await setup();
  assert.deepEqual(await getModeration(deps), { banned: [], suspicious: [] });
  const saved = await setModeration({ banned: [" Foo ", "foo", "bar baz"], suspicious: ["Politics"] }, admin, deps);
  assert.deepEqual(saved, { banned: ["foo", "bar baz"], suspicious: ["politics"] });
  assert.deepEqual(await getModeration(deps), saved);
  await assert.rejects(setModeration({ banned: "foo", suspicious: [] }, admin, deps), ValidationError);
  await assert.rejects(setModeration({ banned: [1], suspicious: [] }, admin, deps), ValidationError);
  await assert.rejects(setModeration({ banned: ["x".repeat(41)], suspicious: [] }, admin, deps), ValidationError);
  await assert.rejects(setModeration(null, admin, deps), ValidationError);
});

test("notices are listed from a time and purged after sixty days", async () => {
  const { deps, say, comments, clock } = await setup();
  await say(ada, "@bob one");
  const first = clock.at.toISOString();
  await say(ada, "@bob two");
  const all = await listNotices(bob, {}, deps);
  assert.deepEqual(all.notices.map((n) => [n.kind, n.post, n.comment]), [["mention", "detroit-slice", "c1"], ["mention", "detroit-slice", "c2"]]);
  const later = await listNotices(bob, { since: first }, deps);
  assert.deepEqual(later.notices.map((n) => n.comment), ["c2"]);
  await assert.rejects(listNotices(bob, { since: "yesterday" }, deps), ValidationError);
  clock.at = new Date(clock.at.getTime() + 61 * 24 * 60 * 60 * 1000);
  assert.equal(await purgeNotices({ comments, now: () => clock.at }), 2);
  assert.deepEqual((await listNotices(bob, {}, deps)).notices, []);
});

test("a member's export gathers their record, posts, comments, likes and reactions", async () => {
  const { deps, say, posts } = await setup();
  const c = await say(ada, "Mine");
  const other = await say(bob, "Theirs");
  await toggleLike("detroit-slice", other.id, ada, deps);
  await posts.setReaction("detroit-slice", "u1", { had: ["yes"] }, { username: "ada_bikes" });
  await posts.create("ada-pie", postDocument({ ...pizza, slug: "ada-pie", title: "Ada's pie", credit: { uid: "u1", username: "ada_bikes", name: "" } }));
  const out = await exportMember(ada, deps);
  assert.equal(out.member.username, "ada_bikes");
  assert.deepEqual(out.posts.map((p) => [p.id, p.url]), [["ada-pie", "https://bikes.pizza/post/ada-pie/"]]);
  assert.deepEqual(out.comments.map((x) => [x.post, x.id, x.text]), [["detroit-slice", c.id, "Mine"]]);
  assert.deepEqual(out.likes.map((l) => [l.post, l.comment]), [["detroit-slice", other.id]]);
  assert.deepEqual(out.reactions.map((r) => [r.post, r.picks]), [["detroit-slice", { had: ["yes"] }]]);
});

test("deleting a member removes their comments, likes, reports, reactions and notices", async () => {
  const { deps, say, posts, comments } = await setup();
  const top = await say(ada, "Top by ada");
  const reply = await say(bob, "Reply by bob", { parentId: top.id });
  const bobs = await say(bob, "Bob alone @ada_bikes");
  await toggleLike("detroit-slice", bobs.id, ada, deps);
  await reportComment("detroit-slice", bobs.id, { reason: "spam" }, ada, deps);
  await posts.setReaction("detroit-slice", "u1", { had: ["yes"] }, { username: "ada_bikes" });
  const removed = await deleteMemberData("u1", deps);
  assert.deepEqual(removed, { comments: 1, likes: 1, reports: 1, reactions: 1 });
  const listed = await listComments("detroit-slice", {}, cal, deps);
  assert.deepEqual(listed.comments.map((c) => [c.id, c.removed, c.replies.map((r) => r.id), c.likeCount]), [
    [top.id, true, [reply.id], 0],
    [bobs.id, false, [], 0],
  ]);
  const stored = (await comments.all("detroit-slice")).find((c) => c.id === bobs.id);
  assert.deepEqual([stored.reportCount, stored.likedBy], [0, []]);
  assert.equal((await comments.reports("detroit-slice", bobs.id)).length, 0);
  assert.equal((await comments.listNotices("u1")).length, 0);
  assert.deepEqual((await posts.get("detroit-slice")).reactions, { had: { yes: 0 } });
  assert.equal((await posts.get("detroit-slice")).commentCount, 2);
});

test("a member who blocked another does not see their comments", async () => {
  const { deps, say } = await setup();
  const top = await say(bob, "Bob's take");
  await say(cal, "Cal replies", { parentId: top.id });
  await say(ada, "Ada too", { parentId: top.id });
  const blocks = async (uid) => (uid === "u1" ? ["u2"] : []);
  const seen = await listComments("detroit-slice", {}, ada, { ...deps, blocks });
  assert.deepEqual(seen.comments, []); // bob's top-level comment, and so its replies, gone from ada's view
  const others = await listComments("detroit-slice", {}, cal, { ...deps, blocks });
  assert.deepEqual(others.comments.map((c) => [c.id, c.replies.length]), [[top.id, 2]]);
  const calTop = await say(cal, "Cal's own");
  await say(bob, "Bob replies", { parentId: calTop.id });
  const filtered = await listReplies("detroit-slice", calTop.id, ada, { ...deps, blocks });
  assert.deepEqual(filtered.replies, []);
  const failing = await listComments("detroit-slice", {}, ada, { ...deps, blocks: async () => { throw new Error("down"); } });
  assert.equal(failing.comments.length, 2, "a failed blocks lookup hides nothing");
});
