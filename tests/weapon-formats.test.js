import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveWeaponDamageContext } from '../assets/js/shared/weapon-damage-context.js';

const formats = [
  { id: 'blade', label: 'Arme physique', damageType: 'tranchant', isMagic: false },
  { id: 'focus', label: 'Focaliseur magique', damageType: '', isMagic: true },
];
const damageTypes = [
  { id: 'physique', isMagic: false },
  { id: 'tranchant', isMagic: false },
  { id: 'feu', isMagic: true },
  { id: 'froid', isMagic: true },
];

test('un format physique reprend son type de dégâts configuré', () => {
  const result = resolveWeaponDamageContext(formats, damageTypes, { format: 'Arme physique' });

  assert.equal(result.format?.id, 'blade');
  assert.equal(result.isMagic, false);
  assert.equal(result.damageTypeId, 'tranchant');
  assert.deepEqual(result.elementIds, []);
});

test('un PNJ équipé d un focaliseur peut choisir tous les types magiques', () => {
  const result = resolveWeaponDamageContext(formats, damageTypes, { formatId: 'focus' });

  assert.equal(result.isMagic, true);
  assert.equal(result.damageTypeId, 'feu');
  assert.deepEqual(result.elementIds, ['feu', 'froid']);
});

test('un élément imposé par l arme reste le choix par défaut', () => {
  const result = resolveWeaponDamageContext(
    formats,
    damageTypes,
    { format: 'Focaliseur magique', damageTypeId: 'froid' },
    ['feu'],
  );

  assert.equal(result.damageTypeId, 'froid');
  assert.deepEqual(result.elementIds, ['froid', 'feu']);
});
