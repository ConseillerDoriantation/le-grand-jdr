import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runeCount, calcSpellTargets, calcSpellDuration } from '../assets/js/shared/spell-runes.js';

const sort = (runes = [], extra = {}) => ({ runes, ...extra });

test('runeCount compte les occurrences d’une rune', () => {
  assert.equal(runeCount(sort(['Puissance', 'Puissance', 'Durée']), 'Puissance'), 2);
  assert.equal(runeCount(sort([]), 'Puissance'), 0);
  assert.equal(runeCount({}, 'Puissance'), 0);
});

test('calcSpellTargets : Dispersion pilote le nombre de cibles (1 + nbDisp)', () => {
  assert.equal(calcSpellTargets(sort([])), 1, 'aucune rune → 1 cible');
  assert.equal(calcSpellTargets(sort(['Dispersion'])), 2);
  assert.equal(calcSpellTargets(sort(['Dispersion', 'Dispersion'])), 3);
});

test('calcSpellTargets : combos qui ramènent à 1 cible', () => {
  // Amplification + Dispersion → la Dispersion élargit la zone, pas le nb de cibles
  assert.equal(calcSpellTargets(sort(['Amplification', 'Dispersion'])), 1);
  // Sentinelle (Affliction + Invocation) + Dispersion → 1 (gérée par les sentinelles)
  assert.equal(calcSpellTargets(sort(['Affliction', 'Invocation', 'Dispersion'])), 1);
});

test('calcSpellTargets : Enchantement/Affliction seuls n’ajoutent pas de cible', () => {
  assert.equal(calcSpellTargets(sort(['Enchantement', 'Enchantement'])), 1);
  assert.equal(calcSpellTargets(sort(['Affliction', 'Affliction', 'Affliction'])), 1);
});

test('calcSpellDuration : base 2 tours, +2 par rune Durée', () => {
  assert.equal(calcSpellDuration(sort([])), 2);
  assert.equal(calcSpellDuration(sort(['Durée'])), 4);
  assert.equal(calcSpellDuration(sort(['Durée', 'Durée'])), 6);
});

test('calcSpellDuration : dureeBase explicite (≥ 2) sert de base', () => {
  assert.equal(calcSpellDuration(sort([], { dureeBase: 3 })), 3);
  assert.equal(calcSpellDuration(sort(['Durée'], { dureeBase: 3 })), 5);
  // dureeBase < 2 est ignoré (retombe sur 2)
  assert.equal(calcSpellDuration(sort([], { dureeBase: 1 })), 2);
});
