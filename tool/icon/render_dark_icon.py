"""Render the dark-appearance app icons from assets/icon/icon_ios.png.

The design for dark mode: the icon's teal becomes the website's dark-mode
page color, the wheel becomes a light gray silhouette, and the pizza slice
stays as it is. The script sorts the source icon's pixels into those three
parts by color (teal is the background, warm saturated colors are the
pizza, the rest is the wheel) and writes:

  assets/icon/icon_ios_dark.png      iOS 18 dark appearance: the design
                                     above, opaque, 1024 x 1024
  assets/icon/icon_ios_tinted.png    iOS 18 tinted appearance: the same
                                     shapes in grays on transparent, which
                                     iOS colors with the user's tint
  assets/icon/icon_android_mono.png  Android 13 themed icon: the wheel and
                                     the slice as one silhouette on
                                     transparent, placed like the adaptive
                                     icon's foreground (icon_android_fg.png)

Then regenerate the platform icon sets:

  dart run flutter_launcher_icons

Run from the repository root:

  python3 -m venv /tmp/icon-venv && /tmp/icon-venv/bin/pip install pillow numpy scipy
  /tmp/icon-venv/bin/python tool/icon/render_dark_icon.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
ICONS = ROOT / "assets/icon"
SOURCE = ICONS / "icon_ios.png"  # the full square, no rounded corners
ANDROID_FOREGROUND = ICONS / "icon_android_fg.png"

TEAL = np.array([128, 198, 196], float)  # #80c6c4, the light icon's background
NIGHT = (0x14, 0x36, 0x34)  # --bp-teal-night, the site's dark-mode page color
WHEEL = (0xD6, 0xD3, 0xD1)  # the silhouette: a light gray
MONO = (0x80, 0x80, 0x80)  # Android only reads the alpha; gray previews visibly

# How far (in RGB distance) a pixel must be from teal to count as art at
# all; pixels in between are edges and get a partial alpha.
ART_RANGE = 90.0
# The slice: hue up to this many degrees on either side of red, and at
# least this saturated (Pillow's 0-255 scale).
WARM_HUE_DEGREES = 62
MIN_SATURATION = 70
# The source has a little grain; the silhouette is smoothed by this much
# (in pixels) and then cut at this cover, which drops speckles but keeps
# the thin spokes whole. Holes in the silhouette smaller than this many
# pixels are grain too and get filled.
SMOOTHING = 1.0
CUT = 0.35
MAX_HOLE = 200
# The silhouette stops this many pixels short of the slice, so the slice's
# blended edge does not get a gray fringe.
PIZZA_CLEARANCE = 4
# The wheel silhouette stops this many pixels short of the slice in the
# monochrome icon, so the two shapes read separately.
MONO_GAP = 14


def masks(path):
    """The source icon's pixels, how much of each the art covers, the slice
    mask and the wheel silhouette's alpha."""
    image = Image.open(path).convert("RGB")
    rgb = np.asarray(image).astype(float)
    hsv = np.asarray(image.convert("HSV")).astype(float)
    hue = hsv[..., 0] * 360 / 255
    sat = hsv[..., 1]

    # Anything that is not teal is art; how far from teal is how much of
    # the pixel the art covers. The slice casts a soft shadow on the teal
    # (a darker teal), which is background for the wheel, not art.
    cover = np.clip(np.linalg.norm(rgb - TEAL, axis=2) / ART_RANGE, 0, 1)
    tealish = (np.abs(((hue - 178) + 180) % 360 - 180) < 25) & (sat > 25)
    art = np.where(tealish, 0, cover)

    warm = ((hue <= WARM_HUE_DEGREES) | (hue >= 360 - WARM_HUE_DEGREES)) & (sat >= MIN_SATURATION)
    warm = ndimage.binary_closing(warm, iterations=3)
    warm = ndimage.binary_fill_holes(warm)
    pizza = largest(warm)

    # The silhouette: the art, smoothed and cut so grain and edge speckles
    # fall away, minus the slice and a little clearance around it.
    silhouette = ndimage.gaussian_filter(art, SMOOTHING) > CUT
    silhouette &= ~ndimage.binary_dilation(pizza, iterations=PIZZA_CLEARANCE)
    wheel = soft(fill_small_holes(largest(silhouette)))
    return rgb, cover, pizza, wheel


def fill_small_holes(mask):
    """The mask with holes of fewer than MAX_HOLE pixels filled in."""
    labels, count = ndimage.label(~mask)
    if count == 0:
        return mask
    sizes = ndimage.sum(~mask, labels, range(1, count + 1))
    small = np.isin(labels, np.where(sizes < MAX_HOLE)[0] + 1)
    return mask | small


def largest(mask):
    """The biggest connected region of a boolean mask."""
    labels, count = ndimage.label(mask)
    if count <= 1:
        return mask
    sizes = ndimage.sum(mask, labels, range(1, count + 1))
    return labels == (int(np.argmax(sizes)) + 1)


def soft(mask):
    """A boolean mask as a float alpha with a one-pixel soft edge."""
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))) / 255


def layer(color, alpha):
    h, w = alpha.shape
    out = np.zeros((h, w, 4), np.uint8)
    out[..., :3] = color
    out[..., 3] = np.clip(alpha * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def pizza_layer(rgb, cover, pizza, grayscale=False):
    """The slice with its edge pixels un-blended from the teal they were
    drawn over, so they carry their own color at a partial alpha instead of
    a teal-tinged fringe."""
    h, w, _ = rgb.shape
    # Two pixels out takes in the whole anti-aliased edge; the cover then
    # fades it.
    edge = soft(ndimage.binary_dilation(pizza, iterations=2))
    alpha = np.minimum(cover, edge)
    a = np.clip(cover, 0.05, 1)[..., None]
    colors = np.clip((rgb - (1 - a) * TEAL) / a, 0, 255)
    if grayscale:
        gray = colors @ np.array([0.299, 0.587, 0.114])
        colors = np.repeat(gray[..., None], 3, axis=2)
    out = np.zeros((h, w, 4), np.uint8)
    out[..., :3] = colors.astype(np.uint8)
    out[..., 3] = np.clip(alpha * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def compose(background, layers):
    out = background.copy()
    for image in layers:
        out.alpha_composite(image)
    return out


def android_frame(path):
    """Where the adaptive foreground's art sits inside its 1024 canvas."""
    alpha = np.asarray(Image.open(path).convert("RGBA"))[..., 3]
    rows = np.where(alpha.max(axis=1) > 0)[0]
    cols = np.where(alpha.max(axis=0) > 0)[0]
    return (int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1)


def main():
    rgb, cover, pizza, wheel = masks(SOURCE)
    h, w, _ = rgb.shape

    dark = compose(
        Image.new("RGBA", (w, h), NIGHT + (255,)),
        [layer(WHEEL, wheel), pizza_layer(rgb, cover, pizza)],
    )
    dark.convert("RGB").save(ICONS / "icon_ios_dark.png")

    tinted = compose(
        Image.new("RGBA", (w, h), (0, 0, 0, 0)),
        [layer(WHEEL, wheel), pizza_layer(rgb, cover, pizza, grayscale=True)],
    )
    tinted.save(ICONS / "icon_ios_tinted.png")

    gap = ndimage.binary_dilation(pizza, iterations=MONO_GAP)
    mono = compose(
        Image.new("RGBA", (w, h), (0, 0, 0, 0)),
        [
            layer(MONO, np.where(gap, 0, wheel)),
            layer(MONO, soft(ndimage.binary_dilation(pizza, iterations=1))),
        ],
    )
    left, top, right, bottom = android_frame(ANDROID_FOREGROUND)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.alpha_composite(mono.resize((right - left, bottom - top), Image.LANCZOS), (left, top))
    canvas.save(ICONS / "icon_android_mono.png")

    print("wrote icon_ios_dark.png, icon_ios_tinted.png, icon_android_mono.png")


if __name__ == "__main__":
    main()
