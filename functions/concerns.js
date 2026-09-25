// Reporting a concern from the app: a post, a member, or anything else,
// with a reason and free text. Stores use this beside the Report actions
// on comments and conversations, which is what the app stores ask for
// ("an in-app mechanism for users to report concerns", child safety
// included). Each report is kept in Firestore (`concerns/{id}`) and mailed
// to the moderation address; a child safety reason is marked urgent.
// Pure: the store, the post lookup and the mail are injected (index.js).

import { CONCERNS } from "./contract.js";
import { AppError, ValidationError } from "./errors.js";

export const RULES = CONCERNS;

const KINDS = RULES.kinds.map((k) => k.value);
const REASONS = RULES.reasons.map((r) => r.value);

/** Reasons handled ahead of everything else. */
export const URGENT_REASONS = ["child_safety"];

const titleOf = (list, value) => list.find((o) => o.value === value)?.title ?? value;

/** Checks the request and answers the report's fields, trimmed. */
export function validateConcern(data) {
  const kind = data?.kind;
  if (typeof kind !== "string" || !KINDS.includes(kind)) throw new ValidationError("Say what the report is about.");
  const reason = data?.reason;
  if (typeof reason !== "string" || !REASONS.includes(reason)) throw new ValidationError("Pick a reason for the report.");
  let target = data?.target ?? "";
  if (typeof target !== "string") throw new ValidationError("The post or member must be text.");
  target = target.trim();
  if (target.length > RULES.maxTarget) throw new ValidationError(`Keep the post or member under ${RULES.maxTarget} characters.`);
  if (kind !== "other" && !target) {
    throw new ValidationError(kind === "post" ? "Say which post." : "Say which member.");
  }
  let details = data?.details ?? "";
  if (typeof details !== "string") throw new ValidationError("The details must be text.");
  details = details.trim();
  if (details.length > RULES.maxDetails) throw new ValidationError(`Keep the details under ${RULES.maxDetails} characters.`);
  if (kind === "other" && !details) throw new ValidationError("Say what the concern is.");
  return { kind, reason, target, details };
}

/** The email for a stored concern: `{subject, text}`. */
export function concernEmail(concern, { siteUrl = "" } = {}) {
  const urgent = URGENT_REASONS.includes(concern.reason);
  const reason = titleOf(RULES.reasons, concern.reason);
  const kind = titleOf(RULES.kinds, concern.kind);
  const subject = `${urgent ? "[URGENT] " : ""}Concern reported: ${reason}`;
  const lines = [
    `Reason: ${reason}${urgent ? " (handle first)" : ""}`,
    `About: ${kind}${concern.target ? ` — ${concern.target}` : ""}`,
  ];
  if (concern.post) lines.push(`Post: ${concern.post.title} (${siteUrl}${concern.post.path})`);
  lines.push(`Reported by: ${concern.username ?? "(no username)"} <${concern.email}> (${concern.uid})`);
  lines.push(`At: ${concern.at}`, "", concern.details || "(no details given)");
  return { subject, text: lines.join("\n") };
}

/**
 * Stores the report and mails it. `posts.get(slug)` (optional) attaches the
 * post's title and page when the target names an existing post; a target
 * that is not a slug is passed through as typed. At most `perDay` reports
 * per member per day. Answers `{reported: true, id}`.
 */
export async function reportConcern(data, user, deps) {
  const { concerns, posts, members, notify, now = () => new Date(), log = () => {} } = deps;
  const fields = validateConcern(data);
  const at = now();
  const since = new Date(at.getTime() - 24 * 60 * 60 * 1000).toISOString();
  if ((await concerns.countSince(user.uid, since)) >= RULES.perDay) {
    throw new AppError("resource-exhausted", "That's enough reports for today. Email us if it can't wait.");
  }
  let post = null;
  if (fields.kind === "post" && posts && /^[a-z0-9-]{1,80}$/.test(fields.target)) {
    const doc = await posts.get(fields.target);
    if (doc?.status === "published") post = { slug: fields.target, title: doc.title ?? fields.target, path: `/post/${fields.target}/` };
  }
  let username = null;
  if (members) {
    try {
      username = (await members.get(user.uid))?.username ?? null;
    } catch {
      username = null;
    }
  }
  const concern = {
    id: concerns.newId(),
    uid: user.uid,
    email: user.email,
    username,
    ...fields,
    post,
    at: at.toISOString(),
    status: "open",
  };
  await concerns.add(concern);
  log("concern reported", { id: concern.id, kind: concern.kind, reason: concern.reason, by: user.uid, urgent: URGENT_REASONS.includes(concern.reason) });
  if (notify) {
    try {
      await notify(concern);
    } catch (error) {
      // The report is stored either way; the queue is the source of truth.
      log("concern email failed", { id: concern.id, error: error.message });
    }
  }
  return { reported: true, id: concern.id };
}

/** Firestore store for concerns: `concerns/{id}`. */
export function firestoreConcernStore(db) {
  const col = db.collection("concerns");
  return {
    newId: () => col.doc().id,
    async add(concern) {
      await col.doc(concern.id).set(concern);
    },
    async countSince(uid, iso) {
      const snap = await col.where("uid", "==", uid).where("at", ">=", iso).count().get();
      return snap.data().count;
    },
  };
}
