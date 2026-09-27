import test from 'node:test';
import assert from 'node:assert/strict';

import {
  firestoreMetricsSnapshot,
  recordFirestoreRead,
  recordFirestoreWrite,
  resetFirestoreMetrics,
} from '../assets/js/shared/firestore-metrics.js';

test('le diagnostic Firestore sépare réseau, cache et écritures sans écrire en base', () => {
  resetFirestoreMetrics();
  recordFirestoreRead('adventures/a/characters', 3, { listener: true });
  recordFirestoreRead('adventures/a/shop/item', 1, { cache: true });
  recordFirestoreWrite('adventures/a/characters/c1', 2);

  const snapshot = firestoreMetricsSnapshot();
  assert.equal(snapshot.reads, 3);
  assert.equal(snapshot.cacheReads, 1);
  assert.equal(snapshot.writes, 2);
  assert.equal(snapshot.listenerSnapshots, 1);
  assert.equal(snapshot.byPath[0].total, 3);
});
