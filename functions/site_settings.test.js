import assert from "node:assert/strict";
import { test } from "node:test";

import { ValidationError } from "./account.js";
import { getSettings, updateSettings, validateSettings, withDefaults } from "./site_settings.js";

function memoryStore(initial = null) {
  let data = initial;
  return {
    async get() {
      return data ? { ...data } : null;
    },
    async set(patch) {
      data = { ...(data ?? {}), ...patch };
    },
  };
}

const admin = { uid: "a1" };

test("withDefaults fills in missing or malformed values", () => {
  assert.deepEqual(withDefaults(null), { submitButton: true });
  assert.deepEqual(withDefaults({ submitButton: false, other: 1 }), { submitButton: false });
  assert.deepEqual(withDefaults({ submitButton: "no" }), { submitButton: true });
});

test("validateSettings accepts known boolean settings only", () => {
  assert.deepEqual(validateSettings({ submitButton: false }), { submitButton: false });
  const isValidation = (e) => e instanceof ValidationError;
  assert.throws(() => validateSettings({}), isValidation);
  assert.throws(() => validateSettings({ submitButton: "off" }), isValidation);
  assert.throws(() => validateSettings({ banner: true }), isValidation);
  assert.throws(() => validateSettings([true]), isValidation);
});

test("updateSettings stores the change and returns the full settings", async () => {
  const store = memoryStore();
  const now = () => new Date("2026-09-04T12:00:00Z");
  assert.deepEqual(await getSettings({ store }), { submitButton: true });
  const updated = await updateSettings({ submitButton: false }, admin, { store, now });
  assert.deepEqual(updated, { submitButton: false });
  assert.deepEqual(await getSettings({ store }), { submitButton: false });
  assert.equal((await store.get()).updatedBy, "a1");
});
