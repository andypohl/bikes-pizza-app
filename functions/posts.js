// Editing published posts from the app. The member a post is credited to
// (`credit.uid`) may ask for changes to its title, photos, story and
// structured details; the request is stored as a submission of kind `edit`
// for review, like a new post, and applied when a reviewer approves it
// (submissions.js). An administrator who signed in with their second
// factor edits any post directly. Pure: the post store, the submission
// store, the image pipeline and the Vision check are injected.
//
// Members write their story as plain text (`bodyFormat: "text"`); a story
// an administrator wrote in Markdown is reported as formatted, and a member
// who saves a new story over it turns it back into plain text.
//
// Administrators also write posts here: news, from the admin page
// (createPost), and can take a post off the site (removePost).

import { randomUUID } from "node:crypto";

import { ValidationError } from "./account.js";
import { ARTICLE_FEEDS, BIKE_COLORS_VALUES, BIKE_TYPES_VALUES, BIKE_YEARS_VALUES, PIZZA_STYLES_VALUES } from "./contract.js";
import { AppError } from "./errors.js";
import { BODY_FORMATS } from "./markdown.js";
import { DETAIL_FIELDS, bodyPatch, detailsFor, imageField, postDocument, publicPost, slugFor } from "./post.js";
import { renditionUrl } from "./post_store.js";
import { makeRenditions } from "./renditions.js";
import { extraLabel, parseExtras, parseUpload, preparePhoto, storeExtra, storePhoto } from "./uploads.js";

const MAX_TITLE = 255;
const MAX_STORY = 10_000;
const MAX_BRAND = 100;

// Slugs: letters, digits and dashes.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;

/** The largest rendition, as a plain URL, for clients that want one image. */
export function largestImageUrl(image) {
  if (!image?.base || !image.sizes?.length) return null;
  return renditionUrl(image.base, `${image.sizes[image.sizes.length - 1]}.jpg`);
}

/** The JPEG rendition that fits `max` pixels wide: the widest no wider, else the smallest. */
export function renditionFor(image, max) {
  if (!image?.base || !image.sizes?.length) return null;
  const fitting = image.sizes.filter((w) => w <= max);
  return renditionUrl(image.base, `${fitting.length ? fitting[fitting.length - 1] : image.sizes[0]}.jpg`);
}

/** A post's additional pictures, each with a plain URL, for the editor. */
const extraImages = (doc) => (doc.images ?? []).map((image) => ({ ...image, url: largestImageUrl(image) }));

/** The picture a post already has with this rendition version, or a 400 telling the client it is gone. */
function keptImage(doc, version) {
  const kept = (doc.images ?? []).find((image) => image.version === version);
  if (!kept) throw new ValidationError("One of the additional photos is no longer on the post.");
  return kept;
}

function details(stored, fields) {
  const out = {};
  for (const field of fields) out[field] = typeof stored?.[field] === "string" ? stored[field] : "";
  return out;
}

/** The API representation of a post open for editing. */
export function editable(doc, siteUrl, { pendingEdit = null } = {}) {
  const pub = publicPost(doc, siteUrl);
  return {
    ...pub,
    image: doc.image ? { ...doc.image, url: largestImageUrl(doc.image) } : null,
    images: extraImages(doc),
    story: doc.body ?? "",
    storyFormat: doc.bodyFormat ?? "text",
    storyHasFormatting: doc.bodyFormat === "markdown",
    bike: doc.feed === "bikes" ? details(doc.details, DETAIL_FIELDS.bikes) : null,
    pizza: doc.feed === "pizza" ? details(doc.details, DETAIL_FIELDS.pizza) : null,
    pendingEdit: pendingEdit ? { id: pendingEdit.id, createdAt: pendingEdit.createdAt?.toISOString?.() ?? null } : null,
  };
}

/** The posts credited to the caller, newest first. */
export async function listMyPosts(user, { posts, siteUrl }) {
  const docs = await posts.listByUid(user.uid);
  return { posts: docs.map((doc) => ({ ...publicPost(doc, siteUrl), image: doc.image ? { ...doc.image, url: largestImageUrl(doc.image) } : null })) };
}

/**
 * The post, once the actor is allowed to edit it: the credited member, or
 * an admin (one whose session passed a second factor; see
 * actorFromClaims). Anyone else gets "not found" rather than a hint that
 * the post exists.
 */
async function load(slug, actor, posts) {
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) throw new ValidationError("Post id is required.");
  const doc = await posts.get(slug);
  if (!doc || doc.status !== "published") throw new AppError("not-found", "That post no longer exists.");
  const owner = doc.credit?.uid && doc.credit.uid === actor.uid;
  if (!owner && !actor.admin) throw new AppError("not-found", "That post no longer exists.");
  return doc;
}

/** With a `store`, also says whether an edit of the post awaits review. */
export async function getPost(slug, actor, { posts, siteUrl, store }) {
  const doc = await load(slug, actor, posts);
  const pendingEdit = store ? await store.pendingEdit(doc.slug) : null;
  return editable(doc, siteUrl, { pendingEdit });
}

function text(value, field, { max, required }) {
  if (typeof value !== "string") throw new ValidationError(`${field} must be text.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new ValidationError(`${field} is required.`);
  if (trimmed.length > max) throw new ValidationError(`${field} must be ${max} characters or fewer.`);
  return trimmed;
}

function choice(value, field, allowed) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || !allowed.includes(value)) throw new ValidationError(`Unknown ${field}.`);
  return value;
}

/** An ISO 8601 instant, as `publishedAt` is stored; refuses anything Date cannot read. */
function instant(value, field) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new ValidationError(`${field} must be a date and time.`);
  return new Date(value).toISOString();
}

/**
 * Checks an edit request. Only the fields present are changed; `bike` and
 * `pizza` replace the post's details as a whole (an empty value clears
 * that detail), and `images` replaces the additional pictures as a whole:
 * the list in its new order, each entry a picture kept (`{keep:
 * <version>}`) or a new upload. `storyFormat` and `publishedAt` may only
 * come from an administrator; the caller enforces that. Returns the
 * validated fields.
 */
export function validateEdit(data, feed) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ValidationError("Nothing to change.");
  const edit = {};
  if ("title" in data) edit.title = text(data.title, "Title", { max: MAX_TITLE, required: true });
  if ("story" in data) edit.story = text(data.story ?? "", "Story", { max: MAX_STORY, required: false });
  if ("storyFormat" in data) {
    if (!BODY_FORMATS.includes(data.storyFormat)) throw new ValidationError("Unknown story format.");
    edit.storyFormat = data.storyFormat;
  }
  if ("image" in data) {
    const { bytes, contentType } = parseUpload(data.image);
    edit.image = { bytes, contentType };
  }
  if ("images" in data) edit.images = parseExtras(data.images ?? [], { keep: true });
  if ("publishedAt" in data) edit.publishedAt = instant(data.publishedAt, "Publish date");
  if ("bike" in data) {
    if (feed !== "bikes") throw new ValidationError("Only bike posts have bike details.");
    const bike = data.bike ?? {};
    if (typeof bike !== "object" || Array.isArray(bike)) throw new ValidationError("Bike details must be an object.");
    edit.bike = {
      brand: text(bike.brand ?? "", "Brand", { max: MAX_BRAND, required: false }),
      year: choice(bike.year, "year", BIKE_YEARS_VALUES),
      color: choice(bike.color, "color", BIKE_COLORS_VALUES),
      type: choice(bike.type, "bike type", BIKE_TYPES_VALUES),
    };
  }
  if ("pizza" in data) {
    if (feed !== "pizza") throw new ValidationError("Only pizza posts have pizza details.");
    const pizza = data.pizza ?? {};
    if (typeof pizza !== "object" || Array.isArray(pizza)) throw new ValidationError("Pizza details must be an object.");
    edit.pizza = { style: choice(pizza.style, "pizza style", PIZZA_STYLES_VALUES) };
  }
  if (Object.keys(edit).length === 0) throw new ValidationError("Nothing to change.");
  return edit;
}

/**
 * The Firestore patch that applies a validated edit to `doc`. A story
 * without an explicit format is plain text (what members write); the
 * title alone leaves the body untouched.
 */
export function patchFor(edit, doc, { image, images } = {}) {
  const patch = bodyPatch({
    title: edit.title,
    body: edit.story,
    bodyFormat: edit.story === undefined ? undefined : (edit.storyFormat ?? "text"),
  });
  if (image) patch.image = image;
  if (images) patch.images = images;
  if (edit.publishedAt !== undefined) patch.publishedAt = edit.publishedAt;
  const feedDetails = doc.feed === "bikes" ? edit.bike : doc.feed === "pizza" ? edit.pizza : undefined;
  if (feedDetails !== undefined) patch.details = detailsFor(doc.feed, feedDetails);
  return patch;
}

/**
 * Makes the renditions of a photo, stores them and returns the document's
 * `image` field. Used on publish, on edit and by the migration.
 */
export async function publishImage(posts, slug, bytes, { focus } = {}) {
  const renditions = await makeRenditions(bytes, { focus });
  for (const file of renditions.files) await posts.putRendition(slug, renditions.version, file);
  return imageField(renditions, posts.renditionBase(slug, renditions.version));
}

/**
 * Writes an edit to the post: new renditions if there is a new main photo
 * (`imageBytes`) and for each new additional picture (`extras`: the new
 * list, each entry `{keep: <version>}` or `{bytes}`), then the patch. Used
 * directly for administrators and on approval for members' edits. Returns
 * the post as it now reads.
 */
export async function applyEdit(posts, doc, edit, { imageBytes, extras, now = new Date() } = {}) {
  let image;
  if (imageBytes) image = await publishImage(posts, doc.slug, imageBytes, { focus: doc.image?.focus });
  let images;
  if (extras) {
    images = [];
    for (const extra of extras) images.push(extra.keep ? keptImage(doc, extra.keep) : await publishImage(posts, doc.slug, extra.bytes));
  }
  // `changedAt` is what the app's unread counters watch.
  await posts.patch(doc.slug, { ...patchFor(edit, doc, { image, images }), changedAt: now.toISOString() });
  return posts.get(doc.slug);
}

/**
 * Handles an edit request. An administrator's edit is applied at once and
 * answers `{status: "applied", post}`. A member's is checked (new photos
 * go through the same pipeline and Vision checks as a submission),
 * stored as a pending submission of kind `edit` and announced to the
 * reviewer, answering `{status: "pending", submissionId, notified}`; the
 * post itself does not change until a reviewer applies it. One pending
 * edit per post at a time.
 */
export async function updatePost(slug, data, actor, deps) {
  const { posts, store, members, processImage, safeSearch, notify, siteUrl, log = () => {} } = deps;
  const doc = await load(slug, actor, posts);
  const edit = validateEdit(data, doc.feed);

  if (actor.admin) {
    let imageBytes;
    if (edit.image) imageBytes = (await processImage(edit.image.bytes)).full.bytes;
    let extras;
    if (edit.images) {
      extras = [];
      for (const extra of edit.images) extras.push(extra.keep ? extra : { bytes: (await processImage(extra.bytes)).full.bytes });
    }
    const updated = await applyEdit(posts, doc, edit, { imageBytes, extras });
    log("post edited", { slug: doc.slug, by: actor.uid, fields: Object.keys(edit) });
    return { status: "applied", post: editable(updated, siteUrl) };
  }
  if (edit.storyFormat) throw new ValidationError("Only administrators can set the story format.");
  if (edit.publishedAt) throw new ValidationError("Only administrators can change the publish date.");

  const pending = await store.pendingEdit(doc.slug);
  if (pending) throw new AppError("failed-precondition", "An edit of this post is already waiting for review.");

  // Every new photo is inspected before any is stored, so a refused one
  // leaves nothing behind.
  const pipeline = { processImage, safeSearch };
  const main = edit.image ? await preparePhoto(edit.image.bytes, pipeline) : null;
  const prepared = [];
  for (const [i, extra] of (edit.images ?? []).entries()) {
    prepared.push(extra.keep ? keptImage(doc, extra.keep) : await preparePhoto(extra.bytes, pipeline, extraLabel(i)));
  }
  const submissionId = store.newId();
  const ids = { id: submissionId, uid: actor.uid };
  const image = main ? await storePhoto(store, main, ids) : null;
  let images = null;
  if (edit.images) {
    images = [];
    for (const [i, entry] of prepared.entries()) {
      images.push(
        entry.version
          ? { keep: entry.version, width: entry.width, height: entry.height, photoUrl: renditionFor(entry, 1200), thumbUrl: renditionFor(entry, 400) }
          : await storeExtra(store, entry, { ...ids, index: i + 1 }),
      );
    }
  }

  let from = doc.credit?.username || doc.credit?.name || "";
  if (members) {
    try {
      from = (await members.get(actor.uid))?.username || from;
    } catch {
      // The credit on the post is good enough.
    }
  }
  const changes = {};
  for (const key of ["title", "story", "bike", "pizza"]) if (edit[key] !== undefined) changes[key] = edit[key];
  changes.image = Boolean(edit.image);
  changes.images = Boolean(edit.images);
  const record = {
    kind: "edit",
    post: {
      id: doc.slug,
      slug: doc.slug,
      title: doc.title ?? "",
      feed: doc.feed,
      url: publicPost(doc, siteUrl).url,
      imageUrl: renditionFor(doc.image, 800),
    },
    feed: doc.feed,
    title: edit.title ?? doc.title ?? "",
    from: from || "a member",
    description: edit.story ?? doc.body ?? "",
    changes,
    uid: actor.uid,
    email: actor.email,
    status: "pending",
    image,
    images: images ?? [],
    review: null,
  };
  await store.create(submissionId, record);
  log("post edit submitted", { id: submissionId, post: doc.slug, by: actor.uid, fields: Object.keys(changes).filter((k) => changes[k] !== false) });
  const notified = notify ? await notify({ ...record, id: submissionId }, { uid: actor.uid, email: actor.email }) : false;
  return { status: "pending", submissionId, notified };
}

/**
 * Applies a reviewed edit submission to its post (called by
 * submissions.js when a reviewer approves one). Returns `{postId, postUrl,
 * postStatus}` like publishing a submission does.
 */
export async function applyEditSubmission(data, { store, posts, siteUrl }) {
  const doc = await posts.get(data.post?.slug ?? data.post?.id);
  if (!doc) throw new AppError("not-found", "The post this edit is for no longer exists.");
  const { image: _image, images: withImages, ...edit } = data.changes ?? {};
  const imageBytes = data.image?.path ? await store.readImage(data.image.path) : undefined;
  let extras;
  if (withImages) {
    extras = [];
    for (const extra of data.images ?? []) extras.push(extra.keep ? { keep: extra.keep } : { bytes: await store.readImage(extra.path) });
  }
  const updated = await applyEdit(posts, doc, edit, { imageBytes, extras });
  return { postId: updated.slug, postUrl: publicPost(updated, siteUrl).url, postStatus: "published" };
}

/** The feeds an administrator writes posts in from the admin page. */
export const WRITABLE_FEEDS = ARTICLE_FEEDS;

/**
 * Checks a request to write a post: a news article with a title, a
 * Markdown story (may be empty), an optional main photo and an optional
 * publish date (default: now). Returns the validated fields.
 */
export function validateNewPost(data, { now = new Date() } = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ValidationError("Nothing to post.");
  const feed = data.feed ?? WRITABLE_FEEDS[0];
  if (!WRITABLE_FEEDS.includes(feed)) throw new ValidationError("Only news posts can be written here.");
  const post = {
    feed,
    title: text(data.title, "Title", { max: MAX_TITLE, required: true }),
    story: text(data.story ?? "", "Story", { max: MAX_STORY, required: false }),
    storyFormat: data.storyFormat ?? "markdown",
    publishedAt: data.publishedAt === undefined || data.publishedAt === null || data.publishedAt === "" ? now.toISOString() : instant(data.publishedAt, "Publish date"),
  };
  if (!BODY_FORMATS.includes(post.storyFormat)) throw new ValidationError("Unknown story format.");
  if (data.image !== undefined && data.image !== null) {
    const { bytes, contentType } = parseUpload(data.image);
    post.image = { bytes, contentType };
  }
  return post;
}

/**
 * Writes a post for an administrator (the admin page's news editor) and
 * answers `{status: "applied", post}` like an edit does. The slug comes
 * from the title plus a random suffix, so two posts may share a title.
 */
export async function createPost(data, actor, { posts, processImage, siteUrl, now = new Date(), log = () => {} }) {
  if (!actor.admin) throw new AppError("permission-denied", "Only administrators can write posts.");
  const post = validateNewPost(data, { now });
  const slug = slugFor(post.title, post.feed, randomUUID());
  let image = null;
  if (post.image) image = await publishImage(posts, slug, (await processImage(post.image.bytes)).full.bytes);
  const doc = postDocument({
    slug,
    feed: post.feed,
    title: post.title,
    publishedAt: post.publishedAt,
    body: post.story,
    bodyFormat: post.storyFormat,
    image,
    credit: null,
    source: { system: "admin", id: actor.uid },
  });
  await posts.create(slug, doc);
  log("post written", { slug, feed: post.feed, by: actor.uid });
  return { status: "applied", post: editable(await posts.get(slug), siteUrl) };
}

/** A feed's published posts as the admin page lists them, newest first. */
export async function listPosts(query, actor, { posts, siteUrl }) {
  if (!actor.admin) throw new AppError("permission-denied", "Only administrators can list posts.");
  const feed = query?.feed ?? WRITABLE_FEEDS[0];
  if (!WRITABLE_FEEDS.includes(feed)) throw new ValidationError("Only news posts are listed here.");
  const docs = await posts.listByFeed(feed);
  return { feed, posts: docs.map((doc) => ({ ...publicPost(doc, siteUrl), image: doc.image ? { ...doc.image, url: largestImageUrl(doc.image) } : null })) };
}

/**
 * Takes a post off the site for an administrator: its status becomes
 * `removed`, so the website drops it at the next build and the app no
 * longer lists it; the document and its renditions stay.
 */
export async function removePost(slug, actor, { posts, now = new Date(), log = () => {} }) {
  if (!actor.admin) throw new AppError("permission-denied", "Only administrators can remove posts.");
  const doc = await load(slug, actor, posts);
  await posts.patch(doc.slug, { status: "removed", changedAt: now.toISOString() });
  log("post removed", { slug: doc.slug, by: actor.uid });
  return { removed: doc.slug };
}
