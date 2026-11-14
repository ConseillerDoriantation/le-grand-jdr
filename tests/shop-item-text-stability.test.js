import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shop = readFileSync(new URL('../assets/js/features/shop.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/shop.css', import.meta.url), 'utf8');

test('la saisie enrichie ne reconstruit plus toute la modal objet à chaque caractère', () => {
  assert.match(shop, /if \(event\.target\?\.closest\?\.\('\.rtq-wrap'\)\) return/);
  assert.match(shop, /onUserEdit: id =>/);
  assert.match(shop, /_siScheduleRefreshLive\(\{ refreshPreview: false \}\)/);
  assert.match(shop, /if \(preview\._siPreviewHtml !== previewHtml\)/);
  assert.match(shop, /nav\.querySelector\(`\.si-nav-row\[data-section="\$\{section\}"\]`\)/);
});

test('les colonnes de l éditeur gardent une largeur stable pendant la saisie', () => {
  assert.match(css, /#si-editor-scroll \{[^}]*scrollbar-gutter: stable/);
  assert.match(css, /#si-editor-preview \{[^}]*scrollbar-gutter: stable/);
  assert.match(css, /\.si-readable-editor \.rtq-wrap \{ width: 100%; min-width: 0; max-width: 100%; \}/);
});
