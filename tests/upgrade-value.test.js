import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  getItemFragmentCategory,
  upgradeResaleBonus,
  upgradeTariffValue,
} from '../assets/js/shared/upgrade-value.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

// Grilles par défaut de world/upgrade_settings (DEFAULT_UPGRADE_SETTINGS) + reprise à 20 %.
const settings = (patch = {}) => ({
  trait: { addTraitFromFragment: 100, overwriteTrait: 200 },
  weapon: { '1H': { 1: 150, 2: 300 }, '2H': { 1: 250, 2: 500, 3: 800, 4: 1200 } },
  amulet: { 1: 200, 2: 400, 3: 800 },
  ring: { 1: 250 },
  refundUpgradeRatio: 0.2,
  ...patch,
});
const ring = upgrades => ({ nom: 'Anneau de force', slotBijou: 'Anneau', for: 1, dex: 1, upgrades });

test('anneau amélioré 2 fois : 20 % de 2 × 250 PO = +100 or', () => {
  const statAndEffect = ring({ statBonus: { for: 1 }, effectBonus: 1 });
  const twoStats = ring({ statBonus: { for: 1, dex: 1 } });
  for (const item of [statAndEffect, twoStats]) {
    assert.equal(upgradeTariffValue(item, settings()), 500);
    assert.equal(upgradeResaleBonus(item, settings()), 100);
  }
});

test('la reprise suit les réglages du MJ (tarif et %), rien en dur', () => {
  const item = ring({ statBonus: { for: 1 }, effectBonus: 1 });
  assert.equal(upgradeResaleBonus(item, settings({ ring: { 1: 300 } })), 120);
  assert.equal(upgradeResaleBonus(item, settings({ refundUpgradeRatio: 0.35 })), 175);
  assert.equal(upgradeResaleBonus(item, settings({ refundUpgradeRatio: 0 })), 0);
  assert.equal(upgradeResaleBonus(item, settings({ refundUpgradeRatio: 1.5 })), 500, '% borné à 100');
});

test('prix des PO loggées ignoré : mode MJ gratuit ou ancien tarif', () => {
  const item = ring({
    statBonus: { for: 1 },
    effectBonus: 1,
    history: [
      { op: 'ring_upgrade_stat', level: 1, cost: 0, mjOverride: true },
      { op: 'ring_upgrade_effect', level: 1, cost: 180 },
    ],
  });
  assert.equal(upgradeResaleBonus(item, settings()), 100);
});

test('amulette : la n-ième stat distincte coûte le n-ième palier', () => {
  const item = { slotBijou: 'Amulette', upgrades: { statBonus: { for: 1, sag: 1 } } };
  assert.equal(upgradeTariffValue(item, settings()), 600);
  assert.equal(upgradeResaleBonus(item, settings()), 120);
});

test('arme : points cumulés sur la grille 1M ou 2M', () => {
  const oneHand = { template: 'arme', format: 'Arme 1M CaC Phy.', upgrades: { statBonus: { for: 2 } } };
  const twoHands = { template: 'arme', mains: 2, upgrades: { statBonus: { for: 2, dex: 1 } } };
  assert.equal(upgradeTariffValue(oneHand, settings()), 450);
  assert.equal(upgradeTariffValue(twoHands, settings()), 1550);
});

test('traits : trait de base remplacé = écrasement, autre trait posé = ajout', () => {
  const item = {
    slotArmure: 'Torse',
    upgrades: { addedTraits: ['Robuste', 'Vif'], removedBaseTraits: ['Lourd'], statBonus: { for: 1 } },
  };
  // Torse : pas de stats améliorables → seuls les traits comptent.
  assert.equal(upgradeTariffValue(item, settings()), 300);
  assert.equal(upgradeResaleBonus(item, settings()), 60);
});

test('objet sans amélioration ou non améliorable : aucune reprise', () => {
  assert.equal(upgradeResaleBonus({ nom: 'Potion' }, settings()), 0);
  assert.equal(upgradeResaleBonus(ring({ statBonus: {}, effectBonus: 0 }), settings()), 0);
  assert.equal(upgradeResaleBonus(null, settings()), 0);
  assert.equal(upgradeResaleBonus(ring({ statBonus: { for: 1 } }), null), 0);
});

test('catégorie : armes par template/format, bijoux et armures par emplacement', () => {
  assert.equal(getItemFragmentCategory({ template: 'Arme' }), 'arme');
  assert.equal(getItemFragmentCategory({ format: 'Bouclier' }), 'arme');
  assert.equal(getItemFragmentCategory({ slotBijou: 'Anneau' }), 'Anneau');
  assert.equal(getItemFragmentCategory({ slotArmure: 'Tête' }), 'Tête');
  assert.equal(getItemFragmentCategory({ slotBijou: 'constructor' }), null);
  assert.equal(getItemFragmentCategory({ nom: 'Potion' }), null);
});

test('toutes les ventes ajoutent la reprise des améliorations', () => {
  const inventory = read('assets/js/features/characters/inventory.js');
  const shop = read('assets/js/features/shop.js');
  const artisan = read('assets/js/features/artisan.js');
  // Inventaire : la fiche, la modale (tarifs chargés) et la vente effective.
  assert.match(inventory, /const _ivResale = item => getInventoryItemResaleValue\(item, _ivCatalog\(item\)\) \+ upgradeResaleBonus\(/);
  assert.match(inventory, /const settings = upgradedCount \? await loadUpgradeSettings\(\)/);
  assert.match(inventory, /s \+ upgradeResaleBonus\(inv\[idx\], settings\)/);
  // Boutique : reprises du panier, atelier et vente directe lisent prixVente via _resaleCredit seulement.
  assert.deepEqual(shop.match(/parseFloat\([^)]*prixVente\)/g), ['parseFloat(invItem?.prixVente)']);
  assert.equal((shop.match(/_resaleCredit\(/g) || []).length, 6);
  // L'Artisan et la revente partagent la même détection de catégorie.
  assert.match(artisan, /import \{ FRAGMENT_CATEGORIES, getItemFragmentCategory \} from '\.\.\/shared\/upgrade-value\.js'/);
  assert.doesNotMatch(artisan, /function getItemFragmentCategory/);
});
