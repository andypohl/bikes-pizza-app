import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveMember } from "./link.js";

function memoryStore(initial = {}) {
  const docs = { ...initial };
  return {
    docs,
    async get(uid) {
      return docs[uid] ?? null;
    },
    async set(uid, data) {
      docs[uid] = { ...(docs[uid] ?? {}), ...data };
    },
  };
}

function fakeGhost({ members = {}, byEmail = {} } = {}) {
  const calls = [];
  return {
    calls,
    async getMember(id) {
      calls.push(["getMember", id]);
      return members[id] ?? null;
    },
    async findOrCreateMember({ email, name }) {
      calls.push(["findOrCreateMember", email, name]);
      if (byEmail[email]) return { ...byEmail[email], created: false };
      return { id: `new-${email}`, email, created: true };
    },
  };
}

const user = { uid: "u1", email: "a@b.c", name: "Ada" };
const now = () => new Date("2026-01-01T00:00:00Z");

test("first sign-in adopts an existing member by email and records the link", async () => {
  const store = memoryStore();
  const ghost = fakeGhost({ byEmail: { "a@b.c": { id: "m1", email: "a@b.c" } } });
  const r = await resolveMember(user, { store, ghost, now });
  assert.deepEqual(r, { id: "m1", email: "a@b.c", created: false, linked: true });
  assert.deepEqual(store.docs.u1, { ghostMemberId: "m1", email: "a@b.c", linkedAt: now() });
});

test("first sign-in creates a member when none matches", async () => {
  const store = memoryStore();
  const ghost = fakeGhost();
  const r = await resolveMember(user, { store, ghost, now });
  assert.equal(r.created, true);
  assert.equal(store.docs.u1.ghostMemberId, "new-a@b.c");
});

test("later sign-ins use the stored member ID even if emails differ", async () => {
  const store = memoryStore({ u1: { ghostMemberId: "m1", email: "a@b.c" } });
  const ghost = fakeGhost({ members: { m1: { id: "m1", email: "changed@b.c" } } });
  const r = await resolveMember(user, { store, ghost, now });
  assert.deepEqual(r, { id: "m1", email: "changed@b.c", created: false, linked: false });
  assert.deepEqual(ghost.calls, [["getMember", "m1"]]);
  assert.equal(store.docs.u1.ghostMemberId, "m1");
});

test("re-links when the mapped member was deleted in Ghost", async () => {
  const store = memoryStore({ u1: { ghostMemberId: "gone" } });
  const ghost = fakeGhost();
  const r = await resolveMember(user, { store, ghost, now });
  assert.equal(r.linked, true);
  assert.equal(store.docs.u1.ghostMemberId, "new-a@b.c");
  assert.equal(store.docs.u1.relinkedFrom, "gone");
});
