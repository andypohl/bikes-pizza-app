import assert from "node:assert/strict";
import { test } from "node:test";

import { ensureMember, syncMemberUsername } from "./authors.js";

/** Fake SanityClient holding member documents in memory. */
function fakeSanity(members = []) {
  const docs = new Map(members.map((m) => [m._id, { ...m }]));
  let next = 1;
  return {
    docs,
    async query(_groq, { uid }) {
      const found = [...docs.values()].find((m) => m.uid === uid);
      return found ? { _id: found._id, username: found.username } : null;
    },
    async patchDocument(id, set) {
      Object.assign(docs.get(id), set);
    },
    async createDocument(doc) {
      const _id = `gen${next++}`;
      docs.set(_id, { ...doc, _id });
      return _id;
    },
  };
}

test("ensureMember creates the document on first use", async () => {
  const sanity = fakeSanity();
  assert.equal(await ensureMember(sanity, { uid: "u1", username: "ada" }), "gen1");
  assert.deepEqual(sanity.docs.get("gen1"), { _id: "gen1", _type: "member", uid: "u1", username: "ada" });
});

test("ensureMember returns the existing document and refreshes its username", async () => {
  const sanity = fakeSanity([{ _id: "m1", _type: "member", uid: "u1", username: "old" }]);
  assert.equal(await ensureMember(sanity, { uid: "u1", username: "new" }), "m1");
  assert.equal(sanity.docs.get("m1").username, "new");
  assert.equal(await ensureMember(sanity, { uid: "u1", username: "new" }), "m1");
  assert.equal(sanity.docs.size, 1);
});

test("syncMemberUsername patches an existing document and reports a missing one", async () => {
  const sanity = fakeSanity([{ _id: "m1", _type: "member", uid: "u1", username: "old" }]);
  assert.equal(await syncMemberUsername(sanity, { uid: "u1", username: "new" }), true);
  assert.equal(sanity.docs.get("m1").username, "new");
  assert.equal(await syncMemberUsername(sanity, { uid: "u2", username: "x" }), false);
  assert.equal(sanity.docs.size, 1);
});
