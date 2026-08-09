import { STATE } from '../core/state.js';

const STORAGE_PREFIX = 'jdr_recent_navigation';
const MAX_RECENT = 12;

function _storageKey() {
  const adventureId = STATE.adventure?.id || 'global';
  const userId = STATE.user?.uid || 'anonymous';
  return `${STORAGE_PREFIX}:${userId}:${adventureId}`;
}

export function getRecentNavigation() {
  try {
    const value = JSON.parse(localStorage.getItem(_storageKey()) || '[]');
    return Array.isArray(value) ? value.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function recordRecentNavigation(entry) {
  if (!entry?.type || !entry?.id) return;
  const key = `${entry.type}:${entry.id}`;
  const current = getRecentNavigation().filter(item => `${item.type}:${item.id}` !== key);
  const next = [{
    type: String(entry.type),
    id: String(entry.id),
    title: String(entry.title || ''),
    visitedAt: Date.now(),
  }, ...current].slice(0, MAX_RECENT);

  try {
    localStorage.setItem(_storageKey(), JSON.stringify(next));
  } catch {}
}
