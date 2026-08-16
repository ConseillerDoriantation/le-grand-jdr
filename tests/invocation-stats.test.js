import test from 'node:test';
import assert from 'node:assert/strict';

import { getModFromScore } from '../assets/js/shared/char-stats.js';
import { calculateInvocationDerivedStats, calculateSummonStats, getPreparedInvocationActions, invocationStatModifier, normalizeInvocationStats } from '../assets/js/shared/invocation-stats.js';

test('une ancienne invocation reçoit les nouvelles valeurs par défaut', () => {
  const stats = normalizeInvocationStats({ attaque: '2d6', toucher: 3, pv: 18, ca: 12 });

  assert.equal(stats.attaque, '2d6');
  assert.equal(stats.portee, 1);
  assert.equal(stats.toucherStat, 'force');
  assert.equal(stats.degatsStat, 'force');
  assert.deepEqual(
    [stats.force, stats.dexterite, stats.constitution, stats.intelligence, stats.sagesse, stats.charisme],
    [10, 10, 10, 10, 10, 10],
  );
});

test('les valeurs de base explicites de l invocation sont conservées', () => {
  const stats = normalizeInvocationStats({
    portee: 7, deplacement: 5, pmMax: 12, usesOwnMana: true,
    toucherStat: 'dexterite', degatsStat: 'intelligence',
    force: 8, dexterite: 16, constitution: 14, intelligence: 18, sagesse: 12, charisme: 6,
  });

  assert.equal(stats.portee, 7);
  assert.equal(stats.usesOwnMana, true);
  assert.equal(stats.toucherStat, 'dexterite');
  assert.equal(stats.degatsStat, 'intelligence');
  assert.equal(invocationStatModifier(stats, 'dexterite'), getModFromScore(16));
  assert.equal(invocationStatModifier(stats, 'intelligence'), getModFromScore(18));
});

test('les bonus de runes complètent les valeurs de base sans modifier portée ni caractéristiques', () => {
  const invocation = { stats: {
    attaque: '1d8 +1', toucher: 1, pv: 20, ca: 13, deplacement: 4, pmMax: 6, portee: 5, usesOwnMana: true,
    toucherStat: 'dexterite', degatsStat: 'sagesse',
    force: 8, dexterite: 16, constitution: 14, intelligence: 10, sagesse: 18, charisme: 12,
  } };
  const base = calculateInvocationDerivedStats(invocation);
  const result = calculateSummonStats(invocation, ['Puissance', 'Chance', 'Protection', 'Amplification', 'Durée']);

  assert.equal(result.attaque, '2d8 +1');
  assert.equal(result.toucher, 3);
  assert.equal(result.pv, base.pv + 5);
  assert.equal(result.ca, base.ca);
  assert.equal(result.deplacement, base.deplacement + 3);
  assert.equal(result.duree, 4);
  assert.equal(result.portee, 5);
  assert.equal(result.usesOwnMana, true);
  assert.equal(result.toucherStat, 'dexterite');
  assert.equal(result.degatsStat, 'sagesse');
  assert.equal(result.stats.dexterite, 16);
  assert.equal(result.stats.sagesse, 18);
});

test('le niveau et les caractéristiques calculent les ressources et le Deck', () => {
  const levelOne = calculateInvocationDerivedStats({ stats: {
    niveau: 1, pv: 12, pmMax: 8, ca: 10, deplacement: 3,
    force: 14, dexterite: 16, constitution: 14, intelligence: 16, sagesse: 14,
  } });
  const levelFive = calculateInvocationDerivedStats({ stats: {
    niveau: 5, pv: 12, pmMax: 8, ca: 10, deplacement: 3,
    force: 14, dexterite: 16, constitution: 14, intelligence: 16, sagesse: 14,
  } });

  assert.ok(levelFive.pv >= levelOne.pv);
  assert.ok(levelFive.pmMax >= levelOne.pmMax);
  assert.ok(levelFive.deckMax >= levelOne.deckMax);
  assert.ok(levelOne.ca > 10);
  assert.ok(Number.isFinite(levelOne.deplacement));
});

test('seuls les sorts préparés dans la capacité du Deck sont transmis au VTT', () => {
  const invocation = {
    stats: { niveau: 1, intelligence: 10 },
    actions: [
      { nom: 'A', invocationPrepared: true },
      { nom: 'B', invocationPrepared: false },
      { nom: 'C' },
      { nom: 'D' },
      { nom: 'E' },
    ],
  };
  const deckMax = calculateInvocationDerivedStats(invocation).deckMax;
  const prepared = getPreparedInvocationActions(invocation);

  assert.equal(prepared.includes(invocation.actions[1]), false);
  assert.equal(prepared.length, Math.min(deckMax, 4));
});

test('les bornes empêchent des valeurs par défaut injouables', () => {
  const stats = normalizeInvocationStats({ pv: 0, ca: -4, deplacement: -2, portee: 0, pmMax: -8, force: 0 });

  assert.equal(stats.pv, 1);
  assert.equal(stats.ca, 0);
  assert.equal(stats.deplacement, 0);
  assert.equal(stats.portee, 1);
  assert.equal(stats.pmMax, 0);
  assert.equal(stats.usesOwnMana, false);
  assert.equal(stats.force, 1);
});
