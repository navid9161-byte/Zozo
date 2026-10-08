"use strict";
// ═════════════════════════ پیشنهاد پست و ریلز آماده از روی سوژه ═════════════════════════

async function loadImg(src) {
  return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
}

async function openSuggestion(storyId) {
  const dlg = $("#dlg");
  $("#dlg-body").innerHTML = `<h3>✨ پیشنهاد پست و ریلز</h3><div class="empty center">در حال آماده‌سازی… (دریافت عکس و متن خبر)</div>`;
  if (!dlg.open) dlg.showModal();
  let sg;
  try { sg = await api(`/api/stories/${storyId}/suggest`, { method: "POST" }); }
  catch (err) { $("#dlg-body").innerHTML = `<p class="error">${esc(err.message)}</p><button class="btn" onclick="this.closest('dialog').close()">بستن</button>`; return; }
  let mediaId = sg.media_id;
  let img = mediaId ? await loadImg(`/api/media/${mediaId}/file`) : null;

  // وضعیت پست بر اساس پیش‌فرض‌های پست‌ساز
  const post = { ...postDefaults(), layout: "news", title: sg.post.title, subtitle: sg.post.subtitle, body: sg.post.body };
  // ریلز: همان ریلزساز سه‌مرحله‌ای (عکس و تیتر در شروع، لید خبر روی عکس، پایان مُهری)
  $("#dlg-body").innerHTML = `<h3>✨ پیشنهاد پست و ریلز</h3><div class="empty center">در حال ساختن لید خبر برای ریلز…</div>`;
  const reel = await reelFromStory(storyId, { mediaId, title: sg.story.title });
  const nCaps = reel.caps.text.split("\n").filter(Boolean).length;
  if (!PS.logo) PS.logo = await loadImg("/static/brand/logo.png");

  const render = () => {
    const keepS = PS.s, keepI = PS.img;
    PS.s = post; PS.img = img;
    drawPost($("#sg-post"));
    PS.s = keepS; PS.img = keepI;
    const tl = (() => { const k = RL.s; RL.s = reel; const x = reelTL(); RL.s = k; return x; })();
    reelSnapshot($("#sg-r1"), reel, Math.min(1.5, tl.d1 / 2));
    reelSnapshot($("#sg-r2"), reel, tl.d2 ? tl.d1 + 0.8 : tl.outro + 1.2);
  };
  $("#dlg-body").innerHTML = `
    <h3>✨ پیشنهاد برای «${esc(sg.story.title)}»</h3>
    ${!img ? `<div class="warn-bar">عکسی برای این سوژه پیدا نشد. <label class="btn sm">📷 انتخاب عکس<input type="file" id="sg-file" accept="image/*" hidden></label></div>` : ""}
    ${sg.source_fetched ? `<p class="small muted">عکس و متن از صفحه‌ی خبر گرفته شد.</p>` : ""}
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
      <div class="card"><h3>🖼️ پست</h3>
        <canvas id="sg-post" style="width:100%;border-radius:8px;border:1px solid var(--line)"></canvas>
        <div class="btn-row" style="margin-top:8px"><button class="btn primary" id="sg-post-ok">✅ تأیید و دانلود</button><button class="btn" id="sg-post-edit">✏️ ویرایش</button></div>
      </div>
      <div class="card"><h3>🎬 ریلز</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <canvas id="sg-r1" style="width:100%;border-radius:8px"></canvas><canvas id="sg-r2" style="width:100%;border-radius:8px"></canvas></div>
        <p class="small muted">شروع: عکس و تیتر · بعد: لید خبر در ${num(nCaps)} زیرنویس روی عکس · پایان: مُهر کرمان راوی</p>
        <div class="btn-row"><button class="btn primary" id="sg-reel-ok" ${img ? "" : "disabled"}>✅ تأیید و ساخت ویدیو</button><button class="btn" id="sg-reel-edit" ${img ? "" : "disabled"}>✏️ ویرایش</button></div>
      </div>
    </div>
    <div class="modal-actions"><button class="btn" onclick="this.closest('dialog').close()">بستن</button></div>`;
  if (document.fonts) await document.fonts.load(`900 40px Vazirmatn`).catch(() => {});
  render();

  if ($("#sg-file")) $("#sg-file").onchange = async (ev) => {
    const f = await normalizeImage(ev.target.files[0]);
    const r = await uploadOne("/api/media", f, {}, () => {});
    if (r.ok) openSuggestionWithMedia(storyId, r.data.added[0].id);
  };
  $("#sg-post-ok").onclick = () => $("#sg-post").toBlob((b) => downloadBlob(b, `post-${storyId}.png`), "image/png");
  $("#sg-post-edit").onclick = () => { PS.s = post; PS.img = img; postSave(); dlg.close(); location.hash = "#post"; };
  const toTeaser = (auto) => {
    if (rlHasWork() && !confirm("ریلزِ نیمه‌کاره‌ی فعلی در ریلزساز با این ریلز جایگزین شود؟")) return;
    RL.s = reel; RL.tab = 1; reelSave();
    dlg.close();
    location.hash = auto ? "#teaser?auto=1" : "#teaser";
  };
  $("#sg-reel-ok").onclick = () => toTeaser(true);
  $("#sg-reel-edit").onclick = () => toTeaser(false);
}

// وقتی کاربر خودش عکس انتخاب کرد: عکس برای این سوژه ذخیره می‌شود و پیشنهاد دوباره ساخته می‌شود
async function openSuggestionWithMedia(storyId, mediaId) {
  await api(`/api/stories/${storyId}/image`, { method: "POST", body: { media_id: mediaId } });
  openSuggestion(storyId);
}
