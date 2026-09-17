import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_LENGTH, commentToText, linkBareUrls, mentionedNames, renderComment, validateText } from "./comment_text.js";
import { ValidationError } from "./errors.js";

const lookup = async (name) => {
  const known = { ada_bikes: { uid: "u1", username: "ada_bikes" }, bob: { uid: "u2", username: "Bob" } };
  return known[name.toLowerCase()] ?? null;
};

test("validateText trims, requires something and caps the length", () => {
  assert.equal(validateText("  hi \r\nthere  "), "hi \nthere");
  assert.throws(() => validateText(""), ValidationError);
  assert.throws(() => validateText("   "), ValidationError);
  assert.throws(() => validateText(42), ValidationError);
  assert.throws(() => validateText("x".repeat(MAX_LENGTH + 1)), ValidationError);
  assert.equal(validateText("x".repeat(MAX_LENGTH)).length, MAX_LENGTH);
});

test("linkBareUrls turns bare addresses into [link](url) and leaves written links alone", () => {
  assert.equal(linkBareUrls("see https://a.b/c?d=1."), "see [link](https://a.b/c?d=1).");
  assert.equal(linkBareUrls("(http://x.y/z) and https://q.r/s, ok"), "([link](http://x.y/z)) and [link](https://q.r/s), ok");
  assert.equal(linkBareUrls("[mine](https://a.b/c) https://d.e"), "[mine](https://a.b/c) [link](https://d.e)");
  assert.equal(linkBareUrls("no links here, www.x.com neither"), "no links here, www.x.com neither");
});

test("mentionedNames finds @names once each, not inside words or emails", () => {
  assert.deepEqual(mentionedNames("hi @Ada_Bikes and @bob, @ada_bikes again; mail@example.com; @no"), ["Ada_Bikes", "bob"]);
});

test("renderComment renders the subset, bolds known mentions and keeps unknown ones plain", async () => {
  const out = await renderComment("**Hi** _there_ @Ada_Bikes and @nobody, see https://a.b/c.", { lookup });
  assert.equal(out.text, "**Hi** _there_ @Ada_Bikes and @nobody, see [link](https://a.b/c).");
  assert.equal(
    out.html,
    '<p><strong>Hi</strong> <em>there</em> <strong>@ada_bikes</strong> and @nobody, see <a href="https://a.b/c" rel="nofollow noopener" target="_blank">link</a>.</p>',
  );
  assert.deepEqual(out.mentions, ["u1"]);
});

test("renderComment strips what the subset does not allow and keeps the text", async () => {
  const out = await renderComment("# Heading\n![pic](https://x/y.png)\n<script>alert(1)</script>\n`code` and <b>bold</b>\n- item", { lookup });
  assert.equal(out.html, "<p>Heading</p>\n<p>code and bold</p>\n<p>item</p>");
  assert.deepEqual(out.mentions, []);
});

test("renderComment breaks lines inside a paragraph and does not autolink emails", async () => {
  const out = await renderComment("one\ntwo\n\nmail me at a@b.com", { lookup });
  assert.equal(out.html, "<p>one<br />two</p>\n<p>mail me at a@b.com</p>");
});

test("renderComment refuses unsafe link schemes", async () => {
  const out = await renderComment("[x](javascript:alert(1)) [y](ftp://z)", { lookup });
  assert.doesNotMatch(out.html, /javascript:|ftp:/);
});

test("commentToText flattens the HTML", () => {
  assert.equal(commentToText("<p><strong>Hi</strong> there<br />you &amp; me</p>\n<p>bye</p>"), "Hi there you & me bye");
});
