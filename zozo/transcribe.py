"""تبدیل صوت فارسی به متن (بدون اینترنت) با مدل سبک Vosk، همراه با زمان هر بخش.

- هر فایل صوتی/ویدیویی با ffmpeg به صدای تک‌کاناله‌ی ۱۶ کیلوهرتز تبدیل و کمی تمیز می‌شود (حذف صدای بم و زیر، کاهش نویز،
  یکنواخت کردن بلندی) و تکه‌تکه به مدل داده می‌شود؛ پس فایل‌های طولانی هم حافظه‌ی زیادی نمی‌گیرند.
- خروجی: فهرست «بخش»ها با زمان شروع و پایان. مدل در سکوت‌ها بخش جدید می‌سازد؛ بخش‌های بلند هم شکسته می‌شوند.
- در هر لحظه فقط یک فایل پردازش می‌شود و مدل پس از خالی شدن صف از حافظه خارج می‌شود.

جای خالی برای آینده: اگر مدل قوی‌تر (مثلاً Whisper روی سرور بزرگ‌تر) یا یک سرویس گفتار به متن در دسترس بود،
کافی است تابع recognize را برای آن نوشت؛ بقیه‌ی بخش‌ها (صف، ویرایش، خروجی، خلاصه) بدون تغییر کار می‌کنند.
"""
from __future__ import annotations

import io
import json
import logging
import os
import shutil
import subprocess
import threading
import zipfile
from pathlib import Path
from typing import Any, BinaryIO, Callable

from . import db, documents, notify, textnorm
from .config import settings

log = logging.getLogger(__name__)

MODEL_NAME = "vosk-model-small-fa-0.42"
MODEL_URL = f"https://alphacephei.com/vosk/models/{MODEL_NAME}.zip"
SAMPLE_RATE = 16000
AUDIO_FILTER = "highpass=f=120,lowpass=f=6000,afftdn=nf=-25,dynaudnorm"
MAX_SEGMENT_SEC = 12.0
EXT = documents.AUDIO_EXT | documents.VIDEO_EXT | {".oga", ".webm", ".mpeg", ".mpga", ".wma"}


# ───────────────────────── مدل ─────────────────────────


def model_dirs() -> list[Path]:
    env = os.getenv("ZOZO_ASR_MODEL")
    dirs = [Path(env)] if env else []
    return dirs + [Path("/opt/asr") / MODEL_NAME, settings.data_dir / "models" / MODEL_NAME, Path("models") / MODEL_NAME]


def model_path() -> Path | None:
    for d in model_dirs():
        if (d / "am").is_dir() or (d / "conf").is_dir():
            return d
    return None


def vosk_installed() -> bool:
    try:
        import vosk  # noqa: F401
        return True
    except ImportError:
        return False


def status() -> dict[str, Any]:
    p = model_path()
    return {"engine": "vosk", "installed": vosk_installed(), "model": bool(p), "model_name": MODEL_NAME,
            "downloading": _download_lock.locked(), "ffmpeg": shutil.which("ffmpeg") is not None}


_download_lock = threading.Lock()


def download_model(target_root: Path | None = None) -> Path:
    """دانلود مدل فارسی (حدود ۵۰ مگابایت) روی دیسک داده‌ها؛ در صورت ناموفق بودن ساخت Docker استفاده می‌شود."""
    import httpx

    root = target_root or settings.data_dir / "models"
    root.mkdir(parents=True, exist_ok=True)
    with _download_lock:
        if (p := model_path()) is not None:
            return p
        tmp = root / f"{MODEL_NAME}.zip.part"
        last: Exception | None = None
        for attempt in range(4):  # شبکه‌ی کند: ادامه‌ی دانلود از جایی که قطع شد
            try:
                have = tmp.stat().st_size if tmp.exists() else 0
                headers = {"Range": f"bytes={have}-"} if have else {}
                with httpx.stream("GET", MODEL_URL, headers=headers, timeout=httpx.Timeout(60, read=180),
                                  follow_redirects=True) as r:
                    if r.status_code == 416:  # کامل است
                        break
                    r.raise_for_status()
                    mode = "ab" if have and r.status_code == 206 else "wb"
                    with open(tmp, mode) as f:
                        for chunk in r.iter_bytes(1 << 20):
                            f.write(chunk)
                last = None
                break
            except Exception as e:  # noqa: BLE001
                last = e
                log.warning("دانلود مدل گفتار (تلاش %d) ناموفق: %s", attempt + 1, e)
        if last:
            raise last
        with zipfile.ZipFile(tmp) as z:
            z.extractall(root)
        tmp.unlink()
    p = model_path()
    if p is None:
        raise RuntimeError("مدل پس از دانلود پیدا نشد")
    return p


def install_model_zip(fileobj: BinaryIO) -> Path:
    """نصب مدل از فایل zip که کاربر خودش بارگذاری کرده (وقتی سرور به اینترنت خارجی دسترسی ندارد)."""
    root = settings.data_dir / "models"
    root.mkdir(parents=True, exist_ok=True)
    data = fileobj.read()
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise db.ValidationError("فایل zip معتبر نیست") from None
    names = z.namelist()
    if not any(n.startswith(MODEL_NAME + "/") for n in names):
        raise db.ValidationError(f"این فایل مدل {MODEL_NAME} نیست")
    for n in names:  # جلوگیری از نوشتن بیرون از پوشه
        if n.startswith("/") or ".." in Path(n).parts:
            raise db.ValidationError("فایل zip نامعتبر است")
    z.extractall(root)
    p = model_path()
    if p is None:
        raise db.ValidationError("مدل نصب نشد")
    return p


class _Model:
    def __init__(self) -> None:
        self._m = None
        self._lock = threading.Lock()

    def get(self):
        with self._lock:
            if self._m is None:
                from vosk import Model, SetLogLevel

                SetLogLevel(-1)
                p = model_path()
                if p is None:
                    raise RuntimeError("مدل تبدیل گفتار فارسی نصب نیست (بخش تنظیمات ← نصب مدل)")
                self._m = Model(str(p))
            return self._m

    def release(self) -> None:
        with self._lock:
            self._m = None


model = _Model()


# ───────────────────────── تبدیل ─────────────────────────


def probe_duration(path: str) -> float | None:
    try:
        res = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                             capture_output=True, text=True, timeout=60)
        return round(float(res.stdout.strip()), 2)
    except (ValueError, subprocess.TimeoutExpired):
        return None


def _split_words(words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """یک نتیجه‌ی مدل ← یک یا چند بخش (هر بخش حداکثر حدود ۱۲ ثانیه، شکستن در بزرگ‌ترین مکث)."""
    if not words:
        return []
    if words[-1]["end"] - words[0]["start"] <= MAX_SEGMENT_SEC or len(words) < 4:
        return [{"start": round(words[0]["start"], 2), "end": round(words[-1]["end"], 2),
                 "text": " ".join(w["word"] for w in words)}]
    # بزرگ‌ترین مکث در میانه‌ی بخش
    lo, hi = len(words) // 4, len(words) * 3 // 4
    cut = max(range(max(1, lo), max(lo + 1, hi)), key=lambda i: words[i]["start"] - words[i - 1]["end"])
    return _split_words(words[:cut]) + _split_words(words[cut:])


def recognize(path: str, on_progress: Callable[[float], None] | None = None,
              should_stop: Callable[[], bool] | None = None) -> list[dict[str, Any]]:
    from vosk import KaldiRecognizer

    rec = KaldiRecognizer(model.get(), SAMPLE_RATE)
    rec.SetWords(True)
    proc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-nostdin", "-i", path, "-vn", "-af", AUDIO_FILTER,
         "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    segments: list[dict[str, Any]] = []
    done_bytes, last = 0, 0.0

    def take(result: str) -> None:
        segments.extend(_split_words(json.loads(result).get("result", [])))

    try:
        assert proc.stdout
        while chunk := proc.stdout.read(SAMPLE_RATE):  # نیم ثانیه صدا
            if should_stop and should_stop():
                proc.kill()
                raise InterruptedError()
            done_bytes += len(chunk)
            if rec.AcceptWaveform(chunk):
                take(rec.Result())
            sec = done_bytes / (SAMPLE_RATE * 2)
            if on_progress and sec - last >= 5:
                last = sec
                on_progress(sec)
        take(rec.FinalResult())
    finally:
        code = proc.wait()
    if code != 0 and not segments:
        err = (proc.stderr.read() if proc.stderr else b"").decode("utf-8", "replace").strip()
        raise RuntimeError(err[-300:] or "فایل صوتی خوانده نشد")
    for s in segments:
        s["text"] = textnorm.fix_persian(s["text"], digits=True)
    return segments


# ───────────────────────── صف ─────────────────────────


def _row(conn, tid: int) -> dict[str, Any]:
    r = conn.execute("SELECT t.*, s.title AS story_name FROM transcripts t LEFT JOIN stories s ON s.id=t.story_id "
                     "WHERE t.id=?", (tid,)).fetchone()
    if not r:
        raise db.NotFound("متن پیدا نشد")
    d = dict(r)
    d["segments"] = json.loads(d["segments"] or "[]")
    d.pop("path", None)
    return d


def get(tid: int) -> dict[str, Any]:
    with db.connect() as conn:
        return _row(conn, tid)


def list_all() -> list[dict[str, Any]]:
    with db.connect() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT t.id, t.title, t.filename, t.size, t.duration, t.status, t.progress, t.error, t.story_id, t.created_at, "
            "t.segments, t.summary IS NOT NULL AND t.summary != '' AS has_summary, s.title AS story_name "
            "FROM transcripts t LEFT JOIN stories s ON s.id=t.story_id ORDER BY t.id DESC LIMIT 100")]
    for r in rows:
        segs = json.loads(r.pop("segments") or "[]")
        r["preview"] = " ".join(x["text"] for x in segs[:6])[:160]
        r["segments_count"] = len(segs)
    return rows


def audio_dir() -> Path:
    return settings.dir("audio")


def add(fileobj: BinaryIO, filename: str, title: str | None = None, story_id: int | None = None,
        source_chat: str | None = None) -> dict[str, Any]:
    ext = Path(filename).suffix.lower()
    if ext not in EXT:
        raise db.ValidationError(f"نوع فایل پشتیبانی نمی‌شود: {ext or filename}. مجاز: صوت (mp3، ogg، m4a، wav، …) یا ویدیو")
    tmp, size, _ = documents.save_upload(fileobj, audio_dir(), settings.max_upload_mb * 1024 * 1024)
    return _insert(tmp, size, filename, title, story_id, source_chat)


def add_from_document(doc_id: int) -> dict[str, Any]:
    d = documents.get_document(doc_id)
    if d["kind"] not in ("audio", "video"):
        raise db.ValidationError("این سند صوت یا ویدیو نیست")
    tmp = audio_dir() / f"doc{doc_id}.part"
    shutil.copy(d["path"], tmp)
    row = _insert(str(tmp), d["size"], d["filename"], d["title"], d["story_id"], None)
    with db.connect() as conn:
        conn.execute("UPDATE transcripts SET doc_id=? WHERE id=?", (doc_id, row["id"]))
    return get(row["id"])


def _insert(tmp: str, size: int, filename: str, title: str | None, story_id: int | None,
            source_chat: str | None) -> dict[str, Any]:
    try:
        now = db.now_str()
        with db.connect() as conn:
            if story_id and not conn.execute("SELECT 1 FROM stories WHERE id=?", (story_id,)).fetchone():
                story_id = None
            cur = conn.execute(
                "INSERT INTO transcripts (title, filename, path, size, status, story_id, source_chat, created_at, updated_at) "
                "VALUES (?, ?, '', ?, 'queued', ?, ?, ?, ?)",
                (title or Path(filename).stem, filename, size, story_id, source_chat, now, now),
            )
            tid = cur.lastrowid
            final = audio_dir() / f"{tid}_{documents.safe_name(filename)}"
            os.replace(tmp, final)
            conn.execute("UPDATE transcripts SET path=?, duration=? WHERE id=?", (str(final), probe_duration(str(final)), tid))
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    worker.wake()
    return get(tid)


def update(tid: int, data: dict[str, Any]) -> dict[str, Any]:
    get(tid)
    vals: dict[str, Any] = {}
    if "title" in data:
        vals["title"] = str(data["title"] or "").strip() or "بدون عنوان"
    if "segments" in data:
        segs = []
        for s in data["segments"] or []:
            try:
                segs.append({"start": float(s["start"]), "end": float(s["end"]), "text": str(s["text"]).strip()})
            except (KeyError, TypeError, ValueError):
                raise db.ValidationError("بخش‌های متن نامعتبر است") from None
        vals["segments"] = json.dumps(segs, ensure_ascii=False)
    if "summary" in data:
        vals["summary"] = str(data["summary"] or "")
    if "story_id" in data:
        vals["story_id"] = int(data["story_id"]) if data["story_id"] else None
    if vals:
        with db.connect() as conn:
            sets = ", ".join(f"{k}=?" for k in vals)
            conn.execute(f"UPDATE transcripts SET {sets}, updated_at=? WHERE id=?", [*vals.values(), db.now_str(), tid])
    return get(tid)


def delete(tid: int) -> None:
    worker.cancel(tid)
    with db.connect() as conn:
        r = conn.execute("SELECT path FROM transcripts WHERE id=?", (tid,)).fetchone()
        if not r:
            raise db.NotFound("متن پیدا نشد")
        conn.execute("DELETE FROM transcripts WHERE id=?", (tid,))
    if r["path"] and os.path.exists(r["path"]):
        os.unlink(r["path"])


def audio_path(tid: int) -> tuple[str, str]:
    with db.connect() as conn:
        r = conn.execute("SELECT path, filename FROM transcripts WHERE id=?", (tid,)).fetchone()
    if not r or not r["path"] or not os.path.exists(r["path"]):
        raise db.NotFound("فایل صوتی پیدا نشد")
    return r["path"], r["filename"]


def retry(tid: int) -> None:
    with db.connect() as conn:
        conn.execute("UPDATE transcripts SET status='queued', progress=0, error=NULL WHERE id=? AND status IN ('error','cancelled')",
                     (tid,))
    worker.wake()


# ───────────────────────── خروجی‌ها و خلاصه ─────────────────────────


def ts(sec: float, srt: bool = False) -> str:
    ms = int(round(sec * 1000))
    h, m, s = ms // 3600000, ms // 60000 % 60, ms // 1000 % 60
    if srt:
        return f"{h:02d}:{m:02d}:{s:02d},{ms % 1000:03d}"
    return f"{h:d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def plain_text(segs: list[dict[str, Any]], with_times: bool) -> str:
    if with_times:
        return "\n".join(f"[{ts(s['start'])}] {s['text']}" for s in segs if s["text"])
    # بدون زمان: بخش‌های پشت‌سرهم در یک پاراگراف، با مکث بلند (بیش از ۲ ثانیه) پاراگراف جدید
    paras, cur, prev_end = [], [], None
    for s in segs:
        if not s["text"]:
            continue
        if prev_end is not None and s["start"] - prev_end > 2 and cur:
            paras.append(" ".join(cur))
            cur = []
        cur.append(s["text"])
        prev_end = s["end"]
    if cur:
        paras.append(" ".join(cur))
    return "\n\n".join(paras)


def srt_text(segs: list[dict[str, Any]]) -> str:
    return "\n".join(f"{i}\n{ts(s['start'], True)} --> {ts(s['end'], True)}\n{s['text']}\n"
                     for i, s in enumerate((s for s in segs if s["text"]), 1))


def docx_bytes(title: str, segs: list[dict[str, Any]], with_times: bool, summary: str | None = None) -> bytes:
    from . import export

    sections = [("خلاصه", summary.split("\n"))] if summary else None
    return export.docx_bytes(title, plain_text(segs, with_times).split("\n"), sections)


def summarize(tid: int, n: int = 5) -> dict[str, Any]:
    from . import ai

    t = get(tid)
    text = plain_text(t["segments"], False)
    if not text.strip():
        raise db.ValidationError("متنی برای خلاصه کردن نیست")
    if ai.provider():
        res = ai.run("summary", text, n)
        lines = res["lines"]
    else:
        # بدون نشانه‌گذاری، هر بخش یک «جمله» حساب می‌شود
        sentences = ". ".join(s["text"] for s in t["segments"] if s["text"]) + "."
        lines = textnorm.extractive_summary(sentences, n)
        res = {"mode": "fallback"}
    summary = "\n".join(f"• {ln.rstrip('.')}" for ln in lines)
    update(tid, {"summary": summary})
    return {"summary": summary, "mode": res.get("mode"), "keywords": textnorm.keywords(text, 10)}


def save_to_archive(tid: int, with_times: bool = True) -> dict[str, Any]:
    t = get(tid)
    body = plain_text(t["segments"], with_times)
    if t.get("summary"):
        body = f"خلاصه:\n{t['summary']}\n\nمتن کامل:\n{body}"
    raw = f"{t['title']}\n\n{body}".encode("utf-8")
    return documents.add_document(io.BytesIO(raw), f"{documents.safe_name(t['title'])}.txt", title=f"متن: {t['title']}",
                                  category="interview", tags="متن پیاده‌شده", story_id=t.get("story_id"))


# ───────────────────────── پردازشگر پس‌زمینه ─────────────────────────


class Worker:
    def __init__(self) -> None:
        self._event = threading.Event()
        self._thread: threading.Thread | None = None
        self._cancel: set[int] = set()
        self._current: int | None = None
        self.stopping = False

    def wake(self) -> None:
        self._event.set()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        with db.connect() as conn:
            conn.execute("UPDATE transcripts SET status='queued' WHERE status='processing'")
        self.stopping = False
        self._thread = threading.Thread(target=self._run, name="asr-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self.stopping = True
        self._event.set()

    def cancel(self, tid: int) -> None:
        self._cancel.add(tid)
        with db.connect() as conn:
            conn.execute("UPDATE transcripts SET status='cancelled' WHERE id=? AND status='queued'", (tid,))

    def _set(self, tid: int, **vals: Any) -> None:
        with db.connect() as conn:
            sets = ", ".join(f"{k}=?" for k in vals)
            conn.execute(f"UPDATE transcripts SET {sets}, updated_at=? WHERE id=?", [*vals.values(), db.now_str(), tid])

    def process(self, tid: int) -> None:
        with db.connect() as conn:
            r = dict(conn.execute("SELECT * FROM transcripts WHERE id=?", (tid,)).fetchone())
        self._current = tid
        self._set(tid, status="processing", progress=0.01, error=None)
        dur = r["duration"] or 0
        try:
            segs = recognize(
                r["path"],
                on_progress=lambda sec: self._set(tid, progress=round(min(0.99, sec / dur), 3)) if dur else None,
                should_stop=lambda: tid in self._cancel or self.stopping,
            )
            self._set(tid, status="done", progress=1, segments=json.dumps(segs, ensure_ascii=False))
            text = plain_text(segs, False)
            with db.connect() as conn:
                notify.add(conn, "transcript", f"🎙️ متن «{r['title']}» آماده است",
                           text[:300] + ("…" if len(text) > 300 else ""), link=f"#transcribe?id={tid}",
                           dedup=f"asr:{tid}:{db.now_str()}")
            if r.get("source_chat") and notify.bot:
                try:
                    notify.bot.send(r["source_chat"], f"🎙️ متن پیاده‌شده:\n\n{plain_text(segs, True) or '(متنی تشخیص داده نشد)'}")
                except Exception:
                    log.exception("ارسال متن به بله ناموفق بود")
        except InterruptedError:
            self._set(tid, status="cancelled" if tid in self._cancel else "queued", progress=0)
        except Exception as e:
            log.exception("تبدیل صوت %s ناموفق بود", tid)
            self._set(tid, status="error", error=str(e)[:500])
        finally:
            self._current = None
            self._cancel.discard(tid)

    def _more_queued(self) -> bool:
        with db.connect() as conn:
            return conn.execute("SELECT 1 FROM transcripts WHERE status='queued' LIMIT 1").fetchone() is not None

    def run_pending(self) -> int:
        n = 0
        while not self.stopping:
            with db.connect() as conn:
                row = conn.execute("SELECT id FROM transcripts WHERE status='queued' ORDER BY id LIMIT 1").fetchone()
            if not row:
                break
            if model_path() is None:
                try:
                    download_model()
                except Exception as e:
                    log.warning("دانلود مدل گفتار ناموفق: %s", e)
                    with db.connect() as conn:
                        conn.execute("UPDATE transcripts SET status='error', error=? WHERE status='queued'",
                                     ("مدل تبدیل گفتار فارسی نصب نیست. از بخش تنظیمات آن را نصب کنید.",))
                    break
            with documents.HEAVY:
                self.process(row["id"])
                n += 1
                if not self._more_queued():
                    model.release()  # آزاد کردن حافظه پیش از کار سنگین بعدی (مثلاً ساخت ویدیو)
        model.release()  # آزاد کردن حافظه وقتی کاری نیست
        return n

    def _run(self) -> None:
        # اولین اجرا روی سرور: دانلود مدل در پس‌زمینه (فقط یک بار؛ روی دیسک داده‌ها می‌ماند)
        if model_path() is None and vosk_installed() and not os.getenv("ZOZO_NO_ASR_DOWNLOAD"):
            try:
                download_model()
                log.info("مدل تبدیل گفتار فارسی دانلود و نصب شد")
            except Exception as e:
                log.warning("دانلود خودکار مدل گفتار ناموفق بود؛ از بخش «صوت به متن» قابل نصب است: %s", e)
        while not self.stopping:
            try:
                self.run_pending()
            except Exception:
                log.exception("خطای صف تبدیل صوت")
            self._event.wait(30)
            self._event.clear()


worker = Worker()


# ───────────────────────── زیرنویس خودکار ریلز ─────────────────────────


def words_in(path: str, start: float = 0, duration: float | None = None) -> list[dict[str, Any]]:
    """واژه‌های گفته‌شده در یک تکه از فایل با زمان دقیق هر واژه (ثانیه، نسبت به آغاز تکه)."""
    from vosk import KaldiRecognizer

    rec = KaldiRecognizer(model.get(), SAMPLE_RATE)
    rec.SetWords(True)
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-ss", f"{max(0.0, start):.2f}"]
    if duration:
        cmd += ["-t", f"{duration:.2f}"]
    cmd += ["-i", path, "-vn", "-af", AUDIO_FILTER, "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    words: list[dict[str, Any]] = []
    try:
        assert proc.stdout
        while chunk := proc.stdout.read(SAMPLE_RATE * 2):
            if rec.AcceptWaveform(chunk):
                words += json.loads(rec.Result()).get("result", [])
        words += json.loads(rec.FinalResult()).get("result", [])
    finally:
        proc.wait()
    return [{"word": textnorm.fix_persian(w["word"], digits=True), "start": w["start"], "end": w["end"]} for w in words]


def group_words(words: list[dict[str, Any]], max_words: int = 7, max_sec: float = 3.2) -> list[dict[str, Any]]:
    """واژه‌ها ← زیرنویس‌های کوتاه؛ شکستن در مکث‌ها، یا وقتی سطر زیادی بلند شد."""
    caps: list[dict[str, Any]] = []
    cur: list[dict[str, Any]] = []
    for w in words:
        if cur and (w["start"] - cur[-1]["end"] > 0.55 or len(cur) >= max_words or w["end"] - cur[0]["start"] > max_sec):
            caps.append(cur)
            cur = []
        cur.append(w)
    if cur:
        caps.append(cur)
    out = []
    for i, c in enumerate(caps):
        end = c[-1]["end"] + 0.25
        if i + 1 < len(caps):
            end = min(end, caps[i + 1][0]["start"] - 0.02)
        out.append({"text": " ".join(w["word"] for w in c), "start": round(c[0]["start"], 2), "end": round(end, 2)})
    return out


def align_lines(lines: list[str], words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """زیرنویس‌هایی که کاربر خودش نوشته ← زمان واقعی گفتنشان (به نسبت شمار واژه‌ها روی واژه‌های شنیده‌شده)."""
    if not words:
        return []
    counts = [max(1, len(line.split())) for line in lines]
    total, n = sum(counts), len(words)
    out, acc = [], 0
    for line, c in zip(lines, counts):
        i0 = min(n - 1, round(acc * n / total))
        acc += c
        i1 = max(i0, min(n - 1, round(acc * n / total) - 1))
        out.append({"text": line, "start": round(words[i0]["start"], 2), "end": round(words[i1]["end"] + 0.2, 2)})
    for a, b in zip(out, out[1:]):
        a["end"] = min(a["end"], b["start"] - 0.02)
    return out


def auto_captions(clips: list[dict[str, Any]], offset: float = 0, lines: list[str] | None = None) -> dict[str, Any]:
    """صدای تکه‌های ویدیو (به ترتیب تیزر) ← زیرنویس زمان‌بندی‌شده روی خط زمان تیزر."""
    from . import teaser

    if model_path() is None:
        raise db.ValidationError("مدل تبدیل گفتار به متن هنوز آماده نیست؛ از بخش «صوت به متن» وضعیتش را ببینید.")
    words: list[dict[str, Any]] = []
    t = float(offset or 0)
    with documents.HEAVY:
        for c in clips:
            dur = max(0.3, float(c.get("duration") or 0))
            if c.get("media_id"):
                m = teaser.get_media(int(c["media_id"]))
                if m["kind"] == "video" and m.get("has_audio"):
                    for w in words_in(m["path"], float(c.get("start") or 0), dur):
                        if w["start"] < dur:
                            words.append({**w, "start": w["start"] + t, "end": min(w["end"], dur) + t})
            t += dur
    if not words:
        return {"captions": [], "words": 0}
    clean = [x.strip() for x in (lines or []) if x.strip()]
    caps = align_lines(clean, words) if clean else group_words(words)
    return {"captions": caps, "words": len(words), "aligned": bool(clean)}


def media_text(media_id: int, start: float = 0, duration: float | None = None) -> dict[str, Any]:
    """متن گفتار یک فایل صوتی یا ویدیویی (برای ساختن لید از صدای خود ویدیو یا فایل صوتی)."""
    from . import teaser

    if model_path() is None:
        raise db.ValidationError("مدل تبدیل گفتار به متن هنوز آماده نیست؛ از بخش «صوت به متن» وضعیتش را ببینید.")
    m = teaser.get_media(int(media_id))
    if m["kind"] not in ("audio", "video") or (m["kind"] == "video" and not m.get("has_audio")):
        raise db.ValidationError("این فایل صدا ندارد")
    dur = float(duration) if duration else None
    with documents.HEAVY:
        words = words_in(m["path"], float(start or 0), dur)
    return {"text": " ".join(w["word"] for w in words).strip(), "words": len(words)}
