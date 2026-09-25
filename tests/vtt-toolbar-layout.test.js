import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vtt = readFileSync(new URL('../assets/js/features/vtt/vtt.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/vtt.css', import.meta.url), 'utf8');

test('le rail VTT utilise les icônes SVG et conserve les outils historiques', () => {
  assert.match(vtt, /const _VTT_TOOL_ICON_PATHS = \{/);
  assert.match(vtt, /data-tool="\$\{tool\}" data-vtt-fn="_vttTool"/);
  assert.match(vtt, /id="vtt-draw-fill-btn"/);
  assert.match(vtt, /id="vtt-draw-undo-btn"/);
  assert.match(vtt, /id="vtt-fog-toggle"/);
  assert.match(vtt, /id="vtt-vision-unlimited-toggle"/);
  assert.match(vtt, /data-vtt-fn="_vttToggleVisionUnlimited"/);
  assert.match(vtt, /STATE\.isAdmin \? `<section id="vtt-walls-bar"/);
  assert.match(vtt, /data-lock-visibility="always"/);
  assert.match(vtt, /data-lock-visibility="discover"/);
  assert.match(vtt, /Lire la carte/);
  assert.match(vtt, /vttStructureLegendSvg/);
});

test('la portée illimitée est configurable par scène sans couper les murs', () => {
  assert.match(vtt, /id="\$\{pfx\}vision-unlimited"/);
  assert.match(vtt, /visionUnlimited:!!p\.visionUnlimited/);
  assert.match(vtt, /const patch = \{name,folder,cols,rows,fogEnabled,visionUnlimited\}/);
  assert.match(vtt, /Les murs bloquent toujours la vue/);
});

test('les panneaux contextuels sont uniques, repliables et persistants', () => {
  assert.match(vtt, /const _VTT_TOOL_PANEL_STORAGE = 'vtt-tool-panels-v1'/);
  assert.match(vtt, /class="vtt-tool-panel[^\"]*" data-panel="ruler"/);
  assert.match(vtt, /class="vtt-tool-panel[^\"]*" data-panel="draw"/);
  assert.match(vtt, /class="vtt-tool-panel[^\"]*" data-panel="walls"/);
  assert.match(vtt, /class="vtt-tool-panel[^\"]*" data-panel="keys"/);
  assert.match(css, /\.vtt-tool-panel\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /\.vtt-tool-panel\.is-collapsed/);
});

test('les raccourcis V R D M X et point interrogation pilotent le rail', () => {
  for (const key of ['r','v','d','m','x']) assert.match(vtt, new RegExp(`e\\.key==='${key}'`));
  assert.match(vtt, /e\.key === '\?'/);
  assert.match(vtt, /if \(_vttToolPanel === 'keys'\)/);
  assert.match(vtt, /_vttRailButton\('center','Recentrer','X'/);
  assert.match(vtt, /shortcutRow\('Recentrer sur mon personnage',\['X'\]\)/);
});

test('le rail se compacte sur les écrans peu hauts et reste ancré à droite', () => {
  assert.match(css, /\.vtt-tool-float\s*\{[\s\S]*?right:\s*12px\s*!important[\s\S]*?left:\s*auto\s*!important/);
  assert.match(css, /@media \(max-height:\s*560px\)[\s\S]*?width:\s*34px\s*!important[\s\S]*?height:\s*34px\s*!important/);
});
