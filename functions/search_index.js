// What a post can be found by: the `search` field written onto every post
// document (post.js), so the search endpoint (search.js) can answer with
// Firestore queries alone.
//
//   search: { title: [...], details: [...], words: [...] }
//
// `title` holds every prefix (two characters and up) of every word of the
// title, `details` the same for the structured details (the stored values
// and their option titles, so "chro" finds chrome and "deep" finds a
// Chicago deep dish), and `words` the union of both plus the whole words
// of the body. A query term matches a post when it is in `words`; which
// of the three lists it is in says how well (search.js ranks title
// matches over detail matches over body matches). Body words carry no
// prefixes because a story would add thousands of index entries; a body
// match needs a whole word.

import { BIKE_COLORS, BIKE_TYPES, BIKE_YEARS, PIZZA_STYLES } from "./contract.js";
import { bodyToText } from "./markdown.js";

/** Shortest prefix indexed; a one-letter query would match everything. */
export const MIN_TERM = 2;
/** Longest word kept; anything longer is cut, in the index and in queries alike. */
export const MAX_WORD = 24;
/** Prefixes are made up to this many characters of a word. */
const MAX_PREFIX = 20;
/** Distinct body words indexed per post (the first ones, in reading order). */
export const MAX_BODY_WORDS = 400;
/** Distinct terms a query may carry (Firestore's array-contains-any takes 30). */
export const MAX_QUERY_TERMS = 10;

const OPTION_TITLES = {
  year: BIKE_YEARS,
  color: BIKE_COLORS,
  type: BIKE_TYPES,
  style: PIZZA_STYLES,
};

/**
 * The words of a text as the index and queries see them: lowercased,
 * accents removed, split at anything that is not a letter or digit,
 * shorter than MIN_TERM dropped, longer than MAX_WORD cut, in order and
 * without repeats.
 */
export function words(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < MIN_TERM) continue;
    const word = raw.slice(0, MAX_WORD);
    if (seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

/** Every prefix of every word, from MIN_TERM characters up to MAX_PREFIX, without repeats. */
export function prefixes(list) {
  const out = new Set();
  for (const word of list) {
    const end = Math.min(word.length, MAX_PREFIX);
    for (let n = MIN_TERM; n <= end; n += 1) out.add(word.slice(0, n));
  }
  return [...out];
}

/** The words of a post's details: each stored value, and the option title it stands for. */
export function detailWords(details) {
  const out = [];
  for (const [field, value] of Object.entries(details ?? {})) {
    if (typeof value !== "string" || !value) continue;
    out.push(...words(value));
    const option = OPTION_TITLES[field]?.find((o) => o.value === value);
    if (option) out.push(...words(option.title));
  }
  return [...new Set(out)];
}

/** The `search` field for a post from its title, details and body. */
export function searchIndex({ title, details = null, body = "", bodyFormat = "text" }) {
  const titleTerms = prefixes(words(title));
  const detailTerms = prefixes(detailWords(details));
  const bodyWords = words(bodyToText(body, bodyFormat)).slice(0, MAX_BODY_WORDS);
  return {
    title: titleTerms,
    details: detailTerms,
    words: [...new Set([...titleTerms, ...detailTerms, ...bodyWords])],
  };
}

/** The distinct terms of a query, at most MAX_QUERY_TERMS; empty when nothing is searchable. */
export function queryTerms(query) {
  return words(query).slice(0, MAX_QUERY_TERMS);
}
