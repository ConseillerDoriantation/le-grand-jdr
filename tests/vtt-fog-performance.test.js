import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fogGeometrySignature,
  fogRasterCellSize,
  vttCanvasPixelRatio,
  vttShouldReduceEffects,
} from '../assets/js/features/vtt/vtt-fog-performance.js';

test('fogRasterCellSize borne fortement les grandes scènes', () => {
  const cell = fogRasterCellSize(200, 200, 70);
  const width = Math.ceil(200 * cell);
  const height = Math.ceil(200 * cell);

  assert.ok(width <= 3072);
  assert.ok(height <= 3072);
  assert.ok(width * height <= 4_010_000);
  assert.ok(cell < 70);
});

test('fogRasterCellSize conserve assez de précision sur une battlemap normale', () => {
  assert.equal(fogRasterCellSize(48, 36, 70), 24);
});

test('le DPR Konva est borné selon les capacités de la machine', () => {
  assert.equal(vttCanvasPixelRatio(3, 8, 8), 1.5);
  assert.equal(vttCanvasPixelRatio(2, 4, 8), 1);
  assert.equal(vttCanvasPixelRatio(1, 2, 2), 1);
});

test('les effets lourds deviennent statiques uniquement sur matériel très contraint', () => {
  assert.equal(vttShouldReduceEffects(2, 8), true);
  assert.equal(vttShouldReduceEffects(8, 2), true);
  assert.equal(vttShouldReduceEffects(4, 4), false);
});

test('la signature du fog ignore les PV et les états des tokens', () => {
  const page = { id:'p1', cols:48, rows:36, fogEnabled:true, walls:[], lightSources:[], fogOps:[] };
  const first = {
    hero: { data:{ id:'hero', type:'player', pageId:'p1', col:4, row:5, hp:30, conditions:[] } },
    foe: { data:{ id:'foe', type:'enemy', pageId:'p1', col:7, row:5, hp:40 } },
  };
  const second = {
    hero: { data:{ ...first.hero.data, hp:12, conditions:[{ id:'burn' }] } },
    foe: { data:{ ...first.foe.data, hp:2 } },
  };

  assert.equal(fogGeometrySignature(page, first, false), fogGeometrySignature(page, second, false));
});

test('la signature du fog change avec la position joueur et les obstacles', () => {
  const basePage = { id:'p1', cols:48, rows:36, fogEnabled:true, walls:[], lightSources:[], fogOps:[] };
  const tokens = { hero:{ data:{ id:'hero', type:'player', pageId:'p1', col:4, row:5 } } };
  const moved = { hero:{ data:{ ...tokens.hero.data, col:5 } } };
  const withWall = {
    ...basePage,
    walls:[{ id:'w1', type:'door', x1:4, y1:4, x2:4, y2:7, open:false }],
  };

  assert.notEqual(fogGeometrySignature(basePage, tokens, false), fogGeometrySignature(basePage, moved, false));
  assert.notEqual(fogGeometrySignature(basePage, tokens, false), fogGeometrySignature(withWall, tokens, false));
});
