import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEquippedItemFromInventory,
  syncEquipmentAfterInventoryMutation,
} from '../assets/js/shared/equipment-utils.js';

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
