"use strict";
// ═════════════════════════ متن به صدا ═════════════════════════
// متن فارسی ← فایل صوتی با صدای زن یا مرد؛ فایل در «فایل‌های ریلز» ذخیره می‌شود و در ریلزساز قابل استفاده است.

const TTS = { voices: null, last: null };
const TTS_RATES = [[-20, "آرام"], [-10, "کمی آرام"], [0, "عادی"], [10, "کمی تند"], [20, "تند"]];

async function ttsVoices() {
  if (!TTS.voices) TTS.voices = await api("/api/tts/voices");
  return TTS.voices;
}

// فرم مشترک (صفحه‌ی «متن به صدا» و پنجره‌ی داخل ریلزساز)
function ttsFormHTML(text, info) {
  const v0 = lsGet("ttsVoice", "female"), r0 = Number(lsGet("ttsRate", "0"));
  return `<label class="wide" style="display:block">متن<textarea id="tts-text" rows="8" style="width:100%" placeholder="متن خبر، لید یا هر نوشته‌ای که باید خوانده شود…">${esc(text || "")}</textarea></label>
    <div class="small muted" id="tts-count"></div>
    <div class="tts-voices">${info.voices.map((v) => `<label class="tts-voice ${v.id === v0 ? "on" : ""}"><input type="radio" name="tts-v" value="${v.id}" ${v.id === v0 ? "checked" : ""}>
      <span class="ic">${v.gender === "female" ? "👩" : "👨"}</span><b>${esc(v.name)}</b></label>`).join("")}</div>
    <div class="btn-row" style="margin-top:8px"><label>سرعت خواندن <select id="tts-rate">${TTS_RATES.map(([v, l]) => `<option value="${v}" ${v === r0 ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <button class="btn primary" id="tts-go">🔊 ساخت صدا</button></div>
    <div id="tts-out"></div>`;
}

function bindTtsForm(root, { onUse } = {}) {
  const ta = $("#tts-text", root), count = $("#tts-count", root);
  const upd = () => {
    const w = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0;
    count.textContent = w ? `${num(w)} کلمه · حدود ${num(Math.max(1, Math.round(w / 2.3)))} ثانیه صدا` : "";
  };
  ta.addEventListener("input", upd); upd();
  $$("[name=tts-v]", root).forEach((r) => (r.onchange = () => { $$(".tts-voice", root).forEach((l) => l.classList.toggle("on", $("input", l).checked)); lsSet("ttsVoice", r.value); }));
  $("#tts-rate", root).onchange = (ev) => lsSet("ttsRate", ev.target.value);
  $("#tts-go", root).onclick = async () => {
    const text = ta.value.trim();
    if (!text) return toast("اول متن را بنویسید یا بچسبانید");
    const btn = $("#tts-go", root);
    btn.disabled = true; btn.textContent = "در حال ساختن صدا… (چند ثانیه)";
    try {
      const r = await api("/api/tts", { method: "POST", body: { text, voice: $("[name=tts-v]:checked", root).value, rate: Number($("#tts-rate", root).value) } });
      TTS.last = r;
      const m = r.media;
      $("#tts-out", root).innerHTML = `<div class="tts-result">
        ${r.note ? `<div class="warn-bar">${esc(r.note)}</div>` : ""}
        <div class="small muted">${esc(r.voice_name)} · ${num(r.words)} کلمه · ${num((m.duration || 0).toFixed(1))} ثانیه</div>
        <audio controls src="/api/media/${m.id}/file" style="width:100%;margin:6px 0"></audio>
        <div class="btn-row"><a class="btn sm" href="/api/media/${m.id}/file" download="${esc(m.filename)}">⬇️ دانلود mp3</a>
          ${onUse ? `<button class="btn sm primary" data-use>✅ استفاده از همین صدا</button>` : `<button class="btn sm" data-reel="1">🎬 صدای مرحله‌ی ۱ ریلز</button><button class="btn sm" data-reel="2">🎬 صدای جداگانه‌ی مرحله‌ی ۲</button>`}</div></div>`;
      if (onUse) $("[data-use]", root).onclick = () => onUse(m);
      $$("[data-reel]", root).forEach((b) => (b.onclick = () => ttsToReel(m, b.dataset.reel)));
      if (!onUse) drawTtsHistory();
    } catch (e) { if (!(e instanceof LoginRequired)) toast(e.message, 8000); }
    btn.disabled = false; btn.textContent = "🔊 ساخت صدا";
  };
}

// گذاشتن صدای ساخته‌شده در ریلزساز
function ttsToReel(m, stage) {
  if (!RL.s) { try { RL.s = { ...reelDefaults(), ...JSON.parse(lsGet("reelDraft", "null") || "{}") }; } catch { RL.s = reelDefaults(); } }
  if (stage === "1") { RL.s.audio1 = { ...RL.s.audio1, media_id: m.id, src: 0 }; RL.tab = 1; }
  else { RL.s.audio2 = { ...reelDefaults().audio2, ...(RL.s.audio2 || {}), media_id: m.id, src: 0 }; RL.tab = 2; }
  reelSave();
  toast(stage === "1" ? "صدا در مرحله‌ی ۱ ریلز گذاشته شد ✔" : "صدا به‌عنوان صدای جداگانه‌ی مرحله‌ی ۲ گذاشته شد ✔", 4000);
  location.hash = "#teaser";
}

// پنجره‌ی «ساخت صدا از متن» (از داخل ریلزساز)
async function openTtsDialog(text, onUse) {
  const info = await ttsVoices();
  $("#dlg-body").innerHTML = `<h3>🗣️ ساخت صدا از متن</h3>${ttsFormHTML(text, info)}<div class="modal-actions"><button class="btn" onclick="this.closest('dialog').close()">بستن</button></div>`;
  $("#dlg").showModal();
  bindTtsForm($("#dlg-body"), { onUse: (m) => { $("#dlg").close(); onUse(m); } });
}

async function drawTtsHistory() {
  const box = $("#tts-hist");
  if (!box) return;
  const items = (await api("/api/media").catch(() => [])).filter((m) => m.kind === "audio" && /^صدا-/.test(m.filename)).slice(0, 12);
  box.innerHTML = items.length ? items.map((m) => `<div class="tts-h"><div class="small"><b>${m.filename.includes("female") ? "👩" : "👨"}</b> ${esc(m.filename.replace(/^صدا-[a-z_]+-/, "").replace(/\.mp3$/, ""))} · ${num((m.duration || 0).toFixed(0))} ث</div>
      <audio controls preload="none" src="/api/media/${m.id}/file"></audio>
      <div class="btn-row"><a class="btn sm ghost" href="/api/media/${m.id}/file" download="${esc(m.filename)}">⬇️</a><button class="btn sm ghost" data-h1="${m.id}">🎬 مرحله‌ی ۱</button><button class="btn sm ghost" data-h2="${m.id}">🎬 مرحله‌ی ۲</button></div></div>`).join("")
    : `<div class="empty">هنوز صدایی ساخته نشده.</div>`;
  $$("[data-h1]", box).forEach((b) => (b.onclick = () => ttsToReel({ id: Number(b.dataset.h1) }, "1")));
  $$("[data-h2]", box).forEach((b) => (b.onclick = () => ttsToReel({ id: Number(b.dataset.h2) }, "2")));
}

VIEWS.tts = async (view) => {
  const info = await ttsVoices();
  view.innerHTML = `<div class="page-title"><h2>🗣️ متن به صدا</h2></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
      <div class="card"><h3>متن را بنویسید، صدا را انتخاب کنید</h3>${ttsFormHTML(lsGet("ttsDraft", ""), info)}
        <p class="small muted">صدای «زن» و «مرد» طبیعی‌ترند و به اینترنت سرور نیاز دارند؛ «مرد (امیر، بدون اینترنت)» روی خود سرور ساخته می‌شود (بار اول کمی طول می‌کشد).
        برای تلفظ درست، اعداد را با رقم بنویسید و نیم‌فاصله‌ها را رعایت کنید.</p></div>
      <div class="card"><h3>صداهای ساخته‌شده</h3><div id="tts-hist" class="tts-hist"></div></div>
    </div>`;
  bindTtsForm(view);
  $("#tts-text", view).addEventListener("input", (ev) => lsSet("ttsDraft", ev.target.value));
  drawTtsHistory();
};
