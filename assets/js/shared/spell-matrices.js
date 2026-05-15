import { getDocData, saveDoc } from '../data/firestore.js';

// ══════════════════════════════════════════════
// MATRICES DE SORTS — Effets thématiques par (élément × slot)
//
// Firestore : world/spell_matrices → {
//   enchant:      { [elementId]: { arme:'', tete:'', torse:'', pieds:'' } },
//   affliction:   { [elementId]: { arme:'', tete:'', torse:'', pieds:'' } },
//   protectionCA: { [elementId]: { mod: 2, note: '' } },
// }
//
// Géré côté MJ via openSpellMatricesAdmin().
// Consommé côté joueur via suggestSpellEffect() / getProtectionCAOverride().
// ══════════════════════════════════════════════

let _matrices = null;

export const SPELL_SLOTS = ['arme', 'tete', 'torse', 'pieds'];
export const SLOT_LABELS = { arme: '⚔️ Arme', tete: '👁️ Tête', torse: '👕 Torse', pieds: '👢 Pieds' };

// IDs des combos reconnus par le moteur. Doivent matcher ceux de SORT_COMBOS côté spells.js.
export const COMBO_IDS = [
  'drain',
  'zone_elargie',
  'arme_invoquee',
  'allonge_magique',
  'sentinelle',
  'canalise_persistant',
  'bouclier_reactif',
];

// Métadonnées d'affichage des combos (le MJ peut activer/désactiver et renommer)
export const COMBO_DEFAULTS = Object.freeze({
  drain:                { enabled: true, name: 'Drain personnel' },
  zone_elargie:         { enabled: true, name: 'Zone élargie' },
  arme_invoquee:        { enabled: true, name: 'Arme invoquée' },
  allonge_magique:      { enabled: true, name: 'Allonge magique' },
  sentinelle:           { enabled: true, name: 'Sentinelle / Piège' },
  canalise_persistant:  { enabled: true, name: 'Sort canalisé persistant' },
  bouclier_reactif:     { enabled: true, name: 'Bouclier réactif' },
});

// Modèle vide utilisé en fallback. Le MJ remplit via la console.
export const DEFAULT_MATRICES = Object.freeze({
  enchant: {},
  affliction: {},
  protectionCA: {},
  combos: {},       // { [comboId]: { enabled: bool, name: string } }
  combo_arms: {},   // { [elementId]: { weapon, degats, stat, portee, note } }
});

export async function loadSpellMatrices() {
  if (_matrices) return _matrices;
  try {
    const d = await getDocData('world', 'spell_matrices');
    _matrices = {
      enchant:      d?.enchant      || {},
      affliction:   d?.affliction   || {},
      protectionCA: d?.protectionCA || {},
      combos:       d?.combos       || {},
      combo_arms:   d?.combo_arms   || {},
    };
  } catch {
    _matrices = { ...DEFAULT_MATRICES, combos: {}, combo_arms: {} };
  }
  return _matrices;
}

export async function saveSpellMatrices(matrices) {
  const clean = {
    enchant:      matrices?.enchant      || {},
    affliction:   matrices?.affliction   || {},
    protectionCA: matrices?.protectionCA || {},
    combos:       matrices?.combos       || {},
    combo_arms:   matrices?.combo_arms   || {},
  };
  await saveDoc('world', 'spell_matrices', clean);
  _matrices = clean;
}

/** Renvoie la config d'affichage d'un combo (enabled + nom custom). */
export function getComboConfig(matrices, comboId) {
  const def = COMBO_DEFAULTS[comboId] || { enabled: true, name: comboId };
  const ov  = matrices?.combos?.[comboId];
  return {
    enabled: ov?.enabled !== undefined ? !!ov.enabled : def.enabled,
    name:    (ov?.name && ov.name.trim()) ? ov.name.trim() : def.name,
  };
}

/** Renvoie l'arme invoquée par un élément (ou null si non défini).
 *  Compat ascendante : si seul `stat` est défini (ancien format), il sert pour toucher ET dégâts.
 */
export function getInvokedArm(matrices, elementId) {
  if (!matrices || !elementId) return null;
  const a = matrices?.combo_arms?.[elementId];
  if (!a || !a.weapon) return null;
  const legacyStat = a.stat || 'force';
  return {
    weapon:      a.weapon,
    degats:      a.degats      || '1d8',
    statToucher: a.statToucher || legacyStat,
    statDegats:  a.statDegats  || legacyStat,
    portee:      parseInt(a.portee) || 1,
    note:        a.note        || '',
  };
}

export function invalidateSpellMatricesCache() {
  _matrices = null;
}

/**
 * Renvoie la suggestion d'effet pour une combinaison (catégorie, élément, slot).
 * categorie: 'enchant' | 'affliction'
 * Retourne '' si rien défini en console MJ.
 */
export function suggestSpellEffect(matrices, categorie, elementId, slot) {
  if (!matrices || !elementId || !slot) return '';
  return matrices?.[categorie]?.[elementId]?.[slot] || '';
}

/**
 * Renvoie l'override Protection CA pour un élément donné.
 * Retourne { mod: number, note: string } ou null si non défini.
 */
export function getProtectionCAOverride(matrices, elementId) {
  if (!matrices || !elementId) return null;
  const ov = matrices?.protectionCA?.[elementId];
  if (!ov || (ov.mod === undefined && !ov.note)) return null;
  return { mod: ov.mod ?? 2, note: ov.note || '' };
}
