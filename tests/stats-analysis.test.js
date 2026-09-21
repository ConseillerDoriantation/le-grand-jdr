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
  topStatTies,
} from '../assets/js/shared/stats-analysis.js';

test('les dégâts appliqués sont bornés aux PV réellement perdus', () => {
  assert.equal(appliedDamageAmount({ beforeHp: 42, afterHp: 0, rolledDamage: 2107 }), 42);
  assert.equal(appliedDamageAmount({ beforeHp: 42, afterHp: 30, rolledDamage: 12 }), 12);
  assert.equal(appliedDamageAmount({ rolledDamage: 8 }), 8);
  assert.equal(appliedDamageAmount({ beforeHp: 10, afterHp: 14, rolledDamage: -4 }), 0);
  assert.equal(appliedDamageAmount({ beforeHp: 42, afterHp: 0, rolledDamage: 2107, cancelled: true }), 0);
  assert.equal(appliedDamageAmount({ beforeHp: 100, afterHp: 55, rolledDamage: 9 }), 9);
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

test('une somme de d20 impossible est remplacée par le journal ou masquée', () => {
  const repaired = mergeTrackedSkillStats(
    { rolls: 95, trackedRolls: 59, naturalTotal: 4248, resultTotal: 5100 },
    { trackedRolls: 59, naturalTotal: 620, resultTotal: 910, crits: 2, fumbles: 1 },
  );
  assert.equal(normalizeSkillStats('Perception', repaired).naturalAvg, 10.5);
  assert.equal(normalizeSkillStats('Perception', repaired).resultAvg, 15.4);

  const unavailable = normalizeSkillStats('Discrétion', {
    rolls: 4, trackedRolls: 4, naturalTotal: 88, resultTotal: 104,
  });
  assert.equal(unavailable.naturalAvg, null);
  assert.equal(unavailable.resultAvg, null);
  assert.equal(unavailable.trackedRolls, 0);
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
    supplementalRolls: 0,
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

test('les critiques de soin et de soutien complètent les attaques et compétences', () => {
  const result = aggregateActionAverages(
    { rolls: 2, trackedRolls: 2, naturalTotal: 21, resultTotal: 27, crits: 1, fumbles: 0 },
    { attacks: 2, attackRolls: 2, attackRollTotal: 21, attackResultRolls: 2, attackResultTotal: 29, crits: 0, fumbles: 1 },
    { rolls: 2, trackedRolls: 2, naturalTotal: 21, resultRolls: 1, resultTotal: 24, crits: 1, fumbles: 1 },
  );

  assert.equal(result.rolls, 6);
  assert.equal(result.supplementalRolls, 2);
  assert.equal(result.crits, 2);
  assert.equal(result.fumbles, 2);
});

test('topStatTies conserve tous les premiers ex aequo', () => {
  const result = topStatTies([
    { id: 'a', value: 4 },
    { id: 'b', value: 7 },
    { id: 'c', value: 7 },
    { id: 'd', value: 0 },
  ], row => row.value);

  assert.equal(result.value, 7);
  assert.deepEqual(result.winners.map(row => row.id), ['b', 'c']);
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
    canonicalActions: 4,
    attackActions: 3,
    hits: 2,
    crits: 0,
    fumbles: 0,
    attackRolls: 3,
    attackRollTotal: 32,
    attackResultRolls: 3,
    attackResultTotal: 43,
    supplementalRolls: 1,
    supplementalNaturalTotal: 20,
    supplementalResultRolls: 0,
    supplementalResultTotal: 0,
    supplementalCrits: 1,
    supplementalFumbles: 0,
    damageEvents: 3,
    damageTotal: 17,
    biggestHit: 8,
  });
  assert.equal(result.relevantLogs, 7);
});

test('les actions explicitement hors statistiques ne reviennent pas par le journal VTT', () => {
  const createdAt = new Date(2026, 7, 11, 12);
  const result = aggregateVttRollDetails([
    {
      type: 'attack', sourceCharacterId: 'c1', hitD20: 18, hitTotal: 22,
      hit: true, dmgTotal: 9, statsExcluded: true, statsSource: 'item', createdAt,
    },
    {
      type: 'attack', sourceCharacterId: 'c1', hitD20: 12, hitTotal: 16,
      hit: true, dmgTotal: 5, createdAt,
    },
  ]);

  assert.equal(result.relevantLogs, 1);
  assert.equal(result.byCharacter.c1.combat.attackActions, 1);
  assert.equal(result.byCharacter.c1.combat.damageTotal, 5);
});

test('le journal reconnaît les critiques de soin et d enchantement sans créer d attaques', () => {
  const createdAt = new Date(2026, 7, 11, 12);
  const result = aggregateVttRollDetails([
    { type: 'attack', isHeal: true, sourceCharacterId: 'c1', hitD20: 20, hitTotal: 24, isCrit: true, createdAt },
    { type: 'attack-multi', isHeal: true, sourceCharacterId: 'c1', hitD20: 1, hitTotal: 5, isFumble: true, targets: [{ hit: true }, { hit: true }], createdAt },
    { type: 'cast', sourceCharacterId: 'c1', castEffect: '🎲 20 💥 RC · Renforcé', createdAt },
    { type: 'cast', sourceCharacterId: 'c1', castEC: true, createdAt },
  ]);

  assert.equal(result.byCharacter.c1.combat.attackActions, 0);
  assert.equal(result.byCharacter.c1.combat.supplementalRolls, 4);
  assert.equal(result.byCharacter.c1.combat.supplementalCrits, 2);
  assert.equal(result.byCharacter.c1.combat.supplementalFumbles, 2);
});

test('une séance supprimée pour un personnage ne réapparaît pas depuis le journal VTT', () => {
  const deletedAt = new Date(2026, 7, 11, 14).getTime();
  const result = aggregateVttRollDetails([
    { type: 'roll', characterId: 'c1', rollSkill: 'Perception', rollRaw: 12, rollResult: 16, createdAt: new Date(2026, 7, 11, 12) },
    { type: 'roll', characterId: 'c2', rollSkill: 'Discrétion', rollRaw: 15, rollResult: 19, createdAt: new Date(2026, 7, 11, 12) },
    { type: 'roll', characterId: 'c1', rollSkill: 'Perception', rollRaw: 18, rollResult: 22, createdAt: new Date(2026, 7, 11, 15) },
  ], {
    dateKeys: ['2026-08-11'],
    isCharacterLogExcluded: (charId, _date, log) => charId === 'c1' && log.createdAt.getTime() <= deletedAt,
  });

  assert.equal(result.byCharacter.c1.skills.Perception.trackedRolls, 1);
  assert.equal(result.byCharacter.c1.skills.Perception.resultTotal, 22);
  assert.equal(result.byCharacter.c2.skills.Discrétion.trackedRolls, 1);
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
    canonicalActions: 1,
    attackActions: 1,
    hits: 0,
    crits: 0,
    fumbles: 1,
    attackRolls: 1,
    attackRollTotal: 1,
    attackResultRolls: 1,
    attackResultTotal: 5,
    supplementalRolls: 0,
    supplementalNaturalTotal: 0,
    supplementalResultRolls: 0,
    supplementalResultTotal: 0,
    supplementalCrits: 0,
    supplementalFumbles: 0,
    damageEvents: 0,
    damageTotal: 0,
    biggestHit: 0,
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
    biggestHit: 0,
  });
  assert.deepEqual(aggregateActionAverages({ rolls: 0 }, correctedCombat), {
    rolls: 1,
    skillRolls: 0,
    combatRolls: 1,
    supplementalRolls: 0,
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

test('le nombre d actions de combat compte chaque attaque ou sort une seule fois', () => {
  const createdAt = new Date(2026, 7, 11, 12);
  const result = aggregateVttRollDetails([
    {
      type: 'attack-multi', sourceCharacterId: 'c1', hitD20: 14, hitTotal: 19,
      targets: Array.from({ length: 9 }, () => ({ hit: true, dmgTotal: 4 })), createdAt,
    },
    { type: 'cast', sourceCharacterId: 'c1', castEffect: 'Bouclier', createdAt },
    { type: 'affliction-cast', sourceCharacterId: 'c1', createdAt },
    { type: 'save', sourceCharacterId: 'c1', createdAt },
    { type: 'cast', sourceCharacterId: 'c1', actionUndone: true, createdAt },
    { type: 'attack', sourceCharacterId: 'c1', statsExcluded: true, createdAt },
  ]);

  assert.equal(result.byCharacter.c1.combat.canonicalActions, 3);
  assert.equal(result.byCharacter.c1.combat.attackActions, 1);
});

test('une compétence concernant plusieurs cibles reste un seul jet', () => {
  const result = aggregateVttRollDetails([{
    type: 'roll', characterId: 'c1', rollSkill: 'Intimidation',
    rollRaw: 16, rollResult: 21,
    targets: ['garde-1', 'garde-2', 'garde-3', 'garde-4'],
    createdAt: new Date(2026, 7, 11, 12),
  }]);

  assert.equal(result.byCharacter.c1.skills.Intimidation.trackedRolls, 1);
  assert.equal(result.byCharacter.c1.skills.Intimidation.naturalTotal, 16);
  assert.equal(result.byCharacter.c1.skills.Intimidation.resultTotal, 21);
});

test('un lancement de sort suivi de son attaque ne devient pas deux actions', () => {
  const base = new Date(2026, 7, 11, 12).getTime();
  const result = aggregateVttRollDetails([
    { type: 'affliction-cast', sourceCharacterId: 'c1', optLabel: 'Brûlure', createdAt: new Date(base) },
    { type: 'attack', sourceCharacterId: 'c1', optLabel: 'Brûlure', hitD20: 14, hitTotal: 19, createdAt: new Date(base + 2_000) },
    { type: 'affliction-cast', sourceCharacterId: 'c1', optLabel: 'Brûlure', createdAt: new Date(base + 20_000) },
    { type: 'attack', sourceCharacterId: 'c1', optLabel: 'Brûlure', hitD20: 11, hitTotal: 16, createdAt: new Date(base + 22_000) },
  ]);

  assert.equal(result.byCharacter.c1.combat.canonicalActions, 2);
});

test('les identifiants d action dédupliquent toutes les lignes techniques futures', () => {
  const createdAt = new Date(2026, 7, 11, 12);
  const result = aggregateVttRollDetails([
    { type: 'affliction-cast', sourceCharacterId: 'c1', statsActionId: 'action-1', optLabel: 'Brûlure', createdAt },
    { type: 'attack', sourceCharacterId: 'c1', statsActionId: 'action-1', optLabel: 'Brûlure', hitD20: 14, createdAt },
    { type: 'attack-multi', sourceCharacterId: 'c1', statsActionId: 'action-2', optLabel: 'Explosion', hitD20: 12, targets: [{ hit: true }, { hit: true }], createdAt },
  ]);

  assert.equal(result.byCharacter.c1.combat.canonicalActions, 2);
});

test('les anciennes lignes par cible d une même attaque sont regroupées', () => {
  const base = new Date(2026, 7, 11, 12).getTime();
  const result = aggregateVttRollDetails([
    { type: 'attack', sourceCharacterId: 'c1', optLabel: 'Double flèche', hitD20: 17, hitTotal: 23, createdAt: new Date(base) },
    { type: 'attack', sourceCharacterId: 'c1', optLabel: 'Double flèche', hitD20: 17, hitTotal: 23, createdAt: new Date(base + 300) },
  ]);

  assert.equal(result.byCharacter.c1.combat.canonicalActions, 1);
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
    biggestHit: 0,
  });
});

test('le journal remplace un ancien record et borne un snapshot concurrent', () => {
  const createdAt = new Date(2026, 7, 11, 12);
  const details = aggregateVttRollDetails([{
    type: 'attack', sourceCharacterId: 'c1', hitD20: 14, hitTotal: 19,
    hit: true, dmgTotal: 9, dmgApplied: 45, newHp: 55, createdAt,
  }]);
  assert.equal(details.byCharacter.c1.combat.damageTotal, 9);
  assert.equal(details.byCharacter.c1.combat.biggestHit, 9);

  const merged = mergeTrackedCombatStats(
    { attacks: 1, biggestHit: 53, damageEvents: 1, damageTotal: 53 },
    details.byCharacter.c1.combat,
  );
  assert.equal(merged.biggestHit, 9);
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
