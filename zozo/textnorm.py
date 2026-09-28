"""یکسان‌سازی متن فارسی، ابزارهای ویرایش و جستجو. بخش جستجو و کیفیت‌سنجی برگرفته از CivilDesk.

PDFهای فارسی معمولاً یکی از این مشکلات را دارند:
- حروف «شکل‌دار» (Presentation Forms) به جای حروف استاندارد ← با NFKC درست می‌شود
- ترتیب دیداری (برعکس) به جای ترتیب منطقی ← با شمارش کلمات پرتکرار تشخیص و برگردانده می‌شود
- نگاشت خراب قلم ← امتیاز کیفیت پایین، صفحه OCR می‌شود
"""
from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter

ZWNJ = "‌"

STOPWORDS = frozenset(
    """و در به از که این را با است برای آن یا می ها های هر تا بر اگر باید شود شده نیز بین پس
    کند کرد شد دارد هم ای یک دو باشد باشند نمی نه چه چون همه روی زیر بعد قبل طبق مورد موارد
    بوده شوند گردد میشود میباشد می‌باشد می‌شود بايد اين خود او وی ما شما آنها ایشان کرده کنند
    داد داده دهد گفت گفته اما ولی نیست هست بود""".split()
)
QUERY_STOPWORDS = STOPWORDS | frozenset(
    """چقدر چند چیست چیه کدام کدوم چطور چگونه آیا ایا لطفا بگو میخوام می‌خواهم هست
    چی کجا کی چرا مقدار میزان""".split()
)

_CHAR_MAP = str.maketrans({
    "ي": "ی", "ى": "ی", "ئ": "ی", "ك": "ک", "ۀ": "ه", "ة": "ه", "ؤ": "و",
    "أ": "ا", "إ": "ا", "ٱ": "ا", "ٲ": "ا",
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
    "ـ": None,
    " ": " ", "‏": None, "‎": None, "‪": None, "‫": None, "‬": None,
    "‭": None, "‮": None, "﻿": None,
})
_DIACRITICS = re.compile(r"[ً-ٰٟۖ-ۭ]")
_PERSIAN_LETTER = re.compile(r"[ء-غف-يپچژکگیآ]")
_PERSIAN_CHARS = set("آابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهیءأإؤئةيكۀ")
_LTR_RUN = re.compile(r"[0-9A-Za-z۰-۹٠-٩][0-9A-Za-z۰-۹٠-٩.,/:%\-]*[0-9A-Za-z۰-۹٠-٩]|[0-9A-Za-z۰-۹٠-٩]")


def clean_display(text: str) -> str:
    """متن برای نمایش: حروف استاندارد، بدون کنترل‌های جهت؛ ارقام و نیم‌فاصله حفظ می‌شوند."""
    text = unicodedata.normalize("NFKC", text)
    text = text.translate(str.maketrans({
        "ي": "ی", "ى": "ی", "ك": "ک", "ـ": None, " ": " ", "‏": None, "‎": None,
        "﻿": None, "‪": None, "‫": None, "‬": None, "‭": None, "‮": None,
    }))
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def normalize(text: str) -> str:
    """متن یکسان‌شده برای نمایه‌سازی و جستجو (نه برای نمایش)."""
    text = unicodedata.normalize("NFKC", text or "").translate(_CHAR_MAP)
    text = text.replace("آ", "ا")
    text = _DIACRITICS.sub("", text)
    text = text.replace(ZWNJ, " ").lower()
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def tokens(text: str) -> list[str]:
    return normalize(text).split()


# ───────────────────────── کیفیت و جهت متن (برای PDF) ─────────────────────────

_FA_DIGIT_SET = set("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩")


def _classify(tok: str) -> str:
    letters = [c for c in tok if c.isalpha()]
    has_fa_digit = any(c in _FA_DIGIT_SET for c in tok)
    has_en_digit = any(c in "0123456789" for c in tok)
    if has_fa_digit and has_en_digit:
        return "bad"
    if not letters:
        return "num"
    if (has_fa_digit and all(c.isascii() for c in letters)) or (
        has_en_digit and len(letters) > 1 and all(c in _PERSIAN_CHARS for c in letters)
    ):
        return "bad"
    if all(c in _PERSIAN_CHARS for c in letters):
        return "fa"
    if all(c.isascii() for c in letters):
        return "en"
    return "bad"


def quality(text: str) -> dict[str, float]:
    """امتیاز کیفیت متن استخراج‌شده (۰ تا ۱) به‌همراه آمار آن."""
    norm = unicodedata.normalize("NFKC", text).translate(_CHAR_MAP).replace(ZWNJ, " ")
    toks = [t for t in re.split(r"[^\w]+", norm) if t]
    kinds = [_classify(t) for t in toks]
    raw_kinds = [_classify(t) for t in re.split(r"\s+", text) if t.strip()]
    letter_toks = [t for t, k in zip(toks, kinds) if k != "num"]
    n = len(letter_toks)
    if n == 0:
        return {"score": 0.0, "words": 0, "bad": 0.0, "stop": 0.0, "stop_rev": 0.0, "fa": 0.0}
    bad = min(1.0, (sum(1 for k in kinds if k == "bad") + sum(1 for k in raw_kinds if k == "bad")) / (2 * n))
    num_ratio = sum(1 for k in kinds if k == "num") / len(kinds)
    fa_toks = [t for t, k in zip(toks, kinds) if k == "fa"]
    fa_ratio = len(fa_toks) / n
    stop = sum(1 for t in fa_toks if t in STOPWORDS) / max(1, len(fa_toks))
    stop_rev = sum(1 for t in fa_toks if t[::-1] in STOPWORDS and t not in STOPWORDS) / max(1, len(fa_toks))
    single = sum(1 for t in fa_toks if len(t) == 1 and t not in ("و",)) / max(1, len(fa_toks))
    score = (1 - bad) * (1 - min(single, 0.5))
    if num_ratio > 0.4 and len(kinds) >= 10:
        score *= 1 - (num_ratio - 0.4)
    if len(fa_toks) >= 8:
        score *= 0.4 + 0.6 * min(1.0, stop / 0.12)
    return {"score": round(score, 3), "words": n, "bad": round(bad, 3), "stop": round(stop, 3),
            "stop_rev": round(stop_rev, 3), "fa": round(fa_ratio, 3)}


def _reverse_line(line: str) -> str:
    rev = line[::-1]
    return _LTR_RUN.sub(lambda m: m.group(0)[::-1], rev)


def fix_direction(text: str) -> tuple[str, bool]:
    """اگر متن با ترتیب دیداری (برعکس) استخراج شده باشد، آن را درست می‌کند."""
    text = unicodedata.normalize("NFKC", text)
    q = quality(text)
    if q["stop_rev"] > max(0.06, q["stop"] * 2):
        return "\n".join(_reverse_line(line) for line in text.split("\n")), True
    return text, False


def is_persian(text: str) -> bool:
    return len(_PERSIAN_LETTER.findall(text)) > len(re.findall(r"[A-Za-z]", text))


# ───────────────────────── پرسش جستجو ─────────────────────────

_SUFFIXES = ("هایی", "های", "ترین", "ها", "تر", "ان", "ات", "ی")


def stem(tok: str) -> str:
    """ریشه‌یابی بسیار سبک (فقط پسوندهای رایج) برای جستجوی پیشوندی."""
    for suf in _SUFFIXES:
        if tok.endswith(suf) and len(tok) - len(suf) >= 3:
            return tok[: -len(suf)]
    return tok


def query_terms(query: str) -> list[str]:
    seen, out = set(), []
    for t in tokens(query):
        if t in QUERY_STOPWORDS or (len(t) < 2 and not t.isdigit()):
            continue
        s = stem(t)
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


def fts_query(query: str, mode: str = "OR") -> str | None:
    """ساخت پرسش FTS5: واژه‌ها با OR (یا AND) و جستجوی پیشوندی."""
    terms = query_terms(query)
    if not terms:
        return None
    return f" {mode} ".join(f'"{t}"*' if len(t) >= 3 else f'"{t}"' for t in terms)


def highlight_terms(query: str) -> list[str]:
    return query_terms(query)


def matches_keyword(norm_text: str, keyword: str) -> bool:
    """آیا کلیدواژه (یک یا چند کلمه) در متن یکسان‌شده آمده است؟ (مرز کلمه رعایت می‌شود)."""
    kw = normalize(keyword)
    if not kw:
        return False
    return re.search(rf"(?:^|\s){re.escape(kw)}", norm_text) is not None


# ───────────────────────── ابزارهای ویرایش متن ─────────────────────────

_FA_DIGITS_OUT = str.maketrans("0123456789٠١٢٣٤٥٦٧٨٩", "۰۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶۷۸۹")
_ZW_SUFFIXES = ("هایی", "هایم", "هایت", "هایش", "هایمان", "هایتان", "هایشان", "های", "ها",
                "ترین", "تری", "تر", "ام", "ات", "اش", "ایم", "اید", "اند")


def fix_persian(text: str, digits: bool = True) -> str:
    """ویرایش خودکار متن فارسی: «ی/ک» عربی، نیم‌فاصله‌ی «می/نمی» و «ها/تر»، فاصله‌ی نشانه‌ها، ارقام فارسی.

    محافظه‌کار است: فقط الگوهای مطمئن را تغییر می‌دهد و نشانی‌های اینترنتی را دست نمی‌زند.
    """
    if not text:
        return text
    urls: list[str] = []

    def _keep(m: re.Match) -> str:  # نشانی‌ها با نویسه‌ی «خصوصی» جایگزین می‌شوند تا دست نخورند
        urls.append(m.group(0))
        return "" + chr(0xE100 + len(urls) - 1)

    text = re.sub(r"https?://\S+|www\.\S+|\S+@\S+\.\w+", _keep, text)
    text = text.replace("ي", "ی").replace("ى", "ی").replace("ك", "ک").replace("ـ", "")
    if is_persian(text):
        text = re.sub(r"(?<!\d),(?!\d)", "،", text)
    # می / نمی + فعل ← نیم‌فاصله
    text = re.sub(r"(^|[\s(«])(ن?می)\s+(?=[؀-ۿ])", rf"\1\2{ZWNJ}", text)
    # پسوندهای جمع و صفت تفضیلی که با فاصله جدا شده‌اند
    for suf in sorted(_ZW_SUFFIXES, key=len, reverse=True):
        text = re.sub(rf"([؀-ۿ]{{2,}})\s+({suf})(?=[\s.,،؛:!?؟»)]|$)", rf"\1{ZWNJ}\2", text)
    # «ه ی» ← «هٔ / ه‌ی»
    text = re.sub(r"(\S)ه\s+ی(?=\s)", rf"\1ه{ZWNJ}ی", text)
    # فاصله‌ی نشانه‌گذاری: قبل از نشانه فاصله نباشد، بعدش باشد
    text = re.sub(r"\s+([.,،؛:!?؟»)])", r"\1", text)
    text = re.sub(r"([،؛:!?؟])(?=[^\s\d»)])", r"\1 ", text)
    text = re.sub(r"([«(])\s+", r"\1", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(rf"{ZWNJ}{{2,}}", ZWNJ, text)
    text = re.sub(rf"\s{ZWNJ}|{ZWNJ}\s", " ", text)
    if digits:
        # ارقام داخل متن فارسی (نه داخل کلمات لاتین)
        text = re.sub(r"(?<![A-Za-z])\d+(?![A-Za-z])", lambda m: m.group(0).translate(_FA_DIGITS_OUT), text)
    text = re.sub("(.)", lambda m: urls[ord(m.group(1)) - 0xE100], text)
    return text


def text_stats(text: str) -> dict[str, int]:
    words = re.findall(r"[\w‌]+", text or "")
    sents = [s for s in re.split(r"[.!?؟\n]+", text or "") if s.strip()]
    return {
        "chars": len(text or ""),
        "words": len(words),
        "sentences": len(sents),
        "paragraphs": len([p for p in (text or "").split("\n") if p.strip()]),
        "read_minutes": max(1, math.ceil(len(words) / 200)) if words else 0,
    }


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?؟])\s+|\n+", text or "") if len(s.strip()) > 1]


def extractive_summary(text: str, n: int = 3) -> list[str]:
    """خلاصه‌ی بدون هوش مصنوعی: جمله‌هایی که واژه‌های پرتکرار متن را بیشتر دارند (به ترتیب اصلی)."""
    sents = split_sentences(text)
    if len(sents) <= n:
        return sents
    freq = Counter(t for t in tokens(text) if t not in STOPWORDS and len(t) > 2)
    if not freq:
        return sents[:n]
    top = freq.most_common(1)[0][1]
    scored = []
    for i, s in enumerate(sents):
        toks = [t for t in tokens(s) if t not in STOPWORDS]
        if not toks:
            continue
        score = sum(freq.get(t, 0) / top for t in toks) / math.sqrt(len(toks))
        if i == 0:
            score *= 1.4  # در خبر، لید معمولاً مهم‌ترین جمله است
        scored.append((score, i, s))
    best = sorted(scored, reverse=True)[:n]
    return [s for _, _, s in sorted(best, key=lambda x: x[1])]


def keywords(text: str, n: int = 10) -> list[str]:
    """واژه‌های پرتکرار؛ شمارش بر اساس ریشه، ولی نمایش با رایج‌ترین شکل خود واژه."""
    freq: Counter = Counter()
    forms: dict[str, Counter] = {}
    for t in tokens(text):
        if t in STOPWORDS or len(t) <= 2 or t.isdigit():
            continue
        st = stem(t)
        freq[st] += 1
        forms.setdefault(st, Counter())[t] += 1
    return [forms[w].most_common(1)[0][0] for w, _ in freq.most_common(n)]
