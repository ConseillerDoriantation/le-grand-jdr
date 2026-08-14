import { getCurrentAdventureId, getDocData, saveDoc } from '../data/firestore.js';
import { normalizeWeaponTechnique } from './weapon-techniques.js';
export { normalizeWeaponTechnique } from './weapon-techniques.js';

// ══════════════════════════════════════════════
// FORMATS D'ARMES
// Firestore : world/weapon_formats → { formats:[{id,label}] }
// ══════════════════════════════════════════════

let _weaponFormats = null;

const POINT_FAIBLE = Object.freeze({
  id: 'point_faible',
  icon: '🎯',
  label: 'Point faible',
  description: 'Vise une zone vulnérable : la cible est plus difficile à toucher, mais le coup inflige davantage de dégâts.',
  defenseBonus: 4,
  extraWeaponDice: 1,
  extraDamageFormula: '',
  extraDamageFlat: 0,
  onHitEffect: '',
});

const LEGACY_WEAPON_FORMATS = [
  { id:'arme_1m_cac_phy',  label:'Arme 1M CaC Phy.',  damageType:'physique', isMagic: false },
  { id:'arme_2m_cac_phy',  label:'Arme 2M CaC Phy.',  damageType:'physique', isMagic: false },
  { id:'arme_2m_dist_phy', label:'Arme 2M Dist Phy.', damageType:'physique', isMagic: false, techniques:[POINT_FAIBLE] },
  { id:'arme_2m_cac_mag',  label:'Arme 2M CaC Mag.',  damageType:'',         isMagic: true  },
  { id:'arme_2m_dist_mag', label:'Arme 2M Dist Mag.', damageType:'',         isMagic: true  },
  { id:'bouclier',         label:'Bouclier',           damageType:'physique', isMagic: false },
  { id:'baguette',         label:'Baguette',           damageType:'',         isMagic: true  },
  { id:'main_libre',       label:'Main Libre',         damageType:'physique', isMagic: false },
];

export const DEFAULT_WEAPON_FORMATS = [
  { id:'simple_melee',    label:'Arme courante de mêlée',    damageType:'physique', isMagic: false },
  { id:'simple_ranged',   label:'Arme courante à distance',  damageType:'physique', isMagic: false, techniques:[POINT_FAIBLE] },
  { id:'martial_melee',   label:'Arme de guerre de mêlée',   damageType:'physique', isMagic: false },
  { id:'martial_ranged',  label:'Arme de guerre à distance', damageType:'physique', isMagic: false, techniques:[POINT_FAIBLE] },
  { id:'spell_focus',     label:'Focaliseur magique',        damageType:'',         isMagic: true  },
  { id:'bouclier',        label:'Bouclier',                   damageType:'physique', isMagic: false },
  { id:'main_libre',      label:'Main libre',                 damageType:'physique', isMagic: false },
];

export function normalizeWeaponFormat(format = {}) {
  return {
    ...format,
    techniques: Array.isArray(format.techniques)
      ? format.techniques.map(normalizeWeaponTechnique).filter(t => t.label)
      : [],
  };
}

function _cloneWeaponFormats(formats = DEFAULT_WEAPON_FORMATS) {
  return formats.map(f => normalizeWeaponFormat({ ...f }));
}

function _defaultWeaponFormatsForAdventure() {
  return getCurrentAdventureId() === 'le-grand-jdr'
    ? _cloneWeaponFormats(LEGACY_WEAPON_FORMATS)
    : _cloneWeaponFormats(DEFAULT_WEAPON_FORMATS);
}

function _initialTechniquesForFormat(format, fallback = {}) {
  if (Array.isArray(format.techniques)) return format.techniques;
  if (Array.isArray(fallback.techniques)) return fallback.techniques;
  const label = String(format.label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const physicalRanged = format.isMagic !== true
    && /distance|ranged|tir/.test(label)
    && /phys|arme/.test(label);
  return physicalRanged ? [POINT_FAIBLE] : [];
}

export async function loadWeaponFormats() {
  if (_weaponFormats) return _weaponFormats;
  try {
    const doc = await getDocData('world', 'weapon_formats');
    if (doc?.formats?.length) {
      // Remplir damageType manquant depuis les defaults (migration transparente)
      const defMap = Object.fromEntries([...DEFAULT_WEAPON_FORMATS, ...LEGACY_WEAPON_FORMATS].map(f => [f.id, f]));
      _weaponFormats = doc.formats.map(f => normalizeWeaponFormat({
        ...f,
        damageType: f.damageType ?? defMap[f.id]?.damageType ?? '',
        isMagic:    f.isMagic    ?? defMap[f.id]?.isMagic    ?? false,
        // Migration douce : le format à distance historique reçoit le preset
        // uniquement tant qu'aucune configuration de techniques n'existe.
        techniques: _initialTechniquesForFormat(f, defMap[f.id]),
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
  const normalized = (formats || []).map(normalizeWeaponFormat);
  await saveDoc('world', 'weapon_formats', { formats: normalized });
  _weaponFormats = normalized;
}

export function invalidateWeaponFormatsCache() {
  _weaponFormats = null;
}
