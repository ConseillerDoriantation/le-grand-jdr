export function roomInvestmentTotal(investments = [], roomSlug = '') {
  return (investments || []).reduce((total, investment) => {
    if (investment?.roomSlug !== roomSlug) return total;
    return total + Math.max(0, Number(investment.amount) || 0);
  }, 0);
}

export function roomInvestmentAvailable(bastion = {}, investments = [], roomSlug = '') {
  const total = roomInvestmentTotal(investments, roomSlug);
  const spent = Math.max(0, Number(bastion?.roomInvestmentSpent?.[roomSlug]) || 0);
  return Math.max(0, total - spent);
}

export function roomInvestmentContributors(bastion = {}, investments = [], roomSlug = '') {
  const grouped = new Map();
  for (const investment of investments || []) {
    if (investment?.roomSlug !== roomSlug || !(Number(investment.amount) > 0)) continue;
    const key = investment.charId || investment.uid || investment.id;
    const row = grouped.get(key) || {
      charId: investment.charId || '',
      charName: investment.charName || 'Personnage',
      amount: 0,
    };
    row.amount += Number(investment.amount) || 0;
    grouped.set(key, row);
  }
  const rows = [...grouped.values()];
  const rawTotal = rows.reduce((sum, row) => sum + row.amount, 0);
  const available = Math.floor(roomInvestmentAvailable(bastion, investments, roomSlug));
  if (!(rawTotal > 0) || !(available > 0)) return [];
  if (available >= rawTotal) return rows.sort((a, b) => b.amount - a.amount || a.charName.localeCompare(b.charName, 'fr'));

  // Les anciens versements sont cumulés par document alors que le Bastion ne
  // stocke que le total déjà consommé. Une répartition proportionnelle garde
  // donc la somme affichée strictement égale à la cagnotte encore disponible.
  const scaled = rows.map(row => {
    const exact = row.amount * available / rawTotal;
    return { ...row, amount: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let remainder = available - scaled.reduce((sum, row) => sum + row.amount, 0);
  scaled.sort((a, b) => b.fraction - a.fraction || b.amount - a.amount);
  for (let index = 0; remainder > 0 && scaled.length; index = (index + 1) % scaled.length, remainder--) scaled[index].amount++;
  return scaled.filter(row => row.amount > 0).map(({ fraction, ...row }) => row)
    .sort((a, b) => b.amount - a.amount || a.charName.localeCompare(b.charName, 'fr'));
}

export function roomFundingPlan(cost = 0, roomInvestment = 0, treasury = 0) {
  const safeCost = Math.max(0, Number(cost) || 0);
  const availableInvestment = Math.max(0, Number(roomInvestment) || 0);
  const availableTreasury = Math.max(0, Number(treasury) || 0);
  const investmentUsed = Math.min(safeCost, availableInvestment);
  const treasuryUsed = Math.min(Math.max(0, safeCost - investmentUsed), availableTreasury);
  const missing = Math.max(0, safeCost - investmentUsed - treasuryUsed);
  return { investmentUsed, treasuryUsed, missing, canFund: missing === 0 };
}

export function sortBastionProjects(projects = []) {
  return [...(projects || [])].sort((a, b) => {
    const remaining = Math.max(0, Number(a?.remaining) || 0) - Math.max(0, Number(b?.remaining) || 0);
    if (remaining) return remaining;
    return String(a?.name || a?.slug || '').localeCompare(String(b?.name || b?.slug || ''), 'fr');
  });
}

export function bastionEqualShare(remaining = 0, activeCharacterCount = 0) {
  const total = Math.max(0, Number(remaining) || 0);
  const count = Math.max(0, Math.floor(Number(activeCharacterCount) || 0));
  return count > 0 ? Math.ceil(total / count) : total;
}

export function bastionRoomProjects(bastion = {}, investments = []) {
  const catalog = Array.isArray(bastion?.roomCatalog) ? bastion.roomCatalog : [];
  const rooms = bastion?.salles || {};
  return sortBastionProjects(catalog.flatMap(def => {
    const room = rooms[def.slug] || {};
    const level = Math.max(0, Number(room.niveau) || 0);
    const maxLevel = def.unlimited ? (Number(def.maxLevel) || 99) : (def.niveaux?.length || 0);
    if (room.weeksLeftToBuild > 0 || level >= maxLevel) return [];
    const invested = roomInvestmentAvailable(bastion, investments, def.slug);
    if (!(invested > 0)) return [];
    const target = level + 1;
    const next = def.unlimited
      ? {
          cout: Math.round((Number(def.baseCost) || 100) * Math.pow(Number(def.costMultiplier) || 1.1, target - 1)),
          semaines: Number(def.baseSemaines) || 1,
          bonus: `Capacité du coffre : ${20 + target * (Number(def.capacitePerLevel) || 10)} objets.`,
          application: 'auto',
          prod: { or: 0, items: [] },
        }
      : (def.niveaux?.[level] || {});
    const cost = Math.max(0, Number(next.cout) || 0);
    return [{
      slug: def.slug,
      name: def.nom || def.slug,
      def,
      level,
      target,
      next,
      cost,
      invested: Math.min(cost, invested),
      remaining: Math.max(0, cost - invested),
    }];
  }));
}
