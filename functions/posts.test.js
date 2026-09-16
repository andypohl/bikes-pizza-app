import assert from "node:assert/strict";
import { test } from "node:test";

import sharp from "sharp";

import { ValidationError } from "./account.js";
import { AppError } from "./errors.js";
import { memoryPostStore } from "./fakes.js";
import { postDocument } from "./post.js";
import { applyEditSubmission, editable, getPost, largestImageUrl, listMyPosts, patchFor, publishImage, updatePost, validateEdit } from "./posts.js";
import { memoryStore } from "./submissions.test.js";

const image = { base: "https://files.test/o/posts%2Fp1%2Fv1%2F", version: "v1", width: 2000, height: 1500, sizes: [400, 800, 1200], formats: ["webp", "jpg"], blur: "data:x", focus: { x: 0.5, y: 0.5 } };
const extraA = { ...image, base: "https://files.test/o/posts%2Fp1%2Fea%2F", version: "ea" };
const extraB = { ...image, base: "https://files.test/o/posts%2Fp1%2Feb%2F", version: "eb", width: 300, height: 200, sizes: [300] };

const bikePost = postDocument({
  slug: "1992-gt-outpost-abc123",
  feed: "bikes",
  title: "1992 GT Outpost",
  publishedAt: "2026-09-01T12:00:00.000Z",
  body: "First.\n\nSecond.",
  image,
  images: [extraA, extraB],
  details: { brand: "GT", year: "1990s" },
  credit: { uid: "u1", username: "ada_bikes", name: "Ada" },
  source: { system: "submission", id: "s0" },
});

const newsPost = postDocument({
  slug: "welcome",
  feed: "news",
  title: "Welcome",
  publishedAt: "2026-09-02T12:00:00.000Z",
  body: "## Hello\n\nWorld",
  bodyFormat: "markdown",
});

async function seededPosts() {
  const posts = memoryPostStore();
  await posts.create(bikePost.slug, bikePost);
  await posts.create(newsPost.slug, newsPost);
  return posts;
}

const member = { uid: "u1", email: "ada@example.com", admin: false };
const other = { uid: "u2", email: "bob@example.com", admin: false };
const admin = { uid: "a1", email: "admin@example.com", admin: true };
const siteUrl = "https://example.com";
const pngBytes = sharp({ create: { width: 900, height: 600, channels: 3, background: "#336699" } }).png().toBuffer();
const png = async () => ({ contentType: "image/png", data: (await pngBytes).toString("base64") });

const deps = async (extra = {}) => ({
  posts: await seededPosts(),
  siteUrl,
  store: memoryStore(),
  members: { get: async (uid) => (uid === "u1" ? { username: "ada_bikes" } : null) },
  processImage: async (bytes) => ({ full: { bytes, width: 900, height: 600 }, thumb: { bytes: Buffer.from("thumb") } }),
  safeSearch: async () => ({ ok: true }),
  notify: async () => true,
  ...extra,
});

test("editable carries the story, the details for its feed, the image and the site URL", () => {
  const out = editable(bikePost, siteUrl);
  assert.equal(out.id, "1992-gt-outpost-abc123");
  assert.equal(out.url, "https://example.com/post/1992-gt-outpost-abc123/");
  assert.equal(out.story, "First.\n\nSecond.");
  assert.equal(out.storyFormat, "text");
  assert.equal(out.storyHasFormatting, false);
  assert.deepEqual(out.bike, { brand: "GT", year: "1990s", color: "", type: "" });
  assert.equal(out.pizza, null);
  assert.equal(out.pendingEdit, null);
  assert.equal(out.image.url, "https://files.test/o/posts%2Fp1%2Fv1%2F1200.jpg?alt=media");
  assert.equal(out.image.sizes.length, 3);
  assert.deepEqual(out.images.map((i) => [i.version, i.url]), [
    ["ea", "https://files.test/o/posts%2Fp1%2Fea%2F1200.jpg?alt=media"],
    ["eb", "https://files.test/o/posts%2Fp1%2Feb%2F300.jpg?alt=media"],
  ]);
  assert.equal("body" in out, false);
  const news = editable(newsPost, siteUrl, { pendingEdit: { id: "s1", createdAt: new Date("2026-09-03T00:00:00Z") } });
  assert.equal(news.url, "https://example.com/news/welcome/");
  assert.equal(news.storyHasFormatting, true);
  assert.equal(news.bike, null);
  assert.equal(news.image, null);
  assert.deepEqual(news.pendingEdit, { id: "s1", createdAt: "2026-09-03T00:00:00.000Z" });
  assert.equal(largestImageUrl(null), null);
});

test("listMyPosts returns the caller's posts", async () => {
  const d = await deps();
  const out = await listMyPosts(member, d);
  assert.equal(out.posts.length, 1);
  assert.equal(out.posts[0].id, "1992-gt-outpost-abc123");
  assert.equal(out.posts[0].image.url, "https://files.test/o/posts%2Fp1%2Fv1%2F1200.jpg?alt=media");
  assert.equal("story" in out.posts[0], false);
  assert.deepEqual(await listMyPosts(other, d), { posts: [] });
});

test("getPost is for the credited member or an admin; others see not-found", async () => {
  const d = await deps();
  assert.equal((await getPost("1992-gt-outpost-abc123", member, d)).title, "1992 GT Outpost");
  assert.equal((await getPost("1992-gt-outpost-abc123", admin, d)).title, "1992 GT Outpost");
  assert.equal((await getPost("welcome", admin, d)).title, "Welcome");
  await assert.rejects(getPost("1992-gt-outpost-abc123", other, d), (e) => e instanceof AppError && e.code === "not-found");
  await assert.rejects(getPost("welcome", member, d), (e) => e instanceof AppError && e.code === "not-found");
  await assert.rejects(getPost("missing", admin, d), (e) => e instanceof AppError && e.code === "not-found");
  await assert.rejects(getPost("Bad Id!", admin, d), ValidationError);
});

test("validateEdit checks each field and refuses details for the wrong feed", async () => {
  assert.deepEqual(validateEdit({ title: "  New  " }, "bikes"), { title: "New" });
  assert.deepEqual(validateEdit({ story: "", storyFormat: "markdown" }, "bikes"), { story: "", storyFormat: "markdown" });
  assert.deepEqual(validateEdit({ bike: { brand: "Trek", year: "1980s", color: "", type: null } }, "bikes"), {
    bike: { brand: "Trek", year: "1980s", color: "", type: "" },
  });
  assert.deepEqual(validateEdit({ pizza: { style: "detroit" } }, "pizza"), { pizza: { style: "detroit" } });
  assert.throws(() => validateEdit({}, "bikes"), /Nothing to change/);
  assert.throws(() => validateEdit({ title: "" }, "bikes"), /Title is required/);
  assert.throws(() => validateEdit({ title: "x".repeat(256) }, "bikes"), /255/);
  assert.throws(() => validateEdit({ storyFormat: "html" }, "bikes"), /Unknown story format/);
  assert.throws(() => validateEdit({ bike: { year: "1850s" } }, "bikes"), /Unknown year/);
  assert.throws(() => validateEdit({ bike: {} }, "pizza"), /Only bike posts/);
  assert.throws(() => validateEdit({ pizza: {} }, "bikes"), /Only pizza posts/);
  assert.throws(() => validateEdit({ image: { contentType: "image/gif", data: "AAAA" } }, "bikes"), /JPEG, PNG or WebP/);
  assert.throws(() => validateEdit({ image: { contentType: "image/png", data: "" } }, "bikes"), /Photo data/);
  assert.equal(validateEdit({ image: await png() }, "bikes").image.bytes.length > 0, true);
});

test("patchFor renders a new story, replaces the details and keeps the rest", () => {
  const patch = patchFor({ title: "T", story: "One.\n\nTwo.", bike: { brand: "", year: "", color: "", type: "" } }, bikePost);
  assert.equal(patch.title, "T");
  assert.equal(patch.html, "<p>One.</p><p>Two.</p>");
  assert.equal(patch.bodyFormat, "text");
  assert.equal(patch.summary, "One. Two.");
  assert.equal(patch.details, null);
  assert.equal("image" in patch, false);
  const md = patchFor({ story: "## Hi", storyFormat: "markdown" }, newsPost, { image });
  assert.equal(md.html, "<h2>Hi</h2>");
  assert.equal(md.image, image);
  assert.equal("details" in md, false); // news has no details
  assert.deepEqual(patchFor({ pizza: { style: "detroit" } }, { ...bikePost, feed: "pizza" }).details, { style: "detroit" });
});

test("publishImage stores every rendition and describes the image", async () => {
  const posts = memoryPostStore();
  const field = await publishImage(posts, "p1", await pngBytes);
  assert.deepEqual(field.sizes, [400, 800, 900]);
  assert.equal(field.width, 900);
  assert.equal(field.base, `https://files.test/o/posts%2Fp1%2F${field.version}%2F`);
  const names = [...posts.files.keys()].map((k) => k.split("/").pop()).sort();
  assert.deepEqual(names, ["400.jpg", "400.webp", "800.jpg", "800.webp", "900.jpg", "900.webp", "tile.jpg", "tile.webp"]);
});

test("an administrator's edit is applied at once and comes back as the post now reads", async () => {
  const d = await deps();
  const logs = [];
  const out = await updatePost(
    "1992-gt-outpost-abc123",
    { title: "Renamed", bike: { brand: "GT", year: "1990s", color: "orange", type: "mtb" } },
    admin,
    { ...d, log: (m, x) => logs.push([m, x]) },
  );
  assert.equal(out.status, "applied");
  assert.equal(out.post.title, "Renamed");
  assert.deepEqual(out.post.bike, { brand: "GT", year: "1990s", color: "orange", type: "mtb" });
  const stored = await d.posts.get("1992-gt-outpost-abc123");
  assert.equal(stored.title, "Renamed");
  assert.equal(stored.html, "<p>First.</p><p>Second.</p>", "the story was not touched");
  assert.deepEqual(logs[0], ["post edited", { slug: "1992-gt-outpost-abc123", by: "a1", fields: ["title", "bike"] }]);
});

test("an administrator's new photo is normalised and stored as renditions, with no Vision check", async () => {
  let checks = 0;
  const d = await deps({ safeSearch: async () => checks++ });
  const out = await updatePost("1992-gt-outpost-abc123", { image: await png() }, admin, d);
  assert.equal(checks, 0);
  assert.notEqual(out.post.image.version, "v1");
  assert.deepEqual(out.post.image.sizes, [400, 800, 900]);
  assert.equal([...d.posts.files.keys()].some((k) => k.includes("/tile.webp")), true);
});

test("an administrator may write Markdown; a member may not", async () => {
  const d = await deps();
  const out = await updatePost("welcome", { story: "# Big\n\nText", storyFormat: "markdown" }, admin, d);
  assert.equal(out.post.storyHasFormatting, true);
  assert.equal((await d.posts.get("welcome")).html, "<h2>Big</h2>\n<p>Text</p>");
  await assert.rejects(updatePost("1992-gt-outpost-abc123", { story: "x", storyFormat: "markdown" }, member, d), /Only administrators/);
});

test("a member's edit is stored for review and announced; the post is untouched", async () => {
  const d = await deps();
  const notified = [];
  const out = await updatePost(
    "1992-gt-outpost-abc123",
    { title: "Renamed", story: "New story.", image: await png() },
    member,
    { ...d, notify: async (s, u) => notified.push([s.kind, s.title, u.uid]) && true },
  );
  assert.deepEqual(out, { status: "pending", submissionId: "s1", notified: true });
  assert.equal((await d.posts.get("1992-gt-outpost-abc123")).title, "1992 GT Outpost");

  const doc = d.store.docs.get("s1");
  assert.equal(doc.kind, "edit");
  assert.equal(doc.status, "pending");
  assert.deepEqual(doc.post, {
    id: "1992-gt-outpost-abc123",
    slug: "1992-gt-outpost-abc123",
    title: "1992 GT Outpost",
    feed: "bikes",
    url: "https://example.com/post/1992-gt-outpost-abc123/",
    imageUrl: "https://files.test/o/posts%2Fp1%2Fv1%2F800.jpg?alt=media",
  });
  assert.equal(doc.title, "Renamed");
  assert.equal(doc.from, "ada_bikes");
  assert.equal(doc.description, "New story.");
  assert.deepEqual(doc.changes, { title: "Renamed", story: "New story.", image: true, images: false });
  assert.deepEqual(doc.images, []);
  assert.equal(doc.image.path, "submissions/s1/photo.jpg");
  assert.equal(d.store.files.get("submissions/s1/thumb.jpg").bytes.toString(), "thumb");
  assert.deepEqual(notified, [["edit", "Renamed", "u1"]]);
});

test("a member's edit without a new photo keeps the current title and story on the record", async () => {
  const d = await deps();
  const out = await updatePost("1992-gt-outpost-abc123", { bike: { brand: "GT", year: "1980s", color: "", type: "" } }, member, d);
  assert.equal(out.status, "pending");
  const doc = d.store.docs.get("s1");
  assert.equal(doc.title, "1992 GT Outpost");
  assert.equal(doc.description, "First.\n\nSecond.");
  assert.equal(doc.image, null);
  assert.deepEqual(doc.changes, { bike: { brand: "GT", year: "1980s", color: "", type: "" }, image: false, images: false });
});

test("validateEdit takes the additional photos as a list of kept versions and new uploads", async () => {
  const edit = validateEdit({ images: [{ keep: "eb" }, await png()] }, "bikes");
  assert.deepEqual(edit.images[0], { keep: "eb" });
  assert.equal(edit.images[1].contentType, "image/png");
  assert.deepEqual(validateEdit({ images: [] }, "bikes").images, []);
  assert.throws(() => validateEdit({ images: "x" }, "bikes"), /must be a list/);
  assert.throws(() => validateEdit({ images: [{ keep: "" }] }, "bikes"), /Additional photo 1 must be a JPEG/);
  assert.throws(() => validateEdit({ images: Array(5).fill({ keep: "ea" }) }, "bikes"), /At most 4/);
});

test("an administrator reorders, drops and adds additional photos; only the new one is rendered", async () => {
  let checks = 0;
  const d = await deps({ safeSearch: async () => checks++ });
  const out = await updatePost("1992-gt-outpost-abc123", { images: [await png(), { keep: "eb" }] }, admin, d);
  assert.equal(checks, 0);
  assert.equal(out.post.images.length, 2);
  assert.notEqual(out.post.images[0].version, "ea");
  assert.deepEqual(out.post.images[0].sizes, [400, 800, 900]);
  assert.equal(out.post.images[1].version, "eb");
  assert.equal([...d.posts.files.keys()].filter((k) => k.startsWith("posts/1992-gt-outpost-abc123/")).length, 8, "one photo's renditions");
  assert.equal((await d.posts.get("1992-gt-outpost-abc123")).image.version, "v1", "the main photo is untouched");
  await assert.rejects(updatePost("1992-gt-outpost-abc123", { images: [{ keep: "gone" }] }, admin, d), /no longer on the post/);
  assert.deepEqual((await updatePost("1992-gt-outpost-abc123", { images: [] }, admin, d)).post.images, []);
});

test("a member's new additional photo is inspected, named on refusal, and held for review with the kept ones", async () => {
  const seen = [];
  const d = await deps({
    safeSearch: async () => {
      seen.push(1);
      if (seen.length === 2) throw new AppError("invalid-argument", "Your photo seems to show a person or a face. Please choose a photo of just the bike or the pizza.");
      return { ok: true, likelihoods: { adult: "VERY_UNLIKELY" }, people: { faces: 0 } };
    },
  });
  await assert.rejects(
    updatePost("1992-gt-outpost-abc123", { images: [{ keep: "ea" }, await png(), await png()] }, member, d),
    (e) => e.code === "invalid-argument" && e.message.startsWith("Additional photo 3 seems to show a person"),
  );
  assert.equal(d.store.docs.size, 0);
  assert.equal(d.store.files.size, 0);

  const out = await updatePost("1992-gt-outpost-abc123", { images: [{ keep: "eb" }, await png()] }, member, d);
  assert.equal(out.status, "pending");
  const doc = d.store.docs.get("s1");
  assert.deepEqual(doc.changes, { image: false, images: true });
  assert.equal(doc.image, null);
  assert.deepEqual(doc.images[0], {
    keep: "eb",
    width: 300,
    height: 200,
    photoUrl: "https://files.test/o/posts%2Fp1%2Feb%2F300.jpg?alt=media",
    thumbUrl: "https://files.test/o/posts%2Fp1%2Feb%2F300.jpg?alt=media",
  });
  assert.equal(doc.images[1].path, "submissions/s1/photo-2.jpg");
  assert.deepEqual(doc.images[1].safeSearch, { adult: "VERY_UNLIKELY" });
  assert.equal(d.store.files.get("submissions/s1/thumb-2.jpg").bytes.toString(), "thumb");
  assert.equal((await d.posts.get("1992-gt-outpost-abc123")).images.length, 2, "the post is untouched until review");

  const result = await applyEditSubmission(doc, d);
  assert.equal(result.postStatus, "published");
  const stored = await d.posts.get("1992-gt-outpost-abc123");
  assert.equal(stored.images.length, 2);
  assert.equal(stored.images[0].version, "eb");
  assert.deepEqual(stored.images[1].sizes, [400, 800, 900]);
  assert.equal(stored.image.version, "v1");
});

test("a member's photo that fails the Vision check is refused before anything is stored", async () => {
  const d = await deps({
    safeSearch: async () => {
      throw new AppError("invalid-argument", "Your photo failed Google SafeSearch inspection.");
    },
  });
  await assert.rejects(updatePost("1992-gt-outpost-abc123", { image: await png() }, member, d), /SafeSearch/);
  assert.equal(d.store.docs.size, 0);
  assert.equal(d.store.files.size, 0);
});

test("one pending edit per post: a second is refused and getPost reports the first", async () => {
  const d = await deps();
  await updatePost("1992-gt-outpost-abc123", { title: "One" }, member, d);
  await assert.rejects(updatePost("1992-gt-outpost-abc123", { title: "Two" }, member, d), (e) => e.code === "failed-precondition" && /already waiting/.test(e.message));
  assert.equal((await getPost("1992-gt-outpost-abc123", member, d)).pendingEdit.id, "s1");
  assert.equal((await updatePost("1992-gt-outpost-abc123", { title: "Two" }, admin, d)).status, "applied");
});

test("updatePost refuses other members and bad input before touching anything", async () => {
  const d = await deps();
  await assert.rejects(updatePost("1992-gt-outpost-abc123", { title: "x" }, other, d), (e) => e.code === "not-found");
  await assert.rejects(updatePost("1992-gt-outpost-abc123", { title: "" }, member, d), ValidationError);
  await assert.rejects(updatePost("1992-gt-outpost-abc123", { pizza: { style: "detroit" } }, member, d), /Only pizza posts/);
  assert.equal((await d.posts.get("1992-gt-outpost-abc123")).title, "1992 GT Outpost");
  assert.equal(d.store.docs.size, 0);
});

test("applyEditSubmission writes a reviewed edit, photo included, to the post", async () => {
  const d = await deps();
  await updatePost("1992-gt-outpost-abc123", { title: "Renamed", image: await png(), bike: { brand: "", year: "", color: "", type: "" } }, member, d);
  const result = await applyEditSubmission(d.store.docs.get("s1"), d);
  assert.deepEqual(result, { postId: "1992-gt-outpost-abc123", postUrl: "https://example.com/post/1992-gt-outpost-abc123/", postStatus: "published" });
  const stored = await d.posts.get("1992-gt-outpost-abc123");
  assert.equal(stored.title, "Renamed");
  assert.equal(stored.details, null);
  assert.notEqual(stored.image.version, "v1");
  assert.equal(stored.html, "<p>First.</p><p>Second.</p>");
  await assert.rejects(applyEditSubmission({ ...d.store.docs.get("s1"), post: { id: "gone" } }, d), (e) => e.code === "not-found");
});
