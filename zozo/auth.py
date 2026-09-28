"""ورود با رمز عبور و نگه‌داشتن ورود با کوکی امضاشده (بدون نیاز به پایگاه داده).

- رمز از متغیر محیطی ZOZO_PASSWORD خوانده می‌شود.
- پس از ورود، یک کوکی ۶۰ روزه ساخته می‌شود؛ با عوض کردن رمز، همه‌ی ورودهای قبلی باطل می‌شوند.
- برای جلوگیری از حدس زدن رمز، پس از ۸ تلاش ناموفق از یک نشانی، ۱۰ دقیقه ورود بسته می‌شود.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time

from .config import settings

COOKIE = "zozo_session"
MAX_AGE = 60 * 24 * 3600
_MAX_FAILS = 8
_LOCK_SECONDS = 600

_fails: dict[str, list[float]] = {}
_lock = threading.Lock()


def enabled() -> bool:
    return bool(settings.password)


def _key() -> bytes:
    # کلید امضا به رمز وابسته است تا با تغییر رمز همه‌ی نشست‌ها باطل شوند
    base = f"{settings.secret}|{settings.password}".encode()
    return hashlib.sha256(b"zozo-session|" + base).digest()


def make_token() -> str:
    ts = str(int(time.time()))
    nonce = secrets.token_hex(8)
    sig = hmac.new(_key(), f"{ts}.{nonce}".encode(), hashlib.sha256).hexdigest()
    return f"{ts}.{nonce}.{sig}"


def check_token(token: str | None) -> bool:
    if not enabled():
        return True
    if not token:
        return False
    try:
        ts, nonce, sig = token.split(".")
        age = time.time() - int(ts)
    except ValueError:
        return False
    if age < 0 or age > MAX_AGE:
        return False
    good = hmac.new(_key(), f"{ts}.{nonce}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(good, sig)


def locked(ip: str) -> int:
    """اگر نشانی قفل است، چند ثانیه‌ی دیگر باز می‌شود؛ وگرنه ۰."""
    now = time.time()
    with _lock:
        recent = [t for t in _fails.get(ip, []) if now - t < _LOCK_SECONDS]
        _fails[ip] = recent
        if len(recent) >= _MAX_FAILS:
            return int(_LOCK_SECONDS - (now - recent[0])) + 1
    return 0


def check_password(ip: str, password: str) -> bool:
    ok = hmac.compare_digest(password.strip().encode(), settings.password.encode())
    with _lock:
        if ok:
            _fails.pop(ip, None)
        else:
            _fails.setdefault(ip, []).append(time.time())
    return ok
