"""حذف نویز: فیلتر صدا، تصویر بی‌تغییر، پیشرفت و ذخیره‌ی نتیجه."""
import shutil
import subprocess
import time

import pytest
from fastapi.testclient import TestClient

from zozo import denoise
from zozo.main import app

pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg نصب نیست")


def test_filter_levels():
    assert denoise.MODEL.exists()
    assert "arnndn" in denoise.audio_filter("normal", False) and "loudnorm" not in denoise.audio_filter("normal", False)
    assert "mix=0.85" in denoise.audio_filter("light", True) and "loudnorm" in denoise.audio_filter("light", True)
    assert "afftdn" in denoise.audio_filter("strong", False)


def _wait(c, jid):
    for _ in range(120):
        j = c.get(f"/api/denoise/{jid}").json()
        if j["status"] in ("done", "error"):
            return j
        time.sleep(0.25)
    raise AssertionError("timeout")


def test_denoise_video_and_audio(tmp_path):
    vid = tmp_path / "noisy.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=320x240:d=2:r=25",
                    "-f", "lavfi", "-i", "anoisesrc=d=2:c=pink:a=0.3", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-shortest", str(vid)], check=True)
    with TestClient(app) as c:
        c.post("/api/login", json={"password": "secret-pass"})
        m = c.post("/api/media", files={"files": ("مصاحبه.mp4", vid.read_bytes(), "video/mp4")}, data={"keep": "0"}).json()["added"][0]
        j = _wait(c, c.post("/api/denoise", json={"media_id": m["id"], "level": "strong"}).json()["id"])
        assert j["status"] == "done", j
        r = j["result"]
        assert r["kind"] == "video" and r["has_audio"] and r["filename"] == "مصاحبه-بدون-نویز.mp4" and r["keep"] == 0
        assert abs(r["duration"] - 2) < 0.3 and r["width"] == 320
        # فایل صوتی ← mp3
        aud = tmp_path / "voice.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anoisesrc=d=1.5:a=0.2", str(aud)], check=True)
        a = c.post("/api/media", files={"files": ("voice.wav", aud.read_bytes(), "audio/wav")}).json()["added"][0]
        j = _wait(c, c.post("/api/denoise", json={"media_id": a["id"]}).json()["id"])
        assert j["status"] == "done" and j["result"]["filename"].endswith(".mp3") and j["result"]["kind"] == "audio"
        # عکس صدا ندارد
        img = c.post("/api/media", files={"files": ("p.png", _png(), "image/png")}).json()["added"][0]
        assert c.post("/api/denoise", json={"media_id": img["id"]}).status_code == 400
        assert c.get("/api/denoise/nope").status_code == 404


def _png():
    import io
    from PIL import Image
    b = io.BytesIO()
    Image.new("RGB", (40, 30), "red").save(b, "PNG")
    return b.getvalue()
