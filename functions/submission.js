// Pure helpers for member submissions: checking the request, shaping the
// draft post, and wording the notification email.

import { ValidationError } from "./account.js";
import { GhostApiError } from "./ghost.js";

/** Feeds that accept submissions, keyed by the app's PostFeed name. */
export const FEEDS = {
  pizza: { tag: "pizza", noun: "pizza" },
  bikes: { tag: "biking", noun: "bike" },
};

/** Internal Ghost tag (the # prefix keeps it off the public site). */
export const SUBMISSION_TAG = "#submission";

export const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TITLE = 255; // Ghost's limit
const MAX_FROM = 100;
const MAX_DESCRIPTION = 10_000;

function text(value, field, { max, required }) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") throw new ValidationError(`${field} must be text.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new ValidationError(`${field} is required.`);
  if (trimmed.length > max) {
    throw new ValidationError(`${field} must be ${max} characters or fewer.`);
  }
  return trimmed;
}

/**
 * Validates the app's request.
 *
 * @param {unknown} data
 * @returns {{feed: string, title: string, from: string, description: string,
 *   image: {bytes: Buffer, contentType: string, filename: string}}}
 */
export function validateSubmission(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ValidationError("Nothing to submit.");
  }
  if (!Object.hasOwn(FEEDS, data.feed)) throw new ValidationError("Unknown feed.");
  const feed = data.feed;
  const title = text(data.title, "Title", { max: MAX_TITLE, required: true });
  const from = text(data.from, "From", { max: MAX_FROM, required: true });
  const description = text(data.description, "Description", {
    max: MAX_DESCRIPTION,
    required: false,
  });

  const image = data.image;
  if (!image || typeof image !== "object") throw new ValidationError("A main photo is required.");
  const extension = IMAGE_TYPES[image.contentType];
  if (!extension) throw new ValidationError("Photo must be a JPEG, PNG or WebP image.");
  if (typeof image.data !== "string" || !image.data) {
    throw new ValidationError("Photo data is missing.");
  }
  const bytes = Buffer.from(image.data, "base64");
  if (bytes.length === 0) throw new ValidationError("Photo data is missing.");
  if (bytes.length > MAX_IMAGE_BYTES) throw new ValidationError("Photo is too large (8 MB max).");

  return {
    feed,
    title,
    from,
    description,
    image: { bytes, contentType: image.contentType, filename: `${feed}-submission.${extension}` },
  };
}

export function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Plain text with blank-line paragraphs and single newlines as breaks. */
export function paragraphs(value) {
  return value
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replaceAll("\n", "<br>")}</p>`)
    .join("\n");
}

/**
 * The draft post for Ghost. The submitter's email is deliberately left out
 * of the post (it goes in the notification email) so it cannot be published
 * by accident. `authorEmail`, if given, names the staff account the draft
 * is attributed to.
 */
export function buildPost({ feed, title, from, description, imageUrl, authorEmail }) {
  const html = [
    `<p><em>Submitted by ${escapeHtml(from)}</em></p>`,
    paragraphs(description),
  ]
    .filter(Boolean)
    .join("\n");
  return {
    title,
    html,
    status: "draft",
    feature_image: imageUrl,
    tags: [{ name: FEEDS[feed].tag }, { name: SUBMISSION_TAG }],
    ...(authorEmail ? { authors: [{ email: authorEmail }] } : {}),
  };
}

/**
 * Creates the draft. If Ghost rejects the configured author (no staff user
 * with that email), the draft is created without one rather than losing the
 * submission; `warn` is told about it.
 */
export async function createDraft(ghost, post, warn = () => {}) {
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

/** Subject and body for the email that tells the author about a new draft. */
export function notificationEmail({ feed, title, from, description, userEmail, post, adminUrl }) {
  const noun = FEEDS[feed].noun;
  const editUrl = adminUrl ? `${adminUrl.replace(/\/+$/, "")}/ghost/#/editor/post/${post.id}` : null;
  const lines = [
    `${from} submitted a ${noun}: ${title}`,
    "",
    `A draft post is waiting in Ghost${editUrl ? `: ${editUrl}` : "."}`,
    "",
    `From: ${from} <${userEmail}>`,
    "",
    description ? description : "(no description)",
  ];
  return { subject: `New ${noun} submission: ${title}`, text: lines.join("\n") };
}
