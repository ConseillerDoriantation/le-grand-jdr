const RECURRING_PRESETS = {
  evenings: { days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], slots: ['s'] },
  weekends: { days: ['sat', 'sun'], slots: ['m', 'a', 's'] },
  'fri-eve': { days: ['fri'], slots: ['s'] },
};

function cloneRecurring(recurring = {}) {
  return Object.fromEntries(
    Object.entries(recurring || {}).map(([day, slots]) => [day, { ...(slots || {}) }]),
  );
}

/** Ajoute un raccourci à la semaine existante sans effacer les autres créneaux. */
export function mergeRecurringPreset(recurring = {}, preset = '') {
  const next = cloneRecurring(recurring);
  const config = RECURRING_PRESETS[preset];
  if (!config) return next;
  config.days.forEach(day => {
    next[day] = next[day] || {};
    config.slots.forEach(slot => { next[day][slot] = 'ok'; });
  });
  return next;
}

export function suggestionPresentation({ okCount = 0, total = 0, missingCount = 0 } = {}, isValidated = false) {
  if (isValidated) return { key: 'val', label: '✓ Validé' };
  if (total > 0 && okCount === total) return { key: 'full', label: '✓ Tout le monde' };
  if (total > 0 && okCount > total / 2) return { key: 'partial', label: 'Majorité' };
  if (missingCount > 0) {
    return { key: 'partial', label: `En attente de ${missingCount}` };
  }
  return { key: 'partial', label: 'Partiel' };
}

export function weekDatesFrom(date = new Date(), offset = 0) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + Number(offset || 0) * 7);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}
