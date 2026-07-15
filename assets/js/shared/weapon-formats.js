import { getCurrentAdventureId, getDocData, saveDoc } from '../data/firestore.js';

// ══════════════════════════════════════════════
// FORMATS D'ARMES
// Firestore : world/weapon_formats → { formats:[{id,label}] }
// ══════════════════════════════════════════════

let _weaponFormats = null;

const LEGACY_WEAPON_FORMATS = [
  { id:'arme_1m_cac_phy',  label:'Arme 1M CaC Phy.',  damageType:'physique', isMagic: false },
  { id:'arme_2m_cac_phy',  label:'Arme 2M CaC Phy.',  damageType:'physique', isMagic: false },
  { id:'arme_2m_dist_phy', label:'Arme 2M Dist Phy.', damageType:'physique', isMagic: false },
  { id:'arme_2m_cac_mag',  label:'Arme 2M CaC Mag.',  damageType:'',         isMagic: true  },
  { id:'arme_2m_dist_mag', label:'Arme 2M Dist Mag.', damageType:'',         isMagic: true  },
  { id:'bouclier',         label:'Bouclier',           damageType:'physique', isMagic: false },
  { id:'baguette',         label:'Baguette',           damageType:'',         isMagic: true  },
  { id:'main_libre',       label:'Main Libre',         damageType:'physique', isMagic: false },
];

export const DEFAULT_WEAPON_FORMATS = [
  { id:'simple_melee',    label:'Arme courante de mêlée',    damageType:'physique', isMagic: false },
  { id:'simple_ranged',   label:'Arme courante à distance',  damageType:'physique', isMagic: false },
  { id:'martial_melee',   label:'Arme de guerre de mêlée',   damageType:'physique', isMagic: false },
  { id:'martial_ranged',  label:'Arme de guerre à distance', damageType:'physique', isMagic: false },
  { id:'spell_focus',     label:'Focaliseur magique',        damageType:'',         isMagic: true  },
  { id:'bouclier',        label:'Bouclier',                   damageType:'physique', isMagic: false },
  { id:'main_libre',      label:'Main libre',                 damageType:'physique', isMagic: false },
];

function _cloneWeaponFormats(formats = DEFAULT_WEAPON_FORMATS) {
  return formats.map(f => ({ ...f }));
}

function _defaultWeaponFormatsForAdventure() {
  return getCurrentAdventureId() === 'le-grand-jdr'
    ? _cloneWeaponFormats(LEGACY_WEAPON_FORMATS)
    : _cloneWeaponFormats(DEFAULT_WEAPON_FORMATS);
}

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
        isMagic:    f.isMagic    ?? defMap[f.id]?.isMagic    ?? false,
      }));
    } else {
      _weaponFormats = _defaultWeaponFormatsForAdventure();
    }
  } catch {
    _weaponFormats = _defaultWeaponFormatsForAdventure();
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
