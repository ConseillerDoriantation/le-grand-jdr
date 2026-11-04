// Vue fusionnée, pure et testable, des deux documents de réglages artisanaux.
// Le stockage reste volontairement séparé entre world/craft_config et
// world/upgrade_settings ; seule l'interface les présente comme un parcours.

import { DEFAULT_CRAFT_CONFIG } from './craft-engine.js';
import { DEFAULT_RARITY_CAPS } from './rarity-caps.js';
import { DEFAULT_REFORGE, mergeReforge } from './reforge.js';

export const ARTISAN_DISCIPLINES = [
  { id: 'forge', label: 'Forge', icon: '⚒', color: '#ff9544' },
  { id: 'confection', label: 'Confection', icon: '◈', color: '#22c38e' },
  { id: 'orfevre', label: 'Orfèvrerie', icon: '◇', color: '#bca0ff' },
];

export const ARTISAN_FAMILIES = [
  { id: 'arme', label: 'Armes', icon: '⚔', cats: ['armeCaC', 'armeDist', 'armeMagique'] },
  { id: 'armure', label: 'Armures', icon: '⬟', cats: ['armureLegere', 'armureIntermediaire', 'armureLourde'], note: 'Tête, torse et pieds' },
  { id: 'anneau', label: 'Anneaux', icon: '◉', cats: ['anneau'] },
  { id: 'amulette', label: 'Amulettes', icon: '♙', cats: ['amulette'] },
  { id: 'objmag', label: 'Objets magiques', icon: '✦', cats: [] },
];

export const ARTISAN_CATEGORIES = {
  armeCaC: { fam: 'arme', label: 'Physique · mêlée', example: 'Épée, hache, masse', noun: 'une épée', fem: true },
  armeDist: { fam: 'arme', label: 'Physique · distance', example: 'Arc, arbalète, main libre', noun: 'un arc' },
  armeMagique: { fam: 'arme', label: 'Magique', example: 'Bâton, baguette, lame magique', noun: 'un bâton' },
  armureLegere: { fam: 'armure', label: 'Légère', example: 'Robe, tunique', noun: 'une robe', fem: true },
  armureIntermediaire: { fam: 'armure', label: 'Intermédiaire', example: 'Cuir tanné, broigne', noun: 'une broigne', fem: true },
  armureLourde: { fam: 'armure', label: 'Lourde', example: 'Plates, mailles et boucliers', noun: 'une cuirasse', fem: true },
  anneau: { fam: 'anneau', label: 'Anneau', example: '', noun: 'un anneau' },
  amulette: { fam: 'amulette', label: 'Amulette', example: '', noun: 'une amulette', fem: true },
};

const clone = value => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const numbered = table => Object.keys(table || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b).map(k => Math.max(0, Number(table[k]) || 0));

export const DEFAULT_ARTISAN_UPGRADE = {
  trait: { deconstructCost: 0, addTraitFromFragment: 100, overwriteTrait: 200, extractAllTraits: false },
  weapon: { '1H': { 1: 150, 2: 300 }, '2H': { 1: 250, 2: 500, 3: 800, 4: 1200 } },
  amulet: { 1: 200, 2: 400, 3: 800 },
  ring: { 1: 250 },
  caps: {
    weapon1H: 2, weapon2H: 4, amulet: 3, ring: 1,
    traitsPerItem: { arme: 2, 'Tête': 1, 'Torse': 1, 'Pieds': 1, 'Amulette': 1, 'Anneau': 1, 'Objet magique': 1 },
  },
  rarityCaps: clone(DEFAULT_RARITY_CAPS),
  reforge: clone(DEFAULT_REFORGE),
  refundUpgradeRatio: 0,
  pricing: {},
};

function normalizedPrices(table, cap, fallback) {
  let values = numbered(table);
  if (!values.length) values = numbered(fallback);
  const wanted = clamp(cap || values.length || 1, 1, 8);
  values = values.slice(0, wanted);
  while (values.length < wanted) {
    const last = values.at(-1) || 0;
    const previous = values.at(-2) ?? 0;
    values.push(Math.max(0, last + Math.max(10, last - previous)));
  }
  return values;
}

function grid(upgrade, key, table, cap, fallback) {
  const pricing = upgrade.pricing?.[key] || {};
  const prices = normalizedPrices(table, cap, fallback);
  return {
    mode: pricing.mode === 'formule' ? 'formule' : 'manuel',
    base: Math.max(0, Number(pricing.base ?? prices[0]) || 0),
    mult: Math.max(1, Number(pricing.mult ?? (prices[1] && prices[0] ? prices[1] / prices[0] : 2)) || 1),
    prices,
  };
}

export function mergeArtisanSettings(craftStored = {}, upgradeStored = {}) {
  const craft = { ...clone(DEFAULT_CRAFT_CONFIG), ...clone(craftStored) };
  craft.categorieDiscipline = { ...DEFAULT_CRAFT_CONFIG.categorieDiscipline, ...(craftStored.categorieDiscipline || {}) };
  craft.disciplineCompetence = { ...DEFAULT_CRAFT_CONFIG.disciplineCompetence, ...(craftStored.disciplineCompetence || {}) };
  craft.ddParPalier = { ...DEFAULT_CRAFT_CONFIG.ddParPalier, ...(craftStored.ddParPalier || {}) };
  craft.quantiteParPalier = { ...DEFAULT_CRAFT_CONFIG.quantiteParPalier, ...(craftStored.quantiteParPalier || {}) };

  const d = DEFAULT_ARTISAN_UPGRADE;
  const upgrade = {
    ...clone(d), ...clone(upgradeStored),
    trait: { ...d.trait, ...(upgradeStored.trait || {}) },
    caps: { ...d.caps, ...(upgradeStored.caps || {}), traitsPerItem: { ...d.caps.traitsPerItem, ...(upgradeStored.caps?.traitsPerItem || {}) } },
    rarityCaps: {
      stats: { ...d.rarityCaps.stats, ...(upgradeStored.rarityCaps?.stats || {}) },
      traits: { ...d.rarityCaps.traits, ...(upgradeStored.rarityCaps?.traits || {}) },
    },
    reforge: mergeReforge(upgradeStored.reforge),
  };
  const armorValues = ['Tête', 'Torse', 'Pieds'].map(k => Math.max(0, Number(upgrade.caps.traitsPerItem[k]) || 0));
  const armorMismatch = new Set(armorValues).size > 1;
  const disc = {};
  for (const dsc of ARTISAN_DISCIPLINES) disc[dsc.id] = {
    skill: craft.disciplineCompetence[dsc.id] || '',
    room: upgrade.reforge.disciplineRoom[dsc.id] || '',
  };
  const recipes = {};
  for (const [cat, tiers] of Object.entries(craft.recipes || {})) {
    recipes[cat] = {};
    for (const [tier, recipe] of Object.entries(tiers || {})) recipes[cat][tier] = {
      mat: recipe?.itemId || '',
      qty: recipe?.quantite ?? '',
    };
  }
  return {
    disc,
    cats: clone(craft.categorieDiscipline),
    craft: {
      maxTier: clamp(craft.maxTier ?? 3, 1, 3),
      dd: clone(craft.ddParPalier),
      qty: clone(craft.quantiteParPalier),
      fail: Math.round(clamp(craft.refundFractionOnFail, 0, 1) * 100),
    },
    recipes,
    up: {
      traitAdd: upgrade.trait.addTraitFromFragment,
      traitRep: upgrade.trait.overwriteTrait,
      slots: {
        arme: upgrade.caps.traitsPerItem.arme,
        armure: Math.max(...armorValues),
        anneau: upgrade.caps.traitsPerItem.Anneau,
        amulette: upgrade.caps.traitsPerItem.Amulette,
        objmag: upgrade.caps.traitsPerItem['Objet magique'],
      },
      armorSlots: { 'Tête': armorValues[0], 'Torse': armorValues[1], 'Pieds': armorValues[2] },
      armorDetailed: armorMismatch,
      armorMismatch,
      grids: {
        w1: grid(upgrade, '1H', upgrade.weapon?.['1H'], upgrade.caps.weapon1H, d.weapon['1H']),
        w2: grid(upgrade, '2H', upgrade.weapon?.['2H'], upgrade.caps.weapon2H, d.weapon['2H']),
        amulette: grid(upgrade, 'amulet', upgrade.amulet, upgrade.caps.amulet, d.amulet),
        anneau: grid(upgrade, 'ring', upgrade.ring, 1, d.ring),
      },
      rcap: clone(upgrade.rarityCaps),
    },
    reforge: {
      on: upgrade.reforge.enabled,
      pct: upgrade.reforge.materialPercent,
      level: clone(upgrade.reforge.roomLevelForRarity),
      gold: clone(upgrade.reforge.goldForRarity),
    },
    dis: {
      cost: upgrade.trait.deconstructCost,
      all: upgrade.trait.extractAllTraits,
      pct: Math.round(clamp(craft.recycleFraction, 0, 1) * 100),
    },
    resale: { pct: Math.round(clamp(upgrade.refundUpgradeRatio, 0, 1) * 100) },
  };
}

function priceTable(prices) {
  return Object.fromEntries((prices || []).map((value, index) => [index + 1, Math.max(0, Math.round(Number(value) || 0))]));
}

export function splitArtisanSettings(view, craftBase = {}, upgradeBase = {}) {
  const craft = clone(craftBase || {});
  craft.categorieDiscipline = clone(view.cats);
  craft.disciplineCompetence = Object.fromEntries(ARTISAN_DISCIPLINES.map(d => [d.id, view.disc[d.id]?.skill || '']));
  craft.ddParPalier = clone(view.craft.dd);
  craft.quantiteParPalier = clone(view.craft.qty);
  craft.refundFractionOnFail = clamp(view.craft.fail, 0, 100) / 100;
  craft.recycleFraction = clamp(view.dis.pct, 0, 100) / 100;
  craft.maxTier = clamp(view.craft.maxTier, 1, 3);
  craft.recipes = {};
  for (const [cat, tiers] of Object.entries(view.recipes || {})) {
    craft.recipes[cat] = {};
    for (const [tier, recipe] of Object.entries(tiers || {})) {
      if (!recipe?.mat) continue;
      craft.recipes[cat][tier] = { itemId: String(recipe.mat) };
      if (recipe.qty !== '' && recipe.qty != null) craft.recipes[cat][tier].quantite = Math.max(1, parseInt(recipe.qty, 10) || 1);
    }
  }

  const upgrade = clone(upgradeBase || {});
  upgrade.trait = {
    ...(upgrade.trait || {}),
    deconstructCost: Math.max(0, Number(view.dis.cost) || 0),
    addTraitFromFragment: Math.max(0, Number(view.up.traitAdd) || 0),
    overwriteTrait: Math.max(0, Number(view.up.traitRep) || 0),
    extractAllTraits: !!view.dis.all,
  };
  upgrade.weapon = { '1H': priceTable(view.up.grids.w1.prices), '2H': priceTable(view.up.grids.w2.prices) };
  upgrade.amulet = priceTable(view.up.grids.amulette.prices);
  upgrade.ring = priceTable(view.up.grids.anneau.prices.slice(0, 1));
  const armor = view.up.armorDetailed
    ? view.up.armorSlots
    : { 'Tête': view.up.slots.armure, 'Torse': view.up.slots.armure, 'Pieds': view.up.slots.armure };
  upgrade.caps = {
    ...(upgrade.caps || {}),
    weapon1H: view.up.grids.w1.prices.length,
    weapon2H: view.up.grids.w2.prices.length,
    amulet: view.up.grids.amulette.prices.length,
    ring: 1,
    traitsPerItem: {
      ...(upgrade.caps?.traitsPerItem || {}),
      arme: Math.max(0, Number(view.up.slots.arme) || 0),
      'Tête': Math.max(0, Number(armor['Tête']) || 0),
      'Torse': Math.max(0, Number(armor['Torse']) || 0),
      'Pieds': Math.max(0, Number(armor['Pieds']) || 0),
      'Amulette': Math.max(0, Number(view.up.slots.amulette) || 0),
      'Anneau': Math.max(0, Number(view.up.slots.anneau) || 0),
      'Objet magique': Math.max(0, Number(view.up.slots.objmag) || 0),
    },
  };
  upgrade.rarityCaps = clone(view.up.rcap);
  upgrade.reforge = {
    ...(upgrade.reforge || {}), enabled: !!view.reforge.on,
    materialPercent: clamp(view.reforge.pct, 0, 100),
    disciplineRoom: Object.fromEntries(ARTISAN_DISCIPLINES.map(d => [d.id, view.disc[d.id]?.room || ''])),
    roomLevelForRarity: clone(view.reforge.level),
    goldForRarity: clone(view.reforge.gold),
  };
  upgrade.refundUpgradeRatio = clamp(view.resale.pct, 0, 100) / 100;
  upgrade.pricing = {
    ...(upgrade.pricing || {}),
    '1H': { mode: view.up.grids.w1.mode, base: view.up.grids.w1.base, mult: view.up.grids.w1.mult },
    '2H': { mode: view.up.grids.w2.mode, base: view.up.grids.w2.base, mult: view.up.grids.w2.mult },
    amulet: { mode: view.up.grids.amulette.mode, base: view.up.grids.amulette.base, mult: view.up.grids.amulette.mult },
    ring: { mode: 'manuel', base: view.up.grids.anneau.prices[0] || 0, mult: 1 },
  };
  return { craft, upgrade };
}

export function flattenArtisan(value, prefix = '', out = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flattenArtisan(child, prefix ? `${prefix}.${key}` : key, out);
  } else if (Array.isArray(value)) value.forEach((child, index) => flattenArtisan(child, `${prefix}.${index}`, out));
  else out[prefix] = value;
  return out;
}

export function diffArtisanSettings(before, after) {
  const a = flattenArtisan(before), b = flattenArtisan(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter(path => JSON.stringify(a[path]) !== JSON.stringify(b[path]))
    .map(path => ({ path, from: a[path], to: b[path] }));
}
