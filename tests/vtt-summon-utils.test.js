import test from 'node:test';
import assert from 'node:assert/strict';

import { isTemporarySummonToken, reserveSummonTokens, resolveInvocationManaChange } from '../assets/js/features/vtt/vtt-summon-utils.js';

test('une invocation ou sentinelle est temporaire, contrairement aux personnages et PNJ', () => {
  assert.equal(isTemporarySummonToken({ summonKind:'invocation' }), true);
  assert.equal(isTemporarySummonToken({ summonKind:'sentinelle' }), true);
  assert.equal(isTemporarySummonToken({ summonOwnerId:'caster-1' }), true);
  assert.equal(isTemporarySummonToken({ characterId:'char-1', type:'player' }), false);
  assert.equal(isTemporarySummonToken({ npcId:'npc-1', type:'npc' }), false);
});

test('le nettoyage cible seulement les summons sans scène', () => {
  const tokens = [
    { id:'blocked', summonKind:'invocation', pageId:null },
    { id:'active', summonKind:'invocation', pageId:'scene-1' },
    { id:'player', characterId:'char-1', pageId:null },
    { id:'npc', npcId:'npc-1' },
  ];
  assert.deepEqual(reserveSummonTokens(tokens).map(token => token.id), ['blocked']);
});

test('les PM restaurés d’une invocation sont bornés par sa réserve', () => {
  const invocation = { summonKind:'invocation', pmMax:12 };
  assert.deepEqual(resolveInvocationManaChange(invocation, 7), { value:7, max:12 });
  assert.deepEqual(resolveInvocationManaChange(invocation, 99), { value:12, max:12 });
  assert.deepEqual(resolveInvocationManaChange(invocation, -3), { value:0, max:12 });
});

test('un token sans réserve propre ne reçoit pas de PM d’invocation', () => {
  assert.equal(resolveInvocationManaChange({ summonKind:'invocation', pmMax:0 }, 4), null);
  assert.equal(resolveInvocationManaChange({ characterId:'char-1', pmMax:10 }, 4), null);
  assert.equal(resolveInvocationManaChange({ summonKind:'invocation', pmMax:10 }, 'invalide'), null);
});
