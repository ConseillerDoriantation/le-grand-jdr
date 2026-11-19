import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../assets/css/vtt.css', import.meta.url), 'utf8');
const inspector = readFileSync(new URL('../assets/js/features/vtt/vtt-inspector.js', import.meta.url), 'utf8');

test('les icônes du bandeau des scènes restent contenues dans leurs boutons', () => {
  assert.match(css, /\.vtt-reel-actions button\s*\{[^}]*width:22px;[^}]*height:22px;[^}]*place-items:center/s);
  assert.match(css, /\.vtt-reel-actions svg\s*\{[^}]*width:10px;[^}]*height:10px/s);
  assert.match(css, /\.vtt-reel-tools svg\s*\{[^}]*width:11px;[^}]*height:11px/s);
});

test('Réinitialiser utilise un bouton compact structuré dans les stats du pupitre', () => {
  assert.match(inspector, /class="vtt-stat-reset"[^>]*>\$\{_insIcon\('reset'\)\}Réinitialiser/);
  assert.match(css, /\.vtt-stat-reset\s*\{[^}]*height:\s*27px;[^}]*border:\s*1px solid var\(--border\)/s);
  assert.match(css, /\.vtt-stat-reset:hover/);
});
