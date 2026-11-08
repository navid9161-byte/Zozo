"""فیلم HEVC گوشی ← نسخه‌ی H.264 برای پخش در مرورگر؛ فیلم H.264 همان فایل اصلی."""
import json
import shutil
import subprocess

import pytest
from fastapi.testclient import TestClient

from zozo import teaser
from zozo.main import app

pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg نصب نیست")


def _make(tmp_path, name, vcodec):
    p = tmp_path / name
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=s=320x240:d=1", "-f", "lavfi", "-i", "sine=d=1",
                    "-c:v", vcodec, "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(p)], check=True)
    return p


def _codec(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "json", path],
                       capture_output=True, text=True)
    return json.loads(r.stdout)["streams"][0]["codec_name"]


def test_hevc_gets_h264_preview(tmp_path):
    if subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout.find("libx265") < 0:
        pytest.skip("libx265 نیست")
    src = _make(tmp_path, "phone.mp4", "libx265")
    with TestClient(app) as c:
        c.post("/api/login", json={"password": "secret-pass"})
        m = c.post("/api/media", files={"files": ("phone.mp4", src.read_bytes(), "video/mp4")}, data={"keep": "0"}).json()["added"][0]
        assert teaser.needs_preview(m)
        r = c.get(f"/api/media/{m['id']}/play")
        assert r.status_code == 200 and r.headers["content-type"] == "video/mp4"
    m = teaser.get_media(m["id"])
    pv = teaser.preview_path(m["id"])
    assert pv.exists() and _codec(str(pv)) == "h264"
    assert _codec(m["path"]) == "hevc"  # فایل اصلی (برای ساخت ویدیو) دست نمی‌خورد
    teaser.delete_media(m["id"])
    assert not pv.exists()


def test_h264_served_as_is(tmp_path):
    src = _make(tmp_path, "ok.mp4", "libx264")
    with open(src, "rb") as f:
        m = teaser.add_media(f, "ok.mp4", keep=False)
    assert not teaser.needs_preview(m) and teaser.ensure_preview(m) is None
    teaser.delete_media(m["id"])
