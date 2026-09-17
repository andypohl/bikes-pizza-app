import assert from "node:assert/strict";
import { test } from "node:test";

import { EMAILED_MESSAGES, conversationEmail, when } from "./thread_email.js";

const asker = { uid: "u1", username: "ada_bikes", email: "ada@example.com" };
const agreer = { uid: "u2", username: "bob", email: "bob@example.com" };
const message = (id, uid, html, extra = {}) => ({ id, kind: "message", uid, html, text: html.replace(/<[^>]+>/g, ""), createdAt: "2026-09-17T14:03:00.000Z", ...extra });

test("the contract says how many messages travel", () => {
  assert.equal(EMAILED_MESSAGES, 10);
  assert.equal(when("2026-09-17T14:03:00.000Z"), "Sep 17, 2026, 9:03 AM");
  assert.equal(when("nope"), "");
});

test("the email carries the messages as bubbles and as text, with Reply-To explained", () => {
  const mail = conversationEmail({
    messages: [message("m1", "u1", "<p>Hi <strong>Bob</strong></p>"), message("m2", "u2", "<p>Hi Ada</p>"), message("m3", "u1", "", { deletedAt: "x" })],
    total: 3,
    asker,
    agreer,
    previousUrl: "https://bikes.pizza/messages/u1_u2/",
    siteUrl: "https://bikes.pizza",
  });
  assert.equal(mail.subject, "Your bikes.pizza conversation with ada_bikes");
  assert.match(mail.text, /ada_bikes asked to continue/);
  assert.match(mail.text, /Replying to this email goes to ada_bikes at ada@example.com/);
  assert.match(mail.text, /^ada_bikes \(Sep 17, 2026, 9:03 AM\): Hi Bob$/m);
  assert.match(mail.text, /^bob \(.*\): Hi Ada$/m);
  assert.match(mail.text, /\[Message deleted\]/);
  assert.doesNotMatch(mail.text, /Previous messages/);
  assert.match(mail.html, /<strong>Bob<\/strong>/);
  assert.match(mail.html, /Message deleted/);
  assert.doesNotMatch(mail.html, /Previous messages/);
  // The asker on the right in teal, the other on the left in gray.
  assert.match(mail.html, /align="right"[\s\S]*#2f6f6a[\s\S]*Hi <strong>Bob/);
  assert.match(mail.html, /align="left"[\s\S]*#ececec[\s\S]*Hi Ada/);
  assert.match(mail.html, /Sent by <a href="https:\/\/bikes\.pizza\/"/);
});

test("a longer conversation links to the previous messages, and events are left out", () => {
  const mail = conversationEmail({
    messages: [message("m9", "u2", "<p>nine</p>"), { id: "e1", kind: "event", event: "declined", createdAt: "2026-09-17T14:03:00.000Z" }],
    total: 30,
    asker,
    agreer,
    previousUrl: "https://bikes.pizza/messages/u1_u2/",
    siteUrl: "https://bikes.pizza/",
  });
  assert.match(mail.text, /Previous messages: https:\/\/bikes\.pizza\/messages\/u1_u2\//);
  assert.match(mail.html, /<a href="https:\/\/bikes\.pizza\/messages\/u1_u2\/"[^>]*>Previous messages<\/a>/);
  assert.doesNotMatch(mail.text, /declined/);
  assert.doesNotMatch(mail.html, /declined/);
  assert.match(mail.html, /<a href="https:\/\/bikes\.pizza\/" style/);
});
