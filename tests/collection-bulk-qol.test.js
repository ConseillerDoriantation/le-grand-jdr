import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const runtime = read('../assets/js/features/collection/runtime.js');
const data = read('../assets/js/features/collection/data.js');
const styles = read('../assets/css/collection.css');

test('la table MJ gère sélection simple, plage, lot et clavier sans relecture', () => {
  assert.match(runtime, /e\.shiftKey && S\.anchor/);
  assert.match(runtime, /e\.ctrlKey \|\| e\.metaKey/);
  assert.match(runtime, /mod && k\.toLowerCase\(\) === 'a'/);
  assert.match(runtime, /A\['b-etat'\]/);
  assert.match(runtime, /A\['b-mask'\]/);
  assert.match(runtime, /CH\['b-serie'\]/);
  const tableStart = runtime.indexOf('function visibleItems');
  const tableEnd = runtime.indexOf('/* ── inspecteur', tableStart);
  assert.doesNotMatch(runtime.slice(tableStart, tableEnd), /loadCollection|getDocData|watchPage/);
});

test('les changements groupés conservent la séparation public-secret', () => {
  assert.match(data, /writeInSafeBatches\(preparedItems\.map\(item => \(\{ col: 'collection_secret'/);
  assert.match(data, /writeInSafeBatches\(preparedItems\.map\(item => \(\{ col: 'collection'/);
  assert.match(data, /publicProjection\(item, shelfById\.get\(item\.shelf\)\)/);
  assert.match(data, /if \(!revealed\) return projected/);
  assert.match(data, /field\.vis === 'pj'/);
});

test('la table neutralise le tri filtré et montre clairement la sélection', () => {
  assert.match(runtime, /if \(filtering\(\)\) \{ e\.preventDefault\(\)/);
  assert.match(runtime, /Réordonner est suspendu/);
  assert.match(runtime, /tile .*\$\{sel \? 'sel' : ''\}/);
  assert.match(styles, /\.tile\.sel \.art/);
  assert.match(styles, /\.t-chk/);
});
