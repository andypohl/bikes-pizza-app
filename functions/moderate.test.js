import assert from "node:assert/strict";
import { test } from "node:test";

import { BLOCKED_MESSAGE, MODERATE_URL, evaluate, matchWords, moderateText, normalizeWords, screenText } from "./moderate.js";

test("normalizeWords lowercases, trims, collapses spaces and drops duplicates and junk", () => {
  assert.deepEqual(normalizeWords([" Foo ", "foo", "Bar  baz", "", 3, null]), ["foo", "bar baz"]);
  assert.deepEqual(normalizeWords("nope"), []);
});

test("matchWords matches whole words and phrases, case-insensitively", () => {
  const words = ["darn", "hot take", "élan"];
  assert.deepEqual(matchWords("Well DARN, that's a hot   take!", words), ["darn", "hot take"]);
  assert.deepEqual(matchWords("darned hotter takes", words), []);
  assert.deepEqual(matchWords("full of Élan.", words), ["élan"]);
  assert.deepEqual(matchWords("a.b darn", ["a.b"]), ["a.b"]);
});

test("evaluate blocks, holds or passes on the thresholds", () => {
  assert.deepEqual(evaluate({ Toxic: 0.81 }), { verdict: "block", reasons: ["Toxic"] });
  assert.deepEqual(evaluate({ Insult: 0.5, Politics: 0.2 }), { verdict: "hold", reasons: ["Insult"] });
  assert.deepEqual(evaluate({ Politics: 0.5 }), { verdict: "hold", reasons: ["Politics"] });
  assert.deepEqual(evaluate({ Toxic: 0.49, Politics: 0.49, Finance: 0.99 }), { verdict: "ok", reasons: [] });
  assert.deepEqual(evaluate({}), { verdict: "ok", reasons: [] });
});

test("moderateText posts the document and reads the scores and language", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      json: async () => ({
        moderationCategories: [
          { name: "Toxic", confidence: 0.12345 },
          { name: "Politics", confidence: 0.7 },
          { name: "Finance" },
        ],
        languageCode: "en",
        languageSupported: true,
      }),
    };
  };
  const out = await moderateText("some text", { getToken: async () => "tok", fetchImpl });
  assert.deepEqual(out, { language: "en", scores: { Toxic: 0.123, Politics: 0.7, Finance: 0 } });
  assert.equal(calls[0].url, MODERATE_URL);
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(calls[0].init.body), { document: { type: "PLAIN_TEXT", content: "some text" } });
});

test("moderateText throws on an API error", async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "API not enabled" } }) });
  await assert.rejects(moderateText("x", { getToken: async () => "t", fetchImpl }), /Natural Language 403: API not enabled/);
});

const moderation = { banned: ["slur"], suspicious: ["election"] };

test("screenText blocks banned words before calling the API", async () => {
  let called = false;
  const out = await screenText("a SLUR here", {
    moderation,
    moderate: async () => {
      called = true;
      return { language: "en", scores: {} };
    },
  });
  assert.equal(out.verdict, "block");
  assert.deepEqual(out.screening.matched, ["slur"]);
  assert.equal(called, false);
  assert.equal(typeof BLOCKED_MESSAGE, "string");
});

test("screenText blocks on high scores, holds on middling ones or suspicious words, else passes", async () => {
  const with_ = (scores) => screenText("text", { moderation, moderate: async () => ({ language: "en", scores }) });
  assert.equal((await with_({ Profanity: 0.9 })).verdict, "block");
  const held = await with_({ Politics: 0.6 });
  assert.deepEqual([held.verdict, held.hold, held.screening.reasons], ["hold", "screen", ["Politics"]]);
  const ok = await with_({ Toxic: 0.1 });
  assert.deepEqual([ok.verdict, ok.hold, ok.screening.language], ["ok", null, "en"]);
  const words = await screenText("the election", { moderation, moderate: async () => ({ language: "en", scores: {} }) });
  assert.deepEqual([words.verdict, words.hold, words.screening.matched], ["hold", "words", ["election"]]);
});

test("screenText holds the comment when the API fails or is missing", async () => {
  const logged = [];
  const failed = await screenText("text", { moderation, moderate: async () => { throw new Error("down"); }, log: (m, d) => logged.push([m, d]) });
  assert.deepEqual([failed.verdict, failed.hold, failed.screening.error], ["hold", "screen", "down"]);
  assert.equal(logged.length, 1);
  const missing = await screenText("text", { moderation });
  assert.deepEqual([missing.verdict, missing.hold], ["hold", "screen"]);
});
