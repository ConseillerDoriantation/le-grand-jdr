// Transformations pures du document de statistiques liées aux séances.
// Isolé de Firebase pour pouvoir vérifier précisément les suppressions.

export function statsSessionEntryForChar(char, sessionKey) {
  if (!char || !sessionKey) return { field: '', value: null };
  if (char.bySession?.[sessionKey]) return { field: 'bySession', value: char.bySession[sessionKey] };
  if (char.byDate?.[sessionKey]) return { field: 'byDate', value: char.byDate[sessionKey] };
  return { field: '', value: null };
}

export function sumStatsSessionsRaw(char, sessionKeys) {
  const acc = {};
  for (const key of sessionKeys || []) {
    const bucket = statsSessionEntryForChar(char, key).value;
    if (!bucket) continue;
    for (const [group, values] of Object.entries(bucket)) {
      if (!values || typeof values !== 'object') continue;
      const groupAcc = (acc[group] ??= {});
      for (const [field, value] of Object.entries(values)) {
        // Les records sont des maxima, pas des compteurs additionnables.
        if (group === 'combat' && (field === 'biggestHit' || field === 'biggestTaken')) continue;
        if (typeof value === 'number') groupAcc[field] = (groupAcc[field] || 0) + value;
        else if (value && typeof value === 'object') {
          const nested = (groupAcc[field] ??= {});
          for (const [nestedField, nestedValue] of Object.entries(value)) {
            if (typeof nestedValue === 'number') nested[nestedField] = (nested[nestedField] || 0) + nestedValue;
          }
        }
      }
    }
  }
  return acc;
}

function _subtractStatsTree(target, delta) {
  if (!target || !delta) return;
  for (const [key, value] of Object.entries(delta)) {
    if (typeof value === 'number') {
      target[key] = Math.max(0, (Number(target[key]) || 0) - value);
    } else if (value && typeof value === 'object') {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      _subtractStatsTree(target[key], value);
    }
  }
}

function _remainingCombatRecord(char, field) {
  let max = 0;
  for (const container of [char?.byDate, char?.bySession]) {
    for (const entry of Object.values(container || {})) {
      max = Math.max(max, Number(entry?.combat?.[field]) || 0);
    }
  }
  return max;
}

export function removeStatsSessionsFromData(data, sessionKeys, deletedAt = Date.now()) {
  if (!data || !Array.isArray(sessionKeys) || !sessionKeys.length) return false;
  const keys = [...new Set(sessionKeys.filter(Boolean))];
  let changed = false;

  for (const char of Object.values(data.chars || {})) {
    const relevant = keys.filter(key => statsSessionEntryForChar(char, key).value);
    if (!relevant.length) continue;
    changed = true;
    _subtractStatsTree(char, sumStatsSessionsRaw(char, relevant));
    for (const key of relevant) {
      const field = statsSessionEntryForChar(char, key).field;
      if (field && char[field]) {
        delete char[field][key];
        if (!Object.keys(char[field]).length) delete char[field];
      }
      // Empêche les anciens messages du chat VTT de recréer la séance supprimée.
      (char.vttLogCutoffs ??= {})[key] = deletedAt;
    }
    if (char.combat) {
      char.combat.biggestHit = _remainingCombatRecord(char, 'biggestHit');
      char.combat.biggestTaken = _remainingCombatRecord(char, 'biggestTaken');
    }
  }

  for (const key of keys) {
    if (data.sessions && Object.hasOwn(data.sessions, key)) {
      delete data.sessions[key];
      changed = true;
    }
  }
  return changed;
}
