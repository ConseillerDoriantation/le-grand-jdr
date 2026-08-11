import test from 'node:test';
import assert from 'node:assert/strict';

import { fitLightboxMedia, resolveHorizontalSwipe } from '../assets/js/shared/lightbox-layout.js';

test('une image paysage reste dans un écran desktop bas', () => {
  const size = fitLightboxMedia({
    imageRatio: 16 / 9,
    hostWidth: 1286,
    hostHeight: 520,
    sideWidth: 340,
  });

  assert.deepEqual(size, { width: 921, height: 518 });
  assert.ok(size.width + 340 <= 1286);
  assert.ok(size.height <= 520);
});

test('une image portrait utilise la hauteur sans dépasser son cadre desktop', () => {
  const size = fitLightboxMedia({
    imageRatio: 2 / 3,
    hostWidth: 1286,
    hostHeight: 520,
    sideWidth: 340,
  });

  assert.deepEqual(size, { width: 345, height: 518 });
});

test('la disposition empilée réserve de la place aux informations', () => {
  const size = fitLightboxMedia({
    imageRatio: 16 / 9,
    hostWidth: 846,
    hostHeight: 546,
    stacked: true,
  });

  assert.deepEqual(size, { width: 559, height: 315 });
  assert.ok(size.height < 546);
});

test('la lightbox mobile ne force aucune largeur minimale hors écran', () => {
  const size = fitLightboxMedia({
    imageRatio: 16 / 9,
    hostWidth: 300,
    hostHeight: 340,
    stacked: true,
  });

  assert.deepEqual(size, { width: 298, height: 168 });
});

test('un glissement horizontal franc navigue dans la lightbox', () => {
  assert.equal(resolveHorizontalSwipe({ startX: 280, startY: 120, endX: 170, endY: 132 }), 'next');
  assert.equal(resolveHorizontalSwipe({ startX: 120, startY: 120, endX: 205, endY: 110 }), 'previous');
});

test('un tap ou un scroll vertical ne déclenche pas la navigation', () => {
  assert.equal(resolveHorizontalSwipe({ startX: 120, startY: 120, endX: 95, endY: 122 }), null);
  assert.equal(resolveHorizontalSwipe({ startX: 120, startY: 120, endX: 175, endY: 230 }), null);
});
