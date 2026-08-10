// ══════════════════════════════════════════════
// actions.js — Registry central des data-action
// Les features s'y enregistrent via registerActions()
// Le dispatcher est appelé par navigation.js
// ══════════════════════════════════════════════

const ACTIONS = {};

function _dispatchSettled(el, action, ok, error = null) {
  if (typeof document.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return;
  document.dispatchEvent(new CustomEvent('app:action-settled', {
    detail: { element: el, action, ok, error },
  }));
}

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
  if (!el) return;
  clearTimeout(el._pendingTimer);
  delete el._pendingTimer;
  if ('disabled' in el && el.dataset.pendingWasDisabled !== 'true') el.disabled = false;
  delete el.dataset.pendingWasDisabled;
  delete el.dataset.actionPending;
  el.removeAttribute('aria-busy');
  el.classList.remove('is-action-pending', 'is-action-pending-visible');
}

// Un handler `async` qui échoue rendait un rejet que personne n'attendait :
// aucune trace visible, le clic semblait simplement « ne rien faire ». On
// signale désormais l'échec (console + toast) pour toutes les actions.
function _runHandler(handler, el, event, action) {
  const fail = (err) => {
    console.error(`[action] ${action}`, err);
    _dispatchSettled(el, action, false, err);
    import('../shared/notifications.js')
      .then(({ showNotif }) => showNotif('Action impossible — voir la console.', 'error'))
      .catch(() => {});
  };
  try {
    const out = handler(el, event);
    if (out && typeof out.then === 'function') {
      _setPending(el);
      Promise.resolve(out)
        .then(result => _dispatchSettled(el, action, result !== false))
        .catch(fail)
        .finally(() => _clearPending(el));
    } else {
      _dispatchSettled(el, action, out !== false);
    }
  } catch (err) {
    fail(err);
  }
}

/**
 * Enregistre un ensemble d'actions depuis une feature.
 * Chaque handler reçoit (btn, event) où btn est l'élément [data-action].
 * @param {Record<string, (btn: HTMLElement, event: Event) => void>} map
 */
export function registerActions(map) {
  Object.assign(ACTIONS, map);
}

/**
 * Déclenche l'action correspondant à btn.dataset.action.
 * Retourne true si une action a été trouvée, false sinon.
 * @param {HTMLElement} btn
 * @param {Event} event
 */
export function dispatchAction(btn, event) {
  const action = btn.dataset.action;
  const handler = ACTIONS[action];
  if (!handler) return false;
  if (btn.dataset.actionPending === 'true') return true;

  if (btn.dataset.stopPropagation !== undefined) event.stopPropagation();
  _runHandler(handler, btn, event, action);
  return true;
}

/**
 * Déclenche l'action liée à un événement change/input.
 * @param {HTMLElement} el élément portant data-change ou data-input
 * @param {Event} event
 * @param {'change'|'input'} attr nom du dataset à lire
 */
export function dispatchValueAction(el, event, attr) {
  const action = el.dataset[attr];
  const handler = ACTIONS[action];
  if (!handler) return false;
  _runHandler(handler, el, event, action);
  return true;
}
