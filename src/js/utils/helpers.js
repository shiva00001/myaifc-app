import { MONTHS_SHORT } from './constants.js';

// ── Debounce ──────────────────────────────────────────────────────
export function debounce(fn, ms) {
  let t;
  return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
}

// ── Cached number formatters (constructed once) ───────────────────
export const _INR = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const _NUM = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

// ── HTML escape — char map avoids 4 regex passes ──────────────────
const _ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc = v => v == null ? '' : String(v).replace(/[&<>"]/g, c => _ESC[c]);

// ── Currency formatter (with privacy lock) ────────────────────────
export function fmtCur(v, priv = false, pinUnlocked = true) {
  if (priv && !pinUnlocked) return '<span class="private-cell">₹ ••••••</span>';
  const n = parseFloat(v);
  return (isNaN(n) || v === null || v === '') ? '—' : '₹' + _INR.format(n);
}

// ── Number formatter ──────────────────────────────────────────────
export function fmtNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? '—' : _NUM.format(n);
}

// ── Date parser — fast ISO short-circuit, no regex on happy path ──
export function parseDate(s) {
  if (!s) return '';
  s = String(s).trim();
  // Fast path: already ISO yyyy-mm-dd
  if (s.length === 10 && s[4] === '-' && s[7] === '-') return s;
  const m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
  if (m) {
    const d = m[1].padStart(2, '0'), mo = m[2].padStart(2, '0');
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${mo}-${d}`;
  }
  const n = parseInt(s, 10);
  if (!isNaN(n) && n > 40000 && n < 60000) {
    return new Date((n - 25569) * 864e5).toISOString().slice(0, 10);
  }
  return s;
}

// ── ISO timestamp ─────────────────────────────────────────────────
export const nowStr = () => new Date().toISOString();

// ── Export filename builder ───────────────────────────────────────
export function buildExportFilename(co, m, y, st) {
  const parts = ['AIFC'];
  if (co) parts.push(co.replace(/[^a-z0-9]/gi, '_').slice(0, 20));
  if (m !== '' && m != null) parts.push(MONTHS_SHORT[parseInt(m, 10)]);
  if (y) parts.push(y);
  if (st) parts.push(st);
  return parts.join('_') + '.xlsx';
}

// ── Toast — rAF keeps DOM write off critical path ─────────────────
export function toast(msg, type = 'ok') {
  requestAnimationFrame(() => {
    const el = document.createElement('div');
    el.className = `toast t-${type}`;
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), 3200);
  });
}

// ── Button busy state ─────────────────────────────────────────────
export function btnBusy(btnId, labelId, spinId, busy) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = busy;
  if (labelId) document.getElementById(labelId).style.opacity = busy ? '0' : '1';
  if (spinId)  document.getElementById(spinId).style.display  = busy ? 'inline' : 'none';
}

// ── Normalise key for field mapping ──────────────────────────────
export const nk = s => String(s || '').toLowerCase().replace(/[\s._\-\/\\()']+/g, '');

// ── CSV line parser ───────────────────────────────────────────────
export function parseCSVLine(line) {
  const res = []; let field = '', inQ = false;
  for (let i = 0, len = line.length; i < len; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i+1] === '"') { field += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { res.push(field.trim()); field = ''; }
    else field += c;
  }
  res.push(field.trim());
  return res;
}
