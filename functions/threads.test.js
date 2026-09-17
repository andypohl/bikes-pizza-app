import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError, ValidationError } from "./errors.js";
import { memoryMemberStore, memoryThreadStore } from "./fakes.js";
import {
  PAGE_SIZE,
  REFUSED_MESSAGE,
  RULES,
  adminThread,
  adminThreads,
  agreeEmail,
  deleteMemberThreads,
  deleteMessage,
  editMessage,
  exportMessages,
  listBlocks,
  listMessages,
  listThreads,
  markSeen,
  newThreadCheck,
  openThread,
  preview,
  publicMessage,
  publicThread,
  rateCheck,
  reportThread,
  requestEmail,
  sendMessage,
  setBlock,
  withdrawEmail,
} from "./threads.js";

const ada = { uid: "u1", email: "ada@example.com", admin: false };
const bob = { uid: "u2", email: "bob@example.com", admin: false };
const cal = { uid: "u3", email: "cal@example.com", admin: false };
const dan = { uid: "u4", email: "dan@example.com", admin: false };
const admin = { uid: "a1", email: "admin@example.com", admin: true };

async function setup({ scores = {} } = {}) {
  const members = memoryMemberStore({
    u1: { username: "ada_bikes", email: "ada@example.com" },
    u2: { username: "bob", email: "bob@example.com" },
    u3: { username: "cal", email: "cal@example.com", messages: false },
    u4: { username: "", email: "dan@example.com" },
  });
  const threads = memoryThreadStore(members);
  const clock = { at: new Date("2026-09-10T10:00:00.000Z") };
  const screening = { scores };
  const logged = [];
  let moderation = { banned: [], suspicious: [] };
  const deps = {
    threads,
    members,
    comments: { getModeration: async () => moderation },
    moderate: async () => ({ language: "en", scores: screening.scores }),
    now: () => clock.at,
    log: (m, d) => logged.push([m, d]),
  };
  const tick = (ms = (RULES.rateLimit.seconds + 1) * 1000) => (clock.at = new Date(clock.at.getTime() + ms));
  const say = async (id, user, text) => {
    tick();
    return (await sendMessage(id, { text }, user, deps)).message;
  };
  const setBanned = (words) => (moderation = { ...moderation, banned: words });
  return { threads, members, deps, clock, tick, say, screening, logged, setBanned };
}

const rejects = (promise, code, pattern) =>
  assert.rejects(promise, (e) => {
    assert.ok(e instanceof AppError, `expected AppError, got ${e?.constructor?.name}: ${e?.message}`);
    assert.equal(e.code, code);
    if (pattern) assert.match(e.message, pattern);
    return true;
  });

test("publicThread shows each member the other side, their own unread count and the state", () => {
  const doc = {
    id: "u1_u2",
    members: ["u1", "u2"],
    usernames: { u1: "ada_bikes", u2: "bob" },
    unread: { u1: 2, u2: 0 },
    last: { uid: "u2", text: "hi", at: "2026-09-10T10:00:00.000Z" },
    lastMessageAt: "2026-09-10T10:00:00.000Z",
    blockedBy: ["u2"],
  };
  const mine = publicThread(doc, "u1");
  assert.deepEqual(mine.other, { uid: "u2", username: "bob" });
  assert.equal(mine.unread, 2);
  assert.equal(mine.blocked, true);
  assert.equal(mine.blockedByMe, false);
  assert.equal(mine.conversation, 1);
  const theirs = publicThread(doc, "u2");
  assert.equal(theirs.other.username, "ada_bikes");
  assert.equal(theirs.unread, 0);
  assert.equal(theirs.blockedByMe, true);
  assert.equal(publicThread({ id: "x", members: ["u1"], gone: true }, "u1").gone, true);
});

test("publicMessage clears deleted messages and passes events through", () => {
  const m = publicMessage({ id: "m1", kind: "message", uid: "u1", text: "hi", html: "<p>hi</p>", createdAt: "t", deletedAt: "t2" });
  assert.deepEqual([m.deleted, m.text, m.html], [true, "", ""]);
  const e = publicMessage({ id: "e1", kind: "event", event: "blocked", by: "u1", at: "t" });
  assert.deepEqual(e, { id: "e1", kind: "event", event: "blocked", by: "u1", at: "t", conversation: 1 });
});

test("rateCheck and newThreadCheck follow the contract; preview cuts the text", () => {
  const at = new Date("2026-09-10T10:00:00.000Z");
  assert.deepEqual(rateCheck(null, at), { messageRate: { day: "2026-09-10", count: 1, threads: 0, lastAt: at.toISOString() } });
  assert.throws(() => rateCheck({ messageRate: { day: "2026-09-10", count: 1, lastAt: "2026-09-10T09:59:59.500Z" } }, at), /wait/);
  assert.throws(() => rateCheck({ messageRate: { day: "2026-09-10", count: RULES.rateLimit.perDay, lastAt: "2026-09-10T09:00:00.000Z" } }, at), /limit/);
  assert.equal(newThreadCheck({ messageRate: { day: "2026-09-10", count: 3, threads: 2, lastAt: "x" } }, at).messageRate.threads, 3);
  assert.equal(newThreadCheck({ messageRate: { day: "2026-09-09", threads: 19 } }, at).messageRate.threads, 1);
  assert.throws(() => newThreadCheck({ messageRate: { day: "2026-09-10", threads: RULES.rateLimit.newThreadsPerDay } }, at), /as many conversations/);
  assert.equal(preview("<p>short <strong>one</strong></p>"), "short one");
  assert.equal(preview(`<p>${"x".repeat(200)}</p>`).length, RULES.previewLength);
});

test("opening a thread needs usernames on both sides, the other's consent, and no blocks", async () => {
  const { deps, threads } = await setup();
  await assert.rejects(openThread({}, ada, deps), ValidationError);
  await rejects(openThread({ username: "nobody" }, ada, deps), "not-found");
  await rejects(openThread({ username: "ada_bikes" }, ada, deps), "failed-precondition", /you/);
  await rejects(openThread({ username: "bob" }, dan, deps), "failed-precondition", /username/);
  await rejects(openThread({ username: "cal" }, ada, deps), "permission-denied", /isn't taking messages/);
  const opened = await openThread({ username: "Bob" }, ada, deps);
  assert.equal(opened.created, true);
  assert.equal(opened.thread.id, "u1_u2");
  assert.deepEqual(opened.thread.other, { uid: "u2", username: "bob" });
  assert.equal(opened.thread.unread, 0);
  const again = await openThread({ username: "ada_bikes" }, bob, deps);
  assert.equal(again.created, false);
  assert.equal(again.thread.id, "u1_u2");
  assert.equal((await threads.get("u1_u2")).usernames.u2, "bob");
  await setBlock("ada_bikes", true, bob, deps);
  await rejects(openThread({ username: "cal" }, bob, deps), "permission-denied"); // cal has messages off
  const { members } = deps;
  await members.set("u3", { messages: true });
  await setBlock("cal", true, ada, deps);
  await rejects(openThread({ username: "cal" }, ada, deps), "permission-denied", /can't message/);
  await rejects(openThread({ username: "ada_bikes" }, cal, deps), "permission-denied", /can't message/);
});

test("the new-thread limit counts per day", async () => {
  const { deps, members } = await setup();
  await members.set("u1", { messageRate: { day: "2026-09-10", threads: RULES.rateLimit.newThreadsPerDay } });
  await rejects(openThread({ username: "bob" }, ada, deps), "failed-precondition", /as many conversations/);
});

test("messages are rendered, screened, counted unread for the other side and previewed", async () => {
  const { deps, say, threads, logged, screening, setBanned } = await setup();
  await openThread({ username: "bob" }, ada, deps);
  const first = await say("u1_u2", ada, "Hi **bob**, see https://a.b/c");
  assert.equal(first.kind, "message");
  assert.equal(first.uid, "u1");
  assert.match(first.html, /<strong>bob<\/strong>/);
  assert.match(first.html, /\[<a href="https:\/\/a.b\/c"/);
  assert.equal(first.conversation, 1);
  let thread = await threads.get("u1_u2");
  assert.deepEqual(thread.unread, { u1: 0, u2: 1 });
  assert.equal(thread.last.uid, "u1");
  assert.equal(thread.last.text, "Hi bob, see [link]");
  assert.equal(thread.lastMessageAt, first.createdAt);
  assert.equal(logged.at(-1)[0], "message sent");

  // Bob reads and replies; ada's count moves.
  await markSeen("u1_u2", bob, deps);
  assert.equal((await threads.get("u1_u2")).unread.u2, 0);
  await say("u1_u2", bob, "Hello!");
  thread = await threads.get("u1_u2");
  assert.deepEqual(thread.unread, { u1: 1, u2: 0 });

  // Refused text.
  screening.scores = { Toxic: 0.9 };
  await rejects(say("u1_u2", ada, "awful"), "invalid-argument", new RegExp(REFUSED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  screening.scores = { Politics: 0.9 };
  const political = await say("u1_u2", ada, "the mayor"); // held categories pass in messages
  assert.equal(political.kind, "message");
  setBanned(["nasty"]);
  await rejects(say("u1_u2", ada, "you nasty"), "invalid-argument");
  await assert.rejects(say("u1_u2", ada, "x".repeat(RULES.maxLength + 1)), ValidationError);
  await assert.rejects(say("u1_u2", ada, ""), ValidationError);

  // Outsiders and unknown threads.
  await rejects(say("u1_u2", cal, "hi"), "not-found");
  await rejects(say("u1_u9", ada, "hi"), "not-found");

  // The rate limit between messages.
  await say("u1_u2", ada, "one");
  await rejects(sendMessage("u1_u2", { text: "two" }, ada, deps), "failed-precondition", /wait/);
});

test("a screening outage lets a message through, logged", async () => {
  const { deps, say, logged } = await setup();
  deps.moderate = async () => {
    throw new Error("down");
  };
  await openThread({ username: "bob" }, ada, deps);
  const m = await say("u1_u2", ada, "still here");
  assert.equal(m.kind, "message");
  assert.ok(logged.some(([message]) => /screening failed/.test(message)));
});

test("messages page newest first, and the list shows each member's threads", async () => {
  const { deps, say, tick } = await setup();
  await openThread({ username: "bob" }, ada, deps);
  for (let i = 0; i < PAGE_SIZE + 2; i += 1) await say("u1_u2", i % 2 ? bob : ada, `message ${i}`);
  const page = await listMessages("u1_u2", {}, ada, deps);
  assert.equal(page.messages.length, PAGE_SIZE);
  assert.equal(page.more, true);
  assert.equal(page.messages[0].text, `message ${PAGE_SIZE + 1}`);
  assert.equal(page.thread.id, "u1_u2");
  const older = await listMessages("u1_u2", { before: page.messages.at(-1).createdAt }, ada, deps);
  assert.deepEqual(older.messages.map((m) => m.text), ["message 1", "message 0"]);
  assert.equal(older.more, false);
  await assert.rejects(listMessages("u1_u2", { before: "yesterday" }, ada, deps), ValidationError);
  await rejects(listMessages("u1_u2", {}, cal, deps), "not-found");

  tick();
  await openThread({ username: "ada_bikes" }, bob, deps);
  const { members } = deps;
  await members.set("u3", { messages: true });
  await openThread({ username: "cal" }, ada, deps);
  tick();
  await say("u1_u3", ada, "hey cal");
  const mine = await listThreads(ada, deps);
  assert.deepEqual(mine.threads.map((t) => [t.id, t.other.username, t.unread]), [
    ["u1_u3", "cal", 0],
    ["u1_u2", "bob", 26],
  ]);
  const cals = await listThreads(cal, deps);
  assert.deepEqual(cals.threads.map((t) => [t.id, t.unread, t.last.text]), [["u1_u3", 1, "hey cal"]]);
});

test("the author can edit for five minutes and delete any time; the preview follows", async () => {
  const { deps, say, tick, threads } = await setup();
  await openThread({ username: "bob" }, ada, deps);
  const m = await say("u1_u2", ada, "Hello wrld");
  await rejects(editMessage("u1_u2", m.id, { text: "Nope" }, bob, deps), "not-found");
  tick(60 * 1000);
  const edited = (await editMessage("u1_u2", m.id, { text: "Hello world" }, ada, deps)).message;
  assert.equal(edited.text, "Hello world");
  assert.equal(edited.editedAt, deps.now().toISOString());
  assert.equal((await threads.get("u1_u2")).last.text, "Hello world");
  tick(RULES.editWindowMinutes * 60 * 1000);
  await rejects(editMessage("u1_u2", m.id, { text: "Too late" }, ada, deps), "failed-precondition", /minutes/);
  await rejects(deleteMessage("u1_u2", m.id, bob, deps), "not-found");
  assert.deepEqual(await deleteMessage("u1_u2", m.id, ada, deps), { deleted: m.id });
  const page = await listMessages("u1_u2", {}, bob, deps);
  assert.deepEqual([page.messages[0].deleted, page.messages[0].text, page.messages[0].html], [true, "", ""]);
  assert.equal((await threads.get("u1_u2")).last.text, "");
  await rejects(editMessage("u1_u2", m.id, { text: "back" }, ada, deps), "failed-precondition", /deleted/);
});

test("blocking freezes the thread with an event, and unblocking reopens it", async () => {
  const { deps, say, threads } = await setup();
  await openThread({ username: "bob" }, ada, deps);
  await say("u1_u2", ada, "hi");
  assert.deepEqual(await setBlock("Bob", true, ada, deps), { blocked: true, username: "bob" });
  assert.deepEqual((await threads.get("u1_u2")).blockedBy, ["u1"]);
  await rejects(say("u1_u2", bob, "please"), "permission-denied", /closed/);
  await rejects(say("u1_u2", ada, "no"), "permission-denied");
  const page = await listMessages("u1_u2", {}, bob, deps);
  assert.deepEqual([page.messages[0].kind, page.messages[0].event, page.messages[0].by], ["event", "blocked", "u1"]);
  assert.equal(page.thread.blocked, true);
  assert.deepEqual((await listBlocks(ada, deps)).blocked, [{ uid: "u2", username: "bob" }]);
  assert.deepEqual(await setBlock("bob", false, ada, deps), { blocked: false, username: "bob" });
  assert.deepEqual((await threads.get("u1_u2")).blockedBy, []);
  await say("u1_u2", bob, "thanks");
  assert.deepEqual((await listBlocks(ada, deps)).blocked, []);
  await rejects(setBlock("nobody", true, ada, deps), "not-found");
  await rejects(setBlock("ada_bikes", true, ada, deps), "failed-precondition");
  // A block with no thread yet just records the block.
  await setBlock("cal", true, bob, deps);
  assert.deepEqual((await listBlocks(bob, deps)).blocked.map((b) => b.username), ["cal"]);
});

test("a report lets admins read the thread; unreported threads stay private", async () => {
  const { deps, say, threads } = await setup();
  await openThread({ username: "bob" }, ada, deps);
  await say("u1_u2", ada, "hi");
  await say("u1_u2", bob, "rude thing");
  await rejects(adminThread("u1_u2", admin, deps), "permission-denied");
  assert.deepEqual((await adminThreads({}, admin, deps)).threads, []);
  await assert.rejects(reportThread("u1_u2", { reason: "meh" }, ada, deps), ValidationError);
  await rejects(reportThread("u1_u2", { reason: "harassment" }, cal, deps), "not-found");
  assert.deepEqual(await reportThread("u1_u2", { reason: "harassment" }, ada, deps), { reported: true });
  const t = await threads.get("u1_u2");
  assert.equal(t.reportedBy, "u1");
  assert.equal(t.reason, "harassment");
  const queue = await adminThreads({ queue: "reported" }, admin, deps);
  assert.deepEqual(queue.threads.map((x) => [x.id, x.reportedBy, x.reason, x.members.map((m) => m.username)]), [["u1_u2", "u1", "harassment", ["ada_bikes", "bob"]]]);
  const read = await adminThread("u1_u2", admin, deps);
  assert.deepEqual(read.messages.map((m) => m.text), ["hi", "rude thing"]);
  await assert.rejects(adminThreads({ queue: "all" }, admin, deps), ValidationError);
});

test("marking seen needs membership; a gone thread refuses writes", async () => {
  const { deps, say, threads } = await setup();
  await openThread({ username: "bob" }, ada, deps);
  await say("u1_u2", ada, "hi");
  await rejects(markSeen("u1_u2", cal, deps), "not-found");
  await threads.replaceWithMarker("u1_u2", "u2");
  await rejects(say("u1_u2", bob, "hello?"), "failed-precondition", /gone/);
  const page = await listMessages("u1_u2", {}, bob, deps);
  assert.equal(page.thread.gone, true);
  assert.deepEqual(page.messages, []);
  const list = await listThreads(bob, deps);
  assert.deepEqual(list.threads.map((t) => [t.id, t.gone, t.other]), [["u1_u2", true, null]]);
});

test("deleting a member removes their threads whole, leaving markers, and their blocks", async () => {
  const { deps, say, threads } = await setup();
  const { members } = deps;
  await members.set("u3", { messages: true });
  await openThread({ username: "bob" }, ada, deps);
  await say("u1_u2", ada, "hi bob");
  await say("u1_u2", bob, "hi ada");
  await openThread({ username: "cal" }, ada, deps);
  await say("u1_u3", ada, "hi cal");
  await setBlock("cal", true, ada, deps);
  assert.deepEqual((await exportMessages("u1", deps)).map((m) => [m.thread, m.text]), [
    ["u1_u2", "hi bob"],
    ["u1_u3", "hi cal"],
  ]);
  assert.equal(await deleteMemberThreads("u1", deps), 2);
  const bobs = await listThreads(bob, deps);
  assert.deepEqual(bobs.threads.map((t) => [t.id, t.gone]), [["u1_u2", true]]);
  assert.deepEqual(await threads.messages("u1_u2"), []);
  assert.deepEqual(await threads.blocks("u1"), []);
  assert.deepEqual(await exportMessages("u1", deps), []);
  assert.deepEqual((await exportMessages("u2", deps)).map((m) => m.text), []);
});

/** Email deps: addresses for u1 and u2, a recording sender. */
function mailer() {
  const sent = [];
  return {
    sent,
    emailOf: async (uid) => ({ u1: "ada@example.com", u2: "bob@example.com" })[uid] ?? null,
    send: async (mail) => {
      sent.push(mail);
    },
    siteUrl: "https://bikes.pizza/",
  };
}

test("asking to continue by email needs messages, no block and no pending request", async () => {
  const { deps, say, threads } = await setup();
  await openThread({ username: "bob" }, ada, deps);
  await rejects(requestEmail("u1_u2", ada, deps), "failed-precondition", /Say something/);
  await say("u1_u2", ada, "hi");
  await rejects(requestEmail("u1_u2", cal, deps), "not-found");
  assert.deepEqual(await requestEmail("u1_u2", ada, deps), { requested: true });
  const thread = await threads.get("u1_u2");
  assert.deepEqual(thread.emailRequest, { by: "u1", at: deps.now().toISOString() });
  await rejects(requestEmail("u1_u2", bob, deps), "failed-precondition", /already waiting/);
  // The asker cannot agree for the other side.
  await rejects(agreeEmail("u1_u2", ada, { ...deps, ...mailer() }), "failed-precondition", /other member/);
  // Declining clears it and leaves a quiet line.
  assert.deepEqual(await withdrawEmail("u1_u2", bob, deps), { withdrawn: true });
  assert.equal((await threads.get("u1_u2")).emailRequest, null);
  const page = await listMessages("u1_u2", {}, ada, deps);
  assert.deepEqual([page.messages[0].kind, page.messages[0].event, page.messages[0].by], ["event", "declined", "u2"]);
  await rejects(withdrawEmail("u1_u2", ada, deps), "failed-precondition", /no request/);
  // Blocked: no asking.
  await setBlock("bob", true, ada, deps);
  await rejects(requestEmail("u1_u2", ada, deps), "permission-denied");
});

test("agreeing emails the conversation with Reply-To the asker and starts the next one", async () => {
  const { deps, say, threads, logged } = await setup();
  const mail = mailer();
  await openThread({ username: "bob" }, ada, deps);
  const texts = [];
  for (let i = 1; i <= 12; i += 1) {
    texts.push(`message ${i}`);
    await say("u1_u2", i % 2 ? ada : bob, `message ${i} **bold**`);
  }
  await requestEmail("u1_u2", ada, deps);
  await rejects(agreeEmail("u1_u2", bob, { ...deps, ...mail, send: null }), "unavailable");
  const result = await agreeEmail("u1_u2", bob, { ...deps, ...mail });
  assert.deepEqual(result, { emailed: true, conversation: 2 });
  assert.equal(mail.sent.length, 1);
  const sent = mail.sent[0];
  assert.equal(sent.to, "bob@example.com");
  assert.equal(sent.replyTo, "ada@example.com");
  assert.equal(sent.subject, "Your bikes.pizza conversation with ada_bikes");
  assert.match(sent.text, /Previous messages: https:\/\/bikes\.pizza\/messages\/u1_u2\//);
  assert.match(sent.text, /ada_bikes \(.*\): message 3 bold/);
  assert.doesNotMatch(sent.text, /message 2 bold/); // only the newest ten
  assert.match(sent.html, /Previous messages/);
  assert.match(sent.html, /<strong>bold<\/strong>/);
  assert.match(sent.html, /align="right"/);
  assert.match(sent.html, /align="left"/);
  const thread = await threads.get("u1_u2");
  assert.equal(thread.conversation, 2);
  assert.equal(thread.emailRequest, null);
  assert.equal(thread.last.text, "(conversation continued by email)");
  const page = await listMessages("u1_u2", {}, ada, deps);
  assert.deepEqual([page.messages[0].kind, page.messages[0].event, page.messages[0].conversation], ["event", "emailed", 1]);
  assert.ok(logged.some(([m]) => m === "conversation continued by email"));
  // The next message starts conversation 2, and a new request is possible once it has one.
  await rejects(requestEmail("u1_u2", bob, deps), "failed-precondition", /Say something/);
  const next = await say("u1_u2", bob, "back again");
  assert.equal(next.conversation, 2);
  await requestEmail("u1_u2", bob, deps);
  assert.equal((await threads.get("u1_u2")).emailRequest.by, "u2");
});

test("a member with no address on file cannot receive the email", async () => {
  const { deps, say } = await setup();
  const mail = mailer();
  await openThread({ username: "bob" }, ada, deps);
  await say("u1_u2", ada, "hi");
  await requestEmail("u1_u2", ada, deps);
  await rejects(agreeEmail("u1_u2", bob, { ...deps, ...mail, emailOf: async () => null }), "failed-precondition", /email address/);
  assert.equal(mail.sent.length, 0);
});

