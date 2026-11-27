import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeGalleryCategoryOrder, moveGalleryCard } from '../assets/js/shared/achievement-gallery-sort.js';

test('insère avant ou après, et ne modifie rien si la destination est déjà correcte', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveGalleryCard(ids, 'a', 'c', true), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveGalleryCard(ids, 'd', 'a', false), ['d', 'a', 'b', 'c']);
  assert.equal(moveGalleryCard(ids, 'b', 'c', false), ids);
  assert.equal(moveGalleryCard(ids, 'b', 'hors-catégorie', true), ids);
});

test('un tri remplit seulement les places de cette catégorie et préserve les autres', () => {
  const global = ['a', 'secret-externe', 'z', 'b', 'y', 'c'];
  const ids = ['a', 'z', 'b', 'y', 'c', 'nouveau'];
  assert.deepEqual(
    mergeGalleryCategoryOrder(global, ids, new Set(['a', 'b', 'c', 'nouveau']), ['c', 'a', 'b']),
    ['c', 'secret-externe', 'z', 'a', 'y', 'b', 'nouveau'],
  );
});
