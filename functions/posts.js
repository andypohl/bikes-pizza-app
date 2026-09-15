// Editing published posts from the app. The member a post is credited to
// (`credit.uid`) may ask for changes to its title, photo, story and
// structured details; the request is stored as a submission of kind `edit`
// for review, like a new post, and applied when a reviewer approves it
// (submissions.js). An administrator who signed in with their second
// factor edits any post directly. Pure: the post store, the submission
// store, the image pipeline and the Vision check are injected.
//
// Members write their story as plain text (`bodyFormat: "text"`); a story
// an administrator wrote in Markdown is reported as formatted, and a member
// who saves a new story over it turns it back into plain text.

import { ValidationError } from "./account.js";
import { BIKE_COLORS_VALUES, BIKE_TYPES_VALUES, BIKE_YEARS_VALUES, IMAGE_MAX_UPLOAD_BYTES, IMAGE_TYPES, PIZZA_STYLES_VALUES } from "./contract.js";
import { AppError } from "./errors.js";
import { BODY_FORMATS } from "./markdown.js";
import { DETAIL_FIELDS, bodyPatch, detailsFor, imageField, publicPost } from "./post.js";
import { renditionUrl } from "./post_store.js";
import { makeRenditions } from "./renditions.js";

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

/**
 * Checks an edit request. Only the fields present are changed; `bike` and
 * `pizza` replace the post's details as a whole (an empty value clears
 * that detail). `storyFormat` may only come from an administrator; the
 * caller enforces that. Returns the validated fields.
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
    const image = data.image;
    if (!image || typeof image !== "object") throw new ValidationError("Photo data is missing.");
    const extension = IMAGE_TYPES[image.contentType];
    if (!extension) throw new ValidationError("Photo must be a JPEG, PNG or WebP image.");
    if (typeof image.data !== "string" || !image.data) throw new ValidationError("Photo data is missing.");
    const bytes = Buffer.from(image.data, "base64");
    if (bytes.length === 0) throw new ValidationError("Photo data is missing.");
    if (bytes.length > IMAGE_MAX_UPLOAD_BYTES) throw new ValidationError("Photo is too large (8 MB max).");
    edit.image = { bytes, contentType: image.contentType };
  }
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
export function patchFor(edit, doc, { image } = {}) {
  const patch = bodyPatch({
    title: edit.title,
    body: edit.story,
    bodyFormat: edit.story === undefined ? undefined : (edit.storyFormat ?? "text"),
  });
  if (image) patch.image = image;
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
 * Writes an edit to the post: new renditions if there is a new photo
 * (`imageBytes`), then the patch. Used directly for administrators and on
 * approval for members' edits. Returns the post as it now reads.
 */
export async function applyEdit(posts, doc, edit, { imageBytes } = {}) {
  let image;
  if (imageBytes) image = await publishImage(posts, doc.slug, imageBytes, { focus: doc.image?.focus });
  await posts.patch(doc.slug, patchFor(edit, doc, { image }));
  return posts.get(doc.slug);
}

/**
 * Handles an edit request. An administrator's edit is applied at once and
 * answers `{status: "applied", post}`. A member's is checked (a new photo
 * goes through the same pipeline and Vision checks as a submission),
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
    const updated = await applyEdit(posts, doc, edit, { imageBytes });
    log("post edited", { slug: doc.slug, by: actor.uid, fields: Object.keys(edit) });
    return { status: "applied", post: editable(updated, siteUrl) };
  }
  if (edit.storyFormat) throw new ValidationError("Only administrators can set the story format.");

  const pending = await store.pendingEdit(doc.slug);
  if (pending) throw new AppError("failed-precondition", "An edit of this post is already waiting for review.");

  let image = null;
  const submissionId = store.newId();
  if (edit.image) {
    const { full, thumb } = await processImage(edit.image.bytes);
    await safeSearch(full.bytes);
    const token = store.newToken();
    image = {
      path: `submissions/${submissionId}/photo.jpg`,
      thumbPath: `submissions/${submissionId}/thumb.jpg`,
      contentType: "image/jpeg",
      width: full.width,
      height: full.height,
      token,
    };
    const options = {
      contentType: "image/jpeg",
      metadata: { submissionId, uid: actor.uid, firebaseStorageDownloadTokens: token },
    };
    await Promise.all([store.putImage(image.path, full.bytes, options), store.putImage(image.thumbPath, thumb.bytes, options)]);
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
  const record = {
    kind: "edit",
    post: {
      id: doc.slug,
      slug: doc.slug,
      title: doc.title ?? "",
      feed: doc.feed,
      url: publicPost(doc, siteUrl).url,
      imageUrl: doc.image ? renditionUrl(doc.image.base, "800.jpg") : null,
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
  const { image: _image, ...edit } = data.changes ?? {};
  const imageBytes = data.image?.path ? await store.readImage(data.image.path) : undefined;
  const updated = await applyEdit(posts, doc, edit, { imageBytes });
  return { postId: updated.slug, postUrl: publicPost(updated, siteUrl).url, postStatus: "published" };
}
