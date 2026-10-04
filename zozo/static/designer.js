"use strict";
// ═════════════════════════ ویرایشگر لایه‌ای (شبیه کنوا) ═════════════════════════
// یک ویرایشگر مشترک برای پست‌ساز و تیزرساز.
//   openDesigner({ w, h, layers, background(ctx, w, h, t), timed, duration, title, onSave(layers) })
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
    const pad = L.bg ? (L.pad ?? 16) : 0;
    ctx.font = `${L.weight || 700} ${L.size}px ${FONT}`;
    const words = richWords(L.text || "", L.color, L.hi || L.color);
    // پاراگراف‌ها: سطر جدید در متن رعایت می‌شود
    const lines = [];
    String(L.text || "").split("\n").forEach((para) => {
      const ws = richWords(para, L.color, L.hi || L.color);
      if (!ws.length) { lines.push({ words: [], w: 0, last: true }); return; }
      const wrapped = wrapRich(ctx, ws, Math.max(20, L.w - pad * 2));
      wrapped.forEach((l, i) => lines.push({ ...l, last: i === wrapped.length - 1 }));
    });
    void words;
    const lh = L.size * (L.lh || 1.35);
    const textH = lines.length * lh;
    if (L.bg) {
      ctx.fillStyle = L.bg;
      rr(ctx, L.x, L.y, L.w, Math.max(L.h, textH + pad * 2), Math.min(L.radius || 0, L.w / 2));
      ctx.fill();
    }
    if (L.shadow) { ctx.shadowColor = "rgba(0,0,0,.65)"; ctx.shadowBlur = L.size * 0.25; ctx.shadowOffsetY = L.size * 0.05; }
    let y = L.y + pad + lh / 2 + (Math.max(L.h, textH + pad * 2) - textH - pad * 2) / 2;
    const left = L.x + pad, right = L.x + L.w - pad, inner = right - left;
    const sp = ctx.measureText(" ").width;
    for (const line of lines) {
      if (line.words.length) {
        let startRight;
        let gap = sp;
        if (L.align === "justify" && !line.last && line.words.length > 1) {
          gap = (inner - line.words.reduce((a, t) => a + t.tw, 0)) / (line.words.length - 1);
          startRight = right;
        } else if (L.align === "center") startRight = (left + right) / 2 + line.w / 2;
        else if (L.align === "left") startRight = left + line.w;
        else startRight = right;
        let x = startRight;
        ctx.textAlign = "right";
        for (const t of line.words) {
          if (L.stroke && L.strokeW) { ctx.strokeStyle = L.stroke; ctx.lineWidth = L.strokeW; ctx.lineJoin = "round"; ctx.strokeText(t.w, x, y); }
          ctx.fillStyle = t.c;
          ctx.fillText(t.w, x, y);
          x -= t.tw + gap;
        }
      }
      y += lh;
    }
  }
  ctx.restore();
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
    ctx.save(); ctx.strokeStyle = "#ff2fb3"; ctx.lineWidth = 2;
    for (const g of guides) { ctx.beginPath(); if (g.x != null) { ctx.moveTo(g.x, 0); ctx.lineTo(g.x, H); } else { ctx.moveTo(0, g.y); ctx.lineTo(W, g.y); } ctx.stroke(); }
    ctx.restore();
    if (opts.timed) $(".dz-tl", wrap).textContent = `${num(t.toFixed(1))} ث`;
  };
  DZ.onImg = draw;
  const corners = (L) => [[L.x, L.y], [L.x + L.w, L.y], [L.x, L.y + L.h], [L.x + L.w, L.y + L.h]];

  // ── پنل ویژگی‌ها
  const panel = () => {
    const L = cur();
    const p = $(".dz-panel", wrap);
    const list = `<div class="dz-layers"><b class="small">لایه‌ها</b>${[...layers].reverse().map((l) => `<div class="dz-li ${l.id === sel ? "on" : ""}" data-sel="${l.id}">
      <span>${{ text: "🔤", rect: "⬛", ellipse: "⚪", line: "➖", image: "🖼" }[l.type]} ${esc((l.type === "text" ? l.text : { rect: "مستطیل", ellipse: "دایره", line: "خط", image: "عکس" }[l.type]) || "").slice(0, 22)}</span>
      <span><button class="btn sm ghost" data-hide="${l.id}" title="پنهان/نمایش">${l.hidden ? "🙈" : "👁"}</button></span></div>`).join("") || `<div class="small muted">هنوز لایه‌ای نیست؛ از دکمه‌های بالا اضافه کنید.</div>`}</div>`;
    if (!L) { p.innerHTML = list; bindPanel(); return; }
    const col = (k, label, allowNone) => `<label class="dz-f">${label}<span class="btn-row"><input type="color" data-p="${k}" value="${/^#[0-9a-f]{6}$/i.test(L[k] || "") ? L[k] : "#ffffff"}">${allowNone ? `<label class="small"><input type="checkbox" data-none="${k}" ${!L[k] ? "checked" : ""}> هیچ</label>` : ""}</span></label>`;
    const rng = (k, label, min, max, step = 1) => `<label class="dz-f">${label} <small>${num(+(L[k] ?? 0).toFixed?.(2) ?? L[k])}</small><input type="range" data-p="${k}" min="${min}" max="${max}" step="${step}" value="${L[k] ?? 0}"></label>`;
    let f = "";
    if (L.type === "text") {
      f += `<label class="dz-f wide">متن <small>(واژه‌های *ستاره‌دار* رنگ دوم می‌گیرند)</small><textarea data-p="text" rows="3">${esc(L.text)}</textarea></label>`;
      f += rng("size", "اندازه", 14, 220);
      f += `<label class="dz-f">ضخامت<select data-p="weight">${[[400, "معمولی"], [700, "پررنگ"], [900, "خیلی پررنگ"]].map(([v, l]) => `<option value="${v}" ${+L.weight === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>`;
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
      if (k === "text" || el.type === "range") { draw(); const s = el.parentElement.querySelector("small"); if (s && el.type === "range") s.textContent = num(+Number(v).toFixed(2)); return; }
      draw();
      if (k !== "text") panel();
    }));
    $$("[data-none]", p).forEach((el) => (el.onchange = () => { snap(); const L = cur(); L[el.dataset.none] = el.checked ? "" : ($(`[data-p="${el.dataset.none}"]`, p).value); draw(); }));
    $$("[data-align]", p).forEach((b) => (b.onclick = () => { snap(); cur().align = b.dataset.align; draw(); panel(); }));
    $$("[data-sel]", p).forEach((el) => (el.onclick = (ev) => { if (ev.target.closest("[data-hide]")) return; sel = el.dataset.sel; draw(); panel(); }));
    $$("[data-hide]", p).forEach((b) => (b.onclick = () => { const L = layers.find((l) => l.id === b.dataset.hide); snap(); L.hidden = !L.hidden; draw(); panel(); }));
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
    const hit = [...layers].reverse().find((l) => visible(l) && p.x >= l.x && p.x <= l.x + l.w && p.y >= l.y && p.y <= l.y + l.h);
    if (hit) {
      if (sel !== hit.id) { sel = hit.id; panel(); }
      snap();
      drag = { mode: "move", p0: p, o: { ...hit } };
      cv.setPointerCapture(ev.pointerId);
    } else { sel = null; panel(); }
    draw();
  });
  cv.addEventListener("pointermove", (ev) => {
    if (!drag) return;
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
  const end = () => { if (drag) { drag = null; guides = []; draw(); panel(); } };
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

  const close = () => { document.removeEventListener("keydown", onKey); DZ.onImg = null; wrap.close(); wrap.remove(); };
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

async function uploadLayerImage(file) {
  if (!file) return null;
  const f = await normalizeImage(file);
  const r = await uploadOne("/api/media", f, {}, () => {});
  if (!r.ok) { toast(r.error); return null; }
  return `/api/media/${r.data.added[0].id}/file`;
}
