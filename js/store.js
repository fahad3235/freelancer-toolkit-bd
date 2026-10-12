/* freelancer-toolkit-bd — data layer.
 * Owns the whole data model, validation, and localStorage persistence.
 * Storage is injected ({getItem,setItem,removeItem}) so Node tests can use
 * an in-memory adapter. All money stays integer minor units; time is epoch ms.
 */
(function (root, factory) {
  'use strict';
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.FtbdStore = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LS_KEY = 'ftbd_data_v1';
  var SCHEMA = 1;

  function memAdapter() {
    var m = {};
    return {
      getItem: function (k) { return (k in m) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; }
    };
  }

  function blankData() {
    return {
      version: SCHEMA,
      profile: { name: '', email: '', phone: '', address: '' },
      clients: [],
      projects: [],
      sessions: [],
      invoices: [],
      settings: { lang: 'en', rate: '122', invPrefix: 'FT-', invCounter: 1 }
    };
  }

  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function isId(x) { return typeof x === 'string' && x.length > 0 && x.length < 120; }
  function isMinor(x) { return Number.isInteger(x) && x >= 0 && x <= 9999999999; }
  function isMs(x) { return Number.isInteger(x) && x > 0 && x < 4102444800000; }
  function isCur(x) { return x === 'BDT' || x === 'USD'; }
  function cleanStr(x, max) {
    var s = String(x === null || x === undefined ? '' : x);
    if (s.length > max) s = s.slice(0, max);
    return s;
  }

  // ---- import validation: true only when the payload is a sane v1 export ----
  function validClient(c) {
    return isObj(c) && isId(c.id) && typeof c.name === 'string' && c.name.trim().length > 0;
  }
  function validProject(p) {
    return isObj(p) && isId(p.id) && isId(p.clientId) &&
      typeof p.name === 'string' && p.name.trim().length > 0 &&
      isMinor(p.rateMinor) && p.rateMinor > 0 && isCur(p.currency);
  }
  function validSession(s) {
    return isObj(s) && isId(s.id) && isId(s.projectId) && isMs(s.start) &&
      (s.end === null || (isMs(s.end) && s.end > s.start));
  }
  function validItem(it) {
    return isObj(it) && typeof it.desc === 'string' &&
      typeof it.qty === 'string' && isMinor(it.priceMinor);
  }
  function validInvoice(inv) {
    return isObj(inv) && isId(inv.id) && isId(inv.clientId) && isCur(inv.currency) &&
      typeof inv.no === 'string' && Array.isArray(inv.items) &&
      inv.items.every(validItem) &&
      (inv.status === 'paid' || inv.status === 'unpaid') &&
      typeof inv.issue === 'string' && typeof inv.due === 'string';
  }
  function validData(d) {
    if (!isObj(d)) return false;
    if (!Array.isArray(d.clients) || !d.clients.every(validClient)) return false;
    if (!Array.isArray(d.projects) || !d.projects.every(validProject)) return false;
    if (!Array.isArray(d.sessions) || !d.sessions.every(validSession)) return false;
    if (!Array.isArray(d.invoices) || !d.invoices.every(validInvoice)) return false;
    if (!isObj(d.profile) || !isObj(d.settings)) return false;
    // cross-references must resolve
    var cids = {}, pids = {};
    d.clients.forEach(function (c) { cids[c.id] = 1; });
    d.projects.forEach(function (p) { pids[p.id] = 1; });
    for (var i = 0; i < d.projects.length; i++) if (!cids[d.projects[i].clientId]) return false;
    for (var j = 0; j < d.sessions.length; j++) if (!pids[d.sessions[j].projectId]) return false;
    for (var k = 0; k < d.invoices.length; k++) if (!cids[d.invoices[k].clientId]) return false;
    return true;
  }

  function createStore(storage, Calc) {
    storage = storage || memAdapter();
    var data = blankData();

    function persist() {
      try { storage.setItem(LS_KEY, JSON.stringify(data)); }
      catch (e) { /* quota/full: keep in-memory copy */ }
    }
    function load() {
      var raw = null;
      try { raw = storage.getItem(LS_KEY); } catch (e) { raw = null; }
      if (!raw) { data = blankData(); return { ok: true, fresh: true }; }
      try {
        var d = JSON.parse(raw);
        if (!validData(d)) return { ok: false, error: 'bad-data' };
        data = d;
        if (!data.settings) data.settings = blankData().settings;
        return { ok: true, fresh: false };
      } catch (e) { return { ok: false, error: 'bad-data' }; }
    }

    function get() { return data; }
    function find(arr, id) {
      for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
      return null;
    }

    // ---------- clients ----------
    function addClient(f) {
      var name = cleanStr(f.name, 120).trim();
      if (!name) return { ok: false, error: 'errClientName' };
      var c = {
        id: Calc.uid('c'), name: name,
        company: cleanStr(f.company, 120).trim(),
        email: cleanStr(f.email, 120).trim(),
        phone: cleanStr(f.phone, 40).trim(),
        address: cleanStr(f.address, 300).trim(),
        notes: cleanStr(f.notes, 500).trim(),
        createdAt: Date.now()
      };
      data.clients.push(c); persist();
      return { ok: true, client: c };
    }
    function updateClient(id, f) {
      var c = find(data.clients, id);
      if (!c) return { ok: false, error: 'errNotFound' };
      var name = cleanStr(f.name, 120).trim();
      if (!name) return { ok: false, error: 'errClientName' };
      c.name = name;
      c.company = cleanStr(f.company, 120).trim();
      c.email = cleanStr(f.email, 120).trim();
      c.phone = cleanStr(f.phone, 40).trim();
      c.address = cleanStr(f.address, 300).trim();
      c.notes = cleanStr(f.notes, 500).trim();
      persist();
      return { ok: true, client: c };
    }
    function deleteClient(id) {
      if (data.projects.some(function (p) { return p.clientId === id; }) ||
          data.invoices.some(function (i) { return i.clientId === id; }))
        return { ok: false, error: 'errClientInUse' };
      var n = data.clients.length;
      data.clients = data.clients.filter(function (c) { return c.id !== id; });
      if (data.clients.length === n) return { ok: false, error: 'errNotFound' };
      persist();
      return { ok: true };
    }

    // ---------- projects ----------
    function addProject(f) {
      var name = cleanStr(f.name, 120).trim();
      if (!name) return { ok: false, error: 'errProjectName' };
      if (!find(data.clients, f.clientId)) return { ok: false, error: 'errNoClient' };
      var rate = Calc.parseMinor(f.rate);
      if (rate === null || rate <= 0) return { ok: false, error: 'errRate' };
      var cur = f.currency === 'USD' ? 'USD' : 'BDT';
      var p = {
        id: Calc.uid('p'), clientId: f.clientId, name: name,
        rateMinor: rate, currency: cur, active: f.active !== false,
        createdAt: Date.now()
      };
      data.projects.push(p); persist();
      return { ok: true, project: p };
    }
    function updateProject(id, f) {
      var p = find(data.projects, id);
      if (!p) return { ok: false, error: 'errNotFound' };
      var name = cleanStr(f.name, 120).trim();
      if (!name) return { ok: false, error: 'errProjectName' };
      var rate = Calc.parseMinor(f.rate);
      if (rate === null || rate <= 0) return { ok: false, error: 'errRate' };
      p.name = name;
      p.rateMinor = rate;
      p.currency = f.currency === 'USD' ? 'USD' : 'BDT';
      p.active = f.active !== false;
      persist();
      return { ok: true, project: p };
    }
    function deleteProject(id) {
      if (data.sessions.some(function (s) { return s.projectId === id; }))
        return { ok: false, error: 'errProjectInUse' };
      var n = data.projects.length;
      data.projects = data.projects.filter(function (p) { return p.id !== id; });
      if (data.projects.length === n) return { ok: false, error: 'errNotFound' };
      persist();
      return { ok: true };
    }

    // ---------- sessions ----------
    function addSession(f) { // manual entry: {projectId, start, end, note}
      var p = find(data.projects, f.projectId);
      if (!p) return { ok: false, error: 'errNoProject' };
      var start = Math.round(Number(f.start)), end = Math.round(Number(f.end));
      if (!isMs(start) || !isMs(end) || end <= start)
        return { ok: false, error: 'errSessionTime' };
      if (end - start > 24 * 3600000) return { ok: false, error: 'errSessionTooLong' };
      var s = {
        id: Calc.uid('s'), projectId: f.projectId,
        start: start, end: end,
        note: cleanStr(f.note, 300).trim(),
        manual: true, billed: false, invoiceId: null
      };
      data.sessions.push(s); persist();
      return { ok: true, session: s };
    }
    // live timer: caller keeps {sessionId, projectId, start} in LS separately
    function finishSession(f) { // {projectId, start, end, note}
      var r = addSession({
        projectId: f.projectId, start: f.start, end: f.end,
        note: f.note || ''
      });
      if (r.ok) r.session.manual = false;
      return r;
    }
    function deleteSession(id) {
      var s = find(data.sessions, id);
      if (!s) return { ok: false, error: 'errNotFound' };
      if (s.invoiceId) return { ok: false, error: 'errSessionBilled' };
      data.sessions = data.sessions.filter(function (x) { return x.id !== id; });
      persist();
      return { ok: true };
    }
    function unbilledSessions(clientId, currency) {
      return data.sessions.filter(function (s) {
        if (s.invoiceId) return false;
        var p = find(data.projects, s.projectId);
        return p && p.clientId === clientId && p.currency === currency && s.end;
      });
    }

    // ---------- invoices ----------
    function nextInvoiceNo() {
      var n = data.settings.invCounter || 1;
      return (data.settings.invPrefix || 'FT-') +
        String(n).padStart(4, '0');
    }
    function bumpCounter() { data.settings.invCounter = (data.settings.invCounter || 1) + 1; }

    function validateInvoiceForm(f) {
      if (!find(data.clients, f.clientId)) return 'errNoClient';
      var cur = f.currency === 'USD' ? 'USD' : 'BDT';
      var items = f.items || [];
      if (!items.length) return 'errNoItems';
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!String(it.desc || '').trim()) return 'errItemDesc';
        if (Calc.lineTotal(it.qty, it.priceMinor) === null) return 'errItemQtyPrice';
      }
      if (Calc.parsePct(f.discountPct) === null) return 'errPct';
      if (Calc.parsePct(f.taxPct) === null) return 'errPct';
      var t = Calc.invoiceTotals(items.map(function (it) {
        return { qty: it.qty, priceMinor: it.priceMinor };
      }), Number(f.discountPct) || 0, Number(f.taxPct) || 0);
      if (t.error || t.grand <= 0) return 'errTotalZero';
      if (t.grand > 9999999999) return 'errTotalCap';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.issue || '')) return 'errDate';
      if (f.due && !/^\d{4}-\d{2}-\d{2}$/.test(f.due)) return 'errDate';
      return null;
    }

    function createInvoice(f) {
      var err = validateInvoiceForm(f);
      if (err) return { ok: false, error: err };
      var cur = f.currency === 'USD' ? 'USD' : 'BDT';
      var inv = {
        id: Calc.uid('i'),
        no: cleanStr(f.no, 24).trim() || nextInvoiceNo(),
        clientId: f.clientId, currency: cur,
        issue: f.issue, due: f.due || '',
        status: 'unpaid',
        items: (f.items || []).map(function (it) {
          return {
            desc: cleanStr(it.desc, 200).trim(),
            qty: String(it.qty).trim(),
            unit: cleanStr(it.unit, 20).trim() || 'item',
            priceMinor: it.priceMinor
          };
        }),
        discountPct: String(Number(f.discountPct) || 0),
        taxPct: String(Number(f.taxPct) || 0),
        notes: cleanStr(f.notes, 600).trim(),
        sessionIds: (f.sessionIds || []).slice(),
        createdAt: Date.now()
      };
      // mark sessions billed
      inv.sessionIds.forEach(function (sid) {
        var s = find(data.sessions, sid);
        if (s) { s.invoiceId = inv.id; s.billed = true; }
      });
      data.invoices.push(inv);
      bumpCounter();
      persist();
      return { ok: true, invoice: inv };
    }
    function setInvoiceStatus(id, status) {
      var inv = find(data.invoices, id);
      if (!inv) return { ok: false, error: 'errNotFound' };
      inv.status = status === 'paid' ? 'paid' : 'unpaid';
      persist();
      return { ok: true, invoice: inv };
    }
    function deleteInvoice(id) {
      var inv = find(data.invoices, id);
      if (!inv) return { ok: false, error: 'errNotFound' };
      // unmark sessions
      (inv.sessionIds || []).forEach(function (sid) {
        var s = find(data.sessions, sid);
        if (s) { s.invoiceId = null; s.billed = false; }
      });
      data.invoices = data.invoices.filter(function (x) { return x.id !== id; });
      persist();
      return { ok: true };
    }

    // ---------- settings / profile ----------
    function setLang(l) {
      data.settings.lang = (l === 'bn') ? 'bn' : 'en';
      persist();
    }
    function setRate(str) {
      var r = Number(String(str).trim());
      if (!isFinite(r) || r <= 0 || r > 100000) return { ok: false, error: 'errRateNum' };
      data.settings.rate = String(r);
      persist();
      return { ok: true, rate: String(r) };
    }
    function setPrefix(p) {
      data.settings.invPrefix = cleanStr(p, 10) || 'FT-';
      persist();
    }
    function setProfile(f) {
      data.profile.name = cleanStr(f.name, 120).trim();
      data.profile.email = cleanStr(f.email, 120).trim();
      data.profile.phone = cleanStr(f.phone, 40).trim();
      data.profile.address = cleanStr(f.address, 300).trim();
      persist();
    }

    // ---------- export / import ----------
    function exportJSON() {
      return JSON.stringify(data, null, 2);
    }
    function importJSON(text) {
      var d;
      try { d = JSON.parse(text); }
      catch (e) { return { ok: false, error: 'errBadFile' }; }
      if (!validData(d)) return { ok: false, error: 'errBadFile' };
      data = d;
      if (!data.settings) data.settings = blankData().settings;
      persist();
      return { ok: true };
    }
    function clearAll() {
      data = blankData();
      persist();
    }
    function loadSample() {
      data = blankData();
      var now = Date.now(), day = 86400000;
      var c1 = addClient({ name: 'Rahim Uddin', company: 'Dhaka Soft Ltd', email: 'rahim@dhakasoft.example', phone: '01711-000000', address: 'Banani, Dhaka', notes: '' }).client;
      var c2 = addClient({ name: 'Sarah Chen', company: 'PixelWorks', email: 'sarah@pixelworks.example', phone: '+1-555-0100', address: 'Remote (USA)', notes: '' }).client;
      var p1 = addProject({ clientId: c1.id, name: 'Website redesign', rate: '1500', currency: 'BDT' }).project;
      var p2 = addProject({ clientId: c2.id, name: 'Mobile app UI', rate: '25', currency: 'USD' }).project;
      addSession({ projectId: p1.id, start: now - 3 * day, end: now - 3 * day + 2.5 * 3600000, note: 'Homepage mockup' });
      addSession({ projectId: p2.id, start: now - 2 * day, end: now - 2 * day + 4 * 3600000, note: 'Onboarding screens' });
      addSession({ projectId: p2.id, start: now - 1 * day, end: now - 1 * day + 1.5 * 3600000, note: 'Icon set' });
      persist();
      return { ok: true };
    }

    return {
      LS_KEY: LS_KEY,
      load: load, get: get, persist: persist,
      addClient: addClient, updateClient: updateClient, deleteClient: deleteClient,
      addProject: addProject, updateProject: updateProject, deleteProject: deleteProject,
      addSession: addSession, finishSession: finishSession, deleteSession: deleteSession,
      unbilledSessions: unbilledSessions,
      nextInvoiceNo: nextInvoiceNo,
      createInvoice: createInvoice, setInvoiceStatus: setInvoiceStatus,
      deleteInvoice: deleteInvoice,
      setLang: setLang, setRate: setRate, setPrefix: setPrefix, setProfile: setProfile,
      exportJSON: exportJSON, importJSON: importJSON, clearAll: clearAll,
      loadSample: loadSample, validData: validData, blankData: blankData
    };
  }

  return { createStore: createStore, memAdapter: memAdapter, blankData: blankData, validData: validData, LS_KEY: LS_KEY };
});
