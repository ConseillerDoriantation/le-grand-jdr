import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fogGeometrySignature,
  fogRasterCellSize,
  fogSharedVisionTokens,
  fogVisionFeatherCells,
  fogVisionRadiusCells,
  vttCanvasPixelRatio,
  vttDefaultLowFx,
  vttIsPhoneViewport,
  vttPinchCameraTransform,
  vttShouldReduceEffects,
} from '../assets/js/features/vtt/vtt-fog-performance.js';

test('la vision dynamique est bornée à trois cases par défaut et reste configurable', () => {
  assert.equal(fogVisionRadiusCells({}, {}), 3);
  assert.equal(fogVisionRadiusCells({ visionRadius:8 }, {}), 8);
  assert.equal(fogVisionRadiusCells({ visionRadius:8 }, { visionRadius:3 }), 3);
  assert.equal(fogVisionRadiusCells({}, { visionRadius:999 }), 40);
  assert.equal(fogVisionRadiusCells({}, { visionRadius:0 }), 1);
});

test('le bord de vision conserve un fondu progressif proportionné', () => {
  assert.equal(fogVisionFeatherCells(1), 0.5);
  assert.equal(fogVisionFeatherCells(3), 1.35);
  assert.equal(fogVisionFeatherCells(8), 1.35);
});

test('la vision partagée réunit uniquement les personnages visibles présents sur la page', () => {
  const page = { id:'p1', cols:20, rows:15 };
  const hero = { id:'hero', type:'player', pageId:'p1', col:2, row:3 };
  const delegatedLegacy = { id:'ally', characterId:'c2', pageId:'p1', col:6, row:7 };
  const visible = fogSharedVisionTokens(page, {
    hero:{ data:hero },
    ally:{ data:delegatedLegacy },
    hidden:{ data:{ id:'hidden', type:'player', pageId:'p1', col:4, row:4, visible:false } },
    enemy:{ data:{ id:'enemy', type:'enemy', pageId:'p1', col:8, row:8 } },
    elsewhere:{ data:{ id:'elsewhere', type:'player', pageId:'p2', col:1, row:1 } },
    reserve:{ data:{ id:'reserve', type:'player', pageId:'p1', col:-10, row:-10 } },
  });

  assert.deepEqual(visible, [hero, delegatedLegacy]);
});

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

test('un téléphone tactile est distingué d une tablette et d un petit desktop', () => {
  assert.equal(vttIsPhoneViewport(390, 844, true, 5), true);
  assert.equal(vttIsPhoneViewport(844, 390, true, 5), true);
  assert.equal(vttIsPhoneViewport(768, 1024, true, 5), false);
  assert.equal(vttIsPhoneViewport(390, 844, false, 0), false);
});

test('le mode performance est activé par défaut sur téléphone, même pour le MJ', () => {
  assert.equal(vttDefaultLowFx({ isAdmin:true, isPhone:true, deviceMemory:8, hardwareConcurrency:8 }), true);
  assert.equal(vttDefaultLowFx({ isAdmin:true, isPhone:false, deviceMemory:8, hardwareConcurrency:8 }), false);
  assert.equal(vttDefaultLowFx({ isAdmin:false, isPhone:false, deviceMemory:8, hardwareConcurrency:8 }), true);
});

test('le pincement dézoome autour du centre des doigts', () => {
  const view = vttPinchCameraTransform({
    startScale:2,
    startPosition:{ x:-100, y:-50 },
    startCenter:{ x:200, y:150 },
    currentCenter:{ x:210, y:140 },
    startDistance:200,
    currentDistance:100,
  });
  assert.deepEqual(view, { scale:1, x:60, y:40 });
});

test('le pincement respecte les limites de zoom', () => {
  assert.equal(vttPinchCameraTransform({
    startScale:1, startPosition:{x:0,y:0}, startCenter:{x:0,y:0}, currentCenter:{x:0,y:0},
    startDistance:200, currentDistance:1,
  }).scale, 0.15);
  assert.equal(vttPinchCameraTransform({
    startScale:1, startPosition:{x:0,y:0}, startCenter:{x:0,y:0}, currentCenter:{x:0,y:0},
    startDistance:10, currentDistance:100,
  }).scale, 4);
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
