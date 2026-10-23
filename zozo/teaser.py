"""تیزرساز: بارگذاری عکس/ویدیو/موسیقی و ساخت کلیپ خبری عمودی یا افقی با ffmpeg روی سرور.

طراحی برای سرور کم‌حافظه:
- نوشته‌های فارسی (تیتر، زیرنویس، لوگو) در مرورگر روی «بوم» کشیده و به صورت تصویر PNG شفاف فرستاده می‌شوند؛
  این‌طوری حروف فارسی همیشه درست و چسبیده نمایش داده می‌شوند و سرور نیازی به موتور چیدمان متن ندارد.
- هر تکه (عکس یا ویدیو) جداگانه و پشت‌سرهم ساخته می‌شود، بعد تکه‌ها به هم چسبانده می‌شوند و در پایان
  نوشته‌ها، موسیقی و محوشدن اضافه می‌شود. در هر لحظه فقط یک ffmpeg اجرا می‌شود.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Any, BinaryIO

from . import db, documents, jalali, notify
from .config import settings

log = logging.getLogger(__name__)

FPS = 30
SIZES = {
    "9:16": {"720": (720, 1280), "1080": (1080, 1920)},
    "16:9": {"720": (1280, 720), "1080": (1920, 1080)},
    "1:1": {"720": (720, 720), "1080": (1080, 1080)},
    "4:5": {"720": (720, 900), "1080": (1080, 1350)},
}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}
VIDEO_EXT = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".3gp", ".m4v"}
AUDIO_EXT = {".mp3", ".m4a", ".wav", ".ogg", ".aac", ".opus", ".flac"}
MAX_TOTAL_SECONDS = 180
MAX_CLIPS = 40
MAX_OVERLAYS = 60

# ───── حرکت عکس، چیدمان چندتایی و گذار بین تکه‌ها (همان حساب‌های ریلزساز در مرورگر) ─────
PAN_AMT = {"low": 0.35, "mid": 0.65, "high": 0.85, "full": 1.0}     # چه بخشی از عکس پیموده شود
ZOOM_AMT = {"low": 0.06, "mid": 0.15, "high": 0.28, "full": 0.4}    # چقدر زوم شود
# چیدمان‌ها: مستطیل هر خانه نسبت به ناحیه‌ی چیدمان (x, y, w, h)؛ خانه‌ی اول سمت راست/بالا
GRID_LAYOUTS = {
    "2v": [(0, 0, 1, .5), (0, .5, 1, .5)],
    "2h": [(.5, 0, .5, 1), (0, 0, .5, 1)],
    "3t": [(0, 0, 1, .5), (.5, .5, .5, .5), (0, .5, .5, .5)],
    "3b": [(.5, 0, .5, .5), (0, 0, .5, .5), (0, .5, 1, .5)],
    "3v": [(0, 0, 1, 1 / 3), (0, 1 / 3, 1, 1 / 3), (0, 2 / 3, 1, 1 / 3)],
    "4": [(.5, 0, .5, .5), (0, 0, .5, .5), (.5, .5, .5, .5), (0, .5, .5, .5)],
}
TRANSITIONS = {"none", "fade", "flash", "cross", "slide"}
XFADE = {"cross": "fade", "slide": "slideright"}


def pan_geom(iw: float, ih: float, W: int, H: int, scale: float, ox: float, oy: float, amt: float, rev: bool):
    """پیمایش آرام روی عکس: اندازه‌ی عکس بزرگ‌شده و جای پنجره در آغاز و پایان (پیکسل)."""
    c = max(W / iw, H / ih) * max(1.0, scale)
    rw, rh = iw * c, ih * c
    if max((rw - W) / W, (rh - H) / H) < 0.15:   # عکس هم‌شکل قاب: کمی بزرگ‌تر تا جای حرکت باشد
        c *= 1.15 / max(rw / W, rh / H)
        rw, rh = iw * c, ih * c
    ovx, ovy = rw - W, rh - H
    cx = min(max(ovx / 2 - ox * W, 0), ovx)
    cy = min(max(ovy / 2 - oy * H, 0), ovy)
    if ovx / W >= ovy / H:
        tr = amt * ovx
        a, b = ovx / 2 + tr / 2, ovx / 2 - tr / 2       # از سمت راست عکس به چپ
        if rev:
            a, b = b, a
        return rw, rh, (a, cy), (b, cy)
    tr = amt * ovy
    a, b = ovy / 2 - tr / 2, ovy / 2 + tr / 2           # از بالا به پایین
    if rev:
        a, b = b, a
    return rw, rh, (cx, a), (cx, b)


def grid_cells(layout: str, region: tuple[float, float, float, float], gap: float) -> list[tuple[int, int, int, int]]:
    """مستطیل هر خانه به پیکسل (زوج)، با فاصله‌ی «gap» بین خانه‌ها و دور تا دور."""
    rx, ry, rw, rh = region
    out = []
    for fx, fy, fw, fh in GRID_LAYOUTS[layout]:
        x0 = rx + fx * rw + (gap if fx < 1e-6 else gap / 2)
        y0 = ry + fy * rh + (gap if fy < 1e-6 else gap / 2)
        x1 = rx + (fx + fw) * rw - (gap if fx + fw > 1 - 1e-6 else gap / 2)
        y1 = ry + (fy + fh) * rh - (gap if fy + fh > 1 - 1e-6 else gap / 2)
        x, y = int(round(x0 / 2) * 2), int(round(y0 / 2) * 2)
        out.append((x, y, max(2, int(round((x1 - x) / 2) * 2)), max(2, int(round((y1 - y) / 2) * 2))))
    return out


def available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def media_dir() -> Path:
    return settings.dir("media")


def teaser_dir() -> Path:
    return settings.dir("teasers")


# ───────────────────────── فایل‌های رسانه‌ای ─────────────────────────


def probe(path: str) -> dict[str, Any]:
    res = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type,width,height:stream_tags=rotate:stream_side_data=rotation:format=duration",
         "-of", "json", path],
        capture_output=True, text=True, timeout=60,
    )
    if res.returncode != 0:
        raise db.ValidationError("فایل خراب است یا قالب آن پشتیبانی نمی‌شود")
    info = json.loads(res.stdout or "{}")
    out: dict[str, Any] = {"width": None, "height": None, "duration": None, "has_audio": 0}
    for s in info.get("streams", []):
        if s.get("codec_type") == "video" and out["width"] is None:
            w, h = s.get("width"), s.get("height")
            rot = abs(int(float((s.get("tags") or {}).get("rotate", 0) or 0)))
            for sd in s.get("side_data_list") or []:
                if "rotation" in sd:
                    rot = abs(int(float(sd["rotation"])))
            if rot in (90, 270):
                w, h = h, w
            out["width"], out["height"] = w, h
        if s.get("codec_type") == "audio":
            out["has_audio"] = 1
    try:
        out["duration"] = round(float(info.get("format", {}).get("duration")), 2)
    except (TypeError, ValueError):
        pass
    return out


def media_kind(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext in IMAGE_EXT:
        return "image"
    if ext in VIDEO_EXT:
        return "video"
    if ext in AUDIO_EXT:
        return "audio"
    raise db.ValidationError(f"نوع فایل برای تیزر پشتیبانی نمی‌شود: {ext}. مجاز: عکس، ویدیو، صوت")


def _thumb(src: str, dst: str, kind: str, duration: float | None) -> bool:
    args = ["ffmpeg", "-y", "-v", "error"]
    if kind == "video":
        args += ["-ss", str(min(1.0, (duration or 2) / 2))]
    args += ["-i", src, "-frames:v", "1", "-vf", "scale=320:320:force_original_aspect_ratio=decrease", dst]
    try:
        return subprocess.run(args, capture_output=True, timeout=60).returncode == 0
    except subprocess.TimeoutExpired:
        return False


def add_media(fileobj: BinaryIO, filename: str, keep: bool = True) -> dict[str, Any]:
    if not available():
        raise db.ValidationError("ffmpeg روی سرور نصب نیست")
    kind = media_kind(filename)
    tmp, size, _ = documents.save_upload(fileobj, media_dir(), settings.max_upload_mb * 1024 * 1024)
    try:
        info = probe(tmp)
        if kind == "image" and filename.lower().endswith(".gif") and (info["duration"] or 0) > 0.2:
            kind = "video"  # GIF متحرک مثل ویدیو (بی‌صدا) پخش می‌شود
        if kind in ("image", "video") and not info["width"]:
            raise db.ValidationError("تصویری در این فایل پیدا نشد")
        if kind == "image":
            info["duration"] = None
        with db.connect() as conn:
            cur = conn.execute(
                "INSERT INTO media (filename, path, kind, size, width, height, duration, has_audio, created_at, keep) "
                "VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?)",
                (filename, kind, size, info["width"], info["height"], info["duration"], info["has_audio"], db.now_str(),
                 1 if keep else 0),
            )
            mid = cur.lastrowid
            final = media_dir() / f"{mid}_{documents.safe_name(filename)}"
            os.replace(tmp, final)
            thumb = None
            if kind != "audio":
                t = media_dir() / f"{mid}_thumb.jpg"
                thumb = str(t) if _thumb(str(final), str(t), kind, info["duration"]) else None
            conn.execute("UPDATE media SET path=?, thumb=? WHERE id=?", (str(final), thumb, mid))
            return get_media(mid, conn)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def add_media_dataurl(data_url: str, name: str = "card.png") -> dict[str, Any]:
    """کارت‌های ساخته‌شده در مرورگر (کارت آغاز/پایان) به صورت data URL."""
    import io

    raw = _decode_png(data_url)
    return add_media(io.BytesIO(raw), name)


# ویدیوی پایانی کرمان راوی (داخل برنامه) — یک بار به‌عنوان فایل پنهان در کتابخانه ثبت می‌شود
BUILTIN_OUTRO = Path(__file__).parent / "static" / "brand" / "outro.mp4"
BUILTIN_OUTRO_NAME = "builtin-outro-kermanravi-v1.mp4"


def builtin_outro() -> dict[str, Any]:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM media WHERE filename=? ORDER BY id DESC LIMIT 1", (BUILTIN_OUTRO_NAME,)).fetchone()
    if row and os.path.exists(row["path"]):
        return dict(row)
    if row:  # فایلش گم شده؛ دوباره ثبت شود
        with db.connect() as conn:
            conn.execute("DELETE FROM media WHERE id=?", (row["id"],))
    with open(BUILTIN_OUTRO, "rb") as f:
        return add_media(f, BUILTIN_OUTRO_NAME, keep=True)


def get_media(mid: int, conn=None) -> dict[str, Any]:
    if conn is None:
        with db.connect() as c:
            return get_media(mid, c)
    row = conn.execute("SELECT * FROM media WHERE id=?", (mid,)).fetchone()
    if not row:
        raise db.NotFound("فایل پیدا نشد")
    return dict(row)


def list_media(kind: str | None = None) -> list[dict[str, Any]]:
    with db.connect() as conn:
        if kind:
            rows = conn.execute("SELECT * FROM media WHERE kind=? AND filename NOT LIKE 'card-%' AND filename NOT LIKE 'builtin-%' ORDER BY id DESC LIMIT 300",
                                (kind,))
        else:
            rows = conn.execute("SELECT * FROM media WHERE filename NOT LIKE 'card-%' AND filename NOT LIKE 'builtin-%' ORDER BY id DESC LIMIT 300")
        return [dict(r) for r in rows]


TEMP_DAYS = 2  # فایل موقت و تصویرهای کمکی ساخت (card-…) پس از این مدت پاک می‌شوند


def set_keep(mid: int, keep: bool) -> dict[str, Any]:
    get_media(mid)
    with db.connect() as conn:
        conn.execute("UPDATE media SET keep=? WHERE id=?", (1 if keep else 0, mid))
        return get_media(mid, conn)


def media_usage() -> dict[str, Any]:
    with db.connect() as conn:
        r = conn.execute(
            "SELECT COUNT(*) n, COALESCE(SUM(size),0) b, COALESCE(SUM(CASE WHEN keep=0 THEN 1 END),0) tn, "
            "COALESCE(SUM(CASE WHEN keep=0 THEN size END),0) tb FROM media WHERE filename NOT LIKE 'card-%' AND filename NOT LIKE 'builtin-%'").fetchone()
        v = conn.execute("SELECT COUNT(*) n, COALESCE(SUM(size),0) b FROM teasers WHERE output IS NOT NULL").fetchone()
    return {"count": r["n"], "bytes": r["b"], "temp_count": r["tn"], "temp_bytes": r["tb"],
            "video_count": v["n"], "video_bytes": v["b"], "temp_days": TEMP_DAYS}


def cleanup_media() -> int:
    """پاک کردن فایل‌های موقت قدیمی و تصویرهای کمکی ساخت ویدیو (وقتی ویدیویی در حال ساخت نیست)."""
    import datetime as dt

    cutoff = jalali.to_jalali(settings.now() - dt.timedelta(days=TEMP_DAYS), with_time=True)
    with db.connect() as conn:
        if conn.execute("SELECT 1 FROM teasers WHERE status IN ('queued','rendering') LIMIT 1").fetchone():
            return 0
        ids = [r["id"] for r in conn.execute(
            "SELECT id FROM media WHERE created_at < ? AND (keep=0 OR filename LIKE 'card-%')", (cutoff,))]
    for mid in ids:
        try:
            delete_media(mid)
        except Exception:  # noqa: BLE001
            log.exception("پاک کردن فایل موقت %s ناموفق بود", mid)
    if ids:
        log.info("%d فایل موقت/کمکی ریلز پاک شد", len(ids))
    return len(ids)


def delete_media(mid: int) -> None:
    m = get_media(mid)
    with db.connect() as conn:
        conn.execute("DELETE FROM media WHERE id=?", (mid,))
    for p in (m["path"], m["thumb"]):
        if p and os.path.exists(p):
            os.unlink(p)


# ───────────────────────── مشخصات تیزر ─────────────────────────

_DATA_URL = re.compile(r"^data:image/png;base64,([A-Za-z0-9+/=\s]+)$")


def _decode_png(data_url: str) -> bytes:
    m = _DATA_URL.match(data_url or "")
    if not m:
        raise db.ValidationError("تصویر نوشته‌ها نامعتبر است")
    raw = base64.b64decode(m.group(1))
    if not raw.startswith(b"\x89PNG") or len(raw) > 12 * 1024 * 1024:
        raise db.ValidationError("تصویر نوشته‌ها نامعتبر است")
    return raw


def _num(v: Any, default: float, lo: float, hi: float) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, x))


def validate_spec(spec: dict[str, Any]) -> dict[str, Any]:
    """بررسی و کامل کردن مشخصات؛ مدت هر تکه و کل کلیپ را حساب می‌کند."""
    fmt = spec.get("format") if spec.get("format") in SIZES else "9:16"
    quality = str(spec.get("quality") or "720")
    quality = quality if quality in ("720", "1080") else "720"
    clips_in = spec.get("clips") or []
    if not clips_in:
        raise db.ValidationError("حداقل یک عکس یا ویدیو اضافه کنید")
    if len(clips_in) > MAX_CLIPS:
        raise db.ValidationError(f"حداکثر {MAX_CLIPS} تکه")
    clips = []
    for c in clips_in:
        if c.get("outro_bg"):
            # پایانِ مُهری: پس‌زمینه + لوگویی که مثل مُهر روی صفحه می‌خورد (در ffmpeg متحرک می‌شود)
            bg, lg = get_media(int(c["outro_bg"])), get_media(int(c["outro_logo"]))
            clips.append({"kind": "outro", "bg": bg["path"], "logo": lg["path"],
                          "duration": round(_num(c.get("duration"), 2.6, 1.0, 15), 2),
                          "logo_w": _num(c.get("logo_w"), 0.55, 0.1, 1.0), "logo_y": _num(c.get("logo_y"), 0.42, 0.05, 0.95),
                          "drop": _num(c.get("drop"), 0.25, 0, 3), "land": _num(c.get("land"), 0.85, 0.3, 5),
                          "zoom": False, "gray": False, "start": 0.0, "has_audio": 0})
            continue
        if c.get("grid"):
            clips.append(_grid_clip(c["grid"]))
            clips[-1]["tin"] = _tin(c.get("tin"))
            continue
        m = get_media(int(c["media_id"]))
        if m["kind"] not in ("image", "video"):
            raise db.ValidationError(f"«{m['filename']}» عکس یا ویدیو نیست")
        speed = 1.0
        if m["kind"] == "image":
            dur = _num(c.get("duration"), 3.0, 0.5, 60)  # هم‌اندازه با ریلزساز (عکس بدنه با زیرنویس‌های لید)
            start = 0.0
        else:
            total = m["duration"] or 0
            start = _num(c.get("start"), 0.0, 0, max(0.0, total - 0.3))
            # سرعت پخش (۰٫۲۵ = چهار برابر کندتر … ۲ = دو برابر تندتر)؛ مدت = طول تکه در خود ریلز
            speed = _num(c.get("speed"), 1.0, 0.25, 2.0)
            room = max(0.3, (total - start) / speed)
            dur = _num(c.get("duration") or room, room, 0.3, room)
        clips.append({"media_id": m["id"], "kind": m["kind"], "path": m["path"], "has_audio": m["has_audio"],
                      "start": round(start, 2), "duration": round(dur, 2), "zoom": bool(c.get("zoom", True)),
                      "gray": bool(c.get("gray", False)),
                      # جا و اندازه‌ی عکس/ویدیو در قاب: بزرگ‌نمایی و جابه‌جایی (نسبتی از عرض/ارتفاع قاب)
                      "scale": _num(c.get("scale"), 1.0, 0.3, 4.0), "ox": _num(c.get("ox"), 0.0, -1.0, 1.0),
                      "oy": _num(c.get("oy"), 0.0, -1.0, 1.0),
                      "bright": _num(c.get("bright"), 0.0, -0.8, 0.8),
                      "motion": c.get("motion") if c.get("motion") in ("zoom", "zoomout", "pan", "none") else None,
                      "mamt": c.get("mamt") if c.get("mamt") in PAN_AMT else None, "mrev": bool(c.get("mrev")),
                      "iw": m["width"], "ih": m["height"], "tin": _tin(c.get("tin")),
                      "mute": bool(c.get("mute", False)), "vol": _num(c.get("vol"), 1.0, 0, 3),
                      "speed": speed if m["kind"] == "video" else 1.0})
    # گذار بین دو تکه‌ی پشت سر هم: «محو/فلش» داخل خود تکه‌ها، «درهم/کشویی» با هم‌پوشانی
    for i, c in enumerate(clips):
        t = c.get("tin")
        if not t or i == 0 or clips[i - 1]["kind"] == "outro" or c["kind"] == "outro":
            c["tin"] = None
            continue
        prev = clips[i - 1]
        t["dur"] = round(min(t["dur"], prev["duration"] * 0.45, c["duration"] * 0.45), 2)
        if t["dur"] < 0.1:
            c["tin"] = None
        elif t["type"] in ("fade", "flash"):
            col = "white" if t["type"] == "flash" else "black"
            prev["fout"] = [col, round(t["dur"] / 2, 2)]
            c["fin"] = [col, round(t["dur"] / 2, 2)]
    overlap = sum(c["tin"]["dur"] for c in clips if c.get("tin") and c["tin"]["type"] in XFADE)
    total = round(sum(c["duration"] for c in clips) - overlap, 2)
    if total > MAX_TOTAL_SECONDS:
        raise db.ValidationError(f"مدت کل کلیپ ({total:.0f} ثانیه) بیش از {MAX_TOTAL_SECONDS} ثانیه است")
    overlays = []
    for o in (spec.get("overlays") or [])[:MAX_OVERLAYS]:
        _decode_png(o.get("image", ""))
        s = _num(o.get("start"), 0, 0, total)
        e = _num(o.get("end"), total, s, total)
        if e - s > 0.05:
            overlays.append({"image": o["image"], "start": round(s, 2), "end": round(e, 2)})
    # صداهای جدا روی خط زمان (موسیقی شروع، صدای مُهر، …)
    tracks = []
    for t in (spec.get("tracks") or [])[:6]:
        m = get_media(int(t["media_id"]))
        if m["kind"] not in ("audio", "video") or not m["has_audio"]:
            raise db.ValidationError(f"«{m['filename']}» صدا ندارد")
        at = _num(t.get("at"), 0, 0, total)
        dur = _num(t.get("dur"), total - at, 0.1, max(0.1, total - at))
        tracks.append({"path": m["path"], "src": _num(t.get("src"), 0, 0, max(0, (m["duration"] or 0) - 0.1)),
                       "at": round(at, 2), "dur": round(dur, 2), "vol": _num(t.get("vol"), 1, 0, 3),
                       "fin": _num(t.get("fin"), 0, 0, 10), "fout": _num(t.get("fout"), 0, 0, 10),
                       "loop": bool(t.get("loop", True)),
                       "duck": [[_num(d[0], 0, 0, total), _num(d[1], 0, 0, total), _num(d[2], 1, 0, 1)]
                                for d in (t.get("duck") or [])[:8] if isinstance(d, (list, tuple)) and len(d) == 3]})
    music = None
    if spec.get("music_id"):
        m = get_media(int(spec["music_id"]))
        if m["kind"] not in ("audio", "video") or not m["has_audio"]:
            raise db.ValidationError("فایل موسیقی صدا ندارد")
        music = {"path": m["path"], "volume": _num(spec.get("music_volume"), 0.35, 0, 2),
                 "start": _num(spec.get("music_start"), 0, 0, max(0, (m["duration"] or 0) - 1))}
    return {
        "title": str(spec.get("title") or "تیزر بدون عنوان")[:200],
        "format": fmt, "quality": quality, "size": SIZES[fmt][quality],
        "fit": spec.get("fit") if spec.get("fit") in ("blur", "crop", "fit") else "blur",
        "bg_color": spec.get("bg_color") if re.fullmatch(r"#[0-9a-fA-F]{6}", str(spec.get("bg_color") or "")) else "#000000",
        "transition": spec.get("transition") if spec.get("transition") in ("fade", "none") else "fade",
        "keep_audio": bool(spec.get("keep_audio", True)),
        "video_volume": _num(spec.get("video_volume"), 1.0, 0, 3),
        "fade": bool(spec.get("fade", True)),
        "clips": clips, "overlays": overlays, "music": music, "tracks": tracks, "total": total,
        "captions": [{"text": str(c.get("text", ""))[:300], "start": _num(c.get("start"), 0, 0, total),
                      "end": _num(c.get("end"), 0, 0, total)} for c in (spec.get("captions") or [])[:200]],
        "editor": spec.get("editor") if isinstance(spec.get("editor"), dict) else None,
    }


def _tin(t: Any) -> dict[str, Any] | None:
    if not isinstance(t, dict) or t.get("type") not in TRANSITIONS or t.get("type") == "none":
        return None
    return {"type": t["type"], "dur": _num(t.get("dur"), 0.5, 0.1, 2.0)}


def _grid_clip(g: dict[str, Any]) -> dict[str, Any]:
    layout = g.get("layout") if g.get("layout") in GRID_LAYOUTS else "2v"
    n = len(GRID_LAYOUTS[layout])
    dur = _num(g.get("duration"), 5.0, 0.5, 60)
    cells: list[dict[str, Any] | None] = []
    for c in (g.get("cells") or [])[:n]:
        if not c or not c.get("media_id"):
            cells.append(None)
            continue
        m = get_media(int(c["media_id"]))
        if m["kind"] not in ("image", "video"):
            raise db.ValidationError(f"«{m['filename']}» عکس یا ویدیو نیست")
        cells.append({"path": m["path"], "kind": m["kind"], "has_audio": m["has_audio"],
                      "start": _num(c.get("start"), 0, 0, max(0.0, (m["duration"] or 0) - 0.3)) if m["kind"] == "video" else 0.0,
                      "scale": _num(c.get("scale"), 1.0, 1.0, 4.0), "ox": _num(c.get("ox"), 0, -1, 1), "oy": _num(c.get("oy"), 0, -1, 1),
                      "mute": bool(c.get("mute", False)), "vol": _num(c.get("vol"), 1.0, 0, 3)})
    if not any(cells):
        raise db.ValidationError("در چیدمان چندتایی دست‌کم یک عکس یا ویدیو بگذارید")
    cells += [None] * (n - len(cells))
    reg = list(g.get("region") or [0, 0, 1, 1]) + [1, 1, 1, 1]
    region = (_num(reg[0], 0, 0, 1), _num(reg[1], 0, 0, 1), _num(reg[2], 1, 0.05, 1), _num(reg[3], 1, 0.05, 1))
    col = g.get("gap_color") if re.fullmatch(r"#[0-9a-fA-F]{6}", str(g.get("gap_color") or "")) else "#ffffff"
    return {"kind": "grid", "layout": layout, "duration": round(dur, 2), "cells": cells, "region": region,
            "gap": _num(g.get("gap"), 12, 0, 80), "gap_color": col, "zoom": False, "gray": False, "start": 0.0, "has_audio": 0}


# ───────────────────────── ساخت فرمان‌های ffmpeg ─────────────────────────


def _place_filter(fit: str, w: int, h: int, bg: str, scale: float = 1.0, ox: float = 0.0, oy: float = 0.0) -> str:
    """قرار دادن تصویر ورودی [0:v] در قاب W×H (با بزرگ‌نمایی و جابه‌جایی دلخواه). خروجی برچسب [pv]."""
    framed = abs(scale - 1) > 0.005 or abs(ox) > 0.002 or abs(oy) > 0.002
    if framed:
        ev = f"trunc(iw*{scale:.4f}/2)*2:trunc(ih*{scale:.4f}/2)*2"
        if fit == "crop":
            # پر کردن قاب، بزرگ‌نمایی، بعد برش از جای دلخواه (پشت لبه‌ها سیاه نمی‌ماند)
            sc = max(1.0, scale)
            return (f"[0:v]scale={w}:{h}:force_original_aspect_ratio=increase,"
                    f"scale=trunc(iw*{sc:.4f}/2)*2:trunc(ih*{sc:.4f}/2)*2,"
                    f"crop={w}:{h}:'max(0,min(iw-{w},(iw-{w})/2-({ox:.4f})*{w}))':"
                    f"'max(0,min(ih-{h},(ih-{h})/2-({oy:.4f})*{h}))',setsar=1[pv]")
        sw, sh = w // 8 * 2, h // 8 * 2
        if fit == "fit":
            bgf = f"[a]scale={w}:{h},drawbox=x=0:y=0:w=iw:h=ih:color={bg}:t=fill[bg];"
        else:
            bgf = (f"[a]scale={sw}:{sh}:force_original_aspect_ratio=increase,crop={sw}:{sh},"
                   f"boxblur=8:2,eq=brightness=-0.12,scale={w}:{h}[bg];")
        return (f"[0:v]split=2[a][b];{bgf}"
                f"[b]scale={w}:{h}:force_original_aspect_ratio=decrease,scale={ev}[fg];"
                f"[bg][fg]overlay=(W-w)/2+({ox:.4f})*W:(H-h)/2+({oy:.4f})*H,setsar=1[pv]")
    if fit == "crop":
        return f"[0:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1[pv]"
    if fit == "fit":
        return (f"[0:v]scale={w}:{h}:force_original_aspect_ratio=decrease,"
                f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color={bg},setsar=1[pv]")
    # پس‌زمینه‌ی تار از خود تصویر (مناسب ویدیوی افقی در قاب عمودی)؛ تار کردن در اندازه‌ی کوچک = سریع و کم‌حافظه
    sw, sh = w // 8 * 2, h // 8 * 2
    return (f"[0:v]split=2[a][b];"
            f"[a]scale={sw}:{sh}:force_original_aspect_ratio=increase,crop={sw}:{sh},"
            f"boxblur=8:2,eq=brightness=-0.12,scale={w}:{h}[bg];"
            f"[b]scale={w}:{h}:force_original_aspect_ratio=decrease[fg];"
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[pv]")


# همه‌ی تکه‌ها باید یک رنگ‌بندی داشته باشند؛ وگرنه ffmpeg وسط ویدیوی نهایی فیلترها را از نو می‌سازد
# و لایه‌های رو (قاب، نوشته‌ها، زیرنویس) از آن لحظه به بعد گم می‌شوند.
SEG_COLOR = "scale=out_range=tv:out_color_matrix=bt709,format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709"
SEG_ENC = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "16", "-pix_fmt", "yuv420p",
           "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"]


def outro_cmd(clip: dict[str, Any], spec: dict[str, Any], out: str) -> list[str]:
    """پایان مُهری: لوگو بزرگ و کم‌رنگ از بالا می‌آید، محکم می‌نشیند (کمی فشرده می‌شود) و می‌ماند."""
    w, h = spec["size"]
    d = clip["duration"]
    a, land = clip["drop"], clip["land"]
    fall = max(0.15, land - a)
    lw = round(w * clip["logo_w"] / 2) * 2
    cy = round(h * clip["logo_y"])
    s_expr = (f"if(lt(t,{a:.3f}),2.3,if(lt(t,{land:.3f}),1+1.3*pow(1-(t-{a:.3f})/{fall:.3f},2),"
              f"1-0.05*sin(PI*min(1,(t-{land:.3f})/0.18))))")
    fc = (f"[0:v]scale={w}:{h},setsar=1,fps={FPS},format=yuv420p[bg];"
          f"[1:v]format=rgba,fps={FPS},scale=w='trunc({lw}*{s_expr}/2)*2':h=-2:eval=frame,"
          f"fade=t=in:st={a:.3f}:d={fall * 0.75:.3f}:alpha=1[lg];"
          f"[bg][lg]overlay=x='(W-w)/2':y='{cy}-h/2':format=auto,{SEG_COLOR}[v]")
    return ["ffmpeg", "-y", "-v", "error", "-nostdin", "-loop", "1", "-t", f"{d:.2f}", "-i", clip["bg"],
            "-loop", "1", "-t", f"{d:.2f}", "-i", clip["logo"],
            "-f", "lavfi", "-t", f"{d:.2f}", "-i", "anullsrc=r=44100:cl=stereo",
            "-filter_complex", fc, "-map", "[v]", "-map", "2:a", "-t", f"{d:.2f}", "-r", str(FPS),
            *SEG_ENC, "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2", "-threads", str(settings.render_threads), out]


def _atempo(speed: float) -> str:
    """تغییر سرعت صدا بدون تغییر زیر و بمی (هر atempo بین ۰٫۵ و ۲)."""
    if abs(speed - 1) < 0.001:
        return ""
    parts = []
    while speed < 0.5:
        parts.append("atempo=0.5")
        speed /= 0.5
    parts.append(f"atempo={speed:.4f}")
    return ",".join(parts) + ","


def segment_cmd(clip: dict[str, Any], spec: dict[str, Any], out: str) -> list[str]:
    if clip["kind"] == "outro":
        return outro_cmd(clip, spec, out)
    if clip["kind"] == "grid":
        return grid_cmd(clip, spec, out)
    w, h = spec["size"]
    d = clip["duration"]
    frames = max(1, round(d * FPS))
    args = ["ffmpeg", "-y", "-v", "error", "-nostdin"]
    if clip["kind"] == "image":
        args += ["-i", clip["path"]]
    else:
        args += ["-ss", f"{clip['start']:.2f}", "-t", f"{d * clip.get('speed', 1.0) + 0.05:.2f}", "-i", clip["path"]]
    use_audio = clip["kind"] == "video" and clip["has_audio"] and spec["keep_audio"] and not clip.get("mute")
    if not use_audio:
        args += ["-f", "lavfi", "-t", f"{d:.2f}", "-i", "anullsrc=r=44100:cl=stereo"]
    fc = [_place_filter(spec["fit"], w, h, spec["bg_color"], clip.get("scale", 1.0), clip.get("ox", 0.0), clip.get("oy", 0.0))]
    if clip.get("gray"):
        fc[0] = fc[0][: -len("[pv]")] + ",hue=s=0[pv]"
    if abs(clip.get("bright") or 0) > 0.005:
        fc[0] = fc[0][: -len("[pv]")] + f",eq=brightness={clip['bright']:.3f}[pv]"
    motion = clip.get("motion") or ("zoom" if clip["zoom"] else "none")
    if clip["kind"] == "image":
        if motion == "pan" and clip.get("iw") and clip.get("ih"):
            # پیمایش روی کل عکس (یا بخشی از آن) دقیقاً در طول همین تکه؛ با دقت نیم‌پیکسل تا لرزش نداشته باشد
            rw, rh, (x0, y0), (x1, y1) = pan_geom(clip["iw"], clip["ih"], w, h, clip.get("scale", 1.0), clip.get("ox", 0.0),
                                                  clip.get("oy", 0.0), PAN_AMT[clip.get("mamt") or "mid"], clip.get("mrev", False))
            R = 2
            sw, sh = int(round(rw * R / 2) * 2), int(round(rh * R / 2) * 2)
            n1 = max(1, frames - 1)
            fx = f"min({sw - w * R},max(0,{x0 * R:.2f}+({(x1 - x0) * R:.2f})*n/{n1}))"
            fy = f"min({sh - h * R},max(0,{y0 * R:.2f}+({(y1 - y0) * R:.2f})*n/{n1}))"
            post = (",hue=s=0" if clip.get("gray") else "") + (f",eq=brightness={clip['bright']:.3f}" if abs(clip.get("bright") or 0) > 0.005 else "")
            fc = [f"[0:v]scale={sw}:{sh},setsar=1,loop=loop={frames - 1}:size=1:start=0,setpts=N/{FPS}/TB,"
                  f"crop={w * R}:{h * R}:x='{fx}':y='{fy}',scale={w}:{h}{post}[mv]"]
        elif motion == "pan":
            fc.append(f"[pv]scale={w * 2}:{h * 2},zoompan=z='1.12':d={frames}:"
                      f"x='(iw-iw/zoom)*on/{frames}':y='ih/2-(ih/zoom/2)':s={w}x{h}:fps={FPS}[mv]")
        elif motion in ("zoom", "zoomout"):
            # زوم آرام به داخل یا بیرون (افکت کن برنز) روی تصویر ۲ برابر برای حرکت نرم‌تر
            za = ZOOM_AMT[clip["mamt"]] if clip.get("mamt") else 0.08
            z = f"1+{za}*on/{frames}" if motion == "zoom" else f"{1 + za}-{za}*on/{frames}"
            fc.append(f"[pv]scale={w * 2}:{h * 2},zoompan=z='{z}':d={frames}:"
                      f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={w}x{h}:fps={FPS}[mv]")
        else:
            fc.append(f"[pv]loop=loop={frames - 1}:size=1:start=0,setpts=N/{FPS}/TB[mv]")
    else:
        sp = clip.get("speed", 1.0)
        fc.append(f"[pv]{f'setpts=PTS/{sp:.4f},' if abs(sp - 1) > 0.001 else ''}fps={FPS}[mv]")
    vlast = "[mv]"
    if spec["transition"] == "fade" and d >= 1.2:
        fc.append(f"{vlast}fade=t=in:st=0:d=0.25,fade=t=out:st={d - 0.25:.2f}:d=0.25[fv]")
        vlast = "[fv]"
    fades = _dip_fades(clip, d)
    if fades:
        fc.append(f"{vlast}{fades}[dv]")
        vlast = "[dv]"
    fc.append(f"{vlast}{SEG_COLOR}[v]")
    if use_audio:
        fc.append(f"[0:a]aresample=44100,aformat=channel_layouts=stereo,{_atempo(clip.get('speed', 1.0))}"
                  f"volume={spec['video_volume'] * clip.get('vol', 1.0):.2f},"
                  f"apad,atrim=0:{d:.2f}[a]")
        amap = "[a]"
    else:
        amap = "1:a"
    args += ["-filter_complex", ";".join(fc), "-map", "[v]", "-map", amap,
             "-t", f"{d:.2f}", "-r", str(FPS),
             *SEG_ENC, "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2",
             "-threads", str(settings.render_threads), out]
    return args


def _dip_fades(clip: dict[str, Any], d: float) -> str:
    """محو از/به سیاه یا سفید در آغاز و پایان تکه (گذار «محو» و «فلش»)."""
    out = []
    if clip.get("fin"):
        col, fd = clip["fin"]
        out.append(f"fade=t=in:st=0:d={fd:.2f}:color={col}")
    if clip.get("fout"):
        col, fd = clip["fout"]
        out.append(f"fade=t=out:st={max(0.0, d - fd):.2f}:d={fd:.2f}:color={col}")
    return ",".join(out)


def grid_cmd(clip: dict[str, Any], spec: dict[str, Any], out: str) -> list[str]:
    """چند عکس/ویدیو هم‌زمان در خانه‌های یک چیدمان، با فاصله‌ی رنگی بین خانه‌ها."""
    w, h = spec["size"]
    d = clip["duration"]
    frames = max(1, round(d * FPS))
    rx, ry, rw, rh = clip["region"]
    region = (rx * w, ry * h, rw * w, rh * h)
    rects = grid_cells(clip["layout"], region, clip["gap"] * w / 1080)
    args = ["ffmpeg", "-y", "-v", "error", "-nostdin"]
    fc = [f"color=c={spec['bg_color']}:s={w}x{h}:r={FPS}:d={d:.2f},format=yuv420p,"
          f"drawbox=x={int(region[0])}:y={int(region[1])}:w={int(round(region[2]))}:h={int(round(region[3]))}:color={clip['gap_color']}:t=fill[g0]"]
    cur, k, auds = "[g0]", 0, []
    for cell, (x, y, cw, ch) in zip(clip["cells"], rects):
        if not cell:
            continue
        if cell["kind"] == "image":
            args += ["-i", cell["path"]]
            src = f"[{k}:v]loop=loop={frames - 1}:size=1:start=0,setpts=N/{FPS}/TB"
        else:
            args += ["-ss", f"{cell['start']:.2f}", "-t", f"{d + 0.05:.2f}", "-i", cell["path"]]
            src = f"[{k}:v]setpts=PTS-STARTPTS,fps={FPS},tpad=stop_mode=clone:stop_duration={d:.2f}"
            if cell["has_audio"] and spec["keep_audio"] and not cell["mute"]:
                fc.append(f"[{k}:a]aresample=44100,aformat=channel_layouts=stereo,volume={cell['vol']:.2f},apad,atrim=0:{d:.2f}[ga{k}]")
                auds.append(f"[ga{k}]")
        sc, ox, oy = cell["scale"], cell["ox"], cell["oy"]
        fc.append(f"{src},scale={cw}:{ch}:force_original_aspect_ratio=increase,"
                  f"scale=trunc(iw*{sc:.4f}/2)*2:trunc(ih*{sc:.4f}/2)*2,"
                  f"crop={cw}:{ch}:'max(0,min(iw-{cw},(iw-{cw})/2-({ox:.4f})*{cw}))':'max(0,min(ih-{ch},(ih-{ch})/2-({oy:.4f})*{ch}))',"
                  f"setsar=1,format=yuv420p[c{k}]")
        fc.append(f"{cur}[c{k}]overlay={x}:{y}:eof_action=repeat[g{k + 1}]")
        cur = f"[g{k + 1}]"
        k += 1
    fades = _dip_fades(clip, d)
    fc.append(f"{cur}trim=duration={d:.2f}{',' + fades if fades else ''},{SEG_COLOR}[v]")
    if auds:
        fc.append(f"{''.join(auds)}amix=inputs={len(auds)}:duration=longest:normalize=0,atrim=0:{d:.2f}[a]" if len(auds) > 1
                  else f"{auds[0]}anull[a]")
        amap = "[a]"
    else:
        args += ["-f", "lavfi", "-t", f"{d:.2f}", "-i", "anullsrc=r=44100:cl=stereo"]
        amap = f"{k}:a"
    return [*args, "-filter_complex", ";".join(fc), "-map", "[v]", "-map", amap, "-t", f"{d:.2f}", "-r", str(FPS),
            *SEG_ENC, "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2", "-threads", str(settings.render_threads), out]


def join_cmd(paths: list[str], durs: list[float], tins: list[dict[str, Any] | None], out: str) -> list[str]:
    """چند تکه‌ی پشت سر هم با گذار هم‌پوشان (محو درهم / کشویی) به یک تکه."""
    args = ["ffmpeg", "-y", "-v", "error", "-nostdin"]
    for p in paths:
        args += ["-i", p]
    fc, v, a, length = [], "[0:v]", "[0:a]", durs[0]
    for i in range(1, len(paths)):
        t = tins[i]
        off = max(0.0, length - t["dur"])
        fc.append(f"{v}[{i}:v]xfade=transition={XFADE[t['type']]}:duration={t['dur']:.2f}:offset={off:.3f}[xv{i}]")
        fc.append(f"{a}[{i}:a]acrossfade=d={t['dur']:.2f}[xa{i}]")
        v, a = f"[xv{i}]", f"[xa{i}]"
        length = off + durs[i]
    fc.append(f"{v}{SEG_COLOR}[v]")
    return [*args, "-filter_complex", ";".join(fc), "-map", "[v]", "-map", a, "-r", str(FPS),
            *SEG_ENC, "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2", "-threads", str(settings.render_threads), out]


def final_cmd(spec: dict[str, Any], concat_path: str, overlay_paths: list[str], out: str) -> list[str]:
    total = spec["total"]
    args = ["ffmpeg", "-y", "-v", "error", "-nostdin", "-progress", "pipe:1", "-nostats", "-reinit_filter", "0", "-i", concat_path]
    for p in overlay_paths:
        args += ["-i", p]
    music_idx = None
    if spec["music"]:
        music_idx = 1 + len(overlay_paths)
        args += ["-stream_loop", "-1", "-ss", f"{spec['music']['start']:.2f}", "-i", spec["music"]["path"]]
    fc, v = [], "[0:v]"
    for i, o in enumerate(spec["overlays"]):
        nxt = f"[o{i}]"
        fc.append(f"{v}[{i + 1}:v]overlay=0:0:enable='between(t,{o['start']:.2f},{o['end']:.2f})'{nxt}")
        v = nxt
    vf = []
    if spec["fade"]:
        vf.append("fade=t=in:st=0:d=0.4")
        if total > 2:
            vf.append(f"fade=t=out:st={total - 0.6:.2f}:d=0.6")
    vf.append("format=yuv420p")
    fc.append(f"{v}{','.join(vf)}[v]")
    tracks = spec.get("tracks") or []
    first_track = 1 + len(overlay_paths) + (1 if music_idx is not None else 0)
    for t in tracks:
        if t["loop"]:
            args += ["-stream_loop", "-1"]
        args += ["-ss", f"{t['src']:.2f}", "-i", t["path"]]
    if tracks:
        labels = []
        for k, t in enumerate(tracks):
            chain = [f"[{first_track + k}:a]aresample=44100,aformat=channel_layouts=stereo",
                     f"atrim=0:{t['dur']:.2f}", "asetpts=PTS-STARTPTS"]
            if t["fin"] > 0:
                chain.append(f"afade=t=in:st=0:d={min(t['fin'], t['dur']):.2f}")
            if t["fout"] > 0:
                chain.append(f"afade=t=out:st={max(0.0, t['dur'] - t['fout']):.2f}:d={min(t['fout'], t['dur']):.2f}")
            chain.append(f"volume={t['vol']:.2f}")
            ms = int(round(t["at"] * 1000))
            if ms:
                chain.append(f"adelay={ms}|{ms}")
            if t["duck"]:
                expr = "*".join(f"if(between(t,{a:.2f},{b:.2f}),{f:.2f},1)" for a, b, f in t["duck"])
                chain.append(f"volume=eval=frame:volume='{expr}'")
            fc.append(",".join(chain) + f"[t{k}]")
            labels.append(f"[t{k}]")
        base = "[0:a]"
        if music_idx is not None:
            m = spec["music"]
            fc.append(f"[{music_idx}:a]aresample=44100,aformat=channel_layouts=stereo,volume={m['volume']:.2f},"
                      f"atrim=0:{total:.2f},afade=t=in:st=0:d=0.5,afade=t=out:st={max(0.0, total - 2):.2f}:d=2[mus]")
            labels.append("[mus]")
        fc.append(f"{base}{''.join(labels)}amix=inputs={1 + len(labels)}:duration=first:dropout_transition=0:normalize=0,"
                  f"alimiter=limit=0.95[a]")
    elif music_idx is not None:
        m = spec["music"]
        fade_st = max(0.0, total - 2)
        fc.append(f"[{music_idx}:a]aresample=44100,aformat=channel_layouts=stereo,volume={m['volume']:.2f},"
                  f"atrim=0:{total:.2f},afade=t=in:st=0:d=0.5,afade=t=out:st={fade_st:.2f}:d=2[mus]")
        fc.append("[0:a][mus]amix=inputs=2:duration=first:dropout_transition=0,volume=2[a]")
    else:
        fc.append("[0:a]anull[a]")
    args += ["-filter_complex", ";".join(fc), "-map", "[v]", "-map", "[a]", "-t", f"{total:.2f}",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
             "-x264-params", "rc-lookahead=10", "-c:a", "aac", "-b:a", "128k",
             "-movflags", "+faststart", "-threads", str(settings.render_threads), out]
    return args


# ───────────────────────── صف ساخت ─────────────────────────


class Cancelled(Exception):
    pass


class Renderer:
    def __init__(self) -> None:
        self._event = threading.Event()
        self._thread: threading.Thread | None = None
        self._proc: subprocess.Popen | None = None
        self._current: int | None = None
        self._cancel: set[int] = set()
        self.stopping = False

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        with db.connect() as conn:
            conn.execute("UPDATE teasers SET status='queued', progress=0 WHERE status='rendering'")
        self.stopping = False
        self._thread = threading.Thread(target=self._run, name="teaser-render", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self.stopping = True
        self._event.set()
        if self._proc and self._proc.poll() is None:
            self._proc.kill()

    def wake(self) -> None:
        self._event.set()

    def cancel(self, tid: int) -> None:
        self._cancel.add(tid)
        if self._current == tid and self._proc and self._proc.poll() is None:
            self._proc.kill()
        with db.connect() as conn:
            conn.execute("UPDATE teasers SET status='cancelled' WHERE id=? AND status='queued'", (tid,))

    def _set(self, tid: int, **vals: Any) -> None:
        with db.connect() as conn:
            sets = ", ".join(f"{k}=?" for k in vals)
            conn.execute(f"UPDATE teasers SET {sets}, updated_at=? WHERE id=?", [*vals.values(), db.now_str(), tid])

    def _exec(self, tid: int, args: list[str], on_progress=None) -> None:
        if tid in self._cancel:
            raise Cancelled()
        self._proc = subprocess.Popen(args, stdout=subprocess.PIPE if on_progress else subprocess.DEVNULL,
                                      stderr=subprocess.PIPE, text=True)
        err_lines: list[str] = []

        def _drain_err() -> None:
            assert self._proc and self._proc.stderr
            for line in self._proc.stderr:
                err_lines.append(line)
                del err_lines[:-20]

        t = threading.Thread(target=_drain_err, daemon=True)
        t.start()
        if on_progress and self._proc.stdout:
            for line in self._proc.stdout:
                if line.startswith("out_time_ms=") or line.startswith("out_time_us="):
                    try:
                        on_progress(int(line.split("=")[1]) / 1_000_000)
                    except ValueError:
                        pass
        code = self._proc.wait()
        t.join(timeout=5)
        if tid in self._cancel:
            raise Cancelled()
        if code != 0:
            raise RuntimeError("".join(err_lines).strip()[-600:] or f"ffmpeg خطای {code}")

    def render(self, tid: int) -> None:
        with db.connect() as conn:
            row = conn.execute("SELECT * FROM teasers WHERE id=?", (tid,)).fetchone()
        spec = json.loads(row["spec"])
        self._current = tid
        self._set(tid, status="rendering", progress=0.01, error=None)
        work = Path(tempfile.mkdtemp(prefix=f"teaser{tid}_", dir=teaser_dir()))
        try:
            total = spec["total"]
            done = 0.0
            seg_paths = []
            for i, clip in enumerate(spec["clips"]):
                p = str(work / f"seg{i:03d}.mp4")
                self._exec(tid, segment_cmd(clip, spec, p))
                seg_paths.append(p)
                done += clip["duration"]
                self._set(tid, progress=round(0.6 * done / total, 3))
            # تکه‌هایی که با «محو درهم/کشویی» به هم وصل می‌شوند، اول با هم یکی شوند
            joined: list[str] = []
            chain: list[int] = []
            clips_ = spec["clips"]

            def flush() -> None:
                if len(chain) == 1:
                    joined.append(seg_paths[chain[0]])
                elif chain:
                    p = str(work / f"join{len(joined):03d}.mp4")
                    self._exec(tid, join_cmd([seg_paths[j] for j in chain], [clips_[j]["duration"] for j in chain],
                                             [clips_[j].get("tin") for j in chain], p))
                    joined.append(p)
                chain.clear()

            for i, c in enumerate(clips_):
                t = c.get("tin")
                if not (t and t["type"] in XFADE and chain):
                    flush()
                chain.append(i)
            flush()
            lst = work / "list.txt"
            lst.write_text("".join(f"file '{p}'\n" for p in joined))
            concat = str(work / "all.mp4")
            self._exec(tid, ["ffmpeg", "-y", "-v", "error", "-nostdin", "-f", "concat", "-safe", "0",
                             "-i", str(lst), "-c", "copy", concat])
            ov_paths = []
            for i, o in enumerate(spec["overlays"]):
                p = work / f"ov{i:03d}.png"
                p.write_bytes(_decode_png(o["image"]))
                ov_paths.append(str(p))
            out = teaser_dir() / f"teaser_{tid}.mp4"
            last = [0.0]

            def prog(sec: float) -> None:
                if sec - last[0] >= 1 or sec >= total:
                    last[0] = sec
                    self._set(tid, progress=round(0.6 + 0.39 * min(1.0, sec / total), 3))

            self._exec(tid, final_cmd(spec, concat, ov_paths, str(out)), prog)
            thumb = teaser_dir() / f"teaser_{tid}.jpg"
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{min(total / 2, 2):.2f}", "-i", str(out),
                            "-frames:v", "1", "-vf", "scale=360:-2", str(thumb)], capture_output=True, timeout=60)
            self._set(tid, status="done", progress=1, output=str(out), size=out.stat().st_size, duration=total,
                      thumb=str(thumb) if thumb.exists() else None)
            with db.connect() as conn:
                notify.add(conn, "teaser", f"🎬 تیزر «{spec['title']}» آماده است", "", link="#teaser",
                           dedup=f"teaser:{tid}:{db.now_str()}")
        except Cancelled:
            self._set(tid, status="cancelled", progress=0)
        except Exception as e:
            log.exception("ساخت تیزر %s ناموفق بود", tid)
            self._set(tid, status="error", error=str(e)[:800])
        finally:
            self._current = None
            self._cancel.discard(tid)
            shutil.rmtree(work, ignore_errors=True)

    def run_pending(self) -> int:
        n = 0
        while not self.stopping:
            with db.connect() as conn:
                row = conn.execute("SELECT id FROM teasers WHERE status='queued' ORDER BY id LIMIT 1").fetchone()
            if not row:
                return n
            with documents.HEAVY:
                self.render(row["id"])
            n += 1
        return n

    def _run(self) -> None:
        while not self.stopping:
            try:
                self.run_pending()
            except Exception:
                log.exception("خطای صف تیزر")
            self._event.wait(30)
            self._event.clear()


renderer = Renderer()


def create_teaser(spec_in: dict[str, Any]) -> dict[str, Any]:
    if not available():
        raise db.ValidationError("ffmpeg روی سرور نصب نیست")
    # کارت‌های آغاز/پایان که در مرورگر ساخته شده‌اند ← فایل رسانه
    clips = []
    for c in spec_in.get("clips") or []:
        if c.get("card"):
            m = add_media_dataurl(c["card"], f"card-{len(clips)}.png")
            c = {**c, "media_id": m["id"], "zoom": c.get("zoom", False)}
            c.pop("card", None)
        if c.get("outro"):
            o = c["outro"]
            bg = add_media_dataurl(o["bg"], f"card-outro-bg-{len(clips)}.png")
            lg = add_media_dataurl(o["logo"], f"card-outro-logo-{len(clips)}.png")
            c = {**{k: v for k, v in o.items() if k not in ("bg", "logo")}, "outro_bg": bg["id"], "outro_logo": lg["id"]}
        clips.append(c)
    spec = validate_spec({**spec_in, "clips": clips})
    story_id = spec_in.get("story_id") or None
    now = db.now_str()
    with db.connect() as conn:
        if story_id and not conn.execute("SELECT 1 FROM stories WHERE id=?", (story_id,)).fetchone():
            story_id = None
        cur = conn.execute(
            "INSERT INTO teasers (title, spec, status, story_id, duration, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?, ?, ?)",
            (spec["title"], json.dumps(spec, ensure_ascii=False), story_id, spec["total"], now, now),
        )
        tid = cur.lastrowid
    renderer.wake()
    return get_teaser(tid)


def _public(row: dict[str, Any]) -> dict[str, Any]:
    spec = json.loads(row.pop("spec") or "{}")
    row["format"] = spec.get("format")
    row["quality"] = spec.get("quality")
    row["editor"] = spec.get("editor")
    row["has_captions"] = bool(spec.get("captions"))
    row.pop("output", None)
    row["has_thumb"] = bool(row.pop("thumb", None))
    return row


def get_teaser(tid: int) -> dict[str, Any]:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM teasers WHERE id=?", (tid,)).fetchone()
    if not row:
        raise db.NotFound("تیزر پیدا نشد")
    return _public(dict(row))


def list_teasers() -> list[dict[str, Any]]:
    with db.connect() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM teasers ORDER BY id DESC LIMIT 100")]
    return [_public(r) for r in rows]


def teaser_file(tid: int, which: str = "output") -> str:
    with db.connect() as conn:
        row = conn.execute(f"SELECT {'output' if which == 'output' else 'thumb'} p FROM teasers WHERE id=?",
                           (tid,)).fetchone()
    if not row or not row["p"] or not os.path.exists(row["p"]):
        raise db.NotFound("فایل آماده نیست")
    return row["p"]


def teaser_srt(tid: int) -> str:
    with db.connect() as conn:
        row = conn.execute("SELECT spec FROM teasers WHERE id=?", (tid,)).fetchone()
    if not row:
        raise db.NotFound("تیزر پیدا نشد")
    caps = [{**c, "text": c["text"].replace("*", "")} for c in json.loads(row["spec"]).get("captions", [])
            if c["text"].strip() and c["end"] > c["start"]]

    def ts(s: float) -> str:
        ms = int(round(s * 1000))
        return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"

    return "\n".join(f"{i}\n{ts(c['start'])} --> {ts(c['end'])}\n{c['text']}\n" for i, c in enumerate(caps, 1))


def delete_teaser(tid: int) -> None:
    renderer.cancel(tid)
    with db.connect() as conn:
        row = conn.execute("SELECT output, thumb FROM teasers WHERE id=?", (tid,)).fetchone()
        if not row:
            raise db.NotFound("تیزر پیدا نشد")
        conn.execute("DELETE FROM teasers WHERE id=?", (tid,))
    for p in (row["output"], row["thumb"]):
        if p and os.path.exists(p):
            os.unlink(p)


def retry(tid: int) -> None:
    with db.connect() as conn:
        conn.execute("UPDATE teasers SET status='queued', progress=0, error=NULL WHERE id=? "
                     "AND status IN ('error','cancelled')", (tid,))
    renderer.wake()
