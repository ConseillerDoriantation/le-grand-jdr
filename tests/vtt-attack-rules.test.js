import test from 'node:test';
import assert from 'node:assert/strict';

import { receivesOffensiveDamageBonus } from '../assets/js/features/vtt/vtt-attack-rules.js';

test('Renforcé s’applique à l’attaque de base d’une invocation', () => {
  assert.equal(receivesOffensiveDamageBonus({ id:'summon_attack', actionType:'action' }), true);
});

test('les autres attaques directes et sorts offensifs gardent leur bonus', () => {
  assert.equal(receivesOffensiveDamageBonus({ id:'weapon' }), true);
  assert.equal(receivesOffensiveDamageBonus({ id:'npc_attack' }), true);
  assert.equal(receivesOffensiveDamageBonus({ id:'beast_0' }), true);
  assert.equal(receivesOffensiveDamageBonus({ id:'summon_action_0', sortIdx:'summon_x_0' }), true);
});

test('un bonus offensif ne se greffe pas sur une action bonus ou une réaction', () => {
  assert.equal(receivesOffensiveDamageBonus({ id:'summon_attack', actionType:'bonus' }), false);
  assert.equal(receivesOffensiveDamageBonus({ id:'summon_action_0', sortIdx:'summon_x_0', actionType:'reaction' }), false);
  assert.equal(receivesOffensiveDamageBonus({ id:'utility' }), false);
});
