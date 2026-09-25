import test from 'node:test';
import assert from 'node:assert/strict';
import {
  controlledCharacterTokens,
  isCharacterGrantedToUid,
  invocableCharacterTokens,
  resolveCharacterControlToken,
  resolveControlledTokenId,
} from '../assets/js/features/vtt/vtt-token-control.js';

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

test('un délégué retrouve le token qui autorise les ressources du personnage', () => {
  const delegated = {
    data: {
      id: 'delegated', characterId: 'char-owner', ownerId: 'owner',
      controlDelegates: ['player'],
    },
  };
  assert.equal(resolveCharacterControlToken('char-owner', { delegated }, 'player')?.id, 'delegated');
});

test('la délégation ne donne aucun accès aux ressources d’un autre personnage', () => {
  const delegated = {
    data: {
      id: 'delegated', characterId: 'char-owner', ownerId: 'owner',
      controlDelegates: ['player'],
    },
  };
  assert.equal(resolveCharacterControlToken('char-other', { delegated }, 'player'), null);
  assert.equal(resolveCharacterControlToken('char-owner', { delegated }, 'stranger'), null);
});

test('la délégation canonique du personnage contrôle aussi un ancien token non migré', () => {
  const token = { data: { id: 'legacy', characterId: 'char-owner', ownerId: 'owner' } };
  const characters = { 'char-owner': { id: 'char-owner', controlDelegates: ['player'] } };
  assert.equal(resolveCharacterControlToken('char-owner', { token }, 'player', characters)?.id, 'legacy');
});

test('le roster contrôlé réunit propriété et délégations de fiche ou de token', () => {
  const owned = { id: 'owned', uid: 'player' };
  const canonical = { id: 'canonical', uid: 'owner', controlDelegates: ['player'] };
  const legacy = { id: 'legacy-char', uid: 'owner' };
  const tokens = {
    legacy: { data: { id: 'legacy-token', characterId: 'legacy-char', ownerId: 'owner', controlDelegates: ['player'] } },
  };
  const characters = { owned, canonical, 'legacy-char': legacy };
  assert.equal(isCharacterGrantedToUid(owned, tokens, 'player', characters), true);
  assert.equal(isCharacterGrantedToUid(canonical, tokens, 'player', characters), true);
  assert.equal(isCharacterGrantedToUid(legacy, tokens, 'player', characters), true);
  assert.equal(isCharacterGrantedToUid(legacy, tokens, 'stranger', characters), false);
});

test('le personnage reste identifiable même lorsque son token est en réserve', () => {
  const tokens = {
    reserve: { data: { id: 'reserve', characterId: 'char-a', ownerId: 'player', pageId: null } },
    summon: { data: { id: 'summon', summonOwnerId: 'reserve', ownerId: 'player', pageId: null } },
  };
  const controlled = controlledCharacterTokens(tokens, token => token.ownerId === 'player');
  assert.deepEqual(controlled.map(token => token.id), ['reserve']);
});

test('invoquer est proposé seulement si le personnage est absent de la scène', () => {
  const canControl = token => token.ownerId === 'player';
  const absent = { reserve: { data: { id: 'reserve', characterId: 'char-a', ownerId: 'player', pageId: null } } };
  assert.deepEqual(invocableCharacterTokens(absent, 'page-a', canControl).map(token => token.id), ['reserve']);

  const duplicate = {
    onPage: { data: { id: 'on-page', characterId: 'char-a', ownerId: 'player', pageId: 'page-a' } },
    reserve: absent.reserve,
  };
  assert.deepEqual(invocableCharacterTokens(duplicate, 'page-a', canControl), []);
});
