import test from 'node:test';
import assert from 'node:assert/strict';

import { sceneGridSizeForImages } from '../assets/js/features/vtt/vtt-scene-utils.js';

test('la grille reprend exactement la taille d’une image placée à l’origine', () => {
  assert.deepEqual(
    sceneGridSizeForImages([{ x:0, y:0, w:48, h:36 }]),
    {
      cols:48, rows:36, imageCount:1,
      minX:0, minY:0, maxRight:48, maxBottom:36,
      hasNegativeOrigin:false, clippedByLimit:false,
    },
  );
});

test('la grille englobe les limites extrêmes de plusieurs images', () => {
  const result = sceneGridSizeForImages([
    { x:0, y:0, w:20, h:15 },
    { x:20, y:5, w:12, h:18 },
    { x:4, y:23, w:8, h:7 },
  ]);
  assert.equal(result.cols, 32);
  assert.equal(result.rows, 30);
  assert.equal(result.imageCount, 3);
});

test('la position et la taille des images ne sont jamais modifiées par le calcul', () => {
  const images = [{ x:5, y:3, w:10.2, h:7.1 }];
  const before = structuredClone(images);
  const result = sceneGridSizeForImages(images);
  assert.equal(result.cols, 16);
  assert.equal(result.rows, 11);
  assert.deepEqual(images, before);
});

test('les limites de dimensions de scène restent respectées', () => {
  const tiny = sceneGridSizeForImages([{ w:2, h:3 }]);
  assert.deepEqual({ cols:tiny.cols, rows:tiny.rows }, { cols:8, rows:8 });
  const oversized = sceneGridSizeForImages([{ x:190, y:50, w:30, h:180 }]);
  assert.equal(oversized.cols, 200);
  assert.equal(oversized.rows, 200);
  assert.equal(oversized.clippedByLimit, true);
});

test('une scène sans image ne produit aucune dimension automatique', () => {
  assert.equal(sceneGridSizeForImages([]), null);
});
