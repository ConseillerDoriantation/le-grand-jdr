import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCombatCorrectionDeltas } from '../assets/js/shared/stats-corrections.js';

test('corriger les dégâts subis produit le même delta pour le total des dégâts', () => {
  assert.deepEqual(buildCombatCorrectionDeltas({
    dmgTaken: 2107,
    damageTakenTotal: 2107,
    attacksTaken: 3,
    kosTaken: 1,
  }, {
    dmgTaken: 41,
    attacksTaken: 3,
    kosTaken: 0,
  }), {
    dmgTaken: -2066,
    kosTaken: -1,
    damageTakenTotal: -2066,
  });
});

test('les champs inconnus sont ignorés et les valeurs restent positives', () => {
  assert.deepEqual(buildCombatCorrectionDeltas({ heal: 5 }, {
    heal: -10,
    arbitraryFirestorePath: 999,
  }), { heal: -5 });
});

test('une correction identique ne génère aucune écriture', () => {
  assert.deepEqual(buildCombatCorrectionDeltas({ attacksTaken: 3 }, { attacksTaken: 3 }), {});
});
