import assert from "node:assert/strict";
import { test } from "node:test";

import { RULES, concernEmail, reportConcern, validateConcern } from "./concerns.js";
import { AppError, ValidationError } from "./errors.js";
import { memoryConcernStore, memoryMemberStore, memoryPostStore } from "./fakes.js";

const ada = { uid: "u1", email: "ada@example.com", admin: false };

async function setup({ notify } = {}) {
  const concerns = memoryConcernStore();
  const posts = memoryPostStore();
  await posts.create("blue-bike", { title: "Blue bike", feed: "bikes", status: "published" });
  await posts.create("draft", { title: "Draft", feed: "bikes", status: "queued" });
  const members = memoryMemberStore({ u1: { username: "ada_bikes" } });
  const sent = [];
  const logs = [];
  const deps = {
    concerns,
    posts,
    members,
    notify: notify ?? (async (c) => sent.push(c)),
    now: () => new Date("2026-09-25T10:00:00.000Z"),
    log: (message, fields) => logs.push({ message, ...fields }),
  };
  return { concerns, deps, sent, logs };
}

test("validateConcern insists on a kind, a reason, and enough to go on", () => {
  assert.throws(() => validateConcern({}), ValidationError);
  assert.throws(() => validateConcern({ kind: "post", reason: "nope" }), ValidationError);
  assert.throws(() => validateConcern({ kind: "post", reason: "spam" }), /which post/);
  assert.throws(() => validateConcern({ kind: "member", reason: "spam" }), /which member/);
  assert.throws(() => validateConcern({ kind: "other", reason: "other" }), /what the concern/);
  assert.throws(() => validateConcern({ kind: "other", reason: "other", details: "x".repeat(RULES.maxDetails + 1) }), ValidationError);
  assert.throws(() => validateConcern({ kind: "post", reason: "spam", target: "x".repeat(RULES.maxTarget + 1) }), ValidationError);
  assert.deepEqual(validateConcern({ kind: "post", reason: "spam", target: " blue-bike ", details: " ads " }), {
    kind: "post",
    reason: "spam",
    target: "blue-bike",
    details: "ads",
  });
  assert.deepEqual(validateConcern({ kind: "other", reason: "other", details: "hello" }), { kind: "other", reason: "other", target: "", details: "hello" });
});

test("reportConcern stores the report with the post it names and mails it", async () => {
  const { concerns, deps, sent, logs } = await setup();
  const result = await reportConcern({ kind: "post", reason: "person", target: "blue-bike", details: "There is a face." }, ada, deps);
  assert.deepEqual(result, { reported: true, id: "concern-1" });
  const [stored] = concerns.all;
  assert.equal(stored.username, "ada_bikes");
  assert.equal(stored.email, "ada@example.com");
  assert.deepEqual(stored.post, { slug: "blue-bike", title: "Blue bike", path: "/post/blue-bike/" });
  assert.equal(stored.status, "open");
  assert.equal(stored.at, "2026-09-25T10:00:00.000Z");
  assert.equal(sent.length, 1);
  assert.equal(logs[0].message, "concern reported");
  assert.equal(logs[0].urgent, false);
});

test("a target that is not a published post is passed through as typed", async () => {
  const { concerns, deps } = await setup();
  await reportConcern({ kind: "post", reason: "spam", target: "draft" }, ada, deps);
  await reportConcern({ kind: "post", reason: "spam", target: "https://bikes.pizza/post/blue-bike/" }, ada, deps);
  assert.equal(concerns.all[0].post, null);
  assert.equal(concerns.all[1].post, null);
  assert.equal(concerns.all[1].target, "https://bikes.pizza/post/blue-bike/");
});

test("a child safety report is urgent in the log and the email", async () => {
  const { deps, logs, concerns } = await setup();
  await reportConcern({ kind: "member", reason: "child_safety", target: "someone", details: "Please look." }, ada, deps);
  assert.equal(logs[0].urgent, true);
  const mail = concernEmail(concerns.all[0], { siteUrl: "https://bikes.pizza" });
  assert.equal(mail.subject, "[URGENT] Concern reported: Child safety concern");
  assert.match(mail.text, /handle first/);
  assert.match(mail.text, /About: A member — someone/);
  assert.match(mail.text, /Reported by: ada_bikes <ada@example.com> \(u1\)/);
  assert.match(mail.text, /Please look\./);
});

test("the email names the post's page when the report is about one", async () => {
  const { deps, concerns } = await setup();
  await reportConcern({ kind: "post", reason: "copyright", target: "blue-bike" }, ada, deps);
  const mail = concernEmail(concerns.all[0], { siteUrl: "https://bikes.pizza" });
  assert.equal(mail.subject, "Concern reported: Copyright, or my photo used without permission");
  assert.match(mail.text, /Post: Blue bike \(https:\/\/bikes\.pizza\/post\/blue-bike\/\)/);
  assert.match(mail.text, /\(no details given\)/);
});

test("a failed email does not lose the report", async () => {
  const { concerns, deps, logs } = await setup({
    notify: async () => {
      throw new Error("mailgun down");
    },
  });
  const result = await reportConcern({ kind: "other", reason: "other", details: "hi" }, ada, deps);
  assert.equal(result.reported, true);
  assert.equal(concerns.all.length, 1);
  assert.equal(logs.at(-1).message, "concern email failed");
});

test("a member can send only so many reports a day", async () => {
  const { deps } = await setup();
  for (let i = 0; i < RULES.perDay; i += 1) {
    await reportConcern({ kind: "other", reason: "other", details: `report ${i}` }, ada, deps);
  }
  await assert.rejects(reportConcern({ kind: "other", reason: "other", details: "one more" }, ada, deps), (e) => e instanceof AppError && e.code === "resource-exhausted");
});
