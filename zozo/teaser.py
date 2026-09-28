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

from . import db, documents, notify
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


def add_media(fileobj: BinaryIO, filename: str) -> dict[str, Any]:
    if not available():
        raise db.ValidationError("ffmpeg روی سرور نصب نیست")
    kind = media_kind(filename)
    tmp, size, _ = documents.save_upload(fileobj, media_dir(), settings.max_upload_mb * 1024 * 1024)
    try:
        info = probe(tmp)
        if kind in ("image", "video") and not info["width"]:
            raise db.ValidationError("تصویری در این فایل پیدا نشد")
        if kind == "image":
            info["duration"] = None
        with db.connect() as conn:
            cur = conn.execute(
                "INSERT INTO media (filename, path, kind, size, width, height, duration, has_audio, created_at) "
                "VALUES (?, '', ?, ?, ?, ?, ?, ?, ?)",
                (filename, kind, size, info["width"], info["height"], info["duration"], info["has_audio"], db.now_str()),
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
            rows = conn.execute("SELECT * FROM media WHERE kind=? AND filename NOT LIKE 'card-%' ORDER BY id DESC LIMIT 300",
                                (kind,))
        else:
            rows = conn.execute("SELECT * FROM media WHERE filename NOT LIKE 'card-%' ORDER BY id DESC LIMIT 300")
        return [dict(r) for r in rows]


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
        m = get_media(int(c["media_id"]))
        if m["kind"] not in ("image", "video"):
            raise db.ValidationError(f"«{m['filename']}» عکس یا ویدیو نیست")
        if m["kind"] == "image":
            dur = _num(c.get("duration"), 3.0, 0.5, 30)
            start = 0.0
        else:
            total = m["duration"] or 0
            start = _num(c.get("start"), 0.0, 0, max(0.0, total - 0.3))
            dur = _num(c.get("duration") or (total - start), total - start, 0.3, max(0.3, total - start))
        clips.append({"media_id": m["id"], "kind": m["kind"], "path": m["path"], "has_audio": m["has_audio"],
                      "start": round(start, 2), "duration": round(dur, 2), "zoom": bool(c.get("zoom", True)),
                      "gray": bool(c.get("gray", False))})
    total = round(sum(c["duration"] for c in clips), 2)
    if total > MAX_TOTAL_SECONDS:
        raise db.ValidationError(f"مدت کل کلیپ ({total:.0f} ثانیه) بیش از {MAX_TOTAL_SECONDS} ثانیه است")
    overlays = []
    for o in (spec.get("overlays") or [])[:MAX_OVERLAYS]:
        _decode_png(o.get("image", ""))
        s = _num(o.get("start"), 0, 0, total)
        e = _num(o.get("end"), total, s, total)
        if e - s > 0.05:
            overlays.append({"image": o["image"], "start": round(s, 2), "end": round(e, 2)})
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
        "clips": clips, "overlays": overlays, "music": music, "total": total,
        "captions": [{"text": str(c.get("text", ""))[:300], "start": _num(c.get("start"), 0, 0, total),
                      "end": _num(c.get("end"), 0, 0, total)} for c in (spec.get("captions") or [])[:200]],
        "editor": spec.get("editor") if isinstance(spec.get("editor"), dict) else None,
    }


# ───────────────────────── ساخت فرمان‌های ffmpeg ─────────────────────────


def _place_filter(fit: str, w: int, h: int, bg: str) -> str:
    """قرار دادن تصویر ورودی [0:v] در قاب W×H. خروجی برچسب [pv]."""
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


def segment_cmd(clip: dict[str, Any], spec: dict[str, Any], out: str) -> list[str]:
    w, h = spec["size"]
    d = clip["duration"]
    frames = max(1, round(d * FPS))
    args = ["ffmpeg", "-y", "-v", "error", "-nostdin"]
    if clip["kind"] == "image":
        args += ["-i", clip["path"]]
    else:
        args += ["-ss", f"{clip['start']:.2f}", "-t", f"{d:.2f}", "-i", clip["path"]]
    use_audio = clip["kind"] == "video" and clip["has_audio"] and spec["keep_audio"]
    if not use_audio:
        args += ["-f", "lavfi", "-t", f"{d:.2f}", "-i", "anullsrc=r=44100:cl=stereo"]
    fc = [_place_filter(spec["fit"], w, h, spec["bg_color"])]
    if clip.get("gray"):
        fc[0] = fc[0][: -len("[pv]")] + ",hue=s=0[pv]"
    if clip["kind"] == "image":
        if clip["zoom"]:
            # زوم آرام (افکت کن برنز) روی تصویر ۲ برابر برای حرکت نرم‌تر
            fc.append(f"[pv]scale={w * 2}:{h * 2},zoompan=z='1+0.08*on/{frames}':d={frames}:"
                      f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={w}x{h}:fps={FPS}[mv]")
        else:
            fc.append(f"[pv]loop=loop={frames - 1}:size=1:start=0,setpts=N/{FPS}/TB[mv]")
    else:
        fc.append(f"[pv]fps={FPS}[mv]")
    vlast = "[mv]"
    if spec["transition"] == "fade" and d >= 1.2:
        fc.append(f"{vlast}fade=t=in:st=0:d=0.25,fade=t=out:st={d - 0.25:.2f}:d=0.25[fv]")
        vlast = "[fv]"
    fc.append(f"{vlast}format=yuv420p[v]")
    if use_audio:
        fc.append(f"[0:a]aresample=44100,aformat=channel_layouts=stereo,volume={spec['video_volume']:.2f},"
                  f"apad,atrim=0:{d:.2f}[a]")
        amap = "[a]"
    else:
        amap = "1:a"
    args += ["-filter_complex", ";".join(fc), "-map", "[v]", "-map", amap,
             "-t", f"{d:.2f}", "-r", str(FPS),
             "-c:v", "libx264", "-preset", "ultrafast", "-crf", "16", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2",
             "-threads", str(settings.render_threads), out]
    return args


def final_cmd(spec: dict[str, Any], concat_path: str, overlay_paths: list[str], out: str) -> list[str]:
    total = spec["total"]
    args = ["ffmpeg", "-y", "-v", "error", "-nostdin", "-progress", "pipe:1", "-nostats", "-i", concat_path]
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
    if music_idx is not None:
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
            lst = work / "list.txt"
            lst.write_text("".join(f"file '{p}'\n" for p in seg_paths))
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
