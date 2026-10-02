// Member profiles: the username and newsletter choices behind a Firebase
// user, kept in Firestore at members/{uid} (server-only; the app and the
// account page reach them through the `member` and `updateMember`
// callables). Usernames are unique regardless of case: each one is reserved
// at usernames/{lowercased} pointing back at the member's uid.

import { randomInt } from "node:crypto";

import { FieldPath, FieldValue } from "firebase-admin/firestore";

import { usernameKey } from "./account.js";
import { AppError, ValidationError } from "./errors.js";
import { matchWords } from "./moderate.js";

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
 * Words a new member's username is made from: `<adjective>_<noun>_<2 digits>`,
 * so a Google or Apple account is ready to post without a setup step (the
 * member can rename themselves on the account page). Everything stays
 * within `USERNAME_PATTERN` and well under its 24 characters.
 */
const USERNAME_ADJECTIVES = [
  "breezy", "cheesy", "chunky", "crispy", "crusty", "doughy", "flaky", "fresh", "gritty",
  "hungry", "mellow", "peppy", "rusty", "saucy", "speedy", "spicy", "toasty", "zesty",
];
const USERNAME_NOUNS = [
  "calzone", "crank", "cruiser", "crust", "fixie", "gravel", "pedaler", "pie", "rider",
  "roadie", "saddle", "slice", "spoke", "sprocket", "tandem", "wheelie",
];

/** How many generated usernames to try before giving up on one. */
const USERNAME_TRIES = 5;

/**
 * A random username in the house style. `random(n)` returns an integer in
 * `[0, n)`; the default is cryptographically random, tests pass their own.
 *
 * @param {(n: number) => number} [random]
 */
export function generateUsername(random = randomInt) {
  const adjective = USERNAME_ADJECTIVES[random(USERNAME_ADJECTIVES.length)];
  const noun = USERNAME_NOUNS[random(USERNAME_NOUNS.length)];
  return `${adjective}_${noun}_${10 + random(90)}`;
}

/**
 * @typedef {object} MemberRecord
 * @property {string} email
 * @property {string} username  Empty only when none could be reserved
 * @property {boolean} [usernameGenerated]  True while the username is the
 *   one picked at creation rather than one the member chose
 * @property {string[]} newsletters  IDs from {@link NEWSLETTERS}
 * @property {string} [joinedAt]  ISO; when the Firebase user was created
 * @property {string} [location]  Shown on the public profile; "" when unset
 * @property {boolean} [messages]  False when other members may not message them
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
 * @property {(username: string) => Promise<{uid: string, username: string}|null>} uidByUsername
 *   The member holding a username (any case), or null
 * @property {() => Promise<Map<string, MemberRecord>>} list  Every record by uid
 * @property {(uid: string) => Promise<void>} delete  Removes the record and its username reservation
 */

/**
 * The member's record, created with defaults on first use. Keeps the email
 * in step with the Firebase user so the record stays findable, drops
 * fields that are no longer kept (the name, from before usernames), and
 * fills in `joinedAt` from `joinedAt(uid)` (the Firebase user's creation
 * time) when the record has none. A new record gets a generated username
 * (see {@link generateUsername}), flagged `usernameGenerated` so the
 * clients know a choice made at sign-up should replace it; if every try
 * collides the username is left empty and the clients ask for one.
 * `onCreated(record)` is told about a record made here, which is how a
 * new member is announced; it must not throw.
 *
 * @param {{uid: string, email: string}} user
 * @param {{store: MemberStore, now?: () => Date, joinedAt?: (uid: string) => Promise<string|null>,
 *   onCreated?: (record: MemberRecord) => Promise<void>, random?: (n: number) => number}} deps
 * @returns {Promise<MemberRecord>}
 */
export async function loadMember(user, { store, now = () => new Date(), joinedAt, onCreated, random }) {
  const existing = await store.get(user.uid);
  if (existing) {
    const stale = RETIRED_FIELDS.filter((field) => field in existing);
    if (stale.length) await store.remove(user.uid, stale);
    const patch = {};
    if (existing.email !== user.email) patch.email = user.email;
    if (!existing.joinedAt && joinedAt) {
      const at = await joinedAt(user.uid).catch(() => null);
      if (at) patch.joinedAt = at;
    }
    if (Object.keys(patch).length) await store.set(user.uid, { ...patch, updatedAt: now() });
    const record = { ...existing, ...patch, email: user.email, username: existing.username ?? "" };
    for (const field of stale) delete record[field];
    return record;
  }
  const record = {
    email: user.email,
    username: "",
    newsletters: [...DEFAULT_NEWSLETTERS],
    joinedAt: (joinedAt && (await joinedAt(user.uid).catch(() => null))) || now().toISOString(),
  };
  await store.set(user.uid, { ...record, createdAt: now(), updatedAt: now() });
  for (let i = 0; i < USERNAME_TRIES && !record.username; i++) {
    const candidate = generateUsername(random);
    try {
      await store.setUsername(user.uid, candidate);
      record.username = candidate;
      record.usernameGenerated = true;
      await store.set(user.uid, { usernameGenerated: true });
    } catch (error) {
      if (!(error instanceof AppError && error.code === "already-exists")) throw error;
    }
  }
  if (onCreated) await onCreated(record);
  return record;
}

/**
 * Applies a validated patch (see `validateUpdate` in account.js) and returns
 * the updated record. A username goes through the store's reservation so
 * two members can never share one; a location is checked against the
 * banned word list (`banned`, when given).
 *
 * @param {{uid: string}} user
 * @param {{username?: string, newsletters?: string[], location?: string, messages?: boolean}} patch
 * @param {{store: MemberStore, now?: () => Date, banned?: () => Promise<string[]>}} deps
 */
export async function updateMember(user, patch, { store, now = () => new Date(), banned }) {
  const { username, ...rest } = patch;
  if (rest.location && banned && matchWords(rest.location, await banned()).length) {
    throw new ValidationError("That location can't be used.");
  }
  if (username !== undefined) {
    await store.setUsername(user.uid, username);
    rest.usernameGenerated = false;
  }
  const { notifications, ...fields } = rest;
  if (notifications) {
    // A partial patch: the categories not named keep their setting.
    const current = (await store.get(user.uid))?.notifications ?? {};
    fields.notifications = { ...current, ...notifications };
  }
  await store.set(user.uid, { ...fields, updatedAt: now() });
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
    async uidByUsername(username) {
      const snap = await usernames.doc(usernameKey(username)).get();
      if (!snap.exists) return null;
      const { uid, username: stored } = snap.data();
      return { uid, username: stored ?? username };
    },
    /** Members whose username starts with `prefix` (already lowercased), `[{uid, username}]`, at most `limit`. */
    async searchUsernames(prefix, { limit = 20 } = {}) {
      const snap = await usernames.orderBy(FieldPath.documentId()).startAt(prefix).endAt(`${prefix}\uf8ff`).limit(limit).get();
      return snap.docs.map((doc) => ({ uid: doc.data().uid, username: doc.data().username ?? doc.id }));
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
