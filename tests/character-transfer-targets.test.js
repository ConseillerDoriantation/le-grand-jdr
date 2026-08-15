import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeCharacterTransferTargets } from '../assets/js/shared/character-transfer-targets.js';

test('inclut tous les personnages de l aventure quand le joueur en possède plusieurs', () => {
  const sessionCharacters = [
    { id: 'owned-a', nom: 'Aldren', ownerUid: 'player-a' },
    { id: 'owned-b', nom: 'Bryn', ownerUid: 'player-a' },
    { id: 'other', nom: 'Céleste', ownerUid: 'player-b' },
  ];
  const stateCharacters = sessionCharacters.slice(0, 2);

  const targets = mergeCharacterTransferTargets('owned-a', sessionCharacters, stateCharacters);

  assert.deepEqual(targets.map(character => character.id), ['owned-b', 'other']);
});

test('exclut toujours le personnage expéditeur', () => {
  const targets = mergeCharacterTransferTargets('source', [
    { id: 'source', nom: 'Source' },
    { id: 'target', nom: 'Cible' },
  ]);

  assert.deepEqual(targets.map(character => character.id), ['target']);
});

test('déduplique les personnages et privilégie leur état local récent', () => {
  const targets = mergeCharacterTransferTargets(
    'source',
    [{ id: 'target', nom: 'Ancien nom', inventaire: [] }],
    [{ id: 'target', nom: 'Nouveau nom', inventaire: [{ nom: 'Potion' }] }],
  );

  assert.equal(targets.length, 1);
  assert.equal(targets[0].nom, 'Nouveau nom');
  assert.equal(targets[0].inventaire.length, 1);
});
