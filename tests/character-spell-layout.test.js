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

test('le modificateur choisi dans la fiche est synchronisé et lu avant le défaut de l arme', () => {
  assert.match(spellsJs, /function _syncSpellStatProxy\(el\)[\s\S]*target\.value = el\.value;[\s\S]*_updateSortPreview\(\);/);
  assert.match(spellsJs, /_syncSpellStatProxy:\s*\(el\)\s*=>\s*_syncSpellStatProxy\(el\)/);
  assert.match(spellsJs, /degatsStat:\s*_readSpellStatOverride\('s-degats-stat', 's-degats-stat-soin'\)/);
});
