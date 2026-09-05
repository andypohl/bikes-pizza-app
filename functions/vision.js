// Google Cloud Vision checks for submitted photos: SafeSearch (adult,
// violent or racy content) and people (faces or person-shaped objects),
// since the blog shows bikes and pizzas, not people. Pure policy
// (evaluateSafeSearch, evaluatePeople) plus one REST call (annotate);
// wired together by inspectImage, which createSubmission uses before
// storing anything.

import { AppError } from "./errors.js";

export const VISION_URL = "https://vision.googleapis.com/v1/images:annotate";

/** The annotations requested in the single Vision call. */
export const FEATURES = [
  { type: "SAFE_SEARCH_DETECTION" },
  { type: "FACE_DETECTION", maxResults: 20 },
  { type: "OBJECT_LOCALIZATION", maxResults: 50 },
];

/** Vision's likelihood scale, least to most likely. */
export const LIKELIHOODS = ["UNKNOWN", "VERY_UNLIKELY", "UNLIKELY", "POSSIBLE", "LIKELY", "VERY_LIKELY"];

/**
 * A photo is refused when any category reaches its threshold. `spoof`
 * (memes, edits) and `medical` are not blocked for a pizza and bike blog.
 */
export const POLICY = { adult: "LIKELY", violence: "LIKELY", racy: "VERY_LIKELY" };

export const CATEGORIES = ["adult", "spoof", "medical", "violence", "racy"];

/**
 * A photo is refused when Vision finds a face at least this confident, or
 * localises a person-like object with at least this score (0 to 1).
 */
export const PEOPLE_POLICY = { faceConfidence: 0.5, personScore: 0.5 };

/** Object names (Vision's Knowledge Graph entities) that count as a person. */
export const PERSON_OBJECTS = new Set(["Person", "Man", "Woman", "Boy", "Girl", "Child", "Baby", "Human face", "Human head"]);

export const SAFE_SEARCH_MESSAGE =
  "Your photo failed Google SafeSearch inspection. Please choose a different photo.";

export const PEOPLE_MESSAGE =
  "Your photo seems to show a person or a face. Please choose a photo of just the bike or the pizza.";

const rank = (likelihood) => Math.max(0, LIKELIHOODS.indexOf(likelihood ?? "UNKNOWN"));

/** Applies the SafeSearch policy to a Vision safeSearchAnnotation. */
export function evaluateSafeSearch(annotation = {}, policy = POLICY) {
  const likelihoods = {};
  for (const category of CATEGORIES) likelihoods[category] = annotation[category] ?? "UNKNOWN";
  const flagged = Object.entries(policy)
    .filter(([category, threshold]) => rank(likelihoods[category]) >= rank(threshold))
    .map(([category]) => ({ category, likelihood: likelihoods[category] }));
  return { ok: flagged.length === 0, flagged, likelihoods };
}

/**
 * Applies the people policy to Vision's face and object annotations.
 * `people` summarises what was seen (every detection, not only the ones
 * over the thresholds) so a reviewer can tell how close a photo came.
 */
export function evaluatePeople({ faceAnnotations = [], localizedObjectAnnotations = [] } = {}, policy = PEOPLE_POLICY) {
  const faces = faceAnnotations.map((f) => f.detectionConfidence ?? 0);
  const persons = localizedObjectAnnotations.filter((o) => PERSON_OBJECTS.has(o.name)).map((o) => o.score ?? 0);
  const round = (n) => Math.round(n * 100) / 100;
  const people = {
    faces: faces.length,
    faceConfidence: faces.length ? round(Math.max(...faces)) : 0,
    persons: persons.length,
    personScore: persons.length ? round(Math.max(...persons)) : 0,
  };
  const flagged = [];
  if (faces.some((c) => c >= policy.faceConfidence)) flagged.push("face");
  if (persons.some((s) => s >= policy.personScore)) flagged.push("person");
  return { ok: flagged.length === 0, flagged, people };
}

/**
 * Asks Vision for the SafeSearch, face and object annotations of an image
 * in one call. `getToken` must resolve to an OAuth access token with the
 * cloud-platform scope. Face and object lists are empty when nothing is
 * found; the SafeSearch annotation is required.
 */
export async function annotate(bytes, { getToken, fetchImpl = fetch }) {
  const token = await getToken();
  const res = await fetchImpl(VISION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ image: { content: bytes.toString("base64") }, features: FEATURES }] }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Vision ${res.status}: ${body.error?.message ?? "request failed"}`);
  }
  const response = body.responses?.[0] ?? {};
  if (response.error) throw new Error(`Vision: ${response.error.message}`);
  if (!response.safeSearchAnnotation) throw new Error("Vision: no safeSearchAnnotation in response");
  return {
    safeSearchAnnotation: response.safeSearchAnnotation,
    faceAnnotations: response.faceAnnotations ?? [],
    localizedObjectAnnotations: response.localizedObjectAnnotations ?? [],
  };
}

/**
 * Checks a photo; throws the user-facing error when it fails either policy
 * (SafeSearch first). Resolves to `{ ok, likelihoods, people }`.
 */
export async function inspectImage(bytes, deps, { safeSearch = POLICY, people = PEOPLE_POLICY } = {}) {
  const annotations = await annotate(bytes, deps);
  const safety = evaluateSafeSearch(annotations.safeSearchAnnotation, safeSearch);
  if (!safety.ok) throw new AppError("invalid-argument", SAFE_SEARCH_MESSAGE);
  const presence = evaluatePeople(annotations, people);
  if (!presence.ok) throw new AppError("invalid-argument", PEOPLE_MESSAGE);
  return { ok: true, likelihoods: safety.likelihoods, people: presence.people };
}
