import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  _calcAfflictionDot, _autoSourceAfflictionDot, _calcEnchantDegats,
  _hasLaceration, _calcLaceration, _calcChance, _calcDrainPct, _calcConcentrationDD,
} from '../assets/js/shared/spell-math.js';

const rep = (rune, n) => Array.from({ length: n }, () => rune);

test('_calcAfflictionDot : auto (1+Puiss)d4 +2, manuel prioritaire', () => {
  assert.equal(_calcAfflictionDot({}), '1d4 +2');
  assert.equal(_calcAfflictionDot({ runes: ['Puissance'] }), '2d4 +2');
  assert.equal(_calcAfflictionDot({ runes: rep('Puissance', 2) }), '3d4 +2');
  assert.equal(_calcAfflictionDot({ afflictionDotFormula: '5d6' }), '5d6');
});

test('_autoSourceAfflictionDot : libellé source', () => {
  assert.equal(_autoSourceAfflictionDot({}), '1 Affliction · base');
  assert.equal(_autoSourceAfflictionDot({ runes: ['Puissance'] }), '+1 Puiss · 1 dé bonus');
  assert.equal(_autoSourceAfflictionDot({ runes: rep('Puissance', 3) }), '+3 Puiss · 3 dés bonus');
});

test('_calcEnchantDegats : auto, manuel, vide en mode État', () => {
  assert.equal(_calcEnchantDegats({ runes: [] }), '1d4 +2');
  assert.equal(_calcEnchantDegats({ runes: ['Puissance'] }), '2d4 +2');
  assert.equal(_calcEnchantDegats({ runes: [], enchantDegats: '3d8' }), '3d8');
  assert.equal(_calcEnchantDegats({ runes: [], enchantMode: 'etat' }), '');
});

test('_hasLaceration : branche Affliction ou ancienne rune', () => {
  assert.equal(_hasLaceration({ runes: ['Lacération'] }), true);
  assert.equal(_hasLaceration({ runes: ['Affliction'], afflictionMode: 'laceration' }), true);
  assert.equal(_hasLaceration({ runes: ['Affliction'], afflictionMode: 'dot' }), false);
  assert.equal(_hasLaceration({ runes: [] }), false);
});

test('_calcLaceration : -1 CA par rune Affliction (branche), legacy idem', () => {
  assert.deepEqual(
    _calcLaceration({ runes: rep('Affliction', 2), afflictionMode: 'laceration' }),
    { runes: 2, reduction: 2, max: 2, maxElite: 4 },
  );
  assert.deepEqual(
    _calcLaceration({ runes: ['Lacération'] }),
    { runes: 1, reduction: 1, max: 2, maxElite: 4 },
  );
  assert.equal(_calcLaceration({ runes: ['Affliction'], afflictionMode: 'dot' }), null);
  assert.equal(_calcLaceration({ runes: [] }), null);
});

test('_calcChance : RC critique, plafonné à 17-20', () => {
  assert.deepEqual(_calcChance({ runes: ['Chance'] }), { runes: 1, rc: 19, reduction: 1, capped: false });
  assert.deepEqual(_calcChance({ runes: rep('Chance', 2) }), { runes: 2, rc: 18, reduction: 2, capped: false });
  assert.deepEqual(_calcChance({ runes: rep('Chance', 4) }), { runes: 4, rc: 17, reduction: 3, capped: true });
  assert.equal(_calcChance({ runes: [] }), null);
});

test('_calcDrainPct : 25% + 25% par Protection', () => {
  assert.equal(_calcDrainPct({ runes: ['Protection'] }), 0.5);
  assert.equal(_calcDrainPct({ runes: rep('Protection', 2) }), 0.75);
  assert.equal(_calcDrainPct({ runes: [] }), 0);
});

test('_calcConcentrationDD : 11 - 2×(n-1), minimum 5', () => {
  assert.equal(_calcConcentrationDD({ runes: ['Concentration'] }), 11);
  assert.equal(_calcConcentrationDD({ runes: rep('Concentration', 2) }), 9);
  assert.equal(_calcConcentrationDD({ runes: rep('Concentration', 3) }), 7);
  assert.equal(_calcConcentrationDD({ runes: rep('Concentration', 6) }), 5, 'plancher 5');
  assert.equal(_calcConcentrationDD({ runes: [] }), null);
});
