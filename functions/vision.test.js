import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "./errors.js";
import {
  FEATURES,
  PEOPLE_MESSAGE,
  SAFE_SEARCH_MESSAGE,
  VISION_URL,
  annotate,
  evaluatePeople,
  evaluateSafeSearch,
  inspectImage,
} from "./vision.js";

const clean = { adult: "VERY_UNLIKELY", spoof: "UNLIKELY", medical: "VERY_UNLIKELY", violence: "VERY_UNLIKELY", racy: "UNLIKELY" };
const nobody = { faces: 0, faceConfidence: 0, persons: 0, personScore: 0 };

test("evaluateSafeSearch passes clean photos and fills in every category", () => {
  const r = evaluateSafeSearch(clean);
  assert.equal(r.ok, true);
  assert.deepEqual(r.flagged, []);
  assert.deepEqual(r.likelihoods, clean);
  assert.deepEqual(evaluateSafeSearch({}).likelihoods, { adult: "UNKNOWN", spoof: "UNKNOWN", medical: "UNKNOWN", violence: "UNKNOWN", racy: "UNKNOWN" });
  assert.equal(evaluateSafeSearch({}).ok, true);
});

test("evaluateSafeSearch blocks at the policy thresholds", () => {
  assert.equal(evaluateSafeSearch({ ...clean, adult: "POSSIBLE" }).ok, true);
  assert.deepEqual(evaluateSafeSearch({ ...clean, adult: "LIKELY" }).flagged, [{ category: "adult", likelihood: "LIKELY" }]);
  assert.equal(evaluateSafeSearch({ ...clean, violence: "VERY_LIKELY" }).ok, false);
  assert.equal(evaluateSafeSearch({ ...clean, racy: "LIKELY" }).ok, true);
  assert.equal(evaluateSafeSearch({ ...clean, racy: "VERY_LIKELY" }).ok, false);
  // spoof and medical never block
  assert.equal(evaluateSafeSearch({ ...clean, spoof: "VERY_LIKELY", medical: "VERY_LIKELY" }).ok, true);
  const both = evaluateSafeSearch({ ...clean, adult: "VERY_LIKELY", racy: "VERY_LIKELY" });
  assert.deepEqual(both.flagged.map((f) => f.category), ["adult", "racy"]);
});

test("evaluatePeople passes photos of things and summarises what it saw", () => {
  assert.deepEqual(evaluatePeople(), { ok: true, flagged: [], people: nobody });
  const r = evaluatePeople({
    faceAnnotations: [{ detectionConfidence: 0.31 }],
    localizedObjectAnnotations: [{ name: "Bicycle", score: 0.97 }, { name: "Person", score: 0.2 }, { name: "Pizza", score: 0.9 }],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.people, { faces: 1, faceConfidence: 0.31, persons: 1, personScore: 0.2 });
});

test("evaluatePeople blocks faces and person-like objects at the thresholds", () => {
  const face = evaluatePeople({ faceAnnotations: [{ detectionConfidence: 0.5 }] });
  assert.deepEqual(face.flagged, ["face"]);
  assert.equal(face.ok, false);
  const person = evaluatePeople({ localizedObjectAnnotations: [{ name: "Person", score: 0.83 }] });
  assert.deepEqual(person.flagged, ["person"]);
  assert.equal(evaluatePeople({ localizedObjectAnnotations: [{ name: "Woman", score: 0.6 }] }).ok, false);
  assert.equal(evaluatePeople({ localizedObjectAnnotations: [{ name: "Dog", score: 0.99 }] }).ok, true);
  const both = evaluatePeople({ faceAnnotations: [{ detectionConfidence: 0.9 }], localizedObjectAnnotations: [{ name: "Person", score: 0.9 }] });
  assert.deepEqual(both.flagged, ["face", "person"]);
  // thresholds are adjustable
  assert.equal(evaluatePeople({ faceAnnotations: [{ detectionConfidence: 0.6 }] }, { faceConfidence: 0.7, personScore: 0.7 }).ok, true);
});

function fakeFetch(status, body, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    return { ok: status < 400, status, json: async () => body };
  };
}

test("annotate sends the image once with every feature and returns the annotations", async () => {
  const calls = [];
  const faces = [{ detectionConfidence: 0.9 }];
  const objects = [{ name: "Bicycle", score: 0.9 }];
  const fetchImpl = fakeFetch(200, { responses: [{ safeSearchAnnotation: clean, faceAnnotations: faces, localizedObjectAnnotations: objects }] }, calls);
  const a = await annotate(Buffer.from("img"), { getToken: async () => "tok", fetchImpl });
  assert.deepEqual(a, { safeSearchAnnotation: clean, faceAnnotations: faces, localizedObjectAnnotations: objects });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, VISION_URL);
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.requests[0].image.content, Buffer.from("img").toString("base64"));
  assert.deepEqual(sent.requests[0].features, FEATURES);
  assert.deepEqual(sent.requests[0].features.map((f) => f.type), ["SAFE_SEARCH_DETECTION", "FACE_DETECTION", "OBJECT_LOCALIZATION"]);
  // Vision omits the lists when nothing is found
  const empty = await annotate(Buffer.from("img"), { getToken: async () => "tok", fetchImpl: fakeFetch(200, { responses: [{ safeSearchAnnotation: clean }] }) });
  assert.deepEqual(empty, { safeSearchAnnotation: clean, faceAnnotations: [], localizedObjectAnnotations: [] });
});

test("annotate reports API failures", async () => {
  const deps = (status, body) => ({ getToken: async () => "tok", fetchImpl: fakeFetch(status, body) });
  await assert.rejects(annotate(Buffer.from("x"), deps(403, { error: { message: "API not enabled" } })), /Vision 403: API not enabled/);
  await assert.rejects(annotate(Buffer.from("x"), deps(200, { responses: [{ error: { message: "Bad image data" } }] })), /Bad image data/);
  await assert.rejects(annotate(Buffer.from("x"), deps(200, { responses: [{}] })), /no safeSearchAnnotation/);
});

test("inspectImage throws the user-facing error for flagged photos", async () => {
  const deps = (response) => ({ getToken: async () => "tok", fetchImpl: fakeFetch(200, { responses: [{ safeSearchAnnotation: clean, ...response }] }) });
  const ok = await inspectImage(Buffer.from("x"), deps({}));
  assert.deepEqual(ok, { ok: true, likelihoods: clean, people: nobody });
  const isError = (message) => (e) => e instanceof AppError && e.code === "invalid-argument" && e.message === message;
  await assert.rejects(inspectImage(Buffer.from("x"), deps({ safeSearchAnnotation: { ...clean, adult: "VERY_LIKELY" } })), isError(SAFE_SEARCH_MESSAGE));
  await assert.rejects(inspectImage(Buffer.from("x"), deps({ faceAnnotations: [{ detectionConfidence: 0.95 }] })), isError(PEOPLE_MESSAGE));
  await assert.rejects(inspectImage(Buffer.from("x"), deps({ localizedObjectAnnotations: [{ name: "Person", score: 0.7 }] })), isError(PEOPLE_MESSAGE));
  // SafeSearch wins when both fail
  await assert.rejects(
    inspectImage(Buffer.from("x"), deps({ safeSearchAnnotation: { ...clean, violence: "VERY_LIKELY" }, faceAnnotations: [{ detectionConfidence: 0.95 }] })),
    isError(SAFE_SEARCH_MESSAGE),
  );
});
