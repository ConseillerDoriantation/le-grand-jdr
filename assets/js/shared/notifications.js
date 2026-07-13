// ══════════════════════════════════════════════
// NOTIFICATIONS — Toast système
// ══════════════════════════════════════════════

let _timer = null;

/**
 * Toast. `opts` (optionnel) :
 *   action   — { label, onClick } : bouton d'action dans le toast (ex. « ↺ Annuler »)
 *   duration — durée d'affichage en ms (défaut 3000)
 */
export function showNotif(msg, type = 'success', opts = {}) {
  const el = document.getElementById('notif');
  if (!el) return;
  el.textContent = msg;
  if (opts.action?.label && typeof opts.action.onClick === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'notif-action';
    btn.textContent = opts.action.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearTimeout(_timer);
      el.classList.remove('show');
      opts.action.onClick();
    }, { once: true });
    el.appendChild(btn);
  }
  el.className   = `notif ${type} show`;
  clearTimeout(_timer);
  _timer = setTimeout(() => el.classList.remove('show'), opts.duration || 3000);
}

/**
 * Loggue une erreur de sauvegarde et affiche un toast.
 * Centralise le pattern try/catch présent dans toutes les features.
 * Si l'erreur a un code Firebase reconnaissable, le toast l'expose pour aider au diag.
 */
export function notifySaveError(e, message = 'Erreur de sauvegarde. Réessaie.') {
  console.error('[save]', e);
  // Détection des causes fréquentes pour un toast plus parlant
  const raw = String(e?.message || e || '').toLowerCase();
  const code = e?.code || '';
  let hint = '';
  if (code === 'permission-denied' || raw.includes('permission-denied')) {
    hint = 'Permissions Firestore insuffisantes.';
  } else if (raw.includes('size') && (raw.includes('1 mib') || raw.includes('limit') || raw.includes('1048487'))) {
    hint = 'Document trop volumineux (limite Firestore 1 MiB) — réduis l\'inventaire ou les notes.';
  } else if (code === 'unavailable' || raw.includes('offline') || raw.includes('unavailable')) {
    hint = 'Hors-ligne ou serveur indisponible.';
  } else if (code === 'invalid-argument' || raw.includes('nested arrays') || raw.includes('invalid data')) {
    hint = 'Données invalides (tableaux imbriqués ou champ corrompu).';
  } else if (code) {
    hint = `(${code})`;
  }
  showNotif(hint ? `${message} ${hint}` : message, 'error');
}
