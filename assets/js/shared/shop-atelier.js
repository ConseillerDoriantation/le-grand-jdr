// Helpers purs de l'atelier : aucune dépendance DOM/Firestore.

const _sameValue = (a, b) => (a ?? null) === (b ?? null);

export function atelierCompactSlots(equipped = {}, slots = {}) {
  const compact = {};
  Object.entries(slots || {}).forEach(([slot, itemId]) => {
    if (!_sameValue(itemId, equipped?.[slot])) compact[slot] = itemId ?? null;
  });
  return compact;
}

export function atelierApplyBuild(equipped = {}, slots = {}, {
  primarySlot = 'Main principale',
  secondarySlot = 'Main secondaire',
  isTwoHanded = () => false,
} = {}) {
  const loadout = { ...(equipped || {}) };
  Object.entries(slots || {}).forEach(([slot, itemId]) => {
    loadout[slot] = itemId ?? null;
  });
  if (isTwoHanded(loadout[primarySlot])) loadout[secondarySlot] = null;
  return loadout;
}

export function atelierGainScore(diffs = []) {
  const weights = {
    ca: 2,
    pv: .35,
    pm: .3,
    vitesse: 1.5,
    degats: 1,
    stat: .6,
  };
  const score = (diffs || []).reduce((total, diff) => {
    const key = String(diff?.key || '').toLowerCase();
    const weight = weights[key] ?? (key.startsWith('stat:') ? weights.stat : 0);
    return total + (Number(diff?.delta) || 0) * weight;
  }, 0);
  return Math.round(score * 1000) / 1000;
}

export function atelierNetCost({ purchase = 0, resaleCredit = 0, resale = true } = {}) {
  const gross = Math.max(0, Number(purchase) || 0);
  const credit = resale ? Math.max(0, Number(resaleCredit) || 0) : 0;
  return { gross, credit, net: gross - credit };
}
