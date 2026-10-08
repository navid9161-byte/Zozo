"""پیشنهاد پست و ریلز آماده از روی یک سوژه (با قالب‌های کرمان راوی).

متن: متن/یادداشت سوژه؛ اگر سوژه از رصد خبر آمده باشد، لید (og:description) و عکس اصلی (og:image)
صفحه‌ی خبر هم دریافت می‌شود. عکس یک بار دریافت و در کتابخانه‌ی رسانه ذخیره می‌شود.
"""
from __future__ import annotations

import html
import io
import logging
import re
from typing import Any
from urllib.parse import urljoin

import httpx

from . import ai, db, documents, teaser, textnorm

log = logging.getLogger(__name__)
UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36"


def _meta(page: str, *names: str) -> str | None:
    for n in names:
        for pat in (rf'<meta[^>]+(?:property|name)=["\']{re.escape(n)}["\'][^>]*content=["\']([^"\']+)',
                    rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\']{re.escape(n)}["\']'):
            m = re.search(pat, page, re.I)
            if m:
                return html.unescape(m.group(1)).strip()
    return None


def fetch_page(url: str) -> dict[str, Any]:
    """لید، عکس و پاراگراف‌های اصلی صفحه‌ی خبر."""
    with httpx.Client(timeout=15, follow_redirects=True, headers={"User-Agent": UA}) as c:
        r = c.get(url)
        r.raise_for_status()
        page = r.text[:600_000]
        img = _meta(page, "og:image", "twitter:image", "og:image:url")
        desc = _meta(page, "og:description", "description", "twitter:description")
        # پاراگراف‌های متن خبر (ساده: <p> های بلند)
        paras = [textnorm.clean_display(html.unescape(re.sub(r"<[^>]+>", " ", p)))
                 for p in re.findall(r"<p[^>]*>(.*?)</p>", page, re.S | re.I)]
        paras = [p for p in paras if len(p) > 60 and textnorm.is_persian(p)][:12]
        image_bytes = None
        if img:
            img = urljoin(str(r.url), img)
            ir = c.get(img)
            if ir.status_code == 200 and ir.headers.get("content-type", "").startswith("image/") and len(ir.content) > 5000:
                image_bytes = ir.content
    return {"lead": desc, "paragraphs": paras, "image": image_bytes, "image_url": img}


def _story_image(conn, story: dict[str, Any]) -> int | None:
    """عکس سوژه: کش‌شده ← عکس بایگانی مرتبط ← عکس صفحه‌ی خبر."""
    cached = db.kv_get(conn, f"story_img:{story['id']}")
    if cached:
        try:
            teaser.get_media(int(cached), conn)
            return int(cached)
        except db.NotFound:
            pass
    row = conn.execute("SELECT path, filename FROM documents WHERE story_id=? AND kind='image' ORDER BY id LIMIT 1",
                       (story["id"],)).fetchone()
    if row:
        with open(row["path"], "rb") as f:
            m = teaser.add_media(f, row["filename"])
        db.kv_set(conn, f"story_img:{story['id']}", str(m["id"]))
        return m["id"]
    return None


def suggest(story_id: int) -> dict[str, Any]:
    with db.connect() as conn:
        s = db.get(conn, "stories", story_id)
        media_id = _story_image(conn, s)
    lead, paras, source_ok = None, [], False
    if s.get("source_url"):
        try:
            page = fetch_page(s["source_url"])
            lead, paras, source_ok = page["lead"], page["paragraphs"], True
            if media_id is None and page["image"] and teaser.available():
                ext = ".png" if page["image"][:4] == b"\x89PNG" else ".jpg"
                m = teaser.add_media(io.BytesIO(page["image"]), f"story{story_id}{ext}")
                media_id = m["id"]
                with db.connect() as conn:
                    db.kv_set(conn, f"story_img:{story_id}", str(media_id))
        except Exception as e:  # noqa: BLE001
            log.info("دریافت صفحه‌ی خبر ناموفق: %s", e)
    body_src = "\n".join(x for x in (s.get("body"), lead, *paras, s.get("notes")) if x)
    body_src = re.sub(r"^منبع:.*$", "", body_src, flags=re.M).strip()
    if body_src:  # متن کامل (سوژه + صفحه‌ی خبر) برای ساختن لید در ریلزساز
        with db.connect() as conn:
            db.kv_set(conn, f"story_text:{story_id}", body_src[:20000])
    summary = textnorm.extractive_summary(body_src, 3) if body_src else []
    body = " ".join(summary)
    if len(body) > 520:
        body = body[:520].rsplit(" ", 1)[0] + "…"
    captions = ai.run("captions", body_src or s["title"], 6)["lines"] if body_src else []
    captions = [c for c in captions if len(c.split()) >= 3][:6]
    return {
        "story": {"id": s["id"], "title": s["title"]},
        "post": {"title": s["title"], "subtitle": "", "body": body},
        "reel": {"headline": s["title"], "captions": captions},
        "media_id": media_id,
        "source_fetched": source_ok,
    }


def story_text(story_id: int) -> str:
    """متن کامل خبر برای لید: متنی که هنگام «پیشنهاد» از صفحه‌ی خبر گرفته شده، وگرنه متن و یادداشت سوژه."""
    with db.connect() as conn:
        s = db.get(conn, "stories", story_id)
        cached = db.kv_get(conn, f"story_text:{story_id}")
    if cached:
        return cached
    return "\n".join(x for x in (s.get("body"), s.get("notes")) if x).strip()
