// Firestore persistence for comments and what goes with them: the
// comments under a post (posts/{slug}/comments/{id}, each with likes/{uid}
// and reports/{uid} beneath), the mention notices under a member
// (members/{uid}/notices/{id}) and the moderation word lists
// (settings/moderation). Behind a small interface so comments.js and the
// tests can use an in-memory store (fakes.js) instead.
//
// Every change to a post's comments goes through `transact`, which reads
// the post, all of its comments and, when asked, the caller's member
// record and their like and report on one comment, hands them to a
// function that decides the new state, and writes what it returns in one
// transaction. Reading the whole subcollection keeps the post's counts
// and the newest comment times exact without extra indexes; a post has
// tens of comments, not thousands.

import { FieldValue } from "firebase-admin/firestore";

export const COMMENTS = "comments";
export const LIKES = "likes";
export const REPORTS = "reports";
export const NOTICES = "notices";

const withId = (snap) => ({ ...snap.data(), id: snap.id });
/** The post's slug and the comment's id from a document somewhere under posts/{slug}/comments/{id}. */
function placeOf(ref) {
  const parts = ref.path.split("/");
  const at = parts.indexOf(COMMENTS);
  return { slug: parts[at - 1], id: parts[at + 1] };
}

export function firestoreCommentStore(db) {
  const posts = db.collection("posts");
  const members = db.collection("members");
  const commentsOf = (slug) => posts.doc(slug).collection(COMMENTS);

  return {
    /** Every comment of a post, whatever its status, oldest first. */
    async all(slug) {
      const snap = await commentsOf(slug).orderBy("createdAt").get();
      return snap.docs.map(withId);
    },

    /** Who liked a comment: `[{uid, username, at}]`, oldest first. */
    async likes(slug, id) {
      const snap = await commentsOf(slug).doc(id).collection(LIKES).orderBy("at").get();
      return snap.docs.map((d) => ({ ...d.data(), uid: d.id }));
    },

    /**
     * Runs `decide` with the post, its comments and (with `uid`) the
     * member's record and (with `id` too) their like and report on that
     * comment, then writes what it returns: `comments` (id to the whole
     * document, or null to delete it), `post` (fields to update), `member`
     * (fields to merge), `like` and `report` (the document, or null to
     * delete it) and `clearReports` (drop every report on the comment).
     * Resolves to `decide`'s `result`. Deleted comments lose their likes
     * and reports afterwards.
     */
    async transact(slug, { uid, id } = {}, decide) {
      const postRef = posts.doc(slug);
      const deleted = [];
      const result = await db.runTransaction(async (tx) => {
        const commentRef = id ? commentsOf(slug).doc(id) : null;
        const [post, comments, member, like, report] = await Promise.all([
          tx.get(postRef),
          tx.get(commentsOf(slug).orderBy("createdAt")),
          uid ? tx.get(members.doc(uid)) : null,
          commentRef && uid ? tx.get(commentRef.collection(LIKES).doc(uid)) : null,
          commentRef && uid ? tx.get(commentRef.collection(REPORTS).doc(uid)) : null,
        ]);
        if (!post.exists) throw new Error(`no post ${slug}`);
        const out = await decide({
          post: { ...post.data(), slug },
          comments: comments.docs.map(withId),
          member: member?.exists ? member.data() : null,
          like: like?.exists ? { ...like.data(), uid } : null,
          report: report?.exists ? { ...report.data(), uid } : null,
        });
        // Every read comes before the first write, as Firestore requires.
        const reports = out.clearReports && commentRef ? await tx.get(commentRef.collection(REPORTS)) : null;
        for (const [cid, data] of Object.entries(out.comments ?? {})) {
          const ref = commentsOf(slug).doc(cid);
          if (data === null) {
            tx.delete(ref);
            deleted.push(ref);
          } else {
            const { id: _id, ...fields } = data;
            tx.set(ref, fields);
          }
        }
        if (out.post) tx.update(postRef, { ...out.post });
        if (out.member && uid) tx.set(members.doc(uid), out.member, { merge: true });
        if (out.like !== undefined && commentRef && uid) {
          if (out.like === null) tx.delete(commentRef.collection(LIKES).doc(uid));
          else tx.set(commentRef.collection(LIKES).doc(uid), out.like);
        }
        if (out.report !== undefined && commentRef && uid) {
          if (out.report === null) tx.delete(commentRef.collection(REPORTS).doc(uid));
          else tx.set(commentRef.collection(REPORTS).doc(uid), out.report);
        }
        if (reports) for (const doc of reports.docs) tx.delete(doc.ref);
        return out.result;
      });
      for (const ref of deleted) await db.recursiveDelete(ref);
      return result;
    },

    /** The report reasons given on a comment: `[{uid, reason, at}]`. */
    async reports(slug, id) {
      const snap = await commentsOf(slug).doc(id).collection(REPORTS).get();
      return snap.docs.map((d) => ({ ...d.data(), uid: d.id }));
    },

    /** Comments across every post, newest first: `pending`, `reported` (reported at least once) or `recent` (published). */
    async queue(name, { limit = 50 } = {}) {
      const group = db.collectionGroup(COMMENTS);
      const query =
        name === "pending"
          ? group.where("status", "==", "pending").orderBy("createdAt", "desc")
          : name === "reported"
            ? group.where("reportCount", ">", 0).orderBy("reportCount", "desc").orderBy("createdAt", "desc")
            : group.where("status", "==", "published").orderBy("createdAt", "desc");
      const snap = await query.limit(limit).get();
      return snap.docs.map((d) => ({ ...withId(d), slug: placeOf(d.ref).slug }));
    },

    /** Every comment a member wrote, with the post's slug on each. */
    async byUid(uid) {
      const snap = await db.collectionGroup(COMMENTS).where("uid", "==", uid).get();
      return snap.docs.map((d) => ({ ...withId(d), slug: placeOf(d.ref).slug }));
    },

    /** Every like a member gave: `[{slug, id, at}]` (the comment's place and when). */
    async likesByUid(uid) {
      const snap = await db.collectionGroup(LIKES).where("uid", "==", uid).get();
      return snap.docs.map((d) => ({ ...placeOf(d.ref), ...d.data() }));
    },

    /** Every report a member made: `[{slug, id, reason, at}]`. */
    async reportsByUid(uid) {
      const snap = await db.collectionGroup(REPORTS).where("uid", "==", uid).get();
      return snap.docs.map((d) => ({ ...placeOf(d.ref), ...d.data() }));
    },

    /** Writes one notice under each of `uids`. */
    async addNotices(uids, notice) {
      if (!uids.length) return;
      const batch = db.batch();
      for (const uid of uids) batch.set(members.doc(uid).collection(NOTICES).doc(), notice);
      await batch.commit();
    },

    /** A member's notices after `since` (ISO), oldest first. */
    async listNotices(uid, since) {
      let query = members.doc(uid).collection(NOTICES).orderBy("at");
      if (since) query = query.where("at", ">", since);
      const snap = await query.limit(500).get();
      return snap.docs.map(withId);
    },

    /** Deletes every notice older than `before` (ISO), across members; returns how many. */
    async purgeNotices(before) {
      const snap = await db.collectionGroup(NOTICES).where("at", "<", before).limit(500).get();
      if (snap.empty) return 0;
      const batch = db.batch();
      for (const doc of snap.docs) batch.delete(doc.ref);
      await batch.commit();
      return snap.size;
    },

    /** Deletes a member's notices. */
    async deleteNotices(uid) {
      await db.recursiveDelete(members.doc(uid).collection(NOTICES));
    },

    /** The moderation word lists, `{banned, suspicious}`, empty when never set. */
    async getModeration() {
      const snap = await db.collection("settings").doc("moderation").get();
      const data = snap.exists ? snap.data() : {};
      return { banned: data.banned ?? [], suspicious: data.suspicious ?? [] };
    },

    async setModeration({ banned, suspicious }, by) {
      await db
        .collection("settings")
        .doc("moderation")
        .set({ banned, suspicious, updatedAt: FieldValue.serverTimestamp(), updatedBy: by }, { merge: true });
    },
  };
}
