import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deckHasRoomFor,
  getDeckUsage,
  isAlwaysPreparedSpell,
  spellUsesDeckSlot,
} from '../assets/js/shared/spell-deck.js';

test('un sort toujours prêt est actif sans consommer la capacité du Deck', () => {
  const rage = { actif: true, alwaysPrepared: true };
  assert.equal(isAlwaysPreparedSpell(rage), true);
  assert.equal(spellUsesDeckSlot(rage), false);
  assert.deepEqual(getDeckUsage([
    rage,
    { actif: true },
    { actif: false, alwaysPrepared: true },
  ]), { active: 2, used: 1, free: 1 });
});

test('un sort toujours prêt peut entrer dans un Deck plein', () => {
  const deck = [{ actif: true }, { actif: true }, { actif: true }];
  assert.equal(deckHasRoomFor({ actif: false }, deck, 3), false);
  assert.equal(deckHasRoomFor({ actif: false, alwaysPrepared: true }, deck, 3), true);
});
