// Links a Firebase user to a Ghost member by a stable ID, not by email.
//
// The mapping lives in Firestore at users/{uid}. Email is only used the
// first time (to adopt a member who signed up on the website before the app
// existed) or when the mapped member no longer exists in Ghost.

/**
 * @typedef {object} MemberStore
 * @property {(uid: string) => Promise<{ghostMemberId?: string}|null>} get
 * @property {(uid: string, data: object) => Promise<void>} set
 */

/**
 * Resolves (and records) the Ghost member for a Firebase user.
 *
 * @param {{uid: string, email: string, name?: string}} user
 * @param {{store: MemberStore, ghost: import('./ghost.js').GhostAdminClient, now?: () => Date}} deps
 * @returns {Promise<{id: string, email: string, created: boolean, linked: boolean}>}
 *   The Ghost member as returned by the Admin API (so `name`, `newsletters`,
 *   etc. are present too), plus: `created` is true when a new Ghost member was
 *   made; `linked` is true when the mapping was written or changed on this
 *   call.
 */
export async function resolveMember(user, { store, ghost, now = () => new Date() }) {
  const existing = await store.get(user.uid);
  if (existing?.ghostMemberId) {
    const member = await ghost.getMember(existing.ghostMemberId);
    if (member) {
      return { ...member, created: false, linked: false };
    }
    // The member was deleted in Ghost; fall through and re-link.
  }

  const member = await ghost.findOrCreateMember({ email: user.email, name: user.name });
  await store.set(user.uid, {
    ghostMemberId: member.id,
    email: user.email,
    linkedAt: now(),
    ...(existing?.ghostMemberId ? { relinkedFrom: existing.ghostMemberId } : {}),
  });
  return { ...member, linked: true };
}

/** Firestore-backed {@link MemberStore}. */
export function firestoreStore(db) {
  const doc = (uid) => db.collection("users").doc(uid);
  return {
    async get(uid) {
      const snap = await doc(uid).get();
      return snap.exists ? snap.data() : null;
    },
    async set(uid, data) {
      await doc(uid).set(data, { merge: true });
    },
  };
}
