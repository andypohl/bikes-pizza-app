#!/usr/bin/env node
// Generates the language-specific copies of the facts in contract/*.json:
// the feeds, the option lists for a post's structured details, the
// reaction palettes, the comment rules, the username rule, the URL shape
// of a post's page and the image limits.
// Everything that reads them (the app, the Cloud Functions, the website,
// the Studio) imports a generated file rather than keeping its own copy.
//
//   node tool/contract/generate.mjs           # write the generated files
//   node tool/contract/generate.mjs --check   # fail if any is out of date
//
// Generated files carry a header saying so; edit contract/*.json instead.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (name) => JSON.parse(readFileSync(join(root, "contract", name), "utf8"));

const { timeZone, feeds } = read("feeds.json");
const options = read("options.json");
const rules = read("rules.json");
const { palettes } = read("reactions.json");
const comments = read("comments.json");
const members = read("members.json");
const concerns = read("concerns.json");

const HEADER = "Generated from contract/*.json by tool/contract/generate.mjs. Do not edit; change the JSON and run the generator.";

const galleryFeeds = feeds.filter((f) => f.layout === "gallery").map((f) => f.value);
const articleFeeds = feeds.filter((f) => f.layout === "article").map((f) => f.value);
const submissionFeeds = feeds.filter((f) => f.submissions);
const lists = {
  BIKE_YEARS: options.bike.years,
  BIKE_COLORS: options.bike.colors,
  BIKE_TYPES: options.bike.types,
  PIZZA_STYLES: options.pizza.styles,
};

// ---- JavaScript / TypeScript --------------------------------------------------

const js = (value) => JSON.stringify(value);
const jsList = (name, items, type = "") =>
  `export const ${name}${type} = [\n${items.map((o) => `  { title: ${js(o.title)}, value: ${js(o.value)} },`).join("\n")}\n];\n`;
const jsValues = (name, items) => `export const ${name}_VALUES = ${js(items.map((o) => o.value))};\n`;
const jsRecord = (name, entries, type = "") =>
  `export const ${name}${type} = {\n${entries.map(([k, v]) => `  ${js(k)}: ${js(v)},`).join("\n")}\n};\n`;

function javascript({ typed }) {
  const t = (annotation) => (typed ? annotation : "");
  const out = [];
  out.push(`// ${HEADER}\n`);
  if (typed) out.push(`export type Option = { title: string; value: string };\n`);
  out.push(`export const TIME_ZONE = ${js(timeZone)};\n`);
  out.push(`/** Every feed, in display order. */\n`);
  out.push(
    `export const FEEDS${t(": { value: string; label: string; noun: string; submissions: boolean; layout: string; postingHours: number[] }[]")} = ${JSON.stringify(feeds, null, 2)};\n`,
  );
  out.push(jsRecord("FEED_LABELS", feeds.map((f) => [f.value, f.label]), t(": Record<string, string>")));
  out.push(`/** Feeds shown as a photo gallery, in category order. */\n`);
  out.push(`export const GALLERY_FEEDS${t(": string[]")} = ${js(galleryFeeds)};\n`);
  out.push(`/** Feeds read as full articles. */\n`);
  out.push(`export const ARTICLE_FEEDS${t(": string[]")} = ${js(articleFeeds)};\n`);
  out.push(`/** Feeds that accept member submissions, with the noun for messages. */\n`);
  out.push(jsRecord("SUBMISSION_FEEDS", submissionFeeds.map((f) => [f.value, { noun: f.noun }]), t(": Record<string, { noun: string }>")));
  out.push(`/** Hours of the day (24h, in TIME_ZONE) each queue posts at. */\n`);
  out.push(jsRecord("POSTING_HOURS", submissionFeeds.map((f) => [f.value, f.postingHours]), t(": Record<string, number[]>")));
  for (const [name, items] of Object.entries(lists)) {
    out.push(jsList(name, items, t(": Option[]")));
    out.push(jsValues(name, items));
  }
  out.push(`export const USERNAME_PATTERN = /${rules.username.pattern}/;\n`);
  out.push(`export const USERNAME_RULE = ${js(rules.username.rule)};\n`);
  out.push(jsRecord("POST_PATHS", Object.entries(rules.postPath), t(": Record<string, string>")));
  out.push(`/** Path of a post's page on the website. */\n`);
  out.push(
    `export function postPath(feed${t(": string")}, slug${t(": string")})${t(": string")} {\n  return (POST_PATHS[feed] ?? POST_PATHS.default).replace("{slug}", slug);\n}\n`,
  );
  out.push(`export const IMAGE_MAX_EDGE = ${rules.image.maxEdge};\n`);
  out.push(`export const IMAGE_MAX_UPLOAD_BYTES = ${rules.image.maxUploadBytes};\n`);
  out.push(`/** How many additional photos a bike or pizza post may carry besides its main one. */\n`);
  out.push(`export const IMAGE_MAX_EXTRA = ${rules.image.maxExtra};\n`);
  out.push(jsRecord("IMAGE_TYPES", Object.entries(rules.image.types), t(": Record<string, string>")));
  if (typed) {
    out.push(`export type ReactionPalette = { key: string; prompt: string; pick: "one" | "many"; options: Option[] };\n`);
  }
  out.push(`/** The reaction palettes of each feed, in display order; feeds without any take no reactions. */\n`);
  out.push(`export const REACTION_PALETTES${t(": Record<string, ReactionPalette[]>")} = ${JSON.stringify(palettes, null, 2)};\n`);
  if (typed) {
    out.push(
      `export type CommentRules = {\n  maxLength: number;\n  editWindowMinutes: number;\n  pageSize: number;\n  repliesShown: number;\n  reportsToHide: number;\n  timesKept: number;\n  rateLimit: { seconds: number; perDay: number };\n  reportReasons: Option[];\n  screening: { blockCategories: string[]; block: number; hold: number; holdCategories: string[]; holdTopic: number };\n};\n`,
    );
  }
  out.push(`/** The rules for comments on posts: lengths, windows, page sizes, report reasons and screening thresholds. */\n`);
  out.push(`export const COMMENTS${t(": CommentRules")} = ${JSON.stringify(comments, null, 2)};\n`);
  if (typed) {
    out.push(
      `export type ConcernRules = {\n  maxDetails: number;\n  maxTarget: number;\n  perDay: number;\n  kinds: Option[];\n  reasons: Option[];\n};\n`,
    );
  }
  out.push(`/** Reporting a concern (a post, a member, or anything else) from the app: lengths, the daily limit, what can be reported and why. */\n`);
  out.push(`export const CONCERNS${t(": ConcernRules")} = ${JSON.stringify(concerns, null, 2)};\n`);
  if (typed) {
    out.push(
      `export type MemberRules = {\n  locationMaxLength: number;\n  messages: { maxLength: number; editWindowMinutes: number; previewLength: number; emailedMessages: number; rateLimit: { seconds: number; perDay: number; newThreadsPerDay: number } };\n};\n`,
    );
  }
  out.push(`/** The rules for member profiles and direct messages: the longest location, the message limits. */\n`);
  out.push(`export const MEMBERS${t(": MemberRules")} = ${JSON.stringify(members, null, 2)};\n`);
  return out.join("\n");
}

// ---- Dart -----------------------------------------------------------------

const dartString = (s) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\$/g, "\\$")}'`;
const dartMap = (name, items, doc) =>
  `${doc ? `/// ${doc}\n` : ""}const ${name} = <String, String>{\n${items.map((o) => `  ${dartString(o.value)}: ${dartString(o.title)},`).join("\n")}\n};\n`;
const dartList = (name, values, doc) =>
  `${doc ? `/// ${doc}\n` : ""}const ${name} = <String>[${values.map(dartString).join(", ")}];\n`;

function dart() {
  const out = [];
  out.push(`// ${HEADER}\n//\n// Facts shared with the Cloud Functions and the website: the feeds, the\n// option lists for a post's details, the username rule and URL shapes.\n`);
  out.push(`const timeZone = ${dartString(timeZone)};\n`);
  out.push(dartMap("feedLabels", feeds.map((f) => ({ value: f.value, title: f.label })), "Every feed's label, by value, in display order."));
  out.push(dartMap("feedNouns", feeds.map((f) => ({ value: f.value, title: f.noun })), "What a post in each feed is, for messages (\"your bike\")."));
  out.push(dartList("galleryFeeds", galleryFeeds, "Feeds shown as a photo gallery, in category order."));
  out.push(dartList("articleFeeds", articleFeeds, "Feeds read as full articles."));
  out.push(dartList("submissionFeeds", submissionFeeds.map((f) => f.value), "Feeds that accept member submissions."));
  const dartNames = { BIKE_YEARS: "bikeYears", BIKE_COLORS: "bikeColors", BIKE_TYPES: "bikeTypes", PIZZA_STYLES: "pizzaStyles" };
  for (const [name, items] of Object.entries(lists)) {
    out.push(dartMap(dartNames[name], items, `Display titles for the stored \`${dartNames[name]}\` values.`));
  }
  out.push(`/// Usernames: ${rules.username.rule}.\nfinal usernamePattern = RegExp(r'${rules.username.pattern}');\n`);
  out.push(`const usernameRule = ${dartString(rules.username.rule)};\n`);
  out.push(dartMap("_postPaths", Object.entries(rules.postPath).map(([k, v]) => ({ value: k, title: v }))));
  out.push(`/// Path of a post's page on the website.\nString postPath(String feed, String slug) =>\n    (_postPaths[feed] ?? _postPaths['default']!).replaceFirst('{slug}', slug);\n`);
  out.push(`const imageMaxEdge = ${rules.image.maxEdge};\n`);
  out.push(`const imageMaxUploadBytes = ${rules.image.maxUploadBytes};\n`);
  out.push(`/// How many additional photos a bike or pizza post may carry besides its main one.\nconst imageMaxExtra = ${rules.image.maxExtra};\n`);
  out.push(dartReactions());
  out.push(dartComments());
  return out.join("\n");
}

/**
 * The reaction palettes as Dart: a small class for a palette and its
 * options, then one const list per feed.
 */
function dartReactions() {
  const option = (o) => `ReactionOption(${dartString(o.value)}, ${dartString(o.title)})`;
  // Laid out as `dart format` would: the options on one line when they fit.
  const options = (list) => {
    const short = `      options: [${list.map(option).join(", ")}],`;
    return short.length <= 80 ? short : `      options: [\n${list.map((o) => `        ${option(o)},`).join("\n")}\n      ],`;
  };
  const palette = (p) =>
    `    ReactionPalette(\n      key: ${dartString(p.key)},\n      prompt: ${dartString(p.prompt)},\n      pickOne: ${p.pick === "one"},\n${options(p.options)}\n    ),`;
  const feeds = Object.entries(palettes).map(([feed, list]) => `  ${dartString(feed)}: [\n${list.map(palette).join("\n")}\n  ],`);
  return [
    `/// One choice in a reaction palette: the stored value and its label.\nclass ReactionOption {\n  const ReactionOption(this.value, this.title);\n\n  final String value;\n  final String title;\n}\n`,
    `/// A question a member answers about a post by picking from fixed\n/// options: one of them ([pickOne]) or any number.\nclass ReactionPalette {\n  const ReactionPalette({\n    required this.key,\n    required this.prompt,\n    required this.pickOne,\n    required this.options,\n  });\n\n  /// Names the palette in a post's counts and a member's picks.\n  final String key;\n  final String prompt;\n  final bool pickOne;\n  final List<ReactionOption> options;\n\n  /// Whether [value] is one of the options.\n  bool has(String value) => options.any((o) => o.value == value);\n}\n`,
    `/// The reaction palettes of each feed, in display order; feeds without\n/// any take no reactions.\nconst reactionPalettes = <String, List<ReactionPalette>>{\n${feeds.join("\n")}\n};\n`,
  ].join("\n");
}

/** The comment rules as Dart constants. */
function dartComments() {
  const c = comments;
  return [
    `/// Comments on posts: the longest comment, in characters.\nconst commentMaxLength = ${c.maxLength};\n`,
    `/// How long after posting a comment its author may still edit it.\nconst commentEditWindow = Duration(minutes: ${c.editWindowMinutes});\n`,
    `/// Top-level comments per page.\nconst commentPageSize = ${c.pageSize};\n`,
    `/// Replies shown under a comment before "show more".\nconst commentRepliesShown = ${c.repliesShown};\n`,
    `/// Reports from different members that hide a comment until an admin looks.\nconst commentReportsToHide = ${c.reportsToHide};\n`,
    `/// How many of the newest comment times a post carries (\`commentTimes\`).\nconst commentTimesKept = ${c.timesKept};\n`,
    dartMap("commentReportReasons", c.reportReasons, "The reasons a comment can be reported for, value to label, in display order."),
    `/// A member's location on their profile: the longest, in characters.\nconst memberLocationMaxLength = ${members.locationMaxLength};\n`,
    `/// Direct messages: the longest message, in characters.\nconst messageMaxLength = ${members.messages.maxLength};\n`,
    `/// How long after sending a message its author may still edit it.\nconst messageEditWindow = Duration(minutes: ${members.messages.editWindowMinutes});\n`,
    `/// How much of the newest message a thread carries as its preview.\nconst messagePreviewLength = ${members.messages.previewLength};\n`,
    `/// Reporting a concern: the longest details text, in characters.\nconst concernMaxDetails = ${concerns.maxDetails};\n`,
    `/// Reporting a concern: the longest "what" (a link, a title or a username).\nconst concernMaxTarget = ${concerns.maxTarget};\n`,
    dartMap("concernKinds", concerns.kinds, "What a concern can be about, value to label, in display order."),
    dartMap("concernReasons", concerns.reasons, "The reasons a concern can be reported for, value to label, in display order."),
  ].join("\n");
}

// ---- write or check ----------------------------------------------------------

const outputs = {
  "functions/contract.js": javascript({ typed: false }),
  "site/src/lib/contract.ts": javascript({ typed: true }),
  "lib/contract.dart": dart(),
};

const check = process.argv.includes("--check");
let stale = 0;
for (const [file, content] of Object.entries(outputs)) {
  const path = join(root, file);
  let current = null;
  try {
    current = readFileSync(path, "utf8");
  } catch {
    // Not generated yet.
  }
  if (current === content) continue;
  if (check) {
    console.error(`out of date: ${relative(root, path)}`);
    stale += 1;
  } else {
    writeFileSync(path, content);
    console.log(`wrote ${relative(root, path)}`);
  }
}
if (check && stale) {
  console.error(`\n${stale} generated file(s) differ from contract/*.json; run: node tool/contract/generate.mjs`);
  process.exit(1);
}
