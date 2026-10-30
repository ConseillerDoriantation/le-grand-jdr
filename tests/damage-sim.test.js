import test from 'node:test';
import assert from 'node:assert/strict';

import { simulateDamageType, dtBreakEven, dtAffinityMult } from '../assets/js/shared/damage-sim.js';

const P = { atk: 5, ca: 14, mod: 3, dice: '1d8', adv: false, magic: true, aff: 1 };

test('attaque neutre : toucher, critique, dégâts cohérents', () => {
  const n = simulateDamageType(null, null, P);
  assert.equal(Math.round(n.hitPct * 20), 12);   // touche r>=9 ou crit → 12/20
  assert.equal(Math.round(n.critPct * 20), 1);
  assert.equal(n.dmgHit, 7.5);                    // 4.5 (1d8) + 3 mod
  assert.equal(n.dmgCrit, 12);                    // 9 + 3
  assert.ok(n.expected > 0);
});

test('bonus de dégâts du type augmente l’attendu', () => {
  const neutre = simulateDamageType(null, null, P).expected;
  const typeBonus = simulateDamageType({ dmgBonus: 2 }, null, P).expected;
  assert.ok(typeBonus > neutre);
});

test('pénétration d’armure augmente le toucher', () => {
  const n = simulateDamageType(null, null, { ...P, ca: 20 }).hitPct;
  const pen = simulateDamageType({ armorPen: 25 }, null, { ...P, ca: 20 }).hitPct;
  assert.ok(pen > n);
});

test('½ sur raté (magie) ajoute des dégâts sur un échec, seulement pour une attaque magique', () => {
  const rules = { missEffect: 'half', missScope: 'magic' };
  const magic = simulateDamageType(rules, null, { ...P, magic: true }).expected;
  const nonMagic = simulateDamageType(rules, null, { ...P, magic: false }).expected;
  const none = simulateDamageType(null, null, P).expected;
  assert.ok(magic > none);          // demi-dégâts sur raté → plus d'attendu
  assert.ok(Math.abs(nonMagic - none) < 1e-9); // hors magie : règle inactive
});

test('affinité : résistance divise, faiblesse double, immunité annule, absorption inverse', () => {
  const base = simulateDamageType(null, null, { ...P, aff: 1 }).expected;
  assert.ok(Math.abs(simulateDamageType(null, null, { ...P, aff: 0.5 }).expected - base * 0.5) < 1e-9);
  assert.ok(Math.abs(simulateDamageType(null, null, { ...P, aff: 2 }).expected - base * 2) < 1e-9);
  assert.equal(simulateDamageType(null, null, { ...P, aff: 0 }).expected, 0);
  assert.ok(simulateDamageType(null, null, { ...P, aff: -1 }).expected < 0);
  assert.equal(dtAffinityMult('res'), 0.5);
});

test('une technique « avec avantage seulement » reste inactive sans avantage', () => {
  const tech = { trigger: 'hit', requiresAdvantage: true, extraWeaponDice: 2 };
  const off = simulateDamageType(null, tech, { ...P, adv: false });
  assert.equal(off.inactive, true);
  assert.equal(off.expected, simulateDamageType(null, null, { ...P, adv: false }).expected);
});

test('dtBreakEven renvoie une CA de bascule ou null', () => {
  const be = dtBreakEven(null, null, { armorPen: 20, dmgBonus: -1 }, null, P);
  assert.ok(be === null || (be >= 8 && be <= 24));
});
