import { getDocData, saveDoc } from '../data/firestore.js';

export const CONDITION_DEFAULT_LIBRARY = [
  { id:'blinded',       label:'Aveuglé',     icon:'🌫️', color:'#6b7280',
    desc:'Vue brouillée : désavantage à ses attaques. (Miroir de Guidé.)',
    defaultSaveStat:'constitution', defaultDC:11, defaultDuration:2,
    effects:{ attackBy:'dis' } },
  { id:'charmed',       label:'Charmé',      icon:'💖', color:'#ec4899',
    desc:'Ne peut pas attaquer le charmeur ni le viser par un effet nuisible. Avantage social pour le charmeur.',
    defaultSaveStat:'sagesse',     defaultDC:11,
    effects:{} },
  { id:'taunted',       label:'Provoqué',    icon:'😡', color:'#ef4444',
    desc:'L\'aggro est fixée sur un porteur (le lanceur ou l\'allié qu\'il désigne) : ses attaques doivent viser ce porteur, toute attaque qui ne l\'inclut pas est refusée. Sans effet si le porteur est à 0 PV ou absent de la scène.',
    defaultSaveStat:'charisme',    defaultDC:11, defaultDuration:2,
    effects:{ tauntLock:true } },
  { id:'deafened',      label:'Assourdi',    icon:'🔇', color:'#94a3b8',
    desc:'Ne peut pas entendre, échec auto aux tests basés sur l\'Ouïe.',
    defaultSaveStat:'constitution', defaultDC:11,
    effects:{} },
  { id:'frightened',    label:'Effrayé',     icon:'😱', color:'#f59e0b',
    desc:'Désavantage à ses jets tant que la source est en vue. Ne peut s\'en approcher volontairement.',
    defaultSaveStat:'sagesse',     defaultDC:11,
    effects:{ attackBy:'dis' } },
  { id:'grappled',      label:'Empoigné',    icon:'🤼', color:'#a16207',
    desc:'Vitesse 0. Prend fin si le saisisseur est neutralisé.',
    defaultSaveStat:'force',       defaultDC:11,
    effects:{ movementMod:0 } },
  { id:'incapacitated', label:'Neutralisé',  icon:'💤', color:'#737373',
    desc:'Ne peut effectuer aucune action ni réaction.',
    defaultSaveStat:'constitution', defaultDC:11,
    effects:{ cantAct:true } },
  { id:'invisible',     label:'Invisible',   icon:'👻', color:'#9ca3af',
    desc:'Ne peut être vu sans détection. Avantage à ses attaques, désavantage aux attaques contre lui.',
    defaultSaveStat:null,           defaultDC:null,
    effects:{ attackBy:'adv', attackAgainst:'dis' } },
  { id:'paralyzed',     label:'Paralysé',    icon:'⚡', color:'#fbbf24',
    desc:'Neutralisé, ne peut bouger ni parler. Échec auto JS Force/Dex. Avantage aux attaques. CaC à ≤1,50m = critique. Contrôle total : 1 tour, jamais prolongé (Concentration / Durée).',
    defaultSaveStat:'constitution', defaultDC:11, defaultDuration:1,
    effects:{ cantAct:true, movementMod:0, attackAgainst:'adv', failsStrSaves:true, failsDexSaves:true, meleeCritOnHit:true } },
  { id:'petrified',     label:'Pétrifié',    icon:'🗿', color:'#78716c',
    desc:'Transformé en pierre. Neutralisé, vitesse 0. Résistance à tous les dégâts (50%). Contrôle total : 1 tour, jamais prolongé (Concentration / Durée).',
    defaultSaveStat:'constitution', defaultDC:11, defaultDuration:1,
    effects:{ cantAct:true, movementMod:0, attackAgainst:'adv', failsStrSaves:true, failsDexSaves:true, dmgReductionPct:50 } },
  { id:'prone',         label:'À terre',     icon:'🛌', color:'#a78bfa',
    desc:'Désavantage à ses attaques. Avantage aux attaques au CaC ≤1,50m, désavantage à distance. Se relever coûte ½ mouvement.',
    defaultSaveStat:null,           defaultDC:null,
    effects:{ attackBy:'dis', attackAgainstMelee:'adv', attackAgainstRanged:'dis' } },
  { id:'restrained',    label:'Entravé',     icon:'⛓️', color:'#dc2626',
    desc:'Immobilisé : vitesse 0. Peut toujours attaquer et lancer des sorts.',
    defaultSaveStat:'force',       defaultDC:11, defaultDuration:2,
    effects:{ movementMod:0 } },
  { id:'slowed',        label:'Ralenti',     icon:'🐌', color:'#64748b',
    desc:'−2 cases de déplacement. (Miroir d\'Accéléré.)',
    defaultSaveStat:'sagesse',     defaultDC:11, defaultDuration:2,
    effects:{ movementBonus:-2 } },
  { id:'stunned',       label:'Étourdi',     icon:'💫', color:'#06b6d4',
    desc:'Perd son tour : aucune action ni déplacement. Échec auto JS Force/Dex. Avantage aux attaques contre lui. Contrôle total : 1 tour, jamais prolongé (Concentration / Durée).',
    defaultSaveStat:'constitution', defaultDC:11, defaultDuration:1,
    effects:{ cantAct:true, movementMod:0, attackAgainst:'adv', failsStrSaves:true, failsDexSaves:true } },
  { id:'unconscious',   label:'Inconscient', icon:'😵', color:'#0f172a',
    desc:'Neutralisé, à terre, lâche ses objets. Échec auto JS Force/Dex. Avantage aux attaques. CaC ≤1,50m = critique.',
    defaultSaveStat:'constitution', defaultDC:11,
    effects:{ cantAct:true, movementMod:0, attackAgainst:'adv', failsStrSaves:true, failsDexSaves:true, meleeCritOnHit:true } },
  { id:'silenced',      label:'Silencé',     icon:'🤐', color:'#0ea5e9',
    desc:'Ne peut pas lancer de sort ni utiliser de compétence. Les attaques d\'arme et les actions d\'objets restent disponibles.',
    defaultSaveStat:'constitution', defaultDC:11, defaultDuration:2,
    effects:{ cantCastSpells:true } },
  { id:'marked',        label:'Marqué',      icon:'🎯', color:'#f43f5e',
    desc:'Avantage aux attaques contre la cible et +2d6 dégâts subis. L\'effet se consomme dès qu\'un coup touche.',
    defaultSaveStat:null,           defaultDC:null, defaultDuration:null,
    effects:{ attackAgainst:'adv', dmgTakenBonus:'2d6', consumedByAttackAgainst:true } },
  { id:'swift',         label:'Accéléré',    icon:'💨', color:'#38bdf8',
    desc:'L\'allié gagne +2 cases de déplacement, +1 par rune Amplification du sort d\'enchantement.',
    defaultSaveStat:null,           defaultDC:null, defaultDuration:2,
    effects:{ movementBonus:2 } },
  { id:'allonge',       label:'Allonge',     icon:'🏹', color:'#0ea5e9',
    desc:'L\'allié gagne +2 cases de portée d\'attaque, +1 par rune Amplification du sort d\'enchantement.',
    defaultSaveStat:null,           defaultDC:null, defaultDuration:2,
    effects:{ rangeBonus:2 } },
  { id:'chanceux',      label:'Chanceux',    icon:'🍀', color:'#22c55e',
    desc:'L\'allié critique plus facilement : sa RC baisse de 1 par rune Chance du sort (plancher 17). Le critique utilise la formule critique de l\'aventure.',
    defaultSaveStat:null,           defaultDC:null, defaultDuration:2,
    effects:{ critRangeBonus:1 } },
  { id:'guided',        label:'Guidé',       icon:'🎯', color:'#facc15',
    desc:'L\'allié est guidé : avantage à ses jets d\'attaque pendant la durée de l\'enchantement.',
    defaultSaveStat:null,           defaultDC:null, defaultDuration:2,
    effects:{ attackBy:'adv' } },
  { id:'distant_ward',  label:'Abri distant', icon:'🏹', color:'#38bdf8',
    desc:'L\'allié est protégé contre les tirs et attaques à distance : désavantage aux attaques à distance contre lui.',
    defaultSaveStat:null,           defaultDC:null, defaultDuration:2,
    effects:{ attackAgainstRanged:'dis' } },
  { id:'melee_ward',    label:'Garde rapprochée', icon:'🛡️', color:'#22c55e',
    desc:'L\'allié est protégé au contact : désavantage aux attaques de mêlée contre lui.',
    defaultSaveStat:null,           defaultDC:null, defaultDuration:2,
    effects:{ attackAgainstMelee:'dis' } },
  { id:'focused',       label:'Concentré',   icon:'🧠', color:'#818cf8',
    desc:'À chaque dégât reçu, le porteur lance un JS Sagesse contre le DD de l\'état. Sur échec, l\'état prend fin.',
    defaultSaveStat:'sagesse',      defaultDC:11, defaultDuration:2,
    effects:{ concentrationCheck:true } },
  { id:'rage',          label:'Rage',        icon:'🔥', color:'#ef4444',
    desc:'Rage D&D : avantage aux tests et JS de Force, bonus de dégâts aux attaques de mêlée utilisant la Force (+2, puis +3 niv. 9 et +4 niv. 16), résistance aux dégâts contondants, perforants et tranchants. Impossible de lancer des sorts ou de maintenir une concentration.',
    defaultSaveStat:null,           defaultDC:null, defaultDuration:10,
    effects:{
      checkAdvantageStats:['force'], saveAdvantageStats:['force'],
      dmgDealtBonus:'2',
      dmgDealtBonusByLevel:[
        { minLevel:9, formula:'3' },
        { minLevel:16, formula:'4' },
      ],
      dmgDealtBonusScalesWithPower:false,
      dmgDealtWeaponOnly:true, dmgDealtMeleeOnly:true, dmgDealtRequiredStat:'force',
      dmgReductionPct:50,
      // `physique` garde la compatibilité avec les aventures utilisant encore
      // le type agrégé historique au lieu des trois types D&D détaillés.
      dmgReductionTypes:['physique', 'contondant', 'perforant', 'tranchant'],
      cantCastSpells:true, breakConcentration:true,
    } },
  { id:'empowered',     label:'Renforcé',    icon:'✨', color:'#e8b84b',
    desc:'L\'allié inflige +(1 + Puissance)d4 +2 dégâts à chaque coup réussi. (Miroir d\'Affaibli.)',
    defaultSaveStat:null,           defaultDC:null, defaultDuration:2,
    effects:{ dmgDealtBonus:'1d4' } },
  { id:'faiblesse',     label:'Faiblesse',   icon:'💢', color:'#f59e0b',
    desc:'Le prochain coup de l\'élément du sort qui l\'a affligée inflige des dégâts doublés, puis la Faiblesse se consomme (2 tours max). Annule une résistance à cet élément, sans percer immunité ni absorption.',
    defaultSaveStat:null,           defaultDC:null, defaultDuration:2,
    effects:{ consumedByElementHit:true } },
  { id:'weakened',      label:'Affaibli',    icon:'🥀', color:'#a855f7',
    desc:'Ses coups réussis infligent −(1 + Puissance)d4 dégâts (1 minimum). (Miroir de Renforcé.)',
    defaultSaveStat:'constitution', defaultDC:11, defaultDuration:2,
    effects:{ dmgDealtMalus:'1d4' } },
  { id:'broken',        label:'Brisé',       icon:'🪞', color:'#7c3aed',
    desc:'Volonté brisée : désavantage à tous ses jets de sauvegarde. Prépare les autres Afflictions.',
    defaultSaveStat:'sagesse',     defaultDC:11, defaultDuration:2,
    effects:{ saveDisadvantageStats:['force', 'dexterite', 'constitution', 'intelligence', 'sagesse', 'charisme'] } },
  // ── Contrecoup de technique (Coup sournois raté) ──
  { id:'exposed',       label:'À découvert', icon:'🫣', color:'#fb7185',
    desc:'S\'est exposé en ratant une frappe risquée : avantage aux attaques contre lui jusqu\'à la fin du round.',
    defaultSaveStat:null,           defaultDC:null, defaultDuration:1,
    effects:{ attackAgainst:'adv' } },
  // ── Actions de base (posées par les actions Esquiver / Se cacher / Se désengager) ──
  { id:'dodge',         label:'Esquive',     icon:'🤸', color:'#38bdf8',
    desc:'Jusqu\'au début de ton prochain tour : désavantage aux attaques contre toi (si tu vois l\'attaquant).',
    defaultSaveStat:null,           defaultDC:null, defaultDuration:1,
    effects:{ attackAgainst:'dis' } },
  { id:'hidden',        label:'Caché',       icon:'🫥', color:'#94a3b8',
    desc:'Caché / discrétion : avantage à tes attaques, désavantage aux attaques contre toi (1 tour).',
    defaultSaveStat:null,           defaultDC:null, defaultDuration:1,
    effects:{ attackBy:'adv', attackAgainst:'dis' } },
  { id:'disengaged',    label:'Désengagé',   icon:'💨', color:'#a3e635',
    desc:'Se désengage : aucune attaque d\'opportunité provoquée par ton déplacement ce tour.',
    defaultSaveStat:null,           defaultDC:null, defaultDuration:1,
    effects:{} },
];

export const CONDITION_DEFAULT_IDS = new Set(CONDITION_DEFAULT_LIBRARY.map(c => c.id));
const CONDITION_REMOVED_IDS = new Set(['poisoned', 'warded']);
// Un état = un levier. Enchantement (allié) et Affliction (ennemi) se répondent
// en miroir : Guidé/Aveuglé, Renforcé/Affaibli, Accéléré/Ralenti, Garde/Marqué.
const CONDITION_ENCHANTMENT_DEFAULT_IDS = new Set(['swift', 'allonge', 'chanceux', 'guided', 'distant_ward', 'melee_ward', 'empowered']);
// Hors sorts (pose MJ, capacités, créatures) : actions de base, états sans effet
// en combat VTT, doublons d'un état de sort plus lisible, capacités de classe.
const CONDITION_NON_SPELL_DEFAULT_IDS = new Set([
  'dodge', 'hidden', 'disengaged', 'exposed',
  'deafened', 'charmed', 'invisible',
  'incapacitated', 'unconscious', 'paralyzed', 'petrified', 'grappled', 'frightened',
  'focused', 'rage',
]);

// ── Équilibrage des états ──
// Une bibliothèque sauvegardée par le MJ écrase les défauts. Quand l'équilibrage
// change, les champs listés ici sont réimposés UNE fois aux lignes sauvegardées
// avant cette version (le MJ peut ensuite les retoucher, la ligne passe à jour).
// Patches cumulatifs : une ligne en retard reçoit toutes les valeurs actuelles.
export const CONDITION_BALANCE_VERSION = 2;
const CONDITION_BALANCE_PATCHES = {
  marked:        { fields: ['desc'], effects: ['dmgTakenBonus'] },
  faiblesse:     { fields: ['desc'], effects: ['consumedByElementHit'] },
  stunned:       { fields: ['desc', 'defaultDuration'] },
  paralyzed:     { fields: ['desc', 'defaultDuration'], spellUsage: true },
  petrified:     { fields: ['desc', 'defaultDuration'], spellUsage: true },
  blinded:       { fields: ['desc', 'defaultDuration'], effects: ['attackBy', 'attackAgainst'] },
  restrained:    { fields: ['desc', 'defaultDuration'], effects: ['movementMod', 'attackBy', 'attackAgainst'] },
  slowed:        { fields: ['desc'], effects: ['movementBonus'] },
  taunted:       { fields: ['desc'], effects: ['tauntLock'] },
  empowered:     { fields: ['desc'] },
  deafened:      { spellUsage: true },
  incapacitated: { spellUsage: true },
  unconscious:   { spellUsage: true },
  charmed:       { spellUsage: true },
  invisible:     { spellUsage: true },
  grappled:      { spellUsage: true },
  frightened:    { spellUsage: true },
  focused:       { spellUsage: true },
  rage:          { spellUsage: true },
};

function applyBalancePatch(def, ov) {
  if ((Number(ov.balanceVersion) || 0) >= CONDITION_BALANCE_VERSION) return ov;
  const patch = CONDITION_BALANCE_PATCHES[def.id];
  if (!patch) return ov;
  const out = { ...ov, effects: { ...(ov.effects || {}) } };
  (patch.fields || []).forEach(k => { out[k] = def[k] ?? null; });
  // Clé absente du défaut = supprimée (jamais `undefined` : Firestore le refuse).
  (patch.effects || []).forEach(k => {
    if (def.effects && k in def.effects) out.effects[k] = def.effects[k];
    else delete out.effects[k];
  });
  if (patch.spellUsage) out.spellUsage = null;   // → retombe sur l'usage par défaut
  return out;
}

function normalizeSpellUsage(entry = {}, fallback = null) {
  const raw = entry.spellUsage;
  if (raw && typeof raw === 'object') {
    return {
      enchantment: !!raw.enchantment,
      affliction: !!raw.affliction,
    };
  }
  if (fallback) return { ...fallback };
  if (CONDITION_ENCHANTMENT_DEFAULT_IDS.has(entry.id)) return { enchantment: true, affliction: false };
  if (CONDITION_NON_SPELL_DEFAULT_IDS.has(entry.id)) return { enchantment: false, affliction: false };
  if (CONDITION_DEFAULT_IDS.has(entry.id)) return { enchantment: false, affliction: true };
  return { enchantment: true, affliction: true };
}

function cloneCondition(c = {}) {
  return { ...c, spellUsage: normalizeSpellUsage(c), effects: { ...(c.effects || {}) }, balanceVersion: CONDITION_BALANCE_VERSION };
}

function normalizeCondition(entry = {}) {
  return {
    id: entry.id,
    label: entry.label || entry.id,
    icon: entry.icon || '✨',
    color: entry.color || '',
    desc: entry.desc || '',
    defaultSaveStat: entry.defaultSaveStat || null,
    defaultDC: entry.defaultDC || null,
    defaultDuration: entry.defaultDuration || null,
    spellUsage: entry.spellUsage ? normalizeSpellUsage(entry) : null,
    effects: { ...(entry.effects || {}) },
    balanceVersion: Number(entry.balanceVersion) || 0,
  };
}

export function mergeConditionLibrary(library = []) {
  const rows = Array.isArray(library)
    ? library.filter(entry => entry?.id && !CONDITION_REMOVED_IDS.has(entry.id)).map(normalizeCondition)
    : [];
  if (!rows.length) return CONDITION_DEFAULT_LIBRARY.map(cloneCondition);
  const byId = Object.fromEntries(rows.map(c => [c.id, c]));
  const merged = CONDITION_DEFAULT_LIBRARY.map(def => {
    const ov = byId[def.id] ? applyBalancePatch(def, byId[def.id]) : null;
    const spellUsage = normalizeSpellUsage(ov || def, normalizeSpellUsage(def));
    return ov
      ? { ...def, ...ov, spellUsage, effects: { ...def.effects, ...(ov.effects || {}) }, balanceVersion: CONDITION_BALANCE_VERSION }
      : cloneCondition(def);
  });
  rows.forEach(c => {
    if (!CONDITION_DEFAULT_IDS.has(c.id)) {
      merged.push({
        ...cloneCondition(c),
        spellUsage: normalizeSpellUsage(c, c.spellUsage || { enchantment: true, affliction: true }),
      });
    }
  });
  return merged;
}

let _conditionLibraryCache = null;

export async function loadConditionLibrary({ refresh = false, seedDefaults = false } = {}) {
  if (_conditionLibraryCache && !refresh) return _conditionLibraryCache;
  try {
    const doc = await getDocData('world', 'conditions');
    if (Array.isArray(doc?.library) && doc.library.length) {
      _conditionLibraryCache = mergeConditionLibrary(doc.library);
    } else {
      _conditionLibraryCache = CONDITION_DEFAULT_LIBRARY.map(cloneCondition);
      if (seedDefaults) {
        await saveDoc('world', 'conditions', { library: _conditionLibraryCache }).catch(() => {});
      }
    }
  } catch {
    _conditionLibraryCache = CONDITION_DEFAULT_LIBRARY.map(cloneCondition);
  }
  return _conditionLibraryCache;
}

export function clearConditionLibraryCache() {
  _conditionLibraryCache = null;
}
