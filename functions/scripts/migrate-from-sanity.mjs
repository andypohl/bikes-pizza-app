#!/usr/bin/env node
// One-off: copies the posts of a Sanity dataset into a Firebase project's
// Firestore (posts/{slug}) and Storage (posts/{slug}/{version}/...), the
// shape post.js describes. Reads Sanity's public API (no token), writes
// with the Admin SDK using application-default credentials
// (`gcloud auth application-default login`).
//
//   cd functions
//   node scripts/migrate-from-sanity.mjs --project bikes-pizza-dev --dataset development [--dry-run] [--force] [--slug <slug>]
//
// Existing posts are left alone unless --force. Portable Text becomes
// Markdown when it has any formatting (headings, lists, links, bold,
// images) and plain text otherwise; inline images are copied into the
// post's rendition folder too.

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { postDocument } from "../post.js";
import { firestorePostStore, renditionUrl } from "../post_store.js";
import { publishImage } from "../posts.js";

const SANITY_PROJECT = "nva9b0ia";
const API_VERSION = "2025-02-19";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]] : [])).filter((p) => p.length),
);
const project = args.project;
const dataset = args.dataset;
if (!project || !dataset) {
  console.error("usage: node scripts/migrate-from-sanity.mjs --project <firebase project> --dataset <sanity dataset> [--dry-run] [--force] [--slug <slug>]");
  process.exit(2);
}
const dryRun = args["dry-run"] === true;
const force = args.force === true;
const only = typeof args.slug === "string" ? args.slug : null;
const bucketName = typeof args.bucket === "string" ? args.bucket : `${project}.firebasestorage.app`;

const QUERY = `*[_type == "post" && !(_id in path("drafts.**")) && defined(slug.current)${only ? " && slug.current == $slug" : ""}]
  | order(publishedAt asc) {
  "slug": slug.current, title, feed, publishedAt, excerpt, submittedBy,
  "image": mainImage { "url": asset->url, hotspot, "width": asset->metadata.dimensions.width },
  body[]{ ..., _type == "image" => { "url": asset->url, alt, caption }, markDefs[]{ ... } },
  "author": author->{ uid, username },
  bike, pizza, source
}`;

async function fetchPosts() {
  const url = new URL(`https://${SANITY_PROJECT}.api.sanity.io/v${API_VERSION}/data/query/${dataset}`);
  url.searchParams.set("query", QUERY);
  if (only) url.searchParams.set("$slug", JSON.stringify(only));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sanity ${res.status}: ${await res.text()}`);
  return (await res.json()).result ?? [];
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---- Portable Text → text or Markdown ---------------------------------------

const hasFormatting = (body) =>
  (body ?? []).some(
    (b) =>
      b._type !== "block" ||
      (b.style ?? "normal") !== "normal" ||
      b.listItem ||
      (b.markDefs ?? []).length > 0 ||
      (b.children ?? []).some((c) => (c.marks ?? []).length > 0),
  );

function spanMarkdown(block) {
  const defs = new Map((block.markDefs ?? []).map((d) => [d._key, d]));
  return (block.children ?? [])
    .map((span) => {
      let text = span.text ?? "";
      for (const mark of [...(span.marks ?? [])].reverse()) {
        const def = defs.get(mark);
        if (def?._type === "link" && def.href) text = `[${text}](${def.href})`;
        else if (mark === "strong") text = `**${text}**`;
        else if (mark === "em") text = `*${text}*`;
        else if (mark === "code") text = `\`${text}\``;
      }
      return text;
    })
    .join("");
}

/** Markdown for a body; inline images are uploaded through `image(url)`. */
async function bodyMarkdown(body, image) {
  const out = [];
  let list = null;
  let count = 0;
  for (const block of body ?? []) {
    if (block._type === "image" && block.url) {
      list = null;
      const url = await image(block.url, ++count);
      out.push(`![${block.alt ?? ""}](${url})${block.caption ? `\n*${block.caption}*` : ""}`);
      continue;
    }
    if (block._type !== "block") continue;
    const text = spanMarkdown(block);
    if (block.listItem) {
      const indent = "  ".repeat(Math.max(0, (block.level ?? 1) - 1));
      const marker = block.listItem === "number" ? "1." : "-";
      if (list !== block.listItem) out.push(""); // a blank line starts a list
      list = block.listItem;
      out[out.length - 1] = `${out[out.length - 1]}${out[out.length - 1] ? "\n" : ""}${indent}${marker} ${text}`;
      continue;
    }
    list = null;
    const style = block.style ?? "normal";
    if (style === "h1" || style === "h2") out.push(`## ${text}`);
    else if (style === "h3") out.push(`### ${text}`);
    else if (style === "h4") out.push(`#### ${text}`);
    else if (style === "blockquote") out.push(`> ${text.replace(/\n/g, "\n> ")}`);
    else out.push(text);
  }
  return out.join("\n\n").trim();
}

const bodyText = (body) =>
  (body ?? [])
    .filter((b) => b._type === "block")
    .map((b) => (b.children ?? []).map((c) => c.text ?? "").join(""))
    .join("\n\n")
    .trim();

// ---- main ------------------------------------------------------------------

initializeApp({ credential: applicationDefault(), projectId: project, storageBucket: bucketName });
const posts = firestorePostStore(getFirestore(), getStorage().bucket(bucketName));

const rows = await fetchPosts();
console.log(`${rows.length} post(s) in Sanity dataset "${dataset}" → Firebase project "${project}"${dryRun ? " (dry run)" : ""}`);
let written = 0;
let skipped = 0;
let failed = 0;
for (const row of rows) {
  const { slug } = row;
  try {
    if (!force && (await posts.exists(slug))) {
      console.log(`  skip  ${slug} (exists)`);
      skipped += 1;
      continue;
    }
    const format = hasFormatting(row.body) ? "markdown" : "text";
    const inline = async (url, n) => {
      if (dryRun) return url;
      const field = await publishImage(posts, `${slug}/inline${n}`, await download(url));
      return renditionUrl(field.base, `${field.sizes[field.sizes.length - 1]}.jpg`);
    };
    const body = format === "markdown" ? await bodyMarkdown(row.body, inline) : bodyText(row.body);
    let image = null;
    if (row.image?.url) {
      const focus = row.image.hotspot ? { x: row.image.hotspot.x, y: row.image.hotspot.y } : undefined;
      image = dryRun ? { base: "(dry run)", sizes: [], width: row.image.width } : await publishImage(posts, slug, await download(row.image.url), { focus });
    }
    const credit = row.author?.uid
      ? { uid: row.author.uid, username: row.author.username ?? "", name: row.submittedBy ?? "" }
      : row.submittedBy
        ? { uid: null, username: "", name: row.submittedBy }
        : null;
    const source = row.source?.system ? { system: row.source.system, id: row.source.id ?? null, url: row.source.url ?? null } : null;
    const doc = postDocument({
      slug,
      feed: row.feed,
      title: row.title,
      publishedAt: row.publishedAt,
      body,
      bodyFormat: format,
      summary: row.excerpt ?? "",
      image,
      details: row.feed === "bikes" ? row.bike : row.feed === "pizza" ? row.pizza : null,
      credit,
      source,
    });
    if (dryRun) {
      console.log(`  would write ${slug}: ${format}, ${image ? `${row.image.width}px photo` : "no photo"}, credit ${credit ? credit.username || credit.name : "none"}`);
    } else {
      if (force && (await posts.exists(slug))) await posts.patch(slug, doc);
      else await posts.create(slug, doc);
      console.log(`  wrote ${slug}: ${format}, ${image ? `${image.sizes.length} sizes` : "no photo"}`);
    }
    written += 1;
  } catch (error) {
    failed += 1;
    console.error(`  FAILED ${slug}: ${error.message}`);
  }
}
console.log(`done: ${written} written, ${skipped} skipped, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
