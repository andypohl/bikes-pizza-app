import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "./errors.js";
import { SAFE_SEARCH_MESSAGE, VISION_URL, detectSafeSearch, evaluate, inspectImage } from "./safesearch.js";

const clean = { adult: "VERY_UNLIKELY", spoof: "UNLIKELY", medical: "VERY_UNLIKELY", violence: "VERY_UNLIKELY", racy: "UNLIKELY" };

test("evaluate passes clean photos and fills in every category", () => {
  const r = evaluate(clean);
  assert.equal(r.ok, true);
  assert.deepEqual(r.flagged, []);
  assert.deepEqual(r.likelihoods, clean);
  assert.deepEqual(evaluate({}).likelihoods, { adult: "UNKNOWN", spoof: "UNKNOWN", medical: "UNKNOWN", violence: "UNKNOWN", racy: "UNKNOWN" });
  assert.equal(evaluate({}).ok, true);
});

test("evaluate blocks at the policy thresholds", () => {
  assert.equal(evaluate({ ...clean, adult: "POSSIBLE" }).ok, true);
  assert.deepEqual(evaluate({ ...clean, adult: "LIKELY" }).flagged, [{ category: "adult", likelihood: "LIKELY" }]);
  assert.equal(evaluate({ ...clean, violence: "VERY_LIKELY" }).ok, false);
  assert.equal(evaluate({ ...clean, racy: "LIKELY" }).ok, true);
  assert.equal(evaluate({ ...clean, racy: "VERY_LIKELY" }).ok, false);
  // spoof and medical never block
  assert.equal(evaluate({ ...clean, spoof: "VERY_LIKELY", medical: "VERY_LIKELY" }).ok, true);
  const both = evaluate({ ...clean, adult: "VERY_LIKELY", racy: "VERY_LIKELY" });
  assert.deepEqual(both.flagged.map((f) => f.category), ["adult", "racy"]);
});

function fakeFetch(status, body, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    return { ok: status < 400, status, json: async () => body };
  };
}

test("detectSafeSearch sends the image and returns the annotation", async () => {
  const calls = [];
  const fetchImpl = fakeFetch(200, { responses: [{ safeSearchAnnotation: clean }] }, calls);
  const annotation = await detectSafeSearch(Buffer.from("img"), { getToken: async () => "tok", fetchImpl });
  assert.deepEqual(annotation, clean);
  assert.equal(calls[0].url, VISION_URL);
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.requests[0].image.content, Buffer.from("img").toString("base64"));
  assert.deepEqual(sent.requests[0].features, [{ type: "SAFE_SEARCH_DETECTION" }]);
});

test("detectSafeSearch reports API failures", async () => {
  const deps = (status, body) => ({ getToken: async () => "tok", fetchImpl: fakeFetch(status, body) });
  await assert.rejects(detectSafeSearch(Buffer.from("x"), deps(403, { error: { message: "API not enabled" } })), /Vision 403: API not enabled/);
  await assert.rejects(detectSafeSearch(Buffer.from("x"), deps(200, { responses: [{ error: { message: "Bad image data" } }] })), /Bad image data/);
  await assert.rejects(detectSafeSearch(Buffer.from("x"), deps(200, { responses: [{}] })), /no safeSearchAnnotation/);
});

test("inspectImage throws the user-facing error for flagged photos", async () => {
  const deps = (annotation) => ({ getToken: async () => "tok", fetchImpl: fakeFetch(200, { responses: [{ safeSearchAnnotation: annotation }] }) });
  const ok = await inspectImage(Buffer.from("x"), deps(clean));
  assert.equal(ok.ok, true);
  await assert.rejects(
    inspectImage(Buffer.from("x"), deps({ ...clean, adult: "VERY_LIKELY" })),
    (e) => e instanceof AppError && e.code === "invalid-argument" && e.message === SAFE_SEARCH_MESSAGE,
  );
});
