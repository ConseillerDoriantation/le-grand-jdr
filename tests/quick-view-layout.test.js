import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('quick-view v2 reprend les cinq zones de la maquette sans emoji décoratif', () => {
  const source = read('assets/js/features/characters/quick-view.js');
  for (const label of ['Ton personnage', 'Joué par', 'En main', 'Protection', 'Sorts préparés', 'Maîtrises', 'Lecture seule']) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /qv-ring[^]*stroke-dasharray/);
  assert.match(source, /_vital\('PV'[^]*_vital\('PM'/);
  assert.match(source, /STAT_META\.map/);
  assert.doesNotMatch(source, /⚔️ Armement|🛡️ Équipement|✨ Sorts|🎯 Maîtrises/);
});

test('quick-view v2 réemploie les calculs métier et ne déclenche aucune lecture', () => {
  const source = read('assets/js/features/characters/quick-view.js');
  for (const helper of [
    'getMainWeapon', 'getWeaponToucherParts', 'getWeaponDegatsParts',
    'getArmorSetData', 'getEquipmentSlots', 'spellVM', 'calcCA',
    'calcVitesse', 'calcPVMax', 'calcPMMax', 'calcPalier', 'canControlCharacter',
  ]) assert.match(source, new RegExp(`\\b${helper}\\b`));
  assert.doesNotMatch(source, /loadCollection|loadDamageTypes|loadRarities|getDocData|subscribeCollection|watchPage/);
  assert.match(source, /c\.hp \?\? c\.pvActuel \?\? pvMax/);
  assert.match(read('assets/js/shared/damage-types.js'), /export function getDamageTypes\(\)[^]*_damageTypes \|\| _defaultDamageTypesForAdventure/);
});

test('quick-view v2 navigue dans la liste d origine au clic et au clavier', () => {
  const source = read('assets/js/features/characters/quick-view.js');
  const pages = read('assets/js/features/pages.js');
  assert.match(source, /quickViewChar\(id, \{ list \} = \{\}\)/);
  assert.match(source, /data-action="_qvPrev"/);
  assert.match(source, /data-action="_qvNext"/);
  assert.match(source, /event\.key === 'ArrowLeft'[^]*event\.key === 'ArrowRight'/);
  assert.match(source, /masteries\.slice\(0, 5\)/);
  assert.match(pages, /characterIds: \(\) => \(STATE\.isAdmin \? allChars : controlledChars\(\)\)\.map/);
  assert.match(pages, /quickViewChar\(id, \{ list: _dashUi\?\.characterIds\?\.\(\) \|\| \[\] \}\)/);
});

test('quick-view v2 garde deux colonnes et se replie sous 560 px', () => {
  const css = read('assets/css/quick-view.css');
  assert.match(css, /\.modal:has\(\.qv-root\)\{[^}]*height:min\(760px,calc\(100dvh - 40px\)\)/);
  assert.match(css, /\.qv-root\{[^}]*height:100%;min-height:0/);
  assert.match(css, /\.qv-bd\{[^}]*flex:1 1 auto[^}]*scrollbar-gutter:stable/);
  assert.match(css, /\.qv-cols\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(css, /@container \(max-width:560px\)/);
  assert.match(css, /\.qv-vit\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\) 72px 72px/);
  assert.match(css, /\.qv-ft\{[^}]*border-top:1px solid var\(--border\)/);
});
