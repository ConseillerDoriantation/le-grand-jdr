// Helpers purs pour conserver fidèlement les valeurs d'une arme naturelle
// lorsqu'une créature du bestiaire est convertie en combattant VTT/éditeur.

/** Formule complète de l'arme, bonus fixe inclus une seule fois. */
export function naturalWeaponDamageFormula(weapon = {}, fallback = '') {
  let formula = String(weapon?.degats || fallback || '').trim();
  const flat = parseInt(weapon?.degatsFlat) || 0;
  if (flat && !/[+\-]\s*\d+\s*$/.test(formula)) {
    formula = `${formula}${flat > 0 ? ' +' : ' '}${flat}`.trim();
  }
  return formula;
}

/**
 * Valeurs de combat automatiques d'une arme naturelle.
 * Le toucher fixe appartient à l'arme : il doit s'ajouter au modificateur de
 * caractéristique, y compris lorsque la caractéristique vaut « aucune ».
 */
export function naturalWeaponCombatContext(weapon = {}, statModifier = () => 0) {
  const damageStat = weapon?.degatsStat || 'force';
  const touchStat = weapon?.toucherStat || damageStat;
  const damageStatMod = damageStat === 'none' ? 0 : (Number(statModifier(damageStat)) || 0);
  const touchStatMod = touchStat === 'none' ? 0 : (Number(statModifier(touchStat)) || 0);
  const touchFlat = parseInt(weapon?.toucherFlat) || 0;

  return {
    damageFormula: naturalWeaponDamageFormula(weapon, '1d4'),
    damageStat,
    touchStat,
    damageStatMod,
    touchStatMod,
    touchFlat,
    touchTotal: touchStatMod + touchFlat,
  };
}
