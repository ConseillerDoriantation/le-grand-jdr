import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bestiary = readFileSync(new URL('../assets/js/features/bestiary.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../assets/css/bestiary.css', import.meta.url), 'utf8');

test('une ligne de butin peut ouvrir le sélecteur en édition', () => {
  assert.match(bestiary, /data-bst-action="pickerEdit"[^>]+data-idx="\$\{i\}"/);
  assert.match(bestiary, /pickerEdit:\s*\(el\)\s*=>\s*_bstButinPickerOpen\(el\.dataset\.id, parseInt\(el\.dataset\.idx\)\)/);
  assert.match(styles, /\.bst-lactions\s*\{[^}]*display:\s*flex/);
});

test('remplacer un objet conserve quantité et chance sans créer de doublon', () => {
  assert.match(bestiary, /butins\.some\(\(b, index\)\s*=>\s*b\.itemId === item\.id && \(!editing \|\| index !== editIndex\)\)/);
  assert.match(bestiary, /quantite:\s*previous\?\.quantite \|\| '1'/);
  assert.match(bestiary, /chance:\s*previous\?\.chance\s*\|\| '100%'/);
  assert.match(bestiary, /if \(editing\) butins\[editIndex\] = next;\s*else butins\.push\(next\);/);
});
