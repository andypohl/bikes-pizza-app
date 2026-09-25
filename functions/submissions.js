// Submission service: create, list, fetch and review submissions. Used by
// both the callables and the REST API in api.js. Persistence comes in as a
// `store` (see submission_store.js) so this module has no Firebase imports.

import { ValidationError } from "./account.js";
import { AppError } from "./errors.js";
import { postDocument, postUrl, slugFor } from "./post.js";
import { applyEditSubmission, publishImage } from "./posts.js";
import { countdown } from "./schedule.js";
import { FEEDS, submissionRecord, validateSubmission } from "./submission.js";
import { extraLabel, preparePhoto, storeExtra, storePhoto } from "./uploads.js";

// pending -> queued (approved for posting) -> posting -> approved (on the
// site), or pending -> rejected; an edit goes pending -> approved directly.
export const STATUSES = ["pending", "queued", "posting", "approved", "rejected"];
export const REVIEW_ACTIONS = ["publish", "reject"];
export const DEFAULT_PAGE = 20;
export const MAX_PAGE = 50;

/**
 * Stores a validated submission with its processed photos. `safeSearch`
 * inspects every photo first (SafeSearch and people checks, see
 * vision.js), the main one and then the additional ones, and throws when
 * one fails, before anything is stored; what it saw is kept on the record
 * for the reviewer. The submission is from the member's username (looked
 * up through `members`), not a name they typed.
 */
export async function createSubmission(data, user, { store, members, processImage, safeSearch, notify, log = () => {} }) {
  const submission = { ...validateSubmission(data), from: await senderName(user, members, log) };
  const pipeline = { processImage, safeSearch };
  const main = await preparePhoto(submission.image.bytes, pipeline);
  const extras = [];
  for (const [i, upload] of submission.images.entries()) extras.push(await preparePhoto(upload.bytes, pipeline, extraLabel(i)));

  const id = store.newId();
  const ids = { id, uid: user.uid };
  const image = await storePhoto(store, main, ids);
  const images = [];
  for (const [i, prepared] of extras.entries()) images.push(await storeExtra(store, prepared, { ...ids, index: i + 1 }));
  await store.create(id, {
    ...submissionRecord(submission, { uid: user.uid, email: user.email, image, images }),
    safeSearch: main.safeSearch,
    people: main.people,
  });
  log("submission stored", { uid: user.uid, feed: submission.feed, id });

  const notified = await notify(submission, user);
  return { submissionId: id, notified };
}

/** Who a submission is from, for the reviewer: the member's username. */
async function senderName(user, members, log) {
  if (!members) return "a member";
  try {
    return (await members.get(user.uid))?.username || "a member";
  } catch (error) {
    log("member lookup failed; submitting without a username", { uid: user.uid, message: error.message });
    return "a member";
  }
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
 * Reviews a pending submission: `reject` records the decision and
 * `publish` puts it in its feed's queue to be posted at the next scheduled
 * time. An edit of an existing post (kind `edit`, see posts.js) is applied
 * to the post at once on `publish`; it cannot be queued.
 */
export async function reviewSubmission({ id, action, note }, admin, deps) {
  const { store, log = () => {} } = deps;
  const data = await store.get(id);
  if (!data) throw new AppError("not-found", "That submission no longer exists.");
  if (data.status !== "pending") throw new AppError("failed-precondition", notPending(data.status));

  const reviewedBy = { by: admin.uid, byEmail: admin.email, note, action };
  if (action === "reject") {
    await store.setReview(id, { status: "rejected", review: reviewedBy });
    log("submission rejected", { id, by: admin.uid });
    return { status: "rejected" };
  }
  if (data.kind === "edit") {
    const result = await applyEditSubmission(data, deps);
    await store.setReview(id, { status: "approved", review: { ...reviewedBy, ...result } });
    log("post edit applied", { id, by: admin.uid, ...result });
    return { status: "approved", ...result };
  }
  return enqueue({ feed: data.feed, id, note }, admin, deps);
}

function notPending(status) {
  return {
    queued: "That submission is already queued.",
    posting: "That submission is being posted right now.",
    approved: "That submission was already posted.",
    rejected: "That submission was rejected; it cannot be reviewed again.",
  }[status] ?? "That submission is not pending.";
}

/**
 * Makes the post: the photos' renditions go to Storage and the document
 * to Firestore, credited to the submitter with the username they have
 * now (the name the submission was from is kept as `credit.name`). The slug comes from the
 * title and the submission id, so a retry after a failure lands on the
 * same post rather than a second one.
 */
async function publishSubmission(data, { store, posts, members, siteUrl, now, push, log = () => {} }) {
  const slug = slugFor(data.title, data.feed, data.id);
  const done = { postId: slug, postUrl: postUrl(siteUrl, data.feed, slug), postStatus: "published" };
  if (await posts.exists(slug)) {
    log("post already published; keeping it", { id: data.id, slug });
    return done;
  }
  const image = await publishImage(posts, slug, await store.readImage(data.image.path));
  const images = [];
  for (const extra of data.images ?? []) images.push(await publishImage(posts, slug, await store.readImage(extra.path)));
  const credit = { uid: data.uid ?? null, username: "", name: data.from ?? "" };
  if (data.uid && members) {
    try {
      credit.username = (await members.get(data.uid))?.username ?? "";
    } catch (error) {
      log("member lookup failed; posting with the typed name", { id: data.id, uid: data.uid, message: error.message });
    }
  }
  const doc = postDocument({
    slug,
    feed: data.feed,
    title: data.title,
    publishedAt: now instanceof Date ? now : new Date(),
    body: data.description ?? "",
    bodyFormat: "text",
    image,
    images,
    credit,
    source: { system: "submission", id: data.id },
  });
  await posts.create(slug, doc);
  if (push) await push.postPublished(doc);
  return done;
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
  if (data.kind === "edit") throw new ValidationError("Edits are applied on review, not queued.");
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

/**
 * Posts the oldest queued submission of a feed to the site. Run by the
 * scheduled functions at the feed's posting times, and by the API on
 * request. Returns the posted submission, or null when the queue is empty.
 */
export async function submitNext(feed, deps) {
  const { store, now } = deps;
  parseFeed(feed);
  const head = await store.queueHead(feed);
  if (!head) return { posted: null, ...(await queueInfo(feed, { store, now })) };
  return postEntry(head, deps);
}

/**
 * Posts one queued submission right away, ahead of its slot, for an
 * administrator (the "Post now" button). The entry need not be at the
 * front of its queue; the rest of the queue keeps its order.
 */
export async function postNow({ feed, id }, admin, deps) {
  const { store, log = () => {} } = deps;
  parseFeed(feed);
  if (typeof id !== "string" || !id) throw new ValidationError("Submission id is required.");
  const data = await store.get(id);
  if (!data) throw new AppError("not-found", "That submission no longer exists.");
  if (data.feed !== feed) throw new ValidationError(`That submission is for the ${data.feed} feed.`);
  if (data.status !== "queued") {
    throw new AppError("failed-precondition", data.status === "posting" ? "That submission is being posted right now." : "That submission is not in the queue.");
  }
  log("posting queued submission now", { id, feed, by: admin.uid });
  return postEntry(data, deps);
}

/** Publishes a queued entry: queued -> posting -> approved, or back to queued with the error. */
async function postEntry(entry, deps) {
  const { store, log = () => {}, now } = deps;
  const feed = entry.feed;
  await store.transition(entry.id, {
    from: ["queued"],
    patch: { status: "posting" },
    message: "That submission is being posted right now.",
  });
  let result;
  try {
    result = await publishSubmission(entry, deps);
  } catch (error) {
    await store.transition(entry.id, {
      from: ["posting"],
      patch: { status: "queued", "queue.lastError": error.message },
      message: "unreachable",
    });
    throw error;
  }
  const q = entry.queue ?? {};
  await store.transition(entry.id, {
    from: ["posting"],
    patch: {
      status: "approved",
      review: { action: "publish", by: q.by ?? null, byEmail: q.byEmail ?? null, note: q.note ?? "", at: store.timestamp(), ...result },
      "queue.postedAt": store.timestamp(),
      "queue.lastError": null,
    },
    message: "unreachable",
  });
  log("queued submission posted", { id: entry.id, feed, ...result });
  const posted = await serialise(await store.get(entry.id), store);
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

/**
 * One additional photo as the API shows it: a new upload held for review
 * (with what Vision saw), or, on an edit, a picture the post keeps
 * (`kept`, shown from its published renditions).
 */
function serialisePhoto(extra, store) {
  if (extra.keep) {
    return { kept: true, width: extra.width ?? null, height: extra.height ?? null, photoUrl: extra.photoUrl ?? null, thumbUrl: extra.thumbUrl ?? null, safeSearch: null, people: null };
  }
  return {
    kept: false,
    width: extra.width ?? null,
    height: extra.height ?? null,
    photoUrl: extra.path ? store.imageUrl(extra.path, extra.token) : null,
    thumbUrl: extra.thumbPath ? store.imageUrl(extra.thumbPath, extra.token) : null,
    safeSearch: extra.safeSearch ?? null,
    people: extra.people ?? null,
  };
}

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
    kind: item.kind === "edit" ? "edit" : "post",
    post: item.kind === "edit" ? (item.post ?? null) : null,
    changes: item.kind === "edit" ? (item.changes ?? null) : null,
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
    images: (item.images ?? []).map((extra) => serialisePhoto(extra, store)),
    safeSearch: item.safeSearch ?? null,
    people: item.people ?? null,
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
