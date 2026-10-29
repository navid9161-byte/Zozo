"""فاکتور روزنامه‌ها: مشتری چندروزنامه‌ای، جمع‌ها و تفکیک، پیگیری با یادآوری، و ثبت در مالی هنگام وصول."""
from fastapi.testclient import TestClient

from zozo import db, jalali
from zozo.main import app


def test_paper_invoices_flow():
    with TestClient(app) as c:
        c.post("/api/login", json={"password": "secret-pass"})
        p1 = c.post("/api/papers", json={"name": "کرمان امروز"}).json()["id"]
        p2 = c.post("/api/papers", json={"name": "اطلاعات"}).json()["id"]
        assert c.post("/api/papers", json={"name": "اطلاعات"}).status_code == 400
        office = c.post("/api/paper-clients", json={"name": "شهرداری کرمان", "kind": "office", "all_papers": True}).json()
        assert sorted(office["paper_ids"]) == sorted([p1, p2])
        person = c.post("/api/paper-clients", json={"name": "آقای رضایی", "paper_ids": [p2], "address": "کرمان، خیابان شریعتی",
                                                    "phones": ["۰۹۱۲۱۱۱۲۲۳۳", "", {"label": "روابط عمومی", "number": "0343-2223344"}, "09121112233"]}).json()
        assert person["phones"] == [{"label": "", "number": "09121112233"}, {"label": "روابط عمومی", "number": "0343-2223344"}]
        assert person["address"] == "کرمان، خیابان شریعتی"
        upd = c.put(f"/api/paper-clients/{person['id']}", json={"name": "آقای رضایی", "paper_ids": [p2], "address": "کرمان",
                                                               "phones": [{"label": "روابط عمومی", "number": "09130000000"}]}).json()
        assert upd["phones"] == [{"label": "روابط عمومی", "number": "09130000000"}] and upd["address"] == "کرمان"
        assert c.post("/api/paper-clients", json={"name": "بی‌روزنامه"}).status_code == 400
        # مشتری برای روزنامه‌ای که به او وصل نیست → خطا
        assert c.post("/api/paper-invoices", json={"client_id": person["id"], "paper_id": p1, "total": 100,
                                                   "follow_date": db.today_str()}).status_code == 400
        f1 = jalali.add_days(db.today_str(), 3)
        r = c.post("/api/paper-invoices", json={"client_id": office["id"], "paper_id": p1, "title": "آگهی مناقصه",
                                                "total": "۱۲٬۰۰۰٬۰۰۰", "profit": 3000000, "paper_cost": 9000000,
                                                "status": "follow", "follow_date": f1})
        assert r.status_code == 201, r.text
        a = r.json()
        assert a["number"].endswith("-001") and a["total"] == 12000000 and a["reminder_id"]
        rem = c.get(f"/api/reminders/{a['reminder_id']}").json()
        assert rem["remind_at"] == f"{f1} 09:00" and "پیگیری فاکتور" in rem["title"] and rem["status"] == "active"
        # پیگیری مجدد با تاریخ تازه: یادآوری قبلی بسته و یادآوری تازه
        f2 = jalali.add_days(f1, 7)
        b = c.put(f"/api/paper-invoices/{a['id']}", json={"status": "refollow", "follow_date": f2}).json()
        assert b["reminder_id"] != a["reminder_id"] and b["renewals"] == 1
        assert c.get(f"/api/reminders/{a['reminder_id']}").json()["status"] == "done"
        assert c.get(f"/api/reminders/{b['reminder_id']}").json()["remind_at"].startswith(f2)
        # ویرایش مبلغ بدون تغییر تاریخ: یادآوری تازه ساخته نمی‌شود
        b2 = c.put(f"/api/paper-invoices/{a['id']}", json={"profit": 3100000}).json()
        assert b2["reminder_id"] == b["reminder_id"]
        # فاکتور دوم
        c.post("/api/paper-invoices", json={"client_id": person["id"], "paper_id": p2, "total": 5000000, "profit": 1000000,
                                            "paper_cost": 4000000, "status": "reprint", "follow_date": f1})
        # پیوست‌ها
        up = c.post(f"/api/paper-invoices/{a['id']}/files", files=[("files", ("رسید.pdf", b"%PDF-1.4 test", "application/pdf")),
                                                                     ("files", ("x.exe", b"MZ", "application/octet-stream"))]).json()
        assert len(up["added"]) == 1 and up["errors"]
        fid = up["added"][0]["id"]
        assert c.get(f"/api/paper-invoice-files/{fid}").content == b"%PDF-1.4 test"
        assert c.get(f"/api/paper-invoices/{a['id']}").json()["files"][0]["filename"] == "رسید.pdf"
        assert next(x for x in c.get("/api/paper-invoices").json()["items"] if x["id"] == a["id"])["file_count"] == 1
        # اعلام وصول ← درآمد و هزینه در مالی؛ یادآوری بسته
        col = c.put(f"/api/paper-invoices/{a['id']}", json={"status": "collected"}).json()
        assert col["collected_date"] == db.today_str() and col["tx_income_id"] and col["tx_expense_id"]
        assert c.get(f"/api/reminders/{b['reminder_id']}").json()["status"] == "done"
        inc = c.get(f"/api/transactions/{col['tx_income_id']}").json()
        exp = c.get(f"/api/transactions/{col['tx_expense_id']}").json()
        assert (inc["kind"], inc["amount"], inc["scope"]) == ("income", 12000000, "work")
        assert (exp["kind"], exp["amount"]) == ("expense", 9000000) and "شهرداری کرمان" in exp["description"]
        # جمع‌ها و تفکیک
        lst = c.get("/api/paper-invoices").json()
        assert lst["totals"]["total"] == 17000000 and lst["totals"]["profit"] == 4100000 and lst["totals"]["paper_cost"] == 13000000
        assert lst["totals"]["collected"] == 12000000 and lst["totals"]["open"] == 5000000
        assert {x["name"]: x["total"] for x in lst["by_paper"]} == {"کرمان امروز": 12000000, "اطلاعات": 5000000}
        only = c.get("/api/paper-invoices", params={"client_id": person["id"]}).json()
        assert only["totals"]["count"] == 1 and only["totals"]["total"] == 5000000
        assert c.get("/api/paper-invoices", params={"status": "open"}).json()["totals"]["count"] == 1
        # برگشت از «وصول» ← تراکنش‌ها حذف می‌شوند
        back = c.put(f"/api/paper-invoices/{a['id']}", json={"status": "refollow", "follow_date": f2}).json()
        assert not back["tx_income_id"] and c.get(f"/api/transactions/{col['tx_income_id']}").status_code == 404
        # حذف روزنامه‌ی دارای فاکتور ممنوع؛ حذف فاکتور یادآوری را می‌بندد
        assert c.delete(f"/api/papers/{p1}").status_code == 400
        assert c.delete(f"/api/paper-invoices/{a['id']}").status_code == 200
        assert c.get(f"/api/paper-invoice-files/{fid}").status_code == 404
        assert c.get(f"/api/reminders/{back['reminder_id']}").json()["status"] == "done"
