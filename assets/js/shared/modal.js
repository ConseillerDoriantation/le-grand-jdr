// ══════════════════════════════════════════════
// MODAL — Composant partagé
// ══════════════════════════════════════════════

export function openModal(title, bodyHtml) {
  const titleEl = document.querySelector('#modal-title span');
  const bodyEl  = document.getElementById('modal-body');
  const overlay = document.getElementById('modal-overlay');
  if (titleEl) titleEl.textContent = title;
  if (bodyEl)  bodyEl.innerHTML    = bodyHtml;
  overlay?.classList.add('show');
}

export function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay')?.classList.remove('show');
}

export function closeModalDirect() {
  document.getElementById('modal-overlay')?.classList.remove('show');
}
