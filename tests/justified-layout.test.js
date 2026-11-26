import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFresqueLayout } from '../assets/js/shared/justified-layout.js';

const rowWidth = (cells, gap) => cells.reduce((sum, cell) => sum + cell.w, 0) + Math.max(0, cells.length - 1) * gap;
const rowsByY = cells => cells.reduce((rows, cell) => {
  const row = rows.get(cell.y) || [];
  row.push(cell);
  rows.set(cell.y, row);
  return rows;
}, new Map());

test('les rangées pleines gardent la hauteur cible et occupent exactement la largeur', () => {
  const gap = 8;
  const result = buildFresqueLayout(
    Array.from({ length: 12 }, (_, index) => ({ id: `i${index}`, ratio: [1.5, 1.2, .8, 1.8][index % 4] })),
    { width: 1200, height: 270, gap, features: false },
  );
  assert.ok(result.rowHeights.length >= 2);
  result.rowHeights.forEach(height => assert.ok(Math.abs(height - 270) <= 270 * .12));
  [...rowsByY(result.cells).values()].forEach(row => assert.ok(row.every(cell => cell.h === row[0].h)));
  [...rowsByY(result.cells).values()].slice(0, -1).forEach(cells => assert.equal(rowWidth(cells, gap), 1200));
});

test('la dernière rangée reste en drapeau et expose son espace libre', () => {
  const result = buildFresqueLayout(
    [{ id: 'a', ratio: 1 }, { id: 'b', ratio: 1 }, { id: 'c', ratio: 1 }],
    { width: 1200, height: 260, gap: 8, features: false },
  );
  assert.equal(result.cells.every(cell => cell.h === 260), true);
  assert.ok(result.tail);
  assert.ok(result.tail.w > 300);
  assert.equal(result.tail.x + result.tail.w, 1200);
});

test('une image à la une occupe deux rangées sur desktop', () => {
  const items = [
    { id: 'featured', ratio: .8, featured: true },
    ...Array.from({ length: 9 }, (_, index) => ({ id: `n${index}`, ratio: index % 2 ? 1.5 : 1 })),
  ];
  const desktop = buildFresqueLayout(items, { width: 1200, height: 240, gap: 8 });
  const cell = desktop.cells.find(entry => entry.id === 'featured');
  assert.equal(cell.featured, true);
  assert.equal(cell.h, 488);
});

test('la mise à la une se replie en tuile normale sous 760 px', () => {
  const items = [{ id: 'featured', ratio: .8, featured: true }, ...Array.from({ length: 6 }, (_, index) => ({ id: `n${index}`, ratio: 1 }))];
  const mobile = buildFresqueLayout(items, { width: 600, height: 200, gap: 5 });
  const cell = mobile.cells.find(entry => entry.id === 'featured');
  assert.equal(cell.featured, undefined);
  assert.ok(cell.h < 405);
});

test('un ratio invalide retombe sur le format 4:3', () => {
  const result = buildFresqueLayout([{ id: 'bad', ratio: 0 }], { width: 900, height: 240, gap: 8, features: false });
  assert.equal(result.cells[0].ratio, 4 / 3);
  assert.equal(result.cells[0].h, 240);
  assert.ok(result.cells[0].w > 300);
});
