/**
 * Lorry Receipts table renderer + import logic.
 */

import { FM } from '../utils/constants.js';
import { debounce, fmtCur, fmtNum, esc, parseDate, nk, parseCSVLine, toast } from '../utils/helpers.js';
import { _cachedEntries, _totalCount, getAllEntries, insertEntry, deleteEntry } from '../api/db.js';
import { pinUnlocked } from '../auth/pin.js';
import { showAlert } from '../components/modals.js';
import { showImportModal, closeImportModal } from '../components/modals.js';
import { navigate, currentPage, renderDashboard } from './dashboard.js';

let pendingImport = [];

// ── Render ────────────────────────────────────────────────────────
export function _renderReceiptsNow(forceFilter = '') {
  if (forceFilter === 'pending') document.getElementById('r-status').value = 'pending';

  const m      = document.getElementById('r-month').value;
  const y      = document.getElementById('r-year').value;
  const status = document.getElementById('r-status').value;
  const search = document.getElementById('r-search').value;
  const entries = getAllEntries({
    month: m !== '' ? parseInt(m) : null,
    year: y, status, search,
  });
  const tbody = document.getElementById('rec-tbody');

  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="20" style="padding:2rem;text-align:center;color:var(--slate-400);font-size:.8rem">No entries found.</td></tr>';
    document.getElementById('rec-footer').textContent = '0 entries';
    document.getElementById('rec-total-bar').style.display = 'none';
    return;
  }

  let sumTbb = 0, sumLh = 0, sumPending = 0, pendCount = 0;

  // Build HTML string in one pass — then set innerHTML once (single reflow)
  const rows = [];
  for (let i = 0, len = entries.length; i < len; i++) {
    const e    = entries[i];
    const paid = e.mrNo && String(e.mrNo).trim();
    const tbb  = parseFloat(e.tbb) || 0;
    const lh   = parseFloat(e.lorryHire) || 0;

    sumTbb += tbb; sumLh += lh;
    if (!paid) { sumPending += tbb; pendCount++; }

    const tbbSty = (!paid && tbb > 0 && !pinUnlocked) ? '' :
                   (!paid && tbb > 0) ? ' style="color:var(--red);font-weight:600"' : '';
    const psLabel = e.paymentSide === 'consignor' ? 'Consignor' : e.paymentSide === 'consignee' ? 'Consignee' : '—';
    const psCls   = e.paymentSide === 'consignor' ? 'color:var(--blue)' : e.paymentSide === 'consignee' ? 'color:var(--green)' : 'color:var(--slate-400)';
    rows.push(`<tr>
      <td class="cn-cell">${esc(e.cnNo)}</td>
      <td>${esc(e.cnDate||'')}</td>
      <td>${e.weight!=null&&e.weight!==''?fmtNum(e.weight)+' kg':'—'}</td>
      <td>${esc(e.noOfPackages||'—')}</td>
      <td title="${esc(e.consignor)}">${esc((e.consignor||'').slice(0,18))}${(e.consignor||'').length>18?'…':''}</td>
      <td title="${esc(e.consignee)}">${esc((e.consignee||'').slice(0,18))}${(e.consignee||'').length>18?'…':''}</td>
      <td>${esc(e.destination||'—')}</td>
      <td style="font-family:monospace;font-size:.7rem">${esc(e.truckNo||'—')}</td>
      <td>${fmtCur(e.toPay)}</td>
      <td>${fmtCur(e.tbb)}</td>
      <td>${esc(e.challanNo||'—')}</td>
      <td>${esc(e.challanDate||'—')}</td>
      <td>${fmtCur(e.lorryHire)}</td>
      <td>${fmtCur(e.advance)}</td>
      <td${tbbSty}>${fmtCur(e.balance, true, pinUnlocked)}</td>
      <td>${esc(e.billNoDate||'—')}</td>
      <td>${esc(e.mrNo||'—')}</td>
      <td><span style="font-size:.7rem;font-weight:700;${psCls}">${psLabel}</span></td>
      <td><span class="badge ${paid?'b-paid':'b-pending'}">${paid?'Paid':'Pending'}</span></td>
      <td style="white-space:nowrap;text-align:center">
        <button onclick="window.__aifc.openEdit(${JSON.stringify(e.id)})"
          style="background:none;border:none;cursor:pointer;color:var(--blue);padding:.2rem .4rem;border-radius:.3rem" title="Edit">
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
          </svg>
        </button>
        <button onclick="window.__aifc.confirmDel(${JSON.stringify(e.id)},${JSON.stringify(e.cnNo)})"
          style="background:none;border:none;cursor:pointer;color:var(--red);padding:.2rem .4rem;border-radius:.3rem" title="Delete">
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
          </svg>
        </button>
      </td>
    </tr>`);
  }

  // Single DOM write — one reflow
  tbody.innerHTML = rows.join('');

  document.getElementById('rec-footer').textContent = `Showing ${entries.length} of ${_totalCount} entries`;

  const bar = document.getElementById('rec-total-bar');
  bar.style.display = 'flex';
  bar.innerHTML = `
    <span style="font-size:.72rem;color:var(--slate-500)">Totals for ${entries.length} shown entries:</span>
    <span style="font-size:.72rem;font-weight:600;color:var(--green)">TBB: ${fmtCur(sumTbb)}</span>
    <span style="font-size:.72rem;font-weight:600;color:var(--slate-600)">Lorry Hire: ${fmtCur(sumLh)}</span>
    <span style="font-size:.72rem;font-weight:600;color:var(--blue)">Profit: ${fmtCur(sumTbb - sumLh)}</span>
    ${pendCount > 0 ? `<span style="font-size:.72rem;font-weight:700;color:var(--red)">Pending (${pendCount}): ${fmtCur(sumPending)}</span>` : ''}
  `;
}

export const renderReceipts    = debounce(_renderReceiptsNow, 150);
export function renderReceiptsNow(filter) { _renderReceiptsNow(filter); }

// ── Delete confirm — also removes linked ledger entries ───────────
export function confirmDel(id, cn) {
  showAlert('Confirm Delete', `Delete CN No. "${cn}"?\nThis cannot be undone.\n\nLinked ledger entries will also be removed.`, [
    { text: 'Cancel' },
    { text: 'Delete', danger: true, action: async () => {
      // Remove from LR database
      if (await deleteEntry(id)) {
        toast('Deleted', 'ok');
        // Also remove all linked ledger entries for this LR
        try {
          const { removeAllLREntries, loadLedger } = await import('../ledger/ledger-store.js');
          await loadLedger();
          await removeAllLREntries(id);
        } catch (e) { /* non-fatal */ }
        _renderReceiptsNow();
      } else {
        toast('Delete failed', 'err');
      }
    }},
  ]);
}

// ── Import ────────────────────────────────────────────────────────
let _xlsxLoaded = false;
function _ensureXLSX() {
  if (_xlsxLoaded || typeof XLSX !== 'undefined') { _xlsxLoaded = true; return Promise.resolve(); }
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => { _xlsxLoaded = true; res(); };
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

export function initImportListener() {
  document.getElementById('imp-file').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    e.target.value = '';
    await _ensureXLSX();
    try {
      const ab = await file.arrayBuffer();
      let rows;
      if (file.name.toLowerCase().endsWith('.csv')) {
        const txt = new TextDecoder('utf-8').decode(ab);
        rows = txt.split(/\r?\n/).filter(l => l.trim()).map(parseCSVLine);
      } else {
        const wb = XLSX.read(ab, { type: 'array', cellDates: false, raw: false });
        rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
      }
      processImport(rows);
    } catch (err) { toast('Failed to read file: ' + err.message, 'err'); }
  });
}

function processImport(rows) {
  if (!rows || rows.length < 2) { toast('File is empty', 'err'); return; }
  let hIdx = 0, maxMatch = 0;
  rows.slice(0, 8).forEach((row, i) => {
    const m = row.filter(c => FM[nk(String(c || ''))]).length;
    if (m > maxMatch) { maxMatch = m; hIdx = i; }
  });
  if (maxMatch < 2) { toast('Cannot detect column headers', 'err'); return; }

  const headers = rows[hIdx].map(h => String(h || '').trim());
  const errors = [], valid = [];
  const dbCNs   = new Set(_cachedEntries.map(e => String(e.cnNo || '').trim()));
  const fileCNs = new Set();

  for (let i = hIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every(c => !String(c).trim())) continue;
    const entry = {};
    headers.forEach((h, j) => {
      const key = FM[nk(h)];
      if (key) entry[key] = String(row[j] ?? '').trim();
    });
    const rowErr = [];
    ['cnNo','cnDate','consignor','consignee'].forEach(f => { if (!entry[f]) rowErr.push(`missing ${f}`); });
    if (!rowErr.length) {
      const cn = String(entry.cnNo || '').trim();
      if (dbCNs.has(cn))    rowErr.push(`CN No. "${cn}" already in database`);
      else if (fileCNs.has(cn)) rowErr.push(`duplicate CN No. "${cn}" in file`);
    }
    if (rowErr.length) { errors.push(`Row ${i+1}: ${rowErr.join('; ')}`); continue; }

    if (entry.cnDate)     entry.cnDate     = parseDate(entry.cnDate)     || entry.cnDate;
    if (entry.challanDate) entry.challanDate = parseDate(entry.challanDate) || entry.challanDate;
    ['weight','toPay','tbb','lorryHire','advance'].forEach(f => {
      if (entry[f] !== undefined && entry[f] !== '') {
        const n = parseFloat(String(entry[f]).replace(/[₹,\s]/g,''));
        entry[f] = isNaN(n) ? null : n;
      } else entry[f] = null;
    });
    entry.balance = parseFloat(((entry.lorryHire ?? 0) - (entry.advance ?? 0)).toFixed(2));
    ['noOfPackages','destination','truckNo','challanNo','challanDate','billNoDate','mrNo'].forEach(f => {
      if (entry[f] === '' || entry[f] === undefined) entry[f] = null;
    });
    fileCNs.add(String(entry.cnNo).trim());
    valid.push(entry);
  }
  pendingImport = valid;
  showImportModal(valid, errors);
}

export async function confirmImport() {
  if (!pendingImport.length) return;
  const btn = document.getElementById('imp-confirm-btn');
  btn.disabled = true; btn.textContent = 'Importing…';
  let success = 0, failed = 0;
  for (const e of pendingImport) {
    if (await insertEntry(e)) success++; else failed++;
  }
  pendingImport = [];
  closeImportModal();
  toast(`Imported ${success} entries${failed ? `, ${failed} failed` : ''}`, failed ? 'info' : 'ok');
  if (currentPage === 'receipts') renderReceiptsNow();
  else if (currentPage === 'dashboard') renderDashboard();
}

// ── Export all ────────────────────────────────────────────────────
export async function exportAll() {
  if (!_cachedEntries.length) { toast('No data to export', 'info'); return; }
  await _ensureXLSX();
  doExcelExport(_cachedEntries, `AIFC_All_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast(`Exported ${_cachedEntries.length} entries`, 'ok');
}

export function doExcelExport(rows, filename) {
  const headers = ['C.N. NO.','C N DATE','Weight','No of Packages','CONSIGNOR','CONSIGNEE','DESTINATION','TRUCK NO','To Pay','TBB','Challan No','Challan Date','Lorry hire','Advance','Balance','Bill No/Date','M.R.NO.'];
  const data = rows.map(e => [e.cnNo,e.cnDate,e.weight,e.noOfPackages,e.consignor,e.consignee,e.destination,e.truckNo,e.toPay,e.tbb,e.challanNo,e.challanDate,e.lorryHire,e.advance,e.balance,e.billNoDate,e.mrNo]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = [10,12,10,14,22,22,16,13,10,10,13,13,13,12,12,18,13].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Entries');
  XLSX.writeFile(wb, filename);
}

export { _ensureXLSX };
