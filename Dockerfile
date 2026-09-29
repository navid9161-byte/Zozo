FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1

# ffmpeg برای ساخت تیزر و تبدیل صوت، Tesseract برای خواندن اسکن‌های فارسی
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tesseract-ocr tesseract-ocr-fas tesseract-ocr-eng \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --prefer-binary -r requirements.txt

# مدل تبدیل گفتار فارسی (۵۰ مگابایت) هنگام ساخت دانلود نمی‌شود تا ساخت زیر ۵ دقیقه‌ی لیارا بماند؛
# برنامه پس از اجرا یک بار آن را روی دیسک /data دانلود می‌کند (یا از بخش «صوت به متن» بارگذاری می‌شود).

# قلم وزیرمتن هم داخل zozo/static/fonts است
COPY zozo ./zozo

ENV ZOZO_DATA_DIR=/data \
    ZOZO_RENDER_THREADS=2
VOLUME /data
EXPOSE 8000

# فقط یک worker: کارهای پس‌زمینه (یادآوری، ربات، ساخت ویدیو) باید یک نسخه داشته باشند
CMD ["uvicorn", "zozo.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
