// Firestore + Cloud Storage persistence for posts, behind a small interface
// so the service modules and the tests can use an in-memory store instead.
// Documents come back as plain objects with `slug` filled in.

import { FieldValue } from "firebase-admin/firestore";

import { countDeltas, applyDeltas } from "./reactions.js";
import { renditionPath } from "./renditions.js";

export const POSTS = "posts";
/** Subcollection of a post: one document per member who reacted, by uid. */
export const REACTIONS = "reactions";

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

    /**
     * Renames a member on every post they are credited for and on every
     * reaction they gave; returns how many posts changed.
     */
    async setUsername(uid, username) {
      const [credited, reacted] = await Promise.all([
        col.where("credit.uid", "==", uid).get(),
        db.collectionGroup(REACTIONS).where("uid", "==", uid).get(),
      ]);
      if (credited.empty && reacted.empty) return 0;
      const batch = db.batch();
      for (const doc of credited.docs) batch.update(doc.ref, { "credit.username": username, updatedAt: FieldValue.serverTimestamp() });
      for (const doc of reacted.docs) batch.update(doc.ref, { username });
      await batch.commit();
      return credited.size;
    },

    /** Every reaction record of a post (`{uid, username, picks, updatedAt}`). */
    async listReactions(slug) {
      const snap = await col.doc(slug).collection(REACTIONS).get();
      return snap.docs.map((d) => ({ ...d.data(), uid: d.id }));
    },

    /**
     * Replaces a member's picks on a post and moves the post's tallies
     * accordingly, in one transaction so two members reacting at once
     * both count. Returns the post's tallies as they now stand.
     */
    async setReaction(slug, uid, picks, { username = "" } = {}) {
      const postRef = col.doc(slug);
      const ownRef = postRef.collection(REACTIONS).doc(uid);
      return db.runTransaction(async (tx) => {
        const [post, own] = await Promise.all([tx.get(postRef), tx.get(ownRef)]);
        if (!post.exists) throw new Error(`no post ${slug}`);
        const deltas = countDeltas(own.exists ? own.data().picks : {}, picks);
        const reactions = applyDeltas(post.data().reactions, deltas);
        if (Object.keys(deltas).length) tx.update(postRef, { reactions });
        tx.set(ownRef, { uid, username, picks, updatedAt: FieldValue.serverTimestamp() });
        return { reactions };
      });
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
