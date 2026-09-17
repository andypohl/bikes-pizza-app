// In-memory stand-ins for the persistence modules, shared by the tests.

import { applyDeltas, countDeltas } from "./reactions.js";
import { usernameKey } from "./account.js";
import { threadId } from "./thread_store.js";

/** An in-memory post_store.js: documents by slug, renditions by path. */
export function memoryPostStore() {
  const docs = new Map();
  const files = new Map();
  const reactions = new Map(); // "slug/uid" -> {uid, username, picks, updatedAt}
  let clock = 0;
  const stamp = () => new Date(2026, 5, 1, 12, ++clock);
  const sorted = (list) => list.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  return {
    docs,
    files,
    reactions,
    async get(slug) {
      const doc = docs.get(slug);
      return doc ? { ...doc, slug } : null;
    },
    async exists(slug) {
      return docs.has(slug);
    },
    async create(slug, doc) {
      docs.set(slug, { ...doc, createdAt: stamp(), updatedAt: stamp() });
    },
    async patch(slug, fields) {
      const doc = docs.get(slug);
      if (!doc) throw new Error(`no post ${slug}`);
      for (const [key, value] of Object.entries(fields)) {
        if (key.includes(".")) {
          const [a, b] = key.split(".");
          doc[a] = { ...(doc[a] ?? {}), [b]: value };
        } else doc[key] = value;
      }
      doc.updatedAt = stamp();
    },
    async listByUid(uid) {
      return sorted([...docs.entries()].filter(([, d]) => d.status === "published" && d.credit?.uid === uid).map(([slug, d]) => ({ ...d, slug })));
    },
    async listByFeed(feed, { limit = 200 } = {}) {
      return sorted([...docs.entries()].filter(([, d]) => d.status === "published" && d.feed === feed).map(([slug, d]) => ({ ...d, slug }))).slice(0, limit);
    },
    async listCredited() {
      return sorted([...docs.entries()].filter(([, d]) => d.status === "published" && d.credit?.uid).map(([slug, d]) => ({ ...d, slug })));
    },
    async setUsername(uid, username) {
      let n = 0;
      for (const doc of docs.values()) {
        if (doc.credit?.uid === uid) {
          doc.credit = { ...doc.credit, username };
          n += 1;
        }
      }
      for (const record of reactions.values()) if (record.uid === uid) record.username = username;
      return n;
    },
    async listReactions(slug) {
      return [...reactions.entries()].filter(([key]) => key.startsWith(`${slug}/`)).map(([, record]) => ({ ...record }));
    },
    async listReactionsByUid(uid) {
      return [...reactions.entries()].filter(([, r]) => r.uid === uid).map(([key, record]) => ({ ...record, slug: key.split("/")[0] }));
    },
    async removeReactions(uid) {
      let n = 0;
      for (const [key, record] of [...reactions.entries()]) {
        if (record.uid !== uid) continue;
        const slug = key.split("/")[0];
        const doc = docs.get(slug);
        if (doc) doc.reactions = applyDeltas(doc.reactions, countDeltas(record.picks, {}));
        reactions.delete(key);
        n += 1;
      }
      return n;
    },
    async setReaction(slug, uid, picks, { username = "" } = {}) {
      const doc = docs.get(slug);
      if (!doc) throw new Error(`no post ${slug}`);
      const own = reactions.get(`${slug}/${uid}`);
      doc.reactions = applyDeltas(doc.reactions, countDeltas(own?.picks, picks));
      reactions.set(`${slug}/${uid}`, { uid, username, picks, updatedAt: stamp() });
      return { reactions: doc.reactions };
    },
    async putRendition(slug, version, { name, bytes, contentType }) {
      files.set(`posts/${slug}/${version}/${name}`, { bytes, contentType });
    },
    async putInline(name, bytes, contentType) {
      files.set(`posts/inline/${name}`, { bytes, contentType });
      return `https://files.test/o/posts%2Finline%2F${name}?alt=media`;
    },
    renditionBase(slug, version) {
      return `https://files.test/o/posts%2F${slug}%2F${version}%2F`;
    },
  };
}

/**
 * An in-memory member_store (members.js's MemberStore) with the username
 * lookup: records by uid, usernames reserved case-insensitively.
 */
export function memoryMemberStore(initial = {}) {
  const records = new Map(Object.entries(initial).map(([uid, r]) => [uid, { ...r }]));
  return {
    records,
    async get(uid) {
      const r = records.get(uid);
      return r ? { ...r } : null;
    },
    async set(uid, data) {
      records.set(uid, { ...(records.get(uid) ?? {}), ...data });
    },
    async remove(uid, fields) {
      const r = records.get(uid);
      if (r) for (const f of fields) delete r[f];
    },
    async setUsername(uid, username) {
      for (const [other, r] of records) {
        if (other !== uid && r.username && usernameKey(r.username) === usernameKey(username)) throw new Error("That username is taken.");
      }
      records.set(uid, { ...(records.get(uid) ?? {}), username });
    },
    async uidByUsername(username) {
      const key = usernameKey(username);
      for (const [uid, r] of records) if (r.username && usernameKey(r.username) === key) return { uid, username: r.username };
      return null;
    },
    async list() {
      return new Map([...records].map(([uid, r]) => [uid, { ...r }]));
    },
    async delete(uid) {
      records.delete(uid);
    },
  };
}

/**
 * An in-memory comment_store.js over a memoryPostStore (for the post's
 * counts) and a memoryMemberStore (for the rate counter). Keys are
 * "slug/id" for comments and "slug/id/uid" for likes and reports.
 */
export function memoryCommentStore(posts, members = memoryMemberStore()) {
  const comments = new Map();
  const likes = new Map();
  const reports = new Map();
  const notices = new Map(); // uid -> [{id, ...}]
  let moderation = { banned: [], suspicious: [] };
  let seq = 0;
  const byCreated = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
  const ofPost = (slug) =>
    [...comments.entries()]
      .filter(([key]) => key.startsWith(`${slug}/`))
      .map(([key, doc]) => ({ ...doc, id: key.split("/")[1] }))
      .sort(byCreated);
  const under = (map, prefix) => [...map.entries()].filter(([key]) => key.startsWith(prefix));
  return {
    comments,
    likes,
    reports,
    notices,
    get moderation() {
      return moderation;
    },
    async all(slug) {
      return ofPost(slug);
    },
    async likes(slug, id) {
      return under(likes, `${slug}/${id}/`)
        .map(([, l]) => ({ ...l }))
        .sort((a, b) => (a.at < b.at ? -1 : 1));
    },
    async reports(slug, id) {
      return under(reports, `${slug}/${id}/`).map(([, r]) => ({ ...r }));
    },
    async transact(slug, { uid, id } = {}, decide) {
      const doc = posts.docs.get(slug);
      if (!doc) throw new Error(`no post ${slug}`);
      const member = uid ? await members.get(uid) : null;
      const like = id && uid ? likes.get(`${slug}/${id}/${uid}`) : null;
      const report = id && uid ? reports.get(`${slug}/${id}/${uid}`) : null;
      const out = await decide({
        post: { ...doc, slug },
        comments: ofPost(slug),
        member,
        like: like ? { ...like } : null,
        report: report ? { ...report } : null,
      });
      for (const [cid, data] of Object.entries(out.comments ?? {})) {
        if (data === null) {
          comments.delete(`${slug}/${cid}`);
          for (const [key] of under(likes, `${slug}/${cid}/`)) likes.delete(key);
          for (const [key] of under(reports, `${slug}/${cid}/`)) reports.delete(key);
        } else {
          const { id: _id, ...fields } = data;
          comments.set(`${slug}/${cid}`, fields);
        }
      }
      if (out.post) await posts.patch(slug, out.post);
      if (out.member && uid) await members.set(uid, out.member);
      if (out.like !== undefined && id && uid) {
        if (out.like === null) likes.delete(`${slug}/${id}/${uid}`);
        else likes.set(`${slug}/${id}/${uid}`, out.like);
      }
      if (out.report !== undefined && id && uid) {
        if (out.report === null) reports.delete(`${slug}/${id}/${uid}`);
        else reports.set(`${slug}/${id}/${uid}`, out.report);
      }
      if (out.clearReports && id) for (const [key] of under(reports, `${slug}/${id}/`)) reports.delete(key);
      return out.result;
    },
    async queue(name, { limit = 50 } = {}) {
      const all = [...comments.entries()].map(([key, doc]) => ({ ...doc, id: key.split("/")[1], slug: key.split("/")[0] }));
      const picked =
        name === "pending"
          ? all.filter((c) => c.status === "pending")
          : name === "reported"
            ? all.filter((c) => c.reportCount > 0)
            : all.filter((c) => c.status === "published");
      const newestFirst = (a, b) => -byCreated(a, b);
      picked.sort(name === "reported" ? (a, b) => b.reportCount - a.reportCount || newestFirst(a, b) : newestFirst);
      return picked.slice(0, limit);
    },
    async byUid(uid) {
      return [...comments.entries()].filter(([, c]) => c.uid === uid).map(([key, c]) => ({ ...c, id: key.split("/")[1], slug: key.split("/")[0] }));
    },
    async likesByUid(uid) {
      return [...likes.entries()].filter(([, l]) => l.uid === uid).map(([key, l]) => ({ slug: key.split("/")[0], id: key.split("/")[1], ...l }));
    },
    async reportsByUid(uid) {
      return [...reports.entries()].filter(([, r]) => r.uid === uid).map(([key, r]) => ({ slug: key.split("/")[0], id: key.split("/")[1], ...r }));
    },
    async addNotices(uids, notice) {
      for (const uid of uids) {
        const list = notices.get(uid) ?? [];
        list.push({ ...notice, id: `n${++seq}` });
        notices.set(uid, list);
      }
    },
    async listNotices(uid, since) {
      return (notices.get(uid) ?? []).filter((n) => !since || n.at > since).sort((a, b) => (a.at < b.at ? -1 : 1));
    },
    async purgeNotices(before) {
      let n = 0;
      for (const [uid, list] of notices) {
        const kept = list.filter((notice) => notice.at >= before);
        n += list.length - kept.length;
        notices.set(uid, kept);
      }
      return n;
    },
    async deleteNotices(uid) {
      notices.delete(uid);
    },
    async getModeration() {
      return { banned: [...moderation.banned], suspicious: [...moderation.suspicious] };
    },
    async setModeration(lists) {
      moderation = { banned: [...lists.banned], suspicious: [...lists.suspicious] };
    },
  };
}

/**
 * An in-memory thread_store.js over a memoryMemberStore (for the rate
 * counter): threads by id, messages by "thread/id", blocks by uid.
 */
export function memoryThreadStore(members = memoryMemberStore()) {
  const threads = new Map();
  const messages = new Map();
  const blocks = new Map(); // uid -> Set(other)
  let seq = 0;
  const ofThread = (id) =>
    [...messages.entries()]
      .filter(([key]) => key.startsWith(`${id}/`))
      .map(([key, m]) => ({ ...m, id: key.split("/")[1] }));
  const setPath = (doc, path, value) => {
    const parts = path.split(".");
    let at = doc;
    for (const part of parts.slice(0, -1)) at = at[part] ??= {};
    at[parts.at(-1)] = value;
  };
  return {
    threads,
    messages,
    blocks,
    threadId,
    async get(id) {
      const t = threads.get(id);
      return t ? { ...t, id } : null;
    },
    async listForMember(uid) {
      return [...threads.entries()]
        .filter(([, t]) => (t.members ?? []).includes(uid))
        .map(([id, t]) => ({ ...t, id }))
        .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
    },
    async create(id, doc) {
      threads.set(id, { ...doc });
    },
    async update(id, fields) {
      const t = threads.get(id);
      for (const [k, v] of Object.entries(fields)) setPath(t, k, v);
    },
    async messages(id, { before = null, limit = 50 } = {}) {
      return ofThread(id)
        .filter((m) => !before || m.createdAt < before)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, limit);
    },
    async conversationMessages(id, conversation, { limit = 10 } = {}) {
      return ofThread(id)
        .filter((m) => (m.conversation ?? 1) === conversation)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, limit)
        .reverse();
    },
    async conversationCount(id, conversation) {
      return ofThread(id).filter((m) => (m.conversation ?? 1) === conversation).length;
    },
    async message(id, mid) {
      const m = messages.get(`${id}/${mid}`);
      return m ? { ...m, id: mid } : null;
    },
    async transact(id, { uid } = {}, decide) {
      const t = threads.get(id);
      const member = uid ? await members.get(uid) : null;
      const out = await decide({ thread: t ? { ...t, id } : null, member });
      if (out.thread) {
        const { create, id: _id, ...fields } = out.thread;
        if (create) threads.set(id, fields);
        else for (const [k, v] of Object.entries(fields)) setPath(threads.get(id), k, v);
      }
      if (out.message) {
        const { id: mid, ...fields } = out.message;
        messages.set(`${id}/${mid}`, fields);
      }
      if (out.updateMessage) Object.assign(messages.get(`${id}/${out.updateMessage.id}`), out.updateMessage.fields);
      if (out.member && uid) await members.set(uid, out.member);
      return out.result;
    },
    newId() {
      return `m${++seq}`;
    },
    async setUsername(uid, username) {
      let n = 0;
      for (const t of threads.values()) {
        if ((t.members ?? []).includes(uid)) {
          t.usernames = { ...(t.usernames ?? {}), [uid]: username };
          n += 1;
        }
      }
      return n;
    },
    async blocks(uid) {
      return [...(blocks.get(uid) ?? [])];
    },
    async setBlock(uid, other, on) {
      const set = blocks.get(uid) ?? new Set();
      if (on) set.add(other);
      else set.delete(other);
      blocks.set(uid, set);
    },
    async messagesByUid(uid) {
      return [...messages.entries()].filter(([, m]) => m.uid === uid).map(([key, m]) => ({ ...m, id: key.split("/")[1], thread: key.split("/")[0] }));
    },
    async replaceWithMarker(id, remaining) {
      for (const [key] of [...messages.entries()].filter(([k]) => k.startsWith(`${id}/`))) messages.delete(key);
      const at = new Date().toISOString();
      threads.set(id, { members: [remaining], gone: true, goneAt: at, lastMessageAt: at });
    },
    async deleteThread(id) {
      for (const [key] of [...messages.entries()].filter(([k]) => k.startsWith(`${id}/`))) messages.delete(key);
      threads.delete(id);
    },
    async deleteBlocks(uid) {
      blocks.delete(uid);
    },
    async reported({ limit = 50 } = {}) {
      return [...threads.entries()]
        .filter(([, t]) => t.reportedAt)
        .map(([id, t]) => ({ ...t, id }))
        .sort((a, b) => (a.reportedAt < b.reportedAt ? 1 : -1))
        .slice(0, limit);
    },
  };
}
