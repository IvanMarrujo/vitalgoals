#!/usr/bin/env python3
"""Generates the PWA icons (glassmorphic dark-green glass + VHG logo)."""
import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO_PATH = os.path.join(ROOT, 'assets', 'vhg-logo.png')

CENTER_COLOR = (0x11, 0x22, 0x40)   # #112240
EDGE_COLOR = (0x0a, 0x16, 0x28)     # #0a1628
GLASS_FILL = (17, 34, 64, int(0.6 * 255))
GLASS_BORDER = (0, 200, 83, int(0.3 * 255))
OUTER_BORDER = (0, 200, 83, int(0.5 * 255))
SHINE = (255, 255, 255, int(0.08 * 255))


def lerp(a, b, t):
    return a + (b - a) * t


def draw_radial_background(size):
    """Concentric-circle approximation of a radial gradient (center -> edge)."""
    img = Image.new('RGB', (size, size), EDGE_COLOR)
    draw = ImageDraw.Draw(img)
    max_r = size * math.sqrt(2) / 2
    steps = size  # one ring per pixel of radius for smoothness
    for i in range(steps, -1, -1):
        t = i / steps
        r = max_r * t
        color = tuple(int(round(lerp(CENTER_COLOR[c], EDGE_COLOR[c], t))) for c in range(3))
        bbox = [size / 2 - r, size / 2 - r, size / 2 + r, size / 2 + r]
        draw.ellipse(bbox, fill=color)
    return img.convert('RGBA')


def draw_glass_circle(size):
    overlay = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    center = size / 2
    radius = size * 0.45
    border_w = max(1, round(size * 0.018))
    draw.ellipse(
        [center - radius, center - radius, center + radius, center + radius],
        fill=GLASS_FILL, outline=GLASS_BORDER, width=border_w,
    )
    return overlay


def draw_outer_border(size):
    overlay = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    center = size / 2
    radius = size * 0.485
    width = max(1, round(size * (2 / 192)))
    draw.ellipse(
        [center - radius, center - radius, center + radius, center + radius],
        outline=OUTER_BORDER, width=width,
    )
    return overlay


def draw_shine(size):
    overlay = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    center = size / 2
    radius = size * 0.4
    width = max(2, round(size * 0.08))
    bbox = [center - radius, center - radius, center + radius, center + radius]
    draw.arc(bbox, start=200, end=300, fill=SHINE, width=width)
    return overlay


def paste_logo(base, size):
    logo = Image.open(LOGO_PATH).convert('RGBA')
    target = round(size * 0.65)
    logo = logo.resize((target, target), Image.LANCZOS)
    pos = ((size - target) // 2, (size - target) // 2)
    base.paste(logo, pos, logo)


def generate_icon(size):
    img = draw_radial_background(size)
    img = Image.alpha_composite(img, draw_glass_circle(size))
    img = Image.alpha_composite(img, draw_outer_border(size))
    img = Image.alpha_composite(img, draw_shine(size))
    paste_logo(img, size)
    return img.convert('RGB')


def main():
    targets = [
        ('icon-192.png', 192),
        ('icon-512.png', 512),
        ('apple-touch-icon.png', 180),
    ]
    for filename, size in targets:
        icon = generate_icon(size)
        out_path = os.path.join(ROOT, filename)
        icon.save(out_path, 'PNG')
        print(f'Generated {out_path} ({size}x{size})')


if __name__ == '__main__':
    main()
