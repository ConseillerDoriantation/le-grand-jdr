// ══════════════════════════════════════════════
// FIRESTORE-TRANSACTIONS — Écritures liées sur plusieurs documents
//
// Module FEUILLE, comme firestore-queries.js : il n'importe que des exports
// existants. Un nouvel export de firestore.js (chargé au démarrage) pourrait être
// servi depuis le cache HTTP périmé juste après un déploiement ; un fichier neuf
// ne le peut pas.
// ══════════════════════════════════════════════

import { db, doc, collection, query, where, limit, onSnapshot, runTransaction } from '../config/firebase.js';
import { getCurrentAdventureId } from './firestore.js';

function _path(col) {
  const adventureId = getCurrentAdventureId();
  if (!adventureId) throw new Error(`Aucune aventure active (${col})`);
  return `adventures/${adventureId}/${col}`;
}

// Identifiant d'un document à créer DANS une transaction (ex. une annonce
// publiée au moment où l'objet quitte l'inventaire).
export function newDocId(col) {
  return doc(collection(db, _path(col))).id;
}

// Lit `reads` ({ col, id }) puis passe leurs valeurs (null si absent) à `plan`,
// qui renvoie { writes: [{ col, id, data, op: 'update' | 'set' }], result }.
// Tout est commité ou rien. Si un document lu change avant le commit (deux
// acheteurs du même objet), Firestore rejoue `plan` sur les valeurs fraîches.
// Une erreur levée par `plan` annule tout et remonte telle quelle.
// Quota : une lecture par document lu (et par essai), une écriture par write.
export async function runDocsTransaction(reads = [], plan) {
  const refs = reads.map(({ col, id }) => doc(db, _path(col), id));
  return runTransaction(db, async transaction => {
    const snaps = await Promise.all(refs.map(ref => transaction.get(ref)));
    const current = snaps.map(snap => (snap.exists() ? { id: snap.id, ...snap.data() } : null));
    const { writes = [], result } = (await plan(current)) || {};
    writes.forEach(({ col, id, data, op = 'update' }) => {
      const ref = doc(db, _path(col), id);
      if (op === 'set') transaction.set(ref, data);
      else transaction.update(ref, data);
    });
    return result;
  });
}

// Listener borné sur les documents qui vérifient PLUSIEURS égalités. Sans tri
// ni inégalité, Firestore fusionne les index mono-champ : aucun index composite
// à créer. `onUnavailable` est appelé une seule fois si la requête est refusée.
export function subscribeWhereEquals(col, equals = {}, { max = 100 } = {}, onData, { onUnavailable } = {}) {
  const adventureId = getCurrentAdventureId();
  const filters = Object.entries(equals || {});
  if (!adventureId || !filters.length) {
    onUnavailable?.();
    return () => {};
  }
  const safeMax = Math.max(1, Math.min(200, Math.trunc(Number(max) || 100)));
  let active = true;
  const unsubscribe = onSnapshot(
    query(
      collection(db, `adventures/${adventureId}/${col}`),
      ...filters.map(([field, value]) => where(field, '==', value)),
      limit(safeMax),
    ),
    snap => {
      if (active) onData(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    },
    err => {
      if (!active) return;
      active = false;
      console.debug(`[firestore] requête multi-égalités indisponible : ${col}`, err?.code || err);
      onUnavailable?.(err);
    },
  );
  return () => {
    active = false;
    unsubscribe();
  };
}
