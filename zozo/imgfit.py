"""تنظیم سایز عکس: برش/جا دادن در یک اندازه‌ی دقیق، اصلاح ساده‌ی رنگ و وضوح، خروجی WebP.

پیش‌فرض همان اندازه‌ی عکس‌های سایت کرمان راوی است (۱۰۰۷×۷۱۹، «پر کردن کادر»).
"""
from __future__ import annotations

import io
import re
from pathlib import Path
from typing import Any

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from . import db, teaser

DEFAULT_PRESET = {"id": "site", "name": "عکس سایت کرمان راوی", "w": 1007, "h": 719, "mode": "fill", "bg": "blur",
                  "sharpen": 0, "bright": 0, "contrast": 0, "color": 0, "quality": 85, "max_kb": 0,
                  "wm": True, "wm_logo": "bar", "wm_pos": "br", "wm_size": 0.18, "wm_opacity": 0.9}
# واترمارک: لوگوی کرمان راوی (نسخه‌ی با حاشیه‌ی سفید روی هر عکسی خوانده می‌شود)
BRAND = Path(__file__).parent / "static" / "brand"
WM_LOGOS = {"bar": "logo-bar.png", "mark": "logo-mark.png", "full": "logo-transparent.png"}
MAX_SIDE = 5000
Image.MAX_IMAGE_PIXELS = 120_000_000  # عکس‌های خیلی بزرگ دوربین هم باز شوند، نه بیشتر


def _num(p: dict[str, Any], k: str, lo: float, hi: float, default: float) -> float:
    try:
        v = float(p.get(k, default))
    except (TypeError, ValueError):
        v = default
    return max(lo, min(hi, v))


def params(p: dict[str, Any]) -> dict[str, Any]:
    """مقدارهای ورودی را در بازه‌ی مجاز نگه می‌دارد."""
    w, h = int(_num(p, "w", 16, MAX_SIDE, 1007)), int(_num(p, "h", 16, MAX_SIDE, 719))
    mode = p.get("mode") if p.get("mode") in ("fill", "whole") else "fill"
    bg = str(p.get("bg") or "blur")
    if bg != "blur" and not re.fullmatch(r"#[0-9a-fA-F]{6}", bg):
        bg = "blur"
    return {"w": w, "h": h, "mode": mode, "bg": bg,
            "fx": _num(p, "fx", 0, 1, 0.5), "fy": _num(p, "fy", 0, 1, 0.5), "zoom": _num(p, "zoom", 1, 6, 1),
            "sharpen": _num(p, "sharpen", 0, 2, 0), "bright": _num(p, "bright", -0.5, 0.5, 0),
            "contrast": _num(p, "contrast", -0.5, 0.5, 0), "color": _num(p, "color", -1, 1, 0),
            "quality": int(_num(p, "quality", 30, 100, 85)), "max_kb": int(_num(p, "max_kb", 0, 20000, 0)),
            "wm": p.get("wm", True) not in (False, 0, "0", "false"),
            "wm_logo": p.get("wm_logo") if p.get("wm_logo") in WM_LOGOS else "bar",
            "wm_pos": p.get("wm_pos") if p.get("wm_pos") in ("br", "bl", "tr", "tl") else "br",
            "wm_size": _num(p, "wm_size", 0.05, 0.5, 0.18), "wm_opacity": _num(p, "wm_opacity", 0.1, 1, 0.9)}


def _open(path: str) -> Image.Image:
    try:
        im = Image.open(path)
        im = ImageOps.exif_transpose(im)  # عکس گوشی که چرخیده ذخیره شده، درست بایستد
    except Exception as e:  # noqa: BLE001
        raise db.ValidationError("این فایل عکس قابل خواندن نیست") from e
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        flat = Image.new("RGB", im.size, "white")
        flat.paste(im, mask=im.getchannel("A"))
        return flat
    return im.convert("RGB")


def _cover(im: Image.Image, W: int, H: int, fx: float, fy: float, zoom: float) -> Image.Image:
    sc = max(W / im.width, H / im.height) * zoom
    rw, rh = max(W, round(im.width * sc)), max(H, round(im.height * sc))
    # فقط بخش لازمِ عکس اصلی بزرگ/کوچک می‌شود (سریع‌تر و دقیق‌تر برای عکس‌های بزرگ)
    x, y = (rw - W) * fx, (rh - H) * fy
    box = (max(0, x / sc), max(0, y / sc), min(im.width, (x + W) / sc), min(im.height, (y + H) / sc))
    return im.resize((W, H), Image.LANCZOS, box=box)


def render(src: Image.Image, p: dict[str, Any]) -> Image.Image:
    W, H = p["w"], p["h"]
    if p["mode"] == "fill":
        out = _cover(src, W, H, p["fx"], p["fy"], p["zoom"])
    else:
        if p["bg"] == "blur":
            small = _cover(src, max(16, W // 8), max(16, H // 8), 0.5, 0.5, 1)
            out = small.filter(ImageFilter.GaussianBlur(4)).resize((W, H), Image.BILINEAR).filter(ImageFilter.GaussianBlur(6))
            out = ImageEnhance.Brightness(out).enhance(0.72)
        else:
            out = Image.new("RGB", (W, H), p["bg"])
        sc = min(W / src.width, H / src.height)
        fw, fh = max(1, round(src.width * sc)), max(1, round(src.height * sc))
        out.paste(src.resize((fw, fh), Image.LANCZOS), ((W - fw) // 2, (H - fh) // 2))
    if p["bright"]:
        out = ImageEnhance.Brightness(out).enhance(1 + p["bright"])
    if p["contrast"]:
        out = ImageEnhance.Contrast(out).enhance(1 + p["contrast"])
    if p["color"]:
        out = ImageEnhance.Color(out).enhance(1 + p["color"])
    if p["sharpen"]:
        out = out.filter(ImageFilter.UnsharpMask(radius=1.6, percent=int(80 * p["sharpen"]), threshold=2))
    if p["wm"]:
        out = watermark(out, p)
    return out


def watermark(im: Image.Image, p: dict[str, Any]) -> Image.Image:
    """لوگو در گوشه (پیش‌فرض پایین راست) با سایه‌ی نرم تا روی عکس روشن و تیره دیده شود."""
    logo = Image.open(BRAND / WM_LOGOS[p["wm_logo"]]).convert("RGBA")
    W, H = im.size
    lw = max(24, round(W * p["wm_size"]))
    lh = max(1, round(logo.height * lw / logo.width))
    logo = logo.resize((lw, lh), Image.LANCZOS)
    m = round(min(W, H) * 0.035)
    x = W - lw - m if p["wm_pos"] in ("br", "tr") else m
    y = H - lh - m if p["wm_pos"] in ("br", "bl") else m
    a = logo.getchannel("A")
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    blur = max(2, lw // 40)
    shadow_a = a.point(lambda v: v * 0.45 * p["wm_opacity"])
    sh.paste((0, 0, 0, 255), (x, y + max(1, lw // 120)), shadow_a)
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    logo.putalpha(a.point(lambda v: v * p["wm_opacity"]))
    sh.alpha_composite(logo, (x, y))
    base = im.convert("RGBA")
    base.alpha_composite(sh)
    return base.convert("RGB")


def encode_webp(im: Image.Image, quality: int, max_kb: int = 0) -> tuple[bytes, int]:
    """WebP با کیفیت داده‌شده؛ اگر سقف حجم داده شده، بالاترین کیفیتی که زیر سقف بماند."""
    def enc(q: int) -> bytes:
        b = io.BytesIO()
        im.save(b, "WEBP", quality=q, method=5)
        return b.getvalue()

    data = enc(quality)
    if not max_kb or len(data) <= max_kb * 1024:
        return data, quality
    lo, hi, best = 10, quality - 1, None
    while lo <= hi:
        m = (lo + hi) // 2
        d = enc(m)
        if len(d) <= max_kb * 1024:
            best, lo = (d, m), m + 1
        else:
            hi = m - 1
    return best or (enc(10), 10)


def out_name(filename: str, w: int, h: int) -> str:
    stem = Path(filename or "photo").stem or "photo"
    return f"{stem}_{w}x{h}.webp"


def make(media_id: int, raw: dict[str, Any]) -> tuple[bytes, str, dict[str, Any]]:
    m = teaser.get_media(int(media_id))
    if m["kind"] != "image":
        raise db.ValidationError("فقط عکس را می‌شود تنظیم کرد")
    p = params(raw)
    data, q = encode_webp(render(_open(m["path"]), p), p["quality"], p["max_kb"])
    return data, out_name(m["filename"], p["w"], p["h"]), {"quality": q, "kb": round(len(data) / 1024)}
