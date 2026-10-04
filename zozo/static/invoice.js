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

  // ── سربرگ: نوار روشن، نوار تیره‌ی کج زیر عنوان، نام رسانه، شماره فاکتور
  const hTop = 56, hBot = 176;
  let g = ctx.createLinearGradient(0, hTop, 0, hBot);
  g.addColorStop(0, "#e3ebf6"); g.addColorStop(1, "#c9d8ec");
  ctx.fillStyle = g;
  rr(ctx, m, hTop, W - 2 * m, hBot - hTop, 14);
  ctx.fill();
  ctx.fillStyle = C;
  ctx.beginPath();
  ctx.moveTo(m, hBot - 6); ctx.lineTo(W - m, hBot - 6); ctx.lineTo(W - m, hBot + 26); ctx.lineTo(m + 30, hBot + 26); ctx.closePath();
  ctx.fill();
  // نوار تیره‌ی پشت عنوان (متوازی‌الاضلاع)
  const tx1 = W * 0.27, tx2 = W * 0.6;
  g = ctx.createLinearGradient(tx1, 0, tx2, 0);
  g.addColorStop(0, C); g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(tx1 + 40, hTop + 6); ctx.lineTo(tx2 + 40, hTop + 6); ctx.lineTo(tx2, hBot - 6); ctx.lineTo(tx1, hBot - 6); ctx.closePath();
  ctx.fill();
  // عنوان سند در قرص روشن
  ctx.font = `900 54px ${FONT}`;
  const tw = ctx.measureText(p.doc_title || "").width + 70;
  const tcx = (tx1 + tx2) / 2 + 20;
  ctx.fillStyle = "rgba(255,255,255,.88)";
  rr(ctx, tcx - tw / 2, hTop + 22, tw, hBot - hTop - 56, 40);
  ctx.fill();
  ctx.fillStyle = C; ctx.textAlign = "center";
  ctx.fillText(p.doc_title || "", tcx, (hTop + hBot) / 2 - 8);
  // نام رسانه یا لوگو
  const right = W - m - 40;
  if (INV.logo && INV.logo.naturalWidth && p.logo_media_id) {
    const lh = 100, lw = Math.min(460, lh * INV.logo.naturalWidth / INV.logo.naturalHeight);
    ctx.drawImage(INV.logo, right - lw, hTop + 10, lw, lw * INV.logo.naturalHeight / INV.logo.naturalWidth);
  } else {
    ctx.textAlign = "right"; ctx.fillStyle = "#2a5a97";
    ctx.font = `900 84px ${FONT}`;
    ctx.fillText(p.media_name || "", right, (hTop + hBot) / 2 + 6);
    if (p.media_tagline) { ctx.font = `700 22px ${FONT}`; ctx.fillStyle = C; ctx.fillText(p.media_tagline, right - 30, hTop + 20); }
  }
  // شماره و تاریخ
  ctx.textAlign = "left"; ctx.fillStyle = C; ctx.font = `700 32px ${FONT}`;
  ctx.direction = "rtl";
  const numText = `شماره فاکتور :  ${fa(inv.number || "")}`;
  ctx.textAlign = "right";
  const numW = ctx.measureText(numText).width;
  ctx.fillText(numText, m + 40 + numW, (hTop + hBot) / 2 - (inv.date ? 16 : 0));
  if (inv.date) { ctx.font = `700 26px ${FONT}`; ctx.fillText(`تاریخ :  ${fa(inv.date)}`, m + 40 + numW, (hTop + hBot) / 2 + 26); }

  // ── نام مشتری
  ctx.textAlign = "right"; ctx.fillStyle = ink; ctx.font = `900 48px ${FONT}`;
  ctx.fillText(inv.customer || "", right, 268);
  let extra = [inv.customer_code && `شناسه: ${inv.customer_code}`, inv.customer_phone && `تلفن: ${inv.customer_phone}`, inv.customer_address].filter(Boolean).join("   •   ");
  if (extra) { ctx.font = `400 24px ${FONT}`; ctx.fillStyle = "#555"; ctx.fillText(fa(extra), right, 310); }

  // ── جدول
  const tL = m + 40, tR = W - m - 40;
  const cols = [70, 0, 200, 210, 250, 250]; // ردیف، عنوان، تاریخ، تعداد، قیمت واحد، جمع
  cols[1] = tR - tL - cols.reduce((a, b) => a + b, 0);
  const xs = [tR]; // لبه‌ی راست هر ستون
  cols.forEach((w) => xs.push(xs[xs.length - 1] - w));
  let y = extra ? 340 : 316;
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
  ctx.fillStyle = "#eeeeee"; ctx.fillRect(tL, y, tR - tL, 50);
  ctx.textAlign = "right"; ctx.font = `700 24px ${FONT}`; ctx.fillStyle = ink;
  ctx.fillText(p.table_title || "", tR - 14, y + 26);
  line(tL, y + 50, tR, y + 50);
  y += 50;
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
  ctx.lineWidth = 2.5;
  ctx.strokeRect(tL, top, tR - tL, y - top);
  for (let c = 1; c < 6; c++) {
    const x = xs[c];
    const yEnd = c >= 4 ? y : sumTop; // ستون‌های چپ تا پایین؛ بقیه تا بالای بخش جمع
    line(x, headTop, x, yEnd, 1.5);
  }
  line(xs[4], sumTop, xs[4], y, 1.5);

  // ── اطلاعات پرداخت
  y += 64;
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

  // ── پانویس: نشانی و تماس
  const fTop = H - 168, fMid = H - 98, fBot = H - 54;
  g = ctx.createLinearGradient(0, fTop, 0, fMid);
  g.addColorStop(0, "#dfe8f4"); g.addColorStop(1, "#c7d6ea");
  ctx.fillStyle = g;
  rr(ctx, m, fTop, W - 2 * m, fMid - fTop, 10);
  ctx.fill();
  ctx.fillStyle = C;
  ctx.fillRect(m, fMid, W - 2 * m - 220, fBot - fMid);
  // آیکون مکان
  const ix = W - m - 90, iy = (fTop + fMid) / 2;
  ctx.strokeStyle = dark; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(ix, iy, 28, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.arc(ix, iy - 5, 11, Math.PI, 0); ctx.lineTo(ix, iy + 14); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ix, iy - 5, 4, 0, Math.PI * 2); ctx.fill();
  if (p.address) { ctx.fillStyle = C; ctx.font = `700 30px ${FONT}`; ctx.textAlign = "right"; ctx.fillText(fa(p.address), ix - 50, iy + 2); }
  if (p.contact) { ctx.fillStyle = "#fff"; ctx.font = `700 24px ${FONT}`; ctx.textAlign = "right"; ctx.fillText(fa(p.contact), W - m - 240, (fMid + fBot) / 2 + 2); }
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
];

VIEWS.invoices = async (view, params) => {
  if (params.get("id")) return renderInvoiceEditor(view, Number(params.get("id")));
  const d = await api("/api/invoices");
  view.innerHTML = `
    <div class="page-title"><h2>🧾 صورتحساب‌ها</h2><div class="btn-row">
      <button class="btn primary" id="inv-new">+ صورتحساب جدید</button><button class="btn" id="inv-prof">⚙️ سربرگ و اطلاعات پرداخت</button></div></div>
    ${!d.profile.payee && !d.profile.sheba ? `<div class="warn-bar">اول از «⚙️ سربرگ و اطلاعات پرداخت» نام، شبا و نشانی را ثبت کنید تا در همه‌ی فاکتورها بیاید.</div>` : ""}
    <div class="list">${d.items.map((v) => `<div class="item" data-inv="${v.id}"><span class="doc-icon">🧾</span><div class="body">
      <div class="title">${esc(v.customer || "بدون نام")} <small class="muted">${fa(v.number)}</small></div>
      <div class="meta"><span class="badge ${{ paid: "green", issued: "", draft: "gray", cancelled: "red" }[v.status]}">${esc(v.status_label)}</span>
        <span>${fa(v.date || "")}</span><span><b>${invNum(v.payable)}</b> ${esc(v.profile.unit || "")}</span><span>${num(v.items.length)} ردیف</span></div></div></div>`).join("") || `<div class="card empty center">هنوز صورتحسابی صادر نشده.</div>`}</div>`;
  $("#inv-new").onclick = async () => { const v = await api("/api/invoices", { method: "POST", body: { items: [{ title: "", qty: 1, unit_price: "" }] } }); location.hash = `#invoices?id=${v.id}`; };
  $("#inv-prof").onclick = () => editInvoiceProfile();
  $$("[data-inv]", view).forEach((el) => (el.onclick = () => (location.hash = `#invoices?id=${el.dataset.inv}`)));
};

function profileFormHTML(p, prefix) {
  return PROFILE_FIELDS.map(([k, l, t]) => `<label class="${t === "longtext" || k === "address" || k === "contact" ? "wide" : ""}">${l}
    ${t === "longtext" ? `<textarea data-${prefix}="${k}" rows="2">${esc(p[k] || "")}</textarea>` : t === "color" ? `<input type="color" data-${prefix}="${k}" value="${esc(p[k] || "#4a72a8")}">`
    : `<input data-${prefix}="${k}" value="${esc(p[k] || "")}" ${["sheba", "card"].includes(k) ? 'class="ltr"' : ""}>`}</label>`).join("")
    + `<label class="wide">لوگوی رسانه (اختیاری؛ به‌جای نام)<span class="btn-row"><label class="btn sm">🖼 انتخاب لوگو<input type="file" data-${prefix}-logo accept="image/*" hidden></label>
      ${p.logo_media_id ? `<button type="button" class="btn sm" data-${prefix}-nologo>حذف لوگو</button>` : ""}</span></label>`;
}

async function editInvoiceProfile() {
  const p = await api("/api/invoice-profile");
  $("#dlg-body").innerHTML = `<h3>⚙️ سربرگ و اطلاعات پرداخت</h3><p class="small muted">این اطلاعات در فاکتورهای جدید قرار می‌گیرد.</p>
    <div class="form-grid">${profileFormHTML(p, "pf")}</div>
    <div class="modal-actions"><button class="btn primary" id="pf-save">ذخیره</button><button class="btn" id="pf-close">بستن</button></div>`;
  const collect = () => Object.fromEntries($$("[data-pf]").map((el) => [el.dataset.pf, el.value]));
  $("[data-pf-logo]").onchange = async (ev) => {
    const r = await uploadOne("/api/media", ev.target.files[0], {}, () => {});
    if (r.ok) { await api("/api/invoice-profile", { method: "PUT", body: { ...collect(), logo_media_id: r.data.added[0].id } }); toast("لوگو ذخیره شد"); $("#dlg").close(); editInvoiceProfile(); }
  };
  if ($("[data-pf-nologo]")) $("[data-pf-nologo]").onclick = async () => { await api("/api/invoice-profile", { method: "PUT", body: { ...collect(), logo_media_id: null } }); $("#dlg").close(); editInvoiceProfile(); };
  $("#pf-save").onclick = async () => { await api("/api/invoice-profile", { method: "PUT", body: collect() }); $("#dlg").close(); toast("ذخیره شد ✔"); refresh(); };
  $("#pf-close").onclick = () => $("#dlg").close();
  $("#dlg").showModal();
}

async function renderInvoiceEditor(view, id) {
  const [inv] = await Promise.all([api(`/api/invoices/${id}`), loadRefs()]);
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
          <label>رسانه / کارفرما (برای گزارش مالی)<select data-f="outlet_id"><option value=""></option>${REFS.outlets.map((o) => `<option value="${o.id}" ${o.id === inv.outlet_id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></label>
          <label>وضعیت<select data-f="status">${Object.entries({ draft: "پیش‌نویس", issued: "صادرشده", paid: "پرداخت‌شده", cancelled: "باطل‌شده" }).map(([k, l]) => `<option value="${k}" ${k === inv.status ? "selected" : ""}>${l}</option>`).join("")}</select></label>
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
          <button class="btn sm" id="inv-asdefault" style="margin-top:8px">⭐ ذخیره به‌عنوان پیش‌فرض فاکتورهای بعدی</button>
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
          customer_code: st.customer_code, customer_address: st.customer_address, notes: st.notes, status: st.status,
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
  $("#inv-add").onclick = () => { items.push({ title: "", date: "", qty: 1, qty_label: "", unit_price: 0 }); drawItems(); };
  $("#inv-asdefault").onclick = async () => { await api("/api/invoice-profile", { method: "PUT", body: profile }); toast("پیش‌فرض ذخیره شد ⭐"); };
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
