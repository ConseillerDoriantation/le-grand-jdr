import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const artisan = readFileSync(new URL('../assets/js/features/artisan.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/shop.css', import.meta.url), 'utf8');

test('la page Artisan utilise les trois colonnes du handoff sans ancien bandeau dupliqué', () => {
  assert.match(artisan, /class="art-shell"[\s\S]*art-equipment-pane[\s\S]*art-workbench-pane[\s\S]*art-resources-pane/);
  const inlineRender = artisan.slice(artisan.indexOf('if (inlineRoot)'), artisan.indexOf("openModal('🔨 Artisan"));
  assert.doesNotMatch(inlineRender, /sh-tool-heading--artisan|\$\{toolbar\}/);
  assert.match(css, /\.sh-artisan-page \.art-shell \{[^}]*grid-template-columns:300px minmax\(480px,1fr\) 300px/);
});

test('les objets affichent leur image inventaire avec repli sur le catalogue Boutique', () => {
  assert.match(artisan, /import \{ getInventoryItemImage, shopItemToInvEntry \}/);
  assert.match(artisan, /return getInventoryItemImage\(item, _catalogItem\(item\)\)/);
  assert.match(artisan, /_artisanItemVisual\(it, cat\)/);
  assert.match(artisan, /_artisanItemVisual\(item, cat, 'art-hero-image'\)/);
  assert.match(css, /\.sh-artisan-page \.art-item-visual img \{[^}]*object-fit:cover/);
});

test('l établi garde l ordre Traits Stats Reforge Démonter et les confirmations intégrées', () => {
  const workbench = artisan.slice(artisan.indexOf('function _renderWorkbench'), artisan.indexOf('function _renderOperationPanel'));
  const traits = workbench.indexOf('_renderTraitsSection');
  const stats = workbench.indexOf('_renderStatsSection');
  const reforge = workbench.indexOf('_renderReforgeSection');
  const dismantle = workbench.indexOf('_renderRecycleSection');
  assert.ok(traits < stats && stats < reforge && reforge < dismantle);
  assert.match(artisan, /_renderOperationPanel\(item, invIndex, c, cat, 'trait'\)/);
  assert.match(artisan, /_renderOperationPanel\(item, invIndex, c, 'Anneau', 'stat'\)/);
  assert.match(artisan, /_renderOperationPanel\(item, invIndex, c, cat, 'dismantle'\)/);
});

test('les capacités montrent les emplacements verrouillés et leur rareté de déblocage', () => {
  assert.match(artisan, /unlockRarity\(item, 'traits', index \+ 1, s\)/);
  assert.match(artisan, /class="art-trait-slot is-locked"/);
  assert.match(artisan, /class="art-mini-meter is-\$\{tone\}"/);
  assert.match(css, /\.sh-artisan-page \.art-mini-meter i\.is-locked/);
});

test('le responsive Artisan passe à deux puis une colonne et utilise les container queries', () => {
  assert.match(css, /@media \(max-width:1320px\)[\s\S]*?grid-template-areas:'equipment workbench' 'resources workbench'/);
  assert.match(css, /@media \(max-width:1080px\)[\s\S]*?\.art-shell \{ display:flex; flex-direction:column;/);
  assert.match(css, /@container \(max-width:620px\)[\s\S]*?\.art-stat-choices\{grid-template-columns:repeat\(3,1fr\)/);
});
