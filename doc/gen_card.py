# -*- coding: utf-8 -*-
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 620, 640
img = Image.new("RGBA", (W, H), (236, 236, 236, 255))
d = ImageDraw.Draw(img)

# card shadow + body
d.rounded_rectangle([34, 44, 34+560, 44+530], radius=32, fill=(0, 0, 0, 45))
d.rounded_rectangle([30, 36, 30+560, 36+530], radius=32, fill=(255, 255, 255, 255))

FD = r"C:\Windows\Fonts"
def f(name, size):
    return ImageFont.truetype(os.path.join(FD, name), size)

f_reg  = f("msyh.ttc", 24)
f_bold = f("msyhbd.ttf", 30) if os.path.exists(os.path.join(FD, "msyhbd.ttf")) else f("msyh.ttc", 30)
f_bs   = f("msyh.ttc", 23)
f_icon = f("msyh.ttc", 58)

GREEN = (7, 193, 96, 255)
DARK  = (26, 26, 26, 255)
GRAY  = (138, 138, 138, 255)
LINE  = (240, 240, 240, 255)

# icon (top-left)
d.rounded_rectangle([78, 90, 190, 202], radius=26, fill=GREEN)
d.text((134, 148), "账", font=f_icon, fill=(255, 255, 255, 255), anchor="mm")

# cover (top-right)
d.rounded_rectangle([430, 90, 542, 202], radius=24, fill=GREEN)
d.text((486, 147), "¥", font=f_icon, fill=(255, 255, 255, 255), anchor="mm")

# title (two lines, bold)
d.text((210, 100), "流年小账", font=f_bold, fill=DARK)
d.text((210, 146), "邀请你一起记账", font=f_bold, fill=DARK)

# description (wrapped)
for i, line in enumerate(["老绿 邀请你加入", "家庭账本，共同记账"]):
    d.text((210, 212 + i*32), line, font=f_reg, fill=GRAY)

# separator
d.line([78, 430, 542, 430], fill=LINE, width=2)

# footer (小程序 badge)
d.rounded_rectangle([78, 468, 100, 490], radius=6, fill=GREEN)
d.text((89, 479), "程", font=f_bs, fill=(255, 255, 255, 255), anchor="mm")
d.text((112, 469), "小程序", font=f_bs, fill=GRAY)

out = r"C:\Users\greenet\WorkBuddy\2026-09-23-11-59-28\邀请分享卡片.png"
img.convert("RGB").save(out, "PNG")
print("saved:", out, img.size)
