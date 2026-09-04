// Settings the website reads at page load, kept in Firestore at
// settings/site (server-only). Public to read, admin-only to change.

import { ValidationError } from "./account.js";

/** Every setting with its default; unknown keys are refused on write. */
export const DEFAULTS = Object.freeze({
  // Whether bikes.pizza shows the "Submit a bike or pizza" button and form.
  submitButton: true,
});

/** The stored settings merged over the defaults. */
export function withDefaults(stored) {
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (stored && typeof stored[key] === typeof DEFAULTS[key]) out[key] = stored[key];
  }
  return out;
}

/** Validates a change request: only known keys, each of the right type. */
export function validateSettings(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ValidationError("Nothing to update.");
  }
  const patch = {};
  for (const [key, value] of Object.entries(data)) {
    if (!(key in DEFAULTS)) throw new ValidationError(`Unknown setting "${key}".`);
    if (typeof value !== typeof DEFAULTS[key]) {
      throw new ValidationError(`Setting "${key}" must be ${typeof DEFAULTS[key]}.`);
    }
    patch[key] = value;
  }
  if (Object.keys(patch).length === 0) throw new ValidationError("Nothing to update.");
  return patch;
}

export async function getSettings({ store }) {
  return withDefaults(await store.get());
}

export async function updateSettings(data, admin, { store, log = () => {}, now = () => new Date() }) {
  const patch = validateSettings(data);
  await store.set({ ...patch, updatedAt: now(), updatedBy: admin.uid });
  log("site settings updated", { by: admin.uid, patch });
  return withDefaults(await store.get());
}

/** Firestore-backed store for the single settings document. */
export function firestoreSiteSettings(db) {
  const doc = () => db.collection("settings").doc("site");
  return {
    async get() {
      const snap = await doc().get();
      return snap.exists ? snap.data() : null;
    },
    async set(data) {
      await doc().set(data, { merge: true });
    },
  };
}
