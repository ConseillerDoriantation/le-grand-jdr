// Helpers purs pour les listes ordonnées manuellement.

function _storedOrder(item) {
  if (item?.ordre === null || item?.ordre === undefined || item?.ordre === '') return null;
  const value = Number(item.ordre);
  return Number.isFinite(value) ? value : null;
}

export function manualOrderValue(item) {
  return _storedOrder(item);
}

export function compareManualOrder(a, b) {
  const orderA = _storedOrder(a);
  const orderB = _storedOrder(b);
  if (orderA !== null && orderB !== null && orderA !== orderB) return orderA - orderB;
  if (orderA !== null && orderB === null) return -1;
  if (orderA === null && orderB !== null) return 1;

  const byName = String(a?.nom || '').localeCompare(String(b?.nom || ''), 'fr', { sensitivity: 'base' });
  return byName || String(a?.id || '').localeCompare(String(b?.id || ''));
}

// Réordonne uniquement les entrées visibles, dans les emplacements qu'elles
// occupaient déjà. Les éléments exclus par un filtre restent donc en place.
export function mergeVisibleManualOrder(items, visibleIds) {
  const result = Array.isArray(items) ? [...items] : [];
  const byId = new Map(result.map(item => [item?.id, item]));
  const seen = new Set();
  const orderedIds = [];

  for (const id of visibleIds || []) {
    if (!id || seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    orderedIds.push(id);
  }

  const slots = result
    .map((item, index) => seen.has(item?.id) ? index : -1)
    .filter(index => index >= 0);
  if (slots.length !== orderedIds.length) return result;

  slots.forEach((slot, index) => { result[slot] = byId.get(orderedIds[index]); });
  return result;
}

export function nextManualOrder(items) {
  let highest = -1;
  for (const item of items || []) {
    const order = _storedOrder(item);
    if (order !== null) highest = Math.max(highest, order);
  }
  return highest + 1;
}
