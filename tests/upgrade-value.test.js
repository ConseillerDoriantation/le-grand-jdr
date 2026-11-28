import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  getItemFragmentCategory,
  upgradeResaleBonus,
  upgradeTariffValue,
} from '../assets/js/shared/upgrade-value.js';
import { statPointUse } from '../assets/js/shared/artisan-logic.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

// Grilles par défaut de world/upgrade_settings (DEFAULT_UPGRADE_SETTINGS) + reprise à 20 %.
const settings = (patch = {}) => ({
  trait: { addTraitFromFragment: 100, overwriteTrait: 200 },
  weapon: { '1H': { 1: 150, 2: 300 }, '2H': { 1: 250, 2: 500, 3: 800, 4: 1200 } },
  amulet: { 1: 200, 2: 400, 3: 800 },
  ring: { 1: 250, 2: 450, 3: 700, 4: 1000, 5: 1400 },
  refundUpgradeRatio: 0.2,
  ...patch,
});
// Anneau à 2 stats natives (For +1, Dex +1) : son budget commence au 3ᵉ point.
const ring = (upgrades, natives = { fo: 1, dex: 1 }) => ({ nom: 'Anneau de force', slotBijou: 'Anneau', statBonuses: natives, upgrades });

test('anneau : chaque +1 coûte le point SUIVANT du budget, stats natives comprises (comme l’Atelier)', () => {
  // 2 natives → 1ʳᵉ amélioration = palier 3 (700), 2ᵉ = palier 4 (1000), quelle que soit la stat.
  assert.equal(upgradeTariffValue(ring({ statBonus: { fo: 1 } }), settings()), 700);
  assert.equal(upgradeTariffValue(ring({ statBonus: { fo: 2 } }), settings()), 1700);
  assert.equal(upgradeTariffValue(ring({ statBonus: { fo: 1, dex: 1 } }), settings()), 1700);
  // 1 native (INT +1) → paliers 2 puis 3.
  assert.equal(upgradeTariffValue(ring({ statBonus: { in: 2 } }, { in: 1 }), settings()), 1150);
  // Sans stat native → paliers 1 puis 2.
  assert.equal(upgradeTariffValue(ring({ statBonus: { in: 2 } }, {}), settings()), 700);
  assert.equal(upgradeResaleBonus(ring({ statBonus: { in: 2 } }, {}), settings()), 140);
});

test('anneau : valeur = somme exacte de ce que l’Atelier facture, point par point', () => {
  // Rejoue _artisanRingAddStat : coût du +1 = ring[statPointUse(item) + 1].
  const s = settings();
  let item = ring({ statBonus: {} }, { in: 1 });
  let paid = 0;
  for (const stat of ['in', 'in', 'sa', 'in']) {
    paid += s.ring[statPointUse(item) + 1] || 0;
    const bonus = { ...item.upgrades.statBonus, [stat]: (item.upgrades.statBonus[stat] || 0) + 1 };
    item = { ...item, upgrades: { ...item.upgrades, statBonus: bonus } };
    assert.equal(upgradeTariffValue(item, s), paid);
  }
});

test('anneau : palier absent de la grille = 0 (comme l’Atelier)', () => {
  assert.equal(upgradeTariffValue(ring({ statBonus: { fo: 1 } }), settings({ ring: { 1: 250 } })), 0);
});

test('la reprise suit les réglages du MJ (tarif et %), rien en dur', () => {
  const item = ring({ statBonus: { in: 2 } }, {}); // paliers 1 + 2 = 700
  assert.equal(upgradeResaleBonus(item, settings({ ring: { 1: 300, 2: 500 } })), 160);
  assert.equal(upgradeResaleBonus(item, settings({ refundUpgradeRatio: 0.35 })), 245);
  assert.equal(upgradeResaleBonus(item, settings({ refundUpgradeRatio: 0 })), 0);
  assert.equal(upgradeResaleBonus(item, settings({ refundUpgradeRatio: 1.5 })), 700, '% borné à 100');
});

test('ancien effet amélioré : ses propres paliers, en plus des points de stats', () => {
  assert.equal(upgradeTariffValue(ring({ statBonus: {}, effectBonus: 1 }), settings()), 250);
  assert.equal(upgradeTariffValue(ring({ statBonus: { in: 1 }, effectBonus: 1 }, {}), settings()), 500);
});

test('prix des PO loggées ignoré : mode MJ gratuit ou ancien tarif', () => {
  const item = ring({
    statBonus: { in: 2 },
    history: [
      { op: 'ring_upgrade_stat', level: 1, cost: 0, mjOverride: true },
      { op: 'ring_upgrade_stat', level: 2, cost: 180 },
    ],
  }, {});
  assert.equal(upgradeResaleBonus(item, settings()), 140);
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
  // Slots personnalisés / config par défaut : forgeables, catégorie = nom du slot.
  assert.equal(getItemFragmentCategory({ slotArmure: 'Armure' }), 'Armure');
  assert.equal(getItemFragmentCategory({ template: 'armure' }), 'armure', 'armure sans slot → repli sûr');
  assert.equal(getItemFragmentCategory({ slotBijou: 'Objet harmonisé' }), 'Objet harmonisé');
  // Garde anti-pollution : une clé dangereuse retombe sur une clé SÛRE, jamais la clé brute.
  assert.equal(getItemFragmentCategory({ slotBijou: 'constructor' }), 'Objet magique', 'bijou à clé dangereuse → repli sûr, jamais la clé brute');
  assert.equal(getItemFragmentCategory({ slotArmure: '__proto__' }), 'armure', 'armure à clé dangereuse → repli armure, jamais la clé brute');
  // Objets définis par leurs seules données (sans template ni slot) : forgeables.
  assert.equal(getItemFragmentCategory({ degats: '1d8' }), 'arme', 'arme définie par degats');
  assert.equal(getItemFragmentCategory({ ca: 2 }), 'armure', 'armure définie par CA');
  assert.equal(getItemFragmentCategory({ typeArmure: 'Légère' }), 'armure', 'armure définie par typeArmure');
  assert.equal(getItemFragmentCategory({ template: 'bijou' }), 'Objet magique', 'bijou sans slot → accessoire générique');
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
