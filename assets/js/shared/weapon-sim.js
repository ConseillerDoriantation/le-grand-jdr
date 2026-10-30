// ══════════════════════════════════════════════════════════════════════════════
// SHARED / WEAPON-SIM.JS — Simulation pure d'une technique d'arme
// Fonction 100 % cliente, sans effet de bord ni Firestore : estime le toucher, le
// critique et les dégâts attendus d'une attaque, avec ou sans technique, pour
// aider le MJ à juger l'équilibrage. Testable sous Node (tests/weapon-sim.test.js).
// ══════════════════════════════════════════════════════════════════════════════

// « 2d6+3 » → { dice: moyenne des dés seuls, flat: constante, avg }. Tolérant :
// une formule vide ou invalide rend des zéros (la simulation reste définie).
export function parseDiceAverage(formula = '') {
  const m = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(String(formula || '').replace(/\s+/g, ''));
  if (!m) return { count: 0, faces: 0, dice: 0, flat: 0, avg: 0 };
  const count = parseInt(m[1] || '1', 10), faces = parseInt(m[2], 10), flat = m[3] ? parseInt(m[3], 10) : 0;
  const dice = count * (faces + 1) / 2;
  return { count, faces, dice, flat, avg: dice + flat };
}

const _clampProb = p => Math.max(0, Math.min(1, p));

// Paramètres de simulation : bonus d'attaque, CA cible, mod de carac, avantage.
// Renvoie, pour l'attaque considérée (technique ou non), les probabilités et les
// dégâts moyens par touche / critique, et les dégâts attendus par attaque.
export function simulate(type = {}, technique = null, params = {}) {
  const atk = Number.isFinite(params.atk) ? params.atk : 5;
  const ca = Number.isFinite(params.ca) ? params.ca : 14;
  const mod = Number.isFinite(params.mod) ? params.mod : 3;
  const adv = !!params.adv;

  const t = technique || {};
  // Une technique « avec avantage seulement » sans avantage ne s'active pas :
  // l'attaque est alors strictement normale.
  const inactive = !!technique && !!t.requiresAdvantage && !adv;
  const eff = inactive ? {} : t;

  // ── Toucher / critique ──
  const caEff = Math.round(ca * (1 - (eff.armorIgnorePct || 0) / 100)) + (eff.defenseBonus || 0);
  const atkTot = atk + (eff.attackModifier || 0);
  const critThreshold = 20 - (eff.critRangeBonus || 0);
  let hitFaces = 0, critFaces = 0;
  for (let r = 2; r <= 20; r++) {
    const isCrit = r >= critThreshold;
    if (isCrit) critFaces++;
    if (isCrit || r + atkTot >= caEff) hitFaces++;
  }
  let pHit = hitFaces / 20, pCrit = critFaces / 20;
  if (adv) { pHit = 1 - (1 - pHit) ** 2; pCrit = 1 - (1 - pCrit) ** 2; }
  pHit = _clampProb(pHit); pCrit = _clampProb(Math.min(pCrit, pHit));

  // ── Dégâts ──
  const wd = parseDiceAverage(type?.defaults?.degats || '1d6');
  const faces = wd.faces || 6;
  const nStats = Math.max(0, (type?.defaults?.degatsStats || []).length);
  const baseDice = wd.dice || (faces + 1) / 2; // au moins un dé d'arme
  const baseFlat = wd.flat + mod * nStats;
  const baseHit = baseDice + baseFlat;
  const baseCrit = 2 * baseDice + baseFlat;

  // Extras propres à la technique (dés doublés au critique, fixes non doublés).
  const bonus = parseDiceAverage(eff.extraDamageFormula || '');
  const exDice = (eff.extraWeaponDice || 0) * (faces + 1) / 2 + bonus.dice;
  const exFlat = bonus.flat + (eff.extraDamageFlat || 0) + (eff.addWeaponModifier ? mod : 0) - (eff.damageMalusFlat || 0);
  const extrasHit = exDice + exFlat;
  const extrasCrit = 2 * exDice + exFlat;

  const trig = eff.trigger || 'hit';
  const extrasOnHit = trig === 'hit' || trig === 'always';
  const extrasOnCrit = trig === 'hit' || trig === 'crit' || trig === 'always';
  const dmgHit = baseHit + (extrasOnHit ? extrasHit : 0);
  const dmgCrit = baseCrit + (extrasOnCrit ? extrasCrit : 0);

  // Part « sur un raté » : déclencheur miss/always, ou technique à la touche dont
  // les effets se répercutent sur un échec (missEffectMode).
  let dmgMiss = 0;
  if (trig === 'miss' || trig === 'always') dmgMiss = Math.max(0, extrasHit);
  else if (trig === 'hit') { const f = eff.missEffectMode === 'full' ? 1 : eff.missEffectMode === 'half' ? 0.5 : 0; dmgMiss = f * Math.max(0, extrasHit); }

  const pMiss = 1 - pHit;
  const expected = (pHit - pCrit) * dmgHit + pCrit * dmgCrit + pMiss * dmgMiss;

  return { inactive, hitPct: pHit, critPct: pCrit, dmgHit, dmgCrit, dmgMiss, expected };
}

// Première CA (entre 8 et 24) où le signe de l'écart technique − normale change :
// le « seuil de rentabilité » affiché dans le verdict. null si pas de croisement.
export function simBreakEven(type, technique, params = {}) {
  let prev = null;
  for (let ca = 8; ca <= 24; ca++) {
    const d = simulate(type, technique, { ...params, ca }).expected - simulate(type, null, { ...params, ca }).expected;
    const sign = d > 0.01 ? 1 : d < -0.01 ? -1 : 0;
    if (prev != null && sign !== 0 && sign !== prev) return ca;
    if (sign !== 0) prev = sign;
  }
  return null;
}
