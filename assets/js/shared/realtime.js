// ══════════════════════════════════════════════════════════════════════════════
// REALTIME.JS — Gestionnaire d'abonnements Firestore temps réel
//
// Usage :
//   watch('quests', 'quests', data => renderQuests(data));
//   watchDoc('world', 'world', 'main', data => renderWorld(data));
//   unwatchAll(); // appelé automatiquement à chaque navigation
//
// Si la collection / doc est déjà couvert par un listener "session-live"
// (cf. firestore.js _SESSION_COLLECTIONS), `subscribeCollection` hook
// dans le listener existant — aucun nouveau listener Firestore créé,
// aucune lecture facturée. Le callback reçoit les données du cache live.
// ══════════════════════════════════════════════════════════════════════════════
import { subscribeCollection, subscribeDoc } from '../data/firestore.js';
import { STATE } from '../core/state.js';

// Map nom → fonction de désabonnement
const _subs = new Map();

// Abonner à une collection entière
export function watch(name, col, callback) {
  _subs.get(name)?.();          // désabonner l'éventuel listener précédent
  const unsub = subscribeCollection(col, callback);
  _subs.set(name, unsub);
}

// Abonner à un document unique
export function watchDoc(name, col, id, callback) {
  _subs.get(name)?.();
  const unsub = subscribeDoc(col, id, callback);
  _subs.set(name, unsub);
}

// Abonner à une collection uniquement si la page courante est active.
// Remplace le pattern répété : watch(name, col, data => { if (STATE.currentPage !== page) return; ... })
export function watchPageCollection(name, col, pageId, callback) {
  watch(name, col, data => {
    if (STATE.currentPage !== pageId) return;
    callback(data || []);
  });
}

// Identique mais pour un document unique (watchDoc).
export function watchPageDoc(name, col, id, pageId, callback) {
  watchDoc(name, col, id, data => {
    if (STATE.currentPage !== pageId) return;
    callback(data);
  });
}

// Désabonner tous les listeners (appelé à chaque navigate)
export function unwatchAll() {
  _subs.forEach(fn => fn());
  _subs.clear();
}
