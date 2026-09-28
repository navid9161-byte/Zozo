"""اعلان‌ها: ثبت در برنامه (برای نمایش و اعلان مرورگر) و ارسال به پیام‌رسان «بله».

ربات بله همان API ربات تلگرام را دارد، فقط نشانی‌اش فرق می‌کند (tapi.bale.ai) و از داخل ایران در دسترس است.
با long polling کار می‌کند (نیازی به دامنه و وبهوک نیست).

علاوه بر یادآوری، هر پیام متنی که از حساب مجاز به ربات فرستاده شود به عنوان «ایده» در یادداشت‌ها ذخیره می‌شود؛
یعنی همسرتان هر جا ایده‌ای به ذهنش رسید می‌تواند سریع برای ربات بفرستد.
"""
from __future__ import annotations

import datetime as dt
import logging
import sqlite3
import threading
from typing import Any

import httpx

from . import db, jalali
from .config import settings

log = logging.getLogger(__name__)
MAX_LEN = 4000


# ───────────────────────── اعلان‌های داخل برنامه ─────────────────────────


def add(conn: sqlite3.Connection, kind: str, title: str, body: str = "", link: str = "",
        dedup: str | None = None, url: str | None = None) -> int | None:
    """ثبت اعلان؛ اگر dedup تکراری باشد چیزی ثبت نمی‌شود. خروجی: شناسه یا None."""
    if url:
        body = f"{body}\n{url}".strip()
    cur = conn.execute(
        "INSERT OR IGNORE INTO notifications (kind, title, body, link, dedup, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (kind, title[:300], body[:3000], link, dedup, db.now_str()),
    )
    return cur.lastrowid if cur.rowcount else None


def list_notifications(since_id: int = 0, limit: int = 50) -> dict[str, Any]:
    with db.connect() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT id, kind, title, body, link, is_read, created_at FROM notifications WHERE id > ? "
            "ORDER BY id DESC LIMIT ?", (since_id, limit))]
        unread = conn.execute("SELECT COUNT(*) FROM notifications WHERE is_read=0").fetchone()[0]
        last = conn.execute("SELECT COALESCE(MAX(id), 0) FROM notifications").fetchone()[0]
    return {"items": rows, "unread": unread, "last_id": last}


def mark_read(ids: list[int] | None = None) -> None:
    with db.connect() as conn:
        if ids:
            conn.execute(f"UPDATE notifications SET is_read=1 WHERE id IN ({','.join('?' * len(ids))})", ids)
        else:
            conn.execute("UPDATE notifications SET is_read=1 WHERE is_read=0")


def cleanup(keep: int = 500) -> None:
    with db.connect() as conn:
        conn.execute("DELETE FROM notifications WHERE id <= (SELECT MAX(id) FROM notifications) - ?", (keep,))


# ───────────────────────── ربات بله ─────────────────────────

HELP = """سلام! من دستیار {app} هستم.

• هر متنی برایم بفرستید، به عنوان «ایده» در یادداشت‌ها ذخیره می‌شود.
• ویس یا فایل صوتی بفرستید تا به متن فارسی تبدیل شود.
• یادآوری‌ها و مهلت‌های تحویل را همین‌جا برایتان می‌فرستم.

دستورها:
/today — خلاصه‌ی امروز
/stories — کارهای در جریان
/id — شناسه‌ی این گفتگو"""


class BaleBot:
    def __init__(self, token: str, allowed: list[str], base: str):
        self.token = token
        self.allowed = set(allowed)
        self.base = base.rstrip("/")
        self.http = httpx.Client(timeout=httpx.Timeout(70.0, connect=15.0))
        self._stop = threading.Event()
        self._offset = 0

    def call(self, method: str, **params: Any) -> Any:
        r = self.http.post(f"{self.base}/bot{self.token}/{method}", json=params)
        data = r.json()
        if not data.get("ok"):
            raise RuntimeError(f"Bale {method}: {data.get('description')}")
        return data["result"]

    def send(self, chat_id: int | str, text: str) -> None:
        text = text.strip() or "—"
        for i in range(0, len(text), MAX_LEN):
            self.call("sendMessage", chat_id=chat_id, text=text[i: i + MAX_LEN])

    def broadcast(self, text: str) -> bool:
        ok = bool(self.allowed)
        for chat_id in self.allowed:
            try:
                self.send(chat_id, text)
            except Exception:
                ok = False
                log.exception("ارسال به بله (%s) ناموفق بود", chat_id)
        return ok

    def handle(self, msg: dict[str, Any]) -> None:
        from . import services

        chat_id = str(msg["chat"]["id"])
        text = (msg.get("text") or msg.get("caption") or "").strip()
        if text.startswith("/id"):
            self.send(chat_id, f"شناسه‌ی این گفتگو: {chat_id}")
            return
        if chat_id not in self.allowed:
            self.send(chat_id, "این ربات شخصی است.\nبرای فعال‌سازی، این شناسه را در متغیر "
                               f"BALE_ALLOWED_CHAT_IDS برنامه وارد کنید: {chat_id}")
            return
        media = msg.get("voice") or msg.get("audio") or msg.get("video") or msg.get("video_note")
        doc = msg.get("document")
        if not media and doc and str(doc.get("mime_type", "")).startswith(("audio/", "video/")):
            media = doc
        if media:
            try:
                self.transcribe_media(chat_id, media, text)
            except Exception as e:
                log.exception("دریافت فایل صوتی از بله ناموفق بود")
                self.send(chat_id, f"⚠️ فایل دریافت نشد: {e}"[:300])
            return
        if not text:
            self.send(chat_id, "فعلاً پیام متنی (به عنوان ایده) و صوت/ویس (برای تبدیل به متن) را می‌پذیرم.")
            return
        cmd = text.split()[0].split("@")[0].lower()
        if cmd in ("/start", "/help"):
            self.send(chat_id, HELP.format(app=settings.app_name))
        elif cmd == "/today":
            with db.connect() as conn:
                self.send(chat_id, services.daily_brief_text(conn))
        elif cmd == "/stories":
            with db.connect() as conn:
                rows = db.list_records(conn, "stories", exclude_status=["published", "cancelled"], limit=30)
            lines = [f"• {r['title']}" + (f" — مهلت {r['deadline']}" if r["deadline"] else "")
                     + (f" ({r['outlet_name']})" if r.get("outlet_name") else "") for r in rows]
            self.send(chat_id, "کارهای در جریان:\n" + "\n".join(lines) if lines else "کار بازی ندارید 🎉")
        else:
            title = text.split("\n", 1)[0][:80]
            with db.connect() as conn:
                db.create(conn, "notes", {"title": title, "content": text, "kind": "idea", "tags": "از بله"})
            self.send(chat_id, "✅ به عنوان ایده در یادداشت‌ها ذخیره شد.")

    def transcribe_media(self, chat_id: str, media: dict[str, Any], caption: str = "") -> None:
        """ویس یا فایل صوتی فرستاده‌شده به ربات ← صف تبدیل به متن؛ متن آماده همین‌جا فرستاده می‌شود."""
        import io

        from . import transcribe

        info = self.call("getFile", file_id=media["file_id"])
        path = info.get("file_path") or ""
        r = self.http.get(f"{self.base}/file/bot{self.token}/{path}", timeout=120)
        r.raise_for_status()
        name = media.get("file_name") or (path.rsplit("/", 1)[-1] if "." in path else "voice.ogg")
        if "." not in name:
            name += ".ogg"
        t = transcribe.add(io.BytesIO(r.content), name, title=caption.strip()[:80] or f"ویس {db.now_str()}",
                           source_chat=chat_id)
        mins = max(1, round((t.get("duration") or 60) / 60))
        self.send(chat_id, f"🎙️ دریافت شد؛ در حال تبدیل به متن (حدود {mins} دقیقه صدا). متن آماده را همین‌جا می‌فرستم.")

    def poll_forever(self) -> None:
        log.info("ربات بله شروع به کار کرد")
        while not self._stop.is_set():
            try:
                updates = self.call("getUpdates", offset=self._offset, timeout=50)
                for u in updates:
                    self._offset = u["update_id"] + 1
                    if "message" in u:
                        try:
                            self.handle(u["message"])
                        except Exception:
                            log.exception("خطا در پردازش پیام بله")
            except Exception as e:
                log.warning("خطای getUpdates بله: %s؛ تلاش دوباره تا ۲۰ ثانیه‌ی دیگر", e)
                self._stop.wait(20)

    def stop(self) -> None:
        self._stop.set()


bot: BaleBot | None = None


def start_bot() -> BaleBot | None:
    global bot
    if not settings.bale_token:
        log.info("BALE_BOT_TOKEN تنظیم نشده؛ ربات بله غیرفعال است")
        return None
    bot = BaleBot(settings.bale_token, settings.bale_allowed, settings.bale_api)
    threading.Thread(target=bot.poll_forever, name="bale-poll", daemon=True).start()
    return bot


def deliver_pending() -> int:
    """ارسال اعلان‌های تازه به بله."""
    if bot is None or not bot.allowed:
        return 0
    day_ago = jalali.to_jalali(settings.now() - dt.timedelta(days=1), with_time=True)
    with db.connect() as conn:
        # اعلان‌های قدیمی (مثلاً پیش از راه‌اندازی ربات) فرستاده نمی‌شوند
        conn.execute("UPDATE notifications SET bale_sent=3 WHERE bale_sent=0 AND created_at < ?", (day_ago,))
        rows = conn.execute(
            "SELECT id, kind, title, body FROM notifications WHERE bale_sent=0 ORDER BY id LIMIT 20").fetchall()
    n = 0
    for r in rows:
        text = r["title"] if not r["body"] else f"{r['title']}\n\n{r['body']}"
        ok = bot.broadcast(text)
        with db.connect() as conn:
            conn.execute("UPDATE notifications SET bale_sent=? WHERE id=?", (1 if ok else 2, r["id"]))
        n += 1
    return n


def status() -> dict[str, Any]:
    return {"bale": bool(settings.bale_token), "bale_chats": len(settings.bale_allowed)}
