const _int = (value, min, max) => Math.min(max, Math.max(min, parseInt(value, 10) || 0));
const _signedInt = (value, min, max) => Math.min(max, Math.max(min, parseInt(value, 10) || 0));
const _choice = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;

export function normalizeWeaponTechnique(technique = {}, index = 0) {
  const fallbackId = `technique_${index + 1}`;
  return {
    id: String(technique.id || fallbackId).trim().replace(/[^a-z0-9_-]/gi, '_') || fallbackId,
    icon: String(technique.icon || '🎯').trim().slice(0, 8) || '🎯',
    label: String(technique.label || `Technique ${index + 1}`).trim().slice(0, 60),
    description: String(technique.description || '').trim().slice(0, 240),
    allowWithAbilities: technique.allowWithAbilities !== false,
    trigger: _choice(technique.trigger, ['hit', 'miss', 'crit', 'always'], 'hit'),
    missEffectMode: _choice(technique.missEffectMode, ['none', 'half', 'full'], 'none'),
    attackModifier: _signedInt(technique.attackModifier, -30, 30),
    defenseBonus: _int(technique.defenseBonus, 0, 30),
    extraWeaponDice: _int(technique.extraWeaponDice, 0, 9),
    extraDamageFormula: String(technique.extraDamageFormula || '').replace(/\s+/g, '').trim().slice(0, 30),
    extraDamageFlat: _int(technique.extraDamageFlat, 0, 999),
    addWeaponModifier: technique.addWeaponModifier === true,
    damageTypeId: String(technique.damageTypeId || '').trim().slice(0, 60),
    criticalMode: _choice(technique.criticalMode, ['normal', 'double'], 'normal'),
    scalingMode: _choice(technique.scalingMode, ['none', 'level', 'mastery', 'stat'], 'none'),
    scalingEvery: _int(technique.scalingEvery || 1, 1, 20),
    scalingFormula: String(technique.scalingFormula || '').replace(/\s+/g, '').trim().slice(0, 30),
    scalingStat: _choice(technique.scalingStat, ['force', 'dexterite', 'constitution', 'intelligence', 'sagesse', 'charisme'], 'force'),
    blastRadius: _int(technique.blastRadius, 0, 30),
    areaShape: _choice(technique.areaShape, ['square', 'circle', 'line', 'cone'], 'square'),
    areaOrigin: _choice(technique.areaOrigin, ['target', 'caster'], 'target'),
    areaTargets: _choice(technique.areaTargets, ['all', 'enemies', 'allies'], 'all'),
    includeCaster: technique.includeCaster === true,
    conditionId: String(technique.conditionId || '').trim().slice(0, 80),
    conditionDuration: _int(technique.conditionDuration, 0, 100),
    conditionSaveStat: _choice(technique.conditionSaveStat, ['', 'force', 'dexterite', 'constitution', 'intelligence', 'sagesse', 'charisme'], ''),
    conditionSaveDC: _int(technique.conditionSaveDC, 0, 99),
    forcedMovement: _choice(technique.forcedMovement, ['none', 'push', 'pull'], 'none'),
    forcedMovementDistance: _int(technique.forcedMovementDistance, 0, 30),
    resourceType: _choice(technique.resourceType, ['none', 'pm', 'pv', 'or'], 'none'),
    resourceCost: _int(technique.resourceCost, 0, 999),
    usageScope: _choice(technique.usageScope, ['none', 'combat', 'session'], 'none'),
    maxUses: _int(technique.maxUses, 0, 99),
    cooldownRounds: _int(technique.cooldownRounds, 0, 99),
    onHitEffect: String(technique.onHitEffect || '').trim().slice(0, 160),
  };
}

export function weaponTechniqueTargetCA(baseCA, technique) {
  const ca = Number.isFinite(Number(baseCA)) ? Number(baseCA) : 10;
  return ca + _int(technique?.defenseBonus, 0, 30);
}

export function combinedTechniqueTargetCA(baseCA, techniques = []) {
  const ca = Number.isFinite(Number(baseCA)) ? Number(baseCA) : 10;
  return ca + (Array.isArray(techniques) ? techniques : [])
    .reduce((total, technique) => total + _int(technique?.defenseBonus, 0, 30), 0);
}

function _scaledFormula(formula, multiplier) {
  const count = Math.max(0, parseInt(multiplier, 10) || 0);
  if (!formula || count <= 0) return '';
  const match = String(formula).match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!match) return formula;
  const dice = (parseInt(match[1], 10) || 1) * count;
  const sides = parseInt(match[2], 10);
  const mod = (parseInt(match[3], 10) || 0) * count;
  return `${dice}d${sides}${mod > 0 ? `+${mod}` : mod < 0 ? mod : ''}`;
}

export function techniqueScalingSteps(technique, context = {}) {
  const normalized = normalizeWeaponTechnique(technique);
  if (normalized.scalingMode === 'none' || !normalized.scalingFormula) return 0;
  const source = normalized.scalingMode === 'level' ? context.level
    : normalized.scalingMode === 'mastery' ? context.masteryBonus
      : context.statModifier;
  return Math.max(0, Math.floor((parseInt(source, 10) || 0) / normalized.scalingEvery));
}

export function weaponTechniqueDamageTerms(technique, weaponFormula = '', weaponModifier = 0, scalingContext = {}) {
  if (!technique) return [];
  const normalized = normalizeWeaponTechnique(technique);
  const terms = [];
  const weaponSides = String(weaponFormula || '').match(/(?:^|[^a-z0-9])(\d*)d(\d+)/i)?.[2];
  if (normalized.extraWeaponDice > 0 && weaponSides) {
    terms.push({ kind: 'weapon', formula: `${normalized.extraWeaponDice}d${weaponSides}` });
  }
  if (normalized.extraDamageFormula) {
    terms.push({ kind: 'formula', formula: normalized.extraDamageFormula });
  }
  const modifier = Math.min(99, Math.max(-99, parseInt(weaponModifier, 10) || 0));
  if (normalized.addWeaponModifier && modifier !== 0) {
    terms.push({ kind: 'weapon_modifier', flat: modifier });
  }
  if (normalized.extraDamageFlat > 0) {
    terms.push({ kind: 'flat', flat: normalized.extraDamageFlat });
  }
  const scalingSteps = techniqueScalingSteps(normalized, scalingContext);
  if (scalingSteps > 0) {
    terms.push({
      kind: 'scaling',
      formula: _scaledFormula(normalized.scalingFormula, scalingSteps),
      steps: scalingSteps,
    });
  }
  return terms;
}

export function techniqueOutcomeMultiplier(technique, outcome = {}) {
  const normalized = normalizeWeaponTechnique(technique);
  // Une parade/bouclier annule toute l'action. Un échec critique ne conserve
  // jamais les effets d'une technique normalement prévue sur une touche.
  if (outcome.blocked) return 0;
  if (normalized.trigger === 'crit') return outcome.isCrit ? 1 : 0;
  if (normalized.trigger === 'miss') {
    if (outcome.hit) return 0;
    return normalized.missEffectMode === 'half' ? 0.5 : 1;
  }
  if (normalized.trigger === 'always') return 1;
  if (outcome.hit) return 1;
  if (outcome.isFumble) return 0;
  return normalized.missEffectMode === 'full' ? 1 : normalized.missEffectMode === 'half' ? 0.5 : 0;
}

export function techniqueTriggerApplies(technique, outcome = {}) {
  return techniqueOutcomeMultiplier(technique, outcome) > 0;
}

export function techniqueAllowedForAction(technique, { ability = false } = {}) {
  return !ability || normalizeWeaponTechnique(technique).allowWithAbilities;
}

/** Une explosion de technique entoure toute l'empreinte de la cible initiale.
 * Rayon 1 : 3×3 autour d'un token 1×1, 5×5 autour d'un token 3×3. */
export function techniqueBlastIntersects(origin = {}, candidate = {}, technique = {}) {
  const radius = _int(technique?.blastRadius, 0, 30);
  if (radius <= 0) return false;
  const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const ox1 = number(origin.col, NaN) - radius;
  const oy1 = number(origin.row, NaN) - radius;
  const ow = Math.max(1, Math.min(5, number(origin.width, 1)));
  const oh = Math.max(1, Math.min(5, number(origin.height, 1)));
  const ox2 = number(origin.col, NaN) + ow + radius;
  const oy2 = number(origin.row, NaN) + oh + radius;
  const cx1 = number(candidate.col, NaN);
  const cy1 = number(candidate.row, NaN);
  const cw = Math.max(1, Math.min(5, number(candidate.width, 1)));
  const ch = Math.max(1, Math.min(5, number(candidate.height, 1)));
  if (![ox1, oy1, ox2, oy2, cx1, cy1].every(Number.isFinite)) return false;
  return cx1 < ox2 && cx1 + cw > ox1 && cy1 < oy2 && cy1 + ch > oy1;
}

/** Zone générique sur grille. Les lignes et cônes partent toujours du lanceur
 * vers la cible visée ; carré/cercle respectent l'origine configurée. */
export function techniqueAreaIntersects({ origin = {}, candidate = {}, source = {}, aim = {} } = {}, technique = {}) {
  const normalized = normalizeWeaponTechnique(technique);
  const radius = normalized.blastRadius;
  if (radius <= 0) return false;
  const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const rect = value => {
    const width = Math.max(1, Math.min(5, number(value.width, 1)));
    const height = Math.max(1, Math.min(5, number(value.height, 1)));
    const x = number(value.col, NaN), y = number(value.row, NaN);
    return { x, y, width, height, cx: x + width / 2, cy: y + height / 2 };
  };
  const o = rect(origin), c = rect(candidate), s = rect(source), a = rect(aim);
  if (![o.x, o.y, c.x, c.y].every(Number.isFinite)) return false;
  if (normalized.areaShape === 'square') return techniqueBlastIntersects(origin, candidate, normalized);
  if (normalized.areaShape === 'circle') {
    const dx = Math.max(o.x - (c.x + c.width), c.x - (o.x + o.width), 0);
    const dy = Math.max(o.y - (c.y + c.height), c.y - (o.y + o.height), 0);
    return Math.hypot(dx, dy) <= radius;
  }
  if (![s.cx, s.cy, a.cx, a.cy, c.cx, c.cy].every(Number.isFinite)) return false;
  const vx = a.cx - s.cx, vy = a.cy - s.cy;
  const length = Math.hypot(vx, vy);
  if (length < 0.001) return false;
  const ux = vx / length, uy = vy / length;
  const rx = c.cx - s.cx, ry = c.cy - s.cy;
  const along = rx * ux + ry * uy;
  const across = Math.abs(rx * uy - ry * ux);
  const allowance = Math.max(c.width, c.height) / 2;
  if (along < -allowance || along > radius + allowance) return false;
  return normalized.areaShape === 'cone'
    ? across <= Math.max(0.75, along) + allowance
    : across <= 0.5 + allowance;
}
