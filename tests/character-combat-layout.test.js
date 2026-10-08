import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sheet = readFileSync(new URL('assets/js/features/characters.js', root), 'utf8');
const css = readFileSync(new URL('assets/css/characters.css', root), 'utf8');

test('le combat suit les trois zones et le panneau de détail de la maquette', () => {
  for (const marker of [
    'cb-hands',
    'cb-style-band',
    'cb-slots',
    'cb-mastery-list',
    'cb-elements',
    'cb-detail',
    'cb-candidates',
  ]) assert.ok(sheet.includes(marker), marker);
  const combat = sheet.slice(sheet.indexOf('function renderCharCombatV3'), sheet.indexOf('// ══════════════════════════════════════════════════════════════════════════════\n// V3 — INVENTAIRE'));
  assert.match(combat, /Armes en main[\s\S]*?Protection[\s\S]*?\$\{masterySection\}\$\{elementsSection\}/);
});

test('les valeurs de combat restent calculées par les helpers métier', () => {
  for (const marker of [
    'getWeaponToucherParts(c, item',
    'getWeaponDegatsParts(c, item',
    'detectCombatStyle?.(c, styles)',
    'getArmorSetData(c)',
    'calcCA(c)',
    'getAttackMissEffect({',
  ]) assert.ok(sheet.includes(marker), marker);
  assert.doesNotMatch(sheet, /const PROF\s*=|const ITEMS\s*=/);
});

test('le détail est sticky sur desktop et devient une feuille basse sous 900 px', () => {
  assert.match(css, /\.cs-v3 \.main-col:has\(\.cb-wrap\)\s*\{[^}]*overflow:\s*clip/);
  assert.match(css, /\.cs-v3 \.cb-detail\s*\{[^}]*position:\s*sticky/);
  assert.match(css, /top:\s*calc\(var\(--top-h\)/);
  assert.match(css, /@container \(max-width:\s*900px\)[\s\S]*?\.cs-v3 \.cb-detail\s*\{[^}]*position:\s*fixed/);
  assert.match(css, /\.cs-v3 \.cb-layout\.is-open \.cb-detail/);
  assert.match(css, /@container \(min-width:\s*1100px\)[\s\S]*?grid-template-columns:\s*minmax\(0,1fr\) 365px/);
});

test('le style actif et les bonus d’équipement restent immédiatement lisibles', () => {
  assert.match(sheet, /const activeStyleKey = String\(activeStyle\?\.id \|\| _norm/);
  assert.match(sheet, /styleKey === activeStyleKey/);
  assert.match(sheet, /cb-style-row\$\{active \? ' is-current'/);
  assert.match(sheet, /active \? '<em>Actif<\/em>'/);
  assert.match(sheet, /const equipmentBonusChips/);
  assert.match(sheet, /badge-chip \$\{_esc\(badge\.cls\)\}/);
  assert.match(css, /\.cs-v3 \.cb-style-row\.is-current\s*\{[^}]*border-color:/);
  assert.match(css, /\.cs-v3 \.cb-item-bonuses \.badge-chip/);
  assert.match(css, /\.cs-v3 \.cb-slot > \.cb-slot-summary\s*\{[^}]*font-size:\s*\.68rem/);
  assert.match(css, /\.cs-v3 \.cb-slots\s*\{[^}]*grid-template-columns:\s*repeat\(3,minmax\(0,1fr\)\)/);
});

test('les traits restent visibles directement sur les slots d armes et de protection', () => {
  assert.match(sheet, /const equipmentTraitChips = values =>/);
  assert.match(sheet, /\$\{bonusChips\}\$\{equipmentTraitChips\(traits\)\}/);
  assert.match(sheet, /equipmentBonusChips\(slotDef\.id, item, ca\)\}\$\{equipmentTraitChips\(traits\)\}/);
  assert.match(css, /\.cs-v3 \.cb-item-traits i\s*\{[^}]*background:\s*var\(--arcane-dim\)/);
});

test('les actions Maîtrises et Types sont alignées à droite de leur en-tête', () => {
  assert.match(css, /\.cs-v3 \.cb-zone-head > \.cb-btn\s*\{[^}]*margin-left:\s*auto/);
});

test('les actions de la maquette réemploient les mutations existantes', () => {
  assert.match(sheet, /data-action="equipInventoryItem"/);
  assert.match(sheet, /data-action="clearEquipSlot"/);
  assert.match(sheet, /data-action="toggleCharElement"/);
  assert.match(sheet, /data-action="setFavoriteElement"/);
  assert.match(sheet, /data-action="openCombatStylesAdmin"/);
  assert.match(sheet, /data-action="openArmorSetsAdmin"/);
});
