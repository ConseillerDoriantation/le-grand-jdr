import test from 'node:test';
import assert from 'node:assert/strict';
import {
  missingWeaponFamilies,
  resolveWeaponFamily,
  weaponFamilyLabels,
  weaponHands,
} from '../assets/js/shared/weapon-family.js';
import { detectCombatStyle } from '../assets/js/shared/combat-styles.js';

const families = [
  { id: 'epee', label: 'Épée', techniques: [{ label: 'Frappe maîtrisée' }] },
  { id: 'bouclier', label: 'Bouclier' },
  { id: 'baguette', label: 'Baguette', isMagic: true },
];

test('une arme se rattache à son type : format actuel, sinon type saisi (casse/accents ignorés)', () => {
  assert.equal(resolveWeaponFamily(families, { format: 'Épée' })?.id, 'epee');
  assert.equal(resolveWeaponFamily(families, { formatId: 'epee', format: 'ancien' })?.id, 'epee');
  assert.equal(resolveWeaponFamily(families, { format: 'Arme 1M CaC Phy.', sousType: 'epee' })?.id, 'epee');
  assert.equal(resolveWeaponFamily(families, { format: 'Arme 1M CaC Phy.', sousType: 'Hache' }), null);
  assert.equal(resolveWeaponFamily([], { format: 'Épée' }), null);
});

test('le maniement vient du champ « mains », sinon de l’ancien libellé 2M', () => {
  assert.equal(weaponHands({ mains: '2 mains', format: 'Arme 1M CaC Phy.' }), 2);
  assert.equal(weaponHands({ mains: 1 }), 1);
  assert.equal(weaponHands({ format: 'Arme 2M Dist Phy.' }), 2);
  assert.equal(weaponHands({ format: 'Arme 1M CaC Phy.' }), 1);
  assert.equal(weaponHands({ format: 'Épée' }), 1);
});

test('types manquants créés depuis les armes existantes, magiques si leur ancien format l’était', () => {
  const formats = [...families, { id: 'old_mag', label: 'Arme 2M Dist Mag.', isMagic: true }, { id: 'old', label: 'Arme 2M CaC Phy.' }];
  const items = [
    { sousType: 'Grimoire', format: 'Arme 2M Dist Mag.' },
    { sousType: 'grimoire', format: 'Arme 2M Dist Mag.' },
    { sousType: 'Hache', format: 'Arme 2M CaC Phy.' },
    { sousType: 'Épée', format: 'Arme 2M CaC Phy.' },
    { sousType: '' },
  ];
  const missing = missingWeaponFamilies(formats, items);
  assert.deepEqual(missing.map(f => [f.label, f.isMagic, f.weapons]), [['Grimoire', true, 2], ['Hache', false, 1]]);
});

test('les styles reconnaissent le type d’arme, l’ancien libellé et le maniement', () => {
  const character = equipment => ({ equipement: equipment });
  const styles = [
    { id: 'shield', condPrincipale: ['Épée'], condSecondaire: ['Bouclier'] },
    { id: 'legacy', condPrincipale: ['Arme 1M CaC Phy.'], condSecondaire: [''] },
    { id: 'two_hands', condPrincipale: [], condSecondaire: [''], condMains: '2' },
    { id: 'unarmed', condPrincipale: [''], condSecondaire: [''] },
  ];
  const sword = { nom: 'Épée courte', format: 'Arme 1M CaC Phy.', sousType: 'Épée' };
  const shield = { nom: 'Écu', format: 'Bouclier' };
  assert.equal(detectCombatStyle(character({ 'Main principale': sword, 'Main secondaire': shield }), styles, families)?.id, 'shield');
  assert.equal(detectCombatStyle(character({ 'Main principale': sword }), styles, families)?.id, 'legacy');
  assert.equal(detectCombatStyle(character({ 'Main principale': { nom: 'Claymore', format: 'Épée', mains: '2 mains' } }), styles, families)?.id, 'two_hands');
  assert.equal(detectCombatStyle(character({}), styles, families)?.id, 'unarmed');
  assert.deepEqual(weaponFamilyLabels(families, null), []);
  const anyWeapon = [{ id: 'armed', condPrincipale: ['*'] }, { id: 'none', condPrincipale: [''] }];
  assert.equal(detectCombatStyle(character({ 'Main principale': sword }), anyWeapon, families)?.id, 'armed');
  assert.equal(detectCombatStyle(character({}), anyWeapon, families)?.id, 'none');
});
