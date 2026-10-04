"use strict";
// ═════════════════════════ پست‌ساز (پست تصویری اینستاگرام با قالب کرمان راوی) ═════════════════════════
// همه‌چیز در مرورگر ساخته می‌شود؛ خروجی PNG با اندازه‌ی ۱۰۸۰×۱۳۵۰ (پست ۴:۵ اینستاگرام).
// از توابع کمکی teaser.js استفاده می‌کند: rr، richWords، wrapRich، drawRichLine، krPattern، KR، FONT، setup

const PS = { s: null, img: null, logo: null };
const POST_W = 1080, POST_H = 1350;

function postDefaults() {
  return { layout: "news", title: "", subtitle: "", body: "", credit: "", focus: 50, zoom: 100, gray: null,
    tSize: 100, bSize: 100, bAlign: "justify", tColor: "", bColor: "", layers: [], freeTexts: false };
}

function postSave() { lsSet("postDraft", JSON.stringify(PS.s)); }

function coverImage(ctx, img, x, y, w, h, focus, zoom) {
  const sw = img.naturalWidth, sh = img.naturalHeight;
  const sc = Math.max(w / sw, h / sh) * (zoom / 100);
  const dw = sw * sc, dh = sh * sc;
  const f = focus / 100;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) * f, dw, dh);
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

function drawPostNews(ctx) {
  const s = PS.s, W = POST_W, H = POST_H;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  halftone(ctx, W, H);
  // لوگو پایین راست، نوار سرمه‌ای عمودی کنار راست تا بالای لوگو، خط قرمز افقی هم‌تراز نوار قرمز لوگو
  const lh = 124, lr = PS.logo && PS.logo.naturalWidth ? PS.logo.naturalWidth / PS.logo.naturalHeight : 2.06;
  const lineY = 1265, lineH = 17;
  const lw = lh * lr, lx = 1019 - lw, ly = lineY - lh * 0.80;
  ctx.fillStyle = KR.navy;
  ctx.fillRect(996, 0, 14, ly + 40);
  ctx.fillStyle = KR.red;
  ctx.fillRect(0, lineY, lx + lw * 0.25, lineH);
  if (PS.logo && PS.logo.naturalWidth) ctx.drawImage(PS.logo, lx, ly, lw, lh);
  // عکس با گوشه‌های گرد
  const px = 92, py = 106, pw = 852, ph = 530;
  ctx.save();
  rr(ctx, px, py, pw, ph, 26);
  ctx.clip();
  if (PS.img) {
    if (s.gray) ctx.filter = "grayscale(1)";
    coverImage(ctx, PS.img, px, py, pw, ph, s.focus, s.zoom);
    ctx.filter = "none";
  } else {
    ctx.fillStyle = "#e3e8ef"; ctx.fillRect(px, py, pw, ph);
    setup(ctx); ctx.fillStyle = "#8a96a8"; ctx.textAlign = "center"; ctx.font = `700 40px ${FONT}`;
    ctx.fillText("عکس را انتخاب کنید", px + pw / 2, py + ph / 2);
  }
  ctx.restore();

  // نوشته‌ها: اگر جا کم بود اندازه‌ها کمی کوچک می‌شوند
  setup(ctx);
  if (s.freeTexts) { drawPostCredit(ctx, "news"); return; }
  const tS = (s.tSize || 100) / 100, bS = (s.bSize || 100) / 100, tC = s.tColor || KR.red, bC = s.bColor || KR.navy;
  const cx = px + pw / 2, top = py + ph + 22, bottom = ly - 14, textRight = 930, textW = 848;
  const layout = (k) => {
    const out = { k, h: 0, title: [], sub: [], body: [] };
    const tf = 76 * k * tS, sf = 64 * k * tS, bf = Math.max(18, 30.5 * k * bS);
    ctx.font = `900 ${tf}px ${FONT}`;
    out.title = s.title.trim() ? wrapRich(ctx, richWords(s.title.trim(), tC, KR.navy), textW).slice(0, 3) : [];
    ctx.font = `900 ${sf}px ${FONT}`;
    out.sub = s.subtitle.trim() ? wrapText(ctx, s.subtitle.trim(), textW).slice(0, 2) : [];
    ctx.font = `700 ${bf}px ${FONT}`;
    out.body = s.body.trim() ? wrapWords(ctx, s.body.trim(), textW) : [];
    Object.assign(out, { tf, sf, bf, tl: tf * 1.24, sl: sf * 1.32, bl: bf * 1.36 });
    out.h = out.title.length * out.tl + out.sub.length * out.sl + (out.body.length ? 14 + out.body.length * out.bl : 0);
    return out;
  };
  let L = layout(1);
  for (const k of [0.94, 0.88, 0.82, 0.76, 0.7, 0.64]) { if (L.h <= bottom - top) break; L = layout(k); }
  let y = top;
  ctx.font = `900 ${L.tf}px ${FONT}`;
  L.title.forEach((l) => { y += L.tl; drawRichLine(ctx, l, cx + l.w / 2, y - L.tl / 2); });
  ctx.font = `900 ${L.sf}px ${FONT}`;
  ctx.fillStyle = KR.navy;
  ctx.textAlign = "center";
  L.sub.forEach((l) => { y += L.sl; ctx.fillText(l, cx, y - L.sl / 2); });
  if (L.body.length) {
    y += 14;
    ctx.font = `700 ${L.bf}px ${FONT}`;
    ctx.fillStyle = bC;
    const maxLines = Math.floor((bottom - y) / L.bl);
    L.body.slice(0, maxLines).forEach((l, i) => {
      y += L.bl;
      const cut = i === maxLines - 1 && L.body.length > maxLines;
      const al = s.bAlign || "justify";
      drawJustified(ctx, cut ? [...l.words, "…"] : l.words, textRight, textW, y - L.bl / 2, al === "justify" && !l.last && !cut, al);
    });
  }
  drawPostCredit(ctx, "news");
}

function drawPostCredit(ctx, layout) {
  const s = PS.s;
  if (layout !== "news" || !s.credit.trim()) return;
  setup(ctx);
  ctx.font = `700 24px ${FONT}`; ctx.fillStyle = KR.navy; ctx.textAlign = "left";
  ctx.fillText(`تهیه و تدوین: ${s.credit.trim()}`, 40, POST_H - 26);
}

function drawPostCover(ctx) {
  const s = PS.s, W = POST_W, H = POST_H;
  ctx.fillStyle = "#222";
  ctx.fillRect(0, 0, W, H);
  const bandH = 150;
  if (PS.img) {
    ctx.filter = s.gray === false ? "none" : "grayscale(1) contrast(1.05)";
    coverImage(ctx, PS.img, 0, 0, W, H - bandH, s.focus, s.zoom);
    ctx.filter = "none";
  } else {
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
  const s = PS.s, W = POST_W, H = POST_H;
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

function drawPost(cv = $("#ps-canvas"), withLayers = true) {
  if (!cv) return;
  cv.width = POST_W; cv.height = POST_H;
  const ctx = cv.getContext("2d");
  drawPostBase(ctx);
  if (withLayers && PS.s.layers?.length && typeof drawLayers === "function") drawLayers(ctx, PS.s.layers);
}
function drawPostBase(ctx) { (PS.s.layout === "cover" ? drawPostCover : drawPostNews)(ctx); }

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
    w: POST_W, h: POST_H, layers, title: "🎨 ویرایش آزاد پست",
    background: (ctx) => { const f = s.freeTexts; s.freeTexts = f || convert; drawPostBase(ctx); s.freeTexts = f; },
    onSave: (ls) => { s.layers = ls; if (convert) s.freeTexts = true; postSave(); refresh(); },
  });
}

VIEWS.post = async (view) => {
  if (!PS.s) { try { PS.s = { ...postDefaults(), ...JSON.parse(lsGet("postDraft", "null") || "{}") }; } catch { PS.s = postDefaults(); } }
  if (!PS.logo) { PS.logo = new Image(); PS.logo.onload = () => drawPost(); PS.logo.src = "/static/brand/logo.png"; }
  const s = PS.s;
  view.innerHTML = `
    <div class="page-title"><h2>🖼️ پست‌ساز</h2><div class="btn-row"><button class="btn" id="ps-new">🆕 پست تازه</button></div></div>
    <div class="teaser-layout">
      <div>
        <div class="card"><h3>قالب</h3>
          <div class="chips">
            <button class="chip ${s.layout === "news" ? "active" : ""}" data-layout="news">خبر با عکس و متن</button>
            <button class="chip ${s.layout === "cover" ? "active" : ""}" data-layout="cover">تیتر درشت روی عکس</button>
          </div>
        </div>
        <div class="card"><h3>عکس</h3>
          <div class="btn-row"><label class="btn primary">📷 انتخاب عکس<input type="file" id="ps-file" accept="image/*" hidden></label>
            <label><input type="checkbox" data-p="gray" ${(s.gray ?? s.layout === "cover") ? "checked" : ""}> سیاه‌وسفید</label></div>
          <div class="form-grid" style="margin-top:8px">
            <label>جای عکس (بالا ↔ پایین)<input type="range" min="0" max="100" data-p="focus" value="${s.focus}"></label>
            <label>بزرگ‌نمایی<input type="range" min="100" max="220" data-p="zoom" value="${s.zoom}"></label>
          </div>
          <p class="small muted">عکس فقط روی گوشی خودتان پردازش می‌شود و جایی فرستاده نمی‌شود.</p>
        </div>
        <div class="card"><h3>نوشته‌ها</h3>
          <div class="form-grid">
            <label class="wide">تیتر اصلی<textarea data-p="title" rows="2" placeholder="مثلاً: ظرفیت خورشیدی کرمان تا یک ماه آینده از ۵۰۰ مگاوات عبور می‌کند">${esc(s.title)}</textarea>
              <small>تیتر قرمز است؛ بخشی را که بین دو ستاره بنویسید سرمه‌ای می‌شود: *ظرفیت خورشیدی کرمان* تا یک ماه آینده…</small></label>
            <label class="wide">${s.layout === "cover" ? "سطر بالای تیتر (کوچک)" : "زیرتیتر (سرمه‌ای)"}<input data-p="subtitle" value="${esc(s.subtitle)}" placeholder="${s.layout === "cover" ? "مثلاً: وقتی" : "مثلاً: برای پروانه‌های ساختمانی در استان کرمان"}"></label>
            <label class="wide">${s.layout === "cover" ? "جمله‌ی پایین عکس (اختیاری)" : "متن خبر"}<textarea data-p="body" rows="${s.layout === "cover" ? 2 : 6}" placeholder="${s.layout === "cover" ? "مثلاً: شهردار پاسخ می‌دهد…" : "خلاصه‌ی خبر…"}">${esc(s.body)}</textarea></label>
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
          <canvas id="ps-canvas" style="width:100%;height:auto;border-radius:10px;border:1px solid var(--line)"></canvas>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn primary" id="ps-dl">⬇️ دانلود عکس</button>
            ${navigator.canShare ? `<button class="btn" id="ps-share">📤 اشتراک‌گذاری</button>` : ""}
            <button class="btn" id="ps-archive">🗄️ ذخیره در بایگانی</button>
          </div>
        </div>
      </div>
    </div>`;
  $$("[data-layout]", view).forEach((b) => (b.onclick = () => { s.layout = b.dataset.layout; s.gray = null; postSave(); refresh(); }));
  $$("[data-p]", view).forEach((el) => el.addEventListener(el.type === "checkbox" ? "change" : "input", () => {
    const k = el.dataset.p;
    s[k] = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value;
    if (k === "tSize" || k === "bSize") $(k === "tSize" ? "#ps-tS" : "#ps-bS").textContent = `${num(el.value)}٪`;
    postSave();
    drawPost();
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
    img.onload = () => { PS.img = img; s.focus = 50; s.zoom = 100; drawPost(); };
    img.src = URL.createObjectURL(f);
  };
  $("#ps-new").onclick = () => { if (!confirm("نوشته‌های این پست پاک شود؟")) return; PS.s = { ...postDefaults(), credit: s.credit, layout: s.layout, tSize: s.tSize, bSize: s.bSize, bAlign: s.bAlign }; PS.img = null; postSave(); refresh(); };
  const blob = () => new Promise((r) => $("#ps-canvas").toBlob(r, "image/png"));
  const name = () => `kermanravi-${(s.title || "post").replace(/\*/g, "").slice(0, 30).trim().replace(/\s+/g, "-")}.png`;
  $("#ps-dl").onclick = async () => {
    await document.fonts?.ready;
    drawPost();
    const url = URL.createObjectURL(await blob());
    const a = document.createElement("a");
    a.href = url; a.download = name(); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  if ($("#ps-share")) $("#ps-share").onclick = async () => {
    const file = new File([await blob()], name(), { type: "image/png" });
    if (navigator.canShare({ files: [file] })) navigator.share({ files: [file] }).catch(() => {});
    else toast("اشتراک‌گذاری فایل در این مرورگر پشتیبانی نمی‌شود؛ دانلود کنید.");
  };
  $("#ps-archive").onclick = async () => {
    const file = new File([await blob()], name(), { type: "image/png" });
    const r = await uploadOne("/api/documents", file, { category: "photo", tags: "پست اینستاگرام", notes: `${s.title.replace(/\*/g, "")}\n${s.body}` }, () => {});
    toast(r.ok ? "در بایگانی ذخیره شد ✔" : r.error);
  };
  if (document.fonts) document.fonts.load(`900 60px Vazirmatn`).then(() => drawPost()).catch(() => drawPost());
  drawPost();
};
