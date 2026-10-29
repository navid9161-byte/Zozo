"""فاکتور روزنامه‌ها: روزنامه‌ها، مشتری‌ها و فاکتورهای ساده با پیگیری وصول.

- هر مشتری (اداره، شخص، شرکت، ارگان…) برای یک، چند یا همه‌ی روزنامه‌ها است.
- فاکتور: مبلغ کل، سود من و سهم روزنامه‌ی اصلی — همه دستی.
- وضعیت: «در حال پیگیری»، «تجدید چاپ دوم» و «پیگیری مجدد» تاریخ پیگیری می‌گیرند و خودکار
  یک یادآوری می‌سازند (یادآوری قبلی بسته می‌شود)؛ «اعلام وصول» مبلغ کل را درآمد و سهم روزنامه را
  هزینه در بخش مالی ثبت می‌کند. همه‌ی تغییرها در تاریخچه‌ی فاکتور می‌ماند.
"""
from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

from . import db, jalali

STATUS = {"follow": "در حال پیگیری", "reprint": "تجدید چاپ دوم", "refollow": "پیگیری مجدد", "collected": "اعلام وصول"}
FOLLOW = ("follow", "reprint", "refollow")
CLIENT_KINDS = {"office": "اداره", "person": "شخص", "company": "شرکت", "org": "ارگان / نهاد", "other": "سایر"}
REMIND_TIME = "09:00"
INCOME_CAT, EXPENSE_CAT = "آگهی روزنامه", "سهم روزنامه"
_EN = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def _en(s: str) -> str:
    return str(s).translate(_EN)


def _date(v: Any, field: str) -> str | None:
    v = re.sub(r"\s+", "", _en(str(v or "")))
    if not v:
        return None
    try:
        jalali.parse(v)
    except (ValueError, TypeError) as e:
        raise db.ValidationError(f"{field} درست نیست؛ مثلاً {db.today_str()}") from e
    y, m, d = (int(x) for x in v.replace("-", "/").split("/"))
    return f"{y:04d}/{m:02d}/{d:02d}"


def _money(v: Any, field: str) -> int:
    s = re.sub(r"[^\d-]", "", _en(str(v if v is not None else "")))
    if not s or s == "-":
        return 0
    n = int(s)
    if n < 0:
        raise db.ValidationError(f"{field} نمی‌تواند منفی باشد")
    return n


def _name(v: Any, what: str) -> str:
    v = str(v or "").strip()
    if not v:
        raise db.ValidationError(f"نام {what} را بنویسید")
    return v[:200]


# ───────────────────────── روزنامه‌ها ─────────────────────────

def list_papers(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    return [dict(r) for r in conn.execute(
        "SELECT p.*, (SELECT COUNT(*) FROM paper_client_links l WHERE l.paper_id=p.id) clients, "
        "(SELECT COUNT(*) FROM paper_invoices i WHERE i.paper_id=p.id) invoices FROM papers p ORDER BY p.name")]


def save_paper(conn: sqlite3.Connection, data: dict[str, Any], pid: int | None = None) -> dict[str, Any]:
    name, notes, now = _name(data.get("name"), "روزنامه"), str(data.get("notes") or "").strip(), db.now_str()
    if conn.execute("SELECT 1 FROM papers WHERE name=? AND id!=?", (name, pid or 0)).fetchone():
        raise db.ValidationError(f"روزنامه‌ی «{name}» قبلاً ثبت شده")
    if pid:
        if not conn.execute("UPDATE papers SET name=?, notes=?, updated_at=? WHERE id=?", (name, notes, now, pid)).rowcount:
            raise db.NotFound("روزنامه پیدا نشد")
    else:
        pid = conn.execute("INSERT INTO papers (name, notes, created_at, updated_at) VALUES (?,?,?,?)",
                           (name, notes, now, now)).lastrowid
    return dict(conn.execute("SELECT * FROM papers WHERE id=?", (pid,)).fetchone())


def delete_paper(conn: sqlite3.Connection, pid: int) -> None:
    if conn.execute("SELECT 1 FROM paper_invoices WHERE paper_id=?", (pid,)).fetchone():
        raise db.ValidationError("این روزنامه فاکتور دارد؛ اول فاکتورهایش را حذف یا به روزنامه‌ی دیگری منتقل کنید")
    conn.execute("DELETE FROM papers WHERE id=?", (pid,))


# ───────────────────────── مشتری‌ها ─────────────────────────

def list_clients(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    links: dict[int, list[int]] = {}
    for r in conn.execute("SELECT client_id, paper_id FROM paper_client_links"):
        links.setdefault(r["client_id"], []).append(r["paper_id"])
    out = []
    for r in conn.execute("SELECT c.*, (SELECT COUNT(*) FROM paper_invoices i WHERE i.client_id=c.id) invoices "
                          "FROM paper_clients c ORDER BY c.name"):
        d = dict(r)
        d["paper_ids"] = sorted(links.get(r["id"], []))
        d["kind_label"] = CLIENT_KINDS.get(d["kind"] or "", "")
        try:
            d["phones"] = [p for p in json.loads(d.get("phones") or "[]") if p]
        except ValueError:
            d["phones"] = []
        out.append(d)
    return out


def save_client(conn: sqlite3.Connection, data: dict[str, Any], cid: int | None = None) -> dict[str, Any]:
    name, now = _name(data.get("name"), "مشتری"), db.now_str()
    old = conn.execute("SELECT kind FROM paper_clients WHERE id=?", (cid or 0,)).fetchone()
    kind = data.get("kind") if data.get("kind") in CLIENT_KINDS else (old["kind"] if old else "other")
    raw = data.get("phones")
    if raw is None:
        raw = [data.get("phone")]
    phones = []
    for p in raw if isinstance(raw, list) else [raw]:
        p = _en(str(p or "")).strip()[:40]
        if p and p not in phones:
            phones.append(p)
    phone = phones[0] if phones else ""
    address = str(data.get("address") if "address" in data else data.get("notes") or "").strip()[:500]
    notes = address
    valid = {r["id"] for r in conn.execute("SELECT id FROM papers")}
    ids = valid if data.get("all_papers") else {int(x) for x in (data.get("paper_ids") or []) if int(x) in valid}
    if not ids:
        raise db.ValidationError("دست‌کم یک روزنامه برای این مشتری انتخاب کنید")
    if cid:
        if not conn.execute("UPDATE paper_clients SET name=?, kind=?, phone=?, phones=?, address=?, notes=?, updated_at=? WHERE id=?",
                            (name, kind, phone, json.dumps(phones, ensure_ascii=False), address, notes, now, cid)).rowcount:
            raise db.NotFound("مشتری پیدا نشد")
        conn.execute("DELETE FROM paper_client_links WHERE client_id=?", (cid,))
    else:
        cid = conn.execute("INSERT INTO paper_clients (name, kind, phone, phones, address, notes, created_at, updated_at) "
                           "VALUES (?,?,?,?,?,?,?,?)",
                           (name, kind, phone, json.dumps(phones, ensure_ascii=False), address, notes, now, now)).lastrowid
    conn.executemany("INSERT INTO paper_client_links (client_id, paper_id) VALUES (?,?)", [(cid, p) for p in sorted(ids)])
    return next(c for c in list_clients(conn) if c["id"] == cid)


def delete_client(conn: sqlite3.Connection, cid: int) -> None:
    if conn.execute("SELECT 1 FROM paper_invoices WHERE client_id=?", (cid,)).fetchone():
        raise db.ValidationError("این مشتری فاکتور دارد؛ اول فاکتورهایش را حذف کنید")
    conn.execute("DELETE FROM paper_clients WHERE id=?", (cid,))


# ───────────────────────── فاکتورها ─────────────────────────

def _row(r: sqlite3.Row) -> dict[str, Any]:
    d = dict(r)
    d["history"] = json.loads(d.get("history") or "[]")
    d["status_label"] = STATUS.get(d["status"], d["status"])
    today = db.today_str()
    d["overdue"] = bool(d["status"] in FOLLOW and d["follow_date"] and d["follow_date"] < today)
    d["renewals"] = sum(1 for h in d["history"] if h.get("event") == "follow" and h.get("status") in ("reprint", "refollow"))
    return d


_SELECT = ("SELECT i.*, c.name client_name, p.name paper_name FROM paper_invoices i "
           "LEFT JOIN paper_clients c ON c.id=i.client_id LEFT JOIN papers p ON p.id=i.paper_id")


def get_invoice(conn: sqlite3.Connection, iid: int) -> dict[str, Any]:
    r = conn.execute(_SELECT + " WHERE i.id=?", (iid,)).fetchone()
    if not r:
        raise db.NotFound("فاکتور پیدا نشد")
    return _row(r)


def next_number(conn: sqlite3.Connection) -> str:
    year = db.today_str()[:4]
    n = 0
    for (num,) in conn.execute("SELECT number FROM paper_invoices WHERE number LIKE ?", (f"{year}-%",)):
        m = re.fullmatch(rf"{year}-(\d+)", num or "")
        if m:
            n = max(n, int(m.group(1)))
    return f"{year}-{n + 1:03d}"


def _reminder(conn: sqlite3.Connection, inv: dict[str, Any]) -> int:
    """یادآوری پیگیری همین فاکتور در بخش «یادآوری‌ها»."""
    title = f"🧾 پیگیری فاکتور {inv['number']} — {inv['client_name'] or 'مشتری'} ({inv['paper_name'] or 'روزنامه'})"
    notes = (f"وضعیت: {STATUS[inv['status']]}\nمبلغ کل: {inv['total']:,} · سهم روزنامه: {inv['paper_cost']:,}"
             f"{' · ' + inv['title'] if inv.get('title') else ''}\nبرای تغییر وضعیت: بخش «فاکتور روزنامه‌ها»")
    rec = db.create(conn, "reminders", {"title": title[:200], "remind_at": f"{inv['follow_date']} {REMIND_TIME}",
                                        "category": "finance", "notes": notes})
    return rec["id"]


def _close_reminder(conn: sqlite3.Connection, rid: int | None) -> None:
    if rid:
        conn.execute("UPDATE reminders SET status='done', updated_at=? WHERE id=? AND status!='done'", (db.now_str(), rid))


def _tx(conn: sqlite3.Connection, tid: int | None, kind: str, amount: int, inv: dict[str, Any]) -> int | None:
    """درآمد/هزینه‌ی همین فاکتور در بخش مالی (ساخت، به‌روزرسانی یا حذف)."""
    if tid and not conn.execute("SELECT 1 FROM transactions WHERE id=?", (tid,)).fetchone():
        tid = None
    if amount <= 0:
        if tid:
            db.delete(conn, "transactions", tid)
        return None
    who = f"{inv['client_name'] or 'مشتری'} / {inv['paper_name'] or 'روزنامه'}"
    vals = {"tx_date": inv["collected_date"] or db.today_str(), "kind": kind, "amount": amount, "scope": "work",
            "category": INCOME_CAT if kind == "income" else EXPENSE_CAT,
            "description": (f"وصول فاکتور {inv['number']} — {who}" if kind == "income" else f"سهم روزنامه، فاکتور {inv['number']} — {who}")[:300],
            "ref_no": inv["number"]}
    if tid:
        db.update(conn, "transactions", tid, vals)
        return tid
    return db.create(conn, "transactions", vals)["id"]


def save_invoice(conn: sqlite3.Connection, data: dict[str, Any], iid: int | None = None) -> dict[str, Any]:
    old = get_invoice(conn, iid) if iid else None
    cid = int(data.get("client_id") or (old or {}).get("client_id") or 0)
    pid = int(data.get("paper_id") or (old or {}).get("paper_id") or 0)
    if not conn.execute("SELECT 1 FROM paper_clients WHERE id=?", (cid,)).fetchone():
        raise db.ValidationError("مشتری را انتخاب کنید")
    if not conn.execute("SELECT 1 FROM papers WHERE id=?", (pid,)).fetchone():
        raise db.ValidationError("روزنامه را انتخاب کنید")
    if not conn.execute("SELECT 1 FROM paper_client_links WHERE client_id=? AND paper_id=?", (cid, pid)).fetchone():
        raise db.ValidationError("این مشتری برای این روزنامه تعریف نشده؛ در «مشتری‌ها» روزنامه را به او اضافه کنید")
    g = lambda k, d=None: data[k] if k in data else (old or {}).get(k, d)  # noqa: E731
    status = g("status", "follow")
    if status not in STATUS:
        raise db.ValidationError("وضعیت درست نیست")
    total, profit, cost = _money(g("total"), "مبلغ کل"), _money(g("profit"), "سود من"), _money(g("paper_cost"), "سهم روزنامه")
    if not total:
        raise db.ValidationError("مبلغ کل را بنویسید")
    issue = _date(g("issue_date"), "تاریخ فاکتور") or db.today_str()
    follow = _date(g("follow_date"), "تاریخ پیگیری")
    collected = _date(g("collected_date"), "تاریخ وصول")
    if status in FOLLOW and not follow:
        raise db.ValidationError("تاریخ پیگیری را انتخاب کنید")
    if status == "collected":
        collected = collected or db.today_str()
    else:
        collected = None
    number = str(g("number") or "").strip() or next_number(conn)
    vals = {"number": number[:40], "issue_date": issue, "client_id": cid, "paper_id": pid,
            "title": str(g("title") or "").strip()[:300], "total": total, "profit": profit, "paper_cost": cost,
            "status": status, "follow_date": follow if status in FOLLOW else (old or {}).get("follow_date"),
            "collected_date": collected, "notes": str(g("notes") or "").strip()}
    now = db.now_str()
    history = list((old or {}).get("history") or [])
    if not old:
        history.append({"at": now, "event": "create", "status": status, "follow": vals["follow_date"]})
    elif old["status"] != status or (status in FOLLOW and old["follow_date"] != follow):
        history.append({"at": now, "event": "collected" if status == "collected" else "follow", "status": status,
                        "follow": follow if status in FOLLOW else None, "from": old["status"]})
    cols = list(vals) + ["history", "updated_at"]
    args = [*vals.values(), json.dumps(history, ensure_ascii=False), now]
    if old:
        conn.execute(f"UPDATE paper_invoices SET {', '.join(c + '=?' for c in cols)} WHERE id=?", [*args, iid])
    else:
        iid = conn.execute(f"INSERT INTO paper_invoices ({', '.join(cols)}, created_at) VALUES ({', '.join('?' * (len(cols) + 1))})",
                           [*args, now]).lastrowid
    inv = get_invoice(conn, iid)
    # یادآوری: برای هر تاریخ/وضعیت پیگیری تازه یک یادآوری؛ قبلی بسته می‌شود
    rid = inv["reminder_id"]
    if status in FOLLOW:
        if not old or old["status"] != status or old["follow_date"] != follow:
            _close_reminder(conn, rid)
            rid = _reminder(conn, inv)
    else:
        _close_reminder(conn, rid)
    # بخش مالی: فقط وقتی وصول اعلام شده
    if status == "collected":
        ti = _tx(conn, inv["tx_income_id"], "income", total, inv)
        te = _tx(conn, inv["tx_expense_id"], "expense", cost, inv)
    else:
        ti = _tx(conn, inv["tx_income_id"], "income", 0, inv)
        te = _tx(conn, inv["tx_expense_id"], "expense", 0, inv)
    conn.execute("UPDATE paper_invoices SET reminder_id=?, tx_income_id=?, tx_expense_id=? WHERE id=?", (rid, ti, te, iid))
    return get_invoice(conn, iid)


def delete_invoice(conn: sqlite3.Connection, iid: int) -> None:
    inv = get_invoice(conn, iid)
    _close_reminder(conn, inv["reminder_id"])
    for t in (inv["tx_income_id"], inv["tx_expense_id"]):
        if t and conn.execute("SELECT 1 FROM transactions WHERE id=?", (t,)).fetchone():
            db.delete(conn, "transactions", t)
    conn.execute("DELETE FROM paper_invoices WHERE id=?", (iid,))


def list_invoices(conn: sqlite3.Connection, paper_id: int | None = None, client_id: int | None = None,
                  status: str = "", q: str = "", date_from: str = "", date_to: str = "") -> dict[str, Any]:
    where, args = [], []
    if paper_id:
        where.append("i.paper_id=?"); args.append(paper_id)
    if client_id:
        where.append("i.client_id=?"); args.append(client_id)
    if status == "open":
        where.append("i.status IN ('follow','reprint','refollow')")
    elif status in STATUS:
        where.append("i.status=?"); args.append(status)
    if q.strip():
        like = f"%{_en(q.strip())}%"
        where.append("(i.number LIKE ? OR i.title LIKE ? OR c.name LIKE ? OR p.name LIKE ?)"); args += [like] * 4
    if date_from:
        where.append("i.issue_date >= ?"); args.append(_date(date_from, "از تاریخ"))
    if date_to:
        where.append("i.issue_date <= ?"); args.append(_date(date_to, "تا تاریخ"))
    sql = _SELECT + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY i.issue_date DESC, i.id DESC"
    items = [_row(r) for r in conn.execute(sql, args)]

    def tot(rows: list[dict[str, Any]]) -> dict[str, int]:
        return {"count": len(rows), "total": sum(r["total"] for r in rows), "profit": sum(r["profit"] for r in rows),
                "paper_cost": sum(r["paper_cost"] for r in rows),
                "collected": sum(r["total"] for r in rows if r["status"] == "collected"),
                "open": sum(r["total"] for r in rows if r["status"] in FOLLOW)}

    def by(key: str, name: str) -> list[dict[str, Any]]:
        groups: dict[Any, list[dict[str, Any]]] = {}
        for r in items:
            groups.setdefault(r[key], []).append(r)
        out = [{"id": k, "name": v[0][name] or "—", **tot(v)} for k, v in groups.items()]
        return sorted(out, key=lambda x: -x["total"])

    return {"items": items, "totals": tot(items), "by_client": by("client_id", "client_name"),
            "by_paper": by("paper_id", "paper_name"), "by_status": {k: tot([r for r in items if r["status"] == k]) for k in STATUS}}
