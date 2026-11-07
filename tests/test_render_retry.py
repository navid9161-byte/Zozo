"""ساخت ویدیو: وقتی ffmpeg از بیرون بسته می‌شود (کمبود حافظه) یا برنامه خاموش می‌شود."""
import json

import pytest

from zozo import db, teaser


def _row(status="queued"):
    with db.connect() as conn:
        return conn.execute("INSERT INTO teasers (title, spec, status, duration, created_at, updated_at) VALUES (?,?,?,?,?,?)",
                            ("آزمایش", json.dumps({"title": "آزمایش", "total": 1, "clips": [], "overlays": []}),
                             status, 1, db.now_str(), db.now_str())).lastrowid


def _get(tid):
    with db.connect() as conn:
        return dict(conn.execute("SELECT status, error FROM teasers WHERE id=?", (tid,)).fetchone())


def test_lowmem_args():
    a = teaser.lowmem_args(["ffmpeg", "-y", "-i", "x", "-threads", "2", "o.mp4"])
    assert a[:5] == ["ffmpeg", "-filter_threads", "1", "-filter_complex_threads", "1"]
    assert a[a.index("-threads") + 1] == "1"


def test_killed_process_detected():
    r = teaser.Renderer()
    with pytest.raises(teaser.Killed):
        r._exec(1, ["sh", "-c", "kill -9 $$"])
    with pytest.raises(RuntimeError) as e:
        r._exec(1, ["sh", "-c", "echo bad >&2; exit 1"])
    assert not isinstance(e.value, teaser.Killed) and "bad" in str(e.value)


def test_retry_in_lowmem_then_succeed(monkeypatch):
    r, calls, tid = teaser.Renderer(), [], _row()

    def once(self, t, spec):
        calls.append(self._lowmem)
        if len(calls) == 1:
            raise teaser.Killed("x")
        self._set(t, status="done")
    monkeypatch.setattr(teaser.Renderer, "_render_once", once)
    r.render(tid)
    assert calls == [False, True] and _get(tid)["status"] == "done" and r._lowmem is False


def test_killed_twice_gives_clear_message(monkeypatch):
    r, tid = teaser.Renderer(), _row()
    monkeypatch.setattr(teaser.Renderer, "_render_once", lambda self, t, s: (_ for _ in ()).throw(teaser.Killed("x")))
    r.render(tid)
    st = _get(tid)
    assert st["status"] == "error" and "حافظه" in st["error"]


def test_shutdown_requeues(monkeypatch):
    r, tid = teaser.Renderer(), _row()

    def once(self, t, spec):
        self.stopping = True
        raise teaser.Killed("x")
    monkeypatch.setattr(teaser.Renderer, "_render_once", once)
    r.render(tid)
    assert _get(tid) == {"status": "queued", "error": None}
    with pytest.raises(teaser.Interrupted):
        r._exec(1, ["true"])
