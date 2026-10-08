"use strict";
// ═════════════════════════ ریلزساز کرمان راوی (سه مرحله‌ای) ═════════════════════════
// ۱) شروع: عکس ثابت + روتیتر/تیتر/زیرتیتر + صدا   ۲) بدنه: ویدیو + دو نوشته‌ی زیر قاب + زیرنویس
// ۳) پایان: لوگوی مُهری + صدای مُهر.  همه‌ی اندازه‌ها در فضای طراحی ۱۰۸۰×۱۹۲۰ (ریلز) نگه داشته می‌شوند.
// از teaser.js: rr، setup، splitLead، drawList، KR ؛ از designer.js: drawLayer، mountRichEditor، …

const DW = 1080, DH = 1920;
const SAFE = { x: 35, y: 220, w: 1010, h: 1250 };   // ناحیه‌ی امن اینستاگرام = قاب قرمز
const BAR_H = 184;                                   // نوار قرمز پایین
const OUT_DROP = 0.25, OUT_LAND = 0.85, OUT_ANIM = 1.05;
const RL = { s: null, t: 0, playing: false, tab: 1, els: {}, media: [], raf: null, audio: null, stampAudio: null, logoBar: null, mark: null, outLogo: null };

function textL(o) {
  return { type: "text", x: 110, y: 300, w: 860, h: 80, text: "", size: 48, weight: 800, color: KR.navy, hi: KR.red, font: "Vazirmatn",
    align: "right", lh: 1.35, bg: "#ffffff", bgA: 0.85, pad: 22, radius: 22, opacity: 1, shadow: false, stroke: "", strokeW: 0, ...o };
}
function reelDefaults() {
  return {
    v: 1, title: "", quality: "1080", fit: "fit",
    s1: { media_id: null, dur: 4, gray: true, bright: 0, scale: 1, ox: 0, oy: 0 },
    texts: {
      kick: textL({ y: 300, h: 70, size: 44, weight: 800 }),
      head: textL({ y: 390, h: 250, size: 92, weight: 900, color: KR.red, hi: KR.navy, lh: 1.3 }),
      sub: textL({ y: 660, h: 80, size: 50, weight: 800 }),
    },
    audio1: { media_id: null, src: 0, at: 0, end: null, vol: 0.8, fin: true, finD: 1, fout: true, foutD: 1.5, mode: "duck", duckF: 0.25 },
    audio2: { media_id: null, src: 0, vol: 1, fin: false, finD: 0.5, fout: true, foutD: 1 },
    s2: { media_id: null, kind: null, start: 0, dur: 6, mediaDur: 0, has_audio: false, motion: "none", scale: 1, ox: 0, oy: 0, vol: 1 },
    b1: textL({ x: 60, y: 1492, w: 960, h: 84, size: 60, color: "#ffffff", hi: "#ffd23f", bg: "#000000", bgA: 0, pad: 10, shadow: true, align: "center" }),
    b2: textL({ x: 60, y: 1600, w: 960, h: 70, size: 46, weight: 700, color: "#ffffff", hi: "#ffd23f", bg: "#000000", bgA: 0, pad: 10, shadow: true, align: "center" }),
    caps: { text: "", manual: [], style: textL({ x: 80, y: 1230, w: 920, h: 150, size: 46, weight: 800, align: "center", bgA: 0.82, pad: 18, radius: 20 }) },
    s3: { hold: 1.5, stamp_id: null, stamp_vol: 1, stamp_off: 0 },
  };
}
const reelSave = () => lsSet("reelDraft", JSON.stringify(RL.s));

// ───── خط زمان ─────
function reelTL() {
  const s = RL.s;
  const d1 = Math.max(0.5, Number(s.s1.dur) || 4);
  const d2 = s.s2.media_id ? Math.max(0.5, Number(s.s2.dur) || 1) : 0;
  const d3 = OUT_ANIM + Math.max(0, Number(s.s3.hold) || 0);
  return { d1, d2, d3, outro: d1 + d2, total: +(d1 + d2 + d3).toFixed(2) };
}
function capLines() { return splitLead(RL.s.caps.text || "", 14); }
function capTimes() {
  const s = RL.s, d2 = reelTL().d2, lines = capLines();
  if (!lines.length || !d2) return [];
  const out = lines.slice(0, s.caps.manual.length).map((text, i) => ({ text, start: s.caps.manual[i][0], end: s.caps.manual[i][1] }));
  const rest = lines.slice(out.length);
  if (rest.length) {
    let a = out.length ? out[out.length - 1].end + 0.05 : 0.3;
    const wts = rest.map((l) => Math.max(3, l.split(/\s+/).length)), sum = wts.reduce((x, y) => x + y, 0);
    const span = Math.max(0.8 * rest.length, d2 - 0.2 - a);
    rest.forEach((text, i) => { const d = (span * wts[i]) / sum; out.push({ text, start: +a.toFixed(2), end: +(a + d - 0.05).toFixed(2) }); a += d; });
  }
  return out;
}

// ───── رسانه‌ها ─────
function rlEl(id, kind) {
  if (!id) return null;
  if (!RL.els[id]) {
    let el;
    if (kind === "video") {
      el = document.createElement("video");
      el.muted = true; el.playsInline = true; el.preload = "auto";
      el.addEventListener("seeked", () => !RL.playing && reelDraw());
      el.addEventListener("loadeddata", () => !RL.playing && reelDraw());
    } else { el = new Image(); el.onload = () => reelDraw(); }
    el.src = `/api/media/${id}/file`;
    RL.els[id] = el;
  }
  return RL.els[id];
}
function rlImg(src) { const im = new Image(); im.onload = () => reelDraw(); im.src = src; return im; }

// عکس/ویدیو در قاب (همان حساب سرور: پر کردن، کامل با پس‌زمینه‌ی تار، کامل روی سیاه)
function rlMedia(ctx, el, fr, opt = {}) {
  const sw = el.videoWidth || el.naturalWidth, sh = el.videoHeight || el.naturalHeight;
  if (!sw || !sh) return;
  const sc = Number(fr.scale) || 1, ox = Number(fr.ox) || 0, oy = Number(fr.oy) || 0, fit = RL.s.fit;
  const filt = [opt.gray ? "grayscale(1)" : "", opt.bright ? `brightness(${(1 + Number(opt.bright)).toFixed(2)})` : ""].filter(Boolean).join(" ");
  const cover = Math.max(DW / sw, DH / sh), contain = Math.min(DW / sw, DH / sh);
  const z = opt.zoom || 1, px = opt.pan || 0;
  ctx.save();
  if (fit === "blur") {
    ctx.filter = `blur(36px) brightness(0.8) ${filt}`;
    ctx.drawImage(el, (DW - sw * cover) / 2 - 60, (DH - sh * cover) / 2 - 60, sw * cover + 120, sh * cover + 120);
  }
  ctx.filter = filt || "none";
  if (fit === "crop") {
    const k = cover * Math.max(1, sc) * z, dw = sw * k, dh = sh * k;
    const x = Math.max(DW - dw, Math.min(0, (DW - dw) / 2 + ox * DW - px * (dw - DW) / 2)), y = Math.max(DH - dh, Math.min(0, (DH - dh) / 2 + oy * DH));
    ctx.drawImage(el, x, y, dw, dh);
  } else {
    const dw = sw * contain * sc * z, dh = sh * contain * sc * z;
    ctx.drawImage(el, (DW - dw) / 2 + ox * DW - px * dw * 0.06, (DH - dh) / 2 + oy * DH, dw, dh);
  }
  ctx.restore();
}
function rlMediaRect(id, kind, fr) {
  const el = rlEl(id, kind);
  const sw = el?.videoWidth || el?.naturalWidth, sh = el?.videoHeight || el?.naturalHeight;
  if (!sw || !sh || RL.s.fit === "crop") return { x: 0, y: 0, w: DW, h: DH };
  const k = Math.min(DW / sw, DH / sh) * (Number(fr.scale) || 1), dw = sw * k, dh = sh * k;
  return { x: (DW - dw) / 2 + (fr.ox || 0) * DW, y: (DH - dh) / 2 + (fr.oy || 0) * DH, w: dw, h: dh };
}

// ───── قالب: REC، قاب قرمز، نوار قرمز پایین ─────
function rlChrome(ctx, light) {
  setup(ctx);
  // چراغ ضبط
  const ry = SAFE.y / 2, rx = SAFE.x + 32, r0 = 19;
  ctx.save(); ctx.shadowColor = "rgba(255,40,40,.9)"; ctx.shadowBlur = 26;
  ctx.fillStyle = light ? "#d62828" : "#ff2a2a"; ctx.beginPath(); ctx.arc(rx, ry, r0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.fillStyle = light ? KR.navy : "#ffffff"; ctx.textAlign = "left"; ctx.direction = "ltr"; ctx.font = `800 48px ${fontStack("Vazirmatn")}`;
  ctx.fillText("REC", rx + r0 * 1.9, ry + 3); ctx.direction = "rtl";
  // قاب قرمز روی ناحیه‌ی امن
  ctx.strokeStyle = "rgba(157,24,25,.96)"; ctx.lineWidth = 13;
  rr(ctx, SAFE.x, SAFE.y, SAFE.w, SAFE.h, 38); ctx.stroke();
  // نوار قرمز پایین: آدرس سایت چپ، لوگو راست
  ctx.fillStyle = KR.red; ctx.fillRect(0, DH - BAR_H, DW, BAR_H);
  if (RL.logoBar?.naturalWidth) {
    const lh = BAR_H * 0.8, lw = lh * RL.logoBar.naturalWidth / RL.logoBar.naturalHeight;
    ctx.drawImage(RL.logoBar, DW - 43 - lw, DH - BAR_H + (BAR_H - lh) / 2, lw, lh);
  }
  ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.direction = "ltr"; ctx.font = `800 ${BAR_H * 0.36}px ${fontStack("Vazirmatn")}`;
  ctx.fillText(RL.s.url ?? "www.kermanravi.ir", 54, DH - BAR_H / 2 + 5); ctx.direction = "rtl";
}

// لوگوی پایان (طاق و ،، + «کرمان راوی» در کادر قرمز) — مثل فایل GIF
function rlOutroLogo() {
  if (RL.outLogo) return RL.outLogo;
  if (!RL.mark?.naturalWidth) return null;
  const mw = 400, mh = mw * RL.mark.naturalHeight / RL.mark.naturalWidth, bw = 520, bh = 112, gap = 26;
  const c = document.createElement("canvas");
  c.width = bw + 40; c.height = Math.ceil(mh + gap + bh + 40);
  const x = c.getContext("2d");
  x.drawImage(RL.mark, (c.width - mw) / 2, 10, mw, mh);
  x.save(); x.shadowColor = "rgba(0,0,0,.25)"; x.shadowBlur = 14; x.shadowOffsetY = 6;
  x.fillStyle = KR.red; x.fillRect((c.width - bw) / 2, 10 + mh + gap, bw, bh); x.restore();
  setup(x); x.fillStyle = "#fff"; x.textAlign = "center"; x.font = `900 76px ${fontStack("Vazirmatn")}`;
  x.fillText("کرمان راوی", c.width / 2, 10 + mh + gap + bh / 2 + 4);
  if (document.fonts?.check?.(`900 40px Vazirmatn`)) RL.outLogo = c;
  return c;
}
const OUT_W = 0.55, OUT_Y = 0.44;
function rlOutroScale(t) {
  if (t < OUT_DROP) return 2.3;
  if (t < OUT_LAND) return 1 + 1.3 * Math.pow(1 - (t - OUT_DROP) / (OUT_LAND - OUT_DROP), 2);
  return 1 - 0.05 * Math.sin(Math.PI * Math.min(1, (t - OUT_LAND) / 0.18));
}
// پس‌زمینه‌ی پایان: سورمه‌ای خود مُهر (#193153) با ۴۰٪ پررنگی روی سفید
const OUT_BG = "#a3adba";
function rlOutroBg(ctx) { ctx.fillStyle = OUT_BG; ctx.fillRect(0, 0, DW, DH); rlChrome(ctx, true); }
function rlOutro(ctx, lt) {
  rlOutroBg(ctx);
  const lg = rlOutroLogo();
  if (!lg) return;
  const a = lt < OUT_DROP ? 0 : Math.min(1, (lt - OUT_DROP) / ((OUT_LAND - OUT_DROP) * 0.75));
  const w = DW * OUT_W * rlOutroScale(lt), h = w * lg.height / lg.width;
  ctx.save(); ctx.globalAlpha = a; ctx.drawImage(lg, (DW - w) / 2, DH * OUT_Y - h / 2, w, h); ctx.restore();
}

// ───── کشیدن یک فریم در زمان t ─────
function rlFrame(ctx, t, opt = {}) {
  const s = RL.s, tl = reelTL();
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, DW, DH);
  if (t >= tl.outro) { rlOutro(ctx, t - tl.outro); return; }
  if (t < tl.d1) {
    const el = rlEl(s.s1.media_id, "image");
    if (el?.naturalWidth) rlMedia(ctx, el, s.s1, { gray: s.s1.gray, bright: s.s1.bright });
    if (!opt.noText) for (const k of ["kick", "head", "sub"]) if (!s.texts[k].hidden && s.texts[k].text.trim()) drawLayer(ctx, s.texts[k]);
  } else {
    const lt = t - tl.d1, c = s.s2, el = rlEl(c.media_id, c.kind);
    if (el) {
      if (c.kind === "video") {
        const want = (Number(c.start) || 0) + lt;
        if (!RL.playing && el.readyState >= 1 && Math.abs(el.currentTime - want) > 0.15) el.currentTime = want;
        if (el.readyState >= 2) rlMedia(ctx, el, c, {});
      } else if (el.naturalWidth) {
        const p = lt / tl.d2;
        rlMedia(ctx, el, c, { zoom: c.motion === "zoom" ? 1 + 0.08 * p : c.motion === "pan" ? 1.12 : 1, pan: c.motion === "pan" ? (p - 0.5) * 2 : 0 });
      }
    }
    if (!opt.noText) {
      for (const k of ["b1", "b2"]) if (!s[k].hidden && s[k].text.trim()) drawLayer(ctx, s[k]);
      const cap = capTimes().find((x) => lt >= x.start && lt < x.end);
      if (cap) drawLayer(ctx, { ...s.caps.style, text: cap.text, runs: null });
    }
  }
  if (!opt.noChrome) rlChrome(ctx, false);
}

function reelDraw() {
  const cv = $("#rl-canvas");
  if (!cv) return;
  const [W, H] = META.teaser_sizes["9:16"] || [720, 1280];
  if (cv.width !== W) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext("2d");
  const tl = reelTL();
  const t = Math.min(RL.t, Math.max(0, tl.total - 0.01));
  ctx.save(); ctx.scale(W / DW, H / DH);
  rlFrame(ctx, t);
  // کادر انتخاب متنِ در حال جابه‌جایی
  if (RL.sel && !RL.playing) {
    const L = rlTextByKey(RL.sel);
    if (L && rlTextVisible(RL.sel, t)) { ctx.save(); ctx.strokeStyle = "#1e90ff"; ctx.lineWidth = 4; ctx.setLineDash([14, 8]); ctx.strokeRect(L.x, L.y, L.w, Math.max(L.h, 40)); ctx.restore(); }
  }
  ctx.restore();
  const range = $("#rl-range");
  if (range) { range.max = tl.total; range.value = t; }
  const lbl = $("#rl-time");
  if (lbl) lbl.textContent = `${num(t.toFixed(1))} / ${num(tl.total.toFixed(1))} ث · ${t < tl.d1 ? "شروع" : t < tl.outro ? "بدنه" : "پایان"}`;
  if (!RL.playing) rlSoundInd();
}

const rlTextByKey = (k) => (["kick", "head", "sub"].includes(k) ? RL.s.texts[k] : k === "caps" ? RL.s.caps.style : RL.s[k]);
function rlTextVisible(k, t) {
  const tl = reelTL();
  if (["kick", "head", "sub"].includes(k)) return t < tl.d1;
  if (["b1", "b2", "caps"].includes(k)) return t >= tl.d1 && t < tl.outro;
  return false;
}

// ───── پخش پیش‌نمایش (با صدا) ─────
function rlStop() {
  RL.playing = false;
  cancelAnimationFrame(RL.raf);
  for (const el of Object.values(RL.els)) if (el.pause) { el.pause(); el.muted = true; }
  RL.audio?.pause(); RL.audio = null;
  RL.audio2?.pause(); RL.audio2 = null;
  RL.stampAudio?.pause(); RL.stampAudio = null;
  const b = $("#rl-play"); if (b) b.textContent = "▶";
  rlSoundInd();
}

// یک عنصر صدا که همین حالا (داخل کلیک کاربر) یک بار بی‌صدا پخش و متوقف می‌شود تا بعداً مجاز به پخش باشد
function rlAudioEl(id, label) {
  const a = new Audio(`/api/media/${id}/file`);
  a.preload = "auto"; a.dataset.label = label;
  a.addEventListener("error", () => toast(`«${label}» در مرورگر پخش نشد (فایل باز نمی‌شود یا قالبش پشتیبانی نمی‌شود). در ویدیوی ساخته‌شده معمولاً مشکلی ندارد؛ برای اطمینان فایل را mp3 کنید.`, 8000), { once: true });
  a.muted = true;
  a.play().then(() => { if (a.dataset.live !== "1") a.pause(); a.muted = false; }).catch(() => { a.muted = false; });
  return a;
}
function rlPlayEl(el) {
  el.dataset.live = "1"; el.muted = el.tagName === "VIDEO" ? el.muted : false;
  const p = el.play();
  if (p) p.catch((e) => {
    if (e.name === "AbortError") return;
    if (e.name === "NotAllowedError") toast("مرورگر اجازه‌ی پخش صدا را نداد؛ یک بار روی صفحه بزنید و دوباره ▶ را بزنید.", 7000);
    else toast(`«${el.dataset.label || "صدا"}» پخش نشد: ${e.message || e.name}`, 7000);
  });
}

// زیر پیش‌نمایش: کدام صداها همین لحظه پخش می‌شوند (و با چه بلندی)
function rlSoundInd() {
  const box = $("#rl-snd-ind");
  if (!box || !RL.s) return;
  const s = RL.s, tl = reelTL(), t = RL.t, snd = rlSound(), out = [];
  const pct = (v) => `${num(Math.round(v * 100))}٪`;
  const t1 = rlTrack1();
  if (t1 && t >= t1.at && t < t1.at + t1.dur) {
    let v = t1.vol; for (const [a, b, f] of t1.duck) if (t >= a && t < b) v *= f;
    out.push(`🎵 مرحله‌ی ۱ ${pct(v)}`);
  }
  const t2 = rlTrack2();
  if (t2 && t >= t2.at && t < t2.at + t2.dur) out.push(`🎧 صدای جداگانه ${pct(t2.vol)}`);
  if (t >= tl.d1 && t < tl.outro && snd.video) out.push(`🎞 صدای ویدیو ${pct(s.s2.vol ?? 1)}`);
  if (s.s3.stamp_id && t >= tl.outro + OUT_LAND - 0.1 && t < tl.outro + OUT_LAND + 1) out.push("🔨 مُهر");
  box.textContent = out.length ? `${RL.playing ? "🔊 در حال پخش: " : "🔈 در این لحظه: "}${out.join(" · ")}` : "🔇 در این لحظه صدایی نیست";
}
function rlPlay() {
  if (RL.playing) return rlStop();
  if (RL.listen) { RL.listen.pause(); if (RL.listen.btn) RL.listen.btn.textContent = "🎧 گوش دادن"; RL.listen = null; }
  const s = RL.s, tl = reelTL();
  if (RL.t >= tl.total - 0.05) RL.t = 0;
  RL.playing = true;
  $("#rl-play").textContent = "⏸";
  const t0 = performance.now(), from = RL.t;
  const a1 = s.audio1;
  let stamped = from > tl.outro + OUT_LAND;
  // همه‌ی صداها همین لحظه (داخل کلیک) آماده و «باز» می‌شوند تا مرورگر بعداً جلوی پخششان را نگیرد
  if (a1.media_id) RL.audio = rlAudioEl(a1.media_id, "صدای مرحله‌ی ۱");
  if (s.audio2?.media_id && tl.d2) RL.audio2 = rlAudioEl(s.audio2.media_id, "صدای جداگانه‌ی مرحله‌ی ۲");
  if (s.s3.stamp_id && !stamped) RL.stampAudio = rlAudioEl(s.s3.stamp_id, "صدای مُهر");
  const vEl = s.s2.kind === "video" && s.s2.media_id ? rlEl(s.s2.media_id, "video") : null;
  if (vEl) { vEl.muted = true; vEl.play().then(() => { if (!vStarted) vEl.pause(); }).catch(() => {}); }
  let vStarted = false;
  const step = () => {
    if (!RL.playing) return;
    RL.t = from + (performance.now() - t0) / 1000;
    if (RL.t >= tl.total) { rlStop(); RL.t = tl.total - 0.01; reelDraw(); return; }
    const t = RL.t;
    // ویدیو
    const c = s.s2, el = c.kind === "video" ? rlEl(c.media_id, "video") : null;
    if (el) {
      if (t >= tl.d1 && t < tl.outro) {
        if (!vStarted) { el.currentTime = (Number(c.start) || 0) + (t - tl.d1); el.muted = !rlSound().video; el.volume = Math.min(1, c.vol ?? 1); rlPlayEl(el); vStarted = true; }
      } else if (vStarted) { el.pause(); vStarted = false; }
    }
    // صدای مرحله‌ی ۱ (با محو شدن و کم شدن هنگام ویدیو)
    if (RL.audio) {
      const tr = rlTrack1(), inR = tr && t >= tr.at && t < tr.at + tr.dur;
      if (inR) {
        const lt = t - tr.at;
        let v = tr.vol;
        if (tr.fin) v *= Math.min(1, lt / tr.fin);
        if (tr.fout) v *= Math.min(1, (tr.dur - lt) / tr.fout);
        for (const [a, b, f] of tr.duck) if (t >= a && t < b) v *= f;
        RL.audio.volume = Math.max(0, Math.min(1, v));
        if (RL.audio.paused) { RL.audio.currentTime = tr.src + lt; rlPlayEl(RL.audio); }
      } else if (!RL.audio.paused) RL.audio.pause();
    }
    // صدای جداگانه‌ی مرحله‌ی ۲
    if (RL.audio2) {
      const tr = rlTrack2(), inR = tr && t >= tr.at && t < tr.at + tr.dur;
      if (inR) {
        const lt = t - tr.at;
        let v = tr.vol;
        if (tr.fin) v *= Math.min(1, lt / tr.fin);
        if (tr.fout) v *= Math.min(1, (tr.dur - lt) / tr.fout);
        RL.audio2.volume = Math.max(0, Math.min(1, v));
        if (RL.audio2.paused) { RL.audio2.currentTime = tr.src + lt; rlPlayEl(RL.audio2); }
      } else if (!RL.audio2.paused) RL.audio2.pause();
    }
    // صدای مُهر
    if (!stamped && RL.stampAudio && t >= tl.outro + OUT_LAND + (Number(s.s3.stamp_off) || 0)) {
      stamped = true;
      RL.stampAudio.currentTime = 0;
      RL.stampAudio.volume = Math.min(1, Number(s.s3.stamp_vol) || 1);
      rlPlayEl(RL.stampAudio);
    }
    reelDraw();
    rlSoundInd();
    RL.raf = requestAnimationFrame(step);
  };
  step();
}

// صداهای مرحله‌ی ۲: صدای خود ویدیو، ادامه‌ی صدای مرحله‌ی ۱، صدای جداگانه (هر سه مستقل از هم)
// (پیش‌نویس‌های قدیمی فقط «mode» داشتند؛ از روی آن مقدار پیش‌فرض ساخته می‌شود)
function rlSound() {
  const s = RL.s, a = s.audio1, c = s.s2, mode = a.mode || "duck";
  return {
    video: c.kind === "video" && !!c.has_audio && (c.sound ?? mode !== "music_only"),
    cont: !!a.media_id && (a.s2on ?? mode !== "cut"),
    level: Math.max(0, Math.min(1, Number(a.s2vol ?? (mode === "duck" ? a.duckF ?? 0.25 : 1)))),
  };
}

// مشخصات صدای مرحله‌ی ۱ روی خط زمان (هم برای پیش‌نمایش، هم برای سرور)
function rlTrack1() {
  const s = RL.s, a = s.audio1, tl = reelTL(), snd = rlSound();
  if (!a.media_id) return null;
  const at = Math.max(0, Math.min(tl.total - 0.2, Number(a.at) || 0));
  let end = a.end == null || a.end === "" ? tl.outro + 0.3 : Math.min(tl.total, Number(a.end));
  if (!snd.cont && tl.d2) end = Math.min(end, tl.d1);
  const dur = Math.max(0.2, end - at);
  const duck = snd.cont && tl.d2 && snd.level < 0.999 ? [[tl.d1, tl.outro, snd.level]] : [];
  return { media_id: a.media_id, src: Number(a.src) || 0, at, dur, vol: Number(a.vol) || 0, fin: a.fin ? Number(a.finD) || 1 : 0,
    fout: a.fout ? Number(a.foutD) || 1.5 : 0, duck, loop: true };
}

// صدای جداگانه‌ی مرحله‌ی ۲: فقط در طول همین بخش پخش می‌شود
function rlTrack2() {
  const s = RL.s, a = s.audio2, tl = reelTL();
  if (!a?.media_id || !tl.d2) return null;
  return { media_id: a.media_id, src: Number(a.src) || 0, at: tl.d1, dur: tl.d2, vol: Number(a.vol ?? 1),
    fin: a.fin ? Number(a.finD) || 0.5 : 0, fout: a.fout ? Number(a.foutD) || 1 : 0, duck: [], loop: true };
}

// ───── ساخت ویدیو ─────
async function reelRender() {
  const s = RL.s, tl = reelTL();
  if (!s.s1.media_id) return toast("اول عکس شروع را انتخاب کنید (مرحله‌ی ۱)");
  // دکمه فقط در زبانه‌ی «ساخت» است؛ ساخت خودکار (از پیشنهاد سوژه) بدون آن هم کار کند
  const btn = $("#rl-render") || { disabled: false, textContent: "" };
  btn.disabled = true; btn.textContent = "در حال آماده‌سازی…";
  toast("در حال آماده‌سازی ویدیو…", 4000);
  try {
    if (document.fonts) await document.fonts.ready;
    await FONTS_READY;
    await Promise.all([RL.logoBar, RL.mark].map((im) => im?.complete ? 0 : new Promise((r) => { im.onload = r; im.onerror = r; })));
    RL.outLogo = null;
    const [RW, RH] = s.quality === "1080" ? [1080, 1920] : [720, 1280];
    const shot = (fn) => {
      const c = document.createElement("canvas"); c.width = RW; c.height = RH;
      const x = c.getContext("2d"); x.scale(RW / DW, RH / DH); fn(x); return c.toDataURL("image/png");
    };
    const overlays = [];
    overlays.push({ image: shot((x) => rlChrome(x, false)), start: 0, end: tl.outro });
    const t1 = ["kick", "head", "sub"].map((k) => s.texts[k]).filter((L) => !L.hidden && L.text.trim());
    if (t1.length) overlays.push({ image: shot((x) => t1.forEach((L) => drawLayer(x, L))), start: 0, end: tl.d1 });
    if (tl.d2) {
      const t2 = ["b1", "b2"].map((k) => s[k]).filter((L) => !L.hidden && L.text.trim());
      if (t2.length) overlays.push({ image: shot((x) => t2.forEach((L) => drawLayer(x, L))), start: tl.d1, end: tl.outro });
      for (const c of capTimes()) overlays.push({ image: shot((x) => drawLayer(x, { ...s.caps.style, text: c.text, runs: null })), start: +(tl.d1 + c.start).toFixed(2), end: +(tl.d1 + c.end).toFixed(2) });
    }
    const lg = rlOutroLogo();
    const clips = [{ media_id: s.s1.media_id, duration: tl.d1, gray: !!s.s1.gray, bright: Number(s.s1.bright) || 0, scale: s.s1.scale, ox: s.s1.ox, oy: s.s1.oy, motion: "none", zoom: false }];
    if (tl.d2) clips.push({ media_id: s.s2.media_id, start: s.s2.start || 0, duration: tl.d2, scale: s.s2.scale, ox: s.s2.ox, oy: s.s2.oy,
      motion: s.s2.motion, zoom: s.s2.motion === "zoom", mute: !rlSound().video, vol: Number(s.s2.vol ?? 1) });
    clips.push({ outro: { bg: shot((x) => rlOutroBg(x)), logo: lg.toDataURL("image/png"), duration: tl.d3, logo_w: OUT_W, logo_y: OUT_Y, drop: OUT_DROP, land: OUT_LAND } });
    const tracks = [];
    const t1r = rlTrack1();
    if (t1r) tracks.push(t1r);
    const t2r = rlTrack2();
    if (t2r) tracks.push(t2r);
    if (s.s3.stamp_id) tracks.push({ media_id: s.s3.stamp_id, src: 0, at: Math.max(0, tl.outro + OUT_LAND + (Number(s.s3.stamp_off) || 0) - 0.02), dur: Math.min(3, tl.d3), vol: Number(s.s3.stamp_vol) || 1, fin: 0, fout: 0.2, loop: false, duck: [] });
    btn.textContent = "در حال فرستادن…";
    const head = (s.texts.head.text || "").replace(/\n/g, " ").trim();
    await api("/api/teasers", { method: "POST", body: {
      title: s.title || head || "ریلز کرمان راوی", format: "9:16", quality: s.quality, fit: s.fit, clips, overlays, tracks,
      keep_audio: true, video_volume: 1, fade: false, transition: "none", bg_color: "#000000",
      captions: capTimes().map((c) => ({ text: c.text, start: tl.d1 + c.start, end: tl.d1 + c.end })), editor: { kr3: s } } });
    toast("در صف ساخت قرار گرفت 🎬 وقتی آماده شد خبرتان می‌کنیم.", 4000);
    drawList(await api("/api/teasers"));
  } catch (err) { if (!(err instanceof LoginRequired)) toast(err.message, 6000); }
  btn.disabled = false; btn.textContent = "🎬 ساخت ویدیو";
}

// ───── رابط کاربری ─────
async function rlUpload(accept, onDone) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = accept;
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    toast("در حال بارگذاری…", 60000);
    const r = await uploadOne("/api/media", f, {}, (p) => toast(`در حال بارگذاری… ${num(Math.round(p * 100))}٪`, 60000));
    if (!r.ok) return toast(r.error);
    toast("بارگذاری شد ✔");
    const m = r.data.added[0];
    RL.media.unshift(m);
    onDone(m);
  };
  inp.click();
}
function rlMediaSelect(kinds, cur, attr) {
  const items = RL.media.filter((m) => kinds.includes(m.kind) && (m.kind !== "video" || kinds.includes("video") || m.has_audio));
  return `<select ${attr}><option value="">— از فایل‌های قبلی —</option>${items.map((m) => `<option value="${m.id}" ${m.id === cur ? "selected" : ""}>${esc(m.filename)}${m.duration ? ` (${num(Math.round(m.duration))} ث)` : ""}</option>`).join("")}</select>`;
}

// کادر ویرایش یک متن (روتیتر، تیتر، …): متن غنی + فونت، اندازه، رنگ، شفافیت کادر، عرض، چینش
function rlTextBox(key, label, hint) {
  const L = rlTextByKey(key);
  return `<div class="rl-tx card" data-tx="${key}">
    <div class="rl-tx-h"><b>${label}</b>${hint ? `<small class="muted">${hint}</small>` : ""}
      ${key !== "caps" ? `<label class="small"><input type="checkbox" data-tk="hidden" ${L.hidden ? "" : "checked"}> نمایش</label>` : ""}</div>
    ${key === "caps" ? "" : `${richToolbarHTML()}${richBoxHTML(L)}`}
    <div class="rl-grid">
      <label>فونت<span class="btn-row"><select data-tk="font">${fontOptions(L.font || "Vazirmatn")}</select><button type="button" class="btn sm" data-addfont title="بارگذاری فایل فونت (ttf، otf، woff یا فایل زیپ دانلودشده)">➕ افزودن فونت</button></span></label>
      <label>اندازه <small>${num(Math.round(L.size))}</small><input type="range" min="18" max="200" data-tk="size" value="${L.size}"></label>
      <label>رنگ متن<input type="color" data-tk="color" value="${L.color}"></label>
      ${key === "caps" ? `<label>رنگ واژه‌های *ستاره‌دار*<input type="color" data-tk="hi" value="${L.hi}"></label>` : ""}
      <label>ضخامت<select data-tk="weight">${[[400, "معمولی"], [700, "پررنگ"], [800, "پررنگ‌تر"], [900, "خیلی پررنگ"]].map(([v, l]) => `<option value="${v}" ${+L.weight === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>شفافیت کادر سفید <small>${num(Math.round((L.bgA ?? 0) * 100))}٪</small><input type="range" min="0" max="1" step="0.05" data-tk="bgA" value="${L.bgA ?? 0}"></label>
      <label>رنگ کادر<input type="color" data-tk="bg" value="${/^#[0-9a-f]{6}$/i.test(L.bg || "") ? L.bg : "#ffffff"}"></label>
      <label>عرض کادر<input type="range" min="200" max="1010" data-tk="w" value="${Math.round(L.w)}"></label>
      <label>چینش<select data-tk="align">${[["right", "راست"], ["center", "وسط"], ["left", "چپ"], ["justify", "تراز"]].map(([v, l]) => `<option value="${v}" ${L.align === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label><span><input type="checkbox" data-tk="shadow" ${L.shadow ? "checked" : ""}> سایه‌ی نوشته</span></label>
    </div>
    <p class="small muted" style="margin:4px 0 0">👆 جای این کادر را روی پیش‌نمایش با انگشت بکشید.</p>
  </div>`;
}
function rlBindTextBoxes(root) {
  $$(".rl-tx", root).forEach((box) => {
    const key = box.dataset.tx, L = () => rlTextByKey(key);
    const jump = () => { const tl = reelTL(); if (!rlTextVisible(key, RL.t)) { RL.t = ["kick", "head", "sub"].includes(key) ? Math.min(1, tl.d1 / 2) : tl.d1 + 0.5; } RL.sel = key; };
    const rich = $(".dz-rich", box) ? mountRichEditor(box, L, () => { reelSave(); reelDraw(); }, () => { jump(); }) : null;
    // پس از لغو انتخاب، کنترل‌ها دوباره مقدارِ کل متن را نشان دهند
    const showWhole = () => {
      const T = L();
      for (const [k, v] of [["size", T.size], ["color", T.color], ["weight", T.weight], ["font", T.font || "Vazirmatn"]]) {
        const el = $(`[data-tk=${k}]`, box); if (el) el.value = v;
      }
      const sm = $("[data-tk=size]", box)?.parentElement.querySelector("small"); if (sm) sm.textContent = num(Math.round(T.size));
    };
    if (rich) rich.onClear = showWhole;
    box.addEventListener("focusin", () => { jump(); reelDraw(); });
    $$("[data-tk]", box).forEach((el) => el.addEventListener(el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input", () => {
      const k = el.dataset.tk;
      let v = el.type === "checkbox" ? el.checked : el.value;
      if (k === "hidden") v = !el.checked;
      if (["size", "bgA", "w", "weight"].includes(k)) v = Number(v);
      // بخشی از متن انتخاب شده: فقط همان بخش تغییر کند
      if (rich?.hasSel() && ["size", "font", "color", "weight"].includes(k)) {
        rich.style(k, v);
        const sm0 = el.parentElement.querySelector("small"); if (sm0 && k === "size") sm0.textContent = num(Math.round(v));
        jump(); reelDraw();
        return;
      }
      L()[k] = v;
      if (unifyRuns(L(), k) && $(".dz-rich", box)) $(".dz-rich", box).innerHTML = runsToHTML(L());
      const sm = el.parentElement.querySelector("small");
      if (sm && k === "size") sm.textContent = num(Math.round(v));
      if (sm && k === "bgA") sm.textContent = `${num(Math.round(v * 100))}٪`;
      reelSave(); jump(); reelDraw();
      // رنگ/فونت کلی ← ظاهر کادر ویرایش هم عوض شود
      if (["color", "font", "weight"].includes(k) && $(".dz-rich", box)) { const ed = $(".dz-rich", box); ed.style.color = L().color; ed.style.fontFamily = fontStack(L().font); ed.style.fontWeight = L().weight; }
    }));
    const af = $("[data-addfont]", box);
    if (af) af.onclick = () => pickFontFile((fam) => { L().font = fam; reelSave(); rlPanel(); reelDraw(); });
  });
}

const RL_TABS = [[1, "۱ شروع"], [2, "۲ بدنه"], [3, "۳ پایان"], [4, "🎬 ساخت"]];
function rlPanel() {
  const box = $("#rl-panel");
  if (!box) return;
  const s = RL.s, tl = reelTL();
  $("#rl-tabs").innerHTML = RL_TABS.map(([k, l]) => `<button class="${RL.tab === k ? "active" : ""}" data-tab="${k}">${l}</button>`).join("");
  $$("#rl-tabs [data-tab]").forEach((b) => (b.onclick = () => { RL.tab = Number(b.dataset.tab); RL.sel = null; rlPanel(); rlJumpTab(); }));
  let h = "";
  if (RL.tab === 1) {
    const a = s.audio1;
    h = `<div class="card"><h3>🖼 عکس شروع</h3>
        <div class="btn-row"><button class="btn primary" id="rl-img1">📷 انتخاب عکس</button>${rlMediaSelect(["image"], s.s1.media_id, 'id="rl-img1-lib"')}</div>
        <div class="rl-grid" style="margin-top:8px">
          <label>مدت نمایش (ثانیه)<input type="number" min="0.5" max="30" step="0.5" id="rl-d1" value="${s.s1.dur}"></label>
          <label><span><input type="checkbox" id="rl-gray" ${s.s1.gray ? "checked" : ""}> سیاه‌وسفید</span></label>
          <label>نور <small id="rl-bv">${num(Math.round((s.s1.bright || 0) * 100))}</small><input type="range" min="-0.6" max="0.6" step="0.02" id="rl-bright" value="${s.s1.bright || 0}"></label>
          <label>اندازه<span class="btn-row"><button class="btn sm" data-sz="s1:0.9">−</button><b>${num(Math.round((s.s1.scale || 1) * 100))}٪</b><button class="btn sm" data-sz="s1:1.1">+</button><button class="btn sm ghost" data-szr="s1">↺</button></span></label>
        </div>
        <p class="small muted">👆 عکس را روی پیش‌نمایش با انگشت بکشید تا جابه‌جا شود؛ با دو انگشت یا چرخ موس بزرگ و کوچک کنید.</p></div>
      ${rlTextBox("kick", "روتیتر")}${rlTextBox("head", "تیتر", "هر Enter یک سطر تازه")}${rlTextBox("sub", "زیرتیتر")}
      <div class="card"><h3>🎵 صدا</h3>
        <div class="btn-row"><button class="btn" id="rl-aud">🎵 بارگذاری فایل صوتی</button>${rlMediaSelect(["audio", "video"], a.media_id, 'id="rl-aud-lib"')}
          ${a.media_id ? `<button class="btn sm" data-listen="a1">🎧 گوش دادن</button><button class="btn sm danger" id="rl-aud-x">حذف صدا</button>` : ""}</div>
        ${a.media_id ? `<div class="rl-grid" style="margin-top:8px">
          <label>بلندی <small>${num(Math.round(a.vol * 100))}٪</small><input type="range" min="0" max="2" step="0.05" data-a="vol" value="${a.vol}"></label>
          <label>از ثانیه‌ی چندمِ فایل صوتی<input type="number" min="0" step="0.5" data-a="src" value="${a.src}"></label>
          <label>شروع در تیزر (ثانیه)<input type="number" min="0" step="0.5" data-a="at" value="${a.at}"></label>
          <label>پایان در تیزر (ثانیه) <small>خالی = تا پایان</small><input type="number" min="0" step="0.5" data-a="end" value="${a.end ?? ""}" placeholder="${num(tl.outro.toFixed(1))}"></label>
          <label><span><input type="checkbox" data-a="fin" ${a.fin ? "checked" : ""}> آغاز آرام (محو)</span><input type="number" min="0.2" max="10" step="0.2" data-a="finD" value="${a.finD}" title="مدت محو شدن (ثانیه)"></label>
          <label><span><input type="checkbox" data-a="fout" ${a.fout ? "checked" : ""}> پایان آرام (محو)</span><input type="number" min="0.2" max="10" step="0.2" data-a="foutD" value="${a.foutD}" title="مدت محو شدن (ثانیه)"></label>
        </div><p class="small muted">تیک «آرام» را بردارید تا صدا یک‌دفعه شروع یا قطع شود. هنگام پایان مُهری، صدا خودش آرام محو می‌شود.</p>` : `<p class="small muted">موسیقی یا هر صدایی که روی تصاویر پخش شود؛ بلندی، شروع، پایان و محو شدنش قابل تنظیم است.</p>`}
      </div>`;
  } else if (RL.tab === 2) {
    const c = s.s2, a = s.audio1;
    h = `<div class="card"><h3>🎞 ویدیو یا تصویر متحرک</h3>
        <div class="btn-row"><button class="btn primary" id="rl-vid">⬆️ بارگذاری ویدیو / GIF / عکس</button>${rlMediaSelect(["video", "image"], c.media_id, 'id="rl-vid-lib"')}
          ${c.media_id ? `<button class="btn sm danger" id="rl-vid-x">حذف</button>` : ""}</div>
        ${c.media_id && c.kind === "video" ? rlTrimHTML(c) : ""}
        ${c.media_id ? `<div class="rl-grid" style="margin-top:8px">
          ${c.kind === "video" ? "" : `<label>مدت (ثانیه)<input type="number" min="0.5" max="60" step="0.5" data-c="dur" value="${c.dur}"></label>
            <label>حرکت آرام<select data-c="motion">${[["none", "بدون حرکت"], ["zoom", "زوم آرام"], ["pan", "جابه‌جایی آرام"]].map(([v, l]) => `<option value="${v}" ${c.motion === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>`}
          <label class="wide">اندازه <small id="rl-szv">${num(Math.round((c.scale || 1) * 100))}٪</small>
            <span class="btn-row" style="flex-wrap:nowrap"><input type="range" id="rl-sz2" min="0.3" max="3" step="0.01" value="${c.scale || 1}" style="flex:1">
            <button class="btn sm ghost" data-szr="s2" title="اندازه و جای اول">↺</button></span></label>
          <label>جای ویدیو در صفحه<select id="rl-fit">${[["fit", "کامل، روی سیاه"], ["blur", "کامل، پس‌زمینه‌ی تار"], ["crop", "پر کردن کل صفحه"]].map(([v, l]) => `<option value="${v}" ${s.fit === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        </div>
        <p class="small muted" style="margin:4px 0 0">👆 جای ویدیو را روی پیش‌نمایش با انگشت بکشید.</p>        </div>` : ""}</div>
      ${rlTextBox("b1", "نوشته‌ی اول زیر قاب")}${rlTextBox("b2", "نوشته‌ی دوم زیر قاب")}
      <div class="card"><h3>💬 زیرنویس (داخل قاب، پایین)</h3>
        <div class="btn-row">
          <button class="btn primary" id="rl-asr">🎙 زیرنویس خودکار از صدای ویدیو</button>
          <button class="btn" id="rl-split">✂️ تقسیم متن بلند (لید)</button>
          <button class="btn" id="rl-tap">👆 زمان‌بندی با ضربه</button>
          ${s.caps.manual.length ? `<button class="btn sm ghost" id="rl-retime">↺ زمان خودکار</button>` : ""}
        </div>
        <div class="tz-lead">
          <b class="small">📰 لید (متن بلند) به‌جای زیرنویس جمله‌به‌جمله</b>
          <div class="btn-row">
            <select id="rl-lsrc">${[["video", "🎞 از صدای ویدیوی همین مرحله"], ["audio", "🎵 از فایل صوتی مرحله‌ی ۱"], ["audio2", "🎧 از صدای جداگانه‌ی این بخش"], ["story", "📝 از متن یک سوژه"], ["text", "📋 از متنی که در کادر زیر چسبانده‌ام"]]
              .map(([v, l]) => `<option value="${v}" ${(RL.leadSrc || "video") === v ? "selected" : ""}>${l}</option>`).join("")}</select>
            <select id="rl-lstory" ${RL.leadSrc === "story" ? "" : "hidden"}><option value="">— انتخاب سوژه —</option></select>
            <label class="small">حدود <select id="rl-ln">${[100, 150, 200, 250, 300, 400].map((n) => `<option value="${n}" ${(RL.leadN || 200) === n ? "selected" : ""}>${num(n)}</option>`).join("")}</select> کلمه</label>
            <button class="btn sm primary" id="rl-lead">✍️ ساخت لید و تقسیم به زیرنویس</button>
          </div>
          <p class="small muted" style="margin:4px 0 0">${META.ai ? "متن با هوش مصنوعی به یک لید روان خلاصه می‌شود" : "جمله‌های مهم متن انتخاب می‌شوند"}؛ بعد به زیرنویس‌های کوتاه تقسیم و در کادر زیر گذاشته می‌شود تا اگر لازم بود اصلاحش کنید.</p>
        </div>
        <label class="wide" style="display:block;margin-top:8px">هر خط یک زیرنویس <small>— واژه‌های بین دو ستاره رنگ دوم می‌گیرند: حدود *۱۴۰ مگاوات*</small>
          <textarea id="rl-caps" rows="5" style="width:100%">${esc(s.caps.text)}</textarea></label>
        <div id="rl-tapbox" class="captions" hidden></div>
        <div id="rl-times" class="captions"></div>
      </div>
      ${rlTextBox("caps", "ظاهر زیرنویس", "فونت، اندازه، رنگ و شفافیت کادر سفید")}
      <div class="card rl-snd"><h3>🔊 صدای این بخش</h3>
        <p class="small muted" style="margin-top:0">هر کدام را که بخواهید روشن کنید؛ صداهای روشن با هم پخش می‌شوند.</p>
        ${(() => {
          const snd = rlSound(), a2 = s.audio2 || {}, hasVA = c.kind === "video" && c.has_audio;
          return `<div class="snd-row"><label class="chk"><input type="checkbox" id="rl-vs" ${snd.video ? "checked" : ""} ${hasVA ? "" : "disabled"}> 🎞 صدای خود ویدیو</label>
            ${hasVA ? (snd.video ? `<label>بلندی <small>${num(Math.round((c.vol ?? 1) * 100))}٪</small><input type="range" min="0" max="2" step="0.05" data-c="vol" value="${c.vol ?? 1}"></label>` : "")
              : `<small class="muted">${!c.media_id ? "(هنوز ویدیویی نگذاشته‌اید)" : c.kind === "image" ? "(عکس صدا ندارد)" : "(این ویدیو صدا ندارد)"}</small>`}</div>
          <div class="snd-row"><label class="chk"><input type="checkbox" id="rl-a1c" ${snd.cont ? "checked" : ""} ${a.media_id ? "" : "disabled"}> 🎵 ادامه‌ی صدای مرحله‌ی ۱</label>
            ${a.media_id ? (snd.cont ? `<label>بلندی در این بخش <small>${num(Math.round(snd.level * 100))}٪</small><input type="range" min="0.05" max="1" step="0.05" id="rl-a1v" value="${snd.level}"></label>` : `<small class="muted">صدای مرحله‌ی ۱ اول این بخش قطع می‌شود</small>`)
              : `<small class="muted">(در مرحله‌ی ۱ صدایی نگذاشته‌اید)</small>`}</div>
          <div class="snd-row"><b>🎧 صدای جداگانه برای این بخش</b>
            <div class="btn-row"><button class="btn sm" id="rl-a2">🎵 بارگذاری فایل صوتی</button>${rlMediaSelect(["audio", "video"], a2.media_id, 'id="rl-a2-lib"')}
              ${a2.media_id ? `<button class="btn sm" data-listen="a2">🎧 گوش دادن</button><button class="btn sm danger" id="rl-a2-x">حذف</button>` : ""}</div>
            ${a2.media_id ? `<div class="rl-grid" style="margin-top:6px">
              <label>بلندی <small>${num(Math.round((a2.vol ?? 1) * 100))}٪</small><input type="range" min="0" max="2" step="0.05" data-a2="vol" value="${a2.vol ?? 1}"></label>
              <label>از ثانیه‌ی چندمِ فایل<input type="number" min="0" step="0.5" data-a2="src" value="${a2.src || 0}"></label>
              <label><span><input type="checkbox" data-a2="fin" ${a2.fin ? "checked" : ""}> آغاز آرام</span><input type="number" min="0.2" max="10" step="0.2" data-a2="finD" value="${a2.finD ?? 0.5}"></label>
              <label><span><input type="checkbox" data-a2="fout" ${a2.fout ? "checked" : ""}> پایان آرام</span><input type="number" min="0.2" max="10" step="0.2" data-a2="foutD" value="${a2.foutD ?? 1}"></label>
            </div><p class="small muted" style="margin:4px 0 0">از آغاز تا پایان همین بخش (${num((+tl.d2).toFixed(1))} ثانیه) پخش می‌شود؛ اگر کوتاه‌تر باشد از اول تکرار می‌شود.</p>`
              : `<p class="small muted" style="margin:4px 0 0">مثلاً وقتی جای ویدیو عکس گذاشته‌اید یا صدای ویدیو را نمی‌خواهید: گزارش صوتی، مصاحبه یا موسیقی فقط برای این بخش.</p>`}</div>`;
        })()}
      </div>`;
  } else if (RL.tab === 3) {
    const o = s.s3;
    h = `<div class="card"><h3>🔖 پایان: مُهر کرمان راوی</h3>
        <p class="small muted">لوگوی کرمان راوی بزرگ و کم‌رنگ می‌آید و مثل مُهر محکم روی صفحه می‌نشیند. صدای مُهر دقیقاً در همان لحظه پخش می‌شود.</p>
        <div class="rl-grid">
          <label>ماندن تصویر آخر (ثانیه)<input type="number" min="0" max="10" step="0.5" id="rl-hold" value="${o.hold}"></label>
        </div></div>
      <div class="card"><h3>🔊 صدای مُهر</h3>
        <div class="btn-row"><button class="btn primary" id="rl-stamp">🎵 بارگذاری صدای مُهر</button>${rlMediaSelect(["audio", "video"], o.stamp_id, 'id="rl-stamp-lib"')}
          ${o.stamp_id ? `<button class="btn sm danger" id="rl-stamp-x">حذف</button>` : ""}</div>
        ${o.stamp_id ? `<div class="rl-grid" style="margin-top:8px">
          <label>بلندی <small>${num(Math.round(o.stamp_vol * 100))}٪</small><input type="range" min="0" max="2" step="0.05" data-o="stamp_vol" value="${o.stamp_vol}"></label>
          <label>جلو / عقب کردن صدا <small>${num((+o.stamp_off).toFixed(2))} ث</small><input type="range" min="-0.6" max="0.6" step="0.02" data-o="stamp_off" value="${o.stamp_off}"></label>
        </div><button class="btn sm" id="rl-stamp-try" style="margin-top:6px">▶ دیدن و شنیدن پایان</button>` : ""}
      </div>`;
  } else {
    h = `<div class="card"><h3>🎬 ساخت ویدیو</h3>
        <div class="rl-grid">
          <label class="wide">نام (برای فهرست)<input id="rl-title" value="${esc(s.title || "")}" placeholder="خالی = تیتر"></label>
          <label>کیفیت<select id="rl-q"><option value="1080" ${s.quality === "1080" ? "selected" : ""}>۱۰۸۰ (پیشنهادی)</option><option value="720" ${s.quality === "720" ? "selected" : ""}>۷۲۰ (سریع‌تر)</option></select></label>
          <label>آدرس سایت در نوار پایین<input id="rl-url" class="ltr" value="${esc(s.url ?? "www.kermanravi.ir")}"></label>
        </div>
        <p class="small muted">مدت: شروع ${num(tl.d1)} + بدنه ${num(tl.d2)} + پایان ${num(tl.d3.toFixed(1))} = <b>${num(tl.total.toFixed(1))} ثانیه</b></p>
        <button class="btn primary big" id="rl-render">🎬 ساخت ویدیو</button></div>`;
  }
  box.innerHTML = h;
  rlBind(box);
}

// ───── ویرایش ویدیو در مرحله‌ی ۲: انتخاب شروع و پایان (بریدن) ─────
function rlTrimHTML(c) {
  return `<div class="rl-trim" id="rl-trim">
    <video id="rl-tv" src="/api/media/${c.media_id}/file" playsinline preload="auto"></video>
    <div class="rl-tt" id="rl-tt" dir="ltr">
      <canvas class="rl-strip" id="rl-strip"></canvas>
      <div class="rl-dim" id="rl-dim-l"></div><div class="rl-dim" id="rl-dim-r"></div>
      <div class="rl-sel" id="rl-sel"><span class="rl-h" data-h="s" title="شروع"></span><span class="rl-h" data-h="e" title="پایان"></span></div>
      <div class="rl-ph" id="rl-ph"></div>
    </div>
    <div class="rl-trim-info" id="rl-ti"></div>
    <div class="btn-row">
      <button class="btn sm primary" id="rl-tplay">▶ پخش بخش انتخاب‌شده</button>
      <button class="btn sm" id="rl-tset-s" title="ویدیو را تا جای دلخواه ببرید و این را بزنید">⏮ شروع از اینجا</button>
      <button class="btn sm" id="rl-tset-e">⏭ پایان اینجا</button>
      <button class="btn sm ghost" id="rl-tall" title="همه‌ی ویدیو">↔ کل ویدیو</button>
    </div>
    <div class="rl-grid">
      <label>از ثانیه<input type="number" min="0" step="0.1" data-c="start" value="${(+c.start || 0).toFixed(1)}"></label>
      <label>تا ثانیه<input type="number" min="0.5" step="0.1" id="rl-tend" value="${((+c.start || 0) + (+c.dur || 0)).toFixed(1)}"></label>
    </div>
    <p class="small muted" style="margin:2px 0 0">✂️ دو دستگیره‌ی قرمز را بکشید تا شروع و پایان ویدیو انتخاب شود؛ روی نوار بزنید تا آن لحظه را ببینید.</p>
  </div>`;
}

function rlBindTrim(box) {
  const s = RL.s, c = s.s2, v = $("#rl-tv", box), tt = $("#rl-tt", box);
  if (!v || !tt) return;
  const total = () => c.mediaDur || v.duration || 0;
  const fmt = (x) => num((+x).toFixed(1));
  const layout = () => {
    const T = total(); if (!T || !tt.isConnected) return;
    const a = (c.start || 0) / T * 100, b = Math.min(100, ((c.start || 0) + c.dur) / T * 100);
    $("#rl-sel", box).style.cssText = `left:${a}%;width:${b - a}%`;
    $("#rl-dim-l", box).style.cssText = `left:0;width:${a}%`;
    $("#rl-dim-r", box).style.cssText = `left:${b}%;right:0`;
    $("#rl-ph", box).style.left = `${Math.min(100, v.currentTime / T * 100)}%`;
    $("#rl-ti", box).innerHTML = `از <b>${fmt(c.start || 0)}</b> تا <b>${fmt((c.start || 0) + c.dur)}</b> ثانیه · مدت <b>${fmt(c.dur)}</b> ثانیه <span class="muted">(کل ویدیو ${fmt(T)})</span>`;
    const si = $("[data-c=start]", box), ei = $("#rl-tend", box);
    if (si && document.activeElement !== si) si.value = (+c.start || 0).toFixed(1);
    if (ei && document.activeElement !== ei) ei.value = ((+c.start || 0) + c.dur).toFixed(1);
  };
  const set = (a, b) => {
    const T = total() || 9999;
    a = Math.max(0, Math.min(a, T - 0.5)); b = Math.max(a + 0.5, Math.min(b, T));
    c.start = +a.toFixed(2); c.dur = +(b - a).toFixed(2);
    layout();
  };
  const done = () => { reelSave(); rlTimes(); reelDraw(); };
  // پیش‌نمایش اصلی هم همان لحظه را نشان دهد
  const showMain = (t) => { const tl = reelTL(); RL.t = tl.d1 + Math.max(0, Math.min(c.dur - 0.05, t - (c.start || 0))); reelDraw(); };
  v.addEventListener("loadedmetadata", () => {
    if (!c.mediaDur && v.duration && isFinite(v.duration)) { c.mediaDur = +v.duration.toFixed(2); set(c.start || 0, (c.start || 0) + Math.min(c.dur, 60)); reelSave(); }
    layout(); rlStrip(c, v);
  });
  let stopAt = null;
  v.addEventListener("timeupdate", () => {
    layout();
    if (stopAt != null && v.currentTime >= stopAt) { v.pause(); stopAt = null; }
  });
  // نوار زمان: کشیدن دستگیره‌ها یا زدن روی نوار برای دیدن آن لحظه
  tt.style.touchAction = "none";
  let drag = null;
  const timeAt = (ev) => { const r = tt.getBoundingClientRect(); return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * total(); };
  tt.addEventListener("pointerdown", (ev) => {
    if (!total()) return;
    tt.setPointerCapture(ev.pointerId);
    const t = timeAt(ev), r = tt.getBoundingClientRect(), px = (x) => (x / total()) * r.width;
    const dS = Math.abs(px(t) - px(c.start || 0)), dE = Math.abs(px(t) - px((c.start || 0) + c.dur));
    const h = ev.target.dataset?.h || (Math.min(dS, dE) < 22 ? (dS <= dE ? "s" : "e") : null);
    drag = h || "seek";
    if (drag === "seek") { v.currentTime = t; showMain(t); }
  });
  tt.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const t = timeAt(ev), end = (c.start || 0) + c.dur;
    if (drag === "s") { set(t, end); v.currentTime = c.start; showMain(c.start); }
    else if (drag === "e") { set(c.start || 0, t); v.currentTime = Math.max(0, (c.start || 0) + c.dur - 0.05); showMain(v.currentTime); }
    else { v.currentTime = t; showMain(t); }
  });
  const up = () => { if (drag && drag !== "seek") done(); drag = null; };
  tt.addEventListener("pointerup", up); tt.addEventListener("pointercancel", up);
  $("#rl-tplay", box).onclick = () => { rlStop(); v.currentTime = c.start || 0; stopAt = (c.start || 0) + c.dur; v.play(); };
  $("#rl-tset-s", box).onclick = () => { set(v.currentTime, (c.start || 0) + c.dur > v.currentTime + 0.5 ? (c.start || 0) + c.dur : v.currentTime + Math.min(5, total() - v.currentTime)); done(); toast("شروع ویدیو تنظیم شد ✔"); };
  $("#rl-tset-e", box).onclick = () => { if (v.currentTime <= (c.start || 0) + 0.4) return toast("پایان باید بعد از شروع باشد"); set(c.start || 0, v.currentTime); done(); toast("پایان ویدیو تنظیم شد ✔"); };
  $("#rl-tall", box).onclick = () => { set(0, total()); done(); };
  $("#rl-tend", box).addEventListener("change", (ev) => { set(c.start || 0, Number(enDigits(ev.target.value)) || 0); done(); });
  if (v.readyState >= 1) { layout(); rlStrip(c, v); }
}

// نوار کوچک تصاویر ویدیو (یک بار برای هر ویدیو ساخته و نگه داشته می‌شود)
function rlStrip(c, v) {
  const cv = $("#rl-strip");
  if (!cv) return;
  const W = 600, H = 60;
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  RL.strips = RL.strips || {};
  const cached = RL.strips[c.media_id];
  if (cached) { if (cached.complete) ctx.drawImage(cached, 0, 0, W, H); else cached.onload = () => ctx.drawImage(cached, 0, 0, W, H); return; }
  if (RL.stripBusy === c.media_id) return;
  RL.stripBusy = c.media_id;
  const tv = document.createElement("video");
  tv.muted = true; tv.playsInline = true; tv.preload = "auto"; tv.src = v.currentSrc || v.src;
  const n = 10, off = document.createElement("canvas"); off.width = W; off.height = H;
  const octx = off.getContext("2d");
  octx.fillStyle = "#222"; octx.fillRect(0, 0, W, H);
  let i = 0;
  const next = () => {
    if (i >= n || !tv.duration) {
      const im = new Image(); im.src = off.toDataURL("image/jpeg", 0.7); RL.strips[c.media_id] = im; RL.stripBusy = null;
      const cur = $("#rl-strip"); if (cur) cur.getContext("2d").drawImage(off, 0, 0, W, H);
      return;
    }
    tv.currentTime = Math.min(tv.duration - 0.05, (i + 0.5) * tv.duration / n);
  };
  tv.addEventListener("seeked", () => {
    const cw = W / n, vw = tv.videoWidth, vh = tv.videoHeight;
    if (vw && vh) { const sc = Math.max(cw / vw, H / vh), dw = vw * sc, dh = vh * sc; octx.save(); octx.beginPath(); octx.rect(i * cw, 0, cw, H); octx.clip(); octx.drawImage(tv, i * cw + (cw - dw) / 2, (H - dh) / 2, dw, dh); octx.restore(); }
    ctx.drawImage(off, 0, 0, W, H);
    i++; next();
  });
  tv.addEventListener("loadedmetadata", next, { once: true });
  tv.addEventListener("error", () => { RL.stripBusy = null; }, { once: true });
}

function rlJumpTab() {
  const tl = reelTL();
  RL.t = RL.tab === 1 ? Math.min(1, tl.d1 / 2) : RL.tab === 2 ? (tl.d2 ? tl.d1 + 0.3 : tl.d1 - 0.1) : RL.tab === 3 ? tl.outro + OUT_ANIM + 0.1 : RL.t;
  reelDraw();
}

function rlBind(box) {
  const s = RL.s, upd = () => { reelSave(); reelDraw(); };
  rlBindTextBoxes(box);
  const on = (id, ev, fn) => { const el = $(id, box); if (el) el.addEventListener(ev, fn); };
  // مرحله‌ی ۱
  on("#rl-img1", "click", () => rlUpload("image/*", (m) => { Object.assign(s.s1, { media_id: m.id, scale: 1, ox: 0, oy: 0 }); upd(); rlPanel(); }));
  on("#rl-img1-lib", "change", (ev) => { s.s1.media_id = Number(ev.target.value) || null; upd(); });
  on("#rl-d1", "input", (ev) => { s.s1.dur = Math.max(0.5, Number(enDigits(ev.target.value)) || 4); upd(); });
  on("#rl-gray", "change", (ev) => { s.s1.gray = ev.target.checked; upd(); });
  on("#rl-bright", "input", (ev) => { s.s1.bright = Number(ev.target.value); $("#rl-bv").textContent = num(Math.round(s.s1.bright * 100)); upd(); });
  $$("[data-sz]", box).forEach((b) => (b.onclick = () => { const [k, f] = b.dataset.sz.split(":"); s[k].scale = +Math.min(4, Math.max(0.3, (s[k].scale || 1) * Number(f))).toFixed(3); upd(); rlPanel(); }));
  $$("[data-szr]", box).forEach((b) => (b.onclick = () => { Object.assign(s[b.dataset.szr], { scale: 1, ox: 0, oy: 0 }); upd(); rlPanel(); }));
  on("#rl-aud", "click", () => rlUpload("audio/*,video/*", (m) => { s.audio1.media_id = m.id; upd(); rlPanel(); }));
  on("#rl-aud-lib", "change", (ev) => { s.audio1.media_id = Number(ev.target.value) || null; upd(); rlPanel(); });
  on("#rl-aud-x", "click", () => { s.audio1.media_id = null; upd(); rlPanel(); });
  $$("[data-a]", box).forEach((el) => el.addEventListener(el.type === "checkbox" ? "change" : "input", () => {
    const k = el.dataset.a;
    s.audio1[k] = el.type === "checkbox" ? el.checked : k === "end" ? (el.value === "" ? null : Number(enDigits(el.value))) : Number(enDigits(el.value)) || 0;
    const sm = el.parentElement.querySelector("small");
    if (sm && k === "vol") sm.textContent = `${num(Math.round(s.audio1.vol * 100))}٪`;
    upd();
  }));
  // مرحله‌ی ۲
  const setVid = (m) => {
    Object.assign(s.s2, { media_id: m.id, kind: m.kind, start: 0, mediaDur: m.duration || 0, has_audio: !!m.has_audio, scale: 1, ox: 0, oy: 0,
      dur: m.kind === "video" ? +Math.min(m.duration || 6, 60).toFixed(1) : 5 });
    s.caps.manual = [];
    upd(); rlPanel(); rlJumpTab();
  };
  on("#rl-vid", "click", () => rlUpload("video/*,image/*", setVid));
  on("#rl-vid-lib", "change", (ev) => { const m = RL.media.find((x) => x.id === Number(ev.target.value)); if (m) setVid(m); });
  on("#rl-vid-x", "click", () => { s.s2.media_id = null; upd(); rlPanel(); });
  $$("[data-c]", box).forEach((el) => el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
    const k = el.dataset.c, c = s.s2;
    if (k === "motion") c.motion = el.value;
    else {
      let v = Math.max(0, Number(enDigits(el.value)) || 0);
      if (k === "start" && c.kind === "video") { v = Math.min(v, Math.max(0, c.mediaDur - 0.5)); c.start = v; c.dur = Math.min(c.dur, c.mediaDur - v); }
      else if (k === "dur") c.dur = c.kind === "video" ? Math.min(Math.max(0.5, v), (c.mediaDur || 999) - (c.start || 0)) : Math.max(0.5, v);
      else c[k] = v;
      const sm = el.parentElement.querySelector("small");
      if (sm && k === "vol") sm.textContent = `${num(Math.round(v * 100))}٪`;
    }
    upd();
  }));
  on("#rl-sz2", "input", (ev) => { s.s2.scale = +Number(ev.target.value).toFixed(3); $("#rl-szv").textContent = `${num(Math.round(s.s2.scale * 100))}٪`; reelDraw(); clearTimeout(RL.szT); RL.szT = setTimeout(reelSave, 300); });
  if ($("#rl-trim", box)) rlBindTrim(box);
  on("#rl-fit", "change", (ev) => { s.fit = ev.target.value; upd(); });
  // گوش دادن جداگانه به هر صدا (از همان ثانیه‌ی شروع، با همان بلندی؛ حداکثر ۱۵ ثانیه)
  $$("[data-listen]", box).forEach((b) => (b.onclick = () => {
    if (RL.listen) { RL.listen.pause(); const was = RL.listen.btn; RL.listen = null; if (was) was.textContent = "🎧 گوش دادن"; if (was === b) return; }
    rlStop();
    const a = b.dataset.listen === "a1" ? s.audio1 : s.audio2;
    const el = rlAudioEl(a.media_id, b.dataset.listen === "a1" ? "صدای مرحله‌ی ۱" : "صدای جداگانه‌ی مرحله‌ی ۲");
    el.currentTime = Number(a.src) || 0; el.volume = Math.min(1, Number(a.vol ?? 1)); el.btn = b;
    rlPlayEl(el); RL.listen = el; b.textContent = "⏹ توقف";
    const stop = () => { if (RL.listen === el) { el.pause(); RL.listen = null; b.textContent = "🎧 گوش دادن"; } };
    el.addEventListener("ended", stop); setTimeout(stop, 15000);
  }));
  on("#rl-vs", "change", (ev) => { s.s2.sound = ev.target.checked; upd(); rlPanel(); });
  on("#rl-a1c", "change", (ev) => { const snd = rlSound(); s.audio1.s2vol = snd.level; s.audio1.s2on = ev.target.checked; upd(); rlPanel(); });
  on("#rl-a1v", "input", (ev) => { s.audio1.s2vol = Number(ev.target.value); ev.target.parentElement.querySelector("small").textContent = `${num(Math.round(s.audio1.s2vol * 100))}٪`; upd(); });
  const setA2 = (id) => { s.audio2 = { ...reelDefaults().audio2, ...(s.audio2 || {}), media_id: id, src: id === s.audio2?.media_id ? s.audio2.src : 0 }; upd(); rlPanel(); };
  on("#rl-a2", "click", () => rlUpload("audio/*,video/*", (m) => setA2(m.id)));
  on("#rl-a2-lib", "change", (ev) => setA2(Number(ev.target.value) || null));
  on("#rl-a2-x", "click", () => setA2(null));
  $$("[data-a2]", box).forEach((el) => el.addEventListener(el.type === "checkbox" ? "change" : "input", () => {
    const k = el.dataset.a2;
    s.audio2[k] = el.type === "checkbox" ? el.checked : Number(enDigits(el.value)) || 0;
    const sm = el.parentElement.querySelector("small");
    if (sm && k === "vol") sm.textContent = `${num(Math.round(s.audio2.vol * 100))}٪`;
    upd();
  }));
  on("#rl-caps", "input", (ev) => { s.caps.text = ev.target.value; upd(); rlTimes(); });
  on("#rl-split", "click", () => { const p = splitLead(s.caps.text, 10); if (!p.length) return toast("اول متن را بنویسید یا بچسبانید"); s.caps.text = p.join("\n"); s.caps.manual = []; upd(); rlPanel(); toast(`${num(p.length)} زیرنویس ساخته شد ✔`); });
  on("#rl-retime", "click", () => { s.caps.manual = []; upd(); rlPanel(); });
  on("#rl-asr", "click", rlAsr);
  if ($("#rl-lead", box)) rlBindLead(box);
  on("#rl-tap", "click", rlTap);
  if ($("#rl-times", box)) rlTimes();
  // مرحله‌ی ۳
  on("#rl-hold", "input", (ev) => { s.s3.hold = Math.max(0, Number(enDigits(ev.target.value)) || 0); upd(); });
  on("#rl-stamp", "click", () => rlUpload("audio/*,video/*", (m) => { s.s3.stamp_id = m.id; upd(); rlPanel(); }));
  on("#rl-stamp-lib", "change", (ev) => { s.s3.stamp_id = Number(ev.target.value) || null; upd(); rlPanel(); });
  on("#rl-stamp-x", "click", () => { s.s3.stamp_id = null; upd(); rlPanel(); });
  $$("[data-o]", box).forEach((el) => el.addEventListener("input", () => {
    s.s3[el.dataset.o] = Number(el.value);
    el.parentElement.querySelector("small").textContent = el.dataset.o === "stamp_vol" ? `${num(Math.round(s.s3.stamp_vol * 100))}٪` : `${num((+s.s3.stamp_off).toFixed(2))} ث`;
    upd();
  }));
  on("#rl-stamp-try", "click", () => { rlStop(); RL.t = reelTL().outro; rlPlay(); });
  // ساخت
  on("#rl-title", "input", (ev) => { s.title = ev.target.value; reelSave(); });
  on("#rl-q", "change", (ev) => { s.quality = ev.target.value; reelSave(); });
  on("#rl-url", "input", (ev) => { s.url = ev.target.value; upd(); });
  on("#rl-render", "click", reelRender);
}

// فهرست زمان زیرنویس‌ها (نسبت به آغاز ویدیو)
function rlTimes() {
  const box = $("#rl-times");
  if (!box) return;
  const s = RL.s, caps = capTimes();
  if (!caps.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="small muted">زمان هر زیرنویس از آغاز ویدیو (ثانیه):</div>` + caps.map((c, i) => `<div class="cap2"><button class="btn sm ghost" data-cp="${i}">▶</button>
    <span class="t">${esc(c.text.replace(/\*/g, ""))}</span>
    <span class="tm"><button class="btn sm ghost" data-nd="${i}:-0.2">−</button><input type="number" step="0.1" value="${c.start}" data-mi="${i}" data-mj="0"><button class="btn sm ghost" data-nd="${i}:0.2">+</button>
    تا <input type="number" step="0.1" value="${c.end}" data-mi="${i}" data-mj="1"></span></div>`).join("");
  const toManual = () => { if (s.caps.manual.length < caps.length) s.caps.manual = caps.map((c) => [c.start, c.end]); };
  $$("[data-mi]", box).forEach((el) => (el.onchange = () => { toManual(); s.caps.manual[Number(el.dataset.mi)][Number(el.dataset.mj)] = Number(enDigits(el.value)) || 0; reelSave(); reelDraw(); }));
  $$("[data-nd]", box).forEach((b) => (b.onclick = () => {
    const [i, d] = b.dataset.nd.split(":").map(Number); toManual();
    const m = s.caps.manual[i]; m[0] = +Math.max(0, m[0] + d).toFixed(2); m[1] = +Math.max(m[0] + 0.3, m[1]).toFixed(2);
    if (i > 0) s.caps.manual[i - 1][1] = Math.min(s.caps.manual[i - 1][1], +(m[0] - 0.02).toFixed(2));
    reelSave(); rlTimes(); RL.t = reelTL().d1 + m[0] + 0.05; reelDraw();
  }));
  $$("[data-cp]", box).forEach((b) => (b.onclick = () => { rlStop(); RL.t = reelTL().d1 + caps[Number(b.dataset.cp)].start; rlPlay(); }));
}

// ساختن لید (حدود N کلمه) از صدای ویدیو، فایل صوتی، متن سوژه یا متن چسبانده؛ سپس تقسیم به زیرنویس
function rlBindLead(box) {
  const s = RL.s, src = $("#rl-lsrc", box), sel = $("#rl-lstory", box);
  const loadStories = async () => {
    if (sel.options.length > 1) return;
    const list = await api("/api/stories?limit=300").catch(() => []);
    sel.innerHTML = `<option value="">— انتخاب سوژه —</option>` + list.map((x) => `<option value="${x.id}">${esc(x.title)}</option>`).join("");
    if (!list.length) sel.innerHTML = `<option value="">هنوز سوژه‌ای ثبت نشده</option>`;
    if (RL.leadStory) sel.value = String(RL.leadStory);
  };
  sel.onchange = () => { RL.leadStory = sel.value; };
  if (RL.leadSrc === "story") loadStories();
  src.onchange = () => { RL.leadSrc = src.value; sel.hidden = src.value !== "story"; if (!sel.hidden) loadStories(); };
  $("#rl-ln", box).onchange = (ev) => { RL.leadN = Number(ev.target.value); };
  $("#rl-lead", box).onclick = async () => {
    const btn = $("#rl-lead", box), n = Number($("#rl-ln", box).value) || 200, how = src.value;
    const busy = (t) => { btn.disabled = !!t; btn.textContent = t || "✍️ ساخت لید و تقسیم به زیرنویس"; };
    try {
      let text = "";
      if (how === "video") {
        if (s.s2.kind !== "video" || !s.s2.media_id) return toast("اول ویدیوی این مرحله را بگذارید");
        if (!s.s2.has_audio) return toast("این ویدیو صدا ندارد");
        busy("در حال شنیدن ویدیو…");
        text = (await api("/api/teasers/transcript", { method: "POST", body: { media_id: s.s2.media_id, start: s.s2.start || 0, duration: s.s2.dur } })).text;
      } else if (how === "audio") {
        if (!s.audio1.media_id) return toast("اول در مرحله‌ی ۱ فایل صوتی بگذارید");
        busy("در حال شنیدن فایل صوتی…");
        text = (await api("/api/teasers/transcript", { method: "POST", body: { media_id: s.audio1.media_id, start: s.audio1.src || 0 } })).text;
      } else if (how === "audio2") {
        if (!s.audio2?.media_id) return toast("اول «صدای جداگانه برای این بخش» را بگذارید (پایین همین زبانه)");
        busy("در حال شنیدن فایل صوتی…");
        text = (await api("/api/teasers/transcript", { method: "POST", body: { media_id: s.audio2.media_id, start: s.audio2.src || 0, duration: s.s2.dur } })).text;
      } else if (how === "story") {
        if (!sel.value) return toast("یک سوژه انتخاب کنید");
        busy("در حال خواندن متن سوژه…");
        text = (await api(`/api/stories/${sel.value}/text`)).text || "";
      } else {
        text = ($("#rl-caps", box)?.value || s.caps.text || "").replace(/\*/g, "");
      }
      if (!text.trim()) { busy(); return toast(how === "video" || how === "audio" ? "گفتاری شنیده نشد" : "متنی برای ساختن لید نیست", 5000); }
      busy("در حال ساختن لید…");
      const r = await api("/api/ai/lead", { method: "POST", body: { text, n } });
      let lead = (r.lines || []).join(" ").trim() || text.trim();
      const words = lead.split(/\s+/);
      if (words.length > n * 1.25) lead = words.slice(0, n).join(" ") + " …";
      const parts = splitLead(lead, 10);
      s.caps.text = parts.join("\n"); s.caps.manual = [];
      reelSave(); busy(); rlPanel(); reelDraw();
      toast(`لید حدود ${num(lead.split(/\s+/).length)} کلمه ساخته و به ${num(parts.length)} زیرنویس تقسیم شد ✔${r.error ? " (" + r.error + ")" : ""}`, 6000);
    } catch (e) { busy(); if (!(e instanceof LoginRequired)) toast(e.message, 7000); }
  };
}

async function rlAsr() {
  const s = RL.s;
  if (s.s2.kind !== "video" || !s.s2.has_audio) return toast("اول ویدیوی دارای صدا را در همین مرحله بگذارید");
  const btn = $("#rl-asr");
  btn.disabled = true; btn.textContent = "در حال شنیدن ویدیو… (چند ثانیه)";
  try {
    const lines = capLines();
    const r = await api("/api/teasers/autocaption", { method: "POST", body: { offset: 0, lines,
      clips: [{ media_id: s.s2.media_id, start: s.s2.start || 0, duration: reelTL().d2 }] } });
    if (!r.captions.length) toast("گفتاری در ویدیو شنیده نشد", 5000);
    else {
      if (!r.aligned) s.caps.text = r.captions.map((c) => c.text).join("\n");
      s.caps.manual = r.captions.map((c) => [c.start, c.end]);
      reelSave(); rlPanel(); reelDraw();
      toast(r.aligned ? "زمان زیرنویس‌ها با گفتار هماهنگ شد ✔" : "زیرنویس از روی گفتار ساخته شد ✔ متن را بخوانید و اگر لازم بود اصلاح کنید.", 5000);
      return;
    }
  } catch (err) { if (!(err instanceof LoginRequired)) toast(err.message, 6000); }
  btn.disabled = false; btn.textContent = "🎙 زیرنویس خودکار از صدای ویدیو";
}

function rlTap() {
  const s = RL.s, lines = capLines(), tl = reelTL();
  if (!lines.length) return toast("اول زیرنویس‌ها را بنویسید (هر خط یکی)");
  if (!tl.d2) return toast("اول ویدیو را بگذارید");
  const box = $("#rl-tapbox"), marks = [];
  let idx = 0;
  const show = () => {
    box.hidden = false;
    box.innerHTML = idx < lines.length
      ? `<div class="tapbox"><div class="small muted">وقتی این جمله شروع شد بزنید (${num(idx + 1)} از ${num(lines.length)}):</div><b>${esc(lines[idx].replace(/\*/g, ""))}</b>
         <div class="btn-row"><button class="btn primary big" id="rl-now">👆 الان</button><button class="btn" id="rl-tstop">⏹ پایان</button></div></div>`
      : `<div class="tapbox"><b>همه زمان گرفتند ✔</b><div class="btn-row"><button class="btn primary" id="rl-tstop">ذخیره</button></div></div>`;
    if ($("#rl-now")) $("#rl-now").onclick = () => {
      const t = +(RL.t - tl.d1).toFixed(2);
      if (marks.length) marks[marks.length - 1][1] = +(t - 0.02).toFixed(2);
      marks.push([t, +Math.min(tl.d2 - 0.05, t + 4).toFixed(2)]); idx++; show();
    };
    $("#rl-tstop").onclick = () => {
      rlStop();
      if (marks.length) { marks[marks.length - 1][1] = +Math.min(tl.d2 - 0.05, Math.max(marks[marks.length - 1][0] + 0.8, RL.t - tl.d1)).toFixed(2); s.caps.manual = marks; reelSave(); toast("زمان‌ها ذخیره شد ✔"); }
      box.hidden = true; rlPanel();
    };
  };
  rlStop(); RL.t = tl.d1; show(); rlPlay();
}

// جابه‌جا کردن متن‌ها و عکس/ویدیو روی پیش‌نمایش
function rlBindDrag(cv) {
  const pts = new Map();
  let st = null;
  const pos = (ev) => { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left) * DW / r.width, y: (ev.clientY - r.top) * DH / r.height }; };
  const textKeys = () => ["kick", "head", "sub", "b1", "b2", "caps"].filter((k) => rlTextVisible(k, RL.t) && (k === "caps" || (!rlTextByKey(k).hidden && rlTextByKey(k).text.trim())));
  const clipNow = () => { const tl = reelTL(); return RL.t < tl.d1 ? (RL.s.s1.media_id ? RL.s.s1 : null) : RL.t < tl.outro ? (RL.s.s2.media_id ? RL.s.s2 : null) : null; };
  cv.style.touchAction = "none";
  cv.addEventListener("pointerdown", (ev) => {
    if (RL.playing) return;
    const p = pos(ev);
    cv.setPointerCapture(ev.pointerId);
    pts.set(ev.pointerId, p);
    if (pts.size > 1 && st?.mode === "clip") { const [a, b] = [...pts.values()]; st.dist = Math.hypot(a.x - b.x, a.y - b.y); st.scale = st.c.scale || 1; return; }
    const hit = [...textKeys()].reverse().find((k) => { const L = rlTextByKey(k); return p.x >= L.x && p.x <= L.x + L.w && p.y >= L.y && p.y <= L.y + Math.max(L.h, 60); });
    if (hit) { RL.sel = hit; const L = rlTextByKey(hit); st = { mode: "text", L, p, x: L.x, y: L.y }; reelDraw(); return; }
    const c = clipNow();
    RL.sel = null;
    st = c ? { mode: "clip", c, p, ox: c.ox || 0, oy: c.oy || 0, scale: c.scale || 1, dist: 0 } : null;
    reelDraw();
  });
  cv.addEventListener("pointermove", (ev) => {
    if (!st || !pts.has(ev.pointerId)) return;
    const p = pos(ev);
    pts.set(ev.pointerId, p);
    if (st.mode === "text") {
      st.L.x = Math.round(Math.max(-st.L.w / 2, Math.min(DW - st.L.w / 2, st.x + p.x - st.p.x)));
      st.L.y = Math.round(Math.max(0, Math.min(DH - 40, st.y + p.y - st.p.y)));
    } else if (pts.size > 1 && st.dist) {
      const [a, b] = [...pts.values()];
      st.c.scale = +Math.min(4, Math.max(0.3, st.scale * Math.hypot(a.x - b.x, a.y - b.y) / st.dist)).toFixed(3);
    } else if (pts.size === 1) {
      st.c.ox = +Math.max(-1, Math.min(1, st.ox + (p.x - st.p.x) / DW)).toFixed(4);
      st.c.oy = +Math.max(-1, Math.min(1, st.oy + (p.y - st.p.y) / DH)).toFixed(4);
    }
    reelDraw();
  });
  const end = (ev) => { if (!pts.delete(ev.pointerId)) return; if (!pts.size && st) { st = null; reelSave(); } };
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", end);
  cv.addEventListener("wheel", (ev) => {
    const c = clipNow(); if (!c) return;
    ev.preventDefault();
    c.scale = +Math.min(4, Math.max(0.3, (c.scale || 1) * (ev.deltaY < 0 ? 1.06 : 0.94))).toFixed(3);
    reelDraw(); clearTimeout(cv._wt); cv._wt = setTimeout(reelSave, 400);
  }, { passive: false });
}

// آیا در ریلزساز کاری انجام شده که با بارگذاری سوژه از دست برود؟
function rlHasWork() {
  let s = RL.s;
  if (!s) { try { s = JSON.parse(lsGet("reelDraft", "null") || "null"); } catch { s = null; } }
  return !!(s && (s.s1?.media_id || s.s2?.media_id || String(s.caps?.text || "").trim()
    || ["kick", "head", "sub"].some((k) => String(s.texts?.[k]?.text || "").trim())));
}

// ساختن ریلز آماده از روی یک سوژه: عکس خبر در شروع، تیتر، و لید خبر (حدود n کلمه) به‌صورت زیرنویس روی همان عکس
async function reelFromStory(storyId, { mediaId = null, title = "", n = 200 } = {}) {
  const s = reelDefaults();
  if (!title) title = (await api(`/api/stories/${storyId}`)).title || "";
  s.title = title;
  const head = s.texts.head;
  head.text = title;
  head.size = title.length > 90 ? 58 : title.length > 60 ? 70 : title.length > 35 ? 82 : 92;
  head.h = Math.min(420, Math.ceil(title.length / (head.size > 80 ? 14 : 20)) * head.size * 1.35 + 40);
  s.texts.sub.y = head.y + head.h + 20;
  let lead = "";
  const text = (await api(`/api/stories/${storyId}/text`).catch(() => ({ text: "" }))).text || "";
  if (text.trim()) {
    const r = await api("/api/ai/lead", { method: "POST", body: { text, n } }).catch(() => ({ lines: [] }));
    lead = (r.lines || []).join(" ").trim();
    const w = lead.split(/\s+/);
    if (w.length > n * 1.25) lead = w.slice(0, n).join(" ") + " …";
  }
  const parts = lead ? splitLead(lead, 10) : [];
  s.caps.text = parts.join("\n");
  if (mediaId) {
    s.s1.media_id = mediaId;
    // بدنه: همان عکس با زوم آرام تا زیرنویس‌های لید رویش دیده شوند (بعداً می‌شود ویدیو گذاشت)
    s.s2 = { ...s.s2, media_id: mediaId, kind: "image", motion: "zoom", dur: +Math.min(60, Math.max(6, parts.length * 2.8)).toFixed(1) };
  }
  RL.leadSrc = "story"; RL.leadStory = String(storyId); RL.leadN = n;
  return s;
}

// یک فریم از ریلز (برای پیش‌نمایش پیشنهاد سوژه) روی یک بوم دلخواه
async function reelSnapshot(cv, state, t) {
  const wait = (im) => (im && !(im.complete && im.naturalWidth) ? new Promise((r) => { im.addEventListener("load", r, { once: true }); im.addEventListener("error", r, { once: true }); setTimeout(r, 4000); }) : null);
  if (!RL.logoBar) RL.logoBar = rlImg("/static/brand/logo-bar.png");
  if (!RL.mark) RL.mark = rlImg("/static/brand/logo-mark.png");
  const ids = [...new Set([state.s1.media_id, state.s2.kind === "image" ? state.s2.media_id : null].filter(Boolean))];
  await Promise.all([RL.logoBar, RL.mark, ...ids.map((id) => rlEl(id, "image"))].map(wait));
  if (document.fonts) await document.fonts.ready;
  const keep = RL.s, keepSel = RL.sel;
  RL.s = state; RL.sel = null;
  cv.width = 540; cv.height = 960;
  const ctx = cv.getContext("2d");
  ctx.save(); ctx.scale(540 / DW, 960 / DH); rlFrame(ctx, t); ctx.restore();
  RL.s = keep; RL.sel = keepSel;
}

async function reelView(view, params) {
  rlStop();
  const [media, list] = await Promise.all([api("/api/media"), api("/api/teasers")]);
  RL.media = media;
  if (!RL.s) { try { RL.s = { ...reelDefaults(), ...JSON.parse(lsGet("reelDraft", "null") || "{}") }; } catch { RL.s = reelDefaults(); } }
  if (params.get("story")) {
    const sid = Number(params.get("story"));
    history.replaceState(null, "", "#teaser");
    if (!rlHasWork() || confirm("ریلزِ نیمه‌کاره‌ی فعلی با ریلز این سوژه جایگزین شود؟")) {
      view.innerHTML = `<div class="card empty center">در حال آماده‌سازی ریلز از روی سوژه… (عکس، تیتر و لید خبر)</div>`;
      try {
        const sg = await api(`/api/stories/${sid}/suggest`, { method: "POST" });
        RL.s = await reelFromStory(sid, { mediaId: sg.media_id, title: sg.story.title });
        RL.tab = 1; reelSave();
        if (!sg.media_id) toast("عکسی برای این سوژه پیدا نشد؛ در مرحله‌ی ۱ عکس را انتخاب کنید", 6000);
      } catch (e) { if (!(e instanceof LoginRequired)) toast(e.message, 6000); }
    }
  }
  const capsFromTools = lsGet("teaserCaptions");
  if (capsFromTools) {
    try { RL.s.caps.text = JSON.parse(capsFromTools).join("\n"); RL.s.caps.manual = []; RL.tab = 2; reelSave(); } catch { /* */ }
    try { localStorage.removeItem("teaserCaptions"); } catch { /* */ }
  }
  const autoRender = !!params.get("auto");
  if (autoRender) history.replaceState(null, "", "#teaser");
  if (params.get("load")) {
    const t = list.find((x) => x.id === Number(params.get("load")));
    if (t?.editor?.kr3) { RL.s = { ...reelDefaults(), ...t.editor.kr3 }; reelSave(); }
    history.replaceState(null, "", "#teaser");
  }
  if (!RL.logoBar) RL.logoBar = rlImg("/static/brand/logo-bar.png");
  if (!RL.mark) RL.mark = rlImg("/static/brand/logo-mark.png");
  window.onFontLoaded = reelDraw;
  if (!META.ffmpeg) { view.innerHTML = `<div class="card error">ffmpeg روی سرور نصب نیست؛ ساخت ویدیو ممکن نیست.</div>`; return; }
  view.innerHTML = `
    <div class="page-title"><h2>🎬 ریلزساز کرمان راوی</h2><div class="btn-row">
      <button class="btn" id="rl-new">🆕 ریلز تازه</button></div></div>
    <div class="teaser-layout rl-layout">
      <div>
        <div class="seg rl-tabs" id="rl-tabs"></div>
        <div id="rl-panel"></div>
        <div class="card"><h3>ویدیوهای ساخته‌شده</h3><div class="list" id="tz-list"></div></div>
      </div>
      <div class="teaser-preview rl-preview ${lsGet("reelPin", "1") === "1" ? "" : "unpinned"}">
        <div class="card"><h3>پیش‌نمایش</h3>
          <canvas id="rl-canvas" style="width:100%;height:auto;border-radius:10px;background:#000"></canvas>
          <div class="pv-controls"><button class="btn sm" id="rl-play">▶</button><input type="range" id="rl-range" min="0" step="0.05" value="0"><span class="small muted" id="rl-time"></span></div>
          <div class="small muted" id="rl-snd-ind" style="margin-top:4px"></div>
          <div class="btn-row" style="margin-top:6px"><button class="btn sm" data-go2="1">⏮ شروع</button><button class="btn sm" data-go2="2">بدنه</button><button class="btn sm" data-go2="3">پایان ⏭</button>
            <button class="btn sm ghost" id="rl-pin" title="پیش‌نمایش با اسکرول همراه بیاید یا سر جایش بماند"></button></div>
        </div>
      </div>
    </div>`;
  const pinLbl = () => { $("#rl-pin").textContent = $(".rl-preview").classList.contains("unpinned") ? "📌 همراه اسکرول" : "📍 رها کردن"; };
  pinLbl();
  $("#rl-pin").onclick = () => { const u = $(".rl-preview").classList.toggle("unpinned"); lsSet("reelPin", u ? "0" : "1"); pinLbl(); };
  $("#rl-play").onclick = rlPlay;
  $("#rl-range").oninput = (ev) => { rlStop(); RL.t = Number(ev.target.value); reelDraw(); };
  $$("[data-go2]", view).forEach((b) => (b.onclick = () => { rlStop(); const tl = reelTL(), k = Number(b.dataset.go2); RL.t = k === 1 ? 0 : k === 2 ? tl.d1 : tl.outro; reelDraw(); }));
  $("#rl-new").onclick = () => { if (!confirm("همه‌ی تنظیمات این ریلز پاک شود؟")) return; RL.s = reelDefaults(); reelSave(); RL.tab = 1; refresh(); };
  rlBindDrag($("#rl-canvas"));
  rlPanel();
  drawList(list);
  rlJumpTab();
  if (document.fonts) document.fonts.ready.then(reelDraw);
  if (autoRender) { RL.tab = 4; rlPanel(); setTimeout(() => reelRender(), 600); }
  FONTS_READY?.then(() => { reelDraw(); });
}

// صفحه‌ی «تیزر»: فقط ریلزساز سه‌مرحله‌ای
VIEWS.teaser = reelView;
