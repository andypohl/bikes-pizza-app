// Posting schedule for the queues: the wall-clock hours, in Central Time,
// at which each feed's queue posts its oldest entry. Pure; no Firebase.

export const TIME_ZONE = "America/Chicago"; // CST/CDT, following daylight saving

/** Hours of the day (24h, in TIME_ZONE) each feed posts at. */
export const SCHEDULES = {
  bikes: [8, 12, 16, 20],
  pizza: [9, 13, 17, 21],
};

/** Cloud Scheduler cron for a feed, to be paired with TIME_ZONE. */
export function cronFor(feed) {
  return `0 ${SCHEDULES[feed].join(",")} * * *`;
}

const formatters = new Map();
function partsIn(date, timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      }),
    );
  }
  const parts = {};
  for (const { type, value } of formatters.get(timeZone).formatToParts(date)) {
    if (type !== "literal") parts[type] = Number(value);
  }
  return parts;
}

/** The instant at which the wall clock in `timeZone` reads the given time. */
export function zonedToUtc({ year, month, day, hour = 0, minute = 0 }, timeZone) {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = partsIn(new Date(guess), timeZone);
    const diff = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - wanted;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}

/** The next scheduled posting time for a feed, strictly after `now`. */
export function nextSlot(feed, now = new Date()) {
  const hours = SCHEDULES[feed];
  if (!hours) throw new Error(`No schedule for feed ${feed}`);
  const today = partsIn(now, TIME_ZONE);
  for (let offset = 0; offset <= 2; offset++) {
    for (const hour of hours) {
      const t = zonedToUtc({ year: today.year, month: today.month, day: today.day + offset, hour }, TIME_ZONE);
      if (t.getTime() > now.getTime()) return t;
    }
  }
  throw new Error("No upcoming slot"); // unreachable: every day has slots
}

const pad = (n) => String(n).padStart(2, "0");

function split(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return { hours: Math.floor(total / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60, total };
}

/** "6h 32m 14s", dropping leading zero units ("32m 14s", "14s"). */
export function formatCountdown(ms) {
  const { hours, minutes, seconds } = split(ms);
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (hours || minutes) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

/** "06:32:14". */
export function formatClock(ms) {
  const { hours, minutes, seconds } = split(ms);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** When the feed next posts, and how long that is from `now`. */
export function countdown(feed, now = new Date()) {
  const next = nextSlot(feed, now);
  const ms = next.getTime() - now.getTime();
  return {
    nextPostAt: next.toISOString(),
    seconds: Math.floor(ms / 1000),
    countdown: formatCountdown(ms),
    clock: formatClock(ms),
  };
}
