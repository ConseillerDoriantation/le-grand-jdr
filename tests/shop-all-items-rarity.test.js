import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../assets/js/features/shop.js', import.meta.url), 'utf8');

test('le template classique expose aussi la rareté', () => {
  const start = source.indexOf('classique: {');
  const end = source.indexOf('\n  },', start);
  const block = source.slice(start, end);
  assert.match(block, /id:'rarete',[^\n]*type:'rarete'/);
});

test('la sauvegarde lit la rareté depuis l’identité commune à tous les articles', () => {
  const start = source.indexOf('async function saveShopItem');
  const end = source.indexOf('async function _syncCharactersAfterItemUpdate', start);
  const block = source.slice(start, end);
  assert.match(block, /rarete:parseInt\(document\.getElementById\('si-rarete'\)\?\.value,10\)\|\|0/);
  assert.ok(block.indexOf('rarete:parseInt') < block.indexOf('tpl.fields.forEach'), 'la rareté ne doit pas dépendre des champs du template');
});

test('la rareté reste propagée aux exemplaires déjà achetés', () => {
  assert.match(source, /syncInventoryEntryFromShop\(entry, catalogItem\)/);
  assert.match(source, /entry\?\.itemId \|\| entry\?\.shopItemId/);
  assert.doesNotMatch(source, /item\.source === 'boutique'/);
});
