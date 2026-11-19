import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rangeApproach, rangeAttackCells, rangeContour, rangeMoveCells, rangeWallHit,
} from '../assets/js/features/vtt/vtt-range-utils.js';

test('rangeContour: une case produit une boucle de quatre sommets', () => {
  const loops = rangeContour(new Set(['2,3']));
  assert.equal(loops.length, 1);
  assert.equal(loops[0].length, 4);
});

test('rangeContour: un diamant de rayon 2 reste une seule boucle', () => {
  const cells = new Set();
  for (let c = -2; c <= 2; c++) for (let r = -2; r <= 2; r++) if (Math.abs(c) + Math.abs(r) <= 2) cells.add(`${c},${r}`);
  assert.equal(rangeContour(cells).length, 1);
});

test('rangeContour: deux cases diagonales ne perdent aucune arête', () => {
  const loops = rangeContour(new Set(['0,0', '1,1']));
  assert.equal(loops.reduce((sum, loop) => sum + loop.length, 0), 8);
});

test('rangeWallHit ignore une porte ouverte', () => {
  const closed = [{ x1: 1, y1: 0, x2: 1, y2: 2, blocksMovement: true }];
  assert.ok(rangeWallHit(.5, .5, 1.5, .5, closed));
  assert.equal(rangeWallHit(.5, .5, 1.5, .5, [{ ...closed[0], blocksMovement: false }]), null);
});

test('rangeMoveCells ligne: mur bloqué, porte ouverte', () => {
  const args = { token: { col: 0, row: 0 }, cols: 5, rows: 3, remaining: 3, walls: [{ x1: 1, y1: 0, x2: 1, y2: 3, blocksMovement: true }] };
  assert.equal(rangeMoveCells({ ...args, mode: 'line' }).get('2,0')?.kind, 'blocked');
  assert.equal(rangeMoveCells({ ...args, walls: [{ ...args.walls[0], blocksMovement: false }], mode: 'line' }).get('2,0')?.kind, 'move');
});

test('rangeMoveCells path: traverse une ouverture et compte le coût réel', () => {
  const walls = [
    { x1: 1, y1: 0, x2: 1, y2: 2, blocksMovement: true },
    { x1: 1, y1: 3, x2: 1, y2: 5, blocksMovement: true },
  ];
  const cells = rangeMoveCells({ token: { col: 0, row: 0 }, cols: 5, rows: 5, remaining: 8, walls, mode: 'path' });
  assert.equal(cells.get('2,0')?.cost, 6);
  assert.equal(cells.get('2,0')?.kind, 'move');
});

test('rangeMoveCells path: toute l’empreinte d’un grand token respecte le mur', () => {
  const cells=rangeMoveCells({ token:{col:0,row:0,w:2,h:2}, cols:5, rows:5, remaining:2,
    walls:[{x1:2,y1:0,x2:2,y2:5,blocksMovement:true}], mode:'path' });
  assert.equal(cells.get('1,0')?.kind,'blocked');
});

test('rangeMoveCells course: 7 présent, 10 absent avec 3 + 6', () => {
  const cells = rangeMoveCells({ token: { col: 0, row: 0 }, cols: 12, rows: 2, remaining: 3, courseExtra: 6 });
  assert.equal(cells.get('7,0')?.kind, 'course');
  assert.equal(cells.has('10,0'), false);
});

test('rangeApproach prend la moins coûteuse, ignore les cases occupées et renvoie null hors portée', () => {
  const cells = new Map([
    ['2,0', { c: 2, r: 0, cost: 5, kind: 'move' }],
    ['3,0', { c: 3, r: 0, cost: 3, kind: 'move' }],
  ]);
  const base = { token: { col: 0, row: 0 }, target: { col: 4, row: 0 }, cells, range: 2 };
  assert.equal(rangeApproach(base).best.c, 3);
  assert.equal(rangeApproach({ ...base, occupied: new Set(['3,0']) })?.best.c, 2);
  assert.equal(rangeApproach({ ...base, range: 1, occupied: new Set(['3,0']) }), null);
});

test('rangeAttackCells applique Chebyshev en mêlée et Manhattan à distance', () => {
  const melee=rangeAttackCells({from:{col:2,row:2},dims:{w:1,h:1},range:1,cols:6,rows:6});
  assert.equal(melee.has('3,3'),true);
  const ranged=rangeAttackCells({from:{col:2,row:2},dims:{w:1,h:1},range:2,cols:6,rows:6});
  assert.equal(ranged.has('3,3'),true);
  assert.equal(ranged.has('4,3'),false);
});
