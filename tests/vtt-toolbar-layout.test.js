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
  assert.match(vtt, /STATE\.isAdmin \? `<section id="vtt-walls-bar"/);
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

test('les raccourcis V R D M et point interrogation pilotent le rail', () => {
  for (const key of ['r','v','d','m']) assert.match(vtt, new RegExp(`e\\.key==='${key}'`));
  assert.match(vtt, /e\.key === '\?'/);
  assert.match(vtt, /if \(_vttToolPanel === 'keys'\)/);
});

test('le rail se compacte sur les écrans peu hauts et reste ancré à droite', () => {
  assert.match(css, /\.vtt-tool-float\s*\{[\s\S]*?right:\s*12px\s*!important[\s\S]*?left:\s*auto\s*!important/);
  assert.match(css, /@media \(max-height:\s*560px\)[\s\S]*?width:\s*34px\s*!important[\s\S]*?height:\s*34px\s*!important/);
});
