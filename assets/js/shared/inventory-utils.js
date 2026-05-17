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
