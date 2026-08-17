import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveControlledTokenId } from '../assets/js/features/vtt/vtt-token-control.js';

const entries = {
  enemy: { data: { id: 'enemy', pageId: 'page-a', ownerId: 'gm' } },
  mine: { data: { id: 'mine', pageId: 'page-a', ownerId: 'player' } },
  elsewhere: { data: { id: 'elsewhere', pageId: 'page-b', ownerId: 'player' } },
};
const canControl = token => token.ownerId === 'player';

test('une sélection ennemie ne peut pas devenir la source d’une émote', () => {
  assert.equal(resolveControlledTokenId('enemy', entries, 'page-a', canControl), 'mine');
});

test('un token contrôlé sélectionné reste prioritaire', () => {
  assert.equal(resolveControlledTokenId('mine', entries, 'page-a', canControl), 'mine');
});

test('aucun token hors de la scène active ne sert de solution de repli', () => {
  assert.equal(resolveControlledTokenId('enemy', { enemy: entries.enemy, elsewhere: entries.elsewhere }, 'page-a', canControl), null);
});
