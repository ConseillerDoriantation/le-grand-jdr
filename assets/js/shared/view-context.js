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

function _focusKey(el, root) {
  const explicit = el.dataset?.viewStateKey || el.id || el.getAttribute?.('name');
  if (explicit) return `focus:${explicit}`;
  const focusables = [...root.querySelectorAll(FOCUSABLE_SELECTOR)];
  const index = focusables.indexOf(el);
  return index >= 0 ? `focus-index:${index}` : '';
}

export function captureViewContext(root, { includeWindow = false, includeFocus = false } = {}) {
  if (!root) return null;
  const context = {
    window: includeWindow ? { x: window.scrollX, y: window.scrollY } : null,
    scrolls: [],
    details: [],
    focus: null,
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

export function restoreViewContext(root, context, { includeWindow = false, includeFocus = false } = {}) {
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
