// ══════════════════════════════════════════════
// NOTIFICATIONS — Toast système
// ══════════════════════════════════════════════

import { STATE } from '../core/state.js';
import { lsJson } from './local-storage.js';

let _timer = null;
let _hideAt = 0;
let _remaining = 0;
let _activeToastAction = null;
const HISTORY_LIMIT = 30;

function _hideToast(el) {
  clearTimeout(_timer);
  _timer = null;
  _hideAt = 0;
  _remaining = 0;
  _activeToastAction = null;
  el?.classList.remove('show');
}

function _scheduleHide(el, duration) {
  clearTimeout(_timer);
  _remaining = Math.max(300, Number(duration) || 3000);
  _hideAt = Date.now() + _remaining;
  _timer = setTimeout(() => _hideToast(el), _remaining);
}

function _pauseHide() {
  if (!_timer) return;
  _remaining = Math.max(300, _hideAt - Date.now());
  clearTimeout(_timer);
  _timer = null;
}

function _resumeHide(el) {
  if (_timer || !el?.classList.contains('show')) return;
  _scheduleHide(el, _remaining || 1200);
}

function _bindToastQol(el) {
  if (el.dataset.qolBound === 'true') return;
  el.dataset.qolBound = 'true';
  el.setAttribute('aria-atomic', 'true');
  el.addEventListener('mouseenter', _pauseHide);
  el.addEventListener('mouseleave', () => _resumeHide(el));
  el.addEventListener('focusin', _pauseHide);
  el.addEventListener('focusout', (event) => {
    if (!el.contains(event.relatedTarget)) _resumeHide(el);
  });
}

function _runToastAction(el) {
  const action = _activeToastAction;
  if (!action || !el?.classList.contains('show')) return false;
  _activeToastAction = null;
  _hideToast(el);
  Promise.resolve(action()).catch(err => notifySaveError(err, "L'action n'a pas pu être annulée."));
  return true;
}

export function triggerLatestNotificationAction() {
  return _runToastAction(document.getElementById('notif'));
}

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
  _bindToastQol(el);
  if (opts.history !== false) _recordNotification(msg, type);
  el.textContent = msg;
  _activeToastAction = typeof opts.action?.onClick === 'function' ? opts.action.onClick : null;
  if (opts.action?.label && typeof opts.action.onClick === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'notif-action';
    btn.textContent = opts.action.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _runToastAction(el);
    }, { once: true });
    el.appendChild(btn);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'notif-close';
  close.setAttribute('aria-label', 'Fermer la notification');
  close.title = 'Fermer';
  close.textContent = '×';
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    _hideToast(el);
  }, { once: true });
  el.appendChild(close);
  el.className   = `notif ${type} show`;
  _scheduleHide(el, opts.duration || 3000);
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
