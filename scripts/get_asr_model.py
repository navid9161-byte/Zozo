"""دانلود مدل سبک تبدیل گفتار فارسی (Vosk، حدود ۵۰ مگابایت) هنگام ساخت Docker.

python scripts/get_asr_model.py /opt/asr
اگر دانلود ممکن نبود، برنامه هنگام اولین استفاده دوباره تلاش می‌کند، یا می‌شود فایل zip مدل را از بخش تنظیمات بارگذاری کرد.
"""
from __future__ import annotations

import io
import sys
import urllib.request
import zipfile
from pathlib import Path

NAME = "vosk-model-small-fa-0.42"
URL = f"https://alphacephei.com/vosk/models/{NAME}.zip"


def main(dest: str) -> int:
    root = Path(dest)
    if (root / NAME / "am").is_dir():
        print("model already present")
        return 0
    root.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(URL, timeout=300) as r:
            data = r.read()
        zipfile.ZipFile(io.BytesIO(data)).extractall(root)
    except Exception as e:  # noqa: BLE001
        print(f"WARNING: ASR model download failed: {e}")
        return 1
    print(f"ASR model installed in {root / NAME}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "models"))
