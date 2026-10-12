/* freelancer-toolkit-bd — Node unit tests for calc.js, words.js, store.js.
 * Every expectation below was hand-computed. Run: node tests/test-unit.cjs
 */
'use strict';
const path = require('path');
const Calc = require(path.join('..', 'js', 'calc.js'));
const Store = require(path.join('..', 'js', 'store.js'));

// words.js attaches to globalThis
global.window = global;
require(path.join('..', 'js', 'words.js'));
const Words = global.FtbdWords;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; }
  else { fail++; console.log('FAIL ' + name + '\n  got:  ' + JSON.stringify(got) + '\n  want: ' + JSON.stringify(want)); }
}

// ---------- parseMinor ----------
eq('parseMinor 1250.50', Calc.parseMinor('1250.50'), 125050);
eq('parseMinor 1,250.50', Calc.parseMinor('1,250.50'), 125050);
eq('parseMinor 0', Calc.parseMinor('0'), 0);
eq('parseMinor empty', Calc.parseMinor(''), null);
eq('parseMinor negative', Calc.parseMinor('-5'), null);
eq('parseMinor abc', Calc.parseMinor('abc'), null);
eq('parseMinor 2.5', Calc.parseMinor('2.5'), 250);

// ---------- billableMinor: 2.5h x $20/hr = $50.00 ----------
eq('billable 2.5h x 2000c', Calc.billableMinor(9000000, 2000), 5000);
eq('billable 1h x 150000p', Calc.billableMinor(3600000, 150000), 150000);
eq('billable 45m x $20', Calc.billableMinor(2700000, 2000), 1500); // 0.75*2000
eq('billable zero ms', Calc.billableMinor(0, 2000), 0);

// ---------- fmtDuration ----------
eq('dur 2h30m', Calc.fmtDuration(9000000), '2h 30m');
eq('dur 45m', Calc.fmtDuration(2700000), '45m');
eq('dur 1h', Calc.fmtDuration(3600000), '1h');
eq('dur 1m', Calc.fmtDuration(60000), '1m');

// ---------- fmtMoney ----------
eq('money BDT lakh', Calc.fmtMoney(1250050, 'BDT'), '৳12,500.50');
eq('money BDT crore', Calc.fmtMoney(1234567890, 'BDT'), '৳1,23,45,678.90');
eq('money USD intl', Calc.fmtMoney(125000, 'USD'), '$1,250.00');
eq('money zero', Calc.fmtMoney(0, 'BDT'), '৳0.00');

// ---------- invoiceTotals: 3x500 + 2x1200, 10% disc, 5% tax ----------
// sub = 390000p; disc = 39000; taxable = 351000; tax = 17550; grand = 368550
const t1 = Calc.invoiceTotals(
  [{ qty: '3', priceMinor: 50000 }, { qty: '2', priceMinor: 120000 }], 10, 5);
eq('inv sub', t1.sub, 390000);
eq('inv disc', t1.disc, 39000);
eq('inv tax', t1.tax, 17550);
eq('inv grand', t1.grand, 368550);
// fractional qty: 2.5h x 2000c = 5000c
const t2 = Calc.invoiceTotals([{ qty: '2.5', priceMinor: 2000 }], 0, 0);
eq('inv fractional qty', t2.grand, 5000);
eq('inv bad qty', Calc.invoiceTotals([{ qty: '0', priceMinor: 2000 }], 0, 0).error, 'line');
eq('lineTotal null price', Calc.lineTotal('2', null), null);
eq('lineTotal undefined price', Calc.lineTotal('2', undefined), null);
eq('inv null price rejected', Calc.invoiceTotals([{ qty: '2', priceMinor: null }], 0, 0).error, 'line');

// ---------- currency conversion ----------
eq('usd->bdt 5000c @122.5', Calc.usdToBdtMinor(5000, '122.5'), 612500);
eq('bdt->usd 612500p @122.5', Calc.bdtToUsdMinor(612500, '122.5'), 5000);
eq('conv bad rate', Calc.usdToBdtMinor(5000, '0'), null);
eq('conv bad rate 2', Calc.bdtToUsdMinor(5000, 'abc'), null);

// ---------- bnDigits ----------
eq('bnDigits', Calc.bnDigits('৳12,500.50'), '৳১২,৫০০.৫০');

// ---------- words ----------
eq('words en 12500', Words.en(1250000), 'Twelve thousand five hundred taka only');
eq('words bn 12500', Words.bn(1250000), 'বারো হাজার পাঁচশত টাকা মাত্র');
eq('words en 3685.50', Words.en(368550), 'Three thousand six hundred eighty-five taka and fifty poisha');
eq('words usd 50', Words.usd(5000), 'Fifty dollars only');
eq('words usd 1.01', Words.usd(101), 'One dollar and one cent');
eq('words usd 1.25m', Words.usd(125000000), 'One million two hundred fifty thousand dollars only');

// ---------- monthly aggregation ----------
// ref 2026-10-12 -> window: 2026-05 .. 2026-10
const invs = [
  { status: 'paid', issue: '2026-10-05', currency: 'BDT', items: [{ qty: '1', priceMinor: 100000 }], discountPct: '0', taxPct: '0' }, // 100000
  { status: 'paid', issue: '2026-09-20', currency: 'USD', items: [{ qty: '2', priceMinor: 2000 }], discountPct: '0', taxPct: '0' },  // 4000c -> 488000p @122
  { status: 'unpaid', issue: '2026-10-06', currency: 'BDT', items: [{ qty: '1', priceMinor: 999999 }], discountPct: '0', taxPct: '0' }, // excluded
  { status: 'paid', issue: '2026-04-10', currency: 'BDT', items: [{ qty: '1', priceMinor: 777777 }], discountPct: '0', taxPct: '0' },  // outside window
];
const agg = Calc.aggregateMonthlyPaid(invs, '122', 6, new Date(2026, 9, 12));
eq('agg keys', agg.map(a => a.key), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
eq('agg sep', agg[4].bdtMinor, 488000);
eq('agg oct', agg[5].bdtMinor, 100000);
eq('agg may', agg[0].bdtMinor, 0);

// ---------- clientTotals ----------
const d2 = Store.blankData();
const S2 = Store.createStore(Store.memAdapter(), Calc);
S2.load();
const cA = S2.addClient({ name: 'Client A' }); eq('addClient ok', cA.ok, true);
const cBad = S2.addClient({ name: '   ' }); eq('addClient empty name', cBad.error, 'errClientName');
const pBDT = S2.addProject({ clientId: cA.client.id, name: 'Web', rate: '1500', currency: 'BDT' });
eq('addProject ok', pBDT.ok, true);
eq('addProject bad rate', S2.addProject({ clientId: cA.client.id, name: 'X', rate: 'abc', currency: 'BDT' }).error, 'errRate');
eq('addProject zero rate', S2.addProject({ clientId: cA.client.id, name: 'X', rate: '0', currency: 'BDT' }).error, 'errRate');
const pUSD = S2.addProject({ clientId: cA.client.id, name: 'App', rate: '20', currency: 'USD' });
const T0 = Date.UTC(2026, 9, 1, 9, 0, 0);
S2.addSession({ projectId: pBDT.project.id, start: T0, end: T0 + 3600000, note: '' });       // 1h x 150000p = 150000
S2.addSession({ projectId: pUSD.project.id, start: T0, end: T0 + 2 * 3600000, note: '' });   // 2h x 2000c = 4000
eq('addSession bad time', S2.addSession({ projectId: pBDT.project.id, start: T0, end: T0 }).error, 'errSessionTime');
const ct = Calc.clientTotals(cA.client.id, S2.get());
eq('ct hoursMs', ct.hoursMs, 3 * 3600000);
eq('ct billableBDT', ct.billableMinorBDT, 150000);
eq('ct billableUSD', ct.billableMinorUSD, 4000);
eq('ct unbilledBDT', ct.unbilledMinorBDT, 150000);

// invoice from scratch: 1h web @1500 -> 150000p, mark paid
const inv = S2.createInvoice({
  clientId: cA.client.id, currency: 'BDT', no: 'FT-0001',
  issue: '2026-10-10', due: '', items: [{ desc: 'Web work', qty: '1', unit: 'hours', priceMinor: 150000 }],
  discountPct: '0', taxPct: '0', notes: '', sessionIds: []
});
eq('createInvoice ok', inv.ok, true);
eq('nextNo bumped', S2.nextInvoiceNo(), 'FT-0002');
S2.setInvoiceStatus(inv.invoice.id, 'paid');
const ct2 = Calc.clientTotals(cA.client.id, S2.get());
eq('ct2 invoicedBDT', ct2.invoicedBDT, 150000);
eq('ct2 paidBDT', ct2.paidBDT, 150000);
eq('ct2 outstandingBDT', ct2.outstandingBDT, 0);

// delete guards
eq('delClient in use', S2.deleteClient(cA.client.id).error, 'errClientInUse');
eq('delProject in use', S2.deleteProject(pBDT.project.id).error, 'errProjectInUse');

// invoice from sessions marks them billed
const sUnb = S2.unbilledSessions(cA.client.id, 'BDT');
eq('unbilled count', sUnb.length, 1);
const inv2 = S2.createInvoice({
  clientId: cA.client.id, currency: 'BDT', no: 'FT-0002',
  issue: '2026-10-11', due: '', items: [{ desc: 'Web — 2026-10-01', qty: '1', unit: 'hours', priceMinor: 150000 }],
  discountPct: '10', taxPct: '5', notes: '', sessionIds: [sUnb[0].id]
});
eq('createInvoice2 ok', inv2.ok, true);
// grand: 150000 - 15000 = 135000; tax 6750 -> 141750
const t3 = Calc.invoiceTotals([{ qty: '1', priceMinor: 150000 }], 10, 5);
eq('inv2 grand', t3.grand, 141750);
eq('session billed', S2.get().sessions.find(s => s.id === sUnb[0].id).invoiceId, inv2.invoice.id);
eq('unbilled after', S2.unbilledSessions(cA.client.id, 'BDT').length, 0);
eq('del billed session', S2.deleteSession(sUnb[0].id).error, 'errSessionBilled');
S2.deleteInvoice(inv2.invoice.id);
eq('session unbilled after inv del', S2.get().sessions.find(s => s.id === sUnb[0].id).invoiceId, null);

// invoice validation
eq('inv no client', S2.createInvoice({
  clientId: 'nope', currency: 'BDT', no: 'X', issue: '2026-10-10', due: '',
  items: [{ desc: 'a', qty: '1', unit: 'x', priceMinor: 100 }], discountPct: '0', taxPct: '0', notes: '', sessionIds: []
}).error, 'errNoClient');
eq('inv no items', S2.createInvoice({
  clientId: cA.client.id, currency: 'BDT', no: 'X', issue: '2026-10-10', due: '',
  items: [], discountPct: '0', taxPct: '0', notes: '', sessionIds: []
}).error, 'errNoItems');
eq('inv bad pct', S2.createInvoice({
  clientId: cA.client.id, currency: 'BDT', no: 'X', issue: '2026-10-10', due: '',
  items: [{ desc: 'a', qty: '1', unit: 'x', priceMinor: 100 }], discountPct: '101', taxPct: '0', notes: '', sessionIds: []
}).error, 'errPct');

// export / import round-trip
const json = S2.exportJSON();
const S3 = Store.createStore(Store.memAdapter(), Calc);
eq('import roundtrip', S3.importJSON(json).ok, true);
eq('import clients', S3.get().clients.length, S2.get().clients.length);
eq('import invoices', S3.get().invoices.length, S2.get().invoices.length);
eq('import garbage', S3.importJSON('not json').ok, false);
eq('import wrong shape', S3.importJSON('{"a":1}').ok, false);
eq('import bad money', S3.importJSON(JSON.stringify({
  version: 1, profile: {}, settings: {}, clients: [{ id: 'c1', name: 'X' }],
  projects: [{ id: 'p1', clientId: 'c1', name: 'Y', rateMinor: -5, currency: 'BDT' }],
  sessions: [], invoices: []
})).ok, false);

// settings
eq('setRate ok', S2.setRate('122.5').ok, true);
eq('setRate bad', S2.setRate('0').error, 'errRateNum');
eq('setLang', (S2.setLang('bn'), S2.get().settings.lang), 'bn');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
