import assert from "node:assert/strict";
import { test } from "node:test";

import { usernameKey } from "./account.js";
import { AppError } from "./errors.js";
import { DEFAULT_NEWSLETTERS, loadMember, updateMember } from "./members.js";

/** In-memory MemberStore with the same username reservation rules. */
function memoryStore(initial = {}, reservations = {}) {
  const docs = new Map(Object.entries(initial));
  const usernames = new Map(Object.entries(reservations));
  return {
    docs,
    usernames,
    async get(uid) {
      return docs.has(uid) ? { ...docs.get(uid) } : null;
    },
    async set(uid, data) {
      docs.set(uid, { ...(docs.get(uid) ?? {}), ...data });
    },
    async remove(uid, fields) {
      const doc = { ...(docs.get(uid) ?? {}) };
      for (const field of fields) delete doc[field];
      docs.set(uid, doc);
    },
    async setUsername(uid, username) {
      const key = usernameKey(username);
      if (usernames.has(key) && usernames.get(key) !== uid) {
        throw new AppError("already-exists", "That username is taken.");
      }
      const previous = docs.get(uid)?.username;
      if (previous) usernames.delete(usernameKey(previous));
      usernames.set(key, uid);
      await this.set(uid, { username });
    },
  };
}

const now = () => new Date("2026-01-02T03:04:05Z");

test("loadMember creates a record with defaults on first use", async () => {
  const store = memoryStore();
  const member = await loadMember({ uid: "u1", email: "a@b.c" }, { store, now });
  assert.deepEqual(member, { email: "a@b.c", username: "", newsletters: DEFAULT_NEWSLETTERS });
  assert.deepEqual(store.docs.get("u1").createdAt, now());
});

test("loadMember returns the existing record and keeps the email current", async () => {
  const store = memoryStore({ u1: { email: "old@b.c", username: "ada", newsletters: [] } });
  const member = await loadMember({ uid: "u1", email: "new@b.c" }, { store, now });
  assert.deepEqual(member, { email: "new@b.c", username: "ada", newsletters: [] });
  assert.equal(store.docs.get("u1").email, "new@b.c");
  assert.equal(store.docs.get("u1").createdAt, undefined);
});

test("loadMember drops the name kept by older records", async () => {
  const store = memoryStore({ u1: { email: "a@b.c", name: "Ada Lovelace", newsletters: ["news"] } });
  const member = await loadMember({ uid: "u1", email: "a@b.c" }, { store, now });
  assert.deepEqual(member, { email: "a@b.c", username: "", newsletters: ["news"] });
  assert.deepEqual(store.docs.get("u1"), { email: "a@b.c", newsletters: ["news"] });
});

test("updateMember merges the patch and returns the record", async () => {
  const store = memoryStore({ u1: { email: "a@b.c", username: "ada", newsletters: ["news"] } });
  const updated = await updateMember({ uid: "u1" }, { newsletters: [] }, { store, now });
  assert.deepEqual(updated, { email: "a@b.c", username: "ada", newsletters: [], updatedAt: now() });
});

test("updateMember reserves a username and releases the old one", async () => {
  const store = memoryStore({ u1: { email: "a@b.c", username: "ada", newsletters: [] } }, { ada: "u1" });
  const updated = await updateMember({ uid: "u1" }, { username: "Lovelace" }, { store, now });
  assert.equal(updated.username, "Lovelace");
  assert.deepEqual([...store.usernames], [["lovelace", "u1"]]);
});

test("updateMember refuses a username another member holds, whatever its case", async () => {
  const store = memoryStore({ u1: { email: "a@b.c", username: "", newsletters: [] } }, { ada: "u2" });
  await assert.rejects(
    updateMember({ uid: "u1" }, { username: "ADA", newsletters: [] }, { store, now }),
    (e) => e instanceof AppError && e.code === "already-exists",
  );
  assert.equal(store.docs.get("u1").username, "");
  assert.equal(store.docs.get("u1").updatedAt, undefined);
});
