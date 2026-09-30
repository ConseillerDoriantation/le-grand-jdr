import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const shop = fs.readFileSync(new URL('../assets/js/features/shop.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../assets/css/shop.css', import.meta.url), 'utf8');

test('le catalogue expose un panier local avec paiement groupé atomique', () => {
  assert.match(shop, /let _cart = new Map\(\)/);
  assert.match(shop, /function _applyPurchase\(char, item, qty, draft/);
  assert.match(shop, /await batchUpdateInCol\(updates\)/);
  assert.match(shop, /data-sh-action="cartPay"/);
  assert.match(shop, /class="shc-step/);
});

test('la vue Tout rend une sélection puis une étagère par catégorie', () => {
  assert.match(shop, /function _renderHomeShelves/);
  assert.match(shop, /Sélection pour/);
  assert.match(shop, /_shopRecommendationCompatible/);
  assert.match(shop, /Selon ton équipement et tes caractéristiques/);
  assert.match(shop, /class="shc-shelf-row"/);
  assert.match(css, /\.shc-shelf-row\s*\{[^}]*grid-auto-flow:\s*column;[^}]*scroll-snap-type:\s*x mandatory;/s);
});

test('la fiche article est un panneau latéral et propose la reprise', () => {
  const detail = shop.match(/function _renderDetailPanelHtml\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(detail, /shc-detail-sheet|shc-detail-hero/);
  assert.match(detail, /data-sh-action="cartTrade"/);
  assert.match(detail, /_buyBtnHtml\(item, !!ctx\.char, st, \{ detail: true \}\)/);
  assert.doesNotMatch(detail, /pushModal/);
  assert.match(css, /\.shc-detail-sheet\s*\{[^}]*position:\s*fixed;[^}]*width:\s*min\(440px, 100vw\)/s);
});

test('les onglets utilisent des icônes SVG et le portefeuille affiche le solde projeté', () => {
  assert.match(shop, /_shopIcon\('bag'\)\} Boutique/);
  assert.match(shop, /_shopIcon\('wand'\)\} Atelier/);
  assert.match(shop, /_shopIcon\('hammer'\)\} Artisan/);
  assert.match(shop, /après panier/);
  assert.match(shop, /sh-char-picker-gold/);
});

test('les deux premiers groupes de tags sont visibles directement en catégorie', () => {
  assert.match(shop, /const inlineGroups = categoryGroups\.slice\(0, 2\)/);
  assert.match(shop, /id="sh-inline-filters"/);
  assert.match(css, /\.shc-inline-filters\s*\{/);
});
