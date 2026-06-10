import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInventaire, inventaireNeedsNorm } from '../assets/js/shared/inventory-utils.js';

test('inventaireNeedsNorm : vrai dès qu’une entrée a qte > 1', () => {
  assert.equal(inventaireNeedsNorm([{ qte: 2 }]), true);
  assert.equal(inventaireNeedsNorm([{ qte: 1 }, { nom: 'X' }]), false);
  assert.equal(inventaireNeedsNorm([]), false);
  assert.equal(inventaireNeedsNorm(null), false);
});

test('normalizeInventaire : split une entrée qte=N en N entrées qte=1', () => {
  const out = normalizeInventaire([{ nom: 'Potion', qte: 3, rarete: 'commune' }]);
  assert.equal(out.length, 3);
  assert.ok(out.every(e => e.qte === 1));
  assert.ok(out.every(e => e.nom === 'Potion' && e.rarete === 'commune'), 'préserve les autres champs');
});

test('normalizeInventaire : idempotent (retourne le tableau d’origine si déjà normalisé)', () => {
  const inv = [{ nom: 'A', qte: 1 }, { nom: 'B' }];
  assert.equal(normalizeInventaire(inv), inv, 'même référence quand rien à faire');
});

test('normalizeInventaire : mix qte=1 et qte>1', () => {
  const out = normalizeInventaire([{ nom: 'A' }, { nom: 'B', qte: 2 }]);
  assert.equal(out.length, 3);
  assert.equal(out.filter(e => e.nom === 'B').length, 2);
});

test('normalizeInventaire : valeur non-tableau renvoyée telle quelle', () => {
  assert.equal(normalizeInventaire(null), null);
  assert.equal(normalizeInventaire(undefined), undefined);
});
