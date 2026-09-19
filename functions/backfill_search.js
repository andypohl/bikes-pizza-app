// Writes the search index (search_index.js) onto every post that lacks
// one or whose index is out of date: needed once when search is
// introduced, and again if the indexing changes. Run from functions/
// with Application Default Credentials (`gcloud auth application-default
// login`) for a project that the account may write to:
//
//   node backfill_search.js <project-id> [--dry-run]
//
// Every post is read, whatever its status, so a post taken down and put
// back is findable. Only documents whose index differs are written.

import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import { searchIndex } from "./search_index.js";

const [projectId, ...flags] = process.argv.slice(2);
if (!projectId) {
  console.error("usage: node backfill_search.js <project-id> [--dry-run]");
  process.exit(2);
}
const dryRun = flags.includes("--dry-run");

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

initializeApp({ projectId });
const db = getFirestore();

let seen = 0;
let changed = 0;
let batch = db.batch();
let pending = 0;
const flush = async () => {
  if (!pending) return;
  if (!dryRun) await batch.commit();
  batch = db.batch();
  pending = 0;
};

const snap = await db.collection("posts").select("title", "details", "body", "bodyFormat", "search").get();
for (const doc of snap.docs) {
  seen += 1;
  const data = doc.data();
  const search = searchIndex({ title: data.title ?? "", details: data.details ?? null, body: data.body ?? "", bodyFormat: data.bodyFormat ?? "text" });
  if (same(search, data.search)) continue;
  changed += 1;
  batch.update(doc.ref, { search, updatedAt: FieldValue.serverTimestamp() });
  pending += 1;
  if (pending === 200) await flush();
}
await flush();
console.log(`${projectId}: ${seen} posts, ${changed} ${dryRun ? "would be" : ""} indexed${dryRun ? " (dry run)" : ""}`);
