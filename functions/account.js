// Pure helpers for the account callables: shaping a member record into the
// profile the account page and the app show, and validating the changes
// they send back.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

const MAX_NAME_LENGTH = 191;

/**
 * The profile the account page shows: contact details plus every newsletter
 * the member could receive, flagged with whether they currently do.
 *
 * @param {{email: string, name?: string|null, newsletters?: string[]}} member
 * @param {{id: string, name: string, description?: string|null}[]} newsletters
 */
export function profile(member, newsletters) {
  const subscribed = new Set(member.newsletters ?? []);
  return {
    email: member.email,
    name: member.name ?? "",
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
 * @returns {{name?: string, newsletters?: string[]}}
 */
export function validateUpdate(data, allowed) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ValidationError("Nothing to update.");
  }
  const patch = {};
  if ("name" in data) {
    if (typeof data.name !== "string") throw new ValidationError("Name must be text.");
    const name = data.name.trim();
    if (name.length > MAX_NAME_LENGTH) {
      throw new ValidationError(`Name must be ${MAX_NAME_LENGTH} characters or fewer.`);
    }
    patch.name = name;
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
