import { getDocData, saveDoc } from '../data/firestore.js';

export const CONDITION_DEFAULT_LIBRARY = [
  { id:'blinded',       label:'Aveuglé',     icon:'🙈', color:'#6b7280',
    desc:'Ne peut pas voir, échec auto aux tests de Vue. Ses attaques : désavantage. Attaques contre lui : avantage.',
    defaultSaveStat:'constitution', defaultDC:11,
    effects:{ attackBy:'dis', attackAgainst:'adv' } },
  { id:'charmed',       label:'Charmé',      icon:'💖', color:'#ec4899',
    desc:'Ne peut pas attaquer le charmeur ni le viser par un effet nuisible. Avantage social pour le charmeur.',
    defaultSaveStat:'sagesse',     defaultDC:11,
    effects:{} },
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
    desc:'Neutralisé, ne peut bouger ni parler. Échec auto JS Force/Dex. Avantage aux attaques. CaC à ≤1,50m = critique.',
    defaultSaveStat:'constitution', defaultDC:11,
    effects:{ cantAct:true, movementMod:0, attackAgainst:'adv', failsStrSaves:true, failsDexSaves:true, meleeCritOnHit:true } },
  { id:'petrified',     label:'Pétrifié',    icon:'🗿', color:'#78716c',
    desc:'Transformé en pierre. Neutralisé, vitesse 0. Résistance à tous les dégâts (50%).',
    defaultSaveStat:'constitution', defaultDC:11,
    effects:{ cantAct:true, movementMod:0, attackAgainst:'adv', failsStrSaves:true, failsDexSaves:true, dmgReductionPct:50 } },
  { id:'prone',         label:'À terre',     icon:'🛌', color:'#a78bfa',
    desc:'Désavantage à ses attaques. Avantage aux attaques au CaC ≤1,50m, désavantage à distance. Se relever coûte ½ mouvement.',
    defaultSaveStat:null,           defaultDC:null,
    effects:{ attackBy:'dis', attackAgainstMelee:'adv', attackAgainstRanged:'dis' } },
  { id:'restrained',    label:'Entravé',     icon:'⛓️', color:'#dc2626',
    desc:'Vitesse 0. Désavantage à ses attaques et JS Dextérité. Avantage aux attaques contre lui.',
    defaultSaveStat:'force',       defaultDC:11,
    effects:{ movementMod:0, attackBy:'dis', attackAgainst:'adv' } },
  { id:'stunned',       label:'Étourdi',     icon:'💫', color:'#06b6d4',
    desc:'Neutralisé, ne peut bouger. Échec auto JS Force/Dex. Avantage aux attaques contre lui.',
    defaultSaveStat:'constitution', defaultDC:11,
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
    desc:'Avantage aux attaques contre la cible et +1d6 dégâts subis. L\'effet se consomme dès qu\'un coup touche.',
    defaultSaveStat:null,           defaultDC:null, defaultDuration:null,
    effects:{ attackAgainst:'adv', dmgTakenBonus:'1d6', consumedByAttackAgainst:true } },
  { id:'swift',         label:'Accéléré',    icon:'💨', color:'#38bdf8',
    desc:'L\'allié gagne +2 cases de déplacement, +1 par rune Puissance du sort d\'enchantement.',
    defaultSaveStat:null,           defaultDC:null, defaultDuration:2,
    effects:{ movementBonus:2 } },
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
  { id:'empowered',     label:'Renforcé',    icon:'✨', color:'#e8b84b',
    desc:'L\'allié gagne un bonus de dégâts d\'attaque, renforcé par les runes Puissance du sort.',
    defaultSaveStat:null,           defaultDC:null, defaultDuration:2,
    effects:{ dmgDealtBonus:'1d4' } },
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
const CONDITION_ENCHANTMENT_DEFAULT_IDS = new Set(['swift', 'guided', 'distant_ward', 'melee_ward', 'focused', 'empowered']);
const CONDITION_NON_SPELL_DEFAULT_IDS = new Set(['dodge', 'hidden', 'disengaged']);

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
  return { ...c, spellUsage: normalizeSpellUsage(c), effects: { ...(c.effects || {}) } };
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
  };
}

export function mergeConditionLibrary(library = []) {
  const rows = Array.isArray(library)
    ? library.filter(entry => entry?.id && !CONDITION_REMOVED_IDS.has(entry.id)).map(normalizeCondition)
    : [];
  if (!rows.length) return CONDITION_DEFAULT_LIBRARY.map(cloneCondition);
  const byId = Object.fromEntries(rows.map(c => [c.id, c]));
  const merged = CONDITION_DEFAULT_LIBRARY.map(def => {
    const ov = byId[def.id];
    const spellUsage = normalizeSpellUsage(ov || def, normalizeSpellUsage(def));
    return ov ? { ...def, ...ov, spellUsage, effects: { ...def.effects, ...(ov.effects || {}) } } : cloneCondition(def);
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
