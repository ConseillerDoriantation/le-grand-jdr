import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../assets/css/characters.css', import.meta.url), 'utf8');
const spellsJs = readFileSync(new URL('../assets/js/features/characters/spells.js', import.meta.url), 'utf8');

const fnBody = (name) => spellsJs.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] || '';

test('choisir un sort met à jour la fiche sans re-rendre ni faire défiler la liste', () => {
  const select = fnBody('_sortsSelect');
  assert.ok(select, 'le gestionnaire de sélection doit exister');
  assert.doesNotMatch(select, /scrollIntoView|_sortsRerender\(\);\s*$/m);
  assert.match(select, /_renderSpellSheet\(/);
});

test('les champs libres de la fiche s’enregistrent au change, jamais à la frappe', () => {
  const sheet = fnBody('_renderSpellSheet');
  assert.ok(sheet, 'la fiche doit exister');
  assert.match(sheet, /data-change="_sortsInlineEdit" data-field="nom"/);
  assert.match(sheet, /data-change="_sortsInlineEdit" data-field="effet"/);
  assert.doesNotMatch(sheet, /data-input="_sortsInlineEdit"/);
});

test('sur écran étroit, la fiche du sort devient un panneau du bas refermable', () => {
  assert.match(
    css,
    /@media \(max-width: 900px\)\s*\{[^@]*\.cs-grim\.is-sheet-open \.cs-grim-sheet\s*\{[^}]*position:fixed[^}]*bottom:0/s,
  );
  assert.match(css, /\.cs-grim\.is-sheet-open \.cs-grim-sheet-x\s*\{[^}]*display:grid/);
});

test('sur écran large, la fiche du sort suit le défilement de la liste', () => {
  // .main-col (overflow:hidden) piège le sticky : clip tant que l'onglet Sorts est affiché.
  assert.match(css, /@media \(min-width: 901px\)\s*\{[^@]*\.main-col:has\(\.cs-grim\)\s*\{[^}]*overflow:clip/);
  assert.match(css, /@container cs-grim-body \(min-width: 896px\)\s*\{[^@]*\.cs-grim-sheet\s*\{[^}]*position:sticky[^}]*overflow-y:auto/);
  assert.match(fnBody('_renderSpellSheet'), /data-scroll-key="cs-grim-sheet-/);
});

test('chaque ligne a un ✏️ qui ouvre la forge sans ouvrir le panneau du bas', () => {
  assert.match(fnBody('_renderSpellRow'), /canEdit \? `<button type="button" class="cs-grim-edit" data-action="_sortsEditRow" data-idx="\$\{i\}"/);
  assert.match(fnBody('_sortsEditRow'), /_sortsSelect\(i, \{ open: false \}\);\s*editSort\(i\);/);
  assert.match(spellsJs, /_sortsEditRow:\s*\(btn\)\s*=>\s*_sortsEditRow\(Number\(btn\.dataset\.idx\)\)/);
  // Sur téléphone la ligne est trop étroite : le toucher ouvre déjà la fiche.
  assert.match(css, /@media \(max-width: 640px\)\s*\{[^@]*\.cs-grim-edit\s*\{\s*display:none/);
});

test('le modificateur choisi dans la fiche est synchronisé et lu avant le défaut de l arme', () => {
  assert.match(spellsJs, /function _syncSpellStatProxy\(el\)[\s\S]*target\.value = el\.value;[\s\S]*_updateSortPreview\(\);/);
  assert.match(spellsJs, /_syncSpellStatProxy:\s*\(el\)\s*=>\s*_syncSpellStatProxy\(el\)/);
  assert.match(spellsJs, /degatsStat:\s*_readSpellStatOverride\('s-degats-stat', 's-degats-stat-soin'\)/);
});
