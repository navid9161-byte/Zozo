"""حذف نویز صدای فیلم و فایل صوتی.

صدای گفتار با شبکه‌ی عصبی DeepFilterNet3 (zozo/dfn.py) تمیز می‌شود؛ اگر در دسترس نباشد،
با RNNoise داخل ffmpeg (arnndn، ضعیف‌تر).
تصویر ویدیو اگر H.264/H.265 باشد بی‌تغییر کپی می‌شود (سریع و بی‌افت کیفیت)، وگرنه H.264 می‌شود.
کار در پس‌زمینه انجام می‌شود و پیشرفتش پرسیدنی است.
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import numpy as np

from . import db, dfn, teaser
from .config import settings

MODEL = Path(__file__).parent / "models" / "rnnoise-cb.rnnn"
LEVELS = {"light": "ملایم", "normal": "معمولی", "strong": "قوی"}
MAX_SECONDS = 30 * 60

_jobs: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()      # یک کار در هر لحظه (سرور کوچک است)


def audio_filter(level: str, normalize: bool) -> str:
    m = str(MODEL).replace("\\", "/").replace(":", "\\:")
    rnn = f"arnndn=m='{m}'"
    chain = ["highpass=f=70"]
    if level == "light":
        chain.append(rnn + ":mix=0.85")          # کمی از فضای طبیعی صدا می‌ماند
    elif level == "strong":
        chain += [rnn, "afftdn=nr=10:nf=-40:tn=1"]
    else:
        chain.append(rnn)
    if normalize:
        chain.append("loudnorm=I=-16:TP=-1.5:LRA=11")
    return ",".join(chain)


def _video_codec(path: str) -> str | None:
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name",
                        "-of", "json", path], capture_output=True, text=True, timeout=60)
    try:
        s = json.loads(r.stdout or "{}").get("streams") or []
        return s[0].get("codec_name") if s else None
    except ValueError:
        return None


def command(src: str, out: str, kind: str, vcodec: str | None, level: str, normalize: bool) -> list[str]:
    args = ["ffmpeg", "-y", "-v", "error", "-nostats", "-progress", "pipe:1", "-i", src, "-map", "0:a:0"]
    af = audio_filter(level, normalize)
    if kind == "video":
        args[args.index("-map"):args.index("-map")] = ["-map", "0:v:0"]
        venc = ["-c:v", "copy"] if vcodec in ("h264", "hevc") else \
            ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]
        if vcodec == "hevc":
            venc += ["-tag:v", "hvc1"]
        return [*args, *venc, "-af", af, "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
                "-movflags", "+faststart", "-threads", str(settings.render_threads), out]
    return [*args, "-af", af, "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "48000", out]


BLOCK_S, PAD_S = 60, 2   # صدای بلند تکه‌تکه (۶۰ ثانیه + ۲ ثانیه زمینه از هر طرف) تا حافظه کم بماند


def _decode(path: str) -> np.ndarray:
    r = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", path, "-map", "0:a:0", "-ac", "1", "-ar", str(dfn.SR),
                        "-f", "f32le", "-"], capture_output=True, timeout=1800)
    if r.returncode != 0:
        raise db.ValidationError("صدای فایل خوانده نشد: " + r.stderr.decode(errors="ignore")[-300:])
    return np.frombuffer(r.stdout, np.float32).copy()


def _dfn_clean(x: np.ndarray, level: str, progress) -> np.ndarray:
    den = dfn.get(settings.render_threads)
    n, B, P = len(x), BLOCK_S * dfn.SR, PAD_S * dfn.SR
    out = np.empty(n, np.float32)
    starts = list(range(0, max(1, n), B))
    for k, a in enumerate(starts):
        b = min(n, a + B)
        a0, b0 = max(0, a - P), min(n, b + P)
        y = den.channel(x[a0:b0], dfn.LEVEL_LIMIT.get(level), lambda f: progress((k + f) / len(starts)))
        out[a:b] = y[a - a0:b - a0]
    return np.clip(out, -1, 1)


def _mux_cmd(src: str, raw: str, out: str, kind: str, vcodec: str | None, normalize: bool) -> list[str]:
    af = ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"] if normalize else []
    args = ["ffmpeg", "-y", "-v", "error", "-nostdin", "-i", src, "-f", "f32le", "-ar", str(dfn.SR), "-ac", "1", "-i", raw]
    if kind == "video":
        venc = ["-c:v", "copy"] if vcodec in ("h264", "hevc") else \
            ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]
        if vcodec == "hevc":
            venc += ["-tag:v", "hvc1"]
        return [*args, "-map", "0:v:0", "-map", "1:a", *venc, *af, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
                "-shortest", "-movflags", "+faststart", "-threads", str(settings.render_threads), out]
    return [*args, "-map", "1:a", *af, "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "48000", out]


def start(media_id: int, level: str = "normal", normalize: bool = True) -> dict[str, Any]:
    if not teaser.available():
        raise db.ValidationError("ffmpeg روی سرور نصب نیست")
    m = teaser.get_media(int(media_id))
    if m["kind"] not in ("video", "audio") or (m["kind"] == "video" and not m["has_audio"]):
        raise db.ValidationError("این فایل صدا ندارد؛ یک ویدیو یا فایل صوتی انتخاب کنید")
    if (m["duration"] or 0) > MAX_SECONDS:
        raise db.ValidationError("فایل بیشتر از ۳۰ دقیقه است")
    level = level if level in LEVELS else "normal"
    jid = uuid.uuid4().hex[:12]
    job = {"id": jid, "media_id": m["id"], "status": "queued", "progress": 0.0, "error": None, "result": None,
           "level": level, "started": time.time()}
    _jobs[jid] = job
    for k in [k for k, j in _jobs.items() if time.time() - j["started"] > 6 * 3600]:
        _jobs.pop(k, None)
    threading.Thread(target=_run, args=(job, m, level, normalize), name=f"denoise-{jid}", daemon=True).start()
    return status(jid)


def status(jid: str) -> dict[str, Any]:
    j = _jobs.get(jid)
    if not j:
        raise db.NotFound("این کار پیدا نشد (شاید سرور دوباره روشن شده)؛ دوباره امتحان کنید")
    return {k: j[k] for k in ("id", "media_id", "status", "progress", "error", "result", "level")}


def _run(job: dict[str, Any], m: dict[str, Any], level: str, normalize: bool) -> None:
    with _lock:
        job["status"] = "running"
        kind = m["kind"]
        stem = Path(m["filename"]).stem
        name = f"{stem}-بدون-نویز.{'mp4' if kind == 'video' else 'mp3'}"
        fd, out = tempfile.mkstemp(suffix=".mp4" if kind == "video" else ".mp3", dir=teaser.media_dir())
        os.close(fd)
        raw = out + ".f32"
        try:
            vcodec = _video_codec(m["path"]) if kind == "video" else None
            if dfn.available():
                x = _decode(m["path"])
                job["progress"] = 0.05

                def prog(f: float) -> None:
                    job["progress"] = round(0.05 + 0.85 * min(1.0, f), 3)

                _dfn_clean(x, level, prog).tofile(raw)
                del x
                r = subprocess.run(_mux_cmd(m["path"], raw, out, kind, vcodec, normalize), capture_output=True, text=True, timeout=1800)
                if r.returncode != 0 or not os.path.getsize(out):
                    raise db.ValidationError("ساخت فایل بدون نویز انجام نشد: " + r.stderr.strip()[-300:])
                with open(out, "rb") as f:
                    res = teaser.add_media(f, name, keep=bool(m.get("keep", 0)))
                job.update(status="done", progress=1.0, result=res, engine="dfn")
                return
            args = command(m["path"], out, kind, vcodec, level, normalize)
            dur = m["duration"] or 0
            p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            err: list[str] = []
            t = threading.Thread(target=lambda: err.extend(p.stderr), daemon=True)  # type: ignore[arg-type]
            t.start()
            for line in p.stdout:  # type: ignore[union-attr]
                if line.startswith("out_time_us=") and dur:
                    try:
                        job["progress"] = round(min(0.99, int(line.split("=")[1]) / 1e6 / dur), 3)
                    except ValueError:
                        pass
            p.wait()
            t.join(5)
            if p.returncode != 0 or not os.path.getsize(out):
                raise db.ValidationError("پردازش صدا انجام نشد: " + "".join(err[-3:]).strip()[:300])
            with open(out, "rb") as f:
                res = teaser.add_media(f, name, keep=bool(m.get("keep", 0)))  # مثل فایل اصلی: ماندگار یا موقت
            job.update(status="done", progress=1.0, result=res)
        except Exception as e:  # noqa: BLE001
            job.update(status="error", error=str(e) or "خطا")
        finally:
            for f in (out, raw):
                if os.path.exists(f):
                    os.unlink(f)
