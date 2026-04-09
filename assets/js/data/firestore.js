// ══════════════════════════════════════════════
// FIRESTORE — Couche d'accès aux données
// Tous les appels DB passent ici.
// ══════════════════════════════════════════════

import {
  db,
  doc, setDoc, getDoc,
  collection, getDocs,
  addDoc, updateDoc, deleteDoc,
  query, where, orderBy,
} from '../config/firebase.js';

// ── Cache mémoire ──────────────────────────────
// Évite les re-lectures Firestore inutiles entre navigations.
// TTL par type de collection (en ms) :
//   - Contenus MJ (shop, story, world...) : 5 min — changent rarement en session
//   - Bastion : 15s — modifié par les joueurs, besoin de fraîcheur
//   - Pas de cache sur characters (chaque joueur modifie le sien en permanence)
const _CACHE_TTL = {
  // Contenus gérés par le MJ uniquement — stables pendant une session
  shop:               5 * 60_000,
  shopCategories:     5 * 60_000,
  story:              5 * 60_000,
  story_meta:         5 * 60_000,
  world:              5 * 60_000,
  players:            5 * 60_000,
  achievements:       5 * 60_000,
  achievements_meta:  5 * 60_000,
  npcs:               5 * 60_000,
  bestiary:           5 * 60_000,
  bestiary_meta:      5 * 60_000,
  recipes:            5 * 60_000,
  recettes:           5 * 60_000,
  collection:         5 * 60_000,
  collectionSettings: 5 * 60_000,
  tutorial:           5 * 60_000,
  informations:       5 * 60_000,
  map_lieux:          5 * 60_000,
  // Contenu collaboratif — TTL court pour rester à jour
  bastion:            15_000,
};

const _cache = new Map(); // clé → { data, ts }

function _cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  const ttl = _CACHE_TTL[key.split(':')[0]]; // ex: 'shop:all' → 'shop'
  if (!ttl) return null;
  if (Date.now() - entry.ts > ttl) { _cache.delete(key); return null; }
  return entry.data;
}

function _cacheSet(key, data) {
  const ttl = _CACHE_TTL[key.split(':')[0]];
  if (!ttl) return; // Pas de TTL = pas de cache pour cette collection
  _cache.set(key, { data, ts: Date.now() });
}

// Invalider le cache d'une collection après une écriture
function _cacheInvalidate(col) {
  for (const key of _cache.keys()) {
    if (key.startsWith(col + ':')) _cache.delete(key);
  }
}

// Exposer pour permettre aux features de forcer un refresh si besoin
export function invalidateCache(col) { _cacheInvalidate(col); }

// ── Gestionnaire d'erreur centralisé ───────────
// Affiche un toast si showNotif est disponible, sinon console.error uniquement.
// code : code Firebase (ex: 'permission-denied', 'unavailable')
// ctx  : contexte lisible (ex: 'loadCollection(shop)')
function _handleFirestoreError(e, ctx) {
  console.error(`[firestore] ${ctx}`, e);

  const notify = window.showNotif;
  if (!notify) return;

  const code = e?.code || '';

  if (code === 'permission-denied') {
    notify(`Accès refusé — ${ctx}`, 'error');
  } else if (code === 'unavailable' || code === 'deadline-exceeded') {
    notify('Connexion perdue. Vérifie ta connexion internet.', 'error');
  } else if (code === 'not-found') {
    // Silencieux — document absent est souvent attendu
  } else {
    notify(`Erreur base de données (${ctx})`, 'error');
  }
}

// ── Collections ────────────────────────────────
export async function loadCollection(col) {
  const key = `${col}:all`;
  const cached = _cacheGet(key);
  if (cached) return cached;
  try {
    const snap = await getDocs(collection(db, col));
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _cacheSet(key, data);
    return data;
  } catch (e) {
    _handleFirestoreError(e, `loadCollection(${col})`);
    return [];
  }
}

export async function loadCollectionOrdered(col, field) {
  try {
    const snap = await getDocs(query(collection(db, col), orderBy(field)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    return loadCollection(col);
  }
}

export async function loadCollectionWhere(col, field, op, value) {
  try {
    const snap = await getDocs(query(collection(db, col), where(field, op, value)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    _handleFirestoreError(e, `loadCollectionWhere(${col})`);
    return [];
  }
}

// ── Documents ──────────────────────────────────
export async function getDocData(col, id) {
  const key = `${col}:${id}`;
  const cached = _cacheGet(key);
  if (cached) return cached;
  try {
    const snap = await getDoc(doc(db, col, id));
    const data = snap.exists() ? snap.data() : null;
    if (data) _cacheSet(key, data);
    return data;
  } catch (e) {
    _handleFirestoreError(e, `getDocData(${col}/${id})`);
    return null;
  }
}

export async function saveDoc(col, id, data) {
  try {
    await setDoc(doc(db, col, id), data, { merge: true });
    _cacheInvalidate(col); // Invalider après écriture
  } catch (e) {
    _handleFirestoreError(e, `saveDoc(${col}/${id})`);
    throw e;
  }
}

export async function addToCol(col, data) {
  try {
    const ref = await addDoc(collection(db, col), {
      ...data,
      createdAt: new Date().toISOString(),
    });
    _cacheInvalidate(col); // Invalider après ajout
    return ref.id;
  } catch (e) {
    _handleFirestoreError(e, `addToCol(${col})`);
    throw e;
  }
}

export async function updateInCol(col, id, data) {
  try {
    await updateDoc(doc(db, col, id), data);
    _cacheInvalidate(col); // Invalider après écriture
  } catch (e) {
    _handleFirestoreError(e, `updateInCol(${col}/${id})`);
    throw e;
  }
}

export async function deleteFromCol(col, id) {
  try {
    await deleteDoc(doc(db, col, id));
    _cacheInvalidate(col); // Invalider après suppression
  } catch (e) {
    _handleFirestoreError(e, `deleteFromCol(${col}/${id})`);
    throw e;
  }
}

// ── Spécifique personnages ─────────────────────
export async function loadChars(uid = null) {
  try {
    const q = uid
      ? query(collection(db, 'characters'), where('uid', '==', uid))
      : collection(db, 'characters');
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    _handleFirestoreError(e, 'loadChars');
    return [];
  }
}

export async function countUserChars(uid = null) {
  const chars = await loadChars(uid);
  return chars.length;
}