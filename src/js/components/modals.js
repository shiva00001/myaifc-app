/**
 * Alert modal + Import preview modal helpers.
 */

// ── Generic alert modal ───────────────────────────────────────────
export function showAlert(title, msg, buttons = []) {
  document.getElementById('alert-title').textContent = title;
  document.getElementById('alert-msg').textContent   = msg;
  const wrap = document.getElementById('alert-btns');
  wrap.innerHTML = '';
  (buttons.length ? buttons : [{ text: 'OK', primary: true }]).forEach(b => {
    const btn = document.createElement('button');
    btn.textContent = b.text;
    btn.className   = b.danger ? 'btn btn-danger' : b.primary ? 'btn btn-primary' : 'btn btn-ghost';
    btn.onclick = () => { hideAlert(); b.action?.(); };
    wrap.appendChild(btn);
  });
  const ov = document.getElementById('alert-overlay');
  ov.classList.remove('hidden');
  requestAnimationFrame(() => ov.classList.add('open'));
}

export function hideAlert() {
  const ov = document.getElementById('alert-overlay');
  ov.classList.remove('open');
  setTimeout(() => ov.classList.add('hidden'), 220);
}

// ── Import preview modal ──────────────────────────────────────────
export function showImportModal(valid, errors) {
  document.getElementById('imp-summary').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:.5rem;padding:.875rem;text-align:center">
        <div style="font-size:1.8rem;font-weight:700;color:#16a34a">${valid.length}</div>
        <div style="font-size:.7rem;font-weight:600;color:#15803d">Valid rows ready</div>
      </div>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:.5rem;padding:.875rem;text-align:center">
        <div style="font-size:1.8rem;font-weight:700;color:#dc2626">${errors.length}</div>
        <div style="font-size:.7rem;font-weight:600;color:#b91c1c">Rows with errors</div>
      </div>
    </div>`;

  const ew = document.getElementById('imp-err-wrap');
  if (errors.length) {
    ew.style.display = 'block';
    document.getElementById('imp-err-list').innerHTML = errors.map(e => `<div>${e}</div>`).join('');
  } else {
    ew.style.display = 'none';
  }

  const btn = document.getElementById('imp-confirm-btn');
  btn.disabled    = valid.length === 0;
  btn.textContent = `Import ${valid.length} Valid Row${valid.length !== 1 ? 's' : ''}`;

  const ov = document.getElementById('imp-overlay');
  ov.classList.remove('hidden');
  requestAnimationFrame(() => ov.classList.add('open'));
}

export function closeImportModal() {
  const ov = document.getElementById('imp-overlay');
  ov.classList.remove('open');
  setTimeout(() => ov.classList.add('hidden'), 220);
}
