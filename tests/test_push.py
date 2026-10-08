"""اعلان گوشی: رمزنگاری باید دقیقاً با نمونه‌ی استاندارد RFC 8291 (بخش ۵) یکی باشد."""
from cryptography.hazmat.primitives.asymmetric import ec

from zozo import push

RFC_BODY = ("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml"
            "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT"
            "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")


def test_encrypt_matches_rfc8291_example():
    as_priv = ec.derive_private_key(int.from_bytes(push.unb64u("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), "big"),
                                    ec.SECP256R1())
    body = push.encrypt(b"When I grow up, I want to be a watermelon",
                        "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
                        "BTBZMqHH6r4Tts7J_aSIgg", salt=push.unb64u("DGv6ra1nlYgDCS1FRnbzlw"), server_key=as_priv)
    assert push.b64u(body) == RFC_BODY


def test_vapid_header_is_valid_es256():
    import json

    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
    h = push._vapid_header("https://fcm.googleapis.com/fcm/send/abc", "https://example.ir")
    t = h.split("t=")[1].split(",")[0]
    k = h.split("k=")[1]
    head, body, sig = t.split(".")
    claims = json.loads(push.unb64u(body))
    assert claims["aud"] == "https://fcm.googleapis.com" and claims["sub"] == "https://example.ir"
    assert k == push.public_key() and len(push.unb64u(k)) == 65
    raw = push.unb64u(sig)
    pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), push.unb64u(k))
    pub.verify(encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")),
               f"{head}.{body}".encode(), ec.ECDSA(hashes.SHA256()))


def _fake_sub(i=1):
    ua = ec.generate_private_key(ec.SECP256R1())
    return {"endpoint": f"https://push.example.net/sub{i}", "keys": {"p256dh": push.b64u(push._point(ua.public_key())),
                                                                       "auth": push.b64u(b"0123456789abcdef")}}


def test_push_pending_sends_new_notifications_and_drops_dead_subs(monkeypatch):
    from zozo import db, notify
    sent = []
    codes = {"https://push.example.net/sub1": 201, "https://push.example.net/sub2": 410}
    monkeypatch.setattr(push, "send", lambda sub, data: sent.append((sub["endpoint"], data["title"])) or codes[sub["endpoint"]])
    with db.connect() as conn:
        notify.add(conn, "reminder", "یادآوری قدیمی پیش از روشن کردن")
    push.subscribe(_fake_sub(1), "https://zozo.example.ir")
    push.subscribe(_fake_sub(2), "https://zozo.example.ir")
    push.push_pending()
    assert sent == []  # اعلان‌های پیش از روشن کردن فرستاده نمی‌شوند
    with db.connect() as conn:
        notify.add(conn, "reminder", "⏰ پیگیری مالی روزنامه")
    push.push_pending()
    assert ("https://push.example.net/sub1", "⏰ پیگیری مالی روزنامه") in sent
    assert push.count() == 1  # اشتراک باطل‌شده (۴۱۰) پاک شد
    sent.clear()
    push.push_pending()
    assert sent == []  # دوباره فرستاده نمی‌شود
    push.unsubscribe("https://push.example.net/sub1")


def test_bale_link_with_code_from_app(monkeypatch):
    from zozo import db, notify
    out = []
    bot = notify.BaleBot("1:x", "https://tapi.example")
    monkeypatch.setattr(bot, "send", lambda chat, text: out.append((chat, text)))
    code = notify.link_code(renew=True)
    stranger = {"chat": {"id": 555, "first_name": "مریم"}, "text": "سلام"}
    bot.handle(stranger)
    assert "555" not in notify.allowed_chats() and "کد ۶ رقمی" in out[-1][1]
    bot.handle({**stranger, "text": "000000"})
    assert "555" not in notify.allowed_chats()
    fa = code.translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))
    bot.handle({**stranger, "text": fa})  # با رقم فارسی هم پذیرفته شود
    assert "555" in notify.allowed_chats() and "وصل شد" in out[-1][1]
    assert [c["name"] for c in notify.linked_chats()] == ["مریم"]
    bot.handle({"chat": {"id": 777}, "text": code})  # کد یک بار مصرف است
    assert "777" not in notify.allowed_chats()
    bot.handle({**stranger, "text": "ایده: گزارش درباره‌ی آب"})
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM notes WHERE title LIKE 'ایده: گزارش%'").fetchone()[0] == 1
    notify.remove_chat("555")
    assert "555" not in notify.allowed_chats()


def test_bale_settings_api():
    from fastapi.testclient import TestClient

    from zozo.main import app
    with TestClient(app) as c:
        c.post("/api/login", json={"password": "secret-pass"})
        b = c.get("/api/bale").json()
        assert b["token_set"] is False and b["code"] is None
        assert c.post("/api/bale/token", json={"token": "bad-token"}).status_code == 400
        assert c.post("/api/bale/test").status_code == 400
        k = c.get("/api/push/key").json()
        assert len(push.unb64u(k["key"])) == 65
        assert c.post("/api/push/subscribe", json={"subscription": {"endpoint": "http://x"}}).status_code == 400
