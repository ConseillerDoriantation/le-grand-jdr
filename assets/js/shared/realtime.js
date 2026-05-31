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
import { onSnapshot } from '../config/firebase.js';

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

// Abonner à une query Firestore (limit, orderBy, where…)
// `queryRef` est une référence de Query déjà construite avec query(col, ...).
// Utile quand on veut limiter côté serveur (ex: chat avec limit(80)).
export function watchQuery(name, queryRef, callback) {
  _subs.get(name)?.();
  const unsub = onSnapshot(
    queryRef,
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => console.error(`[realtime] watchQuery(${name}):`, err),
  );
  _subs.set(name, unsub);
}

// Désabonner tous les listeners (appelé à chaque navigate)
export function unwatchAll() {
  _subs.forEach(fn => fn());
  _subs.clear();
}
