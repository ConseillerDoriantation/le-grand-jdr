import test from 'node:test';
import assert from 'node:assert/strict';
import { combatHpDeltas, replayCombatHpEstimates } from '../assets/js/features/vtt/vtt-hp-estimates.js';

test('attaque simple : seul le résultat public réduit l estimation de la cible', () => {
  assert.deepEqual(combatHpDeltas({
    type: 'attack', defenderTokenId: 'beast-token', hit: true, dmgTotal: 7,
    dmgApplied: 3, newHp: 99992, hpMax: 99999,
  }), [{ tokenId: 'beast-token', delta: -7 }]);
});

test('attaque de zone : chaque cible touchée reçoit son propre delta', () => {
  assert.deepEqual(combatHpDeltas({ type: 'attack-multi', targets: [
    { tokenId: 'a', hit: true, dmgTotal: 5 },
    { tokenId: 'b', hit: false, halfDmg: true, dmgTotal: 2 },
    { tokenId: 'c', hit: false, halfDmg: false, dmgTotal: 0 },
  ] }), [
    { tokenId: 'a', delta: -5 },
    { tokenId: 'b', delta: -2 },
  ]);
});

test('soin en PV : augmente l estimation, la régénération de PM ne la change pas', () => {
  const heal = { type: 'attack', isHeal: true, defenderTokenId: 'a', dmgTotal: 4 };
  assert.deepEqual(combatHpDeltas(heal), [{ tokenId: 'a', delta: 4 }]);
  assert.deepEqual(combatHpDeltas({ ...heal, isMana: true }), []);
});

test('annulation ou bouclier : ne laisse pas de dégâts estimés', () => {
  const attack = { type: 'attack', defenderTokenId: 'a', hit: true, dmgTotal: 8 };
  assert.deepEqual(combatHpDeltas({ ...attack, actionUndone: true }), []);
  assert.deepEqual(combatHpDeltas({ ...attack, shieldCancelled: true }), []);
});

test('chaque joueur voit évoluer sa propre estimation, jamais les vrais PV', () => {
  const tokens = { a: { data: { type: 'enemy', beastId: 'beast-1', hp: 99987 } } };
  const events = [
    { createdAt: { toMillis: () => 2 }, deltas: [{ tokenId: 'a', delta: 5 }] },
    { createdAt: { toMillis: () => 1 }, deltas: [{ tokenId: 'a', delta: -12 }] },
  ];
  assert.deepEqual(replayCombatHpEstimates(events, tokens, { 'beast-1': { pvActuel: 20 } }).get('a'),
    { current: 13, max: 20 });
  assert.deepEqual(replayCombatHpEstimates(events, tokens, { 'beast-1': { pvActuel: 30 } }).get('a'),
    { current: 23, max: 30 });
  assert.equal(replayCombatHpEstimates(events, tokens, {}).has('a'), false);
});
