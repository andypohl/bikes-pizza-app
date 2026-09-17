import assert from "node:assert/strict";
import { test } from "node:test";

import { ValidationError } from "./account.js";
import { AppError } from "./errors.js";
import { memoryPostStore } from "./fakes.js";
import { postDocument } from "./post.js";
import { NAMES_SHOWN, applyDeltas, countDeltas, getReactions, palettesFor, publicCounts, setReactions, validatePicks, whoPicked } from "./reactions.js";

const pizza = postDocument({ slug: "detroit-slice", feed: "pizza", title: "Detroit slice", publishedAt: "2026-09-01T12:00:00.000Z", body: "Good." });
const bike = postDocument({ slug: "gt-outpost", feed: "bikes", title: "GT Outpost", publishedAt: "2026-09-01T12:00:00.000Z", body: "Fast." });
const news = postDocument({ slug: "welcome", feed: "news", title: "Welcome", publishedAt: "2026-09-02T12:00:00.000Z", body: "Hi." });

async function seeded() {
  const posts = memoryPostStore();
  for (const doc of [pizza, bike, news]) await posts.create(doc.slug, doc);
  return posts;
}

const ada = { uid: "u1", email: "ada@example.com", admin: false };
const bob = { uid: "u2", email: "bob@example.com", admin: false };
const usernames = { u1: "ada_bikes", u2: "" };
const members = { get: async (uid) => ({ username: usernames[uid] ?? "" }) };
const inOrder = () => 0; // a "random" that keeps the shuffle's order

test("the contract gives pizza and bikes their palettes and news none", () => {
  assert.deepEqual(
    palettesFor("pizza").map((p) => [p.key, p.pick]),
    [
      ["had", "one"],
      ["fantastic", "one"],
    ],
  );
  assert.deepEqual(
    palettesFor("bikes").map((p) => [p.key, p.pick]),
    [
      ["looks", "one"],
      ["favorite", "one"],
    ],
  );
  assert.deepEqual(palettesFor("news"), []);
});

test("picks are checked against the feed's palettes", () => {
  assert.deepEqual(validatePicks("pizza", undefined), {});
  assert.deepEqual(validatePicks("pizza", { had: ["yes"], fantastic: ["cheese", "cheese"] }), { had: ["yes"], fantastic: ["cheese"] });
  assert.deepEqual(validatePicks("pizza", { had: "no", fantastic: [] }), { had: ["no"] }, "a string is one pick; an empty list is no answer");
  assert.deepEqual(validatePicks("bikes", { favorite: ["gears"], looks: null }), { favorite: ["gears"] });
  assert.throws(() => validatePicks("pizza", { looks: ["fast"] }), (e) => e instanceof ValidationError && /Unknown reaction "looks"/.test(e.message));
  assert.throws(() => validatePicks("pizza", { had: ["maybe"] }), (e) => e instanceof ValidationError && /Unknown "had" option/.test(e.message));
  assert.throws(() => validatePicks("pizza", { had: ["yes", "no"] }), (e) => e instanceof ValidationError && /Pick one/.test(e.message));
  assert.throws(() => validatePicks("pizza", { fantastic: ["cheese", "sauce"] }), (e) => e instanceof ValidationError && /Pick one/.test(e.message));
  assert.throws(() => validatePicks("pizza", { had: 3 }), ValidationError);
  assert.throws(() => validatePicks("pizza", ["yes"]), ValidationError);
});

test("deltas move only what changed and tallies never go negative", () => {
  assert.deepEqual(countDeltas({}, { had: ["yes"] }), { "had.yes": 1 });
  assert.deepEqual(countDeltas({ had: ["yes"], fantastic: ["cheese"] }, { had: ["no"], fantastic: ["price"] }), {
    "had.yes": -1,
    "had.no": 1,
    "fantastic.cheese": -1,
    "fantastic.price": 1,
  });
  // A palette that takes several picks moves each one (none do yet).
  assert.deepEqual(countDeltas({ fantastic: ["cheese", "sauce"] }, { fantastic: ["sauce", "price"] }), { "fantastic.cheese": -1, "fantastic.price": 1 });
  assert.deepEqual(countDeltas({ had: ["yes"] }, { had: ["yes"] }), {});
  assert.deepEqual(applyDeltas({ had: { yes: 1 } }, { "had.yes": -1, "had.no": 1 }), { had: { yes: 0, no: 1 } });
  assert.deepEqual(applyDeltas(undefined, { "had.yes": -1 }), { had: { yes: 0 } });
});

test("public counts list every option of the feed's palettes, zero-filled, and drop retired ones", () => {
  const counts = publicCounts({ feed: "pizza", reactions: { had: { yes: 4, maybe: 2 }, retired: { x: 1 } } });
  assert.deepEqual(counts, {
    had: { yes: 4, no: 0 },
    fantastic: { crust: 0, cheese: 0, sauce: 0, toppings: 0, price: 0 },
  });
});

test("members react, change their mind, and see the tallies, their own picks and who picked what", async () => {
  const posts = await seeded();
  const deps = { posts, members, random: inOrder };
  const first = await setReactions(pizza.slug, { picks: { had: ["yes"], fantastic: ["cheese"] } }, ada, deps);
  assert.deepEqual(first.mine, { had: ["yes"], fantastic: ["cheese"] });
  assert.equal(first.counts.had.yes, 1);
  assert.equal(first.counts.fantastic.cheese, 1);
  assert.deepEqual(first.who.had, { yes: { names: ["ada_bikes"], more: 0 }, no: { names: [], more: 0 } });

  // Bob has no username yet: he counts but is not named.
  const second = await setReactions(pizza.slug, { picks: { had: "no", fantastic: ["cheese"] } }, bob, deps);
  assert.deepEqual(second.counts.had, { yes: 1, no: 1 });
  assert.equal(second.counts.fantastic.cheese, 2);
  assert.deepEqual(second.who.had.no, { names: [], more: 1 });
  assert.deepEqual(second.who.fantastic.cheese, { names: ["ada_bikes"], more: 1 });

  // Ada changes her mind: her earlier picks come off the tallies.
  const changed = await setReactions(pizza.slug, { picks: { had: ["no"] } }, ada, deps);
  assert.deepEqual(changed.mine, { had: ["no"] });
  assert.deepEqual(changed.counts.had, { yes: 0, no: 2 });
  assert.deepEqual(changed.counts.fantastic, { crust: 0, cheese: 1, sauce: 0, toppings: 0, price: 0 });
  assert.deepEqual(changed.who.had.no, { names: ["ada_bikes"], more: 1 });
  assert.deepEqual(changed.who.fantastic.cheese, { names: [], more: 1 });

  const seen = await getReactions(pizza.slug, ada, deps);
  assert.deepEqual(seen, changed);
  const bobs = await getReactions(pizza.slug, bob, deps);
  assert.deepEqual(bobs.mine, { had: ["no"], fantastic: ["cheese"] });

  // The tallies sit on the post, where the app reads them with it; the
  // records carry the username, kept in step when it changes.
  assert.deepEqual((await posts.get(pizza.slug)).reactions, { had: { yes: 0, no: 2 }, fantastic: { cheese: 1 } });
  assert.deepEqual(
    (await posts.listReactions(pizza.slug)).map((r) => [r.uid, r.username]),
    [
      ["u1", "ada_bikes"],
      ["u2", ""],
    ],
  );
  await posts.setUsername("u2", "bob_pizza");
  const renamed = await getReactions(pizza.slug, ada, deps);
  assert.deepEqual([...renamed.who.had.no.names].sort(), ["ada_bikes", "bob_pizza"]);
});

test("a member who has not reacted sees empty picks and nobody named", async () => {
  const posts = await seeded();
  assert.deepEqual(await getReactions(bike.slug, ada, { posts }), {
    counts: { looks: { stylish: 0, comfortable: 0, fast: 0, rugged: 0 }, favorite: { wheels: 0, frame: 0, gears: 0, shifters: 0, brakes: 0, paint: 0, bars: 0, seat: 0, pedals: 0 } },
    mine: {},
    who: {
      looks: { stylish: { names: [], more: 0 }, comfortable: { names: [], more: 0 }, fast: { names: [], more: 0 }, rugged: { names: [], more: 0 } },
      favorite: Object.fromEntries(["wheels", "frame", "gears", "shifters", "brakes", "paint", "bars", "seat", "pedals"].map((v) => [v, { names: [], more: 0 }])),
    },
  });
});

test("an option names at most ten reactors, chosen at random, and counts the rest", () => {
  const records = Array.from({ length: 14 }, (_, i) => ({ uid: `u${i}`, username: i < 12 ? `member${i}` : "", picks: { had: ["yes"] } }));
  const { had } = whoPicked("pizza", records, { random: inOrder });
  assert.equal(had.yes.names.length, NAMES_SHOWN);
  assert.equal(had.yes.more, 4, "two named members past ten, plus two without a username");
  assert.deepEqual(had.no, { names: [], more: 0 });

  // Another random source names another ten.
  let seed = 7;
  const other = whoPicked("pizza", records, { random: () => (seed = (seed * 16807) % 2147483647) / 2147483647 });
  assert.equal(other.had.yes.names.length, NAMES_SHOWN);
  assert.notDeepEqual(other.had.yes.names, had.yes.names);
  assert.equal(new Set(other.had.yes.names).size, NAMES_SHOWN, "no name twice");
});

test("news posts, removed posts and unknown ids take no reactions", async () => {
  const posts = await seeded();
  await assert.rejects(setReactions(news.slug, { picks: {} }, ada, { posts }), (e) => e instanceof AppError && e.code === "failed-precondition");
  await assert.rejects(getReactions("nope", ada, { posts }), (e) => e instanceof AppError && e.code === "not-found");
  await assert.rejects(getReactions("Bad Slug!", ada, { posts }), ValidationError);
  await posts.patch(bike.slug, { status: "removed" });
  await assert.rejects(setReactions(bike.slug, { picks: { looks: ["fast"] } }, ada, { posts }), (e) => e instanceof AppError && e.code === "not-found");
  await assert.rejects(setReactions(pizza.slug, { picks: { had: ["yes", "no"] } }, ada, { posts }), ValidationError);
});
