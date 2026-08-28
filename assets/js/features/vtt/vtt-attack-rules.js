// Règles pures communes aux options d'attaque du VTT.

/** Une action reçoit-elle les bonus offensifs actifs du lanceur
 * (état Renforcé, enchantement de dégâts, etc.) ? */
export function receivesOffensiveDamageBonus(option) {
  if (!option) return false;
  const id = String(option.id || '');
  const isDirectAttack = id === 'weapon'
    || id === 'weapon_secondary'
    || id === 'npc_attack'
    || id === 'summon_attack'
    || id.startsWith('beast_');
  const isStandardAction = !option.actionType || option.actionType === 'action';
  return isStandardAction && (isDirectAttack || option.sortIdx !== undefined);
}
