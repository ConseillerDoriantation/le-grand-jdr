import { getDocData, saveDoc } from '../data/firestore.js';

// ══════════════════════════════════════════════
// FORMATS D'ARMES
// Firestore : world/weapon_formats → { formats:[{id,label}] }
// ══════════════════════════════════════════════

let _weaponFormats = null;

export const DEFAULT_WEAPON_FORMATS = [
  { id:'arme_1m_cac_phy',  label:'Arme 1M CaC Phy.' },
  { id:'arme_2m_cac_phy',  label:'Arme 2M CaC Phy.' },
  { id:'arme_2m_dist_phy', label:'Arme 2M Dist Phy.' },
  { id:'arme_2m_cac_mag',  label:'Arme 2M CaC Mag.' },
  { id:'arme_2m_dist_mag', label:'Arme 2M Dist Mag.' },
  { id:'bouclier',         label:'Bouclier' },
  { id:'baguette',         label:'Baguette' },
  { id:'main_libre',       label:'Main Libre' },
];

export async function loadWeaponFormats() {
  if (_weaponFormats) return _weaponFormats;
  try {
    const doc = await getDocData('world', 'weapon_formats');
    _weaponFormats = doc?.formats?.length ? doc.formats : DEFAULT_WEAPON_FORMATS;
  } catch {
    _weaponFormats = DEFAULT_WEAPON_FORMATS;
  }
  return _weaponFormats;
}

export async function saveWeaponFormats(formats) {
  await saveDoc('world', 'weapon_formats', { formats });
  _weaponFormats = formats;
}

export function invalidateWeaponFormatsCache() {
  _weaponFormats = null;
}
