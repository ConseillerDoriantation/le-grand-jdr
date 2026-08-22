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
