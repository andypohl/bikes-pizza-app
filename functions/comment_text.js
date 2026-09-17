// The text of a comment: a Markdown subset (bold, italic, links) rendered
// to HTML once, when the comment is written, as post bodies are. Two
// rewrites happen before rendering: a bare URL becomes `[link](url)` so
// the comment reads "[link]" rather than a long address, and `@name` of an
// existing member is bolded and recorded as a mention. Everything else
// Markdown could produce (headings, images, code, tables, raw HTML) is
// stripped by the sanitizer, keeping only the text inside.

import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";

import { COMMENTS } from "./contract.js";
import { ValidationError } from "./errors.js";

export const MAX_LENGTH = COMMENTS.maxLength;

const ALLOWED = {
  allowedTags: ["p", "br", "strong", "em", "a"],
  allowedAttributes: { a: ["href", "rel", "target"] },
  allowedSchemes: ["http", "https"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "nofollow noopener", target: "_blank" }),
    // Block-level things Markdown makes out of "#", ">", "-", "```" and so
    // on are kept as plain paragraphs of their text.
    ...Object.fromEntries(["h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre"].map((tag) => [tag, "p"])),
  },
};

// Line breaks inside paragraphs (GitHub's comment behaviour) and no
// automatic links: a bare address is linked by linkBareUrls, an email
// address stays text.
const renderer = new Marked({ gfm: true, breaks: true, tokenizer: { url: () => undefined } });

/** A Markdown link, kept as the member wrote it. */
const MARKDOWN_LINK = /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
/** A URL standing on its own; trailing punctuation is left out of it. */
const BARE_URL = /https?:\/\/[^\s<>()[\]]+/g;
/** `@name` after a start, space or punctuation; the name follows the username rule. */
const MENTION = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_]{3,24})(?![A-Za-z0-9_])/g;
/** Stands in for a kept link while bare URLs are replaced (private-use characters). */
const HOLD = "";

/** The comment's text checked: a string, trimmed, not empty, within MAX_LENGTH. */
export function validateText(value) {
  if (typeof value !== "string") throw new ValidationError("A comment needs some text.");
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (!text) throw new ValidationError("A comment needs some text.");
  if (text.length > MAX_LENGTH) throw new ValidationError(`Comments are ${MAX_LENGTH} characters at most.`);
  return text;
}

/** `text` with every bare URL replaced by `[link](url)`; links already written as links are left alone. */
export function linkBareUrls(text) {
  const kept = [];
  const held = text.replace(MARKDOWN_LINK, (match) => {
    kept.push(match);
    return `${HOLD}${kept.length - 1}${HOLD}`;
  });
  const linked = held.replace(BARE_URL, (url) => {
    const trimmed = url.replace(/[.,;:!?'"]+$/, "");
    return `[link](${trimmed})${url.slice(trimmed.length)}`;
  });
  return linked.replace(new RegExp(`${HOLD}(\\d+)${HOLD}`, "g"), (_, i) => kept[Number(i)]);
}

/** The usernames written as `@name` in `text`, each once (first spelling kept; case does not matter). */
export function mentionedNames(text) {
  const names = new Map();
  for (const match of text.matchAll(MENTION)) if (!names.has(match[2].toLowerCase())) names.set(match[2].toLowerCase(), match[2]);
  return [...names.values()];
}

/**
 * Renders a comment. `lookup(name)` resolves a username (any case) to
 * `{uid, username}` or null; names that resolve become bold mentions and
 * their uids are returned, names that do not stay plain text. The text
 * returned is what is stored: as written, with bare URLs turned into
 * links.
 *
 * @returns {Promise<{text: string, html: string, mentions: string[]}>}
 */
export async function renderComment(value, { lookup = async () => null } = {}) {
  const text = linkBareUrls(validateText(value));
  const members = new Map();
  for (const name of mentionedNames(text)) {
    const member = await lookup(name);
    if (member?.uid) members.set(name.toLowerCase(), member);
  }
  const markdown = text.replace(MENTION, (match, before, name) => {
    const member = members.get(name.toLowerCase());
    return member ? `${before}**@${member.username}**` : match;
  });
  const html = tidy(sanitizeHtml(renderer.parse(markdown, { async: false }), ALLOWED));
  const mentions = [...new Set([...members.values()].map((m) => m.uid))];
  return { text, html, mentions };
}

/** Sanitized HTML without the breaks and empty paragraphs that stripped tags leave behind. */
function tidy(html) {
  return html
    .replace(/<p>(\s*<br \/>)+/g, "<p>")
    .replace(/(<br \/>\s*)+<\/p>/g, "</p>")
    .replace(/<p>\s*<\/p>/g, "")
    .replace(/\n+/g, "\n")
    .trim();
}

/** The comment as plain text, for previews and the screening call. */
export function commentToText(html) {
  return sanitizeHtml(String(html ?? "").replace(/<br\s*\/?>/g, " ").replace(/<\/p>/g, " "), { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
