import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateSkillAverages,
  aggregateVttRollDetails,
  combatAverages,
  mergeTrackedCombatStats,
  mergeTrackedSkillStats,
  normalizeSkillStats,
  statsAverage,
} from '../assets/js/shared/stats-analysis.js';

test('statsAverage renvoie null sans échantillon et arrondit à un décimal', () => {
  assert.equal(statsAverage(42, 0), null);
  assert.equal(statsAverage(31, 2), 15.5);
  assert.equal(statsAverage(10, 3), 3.3);
});

test('normalizeSkillStats sépare les jets historiques des jets détaillés', () => {
  assert.deepEqual(normalizeSkillStats('Perception', {
    rolls: 8,
    trackedRolls: 3,
    naturalTotal: 39,
    resultTotal: 51,
    crits: 1,
    fumbles: 1,
  }), {
    sk: 'Perception',
    rolls: 8,
    trackedRolls: 3,
    crits: 1,
    fumbles: 1,
    naturalTotal: 39,
    resultTotal: 51,
    naturalAvg: 13,
    resultAvg: 17,
    critRate: 13,
    fumbleRate: 13,
  });
});

test('aggregateSkillAverages agrège les joueurs et conserve la couverture', () => {
  const result = aggregateSkillAverages([
    { perSkill: [normalizeSkillStats('Discrétion', { rolls: 5, trackedRolls: 2, naturalTotal: 21, resultTotal: 31 })] },
    { perSkill: [normalizeSkillStats('Discrétion', { rolls: 3, trackedRolls: 3, naturalTotal: 36, resultTotal: 48 })] },
  ]);
  assert.equal(result.rolls, 8);
  assert.equal(result.trackedRolls, 5);
  assert.equal(result.coverage, 63);
  assert.equal(result.naturalAvg, 11.4);
  assert.equal(result.resultAvg, 15.8);
  assert.equal(result.perSkill[0].resultAvg, 15.8);
});

test('combatAverages calcule uniquement sur les impacts suivis', () => {
  assert.deepEqual(combatAverages({
    damageTotal: 52,
    damageEvents: 4,
    damageTakenTotal: 24,
    damageTakenEvents: 3,
    attackRollTotal: 33,
    attackRolls: 3,
  }), {
    damageEvents: 4,
    damageAverage: 13,
    damageAverageEstimated: false,
    damageTakenEvents: 3,
    damageTakenAverage: 8,
    damageTakenAverageEstimated: false,
    attackRolls: 3,
    attackNaturalAverage: 11,
  });
});

test('combatAverages exploite les compteurs historiques sans inventer de d20', () => {
  assert.deepEqual(combatAverages({
    hits: 5,
    dmgDealt: 61,
    attacksTaken: 7,
    attacksAvoided: 2,
    dmgTaken: 40,
  }), {
    damageEvents: 5,
    damageAverage: 12.2,
    damageAverageEstimated: true,
    damageTakenEvents: 5,
    damageTakenAverage: 8,
    damageTakenAverageEstimated: true,
    attackRolls: 0,
    attackNaturalAverage: null,
  });
});

test('aggregateVttRollDetails reconstruit les moyennes depuis les logs VTT', () => {
  const createdAt = new Date(2026, 7, 11, 12);
  const result = aggregateVttRollDetails([
    { type: 'roll', characterId: 'c1', rollSkill: 'Perception', rollRaw: 10, rollResult: 14, createdAt },
    { type: 'roll', characterId: 'c1', rollSkill: 'Perception', rollRaw: 18, rollResult: 22, createdAt },
    { type: 'craft', characterId: 'c1', d20: 12, total: 16, createdAt },
    { type: 'attack', sourceCharacterId: 'c1', hitD20: 15, hit: true, dmgTotal: 8, createdAt },
    { type: 'attack-multi', sourceCharacterId: 'c1', hitD20: 10, targets: [
      { hit: true, dmgTotal: 6 }, { hit: false, halfDmg: true, dmgTotal: 3 },
    ], createdAt },
    { type: 'attack', sourceCharacterId: 'c1', hitD20: 7, hit: true, dmgTotal: 9, shieldCancelled: true, createdAt },
    { type: 'roll', characterId: 'c1', rollSkill: 'Perception', rollRaw: 20, rollResult: 24, actionUndone: true, createdAt },
    { type: 'attack', sourceCharacterId: 'c1', hitD20: 20, isHeal: true, createdAt },
  ], { dateKeys: ['2026-08-11'] });

  assert.deepEqual(result.byCharacter.c1.skills, {
    Perception: { trackedRolls: 2, naturalTotal: 28, resultTotal: 36 },
    Artisanat: { trackedRolls: 1, naturalTotal: 12, resultTotal: 16 },
  });
  assert.deepEqual(result.byCharacter.c1.combat, {
    attackRolls: 4,
    attackRollTotal: 42,
    damageEvents: 3,
    damageTotal: 17,
  });
  assert.equal(result.relevantLogs, 6);
});

test('les détails du journal remplacent seulement une couverture plus faible', () => {
  assert.deepEqual(mergeTrackedSkillStats(
    { rolls: 8, trackedRolls: 2, naturalTotal: 12, resultTotal: 20 },
    { trackedRolls: 5, naturalTotal: 55, resultTotal: 75 },
  ), { rolls: 8, trackedRolls: 5, naturalTotal: 55, resultTotal: 75 });
  assert.deepEqual(mergeTrackedCombatStats(
    { attacks: 7, attackRolls: 1, attackRollTotal: 8, damageEvents: 1, damageTotal: 4 },
    { attackRolls: 4, attackRollTotal: 42, damageEvents: 3, damageTotal: 17 },
  ), { attacks: 7, attackRolls: 4, attackRollTotal: 42, damageEvents: 3, damageTotal: 17 });
});
