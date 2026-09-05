import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_REPOSITORY, EVENT_TYPE, requestRebuild } from "./rebuild.js";

function fakeFetch(status, calls = [], body = "") {
  return async (url, init) => {
    calls.push({ url, init });
    return { status, text: async () => body };
  };
}

test("requestRebuild sends a repository_dispatch with the environment", async () => {
  const calls = [];
  const logs = [];
  const ok = await requestRebuild(
    { environment: "development", reason: "posted abc" },
    { token: "ghp_x", fetchImpl: fakeFetch(204, calls), log: (m, d) => logs.push([m, d]) },
  );
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.github.com/repos/${DEFAULT_REPOSITORY}/dispatches`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer ghp_x");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    event_type: EVENT_TYPE,
    client_payload: { environment: "development", reason: "posted abc" },
  });
  assert.deepEqual(logs, [["rebuild requested", { environment: "development", reason: "posted abc" }]]);
});

test("requestRebuild honours the repository option", async () => {
  const calls = [];
  await requestRebuild({ repository: "someone/else", environment: "production" }, { token: "t", fetchImpl: fakeFetch(204, calls) });
  assert.equal(calls[0].url, "https://api.github.com/repos/someone/else/dispatches");
});

test("requestRebuild skips without a real token and never throws", async () => {
  const calls = [];
  const logs = [];
  for (const token of [undefined, "", "  ", "unset", "PLACEHOLDER"]) {
    assert.equal(await requestRebuild({ environment: "production" }, { token, fetchImpl: fakeFetch(204, calls), log: (m) => logs.push(m) }), false);
  }
  assert.equal(calls.length, 0);
  assert.ok(logs.every((m) => m === "rebuild skipped: GITHUB_DISPATCH_TOKEN not set"));
});

test("requestRebuild reports GitHub errors and network failures as false", async () => {
  const logs = [];
  const log = (m, d) => logs.push([m, d]);
  assert.equal(await requestRebuild({ environment: "production" }, { token: "t", fetchImpl: fakeFetch(404, [], '{"message":"Not Found"}'), log }), false);
  assert.equal(logs[0][0], "rebuild request failed");
  assert.equal(logs[0][1].status, 404);
  const boom = async () => { throw new Error("socket hang up"); };
  assert.equal(await requestRebuild({ environment: "production" }, { token: "t", fetchImpl: boom, log }), false);
  assert.equal(logs[1][1].message, "socket hang up");
});
