import assert from "node:assert/strict";
import { test } from "node:test";

import { ValidationError } from "./account.js";
import { AppError } from "./errors.js";
import {
  applyEditSubmission,
  blocksToText,
  editable,
  getPost,
  isPlainText,
  listMyPosts,
  patchFor,
  updatePost,
  validateEdit,
} from "./posts.js";
import { memoryStore } from "./submissions.test.js";

const span = (text, marks = []) => ({ _type: "span", _key: "s", text, marks });
const block = (text, extra = {}) => ({ _type: "block", _key: "b", style: "normal", markDefs: [], children: [span(text)], ...extra });

const bikePost = {
  _id: "p1",
  title: "1992 GT Outpost",
  feed: "bikes",
  publishedAt: "2026-09-01T12:00:00.000Z",
  slug: "1992-gt-outpost-abc123",
  submittedBy: "Ada",
  authorUid: "u1",
  image: { url: "https://cdn.sanity.io/images/x/y/a-2000x1500.jpg", width: 2000, height: 1500 },
  body: [block("First."), block("Second.")],
  bike: { brand: "GT", year: "1990s" },
  pizza: null,
};

const newsPost = {
  _id: "n1",
  title: "Welcome",
  feed: "news",
  publishedAt: "2026-09-02T12:00:00.000Z",
  slug: "welcome",
  authorUid: null,
  image: null,
  body: [block("Hello", { style: "h2" }), block("World")],
};

/** A Sanity stand-in holding a few posts; records patches and uploads. */
function fakeSanity(seed = [bikePost, newsPost]) {
  const posts = structuredClone(seed); // patches must not leak between tests
  const calls = [];
  return {
    calls,
    posts,
    async query(groq, params) {
      calls.push(["query", params]);
      if (groq.includes("author->uid == $uid")) return posts.filter((p) => p.authorUid === params.uid);
      return posts.find((p) => p._id === params.id) ?? null;
    },
    async uploadImage(image) {
      calls.push(["upload", image.contentType, image.filename]);
      return "image-new-10x10-jpg";
    },
    async patchDocument(id, set, options) {
      calls.push(["patch", id, set, options]);
      const post = posts.find((p) => p._id === id);
      Object.assign(post, set);
      for (const key of options?.unset ?? []) delete post[key];
    },
  };
}

const member = { uid: "u1", email: "ada@example.com", admin: false };
const other = { uid: "u2", email: "bob@example.com", admin: false };
const admin = { uid: "a1", email: "admin@example.com", admin: true };
const siteUrl = "https://example.com";
const png = { contentType: "image/png", data: Buffer.from("png").toString("base64") };

const deps = (sanity, extra = {}) => ({
  sanity,
  siteUrl,
  store: memoryStore(),
  members: { get: async (uid) => (uid === "u1" ? { username: "ada_bikes" } : null) },
  processImage: async (bytes) => ({ full: { bytes: Buffer.from(`full:${bytes}`), width: 10, height: 10 }, thumb: { bytes: Buffer.from("thumb") } }),
  safeSearch: async () => ({ ok: true }),
  notify: async () => true,
  ...extra,
});

test("blocksToText joins paragraphs with blank lines; isPlainText spots formatting", () => {
  assert.equal(blocksToText(bikePost.body), "First.\n\nSecond.");
  assert.equal(blocksToText(undefined), "");
  assert.equal(isPlainText(bikePost.body), true);
  assert.equal(isPlainText(newsPost.body), false);
  assert.equal(isPlainText([block("x", { listItem: "bullet" })]), false);
  assert.equal(isPlainText([{ ...block("x"), children: [span("x", ["strong"])] }]), false);
  assert.equal(isPlainText([{ _type: "image", asset: {} }]), false);
});

test("editable carries the story, the details for its feed and the site URL", () => {
  const out = editable(bikePost, siteUrl);
  assert.equal(out.id, "p1");
  assert.equal(out.url, "https://example.com/post/1992-gt-outpost-abc123/");
  assert.equal(out.story, "First.\n\nSecond.");
  assert.equal(out.storyHasFormatting, false);
  assert.deepEqual(out.bike, { brand: "GT", year: "1990s", color: "", type: "" });
  assert.equal(out.pizza, null);
  assert.equal(out.pendingEdit, null);
  assert.deepEqual(out.image, { url: bikePost.image.url, width: 2000, height: 1500 });
  const news = editable(newsPost, siteUrl, { pendingEdit: { id: "s1", createdAt: new Date("2026-09-03T00:00:00Z") } });
  assert.equal(news.url, "https://example.com/news/welcome/");
  assert.equal(news.storyHasFormatting, true);
  assert.equal(news.bike, null);
  assert.equal(news.image, null);
  assert.deepEqual(news.pendingEdit, { id: "s1", createdAt: "2026-09-03T00:00:00.000Z" });
});

test("listMyPosts returns the caller's posts as summaries", async () => {
  const out = await listMyPosts(member, deps(fakeSanity()));
  assert.equal(out.posts.length, 1);
  assert.equal(out.posts[0].id, "p1");
  assert.equal("story" in out.posts[0], false);
  assert.deepEqual(await listMyPosts(other, deps(fakeSanity())), { posts: [] });
});

test("getPost is for the credited member or an admin; others see not-found", async () => {
  const sanity = fakeSanity();
  assert.equal((await getPost("p1", member, deps(sanity))).title, "1992 GT Outpost");
  assert.equal((await getPost("p1", admin, deps(sanity))).title, "1992 GT Outpost");
  assert.equal((await getPost("n1", admin, deps(sanity))).title, "Welcome");
  await assert.rejects(getPost("p1", other, deps(sanity)), (e) => e instanceof AppError && e.code === "not-found");
  await assert.rejects(getPost("n1", member, deps(sanity)), (e) => e instanceof AppError && e.code === "not-found");
  await assert.rejects(getPost("missing", admin, deps(sanity)), (e) => e instanceof AppError && e.code === "not-found");
  await assert.rejects(getPost("bad id!", admin, deps(sanity)), ValidationError);
});

test("validateEdit checks each field and refuses details for the wrong feed", () => {
  assert.deepEqual(validateEdit({ title: "  New  " }, "bikes"), { title: "New" });
  assert.deepEqual(validateEdit({ story: "" }, "bikes"), { story: "" });
  assert.deepEqual(validateEdit({ bike: { brand: "Trek", year: "1980s", color: "", type: null } }, "bikes"), {
    bike: { brand: "Trek", year: "1980s", color: "", type: "" },
  });
  assert.deepEqual(validateEdit({ pizza: { style: "detroit" } }, "pizza"), { pizza: { style: "detroit" } });
  assert.throws(() => validateEdit({}, "bikes"), /Nothing to change/);
  assert.throws(() => validateEdit({ title: "" }, "bikes"), /Title is required/);
  assert.throws(() => validateEdit({ title: "x".repeat(256) }, "bikes"), /255/);
  assert.throws(() => validateEdit({ bike: { year: "1850s" } }, "bikes"), /Unknown year/);
  assert.throws(() => validateEdit({ bike: {} }, "pizza"), /Only bike posts/);
  assert.throws(() => validateEdit({ pizza: {} }, "bikes"), /Only pizza posts/);
  assert.throws(() => validateEdit({ image: { contentType: "image/gif", data: "AAAA" } }, "bikes"), /JPEG, PNG or WebP/);
  assert.throws(() => validateEdit({ image: { contentType: "image/png", data: "" } }, "bikes"), /Photo data/);
  assert.equal(validateEdit({ image: png }, "bikes").image.bytes.toString(), "png");
});

test("patchFor sets changed fields, clears emptied details and keeps alt in step", () => {
  const { set, unset } = patchFor({ title: "T", story: "One.\n\nTwo.", bike: { brand: "", year: "", color: "", type: "" } }, { title: "Old" });
  assert.equal(set.title, "T");
  assert.equal(set.body.length, 2);
  assert.deepEqual(unset, ["bike"]);
  assert.equal("mainImage" in set, false);
  const withImage = patchFor({ pizza: { style: "detroit" } }, { title: "Old", imageAssetId: "image-1" });
  assert.deepEqual(withImage.set.pizza, { style: "detroit" });
  assert.deepEqual(withImage.set.mainImage, { _type: "image", asset: { _type: "reference", _ref: "image-1" }, alt: "Old" });
  assert.deepEqual(withImage.unset, []);
});

test("an administrator's edit is applied at once and comes back as the post now reads", async () => {
  const sanity = fakeSanity();
  const logs = [];
  const out = await updatePost(
    "p1",
    { title: "Renamed", bike: { brand: "GT", year: "1990s", color: "orange", type: "mtb" } },
    admin,
    deps(sanity, { log: (m, d) => logs.push([m, d]) }),
  );
  assert.equal(out.status, "applied");
  assert.equal(out.post.title, "Renamed");
  assert.deepEqual(out.post.bike, { brand: "GT", year: "1990s", color: "orange", type: "mtb" });
  const patch = sanity.calls.find((c) => c[0] === "patch");
  assert.deepEqual(patch.slice(1, 3), ["p1", { title: "Renamed", bike: { brand: "GT", year: "1990s", color: "orange", type: "mtb" } }]);
  assert.deepEqual(logs[0], ["post edited", { id: "p1", by: "a1", fields: ["title", "bike"] }]);
});

test("an administrator's new photo is normalised and uploaded, with no Vision check", async () => {
  let checks = 0;
  const sanity = fakeSanity();
  await updatePost("p1", { image: png }, admin, deps(sanity, { safeSearch: async () => checks++ }));
  assert.equal(checks, 0);
  assert.deepEqual(sanity.calls.find((c) => c[0] === "upload"), ["upload", "image/jpeg", "bikes-photo.jpg"]);
  assert.deepEqual(sanity.calls.find((c) => c[0] === "patch")[2].mainImage, {
    _type: "image",
    asset: { _type: "reference", _ref: "image-new-10x10-jpg" },
    alt: "1992 GT Outpost",
  });
});

test("a member's edit is stored for review and announced; the post is untouched", async () => {
  const sanity = fakeSanity();
  const store = memoryStore();
  const notified = [];
  const out = await updatePost(
    "p1",
    { title: "Renamed", story: "New story.", image: png },
    member,
    deps(sanity, { store, notify: async (s, u) => notified.push([s.kind, s.title, u.uid]) && true }),
  );
  assert.deepEqual(out, { status: "pending", submissionId: "s1", notified: true });
  assert.equal(sanity.calls.some((c) => c[0] === "patch" || c[0] === "upload"), false);

  const doc = store.docs.get("s1");
  assert.equal(doc.kind, "edit");
  assert.equal(doc.status, "pending");
  assert.deepEqual(doc.post, {
    id: "p1",
    slug: "1992-gt-outpost-abc123",
    title: "1992 GT Outpost",
    feed: "bikes",
    url: "https://example.com/post/1992-gt-outpost-abc123/",
    imageUrl: bikePost.image.url,
  });
  assert.equal(doc.title, "Renamed");
  assert.equal(doc.from, "ada_bikes");
  assert.equal(doc.description, "New story.");
  assert.equal(doc.uid, "u1");
  assert.deepEqual(doc.changes, { title: "Renamed", story: "New story.", image: true });
  assert.equal(doc.image.path, "submissions/s1/photo.jpg");
  assert.equal(store.files.get("submissions/s1/photo.jpg").bytes.toString(), "full:png");
  assert.equal(store.files.get("submissions/s1/thumb.jpg").bytes.toString(), "thumb");
  assert.deepEqual(notified, [["edit", "Renamed", "u1"]]);
});

test("a member's edit without a new photo keeps the current title and story on the record", async () => {
  const store = memoryStore();
  const out = await updatePost("p1", { bike: { brand: "GT", year: "1980s", color: "", type: "" } }, member, deps(fakeSanity(), { store }));
  assert.equal(out.status, "pending");
  const doc = store.docs.get("s1");
  assert.equal(doc.title, "1992 GT Outpost");
  assert.equal(doc.description, "First.\n\nSecond.");
  assert.equal(doc.image, null);
  assert.deepEqual(doc.changes, { bike: { brand: "GT", year: "1980s", color: "", type: "" }, image: false });
});

test("a member's photo that fails the Vision check is refused before anything is stored", async () => {
  const store = memoryStore();
  const refused = deps(fakeSanity(), {
    store,
    safeSearch: async () => {
      throw new AppError("invalid-argument", "Your photo failed Google SafeSearch inspection.");
    },
  });
  await assert.rejects(updatePost("p1", { image: png }, member, refused), /SafeSearch/);
  assert.equal(store.docs.size, 0);
  assert.equal(store.files.size, 0);
});

test("one pending edit per post: a second is refused and getPost reports the first", async () => {
  const store = memoryStore();
  const d = deps(fakeSanity(), { store });
  await updatePost("p1", { title: "One" }, member, d);
  await assert.rejects(updatePost("p1", { title: "Two" }, member, d), (e) => e.code === "failed-precondition" && /already waiting/.test(e.message));
  const post = await getPost("p1", member, d);
  assert.equal(post.pendingEdit.id, "s1");
  // An admin's direct edit is not blocked by it.
  assert.equal((await updatePost("p1", { title: "Two" }, admin, d)).status, "applied");
});

test("updatePost refuses other members and bad input before touching anything", async () => {
  const sanity = fakeSanity();
  const store = memoryStore();
  const d = deps(sanity, { store });
  await assert.rejects(updatePost("p1", { title: "x" }, other, d), (e) => e.code === "not-found");
  await assert.rejects(updatePost("p1", { title: "" }, member, d), ValidationError);
  await assert.rejects(updatePost("p1", { pizza: { style: "detroit" } }, member, d), /Only pizza posts/);
  assert.equal(sanity.calls.some((c) => c[0] === "patch"), false);
  assert.equal(store.docs.size, 0);
});

test("applyEditSubmission writes a reviewed edit, photo included, to the post", async () => {
  const sanity = fakeSanity();
  const store = memoryStore();
  await updatePost("p1", { title: "Renamed", image: png, bike: { brand: "", year: "", color: "", type: "" } }, member, deps(sanity, { store }));
  const result = await applyEditSubmission(store.docs.get("s1"), { store, sanity, siteUrl });
  assert.deepEqual(result, { postId: "p1", postUrl: "https://example.com/post/1992-gt-outpost-abc123/", postStatus: "published" });
  assert.deepEqual(sanity.calls.find((c) => c[0] === "upload"), ["upload", "image/jpeg", "bikes-photo.jpg"]);
  const patch = sanity.calls.find((c) => c[0] === "patch");
  assert.equal(patch[2].title, "Renamed");
  assert.equal(patch[2].mainImage.asset._ref, "image-new-10x10-jpg");
  assert.equal(patch[2].mainImage.alt, "Renamed");
  assert.deepEqual(patch[3], { unset: ["bike"] });
  assert.equal(sanity.posts[0].title, "Renamed");
  assert.equal("bike" in sanity.posts[0], false);

  await assert.rejects(
    applyEditSubmission({ ...store.docs.get("s1"), post: { id: "gone" } }, { store, sanity, siteUrl }),
    (e) => e.code === "not-found",
  );
});

test("admins may flatten a formatted story; the reply says it was formatted", async () => {
  const sanity = fakeSanity();
  const d = deps(sanity);
  assert.equal((await getPost("n1", admin, d)).storyHasFormatting, true);
  const out = await updatePost("n1", { story: "Plain now." }, admin, d);
  assert.equal(out.post.story, "Plain now.");
  assert.equal(out.post.storyHasFormatting, false);
});
