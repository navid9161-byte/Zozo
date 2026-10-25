"""حذف نویز صدای فیلم و فایل صوتی.

صدای گفتار با شبکه‌ی عصبی RNNoise (مدل «ضبط با نویز»، داخل ffmpeg: arnndn) تمیز می‌شود؛
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

from . import db, teaser
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
        try:
            args = command(m["path"], out, kind, _video_codec(m["path"]) if kind == "video" else None, level, normalize)
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
            if os.path.exists(out):
                os.unlink(out)
