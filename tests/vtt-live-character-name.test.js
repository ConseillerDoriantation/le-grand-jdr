import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('le sélecteur d’émotes affiche le nom vivant de la fiche et non le nom figé du token', async () => {
  const source = await read('assets/js/features/vtt/vtt-emotes.js');
  assert.match(source, /function _emoteTokenName\(t, fallback = 'Token'\)[\s\S]*_live\(t\)\?\.displayName/);
  assert.match(source, /_esc\(_emoteTokenName\(emitter\)\)/);
  assert.match(source, /_esc\(_emoteTokenName\(x\.data\)\)/);
  assert.doesNotMatch(source, /_esc\(emitter\.name \|\| 'Token'\)/);
  assert.doesNotMatch(source, /_esc\(x\.data\.name \|\| 'Token'\)/);
});

test('les statistiques et la modale d’effet évitent aussi le nom historique du token', async () => {
  const source = await read('assets/js/features/vtt/vtt.js');
  assert.match(source, /function _statsActor\(t\)[\s\S]*character\?\.nom \|\| _live\(t\)\?\.displayName \|\| t\.name/);
  assert.match(source, /const tokenName = _live\(t\)\?\.displayName \|\| t\.name \|\| 'Token'/);
  assert.match(source, /openModal\(`✨ Ajouter un effet sur \$\{_esc\(tokenName\)\}`/);
  assert.doesNotMatch(source, /Ajouter un effet sur \$\{t\.name\}/);
});
