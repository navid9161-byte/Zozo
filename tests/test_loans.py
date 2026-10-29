"""وام و اقساط: یادآوری هر قسط، «پرداخت شد» ← هزینه در مالی، دکمه‌های ربات بله، برگرداندن."""
import json

from fastapi.testclient import TestClient

from zozo import db, jalali, loans, notify, scheduler
from zozo.main import app


def test_loan_flow_and_bale_buttons():
    with TestClient(app) as c:
        c.post("/api/login", json={"password": "secret-pass"})
        today = db.today_str()
        first = jalali.add_days(today, -2)          # قسط اول دو روز پیش بوده
        assert c.post("/api/loans", json={"title": "وام", "installment": 0, "count": 3, "first_due": first}).status_code == 400
        r = c.post("/api/loans", json={"title": "وام گوشی", "lender": "بانک ملت", "principal": "۱۲۰٬۰۰۰٬۰۰۰",
                                       "installment": "7,400,000", "count": 3, "first_due": first, "scope": "personal"})
        assert r.status_code == 201, r.text
        ln = r.json()
        assert ln["next_n"] == 1 and ln["next_due"] == first and ln["overdue"] and ln["remaining"] == 22200000
        rem = c.get(f"/api/reminders/{ln['reminder_id']}").json()
        assert rem["remind_at"] == f"{first} 09:00" and rem["action"] == f"loan:{ln['id']}:1" and "پرداخت شد" in rem["title"]
        # زمان یادآوری رسیده ← اعلان با دکمه‌های «بله / فردا»
        with db.connect() as conn:
            scheduler.check_reminders(conn, db.now_str())
            n = conn.execute("SELECT * FROM notifications WHERE title LIKE '%وام گوشی%' ORDER BY id DESC").fetchone()
        acts = json.loads(n["actions"])
        assert acts[0][1] == f"loanpay:{ln['id']}:1" and n["link"] == f"#finance?tab=loans&pay={ln['id']}"
        # دکمه‌ی «بله» در ربات بله ← هزینه در مالی
        msg = loans.handle_action(acts[0][1])
        assert "به‌عنوان هزینه ثبت شد" in msg
        assert "قبلاً ثبت شده" in loans.handle_action(acts[0][1])      # زدن دوباره، دوباره ثبت نمی‌کند
        ln = c.get("/api/loans").json()["items"][0]
        assert ln["paid"] == 1 and ln["next_due"] == jalali.add_months(first, 1)
        tx = c.get("/api/transactions", params={"q": "وام گوشی"}).json()
        items = tx["items"] if isinstance(tx, dict) else tx
        t = next(x for x in items if "قسط 1 از 3" in x["description"])
        assert (t["kind"], t["amount"], t["category"], t["scope"]) == ("expense", 7400000, "اقساط و وام", "personal")
        assert c.get(f"/api/reminders/{rem['id']}").json()["status"] == "done"
        # «فردا یادم بینداز»
        assert "فردا" in loans.handle_action(f"loanlater:{ln['id']}:2")
        assert c.get(f"/api/reminders/{ln['reminder_id']}").json()["remind_at"].startswith(jalali.add_days(today, 1))
        # پرداخت از خود برنامه با مبلغ و تاریخ دلخواه، سپس برگرداندن
        p2 = c.post(f"/api/loans/{ln['id']}/pay", json={"amount": "7500000", "date": today}).json()
        assert p2["paid"] == 2 and p2["payments"][-1]["amount"] == 7500000
        u = c.post(f"/api/loans/{ln['id']}/undo").json()
        assert u["paid"] == 1 and c.get(f"/api/transactions/{p2['payments'][-1]['tx_id']}").status_code == 404
        c.post(f"/api/loans/{ln['id']}/pay", json={})
        last = c.post(f"/api/loans/{ln['id']}/pay", json={}).json()
        assert last["status"] == "done" and last["next_due"] is None and not last["reminder_id"]
        assert c.post(f"/api/loans/{ln['id']}/pay", json={}).status_code == 400
        s = c.get("/api/loans").json()["summary"]
        assert s["active"] == 0 and s["remaining"] == 0


def test_bale_callback(monkeypatch):
    calls = []
    bot = notify.BaleBot("t", "https://x")
    monkeypatch.setattr(bot, "call", lambda m, **p: calls.append((m, p)) or {})
    monkeypatch.setattr(notify, "allowed_chats", lambda: {"42"})
    monkeypatch.setattr(loans, "handle_action", lambda a: f"ok {a}")
    bot.handle_callback({"id": "q1", "data": "loanpay:1:2", "message": {"message_id": 7, "chat": {"id": 42}}})
    names = [m for m, _ in calls]
    assert names[0] == "answerCallbackQuery" and "editMessageReplyMarkup" in names and names[-1] == "sendMessage"
    assert calls[-1][1]["text"] == "ok loanpay:1:2"
    calls.clear()
    bot.send("42", "سلام", [["✅ بله", "loanpay:1:2"]])
    assert calls[0][1]["reply_markup"]["inline_keyboard"][0][0]["callback_data"] == "loanpay:1:2"
