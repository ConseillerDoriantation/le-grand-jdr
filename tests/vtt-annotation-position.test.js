import test from 'node:test';
import assert from 'node:assert/strict';

import { annotationNodePosition, annotationPositionPatch } from '../assets/js/features/vtt/vtt-annotation-utils.js';

test('un ancien dessin à points conserve ses offsets historiques', () => {
  assert.deepEqual(annotationNodePosition({ type:'freehand', offsetX:84, offsetY:-21 }), { x:84, y:-21 });
});

test('un dessin transformé relit sa dernière position x/y', () => {
  assert.deepEqual(
    annotationNodePosition({ type:'polygon', offsetX:10, offsetY:20, x:145, y:72 }),
    { x:145, y:72 },
  );
});

test('un déplacement de dessin à points synchronise les deux formats', () => {
  assert.deepEqual(
    annotationPositionPatch({ type:'line' }, 51.5, 92),
    { x:51.5, y:92, offsetX:51.5, offsetY:92 },
  );
  assert.deepEqual(annotationPositionPatch({ type:'circle' }, 12, 8), { x:12, y:8 });
});
