/**
 * main.js — App Entry Point  (production-grade v2)
 *
 * IMPROVEMENTS (all existing behavior preserved):
 *  1. installGlobalErrorHandlers() — catches unhandled rejections silently
 *  2. All console.* replaced with structured log.*
 *  3. scheduleInit uses scheduler API hierarchy correctly
 *  4. Supabase client created with explicit auth options for security
 *  5. Auth state handler guards against unexpected event values
 *  6. SB_URL/KEY validated before createClient to prevent silent bad config
 */

// ── Sentry — production error monitoring ─────────────────────────
import * as Sentry from '@sentry/browser';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn             : SENTRY_DSN,
    environment     : import.meta.env.MODE,
    release         : import.meta.env.VITE_APP_VERSION ?? '1.0.0',
    enabled         : import.meta.env.PROD,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      // Strip PII: remove email from user context
      if (event.user) delete event.user.email;
      return event;
    },
  });
}

import '../styles/main.css';

import { SB_URL_KEY, SB_AKEY_KEY } from './utils/constants.js';
import { log } from './utils/logger.js';
import { installGlobalErrorHandlers } from './utils/error-handler.js';
import { setOnline, setDBStatus, setCachedEntries, setTotalCount } from './api/db.js';
import { openSidebar, closeSidebar, setupDropdowns, wireFilterListeners } from './components/sidebar.js';
import { hideAlert } from './components/modals.js';

// ── Install global error handlers immediately ─────────────────────
installGlobalErrorHandlers();

// ── Lazy module loaders — imported once, cached ───────────────────
const _m = {
  auth     : () => import('./auth/auth.js'),
  pin      : () => import('./auth/pin.js'),
  db       : () => import('./api/db.js'),
  dashboard: () => import('./pages/dashboard.js'),
  receipts : () => import('./pages/receipts.js'),
  reports  : () => import('./pages/reports.js'),
  ledger   : () => import('./pages/ledger.js'),
  settings : () => import('./pages/settings.js'),
  create   : () => import('./pages/create.js'),
  modals   : () => import('./components/modals.js'),
};

const _c = {};
const lazy = async key => (_c[key] ??= await _m[key]());

// ── Global bridge — all onclick handlers route through here ───────
window.__aifc = {
  // Auth
  async lpSignIn()          { (await lazy('auth')).lpSignIn(); },
  async lpForgotPassword()  { (await lazy('auth')).lpForgotPassword(); },
  async lpShowForgot()      { (await lazy('auth')).lpShowForgot(); },
  async lpHideForgot()      { (await lazy('auth')).lpHideForgot(); },
  async lpToggleEye(id)     { (await lazy('auth')).lpToggleEye(id); },
  async lpSetNewPassword()  { (await lazy('auth')).lpSetNewPassword(); },
  async lpSignOut()         { (await lazy('auth')).lpSignOut(); },

  // PIN
  async openPin(cb)    { (await lazy('pin')).openPin(cb); },
  async closePin()     { (await lazy('pin')).closePin(); },
  async pinKey(d)      { (await lazy('pin')).pinKey(d); },
  async pinDel()       { (await lazy('pin')).pinDel(); },
  async togglePrivacy(){ (await lazy('pin')).togglePrivacy(async () => (await lazy('dashboard')).renderCurrent()); },

  // Sidebar
  openSidebar,
  closeSidebar,

  // Navigation
  async navigate(page, filter) { (await lazy('dashboard')).navigate(page, filter); },
  async navigateMonthly()      { (await lazy('dashboard')).navigateMonthly(); },
  async navigatePending()      { (await lazy('dashboard')).navigatePending(); },

  // Receipts
  async exportAll()            { (await lazy('receipts')).exportAll(); },
  async confirmDel(id, cn)     { (await lazy('receipts')).confirmDel(id, cn); },
  async confirmImport()        { (await lazy('receipts')).confirmImport(); },
  async closeImportModal()     { (await lazy('modals')).closeImportModal(); },

  // Create / Edit
  async openEdit(id)           { (await lazy('create')).openEdit(id); },

  // Reports
  async exportFiltered()       { (await lazy('reports')).exportFiltered(); },
  async clearExportFilters()   { (await lazy('reports')).clearExportFilters(); },
  async updateExportPreview()  { (await lazy('reports')).updateExportPreview(); },

  // Smart Ledger — legacy aliases (kept for backward compat with HTML)
  async openLedgerDrawer(n)    { (await lazy('ledger')).slOpenCompany(n); },
  async closeLedgerDrawer()    { (await lazy('ledger')).slBack(); },
  async printPartyLedger()     { (await lazy('ledger')).slPrintCompany(); },
  async sharePartyLedger()     { (await lazy('ledger')).slShareCompany(); },
  async exportLedger()         { (await lazy('ledger')).slExportExcel(); },
  async exportPartyEntries()   { (await lazy('ledger')).slExportExcel(); },

  // Smart Ledger — current API
  async slOpenCompany(n)       { (await lazy('ledger')).slOpenCompany(n); },
  async slBack()               { (await lazy('ledger')).slBack(); },
  async slAddEntry(n)          { (await lazy('ledger')).slAddEntry(n); },
  async slEditEntry(id)        { (await lazy('ledger')).slEditEntry(id); },
  async slDelEntry(id)         { (await lazy('ledger')).slDelEntry(id); },
  async slDelCompany(n)        { (await lazy('ledger')).slDelCompany(n); },
  async slSaveEntry()          { (await lazy('ledger')).slSaveEntry(); },
  async slCloseEntryModal()    { (await lazy('ledger')).slCloseEntryModal(); },
  async slSetSide(s)           { (await lazy('ledger')).slSetSide(s); },
  async slSetFilter(f)         { (await lazy('ledger')).slSetFilter(f); },
  async slSetPayFilter(s)      { (await lazy('ledger')).slSetPayFilter(s); },
  // slSearch must NOT be async — async wrapper breaks the debounce timing
  slSearch(v)                  { lazy('ledger').then(m => m.slSearch(v)); },
  async slApplyDateRange()     { (await lazy('ledger')).slApplyDateRange(); },
  async slClearDateRange()     { (await lazy('ledger')).slClearDateRange(); },
  async slDetailDateFilter()   { (await lazy('ledger')).slDetailDateFilter(); },
  async slDetailDateClear()    { (await lazy('ledger')).slDetailDateClear(); },
  async slPrintCompany(n)      { (await lazy('ledger')).slPrintCompany(n); },
  async slShareCompany(n)      { (await lazy('ledger')).slShareCompany(n); },
  async slExportExcel()        { (await lazy('ledger')).slExportExcel(); },
  async slOpenAddCompany()     { (await lazy('ledger')).slOpenAddCompany(); },
  async slCloseAddCompany()    { (await lazy('ledger')).slCloseAddCompany(); },
  async slSaveCompany()        { (await lazy('ledger')).slSaveCompany(); },
  async slEntryKeydown(e)      { (await lazy('ledger')).slEntryKeydown?.(e); },
  async slCoKeydown(e)         { (await lazy('ledger')).slCoKeydown?.(e); },

  // Settings
  async saveSupabaseConfig()   { (await lazy('settings')).saveSupabaseConfig(); },
  async testConnection()       { (await lazy('settings')).testConnection(); },
  async saveCompanyDetails()   { (await lazy('settings')).saveCompanyDetails(); },
  async changePIN()            { (await lazy('settings')).changePIN(); },
  async forceSyncFromSupabase(){ (await lazy('settings')).forceSyncFromSupabase(); },
  async confirmClearAll()      { (await lazy('settings')).confirmClearAll(); },
  async runMigration()         { (await lazy('settings')).runMigration(); },
  async checkMigrationStatus() { (await lazy('settings')).checkMigrationStatus(); },
};

// ── Sidebar nav click handler ─────────────────────────────────────
document.querySelectorAll('.nav-item[data-page]').forEach(btn =>
  btn.addEventListener('click', () => window.__aifc.navigate(btn.dataset.page))
);

// ── Alert overlay — close on backdrop click ───────────────────────
document.getElementById('alert-overlay')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) hideAlert();
});

// ── Online / offline events ───────────────────────────────────────
window.addEventListener('online', async () => {
  setOnline(true);
  setDBStatus('Back online, syncing…', 'warn');
  log.info('Network back online — flushing offline queue');
  try {
    const { _sb, flushOfflineQueue, syncFromSupabase } = await lazy('db');
    const { renderCurrent } = await lazy('dashboard');
    if (_sb) await flushOfflineQueue(renderCurrent)
               .then(() => syncFromSupabase(true, renderCurrent));
  } catch (err) {
    log.error('Online flush failed', err);
  }
});

window.addEventListener('offline', () => {
  setOnline(false);
  setDBStatus('Offline — using cache', 'warn');
  log.warn('Network went offline');
});

// ─────────────────────────────────────────────────────────────────
//  INIT — two-phase: instant paint → background Supabase init
// ─────────────────────────────────────────────────────────────────

function scheduleInit(fn) {
  if ('scheduler' in window && 'postTask' in window.scheduler) {
    window.scheduler.postTask(fn, { priority: 'background' });
  } else if ('requestIdleCallback' in window) {
    requestIdleCallback(fn, { timeout: 2000 });
  } else {
    setTimeout(fn, 0);
  }
}

(async () => {
  // ── Phase 1: Paint shell immediately (no network, no heavy parse) ──
  const { renderDashboard, navigate, renderCurrent } = await lazy('dashboard');
  const { _renderReceiptsNow } = await lazy('receipts');
  const { renderLedger }       = await lazy('ledger');
  const { updatePLChart }      = await lazy('reports');

  setupDropdowns();
  wireFilterListeners({
    renderDashboard,
    renderReceipts : _renderReceiptsNow,
    updatePLChart,
    renderLedger,
  });

  // Wire form/import listeners lazily — not needed before user navigates there
  lazy('create').then(m => m.initFormListeners()).catch(e => log.error('initFormListeners', e));
  lazy('receipts').then(m => m.initImportListener()).catch(e => log.error('initImportListener', e));
  lazy('auth').then(m => m.initPasswordStrength()).catch(e => log.error('initPasswordStrength', e));

  const url  = localStorage.getItem(SB_URL_KEY);
  const akey = localStorage.getItem(SB_AKEY_KEY);

  if (!url || !akey) {
    // Not configured — show dashboard without auth
    const { lpHideLogin } = await lazy('auth');
    lpHideLogin();
    navigate('dashboard');
    const banner = document.getElementById('sb-banner');
    if (banner) banner.style.display = 'flex';
    setDBStatus('Not configured — go to Settings', 'warn');
    log.warn('Supabase not configured');
    return;
  }

  // ── Phase 2: Init Supabase in background (after paint) ────────────
  scheduleInit(async () => {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const { setSb, syncFromSupabase, idbGet } = await lazy('db');
      const { lpShowLogin, lpShowNewPassPanel, onSessionRestored } = await lazy('auth');

      const sbClient = createClient(url, akey, {
        auth: {
          persistSession   : true,
          autoRefreshToken : true,
          detectSessionInUrl: true,
        },
      });
      setSb(sbClient);

      log.info('Supabase client created');

      // getSession reads from localStorage — no network cost
      const { data: { session }, error: sessErr } = await sbClient.auth.getSession();
      if (sessErr) log.warn('getSession error', sessErr);

      if (session?.user) {
        await onSessionRestored(session.user);
      } else {
        lpShowLogin();
        requestAnimationFrame(() =>
          setTimeout(() => document.getElementById('lp-si-email')?.focus(), 150)
        );
      }

      sbClient.auth.onAuthStateChange(async (event) => {
        log.debug('Auth state change', { event });
        if (event === 'TOKEN_REFRESHED') return;
        if (event === 'PASSWORD_RECOVERY') { lpShowNewPassPanel(); return; }
        if (event === 'SIGNED_OUT') {
          setCachedEntries([]); setTotalCount(0);
          const row = document.getElementById('sb-user-row');
          if (row) row.style.display = 'none';
          lpShowLogin();
        }
      });

    } catch (err) {
      log.error('Supabase init failed', err);
      setDBStatus('Init failed — check Settings', 'err');
    }
  });
})();
