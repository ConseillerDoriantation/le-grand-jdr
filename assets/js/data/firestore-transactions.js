// ══════════════════════════════════════════════
// FIRESTORE-TRANSACTIONS — Écritures liées sur plusieurs documents
//
// Module FEUILLE, comme firestore-queries.js : il n'importe que des exports
// existants. Un nouvel export de firestore.js (chargé au démarrage) pourrait être
// servi depuis le cache HTTP périmé juste après un déploiement ; un fichier neuf
// ne le peut pas.
// ══════════════════════════════════════════════

import { db, doc, collection, runTransaction } from '../config/firebase.js';
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
