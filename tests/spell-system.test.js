import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSpellSystemMode,
  invalidateSpellSystemCache,
  setSpellSystemForTests,
} from '../assets/js/shared/spell-system.js';

test('le système de sorts est à runes par défaut', () => {
  invalidateSpellSystemCache();
  assert.equal(getSpellSystemMode(), 'runes');
});

test('le système classique est isolé dans la configuration courante', () => {
  setSpellSystemForTests('classic');
  assert.equal(getSpellSystemMode(), 'classic');
  setSpellSystemForTests('valeur-inconnue');
  assert.equal(getSpellSystemMode(), 'runes');
});
