"use strict";
// ═════════════════════════ فاکتور روزنامه‌ها ═════════════════════════
// روزنامه‌ها ← مشتری‌ها (هر مشتری برای یک/چند/همه‌ی روزنامه‌ها) ← فاکتور ساده با پیگیری وصول.
// تاریخ پیگیری خودکار یادآوری می‌سازد؛ «اعلام وصول» درآمد و سهم روزنامه را در بخش مالی ثبت می‌کند.

const PP = { meta: null, tab: "inv", f: { paper_id: "", client_id: "", status: "", q: "", date_from: "", date_to: "" } };
const PP_STATUS_CLS = { follow: "primary", reprint: "amber", refollow: "red", collected: "green" };
const PP_STATUS_ICON = { follow: "🔎", reprint: "🖨", refollow: "🔁", collected: "✅" };
const ppMoney = (v) => (v ? num(v) : "۰");
// شماره‌ها: {label, number} (شماره‌های قدیمی فقط متن بودند)
const ppPh = (x) => (typeof x === "string" ? { label: "", number: x } : x || { label: "", number: "" });
const ppPhText = (x) => { const p = ppPh(x); return `${p.label ? `${esc(p.label)}: ` : ""}<span dir="ltr">${esc(fa(p.number))}</span>`; };
const ppAmount = (v) => Number(enDigits(String(v ?? "")).replace(/[^\d]/g, "")) || 0;

async function ppLoadMeta() { PP.meta = await api("/api/papers/all"); return PP.meta; }
const ppPaper = (id) => PP.meta.papers.find((p) => p.id === Number(id));
const ppClient = (id) => PP.meta.clients.find((c) => c.id === Number(id));

VIEWS.papers = async (view, params) => {
  await ppLoadMeta();
  if (params.get("tab")) { PP.tab = params.get("tab"); history.replaceState(null, "", "#papers"); }
  if (!PP.meta.papers.length && PP.tab === "inv") PP.tab = "papers";
  const tabs = [["inv", "🧾 فاکتورها"], ["clients", `👥 مشتری‌ها (${num(PP.meta.clients.length)})`], ["papers", `📰 روزنامه‌ها (${num(PP.meta.papers.length)})`]];
  view.innerHTML = `<div class="page-title"><h2>📰 فاکتور روزنامه‌ها</h2>
      <div class="seg pp-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${PP.tab === k ? "active" : ""}">${l}</button>`).join("")}</div></div>
    <div id="pp-body"></div>`;
  $$(".pp-tabs [data-tab]", view).forEach((b) => (b.onclick = () => { PP.tab = b.dataset.tab; refresh(); }));
  if (PP.tab === "papers") return ppPapersTab($("#pp-body"));
  if (PP.tab === "clients") return ppClientsTab($("#pp-body"));
  return ppInvoicesTab($("#pp-body"), params);
};

// ───── فاکتورها ─────
async function ppInvoicesTab(box, params) {
  if (!PP.meta.clients.length) {
    box.innerHTML = `<div class="card empty">اول در زبانه‌ی «👥 مشتری‌ها» دست‌کم یک مشتری تعریف کنید.<div class="btn-row" style="justify-content:center;margin-top:8px"><button class="btn primary" id="pp-go-cl">👥 تعریف مشتری</button></div></div>`;
    $("#pp-go-cl").onclick = () => { PP.tab = "clients"; refresh(); };
    return;
  }
  const f = PP.f, qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const d = await api(`/api/paper-invoices${qs ? `?${qs}` : ""}`);
  const t = d.totals;
  const clients = f.paper_id ? PP.meta.clients.filter((c) => c.paper_ids.includes(Number(f.paper_id))) : PP.meta.clients;
  const filtered = Object.values(f).some(Boolean);
  box.innerHTML = `
    <div class="card pp-filter">
      <div class="btn-row">
        <label>روزنامه<select id="pf-paper"><option value="">همه‌ی روزنامه‌ها</option>${PP.meta.papers.map((p) => `<option value="${p.id}" ${String(p.id) === String(f.paper_id) ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
        <label>مشتری<select id="pf-client"><option value="">همه‌ی مشتری‌ها</option>${clients.map((c) => `<option value="${c.id}" ${String(c.id) === String(f.client_id) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
        <label>وضعیت<select id="pf-status"><option value="">همه</option><option value="open" ${f.status === "open" ? "selected" : ""}>⏳ وصول‌نشده‌ها (در جریان)</option>${Object.entries(PP.meta.status).map(([k, l]) => `<option value="${k}" ${f.status === k ? "selected" : ""}>${PP_STATUS_ICON[k]} ${l}</option>`).join("")}</select></label>
        <label>از تاریخ<input id="pf-from" value="${esc(fa(f.date_from))}" placeholder="—" style="width:110px"></label>
        <label>تا تاریخ<input id="pf-to" value="${esc(fa(f.date_to))}" placeholder="—" style="width:110px"></label>
        <label>جستجو<input id="pf-q" value="${esc(f.q)}" placeholder="شماره، شرح، نام…"></label>
        ${filtered ? `<button class="btn sm ghost" id="pf-clear">✕ حذف فیلترها</button>` : ""}
        <button class="btn primary" id="pp-new">➕ فاکتور تازه</button>
      </div></div>
    <div class="stats pp-stats">
      <div class="stat"><div class="v">${moneyWords(t.total)}</div><div class="l">جمع مبلغ کل (${num(t.count)} فاکتور)</div></div>
      <div class="stat good"><div class="v">${moneyWords(t.profit)}</div><div class="l">جمع سود من</div></div>
      <div class="stat"><div class="v">${moneyWords(t.paper_cost)}</div><div class="l">جمع سهم روزنامه</div></div>
      <div class="stat good"><div class="v">${moneyWords(t.collected)}</div><div class="l">وصول‌شده</div></div>
      <div class="stat ${t.open ? "warn" : ""}"><div class="v">${moneyWords(t.open)}</div><div class="l">در جریان پیگیری</div></div>
    </div>
    <div class="card"><div class="table-wrap"><table class="pp-table">
      <thead><tr><th>شماره</th><th>تاریخ</th><th>مشتری</th><th>روزنامه</th><th>شرح</th><th>مبلغ کل</th><th>سود من</th><th>سهم روزنامه</th><th>وضعیت</th><th>پیگیری</th><th></th></tr></thead>
      <tbody>${d.items.map((r) => `<tr data-inv="${r.id}">
        <td class="nw">${esc(fa(r.number || ""))}${r.file_count ? ` <span class="small" title="${num(r.file_count)} پیوست">📎${num(r.file_count)}</span>` : ""}</td><td class="nw">${esc(fa(r.issue_date || ""))}</td>
        <td>${esc(r.client_name || "—")}</td><td>${esc(r.paper_name || "—")}</td><td class="small">${esc(r.title || "")}</td>
        <td class="num">${ppMoney(r.total)}</td><td class="num pos">${ppMoney(r.profit)}</td><td class="num">${ppMoney(r.paper_cost)}</td>
        <td><button class="badge ${PP_STATUS_CLS[r.status]} pp-st" data-st="${r.id}" title="تغییر وضعیت">${PP_STATUS_ICON[r.status]} ${esc(r.status_label)}${r.renewals ? ` ×${num(r.renewals + 1)}` : ""}</button></td>
        <td class="nw ${r.overdue ? "neg" : ""}">${r.status === "collected" ? `<small class="muted">وصول ${esc(fa(r.collected_date || ""))}</small>` : `${esc(fa(r.follow_date || ""))}${r.overdue ? " ⚠" : ""}`}</td>
        <td class="nw"><button class="btn sm ghost" data-ed="${r.id}" title="ویرایش">✏️</button></td></tr>`).join("") || `<tr><td colspan="11" class="empty">فاکتوری ${filtered ? "با این فیلتر " : ""}نیست.</td></tr>`}</tbody>
      ${d.items.length ? `<tfoot><tr><th colspan="5">جمع ${filtered ? "(همین فیلتر)" : "کل"} — ${num(t.count)} فاکتور</th><th class="num">${ppMoney(t.total)}</th><th class="num pos">${ppMoney(t.profit)}</th><th class="num">${ppMoney(t.paper_cost)}</th><th colspan="3"></th></tr></tfoot>` : ""}
    </table></div><p class="small muted" style="margin:6px 0 0">مبلغ‌ها به ${META.currency}. روی وضعیت هر فاکتور بزنید تا پیگیری را تمدید یا وصول را اعلام کنید.</p></div>
    <div class="grid fd-grid2">
      <div class="card"><h3>👥 به تفکیک مشتری</h3>${ppGroupTable(d.by_client, "client_id")}</div>
      <div class="card"><h3>📰 به تفکیک روزنامه</h3>${ppGroupTable(d.by_paper, "paper_id")}</div>
    </div>`;
  const setF = (k, v) => { PP.f[k] = v; refresh(); };
  $("#pf-paper").onchange = (ev) => { PP.f.paper_id = ev.target.value; if (PP.f.client_id && !ppClient(PP.f.client_id)?.paper_ids.includes(Number(ev.target.value)) && ev.target.value) PP.f.client_id = ""; refresh(); };
  $("#pf-client").onchange = (ev) => setF("client_id", ev.target.value);
  $("#pf-status").onchange = (ev) => setF("status", ev.target.value);
  for (const [id, k] of [["#pf-from", "date_from"], ["#pf-to", "date_to"]]) $(id).onchange = (ev) => setF(k, enDigits(ev.target.value.trim()));
  let qt; $("#pf-q").oninput = (ev) => { clearTimeout(qt); qt = setTimeout(() => setF("q", ev.target.value), 500); };
  if ($("#pf-clear")) $("#pf-clear").onclick = () => { PP.f = { paper_id: "", client_id: "", status: "", q: "", date_from: "", date_to: "" }; refresh(); };
  $("#pp-new").onclick = () => ppInvoiceForm(null);
  $$("[data-ed]", box).forEach((b) => (b.onclick = async (ev) => { ev.stopPropagation(); ppInvoiceForm(await api(`/api/paper-invoices/${b.dataset.ed}`)); }));
  $$("[data-st]", box).forEach((b) => (b.onclick = async (ev) => { ev.stopPropagation(); ppStatusDialog(await api(`/api/paper-invoices/${b.dataset.st}`)); }));
  $$("tr[data-inv]", box).forEach((tr) => (tr.onclick = async () => ppInvoiceForm(await api(`/api/paper-invoices/${tr.dataset.inv}`))));
  $$("[data-grp]", box).forEach((tr) => (tr.onclick = () => { const [k, v] = tr.dataset.grp.split(":"); setF(k, v); }));
  const open = Number(params?.get("inv"));
  if (open) { history.replaceState(null, "", "#papers"); ppInvoiceForm(await api(`/api/paper-invoices/${open}`)); }
}
function ppGroupTable(rows, key) {
  if (!rows.length) return `<div class="empty">موردی نیست.</div>`;
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  return `<div class="table-wrap"><table class="pp-table pp-grp"><thead><tr><th>نام</th><th>فاکتور</th><th>مبلغ کل</th><th>سود من</th><th>سهم روزنامه</th><th>وصول‌شده</th><th>در جریان</th></tr></thead>
    <tbody>${rows.map((r) => `<tr data-grp="${key}:${r.id}" title="فقط همین را نشان بده"><td>${esc(r.name)}</td><td class="num">${num(r.count)}</td><td class="num">${ppMoney(r.total)}</td><td class="num pos">${ppMoney(r.profit)}</td><td class="num">${ppMoney(r.paper_cost)}</td><td class="num">${ppMoney(r.collected)}</td><td class="num ${r.open ? "neg" : ""}">${ppMoney(r.open)}</td></tr>`).join("")}</tbody>
    <tfoot><tr><th>جمع</th><th class="num">${num(sum("count"))}</th><th class="num">${ppMoney(sum("total"))}</th><th class="num pos">${ppMoney(sum("profit"))}</th><th class="num">${ppMoney(sum("paper_cost"))}</th><th class="num">${ppMoney(sum("collected"))}</th><th class="num">${ppMoney(sum("open"))}</th></tr></tfoot></table></div>`;
}

// تاریخ پیگیری: انتخاب‌گر + دکمه‌های سریع
function ppFollowHTML(val) {
  const base = META.today;
  return `<div class="date-wrap"><input id="pi-follow" value="${esc(fa(val || ""))}" placeholder="مثلاً ${fa(Jalali.addDays(base, 7))}" inputmode="numeric"><button type="button" id="pi-follow-dp">📅</button></div>
    <div class="date-quick">${[[3, "+۳ روز"], [7, "+۱ هفته"], [14, "+۲ هفته"], [30, "+۱ ماه"]].map(([n, l]) => `<button type="button" data-fq="${n}">${l}</button>`).join("")}</div>`;
}
function ppBindFollow(root) {
  const inp = $("#pi-follow", root);
  if (!inp) return;
  $("#pi-follow-dp", root).onclick = () => pickDate(inp.value, false, (v) => (inp.value = fa(v)));
  $$("[data-fq]", root).forEach((b) => (b.onclick = () => (inp.value = fa(Jalali.addDays(META.today, Number(b.dataset.fq))))));
}
function ppHistoryHTML(inv) {
  if (!inv?.history?.length) return "";
  const ev = (h) => (h.event === "create" ? "ثبت فاکتور" : h.event === "collected" ? "✅ اعلام وصول" : `${PP_STATUS_ICON[h.status] || ""} ${PP.meta.status[h.status] || ""}`);
  return `<details class="pp-hist" ${inv.renewals ? "open" : ""}><summary class="small">🕘 تاریخچه‌ی پیگیری (${num(inv.history.length)})${inv.renewals ? ` · ${num(inv.renewals)} بار تمدید` : ""}</summary>
    <ol>${inv.history.map((h) => `<li class="small">${esc(fa(String(h.at || "").slice(0, 16)))} — ${ev(h)}${h.follow ? ` · پیگیری: <b>${esc(fa(h.follow))}</b>` : ""}</li>`).join("")}</ol></details>`;
}

function ppInvoiceForm(inv) {
  const m = PP.meta, isNew = !inv;
  const v = inv || { number: m.next_number, issue_date: META.today, status: "follow", client_id: PP.f.client_id || "", paper_id: PP.f.paper_id || "", follow_date: Jalali.addDays(META.today, 7) };
  const statusSeg = (cur) => `<div class="seg pp-sseg">${Object.entries(m.status).map(([k, l]) => `<button type="button" data-s="${k}" class="${cur === k ? "active" : ""}">${PP_STATUS_ICON[k]} ${l}</button>`).join("")}</div>`;
  $("#dlg-body").innerHTML = `<h3>🧾 ${isNew ? "فاکتور تازه" : `فاکتور ${esc(fa(v.number || ""))}`}</h3>
    <form id="pi-form" class="pp-form">
      <div class="pp-fgrid">
        <div class="pp-combo"><b class="small">مشتری</b><input id="pi-cq" autocomplete="off" placeholder="چند حرف از اسم یا شماره را بنویسید…" value="${esc(ppClient(v.client_id)?.name || "")}">
          <input type="hidden" name="client_id" value="${esc(v.client_id || "")}"><div class="pp-combo-list" id="pi-clist" hidden></div></div>
        <label>روزنامه<select name="paper_id" required></select></label>
        <label>شماره<input name="number" value="${esc(fa(v.number || ""))}"></label>
        <label>تاریخ فاکتور<input name="issue_date" value="${esc(fa(v.issue_date || ""))}" inputmode="numeric"></label>
        <label class="wide">شرح (اختیاری)<input name="title" value="${esc(v.title || "")}" placeholder="مثلاً آگهی مناقصه، آگهی تسلیت…"></label>
        <label>مبلغ کل<input name="total" inputmode="numeric" value="${v.total ? num(v.total) : ""}"><small class="money-hint" data-h="total"></small></label>
        <label>سود من<input name="profit" inputmode="numeric" value="${v.profit ? num(v.profit) : ""}"><small class="money-hint" data-h="profit"></small></label>
        <label>هزینه (سهم) روزنامه‌ی اصلی<input name="paper_cost" inputmode="numeric" value="${v.paper_cost ? num(v.paper_cost) : ""}"><small class="money-hint" data-h="paper_cost"></small></label>
      </div>
      <div class="small pp-check" id="pi-check"></div>
      <div style="margin-top:10px"><b class="small">وضعیت</b><div>${statusSeg(v.status)}</div></div>
      <div id="pi-follow-box" style="margin-top:8px"></div>
      <div class="pp-files"><b class="small">📎 پیوست‌ها <span class="muted">(عکس فاکتور، رسید، نامه، PDF…)</span></b>
        <div id="pi-files"></div>
        <button type="button" class="btn sm" id="pi-addf">📎 افزودن فایل</button><input type="file" id="pi-fin" multiple hidden accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.txt"></div>
      ${ppHistoryHTML(inv)}
      <div class="modal-error" id="pi-err"></div>
      <div class="modal-actions">${isNew ? "" : `<button type="button" class="btn danger ghost" id="pi-del">🗑 حذف</button>`}<span style="flex:1"></span>
        <button type="button" class="btn" onclick="this.closest('dialog').close()">بستن</button><button class="btn primary">✔ ذخیره</button></div>
    </form>`;
  const form = $("#pi-form"), dlg = $("#dlg");
  let status = v.status;
  const fillPapers = () => {
    const c = ppClient(form.client_id.value), sel = form.paper_id;
    const list = c ? m.papers.filter((p) => c.paper_ids.includes(p.id)) : m.papers;
    const cur = sel.value || String(v.paper_id || "");
    sel.innerHTML = `<option value="">— انتخاب —</option>` + list.map((p) => `<option value="${p.id}" ${String(p.id) === cur ? "selected" : ""}>${esc(p.name)}</option>`).join("");
    if (list.length === 1) sel.value = list[0].id;
  };
  const followBox = () => {
    const box = $("#pi-follow-box");
    if (status === "collected") {
      box.innerHTML = `<label class="small">تاریخ وصول<input id="pi-coll" value="${esc(fa(v.collected_date || META.today))}" inputmode="numeric" style="width:130px"></label>
        <p class="small muted" style="margin:4px 0 0">با ذخیره، <b>مبلغ کل</b> به‌عنوان درآمد و <b>سهم روزنامه</b> به‌عنوان هزینه در بخش 💰 مالی ثبت می‌شود و یادآوری پیگیری بسته می‌شود.</p>`;
    } else {
      const keep = status === v.status && v.follow_date ? v.follow_date : Jalali.addDays(META.today, status === "follow" ? 7 : 7);
      box.innerHTML = `<b class="small">تاریخ پیگیری</b>${ppFollowHTML(keep)}<p class="small muted" style="margin:4px 0 0">در این تاریخ ساعت ۹ صبح یادآوری می‌آید (در بخش ⏰ یادآوری‌ها و اعلان گوشی/بله).</p>`;
      ppBindFollow(box);
    }
  };
  const check = () => {
    for (const k of ["total", "profit", "paper_cost"]) { const n = ppAmount(form[k].value); $(`[data-h=${k}]`, form).textContent = n ? `${moneyWords(n)} ${META.currency}` : ""; }
    const t = ppAmount(form.total.value), p = ppAmount(form.profit.value), c = ppAmount(form.paper_cost.value);
    const box = $("#pi-check");
    if (t && c && !p && t > c) {
      box.innerHTML = `<button type="button" class="btn sm" id="pi-sug">💡 سود من = مبلغ کل − سهم روزنامه = ${moneyWords(t - c)}</button>`;
      $("#pi-sug").onclick = () => { form.profit.value = num(t - c); check(); };
    } else box.innerHTML = t && (p || c) && p + c !== t ? `⚠ سود من + سهم روزنامه (${moneyWords(p + c)}) با مبلغ کل (${moneyWords(t)}) برابر نیست؛ اگر درست است، اشکالی ندارد.` : "";
  };
  for (const k of ["total", "profit", "paper_cost"]) form[k].addEventListener("input", () => { const n = ppAmount(form[k].value); form[k].value = n ? num(n) : ""; check(); });
  ppBindClientCombo(form, fillPapers);
  $$(".pp-sseg [data-s]", form).forEach((b) => (b.onclick = () => { status = b.dataset.s; $$(".pp-sseg [data-s]", form).forEach((x) => x.classList.toggle("active", x === b)); followBox(); }));
  fillPapers(); followBox(); check();
  // پیوست‌ها: فاکتور تازه ← بعد از ذخیره بارگذاری می‌شوند
  const pending = [];
  const fileIcon = (n) => (/\.(jpe?g|png|webp|gif|heic)$/i.test(n) ? "🖼" : /\.pdf$/i.test(n) ? "📄" : "📁");
  const kb = (b) => (b >= 1048576 ? `${num((b / 1048576).toFixed(1))} مگابایت` : `${num(Math.max(1, Math.round(b / 1024)))} کیلوبایت`);
  const drawFiles = () => {
    const saved = (inv?.files || []).map((f) => `<div class="pp-file"><a href="/api/paper-invoice-files/${f.id}" target="_blank" rel="noopener">${fileIcon(f.filename)} ${esc(f.filename)}</a>
        <small class="muted">${kb(f.size)}</small><a class="btn sm ghost" href="/api/paper-invoice-files/${f.id}?download=1" title="دانلود">⬇️</a><button type="button" class="btn sm ghost" data-fdel="${f.id}" title="حذف">✕</button></div>`);
    const waiting = pending.map((f, i) => `<div class="pp-file pend">${fileIcon(f.name)} ${esc(f.name)} <small class="muted">${kb(f.size)} · بعد از ذخیره بارگذاری می‌شود</small><button type="button" class="btn sm ghost" data-pdel="${i}">✕</button></div>`);
    $("#pi-files").innerHTML = [...saved, ...waiting].join("") || `<div class="small muted">فایلی پیوست نشده.</div>`;
    $$("[data-fdel]", form).forEach((b) => (b.onclick = async () => {
      if (!confirm("این پیوست حذف شود؟")) return;
      await api(`/api/paper-invoice-files/${b.dataset.fdel}`, { method: "DELETE" });
      inv.files = inv.files.filter((x) => x.id !== Number(b.dataset.fdel)); drawFiles(); PP.dirty = true;
    }));
    $$("[data-pdel]", form).forEach((b) => (b.onclick = () => { pending.splice(Number(b.dataset.pdel), 1); drawFiles(); }));
  };
  const upload = async (iid, files) => {
    let ok = 0;
    for (const [i, f] of files.entries()) {
      const r = await uploadOne(`/api/paper-invoices/${iid}/files`, f, {}, (p) => toast(`بارگذاری ${num(i + 1)} از ${num(files.length)}… ${num(Math.round(p * 100))}٪`, 60000));
      if (r.ok) ok++; else toast(`«${f.name}»: ${r.error}`, 6000);
    }
    return ok;
  };
  $("#pi-addf").onclick = () => $("#pi-fin").click();
  $("#pi-fin").onchange = async (ev) => {
    const files = [...ev.target.files]; ev.target.value = "";
    if (!files.length) return;
    if (isNew) { pending.push(...files); drawFiles(); return; }
    const ok = await upload(inv.id, files);
    if (ok) { toast(`✔ ${num(ok)} فایل پیوست شد`); inv.files = (await api(`/api/paper-invoices/${inv.id}`)).files; drawFiles(); PP.dirty = true; }
  };
  drawFiles();
  dlg.addEventListener("close", () => { if (PP.dirty) { PP.dirty = false; refresh(); } }, { once: true });
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const body = { client_id: Number(form.client_id.value) || null, paper_id: Number(form.paper_id.value) || null, number: enDigits(form.number.value.trim()),
      issue_date: enDigits(form.issue_date.value.trim()), title: form.title.value.trim(), total: ppAmount(form.total.value), profit: ppAmount(form.profit.value),
      paper_cost: ppAmount(form.paper_cost.value), status };
    if (status === "collected") body.collected_date = enDigits($("#pi-coll").value.trim());
    else body.follow_date = enDigits($("#pi-follow").value.trim());
    try {
      const r = await api(isNew ? "/api/paper-invoices" : `/api/paper-invoices/${inv.id}`, { method: isNew ? "POST" : "PUT", body });
      if (pending.length) await upload(r.id, pending.splice(0));
      dlg.close();
      toast(status === "collected" ? "✅ وصول ثبت شد و درآمد/هزینه به بخش مالی رفت" : `✔ ذخیره شد · یادآوری پیگیری: ${fa(r.follow_date || "")}`, 4500);
      refresh();
    } catch (e) { $("#pi-err").textContent = e.message; }
  };
  if (!isNew) $("#pi-del").onclick = async () => {
    if (!confirm(`فاکتور ${fa(inv.number)} حذف شود؟${inv.status === "collected" ? " درآمد و هزینه‌ی ثبت‌شده‌اش در بخش مالی هم حذف می‌شود." : ""}`)) return;
    await api(`/api/paper-invoices/${inv.id}`, { method: "DELETE" });
    dlg.close(); toast("فاکتور حذف شد"); refresh();
  };
  dlg.showModal();
}

// تغییر سریع وضعیت (تمدید پیگیری یا اعلام وصول)
function ppStatusDialog(inv) {
  const m = PP.meta;
  $("#dlg-body").innerHTML = `<h3>${PP_STATUS_ICON[inv.status]} فاکتور ${esc(fa(inv.number))} — ${esc(inv.client_name || "")}</h3>
    <p class="small muted" style="margin-top:0">${esc(inv.paper_name || "")} · مبلغ کل ${moneyWords(inv.total)} · وضعیت فعلی: <b>${esc(inv.status_label)}</b>${inv.follow_date && inv.status !== "collected" ? ` تا ${esc(fa(inv.follow_date))}` : ""}</p>
    <div class="pp-quick">
      <button class="btn" data-q="reprint">🖨 تجدید چاپ دوم</button>
      <button class="btn" data-q="refollow">🔁 پیگیری مجدد</button>
      <button class="btn" data-q="follow">🔎 در حال پیگیری</button>
      <button class="btn primary" data-q="collected">✅ اعلام وصول</button>
    </div>
    <div id="pq-follow" style="margin-top:10px"><b class="small">تاریخ پیگیری تازه</b>${ppFollowHTML(Jalali.addDays(META.today, 7))}</div>
    ${ppHistoryHTML(inv)}
    <div class="modal-error" id="pq-err"></div>
    <div class="modal-actions"><button class="btn" onclick="this.closest('dialog').close()">بستن</button><button class="btn ghost" id="pq-full">✏️ ویرایش کامل</button></div>`;
  ppBindFollow($("#dlg-body"));
  $$("[data-q]", $("#dlg-body")).forEach((b) => (b.onclick = async () => {
    const st = b.dataset.q, body = { status: st };
    if (st === "collected") {
      if (!confirm(`وصول ${moneyWords(inv.total)} ${META.currency} ثبت شود؟ مبلغ کل درآمد و سهم روزنامه (${moneyWords(inv.paper_cost)}) هزینه‌ی بخش مالی می‌شود.`)) return;
      body.collected_date = META.today;
    } else body.follow_date = enDigits($("#pi-follow").value.trim());
    try {
      const r = await api(`/api/paper-invoices/${inv.id}`, { method: "PUT", body });
      $("#dlg").close();
      toast(st === "collected" ? "✅ وصول ثبت شد و به بخش مالی رفت" : `✔ ${m.status[st]} · یادآوری تازه برای ${fa(r.follow_date)}`, 4500);
      refresh();
    } catch (e) { $("#pq-err").textContent = e.message; }
  }));
  $("#pq-full").onclick = () => ppInvoiceForm(inv);
  $("#dlg").showModal();
}

// ───── مشتری‌ها ─────
function ppClientsTab(box) {
  const m = PP.meta;
  box.innerHTML = `<div class="card"><div class="btn-row" style="justify-content:space-between"><h3 style="margin:0">👥 مشتری‌ها</h3>
      <button class="btn primary" id="pc-new" ${m.papers.length ? "" : "disabled"}>➕ مشتری تازه</button></div>
    ${m.papers.length ? "" : `<p class="small warn-bar">اول در زبانه‌ی «📰 روزنامه‌ها» روزنامه‌ها را ثبت کنید.</p>`}
    <div class="list pp-list">${m.clients.map((c) => `<div class="row" data-cl="${c.id}"><span><b>${esc(c.name)}</b><br>
      <small class="muted">${c.paper_ids.length === m.papers.length && m.papers.length > 1 ? "همه‌ی روزنامه‌ها" : c.paper_ids.map((id) => esc(ppPaper(id)?.name || "")).join("، ")}</small>
      ${(c.phones || []).length ? `<br><small class="muted">📞 ${c.phones.map(ppPhText).join(" · ")}</small>` : ""}
      ${c.address ? `<br><small class="muted">📍 ${esc(c.address)}</small>` : ""}</span>
      <span class="btn-row"><small class="muted">${num(c.invoices)} فاکتور</small><button class="btn sm" data-cedit="${c.id}">✏️ ویرایش</button><button class="btn sm" data-cinv="${c.id}">🧾 فاکتورها</button></span></div>`).join("") || `<div class="empty">هنوز مشتری‌ای تعریف نشده.</div>`}</div></div>`;
  if ($("#pc-new")) $("#pc-new").onclick = () => ppClientForm(null);
  $$("[data-cl]", box).forEach((el) => (el.onclick = (ev) => { if (ev.target.closest("[data-cinv]")) return; ppClientForm(ppClient(el.dataset.cl)); }));
  $$("[data-cedit]", box).forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); ppClientForm(ppClient(b.dataset.cedit)); }));
  $$("[data-cinv]", box).forEach((b) => (b.onclick = () => { PP.f = { ...PP.f, client_id: b.dataset.cinv, paper_id: "" }; PP.tab = "inv"; refresh(); }));
}
function ppClientForm(c) {
  const m = PP.meta, isNew = !c, v = c || { kind: "office", paper_ids: m.papers.length === 1 ? [m.papers[0].id] : [] };
  $("#dlg-body").innerHTML = `<h3>👥 ${isNew ? "مشتری تازه" : `ویرایش «${esc(c.name)}»`}</h3>
    <form id="pc-form" class="pp-form">
      <div class="pp-fgrid">
        <label class="wide">نام (اداره، شخص، شرکت…)<input name="name" value="${esc(v.name || "")}" required></label>
        <div class="wide"><b class="small">شماره تلفن</b><div id="pc-phones" class="pc-phones"></div>
          <button type="button" class="btn sm ghost" id="pc-addph">➕ شماره‌ی دیگر</button>
          <datalist id="pc-phl">${["روابط عمومی", "مدیر", "دفتر", "همراه", "حسابداری", "مسئول آگهی"].map((x) => `<option value="${x}">`).join("")}</datalist></div>
        <label class="wide">آدرس<textarea name="address" rows="2">${esc(v.address ?? v.notes ?? "")}</textarea></label>
      </div>
      <b class="small">برای کدام روزنامه‌ها؟</b>
      <div class="pp-papers">${m.papers.map((p) => `<label class="chk"><input type="checkbox" name="pp" value="${p.id}" ${v.paper_ids.includes(p.id) ? "checked" : ""}> ${esc(p.name)}</label>`).join("")}</div>
      <div class="btn-row"><button type="button" class="btn sm ghost" id="pc-all">✔ همه‌ی روزنامه‌ها</button><button type="button" class="btn sm ghost" id="pc-none">✕ هیچ‌کدام</button></div>
      <div class="modal-error" id="pc-err"></div>
      <div class="modal-actions">${isNew ? "" : `<button type="button" class="btn danger ghost" id="pc-del">🗑 حذف</button>`}<span style="flex:1"></span>
        <button type="button" class="btn" onclick="this.closest('dialog').close()">بستن</button><button class="btn primary">✔ ذخیره</button></div>
    </form>`;
  const form = $("#pc-form"), phBox = $("#pc-phones");
  const addPhone = (val = "") => {
    const p = ppPh(val), row = document.createElement("div");
    row.className = "pc-ph";
    row.innerHTML = `<input name="phl" list="pc-phl" value="${esc(p.label)}" placeholder="عنوان (اختیاری)" class="pc-phl">
      <input name="ph" type="tel" inputmode="tel" class="ltr" value="${esc(fa(p.number))}" placeholder="مثلاً ۰۹۱۲۳۴۵۶۷۸۹"><button type="button" class="btn sm ghost" title="حذف این شماره">✕</button>`;
    $("button", row).onclick = () => { row.remove(); if (!$$(".pc-ph", phBox).length) addPhone(); };
    phBox.appendChild(row);
    return $("input", row);
  };
  const phs = (v.phones && v.phones.length ? v.phones : [v.phone || ""]);
  phs.forEach((x) => addPhone(x));
  $("#pc-addph").onclick = () => addPhone().focus();
  $("#pc-all").onclick = () => $$("[name=pp]", form).forEach((x) => (x.checked = true));
  $("#pc-none").onclick = () => $$("[name=pp]", form).forEach((x) => (x.checked = false));
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const body = { name: form.name.value, address: form.address.value,
      phones: $$(".pc-ph", form).map((r) => ({ label: $("[name=phl]", r).value.trim(), number: enDigits($("[name=ph]", r).value.trim()) })).filter((x) => x.number),
      paper_ids: $$("[name=pp]:checked", form).map((x) => Number(x.value)) };
    try { await api(isNew ? "/api/paper-clients" : `/api/paper-clients/${c.id}`, { method: isNew ? "POST" : "PUT", body }); $("#dlg").close(); toast("✔ ذخیره شد"); refresh(); }
    catch (e) { $("#pc-err").textContent = e.message; }
  };
  if (!isNew) $("#pc-del").onclick = async () => {
    if (!confirm(`«${c.name}» حذف شود؟`)) return;
    try { await api(`/api/paper-clients/${c.id}`, { method: "DELETE" }); $("#dlg").close(); refresh(); } catch (e) { $("#pc-err").textContent = e.message; }
  };
  $("#dlg").showModal();
  setTimeout(() => form.name.focus(), 50);
}

// ───── روزنامه‌ها ─────
function ppPapersTab(box) {
  const m = PP.meta;
  box.innerHTML = `<div class="card"><h3>📰 روزنامه‌ها</h3>
    <form class="btn-row" id="pr-add"><input name="name" placeholder="نام روزنامه، مثلاً «کرمان امروز»" style="flex:1;min-width:180px" required><button class="btn primary">➕ افزودن</button></form>
    <div class="list pp-list" style="margin-top:8px">${m.papers.map((p) => `<div class="row"><span><b>${esc(p.name)}</b><br><small class="muted">${num(p.clients)} مشتری · ${num(p.invoices)} فاکتور</small></span>
      <span class="btn-row"><button class="btn sm" data-pinv="${p.id}">🧾 فاکتورها</button><button class="btn sm ghost" data-pren="${p.id}">✏️</button><button class="btn sm ghost" data-pdel="${p.id}">🗑</button></span></div>`).join("") || `<div class="empty">هنوز روزنامه‌ای ثبت نشده. اولین روزنامه را بالا بنویسید.</div>`}</div></div>`;
  $("#pr-add").onsubmit = async (ev) => {
    ev.preventDefault();
    try { await api("/api/papers", { method: "POST", body: { name: ev.target.name.value } }); toast("✔ روزنامه اضافه شد"); refresh(); } catch (e) { toast(e.message, 5000); }
  };
  $$("[data-pren]", box).forEach((b) => (b.onclick = async () => {
    const p = ppPaper(b.dataset.pren), name = prompt("نام تازه‌ی روزنامه:", p.name);
    if (!name || name === p.name) return;
    try { await api(`/api/papers/${p.id}`, { method: "PUT", body: { name, notes: p.notes } }); refresh(); } catch (e) { toast(e.message, 5000); }
  }));
  $$("[data-pdel]", box).forEach((b) => (b.onclick = async () => {
    const p = ppPaper(b.dataset.pdel);
    if (!confirm(`روزنامه‌ی «${p.name}» حذف شود؟`)) return;
    try { await api(`/api/papers/${p.id}`, { method: "DELETE" }); refresh(); } catch (e) { toast(e.message, 6000); }
  }));
  $$("[data-pinv]", box).forEach((b) => (b.onclick = () => { PP.f = { ...PP.f, paper_id: b.dataset.pinv, client_id: "" }; PP.tab = "inv"; refresh(); }));
}

// جستجوی مشتری با تایپ (نام یا شماره)؛ «ی/ي» و «ک/ك» و ارقام فارسی یکی حساب می‌شوند
const ppNorm = (t) => enDigits(String(t || "")).replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[‌\s]+/g, " ").trim().toLowerCase();
function ppBindClientCombo(form, onPick) {
  const q = $("#pi-cq", form), list = $("#pi-clist", form), hid = form.client_id;
  let items = [], idx = -1;
  const draw = () => {
    const words = ppNorm(q.value).split(" ").filter(Boolean);
    items = PP.meta.clients.filter((c) => {
      const hay = ppNorm(`${c.name} ${(c.phones || []).map((x) => `${ppPh(x).label} ${ppPh(x).number}`).join(" ")} ${c.address || ""}`);
      return words.every((w) => hay.includes(w));
    }).slice(0, 30);
    idx = items.length ? 0 : -1;
    list.innerHTML = items.length ? items.map((c, i) => `<button type="button" data-ci="${i}" class="${i === idx ? "on" : ""}"><b>${esc(c.name)}</b>
        <small class="muted">${c.paper_ids.map((id) => esc(ppPaper(id)?.name || "")).join("، ")}${(c.phones || []).length ? ` · ${ppPhText(c.phones[0])}` : ""}</small></button>`).join("")
      : `<div class="small muted" style="padding:8px">مشتری‌ای با این نام نیست. در زبانه‌ی «👥 مشتری‌ها» تعریفش کنید.</div>`;
    list.hidden = false;
    $$("[data-ci]", list).forEach((b) => b.addEventListener("mousedown", (ev) => { ev.preventDefault(); pick(items[Number(b.dataset.ci)]); }));
  };
  const pick = (c) => {
    if (!c) return;
    hid.value = c.id; q.value = c.name; list.hidden = true;
    q.classList.add("ok");
    onPick();
  };
  q.addEventListener("input", () => { hid.value = ""; q.classList.remove("ok"); draw(); onPick(); });
  q.addEventListener("focus", () => { q.select(); draw(); });
  q.addEventListener("blur", () => setTimeout(() => {
    list.hidden = true;
    if (!hid.value) { const exact = PP.meta.clients.find((c) => ppNorm(c.name) === ppNorm(q.value)); if (exact) pick(exact); }
  }, 150));
  q.addEventListener("keydown", (ev) => {
    if (list.hidden || !items.length) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault(); idx = (idx + (ev.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      $$("[data-ci]", list).forEach((b, i) => b.classList.toggle("on", i === idx));
    } else if (ev.key === "Enter") { ev.preventDefault(); pick(items[idx]); }
    else if (ev.key === "Escape") list.hidden = true;
  });
  if (hid.value) q.classList.add("ok");
}
