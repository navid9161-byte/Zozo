import datetime as dt

import pytest

from zozo import db, feeds, jalali, notify, scheduler, services, textnorm


# ───────────── تاریخ شمسی ─────────────

def test_jalali_roundtrip():
    for d in [dt.date(2026, 9, 28), dt.date(2025, 3, 20), dt.date(2025, 3, 21), dt.date(2024, 12, 31)]:
        j = jalali.to_jalali(d)
        assert jalali.parse(j) == d
    assert jalali.to_jalali(dt.date(2026, 9, 28)) == "1405/07/06"
    assert jalali.to_jalali(dt.date(2025, 3, 21)) == "1404/01/01"


def test_jalali_months():
    assert jalali.month_length(1405, 1) == 31
    assert jalali.month_length(1405, 7) == 30
    assert jalali.month_length(1403, 12) == 30  # ۱۴۰۳ کبیسه است
    assert jalali.month_length(1404, 12) == 29
    assert jalali.add_months("1405/06/31", 1) == "1405/07/30"
    assert jalali.add_months("1405/12/15", 1) == "1406/01/15"
    assert jalali.prev_months("1405/02", 3) == ["1404/12", "1405/01", "1405/02"]
    assert jalali.month_range("1405/07") == ("1405/07/01", "1405/07/30")
    assert jalali.normalize("۱۴۰۵/۷/۶") == "1405/07/06"
    with pytest.raises(ValueError):
        jalali.normalize("1405/13/01")


# ───────────── متن فارسی ─────────────

def test_fix_persian():
    out = textnorm.fix_persian("مي خواهم كتاب ها را ببينم ، سال 1405")
    assert "می‌خواهم" in out
    assert "کتاب‌ها" in out
    assert "،" in out and " ،" not in out
    assert "۱۴۰۵" in out
    # نشانی اینترنتی دست نمی‌خورد
    assert "https://ex.com/a1" in textnorm.fix_persian("ببینید https://ex.com/a1 را")


def test_summary_and_stats():
    text = ("وزیر اقتصاد امروز از افزایش بودجه‌ی عمرانی خبر داد. این افزایش بودجه شامل پروژه‌های راه‌سازی است. "
            "هوا آفتابی بود. کارشناسان بودجه‌ی عمرانی را مهم می‌دانند.")
    s = textnorm.extractive_summary(text, 2)
    assert len(s) == 2 and s[0].startswith("وزیر")
    assert textnorm.text_stats(text)["words"] > 20


def test_keyword_match():
    norm = textnorm.normalize("شهرداري تهران امروز اعلام كرد")
    assert textnorm.matches_keyword(norm, "شهرداری تهران")
    assert not textnorm.matches_keyword(norm, "هران")


# ───────────── داده و قواعد ─────────────

def test_story_payment_creates_income():
    with db.connect() as conn:
        o = db.create(conn, "outlets", {"name": "خبرگزاری آزمون", "pay_type": "per_item", "default_fee": 500000})
        s = db.create(conn, "stories", {"title": "گزارش آب", "outlet_id": o["id"], "fee": "1,500,000"})
        assert s["pay_status"] == "unpaid" and s["outlet_name"] == "خبرگزاری آزمون"
        s = db.update(conn, "stories", s["id"], {"paid_amount": 500000})
        assert s["pay_status"] == "partial"
        s = db.update(conn, "stories", s["id"], {"pay_status": "paid"})
        assert s["paid_amount"] == 1500000
        txs = db.list_records(conn, "transactions", filters={"story_id": s["id"]})
        assert sorted(t["amount"] for t in txs) == [500000, 1000000]
        assert all(t["kind"] == "income" and t["outlet_id"] == o["id"] for t in txs)
        r = services.receivables(conn)
        assert all(x["id"] != s["id"] for x in r["stories"])


def test_story_publish_sets_date_and_validation():
    with db.connect() as conn:
        s = db.create(conn, "stories", {"title": "خبر", "status": "writing", "deadline": "۱۴۰۵/۰۷/۱۰"})
        assert s["deadline"] == "1405/07/10"
        s = db.update(conn, "stories", s["id"], {"status": "منتشرشده"})
        assert s["status"] == "published" and s["published_date"] == db.today_str()
        with pytest.raises(db.ValidationError):
            db.create(conn, "stories", {"title": "x", "deadline": "فردا"})
        with pytest.raises(db.ValidationError):
            db.create(conn, "stories", {"deadline": "1405/07/10"})


def test_reminders_repeat_and_once():
    with db.connect() as conn:
        once = db.create(conn, "reminders", {"title": "تماس با منبع", "remind_at": "1405/07/01 09:00"})
        rep = db.create(conn, "reminders", {"title": "جلسه‌ی تحریریه", "remind_at": "1405/07/01 10:00", "repeat": "weekly"})
        n = scheduler.check_reminders(conn, "1405/07/06 12:00")
        assert n == 2
        assert db.get(conn, "reminders", once["id"])["status"] == "sent"
        assert db.get(conn, "reminders", rep["id"])["remind_at"] == "1405/07/08 10:00"
        # دوباره اعلان تکراری ثبت نمی‌شود
        assert scheduler.check_reminders(conn, "1405/07/06 12:01") == 0
        titles = [r["title"] for r in conn.execute("SELECT title FROM notifications")]
        assert "⏰ تماس با منبع" in titles


def test_story_deadline_notification():
    with db.connect() as conn:
        s = db.create(conn, "stories", {"title": "مصاحبه با وزیر", "deadline": "1405/07/06", "deadline_time": "14:00"})
        assert scheduler.check_stories(conn, "1405/07/06 11:00") == 0
        assert scheduler.check_stories(conn, "1405/07/06 12:05") == 1
        assert scheduler.check_stories(conn, "1405/07/06 12:10") == 0
        assert db.get(conn, "stories", s["id"])["reminded"] == "1405/07/06 12:00"


def test_dashboard_finance_calendar():
    with db.connect() as conn:
        today = db.today_str()
        o = db.create(conn, "outlets", {"name": "روزنامه", "pay_type": "salary", "monthly_salary": 20000000, "pay_day": 5})
        db.create(conn, "transactions", {"tx_date": today, "kind": "expense", "amount": 300000, "category": "ایاب‌وذهاب",
                                         "description": "تاکسی"})
        db.create(conn, "transactions", {"tx_date": today, "kind": "income", "amount": 20000000, "category": "حقوق",
                                         "description": "حقوق", "outlet_id": o["id"]})
        d = services.dashboard(conn)
        assert d["month"]["income"] >= 20000000
        f = services.finance_summary(conn)
        assert len(f["series"]) == 12
        assert any(s["name"] == "روزنامه" and s["received"] == 20000000 for s in f["salaries"])
        cal = services.calendar(conn, today[:7])
        assert any(e["kind"] == "salary" for e in cal["events"])
        assert 0 <= cal["first_weekday"] <= 6
        assert "☀️" in services.daily_brief_text(conn)
        csv = services.export_month_csv(conn, today[:7])
        assert "تاکسی" in csv


def test_notifications_dedup():
    with db.connect() as conn:
        a = notify.add(conn, "x", "عنوان", dedup="k1")
        b = notify.add(conn, "x", "عنوان", dedup="k1")
        assert a and b is None
    data = notify.list_notifications()
    assert data["unread"] >= 1
    notify.mark_read()
    assert notify.list_notifications()["unread"] == 0


# ───────────── رصد خبر ─────────────

RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>t</title>
<item><title>افزایش قیمت بلیت مترو در شهرداری تهران</title><link>https://ex.ir/1</link>
<description><![CDATA[<p>متن <b>خبر</b> اول</p>]]></description><pubDate>Sun, 28 Sep 2026 08:30:00 +0330</pubDate><guid>1</guid></item>
<item><title>خبر ورزشی</title><link>https://ex.ir/2</link><pubDate>Sun, 28 Sep 2026 07:00:00 GMT</pubDate></item>
</channel></rss>""".encode()

ATOM = """<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>عنوان اتم</title><link href="https://ex.ir/a"/><id>a1</id><updated>2026-09-28T10:00:00Z</updated>
<summary>خلاصه</summary></entry></feed>""".encode()


def test_parse_feeds():
    items = feeds.parse_feed(RSS)
    assert len(items) == 2
    assert items[0]["summary"] == "متن خبر اول"
    assert items[0]["published"] == "1405/07/06 08:30"
    a = feeds.parse_feed(ATOM)
    assert a[0]["link"] == "https://ex.ir/a" and a[0]["published"] == "1405/07/06 13:30"


def test_fetch_feed_matches_keywords(monkeypatch):
    import httpx

    def handler(request):
        return httpx.Response(200, content=RSS)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    with db.connect() as conn:
        db.create(conn, "keywords", {"word": "شهرداری تهران", "notify": "yes"})
        f = db.create(conn, "feeds", {"name": "آزمون", "url": "https://ex.ir/rss"})
    assert feeds.fetch_feed(f, client) == 2
    assert feeds.fetch_feed(f, client) == 0  # تکراری
    res = feeds.list_items(only_matched=True)
    assert len(res["items"]) == 1 and res["items"][0]["matched"] == "شهرداری تهران"
    assert feeds.list_items(q="مترو")["items"]
    story = feeds.to_story(res["items"][0]["id"])
    assert story["source_url"] == "https://ex.ir/1"
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM notifications WHERE kind='feed'").fetchone()[0] == 1


def test_ocr_noise_filter():
    assert textnorm.is_noise_line("6۲۳۱۵۳۲۵۷. وطگ6است")
    assert textnorm.is_noise_line("67 اب4۶ مه ۰ ۷ 2 2 19:34")
    assert not textnorm.is_noise_line("کلنگ‌زنی ایستگاه شماره ۱۴")
    assert not textnorm.is_noise_line("کرمان راوی")
    assert textnorm.drop_noise("۳0515 بح\nمتن درست خبر\n۱ 123") == "متن درست خبر"


def test_legal_docs_reminders_and_renew():
    with db.connect() as conn:
        d = db.create(conn, "legal_docs", {"title": "پروانه‌ی انتشار", "expiry_date": "1405/07/20", "remind_days": 15,
                                           "remind_every": "weekly", "renew_months": 12, "owner_name": "مریم",
                                           "owner_phone": "09120000000"})
        assert scheduler.check_legal_docs(conn, "1405/07/01") == 0      # هنوز زود است
        assert scheduler.check_legal_docs(conn, "1405/07/06") == 1      # ۱۴ روز مانده
        assert scheduler.check_legal_docs(conn, "1405/07/07") == 0      # همان هفته، تکراری نه
        assert scheduler.check_legal_docs(conn, "1405/07/20") == 1      # روز سررسید
        assert scheduler.check_legal_docs(conn, "1405/07/21") == 1      # منقضی
        assert db.get(conn, "legal_docs", d["id"])["status"] == "expired"
        body = conn.execute("SELECT body FROM notifications WHERE kind='legal' ORDER BY id DESC").fetchone()[0]
        assert "مریم" in body and "09120000000" in body


def test_invoice_flow():
    from zozo import invoices

    invoices.save_profile({"media_name": "عصر رسانه", "payee": "مهدیه", "sheba": "IR123"})
    inv = invoices.create({"customer": "دهیاری علی‌آباد", "items": [
        {"title": "آگهی نوبت اول", "date": "۱۴۰۵/۰۶/۱۱", "qty": 2, "qty_label": "۲ کادر داخلی", "unit_price": "15,000,000"},
        {"title": "آگهی نوبت دوم", "qty": 2, "unit_price": 15000000}], "discount": "10,000,000"})
    assert inv["subtotal"] == 60000000 and inv["payable"] == 50000000
    assert inv["profile"]["payee"] == "مهدیه" and inv["number"].endswith("-0001")
    assert invoices.create({})["number"].endswith("-0002")
    invoices.update(inv["id"], {"status": "paid"})
    with db.connect() as conn:
        tx = db.list_records(conn, "transactions", filters={"category": "صورتحساب"})
    assert tx and tx[0]["amount"] == 50000000


def test_invoice_payments_and_dashboard():
    from zozo import invoices, services

    inv = invoices.create({"customer": "شهرداری", "items": [{"title": "آگهی", "qty": 1, "unit_price": 30000000}]})
    invoices.update(inv["id"], {"status": "issued"})
    with db.connect() as conn:
        rec = services.receivables(conn)
    assert any(i["id"] == inv["id"] and i["due"] == 30000000 for i in rec["invoices"])
    v = invoices.add_payment(inv["id"], {"amount": "10,000,000", "ref_no": "۱۲۳۴۵", "method": "card"})
    assert v["status"] == "partial" and v["remaining"] == 20000000
    v = invoices.add_payment(inv["id"], {"ref_no": "778899"})  # بدون مبلغ = باقی‌مانده
    assert v["status"] == "paid" and v["paid_total"] == 30000000 and v["paid_date"]
    with db.connect() as conn:
        txs = [dict(r) for r in conn.execute("SELECT * FROM transactions WHERE invoice_id=?", (inv["id"],))]
        assert sorted(t["amount"] for t in txs) == [10000000, 20000000]
        assert {t["ref_no"] for t in txs} == {"12345", "778899"}
        # پاک کردن دریافتی از «دریافت و پرداخت» پرداخت فاکتور را هم برمی‌دارد
        db.delete(conn, "transactions", txs[0]["id"])
    v = invoices.get(inv["id"])
    assert v["status"] == "partial" and len(v["payments"]) == 1
    v = invoices.delete_payment(inv["id"], v["payments"][0]["id"])
    assert v["status"] == "issued" and v["paid_total"] == 0
    invoices.add_payment(inv["id"], {"ref_no": "1"})
    with db.connect() as conn:
        d = services.finance_dashboard(conn, "month")
        assert d["kpi"]["collected"] >= 30000000 and d["kpi"]["income"] >= 30000000
        assert d["recent_payments"][0]["number"] == v["number"]
        assert len(d["trend"]) == 6 and len(d["aging"]) == 4
        assert services.finance_dashboard(conn, "year")["months"] >= 1


def test_invoice_templates():
    from zozo import invoices

    first = invoices.list_templates()
    assert len(first["items"]) >= 1
    with db.connect() as conn:
        outlet = db.create(conn, "outlets", {"name": "روزنامه کرمان"})
    t2 = invoices.save_template({"name": "روزنامه کرمان", "media_name": "کرمان", "payee": "فرسنگی", "outlet_id": outlet["id"]})
    assert t2["id"] != first["default"] and t2["media_name"] == "کرمان"
    a = invoices.create({"template_id": t2["id"], "customer": "الف"})
    b = invoices.create({"template_id": t2["id"], "customer": "ب"})
    assert a["number"].endswith("-0001") and b["number"].endswith("-0002")  # شماره‌گذاری جدا
    assert a["profile"]["media_name"] == "کرمان" and a["outlet_id"] == outlet["id"] and a["template_id"] == t2["id"]
    c = invoices.create({"customer": "پ"})  # قالب پیش‌فرض
    assert c["profile"]["media_name"] != "کرمان"
    moved = invoices.update(c["id"], {"template_id": t2["id"]})
    assert moved["profile"]["media_name"] == "کرمان"
    invoices.set_default_template(t2["id"])
    assert invoices.get_profile()["media_name"] == "کرمان"
    invoices.set_default_template(first["default"])
    invoices.delete_template(t2["id"])
    assert all(t["id"] != t2["id"] for t in invoices.list_templates()["items"])


def test_caption_grouping_and_alignment():
    from zozo import transcribe

    words = [{"word": w, "start": i * 0.4, "end": i * 0.4 + 0.3} for i, w in enumerate("الف ب پ ت ث ج چ ح خ د".split())]
    words[5] = {**words[5], "start": 3.5, "end": 3.8}  # مکث پیش از واژه‌ی ششم
    for w in words[6:]:
        w["start"] += 1.5
        w["end"] += 1.5
    caps = transcribe.group_words(words)
    assert caps[0]["text"] == "الف ب پ ت ث" and caps[1]["start"] == 3.5
    assert all(a["end"] < b["start"] for a, b in zip(caps, caps[1:]))
    al = transcribe.align_lines(["سطر اول نوشته", "سطر دوم که بلندتر است"], words)
    assert al[0]["start"] == 0 and al[1]["end"] > al[1]["start"] > al[0]["start"]


def test_clip_framing_filter():
    from zozo import teaser

    plain = teaser._place_filter("blur", 720, 1280, "#000000")
    framed = teaser._place_filter("blur", 720, 1280, "#000000", 1.5, 0.2, -0.1)
    assert plain != framed and "(0.2000)*W" in framed and "1.5000" in framed
    crop = teaser._place_filter("crop", 720, 1280, "#000000", 0.5, 0, 0)  # برش هیچ‌وقت کوچک‌تر از قاب نمی‌شود
    assert "1.0000" in crop


def test_reminder_every_n_days():
    from zozo import services

    assert services.next_occurrence("1405/07/01", "every2") == "1405/07/03"
    assert services.next_occurrence("1405/07/01", "every_n", 5) == "1405/07/06"
    occ = services._occurrences("1405/07/01", "every3", "1405/07/10", "1405/07/20")
    assert occ == ["1405/07/10", "1405/07/13", "1405/07/16", "1405/07/19"]


def test_invoice_search_customers_export():
    from zozo import invoices

    a = invoices.create({"customer": "شرکت انار", "customer_phone": "0912", "items": [{"title": "آگهی مزایده", "qty": 2, "unit_price": 1000}]})
    invoices.update(a["id"], {"status": "issued"})
    invoices.create({"customer": "شرکت انار", "items": [{"title": "آگهی دوم", "qty": 1, "unit_price": 500}]})
    assert len(invoices.list_all("انار")) >= 2 and invoices.list_all("مزایده")[0]["id"] == a["id"]
    c = next(x for x in invoices.customers() if x["name"] == "شرکت انار")
    assert c["count"] >= 2 and c["phone"] == "0912" and c["billed"] >= 2000
    assert "شرکت انار" in invoices.export_csv(invoices.list_all("انار")) and "انار" in invoices.customers_csv()


def test_lead_fallback_length():
    from zozo import ai

    text = " ".join(f"جمله‌ی شماره {i} درباره‌ی خبر مهم امروز است." for i in range(60))
    lead = ai._fallback("lead", text, 100)[0]
    assert 70 <= len(lead.split()) <= 140
