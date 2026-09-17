// Screening for comments: the banned and suspicious word lists kept at
// settings/moderation, and Google's Cloud Natural Language `moderateText`,
// which scores a text across categories such as Toxic, Insult, Profanity,
// Derogatory, Sexual, Violent and Politics (0 to 1 each) and names its
// language. Pure policy (matchWords, evaluate, decide) plus one REST call
// (moderateText); screenText wires them together. Thresholds come from
// the contract (contract/comments.json) so they can be tuned in one place.

import { COMMENTS } from "./contract.js";

export const MODERATE_URL = "https://language.googleapis.com/v2/documents:moderateText";

export const POLICY = COMMENTS.screening;

/** Shown when a comment is refused; the reason is deliberately not spelled out. */
export const BLOCKED_MESSAGE = "That comment can't be posted.";

/** Words and phrases as members would type them, ready to match as whole words, case-insensitively. */
export function normalizeWords(list) {
  const words = new Set();
  for (const entry of Array.isArray(list) ? list : []) {
    if (typeof entry !== "string") continue;
    const word = entry.trim().toLowerCase().replace(/\s+/g, " ");
    if (word) words.add(word);
  }
  return [...words];
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The entries of `words` that appear in `text` as whole words (a phrase matches as a whole). */
export function matchWords(text, words) {
  const haystack = String(text ?? "").toLowerCase().replace(/\s+/g, " ");
  return normalizeWords(words).filter((word) => new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(word)}(?![\\p{L}\\p{N}_])`, "u").test(haystack));
}

/**
 * Applies the thresholds to moderateText's scores: `block` when a block
 * category reaches the block score, else `hold` when one reaches the hold
 * score or a topic category (Politics) reaches its own, else `ok`.
 * `reasons` names the categories that decided it.
 */
export function evaluate(scores = {}, policy = POLICY) {
  const at = (name) => (typeof scores[name] === "number" ? scores[name] : 0);
  const blocked = policy.blockCategories.filter((name) => at(name) >= policy.block);
  if (blocked.length) return { verdict: "block", reasons: blocked };
  const held = [
    ...policy.blockCategories.filter((name) => at(name) >= policy.hold),
    ...policy.holdCategories.filter((name) => at(name) >= policy.holdTopic),
  ];
  if (held.length) return { verdict: "hold", reasons: held };
  return { verdict: "ok", reasons: [] };
}

/**
 * Asks the Natural Language API to score `text`. `getToken` must resolve
 * to an OAuth access token with the cloud-platform scope. Resolves to
 * `{language, scores}` with `scores` keyed by category name.
 */
export async function moderateText(text, { getToken, fetchImpl = fetch }) {
  const token = await getToken();
  const res = await fetchImpl(MODERATE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ document: { type: "PLAIN_TEXT", content: text } }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Natural Language ${res.status}: ${body.error?.message ?? "request failed"}`);
  const scores = {};
  for (const category of body.moderationCategories ?? []) {
    if (typeof category?.name === "string") scores[category.name] = round(category.confidence ?? 0);
  }
  return { language: body.languageCode ?? null, scores };
}

const round = (n) => Math.round(n * 1000) / 1000;

/**
 * Screens a comment's plain text, in order: banned words block, the
 * scores block or hold, suspicious words hold. `moderate(text)` is
 * moderateText bound to credentials; when it is missing or fails the
 * comment is held for a person to look at rather than refused or let
 * through, and the failure is reported through `log`.
 *
 * @returns {Promise<{verdict: "ok"|"hold"|"block", hold: null|"words"|"screen",
 *   screening: {language: string|null, scores: object, matched: string[], reasons: string[], error?: string}}>}
 */
export async function screenText(text, { moderation = {}, moderate, policy = POLICY, log = () => {} } = {}) {
  const banned = matchWords(text, moderation.banned);
  if (banned.length) {
    return { verdict: "block", hold: null, screening: { language: null, scores: {}, matched: banned, reasons: ["banned"] } };
  }
  let language = null;
  let scores = {};
  let error;
  if (moderate) {
    try {
      ({ language, scores } = await moderate(text));
    } catch (failure) {
      error = String(failure?.message ?? failure);
      log("comment screening failed; holding the comment", { error });
    }
  } else {
    error = "screening not configured";
  }
  const suspicious = matchWords(text, moderation.suspicious);
  const scored = evaluate(scores, policy);
  const screening = { language, scores, matched: suspicious, reasons: scored.reasons, ...(error ? { error } : {}) };
  if (scored.verdict === "block") return { verdict: "block", hold: null, screening };
  if (error || scored.verdict === "hold") return { verdict: "hold", hold: "screen", screening };
  if (suspicious.length) return { verdict: "hold", hold: "words", screening };
  return { verdict: "ok", hold: null, screening };
}
