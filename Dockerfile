FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1

# ffmpeg برای ساخت تیزر، Tesseract برای خواندن اسکن‌های فارسی، قلم وزیرمتن برای نوشته‌های فارسی
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tesseract-ocr tesseract-ocr-fas tesseract-ocr-eng \
 && (apt-get install -y --no-install-recommends fonts-vazirmatn || echo "fonts-vazirmatn not available; will try download") \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

# قلم وزیرمتن را در /app/fonts می‌گذارد (از بسته‌ی سیستم، یا در صورت نبودن، دانلود)؛ اگر نشد برنامه با قلم Tahoma کار می‌کند
COPY scripts/get_fonts.py scripts/get_fonts.py
RUN python scripts/get_fonts.py /app/fonts || echo "WARNING: Vazirmatn font not installed"

COPY zozo ./zozo

ENV ZOZO_DATA_DIR=/data \
    ZOZO_FONT_DIR=/app/fonts \
    ZOZO_RENDER_THREADS=2
VOLUME /data
EXPOSE 8000

# فقط یک worker: کارهای پس‌زمینه (یادآوری، ربات، ساخت ویدیو) باید یک نسخه داشته باشند
CMD ["uvicorn", "zozo.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
