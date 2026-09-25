// Calculs purs utilisés par le brouillard du VTT. Ils restent séparés du rendu
// Konva/Firebase afin de pouvoir verrouiller les garde-fous de performance par
// des tests Node.

const DEFAULT_MAX_RASTER_CELL = 24;
const DEFAULT_MAX_DIMENSION = 3072;
const DEFAULT_MAX_PIXELS = 4_000_000;
export const VTT_DEFAULT_VISION_CELLS = 3;

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

/** Détection volontairement conservatrice d'un téléphone : une tablette
 * tactile garde le rendu normal, même tenue en portrait. */
export function vttIsPhoneViewport(width, height, hasCoarsePointer = false, maxTouchPoints = 0) {
  const shortSide = Math.min(Number(width) || 0, Number(height) || 0);
  const touchCapable = hasCoarsePointer || Number(maxTouchPoints) > 0;
  return touchCapable && shortSide > 0 && shortSide <= 600;
}

export function vttDefaultLowFx({ isAdmin = false, isPhone = false, deviceMemory = null, hardwareConcurrency = null } = {}) {
  return isPhone || !isAdmin || vttShouldReduceEffects(deviceMemory, hardwareConcurrency);
}

/** Transformation caméra d'un pincement à deux doigts. Le point du monde situé
 * sous le centre initial reste sous les doigts, même si leur centre se déplace. */
export function vttPinchCameraTransform({
  startScale, startPosition, startCenter, currentCenter,
  startDistance, currentDistance, minScale = 0.15, maxScale = 4,
}) {
  const baseScale = Math.max(Number(startScale) || 1, 0.0001);
  const distanceRatio = (Number(currentDistance) || 0) / Math.max(Number(startDistance) || 1, 1);
  const scale = Math.min(maxScale, Math.max(minScale, baseScale * distanceRatio));
  const worldX = (startCenter.x - startPosition.x) / baseScale;
  const worldY = (startCenter.y - startPosition.y) / baseScale;
  return {
    scale,
    x: currentCenter.x - worldX * scale,
    y: currentCenter.y - worldY * scale,
  };
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

/** Rayon de vision d'un personnage, en cases. Une valeur portée par le token
 * reste prioritaire pour permettre les sens particuliers ; la scène fournit
 * ensuite un réglage commun, avec 3 cases comme valeur sûre pour le legacy. */
export function fogVisionRadiusCells(page = {}, token = {}) {
  const raw = token.visionRadius ?? token.visionCells
    ?? page.visionRadius ?? page.visionCells
    ?? VTT_DEFAULT_VISION_CELLS;
  const value = Number(raw);
  return Math.max(1, Math.min(40, Number.isFinite(value) ? value : VTT_DEFAULT_VISION_CELLS));
}

/** Largeur du fondu périphérique. Elle reste proportionnée sur les petits
 * rayons sans devenir coûteuse ou trop floue sur les grandes lumières. */
export function fogVisionFeatherCells(radiusCells) {
  const radius = Math.max(1, Number(radiusCells) || VTT_DEFAULT_VISION_CELLS);
  return Math.min(1.35, Math.max(0.5, radius * 0.45));
}

/** Personnages qui contribuent à la vision partagée de la scène. */
export function fogSharedVisionTokens(page, tokens) {
  if (!page) return [];
  const cols = Math.max(1, Number(page.cols) || 24);
  const rows = Math.max(1, Number(page.rows) || 18);
  return Object.values(tokens || {})
    .map(_tokenData)
    .filter(token => {
      if (!token || token.pageId !== page.id || token.visible === false) return false;
      // Les anciens tokens de personnage n'avaient pas toujours `type`.
      const isCharacter = token.type === 'player' || (!token.type && !!token.characterId);
      if (!isCharacter) return false;
      const col = Number(token.col);
      const row = Number(token.row);
      const width = Math.max(1, Number(token.tokenW ?? token.tokenSize) || 1);
      const height = Math.max(1, Number(token.tokenH ?? token.tokenSize) || 1);
      return Number.isFinite(col) && Number.isFinite(row)
        && col < cols && row < rows && col + width > 0 && row + height > 0;
    });
}

/**
 * Signature limitée aux données qui modifient réellement la géométrie de la
 * vision. Les PV, PM, états et animations d'attaque n'en font volontairement
 * pas partie : leur mise à jour ne doit plus recalculer toute la LOS.
 */
export function fogGeometrySignature(page, tokens, isAdmin = false) {
  if (!page) return '';
  const players = fogSharedVisionTokens(page, tokens)
    .map(token => [
      String(token.id || token.characterId || token.ownerId || ''),
      Number(token.col) || 0,
      Number(token.row) || 0,
      Number(token.tokenW ?? token.tokenSize) || 1,
      Number(token.tokenH ?? token.tokenSize) || 1,
      fogVisionRadiusCells(page, token),
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
    page.fogEnabled === true, fogVisionRadiusCells(page), isAdmin === true,
    walls, lights, fogOps, players,
  ]);
}
