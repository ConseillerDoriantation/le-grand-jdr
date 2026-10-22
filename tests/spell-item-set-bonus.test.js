import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { usesArmorSetBonuses } from '../assets/js/shared/spell-runes.js';

const spells = readFileSync(new URL('../assets/js/features/characters/spells.js', import.meta.url), 'utf8');
const vtt = readFileSync(new URL('../assets/js/features/vtt/vtt.js', import.meta.url), 'utf8');
const display = readFileSync(new URL('../assets/js/features/vtt/vtt-spell-display.js', import.meta.url), 'utf8');

test('les sorts héritent des bonus de set mais les actions d’objet sont autonomes par défaut', () => {
  assert.equal(usesArmorSetBonuses({}, { source: 'spell' }), true);
  assert.equal(usesArmorSetBonuses({}, { source: 'item' }), false);
  assert.equal(usesArmorSetBonuses({ applyArmorSetBonuses: true }, { source: 'item' }), true);
  assert.equal(usesArmorSetBonuses({ applyArmorSetBonuses: false }, { source: 'spell' }), false);
});

test('la modal de sort enregistre le choix pour les deux modes d’édition', () => {
  assert.match(spells, /id="s-classic-apply-armor-set-bonuses"/);
  assert.match(spells, /id="s-apply-armor-set-bonuses"/);
  assert.match(spells, /applyArmorSetBonuses: _readArmorSetBonusesChoice\(prev\)/);
  assert.match(spells, /applyArmorSetBonuses: _readArmorSetBonusesChoice\(idx >= 0 \? prevList\[idx\] : \{\}\)/);
});

test('le VTT applique le choix aux dégâts et aux soins sans traitement spécial par potion', () => {
  assert.match(vtt, /const actionSource = extras\?\._itemAction \? 'item' : 'spell'/);
  assert.match(vtt, /const spellSetDmgBonus = applyArmorSetBonuses && c/);
  assert.match(vtt, /_vttSortSoinFormula\(s, c, \{ source: actionSource \}\)/);
  assert.match(display, /usesArmorSetBonuses\(s, \{ source \}\)/);
});
