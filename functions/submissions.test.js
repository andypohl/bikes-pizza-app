import assert from "node:assert/strict";
import { test } from "node:test";

import { ValidationError } from "./account.js";
import { AppError } from "./errors.js";
import {
  createSubmission,
  dequeue,
  enqueue,
  getSubmission,
  listSubmissions,
  parseListQuery,
  parseReview,
  queueInfo,
  queueItems,
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

const png = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
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
  full: { bytes: Buffer.from("full"), width: 20, height: 10 },
  thumb: { bytes: Buffer.from("thumb"), width: 4, height: 2 },
});

async function seeded() {
  const store = memoryStore();
  await createSubmission(body, user, { store, processImage, notify: async () => true });
  await createSubmission({ ...body, feed: "pizza", title: "Slice" }, user, {
    store,
    processImage,
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
    notify: async (s, u) => notified.push([s.title, u.uid]) && true,
  });
  assert.deepEqual(result, { submissionId: "s1", notified: true });
  const doc = store.docs.get("s1");
  assert.equal(doc.status, "pending");
  assert.equal(doc.image.token, "tok1");
  assert.equal(doc.image.width, 20);
  assert.equal(store.files.get("submissions/s1/photo.jpg").metadata.firebaseStorageDownloadTokens, "tok1");
  assert.equal(store.files.get("submissions/s1/thumb.jpg").bytes.toString(), "thumb");
  assert.deepEqual(notified, [["Trek 970", "u1"]]);
});

test("createSubmission rejects invalid input before touching the store", async () => {
  const store = memoryStore();
  await assert.rejects(
    createSubmission({ ...body, feed: "blog" }, user, { store, processImage, notify: async () => true }),
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

test("reviewSubmission rejects without touching Ghost", async () => {
  const store = await seeded();
  const ghost = { uploadImage: () => assert.fail("uploaded") };
  const result = await reviewSubmission({ id: "s1", action: "reject", note: "no" }, admin, { store, ghost });
  assert.deepEqual(result, { status: "rejected" });
  const doc = store.docs.get("s1");
  assert.equal(doc.status, "rejected");
  assert.equal(doc.review.byEmail, "admin@example.com");
  assert.equal(doc.review.note, "no");
});

test("reviewSubmission drafts to Ghost and records the post", async () => {
  const store = await seeded();
  const calls = [];
  const ghost = {
    uploadImage: async ({ bytes, filename }) => calls.push(["upload", bytes.toString(), filename]) && "https://cdn/x.jpg",
    createPost: async (post) => calls.push(["post", post.status, post.title]) && { id: "p1", url: null, status: "draft" },
  };
  const result = await reviewSubmission({ id: "s2", action: "draft", note: "" }, admin, {
    store,
    ghost,
    authorEmail: "robot@example.com",
  });
  assert.deepEqual(result, { status: "approved", postId: "p1", postUrl: null, postStatus: "draft" });
  assert.deepEqual(calls, [
    ["upload", "full", "pizza-submission.jpg"],
    ["post", "draft", "Slice"],
  ]);
  assert.equal(store.docs.get("s2").review.postId, "p1");
});

const NOW = new Date("2026-09-04T15:30:00Z"); // 10:30 CDT

test("reviewSubmission publish queues instead of posting, and refuses re-review", async () => {
  const store = await seeded();
  const ghost = { uploadImage: () => assert.fail("posted immediately") };
  await assert.rejects(
    reviewSubmission({ id: "nope", action: "reject", note: "" }, admin, { store, ghost }),
    (e) => e instanceof AppError && e.code === "not-found",
  );
  const result = await reviewSubmission({ id: "s1", action: "publish", note: "nice" }, admin, { store, ghost, now: NOW });
  assert.equal(result.status, "queued");
  assert.equal(result.position, 1);
  assert.equal(result.length, 1);
  assert.equal(result.nextPostAt, "2026-09-04T17:00:00.000Z");
  const doc = store.docs.get("s1");
  assert.equal(doc.status, "queued");
  assert.equal(doc.queue.byEmail, "admin@example.com");
  assert.equal(doc.queue.note, "nice");
  await assert.rejects(
    reviewSubmission({ id: "s1", action: "reject", note: "" }, admin, { store, ghost }),
    (e) => e.code === "failed-precondition" && /already queued/.test(e.message),
  );
});

test("enqueue and dequeue check the feed and the status", async () => {
  const store = await seeded();
  await assert.rejects(enqueue({ feed: "pizza", id: "s1" }, admin, { store }), (e) => /bikes feed/.test(e.message));
  await assert.rejects(enqueue({ feed: "blog", id: "s1" }, admin, { store }), ValidationError);
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

test("queueInfo and queueItems describe the queue in order", async () => {
  const store = await seeded();
  await createSubmission({ ...body, title: "Third" }, user, { store, processImage, notify: async () => true });
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
  const q = await queueItems("bikes", { store, now: NOW });
  assert.deepEqual(q.items.map((i) => [i.position, i.id, i.status]), [[1, "s3", "queued"], [2, "s1", "queued"]]);
  assert.equal(q.items[0].queue.byEmail, "admin@example.com");
  assert.equal((await queueInfo("pizza", { store, now: NOW })).length, 0);
  await assert.rejects(queueInfo("blog", { store }), ValidationError);
});

test("submitNext posts the oldest entry and leaves the rest queued", async () => {
  const store = await seeded();
  await createSubmission({ ...body, title: "Third" }, user, { store, processImage, notify: async () => true });
  await enqueue({ feed: "bikes", id: "s1", note: "first" }, admin, { store, now: NOW });
  await enqueue({ feed: "bikes", id: "s3", note: "" }, admin, { store, now: NOW });
  const posts = [];
  const ghost = {
    uploadImage: async () => "https://cdn/x.jpg",
    createPost: async (post) => posts.push([post.status, post.title]) && { id: "p1", url: "https://blog/trek", status: "published" },
  };
  const empty = await submitNext("pizza", { store, ghost, now: NOW });
  assert.equal(empty.posted, null);
  assert.equal(empty.length, 0);

  const result = await submitNext("bikes", { store, ghost, now: NOW });
  assert.deepEqual(posts, [["published", "Trek 970"]]);
  assert.equal(result.posted.id, "s1");
  assert.equal(result.posted.status, "approved");
  assert.equal(result.posted.review.postUrl, "https://blog/trek");
  assert.equal(result.posted.review.note, "first");
  assert.equal(result.posted.review.byEmail, "admin@example.com");
  assert.match(result.posted.queue.postedAt, /^2026-/);
  assert.equal(result.length, 1);
  assert.equal((await store.queueHead("bikes")).id, "s3");
});

test("submitNext puts the entry back in the queue when Ghost fails", async () => {
  const store = await seeded();
  await enqueue({ feed: "bikes", id: "s1", note: "" }, admin, { store, now: NOW });
  const ghost = { uploadImage: async () => { throw new Error("ghost down"); } };
  await assert.rejects(submitNext("bikes", { store, ghost, now: NOW }), /ghost down/);
  const doc = store.docs.get("s1");
  assert.equal(doc.status, "queued");
  assert.equal(doc.queue.lastError, "ghost down");
  assert.equal(await store.queueLength("bikes"), 1);
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
