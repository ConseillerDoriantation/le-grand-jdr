const _int = (value, min, max) => Math.min(max, Math.max(min, parseInt(value, 10) || 0));

export function normalizeWeaponTechnique(technique = {}, index = 0) {
  const fallbackId = `technique_${index + 1}`;
  return {
    id: String(technique.id || fallbackId).trim().replace(/[^a-z0-9_-]/gi, '_') || fallbackId,
    icon: String(technique.icon || '🎯').trim().slice(0, 8) || '🎯',
    label: String(technique.label || `Technique ${index + 1}`).trim().slice(0, 60),
    description: String(technique.description || '').trim().slice(0, 240),
    defenseBonus: _int(technique.defenseBonus, 0, 30),
    extraWeaponDice: _int(technique.extraWeaponDice, 0, 9),
    extraDamageFormula: String(technique.extraDamageFormula || '').replace(/\s+/g, '').trim().slice(0, 30),
    extraDamageFlat: _int(technique.extraDamageFlat, 0, 999),
    onHitEffect: String(technique.onHitEffect || '').trim().slice(0, 160),
  };
}

export function weaponTechniqueTargetCA(baseCA, technique) {
  const ca = Number.isFinite(Number(baseCA)) ? Number(baseCA) : 10;
  return ca + _int(technique?.defenseBonus, 0, 30);
}

export function weaponTechniqueDamageTerms(technique, weaponFormula = '') {
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
  if (normalized.extraDamageFlat > 0) {
    terms.push({ kind: 'flat', flat: normalized.extraDamageFlat });
  }
  return terms;
}
