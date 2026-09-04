// Member profiles: the name and newsletter choices behind a Firebase user,
// kept in Firestore at members/{uid} (server-only; the app and the account
// page reach them through the `member` and `updateMember` callables).

/** The newsletters a member can choose from. */
export const NEWSLETTERS = [
  {
    id: "news",
    name: "bikes.pizza newsletter",
    description: "An occasional email when new bikes and pizzas are posted.",
  },
];

/** Newsletters a brand-new member starts with. */
export const DEFAULT_NEWSLETTERS = ["news"];

/**
 * @typedef {object} MemberRecord
 * @property {string} email
 * @property {string} name
 * @property {string[]} newsletters  IDs from {@link NEWSLETTERS}
 */

/**
 * @typedef {object} MemberStore
 * @property {(uid: string) => Promise<MemberRecord|null>} get
 * @property {(uid: string, data: object) => Promise<void>} set
 */

/**
 * The member's record, created with defaults on first use. Keeps the email
 * in step with the Firebase user so the record stays findable.
 *
 * @param {{uid: string, email: string, name?: string}} user
 * @param {{store: MemberStore, now?: () => Date}} deps
 * @returns {Promise<MemberRecord>}
 */
export async function loadMember(user, { store, now = () => new Date() }) {
  const existing = await store.get(user.uid);
  if (existing) {
    if (existing.email !== user.email) {
      await store.set(user.uid, { email: user.email, updatedAt: now() });
      return { ...existing, email: user.email };
    }
    return existing;
  }
  const record = {
    email: user.email,
    name: user.name ?? "",
    newsletters: [...DEFAULT_NEWSLETTERS],
  };
  await store.set(user.uid, { ...record, createdAt: now(), updatedAt: now() });
  return record;
}

/**
 * Applies a validated patch (see `validateUpdate` in account.js) and returns
 * the updated record.
 *
 * @param {{uid: string}} user
 * @param {{name?: string, newsletters?: string[]}} patch
 * @param {{store: MemberStore, now?: () => Date}} deps
 */
export async function updateMember(user, patch, { store, now = () => new Date() }) {
  await store.set(user.uid, { ...patch, updatedAt: now() });
  return store.get(user.uid);
}

/** Firestore-backed {@link MemberStore}. */
export function firestoreMemberStore(db) {
  const doc = (uid) => db.collection("members").doc(uid);
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
