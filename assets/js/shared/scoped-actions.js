// ══════════════════════════════════════════════════════════════════════════════
// scoped-actions.js — Délégation d'événements scopée par préfixe.
//
// Mutualise le boilerplate identique qui était dupliqué dans shop / bestiary /
// players. Une seule paire de listeners capture (click + input + change) par
// préfixe, idempotente.
//
//   const handlers = {};
//   bindScopedActions('sh', handlers);   // bind une seule fois
//   Object.assign(handlers, { open: (el, e) => … });  // peut être peuplé après
//
// Le HTML porte :
//   data-{prefix}-action="open"   → handlers.open(el, event)
//   data-{prefix}-on="input"      → (optionnel) ne réagit qu'à ce type d'event
//
// NB : le VTT a son propre dispatcher (data-vtt-fn + résolution window[...] +
// parsing d'arguments) volontairement non mutualisé ici.
// ══════════════════════════════════════════════════════════════════════════════

const _bound = new Set();

function _setPending(el) {
  if (!el || el.dataset.actionPending === 'true') return false;
  el.dataset.actionPending = 'true';
  el.dataset.pendingWasDisabled = el.disabled ? 'true' : 'false';
  el.setAttribute('aria-busy', 'true');
  if ('disabled' in el) el.disabled = true;
  el.classList.add('is-action-pending');
  el._pendingTimer = setTimeout(() => {
    if (el.dataset.actionPending === 'true') el.classList.add('is-action-pending-visible');
  }, 180);
  return true;
}

function _clearPending(el) {
  clearTimeout(el?._pendingTimer);
  if (!el || el.dataset.actionPending !== 'true') return;
  delete el._pendingTimer;
  if ('disabled' in el && el.dataset.pendingWasDisabled !== 'true') el.disabled = false;
  delete el.dataset.pendingWasDisabled;
  delete el.dataset.actionPending;
  el.removeAttribute('aria-busy');
  el.classList.remove('is-action-pending', 'is-action-pending-visible');
}

function _dispatchSettled(el, action, ok, error = null) {
  if (typeof document.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return;
  document.dispatchEvent(new CustomEvent('app:action-settled', {
    detail: { element: el, action, ok, error },
  }));
}

function _runScopedHandler(fn, el, event, action) {
  const fail = (error) => {
    console.error(`[scoped-action] ${action}`, error);
    _dispatchSettled(el, action, false, error);
    import('./notifications.js')
      .then(({ showNotif }) => showNotif('Action impossible — voir la console.', 'error'))
      .catch(() => {});
  };
  try {
    const output = fn(el, event);
    if (output && typeof output.then === 'function') {
      if (event.type === 'click') _setPending(el);
      Promise.resolve(output)
        .then(result => _dispatchSettled(el, action, result !== false))
        .catch(fail)
        .finally(() => _clearPending(el));
    } else {
      _dispatchSettled(el, action, output !== false);
    }
  } catch (error) {
    fail(error);
  }
}

export function bindScopedActions(prefix, handlers) {
  if (_bound.has(prefix)) return;
  _bound.add(prefix);

  // dataset camelCase : data-sh-action → dataset.shAction, data-sh-on → dataset.shOn
  const actionKey = `${prefix}Action`;
  const onKey     = `${prefix}On`;
  const selector  = `[data-${prefix}-action]`;

  const dispatch = (e) => {
    const el = e.target.closest(selector);
    if (!el) return;
    const action = el.dataset[actionKey];
    const fn = handlers[action];
    if (typeof fn !== 'function') return;
    // Filtre par type d'événement si data-{prefix}-on est précisé (ex: "input")
    const on = el.dataset[onKey];
    if (on && on !== e.type) return;
    if (el.dataset.actionPending === 'true') return;
    _runScopedHandler(fn, el, e, `${prefix}:${action}`);
  };

  document.addEventListener('click',  dispatch, true);
  document.addEventListener('input',  dispatch, true);
  document.addEventListener('change', dispatch, true);
}
