import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const feature = readFileSync(new URL('assets/js/features/characters/inventory.js', root), 'utf8');
const sheet = readFileSync(new URL('assets/js/features/characters.js', root), 'utf8');
const css = readFileSync(new URL('assets/css/characters.css', root), 'utf8');

test('l onglet inventaire actif utilise la vue Porté Ceinture Sac', () => {
  assert.match(sheet, /inv:\s*\(\)\s*=>\s*renderCharInventaire\(c, canEdit\)/);
  const worn = feature.indexOf('🧍 Porté');
  const belt = feature.indexOf('🧪 Ceinture');
  const bag = feature.indexOf('🎒 Sac');
  assert.ok(worn >= 0 && belt > worn && bag > belt);
  assert.match(feature, /const slots = getEquipmentSlots\(\)/);
});

test('la vue conserve recherche tris nouveautés et actions contextuelles', () => {
  for (const marker of [
    'data-input="_charInvSearch"',
    'data-action="_invSetSort"',
    'data-action="_invToggleNew"',
    'data-action="_invToggleBelt"',
    'data-action="_invConsumeOne"',
    'data-action="openInventoryReadableContent"',
  ]) assert.ok(feature.includes(marker), marker);
  assert.match(feature, /Un objet de quête ne peut pas être supprimé/);
  assert.match(feature, /<small>Bourse<\/small><strong>\$\{calcOr\(c\)\.toLocaleString\('fr-FR'\)\} or<\/strong>/);
  assert.doesNotMatch(feature, /<small>Bourse<\/small><strong>\$\{Number\(c\.or/);
});

test('le détail devient une feuille basse sous 900 px sans casser le sticky desktop', () => {
  assert.match(css, /\.cs-v3 \.main-col:has\(\.inv5-shell\)\s*\{[\s\S]*?overflow:\s*clip/);
  assert.match(css, /\.cs-v3 \.inv5-detail\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(css, /top:\s*calc\(var\(--top-h/);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*?\.cs-v3 \.inv5-detail\s*\{[\s\S]*?position:\s*fixed/);
  assert.match(css, /\.cs-v3 \.inv5-sheet-backdrop/);
});

test('la répartition, la fiche objet et la ceinture reprennent les composants de la maquette', () => {
  for (const marker of [
    'inv5-distribution-track',
    'inv5-detail-hero',
    'inv5-detail-body',
    'inv5-detail-facts',
    'inv5-zone--belt',
    'inv5-summary',
    'inv5-top-actions',
    'inv5-left',
    'inv5-detail-image',
    'inv5-detail-hero-content',
  ]) assert.ok(feature.includes(marker), marker);
  assert.match(css, /\.cs-v3 \.inv5-distribution-track/);
  assert.match(css, /\.cs-v3 \.inv5-zone--belt/);
  assert.match(css, /\.cs-v3 \.inv5-detail-facts\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
  assert.match(css, /\.cs-v3 \.inv5-value-panel > h3\s*\{[^}]*font:\s*700 15px/);
  assert.match(css, /\.cs-v3 \.inv5-distribution button\.inv5-distribution-row\s*\{[^}]*grid-template-columns:\s*110px 116px 55px/);
  assert.match(feature, /class="inv5-new-filter[\s\S]*?<i aria-hidden="true"><\/i>/);
  assert.match(css, /\.cs-v3 \.inv5-detail-hero\.has-image/);
  assert.match(feature, /getInventoryItemImage\(item, catalogItem\)/);
  assert.ok(feature.indexOf('<header class="inv5-topbar">') < feature.indexOf('<main class="inv5-content">'));
  assert.match(feature, /function _patchInventorySelection\(\)/);
  assert.match(feature, /function _invSelectItem[\s\S]*?_patchInventorySelection\(\)/);
});

test('le sac utilise des filtres compacts, des catégories valorisées et un point pour Nouveau', () => {
  for (const marker of [
    'inv5-group-chevron',
    'inv5-group-icon',
    'inv5-item-new',
    'inv5-quest-tag',
    'inv5-item-qty',
    'inv5-item-value',
  ]) assert.ok(feature.includes(marker), marker);
  assert.doesNotMatch(feature, /isNew\(group\) \? '<i>Nouveau<\/i>'/);
  assert.match(feature, /const value = cat\.items\.reduce/);
  assert.match(css, /\.cs-v3 \.inv5-zone--bag/);
  assert.match(css, /\.cs-v3 button\.inv5-chip/);
  assert.match(css, /\.cs-v3 \.inv5-item-new\s*\{[^}]*border-radius:\s*50%/);
  assert.match(sheet, /if \(!samePanel\)[\s\S]*?area\.classList\.add\('cs-tab-fadein'\)/);
});
