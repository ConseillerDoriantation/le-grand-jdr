// ══════════════════════════════════════════════════════════════════════════════
// État central du module Carte + pub/sub minimaliste.
// Aucun module ne doit muter directement window/globals : tout passe par ici.
// ══════════════════════════════════════════════════════════════════════════════

const listeners = new Map();

export const state = {
  activeMapId: 'world',
  map: null,               // { imageUrl, regionName, ... }
  places: [],              // liste normalisée (new + legacy fusionnés)
  organizations: [],
  types: [],               // types de lieux (collection ou fallback)
  fogZones: [],            // zones de brouillard, format [{ pts:[{x,y}] }] en %
  selection: null,         // { kind:'place'|'org', id } | null
  mode: 'navigate',        // 'navigate' | 'placing' | 'repositioning' | 'fog'
  modeContext: null,       // { placeId } selon le mode
  filters: {
    types: new Set(),
    onlyRevealed: false,
    query: '',
  },
  viewport: { scale: 1, offsetX: 0, offsetY: 0 },
};

export function on(event, cb) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(cb);
  return () => listeners.get(event).delete(cb);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  set.forEach(cb => {
    try { cb(payload); } catch (e) { console.error(`[map.state] listener "${event}"`, e); }
  });
}

export function resetListeners() {
  listeners.clear();
}

// ── Helpers de lecture ────────────────────────────────────────────────────────
export const getPlaceById = id => state.places.find(p => p.id === id) || null;

export const getOrgById = id => state.organizations.find(o => o.id === id) || null;

export const getOrgsOfPlace = placeId =>
  state.organizations.filter(o => o.placeId === placeId);

export function getTypeMeta(typeId) {
  return state.types.find(t => t.id === typeId)
    || { id: typeId, label: typeId || 'Inconnu', icon: '📍', color: '#888' };
}

// Facteur de contre-zoom appliqué aux éléments qui doivent rester lisibles
// quelle que soit l'échelle (marqueurs, boutons d'édition sur la carte).
// Formule : z ^ -EXP  (avec EXP < 1)
// - EXP < 1 ⇒ la taille à l'écran croît doucement avec le zoom et décroît au
//   dézoom (screen = r · z^(1-EXP), monotone, très plate).
// - 0.93 donne environ -10 % au dézoom max et +10 % au zoom max par rapport
//   à la taille de base (r=14), avec ~1.5 % de variation par cran de molette.
export function getMarkerScale() {
  const z = state.viewport?.scale || 1;
  return Math.pow(z, -0.93);
}
