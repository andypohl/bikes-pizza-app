import assert from "node:assert/strict";
import { test } from "node:test";

import { bodyPatch, detailsFor, imageField, postDocument, postUrl, publicPost, slugFor, slugify } from "./post.js";

test("slugify makes URL-safe slugs", () => {
  assert.equal(slugify("Trek 970: a Classic!"), "trek-970-a-classic");
  assert.equal(slugify("  Crème Brûlée  "), "creme-brulee");
  assert.equal(slugify("!!!"), "");
});

test("slugFor adds a stable suffix from the review id, falling back to the feed", () => {
  assert.equal(slugFor("Trek 970: a Classic!", "bikes", "AbC123xyz"), "trek-970-a-classic-abc123");
  assert.equal(slugFor("!!!", "bikes", "AbC123xyz"), "bikes-abc123");
  assert.match(slugFor("Slice", "pizza"), /^slice-[0-9a-f]{6}$/);
});

test("postUrl follows the contract", () => {
  assert.equal(postUrl("https://example.com/", "bikes", "trek"), "https://example.com/post/trek/");
  assert.equal(postUrl("https://example.com", "news", "hello"), "https://example.com/news/hello/");
});

test("detailsFor keeps only the feed's fields and drops empties", () => {
  assert.deepEqual(detailsFor("bikes", { brand: " GT ", year: "1990s", color: "", type: undefined, style: "x" }), { brand: "GT", year: "1990s" });
  assert.deepEqual(detailsFor("pizza", { style: "detroit", brand: "GT" }), { style: "detroit" });
  assert.equal(detailsFor("bikes", { brand: "" }), null);
  assert.equal(detailsFor("news", { brand: "GT" }), null);
});

test("postDocument renders the body and derives a summary", () => {
  const doc = postDocument({
    slug: "trek-970-abc123",
    feed: "bikes",
    title: "Trek 970",
    publishedAt: new Date("2026-09-04T17:00:00Z"),
    body: "First paragraph.\n\nSecond one.",
    credit: { uid: "u1", username: "ada", name: "Ada" },
    details: { brand: "Trek", year: "" },
    source: { system: "review", id: "s1" },
  });
  assert.equal(doc.status, "published");
  assert.equal(doc.publishedAt, "2026-09-04T17:00:00.000Z");
  assert.equal(doc.bodyFormat, "text");
  assert.equal(doc.html, "<p>First paragraph.</p><p>Second one.</p>");
  assert.equal(doc.summary, "First paragraph. Second one.");
  assert.deepEqual(doc.details, { brand: "Trek" });
  assert.equal(doc.image, null);
  assert.deepEqual(doc.credit, { uid: "u1", username: "ada", name: "Ada" });
  const typed = postDocument({ slug: "s", feed: "news", title: "T", publishedAt: "2026-01-01T00:00:00.000Z", body: "## Hi\n\nThere", bodyFormat: "markdown", summary: " Typed. " });
  assert.equal(typed.summary, "Typed.");
  assert.equal(typed.html, "<h2>Hi</h2>\n<p>There</p>");
  assert.throws(() => postDocument({ slug: "s", feed: "news", title: "" }), /needs a slug/);
});

test("bodyPatch re-renders only when the body changes", () => {
  assert.deepEqual(bodyPatch({ title: "New" }), { title: "New" });
  const patch = bodyPatch({ body: "Plain.", bodyFormat: "text" });
  assert.deepEqual(patch, { body: "Plain.", bodyFormat: "text", html: "<p>Plain.</p>", summary: "Plain." });
});

test("imageField and publicPost shape what the clients read", () => {
  const image = imageField({ version: "abc", width: 2000, height: 1500, sizes: [400, 800], blur: "data:x", focus: { x: 0.5, y: 0.5 } }, "https://b/o/posts%2Fs%2Fabc%2F");
  assert.deepEqual(image, { base: "https://b/o/posts%2Fs%2Fabc%2F", version: "abc", width: 2000, height: 1500, sizes: [400, 800], formats: ["webp", "jpg"], blur: "data:x", focus: { x: 0.5, y: 0.5 } });
  const pub = publicPost({ slug: "s", feed: "pizza", title: "T", publishedAt: "2026-01-01T00:00:00.000Z", summary: "S", image, details: { style: "detroit" }, credit: null, body: "secret?", html: "<p>…</p>" }, "https://example.com");
  assert.equal(pub.url, "https://example.com/post/s/");
  assert.equal(pub.gallery, true);
  assert.equal("body" in pub, false);
  assert.equal(publicPost({ slug: "n", feed: "news", title: "N", publishedAt: null }, "https://x").gallery, false);
});
