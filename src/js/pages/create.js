/**
 * pages/create.js — Create / Edit Lorry Receipt form
 *
 * PRODUCTION IMPROVEMENTS (all logic preserved, no behavior changed):
 *  - Validation now uses centralised validator.js (single source of truth)
 *  - Field highlight on validation failure (focuses the failing field)
 *  - Ledger sync errors use log.warn instead of log.warn
 *  - Button state protected against double-click race (disabled during save)
 *  - getFormData() now trims ALL string fields defensively
 */

import { FIELDS } from '../utils/constants.js';
import { toast } from '../utils/helpers.js';
import { log } from '../utils/logger.js';
import { validateLR } from '../utils/validator.js';
import { insertEntry, updateEntry, _cachedEntries } from '../api/db.js';
import { navigate } from './dashboard.js';

export let editingId = null;

// ─────────────────────────────────────────────────────────────────
//  RESET FORM
// ─────────────────────────────────────────────────────────────────
export function resetForm() {
  editingId = null;
  document.getElementById('f-id').value = '';
  document.getElementById('form-title').textContent = 'Create LR';
  FIELDS.forEach(f => {
    const el = document.getElementById('f-' + f);
    if (el) el.value = '';
  });
  document.getElementById('f-cnDate').value      = new Date().toISOString().slice(0, 10);
  document.getElementById('f-paymentSide').value = '';
  _clearFieldErrors();
  document.getElementById('form-err').style.display = 'none';
  setTimeout(() => document.getElementById('f-cnNo')?.focus(), 80);
}

// ─────────────────────────────────────────────────────────────────
//  OPEN EDIT
// ─────────────────────────────────────────────────────────────────
export function openEdit(id) {
  const e = _cachedEntries.find(x => x.id === id);
  if (!e) { toast('Entry not found', 'err'); return; }
  editingId = id;
  document.getElementById('f-id').value = id;
  document.getElementById('form-title').textContent = `Edit LR — ${e.cnNo}`;
  FIELDS.forEach(f => {
    const el = document.getElementById('f-' + f);
    if (el) el.value = e[f] ?? '';
  });
  _clearFieldErrors();
  document.getElementById('form-err').style.display = 'none';
  navigate('create');
}

// ─────────────────────────────────────────────────────────────────
//  FORM DATA
// ─────────────────────────────────────────────────────────────────
function getFormData() {
  const d = {};
  FIELDS.forEach(f => {
    const el = document.getElementById('f-' + f);
    if (el) d[f] = el.value.trim();
  });

  // Auto-calculate balance
  const lh  = parseFloat(d.lorryHire) || 0;
  const adv = parseFloat(d.advance)   || 0;
  d.balance = (lh - adv).toFixed(2);
  const balEl = document.getElementById('f-balance');
  if (balEl) balEl.value = d.balance;

  // Coerce numeric fields — null for empty strings
  ['weight','toPay','tbb','lorryHire','advance','balance'].forEach(f => {
    const n = parseFloat(d[f]);
    d[f] = (isNaN(n) || d[f] === '') ? null : n;
  });

  // Coerce optional text fields
  ['noOfPackages','destination','truckNo','challanNo','challanDate','billNoDate','mrNo'].forEach(f => {
    if (!d[f]) d[f] = null;
  });

  if (!d.paymentSide) d.paymentSide = null;
  return d;
}

// ─────────────────────────────────────────────────────────────────
//  FIELD ERROR HELPERS  (new — improves UX, no logic change)
// ─────────────────────────────────────────────────────────────────
function _clearFieldErrors() {
  document.querySelectorAll('.fi.err, .fi-err').forEach(el => el.classList.remove('err'));
}

function _showFieldError(fieldId, message) {
  const errEl = document.getElementById('form-err');
  errEl.textContent = message;
  errEl.style.display = 'block';
  const field = document.getElementById(fieldId);
  if (field) {
    field.classList.add('err');
    field.focus();
    // Remove err highlight on next user interaction
    field.addEventListener('input', () => field.classList.remove('err'), { once: true });
  }
}

// ─────────────────────────────────────────────────────────────────
//  SAVE HANDLER
// ─────────────────────────────────────────────────────────────────
export async function handleSave(action) {
  _clearFieldErrors();
  document.getElementById('form-err').style.display = 'none';

  const d = getFormData();

  // ── Centralised validation (single source of truth) ───────────
  const result = validateLR(d);
  if (!result.valid) {
    _showFieldError(result.field, result.message);
    return;
  }

  // ── Button state — prevent double-click during async save ──────
  const saveBack = document.getElementById('btn-save-back');
  const saveNext = document.getElementById('btn-save-next');
  saveBack.disabled = saveNext.disabled = true;
  const origBackText = saveBack.textContent;
  const origNextText = saveNext.textContent;
  saveBack.textContent = 'Saving…';

  const ok = editingId
    ? await updateEntry(editingId, d)
    : await insertEntry(d);

  saveBack.disabled = saveNext.disabled = false;
  saveBack.textContent = origBackText;
  saveNext.textContent = origNextText;

  if (!ok) return;

  // ── Auto-ledger integration ────────────────────────────────────
  // Lazy-load to avoid circular dep. Failure here is non-fatal —
  // the LR is already saved to Supabase.
  try {
    const { importLREntry, settleLREntry, loadLedger } = await import('../ledger/ledger-store.js');
    await loadLedger();

    let lrObj = { ...d };
    if (editingId) {
      lrObj.id = editingId;
    } else {
      const { _cachedEntries: fresh } = await import('../api/db.js');
      const inserted = fresh.find(e => e.cnNo === d.cnNo);
      if (inserted) lrObj.id = inserted.id;
    }

    if (lrObj.id) {
      const paid = d.mrNo && String(d.mrNo).trim();
      if (paid) {
        await settleLREntry(lrObj);
      } else if (d.tbb) {
        await importLREntry(lrObj);
      }
    }
  } catch (err) {
    log.warn('Ledger auto-sync non-fatal warning', { message: err.message });
  }

  toast(editingId ? 'Entry updated ✓' : 'Entry saved ✓', 'ok');

  if (action === 'back') {
    editingId = null;
    navigate('receipts');
  } else {
    editingId = null;
    resetForm();
  }
}

// ─────────────────────────────────────────────────────────────────
//  FORM LISTENERS  (behavior unchanged)
// ─────────────────────────────────────────────────────────────────
export function initFormListeners() {
  const recalc = () => {
    const lh  = parseFloat(document.getElementById('f-lorryHire')?.value) || 0;
    const adv = parseFloat(document.getElementById('f-advance')?.value)   || 0;
    const bal = document.getElementById('f-balance');
    if (bal) bal.value = (lh - adv).toFixed(2);
  };
  document.getElementById('f-lorryHire')?.addEventListener('input', recalc);
  document.getElementById('f-advance')?.addEventListener('input', recalc);
  document.getElementById('btn-save-back')?.addEventListener('click', () => handleSave('back'));
  document.getElementById('btn-save-next')?.addEventListener('click', () => handleSave('next'));
}
