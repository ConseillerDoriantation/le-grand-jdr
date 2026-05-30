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
    const fn = handlers[el.dataset[actionKey]];
    if (typeof fn !== 'function') return;
    // Filtre par type d'événement si data-{prefix}-on est précisé (ex: "input")
    const on = el.dataset[onKey];
    if (on && on !== e.type) return;
    fn(el, e);
  };

  document.addEventListener('click',  dispatch, true);
  document.addEventListener('input',  dispatch, true);
  document.addEventListener('change', dispatch, true);
}
