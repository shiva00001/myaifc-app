/**
 * Supabase Auth — sign-in, sign-out, forgot password, set new password.
 */

import { SB_URL_KEY, SB_AKEY_KEY } from '../utils/constants.js';
import { log } from '../utils/logger.js';
import { toast, btnBusy } from '../utils/helpers.js';
import { _sb, setSb, idbGet, syncFromSupabase, setDBStatus } from '../api/db.js';
import { setupDropdowns } from '../components/sidebar.js';
import { navigate } from '../pages/dashboard.js';

export let _currentUser = null;
// ── Brute-force guard: max 5 attempts per 15 minutes ─────────────
const _loginAttempts = { count: 0, lockedUntil: 0 };

function _checkLoginThrottle(errEl) {
  const now = Date.now();
  if (_loginAttempts.lockedUntil > now) {
    const secs = Math.ceil((_loginAttempts.lockedUntil - now) / 1000);
    errEl.textContent = `✗ Too many attempts. Try again in ${secs}s.`;
    return false;
  }
  return true;
}

function _recordLoginFailure(errEl) {
  _loginAttempts.count++;
  if (_loginAttempts.count >= 5) {
    _loginAttempts.lockedUntil = Date.now() + 15 * 60 * 1000; // 15 min
    _loginAttempts.count = 0;
    errEl.textContent = '✗ Too many failed attempts. Locked for 15 minutes.';
  }
}

function _clearLoginFailures() {
  _loginAttempts.count = 0;
  _loginAttempts.lockedUntil = 0;
}



// ── Panel show/hide ───────────────────────────────────────────────
export function lpShowLogin()  { document.getElementById('login-screen').classList.remove('hidden'); }
export function lpHideLogin()  { document.getElementById('login-screen').classList.add('hidden'); }

export function lpShowForgot() {
  document.getElementById('lp-auth-panel').style.display    = 'none';
  document.getElementById('lp-forgot-panel').style.display  = 'block';
}
export function lpHideForgot() {
  document.getElementById('lp-forgot-panel').style.display  = 'none';
  document.getElementById('lp-auth-panel').style.display    = '';
}

// ── Password eye toggle ───────────────────────────────────────────
export function lpToggleEye(inputId) {
  const inp = document.getElementById(inputId);
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

// ── Sign In ───────────────────────────────────────────────────────
export async function lpSignIn() {
  const email = document.getElementById('lp-si-email').value.trim();
  const pass  = document.getElementById('lp-si-pass').value;
  const errEl = document.getElementById('lp-si-err');
  const passEl= document.getElementById('lp-si-pass');
  errEl.textContent = '';

  // Brute-force protection — check before any processing
  if (!_checkLoginThrottle(errEl)) return;

  if (!email || !pass) { errEl.textContent = '✗ Enter your email and password.'; return; }

  // Import lazily to avoid circular deps
  const { _sb: sb } = await import('../api/db.js');
  if (!sb) { errEl.textContent = '✗ Not connected to database. Go to Settings and configure Supabase first.'; return; }

  btnBusy('lp-si-btn', 'lp-si-label', 'lp-si-spin', true);
  passEl.classList.remove('err');

  try {
    const [authResult, cached] = await Promise.all([
      sb.auth.signInWithPassword({ email, password: pass }),
      idbGet('entries').catch(() => null),
    ]);
    const { data, error } = authResult;

    if (error) {
      errEl.textContent = '✗ ' + (error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message);
      passEl.classList.add('err');
      _recordLoginFailure(errEl);
      btnBusy('lp-si-btn', 'lp-si-label', 'lp-si-spin', false);
      return;
    }

    if (cached && cached.length) {
      const { setCachedEntries, setTotalCount } = await import('../api/db.js');
      setCachedEntries(cached); setTotalCount(cached.length);
    }

    fillSidebarUser(data.user);
    _clearLoginFailures();
    lpHideLogin();
    setupDropdowns();
    navigate('dashboard');
    btnBusy('lp-si-btn', 'lp-si-label', 'lp-si-spin', false);
    syncFromSupabase(true).catch(log.error);

  } catch (err) {
    log.error('lpSignIn error:', err);
    errEl.textContent = '✗ Sign-in failed: ' + (err.message || 'Unknown error.');
    btnBusy('lp-si-btn', 'lp-si-label', 'lp-si-spin', false);
  }
}

// ── Forgot password ───────────────────────────────────────────────
export async function lpForgotPassword() {
  const email = document.getElementById('lp-fp-email').value.trim();
  const errEl = document.getElementById('lp-fp-err');
  errEl.textContent = '';
  if (!email) { errEl.textContent = '✗ Enter your email address.'; return; }
  document.getElementById('lp-fp-btn').disabled = true;
  document.getElementById('lp-fp-label').textContent = 'Sending…';
  const redirectTo = window.location.origin + window.location.pathname;
  const { _sb: sb } = await import('../api/db.js');
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    document.getElementById('lp-fp-btn').disabled = false;
    document.getElementById('lp-fp-label').textContent = 'Send Reset Link';
    errEl.textContent = '✗ ' + error.message;
    return;
  }
  document.getElementById('lp-fp-btn').style.display = 'none';
  document.getElementById('lp-fp-success').style.display = 'block';
}

// ── Set new password (after reset email link) ─────────────────────
export function lpShowNewPassPanel() {
  document.getElementById('lp-auth-panel').style.display    = 'none';
  document.getElementById('lp-forgot-panel').style.display  = 'none';
  document.getElementById('lp-newpass-panel').style.display = '';
  const welcome = document.querySelector('#login-screen .lp-form-wrap > div:nth-child(2)');
  if (welcome) welcome.style.display = 'none';
  lpShowLogin();
  document.getElementById('lp-np-pass').value    = '';
  document.getElementById('lp-np-confirm').value = '';
  document.getElementById('lp-np-err').textContent = '';
  document.getElementById('lp-np-strength').style.display = 'none';
  setTimeout(() => document.getElementById('lp-np-pass')?.focus(), 100);
}

export async function lpSetNewPassword() {
  const pass    = document.getElementById('lp-np-pass').value;
  const confirm = document.getElementById('lp-np-confirm').value;
  const errEl   = document.getElementById('lp-np-err');
  errEl.textContent = '';
  if (!pass)            { errEl.textContent = '✗ Enter a new password.'; return; }
  if (pass.length < 8)  { errEl.textContent = '✗ Password must be at least 8 characters.'; return; }
  if (pass !== confirm) { errEl.textContent = '✗ Passwords do not match.'; return; }
  btnBusy('lp-np-btn','lp-np-label','lp-np-spin', true);
  const { _sb: sb } = await import('../api/db.js');
  const { data, error } = await sb.auth.updateUser({ password: pass });
  btnBusy('lp-np-btn','lp-np-label','lp-np-spin', false);
  if (error) { errEl.textContent = '✗ ' + error.message; return; }
  toast('Password updated successfully ✓', 'ok');
  document.getElementById('lp-newpass-panel').style.display = 'none';
  const welcome = document.querySelector('#login-screen .lp-form-wrap > div:nth-child(2)');
  if (welcome) welcome.style.display = '';
  if (data.user) await onSessionRestored(data.user);
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

// ── Sign out ──────────────────────────────────────────────────────
export async function lpSignOut() {
  const { _sb: sb, setCachedEntries, setTotalCount } = await import('../api/db.js');
  if (!sb) return;
  await sb.auth.signOut();
  _currentUser = null;
  setCachedEntries([]); setTotalCount(0);
  document.getElementById('sb-user-row').style.display = 'none';
  lpShowLogin();
  setTimeout(() => document.getElementById('lp-si-email')?.focus(), 80);
}

// ── Fill sidebar user row ─────────────────────────────────────────
export function fillSidebarUser(user) {
  _currentUser = user;
  const email    = user.email || '';
  const initials = (user.user_metadata?.full_name || email).slice(0,2).toUpperCase();
  document.getElementById('sb-avatar-initials').textContent = initials;
  document.getElementById('sb-user-email').textContent      = email;
  document.getElementById('sb-user-row').style.display      = 'flex';
}

// ── After session restored ────────────────────────────────────────
export async function onSessionRestored(user) {
  fillSidebarUser(user);
  lpHideLogin();
  const cached = await idbGet('entries');
  if (cached && cached.length) {
    const { setCachedEntries, setTotalCount } = await import('../api/db.js');
    setCachedEntries(cached); setTotalCount(cached.length);
  }
  setupDropdowns();
  navigate('dashboard');
  syncFromSupabase(true).catch(log.error);
}

// ── Password strength meter ───────────────────────────────────────
export function initPasswordStrength() {
  document.getElementById('lp-np-pass')?.addEventListener('input', function () {
    const val = this.value;
    const str = document.getElementById('lp-np-strength');
    if (!val) { str.style.display = 'none'; return; }
    str.style.display = 'block';
    let score = 0;
    if (val.length >= 8)          score++;
    if (/[A-Z]/.test(val))        score++;
    if (/[0-9]/.test(val))        score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;
    const colours = ['#ef4444','#f59e0b','#3b82f6','#22c55e'];
    const labels  = ['Weak','Fair','Good','Strong'];
    for (let i = 1; i <= 4; i++) {
      document.getElementById('lp-str-' + i).style.background = i <= score ? colours[score-1] : 'rgba(255,255,255,.12)';
    }
    const lbl = document.getElementById('lp-str-label');
    lbl.textContent = labels[score-1] || '';
    lbl.style.color = colours[score-1] || 'rgba(255,255,255,.4)';
  });
}
