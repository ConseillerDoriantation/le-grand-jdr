// Calculs purs utilisés par le brouillard du VTT. Ils restent séparés du rendu
// Konva/Firebase afin de pouvoir verrouiller les garde-fous de performance par
// des tests Node.

const DEFAULT_MAX_RASTER_CELL = 24;
const DEFAULT_MAX_DIMENSION = 3072;
const DEFAULT_MAX_PIXELS = 4_000_000;

export function vttCanvasPixelRatio(devicePixelRatio = 1, deviceMemory = null, hardwareConcurrency = null) {
  const dpr = Math.max(1, Number(devicePixelRatio) || 1);
  const memory = Number(deviceMemory);
  const cores = Number(hardwareConcurrency);
  const constrained = (Number.isFinite(memory) && memory > 0 && memory <= 4)
    || (Number.isFinite(cores) && cores > 0 && cores <= 4);
  return Math.min(dpr, constrained ? 1 : 1.5);
}

export function vttShouldReduceEffects(deviceMemory = null, hardwareConcurrency = null) {
  const memory = Number(deviceMemory);
  const cores = Number(hardwareConcurrency);
  return (Number.isFinite(memory) && memory > 0 && memory <= 2)
    || (Number.isFinite(cores) && cores > 0 && cores <= 2);
}

/**
 * Taille, en pixels de canvas, utilisée pour rasteriser une case de la carte.
 * Le canvas est ensuite étiré aux dimensions monde par Konva. La LOS conserve
 * donc les mêmes coordonnées tout en évitant les buffers géants des grandes
 * scènes (un canvas 10 000 x 10 000 dépassait à lui seul 380 Mio).
 */
export function fogRasterCellSize(cols, rows, worldCell, options = {}) {
  const safeCols = Math.max(1, Number(cols) || 1);
  const safeRows = Math.max(1, Number(rows) || 1);
  const safeWorldCell = Math.max(1, Number(worldCell) || 1);
  const maxCell = Math.max(1, Number(options.maxCell) || DEFAULT_MAX_RASTER_CELL);
  const maxDimension = Math.max(64, Number(options.maxDimension) || DEFAULT_MAX_DIMENSION);
  const maxPixels = Math.max(4096, Number(options.maxPixels) || DEFAULT_MAX_PIXELS);

  return Math.max(1, Math.min(
    safeWorldCell,
    maxCell,
    maxDimension / safeCols,
    maxDimension / safeRows,
    Math.sqrt(maxPixels / (safeCols * safeRows)),
  ));
}

function _tokenData(entry) {
  return entry?.data || entry || null;
}

/**
 * Signature limitée aux données qui modifient réellement la géométrie de la
 * vision. Les PV, PM, états et animations d'attaque n'en font volontairement
 * pas partie : leur mise à jour ne doit plus recalculer toute la LOS.
 */
export function fogGeometrySignature(page, tokens, isAdmin = false) {
  if (!page) return '';
  const players = Object.values(tokens || {})
    .map(_tokenData)
    .filter(token => token?.type === 'player' && token.pageId === page.id)
    .map(token => [
      String(token.id || token.characterId || token.ownerId || ''),
      Number(token.col) || 0,
      Number(token.row) || 0,
      Number(token.tokenW ?? token.tokenSize) || 1,
      Number(token.tokenH ?? token.tokenSize) || 1,
    ])
    .sort((a, b) => a[0].localeCompare(b[0]));

  const walls = (page.walls || []).map(wall => [
    String(wall.id || ''), wall.type || 'wall',
    Number(wall.x1) || 0, Number(wall.y1) || 0,
    Number(wall.x2) || 0, Number(wall.y2) || 0,
    wall.open === true, wall.locked === true,
  ]);
  const lights = (page.lightSources || []).map(light => [
    String(light.id || ''), Number(light.x) || 0, Number(light.y) || 0,
    Number(light.radius) || 0,
  ]);
  // L'ordre des opérations manuelles est significatif (la dernière gagne).
  const fogOps = (page.fogOps || []).map(op => [
    String(op.id || ''), op.type || 'hide',
    Number(op.x) || 0, Number(op.y) || 0,
    Number(op.w) || 0, Number(op.h) || 0,
  ]);

  return JSON.stringify([
    String(page.id || ''), Number(page.cols) || 24, Number(page.rows) || 18,
    page.fogEnabled === true, isAdmin === true, walls, lights, fogOps, players,
  ]);
}
