/**
 * Reports & P&L page — Chart.js bar/line chart + filtered Excel export.
 */

import { MONTHS_SHORT } from '../utils/constants.js';
import { fmtCur, toast, buildExportFilename } from '../utils/helpers.js';
import { _cachedEntries, getAllEntries } from '../api/db.js';
import { doExcelExport, _ensureXLSX } from './receipts.js';
import { debounce } from '../utils/helpers.js';

let plChart       = null;
let _chartJsLoaded = false;

function _ensureChartJs() {
  if (_chartJsLoaded || typeof Chart !== 'undefined') { _chartJsLoaded = true; return Promise.resolve(); }
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    s.onload = () => { _chartJsLoaded = true; res(); };
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

export function renderReports() {
  // Defer chart rendering to idle time — doesn't block the page paint
  const renderChart = () => {
    _ensureChartJs().then(() => updatePLChart(parseInt(document.getElementById('chart-year').value, 10)));
  };
  if ('requestIdleCallback' in window) {
    requestIdleCallback(renderChart, { timeout: 1000 });
  } else {
    setTimeout(renderChart, 0);
  }
  _updateExportPreviewNow();
}

export function updatePLChart(year) {
  const canvas = document.getElementById('pl-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  const byMonth = {};
  _cachedEntries.forEach(e => {
    if (!e.cnDate || new Date(e.cnDate).getFullYear() !== year) return;
    const mo = new Date(e.cnDate).getMonth();
    if (!byMonth[mo]) byMonth[mo] = { income: 0, expense: 0 };
    byMonth[mo].income  += parseFloat(e.tbb)       || 0;
    byMonth[mo].expense += parseFloat(e.lorryHire) || 0;
  });
  const data = MONTHS_SHORT.map((_, i) => byMonth[i] || { income: 0, expense: 0 });

  if (plChart) plChart.destroy();
  plChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: MONTHS_SHORT,
      datasets: [
        { label: 'Income (TBB)',         data: data.map(d => d.income),            backgroundColor: 'rgba(22,163,74,.75)',  borderRadius: 4, order: 1 },
        { label: 'Lorry Hire (Expense)', data: data.map(d => d.expense),           backgroundColor: 'rgba(220,38,38,.65)', borderRadius: 4, order: 1 },
        { label: 'Net Profit',           data: data.map(d => d.income - d.expense),
          type: 'line', borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,.1)',
          borderWidth: 2, pointRadius: 4, fill: true, tension: .3, order: 0 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
      plugins: {
        legend: { position: 'top', labels: { font: { size: 11 }, padding: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ₹${ctx.parsed.y.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` } },
      },
      scales: {
        y: { grid: { color: 'rgba(0,0,0,.05)' }, ticks: { callback: v => '₹' + Math.abs(v).toLocaleString('en-IN', { notation: 'compact' }), font: { size: 10 } } },
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
      },
    },
  });
}

export function _updateExportPreviewNow() {
  const company = (document.getElementById('ex-company').value || '').trim();
  const month   = document.getElementById('ex-month').value;
  const year    = document.getElementById('ex-year').value;
  const status  = document.getElementById('ex-status').value;
  const rows = getAllEntries({
    company: company || null,
    month:   month !== '' ? parseInt(month) : null,
    year:    year || null,
    status:  status || null,
  });
  document.getElementById('ex-preview').textContent = `Matching entries: ${rows.length}`;

  let income = 0, expense = 0, pendBal = 0;
  rows.forEach(e => {
    income  += parseFloat(e.tbb)       || 0;
    expense += parseFloat(e.lorryHire) || 0;
    if (!e.mrNo || !String(e.mrNo).trim()) pendBal += parseFloat(e.balance) || 0;
  });
  const rs = document.getElementById('report-stats');
  if (rows.length > 0) {
    rs.style.display = 'grid';
    rs.innerHTML = `
      <div class="stat-card"><div class="stat-label">Entries Found</div><div class="stat-val" style="color:var(--blue)">${rows.length}</div></div>
      <div class="stat-card"><div class="stat-label">Total TBB (Income)</div><div class="stat-val" style="color:var(--green);font-size:1.2rem">${fmtCur(income)}</div></div>
      <div class="stat-card"><div class="stat-label">Total Lorry Hire</div><div class="stat-val" style="color:var(--red);font-size:1.2rem">${fmtCur(expense)}</div></div>
      <div class="stat-card"><div class="stat-label">Net Profit</div><div class="stat-val" style="color:${income - expense >= 0 ? 'var(--green)' : 'var(--red)'};font-size:1.2rem">${fmtCur(income - expense)}</div></div>`;
  } else {
    rs.style.display = 'none';
  }
}

export const updateExportPreview = debounce(_updateExportPreviewNow, 150);

export function clearExportFilters() {
  document.getElementById('ex-company').value = '';
  document.getElementById('ex-month').value   = '';
  document.getElementById('ex-year').value    = new Date().getFullYear();
  document.getElementById('ex-status').value  = '';
  _updateExportPreviewNow();
}

export async function exportFiltered() {
  const company = (document.getElementById('ex-company').value || '').trim();
  const month   = document.getElementById('ex-month').value;
  const year    = document.getElementById('ex-year').value;
  const status  = document.getElementById('ex-status').value;
  const rows = getAllEntries({ company: company || null, month: month !== '' ? parseInt(month) : null, year: year || null, status: status || null });
  if (!rows.length) { toast('No data to export', 'info'); return; }
  await _ensureXLSX();
  doExcelExport(rows, buildExportFilename(company, month, year, status));
  toast(`Exported ${rows.length} entries`, 'ok');
}
