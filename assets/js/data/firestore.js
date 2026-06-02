// ══════════════════════════════════════════════
// FIRESTORE — Couche d'accès aux données
//
// Trois niveaux de cache (du plus prioritaire au moins) :
//   1. Live session — un onSnapshot couvre toute la session pour les
//      collections lues par plusieurs pages (shop, npcs, story, quests,
//      characters, achievements, collection, shopCategories) + 3 docs
//      (bastion/main, world/main, agenda_session/next). Coût initial :
//      1 lecture par doc à l'entrée d'aventure (servie par IndexedDB sur
//      cache chaud → ~0 lecture facturée). Coût ensuite : uniquement les
//      deltas réels (latency-compensation auto sur nos propres writes).
//   2. Cache TTL en mémoire — pour les collections page-scoped (bestiary,
//      npc_affinites, etc.). Évite de re-fetch entre nav.
//   3. Cache IndexedDB de Firestore (config/firebase.js) — servi à
//      getDocs/onSnapshot quand on n'a rien en mémoire.
//
// Dédoublonnage des requêtes "en vol" : deux loadCollection simultanés sur
// la même collection partagent la même Promise → 1 seul fetch.
// ══════════════════════════════════════════════

import {
  db,
  doc, setDoc, getDoc,
  collection, getDocs,
  addDoc, updateDoc, deleteDoc,
  onSnapshot,
  query, where,
} from '../config/firebase.js';

// ── Scope aventure ─────────────────────────────
let _adventureId = null;

// Collections globales — non scopées à une aventure
const _GLOBAL_COLS = new Set(['users', 'adventures']);

export function setCurrentAdventure(id) {
  if (id === _adventureId) return;
  // Tear down listeners de l'aventure précédente avant de changer de scope.
  releaseSessionData();
  _cache.clear();
  _adventureId = id;
}

export function getCurrentAdventureId() { return _adventureId; }

// Résout le chemin d'une collection : 'characters' → 'adventures/xxx/characters'
function _colPath(col) {
  if (_adventureId && !_GLOBAL_COLS.has(col)) {
    return `adventures/${_adventureId}/${col}`;
  }
  return col;
}

// ── Cache TTL legacy (pour collections NON session-live) ──────────
// Sert principalement aux pages dont la collection n'a pas été promue
// "session-live" (ex: bestiary, npc_affinites, recipes…).
const _CACHE_TTL = {
  // Contenu actif — peut changer en cours de session
  bestiary:           5 * 60_000,
  bestiary_meta:      5 * 60_000,
  npc_affinites:      5 * 60_000,
  story_meta:         5 * 60_000,  // liste des actes, change si admin crée un acte
  bestiary_tracker:   5 * 60_000,  // suivi joueur live pendant VTT
  map_lieux:          5 * 60_000,  // legacy, conserve TTL court
  places:             5 * 60_000,
  // Contenu stable — rarement modifié en session
  recipes:            30 * 60_000,
  recettes:           30 * 60_000,
  tutorial:           30 * 60_000,
  story_histories:    30 * 60_000,
  place_types:        30 * 60_000,
  organizations:      30 * 60_000,
  players:            30 * 60_000,
  collectionSettings: 30 * 60_000,
  achievements_meta:  30 * 60_000,
  // Aventures — TTL moyen (structure change rarement en session)
  adventures:         60_000,
};

const _DOC_CACHE_TTL = {
  world: {
    // Config de règles — modifiée par l'admin hors session, caches module-level internes
    weapon_formats:  30 * 60_000,
    damage_types:    30 * 60_000,
    spell_matrices:  30 * 60_000,
    conditions:      30 * 60_000,
    dice_skills:     30 * 60_000,  // maintenant aussi en _SESSION_DOCS
    upgrade_settings:30 * 60_000,
    combat_styles:   30 * 60_000,
    vtt_emotes:      30 * 60_000,  // admin définit une fois par campagne
    map:             30 * 60_000,  // config image/fond, ne change pas pendant le jeu
    // map_fog court : l'admin peut révéler des zones pendant une session
    map_fog:          5 * 60_000,
  },
};

const _cache = new Map(); // key → { data, ts }

function _cacheTtlForKey(key) {
  const path = key.split(':')[0];
  const colName = path.split('/').pop();
  const colTtl = _CACHE_TTL[colName];
  if (colTtl) return colTtl;

  const suffix = key.slice(path.length + 1);
  if (!suffix || suffix.includes(':')) return null;
  return _DOC_CACHE_TTL[colName]?.[suffix] || null;
}

function _cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  const ttl = _cacheTtlForKey(key);
  if (!ttl) return null;
  if (Date.now() - entry.ts > ttl) { _cache.delete(key); return null; }
  return entry.data;
}

function _cacheSet(key, data) {
  const ttl = _cacheTtlForKey(key);
  if (!ttl) return;
  _cache.set(key, { data, ts: Date.now() });
}

// Patch chirurgical du cache TTL après une écriture — évite l'invalidation
// totale (qui force un re-fetch complet de la collection).
function _cacheInvalidateWhere(path) {
  const prefix = `${path}:where:`;
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) _cache.delete(key);
  }
}

function _cachePatchAdd(path, docData) {
  _cacheInvalidateWhere(path);
  const allKey = `${path}:all`;
  const all = _cache.get(allKey);
  if (all) {
    // Dédupe : si un onSnapshot actif a déjà inséré le doc via
    // latency-compensation (le snapshot fire avant la résolution de addDoc),
    // on remplace plutôt que d'append — sinon on duplique l'entrée.
    const exists = all.data.some(d => d.id === docData.id);
    const data = exists
      ? all.data.map(d => d.id === docData.id ? docData : d)
      : [...all.data, docData];
    _cache.set(allKey, { data, ts: all.ts });
  }
  _cache.set(`${path}:${docData.id}`, { data: docData, ts: Date.now() });
}

function _cachePatchUpdate(path, id, partial) {
  _cacheInvalidateWhere(path);
  const allKey = `${path}:all`;
  const all = _cache.get(allKey);
  if (all) {
    const newData = all.data.map(d => d.id === id ? { ...d, ...partial } : d);
    _cache.set(allKey, { data: newData, ts: all.ts });
  }
  const single = _cache.get(`${path}:${id}`);
  if (single) {
    _cache.set(`${path}:${id}`, { data: { ...single.data, ...partial }, ts: single.ts });
  }
}

function _cachePatchSave(path, id, partial) {
  _cacheInvalidateWhere(path);
  const allKey = `${path}:all`;
  const all = _cache.get(allKey);
  if (all) {
    const found = all.data.some(d => d.id === id);
    const data = found
      ? all.data.map(d => d.id === id ? { ...d, ...partial } : d)
      : [...all.data, { id, ...partial }];
    _cache.set(allKey, { data, ts: all.ts });
  }
  const singleKey = `${path}:${id}`;
  const single = _cache.get(singleKey);
  const data = { ...(single?.data || {}), ...partial };
  if (single) _cache.set(singleKey, { data, ts: single.ts });
  else _cacheSet(singleKey, data);
}

function _cachePatchDelete(path, id) {
  _cacheInvalidateWhere(path);
  const allKey = `${path}:all`;
  const all = _cache.get(allKey);
  if (all) _cache.set(allKey, { data: all.data.filter(d => d.id !== id), ts: all.ts });
  _cache.delete(`${path}:${id}`);
}


// ── Cache LIVE session ─────────────────────────
// Un onSnapshot par collection ou doc, vivant toute la session de l'aventure.
// Toutes les pages consomment ces listeners — plus jamais de re-fetch sur nav.
const _liveCollections = new Map(); // path → entry
const _liveDocs        = new Map(); // `${path}:${id}` → entry
//
// entry = {
//   data:           T[],          // données les plus récentes
//   observers:      Set<{cb}>,    // callbacks à notifier sur update
//   firstReceived:  boolean,      // true dès le 1er snapshot reçu
//   unsub:          () => void,
//   ready:          Promise<T[]>, // résolue au 1er snapshot
// }

function _primeCol(col) {
  const path = _colPath(col);
  const existing = _liveCollections.get(path);
  if (existing) return existing.ready;

  const entry = {
    data: [],
    observers: new Set(),
    firstReceived: false,
    failed: false,
    unsub: null,
    ready: null,
  };
  _liveCollections.set(path, entry);

  entry.ready = new Promise(resolve => {
    let resolved = false;
    entry.unsub = onSnapshot(
      collection(db, path),
      snap => {
        entry.data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        entry.firstReceived = true;
        // Notifier tous les observers de page
        entry.observers.forEach(o => {
          try { o.cb(entry.data); } catch (e) { console.error('[firestore] observer error', e); }
        });
        if (!resolved) { resolved = true; resolve(entry.data); }
      },
      err => {
        entry.failed = true;
        // Permission-denied : la règle Firestore peut filtrer cette collection
        // pour ce rôle (ex: joueur sans accès à un doc admin). Pas une erreur.
        if (err?.code !== 'permission-denied') {
          _handleFirestoreError(err, `primeSession(${path})`);
        }
        entry.firstReceived = true; // débloquer les awaits sur ready
        entry.observers.forEach(o => {
          try { o.cb([]); } catch (e) { console.error('[firestore] observer error', e); }
        });
        if (!resolved) { resolved = true; resolve([]); }
      }
    );
  });
  return entry.ready;
}

function _primeDoc(col, id) {
  const path = _colPath(col);
  const key = `${path}:${id}`;
  const existing = _liveDocs.get(key);
  if (existing) return existing.ready;

  const entry = {
    data: null,
    observers: new Set(),
    firstReceived: false,
    failed: false,
    unsub: null,
    ready: null,
  };
  _liveDocs.set(key, entry);

  entry.ready = new Promise(resolve => {
    let resolved = false;
    entry.unsub = onSnapshot(
      doc(db, path, id),
      snap => {
        entry.data = snap.exists() ? { id: snap.id, ...snap.data() } : null;
        entry.firstReceived = true;
        entry.observers.forEach(o => {
          try { o.cb(entry.data); } catch (e) { console.error('[firestore] observer error', e); }
        });
        if (!resolved) { resolved = true; resolve(entry.data); }
      },
      err => {
        entry.failed = true;
        if (err?.code !== 'permission-denied') {
          _handleFirestoreError(err, `primeSessionDoc(${path}/${id})`);
        }
        entry.firstReceived = true;
        entry.observers.forEach(o => {
          try { o.cb(null); } catch (e) { console.error('[firestore] observer error', e); }
        });
        if (!resolved) { resolved = true; resolve(null); }
      }
    );
  });
  return entry.ready;
}

// Liste des collections promues "session-live" : choisies parce qu'elles
// sont lues par 3+ pages et que la donnée ne grossit pas démesurément.
// `bestiary` est volontairement exclu (volume potentiellement énorme).
const _SESSION_COLLECTIONS = [
  'story',
  'achievements',
  'quests',
  'characters',
  'collection',
];
const _LAZY_SESSION_COLLECTIONS = new Set([
  'shop', 'shopCategories',
  'npcs',
  'organizations', // utilisé par npcs.js + histoire.js, TTL 5 min insuffisant
  'players',       // utilisé par character-sheet tabs + inline-edit, sans cache TTL
]);
const _SESSION_DOCS = [
  ['bastion',          'main'],
  ['world',            'main'],
  ['agenda_session',   'next'],
  ['achievements_meta','order'],      // lu à chaque render achievements
  ['world',            'dice_skills'], // partagé entre histoire.js, shop.js, vtt.js
  ['world',            'map'],         // config fond de carte, stable pendant le jeu
];

// Démarre tous les listeners session pour l'aventure courante.
// Fire-and-forget côté caller — chaque page individuelle await la `ready`
// du listener via subscribeCollection / loadCollection si besoin.
export function primeSessionData() {
  if (!_adventureId) return Promise.resolve();
  const promises = [];
  for (const col of _SESSION_COLLECTIONS) promises.push(_primeCol(col));
  for (const [col, id] of _SESSION_DOCS) promises.push(_primeDoc(col, id));
  return Promise.all(promises);
}

// Tear down tous les listeners session + vide le cache.
// Appelé : changement d'aventure, logout.
export function releaseSessionData() {
  _liveCollections.forEach(entry => { try { entry.unsub?.(); } catch (_) {} });
  _liveCollections.clear();
  _liveDocs.forEach(entry => { try { entry.unsub?.(); } catch (_) {} });
  _liveDocs.clear();
  _inflight.clear();
  _cache.clear();
}

// ── In-flight coalescing ───────────────────────
// Si une 2e requête arrive pendant qu'une 1ère est en vol pour la même clé,
// elle réutilise la Promise existante (1 seul fetch réseau).
const _inflight = new Map();

// ── Abonnements (subscribe) ────────────────────
// Si la collection / doc est déjà en session-live, on hook dans le listener
// existant — ZÉRO nouveau listener Firestore (donc 0 lecture supplémentaire).
// Sinon : nouveau listener éphémère (page-scoped, killé par unwatchAll).

export function subscribeCollection(col, callback) {
  const path = _colPath(col);
  let live = _liveCollections.get(path);
  if (!live && _adventureId && _LAZY_SESSION_COLLECTIONS.has(col)) {
    _primeCol(col);
    live = _liveCollections.get(path);
  }
  if (live && !live.failed) {
    const observer = { cb: callback };
    live.observers.add(observer);
    // Appel asynchrone pour matcher la sémantique onSnapshot (jamais sync)
    if (live.firstReceived) Promise.resolve().then(() => callback(live.data));
    return () => live.observers.delete(observer);
  }
  return onSnapshot(
    collection(db, path),
    snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _cacheSet(`${path}:all`, data);
      callback(data);
    },
    err => _handleFirestoreError(err, `subscribeCollection(${path})`)
  );
}

export function subscribeDoc(col, id, callback) {
  const path = _colPath(col);
  const liveKey = `${path}:${id}`;
  const live = _liveDocs.get(liveKey);
  if (live && !live.failed) {
    const observer = { cb: callback };
    live.observers.add(observer);
    if (live.firstReceived) Promise.resolve().then(() => callback(live.data));
    return () => live.observers.delete(observer);
  }
  return onSnapshot(
    doc(db, path, id),
    snap => {
      const data = snap.exists() ? { id: snap.id, ...snap.data() } : null;
      if (data) _cacheSet(`${path}:${id}`, data);
      callback(data);
    },
    err => _handleFirestoreError(err, `subscribeDoc(${path}/${id})`)
  );
}

// ── Gestionnaire d'erreur centralisé ───────────
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

// ── Lectures ───────────────────────────────────
export async function loadCollection(col) {
  const path = _colPath(col);

  // 1. Live session — 0 lecture facturée
  let live = _liveCollections.get(path);
  if (!live && _adventureId && _LAZY_SESSION_COLLECTIONS.has(col)) {
    await _primeCol(col);
    live = _liveCollections.get(path);
  }
  if (live && !live.failed) {
    if (!live.firstReceived) await live.ready;
    return live.data;
  }

  // 2. Cache TTL en mémoire
  const key = `${path}:all`;
  const cached = _cacheGet(key);
  if (cached) return cached;

  // 3. Coalescing : si une requête identique est déjà en vol, on partage
  if (_inflight.has(key)) return _inflight.get(key);

  // 4. Fetch (servi du cache IndexedDB de Firestore si dispo)
  const promise = (async () => {
    try {
      const snap = await getDocs(collection(db, path));
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _cacheSet(key, data);
      return data;
    } catch (e) {
      _handleFirestoreError(e, `loadCollection(${path})`);
      return [];
    } finally {
      _inflight.delete(key);
    }
  })();
  _inflight.set(key, promise);
  return promise;
}

export function getCachedCollection(col) {
  const path = _colPath(col);
  const live = _liveCollections.get(path);
  if (live && !live.failed && live.firstReceived) return live.data;
  return _cacheGet(`${path}:all`);
}

export async function loadCollectionWhere(col, field, op, value) {
  const path = _colPath(col);

  // Filtre client-side sur le live cache si la collection y est
  let live = _liveCollections.get(path);
  if (!live && _adventureId && _LAZY_SESSION_COLLECTIONS.has(col)) {
    await _primeCol(col);
    live = _liveCollections.get(path);
  }
  if (live && !live.failed) {
    if (!live.firstReceived) await live.ready;
    return live.data.filter(d => _matchOp(d[field], op, value));
  }

  const key = `${path}:where:${field}:${op}:${JSON.stringify(value)}`;
  const allCached = _cacheGet(`${path}:all`);
  if (allCached) return allCached.filter(d => _matchOp(d[field], op, value));
  const cached = _cacheGet(key);
  if (cached) return cached;
  if (_inflight.has(key)) return _inflight.get(key);
  const promise = (async () => {
    try {
      const snap = await getDocs(query(collection(db, path), where(field, op, value)));
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _cacheSet(key, data);
      return data;
    } catch (e) {
      _handleFirestoreError(e, `loadCollectionWhere(${path})`);
      return [];
    } finally {
      _inflight.delete(key);
    }
  })();
  _inflight.set(key, promise);
  return promise;
}

function _matchOp(v, op, value) {
  if (op === '==') return v === value;
  if (op === '!=') return v !== value;
  if (op === '>')  return v >  value;
  if (op === '<')  return v <  value;
  if (op === '>=') return v >= value;
  if (op === '<=') return v <= value;
  if (op === 'array-contains') return Array.isArray(v) && v.includes(value);
  if (op === 'in')             return Array.isArray(value) && value.includes(v);
  return false;
}

// ── Documents ──────────────────────────────────
// Cœur partagé : même cascade live-doc → live-collection → cache TTL →
// coalescing → fetch. Seule la gestion d'erreur du fetch diffère :
//   silent=false → notif "Accès refusé" via _handleFirestoreError
//   silent=true  → log debug only (lecture optionnelle)
async function _readDoc(col, id, { silent } = {}) {
  const path = _colPath(col);

  // 1. Live doc (ex: bastion/main)
  const liveKey = `${path}:${id}`;
  const liveD = _liveDocs.get(liveKey);
  if (liveD && !liveD.failed) {
    if (!liveD.firstReceived) await liveD.ready;
    return liveD.data ? { ...liveD.data } : null;
  }

  // 2. Live collection — chercher l'item dedans
  const liveC = _liveCollections.get(path);
  if (liveC && !liveC.failed) {
    if (!liveC.firstReceived) await liveC.ready;
    const found = liveC.data.find(d => d.id === id);
    return found ? { ...found } : null;
  }

  // 3. Cache TTL
  const cached = _cacheGet(liveKey);
  if (cached) return cached;

  // 4. Coalescing + fetch
  if (_inflight.has(liveKey)) return _inflight.get(liveKey);
  const promise = (async () => {
    try {
      const snap = await getDoc(doc(db, path, id));
      const data = snap.exists() ? snap.data() : null;
      if (data) _cacheSet(liveKey, data);
      return data;
    } catch (e) {
      if (silent) console.debug(`[firestore] silent read failed: ${path}/${id}`, e?.code || e);
      else        _handleFirestoreError(e, `getDocData(${path}/${id})`);
      return null;
    } finally {
      _inflight.delete(liveKey);
    }
  })();
  _inflight.set(liveKey, promise);
  return promise;
}

export const getDocData = (col, id) => _readDoc(col, id, { silent: false });

// Variante silencieuse : pas de notif "Accès refusé" si lecture optionnelle.
export const getDocDataSilent = (col, id) => _readDoc(col, id, { silent: true });

// ── Écritures ──────────────────────────────────
// Avec un listener live actif sur la collection/doc, Firestore propage
// l'écriture localement via latency-compensation : les observers sont
// notifiés instantanément. Pour le cache TTL (non-live), on patche
// chirurgicalement pour éviter une invalidation totale.
export async function saveDoc(col, id, data) {
  const path = _colPath(col);
  try {
    await setDoc(doc(db, path, id), data, { merge: true });
    _cachePatchSave(path, id, data);
  } catch (e) {
    _handleFirestoreError(e, `saveDoc(${path}/${id})`);
    throw e;
  }
}

export async function addToCol(col, data) {
  const path = _colPath(col);
  try {
    const enriched = { ...data, createdAt: new Date().toISOString() };
    const ref = await addDoc(collection(db, path), enriched);
    _cachePatchAdd(path, { id: ref.id, ...enriched });
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
    _cachePatchUpdate(path, id, data);
  } catch (e) {
    _handleFirestoreError(e, `updateInCol(${path}/${id})`);
    throw e;
  }
}

export async function deleteFromCol(col, id) {
  const path = _colPath(col);
  try {
    await deleteDoc(doc(db, path, id));
    _cachePatchDelete(path, id);
  } catch (e) {
    _handleFirestoreError(e, `deleteFromCol(${path}/${id})`);
    throw e;
  }
}

// ── Spécifique personnages ─────────────────────
export async function loadChars(uid = null) {
  const path = _colPath('characters');

  // Source : live cache si dispo, sinon loadCollection (qui peut aussi
  // tomber sur du IndexedDB Firestore cache).
  let chars;
  const live = _liveCollections.get(path);
  if (live && !live.failed) {
    if (!live.firstReceived) await live.ready;
    chars = live.data;
  } else {
    chars = await loadCollection('characters');
  }

  if (uid) chars = chars.filter(c => c.uid === uid);

  // Migration silencieuse : convention "1 entrée = 1 unité" — split les qte>1
  // Idempotente : ne s'exécute que sur les inventaires non normalisés.
  try {
    const { normalizeInventaire, inventaireNeedsNorm } = await import('../shared/inventory-utils.js');
    for (const c of chars) {
      if (!inventaireNeedsNorm(c.inventaire)) continue;
      const normalized = normalizeInventaire(c.inventaire);
      c.inventaire = normalized;
      // Fire-and-forget : si l'écriture échoue (droits), retentée au prochain pass.
      updateDoc(doc(db, path, c.id), { inventaire: normalized })
        .then(() => console.debug(`[inv] normalized ${c.nom || c.id} (${normalized.length} entries)`))
        .catch(e => console.debug(`[inv] silent normalize failed for ${c.id}:`, e?.code));
    }
  } catch (e) { console.debug('[inv] norm utility load failed:', e); }
  return chars;
}
