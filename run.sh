#!/usr/bin/env bash
# اجرای برنامه روی کامپیوتر خودتان (لینوکس / مک)
set -e
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -r requirements.txt
[ -f .env ] || cp .env.example .env
python scripts/get_fonts.py zozo/static/fonts || true
exec uvicorn zozo.main:app --host 0.0.0.0 --port 8000
