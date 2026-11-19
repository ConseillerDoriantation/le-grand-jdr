function effectOf(condition) {
  return condition?.effects || condition?.lib?.effects || {};
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/** Retourne le ton visuel d'un état ou d'un effet actif. */
export function tokenEffectTone(item = {}) {
  if (item?.type === 'suspended_spell') return 'neutral';
  if (['dot', 'move_debuff', 'affliction'].includes(item?.type)) return 'negative';
  if (item.kind === 'effect') return 'positive';
  const effects = effectOf(item);
  if (item.kind === 'condition' || item.cond || item.effects || item.lib?.effects) {
    return effects?.attackBy === 'adv' ? 'positive' : 'negative';
  }
  return 'positive';
}

/**
 * Explique une valeur déjà calculée par le VTT sans la recalculer. La base est
 * déduite par soustraction afin que base + modificateurs reste strictement égal
 * à la valeur affichée, même si la logique métier évolue ailleurs.
 */
export function explainTokenStat(kind, { value = 0, conditions = [], buffs = [], manual = 0 } = {}) {
  const shown = numberOrZero(value);
  const mods = [];
  let zeroBy = null;
  const add = (delta, label) => {
    const amount = numberOrZero(delta);
    if (amount) mods.push([amount, String(label || 'Effet')]);
  };

  if (kind === 'move') {
    (Array.isArray(conditions) ? conditions : []).forEach(condition => {
      const effects = effectOf(condition);
      const label = condition?.label || condition?.lib?.label || condition?.name || condition?.id || 'État';
      if (effects?.movementMod === 0 && !zeroBy) zeroBy = label;
      add(effects?.movementBonus, label);
    });
    (Array.isArray(buffs) ? buffs : [])
      .filter(buff => !buff?.manual && (buff?.type === 'move_bonus' || buff?.type === 'move_debuff'))
      .forEach(buff => add(buff?.bonus, buff?.sortLabel || buff?.label || 'Effet'));
  } else if (kind === 'ca') {
    (Array.isArray(buffs) ? buffs : [])
      .filter(buff => !buff?.manual && buff?.type === 'ca')
      .forEach(buff => add(buff?.bonus, buff?.sortLabel || buff?.label || 'Effet'));
  } else if (kind === 'range') {
    (Array.isArray(buffs) ? buffs : [])
      .filter(buff => !buff?.manual && buff?.type === 'range_bonus')
      .forEach(buff => add(buff?.bonus, buff?.sortLabel || buff?.label || 'Effet'));
  }
  add(manual, 'manuel');
  const known = mods.reduce((total, [delta]) => total + delta, 0);
  return { value: shown, parts: [[shown - known, 'base'], ...mods], zeroBy };
}

/**
 * Résume les conséquences tactiques visibles d'une liste d'états et d'effets.
 * Fonction volontairement pure : le VTT enrichit les états avec leur définition
 * avant l'appel, sans lecture de STATE, du DOM ou de Firestore.
 */
export function summarizeTokenEffects(conditions = [], buffs = []) {
  const conditionEffects = (Array.isArray(conditions) ? conditions : []).map(effectOf);
  const activeBuffs = Array.isArray(buffs) ? buffs : [];
  const summary = [];
  const add = (label, tone) => {
    if (!summary.some(item => item.label === label)) summary.push({ label, tone });
  };
  const first = key => conditionEffects.map(effect => effect?.[key]).find(value => value != null);

  if (conditionEffects.some(effect => effect?.cantAct)) add('Aucune action', 'negative');
  if (conditionEffects.some(effect => effect?.movementMod === 0)) add('Vitesse 0', 'negative');

  const movement = conditionEffects.reduce((total, effect) => total + numberOrZero(effect?.movementBonus), 0)
    + activeBuffs
      .filter(buff => buff?.type === 'move_debuff' || buff?.type === 'move_bonus')
      .reduce((total, buff) => total + numberOrZero(buff?.bonus), 0);
  if (movement < 0) add(`−${Math.abs(movement)} cases`, 'negative');
  if (movement > 0) add(`+${movement} cases`, 'positive');

  if (first('attackBy') === 'dis') add('Désavantage à ses attaques', 'negative');
  if (first('attackBy') === 'adv') add('Avantage à ses attaques', 'positive');
  if (first('attackAgainst') === 'adv') add('Avantage contre lui', 'negative');
  if (first('attackAgainst') === 'dis') add('Désavantage contre lui', 'positive');

  if (activeBuffs.some(buff => buff?.type === 'dot')) add('Subit des dégâts / tour', 'negative');
  if (activeBuffs.some(buff => buff?.type === 'regen')) add('Régénère / tour', 'positive');
  if (activeBuffs.some(buff => buff?.type === 'ca')) add('CA bonifiée', 'positive');
  if (activeBuffs.some(buff => buff?.type === 'enchantment')) add('Arme enchantée', 'positive');

  return summary;
}
