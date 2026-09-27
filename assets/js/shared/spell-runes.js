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

/**
 * Renvoie la ressource restaurée par une rune Protection, indépendamment du
 * type éditorial du sort. La rune et son mode sont la source de vérité : un
 * ancien sort sans `types: ['defensif']` doit rester un vrai soin dans le VTT.
 */
export function getProtectionRestoreMode(spell = {}) {
  return getProtectionModes(spell).find(mode => mode === 'soin' || mode === 'mana') || null;
}

// ── Affliction : mode effectif ──
// « faiblesse » (dégâts ×2 de l'élément du sort) exige 2 runes Affliction ; en
// dessous, le sort retombe sur le DoT par défaut (pas d'effet fantôme).
export const AFFLICTION_WEAKNESS_MIN_RUNES = 2;
export function getAfflictionMode(spell = {}) {
  const mode = spell?.afflictionMode || 'dot';
  if (mode === 'faiblesse' && runeCount(spell, 'Affliction') < AFFLICTION_WEAKNESS_MIN_RUNES) return 'dot';
  return mode;
}

/**
 * Profil de dégâts d'une cible, augmenté des faiblesses posées par Affliction
 * (éléments). Une faiblesse annule une résistance au même élément (dégâts
 * normaux) mais ne perce ni une immunité ni une absorption. Renvoie null si
 * rien à appliquer (ni profil, ni faiblesse).
 */
export function withElementWeaknesses(profile, weakTypes = []) {
  const weak = [...new Set((weakTypes || []).filter(Boolean))];
  if (!weak.length) return profile || null;
  const base = profile || {};
  const resistances = Array.isArray(base.resistances) ? base.resistances : [];
  const faiblesses = Array.isArray(base.faiblesses) ? base.faiblesses : [];
  return {
    ...base,
    resistances: resistances.filter(id => !weak.includes(id)),
    faiblesses: [...new Set([...faiblesses, ...weak.filter(id => !resistances.includes(id))])],
  };
}

// ── Protection multi-modes ───────────────────────────────────────────────────
// Chaque rune Protection porte UN mode (`protectionModes[i]`) : ajouter une rune
// renforce un mode existant ou en ouvre un nouveau (ex. Soin + CA). `protectionMode`
// reste le mode de la 1re rune (compat des anciens sorts et des combos).
export const PROTECTION_MODES = ['ca', 'soin', 'mana', 'reduction'];
const RESTORE_MODES = new Set(['soin', 'mana']);

/**
 * La répartition est coupée quand un combo absorbe Protection : Drain (sort
 * offensif), Régénération / Sentinelle (Affliction), Bouclier réactif (réaction).
 * Dans ces cas toutes les runes suivent le mode principal, comme avant.
 */
export function protectionSplitAllowed(spell = {}) {
  if (spell?.designMode === 'classic') return false;
  const types = Array.isArray(spell?.types) ? spell.types : [];
  if (types.includes('offensif')) return false;
  if (runeCount(spell, 'Affliction') > 0) return false;
  const runes = spell?.runes || [];
  if (runes.includes('Réaction')) return false;
  if (runes.includes('Déclenchement') && spell?.actionMode !== 'action_bonus') return false;
  return true;
}

/** Mode de chaque rune Protection (longueur = nombre de runes Protection). */
export function getProtectionModes(spell = {}) {
  const n = runeCount(spell, 'Protection');
  if (n <= 0) return [];
  const valid = mode => PROTECTION_MODES.includes(mode);
  const src = Array.isArray(spell?.protectionModes) ? spell.protectionModes : [];
  const primary = valid(src[0]) ? src[0] : (valid(spell?.protectionMode) ? spell.protectionMode : 'ca');
  if (!protectionSplitAllowed(spell)) return Array(n).fill(primary);
  const out = [primary];
  for (let i = 1; i < n; i += 1) {
    // Rune ajoutée sans choix explicite : elle renforce le mode principal.
    let mode = valid(src[i]) ? src[i] : primary;
    // Un seul jet de restauration par sort : Soin et PM s'excluent.
    const restore = out.find(m => RESTORE_MODES.has(m));
    if (RESTORE_MODES.has(mode) && restore && mode !== restore) mode = restore;
    out.push(mode);
  }
  return out;
}

export function protectionHasMode(spell = {}, mode) {
  return getProtectionModes(spell).includes(mode);
}

/**
 * Nombre de runes Protection qui alimentent `mode`. Un sort à mode unique garde
 * TOUTES ses runes (comportement historique, quel que soit le mode demandé).
 */
export function protectionRunesFor(spell = {}, mode) {
  const modes = getProtectionModes(spell);
  if (new Set(modes).size <= 1) return modes.length;
  return modes.filter(m => m === mode).length;
}

/** Sort multi-modes réel (au moins deux modes différents). */
export function isProtectionMultiMode(spell = {}) {
  return new Set(getProtectionModes(spell)).size > 1;
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
  const nbAff = runeCount(spell, 'Affliction');
  const nbInv = runeCount(spell, 'Invocation');
  // Modèle zones v2 : Dispersion = nombre de poses (zone OU cible). Amp+Disp ne
  // « fond » plus la Dispersion dans la largeur → elle multiplie les zones (1+nDisp).
  // Exception Sentinelle (Affliction+Invocation) : une seule sentinelle porte l'effet.
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
