"""حذف نویز گفتار با DeepFilterNet3 (ONNX) — فقط onnxruntime و numpy، بدون PyTorch.

همان حساب‌های کتابخانه‌ی libDF (پنجره‌ی Vorbis، باندهای ERB، نرمال‌سازی نمایی) با numpy بازنویسی شده
و با خود libDF مقایسه شده است. صدا ۴۸ کیلوهرتز است؛ ffmpeg پیش و پس از آن تبدیل می‌کند.
"""
from __future__ import annotations

import threading
from pathlib import Path
from typing import Callable

import numpy as np

MODEL_DIR = Path(__file__).parent / "models" / "dfn3"
SR, FFT, HOP, NB_ERB, NB_DF, ORDER, DF_LA, CONV_LA = 48000, 960, 480, 32, 96, 5, 2, 2
ALPHA = 0.99   # exp(-hop/sr / tau) با tau=۱ ثانیه، گرد به سه رقم (مثل DeepFilterNet)
# شدت‌ها: حداکثر چند دسی‌بل نویز کم شود (None = کامل)
LEVEL_LIMIT = {"light": 12.0, "normal": 25.0, "strong": None}


def available() -> bool:
    try:
        import onnxruntime  # noqa: F401
    except ImportError:
        return False
    return all((MODEL_DIR / f"{n}.onnx").exists() for n in ("enc", "erb_dec", "df_dec"))


def erb_widths(min_nb: int = 2) -> np.ndarray:
    nyq, fw = SR // 2, SR / FFT
    lo, hi = 0.0, 9.265 * np.log1p(nyq / (24.7 * 9.265))
    step = (hi - lo) / NB_ERB
    widths, prev, over = [], 0, 0
    for i in range(1, NB_ERB + 1):
        fb = int(round(24.7 * 9.265 * (np.exp((lo + i * step) / 9.265) - 1) / fw))
        nb = fb - prev - over
        if nb < min_nb:
            over, nb = min_nb - nb, min_nb
        else:
            over = 0
        widths.append(nb)
        prev = fb
    widths[-1] += 1
    extra = sum(widths) - (FFT // 2 + 1)
    if extra > 0:
        widths[-1] -= extra
    return np.array(widths, dtype=int)


WIDTHS = erb_widths()
WIN = np.sin(0.5 * np.pi * np.sin(np.pi * (np.arange(FFT) + 0.5) / FFT) ** 2).astype(np.float32)
WNORM = 1.0 / (FFT ** 2 / (2 * HOP))
ERB_INV = np.zeros((NB_ERB, FFT // 2 + 1), np.float32)
_b = 0
for _i, _w in enumerate(WIDTHS):
    ERB_INV[_i, _b:_b + _w] = 1
    _b += _w


def analysis(x: np.ndarray) -> np.ndarray:
    """[N] ← طیف [T, F]."""
    T = len(x) // HOP
    buf = np.concatenate([np.zeros(FFT - HOP, np.float32), x[:T * HOP]])
    idx = np.arange(T)[:, None] * HOP + np.arange(FFT)[None]
    return (np.fft.rfft(buf[idx] * WIN, axis=-1) * WNORM).astype(np.complex64)


def synthesis(spec: np.ndarray) -> np.ndarray:
    """طیف [T, F] ← [T*HOP] (هم‌پوشانی نیمه‌به‌نیمه)."""
    fr = (np.fft.irfft(spec, n=FFT, axis=-1) * FFT * WIN).astype(np.float32)
    out = fr[:, :HOP].copy()
    out[1:] += fr[:-1, HOP:]
    return out.reshape(-1)


def _erb_feat(spec: np.ndarray) -> np.ndarray:
    p = np.abs(spec) ** 2
    bands = np.add.reduceat(p, np.concatenate([[0], np.cumsum(WIDTHS)[:-1]]), axis=-1) / WIDTHS
    x = 10 * np.log10(bands + 1e-10)
    st = np.linspace(-60, -90, NB_ERB).astype(np.float32)
    out = np.empty_like(x, dtype=np.float32)
    for t in range(x.shape[0]):
        st = x[t] * (1 - ALPHA) + st * ALPHA
        out[t] = (x[t] - st) / 40
    return out


def _unit_norm(x: np.ndarray) -> np.ndarray:
    st = np.linspace(0.001, 0.0001, x.shape[-1]).astype(np.float32)
    out = np.empty_like(x)
    a = np.abs(x)
    for t in range(x.shape[0]):
        st = a[t] * (1 - ALPHA) + st * ALPHA
        out[t] = x[t] / np.sqrt(st)
    return out


class Denoiser:
    def __init__(self, threads: int = 2) -> None:
        import onnxruntime as ort

        o = ort.SessionOptions()
        o.intra_op_num_threads = max(1, threads)
        o.inter_op_num_threads = 1
        o.log_severity_level = 3

        def mk(name: str):
            return ort.InferenceSession(str(MODEL_DIR / f"{name}.onnx"), o, providers=["CPUExecutionProvider"])

        self.enc, self.erb_dec, self.df_dec = mk("enc"), mk("erb_dec"), mk("df_dec")

    def _models(self, fe: np.ndarray, fs: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        T = fe.shape[2]
        # پیش‌نگری ۲ فریمی شبکه (pad_feat)
        fe = np.concatenate([fe[:, :, CONV_LA:], np.zeros_like(fe[:, :, :CONV_LA])], 2)
        fs = np.concatenate([fs[:, :, CONV_LA:], np.zeros_like(fs[:, :, :CONV_LA])], 2)
        e0, e1, e2, e3, emb, c0, _ = self.enc.run(None, {"feat_erb": fe, "feat_spec": fs})
        m = self.erb_dec.run(None, {"emb": emb, "e3": e3, "e2": e2, "e1": e1, "e0": e0})[0]
        coefs = self.df_dec.run(None, {"emb": emb, "c0": c0})[0]
        return m[0, 0, :T], coefs[0, :T]

    def channel(self, x: np.ndarray, atten_lim_db: float | None = None,
                progress: Callable[[float], None] | None = None, chunk_s: float = 20, ctx_s: float = 1.5) -> np.ndarray:
        """یک کانال صدا (۴۸ کیلوهرتز، float32) ← همان طول، بدون نویز."""
        n = len(x)
        spec = analysis(np.pad(x.astype(np.float32), (0, FFT)))
        T = spec.shape[0]
        fe_all = _erb_feat(spec)
        fs_all = _unit_norm(spec[:, :NB_DF])
        m_all = np.empty((T, NB_ERB), np.float32)
        co_all = np.empty((T, NB_DF, ORDER * 2), np.float32)
        step, ctx = int(chunk_s * SR / HOP), int(ctx_s * SR / HOP)
        # تکه‌تکه با کمی هم‌پوشانی تا حافظه کم بماند (شبکه از هر طرف ۱٫۵ ثانیه زمینه دارد)
        for a in range(0, T, step):
            b = min(T, a + step)
            a0, b0 = max(0, a - ctx), min(T, b + ctx)
            fe = fe_all[a0:b0][None, None]
            fs = np.stack([fs_all[a0:b0].real, fs_all[a0:b0].imag])[None].astype(np.float32)
            m, co = self._models(fe, fs)
            m_all[a:b] = m[a - a0:b - a0]
            co_all[a:b] = co[a - a0:b - a0]
            if progress:
                progress(b / T)
        e = spec * (m_all @ ERB_INV)                      # ماسک ERB روی کل طیف
        coefs = co_all.reshape(T, NB_DF, ORDER, 2)
        coefs = coefs[..., 0] + 1j * coefs[..., 1]
        sp = np.pad(spec[:, :NB_DF], ((ORDER - 1 - DF_LA, DF_LA), (0, 0)))
        df = np.zeros((T, NB_DF), np.complex64)
        for i in range(ORDER):                            # فیلتر عمیق: ۲ فریم قبل، خودش، ۲ فریم بعد
            df += sp[i:i + T] * coefs[:, :, i]
        e[:, :NB_DF] = df
        if atten_lim_db:
            lim = 10 ** (-abs(atten_lim_db) / 20)
            e = spec * lim + e * (1 - lim)
        d = FFT - HOP
        return synthesis(e.astype(np.complex64))[d:n + d]


_inst: Denoiser | None = None
_lock = threading.Lock()


def get(threads: int = 2) -> Denoiser:
    global _inst
    with _lock:
        if _inst is None:
            _inst = Denoiser(threads)
        return _inst
