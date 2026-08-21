// Preserve visual context around DOM replacement: nested scroll positions and
// native disclosure state. Explicit keys win; ids cover existing components.

function _elementKey(el, prefix) {
  const explicit = el.dataset?.viewStateKey || el.dataset?.scrollKey || el.id;
  return explicit ? `${prefix}:${explicit}` : '';
}

const FOCUSABLE_SELECTOR = [
  'input:not([type="hidden"])',
  'textarea',
  'select',
  '[contenteditable="true"]',
].join(',');

const FIELD_STATE_SELECTOR = 'input, textarea, select, [contenteditable="true"]';

function _fieldStateKey(el, index) {
  const explicit = el.dataset?.viewStateKey || el.id;
  if (explicit) return `field:${explicit}`;
  const name = el.getAttribute?.('name');
  return name ? `field-name:${name}:${index}` : `field-index:${index}`;
}

function _captureFieldStates(root) {
  return [...root.querySelectorAll(FIELD_STATE_SELECTOR)].flatMap((el, index) => {
    const type = String(el.type || '').toLowerCase();
    if (type === 'file') return [];
    const state = {
      key: _fieldStateKey(el, index),
      kind: el.isContentEditable ? 'html'
        : (String(el.tagName || '').toUpperCase() === 'SELECT' && el.multiple) ? 'multiple'
          : ['checkbox', 'radio'].includes(type) ? 'checked' : 'value',
    };
    if (state.kind === 'html') state.value = el.innerHTML || '';
    else if (state.kind === 'multiple') state.value = [...(el.options || [])].filter(opt => opt.selected).map(opt => opt.value);
    else if (state.kind === 'checked') {
      state.value = Boolean(el.checked);
      state.indeterminate = Boolean(el.indeterminate);
    } else state.value = el.value ?? '';
    return [state];
  });
}

function _restoreFieldStates(root, states = []) {
  if (!states?.length) return;
  const fields = [...root.querySelectorAll(FIELD_STATE_SELECTOR)];
  const byKey = new Map(fields.map((el, index) => [_fieldStateKey(el, index), el]));
  states.forEach(state => {
    const el = byKey.get(state.key);
    if (!el || String(el.type || '').toLowerCase() === 'file') return;
    if (state.kind === 'html' && el.isContentEditable) el.innerHTML = state.value || '';
    else if (state.kind === 'multiple') {
      const selected = new Set(Array.isArray(state.value) ? state.value : []);
      [...(el.options || [])].forEach(opt => { opt.selected = selected.has(opt.value); });
    } else if (state.kind === 'checked') {
      el.checked = Boolean(state.value);
      if ('indeterminate' in el) el.indeterminate = Boolean(state.indeterminate);
    } else if ('value' in el) el.value = state.value ?? '';
  });
}

function _focusKey(el, root) {
  const explicit = el.dataset?.viewStateKey || el.id || el.getAttribute?.('name');
  if (explicit) return `focus:${explicit}`;
  const focusables = [...root.querySelectorAll(FOCUSABLE_SELECTOR)];
  const index = focusables.indexOf(el);
  return index >= 0 ? `focus-index:${index}` : '';
}

export function captureViewContext(root, { includeWindow = false, includeFocus = false, includeFields = false } = {}) {
  if (!root) return null;
  const context = {
    window: includeWindow ? { x: window.scrollX, y: window.scrollY } : null,
    scrolls: [],
    details: [],
    focus: null,
    fields: includeFields ? _captureFieldStates(root) : [],
  };

  root.querySelectorAll('[data-view-state-key], [data-scroll-key], [id]').forEach((el) => {
    if (el.scrollTop <= 0 && el.scrollLeft <= 0) return;
    if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) return;
    const key = _elementKey(el, 'scroll');
    if (key) context.scrolls.push({ key, top: el.scrollTop, left: el.scrollLeft });
  });

  root.querySelectorAll('details').forEach((el, index) => {
    const key = _elementKey(el, 'details') || `details-index:${index}`;
    context.details.push({ key, open: el.open });
  });

  const active = includeFocus && root.contains?.(document.activeElement)
    ? document.activeElement
    : null;
  if (active?.matches?.(FOCUSABLE_SELECTOR)) {
    context.focus = {
      key: _focusKey(active, root),
      start: Number.isInteger(active.selectionStart) ? active.selectionStart : null,
      end: Number.isInteger(active.selectionEnd) ? active.selectionEnd : null,
      direction: active.selectionDirection || 'none',
    };
  }
  return context;
}

export function restoreViewContext(root, context, { includeWindow = false, includeFocus = false, includeFields = false } = {}) {
  if (!root || !context) return;
  const keyed = new Map();
  root.querySelectorAll('[data-view-state-key], [data-scroll-key], [id]').forEach((el) => {
    const scrollKey = _elementKey(el, 'scroll');
    const detailsKey = _elementKey(el, 'details');
    if (scrollKey) keyed.set(scrollKey, el);
    if (detailsKey) keyed.set(detailsKey, el);
  });

  context.scrolls?.forEach(({ key, top, left }) => {
    const el = keyed.get(key);
    if (el) el.scrollTo({ top, left, behavior: 'auto' });
  });

  const details = [...root.querySelectorAll('details')];
  context.details?.forEach(({ key, open }) => {
    const indexMatch = key.match(/^details-index:(\d+)$/);
    const el = indexMatch ? details[Number(indexMatch[1])] : keyed.get(key);
    if (el) el.open = Boolean(open);
  });

  if (includeFields) _restoreFieldStates(root, context.fields);

  if (includeFocus && context.focus?.key) {
    const focusables = [...root.querySelectorAll(FOCUSABLE_SELECTOR)];
    const indexMatch = context.focus.key.match(/^focus-index:(\d+)$/);
    const target = indexMatch
      ? focusables[Number(indexMatch[1])]
      : focusables.find(el => _focusKey(el, root) === context.focus.key);
    if (target && !target.disabled) {
      target.focus({ preventScroll: true });
      if (context.focus.start != null && typeof target.setSelectionRange === 'function') {
        try {
          target.setSelectionRange(
            context.focus.start,
            context.focus.end ?? context.focus.start,
            context.focus.direction
          );
        } catch { /* certains types d'input n'acceptent pas de selection */ }
      }
    }
  }

  if (includeWindow && context.window) {
    window.scrollTo({ left: context.window.x, top: context.window.y, behavior: 'auto' });
  }
}

export function restoreViewContextAfterRender(root, context, options = {}) {
  const { shouldRestore, ...restoreOptions } = options;
  const schedule = globalThis.requestAnimationFrame
    ? (callback) => globalThis.requestAnimationFrame(callback)
    : (callback) => queueMicrotask(callback);
  schedule(() => schedule(() => {
    if (!shouldRestore || shouldRestore()) restoreViewContext(root, context, restoreOptions);
  }));
}

export function replaceHtmlPreservingView(root, html, options = {}) {
  if (!root) return null;
  const context = captureViewContext(root, options);
  root.innerHTML = html;
  restoreViewContextAfterRender(root, context, options);
  return context;
}
