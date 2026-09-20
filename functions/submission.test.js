import assert from "node:assert/strict";
import { test } from "node:test";

import { ValidationError } from "./account.js";
import { isMailConfigured, sendMail } from "./mail.js";
import { notificationEmail, submissionRecord, validateSubmission } from "./submission.js";

const png = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
const good = {
  feed: "bikes",
  title: "  1991 Trek 970 ",
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
  bad({ feed: "news" });
  bad({ title: "" });
  bad({ title: "x".repeat(256) });
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
    images: [],
    review: null,
  });
});

test("validateSubmission decodes additional photos and caps them", () => {
  const extra = { data: png, contentType: "image/png" };
  assert.deepEqual(validateSubmission(good).images, []);
  const s = validateSubmission({ ...good, images: [extra, { ...extra, contentType: "image/jpeg" }] });
  assert.equal(s.images.length, 2);
  assert.equal(s.images[0].bytes.length, 8);
  assert.equal(s.images[1].contentType, "image/jpeg");
  assert.throws(() => validateSubmission({ ...good, images: extra }), /must be a list/);
  assert.throws(() => validateSubmission({ ...good, images: [extra, extra, extra, extra, extra] }), /At most 4 additional photos/);
  assert.throws(() => validateSubmission({ ...good, images: [extra, { data: png, contentType: "image/gif" }] }), /Additional photo 2 must be a JPEG/);
  assert.throws(() => validateSubmission({ ...good, images: [{ data: "", contentType: "image/png" }] }), /Additional photo 1 data is missing/);
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
      from: "bikes.pizza <submissions@x.com>",
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
  assert.equal(body.get("from"), "bikes.pizza <submissions@x.com>");
  assert.equal(body.get("to"), "robot@x.com");
  assert.equal(body.get("h:Reply-To"), "member@y.com");

  const failing = async () => ({ ok: false, status: 401, text: async () => "Forbidden" });
  await assert.rejects(
    sendMail({ apiKey: "k", domain: "d", from: "a", to: "b", subject: "s", text: "t" }, failing),
    /Mailgun 401: Forbidden/,
  );
});

test("notificationEmail names additional photos among the changes", () => {
  const { text } = notificationEmail({
    kind: "edit",
    feed: "bikes",
    title: "T",
    from: "Ada",
    description: "",
    userEmail: "a@b.c",
    post: { title: "T", url: "https://x/post/t/" },
    changes: { image: false, images: true },
  });
  assert.match(text, /Changed: additional photos/);
});

test("notificationEmail describes an edit and what changed", () => {
  const mail = notificationEmail({
    kind: "edit",
    feed: "bikes",
    title: "Trek 970 (restored)",
    from: "Ada",
    description: "New story",
    userEmail: "ada@example.com",
    reviewUrl: "https://submissions.example.com/",
    post: { title: "Trek 970", url: "https://example.com/post/trek-970/" },
    changes: { title: "Trek 970 (restored)", story: "New story", image: true, bike: { brand: "Trek" } },
  });
  assert.equal(mail.subject, "Edit to bike post: Trek 970");
  assert.match(mail.text, /Ada edited their bike post: Trek 970/);
  assert.match(mail.text, /Post: https:\/\/example.com\/post\/trek-970\//);
  assert.match(mail.text, /Changed: title, story, photo, bike/);
  assert.match(mail.text, /New title: Trek 970 \(restored\)/);
  assert.match(mail.text, /New story:\nNew story/);
  assert.match(mail.text, /Review it: https:\/\/submissions.example.com\//);
});
