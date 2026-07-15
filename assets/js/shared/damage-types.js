import { getCurrentAdventureId, getDocData, saveDoc } from '../data/firestore.js';

// ══════════════════════════════════════════════
// TYPES DE DÉGÂTS
// Firestore : world/damage_types → { types:[{id,label,rules}] }
//
// rules disponibles :
//   missEffect  : 'none' | 'half' | 'full'  — dégâts sur raté (sauf fumble)
//   armorPen    : 0-100  (%)                 — % de CA ignorée au calcul de toucher
//   dmgBonus    : number                     — bonus/malus fixe à chaque jet de dégâts
// ══════════════════════════════════════════════

let _damageTypes = null;

export const DEFAULT_RULES = { missEffect: 'none', armorPen: 0, dmgBonus: 0 };

const LEGACY_DAMAGE_TYPES = [
  { id: 'physique', label: 'Physique', icon: '💪', color: '#9ca3af', isMagic: false, rules: { missEffect: 'none', armorPen: 0, dmgBonus: 0 } },
  { id: 'feu',      label: 'Feu',      icon: '🔥', color: '#f97316', isMagic: true,  rules: { missEffect: 'half', armorPen: 0, dmgBonus: 0 } },
  { id: 'eau',      label: 'Eau',      icon: '💧', color: '#4f8cff', isMagic: true,  rules: { missEffect: 'half', armorPen: 0, dmgBonus: 0 } },
  { id: 'vent',     label: 'Vent',     icon: '🌬️', color: '#22c38e', isMagic: true,  rules: { missEffect: 'half', armorPen: 0, dmgBonus: 0 } },
  { id: 'terre',    label: 'Terre',    icon: '🪨', color: '#b47fff', isMagic: true,  rules: { missEffect: 'half', armorPen: 0, dmgBonus: 0 } },
  { id: 'ombre',    label: 'Ombre',    icon: '🌑', color: '#6366f1', isMagic: true,  rules: { missEffect: 'half', armorPen: 0, dmgBonus: 0 } },
  { id: 'lumiere',  label: 'Lumière',  icon: '✨', color: '#f9d71c', isMagic: true,  rules: { missEffect: 'half', armorPen: 0, dmgBonus: 0 } },
];

export const DEFAULT_DAMAGE_TYPES = [
  { id: 'physique',    label: 'Physique générique', icon: '💪', color: '#9ca3af', isMagic: false, rules: { missEffect: 'none', armorPen: 0, dmgBonus: 0 } },
  { id: 'contondant',  label: 'Contondant',         icon: '🔨', color: '#a3a3a3', isMagic: false, rules: { missEffect: 'none', armorPen: 0, dmgBonus: 0 } },
  { id: 'perforant',   label: 'Perforant',          icon: '🗡️', color: '#cbd5e1', isMagic: false, rules: { missEffect: 'none', armorPen: 0, dmgBonus: 0 } },
  { id: 'tranchant',   label: 'Tranchant',          icon: '⚔️', color: '#94a3b8', isMagic: false, rules: { missEffect: 'none', armorPen: 0, dmgBonus: 0 } },
  { id: 'acide',       label: 'Acide',              icon: '🧪', color: '#84cc16', isMagic: true,  rules: { missEffect: 'none', armorPen: 0, dmgBonus: 0 } },
  { id: 'froid',       label: 'Froid',              icon: '❄️', color: '#38bdf8', isMagic: true,  rules: { missEffect: 'none', armorPen: 0, dmgBonus: 0 } },
  { id: 'feu',         label: 'Feu',                icon: '🔥', color: '#f97316', isMagic: true,  rules: { missEffect: 'none', armorPen: 0, dmgBonus: 0 } },
  { id: 'force',       label: 'Force',              icon: '✦', color: '#a78bfa', isMagic: true,  rules: { missEffect: 'none', armorPen: 0, dmgBonus: 0 } },
  { id: 'foudre',      label: 'Foudre',             icon: '⚡', color: '#facc15', isMagic: true,  rules: { missEffect: 'none', armorPen: 0, dmgBonus: 0 } },
  { id: 'necrotique',  label: 'Nécrotique',         icon: '☠️', color: '#64748b', isMagic: true,  rules: { missEffect: 'none', armorPen: 0, dmgBonus: 0 } },
  { id: 'poison',      label: 'Poison',             icon: '☣️', color: '#22c55e', isMagic: true,  rules: { missEffect: 'none', armorPen: 0, dmgBonus: 0 } },
  { id: 'psychique',   label: 'Psychique',          icon: '🧠', color: '#ec4899', isMagic: true,  rules: { missEffect: 'none', armorPen: 0, dmgBonus: 0 } },
  { id: 'radiant',     label: 'Radiant',            icon: '✨', color: '#f9d71c', isMagic: true,  rules: { missEffect: 'none', armorPen: 0, dmgBonus: 0 } },
  { id: 'tonnerre',    label: 'Tonnerre',           icon: '🌩️', color: '#60a5fa', isMagic: true,  rules: { missEffect: 'none', armorPen: 0, dmgBonus: 0 } },
];

function _cloneDamageTypes(types = DEFAULT_DAMAGE_TYPES) {
  return types.map(t => ({ ...t, rules: { ...DEFAULT_RULES, ...(t.rules || {}) } }));
}

function _defaultDamageTypesForAdventure() {
  return getCurrentAdventureId() === 'le-grand-jdr'
    ? _cloneDamageTypes(LEGACY_DAMAGE_TYPES)
    : _cloneDamageTypes(DEFAULT_DAMAGE_TYPES);
}

export async function loadDamageTypes() {
  if (_damageTypes) return _damageTypes;
  try {
    const d = await getDocData('world', 'damage_types');
    _damageTypes = d?.types?.length ? d.types : _defaultDamageTypesForAdventure();
  } catch {
    _damageTypes = _defaultDamageTypesForAdventure();
  }
  return _damageTypes;
}

export async function saveDamageTypes(types) {
  await saveDoc('world', 'damage_types', { types });
  _damageTypes = types;
}

export function invalidateDamageTypesCache() {
  _damageTypes = null;
}

/** Retourne les règles d'un type par son id (ou les règles par défaut). */
export function getDamageTypeRules(types, typeId) {
  if (!typeId || !types) return { ...DEFAULT_RULES };
  return { ...DEFAULT_RULES, ...(types.find(t => t.id === typeId)?.rules || {}) };
}

/** Retourne uniquement les types magiques (isMagic: true). */
export function getMagicTypes(types) {
  return (types || DEFAULT_DAMAGE_TYPES).filter(t => t.isMagic);
}

/** Retourne un type par son id, ou null. */
export function getDamageTypeById(types, id) {
  if (!id || !types) return null;
  return types.find(t => t.id === id) || null;
}
