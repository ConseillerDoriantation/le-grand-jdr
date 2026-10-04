// ══════════════════════════════════════════════
// FIRESTORE-QUERIES — Requêtes ciblées (filtre + tri + limite)
//
// Module FEUILLE, séparé de firestore.js : un nouvel export ajouté à un module
// chargé au démarrage peut être servi depuis le cache HTTP périmé juste après un
// déploiement (« does not provide an export named… »). Un fichier neuf ne peut
// pas l'être. N'importe que des exports existants.
// ══════════════════════════════════════════════

import { db, collection, query, where, orderBy, limit, onSnapshot } from '../config/firebase.js';
import { getCurrentAdventureId } from './firestore.js';

// Listener borné sur les documents récents d'une collection d'aventure qui
// vérifient un filtre. Quota : seuls les documents pertinents sont lus (au lieu
// des N derniers de tout le monde) et les écritures qui ne concernent pas ce
// filtre ne déclenchent aucune lecture chez ce client.
//
// `where` + `orderBy` sur deux champs exige un index composite. Tant qu'il
// manque (failed-precondition, y compris pendant sa construction) ou si la
// requête est refusée, `onUnavailable` est appelé UNE fois : l'appelant se rabat
// sur sa requête historique. Firestore loggue alors le lien de création d'index.
export function subscribeRecentWhere(col, { field, op = '==', value }, { orderField = 'ts', max = 30 } = {}, onData, { onUnavailable } = {}) {
  const adventureId = getCurrentAdventureId();
  if (!adventureId || !field) {
    onUnavailable?.();
    return () => {};
  }
  const safeMax = Math.max(1, Math.min(200, Math.trunc(Number(max) || 30)));
  let active = true;
  const unsubscribe = onSnapshot(
    query(
      collection(db, `adventures/${adventureId}/${col}`),
      where(field, op, value),
      orderBy(orderField, 'desc'),
      limit(safeMax),
    ),
    snap => {
      if (active) onData(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    },
    err => {
      // Désabonné entre-temps (changement d'aventure, logout) : aucun repli.
      if (!active) return;
      active = false;
      if (err?.code === 'failed-precondition') {
        console.info(`[firestore] index composite absent pour ${col} (${field} + ${orderField} desc) : repli sur la requête historique. Lien de création :`, err?.message || err);
      } else {
        console.debug(`[firestore] requête ciblée indisponible : ${col}`, err?.code || err);
      }
      onUnavailable?.(err);
    },
  );
  return () => {
    active = false;
    unsubscribe();
  };
}
