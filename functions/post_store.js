// Firestore + Cloud Storage persistence for posts, behind a small interface
// so the service modules and the tests can use an in-memory store instead.
// Documents come back as plain objects with `slug` filled in.

import { FieldValue } from "firebase-admin/firestore";

import { renditionPath } from "./renditions.js";

export const POSTS = "posts";

/** A year of caching: rendition paths carry a version, so they never change. */
const RENDITION_CACHE = "public, max-age=31536000, immutable";

export function firestorePostStore(db, bucket) {
  const col = db.collection(POSTS);
  const item = (snap) => (snap.exists ? { ...snap.data(), slug: snap.id } : null);
  return {
    async get(slug) {
      return item(await col.doc(slug).get());
    },

    async exists(slug) {
      return (await col.doc(slug).get()).exists;
    },

    async create(slug, doc) {
      await col.doc(slug).set({ ...doc, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    },

    async patch(slug, fields) {
      await col.doc(slug).update({ ...fields, updatedAt: FieldValue.serverTimestamp() });
    },

    /** A member's published posts, newest first. */
    async listByUid(uid) {
      const snap = await col.where("status", "==", "published").where("credit.uid", "==", uid).orderBy("publishedAt", "desc").get();
      return snap.docs.map(item);
    },

    /** A feed's published posts, newest first, at most `limit`. */
    async listByFeed(feed, { limit = 200 } = {}) {
      const snap = await col.where("status", "==", "published").where("feed", "==", feed).orderBy("publishedAt", "desc").limit(limit).get();
      return snap.docs.map(item);
    },

    /** Every published post with a credit, newest first (the users page groups them). */
    async listCredited() {
      const snap = await col.where("status", "==", "published").orderBy("publishedAt", "desc").get();
      return snap.docs.map(item).filter((p) => p.credit?.uid);
    },

    /** Renames a member on every post they are credited for; returns how many. */
    async setUsername(uid, username) {
      const snap = await col.where("credit.uid", "==", uid).get();
      if (snap.empty) return 0;
      const batch = db.batch();
      for (const doc of snap.docs) batch.update(doc.ref, { "credit.username": username, updatedAt: FieldValue.serverTimestamp() });
      await batch.commit();
      return snap.size;
    },

    async putRendition(slug, version, { name, bytes, contentType }) {
      await bucket.file(renditionPath(slug, version, name)).save(bytes, {
        contentType,
        resumable: false,
        metadata: { cacheControl: RENDITION_CACHE },
      });
    },

    /**
     * Stores a picture used inside a story (posts/inline/{name}), public
     * like the renditions, and returns its URL.
     */
    async putInline(name, bytes, contentType) {
      const path = `posts/inline/${name}`;
      await bucket.file(path).save(bytes, { contentType, resumable: false, metadata: { cacheControl: RENDITION_CACHE } });
      return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media`;
    },

    /** The URL prefix a client appends a rendition's file name to. */
    renditionBase(slug, version) {
      const dir = encodeURIComponent(`${renditionPath(slug, version, "")}`);
      return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${dir}`;
    },
  };
}

/**
 * Appends a file name to a rendition base: the name is part of the object
 * path, so it is percent-encoded into it, and `alt=media` asks Storage
 * for the bytes rather than metadata.
 */
export function renditionUrl(base, name) {
  return `${base}${encodeURIComponent(name)}?alt=media`;
}
