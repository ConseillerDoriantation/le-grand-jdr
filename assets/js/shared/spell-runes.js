export function runeCount(spell = {}, runeName) {
  return (spell?.runes || []).filter(r => r === runeName).length;
}

/**
 * Les anciens sorts n'ont pas ce champ : ils conservent donc la maîtrise.
 * Seule la valeur explicite `false` la désactive.
 */
export function usesSpellMastery(spell = {}) {
  return spell?.maitriseActive !== false;
}

/** La maîtrise d'un soin ne s'applique qu'à un noyau magique avec une stat active. */
export function usesHealingMastery(spell = {}, isMagic = false, statKey = '') {
  return usesSpellMastery(spell) && isMagic && !!statKey && statKey !== 'none';
}

const SPELL_MODIFIER_STATS = new Set([
  'force', 'dexterite', 'intelligence', 'sagesse', 'constitution', 'charisme',
]);
const SPELL_NO_MODIFIER_ALIASES = new Set(['none', 'non', 'aucun', 'aucune', 'sans']);

/**
 * Résout une statistique de sort sans écraser le choix explicite « aucune ».
 * `null` signifie qu'aucun modificateur ne doit être calculé ni affiché.
 */
export function resolveSpellModifierStat(spell = {}, field, fallback = '') {
  const override = String(spell?.[field] || '').trim().toLowerCase();
  if (SPELL_NO_MODIFIER_ALIASES.has(override)) return null;
  if (SPELL_MODIFIER_STATS.has(override)) return override;

  const fallbackKey = String(fallback || '').trim().toLowerCase();
  if (SPELL_NO_MODIFIER_ALIASES.has(fallbackKey)) return null;
  return SPELL_MODIFIER_STATS.has(fallbackKey) ? fallbackKey : null;
}

export function calcSpellTargets(spell = {}) {
  if (spell?.designMode === 'classic') return 1;
  const nbDisp = runeCount(spell, 'Dispersion');
  const nbAmp = runeCount(spell, 'Amplification');
  const nbAff = runeCount(spell, 'Affliction');
  const nbInv = runeCount(spell, 'Invocation');
  if (nbAmp > 0 && nbDisp > 0) return 1;
  if (nbAff > 0 && nbInv > 0 && nbDisp > 0) return 1;
  return nbDisp === 0 ? 1 : 1 + nbDisp;
}

export function calcSpellDuration(spell = {}) {
  if (spell?.designMode === 'classic') {
    return Math.max(0, parseInt(spell?.classicDuration ?? spell?.dureeBase) || 0);
  }
  const nbDur = runeCount(spell, 'Durée');
  const base = (spell?.dureeBase && spell.dureeBase >= 2) ? +spell.dureeBase : 2;
  const dur = base + (nbDur > 0 ? 2 * nbDur : 0);
  // Concentration (hors combo Réaction, qui stocke un sort instantané) : le sort
  // est maintenu tant que la concentration tient → durée longue par défaut (10
  // tours) au lieu des 2 tours persistants. Un override manuel supérieur l'emporte.
  if (runeCount(spell, 'Concentration') > 0 && runeCount(spell, 'Réaction') === 0) {
    return Math.max(10, dur);
  }
  return dur;
}
