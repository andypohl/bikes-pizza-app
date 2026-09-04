import assert from "node:assert/strict";
import { test } from "node:test";

import { SanityApiError, SanityClient } from "./sanity.js";

function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const { status = 200, body = {} } = handler(url, init);
    return { ok: status < 300, status, text: async () => JSON.stringify(body) };
  };
  return { calls, fetchImpl };
}

const client = (fetchImpl) =>
  new SanityClient({ projectId: "abc", dataset: "production", apiVersion: "2025-02-19", token: "tok", fetchImpl });

test("uploadImage posts the bytes to the assets endpoint and returns the asset id", async () => {
  const { calls, fetchImpl } = fakeFetch(() => ({ body: { document: { _id: "image-1-10x10-jpg" } } }));
  const id = await client(fetchImpl).uploadImage({ bytes: Buffer.from("jpg"), contentType: "image/jpeg", filename: "a b.jpg" });
  assert.equal(id, "image-1-10x10-jpg");
  assert.equal(calls[0].url, "https://abc.api.sanity.io/v2025-02-19/assets/images/production?filename=a%20b.jpg");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.equal(calls[0].init.headers["Content-Type"], "image/jpeg");
  assert.equal(calls[0].init.body.toString(), "jpg");
});

test("createDocument sends a create mutation, prefixing drafts", async () => {
  const { calls, fetchImpl } = fakeFetch(() => ({ body: { results: [{ id: "doc1" }] } }));
  const c = client(fetchImpl);
  assert.equal(await c.createDocument({ _type: "post", title: "x" }), "doc1");
  await c.createDocument({ _type: "post", title: "y" }, { draft: true });
  const [published, draft] = calls.map((call) => JSON.parse(call.init.body).mutations[0].create);
  assert.deepEqual(published, { _type: "post", title: "x" });
  assert.match(draft._id, /^drafts\.[0-9a-f-]{36}$/);
  assert.equal(calls[0].url, "https://abc.api.sanity.io/v2025-02-19/data/mutate/production?returnIds=true");
});

test("errors carry the status and Sanity's description", async () => {
  const { fetchImpl } = fakeFetch(() => ({ status: 403, body: { error: { description: "Insufficient permissions" } } }));
  await assert.rejects(
    client(fetchImpl).createDocument({ _type: "post" }),
    (e) => e instanceof SanityApiError && e.status === 403 && /Insufficient permissions/.test(e.message),
  );
});
