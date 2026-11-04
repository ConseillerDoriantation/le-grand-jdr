import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const bestiary = read('../assets/js/features/bestiary.js');
const styles = read('../assets/css/bestiary.css');

test('le MJ peut sélectionner les créatures filtrées et agir par lot', () => {
  assert.match(bestiary, /const _bstBulkSelected = new Set\(\)/);
  assert.match(bestiary, /data-bst-action="bulkSelectFiltered"/);
  assert.match(bestiary, /data-bst-action="bulkRank"/);
  assert.match(bestiary, /data-bst-action="bulkVisibility"/);
  assert.match(bestiary, /STORE\.creatures\.filter\(creature => _beastMatchesFilters\(creature\)\)/);
});

test('les changements groupés utilisent les lots existants et restent annulables', () => {
  const start = bestiary.indexOf('async function _bstApplyBulk');
  const end = bestiary.indexOf('\nfunction _render()', start);
  const implementation = bestiary.slice(start, end);
  assert.match(implementation, /batchUpdateInCol\(updates\.slice\(index, index \+ 450\)\)/);
  assert.match(implementation, /label: '↶ Annuler'/);
  assert.match(implementation, /Action groupée annulée/);
  assert.doesNotMatch(implementation, /loadCollection|getDocData|watchPage/);
});

test('le mode sélection neutralise le tri et reste identifiable visuellement', () => {
  assert.match(bestiary, /&& !_bstBulkMode[\s\S]{0,180}STORE\.bestiaireId === 'main'/);
  assert.match(bestiary, /<article class="bst-bc/);
  assert.match(bestiary, /data-bst-action="bulkToggle"/);
  assert.match(styles, /\.bst-bc\.is-selected/);
  assert.match(styles, /\.bst-bulkbar/);
});
