import assert from "node:assert/strict";
import { test } from "node:test";

import { ValidationError } from "./errors.js";
import { memoryMemberStore, memoryPostStore } from "./fakes.js";
import { postDocument } from "./post.js";
import { CANDIDATES, LIMIT, MAX_LIMIT, groupOf, parseLimit, parseQuery, search, snippet } from "./search.js";

const post = (slug, feed, day, extra = {}) =>
  postDocument({
    slug,
    feed,
    title: slug,
    publishedAt: `2026-09-${String(day).padStart(2, "0")}T12:00:00.000Z`,
    body: "x",
    credit: { uid: "u1", username: "ada_bikes", name: "" },
    ...extra,
  });

async function setup() {
  const posts = memoryPostStore();
  for (const doc of [
    post("schwinn-paramount", "bikes", 1, { title: "Schwinn Paramount", details: { brand: "Schwinn", year: "1970s", color: "red" }, body: "A racing frame from Chicago." }),
    post("red-trek", "bikes", 2, { title: "Red Trek", details: { brand: "Trek", color: "red", type: "road" }, body: "Bought it in Madison." }),
    post("tavern-pie", "pizza", 3, { title: "Friday pie", details: { style: "chicago-tavern" }, body: "Thin, square cut, from a tavern on the south side of Chicago." }),
    post("removed", "bikes", 4, { title: "Chicago Schwinn", status: "removed" }),
    post("news", "news", 5, { title: "Shop news", body: "The **Schwinn** wall is back, and so is the red paint.", bodyFormat: "markdown" }),
  ]) {
    await posts.create(doc.slug, doc);
  }
  const members = memoryMemberStore({
    u1: { username: "ada_bikes", email: "a@b.c" },
    u2: { username: "Adam", email: "b@b.c" },
    u3: { username: "bob_pizza", email: "c@b.c" },
    u4: { username: "", email: "d@b.c" },
  });
  return { posts, members, siteUrl: "https://bikes.pizza" };
}

test("parseQuery splits post terms and keeps usernames whole", () => {
  assert.deepEqual(parseQuery("Ada_Bikes red"), { terms: ["ada", "bikes", "red"], usernamePrefix: "ada_bikes", usernameWords: ["ada_bikes", "red"] });
  assert.deepEqual(parseQuery("  Red! "), { terms: ["red"], usernamePrefix: "red", usernameWords: ["red"] });
  assert.throws(() => parseQuery(""), ValidationError);
  assert.throws(() => parseQuery(" a "), ValidationError);
  assert.throws(() => parseQuery(undefined), ValidationError);
});

test("parseLimit stays between 1 and MAX_LIMIT", () => {
  assert.equal(parseLimit(undefined), LIMIT);
  assert.equal(parseLimit("5"), 5);
  assert.equal(parseLimit("0"), LIMIT);
  assert.equal(parseLimit("abc"), LIMIT);
  assert.equal(parseLimit("500"), MAX_LIMIT);
});

test("groupOf picks the best group every term qualifies for", () => {
  const index = { title: ["re", "red", "tr", "tre", "trek"], details: ["ro", "roa", "road"], words: ["re", "red", "tr", "tre", "trek", "ro", "roa", "road", "madison"] };
  assert.equal(groupOf(["re", "trek"], index), "title");
  assert.equal(groupOf(["red", "road"], index), "details");
  assert.equal(groupOf(["madison"], index), "text");
  assert.equal(groupOf(["red", "madison"], index), "text");
  assert.equal(groupOf(["red", "nope"], index), null);
  assert.equal(groupOf(["red"], undefined), null);
  assert.equal(groupOf([], index), null);
});

test("snippet shows the story around the first matching word", () => {
  const body = `${"Filler words here. ".repeat(20)}The Schwinn wall is back.${" More text after that.".repeat(10)}`;
  const out = snippet({ body, bodyFormat: "text" }, ["schwinn"]);
  assert.ok(out.startsWith("…") && out.endsWith("…"), out);
  assert.ok(out.includes("Schwinn wall"), out);
  assert.ok(out.length <= 145, out.length);
  assert.equal(snippet({ body: "Short story.", bodyFormat: "text" }, ["nothing"]), "Short story.");
  assert.equal(snippet({ body: "**Bold** start.", bodyFormat: "markdown" }, ["bold"]), "Bold start.");
});

test("search answers members, then titles, details and text, newest first", async () => {
  const deps = await setup();
  const out = await search({ q: "schwinn" }, deps);
  assert.equal(out.query, "schwinn");
  assert.deepEqual(out.members, []);
  assert.deepEqual(out.titles.map((p) => p.id), ["schwinn-paramount"]);
  assert.deepEqual(out.details, []);
  assert.deepEqual(out.text.map((p) => p.id), ["news"]);
  assert.equal(out.text[0].snippet, "The Schwinn wall is back, and so is the red paint.");
  assert.equal(out.titles[0].url, "https://bikes.pizza/post/schwinn-paramount/");
  assert.equal("snippet" in out.titles[0], false);
});

test("a prefix finds titles and details, but a story needs the whole word", async () => {
  const deps = await setup();
  const red = await search({ q: "re" }, deps);
  assert.deepEqual(red.titles.map((p) => p.id), ["red-trek"]);
  assert.deepEqual(red.details.map((p) => p.id), ["schwinn-paramount"]);
  assert.deepEqual(red.text, []);
  const chicago = await search({ q: "chicago" }, deps);
  assert.deepEqual(chicago.titles, []);
  assert.deepEqual(chicago.details.map((p) => p.id), ["tavern-pie"]);
  assert.deepEqual(chicago.text.map((p) => p.id), ["schwinn-paramount"]);
  assert.deepEqual((await search({ q: "chic" }, deps)).text, []);
});

test("every term has to match, and a post is listed once", async () => {
  const deps = await setup();
  const out = await search({ q: "red chicago" }, deps);
  assert.deepEqual(out.titles, []);
  assert.deepEqual(out.details, []);
  assert.deepEqual(out.text.map((p) => p.id), ["schwinn-paramount"], "red in the details, chicago in the story; the news post has no chicago");
  const both = await search({ q: "schwinn red" }, deps);
  assert.deepEqual(both.titles, []);
  assert.deepEqual(both.details.map((p) => p.id), ["schwinn-paramount"]);
  assert.deepEqual(both.text.map((p) => p.id), ["news"]);
  assert.deepEqual((await search({ q: "red nothingness" }, deps)).text, []);
});

test("members match by username prefix, case-insensitively, every word included", async () => {
  const deps = await setup();
  assert.deepEqual((await search({ q: "AD" }, deps)).members, [{ username: "ada_bikes" }, { username: "Adam" }]);
  assert.deepEqual((await search({ q: "ada_b" }, deps)).members, [{ username: "ada_bikes" }]);
  assert.deepEqual((await search({ q: "ada bikes" }, deps)).members, [{ username: "ada_bikes" }]);
  assert.deepEqual((await search({ q: "bob" }, deps)).members, [{ username: "bob_pizza" }]);
  assert.deepEqual((await search({ q: "pizza" }, deps)).members, []);
});

test("limit caps every group; candidates are the newest CANDIDATES posts", async () => {
  const deps = await setup();
  for (let i = 0; i < CANDIDATES + 5; i += 1) {
    const doc = post(`filler-${i}`, "pizza", 10 + (i % 19), { title: `Filler ${i}`, body: "common word" });
    await deps.posts.create(doc.slug, doc);
  }
  const out = await search({ q: "filler", limit: "3" }, deps);
  assert.equal(out.titles.length, 3);
  const all = await search({ q: "common", limit: "50" }, deps);
  assert.equal(all.text.length, MAX_LIMIT);
  let seen = 0;
  deps.posts.search = async (terms, { limit }) => {
    seen = limit;
    return [];
  };
  await search({ q: "common" }, deps);
  assert.equal(seen, CANDIDATES);
});

test("the search index is written on publish and follows edits", async () => {
  const { postDocument: make } = await import("./post.js");
  const { patchFor } = await import("./posts.js");
  const doc = make({ slug: "s", feed: "bikes", title: "Blue Bianchi", publishedAt: "2026-09-01T00:00:00.000Z", body: "Celeste, really.", details: { brand: "Bianchi", color: "blue" } });
  assert.ok(doc.search.title.includes("bianchi") && doc.search.details.includes("blue") && doc.search.words.includes("celeste"));
  const patch = patchFor({ title: "Green Bianchi" }, doc);
  assert.ok(patch.search.title.includes("green") && !patch.search.title.includes("blue"));
  assert.ok(patch.search.words.includes("celeste"), "the untouched body is still indexed");
  assert.ok(patch.search.details.includes("blue"), "the untouched details are still indexed");
  assert.equal("search" in patchFor({ publishedAt: "2026-09-02T00:00:00.000Z" }, doc), false);
  const cleared = patchFor({ bike: { brand: "", year: "", color: "", type: "" } }, doc);
  assert.equal(cleared.details, null);
  assert.deepEqual(cleared.search.details, []);
});
