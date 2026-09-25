import assert from "node:assert/strict";
import { test } from "node:test";

import { isMailConfigured, parseAddress, sendMail } from "./mail.js";

function fakeFetch(reply) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: reply.status === 200, status: reply.status, text: async () => JSON.stringify(reply.body) };
  };
  return { calls, fetchImpl };
}

const ok = { status: 200, body: { success: true, errors: [], result: { message_id: "<m1@x>", delivered: ["ada@example.com"], queued: [], permanent_bounces: [] } } };

test("isMailConfigured needs a real token and an account", () => {
  assert.equal(isMailConfigured({ token: "t", accountId: "a" }), true);
  assert.equal(isMailConfigured({ token: "unset", accountId: "a" }), false);
  assert.equal(isMailConfigured({ token: "", accountId: "a" }), false);
  assert.equal(isMailConfigured({ token: "t", accountId: "" }), false);
});

test("parseAddress splits a display name from the address", () => {
  assert.deepEqual(parseAddress("robot@mailer.example"), { address: "robot@mailer.example" });
  assert.deepEqual(parseAddress(" robot@mailer.example "), { address: "robot@mailer.example" });
  assert.deepEqual(parseAddress("bikes.pizza <robot@mailer.example>"), { address: "robot@mailer.example", name: "bikes.pizza" });
  assert.deepEqual(parseAddress('"Ada L." <ada@example.com>'), { address: "ada@example.com", name: "Ada L." });
  assert.deepEqual(parseAddress("<ada@example.com>"), { address: "ada@example.com" });
});

test("sendMail posts to the account's sending endpoint with the bearer token", async () => {
  const { calls, fetchImpl } = fakeFetch(ok);
  const result = await sendMail(
    { token: "tok", accountId: "acct1", from: "bikes.pizza <robot@mailer.example>", to: "ada@example.com", subject: "Hi", text: "Hello", html: "<p>Hello</p>", replyTo: "bob@example.com" },
    fetchImpl,
  );
  assert.equal(result.message_id, "<m1@x>");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.cloudflare.com/client/v4/accounts/acct1/email/sending/send");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    from: { address: "robot@mailer.example", name: "bikes.pizza" },
    to: { address: "ada@example.com" },
    subject: "Hi",
    text: "Hello",
    html: "<p>Hello</p>",
    reply_to: { address: "bob@example.com" },
  });
});

test("sendMail leaves out html and reply_to when not given", async () => {
  const { calls, fetchImpl } = fakeFetch(ok);
  await sendMail({ token: "tok", accountId: "acct1", from: "robot@mailer.example", to: "ada@example.com", subject: "Hi", text: "Hello" }, fetchImpl);
  const body = JSON.parse(calls[0].init.body);
  assert.equal("html" in body, false);
  assert.equal("reply_to" in body, false);
});

test("sendMail reports the API's errors", async () => {
  const { fetchImpl } = fakeFetch({ status: 400, body: { success: false, errors: [{ code: 1000, message: "Sender domain not verified" }], result: null } });
  await assert.rejects(
    sendMail({ token: "tok", accountId: "acct1", from: "robot@mailer.example", to: "ada@example.com", subject: "Hi", text: "Hello" }, fetchImpl),
    /Cloudflare Email 400: 1000: Sender domain not verified/,
  );
});

test("sendMail treats a permanent bounce as a failure", async () => {
  const { fetchImpl } = fakeFetch({ status: 200, body: { success: true, errors: [], result: { message_id: "<m2@x>", delivered: [], queued: [], permanent_bounces: ["gone@example.com"] } } });
  await assert.rejects(
    sendMail({ token: "tok", accountId: "acct1", from: "robot@mailer.example", to: "gone@example.com", subject: "Hi", text: "Hello" }, fetchImpl),
    /permanent bounce for gone@example.com/,
  );
});
