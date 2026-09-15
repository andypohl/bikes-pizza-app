// Editing published posts from the app. The member a post is credited to
// (its `author` reference, see authors.js) may ask for changes to its
// title, photo, story and structured details; the request is stored as a
// submission of kind `edit` for review, like a new post, and applied when
// a reviewer approves it (submissions.js). An administrator who signed in
// with their second factor edits any post directly. Pure: Sanity, the
// submission store, the image pipeline and the Vision check are injected.
//
// A post's story is Portable Text. The app edits it as plain paragraphs,
// so a story written in the Studio with headings, lists or links is
// reported as formatted and, if a new story is saved, replaced by plain
// paragraphs.

import { ValidationError } from "./account.js";
import { AppError } from "./errors.js";
import { postUrl, textToBlocks } from "./post.js";
import { BIKE_COLORS, BIKE_TYPES, BIKE_YEARS, PIZZA_STYLES } from "./post_options.js";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "./submission.js";

const MAX_TITLE = 255;
const MAX_STORY = 10_000;
const MAX_BRAND = 100;

/** What a post looks like to its editor: enough to fill the edit form. */
const PROJECTION = `{
  _id, title, feed, publishedAt, "slug": slug.current, submittedBy,
  "authorUid": author->uid,
  "image": mainImage.asset->{ url, "width": metadata.dimensions.width, "height": metadata.dimensions.height },
  body, bike, pizza
}`;

const MINE_QUERY = `*[_type == "post" && !(_id in path("drafts.**")) && defined(author) && author->uid == $uid]
  | order(publishedAt desc) ${PROJECTION}`;
export const ONE_QUERY = `*[_type == "post" && _id == $id][0] ${PROJECTION}`;

// Sanity document ids: letters, digits, dots, dashes and underscores.
const ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** The plain text of a Portable Text body: one paragraph per block. */
export function blocksToText(body) {
  if (!Array.isArray(body)) return "";
  return body
    .filter((block) => block?._type === "block")
    .map((block) => (block.children ?? []).map((span) => span?.text ?? "").join(""))
    .join("\n\n")
    .trim();
}

/**
 * Whether a body is only plain paragraphs, which the app's editor can
 * round-trip. Anything else (headings, lists, links, decorators, images)
 * would be lost by saving the text back.
 */
export function isPlainText(body) {
  if (!Array.isArray(body)) return true;
  return body.every(
    (block) =>
      block?._type === "block" &&
      (block.style ?? "normal") === "normal" &&
      !block.listItem &&
      !(block.markDefs ?? []).length &&
      (block.children ?? []).every((span) => span?._type === "span" && !(span.marks ?? []).length),
  );
}

function summary(row, siteUrl) {
  return {
    id: row._id,
    title: row.title ?? "",
    feed: row.feed ?? "",
    slug: row.slug ?? "",
    url: row.slug ? postUrl(siteUrl, row.feed, row.slug) : null,
    publishedAt: row.publishedAt ?? null,
    image: row.image?.url ? { url: row.image.url, width: row.image.width ?? null, height: row.image.height ?? null } : null,
  };
}

/** The API representation of a post open for editing. */
export function editable(row, siteUrl, { pendingEdit = null } = {}) {
  return {
    ...summary(row, siteUrl),
    story: blocksToText(row.body),
    storyHasFormatting: !isPlainText(row.body),
    bike: row.feed === "bikes" ? details(row.bike, ["brand", "year", "color", "type"]) : null,
    pizza: row.feed === "pizza" ? details(row.pizza, ["style"]) : null,
    pendingEdit: pendingEdit ? { id: pendingEdit.id, createdAt: pendingEdit.createdAt?.toISOString?.() ?? null } : null,
  };
}

function details(stored, fields) {
  const out = {};
  for (const field of fields) out[field] = typeof stored?.[field] === "string" ? stored[field] : "";
  return out;
}

/** The posts credited to the caller, newest first. */
export async function listMyPosts(user, { sanity, siteUrl }) {
  const rows = (await sanity.query(MINE_QUERY, { uid: user.uid })) ?? [];
  return { posts: rows.map((row) => summary(row, siteUrl)) };
}

/**
 * The post, once the actor is allowed to edit it: the credited member, or
 * an admin (one whose session passed a second factor; see
 * actorFromClaims). Anyone else gets "not found" rather than a hint that
 * the post exists.
 */
async function load(id, actor, sanity) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new ValidationError("Post id is required.");
  const row = await sanity.query(ONE_QUERY, { id });
  if (!row) throw new AppError("not-found", "That post no longer exists.");
  const owner = row.authorUid && row.authorUid === actor.uid;
  if (!owner && !actor.admin) throw new AppError("not-found", "That post no longer exists.");
  return row;
}

/** With a `store`, also says whether an edit of the post awaits review. */
export async function getPost(id, actor, { sanity, siteUrl, store }) {
  const row = await load(id, actor, sanity);
  const pendingEdit = store ? await store.pendingEdit(row._id) : null;
  return editable(row, siteUrl, { pendingEdit });
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
 * that detail). Returns the validated fields.
 */
export function validateEdit(data, feed) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ValidationError("Nothing to change.");
  const edit = {};
  if ("title" in data) edit.title = text(data.title, "Title", { max: MAX_TITLE, required: true });
  if ("story" in data) edit.story = text(data.story ?? "", "Story", { max: MAX_STORY, required: false });
  if ("image" in data) {
    const image = data.image;
    if (!image || typeof image !== "object") throw new ValidationError("Photo data is missing.");
    const extension = IMAGE_TYPES[image.contentType];
    if (!extension) throw new ValidationError("Photo must be a JPEG, PNG or WebP image.");
    if (typeof image.data !== "string" || !image.data) throw new ValidationError("Photo data is missing.");
    const bytes = Buffer.from(image.data, "base64");
    if (bytes.length === 0) throw new ValidationError("Photo data is missing.");
    if (bytes.length > MAX_IMAGE_BYTES) throw new ValidationError("Photo is too large (8 MB max).");
    edit.image = { bytes, contentType: image.contentType };
  }
  if ("bike" in data) {
    if (feed !== "bikes") throw new ValidationError("Only bike posts have bike details.");
    const bike = data.bike ?? {};
    if (typeof bike !== "object" || Array.isArray(bike)) throw new ValidationError("Bike details must be an object.");
    edit.bike = {
      brand: text(bike.brand ?? "", "Brand", { max: MAX_BRAND, required: false }),
      year: choice(bike.year, "year", BIKE_YEARS),
      color: choice(bike.color, "color", BIKE_COLORS),
      type: choice(bike.type, "bike type", BIKE_TYPES),
    };
  }
  if ("pizza" in data) {
    if (feed !== "pizza") throw new ValidationError("Only pizza posts have pizza details.");
    const pizza = data.pizza ?? {};
    if (typeof pizza !== "object" || Array.isArray(pizza)) throw new ValidationError("Pizza details must be an object.");
    edit.pizza = { style: choice(pizza.style, "pizza style", PIZZA_STYLES) };
  }
  if (Object.keys(edit).length === 0) throw new ValidationError("Nothing to change.");
  return edit;
}

/** `set` and `unset` for the patch that applies a validated edit. */
export function patchFor(edit, { title, imageAssetId }) {
  const set = {};
  const unset = [];
  if (edit.title !== undefined) set.title = edit.title;
  if (edit.story !== undefined) set.body = textToBlocks(edit.story);
  if (imageAssetId) {
    set.mainImage = {
      _type: "image",
      asset: { _type: "reference", _ref: imageAssetId },
      alt: edit.title ?? title ?? "",
    };
  }
  for (const key of ["bike", "pizza"]) {
    if (edit[key] === undefined) continue;
    const kept = Object.fromEntries(Object.entries(edit[key]).filter(([, value]) => value));
    if (Object.keys(kept).length) set[key] = kept;
    else unset.push(key);
  }
  return { set, unset };
}

/**
 * Writes an edit to the post: uploads the new photo, if there is one
 * (`imageBytes`, already normalised to JPEG), then patches the document.
 * Used directly for administrators and on approval for members' edits.
 * Returns the post as it now reads.
 */
export async function applyEdit(sanity, row, edit, { imageBytes } = {}) {
  let imageAssetId;
  if (imageBytes) {
    imageAssetId = await sanity.uploadImage({ bytes: imageBytes, contentType: "image/jpeg", filename: `${row.feed}-photo.jpg` });
  }
  const { set, unset } = patchFor(edit, { title: row.title, imageAssetId });
  await sanity.patchDocument(row._id, set, { unset });
  return sanity.query(ONE_QUERY, { id: row._id });
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
export async function updatePost(id, data, actor, deps) {
  const { sanity, store, members, processImage, safeSearch, notify, siteUrl, log = () => {} } = deps;
  const row = await load(id, actor, sanity);
  const edit = validateEdit(data, row.feed);

  if (actor.admin) {
    let imageBytes;
    if (edit.image) imageBytes = (await processImage(edit.image.bytes)).full.bytes;
    const updated = await applyEdit(sanity, row, edit, { imageBytes });
    log("post edited", { id: row._id, by: actor.uid, fields: Object.keys(edit) });
    return { status: "applied", post: editable(updated, siteUrl) };
  }

  const pending = await store.pendingEdit(row._id);
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

  let from = row.submittedBy ?? "";
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
    post: { id: row._id, slug: row.slug ?? "", title: row.title ?? "", feed: row.feed, url: summary(row, siteUrl).url, imageUrl: row.image?.url ?? null },
    feed: row.feed,
    title: edit.title ?? row.title ?? "",
    from: from || "a member",
    description: edit.story ?? blocksToText(row.body),
    changes,
    uid: actor.uid,
    email: actor.email,
    status: "pending",
    image,
    review: null,
  };
  await store.create(submissionId, record);
  log("post edit submitted", { id: submissionId, post: row._id, by: actor.uid, fields: Object.keys(changes).filter((k) => changes[k] !== false) });
  const notified = notify ? await notify({ ...record, id: submissionId }, { uid: actor.uid, email: actor.email }) : false;
  return { status: "pending", submissionId, notified };
}

/**
 * Applies a reviewed edit submission to its post (called by
 * submissions.js when a reviewer approves one). Returns `{postId, postUrl,
 * postStatus}` like publishing a submission does.
 */
export async function applyEditSubmission(data, { store, sanity, siteUrl }) {
  const row = await sanity.query(ONE_QUERY, { id: data.post?.id });
  if (!row) throw new AppError("not-found", "The post this edit is for no longer exists.");
  const { image: _image, ...edit } = data.changes ?? {};
  const imageBytes = data.image?.path ? await store.readImage(data.image.path) : undefined;
  const updated = await applyEdit(sanity, row, edit, { imageBytes });
  return { postId: updated._id, postUrl: summary(updated, siteUrl).url, postStatus: "published" };
}
