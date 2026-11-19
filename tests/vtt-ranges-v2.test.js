import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vtt = readFileSync(new URL('../assets/js/features/vtt/vtt.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/vtt.css', import.meta.url), 'utf8');

test('les portées utilisent des formes agrégées et un seul hit-map de déplacement', () => {
  const moveBlock = vtt.slice(vtt.indexOf('function _showMoveRange'), vtt.indexOf('export function _clearHL'));
  assert.doesNotMatch(moveBlock, /new K\.Rect/);
  assert.equal((moveBlock.match(/_rangeHitNode\(/g) || []).length, 1);
  assert.match(moveBlock, /_rangeDrawContour\(moveKeys, '#7eb0ff', 1\.6/);
  assert.match(vtt, /_rangeDrawContour\(weaponContour, '#f87171', 1\.9/);
  assert.match(vtt, /_rangeDrawContour\(extendedContour, '#a78bfa', 1\.6, \[7,5\]\)/);
  assert.match(vtt, /ctx\.setAttr\('fillStyle', fill\)/);
  assert.match(vtt, /ctx\.setAttr\('strokeStyle', stroke\)/);
  assert.doesNotMatch(moveBlock, /ctx\.(?:fillStyle|strokeStyle|lineWidth|globalAlpha)\s*=/,
    'les styles des formes personnalisées doivent passer par le contexte Konva');
});

test('murs, Contourner, Course et départ de tour partagent le flux v2', () => {
  assert.match(vtt, /RANGE_PATH_MODE_KEY = 'vtt-range-contourner'/);
  assert.match(vtt, /vttWallState\(wall\)/);
  assert.match(vtt, /await _vttCourir\(moveTokenId\)/);
  assert.match(vtt, /marker\.on\('click tap'.*_vttUndoMove\(token\.id\)/s);
  assert.match(vtt, /bonusMvt: 0,\r?\n\s*moveOrigin: deleteField\(\),/);
  assert.ok((vtt.match(/_movementDestination\(/g) || []).length >= 5,
    'clic, drag simple/groupé et clavier doivent utiliser la validation commune');
});

test('le drag retire la portée obsolète et la recalcule après une pile de tokens', () => {
  const dragStart = vtt.slice(vtt.indexOf("g.on('dragstart'"), vtt.indexOf("g.on('dragmove'"));
  const tokenSnapshot = vtt.slice(vtt.indexOf('const makeTokensHandler'), vtt.indexOf('// 7. Annotations'));
  assert.match(dragStart, /_clearHL\(\)/);
  assert.match(tokenSnapshot, /selectedTokenChanged = true/);
  assert.match(tokenSnapshot, /shape\?\.moveToTop\(\);\s*_refreshRanges\(VS\.selected/s);
});

test('survoler un autre token restaure les portées à leur origine', () => {
  const hoverEnemy = vtt.slice(vtt.indexOf('function _rangeHoverEnemy'), vtt.indexOf('function _rangeBindHover'));
  const hoverBinding = vtt.slice(vtt.indexOf('function _rangeBindHover'), vtt.indexOf('function _rangeLegend'));
  assert.match(vtt, /function _rangeTokenAt/);
  assert.match(hoverEnemy, /_rangeRemovePreview\(\)/);
  assert.doesNotMatch(hoverEnemy, /_rangePreviewPath|moveNodes.*opacity|attackNodes.*visible/,
    'une cible ne doit jamais déplacer ou atténuer les portées du token sélectionné');
  assert.match(hoverBinding, /hoveredToken\.type === 'enemy'/);
  assert.match(hoverBinding, /else \{\s*_rangeRemovePreview\(\)/s,
    'un allié doit aussi restaurer la portée au lieu de prévisualiser sa case');
});

test('la légende et les pastilles restent des overlays compacts du canvas', () => {
  assert.match(css, /\.vtt-range-legend\s*\{/);
  assert.match(css, /\.vtt-range-pill\s*\{/);
  assert.match(css, /font:600 11\.5px\/1\.2/);
  assert.match(css, /\.vtt-range-swatch\.blocked/);
  assert.match(css, /\.vtt-range-route:hover,\.vtt-range-route\.active/);
  assert.match(vtt, /mouseleave\.vttRange/);
});
