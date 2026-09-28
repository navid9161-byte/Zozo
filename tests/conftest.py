import os
import tempfile

# پیش از import برنامه: پوشه‌ی داده‌ی موقت، بدون کارهای پس‌زمینه
_tmp = tempfile.mkdtemp(prefix="zozo-test-")
os.environ["ZOZO_DATA_DIR"] = _tmp
os.environ["ZOZO_NO_BACKGROUND"] = "1"
os.environ["ZOZO_PASSWORD"] = "secret-pass"
os.environ["ZOZO_RENDER_THREADS"] = "1"
os.environ.pop("BALE_BOT_TOKEN", None)
os.environ.pop("ZOZO_LLM_BASE_URL", None)
os.environ.pop("ANTHROPIC_API_KEY", None)
