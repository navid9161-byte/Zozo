"""تنظیمات برنامه — همه از متغیرهای محیطی (یا فایل .env) خوانده می‌شوند.

روی لیارا این متغیرها را در بخش «تنظیمات ← متغیرهای محیطی» برنامه وارد کنید.
"""
from __future__ import annotations

import datetime as dt
import os
from dataclasses import dataclass, field
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # python-dotenv اختیاری است
    pass


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _list(name: str) -> list[str]:
    return [x.strip() for x in _env(name).split(",") if x.strip()]


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(_env("ZOZO_DATA_DIR", "data")))
    timezone: str = field(default_factory=lambda: _env("ZOZO_TZ", "Asia/Tehran"))
    currency: str = field(default_factory=lambda: _env("ZOZO_CURRENCY", "تومان"))
    owner_name: str = field(default_factory=lambda: _env("ZOZO_OWNER", ""))
    app_name: str = field(default_factory=lambda: _env("ZOZO_APP_NAME", "زوزو"))

    # ورود
    password: str = field(default_factory=lambda: _env("ZOZO_PASSWORD"))
    secret: str = field(default_factory=lambda: _env("ZOZO_SECRET"))

    # ربات بله (برای یادآوری‌ها)
    bale_token: str = field(default_factory=lambda: _env("BALE_BOT_TOKEN"))
    bale_allowed: list[str] = field(default_factory=lambda: _list("BALE_ALLOWED_CHAT_IDS"))
    bale_api: str = field(default_factory=lambda: _env("BALE_API_BASE", "https://tapi.bale.ai"))
    daily_brief_time: str = field(default_factory=lambda: _env("DAILY_BRIEF_TIME", "08:00"))

    # رصد خبر
    feed_interval_min: int = field(default_factory=lambda: int(_env("FEED_INTERVAL_MIN", "20") or 20))
    feed_keep_days: int = field(default_factory=lambda: int(_env("FEED_KEEP_DAYS", "30") or 30))

    # تیزرساز
    render_threads: int = field(default_factory=lambda: int(_env("ZOZO_RENDER_THREADS", "2") or 2))
    max_upload_mb: int = field(default_factory=lambda: int(_env("ZOZO_MAX_UPLOAD_MB", "500") or 500))

    # هوش مصنوعی (اختیاری؛ فعلاً خالی)
    llm_base_url: str = field(default_factory=lambda: _env("ZOZO_LLM_BASE_URL"))
    llm_model: str = field(default_factory=lambda: _env("ZOZO_LLM_MODEL"))
    llm_api_key: str = field(default_factory=lambda: _env("ZOZO_LLM_API_KEY"))
    anthropic_key: str = field(default_factory=lambda: _env("ANTHROPIC_API_KEY"))
    anthropic_model: str = field(default_factory=lambda: _env("ZOZO_CLAUDE_MODEL", "claude-sonnet-5"))

    @property
    def db_path(self) -> Path:
        return Path(_env("ZOZO_DB") or self.data_dir / "zozo.db")

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    def now(self) -> dt.datetime:
        return dt.datetime.now(self.tz)

    def dir(self, name: str) -> Path:
        d = self.data_dir / name
        d.mkdir(parents=True, exist_ok=True)
        return d


settings = Settings()
