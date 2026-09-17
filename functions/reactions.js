// Reactions: a member's answers to the fixed questions a post's feed asks
// (contract/reactions.json; "I've had this pizza", "This bike looks"),
// each a pick from a palette of options. The member's own picks live at
// posts/{slug}/reactions/{uid} as `{uid, username, picks: {<palette>:
// [<value>, ...]}}` (the username copied there, as on a post's credit, so
// a post's reactors can be named without a lookup each) and the post
// carries the tallies at `reactions.<palette>.<value>`, so the app and
// the website read counts with the post and only the member's own picks
// and the names need the API. Palettes and options are the contract's; a
// pick of anything else is refused, and a count of an option no longer
// offered is kept but not shown. Pure: the store is injected.

import { REACTION_PALETTES } from "./contract.js";
import { AppError, ValidationError } from "./errors.js";

const SLUG_PATTERN = /^[a-z0-9-]{1,120}$/;

/** The palettes a feed's posts take, in display order; empty for feeds without any. */
export function palettesFor(feed) {
  return REACTION_PALETTES[feed] ?? [];
}

/**
 * Checks a member's picks for a post of `feed`: an object keyed by
 * palette, each value the chosen options (a list, or one string). A
 * "pick one" palette takes at most one. Returns them normalised, with
 * palettes left unanswered omitted.
 */
export function validatePicks(feed, value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Picks must be an object keyed by palette.");
  const palettes = palettesFor(feed);
  const picks = {};
  for (const [key, chosen] of Object.entries(value)) {
    const palette = palettes.find((p) => p.key === key);
    if (!palette) throw new ValidationError(`Unknown reaction "${key}".`);
    const list = typeof chosen === "string" ? [chosen] : chosen;
    if (list === null || list === undefined) continue;
    if (!Array.isArray(list)) throw new ValidationError(`Picks for "${key}" must be a list.`);
    const values = [...new Set(list)];
    for (const v of values) {
      if (typeof v !== "string" || !palette.options.some((o) => o.value === v)) throw new ValidationError(`Unknown "${key}" option.`);
    }
    if (palette.pick === "one" && values.length > 1) throw new ValidationError(`Pick one for "${key}".`);
    if (values.length) picks[key] = values;
  }
  return picks;
}

/**
 * How the tallies change when a member's picks go from `before` to
 * `after`: `{"<palette>.<value>": -1 | 1}`, only what changed.
 */
export function countDeltas(before = {}, after = {}) {
  const deltas = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const was = new Set(before[key] ?? []);
    const now = new Set(after[key] ?? []);
    for (const v of was) if (!now.has(v)) deltas[`${key}.${v}`] = -1;
    for (const v of now) if (!was.has(v)) deltas[`${key}.${v}`] = 1;
  }
  return deltas;
}

/** `counts` with `deltas` applied, never below zero. */
export function applyDeltas(counts = {}, deltas = {}) {
  const next = {};
  for (const [key, values] of Object.entries(counts)) next[key] = { ...values };
  for (const [path, delta] of Object.entries(deltas)) {
    const [key, value] = path.split(".");
    next[key] ??= {};
    next[key][value] = Math.max(0, (next[key][value] ?? 0) + delta);
  }
  return next;
}

/**
 * The tallies to show for a post: every palette its feed has, every
 * option, zero where nobody picked it; counts of options no longer
 * offered are left out.
 */
export function publicCounts(doc) {
  const counts = {};
  for (const palette of palettesFor(doc.feed)) {
    counts[palette.key] = {};
    for (const option of palette.options) {
      const n = doc.reactions?.[palette.key]?.[option.value];
      counts[palette.key][option.value] = typeof n === "number" && n > 0 ? n : 0;
    }
  }
  return counts;
}

/** The member's stored picks, only those the feed still offers. */
export function publicPicks(feed, picks) {
  return validatePicksLoosely(feed, picks);
}

function validatePicksLoosely(feed, picks) {
  const out = {};
  for (const palette of palettesFor(feed)) {
    const values = Array.isArray(picks?.[palette.key]) ? picks[palette.key].filter((v) => palette.options.some((o) => o.value === v)) : [];
    if (values.length) out[palette.key] = palette.pick === "one" ? values.slice(0, 1) : values;
  }
  return out;
}

/** How many reactors an option names before "and N more". */
export const NAMES_SHOWN = 10;

/**
 * Who picked each option, from a post's reaction records: for every
 * option of the feed's palettes, up to NAMES_SHOWN usernames chosen at
 * random (members without a username are not named) and how many more
 * picked it, named or not. `random` is Math.random's shape.
 */
export function whoPicked(feed, records, { random = Math.random, shown = NAMES_SHOWN } = {}) {
  const who = {};
  for (const palette of palettesFor(feed)) {
    who[palette.key] = {};
    for (const option of palette.options) {
      const pickers = records.filter((r) => Array.isArray(r.picks?.[palette.key]) && r.picks[palette.key].includes(option.value));
      const named = shuffle(
        pickers.map((r) => r.username).filter((u) => typeof u === "string" && u),
        random,
      );
      const names = named.slice(0, shown);
      who[palette.key][option.value] = { names, more: pickers.length - names.length };
    }
  }
  return who;
}

function shuffle(list, random) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

async function load(slug, posts) {
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) throw new ValidationError("Post id is required.");
  const doc = await posts.get(slug);
  if (!doc || doc.status !== "published") throw new AppError("not-found", "That post no longer exists.");
  if (!palettesFor(doc.feed).length) throw new AppError("failed-precondition", "This post takes no reactions.");
  return doc;
}

/**
 * The post's tallies, the member's own picks and who picked what:
 * `{counts, mine, who}` (see whoPicked).
 */
export async function getReactions(slug, user, { posts, random }) {
  const doc = await load(slug, posts);
  const records = await posts.listReactions(doc.slug);
  const own = records.find((r) => r.uid === user.uid);
  return { counts: publicCounts(doc), mine: publicPicks(doc.feed, own?.picks), who: whoPicked(doc.feed, records, { random }) };
}

/**
 * Replaces the member's picks on a post with `data.picks` and answers as
 * `getReactions` does, with everything as it now stands. The member's
 * username (from `members`, when given) is recorded with the picks.
 */
export async function setReactions(slug, data, user, { posts, members, random, log = () => {} }) {
  const doc = await load(slug, posts);
  const picks = validatePicks(doc.feed, data?.picks);
  const username = members ? ((await members.get(user.uid))?.username ?? "") : "";
  const { reactions } = await posts.setReaction(doc.slug, user.uid, picks, { username });
  log("reaction set", { slug: doc.slug, by: user.uid, picks });
  const records = await posts.listReactions(doc.slug);
  return { counts: publicCounts({ ...doc, reactions }), mine: publicPicks(doc.feed, picks), who: whoPicked(doc.feed, records, { random }) };
}
