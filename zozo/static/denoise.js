"use strict";
// ═════════════════════════ حذف نویز صدا ═════════════════════════
// فیلم یا فایل صوتی ← صدای گفتار تمیز (نویز باد، کولر، همهمه، وزوز برق کم می‌شود)؛ تصویر دست نمی‌خورد.

const DN = { m: null, job: null, timer: null, res: null };
const DN_LEVELS = [["light", "ملایم", "کمی از فضای طبیعی صدا می‌ماند"], ["normal", "معمولی", "برای بیشتر مصاحبه‌ها"], ["strong", "قوی", "نویز خیلی زیاد (باد، خیابان)"]];

VIEWS.denoise = async (view) => {
  clearInterval(DN.timer);
  const lvl = lsGet("dnLevel", "normal"), norm = lsGet("dnNorm", "1") === "1";
  view.innerHTML = `<div class="page-title"><h2>🔇 حذف نویز صدا</h2></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
      <div class="card"><h3>۱. فیلم یا فایل صوتی</h3>
        <div class="btn-row"><button class="btn primary" id="dn-pick">🎞 انتخاب فیلم یا صدا</button></div>
        <div id="dn-src" class="dn-src"></div>
        <h3 style="margin-top:14px">۲. شدت حذف نویز</h3>
        <div class="dn-levels">${DN_LEVELS.map(([k, l, d]) => `<label class="dn-lv ${k === lvl ? "on" : ""}"><input type="radio" name="dn-l" value="${k}" ${k === lvl ? "checked" : ""}><b>${l}</b><small class="muted">${d}</small></label>`).join("")}</div>
        <label class="chk" style="margin-top:8px"><input type="checkbox" id="dn-norm" ${norm ? "checked" : ""}> بلندی صدا هم یکسان و استاندارد شود</label>
        <button class="btn primary big" id="dn-go" style="width:100%;margin-top:12px">🔇 حذف نویز</button>
        <div id="dn-prog"></div>
        <p class="small muted">تصویر فیلم دست نمی‌خورد؛ فقط صدا تمیز می‌شود. برای صدای گفتار (مصاحبه، گزارش) ساخته شده؛ روی موسیقی ممکن است صدا را خراب کند.</p></div>
      <div class="card"><h3>۳. مقایسه و دانلود</h3><div id="dn-out"><div class="empty">بعد از حذف نویز، این‌جا صدای قبل و بعد را کنار هم می‌شنوید.</div></div></div>
    </div>`;
  $("#dn-pick").onclick = dnPick;
  $$("[name=dn-l]").forEach((r) => (r.onchange = () => { lsSet("dnLevel", r.value); $$(".dn-lv").forEach((l) => l.classList.toggle("on", $("input", l).checked)); }));
  $("#dn-norm").onchange = (ev) => lsSet("dnNorm", ev.target.checked ? "1" : "0");
  $("#dn-go").onclick = dnStart;
  if (DN.m) dnShowSrc();
  if (DN.job && ["queued", "running"].includes(DN.job.status)) dnPoll();
  else if (DN.res) dnShowResult();
};

function dnPick() {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "video/*,audio/*";
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    toast("در حال بارگذاری…", 120000);
    const r = await uploadOne("/api/media", f, { keep: "0" }, (p) => toast(`در حال بارگذاری… ${num(Math.round(p * 100))}٪`, 120000));
    if (!r.ok) return toast(r.error);
    const m = r.data.added[0];
    if (m.kind === "image" || (m.kind === "video" && !m.has_audio)) return toast("این فایل صدا ندارد", 5000);
    toast("بارگذاری شد ✔", 1500);
    DN.m = m; DN.res = null; DN.job = null;
    dnShowSrc();
    $("#dn-out").innerHTML = `<div class="empty">حالا «🔇 حذف نویز» را بزنید.</div>`;
    $("#dn-prog").innerHTML = "";
  };
  inp.click();
}
const dnPlayer = (m) => (m.kind === "video"
  ? `<video controls playsinline preload="metadata" src="/api/media/${m.id}/file"></video>`
  : `<audio controls preload="metadata" src="/api/media/${m.id}/file"></audio>`);
function dnShowSrc() {
  const m = DN.m;
  $("#dn-src").innerHTML = `<div class="small" style="margin:6px 0">${m.kind === "video" ? "🎞" : "🎵"} ${esc(m.filename)} · ${num(Math.round(m.duration || 0))} ثانیه</div>${dnPlayer(m)}`;
}

async function dnStart() {
  if (!DN.m) return toast("اول فیلم یا فایل صوتی را انتخاب کنید");
  try {
    DN.job = await api("/api/denoise", { method: "POST", body: { media_id: DN.m.id, level: $("[name=dn-l]:checked").value, normalize: $("#dn-norm").checked } });
    DN.res = null;
    dnPoll();
  } catch (e) { if (!(e instanceof LoginRequired)) toast(e.message, 6000); }
}
function dnPoll() {
  const btn = $("#dn-go");
  if (btn) { btn.disabled = true; btn.textContent = "در حال حذف نویز…"; }
  clearInterval(DN.timer);
  const tick = async () => {
    try { DN.job = await api(`/api/denoise/${DN.job.id}`); } catch (e) { clearInterval(DN.timer); toast(e.message, 6000); dnIdle(); return; }
    const j = DN.job, box = $("#dn-prog");
    if (box) box.innerHTML = `<div class="dn-bar"><i style="width:${Math.round(j.progress * 100)}%"></i></div><div class="small muted">${j.status === "queued" ? "در صف…" : `${num(Math.round(j.progress * 100))}٪`}</div>`;
    if (j.status === "done") { clearInterval(DN.timer); DN.res = j.result; dnIdle(); if (box) box.innerHTML = ""; dnShowResult(); toast("نویز گرفته شد ✔"); }
    if (j.status === "error") { clearInterval(DN.timer); dnIdle(); if (box) box.innerHTML = `<div class="warn-bar">${esc(j.error || "خطا")}</div>`; }
  };
  DN.timer = setInterval(tick, 1000);
  tick();
}
function dnIdle() { const btn = $("#dn-go"); if (btn) { btn.disabled = false; btn.textContent = "🔇 حذف نویز"; } }

function dnShowResult() {
  const box = $("#dn-out"), m = DN.res;
  if (!box || !m) return;
  box.innerHTML = `<div class="dn-cmp"><div><b class="small">قبل</b>${dnPlayer(DN.m)}</div><div><b class="small">بعد (بدون نویز) ✨</b>${dnPlayer(m)}</div></div>
    <div class="btn-row" style="margin-top:8px"><a class="btn primary" href="/api/media/${m.id}/file" download="${esc(m.filename)}">⬇️ دانلود ${m.kind === "video" ? "فیلم" : "صدا"}</a>
      ${m.kind === "video" ? `<button class="btn" id="dn-reel">🎬 بفرست به ریلزساز (بدنه)</button>` : `<button class="btn" data-dr="1">🎬 صدای مرحله‌ی ۱ ریلز</button><button class="btn" data-dr="2">🎬 صدای جداگانه‌ی مرحله‌ی ۲</button>`}</div>
    <p class="small muted">هر دو را پخش کنید و مقایسه کنید. اگر صدا کمی «فلزی» یا بریده شد، شدت «ملایم» را امتحان کنید. فایل‌ها دو روز بعد خودکار از سرور پاک می‌شوند؛ نسخه‌ی دانلودشده پیش خودتان می‌ماند.</p>`;
  // پخش یکی، دیگری را متوقف کند
  const players = $$("video,audio", box);
  players.forEach((el) => el.addEventListener("play", () => players.forEach((o) => o !== el && o.pause())));
  if ($("#dn-reel")) $("#dn-reel").onclick = () => dnToReel(m);
  $$("[data-dr]", box).forEach((b) => (b.onclick = () => ttsToReel(m, b.dataset.dr)));
}
// فیلم تمیزشده ← مرحله‌ی دوم (بدنه) ریلزساز
function dnToReel(m) {
  if (!RL.s) { try { RL.s = { ...reelDefaults(), ...JSON.parse(lsGet("reelDraft", "null") || "{}") }; } catch { RL.s = reelDefaults(); } }
  rlAddBodyMedia({ ...m, kind: "video", has_audio: 1 });
  RL.s.caps.manual = [];
  RL.tab = 2;
  reelSave();
  toast("فیلم بدون نویز به بدنه‌ی ریلز (مرحله‌ی ۲) اضافه شد ✔", 4000);
  location.hash = "#teaser";
}
