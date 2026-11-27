// Fresque : les rangées varient en hauteur pour respecter les proportions
// des images, sans rogner leur contenu ni ajouter de fond de remplissage.
const DEFAULTS = { gap: 8, features: true, featureMinWidth: 760, maxPerRow: 32, side: 0 };
const PORTRAIT_RATIO = .85;
const ROW_PENALTY = .03;
const safeRatio = ratio => { const value = Number(ratio); return Number.isFinite(value) && value > 0 ? value : 4 / 3; };
const heightCost = (height, target) => ((height - target) / target) ** 2;
const portraitCost = (height, target) => 3 * Math.max(0, 1.02 - height / target) ** 2;
const layoutCell = (entry, x, y, w, h) => ({ id: entry.id, item: entry.item, x, y, w, h, ratio: entry.ratio });
function rowCells(entries, startX, y, height, gap) {
  let x = startX;
  return entries.map(entry => {
    const cell = layoutCell(entry, x, y, entry.ratio * height, height);
    x += cell.w + gap;
    return cell;
  });
}
function optimalRows(entries, width, targetHeight, gap, maxPerRow, featuredHeight) {
  const count = entries.length; if (!count) return [];
  const best = new Array(count + 1).fill(Infinity), from = new Array(count + 1);
  const prefix = [0], featured = [0], portraits = [0];
  best[0] = 0;
  entries.forEach(entry => {
    prefix.push(prefix.at(-1) + entry.ratio);
    featured.push(featured.at(-1) + Number(entry.featured));
    portraits.push(portraits.at(-1) + Number(entry.ratio < PORTRAIT_RATIO));
  });
  const rowHeight = (start, end) => (width - (end - start - 1) * gap) / (prefix[end] - prefix[start]);
  // Plusieurs vedettes peuvent partager cette rangée agrandie sans que
  // l'une soit reléguée dans les petites tuiles d'un bloc de l'autre.
  const hasPortrait = (start, end) => portraits[end] > portraits[start];
  const idealHeight = (start, end) => featured[end] > featured[start] ? featuredHeight
    : hasPortrait(start, end) ? Math.round(targetHeight * 1.08) : targetHeight;
  const consider = (start, end, cost, stack = null) => {
    if (best[start] + cost < best[end]) {
      best[end] = best[start] + cost;
      from[end] = { start, stack };
    }
  };
  for (let start = 0; start < count; start++) {
    for (let end = start + 1; end <= Math.min(count, start + maxPerRow); end++) {
      const height = rowHeight(start, end);
      if (height <= 0) break;
      const ideal = idealHeight(start, end);
      const cost = end === count && height > ideal * 1.12 ? 0
        : heightCost(height, ideal) + (hasPortrait(start, end) ? portraitCost(height, targetHeight) : 0);
      consider(start, end, cost + ROW_PENALTY);
    }
    // Un portrait garde sa place à gauche des deux rangées paysage qui
    // le suivent, au lieu de partager leur hauteur sur une seule rangée.
    const portrait = entries[start];
    if (width >= 760 && !portrait.featured && portrait.ratio < PORTRAIT_RATIO) {
      const landscapes = [];
      for (let i = start + 1; i < count && landscapes.length < 8; i++) {
        if (entries[i].featured || entries[i].ratio < 1.25) break;
        landscapes.push(entries[i]);
      }
      for (const shape of stackChoices(portrait, landscapes, width, targetHeight, gap, true)) {
        consider(start, start + 1 + shape.used, shape.cost + 2 * ROW_PENALTY, shape);
      }
    }
  }
  const rows = [];
  for (let end = count; end > 0;) {
    const { start, stack } = from[end];
    if (stack) {
      rows.push({ block: layoutStack(entries[start], entries.slice(start + 1, end), stack, width, gap, 0) });
      end = start;
      continue;
    }
    const height = rowHeight(start, end);
    const ideal = idealHeight(start, end);
    const ragged = end === count && height > ideal * 1.12;
    rows.push({ items: entries.slice(start, end), height: ragged ? ideal : height, ragged });
    end = start;
  }
  return rows.reverse();
}
function* stackChoices(lead, candidates, width, targetHeight, gap, portrait = false) {
  const minAside = targetHeight * (portrait ? .68 : .72), maxAside = targetHeight * (portrait ? 1.16 : 1.3);
  const idealAside = portrait ? targetHeight * .86 : targetHeight;
  const minShare = portrait ? .13 : .2, maxShare = portrait ? .48 : .64;
  let firstRatio = 0, firstPortrait = false;
  for (let first = 1; first <= 7 && first < candidates.length; first++) {
    firstRatio += candidates[first - 1].ratio;
    firstPortrait ||= candidates[first - 1].ratio < PORTRAIT_RATIO;
    const firstGap = (first - 1) * gap;
    let secondRatio = 0, secondPortrait = false;
    for (let second = 1; second <= 7 && first + second <= candidates.length; second++) {
      secondRatio += candidates[first + second - 1].ratio;
      secondPortrait ||= candidates[first + second - 1].ratio < PORTRAIT_RATIO;
      const secondGap = (second - 1) * gap;
      // Même largeur pour les deux rangées adjacentes. L'image haute prend
      // leur hauteur cumulée ; les trois proportions déterminent la largeur.
      const aside = (width - gap - lead.ratio * (gap - firstGap / firstRatio - secondGap / secondRatio))
        / (1 + lead.ratio * (1 / firstRatio + 1 / secondRatio));
      const h1 = (aside - firstGap) / firstRatio, h2 = (aside - secondGap) / secondRatio;
      const leadWidth = width - gap - aside;
      if (Math.min(h1, h2) < minAside || Math.max(h1, h2) > maxAside
        || leadWidth < width * minShare || leadWidth > width * maxShare) continue;
      const cost = heightCost(h1, idealAside) + heightCost(h2, idealAside)
        + (firstPortrait ? portraitCost(h1, targetHeight) : 0) + (secondPortrait ? portraitCost(h2, targetHeight) : 0);
      yield { first, used: first + second, h1, h2, leadWidth, cost };
    }
  }
}
function layoutStack(lead, candidates, shape, width, gap, side) {
  const { first, h1, h2, leadWidth, used } = shape, height = h1 + h2 + gap;
  const leadX = side ? width - leadWidth : 0, asideX = side ? 0 : leadWidth + gap;
  const leadCell = layoutCell(lead, leadX, 0, leadWidth, height);
  if (lead.featured) leadCell.featured = true;
  return { height, used, rowHeights: [h1, h2], cells: [
    leadCell,
    ...rowCells(candidates.slice(0, first), asideX, 0, h1, gap),
    ...rowCells(candidates.slice(first, used), asideX, h1 + gap, h2, gap),
  ] };
}
function featureBlock(feature, candidates, width, targetHeight, gap, side) {
  let best = null;
  for (const shape of stackChoices(feature, candidates, width, targetHeight, gap)) {
    if (!best || shape.cost < best.cost) best = shape;
  }
  return best && layoutStack(feature, candidates, best, width, gap, side);
}

export function buildFresqueLayout(items, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const width = Math.max(1, Math.floor(config.width)), targetHeight = Math.max(40, Math.round(config.height)), gap = Math.max(0, Number(config.gap) || 0);
  const maxPerRow = Math.max(1, config.maxPerRow);
  const entries = (items || []).map(item => {
    const ratio = safeRatio(item.ratio ?? item.aspectRatio);
    return { id: item.id, item, ratio, featured: item.featured === true };
  });
  const featureEnabled = config.features && width >= config.featureMinWidth;
  const featuredHeight = Math.round(targetHeight * (featureEnabled ? 1.48 : config.features ? 1.25 : 1));
  const packRows = entries => optimalRows(entries, width, targetHeight, gap, maxPerRow, featuredHeight);
  const cells = [], rowHeights = [];
  let y = 0, side = config.side || 0, pending = [], last = null;
  const placeBlock = block => {
    block.cells.forEach(cell => { cell.y += y; cells.push(cell); });
    rowHeights.push(...block.rowHeights);
    last = { y, h: block.height, ragged: false };
    y += block.height + gap;
  };
  const placeRows = rows => rows.forEach(row => {
    if (row.block) { placeBlock(row.block); return; }
    cells.push(...rowCells(row.items, 0, y, row.height, gap));
    if (!row.ragged) rowHeights.push(row.height);
    last = { y, h: row.height, ragged: row.ragged };
    y += row.height + gap;
  });
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (featureEnabled && entry.featured && entry.ratio * (2 * targetHeight + gap) <= width * .9) {
      const following = []; let cursor = index + 1;
      while (cursor < entries.length && !entries[cursor].featured && following.length < 14) following.push(entries[cursor++]);
      if (config.preserveOrder && following.length < 2) { pending.push(entry); continue; }
      const previousRows = packRows(pending);
      const tailRow = previousRows.at(-1);
      const leftover = !config.preserveOrder && tailRow?.ragged && tailRow.items.every(item => !item.featured)
        ? previousRows.pop().items : [];
      const candidates = [...leftover, ...following];
      // Ne pas fermer une rangée incomplète au milieu de la galerie.
      const block = !previousRows.at(-1)?.ragged
        ? featureBlock(entry, candidates, width, targetHeight, gap, config.preserveOrder ? 0 : side)
        : null;
      if (block) {
        placeRows(previousRows);
        placeBlock(block);
        side ^= 1; pending = candidates.slice(block.used); index = cursor - 1; continue;
      }
    }
    pending.push(entry);
  }
  placeRows(packRows(pending));
  let tail = null;
  if (last?.ragged) { const end = Math.max(0, ...cells.filter(cell => cell.y === last.y).map(cell => cell.x + cell.w)); tail = { x: end + gap, y: last.y, w: width - end - gap, h: last.h }; }
  return { cells, height: Math.max(0, y - gap), rowHeights, side, tail, target: targetHeight };
}
