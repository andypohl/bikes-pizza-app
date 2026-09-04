import assert from "node:assert/strict";
import { test } from "node:test";

import { TIME_ZONE, countdown, cronFor, formatClock, formatCountdown, nextSlot, zonedToUtc } from "./schedule.js";

test("cronFor lists each feed's hours", () => {
  assert.equal(cronFor("bikes"), "0 8,12,16,20 * * *");
  assert.equal(cronFor("pizza"), "0 9,13,17,21 * * *");
});

test("zonedToUtc follows Central daylight saving", () => {
  // CST (UTC-6) in January, CDT (UTC-5) in July.
  assert.equal(zonedToUtc({ year: 2026, month: 1, day: 15, hour: 8 }, TIME_ZONE).toISOString(), "2026-01-15T14:00:00.000Z");
  assert.equal(zonedToUtc({ year: 2026, month: 7, day: 15, hour: 8 }, TIME_ZONE).toISOString(), "2026-07-15T13:00:00.000Z");
  // Day overflow rolls into the next month.
  assert.equal(zonedToUtc({ year: 2026, month: 1, day: 32, hour: 0 }, TIME_ZONE).toISOString(), "2026-02-01T06:00:00.000Z");
});

test("nextSlot picks the next hour today, or the first one tomorrow", () => {
  // 10:30 CDT on 4 Sep 2026 = 15:30Z; bikes next post at 12:00 CDT = 17:00Z.
  const midMorning = new Date("2026-09-04T15:30:00Z");
  assert.equal(nextSlot("bikes", midMorning).toISOString(), "2026-09-04T17:00:00.000Z");
  assert.equal(nextSlot("pizza", midMorning).toISOString(), "2026-09-04T18:00:00.000Z");
  // Exactly on a slot: that slot has passed.
  assert.equal(nextSlot("bikes", new Date("2026-09-04T17:00:00Z")).toISOString(), "2026-09-04T21:00:00.000Z");
  // After the last slot of the day: first slot tomorrow.
  const lateNight = new Date("2026-09-05T03:30:00Z"); // 22:30 CDT on 4 Sep
  assert.equal(nextSlot("bikes", lateNight).toISOString(), "2026-09-05T13:00:00.000Z");
  assert.equal(nextSlot("pizza", lateNight).toISOString(), "2026-09-05T14:00:00.000Z");
  // Across the November fall-back: 8am CST is 14:00Z the day after clocks change.
  const beforeChange = new Date("2026-11-01T02:00:00Z"); // 21:00 CDT 31 Oct
  assert.equal(nextSlot("bikes", beforeChange).toISOString(), "2026-11-01T14:00:00.000Z");
  assert.throws(() => nextSlot("blog"));
});

test("countdown formats hours, minutes and seconds", () => {
  assert.equal(formatCountdown((6 * 3600 + 32 * 60 + 14) * 1000 + 330), "6h 32m 14s");
  assert.equal(formatCountdown((32 * 60 + 14) * 1000), "32m 14s");
  assert.equal(formatCountdown(14 * 1000), "14s");
  assert.equal(formatCountdown(0), "0s");
  assert.equal(formatCountdown(-5000), "0s");
  assert.equal(formatClock((6 * 3600 + 32 * 60 + 14) * 1000 + 330), "06:32:14");
  const c = countdown("pizza", new Date("2026-09-04T15:30:00Z"));
  assert.deepEqual(c, { nextPostAt: "2026-09-04T18:00:00.000Z", seconds: 9000, countdown: "2h 30m 0s", clock: "02:30:00" });
});
