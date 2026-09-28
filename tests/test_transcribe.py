import io
import shutil
import struct
import wave

import pytest

from zozo import transcribe


def test_split_and_exports():
    words = [{"word": f"واژه{i}", "start": i * 1.0, "end": i * 1.0 + 0.8} for i in range(30)]
    words[15]["start"] += 1.5  # مکث بلند
    segs = transcribe._split_words(words)
    assert len(segs) > 1 and all(s["end"] - s["start"] <= transcribe.MAX_SEGMENT_SEC + 1 for s in segs)
    assert " ".join(s["text"] for s in segs).split() == [w["word"] for w in words]
    segs = [{"start": 0, "end": 2, "text": "سلام"}, {"start": 65.5, "end": 70, "text": "خداحافظ"}]
    assert transcribe.plain_text(segs, True) == "[00:00] سلام\n[01:05] خداحافظ"
    assert transcribe.plain_text(segs, False) == "سلام\n\nخداحافظ"
    assert "00:01:05,500 --> 00:01:10,000" in transcribe.srt_text(segs)
    assert transcribe.docx_bytes("عنوان", segs, False, "• خلاصه")[:2] == b"PK"


def _wav(seconds=2.0):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(struct.pack("<h", 0) * int(16000 * seconds))
    buf.seek(0)
    return buf


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg نصب نیست")
def test_queue_and_edit(monkeypatch):
    # مدل واقعی لازم نیست: تشخیص با یک تابع ساختگی جایگزین می‌شود
    monkeypatch.setattr(transcribe, "model_path", lambda: "/fake")
    monkeypatch.setattr(transcribe, "recognize", lambda path, on_progress=None, should_stop=None: [
        {"start": 0.0, "end": 1.5, "text": "امروز جلسه‌ی شورای شهر برگزار شد."},
        {"start": 2.0, "end": 3.5, "text": "بودجه‌ی عمرانی شهر افزایش یافت."},
        {"start": 4.0, "end": 5.0, "text": "هوا آفتابی بود."},
    ])
    t = transcribe.add(_wav(), "voice.wav", title="جلسه")
    assert t["status"] == "queued" and abs(t["duration"] - 2.0) < 0.2
    transcribe.worker.run_pending()
    t = transcribe.get(t["id"])
    assert t["status"] == "done" and len(t["segments"]) == 3
    t = transcribe.update(t["id"], {"segments": [{**t["segments"][0], "text": "متن اصلاح‌شده"}] + t["segments"][1:]})
    assert t["segments"][0]["text"] == "متن اصلاح‌شده"
    s = transcribe.summarize(t["id"], 2)
    assert s["summary"].count("•") == 2
    doc = transcribe.save_to_archive(t["id"])
    assert doc["category"] == "interview"
    with pytest.raises(Exception):
        transcribe.add(io.BytesIO(b"x"), "file.exe")


@pytest.mark.skipif(transcribe.model_path() is None or not transcribe.vosk_installed() or shutil.which("ffmpeg") is None,
                    reason="مدل Vosk نصب نیست")
def test_real_model_on_silence():
    segs = transcribe.recognize(_save_silence())
    assert isinstance(segs, list)


def _save_silence():
    import tempfile

    f = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    f.write(_wav(1.0).read())
    f.close()
    return f.name
