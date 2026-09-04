import assert from "node:assert/strict";
import { test } from "node:test";

import { ValidationError, profile, validateUpdate } from "./account.js";

const weekly = { id: "n1", name: "Weekly", description: "Every Friday", visibility: "members" };
const paidOnly = { id: "n2", name: "Insiders", description: null, visibility: "paid" };
const newsletters = [weekly, paidOnly];

test("profile flags subscriptions and hides paid newsletters from free members", () => {
  const member = { email: "a@b.c", name: null, status: "free", newsletters: [{ id: "n1" }] };
  assert.deepEqual(profile(member, newsletters), {
    email: "a@b.c",
    name: "",
    newsletters: [{ id: "n1", name: "Weekly", description: "Every Friday", subscribed: true }],
  });
});

test("profile offers paid newsletters to paid and comped members", () => {
  const member = { email: "a@b.c", name: "Ada", status: "comped", newsletters: [] };
  const p = profile(member, newsletters);
  assert.deepEqual(
    p.newsletters.map((n) => [n.id, n.subscribed]),
    [
      ["n1", false],
      ["n2", false],
    ],
  );
  assert.equal(p.newsletters[1].description, "");
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
