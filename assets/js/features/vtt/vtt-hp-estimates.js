// Les jauges estimées des joueurs suivent les résultats publics du combat,
// jamais les PV réels (newHp, hpMax ou dmgApplied) enregistrés pour le MJ.
export function combatHpDeltas(log) {
  if (!log || log.actionUndone || log.shieldCancelled || log.isMana) return [];
  const targets = log.type === 'attack-multi'
    ? (Array.isArray(log.targets) ? log.targets : [])
    : log.type === 'attack' ? [{ ...log, tokenId: log.defenderTokenId }] : [];
  return targets.flatMap(target => {
    if (!target?.tokenId || (!log.isHeal && !target.hit && !target.halfDmg)) return [];
    const amount = Number(log.isHeal ? (target.dmgTotal ?? log.healTotal) : target.dmgTotal);
    return Number.isFinite(amount) && amount !== 0
      ? [{ tokenId: target.tokenId, delta: log.isHeal ? amount : -amount }]
      : [];
  });
}

export function replayCombatHpEstimates(events, tokens, tracker) {
  const estimates = new Map();
  const ordered = [...events].sort((a, b) =>
    (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
  for (const event of ordered) {
    for (const { tokenId, delta } of event.deltas) {
      const token = tokens[tokenId]?.data;
      if (token?.type !== 'enemy') continue;
      const max = Number(tracker[token.beastId]?.pvActuel);
      if (!Number.isFinite(max) || max <= 0) continue;
      const current = estimates.get(tokenId)?.current ?? max;
      estimates.set(tokenId, { current: Math.max(0, Math.min(max, current + delta)), max });
    }
  }
  return estimates;
}
