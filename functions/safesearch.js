// Google Cloud Vision SafeSearch check for submitted photos. Pure policy
// (evaluate) plus a thin REST call (detectSafeSearch); wired together by
// inspectImage, which createSubmission uses before storing anything.

import { AppError } from "./errors.js";

export const VISION_URL = "https://vision.googleapis.com/v1/images:annotate";

/** Vision's likelihood scale, least to most likely. */
export const LIKELIHOODS = ["UNKNOWN", "VERY_UNLIKELY", "UNLIKELY", "POSSIBLE", "LIKELY", "VERY_LIKELY"];

/**
 * A photo is refused when any category reaches its threshold. `spoof`
 * (memes, edits) and `medical` are not blocked for a pizza and bike blog.
 */
export const POLICY = { adult: "LIKELY", violence: "LIKELY", racy: "VERY_LIKELY" };

export const CATEGORIES = ["adult", "spoof", "medical", "violence", "racy"];

export const SAFE_SEARCH_MESSAGE =
  "Your photo failed Google SafeSearch inspection. Please choose a different photo.";

const rank = (likelihood) => Math.max(0, LIKELIHOODS.indexOf(likelihood ?? "UNKNOWN"));

/** Applies the policy to a Vision safeSearchAnnotation. */
export function evaluate(annotation = {}, policy = POLICY) {
  const likelihoods = {};
  for (const category of CATEGORIES) likelihoods[category] = annotation[category] ?? "UNKNOWN";
  const flagged = Object.entries(policy)
    .filter(([category, threshold]) => rank(likelihoods[category]) >= rank(threshold))
    .map(([category]) => ({ category, likelihood: likelihoods[category] }));
  return { ok: flagged.length === 0, flagged, likelihoods };
}

/**
 * Asks Vision for the SafeSearch annotation of an image. `getToken` must
 * resolve to an OAuth access token with the cloud-platform scope.
 */
export async function detectSafeSearch(bytes, { getToken, fetchImpl = fetch }) {
  const token = await getToken();
  const res = await fetchImpl(VISION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{ image: { content: bytes.toString("base64") }, features: [{ type: "SAFE_SEARCH_DETECTION" }] }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Vision ${res.status}: ${body.error?.message ?? "request failed"}`);
  }
  const response = body.responses?.[0] ?? {};
  if (response.error) throw new Error(`Vision: ${response.error.message}`);
  if (!response.safeSearchAnnotation) throw new Error("Vision: no safeSearchAnnotation in response");
  return response.safeSearchAnnotation;
}

/** Checks a photo; throws the user-facing error when it fails the policy. */
export async function inspectImage(bytes, deps, policy = POLICY) {
  const result = evaluate(await detectSafeSearch(bytes, deps), policy);
  if (!result.ok) throw new AppError("invalid-argument", SAFE_SEARCH_MESSAGE);
  return result;
}
