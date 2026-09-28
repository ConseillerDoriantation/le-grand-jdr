// ══════════════════════════════════════════════════════════════════════════════
// SHARED / WEAPON-FAMILY.JS — Type d'arme (Épée, Dague, Arc…) et maniement
// Les « formats d'arme » (world/weapon_formats) sont désormais des TYPES d'arme
// qui portent les techniques. Le maniement (1 ou 2 mains) est un champ de l'arme.
// Rétrocompatibilité : une arme dont le format enregistré n'existe plus
// (« Arme 1M CaC Phy. ») est rattachée à son type saisi (sousType).
// Module pur (aucun accès Firestore) : testable sous Node.
// ══════════════════════════════════════════════════════════════════════════════

export function normalizeWeaponFamilyKey(value = '') {
  return String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Type d'arme (entrée de la liste des formats) d'une arme, ou null. */
export function resolveWeaponFamily(formats = [], weapon = {}) {
  const list = Array.isArray(formats) ? formats.filter(Boolean) : [];
  if (!list.length || !weapon) return null;
  const ref = String(weapon.formatId || weapon.format || '').trim();
  if (ref) {
    const direct = list.find(f => f.id === ref || f.label === ref);
    if (direct) return direct;
  }
  for (const raw of [weapon.sousType, weapon.typeArme, weapon.format]) {
    const key = normalizeWeaponFamilyKey(raw);
    if (!key) continue;
    const found = list.find(f => normalizeWeaponFamilyKey(f.label) === key);
    if (found) return found;
  }
  return null;
}

/** Libellés qui désignent une arme pour la détection des styles de combat :
 * type résolu + ancien libellé de format (anciens styles encore configurés). */
export function weaponFamilyLabels(formats = [], weapon = null) {
  if (!weapon) return [];
  const labels = new Set();
  const family = resolveWeaponFamily(formats, weapon);
  if (family?.label) labels.add(family.label);
  if (weapon.format) labels.add(String(weapon.format));
  if (weapon.sousType) labels.add(String(weapon.sousType));
  return [...labels];
}

export const WEAPON_HANDS_OPTIONS = ['1 main', '2 mains'];

/** Maniement : champ `mains` de l'arme, sinon ancien libellé de format « … 2M … ». */
export function weaponHands(weapon = {}) {
  const raw = weapon?.mains;
  if (raw != null && raw !== '') {
    const n = parseInt(String(raw), 10);
    if (n === 1 || n === 2) return n;
  }
  return /(^|[^a-z0-9])2m([^a-z0-9]|$)|deux mains/i.test(String(weapon?.format || '')) ? 2 : 1;
}

export function weaponHandsLabel(weapon = {}) {
  return weaponHands(weapon) === 2 ? '2 mains' : '1 main';
}

/**
 * Types d'arme à créer d'après les armes existantes (types saisis absents de la
 * liste). Magique si la majorité des armes de ce type avaient un format magique.
 */
export function missingWeaponFamilies(formats = [], items = []) {
  const list = Array.isArray(formats) ? formats : [];
  const known = new Set(list.map(f => normalizeWeaponFamilyKey(f.label)));
  const groups = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const label = String(item?.sousType || '').trim();
    const key = normalizeWeaponFamilyKey(label);
    if (!key || known.has(key)) continue;
    const group = groups.get(key) || { label, count: 0, magic: 0 };
    group.count += 1;
    const legacy = list.find(f => f.label === item.format || f.id === item.formatId);
    if (legacy?.isMagic) group.magic += 1;
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
    .map(group => ({
      label: group.label,
      isMagic: group.magic * 2 > group.count,
      damageType: group.magic * 2 > group.count ? '' : 'physique',
      weapons: group.count,
    }));
}
