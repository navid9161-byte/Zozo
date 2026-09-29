"use strict";
// ═════════════════════════ تبدیل صوت به متن ═════════════════════════

const TR = { poll: null, saveT: null, dirty: false };
const TR_STATUS = { queued: ["در صف", "gray"], processing: ["در حال تبدیل", "amber"], done: ["آماده", "green"], error: ["خطا", "red"], cancelled: ["لغو شد", "gray"] };

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return fa(h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
}
function fmtDur(sec) {
  if (!sec) return "";
  const m = Math.round(sec / 60);
  return m >= 1 ? `${num(m)} دقیقه` : `${num(Math.round(sec))} ثانیه`;
}

VIEWS.transcribe = async (view, params) => {
  clearTimeout(TR.poll);
  if (params.get("id")) return renderTranscript(view, Number(params.get("id")));
  const [data] = await Promise.all([api("/api/transcripts"), loadRefs()]);
  const st = data.status;
  const busy = data.items.some((t) => ["queued", "processing"].includes(t.status));
  let modelBox = "";
  if (!st.installed) modelBox = `<div class="warn-bar">کتابخانه‌ی تبدیل گفتار (vosk) روی سرور نصب نیست؛ برنامه را دوباره در لیارا مستقر کنید.</div>`;
  else if (!st.model) modelBox = `<div class="warn-bar">مدل فارسی تبدیل گفتار هنوز نصب نیست. ${st.downloading ? "در حال دانلود… (چند دقیقه)" : `<button class="btn sm" id="tr-dl">⬇️ نصب خودکار مدل</button>`}
      <details style="margin-top:6px"><summary>اگر نصب خودکار نشد</summary>
      <p class="small">فایل <code>${esc(st.model_name)}.zip</code> را (حدود ۵۰ مگابایت) از <span class="ltr">alphacephei.com/vosk/models</span> دانلود کنید و این‌جا بارگذاری کنید:</p>
      <label class="btn sm">📦 بارگذاری فایل مدل<input type="file" id="tr-model" accept=".zip" hidden></label></details></div>`;

  view.innerHTML = `
    <div class="page-title"><h2>🎙️ تبدیل صوت به متن</h2></div>
    ${modelBox}
    <div class="card">
      <h3>فایل صوتی یا ویس جدید</h3>
      <div class="form-grid">
        <label>عنوان (اختیاری)<input id="tr-title" placeholder="مثلاً مصاحبه با مدیرکل …"></label>
        <label>مربوط به سوژه<select id="tr-story"><option value=""></option>${REFS.stories.map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join("")}</select></label>
      </div>
      <label class="drop" id="tr-drop" style="margin-top:10px">
        <input type="file" id="tr-files" accept="audio/*,video/*,.ogg,.oga,.opus,.m4a,.amr,.mp3,.wav,.aac,.mp4" multiple hidden>
        <b>🎙️ فایل صوتی را انتخاب کنید یا این‌جا رها کنید</b>
        <small>ویس بله/تلگرام/واتس‌اپ، ضبط گوشی، mp3، m4a، wav یا حتی ویدیو · می‌توانید ویس را مستقیم برای ربات بله هم بفرستید</small>
        <div class="progress" id="tr-prog" hidden><span style="width:0"></span></div>
      </label>
      <p class="small muted">تبدیل روی سرور خودتان و بدون اینترنت انجام می‌شود. صدای تمیز (یک نفر، نزدیک میکروفون) نتیجه‌ی بهتری می‌دهد؛ متن را یک بار بخوانید و به‌خصوص اسم‌ها و عددها را اصلاح کنید.</p>
    </div>
    <div class="card"><h3>متن‌ها <span class="count">${num(data.items.length)}</span></h3>
      <div class="list">${data.items.map((t) => {
        const [sl, sc] = TR_STATUS[t.status] || [t.status, ""];
        return `<div class="item" data-tr="${t.id}"><span class="doc-icon">🎙️</span><div class="body">
          <div class="title">${esc(t.title)}</div>
          <div class="meta"><span class="badge ${sc}">${sl}${t.status === "processing" ? " " + num(Math.round(t.progress * 100)) + "٪" : ""}</span>
            ${t.duration ? `<span>${fmtDur(t.duration)}</span>` : ""}<span>${relTime(t.created_at)}</span>
            ${t.story_name ? `<span>📝 ${esc(t.story_name)}</span>` : ""}${t.has_summary ? `<span class="badge">خلاصه دارد</span>` : ""}</div>
          ${t.status === "processing" ? `<div class="progress"><span style="width:${Math.round(t.progress * 100)}%"></span></div>` : ""}
          ${t.preview ? `<div class="snippet">${esc(t.preview)}</div>` : ""}
          ${t.error ? `<div class="error">${esc(t.error)}</div>` : ""}
        </div></div>`;
      }).join("") || `<div class="empty">هنوز فایلی تبدیل نشده.</div>`}</div>
    </div>`;

  if ($("#tr-dl")) $("#tr-dl").onclick = async () => { await api("/api/asr/download", { method: "POST" }); toast("دانلود مدل شروع شد؛ چند دقیقه صبر کنید"); setTimeout(refresh, 4000); };
  if ($("#tr-model")) $("#tr-model").onchange = async (ev) => {
    toast("در حال بارگذاری و نصب مدل…", 8000);
    const fd = new FormData();
    fd.append("file", ev.target.files[0]);
    const r = await fetch("/api/asr/model", { method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    toast(r.ok ? "مدل نصب شد ✔" : d.detail || "نصب نشد");
    refresh();
  };
  const input = $("#tr-files"), drop = $("#tr-drop");
  input.onchange = () => uploadAudio(input.files);
  drop.addEventListener("dragover", (ev) => { ev.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (ev) => { ev.preventDefault(); drop.classList.remove("over"); uploadAudio(ev.dataTransfer.files); });
  $$("[data-tr]", view).forEach((el) => (el.onclick = () => (location.hash = `#transcribe?id=${el.dataset.tr}`)));
  if (busy || st.downloading) TR.poll = setTimeout(() => { if (currentPage === "transcribe" && !parseHash().params.get("id")) refresh(); }, 4000);
};

async function uploadAudio(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const prog = $("#tr-prog"), label = $("#tr-drop b");
  prog.hidden = false;
  let last = null;
  for (let i = 0; i < files.length; i++) {
    label.textContent = `در حال بارگذاری ${num(i + 1)} از ${num(files.length)}: ${files[i].name}`;
    const r = await uploadOne("/api/transcripts", files[i], { title: files.length === 1 ? $("#tr-title").value : "", story_id: $("#tr-story").value },
      (fr) => (prog.firstElementChild.style.width = `${(100 * (i + fr)) / files.length}%`));
    if (r.ok) last = r.data.added[0]; else toast(`${files[i].name}: ${r.error}`, 6000);
  }
  if (last) {
    toast("در صف تبدیل قرار گرفت 🎙️ وقتی آماده شد اعلان می‌آید.", 4000);
    location.hash = files.length === 1 ? `#transcribe?id=${last.id}` : "#transcribe";
    if (files.length > 1) refresh();
  } else refresh();
}

async function renderTranscript(view, id) {
  const t = await api(`/api/transcripts/${id}`);
  const [sl, sc] = TR_STATUS[t.status] || [t.status, ""];
  const pending = ["queued", "processing"].includes(t.status);
  view.innerHTML = `
    <div class="page-title"><h2>🎙️ ${esc(t.title)}</h2><a class="btn sm" href="#transcribe">→ همه‌ی متن‌ها</a></div>
    <div class="card" style="position:sticky;top:58px;z-index:4">
      <audio id="tr-audio" controls preload="metadata" src="/api/transcripts/${id}/audio" style="width:100%"></audio>
      <div class="btn-row small" style="margin-top:6px">
        <span class="badge ${sc}">${sl}${t.status === "processing" ? " " + num(Math.round(t.progress * 100)) + "٪" : ""}</span>
        ${t.duration ? `<span class="muted">${fmtDur(t.duration)}</span>` : ""}
        <span class="muted">سرعت پخش</span><select id="tr-rate"><option value="0.75">۰٫۷۵</option><option value="1" selected>۱</option><option value="1.25">۱٫۲۵</option><option value="1.5">۱٫۵</option></select>
        <label><input type="checkbox" id="tr-follow" checked> دنبال کردن متن</label>
      </div>
      ${t.status === "processing" ? `<div class="progress"><span style="width:${Math.round(t.progress * 100)}%"></span></div>` : ""}
    </div>
    ${pending ? `<div class="card empty center">${t.status === "queued" ? "در صف تبدیل…" : "در حال تبدیل به متن… می‌توانید از این صفحه بیرون بروید؛ وقتی آماده شد اعلان می‌آید."}
      <div style="margin-top:8px"><button class="btn sm" id="tr-cancel">توقف</button></div></div>` : ""}
    ${t.status === "error" ? `<div class="card error">${esc(t.error || "خطا")}<div style="margin-top:8px"><button class="btn sm" id="tr-retry">↻ دوباره</button></div></div>` : ""}
    ${t.status === "cancelled" ? `<div class="card">لغو شد. <button class="btn sm" id="tr-retry">↻ شروع دوباره</button></div>` : ""}
    ${t.status === "done" ? `
    <div class="card">
      <div class="form-grid">
        <label>عنوان<input id="tr-t" value="${esc(t.title)}"></label>
        <label>مربوط به سوژه<select id="tr-s"><option value=""></option>${REFS.stories.map((s) => `<option value="${s.id}" ${s.id === t.story_id ? "selected" : ""}>${esc(s.title)}</option>`).join("")}</select></label>
      </div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn primary" id="tr-sum">📝 خلاصه</button>
        <button class="btn" id="tr-copy">📋 کپی متن</button>
        <button class="btn" id="tr-tools">✍️ ویرایشگر متن</button>
        <button class="btn" id="tr-arch">🗄️ ذخیره در بایگانی</button>
      </div>
      <div class="btn-row small" style="margin-top:8px"><span class="muted">دانلود:</span>
        <a class="btn sm" href="/api/transcripts/${id}/export?fmt=docx&summary=1">Word</a>
        <a class="btn sm" href="/api/transcripts/${id}/export?fmt=txt&summary=1">متن ساده</a>
        <a class="btn sm" href="/api/transcripts/${id}/export?fmt=txt_times">متن با زمان</a>
        <a class="btn sm" href="/api/transcripts/${id}/export?fmt=srt">زیرنویس SRT</a>
      </div>
      <div id="tr-sumbox">${t.summary ? summaryHTML(t.summary) : ""}</div>
    </div>
    <div class="card"><h3>متن <small id="tr-saved" class="muted">روی هر زمان بزنید تا از همان‌جا پخش شود؛ متن را مستقیم اصلاح کنید</small></h3>
      <div class="segs" id="tr-segs">${t.segments.length ? t.segments.map((s, i) => `<div class="seg-row" data-i="${i}">
        <button class="seg-time" data-t="${s.start}">${fmtTime(s.start)}</button>
        <div class="seg-text" contenteditable="true" dir="rtl" data-i="${i}">${esc(s.text)}</div></div>`).join("") : `<div class="empty">گفتاری در این فایل تشخیص داده نشد.</div>`}</div>
    </div>
    <div class="btn-row"><button class="btn danger" id="tr-del">🗑 حذف</button></div>` : `<div class="btn-row"><button class="btn danger" id="tr-del">🗑 حذف</button></div>`}`;

  const audio = $("#tr-audio");
  $("#tr-rate").onchange = (ev) => (audio.playbackRate = Number(ev.target.value));
  if ($("#tr-cancel")) $("#tr-cancel").onclick = async () => { await api(`/api/transcripts/${id}/cancel`, { method: "POST" }); setTimeout(refresh, 800); };
  if ($("#tr-retry")) $("#tr-retry").onclick = async () => { await api(`/api/transcripts/${id}/retry`, { method: "POST" }); refresh(); };
  $("#tr-del").onclick = async () => {
    if (!confirm("این فایل و متنش حذف شود؟")) return;
    await api(`/api/transcripts/${id}`, { method: "DELETE" });
    location.hash = "#transcribe";
  };
  if (pending) { TR.poll = setTimeout(() => { if (currentPage === "transcribe") refresh(); }, 4000); return; }
  if (t.status !== "done") return;

  const segs = t.segments;
  const box = $("#tr-segs");
  const save = async () => {
    if (!TR.dirty) return;
    TR.dirty = false;
    try {
      await api(`/api/transcripts/${id}`, { method: "PATCH", body: { segments: segs, title: $("#tr-t").value, story_id: $("#tr-s").value || null } });
      $("#tr-saved").textContent = "✔ ذخیره شد";
    } catch (err) { toast(err.message); TR.dirty = true; }
  };
  const markDirty = () => { TR.dirty = true; $("#tr-saved").textContent = "در حال ذخیره…"; clearTimeout(TR.saveT); TR.saveT = setTimeout(save, 1200); };
  box.addEventListener("input", (ev) => {
    const el = ev.target.closest(".seg-text");
    if (!el) return;
    segs[Number(el.dataset.i)].text = el.innerText.replace(/\n+/g, " ").trim();
    markDirty();
  });
  box.addEventListener("click", (ev) => {
    const b = ev.target.closest(".seg-time");
    if (!b) return;
    audio.currentTime = Number(b.dataset.t);
    audio.play().catch(() => {});
  });
  $("#tr-t").onchange = markDirty;
  $("#tr-s").onchange = markDirty;
  // برجسته کردن بخشی که در حال پخش است
  let cur = -1;
  audio.ontimeupdate = () => {
    const tm = audio.currentTime;
    const i = segs.findIndex((s, k) => tm >= s.start && (k === segs.length - 1 || tm < segs[k + 1].start));
    if (i === cur) return;
    $$(".seg-row.on", box).forEach((r) => r.classList.remove("on"));
    cur = i;
    const row = box.querySelector(`.seg-row[data-i="${i}"]`);
    if (row) {
      row.classList.add("on");
      if ($("#tr-follow").checked && !audio.paused && document.activeElement?.closest?.(".seg-text") == null) row.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };
  const fullText = () => segs.map((s) => s.text).filter(Boolean).join(" ");
  $("#tr-copy").onclick = () => navigator.clipboard.writeText(fullText()).then(() => toast("کپی شد"));
  $("#tr-tools").onclick = async () => { await save(); lsSet("toolsText", fullText()); location.hash = "#tools"; };
  $("#tr-arch").onclick = async () => {
    await save();
    await api(`/api/transcripts/${id}/archive`, { method: "POST" });
    toast("در بایگانی ذخیره شد ✔ (قابل جستجو)");
  };
  $("#tr-sum").onclick = async () => {
    await save();
    $("#tr-sumbox").innerHTML = `<div class="empty">در حال خلاصه کردن…</div>`;
    try {
      const r = await api(`/api/transcripts/${id}/summary`, { method: "POST" });
      $("#tr-sumbox").innerHTML = summaryHTML(r.summary, r.keywords, r.mode);
    } catch (err) { $("#tr-sumbox").innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  };
  window.addEventListener("hashchange", save, { once: true });
}

function summaryHTML(summary, keywords, mode) {
  return `<div class="out-box" style="margin-top:12px"><b>خلاصه</b>${mode === "fallback" ? ` <small class="muted">(مهم‌ترین جمله‌ها، بدون هوش مصنوعی)</small>` : ""}
    <div class="sum-text" style="white-space:pre-line;margin-top:4px">${esc(summary.trim())}</div>
    ${keywords?.length ? `<div class="small muted" style="margin-top:6px">واژه‌های پرتکرار: ${esc(keywords.join("، "))}</div>` : ""}
    <button class="btn sm" style="margin-top:6px" onclick="navigator.clipboard.writeText(this.closest('.out-box').querySelector('.sum-text').innerText).then(()=>toast('کپی شد'))">📋 کپی خلاصه</button></div>`;
}
