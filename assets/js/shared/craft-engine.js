// ══════════════════════════════════════════════════════════════════════════════
// SHARED / CRAFT-ENGINE.JS — Logique PURE du craft génératif d'équipement
// Aucune dépendance, aucun accès Firestore/DOM → testable sous Node.
// Réf. conception : docs/craft-redesign.md
//
// Types d'objet manipulés (clés) :
//   armeCaC · armeDist · armeMagique · armureLegere · armureIntermediaire ·
//   armureLourde · anneau · amulette
// Paliers : 1 | 2 | 3  (★ / ★★ / ★★★ → rareté 1★ / 2★ / 3★)
// Disciplines : forge · confection · orfevre
// ══════════════════════════════════════════════════════════════════════════════

/** Configuration par défaut (surchargée par world/craft_config côté app). */
export const DEFAULT_CRAFT_CONFIG = {
  // Catégorie d'objet → discipline (éditable par le MJ).
  categorieDiscipline: {
    armeCaC: 'forge', armeDist: 'confection', armeMagique: 'orfevre',
    armureLegere: 'confection', armureIntermediaire: 'confection', armureLourde: 'forge',
    anneau: 'orfevre', amulette: 'orfevre',
  },
  // Discipline → id de compétence (Jets 🎲) ; vide tant que le MJ n'a pas relié.
  disciplineCompetence: { forge: '', confection: '', orfevre: '' },
  // Catégorie d'objet → catégorie de matériau.
  categorieMateriau: {
    armeCaC: 'bestiaux', armeDist: 'souples', armeMagique: 'mystiques',
    armureLegere: 'legers', armureIntermediaire: 'tannes', armureLourde: 'resistants',
    anneau: 'precieux', amulette: 'precieux',
  },
  ddParPalier:       { 1: 11, 2: 14, 3: 17 },
  quantiteParPalier: { 1: 6,  2: 10, 3: 15 },
};

// Emplacement de l'objet → POOL de traits piochables au craft.
// Les 3 slots d'armure partagent un pool commun ('armure') ; arme, anneau et
// amulette restent isolés (cf. décision de conception).
const _TRAIT_POOL = {
  armeCaC: 'arme', armeDist: 'arme', armeMagique: 'arme',
  armureLegere: 'armure', armureIntermediaire: 'armure', armureLourde: 'armure',
  anneau: 'anneau', amulette: 'amulette',
};

const _CFG = (config) => ({ ...DEFAULT_CRAFT_CONFIG, ...(config || {}) });
const _tier = (t) => { const n = parseInt(t, 10); return (n === 1 || n === 2 || n === 3) ? n : null; };

/** Discipline (forge/confection/orfevre) requise pour fabriquer ce type d'objet. */
export function craftDiscipline(objType, config) {
  return _CFG(config).categorieDiscipline?.[objType] || null;
}

/** Id de compétence (Jets 🎲) associé à la discipline de ce type d'objet ('' si non relié). */
export function craftCompetenceId(objType, config) {
  const cfg = _CFG(config);
  const disc = cfg.categorieDiscipline?.[objType];
  return (disc && cfg.disciplineCompetence?.[disc]) || '';
}

/** Catégorie de matériau consommée par ce type d'objet ('bestiaux', 'legers', …). */
export function craftMaterialCategory(objType, config) {
  return _CFG(config).categorieMateriau?.[objType] || null;
}

/** DD du jet d'Artisanat pour un palier (1/2/3). */
export function craftDD(tier, config) {
  const t = _tier(tier); if (!t) return null;
  return _CFG(config).ddParPalier?.[t] ?? DEFAULT_CRAFT_CONFIG.ddParPalier[t];
}

/** Quantité de matériaux requise pour un palier (1/2/3). */
export function craftMaterialQty(tier, config) {
  const t = _tier(tier); if (!t) return 0;
  return _CFG(config).quantiteParPalier?.[t] ?? DEFAULT_CRAFT_CONFIG.quantiteParPalier[t];
}

/**
 * Exigence complète en matériaux pour fabriquer `objType` au palier `tier` :
 * { matCategorie, tier, quantite }. Retourne null si type/palier invalide.
 */
export function craftMaterialRequirement(objType, tier, config) {
  const t = _tier(tier); if (!t) return null;
  const matCategorie = craftMaterialCategory(objType, config);
  if (!matCategorie) return null;
  return { matCategorie, tier: t, quantite: craftMaterialQty(t, config) };
}

/** true si l'inventaire couvre l'exigence (compte des unités {matCategorie, tier}). */
export function hasCraftMaterials(inventory, requirement) {
  if (!requirement) return false;
  const have = (Array.isArray(inventory) ? inventory : []).filter(it =>
    it && it.matCategorie === requirement.matCategorie && parseInt(it.tier, 10) === requirement.tier
  ).length;
  return have >= requirement.quantite;
}

/**
 * Résout le jet d'Artisanat. `d20` = 1..20, `competenceBonus` = bonus de la
 * compétence de discipline. Retourne { d20, total, dd, success }.
 */
export function resolveCraftRoll(d20, competenceBonus, tier, config) {
  const roll = Math.max(1, Math.min(20, parseInt(d20, 10) || 0));
  const bonus = parseInt(competenceBonus, 10) || 0;
  const dd = craftDD(tier, config);
  const total = roll + bonus;
  return { d20: roll, total, dd, success: dd != null && total >= dd };
}

/** Matériaux rendus en cas d'échec : moitié, arrondi inférieur. */
export function craftRefundOnFail(quantite) {
  return Math.floor((parseInt(quantite, 10) || 0) / 2);
}

/** Pool de traits ('arme'|'armure'|'anneau'|'amulette') pour un type d'objet. */
export function traitPoolFor(objType) {
  return _TRAIT_POOL[objType] || null;
}

/**
 * Traits piochables pour `objType` au palier `tier`, filtrés depuis `traitsData`
 * (world/craft_traits). Fusionne les 3 slots d'armure via le pool 'armure'.
 */
export function craftableTraits(objType, tier, traitsData) {
  const t = _tier(tier); if (!t) return [];
  const pool = traitPoolFor(objType); if (!pool) return [];
  return (Array.isArray(traitsData) ? traitsData : [])
    .filter(tr => tr && tr.portee === pool && parseInt(tr.tier, 10) === t);
}

/** true si `trait` est autorisé sur `objType` (même pool + même palier). */
export function isTraitAllowed(trait, objType, tier) {
  if (!trait) return false;
  const t = _tier(tier);
  return trait.portee === traitPoolFor(objType) && parseInt(trait.tier, 10) === t;
}
