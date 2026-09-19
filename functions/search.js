// Search (docs/api.md, "Search"): one request when a member presses
// Search in the app, answered in four groups in a fixed order of trust:
// members whose username starts with what was typed, posts whose title
// matches, posts whose structured details match, and posts whose story
// matches. A post appears once, in the best group it qualifies for; every
// term of the query has to match (a title match needs every term at the
// start of a title word, a details match every term in the title or the
// details, a text match every term somewhere on the post). Posts carry
// their index (search_index.js); usernames are found in the reservation
// collection. Pure: the stores are injected.

import { ValidationError } from "./errors.js";
import { bodyToText } from "./markdown.js";
import { publicPost } from "./post.js";
import { queryTerms } from "./search_index.js";

export const LIMIT = 20;
export const MAX_LIMIT = 50;
/** Newest published posts fetched for a query before ranking; the rest are too old to show. */
export const CANDIDATES = 100;
/** Characters of story shown around the first matching word. */
export const SNIPPET = 140;

/**
 * What the query asks for: the post terms, and for usernames the first
 * word as a prefix (usernames keep their underscores, so a query is not
 * split at them) plus every word, which each has to occur in a username.
 * Throws when nothing searchable was typed.
 */
export function parseQuery(query) {
  const raw = String(query ?? "").trim();
  const terms = queryTerms(raw);
  const usernameWords = raw
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9_]/g, ""))
    .filter((w) => w.length >= 2);
  if (!terms.length && !usernameWords.length) throw new ValidationError("Type something to search for.");
  return { terms, usernamePrefix: usernameWords[0] ?? "", usernameWords };
}

/** A limit from the query string, between 1 and MAX_LIMIT, LIMIT by default. */
export function parseLimit(value) {
  const n = Math.floor(Number(value ?? LIMIT));
  if (!Number.isFinite(n) || n < 1) return LIMIT;
  return Math.min(MAX_LIMIT, n);
}

/**
 * Which group a post belongs in for these terms: "title", "details",
 * "text", or null when a term matches nothing on it.
 */
export function groupOf(terms, search) {
  if (!search || !terms.length) return null;
  const title = new Set(search.title ?? []);
  const details = new Set(search.details ?? []);
  const all = new Set(search.words ?? []);
  if (terms.every((t) => title.has(t))) return "title";
  if (terms.every((t) => title.has(t) || details.has(t))) return "details";
  if (terms.every((t) => all.has(t))) return "text";
  return null;
}

/** The story around the first term that occurs in it, or its start. */
export function snippet(doc, terms) {
  const text = bodyToText(doc.body ?? "", doc.bodyFormat ?? "text");
  const lower = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lower.search(new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u"));
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  if (at < 0) at = 0;
  let start = Math.max(0, at - Math.floor(SNIPPET / 3));
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space >= 0 && space < at) start = space + 1;
  }
  let end = Math.min(text.length, start + SNIPPET);
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > start) end = space;
  }
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/**
 * Answers `{query, members, titles, details, text}` for `?q=&limit=`:
 * `members` as `[{username}]`, the three post groups as post summaries
 * (text matches with a `snippet`), each newest first and at most `limit`
 * long.
 */
export async function search(query, { posts, members, siteUrl }) {
  const { terms, usernamePrefix, usernameWords } = parseQuery(query?.q);
  const limit = parseLimit(query?.limit);
  const [found, candidates] = await Promise.all([
    usernamePrefix ? members.searchUsernames(usernamePrefix, { limit: MAX_LIMIT }) : [],
    terms.length ? posts.search(terms, { limit: CANDIDATES }) : [],
  ]);
  const groups = { title: [], details: [], text: [] };
  for (const doc of candidates) {
    const group = groupOf(terms, doc.search);
    if (group) groups[group].push(doc);
  }
  return {
    query: String(query?.q ?? "").trim(),
    members: found
      .filter((m) => usernameWords.every((w) => m.username.toLowerCase().includes(w)))
      .slice(0, limit)
      .map((m) => ({ username: m.username })),
    titles: groups.title.slice(0, limit).map((doc) => publicPost(doc, siteUrl)),
    details: groups.details.slice(0, limit).map((doc) => publicPost(doc, siteUrl)),
    text: groups.text.slice(0, limit).map((doc) => ({ ...publicPost(doc, siteUrl), snippet: snippet(doc, terms) })),
  };
}
