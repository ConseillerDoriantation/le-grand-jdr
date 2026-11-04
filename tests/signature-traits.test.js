import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_SIGNATURE_TRAITS, normalizeTraitName, signatureSet,
  isSignatureTrait, partitionTraits, parseSignatureInput,
} from '../assets/js/shared/signature-traits.js';

const root = new URL('../', import.meta.url);
const artisan = readFileSync(new URL('assets/js/features/artisan.js', root), 'utf8');
const upg = readFileSync(new URL('assets/js/shared/upgrade-settings.js', root), 'utf8');

test('défaut : aucune signature', () => {
  assert.deepEqual(DEFAULT_SIGNATURE_TRAITS, []);
});

test('normalisation : casse + accents + espaces ignorés', () => {
  assert.equal(normalizeTraitName('  Lame de l’Aube  '), 'lame de l’aube');
  assert.equal(normalizeTraitName('Épée'), 'epee');
  assert.equal(normalizeTraitName(null), '');
});

test('isSignatureTrait : comparaison souple', () => {
  const list = ['Souffle du Dragon'];
  assert.equal(isSignatureTrait('souffle du dragon', list), true);
  assert.equal(isSignatureTrait('SOUFFLE  du dragon'.replace('  ', ' '), list), true);
  assert.equal(isSignatureTrait('Tranchant', list), false);
  assert.equal(isSignatureTrait('', list), false);
  assert.equal(isSignatureTrait('x', null), false);
});

test('signatureSet : dédup + vides exclus', () => {
  const set = signatureSet(['A', 'a', '  ', 'B']);
  assert.equal(set.size, 2);
  assert.ok(set.has('a') && set.has('b'));
});

test('partitionTraits : sépare transférables et signature', () => {
  const { transferable, signature } = partitionTraits(
    ['Tranchant', 'Lame de l’Aube', 'Robuste'], ['lame de l’aube']);
  assert.deepEqual(transferable, ['Tranchant', 'Robuste']);
  assert.deepEqual(signature, ['Lame de l’Aube']);
});

test('partitionTraits : liste vide → tout transférable', () => {
  const { transferable, signature } = partitionTraits(['A', 'B'], []);
  assert.deepEqual(transferable, ['A', 'B']);
  assert.deepEqual(signature, []);
});

test('parseSignatureInput : multi-lignes / virgules, trim, dédup', () => {
  assert.deepEqual(parseSignatureInput('A\nB, C ; A\n\n'), ['A', 'B', 'C']);
  assert.deepEqual(parseSignatureInput(''), []);
  assert.deepEqual(parseSignatureInput(null), []);
});

test('câblage artisan : filtre signature au recyclage', () => {
  // Partition appliquée dans le flux de recyclage + garde-fou direct.
  assert.match(artisan, /partitionTraits\(allTraits, s\.signatureTraits\)/);
  assert.match(artisan, /traitsToExtract = partitionTraits\(traitsToExtract, s\.signatureTraits\)\.transferable/);
  // On ne propose à l'extraction que les traits transférables.
  assert.match(artisan, /return _artisanDoDestroy\(invIndex, transferable\)/);
  assert.match(artisan, /return _artisanDoDestroy\(invIndex, \[\]\)/); // tout signature → 0 fragment
});

test('câblage config : signatureTraits par aventure + admin éditable', () => {
  assert.match(upg, /signatureTraits: DEFAULT_SIGNATURE_TRAITS/);
  assert.match(upg, /signatureTraits: Array\.isArray\(stored\.signatureTraits\)/);
  assert.match(upg, /data-field="signatureTraits"/);
  assert.match(upg, /_upgList: \(el\) => _upgSetField\(el\.dataset\.field, parseSignatureInput\(el\.value\)\)/);
});
