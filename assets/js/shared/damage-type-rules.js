const DEFAULT_ATTACK_RULES = { missEffect: 'none', missScope: 'always' };

function _damageTypeById(types, id) {
  return (types || []).find(type => type.id === id) || null;
}

/**
 * Indique si une attaque relève d'une application magique.
 *
 * Le type de dégâts est déterminant : une attaque de créature en Feu doit être
 * traitée comme une attaque magique si Feu est configuré comme tel, même si la
 * créature n'utilise ni arme de personnage ni points de mana.
 */
export function isMagicDamageDelivery(option, types) {
  if (!option) return false;
  if (option.isMagicDelivery === true || option.isMagicWeapon === true || option.pmCost > 0) return true;
  return _damageTypeById(types, option.damageTypeId)?.isMagic === true;
}

/** Résout les dégâts à appliquer sur un échec pour n'importe quel attaquant. */
export function getAttackMissEffect(option, types) {
  const typeRules = _damageTypeById(types, option?.damageTypeId)?.rules;
  const rules = { ...DEFAULT_ATTACK_RULES, ...(typeRules || {}), ...(option?.typeRules || {}) };
  const missEffect = rules.missEffect || 'none';
  if (missEffect === 'none') return 'none';

  const isMagic = isMagicDamageDelivery(option, types);
  if (rules.missScope === 'magic') return isMagic ? missEffect : 'none';
  if (rules.missScope === 'physical') return isMagic ? 'none' : missEffect;
  return missEffect;
}
