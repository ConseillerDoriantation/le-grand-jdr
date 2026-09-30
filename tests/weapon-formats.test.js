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

test('nature magique : une famille physique frappe en magie, éléments au choix du porteur', () => {
  // Même famille physique (« blade »/Lance), mais l'arme est déclarée magique.
  const result = resolveWeaponDamageContext(
    formats,
    damageTypes,
    { format: 'Arme physique', nature: 'magique' },
    ['froid'],
  );

  assert.equal(result.format?.id, 'blade');   // la famille (donc la maîtrise) est conservée
  assert.equal(result.isMagic, true);
  assert.equal(result.damageTypeId, 'froid'); // affinité du porteur en tête
  assert.deepEqual(result.elementIds, ['froid', 'feu']); // aucun élément figé
});

test('nature physique : prime sur une famille magique et ne garde aucun élément', () => {
  const result = resolveWeaponDamageContext(
    formats,
    damageTypes,
    { format: 'Focaliseur magique', nature: 'physique' },
  );

  assert.equal(result.isMagic, false);
  assert.equal(result.damageTypeId, 'physique');
  assert.deepEqual(result.elementIds, []);
});

test('nature physique : un élément magique résiduel sur l arme est ignoré', () => {
  const result = resolveWeaponDamageContext(
    formats,
    damageTypes,
    { format: 'Arme physique', nature: 'physique', damageTypeId: 'feu' },
  );

  assert.equal(result.isMagic, false);
  assert.equal(result.damageTypeId, 'physique');
});

test('sans nature : compat ascendante inchangée (famille magique)', () => {
  const result = resolveWeaponDamageContext(formats, damageTypes, { formatId: 'focus' });

  assert.equal(result.isMagic, true);
  assert.deepEqual(result.elementIds, ['feu', 'froid']);
});
