// ══════════════════════════════════════════════════════════════════════════════
// SHARED / DAMAGE-SIM.JS — Simulation pure d'un TYPE de dégâts (et de sa technique)
// Estime toucher / critique / dégâts attendus d'une attaque de ce type, avec ses
// règles de combat (bonus de dégâts, pénétration d'armure, dégâts sur un raté) et,
// optionnellement, une technique (mêmes modificateurs que les armes) + l'affinité
// de la cible. 100 % client, testable sous Node. Réutilise getAttackMissEffect.
// ══════════════════════════════════════════════════════════════════════════════

import { parseDiceAverage } from './weapon-sim.js';
import { getAttackMissEffect } from './damage-type-rules.js';

const _clampProb = p => Math.max(0, Math.min(1, p));

// Affinité → multiplicateur final (absorption soigne : facteur négatif).
export const DT_AFFINITIES = [
  { key: 'normal', label: 'Normale', mult: 1 },
  { key: 'res', label: 'Résistante ½', mult: 0.5 },
  { key: 'weak', label: 'Faible ×2', mult: 2 },
  { key: 'imm', label: 'Immunisée 0', mult: 0 },
  { key: 'abs', label: 'Absorbe −1', mult: -1 },
];
export const dtAffinityMult = key => (DT_AFFINITIES.find(a => a.key === key) || DT_AFFINITIES[0]).mult;

// rules : { dmgBonus, armorPen, missEffect, missScope } (ou null = attaque neutre)
// technique : technique d'arme (ou null) · params : { atk, ca, dice, mod, adv, magic, aff }
export function simulateDamageType(rules, technique, params = {}) {
  const r = rules || {};
  const t = technique || {};
  const atk = Number.isFinite(params.atk) ? params.atk : 5;
  const ca = Number.isFinite(params.ca) ? params.ca : 14;
  const mod = Number.isFinite(params.mod) ? params.mod : 3;
  const adv = !!params.adv;
  const magic = !!params.magic;
  const affMult = Number.isFinite(params.aff) ? params.aff : 1;

  const inactive = !!technique && !!t.requiresAdvantage && !adv;
  const eff = inactive ? {} : t;

  const wd = parseDiceAverage(params.dice || '1d6');
  const faces = wd.faces || 6;
  const diceAvg = wd.dice || (faces + 1) / 2;
  const diceFlat = wd.flat;

  // ── Toucher / critique ──
  const armorIgnore = Math.min(100, (r.armorPen || 0) + (eff.armorIgnorePct || 0));
  const caEff = Math.round(ca * (1 - armorIgnore / 100)) + (eff.defenseBonus || 0);
  const atkTot = atk + (eff.attackModifier || 0);
  const critThreshold = 20 - (eff.critRangeBonus || 0);
  let hitFaces = 0, critFaces = 0;
  for (let d = 2; d <= 20; d++) {
    const isCrit = d >= critThreshold;
    if (isCrit) critFaces++;
    if (isCrit || d + atkTot >= caEff) hitFaces++;
  }
  let p = hitFaces / 20, c = critFaces / 20, fum = 1 / 20;
  if (adv) { p = 1 - (1 - p) ** 2; c = 1 - (1 - c) ** 2; fum = fum * fum; }
  p = _clampProb(p); c = _clampProb(Math.min(c, p));

  // ── Dégâts de base (flat = constante des dés + mod + bonus de type) ──
  const flat = diceFlat + mod + (r.dmgBonus || 0);
  const baseHit = diceAvg + flat;
  const baseCrit = 2 * diceAvg + flat;

  // ── Extras de la technique (dés doublés au critique, fixes non doublés) ──
  const bonus = parseDiceAverage(eff.extraDamageFormula || '');
  const exDice = (eff.extraWeaponDice || 0) * (faces + 1) / 2 + bonus.dice;
  const exFlat = bonus.flat + (eff.extraDamageFlat || 0) + (eff.addWeaponModifier ? mod : 0) - (eff.damageMalusFlat || 0);
  const trig = eff.trigger || 'hit';
  const extrasOnHit = trig === 'hit' || trig === 'always';
  const extrasOnCrit = trig === 'hit' || trig === 'crit' || trig === 'always';
  const dmgHit = baseHit + (extrasOnHit ? exDice + exFlat : 0);
  const dmgCrit = baseCrit + (extrasOnCrit ? 2 * exDice + exFlat : 0);

  // ── Dégâts sur un raté (hors échec critique) ──
  // Règle du TYPE (getAttackMissEffect, tient compte de missScope + magie).
  const typeMiss = getAttackMissEffect({ typeRules: r, isMagicDelivery: magic }, []);
  let dmgMiss = typeMiss === 'full' ? baseHit : typeMiss === 'half' ? baseHit / 2 : 0;
  // Technique déclenchée sur raté / toujours, ou effets reportés (missEffectMode).
  const exHit = Math.max(0, exDice + exFlat);
  if (trig === 'miss' || trig === 'always') dmgMiss += exHit;
  else if (trig === 'hit') { const f = eff.missEffectMode === 'full' ? 1 : eff.missEffectMode === 'half' ? 0.5 : 0; dmgMiss += f * exHit; }

  const pMiss = Math.max(0, 1 - p - fum);
  const expected = ((p - c) * dmgHit + c * dmgCrit + pMiss * dmgMiss) * affMult;

  return {
    inactive,
    hitPct: p, critPct: c,
    dmgHit: dmgHit * affMult, dmgCrit: dmgCrit * affMult,
    expected,
  };
}

// Première CA (8→24) où le signe de l'écart b−a change ; null sinon.
export function dtBreakEven(rulesA, techA, rulesB, techB, params = {}) {
  let prev = null;
  for (let ca = 8; ca <= 24; ca++) {
    const d = simulateDamageType(rulesB, techB, { ...params, ca }).expected - simulateDamageType(rulesA, techA, { ...params, ca }).expected;
    const sign = d > 0.01 ? 1 : d < -0.01 ? -1 : 0;
    if (prev != null && sign !== 0 && sign !== prev) return ca;
    if (sign !== 0) prev = sign;
  }
  return null;
}
