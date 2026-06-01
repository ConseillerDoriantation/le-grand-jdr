// ══════════════════════════════════════════════════════════════════════════════
// SHARED / EQUIPMENT-UTILS.JS
// Helpers d'équipement utilisés hors du domaine characters/ :
// vtt.js, artisan.js, shop.js peuvent importer ici sans couplage cross-features.
// ══════════════════════════════════════════════════════════════════════════════
import { computeEquipStatsBonus, getItemEffectText, getItemStatBonus } from './char-stats.js';

// ── Arme par défaut (mains nues) ──────────────────────────────────────────────
export const DEFAULT_UNARMED = Object.freeze({
  nom:         'Poings',
  degats:      '2d4',
  statAttaque: 'force',
  format:      'À une main',
  portee:      1,
  icon:        '👊',
  isDefault:   true,
});

/** Retourne l'arme principale équipée, ou un objet "Poings" virtuel si vide. */
export function getMainWeapon(c) {
  const mainP = c?.equipement?.['Main principale'];
  if (mainP && mainP.nom) return mainP;
  return { ...DEFAULT_UNARMED };
}

// -- Traits d'items -------------------------------------------------------------

export function getBaseTraits(item = {}) {
  const removed = new Set(item?.upgrades?.removedBaseTraits || []);
  const out = [];
  if (Array.isArray(item.traits) && item.traits.length > 0) {
    item.traits.forEach(t => { if (t && !removed.has(t)) out.push(t); });
  } else if (item.trait && !removed.has(item.trait)) {
    out.push(item.trait);
  }
  return out;
}

export function getAddedTraits(item = {}) {
  return Array.isArray(item?.upgrades?.addedTraits)
    ? item.upgrades.addedTraits.filter(Boolean)
    : [];
}

export function getItemTraits(item = {}) {
  const all = [...getBaseTraits(item), ...getAddedTraits(item)];
  const bonus = parseInt(item?.upgrades?.effectBonus) || 0;
  if (bonus <= 0) return all;

  let applied = false;
  return all.map(t => {
    if (applied) return t;
    const txt = String(t);
    const m = txt.match(/(?<![\d.])(\+?)(\d+)(?![\d.])/);
    if (!m) return t;
    applied = true;
    const sign  = m[1] || '';
    const value = parseInt(m[2]);
    return txt.replace(m[0], sign + (value + bonus));
  });
}

export const _getBaseTraits = getBaseTraits;
export const _getAddedTraits = getAddedTraits;
export const _getTraits = getItemTraits;

// -- Stats d'arme ---------------------------------------------------------------

export function normalizeStatKey(value = '') {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^\+/, '');
  if (!raw) return '';
  const map = {
    for: 'force', force: 'force', str: 'force',
    dex: 'dexterite', dexterite: 'dexterite', agilite: 'dexterite',
    int: 'intelligence', intelligence: 'intelligence', in: 'intelligence',
    sag: 'sagesse', sagesse: 'sagesse', sa: 'sagesse', wis: 'sagesse',
    con: 'constitution', constitution: 'constitution', co: 'constitution',
    cha: 'charisme', charisme: 'charisme', ch: 'charisme',
  };
  return map[raw] || '';
}

export function getWeaponDamageStatKeys(item = {}) {
  if (Array.isArray(item.degatsStats) && item.degatsStats.length) {
    return item.degatsStats.map(normalizeStatKey).filter(Boolean);
  }
  const single = normalizeStatKey(item.degatsStat || item.statAttaque || '');
  return single ? [single] : [];
}

export function formatWeaponDamageStatsText(itemOrKeys = [], { statLabel = null } = {}) {
  const keys = Array.isArray(itemOrKeys) ? itemOrKeys : getWeaponDamageStatKeys(itemOrKeys);
  const label = statLabel || ((key) => key);
  return keys.map(label).filter(Boolean).join(' + ');
}

export function formatWeaponDamageText(item = {}, { statLabel = null } = {}) {
  if (!item?.degats) return '';
  const stats = formatWeaponDamageStatsText(item, { statLabel });
  return stats ? String(item.degats) + ' + ' + stats : String(item.degats);
}

export function getWeaponToucherStatKey(item = {}) {
  return normalizeStatKey(item.toucherStat || item.toucher || item.statAttaque || '');
}

export function isWeaponLikeItem(item = {}) {
  const template = String(item.template || '').toLowerCase();
  const format = String(item.format || '');
  return template === 'arme' || Boolean(item.degats || item.toucher || item.sousType || format.startsWith('Arme'));
}

// -- Projection item boutique/inventaire -> arme/equipement -------------------

export function inferAttackStatFromItem(item = {}) {
  if (item.toucherStat) return item.toucherStat;
  if (item.statAttaque) return item.statAttaque;
  const format = String(item.format || '');
  if (format.includes('Mag.')) return 'intelligence';
  if (format.includes('Dist.')) return 'dexterite';
  return 'force';
}

function inferArmorSlotValue(slot, item = {}) {
  if (item.slotArmure) return item.slotArmure;
  if (slot === 'Bottes') return 'Pieds';
  return slot;
}

function inferAccessorySlotValue(slot, item = {}) {
  return item.slotBijou || slot;
}

function copyDerivedEquipmentFields(item = {}) {
  return {
    pvMaxBonus:      parseInt(item.pvMaxBonus)      || 0,
    pmMaxBonus:      parseInt(item.pmMaxBonus)      || 0,
    vitesseBonus:    parseInt(item.vitesseBonus)    || 0,
    initiativeBonus: parseInt(item.initiativeBonus) || 0,
    caBonus:         parseInt(item.caBonus)         || 0,
    skillBonuses:    item.skillBonuses && typeof item.skillBonuses === 'object'
                     ? { ...item.skillBonuses } : {},
  };
}

function copyStatBonuses(item = {}) {
  return {
    fo:  getItemStatBonus(item, 'force'),
    dex: getItemStatBonus(item, 'dexterite'),
    in:  getItemStatBonus(item, 'intelligence'),
    sa:  getItemStatBonus(item, 'sagesse'),
    co:  getItemStatBonus(item, 'constitution'),
    ch:  getItemStatBonus(item, 'charisme'),
  };
}

export function buildEquippedItemFromInventory(slot, item, invIndex) {
  if (!item) return null;
  const isWeapon = slot.startsWith('Main');
  const rawTraits = [...getBaseTraits(item), ...getAddedTraits(item)];
  const effectBonus = parseInt(item.upgrades?.effectBonus) || 0;
  const equipUpgrades = effectBonus > 0 ? { effectBonus } : undefined;
  const common = {
    nom: item.nom || '',
    traits: rawTraits,
    ...(equipUpgrades ? { upgrades: equipUpgrades } : {}),
    ...copyStatBonuses(item),
    ...copyDerivedEquipmentFields(item),
    sourceInvIndex: invIndex,
    itemId: item.itemId || '',
  };

  if (isWeapon) {
    const inferredStat = inferAttackStatFromItem(item);
    return {
      ...common,
      sousType: item.sousType || '',
      degats: item.degats || '',
      degatsStat: item.degatsStat || inferredStat,
      degatsStats: Array.isArray(item.degatsStats) && item.degatsStats.length
        ? [...item.degatsStats]
        : (item.degatsStat ? [item.degatsStat] : [inferredStat]),
      toucherStat: item.toucherStat || inferredStat,
      statAttaque: inferredStat,
      typeArme: item.typeArme || item.type || '',
      portee: item.portee || '',
      particularite: item.particularite || getItemEffectText(item) || item.description || '',
      format: item.format || '',
      toucher: item.toucher || '',
      stats: item.stats || '',
    };
  }

  return {
    ...common,
    ca: parseInt(item.ca) || 0,
    typeArmure: item.typeArmure || '',
    slotArmure: item.slotArmure ? inferArmorSlotValue(slot, item) : '',
    slotBijou: item.slotBijou ? inferAccessorySlotValue(slot, item) : '',
  };
}

export function serializeShopWeaponForCombat(item = {}) {
  return {
    itemId: item.id || item.itemId || '',
    nom: item.nom || '',
    degats: item.degats || '',
    degatsStat: item.degatsStat || item.statAttaque || '',
    degatsStats: Array.isArray(item.degatsStats) ? [...item.degatsStats] : (item.degatsStat ? [item.degatsStat] : []),
    toucherStat: item.toucherStat || item.statAttaque || '',
    statAttaque: item.statAttaque || item.toucherStat || '',
    typeArme: item.typeArme || item.sousType || '',
    sousType: item.sousType || '',
    portee: item.portee || '',
    traits: getItemTraits(item),
    format: item.format || '',
    toucher: item.toucher || '',
    particularite: item.particularite || getItemEffectText(item) || '',
    stats: item.stats || '',
    ...copyStatBonuses(item),
  };
}

// ── Normalisation et méta des types d'armure ─────────────────────────────────

export function normalizeArmorType(type = '') {
  const raw = String(type || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!raw) return '';
  if (['leger', 'legere', 'light'].includes(raw)) return 'Légère';
  if (['intermediaire', 'medium', 'mid'].includes(raw)) return 'Intermédiaire';
  if (['lourd', 'lourde', 'heavy'].includes(raw)) return 'Lourde';
  return String(type || '').trim();
}

export function getArmorTypeMeta(type = '') {
  const label = normalizeArmorType(type);
  if (label === 'Légère') {
    return {
      label, tone: 'light',
      chipText: 'Léger : Coût des sorts -2 PM',
      modifiers: { spellPmDelta: -2, toucherBonus: 0, damageReduction: 0 },
    };
  }
  if (label === 'Intermédiaire') {
    return {
      label, tone: 'medium',
      chipText: 'Intermédiaire : Toucher +2',
      modifiers: { spellPmDelta: 0, toucherBonus: 2, damageReduction: 0 },
    };
  }
  if (label === 'Lourde') {
    return {
      label, tone: 'heavy',
      chipText: 'Lourd : Réduction 2 dégâts',
      modifiers: { spellPmDelta: 0, toucherBonus: 0, damageReduction: 2 },
    };
  }
  return { label, tone: 'neutral', chipText: '', modifiers: { spellPmDelta: 0, toucherBonus: 0, damageReduction: 0 } };
}

export function getArmorSetChipText(setData = {}) {
  if (!setData?.isActive) return '';
  return setData.activeEffect?.chipText || getArmorTypeMeta(setData.fullType).chipText || '';
}

export function getArmorSetData(c = {}) {
  const equip = c?.equipement || {};
  const trackedSlots = ['Tête', 'Torse', 'Bottes'];
  const slots = trackedSlots.map(slot => {
    const item = equip?.[slot] || {};
    return { slot, item, type: normalizeArmorType(item?.typeArmure), equipped: Boolean(item?.nom) };
  });

  const equippedCount = slots.filter(entry => entry.equipped).length;
  const typedSlots    = slots.filter(entry => entry.type);
  const counts        = typedSlots.reduce((acc, entry) => { acc[entry.type] = (acc[entry.type] || 0) + 1; return acc; }, {});
  const fullType      = ['Légère', 'Intermédiaire', 'Lourde'].find(type => counts[type] === trackedSlots.length) || '';
  const activeEffect  = fullType ? getArmorTypeMeta(fullType) : null;
  const mixed         = !fullType && Object.keys(counts).length > 1;
  const dominantType  = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  return {
    trackedSlots, slots, counts, equippedCount, fullType, dominantType, mixed,
    isComplete: equippedCount === trackedSlots.length,
    isActive:   Boolean(activeEffect),
    activeEffect,
    modifiers:  activeEffect?.modifiers || { spellPmDelta: 0, toucherBonus: 0, damageReduction: 0 },
  };
}

// ── Synchronisation équipement après mutation inventaire ─────────────────────

export function syncEquipmentAfterInventoryMutation(c, removedIndices = []) {
  const removed = [...new Set((removedIndices || [])
    .map(v => Number.isInteger(v) ? v : parseInt(v, 10))
    .filter(v => Number.isInteger(v) && v >= 0))].sort((a, b) => a - b);

  const currentEquip = c?.equipement || {};
  if (!removed.length) {
    return {
      equipement:   currentEquip,
      statsBonus:   c?.statsBonus || computeEquipStatsBonus(currentEquip),
      changed:      false,
      removedSlots: [],
    };
  }

  const removedSet = new Set(removed);
  const countRemovedBefore = idx => {
    let count = 0;
    for (const removedIdx of removed) { if (removedIdx < idx) count++; else break; }
    return count;
  };

  const nextEquip   = {};
  const removedSlots = [];
  let changed       = false;

  Object.entries(currentEquip).forEach(([slot, item]) => {
    const rawIdx = item?.sourceInvIndex;
    const srcIdx = Number.isInteger(rawIdx) ? rawIdx : parseInt(rawIdx, 10);

    if (!Number.isInteger(srcIdx) || srcIdx < 0) { nextEquip[slot] = item; return; }
    if (removedSet.has(srcIdx)) { changed = true; removedSlots.push(slot); return; }

    const nextIdx = srcIdx - countRemovedBefore(srcIdx);
    if (nextIdx !== srcIdx) { nextEquip[slot] = { ...item, sourceInvIndex: nextIdx }; changed = true; return; }
    nextEquip[slot] = item;
  });

  const statsBonus = computeEquipStatsBonus(nextEquip);
  const prevStats  = c?.statsBonus || {};
  if (JSON.stringify(prevStats) !== JSON.stringify(statsBonus)) changed = true;

  return { equipement: nextEquip, statsBonus, changed, removedSlots };
}
