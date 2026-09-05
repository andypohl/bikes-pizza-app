import assert from "node:assert/strict";
import { test } from "node:test";

import { ValidationError, profile, usernameKey, validateUpdate, validateUsername } from "./account.js";

const weekly = { id: "n1", name: "Weekly", description: "Every Friday" };
const extra = { id: "n2", name: "Extras", description: null };
const newsletters = [weekly, extra];

test("profile flags the newsletters the member receives", () => {
  const member = { email: "a@b.c", username: "ada", newsletters: ["n1"] };
  assert.deepEqual(profile(member, newsletters), {
    email: "a@b.c",
    username: "ada",
    newsletters: [
      { id: "n1", name: "Weekly", description: "Every Friday", subscribed: true },
      { id: "n2", name: "Extras", description: "", subscribed: false },
    ],
  });
});

test("profile shows an empty username until one is chosen", () => {
  assert.equal(profile({ email: "a@b.c", newsletters: [] }, newsletters).username, "");
});

test("validateUsername accepts letters, digits and underscores and trims", () => {
  assert.equal(validateUsername("  Ada_1 "), "Ada_1");
  assert.equal(usernameKey("Ada_1"), "ada_1");
  const isValidation = (e) => e instanceof ValidationError;
  assert.throws(() => validateUsername(42), isValidation);
  assert.throws(() => validateUsername("ab"), isValidation);
  assert.throws(() => validateUsername("a".repeat(25)), isValidation);
  assert.throws(() => validateUsername("ada lovelace"), isValidation);
  assert.throws(() => validateUsername("ada@b"), isValidation);
});

test("validateUpdate validates the username and de-duplicates newsletter IDs", () => {
  const patch = validateUpdate({ username: " ada ", newsletters: ["n1", "n1"] }, [weekly]);
  assert.deepEqual(patch, { username: "ada", newsletters: ["n1"] });
});

test("validateUpdate accepts either field on its own", () => {
  assert.deepEqual(validateUpdate({ username: "ada" }, [weekly]), { username: "ada" });
  assert.deepEqual(validateUpdate({ newsletters: [] }, [weekly]), { newsletters: [] });
});

test("validateUpdate rejects malformed or empty requests", () => {
  const isValidation = (e) => e instanceof ValidationError;
  assert.throws(() => validateUpdate(undefined, [weekly]), isValidation);
  assert.throws(() => validateUpdate({}, [weekly]), isValidation);
  assert.throws(() => validateUpdate({ username: 42 }, [weekly]), isValidation);
  assert.throws(() => validateUpdate({ username: "" }, [weekly]), isValidation);
  assert.throws(() => validateUpdate({ name: "Ada" }, [weekly]), isValidation);
  assert.throws(() => validateUpdate({ newsletters: "n1" }, [weekly]), isValidation);
  assert.throws(() => validateUpdate({ newsletters: [1] }, [weekly]), isValidation);
});

test("validateUpdate refuses newsletters the member may not choose", () => {
  assert.throws(
    () => validateUpdate({ newsletters: ["n2"] }, [weekly]),
    (e) => e instanceof ValidationError && /Unknown newsletter/.test(e.message),
  );
});
