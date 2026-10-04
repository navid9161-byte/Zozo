"use strict";
// ═════════════════════════ صورتحساب (فاکتور) ═════════════════════════
// پیش‌نمایش روی بوم (A4 افقی) دقیقاً همان چیزی است که در PDF می‌رود.

const INV = { W: 1754, H: 1240, logo: null, saveT: null };

const invNum = (v) => fa(Math.round(Number(v) || 0).toLocaleString("en-US").replace(/,/g, "/"));

function drawInvoice(ctx, inv) {
  const { W, H } = INV;
  const p = inv.profile || {};
  const C = p.color || "#4a72a8";
  const dark = "#2c4f80", ink = "#1b1b1b", blue = "#2f6db5";
  const m = 64;
  setup(ctx);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  // ── سربرگ (مطابق نمونه‌ی چاپی): بلوک روشن کج سمت راست با نام رسانه، نوار آبی پهن با عنوان سند
  //    (نوشته‌ی سفید با دور تیره)، نوار روشن کج پایین چپ با شماره‌ی فاکتور، باریکه‌ی آبی زیر بلوک راست
  const L0 = 52, R0 = W - 52;
  const pale = "#d5e1ef", pale2 = "#e6edf6";
  const poly = (pts, fill) => { ctx.beginPath(); pts.forEach(([x, yy], k) => (k ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy))); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };
  // نوار آبی اصلی + باریکه‌ی پایینش
  let g = ctx.createLinearGradient(L0, 0, R0, 0);
  g.addColorStop(0, C); g.addColorStop(1, dark);
  poly([[L0, 66], [1140, 66], [1180, 176], [R0, 176], [R0, 206], [596, 206], [574, 170], [L0, 170]], g);
  // بلوک روشن راست (نام رسانه)
  g = ctx.createLinearGradient(1060, 0, R0, 0);
  g.addColorStop(0, pale); g.addColorStop(1, pale2);
  poly([[1060, 40], [R0, 40], [R0, 176], [1112, 176]], g);
  // نوار روشن پایین چپ (شماره فاکتور)
  g = ctx.createLinearGradient(L0, 0, 590, 0);
  g.addColorStop(0, pale2); g.addColorStop(1, pale);
  poly([[L0, 166], [562, 166], [590, 246], [L0, 246]], g);
  // عنوان سند: سفید با دور سرمه‌ای
  ctx.font = `900 64px ${FONT}`;
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#1f3a63"; ctx.lineWidth = 7;
  const tcx = 800, tcy = 128;
  ctx.strokeText(p.doc_title || "", tcx, tcy);
  ctx.fillStyle = "#fff";
  ctx.fillText(p.doc_title || "", tcx, tcy);
  // نام رسانه یا لوگو
  const right = W - m - 40;
  const nameRight = R0 - 90;
  if (INV.logo && INV.logo.naturalWidth && p.logo_media_id) {
    const lh = 112, lw = Math.min(460, lh * INV.logo.naturalWidth / INV.logo.naturalHeight);
    ctx.drawImage(INV.logo, nameRight - lw, 52, lw, lw * INV.logo.naturalHeight / INV.logo.naturalWidth);
  } else {
    ctx.textAlign = "right"; ctx.fillStyle = "#2b4f86";
    ctx.font = `900 100px ${FONT}`;
    ctx.fillText(p.media_name || "", nameRight, 116);
    if (p.media_tagline) {
      const nw = ctx.measureText(p.media_name || "").width;
      ctx.font = `700 23px ${FONT}`; ctx.fillStyle = "#2b4f86"; ctx.textAlign = "center";
      ctx.fillText(p.media_tagline, nameRight - nw * 0.42, 54);
    }
  }
  // شماره (و در صورت انتخاب، تاریخ) در نوار روشن چپ
  ctx.direction = "rtl"; ctx.textAlign = "right"; ctx.fillStyle = "#4f6584"; ctx.font = `400 31px ${FONT}`;
  ctx.fillText(`شماره فاکتور :  ${fa(inv.number || "")}`, 500, p.show_date === "yes" && inv.date ? 194 : 208);
  if (p.show_date === "yes" && inv.date) { ctx.font = `400 25px ${FONT}`; ctx.fillText(`تاریخ :  ${fa(inv.date)}`, 500, 230); }

  // ── نام مشتری
  ctx.textAlign = "right"; ctx.fillStyle = ink; ctx.font = `900 48px ${FONT}`;
  ctx.fillText(inv.customer || "", right, 300);
  let extra = [inv.customer_code && `شناسه: ${inv.customer_code}`, inv.customer_phone && `تلفن: ${inv.customer_phone}`, inv.customer_address].filter(Boolean).join("   •   ");
  if (extra) { ctx.font = `400 24px ${FONT}`; ctx.fillStyle = "#555"; ctx.fillText(fa(extra), right, 342); }

  // ── جدول
  const tL = m + 40, tR = W - m - 40;
  const cols = [70, 0, 200, 210, 250, 250]; // ردیف، عنوان، تاریخ، تعداد، قیمت واحد، جمع
  cols[1] = tR - tL - cols.reduce((a, b) => a + b, 0);
  const xs = [tR]; // لبه‌ی راست هر ستون
  cols.forEach((w) => xs.push(xs[xs.length - 1] - w));
  let y = extra ? 368 : 346;
  const line = (x1, y1, x2, y2, w = 2) => { ctx.strokeStyle = "#333"; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  const cellText = (txt, c, yy, h, opts = {}) => {
    const x1 = xs[c + 1], x2 = xs[c];
    ctx.font = opts.font || `400 25px ${FONT}`;
    ctx.fillStyle = opts.color || ink;
    const lines = opts.wrap ? wrapText(ctx, txt, x2 - x1 - 24) : [txt];
    const lh = parseFloat((ctx.font.match(/([\d.]+)px/) || [0, 25])[1]) * 1.45;
    const startY = yy + h / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, i) => {
      if (opts.align === "right") { ctx.textAlign = "right"; ctx.fillText(l, x2 - 14, startY + i * lh); }
      else { ctx.textAlign = "center"; ctx.fillText(l, (x1 + x2) / 2, startY + i * lh); }
    });
  };
  const top = y;
  // ردیف عنوان جدول
  ctx.textAlign = "right"; ctx.font = `700 23px ${FONT}`; ctx.fillStyle = ink;
  ctx.fillText(p.table_title || "", tR - 14, y + 24);
  line(tL, y + 46, tR, y + 46, 1.5);
  y += 46;
  // سر ستون‌ها
  const unit = p.unit ? `(${p.unit})` : "";
  const heads = ["ردیف", p.col_title, p.col_date, p.col_qty, `${p.col_unit}\n${unit}`, `${p.col_total}\n${unit}`];
  const hh = 92;
  heads.forEach((h, c) => {
    const parts = String(h || "").split("\n");
    ctx.font = `700 25px ${FONT}`; ctx.fillStyle = ink;
    const x1 = xs[c + 1], x2 = xs[c];
    if (c === 0 || c === 1) { ctx.textAlign = "right"; ctx.fillText(parts[0], x2 - 14, y + hh / 2); }
    else parts.forEach((pt, i) => { ctx.textAlign = "center"; ctx.fillText(pt, (x1 + x2) / 2, y + hh / 2 + (i - (parts.length - 1) / 2) * 36); });
  });
  const headTop = y;
  y += hh;
  line(tL, y, tR, y);
  // ردیف‌های اقلام
  const rows = inv.items.length ? inv.items : [];
  const rh = 56;
  rows.forEach((it, i) => {
    const total = (it.qty || 1) * it.unit_price;
    cellText(fa(i + 1), 0, y, rh, { align: "right" });
    // عنوان بلند: اول کوچک‌تر، اگر باز جا نشد کوتاه‌شده با «…»
    let fs = 25, title = it.title;
    ctx.font = `400 ${fs}px ${FONT}`;
    while (ctx.measureText(title).width > cols[1] - 28 && fs > 19) { fs -= 1; ctx.font = `400 ${fs}px ${FONT}`; }
    while (ctx.measureText(title).width > cols[1] - 28 && title.length > 4) title = title.slice(0, -2);
    if (title !== it.title) title += "…";
    cellText(title, 1, y, rh, { align: "right", font: `400 ${fs}px ${FONT}` });
    cellText(fa(it.date || ""), 2, y, rh);
    cellText(fa(it.qty_label || (it.qty ? String(it.qty) : "")), 3, y, rh);
    cellText(invNum(it.unit_price), 4, y, rh);
    cellText(invNum(total), 5, y, rh);
    y += rh;
    line(tL, y, tR, y, 1.5);
  });
  // تخفیف و مبلغ قابل پرداخت + یادداشت مالیاتی (ادغام ستون‌های ۰ تا ۳)
  const sumTop = y;
  const dh = 56, ph = 90;
  cellText(`تخفیف ${unit}`, 4, y, dh, { font: `700 25px ${FONT}` });
  cellText(inv.discount ? invNum(inv.discount) : "—", 5, y, dh);
  line(xs[6], y + dh, xs[4], y + dh, 1.5);
  y += dh;
  const parts = [`مبلغ قابل پرداخت`, unit];
  ctx.font = `700 25px ${FONT}`; ctx.fillStyle = ink; ctx.textAlign = "center";
  parts.forEach((pt, i) => ctx.fillText(pt, (xs[4] + xs[5]) / 2, y + ph / 2 + (i - 0.5) * 36));
  cellText(invNum(inv.payable), 5, y, ph, { font: `900 27px ${FONT}` });
  y += ph;
  // یادداشت مالیاتی (آبی پررنگ) در خانه‌ی ادغام‌شده
  if (p.tax_note) {
    ctx.font = `700 29px ${FONT}`; ctx.fillStyle = blue; ctx.textAlign = "right";
    const nl = wrapText(ctx, p.tax_note, xs[0] - xs[4] - 40).slice(0, 3);
    const mid = (sumTop + y) / 2;
    nl.forEach((l, i) => ctx.fillText(l, xs[0] - 20, mid + (i - (nl.length - 1) / 2) * 46));
  }
  // خطوط جدول
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 2;
  ctx.strokeRect(tL, top, tR - tL, y - top);
  for (let c = 1; c < 6; c++) {
    const x = xs[c];
    const yEnd = c >= 4 ? y : sumTop; // ستون‌های چپ تا پایین؛ بقیه تا بالای بخش جمع
    line(x, headTop, x, yEnd, 1.5);
  }
  line(xs[4], sumTop, xs[4], y, 1.5);

  // ── اطلاعات پرداخت
  y += 64;
  const payTop = y;
  ctx.textAlign = "right"; ctx.fillStyle = ink;
  const payLines = [];
  if (p.payee) payLines.push([`خواهشمند است مبلغ فاکتور بنام ${p.payee}`, ""]);
  if (p.sheba) payLines.push(["به شماره شبا :  ", p.sheba]);
  if (p.card) payLines.push(["شماره کارت :  ", fa(p.card)]);
  if (p.bank) payLines.push([`نزد بانک ${p.bank} واریز گردد.`, ""]);
  payLines.forEach(([label, val]) => {
    ctx.font = `400 30px ${FONT}`;
    ctx.direction = "rtl"; ctx.textAlign = "right";
    ctx.fillText(label, right, y);
    if (val) {
      const lw = ctx.measureText(label).width;
      const isLatin = !/[\u0600-\u06FF]/.test(val.replace(/[۰-۹]/g, "0"));
      ctx.font = /[A-Za-z]/.test(val) ? `500 32px "Segoe UI", Arial, sans-serif` : `400 30px ${FONT}`;
      ctx.direction = isLatin ? "ltr" : "rtl";
      ctx.textAlign = isLatin ? "right" : "right";
      ctx.fillText(val, right - lw, y);
      ctx.direction = "rtl";
    }
    y += 54;
  });
  if (inv.notes) {
    ctx.font = `400 26px ${FONT}`; ctx.fillStyle = "#444";
    wrapText(ctx, inv.notes, W - 2 * m - 80).slice(0, 3).forEach((l) => { ctx.fillText(l, right, y); y += 42; });
  }

  if (["paid", "partial"].includes(inv.status) && inv.payments?.length) drawPaidStamp(ctx, inv, m + 270, payTop + 60);

  // ── پانویس (مطابق نمونه): نوار روشن با نشانی، آیکون مکان در دایره، نوار تیره‌ی تماس، گوشه‌ی آبی کج راست
  const fT = H - 196, fB = fT + 84, sB = fB + 58;
  g = ctx.createLinearGradient(L0, 0, 1460, 0);
  g.addColorStop(0, pale); g.addColorStop(1, pale2);
  poly([[L0, fT], [1462, fT], [1428, fB], [L0, fB]], g);
  g = ctx.createLinearGradient(1380, 0, R0, 0);
  g.addColorStop(0, C); g.addColorStop(1, dark);
  poly([[1478, fT + 52], [R0, fT + 52], [R0, sB], [1392, sB]], g);
  ctx.fillStyle = C;
  ctx.fillRect(158, fB, 1100 - 158, sB - fB);
  // آیکون مکان
  const ix = 1318, iy = fB - 4;
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ix, iy, 34, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#2c3e55"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(ix, iy, 34, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "#2c3e55";
  ctx.beginPath(); ctx.arc(ix, iy - 6, 12, Math.PI, 0); ctx.lineTo(ix, iy + 15); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ix, iy - 6, 4.5, 0, Math.PI * 2); ctx.fill();
  if (p.address) {
    ctx.fillStyle = "#5b6f88"; ctx.font = `500 31px ${FONT}`; ctx.textAlign = "right";
    let fs = 31;
    while (ctx.measureText(fa(p.address)).width > 1230 - L0 - 30 && fs > 20) { fs -= 1; ctx.font = `500 ${fs}px ${FONT}`; }
    ctx.fillText(fa(p.address), 1250, (fT + fB) / 2 + 2);
  }
  if (p.contact) {
    ctx.fillStyle = "#fff"; ctx.font = `700 27px ${FONT}`; ctx.textAlign = "right";
    let fs = 27;
    while (ctx.measureText(fa(p.contact)).width > 1100 - 158 - 30 && fs > 18) { fs -= 1; ctx.font = `700 ${fs}px ${FONT}`; }
    ctx.fillText(fa(p.contact), 1085, (fB + sB) / 2 + 2);
  }
}

// مهر «پرداخت شد» با تاریخ و شماره‌ی رسید آخرین پرداخت
function drawPaidStamp(ctx, inv, cx, cy) {
  const last = inv.payments[inv.payments.length - 1];
  const full = inv.status === "paid";
  const col = full ? "#1d7a3a" : "#b26a00";
  const lines = [[full ? "پرداخت شد" : "پرداخت ناقص", 52, 900], [`تاریخ: ${fa(last.date)}`, 28, 700]];
  if (last.ref_no) lines.push([`شماره رسید: ${fa(last.ref_no)}`, 28, 700]);
  if (!full) lines.push([`مانده: ${invNum(inv.remaining ?? 0)}`, 26, 700]);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.12);
  ctx.globalAlpha = 0.88;
  setup(ctx);
  let w = 0;
  lines.forEach(([t, sz, wt]) => { ctx.font = `${wt} ${sz}px ${FONT}`; w = Math.max(w, ctx.measureText(t).width); });
  w += 70;
  const h = lines.reduce((a, [, sz]) => a + sz * 1.45, 0) + 34;
  ctx.strokeStyle = col; ctx.lineWidth = 5;
  rr(ctx, -w / 2, -h / 2, w, h, 22); ctx.stroke();
  ctx.lineWidth = 2;
  rr(ctx, -w / 2 + 9, -h / 2 + 9, w - 18, h - 18, 16); ctx.stroke();
  ctx.fillStyle = col; ctx.textAlign = "center";
  let y = -h / 2 + 17;
  lines.forEach(([t, sz, wt]) => { ctx.font = `${wt} ${sz}px ${FONT}`; y += sz * 1.45; ctx.fillText(t, 0, y - sz * 0.72); });
  ctx.restore();
}

// ساخت PDF ساده (یک صفحه‌ی A4 افقی با تصویر JPEG) — بدون کتابخانه‌ی خارجی
function canvasToPdf(canvas) {
  const jpg = atob(canvas.toDataURL("image/jpeg", 0.92).split(",")[1]);
  const img = new Uint8Array(jpg.length);
  for (let i = 0; i < jpg.length; i++) img[i] = jpg.charCodeAt(i);
  const pw = 842, ph = 595;
  const enc = new TextEncoder();
  const parts = [], offsets = [];
  let len = 0;
  const push = (x) => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); len += b.length; };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n`); body(); push("\nendobj\n"); };
  obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"));
  obj(3, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  obj(4, () => { push(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`); push(img); push("\nendstream"); });
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  obj(5, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  const xref = len;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => String(offsets[n]).padStart(10, "0") + " 00000 n \n").join("")}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: "application/pdf" });
}

function loadInvLogo(p) {
  if (!p.logo_media_id) { INV.logo = null; return Promise.resolve(); }
  return new Promise((res) => { INV.logo = new Image(); INV.logo.onload = res; INV.logo.onerror = res; INV.logo.src = `/api/media/${p.logo_media_id}/file`; });
}

const PROFILE_FIELDS = [
  ["media_name", "نام رسانه (بالای فاکتور)"], ["media_tagline", "زیرنویس کوچک نام رسانه"], ["doc_title", "عنوان سند"],
  ["table_title", "عنوان جدول"], ["col_title", "ستون عنوان"], ["col_date", "ستون تاریخ"], ["col_qty", "ستون تعداد"],
  ["col_unit", "ستون قیمت واحد"], ["col_total", "ستون جمع"], ["unit", "واحد پول"], ["payee", "واریز به نام"],
  ["sheba", "شماره شبا"], ["card", "شماره کارت"], ["bank", "نام بانک"], ["address", "نشانی (پانویس)"],
  ["contact", "تماس (نوار پایین)"], ["tax_note", "یادداشت مالیاتی (آبی)", "longtext"], ["color", "رنگ اصلی", "color"],
  ["show_date", "تاریخ فاکتور زیر شماره بیاید؟", "yesno"],
];

VIEWS.invoices = async (view, params) => {
  if (params.get("id")) return renderInvoiceEditor(view, Number(params.get("id")));
  const d = await api("/api/invoices");
  const tpls = d.templates.items;
  const tf = params.get("t") || "";
  const tName = (id) => tpls.find((t) => t.id === id)?.name || "";
  const items = tf ? d.items.filter((v) => String(v.template_id || d.templates.default) === tf) : d.items;
  view.innerHTML = `
    <div class="page-title"><h2>🧾 صورتحساب‌ها</h2><div class="btn-row">
      <button class="btn primary" id="inv-new">+ صورتحساب جدید</button><button class="btn" id="inv-tpls">🗂 قالب روزنامه‌ها (${num(tpls.length)})</button></div></div>
    ${tpls.length > 1 ? `<div class="chips"><a class="chip ${!tf ? "active" : ""}" href="#invoices">همه</a>${tpls.map((t) => `<a class="chip ${tf === String(t.id) ? "active" : ""}" href="#invoices?t=${t.id}">${esc(t.name)}</a>`).join("")}</div>` : ""}
    ${invSummaryHTML(items, d.profile.unit)}
    ${!d.profile.payee && !d.profile.sheba ? `<div class="warn-bar">اول از «🗂 قالب روزنامه‌ها» برای هر روزنامه سربرگ، شبا و نشانی را ثبت کنید تا در فاکتورهایش بیاید.</div>` : ""}
    <div class="list">${items.map((v) => `<div class="item" data-inv="${v.id}"><span class="doc-icon">🧾</span><div class="body">
      <div class="title">${esc(v.customer || "بدون نام")} <small class="muted">${fa(v.number)}</small></div>
      <div class="meta"><span class="badge ${INV_BADGE[v.status] || ""}">${esc(v.status_label)}</span>
        ${tpls.length > 1 ? `<span class="badge">${esc(tName(v.template_id || d.templates.default) || v.profile.media_name || "")}</span>` : ""}
        <span>${fa(v.date || "")}</span><span><b>${invNum(v.payable)}</b> ${esc(v.profile.unit || "")}</span>
        ${v.status === "partial" ? `<span class="small">مانده: <b>${invNum(v.remaining)}</b></span>` : ""}
        ${v.status === "paid" && v.paid_date ? `<span class="small muted">پرداخت ${fa(v.paid_date)}${v.payments.at(-1)?.ref_no ? ` · رسید ${fa(v.payments.at(-1).ref_no)}` : ""}</span>` : ""}</div></div></div>`).join("") || `<div class="card empty center">هنوز صورتحسابی صادر نشده.</div>`}</div>`;
  const createWith = async (tid) => {
    const v = await api("/api/invoices", { method: "POST", body: { template_id: tid, items: [{ title: "", qty: 1, unit_price: "" }] } });
    location.hash = `#invoices?id=${v.id}`;
  };
  $("#inv-new").onclick = () => {
    if (tpls.length === 1) return createWith(tpls[0].id);
    // انتخاب روزنامه برای فاکتور تازه
    $("#dlg-body").innerHTML = `<h3>🧾 فاکتور برای کدام روزنامه؟</h3>
      <div class="tpl-pick">${tpls.map((t) => `<button class="tpl-card" data-pick="${t.id}" style="--tc:${esc(t.color || "#4a72a8")}">
        <b>${esc(t.name)}</b><small>${esc(t.media_name || "")}${t.payee ? ` · ${esc(t.payee)}` : ""}</small>${t.id === d.templates.default ? `<span class="badge">پیش‌فرض</span>` : ""}</button>`).join("")}</div>
      <div class="modal-actions"><button class="btn" id="pk-close">انصراف</button></div>`;
    $$("[data-pick]").forEach((b) => (b.onclick = () => { $("#dlg").close(); createWith(Number(b.dataset.pick)); }));
    $("#pk-close").onclick = () => $("#dlg").close();
    $("#dlg").showModal();
  };
  $("#inv-tpls").onclick = () => invTemplatesDialog();
  $$("[data-inv]", view).forEach((el) => (el.onclick = () => (location.hash = `#invoices?id=${el.dataset.inv}`)));
};

const INV_BADGE = { paid: "green", partial: "amber", issued: "", draft: "gray", cancelled: "red" };

function invSummaryHTML(items, unit) {
  const live = items.filter((v) => !["draft", "cancelled"].includes(v.status));
  if (!live.length) return "";
  const billed = live.reduce((a, v) => a + v.payable, 0), paid = live.reduce((a, v) => a + v.paid_total, 0);
  return `<div class="stats">
    <div class="stat"><div class="v">${moneyWords(billed)}</div><div class="l">جمع فاکتورهای صادرشده (${num(live.length)})</div></div>
    <div class="stat good"><div class="v">${moneyWords(paid)}</div><div class="l">وصول‌شده</div></div>
    <div class="stat warn"><div class="v">${moneyWords(billed - paid)}</div><div class="l">مانده‌ی دریافت‌نشده</div></div>
  </div>`;
}

// ثبت پرداخت: تاریخ، مبلغ، شماره‌ی رسید، روش
function invPaymentDialog(inv, onDone) {
  const methods = { card: "کارت به کارت", sheba: "واریز به شبا / پایا", pos: "کارت‌خوان", cash: "نقد", cheque: "چک", other: "سایر" };
  $("#dlg-body").innerHTML = `<h3>💳 ثبت پرداخت صورتحساب ${fa(inv.number)}</h3>
    <p class="small muted">${esc(inv.customer || "")} · قابل پرداخت ${invNum(inv.payable)} · تا حالا ${invNum(inv.paid_total)} · مانده <b>${invNum(inv.remaining)}</b> ${esc(inv.profile.unit || "")}</p>
    <div class="form-grid">
      <label>تاریخ پرداخت<input id="py-date" value="${fa(META.today)}"></label>
      <label>مبلغ (${esc(inv.profile.unit || "")})<input id="py-amount" inputmode="numeric" value="${Number(inv.remaining).toLocaleString("en-US")}"></label>
      <label>شماره رسید / پیگیری<input id="py-ref" class="ltr" placeholder="مثلاً 123456"></label>
      <label>روش پرداخت<select id="py-method">${Object.entries(methods).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
      <label class="wide">توضیح (اختیاری)<input id="py-note" placeholder="مثلاً قسط اول"></label>
    </div>
    <p class="small muted">این پرداخت خودکار به‌عنوان «دریافتی» در بخش مالی هم ثبت می‌شود.</p>
    <div class="modal-actions"><button class="btn primary" id="py-save">✔ ثبت پرداخت</button><button class="btn" id="py-close">انصراف</button></div>`;
  const amt = $("#py-amount");
  amt.oninput = () => { const v = enDigits(amt.value).replace(/[^\d]/g, ""); amt.value = v ? Number(v).toLocaleString("en-US") : ""; };
  $("#py-close").onclick = () => { $("#dlg").close(); onDone(false); };
  $("#py-save").onclick = async () => {
    try {
      await api(`/api/invoices/${inv.id}/payments`, { method: "POST", body: {
        date: enDigits($("#py-date").value), amount: enDigits(amt.value).replace(/[^\d]/g, ""),
        ref_no: enDigits($("#py-ref").value), method: $("#py-method").value, note: $("#py-note").value } });
      $("#dlg").close();
      toast("پرداخت ثبت شد و در درآمدها آمد ✔");
      onDone(true);
    } catch (err) { if (!(err instanceof LoginRequired)) toast(err.message); }
  };
  $("#dlg").showModal();
}

function profileFormHTML(p, prefix) {
  return PROFILE_FIELDS.map(([k, l, t]) => `<label class="${t === "longtext" || k === "address" || k === "contact" ? "wide" : ""}">${l}
    ${t === "longtext" ? `<textarea data-${prefix}="${k}" rows="2">${esc(p[k] || "")}</textarea>` : t === "color" ? `<input type="color" data-${prefix}="${k}" value="${esc(p[k] || "#4a72a8")}">`
    : t === "yesno" ? `<select data-${prefix}="${k}"><option value="">خیر (مثل نمونه)</option><option value="yes" ${p[k] === "yes" ? "selected" : ""}>بله</option></select>`
    : `<input data-${prefix}="${k}" value="${esc(p[k] || "")}" ${["sheba", "card"].includes(k) ? 'class="ltr"' : ""}>`}</label>`).join("")
    + `<label class="wide">لوگوی رسانه (اختیاری؛ به‌جای نام)<span class="btn-row"><label class="btn sm">🖼 انتخاب لوگو<input type="file" data-${prefix}-logo accept="image/*" hidden></label>
      ${p.logo_media_id ? `<button type="button" class="btn sm" data-${prefix}-nologo>حذف لوگو</button>` : ""}</span></label>`;
}

// ───── مدیریت قالب‌ها (هر روزنامه یک قالب جدا) ─────
async function invTemplatesDialog() {
  const d = await api("/api/invoice-templates");
  $("#dlg-body").innerHTML = `<h3>🗂 قالب روزنامه‌ها</h3>
    <p class="small muted">برای هر روزنامه یک قالب جدا بسازید: سربرگ، رنگ، لوگو، اطلاعات پرداخت، نشانی و شماره‌گذاری فاکتورها برای هر قالب جداست.</p>
    <div class="list">${d.items.map((t) => `<div class="item"><span class="sw" style="--c:${esc(t.color || "#4a72a8")};width:14px;height:40px"></span><div class="body">
      <div class="title">${esc(t.name)} ${t.id === d.default ? `<span class="badge green">پیش‌فرض</span>` : ""}</div>
      <div class="meta small">${esc(t.media_name || "")}${t.payee ? ` · واریز به ${esc(t.payee)}` : ""}</div>
      <div class="btn-row" style="margin-top:6px"><button class="btn sm" data-ed="${t.id}">✏️ ویرایش</button><button class="btn sm" data-cp="${t.id}">⧉ کپی</button>
        ${t.id !== d.default ? `<button class="btn sm" data-df="${t.id}">⭐ پیش‌فرض</button>` : ""}${d.items.length > 1 ? `<button class="btn sm danger" data-rm="${t.id}">🗑</button>` : ""}</div></div></div>`).join("")}</div>
    <div class="modal-actions"><button class="btn primary" id="tp-new">+ قالب روزنامه‌ی جدید</button><button class="btn" id="tp-close">بستن</button></div>`;
  const reopen = () => invTemplatesDialog();
  $$("[data-ed]").forEach((b) => (b.onclick = () => editInvTemplate(d.items.find((t) => t.id === Number(b.dataset.ed)))));
  $$("[data-cp]").forEach((b) => (b.onclick = async () => { const src = d.items.find((t) => t.id === Number(b.dataset.cp)); const t = await api("/api/invoice-templates", { method: "POST", body: { copy_from: src.id, name: `${src.name} (کپی)` } }); editInvTemplate(t); }));
  $$("[data-df]").forEach((b) => (b.onclick = async () => { await api(`/api/invoice-templates/${b.dataset.df}/default`, { method: "POST" }); reopen(); }));
  $$("[data-rm]").forEach((b) => (b.onclick = async () => { if (!confirm("این قالب حذف شود؟ (فاکتورهای قبلی‌اش دست نمی‌خورند)")) return; await api(`/api/invoice-templates/${b.dataset.rm}`, { method: "DELETE" }); reopen(); }));
  $("#tp-new").onclick = async () => { const t = await api("/api/invoice-templates", { method: "POST", body: { copy_from: d.default, name: "روزنامه‌ی جدید" } }); editInvTemplate(t); };
  $("#tp-close").onclick = () => { $("#dlg").close(); refresh(); };
  if (!$("#dlg").open) $("#dlg").showModal();
}

async function editInvTemplate(t) {
  await loadRefs();
  $("#dlg-body").innerHTML = `<h3>✏️ قالب «${esc(t.name)}»</h3>
    <div class="form-grid">
      <label>نام قالب (برای انتخاب)<input data-tp="name" value="${esc(t.name || "")}" placeholder="مثلاً عصر رسانه"></label>
      <label>رسانه / کارفرما در بخش مالی<select data-tp="outlet_id"><option value=""></option>${REFS.outlets.map((o) => `<option value="${o.id}" ${o.id === t.outlet_id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></label>
      ${profileFormHTML(t, "tp")}
    </div>
    <div class="modal-actions"><button class="btn primary" id="tp-save">ذخیره</button><button class="btn" id="tp-back">← قالب‌ها</button></div>`;
  const collect = () => Object.fromEntries($$("[data-tp]").map((el) => [el.dataset.tp, el.value]));
  const put = (extra = {}) => api(`/api/invoice-templates/${t.id}`, { method: "PUT", body: { ...collect(), ...extra } });
  $("[data-tp-logo]").onchange = async (ev) => {
    const r = await uploadOne("/api/media", ev.target.files[0], {}, () => {});
    if (r.ok) { editInvTemplate(await put({ logo_media_id: r.data.added[0].id })); toast("لوگو ذخیره شد"); }
  };
  if ($("[data-tp-nologo]")) $("[data-tp-nologo]").onclick = async () => editInvTemplate(await put({ logo_media_id: null }));
  $("#tp-save").onclick = async () => { await put(); toast("قالب ذخیره شد ✔"); invTemplatesDialog(); };
  $("#tp-back").onclick = () => invTemplatesDialog();
  if (!$("#dlg").open) $("#dlg").showModal();
}

async function renderInvoiceEditor(view, id) {
  const [inv, tpls] = await Promise.all([api(`/api/invoices/${id}`), api("/api/invoice-templates"), loadRefs()]);
  INV.tpls = tpls;
  await loadInvLogo(inv.profile);
  const st = inv;
  view.innerHTML = `
    <div class="page-title"><h2>🧾 صورتحساب ${fa(inv.number)}</h2><a class="btn sm" href="#invoices">→ همه</a></div>
    <div class="teaser-layout">
      <div>
        <div class="card"><h3>مشتری</h3><div class="form-grid">
          <label class="wide">نام مشتری / سازمان<input data-f="customer" value="${esc(inv.customer || "")}" placeholder="مثلاً دهیاری علی‌آباد انقلاب"></label>
          <label>شماره فاکتور<input data-f="number" value="${esc(inv.number || "")}" class="ltr"></label>
          <label>تاریخ<input data-f="date" value="${esc(inv.date || "")}"></label>
          <label>تلفن<input data-f="customer_phone" value="${esc(inv.customer_phone || "")}" class="ltr"></label>
          <label>شناسه / کد ملی / اقتصادی<input data-f="customer_code" value="${esc(inv.customer_code || "")}"></label>
          <label class="wide">نشانی<input data-f="customer_address" value="${esc(inv.customer_address || "")}"></label>
          <label>قالب (روزنامه)<select id="inv-tpl">${INV.tpls.items.map((t) => `<option value="${t.id}" ${t.id === (inv.template_id || INV.tpls.default) ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>
          <label>رسانه / کارفرما (برای گزارش مالی)<select data-f="outlet_id"><option value=""></option>${REFS.outlets.map((o) => `<option value="${o.id}" ${o.id === inv.outlet_id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></label>
          <label>وضعیت<select id="inv-status">${Object.entries({ draft: "پیش‌نویس", issued: "صادرشده", partial: "پرداخت ناقص", paid: "پرداخت‌شده", cancelled: "باطل‌شده" }).map(([k, l]) => `<option value="${k}" ${k === inv.status ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        </div></div>
        <div class="card"><h3>ردیف‌ها</h3>
          <div id="inv-items"></div>
          <button class="btn sm" id="inv-add" style="margin-top:8px">+ ردیف</button>
          <div class="form-grid" style="margin-top:12px">
            <label>تخفیف (${esc(inv.profile.unit || "")})<input data-f="discount" inputmode="numeric" value="${inv.discount ? Number(inv.discount).toLocaleString("en-US") : ""}"></label>
            <label>جمع / قابل پرداخت<input id="inv-sum" disabled></label>
            <label class="wide">یادداشت پایین فاکتور (اختیاری)<textarea data-f="notes" rows="2">${esc(inv.notes || "")}</textarea></label>
          </div>
        </div>
        <details class="card"><summary><b>سربرگ و اطلاعات پرداخت همین فاکتور</b></summary>
          <div class="form-grid" style="margin-top:10px">${profileFormHTML(inv.profile, "pr")}</div>
          <button class="btn sm" id="inv-asdefault" style="margin-top:8px">⭐ ذخیره‌ی این تغییرات در قالب «${esc(INV.tpls.items.find((t) => t.id === (inv.template_id || INV.tpls.default))?.name || "")}»</button>
        </details>
      </div>
      <div class="teaser-preview">
        <div class="card"><h3>پیش‌نمایش <small id="inv-saved" class="muted"></small></h3>
          <canvas id="inv-canvas" style="width:100%;height:auto;border:1px solid var(--line);border-radius:8px"></canvas>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn primary" id="inv-pdf">⬇️ دانلود PDF</button><button class="btn" id="inv-png">🖼 عکس</button>
            ${navigator.canShare ? `<button class="btn" id="inv-share">📤 ارسال</button>` : ""}
          </div>
          <div class="btn-row" style="margin-top:8px"><button class="btn sm" id="inv-dup">📄 کپی این فاکتور</button><button class="btn sm danger" id="inv-del">🗑 حذف</button></div>
        </div>
        <div class="card"><h3>💳 پرداخت‌ها <span class="badge ${INV_BADGE[inv.status] || ""}">${esc(inv.status_label)}</span></h3>
          <div class="stats" style="margin:0 0 10px">
            <div class="stat"><div class="v">${moneyWords(inv.payable)}</div><div class="l">قابل پرداخت</div></div>
            <div class="stat good"><div class="v">${moneyWords(inv.paid_total)}</div><div class="l">پرداخت‌شده</div></div>
            <div class="stat ${inv.remaining ? "warn" : ""}"><div class="v">${moneyWords(inv.remaining)}</div><div class="l">مانده</div></div>
          </div>
          ${inv.payments.length ? inv.payments.map((p) => `<div class="row"><span>✅ ${moneyWords(p.amount)} در تاریخ <b>${fa(p.date)}</b>
              ${p.ref_no ? ` با رسید <b class="ltr" style="display:inline-block">${fa(p.ref_no)}</b>` : ""}
              <small class="muted">${esc(({ card: "کارت به کارت", sheba: "واریز به شبا", pos: "کارت‌خوان", cash: "نقد", cheque: "چک", other: "" })[p.method] || "")}${p.note ? " · " + esc(p.note) : ""}</small></span>
              <button class="btn sm ghost" data-delpay="${p.id}" title="حذف این پرداخت">🗑</button></div>`).join("")
            : `<div class="empty small">هنوز پرداختی ثبت نشده.</div>`}
          ${inv.remaining > 0 && inv.status !== "cancelled" ? `<button class="btn primary" id="inv-pay" style="margin-top:8px">💳 ثبت پرداخت (کامل یا بخشی)</button>` : ""}
        </div>
      </div>
    </div>`;

  const items = inv.items.length ? inv.items.map((x) => ({ ...x })) : [{ title: "", date: "", qty: 1, qty_label: "", unit_price: 0 }];
  const profile = { ...inv.profile };
  const state = () => ({ ...st, items: items.map((it) => ({ ...it, unit_price: Number(it.unit_price) || 0, qty: Number(it.qty) || 0 })), profile });
  const calc = () => {
    const s = state();
    const sub = s.items.reduce((a, it) => a + (it.qty || 1) * it.unit_price, 0);
    s.discount = Number(String(st.discount || 0).replace(/,/g, "")) || 0;
    s.payable = Math.max(0, sub - s.discount);
    $("#inv-sum").value = `${invNum(sub)} / ${invNum(s.payable)}`;
    return s;
  };
  const draw = () => {
    const cv = $("#inv-canvas");
    cv.width = INV.W; cv.height = INV.H;
    drawInvoice(cv.getContext("2d"), calc());
  };
  const save = () => {
    clearTimeout(INV.saveT);
    $("#inv-saved").textContent = "در حال ذخیره…";
    INV.saveT = setTimeout(async () => {
      try {
        const s = calc();
        await api(`/api/invoices/${id}`, { method: "PATCH", body: {
          number: st.number, date: enDigits(st.date || ""), customer: st.customer, customer_phone: st.customer_phone,
          customer_code: st.customer_code, customer_address: st.customer_address, notes: st.notes,
          outlet_id: st.outlet_id || null, discount: s.discount, items: s.items, profile } });
        $("#inv-saved").textContent = "✔ ذخیره شد";
      } catch (err) { $("#inv-saved").textContent = ""; toast(err.message); }
    }, 900);
  };
  const drawItems = () => {
    $("#inv-items").innerHTML = items.map((it, i) => `<div class="card" style="padding:10px;margin-bottom:8px;background:var(--bg)">
      <div class="form-grid">
        <label class="wide">عنوان ردیف ${num(i + 1)}<input data-i="${i}" data-k="title" value="${esc(it.title || "")}" placeholder="مثلاً آگهی مناقصه (نوبت اول)"></label>
        <label>تاریخ چاپ<input data-i="${i}" data-k="date" value="${esc(it.date || "")}" placeholder="${fa(META.today)}"></label>
        <label>تعداد<input data-i="${i}" data-k="qty" inputmode="numeric" value="${esc(it.qty || "")}"></label>
        <label>نوشته‌ی ستون تعداد (اختیاری)<input data-i="${i}" data-k="qty_label" value="${esc(it.qty_label || "")}" placeholder="مثلاً ۲ کادر داخلی"></label>
        <label>قیمت واحد<input data-i="${i}" data-k="unit_price" inputmode="numeric" value="${it.unit_price ? Number(it.unit_price).toLocaleString("en-US") : ""}"></label>
      </div><button class="btn sm danger" data-rm="${i}" style="margin-top:6px">حذف ردیف</button></div>`).join("");
    $$("#inv-items [data-k]").forEach((el) => el.addEventListener("input", () => {
      const it = items[Number(el.dataset.i)];
      let v = el.value;
      if (["qty", "unit_price"].includes(el.dataset.k)) {
        v = enDigits(v).replace(/[^\d]/g, "");
        if (el.dataset.k === "unit_price") el.value = v ? Number(v).toLocaleString("en-US") : "";
        v = Number(v) || 0;
      }
      it[el.dataset.k] = v;
      draw(); save();
    }));
    $$("#inv-items [data-rm]").forEach((b) => (b.onclick = () => { items.splice(Number(b.dataset.rm), 1); drawItems(); draw(); save(); }));
  };
  drawItems();
  $$("[data-f]", view).forEach((el) => el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
    let v = el.value;
    if (el.dataset.f === "discount") { v = enDigits(v).replace(/[^\d]/g, ""); el.value = v ? Number(v).toLocaleString("en-US") : ""; }
    st[el.dataset.f] = v;
    draw(); save();
  }));
  $$("[data-pr]", view).forEach((el) => el.addEventListener("input", () => { profile[el.dataset.pr] = el.value; draw(); save(); }));
  $("[data-pr-logo]").onchange = async (ev) => {
    const r = await uploadOne("/api/media", ev.target.files[0], {}, () => {});
    if (r.ok) { profile.logo_media_id = r.data.added[0].id; await loadInvLogo(profile); draw(); save(); }
  };
  if ($("[data-pr-nologo]")) $("[data-pr-nologo]").onclick = () => { profile.logo_media_id = null; INV.logo = null; draw(); save(); };
  const payDone = (ok) => { if (ok) refresh(); else $("#inv-status").value = st.status; };
  $("#inv-status").onchange = async (ev) => {
    const v = ev.target.value;
    if (v === "paid" || v === "partial") {
      if (st.remaining > 0) return invPaymentDialog({ ...st, ...calc(), paid_total: st.paid_total, remaining: Math.max(0, calc().payable - st.paid_total) }, payDone);
    }
    if (st.payments.length && ["issued", "draft"].includes(v)) { toast("این فاکتور پرداخت ثبت‌شده دارد؛ اول پرداخت‌ها را حذف کنید."); ev.target.value = st.status; return; }
    await api(`/api/invoices/${id}`, { method: "PATCH", body: { status: v } });
    st.status = v;
    toast("وضعیت ذخیره شد");
  };
  if ($("#inv-pay")) $("#inv-pay").onclick = () => invPaymentDialog({ ...st, ...calc(), paid_total: st.paid_total, remaining: Math.max(0, calc().payable - st.paid_total) }, payDone);
  $$("[data-delpay]", view).forEach((b) => (b.onclick = async () => {
    if (!confirm("این پرداخت حذف شود؟ (دریافتیِ ثبت‌شده در بخش مالی هم پاک می‌شود)")) return;
    await api(`/api/invoices/${id}/payments/${b.dataset.delpay}`, { method: "DELETE" });
    refresh();
  }));
  $("#inv-add").onclick = () => { items.push({ title: "", date: "", qty: 1, qty_label: "", unit_price: 0 }); drawItems(); };
  $("#inv-asdefault").onclick = async () => { await api(`/api/invoice-templates/${inv.template_id || INV.tpls.default}`, { method: "PUT", body: profile }); toast("در قالب ذخیره شد ⭐"); };
  $("#inv-tpl").onchange = async (ev) => {
    if (!confirm("سربرگ و اطلاعات پرداخت این فاکتور با قالب انتخاب‌شده عوض شود؟")) { ev.target.value = inv.template_id || INV.tpls.default; return; }
    clearTimeout(INV.saveT);
    await api(`/api/invoices/${id}`, { method: "PATCH", body: { template_id: Number(ev.target.value) } });
    refresh();
  };
  const fname = () => `invoice-${(st.number || id)}`.replace(/[^\w\-]+/g, "-");
  $("#inv-pdf").onclick = async () => { await document.fonts?.ready; draw(); downloadBlob(canvasToPdf($("#inv-canvas")), `${fname()}.pdf`); };
  $("#inv-png").onclick = () => $("#inv-canvas").toBlob((b) => downloadBlob(b, `${fname()}.png`), "image/png");
  if ($("#inv-share")) $("#inv-share").onclick = async () => {
    const file = new File([canvasToPdf($("#inv-canvas"))], `${fname()}.pdf`, { type: "application/pdf" });
    if (navigator.canShare({ files: [file] })) navigator.share({ files: [file] }).catch(() => {}); else toast("در این مرورگر پشتیبانی نمی‌شود؛ دانلود کنید.");
  };
  $("#inv-dup").onclick = async () => { const v = await api(`/api/invoices/${id}/duplicate`, { method: "POST" }); toast("کپی ساخته شد"); location.hash = `#invoices?id=${v.id}`; };
  $("#inv-del").onclick = async () => { if (!confirm("این صورتحساب حذف شود؟")) return; await api(`/api/invoices/${id}`, { method: "DELETE" }); location.hash = "#invoices"; };
  if (document.fonts) document.fonts.load(`900 40px Vazirmatn`).then(draw).catch(draw);
  draw();
}
