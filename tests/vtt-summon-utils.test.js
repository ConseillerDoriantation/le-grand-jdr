import test from 'node:test';
import assert from 'node:assert/strict';

import { isTemporarySummonToken, reserveSummonTokens } from '../assets/js/features/vtt/vtt-summon-utils.js';

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
