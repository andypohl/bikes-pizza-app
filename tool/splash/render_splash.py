"""Render the launch (splash) screen artwork for Android and iOS.

The splash is the app icon's wheel-and-pizza logo above the wordmark
"bikes.pizza", set in Inter Light with the same letter-spacing as the
website's title, on the icon's teal. This script keys the teal out of
assets/icon/icon.png (so no icon-shaped block shows on the teal splash),
renders the wordmark, stacks the two into one composite image and writes
every size the platforms need:

  assets/splash/splash.png                   Flutter's splash widget
  site/public/logo.png                       the website header's logo
  ios/Runner/Assets.xcassets/LaunchImage.imageset/LaunchImage[@2x|@3x].png
  android/.../res/drawable-*/splash.png      pre-Android 12 window background
  android/.../res/drawable-*/splash_logo.png Android 12+ splash icon
                                             (logo only, inset for the mask)

Run from the repository root after changing the icon or the wordmark:

  python3 -m venv /tmp/splash-venv && /tmp/splash-venv/bin/pip install pillow
  curl -sSL -o /tmp/inter.zip https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip
  unzip -q /tmp/inter.zip -d /tmp/inter
  /tmp/splash-venv/bin/python tool/splash/render_splash.py /tmp/inter/extras/ttf/Inter-Light.ttf
"""

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
ICON = ROOT / "assets/icon/icon.png"
TEAL = (128, 198, 196)  # #80C6C4, also lib/main.dart's seed and the icon background
INK = (28, 25, 23)  # stone-900, the website's title color
TRACKING = 0.025  # em; Tailwind's tracking-wide, as on the website's <h1>
LOGO_RATIO = 0.65  # logo width as a fraction of the wordmark width
GAP_RATIO = 0.08  # space between logo and wordmark, fraction of wordmark width
ANDROID_DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
ANDROID_SPLASH_DP = 300  # composite width on pre-12 Android launch backgrounds


def clean_logo(tolerance=18):
    """The icon with its teal background made transparent, cropped to the art."""
    im = Image.open(ICON).convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a and all(abs(c - t) <= tolerance for c, t in zip((r, g, b), TEAL)):
                px[x, y] = (0, 0, 0, 0)
    return im.crop(im.getbbox())


def wordmark(font_path, text="bikes.pizza", size=600):
    """The text in Inter Light with letter-spacing, tightly cropped."""
    font = ImageFont.truetype(str(font_path), size)
    advances = [font.getlength(c) for c in text]
    track = size * TRACKING
    canvas = Image.new("RGBA", (int(sum(advances) + track * len(text)) + size, size * 2))
    draw = ImageDraw.Draw(canvas)
    x = size / 4
    for c, adv in zip(text, advances):
        draw.text((x, size / 2), c, font=font, fill=INK + (255,))
        x += adv + track
    return canvas.crop(canvas.getbbox())


def fit_width(im, width):
    return im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)


def composite(logo, mark, width):
    mark = fit_width(mark, width)
    logo = fit_width(logo, round(width * LOGO_RATIO))
    gap = round(width * GAP_RATIO)
    out = Image.new("RGBA", (width, logo.height + gap + mark.height))
    out.alpha_composite(logo, ((width - logo.width) // 2, 0))
    out.alpha_composite(mark, (0, logo.height + gap))
    return out


def android_icon(logo, size=1024, safe=0.30):
    """An adaptive-icon foreground: the logo centered so that all of it lies
    inside the circle Android 12's splash screen masks the icon to (the
    66/108 dp safe zone, with a small margin)."""
    alpha = logo.split()[3]
    cx, cy = logo.width / 2, logo.height / 2
    reach = max(
        math.hypot(x - cx, y - cy)
        for y in range(logo.height)
        for x in range(logo.width)
        if alpha.getpixel((x, y)) > 8
    )
    scale = safe * size / reach
    scaled = logo.resize((round(logo.width * scale), round(logo.height * scale)), Image.LANCZOS)
    out = Image.new("RGBA", (size, size))
    out.alpha_composite(scaled, ((size - scaled.width) // 2, (size - scaled.height) // 2))
    return out


def save(im, path):
    """Write a 256-color PNG: the artwork is flat illustration, so the
    palette version is indistinguishable and a fraction of the size."""
    path.parent.mkdir(parents=True, exist_ok=True)
    im.quantize(colors=256, method=Image.Quantize.FASTOCTREE).save(path, optimize=True)
    print(f"{path.relative_to(ROOT)}  {im.width}x{im.height}")


def main(font_path):
    logo = clean_logo()
    mark = wordmark(font_path)
    master = composite(logo, mark, 2400)

    save(fit_width(master, 1600), ROOT / "assets/splash/splash.png")
    save(fit_width(logo, 512), ROOT / "site/public/logo.png")

    ios = ROOT / "ios/Runner/Assets.xcassets/LaunchImage.imageset"
    save(fit_width(master, 560), ios / "LaunchImage.png")
    save(fit_width(master, 1120), ios / "LaunchImage@2x.png")
    save(fit_width(master, 1680), ios / "LaunchImage@3x.png")

    res = ROOT / "android/app/src/main/res"
    icon = android_icon(logo)
    for name, scale in ANDROID_DENSITIES.items():
        save(fit_width(master, round(ANDROID_SPLASH_DP * scale)), res / f"drawable-{name}/splash.png")
        px = round(108 * scale)
        save(icon.resize((px, px), Image.LANCZOS), res / f"drawable-{name}/splash_logo.png")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: render_splash.py <path to Inter-Light.ttf>")
    main(Path(sys.argv[1]))
