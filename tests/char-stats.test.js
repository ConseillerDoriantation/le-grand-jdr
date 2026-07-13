import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getMod, getModFromScore, calcCA, calcPVMax, calcPMMax, calcPalier, pct,
  getItemStatBonus, getDefaultCharForUser, getMyCharacters, sortCharactersForDisplay,
} from '../assets/js/shared/char-stats.js';

test('getModFromScore : modificateur D&D, plafonné à un score de 22', () => {
  assert.equal(getModFromScore(8), -1);
  assert.equal(getModFromScore(10), 0);
  assert.equal(getModFromScore(14), 2);
  assert.equal(getModFromScore(22), 6);
  assert.equal(getModFromScore(30), 6, 'plafond à 22 → +6');
});

test('getMod : lit stats + statsBonus, défaut 8, plafond 22', () => {
  assert.equal(getMod({ stats: { force: 16 } }, 'force'), 3);
  assert.equal(getMod({ stats: { force: 16 }, statsBonus: { force: 4 } }, 'force'), 5, '20 → +5');
  assert.equal(getMod({}, 'force'), -1, 'stat absente → 8 → -1');
});

test('calcPalier : 100 × niveau²', () => {
  assert.equal(calcPalier(1), 100);
  assert.equal(calcPalier(2), 400);
  assert.equal(calcPalier(3), 900);
});

test('pct : borné 0–100, garde-fou max=0', () => {
  assert.equal(pct(50, 100), 50);
  assert.equal(pct(200, 100), 100);
  assert.equal(pct(-5, 100), 0);
  assert.equal(pct(5, 0), 0);
});

test('calcPVMax : Constitution positive scale avec le niveau, négative une seule fois', () => {
  // Con 14 (+2) au niveau 3 → 10 + floor(2×2) = 14
  assert.equal(calcPVMax({ pvBase: 10, stats: { constitution: 14 }, niveau: 3 }), 14);
  // Con 8 (-1) niveau 1 → malus appliqué une fois → 9
  assert.equal(calcPVMax({ pvBase: 10, stats: { constitution: 8 }, niveau: 1 }), 9);
  // Plancher à 1 (pvBase 3, Con 1 → mod -5 → 3-5=-2 → 1)
  assert.equal(calcPVMax({ pvBase: 3, stats: { constitution: 1 } }), 1);
});

test('calcPMMax : Sagesse, plancher 0', () => {
  assert.equal(calcPMMax({ pmBase: 10, stats: { sagesse: 14 }, niveau: 3 }), 14);
  // pmBase 3, Sag 1 → mod -5 → 3-5=-2 → plancher 0
  assert.equal(calcPMMax({ pmBase: 3, stats: { sagesse: 1 } }), 0);
});

test('calcCA : base selon armure Torse + mod Dex', () => {
  assert.equal(calcCA({ equipement: { Torse: { typeArmure: 'Légère' } }, stats: { dexterite: 14 } }), 12);
  assert.equal(calcCA({ equipement: { Torse: { typeArmure: 'Lourde' } }, stats: { dexterite: 10 } }), 14);
  assert.equal(calcCA({ stats: { dexterite: 10 } }), 8, 'sans torse → base 8');
});

test('calcCA : bouclier sans bonus propre → +2 (rétro-compat)', () => {
  const ca = calcCA({ equipement: { 'Main secondaire': { nom: 'Bouclier en bois' } }, stats: { dexterite: 10 } });
  assert.equal(ca, 10, '8 (base) + 0 (Dex) + 2 (bouclier)');
});

test('getItemStatBonus : accepte le store canonique et les alias boutique', () => {
  assert.equal(getItemStatBonus({ fo: 3 }, 'force'), 3);
  assert.equal(getItemStatBonus({ for: 2 }, 'force'), 2, 'alias "for" → Force');
  assert.equal(getItemStatBonus({ statBonuses: { sagesse: 1 } }, 'sagesse'), 1, 'objet boutique legacy statBonuses.full');
  assert.equal(getItemStatBonus({ statBonuses: { sa: 1 }, upgrades: { statBonus: { sagesse: 1 } } }, 'sagesse'), 2, 'base + upgrade avec cles mixtes');
  assert.equal(getItemStatBonus({ fo: 2, upgrades: { statBonus: { fo: 1 } } }, 'force'), 3, 'base + upgrade');
  assert.equal(getItemStatBonus({}, 'force'), 0);
});

test('getMyCharacters : filtre par uid, trié', () => {
  const chars = [{ id: 'a', uid: 'u1', nom: 'A' }, { id: 'b', uid: 'u2', nom: 'B' }];
  const mine = getMyCharacters(chars, 'u1');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, 'a');
  assert.deepEqual(getMyCharacters(chars, ''), [], 'pas d’uid → vide');
});

test('getDefaultCharForUser : priorité au perso ★, sinon le premier trié', () => {
  const chars = [
    { id: 'a', uid: 'u1', nom: 'Zelda' },
    { id: 'b', uid: 'u1', nom: 'Aria', isDefault: true },
    { id: 'c', uid: 'u2', nom: 'Other' },
  ];
  assert.equal(getDefaultCharForUser(chars, 'u1').id, 'b', 'le ★ gagne');
  assert.equal(getDefaultCharForUser(chars, 'u2').id, 'c');
  assert.equal(getDefaultCharForUser(chars, 'absent'), null);
  assert.equal(getDefaultCharForUser(chars, ''), null);
});

test('sortCharactersForDisplay : ★ par défaut en premier au sein d’un même joueur', () => {
  const chars = [
    { id: 'a', ownerPseudo: 'Paul', nom: 'Zoe' },
    { id: 'b', ownerPseudo: 'Paul', nom: 'Al', isDefault: true },
  ];
  const sorted = sortCharactersForDisplay(chars);
  assert.equal(sorted[0].id, 'b', 'le perso ★ passe devant');
});
