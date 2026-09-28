"""رصد خبر: دریافت دوره‌ای خوراک RSS/Atom خبرگزاری‌ها، جستجو و هشدار کلیدواژه‌ها.

فقط از کتابخانه‌ی استاندارد پایتون برای خواندن XML استفاده می‌شود (سبک و کم‌حافظه).
خبرها پس از FEED_KEEP_DAYS روز پاک می‌شوند، مگر نشان‌دار (⭐) شده باشند.
"""
from __future__ import annotations

import datetime as dt
import email.utils
import hashlib
import html
import logging
import re
import sqlite3
import xml.etree.ElementTree as ET
from typing import Any

import httpx

from . import db, jalali, notify, textnorm
from .config import settings

try:  # نسخه‌ی امن در برابر XML مخرب
    from defusedxml.ElementTree import fromstring as _fromstring
except ImportError:  # pragma: no cover
    _fromstring = ET.fromstring

log = logging.getLogger(__name__)

# منابع پیش‌فرض (در بخش «منابع رصد» قابل ویرایش و حذف‌اند)
DEFAULT_FEEDS = [
    ("ایرنا", "https://www.irna.ir/rss", "خبرگزاری"),
    ("ایسنا", "https://www.isna.ir/rss", "خبرگزاری"),
    ("مهر", "https://www.mehrnews.com/rss", "خبرگزاری"),
    ("ایلنا", "https://www.ilna.ir/rss", "خبرگزاری"),
    ("خبرآنلاین", "https://www.khabaronline.ir/rss", "پایگاه خبری"),
    ("همشهری آنلاین", "https://www.hamshahrionline.ir/rss", "پایگاه خبری"),
    ("تسنیم", "https://www.tasnimnews.com/fa/rss/feed/0/8/0/%D8%A2%D8%AE%D8%B1%DB%8C%D9%86-%D8%A7%D8%AE%D8%A8%D8%A7%D8%B1", "خبرگزاری"),
    ("فارس", "https://www.farsnews.ir/rss", "خبرگزاری"),
    ("اقتصادآنلاین", "https://www.eghtesadonline.com/rss", "اقتصادی"),
    ("دنیای اقتصاد", "https://donya-e-eqtesad.com/rss", "اقتصادی"),
]

_TAG_RE = re.compile(r"<[^>]+>")
UA = "Mozilla/5.0 (compatible; ZozoNewsReader/1.0)"


def seed_defaults(conn: sqlite3.Connection) -> None:
    if db.kv_get(conn, "feeds_seeded"):
        return
    for name, url, cat in DEFAULT_FEEDS:
        if not conn.execute("SELECT 1 FROM feeds WHERE url=?", (url,)).fetchone():
            db.create(conn, "feeds", {"name": name, "url": url, "category": cat, "active": "yes"})
    db.kv_set(conn, "feeds_seeded", "1")


def _strip_html(s: str | None, limit: int = 600) -> str:
    if not s:
        return ""
    s = html.unescape(_TAG_RE.sub(" ", s))
    s = re.sub(r"\s+", " ", s).strip()
    return s[:limit]


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _child_text(el: ET.Element, *names: str) -> str | None:
    for c in el:
        if _local(c.tag) in names:
            if _local(c.tag) == "link" and c.get("href"):
                if c.get("rel", "alternate") == "alternate":
                    return c.get("href")
                continue
            return (c.text or "").strip() or None
    return None


def _parse_date(s: str | None) -> dt.datetime | None:
    if not s:
        return None
    s = s.strip()
    try:
        d = email.utils.parsedate_to_datetime(s)
    except (TypeError, ValueError, IndexError):
        d = None
    if d is None:
        try:
            d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=settings.tz)
    return d.astimezone(settings.tz)


def parse_feed(content: bytes) -> list[dict[str, Any]]:
    """خواندن RSS 2.0 / RSS 1.0 / Atom. خروجی: فهرست خبرها با title, link, summary, published, guid."""
    root = _fromstring(content)
    items = [el for el in root.iter() if _local(el.tag) in ("item", "entry")]
    out = []
    for it in items:
        title = _strip_html(_child_text(it, "title"), 400)
        if not title:
            continue
        link = _child_text(it, "link") or ""
        summary = _strip_html(_child_text(it, "description", "summary", "content", "encoded"))
        pub = _parse_date(_child_text(it, "pubdate", "published", "updated", "date"))
        guid = _child_text(it, "guid", "id") or link or title
        out.append({
            "title": title, "link": link.strip(), "summary": summary if summary != title else "",
            "published": jalali.to_jalali(pub, with_time=True) if pub else None,
            "guid": hashlib.sha1(guid.encode()).hexdigest(),
        })
    return out


def _keywords(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    return [dict(r) for r in conn.execute("SELECT word, notify FROM keywords")]


def _match(norm: str, kws: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [k for k in kws if textnorm.matches_keyword(norm, k["word"])]


def fetch_feed(feed: dict[str, Any], client: httpx.Client | None = None) -> int:
    """دریافت یک منبع و ذخیره‌ی خبرهای تازه. خروجی: تعداد خبر جدید."""
    own = client is None
    client = client or httpx.Client(timeout=20, follow_redirects=True, headers={"User-Agent": UA})
    try:
        r = client.get(feed["url"])
        r.raise_for_status()
        items = parse_feed(r.content)
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"[:300]
        with db.connect() as conn:
            db.set_system(conn, "feeds", feed["id"], last_error=msg, last_fetch=db.now_str())
        log.info("دریافت %s ناموفق: %s", feed["name"], msg)
        return 0
    finally:
        if own:
            client.close()
    new = 0
    now = db.now_str()
    with db.connect() as conn:
        kws = _keywords(conn)
        for it in items:
            norm = textnorm.normalize(f"{it['title']} {it['summary']}")
            hits = _match(norm, kws)
            try:
                cur = conn.execute(
                    "INSERT INTO feed_items (feed_id, guid, title, link, summary, published, fetched_at, matched) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (feed["id"], it["guid"], it["title"], it["link"], it["summary"], it["published"] or now, now,
                     "، ".join(k["word"] for k in hits) or None),
                )
            except sqlite3.IntegrityError:
                continue  # تکراری
            new += 1
            conn.execute("INSERT INTO feed_fts (norm, item_id) VALUES (?, ?)", (norm, cur.lastrowid))
            notify_kws = [k["word"] for k in hits if k["notify"] == "yes"]
            if notify_kws:
                notify.add(conn, "feed", f"🔎 {'، '.join(notify_kws)} — {feed['name']}", it["title"],
                           link=f"#feeds?item={cur.lastrowid}", dedup=f"feed:{it['guid']}", url=it["link"])
        count = conn.execute("SELECT COUNT(*) FROM feed_items WHERE feed_id=?", (feed["id"],)).fetchone()[0]
        db.set_system(conn, "feeds", feed["id"], last_error=None, last_fetch=now, items_count=count)
    return new


def fetch_all() -> dict[str, int]:
    with db.connect() as conn:
        feeds = [dict(r) for r in conn.execute("SELECT * FROM feeds WHERE active='yes'")]
    out = {}
    with httpx.Client(timeout=20, follow_redirects=True, headers={"User-Agent": UA}) as client:
        for f in feeds:
            out[f["name"]] = fetch_feed(f, client)
    cleanup()
    with db.connect() as conn:
        db.kv_set(conn, "feeds_last_run", db.now_str())
    return out


def cleanup() -> None:
    cutoff = jalali.to_jalali(settings.now() - dt.timedelta(days=settings.feed_keep_days), with_time=True)
    with db.connect() as conn:
        old = [r["id"] for r in conn.execute(
            "SELECT id FROM feed_items WHERE starred=0 AND published < ?", (cutoff,))]
        for i in range(0, len(old), 500):
            batch = old[i:i + 500]
            marks = ",".join("?" * len(batch))
            conn.execute(f"DELETE FROM feed_fts WHERE item_id IN ({marks})", batch)
            conn.execute(f"DELETE FROM feed_items WHERE id IN ({marks})", batch)


def rematch_all() -> int:
    """پس از افزودن کلیدواژه‌ی جدید، خبرهای موجود دوباره بررسی می‌شوند (بدون اعلان)."""
    n = 0
    with db.connect() as conn:
        kws = _keywords(conn)
        for r in conn.execute("SELECT id, title, summary, matched FROM feed_items").fetchall():
            hits = "، ".join(k["word"] for k in _match(textnorm.normalize(f"{r['title']} {r['summary']}"), kws)) or None
            if hits != r["matched"]:
                conn.execute("UPDATE feed_items SET matched=? WHERE id=?", (hits, r["id"]))
                n += 1
    return n


def list_items(q: str | None = None, feed_id: int | None = None, only_matched: bool = False,
               starred: bool = False, limit: int = 100, offset: int = 0) -> dict[str, Any]:
    where, params = [], []
    if q:
        fts = textnorm.fts_query(q, "AND")
        if not fts:
            return {"items": [], "terms": []}
        where.append("i.id IN (SELECT item_id FROM feed_fts WHERE feed_fts MATCH ?)")
        params.append(fts)
    if feed_id:
        where.append("i.feed_id = ?")
        params.append(feed_id)
    if only_matched:
        where.append("i.matched IS NOT NULL")
    if starred:
        where.append("i.starred = 1")
    sql = "SELECT i.*, f.name AS feed_name FROM feed_items i LEFT JOIN feeds f ON f.id = i.feed_id"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY i.published DESC, i.id DESC LIMIT ? OFFSET ?"
    params += [max(1, min(limit, 300)), max(0, offset)]
    with db.connect() as conn:
        try:
            items = [dict(r) for r in conn.execute(sql, params)]
        except sqlite3.OperationalError:
            items = []
        last = db.kv_get(conn, "feeds_last_run")
    return {"items": items, "terms": textnorm.highlight_terms(q or ""), "last_run": last}


def set_flag(item_id: int, **flags: int) -> None:
    allowed = {k: int(bool(v)) for k, v in flags.items() if k in ("starred", "is_read")}
    if not allowed:
        return
    with db.connect() as conn:
        sets = ", ".join(f"{k}=?" for k in allowed)
        conn.execute(f"UPDATE feed_items SET {sets} WHERE id=?", [*allowed.values(), item_id])


def to_story(item_id: int) -> dict[str, Any]:
    with db.connect() as conn:
        it = conn.execute("SELECT i.*, f.name AS feed_name FROM feed_items i LEFT JOIN feeds f ON f.id=i.feed_id "
                          "WHERE i.id=?", (item_id,)).fetchone()
        if not it:
            raise db.NotFound("خبر پیدا نشد")
        conn.execute("UPDATE feed_items SET starred=1 WHERE id=?", (item_id,))
        return db.create(conn, "stories", {
            "title": it["title"], "status": "idea", "source_url": it["link"],
            "notes": f"منبع: {it['feed_name'] or ''} — {it['published'] or ''}\n{it['summary'] or ''}".strip(),
        })
