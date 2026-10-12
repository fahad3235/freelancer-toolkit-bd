# Freelancer Toolkit BD — ফ্রিল্যান্সার টুলকিট বিডি

A free, fully offline toolkit for Bangladeshi freelancers: track billable time
per client/project, generate print-ready invoices, convert USD ⇄ BDT at your own
rate, and watch income on a dashboard — in English or বাংলা. Your data never
leaves your browser.

## Problem

Bangladeshi freelancers juggle clients across time zones, bill in both BDT and
USD, and need professional invoices to get paid on time. Existing tools are
paid, require accounts, upload business data to someone else's server, or show
"live" exchange rates the freelancer can't verify. This toolkit keeps
everything local: time tracking, invoicing with exact money math, a manual
exchange rate you control, and an income dashboard — no account, no server,
no network requests at all.

## Features

- **Time Tracker** — clients + projects with per-project hourly rate (BDT/৳ or
  USD/$); live start/stop timer with manual-entry fallback; session log with
  billable amounts; unbilled-work totals. The timer only ticks while the tab is
  open (disclosed in the UI; closing the tab pauses the count).
- **Invoice Generator** — build invoices from tracked sessions (each session
  becomes a line item) or manual line items; BDT/USD currency toggle; discount
  % and tax/VAT %; auto-incrementing numbers with editable prefix (FT-0001…);
  paid/unpaid status; print-ready A4 layout (print CSS → PDF); amount in words
  in English and Bangla (lakh/crore for ৳, million-grouping for $).
- **USD ⇄ BDT Converter** — editable exchange rate that *you* enter, clearly
  labeled as a manual rate (no fake live feed); instant conversion both ways.
- **Income Dashboard** — SVG bar chart of paid income for the last 6 months,
  per-client breakdown (hours, invoiced, paid, owing, unbilled), paid vs
  outstanding totals; mixed currencies normalized to ৳ at your manual rate.
- **Client List** — full CRUD (name, company, email, phone, address, notes)
  with per-client totals; your profile (name/phone/address) prints on invoices.
- JSON export / import of **all** data, localStorage persistence, sample data,
  clear-all with confirmation.
- Full EN ⇄ বাংলা UI toggle with Bengali digits; responsive mobile layout
  (≤640px); zero network requests; no secrets, no tracking.

## Stack

Vanilla HTML / CSS / JS. No build step, no dependencies, no backend, no
CDN fonts or libraries — zero network requests by design.

- `index.html` — single-page shell (5 tabs), print area, import file input
- `css/style.css` — screen theme + ≤640px mobile + dedicated A4 print CSS
- `js/calc.js` — pure money/time math (integer minor units; Node-testable)
- `js/store.js` — data model, validation, localStorage, export/import
- `js/words.js` — amount-in-words (EN/BN lakh-crore for BDT, EN for USD)
- `js/i18n.js` — EN/বাংলা UI strings
- `js/app.js` — UI wiring
- `tests/test-unit.cjs` — Node unit tests

## Prerequisites

Any modern browser (Chrome, Edge, Firefox, Safari). Nothing to install.
For running the tests: Node.js 18+.

## Install

No install step — it's a static site. Open `index.html` in a browser, or serve
the folder with any static server:

```bash
cd freelancer-toolkit-bd
python3 -m http.server 8080
# open http://localhost:8080
```

## Dev commands

```bash
node tests/test-unit.cjs   # 79 unit tests (calc, words, store) — hand-verified
node --check js/app.js      # syntax check each module
```

There is no build, bundle, or watch step.

## Env

None. The app reads no environment variables, stores no secrets, and makes no
network requests. All data lives in the browser's `localStorage`
(`ftbd_data_v1`); the running timer and invoice draft use their own keys.

## Testing

**Node unit tests — 79/79 green** (`node tests/test-unit.cjs`), every
expectation hand-computed:

- Session math: 2.5h × $20/hr = $50.00 exactly; duration formatting
- Billable totals per project rate; integer-poisha invoice math —
  3×৳500 + 2×৳1,200 with 10% discount + 5% VAT → subtotal ৳3,900.00,
  discount ৳390.00, VAT ৳175.50, grand **৳3,685.50**
- Currency conversion both directions at a manual rate
  ($100 × 122.5 = ৳12,250.00; ৳12,250 ÷ 122.5 = $100.00); invalid rates → null
- Dashboard monthly aggregation (paid-only, USD→BDT normalized, 6-month window)
- Per-client rollups (hours, billable, invoiced, paid, outstanding, unbilled)
- Amount-in-words EN/BN (12,500 / 3,685.50 / $50 / $1.01 / $1.25M)
- Store CRUD + validation (bad rates, bad times, delete guards, invoice
  validation, export/import round-trip, garbage rejection)

**Headless-Chromium UI tests — 40/40 green** via a dependency-free CDP
harness (`/tmp/ftbd-qa.mjs`, kept outside the repo) against the persistent QA
Chrome over `file://` (this VM's Chrome blocks CDP navigation to
`http://127.0.0.1`, so the harness creates a blank target then
`Page.navigate`s to the file URL):

Client add + empty-name rejection; project add + bad-rate rejection; live
timer start → ticks on screen → stop logs a session with real duration; manual
session entry; timer tab-open disclosure visible; invoice built from an
unbilled session (2.5h × ৳1,500 = ৳3,750.00, −10%, +5% → **৳3,543.75** with
the exact English words line); invoice save → FT-0001 in history; session
marked billed; print view renders (invoice no, total, words, client, profile);
mark-paid → dashboard shows ৳3,543.75 paid, 6-bar SVG chart, per-client row;
converter rate save + both directions (৳12,250.00 / $100.00) + manual-rate
warning visible; EN→BN toggle with Bengali digits (৩,৫৪৩.৭৫) and back;
export → clear → import round-trip restores everything; reload persistence;
390px mobile on all 5 tabs with no horizontal overflow; **zero network
requests; zero console/page errors.**

## Deployment

GitHub Pages compatible: static files, relative paths, no server needed.
Enable Pages on `main` / root. (Not published by the factory run — staged
only, awaiting the user's deploy decision.)

## Limitations

- **Not accounting software**: no tax filing, no ledger, no payroll. Discount
  is applied before tax (documented in-app behavior); rates and invoice wording
  are your responsibility — this is not tax advice.
- The live timer only ticks while the tab is open; it is not a background
  service. Closing the tab pauses the count (the app adjusts the start time on
  return). For precise records, use manual entry.
- The USD ⇄ BDT rate is **manual** — you type it in; there is no live feed and
  the app never fetches rates. Dashboard BDT normalization uses that rate.
- Data lives in the browser's localStorage (per device/browser); JSON export
  is the backup path. Clearing browser data without an export loses everything.
- Amounts above ৳9,99,99,999 / $99,999,999.99 are rejected by the words module
  — split into multiple invoices.
- PDF fidelity depends on the browser's print engine.

## Status

Built 2026-10-12 (MUSE PROJECT FACTORY Ω, mega batch run #45). 79/79 Node unit
tests + 40/40 headless-Chrome UI checks green, zero console errors, zero
network requests, secrets scan clean. Staged only — not published.
