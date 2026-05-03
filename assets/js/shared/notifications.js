// ══════════════════════════════════════════════
// NOTIFICATIONS — Toast système
// ══════════════════════════════════════════════

let _timer = null;

export function showNotif(msg, type = 'success') {
  const el = document.getElementById('notif');
  if (!el) return;
  el.textContent = msg;
  el.className   = `notif ${type} show`;
  clearTimeout(_timer);
  _timer = setTimeout(() => el.classList.remove('show'), 3000);
}

/**
 * Loggue une erreur de sauvegarde et affiche un toast.
 * Centralise le pattern try/catch présent dans toutes les features.
 */
export function notifySaveError(e, message = 'Erreur de sauvegarde. Réessaie.') {
  console.error('[save]', e);
  showNotif(message, 'error');
}
