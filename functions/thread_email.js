// The email that carries a conversation out of the app (docs/community-
// design.md, "Continuing by email"): the newest messages of the current
// conversation drawn as chat bubbles, the asker's on the right in the
// app's teal and the other member's on the left in gray, as real text in
// tables with inline styles so mail clients render them and the words
// can be selected and copied; a "Previous messages" link when the
// conversation is longer; and a plain-text part with one line per
// message. Pure: takes what to say and returns {subject, text, html}.

import { MEMBERS } from "./contract.js";
import { commentToText } from "./comment_text.js";

/** How many messages the email carries, from the contract. */
export const EMAILED_MESSAGES = MEMBERS.messages.emailedMessages;

const TEAL = "#2f6f6a";
const GRAY = "#ececec";
const INK = "#1f2323";
const MUTED = "#6b7473";

const escape = (text) =>
  String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "Sep 17, 2026, 2:03 PM" in the site's time zone. */
export function when(iso, timeZone = "America/Chicago") {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" });
}

/** One message as a bubble row: the asker's on the right, the other's on the left. */
function bubble(message, { mine, name, timeZone }) {
  const align = mine ? "right" : "left";
  const background = mine ? TEAL : GRAY;
  const color = mine ? "#ffffff" : INK;
  const body = message.deletedAt
    ? `<em style="color:${mine ? "#d9ecea" : MUTED}">Message deleted</em>`
    : message.html || escape(message.text ?? "");
  return `
<tr><td align="${align}" style="padding:4px 0;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:420px;">
    <tr><td style="background:${background};color:${color};padding:10px 14px;border-radius:18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.4;">${body}</td></tr>
    <tr><td align="${align}" style="padding:2px 6px 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:${MUTED};">${escape(name)} · ${escape(when(message.createdAt, timeZone))}</td></tr>
  </table>
</td></tr>`;
}

/**
 * The email. `messages` are the newest of the current conversation,
 * oldest first (at most EMAILED_MESSAGES); `total` is how many the
 * conversation has, so a longer one gets the "Previous messages" link
 * to `previousUrl`. `asker` and `agreer` are `{uid, username, email}`.
 */
export function conversationEmail({ messages, total, asker, agreer, previousUrl, siteUrl, timeZone = "America/Chicago" }) {
  const site = siteUrl.replace(/\/+$/, "");
  const nameOf = (uid) => (uid === asker.uid ? asker.username : agreer.username);
  const subject = `Your bikes.pizza conversation with ${asker.username}`;
  const intro = `${asker.username} asked to continue your bikes.pizza conversation by email, and you agreed. Replying to this email goes to ${asker.username} at ${asker.email}; they will see your address when you reply.`;
  const more = total > messages.length;

  const rows = messages
    .filter((m) => m.kind !== "event")
    .map((m) => bubble(m, { mine: m.uid === asker.uid, name: nameOf(m.uid), timeZone }))
    .join("");
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f7f7f5;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;">
  <tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:${INK};padding-bottom:16px;">${escape(intro)}</td></tr>
  ${more ? `<tr><td align="center" style="padding:0 0 12px;font-family:Helvetica,Arial,sans-serif;font-size:13px;"><a href="${escape(previousUrl)}" style="color:${TEAL};">Previous messages</a></td></tr>` : ""}
  ${rows}
  <tr><td style="padding-top:20px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${MUTED};">Sent by <a href="${escape(site)}/" style="color:${MUTED};">bikes.pizza</a> because both of you agreed to move this conversation to email. Neither of you can reach the other through the app's messages until one of you writes there again.</td></tr>
</table>
</body></html>`;

  const lines = [
    intro,
    "",
    ...(more ? [`Previous messages: ${previousUrl}`, ""] : []),
    ...messages
      .filter((m) => m.kind !== "event")
      .map((m) => `${nameOf(m.uid)} (${when(m.createdAt, timeZone)}): ${m.deletedAt ? "[Message deleted]" : commentToText(m.html) || m.text || ""}`),
    "",
    `Sent by bikes.pizza (${site}/) because both of you agreed to move this conversation to email.`,
  ];
  return { subject, text: lines.join("\n"), html };
}
