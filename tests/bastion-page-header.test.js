import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bastionSource = readFileSync(new URL('../assets/js/features/bastion.js', import.meta.url), 'utf8');
const bastionStyles = readFileSync(new URL('../assets/css/bastion.css', import.meta.url), 'utf8');

test('le Bastion utilise le même bandeau de page que Guide, Joueurs et Boutique', () => {
  assert.match(bastionSource, /<header class="bs-page-top">/);
  assert.match(bastionSource, /class="bs-page-brand"/);
  assert.match(bastionSource, /class="bs-page-stats" aria-label="Résumé du Bastion"/);
  assert.match(bastionSource, /class="bs-page-actions"/);
  assert.doesNotMatch(bastionSource, /<header class="ag-top bs-top">/);
});

test('le bandeau conserve les actions, le personnage actif et les onglets du Bastion', () => {
  assert.match(bastionSource, /class="bs-page-character"/);
  assert.match(bastionSource, /data-action="_bastionOpenTransfer" data-dir="deposit"/);
  assert.match(bastionSource, /<nav class="ag-tabs bs-tabs" aria-label="Sections du Bastion">/);
  assert.match(bastionStyles, /\.bs-page-top\s*\{[^}]*border-bottom:[^;}]+var\(--border-strong\)/s);
  assert.match(bastionStyles, /\.bs-page-stats\s*\{[^}]*margin-left:\s*auto/s);
});

test('le bandeau du Bastion utilise des icônes SVG monochromes sans emoji décoratif', () => {
  assert.match(bastionSource, /function _bsIcon\(/);
  assert.match(bastionSource, /\['salles', 'rooms', 'Salles'\]/);
  assert.match(bastionSource, /\$\{_bsIcon\('edit'\)\}Identité du Bastion/);
  assert.doesNotMatch(bastionSource, /\['salles', '🧱'/);
  assert.doesNotMatch(bastionSource, /<button data-action="_bastionEditIdentite">✏/);
  assert.match(bastionStyles, /\.bs-page-icon\s*\{[^}]*color:\s*currentColor/s);
});
