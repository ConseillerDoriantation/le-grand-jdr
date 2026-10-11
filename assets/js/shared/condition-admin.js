import {
  CONDITION_DEFAULT_LIBRARY,
  CONDITION_DEFAULT_IDS,
  CONDITION_BALANCE_VERSION,
  conditionSpellRunes,
  mergeConditionLibrary,
} from './conditions.js';

export const CONDITION_ADMIN_STATS = [
  ['force', 'For'], ['dexterite', 'Dex'], ['constitution', 'Con'],
  ['intelligence', 'Int'], ['sagesse', 'Sag'], ['charisme', 'Cha'],
];

export const CONDITION_ADMIN_PALETTE = [
  '#ef4444', '#f59e0b', '#facc15', '#22c55e', '#38bdf8', '#0ea5e9',
  '#818cf8', '#a855f7', '#ec4899', '#94a3b8', '#78716c', '#0f172a',
];

export const CONDITION_ADMIN_MIRRORS = [
  ['guided', 'blinded'], ['empowered', 'weakened'],
  ['swift', 'slowed'], ['melee_ward', 'marked'],
];

export const CONDITION_EFFECT_GROUPS = Object.freeze({
  attack: 'Attaques', rolls: 'Jets', movement: 'Déplacement',
  actions: 'Actions', damage: 'Dégâts', ending: 'Fin de l’état',
});

// N’expose que les clés réellement consommées par le moteur VTT. Les anciennes
// clés purement descriptives restent conservées par l’éditeur, mais ne sont pas
// proposées comme si elles produisaient encore un effet automatique.
export const CONDITION_EFFECT_CATALOG = Object.freeze([
  { key: 'attackBy', group: 'attack', type: 'tri', label: 'Ses attaques' },
  { key: 'attackAgainst', group: 'attack', type: 'tri', label: 'Attaques contre lui' },
  { key: 'attackAgainstMelee', group: 'attack', type: 'tri', label: 'Attaques au contact contre lui', hint: '≤ 1,5 m' },
  { key: 'attackAgainstRanged', group: 'attack', type: 'tri', label: 'Attaques à distance contre lui' },
  { key: 'critRangeBonus', group: 'attack', type: 'number', label: 'Critique élargi', unit: 'RC −', defaultValue: 1, min: 1, max: 3 },
  { key: 'tauntLock', group: 'attack', type: 'flag', label: 'Doit viser le porteur de l’aggro' },
  { key: 'saveAdvantageStats', group: 'rolls', type: 'stats', label: 'Avantage aux JS' },
  { key: 'saveDisadvantageStats', group: 'rolls', type: 'stats', label: 'Désavantage aux JS' },
  { key: 'checkAdvantageStats', group: 'rolls', type: 'stats', label: 'Avantage aux tests' },
  { key: 'movementBonus', group: 'movement', type: 'number', label: 'Déplacement', unit: 'cases', defaultValue: 2, min: -10, max: 10 },
  { key: 'rangeBonus', group: 'movement', type: 'number', label: 'Portée d’attaque', unit: 'cases', defaultValue: 2, min: -10, max: 10 },
  { key: 'cantCastSpells', group: 'actions', type: 'flag', label: 'Ne peut pas lancer de sort' },
  { key: 'breakConcentration', group: 'actions', type: 'flag', label: 'Rompt sa concentration' },
  { key: 'dmgTakenBonus', group: 'damage', type: 'dice', label: 'Dégâts subis en plus', defaultValue: '1d6' },
  { key: 'dmgReductionPct', group: 'damage', type: 'percent', label: 'Dégâts subis réduits', defaultValue: 50, min: 10, max: 100 },
  { key: 'dmgDealtBonus', group: 'damage', type: 'dice', label: 'Dégâts infligés en plus', defaultValue: '1d4' },
  { key: 'dmgDealtMalus', group: 'damage', type: 'dice', label: 'Dégâts infligés en moins', defaultValue: '1d4' },
  { key: 'consumedByAttackAgainst', group: 'ending', type: 'flag', label: 'Prend fin au premier coup encaissé' },
  { key: 'consumedByElementHit', group: 'ending', type: 'flag', label: 'Prend fin au premier coup de son élément', hint: 'élément défini à l’application' },
  { key: 'breakOnAttack', group: 'ending', type: 'flag', label: 'Prend fin s’il attaque' },
  { key: 'breakOnHit', group: 'ending', type: 'flag', label: 'Prend fin s’il est touché' },
  { key: 'concentrationCheck', group: 'ending', type: 'flag', label: 'JS à chaque dégât reçu, fin sur échec' },
]);

export const CONDITION_EFFECT_LINKED = Object.freeze({
  dmgDealtBonus: [
    'dmgDealtBonusByLevel', 'dmgDealtBonusScalesWithPower',
    'dmgDealtWeaponOnly', 'dmgDealtMeleeOnly', 'dmgDealtRequiredStat',
  ],
  dmgReductionPct: ['dmgReductionTypes'],
});

const EFFECT_BY_KEY = Object.fromEntries(CONDITION_EFFECT_CATALOG.map(effect => [effect.key, effect]));
const ADVANCED_EFFECT_KEYS = new Set(Object.values(CONDITION_EFFECT_LINKED).flat());
const DEFAULT_BY_ID = Object.fromEntries(mergeConditionLibrary([]).map(condition => [condition.id, condition]));
const STAT_LABELS = Object.fromEntries(CONDITION_ADMIN_STATS);

export const cloneConditionAdmin = condition => JSON.parse(JSON.stringify(condition || {}));
export const cloneConditionAdminList = list => (Array.isArray(list) ? list : []).map(cloneConditionAdmin);
export const conditionAdminIsCustom = condition => !CONDITION_DEFAULT_IDS.has(condition?.id);

function _sorted(value) {
  if (Array.isArray(value)) return value.map(_sorted);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = _sorted(value[key]);
    return result;
  }, {});
}

export function conditionAdminCore(condition = {}) {
  return {
    label: condition.label || '', icon: condition.icon || '', color: condition.color || '',
    desc: condition.desc || '', defaultSaveStat: condition.defaultSaveStat || null,
    defaultDC: condition.defaultDC || null, defaultDuration: condition.defaultDuration || null,
    spellRunes: conditionSpellRunes(condition),
    spellUsage: {
      enchantment: !!condition.spellUsage?.enchantment,
      affliction: !!condition.spellUsage?.affliction,
    },
    effects: { ...(condition.effects || {}) },
  };
}

export const conditionAdminKey = condition => JSON.stringify(_sorted(conditionAdminCore(condition)));

export function conditionAdminIsAdjusted(condition = {}) {
  const original = DEFAULT_BY_ID[condition.id];
  return !!original && conditionAdminKey(condition) !== conditionAdminKey(original);
}

export function conditionAdminActiveEffects(condition = {}) {
  const effects = condition.effects || {};
  return CONDITION_EFFECT_CATALOG.filter(effect => {
    const value = effects[effect.key];
    return value !== undefined && value !== null && value !== false && value !== '';
  });
}

export function conditionAdminOtherEffects(condition = {}) {
  return Object.keys(condition.effects || {}).filter(key => !EFFECT_BY_KEY[key] && !ADVANCED_EFFECT_KEYS.has(key));
}

const _fold = value => String(value || '').toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export const conditionAdminDiceValid = value => /^(\d+d\d+|\d+)([+-]\d+)?$/i.test(String(value || '').replace(/\s/g, ''));

export function conditionAdminIssue(condition = {}, draft = []) {
  if (!String(condition.label || '').trim()) return 'Nom requis';
  const duplicate = draft.find(other => other !== condition
    && _fold(other.label).trim() === _fold(condition.label).trim());
  if (duplicate) return `Nom déjà pris par ${duplicate.icon || ''} ${duplicate.label}`.trim();
  if (!String(condition.icon || '').trim()) return 'Icône requise';
  const incomplete = conditionAdminActiveEffects(condition).find(effect => {
    const value = condition.effects?.[effect.key];
    return (effect.type === 'dice' && !conditionAdminDiceValid(value))
      || (effect.type === 'stats' && (!Array.isArray(value) || value.length === 0));
  });
  return incomplete ? `Effet « ${incomplete.label} » incomplet` : '';
}

export function conditionAdminWarnings(condition = {}) {
  const warnings = [];
  const effects = condition.effects || {};
  // Ces deux anciennes clés ne sont plus éditables, mais un catalogue existant
  // peut encore les porter : leur incohérence reste utile à signaler.
  if (effects.movementMod === 0 && Number(effects.movementBonus) > 0) {
    warnings.push('Vitesse 0 et bonus de déplacement sont tous deux stockés.');
  }
  if (effects.cantAct && Number(condition.defaultDuration) > 1) {
    warnings.push('Contrôle total sur plus d’un tour : vérifie l’équilibrage manuellement.');
  }
  if (effects.attackBy === 'adv' && effects.attackAgainst === 'adv') {
    warnings.push('Avantage des deux côtés : l’état favorise tous les échanges.');
  }
  return warnings;
}

const _signed = value => Number(value) > 0 ? `+${Number(value)}` : `−${Math.abs(Number(value))}`;
const _statList = values => {
  const list = Array.isArray(values) ? values : [];
  return list.length === CONDITION_ADMIN_STATS.length
    ? 'toutes les caractéristiques'
    : list.map(value => STAT_LABELS[value] || value).join(', ');
};

export function conditionAdminEffectPhrase(effect, condition = {}) {
  const effects = condition.effects || {};
  const value = effects[effect.key];
  const mode = value === 'adv' ? 'Avantage' : 'Désavantage';
  switch (effect.key) {
    case 'attackBy': return `${mode} à ses attaques`;
    case 'attackAgainst': return `${mode} aux attaques contre lui`;
    case 'attackAgainstMelee': return `${mode} aux attaques au contact contre lui`;
    case 'attackAgainstRanged': return `${mode} aux attaques à distance contre lui`;
    case 'critRangeBonus': return `Critique dès ${Math.max(17, 20 - Number(value || 0))}`;
    case 'saveAdvantageStats': return `Avantage aux JS : ${_statList(value)}`;
    case 'saveDisadvantageStats': return `Désavantage aux JS : ${_statList(value)}`;
    case 'checkAdvantageStats': return `Avantage aux tests : ${_statList(value)}`;
    case 'movementBonus': return `${_signed(value)} cases de déplacement`;
    case 'rangeBonus': return `${_signed(value)} cases de portée`;
    case 'dmgTakenBonus': return `+${value} dégâts subis`;
    case 'dmgDealtBonus': return `+${value} à ses dégâts${effects.dmgDealtMeleeOnly ? ' en mêlée' : ''}`;
    case 'dmgDealtMalus': return `−${value} à ses dégâts`;
    case 'dmgReductionPct': {
      const types = Array.isArray(effects.dmgReductionTypes) ? effects.dmgReductionTypes : [];
      const scope = types.length ? ` (${types.join(', ')})` : '';
      return Number(value) >= 100 ? `Immunisé aux dégâts${scope}` : `${value} % de dégâts subis en moins${scope}`;
    }
    default: return effect.label;
  }
}

export function conditionAdminGroup(condition = {}) {
  const usage = condition.spellUsage || {};
  if (usage.affliction && usage.enchantment) return 'both';
  if (usage.affliction) return 'affliction';
  if (usage.enchantment) return 'enchantment';
  return 'none';
}

export function conditionAdminPersistedLibrary(draft = []) {
  return draft
    .filter(condition => conditionAdminIsCustom(condition) || conditionAdminIsAdjusted(condition))
    .map(condition => ({
      ...cloneConditionAdmin(condition),
      spellRunes: conditionSpellRunes(condition),
      balanceVersion: CONDITION_BALANCE_VERSION,
    }));
}

export function conditionAdminDefault(id) {
  return DEFAULT_BY_ID[id] ? cloneConditionAdmin(DEFAULT_BY_ID[id]) : null;
}
