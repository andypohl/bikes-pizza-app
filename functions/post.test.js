import assert from "node:assert/strict";
import { test } from "node:test";

import { GhostApiError } from "./ghost.js";
import { createPost, loadTemplate, renderPost, splitTemplate, templateView } from "./post.js";

const submission = {
  feed: "bikes",
  title: "Domino's <b>Trek</b>",
  from: "Ada & Co",
  description: "First line\nsecond line\n\nNew <paragraph>",
  createdAt: new Date("2026-09-04T12:00:00Z"),
};
const view = templateView(submission, { imageUrl: "https://cdn.example.com/i.jpg" });

test("templateView exposes the submission without the member's email", () => {
  assert.equal(view.noun, "bike");
  assert.equal(view.tag, "biking");
  assert.equal(view.submitted_on, "2026-09-04");
  assert.equal("email" in view, false);
});

test("splitTemplate separates front matter from the body", () => {
  const { frontMatter, body } = splitTemplate("---\ntitle: x\n---\nbody here\n");
  assert.equal(frontMatter, "title: x");
  assert.equal(body, "body here\n");
  assert.deepEqual(splitTemplate("no front matter"), { frontMatter: "", body: "no front matter" });
});

test("renderPost fills the repo template: raw title, escaped body, tags", () => {
  const post = renderPost(loadTemplate(), view);
  assert.equal(post.title, "Domino's <b>Trek</b>");
  assert.equal(post.feature_image, "https://cdn.example.com/i.jpg");
  assert.deepEqual(post.tags, [{ name: "biking" }, { name: "#submission" }]);
  assert.match(post.html, /<em>Submitted by Ada &amp; Co<\/em>/);
  assert.match(post.html, /First line<br>second line/);
  assert.match(post.html, /<p>New &lt;paragraph&gt;<\/p>/);
  assert.doesNotMatch(post.html, /<paragraph>/);
});

test("renderPost always adds the #submission tag and falls back to the title", () => {
  const post = renderPost("---\ntags: pizza\n---\n{{description}}", { ...view, description: "x" });
  assert.equal(post.title, view.title);
  assert.deepEqual(post.tags, [{ name: "pizza" }, { name: "#submission" }]);
  assert.equal("feature_image" in post, false);
});

test("createPost sets status and author, retrying without a rejected author", async () => {
  const attempts = [];
  const ghost = {
    async createPost(post) {
      attempts.push(post);
      if (post.authors) {
        throw new GhostApiError("bad author", { status: 422, type: "ValidationError" });
      }
      return { id: "p1", status: post.status };
    },
  };
  const warnings = [];
  const rendered = { title: "T", html: "<p>x</p>", tags: [] };
  const result = await createPost(ghost, rendered, { status: "published", authorEmail: "s@x.com" }, (m) =>
    warnings.push(m),
  );
  assert.equal(result.id, "p1");
  assert.equal(attempts[0].status, "published");
  assert.deepEqual(attempts[0].authors, [{ email: "s@x.com" }]);
  assert.equal("authors" in attempts[1], false);
  assert.equal(warnings.length, 1);

  const draft = await createPost({ async createPost(p) { return p; } }, rendered, { status: "draft" });
  assert.equal(draft.status, "draft");
  assert.equal("authors" in draft, false);

  const failing = { async createPost() { throw new GhostApiError("down", { status: 503 }); } };
  await assert.rejects(createPost(failing, rendered, { status: "draft" }), /down/);
});
