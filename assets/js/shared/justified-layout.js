// Moteur pur de mise en page « Fresque » : rangées à hauteur constante,
// recadrage borné et blocs « à la une » sur deux rangées.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const DEFAULTS = { gap: 8, tolerance: 0.12, minRatio: 0.5, maxRatio: 2.4, soften: 0.9, features: true, featureMinWidth: 760, maxPerRow: 18, side: 0 };
const safeRatio = ratio => { const value = Number(ratio); return Number.isFinite(value) && value > 0 ? value : 4 / 3; };

function solveRow(sum, available, targetHeight, tolerance) {
  const requestedScale = available / (targetHeight * sum);
  if (requestedScale >= 1 - tolerance && requestedScale <= 1 + tolerance) return { h: targetHeight, scale: requestedScale, requestedScale };
  const scale = requestedScale > 1 ? 1 + tolerance : 1 - tolerance;
  return { h: available / (sum * scale), scale, requestedScale };
}
function rowCost(solution, targetHeight) {
  const heightDelta = (solution.h - targetHeight) / targetHeight;
  const cropDelta = solution.scale - 1;
  return 4 * heightDelta * heightDelta + cropDelta * cropDelta;
}
function layoutCell(entry, x, y, width, height) {
  return { id: entry.id, item: entry.item, x, y, w: width, h: height, ratio: entry.ratio, crop: Math.abs((width / height) / entry.ratio - 1) };
}
function rowCells(entries, startX, y, availableWidth, solution, gap, ragged, targetHeight) {
  const cells = [];
  if (ragged) {
    let x = startX;
    entries.forEach(entry => { const width = Math.round(entry.layoutRatio * targetHeight); cells.push(layoutCell(entry, x, y, width, targetHeight)); x += width + gap; });
    return cells;
  }
  const height = Math.round(solution.h);
  let accumulated = 0, previous = 0;
  entries.forEach((entry, index) => {
    accumulated += entry.layoutRatio * solution.h * solution.scale;
    const end = index === entries.length - 1 ? availableWidth : Math.round(accumulated);
    cells.push(layoutCell(entry, startX + previous + index * gap, y, end - previous, height));
    previous = end;
  });
  return cells;
}
function optimalRows(entries, width, targetHeight, gap, tolerance, maxPerRow, raggedLast) {
  const count = entries.length; if (!count) return [];
  const best = new Array(count + 1).fill(Infinity), from = new Array(count + 1).fill(-1), prefix = [0];
  best[0] = 0;
  entries.forEach(entry => prefix.push(prefix[prefix.length - 1] + entry.layoutRatio));
  for (let end = 1; end <= count; end++) {
    for (let start = Math.max(0, end - maxPerRow); start < end; start++) {
      if (best[start] === Infinity) continue;
      const rowCount = end - start, available = width - (rowCount - 1) * gap;
      if (available <= 0) continue;
      const solution = solveRow(prefix[end] - prefix[start], available, targetHeight, tolerance);
      const cost = raggedLast && end === count && solution.requestedScale > 1 + tolerance ? 0 : rowCost(solution, targetHeight);
      if (best[start] + cost < best[end]) { best[end] = best[start] + cost; from[end] = start; }
    }
  }
  const spans = []; let end = count;
  while (end > 0) { const start = from[end]; spans.unshift([start, end]); end = start; }
  return spans.map(([start, rowEnd]) => {
    const rowCount = rowEnd - start, available = width - (rowCount - 1) * gap;
    const solution = solveRow(prefix[rowEnd] - prefix[start], available, targetHeight, tolerance);
    return { items: entries.slice(start, rowEnd), solution, available, ragged: raggedLast && rowEnd === count && solution.requestedScale > 1 + tolerance };
  });
}
function featureBlock(feature, candidates, width, targetHeight, gap, side, atEnd) {
  if (candidates.length < 2) return null;
  const blockHeight = 2 * targetHeight + gap, initialFeatureWidth = clamp(feature.layoutRatio, 0.5, 1.6) * blockHeight;
  if (initialFeatureWidth < 0.2 * width || initialFeatureWidth > 0.64 * width) return null;
  const initialAsideWidth = width - initialFeatureWidth - gap;
  if (initialAsideWidth < 1.1 * targetHeight) return null;
  const pick = (start, max) => {
    let best = null, sum = 0;
    for (let length = 1; length <= max; length++) {
      sum += candidates[start + length - 1].layoutRatio;
      const scale = (initialAsideWidth - (length - 1) * gap) / (targetHeight * sum), error = Math.abs(Math.log(scale));
      if (!best || error < best.error) best = { length, sum, error };
      if (scale < 1) break;
    }
    return best;
  };
  const first = pick(0, Math.min(7, candidates.length - 1)); if (!first) return null;
  const second = pick(first.length, Math.min(7, candidates.length - first.length)); if (!second) return null;
  const naturalWidth = row => targetHeight * row.sum + (row.length - 1) * gap;
  let featureWidth, asideWidth, firstScale, secondScale, raggedSecond = false;
  const fit = target => {
    featureWidth = Math.round(clamp(width - gap - target, initialFeatureWidth * 0.85, initialFeatureWidth * 1.15));
    asideWidth = width - featureWidth - gap;
    firstScale = (asideWidth - (first.length - 1) * gap) / (targetHeight * first.sum);
    secondScale = (asideWidth - (second.length - 1) * gap) / (targetHeight * second.sum);
  };
  fit((naturalWidth(first) + naturalWidth(second)) / 2);
  if (Math.abs(firstScale - 1) > 0.22 || Math.abs(secondScale - 1) > 0.22) {
    if (!(atEnd && first.length + second.length === candidates.length && secondScale > 1)) return null;
    fit(naturalWidth(first)); raggedSecond = true;
    if (Math.abs(firstScale - 1) > 0.22) return null;
  }
  const featureX = side ? width - featureWidth : 0, asideX = side ? 0 : featureWidth + gap;
  const featuredCell = layoutCell(feature, featureX, 0, featureWidth, blockHeight); featuredCell.featured = true;
  const firstEntries = candidates.slice(0, first.length), secondEntries = candidates.slice(first.length, first.length + second.length);
  const secondCells = raggedSecond
    ? rowCells(secondEntries, asideX, targetHeight + gap, 0, null, gap, true, targetHeight)
    : rowCells(secondEntries, asideX, targetHeight + gap, asideWidth - (second.length - 1) * gap, { h: targetHeight, scale: secondScale }, gap, false, targetHeight);
  let tail = null;
  if (raggedSecond) { const end = Math.max(...secondCells.map(cell => cell.x + cell.w)); tail = { x: end + gap, y: targetHeight + gap, w: asideX + asideWidth - end - gap, h: targetHeight }; }
  return { height: blockHeight, used: first.length + second.length, tail, cells: [featuredCell, ...rowCells(firstEntries, asideX, 0, asideWidth - (first.length - 1) * gap, { h: targetHeight, scale: firstScale }, gap, false, targetHeight), ...secondCells] };
}

export function buildFresqueLayout(items, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const width = Math.max(1, Math.floor(config.width)), targetHeight = Math.max(40, Math.round(config.height)), gap = Math.max(0, Number(config.gap) || 0);
  const maxPerRow = Math.min(config.maxPerRow, Math.ceil(width / (targetHeight * 0.42)) + 1);
  const entries = (items || []).map(item => {
    const ratio = safeRatio(item.ratio ?? item.aspectRatio);
    return { id: item.id, item, ratio, layoutRatio: clamp(Math.pow(ratio, config.soften), config.minRatio, config.maxRatio), featured: item.featured === true };
  });
  const featureEnabled = config.features && width >= config.featureMinWidth;
  const cells = [], rowHeights = [];
  let y = 0, side = config.side || 0, pending = [], last = null;
  const placeRows = rows => rows.forEach(row => {
    cells.push(...rowCells(row.items, 0, y, row.available, row.solution, gap, row.ragged, targetHeight));
    const height = row.ragged ? targetHeight : Math.round(row.solution.h);
    if (!row.ragged) rowHeights.push(height);
    last = { y, h: height, ragged: row.ragged };
    y += height + gap;
  });
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (featureEnabled && entry.featured) {
      const previousRows = optimalRows(pending, width, targetHeight, gap, config.tolerance, maxPerRow, true);
      const leftover = previousRows.length && previousRows[previousRows.length - 1].ragged ? previousRows.pop().items : [];
      const following = []; let cursor = index + 1;
      while (cursor < entries.length && !entries[cursor].featured && following.length < 14) following.push(entries[cursor++]);
      const candidates = [...leftover, ...following], block = featureBlock(entry, candidates, width, targetHeight, gap, side, cursor === entries.length);
      if (block) {
        placeRows(previousRows);
        block.cells.forEach(cell => { cell.y += y; cells.push(cell); });
        rowHeights.push(targetHeight, targetHeight);
        last = { y, h: block.height, ragged: false, tail: block.tail ? { ...block.tail, y: block.tail.y + y } : null };
        y += block.height + gap; side ^= 1; pending = candidates.slice(block.used); index = cursor - 1; continue;
      }
    }
    pending.push(entry);
  }
  placeRows(optimalRows(pending, width, targetHeight, gap, config.tolerance, maxPerRow, true));
  let tail = last && !last.ragged ? last.tail || null : null;
  if (last?.ragged) { const end = Math.max(0, ...cells.filter(cell => cell.y === last.y).map(cell => cell.x + cell.w)); tail = { x: end + gap, y: last.y, w: width - end - gap, h: last.h }; }
  return { cells, height: Math.max(0, y - gap), rowHeights, side, tail, target: targetHeight };
}
