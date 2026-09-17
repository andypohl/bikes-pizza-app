// Pure helpers for the account callables: shaping a member record into the
// profile the account page and the app show, and validating the changes
// they send back.

import { MEMBERS, USERNAME_PATTERN, USERNAME_RULE } from "./contract.js";
import { ValidationError } from "./errors.js";

export { USERNAME_PATTERN, USERNAME_RULE, ValidationError };

/**
 * The key a username is reserved under: usernames differ only by case are
 * the same name, so `Andy` and `andy` cannot both exist.
 */
export function usernameKey(username) {
  return username.toLowerCase();
}

/** The username as the member wrote it, or throws. */
export function validateUsername(value) {
  if (typeof value !== "string") throw new ValidationError("Username must be text.");
  const username = value.trim();
  if (!USERNAME_PATTERN.test(username)) {
    throw new ValidationError(`Username must be ${USERNAME_RULE}.`);
  }
  return username;
}

/** The location as the member wrote it, trimmed, or throws; empty clears it. */
export function validateLocation(value) {
  if (typeof value !== "string") throw new ValidationError("Location must be text.");
  const location = value.replace(/\s+/g, " ").trim();
  if (location.length > MEMBERS.locationMaxLength) {
    throw new ValidationError(`Location must be ${MEMBERS.locationMaxLength} characters or fewer.`);
  }
  return location;
}

/**
 * The profile the account page shows: contact details plus every newsletter
 * the member could receive, flagged with whether they currently do, the
 * location shown on their public profile and whether other members may
 * message them. A member without a username (signed up before usernames
 * existed, or through Google or Apple) gets an empty string; the clients
 * ask them to choose one.
 *
 * @param {{email: string, username?: string|null, newsletters?: string[], location?: string, messages?: boolean}} member
 * @param {{id: string, name: string, description?: string|null}[]} newsletters
 */
export function profile(member, newsletters) {
  const subscribed = new Set(member.newsletters ?? []);
  return {
    email: member.email,
    username: member.username ?? "",
    location: member.location ?? "",
    messages: member.messages !== false,
    newsletters: newsletters.map((n) => ({
      id: n.id,
      name: n.name,
      description: n.description ?? "",
      subscribed: subscribed.has(n.id),
    })),
  };
}

/**
 * Turns the account page's request into a patch for the member record,
 * refusing anything malformed. Newsletter IDs must be ones the member may
 * choose.
 *
 * @param {unknown} data  The callable's request data
 * @param {{id: string}[]} allowed  Newsletters the member may pick from
 * @returns {{username?: string, newsletters?: string[], location?: string, messages?: boolean}}
 */
export function validateUpdate(data, allowed) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ValidationError("Nothing to update.");
  }
  const patch = {};
  if ("username" in data) patch.username = validateUsername(data.username);
  if ("location" in data) patch.location = validateLocation(data.location);
  if ("messages" in data) {
    if (typeof data.messages !== "boolean") throw new ValidationError("messages must be true or false.");
    patch.messages = data.messages;
  }
  if ("newsletters" in data) {
    const ids = data.newsletters;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      throw new ValidationError("Newsletters must be a list of IDs.");
    }
    const allowedIds = new Set(allowed.map((n) => n.id));
    for (const id of ids) {
      if (!allowedIds.has(id)) throw new ValidationError("Unknown newsletter.");
    }
    patch.newsletters = [...new Set(ids)];
  }
  if (Object.keys(patch).length === 0) throw new ValidationError("Nothing to update.");
  return patch;
}

/**
 * The email sent to an account's address once the account is gone.
 * `requested` says whether the member asked for it themselves (from the
 * app or the account page) rather than an admin removing them.
 */
export function accountDeletedEmail({ email, siteUrl, requested = true, contact = "contact@bikes.pizza" }) {
  const site = siteUrl.replace(/\/+$/, "");
  const lines = [
    requested
      ? `Your bikes.pizza account for ${email} has been deleted, as you asked.`
      : `Your bikes.pizza account for ${email} has been deleted.`,
    "",
    "Your sign-in details, passkeys and authenticator enrollment are gone, and",
    "the address above is no longer attached to an account.",
    "",
    "Any photos you submitted that were published stay on the site as part of",
    "the archive. The privacy policy explains how to ask for one to be removed:",
    `${site}/privacy`,
    "",
    requested
      ? `If you did not ask for this, write to ${contact} straight away.`
      : `If you have a question about this, write to ${contact}.`,
    "",
    "bikes.pizza",
  ];
  return { subject: "Your bikes.pizza account has been deleted", text: lines.join("\n") };
}
