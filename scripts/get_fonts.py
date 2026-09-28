"""قلم وزیرمتن را در پوشه‌ی مقصد قرار می‌دهد: اول از قلم‌های نصب‌شده‌ی سیستم، وگرنه دانلود.

python scripts/get_fonts.py /app/fonts
"""
from __future__ import annotations

import shutil
import sys
import urllib.request
from pathlib import Path

WEIGHTS = ["Regular", "Medium", "Bold", "Black"]
SYSTEM_DIRS = [Path("/usr/share/fonts"), Path("/usr/local/share/fonts")]
URLS = [
    "https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/ttf/Vazirmatn-{w}.ttf",
    "https://raw.githubusercontent.com/rastikerdar/vazirmatn/v33.003/fonts/ttf/Vazirmatn-{w}.ttf",
]


def main(dest: str) -> int:
    out = Path(dest)
    out.mkdir(parents=True, exist_ok=True)
    ok = 0
    for w in WEIGHTS:
        target = out / f"Vazirmatn-{w}.ttf"
        if target.exists():
            ok += 1
            continue
        found = next((p for d in SYSTEM_DIRS if d.exists() for p in d.rglob(f"Vazirmatn-{w}.ttf")), None)
        if found:
            shutil.copy(found, target)
            ok += 1
            continue
        for url in URLS:
            try:
                with urllib.request.urlopen(url.format(w=w), timeout=30) as r:
                    data = r.read()
                if data[:4] in (b"\x00\x01\x00\x00", b"true", b"OTTO"):
                    target.write_bytes(data)
                    ok += 1
                    break
            except Exception as e:  # noqa: BLE001
                print(f"download failed {url.format(w=w)}: {e}")
    print(f"Vazirmatn: {ok}/{len(WEIGHTS)} weights in {out}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "zozo/static/fonts"))
