/* freelancer-toolkit-bd — UI wiring. Vanilla JS, zero network requests.
 * Money everywhere is integer minor units; see js/calc.js.
 * Timer honesty: the live timer only advances while this tab is visible —
 * visibilitychange pauses it (disclosed in the UI).
 */
(function () {
  'use strict';

  var Calc = window.FtbdCalc, Words = window.FtbdWords;
  var LS_TIMER = 'ftbd_timer_v1';
  var LS_DRAFT = 'ftbd_draft_v1';

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var store = window.FtbdStore.createStore(window.localStorage, Calc);
  var loadRes = store.load();
  var lang = (store.get().settings && store.get().settings.lang) || 'en';
  var tab = 'dashboard';
  var draft = null;
  var editingClientId = null, editingProjectId = null;
  var timer = null; // {projectId, start, note, pausedAt}

  function t(key) {
    var L = window.FtbdI18n[lang] || window.FtbdI18n.en;
    return L[key] || window.FtbdI18n.en[key] || key;
  }
  function money(minor, cur) { return Calc.fmtMoneyLang(minor, cur, lang); }
  function dur(ms) { return Calc.fmtDurationLang(ms, lang); }
  function num(x) { return lang === 'bn' ? Calc.bnDigits(String(x)) : String(x); }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  var MONTHS = {
    en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    bn: ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রি', 'মে', 'জুন', 'জুলা', 'আগ', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে']
  };
  function monthLabel(key) { // "2026-10"
    var y = +key.slice(0, 4), m = +key.slice(5, 7);
    return (MONTHS[lang] || MONTHS.en)[m - 1] + ' ' + num(y);
  }
  function fmtShort(minor, cur) {
    var major = Math.round(minor) / 100;
    var s;
    if (Math.abs(major) >= 1000) s = (major / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    else s = String(Math.round(major * 100) / 100);
    return (cur === 'USD' ? '$' : '৳') + (lang === 'bn' ? Calc.bnDigits(s) : s);
  }

  // ---------------- toast ----------------
  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  // ---------------- timer ----------------
  function saveTimer() {
    try {
      if (timer) localStorage.setItem(LS_TIMER, JSON.stringify(timer));
      else localStorage.removeItem(LS_TIMER);
    } catch (e) { /* ignore */ }
  }
  function loadTimer() {
    try {
      var raw = localStorage.getItem(LS_TIMER);
      if (raw) timer = JSON.parse(raw);
    } catch (e) { timer = null; }
  }
  function timerElapsed() {
    if (!timer) return 0;
    return Math.max(0, Date.now() - timer.start);
  }
  function startTimer(projectId, note) {
    if (timer) { toast(t('timerAlready')); return; }
    timer = { projectId: projectId, start: Date.now(), note: note || '', pausedAt: null };
    saveTimer();
    toast(t('timerStarted'));
    render();
  }
  function stopTimer() {
    if (!timer) return;
    var r = store.finishSession({
      projectId: timer.projectId, start: timer.start,
      end: Date.now(), note: timer.note
    });
    if (r.ok) { timer = null; saveTimer(); toast(t('timerStopped')); }
    else toast(t(r.error)); // keep the timer running so no tracked time is lost
    render();
  }
  document.addEventListener('visibilitychange', function () {
    if (!timer) return;
    if (document.hidden) {
      timer.pausedAt = Date.now(); saveTimer();
    } else if (timer.pausedAt) {
      timer.start += Date.now() - timer.pausedAt;
      timer.pausedAt = null; saveTimer();
      var el = $('timerElapsed');
      if (el) el.textContent = dur(timerElapsed());
    }
  });
  setInterval(function () {
    if (timer && tab === 'time' && !document.hidden) {
      var el = $('timerElapsed');
      if (el) el.textContent = dur(timerElapsed());
    }
  }, 1000);

  // ---------------- invoice draft ----------------
  function blankLine() { return { desc: '', qty: '1', unit: 'hours', price: '' }; }
  function newDraft() {
    return {
      clientId: '', currency: 'BDT', no: store.nextInvoiceNo(),
      issue: todayISO(), due: '',
      items: [blankLine()], discountPct: '0', taxPct: '0',
      notes: '', sessionIds: []
    };
  }
  function saveDraft() {
    try { localStorage.setItem(LS_DRAFT, JSON.stringify(draft)); } catch (e) { /* ignore */ }
  }
  function loadDraft() {
    try {
      var raw = localStorage.getItem(LS_DRAFT);
      if (raw) { draft = JSON.parse(raw); return; }
    } catch (e) { /* ignore */ }
    draft = newDraft();
  }
  function draftItemsForCalc() {
    return draft.items.map(function (it) {
      return { qty: it.qty, priceMinor: Calc.parseMinor(it.price) || 0 };
    });
  }
  function draftTotals() {
    return Calc.invoiceTotals(draftItemsForCalc(),
      Number(draft.discountPct) || 0, Number(draft.taxPct) || 0);
  }

  // ---------------- selects ----------------
  function clientOptions(selId) {
    var d = store.get();
    var h = '<option value="">—</option>' + d.clients.map(function (c) {
      return '<option value="' + esc(c.id) + '"' +
        (c.id === selId ? ' selected' : '') + '>' + esc(c.name) +
        (c.company ? ' (' + esc(c.company) + ')' : '') + '</option>';
    }).join('');
    return h;
  }
  function projectOptions(selId, onlyActive) {
    var d = store.get();
    var h = '<option value="">—</option>' + d.projects
      .filter(function (p) { return !onlyActive || p.active; })
      .map(function (p) {
        var c = null;
        d.clients.forEach(function (x) { if (x.id === p.clientId) c = x; });
        return '<option value="' + esc(p.id) + '"' +
          (p.id === selId ? ' selected' : '') + '>' + esc(p.name) +
          ' — ' + esc(c ? c.name : '?') +
          ' (' + money(p.rateMinor, p.currency) + '/h)</option>';
      }).join('');
    return h;
  }

  // ================= DASHBOARD =================
  function renderDashboard() {
    var d = store.get();
    var rate = d.settings.rate;
    function norm(bdt, usd) {
      var c = Calc.usdToBdtMinor(usd, rate);
      return c === null ? null : bdt + c;
    }
    var invB = 0, invU = 0, paidB = 0, paidU = 0, unbB = 0, unbU = 0;
    d.clients.forEach(function (c) {
      var ct = Calc.clientTotals(c.id, d);
      invB += ct.invoicedBDT; invU += ct.invoicedUSD;
      paidB += ct.paidBDT; paidU += ct.paidUSD;
      unbB += ct.unbilledMinorBDT; unbU += ct.unbilledMinorUSD;
    });
    var nInv = norm(invB, invU), nPaid = norm(paidB, paidU),
        nOut = (nInv !== null && nPaid !== null) ? nInv - nPaid : null,
        nUnb = norm(unbB, unbU);

    var months = Calc.aggregateMonthlyPaid(d.invoices, rate, 6, new Date());
    var max = 0;
    months.forEach(function (m) { if (m.bdtMinor > max) max = m.bdtMinor; });
    var W = 620, H = 230, padL = 8, padB = 44, padT = 30;
    var bw = (W - padL * 2) / months.length;
    var bars = months.map(function (m, i) {
      var h = max > 0 ? Math.round((H - padT - padB) * m.bdtMinor / max) : 0;
      var x = padL + i * bw + bw * 0.18, w = bw * 0.64;
      var y = H - padB - h;
      return '<g>' +
        '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) +
        '" height="' + h + '" rx="4" class="bar"/>' +
        (m.bdtMinor > 0 ? '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (y - 8).toFixed(1) +
          '" text-anchor="middle" class="bar-val">' + esc(fmtShort(m.bdtMinor, 'BDT')) + '</text>' : '') +
        '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - padB + 20) + '" text-anchor="middle" class="bar-lab">' +
        esc(monthLabel(m.key)) + '</text></g>';
    }).join('');
    var chart = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="' +
      esc(t('monthlyTitle')) + '">' + bars + '</svg>';

    var rows = d.clients.map(function (c) {
      var ct = Calc.clientTotals(c.id, d);
      function pair(b, u) {
        var parts = [];
        if (b) parts.push(money(b, 'BDT'));
        if (u) parts.push(money(u, 'USD'));
        return parts.length ? parts.join(' + ') : '—';
      }
      return '<tr><td>' + esc(c.name) + '</td><td>' + dur(ct.hoursMs) + '</td><td>' +
        pair(ct.invoicedBDT, ct.invoicedUSD) + '</td><td>' +
        pair(ct.paidBDT, ct.paidUSD) + '</td><td>' +
        pair(ct.outstandingBDT, ct.outstandingUSD) + '</td><td>' +
        pair(ct.unbilledMinorBDT, ct.unbilledMinorUSD) + '</td></tr>';
    }).join('');

    function statCard(label, val) {
      return '<div class="stat"><div class="stat-label">' + esc(label) +
        '</div><div class="stat-val">' + val + '</div></div>';
    }
    var rateHint = (nInv === null)
      ? '<p class="hint">⚠ ' + esc(t('convLink')) + '</p>' : '';

    return '<h2>' + esc(t('dashTitle')) + '</h2>' +
      '<div class="stats">' +
      statCard(t('statInvoiced'), nInv === null ? '—' : money(nInv, 'BDT')) +
      statCard(t('statPaid'), nPaid === null ? '—' : money(nPaid, 'BDT')) +
      statCard(t('statOutstanding'), nOut === null ? '—' : money(nOut, 'BDT')) +
      statCard(t('statUnbilled'), nUnb === null ? '—' : money(nUnb, 'BDT')) +
      '</div>' + rateHint +
      '<div class="card"><h3>' + esc(t('monthlyTitle')) + '</h3>' + chart +
      '<p class="hint">' + esc(t('monthlyNote')) + '</p></div>' +
      '<div class="card"><h3>' + esc(t('perClientTitle')) + '</h3>' +
      (rows ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>' +
        esc(t('colClient')) + '</th><th>' + esc(t('colHours')) + '</th><th>' +
        esc(t('colInvoiced')) + '</th><th>' + esc(t('colPaid')) + '</th><th>' +
        esc(t('colOwing')) + '</th><th>' + esc(t('colUnbilled')) +
        '</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<p class="hint">' + esc(t('noData')) + '</p>') + '</div>';
  }

  // ================= TIME =================
  function renderTime() {
    var d = store.get();
    // --- timer card ---
    var proj = timer ? d.projects.filter(function (p) { return p.id === timer.projectId; })[0] : null;
    var timerHtml;
    if (timer && proj) {
      timerHtml =
        '<div class="timer-live"><div class="timer-proj">' + esc(proj.name) + '</div>' +
        '<div class="timer-elapsed" id="timerElapsed">' + dur(timerElapsed()) + '</div>' +
        '<div class="timer-state">' + esc(t('timerRunning')) + '</div>' +
        '<button id="btnStopTimer" class="btn primary">' + esc(t('stopTimer')) + '</button></div>';
    } else {
      if (timer && !proj) { timer = null; saveTimer(); } // project deleted mid-run
      timerHtml =
        '<div class="row2"><label><span>' + esc(t('timerProject')) + '</span>' +
        '<select id="timerProject">' + projectOptions('', true) + '</select></label>' +
        '<label><span>' + esc(t('timerNoteLabel')) + '</span>' +
        '<input id="timerNote" type="text" maxlength="300"></label></div>' +
        '<button id="btnStartTimer" class="btn primary">' + esc(t('startTimer')) + '</button>';
    }
    // --- project form ---
    var ep = editingProjectId ?
      d.projects.filter(function (p) { return p.id === editingProjectId; })[0] : null;
    var projForm =
      '<div class="card"><h3>' + esc(t('projectsTitle')) + '</h3>' +
      '<div class="grid4">' +
      '<label><span>' + esc(t('pClient')) + '</span><select id="pClient">' +
      clientOptions(ep ? ep.clientId : '') + '</select></label>' +
      '<label><span>' + esc(t('pName')) + '</span><input id="pName" type="text" maxlength="120" value="' +
      esc(ep ? ep.name : '') + '"></label>' +
      '<label><span>' + esc(t('pRate')) + '</span><input id="pRate" type="text" inputmode="decimal" placeholder="1500" value="' +
      esc(ep ? (ep.rateMinor / 100) : '') + '"></label>' +
      '<label><span>' + esc(t('pCurrency')) + '</span><select id="pCurrency">' +
      '<option value="BDT"' + (ep && ep.currency === 'BDT' ? ' selected' : '') + '>BDT (৳)</option>' +
      '<option value="USD"' + (ep && ep.currency === 'USD' ? ' selected' : '') + '>USD ($)</option></select></label>' +
      '</div><div class="btnrow"><button id="btnAddProject" class="btn primary">' +
      esc(ep ? t('cUpdate') : t('pAdd')) + '</button>' +
      (ep ? '<button id="btnCancelProject" class="btn ghost">' + esc(t('cCancel')) + '</button>' : '') +
      '</div>' +
      (d.projects.length ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>' +
      esc(t('pName')) + '</th><th>' + esc(t('colClient')) + '</th><th>' + esc(t('pRate')) +
      '</th><th></th></tr></thead><tbody>' +
      d.projects.map(function (p) {
        var c = d.clients.filter(function (x) { return x.id === p.clientId; })[0];
        return '<tr class="' + (p.active ? '' : 'dim') + '"><td>' + esc(p.name) + '</td><td>' +
          esc(c ? c.name : '?') + '</td><td>' + money(p.rateMinor, p.currency) + '/h</td>' +
          '<td class="actions"><button class="btn small ghost" data-pedit="' + esc(p.id) + '">' +
          esc(t('cEdit')) + '</button> <button class="btn small ghost" data-ptoggle="' + esc(p.id) + '">' +
          (p.active ? '⏸' : '▶') + '</button> <button class="btn small danger-ghost" data-pdel="' +
          esc(p.id) + '">' + esc(t('del')) + '</button></td></tr>';
      }).join('') + '</tbody></table></div>'
        : '<p class="hint">' + esc(t('noProjects')) + '</p>') + '</div>';

    // --- manual entry ---
    var manualHtml =
      '<div class="card"><h3>' + esc(t('manualTitle')) + '</h3>' +
      '<div class="grid4">' +
      '<label><span>' + esc(t('mProject')) + '</span><select id="mProject">' +
      projectOptions('', false) + '</select></label>' +
      '<label><span>' + esc(t('mDate')) + '</span><input id="mDate" type="date" value="' + todayISO() + '"></label>' +
      '<label><span>' + esc(t('mStart')) + '</span><input id="mStart" type="time" value="09:00"></label>' +
      '<label><span>' + esc(t('mEnd')) + '</span><input id="mEnd" type="time" value="11:30"></label>' +
      '</div><label><span>' + esc(t('mNote')) + '</span><input id="mNote" type="text" maxlength="300"></label>' +
      '<div class="btnrow"><button id="btnAddSession" class="btn primary">' + esc(t('addSession')) +
      '</button></div></div>';

    // --- session log ---
    var sess = d.sessions.slice().sort(function (a, b) { return b.start - a.start; });
    var unbB = 0, unbU = 0;
    var rows = sess.map(function (s) {
      var p = d.projects.filter(function (x) { return x.id === s.projectId; })[0];
      var c = p ? d.clients.filter(function (x) { return x.id === p.clientId; })[0] : null;
      var ms = s.end ? (s.end - s.start) : 0;
      var amt = (p && ms > 0) ? Calc.billableMinor(ms, p.rateMinor) : 0;
      if (p && !s.invoiceId && ms > 0) {
        if (p.currency === 'USD') unbU += amt; else unbB += amt;
      }
      var dt = new Date(s.start);
      var ds = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' +
        String(dt.getDate()).padStart(2, '0');
      return '<tr><td>' + esc(ds) + '</td><td>' + esc(p ? p.name : '?') +
        '<div class="sub">' + esc(c ? c.name : '') + '</div></td>' +
        '<td>' + dur(ms) + '</td><td>' + (p ? money(amt, p.currency) : '—') + '</td>' +
        '<td>' + esc(s.note || '') + '</td>' +
        '<td>' + (s.invoiceId ? '<span class="pill yes">' + esc(t('billedYes')) + '</span>'
          : '<span class="pill no">' + esc(t('billedNo')) + '</span>') + '</td>' +
        '<td class="actions"><button class="btn small danger-ghost" data-sdel="' + esc(s.id) + '">' +
        esc(t('del')) + '</button></td></tr>';
    }).join('');

    return '<h2>' + esc(t('timeTitle')) + '</h2>' +
      '<div class="card"><h3>' + esc(t('timerCard')) + '</h3>' + timerHtml +
      '<p class="hint">' + esc(t('timerNote')) + '</p></div>' +
      manualHtml + projForm +
      '<div class="card"><h3>' + esc(t('sessionsTitle')) + '</h3>' +
      (rows ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>' + esc(t('colDate')) +
      '</th><th>' + esc(t('colProject')) + '</th><th>' + esc(t('colDuration')) + '</th><th>' +
      esc(t('colAmount')) + '</th><th>' + esc(t('colNote')) + '</th><th>' + esc(t('colBilled')) +
      '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="unbilled"><strong>' + esc(t('unbilledTotal')) + ':</strong> ' +
      (unbB ? money(unbB, 'BDT') + ' ' : '') + (unbU ? money(unbU, 'USD') : '') +
      ((!unbB && !unbU) ? '—' : '') + '</p>'
        : '<p class="hint">' + esc(t('noSessions')) + '</p>') + '</div>';
  }

  // ================= INVOICES =================
  function renderInvoices() {
    var d = store.get();
    var itemRows = draft.items.map(function (it, i) {
      var pm = Calc.parseMinor(it.price);
      var lt = (pm === null) ? null : Calc.lineTotal(it.qty, pm);
      return '<tr>' +
        '<td><input class="it-desc" data-i="' + i + '" type="text" maxlength="200" value="' +
        esc(it.desc) + '" placeholder="' + esc(t('colDesc')) + '"></td>' +
        '<td><input class="it-qty" data-i="' + i + '" type="text" inputmode="decimal" value="' +
        esc(it.qty) + '"></td>' +
        '<td><input class="it-unit" data-i="' + i + '" type="text" maxlength="20" value="' +
        esc(it.unit) + '"></td>' +
        '<td><input class="it-price" data-i="' + i + '" type="text" inputmode="decimal" value="' +
        esc(it.price) + '"></td>' +
        '<td class="r">' + (lt === null ? '—' : money(lt, draft.currency)) + '</td>' +
        '<td class="actions"><button class="btn small danger-ghost" data-rmline="' + i + '">✕</button></td></tr>';
    }).join('');

    var tt = draftTotals();
    var w = (!tt.error && tt.grand > 0) ? Words.amountWords(tt.grand, draft.currency) : null;

    var hist = d.invoices.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    var histRows = hist.map(function (inv) {
      var c = d.clients.filter(function (x) { return x.id === inv.clientId; })[0];
      var it2 = Calc.invoiceTotals(inv.items, Number(inv.discountPct) || 0, Number(inv.taxPct) || 0);
      return '<tr><td>' + esc(inv.no) +
        ((inv.sessionIds && inv.sessionIds.length)
          ? ' <span class="pill yes" title="' + esc(t('billedBadge')) + '">◷</span>' : '') +
        '</td><td>' + esc(c ? c.name : '?') + '</td><td>' +
        esc(inv.issue) + '</td><td>' + (it2.error ? '—' : money(it2.grand, inv.currency)) + '</td>' +
        '<td><span class="pill ' + (inv.status === 'paid' ? 'yes' : 'no') + '">' +
        esc(inv.status === 'paid' ? t('paid') : t('unpaid')) + '</span></td>' +
        '<td class="actions">' +
        '<button class="btn small ghost" data-invprint="' + esc(inv.id) + '">' + esc(t('printPdf')) + '</button> ' +
        (inv.status === 'paid'
          ? '<button class="btn small ghost" data-invunpaid="' + esc(inv.id) + '">' + esc(t('markUnpaid')) + '</button>'
          : '<button class="btn small ghost" data-invpaid="' + esc(inv.id) + '">' + esc(t('markPaid')) + '</button>') +
        ' <button class="btn small danger-ghost" data-invdel="' + esc(inv.id) + '">' + esc(t('del')) + '</button>' +
        '</td></tr>';
    }).join('');

    return '<h2>' + esc(t('invTitle')) + '</h2>' +
      '<div class="card"><div class="grid4">' +
      '<label><span>' + esc(t('invClient')) + '</span><select id="dClient">' +
      clientOptions(draft.clientId) + '</select></label>' +
      '<label><span>' + esc(t('invCurrency')) + '</span><select id="dCurrency">' +
      '<option value="BDT"' + (draft.currency === 'BDT' ? ' selected' : '') + '>BDT (৳)</option>' +
      '<option value="USD"' + (draft.currency === 'USD' ? ' selected' : '') + '>USD ($)</option></select></label>' +
      '<label><span>' + esc(t('invNo')) + '</span><input id="dNo" type="text" maxlength="24" value="' +
      esc(draft.no) + '"></label>' +
      '<label><span>' + esc(t('invPrefix')) + '</span><input id="dPrefix" type="text" maxlength="10" value="' +
      esc(d.settings.invPrefix || 'FT-') + '"></label>' +
      '<label><span>' + esc(t('invIssue')) + '</span><input id="dIssue" type="date" value="' +
      esc(draft.issue) + '"></label>' +
      '<label><span>' + esc(t('invDue')) + '</span><input id="dDue" type="date" value="' +
      esc(draft.due) + '"></label>' +
      '</div></div>' +
      '<div class="card"><h3>' + esc(t('itemsTitle')) + '</h3>' +
      '<div class="btnrow"><button id="btnFromSessions" class="btn ghost">' +
      esc(t('addFromSessions')) + '</button>' +
      '<button id="btnAddLine" class="btn ghost">' + esc(t('addItem')) + '</button></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>' + esc(t('colDesc')) + '</th><th>' +
      esc(t('colQty')) + '</th><th>' + esc(t('colUnit')) + '</th><th>' + esc(t('colPrice')) +
      ' (' + (draft.currency === 'USD' ? '$' : '৳') + ')</th><th>' + esc(t('colTotal')) +
      '</th><th></th></tr></thead><tbody id="itemBody">' + itemRows + '</tbody></table></div>' +
      '<div class="grid4"><label><span>' + esc(t('discount')) + '</span>' +
      '<input id="dDisc" type="text" inputmode="decimal" value="' + esc(draft.discountPct) + '"></label>' +
      '<label><span>' + esc(t('tax')) + '</span>' +
      '<input id="dTax" type="text" inputmode="decimal" value="' + esc(draft.taxPct) + '"></label></div>' +
      '<label><span>' + esc(t('notes')) + '</span><textarea id="dNotes" rows="2" placeholder="' +
      esc(t('notesPh')) + '">' + esc(draft.notes) + '</textarea></label>' +
      '<div class="totals" id="invTotals">' + totalsHtml(tt, w) + '</div>' +
      '<div class="btnrow"><button id="btnSaveInv" class="btn primary">' + esc(t('saveInvoice')) +
      '</button><button id="btnPrintInv" class="btn primary">' + esc(t('printPdf')) + '</button></div></div>' +
      '<div class="card"><h3>' + esc(t('historyTitle')) + '</h3>' +
      (histRows ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>' + esc(t('colInvNo')) +
      '</th><th>' + esc(t('colClient')) + '</th><th>' + esc(t('colDate')) + '</th><th>' +
      esc(t('colTotal')) + '</th><th>' + esc(t('colStatus')) + '</th><th></th></tr></thead><tbody>' +
      histRows + '</tbody></table></div>' : '<p class="hint">' + esc(t('noInvoices')) + '</p>') + '</div>';
  }

  function totalsHtml(tt, w) {
    if (tt.error) return '<p class="hint">—</p>';
    var cur = draft.currency;
    var h = '<div class="trow"><span>' + esc(t('subtotal')) + '</span><span>' +
      money(tt.sub, cur) + '</span></div>';
    if (tt.disc) h += '<div class="trow"><span>' + esc(t('discount')) + '</span><span>−' +
      money(tt.disc, cur) + '</span></div>';
    if (tt.tax) h += '<div class="trow"><span>' + esc(t('tax')) + '</span><span>+' +
      money(tt.tax, cur) + '</span></div>';
    h += '<div class="trow grand"><span>' + esc(t('grandTotal')) + '</span><span>' +
      money(tt.grand, cur) + '</span></div>';
    if (w && w.en) h += '<div class="words"><div class="words-label">' + esc(t('amountWords')) +
      '</div><div>' + esc(lang === 'bn' ? w.bn : w.en) + '</div>' +
      '<div class="hint">' + esc(t('wordsCap')) + '</div></div>';
    return h;
  }

  // ---- print ----
  function printableInvoice(inv) { // inv: saved invoice OR draft-shaped object
    var d = store.get();
    var c = d.clients.filter(function (x) { return x.id === inv.clientId; })[0] || {};
    var p = d.profile || {};
    var items = inv.items.map(function (it) {
      return { qty: it.qty, priceMinor: it.priceMinor };
    });
    var tt = Calc.invoiceTotals(items, Number(inv.discountPct) || 0, Number(inv.taxPct) || 0);
    var w = Words.amountWords(tt.grand, inv.currency);
    var rows = inv.items.map(function (it, i) {
      var lt = Calc.lineTotal(it.qty, it.priceMinor);
      return '<tr><td>' + num(i + 1) + '</td><td>' + esc(it.desc) + '</td><td>' + esc(it.qty) +
        ' ' + esc(it.unit) + '</td><td class="r">' + Calc.fmtMoney(it.priceMinor, inv.currency) +
        '</td><td class="r">' + Calc.fmtMoney(lt, inv.currency) + '</td></tr>';
    }).join('');
    // Print sheet is always rendered LTR with standard digits for reliability;
    // the words line follows the UI language.
    $('printArea').innerHTML =
      '<div class="sheet">' +
      '<div class="p-head"><div><h1>' + esc(p.name || t('appTitle')) + '</h1>' +
      '<div>' + esc(p.address || '') + '</div>' +
      '<div>' + esc([p.phone, p.email].filter(Boolean).join(' · ')) + '</div></div>' +
      '<div class="p-title">' + esc(t('printTitle')) +
      '<div class="p-no">' + esc(inv.no) + '</div>' +
      '<div class="p-status ' + inv.status + '">' +
      esc(inv.status === 'paid' ? t('paid') : t('unpaid')) + '</div></div></div>' +
      '<div class="p-meta"><div><strong>' + esc(t('billTo')) + '</strong><br>' +
      esc(c.name || '') + '<br>' + esc(c.address || '') + '<br>' + esc(c.phone || '') + '</div>' +
      '<div><strong>' + esc(t('invIssue')) + ':</strong> ' + esc(inv.issue) + '<br>' +
      (inv.due ? '<strong>' + esc(t('invDue')) + ':</strong> ' + esc(inv.due) + '<br>' : '') +
      '<strong>' + esc(t('invCurrency')) + ':</strong> ' + esc(inv.currency) + '</div></div>' +
      '<table class="p-tbl"><thead><tr><th>#</th><th>' + esc(t('colDesc')) + '</th><th>' +
      esc(t('colQty')) + '</th><th>' + esc(t('colPrice')) + '</th><th>' + esc(t('colTotal')) +
      '</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="p-totals">' +
      '<div><span>' + esc(t('subtotal')) + '</span><span>' + Calc.fmtMoney(tt.sub, inv.currency) + '</span></div>' +
      (tt.disc ? '<div><span>' + esc(t('discount')) + '</span><span>−' + Calc.fmtMoney(tt.disc, inv.currency) + '</span></div>' : '') +
      (tt.tax ? '<div><span>' + esc(t('tax')) + '</span><span>+' + Calc.fmtMoney(tt.tax, inv.currency) + '</span></div>' : '') +
      '<div class="grand"><span>' + esc(t('grandTotal')) + '</span><span>' +
      Calc.fmtMoney(tt.grand, inv.currency) + '</span></div></div>' +
      '<div class="p-words"><strong>' + esc(t('amountWords')) + ':</strong> ' +
      esc(lang === 'bn' ? w.bn : w.en) + '</div>' +
      (inv.notes ? '<div class="p-notes"><strong>' + esc(t('notes')) + ':</strong> ' +
      esc(inv.notes) + '</div>' : '') +
      '</div>';
  }

  // ================= CONVERTER =================
  function renderConverter() {
    var d = store.get();
    return '<h2>' + esc(t('convTitle')) + '</h2>' +
      '<div class="card"><label><span>' + esc(t('rateLabel')) + '</span>' +
      '<div class="rate-row"><input id="rateInput" type="text" inputmode="decimal" value="' +
      esc(d.settings.rate || '') + '">' +
      '<button id="btnSaveRate" class="btn primary">' + esc(t('rateSave')) + '</button></div></label>' +
      '<p class="warn">' + esc(t('rateNote')) + '</p></div>' +
      '<div class="card"><h3>' + esc(t('usdToBdt')) + '</h3>' +
      '<label><span>' + esc(t('amountLabel')) + ' ($)</span>' +
      '<input id="cvUsd" type="text" inputmode="decimal" placeholder="100"></label>' +
      '<div class="conv-result" id="cvUsdOut">—</div></div>' +
      '<div class="card"><h3>' + esc(t('bdtToUsd')) + '</h3>' +
      '<label><span>' + esc(t('amountLabel')) + ' (৳)</span>' +
      '<input id="cvBdt" type="text" inputmode="decimal" placeholder="12200"></label>' +
      '<div class="conv-result" id="cvBdtOut">—</div></div>';
  }

  // ================= CLIENTS =================
  function renderClients() {
    var d = store.get();
    var ec = editingClientId ?
      d.clients.filter(function (c) { return c.id === editingClientId; })[0] : null;
    var form =
      '<div class="card"><h3>' + esc(t('clientsTitle')) + '</h3>' +
      '<div class="grid4">' +
      '<label><span>' + esc(t('cName')) + '</span><input id="cName" type="text" maxlength="120" value="' +
      esc(ec ? ec.name : '') + '"></label>' +
      '<label><span>' + esc(t('cCompany')) + '</span><input id="cCompany" type="text" maxlength="120" value="' +
      esc(ec ? ec.company : '') + '"></label>' +
      '<label><span>' + esc(t('cEmail')) + '</span><input id="cEmail" type="email" maxlength="120" value="' +
      esc(ec ? ec.email : '') + '"></label>' +
      '<label><span>' + esc(t('cPhone')) + '</span><input id="cPhone" type="tel" maxlength="40" value="' +
      esc(ec ? ec.phone : '') + '"></label>' +
      '</div><label><span>' + esc(t('cAddress')) + '</span><textarea id="cAddress" rows="2" maxlength="300">' +
      esc(ec ? ec.address : '') + '</textarea></label>' +
      '<label><span>' + esc(t('cNotes')) + '</span><textarea id="cNotes" rows="2" maxlength="500">' +
      esc(ec ? ec.notes : '') + '</textarea></label>' +
      '<div class="btnrow"><button id="btnSaveClient" class="btn primary">' +
      esc(ec ? t('cUpdate') : t('cAdd')) + '</button>' +
      (ec ? '<button id="btnCancelClient" class="btn ghost">' + esc(t('cCancel')) + '</button>' : '') +
      '</div></div>';

    var cards = d.clients.map(function (c) {
      var ct = Calc.clientTotals(c.id, d);
      function pair(b, u) {
        var parts = [];
        if (b) parts.push(money(b, 'BDT'));
        if (u) parts.push(money(u, 'USD'));
        return parts.length ? parts.join(' + ') : '—';
      }
      return '<div class="client-card"><div class="cc-head"><strong>' + esc(c.name) + '</strong>' +
        '<span class="cc-actions"><button class="btn small ghost" data-cedit="' + esc(c.id) + '">' +
        esc(t('cEdit')) + '</button> <button class="btn small danger-ghost" data-cdel="' + esc(c.id) + '">' +
        esc(t('cDelete')) + '</button></span></div>' +
        (c.company ? '<div>' + esc(c.company) + '</div>' : '') +
        '<div class="sub">' + esc([c.email, c.phone].filter(Boolean).join(' · ')) + '</div>' +
        (c.address ? '<div class="sub">' + esc(c.address) + '</div>' : '') +
        '<div class="cc-stats"><span>' + esc(t('colHours')) + ': <b>' + dur(ct.hoursMs) +
        '</b></span><span>' + esc(t('colInvoiced')) + ': <b>' + pair(ct.invoicedBDT, ct.invoicedUSD) +
        '</b></span><span>' + esc(t('colPaid')) + ': <b>' + pair(ct.paidBDT, ct.paidUSD) +
        '</b></span><span>' + esc(t('colOwing')) + ': <b>' + pair(ct.outstandingBDT, ct.outstandingUSD) +
        '</b></span></div></div>';
    }).join('');

    var p = d.profile || {};
    var profile =
      '<div class="card"><h3>' + esc(t('profileTitle')) + '</h3>' +
      '<div class="grid4">' +
      '<label><span>' + esc(t('cName')) + '</span><input id="pfName" type="text" maxlength="120" value="' +
      esc(p.name || '') + '"></label>' +
      '<label><span>' + esc(t('cEmail')) + '</span><input id="pfEmail" type="email" maxlength="120" value="' +
      esc(p.email || '') + '"></label>' +
      '<label><span>' + esc(t('cPhone')) + '</span><input id="pfPhone" type="tel" maxlength="40" value="' +
      esc(p.phone || '') + '"></label>' +
      '</div><label><span>' + esc(t('cAddress')) + '</span><textarea id="pfAddr" rows="2" maxlength="300">' +
      esc(p.address || '') + '</textarea></label>' +
      '<div class="btnrow"><button id="btnSaveProfile" class="btn primary">' + esc(t('saveProfile')) + '</button></div></div>';

    return '<h2>' + esc(t('clientsTitle')) + '</h2>' + profile + form +
      '<div class="client-list">' +
      (cards || '<div class="card"><p class="hint">' + esc(t('noClients')) + '</p></div>') + '</div>';
  }

  // ================= render root =================
  function render() {
    document.documentElement.lang = (lang === 'bn') ? 'bn' : 'en';
    // header
    $('brandTitle').textContent = t('appTitle');
    $('brandSub').textContent = t('appSub');
    $('btnLang').textContent = t('langToggle');
    $('btnExport').textContent = t('export');
    $('btnImport').textContent = t('import');
    $('btnSample').textContent = t('sample');
    $('btnClear').textContent = t('clearAll');
    // tabs
    var tabs = [
      ['dashboard', t('tabDashboard')], ['time', t('tabTime')],
      ['invoices', t('tabInvoices')], ['converter', t('tabConverter')],
      ['clients', t('tabClients')]
    ];
    $('tabs').innerHTML = tabs.map(function (x) {
      return '<button class="tab' + (tab === x[0] ? ' active' : '') + '" data-tab="' +
        x[0] + '">' + esc(x[1]) + '</button>';
    }).join('');
    $('footNote').textContent = t('offlineNote');
    // main
    var html = tab === 'dashboard' ? renderDashboard()
      : tab === 'time' ? renderTime()
      : tab === 'invoices' ? renderInvoices()
      : tab === 'converter' ? renderConverter()
      : renderClients();
    $('main').innerHTML = html;
    bind();
  }

  // ---- live totals refresh for the invoice editor (no full re-render) ----
  function refreshTotals() {
    var box = $('invTotals');
    if (!box || !draft) return;
    var tt = draftTotals();
    var w = (!tt.error && tt.grand > 0) ? Words.amountWords(tt.grand, draft.currency) : null;
    box.innerHTML = totalsHtml(tt, w);
  }

  // ================= events =================
  function bind() {
    // tab switching (event delegation on #tabs is bound once globally)
    if (tab === 'time') bindTime();
    if (tab === 'invoices') bindInvoices();
    if (tab === 'converter') bindConverter();
    if (tab === 'clients') bindClients();
    // delegated row actions
    $('main').querySelectorAll('[data-sdel]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm(t('confirmDel'))) return;
        var r = store.deleteSession(b.getAttribute('data-sdel'));
        toast(t(r.ok ? 'deleted' : r.error)); render();
      };
    });
    $('main').querySelectorAll('[data-pdel]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm(t('confirmDel'))) return;
        var r = store.deleteProject(b.getAttribute('data-pdel'));
        toast(t(r.ok ? 'deleted' : r.error)); render();
      };
    });
    $('main').querySelectorAll('[data-pedit]').forEach(function (b) {
      b.onclick = function () { editingProjectId = b.getAttribute('data-pedit'); render(); };
    });
    $('main').querySelectorAll('[data-ptoggle]').forEach(function (b) {
      b.onclick = function () {
        var d = store.get();
        var p = d.projects.filter(function (x) { return x.id === b.getAttribute('data-ptoggle'); })[0];
        if (p) { p.active = !p.active; store.persist(); render(); }
      };
    });
    $('main').querySelectorAll('[data-cedit]').forEach(function (b) {
      b.onclick = function () { editingClientId = b.getAttribute('data-cedit'); tab = 'clients'; render(); scrollTo(0, 0); };
    });
    $('main').querySelectorAll('[data-cdel]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm(t('confirmDel'))) return;
        var r = store.deleteClient(b.getAttribute('data-cdel'));
        toast(t(r.ok ? 'deleted' : r.error)); render();
      };
    });
    $('main').querySelectorAll('[data-invprint]').forEach(function (b) {
      b.onclick = function () {
        var d = store.get();
        var inv = d.invoices.filter(function (x) { return x.id === b.getAttribute('data-invprint'); })[0];
        if (inv) { printableInvoice(inv); window.print(); }
      };
    });
    $('main').querySelectorAll('[data-invpaid]').forEach(function (b) {
      b.onclick = function () {
        var r = store.setInvoiceStatus(b.getAttribute('data-invpaid'), 'paid');
        toast(t(r.ok ? 'statusUpdated' : r.error)); render();
      };
    });
    $('main').querySelectorAll('[data-invunpaid]').forEach(function (b) {
      b.onclick = function () {
        var r = store.setInvoiceStatus(b.getAttribute('data-invunpaid'), 'unpaid');
        toast(t(r.ok ? 'statusUpdated' : r.error)); render();
      };
    });
    $('main').querySelectorAll('[data-invdel]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm(t('confirmDel'))) return;
        var r = store.deleteInvoice(b.getAttribute('data-invdel'));
        toast(t(r.ok ? 'deleted' : r.error)); render();
      };
    });
  }

  function bindTime() {
    var bs = $('btnStartTimer');
    if (bs) bs.onclick = function () {
      var pid = $('timerProject').value;
      if (!pid) { toast(t('timerNeedProject')); return; }
      startTimer(pid, $('timerNote').value.trim());
    };
    var bx = $('btnStopTimer');
    if (bx) bx.onclick = stopTimer;

    var ba = $('btnAddSession');
    if (ba) ba.onclick = function () {
      var pid = $('mProject').value;
      var date = $('mDate').value, s = $('mStart').value, e = $('mEnd').value;
      if (!pid) { toast(t('errNoProject')); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(s) || !/^\d{2}:\d{2}$/.test(e)) {
        toast(t('errDate')); return;
      }
      var start = new Date(date + 'T' + s + ':00').getTime();
      var end = new Date(date + 'T' + e + ':00').getTime();
      var r = store.addSession({ projectId: pid, start: start, end: end, note: $('mNote').value.trim() });
      toast(t(r.ok ? 'sessionAdded' : r.error));
      if (r.ok) render();
    };

    var bp = $('btnAddProject');
    if (bp) bp.onclick = function () {
      var f = {
        clientId: $('pClient').value, name: $('pName').value,
        rate: $('pRate').value, currency: $('pCurrency').value, active: true
      };
      var r = editingProjectId
        ? store.updateProject(editingProjectId, f)
        : store.addProject(f);
      if (r.ok) { editingProjectId = null; toast(t('saved')); render(); }
      else toast(t(r.error));
    };
    var bc = $('btnCancelProject');
    if (bc) bc.onclick = function () { editingProjectId = null; render(); };
  }

  function syncDraftFromEditor() {
    draft.clientId = $('dClient').value;
    draft.currency = $('dCurrency').value;
    draft.no = $('dNo').value;
    draft.issue = $('dIssue').value;
    draft.due = $('dDue').value;
    draft.discountPct = $('dDisc').value;
    draft.taxPct = $('dTax').value;
    draft.notes = $('dNotes').value;
    store.setPrefix($('dPrefix').value);
    var rows = document.querySelectorAll('#itemBody tr');
    rows.forEach(function (tr, i) {
      draft.items[i].desc = tr.querySelector('.it-desc').value;
      draft.items[i].qty = tr.querySelector('.it-qty').value;
      draft.items[i].unit = tr.querySelector('.it-unit').value;
      draft.items[i].price = tr.querySelector('.it-price').value;
    });
    saveDraft();
  }

  function bindInvoices() {
    ['dClient', 'dCurrency', 'dNo', 'dIssue', 'dDue', 'dDisc', 'dTax', 'dNotes', 'dPrefix']
      .forEach(function (id) {
        var el = $(id);
        if (el) el.addEventListener('input', function () { syncDraftFromEditor(); refreshTotals(); });
        if (el) el.addEventListener('change', function () {
          if (id === 'dCurrency' || id === 'dClient') render(); // re-render for currency symbols
        });
      });
    document.querySelectorAll('#itemBody input').forEach(function (el) {
      el.addEventListener('input', function () { syncDraftFromEditor(); refreshTotals(); });
    });
    $('main').querySelectorAll('[data-rmline]').forEach(function (b) {
      b.onclick = function () {
        syncDraftFromEditor();
        draft.items.splice(+b.getAttribute('data-rmline'), 1);
        if (!draft.items.length) draft.items.push(blankLine());
        saveDraft(); render();
      };
    });
    $('btnAddLine').onclick = function () {
      syncDraftFromEditor();
      draft.items.push(blankLine()); saveDraft(); render();
    };
    $('btnFromSessions').onclick = function () {
      syncDraftFromEditor();
      openSessionPicker();
    };
    $('btnSaveInv').onclick = function () {
      syncDraftFromEditor();
      var r = store.createInvoice({
        clientId: draft.clientId, currency: draft.currency, no: draft.no,
        issue: draft.issue, due: draft.due, items: draft.items.map(function (it) {
          // null priceMinor passes through: store validation rejects it
          // with errItemQtyPrice instead of silently billing ৳0.
          return { desc: it.desc, qty: it.qty, unit: it.unit, priceMinor: Calc.parseMinor(it.price) };
        }),
        discountPct: draft.discountPct, taxPct: draft.taxPct,
        notes: draft.notes, sessionIds: draft.sessionIds
      });
      if (r.ok) {
        toast(t('invoiceSaved'));
        draft = newDraft(); saveDraft(); render();
      } else toast(t(r.error));
    };
    $('btnPrintInv').onclick = function () {
      syncDraftFromEditor();
      var items = draft.items.map(function (it) {
        return { desc: it.desc, qty: it.qty, unit: it.unit || 'item', priceMinor: Calc.parseMinor(it.price) };
      });
      // validate like a save, but without saving
      var fake = {
        clientId: draft.clientId, currency: draft.currency, no: draft.no || store.nextInvoiceNo(),
        issue: draft.issue, due: draft.due, items: items,
        discountPct: draft.discountPct, taxPct: draft.taxPct,
        notes: draft.notes, status: 'unpaid'
      };
      var tt = Calc.invoiceTotals(items.map(function (it) {
        return { qty: it.qty, priceMinor: it.priceMinor };
      }), Number(draft.discountPct) || 0, Number(draft.taxPct) || 0);
      if (!draft.clientId || !items.length || tt.error || tt.grand <= 0 ||
          !items.every(function (it) { return it.desc.trim(); })) {
        toast(t(!draft.clientId ? 'errNoClient' : 'errNoItems'));
        return;
      }
      printableInvoice(fake);
      window.print();
    };
  }

  function openSessionPicker() {
    var d = store.get();
    var list = store.unbilledSessions(draft.clientId, draft.currency);
    var c = d.clients.filter(function (x) { return x.id === draft.clientId; })[0];
    var body;
    if (!draft.clientId) body = '<p class="hint">' + esc(t('errNoClient')) + '</p>';
    else if (!list.length) body = '<p class="hint">' + esc(t('noUnbilled')) + '</p>';
    else body = '<div class="pick-list">' + list.map(function (s) {
      var p = d.projects.filter(function (x) { return x.id === s.projectId; })[0];
      var ms = s.end - s.start;
      var amt = p ? Calc.billableMinor(ms, p.rateMinor) : 0;
      var dt = new Date(s.start);
      var ds = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' +
        String(dt.getDate()).padStart(2, '0');
      return '<label class="pick-row"><input type="checkbox" data-pick="' + esc(s.id) + '" checked> ' +
        '<span><strong>' + esc(p ? p.name : '?') + '</strong> — ' + esc(ds) +
        ' · ' + dur(ms) + ' · ' + (p ? money(amt, p.currency) : '') +
        (s.note ? '<div class="sub">' + esc(s.note) + '</div>' : '') + '</span></label>';
    }).join('') + '</div>';
    $('modalTitle').textContent = t('pickSessionsTitle') + (c ? ' — ' + c.name : '');
    $('modalBody').innerHTML = body;
    $('modalFoot').innerHTML =
      '<button id="btnPickAdd" class="btn primary">' + esc(t('useSelected')) + '</button> ' +
      '<button id="btnPickCancel" class="btn ghost">' + esc(t('cancel')) + '</button>';
    $('modal').classList.add('open');
    $('btnPickCancel').onclick = closeModal;
    $('modal').onclick = function (e) { if (e.target === $('modal')) closeModal(); };
    var add = $('btnPickAdd');
    if (add) add.onclick = function () {
      var checked = Array.prototype.slice.call(
        document.querySelectorAll('[data-pick]:checked')).map(function (x) {
          return x.getAttribute('data-pick');
        });
      checked.forEach(function (sid) {
        var s = d.sessions.filter(function (x) { return x.id === sid; })[0];
        if (!s || draft.sessionIds.indexOf(sid) >= 0) return;
        var p = d.projects.filter(function (x) { return x.id === s.projectId; })[0];
        if (!p) return;
        var ms = s.end - s.start;
        var dt = new Date(s.start);
        var ds = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' +
          String(dt.getDate()).padStart(2, '0');
        draft.items.push({
          desc: p.name + ' — ' + ds + (s.note ? ' (' + s.note + ')' : ''),
          qty: (ms / 3600000).toFixed(2).replace(/\.?0+$/, '') || '0',
          unit: 'hours',
          price: String(p.rateMinor / 100)
        });
        draft.sessionIds.push(sid);
      });
      // drop pristine blank lines so the invoice isn't padded with empties
      draft.items = draft.items.filter(function (it) {
        return it.desc.trim() !== '' || String(it.price).trim() !== '' || it.qty !== '1';
      });
      if (!draft.items.length) draft.items.push(blankLine());
      saveDraft(); closeModal(); render();
    };
  }
  function closeModal() { $('modal').classList.remove('open'); }

  function bindConverter() {
    $('btnSaveRate').onclick = function () {
      var r = store.setRate($('rateInput').value);
      toast(t(r.ok ? 'rateSaved' : r.error));
      if (r.ok) render();
    };
    function conv(inId, outId, dir) {
      var el = $(inId);
      if (!el) return;
      el.addEventListener('input', function () {
        var rate = store.get().settings.rate;
        var m = Calc.parseMinor(el.value);
        var out = $(outId);
        if (m === null) { out.textContent = '—'; return; }
        var r = (dir === 'u2b') ? Calc.usdToBdtMinor(m, rate) : Calc.bdtToUsdMinor(m, rate);
        out.textContent = (r === null) ? '—' : money(r, dir === 'u2b' ? 'BDT' : 'USD');
      });
    }
    conv('cvUsd', 'cvUsdOut', 'u2b');
    conv('cvBdt', 'cvBdtOut', 'b2u');
  }

  function bindClients() {
    $('btnSaveClient').onclick = function () {
      var f = {
        name: $('cName').value, company: $('cCompany').value, email: $('cEmail').value,
        phone: $('cPhone').value, address: $('cAddress').value, notes: $('cNotes').value
      };
      var r = editingClientId ? store.updateClient(editingClientId, f) : store.addClient(f);
      if (r.ok) { editingClientId = null; toast(t('saved')); render(); }
      else toast(t(r.error));
    };
    var bc = $('btnCancelClient');
    if (bc) bc.onclick = function () { editingClientId = null; render(); };
    $('btnSaveProfile').onclick = function () {
      store.setProfile({
        name: $('pfName').value, email: $('pfEmail').value,
        phone: $('pfPhone').value, address: $('pfAddr').value
      });
      toast(t('saved'));
    };
  }

  // ================= global chrome =================
  function setLang(l) {
    lang = (l === 'bn') ? 'bn' : 'en';
    store.setLang(lang);
    render();
  }

  function init() {
    loadTimer();
    loadDraft();
    if (!loadRes.ok) toast('⚠ ' + t('errBadFile'));
    if (!draft || !draft.items) draft = newDraft();

    $('tabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (b) { tab = b.getAttribute('data-tab'); render(); scrollTo(0, 0); }
    });
    $('btnLang').onclick = function () { setLang(lang === 'en' ? 'bn' : 'en'); };
    $('btnExport').onclick = function () {
      var blob = new Blob([store.exportJSON()], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'freelancer-toolkit-backup-' + todayISO() + '.json';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      toast(t('exported'));
    };
    $('btnImport').onclick = function () { $('fileInput').click(); };
    $('fileInput').addEventListener('change', function () {
      var f = $('fileInput').files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var r = store.importJSON(String(rd.result || ''));
        if (r.ok) {
          lang = store.get().settings.lang || 'en';
          draft = newDraft(); saveDraft();
          toast(t('imported')); render();
        } else toast(t(r.error));
        $('fileInput').value = '';
      };
      rd.readAsText(f);
    });
    $('btnSample').onclick = function () {
      store.loadSample();
      lang = store.get().settings.lang || lang;
      draft = newDraft(); saveDraft();
      toast(t('sampleLoaded')); render();
    };
    $('btnClear').onclick = function () {
      if (!confirm(t('confirmClear'))) return;
      store.clearAll();
      timer = null; saveTimer();
      draft = newDraft(); saveDraft();
      editingClientId = null; editingProjectId = null;
      toast(t('cleared')); render();
    };
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
    });
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
