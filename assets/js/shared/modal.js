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

// ── Confirmation stylisée — remplace window.confirm() ─────────────────────
// Retourne une Promise<boolean>.
// Usage : if (!await confirmModal('Supprimer ?')) return;
//
// Options :
//   confirmLabel  — texte du bouton de confirmation (défaut : 'Confirmer')
//   cancelLabel   — texte du bouton d'annulation   (défaut : 'Annuler')
//   danger        — true = bouton rouge (défaut : false)
//   icon          — emoji affiché devant le message (défaut : '⚠️')

export function confirmModal(message, {
  confirmLabel = 'Confirmer',
  cancelLabel  = 'Annuler',
  danger       = true,
  icon         = '⚠️',
} = {}) {
  return new Promise((resolve) => {
    const btnColor   = danger ? '#ff6b6b' : 'var(--gold)';
    const btnBg      = danger ? 'rgba(255,107,107,.12)' : 'rgba(79,140,255,.12)';
    const btnBorder  = danger ? 'rgba(255,107,107,.35)' : 'rgba(79,140,255,.35)';

    const bodyHtml = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:1rem;
        padding:.5rem 0 .25rem;text-align:center">
        <div style="font-size:2rem;line-height:1">${icon}</div>
        <div style="font-size:.92rem;color:var(--text-soft);line-height:1.55;
          max-width:320px">${message}</div>
        <div style="display:flex;gap:.6rem;margin-top:.25rem;width:100%">
          <button id="cm-cancel"
            style="flex:1;padding:.55rem 1rem;border-radius:10px;cursor:pointer;
              font-size:.87rem;font-weight:600;
              border:1px solid var(--border-strong);
              background:var(--bg-elevated);color:var(--text-muted);
              transition:background .12s"
            onmouseover="this.style.background='var(--bg-card2)'"
            onmouseout="this.style.background='var(--bg-elevated)'">
            ${cancelLabel}
          </button>
          <button id="cm-confirm"
            style="flex:1;padding:.55rem 1rem;border-radius:10px;cursor:pointer;
              font-size:.87rem;font-weight:700;
              border:1px solid ${btnBorder};
              background:${btnBg};color:${btnColor};
              transition:background .12s"
            onmouseover="this.style.background='${danger ? 'rgba(255,107,107,.22)' : 'rgba(79,140,255,.22)'}'"
            onmouseout="this.style.background='${btnBg}'">
            ${confirmLabel}
          </button>
        </div>
      </div>`;

    // Ouvrir sans titre (masqué) et sans bouton ✕ visible
    const overlay = document.getElementById('modal-overlay');
    const titleEl = document.querySelector('#modal-title span');
    const bodyEl  = document.getElementById('modal-body');
    if (titleEl) titleEl.textContent = '';
    if (bodyEl)  bodyEl.innerHTML = bodyHtml;
    overlay?.classList.add('show');

    const done = (result) => {
      closeModalDirect();
      resolve(result);
    };

    // Boutons
    document.getElementById('cm-confirm')?.addEventListener('click', () => done(true),  { once: true });
    document.getElementById('cm-cancel') ?.addEventListener('click', () => done(false), { once: true });

    // Escape = annuler
    const onKey = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); done(false); } };
    document.addEventListener('keydown', onKey);

    // Clic overlay = annuler
    const onOverlay = (e) => {
      if (e.target === overlay) { overlay.removeEventListener('click', onOverlay); done(false); }
    };
    overlay?.addEventListener('click', onOverlay);
  });
}

// Exposition window pour appels depuis templates inline
window.confirmModal = confirmModal;
