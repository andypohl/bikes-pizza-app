// A post's body is stored as it was written and rendered to HTML once, at
// write time, so the website and the app show the same thing without
// parsing anything themselves. Two formats: `text` (what members type:
// paragraphs separated by blank lines, shown verbatim) and `markdown`
// (what administrators write: headings, links, lists, images). The HTML is
// sanitised either way.

import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

export const BODY_FORMATS = ["text", "markdown"];

const ALLOWED = {
  allowedTags: ["p", "br", "h2", "h3", "h4", "blockquote", "ul", "ol", "li", "strong", "em", "a", "img", "figure", "figcaption", "code", "pre", "hr"],
  allowedAttributes: { a: ["href", "rel"], img: ["src", "alt", "width", "height"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener" }) },
};

const escape = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Plain paragraphs: blank lines separate them, single newlines break lines. */
export function textToHtml(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function markdownToHtml(markdown) {
  // Headings start at h2 on a post page (the title is the h1).
  const html = marked.parse(String(markdown ?? ""), { async: false, gfm: true, breaks: false }).replace(/<(\/?)h1>/g, "<$1h2>");
  return sanitizeHtml(html, ALLOWED).trim();
}

/** The HTML for a body in either format. */
export function renderBody(body, format) {
  if (!BODY_FORMATS.includes(format)) throw new Error(`unknown body format: ${format}`);
  return format === "markdown" ? markdownToHtml(body) : textToHtml(body);
}

/** The body as plain text, for summaries. */
export function bodyToText(body, format) {
  const html = renderBody(body, format);
  return sanitizeHtml(html.replace(/<\/(p|h\d|li|blockquote|figcaption)>/g, "$& "), { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** One line of at most `max` characters, cut at a word. */
export function summarize(text, max = 200) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
