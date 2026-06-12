// ══════════════════════════════════════════════
// MODAL — Composant partagé
// ══════════════════════════════════════════════

import { _esc } from './html.js';

const _modalStack = [];

export function openModal(title, bodyHtml) {
  _modalStack.length = 0;
  const titleEl = document.querySelector('#modal-title span');
  const bodyEl  = document.getElementById('modal-body');
  const overlay = document.getElementById('modal-overlay');
  if (titleEl) titleEl.textContent = title;
  if (bodyEl)  bodyEl.innerHTML    = bodyHtml;
  overlay?.classList.add('show');
}

export function pushModal(title, bodyHtml, restore = null) {
  const titleEl = document.querySelector('#modal-title span');
  const bodyEl  = document.getElementById('modal-body');
  const overlay = document.getElementById('modal-overlay');

  if (titleEl && bodyEl && overlay?.classList.contains('show')) {
    _modalStack.push({
      title: titleEl.textContent || '',
      body: bodyEl.innerHTML || '',
      restore,
    });
  }

  if (titleEl) titleEl.textContent = title;
  if (bodyEl)  bodyEl.innerHTML    = bodyHtml;
  overlay?.classList.add('show');
}

export function popModal() {
  if (_modalStack.length === 0) {
    closeModalDirect();
    return;
  }

  const previous = _modalStack.pop();
  const titleEl = document.querySelector('#modal-title span');
  const bodyEl  = document.getElementById('modal-body');
  if (titleEl) titleEl.textContent = previous.title;
  if (bodyEl)  bodyEl.innerHTML    = previous.body;
  if (typeof previous.restore === 'function') {
    previous.restore();
  }
}

export function updateModalContent(title, bodyHtml) {
  const titleEl = document.querySelector('#modal-title span');
  const bodyEl  = document.getElementById('modal-body');
  if (titleEl) titleEl.textContent = title;
  if (bodyEl)  bodyEl.innerHTML    = bodyHtml;
}

// Ferme seulement si clic sur l'overlay lui-même (pas sur la modal)
export function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  closeModalDirect();
}

// Ferme toujours — utilisée par le bouton ✕ et Escape
export function closeModalDirect() {
  if (_modalStack.length > 0) {
    return popModal();
  }
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
  title = '',
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
        </div>
      </div>`;

    const overlay = document.getElementById('modal-overlay');
    pushModal(title || '', bodyHtml);

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

// ── Saisie stylisée — remplace window.prompt() ────────────────────────────
// Retourne une Promise<string|null> (null = annulé, jamais '' sur annulation).
// Usage : const nom = await promptModal('Nom du son :', { default: s.nom });
//         if (nom == null) return;            // annulé
//
// Options :
//   title        — titre de la modale (défaut : '')
//   default      — valeur pré-remplie (défaut : '')
//   placeholder  — placeholder du champ
//   confirmLabel — bouton de validation (défaut : 'Valider')
//   cancelLabel  — bouton d'annulation  (défaut : 'Annuler')
//   multiline    — true = textarea (Entrée = saut de ligne, pas validation)
//   required     — true = bouton désactivé tant que le champ est vide

export function promptModal(label, {
  title        = '',
  default: defaultValue = '',
  placeholder  = '',
  confirmLabel = 'Valider',
  cancelLabel  = 'Annuler',
  multiline    = false,
  required     = false,
} = {}) {
  return new Promise((resolve) => {
    const fieldStyle = `width:100%;box-sizing:border-box;padding:.55rem .7rem;border-radius:10px;
      border:1px solid var(--border-strong);background:var(--bg-elevated);color:var(--text);
      font-size:.9rem;font-family:inherit`;
    const field = multiline
      ? `<textarea id="pm-input" rows="3" placeholder="${_esc(placeholder)}"
           style="${fieldStyle};resize:vertical;min-height:64px">${_esc(defaultValue)}</textarea>`
      : `<input id="pm-input" type="text" value="${_esc(defaultValue)}" placeholder="${_esc(placeholder)}"
           autocomplete="off" style="${fieldStyle}">`;

    const bodyHtml = `
      <div style="display:flex;flex-direction:column;gap:.8rem;padding:.25rem 0">
        ${label ? `<label for="pm-input" style="font-size:.9rem;color:var(--text-soft);line-height:1.5">${label}</label>` : ''}
        ${field}
        <div style="display:flex;gap:.6rem;margin-top:.1rem">
          <button id="pm-confirm"
            style="flex:1;padding:.55rem 1rem;border-radius:10px;cursor:pointer;font-size:.87rem;
              font-weight:700;border:1px solid rgba(79,140,255,.35);
              background:rgba(79,140,255,.12);color:var(--gold);transition:background .12s,opacity .12s"
            onmouseover="this.style.background='rgba(79,140,255,.22)'"
            onmouseout="this.style.background='rgba(79,140,255,.12)'">${confirmLabel}</button>
          <button id="pm-cancel"
            style="flex:1;padding:.55rem 1rem;border-radius:10px;cursor:pointer;font-size:.87rem;
              font-weight:600;border:1px solid var(--border-strong);
              background:var(--bg-elevated);color:var(--text-muted);transition:background .12s"
            onmouseover="this.style.background='var(--bg-card2)'"
            onmouseout="this.style.background='var(--bg-elevated)'">${cancelLabel}</button>
        </div>
      </div>`;

    const overlay = document.getElementById('modal-overlay');
    pushModal(title || '', bodyHtml);

    const input = document.getElementById('pm-input');
    const confirmBtn = document.getElementById('pm-confirm');

    const syncRequired = () => {
      if (!required || !confirmBtn) return;
      const empty = !(input?.value || '').trim();
      confirmBtn.disabled = empty;
      confirmBtn.style.opacity = empty ? '.5' : '1';
      confirmBtn.style.cursor = empty ? 'not-allowed' : 'pointer';
    };

    const cleanup = () => {
      document.removeEventListener('keydown', onKey);
      overlay?.removeEventListener('click', onOverlay);
    };
    const done = (result) => { cleanup(); closeModalDirect(); resolve(result); };
    const submit = () => {
      const v = input?.value ?? '';
      if (required && !v.trim()) return;
      done(v);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(null); }
      else if (e.key === 'Enter' && !multiline) { e.preventDefault(); submit(); }
    };
    const onOverlay = (e) => { if (e.target === overlay) done(null); };

    confirmBtn?.addEventListener('click', submit);
    document.getElementById('pm-cancel')?.addEventListener('click', () => done(null));
    input?.addEventListener('input', syncRequired);
    document.addEventListener('keydown', onKey);
    overlay?.addEventListener('click', onOverlay);

    syncRequired();
    // Focus + sélection après le rendu de la modale.
    requestAnimationFrame(() => { input?.focus(); if (!multiline) input?.select?.(); });
  });
}

// Exposition window pour appels depuis templates inline
