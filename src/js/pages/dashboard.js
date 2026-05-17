/**
 * Dashboard page renderer + navigation controller.
 */

import { PAGES, PAGE_TITLES, MONTHS } from '../utils/constants.js';
import { fmtCur, esc } from '../utils/helpers.js';
import { _cachedEntries, _totalCount, getAllEntries } from '../api/db.js';
import { pinUnlocked } from '../auth/pin.js';
import { closeSidebar } from '../components/sidebar.js';

export let currentPage = 'dashboard';

// ── Navigate ──────────────────────────────────────────────────────
export function navigate(page, filter = '') {
  document.querySelectorAll('.page-content').forEach(el => el.classList.add('hidden'));
  document.getElementById(PAGES[page]).classList.remove('hidden');

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');

  document.getElementById('mob-page-title').textContent = PAGE_TITLES[page] || page;
  currentPage = page;
  closeSidebar();

  // Lazy-import page renderers to avoid circular deps at module load time
  import('./receipts.js').then(({ renderReceiptsNow, _renderReceiptsNow }) => {
    import('./reports.js').then(({ renderReports }) => {
      import('./ledger.js').then(({ renderLedger }) => {
        import('./settings.js').then(({ renderSettingsPage }) => {
          import('./create.js').then(({ resetForm, editingId }) => {
            if      (page === 'dashboard') renderDashboard();
            else if (page === 'receipts')  renderReceiptsNow(filter);
            else if (page === 'create' && !editingId) resetForm();
            else if (page === 'reports')   renderReports();
            else if (page === 'ledger')    renderLedger();
            else if (page === 'settings')  renderSettingsPage();
          });
        });
      });
    });
  });
}

// Re-render whichever page is active
export async function renderCurrent() {
  const { renderDashboard }    = await import('./dashboard.js');
  const { _renderReceiptsNow } = await import('./receipts.js');
  const { _updateExportPreviewNow } = await import('./reports.js');
  const { renderLedger }       = await import('./ledger.js');

  if      (currentPage === 'dashboard') renderDashboard();
  else if (currentPage === 'receipts')  _renderReceiptsNow();
  else if (currentPage === 'reports')   _updateExportPreviewNow();
  else if (currentPage === 'ledger')    renderLedger();
}

// ── Dashboard render ──────────────────────────────────────────────
export function renderDashboard() {
  const m  = parseInt(document.getElementById('d-month').value, 10);
  const y  = parseInt(document.getElementById('d-year').value, 10);
  const monthly = getAllEntries({ month: m, year: y });

  // Pending balance = all unpaid TBB across ALL time (single pass)
  let pendBal = 0;
  for (let i = 0, len = _cachedEntries.length; i < len; i++) {
    const e = _cachedEntries[i];
    if (!e.mrNo || !String(e.mrNo).trim()) pendBal += parseFloat(e.tbb) || 0;
  }

  // Monthly income = Σ TBB − Σ LorryHire (single pass)
  let income = 0;
  for (let i = 0, len = monthly.length; i < len; i++) {
    const e = monthly[i];
    income += (parseFloat(e.tbb) || 0) - (parseFloat(e.lorryHire) || 0);
  }

  // Batch all stat-card writes in one rAF → single style recalc
  requestAnimationFrame(() => {
    document.getElementById('s-total').textContent   = _totalCount;
    document.getElementById('s-monthly').textContent = monthly.length;
    document.getElementById('s-income').innerHTML    = fmtCur(income, true, pinUnlocked);
    document.getElementById('s-pending').innerHTML   = fmtCur(pendBal, true, pinUnlocked);
    document.getElementById('dash-period').textContent = `${MONTHS[m]} ${y}`;
  });

  // Recent 10 entries table — build string first, set innerHTML once
  const recent = _cachedEntries.slice(0, 10);
  const tbody  = document.getElementById('dash-tbody');
  if (!recent.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="padding:2rem;text-align:center;color:var(--slate-400);font-size:.8rem">No entries yet. Create your first LR!</td></tr>';
    return;
  }
  const rows = [];
  for (let i = 0; i < recent.length; i++) {
    const e    = recent[i];
    const paid = e.mrNo && String(e.mrNo).trim();
    rows.push(`<tr>
      <td class="cn-cell">${esc(e.cnNo)}</td>
      <td>${esc(e.cnDate || '')}</td>
      <td title="${esc(e.consignor)}">${esc((e.consignor||'').slice(0,20))}${(e.consignor||'').length>20?'…':''}</td>
      <td title="${esc(e.consignee)}">${esc((e.consignee||'').slice(0,20))}${(e.consignee||'').length>20?'…':''}</td>
      <td style="font-family:monospace;font-size:.72rem">${esc(e.truckNo||'—')}</td>
      <td>${fmtCur(e.tbb, true, pinUnlocked)}</td>
      <td><span class="badge ${paid?'b-paid':'b-pending'}">${paid?'Paid':'Pending'}</span></td>
    </tr>`);
  }
  tbody.innerHTML = rows.join('');
}

// ── Quick-navigate helpers (from stat cards) ──────────────────────
export function navigateMonthly() {
  const m = document.getElementById('d-month').value;
  const y = document.getElementById('d-year').value;
  document.getElementById('r-month').value  = m;
  document.getElementById('r-year').value   = y;
  document.getElementById('r-status').value = '';
  document.getElementById('r-search').value = '';
  navigate('receipts');
}

export function navigatePending() {
  const m = document.getElementById('d-month').value;
  const y = document.getElementById('d-year').value;
  document.getElementById('r-month').value  = m;
  document.getElementById('r-year').value   = y;
  document.getElementById('r-status').value = 'pending';
  document.getElementById('r-search').value = '';
  navigate('receipts', 'pending');
}
