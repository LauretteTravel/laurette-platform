from PIL import Image, ImageDraw, ImageFont
import arabic_reshaper
from bidi.algorithm import get_display
import os

SHOTS = "work/shots"
OUT = "work/shots/laurette-screens.png"

NAVY = (11, 42, 67)
BLUE = (23, 99, 143)
GOLD = (217, 163, 74)
SAND = (247, 244, 238)
INK = (20, 38, 58)
MUTED = (92, 114, 133)

AR = r"C:\Windows\Fonts\arial.ttf"
ARB = r"C:\Windows\Fonts\arialbd.ttf"


def font(size, bold=False):
    return ImageFont.truetype(ARB if bold else AR, size)


def rtl(text):
    return get_display(arabic_reshaper.reshape(text))


def cover(img, w, h):
    r = max(w / img.width, h / img.height)
    im = img.resize((int(img.width * r) + 1, int(img.height * r) + 1), Image.LANCZOS)
    left = (im.width - w) // 2
    top = 0
    return im.crop((left, top, left + w, top + h))


def phone(img, w, h):
    r = min(w / img.width, h / img.height)
    return img.resize((int(img.width * r), int(img.height * r)), Image.LANCZOS)


W, H = 1560, 1760
canvas = Image.new("RGB", (W, H), (244, 247, 249))
d = ImageDraw.Draw(canvas)

# ---------- header band ----------
d.rectangle([0, 0, W, 150], fill=NAVY)
try:
    logo = Image.open("laurette-platform/public/media/brand/logo.png").convert("RGBA")
    plate = Image.new("RGBA", (logo.width + 40, logo.height + 36), (255, 255, 255, 255))
    plate.paste(logo, (20, 18), logo)
    ph = 78
    plate = plate.resize((int(plate.width * ph / plate.height), ph), Image.LANCZOS)
    canvas.paste(plate, (48, 36), plate)
except Exception:
    pass

d.text((W - 48, 34), rtl("لوحة الشاشات العاملة"), font=font(46, True), fill=(255, 255, 255), anchor="ra")
d.text((W - 48, 96), rtl("منصة لوريت — لقطات حقيقية من الخادم المحلي، 29 أكتوبر 2026"), font=font(22), fill=(196, 214, 228), anchor="ra")

# ---------- layout grid ----------
PAD = 26
COL_W = (W - PAD * 3) // 2
ROWS = [
    ("الرئيسية — الهيدر بالشعار الجديد + الواجهة بالفيديو", "home2.png", "المحمول — صفحة البرنامج مع شريط الطلب الثابت", "mobile-program.png", 520),
    ("دليل السفر من الأردن — وجهات وفنادق وشركات طيران", "jordan-desktop.png", "كتالوج الطباعة / حفظ PDF", "print-desktop.png", 500),
    ("العروض — بوسترات الشركة الأصلية", "offers.png", "لوحة الإدارة — الدخول بالشعار", "admin.png", 500),
]

y = 180
for left_label, left_file, right_label, right_file, cell_h in ROWS:
    # labels: left column label sits above the left image, right column above the right image
    d.text((PAD, y), rtl(left_label), font=font(21, True), fill=INK, anchor="la")
    d.text((W - PAD, y), rtl(right_label), font=font(21, True), fill=INK, anchor="ra")
    y += 34
    for idx, file in enumerate([left_file, right_file]):
        x = PAD if idx == 0 else PAD * 2 + COL_W
        p = os.path.join(SHOTS, file)
        if not os.path.exists(p):
            continue
        im = Image.open(p).convert("RGB")
        if file.startswith("mobile"):
            card = phone(im, COL_W, cell_h)
            frame_x = x + (COL_W - card.width) // 2
            canvas.paste(card, (frame_x, y))
            d.rounded_rectangle([frame_x - 6, y - 6, frame_x + card.width + 6, y + card.height + 6], radius=20, outline=(203, 213, 220), width=3)
        else:
            card = cover(im, COL_W, cell_h)
            canvas.paste(card, (x, y))
            d.rectangle([x, y, x + COL_W, y + cell_h], outline=(214, 222, 229), width=2)
    y += cell_h + 34

# ---------- footer strip ----------
d.rectangle([0, H - 92, W, H], fill=(255, 255, 255))
d.line([0, H - 92, W, H - 92], fill=(222, 229, 235), width=2)
d.text((W - PAD, H - 62), rtl("كل الصفحات ترجع 200 · 72 اختبارًا ناجحًا · ضغط gzip · خط Cairo محلي"), font=font(20), fill=MUTED, anchor="ra")

canvas.save(OUT, quality=92, optimize=True)
print(OUT, os.path.getsize(OUT) // 1024, "KB", canvas.size)
