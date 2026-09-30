export function shopItemBuyState(item = {}, ctx = {}) {
  const prix = Number.parseFloat(item.prix) || 0;
  const rawStock = item.dispo;
  const parsedStock = rawStock !== undefined && rawStock !== null && rawStock !== ''
    ? Number.parseInt(rawStock, 10)
    : null;
  const dispo = parsedStock == null || Number.isNaN(parsedStock) || parsedStock < 0 ? null : parsedStock;
  const budget = Number.isFinite(Number(ctx.remaining)) ? Number(ctx.remaining) : Number(ctx.gold) || 0;
  const tropCher = !!ctx.char && prix > budget;
  return {
    prix,
    dispo,
    epuise: dispo === 0,
    tropCher,
    manque: tropCher ? Math.ceil(prix - budget) : 0,
  };
}

export function shopCartTotals(balance = 0, lines = [], trades = []) {
  const articles = lines.reduce((sum, line) => {
    const qty = Math.max(0, Number.parseInt(line?.qty, 10) || 0);
    return sum + (Number.parseFloat(line?.price) || 0) * qty;
  }, 0);
  const reprises = trades.reduce((sum, trade) => sum + (Number.parseFloat(trade?.credit) || 0), 0);
  const total = articles - reprises;
  return {
    articles,
    reprises,
    total,
    remaining: (Number.parseFloat(balance) || 0) - total,
    count: lines.reduce((sum, line) => sum + Math.max(0, Number.parseInt(line?.qty, 10) || 0), 0),
  };
}

export function shopUpgradeGain(diffs = []) {
  return diffs.reduce((sum, diff) => {
    const delta = Number(diff?.d) || 0;
    return sum + (diff?.dice ? delta * 0.5 : delta);
  }, 0);
}

/** Score d'affinité pure entre un article normalisé et le profil d'équipement
 * du personnage. Les incompatibilités strictes sont filtrées dans shop.js ; ce
 * score sert ensuite à départager les améliorations cohérentes. */
export function shopAffinityScore(candidate = {}, profile = {}) {
  let score = 0;
  const dominant = Array.isArray(profile.dominantStats) ? profile.dominantStats : [];
  const bonuses = candidate.statBonuses || {};

  if (candidate.kind === 'weapon') {
    const families = Array.isArray(profile.weaponFamilies) ? profile.weaponFamilies : [];
    const natures = Array.isArray(profile.weaponNatures) ? profile.weaponNatures : [];
    const hands = Array.isArray(profile.weaponHands) ? profile.weaponHands : [];
    if (families.length && candidate.weaponFamily) score += families.includes(candidate.weaponFamily) ? 260 : -180;
    if (natures.length && candidate.weaponNature) score += natures.includes(candidate.weaponNature) ? 150 : -360;
    if (hands.length && candidate.weaponHands) score += hands.includes(candidate.weaponHands) ? 35 : -20;
    if (candidate.attackStat) {
      if (candidate.attackStat === dominant[0]) score += 110;
      else if (candidate.attackStat === dominant[1]) score += 65;
      else if (dominant.length) score -= 35;
    }
  } else if (candidate.kind === 'armor') {
    if (profile.armorType && candidate.armorType) score += profile.armorType === candidate.armorType ? 220 : -220;
    const slotType = candidate.slot && profile.armorBySlot?.[candidate.slot];
    if (slotType && candidate.armorType) score += slotType === candidate.armorType ? 100 : -80;
  }

  const primaryBonus = Number(bonuses[dominant[0]]) || 0;
  const secondaryBonus = Number(bonuses[dominant[1]]) || 0;
  if (primaryBonus > 0) score += Math.min(180, primaryBonus * 55);
  if (secondaryBonus > 0) score += Math.min(90, secondaryBonus * 30);
  return score;
}
