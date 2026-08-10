// ══════════════════════════════════════════════
// NOTIFICATIONS — Toast système
// ══════════════════════════════════════════════

import { STATE } from '../core/state.js';
import { lsJson } from './local-storage.js';

let _timer = null;
const HISTORY_LIMIT = 30;

function _historyKey() {
  return `jdr-notifications:${STATE.user?.uid || 'anonymous'}:${STATE.adventure?.id || 'global'}`;
}

function _readKey() {
  return `${_historyKey()}:read`;
}

function _dispatchHistoryChanged() {
  if (typeof document.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    document.dispatchEvent(new CustomEvent('app:notifications-changed', {
      detail: { key: _historyKey() },
    }));
  }
}

export function getNotificationHistory() {
  return lsJson.get(_historyKey(), []) || [];
}

export function getUnreadNotificationCount() {
  const readAt = Number(lsJson.get(_readKey(), 0)) || 0;
  return getNotificationHistory().filter(item => Number(item.at) > readAt).length;
}

export function markNotificationsRead() {
  const newestAt = Number(getNotificationHistory()[0]?.at) || Date.now();
  lsJson.set(_readKey(), newestAt);
  _dispatchHistoryChanged();
}

export function clearNotificationHistory() {
  lsJson.set(_historyKey(), []);
  lsJson.set(_readKey(), Date.now());
  _dispatchHistoryChanged();
}

function _recordNotification(msg, type) {
  const message = String(msg || '').trim();
  if (!message) return;
  const history = getNotificationHistory();
  const previous = history[0];
  const now = Date.now();
  if (previous?.message === message && previous?.type === type && now - previous.at < 2000) return;
  const normalizedType = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';
  history.unshift({ id: `${now}-${Math.random().toString(36).slice(2, 7)}`, message, type: normalizedType, at: now });
  lsJson.set(_historyKey(), history.slice(0, HISTORY_LIMIT));
  _dispatchHistoryChanged();
}

/**
 * Toast. `opts` (optionnel) :
 *   action   — { label, onClick } : bouton d'action dans le toast (ex. « ↺ Annuler »)
 *   duration — durée d'affichage en ms (défaut 3000)
 */
export function showNotif(msg, type = 'success', opts = {}) {
  const el = document.getElementById('notif');
  if (!el) return;
  if (opts.history !== false) _recordNotification(msg, type);
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
      Promise.resolve(opts.action.onClick()).catch(err => notifySaveError(err, "L'action n'a pas pu être annulée."));
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
