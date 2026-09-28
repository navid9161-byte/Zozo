@echo off
REM اجرای برنامه روی ویندوز
cd /d %~dp0
if not exist .venv python -m venv .venv
call .venv\Scripts\activate
pip install -q -r requirements.txt
if not exist .env copy .env.example .env
python scripts\get_fonts.py zozo\static\fonts
uvicorn zozo.main:app --host 0.0.0.0 --port 8000
pause
