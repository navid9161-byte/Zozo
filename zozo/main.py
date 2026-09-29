"""وب‌سرور زوزو: API برنامه‌ی وب + کارهای پس‌زمینه (یادآوری، رصد خبر، پردازش اسناد، ساخت تیزر، ربات بله).

اجرا:  uvicorn zozo.main:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import tempfile
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.background import BackgroundTask

from . import __version__, ai, auth, db, documents, feeds, jalali, notify, scheduler, services, teaser, textnorm, transcribe
from .config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("zozo")

STATIC = Path(__file__).parent / "static"
FONT_DIRS = [Path(os.getenv("ZOZO_FONT_DIR", "/usr/share/fonts/truetype/vazirmatn")), STATIC / "fonts"]
PUBLIC_API = {"/api/login", "/api/auth", "/api/logout"}


@asynccontextmanager
async def lifespan(_: FastAPI):
    with db.connect():
        pass  # ساخت جدول‌ها
    background = not os.getenv("ZOZO_NO_BACKGROUND")
    if background:
        documents.worker.start()
        teaser.renderer.start()
        transcribe.worker.start()
        scheduler.start()
        notify.start_bot()
    if not auth.enabled():
        log.warning("⚠️ رمز عبور (ZOZO_PASSWORD) تنظیم نشده؛ برنامه بدون رمز در دسترس است!")
    yield
    if background:
        scheduler.stop()
        documents.worker.stop()
        teaser.renderer.stop()
        transcribe.worker.stop()
        if notify.bot:
            notify.bot.stop()


app = FastAPI(title="Zozo", lifespan=lifespan, docs_url=None, redoc_url=None)


@app.middleware("http")
async def require_login(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and path not in PUBLIC_API and not auth.check_token(request.cookies.get(auth.COOKIE)):
        return JSONResponse({"detail": "نیاز به ورود", "login": True}, status_code=401)
    response = await call_next(request)
    if path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.exception_handler(db.ValidationError)
async def _validation(_: Request, e: db.ValidationError):
    return JSONResponse({"detail": str(e)}, status_code=400)


@app.exception_handler(db.NotFound)
async def _not_found(_: Request, e: db.NotFound):
    return JSONResponse({"detail": str(e)}, status_code=404)


# ───────────────────────── صفحات و فایل‌های ثابت ─────────────────────────


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/sw.js", include_in_schema=False)
def service_worker():
    return FileResponse(STATIC / "sw.js", media_type="application/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/manifest.webmanifest", include_in_schema=False)
def manifest():
    return JSONResponse({
        "name": settings.app_name, "short_name": settings.app_name, "lang": "fa", "dir": "rtl",
        "start_url": "/", "display": "standalone", "background_color": "#f3f5f8", "theme_color": "#193153",
        "icons": [{"src": "/static/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any"}],
    }, media_type="application/manifest+json")


@app.get("/fonts/{name}", include_in_schema=False)
def fonts(name: str):
    if "/" in name or ".." in name or not name.lower().endswith((".ttf", ".woff2", ".woff")):
        raise HTTPException(404)
    for d in FONT_DIRS:
        p = d / name
        if p.is_file():
            return FileResponse(p, headers={"Cache-Control": "public, max-age=2592000"})
    raise HTTPException(404)


@app.get("/healthz", include_in_schema=False)
def health():
    return {"ok": True, "version": __version__}


app.mount("/static", StaticFiles(directory=STATIC), name="static")


# ───────────────────────── ورود ─────────────────────────


class LoginIn(BaseModel):
    password: str


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() or (request.client.host if request.client else "?")


@app.get("/api/auth")
def auth_status(request: Request):
    return {"enabled": auth.enabled(), "ok": auth.check_token(request.cookies.get(auth.COOKIE)),
            "app_name": settings.app_name}


@app.post("/api/login")
def login(body: LoginIn, request: Request):
    ip = _client_ip(request)
    if not auth.enabled():
        return {"ok": True}
    wait = auth.locked(ip)
    if wait:
        raise HTTPException(429, f"تلاش‌های ناموفق زیاد بود. {wait // 60 + 1} دقیقه‌ی دیگر امتحان کنید.")
    if not auth.check_password(ip, body.password):
        raise HTTPException(401, "رمز عبور درست نیست")
    resp = JSONResponse({"ok": True})
    secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    resp.set_cookie(auth.COOKIE, auth.make_token(), max_age=auth.MAX_AGE, httponly=True, samesite="lax", secure=secure)
    return resp


@app.post("/api/logout")
def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.COOKIE)
    return resp


# ───────────────────────── عمومی ─────────────────────────


@app.get("/api/meta")
def meta():
    today = db.today_str()
    return {
        "version": __version__,
        "app_name": settings.app_name,
        "owner": settings.owner_name,
        "today": today,
        "today_long": jalali.long_format(jalali.parse(today)),
        "now": db.now_str(),
        "currency": settings.currency,
        "schema": db.schema(),
        "doc_categories": documents.CATEGORIES,
        "ai": ai.provider(),
        "ffmpeg": teaser.available(),
        "ocr": documents.ocr_available(),
        "asr": transcribe.status(),
        "notify": notify.status(),
        "password_set": auth.enabled(),
        "max_upload_mb": settings.max_upload_mb,
        "teaser_sizes": {k: v["720"] for k, v in teaser.SIZES.items()},
    }


@app.get("/api/dashboard")
def dashboard():
    with db.connect() as conn:
        return services.dashboard(conn)


@app.get("/api/brief")
def brief():
    with db.connect() as conn:
        return {"text": services.daily_brief_text(conn)}


@app.get("/api/finance")
def finance(month: str | None = None):
    with db.connect() as conn:
        return services.finance_summary(conn, _month(month))


@app.get("/api/finance/csv")
def finance_csv(month: str | None = None):
    month = _month(month) or jalali.month_key(db.today_str())
    with db.connect() as conn:
        data = services.export_month_csv(conn, month)
    return Response(data.encode("utf-8"), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="finance-{month.replace("/", "-")}.csv"'})


@app.get("/api/calendar")
def calendar(month: str | None = None):
    with db.connect() as conn:
        return services.calendar(conn, _month(month) or jalali.month_key(db.today_str()))


def _month(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return jalali.normalize(value.replace("-", "/")[:7] + "/01")[:7]
    except ValueError:
        raise HTTPException(400, "ماه نامعتبر است") from None


@app.get("/api/search")
def search(q: str = ""):
    with db.connect() as conn:
        return services.global_search(conn, q)


# ───────────────────────── اعلان‌ها ─────────────────────────


@app.get("/api/notifications")
def notifications(since: int = 0):
    return notify.list_notifications(since)


class IdsIn(BaseModel):
    ids: list[int] | None = None


@app.post("/api/notifications/read")
def notifications_read(body: IdsIn):
    notify.mark_read(body.ids)
    return {"ok": True}


# ───────────────────────── ابزارهای نوشتن و هوش مصنوعی ─────────────────────────


class TextIn(BaseModel):
    text: str
    n: int = 3
    digits: bool = True


@app.post("/api/tools/fix")
def tools_fix(body: TextIn):
    return {"text": textnorm.fix_persian(body.text, digits=body.digits)}


@app.post("/api/tools/analyze")
def tools_analyze(body: TextIn):
    return {"stats": textnorm.text_stats(body.text), "keywords": textnorm.keywords(body.text, 12),
            "summary": textnorm.extractive_summary(body.text, max(1, min(body.n, 8)))}


class DocxIn(BaseModel):
    title: str = "متن"
    text: str
    summary: str | None = None


@app.post("/api/tools/docx")
def tools_docx(body: DocxIn):
    from . import export

    sections = [("خلاصه", body.summary.split("\n"))] if body.summary else None
    data = export.docx_bytes(body.title, body.text.split("\n"), sections)
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": _cd(f"{documents.safe_name(body.title)[:60] or 'text'}.docx")})


@app.post("/api/ai/{task}")
def ai_task(task: str, body: TextIn):
    if task not in ai.TASKS:
        raise HTTPException(404, "کار ناشناخته")
    return ai.run(task, body.text, max(1, min(body.n, 10)))


# ───────────────────────── بایگانی اسناد ─────────────────────────


@app.get("/api/documents")
def documents_list(category: str | None = None, story_id: int | None = None, tag: str | None = None):
    return {"documents": documents.list_documents(category, story_id, tag), "stats": documents.stats()}


@app.get("/api/documents/search")
def documents_search(q: str = "", category: str | None = None):
    return documents.search(q, category=category or None, limit=20)


@app.post("/api/documents", status_code=201)
def documents_upload(
    files: list[UploadFile] = File(...),
    title: str | None = Form(None),
    category: str | None = Form(None),
    tags: str | None = Form(None),
    notes: str | None = Form(None),
    story_id: int | None = Form(None),
    doc_date: str | None = Form(None),
):
    added, errors = [], []
    for f in files:
        try:
            added.append(documents.add_document(
                f.file, f.filename or "file", title=(title if len(files) == 1 else None) or None,
                category=category or None, tags=tags or None, notes=notes or None, story_id=story_id,
                doc_date=doc_date or None))
        except db.ValidationError as e:
            errors.append(f"{f.filename}: {e}")
        finally:
            f.file.close()
    if errors and not added:
        raise HTTPException(400, " | ".join(errors))
    return {"added": added, "errors": errors}


@app.patch("/api/documents/{doc_id}")
def documents_update(doc_id: int, data: dict[str, Any]):
    return documents.update_meta(doc_id, data)


@app.delete("/api/documents/{doc_id}")
def documents_delete(doc_id: int):
    documents.delete_document(doc_id)
    return {"ok": True}


@app.post("/api/documents/{doc_id}/reprocess")
def documents_reprocess(doc_id: int):
    documents.get_document(doc_id)
    documents.reprocess(doc_id)
    return {"ok": True}


@app.get("/api/documents/{doc_id}/file")
def documents_file(doc_id: int, download: bool = False):
    d = documents.get_document(doc_id)
    return FileResponse(d["path"], filename=d["filename"], content_disposition_type="attachment" if download else "inline")


@app.get("/api/documents/{doc_id}/pages")
def documents_pages(doc_id: int):
    d = documents.get_document(doc_id)
    return {"document": d, "pages": documents.page_texts(doc_id) if d["status"] == "ready" else []}


@app.get("/api/documents/{doc_id}/text")
def documents_text(doc_id: int):
    documents.get_document(doc_id)
    return {"text": documents.document_text(doc_id)}


@app.get("/api/documents/{doc_id}/page/{page}.png")
def documents_page(doc_id: int, page: int):
    return Response(documents.render_page_png(doc_id, page), media_type="image/png",
                    headers={"Cache-Control": "private, max-age=86400"})


# ───────────────────────── رصد خبر ─────────────────────────

_refreshing = threading.Lock()


@app.get("/api/news")
def news(q: str = "", feed_id: int | None = None, matched: bool = False, starred: bool = False, offset: int = 0):
    data = feeds.list_items(q or None, feed_id, matched, starred, limit=60, offset=offset)
    data["refreshing"] = _refreshing.locked()
    return data


@app.post("/api/news/refresh")
def news_refresh():
    if _refreshing.locked():
        return {"started": False}

    def run():
        with _refreshing:
            try:
                feeds.fetch_all()
                notify.deliver_pending()
            except Exception:
                log.exception("دریافت خبرها ناموفق بود")

    threading.Thread(target=run, daemon=True).start()
    return {"started": True}


@app.post("/api/news/rematch")
def news_rematch():
    return {"changed": feeds.rematch_all()}


@app.post("/api/news/{item_id}/flag")
def news_flag(item_id: int, data: dict[str, Any]):
    feeds.set_flag(item_id, **{k: v for k, v in data.items() if k in ("starred", "is_read")})
    return {"ok": True}


@app.post("/api/news/{item_id}/story")
def news_to_story(item_id: int):
    return feeds.to_story(item_id)


# ───────────────────────── تیزرساز ─────────────────────────


@app.get("/api/media")
def media_list(kind: str | None = None):
    return teaser.list_media(kind)


@app.post("/api/media", status_code=201)
def media_upload(files: list[UploadFile] = File(...)):
    added, errors = [], []
    for f in files:
        try:
            added.append(teaser.add_media(f.file, f.filename or "file"))
        except db.ValidationError as e:
            errors.append(f"{f.filename}: {e}")
        finally:
            f.file.close()
    if errors and not added:
        raise HTTPException(400, " | ".join(errors))
    return {"added": added, "errors": errors}


@app.delete("/api/media/{mid}")
def media_delete(mid: int):
    teaser.delete_media(mid)
    return {"ok": True}


@app.get("/api/media/{mid}/file")
def media_file(mid: int):
    m = teaser.get_media(mid)
    return FileResponse(m["path"], filename=m["filename"], headers={"Cache-Control": "private, max-age=86400"})


@app.get("/api/media/{mid}/thumb")
def media_thumb(mid: int):
    m = teaser.get_media(mid)
    if not m["thumb"] or not os.path.exists(m["thumb"]):
        raise HTTPException(404)
    return FileResponse(m["thumb"], media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


@app.get("/api/teasers")
def teasers_list():
    return teaser.list_teasers()


@app.post("/api/teasers", status_code=201)
def teasers_create(spec: dict[str, Any]):
    return teaser.create_teaser(spec)


@app.get("/api/teasers/{tid}")
def teasers_get(tid: int):
    return teaser.get_teaser(tid)


@app.delete("/api/teasers/{tid}")
def teasers_delete(tid: int):
    teaser.delete_teaser(tid)
    return {"ok": True}


@app.post("/api/teasers/{tid}/cancel")
def teasers_cancel(tid: int):
    teaser.renderer.cancel(tid)
    return {"ok": True}


@app.post("/api/teasers/{tid}/retry")
def teasers_retry(tid: int):
    teaser.retry(tid)
    return {"ok": True}


@app.get("/api/teasers/{tid}/video")
def teasers_video(tid: int, download: bool = False):
    t = teaser.get_teaser(tid)
    name = f"{t['title'][:60]}.mp4".replace("/", "-")
    return FileResponse(teaser.teaser_file(tid), media_type="video/mp4", filename=name,
                        content_disposition_type="attachment" if download else "inline")


@app.get("/api/teasers/{tid}/thumb")
def teasers_thumb(tid: int):
    return FileResponse(teaser.teaser_file(tid, "thumb"), media_type="image/jpeg")


@app.get("/api/teasers/{tid}/srt")
def teasers_srt(tid: int):
    return PlainTextResponse(teaser.teaser_srt(tid), headers={"Content-Disposition": f'attachment; filename="teaser-{tid}.srt"'})


# ───────────────────────── تبدیل صوت به متن ─────────────────────────


@app.get("/api/transcripts")
def transcripts_list():
    return {"items": transcribe.list_all(), "status": transcribe.status()}


@app.post("/api/transcripts", status_code=201)
def transcripts_upload(files: list[UploadFile] = File(...), title: str | None = Form(None),
                       story_id: int | None = Form(None)):
    added, errors = [], []
    for f in files:
        try:
            added.append(transcribe.add(f.file, f.filename or "audio", title=(title if len(files) == 1 else None) or None,
                                        story_id=story_id))
        except db.ValidationError as e:
            errors.append(f"{f.filename}: {e}")
        finally:
            f.file.close()
    if errors and not added:
        raise HTTPException(400, " | ".join(errors))
    return {"added": added, "errors": errors}


@app.post("/api/transcripts/from-document/{doc_id}", status_code=201)
def transcripts_from_doc(doc_id: int):
    return transcribe.add_from_document(doc_id)


@app.get("/api/transcripts/{tid}")
def transcripts_get(tid: int):
    return transcribe.get(tid)


@app.patch("/api/transcripts/{tid}")
def transcripts_update(tid: int, data: dict[str, Any]):
    return transcribe.update(tid, data)


@app.delete("/api/transcripts/{tid}")
def transcripts_delete(tid: int):
    transcribe.delete(tid)
    return {"ok": True}


@app.post("/api/transcripts/{tid}/retry")
def transcripts_retry(tid: int):
    transcribe.retry(tid)
    return {"ok": True}


@app.post("/api/transcripts/{tid}/cancel")
def transcripts_cancel(tid: int):
    transcribe.worker.cancel(tid)
    return {"ok": True}


@app.get("/api/transcripts/{tid}/audio")
def transcripts_audio(tid: int):
    path, name = transcribe.audio_path(tid)
    return FileResponse(path, filename=name, content_disposition_type="inline")


@app.post("/api/transcripts/{tid}/summary")
def transcripts_summary(tid: int, n: int = 5):
    return transcribe.summarize(tid, max(1, min(n, 12)))


@app.post("/api/transcripts/{tid}/archive")
def transcripts_archive(tid: int, times: bool = True):
    return transcribe.save_to_archive(tid, times)


@app.get("/api/transcripts/{tid}/export")
def transcripts_export(tid: int, fmt: str = "txt", summary: bool = False):
    t = transcribe.get(tid)
    segs, base = t["segments"], documents.safe_name(t["title"])[:60] or "transcript"
    summ = t.get("summary") if summary else None
    if fmt == "docx":
        data = transcribe.docx_bytes(t["title"], segs, with_times=False, summary=summ)
        return Response(data, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        headers={"Content-Disposition": _cd(f"{base}.docx")})
    if fmt == "srt":
        return Response(transcribe.srt_text(segs).encode(), media_type="application/x-subrip",
                        headers={"Content-Disposition": _cd(f"{base}.srt")})
    text = transcribe.plain_text(segs, with_times=fmt == "txt_times")
    if summ:
        text = f"خلاصه:\n{summ}\n\nمتن کامل:\n{text}"
    return Response(("\ufeff" + text).encode("utf-8"), media_type="text/plain; charset=utf-8",
                    headers={"Content-Disposition": _cd(f"{base}.txt")})


def _cd(name: str) -> str:
    from urllib.parse import quote

    return f"attachment; filename=\"transcript{Path(name).suffix}\"; filename*=UTF-8''{quote(name)}"


@app.get("/api/asr/status")
def asr_status():
    return transcribe.status()


@app.post("/api/asr/download")
def asr_download():
    if transcribe.model_path():
        return {"ok": True, "already": True}

    def run():
        try:
            transcribe.download_model()
            transcribe.worker.wake()
        except Exception as e:
            log.warning("دانلود مدل گفتار ناموفق: %s", e)

    threading.Thread(target=run, daemon=True).start()
    return {"ok": True, "started": True}


@app.post("/api/asr/model")
def asr_model_upload(file: UploadFile = File(...)):
    try:
        transcribe.install_model_zip(file.file)
    finally:
        file.file.close()
    transcribe.worker.wake()
    return transcribe.status()


# ───────────────────────── تنظیمات ذخیره‌شده ─────────────────────────

PREF_KEYS = {"teaser_brand", "teaser_templates", "writing_templates", "ui"}


@app.get("/api/prefs/{key}")
def prefs_get(key: str):
    if key not in PREF_KEYS:
        raise HTTPException(404)
    with db.connect() as conn:
        raw = db.kv_get(conn, f"pref:{key}")
    return {"value": json.loads(raw) if raw else None}


@app.put("/api/prefs/{key}")
def prefs_put(key: str, data: dict[str, Any]):
    if key not in PREF_KEYS:
        raise HTTPException(404)
    raw = json.dumps(data.get("value"), ensure_ascii=False)
    if len(raw) > 2_000_000:
        raise HTTPException(400, "حجم تنظیمات زیاد است")
    with db.connect() as conn:
        db.kv_set(conn, f"pref:{key}", raw)
    return {"ok": True}


# ───────────────────────── پشتیبان ─────────────────────────


@app.get("/api/export")
def export_all():
    """پشتیبان خوانا از همه‌ی داده‌ها به صورت JSON (بدون فایل‌ها)."""
    with db.connect() as conn:
        data: dict[str, Any] = {name: db.list_records(conn, name, limit=1000000) for name in db.ENTITIES}
        data["documents"] = [dict(r) for r in conn.execute(
            "SELECT id, title, filename, kind, category, tags, notes, doc_date, story_id, created_at FROM documents")]
        data["starred_news"] = [dict(r) for r in conn.execute("SELECT * FROM feed_items WHERE starred=1")]
    stamp = db.today_str().replace("/", "-")
    return JSONResponse(data, headers={"Content-Disposition": f'attachment; filename="zozo-{stamp}.json"'})


@app.get("/api/backup.db")
def backup_db():
    """نسخه‌ی کامل پایگاه داده (قابل بازگردانی)."""
    fd, tmp = tempfile.mkstemp(suffix=".db", dir=settings.data_dir)
    os.close(fd)
    src = sqlite3.connect(str(settings.db_path))
    dst = sqlite3.connect(tmp)
    try:
        src.backup(dst)
    finally:
        src.close()
        dst.close()
    stamp = db.today_str().replace("/", "-")
    return FileResponse(tmp, filename=f"zozo-{stamp}.db", media_type="application/octet-stream",
                        background=BackgroundTask(os.unlink, tmp))


# ───────────────────────── CRUD عمومی برای همه‌ی موجودیت‌ها ─────────────────────────


def _entity(name: str) -> db.Entity:
    if name not in db.ENTITIES:
        raise HTTPException(404, "یافت نشد")
    return db.ENTITIES[name]


@app.get("/api/{entity}")
def list_entity(entity: str, request: Request, search: str | None = None, date_from: str | None = None,
                date_to: str | None = None, include_closed: bool = True, limit: int = 500):
    ent = _entity(entity)
    field_names = {f.name for f in ent.fields} | {"id"}
    filters: dict[str, Any] = {}
    for key, value in request.query_params.multi_items():
        if key in field_names and value != "":
            filters.setdefault(key, []).append(value)
    with db.connect() as conn:
        return db.list_records(conn, entity, filters=filters, search=search, date_from=date_from, date_to=date_to,
                               exclude_status=None if include_closed else ent.closed_statuses, limit=limit)


@app.post("/api/{entity}", status_code=201)
def create_entity(entity: str, data: dict[str, Any]):
    _entity(entity)
    with db.connect() as conn:
        rec = db.create(conn, entity, data)
    if entity == "keywords":
        threading.Thread(target=feeds.rematch_all, daemon=True).start()
    return rec


@app.get("/api/{entity}/{rec_id}")
def get_entity(entity: str, rec_id: int):
    _entity(entity)
    with db.connect() as conn:
        return db.get(conn, entity, rec_id)


@app.patch("/api/{entity}/{rec_id}")
def update_entity(entity: str, rec_id: int, data: dict[str, Any]):
    _entity(entity)
    with db.connect() as conn:
        rec = db.update(conn, entity, rec_id, data)
    if entity == "keywords":
        threading.Thread(target=feeds.rematch_all, daemon=True).start()
    return rec


@app.delete("/api/{entity}/{rec_id}")
def delete_entity(entity: str, rec_id: int):
    _entity(entity)
    with db.connect() as conn:
        db.delete(conn, entity, rec_id)
    if entity == "keywords":
        threading.Thread(target=feeds.rematch_all, daemon=True).start()
    return {"ok": True}
