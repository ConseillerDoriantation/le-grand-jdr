import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const achievements = read('../assets/js/features/achievements.js');
const pages = read('../assets/js/features/pages.js');
const styles = read('../assets/css/features.css');

test('le MJ peut sélectionner les hauts-faits filtrés et les reclasser', () => {
  assert.match(pages, /data-action="_achToggleBulkMode"/);
  assert.match(achievements, /const _achBulkSelected = new Set\(\)/);
  assert.match(achievements, /data-action="_achBulkSelectFiltered"/);
  assert.match(achievements, /data-change="_achBulkCategory"/);
  assert.match(achievements, /ACH_CATS\.some\(category => category\.id === categoryId\)/);
});

test('le classement groupé écrit par lots dans la bonne collection sans lecture', () => {
  const persistStart = achievements.indexOf('async function _achPersistCategories');
  const persistEnd = achievements.indexOf('\nasync function _achApplyBulkCategory', persistStart);
  const persistence = achievements.slice(persistStart, persistEnd);
  assert.match(persistence, /secretIds\.has\(item\.id\) \? 'achievements_secret' : 'achievements'/);
  assert.match(persistence, /batchUpdateInCol\(updates\.slice\(index, index \+ 450\)\)/);

  const applyStart = achievements.indexOf('async function _achApplyBulkCategory');
  const applyEnd = achievements.indexOf('\nfunction _achCompactImageSignature', applyStart);
  const implementation = achievements.slice(applyStart, applyEnd);
  assert.match(implementation, /label: '↶ Annuler'/);
  assert.match(implementation, /_achPersistCategories\(before\)/);
  assert.doesNotMatch(implementation, /loadCollection|getDocData|watchPage/);
});

test('le mode sélection neutralise le tri et reste accessible', () => {
  assert.match(achievements, /const canManualSort = !_achBulkMode/);
  assert.match(achievements, /data-action="\$\{_achBulkMode \? '_achToggleBulkSelection' : '_achOpenLightbox'\}"/);
  assert.match(achievements, /aria-pressed="\$\{_achBulkMode \? String\(selected\) : 'false'\}"/);
  assert.match(styles, /\.ach-item\.is-selected/);
  assert.match(styles, /\.ach-bulkbar/);
  assert.match(styles, /\.ach-bulk-check\.is-on/);
});
