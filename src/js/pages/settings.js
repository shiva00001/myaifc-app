/**
 * pages/settings.js — Settings page
 *
 * PRODUCTION IMPROVEMENTS (all behavior preserved):
 *  - saveSupabaseConfig uses validateSupabaseConfig() before connecting
 *  - saveCompanyDetails uses validateCompanyName() before saving
 *  - testConnection shows structured error via classifySupabaseError
 *  - renderDBInfo shows payment_side column status inline
 *  - All console.* replaced with log.*
 */

import { SB_URL_KEY, SB_AKEY_KEY } from '../utils/constants.js';
import { toast, esc } from '../utils/helpers.js';
import { log } from '../utils/logger.js';
import { validateSupabaseConfig, validateCompanyName } from '../utils/validator.js';
import { classifySupabaseError } from '../utils/error-handler.js';
import { _sb, setSb, _isOnline, _cachedEntries, idbSet, syncFromSupabase, setDBStatus } from '../api/db.js';
import { pinUnlocked } from '../auth/pin.js';
import { showAlert } from '../components/modals.js';
import { SCHEMA_SQL } from '../api/supabase.js';
import { renderCurrent } from './dashboard.js';

// ─────────────────────────────────────────────────────────────────
//  RENDER SETTINGS PAGE
// ─────────────────────────────────────────────────────────────────
export function renderSettingsPage() {
  renderDBInfo();
  checkMigrationStatus();

  const url  = localStorage.getItem(SB_URL_KEY)  || '';
  const akey = localStorage.getItem(SB_AKEY_KEY) || '';
  document.getElementById('s-sb-url').value = url;
  document.getElementById('s-sb-key').value = akey ? '••••••••' : '';

  const banner = document.getElementById('sb-banner');
  if (banner) banner.style.display = (!url || !akey) ? 'flex' : 'none';

  const fields = {
    's-company' : 'aifc_company',
    's-company2': 'aifc_company2',
    's-addr1'   : ['aifc_addr1', 'aifc_address'],   // fallback to old key
    's-addr2'   : 'aifc_addr2',
    's-email'   : 'aifc_email',
    's-gst'     : 'aifc_gst',
  };
  for (const [elId, key] of Object.entries(fields)) {
    const el = document.getElementById(elId);
    if (!el) continue;
    if (Array.isArray(key)) {
      el.value = localStorage.getItem(key[0]) || localStorage.getItem(key[1]) || '';
    } else {
      el.value = localStorage.getItem(key) || '';
    }
  }

  const pre = document.getElementById('sb-schema-sql');
  if (pre) pre.textContent = SCHEMA_SQL;
}

// ─────────────────────────────────────────────────────────────────
//  SUPABASE CONFIG
// ─────────────────────────────────────────────────────────────────
export async function saveSupabaseConfig() {
  const url  = document.getElementById('s-sb-url').value.trim().replace(/\/$/, '');
  const akey = document.getElementById('s-sb-key').value.trim();

  // Validate before connecting — prevents wasted network round-trips
  const v = validateSupabaseConfig({ url, anonKey: akey });
  if (!v.valid) { toast(v.message, 'err'); return; }

  localStorage.setItem(SB_URL_KEY,  url);
  localStorage.setItem(SB_AKEY_KEY, akey);

  const statusEl = document.getElementById('sb-conn-status');
  if (statusEl) statusEl.textContent = 'Connecting…';

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(url, akey);
    setSb(client);
    const banner = document.getElementById('sb-banner');
    if (banner) banner.style.display = 'none';
    await syncFromSupabase(false, renderCurrent);
    if (statusEl) statusEl.textContent = '✓ Connected';
    toast('Supabase connected ✓', 'ok');
    log.info('Supabase connected', { url });
    renderDBInfo();
  } catch (err) {
    if (statusEl) statusEl.textContent = '✗ Connection failed';
    toast('Connection failed: ' + err.message, 'err');
    log.error('saveSupabaseConfig failed', err);
  }
}

export async function testConnection() {
  const url  = document.getElementById('s-sb-url').value.trim().replace(/\/$/, '');
  const akey = document.getElementById('s-sb-key').value.trim();

  const v = validateSupabaseConfig({ url, anonKey: akey });
  if (!v.valid) { toast(v.message, 'err'); return; }

  const statusEl = document.getElementById('sb-conn-status');
  if (statusEl) statusEl.textContent = 'Testing…';

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(url, akey);
    const { error } = await client.from('entries').select('id').limit(1);
    if (error) throw error;
    if (statusEl) statusEl.textContent = '✓ Connection OK';
    toast('Connection successful ✓', 'ok');
  } catch (e) {
    const msg = classifySupabaseError(e, 'testConnection');
    if (statusEl) statusEl.textContent = '✗ ' + msg;
    toast('Connection failed: ' + msg, 'err');
  }
}

// ─────────────────────────────────────────────────────────────────
//  COMPANY DETAILS
// ─────────────────────────────────────────────────────────────────
export function saveCompanyDetails() {
  const name = document.getElementById('s-company')?.value.trim() || '';

  const v = validateCompanyName(name);
  if (!v.valid) { toast(v.message, 'err'); return; }

  localStorage.setItem('aifc_company',  name);
  localStorage.setItem('aifc_company2', (document.getElementById('s-company2')?.value || '').trim());
  localStorage.setItem('aifc_addr1',    (document.getElementById('s-addr1')?.value    || '').trim());
  localStorage.setItem('aifc_addr2',    (document.getElementById('s-addr2')?.value    || '').trim());
  localStorage.setItem('aifc_email',    (document.getElementById('s-email')?.value    || '').trim());
  localStorage.setItem('aifc_gst',      (document.getElementById('s-gst')?.value      || '').trim().toUpperCase());
  // Keep old key for backward compat with older PDF exports
  localStorage.setItem('aifc_address',  (document.getElementById('s-addr1')?.value    || '').trim());
  toast('Company details saved ✓', 'ok');
  log.info('Company details updated', { name });
}

// ─────────────────────────────────────────────────────────────────
//  PIN CHANGE
// ─────────────────────────────────────────────────────────────────
export function changePIN() {
  const cur = document.getElementById('s-cur-pin')?.value || '';
  const nw  = document.getElementById('s-new-pin')?.value || '';
  const cf  = document.getElementById('s-confirm-pin')?.value || '';
  const stored = localStorage.getItem('aifc_pin') || '1234';

  if (cur !== stored)         { toast('Current PIN is incorrect', 'err'); return; }
  if (!/^\d{4}$/.test(nw))   { toast('New PIN must be exactly 4 digits', 'err'); return; }
  if (nw !== cf)              { toast('PINs do not match', 'err'); return; }

  localStorage.setItem('aifc_pin', nw);
  ['s-cur-pin','s-new-pin','s-confirm-pin'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  toast('PIN updated successfully ✓', 'ok');
  log.info('PIN changed');
}

// ─────────────────────────────────────────────────────────────────
//  DATA OPERATIONS
// ─────────────────────────────────────────────────────────────────
export async function forceSyncFromSupabase() {
  if (!_sb) { toast('Supabase not configured', 'err'); return; }
  setDBStatus('Syncing…', 'warn');
  await syncFromSupabase(false, renderCurrent);
  toast('Synced from Supabase ✓', 'ok');
}

export function confirmClearAll() {
  showAlert('Clear All Data', 'Permanently deletes ALL entries from Supabase. Cannot be undone.', [
    { text: 'Cancel' },
    { text: 'Delete Everything', danger: true, action: async () => {
      if (!_sb) { toast('Not connected', 'err'); return; }
      const { error } = await _sb.from('entries').delete().neq('id', 0);
      if (error) {
        toast(classifySupabaseError(error, 'confirmClearAll'), 'err');
        return;
      }
      const { setCachedEntries, setTotalCount } = await import('../api/db.js');
      setCachedEntries([]); setTotalCount(0);
      await idbSet('entries', []);
      const { renderDashboard } = await import('./dashboard.js');
      renderDashboard();
      toast('All data cleared', 'ok');
      log.warn('All entries cleared by user');
    }},
  ]);
}

// ─────────────────────────────────────────────────────────────────
//  DB INFO PANEL
// ─────────────────────────────────────────────────────────────────
export function renderDBInfo() {
  const url     = localStorage.getItem(SB_URL_KEY) || 'Not configured';
  const project = url.replace('https://','').split('.')[0] + '…';
  const oldest  = _cachedEntries.length
    ? [..._cachedEntries].sort((a,b) => a.cnDate > b.cnDate ? 1 : -1)[0]?.cnDate
    : '—';
  const newest  = _cachedEntries.length ? _cachedEntries[0]?.cnDate : '—';

  const el = document.getElementById('db-info');
  if (!el) return;
  el.innerHTML = `
    <div><b>Engine:</b> Supabase (PostgreSQL)</div>
    <div><b>Cache:</b> IndexedDB (offline copy)</div>
    <div><b>Project:</b> ${esc(project)}</div>
    <div><b>Status:</b> ${_sb ? (_isOnline ? '🟢 Online' : '🟡 Offline (cached)') : '🔴 Not connected'}</div>
    <div><b>Cached Entries:</b> ${_cachedEntries.length}</div>
    <div><b>Oldest Entry:</b> ${oldest || '—'}</div>
    <div><b>Newest Entry:</b> ${newest || '—'}</div>
    <div><b>Privacy PIN:</b> ${pinUnlocked ? '🔓 Unlocked' : '🔐 Locked'}</div>`;
}

// ─────────────────────────────────────────────────────────────────
//  DATABASE MIGRATION  (payment_side column)
// ─────────────────────────────────────────────────────────────────
export async function checkMigrationStatus() {
  const badge  = document.getElementById('migration-badge');
  const runBtn = document.getElementById('migration-run-btn');
  if (!badge) return;

  if (!_sb) {
    badge.textContent = '⚠ Not connected';
    badge.className   = 'migration-badge warn';
    if (runBtn) runBtn.disabled = true;
    return;
  }

  badge.textContent = 'Checking…';
  badge.className   = 'migration-badge warn';

  try {
    const { error } = await _sb.from('entries').select('payment_side').limit(1);
    const missing   = error?.message?.toLowerCase().includes('payment_side');
    if (!missing) {
      badge.textContent = '✓ Column exists — no action needed';
      badge.className   = 'migration-badge ok';
      if (runBtn) runBtn.disabled = true;
      log.info('payment_side column confirmed present');
    } else {
      badge.textContent = '✗ Column missing — run migration';
      badge.className   = 'migration-badge err';
      if (runBtn) runBtn.disabled = false;
      log.warn('payment_side column not found in entries table');
    }
  } catch (e) {
    badge.textContent = '✗ Check failed';
    badge.className   = 'migration-badge err';
    log.error('checkMigrationStatus failed', e);
  }
}

export async function runMigration() {
  const statusEl = document.getElementById('migration-status');
  const runBtn   = document.getElementById('migration-run-btn');
  const badge    = document.getElementById('migration-badge');
  if (!_sb) { toast('Supabase not connected', 'err'); return; }

  if (runBtn) { runBtn.disabled = true; runBtn.textContent = 'Running…'; }
  if (statusEl) statusEl.textContent = '';

  const SQL = `ALTER TABLE entries ADD COLUMN IF NOT EXISTS payment_side TEXT CHECK (payment_side IN ('consignor','consignee'));`;

  // Check if already exists
  try {
    const { error: chk } = await _sb.from('entries').select('payment_side').limit(1);
    if (!chk?.message?.toLowerCase().includes('payment_side')) {
      if (badge)    { badge.textContent = '✓ Column already exists'; badge.className = 'migration-badge ok'; }
      if (runBtn)   { runBtn.disabled = true; runBtn.textContent = 'Run Migration'; }
      if (statusEl) statusEl.textContent = 'Column already exists — no action needed.';
      toast('payment_side column already exists ✓', 'ok');
      return;
    }
  } catch { /* proceed */ }

  // Attempt via RPC
  let migrated = false;
  try {
    const { error: rpcErr } = await _sb.rpc('run_sql', { query: SQL });
    if (!rpcErr) migrated = true;
  } catch { /* rpc not available — show manual SQL */ }

  if (migrated) {
    if (badge)    { badge.textContent = '✓ Migration complete'; badge.className = 'migration-badge ok'; }
    if (runBtn)   { runBtn.disabled = true; runBtn.textContent = 'Run Migration'; }
    if (statusEl) statusEl.textContent = 'payment_side column added successfully.';
    toast('Migration complete ✓', 'ok');
    log.info('payment_side migration ran successfully via RPC');
  } else {
    if (runBtn)  { runBtn.disabled = false; runBtn.textContent = 'Run Migration'; }
    if (badge)   { badge.textContent = '✗ Paste SQL below in Supabase'; badge.className = 'migration-badge err'; }
    if (statusEl) statusEl.innerHTML = `
      <div style="margin-top:.75rem">
        <p style="font-size:.78rem;color:var(--red);font-weight:600;margin-bottom:.5rem">
          ⚠ Automatic migration failed. Paste this SQL in your
          <a href="https://supabase.com/dashboard" target="_blank" rel="noopener" style="color:var(--blue)">Supabase SQL Editor</a>:
        </p>
        <pre style="background:#0f172a;color:#e2e8f0;padding:.875rem;border-radius:.5rem;font-size:.75rem;overflow-x:auto;cursor:copy"
          onclick="navigator.clipboard.writeText(this.textContent).then(()=>this.style.outline='2px solid #22c55e').catch(()=>{})"
          title="Click to copy">${SQL}</pre>
        <p style="font-size:.72rem;color:var(--slate-500);margin-top:.4rem">Click the box to copy. After running, click "Check Status".</p>
      </div>`;
    toast('Copy and run the SQL in Supabase SQL Editor', 'info');
    log.warn('runMigration: RPC unavailable — manual SQL shown to user');
  }
}
