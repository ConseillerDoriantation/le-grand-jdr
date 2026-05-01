import { getDocData, saveDoc } from '../data/firestore.js';

// ══════════════════════════════════════════════
// FORMATS D'ARMES
// Firestore : world/weapon_formats → { formats:[{id,label}] }
// ══════════════════════════════════════════════

let _weaponFormats = null;

export const DEFAULT_WEAPON_FORMATS = [
  { id:'arme_1m_cac_phy',  label:'Arme 1M CaC Phy.',  damageType:'physique' },
  { id:'arme_2m_cac_phy',  label:'Arme 2M CaC Phy.',  damageType:'physique' },
  { id:'arme_2m_dist_phy', label:'Arme 2M Dist Phy.', damageType:'physique' },
  { id:'arme_2m_cac_mag',  label:'Arme 2M CaC Mag.',  damageType:'magique'  },
  { id:'arme_2m_dist_mag', label:'Arme 2M Dist Mag.', damageType:'magique'  },
  { id:'bouclier',         label:'Bouclier',           damageType:'physique' },
  { id:'baguette',         label:'Baguette',           damageType:'magique'  },
  { id:'main_libre',       label:'Main Libre',         damageType:'physique' },
];

export async function loadWeaponFormats() {
  if (_weaponFormats) return _weaponFormats;
  try {
    const doc = await getDocData('world', 'weapon_formats');
    if (doc?.formats?.length) {
      // Remplir damageType manquant depuis les defaults (migration transparente)
      const defMap = Object.fromEntries(DEFAULT_WEAPON_FORMATS.map(f => [f.id, f]));
      _weaponFormats = doc.formats.map(f => ({
        ...f,
        damageType: f.damageType ?? defMap[f.id]?.damageType ?? '',
      }));
    } else {
      _weaponFormats = DEFAULT_WEAPON_FORMATS;
    }
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
