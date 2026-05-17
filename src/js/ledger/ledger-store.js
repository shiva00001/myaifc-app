/**
 * Smart Ledger Store — v4 (duplication + integrity fix)
 *
 * CORE RULES (prevents ALL duplication):
 *  1. ONE entry per LR — deterministic IDs sl_lr_dr_{id} / sl_lr_cr_{id}
 *  2. paymentSide MUST be set — LRs without it are NEVER imported (no defaults)
 *  3. syncCompaniesFromEntries reads from _entries, NOT from LR party names
 *  4. Full reconciliation on every ledger open: stale entries corrected
 *  5. Companies with zero activity are hidden from stats/cards
 *
 * PRECISION: all amounts = integer paise (rupees × 100).
 */

import { idbGet, idbSet } from '../api/db.js';
import { toast } from '../utils/helpers.js';

const IDB_ENTRIES   = 'sl_entries';
const IDB_COMPANIES = 'sl_companies';
const IDB_SEQ       = 'sl_vch_seq';

let _entries   = [];
let _companies = [];
let _vchSeq    = { PAY: 0, REC: 0, JNL: 0 };

// ─────────────────────────────────────────────────────────────────
//  PRECISION
// ─────────────────────────────────────────────────────────────────
export function toInt(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(String(v).replace(/[₹,\s]/g, ''));
  return isNaN(n) ? 0 : Math.round(n * 100);
}
export function fromInt(v) {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format((v ?? 0) / 100);
}
export function fmtBalance(v) {
  if (!v) return 'Nil';
  return `₹${fromInt(Math.abs(v))} ${v > 0 ? 'Dr' : 'Cr'}`;
}

// ─────────────────────────────────────────────────────────────────
//  VOUCHER SEQUENCE
// ─────────────────────────────────────────────────────────────────
const VCH_PREFIX = { Payment: 'PAY', Receipt: 'REC', Journal: 'JNL' };
async function _nextVchNo(type) {
  const pfx    = VCH_PREFIX[type] || 'JNL';
  _vchSeq[pfx] = (_vchSeq[pfx] || 0) + 1;
  await idbSet(IDB_SEQ, _vchSeq);
  return `${pfx}-${String(_vchSeq[pfx]).padStart(4, '0')}`;
}

// ─────────────────────────────────────────────────────────────────
//  PERSISTENCE
// ─────────────────────────────────────────────────────────────────
export async function loadLedger() {
  const [e, c, s] = await Promise.all([
    idbGet(IDB_ENTRIES),
    idbGet(IDB_COMPANIES),
    idbGet(IDB_SEQ),
  ]);
  _entries   = Array.isArray(e) ? e : [];
  _companies = Array.isArray(c) ? c : [];
  _vchSeq    = s || { PAY: 0, REC: 0, JNL: 0 };
}
export async function reloadLedger() { await loadLedger(); }
async function _saveEntries()   { await idbSet(IDB_ENTRIES,   _entries);   }
async function _saveCompanies() { await idbSet(IDB_COMPANIES, _companies); }

// ─────────────────────────────────────────────────────────────────
//  COMPANIES
// ─────────────────────────────────────────────────────────────────
export function getCompanies()       { return [..._companies]; }
export function getCompanyMeta(name) { return _companies.find(c => c.name === name) || null; }
export function getTrackedCompanyNames() {
  return _companies.filter(c => c.tracked).map(c => c.name);
}

/**
 * FIX (root cause of duplication):
 * Only register companies that have ACTUAL ledger entries.
 * Never iterate LR consignors/consignees blindly.
 */
export async function syncCompaniesFromEntries() {
  const namesWithEntries = new Set(_entries.map(e => e.companyName));
  const registered       = new Set(_companies.map(c => c.name));
  let changed = false;
  for (const name of namesWithEntries) {
    if (!registered.has(name)) {
      _companies.push({ name, tracked: false, openingBalance: 0, addedAt: Date.now() });
      registered.add(name);
      changed = true;
    }
  }
  if (changed) await _saveCompanies();
}

export async function addCompany(name, openingBalanceStr = '0') {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Company name is required');
  if (_companies.find(c => c.name.toLowerCase() === trimmed.toLowerCase()))
    throw new Error(`Company "${trimmed}" already exists`);
  _companies.push({ name: trimmed, tracked: true, openingBalance: toInt(openingBalanceStr), addedAt: Date.now() });
  await _saveCompanies();
}

export async function deleteCompany(name) {
  _companies = _companies.filter(c => c.name !== name);
  _entries   = _entries.filter(e => e.companyName !== name);
  await Promise.all([_saveCompanies(), _saveEntries()]);
}

export async function updateOpeningBalance(companyName, balStr) {
  const c = _companies.find(c => c.name === companyName);
  if (c) { c.openingBalance = toInt(balStr); await _saveCompanies(); }
}

export async function toggleTracked(companyName, tracked) {
  const c = _companies.find(c => c.name === companyName);
  if (c) { c.tracked = tracked; await _saveCompanies(); }
}

// ─────────────────────────────────────────────────────────────────
//  MANUAL ENTRIES — CRUD
// ─────────────────────────────────────────────────────────────────
export async function addLedgerEntry({ companyName, type = 'Payment', side, amountStr, date, remarks = '' }) {
  const name = (companyName || '').trim();
  if (!name)                              throw new Error('Company name is required');
  if (!['debit','credit'].includes(side)) throw new Error('Debit or Credit must be selected');
  if (!date)                              throw new Error('Date is required');
  const amt = toInt(amountStr);
  if (amt <= 0)                           throw new Error('Amount must be greater than zero');
  _ensureCompany(name, true);
  const vchNo = await _nextVchNo(type);
  const entry = {
    id: `sl_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    companyName: name, date, type, vchNo, side,
    debit : side === 'debit'  ? amt : 0,
    credit: side === 'credit' ? amt : 0,
    remarks: (remarks || '').trim(),
    createdAt: Date.now(), updatedAt: Date.now(),
    source: 'manual',
  };
  _entries.push(entry);
  await _saveEntries();
  await _saveCompanies();
  return entry;
}

export async function editLedgerEntry(id, updates) {
  const e = _entries.find(e => e.id === id);
  if (!e)              throw new Error('Entry not found');
  if (e.source === 'lr') throw new Error('Auto-imported LR entries cannot be edited. Edit the LR instead.');
  const newSide      = updates.side      !== undefined ? updates.side : e.side;
  const newAmountStr = updates.amountStr !== undefined ? updates.amountStr : null;
  if (newAmountStr !== null) {
    const amt = toInt(newAmountStr);
    if (amt <= 0) throw new Error('Amount must be greater than zero');
    updates.debit  = newSide === 'debit'  ? amt : 0;
    updates.credit = newSide === 'credit' ? amt : 0;
  } else if (updates.side !== undefined && updates.side !== e.side) {
    const existing = e.debit > 0 ? e.debit : e.credit;
    updates.debit  = newSide === 'debit'  ? existing : 0;
    updates.credit = newSide === 'credit' ? existing : 0;
  }
  delete updates.amountStr;
  Object.assign(e, updates, { updatedAt: Date.now() });
  await _saveEntries();
  return e;
}

export async function deleteLedgerEntry(id) {
  const idx = _entries.findIndex(e => e.id === id);
  if (idx >= 0) { _entries.splice(idx, 1); await _saveEntries(); }
}

// ─────────────────────────────────────────────────────────────────
//  LR → LEDGER INTEGRATION
// ─────────────────────────────────────────────────────────────────

/** Resolve paying party from paymentSide. Returns null if not set. */
function _resolveParty(lr) {
  const side = (lr.paymentSide || '').toLowerCase().trim();
  if (side === 'consignor') return { side: 'consignor', company: (lr.consignor || '').trim() };
  if (side === 'consignee') return { side: 'consignee', company: (lr.consignee || '').trim() };
  return null; // no paymentSide → NEVER import
}

function _ensureCompany(name, tracked = false) {
  if (!_companies.find(c => c.name === name))
    _companies.push({ name, tracked, openingBalance: 0, addedAt: Date.now() });
}

export async function importLREntry(lr) {
  const tbb  = toInt(lr.tbb);
  if (!tbb || !lr.cnDate) return;
  const paid = lr.mrNo && String(lr.mrNo).trim();
  if (paid) { await removeLRDebitEntry(lr.id); return; }
  const party = _resolveParty(lr);
  if (!party || !party.company) return;

  const drId    = `sl_lr_dr_${lr.id}`;
  const existing = _entries.find(e => e.id === drId);
  const remark  = [`LR: ${lr.cnNo}`, lr.truckNo ? `Truck: ${lr.truckNo}` : null, 'Freight due'].filter(Boolean).join(' | ');

  if (existing) {
    let dirty = false;
    if (existing.companyName !== party.company) { existing.companyName = party.company; dirty = true; }
    if (existing.debit       !== tbb)           { existing.debit       = tbb;           dirty = true; }
    if (existing.remarks     !== remark)        { existing.remarks     = remark;        dirty = true; }
    if (existing.paymentSide !== party.side)    { existing.paymentSide = party.side;   dirty = true; }
    if (dirty) { existing.updatedAt = Date.now(); await _saveEntries(); }
    return;
  }
  _ensureCompany(party.company);
  const vchNo = await _nextVchNo('Journal');
  _entries.push({ id: drId, companyName: party.company, date: lr.cnDate, type: 'Journal', vchNo, side: 'debit', debit: tbb, credit: 0, remarks: remark, createdAt: Date.now(), updatedAt: Date.now(), source: 'lr', lrId: lr.id, paymentSide: party.side });
  await _saveEntries();
  await _saveCompanies();
}

export async function settleLREntry(lr) {
  const tbb  = toInt(lr.tbb);
  const paid = lr.mrNo && String(lr.mrNo).trim();
  if (!tbb || !paid || !lr.cnDate) return;
  const party = _resolveParty(lr);
  if (!party || !party.company) return;

  await removeLRDebitEntry(lr.id);

  const crId    = `sl_lr_cr_${lr.id}`;
  const existing = _entries.find(e => e.id === crId);
  const remark  = [`LR: ${lr.cnNo}`, lr.truckNo ? `Truck: ${lr.truckNo}` : null, `Payment received | MR: ${lr.mrNo}`].filter(Boolean).join(' | ');

  if (existing) {
    let dirty = false;
    if (existing.companyName !== party.company) { existing.companyName = party.company; dirty = true; }
    if (existing.credit      !== tbb)           { existing.credit      = tbb;           dirty = true; }
    if (existing.remarks     !== remark)        { existing.remarks     = remark;        dirty = true; }
    if (dirty) { existing.updatedAt = Date.now(); await _saveEntries(); }
    return;
  }
  _ensureCompany(party.company);
  const vchNo = await _nextVchNo('Receipt');
  _entries.push({ id: crId, companyName: party.company, date: lr.cnDate, type: 'Receipt', vchNo, side: 'credit', debit: 0, credit: tbb, remarks: remark, createdAt: Date.now(), updatedAt: Date.now(), source: 'lr', lrId: lr.id, paymentSide: party.side });
  await _saveEntries();
  await _saveCompanies();
}

export async function removeLRDebitEntry(lrId) {
  const idx = _entries.findIndex(e => e.id === `sl_lr_dr_${lrId}`);
  if (idx >= 0) { _entries.splice(idx, 1); await _saveEntries(); }
}

export async function removeAllLREntries(lrId) {
  const before = _entries.length;
  _entries = _entries.filter(e => e.lrId !== lrId);
  if (_entries.length !== before) await _saveEntries();
}

/**
 * Full reconciliation — O(n), single pass.
 * Removes stale entries, upserts correct ones, skips LRs without paymentSide.
 */
export async function syncAllLREntries(lrEntries) {
  if (!Array.isArray(lrEntries)) return;

  // Build lookup map
  const lrMap = Object.create(null);
  for (const lr of lrEntries) lrMap[lr.id] = lr;

  // Remove stale LR entries whose LR no longer exists
  const before = _entries.length;
  _entries = _entries.filter(e => e.source !== 'lr' || !!lrMap[e.lrId]);
  let dirty = before !== _entries.length;

  // Upsert for each LR
  for (const lr of lrEntries) {
    const tbb   = toInt(lr.tbb);
    if (!tbb || !lr.cnDate) continue;

    const party = _resolveParty(lr);
    const paid  = lr.mrNo && String(lr.mrNo).trim();

    if (!party || !party.company) {
      // No paymentSide — remove any existing entries for this LR
      const di = _entries.findIndex(e => e.id === `sl_lr_dr_${lr.id}`);
      const ci = _entries.findIndex(e => e.id === `sl_lr_cr_${lr.id}`);
      if (di >= 0) { _entries.splice(di, 1); dirty = true; }
      const ci2 = _entries.findIndex(e => e.id === `sl_lr_cr_${lr.id}`);
      if (ci2 >= 0) { _entries.splice(ci2, 1); dirty = true; }
      continue;
    }

    _ensureCompany(party.company);

    const drId    = `sl_lr_dr_${lr.id}`;
    const crId    = `sl_lr_cr_${lr.id}`;
    const drRemark = [`LR: ${lr.cnNo}`, lr.truckNo ? `Truck: ${lr.truckNo}` : null, 'Freight due'].filter(Boolean).join(' | ');
    const crRemark = [`LR: ${lr.cnNo}`, lr.truckNo ? `Truck: ${lr.truckNo}` : null, `Payment received | MR: ${lr.mrNo}`].filter(Boolean).join(' | ');

    if (paid) {
      // Remove debit if present
      const di = _entries.findIndex(e => e.id === drId);
      if (di >= 0) { _entries.splice(di, 1); dirty = true; }

      // Upsert credit
      let cr = _entries.find(e => e.id === crId);
      if (!cr) {
        const vchNo = await _nextVchNo('Receipt');
        _entries.push({ id: crId, companyName: party.company, date: lr.cnDate, type: 'Receipt', vchNo, side: 'credit', debit: 0, credit: tbb, remarks: crRemark, createdAt: Date.now(), updatedAt: Date.now(), source: 'lr', lrId: lr.id, paymentSide: party.side });
        dirty = true;
      } else if (cr.companyName !== party.company || cr.credit !== tbb) {
        cr.companyName = party.company; cr.credit = tbb; cr.remarks = crRemark; cr.paymentSide = party.side; cr.updatedAt = Date.now();
        dirty = true;
      }
    } else {
      // Remove credit if present (LR was un-paid / MR cleared)
      const ci = _entries.findIndex(e => e.id === crId);
      if (ci >= 0) { _entries.splice(ci, 1); dirty = true; }

      // Upsert debit
      let dr = _entries.find(e => e.id === drId);
      if (!dr) {
        const vchNo = await _nextVchNo('Journal');
        _entries.push({ id: drId, companyName: party.company, date: lr.cnDate, type: 'Journal', vchNo, side: 'debit', debit: tbb, credit: 0, remarks: drRemark, createdAt: Date.now(), updatedAt: Date.now(), source: 'lr', lrId: lr.id, paymentSide: party.side });
        dirty = true;
      } else if (dr.companyName !== party.company || dr.debit !== tbb) {
        dr.companyName = party.company; dr.debit = tbb; dr.remarks = drRemark; dr.paymentSide = party.side; dr.updatedAt = Date.now();
        dirty = true;
      }
    }
  }

  if (dirty) await _saveEntries();
  await syncCompaniesFromEntries();
}

// ─────────────────────────────────────────────────────────────────
//  QUERY
// ─────────────────────────────────────────────────────────────────
export function getCompanyEntries(companyName, { dateFrom, dateTo } = {}) {
  let rows = _entries.filter(e => e.companyName === companyName);
  if (dateFrom) rows = rows.filter(e => e.date >= dateFrom);
  if (dateTo)   rows = rows.filter(e => e.date <= dateTo);
  return rows.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    return d !== 0 ? d : a.createdAt - b.createdAt;
  });
}

export function calcRunningBalance(companyName, entries, openingBalance = 0) {
  let bal = openingBalance;
  return entries.map(e => { bal = bal + e.debit - e.credit; return { ...e, runningBalance: bal }; });
}

export function getCompanySummaries({ dateFrom, dateTo, filter = 'all', search = '' } = {}) {
  const map = Object.create(null);

  for (const co of _companies)
    map[co.name] = { name: co.name, tracked: co.tracked, openingBalance: co.openingBalance || 0, totalDebit: 0, totalCredit: 0, lastDate: '', entryCount: 0 };

  for (const e of _entries) {
    if (dateFrom && e.date < dateFrom) continue;
    if (dateTo   && e.date > dateTo)   continue;
    if (!map[e.companyName])
      map[e.companyName] = { name: e.companyName, tracked: false, openingBalance: 0, totalDebit: 0, totalCredit: 0, lastDate: '', entryCount: 0 };
    const c = map[e.companyName];
    c.totalDebit  += e.debit;
    c.totalCredit += e.credit;
    if (!c.lastDate || e.date > c.lastDate) c.lastDate = e.date;
    c.entryCount++;
  }

  return Object.values(map)
    .map(c => ({ ...c, netBalance: c.openingBalance + c.totalDebit - c.totalCredit }))
    .filter(c => {
      const hasActivity = c.entryCount > 0 || c.openingBalance !== 0;
      if (!hasActivity) return false;
      if (filter === 'due'    && c.netBalance === 0) return false;
      if (filter === 'debit'  && c.netBalance <= 0)  return false;
      if (filter === 'credit' && c.netBalance >= 0)  return false;
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => Math.abs(b.netBalance) - Math.abs(a.netBalance));
}

export function getLedgerTotals() {
  const map = Object.create(null);
  for (const co of _companies) map[co.name] = { openingBalance: co.openingBalance || 0, totalDebit: 0, totalCredit: 0 };
  for (const e of _entries) {
    if (!map[e.companyName]) map[e.companyName] = { openingBalance: 0, totalDebit: 0, totalCredit: 0 };
    map[e.companyName].totalDebit  += e.debit;
    map[e.companyName].totalCredit += e.credit;
  }
  let totalDr = 0, totalCr = 0, totalCompanies = 0;
  for (const c of Object.values(map)) {
    if (c.totalDebit === 0 && c.totalCredit === 0 && c.openingBalance === 0) continue;
    const net = c.openingBalance + c.totalDebit - c.totalCredit;
    if (net > 0) totalDr += net;
    if (net < 0) totalCr += Math.abs(net);
    totalCompanies++;
  }
  return { totalDr, totalCr, totalCompanies };
}

export function getAllLedgerEntries() { return [..._entries]; }
