import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const runtime = read('../assets/js/features/collection/runtime.js');
const data = read('../assets/js/features/collection/data.js');
const navigation = read('../assets/js/core/navigation.js');
const css = read('../assets/css/collection.css');

test('les cinq modèles et leurs ratios sont proposés', () => {
  for (const model of ['carte', 'objet', 'document', 'image', 'fragments']) {
    assert.match(runtime, new RegExp(`${model}: \\{`));
  }
  for (const ratio of ['2:3', '3:4', '1:1', '4:3', '16:9']) assert.match(runtime, new RegExp(`'${ratio}'`));
});

test('la projection publique exclut les champs MJ et les champs masqués', () => {
  assert.match(data, /filter\(field => field\.vis === 'pj'\)/);
  assert.match(data, /!masks\.includes\(id\)/);
  assert.match(data, /if \(!revealed\) return projected/);
  assert.match(data, /kind: 'shelf-settings'/);
  assert.match(data, /data\.champs = \(data\.champs \|\| \[\]\)\.filter\(field => field\.vis === 'pj'\)/);
});

test('migration et nouvelles visites restent idempotentes et locales', () => {
  assert.match(data, /filter\(item => !secretById\.has\(item\.id\)\)/);
  assert.match(data, /migrated: persistable\.length > 0/);
  assert.match(data, /lgjdr:collection:last-visit/);
  const visitStart = data.indexOf('export function markVisited');
  const visitEnd = data.indexOf('\n}', visitStart) + 2;
  assert.doesNotMatch(data.slice(visitStart, visitEnd), /saveDoc|loadCollection|updateInCol/);
});

test('la migration borne les anciennes images et ne peut plus bloquer la page', () => {
  assert.match(data, /FIRESTORE_SAFE_BYTES = 900_000/);
  assert.match(data, /FIRESTORE_SAFE_BATCH_BYTES = 8_000_000/);
  assert.match(data, /prepareItemForFirestore/);
  assert.match(data, /maxBytes: 440_000/);
  assert.match(data, /migration historique différée/);
  assert.match(data, /item\.kind !== 'item' \|\| Number\(item\.version \|\| 0\) < 2/);
  assert.match(data, /persistable\.map\(item => \(\{ col: 'collection_secret'[\s\S]{0,180}batchReplaceInCol/);
  assert.match(data, /migration\.items \|\| \[\.\.\.new Map/);
  assert.match(data, /texte: String\(raw\.texte \|\| ''\)/);
  assert.match(runtime, /compressDataUrl\(cropped/);
});

test('la nouvelle feuille dédiée est chargée seulement sur Collection et reste scopée', () => {
  assert.match(navigation, /collection:\s*\['collection\.css'\]/);
  assert.equal((navigation.match(/collection:\s*\[/g) || []).length, 1);
  assert.match(css, /@scope \(\.collection-redesign\)/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) 372px/);
  assert.match(css, /position:sticky/);
});

test('la page Collection remplace bien le conteneur principal de l application', () => {
  assert.match(runtime, /document\.getElementById\('main-content'\)/);
  assert.doesNotMatch(runtime, /document\.getElementById\('content'\)/);
  assert.match(runtime, /host\.innerHTML = collectionShell\(\)/);
});

test('les interactions du handoff sont présentes', () => {
  assert.match(runtime, /registerActions\(\{/);
  assert.match(runtime, /data-action="collectionDispatch"/);
  assert.match(runtime, /Révéler en présentant/);
  assert.match(runtime, /data-a="reveal-all"/);
  assert.match(runtime, /data-series-drag/);
  assert.match(runtime, /data-shelf-drag/);
  assert.match(runtime, /k === 'Delete' \|\| k === 'Backspace'/);
  assert.match(runtime, /k === 'r' \|\| k === 'R'/);
  assert.match(runtime, /k === 'p' \|\| k === 'P'/);
});
