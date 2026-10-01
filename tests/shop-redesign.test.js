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

test('le MJ peut créer une catégorie depuis le bas du rail', () => {
  const rail = shop.match(/function _renderRail\(\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(rail, /STATE\.isAdmin[\s\S]*class="shc-rail-add"[\s\S]*data-sh-action="openCatModal"/);
  assert.match(rail, /Nouvelle catégorie/);
  assert.match(css, /\.shc-rail-add\s*\{/);
});

test('la catégorie se modifie dans une modale haute sans préréglage ni aperçu redondant', () => {
  assert.match(shop, /class="shcat"/);
  assert.doesNotMatch(shop, /class="shcat-preview"/);
  assert.doesNotMatch(shop, /data-sh-action="catPreview"/);
  assert.doesNotMatch(shop, /CAT_EDITOR_PRESETS|Démarrer avec/);
  assert.match(shop, /CAT_EDITOR_EMOJIS/);
  assert.match(css, /\.modal:has\(\.shcat\)\s*\{[^}]*max-width:\s*720px[^}]*height:\s*min\(820px/s);
  assert.doesNotMatch(css, /\.shcat-preview\s*\{/);
});

test('le type Libre est fusionné vers Classique et persisté sans lecture supplémentaire', () => {
  assert.doesNotMatch(shop, /\n\s*libre:\s*\{\s*\n\s*label:/);
  assert.match(shop, /if \(template === 'libre'\) return 'classique'/);
  assert.match(shop, /col: 'shopCategories'[\s\S]*template: 'classique'/);
  assert.match(shop, /col: 'shop'[\s\S]*effet: description, description/);
  assert.match(shop, /_persistLegacyShopTemplates\(cats, items\)/);
});

test('le pied de la modale suit directement l ordre statut annuler et action principale', () => {
  const footer = shop.match(/<footer class="shcat-footer">[\s\S]*?<\/footer>/)?.[0] || '';
  assert.doesNotMatch(footer, /shcat-footer-actions/);
  assert.match(shop, /Modifications non enregistrées/);
  assert.match(shop, /Créer la catégorie/);
  assert.match(shop, /<kbd>Ctrl ↵<\/kbd>/);
  assert.match(shop, /class="ghost" data-sh-action="catClose"/);
  assert.match(shop, /class="primary" data-sh-action="saveCat"/);
  assert.match(css, /\.shcat-footer\s*\{[^}]*min-height:\s*58px[^}]*padding:\s*12px 18px/s);
  assert.match(css, /\.shcat-footer button\s*\{[^}]*height:\s*34px[^}]*font-size:\s*12\.5px[^}]*font-weight:\s*700/s);
});

test('la catégorie persiste couleur et point focal et refuse les noms en double', () => {
  assert.match(shop, /imageFocus:\s*focus/);
  assert.match(shop, /couleur:\s*state\?\.couleur/);
  assert.match(shop, /Une catégorie porte déjà ce nom/);
  assert.match(shop, /background-position:\$\{focus\.x\}% \$\{focus\.y\}%/);
});

test('la suppression inline redirige les articles avant de garder l undo', () => {
  assert.match(shop, /data-sh-action="catDeleteDestination"/);
  assert.match(shop, /await _catBatchMove\(affected, validDestination\)/);
  assert.match(shop, /confirmDelete\('shopCategories'[\s\S]*confirmed:\s*true/s);
  assert.match(shop, /onRestore:\s*async \(\) => \{ if \(affected\.length\) await _catBatchMove\(affected, catId\)/);
});
