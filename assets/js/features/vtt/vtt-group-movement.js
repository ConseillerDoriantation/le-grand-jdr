/**
 * Prépare un pas de grille commun sans déformer la formation du groupe.
 * Aucun token n'est déplacé si l'un d'eux sortirait de la carte.
 */
export function planGroupGridStep(tokens = [], {
  dc = 0,
  dr = 0,
  cols = 0,
  rows = 0,
  getDimensions = () => ({ w: 1, h: 1 }),
} = {}) {
  const stepCol = Math.trunc(Number(dc) || 0);
  const stepRow = Math.trunc(Number(dr) || 0);
  if (!tokens.length || (!stepCol && !stepRow)) return { ok:false, reason:'empty', moves:[] };

  const moves = [];
  for (const token of tokens) {
    const dims = getDimensions(token) || {};
    const w = Math.max(1, Math.trunc(Number(dims.w) || 1));
    const h = Math.max(1, Math.trunc(Number(dims.h) || 1));
    const col = Math.trunc(Number(token?.col) || 0);
    const row = Math.trunc(Number(token?.row) || 0);
    const nextCol = col + stepCol;
    const nextRow = row + stepRow;
    if (nextCol < 0 || nextRow < 0 || nextCol + w > cols || nextRow + h > rows) {
      return { ok:false, reason:'bounds', tokenId:token?.id || null, moves:[] };
    }
    moves.push({ token, col:nextCol, row:nextRow, distance:Math.abs(stepCol) + Math.abs(stepRow) });
  }
  return { ok:true, reason:null, moves };
}
