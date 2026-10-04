import test from 'node:test';
import assert from 'node:assert/strict';

import { shopAffinityScore, shopCartTotals, shopItemBuyState, shopUpgradeGain } from '../assets/js/shared/shop-cart.js';

test('_itemBuyState compare le prix au solde restant après panier', () => {
  const state = shopItemBuyState({ prix: 30, dispo: 2 }, { char: { id: 'c1' }, gold: 100, remaining: 18 });
  assert.equal(state.tropCher, true);
  assert.equal(state.manque, 12);
  assert.equal(state.dispo, 2);
});

test('le panier déduit les achats et crédite les reprises', () => {
  assert.deepEqual(
    shopCartTotals(100, [{ price: 40, qty: 2 }, { price: 10, qty: 1 }], [{ credit: 25 }]),
    { articles: 90, reprises: 25, total: 65, remaining: 35, count: 3 },
  );
});

test('le gain pondère à moitié la moyenne supplémentaire des dégâts', () => {
  assert.equal(shopUpgradeGain([{ d: 2, dice: true }, { d: 1 }, { d: -1 }]), 1);
});

test('une dague physique cohérente surclasse une arme magique hors profil', () => {
  const profile = {
    dominantStats: ['dexterite', 'constitution'],
    weaponFamilies: ['dague'],
    weaponNatures: ['physique'],
    weaponHands: ['1 main'],
  };
  const dagger = shopAffinityScore({
    kind: 'weapon', weaponFamily: 'dague', weaponNature: 'physique', weaponHands: '1 main',
    attackStat: 'dexterite', statBonuses: { dexterite: 1 },
  }, profile);
  const magicSword = shopAffinityScore({
    kind: 'weapon', weaponFamily: 'epee', weaponNature: 'magique', weaponHands: '1 main',
    attackStat: 'intelligence', statBonuses: { intelligence: 2 },
  }, profile);
  assert.ok(dagger > magicSword);
});

test('une armure du type déjà porté est favorisée', () => {
  const profile = { dominantStats: ['force'], armorType: 'lourde', armorBySlot: { Tête: 'lourde' } };
  const sameSet = shopAffinityScore({ kind: 'armor', slot: 'Tête', armorType: 'lourde', statBonuses: {} }, profile);
  const otherSet = shopAffinityScore({ kind: 'armor', slot: 'Tête', armorType: 'legere', statBonuses: {} }, profile);
  assert.ok(sameSet > otherSet);
});
