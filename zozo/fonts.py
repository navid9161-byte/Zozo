"""فونت‌های دلخواه که کاربر بارگذاری می‌کند (مثل بی‌تیتر و بی‌نازنین).

فایل‌ها روی سرور خود کاربر (پوشه‌ی داده) نگه داشته می‌شوند و داخل کد برنامه نیستند.
"""
from __future__ import annotations

import io
import json
import re
import zipfile
from pathlib import Path
from typing import Any, BinaryIO

from . import db, documents
from .config import settings

EXT = {".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2"}
MAX_MB = 15


def font_dir() -> Path:
    d = settings.data_dir / "fonts"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _load(conn) -> list[dict[str, Any]]:
    raw = db.kv_get(conn, "custom_fonts")
    return json.loads(raw) if raw else []


def list_fonts() -> list[dict[str, Any]]:
    with db.connect() as conn:
        return _load(conn)


def _family_from_name(filename: str) -> str:
    stem = Path(filename).stem
    stem = re.sub(r"[_\-]+", " ", stem)
    stem = re.sub(r"\b(bold|regular|normal|\d+)\b", "", stem, flags=re.I)
    return re.sub(r"\s+", " ", stem).strip() or "فونت"


def add_font(fileobj: BinaryIO, filename: str, family: str | None = None) -> dict[str, Any]:
    ext = Path(filename).suffix.lower()
    if ext not in EXT:
        raise db.ValidationError("فقط فایل فونت (ttf، otf، woff، woff2) پذیرفته می‌شود")
    tmp, size, sha = documents.save_upload(fileobj, font_dir(), MAX_MB * 1024 * 1024)
    head = Path(tmp).read_bytes()[:4]
    if head not in (b"\x00\x01\x00\x00", b"OTTO", b"true", b"wOFF", b"wOF2"):
        Path(tmp).unlink(missing_ok=True)
        raise db.ValidationError("این فایل فونت معتبر نیست")
    family = (family or "").strip() or _family_from_name(filename)
    with db.connect() as conn:
        items = _load(conn)
        # همان فونت دوباره بارگذاری شد: فونت قبلی برگردانده می‌شود، نه یک نسخه‌ی تکراری
        same = next((f for f in items if f.get("sha") == sha), None)
        if same:
            Path(tmp).unlink(missing_ok=True)
            return same
        fid = max([f["id"] for f in items] or [0]) + 1
        final = font_dir() / f"{fid}{ext}"
        Path(tmp).replace(final)
        # نام خانواده‌ی یکتا برای مرورگر (نام نمایشی همان چیزی است که کاربر می‌بیند)
        item = {"id": fid, "name": family, "family": f"zf{fid}", "file": final.name, "size": size, "sha": sha}
        items.append(item)
        db.kv_set(conn, "custom_fonts", json.dumps(items, ensure_ascii=False))
    return item


def font_path(fid: int) -> tuple[Path, str]:
    for f in list_fonts():
        if f["id"] == fid:
            p = font_dir() / f["file"]
            if p.is_file():
                return p, EXT.get(p.suffix.lower(), "application/octet-stream")
    raise db.NotFound("فونت پیدا نشد")


def rename_font(fid: int, name: str) -> dict[str, Any]:
    with db.connect() as conn:
        items = _load(conn)
        for f in items:
            if f["id"] == fid:
                f["name"] = name.strip() or f["name"]
                db.kv_set(conn, "custom_fonts", json.dumps(items, ensure_ascii=False))
                return f
    raise db.NotFound("فونت پیدا نشد")


def delete_font(fid: int) -> None:
    with db.connect() as conn:
        items = _load(conn)
        keep = [f for f in items if f["id"] != fid]
        for f in items:
            if f["id"] == fid:
                (font_dir() / f["file"]).unlink(missing_ok=True)
        db.kv_set(conn, "custom_fonts", json.dumps(keep, ensure_ascii=False))


MAX_ZIP_FONTS = 12


def add_upload(fileobj: BinaryIO, filename: str, name: str | None = None) -> dict[str, Any]:
    """یک فایل فونت یا یک فایل زیپ که فونت‌ها داخلش هستند (همان‌طور که از سایت‌ها دانلود می‌شود)."""
    if Path(filename).suffix.lower() != ".zip":
        item = add_font(fileobj, filename, name)
        return {**item, "added": [item]}
    tmp, _, _ = documents.save_upload(fileobj, font_dir(), 60 * 1024 * 1024)
    try:
        try:
            zf = zipfile.ZipFile(tmp)
        except zipfile.BadZipFile:
            raise db.ValidationError("فایل زیپ خراب است یا باز نمی‌شود")
        with zf:
            members = [m for m in zf.infolist()
                       if not m.is_dir() and Path(m.filename).suffix.lower() in EXT
                       and "__MACOSX" not in m.filename and not Path(m.filename).name.startswith("._")]
            if not members:
                raise db.ValidationError("داخل این زیپ فایل فونتی (ttf، otf، woff، woff2) پیدا نشد")
            added = []
            for m in members[:MAX_ZIP_FONTS]:
                if m.file_size > MAX_MB * 1024 * 1024:
                    continue
                # نام دلخواه فقط وقتی زیپ یک فونت دارد؛ وگرنه از نام هر فایل
                fam = name if len(members) == 1 else None
                try:
                    added.append(add_font(io.BytesIO(zf.read(m)), Path(m.filename).name, fam))
                except db.ValidationError:
                    continue
    finally:
        Path(tmp).unlink(missing_ok=True)
    if not added:
        raise db.ValidationError("فونت‌های داخل این زیپ معتبر نبودند")
    return {**added[0], "added": added}
