// ══════════════════════════════════════════════════════════════════════════════
// CHARACTER-PAGES.JS — Stockage de la bio « diapo » DANS SON PROPRE DOCUMENT.
//
// Firestore plafonne un document à 1 Mo. La bio (free-page, images base64) vivait
// sur le doc perso, à côté de l'inventaire/builds → un deck riche faisait dépasser
// la limite et bloquait TOUTE écriture du perso. On la déporte dans une collection
// dédiée `characterPages/{charId}` (1 doc/perso) → budget de 1 Mo INDÉPENDANT.
//
// Rétro-compat : tant qu'un perso n'a pas été ré-enregistré, sa bio reste sur
// `character.bioPage` (legacy) et `bioPageFor` y retombe. La migration est
// automatique au 1er enregistrement (déplacement + effacement du champ legacy).
//
// Session-live : `characterPages` est dans _LAZY_SESSION_COLLECTIONS (0 lecture
// en plus après le 1er snapshot). Un seul abonnement par session d'aventure.
// ══════════════════════════════════════════════════════════════════════════════
import { subscribeCollection, saveDoc } from '../data/firestore.js';

const _cache = new Map(); // charId -> bioPage (deck), depuis le snapshot session-live
let _ready = false;
let _unsub = null;
const _listeners = new Set();

// Monté une fois par session d'aventure (core/adventure.js). Abonne le snapshot
// session-live et notifie les vues (fiche/roster) quand les bios arrivent.
export function initCharacterPages() {
  teardownCharacterPages();
  _unsub = subscribeCollection('characterPages', (docs) => {
    _cache.clear();
    (docs || []).forEach((d) => { if (d?.id) _cache.set(d.id, d.bioPage || null); });
    _ready = true;
    _listeners.forEach((fn) => { try { fn(); } catch (_) {} });
  });
}

export function teardownCharacterPages() {
  try { _unsub?.(); } catch (_) {}
  _unsub = null;
  _ready = false;
  _cache.clear();
}

// Enregistre un rappel déclenché à chaque mise à jour des bios (pour re-render).
// Renvoie une fonction de désabonnement.
export function onCharacterPagesChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// bioPage effectif d'un perso : le doc dédié en priorité, sinon le champ legacy
// (perso non encore migré, ou cache pas encore prêt → on ne perd jamais la bio).
export function bioPageFor(char) {
  if (!char) return null;
  if (_ready && _cache.has(char.id)) return _cache.get(char.id) || null;
  return char.bioPage || null;
}

// Patch local immédiat (rendu sans attendre le prochain snapshot).
export function setCachedBioPage(charId, bioPage) {
  _cache.set(charId, bioPage || null);
}

// Écrit la bio dans son doc dédié. Peut lever (ex. permission-denied si la règle
// Firestore n'est pas encore déployée) → l'appelant gère le repli.
export async function saveCharacterPage(charId, bioPage) {
  await saveDoc('characterPages', charId, { bioPage: bioPage || null, updatedAt: Date.now() });
  setCachedBioPage(charId, bioPage);
}
