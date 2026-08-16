import { calcCA, calcDeckMax, calcPMMax, calcPVMax, calcVitesse, getModFromScore } from './char-stats.js';

export const INVOCATION_ABILITIES = [
  { key: 'force',        short: 'FOR', label: 'Force' },
  { key: 'dexterite',    short: 'DEX', label: 'Dextérité' },
  { key: 'constitution', short: 'CON', label: 'Constitution' },
  { key: 'intelligence', short: 'INT', label: 'Intelligence' },
  { key: 'sagesse',      short: 'SAG', label: 'Sagesse' },
  { key: 'charisme',     short: 'CHA', label: 'Charisme' },
];

export const INVOCATION_DEFAULT_STATS = Object.freeze({
  niveau: 1,
  attaque: '1d4 +2',
  toucher: 2,
  toucherStat: 'force',
  degatsStat: 'force',
  portee: 1,
  pv: 10,
  ca: 10,
  deplacement: 3,
  pmMax: 0,
  usesOwnMana: false,
  force: 10,
  dexterite: 10,
  constitution: 10,
  intelligence: 10,
  sagesse: 10,
  charisme: 10,
});

const ABILITY_KEYS = new Set(INVOCATION_ABILITIES.map(stat => stat.key));
const combatStat = (value, fallback) => value === 'none' || ABILITY_KEYS.has(value) ? value : fallback;
const integer = (value, fallback, min = -Infinity) => {
  const parsed = parseInt(value, 10);
  return Math.max(min, Number.isFinite(parsed) ? parsed : fallback);
};

/** Normalise les anciennes invocations et garantit toutes les valeurs de base. */
export function normalizeInvocationStats(stats = {}) {
  const defaults = INVOCATION_DEFAULT_STATS;
  return {
    niveau: integer(stats.niveau, defaults.niveau, 1),
    attaque: String(stats.attaque || defaults.attaque).trim() || defaults.attaque,
    toucher: integer(stats.toucher, defaults.toucher),
    toucherStat: combatStat(stats.toucherStat, defaults.toucherStat),
    degatsStat: combatStat(stats.degatsStat, defaults.degatsStat),
    portee: integer(stats.portee, defaults.portee, 1),
    pv: integer(stats.pv, defaults.pv, 1),
    ca: integer(stats.ca, defaults.ca, 0),
    deplacement: integer(stats.deplacement, defaults.deplacement, 0),
    pmMax: integer(stats.pmMax, defaults.pmMax, 0),
    // Rétrocompatibilité : les anciennes invocations payaient toujours leurs
    // actions avec les PM de l'invocateur.
    usesOwnMana: stats.usesOwnMana === true,
    ...Object.fromEntries(INVOCATION_ABILITIES.map(({ key }) => [
      key,
      integer(stats[key], defaults[key], 1),
    ])),
  };
}

function invocationCalcCharacter(base) {
  return {
    id: '__invocation',
    niveau: base.niveau,
    pvBase: base.pv,
    pmBase: base.pmMax,
    stats: Object.fromEntries(INVOCATION_ABILITIES.map(({ key }) => [key, base[key]])),
    statsBonus: {},
    equipement: {},
  };
}

/**
 * Calcule la fiche effective de l'invocation avec les mêmes règles que les
 * personnages/PNJ. PV et PM progressent avec le niveau ; CA et déplacement
 * gardent la valeur de base configurée, puis reçoivent l'écart dû aux stats.
 */
export function calculateInvocationDerivedStats(invocation = {}) {
  const base = normalizeInvocationStats(invocation?.stats || invocation);
  const character = invocationCalcCharacter(base);
  const neutral = invocationCalcCharacter({
    ...base,
    ...Object.fromEntries(INVOCATION_ABILITIES.map(({ key }) => [key, 10])),
  });
  return {
    ...base,
    pv: calcPVMax(character),
    pmMax: calcPMMax(character),
    ca: Math.max(0, base.ca + calcCA(character) - calcCA(neutral)),
    deplacement: Math.max(0, base.deplacement + calcVitesse(character) - calcVitesse(neutral)),
    deckMax: Math.max(0, calcDeckMax(character)),
  };
}

/** Sorts réellement préparés, bornés par la capacité calculée du Deck. */
export function getPreparedInvocationActions(invocation = {}) {
  const actions = Array.isArray(invocation?.actions) ? invocation.actions : [];
  const deckMax = calculateInvocationDerivedStats(invocation).deckMax;
  return actions.filter(action => action?.invocationPrepared !== false).slice(0, deckMax);
}

export function invocationStatModifier(stats = {}, statKey = '') {
  if (!statKey || statKey === 'none') return 0;
  const normalized = normalizeInvocationStats(stats);
  return getModFromScore(normalized[statKey]);
}

export function invocationStatShort(statKey = '') {
  return INVOCATION_ABILITIES.find(stat => stat.key === statKey)?.short || '';
}

/** Valeurs finales au lancement : base enregistrée + bonus des runes du sort. */
export function calculateSummonStats(invocation = {}, runes = []) {
  const base = calculateInvocationDerivedStats(invocation);
  const count = name => (runes || []).filter(rune => rune === name).length;
  const power = count('Puissance');
  let attaque = base.attaque;
  if (power > 0) {
    const match = attaque.match(/^(\d+)(d\d+)(.*)$/i);
    attaque = match
      ? `${parseInt(match[1], 10) + power}${match[2]}${match[3]}`
      : `${attaque} +${power}d6`;
  }
  return {
    niveau: base.niveau,
    attaque,
    toucher: base.toucher + 2 * count('Chance'),
    pv: base.pv + 5 * count('Protection'),
    ca: base.ca,
    deplacement: base.deplacement + 3 * count('Amplification'),
    pmMax: base.pmMax,
    deckMax: base.deckMax,
    usesOwnMana: base.usesOwnMana,
    portee: base.portee,
    toucherStat: base.toucherStat,
    degatsStat: base.degatsStat,
    stats: Object.fromEntries(INVOCATION_ABILITIES.map(({ key }) => [key, base[key]])),
    duree: 2 + 2 * count('Durée'),
    concentration: count('Concentration') > 0,
  };
}
