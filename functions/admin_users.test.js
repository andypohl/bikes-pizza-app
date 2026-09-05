import assert from "node:assert/strict";
import { test } from "node:test";

import { deleteUser, getUser, listUsers, updateUser } from "./admin_users.js";
import { AppError, ValidationError } from "./errors.js";

const NEWSLETTERS = [{ id: "news", name: "News", description: "Sometimes" }];

function notFound() {
  return Object.assign(new Error("no user"), { code: "auth/user-not-found" });
}

function fakes({ users, members = {}, posts = [], sanityMembers = [] } = {}) {
  const authUsers = new Map(users.map((u) => [u.uid, { providerData: [], metadata: {}, ...u }]));
  const records = new Map(Object.entries(members));
  const reservations = new Map();
  for (const [uid, m] of records) if (m.username) reservations.set(m.username.toLowerCase(), uid);
  const log = [];
  const docs = new Map(sanityMembers.map((m) => [m._id, { ...m }]));
  return {
    log,
    authUsers,
    records,
    reservations,
    docs,
    deps: {
      newsletters: NEWSLETTERS,
      siteUrl: "https://example.com/",
      log: (m, d) => log.push([m, d]),
      auth: {
        async listUsers(max, token) {
          const all = [...authUsers.values()];
          const start = token ? Number(token) : 0;
          const page = all.slice(start, start + max);
          return { users: page, pageToken: start + max < all.length ? String(start + max) : undefined };
        },
        async getUser(uid) {
          if (!authUsers.has(uid)) throw notFound();
          return authUsers.get(uid);
        },
        async updateUser(uid, props) {
          if (props.email && [...authUsers.values()].some((u) => u.uid !== uid && u.email === props.email)) {
            throw Object.assign(new Error("dup"), { code: "auth/email-already-exists" });
          }
          Object.assign(authUsers.get(uid), props);
        },
        async deleteUser(uid) {
          if (!authUsers.delete(uid)) throw notFound();
        },
      },
      members: {
        async get(uid) {
          return records.has(uid) ? { ...records.get(uid) } : null;
        },
        async set(uid, data) {
          records.set(uid, { ...(records.get(uid) ?? {}), ...data });
        },
        async list() {
          return new Map([...records].map(([k, v]) => [k, { ...v }]));
        },
        async setUsername(uid, username) {
          const key = username.toLowerCase();
          if (reservations.has(key) && reservations.get(key) !== uid) throw new AppError("already-exists", "That username is taken.");
          const previous = records.get(uid)?.username;
          if (previous) reservations.delete(previous.toLowerCase());
          reservations.set(key, uid);
          await this.set(uid, { username });
        },
        async delete(uid) {
          const previous = records.get(uid)?.username;
          if (previous) reservations.delete(previous.toLowerCase());
          records.delete(uid);
        },
      },
      sanity: {
        async query(groq, params = {}) {
          if (groq.includes('_type == "member"')) {
            const found = [...docs.values()].find((m) => m.uid === params.uid);
            return found ? { _id: found._id, username: found.username } : null;
          }
          return posts;
        },
        async patchDocument(id, set) {
          Object.assign(docs.get(id), set);
        },
      },
    },
  };
}

const USERS = [
  { uid: "u1", email: "ada@x.y", emailVerified: true, providerData: [{ providerId: "password" }], metadata: { creationTime: "Mon, 01 Sep 2026 10:00:00 GMT" } },
  { uid: "u2", email: "bob@x.y", emailVerified: true, providerData: [{ providerId: "google.com" }], metadata: { creationTime: "Tue, 02 Sep 2026 10:00:00 GMT" } },
  { uid: "u3", email: "cy@x.y", emailVerified: false, providerData: [{ providerId: "password" }, { providerId: "apple.com" }], metadata: { creationTime: "Wed, 03 Sep 2026 10:00:00 GMT" } },
];
const MEMBERS = {
  u1: { email: "ada@x.y", username: "ada", newsletters: ["news"] },
  u2: { email: "bob@x.y", username: "bob", newsletters: [] },
};
const POSTS = [
  { uid: "u2", title: "Newest", publishedAt: "2026-09-04T00:00:00Z", slug: "newest" },
  { uid: "u1", title: "Older", publishedAt: "2026-09-01T00:00:00Z", slug: "older" },
  { uid: "u1", title: "Oldest", publishedAt: "2026-08-01T00:00:00Z", slug: "oldest" },
];

test("listUsers orders by most recent post, then newest sign-up, and pages", async () => {
  const { deps } = fakes({ users: USERS, members: MEMBERS, posts: POSTS });
  const out = await listUsers({}, deps);
  assert.equal(out.total, 3);
  assert.equal(out.pages, 1);
  assert.deepEqual(out.users.map((u) => u.uid), ["u2", "u1", "u3"]);
  const [bob, ada, cy] = out.users;
  assert.equal(bob.postCount, 1);
  assert.equal(bob.latestPost.url, "https://example.com/post/newest/");
  assert.equal(bob.subscribed, false);
  assert.deepEqual(bob.providers, ["Google"]);
  assert.equal(ada.postCount, 2);
  assert.equal(ada.latestPost.title, "Older");
  assert.equal(ada.subscribed, true);
  assert.equal(cy.username, "");
  assert.equal(cy.postCount, 0);
  assert.deepEqual(cy.providers, ["Email", "Apple"]);

  const page2 = await listUsers({ page: "2", pageSize: "2" }, deps);
  assert.deepEqual(page2.users.map((u) => u.uid), ["u3"]);
  assert.equal(page2.pages, 2);
});

test("listUsers walks every Auth page", async () => {
  const many = Array.from({ length: 1500 }, (_, i) => ({ uid: `u${i}`, email: `${i}@x.y`, metadata: {} }));
  const { deps } = fakes({ users: many });
  assert.equal((await listUsers({ pageSize: "100" }, deps)).total, 1500);
});

test("getUser adds the newsletters and posts, and reports a missing user", async () => {
  const { deps } = fakes({ users: USERS, members: MEMBERS, posts: POSTS });
  const ada = await getUser("u1", deps);
  assert.deepEqual(ada.newsletters, [{ id: "news", name: "News", description: "Sometimes", subscribed: true }]);
  assert.deepEqual(ada.posts.map((p) => p.title), ["Older", "Oldest"]);
  assert.equal(ada.emailVerified, true);
  await assert.rejects(getUser("zz", deps), (e) => e instanceof AppError && e.code === "not-found");
});

test("updateUser changes email, username and newsletters, and mirrors the username to Sanity", async () => {
  const f = fakes({ users: USERS, members: MEMBERS, posts: POSTS, sanityMembers: [{ _id: "m1", uid: "u1", username: "ada" }] });
  const out = await updateUser("u1", { email: " ada2@x.y ", username: "Ada_L", newsletters: [] }, f.deps);
  assert.equal(out.email, "ada2@x.y");
  assert.equal(out.username, "Ada_L");
  assert.equal(out.subscribed, false);
  assert.equal(out.renamed, true);
  assert.equal(f.authUsers.get("u1").email, "ada2@x.y");
  assert.equal(f.records.get("u1").email, "ada2@x.y");
  assert.deepEqual([...f.reservations].sort(), [["ada_l", "u1"], ["bob", "u2"]]);
  assert.equal(f.docs.get("m1").username, "Ada_L");

  const same = await updateUser("u1", { newsletters: ["news"] }, f.deps);
  assert.equal(same.renamed, false);
  assert.equal(same.subscribed, true);
});

test("updateUser refuses bad input, taken usernames and duplicate emails", async () => {
  const { deps } = fakes({ users: USERS, members: MEMBERS });
  const isValidation = (e) => e instanceof ValidationError;
  await assert.rejects(updateUser("u1", {}, deps), isValidation);
  await assert.rejects(updateUser("u1", { email: "nope" }, deps), isValidation);
  await assert.rejects(updateUser("u1", { username: "" }, deps), isValidation);
  await assert.rejects(updateUser("u1", { newsletters: ["x"] }, deps), isValidation);
  await assert.rejects(updateUser("u1", { username: "BOB" }, deps), (e) => e instanceof AppError && e.code === "already-exists");
  await assert.rejects(updateUser("u1", { email: "bob@x.y" }, deps), (e) => e instanceof AppError && e.code === "failed-precondition");
  await assert.rejects(updateUser("zz", { username: "new" }, deps), (e) => e instanceof AppError && e.code === "not-found");
});

test("deleteUser removes the Auth user and the member record, freeing the username", async () => {
  const f = fakes({ users: USERS, members: MEMBERS });
  assert.deepEqual(await deleteUser("u1", f.deps), { deleted: "u1" });
  assert.equal(f.authUsers.has("u1"), false);
  assert.equal(f.records.has("u1"), false);
  assert.equal(f.reservations.has("ada"), false);
  await assert.rejects(deleteUser("u1", f.deps), (e) => e instanceof AppError && e.code === "not-found");
});
