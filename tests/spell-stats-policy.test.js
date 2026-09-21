import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldTrackSpellStats } from '../assets/js/shared/spell-stats-policy.js';

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
