import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_NEWSLETTERS, loadMember, updateMember } from "./members.js";

function memoryStore(initial = {}) {
  const docs = new Map(Object.entries(initial));
  return {
    docs,
    async get(uid) {
      return docs.has(uid) ? { ...docs.get(uid) } : null;
    },
    async set(uid, data) {
      docs.set(uid, { ...(docs.get(uid) ?? {}), ...data });
    },
  };
}

const now = () => new Date("2026-01-02T03:04:05Z");

test("loadMember creates a record with defaults on first use", async () => {
  const store = memoryStore();
  const member = await loadMember({ uid: "u1", email: "a@b.c", name: "Ada" }, { store, now });
  assert.deepEqual(member, { email: "a@b.c", name: "Ada", newsletters: DEFAULT_NEWSLETTERS });
  assert.deepEqual(store.docs.get("u1").createdAt, now());
});

test("loadMember returns the existing record and keeps the email current", async () => {
  const store = memoryStore({ u1: { email: "old@b.c", name: "Ada", newsletters: [] } });
  const member = await loadMember({ uid: "u1", email: "new@b.c" }, { store, now });
  assert.deepEqual(member, { email: "new@b.c", name: "Ada", newsletters: [] });
  assert.equal(store.docs.get("u1").email, "new@b.c");
  assert.equal(store.docs.get("u1").createdAt, undefined);
});

test("updateMember merges the patch and returns the record", async () => {
  const store = memoryStore({ u1: { email: "a@b.c", name: "Ada", newsletters: ["news"] } });
  const updated = await updateMember({ uid: "u1" }, { newsletters: [] }, { store, now });
  assert.deepEqual(updated, { email: "a@b.c", name: "Ada", newsletters: [], updatedAt: now() });
});
