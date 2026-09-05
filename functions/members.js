// Member profiles: the username and newsletter choices behind a Firebase
// user, kept in Firestore at members/{uid} (server-only; the app and the
// account page reach them through the `member` and `updateMember`
// callables). Usernames are unique regardless of case: each one is reserved
// at usernames/{lowercased} pointing back at the member's uid.

import { FieldValue } from "firebase-admin/firestore";

import { usernameKey } from "./account.js";
import { AppError } from "./errors.js";

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

/** Fields older records may carry that are no longer kept. */
const RETIRED_FIELDS = ["name"];

/**
 * @typedef {object} MemberRecord
 * @property {string} email
 * @property {string} username  Empty until the member chooses one
 * @property {string[]} newsletters  IDs from {@link NEWSLETTERS}
 */

/**
 * @typedef {object} MemberStore
 * @property {(uid: string) => Promise<MemberRecord|null>} get
 * @property {(uid: string, data: object) => Promise<void>} set  Merges fields
 * @property {(uid: string, fields: string[]) => Promise<void>} remove  Deletes fields
 * @property {(uid: string, username: string) => Promise<void>} setUsername
 *   Reserves the username for the member (releasing their previous one)
 *   and stores it; throws {@link AppError} `already-exists` if someone else
 *   holds it.
 * @property {() => Promise<Map<string, MemberRecord>>} list  Every record by uid
 * @property {(uid: string) => Promise<void>} delete  Removes the record and its username reservation
 */

/**
 * The member's record, created with defaults on first use. Keeps the email
 * in step with the Firebase user so the record stays findable, and drops
 * fields that are no longer kept (the name, from before usernames).
 *
 * @param {{uid: string, email: string}} user
 * @param {{store: MemberStore, now?: () => Date}} deps
 * @returns {Promise<MemberRecord>}
 */
export async function loadMember(user, { store, now = () => new Date() }) {
  const existing = await store.get(user.uid);
  if (existing) {
    const stale = RETIRED_FIELDS.filter((field) => field in existing);
    if (stale.length) await store.remove(user.uid, stale);
    if (existing.email !== user.email) {
      await store.set(user.uid, { email: user.email, updatedAt: now() });
    }
    const record = { ...existing, email: user.email, username: existing.username ?? "" };
    for (const field of stale) delete record[field];
    return record;
  }
  const record = {
    email: user.email,
    username: "",
    newsletters: [...DEFAULT_NEWSLETTERS],
  };
  await store.set(user.uid, { ...record, createdAt: now(), updatedAt: now() });
  return record;
}

/**
 * Applies a validated patch (see `validateUpdate` in account.js) and returns
 * the updated record. A username goes through the store's reservation so
 * two members can never share one.
 *
 * @param {{uid: string}} user
 * @param {{username?: string, newsletters?: string[]}} patch
 * @param {{store: MemberStore, now?: () => Date}} deps
 */
export async function updateMember(user, patch, { store, now = () => new Date() }) {
  const { username, ...rest } = patch;
  if (username !== undefined) await store.setUsername(user.uid, username);
  await store.set(user.uid, { ...rest, updatedAt: now() });
  return store.get(user.uid);
}

/** Firestore-backed {@link MemberStore}. */
export function firestoreMemberStore(db) {
  const members = db.collection("members");
  const usernames = db.collection("usernames");
  return {
    async get(uid) {
      const snap = await members.doc(uid).get();
      return snap.exists ? snap.data() : null;
    },
    async set(uid, data) {
      await members.doc(uid).set(data, { merge: true });
    },
    async remove(uid, fields) {
      const patch = Object.fromEntries(fields.map((f) => [f, FieldValue.delete()]));
      await members.doc(uid).set(patch, { merge: true });
    },
    async list() {
      const snap = await members.get();
      return new Map(snap.docs.map((doc) => [doc.id, doc.data()]));
    },
    async delete(uid) {
      await db.runTransaction(async (tx) => {
        const member = await tx.get(members.doc(uid));
        const username = member.exists ? member.data().username : undefined;
        if (username) tx.delete(usernames.doc(usernameKey(username)));
        tx.delete(members.doc(uid));
      });
    },
    async setUsername(uid, username) {
      const key = usernameKey(username);
      await db.runTransaction(async (tx) => {
        const [reservation, member] = await Promise.all([
          tx.get(usernames.doc(key)),
          tx.get(members.doc(uid)),
        ]);
        if (reservation.exists && reservation.data().uid !== uid) {
          throw new AppError("already-exists", "That username is taken.");
        }
        const previous = member.exists ? member.data().username : undefined;
        if (previous && usernameKey(previous) !== key) tx.delete(usernames.doc(usernameKey(previous)));
        tx.set(usernames.doc(key), { uid, username });
        tx.set(members.doc(uid), { username }, { merge: true });
      });
    },
  };
}
