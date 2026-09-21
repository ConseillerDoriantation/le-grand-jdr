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

export function roomFundingPlan(cost = 0, roomInvestment = 0, treasury = 0) {
  const safeCost = Math.max(0, Number(cost) || 0);
  const availableInvestment = Math.max(0, Number(roomInvestment) || 0);
  const availableTreasury = Math.max(0, Number(treasury) || 0);
  const investmentUsed = Math.min(safeCost, availableInvestment);
  const treasuryUsed = Math.min(Math.max(0, safeCost - investmentUsed), availableTreasury);
  const missing = Math.max(0, safeCost - investmentUsed - treasuryUsed);
  return { investmentUsed, treasuryUsed, missing, canFund: missing === 0 };
}
