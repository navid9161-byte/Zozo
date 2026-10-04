"""صدور صورتحساب (فاکتور) با قالب «صورتحساب آگهی»؛ خروجی PDF در مرورگر ساخته می‌شود.

- سربرگ و اطلاعات پرداخت (نام رسانه، شبا، کارت، نشانی، …) یک بار در «تنظیمات صورتحساب» ثبت می‌شود و
  هنگام ساخت هر فاکتور در خود آن کپی می‌شود؛ پس تغییر بعدی سربرگ، فاکتورهای قدیمی را عوض نمی‌کند.
- فاکتورِ صادرشده تا وقتی پرداخت نشده «طلب» حساب می‌شود (در بخش مالی).
- هر پرداخت (کامل یا بخشی) با تاریخ، مبلغ، شماره‌ی رسید و روش پرداخت ثبت می‌شود و هم‌زمان یک «دریافتی»
  در «دریافت و پرداخت» می‌سازد؛ وضعیت فاکتور خودکار «پرداخت ناقص» یا «پرداخت‌شده» می‌شود.
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any

from . import db, jalali

DEFAULT_PROFILE: dict[str, Any] = {
    "media_name": "عصر رسانه",
    "media_tagline": "روزنامه کرمان",
    "doc_title": "صورتحساب آگهی",
    "table_title": "مشخصات چاپ آگهی",
    "col_title": "عنوان آگهی",
    "col_date": "تاریخ چاپ",
    "col_qty": "تعداد کادر",
    "col_unit": "قیمت هر کادر",
    "col_total": "جمع کل",
    "unit": "ریال",
    "tax_note": "طبق بند \"ل\" ماده ۱۳۹ و تبصره ۲ ماده ۱۰۴ قانون مالیات‌های مستقیم، فعالیت انتشاراتی و "
                "مطبوعاتی از پرداخت مالیات معاف می‌باشد.",
    "payee": "",
    "sheba": "",
    "card": "",
    "bank": "",
    "address": "",
    "contact": "",
    "color": "#4a72a8",
    "logo_media_id": None,
    "show_date": "",
}

STATUS = {"draft": "پیش‌نویس", "issued": "صادرشده", "partial": "پرداخت ناقص", "paid": "پرداخت‌شده",
          "cancelled": "باطل‌شده"}
_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
METHODS = {"card": "کارت به کارت", "sheba": "واریز به شبا / پایا", "pos": "کارت‌خوان", "cash": "نقد", "cheque": "چک",
           "other": "سایر"}


# ───── قالب‌ها: هر روزنامه/رسانه یک قالب جدا (سربرگ، اطلاعات پرداخت، شماره‌گذاری مستقل) ─────
TEMPLATE_KEYS = ("name", "outlet_id")


def _templates(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    raw = db.kv_get(conn, "invoice_templates")
    if raw:
        items = json.loads(raw)
    else:  # مهاجرت از نسخه‌ی تک‌سربرگ
        old = db.kv_get(conn, "invoice_profile")
        prof = {**DEFAULT_PROFILE, **(json.loads(old) if old else {})}
        items = [{"id": 1, "name": prof.get("media_name") or "قالب اصلی", "outlet_id": None, **prof}]
        db.kv_set(conn, "invoice_templates", json.dumps(items, ensure_ascii=False))
        db.kv_set(conn, "invoice_default_template", "1")
    return [{**DEFAULT_PROFILE, **t} for t in items]


def _save_templates(conn: sqlite3.Connection, items: list[dict[str, Any]]) -> None:
    db.kv_set(conn, "invoice_templates", json.dumps(items, ensure_ascii=False))


def _default_tid(conn: sqlite3.Connection, items: list[dict[str, Any]] | None = None) -> int:
    items = items or _templates(conn)
    tid = int(db.kv_get(conn, "invoice_default_template") or 0)
    return tid if any(t["id"] == tid for t in items) else items[0]["id"]


def _template(conn: sqlite3.Connection, tid: Any = None) -> dict[str, Any]:
    items = _templates(conn)
    tid = int(tid) if str(tid or "").strip() else _default_tid(conn, items)
    t = next((t for t in items if t["id"] == tid), None)
    if not t:
        raise db.NotFound("قالب پیدا نشد")
    return t


def _profile_of(t: dict[str, Any]) -> dict[str, Any]:
    return {k: t.get(k, v) for k, v in DEFAULT_PROFILE.items()}


def list_templates() -> dict[str, Any]:
    with db.connect() as conn:
        items = _templates(conn)
        return {"items": items, "default": _default_tid(conn, items)}


def save_template(data: dict[str, Any], tid: int | None = None) -> dict[str, Any]:
    with db.connect() as conn:
        items = _templates(conn)
        clean = {k: data[k] for k in (*DEFAULT_PROFILE, *TEMPLATE_KEYS) if k in data}
        if "outlet_id" in clean:
            clean["outlet_id"] = int(clean["outlet_id"]) if str(clean["outlet_id"] or "").strip() else None
        if tid is None:
            base = _template(conn, data.get("copy_from")) if data.get("copy_from") else DEFAULT_PROFILE
            new = {**_profile_of(base), "outlet_id": None, **clean, "id": max(t["id"] for t in items) + 1}
            new["name"] = (new.get("name") or new.get("media_name") or f"قالب {len(items) + 1}").strip()
            items.append(new)
            tid = new["id"]
        else:
            t = next((t for t in items if t["id"] == tid), None)
            if not t:
                raise db.NotFound("قالب پیدا نشد")
            t.update(clean)
            if not str(t.get("name") or "").strip():
                t["name"] = t.get("media_name") or "قالب"
        _save_templates(conn, items)
        return next(t for t in _templates(conn) if t["id"] == tid)


def delete_template(tid: int) -> None:
    with db.connect() as conn:
        items = _templates(conn)
        if len(items) <= 1:
            raise db.ValidationError("دست‌کم یک قالب باید بماند")
        _save_templates(conn, [t for t in items if t["id"] != tid])


def set_default_template(tid: int) -> None:
    with db.connect() as conn:
        _template(conn, tid)
        db.kv_set(conn, "invoice_default_template", str(tid))


# سازگاری با نسخه‌ی قبل: «سربرگ» = قالب پیش‌فرض
def _profile(conn: sqlite3.Connection) -> dict[str, Any]:
    return _profile_of(_template(conn))


def get_profile() -> dict[str, Any]:
    with db.connect() as conn:
        return _profile(conn)


def save_profile(data: dict[str, Any]) -> dict[str, Any]:
    with db.connect() as conn:
        tid = _default_tid(conn)
    save_template({k: data[k] for k in DEFAULT_PROFILE if k in data}, tid)
    return get_profile()


def _items(raw: Any) -> list[dict[str, Any]]:
    out = []
    for it in raw or []:
        if not isinstance(it, dict):
            continue
        title = str(it.get("title") or "").strip()
        qty = db.to_int(it.get("qty") or 0, "تعداد") if str(it.get("qty") or "").strip() else 0
        unit = db.to_int(it.get("unit_price") or 0, "قیمت") if str(it.get("unit_price") or "").strip() else 0
        if not title and not unit:
            continue
        date = str(it.get("date") or "").strip()
        if date:
            try:
                date = jalali.normalize(date)
            except ValueError as e:
                raise db.ValidationError(str(e)) from None
        out.append({"title": title, "date": date, "qty": qty, "qty_label": str(it.get("qty_label") or "").strip(),
                    "unit_price": unit})
    return out


def totals(inv: dict[str, Any]) -> dict[str, int]:
    subtotal = sum((it["qty"] or 1) * it["unit_price"] for it in inv["items"])
    discount = inv.get("discount") or 0
    return {"subtotal": subtotal, "discount": discount, "payable": max(0, subtotal - discount)}


def _row(r: sqlite3.Row) -> dict[str, Any]:
    d = dict(r)
    d["items"] = json.loads(d["items"] or "[]")
    d["payments"] = json.loads(d.get("payments") or "[]")
    d["profile"] = {**DEFAULT_PROFILE, **json.loads(d["profile"] or "{}")}
    d.update(totals(d))
    d["paid_total"] = sum(p["amount"] for p in d["payments"])
    d["remaining"] = max(0, d["payable"] - d["paid_total"])
    d["status_label"] = STATUS.get(d["status"], d["status"])
    return d


def _seq_key(tid: int, year: str) -> str:
    return f"invoice_seq:{year}" if tid == 1 else f"invoice_seq:{tid}:{year}"


def next_number(conn: sqlite3.Connection, tid: int | None = None) -> str:
    """شماره‌ی بعدی؛ هر قالب (روزنامه) شماره‌گذاری جدای خودش را دارد."""
    tid = tid or _default_tid(conn)
    year = db.today_str()[:4]
    seq = int(db.kv_get(conn, _seq_key(tid, year)) or 0) + 1
    return f"{year}-{seq:04d}"


def list_all() -> list[dict[str, Any]]:
    with db.connect() as conn:
        return [_row(r) for r in conn.execute("SELECT * FROM invoices ORDER BY id DESC LIMIT 500")]


def _get(conn: sqlite3.Connection, inv_id: int) -> dict[str, Any]:
    r = conn.execute("SELECT * FROM invoices WHERE id=?", (inv_id,)).fetchone()
    if not r:
        raise db.NotFound("صورتحساب پیدا نشد")
    return _row(r)


def get(inv_id: int) -> dict[str, Any]:
    with db.connect() as conn:
        return _get(conn, inv_id)


FIELDS = ("number", "date", "customer", "customer_phone", "customer_address", "customer_code", "notes", "status",
          "outlet_id", "template_id")


def _clean(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    vals: dict[str, Any] = {}
    for k in FIELDS:
        if k in data:
            v = data[k]
            vals[k] = str(v).strip() if v not in (None, "") else None
    if "date" in vals and vals["date"]:
        try:
            vals["date"] = jalali.normalize(vals["date"])
        except ValueError as e:
            raise db.ValidationError(str(e)) from None
    if "status" in vals and vals["status"] not in STATUS:
        raise db.ValidationError("وضعیت نامعتبر است")
    if vals.get("template_id"):
        vals["template_id"] = _template(conn, vals["template_id"])["id"]
        if "profile" not in data:  # قالب عوض شد: سربرگ و اطلاعات پرداخت از قالب تازه
            vals["profile"] = json.dumps(_profile_of(_template(conn, vals["template_id"])), ensure_ascii=False)
    if "outlet_id" in vals and vals["outlet_id"]:
        vals["outlet_id"] = int(vals["outlet_id"])
        if not conn.execute("SELECT 1 FROM outlets WHERE id=?", (vals["outlet_id"],)).fetchone():
            vals["outlet_id"] = None
    if "items" in data:
        vals["items"] = json.dumps(_items(data["items"]), ensure_ascii=False)
    if "discount" in data:
        vals["discount"] = db.to_int(data["discount"], "تخفیف") if str(data["discount"] or "").strip() else 0
    if "profile" in data and isinstance(data["profile"], dict):
        vals["profile"] = json.dumps({k: data["profile"][k] for k in DEFAULT_PROFILE if k in data["profile"]},
                                     ensure_ascii=False)
    return vals


def create(data: dict[str, Any]) -> dict[str, Any]:
    with db.connect() as conn:
        tpl = _template(conn, data.get("template_id"))
        data = {**data, "template_id": tpl["id"]}
        if "profile" not in data:
            data["profile"] = _profile_of(tpl)
        if tpl.get("outlet_id") and not data.get("outlet_id"):
            data["outlet_id"] = tpl["outlet_id"]
        vals = _clean(conn, data)
        if not vals.get("number"):
            vals["number"] = next_number(conn, tpl["id"])
        year = vals["number"][:4]
        if vals["number"] == next_number(conn, tpl["id"]):
            db.kv_set(conn, _seq_key(tpl["id"], year), str(int(vals["number"].split("-")[-1])))
        vals.setdefault("date", db.today_str())
        vals.setdefault("status", "draft")
        vals.setdefault("items", "[]")
        vals.setdefault("discount", 0)
        vals["created_at"] = vals["updated_at"] = db.now_str()
        cols = ", ".join(vals)
        cur = conn.execute(f"INSERT INTO invoices ({cols}) VALUES ({', '.join('?' * len(vals))})", list(vals.values()))
        inv_id = cur.lastrowid
    return get(inv_id)


def update(inv_id: int, data: dict[str, Any]) -> dict[str, Any]:
    with db.connect() as conn:
        before = _get(conn, inv_id)
        vals = _clean(conn, data)
        if not vals:
            return before
        vals["updated_at"] = db.now_str()
        conn.execute(f"UPDATE invoices SET {', '.join(f'{k}=?' for k in vals)} WHERE id=?", [*vals.values(), inv_id])
        after = _get(conn, inv_id)
        if after["status"] == "paid" and before["status"] != "paid" and after["remaining"] > 0:
            # «پرداخت شد» بدون ثبت جزئیات: باقی‌مانده با تاریخ امروز ثبت می‌شود
            _add_payment(conn, after, {"amount": after["remaining"], "note": "ثبت با تغییر وضعیت به «پرداخت‌شده»"})
        elif after["payments"] and ("items" in vals or "discount" in vals):
            _sync_status(conn, inv_id)
        return _get(conn, inv_id)


def _sync_status(conn: sqlite3.Connection, inv_id: int) -> None:
    inv = _get(conn, inv_id)
    status, paid_date = inv["status"], inv.get("paid_date")
    if inv["payments"]:
        paid_date = max(p["date"] for p in inv["payments"])
        if inv["status"] != "cancelled":
            status = "paid" if inv["paid_total"] >= inv["payable"] > 0 else "partial"
    elif status in ("paid", "partial"):
        status, paid_date = "issued", None
    conn.execute("UPDATE invoices SET status=?, paid_date=?, updated_at=? WHERE id=?",
                 (status, paid_date, db.now_str(), inv_id))


def _add_payment(conn: sqlite3.Connection, inv: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    raw = str(data.get("amount") or "").strip()
    amount = db.to_int(raw, "مبلغ") if raw else inv["remaining"]
    if not amount or amount <= 0:
        raise db.ValidationError("مبلغ پرداخت را وارد کنید")
    try:
        date = jalali.normalize(str(data.get("date") or "").strip() or db.today_str())
    except ValueError as e:
        raise db.ValidationError(str(e)) from None
    method = data.get("method") or ""
    if method and method not in METHODS:
        method = "other"
    ref_no = str(data.get("ref_no") or "").strip().translate(_DIGITS)
    note = str(data.get("note") or "").strip()
    desc = f"دریافت صورتحساب {inv['number']}"
    if inv.get("customer"):
        desc += f" — {inv['customer']}"
    tx = db.create(conn, "transactions", {
        "tx_date": date, "kind": "income", "amount": amount, "category": "صورتحساب", "description": desc,
        "outlet_id": inv.get("outlet_id"), "ref_no": ref_no or None,
    })
    conn.execute("UPDATE transactions SET invoice_id=? WHERE id=?", (inv["id"], tx["id"]))
    pays = inv["payments"] + [{
        "id": tx["id"], "tx_id": tx["id"], "date": date, "amount": amount, "ref_no": ref_no, "method": method,
        "note": note, "created_at": db.now_str(),
    }]
    conn.execute("UPDATE invoices SET payments=? WHERE id=?", (json.dumps(pays, ensure_ascii=False), inv["id"]))
    if inv["status"] == "draft":
        conn.execute("UPDATE invoices SET status='issued' WHERE id=?", (inv["id"],))
    _sync_status(conn, inv["id"])
    return tx


def add_payment(inv_id: int, data: dict[str, Any]) -> dict[str, Any]:
    with db.connect() as conn:
        inv = _get(conn, inv_id)
        if inv["status"] == "cancelled":
            raise db.ValidationError("این صورتحساب باطل شده است")
        _add_payment(conn, inv, data)
        return _get(conn, inv_id)


def _drop_payment(conn: sqlite3.Connection, inv: dict[str, Any], pay_id: int) -> None:
    pays = [p for p in inv["payments"] if p["id"] != pay_id]
    conn.execute("UPDATE invoices SET payments=? WHERE id=?", (json.dumps(pays, ensure_ascii=False), inv["id"]))
    _sync_status(conn, inv["id"])


def delete_payment(inv_id: int, pay_id: int) -> dict[str, Any]:
    with db.connect() as conn:
        inv = _get(conn, inv_id)
        pay = next((p for p in inv["payments"] if p["id"] == pay_id), None)
        if not pay:
            raise db.NotFound("این پرداخت پیدا نشد")
        conn.execute("DELETE FROM transactions WHERE id=?", (pay["tx_id"],))
        _drop_payment(conn, inv, pay_id)
        return _get(conn, inv_id)


def on_transaction_deleted(conn: sqlite3.Connection, tx: dict[str, Any]) -> None:
    """اگر دریافتیِ یک فاکتور از «دریافت و پرداخت» پاک شد، پرداختش از فاکتور هم برداشته شود."""
    if not tx.get("invoice_id"):
        return
    try:
        inv = _get(conn, tx["invoice_id"])
    except db.NotFound:
        return
    for p in inv["payments"]:
        if p.get("tx_id") == tx["id"]:
            _drop_payment(conn, inv, p["id"])


def open_invoices(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = [_row(r) for r in conn.execute("SELECT * FROM invoices WHERE status IN ('issued','partial') ORDER BY date")]
    return [r for r in rows if r["remaining"] > 0]


def all_payments(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    out = []
    for r in conn.execute("SELECT * FROM invoices WHERE payments IS NOT NULL AND payments != '[]'"):
        inv = _row(r)
        for p in inv["payments"]:
            out.append({**p, "invoice_id": inv["id"], "number": inv["number"], "customer": inv["customer"],
                        "method_label": METHODS.get(p.get("method") or "", "")})
    return sorted(out, key=lambda p: (p["date"], p.get("tx_id") or 0), reverse=True)


def duplicate(inv_id: int) -> dict[str, Any]:
    src = get(inv_id)
    return create({"template_id": src.get("template_id"), "customer": src["customer"], "customer_phone": src["customer_phone"],
                   "customer_address": src["customer_address"], "customer_code": src["customer_code"],
                   "items": src["items"], "discount": src["discount"], "notes": src["notes"],
                   "profile": src["profile"], "outlet_id": src.get("outlet_id")})


def delete(inv_id: int) -> None:
    with db.connect() as conn:
        _get(conn, inv_id)
        # دریافتی‌های ثبت‌شده واقعاً دریافت شده‌اند؛ می‌مانند ولی پیوندشان با فاکتور برداشته می‌شود
        conn.execute("UPDATE transactions SET invoice_id=NULL WHERE invoice_id=?", (inv_id,))
        conn.execute("DELETE FROM invoices WHERE id=?", (inv_id,))
