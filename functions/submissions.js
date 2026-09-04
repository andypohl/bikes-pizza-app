// Submission service: create, list, fetch and review submissions. Used by
// both the callables and the REST API in api.js. Persistence comes in as a
// `store` (see submission_store.js) so this module has no Firebase imports.

import { ValidationError } from "./account.js";
import { AppError } from "./errors.js";
import { buildPost, createPost } from "./post.js";
import { countdown } from "./schedule.js";
import { FEEDS, submissionRecord, validateSubmission } from "./submission.js";

// pending -> queued (approved for posting) -> posting -> approved (on the
// blog), or pending -> rejected; drafts go pending -> approved directly.
export const STATUSES = ["pending", "queued", "posting", "approved", "rejected"];
export const REVIEW_ACTIONS = ["publish", "draft", "reject"];
export const DEFAULT_PAGE = 20;
export const MAX_PAGE = 50;

/**
 * Stores a validated submission with its processed photo. `safeSearch`
 * inspects the photo first (see safesearch.js) and throws when it fails.
 */
export async function createSubmission(data, user, { store, processImage, safeSearch, notify, log = () => {} }) {
  const submission = validateSubmission(data);
  const { full, thumb } = await processImage(submission.image.bytes);
  const inspection = await safeSearch(full.bytes);

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
  await store.create(id, {
    ...submissionRecord(submission, { uid: user.uid, email: user.email, image }),
    safeSearch: inspection.likelihoods ?? null,
  });
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

/**
 * Reviews a pending submission: `reject` records the decision, `draft`
 * creates a Sanity draft right away, and `publish` puts it in its feed's
 * queue to be posted at the next scheduled time.
 */
export async function reviewSubmission({ id, action, note }, admin, deps) {
  const { store, log = () => {} } = deps;
  const data = await store.get(id);
  if (!data) throw new AppError("not-found", "That submission no longer exists.");
  if (data.status !== "pending") throw new AppError("failed-precondition", notPending(data.status));

  if (action === "publish") return enqueue({ feed: data.feed, id, note }, admin, deps);

  const reviewedBy = { by: admin.uid, byEmail: admin.email, note, action };
  if (action === "reject") {
    await store.setReview(id, { status: "rejected", review: reviewedBy });
    log("submission rejected", { id, by: admin.uid });
    return { status: "rejected" };
  }

  const result = await publishSubmission(data, deps, "draft");
  await store.setReview(id, { status: "approved", review: { ...reviewedBy, ...result } });
  log("submission drafted", { id, by: admin.uid, ...result });
  return { status: "approved", ...result };
}

function notPending(status) {
  return {
    queued: "That submission is already queued.",
    posting: "That submission is being posted right now.",
    approved: "That submission was already posted.",
    rejected: "That submission was rejected; it cannot be reviewed again.",
  }[status] ?? "That submission is not pending.";
}

/** Uploads the photo and creates the Sanity post; `status` is published or draft. */
async function publishSubmission(data, { store, sanity, siteUrl, now }, status) {
  const bytes = await store.readImage(data.image.path);
  const imageAssetId = await sanity.uploadImage({
    bytes,
    contentType: data.image.contentType ?? "image/jpeg",
    filename: `${data.feed}-submission.jpg`,
  });
  const doc = buildPost(data, { imageAssetId, now: now instanceof Date ? now : new Date() });
  return createPost(sanity, doc, { status, siteUrl });
}

// ---- queues ----------------------------------------------------------------

export function parseFeed(feed) {
  if (typeof feed !== "string" || !(feed in FEEDS)) throw new ValidationError("Unknown feed.");
  return feed;
}

/** Puts a pending submission at the back of its feed's queue. */
export async function enqueue({ feed, id, note = "" }, admin, { store, log = () => {}, now }) {
  parseFeed(feed);
  if (typeof id !== "string" || !id) throw new ValidationError("Submission id is required.");
  const data = await store.get(id);
  if (!data) throw new AppError("not-found", "That submission no longer exists.");
  if (data.feed !== feed) throw new ValidationError(`That submission is for the ${data.feed} feed.`);
  await store.transition(id, {
    from: ["pending"],
    patch: {
      status: "queued",
      queue: { by: admin.uid, byEmail: admin.email, note: String(note ?? "").trim().slice(0, 1000), at: store.timestamp() },
    },
    message: notPending(data.status),
  });
  const info = await queueInfo(feed, { store, now });
  log("submission queued", { id, feed, by: admin.uid, position: info.length });
  return { status: "queued", id, position: info.length, ...info };
}

/** Takes a queued submission back to pending. */
export async function dequeue({ feed, id }, admin, { store, log = () => {}, now }) {
  parseFeed(feed);
  if (typeof id !== "string" || !id) throw new ValidationError("Submission id is required.");
  const data = await store.get(id);
  if (!data) throw new AppError("not-found", "That submission no longer exists.");
  if (data.feed !== feed) throw new ValidationError(`That submission is for the ${data.feed} feed.`);
  await store.transition(id, {
    from: ["queued"],
    patch: { status: "pending", queue: null },
    message: "That submission is not in the queue.",
  });
  log("submission dequeued", { id, feed, by: admin.uid });
  return { status: "pending", id, ...(await queueInfo(feed, { store, now })) };
}

/** Queue length plus when the feed next posts. */
export async function queueInfo(feed, { store, now = new Date() }) {
  parseFeed(feed);
  const length = await store.queueLength(feed);
  return { feed, length, ...countdown(feed, now) };
}

/** The queue in posting order, with positions starting at 1. */
export async function queueItems(feed, { store, now = new Date() }) {
  parseFeed(feed);
  const items = await store.queueList(feed);
  const out = [];
  for (const [i, item] of items.entries()) out.push({ position: i + 1, ...(await serialise(item, store)) });
  return { feed, length: out.length, ...countdown(feed, now), items: out };
}

/**
 * Posts the oldest queued submission of a feed to the blog. Run by the
 * scheduled functions at the feed's posting times, and by the API on
 * request. Returns the posted submission, or null when the queue is empty.
 */
export async function submitNext(feed, deps) {
  const { store, log = () => {}, now } = deps;
  parseFeed(feed);
  const head = await store.queueHead(feed);
  if (!head) return { posted: null, ...(await queueInfo(feed, { store, now })) };

  await store.transition(head.id, {
    from: ["queued"],
    patch: { status: "posting" },
    message: "That submission is being posted right now.",
  });
  let result;
  try {
    result = await publishSubmission(head, deps, "published");
  } catch (error) {
    await store.transition(head.id, {
      from: ["posting"],
      patch: { status: "queued", "queue.lastError": error.message },
      message: "unreachable",
    });
    throw error;
  }
  const q = head.queue ?? {};
  await store.transition(head.id, {
    from: ["posting"],
    patch: {
      status: "approved",
      review: { action: "publish", by: q.by ?? null, byEmail: q.byEmail ?? null, note: q.note ?? "", at: store.timestamp(), ...result },
      "queue.postedAt": store.timestamp(),
      "queue.lastError": null,
    },
    message: "unreachable",
  });
  log("queued submission posted", { id: head.id, feed, ...result });
  const posted = await serialise(await store.get(head.id), store);
  return { posted, ...(await queueInfo(feed, { store, now })) };
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
    safeSearch: item.safeSearch ?? null,
    queue: item.queue
      ? {
          at: iso(item.queue.at),
          by: item.queue.by ?? null,
          byEmail: item.queue.byEmail ?? null,
          note: item.queue.note ?? "",
          postedAt: iso(item.queue.postedAt),
          lastError: item.queue.lastError ?? null,
        }
      : null,
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
