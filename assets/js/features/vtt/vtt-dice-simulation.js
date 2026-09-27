// Helpers purs du mode MJ « dé simulé ».
// Gardés hors du DOM pour rendre la validation des valeurs testable et pour que
// le jet normal et le jet simulé suivent exactement le même calcul.

export const MAX_SIMULATED_DICE = 24;

const _entries = formula => Object.keys(formula || {})
  .map(Number)
  .filter(faces => Number.isInteger(faces) && faces >= 2)
  .sort((a, b) => b - a)
  .map(faces => ({ faces, count: Math.max(0, Math.trunc(Number(formula[faces]) || 0)) }))
  .filter(({ count }) => count > 0);

export function simulatedDiceSlots(formula = {}, mode = 'normal') {
  const slots = [];
  for (const { faces, count } of _entries(formula)) {
    const actualCount = faces === 20 && count === 1 && mode !== 'normal' ? 2 : count;
    for (let index = 0; index < actualCount; index++) {
      const suffix = actualCount > 1 ? ` ${index + 1}` : '';
      slots.push({ faces, index, label: `d${faces === 100 ? '%' : faces}${suffix}` });
    }
  }
  return slots;
}

export function normalizeSimulatedNatural(value, faces) {
  if (value === '' || value == null) return null;
  const natural = Number(value);
  return Number.isInteger(natural) && natural >= 1 && natural <= faces ? natural : null;
}

export function validateSimulatedValues(slots, values) {
  if (!Array.isArray(slots) || !slots.length || !Array.isArray(values) || values.length !== slots.length) return null;
  const normalized = slots.map((slot, index) => normalizeSimulatedNatural(values[index], slot.faces));
  return normalized.every(value => value != null) ? normalized : null;
}

export function rollDiceGroups(formula = {}, mode = 'normal', options = {}) {
  const slots = simulatedDiceSlots(formula, mode);
  const simulated = options.simulatedValues != null;
  const forced = simulated ? validateSimulatedValues(slots, options.simulatedValues) : null;
  if (simulated && !forced) throw new RangeError('Chaque dé simulé doit avoir une valeur naturelle valide.');

  const random = typeof options.random === 'function' ? options.random : Math.random;
  let cursor = 0;
  const next = faces => simulated ? forced[cursor++] : Math.floor(random() * faces) + 1;
  const groups = [];
  let total = 0;

  for (const { faces, count } of _entries(formula)) {
    const rolls = [];
    let subtotal = 0;
    let kept;
    if (faces === 20 && count === 1 && mode !== 'normal') {
      const first = next(20);
      const second = next(20);
      rolls.push(first, second);
      kept = mode === 'advantage' ? Math.max(first, second) : Math.min(first, second);
      subtotal = kept;
    } else {
      for (let index = 0; index < count; index++) {
        const roll = next(faces);
        rolls.push(roll);
        subtotal += roll;
      }
    }
    const group = { faces, count, rolls, subtotal };
    if (kept !== undefined) group.kept = kept;
    groups.push(group);
    total += subtotal;
  }

  return { groups, total };
}
