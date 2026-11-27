import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFresqueLayout } from '../assets/js/shared/justified-layout.js';

const rowWidth = (cells, gap) => cells.reduce((sum, cell) => sum + cell.w, 0) + Math.max(0, cells.length - 1) * gap;
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, message || `${actual} ≃ ${expected}`);
const rowsByY = cells => cells.reduce((rows, cell) => {
  const row = rows.get(cell.y) || [];
  row.push(cell);
  rows.set(cell.y, row);
  return rows;
}, new Map());

test('les rangées pleines restent proches de la hauteur cible et occupent exactement la largeur', () => {
  const gap = 8, width = 1280;
  const result = buildFresqueLayout(
    Array.from({ length: 12 }, (_, index) => ({ id: `i${index}`, ratio: [1.5, 1.2, .95, 1.8][index % 4] })),
    { width, height: 270, gap, features: false },
  );
  assert.ok(result.rowHeights.length >= 2);
  result.rowHeights.forEach(height => assert.ok(Math.abs(height - 270) <= 270 * .20));
  [...rowsByY(result.cells).values()].forEach(row => assert.ok(row.every(cell => cell.h === row[0].h)));
  [...rowsByY(result.cells).values()].forEach(cells => near(rowWidth(cells, gap), width));
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
  const top = desktop.cells.find(entry => entry.x > cell.x && entry.y === cell.y);
  const bottom = desktop.cells.find(entry => entry.x === top.x && entry.y > top.y);
  near(cell.h, top.h + 8 + bottom.h);
  near(cell.w / cell.h, items[0].ratio);
});

test('la mise à la une ne crée pas de bloc sur deux rangées sous 760 px', () => {
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

test('dans une catégorie, mettre une carte à la une ne réordonne ni ses voisines ni le DOM', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, ratio: i === 1 ? .8 : 1.2 }));
  const options = { width: 1200, height: 240, gap: 8, preserveOrder: true };
  const expected = items.map(i => i.id);
  for (const featuredIndex of [1, 7, 9]) {
    const layout = buildFresqueLayout(items.map((item, index) => ({ ...item, featured: index === featuredIndex })), options);
    assert.deepEqual(layout.cells.map(c => c.id), expected);
    assert.deepEqual([...layout.cells].sort((a, b) => a.y - b.y || a.x - b.x).map(c => c.id), expected);
    layout.cells.forEach(cell => near(cell.w / cell.h, cell.item.ratio));
  }
});

test('une vedette au milieu de la première rangée ne coupe pas la rangée', () => {
  const items = Array.from({ length: 10 }, (_, index) => ({ id: index, ratio: index === 1 ? .7 : 1.15, featured: index === 1 }));
  const { cells } = buildFresqueLayout(items, { width: 1200, height: 240, preserveOrder: true });
  const firstRow = cells.filter(cell => cell.y === 0);
  assert.ok(firstRow.length > 2);
  assert.equal(firstRow[1].item.featured, true);
  near(rowWidth(firstRow, 8), 1200);
});

test('des vedettes successives ne créent pas de trous dans les rangées intermédiaires', () => {
  const items = Array.from({ length: 24 }, (_, index) => ({
    id: index, ratio: [.55, .8, 1, 1.4, 1.8, 2.2][index % 6], featured: [1, 2, 4, 5, 6, 12, 16, 22, 23].includes(index),
  }));
  const gap = 8;
  for (const [width, height] of [[820, 220], [1200, 240], [1820, 300], [2380, 198]]) {
    const { cells } = buildFresqueLayout(items, { width, height, gap, preserveOrder: true });
    const levels = [...rowsByY(cells).keys()];
    assert.deepEqual(cells.map(cell => cell.id), items.map(item => item.id));
    levels.slice(0, -1).forEach(y => {
      const tiles = cells.filter(cell => cell.y <= y && cell.y + cell.h > y).sort((a, b) => a.x - b.x);
      assert.equal(tiles[0].x, 0);
      near(tiles.at(-1).x + tiles.at(-1).w, width, `rangée incomplète à ${y}px sur ${width}px`);
      tiles.slice(1).forEach((tile, index) => near(tile.x - tiles[index].x - tiles[index].w, gap));
    });
  }
});

test('une vedette qui peut partager deux rangées remplit le bloc sans réordonner les cartes', () => {
  const items = [
    { id: 'featured', ratio: .8, featured: true },
    ...Array.from({ length: 9 }, (_, index) => ({ id: `n${index}`, ratio: index % 2 ? 1.5 : 1 })),
  ];
  const { cells } = buildFresqueLayout(items, { width: 1200, height: 240, preserveOrder: true });
  assert.equal(cells[0].featured, true);
  assert.ok(cells[0].h > 240 * 1.5);
  assert.deepEqual([...cells].sort((a, b) => a.y - b.y || a.x - b.x).map(cell => cell.id), items.map(item => item.id));
});

test('portraits et panoramas gardent leur ratio, même mis à la une sur petit écran', () => {
  const items = [.31, .75, .9, 1, 4.6, 2.4, .45, 1.78, 3.2, 1.32].map((ratio, id) => ({ id, ratio, featured: id % 2 === 0 }));
  for (const [width, height] of [[320, 200], [820, 220], [1200, 270], [2380, 300]]) {
    const layout = buildFresqueLayout(items, { width, height, preserveOrder: true });
    layout.cells.forEach(cell => {
      near(cell.w / cell.h, cell.item.ratio);
      assert.ok(cell.x >= 0 && cell.x + cell.w <= width + 1e-8);
    });
  }
});

test('deux cartes à la une côte à côte grandissent toutes les deux sans déplacer les autres', () => {
  const items = [1.3, .8, .8, 1.3, 1.2, 1.4, 1.4, 1.3, 1.1, 1.3, 1.1].map((ratio, id) => ({ id, ratio }));
  const marked = items.map(item => ({ ...item, featured: item.id === 1 || item.id === 2 }));
  for (const preserveOrder of [true, false]) {
    const options = { width: 1200, height: 240, gap: 8, preserveOrder };
    const ordinary = buildFresqueLayout(items, options).cells;
    const featured = buildFresqueLayout(marked, options).cells;
    for (const id of [1, 2]) {
      const card = featured.find(cell => cell.id === id);
      assert.ok(card.h > ordinary.find(cell => cell.id === id).h * 1.3);
      near(card.w / card.h, card.item.ratio);
    }
    assert.deepEqual(featured.map(cell => cell.id), items.map(item => item.id));
    near(rowWidth(featured.filter(cell => cell.y === featured[1].y), 8), 1200);
  }
});

test('une catégorie de deux portraits peut les agrandir sans les étirer sur toute la largeur', () => {
  const items = [{ id: 'a', ratio: .7, featured: true }, { id: 'b', ratio: .8, featured: true }];
  const options = { width: 1400, height: 260, preserveOrder: true };
  const layout = buildFresqueLayout(items, options);
  for (const card of layout.cells) {
    assert.equal(card.y, 0);
    assert.ok(card.h > options.height && card.h < options.height * 1.6);
    near(card.w / card.h, card.item.ratio);
  }
  near(layout.tail.x + layout.tail.w, options.width);
});

test('un portrait peut rester grand à côté de deux panoramas empilés, sans cadrage ni trou', () => {
  const items = [.6, 3.1, 3.1, .55, 3.2, 3.2, 1.4, 1.45].map((ratio, id) => ({ id, ratio }));
  const gap = 8, width = 1200, height = 270;
  const { cells } = buildFresqueLayout(items, { width, height, gap, preserveOrder: true });
  const [portrait, top, bottom] = cells;
  assert.ok(portrait.h > height * 1.5);
  assert.equal(portrait.featured, undefined);
  near(top.y, portrait.y);
  near(bottom.y, top.y + top.h + gap);
  near(portrait.h, top.h + gap + bottom.h);
  near(top.x, portrait.w + gap);
  near(bottom.x, top.x);
  near(top.x + top.w, width);
  near(bottom.x + bottom.w, width);
  cells.forEach(cell => near(cell.w / cell.h, cell.item.ratio));
  assert.deepEqual(cells.map(cell => cell.id), items.map(item => item.id));
});

test('les rangées simples évitent de comprimer les portraits au milieu des paysages', () => {
  const items = [2.2, .55, 2.4, 1.4, .7, 1.7, .8, 2.5, 3.8, .6, .75, 1.8].map((ratio, id) => ({ id, ratio }));
  const { cells } = buildFresqueLayout(items, { width: 950, height: 270, preserveOrder: true });
  assert.ok(cells.find(cell => cell.id === 1).w >= 145);
  assert.ok(cells.find(cell => cell.id === 4).w >= 190);
  assert.deepEqual([...cells].sort((a, b) => a.y - b.y || a.x - b.x).map(cell => cell.id), items.map(item => item.id));
});
