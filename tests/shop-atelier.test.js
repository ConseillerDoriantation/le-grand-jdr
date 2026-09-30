import test from 'node:test';
import assert from 'node:assert/strict';

import {
  atelierApplyBuild,
  atelierCompactSlots,
  atelierGainScore,
  atelierNetCost,
} from '../assets/js/shared/shop-atelier.js';

test('atelier: un build est stocké comme différence de l’équipement réel', () => {
  const equipped = { Tête: 'h1', Torse: 't1', Anneau: null };
  assert.deepEqual(
    atelierCompactSlots(equipped, { Tête: 'h1', Torse: 't2', Anneau: null, Bottes: 'b1' }),
    { Torse: 't2', Bottes: 'b1' },
  );
});

test('atelier: une arme à deux mains libère la main secondaire', () => {
  const loadout = atelierApplyBuild(
    { 'Main principale': 'w1', 'Main secondaire': 'shield' },
    { 'Main principale': 'greatsword' },
    { isTwoHanded: id => id === 'greatsword' },
  );
  assert.equal(loadout['Main secondaire'], null);
});

test('atelier: le score de gain respecte les pondérations du handoff', () => {
  assert.equal(atelierGainScore([
    { key: 'ca', delta: 1 },
    { key: 'pv', delta: 4 },
    { key: 'stat:dexterite', delta: 2 },
    { key: 'degats', delta: -1 },
  ]), 3.6);
});

test('atelier: le coût net applique la reprise seulement si demandée', () => {
  assert.deepEqual(atelierNetCost({ purchase: 100, resaleCredit: 35, resale: true }), { gross: 100, credit: 35, net: 65 });
  assert.deepEqual(atelierNetCost({ purchase: 100, resaleCredit: 35, resale: false }), { gross: 100, credit: 0, net: 100 });
});
