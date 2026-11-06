import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const pages = readFileSync(new URL('assets/js/features/pages.js', root), 'utf8');
const settings = readFileSync(new URL('assets/js/shared/artisan-settings.js', root), 'utf8');

test('la Console MJ expose un accès direct aux recettes d’artisanat', () => {
  assert.match(pages, /t: 'Recettes d’artisanat'/);
  assert.match(pages, /fn: 'openArtisanRecipesAdmin', mod: '\.\.\/shared\/artisan-settings'/);
  assert.match(pages, /'\.\.\/shared\/artisan-settings': 'shop'/);
});

test('le bouton ouvre directement l’onglet Fabriquer', () => {
  assert.match(settings, /export function openArtisanRecipesAdmin\(\)/);
  assert.match(settings, /return openArtisanSettings\('fabriquer'\)/);
});
