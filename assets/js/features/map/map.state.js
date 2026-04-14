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
