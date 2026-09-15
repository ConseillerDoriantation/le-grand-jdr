import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareManualOrder,
  manualOrderValue,
  mergeVisibleManualOrder,
  nextManualOrder,
} from '../assets/js/shared/manual-order.js';

test('le tri manuel privilégie ordre et garde un repli alphabétique déterministe', () => {
  const items = [
    { id: 'c', nom: 'Cape' },
    { id: 'b', nom: 'Bouclier', ordre: 1 },
    { id: 'a', nom: 'Arc', ordre: 0 },
    { id: 'd', nom: 'Anneau' },
  ];
  assert.deepEqual([...items].sort(compareManualOrder).map(item => item.id), ['a', 'b', 'd', 'c']);
});

test('un ordre visible est réinjecté sans déplacer les articles filtrés', () => {
  const items = ['a', 'x', 'b', 'y', 'c'].map(id => ({ id }));
  const result = mergeVisibleManualOrder(items, ['c', 'a', 'b']);
  assert.deepEqual(result.map(item => item.id), ['c', 'x', 'a', 'y', 'b']);
});

test('le prochain article est placé après le plus grand ordre existant', () => {
  assert.equal(nextManualOrder([{ ordre: 2 }, { ordre: 8 }, { ordre: '' }]), 9);
  assert.equal(nextManualOrder([]), 0);
});

test('une valeur absente ne devient pas artificiellement l ordre zéro', () => {
  assert.equal(manualOrderValue({ ordre: null }), null);
  assert.equal(manualOrderValue({ ordre: '' }), null);
  assert.equal(manualOrderValue({ ordre: 0 }), 0);
});
