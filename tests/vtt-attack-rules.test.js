import test from 'node:test';
import assert from 'node:assert/strict';

import { attackRollHitsTarget, gridDistanceForRange, receivesOffensiveDamageBonus } from '../assets/js/features/vtt/vtt-attack-rules.js';

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

test('une explosion compare le jet commun à la CA individuelle de chaque cible', () => {
  assert.equal(attackRollHitsTarget({ hitTotal: 12, targetCA: 1 }), true);
  assert.equal(attackRollHitsTarget({ hitTotal: 12, targetCA: 20 }), false);
  assert.equal(attackRollHitsTarget({ hitTotal: 30, targetCA: 1, isFumble: true }), false);
  assert.equal(attackRollHitsTarget({ hitTotal: 1, targetCA: 20, autoHit: true }), true);
});

test('une invocation à portée 1 accepte les huit cases adjacentes', () => {
  assert.equal(gridDistanceForRange(1, 1, 1), 1);
  assert.equal(gridDistanceForRange(-1, 1, 1), 1);
  assert.equal(gridDistanceForRange(2, 1, 1), 2);
});

test('les portées supérieures conservent la distance Manhattan', () => {
  assert.equal(gridDistanceForRange(1, 1, 2), 2);
  assert.equal(gridDistanceForRange(2, 1, 3), 3);
});
