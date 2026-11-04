import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const forms = readFileSync(new URL('../assets/js/features/characters/forms.js', import.meta.url), 'utf8');
const spells = readFileSync(new URL('../assets/js/features/characters/spells.js', import.meta.url), 'utf8');

test('supprimer un sort restaure uniquement ce sort et revient en arrière si Firestore refuse', () => {
  assert.match(forms, /async function _commitDeckSorts[\s\S]*c\.deck_sorts = rollback;/);
  assert.match(forms, /restored\.splice\(Math\.min\(idx, restored\.length\), 0, removed\)/);
  assert.doesNotMatch(forms, /_restoreDeckSorts\(c, prev\)/);
});

test('annuler une duplication retire uniquement la copie créée', () => {
  assert.match(forms, /current\.filter\(sort => sort\.id !== clone\.id\)/);
  assert.match(forms, /Duplication annulée\./);
});

test('une catégorie supprimée et ses rattachements peuvent être restaurés sans écraser un reclassement', () => {
  assert.match(spells, /affectedIds = new Set/);
  assert.match(spells, /wasAffected && !spell\.catId \? \{ \.\.\.spell, catId: cat\.id \} : spell/);
  assert.match(spells, /c\.sort_cats = previousCats;\s*c\.deck_sorts = previousSorts;/s);
});

test('renommer ou recolorer une catégorie revient à sa valeur précédente en cas d’échec', () => {
  const rollbacks = spells.match(/c\.sort_cats = previous;/g) || [];
  assert.ok(rollbacks.length >= 2);
  assert.match(spells, /async function _renameSortCat[\s\S]*_renderSpellsTab\(c\)/);
  assert.match(spells, /async function _recolorSortCat[\s\S]*_renderSpellsTab\(c\)/);
});

test('les quêtes personnelles sont annulables et leurs toggles reviennent en arrière sur erreur', () => {
  assert.match(forms, /export async function toggleQuete[\s\S]*if \(!await trySave\('characters',c\.id,\{quetes\}\)\) c\.quetes = previous;/);
  assert.match(forms, /export async function deleteQuete[\s\S]*restored\.splice\(Math\.min\(index, restored\.length\), 0, removed\)/);
  assert.match(forms, /Quête supprimée —/);
});
