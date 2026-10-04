"use strict";
// ═════════════════════════ تیزرساز ═════════════════════════
// نوشته‌های فارسی (تیتر، زیرنویس، نام رسانه، کارت آغاز و پایان) همین‌جا روی «بوم» کشیده می‌شوند
// و به صورت تصویر شفاف برای سرور فرستاده می‌شوند؛ سرور با ffmpeg آن‌ها را روی ویدیو می‌گذارد.

const TEMPLATES = {
  kermanravi: { name: "کرمان راوی", style: "kr", accent: "#9d1819", band: "rgba(255,255,255,.9)", head: "#9d1819", kick: "#ffffff", capBg: "rgba(255,255,255,.9)", capText: "#193153", c1: "#1f3d68", c2: "#0d1a2e", cardText: "#ffffff" },
  kermanravi_bar: { name: "کرمان راوی (نوار)", accent: "#9d1819", band: "rgba(25,49,83,.9)", head: "#ffffff", kick: "#ffffff", capBg: "rgba(25,49,83,.88)", capText: "#ffffff", c1: "#1f3d68", c2: "#0d1a2e", cardText: "#ffffff", footer: true },
  breaking: { name: "فوری", accent: "#d0142c", band: "rgba(0,0,0,.72)", head: "#ffffff", kick: "#ffffff", capBg: "rgba(0,0,0,.72)", capText: "#ffffff", c1: "#8a0f1e", c2: "#1a0508", cardText: "#ffffff" },
  navy: { name: "رسمی", accent: "#2a7fc1", band: "rgba(8,24,44,.82)", head: "#ffffff", kick: "#ffffff", capBg: "rgba(8,24,44,.82)", capText: "#ffffff", c1: "#1f5f8b", c2: "#08182c", cardText: "#ffffff" },
  yellow: { name: "زرد", accent: "#ffcc00", band: "rgba(0,0,0,.82)", head: "#ffffff", kick: "#000000", capBg: "#ffcc00", capText: "#000000", c1: "#262626", c2: "#000000", cardText: "#ffcc00" },
  light: { name: "روشن", accent: "#8a1c2b", band: "rgba(255,255,255,.93)", head: "#141414", kick: "#ffffff", capBg: "rgba(255,255,255,.93)", capText: "#141414", c1: "#f5f3ef", c2: "#d9d1c5", cardText: "#141414" },
  green: { name: "سبز", accent: "#1f9d63", band: "rgba(4,32,20,.8)", head: "#ffffff", kick: "#ffffff", capBg: "rgba(4,32,20,.8)", capText: "#ffffff", c1: "#1f7a50", c2: "#04140c", cardText: "#ffffff" },
  minimal: { name: "ساده", accent: "#ffffff", band: null, head: "#ffffff", kick: "#000000", capBg: null, capText: "#ffffff", c1: "#333333", c2: "#000000", cardText: "#ffffff" },
};
const FORMATS = { "9:16": "عمودی ۹:۱۶ (ریلز و استوری)", "16:9": "افقی ۱۶:۹ (یوتیوب، سایت)", "1:1": "مربع ۱:۱", "4:5": "پست ۴:۵" };
const INTRO_DUR = 2.5, OUTRO_DUR = 3;

const TZ = {
  s: null, media: [], music: [], els: {}, t: 0, playing: false, raf: null, poll: null, logoEl: null,
};

function teaserDefaults() {
  return {
    title: "", format: "9:16", quality: "720", fit: "blur", template: "kermanravi", accent: "",
    kicker: "", headline: "", headlinePos: "top", headlineMode: "first", brand: "کرمان راوی",
    speakerName: "", speakerTitle: "", credit: "",
    footerText: "www.kermanravi.ir", logoId: "brand", captionsText: "", autoTime: true, manual: [], captionSize: 1,
    clips: [], musicId: null, musicVolume: 0.35, keepAudio: true, videoVolume: 1,
    intro: false, introText: "", outro: false, outroText: "", fade: true, transition: "fade", story_id: null,
  };
}

function logoUrl(id) { return id === "brand" ? "/static/brand/logo.png" : `/api/media/${id}/file`; }

function saveDraft() { lsSet("teaserDraft", JSON.stringify(TZ.s)); }

function tpl() {
  const t = { ...TEMPLATES[TZ.s.template] || TEMPLATES.breaking };
  if (TZ.s.accent) t.accent = TZ.s.accent;
  return t;
}

function outSize() {
  const [w, h] = META.teaser_sizes[TZ.s.format] || [720, 1280];
  return [w, h];
}

function clipDur(c) { return Math.max(0.3, Number(c.duration) || (c.kind === "image" ? 3 : 1)); }
function timeline() {
  const s = TZ.s;
  const introDur = s.intro ? INTRO_DUR : 0;
  const outroDur = s.outro ? OUTRO_DUR : 0;
  const main = s.clips.reduce((a, c) => a + clipDur(c), 0);
  const total = +(introDur + main + outroDur).toFixed(2);
  return { introDur, outroDur, main, total, mainStart: introDur, mainEnd: +(introDur + main).toFixed(2) };
}

function captionTimes() {
  const s = TZ.s;
  const lines = s.captionsText.split("\n").map((x) => x.trim()).filter(Boolean);
  const tl = timeline();
  if (!lines.length || tl.main <= 0) return [];
  if (!s.autoTime && s.manual.length === lines.length) return lines.map((text, i) => ({ text, start: s.manual[i][0], end: s.manual[i][1] }));
  // اگر تیتر فقط روی تکه‌ی اول است، زیرنویس‌ها بعد از آن شروع شوند (مثل ریلزهای صفحه)
  const hEnd = s.headlineMode === "first" && s.headline.trim() ? headlineEnd(tl) : tl.mainStart;
  const a = (tl.mainEnd - hEnd > 2 ? hEnd : tl.mainStart) + 0.3, b = tl.mainEnd - 0.2;
  const weights = lines.map((l) => Math.max(3, l.split(/\s+/).length));
  const sum = weights.reduce((x, y) => x + y, 0);
  let cur = a;
  return lines.map((text, i) => {
    const d = ((b - a) * weights[i]) / sum;
    const r = { text, start: +cur.toFixed(2), end: +(cur + d - 0.05).toFixed(2) };
    cur += d;
    return r;
  });
}

// ───────────── کشیدن روی بوم ─────────────
const FONT = "Vazirmatn, Tahoma, sans-serif";

function wrapText(ctx, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function setup(ctx) { ctx.direction = "rtl"; ctx.textBaseline = "middle"; }

function drawHeadline(ctx, W, H) {
  if (tpl().style === "kr") return krHeadline(ctx, W, H);
  const s = TZ.s, t = tpl();
  if (!s.headline.trim() && !s.kicker.trim()) return;
  setup(ctx);
  const base = Math.min(W, H), m = base * 0.055, vertical = H > W;
  const hs = base * (vertical ? 0.068 : 0.06), ks = base * 0.042;
  ctx.font = `900 ${hs}px ${FONT}`;
  const maxW = W - m * 2 - base * 0.06;
  const lines = s.headline.trim() ? wrapText(ctx, s.headline.replace(/\*/g, "").trim(), maxW).slice(0, 4) : [];
  const lh = hs * 1.45, padY = base * 0.025, padX = base * 0.03;
  const kickH = s.kicker.trim() ? ks * 1.7 : 0;
  const blockH = kickH + (lines.length ? lines.length * lh + padY * 2 : 0);
  let y = s.headlinePos === "top" ? H * (vertical ? 0.12 : 0.1) : H * (vertical ? 0.62 : 0.66) - blockH / 2;
  if (s.headlinePos !== "top" && !vertical) y = H * 0.93 - blockH - base * 0.1;
  const right = W - m;
  if (kickH) {
    ctx.font = `700 ${ks}px ${FONT}`;
    const kw = ctx.measureText(s.kicker.trim()).width + ks * 1.2;
    ctx.fillStyle = t.accent;
    rr(ctx, right - kw, y, kw, kickH, base * 0.012);
    ctx.fill();
    ctx.fillStyle = t.kick;
    ctx.textAlign = "center";
    ctx.fillText(s.kicker.trim(), right - kw / 2, y + kickH / 2 + ks * 0.05);
    y += kickH;
  }
  if (!lines.length) return;
  ctx.font = `900 ${hs}px ${FONT}`;
  const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2;
  if (t.band) {
    ctx.fillStyle = t.band;
    rr(ctx, right - bw, y, bw, lines.length * lh + padY * 2, base * 0.014);
    ctx.fill();
    ctx.fillStyle = t.accent;
    ctx.fillRect(right - base * 0.012, y, base * 0.012, lines.length * lh + padY * 2);
  } else {
    ctx.shadowColor = "rgba(0,0,0,.85)"; ctx.shadowBlur = base * 0.02;
  }
  ctx.fillStyle = t.head;
  ctx.textAlign = "right";
  lines.forEach((l, i) => ctx.fillText(l, right - padX, y + padY + lh * (i + 0.5)));
  ctx.shadowBlur = 0;
}

function drawBrand(ctx, W, H, phase = "main") {
  if (tpl().style === "kr") return krBrand(ctx, W, H, phase);
  const s = TZ.s, t = tpl();
  setup(ctx);
  const base = Math.min(W, H), m = base * 0.05;
  let x = m;
  const y = H > W ? H * 0.04 : H * 0.05;
  const size = base * 0.1;
  const hasLogo = TZ.logoEl && TZ.logoEl.complete && TZ.logoEl.naturalWidth;
  if (hasLogo) {
    const r = TZ.logoEl.naturalWidth / TZ.logoEl.naturalHeight;
    const lw = Math.min(size * r, base * 0.32), lh = lw / r, p = base * 0.012;
    ctx.fillStyle = "rgba(255,255,255,.95)";
    rr(ctx, x - p, y - p, lw + p * 2, lh + p * 2, base * 0.018);
    ctx.fill();
    ctx.drawImage(TZ.logoEl, x, y, lw, lh);
    x += lw + base * 0.03;
  }
  if (t.footer && (s.footerText || "").trim()) {
    const fh = base * 0.05, fy = H - fh;
    ctx.fillStyle = t.accent;
    ctx.fillRect(0, fy, W, fh);
    ctx.fillStyle = "rgba(25,49,83,.95)";
    ctx.fillRect(0, fy - base * 0.006, W, base * 0.006);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = `700 ${fh * 0.5}px ${FONT}`;
    ctx.fillText(s.footerText.trim(), W / 2, fy + fh / 2 + fh * 0.03);
  }
  if (s.brand.trim() && !hasLogo) {
    const bs = base * 0.036;
    ctx.font = `700 ${bs}px ${FONT}`;
    const bw = ctx.measureText(s.brand.trim()).width + bs * 1.2;
    ctx.fillStyle = "rgba(0,0,0,.55)";
    rr(ctx, x, y + size / 2 - bs * 0.85, bw, bs * 1.7, bs * 0.85);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(s.brand.trim(), x + bw / 2, y + size / 2 + bs * 0.05);
  }
}

function drawCaption(ctx, W, H, text) {
  if (tpl().style === "kr") return krCaption(ctx, W, H, text);
  const s = TZ.s, t = tpl();
  setup(ctx);
  const base = Math.min(W, H), vertical = H > W;
  const cs = base * (vertical ? 0.058 : 0.05) * (Number(s.captionSize) || 1);
  ctx.font = `700 ${cs}px ${FONT}`;
  const lines = wrapText(ctx, text.replace(/\*/g, ""), W * 0.84).slice(0, 3);
  const lh = cs * 1.5, pad = cs * 0.45;
  const cy = vertical ? H * (s.headlinePos === "top" ? 0.8 : 0.84) : H * 0.83;
  const top = cy - (lines.length * lh) / 2;
  ctx.textAlign = "center";
  lines.forEach((l, i) => {
    const w = ctx.measureText(l).width;
    const ly = top + lh * i;
    if (t.capBg) {
      ctx.fillStyle = t.capBg;
      rr(ctx, W / 2 - w / 2 - pad * 1.4, ly + lh * 0.04, w + pad * 2.8, lh * 0.94, cs * 0.3);
      ctx.fill();
    } else { ctx.shadowColor = "rgba(0,0,0,.9)"; ctx.shadowBlur = cs * 0.35; }
    ctx.fillStyle = t.capText;
    ctx.fillText(l, W / 2, ly + lh / 2 + cs * 0.04);
    ctx.shadowBlur = 0;
  });
}

function drawCard(ctx, W, H, text, isOutro) {
  const s = TZ.s, t = tpl();
  setup(ctx);
  const base = Math.min(W, H);
  const g = ctx.createLinearGradient(0, 0, W * 0.3, H);
  g.addColorStop(0, t.c1);
  g.addColorStop(1, t.c2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = t.accent;
  ctx.fillRect(W * 0.3, H * 0.5 + base * 0.2, W * 0.4, base * 0.012);
  if (TZ.logoEl && TZ.logoEl.complete && TZ.logoEl.naturalWidth) {
    const r = TZ.logoEl.naturalWidth / TZ.logoEl.naturalHeight;
    const lh = base * 0.16, lw = lh * r, p = base * 0.02, lx = W / 2 - lw / 2, ly = H * 0.5 - base * 0.44;
    ctx.fillStyle = "#fff";
    rr(ctx, lx - p, ly - p, lw + p * 2, lh + p * 2, base * 0.025);
    ctx.fill();
    ctx.drawImage(TZ.logoEl, lx, ly, lw, lh);
  }
  const fs = base * 0.075;
  ctx.font = `900 ${fs}px ${FONT}`;
  ctx.fillStyle = t.cardText;
  ctx.textAlign = "center";
  const lines = wrapText(ctx, text || (isOutro ? "" : s.headline), W * 0.82).slice(0, 5);
  const lh = fs * 1.5;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 - ((lines.length - 1) * lh) / 2 + i * lh));
  if (s.brand.trim()) {
    ctx.font = `700 ${base * 0.04}px ${FONT}`;
    ctx.globalAlpha = 0.85;
    ctx.fillText(s.brand.trim(), W / 2, H * 0.5 + base * 0.28);
    ctx.globalAlpha = 1;
  }
}

function headlineEnd(tl) {
  // در قالب «فقط اول»: تیتر روی تکه‌ی اول (حداکثر ۶ ثانیه)
  if (TZ.s.headlineMode !== "first") return tl.mainEnd;
  const first = TZ.s.clips[0] ? clipDur(TZ.s.clips[0]) : 5;
  return Math.min(tl.mainStart + Math.min(6, Math.max(2.5, first)), tl.mainEnd);
}

// ───────────── قالب کرمان راوی (مثل ریلزهای صفحه) ─────────────
const KR = { red: "#9d1819", navy: "#193153" };

// متن با واژه‌های *ستاره‌دار* قرمز → فهرست واژه‌ها با رنگ
function richWords(text, base, hi) {
  const out = [];
  String(text).split("*").forEach((part, i) => part.split(/\s+/).filter(Boolean).forEach((w) => out.push({ w, c: i % 2 ? hi : base })));
  return out;
}
function wrapRich(ctx, words, maxW) {
  const lines = [];
  let line = [], w = 0;
  const sp = ctx.measureText(" ").width;
  for (const t of words) {
    const tw = ctx.measureText(t.w).width;
    if (line.length && w + sp + tw > maxW) { lines.push({ words: line, w }); line = []; w = 0; }
    w += (line.length ? sp : 0) + tw;
    line.push({ ...t, tw });
  }
  if (line.length) lines.push({ words: line, w });
  return lines;
}
// کشیدن یک سطر راست‌به‌چپ، واژه‌به‌واژه (هر واژه رنگ خودش)
function drawRichLine(ctx, line, right, y) {
  const sp = ctx.measureText(" ").width;
  let x = right;
  ctx.textAlign = "right";
  for (const t of line.words) { ctx.fillStyle = t.c; ctx.fillText(t.w, x, y); x -= t.tw + sp; }
}

function krLower(phase) {
  const s = TZ.s;
  const speaker = s.speakerName.trim() ? ["sp", s.speakerName.trim(), s.speakerTitle.trim()] : null;
  const credit = s.credit.trim() ? ["cr", "تهیه و تدوین:", s.credit.trim()] : null;
  const pick = phase === "intro" ? (credit || speaker) : (speaker || credit);
  return pick ? pick.join("|") : "";
}

function krPattern(ctx, x0, y0, w, h) {
  // الگوی شبکه‌ای کم‌رنگ پس‌زمینه‌ی نوار پایین (ثابت، بدون تصادف)
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const pts = Array.from({ length: 34 }, () => [x0 + rnd() * w, y0 + rnd() * h]);
  ctx.strokeStyle = "rgba(25,49,83,.10)";
  ctx.lineWidth = Math.max(1, h * 0.01);
  pts.forEach((a, i) => pts.slice(i + 1).forEach((b) => { if (Math.hypot(a[0] - b[0], a[1] - b[1]) < h * 0.9) { ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); } }));
  ctx.fillStyle = "rgba(25,49,83,.16)";
  pts.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, h * 0.018, 0, Math.PI * 2); ctx.fill(); });
}

function krBrand(ctx, W, H, phase = "main") {
  setup(ctx);
  const base = Math.min(W, H), vertical = H > W;
  // قاب قرمز
  const fx = W * (vertical ? 0.07 : 0.05), fy = H * (vertical ? 0.105 : 0.07), fb = H * (vertical ? 0.83 : 0.8);
  ctx.strokeStyle = "rgba(157,24,25,.9)";
  ctx.lineWidth = base * 0.0055;
  rr(ctx, fx, fy, W - fx * 2, fb - fy, base * 0.035);
  ctx.stroke();
  // نوار پایین
  const bh = H * (vertical ? 0.115 : 0.15), by = H - bh;
  const g = ctx.createLinearGradient(0, by, 0, H);
  g.addColorStop(0, "#eef1f5"); g.addColorStop(1, "#d9dfe7");
  ctx.fillStyle = g;
  ctx.fillRect(0, by, W, bh);
  krPattern(ctx, 0, by, W, bh);
  ctx.fillStyle = "rgba(25,49,83,.35)";
  ctx.fillRect(0, by, W, Math.max(1, base * 0.002));
  // لوگو سمت چپ
  if (TZ.logoEl && TZ.logoEl.complete && TZ.logoEl.naturalWidth) {
    const r = TZ.logoEl.naturalWidth / TZ.logoEl.naturalHeight;
    const lh = bh * 0.62, lw = lh * r;
    ctx.drawImage(TZ.logoEl, W * 0.05, by + (bh - lh) / 2, lw, lh);
  }
  // نام و سمت / تهیه و تدوین — سمت راست
  const lower = krLower(phase);
  if (lower) {
    const [kind, l1, l2] = lower.split("|");
    const right = W * 0.94;
    ctx.textAlign = "right";
    ctx.font = `900 ${bh * 0.26}px ${FONT}`;
    ctx.fillStyle = KR.red;
    ctx.fillText(l1, right, by + bh * (l2 ? 0.36 : 0.5));
    if (l2) {
      let fs = bh * (kind === "cr" ? 0.24 : 0.17);
      ctx.font = `${kind === "cr" ? 900 : 700} ${fs}px ${FONT}`;
      const maxW = W * 0.55;
      while (ctx.measureText(l2).width > maxW && fs > bh * 0.1) { fs *= 0.93; ctx.font = `700 ${fs}px ${FONT}`; }
      ctx.fillStyle = KR.navy;
      ctx.fillText(l2, right, by + bh * 0.7);
    }
  }
}

function krHeadline(ctx, W, H) {
  const s = TZ.s;
  const text = [s.kicker.trim(), s.headline.trim()].filter(Boolean).join(" ");
  if (!text) return;
  setup(ctx);
  const base = Math.min(W, H), vertical = H > W;
  const fs = base * (vertical ? 0.1 : 0.075);
  ctx.font = `900 ${fs}px ${FONT}`;
  const words = richWords(s.headline.trim(), KR.red, KR.navy);
  if (s.kicker.trim()) words.unshift(...richWords(s.kicker.trim(), KR.navy, KR.navy));
  const lines = wrapRich(ctx, words, W * (vertical ? 0.62 : 0.5)).slice(0, 4);
  const lh = fs * 1.32, px = fs * 0.35, py = fs * 0.25;
  const bw = Math.max(...lines.map((l) => l.w)) + px * 2, bhh = lines.length * lh + py * 2;
  const right = W * (vertical ? 0.87 : 0.9), top = s.headlinePos === "top" ? H * (vertical ? 0.17 : 0.14) : H * (vertical ? 0.5 : 0.45);
  ctx.fillStyle = "rgba(255,255,255,.9)";
  rr(ctx, right - bw, top, bw, bhh, fs * 0.28);
  ctx.fill();
  lines.forEach((l, i) => drawRichLine(ctx, l, right - px, top + py + lh * (i + 0.5)));
}

function krCaption(ctx, W, H, text) {
  const s = TZ.s;
  setup(ctx);
  const base = Math.min(W, H), vertical = H > W;
  const fs = base * (vertical ? 0.05 : 0.042) * (Number(s.captionSize) || 1);
  ctx.font = `700 ${fs}px ${FONT}`;
  const lines = wrapRich(ctx, richWords(text, KR.navy, KR.red), W * 0.66).slice(0, 4);
  const lh = fs * 1.45, px = fs * 0.5, py = fs * 0.3;
  const bw = Math.max(...lines.map((l) => l.w)) + px * 2, bhh = lines.length * lh + py * 2;
  const cy = H * (vertical ? 0.66 : 0.66), top = cy - bhh / 2;
  ctx.fillStyle = "rgba(255,255,255,.88)";
  rr(ctx, W / 2 - bw / 2, top, bw, bhh, fs * 0.35);
  ctx.fill();
  // هر سطر وسط‌چین
  lines.forEach((l, i) => drawRichLine(ctx, l, W / 2 + l.w / 2, top + py + lh * (i + 0.5)));
}

function drawMedia(ctx, el, W, H, fit, zoom = 1, gray = false) {
  const sw = el.videoWidth || el.naturalWidth, sh = el.videoHeight || el.naturalHeight;
  if (!sw || !sh) return;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-W / 2, -H / 2);
  const cover = Math.max(W / sw, H / sh), contain = Math.min(W / sw, H / sh);
  if (gray) ctx.filter = "grayscale(1)";
  if (fit === "crop") {
    ctx.drawImage(el, (W - sw * cover) / 2, (H - sh * cover) / 2, sw * cover, sh * cover);
  } else {
    if (fit === "blur") {
      ctx.filter = gray ? "blur(18px) brightness(0.8) grayscale(1)" : "blur(18px) brightness(0.8)";
      ctx.drawImage(el, (W - sw * cover) / 2 - 30, (H - sh * cover) / 2 - 30, sw * cover + 60, sh * cover + 60);
      ctx.filter = "none";
    } else { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); }
    if (gray) ctx.filter = "grayscale(1)";
    ctx.drawImage(el, (W - sw * contain) / 2, (H - sh * contain) / 2, sw * contain, sh * contain);
  }
  ctx.filter = "none";
  ctx.restore();
}

// نوشته‌ها باید دقیقاً هم‌اندازه‌ی ویدیوی خروجی باشند
function renderSize() {
  const [w, h] = outSize();
  return TZ.s.quality === "1080" ? [Math.round(w * 1.5), Math.round(h * 1.5)] : [w, h];
}

function layerCanvas(draw) {
  const [W, H] = renderSize();
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  draw(c.getContext("2d"), W, H);
  return c;
}

function mediaEl(m) {
  if (TZ.els[m.media_id]) return TZ.els[m.media_id];
  let el;
  if (m.kind === "video") {
    el = document.createElement("video");
    el.muted = true; el.playsInline = true; el.preload = "auto";
    el.addEventListener("seeked", () => { if (!TZ.playing) drawPreview(); });
    el.addEventListener("loadeddata", () => { if (!TZ.playing) drawPreview(); });
  } else {
    el = new Image();
    el.onload = () => { if (!TZ.playing) drawPreview(); };
  }
  el.src = `/api/media/${m.media_id}/file`;
  TZ.els[m.media_id] = el;
  return el;
}

// کدام تکه در زمان t است
function clipAt(t) {
  const tl = timeline();
  if (TZ.s.intro && t < tl.introDur) return { card: "intro", local: t };
  if (TZ.s.outro && t >= tl.mainEnd) return { card: "outro", local: t - tl.mainEnd };
  let acc = tl.mainStart;
  for (const c of TZ.s.clips) {
    const d = clipDur(c);
    if (t < acc + d || c === TZ.s.clips[TZ.s.clips.length - 1]) return { clip: c, local: Math.min(d, t - acc), dur: d };
    acc += d;
  }
  return {};
}

function drawPreview() {
  const cv = $("#tz-canvas");
  if (!cv) return;
  const [W, H] = outSize();
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, W, H);
  const tl = timeline();
  const t = Math.min(TZ.t, Math.max(0, tl.total - 0.01));
  const at = clipAt(t);
  if (at.card) { drawCard(ctx, W, H, at.card === "intro" ? (TZ.s.introText || TZ.s.headline) : TZ.s.outroText, at.card === "outro"); }
  else if (at.clip) {
    const el = mediaEl(at.clip);
    const zoom = at.clip.kind === "image" && at.clip.zoom !== false ? 1 + 0.08 * (at.local / at.dur) : 1;
    if (at.clip.kind === "video" && !TZ.playing) {
      const want = (Number(at.clip.start) || 0) + at.local;
      if (el.readyState >= 1 && Math.abs(el.currentTime - want) > 0.15) el.currentTime = want;
    }
    if ((el.readyState ?? 4) >= 2 || el.complete) drawMedia(ctx, el, W, H, TZ.s.fit, zoom, !!at.clip.gray);
    if (t >= tl.mainStart && t < tl.mainEnd) {
      const hEnd = headlineEnd(tl);
      drawBrand(ctx, W, H, t < hEnd && TZ.s.headlineMode === "first" ? "intro" : "main");
      if (t < hEnd) drawHeadline(ctx, W, H);
      const cap = captionTimes().find((c) => t >= c.start && t < c.end);
      if (cap) drawCaption(ctx, W, H, cap.text);
    }
  } else {
    ctx.fillStyle = "#777";
    ctx.textAlign = "center";
    ctx.direction = "rtl";
    ctx.font = `700 ${Math.min(W, H) * 0.045}px ${FONT}`;
    ctx.fillText("عکس یا ویدیو اضافه کنید", W / 2, H / 2);
    drawBrand(ctx, W, H);
    drawHeadline(ctx, W, H);
  }
  const range = $("#tz-range");
  if (range) { range.max = tl.total || 1; range.value = t; }
  const lbl = $("#tz-time");
  if (lbl) lbl.textContent = `${num(t.toFixed(1))} / ${num(tl.total.toFixed(1))} ثانیه`;
}

// پخش پیش‌نمایش (تقریبی)
let playStart = 0, playFrom = 0, playClip = null, playAudio = null;
function togglePlay() {
  if (TZ.playing) return stopPlay();
  const tl = timeline();
  if (!tl.total) return;
  if (TZ.t >= tl.total - 0.1) TZ.t = 0;
  TZ.playing = true;
  playStart = performance.now();
  playFrom = TZ.t;
  playClip = null;
  if (TZ.s.musicId) {
    playAudio = new Audio(`/api/media/${TZ.s.musicId}/file`);
    playAudio.volume = Math.min(1, Number(TZ.s.musicVolume) || 0.35);
    playAudio.currentTime = TZ.t;
    playAudio.play().catch(() => {});
  }
  $("#tz-play").textContent = "⏸";
  const step = () => {
    if (!TZ.playing) return;
    TZ.t = playFrom + (performance.now() - playStart) / 1000;
    if (TZ.t >= tl.total) { stopPlay(); TZ.t = 0; drawPreview(); return; }
    const at = clipAt(TZ.t);
    if (at.clip !== playClip) {
      if (playClip?.kind === "video") mediaEl(playClip).pause();
      playClip = at.clip;
      if (playClip?.kind === "video") {
        const el = mediaEl(playClip);
        el.currentTime = (Number(playClip.start) || 0) + at.local;
        el.muted = !TZ.s.keepAudio;
        el.play().catch(() => {});
      }
    }
    drawPreview();
    TZ.raf = requestAnimationFrame(step);
  };
  step();
}
function stopPlay() {
  TZ.playing = false;
  cancelAnimationFrame(TZ.raf);
  if (playClip?.kind === "video") { const el = mediaEl(playClip); el.pause(); el.muted = true; }
  if (playAudio) { playAudio.pause(); playAudio = null; }
  const b = $("#tz-play");
  if (b) b.textContent = "▶";
}

// ───────────── صفحه‌ی تیزرساز ─────────────
VIEWS.teaser = async (view, params) => {
  stopPlay();
  const [media, music, list, brandPref] = await Promise.all([
    api("/api/media"), api("/api/media?kind=audio"), api("/api/teasers"), api("/api/prefs/teaser_brand"), loadRefs(),
  ]);
  TZ.media = media.filter((m) => m.kind !== "audio");
  TZ.music = media.filter((m) => m.kind === "audio" || (m.kind === "video" && m.has_audio)).concat(music.filter((m) => !media.some((x) => x.id === m.id)));
  if (!TZ.s) {
    try { TZ.s = { ...teaserDefaults(), ...JSON.parse(lsGet("teaserDraft", "null") || "{}") }; } catch { TZ.s = teaserDefaults(); }
    if (brandPref.value) for (const k of ["brand", "template", "accent", "logoId", "kicker", "fit", "headlinePos", "outroText", "quality", "footerText", "credit", "headlineMode"]) if (brandPref.value[k] !== undefined && (!TZ.s[k] || k === "logoId")) TZ.s[k] = brandPref.value[k];
  }
  const storyId = params.get("story");
  if (storyId) {
    const st = REFS.stories.find((x) => String(x.id) === storyId) || await api(`/api/stories/${storyId}`);
    if (TZ.s.story_id !== st.id) {
      Object.assign(TZ.s, { story_id: st.id, headline: st.title, title: st.title });
      if (!TZ.s.captionsText && st.body) {
        const r = await api("/api/ai/captions", { method: "POST", body: { text: st.body, n: 6 } }).catch(() => ({ lines: [] }));
        TZ.s.captionsText = r.lines.join("\n");
      }
    }
    history.replaceState(null, "", "#teaser");
  }
  const fromTools = lsGet("teaserCaptions");
  if (fromTools) { try { TZ.s.captionsText = JSON.parse(fromTools).join("\n"); } catch { /* */ } lsSet("teaserCaptions", ""); try { localStorage.removeItem("teaserCaptions"); } catch { /* */ } }
  TZ.logoEl = null;
  if (TZ.s.logoId) { TZ.logoEl = new Image(); TZ.logoEl.onload = () => drawPreview(); TZ.logoEl.src = logoUrl(TZ.s.logoId); }

  if (!META.ffmpeg) {
    view.innerHTML = `<div class="card error">ffmpeg روی سرور نصب نیست؛ ساخت تیزر ممکن نیست. (با Dockerfile همین پروژه خودکار نصب می‌شود.)</div>`;
    return;
  }
  const s = TZ.s;
  view.innerHTML = `
    <div class="page-title"><h2>🎬 تیزرساز</h2><div class="btn-row"><button class="btn" id="tz-new">🆕 تیزر تازه</button></div></div>
    <div class="teaser-layout">
      <div class="steps">
        <div class="card step"><h3>قالب و اندازه</h3>
          <div class="chips">${Object.entries(FORMATS).map(([k, l]) => `<button class="chip ${s.format === k ? "active" : ""}" data-fmt="${k}">${l}</button>`).join("")}</div>
          <div class="form-grid">
            <label>کیفیت<select data-k="quality"><option value="720" ${s.quality === "720" ? "selected" : ""}>۷۲۰ (سریع، مناسب شبکه‌های اجتماعی)</option><option value="1080" ${s.quality === "1080" ? "selected" : ""}>۱۰۸۰ (کندتر، حافظه‌ی بیشتر)</option></select></label>
            <label>عکس/ویدیوی ناهم‌اندازه<select data-k="fit"><option value="blur" ${s.fit === "blur" ? "selected" : ""}>پس‌زمینه‌ی تار (پیشنهادی)</option><option value="crop" ${s.fit === "crop" ? "selected" : ""}>بریدن و پر کردن قاب</option><option value="fit" ${s.fit === "fit" ? "selected" : ""}>کامل با حاشیه‌ی سیاه</option></select></label>
          </div>
        </div>

        <div class="card step"><h3>عکس‌ها و ویدیوها</h3>
          <div class="clips" id="tz-clips"></div>
          <div class="btn-row" style="margin:10px 0">
            <label class="btn primary">⬆️ افزودن از گوشی<input type="file" id="tz-up" accept="image/*,video/*" multiple hidden></label>
            <span class="muted small" id="tz-up-st"></span>
          </div>
          <details><summary class="small">کتابخانه‌ی فایل‌های قبلی (${num(TZ.media.length)})</summary><div class="media-grid" id="tz-lib" style="margin-top:8px"></div></details>
        </div>

        <div class="card step"><h3>تیتر و نوشته‌ها</h3>
          <div class="form-grid">
            <label>روتیتر / برچسب<input data-k="kicker" value="${esc(s.kicker)}" placeholder="مثلاً فوری، گزارش، ویدیو"></label>
            <label>نام رسانه (کارت‌ها)<input data-k="brand" value="${esc(s.brand)}" placeholder="مثلاً خبرگزاری …"></label>
            <label class="wide">نوشته‌ی نوار پایین (قالب کرمان راوی)<input data-k="footerText" value="${esc(s.footerText || "")}" class="ltr" placeholder="www.kermanravi.ir"></label>
            <label class="wide">تیتر<textarea data-k="headline" rows="2" placeholder="تیتر اصلی کلیپ">${esc(s.headline)}</textarea>
              <small>در قالب «کرمان راوی» واژه‌هایی را که بین دو ستاره بنویسید سرمه‌ای می‌شوند، مثلاً: برگزاری *رویداد* سولار</small></label>
            <label>نام گوینده (نوار پایین)<input data-k="speakerName" value="${esc(s.speakerName || "")}" placeholder="مثلاً حمید علیزاده"></label>
            <label>سمت گوینده<input data-k="speakerTitle" value="${esc(s.speakerTitle || "")}" placeholder="مثلاً مدیر دفتر …"></label>
            <label class="wide">تهیه و تدوین<input data-k="credit" value="${esc(s.credit || "")}" placeholder="نام خبرنگار (در ابتدای کلیپ نمایش داده می‌شود)"></label>
            <label>جای تیتر<select data-k="headlinePos"><option value="top" ${s.headlinePos === "top" ? "selected" : ""}>بالا</option><option value="bottom" ${s.headlinePos === "bottom" ? "selected" : ""}>پایین</option></select></label>
            <label>نمایش تیتر<select data-k="headlineMode"><option value="all" ${s.headlineMode === "all" ? "selected" : ""}>در تمام کلیپ</option><option value="first" ${s.headlineMode === "first" ? "selected" : ""}>فقط روی تکه‌ی اول</option></select></label>
            <label class="wide">زیرنویس‌ها (هر خط یک زیرنویس)<textarea data-k="captionsText" rows="5" placeholder="جمله‌ی اول&#10;جمله‌ی دوم&#10;…">${esc(s.captionsText)}</textarea>
              <small>واژه‌های مهم را بین دو ستاره بنویسید تا قرمز شوند: حدود *۱۴۰ مگاوات* نصب شده. زمان هر زیرنویس خودکار بر اساس طول جمله تقسیم می‌شود. <a href="#" id="tz-manual">${s.autoTime ? "تنظیم دستی زمان‌ها" : "زمان‌بندی خودکار"}</a>${s.story_id ? ` · <a href="#" id="tz-fromstory">ساخت از متن سوژه</a>` : ""}</small></label>
            <div class="wide captions" id="tz-times"></div>
            <label>اندازه‌ی زیرنویس<select data-k="captionSize"><option value="0.85" ${s.captionSize == 0.85 ? "selected" : ""}>کوچک</option><option value="1" ${s.captionSize == 1 ? "selected" : ""}>معمولی</option><option value="1.2" ${s.captionSize == 1.2 ? "selected" : ""}>بزرگ</option></select></label>
          </div>
        </div>

        <div class="card step"><h3>ظاهر و لوگو</h3>
          <div class="templates">${Object.entries(TEMPLATES).map(([k, t]) => `<button data-tpl="${k}" class="${s.template === k ? "active" : ""}" style="background:linear-gradient(135deg, ${t.c1}, ${t.c2});color:${t.cardText}"><span style="background:${t.accent};color:${t.kick};padding:0 5px;border-radius:4px">${t.name}</span></button>`).join("")}</div>
          <div class="color-row" style="margin-top:10px">
            <label>رنگ اصلی <input type="color" data-k="accent" value="${s.accent || tpl().accent}"></label>
            <button class="btn sm" id="tz-accent-reset">رنگ پیش‌فرض قالب</button>
            <label class="btn sm">🖼 لوگو<input type="file" id="tz-logo" accept="image/png,image/jpeg,image/webp" hidden></label>
            ${s.logoId !== "brand" ? `<button class="btn sm" id="tz-logo-brand">لوگوی کرمان راوی</button>` : ""}
            ${s.logoId ? `<button class="btn sm" id="tz-logo-x">بدون لوگو</button>` : ""}
          </div>
          <div class="form-grid" style="margin-top:10px">
            <label><span><input type="checkbox" data-k="intro" ${s.intro ? "checked" : ""}> کارت آغاز (۲٫۵ ثانیه)</span><input data-k="introText" value="${esc(s.introText)}" placeholder="خالی = همان تیتر"></label>
            <label><span><input type="checkbox" data-k="outro" ${s.outro ? "checked" : ""}> کارت پایان (۳ ثانیه)</span><input data-k="outroText" value="${esc(s.outroText)}" placeholder="مثلاً: گزارش کامل در سایت ما"></label>
          </div>
          <button class="btn sm" id="tz-savebrand" style="margin-top:8px">⭐ ذخیره‌ی نام رسانه، لوگو و قالب برای دفعه‌های بعد</button>
        </div>

        <div class="card step"><h3>صدا</h3>
          <div class="form-grid">
            <label><span><input type="checkbox" data-k="keepAudio" ${s.keepAudio ? "checked" : ""}> صدای خود ویدیوها</span>
              <input type="range" min="0" max="2" step="0.1" data-k="videoVolume" value="${s.videoVolume}"></label>
            <label>موسیقی زمینه<select data-k="musicId"><option value="">بدون موسیقی</option>${TZ.music.map((m) => `<option value="${m.id}" ${Number(s.musicId) === m.id ? "selected" : ""}>${esc(m.filename)}</option>`).join("")}</select>
              <input type="range" min="0" max="1" step="0.05" data-k="musicVolume" value="${s.musicVolume}" title="بلندی موسیقی"></label>
            <label class="btn sm wide" style="justify-self:start">🎵 افزودن فایل موسیقی<input type="file" id="tz-music" accept="audio/*" hidden></label>
            <label><span><input type="checkbox" data-k="fade" ${s.fade ? "checked" : ""}> محو شدن آغاز و پایان</span></label>
            <label>گذر بین تکه‌ها<select data-k="transition"><option value="fade" ${s.transition === "fade" ? "selected" : ""}>محو شدن</option><option value="none" ${s.transition === "none" ? "selected" : ""}>بدون افکت (برش)</option></select></label>
          </div>
        </div>

        <div class="card step"><h3>ساخت</h3>
          <div class="form-grid">
            <label class="wide">نام این تیزر (برای فهرست)<input data-k="title" value="${esc(s.title)}" placeholder="خالی = تیتر"></label>
            <label class="wide">مربوط به سوژه<select data-k="story_id"><option value=""></option>${REFS.stories.map((x) => `<option value="${x.id}" ${x.id === Number(s.story_id) ? "selected" : ""}>${esc(x.title)}</option>`).join("")}</select></label>
          </div>
          <p class="small muted" id="tz-sum"></p>
          <button class="btn primary big" id="tz-render">🎬 ساخت ویدیو</button>
        </div>
      </div>

      <div class="teaser-preview">
        <div class="card"><h3>پیش‌نمایش <small>تقریبی</small></h3>
          <canvas id="tz-canvas"></canvas>
          <div class="pv-controls"><button class="btn sm" id="tz-play">▶</button><input type="range" id="tz-range" min="0" step="0.05" value="0"><span class="small muted" id="tz-time"></span></div>
        </div>
        <div class="card"><h3>تیزرهای ساخته‌شده</h3><div class="list" id="tz-list"></div></div>
      </div>
    </div>`;

  // رویدادها
  const onChange = (el) => {
    const k = el.dataset.k;
    let v = el.type === "checkbox" ? el.checked : el.value;
    if (["musicId", "story_id"].includes(k)) v = v ? Number(v) : null;
    if (["musicVolume", "videoVolume", "captionSize"].includes(k)) v = Number(v);
    s[k] = v;
    if (k === "captionsText" && !s.autoTime) s.manual = [];
    saveDraft();
    if (k === "captionsText" || k === "intro" || k === "outro") drawTimes();
    summary();
    drawPreview();
  };
  $$("[data-k]", view).forEach((el) => el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" || el.type === "color" ? "change" : "input", () => onChange(el)));
  $$("[data-fmt]", view).forEach((b) => (b.onclick = () => { s.format = b.dataset.fmt; saveDraft(); refresh(); }));
  $$("[data-tpl]", view).forEach((b) => (b.onclick = () => { s.template = b.dataset.tpl; s.accent = ""; saveDraft(); refresh(); }));
  $("#tz-accent-reset").onclick = () => { s.accent = ""; saveDraft(); refresh(); };
  $("#tz-new").onclick = () => { if (!confirm("همه‌ی تنظیمات این تیزر پاک شود؟")) return; const keep = { brand: s.brand, template: s.template, accent: s.accent, logoId: s.logoId, kicker: s.kicker }; TZ.s = { ...teaserDefaults(), ...keep }; saveDraft(); refresh(); };
  $("#tz-play").onclick = togglePlay;
  $("#tz-range").oninput = (ev) => { stopPlay(); TZ.t = Number(ev.target.value); drawPreview(); };
  $("#tz-manual").onclick = (ev) => {
    ev.preventDefault();
    s.autoTime = !s.autoTime;
    if (!s.autoTime) s.manual = captionTimes().map((c) => [c.start, c.end]);
    saveDraft(); refresh();
  };
  if ($("#tz-fromstory")) $("#tz-fromstory").onclick = async (ev) => {
    ev.preventDefault();
    const st = await api(`/api/stories/${s.story_id}`);
    if (!st.body) return toast("متن این سوژه خالی است");
    const r = await api("/api/ai/captions", { method: "POST", body: { text: st.body, n: 6 } });
    s.captionsText = r.lines.join("\n"); saveDraft(); refresh();
  };
  $("#tz-savebrand").onclick = async () => {
    await api("/api/prefs/teaser_brand", { method: "PUT", body: { value: { brand: s.brand, template: s.template, accent: s.accent, logoId: s.logoId, kicker: s.kicker, footerText: s.footerText, credit: s.credit, headlineMode: s.headlineMode, fit: s.fit, headlinePos: s.headlinePos, outroText: s.outroText, quality: s.quality } } });
    toast("ذخیره شد؛ تیزرهای بعدی با همین تنظیمات شروع می‌شوند ⭐");
  };
  $("#tz-up").onchange = (ev) => uploadMedia(ev.target.files, true);
  $("#tz-music").onchange = async (ev) => { const added = await uploadMedia(ev.target.files, false); if (added[0]) { s.musicId = added[0].id; saveDraft(); refresh(); } };
  $("#tz-logo").onchange = async (ev) => { const added = await uploadMedia(ev.target.files, false); if (added[0]) { s.logoId = added[0].id; saveDraft(); refresh(); } };
  if ($("#tz-logo-brand")) $("#tz-logo-brand").onclick = () => { s.logoId = "brand"; saveDraft(); refresh(); };
  if ($("#tz-logo-x")) $("#tz-logo-x").onclick = () => { s.logoId = null; saveDraft(); refresh(); };
  $("#tz-render").onclick = renderTeaser;

  if (params.get("auto")) {
    history.replaceState(null, "", "#teaser");
    setTimeout(() => renderTeaser(), 400);
  }
  drawClips();
  drawLib();
  drawTimes();
  summary();
  drawList(list);
  if (document.fonts) document.fonts.load(`900 40px Vazirmatn`).then(drawPreview).catch(drawPreview);
  drawPreview();
};

function summary() {
  const tl = timeline();
  const el = $("#tz-sum");
  if (!el) return;
  const [w, h] = outSize();
  const q = TZ.s.quality === "1080" ? 1.5 : 1;
  el.textContent = `مدت: ${num(tl.total.toFixed(1))} ثانیه · ${num(TZ.s.clips.length)} تکه · خروجی ${num(TZ.s.quality === "1080" ? w * 1.5 : w)}×${num(TZ.s.quality === "1080" ? h * 1.5 : h)} · زمان تقریبی ساخت: ${num(Math.max(1, Math.round((tl.total * 1.2 * q) / 60)))} تا ${num(Math.max(2, Math.round((tl.total * 3 * q) / 60)))} دقیقه`;
}

function drawClips() {
  const box = $("#tz-clips");
  const s = TZ.s;
  if (!s.clips.length) { box.innerHTML = `<div class="empty">هنوز عکس یا ویدیویی اضافه نشده. از دکمه‌ی زیر فایل انتخاب کنید (می‌توانید چندتا را با هم انتخاب کنید).</div>`; return; }
  box.innerHTML = s.clips.map((c, i) => `<div class="clip">
    ${c.hasThumb !== false ? `<img src="/api/media/${c.media_id}/thumb" alt="" onerror="this.outerHTML='<div class=ph>${c.kind === "video" ? "🎞" : "🖼"}</div>'">` : `<div class="ph">${c.kind === "video" ? "🎞" : "🖼"}</div>`}
    <div class="ctrl">
      ${c.kind === "image" ? `<span>مدت <input type="number" step="0.5" min="0.5" max="30" value="${c.duration}" data-ci="${i}" data-f="duration"> ث</span>
        <label><input type="checkbox" data-ci="${i}" data-f="zoom" ${c.zoom !== false ? "checked" : ""}> زوم آرام</label>`
      : `<span>از ثانیه <input type="number" step="0.5" min="0" max="${c.mediaDuration || 0}" value="${c.start || 0}" data-ci="${i}" data-f="start"></span>
        <span>به مدت <input type="number" step="0.5" min="0.5" max="${c.mediaDuration || 0}" value="${c.duration}" data-ci="${i}" data-f="duration"> ث</span>
        <small class="muted">(کل ویدیو ${num((c.mediaDuration || 0).toFixed(1))} ث)</small>`}
      <label><input type="checkbox" data-ci="${i}" data-f="gray" ${c.gray ? "checked" : ""}> سیاه‌وسفید</label>
      <button class="btn sm ghost" data-cprev="${i}" title="پیش‌نمایش این تکه">👁</button>
    </div>
    <div class="ord">
      <button data-up="${i}" title="بالا">▲</button><button data-rm="${i}" title="حذف">✕</button><button data-dn="${i}" title="پایین">▼</button>
    </div></div>`).join("");
  $$("[data-ci]", box).forEach((el) => (el.onchange = () => {
    const c = s.clips[Number(el.dataset.ci)];
    if (el.dataset.f === "zoom") c.zoom = el.checked;
    else if (el.dataset.f === "gray") c.gray = el.checked;
    else {
      let v = Math.max(0, Number(enDigits(el.value)) || 0);
      if (c.kind === "video") {
        const md = c.mediaDuration || 0;
        if (el.dataset.f === "start") { v = Math.min(v, Math.max(0, md - 0.5)); c.start = v; c.duration = Math.min(c.duration, md - v); }
        else c.duration = Math.min(Math.max(0.5, v), md - (c.start || 0));
      } else c.duration = Math.min(30, Math.max(0.5, v));
    }
    saveDraft(); drawClips(); drawTimes(); summary(); drawPreview();
  }));
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= s.clips.length) return; [s.clips[i], s.clips[j]] = [s.clips[j], s.clips[i]]; saveDraft(); drawClips(); drawPreview(); };
  $$("[data-up]", box).forEach((b) => (b.onclick = () => move(Number(b.dataset.up), -1)));
  $$("[data-dn]", box).forEach((b) => (b.onclick = () => move(Number(b.dataset.dn), 1)));
  $$("[data-rm]", box).forEach((b) => (b.onclick = () => { s.clips.splice(Number(b.dataset.rm), 1); saveDraft(); drawClips(); drawTimes(); summary(); drawPreview(); }));
  $$("[data-cprev]", box).forEach((b) => (b.onclick = () => {
    const i = Number(b.dataset.cprev);
    TZ.t = timeline().mainStart + s.clips.slice(0, i).reduce((a, c) => a + clipDur(c), 0) + 0.1;
    stopPlay(); drawPreview();
    $("#tz-canvas").scrollIntoView({ behavior: "smooth", block: "center" });
  }));
}

function drawLib() {
  const box = $("#tz-lib");
  box.innerHTML = TZ.media.length ? TZ.media.map((m) => `<div class="m" data-add="${m.id}" title="${esc(m.filename)}">
    ${m.thumb ? `<img src="/api/media/${m.id}/thumb" alt="" loading="lazy">` : m.kind === "video" ? "🎞" : "🖼"}
    <span>${m.kind === "video" ? num((m.duration || 0).toFixed(0)) + " ث" : "عکس"}</span>
    <button class="x" data-mdel="${m.id}" title="حذف از کتابخانه">✕</button></div>`).join("") : `<div class="empty">خالی است.</div>`;
  box.onclick = async (ev) => {
    const del = ev.target.closest("[data-mdel]");
    if (del) {
      ev.stopPropagation();
      if (!confirm("این فایل از کتابخانه حذف شود؟")) return;
      await api(`/api/media/${del.dataset.mdel}`, { method: "DELETE" });
      TZ.media = TZ.media.filter((m) => m.id !== Number(del.dataset.mdel));
      TZ.s.clips = TZ.s.clips.filter((c) => c.media_id !== Number(del.dataset.mdel));
      saveDraft(); drawLib(); drawClips(); drawPreview();
      return;
    }
    const a = ev.target.closest("[data-add]");
    if (a) { addClip(TZ.media.find((m) => m.id === Number(a.dataset.add))); toast("اضافه شد"); }
  };
}

function addClip(m) {
  TZ.s.clips.push(m.kind === "video"
    ? { media_id: m.id, kind: "video", start: 0, duration: +Math.min(m.duration || 5, 15).toFixed(1), mediaDuration: m.duration || 0, hasThumb: !!m.thumb }
    : { media_id: m.id, kind: "image", duration: 3, zoom: true, hasThumb: !!m.thumb });
  if (!TZ.s.title && !TZ.s.headline) TZ.s.title = "";
  saveDraft(); drawClips(); drawTimes(); summary(); drawPreview();
}

function drawTimes() {
  const box = $("#tz-times");
  if (!box) return;
  const s = TZ.s;
  const caps = captionTimes();
  if (s.autoTime || !caps.length) { box.innerHTML = caps.length ? `<div class="small muted">${caps.map((c) => `${num(c.start.toFixed(1))}–${num(c.end.toFixed(1))}ث: ${esc(c.text.slice(0, 30))}`).join(" · ")}</div>` : ""; return; }
  box.innerHTML = `<div class="small muted">زمان شروع و پایان هر زیرنویس (ثانیه):</div>` + caps.map((c, i) => `<div class="cap"><span class="small">${esc(c.text)}</span>
    <input type="number" step="0.1" value="${c.start}" data-mi="${i}" data-mj="0"><input type="number" step="0.1" value="${c.end}" data-mi="${i}" data-mj="1"></div>`).join("");
  $$("[data-mi]", box).forEach((el) => (el.onchange = () => { s.manual[Number(el.dataset.mi)][Number(el.dataset.mj)] = Number(el.value) || 0; saveDraft(); drawPreview(); }));
}

async function uploadMedia(fileList, addToClips) {
  const files = [...fileList];
  const st = $("#tz-up-st");
  const added = [];
  for (let i = 0; i < files.length; i++) {
    if (st) st.textContent = `در حال بارگذاری ${num(i + 1)} از ${num(files.length)}…`;
    const r = await uploadOne("/api/media", files[i], {}, (fr) => { if (st) st.textContent = `در حال بارگذاری ${num(i + 1)} از ${num(files.length)}: ${num(Math.round(fr * 100))}٪`; });
    if (r.ok) {
      for (const m of r.data.added) {
        added.push(m);
        if (m.kind !== "audio") TZ.media.unshift(m); else TZ.music.unshift(m);
        if (addToClips && m.kind !== "audio") addClip(m);
      }
    } else toast(`${files[i].name}: ${r.error}`, 5000);
  }
  if (st) st.textContent = added.length ? `${num(added.length)} فایل اضافه شد` : "";
  if ($("#tz-lib")) drawLib();
  return added;
}

async function renderTeaser() {
  const s = TZ.s;
  if (!s.clips.length) return toast("اول حداقل یک عکس یا ویدیو اضافه کنید");
  const btn = $("#tz-render");
  btn.disabled = true;
  btn.textContent = "در حال آماده‌سازی نوشته‌ها…";
  try {
    if (document.fonts) await Promise.all([document.fonts.load(`900 40px Vazirmatn`), document.fonts.load(`700 40px Vazirmatn`)]).catch(() => {});
    if (TZ.logoEl && !TZ.logoEl.complete) await new Promise((r) => { TZ.logoEl.onload = r; TZ.logoEl.onerror = r; });
    const tl = timeline();
    const png = (c) => c.toDataURL("image/png");
    const overlays = [];
    const hEnd = headlineEnd(tl);
    const twoPhase = tpl().style === "kr" && s.headlineMode === "first" && hEnd < tl.mainEnd && krLower("intro") !== krLower("main");
    if (twoPhase) {
      overlays.push({ image: png(layerCanvas((c, W, H) => drawBrand(c, W, H, "intro"))), start: tl.mainStart, end: hEnd });
      overlays.push({ image: png(layerCanvas((c, W, H) => drawBrand(c, W, H, "main"))), start: hEnd, end: tl.mainEnd });
    } else if (s.brand.trim() || TZ.logoEl || tpl().style === "kr") overlays.push({ image: png(layerCanvas(drawBrand)), start: tl.mainStart, end: tl.mainEnd });
    if (s.headline.trim() || s.kicker.trim()) {
      overlays.push({ image: png(layerCanvas(drawHeadline)), start: tl.mainStart, end: hEnd });
    }
    const caps = captionTimes();
    for (const c of caps) overlays.push({ image: png(layerCanvas((ctx, W, H) => drawCaption(ctx, W, H, c.text))), start: c.start, end: c.end });
    const clips = s.clips.map((c) => ({ media_id: c.media_id, duration: clipDur(c), start: c.start || 0, zoom: c.zoom !== false, gray: !!c.gray }));
    if (s.intro) clips.unshift({ card: png(layerCanvas((ctx, W, H) => drawCard(ctx, W, H, s.introText || s.headline, false))), duration: INTRO_DUR, zoom: true });
    if (s.outro) clips.push({ card: png(layerCanvas((ctx, W, H) => drawCard(ctx, W, H, s.outroText, true))), duration: OUTRO_DUR, zoom: false });
    btn.textContent = "در حال فرستادن…";
    await api("/api/teasers", {
      method: "POST",
      body: {
        title: (s.title || s.headline || "تیزر").replace(/\*/g, ""), format: s.format, quality: s.quality, fit: s.fit, clips, overlays,
        music_id: s.musicId, music_volume: s.musicVolume, keep_audio: s.keepAudio, video_volume: s.videoVolume,
        fade: s.fade, transition: s.transition, captions: caps, story_id: s.story_id, editor: s,
      },
    });
    toast("در صف ساخت قرار گرفت 🎬 وقتی آماده شد خبرتان می‌کنیم.", 4000);
    drawList(await api("/api/teasers"));
    $("#tz-list").scrollIntoView({ behavior: "smooth" });
  } catch (err) { if (!(err instanceof LoginRequired)) toast(err.message, 6000); }
  btn.disabled = false;
  btn.textContent = "🎬 ساخت ویدیو";
}

const TZ_STATUS = { queued: ["در صف", "gray"], rendering: ["در حال ساخت", "amber"], done: ["آماده", "green"], error: ["خطا", "red"], cancelled: ["لغو شد", "gray"] };

function drawList(list) {
  const box = $("#tz-list");
  if (!box) return;
  box.innerHTML = list.length ? list.map((t) => {
    const [st, cls] = TZ_STATUS[t.status] || [t.status, ""];
    return `<div class="teaser-card">
      ${t.has_thumb ? `<img src="/api/teasers/${t.id}/thumb?${t.updated_at}" alt="" data-play="${t.id}" style="cursor:pointer">` : `<div class="clip"><div class="ph">🎬</div></div>`}
      <div><b>${esc(t.title)}</b>
        <div class="meta small muted"><span class="badge ${cls}">${st}${t.status === "rendering" ? " " + num(Math.round(t.progress * 100)) + "٪" : ""}</span> ${esc(FORMATS[t.format]?.split(" ")[0] || "")} ${t.duration ? "· " + num(Math.round(t.duration)) + " ثانیه" : ""} ${t.size ? "· " + num((t.size / 1048576).toFixed(1)) + " MB" : ""}</div>
        ${t.status === "rendering" ? `<div class="progress"><span style="width:${Math.round(t.progress * 100)}%"></span></div>` : ""}
        ${t.error ? `<details class="small error"><summary>جزئیات خطا</summary><code class="ltr" style="white-space:pre-wrap">${esc(t.error)}</code></details>` : ""}
        <div class="btn-row" style="margin-top:4px">
          ${t.status === "done" ? `<button class="btn sm" data-play="${t.id}">▶ دیدن</button><a class="btn sm primary" href="/api/teasers/${t.id}/video?download=1">⬇️ دانلود</a>${t.has_captions ? `<a class="btn sm" href="/api/teasers/${t.id}/srt" title="فایل زیرنویس جدا">SRT</a>` : ""}` : ""}
          ${t.editor ? `<button class="btn sm" data-edit="${t.id}" title="بارگذاری تنظیمات این تیزر در ویرایشگر">✏️ ویرایش</button>` : ""}
          ${["error", "cancelled"].includes(t.status) ? `<button class="btn sm" data-retry="${t.id}">↻ دوباره</button>` : ""}
          ${["queued", "rendering"].includes(t.status) ? `<button class="btn sm" data-cancel="${t.id}">توقف</button>` : `<button class="btn sm danger" data-tdel="${t.id}">🗑</button>`}
        </div>
      </div></div>`;
  }).join("") : `<div class="empty">هنوز تیزری ساخته نشده.</div>`;
  box.onclick = async (ev) => {
    const b = ev.target.closest("[data-play],[data-edit],[data-retry],[data-cancel],[data-tdel]");
    if (!b) return;
    const d = b.dataset;
    if (d.play) {
      $("#dlg-body").innerHTML = `<video src="/api/teasers/${d.play}/video" controls autoplay playsinline style="width:100%;max-height:78vh;border-radius:12px;background:#000"></video>
        <div class="modal-actions"><a class="btn primary" href="/api/teasers/${d.play}/video?download=1">⬇️ دانلود</a><button class="btn" onclick="this.closest('dialog').close()">بستن</button></div>`;
      $("#dlg").showModal();
      $("#dlg").addEventListener("close", () => $("#dlg video")?.pause(), { once: true });
    } else if (d.edit) {
      const t = list.find((x) => x.id === Number(d.edit));
      TZ.s = { ...teaserDefaults(), ...t.editor };
      saveDraft();
      refresh();
      window.scrollTo(0, 0);
    } else if (d.retry) { await api(`/api/teasers/${d.retry}/retry`, { method: "POST" }); drawList(await api("/api/teasers")); }
    else if (d.cancel) { await api(`/api/teasers/${d.cancel}/cancel`, { method: "POST" }); setTimeout(async () => drawList(await api("/api/teasers")), 800); }
    else if (d.tdel) { if (!confirm("این تیزر حذف شود؟")) return; await api(`/api/teasers/${d.tdel}`, { method: "DELETE" }); drawList(await api("/api/teasers")); }
  };
  clearTimeout(TZ.poll);
  if (list.some((t) => ["queued", "rendering"].includes(t.status))) {
    TZ.poll = setTimeout(async () => { if (currentPage === "teaser") drawList(await api("/api/teasers").catch(() => list)); }, 3000);
  }
}
