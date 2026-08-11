import test from 'node:test';
import assert from 'node:assert/strict';

import { buildJustifiedRows } from '../assets/js/shared/justified-layout.js';

const occupiedWidth = (row, gap) => row.items.reduce((sum, item) => sum + item.w, 0) + (row.items.length - 1) * gap;

test('la galerie évite de tasser trois paysages dans une rangée trop basse', () => {
  const items = [1, 2, 3].map(id => ({ id, aspectRatio: 16 / 9 }));
  const rows = buildJustifiedRows(items, 1200, 300, 10);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].items.length, 2);
  assert.equal(rows[0].h, 335);
  assert.ok(Math.abs(occupiedWidth(rows[0], 10) - 1200) <= 1);
  assert.equal(rows[1].h, 300);
});

test('la galerie mobile privilégie une image lisible par rangée', () => {
  const items = [1, 2, 3].map(id => ({ id, aspectRatio: 16 / 9 }));
  const rows = buildJustifiedRows(items, 316, 150, 10);

  assert.deepEqual(rows.map(row => row.items.length), [1, 1, 1]);
  assert.deepEqual(rows.map(row => row.h), [178, 178, 150]);
});

test('une dernière image panoramique reste contenue dans la galerie', () => {
  const [row] = buildJustifiedRows([{ id: 1, aspectRatio: 5 }], 900, 300, 10);

  assert.equal(row.h, 180);
  assert.equal(row.items[0].w, 900);
});

test('un ratio invalide retombe sur le format 4:3', () => {
  const [row] = buildJustifiedRows([{ id: 1, aspectRatio: 0 }], 900, 240, 10);

  assert.equal(row.h, 240);
  assert.equal(row.items[0].w, 320);
});
