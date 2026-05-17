/**
 * Sidebar open/close + dropdown population + nav wiring.
 */

import { MONTHS } from '../utils/constants.js';
import { debounce } from '../utils/helpers.js';

export function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('mob-overlay').classList.add('open');
}
export function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('mob-overlay').classList.remove('open');
}

/**
 * Populate month/year <select> dropdowns used by Dashboard, Receipts, Reports.
 * (Smart Ledger uses its own date pickers — no selects needed.)
 */
export function setupDropdowns() {
  const now  = new Date();
  const curY = now.getFullYear();

  // Month selectors — only LR/Dashboard/Reports ones remain
  ['d-month', 'r-month', 'ex-month'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const hasAll = id !== 'd-month';
    if (hasAll) el.innerHTML = '<option value="">All Months</option>';
    MONTHS.forEach((m, i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = m;
      el.appendChild(o);
    });
    if (!hasAll) el.value = now.getMonth();
  });

  // Year selectors
  ['d-year', 'r-year', 'chart-year', 'ex-year'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    for (let y = curY + 1; y >= curY - 5; y--) {
      const o = document.createElement('option');
      o.value = o.textContent = y;
      el.appendChild(o);
    }
    el.value = curY;
  });

  // Reset receipts month to "All"
  const rMonth = document.getElementById('r-month');
  if (rMonth) rMonth.value = '';
}

/**
 * Wire change/input listeners onto filter controls.
 * renderLedger is the Smart Ledger renderLedger — no old ld-* selects.
 */
export function wireFilterListeners({ renderDashboard, renderReceipts, updatePLChart, renderLedger }) {
  ['d-month', 'd-year'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', renderDashboard);
  });

  const debouncedReceipts = debounce(renderReceipts, 150);
  ['r-month', 'r-year', 'r-status', 'r-search'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', debouncedReceipts);
  });

  document.getElementById('chart-year')?.addEventListener('change', e =>
    updatePLChart(parseInt(e.target.value, 10))
  );

  // Smart Ledger has its own inline handlers — no wiring needed here
}
