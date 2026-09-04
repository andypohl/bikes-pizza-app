// Firestore + Cloud Storage persistence for submissions. Everything the
// service layer (submissions.js) needs, behind a small interface so tests
// can use an in-memory store instead.
//
// Items handed back have `id`, `createdAt` and `review.at` as Dates, not
// Firestore Timestamps.

import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

import { AppError } from "./errors.js";

const toDate = (v) => v?.toDate?.() ?? (v instanceof Date ? v : null);

function item(snap) {
  const data = snap.data();
  return {
    id: snap.id,
    ...data,
    createdAt: toDate(data.createdAt),
    review: data.review ? { ...data.review, at: toDate(data.review.at) } : null,
    queue: data.queue ? { ...data.queue, at: toDate(data.queue.at), postedAt: toDate(data.queue.postedAt) } : null,
  };
}

export function firestoreSubmissionStore(db, bucket) {
  const col = db.collection("submissions");
  return {
    newId: () => col.doc().id,
    newToken: () => randomUUID(),

    async create(id, record) {
      await col.doc(id).set({ ...record, createdAt: FieldValue.serverTimestamp() });
    },

    async get(id) {
      const snap = await col.doc(id).get();
      return snap.exists ? item(snap) : null;
    },

    /** Newest first; `afterId` is the last id of the previous page. */
    async list({ status, limit, afterId }) {
      let q = col;
      if (status) q = q.where("status", "==", status);
      q = q.orderBy("createdAt", "desc");
      if (afterId) {
        const cursor = await col.doc(afterId).get();
        if (!cursor.exists) throw new AppError("invalid-argument", "Unknown page cursor.");
        q = q.startAfter(cursor);
      }
      const snap = await q.limit(limit + 1).get();
      return { items: snap.docs.slice(0, limit).map(item), hasMore: snap.docs.length > limit };
    },

    /** A server timestamp for fields set through transition(). */
    timestamp: () => FieldValue.serverTimestamp(),

    /**
     * Atomically applies `patch` to the submission if its status is one of
     * `from`; otherwise throws `failed-precondition` with `message`.
     */
    async transition(id, { from, patch, message }) {
      return db.runTransaction(async (tx) => {
        const ref = col.doc(id);
        const snap = await tx.get(ref);
        if (!snap.exists) throw new AppError("not-found", "That submission no longer exists.");
        if (!from.includes(snap.get("status"))) throw new AppError("failed-precondition", message);
        tx.update(ref, patch);
        return item(snap);
      });
    },

    queueQuery: (feed) => col.where("status", "==", "queued").where("feed", "==", feed),

    /** Queued submissions for a feed, oldest first. */
    async queueList(feed) {
      const snap = await this.queueQuery(feed).orderBy("queue.at", "asc").limit(200).get();
      return snap.docs.map(item);
    },

    async queueHead(feed) {
      const snap = await this.queueQuery(feed).orderBy("queue.at", "asc").limit(1).get();
      return snap.empty ? null : item(snap.docs[0]);
    },

    async queueLength(feed) {
      const snap = await this.queueQuery(feed).count().get();
      return snap.data().count;
    },

    async setReview(id, { status, review }) {
      await col.doc(id).update({ status, review: { ...review, at: FieldValue.serverTimestamp() } });
    },

    async setImageToken(id, token) {
      await col.doc(id).update({ "image.token": token });
    },

    async putImage(path, bytes, { contentType, metadata }) {
      await bucket.file(path).save(bytes, { contentType, resumable: false, metadata: { metadata } });
    },

    async readImage(path) {
      const [bytes] = await bucket.file(path).download();
      return bytes;
    },

    /** Makes the object fetchable with `imageUrl(path, token)`. */
    async tagImage(path, token) {
      await bucket.file(path).setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
    },

    imageUrl(path, token) {
      return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    },
  };
}
