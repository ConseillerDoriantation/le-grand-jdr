// ══════════════════════════════════════════════════════════════════════════════
// REALTIME.JS — Gestionnaire d'abonnements Firestore temps réel
//
// Usage :
//   watch('quests', 'quests', data => renderQuests(data));
//   watchDoc('info', 'informations', 'main', data => renderInfo(data));
//   unwatchAll(); // appelé automatiquement à chaque navigation
// ══════════════════════════════════════════════════════════════════════════════
import { subscribeCollection, subscribeDoc } from '../data/firestore.js';

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

// Désabonner un listener nommé
export function unwatch(name) {
  _subs.get(name)?.();
  _subs.delete(name);
}

// Désabonner tous les listeners (appelé à chaque navigate)
export function unwatchAll() {
  _subs.forEach(fn => fn());
  _subs.clear();
}
