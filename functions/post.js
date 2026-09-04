// Turns an approved submission into a Ghost post from the Markdown template
// in templates/submission_post.md.
//
// The template starts with a front-matter block (title, tags, feature_image)
// followed by the Markdown body. Mustache fills in the submission's values;
// text in the body is HTML-escaped so a member cannot inject markup, while
// the front matter is not (it lands in plain fields, not HTML).

import { readFileSync } from "node:fs";

import { marked } from "marked";
import Mustache from "mustache";

import { GhostApiError } from "./ghost.js";
import { FEEDS, SUBMISSION_TAG } from "./submission.js";

export const TEMPLATE_PATH = new URL("./templates/submission_post.md", import.meta.url);

export function loadTemplate() {
  return readFileSync(TEMPLATE_PATH, "utf8");
}

/** Splits `---\nkey: value\n---\nbody` into its two parts. */
export function splitTemplate(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { frontMatter: "", body: text };
  return { frontMatter: match[1], body: match[2] };
}

function parseFrontMatter(text) {
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (m) fields[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return fields;
}

/** The values a template can use. The member's email is deliberately absent. */
export function templateView(submission, { imageUrl }) {
  const feed = FEEDS[submission.feed];
  const created = submission.createdAt instanceof Date ? submission.createdAt : new Date();
  return {
    title: submission.title,
    from: submission.from,
    description: submission.description ?? "",
    feed: submission.feed,
    noun: feed.noun,
    tag: feed.tag,
    image_url: imageUrl,
    submitted_on: created.toISOString().slice(0, 10),
  };
}

/**
 * @returns {{title: string, html: string, tags: {name: string}[], feature_image?: string}}
 */
export function renderPost(template, view) {
  const { frontMatter, body } = splitTemplate(template);
  const raw = Mustache.render(frontMatter, view, {}, { escape: (v) => String(v) });
  const fields = parseFrontMatter(raw);
  const html = marked.parse(Mustache.render(body, view), { breaks: true, gfm: true }).trim();
  const tags = (fields.tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tags.includes(SUBMISSION_TAG)) tags.push(SUBMISSION_TAG);
  const post = { title: fields.title || view.title, html, tags: tags.map((name) => ({ name })) };
  if (fields.feature_image) post.feature_image = fields.feature_image;
  return post;
}

/**
 * Creates the post. If Ghost rejects the configured author (no staff user
 * with that email), the post is created without one rather than failing;
 * `warn` is told about it.
 *
 * @param {"published"|"draft"} status
 */
export async function createPost(ghost, rendered, { status, authorEmail }, warn = () => {}) {
  const post = { ...rendered, status };
  if (authorEmail) post.authors = [{ email: authorEmail }];
  try {
    return await ghost.createPost(post);
  } catch (error) {
    if (post.authors && error instanceof GhostApiError && error.type === "ValidationError") {
      warn(`Ghost rejected the submission author (${error.message}); using the default author.`);
      const { authors: _authors, ...withoutAuthor } = post;
      return ghost.createPost(withoutAuthor);
    }
    throw error;
  }
}
