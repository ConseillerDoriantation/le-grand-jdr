import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateActionAverages,
  aggregateSkillAverages,
  aggregateVttRollDetails,
  appliedDamageAmount,
  combatAverages,
  mergeTrackedCombatStats,
  mergeTrackedSkillStats,
  normalizeSkillStats,
  statsAverage,
} from '../assets/js/shared/stats-analysis.js';

test('les dégâts appliqués sont bornés aux PV réellement perdus', () => {
  assert.equal(appliedDamageAmount({ beforeHp: 42, afterHp: 0, rolledDamage: 2107 }), 42);
  assert.equal(appliedDamageAmount({ beforeHp: 42, afterHp: 30, rolledDamage: 12 }), 12);
  assert.equal(appliedDamageAmount({ rolledDamage: 8 }), 8);
  assert.equal(appliedDamageAmount({ beforeHp: 10, afterHp: 14, rolledDamage: -4 }), 0);
  assert.equal(appliedDamageAmount({ beforeHp: 42, afterHp: 0, rolledDamage: 2107, cancelled: true }), 0);
});

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

test('aggregateActionAverages réunit compétences et combat dans tout le résumé', () => {
  assert.deepEqual(aggregateActionAverages({
    rolls: 4,
    trackedRolls: 2,
    naturalTotal: 30,
    resultTotal: 38,
    crits: 2,
    fumbles: 1,
  }, {
    attacks: 4,
    attackRolls: 4,
    attackRollTotal: 50,
    attackResultRolls: 3,
    attackResultTotal: 51,
    crits: 2,
    fumbles: 0,
  }), {
    rolls: 8,
    skillRolls: 4,
    combatRolls: 4,
    trackedRolls: 6,
    resultTrackedRolls: 5,
    naturalTotal: 80,
    resultTotal: 89,
    crits: 4,
    fumbles: 1,
    naturalAvg: 13.3,
    resultAvg: 17.8,
    critRate: 50,
    fumbleRate: 13,
    coverage: 75,
    resultCoverage: 63,
  });
});

test('combatAverages calcule uniquement sur les impacts suivis', () => {
  assert.deepEqual(combatAverages({
    damageTotal: 52,
    damageEvents: 4,
    damageTakenTotal: 24,
    damageTakenEvents: 3,
    attackRollTotal: 33,
    attackRolls: 3,
    attackResultTotal: 45,
    attackResultRolls: 3,
  }), {
    damageEvents: 4,
    damageAverage: 13,
    damageAverageEstimated: false,
    damageTakenEvents: 3,
    damageTakenAverage: 8,
    damageTakenAverageEstimated: false,
    attackRolls: 3,
    attackNaturalAverage: 11,
    attackResultRolls: 3,
    attackResultAverage: 15,
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
    attackResultRolls: 0,
    attackResultAverage: null,
  });
});

test('aggregateVttRollDetails reconstruit les moyennes depuis les logs VTT', () => {
  const createdAt = new Date(2026, 7, 11, 12);
  const result = aggregateVttRollDetails([
    { type: 'roll', characterId: 'c1', rollSkill: 'Perception', rollRaw: 10, rollResult: 14, createdAt },
    { type: 'roll', characterId: 'c1', rollSkill: 'Perception', rollRaw: 18, rollResult: 22, createdAt },
    { type: 'craft', characterId: 'c1', d20: 12, total: 16, createdAt },
    { type: 'attack', sourceCharacterId: 'c1', hitD20: 15, hitTotal: 18, hit: true, dmgTotal: 8, createdAt },
    { type: 'attack-multi', sourceCharacterId: 'c1', hitD20: 10, hitTotal: 13, targets: [
      { hit: true, dmgTotal: 6 }, { hit: false, halfDmg: true, dmgTotal: 3 },
    ], createdAt },
    { type: 'attack', sourceCharacterId: 'c1', hitD20: 7, hitTotal: 12, hit: true, dmgTotal: 9, shieldCancelled: true, createdAt },
    { type: 'roll', characterId: 'c1', rollSkill: 'Perception', rollRaw: 20, rollResult: 24, actionUndone: true, createdAt },
    { type: 'attack', sourceCharacterId: 'c1', hitD20: 20, isHeal: true, createdAt },
  ], { dateKeys: ['2026-08-11'] });

  assert.deepEqual(result.byCharacter.c1.skills, {
    Perception: { trackedRolls: 2, naturalTotal: 28, resultTotal: 36, crits: 0, fumbles: 0 },
    Artisanat: { trackedRolls: 1, naturalTotal: 12, resultTotal: 16, crits: 0, fumbles: 0 },
  });
  assert.deepEqual(result.byCharacter.c1.combat, {
    attackActions: 3,
    hits: 2,
    crits: 0,
    fumbles: 0,
    attackRolls: 3,
    attackRollTotal: 32,
    attackResultRolls: 3,
    attackResultTotal: 43,
    damageEvents: 3,
    damageTotal: 17,
  });
  assert.equal(result.relevantLogs, 6);
});

test('les dégâts subis retirent l’overkill prouvé par les PV du journal VTT', () => {
  const result = aggregateVttRollDetails([{
    type: 'attack',
    sourceBeastId: 'ancient-dragon',
    characterId: 'kadoc',
    defenderTokenId: 'token-kadoc',
    hitD20: 18,
    hitTotal: 27,
    hit: true,
    dmgTotal: 2107,
    newHp: 0,
    undo: { tokens: { 'token-kadoc': { hp: 42 } } },
    statsDelta: { chars: {
      kadoc: { combat: { attacksTaken: 1, dmgTaken: 2107, damageTakenEvents: 1, damageTakenTotal: 2107 } },
    } },
    createdAt: new Date(2026, 7, 11, 12),
  }]);

  assert.deepEqual(result.byCharacter.kadoc.combat.receivedOvercounts, {
    dmgTaken: 2065,
    damageTakenTotal: 2065,
  });
  const corrected = mergeTrackedCombatStats({
    attacksTaken: 1,
    dmgTaken: 2107,
    damageTakenEvents: 1,
    damageTakenTotal: 2107,
  }, result.byCharacter.kadoc.combat);
  assert.equal(corrected.dmgTaken, 42);
  assert.equal(corrected.damageTakenTotal, 42);
  assert.equal(corrected.damageTakenEvents, 1);
  assert.equal(corrected.damageTakenCorrection, 2065);
});

test('une correction MJ datée reste prioritaire sur la reconstruction du journal', () => {
  const result = aggregateVttRollDetails([{
    type: 'attack', sourceBeastId: 'dragon', characterId: 'kadoc', defenderTokenId: 'tk',
    hitD20: 18, hit: true, dmgTotal: 2017, newHp: 30,
    undo: { tokens: { tk: { hp: 42 } } },
    statsDelta: { chars: { kadoc: { combat: { dmgTaken: 2017, damageTakenTotal: 2017, damageTakenEvents: 1 } } } },
    createdAt: new Date(2026, 7, 11, 12),
  }], {
    hasManualCombatCorrection: (charId, date, kind) => charId === 'kadoc' && date === '2026-08-11' && kind === 'taken',
  });

  assert.equal(result.byCharacter.kadoc, undefined);
});

test('une attaque multicible ne compte que comme un seul jet critique ou échec', () => {
  const result = aggregateVttRollDetails([{
    type: 'attack-multi',
    sourceCharacterId: 'c1',
    hitD20: 1,
    hitTotal: 5,
    isFumble: true,
    targets: Array.from({ length: 5 }, (_, index) => ({ hit: false, dmgTotal: 0, name: `Cible ${index + 1}` })),
    statsDelta: { chars: { c1: { combat: {
      attacks: 5,
      hits: 0,
      crits: 0,
      fumbles: 5,
      attackRolls: 5,
      attackRollTotal: 5,
      attackResultRolls: 5,
      attackResultTotal: 25,
    } } } },
    createdAt: new Date(2026, 7, 11, 12),
  }]);

  assert.deepEqual(result.byCharacter.c1.combat, {
    attackActions: 1,
    hits: 0,
    crits: 0,
    fumbles: 1,
    attackRolls: 1,
    attackRollTotal: 1,
    attackResultRolls: 1,
    attackResultTotal: 5,
    damageEvents: 0,
    damageTotal: 0,
    actionOvercounts: {
      attacks: 4,
      fumbles: 4,
      attackRolls: 4,
      attackRollTotal: 4,
      attackResultRolls: 4,
      attackResultTotal: 20,
    },
  });

  const correctedCombat = mergeTrackedCombatStats({
    attacks: 5,
    hits: 0,
    crits: 0,
    fumbles: 5,
    attackRolls: 5,
    attackRollTotal: 5,
    attackResultRolls: 5,
    attackResultTotal: 25,
  }, result.byCharacter.c1.combat);
  assert.deepEqual(correctedCombat, {
    attacks: 1,
    hits: 0,
    crits: 0,
    fumbles: 1,
    attackRolls: 1,
    attackRollTotal: 1,
    attackResultRolls: 1,
    attackResultTotal: 5,
  });
  assert.deepEqual(aggregateActionAverages({ rolls: 0 }, correctedCombat), {
    rolls: 1,
    skillRolls: 0,
    combatRolls: 1,
    trackedRolls: 1,
    resultTrackedRolls: 1,
    naturalTotal: 1,
    resultTotal: 5,
    crits: 0,
    fumbles: 1,
    naturalAvg: 1,
    resultAvg: 5,
    critRate: 0,
    fumbleRate: 100,
    coverage: 100,
    resultCoverage: 100,
  });
});

test('les détails du journal remplacent seulement une couverture plus faible', () => {
  assert.deepEqual(mergeTrackedSkillStats(
    { rolls: 8, trackedRolls: 2, naturalTotal: 12, resultTotal: 20 },
    { trackedRolls: 5, naturalTotal: 55, resultTotal: 75, crits: 1, fumbles: 1 },
  ), { rolls: 8, trackedRolls: 5, naturalTotal: 55, resultTotal: 75 });
  assert.deepEqual(mergeTrackedCombatStats(
    { attacks: 7, attackRolls: 1, attackRollTotal: 8, damageEvents: 1, damageTotal: 4 },
    { attackActions: 3, hits: 2, crits: 1, fumbles: 1, attackRolls: 3, attackRollTotal: 32, attackResultRolls: 3, attackResultTotal: 43, damageEvents: 3, damageTotal: 17 },
  ), {
    attacks: 7,
    attackRolls: 3,
    attackRollTotal: 32,
    attackResultRolls: 3,
    attackResultTotal: 43,
    damageEvents: 3,
    damageTotal: 17,
  });
});

test('le journal réattribue les échecs critiques au bon personnage pour le MVP', () => {
  const details = aggregateVttRollDetails([
    {
      type: 'roll', characterId: 'a', rollSkill: 'Perception', rollRaw: 1, rollResult: 4,
      isFumble: true, createdAt: new Date(2026, 7, 11, 12),
    },
    {
      type: 'attack', sourceCharacterId: 'a', hitD20: 1, hitTotal: 5,
      isFumble: true, hit: false, createdAt: new Date(2026, 7, 11, 12, 1),
    },
    {
      type: 'attack', sourceCharacterId: 'b', hitD20: 12, hitTotal: 17,
      isFumble: false, hit: true, createdAt: new Date(2026, 7, 11, 12, 2),
    },
  ]).byCharacter;

  const skillA = mergeTrackedSkillStats(
    { rolls: 1, crits: 0, fumbles: 2 },
    details.a.skills.Perception,
  );
  const combatA = mergeTrackedCombatStats(
    { attacks: 1, crits: 0, fumbles: 1 },
    details.a.combat,
  );
  const combatB = mergeTrackedCombatStats(
    { attacks: 1, crits: 0, fumbles: 1 },
    details.b.combat,
  );

  assert.equal(skillA.fumbles + combatA.fumbles, 2);
  assert.equal(combatB.fumbles, 0);
});
