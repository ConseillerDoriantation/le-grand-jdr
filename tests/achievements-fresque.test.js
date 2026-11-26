import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const feature = read('../assets/js/features/achievements.js');
const pages = read('../assets/js/features/pages.js');
const css = read('../assets/css/features.css');
const responsive = read('../assets/css/responsive.css');

test('la Fresque utilise le moteur absolu et conserve ses préférences', () => {
  assert.match(feature, /buildFresqueLayout/);
  assert.match(feature, /group: \['none', 'mission', 'month'\]/);
  assert.match(feature, /density: \['s', 'm', 'l'\]/);
  assert.match(css, /\.ach-item \{ position:absolute/);
  assert.doesNotMatch(responsive, /\.ach-justified\s*\{\s*display:\s*grid\s*!important/);
});

test('le bandeau expose chapitres densité ordre et création rapide', () => {
  assert.match(pages, /data-ach-group="mission"/);
  assert.match(pages, /data-ach-density="m"/);
  assert.match(pages, /data-ach-order=/);
  assert.match(feature, /event\.key\.toLowerCase\(\) === 'n'/);
  assert.match(feature, /event\.key === '\/'/);
  assert.match(pages, /id="ach-controls-extra"/);
  assert.match(pages, /hall-filter-board[\s\S]*ach-controls-extra[\s\S]*hall-command-search/);
  assert.match(pages, /id="ach-mini-search-input"/);
  assert.match(feature, /_achRemoveMiniFilter/);
  assert.match(css, /\.ach-controls-extra \.ach-extra-bar \{[\s\S]*display:flex/);
  assert.match(css, /\.ach-mobile-fab/);
});

test('les nouveautés, la une, le point focal et la création en série sont câblés', () => {
  assert.match(feature, /createdAt:/);
  assert.match(feature, /featured:/);
  assert.match(feature, /id="ach-focus"/);
  assert.match(feature, /_achNewBannerHtml/);
  assert.match(feature, /_achStartImageSeries/);
  assert.match(feature, /_achFlushSeriesOrder/);
  assert.match(css, /\.ach-series/);
  assert.match(feature, /_achAddSuggestedContributors/);
  assert.match(feature, /_achDeleteFromDrawer/);
  assert.match(feature, /Créer et suivant/);
  assert.match(css, /\.modal:has\(\.achm\)[\s\S]*width:min\(500px,100vw\)/);
  assert.match(css, /\.achm-contrib-grid \{ grid-template-columns:repeat\(auto-fill,minmax\(78px,1fr\)\)/);
  assert.match(feature, /_achImageFormatLabel/);
});

test('la visionneuse ajoute miniatures et diaporama', () => {
  assert.match(feature, /class="ach-lb-strip"/);
  assert.match(feature, /_achToggleSlideshow/);
  assert.match(feature, /_achLightboxStripHtml/);
  assert.match(feature, /_achRestoreLightboxTile/);
  assert.match(feature, /_achAdvanceSlideshow/);
  assert.match(feature, /_achRestartSlideshow/);
  assert.match(css, /\.ach-lb-strip/);
  assert.match(css, /\.ach-lb-card/);
  assert.match(css, /\.ach-lb-slideshow-progress/);
});

test('la frise pilote le scroll du conteneur principal', () => {
  assert.match(feature, /document\.getElementById\('main-content'\)/);
  assert.match(feature, /_achBindRail/);
  assert.match(feature, /setPointerCapture/);
  assert.match(css, /\.ach-rail-thumb/);
});

test('la mini-barre et le rail suivent le scroll sans recalculer deux fois la galerie', () => {
  assert.match(feature, /_achScrollRaf = requestAnimationFrame\(updateProgress\)/);
  assert.match(feature, /_achScrollIdleTimer = setTimeout\(updateActiveItem, 90\)/);
  assert.match(feature, /_achUpdateMiniBar\(topItem\)/);
  assert.match(feature, /_achUpdateRailUi\(topItem, \{ updateProgress: false \}\)/);
  assert.doesNotMatch(feature, /\.map\(element => \(\{ element, distance:/);
  assert.match(pages, /class="ach-mini-art"/);
  assert.match(css, /\.ach-mini\.is-visible \.ach-mini-in/);
  assert.match(feature, /renderEpoch !== _achRenderEpoch/);
});

test('les illustrations sont préparées hors du geste de défilement', () => {
  assert.match(feature, /function _achInstallImageWarmup/);
  assert.match(feature, /active \+ scheduled >= 2/);
  assert.match(feature, /if \(stopped \|\| scrolling/);
  assert.match(feature, /scrollIdleTimer = setTimeout\(\(\) => \{/);
  assert.match(feature, /scrollTarget\.removeEventListener\('scroll', onScroll\)/);
  assert.match(css, /\.ach-item \{[^}]*content-visibility:auto/);
});

test('les actions conservent la vraie position de la galerie', () => {
  assert.match(feature, /const host=_achCurrentScrollHost\(\)/);
  assert.match(feature, /host:isRoot \? 'root' : 'main'/);
  assert.match(feature, /function _achRenderContentPreserveViewport\(options = \{\}, capturedAnchor = null\)/);
  assert.match(feature, /viewportAnchor=_achCaptureViewportAnchor\(\)/);
  assert.match(feature, /_achRenderContentPreserveViewport\(\{\}, viewportAnchor\)/);
  assert.match(feature, /_achRestoreViewportAnchorAfterFrame\(viewportAnchor\)/);
});

test('les contrôles et les overlays utilisent le format du handoff', () => {
  assert.doesNotMatch(pages, /<span>Catégories<\/span>/);
  assert.match(css, /\.ach-player-menu,\.ach-mission-menu[\s\S]*width:320px/);
  assert.match(css, /\.ach-rail-tip-art/);
  assert.match(css, /\.ach-lightbox-rich[\s\S]*grid-template-rows:auto minmax\(0,1fr\) auto/);
  assert.match(css, /--ach-lb-panel-w:clamp\(390px,28vw,520px\)/);
  assert.match(css, /#ach-lightbox \.ach-lb-info[\s\S]*height:100dvh/);
  assert.match(css, /\.ach-lb-frame[\s\S]*grid-template-columns:minmax\(0,1fr\) 380px/);
  assert.match(css, /\.achm-section--illustration \{ order:1/);
  assert.doesNotMatch(feature, /fitFrameToImage/);
});
