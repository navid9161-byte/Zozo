"use strict";
// ═════════════════════════ پست‌ساز (پست تصویری اینستاگرام با قالب کرمان راوی) ═════════════════════════
// همه‌چیز در مرورگر ساخته می‌شود؛ خروجی PNG با اندازه‌ی ۱۰۸۰×۱۳۵۰ (پست ۴:۵ اینستاگرام).
// از توابع کمکی teaser.js استفاده می‌کند: rr، richWords، wrapRich، drawRichLine، krPattern، KR، FONT، setup

const PS = { s: null, img: null, logo: null, slide: 0, photo: null };
const POST_W = 1080;
// استوری ۹:۱۶، بقیه ۴:۵
const postH = () => (PS.s?.layout === "story" ? 1920 : 1350);
const POST_LAYOUTS = {
  news: "خبر با عکس و متن", cover: "تیتر درشت روی عکس", quote: "نقل‌قول", text: "متن / اطلاعیه (بدون عکس)", story: "استوری (۹:۱۶)",
};

function postDefaults() {
  return { layout: "news", title: "", subtitle: "", body: "", credit: "", focus: 50, zoom: 100, gray: null,
    tSize: 100, bSize: 100, bAlign: "justify", tColor: "", bColor: "", layers: [], freeTexts: false, focusX: 50, oneSlide: false };
}

function postSave() { lsSet("postDraft", JSON.stringify(PS.s)); }

function coverImage(ctx, img, x, y, w, h, focus, zoom, focusX = 50) {
  const sw = img.naturalWidth, sh = img.naturalHeight;
  const sc = Math.max(w / sw, h / sh) * (zoom / 100);
  const dw = sw * sc, dh = sh * sc;
  ctx.drawImage(img, x + (w - dw) * (focusX / 100), y + (h - dh) * (focus / 100), dw, dh);
  PS.photo = { x, y, w, h, dw, dh };  // برای جابه‌جا کردن عکس با انگشت
}

// پس‌زمینه‌ی نقطه‌ای (هافتون) کم‌رنگ، پررنگ‌تر به سمت پایین-چپ؛ مثل پست‌های صفحه
function halftone(ctx, W, H) {
  const step = 17;
  ctx.fillStyle = "rgba(25,49,83,.13)";
  for (let y = H * 0.42; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const d = Math.hypot(x / W, (H - y) / H * 1.6);
      const k = Math.max(0, 1 - d / 0.95);
      if (k < 0.05) continue;
      ctx.beginPath();
      ctx.arc(x + ((y / step) % 2 ? step / 2 : 0), y, step * 0.3 * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// سطر تراز‌شده (justify) راست‌به‌چپ: فاصله‌ی اضافه بین واژه‌ها پخش می‌شود
function drawJustified(ctx, words, right, width, y, justify, align = "right") {
  const ws = words.map((w) => ctx.measureText(w).width);
  const sp = ctx.measureText(" ").width;
  const gap = justify && words.length > 1 ? (width - ws.reduce((a, b) => a + b, 0)) / (words.length - 1) : sp;
  const lw = ws.reduce((a, b) => a + b, 0) + sp * (words.length - 1);
  let x = justify || align === "right" ? right : align === "center" ? right - (width - lw) / 2 : right - width + lw;
  ctx.textAlign = "right";
  words.forEach((w, i) => { ctx.fillText(w, x, y); x -= ws[i] + gap; });
}

function wrapWords(ctx, text, maxW) {
  const lines = [];
  for (const para of text.split("\n")) {
    let line = [];
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const test = [...line, w].join(" ");
      if (line.length && ctx.measureText(test).width > maxW) { lines.push({ words: line, last: false }); line = [w]; } else line.push(w);
    }
    if (line.length) lines.push({ words: line, last: true });
  }
  return lines;
}

// قاب «خبر»: پس‌زمینه‌ی نقطه‌ای، نوار سرمه‌ای، خط قرمز، لوگو؛ مشترک بین خبر، متن، استوری و اسلایدهای ادامه
function newsFrame(ctx) {
  const W = POST_W, H = postH();
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  halftone(ctx, W, H);
  const lh = 124, lr = PS.logo && PS.logo.naturalWidth ? PS.logo.naturalWidth / PS.logo.naturalHeight : 2.06;
  const lineY = H - 85, lineH = 17;
  const lw = lh * lr, lx = 1019 - lw, ly = lineY - lh * 0.80;
  ctx.fillStyle = KR.navy;
  ctx.fillRect(996, 0, 14, ly + 40);
  ctx.fillStyle = KR.red;
  ctx.fillRect(0, lineY, lx + lw * 0.25, lineH);
  if (PS.logo && PS.logo.naturalWidth) ctx.drawImage(PS.logo, lx, ly, lw, lh);
  return { bottom: ly - 14 };
}

function photoBox(ctx, px, py, pw, ph, radius = 26) {
  const s = PS.s;
  ctx.save();
  rr(ctx, px, py, pw, ph, radius);
  ctx.clip();
  if (PS.img) {
    if (s.gray) ctx.filter = "grayscale(1)";
    coverImage(ctx, PS.img, px, py, pw, ph, s.focus, s.zoom, s.focusX ?? 50);
    ctx.filter = "none";
  } else {
    PS.photo = { x: px, y: py, w: pw, h: ph, dw: pw, dh: ph };
    ctx.fillStyle = "#e3e8ef"; ctx.fillRect(px, py, pw, ph);
    setup(ctx); ctx.fillStyle = "#8a96a8"; ctx.textAlign = "center"; ctx.font = `700 40px ${FONT}`;
    ctx.fillText("عکس را انتخاب کنید", px + pw / 2, py + ph / 2);
  }
  ctx.restore();
}

// چیدمان نوشته‌های خبر؛ متن بلند به اسلایدهای بعدی می‌رود (یا در حالت «یک اسلاید» کوچک و کوتاه می‌شود)
const TEXT_W = 848, TEXT_R = 930;
function newsPlan(ctx, top, bottom) {
  const s = PS.s;
  const tS = (s.tSize || 100) / 100, bS = (s.bSize || 100) / 100, tC = s.tColor || KR.red;
  const big = s.layout === "text" ? 1.18 : s.layout === "story" ? 1.12 : 1;
  const layout = (k) => {
    const out = { k, title: [], sub: [], body: [] };
    const tf = 76 * k * tS * big, sf = 64 * k * tS * (big > 1 ? 0.9 : 1), bf = Math.max(18, 30.5 * k * bS * big);
    ctx.font = `900 ${tf}px ${FONT}`;
    out.title = s.title.trim() ? wrapRich(ctx, richWords(s.title.trim(), tC, KR.navy), TEXT_W).slice(0, 3) : [];
    ctx.font = `900 ${sf}px ${FONT}`;
    out.sub = s.subtitle.trim() ? wrapText(ctx, s.subtitle.trim(), TEXT_W).slice(0, 2) : [];
    ctx.font = `700 ${bf}px ${FONT}`;
    out.body = s.body.trim() ? wrapWords(ctx, s.body.trim(), TEXT_W) : [];
    Object.assign(out, { tf, sf, bf, tl: tf * 1.24, sl: sf * 1.32, bl: bf * 1.36 });
    out.head = out.title.length * out.tl + out.sub.length * out.sl + (out.body.length ? 14 : 0);
    out.fit = Math.max(0, Math.floor((bottom - top - out.head) / out.bl));
    return out;
  };
  let L = layout(1);
  const steps = s.oneSlide ? [0.94, 0.88, 0.82, 0.76, 0.7, 0.64] : [0.94, 0.88, 0.84];
  for (const k of steps) { if (L.fit >= L.body.length) break; L = layout(k); }
  L.first = L.body.slice(0, L.fit);
  L.rest = s.oneSlide ? [] : L.body.slice(L.fit);
  L.cut = s.oneSlide && L.body.length > L.fit;
  // اسلایدهای ادامه
  L.pages = [];
  if (L.rest.length) {
    const per = Math.max(4, Math.floor((bottom - 250) / L.bl));
    for (let i = 0; i < L.rest.length; i += per) L.pages.push(L.rest.slice(i, i + per));
    if (L.first.length) L.first[L.first.length - 1] = { ...L.first[L.first.length - 1], last: true };
  }
  return L;
}

function drawBodyLines(ctx, lines, y, L, cut) {
  const s = PS.s, al = s.bAlign || "justify";
  ctx.font = `700 ${L.bf}px ${FONT}`;
  ctx.fillStyle = s.bColor || KR.navy;
  lines.forEach((l, i) => {
    y += L.bl;
    const isCut = cut && i === lines.length - 1;
    drawJustified(ctx, isCut ? [...l.words, "…"] : l.words, TEXT_R, TEXT_W, y - L.bl / 2, al === "justify" && !l.last && !isCut, al);
  });
  return y;
}

function drawPostNews(ctx) {
  const s = PS.s;
  const { bottom } = newsFrame(ctx);
  const story = s.layout === "story", textOnly = s.layout === "text";
  const px = 92, py = story ? 150 : 106, pw = 852, ph = textOnly ? 0 : story ? 820 : 530;
  if (!textOnly) photoBox(ctx, px, py, pw, ph);
  setup(ctx);
  if (s.freeTexts) { drawPostCredit(ctx, "news"); return; }
  const top = textOnly ? 120 : py + ph + 22;
  const L = newsPlan(ctx, top, bottom);
  PS.slides = 1 + L.pages.length;
  const cx = px + pw / 2;
  let y = top;
  ctx.font = `900 ${L.tf}px ${FONT}`;
  L.title.forEach((l) => { y += L.tl; drawRichLine(ctx, l, cx + l.w / 2, y - L.tl / 2); });
  ctx.font = `900 ${L.sf}px ${FONT}`;
  ctx.fillStyle = KR.navy;
  ctx.textAlign = "center";
  L.sub.forEach((l) => { y += L.sl; ctx.fillText(l, cx, y - L.sl / 2); });
  if (L.first.length) y = drawBodyLines(ctx, L.first, y + 14, L, L.cut);
  if (L.pages.length) slideMark(ctx, 0, PS.slides, "ادامه در اسلاید بعد ←");
  drawPostCredit(ctx, "news");
}

// اسلاید ادامه‌ی متن (کاروسل)
function drawPostContinue(ctx, idx) {
  const s = PS.s;
  const { bottom } = newsFrame(ctx);
  setup(ctx);
  const L = newsPlan(ctx, s.layout === "text" ? 120 : (s.layout === "story" ? 992 : 658), bottom);
  PS.slides = 1 + L.pages.length;
  const lines = L.pages[idx - 1] || [];
  // تیتر کوچک بالای اسلاید
  ctx.font = `900 ${Math.round(L.tf * 0.62)}px ${FONT}`;
  const t = wrapRich(ctx, richWords(s.title.trim().replace(/\n/g, " "), s.tColor || KR.red, KR.navy), TEXT_W)[0];
  let y = 110;
  if (t) { drawRichLine(ctx, t, 511 + t.w / 2, y); }
  ctx.fillStyle = KR.red; ctx.fillRect(511 - 60, y + 42, 120, 6);
  y = drawBodyLines(ctx, lines, y + 70, L, false);
  slideMark(ctx, idx, PS.slides, idx < PS.slides - 1 ? "ادامه در اسلاید بعد ←" : "");
  drawPostCredit(ctx, "news");
}

function slideMark(ctx, idx, total, note) {
  setup(ctx);
  ctx.font = `700 26px ${FONT}`; ctx.fillStyle = KR.navy; ctx.textAlign = "left";
  ctx.fillText(`${num(idx + 1)} / ${num(total)}`, 40, 60);
  if (note) { ctx.textAlign = "left"; ctx.fillStyle = KR.red; ctx.fillText(note, 40, postH() - 120); }
}

// نقل‌قول: عکس گوینده تمام‌قاب، متن نقل‌قول درشت سفید، نام و سمت
function drawPostQuote(ctx) {
  const s = PS.s, W = POST_W, H = postH();
  const bandH = 150;
  ctx.fillStyle = "#1b2433"; ctx.fillRect(0, 0, W, H);
  if (PS.img) {
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H - bandH); ctx.clip();
    ctx.filter = s.gray === false ? "none" : "grayscale(1) contrast(1.05)";
    coverImage(ctx, PS.img, 0, 0, W, H - bandH, s.focus, s.zoom, s.focusX ?? 50);
    ctx.filter = "none"; ctx.restore();
  } else PS.photo = { x: 0, y: 0, w: W, h: H - bandH, dw: W, dh: H - bandH };
  const g = ctx.createLinearGradient(0, H * 0.25, 0, H - bandH);
  g.addColorStop(0, "rgba(10,16,28,0)"); g.addColorStop(0.55, "rgba(10,16,28,.72)"); g.addColorStop(1, "rgba(10,16,28,.94)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H - bandH);
  setup(ctx);
  if (!s.freeTexts) {
    const tS = (s.tSize || 100) / 100, bS = (s.bSize || 100) / 100;
    let fs = 60 * bS, lines;
    for (;;) {
      ctx.font = `900 ${fs}px ${FONT}`;
      lines = wrapRich(ctx, richWords(s.body.trim() || "متن نقل‌قول را بنویسید", "#ffffff", "#ff6b6b"), W - 200);
      if (lines.length <= 5 || fs < 34) break;
      fs -= 3;
    }
    lines = lines.slice(0, 6);
    const lh = fs * 1.4;
    const nameH = (s.title.trim() ? 90 : 0) + (s.subtitle.trim() ? 50 : 0);
    let y = H - bandH - 60 - nameH - lines.length * lh;
    // علامت نقل‌قول
    ctx.font = `900 ${Math.round(190 * bS)}px Georgia, serif`; ctx.fillStyle = KR.red; ctx.textAlign = "right";
    ctx.fillText("”", W - 90, y - 30);
    ctx.font = `900 ${fs}px ${FONT}`;
    lines.forEach((l) => { y += lh; drawRichLine(ctx, l, W - 100, y - lh / 2); });
    y += 30;
    if (s.title.trim()) {
      ctx.font = `900 ${Math.round(46 * tS)}px ${FONT}`;
      const tw = ctx.measureText(s.title.trim()).width + 50;
      ctx.fillStyle = s.tColor || KR.red; rr(ctx, W - 100 - tw, y, tw, 70, 14); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.textAlign = "right"; ctx.fillText(s.title.trim(), W - 125, y + 36);
      y += 90;
    }
    if (s.subtitle.trim()) { ctx.font = `700 ${Math.round(32 * tS)}px ${FONT}`; ctx.fillStyle = "#dfe6f0"; ctx.textAlign = "right"; ctx.fillText(s.subtitle.trim(), W - 100, y + 20); }
  }
  drawPostFooter(ctx, true);
}

function drawPostCredit(ctx, layout) {
  const s = PS.s;
  if (layout !== "news" || !s.credit.trim()) return;
  setup(ctx);
  ctx.font = `700 24px ${FONT}`; ctx.fillStyle = KR.navy; ctx.textAlign = "left";
  ctx.fillText(`تهیه و تدوین: ${s.credit.trim()}`, 40, postH() - 26);
}

function drawPostCover(ctx) {
  const s = PS.s, W = POST_W, H = postH();
  ctx.fillStyle = "#222";
  ctx.fillRect(0, 0, W, H);
  const bandH = 150;
  if (PS.img) {
    ctx.filter = s.gray === false ? "none" : "grayscale(1) contrast(1.05)";
    coverImage(ctx, PS.img, 0, 0, W, H - bandH, s.focus, s.zoom, s.focusX ?? 50);
    ctx.filter = "none";
  } else {
    PS.photo = { x: 0, y: 0, w: W, h: H - bandH, dw: W, dh: H - bandH };
    setup(ctx); ctx.fillStyle = "#888"; ctx.textAlign = "center"; ctx.font = `700 42px ${FONT}`;
    ctx.fillText("عکس را انتخاب کنید", W / 2, H / 2);
  }
  // قاب قرمز
  ctx.strokeStyle = "rgba(157,24,25,.92)";
  ctx.lineWidth = 7;
  rr(ctx, 60, 40, W - 120, H - bandH - 70, 44);
  ctx.stroke();
  // جعبه‌ی سفید تیتر (بالا راست)
  setup(ctx);
  if (s.freeTexts) { drawPostFooter(ctx, true); return; }
  const tS = (s.tSize || 100) / 100, bS = (s.bSize || 100) / 100, tC = s.tColor || KR.red, bC = s.bColor || KR.navy;
  const sF = Math.round(58 * tS), tF = Math.round(104 * tS), bF = Math.round(40 * bS);
  const right = W - 110;
  const rows = [];
  if (s.subtitle.trim()) { ctx.font = `900 ${sF}px ${FONT}`; rows.push(...wrapRich(ctx, richWords(s.subtitle.trim(), KR.navy, KR.red), 700).slice(0, 1).map((l) => ({ l, fs: sF }))); }
  if (s.title.trim()) { ctx.font = `900 ${tF}px ${FONT}`; rows.push(...wrapRich(ctx, richWords(s.title.trim(), tC, KR.navy), 760).slice(0, 3).map((l) => ({ l, fs: tF }))); }
  if (rows.length) {
    const pad = 34;
    const bw = Math.max(...rows.map((r) => { ctx.font = `900 ${r.fs}px ${FONT}`; return r.l.w; })) + pad * 2;
    const bh = rows.reduce((a, r) => a + r.fs * 1.3, 0) + pad * 1.4;
    const top = 120;
    ctx.fillStyle = "rgba(255,255,255,.9)";
    rr(ctx, right - bw, top, bw, bh, 36);
    ctx.fill();
    let y = top + pad * 0.7;
    rows.forEach((r) => { ctx.font = `900 ${r.fs}px ${FONT}`; drawRichLine(ctx, r.l, right - pad, y + (r.fs * 1.3) / 2); y += r.fs * 1.3; });
  }
  if (s.body.trim()) {
    ctx.font = `700 ${bF}px ${FONT}`;
    const lines = wrapText(ctx, s.body.trim(), 760).slice(0, 3);
    const lh = bF * 1.5, bh = lines.length * lh + 36, top = H - bandH - 110 - bh;
    const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 60;
    ctx.fillStyle = "rgba(255,255,255,.88)";
    rr(ctx, W / 2 - bw / 2, top, bw, bh, 26);
    ctx.fill();
    ctx.fillStyle = bC; ctx.textAlign = "center";
    lines.forEach((l, i) => ctx.fillText(l, W / 2, top + 18 + lh * (i + 0.5)));
  }
  drawPostFooter(ctx, true);
}

function drawPostFooter(ctx, band) {
  const s = PS.s, W = POST_W, H = postH();
  setup(ctx);
  if (band) {
    const bh = 150, by = H - bh;
    const g = ctx.createLinearGradient(0, by, 0, H);
    g.addColorStop(0, "#eef1f5"); g.addColorStop(1, "#d9dfe7");
    ctx.fillStyle = g; ctx.fillRect(0, by, W, bh);
    krPattern(ctx, 0, by, W, bh);
    if (PS.logo) { const r = PS.logo.naturalWidth / PS.logo.naturalHeight, lh = 92; ctx.drawImage(PS.logo, 50, by + (bh - lh) / 2, lh * r, lh); }
    if (s.credit.trim()) {
      ctx.textAlign = "right";
      ctx.font = `900 38px ${FONT}`; ctx.fillStyle = KR.red; ctx.fillText("تهیه و تدوین:", W - 60, by + 52);
      ctx.font = `900 38px ${FONT}`; ctx.fillStyle = KR.navy; ctx.fillText(s.credit.trim(), W - 60, by + 104);
    }
    return;
  }
  // نوار قرمز پایین + لوگو
  ctx.fillStyle = KR.red;
  ctx.fillRect(0, H - 58, W - 16, 9);
  if (PS.logo) {
    const r = PS.logo.naturalWidth / PS.logo.naturalHeight, lh = 78, lw = lh * r, lx = 40, ly = H - 58 - lh / 2 - 4;
    ctx.fillStyle = "#fff"; rr(ctx, lx - 10, ly - 6, lw + 20, lh + 12, 12); ctx.fill();
    ctx.drawImage(PS.logo, lx, ly, lw, lh);
  }
  if (s.credit.trim()) {
    ctx.textAlign = "right"; ctx.font = `700 26px ${FONT}`; ctx.fillStyle = KR.navy;
    ctx.fillText(`تهیه و تدوین: ${s.credit.trim()}`, W - 50, H - 22);
  }
}

function drawPost(cv = $("#ps-canvas"), withLayers = true, slide = null) {
  if (!cv) return;
  const idx = slide ?? (cv.id === "ps-canvas" ? PS.slide : 0);
  cv.width = POST_W; cv.height = postH();
  const ctx = cv.getContext("2d");
  PS.slides = 1;
  if (idx > 0 && ["news", "text", "story"].includes(PS.s.layout)) { drawPostContinue(ctx, idx); return; }
  drawPostBase(ctx);
  if (withLayers && PS.s.layers?.length && typeof drawLayers === "function") drawLayers(ctx, PS.s.layers);
  if (cv.id === "ps-canvas") postSlideTabs();
}
function drawPostBase(ctx) {
  const l = PS.s.layout;
  (l === "cover" ? drawPostCover : l === "quote" ? drawPostQuote : drawPostNews)(ctx);
}

// زبانه‌های اسلاید زیر پیش‌نمایش
function postSlideTabs() {
  const box = $("#ps-slides");
  if (!box) return;
  const n = PS.slides || 1;
  if (PS.slide >= n) PS.slide = 0;
  box.hidden = n < 2;
  box.innerHTML = n < 2 ? "" : `<span class="small muted">متن بلند است؛ ${num(n)} اسلاید (کاروسل):</span>
    <div class="seg">${Array.from({ length: n }, (_, i) => `<button data-slide="${i}" class="${i === PS.slide ? "active" : ""}">${num(i + 1)}</button>`).join("")}</div>`;
  $$("[data-slide]", box).forEach((b) => (b.onclick = () => { PS.slide = Number(b.dataset.slide); drawPost(); }));
}

// نوشته‌های قالب ← لایه‌های آزاد (برای جابه‌جا کردن و تغییر دلخواه در ویرایشگر لایه‌ای)
function postTextLayers() {
  const s = PS.s, out = [], id = () => "t" + Math.random().toString(36).slice(2, 8);
  const tS = (s.tSize || 100) / 100, bS = (s.bSize || 100) / 100;
  if (s.layout === "cover") {
    if (s.subtitle.trim()) out.push({ id: id(), type: "text", tpl: 1, ...LAYER_DEFAULTS.text, text: s.subtitle.trim(), x: 330, y: 120, w: 640, h: 110, size: Math.round(58 * tS), color: KR.navy, hi: KR.red, align: "right", bg: "#ffffff", pad: 24, radius: 30 });
    if (s.title.trim()) out.push({ id: id(), type: "text", tpl: 1, ...LAYER_DEFAULTS.text, text: s.title.trim(), x: 170, y: 240, w: 800, h: 300, size: Math.round(104 * tS), color: s.tColor || KR.red, hi: KR.navy, align: "right", lh: 1.25, bg: "#ffffff", pad: 30, radius: 36 });
    if (s.body.trim()) out.push({ id: id(), type: "text", tpl: 1, ...LAYER_DEFAULTS.text, text: s.body.trim(), weight: 700, x: 140, y: 920, w: 800, h: 150, size: Math.round(40 * bS), color: s.bColor || KR.navy, hi: KR.red, align: "center", bg: "#ffffff", pad: 22, radius: 26 });
  } else {
    let y = 655;
    if (s.title.trim()) { out.push({ id: id(), type: "text", tpl: 1, ...LAYER_DEFAULTS.text, text: s.title.trim(), x: 92, y, w: 852, h: 190, size: Math.round(72 * tS), color: s.tColor || KR.red, hi: KR.navy, align: "center", lh: 1.22, pad: 0 }); y += 200; }
    if (s.subtitle.trim()) { out.push({ id: id(), type: "text", tpl: 1, ...LAYER_DEFAULTS.text, text: s.subtitle.trim(), x: 92, y, w: 852, h: 90, size: Math.round(56 * tS), color: KR.navy, hi: KR.red, align: "center", pad: 0 }); y += 100; }
    if (s.body.trim()) out.push({ id: id(), type: "text", tpl: 1, ...LAYER_DEFAULTS.text, text: s.body.trim(), weight: 700, x: 92, y, w: 852, h: Math.max(120, 1150 - y), size: Math.round(29 * bS), color: s.bColor || KR.navy, hi: KR.red, align: s.bAlign || "justify", lh: 1.4, pad: 0 });
  }
  return out;
}

function openPostDesigner() {
  const s = PS.s;
  let layers = s.layers || [], convert = false;
  if (!s.freeTexts && (s.title.trim() || s.subtitle.trim() || s.body.trim()) && confirm("نوشته‌های قالب هم به لایه‌های آزاد تبدیل شوند تا بتوانید جابه‌جا و هر طور خواستید ویرایششان کنید؟\n(«انصراف» = نوشته‌ها همان‌طور خودکار بمانند و فقط لایه‌ی تازه اضافه کنید)")) {
    layers = [...postTextLayers(), ...layers];
    convert = true;
  }
  openDesigner({
    w: POST_W, h: postH(), layers, title: "🎨 ویرایش آزاد پست",
    background: (ctx) => { const f = s.freeTexts; s.freeTexts = f || convert; drawPostBase(ctx); s.freeTexts = f; },
    onSave: (ls) => { s.layers = ls; if (convert) s.freeTexts = true; postSave(); refresh(); },
  });
}

VIEWS.post = async (view) => {
  if (!PS.s) { try { PS.s = { ...postDefaults(), ...JSON.parse(lsGet("postDraft", "null") || "{}") }; } catch { PS.s = postDefaults(); } }
  if (!PS.logo) { PS.logo = new Image(); PS.logo.onload = () => drawPost(); PS.logo.src = "/static/brand/logo.png"; }
  const s = PS.s;
  const q = s.layout === "quote";
  if (!POST_LAYOUTS[s.layout]) s.layout = "news";
  view.innerHTML = `
    <div class="page-title"><h2>🖼️ پست‌ساز</h2><div class="btn-row"><button class="btn" id="ps-new">🆕 پست تازه</button></div></div>
    <div class="teaser-layout">
      <div>
        <div class="card"><h3>قالب</h3>
          <div class="chips">${Object.entries(POST_LAYOUTS).map(([k, l]) => `<button class="chip ${s.layout === k ? "active" : ""}" data-layout="${k}">${l}</button>`).join("")}</div>
        </div>
        <div class="card" ${s.layout === "text" ? "hidden" : ""}><h3>عکس</h3>
          <div class="btn-row"><label class="btn primary">📷 انتخاب عکس<input type="file" id="ps-file" accept="image/*" hidden></label>
            <label><input type="checkbox" data-p="gray" ${(s.gray ?? s.layout === "cover") ? "checked" : ""}> سیاه‌وسفید</label></div>
          <div class="form-grid" style="margin-top:8px">
            <label>بالا ↕ پایین<input type="range" min="0" max="100" data-p="focus" value="${s.focus}"></label>
            <label>چپ ↔ راست<input type="range" min="0" max="100" data-p="focusX" value="${s.focusX ?? 50}"></label>
            <label>بزرگ‌نمایی<input type="range" min="100" max="300" data-p="zoom" value="${s.zoom}"></label>
            <label><span>&nbsp;</span><button type="button" class="btn sm" id="ps-recenter">↺ وسط و اندازه‌ی اول</button></label>
          </div>
          <p class="small muted">👆 عکس را روی پیش‌نمایش با انگشت بکشید تا جابه‌جا شود؛ با دو انگشت (یا چرخ موس) بزرگ و کوچک کنید.</p>
        </div>
        <div class="card"><h3>نوشته‌ها</h3>
          <div class="form-grid">
            <label class="wide">${q ? "نام گوینده" : "تیتر اصلی"}<textarea data-p="title" rows="${q ? 1 : 2}" placeholder="${q ? "مثلاً: حمید علیزاده" : "مثلاً: ظرفیت خورشیدی کرمان تا یک ماه آینده از ۵۰۰ مگاوات عبور می‌کند"}">${esc(s.title)}</textarea>
              ${q ? "" : `<small>تیتر قرمز است؛ بخشی را که بین دو ستاره بنویسید سرمه‌ای می‌شود: *ظرفیت خورشیدی کرمان* تا یک ماه آینده…</small>`}</label>
            <label class="wide">${q ? "سمت گوینده" : s.layout === "cover" ? "سطر بالای تیتر (کوچک)" : "زیرتیتر (سرمه‌ای)"}<input data-p="subtitle" value="${esc(s.subtitle)}" placeholder="${q ? "مثلاً: مدیرعامل سازمان آتش‌نشانی کرمان" : s.layout === "cover" ? "مثلاً: وقتی" : "مثلاً: برای پروانه‌های ساختمانی در استان کرمان"}"></label>
            <label class="wide">${q ? "متن نقل‌قول" : s.layout === "cover" ? "جمله‌ی پایین عکس (اختیاری)" : "متن خبر"}<textarea data-p="body" rows="${s.layout === "cover" ? 2 : 6}" placeholder="${q ? "جمله‌ای که گفته؛ واژه‌های مهم را بین دو ستاره بنویسید" : s.layout === "cover" ? "مثلاً: شهردار پاسخ می‌دهد…" : "متن خبر؛ اگر بلند باشد خودکار به اسلاید بعدی می‌رود"}">${esc(s.body)}</textarea>
              ${["news", "text", "story"].includes(s.layout) ? `<label class="small" style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" data-p="oneSlide" ${s.oneSlide ? "checked" : ""}> همه‌ی متن در یک اسلاید (با کوچک کردن نوشته)</label>` : ""}</label>
            <label class="wide">تهیه و تدوین<input data-p="credit" value="${esc(s.credit)}" placeholder="نام خبرنگار (اختیاری)"></label>
          </div>
          ${s.freeTexts ? `<p class="small" style="color:var(--primary)">✏️ نوشته‌ها الان «لایه‌ی آزاد» هستند و از «ویرایش آزاد» پایین‌تر ویرایش می‌شوند؛ تغییر این کادرها روی پست اثر ندارد.</p>` : ""}
        </div>
        <div class="card ${s.freeTexts ? "muted-card" : ""}"><h3>✍️ قالب‌بندی نوشته (مثل ورد)</h3>
          <div class="form-grid">
            <label>اندازه‌ی تیتر <small id="ps-tS">${num(s.tSize || 100)}٪</small><input type="range" min="60" max="150" step="5" data-p="tSize" value="${s.tSize || 100}"></label>
            <label>اندازه‌ی متن <small id="ps-bS">${num(s.bSize || 100)}٪</small><input type="range" min="60" max="160" step="5" data-p="bSize" value="${s.bSize || 100}"></label>
            <label>رنگ تیتر<span class="btn-row"><input type="color" data-p="tColor" value="${s.tColor || KR.red}"><button class="btn sm ghost" data-reset="tColor" type="button">پیش‌فرض</button></span></label>
            <label>رنگ متن<span class="btn-row"><input type="color" data-p="bColor" value="${s.bColor || KR.navy}"><button class="btn sm ghost" data-reset="bColor" type="button">پیش‌فرض</button></span></label>
            <div class="wide"><span class="small">چینش متن</span><br><div class="seg">${[["justify", "⇔ تراز دوطرفه"], ["right", "⇥ راست‌چین"], ["center", "≡ وسط‌چین"], ["left", "⇤ چپ‌چین"]].map(([v, l]) => `<button type="button" data-balign="${v}" class="${(s.bAlign || "justify") === v ? "active" : ""}">${l}</button>`).join("")}</div></div>
          </div>
          <p class="small muted">برای رنگ دوم در تیتر، واژه‌ها را بین دو ستاره بنویسید: *این بخش* رنگ دیگری می‌گیرد.</p>
        </div>
        <div class="card"><h3>🎨 ویرایش آزاد (مثل کنوا)</h3>
          <p class="small muted">متن، شکل، خط، عکس و لوگوی دلخواه اضافه کنید؛ هر چیزی را با انگشت جابه‌جا و بزرگ‌وکوچک کنید، رنگ، سایه، کادر و شفافیت بدهید.</p>
          <div class="btn-row">
            <button class="btn primary" id="ps-design">🎨 باز کردن ویرایشگر لایه‌ای</button>
            ${s.layers?.length ? `<span class="small muted">${num(s.layers.length)} لایه</span><button class="btn sm danger" id="ps-clear-layers">🗑 پاک کردن لایه‌ها</button>` : ""}
            ${s.freeTexts ? `<button class="btn sm" id="ps-auto">↩️ بازگشت به چیدمان خودکار نوشته‌ها</button>` : ""}
          </div>
        </div>
      </div>
      <div class="teaser-preview">
        <div class="card"><h3>پیش‌نمایش</h3>
          <canvas id="ps-canvas" style="width:100%;height:auto;border-radius:10px;border:1px solid var(--line);touch-action:none"></canvas>
          <div class="ps-slides" id="ps-slides" hidden></div>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn primary" id="ps-dl">⬇️ دانلود عکس</button>
            ${navigator.canShare ? `<button class="btn" id="ps-share">📤 اشتراک‌گذاری</button>` : ""}
            <button class="btn" id="ps-archive">🗄️ ذخیره در بایگانی</button>
          </div>
        </div>
      </div>
    </div>`;
  $$("[data-layout]", view).forEach((b) => (b.onclick = () => { s.layout = b.dataset.layout; s.gray = null; PS.slide = 0; postSave(); refresh(); }));
  $$("[data-p]", view).forEach((el) => el.addEventListener(el.type === "checkbox" ? "change" : "input", () => {
    const k = el.dataset.p;
    s[k] = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value;
    if (k === "tSize" || k === "bSize") $(k === "tSize" ? "#ps-tS" : "#ps-bS").textContent = `${num(el.value)}٪`;
    postSave();
    drawPost();
    if (k === "body" || k === "oneSlide") postDlLabel();
  }));
  $$("[data-reset]", view).forEach((b) => (b.onclick = () => { s[b.dataset.reset] = ""; postSave(); refresh(); }));
  $$("[data-balign]", view).forEach((b) => (b.onclick = () => { s.bAlign = b.dataset.balign; postSave(); refresh(); }));
  $("#ps-design").onclick = openPostDesigner;
  if ($("#ps-clear-layers")) $("#ps-clear-layers").onclick = () => {
    if (!confirm("همه‌ی لایه‌های آزاد پاک شود؟")) return;
    s.layers = []; s.freeTexts = false; postSave(); refresh();
  };
  if ($("#ps-auto")) $("#ps-auto").onclick = () => {
    if (!confirm("نوشته‌ها دوباره خودکار چیده شوند؟ (لایه‌های متنیِ ساخته‌شده از نوشته‌ها حذف می‌شوند؛ شکل‌ها و عکس‌ها می‌مانند)")) return;
    s.layers = (s.layers || []).filter((l) => !l.tpl);
    s.freeTexts = false; postSave(); refresh();
  };
  $("#ps-file").onchange = (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => { PS.img = img; s.focus = 50; s.focusX = 50; s.zoom = 100; postSave(); refresh(); };
    img.src = URL.createObjectURL(f);
  };
  $("#ps-new").onclick = () => { if (!confirm("نوشته‌های این پست پاک شود؟")) return; PS.s = { ...postDefaults(), credit: s.credit, layout: s.layout, tSize: s.tSize, bSize: s.bSize, bAlign: s.bAlign }; PS.img = null; postSave(); refresh(); };
  const base = () => `kermanravi-${(s.title || "post").replace(/\*/g, "").slice(0, 30).trim().replace(/\s+/g, "-")}`;
  // همه‌ی اسلایدها (اگر متن بلند باشد چند تصویر)
  const files = async () => {
    await document.fonts?.ready;
    drawPost();
    const n = PS.slides || 1, out = [];
    for (let i = 0; i < n; i++) {
      const cv = document.createElement("canvas");
      drawPost(cv, true, i);
      const b = await new Promise((r) => cv.toBlob(r, "image/png"));
      out.push(new File([b], `${base()}${n > 1 ? `-${i + 1}` : ""}.png`, { type: "image/png" }));
    }
    return out;
  };
  $("#ps-dl").onclick = async () => {
    for (const f of await files()) {
      const url = URL.createObjectURL(f);
      const a = document.createElement("a");
      a.href = url; a.download = f.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      await new Promise((r) => setTimeout(r, 350));
    }
  };
  if ($("#ps-share")) $("#ps-share").onclick = async () => {
    const fs = await files();
    if (navigator.canShare({ files: fs })) navigator.share({ files: fs }).catch(() => {});
    else toast("اشتراک‌گذاری فایل در این مرورگر پشتیبانی نمی‌شود؛ دانلود کنید.");
  };
  $("#ps-archive").onclick = async () => {
    let ok = 0;
    for (const f of await files()) {
      const r = await uploadOne("/api/documents", f, { category: "photo", tags: "پست اینستاگرام", notes: `${s.title.replace(/\*/g, "")}\n${s.body}` }, () => {});
      if (r.ok) ok++; else toast(r.error);
    }
    if (ok) toast("در بایگانی ذخیره شد ✔");
  };
  $("#ps-recenter").onclick = () => { s.focus = 50; s.focusX = 50; s.zoom = 100; postSave(); refresh(); };
  bindPhotoDrag($("#ps-canvas"));
  const postDlLabel = () => { const n = PS.slides || 1; $("#ps-dl").textContent = n > 1 ? `⬇️ دانلود ${num(n)} اسلاید` : "⬇️ دانلود عکس"; };
  setTimeout(postDlLabel, 50);
  if (document.fonts) document.fonts.load(`900 60px Vazirmatn`).then(() => drawPost()).catch(() => drawPost());
  drawPost();
};

// جابه‌جا کردن عکس داخل قابش با انگشت/موس؛ بزرگ‌نمایی با دو انگشت یا چرخ موس
function bindPhotoDrag(cv) {
  const s = PS.s, pts = new Map();
  let start = null;
  const pos = (ev) => { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left) * cv.width / r.width, y: (ev.clientY - r.top) * cv.height / r.height }; };
  const inPhoto = (p) => PS.photo && PS.img && PS.slide === 0 && p.x >= PS.photo.x && p.x <= PS.photo.x + PS.photo.w && p.y >= PS.photo.y && p.y <= PS.photo.y + PS.photo.h;
  const sync = () => { $$("[data-p=focus]").forEach((e) => (e.value = s.focus)); $$("[data-p=focusX]").forEach((e) => (e.value = s.focusX)); $$("[data-p=zoom]").forEach((e) => (e.value = s.zoom)); };
  cv.addEventListener("pointerdown", (ev) => {
    const p = pos(ev);
    if (!inPhoto(p) && !pts.size) return;
    cv.setPointerCapture(ev.pointerId);
    pts.set(ev.pointerId, p);
    start = { focus: s.focus, focusX: s.focusX ?? 50, zoom: s.zoom, p, dist: pts.size === 2 ? [...pts.values()].reduce((a, b) => Math.hypot(a.x - b.x, a.y - b.y)) : 0 };
    ev.preventDefault();
  });
  cv.addEventListener("pointermove", (ev) => {
    if (!pts.has(ev.pointerId) || !start) return;
    const p = pos(ev);
    pts.set(ev.pointerId, p);
    const ph = PS.photo;
    if (pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (start.dist) s.zoom = Math.round(Math.min(300, Math.max(100, start.zoom * d / start.dist)));
      else start.dist = d;
    } else {
      const ox = ph.dw - ph.w, oy = ph.dh - ph.h;
      if (ox > 1) s.focusX = Math.min(100, Math.max(0, start.focusX - ((p.x - start.p.x) / ox) * 100));
      if (oy > 1) s.focus = Math.min(100, Math.max(0, start.focus - ((p.y - start.p.y) / oy) * 100));
    }
    drawPost(); sync();
  });
  const end = (ev) => { pts.delete(ev.pointerId); if (!pts.size && start) { start = null; postSave(); } else if (start) start = { focus: s.focus, focusX: s.focusX ?? 50, zoom: s.zoom, p: [...pts.values()][0], dist: 0 }; };
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", end);
  cv.addEventListener("wheel", (ev) => {
    if (!inPhoto(pos(ev))) return;
    ev.preventDefault();
    s.zoom = Math.round(Math.min(300, Math.max(100, s.zoom * (ev.deltaY < 0 ? 1.06 : 0.94))));
    drawPost(); sync(); postSave();
  }, { passive: false });
}
