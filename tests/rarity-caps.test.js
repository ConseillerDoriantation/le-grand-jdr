import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DEFAULT_RARITY_CAPS, DEFAULT_RING_CAPS, rarityCapFromTable } from '../assets/js/shared/rarity-caps.js';

const root = new URL('../', import.meta.url);
const artisan = readFileSync(new URL('assets/js/features/artisan.js', root), 'utf8');
const upg = readFileSync(new URL('assets/js/shared/upgrade-settings.js', root), 'utf8');

test('la table par défaut suit l’échelle convenue (1★ bridée, 5★ pleine)', () => {
  assert.deepEqual(DEFAULT_RARITY_CAPS.traits, { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3 });
  assert.deepEqual(DEFAULT_RARITY_CAPS.stats, { 1: 0, 2: 2, 3: 3, 4: 4, 5: 4 });
});

test('rarityCapFromTable : lecture directe par rareté', () => {
  const t = DEFAULT_RARITY_CAPS.traits;
  assert.equal(rarityCapFromTable(t, 1), 1);
  assert.equal(rarityCapFromTable(t, 3), 2);
  assert.equal(rarityCapFromTable(t, 5), 3);
  const st = DEFAULT_RARITY_CAPS.stats;
  assert.equal(rarityCapFromTable(st, 1), 0); // une 1★ ne peut porter aucune stat
  assert.equal(rarityCapFromTable(st, 5), 4);
});

test('rareté 0 / non définie = commun (1)', () => {
  assert.equal(rarityCapFromTable(DEFAULT_RARITY_CAPS.stats, 0), 0);
  assert.equal(rarityCapFromTable(DEFAULT_RARITY_CAPS.stats, null), 0);
  assert.equal(rarityCapFromTable(DEFAULT_RARITY_CAPS.stats, undefined), 0);
  assert.equal(rarityCapFromTable(DEFAULT_RARITY_CAPS.traits, 0), 1);
});

test('rareté hors table → plafond défini le plus proche en dessous (jamais d’explosion)', () => {
  const t = { 1: 1, 3: 2, 5: 3 }; // table « trouée »
  assert.equal(rarityCapFromTable(t, 2), 1); // retombe sur 1
  assert.equal(rarityCapFromTable(t, 4), 2); // retombe sur 3
  assert.equal(rarityCapFromTable(t, 9), 3); // au-delà → plafond max défini
  assert.equal(rarityCapFromTable({}, 5), 0); // table vide → 0 (jamais illimité)
});

test('valeurs négatives/invalides bornées à 0', () => {
  assert.equal(rarityCapFromTable({ 1: -5 }, 1), 0);
  assert.equal(rarityCapFromTable({ 1: 'x' }, 1), 0);
});

test('artisan applique le plafond de rareté en min(catégorie, rareté) partout', () => {
  // Slots de traits : min(plafond catégorie, plafond rareté).
  assert.match(artisan, /Math\.min\(s\.caps\?\.traitsPerItem\?\.\[cat\] \?\? 1, rarityCapFor\('traits', item\.rarete, s\)\)/);
  // Stats amulette (affichage + mutation).
  const amuletHits = artisan.match(/Math\.min\(s\.caps\?\.amulet \?\? 3, rarityCapFor\('stats', item\.rarete, s\)\)/g) || [];
  assert.equal(amuletHits.length, 2, 'cap amulette borné rareté à l’affichage ET à la mutation');
  // Stats armes 1M/2M (affichage + mutation).
  const weaponHits = artisan.match(/rarityCapFor\('stats', item\.rarete, s\)\)/g) || [];
  assert.ok(weaponHits.length >= 4, 'tous les points d’enforcement stats bornés par la rareté');
  // L’import est bien présent.
  assert.match(artisan, /import \{[^}]*rarityCapFor[^}]*\} from '\.\.\/shared\/upgrade-settings\.js'/);
});

test('upgrade-settings expose rarityCaps et la section admin par rareté', () => {
  assert.match(upg, /rarityCaps: \{ \.\.\.DEFAULT_RARITY_CAPS, ring: DEFAULT_RING_CAPS \}/);
  assert.match(upg, /rarityCaps:\s*\{[\s\S]*?traits:\s*\{[\s\S]*?stats:\s*\{/); // merge défensif
  // Plafonds propres à l'anneau (profondeur sur ses stats natives).
  assert.deepEqual(DEFAULT_RING_CAPS.traits, { 1: 1, 2: 1, 3: 1, 4: 2, 5: 3 });
  assert.deepEqual(DEFAULT_RING_CAPS.stats, { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 });
  assert.match(upg, /rarityCaps\.ring\.traits\./); // ligne admin anneau par rareté
  assert.match(upg, /data-field="rarityCaps\.traits\./);
  assert.match(upg, /data-field="rarityCaps\.stats\./);
  assert.match(upg, /Plafonds par rareté/);
});
