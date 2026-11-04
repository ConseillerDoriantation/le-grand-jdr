import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../assets/js/features/shop.js', import.meta.url), 'utf8');

test('Historique et Gérer restent dans le bandeau quel que soit l’onglet boutique', () => {
  const start = source.indexOf('<div class="sh-topbar-tools">');
  const end = source.indexOf('<nav class="sh-page-tabs"', start);
  const header = source.slice(start, end);
  assert.match(header, /data-sh-action="openShopHistory"/);
  assert.match(header, /\$\{_renderManageMenu\(\)\}/);
  assert.doesNotMatch(header, /_shopSection === 'shop'/);
});

test('le menu Gérer reste réservé au MJ', () => {
  const start = source.indexOf('function _renderManageMenu()');
  const end = source.indexOf('export async function renderShop()', start);
  const block = source.slice(start, end);
  assert.match(block, /if \(!STATE\.isAdmin\) return ''/);
});
