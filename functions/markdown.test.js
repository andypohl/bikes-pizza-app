import assert from "node:assert/strict";
import { test } from "node:test";

import { bodyToText, markdownToHtml, renderBody, summarize, textToHtml } from "./markdown.js";

test("text bodies become escaped paragraphs with line breaks", () => {
  assert.equal(textToHtml("First <b>para</b>.\n\nSecond,\nwith a break."), "<p>First &lt;b&gt;para&lt;/b&gt;.</p><p>Second,<br>with a break.</p>");
  assert.equal(textToHtml(""), "");
  assert.equal(textToHtml("  \n\n  "), "");
});

test("markdown bodies are rendered and sanitised", () => {
  const html = markdownToHtml("# Title\n\nSome *emphasis* and a [link](https://example.com).\n\n- one\n- two\n\n<script>alert(1)</script>\n\n![Bike](https://cdn.example.com/bike.jpg)");
  assert.match(html, /^<h2>Title<\/h2>/);
  assert.match(html, /<em>emphasis<\/em>/);
  assert.match(html, /<a href="https:\/\/example.com" rel="noopener">link<\/a>/);
  assert.match(html, /<ul>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ul>/);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /<img src="https:\/\/cdn.example.com\/bike.jpg" alt="Bike" \/>/);
  // javascript: links and http images are dropped.
  assert.doesNotMatch(markdownToHtml("[x](javascript:alert(1))"), /href/);
  assert.doesNotMatch(markdownToHtml("![x](http://insecure/x.jpg)"), /src/);
});

test("renderBody picks the format and refuses unknown ones", () => {
  assert.equal(renderBody("*not emphasis*", "text"), "<p>*not emphasis*</p>");
  assert.equal(renderBody("*emphasis*", "markdown"), "<p><em>emphasis</em></p>");
  assert.throws(() => renderBody("x", "html"), /unknown body format/);
});

test("bodyToText and summarize make one line", () => {
  assert.equal(bodyToText("## Heading\n\nA line with **bold** & more.", "markdown"), "Heading A line with bold & more.");
  assert.equal(bodyToText("One.\n\nTwo.", "text"), "One. Two.");
  assert.equal(summarize("short"), "short");
  const long = summarize("word ".repeat(100), 50);
  assert.ok(long.length <= 50);
  assert.match(long, /…$/);
  assert.doesNotMatch(long, / …$/);
});
