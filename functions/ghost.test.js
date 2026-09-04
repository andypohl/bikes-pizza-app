import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";

import { GhostAdminClient, GhostApiError } from "./ghost.js";

const KEY = "abc123:00112233445566778899aabbccddeeff";
const URL_ = "https://example.ghost.io/";

/** Fake fetch that records calls and replies from a queue of responses. */
function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift() ?? { status: 200, body: {} };
    return {
      ok: next.status < 400,
      status: next.status,
      text: async () => (typeof next.body === "string" ? next.body : JSON.stringify(next.body)),
    };
  };
  return { fetchImpl, calls };
}

test("rejects a malformed key", () => {
  assert.throws(() => new GhostAdminClient({ url: URL_, key: "nope" }), /id:secret/);
});

test("signs an HS256 token with kid and /admin/ audience", () => {
  const client = new GhostAdminClient({ url: URL_, key: KEY });
  const decoded = jwt.verify(client.token(), Buffer.from("00112233445566778899aabbccddeeff", "hex"), {
    audience: "/admin/",
    complete: true,
  });
  assert.equal(decoded.header.kid, "abc123");
  assert.equal(decoded.header.alg, "HS256");
});

test("findMember filters by escaped email and strips the trailing slash", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { status: 200, body: { members: [{ id: "m1", email: "a@b.c" }] } },
  ]);
  const client = new GhostAdminClient({ url: URL_, key: KEY, fetch: fetchImpl });
  const member = await client.findMember("o'neil@b.c");
  assert.equal(member.id, "m1");
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, "https://example.ghost.io/ghost/api/admin/members/");
  assert.equal(url.searchParams.get("filter"), "email:'o\\'neil@b.c'");
  assert.match(calls[0].init.headers.Authorization, /^Ghost eyJ/);
});

test("findOrCreateMember creates when missing and reports it", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { status: 200, body: { members: [] } },
    { status: 201, body: { members: [{ id: "new", email: "a@b.c" }] } },
  ]);
  const client = new GhostAdminClient({ url: URL_, key: KEY, fetch: fetchImpl });
  const member = await client.findOrCreateMember({ email: "a@b.c", name: "Ada" });
  assert.deepEqual(member, { id: "new", email: "a@b.c", created: true });
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    members: [{ email: "a@b.c", name: "Ada" }],
  });
});

test("findOrCreateMember returns the existing member without creating", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { status: 200, body: { members: [{ id: "m1", email: "a@b.c" }] } },
  ]);
  const client = new GhostAdminClient({ url: URL_, key: KEY, fetch: fetchImpl });
  const member = await client.findOrCreateMember({ email: "a@b.c" });
  assert.equal(member.created, false);
  assert.equal(calls.length, 1);
});

test("signInUrl returns Ghost's URL and appends a same-origin redirect", async () => {
  const signin = "https://www.example.com/members/?token=abc&action=signin";
  const { fetchImpl } = fakeFetch([
    { status: 200, body: { member_signin_urls: [{ member_id: "m1", url: signin }] } },
    { status: 200, body: { member_signin_urls: [{ member_id: "m1", url: signin }] } },
  ]);
  const client = new GhostAdminClient({ url: URL_, key: KEY, fetch: fetchImpl });
  assert.equal(await client.signInUrl("m1"), signin);
  const withRedirect = new URL(await client.signInUrl("m1", { redirectTo: "/account/" }));
  assert.equal(withRedirect.searchParams.get("r"), "https://www.example.com/account/");
});

test("signInUrl refuses a redirect to another origin", async () => {
  const signin = "https://www.example.com/members/?token=abc&action=signin";
  const { fetchImpl } = fakeFetch([
    { status: 200, body: { member_signin_urls: [{ member_id: "m1", url: signin }] } },
  ]);
  const client = new GhostAdminClient({ url: URL_, key: KEY, fetch: fetchImpl });
  await assert.rejects(
    client.signInUrl("m1", { redirectTo: "https://evil.example/" }),
    (e) => e instanceof GhostApiError && e.type === "ValidationError",
  );
});

test("surfaces Ghost error messages", async () => {
  const { fetchImpl } = fakeFetch([
    { status: 422, body: { errors: [{ message: "Bad email", type: "ValidationError" }] } },
  ]);
  const client = new GhostAdminClient({ url: URL_, key: KEY, fetch: fetchImpl });
  await assert.rejects(client.findMember("x"), (e) => e.message === "Bad email" && e.status === 422);
});

test("getMember asks for newsletters and treats 404 as missing", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { status: 200, body: { members: [{ id: "m1", email: "a@b.c", newsletters: [{ id: "n1" }] }] } },
    { status: 404, body: { errors: [{ message: "Member not found.", type: "NotFoundError" }] } },
  ]);
  const client = new GhostAdminClient({ url: URL_, key: KEY, fetch: fetchImpl });
  const member = await client.getMember("m1");
  assert.deepEqual(member.newsletters, [{ id: "n1" }]);
  assert.equal(new URL(calls[0].url).searchParams.get("include"), "newsletters");
  assert.equal(await client.getMember("gone"), null);
});

test("updateMember sends only the given fields, with newsletters as id objects", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { status: 200, body: { members: [{ id: "m1", name: "Ada", newsletters: [] }] } },
    { status: 200, body: { members: [{ id: "m1", name: "Ada", newsletters: [{ id: "n1" }] }] } },
  ]);
  const client = new GhostAdminClient({ url: URL_, key: KEY, fetch: fetchImpl });
  await client.updateMember("m1", { name: "Ada" });
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(new URL(calls[0].url).pathname, "/ghost/api/admin/members/m1/");
  assert.deepEqual(JSON.parse(calls[0].init.body), { members: [{ name: "Ada" }] });

  const updated = await client.updateMember("m1", { newsletters: ["n1"] });
  assert.deepEqual(JSON.parse(calls[1].init.body), { members: [{ newsletters: [{ id: "n1" }] }] });
  assert.deepEqual(updated.newsletters, [{ id: "n1" }]);
});

test("listNewsletters returns only active newsletters", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { status: 200, body: { newsletters: [{ id: "n1", name: "Weekly" }] } },
  ]);
  const client = new GhostAdminClient({ url: URL_, key: KEY, fetch: fetchImpl });
  assert.deepEqual(await client.listNewsletters(), [{ id: "n1", name: "Weekly" }]);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/ghost/api/admin/newsletters/");
  assert.equal(url.searchParams.get("filter"), "status:active");
});
