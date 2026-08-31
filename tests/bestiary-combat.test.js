import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  naturalWeaponCombatContext,
  naturalWeaponDamageFormula,
} from '../assets/js/shared/bestiary-combat.js';

test('une arme naturelle conserve son bonus fixe de dégâts', () => {
  assert.equal(naturalWeaponDamageFormula({ degats: '2d6', degatsFlat: 4 }), '2d6 +4');
  assert.equal(naturalWeaponDamageFormula({ degats: '2d6+4', degatsFlat: 4 }), '2d6+4');
});

test('le toucher total de l’arme naturelle ne retombe pas sur le +5 du token', () => {
  const ctx = naturalWeaponCombatContext({
    degats: '2d6',
    degatsStat: 'force',
    toucherStat: 'none',
    toucherFlat: 10,
  }, () => 5);

  assert.equal(ctx.touchStatMod, 0);
  assert.equal(ctx.touchFlat, 10);
  assert.equal(ctx.touchTotal, 10);
});
