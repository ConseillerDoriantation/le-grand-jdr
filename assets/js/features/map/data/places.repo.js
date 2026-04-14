// ══════════════════════════════════════════════════════════════════════════════
// Places repository — abstrait Firestore pour les lieux.
// Lit en parallèle la nouvelle collection `places` ET l'ancienne `map_lieux`
// pour garder toutes les données existantes visibles sans migration destructive.
// Les écritures vont toujours dans `places`. Une suppression essaie les deux.
// ══════════════════════════════════════════════════════════════════════════════

import { loadCollection, saveDoc, deleteFromCol } from '../../../data/firestore.js';

const NEW_COL = 'places';
const LEGACY_COL = 'map_lieux';

export async function listPlaces() {
  const [fresh, legacy] = await Promise.all([
    loadCollection(NEW_COL),
    loadCollection(LEGACY_COL),
  ]);

  const merged = new Map();
  (legacy || []).forEach(doc => merged.set(doc.id, normalizeLegacy(doc)));
  // Les docs récents priment sur les legacy homonymes
  (fresh || []).forEach(doc => merged.set(doc.id, normalizeNew(doc)));
  return [...merged.values()];
}

export async function savePlace(place) {
  const payload = {
    ...place,
    updatedAt: Date.now(),
    createdAt: place.createdAt || Date.now(),
  };
  // On enlève les champs purement UI avant de persister
  delete payload._legacy;
  await saveDoc(NEW_COL, place.id, payload);
  // Si le lieu venait de l'ancienne collection, on nettoie sa trace legacy
  if (place._legacy) {
    try { await deleteFromCol(LEGACY_COL, place.id); } catch (_) { /* silencieux */ }
  }
  return payload;
}

export async function removePlace(id) {
  // On tente les deux collections : l'id peut vivre dans n'importe laquelle
  await Promise.allSettled([
    deleteFromCol(NEW_COL, id),
    deleteFromCol(LEGACY_COL, id),
  ]);
}

// ── Normalisation ─────────────────────────────────────────────────────────────

function normalizeNew(doc) {
  return {
    id: doc.id,
    name: doc.name || doc.nom || 'Sans nom',
    type: doc.type || 'poi',
    parentId: doc.parentId || null,
    summary: doc.summary || '',
    description: doc.description || '',
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    visibility: doc.visibility || 'hidden',
    imageUrl: doc.imageUrl || doc.image || '',
    marker: normalizeMarker(doc.marker),
    meta: doc.meta || {},
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
    _legacy: false,
  };
}

// Convertit un doc ancien format {nom, type, x%, y%, description, hidden, ...}
// vers le nouveau schéma. Coordonnées pourcentages -> normalisées [0..1].
function normalizeLegacy(doc) {
  const hasPos = typeof doc.x === 'number' && typeof doc.y === 'number';
  return {
    id: doc.id,
    name: doc.nom || doc.name || 'Sans nom',
    type: doc.type || 'poi',
    parentId: null,
    summary: '',
    description: doc.description || '',
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    visibility: doc.hidden ? 'hidden' : 'revealed',
    imageUrl: doc.image || '',
    marker: hasPos
      ? { mapId: 'world', x: clamp01(doc.x / 100), y: clamp01(doc.y / 100), icon: null }
      : null,
    meta: {
      pnj: Array.isArray(doc.pnj) ? doc.pnj : [],
      notes: doc.notes || '',
    },
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
    _legacy: true, // marqueur : ce lieu sera migré au premier save
  };
}

function normalizeMarker(m) {
  if (!m || typeof m.x !== 'number' || typeof m.y !== 'number') return null;
  return {
    mapId: m.mapId || 'world',
    x: clamp01(m.x),
    y: clamp01(m.y),
    icon: m.icon || null,
  };
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
