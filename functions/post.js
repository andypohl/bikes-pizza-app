// Turns an approved submission into a Sanity `post` document (the schema in
// studio/schemaTypes/post.ts). The member's email is deliberately absent.

import { randomUUID } from "node:crypto";

/** URL-safe slug from a title; empty if nothing usable remains. */
export function slugify(text) {
  return String(text)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const key = () => randomUUID().replace(/-/g, "").slice(0, 12);

/** Plain text (paragraphs separated by blank lines) as Portable Text blocks. */
export function textToBlocks(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((paragraph) => ({
      _type: "block",
      _key: key(),
      style: "normal",
      markDefs: [],
      children: [{ _type: "span", _key: key(), text: paragraph, marks: [] }],
    }));
}

/**
 * The document to create. The slug takes a suffix from the submission id so
 * two submissions with the same title do not collide.
 *
 * @param {{id: string, feed: string, title: string, from: string, description?: string}} submission
 * @param {{imageAssetId: string, now?: Date}} options
 */
export function buildPost(submission, { imageAssetId, now = new Date(), authorId }) {
  const base = slugify(submission.title) || submission.feed;
  const suffix = String(submission.id).replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toLowerCase();
  return {
    _type: "post",
    title: submission.title,
    slug: { _type: "slug", current: suffix ? `${base}-${suffix}` : base },
    feed: submission.feed,
    publishedAt: now.toISOString(),
    mainImage: {
      _type: "image",
      asset: { _type: "reference", _ref: imageAssetId },
      alt: submission.title,
    },
    body: textToBlocks(submission.description),
    submittedBy: submission.from,
    ...(authorId ? { author: { _type: "reference", _ref: authorId } } : {}),
    source: { system: "submission", id: submission.id },
  };
}

/**
 * Creates the post in Sanity, published or as a draft.
 *
 * @param {import('./sanity.js').SanityClient} sanity
 * @param {object} doc  from {@link buildPost}
 * @param {{status: "published"|"draft", siteUrl: string}} options
 * @returns {Promise<{postId: string, postUrl: string|null, postStatus: string}>}
 */
export async function createPost(sanity, doc, { status, siteUrl }) {
  const draft = status === "draft";
  const postId = await sanity.createDocument(doc, { draft });
  const postUrl = draft ? null : `${siteUrl.replace(/\/$/, "")}/post/${doc.slug.current}/`;
  return { postId, postUrl, postStatus: status };
}
