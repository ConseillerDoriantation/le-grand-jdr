export const VTT_POINT_ANNOTATION_TYPES = new Set(['freehand', 'line', 'polygon']);

const finite = value => Number.isFinite(Number(value));

/**
 * Les premières annotations utilisaient offsetX/offsetY. Le Transformer Konva
 * a ensuite persisté x/y. Relire les deux formats évite que les anciens dessins
 * reviennent à leur origine après un rechargement.
 */
export function annotationNodePosition(annotation = {}) {
  const pointBased = VTT_POINT_ANNOTATION_TYPES.has(annotation.type);
  if (!pointBased) {
    return {
      x: finite(annotation.x) ? Number(annotation.x) : 0,
      y: finite(annotation.y) ? Number(annotation.y) : 0,
    };
  }
  return {
    x: finite(annotation.x) ? Number(annotation.x) : (finite(annotation.offsetX) ? Number(annotation.offsetX) : 0),
    y: finite(annotation.y) ? Number(annotation.y) : (finite(annotation.offsetY) ? Number(annotation.offsetY) : 0),
  };
}

/** Maintient les deux alias pendant les déplacements pour les documents legacy. */
export function annotationPositionPatch(annotation = {}, x = 0, y = 0) {
  const position = { x:Number(x) || 0, y:Number(y) || 0 };
  return VTT_POINT_ANNOTATION_TYPES.has(annotation.type)
    ? { ...position, offsetX:position.x, offsetY:position.y }
    : position;
}
