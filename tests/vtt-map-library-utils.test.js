import test from 'node:test';
import assert from 'node:assert/strict';
import {
  githubAssetIdentity,
  mapLibraryImageKey,
  dedupeMapLibraryImages,
} from '../assets/js/features/vtt/vtt-map-library-utils.js';

test('une carte GitHub garde la même identité entre chemin, Raw, blob et Pages', () => {
  const variants = [
    'images/maps/Grande salle.webp',
    'https://raw.githubusercontent.com/ConseillerDoriantation/le-grand-jdr/main/images/maps/Grande%20salle.webp',
    'https://github.com/ConseillerDoriantation/le-grand-jdr/blob/main/images/maps/Grande salle.webp',
    'https://conseillerdoriantation.github.io/le-grand-jdr/images/maps/Grande%20salle.webp',
  ].map(value => githubAssetIdentity(value));
  assert.equal(new Set(variants).size, 1);
});

test('le chemin complet distingue deux cartes de même nom dans deux dossiers', () => {
  assert.notEqual(
    mapLibraryImageKey({ sourcePath: 'images/maps/chateau/plan.webp' }),
    mapLibraryImageKey({ sourcePath: 'images/maps/bastion/plan.webp' }),
  );
});

test('le nettoyage conserve la première carte et récupère le chemin source manquant', () => {
  const result = dedupeMapLibraryImages([
    { id: 'old', url: 'https://raw.githubusercontent.com/ConseillerDoriantation/le-grand-jdr/main/images/maps/Grande%20salle.webp', name: 'Grande salle', folderId: 'favoris' },
    { id: 'new', url: 'https://conseillerdoriantation.github.io/le-grand-jdr/images/maps/Grande%20salle.webp', sourcePath: 'images/maps/Grande salle.webp', folderId: null },
  ]);
  assert.equal(result.removed, 1);
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].id, 'old');
  assert.equal(result.images[0].folderId, 'favoris');
  assert.equal(result.images[0].sourcePath, 'images/maps/Grande salle.webp');
});

test('les paramètres temporaires d’une URL externe ne créent pas de doublon', () => {
  const result = dedupeMapLibraryImages([
    { id: 'a', url: 'https://cdn.example.com/maps/ville.png?v=1' },
    { id: 'b', url: 'https://cdn.example.com/maps/ville.png?v=2' },
  ]);
  assert.equal(result.removed, 1);
});
