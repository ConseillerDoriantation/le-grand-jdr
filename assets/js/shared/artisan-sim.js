// Calculs purs du simulateur des réglages d'artisanat.

import { craftDD, craftMaterialQty, craftRefundOnFail, craftRecycleQty } from './craft-engine.js';
import { scaleMaterials } from './reforge.js';
import { rarityCapFromTable } from './rarity-caps.js';
import { ARTISAN_CATEGORIES } from './artisan-settings-model.js';

const clampTier = value => Math.max(1, Math.min(3, parseInt(value, 10) || 1));
const po = value => `${Math.max(0, Math.round(Number(value) || 0)).toLocaleString('fr-FR')} PO`;
const stars = value => '★'.repeat(Math.max(1, parseInt(value, 10) || 1));
const sum = values => (values || []).reduce((total, value) => total + (Number(value) || 0), 0);
const recipeFor = (view, category, tier) => view.recipes?.[category]?.[clampTier(tier)] || {};

function gridFor(view, category, format) {
  const family = ARTISAN_CATEGORIES[category]?.fam;
  if (family === 'arme') return view.up.grids[format === 'w2' ? 'w2' : 'w1'];
  if (family === 'amulette') return view.up.grids.amulette;
  if (family === 'anneau') return view.up.grids.anneau;
  return null;
}

function familyCap(view, category, format) {
  const family = ARTISAN_CATEGORIES[category]?.fam || 'objmag';
  if (family === 'arme') return view.up.grids[format === 'w2' ? 'w2' : 'w1'].prices.length;
  if (family === 'amulette') return view.up.grids.amulette.prices.length;
  if (family === 'anneau') return 3; // 2 stats + effet pour un objet générique.
  return 0;
}

function traitFamilyCap(view, category) {
  const family = ARTISAN_CATEGORIES[category]?.fam || 'objmag';
  return Math.max(0, Number(view.up.slots[family]) || 0);
}

export function simulateArtisan(view, {
  category = 'armeCaC', format = 'w1', rarity = 1, materialNames = {}, maxRarity = 5,
} = {}) {
  const cat = ARTISAN_CATEGORIES[category];
  const family = cat?.fam || 'objmag';
  const r = Math.max(1, Math.min(maxRarity, parseInt(rarity, 10) || 1));
  const tier = clampTier(r);
  const recipe = recipeFor(view, category, tier);
  const craftCfg = {
    ...view.craft,
    ddParPalier: view.craft.dd,
    quantiteParPalier: view.craft.qty,
    refundFractionOnFail: view.craft.fail / 100,
    recycleFraction: view.dis.pct / 100,
  };
  const quantity = Math.max(1, parseInt(recipe.qty, 10) || craftMaterialQty(tier, craftCfg));
  const statFamily = familyCap(view, category, format);
  const statRarity = family === 'anneau' ? statFamily : rarityCapFromTable(view.up.rcap.stats, r);
  const statCount = Math.min(statFamily, statRarity);
  const traitFamily = traitFamilyCap(view, category);
  const traitRarity = rarityCapFromTable(view.up.rcap.traits, r);
  const traitCount = Math.min(traitFamily, traitRarity);
  const grid = gridFor(view, category, format);
  const statCost = family === 'anneau'
    ? statCount * (grid?.prices?.[0] || 0)
    : sum(grid?.prices?.slice(0, statCount));
  const traitCost = traitCount * (Number(view.up.traitAdd) || 0);
  const upgradeTotal = statCost + traitCost;
  const target = r < maxRarity ? r + 1 : null;
  const targetTier = clampTier(target || r);
  const targetRecipe = target ? recipeFor(view, category, targetTier) : {};
  const targetQty = Math.max(1, parseInt(targetRecipe.qty, 10) || craftMaterialQty(targetTier, craftCfg));
  const scaled = scaleMaterials([{ itemId: targetRecipe.mat || '', quantite: targetQty }], view.reforge.pct)[0];
  return {
    category, family, format, rarity: r, tier, noun: cat?.noun || 'un objet magique', feminine: !!cat?.fem,
    materialId: recipe.mat || '', materialName: materialNames[recipe.mat] || '', quantity,
    craftable: family !== 'objmag' && r <= view.craft.maxTier,
    discipline: view.cats?.[category] || '',
    skill: view.disc?.[view.cats?.[category]]?.skill || '',
    dd: craftDD(tier, craftCfg), failRefund: craftRefundOnFail(quantity, craftCfg),
    statCount, statCost, statLimitedByRarity: statRarity < statFamily,
    traitCount, traitCost, traitLimitedByRarity: traitRarity < traitFamily,
    upgradeTotal,
    reforge: {
      applicable: !!target && !!view.reforge.on && family !== 'objmag', target,
      room: view.disc?.[view.cats?.[category]]?.room || '',
      level: target ? Math.max(1, parseInt(view.reforge.level?.[target], 10) || 1) : null,
      gold: target ? Math.max(0, Number(view.reforge.gold?.[target]) || 0) : 0,
      materialId: targetRecipe.mat || '', materialName: materialNames[targetRecipe.mat] || '', quantity: scaled?.quantite || 0,
    },
    dismantle: {
      cost: Math.max(0, Number(view.dis.cost) || 0),
      quantity: family === 'objmag' ? 0 : craftRecycleQty(quantity, craftCfg),
      materialId: recipe.mat || '', materialName: materialNames[recipe.mat] || '',
      traits: view.dis.all ? 'tous ses traits' : 'un trait recyclable au choix',
    },
    resale: Math.round(upgradeTotal * Math.max(0, Math.min(100, Number(view.resale.pct) || 0)) / 100),
  };
}

const material = value => value || '<span class="acfg-missing">matériau non lié</span>';
const skill = value => value || '<span class="acfg-missing">compétence ?</span>';

export function craftSay(result) {
  if (!result.craftable) return `${result.noun[0].toUpperCase()}${result.noun.slice(1)} ${stars(result.rarity)} : non fabricable directement.`;
  return `${result.noun[0].toUpperCase()}${result.noun.slice(1)} ${stars(result.rarity)} : d20 + <b>${skill(result.skill)}</b> contre DD <b>${result.dd}</b>, puis <b>${result.quantity} × ${material(result.materialName)}</b>.`;
}
export function failSay(result) {
  return `En cas d'échec, <b>${result.failRefund}</b> matériau${result.failRefund > 1 ? 'x' : ''} sur ${result.quantity} ${result.failRefund ? 'sont rendus' : 'est perdu'}.`;
}
export function refSay(result) {
  if (!result.reforge.applicable) return `La reforge est indisponible pour cet objet.`;
  return `Vers ${stars(result.reforge.target)} : salle <b>${result.reforge.room || '<span class="acfg-missing">aucune salle</span>'}</b> niveau <b>${result.reforge.level}</b>, <b>${po(result.reforge.gold)}</b> et <b>${result.reforge.quantity} × ${material(result.reforge.materialName)}</b>.`;
}
export function disSay(result) {
  return `Démonter ${result.noun} coûte <b>${po(result.dismantle.cost)}</b>, rend <b>${result.dismantle.quantity} × ${material(result.dismantle.materialName)}</b> et ${result.dismantle.traits}.`;
}
export function resSay(result) {
  return result.upgradeTotal
    ? `<b>${po(result.upgradeTotal)}</b> d'améliorations donnent <b>+${po(result.resale)}</b> à la revente.`
    : `Cet objet ne porte aucune amélioration tarifée.`;
}
