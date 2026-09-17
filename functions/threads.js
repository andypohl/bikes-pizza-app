// Direct messages (docs/community-design.md): one thread per pair of
// members, holding everything they have said to each other, divided into
// numbered conversations (a conversation ends when the two agree to
// continue by email; the next message starts a new one). The app reads
// threads and messages live from Firestore; every write comes through
// here: text goes through the comment pipeline and the screening (banned
// words and strong toxicity refuse; nothing is held, since nobody reviews
// private messages), the other member's unread count moves, and blocks
// are honoured. Pure: the stores and the screening call are injected.

import { MEMBERS } from "./contract.js";
import { commentToText, renderComment, validateText } from "./comment_text.js";
import { AppError, ValidationError } from "./errors.js";
import { REASONS } from "./comments.js";
import { screenText } from "./moderate.js";
import { threadId } from "./thread_store.js";
import { validateUsername } from "./account.js";

export const RULES = MEMBERS.messages;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,140}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T/;

/** How many messages the thread list and a page carry. */
export const PAGE_SIZE = 50;

// ---- pure helpers -------------------------------------------------------------

/** The thread as the API hands it out to `uid`: the other member, the preview, their unread count. */
export function publicThread(doc, uid) {
  const other = (doc.members ?? []).find((m) => m !== uid) ?? null;
  return {
    id: doc.id,
    gone: doc.gone === true,
    other: other ? { uid: other, username: doc.usernames?.[other] ?? "" } : null,
    lastMessageAt: doc.lastMessageAt ?? null,
    last: doc.last ?? null,
    unread: doc.unread?.[uid] ?? 0,
    conversation: doc.conversation ?? 1,
    blocked: (doc.blockedBy ?? []).length > 0,
    blockedByMe: (doc.blockedBy ?? []).includes(uid),
    emailRequest: doc.emailRequest ?? null,
  };
}

/** A message as the API hands it out. */
export function publicMessage(doc) {
  if (doc.kind === "event") {
    return { id: doc.id, kind: "event", event: doc.event, by: doc.by ?? null, at: doc.at, conversation: doc.conversation ?? 1 };
  }
  const deleted = Boolean(doc.deletedAt);
  return {
    id: doc.id,
    kind: "message",
    conversation: doc.conversation ?? 1,
    uid: doc.uid,
    text: deleted ? "" : (doc.text ?? ""),
    html: deleted ? "" : (doc.html ?? ""),
    createdAt: doc.createdAt,
    editedAt: doc.editedAt ?? null,
    deleted,
  };
}

/** Whether a message written at `createdAt` may still be edited at `now`. */
export function withinEditWindow(createdAt, now = new Date()) {
  return now.getTime() - Date.parse(createdAt) < RULES.editWindowMinutes * 60 * 1000;
}

/** Throws when the member has messaged too recently or too often today; returns the counter to store. */
export function rateCheck(member, now, { newThread = false } = {}) {
  const rate = member?.messageRate ?? {};
  const day = now.toISOString().slice(0, 10);
  const count = rate.day === day ? (rate.count ?? 0) : 0;
  const threads = rate.day === day ? (rate.threads ?? 0) : 0;
  if (rate.lastAt && now.getTime() - Date.parse(rate.lastAt) < RULES.rateLimit.seconds * 1000) {
    throw new AppError("failed-precondition", "Please wait a moment between messages.");
  }
  if (count >= RULES.rateLimit.perDay) throw new AppError("failed-precondition", "You've reached today's message limit.");
  if (newThread && threads >= RULES.rateLimit.newThreadsPerDay) {
    throw new AppError("failed-precondition", "You've started as many conversations as you can today.");
  }
  return { messageRate: { day, count: count + 1, threads: threads + (newThread ? 1 : 0), lastAt: now.toISOString() } };
}

/** Throws when the member has started too many threads today; returns the counter to store. */
export function newThreadCheck(member, now) {
  const rate = member?.messageRate ?? {};
  const day = now.toISOString().slice(0, 10);
  const threads = rate.day === day ? (rate.threads ?? 0) : 0;
  if (threads >= RULES.rateLimit.newThreadsPerDay) {
    throw new AppError("failed-precondition", "You've started as many conversations as you can today.");
  }
  return { messageRate: { ...(rate.day === day ? rate : {}), day, threads: threads + 1 } };
}

/** The first `previewLength` characters of a message's plain text. */
export function preview(html) {
  const text = commentToText(html);
  return text.length > RULES.previewLength ? `${text.slice(0, RULES.previewLength - 1).trimEnd()}…` : text;
}

function checkId(id, what = "Thread") {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new ValidationError(`${what} id is required.`);
  return id;
}

/** The thread, which must exist, not be a marker, and include `uid`. */
function memberOf(thread, uid) {
  if (!thread || !(thread.members ?? []).includes(uid)) throw new AppError("not-found", "That conversation doesn't exist.");
  if (thread.gone) throw new AppError("failed-precondition", "This conversation is gone: the other member deleted their account.");
  return thread;
}

/** Shown when a message is refused; the reason is deliberately not spelled out. */
export const REFUSED_MESSAGE = "That message can't be sent.";

/**
 * Renders and screens a message; throws when refused. A failure of the
 * scoring call lets the message through (logged by screenText): nothing
 * is held for review here, and blocks and reports remain.
 */
async function prepare(text, { moderate, comments, log = () => {} }) {
  const clean = validateText(text);
  if (clean.length > RULES.maxLength) throw new ValidationError(`Messages are ${RULES.maxLength} characters at most.`);
  const rendered = await renderComment(clean);
  const moderation = comments ? await comments.getModeration() : {};
  const screened = await screenText(commentToText(rendered.html), { moderation, moderate, log });
  if (screened.verdict === "block") {
    log("message refused", { reasons: screened.screening.reasons, matched: screened.screening.matched });
    throw new AppError("invalid-argument", REFUSED_MESSAGE);
  }
  return { text: rendered.text, html: rendered.html, screening: screened.screening };
}

// ---- members' endpoints --------------------------------------------------------

/** The member's threads, newest first: `{threads}`. */
export async function listThreads(user, { threads }) {
  const list = await threads.listForMember(user.uid);
  return { threads: list.map((t) => publicThread(t, user.uid)) };
}

/**
 * The thread with the member named in `data.username`, created if there
 * is none: `{thread, created}`. Refused when they have messages off or
 * either has blocked the other.
 */
export async function openThread(data, user, { threads, members, now = () => new Date(), log = () => {} }) {
  let name;
  try {
    name = validateUsername(data?.username);
  } catch {
    throw new ValidationError("Say whom to message.");
  }
  const found = await members.uidByUsername(name);
  if (!found) throw new AppError("not-found", "No member has that username.");
  if (found.uid === user.uid) throw new AppError("failed-precondition", "That's you.");
  const [other, me] = await Promise.all([members.get(found.uid), members.get(user.uid)]);
  if (!me?.username) throw new AppError("failed-precondition", "Choose a username in Settings first.");
  const id = threadId(user.uid, found.uid);
  const existing = await threads.get(id);
  if (existing && !existing.gone) return { thread: publicThread(existing, user.uid), created: false };
  if (other?.messages === false) throw new AppError("permission-denied", `${found.username} isn't taking messages.`);
  const [myBlocks, theirBlocks] = await Promise.all([threads.blocks(user.uid), threads.blocks(found.uid)]);
  if (myBlocks.includes(found.uid) || theirBlocks.includes(user.uid)) {
    throw new AppError("permission-denied", "You can't message this member.");
  }
  const at = now().toISOString();
  const doc = {
    members: [user.uid, found.uid].sort(),
    usernames: { [user.uid]: me.username, [found.uid]: found.username },
    createdAt: at,
    lastMessageAt: at,
    last: null,
    unread: { [user.uid]: 0, [found.uid]: 0 },
    seenAt: { [user.uid]: at },
    blockedBy: [],
    conversation: 1,
    conversationStartedAt: at,
    emailRequest: null,
  };
  await threads.transact(id, { uid: user.uid }, ({ thread, member }) => {
    if (thread && !thread.gone) return { result: null };
    return { thread: { ...doc, create: true }, member: newThreadCheck(member, now()), result: null };
  });
  log("thread opened", { id, by: user.uid, with: found.uid });
  return { thread: publicThread({ ...doc, id }, user.uid), created: true };
}

/** A page of a thread's messages, newest first, from before `query.before`: `{messages, more}`. */
export async function listMessages(id, query, user, { threads }) {
  checkId(id);
  const thread = await threads.get(id);
  if (!thread || !(thread.members ?? []).includes(user.uid)) throw new AppError("not-found", "That conversation doesn't exist.");
  if (thread.gone) return { thread: publicThread(thread, user.uid), messages: [], more: false };
  const before = query?.before;
  if (before !== undefined && before !== "" && (typeof before !== "string" || !ISO_PATTERN.test(before))) {
    throw new ValidationError("before must be a date and time.");
  }
  const page = await threads.messages(id, { before: before || null, limit: PAGE_SIZE + 1 });
  return {
    thread: publicThread(thread, user.uid),
    messages: page.slice(0, PAGE_SIZE).map(publicMessage),
    more: page.length > PAGE_SIZE,
  };
}

/** Sends a message: `{message}`. Refused by the screening, a block, or the rate limit. */
export async function sendMessage(id, data, user, deps) {
  const { threads, now = () => new Date(), log = () => {} } = deps;
  checkId(id);
  const prepared = await prepare(data?.text, deps);
  const at = now();
  const mid = threads.newId();
  const written = await threads.transact(id, { uid: user.uid }, ({ thread, member }) => {
    memberOf(thread, user.uid);
    if ((thread.blockedBy ?? []).length) throw new AppError("permission-denied", "This conversation is closed.");
    const rate = rateCheck(member, at);
    const other = thread.members.find((m) => m !== user.uid);
    const message = {
      id: mid,
      kind: "message",
      conversation: thread.conversation ?? 1,
      uid: user.uid,
      text: prepared.text,
      html: prepared.html,
      createdAt: at.toISOString(),
      editedAt: null,
      deletedAt: null,
      screening: prepared.screening,
    };
    return {
      message,
      thread: {
        lastMessageAt: message.createdAt,
        last: { uid: user.uid, text: preview(prepared.html), at: message.createdAt },
        [`unread.${other}`]: (thread.unread?.[other] ?? 0) + 1,
      },
      member: rate,
      result: message,
    };
  });
  log("message sent", { thread: id, by: user.uid, id: mid });
  return { message: publicMessage(written) };
}

/** Replaces the text of the member's own message within the edit window: `{message}`. */
export async function editMessage(id, mid, data, user, deps) {
  const { threads, now = () => new Date() } = deps;
  checkId(id);
  checkId(mid, "Message");
  const prepared = await prepare(data?.text, deps);
  const at = now();
  const existing = await threads.message(id, mid);
  const written = await threads.transact(id, {}, ({ thread }) => {
    memberOf(thread, user.uid);
    if (!existing || existing.kind !== "message" || existing.uid !== user.uid) throw new AppError("not-found", "That message is gone.");
    if (existing.deletedAt) throw new AppError("failed-precondition", "That message was deleted.");
    if (!withinEditWindow(existing.createdAt, at)) {
      throw new AppError("failed-precondition", `Messages can be edited for ${RULES.editWindowMinutes} minutes after sending.`);
    }
    const fields = { text: prepared.text, html: prepared.html, editedAt: at.toISOString(), screening: prepared.screening };
    const isLast = thread.last?.at === existing.createdAt;
    return {
      updateMessage: { id: mid, fields },
      thread: isLast ? { last: { ...thread.last, text: preview(prepared.html) } } : undefined,
      result: { ...existing, ...fields },
    };
  });
  return { message: publicMessage(written) };
}

/** Deletes the member's own message, leaving "Message deleted" for both: `{deleted}`. */
export async function deleteMessage(id, mid, user, { threads, now = () => new Date() }) {
  checkId(id);
  checkId(mid, "Message");
  const existing = await threads.message(id, mid);
  await threads.transact(id, {}, ({ thread }) => {
    memberOf(thread, user.uid);
    if (!existing || existing.kind !== "message" || existing.uid !== user.uid) throw new AppError("not-found", "That message is gone.");
    const isLast = thread.last?.at === existing.createdAt;
    return {
      updateMessage: { id: mid, fields: { text: "", html: "", deletedAt: now().toISOString() } },
      thread: isLast ? { last: { ...thread.last, text: "" } } : undefined,
      result: null,
    };
  });
  return { deleted: mid };
}

/** Marks the thread as seen by the member: their unread count drops to zero. */
export async function markSeen(id, user, { threads, now = () => new Date() }) {
  checkId(id);
  await threads.transact(id, {}, ({ thread }) => {
    memberOf(thread, user.uid);
    return { thread: { [`unread.${user.uid}`]: 0, [`seenAt.${user.uid}`]: now().toISOString() }, result: null };
  });
  return { seen: true };
}

/** Reports the thread with a reason, which lets admins read it. */
export async function reportThread(id, data, user, { threads, now = () => new Date(), log = () => {} }) {
  checkId(id);
  const reason = data?.reason;
  if (typeof reason !== "string" || !REASONS.includes(reason)) throw new ValidationError("Pick a reason for the report.");
  await threads.transact(id, {}, ({ thread }) => {
    memberOf(thread, user.uid);
    return { thread: { reportedAt: now().toISOString(), reportedBy: user.uid, reason }, result: null };
  });
  log("thread reported", { thread: id, by: user.uid, reason });
  return { reported: true };
}

/**
 * Blocks (`on`) or unblocks the member named. Blocking freezes the
 * thread the two share, if any, and hides the blocked member's comments
 * from the blocker (comments.js consults the blocks).
 */
export async function setBlock(username, on, user, { threads, members, now = () => new Date(), log = () => {} }) {
  let name;
  try {
    name = validateUsername(username);
  } catch {
    throw new AppError("not-found", "No member has that username.");
  }
  const found = await members.uidByUsername(name);
  if (!found) throw new AppError("not-found", "No member has that username.");
  if (found.uid === user.uid) throw new AppError("failed-precondition", "That's you.");
  const at = now().toISOString();
  await threads.setBlock(user.uid, found.uid, on, at);
  const id = threadId(user.uid, found.uid);
  const thread = await threads.get(id);
  if (thread && !thread.gone) {
    const blockedBy = (thread.blockedBy ?? []).filter((u) => u !== user.uid);
    if (on) blockedBy.push(user.uid);
    const mid = threads.newId();
    await threads.transact(id, {}, () => ({
      thread: { blockedBy },
      message: on ? { id: mid, kind: "event", event: "blocked", by: user.uid, at, conversation: thread.conversation ?? 1, createdAt: at } : undefined,
      result: null,
    }));
  }
  log(on ? "member blocked" : "member unblocked", { by: user.uid, other: found.uid });
  return { blocked: on, username: found.username };
}

/** The usernames the member has blocked: `{blocked}`. */
export async function listBlocks(user, { threads, members }) {
  const uids = await threads.blocks(user.uid);
  const blocked = [];
  for (const uid of uids) {
    const record = await members.get(uid);
    blocked.push({ uid, username: record?.username ?? "" });
  }
  return { blocked };
}

// ---- deletion, export, admin ---------------------------------------------------

/**
 * Removes a deleted member's threads whole (both sides' messages), leaving
 * the other member a `gone` marker, and their blocks. Returns how many.
 */
export async function deleteMemberThreads(uid, { threads, log = () => {} }) {
  const list = await threads.listForMember(uid);
  let removed = 0;
  for (const thread of list) {
    const remaining = (thread.members ?? []).find((m) => m !== uid);
    if (thread.gone || !remaining) await threads.deleteThread(thread.id);
    else await threads.replaceWithMarker(thread.id, remaining);
    removed += 1;
  }
  await threads.deleteBlocks(uid);
  log("member threads removed", { uid, threads: removed });
  return removed;
}

/** The messages a member wrote, for their export. */
export async function exportMessages(uid, { threads }) {
  const list = await threads.messagesByUid(uid);
  return list
    .filter((m) => m.kind !== "event" && !m.deletedAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .map((m) => ({ thread: m.thread, id: m.id, text: m.text ?? "", createdAt: m.createdAt, editedAt: m.editedAt ?? null }));
}

/** Reported threads, for the admin page: `{threads}`, each with who reported it and why. */
export async function adminThreads(query, admin, { threads }) {
  const name = query?.queue ?? "reported";
  if (name !== "reported") throw new ValidationError("Unknown queue.");
  const list = await threads.reported();
  return {
    queue: name,
    threads: list.map((t) => ({
      id: t.id,
      members: (t.members ?? []).map((uid) => ({ uid, username: t.usernames?.[uid] ?? "" })),
      lastMessageAt: t.lastMessageAt ?? null,
      reportedAt: t.reportedAt ?? null,
      reportedBy: t.reportedBy ?? null,
      reason: t.reason ?? null,
    })),
  };
}

/** A reported thread's messages, for the admin page; a thread nobody reported is not readable. */
export async function adminThread(id, admin, { threads }) {
  checkId(id);
  const thread = await threads.get(id);
  if (!thread || thread.gone) throw new AppError("not-found", "That conversation doesn't exist.");
  if (!thread.reportedAt) throw new AppError("permission-denied", "Only reported conversations can be read.");
  const messages = await threads.messages(id, { limit: 200 });
  return {
    id,
    members: (thread.members ?? []).map((uid) => ({ uid, username: thread.usernames?.[uid] ?? "" })),
    reportedBy: thread.reportedBy ?? null,
    reason: thread.reason ?? null,
    messages: messages.reverse().map(publicMessage),
  };
}
