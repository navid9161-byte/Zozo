"use strict";
// ═════════════════════════ ویرایشگر لایه‌ای (شبیه کنوا) ═════════════════════════
// یک ویرایشگر مشترک برای پست‌ساز و تیزرساز.
//   openDesigner({ w, h, layers, background(ctx, w, h, t), timed, duration, title, onSave(layers),
//                  bg: { label, move(dx, dy, t), zoom(f, t), reset(t) } })   ← جابه‌جا/بزرگ کردن عکس/ویدیوی زیر لایه‌ها
// هر لایه: { id, type: text|rect|ellipse|line|image, x, y, w, h, ...ویژگی‌ها, start, end }

const DZ = { imgs: {} };

const LAYER_DEFAULTS = {
  text: { w: 600, h: 140, text: "متن جدید", size: 56, weight: 900, color: "#193153", hi: "#9d1819", align: "center", lh: 1.35, bg: "", pad: 18, radius: 16, opacity: 1, shadow: false, stroke: "", strokeW: 0 },
  rect: { w: 400, h: 220, fill: "#9d1819", stroke: "", strokeW: 0, radius: 18, opacity: 1 },
  ellipse: { w: 220, h: 220, fill: "#193153", stroke: "", strokeW: 0, opacity: 1 },
  line: { w: 500, h: 10, fill: "#9d1819", opacity: 1 },
  image: { w: 420, h: 300, src: "", fit: "cover", radius: 0, opacity: 1, stroke: "", strokeW: 0 },
};

function layerImg(src) {
  if (!src) return null;
  if (!DZ.imgs[src]) {
    const im = new Image();
    im.onload = () => DZ.onImg && DZ.onImg();
    im.src = src;
    DZ.imgs[src] = im;
  }
  const im = DZ.imgs[src];
  return im.complete && im.naturalWidth ? im : null;
}

// کشیدن یک لایه (در مختصات بوم)
function drawLayer(ctx, L) {
  ctx.save();
  ctx.globalAlpha = L.opacity ?? 1;
  setup(ctx);
  if (L.type === "rect" || L.type === "line") {
    ctx.fillStyle = L.fill;
    rr(ctx, L.x, L.y, L.w, L.h, L.type === "line" ? Math.min(L.h / 2, 6) : Math.min(L.radius || 0, L.w / 2, L.h / 2));
    if (L.fill) ctx.fill();
    if (L.stroke && L.strokeW) { ctx.strokeStyle = L.stroke; ctx.lineWidth = L.strokeW; ctx.stroke(); }
  } else if (L.type === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(L.x + L.w / 2, L.y + L.h / 2, Math.abs(L.w / 2), Math.abs(L.h / 2), 0, 0, Math.PI * 2);
    if (L.fill) { ctx.fillStyle = L.fill; ctx.fill(); }
    if (L.stroke && L.strokeW) { ctx.strokeStyle = L.stroke; ctx.lineWidth = L.strokeW; ctx.stroke(); }
  } else if (L.type === "image") {
    const im = layerImg(L.src);
    rr(ctx, L.x, L.y, L.w, L.h, Math.min(L.radius || 0, L.w / 2, L.h / 2));
    if (im) {
      ctx.save();
      ctx.clip();
      const sw = im.naturalWidth, sh = im.naturalHeight;
      const sc = L.fit === "contain" ? Math.min(L.w / sw, L.h / sh) : Math.max(L.w / sw, L.h / sh);
      ctx.drawImage(im, L.x + (L.w - sw * sc) / 2, L.y + (L.h - sh * sc) / 2, sw * sc, sh * sc);
      ctx.restore();
      if (L.stroke && L.strokeW) { ctx.strokeStyle = L.stroke; ctx.lineWidth = L.strokeW; ctx.stroke(); }
    } else { ctx.fillStyle = "rgba(128,128,128,.35)"; ctx.fill(); }
  } else if (L.type === "text") {
    drawTextLayer(ctx, L);
  }
  ctx.restore();
}

// ───── متن لایه: هر واژه می‌تواند رنگ، اندازه و ضخامت خودش را داشته باشد (مثل ورد) ─────
// L.runs = [{ t: "متن", c: "#رنگ"?, s: نسبت اندازه?, w: ضخامت? }] ؛ اگر نبود، از L.text و *ستاره* استفاده می‌شود
function layerRuns(L) {
  if (L.runs?.length) return L.runs;
  const out = [];
  String(L.text || "").split("*").forEach((part, i) => { if (part) out.push(i % 2 ? { t: part, c: L.hi || L.color } : { t: part }); });
  return out;
}

// پاراگراف‌ها ← واژه‌ها؛ هر واژه از یک یا چند تکه (اگر وسط واژه رنگ عوض شده باشد)
function layerParas(L) {
  const paras = [[]];
  let word = null;
  for (const r of layerRuns(L)) {
    const st = { c: r.c || L.color, s: r.s || 1, w: r.w || L.weight || 700, f: r.f || L.font || "Vazirmatn" };
    for (const ch of String(r.t).split(/(\n|\s+)/)) {
      if (!ch) continue;
      if (ch === "\n") { word = null; paras.push([]); continue; }
      if (/^\s+$/.test(ch)) { word = null; continue; }
      if (!word) { word = { pieces: [] }; paras[paras.length - 1].push(word); }
      word.pieces.push({ t: ch, ...st });
    }
  }
  // اگر وسط یک واژه رنگ/اندازه عوض شده، حروف باز هم به هم بچسبند (اتصال‌دهنده‌ی نامرئی)
  for (const para of paras) for (const wd of para) {
    if (wd.pieces.length < 2) continue;
    wd.pieces.forEach((p, i) => { p.t = (i ? "\u200d" : "") + p.t + (i < wd.pieces.length - 1 ? "\u200d" : ""); });
  }
  return paras;
}

function drawTextLayer(ctx, L) {
  const pad = L.bg ? (L.pad ?? 16) : 0;
  const font = (p) => { ensureFont(p.f, p.w, () => (DZ.redraw || window.onFontLoaded)?.()); return `${p.w} ${L.size * p.s}px ${fontStack(p.f)}`; };
  const inner = Math.max(20, L.w - pad * 2);
  ctx.font = font({ w: L.weight || 700, s: 1, f: L.font || "Vazirmatn" });
  const sp = ctx.measureText(" ").width;
  const lines = [];
  for (const para of layerParas(L)) {
    let cur = { words: [], w: 0, s: 1 };
    for (const wd of para) {
      wd.tw = 0;
      for (const p of wd.pieces) { ctx.font = font(p); p.tw = ctx.measureText(p.t).width; wd.tw += p.tw; }
      wd.s = Math.max(...wd.pieces.map((p) => p.s));
      if (cur.words.length && cur.w + sp + wd.tw > inner) { lines.push(cur); cur = { words: [], w: 0, s: 1 }; }
      cur.w += (cur.words.length ? sp : 0) + wd.tw;
      cur.s = Math.max(cur.s, wd.s);
      cur.words.push(wd);
    }
    cur.last = true;
    lines.push(cur);
  }
  const lhOf = (l) => L.size * l.s * (L.lh || 1.35);
  const textH = lines.reduce((a, l) => a + lhOf(l), 0);
  const boxH = Math.max(L.h, textH + pad * 2);
  if (L.bg) {
    // شفافیت کادر پشت متن جدا از خود متن (bgA)
    ctx.save();
    if (L.bgA != null) ctx.globalAlpha *= Math.max(0, Math.min(1, Number(L.bgA)));
    ctx.fillStyle = L.bg;
    rr(ctx, L.x, L.y, L.w, boxH, Math.min(L.radius || 0, L.w / 2));
    ctx.fill();
    ctx.restore();
  }
  if (L.shadow) { ctx.shadowColor = "rgba(0,0,0,.65)"; ctx.shadowBlur = L.size * 0.25; ctx.shadowOffsetY = L.size * 0.05; }
  let y = L.y + pad + (boxH - textH - pad * 2) / 2;
  const left = L.x + pad, right = L.x + L.w - pad;
  ctx.textAlign = "right";
  for (const line of lines) {
    const lh = lhOf(line);
    y += lh / 2;
    if (line.words.length) {
      let gap = sp, x;
      if (L.align === "justify" && !line.last && line.words.length > 1) { gap = (inner - line.words.reduce((a, t) => a + t.tw, 0)) / (line.words.length - 1); x = right; }
      else if (L.align === "center") x = (left + right) / 2 + line.w / 2;
      else if (L.align === "left") x = left + line.w;
      else x = right;
      for (const wd of line.words) {
        for (const p of wd.pieces) {
          ctx.font = font(p);
          if (L.stroke && L.strokeW) { ctx.strokeStyle = L.stroke; ctx.lineWidth = L.strokeW; ctx.lineJoin = "round"; ctx.strokeText(p.t, x, y); }
          ctx.fillStyle = p.c;
          ctx.fillText(p.t, x, y);
          x -= p.tw;
        }
        x -= gap;
      }
    }
    y += lh / 2;
  }
}

function drawLayers(ctx, layers, t = null, scale = 1) {
  ctx.save();
  if (scale !== 1) ctx.scale(scale, scale);
  for (const L of layers || []) {
    if (L.hidden) continue;
    if (t !== null && L.start != null && L.end != null && (t < L.start || t >= L.end)) continue;
    drawLayer(ctx, L);
  }
  ctx.restore();
}

function layersReady(layers) {
  return Promise.all((layers || []).filter((l) => l.type === "image" && l.src).map((l) => new Promise((res) => {
    const im = DZ.imgs[l.src] || (layerImg(l.src), DZ.imgs[l.src]);
    if (im.complete) res(); else { im.addEventListener("load", res, { once: true }); im.addEventListener("error", res, { once: true }); }
  })));
}

// ───────────── رابط ویرایشگر ─────────────
function openDesigner(opts) {
  const { w: W, h: H } = opts;
  let layers = JSON.parse(JSON.stringify(opts.layers || []));
  let sel = layers.length ? layers[layers.length - 1].id : null;
  let t = opts.timed ? 0 : null;
  const undo = [], redo = [];
  const snap = () => { undo.push(JSON.stringify(layers)); if (undo.length > 60) undo.shift(); redo.length = 0; };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const cur = () => layers.find((l) => l.id === sel);

  const wrap = document.createElement("dialog");
  wrap.className = "designer";
  wrap.innerHTML = `
    <div class="dz-top">
      <b class="dz-title">${esc(opts.title || "ویرایشگر")}</b>
      <span class="spacer"></span>
      <button class="btn sm" data-a="undo" title="برگرداندن">↶</button><button class="btn sm" data-a="redo" title="دوباره">↷</button>
      <button class="btn sm" data-a="cancel">انصراف</button><button class="btn sm primary" data-a="save">✔ ذخیره</button>
    </div>
    <div class="dz-add">
      <button class="btn sm" data-add="text">🔤 متن</button>
      <button class="btn sm" data-add="title">🅃 تیتر</button>
      <button class="btn sm" data-add="rect">⬛ مستطیل</button>
      <button class="btn sm" data-add="ellipse">⚪ دایره</button>
      <button class="btn sm" data-add="line">➖ خط</button>
      <label class="btn sm">🖼 عکس<input type="file" accept="image/*" data-add="image" hidden></label>
      <button class="btn sm" data-add="logo">🏷 لوگو</button>
    </div>
    <div class="dz-main">
      <div class="dz-stage"><canvas class="dz-canvas"></canvas>
        ${opts.timed ? `<div class="dz-time"><span class="small">زمان</span><input type="range" class="dz-t" min="0" max="${opts.duration || 10}" step="0.1" value="0"><span class="small dz-tl"></span></div>` : ""}
      </div>
      <div class="dz-panel"></div>
    </div>`;
  document.body.appendChild(wrap);
  const cv = $(".dz-canvas", wrap);
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  let guides = [];

  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    if (opts.background) opts.background(ctx, W, H, t);
    drawLayers(ctx, layers, t);
    const L = cur();
    if (L && (t === null || L.start == null || (t >= L.start && t < L.end))) {
      ctx.save();
      ctx.strokeStyle = "#1e90ff"; ctx.lineWidth = Math.max(2, W / 400); ctx.setLineDash([10, 6]);
      ctx.strokeRect(L.x, L.y, L.w, L.h);
      ctx.setLineDash([]);
      ctx.fillStyle = "#1e90ff";
      const hs = Math.max(16, W / 50);
      for (const [hx, hy] of corners(L)) { ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs); }
      ctx.restore();
    }
    // عکس/ویدیوی زیر لایه‌ها هم مثل یک لایه انتخاب می‌شود (کادر و دستگیره)
    const br = sel === BG ? bgRect() : null;
    if (br) {
      ctx.save();
      ctx.strokeStyle = "#ff8c1a"; ctx.lineWidth = Math.max(3, W / 300); ctx.setLineDash([12, 6]);
      ctx.strokeRect(br.x, br.y, br.w, br.h);
      ctx.setLineDash([]); ctx.fillStyle = "#ff8c1a";
      const hs = Math.max(18, W / 45);
      for (const [hx, hy] of corners(br)) ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      ctx.restore();
    }
    ctx.save(); ctx.strokeStyle = "#ff2fb3"; ctx.lineWidth = 2;
    for (const g of guides) { ctx.beginPath(); if (g.x != null) { ctx.moveTo(g.x, 0); ctx.lineTo(g.x, H); } else { ctx.moveTo(0, g.y); ctx.lineTo(W, g.y); } ctx.stroke(); }
    ctx.restore();
    if (opts.timed) $(".dz-tl", wrap).textContent = `${num(t.toFixed(1))} ث`;
  };
  DZ.onImg = draw;
  DZ.redraw = draw;
  const corners = (L) => [[L.x, L.y], [L.x + L.w, L.y], [L.x, L.y + L.h], [L.x + L.w, L.y + L.h]];
  const BG = "__bg";
  // کادر عکس محدود به صفحه (اگر عکس از قاب بزرگ‌تر شد، دستگیره‌ها بیرون نروند)
  const bgRect = () => {
    const r = opts.bg?.rect ? opts.bg.rect(t) : null;
    if (!r) return null;
    const x1 = Math.max(0, r.x), y1 = Math.max(0, r.y), x2 = Math.min(W, r.x + r.w), y2 = Math.min(H, r.y + r.h);
    return x2 > x1 && y2 > y1 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : { x: 0, y: 0, w: W, h: H };
  };
  // قاب‌های توخالی (فقط خط دور) فقط از روی لبه انتخاب می‌شوند تا عکسِ زیرشان قابل انتخاب بماند
  const hitTest = (l, p) => {
    const inside = p.x >= l.x && p.x <= l.x + l.w && p.y >= l.y && p.y <= l.y + l.h;
    if (!inside) return false;
    if ((l.type === "rect" || l.type === "ellipse") && !l.fill) {
      const tol = Math.max(W / 40, (l.strokeW || 0) * 2);
      return p.x - l.x < tol || l.x + l.w - p.x < tol || p.y - l.y < tol || l.y + l.h - p.y < tol;
    }
    return true;
  };

  // ── پنل ویژگی‌ها
  const panel = () => {
    const L = cur();
    const p = $(".dz-panel", wrap);
    const list = `<div class="dz-layers"><b class="small">لایه‌ها</b>${[...layers].reverse().map((l) => `<div class="dz-li ${l.id === sel ? "on" : ""}" data-sel="${l.id}">
      <span>${{ text: "🔤", rect: "⬛", ellipse: "⚪", line: "➖", image: "🖼" }[l.type]} ${esc((l.type === "text" ? l.text : { rect: "مستطیل", ellipse: "دایره", line: "خط", image: "عکس" }[l.type]) || "").slice(0, 22)}</span>
      <span><button class="btn sm ghost" data-hide="${l.id}" title="پنهان/نمایش">${l.hidden ? "🙈" : "👁"}</button></span></div>`).join("") || `<div class="small muted">هنوز لایه‌ای نیست؛ از دکمه‌های بالا اضافه کنید.</div>`}
      ${opts.bg ? `<div class="dz-li ${sel === BG ? "on" : ""}" data-sel="${BG}"><span>📷 ${esc(opts.bg.label || "عکس/ویدیو")} (زیر همه)</span></div>` : ""}</div>`;
    const bgBox = opts.bg ? `<div class="dz-bg"><b class="small">📷 ${esc(opts.bg.label || "عکس/ویدیوی زیر لایه‌ها")}</b>
      <div class="small muted">روی عکس بزنید تا کادر نارنجی بیاید؛ وسطش را بکشید تا جابه‌جا شود و گوشه‌هایش را بکشید تا بزرگ و کوچک شود. یا از این دکمه‌ها:</div>
      <div class="btn-row"><button class="btn sm" data-bgz="0.9">− کوچک‌تر</button><button class="btn sm" data-bgz="1.1">+ بزرگ‌تر</button><button class="btn sm" data-bgr>↺ اندازه و جای اول</button></div></div>` : "";
    if (!L) { p.innerHTML = (sel === BG || !layers.length ? bgBox : `<div class="small muted" style="margin-bottom:8px">برای ویرایش، روی یک لایه یا روی عکس بزنید.</div>` + bgBox) + list; bindPanel(); return; }
    const col = (k, label, allowNone) => `<label class="dz-f">${label}<span class="btn-row"><input type="color" data-p="${k}" value="${/^#[0-9a-f]{6}$/i.test(L[k] || "") ? L[k] : "#ffffff"}">${allowNone ? `<label class="small"><input type="checkbox" data-none="${k}" ${!L[k] ? "checked" : ""}> هیچ</label>` : ""}</span></label>`;
    const rng = (k, label, min, max, step = 1) => `<label class="dz-f">${label} <small>${num(+(L[k] ?? 0).toFixed?.(2) ?? L[k])}</small><input type="range" data-p="${k}" min="${min}" max="${max}" step="${step}" value="${L[k] ?? 0}"></label>`;
    let f = "";
    if (L.type === "text") {
      f += `<div class="dz-f wide"><span>متن <small>— واژه یا بخشی از متن را انتخاب کنید و فقط رنگ، اندازه یا ضخامت همان را عوض کنید</small></span>
        ${richToolbarHTML()}${richBoxHTML(L)}</div>`;
      f += `<label class="dz-f wide">فونت کل متن<span class="btn-row"><select data-p="font" style="flex:1">${fontOptions(L.font || "Vazirmatn")}</select><button type="button" class="btn sm" data-addfont title="بارگذاری فایل فونت (ttf، otf، woff یا فایل زیپ دانلودشده)">➕ افزودن فونت</button></span></label>`;
      f += rng("size", "اندازه", 14, 220);
      f += `<label class="dz-f">ضخامت<select data-p="weight">${[[400, "معمولی"], [700, "پررنگ"], [800, "پررنگ‌تر"], [900, "خیلی پررنگ"]].map(([v, l]) => `<option value="${v}" ${+L.weight === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>`;
      f += `<div class="dz-f wide"><span>چینش</span><div class="seg">${[["right", "راست"], ["center", "وسط"], ["left", "چپ"], ["justify", "تراز"]].map(([v, l]) => `<button type="button" data-align="${v}" class="${L.align === v ? "active" : ""}">${l}</button>`).join("")}</div></div>`;
      f += col("color", "رنگ متن") + col("hi", "رنگ دوم (*…*)") + rng("lh", "فاصله‌ی سطرها", 0.9, 2.4, 0.05);
      f += col("bg", "کادر پشت متن", true) + rng("pad", "فاصله‌ی داخل کادر", 0, 80) + rng("radius", "گردی گوشه", 0, 120);
      f += col("stroke", "دور متن", true) + rng("strokeW", "ضخامت دور", 0, 16);
      f += `<label class="dz-f"><span><input type="checkbox" data-p="shadow" ${L.shadow ? "checked" : ""}> سایه</span></label>`;
    } else if (L.type === "image") {
      f += `<label class="dz-f wide btn sm">🔁 تعویض عکس<input type="file" accept="image/*" data-replace hidden></label>`;
      f += `<label class="dz-f">نمایش<select data-p="fit"><option value="cover" ${L.fit !== "contain" ? "selected" : ""}>پر کردن کادر</option><option value="contain" ${L.fit === "contain" ? "selected" : ""}>کامل</option></select></label>`;
      f += rng("radius", "گردی گوشه", 0, 400) + col("stroke", "قاب", true) + rng("strokeW", "ضخامت قاب", 0, 30);
    } else {
      f += col("fill", "رنگ", L.type !== "line") + (L.type !== "line" ? col("stroke", "خط دور", true) + rng("strokeW", "ضخامت خط دور", 0, 30) : "");
      if (L.type === "rect") f += rng("radius", "گردی گوشه", 0, 300);
    }
    f += rng("opacity", "شفافیت", 0.1, 1, 0.05);
    f += `<div class="dz-f wide small muted">جا و اندازه: ${num(Math.round(L.x))}، ${num(Math.round(L.y))} · ${num(Math.round(L.w))}×${num(Math.round(L.h))}
      <span class="btn-row" style="margin-top:4px"><button class="btn sm" data-c="hcenter">⇆ وسط افقی</button><button class="btn sm" data-c="vcenter">⇅ وسط عمودی</button><button class="btn sm" data-c="full">⛶ تمام عرض</button></span></div>`;
    if (opts.timed) {
      f += `<div class="dz-f wide"><span>زمان نمایش (ثانیه)</span><span class="btn-row">از <input type="number" step="0.1" min="0" data-p="start" value="${L.start ?? 0}" style="width:80px"> تا <input type="number" step="0.1" min="0" data-p="end" value="${L.end ?? opts.duration}" style="width:80px">
        <button class="btn sm" data-c="alltime">کل کلیپ</button><button class="btn sm" data-c="fromnow">از همین لحظه</button></span></div>`;
    }
    f += `<div class="dz-f wide btn-row"><button class="btn sm" data-c="up">⬆ جلوتر</button><button class="btn sm" data-c="down">⬇ عقب‌تر</button><button class="btn sm" data-c="dup">⧉ تکثیر</button><button class="btn sm danger" data-c="del">🗑 حذف</button></div>`;
    p.innerHTML = `<div class="dz-props">${f}</div>${list}`;
    bindPanel();
  };

  // ویرایشگر متن غنی: انتخاب بخشی از متن ← رنگ/اندازه/ضخامت فقط برای همان بخش
  const bindRich = (p) => mountRichEditor(p, cur, () => draw(), () => snap());


  const bindPanel = () => {
    const p = $(".dz-panel", wrap);
    let typing = null;
    $$("[data-p]", p).forEach((el) => el.addEventListener(el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input", () => {
      const L = cur();
      if (!L) return;
      if (!typing) { snap(); }
      clearTimeout(typing); typing = setTimeout(() => (typing = null), 600);
      const k = el.dataset.p;
      let v = el.type === "checkbox" ? el.checked : el.value;
      if (["size", "lh", "pad", "radius", "opacity", "strokeW", "weight", "start", "end"].includes(k)) v = Number(enDigits(v)) || 0;
      if (el.type === "color") { const none = $(`[data-none="${k}"]`, p); if (none) none.checked = false; }
      L[k] = v;
      if (L.type === "text" && unifyRuns(L, k)) { const ed = $(".dz-rich", p); if (ed) ed.innerHTML = runsToHTML(L); }
      if (k === "text" || el.type === "range") { draw(); const s = el.parentElement.querySelector("small"); if (s && el.type === "range") s.textContent = num(+Number(v).toFixed(2)); return; }
      draw();
      if (k !== "text") panel();
    }));
    $$("[data-none]", p).forEach((el) => (el.onchange = () => { snap(); const L = cur(); L[el.dataset.none] = el.checked ? "" : ($(`[data-p="${el.dataset.none}"]`, p).value); draw(); }));
    $$("[data-align]", p).forEach((b) => (b.onclick = () => { snap(); cur().align = b.dataset.align; draw(); panel(); }));
    $$("[data-sel]", p).forEach((el) => (el.onclick = (ev) => { if (ev.target.closest("[data-hide]")) return; sel = el.dataset.sel; draw(); panel(); }));
    $$("[data-hide]", p).forEach((b) => (b.onclick = () => { const L = layers.find((l) => l.id === b.dataset.hide); snap(); L.hidden = !L.hidden; draw(); panel(); }));
    $$("[data-bgz]", p).forEach((b) => (b.onclick = () => { opts.bg.zoom(Number(b.dataset.bgz), t); draw(); }));
    if ($("[data-bgr]", p)) $("[data-bgr]", p).onclick = () => { opts.bg.reset(t); draw(); };
    bindRich(p);
    const af = $("[data-addfont]", p);
    if (af) af.onclick = () => pickFontFile((fam) => { const L = cur(); if (L) { snap(); L.font = fam; draw(); panel(); } });
    const rep = $("[data-replace]", p);
    if (rep) rep.onchange = async (ev) => { const src = await uploadLayerImage(ev.target.files[0]); if (src) { snap(); cur().src = src; draw(); } };
    $$("[data-c]", p).forEach((b) => (b.onclick = () => {
      const L = cur(), i = layers.indexOf(L);
      snap();
      switch (b.dataset.c) {
        case "hcenter": L.x = (W - L.w) / 2; break;
        case "vcenter": L.y = (H - L.h) / 2; break;
        case "full": L.x = W * 0.05; L.w = W * 0.9; break;
        case "up": if (i < layers.length - 1) [layers[i], layers[i + 1]] = [layers[i + 1], layers[i]]; break;
        case "down": if (i > 0) [layers[i], layers[i - 1]] = [layers[i - 1], layers[i]]; break;
        case "dup": { const c = { ...JSON.parse(JSON.stringify(L)), id: uid(), tpl: 0, x: L.x + 30, y: L.y + 30 }; layers.splice(i + 1, 0, c); sel = c.id; break; }
        case "del": layers.splice(i, 1); sel = null; break;
        case "alltime": L.start = 0; L.end = opts.duration; break;
        case "fromnow": L.start = +(t || 0).toFixed(1); L.end = Math.min(opts.duration, L.start + 4); break;
      }
      draw(); panel();
    }));
  };

  // ── افزودن لایه
  const add = (type, extra = {}) => {
    snap();
    const d = LAYER_DEFAULTS[type];
    const scale = Math.min(W, H) / 1080;
    const L = { id: uid(), type, ...d, ...extra };
    if (!extra.w) { L.w = Math.min(W * 0.9, d.w * scale * (type === "text" ? 1.4 : 1)); L.h = d.h * scale * (type === "line" ? 1 : 1); }
    if (type === "text" && !extra.size) L.size = Math.round(d.size * scale);
    L.x = extra.x ?? (W - L.w) / 2; L.y = extra.y ?? (H - L.h) / 2;
    if (opts.timed) { L.start = +(t || 0).toFixed(1); L.end = opts.duration; }
    layers.push(L);
    sel = L.id;
    draw(); panel();
  };
  $(".dz-add", wrap).addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-add]");
    if (!b) return;
    const k = b.dataset.add;
    const sc = Math.min(W, H) / 1080;
    if (k === "title") add("text", { text: "تیتر *مهم*", size: Math.round(90 * sc), weight: 900, color: "#9d1819", hi: "#193153" });
    else if (k === "logo") add("image", { src: "/static/brand/logo.png", fit: "contain", w: 360 * sc, h: 175 * sc });
    else add(k);
  });
  $("[data-add=image]", wrap).onchange = async (ev) => {
    const src = await uploadLayerImage(ev.target.files[0]);
    if (src) { const im = await loadImg(src); const r = im ? im.naturalHeight / im.naturalWidth : 0.75; add("image", { src, w: W * 0.6, h: W * 0.6 * r }); }
  };

  // ── کشیدن و تغییر اندازه با لمس / موس
  let drag = null;
  const pt = (ev) => { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left) * W / r.width, y: (ev.clientY - r.top) * H / r.height }; };
  const visible = (l) => !l.hidden && (t === null || l.start == null || (t >= l.start && t < l.end));
  cv.addEventListener("pointerdown", (ev) => {
    const p = pt(ev);
    const hs = Math.max(28, W / 30);
    const L = cur();
    if (L && visible(L)) {
      const ci = corners(L).findIndex(([x, y]) => Math.abs(p.x - x) < hs && Math.abs(p.y - y) < hs);
      if (ci >= 0) { snap(); drag = { mode: "resize", ci, p0: p, o: { ...L } }; cv.setPointerCapture(ev.pointerId); return; }
    }
    // دستگیره‌های عکس زیر لایه‌ها
    const br = sel === BG ? bgRect() : null;
    if (br) {
      const ci = corners(br).findIndex(([x, y]) => Math.abs(p.x - x) < hs && Math.abs(p.y - y) < hs);
      if (ci >= 0) {
        const c = { x: br.x + br.w / 2, y: br.y + br.h / 2 };
        drag = { mode: "bgsize", c, d: Math.max(1, Math.hypot(p.x - c.x, p.y - c.y)) };
        cv.setPointerCapture(ev.pointerId); return;
      }
    }
    const hit = [...layers].reverse().find((l) => visible(l) && hitTest(l, p));
    if (hit) {
      if (sel !== hit.id) { sel = hit.id; panel(); }
      snap();
      drag = { mode: "move", p0: p, o: { ...hit } };
      cv.setPointerCapture(ev.pointerId);
    } else {
      const r0 = bgRect();
      const onBg = opts.bg && (!opts.bg.rect || (r0 && p.x >= r0.x && p.x <= r0.x + r0.w && p.y >= r0.y && p.y <= r0.y + r0.h));
      if (sel !== (onBg ? BG : null)) { sel = onBg ? BG : null; panel(); }
      if (onBg) { drag = { mode: "bg", last: p, pts: new Map([[ev.pointerId, p]]) }; cv.setPointerCapture(ev.pointerId); }
    }
    draw();
  });
  // انگشت دوم روی پس‌زمینه = بزرگ‌نمایی
  cv.addEventListener("pointerdown", (ev) => {
    if (drag?.mode === "bg" && !drag.pts.has(ev.pointerId)) { drag.pts.set(ev.pointerId, pt(ev)); drag.dist = 0; cv.setPointerCapture(ev.pointerId); }
  });
  cv.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    if (drag.mode === "bgsize") {
      const p = pt(ev), d = Math.max(1, Math.hypot(p.x - drag.c.x, p.y - drag.c.y));
      opts.bg.zoom(d / drag.d, t); drag.d = d; draw();
      return;
    }
    if (drag.mode === "bg") {
      const p = pt(ev);
      if (!drag.pts.has(ev.pointerId)) return;
      drag.pts.set(ev.pointerId, p);
      if (drag.pts.size > 1) {
        const [a, b] = [...drag.pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (drag.dist) opts.bg.zoom(d / drag.dist, t);
        drag.dist = d;
      } else { opts.bg.move((p.x - drag.last.x) / W, (p.y - drag.last.y) / H, t); drag.last = p; }
      draw();
      return;
    }
    const L = cur(), p = pt(ev), dx = p.x - drag.p0.x, dy = p.y - drag.p0.y, o = drag.o;
    guides = [];
    if (drag.mode === "move") {
      L.x = o.x + dx; L.y = o.y + dy;
      const tol = W / 70;
      if (Math.abs(L.x + L.w / 2 - W / 2) < tol) { L.x = W / 2 - L.w / 2; guides.push({ x: W / 2 }); }
      if (Math.abs(L.y + L.h / 2 - H / 2) < tol) { L.y = H / 2 - L.h / 2; guides.push({ y: H / 2 }); }
      for (const other of layers) {
        if (other === L || !visible(other)) continue;
        if (Math.abs(L.x - other.x) < tol) { L.x = other.x; guides.push({ x: other.x }); }
        if (Math.abs(L.x + L.w - other.x - other.w) < tol) { L.x = other.x + other.w - L.w; guides.push({ x: other.x + other.w }); }
      }
    } else {
      const min = 20;
      if (drag.ci === 0 || drag.ci === 2) { L.x = Math.min(o.x + dx, o.x + o.w - min); L.w = o.w - (L.x - o.x); } else L.w = Math.max(min, o.w + dx);
      if (drag.ci === 0 || drag.ci === 1) { L.y = Math.min(o.y + dy, o.y + o.h - min); L.h = o.h - (L.y - o.y); } else L.h = Math.max(min, o.h + dy);
      if (L.type === "image" && L.fit === "contain") { /* آزاد */ }
    }
    draw();
  });
  const end = (ev) => {
    if (drag?.mode === "bg") { drag.pts.delete(ev.pointerId); if (drag.pts.size) { drag.last = [...drag.pts.values()][0]; drag.dist = 0; return; } }
    if (drag) { drag = null; guides = []; draw(); panel(); }
  };
  cv.addEventListener("wheel", (ev) => {
    if (!opts.bg) return;
    const p = pt(ev);
    if (layers.some((l) => visible(l) && hitTest(l, p))) return;
    ev.preventDefault();
    opts.bg.zoom(ev.deltaY < 0 ? 1.06 : 0.94, t); draw();
  }, { passive: false });
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", end);

  // ── کلیدهای میان‌بُر (کامپیوتر)
  const onKey = (ev) => {
    if (!wrap.open || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    const L = cur();
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); doUndo(); return; }
    if (!L) return;
    const st = ev.shiftKey ? 10 : 2;
    const mv = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[ev.key];
    if (mv) { ev.preventDefault(); L.x += mv[0]; L.y += mv[1]; draw(); }
    if (ev.key === "Delete") { snap(); layers.splice(layers.indexOf(L), 1); sel = null; draw(); panel(); }
  };
  document.addEventListener("keydown", onKey);
  const doUndo = () => { if (!undo.length) return; redo.push(JSON.stringify(layers)); layers = JSON.parse(undo.pop()); if (!cur()) sel = null; draw(); panel(); };
  const doRedo = () => { if (!redo.length) return; undo.push(JSON.stringify(layers)); layers = JSON.parse(redo.pop()); draw(); panel(); };

  const close = () => { DZ.redraw = null; document.removeEventListener("keydown", onKey); if (DZ.selHandler) document.removeEventListener("selectionchange", DZ.selHandler); DZ.onImg = null; wrap.close(); wrap.remove(); };
  $(".dz-top", wrap).addEventListener("click", (ev) => {
    const a = ev.target.closest("[data-a]")?.dataset.a;
    if (a === "undo") doUndo();
    else if (a === "redo") doRedo();
    else if (a === "cancel") { if (confirm("تغییرات ذخیره نشود؟")) close(); }
    else if (a === "save") { opts.onSave(layers); close(); }
  });
  if (opts.timed) $(".dz-t", wrap).oninput = (ev) => { t = Number(ev.target.value); draw(); };
  wrap.addEventListener("cancel", (ev) => ev.preventDefault());
  wrap.showModal();
  if (document.fonts) document.fonts.load(`900 40px Vazirmatn`).then(draw).catch(draw);
  draw(); panel();
}


// ───── ویرایشگر متن غنی (مشترک: ویرایشگر لایه‌ها و ریلزساز) ─────
function richToolbarHTML() {
  return `<div class="dz-rtb"><select data-rf title="فونت بخش انتخاب‌شده"><option value="">فونت انتخاب…</option>${fontOptions("")}</select>
    <label class="btn sm" title="رنگ بخش انتخاب‌شده">🎨 رنگ<input type="color" data-rc value="#9d1819"></label>
    <button type="button" class="btn sm" data-rs="1.15" title="بزرگ‌تر">A+</button><button type="button" class="btn sm" data-rs="0.87" title="کوچک‌تر">A−</button>
    <button type="button" class="btn sm" data-rb title="پررنگ / معمولی"><b>B</b></button><button type="button" class="btn sm ghost" data-rclear title="برگرداندن بخش انتخاب‌شده به حالت عادی">✕ قالب‌بندی</button></div>`;
}
function richBoxHTML(L) {
  return `<div class="dz-rich" contenteditable="true" dir="rtl" style="color:${esc(L.color)};font-weight:${L.weight || 700};font-family:${esc(fontStack(L.font))}">${runsToHTML(L)}</div>`;
}
function mountRichEditor(p, getL, onChange, onFirst) {
  const ed = $(".dz-rich", p);
  if (!ed) return;
  let typing = null;
  const sync = () => {
    const L = getL();
    if (!L) return;
    if (!typing) onFirst?.();
    clearTimeout(typing); typing = setTimeout(() => (typing = null), 700);
    L.runs = htmlToRuns(ed, L);
    L.text = L.runs.map((r) => r.t).join("");
    onChange(L);
  };
  ed.addEventListener("input", sync);
  // چسباندن فقط متن (بدون رنگ و فونت سایت یا ورد) تا تنظیمات کلی روی آن کار کند
  ed.addEventListener("paste", (ev) => {
    const t = ev.clipboardData?.getData("text/plain");
    if (t == null) return;
    ev.preventDefault();
    document.execCommand("insertText", false, t.replace(/\r\n?/g, "\n"));
  });
  const selRange = () => {
    const sel = window.getSelection();
    if (!sel.rangeCount || !ed.contains(sel.anchorNode)) return null;
    const r = sel.getRangeAt(0);
    if (r.collapsed) { toast("اول واژه یا بخشی از متن را انتخاب کنید (با کشیدن انگشت یا دوبار زدن روی واژه)"); return null; }
    return r;
  };
  let saved = null;
  ed.addEventListener("keyup", () => { const s0 = window.getSelection(); if (s0.rangeCount && ed.contains(s0.anchorNode)) saved = s0.getRangeAt(0).cloneRange(); });
  ed.addEventListener("mouseup", () => { const s0 = window.getSelection(); if (s0.rangeCount && ed.contains(s0.anchorNode)) saved = s0.getRangeAt(0).cloneRange(); });
  // انتخاب آخر نگه داشته می‌شود تا با زدن دکمه‌ها از دست نرود (شنونده با حذف ویرایشگر خودش پاک می‌شود)
  const onSel = () => {
    if (!ed.isConnected) { document.removeEventListener("selectionchange", onSel); return; }
    const s0 = window.getSelection(); if (s0.rangeCount && ed.contains(s0.anchorNode) && !s0.isCollapsed) saved = s0.getRangeAt(0).cloneRange();
  };
  document.addEventListener("selectionchange", onSel);
  const apply = (fn) => {
    let r = selRange();
    if (!r && saved && !saved.collapsed) { r = saved; const s0 = window.getSelection(); s0.removeAllRanges(); s0.addRange(r); }
    if (!r) return;
    const host = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    const cs = getComputedStyle(host);
    const anc = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
    const parentPx = parseFloat(getComputedStyle(anc).fontSize);
    const span = document.createElement("span");
    const frag = r.extractContents();
    fn(span, frag, cs, parentPx);
    span.appendChild(frag);
    r.insertNode(span);
    const s0 = window.getSelection(); s0.removeAllRanges();
    const nr = document.createRange(); nr.selectNodeContents(span); s0.addRange(nr); saved = nr.cloneRange();
    sync();
  };
  const strip = (frag, prop) => frag.querySelectorAll?.("*").forEach((el) => { el.style[prop] = ""; if (prop === "color") el.removeAttribute("color"); });
  $("[data-rc]", p).addEventListener("input", (ev) => apply((span, frag) => { strip(frag, "color"); span.style.color = ev.target.value; }));
  $("[data-rc]", p).addEventListener("pointerdown", () => { const s0 = window.getSelection(); if (s0.rangeCount && ed.contains(s0.anchorNode) && !s0.isCollapsed) saved = s0.getRangeAt(0).cloneRange(); });
  $$("[data-rs]", p).forEach((b) => b.addEventListener("pointerdown", (ev) => ev.preventDefault()));
  $$("[data-rs]", p).forEach((b) => (b.onclick = () => apply((span, frag, cs, parentPx) => {
    strip(frag, "fontSize");
    // اندازه‌ی تازه = اندازه‌ی فعلی × ضریب (نسبت به والد حساب می‌شود تا تودرتو دو برابر نشود)
    const want = parseFloat(cs.fontSize) * Number(b.dataset.rs), basePx = parseFloat(getComputedStyle(ed).fontSize);
    span.style.fontSize = `${(Math.min(4 * basePx, Math.max(0.3 * basePx, want)) / parentPx).toFixed(3)}em`;
  })));
  const rf = $("[data-rf]", p);
  rf.addEventListener("pointerdown", () => { const s0 = window.getSelection(); if (s0.rangeCount && ed.contains(s0.anchorNode) && !s0.isCollapsed) saved = s0.getRangeAt(0).cloneRange(); });
  rf.addEventListener("change", () => { const v = rf.value; if (!v) return; apply((span, frag) => { strip(frag, "fontFamily"); span.style.fontFamily = fontStack(v); }); rf.value = ""; });
  $("[data-rb]", p).addEventListener("pointerdown", (ev) => ev.preventDefault());
  $("[data-rb]", p).onclick = () => apply((span, frag, cs) => { strip(frag, "fontWeight"); span.style.fontWeight = Number(cs.fontWeight) >= 800 ? "400" : "900"; });
  $("[data-rclear]", p).addEventListener("pointerdown", (ev) => ev.preventDefault());
  $("[data-rclear]", p).onclick = () => apply((span, frag) => { ["color", "fontSize", "fontWeight", "fontFamily"].forEach((k) => strip(frag, k)); });
}

// تغییر «کلی» رنگ/فونت/ضخامت/اندازه باید روی همه‌ی متن بنشیند: اگر همه‌ی تکه‌ها مقدار خودشان را دارند
// (مثلاً متنِ چسبانده از سایت)، آن مقدارها برداشته می‌شوند؛ واژه‌هایی که جدا رنگ یا بزرگ شده‌اند می‌مانند.
const RUN_KEY = { color: "c", font: "f", weight: "w", size: "s" };
function unifyRuns(L, prop) {
  const key = RUN_KEY[prop];
  const rs = (L.runs || []).filter((r) => r.t.trim());
  if (!key || !rs.length || !rs.every((r) => r[key] !== undefined)) return false;
  L.runs.forEach((r) => delete r[key]);
  return true;
}

// ───── تبدیل متن غنی ↔ تکه‌ها ─────
function runsToHTML(L) {
  return layerRuns(L).map((r) => {
    const txt = esc(r.t).replace(/\n/g, "<br>");
    const st = [r.c && `color:${r.c}`, r.s && r.s !== 1 && `font-size:${r.s}em`, r.w && `font-weight:${r.w}`, r.f && `font-family:${fontStack(r.f).replace(/"/g, "'")}`].filter(Boolean).join(";");
    return st ? `<span style="${st}">${txt}</span>` : txt;
  }).join("");
}

function cssHex(c) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || "");
  return m ? "#" + m.slice(1, 4).map((x) => Number(x).toString(16).padStart(2, "0")).join("") : (c || "").toLowerCase();
}

function htmlToRuns(ed, L) {
  const base = parseFloat(getComputedStyle(ed).fontSize) || 16;
  const baseColor = cssHex(getComputedStyle(ed).color), baseW = Number(L.weight || 700);
  const fam = (cs) => (cs.fontFamily || "").split(",")[0].trim().replace(/^["']|["']$/g, "");
  const baseF = fam(getComputedStyle(ed));
  const out = [];
  const push = (t, el) => {
    const cs = getComputedStyle(el);
    const c = cssHex(cs.color), s = +(parseFloat(cs.fontSize) / base).toFixed(3), w = Number(cs.fontWeight);
    const r = { t };
    const f = fam(cs);
    if (f && f !== baseF) r.f = f;
    if (c && c !== baseColor) r.c = c;
    if (Math.abs(s - 1) > 0.01) r.s = s;
    if (w && w !== baseW) r.w = w;
    const last = out[out.length - 1];
    if (last && last.c === r.c && last.s === r.s && last.w === r.w && last.f === r.f) last.t += t; else out.push(r);
  };
  const walk = (node, parentEl) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { if (n.nodeValue) push(n.nodeValue.replace(/\u00a0/g, " "), parentEl); continue; }
      if (n.nodeType !== 1) continue;
      if (n.tagName === "BR") { push("\n", parentEl); continue; }
      const block = /^(DIV|P)$/.test(n.tagName);
      if (block && out.length && !out[out.length - 1].t.endsWith("\n")) push("\n", parentEl);
      walk(n, n);
    }
  };
  walk(ed, ed);
  // سطر خالیِ آخر که مرورگر می‌گذارد
  if (out.length && out[out.length - 1].t === "\n") out.pop();
  return out;
}

async function uploadLayerImage(file) {
  if (!file) return null;
  const f = await normalizeImage(file);
  const r = await uploadOne("/api/media", f, {}, () => {});
  if (!r.ok) { toast(r.error); return null; }
  return `/api/media/${r.data.added[0].id}/file`;
}
