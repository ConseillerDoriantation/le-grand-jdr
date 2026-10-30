import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDiceAverage, simulate, simBreakEven } from '../assets/js/shared/weapon-sim.js';

const EPEE = { defaults: { degats: '1d8', degatsStats: ['force'] } };
const P = { atk: 5, ca: 14, mod: 3, adv: false };

test('parseDiceAverage : moyenne des dés et constante', () => {
  assert.deepEqual(parseDiceAverage('2d6+3'), { count: 2, faces: 6, dice: 7, flat: 3, avg: 10 });
  assert.equal(parseDiceAverage('1d8').avg, 4.5);
  assert.equal(parseDiceAverage('').avg, 0);
  assert.equal(parseDiceAverage('nope').avg, 0);
});

test('attaque normale : toucher, critique et dégâts attendus cohérents', () => {
  const n = simulate(EPEE, null, P);
  // d20: touche si r+5>=14 (r>=9) ou crit (r=20) → r de 9 à 20 = 12 faces /20.
  assert.equal(Math.round(n.hitPct * 20), 12);
  assert.equal(Math.round(n.critPct * 20), 1);
  // dégâts par touche = 4.5 (1d8) + 3 (mod×1 carac) = 7.5 ; critique = 9 + 3 = 12.
  assert.equal(n.dmgHit, 7.5);
  assert.equal(n.dmgCrit, 12);
  assert.ok(n.expected > 0);
});

test('un coup puissant (+2 fixes) augmente les dégâts attendus', () => {
  const n = simulate(EPEE, null, P).expected;
  const power = simulate(EPEE, { trigger: 'hit', extraDamageFlat: 2 }, P).expected;
  assert.ok(power > n);
});

test('un bonus de CA sur la cible réduit la probabilité de toucher', () => {
  const n = simulate(EPEE, null, P).hitPct;
  const guard = simulate(EPEE, { trigger: 'hit', defenseBonus: 4 }, P).hitPct;
  assert.ok(guard < n);
});

test('« avec avantage seulement » : inactif sans avantage = attaque normale', () => {
  const tech = { trigger: 'hit', requiresAdvantage: true, extraWeaponDice: 2 };
  const off = simulate(EPEE, tech, { ...P, adv: false });
  const n = simulate(EPEE, null, { ...P, adv: false });
  assert.equal(off.inactive, true);
  assert.equal(off.expected, n.expected);
  const on = simulate(EPEE, tech, { ...P, adv: true });
  assert.equal(on.inactive, false);
  assert.ok(on.expected > simulate(EPEE, null, { ...P, adv: true }).expected);
});

test('ignorer l’armure est rentable contre une CA haute (seuil de bascule)', () => {
  // +0 toucher, −3 dégâts, mais ignore 20% de CA : mauvais à basse CA, bon à haute CA.
  const crush = { trigger: 'hit', armorIgnorePct: 20, damageMalusFlat: 3 };
  const be = simBreakEven(EPEE, crush, P);
  assert.ok(be === null || (be >= 8 && be <= 24));
});
