// Dimensionne une image contenue dans une lightbox à partir de l'espace intérieur
// réellement disponible, après retrait du padding de l'overlay.
export function fitLightboxMedia({
  imageRatio,
  hostWidth,
  hostHeight,
  stacked = false,
  sideWidth = 340,
  stackMaxWidth = 760,
  stackHeightShare = 0.58,
} = {}) {
  const ratio = Number(imageRatio);
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 4 / 3;
  const safeHostWidth = Math.max(1, Number(hostWidth) || 1);
  const safeHostHeight = Math.max(1, Number(hostHeight) || 1);
  const safeSideWidth = stacked ? 0 : Math.max(0, Number(sideWidth) || 0);
  const safeStackWidth = Math.max(1, Number(stackMaxWidth) || safeHostWidth);
  const safeStackShare = Math.min(1, Math.max(0.1, Number(stackHeightShare) || 0.58));
  const frameWidth = stacked ? Math.min(safeHostWidth, safeStackWidth) : safeHostWidth;
  const availableWidth = Math.max(1, frameWidth - safeSideWidth - 2);
  const availableHeight = Math.max(1, safeHostHeight * (stacked ? safeStackShare : 1) - 2);
  const width = Math.min(availableWidth, availableHeight * safeRatio);

  return {
    width: Math.round(width),
    height: Math.round(width / safeRatio),
  };
}

// Distingue un geste horizontal volontaire d'un simple tap ou d'un scroll
// vertical. Le signe suit la navigation visuelle : gauche = suivant.
export function resolveHorizontalSwipe({
  startX,
  startY,
  endX,
  endY,
  minDistance = 56,
  axisRatio = 1.2,
} = {}) {
  const dx = Number(endX) - Number(startX);
  const dy = Number(endY) - Number(startY);
  if (![dx, dy].every(Number.isFinite)) return null;
  if (Math.abs(dx) < Math.max(1, Number(minDistance) || 56)) return null;
  if (Math.abs(dx) <= Math.abs(dy) * Math.max(1, Number(axisRatio) || 1.2)) return null;
  return dx < 0 ? 'next' : 'previous';
}
