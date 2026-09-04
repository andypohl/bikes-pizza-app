// Pure helpers for member submissions: checking the request, shaping the
// stored record, and wording the notification email. Publishing to Sanity
// happens later, on approval; see post.js.

import { ValidationError } from "./account.js";

/** Feeds that accept submissions, keyed by the app's PostFeed name. */
export const FEEDS = {
  pizza: { noun: "pizza" },
  bikes: { noun: "bike" },
};


export const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TITLE = 255;
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

/** The Firestore document for a new submission (timestamps added by the caller). */
export function submissionRecord({ feed, title, from, description }, { uid, email, image }) {
  return {
    feed,
    title,
    from,
    description,
    uid,
    email,
    status: "pending",
    image,
    review: null,
  };
}

/** Subject and body for the email that announces a new submission. */
export function notificationEmail({ feed, title, from, description, userEmail, reviewUrl }) {
  const noun = FEEDS[feed].noun;
  const lines = [
    `${from} submitted a ${noun}: ${title}`,
    "",
    `Review it${reviewUrl ? `: ${reviewUrl}` : " on the review page."}`,
    "",
    `From: ${from} <${userEmail}>`,
    "",
    description ? description : "(no description)",
  ];
  return { subject: `New ${noun} submission: ${title}`, text: lines.join("\n") };
}
