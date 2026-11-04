import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const collection = read('../assets/js/features/collection.js');
const firestore = read('../assets/js/data/firestore.js');
const styles = read('../assets/css/features.css');

test('le MJ peut sélectionner les cartes et modifier leur révélation par lot', () => {
  assert.match(collection, /const _bulkSelected = new Set\(\)/);
  assert.match(collection, /data-action="selectAllCollectionCards"/);
  assert.match(collection, /data-action="bulkCollectionUnlock"/);
  assert.match(collection, /data-action="bulkCollectionChallenge"/);
  assert.match(collection, /STORE\.cards\.filter\(card => _bulkSelected\.has\(card\.id\)\)/);
});

test('les changements groupés conservent la séparation public-secret et restent annulables', () => {
  const start = collection.indexOf('async function _persistCardBatch');
  const end = collection.indexOf('\n// MJ : source', start);
  const persistence = collection.slice(start, end);
  assert.match(persistence, /batchSaveInCol\(secret\.slice\(index, index \+ 450\)\)/);
  assert.match(persistence, /batchReplaceInCol\(publicCards\.slice\(index, index \+ 450\)\)/);

  const applyStart = collection.indexOf('async function _applyCollectionBulk');
  const applyEnd = collection.indexOf('\n// ── Rendu principal', applyStart);
  const implementation = collection.slice(applyStart, applyEnd);
  assert.match(implementation, /label: '↶ Annuler'/);
  assert.match(implementation, /_persistCardBatch\(before\)/);
  assert.doesNotMatch(implementation, /loadCollection|getDocData|watchPage/);
});

test('le remplacement groupé Firestore retire réellement les anciens champs publics', () => {
  const start = firestore.indexOf('export async function batchReplaceInCol');
  const end = firestore.indexOf('\nexport async function deleteFromCol', start);
  const implementation = firestore.slice(start, end);
  assert.match(implementation, /batch\.set\(doc\(db, path, id\), data\)/);
  assert.doesNotMatch(implementation, /merge:\s*true/);
  assert.match(implementation, /_cachePatchReplace\(path, id, data\)/);
});

test('le mode sélection neutralise le tri et affiche une sélection accessible', () => {
  assert.match(collection, /STATE\.isAdmin && !_bulkMode/);
  assert.match(collection, /_sortable\?\.destroy\?\.\(\)/);
  assert.match(collection, /aria-pressed="\$\{_bulkSelected\.has\(c\.id\)\}"/);
  assert.match(styles, /\.coll-admin-card\.is-selected/);
  assert.match(styles, /\.coll-bulkbar/);
  assert.match(styles, /\.coll-admin-select\.is-on/);
});
