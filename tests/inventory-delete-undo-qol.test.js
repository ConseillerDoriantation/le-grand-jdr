import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../assets/js/features/characters/inventory.js', import.meta.url), 'utf8');

test('la suppression d’inventaire sauvegarde aussi équipement, build et historique pour restauration', () => {
  assert.match(source, /const previousState = \{[\s\S]*inventaire:[\s\S]*equipement:[\s\S]*statsBonus:[\s\S]*builds:[\s\S]*inventoryHistory:/);
  assert.match(source, /builds: characterBuildsForStorage\(current\)/);
  assert.match(source, /label:\s*'↶ Annuler'/);
});

test('l’annulation refuse d’écraser un inventaire modifié après la suppression', () => {
  assert.match(source, /const unchanged = \['inventaire', 'equipement', 'statsBonus', 'activeBuildId', 'inventoryHistory'\]/);
  assert.match(source, /L’inventaire a changé depuis : annulation automatique impossible\./);
});

test('un échec de suppression ou de restauration remet l’état local cohérent', () => {
  assert.match(source, /else \{\s*Object\.assign\(c, previousState\);\s*\}/s);
  assert.match(source, /if \(!await trySave\('characters', charId, restorePayload\)\) \{\s*Object\.assign\(current, beforeUndo\)/s);
});
