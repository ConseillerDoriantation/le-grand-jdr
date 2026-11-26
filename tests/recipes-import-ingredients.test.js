import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const recipes = readFileSync(new URL('assets/js/features/recipes.js', root), 'utf8');
const styles = readFileSync(new URL('assets/css/recipes.css', root), 'utf8');

test('la modale MJ propose un import JSON complet et groupé', () => {
  assert.match(recipes, /data-a="import"/);
  assert.match(recipes, /id="rcImportFile"[^>]+accept="application\/json,\.json"/);
  assert.match(recipes, /payload\?\.recipes \?\? payload\?\.data\?\.recipes/);
  assert.match(recipes, /await batchSaveInCol\(\[/);
  assert.match(recipes, /copy\.acces = \[\.\.\.new Set/);
});

test('la modale exporte recettes classiques, recettes boutique et références liées', () => {
  assert.match(recipes, /data-a="export"/);
  assert.match(recipes, /format: 'le-grand-jdr-recipes'/);
  assert.match(recipes, /shopRecipes,/);
  assert.match(recipes, /shopItems,/);
  assert.match(recipes, /link\.download = `recettes-\$\{date\}\.json`/);
  assert.match(recipes, /else if \(a === 'export'\) \{ _rcExportFile\(\)/);
});

test('les ingrédients importés sont reliés à la boutique par id ou nom', () => {
  assert.match(recipes, /function _rcResolveShopId\(id, name\)/);
  assert.match(recipes, /STORE\.shopItems\.find\(item => _norm\(item\.nom\) === wanted\)/);
  assert.match(recipes, /shopItemId = _rcResolveShopId\(originalId, item\.shopItemName/);
});

test('un ingrédient existant peut être remplacé sans perdre sa quantité', () => {
  assert.match(recipes, /data-a="editIng"/);
  assert.match(recipes, /const editedIndex = _rcIngredientComboIndex\(kind\)/);
  assert.match(recipes, /quantite: current\?\.quantite \|\| 1/);
  assert.match(recipes, /ing\[editedIndex\] = next/);
  assert.match(styles, /\.rc-edit-ing/);
});

test('les nouvelles actions restent compactes et ne font pas passer la barre sur deux lignes', () => {
  assert.match(styles, /\.rc-lh \{ display: flex; align-items: center;/);
  assert.match(styles, /\.rc-list-tool \{ width: 30px; height: 30px;/);
  assert.match(styles, /\.rc-edit-ing \{ flex: none; width: 24px; height: 24px;/);
  assert.doesNotMatch(styles, /\.rc-lh \{[^}]*flex-wrap:/);
});
