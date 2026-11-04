// ══════════════════════════════════════════════════════════════════════════════
// REFORGE.JS — Monter la rareté d'un objet (logique pure).
//
// Option A : améliorer stats/traits reste LIBRE (sans salle) ; seule la reforge
// (monter la rareté d'un cran, définitif) est gatée derrière une salle du Bastion.
// Réutilise le mapping craft existant (discipline par catégorie, cf. craft-engine)
// et les recettes de matériaux du MJ. Aucune dépendance Firestore → testable.
// ══════════════════════════════════════════════════════════════════════════════
import { missingMaterials } from './craft-engine.js';

export const DEFAULT_REFORGE = {
  enabled: true,
  // Discipline de craft → slug de salle du Bastion (défauts = catalogue standard).
  disciplineRoom: { forge: 'forge', confection: 'atelier_confection', orfevre: 'atelier_orfevre' },
  // Rareté cible → niveau de salle requis (I/II/III). 5★ = salle maxée.
  roomLevelForRarity: { 2: 1, 3: 1, 4: 2, 5: 3 },
  // Rareté cible → coût en or.
  goldForRarity: { 2: 100, 3: 200, 4: 400, 5: 800 },
};

// Fusion défensive avec les défauts (champ par champ).
export function mergeReforge(stored = {}) {
  const d = DEFAULT_REFORGE;
  const s = stored && typeof stored === 'object' ? stored : {};
  return {
    enabled: s.enabled != null ? !!s.enabled : d.enabled,
    disciplineRoom:     { ...d.disciplineRoom,     ...(s.disciplineRoom     || {}) },
    roomLevelForRarity: { ...d.roomLevelForRarity, ...(s.roomLevelForRarity || {}) },
    goldForRarity:      { ...d.goldForRarity,      ...(s.goldForRarity      || {}) },
  };
}

/**
 * Évalue la reforge d'un objet vers la rareté SUIVANTE (pur). L'appelant résout
 * les entrées : rareté courante, maxRarete (plus haute rareté définie dans
 * l'aventure), discipline (forge/confection/orfevre), roomLevel (niveau construit
 * de la salle liée, 0 = non construite), materialReq [{itemId,quantite}] (recette
 * du MJ), inventory, gold, cfg (reforge settings de l'aventure).
 *
 * Sortie : { ok, target, roomSlug, requiredLevel, goldCost, materials, missing,
 *            roomOk, matOk, goldOk, reason }
 *   reason ∈ null | 'disabled' | 'max' | 'no_room_mapping' | 'room' | 'no_recipe'
 *           | 'materials' | 'gold'
 */
export function evaluateReforge({
  rarete, maxRarete = 5, discipline = null, roomLevel = 0,
  materialReq = [], inventory = [], gold = 0, cfg = null,
} = {}) {
  const c = mergeReforge(cfg);
  if (!c.enabled) return { ok: false, reason: 'disabled', target: null };

  const cur = Math.max(1, parseInt(rarete) || 1);
  const max = Math.max(1, parseInt(maxRarete) || 5);
  const target = cur + 1;
  if (target > max) return { ok: false, reason: 'max', target: null };

  const roomSlug = discipline ? (c.disciplineRoom?.[discipline] || null) : null;
  const requiredLevel = Math.max(1, parseInt(c.roomLevelForRarity?.[target]) || 1);
  const goldCost = Math.max(0, parseInt(c.goldForRarity?.[target]) || 0);
  const reqs = Array.isArray(materialReq) ? materialReq : [];
  const missing = missingMaterials(inventory, reqs);

  const roomOk = !!roomSlug && (parseInt(roomLevel) || 0) >= requiredLevel;
  const matOk  = reqs.length > 0 && missing.length === 0;
  const goldOk = (parseInt(gold) || 0) >= goldCost;

  let reason = null;
  if (!roomSlug)        reason = 'no_room_mapping';
  else if (!roomOk)     reason = 'room';
  else if (!reqs.length) reason = 'no_recipe';
  else if (!matOk)      reason = 'materials';
  else if (!goldOk)     reason = 'gold';

  return {
    ok: !!roomSlug && roomOk && matOk && goldOk,
    target, roomSlug, requiredLevel, goldCost,
    materials: reqs, missing, roomOk, matOk, goldOk, reason,
  };
}
