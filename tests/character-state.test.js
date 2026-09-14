import test from 'node:test';
import assert from 'node:assert/strict';
import { STATE } from '../assets/js/core/state.js';
import {
  canControlCharacter,
  getCharacterDelegates,
  getControlledCharacters,
} from '../assets/js/shared/character-state.js';

test('la délégation donne le même accès UI que la propriété', () => {
  STATE.isAdmin = false;
  const owned = { id: 'owned', uid: 'player', nom: 'Zora' };
  const delegated = { id: 'delegated', uid: 'other', nom: 'Aria', controlDelegates: ['player'] };
  const foreign = { id: 'foreign', uid: 'other', nom: 'Borin' };

  assert.equal(canControlCharacter(owned, 'player'), true);
  assert.equal(canControlCharacter(delegated, 'player'), true);
  assert.equal(canControlCharacter(foreign, 'player'), false);
  assert.deepEqual(getControlledCharacters([owned, foreign, delegated], 'player').map(c => c.id), ['delegated', 'owned']);
});

test('les UIDs délégués sont normalisés sans doublon', () => {
  assert.deepEqual(getCharacterDelegates({ controlDelegates: ['u2', '', 'u2', null, 'u3'] }), ['u2', 'u3']);
});

test('le MJ conserve accès à tous les personnages', () => {
  STATE.isAdmin = true;
  assert.equal(canControlCharacter({ uid: 'other' }, 'gm'), true);
  assert.equal(getControlledCharacters([{ id: 'b', nom: 'B' }, { id: 'a', nom: 'A' }], 'gm').length, 2);
  STATE.isAdmin = false;
});
