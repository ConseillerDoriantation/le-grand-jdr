// ══════════════════════════════════════════════════════════════════════════════
// SHARED / EQUIPMENT-UTILS.JS
// Helpers d'équipement utilisés hors du domaine characters/ :
// vtt.js, artisan.js, shop.js peuvent importer ici sans couplage cross-features.
// ══════════════════════════════════════════════════════════════════════════════
import { computeEquipStatsBonus } from './char-stats.js';

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
