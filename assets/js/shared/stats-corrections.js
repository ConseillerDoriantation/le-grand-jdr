const EDITABLE_COMBAT_FIELDS = new Set([
  'attacks', 'hits', 'crits', 'fumbles', 'dmgDealt', 'damageEvents', 'kosDealt',
  'attacksTaken', 'attacksAvoided', 'dmgTaken', 'damageTakenEvents', 'kosTaken',
  'heal', 'spellsCast', 'pmSpent',
]);

export function buildCombatCorrectionDeltas(current = {}, values = {}) {
  const next = {};
  for (const [field, value] of Object.entries(values || {})) {
    if (!EDITABLE_COMBAT_FIELDS.has(field)) continue;
    next[field] = Math.max(0, Math.trunc(Number(value) || 0));
  }
  if (Object.hasOwn(next, 'dmgDealt')) next.damageTotal = next.dmgDealt;
  if (Object.hasOwn(next, 'dmgTaken')) next.damageTakenTotal = next.dmgTaken;

  return Object.fromEntries(Object.entries(next)
    .map(([field, value]) => [field, value - Math.max(0, Number(current[field]) || 0)])
    .filter(([, delta]) => delta !== 0));
}
