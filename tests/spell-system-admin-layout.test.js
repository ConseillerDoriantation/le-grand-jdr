import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('la modale système de sorts possède le nouveau shell et protège les modifications', async () => {
  const source = await read('assets/js/shared/spell-system.js');
  assert.match(source, /class="ss2"/);
  assert.match(source, /setModalCloseGuard/);
  assert.match(source, /enabledResources/);
  assert.match(source, /costRates/);
  assert.match(source, /costLinked/);
  assert.match(source, /Recalculer à l’enregistrement/);
});

test('les deux forges filtrent leurs ressources via la configuration du système', async () => {
  const source = await read('assets/js/features/characters/spells.js');
  assert.match(source, /getEnabledSpellResources/);
  assert.match(source, /_sortCostResourceOptions\(selectedCostResource\)/);
  assert.match(source, /id="s-classic-cost-resource"/);
  assert.match(source, /id="s-cost-resource"/);
});

test('la nouvelle présentation est bornée, mono-colonne et responsive', async () => {
  const css = await read('assets/css/characters.css');
  assert.match(css, /\.modal:has\(\.ss2\)/);
  assert.match(css, /max-width:\s*860px/);
  assert.match(css, /height:\s*min\(820px/);
  assert.match(css, /\.ss2-main[^}]*overflow:\s*auto/s);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.ss2/);
});
