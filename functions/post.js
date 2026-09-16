// The `post` document in Firestore (`posts/{slug}`): what the website
// builds from and the app reads, written here when a review is approved,
// when an edit is applied. Pure: the store is injected by the callers.
//
//   slug, feed, title, publishedAt (ISO), status: "published",
//   changedAt (ISO),                when the post was published or last edited
//   summary,                       one line for lists
//   body, bodyFormat,              as written ("text" | "markdown")
//   html,                          rendered from body at write time
//   image: null | { base, version, width, height, sizes, blur, focus, formats }
//   images: [ same shape, ... ]      additional pictures, in order (bikes and pizzas)
//   details: null | { brand, year, color, type } | { style }
//   credit: null | { uid, username, name }
//   source: null | { system, id, url }
//   createdAt, updatedAt            set by the store

import { randomUUID } from "node:crypto";

import { GALLERY_FEEDS, postPath } from "./contract.js";
import { bodyToText, renderBody, summarize } from "./markdown.js";
import { FORMATS } from "./renditions.js";

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

/**
 * The slug for a new post: the title, plus a suffix from the review id so
 * two posts with the same title never collide (the id of the review is
 * stable, so retrying a publish lands on the same slug).
 */
export function slugFor(title, feed, id = randomUUID()) {
  const base = slugify(title) || feed;
  const suffix = String(id).replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toLowerCase();
  return suffix ? `${base}-${suffix}` : base;
}

/** Where the website shows a post (the path shape comes from the contract). */
export function postUrl(siteUrl, feed, slug) {
  return `${siteUrl.replace(/\/$/, "")}${postPath(feed, slug)}`;
}

/** Which of a post's fields a bike or a pizza post keeps as details. */
export const DETAIL_FIELDS = { bikes: ["brand", "year", "color", "type"], pizza: ["style"] };

/** The stored details for a feed: only its fields, only non-empty values, or null. */
export function detailsFor(feed, details) {
  const fields = DETAIL_FIELDS[feed];
  if (!fields || !details) return null;
  const kept = {};
  for (const field of fields) {
    const value = typeof details[field] === "string" ? details[field].trim() : "";
    if (value) kept[field] = value;
  }
  return Object.keys(kept).length ? kept : null;
}

/**
 * The image field from what `makeRenditions` returned, once the files are
 * in the bucket. `base` is the URL prefix the clients append a file name
 * to (`${base}800.webp`), so they need to know nothing about buckets.
 */
export function imageField(renditions, base) {
  return {
    base,
    version: renditions.version,
    width: renditions.width,
    height: renditions.height,
    sizes: renditions.sizes,
    formats: FORMATS,
    blur: renditions.blur,
    focus: renditions.focus,
  };
}

/**
 * A complete post document from its parts. The body is rendered here; the
 * summary is the typed one or the start of the body.
 */
export function postDocument({ slug, feed, title, publishedAt, body = "", bodyFormat = "text", summary = "", image = null, images = [], details = null, credit = null, source = null, status = "published" }) {
  if (!slug || !feed || !title || !publishedAt) throw new Error("a post needs a slug, feed, title and publishedAt");
  const html = renderBody(body, bodyFormat);
  return {
    slug,
    feed,
    title,
    publishedAt: publishedAt instanceof Date ? publishedAt.toISOString() : publishedAt,
    changedAt: publishedAt instanceof Date ? publishedAt.toISOString() : publishedAt,
    status,
    summary: summary.trim() || summarize(bodyToText(body, bodyFormat)),
    body,
    bodyFormat,
    html,
    image,
    images,
    details: detailsFor(feed, details),
    credit,
    source,
  };
}

/** The fields of an existing document that change when its body or title is edited. */
export function bodyPatch({ title, body, bodyFormat, summary = "" }) {
  const patch = {};
  if (title !== undefined) patch.title = title;
  if (body !== undefined) {
    patch.body = body;
    patch.bodyFormat = bodyFormat;
    patch.html = renderBody(body, bodyFormat);
    patch.summary = summary.trim() || summarize(bodyToText(body, bodyFormat));
  }
  return patch;
}

/** The document as the API hands it out (the website and the app read Firestore directly). */
export function publicPost(doc, siteUrl) {
  return {
    id: doc.slug,
    slug: doc.slug,
    feed: doc.feed,
    title: doc.title,
    publishedAt: doc.publishedAt ?? null,
    url: postUrl(siteUrl, doc.feed, doc.slug),
    summary: doc.summary ?? "",
    image: doc.image ?? null,
    images: doc.images ?? [],
    details: doc.details ?? null,
    credit: doc.credit ?? null,
    gallery: GALLERY_FEEDS.includes(doc.feed),
  };
}
