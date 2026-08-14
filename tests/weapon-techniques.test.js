import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeWeaponTechnique,
  weaponTechniqueTargetCA,
  weaponTechniqueDamageTerms,
} from '../assets/js/shared/weapon-techniques.js';

test('Point faible augmente la CA sans modifier la CA de base', () => {
  const technique = normalizeWeaponTechnique({ label: 'Point faible', defenseBonus: 4 });
  assert.equal(weaponTechniqueTargetCA(15, technique), 19);
  assert.equal(weaponTechniqueTargetCA(15, null), 15);
});

test('un dé d’arme bonus reprend les faces de la formule équipée', () => {
  const technique = normalizeWeaponTechnique({ label: 'Point faible', extraWeaponDice: 1 });
  assert.deepEqual(weaponTechniqueDamageTerms(technique, '2d8+4'), [
    { kind: 'weapon', formula: '1d8' },
  ]);
});

test('une technique peut cumuler dés d’arme, formule dédiée et dégâts plats', () => {
  const technique = normalizeWeaponTechnique({
    label: 'Impact précis', extraWeaponDice: 2, extraDamageFormula: '1d4+1', extraDamageFlat: 3,
  });
  assert.deepEqual(weaponTechniqueDamageTerms(technique, '1d10'), [
    { kind: 'weapon', formula: '2d10' },
    { kind: 'formula', formula: '1d4+1' },
    { kind: 'flat', flat: 3 },
  ]);
});

test('les valeurs de technique sont bornées avant stockage et calcul', () => {
  const technique = normalizeWeaponTechnique({
    label: '  Test  ', defenseBonus: 999, extraWeaponDice: -2, extraDamageFlat: -5,
  });
  assert.equal(technique.label, 'Test');
  assert.equal(technique.defenseBonus, 30);
  assert.equal(technique.extraWeaponDice, 0);
  assert.equal(technique.extraDamageFlat, 0);
});
