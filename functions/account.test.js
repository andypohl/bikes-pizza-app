import assert from "node:assert/strict";
import { test } from "node:test";

import { ValidationError, profile, validateUpdate } from "./account.js";

const weekly = { id: "n1", name: "Weekly", description: "Every Friday" };
const extra = { id: "n2", name: "Extras", description: null };
const newsletters = [weekly, extra];

test("profile flags the newsletters the member receives", () => {
  const member = { email: "a@b.c", name: null, newsletters: ["n1"] };
  assert.deepEqual(profile(member, newsletters), {
    email: "a@b.c",
    name: "",
    newsletters: [
      { id: "n1", name: "Weekly", description: "Every Friday", subscribed: true },
      { id: "n2", name: "Extras", description: "", subscribed: false },
    ],
  });
});

test("validateUpdate trims the name and de-duplicates newsletter IDs", () => {
  const patch = validateUpdate({ name: "  Ada ", newsletters: ["n1", "n1"] }, [weekly]);
  assert.deepEqual(patch, { name: "Ada", newsletters: ["n1"] });
});

test("validateUpdate accepts either field on its own", () => {
  assert.deepEqual(validateUpdate({ name: "Ada" }, [weekly]), { name: "Ada" });
  assert.deepEqual(validateUpdate({ newsletters: [] }, [weekly]), { newsletters: [] });
});

test("validateUpdate rejects malformed or empty requests", () => {
  const isValidation = (e) => e instanceof ValidationError;
  assert.throws(() => validateUpdate(undefined, [weekly]), isValidation);
  assert.throws(() => validateUpdate({}, [weekly]), isValidation);
  assert.throws(() => validateUpdate({ name: 42 }, [weekly]), isValidation);
  assert.throws(() => validateUpdate({ name: "x".repeat(192) }, [weekly]), isValidation);
  assert.throws(() => validateUpdate({ newsletters: "n1" }, [weekly]), isValidation);
  assert.throws(() => validateUpdate({ newsletters: [1] }, [weekly]), isValidation);
});

test("validateUpdate refuses newsletters the member may not choose", () => {
  assert.throws(
    () => validateUpdate({ newsletters: ["n2"] }, [weekly]),
    (e) => e instanceof ValidationError && /Unknown newsletter/.test(e.message),
  );
});
