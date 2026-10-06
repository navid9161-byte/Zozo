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
    layers: [], layersSize: null, capStyle: "box", capY: 0.66, subhead: "", footerSize: 1, kickSize: 1, headSize: 1, subSize: 1,
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

// متن بلند (مثلاً لید ۲۰۰ کلمه‌ای) ← زیرنویس‌های کوتاه؛ شکستن در نقطه/ویرگول، هر تکه حدود ۶ تا ۱۱ واژه
function splitLead(text, max = 10) {
  const out = [];
  for (const para of String(text).split("\n").map((x) => x.trim()).filter(Boolean)) {
    const words = para.split(/\s+/);
    if (words.length <= max + 3) { out.push(para); continue; }
    let cur = [];
    words.forEach((w, i) => {
      cur.push(w);
      const end = /[.!؟?؛;،,:]$/.test(w.replace(/[*»"']+$/, ""));
      const left = words.length - i - 1;
      if ((end && cur.length >= 5) || cur.length >= max) {
        if (left > 0 && left < 4 && !end) return;  // تکه‌ی آخر خیلی کوتاه نماند
        out.push(cur.join(" ")); cur = [];
      }
    });
    if (cur.length) out.push(cur.join(" "));
  }
  // ستاره‌های رنگی که بین دو تکه شکسته شده‌اند، در هر تکه کامل شوند
  let open = false;
  return out.map((l) => { let x = (open ? "*" : "") + l; const n = (l.match(/\*/g) || []).length; if ((n + (open ? 1 : 0)) % 2) { x += "*"; open = true; } else open = false; return x; });
}

function captionLines() {
  return splitLead(TZ.s.captionsText, 14);
}

function captionTimes() {
  const s = TZ.s;
  const lines = captionLines();
  const tl = timeline();
  if (!lines.length || tl.main <= 0) return [];
  if (!s.autoTime && s.manual.length) {
    // زمان‌های دستی/خودکارِ گفتار برای خط‌هایی که دارند؛ خط‌های اضافه در زمانِ باقی‌مانده پخش می‌شوند
    const out = lines.slice(0, s.manual.length).map((text, i) => ({ text, start: s.manual[i][0], end: s.manual[i][1] }));
    const rest = lines.slice(s.manual.length);
    if (rest.length) {
      let a = out.length ? out[out.length - 1].end + 0.05 : tl.mainStart + 0.3;
      const d = Math.max(0.8, (tl.mainEnd - 0.2 - a) / rest.length);
      rest.forEach((text) => { out.push({ text, start: +a.toFixed(2), end: +(a + d - 0.05).toFixed(2) }); a += d; });
    }
    return out;
  }
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

// شکستن متن با رعایت Enter های کاربر (هر پاراگراف جدا شکسته می‌شود)
function wrapParas(ctx, text, maxW) {
  return String(text).split("\n").map((p) => p.trim()).filter(Boolean).flatMap((p) => wrapText(ctx, p, maxW));
}
function wrapRichParas(ctx, text, base, hi, maxW) {
  return String(text).split("\n").map((p) => p.trim()).filter(Boolean).flatMap((p) => wrapRich(ctx, richWords(p, base, hi), maxW));
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
  if (TZ.s.freeTpl) return;  // اجزای قالب به لایه‌ی آزاد تبدیل شده‌اند
  if (tpl().style === "kr") return krHeadline(ctx, W, H);
  const s = TZ.s, t = tpl();
  const sub = (s.subhead || "").trim();
  if (!s.headline.trim() && !s.kicker.trim() && !sub) return;
  setup(ctx);
  const base = Math.min(W, H), m = base * 0.055, vertical = H > W;
  const hs = base * (vertical ? 0.068 : 0.06) * (Number(s.headSize) || 1), ks = base * 0.042 * (Number(s.kickSize) || 1), ss = base * (vertical ? 0.042 : 0.037) * (Number(s.subSize) || 1);
  ctx.font = `900 ${hs}px ${FONT}`;
  const maxW = W - m * 2 - base * 0.06;
  const lines = s.headline.trim() ? wrapParas(ctx, s.headline.replace(/\*/g, ""), maxW).slice(0, 5) : [];
  ctx.font = `700 ${ss}px ${FONT}`;
  const subLines = sub ? wrapParas(ctx, sub.replace(/\*/g, ""), maxW).slice(0, 2) : [];
  const lh = hs * 1.45, slh = ss * 1.5, padY = base * 0.025, padX = base * 0.03;
  const kickH = s.kicker.trim() ? ks * 1.7 : 0;
  const bodyH = lines.length * lh + subLines.length * slh;
  const blockH = kickH + (bodyH ? bodyH + padY * 2 : 0);
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
  if (!bodyH) return;
  ctx.font = `900 ${hs}px ${FONT}`;
  let bw = Math.max(0, ...lines.map((l) => ctx.measureText(l).width));
  ctx.font = `700 ${ss}px ${FONT}`;
  bw = Math.max(bw, ...subLines.map((l) => ctx.measureText(l).width)) + padX * 2;
  if (t.band) {
    ctx.fillStyle = t.band;
    rr(ctx, right - bw, y, bw, bodyH + padY * 2, base * 0.014);
    ctx.fill();
    ctx.fillStyle = t.accent;
    ctx.fillRect(right - base * 0.012, y, base * 0.012, bodyH + padY * 2);
  } else {
    ctx.shadowColor = "rgba(0,0,0,.85)"; ctx.shadowBlur = base * 0.02;
  }
  ctx.fillStyle = t.head;
  ctx.textAlign = "right";
  ctx.font = `900 ${hs}px ${FONT}`;
  lines.forEach((l, i) => ctx.fillText(l, right - padX, y + padY + lh * (i + 0.5)));
  ctx.font = `700 ${ss}px ${FONT}`;
  ctx.globalAlpha = 0.9;
  subLines.forEach((l, i) => ctx.fillText(l, right - padX, y + padY + lines.length * lh + slh * (i + 0.5)));
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function drawBrand(ctx, W, H, phase = "main") {
  if (TZ.s.freeTpl) return;
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
    const fh = base * 0.075 * (Number(s.footerSize) || 1), fy = H - fh;
    ctx.fillStyle = t.accent;
    ctx.fillRect(0, fy, W, fh);
    ctx.fillStyle = "rgba(25,49,83,.95)";
    ctx.fillRect(0, fy - base * 0.006, W, base * 0.006);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = `800 ${fh * 0.56}px ${FONT}`;
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
  if (tpl().style === "kr" || (TZ.s.capStyle && TZ.s.capStyle !== "auto")) return krCaption(ctx, W, H, text);
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
  const lines = wrapParas(ctx, String(text || (isOutro ? "" : s.headline)).replace(/\*/g, ""), W * 0.82).slice(0, 5);
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

// نوار قرمز آدرس سایت (قالب کرمان راوی)؛ ارتفاعش را برمی‌گرداند (۰ اگر آدرسی نیست)
function krUrlStrip(ctx, W, H, base) {
  const s = TZ.s, txt = (s.footerText || "").trim();
  if (!txt || s.showUrl === false) return 0;
  const sh = base * 0.062 * (Number(s.footerSize) || 1);
  ctx.fillStyle = KR.red;
  ctx.fillRect(0, H - sh, W, sh);
  ctx.fillStyle = "#fff"; ctx.textAlign = "center";
  ctx.font = `800 ${sh * 0.6}px ${FONT}`;
  ctx.fillText(txt, W / 2, H - sh / 2 + sh * 0.04);
  return sh;
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
  // نوار قرمز آدرس سایت پایینِ نوار (درشت و خوانا)
  const sh = krUrlStrip(ctx, W, H, base);
  const ch = bh - sh;  // ارتفاع بخشِ لوگو و نام
  // لوگو سمت چپ
  if (TZ.logoEl && TZ.logoEl.complete && TZ.logoEl.naturalWidth) {
    const r = TZ.logoEl.naturalWidth / TZ.logoEl.naturalHeight;
    const lh = ch * 0.66, lw = lh * r;
    ctx.drawImage(TZ.logoEl, W * 0.05, by + (ch - lh) / 2, lw, lh);
  }
  // نام و سمت / تهیه و تدوین — سمت راست
  const lower = krLower(phase);
  if (lower) {
    const [kind, l1, l2] = lower.split("|");
    const right = W * 0.94;
    ctx.textAlign = "right";
    const k = ch / bh;
    ctx.font = `900 ${bh * 0.26 * Math.max(0.8, k)}px ${FONT}`;
    ctx.fillStyle = KR.red;
    ctx.fillText(l1, right, by + ch * (l2 ? 0.34 : 0.5));
    if (l2) {
      let fs = bh * (kind === "cr" ? 0.24 : 0.17) * Math.max(0.8, k);
      ctx.font = `${kind === "cr" ? 900 : 700} ${fs}px ${FONT}`;
      const maxW = W * 0.55;
      while (ctx.measureText(l2).width > maxW && fs > bh * 0.1) { fs *= 0.93; ctx.font = `700 ${fs}px ${FONT}`; }
      ctx.fillStyle = KR.navy;
      ctx.fillText(l2, right, by + ch * 0.72);
    }
  }
}

// چیدمان سربرگ تیتر کرمان راوی؛ اگر تیتر بلند بود، نوشته کوچک می‌شود تا کامل جا شود (بریده نمی‌شود)
function krHeadLayout(ctx, W, H) {
  const s = TZ.s;
  const kick = s.kicker.trim(), head = s.headline.trim(), sub = (s.subhead || "").trim();
  if (!kick && !head && !sub) return null;
  const base = Math.min(W, H), vertical = H > W;
  const maxW = W * (vertical ? 0.66 : 0.5), maxH = H * (vertical ? 0.5 : 0.62);
  let k = 1, L;
  for (;;) {
    const fs = base * (vertical ? 0.1 : 0.075) * k * (Number(s.headSize) || 1), ks = base * (vertical ? 0.05 : 0.0375) * k * (Number(s.kickSize) || 1), ss = base * (vertical ? 0.056 : 0.042) * k * (Number(s.subSize) || 1);
    const parts = [];
    if (kick) { ctx.font = `800 ${ks}px ${FONT}`; parts.push({ text: kick, fs: ks, w: 800, lh: 1.5, ls: wrapRichParas(ctx, kick, KR.navy, KR.red, maxW), c: KR.navy, hi: KR.red }); }
    if (head) { ctx.font = `900 ${fs}px ${FONT}`; parts.push({ text: head, fs, w: 900, lh: 1.32, ls: wrapRichParas(ctx, head, KR.red, KR.navy, maxW), c: KR.red, hi: KR.navy }); }
    if (sub) { ctx.font = `800 ${ss}px ${FONT}`; parts.push({ text: sub, fs: ss, w: 800, lh: 1.45, ls: wrapRichParas(ctx, sub, KR.navy, KR.red, maxW), c: KR.navy, hi: KR.red }); }
    const px = fs * 0.35, py = fs * 0.25;
    const bhh = parts.reduce((a, q) => a + q.ls.length * q.fs * q.lh, 0) + py * 2;
    L = { parts, fs, px, py, bhh };
    if (bhh <= maxH || k < 0.5) break;
    k *= 0.92;
  }
  L.bw = Math.max(...L.parts.flatMap((q) => q.ls.map((l) => l.w))) + L.px * 2;
  L.right = W * (vertical ? 0.87 : 0.9);
  L.top = s.headlinePos === "top" ? H * (vertical ? 0.17 : 0.14) : H * (vertical ? 0.5 : 0.45);
  return L;
}

function krHeadline(ctx, W, H) {
  setup(ctx);
  const L = krHeadLayout(ctx, W, H);
  if (!L) return;
  ctx.fillStyle = "rgba(255,255,255,.9)";
  rr(ctx, L.right - L.bw, L.top, L.bw, L.bhh, L.fs * 0.28);
  ctx.fill();
  let y = L.top + L.py;
  for (const q of L.parts) {
    ctx.font = `${q.w} ${q.fs}px ${FONT}`;
    for (const l of q.ls) { const lh = q.fs * q.lh; drawRichLine(ctx, l, L.right - L.px, y + lh / 2); y += lh; }
  }
}

// زیرنویس با سبک انتخابی: کادر سفید (مثل صفحه)، نوشته‌ی سفید با سایه، کادر تیره، زرد با سایه
const CAP_STYLES = { box: "کادر سفید (مثل صفحه)", shadow: "نوشته‌ی سفید با سایه", dark: "کادر تیره", yellow: "نوشته‌ی زرد با سایه" };
function krCaption(ctx, W, H, text) {
  const s = TZ.s;
  setup(ctx);
  const base = Math.min(W, H), vertical = H > W;
  const st = CAP_STYLES[s.capStyle] ? s.capStyle : "box";
  const fs = base * (vertical ? 0.054 : 0.044) * (Number(s.captionSize) || 1);
  ctx.font = `800 ${fs}px ${FONT}`;
  const base_c = { box: KR.navy, shadow: "#ffffff", dark: "#ffffff", yellow: "#ffd23f" }[st];
  const hi_c = { box: KR.red, shadow: "#ffd23f", dark: "#ffd23f", yellow: "#ffffff" }[st];
  const lines = wrapRich(ctx, richWords(text, base_c, hi_c), W * 0.78).slice(0, 4);
  const lh = fs * 1.45, px = fs * 0.55, py = fs * 0.32;
  const bw = Math.max(...lines.map((l) => l.w)) + px * 2, bhh = lines.length * lh + py * 2;
  const cy = H * Math.min(0.92, Math.max(0.12, Number(s.capY) || 0.66));
  const top = Math.min(H - bhh - H * 0.02, cy - bhh / 2);
  if (st === "box" || st === "dark") {
    ctx.fillStyle = st === "box" ? "rgba(255,255,255,.82)" : "rgba(10,16,28,.72)";
    rr(ctx, W / 2 - bw / 2, top, bw, bhh, fs * 0.35);
    ctx.fill();
  } else {
    ctx.shadowColor = "rgba(0,0,0,.9)"; ctx.shadowBlur = fs * 0.35; ctx.shadowOffsetY = fs * 0.06;
    ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.lineWidth = fs * 0.14;
  }
  lines.forEach((l, i) => {
    const y = top + py + lh * (i + 0.5);
    if (st === "shadow" || st === "yellow") {
      let x = W / 2 + l.w / 2;
      const sp = ctx.measureText(" ").width;
      ctx.textAlign = "right";
      for (const t of l.words) { ctx.strokeText(t.w, x, y); x -= t.tw + sp; }
    }
    drawRichLine(ctx, l, W / 2 + l.w / 2, y);
  });
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
}

function drawMedia(ctx, el, W, H, fit, zoom = 1, gray = false, fr = null) {
  const sw = el.videoWidth || el.naturalWidth, sh = el.videoHeight || el.naturalHeight;
  if (!sw || !sh) return;
  const sc = fr ? Number(fr.scale) || 1 : 1, ox = fr ? Number(fr.ox) || 0 : 0, oy = fr ? Number(fr.oy) || 0 : 0;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-W / 2, -H / 2);
  const cover = Math.max(W / sw, H / sh), contain = Math.min(W / sw, H / sh);
  if (gray) ctx.filter = "grayscale(1)";
  if (fit === "crop") {
    // مثل سرور: پر کردن قاب، بزرگ‌نمایی (حداقل ۱)، برش از جای دلخواه بدون لبه‌ی خالی
    const k = cover * Math.max(1, sc), dw = sw * k, dh = sh * k;
    const x = Math.max(W - dw, Math.min(0, (W - dw) / 2 + ox * W)), y = Math.max(H - dh, Math.min(0, (H - dh) / 2 + oy * H));
    ctx.drawImage(el, x, y, dw, dh);
  } else {
    if (fit === "blur") {
      ctx.filter = gray ? "blur(18px) brightness(0.8) grayscale(1)" : "blur(18px) brightness(0.8)";
      ctx.drawImage(el, (W - sw * cover) / 2 - 30, (H - sh * cover) / 2 - 30, sw * cover + 60, sh * cover + 60);
      ctx.filter = "none";
    } else { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); }
    if (gray) ctx.filter = "grayscale(1)";
    const dw = sw * contain * sc, dh = sh * contain * sc;
    ctx.drawImage(el, (W - dw) / 2 + ox * W, (H - dh) / 2 + oy * H, dw, dh);
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
    el.addEventListener("seeked", () => { if (!TZ.playing) { drawPreview(); if (typeof DZ !== "undefined" && DZ.onImg) DZ.onImg(); } });
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

// لایه‌های دلخواه (ویرایشگر لایه‌ای) — با اندازه‌ی بوم فعلی هم‌مقیاس می‌شوند
function drawTzLayers(ctx, W, H, t) {
  const s = TZ.s;
  if (!s.layers?.length || typeof drawLayers !== "function") return;
  const [lw, lh] = s.layersSize || outSize();
  ctx.save();
  ctx.scale(W / lw, H / lh);
  drawLayers(ctx, s.layers, t);
  ctx.restore();
}

function drawPreview() {
  const cv = $("#tz-canvas");
  if (!cv) return;
  const [W, H] = outSize();
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext("2d");
  const tl = timeline();
  const t = Math.min(TZ.t, Math.max(0, tl.total - 0.01));
  drawFrame(ctx, W, H, t);
  drawTzLayers(ctx, W, H, t);
  const range = $("#tz-range");
  if (range) { range.max = tl.total || 1; range.value = t; }
  const lbl = $("#tz-time");
  if (lbl) lbl.textContent = `${num(t.toFixed(1))} / ${num(tl.total.toFixed(1))} ثانیه`;
}

// یک فریم تیزر در زمان t (بدون لایه‌های دلخواه)
function drawFrame(ctx, W, H, t) {
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, W, H);
  const tl = timeline();
  const at = clipAt(t);
  if (at.card) { drawCard(ctx, W, H, at.card === "intro" ? (TZ.s.introText || TZ.s.headline) : TZ.s.outroText, at.card === "outro"); }
  else if (at.clip) {
    const el = mediaEl(at.clip);
    const zoom = at.clip.kind === "image" && at.clip.zoom !== false ? 1 + 0.08 * (at.local / at.dur) : 1;
    if (at.clip.kind === "video" && !TZ.playing) {
      const want = (Number(at.clip.start) || 0) + at.local;
      if (el.readyState >= 1 && Math.abs(el.currentTime - want) > 0.15) el.currentTime = want;
    }
    if ((el.readyState ?? 4) >= 2 || el.complete) drawMedia(ctx, el, W, H, TZ.s.fit, zoom, !!at.clip.gray, at.clip);
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
}

// اجزای قالب (قاب، نوار پایین، لوگو، نام گوینده، روتیتر/تیتر/زیرتیتر، نوار سایت) ← لایه‌های آزاد و قابل‌ویرایش
function tzTplLayers(W, H) {
  const s = TZ.s, t = tpl(), out = [], tl = timeline(), hEnd = headlineEnd(tl);
  const base = Math.min(W, H), vertical = H > W;
  const id = () => "k" + Math.random().toString(36).slice(2, 8);
  const brandT = { start: tl.mainStart, end: tl.mainEnd }, headT = { start: tl.mainStart, end: hEnd };
  const text = (o) => out.push({ id: id(), type: "text", tpl: 1, ...LAYER_DEFAULTS.text, bg: "", pad: 0, shadow: false, ...o });
  const hasLogo = TZ.logoEl && TZ.logoEl.complete && TZ.logoEl.naturalWidth;
  const m = document.createElement("canvas").getContext("2d");
  setup(m);
  if (t.style === "kr") {
    const fx = W * (vertical ? 0.07 : 0.05), fy = H * (vertical ? 0.105 : 0.07), fb = H * (vertical ? 0.83 : 0.8);
    out.push({ id: id(), type: "rect", tpl: 1, ...LAYER_DEFAULTS.rect, x: fx, y: fy, w: W - fx * 2, h: fb - fy, fill: "", stroke: "#9d1819", strokeW: Math.max(2, base * 0.0055), radius: base * 0.035, opacity: 0.9, ...brandT });
    const bh = H * (vertical ? 0.115 : 0.15), by = H - bh;
    const bc = document.createElement("canvas");
    bc.width = W; bc.height = Math.ceil(bh);
    const b = bc.getContext("2d");
    const g = b.createLinearGradient(0, 0, 0, bh);
    g.addColorStop(0, "#eef1f5"); g.addColorStop(1, "#d9dfe7");
    b.fillStyle = g; b.fillRect(0, 0, W, bh);
    krPattern(b, 0, 0, W, bh);
    b.fillStyle = "rgba(25,49,83,.35)"; b.fillRect(0, 0, W, Math.max(1, base * 0.002));
    out.push({ id: id(), type: "image", tpl: 1, ...LAYER_DEFAULTS.image, src: bc.toDataURL("image/png"), fit: "cover", x: 0, y: by, w: W, h: bh, ...brandT });
    const url = (s.footerText || "").trim(), sh = url && s.showUrl !== false ? base * 0.062 * (Number(s.footerSize) || 1) : 0, ch = bh - sh;
    if (sh) {
      out.push({ id: id(), type: "rect", tpl: 1, ...LAYER_DEFAULTS.rect, x: 0, y: H - sh, w: W, h: sh, fill: KR.red, radius: 0, ...brandT });
      text({ text: url, size: +(sh * 0.6).toFixed(1), weight: 800, color: "#ffffff", hi: "#ffffff", align: "center", x: 0, y: H - sh, w: W, h: sh, ...brandT });
    }
    if (hasLogo) {
      const r = TZ.logoEl.naturalWidth / TZ.logoEl.naturalHeight, lh = ch * 0.66;
      out.push({ id: id(), type: "image", tpl: 1, ...LAYER_DEFAULTS.image, src: logoUrl(s.logoId), fit: "contain", x: W * 0.05, y: by + (ch - lh) / 2, w: lh * r, h: lh, ...brandT });
    }
    const lower = krLower("main");
    if (lower) {
      const [kind, l1, l2] = lower.split("|");
      const kk = Math.max(0.8, ch / bh), fs1 = bh * 0.26 * kk, fs2 = bh * (kind === "cr" ? 0.24 : 0.17) * kk;
      text({ text: l1, size: Math.round(fs1), weight: 900, color: KR.red, hi: KR.navy, align: "right", x: W * 0.94 - W * 0.6, w: W * 0.6, y: by + ch * (l2 ? 0.34 : 0.5) - fs1 * 0.7, h: fs1 * 1.4, ...brandT });
      if (l2) text({ text: l2, size: Math.round(fs2), weight: kind === "cr" ? 900 : 700, color: KR.navy, hi: KR.red, align: "right", x: W * 0.94 - W * 0.6, w: W * 0.6, y: by + ch * 0.72 - fs2 * 0.7, h: fs2 * 1.4, ...brandT });
    }
    // سربرگ تیتر: کادر سفید + سه نوشته‌ی جدا (همان چیدمان خودکار)
    const L = krHeadLayout(m, W, H);
    if (L) {
      out.push({ id: id(), type: "rect", tpl: 1, ...LAYER_DEFAULTS.rect, x: L.right - L.bw, y: L.top, w: L.bw, h: L.bhh, fill: "#ffffff", radius: L.fs * 0.28, opacity: 0.9, ...headT });
      let y = L.top + L.py;
      for (const q of L.parts) {
        const hh = q.ls.length * q.fs * q.lh;
        text({ text: q.text, size: +q.fs.toFixed(1), weight: q.w, color: q.c, hi: q.hi, align: "right", lh: q.lh, x: L.right - L.bw, w: L.bw - L.px, y, h: hh, ...headT });
        y += hh;
      }
    }
  } else {
    const hex = (c) => { const mm = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || ""); return mm ? "#" + mm.slice(1, 4).map((x) => Number(x).toString(16).padStart(2, "0")).join("") : (c || ""); };
    if (hasLogo) {
      const r = TZ.logoEl.naturalWidth / TZ.logoEl.naturalHeight, lw = Math.min(base * 0.1 * r, base * 0.32);
      out.push({ id: id(), type: "image", tpl: 1, ...LAYER_DEFAULTS.image, src: logoUrl(s.logoId), fit: "contain", x: base * 0.05, y: vertical ? H * 0.04 : H * 0.05, w: lw, h: lw / r, ...brandT });
    }
    if (t.footer && (s.footerText || "").trim()) {
      const fh = base * 0.075 * (Number(s.footerSize) || 1);
      out.push({ id: id(), type: "rect", tpl: 1, ...LAYER_DEFAULTS.rect, x: 0, y: H - fh, w: W, h: fh, fill: s.accent || t.accent, radius: 0, ...brandT });
      text({ text: s.footerText.trim(), size: Math.round(fh * 0.56), weight: 800, color: "#ffffff", hi: "#ffffff", align: "center", x: 0, y: H - fh, w: W, h: fh, ...brandT });
    }
    const lines = [s.kicker.trim(), s.headline.trim(), (s.subhead || "").trim()].filter(Boolean);
    if (lines.length) {
      const hs = base * (vertical ? 0.068 : 0.06);
      text({ text: lines.join("\n"), size: Math.round(hs), weight: 900, color: t.head, hi: s.accent || t.accent, align: "right", bg: t.band ? hex(t.band) : "", pad: base * 0.03, radius: base * 0.014,
        shadow: !t.band, x: base * 0.055, w: W - base * 0.11, y: s.headlinePos === "top" ? H * (vertical ? 0.12 : 0.1) : H * 0.55, h: hs * 1.45 * (lines.length + 1), ...headT });
    }
  }
  return out;
}

// جای عکس/ویدیوی یک تکه روی قاب (همان حسابی که drawMedia می‌کند) — برای کادر انتخاب در ویرایشگر
function clipRect(c, W, H) {
  const el = mediaEl(c);
  const sw = el.videoWidth || el.naturalWidth, sh = el.videoHeight || el.naturalHeight;
  if (!sw || !sh) return { x: 0, y: 0, w: W, h: H };
  const sc = Number(c.scale) || 1, ox = Number(c.ox) || 0, oy = Number(c.oy) || 0;
  if (TZ.s.fit === "crop") {
    const k = Math.max(W / sw, H / sh) * Math.max(1, sc), dw = sw * k, dh = sh * k;
    void dw; void dh;
    return { x: 0, y: 0, w: W, h: H };  // در حالت «بریدن» عکس همیشه کل قاب را پر می‌کند
  }
  const k = Math.min(W / sw, H / sh) * sc, dw = sw * k, dh = sh * k;
  return { x: (W - dw) / 2 + ox * W, y: (H - dh) / 2 + oy * H, w: dw, h: dh };
}

function openTeaserDesigner() {
  const s = TZ.s;
  stopPlay();
  const [W, H] = outSize();
  const tl = timeline();
  const dur = Math.max(1, +(tl.total || 10).toFixed(1));
  let layers = JSON.parse(JSON.stringify(s.layers || []));
  // اگر قالب (اندازه) عوض شده، لایه‌ها را به اندازه‌ی تازه ببریم
  if (s.layersSize && (s.layersSize[0] !== W || s.layersSize[1] !== H)) {
    const sx = W / s.layersSize[0], sy = H / s.layersSize[1], sc = Math.min(sx, sy);
    layers.forEach((l) => { l.x *= sx; l.y *= sy; l.w *= sx; l.h *= sy; if (l.size) l.size = Math.round(l.size * sc); });
  }
  let convert = false;
  if (!s.freeTpl && confirm("اجزای خود قالب هم (تیتر، روتیتر، زیرتیتر، نام گوینده، لوگو، قاب قرمز، نوار پایین) به لایه تبدیل شوند تا بتوانید جابه‌جا، بزرگ‌وکوچک، رنگی یا پاکشان کنید؟\n(«انصراف» = قالب همان‌طور خودکار بماند و فقط لایه‌ی تازه اضافه کنید)")) {
    layers = [...tzTplLayers(W, H), ...layers];
    convert = true;
  }
  const clipNow = (t) => clipAt(Math.min(t || 0, dur - 0.01)).clip;
  openDesigner({
    w: W, h: H, layers, timed: true, duration: dur, title: "🎨 لایه‌های ریلز",
    background: (ctx, w, h, t) => { const f = s.freeTpl; s.freeTpl = f || convert; drawFrame(ctx, w, h, Math.min(t || 0, dur - 0.01)); s.freeTpl = f; },
    bg: {
      label: "عکس/ویدیوی همین لحظه",
      move: (dx, dy, t) => { const c = clipNow(t); if (c) { c.ox = +Math.max(-1, Math.min(1, (c.ox || 0) + dx)).toFixed(4); c.oy = +Math.max(-1, Math.min(1, (c.oy || 0) + dy)).toFixed(4); } },
      zoom: (f, t) => { const c = clipNow(t); if (c) c.scale = +Math.min(4, Math.max(0.3, (c.scale ?? 1) * f)).toFixed(3); },
      reset: (t) => { const c = clipNow(t); if (c) Object.assign(c, { scale: 1, ox: 0, oy: 0 }); },
      rect: (t) => { const c = clipNow(t); return c ? clipRect(c, W, H) : null; },
    },
    onSave: (ls) => { s.layers = ls; s.layersSize = [W, H]; if (convert) s.freeTpl = true; saveDraft(); refresh(); },
  });
}

// لایه‌ها ← چند تصویر شفاف؛ هر بازه‌ی زمانی که مجموعه‌ی لایه‌های فعالش فرق کند یک تصویر جدا
function layerOverlays(total) {
  const s = TZ.s, ls = (s.layers || []).filter((l) => !l.hidden);
  if (!ls.length) return [];
  const st = (l) => Math.max(0, l.start ?? 0), en = (l) => Math.min(total, l.end ?? total);
  const cuts = [...new Set([0, total, ...ls.flatMap((l) => [st(l), en(l)])])].filter((x) => x >= 0 && x <= total).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1];
    if (b - a < 0.05) continue;
    const mid = (a + b) / 2;
    const act = ls.filter((l) => st(l) <= mid && en(l) > mid);
    if (!act.length) continue;
    const key = act.map((l) => l.id).join(",");
    if (out.length && out[out.length - 1].key === key && Math.abs(out[out.length - 1].end - a) < 0.01) { out[out.length - 1].end = b; continue; }
    out.push({ key, act, start: a, end: b });
  }
  return out;
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
    if (brandPref.value) for (const k of ["brand", "template", "accent", "logoId", "kicker", "fit", "headlinePos", "outroText", "quality", "footerText", "footerSize", "credit", "headlineMode"]) if (brandPref.value[k] !== undefined && (!TZ.s[k] || k === "logoId")) TZ.s[k] = brandPref.value[k];
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
    <div class="page-title"><h2>🎬 تیزرساز</h2><div class="btn-row">
      <div class="seg"><button id="tz-simple" class="${TZ.simple ? "active" : ""}">✨ ساده</button><button id="tz-adv" class="${TZ.simple ? "" : "active"}">⚙️ همه‌ی تنظیمات</button></div>
      <button class="btn" id="tz-new">🆕 تیزر تازه</button></div></div>
    ${TZ.simple ? `<p class="small muted">حالت ساده: فقط ویدیو را بگذارید، تیتر و نام گوینده را بنویسید، «🎙 زیرنویس خودکار» را بزنید و «ساخت ویدیو». بقیه با تنظیمات ذخیره‌شده‌ی کرمان راوی ساخته می‌شود.</p>` : ""}
    <div class="teaser-layout">
      <div class="steps ${TZ.simple ? "simple" : ""}">
        <div class="card step adv"><h3>قالب و اندازه</h3>
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
          <p class="small muted" style="margin:0 0 6px">👆 جا و اندازه‌ی هر عکس/ویدیو: روی پیش‌نمایش با انگشت بکشید تا جابه‌جا شود، با دو انگشت (یا چرخ موس) بزرگ و کوچک کنید، یا دکمه‌های «اندازه − +» همان تکه را بزنید.</p>
          <details><summary class="small">کتابخانه‌ی فایل‌های قبلی (${num(TZ.media.length)})</summary><div class="media-grid" id="tz-lib" style="margin-top:8px"></div></details>
        </div>

        <div class="card step"><h3>تیتر و نام‌ها</h3>
          ${s.freeTpl ? `<p class="small" style="color:var(--primary)">✏️ تیتر و اجزای قالب الان «لایه‌ی آزاد» هستند؛ از «🎨 لایه‌ها» ویرایششان کنید (تغییر این کادرها روی ویدیو اثر ندارد).</p>` : ""}
          <div class="form-grid">
            <label class="wide">روتیتر (سطر کوچک بالای تیتر)<input data-k="kicker" value="${esc(s.kicker)}" placeholder="مثلاً: در یکصدوپانزدهمین طرح توسعه‌ی شهری"></label>
            <label class="adv">نام رسانه (کارت‌ها)<input data-k="brand" value="${esc(s.brand)}" placeholder="مثلاً خبرگزاری …"></label>
            <label class="wide">آدرس سایت (نوار پایین ویدیو)<input data-k="footerText" value="${esc(s.footerText || "")}" class="ltr" placeholder="www.kermanravi.ir"><small>خالی بگذارید تا نمایش داده نشود.</small></label>
            <label>اندازه‌ی آدرس سایت<select data-k="footerSize">${[[0.8, "کوچک"], [1, "معمولی"], [1.25, "بزرگ"], [1.5, "خیلی بزرگ"]].map(([v, l]) => `<option value="${v}" ${Number(s.footerSize || 1) === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
            <label class="wide">تیتر<textarea data-k="headline" rows="3" placeholder="تیتر اصلی کلیپ">${esc(s.headline)}</textarea>
              <small>هر جا Enter بزنید تیتر در ویدیو هم همان‌جا به سطر بعد می‌رود. واژه‌های بین دو ستاره رنگ دوم می‌گیرند: برگزاری *رویداد* سولار</small></label>
            <label class="wide">زیرتیتر (سطر کوچک زیر تیتر)<input data-k="subhead" value="${esc(s.subhead || "")}" placeholder="مثلاً: با هدف ارتقای ضریب ایمنی شهر"></label>
            <div class="wide tz-sizes">${[["kickSize", "اندازه‌ی روتیتر"], ["headSize", "اندازه‌ی تیتر"], ["subSize", "اندازه‌ی زیرتیتر"]].map(([k, l]) => `<label>${l}<select data-k="${k}">${[[0.7, "خیلی کوچک"], [0.85, "کوچک"], [1, "معمولی"], [1.15, "بزرگ"], [1.3, "خیلی بزرگ"], [1.5, "درشت"]].map(([v, t]) => `<option value="${v}" ${Number(s[k] || 1) === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>`).join("")}</div>
            <label>نام گوینده (نوار پایین)<input data-k="speakerName" value="${esc(s.speakerName || "")}" placeholder="مثلاً حمید علیزاده"></label>
            <label>سمت گوینده<input data-k="speakerTitle" value="${esc(s.speakerTitle || "")}" placeholder="مثلاً مدیر دفتر …"></label>
            <label class="wide">تهیه و تدوین<input data-k="credit" value="${esc(s.credit || "")}" placeholder="نام خبرنگار (در ابتدای کلیپ نمایش داده می‌شود)"></label>
            <label class="adv">جای تیتر<select data-k="headlinePos"><option value="top" ${s.headlinePos === "top" ? "selected" : ""}>بالا</option><option value="bottom" ${s.headlinePos === "bottom" ? "selected" : ""}>پایین</option></select></label>
            <label class="adv">نمایش تیتر<select data-k="headlineMode"><option value="all" ${s.headlineMode === "all" ? "selected" : ""}>در تمام کلیپ</option><option value="first" ${s.headlineMode === "first" ? "selected" : ""}>فقط روی تکه‌ی اول</option></select></label>
          </div>
        </div>

        <div class="card step"><h3>زیرنویس</h3>
          <div class="btn-row" style="margin-bottom:8px">
            <button class="btn primary" id="tz-asr">🎙 زیرنویس خودکار از صدای ویدیو</button>
            <button class="btn" id="tz-tap">👆 زمان‌بندی با ضربه</button>
            ${s.story_id ? `<button class="btn sm" id="tz-fromstory">📝 جمله‌های کوتاه از متن سوژه</button>` : ""}
          </div>
          <div class="tz-lead">
            <b class="small">📰 لید بلند به‌جای زیرنویس جمله‌به‌جمله</b>
            <div class="btn-row">
              ${s.story_id ? `<button class="btn sm" id="tz-lead">✍️ ساخت لید از متن سوژه</button>` : ""}
              <label class="small">حدود <select id="tz-lead-n">${[100, 150, 200, 250, 300].map((n) => `<option value="${n}" ${n === 200 ? "selected" : ""}>${num(n)}</option>`).join("")}</select> کلمه</label>
              <button class="btn sm" id="tz-split">✂️ تقسیم متن بلند به زیرنویس‌های کوتاه</button>
            </div>
            <p class="small muted" style="margin:4px 0 0">لید را در کادر زیر بچسبانید (یا از متن سوژه بسازید) و «تقسیم» را بزنید؛ هر تکه یک زیرنویس کوتاه می‌شود و به ترتیب در طول ویدیو نشان داده می‌شود. اگر هم تقسیم نکنید، جمله‌های بلند خودکار شکسته می‌شوند و بریده نمی‌شوند.</p>
          </div>
          <p class="small muted" style="margin-top:0">«زیرنویس خودکار» حرف‌های داخل ویدیو را می‌شنود و هر جمله را دقیقاً همان لحظه‌ای که گفته می‌شود نشان می‌دهد. اگر خودتان زیرنویس را نوشته باشید، فقط زمانش را با گفتار هماهنگ می‌کند. بعد می‌توانید متن را اصلاح کنید.</p>
          <div class="form-grid"><label class="wide">زیرنویس‌ها (هر خط یک زیرنویس)<textarea data-k="captionsText" rows="5" placeholder="جمله‌ی اول&#10;جمله‌ی دوم&#10;…">${esc(s.captionsText)}</textarea>
            <small>واژه‌های مهم را بین دو ستاره بنویسید تا رنگی شوند: حدود *۱۴۰ مگاوات* نصب شده.
            ${s.autoTime ? "" : ` · <a href="#" id="tz-manual">تقسیم دوباره‌ی زمان بر اساس طول جمله</a>`}</small></label></div>
          <div class="captions" id="tz-tapbox" hidden></div>
          <div class="captions" id="tz-times"></div>
          <div class="form-grid" style="margin-top:10px">
            <label>ظاهر زیرنویس<select data-k="capStyle">${Object.entries(CAP_STYLES).map(([k, l]) => `<option value="${k}" ${s.capStyle === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
            <label>اندازه<select data-k="captionSize"><option value="0.85" ${s.captionSize == 0.85 ? "selected" : ""}>کوچک</option><option value="1" ${s.captionSize == 1 ? "selected" : ""}>معمولی</option><option value="1.2" ${s.captionSize == 1.2 ? "selected" : ""}>بزرگ</option><option value="1.4" ${s.captionSize == 1.4 ? "selected" : ""}>خیلی بزرگ</option></select></label>
            <label class="wide">جای زیرنویس (بالا ↔ پایین)<input type="range" min="0.3" max="0.9" step="0.01" data-k="capY" value="${s.capY ?? 0.66}"></label>
          </div>
        </div>

        <div class="card step adv"><h3>ظاهر و لوگو</h3>
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

        <div class="card step"><h3>🎨 ویرایش آزاد و لایه‌ها (مثل کنوا)</h3>
          <p class="small muted">روی ویدیو هر چیزی بگذارید: متن با رنگ و کادر و سایه، شکل، خط، عکس، لوگو. هر لایه را با انگشت جابه‌جا و بزرگ‌وکوچک کنید و تعیین کنید از چه ثانیه‌ای تا چه ثانیه‌ای دیده شود.</p>
          <div class="btn-row">
            <button class="btn primary" id="tz-design">🎨 باز کردن ویرایشگر لایه‌ای</button>
            ${s.layers?.length ? `<span class="small muted">${num(s.layers.length)} لایه</span><button class="btn sm danger" id="tz-clear-layers">🗑 پاک کردن لایه‌ها</button>` : ""}
            ${s.freeTpl ? `<button class="btn sm" id="tz-auto-tpl">↩️ بازگشت به قالب خودکار</button>` : ""}
          </div>
        </div>

        <div class="card step adv"><h3>صدا</h3>
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
            <label class="wide adv">نام این تیزر (برای فهرست)<input data-k="title" value="${esc(s.title)}" placeholder="خالی = تیتر"></label>
            <label class="wide adv">مربوط به سوژه<select data-k="story_id"><option value=""></option>${REFS.stories.map((x) => `<option value="${x.id}" ${x.id === Number(s.story_id) ? "selected" : ""}>${esc(x.title)}</option>`).join("")}</select></label>
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
    if (["musicVolume", "videoVolume", "captionSize", "capY", "footerSize", "kickSize", "headSize", "subSize"].includes(k)) v = Number(v);
    s[k] = v;
    saveDraft();
    if (k === "captionsText" || k === "intro" || k === "outro") drawTimes();
    summary();
    drawPreview();
  };
  $$("[data-k]", view).forEach((el) => el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" || el.type === "color" ? "change" : "input", () => onChange(el)));
  $$("[data-fmt]", view).forEach((b) => (b.onclick = () => { s.format = b.dataset.fmt; saveDraft(); refresh(); }));
  $$("[data-tpl]", view).forEach((b) => (b.onclick = () => { s.template = b.dataset.tpl; s.accent = ""; saveDraft(); refresh(); }));
  $("#tz-accent-reset").onclick = () => { s.accent = ""; saveDraft(); refresh(); };
  $("#tz-design").onclick = openTeaserDesigner;
  if ($("#tz-clear-layers")) $("#tz-clear-layers").onclick = () => { if (!confirm("همه‌ی لایه‌های دلخواه پاک شود؟")) return; s.layers = []; s.freeTpl = false; saveDraft(); refresh(); };
  if ($("#tz-auto-tpl")) $("#tz-auto-tpl").onclick = () => {
    if (!confirm("تیتر، نام گوینده، لوگو و قاب دوباره خودکار از قالب ساخته شوند؟ (لایه‌هایی که از قالب ساخته شده بودند حذف می‌شوند؛ لایه‌های خودتان می‌مانند)")) return;
    s.layers = (s.layers || []).filter((l) => !l.tpl); s.freeTpl = false; saveDraft(); refresh();
  };
  $("#tz-new").onclick = () => { if (!confirm("همه‌ی تنظیمات این تیزر پاک شود؟")) return; const keep = { brand: s.brand, template: s.template, accent: s.accent, logoId: s.logoId, kicker: s.kicker }; TZ.s = { ...teaserDefaults(), ...keep }; saveDraft(); refresh(); };
  $("#tz-play").onclick = togglePlay;
  bindClipDrag($("#tz-canvas"));
  $("#tz-range").oninput = (ev) => { stopPlay(); TZ.t = Number(ev.target.value); drawPreview(); };
  if ($("#tz-manual")) $("#tz-manual").onclick = (ev) => { ev.preventDefault(); s.autoTime = true; s.manual = []; saveDraft(); refresh(); };
  $("#tz-simple").onclick = () => { TZ.simple = true; lsSet("tzSimple", "1"); refresh(); };
  $("#tz-adv").onclick = () => { TZ.simple = false; lsSet("tzSimple", "0"); refresh(); };
  $("#tz-asr").onclick = autoCaptions;
  $("#tz-split").onclick = () => {
    const parts = splitLead(s.captionsText, 10);
    if (!parts.length) return toast("اول متن (لید) را در کادر زیرنویس بنویسید یا بچسبانید");
    s.captionsText = parts.join("\n"); s.autoTime = true; s.manual = []; saveDraft(); refresh();
    toast(`${num(parts.length)} زیرنویس ساخته شد ✔`);
  };
  if ($("#tz-lead")) $("#tz-lead").onclick = async () => {
    const st = await api(`/api/stories/${s.story_id}`);
    if (!st.body) return toast("متن این سوژه خالی است");
    const n = Number($("#tz-lead-n").value) || 200;
    const r = await api("/api/ai/lead", { method: "POST", body: { text: st.body, n } });
    const lead = (r.lines || []).join(" ");
    if (!lead) return toast("لیدی ساخته نشد");
    s.captionsText = splitLead(lead, 10).join("\n"); s.autoTime = true; s.manual = []; saveDraft(); refresh();
    toast(`لید حدود ${num(lead.split(/\s+/).length)} کلمه ساخته و به زیرنویس‌ها تقسیم شد ✔`, 4000);
  };
  $("#tz-tap").onclick = startTapTiming;
  if ($("#tz-fromstory")) $("#tz-fromstory").onclick = async (ev) => {
    ev.preventDefault();
    const st = await api(`/api/stories/${s.story_id}`);
    if (!st.body) return toast("متن این سوژه خالی است");
    const r = await api("/api/ai/captions", { method: "POST", body: { text: st.body, n: 6 } });
    s.captionsText = r.lines.join("\n"); s.autoTime = true; s.manual = []; saveDraft(); refresh();
  };
  $("#tz-savebrand").onclick = async () => {
    await api("/api/prefs/teaser_brand", { method: "PUT", body: { value: { brand: s.brand, template: s.template, accent: s.accent, logoId: s.logoId, kicker: s.kicker, footerText: s.footerText, footerSize: s.footerSize, credit: s.credit, headlineMode: s.headlineMode, fit: s.fit, headlinePos: s.headlinePos, outroText: s.outroText, quality: s.quality } } });
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
      <span class="clip-size">اندازه <button class="btn sm ghost" data-csz="${i}:-0.1">−</button><b>${num(Math.round((c.scale ?? 1) * 100))}٪</b><button class="btn sm ghost" data-csz="${i}:0.1">+</button>
        ${(c.scale ?? 1) !== 1 || c.ox || c.oy ? `<button class="btn sm ghost" data-creset="${i}" title="اندازه و جای اول">↺</button>` : ""}</span>
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
  const showClip = (i) => {
    TZ.t = timeline().mainStart + s.clips.slice(0, i).reduce((a, c) => a + clipDur(c), 0) + 0.1;
    stopPlay(); drawPreview();
  };
  $$("[data-cprev]", box).forEach((b) => (b.onclick = () => { showClip(Number(b.dataset.cprev)); $("#tz-canvas").scrollIntoView({ behavior: "smooth", block: "center" }); }));
  $$("[data-csz]", box).forEach((b) => (b.onclick = () => {
    const [i, d] = b.dataset.csz.split(":").map(Number);
    const c = s.clips[i];
    c.scale = +Math.min(4, Math.max(0.3, (c.scale ?? 1) + d)).toFixed(2);
    saveDraft(); drawClips(); showClip(i);
  }));
  $$("[data-creset]", box).forEach((b) => (b.onclick = () => { const i = Number(b.dataset.creset); Object.assign(s.clips[i], { scale: 1, ox: 0, oy: 0 }); saveDraft(); drawClips(); showClip(i); }));
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

// فهرست زیرنویس‌ها با زمان؛ هر کدام قابل جابه‌جایی ±۰٫۲ ثانیه و پخش از همان‌جا
function drawTimes() {
  const box = $("#tz-times");
  if (!box) return;
  const s = TZ.s;
  const caps = captionTimes();
  if (!caps.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="small muted">${s.autoTime ? "زمان‌ها خودکار بر اساس طول جمله‌اند؛ هر کدام را تغییر دهید دستی می‌شود." : "زمان هر زیرنویس (ثانیه):"}</div>`
    + caps.map((c, i) => `<div class="cap2"><button class="btn sm ghost" data-cplay="${i}" title="پخش از همین‌جا">▶</button>
      <span class="t">${esc(c.text.replace(/\*/g, ""))}</span>
      <span class="tm"><button class="btn sm ghost" data-nudge="${i}:0:-0.2">−</button><input type="number" step="0.1" value="${c.start}" data-mi="${i}" data-mj="0"><button class="btn sm ghost" data-nudge="${i}:0:0.2">+</button>
      تا <input type="number" step="0.1" value="${c.end}" data-mi="${i}" data-mj="1"></span></div>`).join("");
  const toManual = () => { if (s.autoTime || s.manual.length < caps.length) { s.manual = caps.map((c) => [c.start, c.end]); s.autoTime = false; } };
  $$("[data-mi]", box).forEach((el) => (el.onchange = () => { toManual(); s.manual[Number(el.dataset.mi)][Number(el.dataset.mj)] = Number(enDigits(el.value)) || 0; saveDraft(); drawPreview(); }));
  $$("[data-nudge]", box).forEach((b) => (b.onclick = () => {
    const [i, j, d] = b.dataset.nudge.split(":").map(Number);
    toManual();
    const m = s.manual[i];
    m[j] = +Math.max(0, m[j] + d).toFixed(2);
    if (j === 0) { m[1] = +Math.max(m[0] + 0.3, m[1]).toFixed(2); if (i > 0) s.manual[i - 1][1] = Math.min(s.manual[i - 1][1], +(m[0] - 0.02).toFixed(2)); }
    saveDraft(); drawTimes(); TZ.t = m[0] + 0.05; drawPreview();
  }));
  $$("[data-cplay]", box).forEach((b) => (b.onclick = () => { stopPlay(); TZ.t = caps[Number(b.dataset.cplay)].start; togglePlay(); }));
}

// زیرنویس خودکار: گفتار ویدیوها ← متن و زمان (یا هماهنگ کردن زمانِ متنِ نوشته‌شده با گفتار)
async function autoCaptions() {
  const s = TZ.s;
  if (!s.clips.some((c) => c.kind === "video")) return toast("اول ویدیوی دارای صدا اضافه کنید");
  const lines = captionLines();
  const btn = $("#tz-asr");
  btn.disabled = true; btn.textContent = "در حال شنیدن ویدیو… (چند ثانیه)";
  try {
    const tl = timeline();
    const r = await api("/api/teasers/autocaption", { method: "POST", body: {
      offset: tl.mainStart, lines,
      clips: s.clips.map((c) => ({ media_id: c.media_id, start: c.start || 0, duration: clipDur(c) })) } });
    if (!r.captions.length) toast("گفتاری در ویدیوها شنیده نشد", 5000);
    else {
      if (!r.aligned) s.captionsText = r.captions.map((c) => c.text).join("\n");
      s.manual = r.captions.map((c) => [c.start, c.end]);
      s.autoTime = false;
      saveDraft();
      toast(r.aligned ? "زمان زیرنویس‌ها با گفتار هماهنگ شد ✔" : "زیرنویس از روی گفتار ساخته شد ✔ متن را بخوانید و اگر لازم بود اصلاح کنید.", 5000);
      refresh();
      return;
    }
  } catch (err) { if (!(err instanceof LoginRequired)) toast(err.message, 6000); }
  btn.disabled = false; btn.textContent = "🎙 زیرنویس خودکار از صدای ویدیو";
}

// زمان‌بندی با ضربه: ویدیو پخش می‌شود و با هر ضربه زیرنویس بعدی شروع می‌شود
function startTapTiming() {
  const s = TZ.s;
  const lines = captionLines();
  if (!lines.length) return toast("اول زیرنویس‌ها را بنویسید (هر خط یکی)");
  const tl = timeline();
  const box = $("#tz-tapbox");
  const marks = [];
  let idx = 0;
  const show = () => {
    box.hidden = false;
    box.innerHTML = idx < lines.length
      ? `<div class="tapbox"><div class="small muted">وقتی گوینده شروع به گفتن این جمله کرد ضربه بزنید (${num(idx + 1)} از ${num(lines.length)}):</div>
          <b>${esc(lines[idx].replace(/\*/g, ""))}</b>
          <div class="btn-row"><button class="btn primary big" id="tap-now">👆 الان</button><button class="btn" id="tap-stop">⏹ پایان</button></div></div>`
      : `<div class="tapbox"><b>همه‌ی زیرنویس‌ها زمان گرفتند ✔</b><div class="btn-row"><button class="btn primary" id="tap-stop">ذخیره</button></div></div>`;
    if ($("#tap-now")) $("#tap-now").onclick = () => {
      const t = +TZ.t.toFixed(2);
      if (marks.length) marks[marks.length - 1][1] = +(t - 0.02).toFixed(2);
      marks.push([t, +(Math.min(tl.mainEnd - 0.05, t + 4)).toFixed(2)]);
      idx++; show();
    };
    $("#tap-stop").onclick = finish;
  };
  const finish = () => {
    stopPlay();
    if (marks.length) {
      marks[marks.length - 1][1] = +Math.min(tl.mainEnd - 0.05, Math.max(marks[marks.length - 1][0] + 0.8, TZ.t)).toFixed(2);
      s.manual = marks; s.autoTime = false; saveDraft();
      toast("زمان‌ها ذخیره شد ✔");
    }
    box.hidden = true; refresh();
  };
  stopPlay();
  TZ.t = tl.mainStart;
  show();
  togglePlay();
  box.scrollIntoView({ behavior: "smooth", block: "center" });
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
    if (s.headline.trim() || s.kicker.trim() || (s.subhead || "").trim()) {
      overlays.push({ image: png(layerCanvas(drawHeadline)), start: tl.mainStart, end: hEnd });
    }
    const caps = captionTimes();
    for (const c of caps) overlays.push({ image: png(layerCanvas((ctx, W, H) => drawCaption(ctx, W, H, c.text))), start: c.start, end: c.end });
    if (s.layers?.length) {
      await layersReady(s.layers);
      const [lw, lh] = s.layersSize || outSize();
      for (const o of layerOverlays(tl.total)) {
        overlays.push({ image: png(layerCanvas((ctx, W, H) => { ctx.scale(W / lw, H / lh); drawLayers(ctx, o.act); })), start: o.start, end: o.end });
      }
    }
    const clips = s.clips.map((c) => ({ media_id: c.media_id, duration: clipDur(c), start: c.start || 0, zoom: c.zoom !== false, gray: !!c.gray,
      scale: c.scale ?? 1, ox: c.ox ?? 0, oy: c.oy ?? 0 }));
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

try { TZ.simple = lsGet("tzSimple", "1") !== "0"; } catch { TZ.simple = true; }
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

// جابه‌جا کردن عکس/ویدیوی همین لحظه داخل قاب با انگشت؛ بزرگ‌نمایی با دو انگشت یا چرخ موس
function bindClipDrag(cv) {
  const pts = new Map();
  let st = null;
  const pos = (ev) => { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height }; };
  const cur = () => clipAt(Math.min(TZ.t, Math.max(0, timeline().total - 0.01))).clip;
  const begin = () => { const c = cur(); st = c && { c, scale: c.scale ?? 1, ox: c.ox ?? 0, oy: c.oy ?? 0, p: [...pts.values()][0], dist: pts.size > 1 ? dist() : 0 }; };
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  cv.style.touchAction = "none";
  cv.addEventListener("pointerdown", (ev) => {
    if (TZ.playing || !cur()) return;
    cv.setPointerCapture(ev.pointerId);
    pts.set(ev.pointerId, pos(ev)); begin();
  });
  cv.addEventListener("pointermove", (ev) => {
    if (!pts.has(ev.pointerId) || !st) return;
    pts.set(ev.pointerId, pos(ev));
    const c = st.c;
    if (pts.size > 1) { if (st.dist) c.scale = +Math.min(4, Math.max(0.3, st.scale * dist() / st.dist)).toFixed(3); }
    else { const p = pos(ev); c.ox = +Math.max(-1, Math.min(1, st.ox + (p.x - st.p.x))).toFixed(4); c.oy = +Math.max(-1, Math.min(1, st.oy + (p.y - st.p.y))).toFixed(4); }
    drawPreview();
  });
  const end = (ev) => { if (!pts.delete(ev.pointerId)) return; if (pts.size) begin(); else if (st) { st = null; saveDraft(); drawClips(); } };
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", end);
  cv.addEventListener("wheel", (ev) => {
    const c = cur(); if (!c) return;
    ev.preventDefault();
    c.scale = +Math.min(4, Math.max(0.3, (c.scale ?? 1) * (ev.deltaY < 0 ? 1.06 : 0.94))).toFixed(3);
    drawPreview(); clearTimeout(cv._wt); cv._wt = setTimeout(() => { saveDraft(); drawClips(); }, 400);
  }, { passive: false });
}
