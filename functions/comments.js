// Comments on bike and pizza posts (docs/community-design.md): top-level
// comments with one level of replies, likes, reports, screening before
// anything is shown, and the admin's review queues. Comments live under
// the post (comment_store.js) and are read and written only through here,
// so the sign-in rule, the viewer's own likes and what is hidden from
// whom are applied in one place for the app and the website alike.
//
// Statuses: `published` is visible to members; `pending` was held by the
// screening and is visible only to its author (marked) and admins;
// `hidden` was taken down by reports until an admin decides; `removed`
// keeps a top-level comment's place so its replies still read, with the
// text cleared. The post carries `commentCount` (published comments),
// `commentedAt` and `commentTimes` (the newest published comment times,
// for the app's "N new" counts); none of them touch `changedAt`.
//
// Pure: the stores and the screening call are injected (see index.js).

import { COMMENTS as RULES, GALLERY_FEEDS } from "./contract.js";
import { commentToText, renderComment } from "./comment_text.js";
import { AppError, ValidationError } from "./errors.js";
import { BLOCKED_MESSAGE, normalizeWords, screenText } from "./moderate.js";
import { publicPost } from "./post.js";

export { RULES };

const SLUG_PATTERN = /^[a-z0-9-]{1,120}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T/;

export const QUEUES = ["pending", "reported", "recent"];
export const ADMIN_ACTIONS = ["approve", "remove"];
export const REASONS = RULES.reportReasons.map((r) => r.value);

/** Longest word on a moderation list, and how many entries a list may hold. */
export const WORD_MAX_LENGTH = 40;
export const WORDS_MAX = 500;

// ---- pure helpers -------------------------------------------------------------

/** The post's comment fields as they follow from its comments. */
export function postCounts(comments) {
  const times = comments
    .filter((c) => c.status === "published")
    .map((c) => c.createdAt)
    .sort()
    .reverse();
  return { commentCount: times.length, commentedAt: times[0] ?? null, commentTimes: times.slice(0, RULES.timesKept) };
}

/** Whether a comment written at `createdAt` may still be edited at `now`. */
export function withinEditWindow(createdAt, now = new Date()) {
  return now.getTime() - Date.parse(createdAt) < RULES.editWindowMinutes * 60 * 1000;
}

/** The published replies of each top-level comment, by its id. */
function replyCounts(comments) {
  const counts = {};
  for (const c of comments) if (c.parentId && c.status === "published") counts[c.parentId] = (counts[c.parentId] ?? 0) + 1;
  return counts;
}

/**
 * A comment as the API hands it out to `viewer` (null when signed out or
 * an admin queue; `admin` adds what the reviewer needs). Removed comments
 * keep only their place; the text as written is included for the author,
 * so they can edit it.
 */
export function publicComment(doc, { viewer = null, admin = false } = {}) {
  const likedBy = Array.isArray(doc.likedBy) ? doc.likedBy : [];
  const mine = Boolean(viewer && doc.uid === viewer.uid);
  const base = {
    id: doc.id,
    parentId: doc.parentId ?? null,
    createdAt: doc.createdAt,
    editedAt: doc.editedAt ?? null,
    status: doc.status,
    likeCount: likedBy.length,
    liked: Boolean(viewer && likedBy.includes(viewer.uid)),
    replyCount: doc.replyCount ?? 0,
    mine,
  };
  if (doc.status === "removed") return { ...base, username: null, uid: null, html: "", removed: true };
  return {
    ...base,
    username: doc.username ?? "",
    uid: doc.uid,
    html: doc.html ?? "",
    removed: false,
    ...(mine || admin ? { text: doc.text ?? "" } : {}),
    ...(doc.status !== "published" ? { hold: doc.hold ?? null } : {}),
    ...(admin ? { screening: doc.screening ?? null, reportCount: doc.reportCount ?? 0, mentions: doc.mentions ?? [] } : {}),
  };
}

/** Whether `viewer` may see the comment at all in a thread. */
function visibleTo(doc, viewer) {
  if (doc.status === "published") return true;
  if (doc.status === "pending") return Boolean(viewer && doc.uid === viewer.uid);
  return false;
}

/**
 * The thread as a member sees it: `{comments, next}`, top-level comments
 * oldest first from `after` (the id of the last one seen), each with its
 * visible replies (`replies`, the first `repliesShown`, and `replyCount`
 * of those visible). A removed comment is shown only while it has replies
 * to show.
 */
export function threadPage(all, { viewer, after = null, pageSize = RULES.pageSize, repliesShown = RULES.repliesShown } = {}) {
  const repliesOf = new Map();
  for (const c of all) {
    if (!c.parentId || !visibleTo(c, viewer)) continue;
    if (!repliesOf.has(c.parentId)) repliesOf.set(c.parentId, []);
    repliesOf.get(c.parentId).push(c);
  }
  const top = all.filter((c) => !c.parentId && (visibleTo(c, viewer) || (c.status === "removed" && repliesOf.get(c.id)?.length)));
  let start = 0;
  if (after) {
    const at = top.findIndex((c) => c.id === after);
    if (at < 0) throw new AppError("not-found", "That comment is gone.");
    start = at + 1;
  }
  const page = top.slice(start, start + pageSize);
  const comments = page.map((c) => {
    const replies = repliesOf.get(c.id) ?? [];
    return {
      ...publicComment(c, { viewer }),
      replyCount: replies.length,
      replies: replies.slice(0, repliesShown).map((r) => publicComment(r, { viewer })),
    };
  });
  return { comments, next: start + pageSize < top.length ? page[page.length - 1].id : null };
}

/** The comment's own document and, for a reply, the top-level one; throws when either is gone. */
function findComment(comments, id) {
  const doc = comments.find((c) => c.id === id);
  if (!doc) throw new AppError("not-found", "That comment is gone.");
  return doc;
}

/**
 * The writes that take a comment out of the thread. A reply is deleted
 * outright; a top-level comment with published replies becomes
 * `removed` (its place kept, text cleared), and without them is deleted
 * along with any pending replies of its own.
 */
export function removal(comments, doc, by) {
  const writes = {};
  if (doc.parentId) {
    writes[doc.id] = null;
  } else {
    const replies = comments.filter((c) => c.parentId === doc.id);
    if (replies.some((r) => r.status === "published")) {
      writes[doc.id] = {
        ...doc,
        status: "removed",
        hold: null,
        removedBy: by,
        text: "",
        html: "",
        mentions: [],
        notified: [],
        likedBy: [],
        reportCount: 0,
        screening: null,
      };
    } else {
      writes[doc.id] = null;
      for (const r of replies) writes[r.id] = null;
    }
  }
  return writes;
}

/** `comments` with `writes` applied, for recounting. */
function applyWrites(comments, writes) {
  const next = comments.filter((c) => !(c.id in writes)).concat(Object.values(writes).filter(Boolean));
  return next.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/**
 * Everything the store writes for a set of comment writes: the writes,
 * the top-level comments whose reply counts moved, and the post's counts
 * when they changed.
 */
function settle(post, comments, writes) {
  const after = applyWrites(comments, writes);
  const before = replyCounts(comments);
  const counts = replyCounts(after);
  for (const c of after) {
    if (c.parentId) continue;
    const n = counts[c.id] ?? 0;
    if (n !== (c.replyCount ?? 0) || n !== (before[c.id] ?? 0)) writes[c.id] = { ...(writes[c.id] ?? c), replyCount: n };
  }
  const fields = postCounts(after);
  const changed =
    fields.commentCount !== post.commentCount ||
    fields.commentedAt !== (post.commentedAt ?? null) ||
    JSON.stringify(fields.commentTimes) !== JSON.stringify(post.commentTimes ?? []);
  return { comments: writes, post: changed ? fields : undefined };
}

// ---- checks -------------------------------------------------------------------

function checkSlug(slug) {
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) throw new ValidationError("Post id is required.");
  return slug;
}

function checkId(id) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new ValidationError("Comment id is required.");
  return id;
}

/** The post, once comments are allowed on it: published, in a gallery feed, switched on. */
async function loadPost(slug, { posts, settings }) {
  const doc = await posts.get(checkSlug(slug));
  if (!doc || doc.status !== "published") throw new AppError("not-found", "That post no longer exists.");
  if (!GALLERY_FEEDS.includes(doc.feed)) throw new AppError("failed-precondition", "This post takes no comments.");
  if (settings && (await settings()).comments === false) throw new AppError("failed-precondition", "Comments are off for now.");
  if (doc.commentsEnabled === false) throw new AppError("failed-precondition", "Comments are off for this post.");
  return doc;
}

/** The member's username, which every comment and like carries. */
async function usernameOf(user, members) {
  const username = (await members.get(user.uid))?.username ?? "";
  if (!username) throw new AppError("failed-precondition", "Choose a username in Settings first.");
  return username;
}

/** Throws when the member has commented too recently or too often today; returns the counter to store. */
export function rateCheck(member, now) {
  const rate = member?.commentRate ?? {};
  const day = now.toISOString().slice(0, 10);
  const count = rate.day === day ? rate.count ?? 0 : 0;
  if (rate.lastAt && now.getTime() - Date.parse(rate.lastAt) < RULES.rateLimit.seconds * 1000) {
    throw new AppError("failed-precondition", `Please wait ${RULES.rateLimit.seconds} seconds between comments.`);
  }
  if (count >= RULES.rateLimit.perDay) throw new AppError("failed-precondition", "You've reached today's comment limit.");
  return { commentRate: { day, count: count + 1, lastAt: now.toISOString() } };
}

/** Renders and screens a comment's text; throws when it is blocked. */
async function prepare(text, { members, comments, moderate, log }) {
  const rendered = await renderComment(text, { lookup: (name) => members.uidByUsername(name) });
  const screened = await screenText(commentToText(rendered.html), { moderation: await comments.getModeration(), moderate, log });
  if (screened.verdict === "block") {
    log("comment blocked", { reasons: screened.screening.reasons, matched: screened.screening.matched });
    throw new AppError("invalid-argument", BLOCKED_MESSAGE);
  }
  return { ...rendered, status: screened.verdict === "ok" ? "published" : "pending", hold: screened.hold, screening: screened.screening };
}

/** Writes a mention notice for the members named in a published comment who have not had one yet. */
async function notifyMentions(doc, slug, { comments, now }) {
  const uids = (doc.mentions ?? []).filter((uid) => uid !== doc.uid && !(doc.notified ?? []).includes(uid));
  if (!uids.length) return [];
  await comments.addNotices(uids, { kind: "mention", post: slug, comment: doc.id, at: now().toISOString() });
  return uids;
}

/** The comment with its mentions marked as notified (set inside the transaction that publishes it). */
function markNotified(doc) {
  if (doc.status !== "published") return doc;
  const notified = [...new Set([...(doc.notified ?? []), ...(doc.mentions ?? []).filter((uid) => uid !== doc.uid)])];
  return { ...doc, notified };
}

// ---- members' endpoints --------------------------------------------------------

/**
 * A page of the thread under a post: `{count, comments, next}` (see
 * threadPage); `query.after` is the id of the last top-level comment seen.
 */
export async function listComments(slug, query, user, deps) {
  const post = await loadPost(slug, deps);
  const after = query?.after ? checkId(query.after) : null;
  const all = await deps.comments.all(post.slug);
  return { count: post.commentCount ?? 0, ...threadPage(all, { viewer: user, after }) };
}

/** Every visible reply of one comment, oldest first. */
export async function listReplies(slug, id, user, deps) {
  const post = await loadPost(slug, deps);
  const all = await deps.comments.all(post.slug);
  const parent = findComment(all, checkId(id));
  if (parent.parentId) throw new AppError("not-found", "That comment is gone.");
  const replies = all.filter((c) => c.parentId === parent.id && visibleTo(c, user)).map((c) => publicComment(c, { viewer: user }));
  return { id: parent.id, replies };
}

/**
 * Writes a comment (`data.text`; `data.parentId` for a reply, which goes
 * under that comment's top-level comment). Screened first: refused when
 * blocked, held as `pending` when doubtful, published otherwise, in which
 * case the members it mentions get a notice. Answers `{comment}`.
 */
export async function createComment(slug, data, user, deps) {
  const { comments, members, now = () => new Date(), newId, log = () => {} } = deps;
  const post = await loadPost(slug, deps);
  if (!data || typeof data !== "object") throw new ValidationError("A comment needs some text.");
  const parentId = data.parentId === undefined || data.parentId === null || data.parentId === "" ? null : checkId(data.parentId);
  const username = await usernameOf(user, members);
  const prepared = await prepare(data.text, deps);
  const at = now();
  const id = newId();
  const written = await comments.transact(post.slug, { uid: user.uid }, ({ post: current, comments: all, member }) => {
    const member_ = rateCheck(member, at);
    let top = null;
    if (parentId) {
      const parent = findComment(all, parentId);
      top = parent.parentId ? findComment(all, parent.parentId) : parent;
      if (top.status === "pending" || top.status === "hidden") throw new AppError("not-found", "That comment is gone.");
    }
    const doc = markNotified({
      id,
      uid: user.uid,
      username,
      parentId: top?.id ?? null,
      text: prepared.text,
      html: prepared.html,
      mentions: prepared.mentions,
      notified: [],
      createdAt: at.toISOString(),
      editedAt: null,
      status: prepared.status,
      hold: prepared.hold,
      removedBy: null,
      screening: prepared.screening,
      likedBy: [],
      replyCount: 0,
      reportCount: 0,
    });
    return { ...settle(current, all, { [id]: doc }), member: member_, result: doc };
  });
  if (written.status === "published") await notifyMentions({ ...written, notified: [] }, post.slug, { comments, now });
  log("comment written", { post: post.slug, id, by: user.uid, status: written.status, hold: written.hold });
  return { comment: publicComment(written, { viewer: user }) };
}

/**
 * Replaces the text of the member's own comment within the edit window;
 * screened again, so a doubtful edit puts the comment back in review.
 */
export async function editComment(slug, id, data, user, deps) {
  const { comments, now = () => new Date(), log = () => {} } = deps;
  const post = await loadPost(slug, deps);
  checkId(id);
  const prepared = await prepare(data?.text, deps);
  const at = now();
  const written = await comments.transact(post.slug, { uid: user.uid }, ({ post: current, comments: all }) => {
    const doc = findComment(all, id);
    if (doc.uid !== user.uid) throw new AppError("permission-denied", "You can only edit your own comments.");
    if (doc.status === "removed" || doc.status === "hidden") throw new AppError("failed-precondition", "That comment can't be edited.");
    if (!withinEditWindow(doc.createdAt, at)) {
      throw new AppError("failed-precondition", `Comments can be edited for ${RULES.editWindowMinutes} minutes after posting.`);
    }
    const next = markNotified({
      ...doc,
      text: prepared.text,
      html: prepared.html,
      mentions: prepared.mentions,
      editedAt: at.toISOString(),
      status: prepared.status,
      hold: prepared.hold,
      screening: prepared.screening,
    });
    return { ...settle(current, all, { [id]: next }), result: { next, before: doc } };
  });
  if (written.next.status === "published") await notifyMentions({ ...written.next, notified: written.before.notified ?? [] }, post.slug, { comments, now });
  log("comment edited", { post: post.slug, id, by: user.uid, status: written.next.status });
  return { comment: publicComment(written.next, { viewer: user }) };
}

/**
 * Takes a comment down: its author, the post's author (any comment on
 * their post) or an admin with a second factor. See `removal`.
 */
export async function deleteComment(slug, id, actor, deps) {
  const { comments, log = () => {} } = deps;
  const post = await loadPost(slug, deps);
  checkId(id);
  const by = await comments.transact(post.slug, {}, ({ post: current, comments: all }) => {
    const doc = findComment(all, id);
    const who = doc.uid === actor.uid ? "author" : current.credit?.uid === actor.uid ? "postAuthor" : actor.admin ? "admin" : null;
    if (!who) throw new AppError("permission-denied", "You can't delete this comment.");
    return { ...settle(current, all, removal(all, doc, who)), result: who };
  });
  log("comment removed", { post: post.slug, id, by: actor.uid, as: by });
  return { removed: id, by };
}

/** Likes a published comment, or takes the like back; answers `{liked, likeCount}`. */
export async function toggleLike(slug, id, user, deps) {
  const { comments, members, now = () => new Date() } = deps;
  const post = await loadPost(slug, deps);
  checkId(id);
  const username = await usernameOf(user, members);
  return comments.transact(post.slug, { uid: user.uid, id }, ({ comments: all, like }) => {
    const doc = findComment(all, id);
    if (doc.status !== "published") throw new AppError("not-found", "That comment is gone.");
    const likedBy = (doc.likedBy ?? []).filter((uid) => uid !== user.uid);
    if (like) return { comments: { [id]: { ...doc, likedBy } }, like: null, result: { liked: false, likeCount: likedBy.length } };
    likedBy.push(user.uid);
    return {
      comments: { [id]: { ...doc, likedBy } },
      like: { uid: user.uid, username, at: now().toISOString() },
      result: { liked: true, likeCount: likedBy.length },
    };
  });
}

/** Who liked a comment: `{likes: [{username, at}]}`, oldest first. */
export async function listLikes(slug, id, user, deps) {
  const post = await loadPost(slug, deps);
  const all = await deps.comments.all(post.slug);
  const doc = findComment(all, checkId(id));
  if (doc.status !== "published") throw new AppError("not-found", "That comment is gone.");
  const likes = await deps.comments.likes(post.slug, id);
  return { likes: likes.filter((l) => l.username).map((l) => ({ username: l.username, at: l.at })) };
}

/** The report reason checked against the contract's list. */
export function validateReason(value) {
  if (typeof value !== "string" || !REASONS.includes(value)) throw new ValidationError("Pick a reason for the report.");
  return value;
}

/**
 * Reports a comment with a reason, once per member, never one's own. The
 * `reportsToHide`th distinct reporter hides it until an admin decides.
 * Answers `{reported: true, hidden}`.
 */
export async function reportComment(slug, id, data, user, deps) {
  const { comments, now = () => new Date(), log = () => {} } = deps;
  const post = await loadPost(slug, deps);
  checkId(id);
  const reason = validateReason(data?.reason);
  const result = await comments.transact(post.slug, { uid: user.uid, id }, ({ post: current, comments: all, report }) => {
    const doc = findComment(all, id);
    if (doc.status !== "published" && doc.status !== "hidden") throw new AppError("not-found", "That comment is gone.");
    if (doc.uid === user.uid) throw new AppError("failed-precondition", "You can't report your own comment.");
    if (report) throw new AppError("failed-precondition", "You already reported this comment.");
    const reportCount = (doc.reportCount ?? 0) + 1;
    const hide = doc.status === "published" && reportCount >= RULES.reportsToHide;
    const next = { ...doc, reportCount, ...(hide ? { status: "hidden", hold: "reports" } : {}) };
    return {
      ...settle(current, all, { [id]: next }),
      report: { uid: user.uid, reason, at: now().toISOString() },
      result: { reported: true, hidden: next.status === "hidden" },
    };
  });
  log("comment reported", { post: post.slug, id, by: user.uid, reason, hidden: result.hidden });
  return result;
}

// ---- notices and the member's data -------------------------------------------

/** The member's mention notices after `query.since` (ISO), oldest first: `{notices}`. */
export async function listNotices(user, query, { comments }) {
  const since = query?.since;
  if (since !== undefined && since !== "" && (typeof since !== "string" || !ISO_PATTERN.test(since) || Number.isNaN(Date.parse(since)))) {
    throw new ValidationError("since must be a date and time.");
  }
  const notices = await comments.listNotices(user.uid, since ? new Date(since).toISOString() : null);
  return { notices: notices.map((n) => ({ id: n.id, kind: n.kind, post: n.post, comment: n.comment ?? null, at: n.at })) };
}

/** Everything the member has: their record, posts, comments, likes and reactions, as one JSON document. */
export async function exportMember(user, { posts, comments, members, siteUrl, now = () => new Date() }) {
  const [record, credited, written, likes, reactions] = await Promise.all([
    members.get(user.uid),
    posts.listByUid(user.uid),
    comments.byUid(user.uid),
    comments.likesByUid(user.uid),
    posts.listReactionsByUid(user.uid),
  ]);
  const ordered = (list) => list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return {
    exportedAt: now().toISOString(),
    member: {
      uid: user.uid,
      email: user.email,
      username: record?.username ?? "",
      location: record?.location ?? "",
      messages: record?.messages !== false,
      newsletters: record?.newsletters ?? [],
      joinedAt: record?.joinedAt ?? null,
      createdAt: record?.createdAt?.toDate?.()?.toISOString?.() ?? record?.createdAt ?? null,
    },
    posts: credited.map((doc) => {
      const pub = publicPost(doc, siteUrl);
      return { id: pub.id, feed: pub.feed, title: pub.title, url: pub.url, publishedAt: pub.publishedAt };
    }),
    comments: ordered(written).map((c) => ({
      post: c.slug,
      id: c.id,
      parentId: c.parentId ?? null,
      text: c.text ?? "",
      createdAt: c.createdAt,
      editedAt: c.editedAt ?? null,
      status: c.status,
    })),
    likes: likes.map((l) => ({ post: l.slug, comment: l.id, at: l.at })),
    reactions: reactions.map((r) => ({ post: r.slug, picks: r.picks ?? {}, updatedAt: r.updatedAt?.toDate?.()?.toISOString?.() ?? r.updatedAt ?? null })),
  };
}

/**
 * Removes what a deleted member left on other people's posts: their
 * comments (see `removal`), likes, reports, reactions and notices.
 * Returns what was removed, for the log.
 */
export async function deleteMemberData(uid, { posts, comments, log = () => {} }) {
  const written = await comments.byUid(uid);
  const bySlug = new Map();
  for (const c of written) bySlug.set(c.slug, [...(bySlug.get(c.slug) ?? []), c.id]);
  for (const [slug, ids] of bySlug) {
    await comments.transact(slug, {}, ({ post, comments: all }) => {
      let writes = {};
      let current = all;
      for (const id of ids) {
        const doc = current.find((c) => c.id === id);
        if (!doc) continue;
        writes = { ...writes, ...removal(current, doc, "author") };
        current = applyWrites(current, writes);
      }
      return { ...settle(post, all, writes), result: null };
    });
  }
  const likes = await comments.likesByUid(uid);
  for (const { slug, id } of likes) {
    await comments.transact(slug, { uid, id }, ({ comments: all }) => {
      const doc = all.find((c) => c.id === id);
      if (!doc) return { result: null };
      return { comments: { [id]: { ...doc, likedBy: (doc.likedBy ?? []).filter((u) => u !== uid) } }, like: null, result: null };
    });
  }
  const reports = await comments.reportsByUid(uid);
  for (const { slug, id } of reports) {
    await comments.transact(slug, { uid, id }, ({ comments: all }) => {
      const doc = all.find((c) => c.id === id);
      if (!doc) return { result: null };
      return { comments: { [id]: { ...doc, reportCount: Math.max(0, (doc.reportCount ?? 0) - 1) } }, report: null, result: null };
    });
  }
  const reactions = await posts.removeReactions(uid);
  await comments.deleteNotices(uid);
  const removed = { comments: written.length, likes: likes.length, reports: reports.length, reactions };
  log("member data removed", { uid, ...removed });
  return removed;
}

// ---- admin --------------------------------------------------------------------

/**
 * One of the review queues: `pending` (held by screening), `reported`
 * (reported at least once, most reported first) or `recent` (published,
 * newest first). Each comment carries its post's title and URL and, when
 * reported, the reasons given.
 */
export async function adminQueue(query, admin, { posts, comments, siteUrl }) {
  const name = query?.queue ?? "pending";
  if (!QUEUES.includes(name)) throw new ValidationError("Unknown queue.");
  const list = await comments.queue(name);
  const titles = new Map();
  const out = [];
  for (const doc of list) {
    if (!titles.has(doc.slug)) {
      const post = await posts.get(doc.slug);
      titles.set(doc.slug, post ? { id: post.slug, title: post.title ?? "", feed: post.feed, url: publicPost(post, siteUrl).url } : { id: doc.slug, title: "", feed: null, url: null });
    }
    const reports = doc.reportCount > 0 ? (await comments.reports(doc.slug, doc.id)).map((r) => r.reason) : [];
    out.push({ ...publicComment(doc, { admin: true }), post: titles.get(doc.slug), reports });
  }
  return { queue: name, comments: out };
}

/**
 * Approve (publish a pending or hidden comment, clearing its reports) or
 * remove (as an admin) one comment. Answers the comment as the admin sees it.
 */
export async function adminAct(slug, id, action, admin, deps) {
  const { comments, now = () => new Date(), log = () => {} } = deps;
  checkSlug(slug);
  checkId(id);
  if (!ADMIN_ACTIONS.includes(action)) throw new ValidationError("Unknown action.");
  const result = await comments.transact(slug, { id }, ({ post, comments: all }) => {
    const doc = findComment(all, id);
    if (action === "remove") {
      if (doc.status === "removed") throw new AppError("failed-precondition", "Already removed.");
      const writes = removal(all, doc, "admin");
      return { ...settle(post, all, writes), result: { doc: writes[id] ?? { ...doc, status: "removed", html: "", text: "" }, before: doc } };
    }
    if (doc.status !== "pending" && doc.status !== "hidden") throw new AppError("failed-precondition", "That comment is not waiting for review.");
    const next = markNotified({ ...doc, status: "published", hold: null, reportCount: 0 });
    return { ...settle(post, all, { [id]: next }), clearReports: true, result: { doc: next, before: doc } };
  });
  if (action === "approve") await notifyMentions({ ...result.doc, notified: result.before.notified ?? [] }, slug, { comments, now });
  log("comment reviewed", { post: slug, id, by: admin.uid, action });
  return { comment: publicComment(result.doc, { admin: true }) };
}

/** The moderation word lists. */
export async function getModeration(deps) {
  return deps.comments.getModeration();
}

/** Replaces the word lists: `{banned, suspicious}`, each a list of words or phrases. */
export async function setModeration(data, admin, { comments, log = () => {} }) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ValidationError("Send the banned and suspicious lists.");
  const lists = {};
  for (const key of ["banned", "suspicious"]) {
    if (!Array.isArray(data[key])) throw new ValidationError(`${key} must be a list of words.`);
    if (data[key].some((w) => typeof w !== "string")) throw new ValidationError(`${key} must be a list of words.`);
    const words = normalizeWords(data[key]);
    if (words.some((w) => w.length > WORD_MAX_LENGTH)) throw new ValidationError(`Each ${key} entry must be ${WORD_MAX_LENGTH} characters or fewer.`);
    if (words.length > WORDS_MAX) throw new ValidationError(`The ${key} list can hold ${WORDS_MAX} entries at most.`);
    lists[key] = words;
  }
  await comments.setModeration(lists, admin.uid);
  log("moderation lists updated", { by: admin.uid, banned: lists.banned.length, suspicious: lists.suspicious.length });
  return lists;
}

/** Deletes notices older than `days` days; for the nightly schedule. */
export async function purgeNotices({ comments, days = 60, now = () => new Date() }) {
  const before = new Date(now().getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  return comments.purgeNotices(before);
}
