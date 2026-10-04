"use strict";
// ═════════════════════════ پیشنهاد پست و ریلز آماده از روی سوژه ═════════════════════════

async function loadImg(src) {
  return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
}

// یک فریم از ریلز پیشنهادی (با قالب فعلی تیزرساز) روی بوم
function drawReelFrame(cv, state, img, phase) {
  const keep = TZ.s;
  TZ.s = state;
  const [W, H] = META.teaser_sizes["9:16"];
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#1a2433"; ctx.fillRect(0, 0, W, H);
  if (img) drawMedia(ctx, img, W, H, "blur", 1, phase === "intro" && state.clips?.[0]?.gray);
  drawBrand(ctx, W, H, phase === "intro" ? "intro" : "main");
  if (phase === "intro") drawHeadline(ctx, W, H);
  else {
    const cap = state.captionsText.split("\n").find(Boolean);
    if (cap) drawCaption(ctx, W, H, cap);
  }
  TZ.s = keep;
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
  // وضعیت ریلز بر اساس تنظیمات ذخیره‌شده‌ی برند
  const brand = (await api("/api/prefs/teaser_brand").catch(() => ({}))).value || {};
  const reel = { ...teaserDefaults(), ...brand, headline: sg.reel.headline, title: sg.reel.headline, captionsText: sg.reel.captions.join("\n"),
    story_id: sg.story.id, headlineMode: "first", clips: [] };
  if (!TZ.logoEl && reel.logoId) { TZ.logoEl = await loadImg(logoUrl(reel.logoId)); }
  if (!PS.logo) PS.logo = await loadImg("/static/brand/logo.png");

  const render = () => {
    const keepS = PS.s, keepI = PS.img;
    PS.s = post; PS.img = img;
    drawPost($("#sg-post"));
    PS.s = keepS; PS.img = keepI;
    drawReelFrame($("#sg-r1"), reel, img, "intro");
    drawReelFrame($("#sg-r2"), reel, img, "main");
  };
  const reelClips = () => {
    const n = Math.max(1, reel.captionsText.split("\n").filter(Boolean).length);
    const dur = Math.min(30, 4 + n * 3.2);
    return [{ media_id: mediaId, kind: "image", duration: +dur.toFixed(1), zoom: true, hasThumb: true }];
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
        <p class="small muted">${num(reel.captionsText.split("\n").filter(Boolean).length)} زیرنویس · ابتدا تیتر، بعد زیرنویس‌ها روی عکس</p>
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
    TZ.s = { ...reel, clips: reelClips() };
    saveDraft();
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
