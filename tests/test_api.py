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
