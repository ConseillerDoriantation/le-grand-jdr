import test from 'node:test';
import assert from 'node:assert/strict';

import { getArmorSetData } from '../assets/js/shared/equipment-utils.js';
import { LEGACY_EQUIPMENT_SLOTS, setEquipmentSlotsForTests } from '../assets/js/shared/equipment-slots.js';
import { DEFAULT_ARMOR_SETS, LEGACY_ARMOR_SETS, getArmorTypeOptions, setArmorSetSettingsForTests } from '../assets/js/shared/armor-set-settings.js';

test('armor set : Le Grand JDR active le set léger sur tous les slots armure', () => {
  setEquipmentSlotsForTests(LEGACY_EQUIPMENT_SLOTS);
  setArmorSetSettingsForTests(LEGACY_ARMOR_SETS);

  const data = getArmorSetData({
    equipement: {
      'Tête': { nom: 'Capuche', typeArmure: 'Légère' },
      Torse: { nom: 'Robe', typeArmure: 'Légère' },
      Bottes: { nom: 'Bottes souples', typeArmure: 'Légère' },
      Anneau: { nom: 'Anneau', typeArmure: 'Lourde' },
    },
  });

  assert.equal(data.isActive, true);
  assert.equal(data.fullType, 'Légère');
  assert.equal(data.modifiers.spellPmDelta, -2);
  assert.equal(data.modifiers.toucherBonus, 0);
});

test('armor set : un type mixte ou incomplet ne donne aucun bonus', () => {
  setEquipmentSlotsForTests(LEGACY_EQUIPMENT_SLOTS);
  setArmorSetSettingsForTests(LEGACY_ARMOR_SETS);

  const mixed = getArmorSetData({
    equipement: {
      'Tête': { nom: 'Capuche', typeArmure: 'Légère' },
      Torse: { nom: 'Plastron', typeArmure: 'Intermédiaire' },
      Bottes: { nom: 'Bottes', typeArmure: 'Légère' },
    },
  });
  assert.equal(mixed.isActive, false);
  assert.equal(mixed.mixed, true);

  const incomplete = getArmorSetData({
    equipement: {
      'Tête': { nom: 'Capuche', typeArmure: 'Légère' },
      Torse: { nom: 'Robe', typeArmure: 'Légère' },
    },
  });
  assert.equal(incomplete.isActive, false);
  assert.equal(incomplete.isComplete, false);
});

test('armor set : les types et effets personnalisés sont pilotés par aventure', () => {
  setEquipmentSlotsForTests([
    { id: 'Arme', label: 'Arme', kind: 'weapon', role: 'primaryWeapon' },
    { id: 'Cape', label: 'Cape', kind: 'armor', itemField: 'slotArmure', itemValue: 'Cape' },
    { id: 'Masque', label: 'Masque', kind: 'armor', itemField: 'slotArmure', itemValue: 'Masque' },
    { id: 'Anneau', label: 'Anneau', kind: 'accessory', itemField: 'slotBijou', itemValue: 'Anneau' },
  ]);
  setArmorSetSettingsForTests([
    {
      id: 'runique',
      type: 'Runique',
      label: 'Runique',
      enabled: true,
      modifiers: { spellPmDelta: 1, toucherBonus: -1, damageReduction: 3 },
    },
  ]);

  const data = getArmorSetData({
    equipement: {
      Cape: { nom: 'Cape gravée', typeArmure: 'Runique' },
      Masque: { nom: 'Masque gravé', typeArmure: 'Runique' },
      Anneau: { nom: 'Anneau sans importance', typeArmure: 'Légère' },
    },
  });

  assert.equal(data.isActive, true);
  assert.equal(data.trackedSlots.length, 2);
  assert.deepEqual(data.modifiers, { spellPmDelta: 1, toucherBonus: -1, damageReduction: 3 });
});

test('armor set : une nouvelle aventure ne force aucun type par défaut', () => {
  setArmorSetSettingsForTests(DEFAULT_ARMOR_SETS, { base: DEFAULT_ARMOR_SETS });
  assert.deepEqual(getArmorTypeOptions(), []);
});

test.after(() => {
  setEquipmentSlotsForTests(LEGACY_EQUIPMENT_SLOTS);
  setArmorSetSettingsForTests(LEGACY_ARMOR_SETS);
});
