import assert from "node:assert/strict";
import { test } from "node:test";

import { ValidationError } from "./account.js";
import { isMailConfigured, sendMail } from "./mail.js";
import { notificationEmail, submissionRecord, validateSubmission } from "./submission.js";

const png = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
const good = {
  feed: "bikes",
  title: "  1991 Trek 970 ",
  from: "Ada",
  description: "First line\nsecond line\n\nNew paragraph <b>",
  image: { data: png, contentType: "image/png" },
};

test("validateSubmission trims text and decodes the image", () => {
  const s = validateSubmission(good);
  assert.equal(s.title, "1991 Trek 970");
  assert.equal(s.image.filename, "bikes-submission.png");
  assert.equal(s.image.bytes.length, 8);
});

test("validateSubmission rejects bad requests", () => {
  const bad = (patch) => assert.throws(() => validateSubmission({ ...good, ...patch }), ValidationError);
  bad({ feed: "blog" });
  bad({ title: "" });
  bad({ title: "x".repeat(256) });
  bad({ from: "   " });
  bad({ image: undefined });
  bad({ image: { data: png, contentType: "image/gif" } });
  bad({ image: { data: "", contentType: "image/png" } });
  bad({ image: { data: Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64"), contentType: "image/png" } });
  assert.throws(() => validateSubmission(null), ValidationError);
});

test("description is optional", () => {
  assert.equal(validateSubmission({ ...good, description: undefined }).description, "");
});

test("submissionRecord shapes a pending document", () => {
  const image = { path: "submissions/s1/photo.jpg", thumbPath: "submissions/s1/thumb.jpg" };
  const record = submissionRecord(
    { feed: "pizza", title: "T", from: "F", description: "D" },
    { uid: "u1", email: "a@b.c", image },
  );
  assert.deepEqual(record, {
    feed: "pizza",
    title: "T",
    from: "F",
    description: "D",
    uid: "u1",
    email: "a@b.c",
    status: "pending",
    image,
    review: null,
  });
});

test("notificationEmail names the submitter and links the review page", () => {
  const mail = notificationEmail({
    feed: "bikes",
    title: "Trek",
    from: "Ada",
    description: "",
    userEmail: "a@b.c",
    reviewUrl: "https://example.web.app/review/",
  });
  assert.equal(mail.subject, "New bike submission: Trek");
  assert.match(mail.text, /Review it: https:\/\/example\.web\.app\/review\//);
  assert.match(mail.text, /From: Ada <a@b.c>/);
  assert.match(mail.text, /\(no description\)/);
});

test("isMailConfigured needs a real key and a domain", () => {
  assert.equal(isMailConfigured({ apiKey: "key-1", domain: "mg.x.com" }), true);
  assert.equal(isMailConfigured({ apiKey: "unset", domain: "mg.x.com" }), false);
  assert.equal(isMailConfigured({ apiKey: "", domain: "mg.x.com" }), false);
  assert.equal(isMailConfigured({ apiKey: "key-1", domain: "" }), false);
});

test("sendMail posts a Mailgun message with basic auth and reply-to", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: "<m@x>", message: "Queued." }) };
  };
  const result = await sendMail(
    {
      apiKey: "key-1",
      domain: "mg.x.com",
      from: "Pizza Predator <submissions@x.com>",
      to: "robot@x.com",
      subject: "s",
      text: "t",
      replyTo: "member@y.com",
    },
    fetchImpl,
  );
  assert.equal(result.id, "<m@x>");
  assert.equal(calls[0].url, "https://api.mailgun.net/v3/mg.x.com/messages");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(
    calls[0].init.headers.Authorization,
    `Basic ${Buffer.from("api:key-1").toString("base64")}`,
  );
  const body = calls[0].init.body;
  assert.equal(body.get("from"), "Pizza Predator <submissions@x.com>");
  assert.equal(body.get("to"), "robot@x.com");
  assert.equal(body.get("h:Reply-To"), "member@y.com");

  const failing = async () => ({ ok: false, status: 401, text: async () => "Forbidden" });
  await assert.rejects(
    sendMail({ apiKey: "k", domain: "d", from: "a", to: "b", subject: "s", text: "t" }, failing),
    /Mailgun 401: Forbidden/,
  );
});
