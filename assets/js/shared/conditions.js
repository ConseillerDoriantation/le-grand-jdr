import { getDocData } from '../data/firestore.js';

let _conditionLibraryCache = null;

function normalizeCondition(entry = {}) {
  return {
    id: entry.id,
    label: entry.label || entry.id,
    icon: entry.icon || '✨',
    color: entry.color || '',
    defaultSaveStat: entry.defaultSaveStat || null,
    defaultDC: entry.defaultDC || null,
    defaultDuration: entry.defaultDuration || null,
  };
}

export async function loadConditionLibrary({ refresh = false } = {}) {
  if (_conditionLibraryCache && !refresh) return _conditionLibraryCache;
  try {
    const doc = await getDocData('world', 'conditions');
    _conditionLibraryCache = Array.isArray(doc?.library)
      ? doc.library.filter((entry) => entry?.id).map(normalizeCondition)
      : [];
  } catch {
    _conditionLibraryCache = [];
  }
  return _conditionLibraryCache;
}

export function clearConditionLibraryCache() {
  _conditionLibraryCache = null;
}
