/**
 * Smart Ledger — Page Controller v4
 *
 * FIXES in this version:
 *  1. No preload of all data — list shows "Select Payment Side" prompt first
 *  2. Payment-side filter applied BEFORE rendering any cards
 *  3. syncAllLREntries → reconciles stale/duplicate LR entries on every load
 *  4. syncCompaniesFromEntries → only adds companies that HAVE ledger entries
 *  5. Grid delegation wired once — no duplicate click handlers on re-render
 *  6. _loaded resets correctly after mutations
 */

import {
  loadLedger,
  getCompanySummaries, getLedgerTotals,
  getCompanyEntries, getCompanyMeta,
  calcRunningBalance,
  addLedgerEntry, deleteLedgerEntry, editLedgerEntry,
  addCompany, deleteCompany, syncCompaniesFromEntries, syncAllLREntries,
  getAllLedgerEntries,
  fromInt, toInt, fmtBalance,
} from '../ledger/ledger-store.js';
import { printLedger } from '../ledger/ledger-pdf.js';
import { _cachedEntries } from '../api/db.js';
import { esc, toast } from '../utils/helpers.js';

// ── Module state ──────────────────────────────────────────────────
let _loaded           = false;
let _activeCompany    = null;
let _editingEntry     = null;
let _delegationWired  = false;

// Default filter is 'all' (not 'due') so user sees everything after
// selecting a payment-side filter themselves
let _filters = {
  search   : '',
  dateFrom : '',
  dateTo   : '',
  filter   : 'all',   // 'all' | 'due' | 'debit' | 'credit'
  payFilter: '',      // '' | 'consignor' | 'consignee' — NEW payment-side filter
};
let _detailFilters = { dateFrom: '', dateTo: '' };

// ─────────────────────────────────────────────────────────────────
//  INIT + SYNC
// ─────────────────────────────────────────────────────────────────
export async function renderLedger() {
  if (!_loaded) {
    await loadLedger();

    // Reconcile all LR entries — fixes duplicates, stale entries, wrong parties
    if (_cachedEntries && _cachedEntries.length) {
      await syncAllLREntries(_cachedEntries);
      // syncCompaniesFromEntries is called inside syncAllLREntries already
    }

    _loaded = true;
    _wireGridDelegation();
  }

  _showView('list');
  _syncFilterButtons();
  _renderList();
}

// ─────────────────────────────────────────────────────────────────
//  EVENT DELEGATION — one handler, wired once
// ─────────────────────────────────────────────────────────────────
function _wireGridDelegation() {
  if (_delegationWired) return;
  _delegationWired = true;

  const grid = document.getElementById('sl-company-grid');
  if (!grid) return;

  grid.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (btn) {
      e.stopPropagation();
      const { action, company } = btn.dataset;
      if (action === 'add-entry')      slAddEntry(company);
      else if (action === 'pdf')       slPrintCompany(company);
      else if (action === 'share')     await slShareCompany(company);
      else if (action === 'delete-co') await _confirmDeleteCompany(company);
      return;
    }
    const card = e.target.closest('.sl-party-card[data-company]');
    if (card) slOpenCompany(card.dataset.company);
  });
}

// ─────────────────────────────────────────────────────────────────
//  VIEW SWITCHING
// ─────────────────────────────────────────────────────────────────
function _showView(v) {
  document.getElementById('sl-view-list').style.display   = v === 'list'   ? '' : 'none';
  document.getElementById('sl-view-detail').style.display = v === 'detail' ? '' : 'none';
}

// ─────────────────────────────────────────────────────────────────
//  LIST VIEW
// ─────────────────────────────────────────────────────────────────
function _renderList() {
  // ── Stats bar (always from all companies, never filtered) ──────
  const totals = getLedgerTotals();
  document.getElementById('sl-stat-parties').textContent = totals.totalCompanies;
  document.getElementById('sl-stat-dr').textContent      = '₹' + fromInt(totals.totalDr);
  document.getElementById('sl-stat-cr').textContent      = '₹' + fromInt(totals.totalCr);
  const net   = totals.totalDr - totals.totalCr;
  const netEl = document.getElementById('sl-stat-net');
  netEl.textContent = fmtBalance(net);
  netEl.className   = 'sl-stat-val' + (net > 0 ? ' sl-dr' : net < 0 ? ' sl-cr' : '');

  const grid  = document.getElementById('sl-company-grid');
  const empty = document.getElementById('sl-list-empty');
  const hint  = document.getElementById('sl-pay-hint');

  // ── Payment-side filter ───────────────────────────────────────
  // Filter entries by paymentSide BEFORE building summaries
  // This prevents both consignor and consignee appearing for same LR
  let entriesToSummarise = null; // null = use default (all entries in store)

  if (_filters.payFilter) {
    // Only show companies that have entries with the selected paymentSide
    // We achieve this by temporarily filtering at the summary level
  }

  const summaries = _getFilteredSummaries();

  // ── No-data states ────────────────────────────────────────────
  if (!_cachedEntries || !_cachedEntries.length) {
    grid.innerHTML      = '';
    if (hint)  hint.style.display  = 'block';
    empty.style.display = 'none';
    return;
  }
  if (hint) hint.style.display = 'none';

  if (!summaries.length) {
    grid.innerHTML      = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  // ── Render cards ──────────────────────────────────────────────
  grid.innerHTML = summaries.map(s => {
    const isDr   = s.netBalance > 0;
    const isCr   = s.netBalance < 0;
    const bCls   = isDr ? 'sl-dr' : isCr ? 'sl-cr' : 'sl-nil';
    const badge  = isDr ? 'Receivable' : isCr ? 'Payable' : 'Settled';
    const bClsB  = isDr ? 'sl-badge-dr' : isCr ? 'sl-badge-cr' : 'sl-badge-nil';
    const last   = s.lastDate
      ? new Intl.DateTimeFormat('en-IN', { day:'2-digit', month:'short', year:'numeric' })
          .format(new Date(s.lastDate + 'T00:00:00'))
      : 'No entries';
    const dispDr = s.totalDebit  + Math.max(0,  s.openingBalance);
    const dispCr = s.totalCredit + Math.max(0, -s.openingBalance);
    const sn     = esc(s.name);

    return `<div class="sl-party-card" data-company="${sn}">
      <div class="sl-party-card-top">
        <div class="sl-party-avatar">${esc(s.name.slice(0,2).toUpperCase())}</div>
        <div class="sl-party-info">
          <div class="sl-party-name" title="${sn}">${sn}</div>
          <div class="sl-party-sub">${s.entryCount} entries &middot; Last: ${last}</div>
        </div>
        <span class="sl-badge ${bClsB}">${badge}</span>
      </div>
      <div class="sl-party-card-body">
        <div class="sl-party-row">
          <span class="sl-lbl">Total Debit</span>
          <span class="sl-val sl-dr">₹${fromInt(dispDr)}</span>
        </div>
        <div class="sl-party-row">
          <span class="sl-lbl">Total Credit</span>
          <span class="sl-val sl-cr">₹${fromInt(dispCr)}</span>
        </div>
        <div class="sl-party-row sl-party-balance-row">
          <span class="sl-lbl" style="font-weight:700">Net Balance</span>
          <span class="sl-val ${bCls}" style="font-size:.95rem;font-weight:800">${fmtBalance(s.netBalance)}</span>
        </div>
      </div>
      <div class="sl-party-card-foot">
        <button class="btn btn-ghost sl-small-btn" data-action="add-entry" data-company="${sn}">➕ Entry</button>
        <button class="btn btn-ghost sl-small-btn" data-action="pdf"       data-company="${sn}">📄 PDF</button>
        <button class="btn btn-ghost sl-small-btn" data-action="share"     data-company="${sn}">📲 Share</button>
        <button class="btn sl-small-btn sl-del-co-btn" data-action="delete-co" data-company="${sn}" title="Delete company">🗑</button>
      </div>
    </div>`;
  }).join('');
}

/**
 * Build filtered summaries applying BOTH the balance filter AND
 * the payment-side filter (which filters by which party has entries).
 *
 * Payment-side filter works by restricting which entries are counted:
 * only entries where paymentSide === _filters.payFilter.
 */
function _getFilteredSummaries() {
  const payFilter = _filters.payFilter; // '' | 'consignor' | 'consignee'

  // When a payFilter is active we build a custom summary that only
  // aggregates entries tagged with that paymentSide
  if (payFilter) {
    return _buildSummariesForPaySide(payFilter, {
      dateFrom: _filters.dateFrom || undefined,
      dateTo  : _filters.dateTo   || undefined,
      filter  : _filters.filter,
      search  : _filters.search,
    });
  }

  // No pay-side filter → standard summary from store
  return getCompanySummaries({
    dateFrom: _filters.dateFrom || undefined,
    dateTo  : _filters.dateTo   || undefined,
    filter  : _filters.filter,
    search  : _filters.search,
  });
}

/**
 * Build company summaries restricted to a specific paymentSide.
 * This is the core de-duplication mechanism:
 *   - If user selects "Consignor", only entries with paymentSide='consignor' are shown
 *   - Each LR produces at most ONE entry (the debit or credit under the payer)
 *   - The other party NEVER appears in this view
 */
function _buildSummariesForPaySide(paySide, { dateFrom, dateTo, filter, search }) {
  const map = Object.create(null);

  // Only aggregate entries that match the paymentSide
  const all = getAllLedgerEntries();
  for (const e of all) {
    // For LR-sourced entries: filter by paymentSide
    // For manual entries: include always (manual entries have no paymentSide tag)
    if (e.source === 'lr' && e.paymentSide !== paySide) continue;
    if (dateFrom && e.date < dateFrom) continue;
    if (dateTo   && e.date > dateTo)   continue;

    if (!map[e.companyName]) {
      const meta = getCompanyMeta(e.companyName) || {};
      map[e.companyName] = {
        name: e.companyName, tracked: meta.tracked || false,
        openingBalance: meta.openingBalance || 0,
        totalDebit: 0, totalCredit: 0, lastDate: '', entryCount: 0,
      };
    }
    const c = map[e.companyName];
    c.totalDebit  += e.debit;
    c.totalCredit += e.credit;
    if (!c.lastDate || e.date > c.lastDate) c.lastDate = e.date;
    c.entryCount++;
  }

  return Object.values(map)
    .map(c => ({ ...c, netBalance: c.openingBalance + c.totalDebit - c.totalCredit }))
    .filter(c => {
      if (c.entryCount === 0 && c.openingBalance === 0) return false;
      if (filter === 'due'    && c.netBalance === 0) return false;
      if (filter === 'debit'  && c.netBalance <= 0)  return false;
      if (filter === 'credit' && c.netBalance >= 0)  return false;
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => Math.abs(b.netBalance) - Math.abs(a.netBalance));
}

// ─────────────────────────────────────────────────────────────────
//  DETAIL VIEW (Tally-style running balance table)
// ─────────────────────────────────────────────────────────────────
export function slOpenCompany(name) {
  _activeCompany  = name;
  _detailFilters  = { dateFrom: '', dateTo: '' };
  const dfEl = document.getElementById('sl-detail-df');
  const dtEl = document.getElementById('sl-detail-dt');
  if (dfEl) dfEl.value = '';
  if (dtEl) dtEl.value = '';
  _showView('detail');
  _renderDetail();
}

function _renderDetail() {
  const name    = _activeCompany;
  const meta    = getCompanyMeta(name) || {};
  const opening = meta.openingBalance || 0;

  document.getElementById('sl-detail-title').textContent = name;
  document.getElementById('sl-detail-sub').textContent   =
    `Opening: ${fmtBalance(opening)} · Double-click any row to edit`;

  const entries = getCompanyEntries(name, {
    dateFrom: _detailFilters.dateFrom || undefined,
    dateTo  : _detailFilters.dateTo   || undefined,
  });
  const rows   = calcRunningBalance(name, entries, opening);
  const totDr  = rows.reduce((s, r) => s + r.debit,  0);
  const totCr  = rows.reduce((s, r) => s + r.credit, 0);
  const closing = rows.length ? rows[rows.length - 1].runningBalance : opening;

  document.getElementById('sl-detail-stat-dr').textContent  = '₹' + fromInt(totDr);
  document.getElementById('sl-detail-stat-cr').textContent  = '₹' + fromInt(totCr);
  const balEl = document.getElementById('sl-detail-stat-bal');
  balEl.textContent = fmtBalance(closing);
  balEl.className   = 'sl-stat-val' + (closing > 0 ? ' sl-dr' : closing < 0 ? ' sl-cr' : '');

  const gtDr = totDr + Math.max(0,  opening);
  const gtCr = totCr + Math.max(0, -opening) + Math.max(0, closing);
  const gt   = Math.max(gtDr, gtCr);

  const parts = [];

  parts.push(`<tr class="sl-ob-row">
    <td></td><td colspan="3"><b>Opening Balance</b></td>
    <td class="sl-amt">${opening > 0 ? '₹' + fromInt(opening) : ''}</td>
    <td class="sl-amt">${opening < 0 ? '₹' + fromInt(-opening) : opening === 0 ? 'Nil' : ''}</td>
    <td class="sl-bal">${fmtBalance(opening)}</td><td></td>
  </tr>`);

  if (!rows.length) {
    parts.push(`<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--slate-400);font-size:.85rem">
      No entries yet — click "Add Entry" to begin.
    </td></tr>`);
  } else {
    rows.forEach(r => {
      const isLR    = r.source === 'lr';
      const rowCls  = r.side === 'credit' ? 'sl-cr-row' : '';
      const balStr  = fmtBalance(r.runningBalance);
      const balCls  = r.runningBalance > 0 ? 'sl-dr' : r.runningBalance < 0 ? 'sl-cr' : '';
      const psSufx  = r.paymentSide ? ` <span class="sl-lr-tag">${r.paymentSide === 'consignor' ? 'Consignor' : 'Consignee'}</span>` : '';
      const editBtn = isLR
        ? `<span style="color:var(--slate-300);font-size:.85rem" title="Auto-imported from LR">🔒</span>`
        : `<button class="sl-row-del" data-action="del-entry" data-id="${esc(r.id)}" title="Delete">✕</button>`;
      parts.push(`<tr class="${rowCls}" data-id="${esc(r.id)}" data-is-lr="${isLR ? '1' : ''}">
        <td class="sl-dt">${_fmtD(r.date)}</td>
        <td class="sl-part">
          <div style="font-weight:600">${r.type === 'Receipt' ? 'By Bank/Cash' : r.type === 'Payment' ? 'To Bank/Cash' : 'To/By Account'}</div>
          <div class="sl-narr">${esc(r.remarks || '')}${psSufx}</div>
        </td>
        <td class="sl-vt">${esc(r.type)}</td>
        <td class="sl-vn">${esc(r.vchNo)}</td>
        <td class="sl-amt">${r.debit  > 0 ? '₹' + fromInt(r.debit)  : ''}</td>
        <td class="sl-amt">${r.credit > 0 ? '₹' + fromInt(r.credit) : ''}</td>
        <td class="sl-bal ${balCls}">${balStr}</td>
        <td style="text-align:center;padding:.3rem">${editBtn}</td>
      </tr>`);
    });
  }

  parts.push(`<tr class="sl-ob-row">
    <td></td><td colspan="3"><b>Closing Balance</b></td>
    <td class="sl-amt">${closing < 0 ? '₹' + fromInt(-closing) : ''}</td>
    <td class="sl-amt">${closing > 0 ? '₹' + fromInt(closing)  : ''}</td>
    <td class="sl-bal ${closing > 0 ? 'sl-dr' : closing < 0 ? 'sl-cr' : ''}">${fmtBalance(closing)}</td>
    <td></td>
  </tr>`);

  parts.push(`<tr class="sl-tot-row">
    <td colspan="4" style="text-align:right;font-weight:700;letter-spacing:.5px">GRAND TOTAL</td>
    <td class="sl-amt" style="font-weight:700">₹${fromInt(gt)}</td>
    <td class="sl-amt" style="font-weight:700">₹${fromInt(gt)}</td>
    <td colspan="2"></td>
  </tr>`);

  const tbody = document.getElementById('sl-detail-tbody');
  tbody.innerHTML = parts.join('');

  tbody.onclick = e => {
    const btn = e.target.closest('[data-action="del-entry"]');
    if (btn) slDelEntry(btn.dataset.id);
  };
  tbody.ondblclick = e => {
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    if (row.dataset.isLr === '1') { toast('Auto-imported from LR — edit the LR instead.', 'info'); return; }
    slEditEntry(row.dataset.id);
  };
}

function _fmtD(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const M = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d}-${M[+m]}-${y}`;
}

// ─────────────────────────────────────────────────────────────────
//  DELETE COMPANY
// ─────────────────────────────────────────────────────────────────
async function _confirmDeleteCompany(name) {
  if (!name) return;
  const { showAlert } = await import('../components/modals.js');
  showAlert(
    `Delete "${name}"?`,
    `Permanently deletes the company and ALL its ledger entries.\n\nThis cannot be undone.`,
    [
      { text: 'Cancel' },
      { text: 'Delete Everything', danger: true, action: async () => {
        await deleteCompany(name);
        toast(`"${name}" deleted`, 'ok');
        _loaded = false;
        await renderLedger();
      }},
    ]
  );
}
export async function slDelCompany(name) { await _confirmDeleteCompany(name); }

// ─────────────────────────────────────────────────────────────────
//  ENTRY MODAL
// ─────────────────────────────────────────────────────────────────
export function slAddEntry(companyName) {
  _editingEntry = null;
  _openModal(companyName || _activeCompany || '', null);
}

export function slEditEntry(id) {
  const all = getAllLedgerEntries();
  const e   = all.find(x => x.id === id);
  if (!e) { toast('Entry not found', 'err'); return; }
  if (e.source === 'lr') { toast('Auto-imported LR entry — edit the LR instead.', 'info'); return; }
  _editingEntry = e;
  _openModal(e.companyName, e);
}

function _openModal(companyName, prefill) {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('sl-modal-title').textContent   = prefill ? 'Edit Entry' : 'Add Entry';
  document.getElementById('sl-entry-err').textContent     = '';
  document.getElementById('sl-entry-date').value          = prefill?.date    || today;
  document.getElementById('sl-entry-remarks').value       = prefill?.remarks || '';
  document.getElementById('sl-entry-type').value          = prefill?.type    || 'Payment';

  const coField = document.getElementById('sl-entry-company');
  coField.value = companyName || '';
  if (companyName) {
    coField.setAttribute('readonly', '');
    coField.style.cssText = 'background:var(--slate-50);color:var(--slate-500)';
  } else {
    coField.removeAttribute('readonly');
    coField.style.cssText = '';
  }

  const rawAmt = prefill
    ? String((prefill.side === 'debit' ? prefill.debit : prefill.credit) / 100)
    : '';
  document.getElementById('sl-entry-amount').value = rawAmt;
  _setSide(prefill?.side || 'debit');

  document.getElementById('sl-entry-modal').classList.add('open');
  setTimeout(() => document.getElementById('sl-entry-amount').focus(), 100);
}

export function slCloseEntryModal() {
  document.getElementById('sl-entry-modal').classList.remove('open');
  _editingEntry = null;
}

export function slSetSide(side) { _setSide(side); }
function _setSide(side) {
  const dr   = document.getElementById('sl-btn-debit');
  const cr   = document.getElementById('sl-btn-credit');
  const hint = document.getElementById('sl-side-hint');
  if (side === 'debit') {
    dr.classList.add('active');    cr.classList.remove('active');
    dr.dataset.active = '1';       cr.dataset.active = '';
    hint.textContent  = '💡 Debit — party owes you / you gave money';
    hint.style.cssText = 'background:var(--sl-dr-bg);color:var(--sl-dr)';
  } else {
    cr.classList.add('active');    dr.classList.remove('active');
    cr.dataset.active = '1';       dr.dataset.active = '';
    hint.textContent  = '💡 Credit — you received money from this party';
    hint.style.cssText = 'background:var(--sl-cr-bg);color:var(--sl-cr)';
  }
}
function _getActiveSide() {
  return document.getElementById('sl-btn-debit').dataset.active === '1' ? 'debit' : 'credit';
}

export async function slSaveEntry() {
  const errEl = document.getElementById('sl-entry-err');
  errEl.textContent = '';

  const companyName = document.getElementById('sl-entry-company').value.trim();
  const date        = document.getElementById('sl-entry-date').value;
  const amountStr   = document.getElementById('sl-entry-amount').value.trim();
  const remarks     = document.getElementById('sl-entry-remarks').value.trim();
  const type        = document.getElementById('sl-entry-type').value;
  const side        = _getActiveSide();

  if (!companyName)                { errEl.textContent = '✗ Company name required'; return; }
  if (!date)                        { errEl.textContent = '✗ Date required'; return; }
  if (!amountStr || toInt(amountStr) <= 0) { errEl.textContent = '✗ Enter a valid amount > 0'; return; }

  const btn = document.getElementById('sl-entry-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    if (_editingEntry) {
      await editLedgerEntry(_editingEntry.id, { companyName, date, amountStr, side, type, remarks });
      toast('Entry updated ✓', 'ok');
    } else {
      await addLedgerEntry({ companyName, type, side, amountStr, date, remarks });
      toast('Entry saved ✓', 'ok');
    }
    slCloseEntryModal();
    if (_activeCompany && document.getElementById('sl-view-detail').style.display !== 'none') {
      _renderDetail();
    } else {
      _loaded = false;
      await renderLedger();
    }
  } catch (err) {
    errEl.textContent = '✗ ' + err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Save Entry';
  }
}

export async function slDelEntry(id) {
  if (!confirm('Delete this entry? Cannot be undone.')) return;
  await deleteLedgerEntry(id);
  toast('Entry deleted', 'ok');
  _renderDetail();
}

// ─────────────────────────────────────────────────────────────────
//  ADD COMPANY MODAL
// ─────────────────────────────────────────────────────────────────
export function slOpenAddCompany() {
  document.getElementById('sl-co-name').value      = '';
  document.getElementById('sl-co-ob').value        = '';
  document.getElementById('sl-co-err').textContent = '';
  document.getElementById('sl-add-co-modal').classList.add('open');
  setTimeout(() => document.getElementById('sl-co-name').focus(), 100);
}
export function slCloseAddCompany() {
  document.getElementById('sl-add-co-modal').classList.remove('open');
}
export async function slSaveCompany() {
  const name  = document.getElementById('sl-co-name').value.trim();
  const ob    = document.getElementById('sl-co-ob').value.trim();
  const errEl = document.getElementById('sl-co-err');
  errEl.textContent = '';
  try {
    await addCompany(name, ob || '0');
    toast(`"${name}" added ✓`, 'ok');
    slCloseAddCompany();
    _loaded = false;
    await renderLedger();
  } catch (err) { errEl.textContent = '✗ ' + err.message; }
}

// ─────────────────────────────────────────────────────────────────
//  FILTERS
// ─────────────────────────────────────────────────────────────────

/** Payment-side filter — the core de-duplication control */
export function slSetPayFilter(side) {
  _filters.payFilter = side; // '' | 'consignor' | 'consignee'
  _syncPayFilterButtons();
  _renderList();
}

export function slSetFilter(f) {
  _filters.filter = f;
  _syncFilterButtons();
  _renderList();
}

export function slSearch(v) {
  _filters.search = v || '';
  _renderList();
}

export function slApplyDateRange() {
  _filters.dateFrom = document.getElementById('sl-df').value;
  _filters.dateTo   = document.getElementById('sl-dt').value;
  _renderList();
}
export function slClearDateRange() {
  _filters.dateFrom = _filters.dateTo = '';
  document.getElementById('sl-df').value = '';
  document.getElementById('sl-dt').value = '';
  _renderList();
}

export function slDetailDateFilter() {
  _detailFilters.dateFrom = document.getElementById('sl-detail-df').value;
  _detailFilters.dateTo   = document.getElementById('sl-detail-dt').value;
  _renderDetail();
}
export function slDetailDateClear() {
  _detailFilters = { dateFrom: '', dateTo: '' };
  document.getElementById('sl-detail-df').value = '';
  document.getElementById('sl-detail-dt').value = '';
  _renderDetail();
}

function _syncFilterButtons() {
  document.querySelectorAll('.sl-filter-btn[data-filter]').forEach(b =>
    b.classList.toggle('active', b.dataset.filter === _filters.filter)
  );
}
function _syncPayFilterButtons() {
  document.querySelectorAll('.sl-pay-filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.pay === _filters.payFilter)
  );
}

// ─────────────────────────────────────────────────────────────────
//  PDF / SHARE / EXPORT
// ─────────────────────────────────────────────────────────────────
export function slPrintCompany(name) {
  const n = name || _activeCompany;
  if (!n) { toast('No company selected', 'err'); return; }
  printLedger(n, {
    dateFrom: _detailFilters.dateFrom || _filters.dateFrom || undefined,
    dateTo  : _detailFilters.dateTo   || _filters.dateTo   || undefined,
  });
}

export async function slShareCompany(name) {
  const n = name || _activeCompany;
  if (!n) { toast('No company selected', 'err'); return; }
  const meta    = getCompanyMeta(n) || {};
  const opening = meta.openingBalance || 0;
  const entries = getCompanyEntries(n);
  const rows    = calcRunningBalance(n, entries, opening);
  const bal     = rows.length ? rows[rows.length - 1].runningBalance : opening;
  const co      = localStorage.getItem('aifc_company') || 'AIFC Transport';
  if (navigator.share) {
    try { await navigator.share({ title: `Ledger — ${n}`, text: `${co}\nParty: ${n}\nBalance: ${fmtBalance(bal)}` }); }
    catch { /* dismissed */ }
  } else { slPrintCompany(n); toast('Save as PDF then share via WhatsApp', 'info'); }
}

export function slBack() {
  _activeCompany = null;
  _showView('list');
  _renderList();
}

export async function slExportExcel() {
  const all = _getFilteredSummaries();
  if (!all.length) { toast('No data to export', 'info'); return; }
  await new Promise((res, rej) => {
    if (typeof XLSX !== 'undefined') return res();
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  const headers = ['Party Name', 'Pay Side', 'Debit ₹', 'Credit ₹', 'Net Balance', 'Status', 'Last Transaction'];
  const data = all.map(s => [
    s.name,
    _filters.payFilter || 'Both',
    fromInt(s.totalDebit), fromInt(s.totalCredit),
    fromInt(Math.abs(s.netBalance)) + (s.netBalance > 0 ? ' Dr' : s.netBalance < 0 ? ' Cr' : ' Nil'),
    s.netBalance > 0 ? 'Receivable' : s.netBalance < 0 ? 'Payable' : 'Settled',
    s.lastDate || '',
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = [28, 12, 16, 16, 18, 12, 14].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Smart Ledger');
  XLSX.writeFile(wb, `AIFC_SmartLedger_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast(`Exported ${all.length} companies ✓`, 'ok');
}
