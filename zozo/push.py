"""اعلان روی خود گوشی (Web Push) حتی وقتی برنامه بسته است.

مرورگر گوشی (کروم اندروید، یا برنامه‌ی نصب‌شده روی صفحه‌ی اصلی آیفون) یک «اشتراک» می‌سازد؛
سرور پیام را رمزنگاری‌شده (RFC 8291، aes128gcm) و امضاشده با کلید VAPID (RFC 8292) برای سرویس
اعلان همان مرورگر می‌فرستد. کلیدها یک بار ساخته و در پایگاه داده نگه داشته می‌شوند؛ تنظیمی لازم نیست.
"""
from __future__ import annotations

import base64
import datetime as dt
import json
import logging
import os
import time
from typing import Any
from urllib.parse import urlsplit

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from . import db, jalali
from .config import settings

log = logging.getLogger(__name__)
MAX_SUBS = 20


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _point(pub: ec.EllipticCurvePublicKey) -> bytes:
    return pub.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


# ───────────────────────── کلید VAPID ─────────────────────────

def _vapid() -> ec.EllipticCurvePrivateKey:
    with db.connect() as conn:
        pem = db.kv_get(conn, "vapid_key")
        if not pem:
            key = ec.generate_private_key(ec.SECP256R1())
            pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                    serialization.NoEncryption()).decode()
            db.kv_set(conn, "vapid_key", pem)
    return serialization.load_pem_private_key(pem.encode(), None)


def public_key() -> str:
    return b64u(_point(_vapid().public_key()))


def _vapid_header(endpoint: str, sub: str) -> str:
    key = _vapid()
    u = urlsplit(endpoint)
    head = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    body = b64u(json.dumps({"aud": f"{u.scheme}://{u.netloc}", "exp": int(time.time()) + 12 * 3600, "sub": sub},
                           separators=(",", ":")).encode())
    r, s = decode_dss_signature(key.sign(f"{head}.{body}".encode(), ec.ECDSA(hashes.SHA256())))
    sig = b64u(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
    return f"vapid t={head}.{body}.{sig}, k={b64u(_point(key.public_key()))}"


# ───────────────────────── رمزنگاری پیام (RFC 8291) ─────────────────────────

def encrypt(payload: bytes, p256dh: str, auth: str, salt: bytes | None = None,
            server_key: ec.EllipticCurvePrivateKey | None = None) -> bytes:
    ua_pub_bytes, auth_secret = unb64u(p256dh), unb64u(auth)
    ua_pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_pub_bytes)
    as_key = server_key or ec.generate_private_key(ec.SECP256R1())
    as_pub = _point(as_key.public_key())
    salt = salt or os.urandom(16)
    shared = as_key.exchange(ec.ECDH(), ua_pub)
    ikm = HKDF(hashes.SHA256(), 32, auth_secret, b"WebPush: info\x00" + ua_pub_bytes + as_pub).derive(shared)
    cek = HKDF(hashes.SHA256(), 16, salt, b"Content-Encoding: aes128gcm\x00").derive(ikm)
    nonce = HKDF(hashes.SHA256(), 12, salt, b"Content-Encoding: nonce\x00").derive(ikm)
    cipher = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    return salt + (4096).to_bytes(4, "big") + bytes([len(as_pub)]) + as_pub + cipher


# ───────────────────────── اشتراک‌ها ─────────────────────────

def _subs(conn) -> list[dict[str, Any]]:
    return json.loads(db.kv_get(conn, "push_subs") or "[]")


def count() -> int:
    with db.connect() as conn:
        return len(_subs(conn))


def subscribe(sub: dict[str, Any], origin: str, device: str = "") -> int:
    ep, keys = str(sub.get("endpoint") or ""), sub.get("keys") or {}
    if not ep.startswith("https://") or not keys.get("p256dh") or not keys.get("auth"):
        raise db.ValidationError("اشتراک اعلان معتبر نیست")
    with db.connect() as conn:
        items = [s for s in _subs(conn) if s["endpoint"] != ep]
        items.append({"endpoint": ep, "keys": {"p256dh": keys["p256dh"], "auth": keys["auth"]},
                      "origin": origin, "device": device[:120], "at": db.now_str()})
        db.kv_set(conn, "push_subs", json.dumps(items[-MAX_SUBS:]))
        # از همین حالا به بعد؛ اعلان‌های قدیمی دوباره فرستاده نمی‌شوند
        if db.kv_get(conn, "push_last") is None:
            last = conn.execute("SELECT COALESCE(MAX(id), 0) FROM notifications").fetchone()[0]
            db.kv_set(conn, "push_last", str(last))
        return len(items)


def unsubscribe(endpoint: str) -> None:
    with db.connect() as conn:
        db.kv_set(conn, "push_subs", json.dumps([s for s in _subs(conn) if s["endpoint"] != endpoint]))


def send(sub: dict[str, Any], data: dict[str, Any]) -> int:
    """فرستادن یک اعلان به یک گوشی. خروجی: کد پاسخ سرویس اعلان."""
    body = encrypt(json.dumps(data, ensure_ascii=False).encode(), sub["keys"]["p256dh"], sub["keys"]["auth"])
    origin = sub.get("origin") or ""
    contact = origin if origin.startswith("https://") else "mailto:zozo@example.com"
    r = httpx.post(sub["endpoint"], content=body, timeout=20, headers={
        "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
        "TTL": str(24 * 3600), "Urgency": "high", "Authorization": _vapid_header(sub["endpoint"], contact)})
    return r.status_code


def send_all(data: dict[str, Any], only: str | None = None) -> dict[str, int]:
    with db.connect() as conn:
        subs = _subs(conn)
    res = {"ok": 0, "failed": 0, "removed": 0}
    for sub in subs:
        if only and sub["endpoint"] != only:
            continue
        try:
            code = send(sub, data)
        except Exception as e:
            log.warning("ارسال اعلان به گوشی ناموفق بود: %s", e)
            res["failed"] += 1
            continue
        if code in (404, 410):  # اشتراک باطل شده (برنامه پاک شده یا اجازه برداشته شده)
            unsubscribe(sub["endpoint"])
            res["removed"] += 1
        elif code >= 400:
            log.warning("سرویس اعلان کد %s برگرداند", code)
            res["failed"] += 1
        else:
            res["ok"] += 1
    return res


def push_pending() -> int:
    """اعلان‌های تازه‌ی برنامه (یادآوری، مهلت، …) را به همه‌ی گوشی‌های مشترک می‌فرستد."""
    with db.connect() as conn:
        subs = _subs(conn)
        last = int(db.kv_get(conn, "push_last") or 0)
        rows = conn.execute("SELECT id, kind, title, body, link, created_at FROM notifications WHERE id > ? "
                            "ORDER BY id LIMIT 20", (last,)).fetchall()
        if rows:
            db.kv_set(conn, "push_last", str(rows[-1]["id"]))
    if not subs or not rows:
        return 0
    day_ago = jalali.to_jalali(settings.now() - dt.timedelta(days=1), with_time=True)
    n = 0
    for r in rows:
        if r["created_at"] < day_ago:
            continue
        send_all({"id": r["id"], "title": r["title"], "body": (r["body"] or "")[:400], "link": r["link"] or "#home"})
        n += 1
    return n
