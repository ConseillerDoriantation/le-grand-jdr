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

// Ferme seulement si clic sur l'overlay lui-même (pas sur la modal)
export function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  closeModalDirect();
}

// Ferme toujours — utilisée par le bouton ✕ et Escape
export function closeModalDirect() {
  document.getElementById('modal-overlay')?.classList.remove('show');
}
