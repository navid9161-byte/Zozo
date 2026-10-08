"""اعلان‌ها: ثبت در برنامه (برای نمایش و اعلان مرورگر) و ارسال به پیام‌رسان «بله».

ربات بله همان API ربات تلگرام را دارد، فقط نشانی‌اش فرق می‌کند (tapi.bale.ai) و از داخل ایران در دسترس است.
با long polling کار می‌کند (نیازی به دامنه و وبهوک نیست).

علاوه بر یادآوری، هر پیام متنی که از حساب مجاز به ربات فرستاده شود به عنوان «ایده» در یادداشت‌ها ذخیره می‌شود؛
یعنی همسرتان هر جا ایده‌ای به ذهنش رسید می‌تواند سریع برای ربات بفرستد.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import secrets
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


def linked_chats() -> list[dict[str, Any]]:
    """گفتگوهایی که از خود برنامه (با کد اتصال) وصل شده‌اند."""
    with db.connect() as conn:
        raw = db.kv_get(conn, "bale_chats")
    return json.loads(raw) if raw else []


def _save_chats(items: list[dict[str, Any]]) -> None:
    with db.connect() as conn:
        db.kv_set(conn, "bale_chats", json.dumps(items, ensure_ascii=False))


def allowed_chats() -> set[str]:
    return set(settings.bale_allowed) | {str(c["id"]) for c in linked_chats()}


def bale_token() -> str:
    """توکن ربات: اول از تنظیمات داخل برنامه، وگرنه از متغیر BALE_BOT_TOKEN."""
    with db.connect() as conn:
        return (db.kv_get(conn, "bale_token") or "").strip() or settings.bale_token


def link_code(renew: bool = False) -> str:
    """کد ۶ رقمی برای وصل کردن گفتگوی بله (۳۰ دقیقه اعتبار)."""
    now = settings.now().timestamp()
    with db.connect() as conn:
        cur = json.loads(db.kv_get(conn, "bale_link") or "{}")
        if renew or not cur.get("code") or cur.get("exp", 0) < now:
            cur = {"code": f"{secrets.randbelow(900000) + 100000}", "exp": now + 30 * 60}
            db.kv_set(conn, "bale_link", json.dumps(cur))
    return cur["code"]


def _check_link_code(text: str) -> bool:
    digits = "".join(ch for ch in text.translate(_FA_DIGITS) if ch.isdigit())
    with db.connect() as conn:
        cur = json.loads(db.kv_get(conn, "bale_link") or "{}")
        ok = bool(cur.get("code")) and digits == cur["code"] and cur.get("exp", 0) >= settings.now().timestamp()
        if ok:
            db.kv_set(conn, "bale_link", "{}")  # یک بار مصرف
    return ok


_FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


class BaleBot:
    def __init__(self, token: str, base: str):
        self.token = token
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

    @property
    def allowed(self) -> set[str]:
        return allowed_chats()

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
            # وصل شدن با کد ۶ رقمی‌ای که در «تنظیمات» برنامه دیده می‌شود
            if text and _check_link_code(text.removeprefix("/start").strip()):
                ch = msg.get("chat") or {}
                name = " ".join(x for x in (ch.get("first_name"), ch.get("last_name")) if x) or ch.get("title") or ch.get("username") or chat_id
                _save_chats([c for c in linked_chats() if str(c["id"]) != chat_id]
                            + [{"id": chat_id, "name": name, "at": db.now_str()}])
                self.send(chat_id, "✅ این گفتگو به برنامه وصل شد. از این به بعد یادآوری‌ها همین‌جا می‌رسد.\n\n"
                          + HELP.format(app=settings.app_name))
                return
            self.send(chat_id, "این ربات شخصی است.\nبرای وصل شدن، کد ۶ رقمیِ بخش «تنظیمات ← ربات بله» برنامه را همین‌جا بفرستید.")
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
                if self._stop.is_set():
                    break  # توکن عوض شده؛ ربات تازه کار را ادامه می‌دهد
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
_bot_lock = threading.Lock()


def start_bot() -> BaleBot | None:
    """راه‌اندازی (یا راه‌اندازی دوباره پس از تغییر توکن) ربات بله."""
    global bot
    with _bot_lock:
        if bot is not None:
            bot.stop()
            bot = None
        token = bale_token()
        if not token:
            log.info("توکن ربات بله تنظیم نشده؛ ربات بله غیرفعال است")
            return None
        bot = BaleBot(token, settings.bale_api)
        threading.Thread(target=bot.poll_forever, name="bale-poll", daemon=True).start()
        return bot


def check_token(token: str) -> dict[str, Any]:
    """درستی توکن را با getMe می‌سنجد. خروجی: مشخصات ربات."""
    token = token.strip()
    if not token or ":" not in token:
        raise db.ValidationError("توکن درست نیست؛ باید شبیه 123456789:AbCd... باشد")
    try:
        r = httpx.post(f"{settings.bale_api.rstrip('/')}/bot{token}/getMe", timeout=20)
        data = r.json()
    except Exception as e:
        raise db.ValidationError(f"اتصال به سرور بله برقرار نشد: {e}")
    if not data.get("ok"):
        raise db.ValidationError("بله این توکن را نپذیرفت؛ دوباره از بات‌فادر کپی کنید")
    return data["result"]


def set_token(token: str) -> dict[str, Any]:
    token = token.strip()
    me = check_token(token) if token else None
    with db.connect() as conn:
        db.kv_set(conn, "bale_token", token)
        db.kv_set(conn, "bale_me", json.dumps(me or {}, ensure_ascii=False))
    if os.getenv("ZOZO_NO_BACKGROUND") is None:
        start_bot()
    return bale_info()


def bale_info() -> dict[str, Any]:
    with db.connect() as conn:
        me = json.loads(db.kv_get(conn, "bale_me") or "{}")
        in_app = bool((db.kv_get(conn, "bale_token") or "").strip())
    token = bale_token()
    return {
        "token_set": bool(token), "from_env": bool(token) and not in_app,
        "running": bot is not None,
        "bot": {"username": me.get("username"), "name": me.get("first_name")} if me else None,
        "chats": linked_chats(), "env_chats": len(settings.bale_allowed),
        "code": link_code() if token else None,
    }


def remove_chat(chat_id: str) -> None:
    _save_chats([c for c in linked_chats() if str(c["id"]) != str(chat_id)])


def test_bale() -> int:
    if bot is None:
        raise db.ValidationError("ربات بله فعال نیست؛ اول توکن را وارد کنید")
    if not bot.allowed:
        raise db.ValidationError("هنوز گفتگویی وصل نشده؛ کد اتصال را برای ربات بفرستید")
    if not bot.broadcast("🔔 پیام آزمایشی زوزو\nاگر این را می‌بینید، یادآوری‌ها همین‌جا می‌رسند ✅"):
        raise db.ValidationError("ارسال به بله ناموفق بود")
    return len(bot.allowed)


def deliver_pending() -> int:
    """ارسال اعلان‌های تازه به بله و به گوشی‌هایی که اعلان برنامه را روشن کرده‌اند."""
    from . import push
    try:
        push.push_pending()
    except Exception:
        log.exception("ارسال اعلان گوشی ناموفق بود")
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
    from . import push
    return {"bale": bool(bale_token()), "bale_chats": len(allowed_chats()), "push": push.count()}
