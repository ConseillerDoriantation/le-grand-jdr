import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const entry = read('assets/js/features/collection.js');
const runtime = read('assets/js/features/collection/runtime.js');
const data = read('assets/js/features/collection/data.js');
const css = read('assets/css/collection.css');
const crop = read('assets/js/shared/image-crop.js');

test('la refonte Collection est modulaire et reste chargée par l entrée historique', () => {
  assert.match(entry, /renderCollectionPage.*collection\/runtime\.js/);
  for (const file of ['data.js', 'table.js', 'inspector.js', 'settings.js', 'player.js', 'present.js']) {
    assert.equal(existsSync(new URL(`assets/js/features/collection/${file}`, root)), true, file);
  }
});

test('une carte peut utiliser un dos propre cadré sans l ajouter à la bibliothèque', () => {
  assert.match(runtime, /target\?\.face === 'back' \? 5 \/ 7/);
  assert.match(runtime, /panZoomCropHTML/);
  assert.match(runtime, /attachPanZoomCrop/);
  assert.match(runtime, /dosUrl = fl\[0\]\.url/);
  assert.match(runtime, /it\.dos = ''/);
  assert.match(data, /if \(item\.dosUrl\) projected\.backImageUrl = item\.dosUrl/);
  assert.match(crop, /constrainCover/);
});

test('le MJ distingue recto, dos unique et dos hérités', () => {
  assert.match(runtime, /if \(it\.dosUrl\) return it\.dosUrl/);
  assert.match(runtime, /Dos unique \(importé\)/);
  assert.match(runtime, /data-v="back"/);
  assert.match(runtime, /defBackName/);
  assert.match(css, /\.faces/);
  assert.match(css, /\.pcard\.flip/);
});

test('recherche et filtres travaillent sur le cache local', () => {
  const start = runtime.indexOf('function visibleItems');
  const end = runtime.indexOf('function hl', start);
  const visible = runtime.slice(start, end);
  assert.match(visible, /itemsOf\(sh\)\.filter/);
  assert.doesNotMatch(visible, /loadCollection|saveDoc|watch/);
  assert.match(runtime, /data-in="q"/);
  assert.match(runtime, /data-a="flt"/);
  assert.match(css, /\.lt-bar/);
});

test('les fragments publics ne reçoivent que leur pièce révélée', () => {
  assert.match(data, /fragment-source/);
  assert.match(data, /if \(data\.frag\) data\.frag = \{ \.\.\.data\.frag, url: '' \}/);
  assert.match(runtime, /canvas\.toDataURL\('image\/jpeg'/);
  assert.match(runtime, /if \(it\.front\) return `background-image/);
});
