import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONE_SHAPES, _zoneCount, _zoneDims, _zoneShapeUnlocked, _cellInShape, _zoneCellCount } from '../assets/js/shared/spell-zones.js';

const dims = (shape, n) => _zoneDims(shape, n);
const cellCount = (shape, n, dir) => { const d = dims(shape, n); return _zoneCellCount(shape, d.w, d.h, dir); };
// Rangées d'un cône (nombre de cases par ligne, de l'apex à la base)
const coneRows = (n) => {
  const d = dims('cone', n); const out = [];
  for (let ri = 0; ri < d.h; ri += 1) { let c = 0; for (let ci = 0; ci < d.w; ci += 1) if (_cellInShape('cone', ci, ri, d.w, d.h, 'down')) c += 1; out.push(c); }
  return out;
};

test('_zoneCount : Dispersion = 1 + nDisp poses', () => {
  assert.equal(_zoneCount(0), 1);
  assert.equal(_zoneCount(1), 2);
  assert.equal(_zoneCount(3), 4);
  assert.equal(_zoneCount(undefined), 1);
});

test('ZONE_SHAPES : rect, cross, cone, ring (pas de diamond côté runes)', () => {
  assert.deepEqual(ZONE_SHAPES, ['rect', 'cross', 'cone', 'ring']);
});

test('1 Amplification = ligne 3×1 quelle que soit la forme (forme non débloquée)', () => {
  assert.equal(_zoneShapeUnlocked(1), false);
  for (const shp of ['rect', 'cross', 'cone', 'ring']) {
    assert.deepEqual(_zoneDims(shp, 1), { w: 3, h: 1, shape: 'rect' });
  }
});

test('forme débloquée à partir de 2 Amplification', () => {
  assert.equal(_zoneShapeUnlocked(2), true);
  assert.equal(_zoneShapeUnlocked(3), true);
});

test('rect (Carré pur) : 2→3×3, 3→5×5, 4→7×7', () => {
  assert.deepEqual(_zoneDims('rect', 2), { w: 3, h: 3, shape: 'rect' });
  assert.deepEqual(_zoneDims('rect', 3), { w: 5, h: 5, shape: 'rect' });
  assert.deepEqual(_zoneDims('rect', 4), { w: 7, h: 7, shape: 'rect' });
});

test('cross (Croix) : envergure 2N+1 (2→5, 3→7), symétrique', () => {
  assert.deepEqual(_zoneDims('cross', 2), { w: 5, h: 5, shape: 'cross' });
  assert.deepEqual(_zoneDims('cross', 3), { w: 7, h: 7, shape: 'cross' });
});

test('cone (Cône) : profondeur N+1, base 2·prof−1, depuis le lanceur', () => {
  assert.deepEqual(_zoneDims('cone', 2), { w: 5, h: 3, shape: 'cone', depth: 3 });
  assert.deepEqual(_zoneDims('cone', 3), { w: 7, h: 4, shape: 'cone', depth: 4 });
});

test('ring (Anneau) : rayon N, envergure 2N+1, centre épargné', () => {
  assert.deepEqual(_zoneDims('ring', 2), { w: 5, h: 5, shape: 'ring', radius: 2 });
  assert.deepEqual(_zoneDims('ring', 3), { w: 7, h: 7, shape: 'ring', radius: 3 });
});

test('cône en cases : apex → base = 1, 3, 5 (palier 2)', () => {
  assert.deepEqual(coneRows(2), [1, 3, 5]);   // exactement l'exemple demandé (9 cases)
  assert.deepEqual(coneRows(3), [1, 3, 5, 7]); // 16 cases
});

test('équilibrage : au palier 2, toutes les formes couvrent ~9 cases (anneau évidé un peu moins)', () => {
  assert.equal(cellCount('rect', 2), 9);   // 3×3
  assert.equal(cellCount('cross', 2), 9);  // + de portée 5, 9 cases
  assert.equal(cellCount('cone', 2), 9);   // 1+3+5
  assert.equal(cellCount('ring', 2), 8);   // couronne évidée (centre épargné)
});

test('_cellInShape cross : la colonne/ligne centrale, pas les coins', () => {
  // boîte 5×5, centre (2,2)
  assert.equal(_cellInShape('cross', 2, 0, 5, 5), true);   // haut-centre
  assert.equal(_cellInShape('cross', 0, 2, 5, 5), true);   // gauche-centre
  assert.equal(_cellInShape('cross', 0, 0, 5, 5), false);  // coin
});

test('_cellInShape ring : couronne en losange, centre vide', () => {
  assert.equal(_cellInShape('ring', 2, 2, 5, 5), false);   // centre épargné
  assert.equal(_cellInShape('ring', 2, 0, 5, 5), true);    // sommet du losange (dist 2)
  assert.equal(_cellInShape('ring', 0, 0, 5, 5), false);   // coin (dist 4)
});

test('_cellInShape cone : orientation (down/up/left/right)', () => {
  // down : apex en haut → seule la case centrale de la 1ère ligne
  assert.equal(_cellInShape('cone', 2, 0, 5, 3, 'down'), true);
  assert.equal(_cellInShape('cone', 0, 0, 5, 3, 'down'), false);
  // up : apex en bas
  assert.equal(_cellInShape('cone', 2, 2, 5, 3, 'up'), true);
  assert.equal(_cellInShape('cone', 0, 2, 5, 3, 'up'), false);
});

test('_zoneDims : N<1 → null ; forme inconnue → rect', () => {
  assert.equal(_zoneDims('rect', 0), null);
  assert.equal(_zoneDims('cone', 0), null);
  assert.deepEqual(_zoneDims('wat', 2), { w: 3, h: 3, shape: 'rect' });
});
