import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeSimulatedNatural, rollDiceGroups, simulatedDiceSlots, validateSimulatedValues,
} from '../assets/js/features/vtt/vtt-dice-simulation.js';

test('les valeurs naturelles simulées restent dans les bornes du dé', () => {
  assert.equal(normalizeSimulatedNatural('1', 20), 1);
  assert.equal(normalizeSimulatedNatural(20, 20), 20);
  assert.equal(normalizeSimulatedNatural(0, 20), null);
  assert.equal(normalizeSimulatedNatural(21, 20), null);
  assert.equal(normalizeSimulatedNatural(4.5, 20), null);
  assert.equal(normalizeSimulatedNatural('', 20), null);
});

test('un jet simulé multi-dés respecte chaque valeur naturelle', () => {
  const formula = { 6: 3, 4: 1 };
  const slots = simulatedDiceSlots(formula, 'normal');
  assert.deepEqual(slots.map(slot => slot.faces), [6, 6, 6, 4]);
  assert.deepEqual(validateSimulatedValues(slots, [6, 2, 4, 3]), [6, 2, 4, 3]);

  const result = rollDiceGroups(formula, 'normal', { simulatedValues: [6, 2, 4, 3] });
  assert.equal(result.total, 15);
  assert.deepEqual(result.groups, [
    { faces: 6, count: 3, rolls: [6, 2, 4], subtotal: 12 },
    { faces: 4, count: 1, rolls: [3], subtotal: 3 },
  ]);
});

test('avantage et désavantage exposent les deux d20 simulés', () => {
  assert.equal(simulatedDiceSlots({ 20: 1 }, 'advantage').length, 2);
  const advantage = rollDiceGroups({ 20: 1 }, 'advantage', { simulatedValues: [4, 17] });
  assert.equal(advantage.total, 17);
  assert.equal(advantage.groups[0].kept, 17);
  assert.deepEqual(advantage.groups[0].rolls, [4, 17]);

  const disadvantage = rollDiceGroups({ 20: 1 }, 'disadvantage', { simulatedValues: [4, 17] });
  assert.equal(disadvantage.total, 4);
  assert.equal(disadvantage.groups[0].kept, 4);
});

test('un jet simulé incomplet ou invalide est refusé', () => {
  assert.throws(
    () => rollDiceGroups({ 8: 2 }, 'normal', { simulatedValues: [8] }),
    /Chaque dé simulé/,
  );
  assert.throws(
    () => rollDiceGroups({ 8: 1 }, 'normal', { simulatedValues: [9] }),
    /Chaque dé simulé/,
  );
});

test('le mode simulé est public, signalé dans le chat et exclu des stats', async () => {
  const [dice, emotes, chat, vtt] = await Promise.all([
    readFile(new URL('../assets/js/features/vtt/vtt-dice.js', import.meta.url), 'utf8'),
    readFile(new URL('../assets/js/features/vtt/vtt-emotes.js', import.meta.url), 'utf8'),
    readFile(new URL('../assets/js/features/vtt/vtt-chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../assets/js/features/vtt/vtt.js', import.meta.url), 'utf8'),
  ]);
  assert.match(dice, /const gmOnly = simulated \? false/);
  assert.match(emotes, /const gmOnly = simulated \? false/);
  assert.match(emotes, /&& !simulated\) bumpSkill/);
  assert.match(dice, /statsExcluded: simulated/);
  assert.match(emotes, /statsExcluded: simulated/);
  assert.match(chat, /SIMULÉ MJ/);
  assert.match(vtt, /Dé simulé MJ/);
  assert.match(vtt, /statsExcluded: opt\?\.countInStats === false \|\| simulated/);
  assert.match(vtt, /simulated: true/);
  assert.match(vtt, /actionSimulation \? null : await _consumeLuckyReroll/);
  assert.match(vtt, /_rollDiceDetailedWithValues\(effectiveDice, actionSimulation\.effect\)/);
});
