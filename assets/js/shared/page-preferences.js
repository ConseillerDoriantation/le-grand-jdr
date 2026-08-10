import { STATE } from '../core/state.js';
import { lsJson } from './local-storage.js';
import {
  captureViewContext,
  restoreViewContextAfterRender,
} from './view-context.js';

const CONTROL_SELECTOR = [
  '[data-persist-view]',
  'input[type="search"]',
  'input[placeholder*="Rechercher" i]',
  'input[placeholder*="Filtrer" i]',
  'select[id*="filter" i]',
  'select[id*="filtre" i]',
  'select[id*="sort" i]',
  'select[id*="tri" i]',
  'select[name*="filter" i]',
  'select[name*="filtre" i]',
  'select[name*="sort" i]',
  'select[name*="tri" i]',
].join(',');

const MODE_SELECTOR = [
  '[role="tab"][aria-selected="true"]',
  '[data-view].active',
  '[data-view].is-active',
  '[data-view].is-on',
  '[data-mode].active',
  '[data-mode].is-active',
  '[data-mode].is-on',
].join(',');

function _storageKey(page) {
  const uid = STATE.user?.uid || 'anonymous';
  const adventureId = STATE.adventure?.id || 'global';
  return `jdr-page-prefs:v1:${uid}:${adventureId}:${page}`;
}

function _controlKey(el, controls) {
  const explicit = el.dataset.persistView || el.dataset.viewStateKey || el.id || el.name;
  return explicit || `control-index:${controls.indexOf(el)}`;
}

function _modeKey(el, modes) {
  const action = el.dataset.action || el.dataset.shAction || el.dataset.bsAction || '';
  const value = el.dataset.view || el.dataset.mode || el.dataset.tab || '';
  const group = el.closest('[role="tablist"], [data-view-group], nav')?.id || '';
  return { action, value, group, index: modes.indexOf(el) };
}

function _isModeActive(el) {
  return el.getAttribute('aria-selected') === 'true'
    || el.classList.contains('active')
    || el.classList.contains('is-active')
    || el.classList.contains('is-on');
}

function _findMode(root, saved) {
  const candidates = [...root.querySelectorAll('[role="tab"], [data-view], [data-mode], [data-tab]')];
  return candidates.find((el) => {
    const action = el.dataset.action || el.dataset.shAction || el.dataset.bsAction || '';
    const value = el.dataset.view || el.dataset.mode || el.dataset.tab || '';
    const group = el.closest('[role="tablist"], [data-view-group], nav')?.id || '';
    return action === saved.action && value === saved.value && group === saved.group;
  }) || candidates[saved.index] || null;
}

export function persistPagePreferences(root, page = STATE.currentPage) {
  if (!root || !page) return;
  const controls = [...root.querySelectorAll(CONTROL_SELECTOR)];
  const modes = [...root.querySelectorAll(MODE_SELECTOR)];
  const state = {
    controls: controls.map((el) => ({
      key: _controlKey(el, controls),
      value: el.value,
      checked: 'checked' in el ? Boolean(el.checked) : null,
    })),
    modes: modes.map(el => _modeKey(el, modes)),
    view: captureViewContext(root, { includeWindow: true }),
    savedAt: Date.now(),
  };
  lsJson.set(_storageKey(page), state);
}

export function restorePagePreferences(root, page = STATE.currentPage) {
  if (!root || !page) return;
  const state = lsJson.get(_storageKey(page), null);
  if (!state || Date.now() - Number(state.savedAt || 0) > 90 * 24 * 60 * 60 * 1000) return;

  const controls = [...root.querySelectorAll(CONTROL_SELECTOR)];
  for (const saved of state.controls || []) {
    const el = controls.find(control => _controlKey(control, controls) === saved.key);
    if (!el || el.dataset.noPersistView !== undefined) continue;
    const nextChecked = saved.checked == null ? null : Boolean(saved.checked);
    const changed = String(el.value ?? '') !== String(saved.value ?? '')
      || (nextChecked != null && el.checked !== nextChecked);
    if (!changed) continue;
    el.value = saved.value ?? '';
    if (nextChecked != null) el.checked = nextChecked;
    const eventType = el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'radio'
      ? 'change'
      : 'input';
    el.dispatchEvent(new Event(eventType, { bubbles: true }));
  }

  requestAnimationFrame(() => {
    for (const saved of state.modes || []) {
      const el = _findMode(root, saved);
      if (el && !_isModeActive(el) && !el.disabled) el.click();
    }
    restoreViewContextAfterRender(root, state.view, { includeWindow: true });
  });
}

export function initPagePreferences() {
  window.addEventListener('pagehide', () => {
    persistPagePreferences(document.getElementById('main-content'), STATE.currentPage);
  });
}
