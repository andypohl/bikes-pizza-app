import assert from "node:assert/strict";
import { test } from "node:test";

import { ValidationError } from "./errors.js";
import { fakeMessaging, memoryDeviceStore, memoryMemberStore } from "./fakes.js";
import {
  MEMBER_CATEGORIES,
  commentMessage,
  commentRecipients,
  createPush,
  messageSentMessage,
  postPublishedMessage,
  postUpdatedMessage,
  preferences,
  registerDevice,
  removeDevice,
  topicFor,
  validateDevice,
  validatePreferences,
  wants,
} from "./push.js";

const ada = { uid: "u1", email: "ada@example.com", admin: false };

test("wants follows the member's setting, else the category's default", () => {
  assert.equal(wants(null, "messages"), true);
  assert.equal(wants({ notifications: { messages: false } }, "messages"), false);
  assert.equal(wants({ notifications: {} }, "comments"), true);
  assert.deepEqual(MEMBER_CATEGORIES, ["messages", "comments", "replies"]);
  assert.deepEqual(preferences({ notifications: { replies: false } }), { messages: true, comments: true, replies: false });
});

test("validatePreferences takes booleans for member categories only", () => {
  assert.deepEqual(validatePreferences({ messages: false, replies: true }), { messages: false, replies: true });
  assert.throws(() => validatePreferences({ newPosts: true }), ValidationError);
  assert.throws(() => validatePreferences({ messages: "no" }), ValidationError);
  assert.throws(() => validatePreferences([]), ValidationError);
});

test("validateDevice wants a token and a known platform", () => {
  assert.deepEqual(validateDevice({ token: "t".repeat(40), platform: "ios" }), { token: "t".repeat(40), platform: "ios" });
  assert.throws(() => validateDevice({ token: "short", platform: "ios" }), ValidationError);
  assert.throws(() => validateDevice({ token: "t".repeat(40), platform: "web" }), ValidationError);
});

test("topics are the contract's prefix plus the feed", () => {
  assert.equal(topicFor("newPosts", "bikes"), "new-posts-bikes");
  assert.equal(topicFor("updatedPosts", "pizza"), "updated-posts-pizza");
  assert.throws(() => topicFor("messages", "bikes"));
});

test("post broadcasts name the feed, the poster and the title", () => {
  const doc = { slug: "blue-bike", feed: "bikes", title: "Blue bike", credit: { username: "ada_bikes" } };
  assert.deepEqual(postPublishedMessage(doc), {
    topic: "new-posts-bikes",
    notification: { title: "New bike by ada_bikes", body: "Blue bike" },
    data: { type: "post", id: "blue-bike", feed: "bikes" },
  });
  const news = postPublishedMessage({ slug: "hello", feed: "news", title: "Hello", credit: null });
  assert.equal(news.notification.title, "New news post");
  assert.deepEqual(postUpdatedMessage(doc).notification, { title: "Updated bike", body: "Blue bike" });
  assert.equal(postUpdatedMessage(doc).topic, "updated-posts-bikes");
});

test("a message notifies the other member with the sender's name and a short preview", () => {
  const msg = messageSentMessage({ threadId: "t1", other: "u2", username: "ada_bikes", text: "x".repeat(200) });
  assert.equal(msg.uid, "u2");
  assert.equal(msg.category, "messages");
  assert.equal(msg.notification.title, "ada_bikes");
  assert.equal(msg.notification.body.length, 140);
  assert.ok(msg.notification.body.endsWith("…"));
  assert.deepEqual(msg.data, { type: "thread", id: "t1" });
});

test("comment recipients: the post's author, the thread, the mentioned; never the commenter, each once", () => {
  const post = { slug: "p", feed: "pizza", title: "Slice", credit: { uid: "author" } };
  const all = [
    { id: "c1", uid: "top", parentId: null, status: "published" },
    { id: "c2", uid: "r1", parentId: "c1", status: "published" },
    { id: "c3", uid: "r2", parentId: "c1", status: "hidden" },
    { id: "c4", uid: "author", parentId: "c1", status: "published" },
  ];
  // A reply by r1 mentioning "m1": author first (as comments), then top, then the mention.
  const reply = { id: "c5", uid: "r1", parentId: "c1", mentions: ["m1", "author"] };
  assert.deepEqual(commentRecipients({ post, comment: reply, all }), [
    { uid: "author", category: "comments" },
    { uid: "top", category: "replies" },
    { uid: "m1", category: "replies" },
  ]);
  // The author's own top-level comment tells nobody but the mentioned.
  assert.deepEqual(commentRecipients({ post, comment: { id: "c6", uid: "author", parentId: null, mentions: ["m1"] }, all }), [
    { uid: "m1", category: "replies" },
  ]);
});

test("comment messages are worded for the recipient", () => {
  const post = { slug: "p", feed: "pizza", title: "Slice" };
  const comment = { id: "c1", username: "bob", text: "Nice one" };
  assert.equal(commentMessage({ post, comment, category: "comments" }).notification.title, "bob commented on Slice");
  assert.equal(commentMessage({ post, comment, category: "replies" }).notification.title, "bob replied on Slice");
  assert.equal(commentMessage({ post, comment, category: "replies", mentioned: true }).notification.title, "bob mentioned you on Slice");
  assert.deepEqual(commentMessage({ post, comment, category: "comments" }).data, { type: "post", id: "p", feed: "pizza", comment: "c1" });
});

async function setup({ failing } = {}) {
  const messaging = fakeMessaging({ failing });
  const devices = memoryDeviceStore();
  const members = memoryMemberStore({ u2: { username: "bob", notifications: {} }, u3: { username: "cal", notifications: { messages: false } } });
  const logs = [];
  const push = createPush({ messaging, devices, members, log: (message, fields) => logs.push({ message, ...fields }) });
  return { messaging, devices, members, push, logs };
}

test("broadcasts go to the feed's topic with sound", async () => {
  const { messaging, push } = await setup();
  await push.postPublished({ slug: "s", feed: "bikes", title: "T", credit: null });
  assert.equal(messaging.sent[0].topic, "new-posts-bikes");
  assert.equal(messaging.sent[0].apns.payload.aps.sound, "default");
  assert.deepEqual(messaging.sent[0].data, { type: "post", id: "s", feed: "bikes" });
});

test("personal pushes go to the member's devices when their setting allows, and stale tokens are dropped", async () => {
  const { messaging, devices, push, logs } = await setup({ failing: new Set(["dead"]) });
  await devices.register("u2", { token: "dead", platform: "ios" }, "2026-09-25T00:00:00.000Z");
  await devices.register("u2", { token: "live".repeat(10), platform: "android" }, "2026-09-25T00:00:00.000Z");
  await push.messageSent({ threadId: "t1", other: "u2", username: "ada", text: "hi" });
  assert.deepEqual(messaging.sent[0].tokens, ["dead", "live".repeat(10)]);
  assert.deepEqual((await devices.list("u2")).map((d) => d.token), ["live".repeat(10)]);
  assert.equal(logs.at(-1).sent, 1);
  assert.equal(logs.at(-1).stale, 1);
  // cal turned messages off: nothing goes out, and no devices are needed.
  await push.messageSent({ threadId: "t1", other: "u3", username: "ada", text: "hi" });
  assert.equal(messaging.sent.length, 1);
  // Nobody registered: nothing goes out either.
  await push.messageSent({ threadId: "t1", other: "u9", username: "ada", text: "hi" });
  assert.equal(messaging.sent.length, 1);
});

test("a comment fans out to each recipient with their own wording", async () => {
  const { messaging, devices, push } = await setup();
  await devices.register("u2", { token: "b".repeat(30), platform: "ios" }, "x");
  const post = { slug: "p", feed: "pizza", title: "Slice", credit: { uid: "u2" } };
  const comment = { id: "c1", uid: "u1", username: "ada", text: "Yum", parentId: null, mentions: [] };
  await push.commentPublished({ post, comment, all: [comment] });
  assert.equal(messaging.sent.length, 1);
  assert.equal(messaging.sent[0].notification.title, "ada commented on Slice");
});

test("a sending failure is logged, not thrown", async () => {
  const { push, logs } = await setup();
  push.postPublished.messaging = null;
  const broken = createPush({ messaging: { send: async () => { throw new Error("boom"); } }, devices: memoryDeviceStore(), members: memoryMemberStore(), log: (m, f) => logs.push({ message: m, ...f }) });
  await broken.postPublished({ slug: "s", feed: "bikes", title: "T" });
  assert.equal(logs.at(-1).message, "push failed");
  assert.equal(logs.at(-1).error, "boom");
});

test("registering a device moves the token to this member; removing forgets it", async () => {
  const devices = memoryDeviceStore();
  const deps = { devices, now: () => new Date("2026-09-25T00:00:00.000Z") };
  const token = "t".repeat(40);
  await registerDevice({ token, platform: "ios" }, { uid: "old" }, deps);
  assert.deepEqual(await registerDevice({ token, platform: "ios" }, ada, deps), { registered: true });
  assert.deepEqual(await devices.list("old"), []);
  assert.equal((await devices.list("u1"))[0].updatedAt, "2026-09-25T00:00:00.000Z");
  await assert.rejects(registerDevice({ token: "x", platform: "ios" }, ada, deps), ValidationError);
  assert.deepEqual(await removeDevice(token, ada, deps), { removed: true });
  assert.deepEqual(await devices.list("u1"), []);
  await assert.rejects(removeDevice("", ada, deps), ValidationError);
});
