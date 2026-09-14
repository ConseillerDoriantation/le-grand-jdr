import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInventoryEquipPatch,
  buildEquippedItemFromInventory,
  getEquippedSourceItem,
  getItemTraits,
  getMainWeapon,
  syncEquipmentAfterInventoryMutation,
} from '../assets/js/shared/equipment-utils.js';
import { LEGACY_EQUIPMENT_SLOTS, setEquipmentSlotsForTests } from '../assets/js/shared/equipment-slots.js';

test('buildEquippedItemFromInventory : applique les stats ameliorees des amulettes', () => {
  const item = {
    itemId: 'amulet-1',
    nom: 'Amulette de sagesse',
    slotBijou: 'Amulette',
    statBonuses: { sagesse: 1 },
    upgrades: { statBonus: { sa: 1 } },
  };

  const equipped = buildEquippedItemFromInventory('Amulette', item, 0);
  assert.equal(equipped.slotBijou, 'Amulette');
  assert.equal(equipped.sa, 2);
});

test('syncEquipmentAfterInventoryMutation : rafraichit un bijou equipe apres amelioration', () => {
  const before = {
    id: 'char-1',
    inventaire: [{
      itemId: 'amulet-1',
      nom: 'Amulette de sagesse',
      slotBijou: 'Amulette',
      statBonuses: { sagesse: 1 },
    }],
    equipement: {
      Amulette: {
        itemId: 'amulet-1',
        nom: 'Amulette de sagesse',
        slotBijou: 'Amulette',
        sa: 1,
        sourceInvIndex: 0,
      },
    },
    statsBonus: { force: 0, dexterite: 0, intelligence: 0, sagesse: 1, constitution: 0, charisme: 0 },
  };

  before.inventaire[0] = {
    ...before.inventaire[0],
    upgrades: { statBonus: { sa: 1 } },
  };

  const sync = syncEquipmentAfterInventoryMutation(before);
  assert.equal(sync.changed, true);
  assert.equal(sync.equipement.Amulette.sa, 2);
  assert.equal(sync.statsBonus.sagesse, 2);
});

test('la source équipée récupère les traits vivants depuis l inventaire', () => {
  const character = {
    inventaire: [
      { itemId: 'material-1', nom: 'Lingot' },
      { itemId: 'rapiere-1', nom: 'Lame du duelliste', traits: ['Finesse', 'Riposte'] },
    ],
    equipement: {
      'Main principale': {
        itemId: 'rapiere-1', nom: 'Lame du duelliste', sourceInvIndex: 0, traits: [],
      },
    },
  };

  const source = getEquippedSourceItem(character, 'Main principale');
  assert.equal(source, character.inventaire[1]);
  assert.deepEqual(getItemTraits(source), ['Finesse', 'Riposte']);
});

test('getMainWeapon conserve le slot historique des PNJ si le slot principal a été renommé', () => {
  setEquipmentSlotsForTests([
    { id: 'Arme active', label: 'Arme active', kind: 'weapon', role: 'primaryWeapon' },
  ]);
  const weapon = { nom: 'Bâton du thaumaturge', degats: '2d8' };
  assert.equal(getMainWeapon({ equipement: { 'Main principale': weapon } }), weapon);
  setEquipmentSlotsForTests(LEGACY_EQUIPMENT_SLOTS);
});

test('équiper depuis l inventaire remplace le slot sans retirer l ancien objet', () => {
  setEquipmentSlotsForTests(LEGACY_EQUIPMENT_SLOTS);
  const character = {
    inventaire: [
      { itemId: 'old', nom: 'Vieille épée', template: 'arme', degats: '1d6' },
      { itemId: 'new', nom: 'Épée runique', template: 'arme', degats: '2d6', statBonuses: { force: 2 } },
    ],
    equipement: {
      'Main principale': { itemId: 'old', nom: 'Vieille épée', sourceInvIndex: 0 },
    },
  };

  const patch = buildInventoryEquipPatch(character, 1);
  assert.equal(patch.slot, 'Main principale');
  assert.equal(patch.replacedItem.nom, 'Vieille épée');
  assert.equal(patch.equipement['Main principale'].nom, 'Épée runique');
  assert.equal(patch.equipement['Main principale'].sourceInvIndex, 1);
  assert.equal(patch.statsBonus.force, 2);
  assert.equal(character.inventaire.length, 2);
  assert.equal(character.equipement['Main principale'].nom, 'Vieille épée');
});

test('équiper respecte les slots configurés et conserve les données d arme', () => {
  setEquipmentSlotsForTests([
    { id: 'Arme active', label: 'Arme active', kind: 'weapon', role: 'primaryWeapon' },
  ]);
  const character = {
    inventaire: [{ nom: 'Arc astral', template: 'arme', degats: '2d8+3', portee: 12 }],
    equipement: {},
  };

  const patch = buildInventoryEquipPatch(character, 0);
  assert.equal(patch.slot, 'Arme active');
  assert.equal(patch.equipement['Arme active'].degats, '2d8+3');
  assert.equal(patch.equipement['Arme active'].portee, 12);
});

test.after(() => setEquipmentSlotsForTests(LEGACY_EQUIPMENT_SLOTS));
