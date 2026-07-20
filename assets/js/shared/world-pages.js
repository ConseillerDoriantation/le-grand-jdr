// ══════════════════════════════════════════════════════════════════════════════
// WORLD-PAGES.JS — Contenu « diapo » (free-page) des sections du Guide, DANS DES
// DOCUMENTS DÉDIÉS.
//
// world/main est UN seul doc partagé par toutes les sections → y mettre un deck
// free-page (images base64) par section ferait exploser la limite Firestore de
// 1 Mo. On déporte le contenu de chaque section dans `worldPages/{sectionId}`
// (1 doc/section) → budget de 1 Mo INDÉPENDANT par section.
//
// world/main ne garde que les MÉTADONNÉES légères (titre, icône, bannière,
// visibilité, catégorie) + le `contenu` legacy (HTML rich-text) tant qu'une
// section n'a pas été ré-éditée → repli et auto-migration au 1er enregistrement.
//
// Session-live via _LAZY_SESSION_COLLECTIONS (0 lecture en plus). Miroir de
// shared/character-pages.js.
// ══════════════════════════════════════════════════════════════════════════════
import { subscribeCollection, saveDoc, deleteFromCol } from '../data/firestore.js';

const _cache = new Map(); // sectionId -> page (deck free-page)
let _ready = false;
let _unsub = null;
const _listeners = new Set();

// Monté une fois par session d'aventure (core/adventure.js).
export function initWorldPages() {
  teardownWorldPages();
  _unsub = subscribeCollection('worldPages', (docs) => {
    _cache.clear();
    (docs || []).forEach((d) => { if (d?.id) _cache.set(d.id, d.page || null); });
    _ready = true;
    _listeners.forEach((fn) => { try { fn(); } catch (_) {} });
  });
}

export function teardownWorldPages() {
  try { _unsub?.(); } catch (_) {}
  _unsub = null;
  _ready = false;
  _cache.clear();
}

export function onWorldPagesChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// Deck effectif d'une section : le doc dédié en priorité, sinon rien (le legacy
// `contenu` HTML est géré côté world.js, hors de ce store).
export function worldPageFor(sectionId) {
  if (!sectionId) return null;
  if (_ready && _cache.has(sectionId)) return _cache.get(sectionId) || null;
  return null;
}

export function setCachedWorldPage(sectionId, page) {
  _cache.set(sectionId, page || null);
}

export async function saveWorldPage(sectionId, page) {
  await saveDoc('worldPages', sectionId, { page: page || null, updatedAt: Date.now() });
  setCachedWorldPage(sectionId, page);
}

export async function deleteWorldPage(sectionId) {
  _cache.delete(sectionId);
  try { await deleteFromCol('worldPages', sectionId); } catch (_) { /* absent = OK */ }
}
