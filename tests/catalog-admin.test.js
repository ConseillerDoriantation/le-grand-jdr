import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  catalogAutoPlural,
  catalogCloseColors,
  catalogItemErrors,
  catalogReplacementFor,
} from '../assets/js/shared/catalog-admin-utils.js';

test('le pluriel automatique ne double pas les mots terminés par s ou x', () => {
  assert.equal(catalogAutoPlural('Elite'), 'Elites');
  assert.equal(catalogAutoPlural('Boss'), 'Boss');
  assert.equal(catalogAutoPlural('Phénix'), 'Phénix');
});

test('les noms vides et doublons sont détectés sans tenir compte des accents ou de la casse', () => {
  const items = [{ label: 'Épique' }, { label: 'epique' }, { label: '' }];
  assert.deepEqual(catalogItemErrors(items, items[0]), ['duplicate']);
  assert.deepEqual(catalogItemErrors(items, items[1]), ['duplicate']);
  assert.deepEqual(catalogItemErrors(items, items[2]), ['name']);
});

test('les couleurs trop proches sont signalées', () => {
  const near = catalogCloseColors([
    { id: 'a', color: '#4f8cff' },
    { id: 'b', color: '#508dff' },
    { id: 'c', color: '#ff5a7e' },
  ]);
  assert.equal(near.length, 1);
  assert.deepEqual(near[0].map(item => item.id), ['a', 'b']);
});

test('une chaîne de suppressions se résout vers le dernier remplacement', () => {
  const changes = [{ from: 'elite', to: 'boss' }, { from: 'boss', to: 'classique' }];
  assert.equal(catalogReplacementFor('elite', changes), 'classique');
  assert.equal(catalogReplacementFor('boss', changes), 'classique');
  assert.equal(catalogReplacementFor('classique', changes), '');
});

test('les deux catalogues utilisent le module partagé et des écritures groupées', async () => {
  const root = new URL('../', import.meta.url);
  const [achievements, bestiary, shared, css] = await Promise.all([
    readFile(new URL('assets/js/features/achievements.js', root), 'utf8'),
    readFile(new URL('assets/js/features/bestiary.js', root), 'utf8'),
    readFile(new URL('assets/js/shared/catalog-admin.js', root), 'utf8'),
    readFile(new URL('assets/css/features.css', root), 'utf8'),
  ]);
  assert.match(achievements, /openCatalogAdmin\(/);
  assert.match(bestiary, /openCatalogAdmin\(/);
  assert.match(achievements, /batchUpdateInCol/);
  assert.match(bestiary, /batchUpdateInCol/);
  assert.match(shared, /setModalCloseGuard/);
  assert.match(shared, /makeSortable/);
  assert.match(css, /\.rka-body\s*\{[^}]*340px/s);
  assert.match(css, /\.rka\s*\{[^}]*height:min\(720px/s);
});
