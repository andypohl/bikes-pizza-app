// Pure helpers for the account callables: shaping a member record into the
// profile the account page and the app show, and validating the changes
// they send back.

import { ValidationError } from "./errors.js";

export { ValidationError };

/** Usernames: 3–24 letters, digits or underscores. */
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,24}$/;
export const USERNAME_RULE = "3 to 24 letters, digits or underscores";

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

/**
 * The profile the account page shows: contact details plus every newsletter
 * the member could receive, flagged with whether they currently do. A
 * member without a username (signed up before usernames existed, or through
 * Google or Apple) gets an empty string; the clients ask them to choose one.
 *
 * @param {{email: string, username?: string|null, newsletters?: string[]}} member
 * @param {{id: string, name: string, description?: string|null}[]} newsletters
 */
export function profile(member, newsletters) {
  const subscribed = new Set(member.newsletters ?? []);
  return {
    email: member.email,
    username: member.username ?? "",
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
 * @returns {{username?: string, newsletters?: string[]}}
 */
export function validateUpdate(data, allowed) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ValidationError("Nothing to update.");
  }
  const patch = {};
  if ("username" in data) patch.username = validateUsername(data.username);
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
