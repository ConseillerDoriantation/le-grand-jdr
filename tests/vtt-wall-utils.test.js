import test from 'node:test';
import assert from 'node:assert/strict';
import { VTT_STRUCTURE_STYLE, vttStructureLegendSvg, vttWallState } from '../assets/js/features/vtt/vtt-wall-utils.js';

test('un mur reste solide et ne peut pas être ouvert', () => {
  const state = vttWallState({ type: 'wall', open: true });
  assert.equal(state.label, 'Mur');
  assert.equal(state.open, false);
  assert.equal(state.blocksVision, true);
  assert.equal(state.blocksMovement, true);
});

test('une porte fermée bloque vision et déplacement', () => {
  const state = vttWallState({ type: 'door', open: false });
  assert.equal(state.stateLabel, 'Fermée');
  assert.equal(state.blocksVision, true);
  assert.equal(state.blocksMovement, true);
});

test('une porte ouverte libère vision et déplacement', () => {
  const state = vttWallState({ type: 'door', open: true });
  assert.equal(state.stateLabel, 'Ouverte');
  assert.equal(state.blocksVision, false);
  assert.equal(state.blocksMovement, false);
});

test('une vitre fermée laisse voir mais bloque le déplacement', () => {
  const state = vttWallState({ type: 'window', open: false, locked: true });
  assert.equal(state.label, 'Vitre');
  assert.equal(state.locked, true);
  assert.equal(state.blocksVision, false);
  assert.equal(state.blocksMovement, true);
});

test('une vitre ouverte laisse aussi passer le déplacement', () => {
  const state = vttWallState({ type: 'window', open: true });
  assert.equal(state.blocksVision, false);
  assert.equal(state.blocksMovement, false);
});

test('les structures partagent une palette sobre et une légende géométrique', () => {
  assert.deepEqual(VTT_STRUCTURE_STYLE, {
    casing:'#05080f', wall:'#b9c3d3', wood:'#c98a3a', glass:'#8fdcff', lock:'#ff5a7e',
  });
  for (const kind of ['wall','door-closed','door-open','window-closed','window-open','locked']) {
    const svg = vttStructureLegendSvg(kind);
    assert.match(svg, /^<svg /);
    assert.match(svg, /aria-hidden="true"/);
  }
  assert.match(vttStructureLegendSvg('locked'), /#ff5a7e/);
});
