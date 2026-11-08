import test from 'node:test';
import assert from 'node:assert/strict';

import {
  traitCapAt, statCapAt, unlockRarity, firstGainRarity,
  ringTracks, statPointUse, possibleActions, isMaxed, dismantlePreview,
} from '../assets/js/shared/artisan-logic.js';
import { craftCategoryForItem } from '../assets/js/shared/craft-engine.js';

const DEFAULT_UPGRADE_SETTINGS = {
  trait: { deconstructCost: 0, addTraitFromFragment: 100, overwriteTrait: 200 },
  weapon: { '1H': { 1: 150, 2: 300 }, '2H': { 1: 250, 2: 500, 3: 800, 4: 1200 } },
  amulet: { 1: 200, 2: 400, 3: 800 }, ring: { 1: 250 },
  caps: { weapon1H: 2, weapon2H: 4, amulet: 3, ring: 1,
    traitsPerItem: { arme: 2, Tête: 1, Torse: 1, Pieds: 1, Amulette: 1, Anneau: 1, 'Objet magique': 1 } },
  rarityCaps: { traits: { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3 }, stats: { 1: 0, 2: 2, 3: 3, 4: 4, 5: 4 } },
};
const settings = {
  ...DEFAULT_UPGRADE_SETTINGS,
  caps: { ...DEFAULT_UPGRADE_SETTINGS.caps, weapon1H: 2, weapon2H: 4, amulet: 3, ring: 1,
    traitsPerItem: { ...DEFAULT_UPGRADE_SETTINGS.caps.traitsPerItem, arme: 4 } },
  rarityCaps: { traits: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 4 }, stats: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 4 } },
};
const sword = rarete => ({ template: 'arme', format: 'Arme 1M CaC Phy.', rarete, traits: ['Tranchant'] });

test('plafonds = minimum famille / rareté et rareté de déblocage', () => {
  assert.equal(traitCapAt(sword(2), 2, settings), 2);
  assert.equal(statCapAt(sword(5), 5, settings), 2, 'une arme 1M reste bornée par sa famille');
  assert.equal(unlockRarity(sword(1), 'traits', 3, settings), 3);
});

test('firstGainRarity ignore les raretés qui ne donnent aucun budget', () => {
  assert.equal(firstGainRarity(sword(1), settings), 2);
  assert.equal(firstGainRarity(sword(4), settings), null);
});

test('anneau : pistes indépendantes, effet seulement avec bonus dérivé positif', () => {
  const base = { slotBijou: 'Anneau', rarete: 1, for: 1, dex: 2 };
  assert.deepEqual(ringTracks(base, settings).map(track => track.id), ['force', 'dexterite']);
  assert.deepEqual(ringTracks({ ...base, pvMaxBonus: 2 }, settings).map(track => track.id), ['force', 'dexterite', 'effect']);
  assert.equal(statCapAt(base, 1, settings), 1, 'le cap des pistes d’anneau ne dépend pas de la rareté');
});

test('actions possibles respectent fragments, or, mode MJ et gain de reforge', () => {
  const char = { traitFragments: { arme: { Froid: 1 } } };
  const item = sword(1);
  assert.equal(possibleActions(char, item, { upgrade: settings, gold: 0, reforgeEval: { ok: true } }).addTrait, false);
  const rich = possibleActions(char, item, { upgrade: settings, gold: 1000, reforgeEval: { ok: true } });
  assert.equal(rich.addTrait, false, 'le seul slot 1★ est déjà occupé');
  assert.equal(rich.stat, true);
  assert.equal(rich.reforge, true);
  assert.equal(possibleActions(char, item, { upgrade: settings, gold: 0, freeMode: true }).stat, true);
});

test('les statistiques natives consomment déjà le potentiel de l objet', () => {
  const char = { traitFragments: {} };
  const oneNativePoint = { ...sword(3), for: 1 };
  const fullAtAcquisition = { ...sword(3), for: 1, dex: 1 };
  const mixed = { ...sword(3), for: 1, upgrades: { statBonus: { dex: 1 } } };

  assert.equal(statPointUse(oneNativePoint), 1);
  assert.equal(possibleActions(char, oneNativePoint, { upgrade: settings, gold: 9999 }).stat, true);
  assert.equal(statPointUse(fullAtAcquisition), 2);
  assert.equal(possibleActions(char, fullAtAcquisition, { upgrade: settings, gold: 9999, freeMode: true }).stat, false);
  assert.equal(statPointUse(mixed), 2);
  assert.equal(possibleActions(char, mixed, { upgrade: settings, gold: 9999 }).stat, false);
  assert.equal(statPointUse({ slotBijou: 'Anneau', for: 2 }), 0, 'les anneaux gardent leurs pistes indépendantes');
});

test('isMaxed tient compte du prochain gain de rareté', () => {
  const item = { ...sword(4), upgrades: { statBonus: { for: 2 }, addedTraits: ['A', 'B', 'C'] } };
  assert.equal(isMaxed({}, item, { upgrade: settings, gold: 0 }), true);
});

test('aperçu démontage sépare récupérable / perdu et borne la recette au palier 3', () => {
  const item = { ...sword(5), traits: ['Tranchant', 'Signature'], nonRecyclableTraits: ['Signature'] };
  const craft = { recycleFraction: 0.5, quantiteParPalier: { 3: 8 }, recipes: { armeCaC: { 3: { itemId: 'fer', quantite: 8 } } } };
  const preview = dismantlePreview(item, settings, craft);
  assert.equal(preview.tier, 3);
  assert.deepEqual(preview.recoveredTraits, ['Tranchant']);
  assert.deepEqual(preview.lostTraits, ['Signature']);
  assert.deepEqual(preview.materials, [{ itemId: 'fer', quantite: 4 }]);
});

test('Objet magique ne réutilise pas la recette des anneaux', () => {
  assert.equal(craftCategoryForItem({ slotBijou: 'Objet magique' }), null);
});
