// Submission service: create, list, fetch and review submissions. Used by
// both the callables and the REST API in api.js. Persistence comes in as a
// `store` (see submission_store.js) so this module has no Firebase imports.

import { ValidationError } from "./account.js";
import { AppError } from "./errors.js";
import { createPost, loadTemplate, renderPost, templateView } from "./post.js";
import { submissionRecord, validateSubmission } from "./submission.js";

export const STATUSES = ["pending", "approved", "rejected"];
export const REVIEW_ACTIONS = ["publish", "draft", "reject"];
export const DEFAULT_PAGE = 20;
export const MAX_PAGE = 50;

/** Stores a validated submission with its processed photo. */
export async function createSubmission(data, user, { store, processImage, notify, log = () => {} }) {
  const submission = validateSubmission(data);
  const { full, thumb } = await processImage(submission.image.bytes);

  const id = store.newId();
  const token = store.newToken();
  const image = {
    path: `submissions/${id}/photo.jpg`,
    thumbPath: `submissions/${id}/thumb.jpg`,
    contentType: "image/jpeg",
    width: full.width,
    height: full.height,
    token,
  };
  const options = {
    contentType: "image/jpeg",
    metadata: { submissionId: id, uid: user.uid, firebaseStorageDownloadTokens: token },
  };
  await Promise.all([
    store.putImage(image.path, full.bytes, options),
    store.putImage(image.thumbPath, thumb.bytes, options),
  ]);
  await store.create(id, submissionRecord(submission, { uid: user.uid, email: user.email, image }));
  log("submission stored", { uid: user.uid, feed: submission.feed, id });

  const notified = await notify(submission, user);
  return { submissionId: id, notified };
}

/** Validates the body of a review request. */
export function parseReview(data) {
  const { id, action } = data ?? {};
  if (typeof id !== "string" || !id) throw new ValidationError("Submission id is required.");
  if (!REVIEW_ACTIONS.includes(action)) throw new ValidationError("Unknown review action.");
  const note = typeof data.note === "string" ? data.note.trim().slice(0, 1000) : "";
  return { id, action, note };
}

/** Publishes, drafts or rejects a pending submission. */
export async function reviewSubmission(
  { id, action, note },
  admin,
  { store, ghost, authorEmail = "", warn = () => {}, log = () => {} },
) {
  const data = await store.get(id);
  if (!data) throw new AppError("not-found", "That submission no longer exists.");
  if (data.status === "approved") {
    throw new AppError("failed-precondition", "That submission was already posted.");
  }

  const reviewedBy = { by: admin.uid, byEmail: admin.email, note, action };
  if (action === "reject") {
    await store.setReview(id, { status: "rejected", review: reviewedBy });
    log("submission rejected", { id, by: admin.uid });
    return { status: "rejected" };
  }

  const bytes = await store.readImage(data.image.path);
  const imageUrl = await ghost.uploadImage({
    bytes,
    contentType: data.image.contentType ?? "image/jpeg",
    filename: `${data.feed}-submission.jpg`,
  });
  const rendered = renderPost(loadTemplate(), templateView(data, { imageUrl }));
  const status = action === "publish" ? "published" : "draft";
  const post = await createPost(ghost, rendered, { status, authorEmail }, warn);
  const result = { postId: post.id, postUrl: post.url ?? null, postStatus: post.status ?? status };
  await store.setReview(id, { status: "approved", review: { ...reviewedBy, ...result } });
  log("submission posted", { id, by: admin.uid, ...result });
  return { status: "approved", ...result };
}

/** Validates list query parameters (strings, as from a URL). */
export function parseListQuery(query = {}) {
  const status = query.status ? String(query.status) : "";
  if (status && !STATUSES.includes(status)) throw new ValidationError("Unknown status filter.");
  let limit = DEFAULT_PAGE;
  if (query.limit !== undefined && query.limit !== "") {
    limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
      throw new ValidationError(`limit must be a whole number from 1 to ${MAX_PAGE}.`);
    }
  }
  const afterId = query.after ? String(query.after) : "";
  return { status, limit, afterId };
}

export async function listSubmissions(query, { store }) {
  const { items, hasMore } = await store.list(query);
  const out = [];
  for (const item of items) out.push(await serialise(item, store));
  return { items: out, nextCursor: hasMore && out.length ? out[out.length - 1].id : null };
}

export async function getSubmission(id, { store }) {
  const item = await store.get(id);
  if (!item) throw new AppError("not-found", "That submission no longer exists.");
  return serialise(item, store);
}

const iso = (d) => (d instanceof Date ? d.toISOString() : null);

/** The API representation of a stored submission. */
export async function serialise(item, store) {
  const image = item.image ?? {};
  let token = image.token;
  if (!token && image.path) {
    // Photos stored before tokens were minted at upload time.
    token = store.newToken();
    await Promise.all([store.tagImage(image.path, token), store.tagImage(image.thumbPath, token)]);
    await store.setImageToken(item.id, token);
  }
  const review = item.review;
  return {
    id: item.id,
    feed: item.feed,
    title: item.title,
    from: item.from,
    description: item.description ?? "",
    status: item.status,
    createdAt: iso(item.createdAt),
    submittedBy: { uid: item.uid, email: item.email },
    image: {
      width: image.width ?? null,
      height: image.height ?? null,
      photoUrl: image.path ? store.imageUrl(image.path, token) : null,
      thumbUrl: image.thumbPath ? store.imageUrl(image.thumbPath, token) : null,
    },
    review: review
      ? {
          action: review.action,
          at: iso(review.at),
          by: review.by,
          byEmail: review.byEmail ?? null,
          note: review.note ?? "",
          postId: review.postId ?? null,
          postUrl: review.postUrl ?? null,
          postStatus: review.postStatus ?? null,
        }
      : null,
  };
}
