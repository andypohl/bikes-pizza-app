import assert from "node:assert/strict";
import { test } from "node:test";

import { ValidationError } from "./account.js";
import { isMailConfigured, sendMail, senderFrom } from "./mail.js";
import {
  buildPost,
  notificationEmail,
  paragraphs,
  validateSubmission,
} from "./submission.js";

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

test("paragraphs escapes HTML and keeps line breaks", () => {
  assert.equal(
    paragraphs("a <b>\nb\n\n\nc & d"),
    "<p>a &lt;b&gt;<br>b</p>\n<p>c &amp; d</p>",
  );
});

test("buildPost makes a tagged draft with the photo as feature image", () => {
  const post = buildPost({
    feed: "pizza",
    title: "Pepperoni",
    from: "Ada <script>",
    description: "Tasty",
    imageUrl: "https://example.com/i.jpg",
  });
  assert.equal(post.status, "draft");
  assert.equal(post.feature_image, "https://example.com/i.jpg");
  assert.deepEqual(post.tags, [{ name: "pizza" }, { name: "#submission" }]);
  assert.equal(post.html, "<p><em>Submitted by Ada &lt;script&gt;</em></p>\n<p>Tasty</p>");
  assert.equal(post.title, "Pepperoni");
});

test("notificationEmail names the submitter and links the editor", () => {
  const mail = notificationEmail({
    feed: "bikes",
    title: "Trek",
    from: "Ada",
    description: "",
    userEmail: "a@b.c",
    post: { id: "p1" },
    adminUrl: "https://site.ghost.io/",
  });
  assert.equal(mail.subject, "New bike submission: Trek");
  assert.match(mail.text, /https:\/\/site\.ghost\.io\/ghost\/#\/editor\/post\/p1/);
  assert.match(mail.text, /From: Ada <a@b.c>/);
  assert.match(mail.text, /\(no description\)/);
});

test("mail helpers parse the SMTP URL and pass the message through", async () => {
  assert.equal(isMailConfigured("smtps://u%40x.com:p@smtp.x.com:465"), true);
  assert.equal(isMailConfigured("unset"), false);
  assert.equal(isMailConfigured(undefined), false);
  assert.equal(senderFrom("smtps://u%40x.com:p@smtp.x.com:465"), "u@x.com");

  const sent = [];
  await sendMail(
    { smtpUrl: "smtps://u%40x.com:p@smtp.x.com:465", to: "o@x.com", subject: "s", text: "t", replyTo: "r@x.com" },
    (url) => ({ sendMail: async (m) => sent.push([url, m]) }),
  );
  assert.deepEqual(sent, [
    [
      "smtps://u%40x.com:p@smtp.x.com:465",
      { from: "u@x.com", to: "o@x.com", subject: "s", text: "t", replyTo: "r@x.com" },
    ],
  ]);
});
