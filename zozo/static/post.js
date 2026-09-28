"use strict";
// ═════════════════════════ پست‌ساز (پست تصویری اینستاگرام با قالب کرمان راوی) ═════════════════════════
// همه‌چیز در مرورگر ساخته می‌شود؛ خروجی PNG با اندازه‌ی ۱۰۸۰×۱۳۵۰ (پست ۴:۵ اینستاگرام).
// از توابع کمکی teaser.js استفاده می‌کند: rr، richWords، wrapRich، drawRichLine، krPattern، KR، FONT، setup

const PS = { s: null, img: null, logo: null };
const POST_W = 1080, POST_H = 1350;

function postDefaults() {
  return { layout: "news", title: "", subtitle: "", body: "", credit: "", focus: 50, zoom: 100, gray: null };
}

function postSave() { lsSet("postDraft", JSON.stringify(PS.s)); }

function coverImage(ctx, img, x, y, w, h, focus, zoom) {
  const sw = img.naturalWidth, sh = img.naturalHeight;
  const sc = Math.max(w / sw, h / sh) * (zoom / 100);
  const dw = sw * sc, dh = sh * sc;
  const f = focus / 100;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) * f, dw, dh);
}

function drawPostNews(ctx) {
  const s = PS.s, W = POST_W, H = POST_H;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  // نوار سرمه‌ای کنار راست
  ctx.fillStyle = KR.navy;
  ctx.fillRect(W - 16, 0, 16, H);
  // عکس
  const px = 44, py = 44, pw = W - 44 - 60, ph = 600;
  ctx.save();
  rr(ctx, px, py, pw, ph, 30);
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
  // تیتر: سطرهای عادی قرمز، *ستاره‌دار* سرمه‌ای
  setup(ctx);
  let y = py + ph + 60;
  const cx = (px + px + pw) / 2, maxW = pw - 40;
  if (s.title.trim()) {
    ctx.font = `900 64px ${FONT}`;
    const lines = wrapRich(ctx, richWords(s.title.trim(), KR.red, KR.navy), maxW).slice(0, 3);
    lines.forEach((l) => { drawRichLine(ctx, l, cx + l.w / 2, y); y += 84; });
  }
  if (s.subtitle.trim()) {
    ctx.font = `700 40px ${FONT}`;
    ctx.fillStyle = KR.navy;
    ctx.textAlign = "center";
    wrapText(ctx, s.subtitle.trim(), maxW).slice(0, 2).forEach((l) => { ctx.fillText(l, cx, y - 8); y += 54; });
  }
  // متن
  if (s.body.trim()) {
    y += 6;
    ctx.font = `400 31px ${FONT}`;
    ctx.fillStyle = KR.navy;
    ctx.textAlign = "right";
    const lines = [];
    s.body.trim().split("\n").forEach((para) => lines.push(...wrapText(ctx, para, maxW)));
    const maxLines = Math.max(0, Math.floor((H - 150 - y) / 48));
    lines.slice(0, maxLines).forEach((l, i) => {
      const last = i === Math.min(lines.length, maxLines) - 1;
      ctx.fillText(last && lines.length > maxLines ? l + " …" : l, px + pw - 20, y);
      y += 48;
    });
  }
  drawPostFooter(ctx, false);
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
  const right = W - 110;
  const rows = [];
  if (s.subtitle.trim()) { ctx.font = `900 58px ${FONT}`; rows.push(...wrapRich(ctx, richWords(s.subtitle.trim(), KR.navy, KR.red), 700).slice(0, 1).map((l) => ({ l, fs: 58 }))); }
  if (s.title.trim()) { ctx.font = `900 104px ${FONT}`; rows.push(...wrapRich(ctx, richWords(s.title.trim(), KR.red, KR.navy), 760).slice(0, 3).map((l) => ({ l, fs: 104 }))); }
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
    ctx.font = `700 40px ${FONT}`;
    const lines = wrapText(ctx, s.body.trim(), 760).slice(0, 3);
    const lh = 60, bh = lines.length * lh + 36, top = H - bandH - 110 - bh;
    const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 60;
    ctx.fillStyle = "rgba(255,255,255,.88)";
    rr(ctx, W / 2 - bw / 2, top, bw, bh, 26);
    ctx.fill();
    ctx.fillStyle = KR.navy; ctx.textAlign = "center";
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

function drawPost() {
  const cv = $("#ps-canvas");
  if (!cv) return;
  cv.width = POST_W; cv.height = POST_H;
  const ctx = cv.getContext("2d");
  (PS.s.layout === "cover" ? drawPostCover : drawPostNews)(ctx);
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
    postSave();
    drawPost();
  }));
  $("#ps-file").onchange = (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => { PS.img = img; s.focus = 50; s.zoom = 100; drawPost(); };
    img.src = URL.createObjectURL(f);
  };
  $("#ps-new").onclick = () => { if (!confirm("نوشته‌های این پست پاک شود؟")) return; PS.s = { ...postDefaults(), credit: s.credit, layout: s.layout }; PS.img = null; postSave(); refresh(); };
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
  if (document.fonts) document.fonts.load(`900 60px Vazirmatn`).then(drawPost).catch(drawPost);
  drawPost();
};
