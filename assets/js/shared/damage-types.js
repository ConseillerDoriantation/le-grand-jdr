import { getDocData, saveDoc } from '../data/firestore.js';

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

export const DEFAULT_DAMAGE_TYPES = [
  { id: 'physique', label: 'Physique', icon: '💪', color: '#9ca3af', isMagic: false, rules: { missEffect: 'none', armorPen: 0, dmgBonus: 0 } },
  { id: 'feu',      label: 'Feu',      icon: '🔥', color: '#f97316', isMagic: true,  rules: { missEffect: 'half', armorPen: 0, dmgBonus: 0 } },
  { id: 'eau',      label: 'Eau',      icon: '💧', color: '#4f8cff', isMagic: true,  rules: { missEffect: 'half', armorPen: 0, dmgBonus: 0 } },
  { id: 'vent',     label: 'Vent',     icon: '🌬️', color: '#22c38e', isMagic: true,  rules: { missEffect: 'half', armorPen: 0, dmgBonus: 0 } },
  { id: 'terre',    label: 'Terre',    icon: '🪨', color: '#b47fff', isMagic: true,  rules: { missEffect: 'half', armorPen: 0, dmgBonus: 0 } },
  { id: 'ombre',    label: 'Ombre',    icon: '🌑', color: '#6366f1', isMagic: true,  rules: { missEffect: 'half', armorPen: 0, dmgBonus: 0 } },
  { id: 'lumiere',  label: 'Lumière',  icon: '✨', color: '#f9d71c', isMagic: true,  rules: { missEffect: 'half', armorPen: 0, dmgBonus: 0 } },
];

export async function loadDamageTypes() {
  if (_damageTypes) return _damageTypes;
  try {
    const d = await getDocData('world', 'damage_types');
    _damageTypes = d?.types?.length ? d.types : [...DEFAULT_DAMAGE_TYPES];
  } catch {
    _damageTypes = [...DEFAULT_DAMAGE_TYPES];
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
