import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError, ValidationError } from "./errors.js";
import { memoryMemberStore, memoryPostStore } from "./fakes.js";
import { postDocument } from "./post.js";
import { PAGE_SIZE, countsOf, getProfile, listMemberPosts } from "./profiles.js";

const post = (slug, feed, day, uid = "u1") =>
  postDocument({
    slug,
    feed,
    title: slug,
    publishedAt: `2026-09-${String(day).padStart(2, "0")}T12:00:00.000Z`,
    body: "x",
    credit: { uid, username: uid === "u1" ? "ada_bikes" : "bob", name: "" },
  });

async function setup() {
  const posts = memoryPostStore();
  for (const doc of [post("p1", "pizza", 1), post("p2", "pizza", 3), post("b1", "bikes", 2), post("n1", "news", 4), post("p9", "pizza", 5, "u2")]) {
    await posts.create(doc.slug, doc);
  }
  const members = memoryMemberStore({
    u1: { username: "ada_bikes", email: "a@b.c", joinedAt: "2025-03-04T05:06:07.000Z", location: "Madison, WI" },
    u2: { username: "bob", email: "b@b.c", messages: false },
    u3: { username: "", email: "c@b.c" },
  });
  return { posts, members, siteUrl: "https://bikes.pizza" };
}

test("countsOf counts the gallery feeds only", () => {
  assert.deepEqual(countsOf([{ feed: "pizza" }, { feed: "pizza" }, { feed: "bikes" }, { feed: "news" }]), { bikes: 1, pizza: 2 });
  assert.deepEqual(countsOf([]), { bikes: 0, pizza: 0 });
});

test("the profile has the join date, location, counts and whether the viewer may message", async () => {
  const deps = await setup();
  const anon = await getProfile("Ada_Bikes", null, deps);
  assert.deepEqual(anon, {
    uid: "u1",
    username: "ada_bikes",
    joinedAt: "2025-03-04T05:06:07.000Z",
    location: "Madison, WI",
    counts: { bikes: 1, pizza: 2 },
    messages: false,
  });
  assert.equal((await getProfile("ada_bikes", { uid: "u2" }, deps)).messages, true);
  assert.equal((await getProfile("ada_bikes", { uid: "u1" }, deps)).messages, false, "not oneself");
  const bob = await getProfile("bob", { uid: "u1" }, deps);
  assert.equal(bob.messages, false, "bob turned messages off");
  assert.equal(bob.location, "");
  assert.equal(bob.joinedAt, null);
});

test("unknown, malformed or empty usernames are not found", async () => {
  const deps = await setup();
  for (const name of ["nobody", "", "a b", "x".repeat(40), "u3"]) {
    await assert.rejects(getProfile(name, null, deps), (e) => e instanceof AppError && e.code === "not-found");
  }
});

test("a member's posts page by feed, newest first", async () => {
  const deps = await setup();
  const page = await listMemberPosts("ada_bikes", { feed: "pizza" }, deps);
  assert.equal(page.username, "ada_bikes");
  assert.equal(page.feed, "pizza");
  assert.equal(page.pageSize, PAGE_SIZE);
  assert.deepEqual(page.posts.map((p) => [p.id, p.url]), [
    ["p2", "https://bikes.pizza/post/p2/"],
    ["p1", "https://bikes.pizza/post/p1/"],
  ]);
  assert.equal(page.hasMore, false);
  const small = await listMemberPosts("ada_bikes", { feed: "pizza", pageSize: "1" }, deps);
  assert.deepEqual(small.posts.map((p) => p.id), ["p2"]);
  assert.equal(small.hasMore, true);
  const next = await listMemberPosts("ada_bikes", { feed: "pizza", pageSize: "1", page: "2" }, deps);
  assert.deepEqual(next.posts.map((p) => p.id), ["p1"]);
  assert.equal(next.hasMore, false);
  assert.deepEqual((await listMemberPosts("ada_bikes", { feed: "bikes" }, deps)).posts.map((p) => p.id), ["b1"]);
  await assert.rejects(listMemberPosts("ada_bikes", { feed: "news" }, deps), ValidationError);
  await assert.rejects(listMemberPosts("ada_bikes", {}, deps), ValidationError);
  await assert.rejects(listMemberPosts("nobody", { feed: "pizza" }, deps), (e) => e.code === "not-found");
});

test("a block either way turns messages off on the profile", async () => {
  const deps = await setup();
  const blocks = async (uid) => (uid === "u2" ? ["u1"] : []);
  assert.equal((await getProfile("ada_bikes", { uid: "u2" }, { ...deps, blocks })).messages, false, "bob blocked ada");
  assert.equal((await getProfile("ada_bikes", { uid: "u3" }, { ...deps, blocks })).messages, true);
  const mine = async (uid) => (uid === "u3" ? ["u1"] : []);
  assert.equal((await getProfile("ada_bikes", { uid: "u3" }, { ...deps, blocks: mine })).messages, false, "the viewer blocked ada");
});
