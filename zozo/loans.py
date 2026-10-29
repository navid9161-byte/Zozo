"""وام‌ها و اقساط: هر وام مبلغ قسط، تعداد اقساط و تاریخ اولین قسط دارد.

سر هر قسط یک یادآوری ساخته می‌شود («قسط n پرداخت شد؟»)؛ با «بله» (در برنامه یا با دکمه‌ی ربات بله)
مبلغ قسط خودکار به‌عنوان هزینه («اقساط و وام») در بخش مالی ثبت می‌شود و یادآوری قسط بعدی ساخته می‌شود.
"""
from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

from . import db, jalali

CATEGORY = "اقساط و وام"
REMIND_TIME = "09:00"
_EN = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def _int(v: Any, field: str, lo: int = 0) -> int:
    s = re.sub(r"[^\d]", "", str(v if v is not None else "").translate(_EN))
    n = int(s) if s else 0
    if n < lo:
        raise db.ValidationError(f"{field} را درست بنویسید")
    return n


def _date(v: Any, field: str) -> str:
    v = re.sub(r"\s+", "", str(v or "").translate(_EN))
    try:
        jalali.parse(v)
    except (ValueError, TypeError) as e:
        raise db.ValidationError(f"{field} درست نیست؛ مثلاً {db.today_str()}") from e
    y, m, d = (int(x) for x in v.replace("-", "/").split("/"))
    return f"{y:04d}/{m:02d}/{d:02d}"


def due_date(loan: dict[str, Any], n: int) -> str:
    """تاریخ قسط n‌ام (از ۱)."""
    return jalali.add_months(loan["first_due"], n - 1)


def _row(r: sqlite3.Row) -> dict[str, Any]:
    d = dict(r)
    d["payments"] = json.loads(d.get("payments") or "[]")
    left = max(0, d["count"] - d["paid"])
    d["left"] = left
    d["remaining"] = left * d["installment"]
    d["paid_amount"] = sum(p.get("amount", 0) for p in d["payments"])
    d["next_n"] = d["paid"] + 1 if left else None
    d["next_due"] = due_date(d, d["paid"] + 1) if left else None
    d["overdue"] = bool(left and d["next_due"] < db.today_str())
    d["last_due"] = due_date(d, d["count"])
    return d


def get(conn: sqlite3.Connection, lid: int) -> dict[str, Any]:
    r = conn.execute("SELECT * FROM loans WHERE id=?", (lid,)).fetchone()
    if not r:
        raise db.NotFound("وام پیدا نشد")
    return _row(r)


def list_all(conn: sqlite3.Connection) -> dict[str, Any]:
    items = [_row(r) for r in conn.execute("SELECT * FROM loans ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, id DESC")]
    act = [x for x in items if x["status"] == "active"]
    month = jalali.month_key(db.today_str())
    a, b = jalali.month_range(month)
    due_month = [x for x in act if x["next_due"] and x["next_due"] <= b]
    return {"items": items, "summary": {
        "active": len(act), "monthly": sum(x["installment"] for x in act), "remaining": sum(x["remaining"] for x in act),
        "due_this_month": sum(x["installment"] for x in due_month), "overdue": sum(1 for x in act if x["overdue"])}}


def _reminder(conn: sqlite3.Connection, loan: dict[str, Any]) -> int | None:
    """یادآوری قسط بعدی (هر دو روز یک بار تکرار می‌شود تا پرداخت تأیید شود)."""
    if not loan["next_n"]:
        return None
    n = loan["next_n"]
    rec = db.create(conn, "reminders", {
        "title": f"💳 قسط {n} از {loan['count']} «{loan['title']}» — {loan['installment']:,} تومان؛ پرداخت شد؟"[:200],
        "remind_at": f"{loan['next_due']} {REMIND_TIME}", "category": "finance", "repeat": "every2",
        "notes": (f"{loan['lender'] + ' · ' if loan.get('lender') else ''}مانده بعد از این قسط: "
                  f"{max(0, loan['left'] - 1)} قسط\nدر بخش 💰 مالی ← 💳 اقساط «✅ پرداخت شد» را بزنید."),
    })
    conn.execute("UPDATE reminders SET link=?, action=? WHERE id=?",
                 (f"#finance?tab=loans&pay={loan['id']}", f"loan:{loan['id']}:{n}", rec["id"]))
    return rec["id"]


def _close_reminder(conn: sqlite3.Connection, rid: int | None) -> None:
    if rid:
        conn.execute("UPDATE reminders SET status='done', updated_at=? WHERE id=? AND status!='done'", (db.now_str(), rid))


def _refresh_reminder(conn: sqlite3.Connection, lid: int) -> dict[str, Any]:
    loan = get(conn, lid)
    _close_reminder(conn, loan["reminder_id"])
    rid = _reminder(conn, loan) if loan["status"] == "active" else None
    conn.execute("UPDATE loans SET reminder_id=? WHERE id=?", (rid, lid))
    return get(conn, lid)


def save(conn: sqlite3.Connection, data: dict[str, Any], lid: int | None = None) -> dict[str, Any]:
    old = get(conn, lid) if lid else None
    g = lambda k, d=None: data[k] if k in data else (old or {}).get(k, d)  # noqa: E731
    title = str(g("title") or "").strip()[:200]
    if not title:
        raise db.ValidationError("عنوان وام را بنویسید (مثلاً «وام گوشی»)")
    inst = _int(g("installment"), "مبلغ هر قسط", 1)
    count = _int(g("count"), "تعداد اقساط", 1)
    if count > 600:
        raise db.ValidationError("تعداد اقساط زیاد است")
    paid = _int(g("paid", 0), "اقساط پرداخت‌شده")
    if old:
        paid = max(paid, len(old["payments"]))   # پرداخت‌های ثبت‌شده کم نمی‌شوند
    if paid > count:
        raise db.ValidationError("تعداد اقساط پرداخت‌شده از کل اقساط بیشتر است")
    vals = {"title": title, "lender": str(g("lender") or "").strip()[:200], "principal": _int(g("principal", 0), "مبلغ وام"),
            "installment": inst, "count": count, "paid": paid, "first_due": _date(g("first_due"), "تاریخ اولین قسط"),
            "scope": g("scope") if g("scope") in ("personal", "work") else "personal",
            "status": "done" if paid >= count else "active", "notes": str(g("notes") or "").strip()}
    now = db.now_str()
    if old:
        conn.execute(f"UPDATE loans SET {', '.join(k + '=?' for k in vals)}, updated_at=? WHERE id=?", [*vals.values(), now, lid])
        changed = any(old[k] != vals[k] for k in ("installment", "count", "paid", "first_due", "title", "status"))
    else:
        lid = conn.execute(f"INSERT INTO loans ({', '.join(vals)}, payments, created_at, updated_at) VALUES ({', '.join('?' * (len(vals) + 3))})",
                           [*vals.values(), "[]", now, now]).lastrowid
        changed = True
    return _refresh_reminder(conn, lid) if changed else get(conn, lid)


def pay(conn: sqlite3.Connection, lid: int, n: int | None = None, date: str | None = None, amount: Any = None) -> dict[str, Any]:
    """پرداخت قسط بعدی ← هزینه در بخش مالی. اگر n داده شود و آن قسط قبلاً پرداخت شده باشد، دوباره ثبت نمی‌شود."""
    loan = get(conn, lid)
    if loan["status"] != "active" or not loan["next_n"]:
        raise db.ValidationError("همه‌ی اقساط این وام پرداخت شده")
    if n is not None and int(n) != loan["next_n"]:
        if int(n) < loan["next_n"]:
            return {**loan, "already": True}
        raise db.ValidationError("اول قسط‌های قبلی را ثبت کنید")
    n = loan["next_n"]
    amt = _int(amount, "مبلغ قسط", 1) if amount not in (None, "") else loan["installment"]
    date = _date(date, "تاریخ پرداخت") if date else db.today_str()
    tx = db.create(conn, "transactions", {
        "tx_date": date, "kind": "expense", "amount": amt, "category": CATEGORY, "scope": loan["scope"],
        "description": f"قسط {n} از {loan['count']} — {loan['title']}"[:300], "ref_no": f"loan-{lid}-{n}"})
    payments = loan["payments"] + [{"n": n, "date": date, "amount": amt, "tx_id": tx["id"], "due": due_date(loan, n)}]
    paid = n
    conn.execute("UPDATE loans SET paid=?, payments=?, status=?, updated_at=? WHERE id=?",
                 (paid, json.dumps(payments, ensure_ascii=False), "done" if paid >= loan["count"] else "active", db.now_str(), lid))
    return _refresh_reminder(conn, lid)


def undo(conn: sqlite3.Connection, lid: int) -> dict[str, Any]:
    """برگرداندن آخرین پرداخت ثبت‌شده (و حذف هزینه‌اش از بخش مالی)."""
    loan = get(conn, lid)
    if not loan["payments"]:
        raise db.ValidationError("پرداختی برای برگرداندن نیست")
    last = loan["payments"][-1]
    if last.get("tx_id") and conn.execute("SELECT 1 FROM transactions WHERE id=?", (last["tx_id"],)).fetchone():
        db.delete(conn, "transactions", last["tx_id"])
    payments = loan["payments"][:-1]
    conn.execute("UPDATE loans SET paid=?, payments=?, status='active', updated_at=? WHERE id=?",
                 (max(0, loan["paid"] - 1), json.dumps(payments, ensure_ascii=False), db.now_str(), lid))
    return _refresh_reminder(conn, lid)


def snooze(conn: sqlite3.Connection, lid: int, days: int = 1) -> dict[str, Any]:
    """«فردا یادم بینداز»: یادآوری همین قسط به فردا ساعت ۹ می‌رود."""
    loan = get(conn, lid)
    if loan["reminder_id"]:
        when = f"{jalali.add_days(db.today_str(), days)} {REMIND_TIME}"
        conn.execute("UPDATE reminders SET remind_at=?, status='active', updated_at=? WHERE id=?", (when, db.now_str(), loan["reminder_id"]))
    return loan


def delete(conn: sqlite3.Connection, lid: int) -> None:
    loan = get(conn, lid)
    _close_reminder(conn, loan["reminder_id"])
    conn.execute("DELETE FROM loans WHERE id=?", (lid,))


def handle_action(action: str) -> str:
    """دکمه‌های پیام بله: loanpay:ID:N یا loanlater:ID:N ← متن پاسخ."""
    kind, lid, n = (action.split(":") + ["", "", ""])[:3]
    with db.connect() as conn:
        try:
            if kind == "loanpay":
                r = pay(conn, int(lid), int(n))
                if r.get("already"):
                    return f"✔ قسط {n} «{r['title']}» قبلاً ثبت شده بود."
                tail = f"قسط بعدی: {r['next_due']}" if r["next_due"] else "🎉 همه‌ی اقساط این وام پرداخت شد."
                return f"✅ قسط {n} «{r['title']}» ({r['payments'][-1]['amount']:,} تومان) به‌عنوان هزینه ثبت شد.\n{tail}"
            if kind == "loanlater":
                r = snooze(conn, int(lid))
                return f"⏰ باشه؛ فردا ساعت ۹ دوباره درباره‌ی قسط «{r['title']}» یادآوری می‌کنم."
        except (db.ValidationError, db.NotFound, ValueError) as e:
            return f"⚠️ {e}"
    return "دستور ناشناخته"
