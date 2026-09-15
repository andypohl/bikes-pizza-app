import assert from "node:assert/strict";
import { test } from "node:test";

import sharp from "sharp";

import { ValidationError } from "./account.js";
import { AppError } from "./errors.js";
import { memoryPostStore } from "./fakes.js";
import { SAFE_SEARCH_MESSAGE } from "./vision.js";
import {
  createSubmission,
  dequeue,
  enqueue,
  getSubmission,
  listSubmissions,
  parseListQuery,
  parseReview,
  queueInfo,
  reviewSubmission,
  submitNext,
} from "./submissions.js";

/** In-memory stand-in for submission_store.js. */
export function memoryStore(seed = []) {
  const docs = new Map(seed.map((d) => [d.id, d]));
  const files = new Map();
  const tags = new Map();
  let n = 0;
  return {
    docs,
    files,
    tags,
    newId: () => `s${++n}`,
    newToken: () => `tok${n}`,
    async create(id, record) {
      docs.set(id, { id, ...record, createdAt: new Date(2026, 0, n) });
    },
    async get(id) {
      return docs.get(id) ?? null;
    },
    async list({ status, limit, afterId }) {
      let all = [...docs.values()].sort((a, b) => b.createdAt - a.createdAt);
      if (status) all = all.filter((d) => d.status === status);
      if (afterId) {
        const i = all.findIndex((d) => d.id === afterId);
        if (i < 0) throw new AppError("invalid-argument", "Unknown page cursor.");
        all = all.slice(i + 1);
      }
      return { items: all.slice(0, limit), hasMore: all.length > limit };
    },
    async setReview(id, { status, review }) {
      docs.set(id, { ...docs.get(id), status, review: { ...review, at: new Date(2026, 5, 1) } });
    },
    async pendingEdit(postId) {
      return [...docs.values()].find((d) => d.status === "pending" && d.kind === "edit" && d.post?.id === postId) ?? null;
    },
    timestamp: () => new Date(2026, 5, 1, 12, ++n),
    async transition(id, { from, patch, message }) {
      const doc = docs.get(id);
      if (!doc) throw new AppError("not-found", "That submission no longer exists.");
      if (!from.includes(doc.status)) throw new AppError("failed-precondition", message);
      const next = { ...doc };
      for (const [key, value] of Object.entries(patch)) {
        if (key.includes(".")) {
          const [a, b] = key.split(".");
          next[a] = { ...(next[a] ?? {}), [b]: value };
        } else next[key] = value;
      }
      docs.set(id, next);
      return doc;
    },
    async queueList(feed) {
      return [...docs.values()]
        .filter((d) => d.status === "queued" && d.feed === feed)
        .sort((a, b) => a.queue.at - b.queue.at);
    },
    async queueHead(feed) {
      return (await this.queueList(feed))[0] ?? null;
    },
    async queueLength(feed) {
      return (await this.queueList(feed)).length;
    },
    async setImageToken(id, token) {
      docs.get(id).image.token = token;
    },
    async putImage(path, bytes, options) {
      files.set(path, { bytes, ...options });
    },
    async readImage(path) {
      return files.get(path).bytes;
    },
    async tagImage(path, token) {
      tags.set(path, token);
    },
    imageUrl: (path, token) => `https://files.test/${path}?token=${token}`,
  };
}

// A real (tiny) image: publishing makes renditions of it.
const pngBytes = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#cc4422" } }).png().toBuffer();
const png = pngBytes.toString("base64");
const body = {
  feed: "bikes",
  title: "Trek 970",
  from: "Ada",
  description: "Story",
  image: { data: png, contentType: "image/png" },
};
const user = { uid: "u1", email: "ada@example.com" };
const admin = { uid: "a1", email: "admin@example.com" };
const processImage = async () => ({
  full: { bytes: pngBytes, width: 640, height: 480 },
  thumb: { bytes: Buffer.from("thumb"), width: 4, height: 2 },
});
const CLEAN = { adult: "VERY_UNLIKELY", spoof: "UNLIKELY", medical: "VERY_UNLIKELY", violence: "VERY_UNLIKELY", racy: "UNLIKELY" };
const NOBODY = { faces: 0, faceConfidence: 0, persons: 0, personScore: 0 };
const safeSearch = async () => ({ ok: true, likelihoods: CLEAN, people: NOBODY });

async function seeded() {
  const store = memoryStore();
  await createSubmission(body, user, { store, processImage, safeSearch, notify: async () => true });
  await createSubmission({ ...body, feed: "pizza", title: "Slice" }, user, {
    store,
    processImage,
    safeSearch,
    notify: async () => false,
  });
  return store;
}

test("createSubmission stores the photos, the record and a download token", async () => {
  const store = memoryStore();
  const notified = [];
  const result = await createSubmission(body, user, {
    store,
    processImage,
    safeSearch,
    notify: async (s, u) => notified.push([s.title, u.uid]) && true,
  });
  assert.deepEqual(result, { submissionId: "s1", notified: true });
  const doc = store.docs.get("s1");
  assert.equal(doc.status, "pending");
  assert.equal(doc.image.token, "tok1");
  assert.equal(doc.image.width, 640);
  assert.equal(store.files.get("submissions/s1/photo.jpg").metadata.firebaseStorageDownloadTokens, "tok1");
  assert.equal(store.files.get("submissions/s1/thumb.jpg").bytes.toString(), "thumb");
  assert.deepEqual(notified, [["Trek 970", "u1"]]);
});

test("createSubmission inspects the processed photo and records the result", async () => {
  const store = memoryStore();
  const inspected = [];
  await createSubmission(body, user, {
    store,
    processImage,
    safeSearch: async (bytes) => inspected.push(bytes.length) && { ok: true, likelihoods: CLEAN, people: NOBODY },
    notify: async () => true,
  });
  assert.deepEqual(inspected, [pngBytes.length]);
  assert.deepEqual(store.docs.get("s1").safeSearch, CLEAN);
  assert.deepEqual(store.docs.get("s1").people, NOBODY);
  const item = (await listSubmissions({ status: "", limit: 5, afterId: "" }, { store })).items[0];
  assert.deepEqual(item.safeSearch, CLEAN);
  assert.deepEqual(item.people, NOBODY);
});

test("createSubmission stores nothing when the photo fails SafeSearch", async () => {
  const store = memoryStore();
  let notified = false;
  await assert.rejects(
    createSubmission(body, user, {
      store,
      processImage,
      safeSearch: async () => {
        throw new AppError("invalid-argument", SAFE_SEARCH_MESSAGE);
      },
      notify: async () => (notified = true),
    }),
    (e) => e.code === "invalid-argument" && e.message === SAFE_SEARCH_MESSAGE,
  );
  assert.equal(store.docs.size, 0);
  assert.equal(store.files.size, 0);
  assert.equal(notified, false);
});

test("createSubmission rejects invalid input before touching the store", async () => {
  const store = memoryStore();
  await assert.rejects(
    createSubmission({ ...body, feed: "news" }, user, { store, processImage, safeSearch, notify: async () => true }),
    ValidationError,
  );
  assert.equal(store.docs.size, 0);
});

test("parseReview validates id, action and trims the note", () => {
  assert.deepEqual(parseReview({ id: "s1", action: "reject", note: "  meh " }), {
    id: "s1",
    action: "reject",
    note: "meh",
  });
  assert.equal(parseReview({ id: "s1", action: "publish" }).note, "");
  assert.throws(() => parseReview({ id: "", action: "publish" }), ValidationError);
  assert.throws(() => parseReview({ id: "s1", action: "approve" }), ValidationError);
  assert.throws(() => parseReview(null), ValidationError);
});

test("reviewSubmission rejects without touching the posts", async () => {
  const store = await seeded();
  const posts = memoryPostStore();
  const result = await reviewSubmission({ id: "s1", action: "reject", note: "no" }, admin, { store, posts });
  assert.equal(posts.docs.size, 0);
  assert.deepEqual(result, { status: "rejected" });
  const doc = store.docs.get("s1");
  assert.equal(doc.status, "rejected");
  assert.equal(doc.review.byEmail, "admin@example.com");
  assert.equal(doc.review.note, "no");
});

test("draft is no longer a review action", async () => {
  assert.throws(() => parseReview({ id: "s2", action: "draft" }), ValidationError);
});

const NOW = new Date("2026-09-04T15:30:00Z"); // 10:30 CDT

test("reviewSubmission publish queues instead of posting, and refuses re-review", async () => {
  const store = await seeded();
  const posts = memoryPostStore();
  await assert.rejects(
    reviewSubmission({ id: "nope", action: "reject", note: "" }, admin, { store, posts }),
    (e) => e instanceof AppError && e.code === "not-found",
  );
  const result = await reviewSubmission({ id: "s1", action: "publish", note: "nice" }, admin, { store, posts, now: NOW });
  assert.equal(posts.docs.size, 0, "queued, not posted");
  assert.equal(result.status, "queued");
  assert.equal(result.position, 1);
  assert.equal(result.length, 1);
  assert.equal(result.nextPostAt, "2026-09-04T17:00:00.000Z");
  const doc = store.docs.get("s1");
  assert.equal(doc.status, "queued");
  assert.equal(doc.queue.byEmail, "admin@example.com");
  assert.equal(doc.queue.note, "nice");
  await assert.rejects(
    reviewSubmission({ id: "s1", action: "reject", note: "" }, admin, { store, posts }),
    (e) => e.code === "failed-precondition" && /already queued/.test(e.message),
  );
});

test("enqueue and dequeue check the feed and the status", async () => {
  const store = await seeded();
  await assert.rejects(enqueue({ feed: "pizza", id: "s1" }, admin, { store }), (e) => /bikes feed/.test(e.message));
  await assert.rejects(enqueue({ feed: "news", id: "s1" }, admin, { store }), ValidationError);
  await assert.rejects(enqueue({ feed: "bikes", id: "zzz" }, admin, { store }), (e) => e.code === "not-found");
  await assert.rejects(dequeue({ feed: "bikes", id: "s1" }, admin, { store }), (e) => /not in the queue/.test(e.message));
  await enqueue({ feed: "bikes", id: "s1" }, admin, { store, now: NOW });
  await assert.rejects(enqueue({ feed: "bikes", id: "s1" }, admin, { store }), (e) => /already queued/.test(e.message));
  const back = await dequeue({ feed: "bikes", id: "s1" }, admin, { store, now: NOW });
  assert.equal(back.status, "pending");
  assert.equal(back.length, 0);
  assert.equal(store.docs.get("s1").status, "pending");
  assert.equal(store.docs.get("s1").queue, null);
});

test("queueInfo describes the queue", async () => {
  const store = await seeded();
  await createSubmission({ ...body, title: "Third" }, user, { store, processImage, safeSearch, notify: async () => true });
  await enqueue({ feed: "bikes", id: "s3", note: "" }, admin, { store, now: NOW });
  await enqueue({ feed: "bikes", id: "s1", note: "" }, admin, { store, now: NOW });
  const info = await queueInfo("bikes", { store, now: NOW });
  assert.deepEqual(info, {
    feed: "bikes",
    length: 2,
    nextPostAt: "2026-09-04T17:00:00.000Z",
    seconds: 5400,
    countdown: "1h 30m 0s",
    clock: "01:30:00",
  });
  assert.equal((await queueInfo("pizza", { store, now: NOW })).length, 0);
  await assert.rejects(queueInfo("news", { store }), ValidationError);
});

test("submitNext posts the oldest entry as a Firestore post with renditions, and leaves the rest queued", async () => {
  const store = await seeded();
  await createSubmission({ ...body, title: "Third" }, user, { store, processImage, safeSearch, notify: async () => true });
  await enqueue({ feed: "bikes", id: "s1", note: "first" }, admin, { store, now: NOW });
  await enqueue({ feed: "bikes", id: "s3", note: "" }, admin, { store, now: NOW });
  const posts = memoryPostStore();
  const members = { get: async (uid) => ({ email: "x@y.z", username: uid === user.uid ? "ada_bikes" : "" }) };
  const deps = { store, posts, members, siteUrl: "https://example.com", now: NOW };
  const empty = await submitNext("pizza", deps);
  assert.equal(empty.posted, null);
  assert.equal(empty.length, 0);

  const result = await submitNext("bikes", deps);
  const doc = await posts.get("trek-970-s1");
  assert.equal(doc.title, "Trek 970");
  assert.equal(doc.feed, "bikes");
  assert.equal(doc.status, "published");
  assert.equal(doc.publishedAt, NOW.toISOString());
  assert.equal(doc.html, "<p>Story</p>");
  assert.deepEqual(doc.credit, { uid: "u1", username: "ada_bikes", name: "Ada" });
  assert.deepEqual(doc.source, { system: "submission", id: "s1" });
  assert.deepEqual(doc.image.sizes, [400, 640]);
  assert.equal([...posts.files.keys()].filter((k) => k.startsWith("posts/trek-970-s1/")).length, 6);
  assert.equal(result.posted.id, "s1");
  assert.equal(result.posted.status, "approved");
  assert.equal(result.posted.review.postId, "trek-970-s1");
  assert.equal(result.posted.review.postUrl, "https://example.com/post/trek-970-s1/");
  assert.equal(result.posted.review.note, "first");
  assert.equal(result.posted.review.byEmail, "admin@example.com");
  assert.match(result.posted.queue.postedAt, /^2026-/);
  assert.equal(result.length, 1);
  assert.equal((await store.queueHead("bikes")).id, "s3");
});

test("submitNext still posts, with the typed name, when the member lookup fails", async () => {
  const store = await seeded();
  await enqueue({ feed: "bikes", id: "s1", note: "" }, admin, { store, now: NOW });
  const logs = [];
  const posts = memoryPostStore();
  const members = { get: async () => { throw new Error("members down"); } };
  const result = await submitNext("bikes", { store, posts, members, siteUrl: "https://example.com", now: NOW, log: (m, d) => logs.push([m, d]) });
  assert.equal(result.posted.status, "approved");
  assert.deepEqual((await posts.get("trek-970-s1")).credit, { uid: "u1", username: "", name: "Ada" });
  assert.ok(logs.some(([m]) => /member lookup failed/.test(m)));
});

test("submitNext puts the entry back in the queue when publishing fails, and does not post twice", async () => {
  const store = await seeded();
  await enqueue({ feed: "bikes", id: "s1", note: "" }, admin, { store, now: NOW });
  const posts = memoryPostStore();
  posts.putRendition = async () => { throw new Error("storage down"); };
  await assert.rejects(submitNext("bikes", { store, posts, siteUrl: "https://example.com", now: NOW }), /storage down/);
  const doc = store.docs.get("s1");
  assert.equal(doc.status, "queued");
  assert.equal(doc.queue.lastError, "storage down");
  assert.equal(await store.queueLength("bikes"), 1);

  // A post that already exists (a retry after the record failed to update) is kept.
  const again = memoryPostStore();
  await again.create("trek-970-s1", { title: "Trek 970", feed: "bikes", status: "published", publishedAt: "x" });
  const result = await submitNext("bikes", { store, posts: again, siteUrl: "https://example.com", now: NOW });
  assert.equal(result.posted.review.postId, "trek-970-s1");
  assert.equal(again.docs.size, 1);
});

test("parseListQuery applies defaults and limits", () => {
  assert.deepEqual(parseListQuery({}), { status: "", limit: 20, afterId: "" });
  assert.deepEqual(parseListQuery({ status: "pending", limit: "5", after: "s9" }), {
    status: "pending",
    limit: 5,
    afterId: "s9",
  });
  assert.throws(() => parseListQuery({ status: "posted" }), ValidationError);
  assert.throws(() => parseListQuery({ limit: "0" }), ValidationError);
  assert.throws(() => parseListQuery({ limit: "51" }), ValidationError);
  assert.throws(() => parseListQuery({ limit: "abc" }), ValidationError);
});

test("listSubmissions pages newest first and serialises items", async () => {
  const store = await seeded();
  const page1 = await listSubmissions({ status: "", limit: 1, afterId: "" }, { store });
  assert.equal(page1.items.length, 1);
  assert.equal(page1.items[0].id, "s2");
  assert.equal(page1.nextCursor, "s2");
  const item = page1.items[0];
  assert.equal(item.image.thumbUrl, "https://files.test/submissions/s2/thumb.jpg?token=tok2");
  assert.equal(item.submittedBy.email, "ada@example.com");
  assert.equal(item.review, null);
  assert.match(item.createdAt, /^2026-/);
  assert.equal("uid" in item, false);

  const page2 = await listSubmissions({ status: "", limit: 1, afterId: "s2" }, { store });
  assert.equal(page2.items[0].id, "s1");
  assert.equal(page2.nextCursor, null);

  const pending = await listSubmissions({ status: "rejected", limit: 20, afterId: "" }, { store });
  assert.deepEqual(pending, { items: [], nextCursor: null });
});

test("getSubmission mints a token for photos stored without one", async () => {
  const store = memoryStore([
    {
      id: "old",
      feed: "pizza",
      title: "Old",
      from: "F",
      uid: "u9",
      email: "f@x.y",
      status: "approved",
      createdAt: new Date(2025, 0, 1),
      image: { path: "submissions/old/photo.jpg", thumbPath: "submissions/old/thumb.jpg" },
      review: { action: "publish", at: new Date(2025, 0, 2), by: "a1", postId: "p9", postUrl: "https://blog/old" },
    },
  ]);
  const item = await getSubmission("old", { store });
  assert.equal(item.image.photoUrl, "https://files.test/submissions/old/photo.jpg?token=tok0");
  assert.equal(store.tags.get("submissions/old/thumb.jpg"), "tok0");
  assert.equal(store.docs.get("old").image.token, "tok0");
  assert.equal(item.review.postUrl, "https://blog/old");
  assert.equal(item.review.note, "");
  await assert.rejects(getSubmission("missing", { store }), (e) => e.code === "not-found");
});

// ---- edits of existing posts (posts.js) ------------------------------------

/** A pending edit as posts.js stores one, plus the post it is for. */
async function seededEdit({ withPhoto = true } = {}) {
  const store = memoryStore();
  if (withPhoto) await store.putImage("submissions/e1/photo.jpg", pngBytes, { contentType: "image/jpeg", metadata: {} });
  await store.create("e1", {
    kind: "edit",
    post: { id: "trek-970-abc123", slug: "trek-970-abc123", title: "Trek 970", feed: "bikes", url: "https://example.com/post/trek-970-abc123/", imageUrl: null },
    feed: "bikes",
    title: "Trek 970 (restored)",
    from: "Ada",
    description: "Story",
    changes: { title: "Trek 970 (restored)", image: withPhoto },
    uid: "u1",
    email: "ada@example.com",
    status: "pending",
    image: withPhoto ? { path: "submissions/e1/photo.jpg", thumbPath: "submissions/e1/thumb.jpg", contentType: "image/jpeg", width: 640, height: 480, token: "t" } : null,
    review: null,
  });
  const posts = memoryPostStore();
  await posts.create("trek-970-abc123", {
    title: "Trek 970",
    feed: "bikes",
    status: "published",
    publishedAt: "2026-09-01T00:00:00.000Z",
    body: "Story",
    bodyFormat: "text",
    html: "<p>Story</p>",
    image: null,
    credit: { uid: "u1", username: "ada", name: "Ada" },
  });
  return { store, posts };
}

test("reviewing an edit with publish applies it to the post at once", async () => {
  const { store, posts } = await seededEdit();
  const result = await reviewSubmission({ id: "e1", action: "publish", note: "" }, admin, { store, posts, siteUrl: "https://example.com" });
  assert.deepEqual(result, { status: "approved", postId: "trek-970-abc123", postUrl: "https://example.com/post/trek-970-abc123/", postStatus: "published" });
  const post = await posts.get("trek-970-abc123");
  assert.equal(post.title, "Trek 970 (restored)");
  assert.deepEqual(post.image.sizes, [400, 640]);
  assert.equal([...posts.files.keys()].some((k) => k.startsWith("posts/trek-970-abc123/")), true);
  const doc = store.docs.get("e1");
  assert.equal(doc.status, "approved");
  assert.equal(doc.review.postId, "trek-970-abc123");
  assert.equal(doc.review.action, "publish");
  await assert.rejects(reviewSubmission({ id: "e1", action: "publish", note: "" }, admin, { store, posts }), /already posted/);
});

test("an edit can be rejected but not queued", async () => {
  const { store, posts } = await seededEdit({ withPhoto: false });
  await assert.rejects(enqueue({ feed: "bikes", id: "e1" }, admin, { store }), /applied on review/);
  assert.equal(store.docs.get("e1").status, "pending");
  const result = await reviewSubmission({ id: "e1", action: "reject", note: "no" }, admin, { store, posts });
  assert.deepEqual(result, { status: "rejected" });
  assert.equal((await posts.get("trek-970-abc123")).title, "Trek 970");
});

test("edits are serialised with their kind, post and changes", async () => {
  const { store } = await seededEdit({ withPhoto: false });
  const item = await getSubmission("e1", { store });
  assert.equal(item.kind, "edit");
  assert.equal(item.post.id, "trek-970-abc123");
  assert.deepEqual(item.changes, { title: "Trek 970 (restored)", image: false });
  assert.equal(item.image.photoUrl, null);
  const plain = (await listSubmissions(parseListQuery({}), { store: await seeded() })).items[0];
  assert.equal(plain.kind, "post");
  assert.equal(plain.post, null);
  assert.equal(plain.changes, null);
});
