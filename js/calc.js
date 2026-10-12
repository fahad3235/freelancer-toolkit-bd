/* freelancer-toolkit-bd — pure money/time math.
 * All money is integer MINOR units (poisha for BDT, cents for USD) so every
 * total is exact to 2 decimals. No DOM, no storage — safe to unit-test in Node.
 */
(function (root, factory) {
  'use strict';
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.FtbdCalc = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // "1,250.50" -> 125050 ; "" / negative / NaN -> null
  function parseMinor(str) {
    if (str === '' || str === null || str === undefined) return null;
    var n = Number(String(str).replace(/,/g, '').trim());
    if (!isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  }

  // "2.5" -> 2.5 ; must be > 0 ; else null
  function parsePositive(str) {
    if (str === '' || str === null || str === undefined) return null;
    var n = Number(String(str).replace(/,/g, '').trim());
    if (!isFinite(n) || n <= 0) return null;
    return n;
  }

  // "15" -> 15 ; must be within 0..100 ; else null
  function parsePct(str) {
    if (str === '' || str === null || str === undefined) return null;
    var n = Number(String(str).trim());
    if (!isFinite(n) || n < 0 || n > 100) return null;
    return n;
  }

  // Billable amount for a session: duration ms × hourly rate (minor/hr).
  // E.g. 2.5h (9,000,000 ms) × 2000¢/hr → 5000¢ = $50.00 exactly.
  function billableMinor(ms, rateMinor) {
    if (!(ms > 0) || !(rateMinor >= 0)) return 0;
    return Math.round(ms * rateMinor / 3600000);
  }

  // 9000000 -> "2h 30m" ; 2700000 -> "45m" ; 3600000 -> "1h"
  function fmtDuration(ms) {
    ms = Math.max(0, Math.round(ms));
    var mins = Math.round(ms / 60000);
    var h = Math.floor(mins / 60), m = mins % 60;
    if (h > 0 && m > 0) return h + 'h ' + m + 'm';
    if (h > 0) return h + 'h';
    return m + 'm';
  }

  function groupLakh(intStr) { // "1250000" -> "12,50,000"
    var s = String(intStr), out = '';
    if (s.length > 3) {
      out = ',' + s.slice(-3); s = s.slice(0, -3);
      while (s.length > 2) { out = ',' + s.slice(-2) + out; s = s.slice(0, -2); }
      out = s + out;
    } else out = s;
    return out;
  }

  function groupIntl(intStr) { // "1250000" -> "1,250,000"
    var s = String(intStr), out = '';
    while (s.length > 3) { out = ',' + s.slice(-3) + out; s = s.slice(0, -3); }
    return s + out;
  }

  var SYM = { BDT: '৳', USD: '$' };

  // 1250050 minor BDT -> "৳12,500.50" ; USD uses international grouping.
  function fmtMoney(minor, currency) {
    var neg = minor < 0;
    minor = Math.abs(Math.round(minor));
    var major = Math.floor(minor / 100), frac = minor % 100;
    var g = (currency === 'USD') ? groupIntl(String(major)) : groupLakh(String(major));
    return (neg ? '-' : '') + (SYM[currency] || '') + g + '.' + String(frac).padStart(2, '0');
  }

  // "৳12,500.50" -> "৳১২,৫০০.৫০" (digits only are converted)
  function bnDigits(str) {
    var d = '০১২৩৪৫৬৭৮৯';
    return String(str).replace(/[0-9]/g, function (c) { return d[+c]; });
  }

  function fmtMoneyLang(minor, currency, lang) {
    var s = fmtMoney(minor, currency);
    return lang === 'bn' ? bnDigits(s) : s;
  }

  function fmtDurationLang(ms, lang) {
    var s = fmtDuration(ms);
    return lang === 'bn' ? bnDigits(s) : s;
  }

  // One invoice line: qty (decimal string, e.g. "2.5") × priceMinor.
  // Returns minor int, or null when qty/price invalid. (null/undefined price
  // is rejected explicitly: in JS null >= 0 is true, so a plain >= check
  // would silently turn a bad price into 0.)
  function lineTotal(qtyStr, priceMinor) {
    var q = parsePositive(qtyStr);
    if (q === null || priceMinor === null || priceMinor === undefined || !(priceMinor >= 0)) return null;
    return Math.round(q * priceMinor);
  }

  // items: [{qty, priceMinor}], discountPct/taxPct: 0..100 numbers.
  // Discount on subtotal, then tax on (subtotal - discount); each step rounded.
  function invoiceTotals(items, discountPct, taxPct) {
    var sub = 0;
    for (var i = 0; i < items.length; i++) {
      var lt = lineTotal(items[i].qty, items[i].priceMinor);
      if (lt === null) return { error: 'line' };
      sub += lt;
    }
    var disc = Math.round(sub * discountPct / 100);
    var taxable = sub - disc;
    var tax = Math.round(taxable * taxPct / 100);
    return { sub: sub, disc: disc, tax: tax, grand: taxable + tax };
  }

  // Currency conversion at a MANUAL rate (BDT per 1 USD, decimal string).
  // usdMinor: cents. bdtMinor = usdMinor * rate  (cents/100 × rate × 100).
  function usdToBdtMinor(usdMinor, rateStr) {
    var r = Number(String(rateStr).trim());
    if (!isFinite(r) || r <= 0 || !(usdMinor >= 0)) return null;
    return Math.round(usdMinor * r);
  }
  function bdtToUsdMinor(bdtMinor, rateStr) {
    var r = Number(String(rateStr).trim());
    if (!isFinite(r) || r <= 0 || !(bdtMinor >= 0)) return null;
    return Math.round(bdtMinor / r);
  }

  // "2026-10-12" -> "2026-10"
  function monthKey(ymd) {
    return String(ymd).slice(0, 7);
  }

  // Last n month keys ending at refDate (Date), oldest first.
  function lastNMonthKeys(n, refDate) {
    var keys = [], d = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
    for (var i = n - 1; i >= 0; i--) {
      var t = new Date(d.getFullYear(), d.getMonth() - i, 1);
      keys.push(t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0'));
    }
    return keys;
  }

  // Monthly paid-income aggregation, normalized to BDT minor using the manual
  // rate. Only PAID invoices count (issue month). USD invoices convert via rate.
  function aggregateMonthlyPaid(invoices, rateStr, n, refDate) {
    var keys = lastNMonthKeys(n, refDate || new Date());
    var out = keys.map(function (k) { return { key: k, bdtMinor: 0 }; });
    var idx = {};
    out.forEach(function (o, i) { idx[o.key] = i; });
    invoices.forEach(function (inv) {
      if (inv.status !== 'paid') return;
      var k = monthKey(inv.issue || '');
      if (!(k in idx)) return;
      var t = invoiceTotals(inv.items || [], Number(inv.discountPct) || 0, Number(inv.taxPct) || 0);
      if (t.error) return;
      var bdt = (inv.currency === 'USD') ? usdToBdtMinor(t.grand, rateStr) : t.grand;
      if (bdt !== null) out[idx[k]].bdtMinor += bdt;
    });
    return out;
  }

  // Per-client rollup from sessions + invoices.
  // Returns { hoursMs, billableMinorBDT, billableMinorUSD, invoicedBDT, invoicedUSD,
  //           paidBDT, paidUSD, outstandingBDT, outstandingUSD, unbilledMinorBDT, unbilledMinorUSD }
  function clientTotals(clientId, data) {
    var acc = {
      hoursMs: 0,
      billableMinorBDT: 0, billableMinorUSD: 0,
      invoicedBDT: 0, invoicedUSD: 0,
      paidBDT: 0, paidUSD: 0,
      unbilledMinorBDT: 0, unbilledMinorUSD: 0
    };
    var projById = {};
    (data.projects || []).forEach(function (p) {
      if (p.clientId === clientId) projById[p.id] = p;
    });
    (data.sessions || []).forEach(function (s) {
      var p = projById[s.projectId];
      if (!p || !s.end) return;
      var ms = s.end - s.start;
      if (!(ms > 0)) return;
      var amt = billableMinor(ms, p.rateMinor);
      acc.hoursMs += ms;
      if (p.currency === 'USD') {
        acc.billableMinorUSD += amt;
        if (!s.invoiceId) acc.unbilledMinorUSD += amt;
      } else {
        acc.billableMinorBDT += amt;
        if (!s.invoiceId) acc.unbilledMinorBDT += amt;
      }
    });
    (data.invoices || []).forEach(function (inv) {
      if (inv.clientId !== clientId) return;
      var t = invoiceTotals(inv.items || [], Number(inv.discountPct) || 0, Number(inv.taxPct) || 0);
      if (t.error) return;
      var pre = inv.currency === 'USD' ? 'USD' : 'BDT';
      acc['invoiced' + pre] += t.grand;
      if (inv.status === 'paid') acc['paid' + pre] += t.grand;
    });
    // outstanding = invoiced - paid, per currency
    acc.outstandingBDT = acc.invoicedBDT - acc.paidBDT;
    acc.outstandingUSD = acc.invoicedUSD - acc.paidUSD;
    return acc;
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' +
      Math.floor(Math.random() * 1e9).toString(36);
  }

  return {
    parseMinor: parseMinor,
    parsePositive: parsePositive,
    parsePct: parsePct,
    billableMinor: billableMinor,
    fmtDuration: fmtDuration,
    fmtDurationLang: fmtDurationLang,
    groupLakh: groupLakh,
    groupIntl: groupIntl,
    fmtMoney: fmtMoney,
    fmtMoneyLang: fmtMoneyLang,
    bnDigits: bnDigits,
    lineTotal: lineTotal,
    invoiceTotals: invoiceTotals,
    usdToBdtMinor: usdToBdtMinor,
    bdtToUsdMinor: bdtToUsdMinor,
    monthKey: monthKey,
    lastNMonthKeys: lastNMonthKeys,
    aggregateMonthlyPaid: aggregateMonthlyPaid,
    clientTotals: clientTotals,
    uid: uid
  };
});
