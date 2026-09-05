// The `member` documents in Sanity: one per account that has published a
// post, holding the account id and the current username. Posts reference
// them, so the site shows the username at build time and a rename means
// patching one document rather than every post. Sanity generates the ids;
// the account id is a field, found by query.

const MEMBER_BY_UID = '*[_type == "member" && uid == $uid][0]{_id, username}';

/**
 * The member document for `uid`, created if missing, with the username
 * brought up to date. Returns its id.
 *
 * @param {import('./sanity.js').SanityClient} sanity
 * @param {{uid: string, username?: string}} member
 */
export async function ensureMember(sanity, { uid, username = "" }) {
  const existing = await sanity.query(MEMBER_BY_UID, { uid });
  if (existing) {
    if ((existing.username ?? "") !== username) await sanity.patchDocument(existing._id, { username });
    return existing._id;
  }
  return sanity.createDocument({ _type: "member", uid, username });
}

/**
 * Updates the member document's username after a rename. Members who have
 * never published have no document, and get one at their first post.
 * Returns whether a document was found.
 *
 * @param {import('./sanity.js').SanityClient} sanity
 * @param {{uid: string, username: string}} member
 */
export async function syncMemberUsername(sanity, { uid, username }) {
  const existing = await sanity.query(MEMBER_BY_UID, { uid });
  if (!existing) return false;
  if ((existing.username ?? "") !== username) await sanity.patchDocument(existing._id, { username });
  return true;
}
