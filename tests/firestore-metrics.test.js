import test from 'node:test';
import assert from 'node:assert/strict';

import {
  firestoreMetricsSnapshot,
  metricCollectionName,
  recordFirestoreRead,
  recordFirestoreWrite,
  resetFirestoreMetrics,
} from '../assets/js/shared/firestore-metrics.js';

test('le diagnostic Firestore sépare réseau, cache et écritures sans écrire en base', () => {
  resetFirestoreMetrics();
  recordFirestoreRead('adventures/a/characters', 3, { listener: true, initial: true });
  recordFirestoreRead('adventures/a/characters', 1, { listener: true });
  recordFirestoreRead('adventures/a/shop/item', 1, { cache: true });
  recordFirestoreWrite('adventures/a/characters/c1', 2);

  const snapshot = firestoreMetricsSnapshot();
  assert.equal(snapshot.reads, 4);
  assert.equal(snapshot.initialListenerReads, 3);
  assert.equal(snapshot.lastMinute, 3);
  assert.equal(snapshot.cacheReads, 1);
  assert.equal(snapshot.writes, 2);
  assert.equal(snapshot.listenerSnapshots, 2);
  assert.equal(snapshot.byPath[0].initialReads, 3);
  assert.equal(snapshot.byPath[0].total, 4);
});

test('le diagnostic regroupe les accès par collection, documents confondus', () => {
  resetFirestoreMetrics();
  recordFirestoreWrite('adventures/a/vttTokens/t1', 2);
  recordFirestoreWrite('adventures/a/vttTokens/t2', 3);
  recordFirestoreWrite('adventures/a/stats/main', 1);
  recordFirestoreRead('adventures/a/vttTokens', 4, { listener: true });

  assert.equal(metricCollectionName('adventures/a/vttTokens/t1'), 'vttTokens');
  assert.equal(metricCollectionName('adventures/a/vttTokens'), 'vttTokens');
  assert.equal(metricCollectionName('users/u1'), 'users');
  assert.equal(metricCollectionName(''), 'inconnu');

  const { byCollection } = firestoreMetricsSnapshot();
  assert.deepEqual(byCollection[0], { collection: 'vttTokens', reads: 4, writes: 5, cacheReads: 0, docs: 3 });
  assert.equal(byCollection[1].collection, 'stats');
  assert.equal(byCollection[1].writes, 1);
});
