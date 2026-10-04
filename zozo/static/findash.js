"use strict";
// ═════════════════════════ داشبورد مالی ═════════════════════════
// نمودارها با SVG ساده ساخته می‌شوند (بدون کتابخانه‌ی خارجی). رنگ‌ها از متغیرهای CSS (--c1…) می‌آیند
// تا حالت تیره هم درست باشد. هر نمودار راهنما، برچسب و جدول دارد؛ رنگ تنها راه تشخیص نیست.

const FD = { period: "12m" };
const FD_PERIODS = [["month", "این ماه"], ["3m", "۳ ماه"], ["6m", "۶ ماه"], ["year", "امسال"], ["12m", "۱۲ ماه"], ["all", "همه"]];

function financeTabs(active) {
  return `<div class="seg fd-tabs"><a href="#finance" class="${active === "dash" ? "active" : ""}">📊 داشبورد</a><a href="#finance?tab=month" class="${active === "month" ? "active" : ""}">📅 گزارش ماهانه</a></div>`;
}

VIEWS.finance = async (view, params) => {
  if (params.get("tab") === "month" || params.get("m")) return financeMonthView(view, params);
  if (params.get("p")) FD.period = params.get("p");
  const d = await api(`/api/finance/dashboard?period=${FD.period}`);
  const k = d.kpi;
  const range = d.months > 1 ? `${esc(d.label_from)} تا ${esc(d.label_to)}` : esc(d.label_to);
  view.innerHTML = `
    <div class="page-title"><h2>💰 مالی</h2>${financeTabs("dash")}</div>
    <div class="fd-filter">
      <div class="seg">${FD_PERIODS.map(([v, l]) => `<button data-p="${v}" class="${FD.period === v ? "active" : ""}">${l}</button>`).join("")}</div>
      <span class="small muted">${range}</span>
    </div>
    <div class="quick-actions">
      <button id="f-inc">➕ ثبت دریافتی</button><button id="f-exp">➖ ثبت هزینه</button>
      <button data-go="#invoices">🧾 صدور فاکتور</button><button data-go="#transactions">💳 همه‌ی تراکنش‌ها</button>
      <button data-go="#legal_docs">📜 اسناد و سررسیدها</button><button data-go="#contracts">📑 قراردادها</button>
    </div>

    <div class="fd-hero card">
      <div class="fd-hero-main">
        <div class="l">خالص (درآمد منهای هزینه) · ${range}</div>
        <div class="fd-big ${k.net < 0 ? "neg" : ""}">${moneyWords(k.net)} <small>${META.currency}</small></div>
        ${fdDelta(k.net, k.prev_net, true, "نسبت به دوره‌ی قبل")}
      </div>
      <div class="fd-kpis">
        ${fdKpi("درآمد", k.income, fdDelta(k.income, k.prev_income, true), "c1")}
        ${fdKpi("هزینه", k.expense, fdDelta(k.expense, k.prev_expense, false), "c2")}
        ${fdKpi("فاکتور صادرشده", k.billed, `<span class="small muted">${num(k.billed_count)} فاکتور</span>`, "c7")}
        ${fdKpi("وصول‌شده از فاکتورها", k.collected, k.collection_rate != null ? fdMeter(k.collection_rate) : `<span class="small muted">—</span>`, "c3")}
        ${fdKpi("مطالبات باز (طلب)", k.receivable, `<span class="small muted">${num(k.receivable_count)} مورد${k.overdue ? ` · <b class="fd-late">⚠ ${moneyWords(k.overdue)} بیش از ۶۰ روز</b>` : ""}</span>`, "", "#finance?tab=month")}
      </div>
    </div>

    <div class="card"><div class="fd-head"><h3>📊 روند ماهانه‌ی درآمد و هزینه</h3>${fdLegend([["c1", "درآمد"], ["c2", "هزینه"]])}</div>
      ${fdColumns(d.trend, [["income", "درآمد", "c1"], ["expense", "هزینه", "c2"]])}
      ${fdTable(d.trend, [["label", "ماه"], ["income", "درآمد"], ["expense", "هزینه"]], (r) => ({ ...r, net: r.income - r.expense }))}
    </div>

    <div class="grid fd-grid2">
      <div class="card"><h3>📥 درآمد به تفکیک منبع</h3>${fdDonut(d.income_categories, "income", "کل درآمد")}</div>
      <div class="card"><h3>📤 هزینه به تفکیک دسته</h3>${fdDonut(d.expense_categories, "expense", "کل هزینه")}</div>
    </div>

    <div class="card"><div class="fd-head"><h3>🧾 فاکتورشده در برابر وصول‌شده</h3>${fdLegend([["c7", "فاکتورشده"], ["c3", "وصول‌شده"]])}</div>
      ${d.trend.some((t) => t.billed || t.collected) ? fdColumns(d.trend, [["billed", "فاکتورشده", "c7"], ["collected", "وصول‌شده", "c3"]])
        : `<div class="empty">در این بازه فاکتوری صادر یا وصول نشده. <a href="#invoices">صدور فاکتور</a></div>`}
    </div>

    <div class="grid fd-grid2">
      <div class="card"><h3>📌 ترکیب مطالبات <small class="muted">(طلب‌های فعلی)</small></h3>${fdDonut(d.receivable_parts.filter((x) => x.total > 0), "rec", "کل طلب", ["c1", "c2", "c3"])}</div>
      <div class="card"><h3>⏳ سن مطالبات</h3>${fdAging(d.aging)}</div>
    </div>

    <div class="grid fd-grid2">
      <div class="card"><h3>👥 بیشترین بدهکاران</h3>${d.debtors.length ? fdHbars(d.debtors) : `<div class="empty">طلبی ندارید 🎉</div>`}</div>
      <div class="card"><h3>✅ آخرین پرداخت‌های فاکتور</h3>
        ${d.recent_payments.length ? d.recent_payments.map((p) => `<div class="row fd-pay" data-go="#invoices?id=${p.invoice_id}">
          <span>فاکتور <b>${fa(p.number)}</b> ${p.customer ? `— ${esc(p.customer)}` : ""}<br>
          <small class="muted">در تاریخ ${fa(p.date)}${p.ref_no ? ` با شماره رسید <b>${fa(p.ref_no)}</b>` : ""} ${p.method_label ? `· ${esc(p.method_label)}` : ""} پرداخت شد</small></span>
          <b>${moneyWords(p.amount)}</b></div>`).join("") : `<div class="empty">هنوز پرداختی برای فاکتورها ثبت نشده.</div>`}
      </div>
    </div>

    <div class="grid fd-grid2">
      <div class="card"><h3>🧾 فاکتورهای پرداخت‌نشده</h3>
        ${d.open_invoices.length ? d.open_invoices.map((v) => `<div class="row"><span><a href="#invoices?id=${v.id}">${esc(v.customer || "بی‌نام")}</a><br>
          <small class="muted">${fa(v.number)} · ${fa(v.date || "")}${v.paid ? ` · پرداخت‌شده ${moneyWords(v.paid)}` : ""}</small></span>
          <span class="btn-row"><b>${moneyWords(v.due)}</b><button class="btn sm" data-pay="${v.id}">💳 ثبت پرداخت</button></span></div>`).join("")
          : `<div class="empty">همه‌ی فاکتورها پرداخت شده‌اند ✔</div>`}
      </div>
      <div class="card"><h3>🏢 درآمد به تفکیک رسانه / کارفرما</h3>${d.by_outlet.length ? fdHbars(d.by_outlet) : `<div class="empty">موردی نیست.</div>`}</div>
    </div>`;

  $$("[data-p]", view).forEach((b) => (b.onclick = () => { FD.period = b.dataset.p; lsSet("fdPeriod", FD.period); refresh(); }));
  $("#f-inc").onclick = () => openForm("transactions", null, { kind: "income" });
  $("#f-exp").onclick = () => openForm("transactions", null, { kind: "expense" });
  $$("[data-pay]", view).forEach((b) => (b.onclick = async (ev) => {
    ev.stopPropagation();
    const inv = await api(`/api/invoices/${b.dataset.pay}`);
    invPaymentDialog(inv, (ok) => ok && refresh());
  }));
  fdBindTips(view);
};
try { FD.period = lsGet("fdPeriod", "12m") || "12m"; } catch { /* */ }

// ───────────── اجزا ─────────────
function fdKpi(label, value, sub, swatch, go) {
  return `<div class="fd-kpi" ${go ? `data-go="${go}"` : ""}>
    <div class="l">${swatch ? `<i class="sw ${swatch}"></i>` : ""}${label}</div>
    <div class="v">${moneyWords(value)}</div><div class="s">${sub || ""}</div></div>`;
}

// تغییر نسبت به دوره‌ی قبل؛ رنگ = جهت × خوب/بد بودن (همراه با فلش، نه فقط رنگ)
function fdDelta(cur, prev, upIsGood, suffix = "") {
  if (!prev && !cur) return `<span class="fd-delta small muted">—</span>`;
  if (!prev) return `<span class="fd-delta small muted">دوره‌ی قبل صفر بود</span>`;
  const pct = Math.round((100 * (cur - prev)) / Math.abs(prev));
  if (!pct) return `<span class="fd-delta small muted">بدون تغییر ${suffix}</span>`;
  const good = (pct > 0) === upIsGood;
  return `<span class="fd-delta small ${good ? "up" : "down"}">${pct > 0 ? "▲" : "▼"} ${num(Math.abs(pct))}٪ ${suffix}</span>`;
}

function fdMeter(pct) {
  const p = Math.max(0, Math.min(100, pct));
  return `<div class="fd-meter" title="درصد وصول"><span style="width:${p}%"></span></div><span class="small muted">${num(pct)}٪ وصول</span>`;
}

function fdLegend(items) {
  return `<div class="fd-legend">${items.map(([c, l]) => `<span><i class="sw ${c}"></i>${l}</span>`).join("")}</div>`;
}

// محور: عددهای گرد
function fdTicks(max) {
  if (max <= 0) return [0, 1];
  const raw = max / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}
function fdShort(v) {
  if (!v) return "۰";
  if (Math.abs(v) >= 1e9) return `${num(+(v / 1e9).toFixed(1))} میلیارد`;
  if (Math.abs(v) >= 1e6) return `${num(+(v / 1e6).toFixed(v >= 1e8 ? 0 : 1))} میلیون`;
  if (Math.abs(v) >= 1e3) return `${num(+(v / 1e3).toFixed(0))} هزار`;
  return num(v);
}
const fdMonth = (label) => String(label).split(" ")[0];

// ستون‌های گروهی (یک محور، از صفر)
function fdColumns(rows, series) {
  const narrow = window.innerWidth < 700;
  const W = narrow ? 400 : 760, H = narrow ? 250 : 270, L = narrow ? 38 : 52, R = 6, T = 10, B = 34;
  const max = Math.max(0, ...rows.flatMap((r) => series.map(([k]) => r[k] || 0)));
  if (!max) return `<div class="empty">در این بازه رقمی ثبت نشده.</div>`;
  const [div, unit] = max >= 1e9 ? [1e9, "میلیارد"] : max >= 1e6 ? [1e6, "میلیون"] : max >= 1e3 ? [1e3, "هزار"] : [1, ""];
  const ticks = fdTicks(max / div).map((t) => t * div), top = ticks[ticks.length - 1];
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const band = (W - L - R) / rows.length;
  const bw = Math.min(24, (band * 0.72 - 2 * (series.length - 1)) / series.length);
  const gw = bw * series.length + 2 * (series.length - 1);
  const every = Math.max(1, Math.ceil(rows.length / (narrow ? 4 : 8)));
  let s = `<svg class="fd-svg ${narrow ? "nar" : ""}" viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="نمودار ستونی"><g transform="translate(0,18)">`;
  s += `<text class="ax" x="${L - 8}" y="-4" text-anchor="end" direction="rtl">${unit} ${META.currency}</text>`;
  ticks.forEach((t) => {
    s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>`;
    s += `<text class="ax" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${num(+(t / div).toFixed(2))}</text>`;
  });
  rows.forEach((r, i) => {
    const gx = L + band * i + (band - gw) / 2;
    series.forEach(([k, , c], j) => {
      const v = r[k] || 0;
      if (!v) return;
      const x = gx + j * (bw + 2), yt = y(v), h = y(0) - yt, rad = Math.min(4, h, bw / 2);
      s += `<path class="bar ${c}" d="M${x},${y(0)} V${yt + rad} Q${x},${yt} ${x + rad},${yt} H${x + bw - rad} Q${x + bw},${yt} ${x + bw},${yt + rad} V${y(0)} Z"/>`;
    });
    const tip = `<b>${esc(r.label)}</b>${series.map(([k, l, c]) => `<div><i class="sw ${c}"></i>${l}: <b>${moneyWords(r[k] || 0)}</b></div>`).join("")}`;
    s += `<rect class="hit" x="${L + band * i}" y="${T}" width="${band}" height="${H - T - B}" data-tip="${esc(tip)}"/>`;
    if (i % every === 0 || i === rows.length - 1) s += `<text class="ax" x="${L + band * i + band / 2}" y="${H - 12}" text-anchor="middle">${esc(fdMonth(r.label))}</text>`;
  });
  s += `<line class="base" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/></g></svg>`;
  return s;
}

// رنگ هر دسته ثابت می‌ماند (با تغییر بازه رنگ‌ها جابه‌جا نمی‌شوند)
const FD_SLOTS = ["c1", "c2", "c3", "c4", "c5", "c6"];
function fdSlotMap(kind, names) {
  const known = (fieldOf("transactions", "category")?.suggest || []);
  const used = new Set(), out = {};
  for (const n of names) {
    let i = known.indexOf(n);
    let slot = i >= 0 ? FD_SLOTS[i % FD_SLOTS.length] : null;
    if (!slot || used.has(slot)) slot = FD_SLOTS.find((x) => !used.has(x));
    used.add(slot); out[n] = slot;
  }
  return out;
}

// نمودار حلقه‌ای + راهنما با مبلغ و درصد (۵ دسته‌ی اول + «سایر»)
function fdDonut(rows, kind, centerLabel, fixedSlots) {
  rows = rows.filter((r) => r.total > 0);
  if (!rows.length) return `<div class="empty">در این بازه رقمی ثبت نشده.</div>`;
  let items = rows.slice(0, 5);
  if (rows.length > 5) items.push({ name: "سایر", total: rows.slice(5).reduce((a, r) => a + r.total, 0), other: true });
  const map = fixedSlots ? Object.fromEntries(items.map((r, i) => [r.name, fixedSlots[i]])) : fdSlotMap(kind, items.filter((r) => !r.other).map((r) => r.name));
  const total = items.reduce((a, r) => a + r.total, 0);
  const R = 80, r0 = 54, C = 100;
  let a0 = -Math.PI / 2, s = "";
  const pt = (rad, a) => `${C + rad * Math.cos(a)},${C + rad * Math.sin(a)}`;
  items.forEach((it) => {
    const frac = it.total / total;
    const cls = it.other ? "cx" : map[it.name];
    const tip = `<b>${esc(it.name)}</b><div>${moneyShort(it.total)} · ${num(Math.round(frac * 100))}٪</div>`;
    if (frac >= 0.9999) {
      s += `<circle class="seg ${cls}" cx="${C}" cy="${C}" r="${(R + r0) / 2}" fill="none" stroke-width="${R - r0}" data-tip="${esc(tip)}"/>`;
      return;
    }
    const a1 = a0 + frac * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0;
    s += `<path class="seg ${cls}" d="M${pt(R, a0)} A${R},${R} 0 ${large} 1 ${pt(R, a1)} L${pt(r0, a1)} A${r0},${r0} 0 ${large} 0 ${pt(r0, a0)} Z" data-tip="${esc(tip)}"/>`;
    a0 = a1;
  });
  return `<div class="fd-donut">
    <svg viewBox="0 0 200 200" role="img" aria-label="${esc(centerLabel)}">${s}
      <text class="ct-l" x="100" y="92" text-anchor="middle">${esc(centerLabel)}</text>
      <text class="ct-v" x="100" y="117" text-anchor="middle">${fdShort(total)}</text></svg>
    <div class="fd-dl">${items.map((it) => `<div><i class="sw ${it.other ? "cx" : map[it.name]}"></i><span class="n">${esc(it.name)}</span>
      <b>${moneyWords(it.total)}</b><small class="muted">${num(Math.round((100 * it.total) / total))}٪</small></div>`).join("")}</div></div>`;
}

// سن مطالبات: ستون‌های افقی با طیف یک‌رنگ (هرچه قدیمی‌تر، پررنگ‌تر)
function fdAging(b) {
  const max = Math.max(...b.map((x) => x.total));
  if (!max) return `<div class="empty">طلب معوقی ندارید 🎉</div>`;
  return `<div class="fd-aging">${b.map((x, i) => `<div class="fd-ag" data-tip="${esc(`<b>${x.name}</b><div>${moneyShort(x.total)} · ${num(x.n)} مورد</div>`)}">
    <span>${x.name}</span><div class="bar"><span class="q${i}" style="width:${(100 * x.total) / max}%"></span></div>
    <b class="small">${x.total ? moneyWords(x.total) : "—"}</b></div>`).join("")}</div>
    <p class="small muted">از تاریخ فاکتور یا انتشار کار تا امروز.</p>`;
}

function fdHbars(rows) {
  const max = Math.max(...rows.map((r) => r.total));
  return rows.map((r) => `<div class="hbar fd-hb"><span>${esc(r.name)}</span><div class="bar"><span style="width:${(100 * r.total) / max}%"></span></div><b class="small">${moneyWords(r.total)}</b></div>`).join("");
}

function fdTable(rows, cols, map) {
  return `<details class="fd-table"><summary class="small">نمایش جدول</summary><div class="table-wrap"><table>
    <thead><tr>${cols.map(([, l]) => `<th>${l}</th>`).join("")}<th>خالص</th></tr></thead>
    <tbody>${rows.map((r0) => { const r = map(r0); return `<tr>${cols.map(([k]) => `<td>${k === "label" ? esc(r[k]) : moneyWords(r[k])}</td>`).join("")}<td class="${r.net < 0 ? "neg" : ""}">${moneyWords(r.net)}</td></tr>`; }).join("")}</tbody>
  </table></div></details>`;
}

// راهنمای شناور (موس و لمس)
function fdBindTips(root) {
  let tip = $("#fd-tip");
  if (!tip) { tip = document.createElement("div"); tip.id = "fd-tip"; tip.hidden = true; document.body.appendChild(tip); }
  const show = (el, ev) => {
    tip.innerHTML = el.dataset.tip;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = ev.clientX - r.width / 2, yv = ev.clientY - r.height - 14;
    if (yv < 6) yv = ev.clientY + 18;
    x = Math.max(6, Math.min(window.innerWidth - r.width - 6, x));
    tip.style.left = `${x}px`; tip.style.top = `${yv}px`;
    $$(".on", root).forEach((e) => e.classList.remove("on"));
    el.classList.add("on");
  };
  const hide = () => { tip.hidden = true; $$(".on", root).forEach((e) => e.classList.remove("on")); };
  $$("[data-tip]", root).forEach((el) => {
    el.addEventListener("pointermove", (ev) => show(el, ev));
    el.addEventListener("pointerdown", (ev) => show(el, ev));
    el.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") hide(); });
  });
  document.addEventListener("scroll", hide, { passive: true, once: true });
}
