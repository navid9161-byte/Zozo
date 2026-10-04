"""گزارش‌ها و محاسبات: داشبورد، امور مالی، تقویم، خلاصه‌ی روزانه و جستجوی سراسری."""
from __future__ import annotations

import sqlite3
from typing import Any

from . import db, documents, feeds, jalali
from .config import settings

OPEN_STORY = ("published", "cancelled")


def _stories(conn: sqlite3.Connection, where: str, params: tuple = (), limit: int = 50) -> list[dict[str, Any]]:
    sql = db._select_sql(db.ENTITIES["stories"]) + f" WHERE {where} ORDER BY {db.ENTITIES['stories'].order_by} LIMIT ?"
    return [dict(r) for r in conn.execute(sql, (*params, limit))]


def _sum(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> int:
    return conn.execute(sql, params).fetchone()[0] or 0


# ───────────────────────── داشبورد ─────────────────────────


def dashboard(conn: sqlite3.Connection) -> dict[str, Any]:
    today = db.today_str()
    week = jalali.add_days(today, 7)
    month = jalali.month_key(today)
    m_from, m_to = jalali.month_range(month)
    open_cond = "t.status NOT IN ('published','cancelled')"
    overdue = _stories(conn, f"{open_cond} AND t.status != 'submitted' AND t.deadline < ?", (today,))
    due_today = _stories(conn, f"{open_cond} AND t.status != 'submitted' AND t.deadline = ?", (today,))
    upcoming = _stories(conn, f"{open_cond} AND t.status != 'submitted' AND t.deadline > ? AND t.deadline <= ?",
                        (today, week))
    in_progress = _stories(conn, f"t.status IN ('research','writing','editing') AND (t.deadline IS NULL OR t.deadline > ?)",
                           (week,), limit=10)
    by_status = {r["status"]: r["n"] for r in conn.execute("SELECT status, COUNT(*) n FROM stories GROUP BY status")}
    reminders = [dict(r) for r in conn.execute(
        db._select_sql(db.ENTITIES["reminders"]) + " WHERE t.status='active' AND substr(t.remind_at,1,10) <= ? "
        "ORDER BY t.remind_at LIMIT 15", (week,))]
    ideas = [dict(r) for r in conn.execute(
        "SELECT id, title, created_at FROM notes WHERE kind='idea' ORDER BY id DESC LIMIT 5")]
    matched = [dict(r) for r in conn.execute(
        "SELECT i.id, i.title, i.link, i.published, i.matched, f.name AS feed_name FROM feed_items i "
        "LEFT JOIN feeds f ON f.id=i.feed_id WHERE i.matched IS NOT NULL ORDER BY i.published DESC LIMIT 6")]
    teasers = [dict(r) for r in conn.execute(
        "SELECT id, title, status, progress FROM teasers WHERE status IN ('queued','rendering') ORDER BY id")]
    income = _sum(conn, "SELECT SUM(amount) FROM transactions WHERE kind='income' AND tx_date BETWEEN ? AND ?",
                  (m_from, m_to))
    expense = _sum(conn, "SELECT SUM(amount) FROM transactions WHERE kind='expense' AND tx_date BETWEEN ? AND ?",
                   (m_from, m_to))
    published_month = _sum(conn, "SELECT COUNT(*) FROM stories WHERE status='published' AND published_date BETWEEN ? AND ?",
                           (m_from, m_to))
    return {
        "today": today,
        "today_long": jalali.long_format(jalali.parse(today)),
        "overdue": overdue, "due_today": due_today, "upcoming": upcoming, "in_progress": in_progress,
        "by_status": by_status, "reminders": reminders, "ideas": ideas, "matched_news": matched,
        "teasers": teasers,
        "month": {"key": month, "label": jalali.month_label(month), "income": income, "expense": expense,
                  "receivable": receivables(conn)["total"], "published": published_month},
    }


# ───────────────────────── امور مالی ─────────────────────────


def receivables(conn: sqlite3.Connection) -> dict[str, Any]:
    stories = [dict(r) for r in conn.execute(
        "SELECT s.id, s.title, s.fee, COALESCE(s.paid_amount,0) paid, s.fee - COALESCE(s.paid_amount,0) AS due, "
        "s.published_date, s.completed_at, s.status, o.name AS outlet_name FROM stories s "
        "LEFT JOIN outlets o ON o.id = s.outlet_id "
        "WHERE s.fee > COALESCE(s.paid_amount,0) AND s.pay_status IN ('unpaid','partial') AND s.status != 'cancelled' "
        "ORDER BY COALESCE(s.published_date, s.deadline, s.created_at)")]
    contracts = [dict(r) for r in conn.execute(
        "SELECT c.id, c.title, c.amount, COALESCE(c.paid_amount,0) paid, c.amount - COALESCE(c.paid_amount,0) AS due, "
        "c.end_date, o.name AS outlet_name FROM contracts c LEFT JOIN outlets o ON o.id=c.outlet_id "
        "WHERE c.status != 'cancelled' AND c.amount > COALESCE(c.paid_amount,0) ORDER BY c.end_date")]
    from . import invoices

    invs = [{"id": i["id"], "number": i["number"], "customer": i["customer"], "date": i["date"], "payable": i["payable"],
             "paid": i["paid_total"], "due": i["remaining"], "status": i["status"]} for i in invoices.open_invoices(conn)]
    total = sum(s["due"] for s in stories) + sum(c["due"] for c in contracts) + sum(i["due"] for i in invs)
    return {"stories": stories, "contracts": contracts, "invoices": invs, "total": total}


def finance_summary(conn: sqlite3.Connection, month: str | None = None) -> dict[str, Any]:
    today = db.today_str()
    month = month or jalali.month_key(today)
    m_from, m_to = jalali.month_range(month)
    keys = jalali.prev_months(month, 12)
    y_from = jalali.month_range(keys[0])[0]
    series = []
    for k in keys:
        a, b = jalali.month_range(k)
        row = conn.execute(
            "SELECT COALESCE(SUM(CASE WHEN kind='income' THEN amount END),0) inc, "
            "COALESCE(SUM(CASE WHEN kind='expense' THEN amount END),0) exp FROM transactions WHERE tx_date BETWEEN ? AND ?",
            (a, b)).fetchone()
        series.append({"key": k, "label": jalali.month_label(k), "income": row["inc"], "expense": row["exp"]})
    cur = series[-1]
    by_outlet = [dict(r) for r in conn.execute(
        "SELECT COALESCE(o.name, 'بدون رسانه') name, SUM(t.amount) total FROM transactions t "
        "LEFT JOIN outlets o ON o.id=t.outlet_id WHERE t.kind='income' AND t.tx_date BETWEEN ? AND ? "
        "GROUP BY o.name ORDER BY total DESC", (y_from, m_to))]
    exp_cat = [dict(r) for r in conn.execute(
        "SELECT COALESCE(NULLIF(category,''), 'بدون دسته') name, SUM(amount) total FROM transactions "
        "WHERE kind='expense' AND tx_date BETWEEN ? AND ? GROUP BY name ORDER BY total DESC", (m_from, m_to))]
    inc_cat = [dict(r) for r in conn.execute(
        "SELECT COALESCE(NULLIF(category,''), 'بدون دسته') name, SUM(amount) total FROM transactions "
        "WHERE kind='income' AND tx_date BETWEEN ? AND ? GROUP BY name ORDER BY total DESC", (m_from, m_to))]
    # حقوق‌های ثابت: انتظار در برابر دریافت این ماه
    salaries = []
    for o in conn.execute("SELECT * FROM outlets WHERE active='yes' AND monthly_salary > 0 ORDER BY name"):
        got = _sum(conn, "SELECT SUM(amount) FROM transactions WHERE kind='income' AND outlet_id=? AND category='حقوق' "
                         "AND tx_date BETWEEN ? AND ?", (o["id"], m_from, m_to))
        salaries.append({"id": o["id"], "name": o["name"], "expected": o["monthly_salary"], "received": got,
                         "pay_day": o["pay_day"]})
    # کارکرد این ماه به تفکیک رسانه (برای صورت‌حساب کارهای تکی)
    work = [dict(r) for r in conn.execute(
        "SELECT COALESCE(o.name,'بدون رسانه') outlet, COUNT(*) n, COALESCE(SUM(s.fee),0) fees, "
        "COALESCE(SUM(s.paid_amount),0) paid FROM stories s LEFT JOIN outlets o ON o.id=s.outlet_id "
        "WHERE s.status IN ('published','submitted') AND COALESCE(s.published_date, substr(s.completed_at,1,10)) "
        "BETWEEN ? AND ? GROUP BY o.name ORDER BY n DESC", (m_from, m_to))]
    year_income = sum(s["income"] for s in series)
    year_expense = sum(s["expense"] for s in series)
    return {
        "month": month, "month_label": jalali.month_label(month), "series": series,
        "income": cur["income"], "expense": cur["expense"], "net": cur["income"] - cur["expense"],
        "year_income": year_income, "year_expense": year_expense,
        "avg_income": round(year_income / 12), "by_outlet": by_outlet,
        "expense_categories": exp_cat, "income_categories": inc_cat,
        "salaries": salaries, "work": work, "receivables": receivables(conn),
        "legal_due": [dict(r) for r in conn.execute(
            "SELECT id, title, expiry_date, owner_name, amount, status FROM legal_docs WHERE status != 'archived' "
            "AND expiry_date IS NOT NULL AND expiry_date <= ? ORDER BY expiry_date LIMIT 10",
            (jalali.add_days(today, 60),))],
        "prev_month": jalali.prev_months(month, 2)[0], "next_month": jalali.month_key(jalali.add_months(m_from, 1)),
    }


PERIODS = {"month": 1, "3m": 3, "6m": 6, "12m": 12, "year": 0, "all": -1}


def finance_dashboard(conn: sqlite3.Connection, period: str = "12m", month: str | None = None) -> dict[str, Any]:
    """داشبورد مالی: شاخص‌ها، روند ماهانه، ترکیب درآمد/هزینه، طلب‌ها و سن مطالبات."""
    from . import invoices

    today = db.today_str()
    end_key = month or jalali.month_key(today)
    if period not in PERIODS:
        period = "12m"
    n = PERIODS[period]
    if period == "year":
        n = int(end_key[5:7])
    elif period == "all":
        first = conn.execute("SELECT MIN(tx_date) FROM transactions").fetchone()[0] or today
        jy, jm = int(first[:4]), int(first[5:7])
        ey, em = int(end_key[:4]), int(end_key[5:7])
        n = max(1, min(60, (ey * 12 + em) - (jy * 12 + jm) + 1))
    keys = jalali.prev_months(end_key, n)
    d_from, d_to = jalali.month_range(keys[0])[0], jalali.month_range(keys[-1])[1]
    # بازه‌ی قبلی هم‌اندازه برای مقایسه
    prev_keys = jalali.prev_months(keys[0], n + 1)[:-1]
    p_from, p_to = jalali.month_range(prev_keys[0])[0], jalali.month_range(prev_keys[-1])[1]

    def sums(a: str, b: str) -> tuple[int, int]:
        r = conn.execute("SELECT COALESCE(SUM(CASE WHEN kind='income' THEN amount END),0) i, "
                         "COALESCE(SUM(CASE WHEN kind='expense' THEN amount END),0) e FROM transactions "
                         "WHERE tx_date BETWEEN ? AND ?", (a, b)).fetchone()
        return r["i"], r["e"]

    income, expense = sums(d_from, d_to)
    p_income, p_expense = sums(p_from, p_to)
    all_inv = [invoices._row(r) for r in conn.execute("SELECT * FROM invoices WHERE status NOT IN ('draft','cancelled')")]
    payments = invoices.all_payments(conn)
    billed_in = [i for i in all_inv if d_from <= (i["date"] or "") <= d_to]
    collected = sum(p["amount"] for p in payments if d_from <= p["date"] <= d_to)

    # روند ماهانه (دست‌کم ۶ ماه تا نمودار معنا داشته باشد)
    trend_keys = keys if len(keys) >= 6 else jalali.prev_months(end_key, 6)
    trend = []
    for k in trend_keys:
        a, b = jalali.month_range(k)
        i, e = sums(a, b)
        trend.append({"key": k, "label": jalali.month_label(k), "income": i, "expense": e,
                      "billed": sum(x["payable"] for x in all_inv if a <= (x["date"] or "") <= b),
                      "collected": sum(p["amount"] for p in payments if a <= p["date"] <= b)})

    def group(sql: str) -> list[dict[str, Any]]:
        return [dict(r) for r in conn.execute(sql, (d_from, d_to))]

    inc_cat = group("SELECT COALESCE(NULLIF(category,''),'بدون دسته') name, SUM(amount) total FROM transactions "
                    "WHERE kind='income' AND tx_date BETWEEN ? AND ? GROUP BY name ORDER BY total DESC")
    exp_cat = group("SELECT COALESCE(NULLIF(category,''),'بدون دسته') name, SUM(amount) total FROM transactions "
                    "WHERE kind='expense' AND tx_date BETWEEN ? AND ? GROUP BY name ORDER BY total DESC")
    by_outlet = group("SELECT COALESCE(o.name,'بدون رسانه') name, SUM(t.amount) total FROM transactions t "
                      "LEFT JOIN outlets o ON o.id=t.outlet_id WHERE t.kind='income' AND t.tx_date BETWEEN ? AND ? "
                      "GROUP BY name ORDER BY total DESC")

    rec = receivables(conn)
    rec_parts = [
        {"key": "invoices", "name": "صورتحساب‌ها", "total": sum(i["due"] for i in rec["invoices"])},
        {"key": "stories", "name": "دستمزد کارها", "total": sum(s["due"] for s in rec["stories"])},
        {"key": "contracts", "name": "قراردادها", "total": sum(c["due"] for c in rec["contracts"])},
    ]
    # سن مطالبات (از تاریخ فاکتور یا انتشار کار)
    buckets = [{"name": "تا ۳۰ روز", "total": 0, "n": 0}, {"name": "۳۱ تا ۶۰ روز", "total": 0, "n": 0},
               {"name": "۶۱ تا ۹۰ روز", "total": 0, "n": 0}, {"name": "بیش از ۹۰ روز", "total": 0, "n": 0}]
    debtors: dict[str, int] = {}
    aged = [(i["date"], i["due"], i["customer"] or "بی‌نام") for i in rec["invoices"]]
    aged += [((s["published_date"] or (s["completed_at"] or "")[:10] or today), s["due"], s["outlet_name"] or "بدون رسانه")
             for s in rec["stories"]]
    aged += [(c["end_date"] or today, c["due"], c["outlet_name"] or c["title"]) for c in rec["contracts"]]
    for date, due, who in aged:
        try:
            days = max(0, jalali.days_between(date, today))
        except (ValueError, TypeError):
            days = 0
        b = buckets[0 if days <= 30 else 1 if days <= 60 else 2 if days <= 90 else 3]
        b["total"] += due
        b["n"] += 1
        debtors[who] = debtors.get(who, 0) + due
    billed_total = sum(i["payable"] for i in billed_in)
    return {
        "period": period, "from": d_from, "to": d_to, "label_from": jalali.month_label(keys[0]),
        "label_to": jalali.month_label(keys[-1]), "months": len(keys),
        "kpi": {
            "income": income, "expense": expense, "net": income - expense,
            "prev_income": p_income, "prev_expense": p_expense, "prev_net": p_income - p_expense,
            "billed": billed_total, "billed_count": len(billed_in), "collected": collected,
            "receivable": rec["total"], "receivable_count": len(aged),
            "collection_rate": round(100 * collected / billed_total) if billed_total else None,
            "overdue": buckets[2]["total"] + buckets[3]["total"],
        },
        "trend": trend, "income_categories": inc_cat, "expense_categories": exp_cat, "by_outlet": by_outlet,
        "receivable_parts": rec_parts, "aging": buckets,
        "debtors": [{"name": k, "total": v} for k, v in sorted(debtors.items(), key=lambda x: -x[1])[:6]],
        "open_invoices": rec["invoices"][:10],
        "recent_payments": payments[:8],
    }


def export_month_csv(conn: sqlite3.Connection, month: str) -> str:
    import csv
    import io

    a, b = jalali.month_range(month)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["تاریخ", "نوع", "مبلغ", "دسته", "شرح", "رسانه"])
    for r in conn.execute(
        "SELECT t.*, o.name outlet FROM transactions t LEFT JOIN outlets o ON o.id=t.outlet_id "
        "WHERE tx_date BETWEEN ? AND ? ORDER BY tx_date", (a, b)):
        w.writerow([r["tx_date"], "دریافتی" if r["kind"] == "income" else "هزینه", r["amount"], r["category"] or "",
                    r["description"], r["outlet"] or ""])
    return "﻿" + buf.getvalue()  # BOM تا Excel فارسی را درست نشان دهد


# ───────────────────────── تقویم ─────────────────────────


def calendar(conn: sqlite3.Connection, month: str) -> dict[str, Any]:
    a, b = jalali.month_range(month)
    events: list[dict[str, Any]] = []
    for r in conn.execute("SELECT id, title, deadline, deadline_time, status FROM stories "
                          "WHERE deadline BETWEEN ? AND ?", (a, b)):
        events.append({"date": r["deadline"], "time": r["deadline_time"], "kind": "deadline", "entity": "stories",
                       "id": r["id"], "title": r["title"], "done": r["status"] in OPEN_STORY + ("submitted",)})
    for r in conn.execute("SELECT id, title, published_date FROM stories WHERE status='published' "
                          "AND published_date BETWEEN ? AND ? AND (deadline IS NULL OR deadline != published_date)",
                          (a, b)):
        events.append({"date": r["published_date"], "kind": "published", "entity": "stories", "id": r["id"],
                       "title": r["title"], "done": True})
    for r in conn.execute("SELECT id, title, remind_at, status FROM reminders WHERE substr(remind_at,1,10) BETWEEN ? AND ?",
                          (a, b)):
        events.append({"date": r["remind_at"][:10], "time": r["remind_at"][11:], "kind": "reminder",
                       "entity": "reminders", "id": r["id"], "title": r["title"], "done": r["status"] == "done"})
    for r in conn.execute("SELECT id, title, end_date FROM contracts WHERE end_date BETWEEN ? AND ?", (a, b)):
        events.append({"date": r["end_date"], "kind": "contract", "entity": "contracts", "id": r["id"],
                       "title": f"پایان قرارداد: {r['title']}"})
    for r in conn.execute("SELECT id, title, expiry_date, status FROM legal_docs WHERE expiry_date BETWEEN ? AND ? "
                          "AND status != 'archived'", (a, b)):
        events.append({"date": r["expiry_date"], "kind": "contract", "entity": "legal_docs", "id": r["id"],
                       "title": f"سررسید: {r['title']}", "done": r["status"] == "expired"})
    days = int(b[-2:])
    for r in conn.execute("SELECT id, name, pay_day FROM outlets WHERE active='yes' AND monthly_salary > 0 AND pay_day > 0"):
        d = min(int(r["pay_day"]), days)
        events.append({"date": f"{month}/{d:02d}", "kind": "salary", "entity": "outlets", "id": r["id"],
                       "title": f"واریز حقوق {r['name']}"})
    # تکرار یادآوری‌های دوره‌ای در این ماه
    for r in conn.execute("SELECT id, title, remind_at, repeat FROM reminders WHERE status='active' AND repeat != 'none' "
                          "AND substr(remind_at,1,10) < ?", (a,)):
        for date in _occurrences(r["remind_at"][:10], r["repeat"], a, b):
            events.append({"date": date, "time": r["remind_at"][11:], "kind": "reminder", "entity": "reminders",
                           "id": r["id"], "title": r["title"], "repeat": True})
    events.sort(key=lambda e: (e["date"], e.get("time") or ""))
    first = jalali.parse(a)
    return {"month": month, "label": jalali.month_label(month), "days": days,
            # ستون شروع ماه در جدول شنبه‌تا‌جمعه (شنبه = ۰)
            "first_weekday": (first.weekday() + 2) % 7, "today": db.today_str(), "events": events,
            "prev": jalali.prev_months(month, 2)[0], "next": jalali.month_key(jalali.add_months(a, 1))}


def next_occurrence(date: str, repeat: str) -> str:
    if repeat == "daily":
        return jalali.add_days(date, 1)
    if repeat == "weekly":
        return jalali.add_days(date, 7)
    if repeat == "monthly":
        return jalali.add_months(date, 1)
    if repeat == "yearly":
        return jalali.add_months(date, 12)
    raise ValueError(repeat)


def _occurrences(start: str, repeat: str, a: str, b: str) -> list[str]:
    out, d, guard = [], start, 0
    if repeat == "daily" and jalali.days_between(start, a) > 1:
        d = jalali.add_days(a, -1)  # میان‌بُر برای یادآوری روزانه‌ی قدیمی
    while d <= b and guard < 800:
        guard += 1
        if d >= a:
            out.append(d)
        d = next_occurrence(d, repeat)
    return out


# ───────────────────────── خلاصه‌ی روزانه ─────────────────────────


def daily_brief_text(conn: sqlite3.Connection) -> str:
    d = dashboard(conn)
    lines = [f"☀️ {d['today_long']}"]
    if settings.owner_name:
        lines[0] = f"☀️ صبح بخیر {settings.owner_name}! {d['today_long']}"

    def fmt(s: dict[str, Any]) -> str:
        extra = []
        if s.get("outlet_name"):
            extra.append(s["outlet_name"])
        if s.get("deadline_time"):
            extra.append(f"ساعت {s['deadline_time']}")
        return f"• {s['title']}" + (f" ({'، '.join(extra)})" if extra else "")

    if d["overdue"]:
        lines += ["", f"🔴 مهلت گذشته ({len(d['overdue'])}):"] + [fmt(s) + f" — {s['deadline']}" for s in d["overdue"][:8]]
    if d["due_today"]:
        lines += ["", "📌 تحویل امروز:"] + [fmt(s) for s in d["due_today"]]
    today_rem = [r for r in d["reminders"] if r["remind_at"][:10] == d["today"]]
    if today_rem:
        lines += ["", "⏰ یادآوری‌های امروز:"] + [f"• {r['remind_at'][11:]} — {r['title']}" for r in today_rem]
    if d["upcoming"]:
        lines += ["", "🗓 هفت روز آینده:"] + [fmt(s) + f" — {s['deadline']}" for s in d["upcoming"][:8]]
    if not (d["overdue"] or d["due_today"] or today_rem or d["upcoming"]):
        lines += ["", "برای امروز و این هفته مهلتی ثبت نشده. 🌿"]
    if d["month"]["receivable"]:
        lines += ["", f"💰 طلب‌های دریافت‌نشده: {d['month']['receivable']:,} {settings.currency}"]
    return "\n".join(lines)


# ───────────────────────── جستجوی سراسری ─────────────────────────


def global_search(conn: sqlite3.Connection, q: str) -> dict[str, Any]:
    q = (q or "").strip()
    if not q:
        return {"query": q, "groups": []}
    groups = []
    for name in ("stories", "notes", "contacts", "outlets", "contracts", "reminders", "transactions"):
        rows = db.list_records(conn, name, search=q, limit=8)
        if rows:
            ent = db.ENTITIES[name]
            groups.append({"entity": name, "label": ent.label_plural, "icon": ent.icon, "items": [
                {"id": r["id"], "title": r[ent.title_field], "sub": _sub(name, r)} for r in rows]})
    docs = documents.search(q, limit=6)
    if docs["results"]:
        groups.append({"entity": "documents", "label": "بایگانی اسناد", "icon": "🗄️", "items": [
            {"id": r["doc_id"], "page": r["page"], "title": r["title"],
             "sub": (r["highlights"][0] if r["highlights"] else r["text"][:150])} for r in docs["results"]]})
    news = feeds.list_items(q=q, limit=8)
    if news["items"]:
        groups.append({"entity": "feed_items", "label": "خبرهای رصدشده", "icon": "📡", "items": [
            {"id": r["id"], "title": r["title"], "sub": f"{r['feed_name'] or ''} — {r['published'] or ''}",
             "link": r["link"]} for r in news["items"]]})
    return {"query": q, "groups": groups, "terms": docs["terms"]}


def _sub(name: str, r: dict[str, Any]) -> str:
    if name == "stories":
        return " · ".join(x for x in (db.label_of("stories", "status", r["status"]), r.get("outlet_name"),
                                      r.get("deadline") and f"مهلت {r['deadline']}") if x)
    if name == "contacts":
        return " · ".join(x for x in (r.get("role"), r.get("organization"), r.get("phone")) if x)
    if name == "notes":
        return (r.get("content") or "")[:140]
    if name == "transactions":
        return f"{r['tx_date']} · {r['amount']:,} {settings.currency}"
    if name == "reminders":
        return r["remind_at"]
    return ""
