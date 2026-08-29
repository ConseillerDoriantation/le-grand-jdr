import { isDirectAttackOption } from './vtt-attack-rules.js';

const _list = value => Array.isArray(value) ? value : (value ? [value] : []);

/** Formule de dégâts d'un état, avec progression éventuelle par niveau. */
export function conditionDamageFormula(effects = {}, level = 1, override = '') {
  if (String(override || '').trim()) return String(override).trim();
  const lvl = Math.max(1, parseInt(level, 10) || 1);
  const progression = Array.isArray(effects.dmgDealtBonusByLevel)
    ? effects.dmgDealtBonusByLevel
      .filter(row => Number.isFinite(parseInt(row?.minLevel, 10)) && String(row?.formula || '').trim())
      .sort((a, b) => parseInt(a.minLevel, 10) - parseInt(b.minLevel, 10))
    : [];
  let formula = String(effects.dmgDealtBonus || '').trim();
  progression.forEach(row => {
    if (lvl >= parseInt(row.minLevel, 10)) formula = String(row.formula).trim();
  });
  return formula;
}

/** Les filtres fins d'un état autorisent-ils son bonus sur cette attaque ? */
export function conditionDamageBonusApplies(effects = {}, option = {}) {
  if (effects.dmgDealtWeaponOnly && !isDirectAttackOption(option)) return false;
  const isMelee = typeof option.isMeleeAttack === 'boolean'
    ? option.isMeleeAttack
    : Math.max(0, Number(option.portee) || 0) <= 1;
  if (effects.dmgDealtMeleeOnly && !isMelee) return false;
  const required = String(effects.dmgDealtRequiredStat || '').trim();
  if (required) {
    const stats = _list(option.dmgStatKeys || option.dmgStatKey).map(String);
    if (!stats.includes(required)) return false;
  }
  return true;
}

/** Une réduction conditionnelle couvre-t-elle ce type de dégâts ? */
export function conditionDamageReductionApplies(effects = {}, damageTypeId = '') {
  const allowed = _list(effects.dmgReductionTypes).map(String).filter(Boolean);
  return !allowed.length || allowed.includes(String(damageTypeId || 'physique'));
}

/** Avantage/désavantage accordé par les états pour un test ou un JS de stat. */
export function conditionStatRollMode(activeConditions = [], statKey = '', kind = 'check') {
  const advKey = kind === 'save' ? 'saveAdvantageStats' : 'checkAdvantageStats';
  const disKey = kind === 'save' ? 'saveDisadvantageStats' : 'checkDisadvantageStats';
  let advantage = false;
  let disadvantage = false;
  activeConditions.forEach(entry => {
    const effects = entry?.lib?.effects || entry?.effects || {};
    if (_list(effects[advKey]).map(String).includes(statKey)) advantage = true;
    if (_list(effects[disKey]).map(String).includes(statKey)) disadvantage = true;
  });
  if (advantage && disadvantage) return 'normal';
  if (advantage) return 'advantage';
  if (disadvantage) return 'disadvantage';
  return '';
}
