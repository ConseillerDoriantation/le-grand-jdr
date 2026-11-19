const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

const keyOf = (c, r) => `${c},${r}`;
const readCell = value => {
  if (Array.isArray(value)) return { c: Number(value[0]), r: Number(value[1]) };
  if (typeof value === 'string') {
    const split = value.indexOf(',');
    return { c: Number(value.slice(0, split)), r: Number(value.slice(split + 1)) };
  }
  return { c: Number(value?.c), r: Number(value?.r) };
};

function segmentIntersection(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
  const cross = rx * sy - ry * sx;
  if (Math.abs(cross) < 1e-9) return null;
  const qx = cx - ax, qy = cy - ay;
  const t = (qx * sy - qy * sx) / cross;
  const u = (qx * ry - qy * rx) / cross;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: ax + t * rx, y: ay + t * ry, t };
}
/** Premier mur bloquant rencontré sur un segment exprimé en unités de grille. */
export function rangeWallHit(ax, ay, bx, by, walls = []) {
  let nearest = null;
  for (const wall of walls || []) {
    if (wall?.blocksMovement === false) continue;
    const hit = segmentIntersection(
      ax, ay, bx, by,
      Number(wall.x1), Number(wall.y1), Number(wall.x2), Number(wall.y2),
    );
    if (hit && (!nearest || hit.t < nearest.t)) nearest = { ...hit, wall };
  }
  return nearest;
}

/** Escalier discret qui suit au plus près la droite entre deux cases. */
export function rangeStairs(c0, r0, c1, r1) {
  const points = [[c0, r0]];
  const nx = Math.abs(c1 - c0), ny = Math.abs(r1 - r0);
  const sx = Math.sign(c1 - c0), sy = Math.sign(r1 - r0);
  let ix = 0, iy = 0, c = c0, r = r0;
  while (ix < nx || iy < ny) {
    const horizontal = iy >= ny || (ix < nx && (0.5 + ix) / Math.max(1, nx) < (0.5 + iy) / Math.max(1, ny));
    if (horizontal) { c += sx; ix++; } else { r += sy; iy++; }
    points.push([c, r]);
  }
  return points;
}

/** Les deux chemins en L possibles entre deux cases. */
export function rangeLPaths(c0, r0, c1, r1) {
  const build = (firstHorizontal) => {
    const out = [[c0, r0]];
    let c = c0, r = r0;
    const addH = () => { while (c !== c1) { c += Math.sign(c1 - c); out.push([c, r]); } };
    const addV = () => { while (r !== r1) { r += Math.sign(r1 - r); out.push([c, r]); } };
    if (firstHorizontal) { addH(); addV(); } else { addV(); addH(); }
    return out;
  };
  return [build(true), build(false)];
}

function tokenDims(token = {}) {
  return {
    w: Math.max(1, Number(token.w ?? token.tokenW ?? token.displayTokenW) || 1),
    h: Math.max(1, Number(token.h ?? token.tokenH ?? token.displayTokenH) || 1),
  };
}

function footprintStepBlocked(c, r, nc, nr, dims, walls) {
  for (let x = 0; x < dims.w; x++) for (let y = 0; y < dims.h; y++) {
    if (rangeWallHit(c + x + .5, r + y + .5, nc + x + .5, nr + y + .5, walls)) return true;
  }
  return false;
}

function directFootprintBlocked(token, c, r, walls) {
  const dims = tokenDims(token);
  for (let x = 0; x < dims.w; x++) for (let y = 0; y < dims.h; y++) {
    if (rangeWallHit(token.col + x + .5, token.row + y + .5, c + x + .5, r + y + .5, walls)) return true;
  }
  return false;
}

function reconstruct(parent, endKey) {
  const path = [];
  let key = endKey;
  while (key != null) {
    const { c, r } = readCell(key);
    path.unshift([c, r]);
    key = parent.get(key);
  }
  return path;
}

function bfsMove(token, cols, rows, walls) {
  const dims = tokenDims(token);
  const start = keyOf(token.col, token.row);
  const distance = new Map([[start, 0]]);
  const parent = new Map();
  const queue = [[token.col, token.row]];
  for (let i = 0; i < queue.length; i++) {
    const [c, r] = queue[i];
    const cost = distance.get(keyOf(c, r));
    for (const [dc, dr] of DIRS) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc + dims.w > cols || nr + dims.h > rows) continue;
      const key = keyOf(nc, nr);
      if (distance.has(key) || footprintStepBlocked(c, r, nc, nr, dims, walls)) continue;
      distance.set(key, cost + 1);
      parent.set(key, keyOf(c, r));
      queue.push([nc, nr]);
    }
  }
  return { distance, parent };
}

/**
 * Destinations de déplacement d'un token. Les clés représentent le coin haut-gauche
 * de l'empreinte, jamais les cellules internes d'un grand token.
 */
export function rangeMoveCells({ token, cols, rows, remaining, courseExtra = 0, walls = [], mode = 'line' }) {
  const result = new Map();
  const dims = tokenDims(token);
  const normal = Math.max(0, Number(remaining) || 0);
  const far = normal + Math.max(0, Number(courseExtra) || 0);
  const search = mode === 'path' ? bfsMove(token, cols, rows, walls) : null;
  for (let c = 0; c + dims.w <= cols; c++) for (let r = 0; r + dims.h <= rows; r++) {
    if (c === token.col && r === token.row) continue;
    const manhattan = Math.abs(c - token.col) + Math.abs(r - token.row);
    if (mode !== 'path' && manhattan > far) continue;
    const key = keyOf(c, r);
    if (mode === 'path') {
      const cost = search.distance.get(key);
      if (cost != null && cost <= far) {
        result.set(key, { c, r, cost, d: cost, kind: cost <= normal ? 'move' : 'course', path: reconstruct(search.parent, key) });
      } else if (manhattan <= normal) {
        result.set(key, { c, r, cost: cost ?? null, d: cost ?? null, kind: 'blocked', path: cost == null ? null : reconstruct(search.parent, key) });
      }
      continue;
    }
    if (manhattan > far) continue;
    const blocked = walls.length > 0 && directFootprintBlocked(token, c, r, walls);
    if (blocked) {
      if (manhattan <= normal) result.set(key, { c, r, cost: manhattan, d: manhattan, kind: 'blocked', path: rangeStairs(token.col, token.row, c, r) });
      continue;
    }
    result.set(key, { c, r, cost: manhattan, d: manhattan, kind: manhattan <= normal ? 'move' : 'course', path: rangeStairs(token.col, token.row, c, r) });
  }
  return result;
}

/** Ensemble des cases à portée, bord à bord depuis toute l'empreinte source. */
export function rangeAttackCells({ from, dims = {}, range, cols, rows }) {
  const out = new Set();
  const width = Math.max(1, Number(dims.w) || 1), height = Math.max(1, Number(dims.h) || 1);
  const reach = Math.max(0, Number(range) || 0);
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    if (c >= from.col && c < from.col + width && r >= from.row && r < from.row + height) continue;
    const dx = Math.max(0, Math.max(c, from.col) - Math.min(c, from.col + width - 1));
    const dy = Math.max(0, Math.max(r, from.row) - Math.min(r, from.row + height - 1));
    if ((reach === 1 ? Math.max(dx, dy) : dx + dy) <= reach) out.add(keyOf(c, r));
  }
  return out;
}

function distanceToTarget(c, r, dims, target, range) {
  const td = tokenDims(target);
  const dx = Math.max(0, Math.max(c, target.col) - Math.min(c + dims.w - 1, target.col + td.w - 1));
  const dy = Math.max(0, Math.max(r, target.row) - Math.min(r + dims.h - 1, target.row + td.h - 1));
  return range === 1 ? Math.max(dx, dy) : dx + dy;
}

/** Cases depuis lesquelles la cible peut être frappée, plus la moins coûteuse. */
export function rangeApproach({ token, target, cells, range, occupied = new Set() }) {
  const dims = tokenDims(token);
  if (distanceToTarget(token.col, token.row, dims, target, range) <= range) return { now: true, cells: new Map(), best: null };
  const candidates = new Map();
  let best = null;
  for (const [key, cell] of cells || []) {
    let collides = false;
    for (let x=0;x<dims.w&&!collides;x++) for (let y=0;y<dims.h;y++) {
      if (occupied.has(keyOf(cell.c+x,cell.r+y))) { collides=true; break; }
    }
    if (cell.kind === 'blocked' || collides) continue;
    if (distanceToTarget(cell.c, cell.r, dims, target, range) > range) continue;
    candidates.set(key, cell);
    if (!best || Number(cell.cost ?? Infinity) < Number(best.cost ?? Infinity)) best = cell;
  }
  return best ? { now: false, cells: candidates, best } : null;
}

/**
 * Transforme un ensemble de cellules en boucles de bord. Les points sont en unités
 * de grille et la dernière coordonnée n'est pas répétée.
 */
export function rangeContour(cellKeys) {
  const cells = new Set([...cellKeys || []].map(value => {
    const { c, r } = readCell(value);
    return keyOf(c, r);
  }));
  const outgoing = new Map();
  const add = (x1, y1, x2, y2) => {
    const key = keyOf(x1, y1);
    if (!outgoing.has(key)) outgoing.set(key, []);
    outgoing.get(key).push([x2, y2]);
  };
  for (const value of cells) {
    const { c, r } = readCell(value);
    if (!cells.has(keyOf(c, r - 1))) add(c, r, c + 1, r);
    if (!cells.has(keyOf(c + 1, r))) add(c + 1, r, c + 1, r + 1);
    if (!cells.has(keyOf(c, r + 1))) add(c + 1, r + 1, c, r + 1);
    if (!cells.has(keyOf(c - 1, r))) add(c, r + 1, c, r);
  }
  const used = new Set(), loops = [];
  const edgeKey = (a, b) => `${a[0]},${a[1]}>${b[0]},${b[1]}`;
  for (const [startKey, ends] of outgoing) for (const end of ends) {
    const start = readCell(startKey), first = [start.c, start.r];
    if (used.has(edgeKey(first, end))) continue;
    const raw = [first];
    let from = first, to = end;
    while (true) {
      used.add(edgeKey(from, to));
      if (to[0] === first[0] && to[1] === first[1]) break;
      raw.push(to);
      const choices = outgoing.get(keyOf(to[0], to[1])) || [];
      const next = choices.find(candidate => !used.has(edgeKey(to, candidate)));
      if (!next) break;
      from = to; to = next;
    }
    if (raw.length < 3) continue;
    const merged = raw.filter((point, index) => {
      const prev = raw[(index - 1 + raw.length) % raw.length];
      const next = raw[(index + 1) % raw.length];
      return !((prev[0] === point[0] && point[0] === next[0]) || (prev[1] === point[1] && point[1] === next[1]));
    });
    loops.push(merged);
  }
  return loops;
}
