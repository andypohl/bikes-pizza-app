// User administration behind the admin page (admin.bikes.pizza): the
// members with their newsletter choice and what they have posted, plus
// edits (password resets are done client-side) and deletion. Pure: the
// Firebase Auth admin API, the member store and the post store are injected.

import { validateUpdate, validateUsername } from "./account.js";
import { AppError, ValidationError } from "./errors.js";
import { postUrl } from "./post.js";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

const PROVIDER_LABELS = { password: "Email", "google.com": "Google", "apple.com": "Apple" };

/**
 * @typedef {object} AuthAdmin
 * @property {(maxResults: number, pageToken?: string) => Promise<{users: object[], pageToken?: string}>} listUsers
 * @property {(uid: string) => Promise<object>} getUser
 * @property {(uid: string, props: object) => Promise<object>} updateUser
 * @property {(uid: string, claims: object) => Promise<void>} setCustomUserClaims
 * @property {(uid: string) => Promise<void>} deleteUser
 */

/** Every Firebase Auth user record, across the API's pages. */
async function allAuthUsers(auth) {
  const users = [];
  let pageToken;
  do {
    const result = await auth.listUsers(1000, pageToken);
    users.push(...result.users);
    pageToken = result.pageToken;
  } while (pageToken);
  return users;
}

/** Published posts grouped by the credited member's uid, newest first. */
async function postsByUid(posts, siteUrl) {
  const map = new Map();
  for (const doc of await posts.listCredited()) {
    const list = map.get(doc.credit.uid) ?? [];
    list.push({ title: doc.title, publishedAt: doc.publishedAt, slug: doc.slug, url: postUrl(siteUrl, doc.feed, doc.slug) });
    map.set(doc.credit.uid, list);
  }
  return map;
}

function providersOf(user) {
  return (user.providerData ?? []).map((p) => PROVIDER_LABELS[p.providerId] ?? p.providerId);
}

function summarise(user, member, posts, newsletters) {
  const subscribedTo = new Set(member?.newsletters ?? []);
  return {
    uid: user.uid,
    email: user.email ?? member?.email ?? "",
    emailVerified: Boolean(user.emailVerified),
    admin: user.customClaims?.admin === true,
    username: member?.username ?? "",
    subscribed: newsletters.some((n) => subscribedTo.has(n.id)),
    providers: providersOf(user),
    createdAt: user.metadata?.creationTime ?? null,
    lastSignInAt: user.metadata?.lastSignInTime ?? null,
    postCount: posts.length,
    latestPost: posts[0] ?? null,
  };
}

function parsePaging(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(query.pageSize ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
  return { page, pageSize };
}

/**
 * One page of users ordered by most recent post, then (for members without
 * a post) by sign-up date, newest first.
 *
 * @param {{page?: string|number, pageSize?: string|number}} query
 * @param {{auth: AuthAdmin, members: import('./members.js').MemberStore, posts: object, newsletters: {id: string}[], siteUrl: string}} deps
 */
export async function listUsers(query, { auth, members, posts: postStore, newsletters, siteUrl }) {
  const { page, pageSize } = parsePaging(query);
  const [users, records, posts] = await Promise.all([allAuthUsers(auth), members.list(), postsByUid(postStore, siteUrl)]);
  const rows = users.map((user) => summarise(user, records.get(user.uid), posts.get(user.uid) ?? [], newsletters));
  rows.sort((a, b) => {
    const ap = a.latestPost?.publishedAt ?? "";
    const bp = b.latestPost?.publishedAt ?? "";
    if (ap !== bp) return ap > bp ? -1 : 1;
    return Date.parse(b.createdAt ?? 0) - Date.parse(a.createdAt ?? 0);
  });
  const total = rows.length;
  const start = (page - 1) * pageSize;
  return { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)), users: rows.slice(start, start + pageSize) };
}

/** Everything the detail panel shows for one user. */
export async function getUser(uid, { auth, members, posts: postStore, newsletters, siteUrl }) {
  let user;
  try {
    user = await auth.getUser(uid);
  } catch (error) {
    if (error?.code === "auth/user-not-found") throw new AppError("not-found", "No such user.");
    throw error;
  }
  const [member, posts] = await Promise.all([members.get(uid), postsByUid(postStore, siteUrl)]);
  const mine = posts.get(uid) ?? [];
  const subscribedTo = new Set(member?.newsletters ?? []);
  return {
    ...summarise(user, member, mine, newsletters),
    newsletters: newsletters.map((n) => ({ id: n.id, name: n.name, description: n.description ?? "", subscribed: subscribedTo.has(n.id) })),
    posts: mine,
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Applies the admin's edits: `username`, `email`, `newsletters` (the
 * full list of IDs) and `admin` (whether the account carries the `admin`
 * custom claim; `deps.by`, the acting admin, may not take away their own).
 * The email changes on the Auth user and the member record; a username
 * change is written onto the member's posts. Returns the fresh detail plus
 * `renamed` so the caller can rebuild the website.
 */
export async function updateUser(uid, data, deps) {
  const { auth, members, posts, newsletters, by, log = () => {} } = deps;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ValidationError("Nothing to update.");
  const patch = {};
  if ("email" in data) {
    if (typeof data.email !== "string" || !EMAIL_PATTERN.test(data.email.trim())) throw new ValidationError("That email address doesn't look right.");
    patch.email = data.email.trim();
  }
  let admin;
  if ("admin" in data) {
    if (typeof data.admin !== "boolean") throw new ValidationError("Admin must be true or false.");
    admin = data.admin;
    if (!admin && by?.uid === uid) throw new AppError("failed-precondition", "You can't take away your own admin access.");
  }
  const rest = {};
  if ("username" in data) rest.username = data.username;
  if ("newsletters" in data) rest.newsletters = data.newsletters;
  const memberPatch = Object.keys(rest).length ? validateUpdate(rest, newsletters) : {};
  if (!Object.keys(patch).length && !Object.keys(memberPatch).length && admin === undefined) {
    throw new ValidationError("Nothing to update.");
  }

  let existing;
  try {
    existing = await auth.getUser(uid);
  } catch (error) {
    if (error?.code === "auth/user-not-found") throw new AppError("not-found", "No such user.");
    throw error;
  }
  if (admin !== undefined && Boolean(existing.customClaims?.admin) !== admin) {
    // Custom claims are replaced as a whole; keep whatever else is there.
    const claims = { ...(existing.customClaims ?? {}) };
    if (admin) claims.admin = true;
    else delete claims.admin;
    await auth.setCustomUserClaims(uid, claims);
    log(admin ? "admin access granted" : "admin access revoked", { uid, by: by?.uid });
  }
  if (patch.email) {
    try {
      await auth.updateUser(uid, { email: patch.email });
    } catch (error) {
      if (error?.code === "auth/email-already-exists") throw new AppError("failed-precondition", "Another account already uses that email.");
      throw error;
    }
    await members.set(uid, { email: patch.email });
  }
  let renamed = false;
  if (memberPatch.username !== undefined) {
    await members.setUsername(uid, memberPatch.username);
    renamed = true;
    try {
      await posts.setUsername(uid, memberPatch.username);
    } catch (error) {
      log("member username not written to their posts", { uid, message: error.message });
    }
  }
  if (memberPatch.newsletters !== undefined) await members.set(uid, { newsletters: memberPatch.newsletters });
  return { ...(await getUser(uid, deps)), renamed };
}

/**
 * Deletes the Auth user and their member record (releasing the username).
 * Their posts stay, credited as they were; `cleanup(uid)`, when given,
 * removes what else they left (comments, likes, reactions, notices; see
 * comments.js), after the record is gone.
 *
 * `notify`, when given, is called afterwards with the deleted user's email
 * so the owner can be told; the deletion has already happened by then, so
 * a failure there is reported through `log` rather than thrown.
 */
export async function deleteUser(uid, { auth, members, cleanup, notify, log = () => {} }) {
  let email = null;
  try {
    email = (await auth.getUser(uid)).email ?? null;
    await auth.deleteUser(uid);
  } catch (error) {
    if (error?.code === "auth/user-not-found") throw new AppError("not-found", "No such user.");
    throw error;
  }
  await members.delete(uid);
  if (cleanup) {
    try {
      await cleanup(uid);
    } catch (error) {
      log("member data cleanup failed", { uid, message: error.message });
    }
  }
  if (notify && email) {
    try {
      await notify({ uid, email });
    } catch (error) {
      log("account deletion email failed", { uid, message: error.message });
    }
  }
  return { deleted: uid };
}

/** Human labels for sign-in providers, for tests and the page. */
export { PROVIDER_LABELS };
