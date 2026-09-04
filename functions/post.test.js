import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPost, createPost, slugify, textToBlocks } from "./post.js";

const submission = {
  id: "AbC123xyz",
  feed: "bikes",
  title: "Trek 970: a Classic!",
  from: "Ada",
  email: "ada@example.com",
  description: "First paragraph.\n\nSecond one,\nwith a line break.",
};

test("slugify makes URL-safe slugs", () => {
  assert.equal(slugify("Trek 970: a Classic!"), "trek-970-a-classic");
  assert.equal(slugify("  Crème Brûlée  "), "creme-brulee");
  assert.equal(slugify("!!!"), "");
});

test("textToBlocks makes one paragraph block per blank-line-separated paragraph", () => {
  const blocks = textToBlocks(submission.description);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]._type, "block");
  assert.equal(blocks[0].children[0].text, "First paragraph.");
  assert.equal(blocks[1].children[0].text, "Second one,\nwith a line break.");
  assert.ok(blocks[0]._key && blocks[0].children[0]._key);
  assert.deepEqual(textToBlocks(""), []);
});

test("buildPost shapes the document without the member's email", () => {
  const now = new Date("2026-09-04T17:00:00Z");
  const doc = buildPost(submission, { imageAssetId: "image-abc-2000x1500-jpg", now });
  assert.equal(doc._type, "post");
  assert.equal(doc.title, submission.title);
  assert.equal(doc.slug.current, "trek-970-a-classic-abc123");
  assert.equal(doc.feed, "bikes");
  assert.equal(doc.publishedAt, "2026-09-04T17:00:00.000Z");
  assert.equal(doc.mainImage.asset._ref, "image-abc-2000x1500-jpg");
  assert.equal(doc.mainImage.alt, submission.title);
  assert.equal(doc.submittedBy, "Ada");
  assert.deepEqual(doc.source, { system: "submission", id: "AbC123xyz" });
  assert.equal(doc.body.length, 2);
  assert.ok(!JSON.stringify(doc).includes("ada@example.com"));
});

test("buildPost falls back to the feed when the title has no slug", () => {
  const doc = buildPost({ ...submission, title: "!!!" }, { imageAssetId: "image-x" });
  assert.equal(doc.slug.current, "bikes-abc123");
});

test("createPost publishes with a site URL, or drafts without one", async () => {
  const calls = [];
  const sanity = { createDocument: async (doc, opts) => calls.push([doc.slug.current, opts]) && "p1" };
  const doc = buildPost(submission, { imageAssetId: "image-x" });
  assert.deepEqual(await createPost(sanity, doc, { status: "published", siteUrl: "https://example.com/" }), {
    postId: "p1",
    postUrl: "https://example.com/post/trek-970-a-classic-abc123/",
    postStatus: "published",
  });
  assert.deepEqual(await createPost(sanity, doc, { status: "draft", siteUrl: "https://example.com" }), {
    postId: "p1",
    postUrl: null,
    postStatus: "draft",
  });
  assert.deepEqual(calls.map(([, o]) => o.draft), [false, true]);
});
