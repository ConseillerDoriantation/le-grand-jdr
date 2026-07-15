import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getMod, getModFromScore, calcCA, calcVitesse, calcDeckMax, calcPVMax, calcPMMax, calcPalier, pct,
  getItemStatBonus, getDefaultCharForUser, getMyCharacters, sortCharactersForDisplay,
} from '../assets/js/shared/char-stats.js';
import { DEFAULT_CHARACTER_RULES, LEGACY_CHARACTER_RULES, setCharacterRulesForTests } from '../assets/js/shared/character-rules.js';

afterEach(() => setCharacterRulesForTests(null));

test('regles par aventure : limites positive et negative personnalisables', () => {
  setCharacterRulesForTests({
    ...DEFAULT_CHARACTER_RULES,
    modifier: { ...DEFAULT_CHARACTER_RULES.modifier, min: -4, max: 4 },
  });
  assert.equal(getModFromScore(30), 4);
  assert.equal(getModFromScore(1), -4);
});

test('regles par aventure : une limite vide supprime le plafond', () => {
  setCharacterRulesForTests({
    ...DEFAULT_CHARACTER_RULES,
    modifier: { ...DEFAULT_CHARACTER_RULES.modifier, min: null, max: null },
  });
  assert.equal(getModFromScore(30), 10);
});

test('regles par aventure : formules derivees personnalisables', () => {
  setCharacterRulesForTests({
    ...DEFAULT_CHARACTER_RULES,
    formulas: {
      ...DEFAULT_CHARACTER_RULES.formulas,
      speed: '5 + forceMod + equipBonus',
      deck: '2 + intMod * level',
      xp: '250 * level',
    },
  });
  assert.equal(calcVitesse({ stats: { force: 14 }, niveau: 3 }), 7);
  assert.equal(calcDeckMax({ stats: { intelligence: 14 }, niveau: 3 }), 8);
  assert.equal(calcPalier(3), 750);
});

test('getModFromScore : formule D&D par défaut sans plafond artificiel', () => {
  assert.equal(getModFromScore(8), -1);
  assert.equal(getModFromScore(10), 0);
  assert.equal(getModFromScore(14), 2);
  assert.equal(getModFromScore(22), 6);
  assert.equal(getModFromScore(30), 10);
});

test('getMod : lit stats + statsBonus, défaut 8', () => {
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

test('calcPVMax : Constitution appliquée à chaque niveau avec le préréglage D&D', () => {
  // D&D : le modificateur de Constitution s'applique à chaque niveau.
  assert.equal(calcPVMax({ pvBase: 10, stats: { constitution: 14 }, niveau: 3 }), 16);
  // Con 8 (-1) niveau 1 → 9
  assert.equal(calcPVMax({ pvBase: 10, stats: { constitution: 8 }, niveau: 1 }), 9);
  // Plancher à 1 (pvBase 3, Con 1 → mod -5 → 3-5=-2 → 1)
  assert.equal(calcPVMax({ pvBase: 3, stats: { constitution: 1 } }), 1);
});

test('calcPMMax : valeur de base conservée avec le préréglage compatible D&D', () => {
  assert.equal(calcPMMax({ pmBase: 10, stats: { sagesse: 14 }, niveau: 3 }), 10);
  assert.equal(calcPMMax({ pmBase: 3, stats: { sagesse: 1 } }), 3);
});

test('calcCA : type d’armure neutre, bonus explicites uniquement', () => {
  assert.equal(calcCA({ equipement: { Torse: { typeArmure: 'Légère', ca: 2 } }, stats: { dexterite: 14 } }), 14);
  assert.equal(calcCA({ equipement: { Torse: { typeArmure: 'Intermédiaire', ca: 5 } }, stats: { dexterite: 18 } }), 19);
  assert.equal(calcCA({ equipement: { Torse: { typeArmure: 'Lourde', ca: 6 } }, stats: { dexterite: 18 } }), 20);
  assert.equal(calcCA({ stats: { dexterite: 10 } }), 10, 'sans torse → base 10');
});

test('calcCA : bouclier sans bonus propre → +2 (rétro-compat)', () => {
  const ca = calcCA({ equipement: { 'Main secondaire': { nom: 'Bouclier en bois' } }, stats: { dexterite: 10 } });
  assert.equal(ca, 12, '10 (base) + 0 (Dex) + 2 (bouclier)');
});

test('préréglage historique : conserve les calculs de le-grand-jdr', () => {
  setCharacterRulesForTests(LEGACY_CHARACTER_RULES);
  assert.equal(getModFromScore(30), 6);
  assert.equal(calcCA({ stats: { dexterite: 10 } }), 8);
  assert.equal(calcPVMax({ pvBase: 10, stats: { constitution: 14 }, niveau: 3 }), 14);
  assert.equal(calcPMMax({ pmBase: 10, stats: { sagesse: 14 }, niveau: 3 }), 14);
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
