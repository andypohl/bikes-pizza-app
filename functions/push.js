// Push notifications through Firebase Cloud Messaging. Two kinds:
//
// - Broadcasts (a post published or updated) go to a topic per feed
//   (`new-posts-bikes`, `updated-posts-pizza`, ...). Each device subscribes
//   to the topics its own switches and "Show me" choice call for, signed
//   in or not, so the server never needs to know who wants what.
// - Personal ones (a message, a comment on the member's post, a reply or a
//   mention) go to the member's registered devices, if their preferences
//   (`notifications` on the member record) allow that category.
//
// Pure builders (what to send to whom) plus `createPush`, which wires them
// to the messaging client and the stores. Sending never fails the write it
// follows: every failure is logged and swallowed.

import { NOTIFICATIONS } from "./contract.js";
import { ValidationError } from "./errors.js";

export const CATEGORIES = NOTIFICATIONS.categories;
const DEFAULTS = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.default]));
/** The categories a member sets on their record (the rest are per-device topics). */
export const MEMBER_CATEGORIES = CATEGORIES.filter((c) => c.scope === "member").map((c) => c.value);
export const PLATFORMS = ["ios", "android"];
const BODY_MAX = 140;

/** Whether the member takes notifications of `category` (their setting, else the default). */
export function wants(member, category) {
  const value = member?.notifications?.[category];
  return typeof value === "boolean" ? value : Boolean(DEFAULTS[category]);
}

/** The topic a broadcast category uses for a feed. */
export function topicFor(category, feed) {
  const prefix = NOTIFICATIONS.topics[category];
  if (!prefix) throw new Error(`no topic for ${category}`);
  return `${prefix}-${feed}`;
}

/** Checks a device registration: `{token, platform}`. */
export function validateDevice(data) {
  const token = data?.token;
  if (typeof token !== "string" || token.length < 20 || token.length > 4096 || /\s/.test(token)) {
    throw new ValidationError("A device token is required.");
  }
  const platform = data?.platform;
  if (!PLATFORMS.includes(platform)) throw new ValidationError("platform must be ios or android.");
  return { token, platform };
}

/** The member's notification preferences as the app shows them. */
export function preferences(member) {
  return Object.fromEntries(MEMBER_CATEGORIES.map((c) => [c, wants(member, c)]));
}

/** Checks a preferences patch from the app: booleans for known member categories only. */
export function validatePreferences(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ValidationError("notifications must be an object.");
  const patch = {};
  for (const [key, value] of Object.entries(data)) {
    if (!MEMBER_CATEGORIES.includes(key)) throw new ValidationError(`Unknown notification setting: ${key}.`);
    if (typeof value !== "boolean") throw new ValidationError(`${key} must be true or false.`);
    patch[key] = value;
  }
  return patch;
}

const FEED_NOUN = { bikes: "bike", pizza: "pizza", news: "news post" };
const trim = (text, max = BODY_MAX) => {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** The broadcast for a post that just went up. */
export function postPublishedMessage(doc) {
  const noun = FEED_NOUN[doc.feed] ?? "post";
  const by = doc.credit?.username ? ` by ${doc.credit.username}` : "";
  return {
    topic: topicFor("newPosts", doc.feed),
    notification: { title: `New ${noun}${by}`, body: trim(doc.title) },
    data: { type: "post", id: doc.slug, feed: doc.feed },
  };
}

/** The broadcast for a post that was edited. */
export function postUpdatedMessage(doc) {
  const noun = FEED_NOUN[doc.feed] ?? "post";
  return {
    topic: topicFor("updatedPosts", doc.feed),
    notification: { title: `Updated ${noun}`, body: trim(doc.title) },
    data: { type: "post", id: doc.slug, feed: doc.feed },
  };
}

/** The personal notification for a direct message: to the other member. */
export function messageSentMessage({ threadId, other, username, text }) {
  return {
    uid: other,
    category: "messages",
    notification: { title: username || "New message", body: trim(text) },
    data: { type: "thread", id: threadId },
  };
}

/**
 * Who hears about a published comment, and as what: the post's author
 * (`comments`), then everyone in the reply thread and everyone mentioned
 * (`replies`). Never the commenter; each member once, the first category
 * winning. `all` is every comment on the post.
 */
export function commentRecipients({ post, comment, all = [] }) {
  const seen = new Set([comment.uid]);
  const out = [];
  const add = (uid, category) => {
    if (!uid || seen.has(uid)) return;
    seen.add(uid);
    out.push({ uid, category });
  };
  add(post.credit?.uid, "comments");
  if (comment.parentId) {
    const top = all.find((c) => c.id === comment.parentId);
    if (top) {
      add(top.uid, "replies");
      for (const c of all) if (c.parentId === top.id && c.status === "published") add(c.uid, "replies");
    }
  }
  for (const uid of comment.mentions ?? []) add(uid, "replies");
  return out;
}

/** The personal notification for a comment, worded for its recipient's category. */
export function commentMessage({ post, comment, category, mentioned = false }) {
  const who = comment.username || "Someone";
  const title =
    category === "comments"
      ? `${who} commented on ${trim(post.title, 60)}`
      : mentioned
        ? `${who} mentioned you on ${trim(post.title, 60)}`
        : `${who} replied on ${trim(post.title, 60)}`;
  return {
    category,
    notification: { title, body: trim(comment.text) },
    data: { type: "post", id: post.slug, feed: post.feed, comment: comment.id },
  };
}

const INVALID_TOKEN = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"]);

/**
 * The sender the rest of the functions call. `messaging` is
 * firebase-admin's Messaging (or a fake with `send` and
 * `sendEachForMulticast`); `devices` and `members` are the stores.
 */
export function createPush({ messaging, devices, members, log = () => {} }) {
  const common = (msg) => ({
    notification: msg.notification,
    data: msg.data,
    apns: { payload: { aps: { sound: "default" } } },
    android: { priority: "high", notification: { sound: "default" } },
  });

  async function toTopic(msg) {
    try {
      await messaging.send({ topic: msg.topic, ...common(msg) });
      log("push sent", { topic: msg.topic, type: msg.data.type, id: msg.data.id });
    } catch (error) {
      log("push failed", { topic: msg.topic, error: error.message });
    }
  }

  async function toMember(uid, msg) {
    try {
      const member = await members.get(uid);
      if (!wants(member, msg.category)) return;
      const tokens = (await devices.list(uid)).map((d) => d.token);
      if (!tokens.length) return;
      const result = await messaging.sendEachForMulticast({ tokens, ...common(msg) });
      const stale = [];
      (result.responses ?? []).forEach((r, i) => {
        if (!r.success && INVALID_TOKEN.has(r.error?.code)) stale.push(tokens[i]);
      });
      for (const token of stale) await devices.remove(uid, token);
      log("push sent", { uid, category: msg.category, type: msg.data.type, id: msg.data.id, sent: result.successCount ?? 0, stale: stale.length });
    } catch (error) {
      log("push failed", { uid, category: msg.category, error: error.message });
    }
  }

  return {
    postPublished: (doc) => toTopic(postPublishedMessage(doc)),
    postUpdated: (doc) => toTopic(postUpdatedMessage(doc)),
    messageSent: (args) => {
      const msg = messageSentMessage(args);
      return toMember(msg.uid, msg);
    },
    async commentPublished({ post, comment, all }) {
      for (const { uid, category } of commentRecipients({ post, comment, all })) {
        const mentioned = (comment.mentions ?? []).includes(uid);
        await toMember(uid, commentMessage({ post, comment, category, mentioned }));
      }
    },
  };
}

/**
 * Registered devices: `members/{uid}/devices/{token}`. A token registered
 * by a member is taken away from any other member it was under (a shared
 * device that changed accounts).
 */
export function firestoreDeviceStore(db) {
  const col = (uid) => db.collection("members").doc(uid).collection("devices");
  return {
    async register(uid, { token, platform }, at) {
      const others = await db.collectionGroup("devices").where("token", "==", token).get();
      for (const doc of others.docs) {
        if (doc.ref.parent.parent?.id !== uid) await doc.ref.delete();
      }
      await col(uid).doc(token).set({ token, platform, updatedAt: at }, { merge: true });
    },
    async remove(uid, token) {
      await col(uid).doc(token).delete();
    },
    async list(uid) {
      const snap = await col(uid).get();
      return snap.docs.map((d) => d.data());
    },
    async removeAll(uid) {
      const snap = await col(uid).get();
      for (const doc of snap.docs) await doc.ref.delete();
    },
  };
}

/** Registers the caller's device (`POST /me/devices`). */
export async function registerDevice(data, user, { devices, now = () => new Date(), log = () => {} }) {
  const device = validateDevice(data);
  await devices.register(user.uid, device, now().toISOString());
  log("device registered", { uid: user.uid, platform: device.platform });
  return { registered: true };
}

/** Forgets one of the caller's devices (`DELETE /me/devices/{token}`). */
export async function removeDevice(token, user, { devices, log = () => {} }) {
  if (typeof token !== "string" || !token) throw new ValidationError("A device token is required.");
  await devices.remove(user.uid, token);
  log("device removed", { uid: user.uid });
  return { removed: true };
}
