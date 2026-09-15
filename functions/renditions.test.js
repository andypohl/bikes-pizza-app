import assert from "node:assert/strict";
import { test } from "node:test";

import sharp from "sharp";

import { BLUR_WIDTH, TILE, WIDTHS, makeRenditions, renditionPath, tileCrop } from "./renditions.js";

const image = (width, height) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } } }).png().toBuffer();

test("a large photo gets every width, both formats, a tile and a blur", async () => {
  const out = await makeRenditions(await image(3000, 2000));
  assert.deepEqual(out.sizes, WIDTHS);
  assert.equal(out.width, 3000);
  assert.equal(out.height, 2000);
  assert.deepEqual(out.focus, { x: 0.5, y: 0.5 });
  assert.match(out.version, /^[0-9a-f]{12}$/);
  const names = out.files.map((f) => f.name).sort();
  assert.deepEqual(names, ["1200.jpg", "1200.webp", "2048.jpg", "2048.webp", "400.jpg", "400.webp", "800.jpg", "800.webp", "tile.jpg", "tile.webp"]);
  const w800 = await sharp(out.files.find((f) => f.name === "800.webp").bytes).metadata();
  assert.equal(w800.width, 800);
  assert.equal(w800.format, "webp");
  const tile = await sharp(out.files.find((f) => f.name === "tile.jpg").bytes).metadata();
  assert.deepEqual([tile.width, tile.height], [TILE.width, TILE.height]);
  assert.match(out.blur, /^data:image\/jpeg;base64,/);
  assert.equal((await sharp(Buffer.from(out.blur.split(",")[1], "base64")).metadata()).width, BLUR_WIDTH);
});

test("a small photo keeps only the sizes it can fill, plus its own width", async () => {
  const out = await makeRenditions(await image(1000, 750));
  assert.deepEqual(out.sizes, [400, 800, 1000]);
  const tile = await sharp(out.files.find((f) => f.name === "tile.webp").bytes).metadata();
  assert.deepEqual([tile.width, tile.height], [800, 600]);
  const tiny = await makeRenditions(await image(300, 300));
  assert.deepEqual(tiny.sizes, [300]);
});

test("the tile is cut around the focus point", () => {
  // Wide photo: full height, the width chosen around focus.x.
  assert.deepEqual(tileCrop(4000, 1000, { x: 0.5, y: 0.5 }), { left: 1333, top: 0, width: 1333, height: 1000 });
  assert.deepEqual(tileCrop(4000, 1000, { x: 0, y: 0.5 }), { left: 0, top: 0, width: 1333, height: 1000 });
  assert.deepEqual(tileCrop(4000, 1000, { x: 1, y: 0.5 }), { left: 2667, top: 0, width: 1333, height: 1000 });
  // Tall photo: full width, the height chosen around focus.y.
  assert.deepEqual(tileCrop(1000, 4000, { x: 0.5, y: 0.1 }), { left: 0, top: 25, width: 1000, height: 750 });
});

test("the same bytes give the same version; paths are per slug and version", async () => {
  const bytes = await image(500, 500);
  const a = await makeRenditions(bytes);
  const b = await makeRenditions(bytes);
  assert.equal(a.version, b.version);
  assert.equal(renditionPath("trek-970-abc123", a.version, "800.webp"), `posts/trek-970-abc123/${a.version}/800.webp`);
});

test("data that is not an image is refused", async () => {
  await assert.rejects(makeRenditions(Buffer.from("nope")));
});
