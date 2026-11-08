// Logique pure de l'Artisan. Ce module ne lit ni le DOM ni Firestore : l'UI et
// les tests partagent ainsi exactement les mêmes plafonds et aperçus.

import { weaponHands } from './weapon-family.js';
import { ITEM_STAT_META, getItemBaseStatBonus } from './char-stats.js';
import { DEFAULT_RARITY_CAPS, rarityCapFromTable } from './rarity-caps.js';
import { getItemFragmentCategory } from './upgrade-value.js';
import { craftCategoryForItem, craftRecycleQty, craftRecipeMaterialsFromConfig } from './craft-engine.js';
import { recyclableTraits, nonRecyclableTraitNames } from './trait-recycling.js';

const n = value => Math.max(0, parseInt(value, 10) || 0);
const list = value => Array.isArray(value) ? value.filter(Boolean) : [];
const upgradeOf = settings => settings?.upgrade || settings || {};
const rarityCap = (kind, rarete, settings) => rarityCapFromTable(
  settings?.rarityCaps?.[kind] || DEFAULT_RARITY_CAPS[kind], rarete,
);

export function effectiveTraits(item = {}) {
  const removed = new Set(list(item?.upgrades?.removedBaseTraits));
  return [...list(item.traits).filter(name => !removed.has(name)), ...list(item?.upgrades?.addedTraits)];
}

export function getItemTraitsSlotCount(item = {}, settings = {}) {
  const s = upgradeOf(settings);
  const category = getItemFragmentCategory(item);
  if (!category) return 0;
  return Math.min(n(s.caps?.traitsPerItem?.[category]), rarityCap('traits', item.rarete, s));
}

export function traitCapAt(item = {}, rarete = item?.rarete, settings = {}) {
  return getItemTraitsSlotCount({ ...item, rarete }, settings);
}

export function statCapAt(item = {}, rarete = item?.rarete, settings = {}) {
  const s = upgradeOf(settings);
  const category = getItemFragmentCategory(item);
  // Les pistes d'un anneau sont indépendantes et ne sont volontairement pas
  // bornées par la rareté. Seuls ses traits utilisent le budget de rareté.
  if (category === 'Anneau') return n(s.caps?.ring);
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

export function ringTracks(item = {}, settings = {}) {
  if (getItemFragmentCategory(item) !== 'Anneau') return [];
  const cap = statCapAt(item, item.rarete, settings);
  const statTracks = ITEM_STAT_META
    .map(meta => ({
      id: meta.full,
      store: meta.store,
      label: meta.label,
      short: meta.short,
      base: getItemBaseStatBonus(item, meta.full),
      level: n(item?.upgrades?.statBonus?.[meta.store]),
      cap,
      kind: 'stat',
    }))
    .filter(track => track.base !== 0);
  const derived = ['pvMaxBonus', 'pmMaxBonus', 'vitesseBonus', 'initiativeBonus']
    .reduce((sum, key) => sum + Math.max(0, Number(item?.[key]) || 0), 0);
  if (derived > 0) statTracks.push({
    id: 'effect', label: 'Effet', short: 'Effet', base: derived,
    level: n(item?.upgrades?.effectBonus), cap, kind: 'effect',
  });
  return statTracks;
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
 * Les anneaux restent à part : chacun de leurs bonus possède sa propre piste
 * de renforcement et n'utilise donc pas ce budget commun.
 */
export function statPointUse(item = {}) {
  if (getItemFragmentCategory(item) === 'Anneau') return 0;
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
  const tracks = ringTracks(item, s);
  const statCost = category === 'Anneau'
    ? n(s.ring?.[Math.min(statCap, 1)])
    : category === 'Amulette'
      ? n(s.amulet?.[usedStats + 1])
      : n(s.weapon?.[weaponHands(item) === 2 ? '2H' : '1H']?.[usedStats + 1]);
  const canImproveRing = tracks.some(track => track.level < track.cap);
  const reforgeEval = settings.reforgeEval || settings.reforge || null;
  const hasGain = firstGainRarity(item, s) != null;
  const dismantle = traits.length > 0 || !!craftCategoryForItem(item);
  const result = {
    addTrait: traitCap > traits.length && fragments > 0 && affordable(s.trait?.addTraitFromFragment),
    replaceTrait: recyclableTraits(item, traits).length > 0 && fragments > 0 && affordable(s.trait?.overwriteTrait),
    stat: statCap > 0 && (category === 'Anneau' ? canImproveRing : usedStats < statCap) && affordable(statCost),
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
  const statsFull = category === 'Anneau'
    ? ringTracks(item, settings).every(track => track.level >= track.cap)
    : statPointUse(item) >= statCapAt(item, item.rarete, settings);
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
