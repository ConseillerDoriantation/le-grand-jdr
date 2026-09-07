/**
 * Calcule les dimensions de grille nécessaires pour conserver toutes les
 * images de scène à leur position et à leur taille actuelles. L'origine de la
 * scène reste (0, 0) : la grille s'étend jusqu'aux bords les plus éloignés.
 */
export function sceneGridSizeForImages(images, { min = 8, max = 200 } = {}) {
  const placed = (Array.isArray(images) ? images : []).filter(image => image && typeof image === 'object');
  if (!placed.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxRight = 0;
  let maxBottom = 0;
  for (const image of placed) {
    const x = Number.isFinite(Number(image.x)) ? Number(image.x) : 0;
    const y = Number.isFinite(Number(image.y)) ? Number(image.y) : 0;
    const w = Math.max(1, Number.isFinite(Number(image.w)) ? Number(image.w) : 1);
    const h = Math.max(1, Number.isFinite(Number(image.h)) ? Number(image.h) : 1);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxRight = Math.max(maxRight, x + w);
    maxBottom = Math.max(maxBottom, y + h);
  }

  const clamp = value => Math.max(min, Math.min(max, Math.ceil(value)));
  return {
    cols: clamp(maxRight),
    rows: clamp(maxBottom),
    imageCount: placed.length,
    minX,
    minY,
    maxRight,
    maxBottom,
    hasNegativeOrigin: minX < 0 || minY < 0,
    clippedByLimit: maxRight > max || maxBottom > max,
  };
}
