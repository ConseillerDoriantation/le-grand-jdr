// ══════════════════════════════════════════════════════════════════════════════
// shared/spell-math.js — Cœurs PURS du calcul de sorts (sans DOM ni Firebase).
//
// Extrait de features/characters/spells-calc.js pour être testable « à froid »
// (node:test). Ces fonctions ne lisent QUE l'objet sort `s` (runes / champs).
// spells-calc.js les importe et les ré-exporte → API publique inchangée.
// ══════════════════════════════════════════════════════════════════════════════

/** DoT d'affliction effectif (mode DoT). Manuel si fourni, sinon (1+nbPuiss)d4 +2. */
export function _calcAfflictionDot(s) {
  const manual = (s?.afflictionDotFormula || '').trim();
  if (manual) return manual;
  const nbPuiss = (s?.runes || []).filter(r => r === 'Puissance').length;
  const dice = 1 + nbPuiss;
  return `${dice}d4 +2`;
}

/** Libellé "source" du DoT auto (info UI). */
export function _autoSourceAfflictionDot(s) {
  const nbP = (s?.runes || []).filter(r => r === 'Puissance').length;
  if (nbP === 0) return '1 Affliction · base';
  if (nbP === 1) return '+1 Puiss · 1 dé bonus';
  return `+${nbP} Puiss · ${nbP} dés bonus`;
}

/** Dégâts bonus d'Enchantement (mode Dégâts). Vide en mode État. */
export function _calcEnchantDegats(s) {
  if ((s.enchantMode || 'dmg') === 'etat') return '';
  const manual = (s.enchantDegats || '').trim();
  if (manual) return manual;
  const nbPuiss = (s.runes || []).filter(r => r === 'Puissance').length;
  return `${1 + nbPuiss}d4 +2`;
}

/** Le sort présente-t-il une lacération (branche Affliction ou ancienne rune) ? */
export function _hasLaceration(s) {
  const r = s?.runes || [];
  return r.includes('Lacération')
      || (s?.afflictionMode === 'laceration' && r.includes('Affliction'));
}

/** Lacération : réduction CA cible = -1 par rune Affliction (plafond jeu -2 / -4). */
export function _calcLaceration(s) {
  const r = s?.runes || [];
  const nb = (s?.afflictionMode === 'laceration' && r.includes('Affliction'))
    ? r.filter(x => x === 'Affliction').length
    : r.filter(x => x === 'Lacération').length;
  if (!nb) return null;
  return { runes: nb, reduction: nb, max: 2, maxElite: 4 };
}

/** Chance : réduction RC critique, plafonnée à 17-20 (×1→19 · ×2→18 · ×3+→17). */
export function _calcChance(s) {
  const nb = (s.runes || []).filter(r => r === 'Chance').length;
  if (!nb) return null;
  const reduction = Math.min(nb, 3);
  return { runes: nb, rc: 20 - reduction, reduction, capped: nb > 3 };
}

/** Drain : % des dégâts soigné au lanceur = 25% + 25% × nbProtection. */
export function _calcDrainPct(s) {
  const runes = s?.runes || [];
  const nbProt = runes.filter(r => r === 'Protection').length;
  if (!nbProt) return 0;
  return 0.25 + 0.25 * nbProt;
}

/** DD du JS de concentration : 11 - 2×(n-1), minimum 5. */
export function _calcConcentrationDD(s) {
  const nb = (s?.runes || []).filter(r => r === 'Concentration').length;
  if (!nb) return null;
  return Math.max(5, 11 - 2 * (nb - 1));
}
