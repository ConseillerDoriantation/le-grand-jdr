// Règles pures d'identification des tokens temporaires du VTT.
// Une invocation/sentinelle ne doit jamais rejoindre la réserve permanente :
// elle existe sur une scène, puis elle est dissipée et son document est supprimé.

export function isTemporarySummonToken(token) {
  if (!token) return false;
  return !!(token.summonKind || token.summonOwnerId);
}

export function reserveSummonTokens(tokens = []) {
  return tokens.filter(token => isTemporarySummonToken(token) && !token.pageId);
}

/**
 * Normalise une modification de PM portée directement par une invocation.
 * `null` signifie que le token n'est pas une invocation dotée d'une réserve.
 */
export function resolveInvocationManaChange(token, requestedPm) {
  if (token?.summonKind !== 'invocation') return null;
  const max = Math.max(0, Math.floor(Number(token.pmMax) || 0));
  if (max <= 0) return null;
  const requested = Number(requestedPm);
  if (!Number.isFinite(requested)) return null;
  return {
    value: Math.max(0, Math.min(max, Math.round(requested))),
    max,
  };
}
