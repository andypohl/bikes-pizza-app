// Firestore persistence for direct messages (docs/community-design.md):
// a thread per pair of members at threads/{id} (the two uids sorted and
// joined with "_"), its messages beneath, and each member's blocks at
// members/{uid}/blocks/{otherUid}. The app reads threads and messages
// straight from Firestore (the rules let a thread's members read it);
// everything is written here, by the functions. Behind a small interface
// so threads.js and the tests can use an in-memory store (fakes.js).

export const THREADS = "threads";
export const MESSAGES = "messages";
export const BLOCKS = "blocks";

/** The thread two members share: the same id whichever of them asks. */
export function threadId(a, b) {
  return [a, b].sort().join("_");
}

const withId = (snap) => ({ ...snap.data(), id: snap.id });

export function firestoreThreadStore(db) {
  const threads = db.collection(THREADS);
  const members = db.collection("members");
  const messagesOf = (id) => threads.doc(id).collection(MESSAGES);

  return {
    threadId,

    async get(id) {
      const snap = await threads.doc(id).get();
      return snap.exists ? withId(snap) : null;
    },

    /** The member's threads, newest message first; `gone` markers included. */
    async listForMember(uid) {
      const snap = await threads.where("members", "array-contains", uid).orderBy("lastMessageAt", "desc").get();
      return snap.docs.map(withId);
    },

    async create(id, doc) {
      await threads.doc(id).set({ ...doc, createdAt: doc.createdAt ?? new Date().toISOString() });
    },

    async update(id, fields) {
      await threads.doc(id).update(fields);
    },

    /** A page of messages, newest first, from before `before` (a message's createdAt) when given. */
    async messages(id, { before = null, limit = 50 } = {}) {
      let query = messagesOf(id).orderBy("createdAt", "desc");
      if (before) query = query.where("createdAt", "<", before);
      const snap = await query.limit(limit).get();
      return snap.docs.map(withId);
    },

    /** The newest `limit` messages of one conversation, oldest first. */
    async conversationMessages(id, conversation, { limit = 10 } = {}) {
      const snap = await messagesOf(id).where("conversation", "==", conversation).orderBy("createdAt", "desc").limit(limit).get();
      return snap.docs.map(withId).reverse();
    },

    /** How many messages a conversation has. */
    async conversationCount(id, conversation) {
      const snap = await messagesOf(id).where("conversation", "==", conversation).count().get();
      return snap.data().count;
    },

    async message(id, mid) {
      const snap = await messagesOf(id).doc(mid).get();
      return snap.exists ? withId(snap) : null;
    },

    /**
     * Runs `decide` with the thread and, with `uid`, the member's record,
     * then writes what it returns in one transaction: `thread` (fields to
     * update, or a whole document with `create: true`), `message` (a new
     * document, with its `id`), `updateMessage` ({id, fields}), `member`
     * (fields to merge). Resolves to `decide`'s `result`.
     */
    async transact(id, { uid } = {}, decide) {
      return db.runTransaction(async (tx) => {
        const [thread, member] = await Promise.all([tx.get(threads.doc(id)), uid ? tx.get(members.doc(uid)) : null]);
        const out = await decide({
          thread: thread.exists ? withId(thread) : null,
          member: member?.exists ? member.data() : null,
        });
        if (out.thread) {
          const { create, id: _id, ...fields } = out.thread;
          if (create) tx.set(threads.doc(id), fields);
          else tx.update(threads.doc(id), fields);
        }
        if (out.message) {
          const { id: mid, ...fields } = out.message;
          tx.set(messagesOf(id).doc(mid), fields);
        }
        if (out.updateMessage) tx.update(messagesOf(id).doc(out.updateMessage.id), out.updateMessage.fields);
        if (out.member && uid) tx.set(members.doc(uid), out.member, { merge: true });
        return out.result;
      });
    },

    /** A new message id. */
    newId() {
      return threads.doc().id;
    },

    /** Renames a member on every thread they are in; returns how many. */
    async setUsername(uid, username) {
      const snap = await threads.where("members", "array-contains", uid).get();
      if (snap.empty) return 0;
      const batch = db.batch();
      for (const doc of snap.docs) batch.update(doc.ref, { [`usernames.${uid}`]: username });
      await batch.commit();
      return snap.size;
    },

    // ---- blocks ----

    async blocks(uid) {
      const snap = await members.doc(uid).collection(BLOCKS).get();
      return snap.docs.map((d) => d.id);
    },

    async setBlock(uid, other, on, at) {
      const ref = members.doc(uid).collection(BLOCKS).doc(other);
      if (on) await ref.set({ at });
      else await ref.delete();
    },

    // ---- deletion, export, admin ----

    /** Every message a member wrote, with the thread's id on each. */
    async messagesByUid(uid) {
      const snap = await db.collectionGroup(MESSAGES).where("uid", "==", uid).get();
      return snap.docs.map((d) => ({ ...withId(d), thread: d.ref.parent.parent.id }));
    },

    /** Replaces a thread with a `gone` marker for `remaining`, deleting its messages. */
    async replaceWithMarker(id, remaining) {
      await db.recursiveDelete(messagesOf(id));
      const at = new Date().toISOString();
      await threads.doc(id).set({ members: [remaining], gone: true, goneAt: at, lastMessageAt: at });
    },

    async deleteThread(id) {
      await db.recursiveDelete(threads.doc(id));
    },

    async deleteBlocks(uid) {
      await db.recursiveDelete(members.doc(uid).collection(BLOCKS));
    },

    /** Reported threads, most recently reported first. */
    async reported({ limit = 50 } = {}) {
      const snap = await threads.where("reportedAt", ">", "").orderBy("reportedAt", "desc").limit(limit).get();
      return snap.docs.map(withId);
    },
  };
}
