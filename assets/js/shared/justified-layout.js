// Construit des rangées de galerie justifiées sans dépendance au DOM.
// Chaque rangée complète occupe la largeur disponible ; la dernière conserve
// la hauteur cible tant qu'elle ne déborde pas.
export function buildJustifiedRows(items, containerWidth, targetHeight, gap = 0) {
  const rows = [];
  const safeWidth = Math.max(1, Number(containerWidth) || 1);
  const safeTargetHeight = Math.max(1, Number(targetHeight) || 1);
  const safeGap = Math.max(0, Number(gap) || 0);
  let row = [];
  let ratioSum = 0;

  const flush = (partial) => {
    const count = row.length;
    if (!count) return;
    const availableWidth = Math.max(1, safeWidth - (count - 1) * safeGap);
    const exactHeight = availableWidth / ratioSum;
    const displayHeight = partial ? Math.min(safeTargetHeight, exactHeight) : exactHeight;
    rows.push({
      h: Math.round(displayHeight),
      items: row.map(item => ({ ...item, w: Math.round(item._ratio * displayHeight) })),
    });
    row = [];
    ratioSum = 0;
  };

  for (const item of items || []) {
    const measuredRatio = Number(item?.aspectRatio);
    const ratio = Number.isFinite(measuredRatio) && measuredRatio > 0 ? measuredRatio : 4 / 3;
    const candidate = { ...item, _ratio: ratio };

    if (row.length) {
      const previousAvailableWidth = Math.max(1, safeWidth - (row.length - 1) * safeGap);
      const previousHeight = previousAvailableWidth / ratioSum;
      const nextCount = row.length + 1;
      const nextRatioSum = ratioSum + ratio;
      const nextAvailableWidth = Math.max(1, safeWidth - (nextCount - 1) * safeGap);
      const nextHeight = nextAvailableWidth / nextRatioSum;

      if (nextHeight <= safeTargetHeight) {
        // L'image courante fait passer la rangée sous la cible. On la conserve
        // uniquement si le résultat est plus proche de la hauteur recherchée.
        if (Math.abs(previousHeight - safeTargetHeight) <= Math.abs(nextHeight - safeTargetHeight)) {
          flush(false);
          row.push(candidate);
          ratioSum = ratio;
          continue;
        }
        row.push(candidate);
        ratioSum = nextRatioSum;
        flush(false);
        continue;
      }
    }

    row.push(candidate);
    ratioSum += ratio;
  }

  if (row.length) flush(true);
  return rows;
}
