"use strict";
// ═════════════════════════ ابزارهای مشترک ویدیو و طراحی ═════════════════════════
// (تیزرساز قدیمی حذف شد؛ همه‌ی ساخت ویدیو با ریلزساز سه‌مرحله‌ای در reel.js است.)
// این‌جا فقط چیزهایی مانده که پست‌ساز، فاکتور، طراح لایه‌ها و ریلزساز با هم استفاده می‌کنند.

const TZ = { poll: null };

// تقسیم متن بلند (لید) به تکه‌های کوتاه برای زیرنویس
function splitLead(text, max = 10) {
  const out = [];
  for (const para of String(text).split("\n").map((x) => x.trim()).filter(Boolean)) {
    const words = para.split(/\s+/);
    if (words.length <= max + 3) { out.push(para); continue; }
    let cur = [];
    words.forEach((w, i) => {
      cur.push(w);
      const end = /[.!؟?؛;،,:]$/.test(w.replace(/[*»"']+$/, ""));
      const left = words.length - i - 1;
      if ((end && cur.length >= 5) || cur.length >= max) {
        if (left > 0 && left < 4 && !end) return;  // تکه‌ی آخر خیلی کوتاه نماند
        out.push(cur.join(" ")); cur = [];
      }
    });
    if (cur.length) out.push(cur.join(" "));
  }
  // ستاره‌های رنگی که بین دو تکه شکسته شده‌اند، در هر تکه کامل شوند
  let open = false;
  return out.map((l) => { let x = (open ? "*" : "") + l; const n = (l.match(/\*/g) || []).length; if ((n + (open ? 1 : 0)) % 2) { x += "*"; open = true; } else open = false; return x; });
}


const FONT = "Vazirmatn, Tahoma, sans-serif";

function wrapText(ctx, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// شکستن متن با رعایت Enter های کاربر (هر پاراگراف جدا شکسته می‌شود)
function wrapParas(ctx, text, maxW) {
  return String(text).split("\n").map((p) => p.trim()).filter(Boolean).flatMap((p) => wrapText(ctx, p, maxW));
}
function wrapRichParas(ctx, text, base, hi, maxW) {
  return String(text).split("\n").map((p) => p.trim()).filter(Boolean).flatMap((p) => wrapRich(ctx, richWords(p, base, hi), maxW));
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function setup(ctx) { ctx.direction = "rtl"; ctx.textBaseline = "middle"; }
const KR = { red: "#9d1819", navy: "#193153" };

// متن با واژه‌های *ستاره‌دار* قرمز → فهرست واژه‌ها با رنگ
function richWords(text, base, hi) {
  const out = [];
  String(text).split("*").forEach((part, i) => part.split(/\s+/).filter(Boolean).forEach((w) => out.push({ w, c: i % 2 ? hi : base })));
  return out;
}
function wrapRich(ctx, words, maxW) {
  const lines = [];
  let line = [], w = 0;
  const sp = ctx.measureText(" ").width;
  for (const t of words) {
    const tw = ctx.measureText(t.w).width;
    if (line.length && w + sp + tw > maxW) { lines.push({ words: line, w }); line = []; w = 0; }
    w += (line.length ? sp : 0) + tw;
    line.push({ ...t, tw });
  }
  if (line.length) lines.push({ words: line, w });
  return lines;
}
// کشیدن یک سطر راست‌به‌چپ، واژه‌به‌واژه (هر واژه رنگ خودش)
function drawRichLine(ctx, line, right, y) {
  const sp = ctx.measureText(" ").width;
  let x = right;
  ctx.textAlign = "right";
  for (const t of line.words) { ctx.fillStyle = t.c; ctx.fillText(t.w, x, y); x -= t.tw + sp; }
}

function krPattern(ctx, x0, y0, w, h) {
  // الگوی شبکه‌ای کم‌رنگ پس‌زمینه‌ی نوار پایین (ثابت، بدون تصادف)
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const pts = Array.from({ length: 34 }, () => [x0 + rnd() * w, y0 + rnd() * h]);
  ctx.strokeStyle = "rgba(25,49,83,.10)";
  ctx.lineWidth = Math.max(1, h * 0.01);
  pts.forEach((a, i) => pts.slice(i + 1).forEach((b) => { if (Math.hypot(a[0] - b[0], a[1] - b[1]) < h * 0.9) { ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); } }));
  ctx.fillStyle = "rgba(25,49,83,.16)";
  pts.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, h * 0.018, 0, Math.PI * 2); ctx.fill(); });
}


// فهرست ویدیوهای ساخته‌شده
const TZ_STATUS = { queued: ["در صف", "gray"], rendering: ["در حال ساخت", "amber"], done: ["آماده", "green"], error: ["خطا", "red"], cancelled: ["لغو شد", "gray"] };

function drawList(list) {
  const box = $("#tz-list");
  if (!box) return;
  box.innerHTML = list.length ? list.map((t) => {
    const [st, cls] = TZ_STATUS[t.status] || [t.status, ""];
    return `<div class="teaser-card">
      ${t.has_thumb ? `<img src="/api/teasers/${t.id}/thumb?${t.updated_at}" alt="" data-play="${t.id}" style="cursor:pointer">` : `<div class="clip"><div class="ph">🎬</div></div>`}
      <div><b>${esc(t.title)}</b>
        <div class="meta small muted"><span class="badge ${cls}">${st}${t.status === "rendering" ? " " + num(Math.round(t.progress * 100)) + "٪" : ""}</span> ${t.format === "9:16" ? "عمودی" : ""} ${t.duration ? "· " + num(Math.round(t.duration)) + " ثانیه" : ""} ${t.size ? "· " + num((t.size / 1048576).toFixed(1)) + " MB" : ""}</div>
        ${t.status === "rendering" ? `<div class="progress"><span style="width:${Math.round(t.progress * 100)}%"></span></div>` : ""}
        ${t.error ? `<details class="small error"><summary>جزئیات خطا</summary><code class="ltr" style="white-space:pre-wrap">${esc(t.error)}</code></details>` : ""}
        <div class="btn-row" style="margin-top:4px">
          ${t.status === "done" ? `<button class="btn sm" data-play="${t.id}">▶ دیدن</button><a class="btn sm primary" href="/api/teasers/${t.id}/video?download=1">⬇️ دانلود</a>${t.has_captions ? `<a class="btn sm" href="/api/teasers/${t.id}/srt" title="فایل زیرنویس جدا">SRT</a>` : ""}` : ""}
          ${t.editor?.kr3 ? `<button class="btn sm" data-edit="${t.id}" title="بارگذاری تنظیمات این ریلز در ریلزساز">✏️ ویرایش</button>` : ""}
          ${["error", "cancelled"].includes(t.status) ? `<button class="btn sm" data-retry="${t.id}">↻ دوباره</button>` : ""}
          ${["queued", "rendering"].includes(t.status) ? `<button class="btn sm" data-cancel="${t.id}">توقف</button>` : `<button class="btn sm danger" data-tdel="${t.id}">🗑</button>`}
        </div>
      </div></div>`;
  }).join("") : `<div class="empty">هنوز تیزری ساخته نشده.</div>`;
  box.onclick = async (ev) => {
    const b = ev.target.closest("[data-play],[data-edit],[data-retry],[data-cancel],[data-tdel]");
    if (!b) return;
    const d = b.dataset;
    if (d.play) {
      $("#dlg-body").innerHTML = `<video src="/api/teasers/${d.play}/video" controls autoplay playsinline style="width:100%;max-height:78vh;border-radius:12px;background:#000"></video>
        <div class="modal-actions"><a class="btn primary" href="/api/teasers/${d.play}/video?download=1">⬇️ دانلود</a><button class="btn" onclick="this.closest('dialog').close()">بستن</button></div>`;
      $("#dlg").showModal();
      $("#dlg").addEventListener("close", () => $("#dlg video")?.pause(), { once: true });
    } else if (d.edit) {
      location.hash = `#teaser?load=${d.edit}`;
    } else if (d.retry) { await api(`/api/teasers/${d.retry}/retry`, { method: "POST" }); drawList(await api("/api/teasers")); }
    else if (d.cancel) { await api(`/api/teasers/${d.cancel}/cancel`, { method: "POST" }); setTimeout(async () => drawList(await api("/api/teasers")), 800); }
    else if (d.tdel) { if (!confirm("این تیزر حذف شود؟")) return; await api(`/api/teasers/${d.tdel}`, { method: "DELETE" }); drawList(await api("/api/teasers")); }
  };
  clearTimeout(TZ.poll);
  if (list.some((t) => ["queued", "rendering"].includes(t.status))) {
    TZ.poll = setTimeout(async () => { if (currentPage === "teaser") drawList(await api("/api/teasers").catch(() => list)); }, 3000);
  }
}

