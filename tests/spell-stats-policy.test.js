import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySpellStatKinds, shouldTrackSpellStats } from '../assets/js/shared/spell-stats-policy.js';

test('un sort normal reste compté par défaut', () => {
  assert.equal(shouldTrackSpellStats({}, { source: 'spell' }), true);
});

test('une ancienne action d objet est exclue par défaut', () => {
  assert.equal(shouldTrackSpellStats({}, { source: 'item' }), false);
});

test('le choix explicite du MJ prime sur la provenance', () => {
  assert.equal(shouldTrackSpellStats({ countInStats: true }, { source: 'item' }), true);
  assert.equal(shouldTrackSpellStats({ countInStats: false }, { source: 'spell' }), false);
});

test('l ancien drapeau d exclusion reste lisible', () => {
  assert.equal(shouldTrackSpellStats({ excludeFromStats: true }, { source: 'spell' }), false);
});

test('une attaque de zone reste offensive et ne devient pas tactique', () => {
  const kinds = classifySpellStatKinds({
    zoneW: 5,
    zoneH: 5,
    mods: { zone: { shape: 'square' } },
  });
  assert.equal(kinds.tactical, false);
  assert.equal(kinds.support, false);
  assert.equal(kinds.control, false);
});

test('un soin de zone utilise sa métrique de soin sans devenir tactique', () => {
  const kinds = classifySpellStatKinds({ isHeal: true, zoneW: 3, zoneH: 3 });
  assert.equal(kinds.tactical, false);
  assert.equal(kinds.control, false);
});

test('invocations déplacements et sorts utilitaires sont tactiques', () => {
  assert.equal(classifySpellStatKinds({ isInvocation: true }).tactical, true);
  assert.equal(classifySpellStatKinds({ isDeplacement: true, isUtil: true }).tactical, true);
  assert.equal(classifySpellStatKinds({ isUtil: true }).tactical, true);
  assert.equal(classifySpellStatKinds({ mods: { sentinelle: {} } }).tactical, true);
});

test('une régénération reste du soutien sans compter en tactique', () => {
  const kinds = classifySpellStatKinds({ isRegen: true, isUtil: true, mods: { regeneration: {} } });
  assert.equal(kinds.support, true);
  assert.equal(kinds.tactical, false);
});
