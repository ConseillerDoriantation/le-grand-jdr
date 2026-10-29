import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCharacterFormula } from '../assets/js/shared/character-rules.js';

test('opérateurs, précédence et fonctions math', () => {
  assert.equal(evaluateCharacterFormula('a + b * c', { a: 2, b: 3, c: 4 }), 14);
  assert.equal(evaluateCharacterFormula('(a + b) * c', { a: 2, b: 3, c: 4 }), 20);
  assert.equal(evaluateCharacterFormula('floor(max(0, x) * 2)', { x: 3 }), 6);
  assert.equal(evaluateCharacterFormula('min(0, m) + n', { m: -2, n: 5 }), 3);
  assert.equal(evaluateCharacterFormula('2 ^ 3 + 1', {}), 9);
  assert.equal(evaluateCharacterFormula('-a + 5', { a: 2 }), 3);
});

test('le cache de tokens NE fige PAS les variables (même formule, valeurs différentes)', () => {
  const f = 'armorBase + dexMod + equipCA';
  assert.equal(evaluateCharacterFormula(f, { armorBase: 10, dexMod: 3, equipCA: 4 }), 17);
  assert.equal(evaluateCharacterFormula(f, { armorBase: 10, dexMod: 0, equipCA: 0 }), 10);
  assert.equal(evaluateCharacterFormula(f, { armorBase: 12, dexMod: 5, equipCA: 2 }), 19);
  // appels répétés (chemin de cache) → résultat stable, jamais figé
  for (let i = 0; i < 5; i++) {
    assert.equal(evaluateCharacterFormula(f, { armorBase: 1, dexMod: 1, equipCA: 1 }), 3);
  }
});

test('une formule invalide retombe proprement sur le fallback', () => {
  assert.equal(evaluateCharacterFormula('a + ', { a: 1 }, 42), 42);   // syntaxe
  assert.equal(evaluateCharacterFormula('inconnue', {}, 7), 7);        // variable inconnue
  assert.equal(evaluateCharacterFormula('nope(1)', {}, 3), 3);         // fonction inconnue
  assert.equal(evaluateCharacterFormula('@', {}, 9), 9);               // caractère interdit (échec tokenisation)
});
