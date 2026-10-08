"use strict";

// ═════════════════════════ ابزارهای کمکی ═════════════════════════
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const faNum = new Intl.NumberFormat("fa-IR");
const num = (v) => (v === null || v === undefined || v === "" ? "" : faNum.format(v));
const fa = (s) => String(s ?? "").replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
const enDigits = (s) => String(s ?? "").replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
const lsGet = (k, d = null) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* حالت خصوصی */ } };

let META = null;
const REFS = { outlets: [], contacts: [], stories: [], contracts: [] };
const UI = { filters: {}, storyView: lsGet("storyView", "board") };

class LoginRequired extends Error {}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : {},
    credentials: "same-origin",
    ...opts,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.login) { showLogin(); throw new LoginRequired("نیاز به ورود"); }
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "خطای سرور؛ دوباره امتحان کنید");
  return data;
}

function toast(msg, ms) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms || Math.max(2600, msg.length * 70));
}

function moneyWords(v) {
  v = Number(v) || 0;
  if (Math.abs(v) >= 1e9) return `${num(+(v / 1e9).toFixed(2))} میلیارد`;
  if (Math.abs(v) >= 1e6) return `${num(+(v / 1e6).toFixed(2))} میلیون`;
  if (Math.abs(v) >= 1e3) return `${num(+(v / 1e3).toFixed(1))} هزار`;
  return num(v);
}
const money = (v) => (v || v === 0 ? `${num(v)} ${META.currency}` : "");
const moneyShort = (v) => `${moneyWords(v)} ${META.currency}`;

const schema = (e) => META.schema[e];
const fieldOf = (e, f) => schema(e).fields.find((x) => x.name === f);
const choiceLabel = (e, f, v) => (fieldOf(e, f)?.choices[v]) || v || "";

const COLORS = {
  status: {
    idea: "gray", research: "", writing: "amber", editing: "amber", submitted: "primary", published: "green", cancelled: "gray",
    active: "green", sent: "gray", done: "green",
  },
  priority: { urgent: "red", high: "amber", medium: "", low: "gray" },
  kind: { income: "green", expense: "red" },
  pay_status: { unpaid: "red", partial: "amber", paid: "green", none: "gray" },
  reliability: { high: "green", medium: "", low: "red", unknown: "gray" },
};
const badge = (e, f, v, extra = "") => (v ? `<span class="badge ${COLORS[f]?.[v] ?? ""} ${extra}">${esc(choiceLabel(e, f, v))}</span>` : "");

function deadlineBadge(date, time, closed) {
  if (!date) return "";
  const today = META.today;
  const d = Jalali.daysBetween(today, date);
  let cls = "", txt = fa(date.slice(5));
  if (!closed) {
    if (d < 0) { cls = "red"; txt = `${num(-d)} روز گذشته`; }
    else if (d === 0) { cls = "red"; txt = "امروز"; }
    else if (d === 1) { cls = "amber"; txt = "فردا"; }
    else if (d <= 6) { cls = "amber"; txt = `${num(d)} روز مانده`; }
  }
  return `<span class="badge ${cls}">⏳ ${txt}${time ? " " + fa(time) : ""}</span>`;
}

function relTime(s) {
  if (!s) return "";
  const date = s.slice(0, 10), time = s.slice(11, 16);
  if (date === META.today) return `امروز ${fa(time)}`;
  if (date === Jalali.addDays(META.today, -1)) return `دیروز ${fa(time)}`;
  if (date === Jalali.addDays(META.today, 1)) return `فردا ${fa(time)}`;
  return fa(s.slice(0, 16));
}

// ═════════════════════════ ناوبری ═════════════════════════
const NAV_MAIN = [
  ["home", "🏠", "خانه"],
  ["stories", "📝", "کارها"],
  ["teaser", "🎬", "تیزر"],
  ["archive", "🗄️", "بایگانی"],
  ["more", "☰", "بیشتر"],
];
const NAV_MORE = [
  ["transcribe", "🎙️", "صوت به متن", "ویس و مصاحبه را تایپ‌شده تحویل بگیرید"],
  ["ocr", "📄", "عکس و PDF به متن", "متن عکس، بیانیه یا اسکن آماده‌ی کپی"],
  ["post", "🖼️", "پست‌ساز", "پست اینستاگرام با قالب کرمان راوی"],
  ["calendar", "📅", "تقویم", "مهلت‌ها و یادآوری‌ها در یک نگاه"],
  ["reminders", "⏰", "یادآوری‌ها", "یک‌باره یا تکرارشونده"],
  ["news", "📡", "رصد خبر", "خبرهای خبرگزاری‌ها و کلیدواژه‌ها"],
  ["finance", "💰", "مالی", "درآمد، هزینه و طلب‌ها"],
  ["invoices", "🧾", "فاکتور (صورتحساب)", "صدور فاکتور و خروجی PDF"],
  ["legal_docs", "📜", "اسناد و سررسیدها", "یادآوری انقضا و تمدید اسناد"],
  ["contacts", "👥", "منابع و مخاطبین", "دفترچه‌ی تلفن خبری"],
  ["notes", "🗒️", "یادداشت‌ها", "ایده‌ها و پیش‌نویس‌ها"],
  ["tools", "✍️", "ابزار نوشتن", "اصلاح متن، خلاصه، شمارش کلمات"],
  ["outlets", "🏢", "رسانه‌ها", "کارفرماها و نوع همکاری"],
  ["contracts", "📑", "قراردادها", "مبلغ، دریافتی و مانده"],
  ["transactions", "💳", "دریافت و پرداخت", "همه‌ی تراکنش‌ها"],
  ["search", "🔍", "جستجو", "در همه‌ی بخش‌ها"],
  ["settings", "⚙️", "تنظیمات", "اعلان، پشتیبان، خروج"],
];

function renderNav(page) {
  const top = NAV_MAIN.find(([k]) => k === page) ? page : "more";
  $("#bottom-nav").innerHTML = NAV_MAIN.map(([k, i, l]) => `<a href="#${k}" class="${top === k ? "active" : ""}"><span class="i">${i}</span>${l}</a>`).join("");
  const side = [...NAV_MAIN.slice(0, 4), ...NAV_MORE];
  $("#side-nav").innerHTML = side.map(([k, i, l], idx) => `${idx === 4 ? '<div class="sep"></div>' : ""}<a href="#${k}" class="${page === k ? "active" : ""}">${i} ${l}</a>`).join("");
}

function parseHash() {
  const h = location.hash.replace(/^#/, "") || "home";
  const [page, qs] = h.split("?");
  return { page, params: new URLSearchParams(qs || "") };
}

const VIEWS = {};
let currentPage = null;

async function route() {
  if (!META) return;
  const { page, params } = parseHash();
  currentPage = page;
  renderNav(page);
  closeNotif();
  const view = $("#view");
  const fn = VIEWS[page] || (META.schema[page] ? (v, p) => renderEntity(v, page, p) : VIEWS.home);
  try {
    await fn(view, params);
  } catch (e) {
    if (e instanceof LoginRequired) return;
    view.innerHTML = `<div class="card error">${esc(e.message)}</div>`;
  }
  if (params.get("id") && META.schema[page]) {
    try { openForm(page, await api(`/api/${page}/${params.get("id")}`)); } catch { /* حذف‌شده */ }
    history.replaceState(null, "", `#${page}`);
  }
}
const refresh = () => route();
window.addEventListener("hashchange", () => { window.scrollTo(0, 0); route(); });

// ═════════════════════════ ورود ═════════════════════════
function showLogin() {
  META = null;
  $("#bottom-nav").innerHTML = "";
  $("#side-nav").innerHTML = "";
  $("#view").innerHTML = `<div class="login-wrap"><form class="card login" id="login-form">
      <div class="logo"><img src="/static/brand/logo.png" alt="کرمان راوی"></div><h1>${esc(document.title.split(" —")[0])}</h1>
      <input type="password" name="p" placeholder="رمز عبور" autocomplete="current-password" required autofocus>
      <button class="btn primary big">ورود</button>
      <p class="error" id="login-err"></p>
    </form></div>`;
  $("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("/api/login", { method: "POST", body: { password: e.target.p.value } });
      init();
    } catch (err) { $("#login-err").textContent = err.message; }
  };
}

// ═════════════════════════ فهرست موجودیت‌ها ═════════════════════════
const NEXT_STATUS = { idea: "research", research: "writing", writing: "editing", editing: "submitted", submitted: "published" };

function itemHTML(e, r) {
  const m = [];
  let pre = "", snippet = "", cls = "", title = r[schema(e).title_field], side = "";
  switch (e) {
    case "stories": {
      const closed = ["published", "cancelled"].includes(r.status);
      cls = r.status === "cancelled" ? "done" : "";
      m.push(badge(e, "status", r.status));
      if (r.kind && r.kind !== "news") m.push(esc(choiceLabel(e, "kind", r.kind)));
      if (r.outlet_name) m.push(`🏢 ${esc(r.outlet_name)}`);
      m.push(deadlineBadge(r.deadline, r.deadline_time, closed || r.status === "submitted"));
      if (["urgent", "high"].includes(r.priority)) m.push(badge(e, "priority", r.priority));
      if (r.fee && ["unpaid", "partial"].includes(r.pay_status)) m.push(`<span class="badge ${COLORS.pay_status[r.pay_status]}">💵 ${moneyWords(r.fee - (r.paid_amount || 0))}</span>`);
      if (r.published_url) m.push(`<a href="${esc(r.published_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">🔗 انتشار</a>`);
      if (NEXT_STATUS[r.status]) side = `<button class="btn sm" data-next="${r.id}" title="رفتن به مرحله‌ی بعد">${esc(choiceLabel(e, "status", NEXT_STATUS[r.status]))} ←</button>`;
      break;
    }
    case "reminders":
      cls = r.status !== "active" ? "done" : "";
      pre = `<input type="checkbox" data-rdone="${r.id}" ${r.status === "done" ? "checked" : ""} title="انجام شد">`;
      if (r.category && r.category !== "other") m.push(`<span class="badge">${esc(choiceLabel(e, "category", r.category))}</span>`);
      m.push(`⏰ ${relTime(r.remind_at)}`);
      if (r.repeat !== "none") m.push(`<span class="badge">🔁 ${esc(r.repeat === "every_n" ? `هر ${num(r.repeat_days || 1)} روز` : choiceLabel(e, "repeat", r.repeat))}</span>`);
      if (r.status === "sent") m.push(`<span class="badge gray">یادآوری شد</span>`);
      if (r.story_name) m.push(`📝 ${esc(r.story_name)}`);
      snippet = r.notes;
      break;
    case "contacts":
      if (r.role || r.organization) m.push(esc([r.role, r.organization].filter(Boolean).join(" — ")));
      if (r.phone) m.push(`<a href="tel:${esc(enDigits(r.phone))}" onclick="event.stopPropagation()">📞 ${fa(esc(r.phone))}</a>`);
      if (r.beat) m.push(`🏷 ${esc(r.beat)}`);
      if (r.reliability && r.reliability !== "unknown") m.push(badge(e, "reliability", r.reliability));
      if (r.last_contact) m.push(`آخرین تماس ${fa(r.last_contact)}`);
      break;
    case "notes":
      m.push(`<span class="badge ${r.kind === "idea" ? "amber" : r.kind === "template" ? "green" : ""}">${esc(choiceLabel(e, "kind", r.kind))}</span>`);
      if (r.tags) m.push(esc(r.tags));
      if (r.story_name) m.push(`📝 ${esc(r.story_name)}`);
      m.push(relTime(r.updated_at));
      snippet = r.content;
      break;
    case "outlets":
      m.push(esc(choiceLabel(e, "kind", r.kind)));
      m.push(esc(choiceLabel(e, "pay_type", r.pay_type)));
      if (r.monthly_salary) m.push(`حقوق ${moneyShort(r.monthly_salary)}`);
      if (r.default_fee) m.push(`هر کار ${moneyShort(r.default_fee)}`);
      if (r.editor_name) m.push(`دبیر: ${esc(r.editor_name)}`);
      if (r.active === "no") { cls = "done"; m.push(`<span class="badge gray">غیرفعال</span>`); }
      break;
    case "contracts": {
      const pct = r.amount ? Math.min(100, Math.round((100 * (r.paid_amount || 0)) / r.amount)) : 0;
      m.push(badge(e, "status", r.status));
      if (r.outlet_name) m.push(`🏢 ${esc(r.outlet_name)}`);
      m.push(`کل ${moneyShort(r.amount)}`);
      m.push(`دریافتی ${moneyShort(r.paid_amount || 0)}`);
      if (r.end_date) m.push(`پایان ${fa(r.end_date)}`);
      side = `<b class="small">${num(pct)}٪</b>`;
      return `<div class="item" data-entity="${e}" data-id="${r.id}"><div class="body"><div class="title">${esc(r.title)}</div>
        <div class="meta">${m.filter(Boolean).map((x) => `<span>${x}</span>`).join("")}</div>
        <div class="progress"><span style="width:${pct}%"></span></div></div><div class="side">${side}</div></div>`;
    }
    case "transactions":
      m.push(badge(e, "kind", r.kind));
      m.push(fa(r.tx_date));
      if (r.category) m.push(esc(r.category));
      if (r.outlet_name) m.push(`🏢 ${esc(r.outlet_name)}`);
      side = `<b style="color:var(--${r.kind === "income" ? "ok" : "danger"})">${r.kind === "income" ? "+" : "−"}${num(r.amount)}</b>`;
      break;
    case "feeds":
      if (r.category) m.push(esc(r.category));
      m.push(`${num(r.items_count || 0)} خبر`);
      if (r.last_fetch) m.push(`آخرین دریافت ${relTime(r.last_fetch)}`);
      if (r.last_error) m.push(`<span class="badge red" title="${esc(r.last_error)}">خطا در دریافت</span>`);
      if (r.active === "no") { cls = "done"; m.push(`<span class="badge gray">غیرفعال</span>`); }
      snippet = r.url;
      break;
    case "legal_docs": {
      const closed = r.status !== "active";
      cls = r.status === "archived" ? "done" : "";
      m.push(esc(choiceLabel(e, "doc_type", r.doc_type)));
      if (r.status !== "active") m.push(`<span class="badge ${r.status === "expired" ? "red" : "gray"}">${esc(choiceLabel(e, "status", r.status))}</span>`);
      if (r.expiry_date) m.push(deadlineBadge(r.expiry_date, null, closed).replace("⏳", "📅"));
      if (r.owner_name) m.push(`👤 ${esc(r.owner_name)}`);
      if (r.owner_phone) m.push(`<a href="tel:${esc(enDigits(r.owner_phone))}" onclick="event.stopPropagation()">📞 ${fa(esc(r.owner_phone))}</a>`);
      if (r.number) m.push(`شماره ${fa(esc(r.number))}`);
      if (r.renew_months) m.push(`🔁 هر ${num(r.renew_months)} ماه`);
      break;
    }
    case "keywords":
      m.push(r.notify === "yes" ? "🔔 اعلان می‌دهد" : "🔕 بدون اعلان");
      break;
  }
  return `<div class="item ${cls}" data-entity="${e}" data-id="${r.id}">
    ${pre}
    <div class="body">
      <div class="title">${esc(title)}</div>
      <div class="meta">${m.filter(Boolean).map((x) => `<span>${x}</span>`).join("")}</div>
      ${snippet ? `<div class="snippet">${esc(snippet)}</div>` : ""}
    </div>
    ${side ? `<div class="side">${side}</div>` : ""}
  </div>`;
}

document.addEventListener("click", async (ev) => {
  const nx = ev.target.closest("[data-next]");
  if (nx) {
    ev.stopPropagation();
    try {
      const r = await api(`/api/stories/${nx.dataset.next}`);
      const to = NEXT_STATUS[r.status];
      await api(`/api/stories/${r.id}`, { method: "PATCH", body: { status: to } });
      toast(`«${r.title}» ← ${choiceLabel("stories", "status", to)}`);
      if (to === "published" && r.fee && r.pay_status !== "paid") setTimeout(() => toast("یادتان باشد پس از دریافت دستمزد، آن را ثبت کنید 💵"), 2800);
      refresh();
    } catch (err) { if (!(err instanceof LoginRequired)) toast(err.message); }
    return;
  }
  const cb = ev.target.closest("input[data-rdone]");
  if (cb) {
    ev.stopPropagation();
    try {
      await api(`/api/reminders/${cb.dataset.rdone}`, { method: "PATCH", body: { status: cb.checked ? "done" : "active" } });
      toast(cb.checked ? "✔ انجام شد" : "دوباره فعال شد");
      refresh();
    } catch (err) { toast(err.message); }
    return;
  }
  const item = ev.target.closest(".item[data-entity]");
  if (item && !ev.target.closest("a,button,input")) {
    try { openForm(item.dataset.entity, await api(`/api/${item.dataset.entity}/${item.dataset.id}`)); } catch (err) { toast(err.message); }
  }
  const go = ev.target.closest("[data-go]");
  if (go) location.hash = go.dataset.go;
});

const ENTITY_FILTERS = {
  legal_docs: ["status", "doc_type"],
  stories: ["status", "outlet_id", "kind"],
  reminders: ["status", "category"],
  notes: ["kind"],
  contacts: ["reliability"],
  contracts: ["status", "outlet_id"],
  transactions: ["kind", "outlet_id"],
  outlets: [],
  feeds: [],
  keywords: [],
};

async function renderEntity(view, e, params) {
  const s = schema(e);
  const f = (UI.filters[e] ||= { search: "", open: !!s.closed.length });
  const qs = new URLSearchParams({ limit: 500 });
  if (f.search) qs.set("search", f.search);
  for (const k of ENTITY_FILTERS[e] || []) if (f[k]) qs.set(k, f[k]);
  if (f.open && !f.status && s.closed.length) qs.set("include_closed", "false");
  const [rows] = await Promise.all([api(`/api/${e}?${qs}`), loadRefs()]);
  const board = e === "stories" && UI.storyView === "board";

  let summary = "";
  if (e === "transactions") {
    const inc = rows.filter((r) => r.kind === "income").reduce((a, r) => a + r.amount, 0);
    const exp = rows.filter((r) => r.kind === "expense").reduce((a, r) => a + r.amount, 0);
    summary = `<div class="stats"><div class="stat good"><div class="v">${moneyWords(inc)}</div><div class="l">جمع دریافتی</div></div>
      <div class="stat bad"><div class="v">${moneyWords(exp)}</div><div class="l">جمع هزینه</div></div>
      <div class="stat"><div class="v">${moneyWords(inc - exp)}</div><div class="l">مانده (${META.currency})</div></div></div>`;
  }
  const filterSelects = (ENTITY_FILTERS[e] || []).map((k) => {
    const fld = fieldOf(e, k);
    const opts = fld.type === "ref" ? REFS[fld.ref].map((x) => [x.id, x[schema(fld.ref).title_field]]) : Object.entries(fld.choices);
    return `<select data-filter="${k}"><option value="">${esc(fld.label)}: همه</option>${opts.map(([v, l]) => `<option value="${v}" ${String(f[k]) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  }).join("");
  const extraHead = {
    feeds: `<a class="btn" href="#news">📡 خبرها</a>`,
    keywords: `<a class="btn" href="#news">📡 خبرها</a>`,
    transactions: `<a class="btn" href="#finance">📊 گزارش مالی</a>`,
    stories: `<div class="seg"><button data-sv="board" class="${board ? "active" : ""}">تابلو</button><button data-sv="list" class="${board ? "" : "active"}">فهرست</button></div>`,
  }[e] || "";

  let body;
  if (!rows.length) body = `<div class="card empty center">موردی نیست. با دکمه‌ی «+ ${esc(s.label)} جدید» شروع کنید.</div>`;
  else if (board) {
    const cols = Object.entries(fieldOf("stories", "status").choices).filter(([k]) => !(f.open && s.closed.includes(k)) || f.status === k);
    body = `<div class="board">${cols.map(([k, l]) => {
      const items = rows.filter((r) => r.status === k);
      if (f.status && f.status !== k) return "";
      return `<div class="col"><h4>${esc(l)} <span class="muted">${num(items.length)}</span></h4>${items.map((r) => itemHTML(e, r)).join("") || '<div class="empty small">—</div>'}</div>`;
    }).join("")}</div>`;
  } else body = `<div class="list">${rows.map((r) => itemHTML(e, r)).join("")}</div>`;

  view.innerHTML = `
    <div class="page-title"><h2>${s.icon} ${esc(s.label_plural)}</h2>${extraHead}</div>
    <div class="toolbar">
      <button class="btn primary" id="add">+ ${esc(s.label)} جدید</button>
      <input type="search" id="f-search" placeholder="جستجو…" value="${esc(f.search)}">
      ${filterSelects}
      ${s.closed.length ? `<label><input type="checkbox" id="f-open" ${f.open ? "checked" : ""}> فقط باز</label>` : ""}
    </div>
    ${summary}${body}`;

  $("#add").onclick = () => openForm(e, null, Object.fromEntries((ENTITY_FILTERS[e] || []).filter((k) => f[k] && fieldOf(e, k).type === "ref").map((k) => [k, Number(f[k])])));
  let t;
  $("#f-search").oninput = (ev) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      f.search = ev.target.value;
      await renderEntity(view, e, params);
      const el = $("#f-search");
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 350);
  };
  $$("[data-filter]", view).forEach((el) => (el.onchange = () => { f[el.dataset.filter] = el.value; refresh(); }));
  if ($("#f-open")) $("#f-open").onchange = (ev) => { f.open = ev.target.checked; refresh(); };
  $$("[data-sv]", view).forEach((b) => (b.onclick = () => { UI.storyView = b.dataset.sv; lsSet("storyView", b.dataset.sv); refresh(); }));
}

async function loadRefs(force = false) {
  if (!force && loadRefs._at && Date.now() - loadRefs._at < 15000) return;
  const [o, c, s, k] = await Promise.all([
    api("/api/outlets?limit=500"), api("/api/contacts?limit=2000"), api("/api/stories?limit=400"), api("/api/contracts?limit=300"),
  ]);
  Object.assign(REFS, { outlets: o, contacts: c, stories: s, contracts: k });
  loadRefs._at = Date.now();
}
const invalidateRefs = () => (loadRefs._at = 0);

// ═════════════════════════ فرم ایجاد / ویرایش ═════════════════════════
function inputFor(f, value) {
  const name = `name="${f.name}"`;
  const v = value ?? "";
  switch (f.type) {
    case "longtext":
      return `<textarea ${name} class="${f.name === "body" || f.name === "content" ? "big" : ""}">${esc(v)}</textarea>`;
    case "choice":
      return `<select ${name}>${f.required || f.default ? "" : `<option value=""></option>`}${Object.entries(f.choices)
        .map(([k, l]) => `<option value="${k}" ${k === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    case "ref": {
      const list = REFS[f.ref] || [];
      const tf = schema(f.ref).title_field;
      const hasVal = v !== "" && list.some((x) => x.id === v);
      return `<select ${name}><option value=""></option>${list.map((x) => `<option value="${x.id}" ${x.id === v ? "selected" : ""}>${esc(x[tf])}</option>`).join("")}
        ${v !== "" && !hasVal ? `<option value="${v}" selected>#${v}</option>` : ""}</select>`;
    }
    case "money":
    case "int":
    case "percent":
      return `<input ${name} inputmode="numeric" value="${v === "" ? "" : Number(v).toLocaleString("en-US")}" data-num="${f.type}">${f.type === "money" ? `<small class="money-hint" data-hint="${f.name}">${v ? moneyShort(v) : ""}</small>` : ""}`;
    case "date":
      return `<div class="date-wrap"><input ${name} placeholder="مثلاً ${fa(META.today)}" value="${esc(v)}" inputmode="numeric"><button type="button" data-dp="${f.name}">📅</button></div>
        <div class="date-quick" data-dq="${f.name}"><button type="button" data-d="0">امروز</button><button type="button" data-d="1">فردا</button><button type="button" data-d="2">پس‌فردا</button><button type="button" data-d="7">هفته‌ی بعد</button></div>`;
    case "datetime":
      return `<div class="date-wrap"><input ${name} placeholder="مثلاً ${fa(META.today)} ۰۹:۳۰" value="${esc(v)}"><button type="button" data-dp="${f.name}" data-time="1">📅</button></div>
        <div class="date-quick" data-dq="${f.name}" data-time="1"><button type="button" data-h="1">یک ساعت دیگر</button><button type="button" data-d="0" data-t="18:00">امروز عصر</button><button type="button" data-d="1" data-t="09:00">فردا صبح</button></div>`;
    case "time":
      return `<input ${name} type="time" value="${esc(v)}" class="ltr">`;
    case "url":
      return `<input ${name} type="url" inputmode="url" value="${esc(v)}" class="ltr" placeholder="https://">`;
    case "phone":
      return `<input ${name} type="tel" value="${esc(v)}" class="ltr">`;
    default: {
      const dl = f.suggest?.length ? `<datalist id="dl-${f.name}">${f.suggest.map((x) => `<option value="${esc(x)}">`).join("")}</datalist>` : "";
      return `<input ${name} value="${esc(v)}" ${dl ? `list="dl-${f.name}"` : ""}>${dl}`;
    }
  }
}

function fieldHTML(e, f, values) {
  const wide = f.type === "longtext" || f.name === schema(e).title_field;
  return `<label class="${wide ? "wide" : ""}">${esc(f.label)}${f.required ? " *" : ""}${inputFor(f, values[f.name])}${f.help ? `<small>${esc(f.help)}</small>` : ""}</label>`;
}

const FORM_EXTRAS = {
  stories: (rec) => rec ? [
    ["✨ پیشنهاد پست و ریلز", () => { $("#modal").close(); openSuggestion(rec.id); }],
    ["⏰ یادآوری برای این سوژه", () => openForm("reminders", null, { story_id: rec.id, title: rec.title })],
    ["🎬 ساخت تیزر", () => { $("#modal").close(); location.hash = `#teaser?story=${rec.id}`; }],
    ["✍️ ویرایشگر متن", () => { $("#modal").close(); location.hash = `#tools?story=${rec.id}`; }],
    ["📎 اسناد این سوژه", () => { $("#modal").close(); location.hash = `#archive?story=${rec.id}`; }],
    ...(rec.fee && rec.pay_status !== "paid" ? [["💵 دستمزد کامل دریافت شد", async () => {
      await api(`/api/stories/${rec.id}`, { method: "PATCH", body: { pay_status: "paid" } });
      $("#modal").close(); toast("✔ دریافتی در بخش مالی ثبت شد"); refresh();
    }]] : []),
  ] : [],
  outlets: (rec) => rec && rec.monthly_salary ? [["💵 ثبت دریافت حقوق این ماه", () => openForm("transactions", null, {
    kind: "income", amount: rec.monthly_salary, category: "حقوق", outlet_id: rec.id, description: `حقوق ${Jalali.MONTHS[Number(META.today.slice(5, 7)) - 1]} — ${rec.name}`,
  })]] : [],
  contracts: (rec) => rec && rec.amount > (rec.paid_amount || 0) ? [["💵 ثبت دریافت قسط", async () => {
    const v = prompt(`مبلغ دریافت‌شده (${META.currency}):`, "");
    const n = Number(enDigits(v || "").replace(/[^\d]/g, ""));
    if (!n) return;
    await api(`/api/contracts/${rec.id}`, { method: "PATCH", body: { paid_amount: (rec.paid_amount || 0) + n } });
    $("#modal").close(); toast("✔ دریافتی ثبت شد"); refresh();
  }]] : [],
  legal_docs: (rec) => rec ? [
    ["🔁 تمدید", async () => {
      const months = prompt("چند ماه تمدید شود؟ (یا تاریخ جدید سررسید مثل ۱۴۰۶/۰۷/۱۲)", rec.renew_months || 12);
      if (!months) return;
      const isDate = /\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(enDigits(months));
      const expense = rec.amount ? confirm(`هزینه‌ی تمدید (${moneyShort(rec.amount)}) در بخش مالی ثبت شود؟`) : false;
      await api(`/api/legal_docs/${rec.id}/renew`, { method: "POST", body: isDate ? { new_expiry: enDigits(months), expense } : { months: enDigits(months), expense } });
      $("#modal").close(); toast("✔ تمدید شد"); refresh();
    }],
    ["📎 پیوست‌ها", () => { $("#modal").close(); location.hash = `#archive?tag=${encodeURIComponent("سند:" + rec.id)}`; }],
    ...(rec.owner_phone ? [["📞 تماس با صاحب سند", () => (location.href = `tel:${enDigits(rec.owner_phone)}`)]] : []),
    ...(rec.renew_log ? [["🕘 سابقه‌ی تمدید", () => alert(rec.renew_log)]] : []),
  ] : [],
  contacts: (rec) => rec ? [["📞 امروز تماس گرفتم", async () => {
    await api(`/api/contacts/${rec.id}`, { method: "PATCH", body: { last_contact: META.today } });
    $("#modal").close(); toast("ثبت شد"); refresh();
  }]] : [],
  notes: (rec) => rec ? [
    ["📝 تبدیل به سوژه", async () => {
      const s = await api("/api/stories", { method: "POST", body: { title: rec.title, notes: rec.content } });
      $("#modal").close(); toast("سوژه ساخته شد"); invalidateRefs(); openForm("stories", s);
    }],
    ["✍️ باز کردن در ویرایشگر", () => { $("#modal").close(); location.hash = `#tools?note=${rec.id}`; }],
  ] : [],
};

async function openForm(e, rec, preset = {}) {
  await loadRefs();
  const s = schema(e);
  const modal = $("#modal");
  $("#modal-title").textContent = rec ? `${s.icon} ویرایش ${s.label}` : `${s.icon} ${s.label} جدید`;
  $("#modal-error").textContent = "";
  const defaults = {};
  if (!rec) {
    for (const f of s.fields) {
      if (f.default !== null && !f.system) defaults[f.name] = f.default;
      if (f.type === "date" && f.name === s.date_field && ["tx_date", "start_date"].includes(f.name)) defaults[f.name] = META.today;
    }
    Object.assign(defaults, preset);
  }
  const values = rec ? { ...rec, ...preset } : defaults;
  const fields = s.fields.filter((f) => !f.system);
  const basic = fields.filter((f) => !f.advanced);
  const adv = fields.filter((f) => f.advanced);
  const advOpen = rec && adv.some((f) => values[f.name] && values[f.name] !== f.default);
  $("#modal-body").innerHTML = basic.map((f) => fieldHTML(e, f, values)).join("") +
    (adv.length ? `<details ${advOpen ? "open" : ""}><summary>${e === "stories" ? "انتشار و دستمزد" : "بیشتر"}</summary><div class="form-grid">${adv.map((f) => fieldHTML(e, f, values)).join("")}</div></details>` : "");
  const extras = (FORM_EXTRAS[e]?.(rec) || []);
  $("#modal-extra").innerHTML = extras.map(([l], i) => `<button type="button" class="btn sm" data-x="${i}">${l}</button>`).join("");
  $$("[data-x]", $("#modal-extra")).forEach((b) => (b.onclick = async () => {
    try { await extras[Number(b.dataset.x)][1](); } catch (err) { $("#modal-error").textContent = err.message; }
  }));
  const form = $("#modal-form");
  // اعداد با جداکننده‌ی هزارگان
  $$("[data-num]", form).forEach((el) => el.addEventListener("input", () => {
    const digits = enDigits(el.value).replace(/[^\d]/g, "");
    el.value = digits ? Number(digits).toLocaleString("en-US") : "";
    const hint = $(`[data-hint="${el.name}"]`, form);
    if (hint) hint.textContent = digits ? moneyShort(Number(digits)) : "";
  }));
  // دکمه‌های تاریخ
  $$("[data-dp]", form).forEach((b) => (b.onclick = () => {
    const inp = form.elements[b.dataset.dp];
    pickDate(inp.value, !!b.dataset.time, (val) => { inp.value = val; inp.dispatchEvent(new Event("change")); });
  }));
  $$("[data-dq]", form).forEach((box) => box.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    const inp = form.elements[box.dataset.dq];
    if (b.dataset.h) {
      const d = new Date(Date.now() + 3600000 * Number(b.dataset.h));
      inp.value = `${Jalali.fromDate(d)} ${Jalali.pad(d.getHours())}:${Jalali.pad(d.getMinutes())}`;
    } else {
      const date = Jalali.addDays(META.today, Number(b.dataset.d));
      inp.value = box.dataset.time ? `${date} ${b.dataset.t || "09:00"}` : date;
    }
  }));
  // «هر چند روز؟» فقط وقتی تکرارِ دلخواه انتخاب شده
  if (e === "reminders" && form.elements.repeat_days) {
    const box = form.elements.repeat_days.closest("label") || form.elements.repeat_days.parentElement;
    const sync = () => { box.hidden = form.elements.repeat.value !== "every_n"; };
    form.elements.repeat.addEventListener("change", sync);
    sync();
  }
  // پیش‌فرض دستمزد از رسانه
  if (e === "stories" && form.elements.outlet_id) {
    form.elements.outlet_id.addEventListener("change", () => {
      const o = REFS.outlets.find((x) => String(x.id) === form.elements.outlet_id.value);
      if (o?.default_fee && !form.elements.fee.value) {
        form.elements.fee.value = Number(o.default_fee).toLocaleString("en-US");
        form.elements.fee.dispatchEvent(new Event("input"));
      }
    });
  }
  $("#modal-delete").hidden = !rec;
  $("#modal-delete").onclick = async () => {
    if (!confirm(`این ${s.label} حذف شود؟`)) return;
    try {
      await api(`/api/${e}/${rec.id}`, { method: "DELETE" });
      modal.close();
      toast("حذف شد");
      invalidateRefs();
      refresh();
    } catch (err) { $("#modal-error").textContent = err.message; }
  };
  $("#modal-cancel").onclick = () => modal.close();
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const body = {};
    for (const f of fields) {
      const el = form.elements[f.name];
      if (!el) continue;
      let v = el.value.trim();
      if (el.dataset.num !== undefined) v = v.replace(/,/g, "");
      if (["date", "datetime"].includes(f.type)) v = enDigits(v);
      body[f.name] = v === "" ? null : v;
    }
    if (rec) for (const k of Object.keys(body)) if (String(body[k] ?? "") === String(rec[k] ?? "")) delete body[k];
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      const saved = rec ? await api(`/api/${e}/${rec.id}`, { method: "PATCH", body }) : await api(`/api/${e}`, { method: "POST", body });
      modal.close();
      toast(e === "stories" && !rec ? "سوژه ثبت شد ✔" : "ذخیره شد ✔");
      if (e === "stories" && rec && body.paid_amount) toast("✔ دریافتی در بخش مالی هم ثبت شد");
      invalidateRefs();
      onSaved?.(e, saved);
      refresh();
    } catch (err) { $("#modal-error").textContent = err.message; }
    btn.disabled = false;
  };
  if (!modal.open) modal.showModal();
  if (!rec) setTimeout(() => form.querySelector("input:not([type=hidden]),textarea")?.focus(), 50);
}
let onSaved = null;

// ═════════════════════════ انتخاب تاریخ شمسی ═════════════════════════
function pickDate(current, withTime, done) {
  const dlg = $("#datepicker");
  const cur = Jalali.parse(enDigits(current)) || Jalali.parse(META.today);
  let [y, m] = cur;
  let sel = Jalali.parse(enDigits(current)) ? Jalali.fmt(...cur) : null;
  let time = (enDigits(current).match(/\d{1,2}:\d{2}/) || ["09:00"])[0];
  const draw = () => {
    const first = Jalali.fmt(y, m, 1);
    const off = Jalali.weekCol(first);
    const n = Jalali.monthLength(y, m);
    let cells = Jalali.WEEK.map((w) => `<div class="wd">${w}</div>`).join("");
    cells += "<div></div>".repeat(off);
    for (let d = 1; d <= n; d++) {
      const s = Jalali.fmt(y, m, d);
      cells += `<button type="button" data-day="${s}" class="${s === META.today ? "today" : ""} ${s === sel ? "sel" : ""}">${num(d)}</button>`;
    }
    dlg.innerHTML = `<div class="dp-head"><button class="btn sm" data-mv="-1">→</button><b>${Jalali.MONTHS[m - 1]} ${num(y)}</b><button class="btn sm" data-mv="1">←</button></div>
      <div class="dp-grid">${cells}</div>
      ${withTime ? `<div class="dp-time">ساعت <input type="time" id="dp-time" value="${time}" class="ltr"></div>` : ""}
      <div class="dp-time"><button class="btn primary" id="dp-ok">تأیید</button><button class="btn" id="dp-today">امروز</button><button class="btn" id="dp-cancel">بستن</button></div>`;
    $$("[data-mv]", dlg).forEach((b) => (b.onclick = () => { m += Number(b.dataset.mv); if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } draw(); }));
    $$("[data-day]", dlg).forEach((b) => (b.onclick = () => { sel = b.dataset.day; if (!withTime) finish(); else draw(); }));
    $("#dp-ok", dlg).onclick = () => finish();
    $("#dp-today", dlg).onclick = () => { sel = META.today; [y, m] = Jalali.parse(sel); if (!withTime) finish(); else draw(); };
    $("#dp-cancel", dlg).onclick = () => dlg.close();
    if (withTime) $("#dp-time", dlg).onchange = (ev) => (time = ev.target.value);
  };
  const finish = () => {
    if (!sel) return dlg.close();
    if (withTime) time = $("#dp-time", dlg).value || time;
    done(withTime ? `${sel} ${time}` : sel);
    dlg.close();
  };
  draw();
  dlg.showModal();
}

// ═════════════════════════ خانه ═════════════════════════
VIEWS.home = async (view) => {
  const d = await api("/api/dashboard");
  const list = (rows, empty, e = "stories") => rows.length ? `<div class="list mini">${rows.map((r) => itemHTML(e, r)).join("")}</div>` : `<div class="empty">${empty}</div>`;
  const inWork = (d.by_status.research || 0) + (d.by_status.writing || 0) + (d.by_status.editing || 0);
  view.innerHTML = `
    ${!META.password_set ? `<div class="warn-bar">⚠️ رمز عبور تنظیم نشده و هر کسی نشانی برنامه را داشته باشد می‌تواند واردش شود. طبق راهنما متغیر <code>ZOZO_PASSWORD</code> را در لیارا تنظیم کنید.</div>` : ""}
    <div class="quick-actions">
      <button data-q="story">📝 سوژه‌ی جدید</button>
      <button data-q="reminder">⏰ یادآوری</button>
      <button data-q="idea">💡 ایده</button>
      <button data-q="teaser">🎬 تیزر</button>
      <button data-q="post">🖼️ پست</button>
      <button data-q="asr">🎙️ صوت به متن</button>
      <button data-q="ocr">📄 عکس به متن</button>
      <button data-q="income">➕ دریافتی</button>
      <button data-q="expense">➖ هزینه</button>
      <button data-q="contact">👤 منبع جدید</button>
    </div>
    <div class="stats">
      <div class="stat ${d.overdue.length ? "bad" : ""}" data-go="#stories"><div class="v">${num(d.overdue.length)}</div><div class="l">مهلت گذشته</div></div>
      <div class="stat ${d.due_today.length ? "warn" : ""}" data-go="#stories"><div class="v">${num(d.due_today.length)}</div><div class="l">تحویل امروز</div></div>
      <div class="stat" data-go="#stories"><div class="v">${num(inWork)}</div><div class="l">در دست کار</div></div>
      <div class="stat good" data-go="#stories"><div class="v">${num(d.month.published)}</div><div class="l">منتشرشده در ${esc(d.month.label.split(" ")[0])}</div></div>
      <div class="stat good" data-go="#finance"><div class="v">${moneyWords(d.month.income)}</div><div class="l">درآمد این ماه (${META.currency})</div></div>
      <div class="stat ${d.month.receivable ? "warn" : ""}" data-go="#finance"><div class="v">${moneyWords(d.month.receivable)}</div><div class="l">طلب دریافت‌نشده</div></div>
    </div>
    <div class="grid">
      ${d.overdue.length ? `<div class="card"><h3>🔴 مهلت گذشته <span class="count">${num(d.overdue.length)}</span></h3>${list(d.overdue, "")}</div>` : ""}
      <div class="card"><h3>📌 تحویل امروز <span class="count">${num(d.due_today.length)}</span></h3>${list(d.due_today, "امروز مهلت تحویلی ندارید.")}</div>
      <div class="card"><h3>⏰ یادآوری‌ها <a class="small" href="#reminders">همه</a></h3>${list(d.reminders, "یادآوری نزدیکی ندارید.", "reminders")}</div>
      <div class="card"><h3>🗓 هفت روز آینده <span class="count">${num(d.upcoming.length)}</span></h3>${list(d.upcoming, "مهلتی در هفته‌ی آینده نیست.")}</div>
      ${d.in_progress.length ? `<div class="card"><h3>✍️ در دست کار (بدون مهلت نزدیک)</h3>${list(d.in_progress, "")}</div>` : ""}
      ${d.teasers.length ? `<div class="card"><h3>🎬 تیزرهای در حال ساخت</h3>${d.teasers.map((t) => `<div class="row" data-go="#teaser"><span>${esc(t.title)}</span><span>${t.status === "queued" ? "در صف" : num(Math.round(t.progress * 100)) + "٪"}</span></div>`).join("")}</div>` : ""}
      <div class="card"><h3>📡 خبرهای مرتبط با کلیدواژه‌ها <a class="small" href="#news?matched=1">همه</a></h3>
        ${d.matched_news.length ? d.matched_news.map((n) => `<div class="row"><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a><span class="badge">${esc(n.matched)}</span></div>`).join("") : `<div class="empty">خبری پیدا نشده. از بخش <a href="#keywords">کلیدواژه‌ها</a> موضوع‌های مورد علاقه را اضافه کنید.</div>`}
      </div>
      <div class="card"><h3>💡 آخرین ایده‌ها <a class="small" href="#notes">همه</a></h3>
        ${d.ideas.length ? d.ideas.map((n) => `<div class="row" data-go="#notes?id=${n.id}"><span>${esc(n.title)}</span><span class="small muted">${relTime(n.created_at)}</span></div>`).join("") : `<div class="empty">ایده‌ها را سریع با دکمه‌ی «💡 ایده» یا از طریق ربات بله ثبت کنید.</div>`}
      </div>
    </div>`;
  $(".quick-actions", view).onclick = (ev) => {
    const b = ev.target.closest("[data-q]");
    if (!b) return;
    const q = b.dataset.q;
    if (q === "story") openForm("stories");
    else if (q === "reminder") openForm("reminders");
    else if (q === "idea") openForm("notes", null, { kind: "idea" });
    else if (q === "teaser") location.hash = "#teaser";
    else if (q === "post") location.hash = "#post";
    else if (q === "asr") location.hash = "#transcribe";
    else if (q === "ocr") location.hash = "#ocr";
    else if (q === "income") openForm("transactions", null, { kind: "income" });
    else if (q === "expense") openForm("transactions", null, { kind: "expense", category: "" });
    else if (q === "contact") openForm("contacts");
  };
};

// ═════════════════════════ بیشتر ═════════════════════════
VIEWS.more = async (view) => {
  view.innerHTML = `<div class="page-title"><h2>☰ همه‌ی بخش‌ها</h2></div>
    <div class="more-grid">${NAV_MORE.map(([k, i, l, d]) => `<a href="#${k}"><span class="i">${i}</span><b>${l}</b><small>${d}</small></a>`).join("")}</div>`;
};

// ═════════════════════════ تقویم ═════════════════════════
VIEWS.calendar = async (view, params) => {
  const month = params.get("m") || META.today.slice(0, 7);
  const c = await api(`/api/calendar?month=${month}`);
  const sel = params.get("d") || (c.today.startsWith(month) ? c.today : `${month}/01`);
  let cells = Jalali.WEEK.map((w) => `<div class="wd">${w}</div>`).join("") + "<div></div>".repeat(c.first_weekday);
  for (let d = 1; d <= c.days; d++) {
    const date = `${month}/${Jalali.pad(d)}`;
    const evs = c.events.filter((e) => e.date === date);
    const col = (c.first_weekday + d - 1) % 7;
    cells += `<div class="day ${date === c.today ? "today" : ""} ${date === sel ? "sel" : ""} ${col === 6 ? "fri" : ""}" data-day="${date}">
      <div class="n">${num(d)}</div>${evs.slice(0, 3).map((e) => `<div class="ev ${e.kind} ${e.done ? "done" : ""}">${esc(e.title)}</div>`).join("")}${evs.length > 3 ? `<div class="small muted">+${num(evs.length - 3)}</div>` : ""}
    </div>`;
  }
  const dayEvents = c.events.filter((e) => e.date === sel);
  const KIND = { deadline: "⏳ مهلت", reminder: "⏰ یادآوری", published: "✅ انتشار", contract: "📑 قرارداد", salary: "💵 حقوق" };
  view.innerHTML = `
    <div class="page-title"><h2>📅 تقویم</h2>
      <div class="btn-row"><a class="btn" href="#calendar?m=${c.prev}">→</a><b>${esc(c.label)}</b><a class="btn" href="#calendar?m=${c.next}">←</a>
      ${month !== c.today.slice(0, 7) ? `<a class="btn sm" href="#calendar">امروز</a>` : ""}</div></div>
    <div class="cal">${cells}</div>
    <div class="card" style="margin-top:12px">
      <h3>${esc(Jalali.MONTHS[Number(sel.slice(5, 7)) - 1])} ${num(Number(sel.slice(8)))} <span class="btn-row">
        <button class="btn sm" id="c-story">+ سوژه با این مهلت</button><button class="btn sm" id="c-rem">+ یادآوری</button></span></h3>
      ${dayEvents.length ? `<div class="list mini">${dayEvents.map((e) => `<div class="item ${e.done ? "done" : ""}" data-entity="${e.entity}" data-id="${e.id}"><div class="body"><div class="title">${esc(e.title)}</div>
        <div class="meta"><span class="badge ${e.kind === "deadline" ? "primary" : e.kind === "published" ? "green" : e.kind === "reminder" ? "" : "amber"}">${KIND[e.kind]}</span>${e.time ? `<span>${fa(e.time)}</span>` : ""}${e.repeat ? "<span>🔁</span>" : ""}</div></div></div>`).join("")}</div>` : `<div class="empty">برای این روز چیزی ثبت نشده.</div>`}
    </div>`;
  $$(".day[data-day]", view).forEach((el) => (el.onclick = () => (location.hash = `#calendar?m=${month}&d=${el.dataset.day}`)));
  $("#c-story").onclick = () => openForm("stories", null, { deadline: sel });
  $("#c-rem").onclick = () => openForm("reminders", null, { remind_at: `${sel} 09:00` });
};

// ═════════════════════════ مالی ═════════════════════════
function barChart(series) {
  const max = Math.max(1, ...series.flatMap((s) => [s.income, s.expense]));
  const W = 720, H = 220, pad = 28, bw = (W - pad * 2) / series.length;
  const y = (v) => H - 30 - ((H - 50) * v) / max;
  const bars = series.map((s, i) => {
    const x = W - pad - (i + 1) * bw; // راست‌به‌چپ: قدیمی‌ترین در راست
    const w = Math.max(4, bw * 0.34);
    return `<g><title>${s.label}: درآمد ${num(s.income)} — هزینه ${num(s.expense)}</title>
      <rect x="${x + bw * 0.5}" y="${y(s.income)}" width="${w}" height="${H - 30 - y(s.income)}" rx="3" fill="var(--ok)"/>
      <rect x="${x + bw * 0.5 - w}" y="${y(s.expense)}" width="${w}" height="${H - 30 - y(s.expense)}" rx="3" fill="var(--danger)" opacity=".75"/>
      <text x="${x + bw / 2}" y="${H - 10}" font-size="11" text-anchor="middle" fill="var(--muted)">${s.label.split(" ")[0]}</text></g>`;
  }).join("");
  const grid = [0.25, 0.5, 0.75, 1].map((f) => `<line x1="${pad}" x2="${W - pad}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="var(--line)"/><text x="${W - 2}" y="${y(max * f) + 4}" font-size="10" text-anchor="end" fill="var(--muted)">${moneyWords(max * f)}</text>`).join("");
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" font-family="Vazirmatn, Tahoma" style="direction:ltr">${grid}${bars}</svg></div>
    <div class="legend"><span><i style="background:var(--ok)"></i>درآمد</span><span><i style="background:var(--danger)"></i>هزینه</span></div>`;
}

function hbars(rows, cls = "") {
  if (!rows.length) return `<div class="empty">موردی نیست.</div>`;
  const max = Math.max(...rows.map((r) => r.total));
  return rows.map((r) => `<div class="hbar ${cls}"><span>${esc(r.name)}</span><div class="bar"><span style="width:${(100 * r.total) / max}%"></span></div><b class="small">${moneyWords(r.total)}</b></div>`).join("");
}

async function financeMonthView(view, params) {
  const month = params.get("m") || "";
  const f = await api(`/api/finance${month ? `?month=${month}` : ""}`);
  const r = f.receivables;
  view.innerHTML = `
    <div class="page-title"><h2>💰 مالی</h2>${financeTabs("month")}
      <div class="btn-row"><a class="btn" href="#finance?m=${f.prev_month}">→</a><b>${esc(f.month_label)}</b><a class="btn" href="#finance?m=${f.next_month}">←</a></div></div>
    <div class="quick-actions">
      <button id="f-inc">➕ ثبت دریافتی</button><button id="f-exp">➖ ثبت هزینه</button>
      <button data-go="#invoices">🧾 صدور فاکتور</button><button data-go="#legal_docs">📜 اسناد و سررسیدها</button>
      <button data-go="#transactions">💳 همه‌ی تراکنش‌ها</button><button data-go="#contracts">📑 قراردادها</button><button data-go="#outlets">🏢 رسانه‌ها</button>
      <button id="f-csv">⬇️ خروجی اکسل این ماه</button>
    </div>
    <div class="stats">
      <div class="stat good"><div class="v">${moneyWords(f.income)}</div><div class="l">درآمد ${esc(f.month_label)}</div></div>
      <div class="stat bad"><div class="v">${moneyWords(f.expense)}</div><div class="l">هزینه ${esc(f.month_label)}</div></div>
      <div class="stat ${f.net < 0 ? "bad" : ""}"><div class="v">${moneyWords(f.net)}</div><div class="l">خالص این ماه</div></div>
      <div class="stat warn"><div class="v">${moneyWords(r.total)}</div><div class="l">طلب دریافت‌نشده</div></div>
      <div class="stat"><div class="v">${moneyWords(f.avg_income)}</div><div class="l">میانگین درآمد ماهانه (۱۲ ماه)</div></div>
    </div>
    <div class="card"><h3>📊 دوازده ماه گذشته <small>واحد: ${META.currency}</small></h3>${barChart(f.series)}</div>
    <div class="grid">
      ${f.salaries.length ? `<div class="card"><h3>💵 حقوق‌های ثابت این ماه</h3>${f.salaries.map((s) => `<div class="row"><span>${esc(s.name)}${s.pay_day ? ` <small class="muted">(روز ${num(s.pay_day)})</small>` : ""}</span>
        ${s.received >= s.expected ? `<span class="badge green">دریافت شد ✓</span>` : `<span>${s.received ? `<span class="badge amber">${moneyWords(s.received)} از ${moneyWords(s.expected)}</span>` : `<span class="badge red">دریافت نشده</span>`} <button class="btn sm" data-sal="${s.id}">ثبت دریافت</button></span>`}</div>`).join("")}</div>` : ""}
      <div class="card"><h3>🧾 طلب‌ها <span class="count">${moneyShort(r.total)}</span></h3>
        ${r.stories.length || r.contracts.length || r.invoices.length ? `${r.stories.map((s) => `<div class="row"><span><a href="#stories?id=${s.id}">${esc(s.title)}</a><br><small class="muted">${esc(s.outlet_name || "")} ${s.published_date ? "· " + fa(s.published_date) : ""}</small></span><span class="btn-row"><b>${moneyWords(s.due)}</b><button class="btn sm" data-paid="${s.id}">دریافت شد</button></span></div>`).join("")}
        ${r.contracts.map((c) => `<div class="row"><span><a href="#contracts?id=${c.id}">📑 ${esc(c.title)}</a><br><small class="muted">${esc(c.outlet_name || "")}</small></span><b>${moneyWords(c.due)}</b></div>`).join("")}
        ${r.invoices.map((v) => `<div class="row"><span><a href="#invoices?id=${v.id}">🧾 ${esc(v.customer || "صورتحساب")}</a><br><small class="muted">${fa(v.number)}${v.paid ? ` · پرداخت‌شده ${moneyWords(v.paid)}` : ""}</small></span><b>${moneyWords(v.due)}</b></div>`).join("")}` : `<div class="empty">طلبی ندارید. 🎉<br>برای پیگیری دستمزد، در فرم هر سوژه بخش «انتشار و دستمزد» را پر کنید.</div>`}
      </div>
      <div class="card"><h3>📰 کارکرد ${esc(f.month_label)}</h3>
        ${f.work.length ? f.work.map((w) => `<div class="row"><span>${esc(w.outlet)}</span><span>${num(w.n)} کار ${w.fees ? `· ${moneyWords(w.fees)}` : ""}</span></div>`).join("") : `<div class="empty">در این ماه کاری منتشر یا تحویل نشده.</div>`}
      </div>
      ${f.legal_due.length ? `<div class="card"><h3>📜 سررسید اسناد (۶۰ روز آینده) <a class="small" href="#legal_docs">همه</a></h3>${f.legal_due.map((r) => `<div class="row" data-go="#legal_docs?id=${r.id}"><span>${esc(r.title)}${r.owner_name ? ` <small class="muted">(${esc(r.owner_name)})</small>` : ""}</span>${deadlineBadge(r.expiry_date, null, r.status !== "active")}</div>`).join("")}</div>` : ""}
      <div class="card"><h3>🏢 درآمد به تفکیک رسانه <small>۱۲ ماه</small></h3>${hbars(f.by_outlet)}</div>
      <div class="card"><h3>📥 منابع درآمد این ماه</h3>${hbars(f.income_categories)}</div>
      <div class="card"><h3>📤 هزینه‌های این ماه</h3>${hbars(f.expense_categories, "exp")}</div>
    </div>`;
  $("#f-inc").onclick = () => openForm("transactions", null, { kind: "income" });
  $("#f-exp").onclick = () => openForm("transactions", null, { kind: "expense" });
  $("#f-csv").onclick = () => (location.href = `/api/finance/csv?month=${f.month}`);
  $$("[data-sal]", view).forEach((b) => (b.onclick = async () => {
    await loadRefs();
    const o = REFS.outlets.find((x) => x.id === Number(b.dataset.sal));
    const s = f.salaries.find((x) => x.id === o.id);
    openForm("transactions", null, { kind: "income", amount: s.expected - s.received, category: "حقوق", outlet_id: o.id, description: `حقوق ${f.month_label} — ${o.name}` });
  }));
  $$("[data-paid]", view).forEach((b) => (b.onclick = async () => {
    await api(`/api/stories/${b.dataset.paid}`, { method: "PATCH", body: { pay_status: "paid" } });
    toast("✔ دریافتی ثبت شد");
    refresh();
  }));
}

// ═════════════════════════ بایگانی اسناد ═════════════════════════
const archive = { q: "", cat: "", results: null };
const KIND_ICON = { pdf: "📕", image: "🖼️", docx: "📘", text: "📄", audio: "🎙️", video: "🎞️", other: "📦" };
const STATUS_FA = { queued: "در صف", processing: "در حال خواندن", ready: "آماده", error: "خطا" };

function normFa(s) {
  return String(s || "").replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[ۀة]/g, "ه").replace(/[أإآ]/g, "ا")
    .replace(/[ً-ٰـ‌]/g, "").replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).toLowerCase();
}
function markTerms(text, terms) {
  if (!terms || !terms.length) return esc(text);
  return String(text).split(/(\s+)/).map((w) => {
    const n = normFa(w).replace(/[^\p{L}\p{N}]/gu, "");
    return n && terms.some((t) => n.startsWith(t)) ? `<mark>${esc(w)}</mark>` : esc(w);
  }).join("");
}

VIEWS.archive = async (view, params) => {
  const storyId = params.get("story") || "";
  const tagFilter = params.get("tag") || "";
  const qs = new URLSearchParams();
  if (tagFilter) qs.set("tag", tagFilter);
  if (archive.cat) qs.set("category", archive.cat);
  if (storyId) qs.set("story_id", storyId);
  const [data] = await Promise.all([api(`/api/documents?${qs}`), loadRefs()]);
  const { documents: docs, stats } = data;
  const pending = docs.some((d) => ["queued", "processing"].includes(d.status));
  const story = storyId ? REFS.stories.find((s) => String(s.id) === storyId) : null;
  const cats = META.doc_categories;
  const docHTML = (d) => {
    const prog = d.status === "processing" && d.pages ? Math.round((100 * d.pages_done) / d.pages) : null;
    return `<div class="item" data-doc="${d.id}">
      <span class="doc-icon">${KIND_ICON[d.kind] || "📄"}</span>
      <div class="body">
        <div class="title">${esc(d.title)}</div>
        <div class="meta">
          <span class="badge">${esc(cats[d.category] || d.category || "")}</span>
          ${d.doc_date ? `<span>${fa(d.doc_date)}</span>` : ""}
          ${["pdf", "docx", "text", "image"].includes(d.kind) && d.status !== "ready" ? `<span class="badge ${d.status === "error" ? "red" : "amber"}">${STATUS_FA[d.status]}${prog !== null ? " " + num(prog) + "٪" : ""}</span>` : ""}
          ${d.pages > 1 ? `<span>${num(d.pages)} صفحه</span>` : ""}
          ${d.ocr_pages ? `<span title="از روی تصویر خوانده شد">🔍 OCR</span>` : ""}
          <span>${d.size > 1048576 ? num((d.size / 1048576).toFixed(1)) + " MB" : num(Math.ceil(d.size / 1024)) + " KB"}</span>
          ${d.story_name ? `<span>📝 ${esc(d.story_name)}</span>` : ""}
          ${d.tags ? `<span>🏷 ${esc(d.tags)}</span>` : ""}
        </div>
        ${d.notes ? `<div class="snippet">${esc(d.notes)}</div>` : ""}
        ${d.error ? `<div class="error">${esc(d.error)}</div>` : ""}
      </div>
    </div>`;
  };
  view.innerHTML = `
    <div class="page-title"><h2>🗄️ بایگانی اسناد ${story ? `<small class="muted">— ${esc(story.title)}</small>` : ""}</h2>
      ${storyId || tagFilter ? `<a class="btn sm" href="#archive">همه‌ی اسناد</a>` : ""}</div>
    <form class="search-big" id="a-search"><input type="search" name="q" placeholder="جستجو در متن همه‌ی اسناد…" value="${esc(archive.q)}"><button class="btn primary">جستجو</button></form>
    <div class="chips"><button class="chip ${!archive.cat ? "active" : ""}" data-cat="">همه</button>${Object.entries(cats).map(([k, l]) => `<button class="chip ${archive.cat === k ? "active" : ""}" data-cat="${k}">${esc(l)}</button>`).join("")}</div>
    <div id="a-results"></div>
    <details class="card" ${docs.length ? "" : "open"} id="a-up-card"><summary><b>⬆️ افزودن سند</b> <span class="muted small">PDF (حتی اسکن‌شده)، عکس، Word، صوت مصاحبه، ویدیو، …</span></summary>
      <div class="form-grid" style="margin-top:10px">
        <label>دسته<select id="u-cat"><option value="">خودکار</option>${Object.entries(cats).map(([k, l]) => `<option value="${k}" ${archive.cat === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
        <label>مربوط به سوژه<select id="u-story"><option value=""></option>${REFS.stories.map((s) => `<option value="${s.id}" ${String(s.id) === storyId ? "selected" : ""}>${esc(s.title)}</option>`).join("")}</select></label>
        <label>برچسب‌ها<input id="u-tags" placeholder="با ویرگول جدا کنید" value="${esc(tagFilter)}"></label>
        <label>تاریخ سند<div class="date-wrap"><input id="u-date" placeholder="${fa(META.today)}"><button type="button" id="u-dp">📅</button></div></label>
        <label class="wide">توضیح<textarea id="u-notes" rows="2" placeholder="مثلاً: متن کامل مصاحبه با مدیرکل…"></textarea></label>
      </div>
      <label class="drop" id="drop">
        <input type="file" id="files" multiple hidden>
        <b>فایل‌ها را اینجا رها کنید یا بزنید تا انتخاب کنید</b>
        <small>حداکثر ${num(META.max_upload_mb)} مگابایت برای هر فایل · متن PDF و عکس‌ها خودکار خوانده و قابل جستجو می‌شود</small>
        <div class="progress" id="up-prog" hidden><span style="width:0"></span></div>
      </label>
    </details>
    <div class="card"><h3>📚 اسناد <span class="count">${num(docs.length)} سند · ${num(Math.round(stats.size / 1048576))} MB ${stats.ocr ? "" : " · OCR نصب نیست"}</span></h3>
      <div class="list">${docs.map(docHTML).join("") || `<div class="empty">سندی در این بخش نیست.</div>`}</div>
    </div>`;

  const showResults = () => {
    const box = $("#a-results");
    const r = archive.results;
    if (!r) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="card"><h3>نتیجه‌های «${esc(r.query)}» <button class="btn sm" id="a-clear">✕</button></h3>
      ${r.results.length ? `<div class="list">${r.results.map((x) => `<div class="result">
        <div><b>${KIND_ICON[x.kind] || "📄"} ${esc(x.title)}</b> ${x.page ? `<span class="badge">صفحه ${num(x.page)}</span>` : `<span class="badge gray">مشخصات سند</span>`}
          ${x.method === "ocr" ? `<span class="badge amber" title="از روی تصویر خوانده شده؛ ممکن است غلط داشته باشد">OCR</span>` : ""}</div>
        <div class="src-text">${markTerms(x.text, r.terms)}</div>
        <div class="btn-row">${["pdf", "image"].includes(x.kind) && x.page ? `<button class="btn sm" data-page="${x.doc_id}:${x.page}:${x.kind}">🖼 دیدن صفحه</button>` : ""}
          <a class="btn sm" href="/api/documents/${x.doc_id}/file${x.kind === "pdf" ? "#page=" + x.page : ""}" target="_blank">📄 باز کردن فایل</a></div>
      </div>`).join("")}</div>` : `<div class="empty">چیزی پیدا نشد. واژه‌ی دیگری امتحان کنید.</div>`}</div>`;
    $("#a-clear").onclick = () => { archive.results = null; archive.q = ""; $("#a-search").q.value = ""; showResults(); };
    $$("[data-page]", box).forEach((b) => (b.onclick = () => { const [id, p, k] = b.dataset.page.split(":"); showPage(Number(id), Number(p), k); }));
  };
  showResults();
  $("#a-search").onsubmit = async (ev) => {
    ev.preventDefault();
    archive.q = ev.target.q.value.trim();
    if (!archive.q) { archive.results = null; showResults(); return; }
    $("#a-results").innerHTML = `<div class="card empty">در حال جستجو…</div>`;
    archive.results = await api(`/api/documents/search?q=${encodeURIComponent(archive.q)}${archive.cat ? `&category=${archive.cat}` : ""}`);
    showResults();
  };
  $$("[data-cat]", view).forEach((b) => (b.onclick = () => { archive.cat = b.dataset.cat; refresh(); }));
  $("#u-dp").onclick = () => pickDate($("#u-date").value, false, (v) => ($("#u-date").value = v));
  const input = $("#files"), drop = $("#drop");
  input.onchange = () => uploadDocs(input.files);
  drop.addEventListener("dragover", (ev) => { ev.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (ev) => { ev.preventDefault(); drop.classList.remove("over"); uploadDocs(ev.dataTransfer.files); });
  $$("[data-doc]", view).forEach((el) => (el.onclick = () => openDoc(docs.find((d) => d.id === Number(el.dataset.doc)))));
  clearTimeout(VIEWS.archive._poll);
  if (pending) VIEWS.archive._poll = setTimeout(() => { if (currentPage === "archive" && !$("#modal").open && !$("#dlg").open) refresh(); }, 4000);
};

function uploadOne(url, file, fields, onProgress) {
  return new Promise((resolve) => {
    const fd = new FormData();
    fd.append("files", file);
    for (const [k, v] of Object.entries(fields || {})) if (v) fd.append(k, v);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* */ }
      if (xhr.status === 413) resolve({ ok: false, error: "حجم فایل برای سرور زیاد است" });
      else if (xhr.status >= 300) resolve({ ok: false, error: data.detail || "بارگذاری ناموفق بود" });
      else if (data.errors?.length && !data.added?.length) resolve({ ok: false, error: data.errors.join("، ") });
      else resolve({ ok: true, data, duplicate: !!data.added?.[0]?.duplicate });
    };
    xhr.onerror = () => resolve({ ok: false, error: "اتصال قطع شد" });
    xhr.send(fd);
  });
}

async function uploadDocs(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const prog = $("#up-prog"), label = $("#drop b");
  prog.hidden = false;
  const fields = { category: $("#u-cat").value, story_id: $("#u-story").value, tags: $("#u-tags").value, notes: $("#u-notes").value, doc_date: enDigits($("#u-date").value) };
  let ok = 0, dup = 0;
  const failed = [];
  for (let i = 0; i < files.length; i++) {
    label.textContent = `در حال بارگذاری ${num(i + 1)} از ${num(files.length)}: ${files[i].name}`;
    const r = await uploadOne("/api/documents", files[i], fields, (fr) => (prog.firstElementChild.style.width = `${(100 * (i + fr)) / files.length}%`));
    if (r.ok) { ok++; if (r.duplicate) dup++; } else failed.push(`${files[i].name} (${r.error})`);
  }
  let msg = `${num(ok - dup)} فایل بارگذاری شد`;
  if (dup) msg += ` · ${num(dup)} فایل تکراری بود`;
  if (failed.length) msg += ` · ناموفق: ${failed.join("، ")}`;
  toast(msg, 5000);
  refresh();
}

function openDoc(d) {
  const dlg = $("#dlg");
  const cats = META.doc_categories;
  const url = `/api/documents/${d.id}/file`;
  let player = "";
  if (d.kind === "audio") player = `<audio controls preload="none" src="${url}" style="width:100%"></audio>`;
  if (d.kind === "video") player = `<video controls preload="metadata" src="${url}" style="width:100%;max-height:50vh;border-radius:10px"></video>`;
  if (d.kind === "image") player = `<img src="${url}" style="width:100%;border-radius:10px" alt="">`;
  $("#dlg-body").innerHTML = `
    <h3>${KIND_ICON[d.kind] || "📄"} ${esc(d.title)}</h3>
    ${player}
    <div class="form-grid" style="margin-top:10px">
      <label class="wide">عنوان<input id="d-title" value="${esc(d.title)}"></label>
      <label>دسته<select id="d-cat">${Object.entries(cats).map(([k, l]) => `<option value="${k}" ${d.category === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <label>تاریخ سند<input id="d-date" value="${esc(d.doc_date || "")}"></label>
      <label>مربوط به سوژه<select id="d-story"><option value=""></option>${REFS.stories.map((s) => `<option value="${s.id}" ${s.id === d.story_id ? "selected" : ""}>${esc(s.title)}</option>`).join("")}</select></label>
      <label>برچسب‌ها<input id="d-tags" value="${esc(d.tags || "")}"></label>
      <label class="wide">توضیح / خلاصه (در جستجو هم پیدا می‌شود)<textarea id="d-notes" rows="4">${esc(d.notes || "")}</textarea></label>
    </div>
    <p class="muted small">${esc(d.filename)} · افزوده‌شده ${relTime(d.created_at)}</p>
    <div class="modal-actions">
      <button class="btn primary" id="d-save">ذخیره</button>
      <a class="btn" href="${url}" target="_blank">📄 باز کردن</a>
      <a class="btn" href="${url}?download=1">⬇️ دانلود</a>
      ${["pdf", "docx", "text", "image"].includes(d.kind) && d.status === "ready" ? `<button class="btn" id="d-text">📃 متن استخراج‌شده</button>` : ""}
      ${["audio", "video"].includes(d.kind) ? `<button class="btn primary" id="d-asr">🎙️ تبدیل به متن</button>` : ""}
      ${["pdf", "image"].includes(d.kind) && d.status !== "queued" ? `<button class="btn" id="d-re" title="خواندن دوباره‌ی متن">↻</button>` : ""}
      <button class="btn" id="d-close">بستن</button>
      <button class="btn danger" id="d-del">حذف</button>
    </div>`;
  $("#d-close").onclick = () => dlg.close();
  $("#d-save").onclick = async () => {
    try {
      await api(`/api/documents/${d.id}`, { method: "PATCH", body: { title: $("#d-title").value, category: $("#d-cat").value, doc_date: enDigits($("#d-date").value), story_id: $("#d-story").value || null, tags: $("#d-tags").value, notes: $("#d-notes").value } });
      dlg.close(); toast("ذخیره شد ✔"); refresh();
    } catch (err) { toast(err.message); }
  };
  $("#d-del").onclick = async () => {
    if (!confirm("این سند برای همیشه حذف شود؟")) return;
    await api(`/api/documents/${d.id}`, { method: "DELETE" });
    dlg.close(); toast("حذف شد"); refresh();
  };
  if ($("#d-asr")) $("#d-asr").onclick = async () => {
    const t = await api(`/api/transcripts/from-document/${d.id}`, { method: "POST" });
    dlg.close();
    location.hash = `#transcribe?id=${t.id}`;
  };
  if ($("#d-re")) $("#d-re").onclick = async () => { await api(`/api/documents/${d.id}/reprocess`, { method: "POST" }); dlg.close(); toast("دوباره در صف خواندن قرار گرفت"); refresh(); };
  if ($("#d-text")) $("#d-text").onclick = async () => {
    const t = await api(`/api/documents/${d.id}/text`);
    dlg.close();
    const pv = $("#pageview");
    $("#pv-title").textContent = d.title;
    $("#pv-prev").hidden = $("#pv-next").hidden = true;
    $("#pv-body").innerHTML = `<div class="btn-row" style="padding:10px"><button class="btn sm" id="pv-copy">📋 کپی متن</button><button class="btn sm" id="pv-tools">✍️ باز کردن در ویرایشگر</button></div><div class="pv-text">${esc(t.text) || "متنی استخراج نشد."}</div>`;
    $("#pv-copy").onclick = () => navigator.clipboard.writeText(t.text).then(() => toast("کپی شد"));
    $("#pv-tools").onclick = () => { lsSet("toolsText", t.text); pv.close(); location.hash = "#tools"; };
    $("#pv-close").onclick = () => pv.close();
    pv.showModal();
  };
  dlg.showModal();
}

function showPage(docId, page, kind) {
  const dlg = $("#pageview");
  const set = (p) => {
    page = p;
    $("#pv-title").textContent = `صفحه ${num(p)}`;
    $("#pv-body").innerHTML = `<img src="/api/documents/${docId}/page/${p}.png" alt="صفحه‌ی سند">`;
    $("#pv-body img").onerror = () => { if (page > 1) set(page - 1); };
  };
  $("#pv-prev").onclick = () => page > 1 && set(page - 1);
  $("#pv-next").onclick = () => set(page + 1);
  $("#pv-prev").hidden = $("#pv-next").hidden = kind !== "pdf";
  $("#pv-close").onclick = () => dlg.close();
  set(page);
  dlg.showModal();
}

// ═════════════════════════ رصد خبر ═════════════════════════
const newsState = { q: "", feed: "", matched: false, starred: false, items: [], offset: 0 };

VIEWS.news = async (view, params) => {
  if (params.get("matched")) newsState.matched = true;
  const [feeds, kws] = await Promise.all([api("/api/feeds?limit=200"), api("/api/keywords?limit=500")]);
  const load = async (more = false) => {
    const qs = new URLSearchParams({ offset: more ? newsState.items.length : 0 });
    if (newsState.q) qs.set("q", newsState.q);
    if (newsState.feed) qs.set("feed_id", newsState.feed);
    if (newsState.matched) qs.set("matched", "true");
    if (newsState.starred) qs.set("starred", "true");
    const r = await api(`/api/news?${qs}`);
    newsState.items = more ? newsState.items.concat(r.items) : r.items;
    newsState.terms = r.terms;
    newsState.last = r.last_run;
    newsState.refreshing = r.refreshing;
    newsState.more = r.items.length === 60;
    draw();
  };
  const draw = () => {
    const list = $("#news-list");
    if (!list) return;
    $("#news-info").textContent = newsState.refreshing ? "در حال دریافت خبرهای تازه…" : newsState.last ? `آخرین به‌روزرسانی: ${relTime(newsState.last)}` : "هنوز خبری دریافت نشده؛ دکمه‌ی «به‌روزرسانی» را بزنید.";
    list.innerHTML = newsState.items.length ? newsState.items.map((n) => `<div class="item news-item ${n.is_read ? "read" : ""}" data-n="${n.id}">
      <button class="star ${n.starred ? "on" : ""}" data-star="${n.id}" title="نشان‌دار کردن (پاک نمی‌شود)">${n.starred ? "★" : "☆"}</button>
      <div class="body"><div class="title"><a href="${esc(n.link)}" target="_blank" rel="noopener" data-read="${n.id}">${markTerms(n.title, newsState.terms)}</a></div>
        <div class="meta"><span>${esc(n.feed_name || "")}</span><span>${relTime(n.published)}</span>${n.matched ? `<span class="badge primary">🔎 ${esc(n.matched)}</span>` : ""}</div>
        ${n.summary ? `<div class="snippet">${markTerms(n.summary, newsState.terms)}</div>` : ""}</div>
      <div class="side"><button class="btn sm" data-tostory="${n.id}" title="ساخت سوژه از این خبر">+ سوژه</button><button class="btn sm" data-suggest="${n.id}" title="سوژه + پست و ریلز آماده">✨ پست/ریلز</button></div>
    </div>`).join("") + (newsState.more ? `<button class="btn" id="news-more">بیشتر…</button>` : "") : `<div class="card empty center">خبری پیدا نشد.</div>`;
    if ($("#news-more")) $("#news-more").onclick = () => load(true);
  };
  view.innerHTML = `
    <div class="page-title"><h2>📡 رصد خبر</h2><div class="btn-row">
      <button class="btn primary" id="n-refresh">↻ به‌روزرسانی</button>
      <a class="btn" href="#keywords">🔎 کلیدواژه‌ها (${num(kws.length)})</a><a class="btn" href="#feeds">📡 منابع (${num(feeds.filter((f) => f.active === "yes").length)})</a></div></div>
    <form class="toolbar" id="n-form">
      <input type="search" name="q" placeholder="جستجو در خبرها…" value="${esc(newsState.q)}">
      <select name="feed"><option value="">همه‌ی منابع</option>${feeds.map((f) => `<option value="${f.id}" ${String(f.id) === newsState.feed ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select>
      <label><input type="checkbox" name="matched" ${newsState.matched ? "checked" : ""}> فقط کلیدواژه‌های من</label>
      <label><input type="checkbox" name="starred" ${newsState.starred ? "checked" : ""}> ★ نشان‌دارها</label>
    </form>
    <div class="muted small" id="news-info" style="margin-bottom:8px"></div>
    <div class="list" id="news-list"><div class="empty">در حال بارگذاری…</div></div>`;
  const form = $("#n-form");
  let t;
  form.oninput = (ev) => {
    clearTimeout(t);
    t = setTimeout(() => {
      newsState.q = form.q.value.trim(); newsState.feed = form.feed.value; newsState.matched = form.matched.checked; newsState.starred = form.starred.checked;
      load();
    }, ev.target.name === "q" ? 400 : 0);
  };
  form.onsubmit = (ev) => ev.preventDefault();
  $("#n-refresh").onclick = async () => {
    await api("/api/news/refresh", { method: "POST" });
    toast("در حال دریافت خبرها… چند لحظه صبر کنید");
    newsState.refreshing = true; draw();
    let n = 0;
    const poll = async () => { await load(); if (newsState.refreshing && n++ < 30 && currentPage === "news") setTimeout(poll, 3000); };
    setTimeout(poll, 3000);
  };
  $("#news-list").addEventListener("click", async (ev) => {
    const s = ev.target.closest("[data-star]");
    if (s) {
      const it = newsState.items.find((x) => x.id === Number(s.dataset.star));
      it.starred = it.starred ? 0 : 1;
      await api(`/api/news/${it.id}/flag`, { method: "POST", body: { starred: it.starred } });
      draw();
      return;
    }
    const r = ev.target.closest("[data-read]");
    if (r) { api(`/api/news/${r.dataset.read}/flag`, { method: "POST", body: { is_read: 1 } }); r.closest(".item").classList.add("read"); return; }
    const sgb = ev.target.closest("[data-suggest]");
    if (sgb) {
      const story = await api(`/api/news/${sgb.dataset.suggest}/story`, { method: "POST" });
      invalidateRefs();
      openSuggestion(story.id);
      return;
    }
    const st = ev.target.closest("[data-tostory]");
    if (st) {
      const story = await api(`/api/news/${st.dataset.tostory}/story`, { method: "POST" });
      invalidateRefs();
      toast("سوژه ساخته شد ✔");
      openForm("stories", story);
    }
  });
  load();
};

// ═════════════════════════ ابزار نوشتن ═════════════════════════
const WRITING_TEMPLATES = [
  ["خبر (هرم وارونه)", "تیتر:\nروتیتر:\n\nلید (چه کسی، چه چیزی، کجا، کی — در یک یا دو جمله):\n\nبدنه (جزئیات مهم‌تر به کم‌اهمیت‌تر):\n\nنقل‌قول:\n\nپیشینه:\n\nمنبع:"],
  ["مصاحبه", "عنوان مصاحبه:\nمصاحبه‌شونده (نام، سمت):\nتاریخ و محل:\n\nمقدمه:\n\nپرسش ۱:\nپاسخ:\n\nپرسش ۲:\nپاسخ:\n\nجمع‌بندی:"],
  ["گزارش", "تیتر:\n\nشروع (صحنه / روایت):\n\nمسئله:\n\nداده‌ها و آمار:\n\nدیدگاه‌ها (موافق / مخالف / کارشناس):\n\nجمع‌بندی:\n\nمنابع:"],
  ["متن تیزر", "قلاب (۳ ثانیه‌ی اول):\n\nجمله‌ی ۱:\nجمله‌ی ۲:\nجمله‌ی ۳:\n\nپایان / دعوت به دیدن گزارش کامل:"],
];
const CHECK_5W = ["چه کسی؟", "چه چیزی؟", "کجا؟", "کی؟", "چرا؟", "چگونه؟", "منبع خبر مشخص است", "اعداد و نام‌ها دوباره بررسی شد"];

VIEWS.tools = async (view, params) => {
  let text = lsGet("toolsText", "");
  let source = null;
  if (params.get("story")) {
    source = { e: "stories", rec: await api(`/api/stories/${params.get("story")}`), field: "body" };
    text = source.rec.body || "";
  } else if (params.get("note")) {
    source = { e: "notes", rec: await api(`/api/notes/${params.get("note")}`), field: "content" };
    text = source.rec.content || "";
  }
  view.innerHTML = `
    <div class="page-title"><h2>✍️ ابزار نوشتن</h2>${source ? `<span class="badge primary">${source.e === "stories" ? "سوژه" : "یادداشت"}: ${esc(source.rec.title)}</span>` : ""}</div>
    <div class="card editor">
      <div class="btn-row" style="margin-bottom:8px">
        <select id="t-tpl"><option value="">📋 قالب آماده…</option>${WRITING_TEMPLATES.map(([n], i) => `<option value="${i}">${esc(n)}</option>`).join("")}</select>
        <button class="btn" id="t-fix" title="ی و ک عربی، نیم‌فاصله، فاصله‌ی نشانه‌ها، ارقام فارسی">🪄 اصلاح متن فارسی</button>
        <button class="btn" id="t-copy">📋 کپی</button>
        ${source ? `<button class="btn primary" id="t-save">💾 ذخیره در ${source.e === "stories" ? "سوژه" : "یادداشت"}</button>` : `<button class="btn primary" id="t-note">💾 ذخیره به عنوان پیش‌نویس</button>`}
      </div>
      <textarea id="t-text" placeholder="متن خبر یا گزارش را اینجا بنویسید یا بچسبانید…">${esc(text)}</textarea>
      <div class="counter" id="t-count"></div>
    </div>
    <div class="grid">
      <div class="card"><h3>🧠 ${META.ai ? "هوش مصنوعی" : "کمک‌های خودکار"} ${META.ai ? "" : `<small>بدون هوش مصنوعی</small>`}</h3>
        <div class="btn-row">
          <button class="btn" data-ai="summary">📝 خلاصه</button>
          <button class="btn" data-ai="headlines">📰 پیشنهاد تیتر</button>
          <button class="btn" data-ai="captions">🎬 جمله‌های تیزر</button>
          ${META.ai ? `<button class="btn" data-ai="rewrite">🔁 بازنویسی</button>` : ""}
        </div>
        <div id="t-out"></div>
      </div>
      <div class="card checklist"><h3>✅ چک‌لیست خبر</h3>${CHECK_5W.map((c) => `<label><input type="checkbox"> ${c}</label>`).join("")}</div>
      <div class="card"><h3>📏 طول مناسب</h3>
        <div class="row"><span>تیتر خبرگزاری</span><span class="muted">۸ تا ۱۴ کلمه</span></div>
        <div class="row"><span>لید</span><span class="muted">۲۵ تا ۴۰ کلمه</span></div>
        <div class="row"><span>کپشن اینستاگرام</span><span class="muted">حداکثر ۲۲۰۰ نویسه</span></div>
        <div class="row"><span>متن تیزر ۳۰ ثانیه‌ای</span><span class="muted">حدود ۶۰ تا ۷۵ کلمه</span></div>
        <div id="t-kw" class="small muted" style="margin-top:8px"></div>
      </div>
    </div>`;
  const ta = $("#t-text");
  const count = () => {
    const v = ta.value;
    const words = (v.match(/[\p{L}\p{N}‌]+/gu) || []).length;
    const first = v.split("\n").find((l) => l.trim()) || "";
    const firstWords = (first.match(/[\p{L}\p{N}‌]+/gu) || []).length;
    $("#t-count").innerHTML = `<span>کلمه: <b>${num(words)}</b></span><span>نویسه: <b>${num(v.length)}</b></span><span>زمان خواندن: <b>${num(Math.max(1, Math.ceil(words / 200)))}</b> دقیقه</span><span>زمان خواندن با صدا: <b>${num(Math.round(words / 2.3))}</b> ثانیه</span><span>خط اول: <b>${num(firstWords)}</b> کلمه</span>`;
    if (!source) lsSet("toolsText", v);
  };
  ta.oninput = count;
  count();
  $("#t-tpl").onchange = (ev) => { if (ev.target.value === "") return; const t = WRITING_TEMPLATES[Number(ev.target.value)][1]; ta.value = ta.value ? `${ta.value}\n\n${t}` : t; ev.target.value = ""; count(); };
  $("#t-fix").onclick = async () => { const r = await api("/api/tools/fix", { method: "POST", body: { text: ta.value } }); ta.value = r.text; count(); toast("متن اصلاح شد"); };
  $("#t-copy").onclick = () => navigator.clipboard.writeText(ta.value).then(() => toast("کپی شد"));
  if ($("#t-save")) $("#t-save").onclick = async () => { await api(`/api/${source.e}/${source.rec.id}`, { method: "PATCH", body: { [source.field]: ta.value } }); toast("ذخیره شد ✔"); };
  if ($("#t-note")) $("#t-note").onclick = async () => {
    const title = (ta.value.split("\n").find((l) => l.trim()) || "پیش‌نویس").slice(0, 80);
    const n = await api("/api/notes", { method: "POST", body: { title, content: ta.value, kind: "draft" } });
    toast("به عنوان پیش‌نویس ذخیره شد ✔");
    location.hash = `#tools?note=${n.id}`;
  };
  $$("[data-ai]", view).forEach((b) => (b.onclick = async () => {
    if (!ta.value.trim()) return toast("اول متن را بنویسید");
    const out = $("#t-out");
    out.innerHTML = `<div class="empty">در حال پردازش…</div>`;
    try {
      const r = await api(`/api/ai/${b.dataset.ai}`, { method: "POST", body: { text: ta.value, n: b.dataset.ai === "captions" ? 6 : 3 } });
      out.innerHTML = `<div class="out-box">${r.lines.map((l, i) => `<div class="line"><span>${esc(l)}</span><button class="btn sm" data-cp="${i}">کپی</button></div>`).join("")}</div>
        ${r.error ? `<p class="small muted">${esc(r.error)}</p>` : ""}
        ${b.dataset.ai === "captions" ? `<button class="btn sm" id="to-teaser" style="margin-top:6px">🎬 ساخت تیزر با این جمله‌ها</button>` : ""}
        ${r.mode === "fallback" && b.dataset.ai === "headlines" ? `<p class="small muted">بدون هوش مصنوعی فقط جمله‌های اول متن پیشنهاد می‌شود.</p>` : ""}`;
      $$("[data-cp]", out).forEach((c) => (c.onclick = () => navigator.clipboard.writeText(r.lines[Number(c.dataset.cp)]).then(() => toast("کپی شد"))));
      if ($("#to-teaser")) $("#to-teaser").onclick = () => { lsSet("teaserCaptions", JSON.stringify(r.lines)); location.hash = source?.e === "stories" ? `#teaser?story=${source.rec.id}` : "#teaser"; };
    } catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  }));
  api("/api/tools/analyze", { method: "POST", body: { text: ta.value || "-", n: 1 } }).then((r) => {
    if (r.keywords.length && ta.value) $("#t-kw").textContent = `واژه‌های پرتکرار: ${r.keywords.join("، ")}`;
  }).catch(() => {});
};

// ═════════════════════════ جستجوی سراسری ═════════════════════════
VIEWS.search = async (view, params) => {
  const q = params.get("q") || "";
  view.innerHTML = `<div class="page-title"><h2>🔍 جستجو در همه‌چیز</h2></div>
    <form class="search-big" id="s-form"><input type="search" name="q" value="${esc(q)}" placeholder="سوژه، منبع، سند، خبر، یادداشت…" autofocus><button class="btn primary">جستجو</button></form>
    <div id="s-out">${q ? '<div class="empty">در حال جستجو…</div>' : '<div class="empty">در سوژه‌ها، یادداشت‌ها، منابع، رسانه‌ها، قراردادها، متن اسناد بایگانی و خبرهای رصدشده جستجو می‌شود.</div>'}</div>`;
  $("#s-form").onsubmit = (ev) => { ev.preventDefault(); location.hash = `#search?q=${encodeURIComponent(ev.target.q.value.trim())}`; };
  if (!q) return;
  const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
  $("#s-out").innerHTML = r.groups.length ? r.groups.map((g) => `<div class="card"><h3>${g.icon} ${esc(g.label)} <span class="count">${num(g.items.length)}</span></h3>
    <div class="list mini">${g.items.map((it) => {
      const href = g.entity === "documents" ? "" : g.entity === "feed_items" ? "" : `#${g.entity}?id=${it.id}`;
      return `<div class="item" ${href ? `data-go="${href}"` : g.entity === "documents" ? `data-sdoc="${it.id}"` : `data-link="${esc(it.link)}"`}><div class="body"><div class="title">${markTerms(it.title, r.terms)}</div>${it.sub ? `<div class="snippet">${markTerms(it.sub, r.terms)}</div>` : ""}</div></div>`;
    }).join("")}</div></div>`).join("") : `<div class="card empty center">چیزی پیدا نشد.</div>`;
  $$("[data-sdoc]", view).forEach((el) => (el.onclick = () => { archive.q = q; location.hash = "#archive"; setTimeout(() => $("#a-search")?.requestSubmit(), 300); }));
  $$("[data-link]", view).forEach((el) => (el.onclick = () => window.open(el.dataset.link, "_blank", "noopener")));
};

// ═════════════════════════ تنظیمات ═════════════════════════
VIEWS.settings = async (view) => {
  view.innerHTML = `
    <div class="page-title"><h2>⚙️ تنظیمات</h2></div>
    <div class="grid">
      <div class="card" id="s-push"><h3>📲 اعلان روی همین گوشی</h3><div class="small muted">در حال بررسی…</div></div>
      <div class="card" id="s-bale"><h3>🤖 ربات بله</h3><div class="small muted">در حال بررسی…</div></div>
      <div class="card"><h3>💾 پشتیبان‌گیری</h3>
        <p class="small muted">هر چند وقت یک بار یک نسخه از اطلاعات را روی گوشی یا کامپیوتر ذخیره کنید.</p>
        <div class="btn-row"><a class="btn" href="/api/backup.db">⬇️ پایگاه داده‌ی کامل (.db)</a><a class="btn" href="/api/export">⬇️ خروجی خوانا (JSON)</a></div>
        <p class="small muted">فایل‌های اسناد و ویدیوها روی دیسک لیارا می‌مانند و جزو این دو فایل نیستند.</p>
      </div>
      <div class="card"><h3>🧩 وضعیت سیستم</h3>
        <dl class="kv">
          <dt>نسخه</dt><dd>${esc(META.version)}</dd>
          <dt>رمز عبور</dt><dd>${META.password_set ? "✅ تنظیم شده" : "⚠️ تنظیم نشده"}</dd>
          <dt>ساخت ویدیو (ffmpeg)</dt><dd>${META.ffmpeg ? "✅ آماده" : "❌ نصب نیست"}</dd>
          <dt>خواندن اسکن فارسی (OCR)</dt><dd>${META.ocr ? "✅ آماده" : "❌ نصب نیست"}</dd>
          <dt>تبدیل گفتار به متن</dt><dd>${META.asr?.model ? "✅ آماده" : META.asr?.installed ? `⚠️ مدل نصب نیست — <a href="#transcribe">نصب</a>` : "❌ نصب نیست"}</dd>
          <dt>هوش مصنوعی</dt><dd>${META.ai ? `✅ ${esc(META.ai)}` : "خاموش (همه‌چیز بدون آن کار می‌کند)"}</dd>
        </dl>
      </div>
      <div class="card"><h3>📱 نصب روی گوشی</h3>
        <p class="small">اندروید (کروم): منوی ⋮ ← «افزودن به صفحه‌ی اصلی».<br>آیفون (سافاری): دکمه‌ی اشتراک‌گذاری ← «Add to Home Screen».</p>
        <button class="btn danger" id="s-logout">خروج از حساب</button>
      </div>
    </div>`;
  drawPushCard();
  drawBaleCard();
  $("#s-logout").onclick = async () => { await fetch("/api/logout", { method: "POST" }); location.reload(); };
};

// ───── اعلان روی گوشی (Web Push) ─────
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
function b64uToBytes(s) { const raw = atob((s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); }
async function pushSub() { const reg = await navigator.serviceWorker?.getRegistration(); return reg ? reg.pushManager.getSubscription() : null; }

async function drawPushCard() {
  const box = $("#s-push");
  if (!box) return;
  const head = `<h3>📲 اعلان روی همین گوشی</h3><p class="small muted">یادآوری‌ها و مهلت‌ها مثل پیام‌های برنامه‌های دیگر روی گوشی می‌آیند، حتی وقتی زوزو بسته است.</p>`;
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  let srv = { count: 0 };
  try { srv = await api("/api/push/key"); } catch { /* */ }
  const devs = srv.count ? `<p class="small muted">${num(srv.count)} دستگاه برای اعلان ثبت شده است.</p>` : "";
  if (!supported) {
    box.innerHTML = head + (isIOS() && !isStandalone()
      ? `<div class="tip">در آیفون اول برنامه را به صفحه‌ی اصلی اضافه کنید:<br>در سافاری دکمه‌ی اشتراک‌گذاری <b>⎋</b> ← «Add to Home Screen» ← سپس زوزو را از همان آیکن باز کنید و دوباره به همین‌جا بیایید.<br><small>(آیفون با iOS نسخه‌ی ۱۶٫۴ یا بالاتر)</small></div>`
      : `<div class="tip">این مرورگر اعلان پشتیبانی نمی‌کند. در اندروید از <b>Chrome</b> استفاده کنید.</div>`) + devs;
    return;
  }
  const sub = await pushSub().catch(() => null);
  if (Notification.permission === "denied") {
    box.innerHTML = head + `<div class="tip">⛔ اجازه‌ی اعلان برای این سایت بسته است.<br>در کروم: روی 🔒 کنار نشانی سایت بزنید ← «Permissions / مجوزها» ← «Notifications / اعلان‌ها» ← «Allow».<br>بعد این صفحه را دوباره باز کنید.</div>` + devs;
    return;
  }
  if (sub && Notification.permission === "granted") {
    box.innerHTML = head + `<div class="row"><span>این گوشی</span><span class="badge green">✅ روشن</span></div>${devs}
      <div class="btn-row"><button class="btn sm primary" id="p-test">🔔 اعلان آزمایشی</button><button class="btn sm ghost" id="p-off">خاموش کردن روی این گوشی</button></div>
      <p class="small muted">اگر اعلان دیر رسید (اندروید): تنظیمات گوشی ← برنامه‌ها ← Chrome ← باتری ← «بدون محدودیت».</p>`;
    $("#p-test").onclick = async () => {
      try { const r = await api("/api/push/test", { method: "POST", body: { endpoint: sub.endpoint } }); toast(r.ok ? "فرستاده شد؛ چند ثانیه‌ی دیگر روی گوشی می‌آید ✔ (می‌توانید برنامه را ببندید و امتحان کنید)" : "ارسال ناموفق بود؛ دوباره روشن کنید", 6000); }
      catch (e) { toast(e.message); }
      drawPushCard();
    };
    $("#p-off").onclick = async () => { await api("/api/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } }).catch(() => {}); await sub.unsubscribe().catch(() => {}); drawPushCard(); };
    return;
  }
  box.innerHTML = head + `<button class="btn primary" id="p-on">🔔 روشن کردن اعلان روی این گوشی</button>${devs}
    <p class="small muted">بعد از زدن دکمه، گوشی می‌پرسد «اجازه‌ی اعلان؟»؛ گزینه‌ی <b>Allow / اجازه</b> را بزنید.${isIOS() ? "" : " بهتر است اول زوزو را به صفحه‌ی اصلی گوشی اضافه کنید (پایین همین صفحه)."}</p>`;
  $("#p-on").onclick = async () => {
    const btn = $("#p-on"); btn.disabled = true; btn.textContent = "در حال روشن کردن…";
    try {
      if ((await Notification.requestPermission()) !== "granted") { toast("اجازه‌ی اعلان داده نشد"); return drawPushCard(); }
      const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      let s0 = await reg.pushManager.getSubscription();
      if (!s0) s0 = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(srv.key) });
      await api("/api/push/subscribe", { method: "POST", body: { subscription: s0.toJSON(), device: navigator.userAgent } });
      await api("/api/push/test", { method: "POST", body: { endpoint: s0.endpoint } }).catch(() => {});
      toast("اعلان روی این گوشی روشن شد ✔ یک اعلان آزمایشی فرستادم.", 6000);
    } catch (e) {
      const msg = String(e.message || e);
      toast(/registration|permission|push service/i.test(msg)
        ? `مرورگر اجازه‌ی ثبت اعلان نداد. در اندروید از Chrome استفاده کنید و اعلان این سایت را مجاز کنید؛ در آیفون زوزو را از آیکن صفحه‌ی اصلی باز کنید. (${msg})`
        : `روشن نشد: ${msg}`, 9000);
    }
    drawPushCard();
  };
}

// ───── ربات بله ─────
async function drawBaleCard(editToken = false) {
  const box = $("#s-bale");
  if (!box) return;
  let b;
  try { b = await api("/api/bale"); } catch (e) { box.innerHTML = `<h3>🤖 ربات بله</h3><div class="error">${esc(e.message)}</div>`; return; }
  const head = `<h3>🤖 ربات بله</h3><p class="small muted">یادآوری‌ها، مهلت‌ها و خلاصه‌ی صبح به صورت پیام در «بله» می‌رسد؛ متن و ویس هم می‌شود برای ربات فرستاد.</p>`;
  const step = (n, done, html) => `<div class="bale-step ${done ? "done" : ""}"><span class="n">${done ? "✓" : num(n)}</span><div>${html}</div></div>`;
  const tokenForm = `<div class="btn-row" style="margin-top:6px"><input id="b-token" class="ltr" placeholder="123456789:AbCdEf..." style="flex:1;min-width:220px" autocomplete="off">
      <button class="btn primary" id="b-save">ذخیره و اتصال</button>${editToken ? `<button class="btn ghost" id="b-cancel">انصراف</button>` : ""}</div>`;
  const s1 = step(1, b.token_set && !editToken, b.token_set && !editToken
    ? `ربات ساخته و وصل شد${b.bot?.username ? `: <b class="ltr">@${esc(b.bot.username)}</b>` : ""} ${b.from_env ? `<small class="muted">(از تنظیمات لیارا)</small>` : `<button class="btn sm ghost" id="b-edit">تغییر توکن</button>`}`
    : `<b>ساختن ربات:</b> در بله، <a href="https://ble.ir/botfather" target="_blank" rel="noopener" class="ltr">@botfather</a> را باز کنید و <code>/newbot</code> بفرستید؛ یک نام (مثلاً «دستیار زوزو») و یک شناسه‌ی ختم‌شده به <code>bot</code> بدهید. بات‌فادر یک <b>توکن</b> می‌دهد؛ آن را کپی و این‌جا بچسبانید:${tokenForm}`);
  let h = head + s1;
  if (b.token_set && !editToken) {
    const linked = b.chats.length + b.env_chats > 0;
    const botLink = b.bot?.username ? `https://ble.ir/${encodeURIComponent(b.bot.username)}` : "";
    h += step(2, linked, `<b>وصل کردن گفتگو:</b> ${botLink ? `ربات را در بله باز کنید (<a href="${botLink}" target="_blank" rel="noopener">باز کردن ربات در بله</a>)، دکمه‌ی «شروع» را بزنید و` : "در بله ربات خودتان را باز کنید و"} این کد را برایش بفرستید:
      <div class="bale-code"><b class="ltr">${esc(b.code || "")}</b><button class="btn sm ghost" id="b-copy">کپی</button><button class="btn sm ghost" id="b-newcode" title="کد تازه">↻</button></div>
      <small class="muted">کد تا ۳۰ دقیقه معتبر است و یک بار مصرف می‌شود. برای وصل کردن گوشی دیگر هم همین کار را بکنید.</small>
      ${b.chats.length ? `<div class="list mini" style="margin-top:6px">${b.chats.map((c) => `<div class="row"><span>💬 ${esc(c.name)}</span><button class="btn sm ghost" data-unlink="${esc(c.id)}" title="قطع اتصال">✕</button></div>`).join("")}</div>` : ""}
      ${b.env_chats ? `<small class="muted">${num(b.env_chats)} گفتگو هم از تنظیمات لیارا وصل است.</small>` : ""}`);
    if (linked) h += step(3, false, `<b>امتحان:</b> <button class="btn sm primary" id="b-test">📨 فرستادن پیام آزمایشی به بله</button>`);
  }
  box.innerHTML = h;
  const on = (id, fn) => { const el = $(id, box); if (el) el.onclick = fn; };
  on("#b-save", async () => {
    const t = $("#b-token").value.trim();
    if (!t) return toast("توکن را بچسبانید");
    const btn = $("#b-save"); btn.disabled = true; btn.textContent = "در حال بررسی…";
    try { await api("/api/bale/token", { method: "POST", body: { token: t } }); toast("ربات وصل شد ✔ حالا مرحله‌ی ۲", 5000); drawBaleCard(); }
    catch (e) { toast(e.message, 7000); btn.disabled = false; btn.textContent = "ذخیره و اتصال"; }
  });
  on("#b-edit", () => drawBaleCard(true));
  on("#b-cancel", () => drawBaleCard());
  on("#b-copy", async () => { try { await navigator.clipboard.writeText(b.code); toast("کد کپی شد"); } catch { toast(b.code); } });
  on("#b-newcode", async () => { await api("/api/bale/code", { method: "POST" }); drawBaleCard(); });
  on("#b-test", async () => { try { await api("/api/bale/test", { method: "POST" }); toast("پیام آزمایشی به بله فرستاده شد ✔", 5000); } catch (e) { toast(e.message, 6000); } });
  $$("[data-unlink]", box).forEach((el) => (el.onclick = async () => { if (!confirm("اتصال این گفتگو قطع شود؟")) return; await api(`/api/bale/chats/${encodeURIComponent(el.dataset.unlink)}`, { method: "DELETE" }); drawBaleCard(); }));
  // تا وقتی گفتگو وصل نشده، هر چند ثانیه بررسی شود تا «وصل شد» خودکار دیده شود
  clearTimeout(drawBaleCard.t);
  if (b.token_set && !editToken && !(b.chats.length + b.env_chats)) {
    drawBaleCard.t = setTimeout(() => { if (currentPage === "settings" && !$("#b-token")) drawBaleCard(); }, 5000);
  }
}

// ═════════════════════════ اعلان‌ها ═════════════════════════
const notif = { last: Number(lsGet("notifLast", "0")), items: [], unread: 0 };

async function pollNotifications(first = false) {
  if (!META) return;
  try {
    const r = await api("/api/notifications?since=0");
    notif.items = r.items;
    notif.unread = r.unread;
    const dot = $("#notif-dot");
    dot.hidden = !r.unread;
    dot.textContent = r.unread > 9 ? "۹+" : num(r.unread);
    const fresh = r.items.filter((x) => x.id > notif.last && !x.is_read);
    if (!first || notif.last) fresh.slice(0, 3).reverse().forEach(showBrowserNotification);
    notif.last = r.last_id;
    lsSet("notifLast", String(r.last_id));
  } catch { /* آفلاین */ }
}

async function showBrowserNotification(n) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const opts = { body: n.body || "", tag: `zozo-${n.id}`, data: { link: n.link || "#home" }, icon: "/static/icon-192.png", badge: "/static/badge-96.png", lang: "fa", dir: "rtl" };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(n.title, opts);
    new Notification(n.title, opts);
  } catch { /* */ }
}

function closeNotif() { $("#notif-panel").hidden = true; }
$("#btn-notif").onclick = async (ev) => {
  ev.stopPropagation();
  const p = $("#notif-panel");
  if (!p.hidden) return closeNotif();
  await pollNotifications();
  p.innerHTML = `<div class="head"><b>اعلان‌ها</b><button class="btn sm" id="n-all">همه خوانده شد</button></div>
    ${notif.items.length ? notif.items.map((n) => `<div class="notif ${n.is_read ? "" : "unread"}" data-nid="${n.id}" data-link="${esc(n.link || "")}">
      <div class="t">${esc(n.title)}</div>${n.body ? `<div class="b">${esc(n.body)}</div>` : ""}<div class="d">${relTime(n.created_at)}</div></div>`).join("") : `<div class="empty center" style="padding:20px">اعلانی نیست.</div>`}`;
  p.hidden = false;
  $("#n-all").onclick = async () => { await api("/api/notifications/read", { method: "POST", body: {} }); closeNotif(); pollNotifications(); };
  $$(".notif", p).forEach((el) => (el.onclick = async () => {
    await api("/api/notifications/read", { method: "POST", body: { ids: [Number(el.dataset.nid)] } });
    closeNotif();
    pollNotifications();
    if (el.dataset.link) location.hash = el.dataset.link;
  }));
};
document.addEventListener("click", (ev) => { if (!ev.target.closest("#notif-panel")) closeNotif(); });
$("#btn-search").onclick = () => (location.hash = "#search");

// ═════════════════════════ فونت‌ها ═════════════════════════
// فونت‌های آزاد همراه برنامه + فونت‌هایی که کاربر بارگذاری کرده (مثل بی‌تیتر، بی‌نازنین)
const FONTS = [["Vazirmatn", "وزیرمتن"], ["Estedad", "استعداد"], ["Lalezar", "لاله‌زار"], ["Shabnam", "شبنم"], ["Noto Naskh Arabic", "نوتو نسخ"]];
const fontStack = (f) => `"${f || "Vazirmatn"}", Vazirmatn, Tahoma, sans-serif`;
const fontName = (f) => (FONTS.find((x) => x[0] === f) || [f, f])[1];
let FONTS_READY = null;
function loadCustomFonts() {
  FONTS_READY = api("/api/fonts").then(async (r) => {
    for (const f of r.items) {
      if (FONTS.some((x) => x[0] === f.family)) continue;
      try {
        const face = new FontFace(f.family, `url(/api/fonts/${f.id}/file)`);
        document.fonts.add(await face.load());
        FONTS.push([f.family, f.name, f.id]);
      } catch { /* فایل خراب */ }
    }
  }).catch(() => {});
  return FONTS_READY;
}
// وقتی فونتی هنوز دانلود نشده، بعد از آمدنش دوباره کشیده شود
const _fontWait = new Set();
function ensureFont(f, weight = 700, redraw) {
  if (!f || !document.fonts || document.fonts.check(`${weight} 20px "${f}"`)) return;
  const key = `${f}|${weight}`;
  if (_fontWait.has(key)) return;
  _fontWait.add(key);
  document.fonts.load(`${weight} 40px "${f}"`, "ابپ").then(() => { _fontWait.delete(key); redraw?.(); }).catch(() => _fontWait.delete(key));
}
function fontOptions(cur) {
  return FONTS.map(([f, n]) => `<option value="${esc(f)}" ${f === cur ? "selected" : ""} style="font-family:${esc(fontStack(f))}">${esc(n)}</option>`).join("");
}
// دکمه‌ی «افزودن فونت»: فایل ttf/otf/woff یا زیپی که فونت داخلش است را بارگذاری می‌کند و همه‌جا قابل انتخاب می‌شود
function pickFontFile(onDone) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".ttf,.otf,.woff,.woff2,.zip";
  inp.onchange = async () => {
    const file = inp.files[0];
    if (!file) return;
    const name = prompt("نام این فونت (همان‌طور که در فهرست دیده شود):", file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ")) || "";
    const r = await uploadOne("/api/fonts", file, { name }, () => {});
    if (!r.ok) return toast(r.error);
    await loadCustomFonts();
    const added = r.data.added || [r.data];
    toast(added.length > 1 ? `${num(added.length)} فونت اضافه شد ✔ (${added.map((f) => f.name).join("، ")})` : `فونت «${r.data.name}» اضافه شد ✔`, 5000);
    onDone?.(r.data.family);
  };
  inp.click();
}

// ═════════════════════════ شروع ═════════════════════════
async function init() {
  try {
    const a = await (await fetch("/api/auth", { credentials: "same-origin" })).json();
    if (a.enabled && !a.ok) return showLogin();
    META = await api("/api/meta");
  } catch (e) {
    if (!(e instanceof LoginRequired)) $("#view").innerHTML = `<div class="card error">اتصال به سرور برقرار نشد. ${esc(e.message)}</div>`;
    return;
  }
  document.title = `${META.app_name} — دستیار روزنامه‌نگار`;
  $("#brand").textContent = META.app_name;
  $("#today").textContent = fa(META.today_long);
  loadCustomFonts();
  route();
  pollNotifications(true);
  clearInterval(init._t);
  init._t = setInterval(pollNotifications, 60000);
  setInterval(() => { // اگر روز عوض شد
    if (META && Jalali.today() !== META.today) api("/api/meta").then((m) => { META = m; $("#today").textContent = fa(m.today_long); });
  }, 300000);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) pollNotifications(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
navigator.serviceWorker?.addEventListener("message", (ev) => { if (ev.data?.link) location.hash = ev.data.link; });
init();
