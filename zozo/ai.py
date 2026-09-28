"""جای اتصال هوش مصنوعی (اختیاری).

فعلاً همه‌ی قابلیت‌ها بدون هوش مصنوعی کار می‌کنند. هر وقت مدلی در دسترس بود، کافی است یکی از این دو را
در متغیرهای محیطی تنظیم کنید و برنامه را دوباره راه بیندازید:

1. هر سرویس سازگار با OpenAI Chat Completions (مثلاً یک مدل متن‌باز روی سرور خودتان با Ollama،
   یا سرویس‌های ایرانی ارائه‌دهنده‌ی مدل زبانی):
       ZOZO_LLM_BASE_URL=https://.../v1
       ZOZO_LLM_MODEL=نام-مدل
       ZOZO_LLM_API_KEY=کلید (در صورت نیاز)
2. Claude:
       ANTHROPIC_API_KEY=...

کارهایی که با مدل بهتر می‌شوند: خلاصه‌سازی، پیشنهاد تیتر، بازنویسی، ساخت زیرنویس تیزر از متن خبر.
بدون مدل، نسخه‌ی ساده‌ی «استخراجی» همین کارها انجام می‌شود.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from . import textnorm
from .config import settings

log = logging.getLogger(__name__)

SYSTEM = (
    "تو دستیار یک روزنامه‌نگار ایرانی هستی. به فارسی معیار، دقیق و بی‌طرف بنویس. "
    "هیچ واقعیت، عدد یا نقل‌قولی را که در متن داده‌شده نیست اضافه نکن."
)

TASKS = {
    "summary": "این متن خبری را در حداکثر {n} جمله‌ی کوتاه خلاصه کن:\n\n{text}",
    "headlines": "برای این خبر {n} تیتر کوتاه و دقیق (هر کدام حداکثر ۱۲ کلمه) پیشنهاد کن؛ هر تیتر در یک خط، بدون شماره:\n\n{text}",
    "captions": "از این خبر {n} جمله‌ی کوتاه (هر کدام حداکثر ۱۰ کلمه) برای زیرنویس یک کلیپ خبری کوتاه بساز؛ "
                "هر جمله در یک خط، بدون شماره:\n\n{text}",
    "rewrite": "این متن را با حفظ همه‌ی اطلاعات، روان‌تر و به سبک خبری بازنویسی کن:\n\n{text}",
}


def provider() -> str | None:
    if settings.llm_base_url:
        return "openai"
    if settings.anthropic_key:
        return "claude"
    return None


def _openai(prompt: str) -> str:
    headers = {"Content-Type": "application/json"}
    if settings.llm_api_key:
        headers["Authorization"] = f"Bearer {settings.llm_api_key}"
    body = {"model": settings.llm_model or "default", "temperature": 0.3,
            "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}]}
    r = httpx.post(f"{settings.llm_base_url.rstrip('/')}/chat/completions", json=body, headers=headers, timeout=180)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"].strip()


def _claude(prompt: str) -> str:
    r = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": settings.anthropic_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        json={"model": settings.anthropic_model, "max_tokens": 2000, "system": SYSTEM,
              "messages": [{"role": "user", "content": prompt}]},
        timeout=180,
    )
    r.raise_for_status()
    return "".join(b.get("text", "") for b in r.json()["content"]).strip()


def _fallback(task: str, text: str, n: int) -> list[str]:
    """بدون هوش مصنوعی."""
    sents = textnorm.split_sentences(text)
    if task == "summary":
        return textnorm.extractive_summary(text, n)
    if task == "captions":
        # جمله‌های مهم، شکسته به تکه‌های کوتاه مناسب زیرنویس
        out: list[str] = []
        for s in textnorm.extractive_summary(text, max(n, 3)):
            words = s.split()
            for i in range(0, len(words), 9):
                out.append(" ".join(words[i:i + 9]))
        return out[: max(n, 3) * 2]
    if task == "headlines":
        # جمله‌ی نخست (لید)، کوتاه‌شده
        return [" ".join(s.split()[:12]) for s in sents[:n]]
    return [text]


def run(task: str, text: str, n: int = 3) -> dict[str, Any]:
    text = (text or "").strip()
    if not text:
        return {"mode": "none", "lines": []}
    if task not in TASKS:
        raise ValueError("کار ناشناخته")
    p = provider()
    if p:
        try:
            prompt = TASKS[task].format(n=n, text=text[:12000])
            out = _openai(prompt) if p == "openai" else _claude(prompt)
            lines = [ln.strip(" -•*\t") for ln in out.split("\n") if ln.strip()] if task != "rewrite" else [out]
            return {"mode": p, "lines": lines}
        except Exception as e:
            log.warning("هوش مصنوعی در دسترس نبود: %s", e)
            return {"mode": "fallback", "lines": _fallback(task, text, n),
                    "error": "هوش مصنوعی در دسترس نبود؛ نسخه‌ی ساده انجام شد."}
    return {"mode": "fallback", "lines": _fallback(task, text, n)}
