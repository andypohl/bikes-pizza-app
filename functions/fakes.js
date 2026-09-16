// In-memory stand-ins for the persistence modules, shared by the tests.

/** An in-memory post_store.js: documents by slug, renditions by path. */
export function memoryPostStore() {
  const docs = new Map();
  const files = new Map();
  let clock = 0;
  const stamp = () => new Date(2026, 5, 1, 12, ++clock);
  const sorted = (list) => list.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  return {
    docs,
    files,
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
      return n;
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
