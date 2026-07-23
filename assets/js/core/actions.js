// ══════════════════════════════════════════════
// actions.js — Registry central des data-action
// Les features s'y enregistrent via registerActions()
// Le dispatcher est appelé par navigation.js
// ══════════════════════════════════════════════

const ACTIONS = {};

// Un handler `async` qui échoue rendait un rejet que personne n'attendait :
// aucune trace visible, le clic semblait simplement « ne rien faire ». On
// signale désormais l'échec (console + toast) pour toutes les actions.
function _runHandler(handler, el, event, action) {
  const fail = (err) => {
    console.error(`[action] ${action}`, err);
    import('../shared/notifications.js')
      .then(({ showNotif }) => showNotif('Action impossible — voir la console.', 'error'))
      .catch(() => {});
  };
  try {
    const out = handler(el, event);
    if (out && typeof out.catch === 'function') out.catch(fail);
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
