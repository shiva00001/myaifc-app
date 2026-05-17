/**
 * 4-digit privacy PIN system.
 * Protects financial columns (TBB, Balance, Income).
 * Auto-locks after PIN_TIMEOUT ms of inactivity.
 */

import { PIN_TIMEOUT } from '../utils/constants.js';

export let pinUnlocked = false;
let pinTimer    = null;
let pinCallback = null;
let pinEntry    = '';

export function getPin() { return localStorage.getItem('aifc_pin') || '1234'; }

export function openPin(cb) {
  pinCallback = cb;
  pinEntry    = '';
  updatePinDots();
  document.getElementById('pin-err').textContent = '';
  document.getElementById('pin-overlay').classList.add('open');
}

export function closePin() {
  document.getElementById('pin-overlay').classList.remove('open');
  pinCallback = null;
  pinEntry    = '';
}

export function pinKey(d) {
  if (pinEntry.length >= 4) return;
  pinEntry += d;
  updatePinDots();
  if (pinEntry.length === 4) {
    setTimeout(() => {
      if (pinEntry === getPin()) {
        const cb = pinCallback;
        closePin();
        cb?.();
      } else {
        document.getElementById('pin-err').textContent = 'Incorrect PIN. Try again.';
        document.querySelectorAll('.pin-dot').forEach(d => {
          d.classList.add('error');
          setTimeout(() => d.classList.remove('error'), 400);
        });
        pinEntry = '';
        setTimeout(() => updatePinDots(), 400);
      }
    }, 120);
  }
}

export function pinDel() {
  if (pinEntry.length) pinEntry = pinEntry.slice(0, -1);
  updatePinDots();
}

function updatePinDots() {
  document.querySelectorAll('.pin-dot').forEach((d, i) => d.classList.toggle('filled', i < pinEntry.length));
}

// ── Unlock / lock ─────────────────────────────────────────────────
export function unlockPrivacy(renderCb) {
  pinUnlocked = true;
  clearTimeout(pinTimer);
  pinTimer = setTimeout(() => { pinUnlocked = false; renderCb?.(); }, PIN_TIMEOUT);
  renderCb?.();
  _setLockIcon(true);
}

export function lockPrivacy(renderCb) {
  pinUnlocked = false;
  clearTimeout(pinTimer);
  renderCb?.();
  _setLockIcon(false);
}

export function togglePrivacy(renderCb) {
  if (pinUnlocked) lockPrivacy(renderCb);
  else openPin(() => unlockPrivacy(renderCb));
}

function _setLockIcon(unlocked) {
  const ic = document.getElementById('lock-icon');
  if (!ic) return;
  ic.innerHTML = unlocked
    ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 11V7a4 4 0 018 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"/>'
    : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>';
}

// ── Change PIN (Settings page) ────────────────────────────────────
export function changePIN() {
  const cur = document.getElementById('s-cur-pin').value;
  const nw  = document.getElementById('s-new-pin').value;
  const cf  = document.getElementById('s-confirm-pin').value;
  const { toast } = window; // accessed via global in settings context

  import('../utils/helpers.js').then(({ toast }) => {
    if (cur !== getPin())          { toast('Current PIN is incorrect', 'err'); return; }
    if (!/^\d{4}$/.test(nw))       { toast('New PIN must be exactly 4 digits', 'err'); return; }
    if (nw !== cf)                 { toast('PINs do not match', 'err'); return; }
    localStorage.setItem('aifc_pin', nw);
    ['s-cur-pin','s-new-pin','s-confirm-pin'].forEach(id => document.getElementById(id).value = '');
    toast('PIN updated successfully', 'ok');
  });
}
