#!/usr/bin/env node
// Generates the language-specific copies of the facts in contract/*.json:
// the feeds, the option lists for a post's structured details, the
// username rule, the URL shape of a post's page and the image limits.
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
  out.push(jsRecord("IMAGE_TYPES", Object.entries(rules.image.types), t(": Record<string, string>")));
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
  return out.join("\n");
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
