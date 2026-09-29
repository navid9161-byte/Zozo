"use strict";
// ═════════════════════════ عکس / PDF به متن ═════════════════════════
// فایل در بایگانی ذخیره می‌شود (برچسب «متن‌خوان») و همان پردازشگر اسناد با OCR فارسی آن را می‌خواند.

const OCR_TAG = "متن‌خوان";
const OC = { poll: null };

// عکس گوشی: چرخش درست (EXIF)، کوچک کردن عکس‌های خیلی بزرگ؛ اسکرین‌شات‌ها دست نمی‌خورند
async function normalizeImage(file) {
  if (!file.type.startsWith("image/") || !window.createImageBitmap) return file;
  if (file.type === "image/png" && file.size < 4e6) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 3000 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 3e6 && file.type === "image/jpeg") return file;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.93));
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch { return file; }
}

// سطرهای شکسته‌ی OCR ← پاراگراف (مگر سطر خالی یا پایان جمله)
function joinLines(text) {
  return text.split(/\n{2,}/).map((para) => para.split("\n").map((l) => l.trim()).filter(Boolean)
    .reduce((acc, l) => (acc && !/[.!?؟:]$/.test(acc.split("\n").pop()) ? `${acc} ${l}` : acc ? `${acc}\n${l}` : l), ""))
    .filter(Boolean).join("\n\n");
}

VIEWS.ocr = async (view, params) => {
  clearTimeout(OC.poll);
  if (params.get("id")) return renderOcrDoc(view, Number(params.get("id")));
  const data = await api(`/api/documents?tag=${encodeURIComponent(OCR_TAG)}`);
  const docs = data.documents;
  const busy = docs.some((d) => ["queued", "processing"].includes(d.status));
  view.innerHTML = `
    <div class="page-title"><h2>📄 عکس و PDF به متن</h2></div>
    ${META.ocr ? "" : `<div class="warn-bar">خواندن متن (OCR) روی سرور نصب نیست؛ فقط PDFهای متنی خوانده می‌شوند.</div>`}
    <div class="card">
      <h3>عکس یا فایل جدید</h3>
      <div class="btn-row">
        <label class="btn primary big">📷 عکس گرفتن<input type="file" id="oc-cam" accept="image/*" capture="environment" hidden></label>
        <label class="btn big">🖼️ انتخاب عکس یا PDF<input type="file" id="oc-files" accept="image/*,application/pdf,.pdf" multiple hidden></label>
      </div>
      <div class="progress" id="oc-prog" hidden><span style="width:0"></span></div>
      <p class="small muted" id="oc-st">عکس بیانیه، نامه، صفحه‌ی روزنامه، اسکرین‌شات یا PDF اسکن‌شده. متن فارسی و انگلیسی خوانده و آماده‌ی کپی می‌شود.
        برای نتیجه‌ی بهتر: عکس صاف، روشن و بدون سایه بگیرید. دست‌نوشته خوب خوانده نمی‌شود.</p>
    </div>
    <div class="card"><h3>فایل‌ها <span class="count">${num(docs.length)}</span></h3>
      <div class="list">${docs.map((d) => {
        const prog = d.status === "processing" && d.pages ? Math.round((100 * d.pages_done) / d.pages) : null;
        const [sl, sc] = { queued: ["در صف", "gray"], processing: ["در حال خواندن", "amber"], ready: ["آماده", "green"], error: ["خطا", "red"] }[d.status] || [d.status, ""];
        return `<div class="item" data-oc="${d.id}"><span class="doc-icon">${d.kind === "pdf" ? "📕" : "🖼️"}</span><div class="body">
          <div class="title">${esc(d.title)}</div>
          <div class="meta"><span class="badge ${sc}">${sl}${prog !== null ? " " + num(prog) + "٪" : ""}</span>${d.pages > 1 ? `<span>${num(d.pages)} صفحه</span>` : ""}<span>${relTime(d.created_at)}</span></div>
          ${prog !== null ? `<div class="progress"><span style="width:${prog}%"></span></div>` : ""}
        </div></div>`;
      }).join("") || `<div class="empty">هنوز فایلی نیست.</div>`}</div>
    </div>`;
  const handle = (files) => uploadForOcr([...files]);
  $("#oc-cam").onchange = (ev) => handle(ev.target.files);
  $("#oc-files").onchange = (ev) => handle(ev.target.files);
  $$("[data-oc]", view).forEach((el) => (el.onclick = () => (location.hash = `#ocr?id=${el.dataset.oc}`)));
  if (busy) OC.poll = setTimeout(() => { if (currentPage === "ocr" && !parseHash().params.get("id")) refresh(); }, 3000);
};

async function uploadForOcr(files) {
  if (!files.length) return;
  const prog = $("#oc-prog"), st = $("#oc-st");
  prog.hidden = false;
  let last = null;
  for (let i = 0; i < files.length; i++) {
    st.textContent = `در حال آماده‌سازی و بارگذاری ${num(i + 1)} از ${num(files.length)}…`;
    const f = await normalizeImage(files[i]);
    const r = await uploadOne("/api/documents", f, { category: "document", tags: OCR_TAG, title: files[i].name.replace(/\.\w+$/, "") },
      (fr) => (prog.firstElementChild.style.width = `${(100 * (i + fr)) / files.length}%`));
    if (r.ok) last = r.data.added[0]; else toast(`${files[i].name}: ${r.error}`, 6000);
  }
  if (last) location.hash = files.length === 1 ? `#ocr?id=${last.id}` : "#ocr";
  if (files.length > 1 || !last) refresh();
}

async function renderOcrDoc(view, id) {
  const { document: d, pages } = await api(`/api/documents/${id}/pages`);
  const pending = ["queued", "processing"].includes(d.status);
  const prog = d.status === "processing" && d.pages ? Math.round((100 * d.pages_done) / d.pages) : 0;
  const joined = lsGet("ocrJoin", "1") === "1";
  const clean = lsGet("ocrClean", "1") === "1";
  const src = (p) => (clean ? p.text : p.raw ?? p.text);
  const fullText = () => pages.map((p) => (joined ? joinLines(src(p)) : src(p)).trim()).filter(Boolean).join("\n\n");
  view.innerHTML = `
    <div class="page-title"><h2>📄 ${esc(d.title)}</h2><a class="btn sm" href="#ocr">→ همه</a></div>
    ${pending ? `<div class="card center">${d.status === "queued" ? "در صف خواندن…" : `در حال خواندن متن… ${d.pages ? num(prog) + "٪" : ""}`}
      <div class="progress"><span style="width:${prog}%"></span></div><p class="small muted">هر صفحه‌ی اسکن‌شده حدود ۲ تا ۵ ثانیه.</p></div>` : ""}
    ${d.status === "error" ? `<div class="card error">${esc(d.error || "خطا")} <button class="btn sm" id="oc-re">↻ دوباره</button></div>` : ""}
    ${d.status === "ready" ? `
    <div class="card">
      <div class="btn-row">
        <button class="btn primary" id="oc-copy">📋 کپی همه‌ی متن</button>
        <button class="btn" id="oc-fix">🪄 اصلاح متن فارسی</button>
        <button class="btn" id="oc-sum">📝 خلاصه</button>
        <button class="btn" id="oc-tools">✍️ ویرایشگر متن</button>
      </div>
      <div class="btn-row small" style="margin-top:8px">
        <label><input type="checkbox" id="oc-join" ${joined ? "checked" : ""}> پیوستن سطرهای شکسته</label>
        <label><input type="checkbox" id="oc-clean" ${clean ? "checked" : ""}> حذف سطرهای نامفهوم</label>
        <span class="muted">دانلود:</span><button class="btn sm" id="oc-docx">Word</button><button class="btn sm" id="oc-txt">متن ساده</button>
      </div>
      ${d.weak_pages ? `<p class="small" style="color:var(--warn)">⚠️ متن ${num(d.weak_pages)} صفحه کیفیت پایینی دارد؛ آن را با صفحه‌ی اصلی مقایسه کنید.</p>` : ""}
      <div id="oc-sumbox"></div>
      <textarea id="oc-text" dir="rtl" style="width:100%;min-height:50vh;margin-top:10px;line-height:2;font-size:16px">${esc(fullText())}</textarea>
      <p class="small muted">متن را همین‌جا می‌توانید اصلاح کنید؛ کپی و دانلود از همین متن انجام می‌شود.</p>
    </div>
    ${pages.length > 1 || ["pdf", "image"].includes(d.kind) ? `<div class="card"><h3>صفحه‌به‌صفحه</h3><div class="list">${pages.map((p) => `<div class="result">
      <div class="btn-row"><b>صفحه ${num(p.page)}</b>${p.method === "ocr" ? `<span class="badge amber">OCR</span>` : p.method === "weak" ? `<span class="badge red">کیفیت پایین</span>` : ""}
        <button class="btn sm" data-cp="${p.page}">📋 کپی</button>${["pdf", "image"].includes(d.kind) ? `<button class="btn sm" data-view="${p.page}">🖼 دیدن اصل</button>` : ""}</div>
      <div class="src-text" style="-webkit-line-clamp:4">${esc(src(p).slice(0, 600))}</div></div>`).join("")}</div></div>` : ""}` : ""}
    <div class="btn-row"><a class="btn" href="/api/documents/${id}/file" target="_blank">📄 فایل اصلی</a><button class="btn danger" id="oc-del">🗑 حذف</button></div>`;

  $("#oc-del").onclick = async () => { if (!confirm("این فایل و متنش حذف شود؟")) return; await api(`/api/documents/${id}`, { method: "DELETE" }); location.hash = "#ocr"; };
  if ($("#oc-re")) $("#oc-re").onclick = async () => { await api(`/api/documents/${id}/reprocess`, { method: "POST" }); refresh(); };
  if (pending) { OC.poll = setTimeout(() => { if (currentPage === "ocr") refresh(); }, 2500); return; }
  if (d.status !== "ready") return;
  const ta = $("#oc-text");
  const base = () => documents_safe(d.title);
  $("#oc-copy").onclick = () => navigator.clipboard.writeText(ta.value).then(() => toast("کپی شد ✔"));
  $("#oc-join").onchange = (ev) => { lsSet("ocrJoin", ev.target.checked ? "1" : "0"); refresh(); };
  $("#oc-clean").onchange = (ev) => { lsSet("ocrClean", ev.target.checked ? "1" : "0"); refresh(); };
  $("#oc-fix").onclick = async () => { const r = await api("/api/tools/fix", { method: "POST", body: { text: ta.value, digits: false } }); ta.value = r.text; toast("اصلاح شد"); };
  $("#oc-tools").onclick = () => { lsSet("toolsText", ta.value); location.hash = "#tools"; };
  $("#oc-txt").onclick = () => downloadBlob(new Blob(["﻿" + ta.value], { type: "text/plain;charset=utf-8" }), `${base()}.txt`);
  $("#oc-docx").onclick = async () => {
    const res = await fetch("/api/tools/docx", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: d.title, text: ta.value, summary: OC.summary || null }) });
    if (!res.ok) return toast("ساخت فایل Word ناموفق بود");
    downloadBlob(await res.blob(), `${base()}.docx`);
  };
  $("#oc-sum").onclick = async () => {
    const r = await api(`/api/ai/summary`, { method: "POST", body: { text: ta.value, n: 4 } });
    OC.summary = r.lines.map((l) => `• ${l}`).join("\n");
    $("#oc-sumbox").innerHTML = `<div class="out-box" style="margin-top:10px"><b>خلاصه</b>${r.mode === "fallback" ? ` <small class="muted">(مهم‌ترین جمله‌ها، بدون هوش مصنوعی)</small>` : ""}
      <div class="sum-text" style="white-space:pre-line;margin-top:4px">${esc(OC.summary.trim())}</div>
      <button class="btn sm" style="margin-top:6px" id="oc-sumcp">📋 کپی خلاصه</button></div>`;
    $("#oc-sumcp").onclick = () => navigator.clipboard.writeText(OC.summary).then(() => toast("کپی شد"));
  };
  $$("[data-cp]", view).forEach((b) => (b.onclick = () => {
    const p = pages.find((x) => x.page === Number(b.dataset.cp));
    navigator.clipboard.writeText(joined ? joinLines(src(p)) : src(p)).then(() => toast("کپی شد"));
  }));
  $$("[data-view]", view).forEach((b) => (b.onclick = () => showPage(id, Number(b.dataset.view), d.kind)));
}

function documents_safe(name) { return String(name || "text").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60); }
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
