/**
 * ledger-pdf.js — 100% pixel-perfect replica of screenshot sample.
 *
 * HEADER (all centred):
 *   VIDARBHA ROAD CARRIERS          bold ~12pt
 *   45B,PHASE-VTH, OPP ...          normal ~8pt
 *   IDA ,JEEDIMETLA HYDERABAD       normal ~8pt
 *   E-Mail : ...@gmail.com          normal ~8pt (underlined)
 *   All INDIAFAST CARRIERS          bold ~10pt
 *   Ledger Account                  normal ~9pt
 *   KRISHNA KUNJ GARDENDS           normal ~9pt
 *   [blank line]
 *   1-Apr-26 to 2-Apr-26            normal ~8.5pt centre
 *
 * TABLE COLUMNS (exact from screenshot):
 *   Date | Particulars | Vch Type | Vch No. | Debit | Credit
 *   (Debit BEFORE Credit — confirmed from screenshot)
 *
 *   "Page 1" sits TOP-RIGHT, just above the column-header row
 *
 * ROWS:
 *   1-Apr-26 | To  Opening Balance  |   |   | 26,000.00 |
 *   (blank)  | By  Closing Balance  |   |   |           | 26,000.00
 *   ─ total ─|                      |   |   | 26,000.00 | 26,000.00
 *
 * Numbers: Indian comma format, 2 d.p., NO currency symbol, right-aligned.
 * "To" / "By" are part of the Particulars cell, inline with the name.
 */

import {
  fromInt, fmtBalance,
  calcRunningBalance, getCompanyEntries, getCompanyMeta,
} from './ledger-store.js';

// ── "1-Apr-26" — no leading zero on day, 2-digit year ────────────
function _d(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const M = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${+d}-${M[+m]}-${String(y).slice(-2)}`;
}

// ── "26,000.00" — Indian commas, 2dp, no ₹ ───────────────────────
function _n(v) {
  if (!v) return '';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits : 2,
    maximumFractionDigits : 2,
  }).format(Math.abs(v) / 100);
}

// ── Safe HTML attribute / content encoding ────────────────────────
function _e(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────
export function buildLedgerHTML(companyName, { dateFrom, dateTo } = {}) {

  /* ── Data ─────────────────────────────────────────────────── */
  const meta    = getCompanyMeta(companyName) || {};
  const opening = meta.openingBalance || 0;
  const entries = getCompanyEntries(companyName, { dateFrom, dateTo });
  const rows    = calcRunningBalance(companyName, entries, opening);
  const closing = rows.length ? rows[rows.length - 1].runningBalance : opening;

  /* ── Company settings ─────────────────────────────────────── */
  const co1   = (localStorage.getItem('aifc_company')  || 'ALL INDIA FAST CARRIERS').toUpperCase();
  const co2   = (localStorage.getItem('aifc_company2') || '').toUpperCase();
  const addr1 =  localStorage.getItem('aifc_addr1')    || localStorage.getItem('aifc_address') || '';
  const addr2 =  localStorage.getItem('aifc_addr2')    || '';
  const email =  localStorage.getItem('aifc_email')    || '';

  /* ── Period string ────────────────────────────────────────── */
  const period = dateFrom && dateTo ? `${_d(dateFrom)} to ${_d(dateTo)}`
               : dateFrom           ? `From ${_d(dateFrom)}`
               : dateTo             ? `Up to ${_d(dateTo)}`
               : 'All Time';

  /* ── Accounting amounts ───────────────────────────────────── */
  // Opening balance → Debit column  (To Opening Balance)
  const openDr = opening > 0 ?  opening : 0;
  const openCr = opening < 0 ? -opening : 0;
  // Closing balance → Credit column (By Closing Balance)
  const closDr = closing > 0 ?  closing : 0;
  const closCr = closing < 0 ? -closing : 0;

  let txDr = 0, txCr = 0;
  rows.forEach(r => { txDr += r.debit; txCr += r.credit; });

  const grandTotal = Math.max(
    txDr + openDr + closCr,
    txCr + openCr + closDr
  );

  /* ── Transaction rows ─────────────────────────────────────── */
  const txHtml = rows.map(r => {
    // "By Bank/Cash" or "To Bank/Cash" matching the screenshot style
    const prefix = r.side === 'credit' ? 'By' : 'To';
    const label  = r.remarks || (r.side === 'credit' ? 'Bank/Cash Account' : 'Bank/Cash Account');
    return `<tr>
        <td class="c-date">${_d(r.date)}</td>
        <td class="c-part"><span class="pfx">${prefix}</span> ${_e(label)}</td>
        <td class="c-vt">${_e(r.type)}</td>
        <td class="c-vn">${_e(r.vchNo)}</td>
        <td class="c-num">${r.side === 'debit'  ? _n(r.debit)  : ''}</td>
        <td class="c-num">${r.side === 'credit' ? _n(r.credit) : ''}</td>
      </tr>`;
  }).join('');

  const noTx = rows.length === 0
    ? `<tr><td colspan="6" class="c-empty">No transactions in this period.</td></tr>`
    : '';

  /* ── Safe inline JS strings ───────────────────────────────── */
  const jsName    = JSON.stringify(companyName);
  const jsCo1     = JSON.stringify(co1);
  const jsPeriod  = JSON.stringify(period);
  const jsBalance = JSON.stringify(fmtBalance(closing));

  /* ── Full HTML ────────────────────────────────────────────── */
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ledger Account</title>
<style>
/* ────────────────────────────────────────────────────────────
   RESET
──────────────────────────────────────────────────────────── */
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 10pt;
  color: #000;
  background: #fff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* ────────────────────────────────────────────────────────────
   TOOLBAR  (hidden when printing)
──────────────────────────────────────────────────────────── */
.toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  background: #efefef;
  border-bottom: 1px solid #ccc;
}
.toolbar label { font-size: 11px; font-weight: 700; color: #444; margin-right: 2px; }
.tbtn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 13px;
  font-size: 11px; font-weight: 700;
  border: none; border-radius: 3px; cursor: pointer;
}
.tbtn:hover    { opacity: .85; }
.tbtn:disabled { opacity: .5; cursor: wait; }
.t-pr { background: #1a4fba; color: #fff; }
.t-dl { background: #c0392b; color: #fff; }
.t-wa { background: #25d366; color: #fff; display: none; }

/* ────────────────────────────────────────────────────────────
   PAGE WRAPPER
   Fixed 715px ≈ A4 content width at screen resolution.
   Centred with auto margins.
──────────────────────────────────────────────────────────── */
.page {
  width: 715px;
  margin: 10px auto;
  padding: 0;
  background: #fff;
}

/* ────────────────────────────────────────────────────────────
   HEADER  — every line is centre-aligned (matches screenshot)

   Line 1:  VIDARBHA ROAD CARRIERS              bold 12pt
   Line 2:  45B,PHASE-VTH, OPP ...              normal 8pt
   Line 3:  IDA ,JEEDIMETLA HYDERABAD            normal 8pt
   Line 4:  E-Mail : ...@gmail.com               normal 8pt, link underline
   Line 5:  All INDIAFAST CARRIERS               bold 10pt
   Line 6:  Ledger Account                       normal 9pt
   Line 7:  KRISHNA KUNJ GARDENDS (party name)   normal 9pt
   Line 8:  (blank gap ~6px)
   Line 9:  1-Apr-26 to 2-Apr-26                 normal 8.5pt
──────────────────────────────────────────────────────────── */
.hdr { text-align: center; line-height: 1; margin-bottom: 0; }

.h1 {  /* VIDARBHA ROAD CARRIERS */
  font-size: 12pt;
  font-weight: bold;
  line-height: 1.6;
}
.h2 {  /* address lines + email */
  font-size: 8pt;
  line-height: 1.5;
}
.h2 a { color: #000; text-decoration: underline; }
.h3 {  /* All INDIAFAST CARRIERS */
  font-size: 10pt;
  font-weight: bold;
  line-height: 1.7;
}
.h4 {  /* Ledger Account */
  font-size: 9pt;
  font-weight: normal;
  line-height: 1.5;
}
.h5 {  /* party name */
  font-size: 9pt;
  font-weight: normal;
  line-height: 1.5;
  margin-bottom: 6px;   /* gap before period line */
}
.h-period {
  font-size: 8.5pt;
  text-align: center;
  margin-bottom: 2px;
}

/* ────────────────────────────────────────────────────────────
   PAGE-NUMBER  line
   "Page 1" sits flush-right, on its OWN line, just above the
   column-header row  (exactly as in screenshot).
──────────────────────────────────────────────────────────── */
.pgno-row {
  text-align: right;
  font-size: 8pt;
  padding-right: 2px;
  margin-bottom: 0;
  line-height: 1.4;
}

/* ────────────────────────────────────────────────────────────
   TABLE
   Columns: Date | Particulars | Vch Type | Vch No. | Debit | Credit
   (Debit comes BEFORE Credit — confirmed from screenshot)
──────────────────────────────────────────────────────────── */
table.led {
  width: 100%;
  border-collapse: collapse;
  font-size: 8.5pt;
  table-layout: fixed;
}

/* Column widths — tuned to match screenshot proportions */
col.co-date { width: 52px;  }
col.co-part { width: auto;  }   /* flex: takes remaining space */
col.co-vt   { width: 70px;  }
col.co-vn   { width: 56px;  }
col.co-deb  { width: 82px;  }
col.co-crd  { width: 82px;  }

/* ── Header row ── */
table.led thead tr {
  border-top:    1px solid #000;
  border-bottom: 1px solid #000;
}
table.led thead th {
  padding: 2px 4px 2px 4px;
  font-size: 8.5pt;
  font-weight: bold;
  white-space: nowrap;
  overflow: hidden;
}
.th-l { text-align: left;   }
.th-c { text-align: center; }
.th-r { text-align: right;  }

/* ── Body rows ── */
table.led tbody tr {
  border-bottom: 1px solid #ddd;
}
table.led tbody td {
  padding: 2px 4px;
  font-size: 8.5pt;
  vertical-align: middle;
  overflow: hidden;
}

/* ── Cell classes ── */
.c-date { text-align: left;  white-space: nowrap; }
.c-part { text-align: left;  }
.c-vt   { text-align: center; white-space: nowrap; font-size: 8pt; color: #222; }
.c-vn   { text-align: center; white-space: nowrap; font-size: 8pt; color: #222; }
.c-num  {
  text-align: right;
  white-space: nowrap;
  font-family: Arial, Helvetica, sans-serif;   /* matches screenshot (not courier) */
  font-size: 8.5pt;
}
.c-empty { text-align: center; padding: 6px; color: #555; font-style: italic; }

/* "To" / "By" prefix — slightly bold to match screenshot */
.pfx { font-weight: bold; margin-right: 2px; }

/* Opening & closing rows — Particulars bold ("Opening Balance" / "Closing Balance") */
.row-ob .c-part b,
.row-cb .c-part b { font-weight: bold; }

/* ── Total / grand row — only a top border line, no bottom ── */
table.led tfoot tr {
  border-top: 1px solid #000;
}
table.led tfoot td {
  padding: 2px 4px;
  font-size: 8.5pt;
  font-family: Arial, Helvetica, sans-serif;
  font-weight: normal;
  text-align: right;
  white-space: nowrap;
}
table.led tfoot td.fe { text-align: left; }

/* ────────────────────────────────────────────────────────────
   PRINT
──────────────────────────────────────────────────────────── */
@media print {
  .toolbar     { display: none !important; }
  html, body   { margin: 0; padding: 0; background: #fff; }
  .page        { width: 100%; margin: 0; }
  body         { font-size: 8.5pt; }
  @page        { size: A4 portrait; margin: 14mm 12mm 14mm 12mm; }
  table.led tbody tr { page-break-inside: avoid; }
  table.led thead    { display: table-header-group; }
}
</style>
</head>
<body>

<!-- Toolbar (hidden on print) -->
<div class="toolbar">
  <label>Export:</label>
  <button class="tbtn t-pr" onclick="window.print()">&#x1F5A8; Print</button>
  <button class="tbtn t-dl" id="b-pdf" onclick="doPDF()">&#x2B07; Download PDF</button>
  <button class="tbtn t-wa" id="b-wa"  onclick="doShare()">&#x1F4F2; Share via WhatsApp</button>
</div>

<!-- Page -->
<div class="page">

  <!--
    ══════════════════════════════════════
    HEADER — every line centre-aligned
    ══════════════════════════════════════
  -->
  <div class="hdr">

    <!-- Line 1: primary company name -->
    <div class="h1">${_e(co1)}</div>

    <!-- Lines 2-4: address + email -->
    ${addr1 ? `<div class="h2">${_e(addr1)}</div>` : ''}
    ${addr2 ? `<div class="h2">${_e(addr2)}</div>` : ''}
    ${email  ? `<div class="h2">E-Mail : <a href="mailto:${_e(email)}">${_e(email)}</a></div>` : ''}

    <!-- Line 5: secondary company name (All INDIAFAST CARRIERS) -->
    ${co2 ? `<div class="h3">${_e(co2)}</div>` : ''}

    <!-- Line 6: "Ledger Account" -->
    <div class="h4">Ledger Account</div>

    <!-- Line 7: party / account name -->
    <div class="h5">${_e(companyName.toUpperCase())}</div>

  </div><!-- /hdr -->

  <!-- Period line (centred, below blank gap) -->
  <div class="h-period">${_e(period)}</div>

  <!--
    "Page 1" line — flush right, on its own line,
    sits directly above the column-header row.
  -->
  <div class="pgno-row">Page 1</div>

  <!--
    ══════════════════════════════════════
    LEDGER TABLE
    Columns: Date | Particulars | Vch Type | Vch No. | Debit | Credit
    ══════════════════════════════════════
  -->
  <table class="led">
    <colgroup>
      <col class="co-date">
      <col class="co-part">
      <col class="co-vt">
      <col class="co-vn">
      <col class="co-deb">
      <col class="co-crd">
    </colgroup>
    <thead>
      <tr>
        <th class="th-l">Date</th>
        <th class="th-l">Particulars</th>
        <th class="th-c">Vch Type</th>
        <th class="th-c">Vch No.</th>
        <th class="th-r">Debit</th>
        <th class="th-r">Credit</th>
      </tr>
    </thead>
    <tbody>

      <!--
        Opening balance row:
        Date=start date | "To  Opening Balance" (bold name) | | | Debit amount |
        Matches: 1-Apr-26 | To  Opening Balance | | | 26,000.00 |
      -->
      <tr class="row-ob">
        <td class="c-date">${dateFrom ? _d(dateFrom) : ''}</td>
        <td class="c-part"><span class="pfx">To</span> <b>Opening Balance</b></td>
        <td class="c-vt"></td>
        <td class="c-vn"></td>
        <td class="c-num">${openDr > 0 ? _n(openDr) : (openCr > 0 ? '' : '')}</td>
        <td class="c-num">${openCr > 0 ? _n(openCr) : ''}</td>
      </tr>

      <!-- Transaction rows -->
      ${txHtml}${noTx}

      <!--
        Closing balance row:
        Date=(blank) | "By  Closing Balance" (bold name) | | | | Credit amount
        Matches: (blank) | By  Closing Balance | | | | 26,000.00
      -->
      <tr class="row-cb">
        <td class="c-date"></td>
        <td class="c-part"><span class="pfx">By</span> <b>Closing Balance</b></td>
        <td class="c-vt"></td>
        <td class="c-vn"></td>
        <td class="c-num">${closCr > 0 ? _n(closCr) : ''}</td>
        <td class="c-num">${closDr > 0 ? _n(closDr) : ''}</td>
      </tr>

    </tbody>

    <!--
      Grand total row — top border only.
      Both Debit and Credit columns show the same figure.
      Matches: | | | | 26,000.00 | 26,000.00
    -->
    <tfoot>
      <tr>
        <td class="fe"></td>
        <td class="fe"></td>
        <td class="fe"></td>
        <td class="fe"></td>
        <td>${grandTotal > 0 ? _n(grandTotal) : ''}</td>
        <td>${grandTotal > 0 ? _n(grandTotal) : ''}</td>
      </tr>
    </tfoot>
  </table>

</div><!-- /page -->

<script>
/* Show WhatsApp button only when native share is available (mobile) */
(function () {
  if (typeof navigator !== 'undefined' && navigator.share) {
    var b = document.getElementById('b-wa');
    if (b) b.style.display = 'inline-flex';
  }
})();

/* ── Download PDF via html2pdf.js (lazy CDN load) ── */
function doPDF() {
  var btn = document.getElementById('b-pdf');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating\u2026'; }

  function run() {
    html2pdf()
      .set({
        margin      : [14, 12, 14, 12],
        filename    : 'Ledger_' + ${jsName}.replace(/[^a-zA-Z0-9]/g, '_') + '.pdf',
        image       : { type: 'jpeg', quality: 0.99 },
        html2canvas : { scale: 3, useCORS: true, letterRendering: true, logging: false },
        jsPDF       : { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak   : { mode: ['avoid-all', 'css', 'legacy'] },
      })
      .from(document.querySelector('.page'))
      .save()
      .then(function () {
        if (btn) { btn.disabled = false; btn.innerHTML = '&#x2B07; Download PDF'; }
      })
      .catch(function () {
        if (btn) { btn.disabled = false; btn.innerHTML = '&#x2B07; Download PDF'; }
        alert('PDF generation failed. Use Print \u2192 Save as PDF instead.');
      });
  }

  if (typeof html2pdf !== 'undefined') { run(); return; }

  var s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
  s.onload  = run;
  s.onerror = function () {
    if (btn) { btn.disabled = false; btn.innerHTML = '&#x2B07; Download PDF'; }
    alert('PDF library unavailable. Use Print \u2192 Save as PDF instead.');
  };
  document.head.appendChild(s);
}

/* ── WhatsApp / native share ── */
function doShare() {
  if (!navigator.share) return;
  navigator.share({
    title : 'Ledger Account \u2014 ' + ${jsName},
    text  : ${jsCo1} +
            '\nParty   : ' + ${jsName} +
            '\nPeriod  : ' + ${jsPeriod} +
            '\nBalance : ' + ${jsBalance},
  }).catch(function () {});
}

/* Auto-print if URL contains ?print=1 */
if (new URLSearchParams(location.search).get('print') === '1') {
  setTimeout(function () { window.print(); }, 700);
}
<\/script>
</body>
</html>`;
}

/* ── Open ledger in a new window ──────────────────────────────── */
export function printLedger(companyName, filters = {}) {
  if (!companyName) {
    import('../utils/helpers.js').then(({ toast }) => toast('No company selected', 'err'));
    return;
  }
  const html = buildLedgerHTML(companyName, filters);
  const w = window.open(
    '', '_blank',
    'width=940,height=820,menubar=yes,toolbar=yes,scrollbars=yes,resizable=yes'
  );
  if (!w) {
    import('../utils/helpers.js').then(({ toast }) =>
      toast('Popup blocked — please allow popups and try again', 'err')
    );
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
