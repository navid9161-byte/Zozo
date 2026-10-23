"use strict";
// ═════════════════════ ریلزساز، مرحله‌ی ۲ (بدنه): چند تکه، چیدمان کنار هم، گذار، حرکت عکس ═════════════════════
// بدنه = فهرست تکه‌ها (s.body). هر تکه یا یک عکس/ویدیو است (همان ساختار قدیمی s2) یا یک «چیدمان» (چند عکس/ویدیو هم‌زمان).
// s.s2 همیشه همان تکه‌ی انتخاب‌شده است تا ویرایشگرهای قبلی (برش، سرعت، اندازه، صدا) بی‌تغییر کار کنند.
// همه‌ی حساب‌ها (زمان‌ها، گذارها، پیمایش عکس، خانه‌های چیدمان) با teaser.py یکی است.

const RL_PAN_AMT = { low: 0.35, mid: 0.65, high: 0.85, full: 1 };
const RL_ZOOM_AMT = { low: 0.06, mid: 0.15, high: 0.28, full: 0.4 };
const RL_AMT_NAMES = [["low", "کم"], ["mid", "متوسط"], ["high", "زیاد"], ["full", "کامل"]];
const RL_MOTIONS = [["none", "بدون حرکت"], ["pan", "↔ پیمایش روی عکس"], ["zoom", "🔍 زوم به داخل"], ["zoomout", "🔎 زوم به بیرون"]];
const RL_TRANS = [["none", "بدون (کات)"], ["fade", "محو از سیاه"], ["flash", "فلش سفید"], ["cross", "محو درهم"], ["slide", "کشویی"]];
const RL_GRID = {
  "2v": [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]],
  "2h": [[0.5, 0, 0.5, 1], [0, 0, 0.5, 1]],
  "3t": [[0, 0, 1, 0.5], [0.5, 0.5, 0.5, 0.5], [0, 0.5, 0.5, 0.5]],
  "3b": [[0.5, 0, 0.5, 0.5], [0, 0, 0.5, 0.5], [0, 0.5, 1, 0.5]],
  "3v": [[0, 0, 1, 1 / 3], [0, 1 / 3, 1, 1 / 3], [0, 2 / 3, 1, 1 / 3]],
  "4": [[0.5, 0, 0.5, 0.5], [0, 0, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5], [0, 0.5, 0.5, 0.5]],
};
const RL_GRID_NAMES = { "2v": "دو تایی، بالا و پایین", "2h": "دو تایی، کنار هم", "3t": "یکی بالا، دو تا پایین", "3b": "دو تا بالا، یکی پایین", "3v": "سه تایی روی هم", "4": "چهار تایی" };
const RL_CELL_NAMES = { "2v": ["بالا", "پایین"], "2h": ["راست", "چپ"], "3t": ["بالا", "پایین راست", "پایین چپ"], "3b": ["بالا راست", "بالا چپ", "پایین"], "3v": ["بالا", "وسط", "پایین"], "4": ["بالا راست", "بالا چپ", "پایین راست", "پایین چپ"] };
// ناحیه‌ی چیدمان = داخل قاب قرمز
const RL_GRID_REGION = () => [SAFE.x / DW, SAFE.y / DH, SAFE.w / DW, SAFE.h / DH];

const rlEmptyClip = () => ({ media_id: null, kind: null, start: 0, dur: 6, mediaDur: 0, has_audio: false, motion: "none", scale: 1, ox: 0, oy: 0, vol: 1 });
const rlNewGrid = (layout = "2v") => ({ type: "grid", layout, dur: 5, gap: 14, gap_color: "#ffffff", cells: RL_GRID[layout].map(() => null) });
const rlIsGrid = (it) => it?.type === "grid";

// فهرست تکه‌ها؛ s.s2 و تکه‌ی انتخاب‌شده همیشه یکی‌اند
function rlBody(s = RL.s) {
  if (!Array.isArray(s.body) || !s.body.length) s.body = [s.s2 || rlEmptyClip()];
  s.bi = Math.max(0, Math.min(s.body.length - 1, Number(s.bi) || 0));
  if (s.s2) s.body[s.bi] = s.s2; else s.s2 = s.body[s.bi];
  return s.body;
}
function rlSelect(i) {
  const s = RL.s, b = rlBody(s);
  s.bi = Math.max(0, Math.min(b.length - 1, i));
  s.s2 = b[s.bi];
}
const rlCellsWith = (g) => (g.cells || []).filter((c) => c?.media_id);
function rlItemDur(it) {
  if (rlIsGrid(it)) return rlCellsWith(it).length ? Math.max(0.5, Math.min(60, Number(it.dur) || 5)) : 0;
  return it?.media_id ? Math.max(0.5, (Number(it.dur) || 1) / rlSpeed(it)) : 0;
}
const rlTrans = (s = RL.s) => ({ type: "none", dur: 0.5, ...(s.trans || {}) });
const r2 = (v) => Math.round(v * 100) / 100;
// خط زمانِ بدنه: جای هر تکه، و گذار ورود به آن (همان گردکردن و سقفِ سرور)
function rlPlan(s = RL.s) {
  const tr = rlTrans(s), items = [];
  rlBody(s).forEach((it, i) => { const d = r2(rlItemDur(it)); if (d > 0) items.push({ it, i, dur: d, at: 0, tin: null }); });
  let end = 0;
  items.forEach((p, k) => {
    if (k && tr.type !== "none") {
      const td = r2(Math.min(Math.max(0.1, Math.min(2, Number(tr.dur) || 0.5)), items[k - 1].dur * 0.45, p.dur * 0.45));
      if (td >= 0.1) p.tin = { type: tr.type, dur: td };
    }
    p.at = k ? end - (p.tin && ["cross", "slide"].includes(p.tin.type) ? p.tin.dur : 0) : 0;
    end = p.at + p.dur;
  });
  return { items, d2: r2(end) };
}
// همه‌ی فایل‌هایی که بدنه استفاده می‌کند
function rlBodyMedia(s = RL.s) {
  const ids = [];
  for (const it of rlBody(s)) {
    if (rlIsGrid(it)) rlCellsWith(it).forEach((c) => ids.push(c.media_id));
    else if (it.media_id) ids.push(it.media_id);
  }
  return ids;
}
// فایل تازه ← تکه‌ی خالیِ انتخاب‌شده، یا یک تکه‌ی تازه بعد از آن
function rlAddBodyMedia(m) {
  const s = RL.s, b = rlBody(s);
  const it = { ...rlEmptyClip(), media_id: m.id, kind: m.kind, mediaDur: m.duration || 0, has_audio: !!m.has_audio,
    dur: m.kind === "video" ? +Math.min(m.duration || 6, 60).toFixed(1) : 5 };
  if (!rlIsGrid(s.s2) && !s.s2.media_id) { Object.assign(s.s2, it); return; }
  b.splice(s.bi + 1, 0, it);
  rlSelect(s.bi + 1);
}
const rlClipSound = (c) => !!c && c.kind === "video" && !!c.has_audio && (c.sound ?? (RL.s.audio1.mode || "duck") !== "music_only");

// ───── کشیدن ─────
function rlPanGeom(iw, ih, W, H, c) {
  let k = Math.max(W / iw, H / ih) * Math.max(1, Number(c.scale) || 1), rw = iw * k, rh = ih * k;
  if (Math.max((rw - W) / W, (rh - H) / H) < 0.15) { k *= 1.15 / Math.max(rw / W, rh / H); rw = iw * k; rh = ih * k; }
  const ovx = rw - W, ovy = rh - H, amt = RL_PAN_AMT[c.mamt || "mid"];
  const cx = Math.min(Math.max(ovx / 2 - (Number(c.ox) || 0) * W, 0), ovx), cy = Math.min(Math.max(ovy / 2 - (Number(c.oy) || 0) * H, 0), ovy);
  if (ovx / W >= ovy / H) {
    let a = ovx / 2 + (amt * ovx) / 2, b = ovx / 2 - (amt * ovx) / 2;
    if (c.mrev) [a, b] = [b, a];
    return { rw, rh, axis: "x", from: [a, cy], to: [b, cy] };
  }
  let a = ovy / 2 - (amt * ovy) / 2, b = ovy / 2 + (amt * ovy) / 2;
  if (c.mrev) [a, b] = [b, a];
  return { rw, rh, axis: "y", from: [cx, a], to: [cx, b] };
}
function rlGridRects(layout, gap) {
  const [fx0, fy0, fw0, fh0] = RL_GRID_REGION(), rx = fx0 * DW, ry = fy0 * DH, rw = fw0 * DW, rh = fh0 * DH, e = 1e-6;
  return RL_GRID[layout].map(([fx, fy, fw, fh]) => {
    const x0 = rx + fx * rw + (fx < e ? gap : gap / 2), y0 = ry + fy * rh + (fy < e ? gap : gap / 2);
    const x1 = rx + (fx + fw) * rw - (fx + fw > 1 - e ? gap : gap / 2), y1 = ry + (fy + fh) * rh - (fy + fh > 1 - e ? gap : gap / 2);
    return { x: x0, y: y0, w: Math.max(2, x1 - x0), h: Math.max(2, y1 - y0) };
  });
}
// یک عکس/ویدیو با حالت «پر کردن» داخل یک خانه (همان حساب crop سرور)
function rlDrawCover(ctx, el, r, c) {
  const sw = el.videoWidth || el.naturalWidth, sh = el.videoHeight || el.naturalHeight;
  if (!sw || !sh) return;
  const k = Math.max(r.w / sw, r.h / sh) * Math.max(1, Number(c.scale) || 1), dw = sw * k, dh = sh * k;
  const cxp = Math.max(0, Math.min(dw - r.w, (dw - r.w) / 2 - (Number(c.ox) || 0) * r.w));
  const cyp = Math.max(0, Math.min(dh - r.h, (dh - r.h) / 2 - (Number(c.oy) || 0) * r.h));
  ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
  ctx.drawImage(el, r.x - cxp, r.y - cyp, dw, dh);
  ctx.restore();
}
function rlSeek(el, want) { if (!RL.playing && el.readyState >= 1 && Math.abs(el.currentTime - want) > 0.15) el.currentTime = want; }
// یک تکه‌ی بدنه در لحظه‌ی «lt» از آغاز همان تکه
function rlDrawItem(ctx, it, lt, dur) {
  if (rlIsGrid(it)) {
    const rects = rlGridRects(it.layout, Number(it.gap) || 0);
    const [fx, fy, fw, fh] = RL_GRID_REGION();
    ctx.fillStyle = it.gap_color || "#ffffff"; ctx.fillRect(fx * DW, fy * DH, fw * DW, fh * DH);
    (it.cells || []).forEach((c, i) => {
      const r = rects[i];
      if (!r) return;
      if (!c?.media_id) { ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(r.x, r.y, r.w, r.h); ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = `700 40px ${fontStack("Vazirmatn")}`; ctx.fillText(`خانه‌ی ${num(i + 1)}`, r.x + r.w / 2, r.y + r.h / 2); return; }
      const el = rlEl(c.media_id, c.kind);
      if (c.kind === "video") { rlSeek(el, Math.min((Number(c.start) || 0) + lt, Math.max(0, (c.mediaDur || 1) - 0.05))); if (el.readyState >= 2) rlDrawCover(ctx, el, r, c); }
      else if (el.naturalWidth) rlDrawCover(ctx, el, r, c);
    });
    return;
  }
  const el = rlEl(it.media_id, it.kind);
  if (!el) return;
  if (it.kind === "video") {
    rlSeek(el, (Number(it.start) || 0) + lt * rlSpeed(it));
    if (el.readyState >= 2) rlMedia(ctx, el, it, {});
    return;
  }
  if (!el.naturalWidth) return;
  const p = Math.max(0, Math.min(1, lt / Math.max(0.01, dur)));
  if (it.motion === "pan") {
    const g = rlPanGeom(el.naturalWidth, el.naturalHeight, DW, DH, it);
    const x = g.from[0] + (g.to[0] - g.from[0]) * p, y = g.from[1] + (g.to[1] - g.from[1]) * p;
    ctx.save();
    ctx.filter = [it.gray ? "grayscale(1)" : "", it.bright ? `brightness(${1 + Number(it.bright)})` : ""].filter(Boolean).join(" ") || "none";
    ctx.drawImage(el, -x, -y, g.rw, g.rh);
    ctx.restore();
    return;
  }
  const za = it.mamt ? RL_ZOOM_AMT[it.mamt] : 0.08;
  rlMedia(ctx, el, it, { zoom: it.motion === "zoom" ? 1 + za * p : it.motion === "zoomout" ? 1 + za - za * p : 1 });
}
// بدنه در لحظه‌ی «lt»: تکه‌ی فعال، و هنگام گذار هر دو تکه
function rlDrawBody(ctx, lt) {
  const plan = rlPlan();
  if (!plan.items.length) return;
  let act = plan.items.filter((p) => lt >= p.at && lt < p.at + p.dur);
  if (!act.length) act = [lt < 0 ? plan.items[0] : plan.items[plan.items.length - 1]];
  act = act.slice(-2);
  const inc = act.length === 2 ? act[1] : null, q = inc?.tin ? Math.min(1, (lt - inc.at) / inc.tin.dur) : 1;
  act.forEach((p, j) => {
    ctx.save();
    if (inc?.tin?.type === "slide") ctx.translate(j === 0 ? DW * q : -DW * (1 - q), 0);
    if (j === 1 && inc?.tin?.type === "cross") ctx.globalAlpha = q;
    rlDrawItem(ctx, p.it, lt - p.at, p.dur);
    ctx.restore();
  });
  // محو از/به سیاه یا سفید
  const cur = act[act.length - 1], k = plan.items.indexOf(cur), next = plan.items[k + 1];
  let dip = null;
  if (cur.tin && ["fade", "flash"].includes(cur.tin.type) && lt - cur.at < cur.tin.dur / 2) dip = [cur.tin.type, 1 - (lt - cur.at) / (cur.tin.dur / 2)];
  if (next?.tin && ["fade", "flash"].includes(next.tin.type) && cur.at + cur.dur - lt < next.tin.dur / 2) dip = [next.tin.type, 1 - (cur.at + cur.dur - lt) / (next.tin.dur / 2)];
  if (dip) { ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, dip[1])); ctx.fillStyle = dip[0] === "flash" ? "#fff" : "#000"; ctx.fillRect(0, 0, DW, DH); ctx.restore(); }
}

// ───── پخش ─────
// همه‌ی ویدیوهای بدنه با زمان شروع و پایانشان روی خط زمان ریلز
function rlPlayers() {
  const tl = reelTL(), out = [];
  for (const p of rlPlan().items) {
    const it = p.it;
    if (rlIsGrid(it)) {
      for (const c of rlCellsWith(it)) if (c.kind === "video")
        out.push({ el: rlEl(c.media_id, "video"), at: tl.d1 + p.at, dur: Math.min(p.dur, Math.max(0.1, (c.mediaDur || p.dur) - (Number(c.start) || 0))), src: Number(c.start) || 0, speed: 1, sound: rlClipSound(c), vol: Number(c.vol ?? 1) });
    } else if (it.kind === "video") {
      out.push({ el: rlEl(it.media_id, "video"), at: tl.d1 + p.at, dur: p.dur, src: Number(it.start) || 0, speed: rlSpeed(it), sound: rlClipSound(it), vol: Number(it.vol ?? 1) });
    }
  }
  return out;
}
function rlPlayersTick(players, t) {
  for (const p of players) if (p.on && !(t >= p.at && t < p.at + p.dur)) { p.el.pause(); p.on = false; }
  for (const p of players) {
    if (p.on || !(t >= p.at && t < p.at + p.dur)) continue;
    p.el.currentTime = p.src + (t - p.at) * p.speed; p.el.playbackRate = p.speed;
    p.el.muted = !p.sound; p.el.volume = Math.min(1, p.vol); p.el.dataset.label = "ویدیوی بدنه";
    rlPlayEl(p.el); p.on = true;
  }
}

// ───── ساخت ─────
function rlBodyClips() {
  const out = [];
  for (const p of rlPlan().items) {
    const it = p.it, tin = p.tin ? { type: p.tin.type, dur: rlTrans().dur } : null;
    if (rlIsGrid(it)) {
      out.push({ grid: { layout: it.layout, duration: p.dur, gap: Number(it.gap) || 0, gap_color: it.gap_color || "#ffffff", region: RL_GRID_REGION(),
        cells: (it.cells || []).map((c) => (c?.media_id ? { media_id: c.media_id, start: c.start || 0, scale: c.scale || 1, ox: c.ox || 0, oy: c.oy || 0, mute: !rlClipSound(c), vol: Number(c.vol ?? 1) } : null)) }, tin });
    } else {
      out.push({ media_id: it.media_id, start: it.start || 0, duration: p.dur, speed: rlSpeed(it), scale: it.scale, ox: it.ox, oy: it.oy,
        motion: it.motion, mamt: it.mamt || null, mrev: !!it.mrev, zoom: it.motion === "zoom", gray: !!it.gray, bright: Number(it.bright) || 0,
        mute: !rlClipSound(it), vol: Number(it.vol ?? 1), tin });
    }
  }
  return out;
}

// ───── رابط کاربری ─────
function rlThumb(it) {
  const c = rlIsGrid(it) ? rlCellsWith(it)[0] : it;
  return c?.media_id ? `<img src="/api/media/${c.media_id}/thumb" alt="" loading="lazy" onerror="this.remove()">` : "";
}
function rlGridIcon(layout) {
  return `<span class="rl-gi">${RL_GRID[layout].map(([x, y, w, h]) => `<i style="right:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%"></i>`).join("")}</span>`;
}
function rlItemsHTML() {
  const s = RL.s, b = rlBody(s), plan = rlPlan(), tr = rlTrans();
  const dOf = (i) => plan.items.find((p) => p.i === i)?.dur || 0;
  return `<div class="card"><h3>🎞 تکه‌های بدنه <small class="muted">(${num(b.length)} تکه · ${num(plan.d2.toFixed(1))} ثانیه)</small></h3>
    <div class="rl-items">${b.map((it, i) => `<div class="rl-it ${i === s.bi ? "on" : ""}" data-it="${i}">
        <div class="rl-it-th">${rlIsGrid(it) ? rlGridIcon(it.layout) : rlThumb(it) || "<span>➕</span>"}<b>${num(i + 1)}</b></div>
        <div class="small">${rlIsGrid(it) ? "چند تصویر" : it.kind === "video" ? "ویدیو" : it.media_id ? "عکس" : "خالی"} · ${num(dOf(i).toFixed(1))} ث</div>
        ${b.length > 1 ? `<div class="rl-it-b"><button class="btn sm ghost" data-mv="${i}:-1" title="جلوتر" ${i ? "" : "disabled"}>→</button><button class="btn sm ghost" data-mv="${i}:1" title="عقب‌تر" ${i < b.length - 1 ? "" : "disabled"}>←</button><button class="btn sm ghost" data-del="${i}" title="حذف این تکه">🗑</button></div>` : ""}
      </div>`).join("")}</div>
    <div class="btn-row" style="margin-top:8px"><button class="btn" id="rl-add-clip">➕ عکس یا ویدیوی دیگر</button><button class="btn" id="rl-add-grid">🔲 چند تصویر کنار هم</button></div>
    ${b.length > 1 ? `<div class="rl-grid" style="margin-top:8px"><label>جدا شدن تکه‌ها از هم<select id="rl-tr">${RL_TRANS.map(([v, l]) => `<option value="${v}" ${tr.type === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      ${tr.type !== "none" ? `<label>مدت گذار <small>${num((+tr.dur).toFixed(1))} ث</small><input type="range" id="rl-trd" min="0.2" max="1.5" step="0.1" value="${tr.dur}"></label>` : ""}</div>` : ""}
    <p class="small muted" style="margin:4px 0 0">روی هر تکه بزنید تا تنظیم‌هایش پایین بیاید. تکه‌ها به همین ترتیب (از راست) پشت سر هم پخش می‌شوند.</p></div>`;
}
function rlBindItems(box, upd) {
  const s = RL.s;
  const go = (i) => { rlSelect(i); const p = rlPlan().items.find((x) => x.i === i); if (p) RL.t = reelTL().d1 + p.at + Math.min(0.3, p.dur / 2); upd(); rlPanel(); };
  $$("[data-it]", box).forEach((el) => (el.onclick = (ev) => { if (ev.target.closest("button")) return; go(Number(el.dataset.it)); }));
  $$("[data-mv]", box).forEach((b) => (b.onclick = () => {
    const [i, d] = b.dataset.mv.split(":").map(Number), body = rlBody(s), j = i + d;
    if (j < 0 || j >= body.length) return;
    [body[i], body[j]] = [body[j], body[i]];
    s.bi = body.indexOf(s.s2); s.caps.manual = [];
    upd(); rlPanel();
  }));
  $$("[data-del]", box).forEach((b) => (b.onclick = () => {
    const i = Number(b.dataset.del), body = rlBody(s);
    if (!confirm(`تکه‌ی ${num(i + 1)} حذف شود؟`)) return;
    body.splice(i, 1);
    s.bi = Math.min(s.bi > i ? s.bi - 1 : s.bi, body.length - 1); s.s2 = body[s.bi]; s.caps.manual = [];
    upd(); rlPanel();
  }));
  const add = (it) => { const body = rlBody(s); body.splice(s.bi + 1, 0, it); go(s.bi + 1); };
  const ac = $("#rl-add-clip", box); if (ac) ac.onclick = () => add(rlEmptyClip());
  const ag = $("#rl-add-grid", box); if (ag) ag.onclick = () => add(rlNewGrid("2v"));
  const tr = $("#rl-tr", box); if (tr) tr.onchange = () => { s.trans = { ...rlTrans(), type: tr.value }; s.caps.manual = []; upd(); rlPanel(); };
  const trd = $("#rl-trd", box);
  if (trd) {
    trd.oninput = () => { s.trans = { ...rlTrans(), dur: Number(trd.value) }; trd.parentElement.querySelector("small").textContent = `${num((+trd.value).toFixed(1))} ث`; reelDraw(); };
    trd.onchange = () => { s.caps.manual = []; upd(); rlPanel(); };
  }
}

// حرکت عکس: نوع، مقدار، جهت
function rlMotionHTML(c) {
  const m = RL.media.find((x) => x.id === c.media_id), mo = c.motion || "none";
  const axis = m?.width && m?.height ? rlPanGeom(m.width, m.height, DW, DH, c).axis : "x";
  const dirs = axis === "x" ? ["از راست به چپ", "از چپ به راست"] : ["از بالا به پایین", "از پایین به بالا"];
  const fit = c.mamt === "full" && mo === "pan";
  return `<label>حرکت آرام<select data-c="motion">${RL_MOTIONS.map(([v, l]) => `<option value="${v}" ${mo === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    ${mo !== "none" ? `<label>مقدار حرکت<select data-cm="mamt">${RL_AMT_NAMES.map(([v, l]) => `<option value="${v}" ${(c.mamt || "mid") === v ? "selected" : ""}>${v === "full" && mo === "pan" ? "کامل: کل عکس در همین مدت" : l}</option>`).join("")}</select></label>` : ""}
    ${mo === "pan" ? `<label>جهت<select data-cm="mrev"><option value="0" ${c.mrev ? "" : "selected"}>${dirs[0]}</option><option value="1" ${c.mrev ? "selected" : ""}>${dirs[1]}</option></select></label>` : ""}
    ${mo !== "none" ? `<p class="small muted wide" style="margin:0">${mo === "pan" ? (fit ? "✔ از یک سرِ عکس تا سرِ دیگرش دقیقاً در همین مدت پیموده می‌شود؛ مدت را بلندتر کنید تا آرام‌تر شود." : "هرچه مقدار بیشتر باشد، بخش بیشتری از عکس دیده می‌شود و حرکت تندتر است. «کامل» = کل عکس.") : "هرچه مقدار بیشتر، زوم بیشتر و تندتر."}</p>` : ""}`;
}
function rlDurFromAudio(c) {
  const a = RL.s.audio2;
  if (!a?.media_id) return "";
  const m = RL.media.find((x) => x.id === a.media_id);
  const d = m?.duration ? Math.max(0.5, m.duration - (Number(a.src) || 0)) : 0;
  return d ? `<button class="btn sm" data-c-durfrom="${d.toFixed(1)}" title="مدت این عکس = طول صدای جداگانه‌ی این بخش">⏱ هم‌اندازه‌ی صدا (${num(d.toFixed(1))} ث)</button>` : "";
}

// چیدمان چندتایی
function rlGridHTML(g) {
  const names = RL_CELL_NAMES[g.layout];
  return `<div class="card"><h3>🔲 تکه‌ی ${num(RL.s.bi + 1)}: چند تصویر کنار هم</h3>
    <div class="rl-layouts">${Object.keys(RL_GRID).map((k) => `<button class="rl-lay ${g.layout === k ? "on" : ""}" data-lay="${k}" title="${RL_GRID_NAMES[k]}">${rlGridIcon(k)}</button>`).join("")}</div>
    <div class="small muted" style="margin:4px 0 8px">${RL_GRID_NAMES[g.layout]}</div>
    <div class="rl-cells">${(g.cells || []).map((c, i) => `<div class="rl-cell">
      <b class="small">خانه‌ی ${num(i + 1)} <span class="muted">(${names[i]})</span></b>
      ${c?.media_id ? `<div class="rl-cell-m">${rlThumb(c)}<span class="small">${esc(RL.media.find((m) => m.id === c.media_id)?.filename || "")}</span></div>
        <label class="small">اندازه <input type="range" min="1" max="3" step="0.02" data-cell="${i}:scale" value="${c.scale || 1}"></label>
        ${c.kind === "video" ? `<label class="small">از ثانیه <input type="number" min="0" step="0.1" data-cell="${i}:start" value="${c.start || 0}" style="width:70px"></label>
          ${c.has_audio ? `<label class="small"><input type="checkbox" data-cell="${i}:sound" ${rlClipSound(c) ? "checked" : ""}> صدای همین ویدیو</label>` : ""}` : ""}` : ""}
      <div class="btn-row"><button class="btn sm ${c?.media_id ? "" : "primary"}" data-cup="${i}">${c?.media_id ? "🔁 عوض کردن" : "⬆️ عکس یا ویدیو"}</button>${rlMediaSelect(["video", "image"], c?.media_id || null, `data-clib="${i}"`)}
        ${c?.media_id ? `<button class="btn sm ghost" data-cx="${i}">🗑</button>` : ""}</div></div>`).join("")}</div>
    <div class="rl-grid" style="margin-top:8px">
      <label>مدت (ثانیه)<input type="number" min="0.5" max="60" step="0.5" data-g="dur" value="${g.dur}"></label>
      <label>فاصله‌ی بین خانه‌ها <small>${num(g.gap)}</small><input type="range" min="0" max="60" step="1" data-g="gap" value="${g.gap}"></label>
      <label>رنگ فاصله<input type="color" data-g="gap_color" value="${g.gap_color || "#ffffff"}"></label>
      ${rlDurFromAudio(g)}
    </div>
    <p class="small muted" style="margin:4px 0 0">👆 عکس هر خانه را روی پیش‌نمایش با انگشت بکشید تا جابه‌جا شود؛ با «اندازه» بزرگ‌ترش کنید. ویدیوهای کوتاه‌تر از مدت، روی آخرین تصویرشان می‌ایستند.</p></div>`;
}
function rlBindGrid(box, upd) {
  const g = RL.s.s2;
  if (!rlIsGrid(g)) return;
  const setCell = (i, m) => {
    g.cells[i] = m ? { media_id: m.id, kind: m.kind, mediaDur: m.duration || 0, has_audio: !!m.has_audio, start: 0, scale: 1, ox: 0, oy: 0, vol: 1 } : null;
    if (m?.kind === "video" && rlCellsWith(g).length === 1) g.dur = +Math.min(60, Math.max(1, m.duration || 5)).toFixed(1);
    RL.s.caps.manual = [];
    upd(); rlPanel();
  };
  $$("[data-lay]", box).forEach((b) => (b.onclick = () => {
    const n = RL_GRID[b.dataset.lay].length;
    g.layout = b.dataset.lay;
    g.cells = [...(g.cells || []), null, null, null, null].slice(0, n);
    upd(); rlPanel();
  }));
  $$("[data-cup]", box).forEach((b) => (b.onclick = () => rlUpload("video/*,image/*", (m) => setCell(Number(b.dataset.cup), m))));
  $$("[data-clib]", box).forEach((el) => (el.onchange = () => setCell(Number(el.dataset.clib), RL.media.find((x) => x.id === Number(el.value)) || null)));
  $$("[data-cx]", box).forEach((b) => (b.onclick = () => setCell(Number(b.dataset.cx), null)));
  $$("[data-cell]", box).forEach((el) => el.addEventListener(el.type === "checkbox" ? "change" : "input", () => {
    const [i, k] = el.dataset.cell.split(":"), c = g.cells[Number(i)];
    if (!c) return;
    if (k === "sound") c.sound = el.checked;
    else if (k === "start") c.start = Math.max(0, Math.min((c.mediaDur || 0) - 0.3, Number(enDigits(el.value)) || 0));
    else c[k] = Number(el.value);
    reelDraw(); clearTimeout(RL.cellT); RL.cellT = setTimeout(reelSave, 300);
  }));
  $$("[data-g]", box).forEach((el) => el.addEventListener("input", () => {
    const k = el.dataset.g;
    if (k === "gap_color") g.gap_color = el.value;
    else if (k === "gap") { g.gap = Number(el.value); el.parentElement.querySelector("small").textContent = num(g.gap); }
    else { g.dur = Math.max(0.5, Math.min(60, Number(enDigits(el.value)) || 5)); RL.s.caps.manual = []; }
    upd();
  }));
  $$("[data-c-durfrom]", box).forEach((b) => (b.onclick = () => { g.dur = Number(b.dataset.cDurfrom); RL.s.caps.manual = []; upd(); rlPanel(); }));
}
// خانه‌ی زیر انگشت در چیدمانِ همین لحظه (برای کشیدن عکس داخل خانه)
function rlCellAt(p) {
  const tl = reelTL(), lt = RL.t - tl.d1;
  if (RL.t < tl.d1 || RL.t >= tl.outro) return null;
  const cur = rlPlan().items.filter((x) => lt >= x.at && lt < x.at + x.dur).pop();
  if (!cur || !rlIsGrid(cur.it)) return null;
  const rects = rlGridRects(cur.it.layout, Number(cur.it.gap) || 0);
  const i = rects.findIndex((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
  return i >= 0 && cur.it.cells[i]?.media_id ? { c: cur.it.cells[i], r: rects[i] } : { none: true };
}
// تکه‌ی عکس/ویدیوی همین لحظه (برای کشیدن روی پیش‌نمایش)
function rlClipAtNow() {
  const tl = reelTL(), lt = RL.t - tl.d1;
  const cur = rlPlan().items.filter((x) => lt >= x.at && lt < x.at + x.dur).pop();
  return cur && !rlIsGrid(cur.it) ? cur.it : null;
}
// نوار تصاویر زیر نوار زمانی زیرنویس‌ها، برای بدنه‌ی چندتکه
function rlCtlStripMulti(cv, plan) {
  const W = 800, H = 56, ctx = cv.getContext("2d");
  cv.width = W; cv.height = H;
  ctx.fillStyle = "#222"; ctx.fillRect(0, 0, W, H);
  RL.thumbs = RL.thumbs || {};
  for (const p of plan.items) {
    const c = rlIsGrid(p.it) ? rlCellsWith(p.it)[0] : p.it;
    const x0 = (p.at / plan.d2) * W, x1 = ((p.at + p.dur) / plan.d2) * W;
    const draw = (im) => {
      const sc = Math.max((x1 - x0) / im.naturalWidth, H / im.naturalHeight), dw = im.naturalWidth * sc, dh = im.naturalHeight * sc;
      ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, x1 - x0 - 2, H); ctx.clip(); ctx.drawImage(im, x0 + (x1 - x0 - dw) / 2, (H - dh) / 2, dw, dh); ctx.restore();
    };
    if (!c?.media_id) continue;
    let im = RL.thumbs[c.media_id];
    if (!im) { im = new Image(); im.src = `/api/media/${c.media_id}/thumb`; RL.thumbs[c.media_id] = im; }
    if (im.complete && im.naturalWidth) draw(im); else im.addEventListener("load", () => draw(im), { once: true });
  }
}
