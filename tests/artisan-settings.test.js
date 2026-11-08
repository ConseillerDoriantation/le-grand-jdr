import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeArtisanSettings, splitArtisanSettings, diffArtisanSettings } from '../assets/js/shared/artisan-settings-model.js';
import { applyEconomyPreset } from '../assets/js/shared/artisan-presets.js';
import { simulateArtisan } from '../assets/js/shared/artisan-sim.js';
import fs from 'node:fs';

const source = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('artisanat : fusion puis découpe conservent les deux documents et les conversions', () => {
  const craft = {
    custom: 'préservé', maxTier: 2, refundFractionOnFail: .25, recycleFraction: .75,
    recipes: { armeCaC: { 1: { itemId: 'fer1', quantite: 7 } } },
  };
  const upgrade = {
    custom: 'préservé', refundUpgradeRatio: .4,
    trait: { deconstructCost: 30, extractAllTraits: true },
    caps: { weapon1H: 3, traitsPerItem: { 'Tête': 1, 'Torse': 2, 'Pieds': 3 } },
    weapon: { '1H': { 1: 100, 2: 220, 3: 360 } },
  };
  const merged = mergeArtisanSettings(craft, upgrade);
  assert.equal(merged.craft.fail, 25);
  assert.equal(merged.dis.pct, 75);
  assert.equal(merged.resale.pct, 40);
  assert.equal(merged.up.slots.armure, 3);
  assert.equal(merged.up.armorMismatch, true);
  const split = splitArtisanSettings(merged, craft, upgrade);
  assert.equal(split.craft.custom, 'préservé');
  assert.equal(split.upgrade.custom, 'préservé');
  assert.equal(split.craft.refundFractionOnFail, .25);
  assert.equal(split.craft.recycleFraction, .75);
  assert.equal(split.upgrade.refundUpgradeRatio, .4);
  assert.deepEqual(split.craft.recipes.armeCaC[1], { itemId: 'fer1', quantite: 7 });
  assert.deepEqual(split.upgrade.caps.traitsPerItem, { 'Tête': 1, 'Torse': 2, 'Pieds': 3, arme: 2, 'Amulette': 1, 'Anneau': 1, 'Objet magique': 1 });
});

test('artisanat : le plafond charge, complète ou tronque la grille et suit le nombre de cases', () => {
  const expanded = mergeArtisanSettings({}, { caps: { weapon1H: 4 }, weapon: { '1H': { 1: 100, 2: 200 } } });
  assert.deepEqual(expanded.up.grids.w1.prices, [100, 200, 300, 400]);
  expanded.up.grids.w1.prices.splice(2);
  const split = splitArtisanSettings(expanded);
  assert.equal(split.upgrade.caps.weapon1H, 2);
  assert.deepEqual(split.upgrade.weapon['1H'], { 1: 100, 2: 200 });
  const truncated = mergeArtisanSettings({}, { caps: { weapon2H: 2 }, weapon: { '2H': { 1: 10, 2: 20, 3: 30 } } });
  assert.deepEqual(truncated.up.grids.w2.prices, [10, 20]);
});

test('artisanat : un preset ne touche ni recettes, ni disciplines, ni plafonds', () => {
  const merged = mergeArtisanSettings({ recipes: { armeCaC: { 1: { itemId: 'fer' } } } }, {});
  const before = structuredClone(merged);
  const rare = applyEconomyPreset(merged, 'rare');
  assert.deepEqual(rare.recipes, before.recipes);
  assert.deepEqual(rare.disc, before.disc);
  assert.deepEqual(rare.cats, before.cats);
  assert.deepEqual(rare.up.slots, before.up.slots);
  assert.deepEqual(rare.up.rcap, before.up.rcap);
  assert.equal(rare.craft.dd[1], before.craft.dd[1] + 2);
  assert.equal(rare.dis.pct, 25);
  assert.notEqual(rare.up.traitAdd, before.up.traitAdd);
});

test('artisanat : simulateur applique minimum des plafonds et arrondis métier', () => {
  const merged = mergeArtisanSettings({
    maxTier: 2, refundFractionOnFail: .5, recycleFraction: .5,
    recipes: { armeCaC: { 3: { itemId: 'fer3', quantite: 15 } } },
  }, { reforge: { materialPercent: 50 }, caps: { weapon2H: 4 } });
  merged.up.rcap.stats[3] = 2;
  const sim = simulateArtisan(merged, { category: 'armeCaC', format: 'w2', rarity: 3, materialNames: { fer3: 'Minerai ★★★' } });
  assert.equal(sim.craftable, false, 'au-delà de maxTier');
  assert.equal(sim.statCount, 2, 'minimum plafond famille/rareté');
  assert.equal(sim.failRefund, 7, 'échec arrondi inférieur');
  assert.equal(sim.dismantle.quantity, 7, 'démontage arrondi inférieur');
  assert.equal(sim.reforge.quantity, 8, 'reforge arrondie au plus proche');
  const magic = simulateArtisan(merged, { category: 'objmag', rarity: 5 });
  assert.equal(magic.craftable, false);
  assert.equal(magic.dismantle.quantity, 0);
});

test('artisanat : le diff expose chaque chemin modifié', () => {
  const before = mergeArtisanSettings({}, {});
  const after = structuredClone(before);
  after.craft.dd[2] = 19;
  after.up.grids.w1.prices[0] = 175;
  const paths = diffArtisanSettings(before, after).map(entry => entry.path);
  assert.deepEqual(paths.sort(), ['craft.dd.2', 'up.grids.w1.prices.0']);
});

test('artisanat : la Boutique expose une seule entrée et les anciens appels deviennent des alias', () => {
  const shop = source('../assets/js/features/shop.js');
  const craft = source('../assets/js/shared/craft-settings.js');
  const upgrade = source('../assets/js/shared/upgrade-settings.js');
  assert.match(shop, /openArtisanStg[\s\S]*⚒️ Artisanat/);
  assert.doesNotMatch(shop, /openUpgradeStg:/);
  assert.doesNotMatch(shop, /openCraftStg:/);
  assert.match(craft, /openArtisanSettings\('fabriquer'\)/);
  assert.match(upgrade, /openArtisanSettings\('ameliorer'\)/);
});

test('artisanat : la modale enregistre ensemble, protège les changements et persiste le simulateur', () => {
  const settings = source('../assets/js/shared/artisan-settings.js');
  assert.match(settings, /Promise\.all\(\[saveCraftSettings\(craft\), saveUpgradeSettings\(upgrade\)\]\)/);
  assert.match(settings, /setModalCloseGuard\(closeGuard\)/);
  assert.match(settings, /artisan\.settings\.\$\{STATE\.adventure\?\.id/);
  for (const tab of ['bases', 'fabriquer', 'ameliorer', 'reforger', 'demonter']) assert.match(settings, new RegExp(`id: '${tab}'`));
});

test('artisanat : le démontage réel partage matériaux, coût et règle des traits', () => {
  const artisan = source('../assets/js/features/artisan.js');
  const vtt = source('../assets/js/features/vtt/vtt-mini-fiche.js');
  assert.match(artisan, /craftRecycleQty\(requirement\.quantite, craftCfg\)/);
  assert.match(artisan, /inv\.concat\(returned\)/);
  assert.match(artisan, /op\.trait \? \[op\.trait\] : \[\]/);
  assert.match(vtt, /upgradeCfg\.trait\?\.deconstructCost/);
  assert.match(vtt, /Quel trait veux-tu récupérer/);
  assert.match(vtt, /traits = \[itemTraits\[selectedIndex\]\]/);
  assert.doesNotMatch(vtt, /const traits = upgradeCfg\.trait\?\.extractAllTraits \? itemTraits : itemTraits\.slice\(0, 1\)/);
  assert.match(vtt, /compte: c\.compte/);
});
