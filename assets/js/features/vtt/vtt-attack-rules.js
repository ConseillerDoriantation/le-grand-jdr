// Règles pures communes aux options d'attaque du VTT.

export function isDirectAttackOption(option) {
  if (!option) return false;
  const id = String(option.id || '');
  return id === 'weapon'
    || id === 'weapon_secondary'
    || id === 'npc_attack'
    || id === 'summon_attack'
    || id.startsWith('beast_');
}

/** Une action reçoit-elle les bonus offensifs actifs du lanceur
 * (état Renforcé, enchantement de dégâts, etc.) ? */
export function receivesOffensiveDamageBonus(option) {
  if (!option) return false;
  const isDirectAttack = isDirectAttackOption(option);
  const isStandardAction = !option.actionType || option.actionType === 'action';
  return isStandardAction && (isDirectAttack || option.sortIdx !== undefined);
}
