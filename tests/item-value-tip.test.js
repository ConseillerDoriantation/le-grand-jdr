import test from 'node:test';
import assert from 'node:assert/strict';
import { upgradedItemValue, upgradedValueTipRows, valueTipAttrs } from '../assets/js/shared/item-value-tip.js';

const settings = { ring: { 1: 250 }, amulet: { 1: 200, 2: 400 }, refundUpgradeRatio: 0.2 };
const ring = upgrades => ({ nom: 'Solitaire', slotBijou: 'Anneau', upgrades });
const gold = n => `${n} or`;

test('anneau amélioré 2 fois : base + 2 × 250 au tarif actuel', () => {
  assert.deepEqual(upgradedItemValue(300, ring({ statBonus: { int: 1 }, effectBonus: 1 }), settings),
    { base: 300, upgrades: 500, total: 800 });
});

test('le tarif suit les réglages (rien de figé)', () => {
  const item = ring({ statBonus: { int: 1 } });
  assert.equal(upgradedItemValue(300, item, { ring: { 1: 400 } }).total, 700);
});

test('objet non amélioré : pas d’infobulle', () => {
  const v = upgradedItemValue(300, { nom: 'Épée' }, settings);
  assert.deepEqual(v, { base: 300, upgrades: 0, total: 300 });
  assert.deepEqual(upgradedValueTipRows(v, gold), []);
  assert.equal(valueTipAttrs([]), '');
});

test('lignes : total, base, améliorations, avec le « / u. »', () => {
  const rows = upgradedValueTipRows({ base: 300, upgrades: 500, total: 800 }, gold, ' / u.');
  assert.deepEqual(rows.slice(0, 3), [
    ['Valeur améliorée', '800 or / u.', 'is-total'],
    ['Prix de base', '300 or / u.'],
    ['Améliorations', '+500 or / u.'],
  ]);
});

test('attributs échappés (JSON dans un attribut HTML)', () => {
  const attrs = valueTipAttrs([['Valeur "x"', '<b>1</b>']]);
  assert.match(attrs, /data-value-tip="\[\[&quot;Valeur \\&quot;x\\&quot;&quot;,&quot;&lt;b&gt;1&lt;\/b&gt;&quot;\]\]"/);
  assert.match(attrs, /tabindex="0"/);
});
