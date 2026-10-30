const _normalizedLabel = value => String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function catalogAutoPlural(label = '') {
  const value = String(label || '').trim();
  return value ? `${value}${/[sx]$/i.test(value) ? '' : 's'}` : '';
}

export function catalogItemErrors(items = [], item = null) {
  if (!item || !String(item.label || '').trim()) return ['name'];
  const label = _normalizedLabel(item.label);
  return items.some(other => other !== item && _normalizedLabel(other.label) === label) ? ['duplicate'] : [];
}

export function catalogCloseColors(items = [], threshold = 36) {
  const rgb = color => {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(color || ''));
    if (!match) return null;
    const value = Number.parseInt(match[1], 16);
    return [value >> 16, (value >> 8) & 255, value & 255];
  };
  const pairs = [];
  for (let index = 0; index < items.length; index++) {
    const left = rgb(items[index]?.color);
    if (!left) continue;
    for (let other = index + 1; other < items.length; other++) {
      const right = rgb(items[other]?.color);
      if (right && Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]) < threshold) {
        pairs.push([items[index], items[other]]);
      }
    }
  }
  return pairs;
}

export function catalogReplacementFor(id, changes = []) {
  const replacements = new Map(changes.map(change => [change.from, change.to]));
  let current = id;
  const seen = new Set();
  while (replacements.has(current) && !seen.has(current)) {
    seen.add(current);
    current = replacements.get(current);
  }
  return current === id ? '' : current;
}
