// Member profiles (docs/community-design.md): what a username opens. The
// profile shows the username, when the member joined, the location they
// chose to share, and how many pizzas and bikes they have posted, each
// opening the list of those posts. Public: no sign-in needed to look,
// though a signed-in viewer learns whether the member takes messages.
// Pure: the stores are injected.

import { GALLERY_FEEDS } from "./contract.js";
import { AppError, ValidationError } from "./errors.js";
import { publicPost } from "./post.js";
import { validateUsername } from "./account.js";

export const PAGE_SIZE = 15;
export const MAX_PAGE_SIZE = 50;

/** The member behind a username, or throws not-found. */
async function find(username, members) {
  let name;
  try {
    name = validateUsername(username);
  } catch {
    throw new AppError("not-found", "No member has that username.");
  }
  const found = await members.uidByUsername(name);
  if (!found) throw new AppError("not-found", "No member has that username.");
  const record = await members.get(found.uid);
  if (!record) throw new AppError("not-found", "No member has that username.");
  return { uid: found.uid, record: { ...record, username: record.username || found.username } };
}

/** How many published posts the member has in each gallery feed. */
export function countsOf(posts) {
  const counts = {};
  for (const feed of GALLERY_FEEDS) counts[feed] = 0;
  for (const post of posts) if (post.feed in counts) counts[post.feed] += 1;
  return counts;
}

/**
 * The profile: `{uid, username, joinedAt, location, counts, messages}`.
 * `messages` says whether the viewer may start a conversation: the member
 * has not turned messages off, and the viewer is signed in and not the
 * member themselves.
 */
export async function getProfile(username, viewer, { members, posts, blocks }) {
  const { uid, record } = await find(username, members);
  const published = await posts.listByUid(uid);
  let messages = Boolean(viewer && viewer.uid !== uid && record.messages !== false);
  if (messages && blocks) {
    const [mine, theirs] = await Promise.all([blocks(viewer.uid), blocks(uid)]);
    if (mine.includes(uid) || theirs.includes(viewer.uid)) messages = false;
  }
  return {
    uid,
    username: record.username,
    joinedAt: record.joinedAt ?? record.createdAt?.toDate?.()?.toISOString?.() ?? record.createdAt ?? null,
    location: record.location ?? "",
    counts: countsOf(published),
    messages,
  };
}

/**
 * A page of the member's published posts in one gallery feed, newest
 * first: `{username, feed, page, pageSize, posts, hasMore}`.
 */
export async function listMemberPosts(username, query, { members, posts, siteUrl }) {
  const feed = query?.feed;
  if (!GALLERY_FEEDS.includes(feed)) throw new ValidationError("feed must be pizza or bikes.");
  const page = Math.max(1, Math.floor(Number(query?.page ?? 1)) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(query?.pageSize ?? PAGE_SIZE)) || PAGE_SIZE));
  const { uid, record } = await find(username, members);
  const all = (await posts.listByUid(uid)).filter((post) => post.feed === feed);
  const start = (page - 1) * pageSize;
  return {
    username: record.username,
    feed,
    page,
    pageSize,
    posts: all.slice(start, start + pageSize).map((doc) => publicPost(doc, siteUrl)),
    hasMore: start + pageSize < all.length,
  };
}
