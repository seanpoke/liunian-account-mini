# -*- coding: utf-8 -*-
"""
生成「流年小账」微信小程序图标 (144x144 PNG)，并附带 512 主图用于提交。
设计：绿色圆角方底（微信绿 #07C160 渐变）+ 白色主体图形。
提供两种方案：
  A. coin   —— 白色圆形硬币 + 绿色 ¥（最简洁、金融感强，推荐）
  B. zhang  —— 白色「账」字（语义直白，账本/记账）
全程本地绘制，无网络依赖；高分辨率渲染后降采样，保证边缘平滑。
"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = r"C:\Users\greenet\WorkBuddy\2026-09-23-11-59-28"
FD = r"C:\Windows\Fonts"

GREEN_TOP = (30, 212, 120)
GREEN_BOT = (5, 168, 82)
WHITE = (255, 255, 255, 255)
YEN = (7, 193, 96, 255)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def base_layer(size):
    """绿色渐变圆角方底，圆角外透明。"""
    grad = Image.new("RGB", (size, size))
    gd = ImageDraw.Draw(grad)
    for y in range(size):
        gd.line([(0, y), (size, y)], fill=lerp(GREEN_TOP, GREEN_BOT, y / size))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=255
    )
    img = Image.new("RGBA", (size, size))
    img.paste(grad, (0, 0))
    img.putalpha(mask)
    return img


def draw_yen(d, cx, cy, R, color):
    """手工绘制 ¥，避免字体缺字风险。"""
    sw = max(2, int(R * 0.17))
    top = cy - R * 0.55
    midY = cy - R * 0.02
    bot = cy + R * 0.62
    dx = R * 0.50
    d.line([(cx - dx, top), (cx, midY)], fill=color, width=sw, joint="curve")
    d.line([(cx + dx, top), (cx, midY)], fill=color, width=sw, joint="curve")
    d.line([(cx, midY), (cx, bot)], fill=color, width=sw, joint="curve")
    for (x, y) in [(cx - dx, top), (cx + dx, top), (cx, bot)]:
        d.ellipse([x - sw / 2, y - sw / 2, x + sw / 2, y + sw / 2], fill=color)
    bw = int(sw * 0.9)
    y1 = cy + R * 0.16
    y2 = cy + R * 0.30
    d.line([(cx - R * 0.32, y1), (cx + R * 0.32, y1)], fill=color, width=bw)
    d.line([(cx - R * 0.32, y2), (cx + R * 0.32, y2)], fill=color, width=bw)


def gen(base, scale, variant):
    size = base * scale
    img = base_layer(size)
    d = ImageDraw.Draw(img)
    cx = cy = size // 2

    if variant == "coin":
        R = size * 0.30
        d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=WHITE)
        draw_yen(d, cx, cy, R * 0.80, YEN)

    elif variant == "zhang":
        f = ImageFont.truetype(os.path.join(FD, "msyh.ttc"), int(size * 0.66))
        d.text((cx, cy), "账", font=f, fill=WHITE, anchor="mm")

    out = os.path.join(OUT, f"icon_流年小账_{variant}_{base}.png")
    img.resize((base, base), Image.LANCZOS).save(out, "PNG")
    print("saved:", out, (base, base))


if __name__ == "__main__":
    for v in ("coin", "zhang"):
        gen(144, 8, v)    # 提交用 144
        gen(512, 4, v)    # 高清主图备用
