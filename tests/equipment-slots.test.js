import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_EQUIPMENT_SLOTS,
  LEGACY_EQUIPMENT_SLOTS,
  equipmentSlotAcceptsItem,
  getAllEquipmentSlots,
  getArmorSetSlotIds,
  getArmorTorsoSlotId,
  getEquipmentItemOptions,
  getPrimaryWeaponSlotId,
  resolveEquipmentSlotForItem,
  setEquipmentSlotsForTests,
} from '../assets/js/shared/equipment-slots.js';

test('legacy preset keeps every existing Le Grand JDR slot unchanged', () => {
  setEquipmentSlotsForTests(LEGACY_EQUIPMENT_SLOTS);
  assert.deepEqual(LEGACY_EQUIPMENT_SLOTS.map(slot => slot.id), [
    'Main principale', 'Main secondaire', 'Tête', 'Torse', 'Bottes',
    'Anneau', 'Amulette', 'Objet magique',
  ]);
  assert.equal(getPrimaryWeaponSlotId(), 'Main principale');
  assert.equal(getArmorTorsoSlotId(), 'Torse');
  assert.deepEqual(getArmorSetSlotIds(), ['Tête', 'Torse', 'Bottes']);
});

test('D&D preset exposes worn armor and three independent attunement slots', () => {
  setEquipmentSlotsForTests(DEFAULT_EQUIPMENT_SLOTS);
  assert.equal(getArmorTorsoSlotId(), 'Armure');
  assert.equal(DEFAULT_EQUIPMENT_SLOTS.filter(slot => slot.itemValue === 'Objet harmonisé').length, 3);
  assert.deepEqual(getEquipmentItemOptions('accessory'), ['Objet harmonisé']);
  assert.deepEqual(getArmorSetSlotIds(), ['Armure']);
});

test('configured slots drive item compatibility and automatic target slot', () => {
  setEquipmentSlotsForTests([
    { id: 'Arme', label: 'Arme', kind: 'weapon', role: 'primaryWeapon' },
    { id: 'Cape', label: 'Cape', kind: 'accessory', itemField: 'slotBijou', itemValue: 'Dos' },
  ]);
  const cape = { nom: 'Cape du vent', template: 'bijou', slotBijou: 'Dos' };
  const sword = { nom: 'Épée', template: 'arme', degats: '1d8' };
  assert.equal(equipmentSlotAcceptsItem('Cape', cape), true);
  assert.equal(equipmentSlotAcceptsItem('Arme', cape), false);
  assert.equal(resolveEquipmentSlotForItem(cape), 'Cape');
  assert.equal(resolveEquipmentSlotForItem(sword), 'Arme');
});

test('disabled slots disappear without losing their stable stored id', () => {
  setEquipmentSlotsForTests([
    { id: 'Main principale', label: 'Arme', kind: 'weapon', role: 'primaryWeapon' },
    { id: 'Ancienne cape', label: 'Cape', kind: 'accessory', itemValue: 'Dos', enabled: false },
  ]);
  assert.equal(resolveEquipmentSlotForItem({ nom: 'Cape', slotBijou: 'Dos' }), null);
  assert.equal(getEquipmentItemOptions('accessory').includes('Dos'), false);
  assert.equal(getAllEquipmentSlots().some(slot => slot.id === 'Ancienne cape' && slot.enabled === false), true);
});

test.after(() => setEquipmentSlotsForTests(LEGACY_EQUIPMENT_SLOTS));
