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

// ── Scope aventure ─────────────────────────────
// Toutes les collections (sauf globales) sont scopées à l'aventure courante.
// setCurrentAdventure() est appelé après sélection d'une aventure.
let _adventureId = null;

// Collections globales — non scopées à une aventure
const _GLOBAL_COLS = new Set(['users', 'adventures']);

export function setCurrentAdventure(id) {
  _adventureId = id;
  _cache.clear(); // vider le cache à chaque changement d'aventure
}

export function getCurrentAdventureId() { return _adventureId; }

// Résout le chemin d'une collection : 'characters' → 'adventures/xxx/characters'
function _colPath(col) {
  if (_adventureId && !_GLOBAL_COLS.has(col)) {
    return `adventures/${_adventureId}/${col}`;
  }
  return col;
}

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
  story_histories:    5 * 60_000,
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
  // Aventures — TTL moyen (structure change rarement en session)
  adventures:         60_000,
};

const _cache = new Map(); // clé → { data, ts }

function _cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  // key peut être 'shop:all' ou 'adventures/x/shop:all' — extraire le nom de collection
  const colName = key.split(':')[0].split('/').pop();
  const ttl = _CACHE_TTL[colName];
  if (!ttl) return null;
  if (Date.now() - entry.ts > ttl) { _cache.delete(key); return null; }
  return entry.data;
}

function _cacheSet(key, data) {
  const colName = key.split(':')[0].split('/').pop();
  const ttl = _CACHE_TTL[colName];
  if (!ttl) return; // Pas de TTL = pas de cache pour cette collection
  _cache.set(key, { data, ts: Date.now() });
}

// Invalider le cache d'une collection après une écriture
// Accepte soit un nom de collection ('shop') soit un chemin complet ('adventures/x/shop')
function _cacheInvalidate(colOrPath) {
  const prefix = colOrPath + ':';
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) _cache.delete(key);
  }
}

// Exposer pour permettre aux features de forcer un refresh si besoin
export function invalidateCache(col) { _cacheInvalidate(_colPath(col)); }

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
  const path = _colPath(col);
  const key  = `${path}:all`;
  const cached = _cacheGet(key);
  if (cached) return cached;
  try {
    const snap = await getDocs(collection(db, path));
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _cacheSet(key, data);
    return data;
  } catch (e) {
    _handleFirestoreError(e, `loadCollection(${path})`);
    return [];
  }
}

export async function loadCollectionOrdered(col, field) {
  const path = _colPath(col);
  try {
    const snap = await getDocs(query(collection(db, path), orderBy(field)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    return loadCollection(col);
  }
}

export async function loadCollectionWhere(col, field, op, value) {
  const path = _colPath(col);
  try {
    const snap = await getDocs(query(collection(db, path), where(field, op, value)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    _handleFirestoreError(e, `loadCollectionWhere(${path})`);
    return [];
  }
}

// ── Documents ──────────────────────────────────
export async function getDocData(col, id) {
  const path = _colPath(col);
  const key  = `${path}:${id}`;
  const cached = _cacheGet(key);
  if (cached) return cached;
  try {
    const snap = await getDoc(doc(db, path, id));
    const data = snap.exists() ? snap.data() : null;
    if (data) _cacheSet(key, data);
    return data;
  } catch (e) {
    _handleFirestoreError(e, `getDocData(${path}/${id})`);
    return null;
  }
}

export async function saveDoc(col, id, data) {
  const path = _colPath(col);
  try {
    await setDoc(doc(db, path, id), data, { merge: true });
    _cacheInvalidate(path);
  } catch (e) {
    _handleFirestoreError(e, `saveDoc(${path}/${id})`);
    throw e;
  }
}

export async function addToCol(col, data) {
  const path = _colPath(col);
  try {
    const ref = await addDoc(collection(db, path), {
      ...data,
      createdAt: new Date().toISOString(),
    });
    _cacheInvalidate(path);
    return ref.id;
  } catch (e) {
    _handleFirestoreError(e, `addToCol(${path})`);
    throw e;
  }
}

export async function updateInCol(col, id, data) {
  const path = _colPath(col);
  try {
    await updateDoc(doc(db, path, id), data);
    _cacheInvalidate(path);
  } catch (e) {
    _handleFirestoreError(e, `updateInCol(${path}/${id})`);
    throw e;
  }
}

export async function deleteFromCol(col, id) {
  const path = _colPath(col);
  try {
    await deleteDoc(doc(db, path, id));
    _cacheInvalidate(path);
  } catch (e) {
    _handleFirestoreError(e, `deleteFromCol(${path}/${id})`);
    throw e;
  }
}

// ── Spécifique personnages ─────────────────────
export async function loadChars(uid = null) {
  const path = _colPath('characters');
  try {
    const q = uid
      ? query(collection(db, path), where('uid', '==', uid))
      : collection(db, path);
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