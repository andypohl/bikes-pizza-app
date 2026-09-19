import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_BODY_WORDS, MAX_QUERY_TERMS, detailWords, prefixes, queryTerms, searchIndex, words } from "./search_index.js";

test("words lowercases, drops accents and punctuation, and keeps order without repeats", () => {
  assert.deepEqual(words("Schwinn Paramount, 1972 — a schwinn! Café"), ["schwinn", "paramount", "1972", "cafe"]);
  assert.deepEqual(words("a I x"), []);
  assert.deepEqual(words(null), []);
  assert.equal(words("x".repeat(40))[0].length, 24);
});

test("prefixes run from two characters to the whole word", () => {
  assert.deepEqual(prefixes(["trek"]), ["tr", "tre", "trek"]);
  assert.deepEqual(prefixes(["tr", "trek"]), ["tr", "tre", "trek"]);
  assert.equal(prefixes(["a".repeat(30)]).length, 19);
});

test("detail words carry the stored values and their option titles", () => {
  assert.deepEqual(detailWords({ brand: "Schwinn", year: "1970s", color: "silver", type: "fat-mtb" }), ["schwinn", "1970s", "silver", "gray", "fat", "mtb"]);
  assert.deepEqual(detailWords({ style: "chicago-deep-dish" }), ["chicago", "deep", "dish"]);
  assert.deepEqual(detailWords(null), []);
  assert.deepEqual(detailWords({ brand: "", year: 7 }), []);
});

test("the index has title and detail prefixes, whole body words, and the union", () => {
  const index = searchIndex({ title: "Red Trek", details: { style: "detroit" }, body: "A **square** pie with red edges.", bodyFormat: "markdown" });
  assert.deepEqual(index.title, ["re", "red", "tr", "tre", "trek"]);
  assert.deepEqual(index.details, ["de", "det", "detr", "detro", "detroi", "detroit"]);
  assert.ok(index.words.includes("square") && index.words.includes("edges") && index.words.includes("trek") && index.words.includes("detroit"));
  assert.ok(!index.words.includes("squ"), "body words have no prefixes");
  assert.equal(new Set(index.words).size, index.words.length);
});

test("the body contributes at most MAX_BODY_WORDS distinct words", () => {
  const body = Array.from({ length: MAX_BODY_WORDS + 50 }, (_, i) => `word${i}`).join(" ");
  const index = searchIndex({ title: "t1", body });
  assert.equal(index.words.length, 1 + MAX_BODY_WORDS);
});

test("query terms are the same words, capped", () => {
  assert.deepEqual(queryTerms("  Red SCHWINN, red "), ["red", "schwinn"]);
  assert.equal(queryTerms(Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ")).length, MAX_QUERY_TERMS);
});
