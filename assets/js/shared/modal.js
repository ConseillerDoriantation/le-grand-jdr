// ══════════════════════════════════════════════
// MODAL — Composant partagé
// ══════════════════════════════════════════════

import { _esc } from './html.js';

const _modalStack = [];
let _activeDismiss = null;

// ── Garde de fermeture (opt-in) ─────────────────────────────────────────────
// Une feature peut poser un « garde » consulté par closeModalDirect lorsque la
// modale de fond va réellement être fermée (✕, Échap, clic overlay). Les couches
// empilées (confirmation, prompt…) sont toujours dépilées avant de consulter ce
// garde. Le garde renvoie `true` pour BLOQUER la fermeture (il gère lui-même la
// confirmation), `false`/rien pour laisser fermer.
// Réinitialisé à chaque nouvelle modale de base (openModal) pour éviter un garde
// périmé qui bloquerait une modale sans rapport.
let _closeGuard = null;
export function setModalCloseGuard(fn) { _closeGuard = typeof fn === 'function' ? fn : null; }
export function clearModalCloseGuard() { _closeGuard = null; }

function _dismissActiveLayer() {
  const dismiss = _activeDismiss;
  _activeDismiss = null;
  if (typeof dismiss === 'function') {
    try { dismiss(); } catch { /* la fermeture de la modale doit rester possible */ }
  }
}

function _dismissAllLayers() {
  _dismissActiveLayer();
  for (let i = _modalStack.length - 1; i >= 0; i--) {
    const dismiss = _modalStack[i]?.dismiss;
    if (typeof dismiss === 'function') {
      try { dismiss(); } catch { /* idem */ }
    }
  }
  _modalStack.length = 0;
}

// Construit l'en-tête de la modale de base. Sans `opts` → titre texte simple
// (comportement historique). Avec `opts.icon`/`opts.subtitle`/`opts.accent` →
// en-tête « riche » (tuile d'icône lumineuse + titre Cinzel + sous-titre),
// le même langage visuel que les modales admin, mais sur le chrome de base.
// Détecte un emoji en tête de titre (gère séquences ZWJ + sélecteurs de variation)
// pour le transformer en tuile d'icône. Retourne [icon, reste] ou ['', titre].
function _splitLeadingEmoji(title) {
  const m = String(title || '').match(/^(\p{Extended_Pictographic}(?:[‍️⃣]\p{Extended_Pictographic}?)*)\s+(.+)$/u);
  return m ? [m[1], m[2]] : ['', String(title || '')];
}

function _applyModalHeader(title, opts = {}) {
  const titleEl = document.querySelector('#modal-title span');
  const bar = document.getElementById('modal-title');
  if (!titleEl) return;
  if (bar) bar.dataset.title = title || '';   // titre brut (pour push/pop)
  // Icône explicite (opts) sinon emoji de tête auto-extrait du titre.
  let icon = opts.icon || '';
  let text = title || '';
  if (!icon) { const [e, rest] = _splitLeadingEmoji(text); if (e) { icon = e; text = rest; } }
  if (bar) {
    if (opts.accent) bar.style.setProperty('--modal-accent', opts.accent);
    else bar.style.removeProperty('--modal-accent');
  }
  if (icon || opts.subtitle) {
    bar?.classList.add('is-rich');
    titleEl.innerHTML = `
      ${icon ? `<span class="modal-head-ico">${_esc(icon)}</span>` : ''}
      <span class="modal-head-tt">
        <span class="modal-head-title">${_esc(text)}</span>
        ${opts.subtitle ? `<small>${_esc(opts.subtitle)}</small>` : ''}
      </span>`;
  } else {
    bar?.classList.remove('is-rich');
    titleEl.textContent = text;
  }
}

// Section en carte teintée pour structurer le corps d'une modale (langage admin).
// `title` peut contenir une icône/HTML maîtrisé par l'appelant (non échappé).
export function modalSection(title, html) {
  return `<div class="modal-section"><div class="modal-section-title">${title}</div>${html}</div>`;
}

// ── Accessibilité (rôle dialog + retour de focus + piège Tab) ────────────────
// Le focus revient à l'élément actif AVANT l'ouverture quand la modale se ferme
// pour de bon ; Tab boucle à l'intérieur de la modale tant qu'elle est visible.
let _lastFocus = null;
function _a11yOnShow() {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay) return;
  if (!overlay.classList.contains('show')) _lastFocus = document.activeElement;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'modal-title');
}
function _a11yOnClose() {
  if (_lastFocus && typeof _lastFocus.focus === 'function' && document.contains(_lastFocus)) {
    try { _lastFocus.focus(); } catch { /* élément non focalisable */ }
  }
  _lastFocus = null;
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const overlay = document.getElementById('modal-overlay');
  if (!overlay?.classList.contains('show')) return;
  const foc = overlay.querySelectorAll(
    'a[href], button:not([disabled]), textarea, input:not([type="hidden"]), select, [tabindex]:not([tabindex="-1"])');
  if (!foc.length) return;
  const first = foc[0], last = foc[foc.length - 1];
  const inside = overlay.contains(document.activeElement);
  if (e.shiftKey && (!inside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
});

export function openModal(title, bodyHtml, opts = {}) {
  _dismissAllLayers();
  _closeGuard = null;   // nouvelle modale de base → aucun garde hérité
  _a11yOnShow();
  _applyModalHeader(title, opts);
  const bodyEl  = document.getElementById('modal-body');
  const overlay = document.getElementById('modal-overlay');
  if (bodyEl)  bodyEl.innerHTML    = bodyHtml;
  overlay?.classList.add('show');
}

export function pushModal(title, bodyHtml, restore = null, opts = {}) {
  const bodyEl  = document.getElementById('modal-body');
  const bar     = document.getElementById('modal-title');
  const overlay = document.getElementById('modal-overlay');

  const isLayered = !!(bodyEl && overlay?.classList.contains('show'));
  _a11yOnShow();
  if (isLayered) {
    _modalStack.push({
      title: bar?.dataset.title || '',   // titre brut (cf. _applyModalHeader)
      body: bodyEl.innerHTML || '',
      restore,
      dismiss: _activeDismiss,
    });
  } else {
    // pushModal sert aussi à ouvrir confirmModal/promptModal sans modale de fond.
    // Dans ce cas il s'agit d'une nouvelle base : aucun garde/état périmé ne doit
    // survivre à la modale précédemment fermée.
    _dismissAllLayers();
    _closeGuard = null;
  }
  _activeDismiss = typeof opts.onDismiss === 'function' ? opts.onDismiss : null;

  _applyModalHeader(title, opts);
  if (bodyEl)  bodyEl.innerHTML    = bodyHtml;
  overlay?.classList.add('show');
}

export function popModal() {
  if (_modalStack.length === 0) {
    closeModalDirect();
    return;
  }

  const previous = _modalStack.pop();
  _dismissActiveLayer();
  const bodyEl  = document.getElementById('modal-body');
  _applyModalHeader(previous.title);
  if (bodyEl)  bodyEl.innerHTML    = previous.body;
  _activeDismiss = previous.dismiss || null;
  if (typeof previous.restore === 'function') {
    previous.restore();
  }
}

export function updateModalContent(title, bodyHtml, opts = {}) {
  const bodyEl  = document.getElementById('modal-body');
  _applyModalHeader(title, opts);
  if (bodyEl)  bodyEl.innerHTML    = bodyHtml;
}

// Ferme seulement si clic sur l'overlay lui-même (pas sur la modal)
export function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  closeModalDirect();
}

// Ferme toujours — utilisée par le bouton ✕ et Escape
export function closeModalDirect() {
  // Une confirmation/prompt au-dessus de la modale de fond se ferme sans jamais
  // déclencher la garde de cette dernière.
  if (_modalStack.length > 0) {
    return popModal();
  }
  // Garde opt-in : si posé et qu'il renvoie true, la fermeture est bloquée
  // (le garde gère sa propre confirmation puis rappellera closeModalDirect).
  if (_closeGuard) {
    let blocked = false;
    try { blocked = _closeGuard() === true; } catch { blocked = false; }
    if (blocked) return;
  }
  _dismissActiveLayer();
  _closeGuard = null;
  document.getElementById('modal-overlay')?.classList.remove('show');
  _a11yOnClose();
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
            data-hov-bg="${danger ? 'rgba(255,107,107,.22)' : 'rgba(79,140,255,.22)'}">
            ${confirmLabel}
          </button>
          <button id="cm-cancel"
            style="flex:1;padding:.55rem 1rem;border-radius:10px;cursor:pointer;
              font-size:.87rem;font-weight:600;
              border:1px solid var(--border-strong);
              background:var(--bg-elevated);color:var(--text-muted);
              transition:background .12s"
            data-hov-bg="var(--bg-card2)">
            ${cancelLabel}
          </button>
        </div>
      </div>`;

    const overlay = document.getElementById('modal-overlay');
    let settled = false;

    const cleanup = () => {
      document.removeEventListener('keydown', onKey, true);
      overlay?.removeEventListener('click', onOverlay, true);
    };
    const settle = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const done = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      closeModalDirect();
      resolve(result);
    };

    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      done(false);
    };
    const onOverlay = (e) => {
      if (e.target !== overlay) return;
      e.stopImmediatePropagation();
      done(false);
    };

    pushModal(title || '', bodyHtml, null, { onDismiss: () => settle(false) });

    // Boutons
    document.getElementById('cm-confirm')?.addEventListener('click', () => done(true),  { once: true });
    document.getElementById('cm-cancel') ?.addEventListener('click', () => done(false), { once: true });

    // Escape = annuler. Capture l'événement avant le gestionnaire global pour
    // qu'une seule couche soit fermée.
    document.addEventListener('keydown', onKey, true);

    // Clic overlay = annuler, avec la même protection contre la double fermeture.
    overlay?.addEventListener('click', onOverlay, true);
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
            data-hov-bg="rgba(79,140,255,.22)">${confirmLabel}</button>
          <button id="pm-cancel"
            style="flex:1;padding:.55rem 1rem;border-radius:10px;cursor:pointer;font-size:.87rem;
              font-weight:600;border:1px solid var(--border-strong);
              background:var(--bg-elevated);color:var(--text-muted);transition:background .12s"
            data-hov-bg="var(--bg-card2)">${cancelLabel}</button>
        </div>
      </div>`;

    const overlay = document.getElementById('modal-overlay');
    let settled = false;
    let onKey = null;
    let onOverlay = null;

    const cleanup = () => {
      if (onKey) document.removeEventListener('keydown', onKey, true);
      if (onOverlay) overlay?.removeEventListener('click', onOverlay, true);
    };
    const settle = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    pushModal(title || '', bodyHtml, null, { onDismiss: () => settle(null) });

    const input = document.getElementById('pm-input');
    const confirmBtn = document.getElementById('pm-confirm');

    const syncRequired = () => {
      if (!required || !confirmBtn) return;
      const empty = !(input?.value || '').trim();
      confirmBtn.disabled = empty;
      confirmBtn.style.opacity = empty ? '.5' : '1';
      confirmBtn.style.cursor = empty ? 'not-allowed' : 'pointer';
    };

    const done = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      closeModalDirect();
      resolve(result);
    };
    const submit = () => {
      const v = input?.value ?? '';
      if (required && !v.trim()) return;
      done(v);
    };

    onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        done(null);
      }
      else if (e.key === 'Enter' && !multiline) { e.preventDefault(); submit(); }
    };
    onOverlay = (e) => {
      if (e.target !== overlay) return;
      e.stopImmediatePropagation();
      done(null);
    };

    confirmBtn?.addEventListener('click', submit);
    document.getElementById('pm-cancel')?.addEventListener('click', () => done(null));
    input?.addEventListener('input', syncRequired);
    document.addEventListener('keydown', onKey, true);
    overlay?.addEventListener('click', onOverlay, true);

    syncRequired();
    // Focus + sélection après le rendu de la modale.
    requestAnimationFrame(() => { input?.focus(); if (!multiline) input?.select?.(); });
  });
}

// Exposition window pour appels depuis templates inline
