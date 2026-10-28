from PIL import Image, ImageDraw, ImageFilter
import os

SRC = "public/media/brand/logo.png"
OUT = "public/media/brand"
NAVY = (11, 42, 67, 255)

logo = Image.open(SRC).convert("RGBA")
print("source", logo.size)

# --- emblem (left part, palm + swoosh) ---
w, h = logo.size
emblem = logo.crop((0, 0, int(w * 0.42), h))
bbox = emblem.getbbox()
emblem = emblem.crop(bbox)
print("emblem", emblem.size)

def square(img, size, pad_ratio=0.12):
    side = int(max(img.size) * (1 + pad_ratio * 2))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2), img)
    return canvas.resize((size, size), Image.LANCZOS)

# favicons
square(emblem, 32).save(f"{OUT}/favicon-32.png")
square(emblem, 180).save(f"{OUT}/icon-180.png")
square(emblem, 192).save(f"{OUT}/icon-192.png")
square(emblem, 512).save(f"{OUT}/icon-512.png")

# --- default social card 1200x630 ---
hero = Image.open("public/media/hero/hero-poster.jpg").convert("RGB")
ratio = 1200 / 630
hw, hh = hero.size
if hw / hh > ratio:
    new_w = int(hh * ratio)
    hero = hero.crop(((hw - new_w) // 2, 0, (hw + new_w) // 2, hh))
else:
    new_h = int(hw / ratio)
    hero = hero.crop((0, (hh - new_h) // 2, hw, (hh + new_h) // 2))
hero = hero.resize((1200, 630), Image.LANCZOS)

overlay = Image.new("RGBA", (1200, 630), (0, 0, 0, 0))
d = ImageDraw.Draw(overlay)
for i in range(630):
    alpha = int(150 * (i / 630) ** 0.7) + 40
    d.line([(0, i), (1200, i)], fill=(11, 42, 67, min(alpha, 215)))
card = Image.alpha_composite(hero.convert("RGBA"), overlay)

# white plate + logo bottom-right (RTL visual balance: place on right)
plate_w, plate_h = 430, 190
plate = Image.new("RGBA", (plate_w, plate_h), (255, 255, 255, 245))
mask = Image.new("L", (plate_w, plate_h), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, plate_w - 1, plate_h - 1], radius=26, fill=255)
logo_big = logo.resize((int(380 * 0.92), int(156 * 0.92)), Image.LANCZOS)
card.paste(plate, (1200 - plate_w - 56, 630 - plate_h - 52), mask)
card.paste(logo_big, (1200 - plate_w - 56 + (plate_w - logo_big.width) // 2,
                      630 - plate_h - 52 + (plate_h - logo_big.height) // 2), logo_big)

card.convert("RGB").save(f"{OUT}/og-default.jpg", quality=86, optimize=True, progressive=True)
print("og", os.path.getsize(f"{OUT}/og-default.jpg"))
for f in ["favicon-32.png", "icon-180.png", "icon-192.png", "icon-512.png"]:
    print(f, os.path.getsize(f"{OUT}/{f}"))
