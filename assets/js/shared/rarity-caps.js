// ══════════════════════════════════════════════════════════════════════════════
// RARITY-CAPS.JS — Plafonds de capacité imposés par la RARETÉ (logique pure).
//
// La rareté définie par le MJ est le plafond DUR : le plafond effectif d'un objet
// = min(plafond de catégorie, plafond de rareté). Une 1★ ne peut donc jamais
// égaler une 5★ ; on ne fait que remplir le budget de sa rareté.
//
// Aucune dépendance Firestore → testable directement (cf. tests/rarity-caps.test.js).
// ══════════════════════════════════════════════════════════════════════════════

// Clés = valeur de rareté (1..N, cf. rarity.js). 0 / non défini → traité comme 1 (commun).
export const DEFAULT_RARITY_CAPS = {
  traits: { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3 }, // slots de traits max par rareté
  stats:  { 1: 0, 2: 2, 3: 3, 4: 4, 5: 4 }, // points de stats max par rareté
};

// Plafonds PROPRES à l'anneau (profondeur, pas largeur) : il n'améliore que ses
// stats natives, avec un budget de points par rareté distinct du général, et un
// quota de traits plus serré. Table par aventure (upgrade_settings.rarityCaps.ring).
export const DEFAULT_RING_CAPS = {
  traits: { 1: 1, 2: 1, 3: 1, 4: 2, 5: 3 }, // slots de traits max par rareté
  stats:  { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }, // points de stats (sur ses stats natives)
};

// Plafond lu dans une table { rareté: plafond }. Rareté hors table → valeur définie
// la plus proche en dessous ; en dessous de la plus petite clé → la plus petite.
export function rarityCapFromTable(table, rarete) {
  const t = table && typeof table === 'object' ? table : {};
  const r = Math.max(1, parseInt(rarete) || 1);
  if (t[r] != null) return Math.max(0, parseInt(t[r]) || 0);
  const keys = Object.keys(t).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!keys.length) return 0;
  const below = keys.filter(k => k <= r);
  const pick = below.length ? below[below.length - 1] : keys[0];
  return Math.max(0, parseInt(t[pick]) || 0);
}
