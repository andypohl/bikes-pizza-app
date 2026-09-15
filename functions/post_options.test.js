import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { BIKE_COLORS, BIKE_TYPES, BIKE_YEARS, PIZZA_STYLES } from "./post_options.js";

/** The `value: '...'` entries of one exported list in a Studio options file. */
function studioValues(file, name) {
  const source = readFileSync(new URL(`../studio/schemaTypes/${file}`, import.meta.url), "utf8");
  const declaration = source.indexOf(`export const ${name}`);
  assert.notEqual(declaration, -1, `${name} not found in ${file}`);
  // Skip the `Option[]` type annotation to the list itself.
  const start = source.indexOf("= [", declaration);
  const end = source.indexOf("]", start + 3);
  return [...source.slice(start, end).matchAll(/value:\s*'([^']+)'/g)].map((m) => m[1]);
}

test("the option values match the Studio's lists", () => {
  assert.deepEqual(BIKE_YEARS, studioValues("bikeOptions.ts", "BIKE_YEARS"));
  assert.deepEqual(BIKE_COLORS, studioValues("bikeOptions.ts", "BIKE_COLORS"));
  assert.deepEqual(BIKE_TYPES, studioValues("bikeOptions.ts", "BIKE_TYPES"));
  assert.deepEqual(PIZZA_STYLES, studioValues("pizzaOptions.ts", "PIZZA_STYLES"));
});
