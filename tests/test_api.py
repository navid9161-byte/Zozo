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
