"use strict";
// ═════════════════════════ تنظیم سایز عکس ═════════════════════════
// عکس ← اندازه‌ی دقیق (پیش‌فرض: عکس سایت کرمان راوی ۱۰۰۷×۷۱۹، پر کردن کادر) ← خروجی WebP.
// پیش‌نمایش در مرورگر کشیده می‌شود؛ خروجی نهایی روی سرور با همان حساب ساخته می‌شود.

const IF_DEFAULT = { id: "site", name: "عکس سایت کرمان راوی", w: 1007, h: 719, mode: "fill", bg: "blur", sharpen: 0, bright: 0, contrast: 0, color: 0, quality: 85, max_kb: 0 };
const IF_KEYS = ["w", "h", "mode", "bg", "sharpen", "bright", "contrast", "color", "quality", "max_kb"];
const IF_SIZES = [[1007, 719, "سایت"], [1080, 1080, "مربع"], [1080, 1350, "پست ۴:۵"], [1080, 1920, "استوری"], [1200, 630, "لینک"]];
const IF = { cfg: null, preset: "site", p: null, m: null, img: null, out: null };

async function ifLoadCfg() {
  const v = (await api("/api/prefs/imgfit").catch(() => ({}))).value;
  IF.cfg = v && Array.isArray(v.presets) && v.presets.length ? v : { presets: [{ ...IF_DEFAULT }], def: "site" };
  if (!IF.cfg.presets.some((p) => p.id === IF.cfg.def)) IF.cfg.def = IF.cfg.presets[0].id;
}
const ifSaveCfg = () => api("/api/prefs/imgfit", { method: "PUT", body: { value: IF.cfg } });
const ifPreset = (id) => IF.cfg.presets.find((p) => p.id === id) || IF.cfg.presets[0];
function ifUsePreset(id) {
  const pr = ifPreset(id);
  IF.preset = pr.id;
  IF.p = { ...Object.fromEntries(IF_KEYS.map((k) => [k, pr[k] ?? IF_DEFAULT[k]])), fx: 0.5, fy: 0.5, zoom: 1 };
}
// آیا تنظیم‌های فعلی با قالب انتخاب‌شده فرق دارد؟
const ifDirty = () => { const pr = ifPreset(IF.preset); return IF_KEYS.some((k) => String(pr[k] ?? IF_DEFAULT[k]) !== String(IF.p[k])); };

VIEWS.imgfit = async (view) => {
  await ifLoadCfg();
  if (!IF.p) ifUsePreset(IF.cfg.def);
  view.innerHTML = `<div class="page-title"><h2>🖼 تنظیم سایز عکس</h2></div>
    <div class="if-layout">
      <div class="card if-stage">
        <div class="btn-row"><button class="btn primary" id="if-pick">📷 انتخاب عکس</button><span class="small muted" id="if-src"></span></div>
        <div class="if-drop" id="if-drop"><canvas id="if-cv"></canvas><div class="if-empty" id="if-empty">عکس را انتخاب کنید یا این‌جا بکشید و رها کنید</div></div>
        <div class="small muted" id="if-hint"></div>
        <div id="if-fit"></div>
      </div>
      <div>
        <div class="card"><h3>قالب</h3><div id="if-presets"></div></div>
        <div class="card"><h3>اندازه و خروجی</h3><div id="if-size"></div></div>
        <div class="card"><details id="if-adj-d"><summary><b>🎨 رنگ و وضوح</b> <small class="muted">(پیش‌فرض: بدون تغییر)</small></summary><div id="if-adj"></div></details></div>
        <div class="card"><button class="btn primary big" id="if-go" style="width:100%">⬇️ ساخت و دانلود WebP</button><div id="if-out"></div></div>
      </div>
    </div>`;
  $("#if-pick").onclick = () => ifPick();
  const drop = $("#if-drop");
  drop.addEventListener("dragover", (ev) => { ev.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (ev) => { ev.preventDefault(); drop.classList.remove("over"); const f = ev.dataTransfer.files[0]; if (f) ifUpload(f); });
  $("#if-go").onclick = ifMake;
  ifBindCanvas($("#if-cv"));
  ifPanels();
  if (IF.m) ifSetImage(IF.m); else ifDraw();
};

function ifPick() {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*";
  inp.onchange = () => { if (inp.files[0]) ifUpload(inp.files[0]); };
  inp.click();
}
async function ifUpload(f) {
  if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|bmp|tiff?)$/i.test(f.name)) return toast("فقط فایل عکس");
  toast("در حال بارگذاری…", 60000);
  // عکس اصلی موقت است (دو روز بعد خودکار پاک می‌شود)؛ خروجی روی گوشی/کامپیوتر دانلود می‌شود
  const r = await uploadOne("/api/media", f, { keep: "0" }, (p) => toast(`در حال بارگذاری… ${num(Math.round(p * 100))}٪`, 60000));
  if (!r.ok) return toast(r.error);
  toast("بارگذاری شد ✔", 1500);
  // عکس تازه: تنظیم‌های قالب پیش‌فرض، برش از وسط
  ifUsePreset(IF.cfg.def);
  ifPanels();
  ifSetImage(r.data.added[0]);
}
function ifSetImage(m) {
  IF.m = m; IF.out = null;
  if ($("#if-out")) $("#if-out").innerHTML = "";
  const im = new Image();
  im.onload = () => { IF.img = im; ifDraw(); ifInfo(); };
  im.onerror = () => toast("این عکس در مرورگر باز نشد");
  im.src = `/api/media/${m.id}/file`;
}
function ifInfo() {
  const src = $("#if-src"), hint = $("#if-hint");
  if (!src || !IF.img) return;
  const iw = IF.img.naturalWidth, ih = IF.img.naturalHeight, p = IF.p;
  src.textContent = `${IF.m.filename} · ${num(iw)}×${num(ih)}`;
  const need = p.mode === "fill" ? Math.max(p.w / iw, p.h / ih) * p.zoom : Math.min(p.w / iw, p.h / ih);
  hint.innerHTML = p.mode === "fill"
    ? `👆 عکس را با انگشت بکشید تا قسمت دلخواه داخل کادر بیاید${need > 1.05 ? ` · <span class="if-warn">عکس اصلی کوچک‌تر از خروجی است و ${num(need.toFixed(1))} برابر بزرگ می‌شود (کمی نرم می‌شود)</span>` : ""}`
    : "کل عکس دیده می‌شود؛ جای خالی با پس‌زمینه پر می‌شود.";
}

// ───── پیش‌نمایش ─────
function ifGeom() {
  const p = IF.p, im = IF.img, iw = im.naturalWidth, ih = im.naturalHeight;
  const sc = Math.max(p.w / iw, p.h / ih) * p.zoom, rw = iw * sc, rh = ih * sc;
  return { sc, rw, rh, x: (rw - p.w) * p.fx, y: (rh - p.h) * p.fy };
}
function ifDraw() {
  const cv = $("#if-cv");
  if (!cv) return;
  const p = IF.p, k = Math.min(1, 900 / Math.max(p.w, p.h));
  cv.width = Math.round(p.w * k); cv.height = Math.round(p.h * k);
  $("#if-empty").hidden = !!IF.img;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#e9ecef"; ctx.fillRect(0, 0, cv.width, cv.height);
  // اصلاح رنگ در پیش‌نمایش (تقریبی؛ شفاف‌سازی فقط در خروجی دیده می‌شود)
  cv.style.filter = `brightness(${1 + p.bright}) contrast(${1 + p.contrast}) saturate(${1 + p.color})`;
  if (!IF.img) return;
  const im = IF.img;
  ctx.save(); ctx.scale(k, k);
  if (p.mode === "fill") {
    const g = ifGeom();
    ctx.drawImage(im, -g.x, -g.y, g.rw, g.rh);
  } else {
    if (p.bg === "blur") {
      // پس‌زمینه‌ی مات: عکس خیلی کوچک و دوباره بزرگ (در همه‌ی مرورگرها کار می‌کند)
      const t = document.createElement("canvas"); t.width = Math.max(8, Math.round(p.w / 40)); t.height = Math.max(8, Math.round(p.h / 40));
      const tc = t.getContext("2d"), s0 = Math.max(t.width / im.naturalWidth, t.height / im.naturalHeight);
      tc.drawImage(im, (t.width - im.naturalWidth * s0) / 2, (t.height - im.naturalHeight * s0) / 2, im.naturalWidth * s0, im.naturalHeight * s0);
      ctx.imageSmoothingQuality = "high"; ctx.drawImage(t, 0, 0, p.w, p.h);
      ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.fillRect(0, 0, p.w, p.h);
    } else { ctx.fillStyle = p.bg; ctx.fillRect(0, 0, p.w, p.h); }
    const s = Math.min(p.w / im.naturalWidth, p.h / im.naturalHeight), fw = im.naturalWidth * s, fh = im.naturalHeight * s;
    ctx.drawImage(im, (p.w - fw) / 2, (p.h - fh) / 2, fw, fh);
  }
  ctx.restore();
}
function ifBindCanvas(cv) {
  const pts = new Map();
  let st = null;
  const scale = () => IF.p.w / cv.getBoundingClientRect().width;   // پیکسل صفحه ← پیکسل خروجی
  cv.style.touchAction = "none";
  const zoomTo = (z) => { IF.p.zoom = +Math.max(1, Math.min(6, z)).toFixed(3); const zs = $("#if-zoom"); if (zs) zs.value = IF.p.zoom; ifDraw(); ifInfo(); };
  cv.addEventListener("pointerdown", (ev) => {
    if (!IF.img || IF.p.mode !== "fill") return;
    cv.setPointerCapture(ev.pointerId);
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pts.size === 2) { const [a, b] = [...pts.values()]; st = { pinch: Math.hypot(a.x - b.x, a.y - b.y), zoom: IF.p.zoom }; return; }
    st = { x: ev.clientX, y: ev.clientY, fx: IF.p.fx, fy: IF.p.fy };
  });
  cv.addEventListener("pointermove", (ev) => {
    if (!st || !pts.has(ev.pointerId)) return;
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (st.pinch) { const [a, b] = [...pts.values()]; zoomTo(st.zoom * Math.hypot(a.x - b.x, a.y - b.y) / st.pinch); return; }
    const g = ifGeom(), s = scale();
    if (g.rw - IF.p.w > 0.5) IF.p.fx = Math.max(0, Math.min(1, st.fx - (ev.clientX - st.x) * s / (g.rw - IF.p.w)));
    if (g.rh - IF.p.h > 0.5) IF.p.fy = Math.max(0, Math.min(1, st.fy - (ev.clientY - st.y) * s / (g.rh - IF.p.h)));
    ifDraw();
  });
  const end = (ev) => { pts.delete(ev.pointerId); if (!pts.size) st = null; else if (st?.pinch) st = null; };
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", end);
  cv.addEventListener("wheel", (ev) => { if (!IF.img || IF.p.mode !== "fill") return; ev.preventDefault(); zoomTo(IF.p.zoom * (ev.deltaY < 0 ? 1.06 : 0.94)); }, { passive: false });
}

// ───── پنل‌ها ─────
function ifPanels() {
  const p = IF.p;
  const changed = () => { ifDraw(); ifInfo(); ifPresetsUI(); };
  // جا دادن
  $("#if-fit").innerHTML = `<div class="btn-row" style="margin-top:8px"><div class="seg" id="if-mode"><button data-m="fill" class="${p.mode === "fill" ? "active" : ""}">✂️ پر کردن کادر</button><button data-m="whole" class="${p.mode === "whole" ? "active" : ""}">🖼 کل عکس</button></div>
      ${p.mode === "fill" ? `<label class="if-zoom">بزرگ‌نمایی <input type="range" id="if-zoom" min="1" max="4" step="0.01" value="${p.zoom}"></label><button class="btn sm ghost" id="if-center">↺ وسط</button>`
        : `<label>پس‌زمینه <select id="if-bg">${[["blur", "همان عکس، مات"], ["#ffffff", "سفید"], ["#000000", "سیاه"]].map(([v, l]) => `<option value="${v}" ${p.bg === v ? "selected" : ""}>${l}</option>`).join("")}${!["blur", "#ffffff", "#000000"].includes(p.bg) ? `<option value="${p.bg}" selected>رنگ انتخابی</option>` : ""}<option value="pick">رنگ دلخواه…</option></select></label>`}</div>`;
  $$("#if-mode [data-m]").forEach((b) => (b.onclick = () => { p.mode = b.dataset.m; ifPanels(); ifDraw(); ifInfo(); }));
  if ($("#if-zoom")) $("#if-zoom").oninput = (ev) => { p.zoom = Number(ev.target.value); ifDraw(); ifInfo(); };
  if ($("#if-center")) $("#if-center").onclick = () => { Object.assign(p, { fx: 0.5, fy: 0.5, zoom: 1 }); ifPanels(); ifDraw(); ifInfo(); };
  if ($("#if-bg")) $("#if-bg").onchange = (ev) => {
    if (ev.target.value !== "pick") { p.bg = ev.target.value; changed(); return; }
    const c = document.createElement("input"); c.type = "color"; c.value = /^#/.test(p.bg) ? p.bg : "#ffffff";
    c.oninput = () => { p.bg = c.value; ifDraw(); };
    c.onchange = () => { p.bg = c.value; ifPanels(); changed(); };
    c.click(); ev.target.value = p.bg;
  };
  // اندازه و کیفیت
  $("#if-size").innerHTML = `<div class="btn-row if-dims"><label>عرض<input type="number" id="if-w" min="16" max="5000" value="${p.w}"></label><span>×</span><label>ارتفاع<input type="number" id="if-h" min="16" max="5000" value="${p.h}"></label><span class="small muted">پیکسل</span></div>
    <div class="btn-row" style="margin-top:6px">${IF_SIZES.map(([w, h, l]) => `<button class="btn sm ${p.w === w && p.h === h ? "primary" : ""}" data-sz="${w}x${h}">${l} <small>${num(w)}×${num(h)}</small></button>`).join("")}</div>
    <div class="rl-grid" style="margin-top:8px"><label>کیفیت WebP <small id="if-qv">${num(p.quality)}</small><input type="range" id="if-q" min="40" max="100" value="${p.quality}"></label>
      <label>سقف حجم (کیلوبایت) <input type="number" id="if-kb" min="0" step="10" value="${p.max_kb || ""}" placeholder="بدون سقف" style="width:110px"></label></div>
    <p class="small muted" style="margin:4px 0 0">اگر سقف حجم بگذارید، کیفیت خودکار تا جایی کم می‌شود که فایل زیر آن بماند.</p>`;
  const setSize = (w, h) => { p.w = Math.max(16, Math.min(5000, Math.round(w) || 16)); p.h = Math.max(16, Math.min(5000, Math.round(h) || 16)); ifPanels(); ifDraw(); ifInfo(); };
  $("#if-w").onchange = (ev) => setSize(Number(enDigits(ev.target.value)), p.h);
  $("#if-h").onchange = (ev) => setSize(p.w, Number(enDigits(ev.target.value)));
  $$("[data-sz]").forEach((b) => (b.onclick = () => { const [w, h] = b.dataset.sz.split("x").map(Number); setSize(w, h); }));
  $("#if-q").oninput = (ev) => { p.quality = Number(ev.target.value); $("#if-qv").textContent = num(p.quality); ifPresetsUI(); };
  $("#if-kb").onchange = (ev) => { p.max_kb = Math.max(0, Number(enDigits(ev.target.value)) || 0); ifPresetsUI(); };
  // رنگ و وضوح
  const adj = [["sharpen", "شفاف‌سازی", 0, 2, 0.1], ["bright", "نور", -0.5, 0.5, 0.02], ["contrast", "کنتراست", -0.5, 0.5, 0.02], ["color", "رنگ (اشباع)", -1, 1, 0.05]];
  const pct = (k) => (k === "sharpen" ? num(+p[k].toFixed(1)) : `${p[k] > 0 ? "+" : ""}${num(Math.round(p[k] * 100))}٪`);
  $("#if-adj").innerHTML = `<div class="rl-grid">${adj.map(([k, l, a, b, s]) => `<label>${l} <small data-av="${k}">${pct(k)}</small><input type="range" data-adj="${k}" min="${a}" max="${b}" step="${s}" value="${p[k]}"></label>`).join("")}</div>
    <div class="btn-row"><button class="btn sm ghost" id="if-adj0">↺ بدون تغییر</button><span class="small muted">شفاف‌سازی فقط در فایل خروجی دیده می‌شود.</span></div>`;
  $$("[data-adj]").forEach((el) => (el.oninput = () => { p[el.dataset.adj] = Number(el.value); $(`[data-av=${el.dataset.adj}]`).textContent = pct(el.dataset.adj); ifDraw(); ifPresetsUI(); }));
  $("#if-adj0").onclick = () => { Object.assign(p, { sharpen: 0, bright: 0, contrast: 0, color: 0 }); ifPanels(); ifDraw(); };
  if (["sharpen", "bright", "contrast", "color"].some((k) => p[k])) $("#if-adj-d").open = true;
  ifPresetsUI();
}
function ifPresetsUI() {
  const box = $("#if-presets");
  if (!box) return;
  const pr = ifPreset(IF.preset), dirty = ifDirty();
  box.innerHTML = `<div class="btn-row"><select id="if-pr">${IF.cfg.presets.map((x) => `<option value="${x.id}" ${x.id === IF.preset ? "selected" : ""}>${x.id === IF.cfg.def ? "⭐ " : ""}${esc(x.name)} (${num(x.w)}×${num(x.h)})</option>`).join("")}</select>
      ${pr.id === IF.cfg.def ? `<span class="small muted">⭐ پیش‌فرض</span>` : `<button class="btn sm" id="if-def">⭐ پیش‌فرض شود</button>`}</div>
    ${dirty ? `<div class="small if-warn" style="margin-top:6px">تنظیم‌ها با قالب «${esc(pr.name)}» فرق دارد.</div>` : ""}
    <div class="btn-row" style="margin-top:6px">${dirty ? `<button class="btn sm" id="if-upd">💾 ذخیره در همین قالب</button><button class="btn sm ghost" id="if-rev">↺ برگشت به قالب</button>` : ""}
      <button class="btn sm" id="if-new">➕ قالب تازه با این تنظیم‌ها</button>${IF.cfg.presets.length > 1 ? `<button class="btn sm danger ghost" id="if-del">🗑 حذف قالب</button>` : ""}</div>
    <p class="small muted" style="margin:6px 0 0">هر عکس تازه خودکار با قالب ⭐ پیش‌فرض تنظیم می‌شود.</p>`;
  const save = async (msg) => { try { await ifSaveCfg(); toast(msg); } catch (e) { toast(e.message); } ifPresetsUI(); };
  $("#if-pr").onchange = (ev) => { const { fx, fy, zoom } = IF.p; ifUsePreset(ev.target.value); Object.assign(IF.p, { fx, fy, zoom }); ifPanels(); ifDraw(); ifInfo(); };
  if ($("#if-def")) $("#if-def").onclick = () => { IF.cfg.def = IF.preset; save(`⭐ «${pr.name}» از این به بعد پیش‌فرض است`); };
  if ($("#if-upd")) $("#if-upd").onclick = () => { Object.assign(pr, Object.fromEntries(IF_KEYS.map((k) => [k, IF.p[k]]))); save("قالب به‌روز شد ✔"); };
  if ($("#if-rev")) $("#if-rev").onclick = () => { const { fx, fy, zoom } = IF.p; ifUsePreset(IF.preset); Object.assign(IF.p, { fx, fy, zoom }); ifPanels(); ifDraw(); ifInfo(); };
  $("#if-new").onclick = () => {
    const name = (prompt("نام قالب تازه:", `${num(IF.p.w)}×${num(IF.p.h)}`) || "").trim();
    if (!name) return;
    const x = { id: `p${Date.now()}`, name, ...Object.fromEntries(IF_KEYS.map((k) => [k, IF.p[k]])) };
    IF.cfg.presets.push(x); IF.preset = x.id;
    save(`قالب «${name}» ذخیره شد ✔`);
  };
  if ($("#if-del")) $("#if-del").onclick = () => {
    if (!confirm(`قالب «${pr.name}» حذف شود؟`)) return;
    IF.cfg.presets = IF.cfg.presets.filter((x) => x.id !== pr.id);
    if (IF.cfg.def === pr.id) IF.cfg.def = IF.cfg.presets[0].id;
    IF.preset = IF.cfg.def;
    save("قالب حذف شد");
  };
}

// ───── ساخت خروجی ─────
async function ifMake() {
  if (!IF.m) return toast("اول یک عکس انتخاب کنید");
  const btn = $("#if-go");
  btn.disabled = true; btn.textContent = "در حال ساختن…";
  try {
    const res = await fetch("/api/imgfit", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ media_id: IF.m.id, ...IF.p }) });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      if (res.status === 401 && d.login) { showLogin(); return; }
      throw new Error(typeof d.detail === "string" ? d.detail : "خطای سرور؛ دوباره امتحان کنید");
    }
    const blob = await res.blob(), name = decodeURIComponent(res.headers.get("X-Filename") || "photo.webp");
    if (IF.out) URL.revokeObjectURL(IF.out.url);
    IF.out = { url: URL.createObjectURL(blob), name };
    const a = document.createElement("a"); a.href = IF.out.url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    const q = Number(res.headers.get("X-Quality")), kb = Math.round(blob.size / 1024);
    $("#if-out").innerHTML = `<div class="if-result"><img src="${IF.out.url}" alt="">
      <div><b>✔ آماده شد</b><div class="small">${esc(name)}</div><div class="small muted">${num(IF.p.w)}×${num(IF.p.h)} · ${num(kb)} کیلوبایت · کیفیت ${num(q)}${IF.p.max_kb && q < IF.p.quality ? " (برای ماندن زیر سقف حجم کم شد)" : ""}</div>
      <a class="btn sm" href="${IF.out.url}" download="${esc(name)}" style="margin-top:6px">⬇️ دانلود دوباره</a></div></div>`;
    toast("فایل WebP ساخته و دانلود شد ✔");
  } catch (e) { toast(e.message, 6000); }
  btn.disabled = false; btn.textContent = "⬇️ ساخت و دانلود WebP";
}
