// ══════════════════════════════════════════════════════════════════════════════
// SHARED / EQUIPMENT-UTILS.JS
// Helpers d'équipement utilisés hors du domaine characters/ :
// vtt.js, artisan.js, shop.js peuvent importer ici sans couplage cross-features.
// ══════════════════════════════════════════════════════════════════════════════
import { computeEquipStatsBonus, getItemEffectText, getItemStatBonus } from './char-stats.js';
import { getEquipmentSlotsByKind, getPrimaryWeaponSlotId } from './equipment-slots.js';
import {
  formatArmorSetEffect,
  getArmorSetDefinition,
  getArmorTypeOptions,
  getEmptyArmorSetModifiers,
  normalizeArmorSetKey,
} from './armor-set-settings.js';

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
  const mainP = c?.equipement?.[getPrimaryWeaponSlotId()];
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
    ...(item.damageProfile && typeof item.damageProfile === 'object'
        ? { damageProfile: _cloneDamageProfile(item.damageProfile) } : {}),
  };
}

const _DMG_PROFILE_KEYS = ['resistances', 'immunites', 'absorptions', 'faiblesses'];

function _cloneDamageProfile(dp = {}) {
  const out = {};
  _DMG_PROFILE_KEYS.forEach(k => {
    if (Array.isArray(dp[k]) && dp[k].length) out[k] = [...dp[k]];
  });
  return out;
}

/**
 * Profil de dégâts agrégé d'un personnage à partir de TOUT son équipement
 * (résistances / immunités / absorptions / faiblesses accordées par les objets équipés).
 * Union dédupliquée → non cumulable : porter deux objets « Résistance feu » ne
 * compte qu'une fois. Forme identique à un `beast` → utilisable directement avec
 * `applyDamageTypeInteraction` (shared/damage-profile.js).
 * @returns {?{resistances:string[],immunites:string[],absorptions:string[],faiblesses:string[]}}
 *          null si aucun objet équipé n'accorde d'interaction.
 */
export function getCharDamageProfile(c) {
  const equip = c?.equipement || {};
  const out = { resistances: [], immunites: [], absorptions: [], faiblesses: [] };
  let any = false;
  for (const eq of Object.values(equip)) {
    const dp = eq?.damageProfile;
    if (!dp || typeof dp !== 'object') continue;
    for (const key of _DMG_PROFILE_KEYS) {
      const arr = Array.isArray(dp[key]) ? dp[key] : [];
      for (const id of arr) {
        if (id && !out[key].includes(id)) { out[key].push(id); any = true; }
      }
    }
  }
  return any ? out : null;
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
  const label = String(type || '').trim();
  if (!label) return '';
  // 1. Type defini par l'AVENTURE : on renvoie SON libelle exact. Sans ca, un set
  //    nomme « Lourd » etait reecrit en « Lourde » par la table heritee ci-dessous,
  //    ne correspondait plus a aucun set configure, et l'effet ne se declenchait pas.
  const key = normalizeArmorSetKey(label);
  const configure = getArmorTypeOptions({ includeDisabled: true })
    .find(t => normalizeArmorSetKey(t) === key);
  if (configure) return configure;
  return _legacyArmorType(label);
}

// 2. Repli historique : anciennes fiches stockant « legere », « heavy »…
function _legacyArmorType(type = '') {
  const raw = String(type || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!raw) return '';
  if (['leger', 'legere', 'light'].includes(raw)) return 'Légère';
  if (['intermediaire', 'medium', 'mid'].includes(raw)) return 'Intermédiaire';
  if (['lourd', 'lourde', 'heavy'].includes(raw)) return 'Lourde';
  return String(type || '').trim();
}

export function getArmorTypeMeta(type = '') {
  const label = normalizeArmorType(type);
  const def = getArmorSetDefinition(label);
  if (def) {
    return {
      label,
      tone: def.tone || 'neutral',
      chipText: `${def.label || label} : ${formatArmorSetEffect(def)}`,
      modifiers: { ...getEmptyArmorSetModifiers(), ...(def.modifiers || {}) },
      set: def,
    };
  }
  return { label, tone: 'neutral', chipText: '', modifiers: getEmptyArmorSetModifiers(), set: null };
}

export function getArmorSetChipText(setData = {}) {
  if (!setData?.isActive) return '';
  return setData.activeEffect?.chipText || '';
}

export function getArmorSetData(c = {}) {
  const equip = c?.equipement || {};
  const trackedSlots = getEquipmentSlotsByKind('armor').map(slot => slot.id);
  const slots = trackedSlots.map(slot => {
    const item = equip?.[slot] || {};
    return { slot, item, type: normalizeArmorType(item?.typeArmure), equipped: Boolean(item?.nom) };
  });

  const equippedCount = slots.filter(entry => entry.equipped).length;
  const typedSlots    = slots.filter(entry => entry.type);
  const counts        = typedSlots.reduce((acc, entry) => { acc[entry.type] = (acc[entry.type] || 0) + 1; return acc; }, {});
  const fullType      = trackedSlots.length > 0
    ? (Object.keys(counts).find(type => counts[type] === trackedSlots.length) || '')
    : '';
  const activeEffect  = fullType ? getArmorTypeMeta(fullType) : null;
  const mixed         = !fullType && Object.keys(counts).length > 1;
  const dominantType  = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  return {
    trackedSlots, slots, counts, equippedCount, fullType, dominantType, mixed,
    isComplete: trackedSlots.length > 0 && equippedCount === trackedSlots.length,
    isActive:   Boolean(fullType && activeEffect?.set),
    activeEffect,
    modifiers:  (fullType && activeEffect?.set) ? activeEffect.modifiers : getEmptyArmorSetModifiers(),
  };
}

// ── Résolution de l'index inventaire COURANT de chaque slot équipé ───────────
// Le slot d'équipement mémorise un `sourceInvIndex` (index de l'entrée d'origine),
// mais cet index devient PÉRIMÉ dès que l'inventaire est réordonné par une mutation
// qui ne passe pas par syncEquipmentAfterInventoryMutation (ajout, normalisation
// "1 entrée = 1 unité", etc.). On le revalide par IDENTITÉ (itemId si dispo, sinon
// nom) et on le retrouve si besoin → la surbrillance "équipé" et le déséquipement
// à la vente ciblent toujours la BONNE entrée (bug : un matériau marqué équipé à la
// place des bottes). Retourne Map<slot, index>.
export function resolveEquippedInventoryIndices(c) {
  const inv = Array.isArray(c?.inventaire) ? c.inventaire : [];
  const result  = new Map();
  const claimed = new Set();
  const sameItem = (entry, eq) => {
    if (!entry || !eq) return false;
    if (eq.itemId && entry.itemId) return entry.itemId === eq.itemId;
    return (entry.nom || '') === (eq.nom || '');
  };
  Object.entries(c?.equipement || {}).forEach(([slot, eq]) => {
    if (!eq?.nom) return;
    const raw = eq?.sourceInvIndex;
    let idx = Number.isInteger(raw) ? raw : parseInt(raw, 10);
    // 1) indice mémorisé valide ET pointant bien sur le bon objet, pas déjà pris
    if (!(Number.isInteger(idx) && idx >= 0 && !claimed.has(idx) && sameItem(inv[idx], eq))) {
      // 2) sinon : 1re entrée correspondante non encore réclamée
      idx = inv.findIndex((entry, i) => !claimed.has(i) && sameItem(entry, eq));
    }
    if (Number.isInteger(idx) && idx >= 0) { claimed.add(idx); result.set(slot, idx); }
  });
  return result;
}

// ── Synchronisation équipement après mutation inventaire ─────────────────────

export function syncEquipmentAfterInventoryMutation(c, removedIndices = []) {
  const removed = [...new Set((removedIndices || [])
    .map(v => Number.isInteger(v) ? v : parseInt(v, 10))
    .filter(v => Number.isInteger(v) && v >= 0))].sort((a, b) => a - b);

  const currentEquip = c?.equipement || {};
  const removedSet = new Set(removed);
  const countRemovedBefore = idx => {
    let count = 0;
    for (const removedIdx of removed) { if (removedIdx < idx) count++; else break; }
    return count;
  };

  const nextEquip   = {};
  const removedSlots = [];
  let changed       = false;

  // Index COURANT réel de chaque slot (par identité) — ignore un sourceInvIndex périmé.
  const resolved = resolveEquippedInventoryIndices(c);

  Object.entries(currentEquip).forEach(([slot, item]) => {
    const srcIdx = resolved.has(slot) ? resolved.get(slot) : -1;

    if (!Number.isInteger(srcIdx) || srcIdx < 0) { nextEquip[slot] = item; return; }
    if (removedSet.has(srcIdx)) { changed = true; removedSlots.push(slot); return; }

    const nextIdx  = srcIdx - countRemovedBefore(srcIdx);
    const sourceItem = removed.length ? null : c?.inventaire?.[srcIdx];
    const rebuilt = sourceItem ? buildEquippedItemFromInventory(slot, sourceItem, nextIdx) : null;
    if (rebuilt) {
      nextEquip[slot] = rebuilt;
      if (JSON.stringify(item) !== JSON.stringify(rebuilt)) changed = true;
      return;
    }

    const rawStored = item?.sourceInvIndex;
    const storedIdx = Number.isInteger(rawStored) ? rawStored : parseInt(rawStored, 10);
    // Réécrit sourceInvIndex à l'index correct post-mutation (répare aussi un index périmé).
    if (nextIdx !== storedIdx) { nextEquip[slot] = { ...item, sourceInvIndex: nextIdx }; changed = true; return; }
    nextEquip[slot] = item;
  });

  const statsBonus = computeEquipStatsBonus(nextEquip);
  const prevStats  = c?.statsBonus || {};
  if (JSON.stringify(prevStats) !== JSON.stringify(statsBonus)) changed = true;

  return { equipement: nextEquip, statsBonus, changed, removedSlots };
}
