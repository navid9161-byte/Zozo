"""متن به صدا: انتخاب صدا، اعتبارسنجی، و افتادن به صدای بدون اینترنت وقتی سرویس اینترنتی در دسترس نیست."""
import shutil
import subprocess

import pytest

from zozo import db, tts

pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg نصب نیست")


def _fake_mp3(out, *_):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=220:d=1.5", str(out)], check=True)


def test_voices_and_validation():
    assert {v["id"] for v in tts.VOICES} == {"female", "male", "male_offline"}
    assert [v["gender"] for v in tts.VOICES if v["engine"] == "edge"] == ["female", "male"]
    with pytest.raises(db.ValidationError):
        tts.synthesize("   ", "female")
    with pytest.raises(db.ValidationError):
        tts.synthesize("سلام", "robot")
    with pytest.raises(db.ValidationError):
        tts.synthesize("الف " * 5000, "female")
    assert tts.clean_text("حدود *۱۴۰ مگاوات*  نصب   شد") == "حدود ۱۴۰ مگاوات نصب شد"


def test_online_voice_saved_as_reel_audio(monkeypatch):
    calls = []
    monkeypatch.setattr(tts, "_edge", lambda text, name, rate, out: calls.append((name, rate)) or _fake_mp3(out))
    r = tts.synthesize("به گزارش کرمان راوی", "female", 10)
    assert calls == [("fa-IR-DilaraNeural", 10)]
    assert r["engine"] == "edge" and r["voice"] == "female" and not r["note"]
    assert r["media"]["kind"] == "audio" and r["media"]["filename"].startswith("صدا-female-")
    assert abs(r["media"]["duration"] - 1.5) < 0.2


def test_falls_back_to_offline_voice(monkeypatch):
    def down(*_):
        raise OSError("no route to host")
    monkeypatch.setattr(tts, "_edge", down)
    monkeypatch.setattr(tts, "_piper", lambda text, rate, out: _fake_mp3(out))
    r = tts.synthesize("سلام", "female")
    assert r["engine"] == "piper" and r["voice"] == "male_offline"
    assert "در دسترس نبود" in r["note"]


def test_tts_api(client_login=None):
    from fastapi.testclient import TestClient

    from zozo.main import app
    with TestClient(app) as c:
        c.post("/api/login", json={"password": "secret-pass"})
        v = c.get("/api/tts/voices").json()
        assert len(v["voices"]) == 3 and "offline" in v
        assert c.post("/api/tts", json={"text": "", "voice": "female"}).status_code == 400
