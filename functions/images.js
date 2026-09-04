// Normalises an uploaded photo: fixes EXIF rotation, caps the long edge,
// re-encodes as JPEG, and makes a thumbnail for the review page.

import sharp from "sharp";

export const MAX_EDGE = 2048;
export const THUMB_EDGE = 400;

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<{full: {bytes: Buffer, width: number, height: number}, thumb: {bytes: Buffer}}>}
 */
export async function processImage(bytes) {
  const base = sharp(bytes, { failOn: "error" }).rotate();
  const full = await base
    .clone()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await base
    .clone()
    .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return {
    full: { bytes: full.data, width: full.info.width, height: full.info.height },
    thumb: { bytes: thumb },
  };
}
