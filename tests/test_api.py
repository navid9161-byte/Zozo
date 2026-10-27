import base64
import io
import shutil
import struct
import time
import zlib

import pytest
from fastapi.testclient import TestClient

from zozo import documents, teaser
from zozo.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def login(c):
    r = c.post("/api/login", json={"password": "secret-pass"})
    assert r.status_code == 200


def test_login_required(client):
    client.cookies.clear()
    assert client.get("/api/meta").status_code == 401
    assert client.get("/").status_code == 200  # صفحه‌ی اصلی (فرم ورود) باز است
    assert client.post("/api/login", json={"password": "wrong"}).status_code == 401
    login(client)
    m = client.get("/api/meta").json()
    assert m["password_set"] and "stories" in m["schema"]


def test_crud_and_search(client):
    login(client)
    r = client.post("/api/stories", json={"title": "سوژه‌ی آلودگی هوا", "body": "متن درباره‌ی آلودگی هوا در تهران"})
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    assert client.patch(f"/api/stories/{sid}", json={"status": "writing"}).json()["status"] == "writing"
    assert client.get("/api/stories?status=writing").json()[0]["id"] == sid
    res = client.get("/api/search", params={"q": "آلودگی"}).json()
    assert any(g["entity"] == "stories" for g in res["groups"])
    assert client.post("/api/stories", json={"title": ""}).status_code == 400
    assert client.get("/api/nothing").status_code == 404
    assert client.get("/api/dashboard").status_code == 200
    assert client.get("/api/finance").status_code == 200
    assert client.get("/api/calendar").status_code == 200
    assert client.get("/api/finance/csv").status_code == 200
    assert client.get("/api/backup.db").status_code == 200
    assert client.get("/api/export").status_code == 200


def test_tools(client):
    login(client)
    r = client.post("/api/tools/fix", json={"text": "مي روم"}).json()
    assert r["text"] == "می‌روم"
    r = client.post("/api/ai/captions", json={"text": "جمله‌ی اول خبر درباره‌ی موضوع مهم است. جمله‌ی دوم هم هست.", "n": 3}).json()
    assert r["mode"] == "fallback" and r["lines"]


def test_documents_text(client):
    login(client)
    content = "گزارش بودجه‌ی شهرداری\nدر این سند درباره‌ی بودجه‌ی عمرانی سال ۱۴۰۵ توضیح داده شده است.".encode()
    r = client.post("/api/documents", files={"files": ("budget.txt", content, "text/plain")},
                    data={"category": "report", "tags": "بودجه"})
    assert r.status_code == 201, r.text
    doc_id = r.json()["added"][0]["id"]
    documents.worker.run_pending()
    res = client.get("/api/documents/search", params={"q": "بودجه عمرانی"}).json()
    assert any(x["doc_id"] == doc_id for x in res["results"])
    # جستجو در برچسب‌ها و توضیح هم کار می‌کند
    client.patch(f"/api/documents/{doc_id}", json={"notes": "مصاحبه با معاون"})
    assert client.get("/api/documents/search", params={"q": "معاون"}).json()["results"]
    assert client.get(f"/api/documents/{doc_id}/file").status_code == 200
    # فایل صوتی بایگانی می‌شود (بدون استخراج متن)
    r = client.post("/api/documents", files={"files": ("voice.mp3", b"ID3fake", "audio/mpeg")}, data={"notes": "مصاحبه‌ی صوتی"})
    assert r.status_code == 201


def _png(w, h, rgba=(200, 30, 40, 255)):
    raw = b"".join(b"\x00" + bytes(rgba) * w for _ in range(h))

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg نصب نیست")
def test_teaser_render(client):
    login(client)
    img = _png(400, 300)
    r = client.post("/api/media", files={"files": ("photo.png", img, "image/png")})
    assert r.status_code == 201, r.text
    mid = r.json()["added"][0]["id"]
    overlay = "data:image/png;base64," + base64.b64encode(_png(720, 1280, (0, 0, 0, 0))).decode()
    card = "data:image/png;base64," + base64.b64encode(_png(720, 1280, (20, 20, 80, 255))).decode()
    spec = {
        "title": "آزمون", "format": "9:16", "quality": "720",
        "clips": [{"card": card, "duration": 1}, {"media_id": mid, "duration": 1.5, "zoom": True},
                  {"media_id": mid, "duration": 1.5, "zoom": False}],
        "overlays": [{"image": overlay, "start": 1, "end": 3}],
        "captions": [{"text": "زیرنویس", "start": 1.2, "end": 2.5}],
    }
    r = client.post("/api/teasers", json=spec)
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    teaser.renderer.run_pending()
    t = client.get(f"/api/teasers/{tid}").json()
    assert t["status"] == "done", t.get("error")
    info = teaser.probe(teaser.teaser_file(tid))
    assert (info["width"], info["height"]) == (720, 1280)
    assert abs(info["duration"] - 4.0) < 0.3
    assert "زیرنویس" in client.get(f"/api/teasers/{tid}/srt").text
    assert client.get(f"/api/teasers/{tid}/video").status_code == 200


def test_teaser_validation(client):
    login(client)
    assert client.post("/api/teasers", json={"clips": []}).status_code == 400


def test_document_pages_and_docx(client):
    login(client)
    r = client.post("/api/documents", files={"files": ("n.txt", "سطر اول خبر\nسطر دوم خبر".encode(), "text/plain")},
                    data={"tags": "متن‌خوان"})
    doc_id = r.json()["added"][0]["id"]
    documents.worker.run_pending()
    pages = client.get(f"/api/documents/{doc_id}/pages").json()["pages"]
    assert "سطر اول خبر\nسطر دوم خبر" in pages[0]["text"]
    assert any(d["id"] == doc_id for d in client.get("/api/documents", params={"tag": "متن‌خوان"}).json()["documents"])
    r = client.post("/api/tools/docx", json={"title": "آزمون", "text": "متن", "summary": "• خلاصه"})
    assert r.status_code == 200 and r.content[:2] == b"PK"


@pytest.mark.skipif(shutil.which("tesseract") is None, reason="tesseract نصب نیست")
def test_ocr_image_persian(client):
    import pymupdf

    login(client)
    doc = pymupdf.open()
    page = doc.new_page(width=800, height=300)
    page.insert_text((40, 120), "Kerman news 2026", fontsize=40)
    pix = page.get_pixmap(dpi=100)
    r = client.post("/api/documents", files={"files": ("scan.png", pix.tobytes("png"), "image/png")}, data={"tags": "متن‌خوان"})
    doc_id = r.json()["added"][0]["id"]
    documents.worker.run_pending()
    text = client.get(f"/api/documents/{doc_id}/pages").json()["pages"][0]["raw"]
    assert "Kerman" in text


def test_story_suggestion(client, monkeypatch):
    from zozo import suggest

    login(client)
    png = _png(800, 600, (40, 90, 160, 255))
    monkeypatch.setattr(suggest, "fetch_page", lambda url: {
        "lead": "شورای شهر کرمان امروز بودجه‌ی عمرانی سال آینده را تصویب کرد. این بودجه شامل پروژه‌های حمل‌ونقل عمومی است.",
        "paragraphs": ["رئیس شورا گفت با این بودجه سه خط اتوبوس تندرو در شهر کرمان راه‌اندازی می‌شود و ناوگان نوسازی خواهد شد."],
        "image": png, "image_url": "https://ex.ir/a.png"})
    s = client.post("/api/stories", json={"title": "تصویب بودجه‌ی عمرانی شهر", "source_url": "https://ex.ir/n/1"}).json()
    r = client.post(f"/api/stories/{s['id']}/suggest").json()
    assert r["post"]["title"] == "تصویب بودجه‌ی عمرانی شهر"
    assert "بودجه" in r["post"]["body"]
    assert r["reel"]["captions"] and r["source_fetched"]
    if shutil.which("ffmpeg"):
        assert r["media_id"]
        # بار دوم عکس از کش می‌آید
        assert client.post(f"/api/stories/{s['id']}/suggest").json()["media_id"] == r["media_id"]


def _wav(sec=2.0, rate=8000):
    import math
    n = int(sec * rate)
    data = b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * i / rate))) for i in range(n))
    return (b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
            + b"data" + struct.pack("<I", len(data)) + data)


def test_custom_fonts(client):
    login(client)
    bad = client.post("/api/fonts", files={"files": ("x.ttf", b"not a font", "font/ttf")}, data={"name": "x"})
    assert bad.status_code == 400
    assert client.post("/api/fonts", files={"files": ("x.txt", b"\x00\x01\x00\x00", "text/plain")}).status_code == 400
    r = client.post("/api/fonts", files={"files": ("B-Titr.ttf", b"\x00\x01\x00\x00" + b"\0" * 64, "font/ttf")}, data={"name": "بی تیتر"})
    assert r.status_code == 201, r.text
    f = r.json()
    assert f["name"] == "بی تیتر" and f["family"] == f"zf{f['id']}"
    assert any(x["id"] == f["id"] for x in client.get("/api/fonts").json()["items"])
    assert client.get(f"/api/fonts/{f['id']}/file").status_code == 200
    assert client.patch(f"/api/fonts/{f['id']}", json={"name": "تیتر"}).json()["name"] == "تیتر"
    client.delete(f"/api/fonts/{f['id']}")
    assert client.get(f"/api/fonts/{f['id']}/file").status_code == 404


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg نصب نیست")
def test_teaser_tracks_and_outro(client):
    login(client)
    mid = client.post("/api/media", files={"files": ("p.png", _png(400, 300), "image/png")}).json()["added"][0]["id"]
    aid = client.post("/api/media", files={"files": ("m.wav", _wav(), "audio/wav")}).json()["added"][0]["id"]
    du = lambda w, h, c: "data:image/png;base64," + base64.b64encode(_png(w, h, c)).decode()
    spec = {
        "title": "ریلز", "format": "9:16", "quality": "720", "fade": False, "transition": "none",
        "clips": [{"media_id": mid, "duration": 1, "gray": True, "bright": 0.2},
                  {"media_id": mid, "duration": 1, "motion": "pan"},
                  {"outro": {"bg": du(720, 1280, (255, 255, 255, 255)), "logo": du(200, 150, (200, 0, 0, 255)),
                             "duration": 1.2, "logo_w": 0.5, "logo_y": 0.45, "drop": 0.2, "land": 0.7}}],
        "tracks": [{"media_id": aid, "src": 0.2, "at": 0, "dur": 2.5, "vol": 0.8, "fin": 0.5, "fout": 0.5, "duck": [[1, 2, 0.3]]},
                   {"media_id": aid, "at": 2.7, "dur": 0.4}],
    }
    r = client.post("/api/teasers", json=spec)
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    teaser.renderer.run_pending()
    t = client.get(f"/api/teasers/{tid}").json()
    assert t["status"] == "done", t.get("error")
    info = teaser.probe(teaser.teaser_file(tid))
    assert abs(info["duration"] - 3.2) < 0.3
    assert info["has_audio"]


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg نصب نیست")
def test_segments_share_color_settings(tmp_path):
    # عکس JPEG (تمام‌دامنه) و ویدیوی bt709 باید یک رنگ‌بندی بگیرند؛ وگرنه ffmpeg 7 وسط کار
    # فیلترهای نهایی را از نو می‌سازد و قاب و نوشته‌ها روی ویدیو گم می‌شوند.
    import json
    import subprocess
    jpg, vid = str(tmp_path / "p.jpg"), str(tmp_path / "v.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x240", "-frames:v", "1", jpg], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x240:d=1", "-pix_fmt", "yuv420p",
                    "-colorspace", "bt709", "-color_range", "tv", vid], check=True)
    spec = {"size": (360, 640), "fit": "crop", "bg_color": "#000000", "keep_audio": True, "video_volume": 1.0, "transition": "none"}
    clips = [{"kind": "image", "path": jpg, "duration": 1, "zoom": False, "gray": True},
             {"kind": "video", "path": vid, "start": 0, "duration": 1, "has_audio": False, "zoom": False}]
    props = []
    for i, c in enumerate(clips):
        out = str(tmp_path / f"s{i}.mp4")
        subprocess.run(teaser.segment_cmd(c, spec, out), check=True)
        r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries",
                            "stream=pix_fmt,color_range,color_space", "-of", "json", out], capture_output=True, text=True)
        props.append(json.loads(r.stdout)["streams"][0])
    assert props[0] == props[1]
    assert props[0]["pix_fmt"] == "yuv420p" and props[0]["color_range"] == "tv"


def test_custom_fonts_from_zip(client):
    import zipfile
    login(client)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("B-Titr/read me!.txt", "hello")
        z.writestr("B-Titr/Fontyab.com.url", "[InternetShortcut]")
        z.writestr("__MACOSX/B-Titr/._B Titr Bold_0.ttf", b"\x00\x01\x00\x00junk")
        z.writestr("B-Titr/B Titr Bold_0.ttf", b"\x00\x01\x00\x00" + b"\0" * 64)
    r = client.post("/api/fonts", files={"files": ("B-Titr.zip", buf.getvalue(), "application/zip")}, data={"name": "بی تیتر"})
    assert r.status_code == 201, r.text
    assert [f["name"] for f in r.json()["added"]] == ["بی تیتر"]
    assert client.get(f"/api/fonts/{r.json()['id']}/file").status_code == 200
    # چند فونت در یک زیپ: نام از نام فایل‌ها
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("Sahel.ttf", b"\x00\x01\x00\x00" + b"sahel" * 20)
        z.writestr("Sahel-Bold.woff2", b"wOF2" + b"\0" * 64)
    r = client.post("/api/fonts", files={"files": ("sahel.zip", buf.getvalue(), "application/zip")}, data={"name": "x"})
    assert r.status_code == 201 and len(r.json()["added"]) == 2
    assert {f["name"] for f in r.json()["added"]} == {"Sahel"}
    # زیپ بدون فونت یا خراب
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("readme.txt", "no fonts")
    assert client.post("/api/fonts", files={"files": ("x.zip", buf.getvalue(), "application/zip")}).status_code == 400
    assert client.post("/api/fonts", files={"files": ("x.zip", b"not a zip", "application/zip")}).status_code == 400


def test_custom_font_upload_twice_is_not_duplicated(client):
    login(client)
    data = b"\x00\x01\x00\x00" + b"dup" * 30
    a = client.post("/api/fonts", files={"files": ("Dup.ttf", data, "font/ttf")}).json()
    b = client.post("/api/fonts", files={"files": ("Dup.ttf", data, "font/ttf")}).json()
    assert a["id"] == b["id"]
    assert sum(1 for f in client.get("/api/fonts").json()["items"] if f["id"] == a["id"]) == 1


def test_teaser_transcript_validation(client):
    login(client)
    assert client.post("/api/teasers/transcript", json={}).status_code == 400


def test_teaser_long_still_image_keeps_its_length(client):
    # عکسِ بدنه‌ی ریلز با لید بلند می‌تواند تا ۶۰ ثانیه باشد؛ نباید سرور آن را کوتاه کند
    login(client)
    mid = client.post("/api/media", files={"files": ("p.png", _png(400, 300), "image/png")}).json()["added"][0]["id"]
    v = teaser.validate_spec({"format": "9:16", "clips": [{"media_id": mid, "duration": 4}, {"media_id": mid, "duration": 36.4}]})
    assert [c["duration"] for c in v["clips"]] == [4, 36.4] and v["total"] == 40.4


def test_media_keep_and_temp_cleanup(client, monkeypatch):
    import datetime as dt
    login(client)
    png = _png(64, 48)
    kept = client.post("/api/media", files={"files": ("k.png", png, "image/png")}).json()["added"][0]
    temp = client.post("/api/media", files={"files": ("t.png", png, "image/png")}, data={"keep": "0"}).json()["added"][0]
    assert kept["keep"] == 1 and temp["keep"] == 0
    u = client.get("/api/media/usage").json()
    assert u["temp_count"] >= 1 and u["count"] >= 2
    # تازه‌اند: پاک نمی‌شوند
    teaser.cleanup_media()
    ids = {m["id"] for m in client.get("/api/media").json()}
    assert {kept["id"], temp["id"]} <= ids
    # سه روز بعد: موقت پاک، ذخیره‌شده می‌ماند
    from zozo.config import settings
    real_now = settings.now
    monkeypatch.setattr(type(settings), "now", lambda self: real_now() + dt.timedelta(days=3))
    teaser.cleanup_media()
    ids = {m["id"] for m in client.get("/api/media").json()}
    assert kept["id"] in ids and temp["id"] not in ids
    # موقت کردن و برگرداندن
    assert client.patch(f"/api/media/{kept['id']}", json={"keep": False}).json()["keep"] == 0
    assert client.patch(f"/api/media/{kept['id']}", json={"keep": True}).json()["keep"] == 1


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg نصب نیست")
def test_video_speed_slow_motion(client, tmp_path):
    import subprocess
    login(client)
    src = tmp_path / "v.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x240:r=30:d=4", "-f", "lavfi",
                    "-i", "sine=f=440:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(src)], check=True)
    vid = client.post("/api/media", files={"files": ("v.mp4", src.read_bytes(), "video/mp4")}).json()["added"][0]["id"]
    # ۲ ثانیه از ویدیو با سرعت ۰٫۵ ← ۴ ثانیه در خروجی
    v = teaser.validate_spec({"format": "9:16", "clips": [{"media_id": vid, "start": 1, "duration": 4, "speed": 0.5}]})
    assert v["clips"][0]["speed"] == 0.5 and v["total"] == 4
    # بیشتر از طول باقی‌مانده‌ی ویدیو (۳ ثانیه ÷ ۰٫۵ = ۶) نمی‌شود
    v = teaser.validate_spec({"format": "9:16", "clips": [{"media_id": vid, "start": 1, "duration": 20, "speed": 0.5}]})
    assert v["total"] == 6
    r = client.post("/api/teasers", json={"format": "9:16", "quality": "720", "fade": False, "transition": "none",
                                          "clips": [{"media_id": vid, "start": 1, "duration": 4, "speed": 0.5}]})
    tid = r.json()["id"]
    teaser.renderer.run_pending()
    t = client.get(f"/api/teasers/{tid}").json()
    assert t["status"] == "done", t.get("error")
    assert abs(teaser.probe(teaser.teaser_file(tid))["duration"] - 4.0) < 0.3


def test_reel_body_motion_grid_transitions(client, tmp_path):
    """بدنه‌ی چندتکه: پیمایش کامل عکس، چیدمان دوتایی، و گذار محو درهم / فلش / کشویی."""
    import subprocess

    from PIL import Image

    login(client)
    wide = Image.new("RGB", (1600, 400), (30, 60, 220))     # نیمه‌ی راست آبی
    wide.paste((220, 30, 30), (0, 0, 800, 400))              # نیمه‌ی چپ قرمز
    b = io.BytesIO(); wide.save(b, "PNG")
    wid = client.post("/api/media", files={"files": ("wide.png", b.getvalue(), "image/png")}).json()["added"][0]["id"]
    pid = client.post("/api/media", files={"files": ("p.png", _png(400, 300, (20, 160, 60, 255)), "image/png")}).json()["added"][0]["id"]
    vid = tmp_path / "v.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=320x240:d=3:r=25", "-f", "lavfi", "-i",
                    "sine=f=300:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(vid)], check=True)
    vm = client.post("/api/media", files={"files": ("v.mp4", vid.read_bytes(), "video/mp4")}).json()["added"][0]["id"]
    spec = {"title": "بدنه", "format": "9:16", "quality": "720", "fit": "crop", "transition": "none", "fade": False,
            "clips": [{"media_id": pid, "duration": 1, "motion": "none"},
                      {"media_id": wid, "duration": 2, "motion": "pan", "mamt": "full"},
                      {"grid": {"layout": "2h", "duration": 2, "gap": 20, "gap_color": "#ffffff", "region": [0.1, 0.1, 0.8, 0.6],
                                "cells": [{"media_id": pid}, {"media_id": vm, "start": 0.5}]}, "tin": {"type": "cross", "dur": 0.5}},
                      {"media_id": pid, "duration": 1.5, "tin": {"type": "flash", "dur": 0.6}},
                      {"media_id": wid, "duration": 1.5, "motion": "zoomout", "mamt": "high", "tin": {"type": "slide", "dur": 0.5}}]}
    r = client.post("/api/teasers", json=spec)
    assert r.status_code == 201, r.text
    t = r.json()
    assert abs(t["duration"] - 7.0) < 0.01
    teaser.renderer.run_pending()
    t = client.get(f"/api/teasers/{t['id']}").json()
    assert t["status"] == "done", t.get("error")
    f = teaser.teaser_file(t["id"])
    assert abs(teaser.probe(f)["duration"] - 7.0) < 0.2

    def px(sec, x, y):
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(sec), "-i", f, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                             capture_output=True, check=True).stdout
        i = (y * 720 + x) * 3
        return tuple(raw[i:i + 3])
    # پیمایش: اول سمت راست عکس (آبی)، آخر سمت چپ (قرمز)
    assert px(1.05, 360, 640)[2] > 150 and px(2.4, 360, 640)[0] > 150
    # چیدمان: لبه‌ی ناحیه سفید، خانه‌ی راست سبز
    assert min(px(3.5, 72 + 4, 128 + 40)) > 200 and px(3.5, 72 + 288 + 100, 128 + 300)[1] > 120


def test_finance_daily_and_scope(client):
    from zozo import db as zdb, jalali

    login(client)
    today = zdb.today_str()
    yest = jalali.add_days(today, -1)
    add = lambda **k: client.post("/api/transactions", json={"description": k.pop("d", "x"), **k})
    assert add(tx_date=today, kind="expense", amount=150000, category="خوراک و خرید روزانه", scope="personal").status_code == 201
    assert add(tx_date=today, kind="expense", amount=50000, category="ایاب‌وذهاب").status_code == 201   # پیش‌فرض: کاری
    assert add(tx_date=yest, kind="expense", amount=30000, category="قبض‌ها (آب، برق، گاز، تلفن)", scope="personal").status_code == 201
    p = client.get("/api/finance/daily", params={"scope": "personal"}).json()
    assert p["day"]["expense"] == 150000 and p["scope"] == "personal"
    assert {c["name"] for c in p["expense_categories"]} >= {"خوراک و خرید روزانه"}
    assert "ایاب‌وذهاب" not in {c["name"] for c in p["expense_categories"]}
    a = client.get("/api/finance/daily").json()
    assert a["day"]["expense"] >= 200000
    day = next(x for x in a["days"] if x["date"] == today)
    assert day["expense"] >= 200000 and "(" in day["label"]
    w = client.get("/api/finance/dashboard", params={"period": "month", "scope": "work"}).json()
    assert "خوراک و خرید روزانه" not in {c["name"] for c in w["expense_categories"]}
