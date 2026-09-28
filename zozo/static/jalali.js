"use strict";
// تبدیل تاریخ شمسی ↔ میلادی (همان الگوریتم سرور، zozo/jalali.py)
const Jalali = (() => {
  const MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
  const WEEK = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
  const div = (a, b) => Math.floor(a / b);

  function g2j(gy, gm, gd) {
    const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    const gy2 = gm > 2 ? gy + 1 : gy;
    let days = 355666 + 365 * gy + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) + gd + gdm[gm - 1];
    let jy = -1595 + 33 * div(days, 12053);
    days %= 12053;
    jy += 4 * div(days, 1461);
    days %= 1461;
    if (days > 365) { jy += div(days - 1, 365); days = (days - 1) % 365; }
    const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
    const jd = days < 186 ? 1 + (days % 31) : 1 + ((days - 186) % 30);
    return [jy, jm, jd];
  }

  function j2g(jy, jm, jd) {
    jy += 1595;
    let days = -355668 + 365 * jy + div(jy, 33) * 8 + div((jy % 33) + 3, 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
    let gy = 400 * div(days, 146097);
    days %= 146097;
    if (days > 36524) { days--; gy += 100 * div(days, 36524); days %= 36524; if (days >= 365) days++; }
    gy += 4 * div(days, 1461);
    days %= 1461;
    if (days > 365) { gy += div(days - 1, 365); days = (days - 1) % 365; }
    let gd = days + 1;
    const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
    const md = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let gm = 1;
    while (gm <= 12 && gd > md[gm]) { gd -= md[gm]; gm++; }
    return [gy, gm, gd];
  }

  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (jy, jm, jd) => `${jy}/${pad(jm)}/${pad(jd)}`;
  const parse = (s) => {
    const m = String(s || "").replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const fromDate = (d) => fmt(...g2j(d.getFullYear(), d.getMonth() + 1, d.getDate()));
  const toDate = (s) => { const p = parse(s); if (!p) return null; const [y, m, d] = j2g(...p); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return fromDate(d); };
  const monthLength = (jy, jm) => {
    if (jm <= 6) return 31;
    if (jm <= 11) return 30;
    const a = new Date(...j2g(jy, 12, 1).map((v, i) => (i === 1 ? v - 1 : v)));
    const b = new Date(...j2g(jy + 1, 1, 1).map((v, i) => (i === 1 ? v - 1 : v)));
    return Math.round((b - a) / 86400000);
  };
  // ستون روز هفته (شنبه = ۰)
  const weekCol = (s) => (toDate(s).getDay() + 1) % 7;
  const today = () => fromDate(new Date());
  const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);

  return { MONTHS, WEEK, g2j, j2g, fmt, parse, fromDate, toDate, addDays, monthLength, weekCol, today, daysBetween, pad };
})();
