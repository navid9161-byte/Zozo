"""زمان‌بند پس‌زمینه: یادآوری‌ها، مهلت‌ها، خلاصه‌ی صبحگاهی، حقوق ماهانه، رصد خبر و ارسال به بله.

دو نخ سبک:
- «scheduler» هر ۳۰ ثانیه یادآوری‌ها را بررسی و اعلان‌ها را به بله می‌فرستد.
- «feeds» هر FEED_INTERVAL_MIN دقیقه خبرها را دریافت می‌کند.
"""
from __future__ import annotations

import datetime as dt
import logging
import sqlite3
import threading

from . import db, feeds, jalali, notify, services
from .config import settings

log = logging.getLogger(__name__)
_stop = threading.Event()


def _minutes(hhmm: str) -> int:
    hh, mm = (int(x) for x in hhmm.split(":"))
    return hh * 60 + mm


def check_reminders(conn: sqlite3.Connection, now: str) -> int:
    n = 0
    rows = conn.execute(
        "SELECT r.*, s.title AS story_name FROM reminders r LEFT JOIN stories s ON s.id = r.story_id "
        "WHERE r.status='active' AND r.remind_at <= ?", (now,)).fetchall()
    for r in rows:
        body = "\n".join(x for x in (r["story_name"] and f"سوژه: {r['story_name']}", r["notes"]) if x)
        notify.add(conn, "reminder", f"⏰ {r['title']}", body, link=f"#reminders?id={r['id']}",
                   dedup=f"rem:{r['id']}:{r['remind_at']}")
        if r["repeat"] and r["repeat"] != "none":
            nxt = r["remind_at"]
            while nxt <= now:  # اگر سرور مدتی خاموش بوده، به اولین زمان آینده برود
                date = services.next_occurrence(nxt[:10], r["repeat"], r["repeat_days"])
                nxt = f"{date} {r['remind_at'][11:]}"
            conn.execute("UPDATE reminders SET remind_at=?, last_sent=? WHERE id=?", (nxt, now, r["id"]))
        else:
            conn.execute("UPDATE reminders SET status='sent', last_sent=? WHERE id=?", (now, r["id"]))
        n += 1
    return n


def check_stories(conn: sqlite3.Connection, now: str) -> int:
    """یادآوری سوژه‌ها: زمان «یادآوری در» اگر تعیین شده؛ وگرنه دو ساعت پیش از ساعت تحویل."""
    n = 0
    open_rows = conn.execute(
        "SELECT s.*, o.name AS outlet_name FROM stories s LEFT JOIN outlets o ON o.id=s.outlet_id "
        "WHERE s.status NOT IN ('published','cancelled','submitted')").fetchall()
    for s in open_rows:
        when = s["remind_at"]
        if not when and s["deadline"] and s["deadline_time"]:
            dl = jalali.parse_datetime(f"{s['deadline']} {s['deadline_time']}") - dt.timedelta(hours=2)
            when = jalali.to_jalali(dl, with_time=True)
        if not when or when > now or s["reminded"] == when:
            continue
        parts = []
        if s["deadline"]:
            parts.append(f"مهلت تحویل: {s['deadline']} {s['deadline_time'] or ''}".strip())
        if s["outlet_name"]:
            parts.append(f"برای: {s['outlet_name']}")
        notify.add(conn, "deadline", f"📝 {s['title']}", "\n".join(parts), link=f"#stories?id={s['id']}",
                   dedup=f"story:{s['id']}:{when}")
        conn.execute("UPDATE stories SET reminded=? WHERE id=?", (when, s["id"]))
        n += 1
    return n


def check_legal_docs(conn: sqlite3.Connection, today: str) -> int:
    """یادآوری سررسید اسناد: از «چند روز قبل» تا روز سررسید، با تکرار روزانه/هفتگی؛ پس از سررسید ← منقضی."""
    n = 0
    rows = conn.execute("SELECT * FROM legal_docs WHERE status='active' AND expiry_date IS NOT NULL").fetchall()
    for r in rows:
        days = jalali.days_between(today, r["expiry_date"])
        if days < 0:
            conn.execute("UPDATE legal_docs SET status='expired' WHERE id=?", (r["id"],))
            title, slot = f"⛔ سند «{r['title']}» منقضی شد", "expired"
        elif days <= (r["remind_days"] if r["remind_days"] is not None else 15):
            every = r["remind_every"] or "weekly"
            last = r["last_reminded"]
            if every == "once":
                slot = "first"
            else:
                slot = today
                if every == "weekly" and days > 0 and last and 0 <= jalali.days_between(last, today) < 7:
                    continue
            title = (f"📜 امروز سررسید «{r['title']}» است" if days == 0
                     else f"📜 {days} روز تا سررسید «{r['title']}»")
            if days == 0:
                slot = "due"
        else:
            continue
        body = "\n".join(x for x in (
            f"تاریخ سررسید: {r['expiry_date']}",
            r["owner_name"] and f"صاحب سند: {r['owner_name']}",
            r["owner_phone"] and f"تلفن: {r['owner_phone']}",
            r["number"] and f"شماره: {r['number']}",
        ) if x)
        if notify.add(conn, "legal", title, body, link=f"#legal_docs?id={r['id']}",
                      dedup=f"legal:{r['id']}:{r['expiry_date']}:{slot}"):
            conn.execute("UPDATE legal_docs SET last_reminded=? WHERE id=?", (today, r["id"]))
            n += 1
    return n


def check_daily(conn: sqlite3.Connection, now_dt: dt.datetime) -> None:
    today = db.today_str()
    minutes = now_dt.hour * 60 + now_dt.minute
    brief_at = _minutes(settings.daily_brief_time)
    # فقط تا ۳ ساعت پس از زمان تعیین‌شده (تا اگر سرور شب روشن شد، گزارش صبح نفرستد)
    if 0 <= minutes - brief_at < 180 and db.kv_get(conn, "last_brief") != today:
        db.kv_set(conn, "last_brief", today)
        text = services.daily_brief_text(conn)
        title, _, body = text.partition("\n")
        notify.add(conn, "brief", title, body.strip(), link="#home", dedup=f"brief:{today}")
        # حقوق ماهانه
        day = int(today[-2:])
        month = jalali.month_key(today)
        for o in conn.execute("SELECT id, name, pay_day FROM outlets WHERE active='yes' AND monthly_salary>0 AND pay_day=?",
                              (day,)):
            notify.add(conn, "salary", f"💵 امروز روز واریز حقوق {o['name']} است",
                       "پس از واریز، از بخش «مالی» دریافتی را ثبت کنید.", link="#finance",
                       dedup=f"salary:{o['id']}:{month}")
        check_legal_docs(conn, today)
        # پایان قراردادها تا سه روز دیگر
        soon = jalali.add_days(today, 3)
        for c in conn.execute("SELECT id, title, end_date FROM contracts WHERE status='active' AND end_date BETWEEN ? AND ?",
                              (today, soon)):
            notify.add(conn, "contract", f"📑 قرارداد «{c['title']}» در {c['end_date']} تمام می‌شود", "",
                       link=f"#contracts?id={c['id']}", dedup=f"contract:{c['id']}:{c['end_date']}")


def run_once() -> None:
    now_dt = settings.now()
    now = jalali.to_jalali(now_dt, with_time=True)
    with db.connect() as conn:
        check_reminders(conn, now)
        check_stories(conn, now)
        check_daily(conn, now_dt)
    notify.deliver_pending()


def _loop() -> None:
    cleaned = None
    while not _stop.is_set():
        try:
            run_once()
            today = db.today_str()
            if cleaned != today:
                notify.cleanup()
                cleaned = today
        except Exception:
            log.exception("خطای زمان‌بند")
        _stop.wait(30)


def _feed_loop() -> None:
    _stop.wait(20)  # کمی صبر تا برنامه کامل بالا بیاید
    while not _stop.is_set():
        try:
            res = feeds.fetch_all()
            log.info("رصد خبر: %d خبر تازه", sum(res.values()))
            notify.deliver_pending()
        except Exception:
            log.exception("خطای رصد خبر")
        _stop.wait(max(5, settings.feed_interval_min) * 60)


def start() -> None:
    _stop.clear()
    with db.connect() as conn:
        feeds.seed_defaults(conn)
    threading.Thread(target=_loop, name="scheduler", daemon=True).start()
    if settings.feed_interval_min > 0:
        threading.Thread(target=_feed_loop, name="feeds", daemon=True).start()


def stop() -> None:
    _stop.set()
