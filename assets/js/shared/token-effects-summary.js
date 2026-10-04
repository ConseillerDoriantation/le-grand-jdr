function effectOf(condition) {
  return condition?.effects || condition?.lib?.effects || {};
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
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
