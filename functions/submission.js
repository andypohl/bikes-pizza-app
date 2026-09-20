// Pure helpers for member submissions: checking the request, shaping the
// stored record, and wording the notification email. Publishing to Firestore
// happens later, on approval; see post.js.

import { ValidationError } from "./account.js";
import { IMAGE_MAX_UPLOAD_BYTES, IMAGE_TYPES, SUBMISSION_FEEDS } from "./contract.js";
import { parseExtras, parseUpload } from "./uploads.js";

/** Feeds that accept submissions, each with the noun for messages. */
export const FEEDS = SUBMISSION_FEEDS;

export { IMAGE_TYPES };
export const MAX_IMAGE_BYTES = IMAGE_MAX_UPLOAD_BYTES;
const MAX_TITLE = 255;
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
 * The sender is not part of the request: the service names the submission
 * after the member's username (see createSubmission).
 *
 * @returns {{feed: string, title: string, description: string,
 *   image: {bytes: Buffer, contentType: string, filename: string},
 *   images: {bytes: Buffer, contentType: string}[]}}
 */
export function validateSubmission(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ValidationError("Nothing to submit.");
  }
  if (!Object.hasOwn(FEEDS, data.feed)) throw new ValidationError("Unknown feed.");
  const feed = data.feed;
  const title = text(data.title, "Title", { max: MAX_TITLE, required: true });
  const description = text(data.description, "Description", {
    max: MAX_DESCRIPTION,
    required: false,
  });

  const image = data.image;
  if (!image || typeof image !== "object") throw new ValidationError("A main photo is required.");
  const { bytes, contentType, extension } = parseUpload(image);
  const images = parseExtras(data.images);

  return {
    feed,
    title,
    description,
    image: { bytes, contentType, filename: `${feed}-submission.${extension}` },
    images,
  };
}

/**
 * The Firestore document for a new submission (timestamps added by the
 * caller). `from` is who sent it, as shown to the reviewer: the member's
 * username. `image` is the main photo as stored for review and `images`
 * the additional ones, in order (see uploads.js).
 */
export function submissionRecord({ feed, title, from, description }, { uid, email, image, images = [] }) {
  return {
    feed,
    title,
    from,
    description,
    uid,
    email,
    status: "pending",
    image,
    images,
    review: null,
  };
}

/**
 * Subject and body for the email that announces a new submission, or an
 * edit a member asked for on one of their posts (`kind: "edit"`, with
 * `post` and `changes` from posts.js).
 */
export function notificationEmail({ kind, feed, title, from, description, userEmail, reviewUrl, post, changes }) {
  const noun = FEEDS[feed]?.noun ?? feed;
  if (kind === "edit") {
    const changed = Object.entries(changes ?? {})
      .filter(([, value]) => value !== false)
      .map(([key]) => ({ image: "photo", images: "additional photos" })[key] ?? key);
    const lines = [
      `${from} edited their ${noun} post: ${post?.title ?? title}`,
      post?.url ? `Post: ${post.url}` : "",
      `Changed: ${changed.length ? changed.join(", ") : "nothing"}`,
      "",
      `Review it${reviewUrl ? `: ${reviewUrl}` : " on the review page."}`,
      "",
      `From: ${from} <${userEmail}>`,
      "",
      changes?.title !== undefined ? `New title: ${title}` : "",
      changes?.story !== undefined ? `New story:\n${description || "(none)"}` : "",
    ].filter((line) => line !== "");
    return { subject: `Edit to ${noun} post: ${post?.title ?? title}`, text: lines.join("\n") };
  }
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
