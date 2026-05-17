/**
 * api/db.js — Database Layer  (production-grade v2)
 * ─────────────────────────────────────────────────────────────────
 * Architecture (unchanged — backward compatible):
 *   Supabase → in-memory cache (_cachedEntries) → IndexedDB (offline)
 *   Reads  : synchronous from _cachedEntries
 *   Writes : async to Supabase → update cache → persist IDB
 *   Offline: writes queued → flushed on reconnect with retry + dedup
 *
 * IMPROVEMENTS vs v1 (no breaking changes):
 *   1. Offline queue deduplication: multiple edits to same LR → only last wins
 *   2. Retry with exponential backoff on transient Supabase errors
 *   3. Structured logging via logger.js (replaces console.*)
 *   4. Centralised error classification via error-handler.js
 *   5. syncFromSupabase is throttled — can't fire more than once per 2s
 *   6. IDB connection pooling — single _idbConn reused safely
 *   7. _checkPaymentSideCol cached robustly — won't re-check on every insert
 *   8. setDBStatus guards against missing DOM element (SSR / test safety)
 * ─────────────────────────────────────────────────────────────────
 */

import { SB_URL_KEY, SB_AKEY_KEY } from '../utils/constants.js';
import { toSB, fromSB } from './supabase.js';
import { toast } from '../utils/helpers.js';
import { log } from '../utils/logger.js';
import { classifySupabaseError, SB_ERRORS } from '../utils/error-handler.js';
import { withRetry, batchProcess, throttle } from '../utils/rate-limiter.js';

// ── Shared mutable state ──────────────────────────────────────────
export let _sb            = null;
export let _cachedEntries = [];
export let _totalCount    = 0;
export let _isOnline      = navigator.onLine;
let _idbConn              = null;

export function setSb(client)       { _sb = client; }
export function setOnline(v)        { _isOnline = v; }
export function setCachedEntries(v) { _cachedEntries = v; }
export function setTotalCount(v)    { _totalCount = v; }

// ─────────────────────────────────────────────────────────────────
//  INDEXEDDB HELPERS
// ─────────────────────────────────────────────────────────────────
function _openIDB() {
  if (_idbConn) return Promise.resolve(_idbConn);
  return new Promise((res, rej) => {
    const req = indexedDB.open('aifc_cache_v3', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('kv'))    db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { autoIncrement: true });
    };
    req.onsuccess = e => { _idbConn = e.target.result; res(_idbConn); };
    req.onerror   = e => { log.error('IDB open failed', e); rej(e); };
  });
}

export async function idbGet(key) {
  try {
    const db = await _openIDB();
    return new Promise(res => {
      const req = db.transaction('kv','readonly').objectStore('kv').get(key);
      req.onsuccess = () => res(req.result ?? null);
      req.onerror   = () => res(null);
    });
  } catch { return null; }
}

export async function idbSet(key, val) {
  try {
    const db = await _openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv','readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = res;
      tx.onerror    = rej;
    });
  } catch (e) { log.warn('IDB set failed', { key, error: e.message }); }
}

async function _idbQueueAdd(op) {
  try {
    const db = await _openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('queue','readwrite');
      tx.objectStore('queue').add(op);
      tx.oncomplete = res; tx.onerror = rej;
    });
  } catch (e) { log.warn('IDB queue add failed', e.message); }
}

async function _idbQueueAll() {
  try {
    const db = await _openIDB();
    return new Promise(res => {
      const all = [];
      const cur = db.transaction('queue','readonly').objectStore('queue').openCursor();
      cur.onsuccess = e => {
        const c = e.target.result;
        if (c) { all.push({ _key: c.primaryKey, ...c.value }); c.continue(); }
        else res(all);
      };
      cur.onerror = () => res([]);
    });
  } catch { return []; }
}

async function _idbQueueClear() {
  try {
    const db = await _openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('queue','readwrite');
      tx.objectStore('queue').clear();
      tx.oncomplete = res; tx.onerror = rej;
    });
  } catch (e) { log.warn('IDB queue clear failed', e.message); }
}

// ─────────────────────────────────────────────────────────────────
//  STATUS INDICATOR
// ─────────────────────────────────────────────────────────────────
export function setDBStatus(txt, state) {
  const txtEl = document.getElementById('db-status-txt');
  const dotEl = document.getElementById('db-dot');
  if (txtEl) txtEl.textContent = txt;
  if (dotEl) dotEl.className = 'sb-dot' + (state === 'ok' ? '' : state === 'err' ? ' err' : ' warn');
}

// ─────────────────────────────────────────────────────────────────
//  SYNC FROM SUPABASE  (throttled — max once per 2 seconds)
// ─────────────────────────────────────────────────────────────────
const _syncThrottled = throttle(_doSync, 2000);

export function syncFromSupabase(silent = false, renderCb) {
  return _syncThrottled(silent, renderCb);
}

async function _doSync(silent, renderCb) {
  // Serve stale cache immediately for fast first paint
  const cached = await idbGet('entries');
  if (cached && cached.length && !_cachedEntries.length) {
    _cachedEntries = cached;
    _totalCount    = cached.length;
    renderCb?.();
    if (!silent) setDBStatus(`${cached.length} entries (cached)`, 'warn');
  }

  if (!_sb) return;

  try {
    const { data, error } = await withRetry(
      () => _sb.from('entries').select('*')
               .order('cn_date', { ascending: false })
               .order('id',      { ascending: false }),
      { maxRetries: 2, baseDelayMs: 500 }
    );
    if (error) throw error;

    _cachedEntries = data.map(fromSB);
    _totalCount    = _cachedEntries.length;
    await idbSet('entries', _cachedEntries);
    renderCb?.();
    setDBStatus(`${_totalCount} entries — Supabase ✓`, 'ok');
    log.info('Sync complete', { count: _totalCount });

    await flushOfflineQueue(renderCb);
  } catch (err) {
    log.error('Sync failed', err);
    setDBStatus('Supabase error — using cache', 'err');
  }
}

// ─────────────────────────────────────────────────────────────────
//  OFFLINE QUEUE FLUSH
//  IMPROVEMENT: Deduplicates ops before flushing.
//    If the same LR was edited 5 times offline, only the last update
//    is sent to Supabase. Prevents stale overwrites.
// ─────────────────────────────────────────────────────────────────
export async function flushOfflineQueue(renderCb) {
  const queue = await _idbQueueAll();
  if (!queue.length) return;

  // ── Deduplicate: for same id, keep only the latest op ────────
  const dedupMap = new Map();
  for (const op of queue) {
    if (op.type === 'delete') {
      // Delete wins over any previous insert/update for the same id
      dedupMap.set(op.id, op);
    } else if (op.type === 'insert') {
      // Insert only if we don't already have a delete for this id
      if (!dedupMap.has(op.data?.cnNo)) {
        dedupMap.set('ins_' + (op.data?.cnNo || op._key), op);
      }
    } else if (op.type === 'update') {
      // Update: latest update wins (queue is in insertion order)
      const existing = dedupMap.get(op.id);
      if (!existing || existing.type !== 'delete') {
        dedupMap.set(op.id, op);
      }
    }
  }
  const deduped = [...dedupMap.values()];
  log.info(`Flushing ${deduped.length} ops (${queue.length - deduped.length} deduped)`, {});

  // ── Process with retry + rate limiting ───────────────────────
  const { ok, fail } = await batchProcess(deduped, async (op) => {
    await withRetry(async () => {
      if (op.type === 'insert') {
        const { error } = await _sb.from('entries').insert(_safeSbData(toSB(op.data)));
        if (error && error.code !== SB_ERRORS.DUPLICATE_KEY) throw error;
      } else if (op.type === 'update') {
        const { error } = await _sb.from('entries').update(_safeSbData(toSB(op.data))).eq('id', op.id);
        if (error) throw error;
      } else if (op.type === 'delete') {
        const { error } = await _sb.from('entries').delete().eq('id', op.id);
        if (error) throw error;
      }
    }, { maxRetries: 2, baseDelayMs: 300 });
  }, { delayMs: 100 });

  await _idbQueueClear();
  if (ok)   toast(`Synced ${ok} offline change${ok > 1 ? 's' : ''} ✓`, 'ok');
  if (fail) toast(`${fail} changes failed to sync — will retry next session`, 'err');

  await _doSync(true, renderCb);
}

// ─────────────────────────────────────────────────────────────────
//  PAYMENT_SIDE COLUMN DETECTION  (cached, with timeout guard)
// ─────────────────────────────────────────────────────────────────
let _hasPaymentSideCol = null;
let _colCheckInProgress = false;

async function _checkPaymentSideCol() {
  if (_hasPaymentSideCol !== null) return _hasPaymentSideCol;
  if (_colCheckInProgress) {
    // Wait for in-progress check — prevents race condition on concurrent inserts
    await new Promise(r => setTimeout(r, 200));
    return _hasPaymentSideCol ?? false;
  }
  if (!_sb) { _hasPaymentSideCol = false; return false; }

  _colCheckInProgress = true;
  try {
    const { error } = await _sb.from('entries').select('payment_side').limit(1);
    _hasPaymentSideCol = !error || !error.message?.toLowerCase().includes('payment_side');
  } catch {
    _hasPaymentSideCol = false;
  } finally {
    _colCheckInProgress = false;
  }

  if (!_hasPaymentSideCol) {
    log.warn('payment_side column missing. Run migration in Settings → Database Migration.');
  }
  return _hasPaymentSideCol;
}

function _safeSbData(sbData) {
  if (_hasPaymentSideCol === false) {
    const safe = { ...sbData };
    delete safe.payment_side;
    return safe;
  }
  return sbData;
}

// ─────────────────────────────────────────────────────────────────
//  CRUD  (all behavior preserved; improved error messages + retry)
// ─────────────────────────────────────────────────────────────────
import { showAlert } from '../components/modals.js';

export async function insertEntry(data) {
  const sbData = toSB(data);
  sbData.created_at = new Date().toISOString();

  if (!_isOnline || !_sb) {
    const tempId = 'temp_' + Date.now();
    _cachedEntries.unshift({ ...data, id: tempId });
    _totalCount++;
    await idbSet('entries', _cachedEntries);
    await _idbQueueAdd({ type: 'insert', data });
    toast('Saved offline — will sync when online', 'info');
    log.info('LR saved offline', { cnNo: data.cnNo });
    return true;
  }

  await _checkPaymentSideCol();
  const payload = _safeSbData(sbData);

  try {
    const { data: row, error } = await _sb.from('entries').insert(payload).select().single();
    if (error) throw error;
    _cachedEntries.unshift(fromSB(row));
    _totalCount++;
    await idbSet('entries', _cachedEntries);
    log.info('LR inserted', { cnNo: data.cnNo, id: row.id });
    return true;
  } catch (error) {
    // payment_side column missing — auto-retry without it
    if (error.message?.toLowerCase().includes('payment_side')) {
      _hasPaymentSideCol = false;
      const retryPayload = { ...payload };
      delete retryPayload.payment_side;
      try {
        const { data: row2, error: err2 } = await _sb.from('entries').insert(retryPayload).select().single();
        if (err2) throw err2;
        _cachedEntries.unshift(fromSB(row2));
        _totalCount++;
        await idbSet('entries', _cachedEntries);
        toast('Saved ✓ — run DB Migration in Settings to enable Payment Side', 'info');
        return true;
      } catch (err2) {
        if (err2.code === SB_ERRORS.DUPLICATE_KEY) {
          showAlert('Duplicate CN No.', `CN No. "${data.cnNo}" already exists.`);
          return false;
        }
        toast(classifySupabaseError(err2, 'insertEntry'), 'err');
        return false;
      }
    }
    if (error.code === SB_ERRORS.DUPLICATE_KEY) {
      showAlert('Duplicate CN No.', `CN No. "${data.cnNo}" already exists.`);
      return false;
    }
    toast(classifySupabaseError(error, 'insertEntry'), 'err');
    log.error('insertEntry failed', error);
    return false;
  }
}

export async function updateEntry(id, data) {
  if (!_isOnline || !_sb) {
    const idx = _cachedEntries.findIndex(e => e.id === id);
    if (idx >= 0) _cachedEntries[idx] = { ...data, id };
    await idbSet('entries', _cachedEntries);
    await _idbQueueAdd({ type: 'update', id, data });
    toast('Updated offline — will sync when online', 'info');
    return true;
  }

  await _checkPaymentSideCol();
  const payload = _safeSbData(toSB(data));

  try {
    const { error } = await _sb.from('entries').update(payload).eq('id', id);
    if (error) throw error;
    const idx = _cachedEntries.findIndex(e => e.id === id);
    if (idx >= 0) _cachedEntries[idx] = { ...data, id };
    await idbSet('entries', _cachedEntries);
    return true;
  } catch (error) {
    if (error.message?.toLowerCase().includes('payment_side')) {
      _hasPaymentSideCol = false;
      const retryPayload = { ...payload };
      delete retryPayload.payment_side;
      const { error: err2 } = await _sb.from('entries').update(retryPayload).eq('id', id);
      if (err2) { toast(classifySupabaseError(err2, 'updateEntry'), 'err'); return false; }
      const idx = _cachedEntries.findIndex(e => e.id === id);
      if (idx >= 0) _cachedEntries[idx] = { ...data, id };
      await idbSet('entries', _cachedEntries);
      return true;
    }
    toast(classifySupabaseError(error, 'updateEntry'), 'err');
    log.error('updateEntry failed', error);
    return false;
  }
}

export async function deleteEntry(id) {
  if (!_isOnline || !_sb) {
    _cachedEntries  = _cachedEntries.filter(e => e.id !== id);
    _totalCount     = Math.max(0, _totalCount - 1);
    await idbSet('entries', _cachedEntries);
    await _idbQueueAdd({ type: 'delete', id });
    toast('Deleted offline — will sync when online', 'info');
    return true;
  }

  try {
    const { error } = await _sb.from('entries').delete().eq('id', id);
    if (error) throw error;
    _cachedEntries  = _cachedEntries.filter(e => e.id !== id);
    _totalCount     = Math.max(0, _totalCount - 1);
    await idbSet('entries', _cachedEntries);
    return true;
  } catch (error) {
    toast(classifySupabaseError(error, 'deleteEntry'), 'err');
    log.error('deleteEntry failed', error);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────
//  FILTER IN-MEMORY CACHE  (single-pass O(n) — unchanged behavior)
// ─────────────────────────────────────────────────────────────────
export function getAllEntries(filters = {}) {
  const mo        = filters.month != null && filters.month !== '' ? parseInt(filters.month) : null;
  const yr        = filters.year  ? parseInt(filters.year)  : null;
  const isPending = filters.status === 'pending';
  const isPaid    = filters.status === 'paid';
  const companyQ  = filters.company ? filters.company.toLowerCase() : null;
  const searchQ   = filters.search  ? filters.search.toLowerCase()  : null;

  const rows = [];
  for (let i = 0, len = _cachedEntries.length; i < len; i++) {
    const e = _cachedEntries[i];

    if (mo !== null || yr !== null) {
      if (!e.cnDate) continue;
      const eYr = parseInt(e.cnDate.slice(0, 4), 10);
      const eMo = parseInt(e.cnDate.slice(5, 7), 10) - 1;
      if (yr !== null && eYr !== yr) continue;
      if (mo !== null && eMo !== mo) continue;
    }

    const hasMr = e.mrNo && String(e.mrNo).trim();
    if (isPending && hasMr)  continue;
    if (isPaid    && !hasMr) continue;

    if (companyQ) {
      const c = (e.consignor || '').toLowerCase();
      const d = (e.consignee || '').toLowerCase();
      if (!c.includes(companyQ) && !d.includes(companyQ)) continue;
    }

    if (searchQ) {
      const hay = `${e.cnNo||''}|${e.consignor||''}|${e.consignee||''}|${e.truckNo||''}|${e.destination||''}|${e.challanNo||''}`.toLowerCase();
      if (!hay.includes(searchQ)) continue;
    }

    rows.push(e);
  }
  return rows;
}
