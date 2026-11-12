// Logique pure de l'Artisan. Ce module ne lit ni le DOM ni Firestore : l'UI et
// les tests partagent ainsi exactement les mêmes plafonds et aperçus.

import { weaponHands } from './weapon-family.js';
import { ITEM_STAT_META, getItemBaseStatBonus } from './char-stats.js';
import { DEFAULT_RARITY_CAPS, DEFAULT_RING_CAPS, DEFAULT_ARMOR_CAPS, rarityCapFromTable } from './rarity-caps.js';
import { getItemFragmentCategory } from './upgrade-value.js';
import { craftCategoryForItem, craftRecycleQty, craftRecipeMaterialsFromConfig } from './craft-engine.js';
import { recyclableTraits, nonRecyclableTraitNames } from './trait-recycling.js';

const n = value => Math.max(0, parseInt(value, 10) || 0);
const list = value => Array.isArray(value) ? value.filter(Boolean) : [];
const upgradeOf = settings => settings?.upgrade || settings || {};
const rarityCap = (kind, rarete, settings) => rarityCapFromTable(
  settings?.rarityCaps?.[kind] || DEFAULT_RARITY_CAPS[kind], rarete,
);
// Plafonds propres à l'anneau (profondeur sur ses stats natives, traits plus serrés).
const ringCap = (kind, rarete, settings) => rarityCapFromTable(
  settings?.rarityCaps?.ring?.[kind] || DEFAULT_RING_CAPS[kind], rarete,
);
// Plafonds propres à l'armure (une seule table, aucun slot en dur).
const armorCap = (kind, rarete, settings) => rarityCapFromTable(
  settings?.rarityCaps?.armor?.[kind] || DEFAULT_ARMOR_CAPS[kind], rarete,
);
// « Est-ce une armure ? » — par template (robuste aux slots personnalisés du MJ).
const isArmor = item => (item?.template || '').toLowerCase() === 'armure' || !!item?.slotArmure;
// Stats réellement portées par l'objet (celles qu'un anneau peut approfondir).
const nativeStats = item => ITEM_STAT_META.filter(meta => getItemBaseStatBonus(item, meta.full) !== 0);

export function effectiveTraits(item = {}) {
  const removed = new Set(list(item?.upgrades?.removedBaseTraits));
  return [...list(item.traits).filter(name => !removed.has(name)), ...list(item?.upgrades?.addedTraits)];
}

export function getItemTraitsSlotCount(item = {}, settings = {}) {
  const s = upgradeOf(settings);
  const category = getItemFragmentCategory(item);
  if (!category) return 0;
  // Anneau et armure ont leur propre quota de traits par rareté (une seule table chacun).
  if (category === 'Anneau') return ringCap('traits', item.rarete, s);
  if (isArmor(item)) return armorCap('traits', item.rarete, s);
  // Arme : plafond de traits distinct selon le maniement (1M < 2M), × la rareté.
  if (category === 'arme') {
    const whCap = weaponHands(item) === 2 ? s.caps?.weaponTraits2H : s.caps?.weaponTraits1H;
    const cap = whCap != null ? n(whCap) : n(s.caps?.traitsPerItem?.arme); // repli ancienne config
    return Math.min(cap, rarityCap('traits', item.rarete, s));
  }
  // Amulette ou accessoire : quota par catégorie ; un slot d'accessoire personnalisé
  // (hors Amulette) retombe sur le quota « Objet magique ».
  const perItem = s.caps?.traitsPerItem || {};
  const own = perItem[category];
  const cap = own != null ? n(own) : (item.slotBijou ? n(perItem['Objet magique']) : n(own));
  return Math.min(cap, rarityCap('traits', item.rarete, s));
}

export function traitCapAt(item = {}, rarete = item?.rarete, settings = {}) {
  return getItemTraitsSlotCount({ ...item, rarete }, settings);
}

export function statCapAt(item = {}, rarete = item?.rarete, settings = {}) {
  const s = upgradeOf(settings);
  const category = getItemFragmentCategory(item);
  // L'anneau approfondit SES stats natives avec un budget de points par rareté.
  if (category === 'Anneau') return ringCap('stats', rarete, s);
  // L'armure : une seule table par rareté (le MJ choisit ses slots, pas de cap par slot).
  if (isArmor(item)) return armorCap('stats', rarete, s);
  const familyCap = category === 'Amulette'
    ? n(s.caps?.amulet)
    : category === 'arme'
      ? n(weaponHands(item) === 2 ? s.caps?.weapon2H : s.caps?.weapon1H)
      : 0;
  return familyCap ? Math.min(familyCap, rarityCap('stats', rarete, s)) : 0;
}

export function unlockRarity(item = {}, kind = 'traits', index = 1, settings = {}) {
  const target = Math.max(1, n(index));
  const s = upgradeOf(settings);
  const table = s.rarityCaps?.[kind] || {};
  const rarities = Object.keys(table).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  return rarities.find(rarity => (kind === 'traits' ? traitCapAt(item, rarity, s) : statCapAt(item, rarity, s)) >= target) ?? null;
}

export function firstGainRarity(item = {}, settings = {}) {
  const s = upgradeOf(settings);
  const current = Math.max(1, n(item.rarete) || 1);
  const tableKeys = [
    ...Object.keys(s.rarityCaps?.traits || {}),
    ...Object.keys(s.rarityCaps?.stats || {}),
  ].map(Number).filter(Number.isFinite);
  const maxRarity = Math.max(current, ...tableKeys, 5);
  const traitNow = traitCapAt(item, current, s);
  const statNow = statCapAt(item, current, s);
  for (let rarity = current + 1; rarity <= maxRarity; rarity++) {
    if (traitCapAt(item, rarity, s) > traitNow || statCapAt(item, rarity, s) > statNow) return rarity;
  }
  return null;
}

// Stats natives d'un anneau, exposées pour l'UI (chaque stat = cible d'approfondissement).
// L'effet éventuel reste figé (identité) : il n'est plus amélioré à l'Artisan.
export function ringStatTargets(item = {}) {
  if (getItemFragmentCategory(item) !== 'Anneau') return [];
  return nativeStats(item).map(meta => ({
    id: meta.full, store: meta.store, label: meta.label, short: meta.short,
    base: getItemBaseStatBonus(item, meta.full),
    level: n(item?.upgrades?.statBonus?.[meta.store]),
  }));
}

function compatibleFragments(char = {}, item = {}) {
  const category = getItemFragmentCategory(item);
  return Object.values(char?.traitFragments?.[category] || {}).reduce((sum, value) => sum + n(value), 0);
}

/**
 * Nombre de points de caractéristiques déjà consommés par l'objet.
 * Les bonus présents à l'acquisition font partie de son potentiel, au même
 * titre que les points ajoutés ensuite par l'Artisan.
 *
 * L'anneau utilise désormais ce même budget, restreint à ses stats natives
 * (profondeur), et plafonné par rareté comme une arme.
 */
export function statPointUse(item = {}) {
  const base = ITEM_STAT_META.reduce((sum, meta) => sum + n(getItemBaseStatBonus(item, meta.full)), 0);
  const upgrades = Object.values(item?.upgrades?.statBonus || {}).reduce((sum, value) => sum + n(value), 0);
  return base + upgrades;
}

export function possibleActions(char = {}, item = {}, settings = {}) {
  const s = upgradeOf(settings);
  const free = !!settings.freeMode;
  const gold = Number.isFinite(Number(settings.gold)) ? Number(settings.gold) : 0;
  const affordable = cost => free || gold >= n(cost);
  const traits = effectiveTraits(item);
  const traitCap = traitCapAt(item, item.rarete, s);
  const fragments = Number.isFinite(Number(settings.fragmentCount)) ? n(settings.fragmentCount) : compatibleFragments(char, item);
  const category = getItemFragmentCategory(item);
  const statCap = statCapAt(item, item.rarete, s);
  const usedStats = statPointUse(item);
  const statCost = category === 'Anneau'
    ? n(s.ring?.[usedStats + 1])
    : isArmor(item)
      ? n(s.armor?.[usedStats + 1])
      : category === 'Amulette'
        ? n(s.amulet?.[usedStats + 1])
        : n(s.weapon?.[weaponHands(item) === 2 ? '2H' : '1H']?.[usedStats + 1]);
  // L'anneau ne peut approfondir que s'il porte au moins une stat native.
  const hasStatTarget = category === 'Anneau' ? nativeStats(item).length > 0 : true;
  const reforgeEval = settings.reforgeEval || settings.reforge || null;
  const hasGain = firstGainRarity(item, s) != null;
  const dismantle = traits.length > 0 || !!craftCategoryForItem(item);
  const result = {
    addTrait: traitCap > traits.length && fragments > 0 && affordable(s.trait?.addTraitFromFragment),
    replaceTrait: recyclableTraits(item, traits).length > 0 && fragments > 0 && affordable(s.trait?.overwriteTrait),
    stat: statCap > 0 && usedStats < statCap && hasStatTarget && affordable(statCost),
    reforge: hasGain && !!(free || reforgeEval?.ok),
    dismantle,
  };
  result.any = result.addTrait || result.replaceTrait || result.stat || result.reforge || result.dismantle;
  return result;
}

export function isMaxed(char = {}, item = {}, settings = {}) {
  const actions = possibleActions(char, item, settings);
  const traitsFull = effectiveTraits(item).length >= traitCapAt(item, item.rarete, settings);
  const category = getItemFragmentCategory(item);
  // L'anneau sans stat native n'a pas de budget à remplir → considéré « plein ».
  const noRingTarget = category === 'Anneau' && nativeStats(item).length === 0;
  const statsFull = noRingTarget
    || statPointUse(item) >= statCapAt(item, item.rarete, settings);
  return traitsFull && statsFull && firstGainRarity(item, settings) == null
    && !actions.addTrait && !actions.replaceTrait && !actions.stat && !actions.reforge;
}

export function dismantlePreview(item = {}, settings = {}, craftCfg = {}) {
  const traits = effectiveTraits(item);
  const recoveredTraits = recyclableTraits(item, traits);
  const lostTraits = nonRecyclableTraitNames(item).filter(name => traits.includes(name));
  const category = craftCategoryForItem(item);
  const tier = Math.max(1, Math.min(3, n(item.rarete) || 1));
  const materials = category
    ? craftRecipeMaterialsFromConfig(category, tier, craftCfg).map(req => ({
        ...req,
        quantite: craftRecycleQty(req.quantite, craftCfg),
      })).filter(req => req.quantite > 0)
    : [];
  return {
    category,
    tier,
    recoveredTraits,
    lostTraits,
    materials,
    cost: n(upgradeOf(settings).trait?.deconstructCost),
  };
}
