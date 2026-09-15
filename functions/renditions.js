// The sizes of a post's photo that the website and the app pick from,
// made once when the post is published (or its photo changed) and kept
// in Cloud Storage under posts/{slug}/{version}/. Each width comes as JPEG
// and WebP; the tile is the 4:3 crop the gallery shows, cut around the
// photo's focus point; the blur is a tiny JPEG shown while a size loads.
// Pure sharp; no Firebase.

import { createHash } from "node:crypto";

import sharp from "sharp";

/** Widths offered, smallest first; a photo narrower than one stops there. */
export const WIDTHS = [400, 800, 1200, 2048];
export const TILE = { width: 800, height: 600 };
export const BLUR_WIDTH = 20;
export const FORMATS = ["webp", "jpg"];

/**
 * @param {Buffer|Uint8Array} bytes  any image sharp reads
 * @param {{focus?: {x: number, y: number}}} [options]  where the subject is, 0..1 from the top left
 * @returns {Promise<{width: number, height: number, sizes: number[], blur: string, focus: {x: number, y: number},
 *   version: string, files: {name: string, bytes: Buffer, contentType: string}[]}>}
 */
export async function makeRenditions(bytes, { focus = { x: 0.5, y: 0.5 } } = {}) {
  const source = sharp(bytes, { failOn: "error" }).rotate();
  const { width, height } = await source.metadata();
  if (!width || !height) throw new Error("image has no dimensions");
  const base = await source.clone().toBuffer(); // rotation applied once
  const clean = { x: clamp(focus.x), y: clamp(focus.y) };

  const sizes = WIDTHS.filter((w) => w < width);
  const largest = Math.min(width, WIDTHS[WIDTHS.length - 1]);
  if (!sizes.includes(largest)) sizes.push(largest);
  const files = [];
  for (const w of sizes) {
    const resized = sharp(base).resize({ width: w, withoutEnlargement: true });
    files.push({ name: `${w}.webp`, bytes: await resized.clone().webp({ quality: 80 }).toBuffer(), contentType: "image/webp" });
    files.push({ name: `${w}.jpg`, bytes: await resized.clone().jpeg({ quality: 85, mozjpeg: true }).toBuffer(), contentType: "image/jpeg" });
  }

  const crop = tileCrop(width, height, clean);
  const tile = sharp(base)
    .extract(crop)
    .resize({ width: TILE.width, height: TILE.height, fit: "fill", withoutEnlargement: true });
  files.push({ name: "tile.webp", bytes: await tile.clone().webp({ quality: 80 }).toBuffer(), contentType: "image/webp" });
  files.push({ name: "tile.jpg", bytes: await tile.clone().jpeg({ quality: 85, mozjpeg: true }).toBuffer(), contentType: "image/jpeg" });

  const blurBytes = await sharp(base).resize({ width: BLUR_WIDTH }).jpeg({ quality: 50 }).toBuffer();
  const blur = `data:image/jpeg;base64,${blurBytes.toString("base64")}`;

  const version = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  return { width, height, sizes, blur, focus: clean, version, files };
}

const clamp = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);

/** The largest 4:3 rectangle inside width×height, placed around the focus point. */
export function tileCrop(width, height, focus) {
  const ratio = TILE.width / TILE.height;
  let cropWidth = width;
  let cropHeight = Math.round(width / ratio);
  if (cropHeight > height) {
    cropHeight = height;
    cropWidth = Math.round(height * ratio);
  }
  const left = Math.floor(Math.min(Math.max(focus.x * width - cropWidth / 2, 0), width - cropWidth));
  const top = Math.floor(Math.min(Math.max(focus.y * height - cropHeight / 2, 0), height - cropHeight));
  return { left, top, width: cropWidth, height: cropHeight };
}

/** Where a post's renditions live in the bucket. */
export function renditionPath(slug, version, name) {
  return `posts/${slug}/${version}/${name}`;
}
