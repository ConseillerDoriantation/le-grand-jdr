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
  { id: 'physique', label: 'Physique', rules: { missEffect: 'none', armorPen: 0, dmgBonus: 0 } },
  { id: 'magique',  label: 'Magique',  rules: { missEffect: 'half', armorPen: 0, dmgBonus: 0 } },
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
