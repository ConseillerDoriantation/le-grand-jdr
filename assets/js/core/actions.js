// ══════════════════════════════════════════════
// actions.js — Registry central des data-action
// Les features s'y enregistrent via registerActions()
// Le dispatcher est appelé par navigation.js
// ══════════════════════════════════════════════

const ACTIONS = {};

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
  handler(btn, event);
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
  handler(el, event);
  return true;
}
