import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const characters = read('../assets/js/features/characters.js');
const shop = read('../assets/js/features/shop.js');

test('supprimer un build de personnage peut être annulé et restaure le build actif', () => {
  const start = characters.indexOf('async function deleteCharacterBuild');
  const end = characters.indexOf('\nasync function setCharAura', start);
  const implementation = characters.slice(start, end);
  assert.match(implementation, /const before = cloneState\(normalized\)/);
  assert.match(implementation, /label: '↶ Annuler'/);
  assert.match(implementation, /c\.activeBuildId = before\.activeBuildId/);
  assert.match(implementation, /applyActiveBuild\(c\)/);
  assert.match(implementation, /await _persistCharacterBuildState\(c\)/);
  assert.doesNotMatch(implementation, /loadCollection|getDocData/);
});

test('supprimer un build de l atelier restaure les builds enregistrés ou locaux', () => {
  const start = shop.indexOf('async function _atelierDeleteBuild');
  const end = shop.indexOf('\nfunction _atelierDuplicateBuild', start);
  const implementation = shop.slice(start, end);
  assert.match(implementation, /const savedSnapshot =/);
  assert.match(implementation, /const localSnapshot =/);
  assert.match(implementation, /label: '↶ Annuler'/);
  assert.match(implementation, /restored\.splice/);
  assert.match(implementation, /_atelier\.localBuilds\.splice/);
  assert.match(implementation, /_atelierUseBuild\(buildId\)/);
  assert.doesNotMatch(implementation, /loadCollection|getDocData/);
});
