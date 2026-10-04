"""لایه‌ی داده: تعریف موجودیت‌ها و عملیات عمومی ایجاد/ویرایش/جستجو روی SQLite. برگرفته از CivilDesk.

هر موجودیت (سوژه، رسانه، یادآوری، ...) یک بار در ENTITIES تعریف می‌شود؛
جدول پایگاه داده، فرم‌های وب و (در آینده) ابزارهای دستیار هوشمند همه از همین تعریف ساخته می‌شوند.
"""
from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

from . import jalali
from .config import settings


@dataclass(frozen=True)
class Field:
    name: str
    label: str
    # text | longtext | int | money | percent | date | datetime | time | choice | ref | url | phone | tags
    type: str = "text"
    required: bool = False
    choices: dict[str, str] = field(default_factory=dict)  # کلید → برچسب فارسی
    default: Any = None
    help: str = ""
    system: bool = False  # فقط‌خواندنی؛ در فرم نمی‌آید
    ref: str = ""  # برای نوع ref: نام موجودیت مقصد
    suggest: tuple[str, ...] = ()  # پیشنهادهای ورودی متنی
    list_hidden: bool = False  # در فرم «پیشرفته» (جمع‌شده) نمایش داده شود

    @property
    def sql_type(self) -> str:
        return "INTEGER" if self.type in ("int", "money", "percent", "ref") else "TEXT"

    @property
    def join_alias(self) -> str:
        return self.name[:-3] + "_name" if self.name.endswith("_id") else self.name + "_name"


@dataclass(frozen=True)
class Entity:
    name: str
    label: str
    label_plural: str
    fields: tuple[Field, ...]
    title_field: str
    date_field: str | None = None
    order_by: str = "id DESC"
    search_fields: tuple[str, ...] = ()
    closed_statuses: tuple[str, ...] = ()
    icon: str = ""

    def field(self, name: str) -> Field:
        for f in self.fields:
            if f.name == name:
                return f
        raise KeyError(name)

    @property
    def editable(self) -> list[Field]:
        return [f for f in self.fields if not f.system]

    @property
    def refs(self) -> list[Field]:
        return [f for f in self.fields if f.type == "ref"]


PRIORITY = {"urgent": "فوری", "high": "زیاد", "medium": "معمولی", "low": "کم"}
YESNO = {"yes": "بله", "no": "خیر"}

STORY_STATUS = {
    "idea": "ایده",
    "research": "پیگیری و تحقیق",
    "writing": "در حال نوشتن / ساخت",
    "editing": "ویرایش",
    "submitted": "تحویل‌شده",
    "published": "منتشرشده",
    "cancelled": "لغو / رد شد",
}
STORY_KIND = {
    "news": "خبر", "report": "گزارش", "interview": "مصاحبه", "teaser": "تیزر / ویدیو",
    "column": "یادداشت / ستون", "photo": "عکس", "translation": "ترجمه", "podcast": "پادکست", "other": "سایر",
}
INCOME_CATEGORIES = ("حقوق", "دستمزد کار", "صورتحساب", "قرارداد", "پاداش", "تدریس / کارگاه", "سایر درآمد")
EXPENSE_CATEGORIES = (
    "ایاب‌وذهاب", "اینترنت و تلفن", "تجهیزات", "اشتراک و نرم‌افزار", "کتاب و نشریه",
    "غذا و پذیرایی", "آموزش", "مالیات و بیمه", "سایر هزینه",
)

ENTITIES: dict[str, Entity] = {
    e.name: e
    for e in [
        Entity(
            name="outlets",
            label="رسانه",
            label_plural="رسانه‌ها و کارفرماها",
            icon="🏢",
            title_field="name",
            order_by="CASE active WHEN 'no' THEN 1 ELSE 0 END, name",
            search_fields=("name", "editor_name", "notes"),
            fields=(
                Field("name", "نام رسانه / کارفرما", required=True),
                Field("kind", "نوع", "choice", default="news_agency", choices={
                    "news_agency": "خبرگزاری", "newspaper": "روزنامه", "website": "پایگاه خبری",
                    "tv": "تلویزیون / رادیو", "magazine": "مجله / هفته‌نامه", "social": "شبکه‌ی اجتماعی",
                    "other": "سایر",
                }),
                Field("pay_type", "نوع همکاری مالی", "choice", default="per_item", choices={
                    "salary": "حقوق ثابت ماهانه", "per_item": "دستمزد هر کار", "contract": "قراردادی",
                    "mixed": "ترکیبی", "none": "بدون دستمزد",
                }),
                Field("monthly_salary", "حقوق ماهانه", "money", help="اگر حقوق ثابت دارید"),
                Field("pay_day", "روز واریز حقوق در ماه", "int", help="مثلاً ۲۵"),
                Field("default_fee", "دستمزد معمول هر کار", "money"),
                Field("editor_name", "دبیر / رابط"),
                Field("phone", "تلفن", "phone"),
                Field("email", "ایمیل"),
                Field("active", "همکاری فعال", "choice", default="yes", choices=YESNO),
                Field("notes", "توضیحات", "longtext"),
            ),
        ),
        Entity(
            name="stories",
            label="سوژه",
            label_plural="سوژه‌ها و کارها",
            icon="📝",
            title_field="title",
            date_field="deadline",
            closed_statuses=("published", "cancelled"),
            order_by=(
                "CASE status WHEN 'writing' THEN 0 WHEN 'editing' THEN 1 WHEN 'research' THEN 2 WHEN 'idea' THEN 3 "
                "WHEN 'submitted' THEN 4 WHEN 'published' THEN 5 ELSE 6 END, "
                "CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline, deadline_time, "
                "CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, id DESC"
            ),
            search_fields=("title", "body", "notes", "beat", "tags", "source_url"),
            fields=(
                Field("title", "عنوان سوژه", required=True),
                Field("kind", "نوع کار", "choice", default="news", choices=STORY_KIND),
                Field("status", "وضعیت", "choice", default="idea", choices=STORY_STATUS),
                Field("outlet_id", "برای رسانه", "ref", ref="outlets"),
                Field("priority", "اولویت", "choice", default="medium", choices=PRIORITY),
                Field("deadline", "مهلت تحویل", "date"),
                Field("deadline_time", "ساعت تحویل", "time", help="مثلاً 14:00"),
                Field("remind_at", "یادآوری در", "datetime", help="خالی بماند: صبح روز مهلت خودکار یادآوری می‌شود"),
                Field("beat", "حوزه / سرویس", suggest=(
                    "سیاسی", "اقتصادی", "اجتماعی", "فرهنگی", "ورزشی", "بین‌الملل", "علمی", "شهری", "حوادث", "سلامت",
                )),
                Field("contact_id", "منبع اصلی", "ref", ref="contacts"),
                Field("source_url", "لینک سرنخ / منبع", "url"),
                Field("notes", "یادداشت پیگیری", "longtext", help="سؤال‌ها، افرادی که باید تماس گرفت، ..."),
                Field("body", "متن / پیش‌نویس", "longtext"),
                Field("tags", "برچسب‌ها", "tags", help="با ویرگول جدا کنید"),
                Field("published_date", "تاریخ انتشار", "date", list_hidden=True),
                Field("published_url", "لینک انتشار", "url", list_hidden=True),
                Field("fee", "دستمزد این کار", "money", list_hidden=True),
                Field("paid_amount", "مبلغ دریافت‌شده", "money", list_hidden=True,
                      help="با افزایش این مبلغ، دریافتی خودکار در بخش مالی ثبت می‌شود"),
                Field("pay_status", "وضعیت دستمزد", "choice", default="none", list_hidden=True, choices={
                    "none": "دستمزد جداگانه ندارد", "unpaid": "دریافت نشده", "partial": "بخشی دریافت شده",
                    "paid": "کامل دریافت شده",
                }),
                Field("reminded", "یادآوری ارسال شد", system=True),
                Field("completed_at", "زمان انتشار/تحویل", "datetime", system=True),
            ),
        ),
        Entity(
            name="reminders",
            label="یادآوری",
            label_plural="یادآوری‌ها",
            icon="⏰",
            title_field="title",
            date_field="remind_at",
            closed_statuses=("done", "sent"),
            order_by="CASE status WHEN 'active' THEN 0 ELSE 1 END, remind_at, id DESC",
            search_fields=("title", "notes"),
            fields=(
                Field("title", "چه چیزی یادم بیاید؟", required=True),
                Field("remind_at", "زمان", "datetime", required=True, help="مثلاً 1405/07/12 09:30"),
                Field("repeat", "تکرار", "choice", default="none", choices={
                    "none": "یک بار", "daily": "هر روز", "weekly": "هر هفته", "monthly": "هر ماه", "yearly": "هر سال",
                }),
                Field("story_id", "مربوط به سوژه", "ref", ref="stories"),
                Field("status", "وضعیت", "choice", default="active", choices={
                    "active": "فعال", "sent": "یادآوری شد", "done": "انجام شد",
                }),
                Field("notes", "توضیح", "longtext"),
                Field("last_sent", "آخرین ارسال", "datetime", system=True),
            ),
        ),
        Entity(
            name="contacts",
            label="منبع / مخاطب",
            label_plural="منابع و مخاطبین",
            icon="👥",
            title_field="name",
            order_by="name",
            search_fields=("name", "organization", "role", "beat", "phone", "phone2", "email", "social", "tags", "notes"),
            fields=(
                Field("name", "نام", required=True),
                Field("organization", "سازمان / نهاد"),
                Field("role", "سمت"),
                Field("beat", "حوزه‌ی تخصص"),
                Field("phone", "تلفن همراه", "phone"),
                Field("phone2", "تلفن دوم / دفتر", "phone"),
                Field("email", "ایمیل"),
                Field("social", "شناسه در پیام‌رسان", help="بله، ایتا، تلگرام، ..."),
                Field("reliability", "اعتبار منبع", "choice", default="unknown", choices={
                    "high": "بسیار معتبر", "medium": "معتبر", "low": "نیاز به راستی‌آزمایی", "unknown": "نامشخص",
                }),
                Field("last_contact", "آخرین تماس", "date"),
                Field("tags", "برچسب‌ها", "tags"),
                Field("notes", "یادداشت (سابقه‌ی تماس، بهترین زمان تماس، ...)", "longtext"),
            ),
        ),
        Entity(
            name="contracts",
            label="قرارداد",
            label_plural="قراردادها",
            icon="📑",
            title_field="title",
            date_field="start_date",
            closed_statuses=("done", "cancelled"),
            order_by="CASE status WHEN 'active' THEN 0 ELSE 1 END, id DESC",
            search_fields=("title", "terms", "notes"),
            fields=(
                Field("title", "عنوان قرارداد / پروژه", required=True),
                Field("outlet_id", "کارفرما", "ref", ref="outlets"),
                Field("amount", "مبلغ کل", "money", required=True),
                Field("paid_amount", "دریافت‌شده تا امروز", "money", default=0,
                      help="با افزایش این مبلغ، دریافتی خودکار در بخش مالی ثبت می‌شود"),
                Field("start_date", "تاریخ شروع", "date"),
                Field("end_date", "تاریخ پایان", "date"),
                Field("terms", "شرایط پرداخت / اقساط", "longtext", help="مثلاً: ۳۰٪ پیش‌پرداخت، باقی پس از تحویل"),
                Field("status", "وضعیت", "choice", default="active", choices={
                    "active": "در جریان", "done": "تمام‌شده", "cancelled": "لغو‌شده",
                }),
                Field("notes", "توضیحات", "longtext"),
            ),
        ),
        Entity(
            name="transactions",
            label="تراکنش",
            label_plural="دریافت و پرداخت",
            icon="💰",
            title_field="description",
            date_field="tx_date",
            order_by="tx_date DESC, id DESC",
            search_fields=("description", "category"),
            fields=(
                Field("tx_date", "تاریخ", "date", required=True),
                Field("kind", "نوع", "choice", required=True, default="income", choices={
                    "income": "دریافتی (درآمد)", "expense": "هزینه",
                }),
                Field("amount", "مبلغ", "money", required=True),
                Field("category", "دسته", suggest=INCOME_CATEGORIES + EXPENSE_CATEGORIES),
                Field("description", "شرح", required=True),
                Field("outlet_id", "رسانه / کارفرما", "ref", ref="outlets"),
                Field("story_id", "مربوط به سوژه", "ref", ref="stories", list_hidden=True),
                Field("contract_id", "مربوط به قرارداد", "ref", ref="contracts", list_hidden=True),
                Field("ref_no", "شماره رسید / پیگیری", list_hidden=True),
                Field("invoice_id", "صورتحساب", "int", system=True),
            ),
        ),
        Entity(
            name="notes",
            label="یادداشت",
            label_plural="یادداشت‌ها و پیش‌نویس‌ها",
            icon="🗒️",
            title_field="title",
            order_by="CASE kind WHEN 'template' THEN 1 ELSE 0 END, updated_at DESC, id DESC",
            search_fields=("title", "content", "tags"),
            fields=(
                Field("title", "عنوان", required=True),
                Field("kind", "نوع", "choice", default="note", choices={
                    "note": "یادداشت", "draft": "پیش‌نویس", "idea": "ایده", "template": "قالب آماده",
                }),
                Field("content", "متن", "longtext"),
                Field("tags", "برچسب‌ها", "tags"),
                Field("story_id", "مربوط به سوژه", "ref", ref="stories"),
            ),
        ),
        Entity(
            name="legal_docs",
            label="سند / سررسید",
            label_plural="اسناد ثبتی و سررسیدها",
            icon="📜",
            title_field="title",
            date_field="expiry_date",
            closed_statuses=("archived",),
            order_by="CASE status WHEN 'active' THEN 0 WHEN 'expired' THEN 1 ELSE 2 END, "
                     "CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date, id DESC",
            search_fields=("title", "number", "owner_name", "owner_phone", "owner_national_id", "owner_address",
                           "issuer", "notes"),
            fields=(
                Field("title", "عنوان سند", required=True, help="مثلاً پروانه‌ی انتشار، قرارداد اجاره، بیمه‌ی خودرو"),
                Field("doc_type", "نوع", "choice", default="license", choices={
                    "license": "پروانه / مجوز", "contract": "قرارداد", "deed": "سند ملکی / ثبتی", "insurance": "بیمه",
                    "id_card": "کارت / مدرک شناسایی", "check": "چک / سفته", "tax": "مالیات / عوارض",
                    "membership": "عضویت / کارت خبرنگاری", "other": "سایر",
                }),
                Field("number", "شماره سند / پلاک ثبتی"),
                Field("issuer", "صادرکننده / مرجع"),
                Field("issue_date", "تاریخ صدور", "date"),
                Field("expiry_date", "تاریخ سررسید / انقضا", "date"),
                Field("remind_days", "چند روز قبل یادآوری شود", "int", default=15),
                Field("remind_every", "تکرار یادآوری تا رسیدگی", "choice", default="weekly", choices={
                    "once": "فقط یک بار", "daily": "هر روز", "weekly": "هر هفته",
                }),
                Field("renew_months", "دوره‌ی تمدید (ماه)", "int", help="مثلاً ۱۲ برای سالانه؛ خالی = تمدیدی ندارد"),
                Field("amount", "مبلغ (اجاره، حق بیمه، …)", "money"),
                Field("status", "وضعیت", "choice", default="active", choices={
                    "active": "فعال", "expired": "منقضی‌شده", "archived": "بایگانی‌شده",
                }),
                Field("owner_name", "نام صاحب سند"),
                Field("owner_national_id", "کد ملی / شناسه", list_hidden=True),
                Field("owner_phone", "تلفن همراه صاحب سند", "phone", list_hidden=True),
                Field("owner_phone2", "تلفن ثابت", "phone", list_hidden=True),
                Field("owner_email", "ایمیل", list_hidden=True),
                Field("owner_address", "نشانی", "longtext", list_hidden=True),
                Field("owner_postal_code", "کد پستی", list_hidden=True),
                Field("owner_extra", "سایر اطلاعات صاحب سند", "longtext", list_hidden=True,
                      help="نام پدر، شماره شناسنامه، وکیل، …"),
                Field("notes", "یادداشت", "longtext"),
                Field("last_reminded", "آخرین یادآوری", system=True),
                Field("renew_log", "سابقه‌ی تمدید", "longtext", system=True),
            ),
        ),
        Entity(
            name="feeds",
            label="منبع رصد",
            label_plural="منابع رصد خبر (RSS)",
            icon="📡",
            title_field="name",
            order_by="CASE active WHEN 'no' THEN 1 ELSE 0 END, name",
            search_fields=("name", "url", "category"),
            fields=(
                Field("name", "نام", required=True),
                Field("url", "نشانی RSS", "url", required=True),
                Field("category", "دسته"),
                Field("active", "فعال", "choice", default="yes", choices=YESNO),
                Field("last_fetch", "آخرین دریافت", "datetime", system=True),
                Field("last_error", "آخرین خطا", system=True),
                Field("items_count", "تعداد خبر", "int", system=True, default=0),
            ),
        ),
        Entity(
            name="keywords",
            label="کلیدواژه",
            label_plural="کلیدواژه‌های رصد",
            icon="🔎",
            title_field="word",
            order_by="word",
            search_fields=("word",),
            fields=(
                Field("word", "کلیدواژه / عبارت", required=True, help="مثلاً: شهرداری تهران"),
                Field("notify", "اعلان بده", "choice", default="yes", choices=YESNO),
            ),
        ),
    ]
}


class ValidationError(ValueError):
    pass


class NotFound(LookupError):
    pass


# ───────────────────────── اتصال ─────────────────────────

_init_lock = threading.Lock()
_initialized: set[str] = set()


@contextmanager
def connect(path: Path | str | None = None) -> Iterator[sqlite3.Connection]:
    path = str(path or settings.db_path)
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        with _init_lock:
            if path not in _initialized:
                _migrate(conn)
                if path != ":memory:":
                    _initialized.add(path)
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _migrate(conn: sqlite3.Connection) -> None:
    """ساخت جدول‌ها و افزودن ستون‌های جدید (اگر تعریف موجودیت بعداً تغییر کرد)."""
    conn.execute("PRAGMA journal_mode = WAL")
    for ent in ENTITIES.values():
        cols = ["id INTEGER PRIMARY KEY AUTOINCREMENT"]
        for f in ent.fields:
            col = f"{f.name} {f.sql_type}"
            if f.type == "ref":
                col += f" REFERENCES {f.ref}(id) ON DELETE SET NULL"
            cols.append(col)
        cols += ["created_at TEXT", "updated_at TEXT"]
        conn.execute(f"CREATE TABLE IF NOT EXISTS {ent.name} ({', '.join(cols)})")
        existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({ent.name})")}
        for f in ent.fields:
            if f.name not in existing:
                conn.execute(f"ALTER TABLE {ent.name} ADD COLUMN {f.name} {f.sql_type}")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
        CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status, deadline);
        CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, remind_at);
        CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(tx_date);

        -- اعلان‌ها (داخل برنامه، مرورگر و بله)
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT, title TEXT NOT NULL, body TEXT, link TEXT,
            dedup TEXT UNIQUE, is_read INTEGER DEFAULT 0, bale_sent INTEGER DEFAULT 0,
            created_at TEXT
        );

        -- بایگانی اسناد
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL, filename TEXT NOT NULL, path TEXT NOT NULL,
            sha256 TEXT, size INTEGER, kind TEXT,
            category TEXT, tags TEXT, notes TEXT, doc_date TEXT,
            story_id INTEGER REFERENCES stories(id) ON DELETE SET NULL,
            pages INTEGER DEFAULT 0, pages_done INTEGER DEFAULT 0, ocr_pages INTEGER DEFAULT 0,
            fixed_pages INTEGER DEFAULT 0, weak_pages INTEGER DEFAULT 0, chunks INTEGER DEFAULT 0,
            status TEXT DEFAULT 'queued', error TEXT,
            created_at TEXT, updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS doc_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            page INTEGER, seq INTEGER, text TEXT NOT NULL, method TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_chunks_doc ON doc_chunks(doc_id, page, seq);
        CREATE TABLE IF NOT EXISTS doc_pages (
            doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            page INTEGER NOT NULL, text TEXT, method TEXT, PRIMARY KEY (doc_id, page)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS doc_fts USING fts5(
            norm, chunk_id UNINDEXED, doc_id UNINDEXED, tokenize='unicode61 remove_diacritics 0');

        -- رصد خبر
        CREATE TABLE IF NOT EXISTS feed_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            feed_id INTEGER REFERENCES feeds(id) ON DELETE CASCADE,
            guid TEXT NOT NULL UNIQUE, title TEXT NOT NULL, link TEXT, summary TEXT,
            published TEXT, fetched_at TEXT, matched TEXT, starred INTEGER DEFAULT 0, is_read INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_feed_items_pub ON feed_items(published DESC);
        CREATE VIRTUAL TABLE IF NOT EXISTS feed_fts USING fts5(
            norm, item_id UNINDEXED, tokenize='unicode61 remove_diacritics 0');

        -- صورتحساب‌ها
        CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            number TEXT, date TEXT, customer TEXT, customer_phone TEXT, customer_address TEXT, customer_code TEXT,
            items TEXT, discount INTEGER DEFAULT 0, profile TEXT, notes TEXT, status TEXT DEFAULT 'draft',
            paid_date TEXT, outlet_id INTEGER REFERENCES outlets(id) ON DELETE SET NULL,
            payments TEXT, created_at TEXT, updated_at TEXT
        );

        -- تبدیل صوت به متن
        CREATE TABLE IF NOT EXISTS transcripts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT, filename TEXT, path TEXT, size INTEGER, duration REAL,
            status TEXT DEFAULT 'queued', progress REAL DEFAULT 0, error TEXT,
            segments TEXT, summary TEXT, story_id INTEGER REFERENCES stories(id) ON DELETE SET NULL,
            source_chat TEXT, doc_id INTEGER, created_at TEXT, updated_at TEXT
        );

        -- تیزرساز: فایل‌های رسانه‌ای و پروژه‌های تیزر
        CREATE TABLE IF NOT EXISTS media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT, path TEXT NOT NULL, kind TEXT, size INTEGER,
            width INTEGER, height INTEGER, duration REAL, has_audio INTEGER DEFAULT 0,
            thumb TEXT, created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS teasers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT, spec TEXT NOT NULL, status TEXT DEFAULT 'queued',
            progress REAL DEFAULT 0, error TEXT, output TEXT, thumb TEXT,
            duration REAL, size INTEGER, story_id INTEGER REFERENCES stories(id) ON DELETE SET NULL,
            created_at TEXT, updated_at TEXT
        );
        """
    )
    if "payments" not in {r["name"] for r in conn.execute("PRAGMA table_info(invoices)")}:
        conn.execute("ALTER TABLE invoices ADD COLUMN payments TEXT")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_tx_invoice ON transactions(invoice_id)")


def now_str() -> str:
    return jalali.to_jalali(settings.now(), with_time=True)


def today_str() -> str:
    return jalali.to_jalali(settings.now())


# ───────────────────────── اعتبارسنجی ─────────────────────────

_FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩٬،", "01234567890123456789,,")


def to_int(value: Any, label: str = "مقدار") -> int:
    if isinstance(value, bool):
        raise ValidationError(f"«{label}» باید عدد باشد")
    if isinstance(value, (int, float)):
        return int(round(value))
    s = str(value).translate(_FA_DIGITS).replace(",", "").replace(" ", "").replace("%", "")
    try:
        return int(round(float(s)))
    except ValueError:
        raise ValidationError(f"«{label}» باید عدد باشد (مقدار: {value!r})") from None


def _coerce(conn: sqlite3.Connection, f: Field, value: Any) -> Any:
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return None
    try:
        if f.type in ("int", "money"):
            v = to_int(value, f.label)
            if f.type == "money" and v < 0:
                raise ValidationError(f"«{f.label}» نمی‌تواند منفی باشد")
            return v
        if f.type == "percent":
            v = to_int(value, f.label)
            if not 0 <= v <= 100:
                raise ValidationError(f"«{f.label}» باید بین ۰ تا ۱۰۰ باشد")
            return v
        if f.type == "date":
            return jalali.normalize(str(value))
        if f.type == "datetime":
            return jalali.normalize(str(value), with_time=True)
        if f.type == "time":
            s = str(value).translate(_FA_DIGITS).strip()
            parts = s.replace(".", ":").split(":")
            try:
                hh, mm = int(parts[0]), int(parts[1]) if len(parts) > 1 else 0
            except ValueError:
                raise ValidationError(f"ساعت نامعتبر: {value!r} (مثلاً 14:30)") from None
            if not (0 <= hh <= 23 and 0 <= mm <= 59):
                raise ValidationError(f"ساعت نامعتبر: {value!r}")
            return f"{hh:02d}:{mm:02d}"
        if f.type == "choice":
            v = str(value).strip()
            if v in f.choices:
                return v
            for key, label in f.choices.items():
                if label == v:
                    return key
            opts = "، ".join(f.choices.values())
            raise ValidationError(f"مقدار «{f.label}» نامعتبر است: {v!r}. گزینه‌ها: {opts}")
        if f.type == "ref":
            rid = to_int(value, f.label)
            if not conn.execute(f"SELECT 1 FROM {f.ref} WHERE id=?", (rid,)).fetchone():
                raise ValidationError(f"«{f.label}» با شناسه {rid} وجود ندارد")
            return rid
        if f.type == "url":
            v = str(value).strip()
            if v and not v.lower().startswith(("http://", "https://")):
                v = "https://" + v
            return v
        if f.type == "tags":
            parts = [p.strip() for p in str(value).replace("،", ",").split(",")]
            return "، ".join(dict.fromkeys(p for p in parts if p)) or None
    except ValueError as e:
        if isinstance(e, ValidationError):
            raise
        raise ValidationError(str(e)) from None
    return str(value).strip()


def _clean(conn: sqlite3.Connection, ent: Entity, data: dict[str, Any], partial: bool) -> dict[str, Any]:
    allowed = {f.name: f for f in ent.editable}
    unknown = set(data) - set(allowed)
    if unknown:
        raise ValidationError(f"فیلد(های) ناشناخته برای {ent.label}: {', '.join(sorted(unknown))}")
    out = {name: _coerce(conn, allowed[name], v) for name, v in data.items()}
    if not partial:
        for f in ent.editable:
            if out.get(f.name) is None and f.default is not None:
                out[f.name] = f.default
        missing = [f.label for f in ent.editable if f.required and out.get(f.name) is None]
        if missing:
            raise ValidationError(f"این موارد را پر کنید: {'، '.join(missing)}")
    else:
        empty = [allowed[n].label for n, v in out.items() if v is None and allowed[n].required]
        if empty:
            raise ValidationError(f"این موارد نمی‌توانند خالی باشند: {'، '.join(empty)}")
    return out


def _apply_rules(ent: Entity, values: dict[str, Any], before: dict[str, Any] | None) -> None:
    """قواعد خاص هر موجودیت (محاسبات خودکار) پیش از ذخیره."""
    old = before or {}
    merged = {**old, **values}
    if ent.name == "stories":
        if "status" in values and values["status"] != old.get("status"):
            if values["status"] in ("published", "submitted"):
                values["completed_at"] = now_str()
                if values["status"] == "published" and not merged.get("published_date"):
                    values["published_date"] = today_str()
            else:
                values["completed_at"] = None
        if ("remind_at" in values and values["remind_at"] != old.get("remind_at")) or (
            "deadline" in values and values["deadline"] != old.get("deadline")
        ):
            values["reminded"] = None
        # هماهنگی دستمزد و وضعیت پرداخت
        fee = merged.get("fee") or 0
        if values.get("pay_status") == "paid" and fee and (merged.get("paid_amount") or 0) < fee:
            values["paid_amount"] = fee
        elif "paid_amount" in values or "fee" in values:
            paid = merged.get("paid_amount") if "paid_amount" not in values else values["paid_amount"]
            paid = paid or 0
            if paid > 0 and (not fee or paid >= fee):
                values["pay_status"] = "paid"
            elif paid > 0:
                values["pay_status"] = "partial"
            elif fee and merged.get("pay_status") in (None, "none", "paid", "partial"):
                values["pay_status"] = "unpaid"
    if ent.name == "reminders":
        if "remind_at" in values and values["remind_at"] != old.get("remind_at") and before is not None:
            if merged.get("status") == "sent" and "status" not in values:
                values["status"] = "active"


def _after_save(conn: sqlite3.Connection, ent: Entity, before: dict[str, Any] | None, after: dict[str, Any]) -> None:
    """کارهای پس از ذخیره: ثبت خودکار دریافتی در بخش مالی وقتی مبلغ دریافت‌شده بیشتر شد."""
    if ent.name not in ("stories", "contracts"):
        return
    delta = (after.get("paid_amount") or 0) - ((before or {}).get("paid_amount") or 0)
    if delta <= 0:
        return
    if ent.name == "stories":
        desc = f"دستمزد: {after['title']}"
        category, link = "دستمزد کار", {"story_id": after["id"]}
    else:
        desc = f"قرارداد: {after['title']}"
        category, link = "قرارداد", {"contract_id": after["id"]}
    create(conn, "transactions", {
        "tx_date": today_str(), "kind": "income", "amount": delta, "category": category,
        "description": desc, "outlet_id": after.get("outlet_id"), **link,
    })


# ───────────────────────── عملیات ─────────────────────────


def _select_sql(ent: Entity) -> str:
    refs = ent.refs
    if not refs:
        return f"SELECT t.* FROM {ent.name} t"
    joins, cols = [], []
    for i, f in enumerate(refs):
        target = ENTITIES[f.ref]
        joins.append(f"LEFT JOIN {f.ref} r{i} ON r{i}.id = x.{f.name}")
        cols.append(f"r{i}.{target.title_field} AS {f.join_alias}")
    # زیرپرس‌وجو تا نام ستون‌ها (مثل status) در ORDER BY مبهم نشوند
    return f"SELECT * FROM (SELECT x.*, {', '.join(cols)} FROM {ent.name} x {' '.join(joins)}) t"


def get_entity(name: str) -> Entity:
    try:
        return ENTITIES[name]
    except KeyError:
        raise NotFound(f"بخش ناشناخته: {name}") from None


def get(conn: sqlite3.Connection, entity: str, rec_id: int) -> dict[str, Any]:
    ent = get_entity(entity)
    row = conn.execute(f"{_select_sql(ent)} WHERE t.id = ?", (int(rec_id),)).fetchone()
    if not row:
        raise NotFound(f"{ent.label} با شناسه {rec_id} پیدا نشد")
    return dict(row)


def create(conn: sqlite3.Connection, entity: str, data: dict[str, Any]) -> dict[str, Any]:
    ent = get_entity(entity)
    values = _clean(conn, ent, data, partial=False)
    _apply_rules(ent, values, None)
    for f in ent.fields:
        if f.system and f.default is not None:
            values.setdefault(f.name, f.default)
    values["created_at"] = values["updated_at"] = now_str()
    cols = ", ".join(values)
    marks = ", ".join("?" for _ in values)
    cur = conn.execute(f"INSERT INTO {ent.name} ({cols}) VALUES ({marks})", list(values.values()))
    rec = get(conn, entity, cur.lastrowid)
    _after_save(conn, ent, None, rec)
    return rec


def update(conn: sqlite3.Connection, entity: str, rec_id: int, data: dict[str, Any]) -> dict[str, Any]:
    ent = get_entity(entity)
    before = get(conn, entity, rec_id)
    values = _clean(conn, ent, data, partial=True)
    values = {k: v for k, v in values.items() if v != before.get(k)}
    if not values:
        return before
    _apply_rules(ent, values, before)
    values["updated_at"] = now_str()
    sets = ", ".join(f"{k} = ?" for k in values)
    conn.execute(f"UPDATE {ent.name} SET {sets} WHERE id = ?", [*values.values(), int(rec_id)])
    rec = get(conn, entity, rec_id)
    _after_save(conn, ent, before, rec)
    return rec


def set_system(conn: sqlite3.Connection, entity: str, rec_id: int, **values: Any) -> None:
    """به‌روزرسانی فیلدهای سیستمی (بدون اعتبارسنجی فرم)."""
    ent = get_entity(entity)
    names = {f.name for f in ent.fields}
    if set(values) - names:
        raise ValidationError(f"فیلد ناشناخته: {set(values) - names}")
    sets = ", ".join(f"{k} = ?" for k in values)
    conn.execute(f"UPDATE {ent.name} SET {sets} WHERE id = ?", [*values.values(), int(rec_id)])


def delete(conn: sqlite3.Connection, entity: str, rec_id: int) -> dict[str, Any]:
    ent = get_entity(entity)
    row = get(conn, entity, rec_id)
    conn.execute(f"DELETE FROM {ent.name} WHERE id = ?", (int(rec_id),))
    if entity == "transactions" and row.get("invoice_id"):
        from . import invoices  # جلوگیری از import چرخه‌ای

        invoices.on_transaction_deleted(conn, row)
    return row


def list_records(
    conn: sqlite3.Connection,
    entity: str,
    *,
    filters: dict[str, Any] | None = None,
    search: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    exclude_status: list[str] | tuple[str, ...] | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """جستجو با فیلترهای برابری، متن آزاد و بازه‌ی تاریخ (روی فیلد تاریخ اصلی موجودیت)."""
    ent = get_entity(entity)
    where, params = [], []
    for key, value in (filters or {}).items():
        if value is None or value == "":
            continue
        f = ent.field(key) if key != "id" else Field("id", "شناسه", "int")
        if isinstance(value, (list, tuple)):
            coerced = [_coerce(conn, f, v) for v in value]
            where.append(f"t.{key} IN ({', '.join('?' for _ in coerced)})")
            params += coerced
        else:
            where.append(f"t.{key} = ?")
            params.append(_coerce(conn, f, value))
    if search:
        cols = list(ent.search_fields or (ent.title_field,))
        words = [w for w in search.replace("ي", "ی").replace("ك", "ک").split() if w]
        for w in words:  # همه‌ی واژه‌ها باید جایی آمده باشند
            where.append("(" + " OR ".join(f"t.{c} LIKE ?" for c in cols) + ")")
            params += [f"%{w}%"] * len(cols)
    if ent.date_field and (date_from or date_to):
        try:
            if date_from:
                where.append(f"t.{ent.date_field} >= ?")
                params.append(jalali.normalize(date_from[:10]))
            if date_to:
                where.append(f"substr(t.{ent.date_field}, 1, 10) <= ?")
                params.append(jalali.normalize(date_to[:10]))
        except ValueError as e:
            raise ValidationError(str(e)) from None
    if exclude_status and any(f.name == "status" for f in ent.fields):
        where.append(f"t.status NOT IN ({', '.join('?' for _ in exclude_status)})")
        params += list(exclude_status)
    sql = _select_sql(ent)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += f" ORDER BY {ent.order_by} LIMIT ?"
    params.append(max(1, min(int(limit), 5000)))
    return [dict(r) for r in conn.execute(sql, params)]


def label_of(entity: str, field_name: str, value: Any) -> str:
    f = ENTITIES[entity].field(field_name)
    return f.choices.get(value, value or "")


def schema() -> dict[str, Any]:
    """تعریف موجودیت‌ها برای فرانت‌اند."""
    return {
        name: {
            "label": e.label,
            "label_plural": e.label_plural,
            "icon": e.icon,
            "title_field": e.title_field,
            "date_field": e.date_field,
            "closed": list(e.closed_statuses),
            "fields": [
                {
                    "name": f.name, "label": f.label, "type": f.type, "required": f.required,
                    "choices": f.choices, "default": f.default, "help": f.help, "system": f.system,
                    "ref": f.ref, "suggest": list(f.suggest), "advanced": f.list_hidden,
                    "join": f.join_alias if f.type == "ref" else None,
                }
                for f in e.fields
            ],
        }
        for name, e in ENTITIES.items()
    }


# ───────────────────────── تنظیمات کلید-مقدار ─────────────────────────


def kv_get(conn: sqlite3.Connection, key: str, default: str | None = None) -> str | None:
    row = conn.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def kv_set(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value)
    )
