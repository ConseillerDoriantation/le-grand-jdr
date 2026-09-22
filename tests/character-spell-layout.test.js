import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../assets/css/characters.css', import.meta.url), 'utf8');
const spellsJs = readFileSync(new URL('../assets/js/features/characters/spells.js', import.meta.url), 'utf8');

test('la fiche détaillée d un sort reste alignée sur toute la grille', () => {
  assert.doesNotMatch(
    css,
    /\.cs-spellcard-grid\s*>\s*\.cs-spellinspector\s*\{[^}]*margin-left\s*:\s*clamp/si,
  );
  assert.match(
    css,
    /\.cs-spellcard-grid\s*>\s*\.cs-spellinspector\s*\{[^}]*margin-left\s*:\s*0\s*;[^}]*justify-self\s*:\s*stretch/si,
  );
});

test('ouvrir une fiche de sort ne lance aucun défilement horizontal natif', () => {
  const inspectHandler = spellsJs.match(
    /function _sortsInspectSpell\(index\)\s*\{([\s\S]*?)\n\}/,
  )?.[1] || '';

  assert.ok(inspectHandler, 'le gestionnaire d ouverture du sort doit exister');
  assert.doesNotMatch(inspectHandler, /scrollIntoView/);
  assert.match(inspectHandler, /_sortsScrollIntoViewY/);
});
