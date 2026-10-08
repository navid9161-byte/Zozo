"""متن به صدا (فارسی): صدای زن و مرد.

- صداهای اصلی (طبیعی‌تر): «دلارا» (زن) و «فرید» (مرد) از سرویس گفتار مایکروسافت (همان صدای مرورگر Edge)؛
  به اینترنت سرور نیاز دارد و کلید یا هزینه‌ای نمی‌خواهد.
- اگر آن سرویس از سرور در دسترس نبود: صدای مرد «امیر» بدون اینترنت روی خود سرور (Piper)؛
  مدلش (حدود ۶۴ مگابایت) بار اول خودکار روی دیسک داده‌ها دانلود می‌شود.
خروجی mp3 است و مثل هر فایل دیگری در «فایل‌های ریلز» ذخیره می‌شود تا در ریلزساز هم قابل استفاده باشد.
"""
from __future__ import annotations

import asyncio
import io
import logging
import re
import subprocess
import tempfile
import threading
import wave
from pathlib import Path
from typing import Any

from . import db, documents, jalali, teaser, textnorm
from .config import settings

log = logging.getLogger(__name__)
MAX_CHARS = 6000

VOICES = [
    {"id": "female", "name": "زن (دلارا)", "gender": "female", "engine": "edge", "voice": "fa-IR-DilaraNeural"},
    {"id": "male", "name": "مرد (فرید)", "gender": "male", "engine": "edge", "voice": "fa-IR-FaridNeural"},
    {"id": "male_offline", "name": "مرد (امیر، بدون اینترنت)", "gender": "male", "engine": "piper", "voice": "fa_IR-amir-medium"},
]
PIPER_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/fa/fa_IR/amir/medium/"
_piper_lock = threading.Lock()
_piper_voice = None


def voice(vid: str) -> dict[str, Any]:
    for v in VOICES:
        if v["id"] == vid:
            return v
    raise db.ValidationError("صدای انتخاب‌شده معتبر نیست")


def clean_text(text: str) -> str:
    text = str(text or "").replace("*", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{2,}", "\n", text).strip()
    return textnorm.fix_persian(text) if text else ""


# ───────────────────────── سرویس مایکروسافت ─────────────────────────

def _edge(text: str, name: str, rate: int, out: Path) -> None:
    import edge_tts

    async def run() -> None:
        await edge_tts.Communicate(text, name, rate=f"{rate:+d}%").save(str(out))

    asyncio.run(run())
    if not out.exists() or out.stat().st_size < 500:
        raise RuntimeError("فایل صدا خالی برگشت")


# ───────────────────────── بدون اینترنت (Piper) ─────────────────────────

def piper_model() -> Path:
    return settings.data_dir / "tts" / "fa_IR-amir-medium.onnx"


def offline_status() -> dict[str, Any]:
    try:
        import piper  # noqa: F401
        installed = True
    except Exception:  # noqa: BLE001
        installed = False
    return {"installed": installed, "model": piper_model().exists()}


def _download_piper() -> None:
    import httpx

    p = piper_model()
    p.parent.mkdir(parents=True, exist_ok=True)
    for name in (p.name + ".json", p.name):
        dest = p.parent / name
        if dest.exists():
            continue
        tmp = dest.with_suffix(dest.suffix + ".part")
        with httpx.stream("GET", PIPER_URL + name, timeout=httpx.Timeout(60, read=180), follow_redirects=True) as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)
        tmp.replace(dest)


def _piper(text: str, rate: int, out: Path) -> None:
    global _piper_voice
    try:
        from piper import PiperVoice, SynthesisConfig
    except Exception as e:  # noqa: BLE001
        raise db.ValidationError("موتور صدای بدون اینترنت روی سرور نصب نیست") from e
    with _piper_lock:
        if not piper_model().exists():
            try:
                _download_piper()
            except Exception as e:  # noqa: BLE001
                raise db.ValidationError(f"دانلود صدای بدون اینترنت ناموفق بود: {e}") from e
        if _piper_voice is None:
            _piper_voice = PiperVoice.load(str(piper_model()))
        wav = out.with_suffix(".wav")
        with documents.HEAVY:
            with wave.open(str(wav), "wb") as w:
                _piper_voice.synthesize_wav(text, w, syn_config=SynthesisConfig(length_scale=1 / (1 + rate / 100)))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-ac", "1", "-ar", "44100", "-b:a", "128k", str(out)],
                   check=True, timeout=300)
    wav.unlink(missing_ok=True)


# ───────────────────────── ساخت ─────────────────────────

def synthesize(text: str, vid: str = "female", rate: int = 0) -> dict[str, Any]:
    """متن ← فایل mp3 (ذخیره در فایل‌های ریلز). خروجی: {media, voice, engine, note}"""
    text = clean_text(text)
    if not text:
        raise db.ValidationError("متنی برای خواندن نیست")
    if len(text) > MAX_CHARS:
        raise db.ValidationError(f"متن خیلی بلند است (بیشتر از {MAX_CHARS} حرف)؛ آن را چند تکه کنید")
    rate = max(-50, min(50, int(rate or 0)))
    v = voice(vid)
    note = ""
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "tts.mp3"
        used = v
        if v["engine"] == "edge":
            try:
                _edge(text, v["voice"], rate, out)
            except Exception as e:  # noqa: BLE001
                log.warning("سرویس گفتار مایکروسافت در دسترس نبود: %s", e)
                used = voice("male_offline")
                note = ("سرویس صدای اینترنتی از سرور در دسترس نبود؛ صدا با «مرد (امیر، بدون اینترنت)» ساخته شد."
                        if v["gender"] == "male" else
                        "سرویس صدای اینترنتی (که صدای زن را می‌سازد) از سرور در دسترس نبود؛ فعلاً صدا با «مرد (امیر، بدون اینترنت)» ساخته شد.")
        if used["engine"] == "piper":
            _piper(text, rate, out)
        words = len(text.split())
        stamp = jalali.to_jalali(settings.now(), with_time=True).replace("/", "-").replace(":", "")
        with open(out, "rb") as f:
            m = teaser.add_media(f, f"صدا-{used['id']}-{stamp}.mp3")
    return {"media": m, "voice": used["id"], "voice_name": used["name"], "engine": used["engine"], "note": note, "words": words}
