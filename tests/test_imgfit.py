"""تنظیم سایز عکس: اندازه‌ی دقیق، پر کردن کادر / کل عکس، چرخش عکس گوشی، سقف حجم و خروجی WebP."""
import io
import shutil

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from zozo import imgfit
from zozo.main import app

pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg نصب نیست")


def _jpeg(w, h, orientation=None):
    im = Image.new("RGB", (w, h), "#3060a0")
    im.paste((220, 40, 40), (0, 0, w // 2, h))  # نیمه‌ی چپ قرمز
    b = io.BytesIO()
    if orientation:
        ex = Image.Exif()
        ex[0x0112] = orientation
        im.save(b, "JPEG", quality=92, exif=ex)
    else:
        im.save(b, "JPEG", quality=92)
    return b.getvalue()


def _upload(c, data, name="عکس خبر.jpg"):
    r = c.post("/api/media", files={"files": (name, data, "image/jpeg")}, data={"keep": "0"})
    assert r.status_code == 201, r.text
    return r.json()["added"][0]


def test_params_are_clamped():
    p = imgfit.params({"w": 99999, "h": "x", "mode": "?", "bg": "red", "fx": 7, "quality": 5})
    assert p["w"] == imgfit.MAX_SIDE and p["h"] == 719 and p["mode"] == "fill" and p["bg"] == "blur"
    assert p["fx"] == 1 and p["quality"] == 30


def test_imgfit_api():
    with TestClient(app) as c:
        c.post("/api/login", json={"password": "secret-pass"})
        m = _upload(c, _jpeg(852, 530))
        # پیش‌فرض: ۱۰۰۷×۷۱۹ پر کردن کادر
        r = c.post("/api/imgfit", json={"media_id": m["id"], "w": 1007, "h": 719, "mode": "fill"})
        assert r.status_code == 200 and r.headers["content-type"] == "image/webp"
        assert "%D8%B9%DA%A9%D8%B3" in r.headers["x-filename"] and r.headers["x-filename"].endswith("_1007x719.webp")
        im = Image.open(io.BytesIO(r.content))
        assert im.format == "WEBP" and im.size == (1007, 719)
        # برش از سمت چپ ← فقط قرمز؛ از سمت راست ← فقط آبی
        left = Image.open(io.BytesIO(c.post("/api/imgfit", json={"media_id": m["id"], "w": 300, "h": 600, "fx": 0}).content)).convert("RGB")
        right = Image.open(io.BytesIO(c.post("/api/imgfit", json={"media_id": m["id"], "w": 300, "h": 600, "fx": 1}).content)).convert("RGB")
        assert left.getpixel((150, 300))[0] > 180 and right.getpixel((150, 300))[2] > 130
        # کل عکس با پس‌زمینه‌ی سفید: بالا و پایین سفید
        whole = Image.open(io.BytesIO(c.post("/api/imgfit", json={"media_id": m["id"], "w": 600, "h": 900, "mode": "whole", "bg": "#ffffff"}).content)).convert("RGB")
        assert whole.size == (600, 900) and min(whole.getpixel((300, 5))) > 240
        # سقف حجم
        noisy = Image.merge("RGB", [Image.effect_noise((900, 600), 80)] * 3)
        b = io.BytesIO(); noisy.save(b, "JPEG", quality=95)
        n = _upload(c, b.getvalue(), "noisy.jpg")
        full = len(c.post("/api/imgfit", json={"media_id": n["id"], "w": 1007, "h": 719, "quality": 100}).content)
        cap = full // 1024 // 2
        r = c.post("/api/imgfit", json={"media_id": n["id"], "w": 1007, "h": 719, "quality": 100, "max_kb": cap, "sharpen": 1, "bright": 0.1})
        assert len(r.content) <= cap * 1024 and int(r.headers["x-quality"]) < 100
        # عکس گوشی که با EXIF چرخیده (۹۰ درجه) ایستاده حساب شود
        rot = _upload(c, _jpeg(800, 400, orientation=6), "phone.jpg")
        assert imgfit._open(imgfit.teaser.get_media(rot["id"])["path"]).size == (400, 800)
        # ذخیره در فایل‌ها
        r = c.post("/api/imgfit", json={"media_id": m["id"], "w": 1007, "h": 719, "save": True}).json()
        assert r["media"]["kind"] == "image" and r["media"]["width"] == 1007
        # فقط عکس
        audio = c.post("/api/imgfit", json={"media_id": 999999})
        assert audio.status_code == 404
        # قالب‌ها در تنظیمات ذخیره می‌شوند
        assert c.put("/api/prefs/imgfit", json={"value": {"presets": [imgfit.DEFAULT_PRESET], "def": "site"}}).status_code == 200
        assert c.get("/api/prefs/imgfit").json()["value"]["presets"][0]["w"] == 1007
