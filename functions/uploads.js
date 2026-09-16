// Photos as the clients send them (base64 in the JSON body) and as they
// are held for review: decoded and checked, normalised (images.js),
// inspected (vision.js) and stored under submissions/{id}/. A post has a
// main photo and up to IMAGE_MAX_EXTRA additional ones, all treated the
// same way. Shared by new submissions (submissions.js) and by edits of
// published posts (posts.js). Pure: the pipeline, the Vision check and
// the store are injected.

import { ValidationError } from "./account.js";
import { IMAGE_MAX_EXTRA, IMAGE_MAX_UPLOAD_BYTES, IMAGE_TYPES } from "./contract.js";
import { AppError } from "./errors.js";

export const MAX_EXTRA = IMAGE_MAX_EXTRA;

/** How an additional photo is named in messages: "Additional photo 2". */
export const extraLabel = (index) => `Additional photo ${index + 1}`;

/**
 * Decodes one uploaded photo, `{data: <base64>, contentType}`. `what`
 * names it in error messages.
 */
export function parseUpload(value, what = "Photo") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError(`${what} data is missing.`);
  const extension = IMAGE_TYPES[value.contentType];
  if (!extension) throw new ValidationError(`${what} must be a JPEG, PNG or WebP image.`);
  if (typeof value.data !== "string" || !value.data) throw new ValidationError(`${what} data is missing.`);
  const bytes = Buffer.from(value.data, "base64");
  if (bytes.length === 0) throw new ValidationError(`${what} data is missing.`);
  if (bytes.length > IMAGE_MAX_UPLOAD_BYTES) throw new ValidationError(`${what} is too large (8 MB max).`);
  return { bytes, contentType: value.contentType, extension };
}

/**
 * Parses the list of additional photos: absent means none; at most
 * MAX_EXTRA, each an upload like the main photo. With `keep`, an entry
 * `{keep: <version>}` stands for a picture the post already has (edits
 * send the whole list in its new order).
 */
export function parseExtras(value, { keep = false } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError("Additional photos must be a list.");
  if (value.length > MAX_EXTRA) throw new ValidationError(`At most ${MAX_EXTRA} additional photos.`);
  return value.map((item, i) => {
    if (keep && item && typeof item === "object" && typeof item.keep === "string" && item.keep) return { keep: item.keep };
    const { bytes, contentType } = parseUpload(item, extraLabel(i));
    return { bytes, contentType };
  });
}

/**
 * Normalises a photo and, when a `safeSearch` check is given, runs it
 * through Vision. A refusal of an additional photo names it (`what`)
 * instead of "Your photo", so the member knows which one to swap.
 * Resolves to `{full, thumb, safeSearch, people}`; the last two are what
 * Vision saw (null when not inspected), kept for the reviewer.
 */
export async function preparePhoto(bytes, { processImage, safeSearch }, what = null) {
  const { full, thumb } = await processImage(bytes);
  let inspection = null;
  if (safeSearch) {
    try {
      inspection = await safeSearch(full.bytes);
    } catch (error) {
      if (what && error instanceof AppError) throw new AppError(error.code, error.message.replace(/^Your photo/, what));
      throw error;
    }
  }
  return { full, thumb, safeSearch: inspection?.likelihoods ?? null, people: inspection?.people ?? null };
}

/** Where a submission's photos live: index 0 is the main one. */
export function photoPaths(id, index = 0) {
  const suffix = index ? `-${index}` : "";
  return { path: `submissions/${id}/photo${suffix}.jpg`, thumbPath: `submissions/${id}/thumb${suffix}.jpg` };
}

/**
 * Stores a prepared photo (and its thumbnail) for review and returns the
 * record the submission keeps: paths, size and the download token.
 */
export async function storePhoto(store, prepared, { id, uid, index = 0 }) {
  const token = store.newToken();
  const { path, thumbPath } = photoPaths(id, index);
  const options = {
    contentType: "image/jpeg",
    metadata: { submissionId: id, uid, firebaseStorageDownloadTokens: token },
  };
  await Promise.all([store.putImage(path, prepared.full.bytes, options), store.putImage(thumbPath, prepared.thumb.bytes, options)]);
  return { path, thumbPath, contentType: "image/jpeg", width: prepared.full.width, height: prepared.full.height, token };
}

/** The record of an additional photo held for review, with what Vision saw. */
export async function storeExtra(store, prepared, ids) {
  return { ...(await storePhoto(store, prepared, ids)), safeSearch: prepared.safeSearch, people: prepared.people };
}
