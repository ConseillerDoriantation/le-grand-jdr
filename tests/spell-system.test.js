import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getEnabledSpellResources,
  getSpellSystemConfig,
  getSpellSystemMode,
  invalidateSpellSystemCache,
  setSpellSystemForTests,
  spellRuneCost,
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

test('une ancienne configuration reçoit toutes les ressources et le barème lié', () => {
  setSpellSystemForTests({ mode: 'runes' });
  const config = getSpellSystemConfig();
  assert.deepEqual(config.enabledResources, ['pm', 'pv', 'or', 'garde', 'none']);
  assert.equal(config.costLinked, true);
  assert.deepEqual(config.costRates, { pv: 1, or: 5, garde: 1 });
});

test('la forge ne propose que les ressources actives mais conserve celle d’un ancien sort', () => {
  setSpellSystemForTests({ enabledResources: ['pm', 'or'] });
  assert.deepEqual(getEnabledSpellResources(), ['pm', 'or']);
  assert.deepEqual(getEnabledSpellResources('pv'), ['pm', 'pv', 'or']);
  assert.deepEqual(getEnabledSpellResources('inconnue'), ['pm', 'or']);
});

test('une sélection vide est réparée pour ne pas bloquer les forges', () => {
  setSpellSystemForTests({ enabledResources: [] });
  assert.deepEqual(getEnabledSpellResources(), ['pm', 'pv', 'or', 'garde', 'none']);
});

test('les taux sont ramenés aux pas autorisés et un barème libre reste délié', () => {
  setSpellSystemForTests({
    costRates: { pv: 1.4, or: 9, garde: 4.8 },
    costTable: { Puissance: { pv: 9 } },
  });
  const config = getSpellSystemConfig();
  assert.deepEqual(config.costRates, { pv: 1.5, or: 8, garde: 5 });
  assert.equal(config.costLinked, false);
  assert.equal(spellRuneCost('Puissance', 'pv'), 9);
});
