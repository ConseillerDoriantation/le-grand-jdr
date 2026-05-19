// ══════════════════════════════════════════════════════════════════════════════
// inventory-utils.js — Convention "1 entrée = 1 unité"
//
// Toute l'app suppose : chaque entrée de `c.inventaire` = 1 unité d'objet.
// Les actions (vendre, supprimer, envoyer, déposer) utilisent `indices.length`
// comme quantité max et splicent une entrée par unité consommée.
//
// Cette utilité **normalise** : si une entrée a `qte > 1`, on la split en
// N entrées de qte=1 pour garantir la cohérence des comptes.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Normalise un tableau d'inventaire à la convention "1 entrée = 1 unité".
 * Retourne le tableau normalisé (potentiellement plus long).
 *
 * Idempotent : si tout est déjà à qte=1, retourne le tableau d'origine inchangé.
 */
export function normalizeInventaire(inv) {
  if (!Array.isArray(inv)) return inv;
  // Détecte la nécessité de normaliser (un seul passage)
  const needsNorm = inv.some(it => (parseInt(it?.qte) || 1) > 1);
  if (!needsNorm) return inv;

  const out = [];
  for (const item of inv) {
    if (!item || typeof item !== 'object') { out.push(item); continue; }
    const qte = Math.max(1, parseInt(item.qte) || 1);
    if (qte === 1) {
      out.push(item);
      continue;
    }
    // Split en N entrées de qte=1 — préserve toutes les autres propriétés (rareté, upgrades, etc.)
    for (let i = 0; i < qte; i++) {
      out.push({ ...item, qte: 1 });
    }
  }
  return out;
}

/** True si l'inventaire contient au moins une entrée à qte > 1. */
export function inventaireNeedsNorm(inv) {
  if (!Array.isArray(inv)) return false;
  return inv.some(it => (parseInt(it?.qte) || 1) > 1);
}

// ══════════════════════════════════════════════════════════════════════════════
// SOURCE UNIQUE DE VÉRITÉ : item boutique → entrée d'inventaire.
//
// À utiliser à TOUS les points qui copient un item de la boutique vers
// l'inventaire d'un perso (achat, butin, cadeau MJ, conversion stash → inventaire).
// Ainsi tout nouveau champ ajouté au schéma boutique est automatiquement propagé
// — plus besoin de maintenir 3+ listes de champs synchronisées.
//
// Champs explicitement EXCLUS (méta boutique, non pertinents en inventaire) :
//   id  (devient itemId)  ·  image  ·  dispo  ·  recipeMeta  ·  prix  ·  categorieId (conservé)
// Tout le reste de l'item est conservé tel quel via spread.
// ══════════════════════════════════════════════════════════════════════════════
const _DEEP_CLONE_FIELDS = ['traits', 'degatsStats', 'actions'];

export function shopItemToInvEntry(item, opts = {}) {
  if (!item || typeof item !== 'object') return null;
  const source     = opts.source     ?? 'boutique';
  const template   = opts.template   ?? item.template   ?? 'classique';
  const prixAchat  = opts.prixAchat  ?? item.prix       ?? item.prixAchat  ?? 0;
  const prixVente  = opts.prixVente  ?? item.prixVente  ?? Math.round((parseFloat(prixAchat) || 0) * 0.6);

  // Spread complet de l'item — capture tous les champs présents et futurs.
  const entry = { ...item };

  // Méta boutique à ne PAS coller en inventaire
  delete entry.id;        // id Firestore boutique, on garde la trace via itemId ci-dessous
  delete entry.image;     // image de boutique (généralement gros base64) — non utilisée en inventaire
  delete entry.dispo;     // stock boutique, sans rapport
  delete entry.recipeMeta;
  delete entry.prix;      // remplacé par prixAchat

  // Clone profond des champs collection pour éviter le partage de référence
  _DEEP_CLONE_FIELDS.forEach(k => {
    if (Array.isArray(item[k])) entry[k] = item[k].map(x => (x && typeof x === 'object') ? { ...x } : x);
  });

  // Surcharge avec les champs canoniques inventaire
  // Préfère `itemId` quand il existe déjà (cas d'un re-snapshot depuis loot/inventaire,
  // où `id` est un UUID local sans rapport avec la boutique).
  entry.itemId = item.itemId || item.id || '';
  entry.source = source;
  entry.template = template;
  entry.qte = '1'; // convention "1 entrée = 1 unité"
  entry.prixAchat = parseFloat(prixAchat) || 0;
  entry.prixVente = parseFloat(prixVente) || 0;

  return entry;
}
