import assert from "node:assert/strict";
import { test } from "node:test";

import sharp from "sharp";

import { MAX_EDGE, THUMB_EDGE, processImage } from "./images.js";

test("processImage caps the long edge, makes a thumbnail, and outputs JPEG", async () => {
  const wide = await sharp({
    create: { width: 3000, height: 1500, channels: 3, background: { r: 220, g: 60, b: 40 } },
  })
    .png()
    .toBuffer();
  const { full, thumb } = await processImage(wide);
  assert.equal(full.width, MAX_EDGE);
  assert.equal(full.height, MAX_EDGE / 2);
  const fullMeta = await sharp(full.bytes).metadata();
  assert.equal(fullMeta.format, "jpeg");
  const thumbMeta = await sharp(thumb.bytes).metadata();
  assert.equal(thumbMeta.width, THUMB_EDGE);
  assert.equal(thumbMeta.format, "jpeg");
});

test("processImage leaves small images at their size", async () => {
  const small = await sharp({
    create: { width: 300, height: 200, channels: 3, background: "#ffffff" },
  })
    .jpeg()
    .toBuffer();
  const { full, thumb } = await processImage(small);
  assert.equal(full.width, 300);
  assert.equal((await sharp(thumb.bytes).metadata()).width, 300);
});

test("processImage rejects data that is not an image", async () => {
  await assert.rejects(processImage(Buffer.from("not an image")));
});
