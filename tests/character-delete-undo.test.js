import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../assets/js/features/characters/tabs.js', import.meta.url), 'utf8');

function body(name, nextName) {
  const start = source.indexOf(`export async function ${name}`);
  const end = source.indexOf(`export async function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} doit exister`);
  return source.slice(start, end < 0 ? source.length : end);
}

test('les notes supprimées sont restaurables et reviennent localement si la sauvegarde échoue', () => {
  const code = body('deleteNote', 'saveCompteField');
  assert.match(code, /label:\s*'↶ Annuler'/);
  assert.match(code, /if \(!await trySave\('characters', c\.id, \{notesList: c\.notesList\}\)\) \{\s*c\.notesList = previous;/s);
  assert.match(code, /restored\.splice\(Math\.min\(index, restored\.length\), 0, removed\)/);
});

test('une ligne de compte supprimée peut être annulée sans écraser les autres lignes', () => {
  const code = body('deleteCompteRow', 'saveCompteField');
  assert.match(code, /currentList = \[\.\.\.\(currentCompte\[type\] \|\| \[\]\)\]/);
  assert.match(code, /restoredList\.splice\(Math\.min\(index, restoredList\.length\), 0, removed\)/);
  assert.match(code, /Ligne supprimée\./);
});

test('une maîtrise supprimée peut être annulée et un échec conserve la liste précédente', () => {
  const code = body('deleteMaitrise', 'previewXpBar');
  assert.match(code, /c\.maitrises = previous;/);
  assert.match(code, /label:\s*'↶ Annuler'/);
  assert.match(code, /restored\.splice\(Math\.min\(index, restored\.length\), 0, m\)/);
});
