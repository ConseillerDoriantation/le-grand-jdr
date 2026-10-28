import test from 'node:test';
import assert from 'node:assert/strict';
import { timeAgo, toMillis } from '../assets/js/shared/relative-time.js';

const MIN = 60_000, H = 60 * MIN, J = 24 * H;

test('timeAgo rend un libellé compact selon l’ancienneté', () => {
  assert.equal(timeAgo(Date.now() - 20_000), 'à l’instant');   // < 1 min
  assert.equal(timeAgo(Date.now() - 5 * MIN), '5 min');
  assert.equal(timeAgo(Date.now() - 3 * H), '3 h');
  assert.equal(timeAgo(Date.now() - 2 * J), '2 j');
});

test('une date future ou l’horloge en avance ne donne jamais de valeur négative', () => {
  assert.equal(timeAgo(Date.now() + 10 * MIN), 'à l’instant');
});

test('accepte un Timestamp Firestore et une chaîne ISO', () => {
  assert.equal(timeAgo({ toMillis: () => Date.now() - 2 * H }), '2 h');
  const iso = new Date(Date.now() - 90 * MIN).toISOString();
  assert.equal(timeAgo(iso), '1 h');
});

test('une date absente ou illisible renvoie le repli, jamais "NaN"', () => {
  // Le bug historique : Date.parse('') === NaN, que `?? 0` ne rattrapait pas.
  for (const bad of [undefined, null, '', 'pas une date', 0, -5, NaN]) {
    const out = timeAgo(bad);
    assert.equal(out, 'récemment', `entrée ${String(bad)}`);
    assert.ok(!out.includes('NaN'));
  }
  assert.equal(timeAgo(undefined, { invalid: '—' }), '—');
  assert.ok(Number.isNaN(toMillis('')));
});
