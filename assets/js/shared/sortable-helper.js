// ════════════════════════════════════════════════════════════════════════════
// sortable-helper.js — Options standard pour Sortable.js
//
// Factorise les ~10 options identiques (forceFallback, delay, easing…)
// partagées par toutes les features.
//
// Usage :
//   import { makeSortable } from '../shared/sortable-helper.js';
//   _sortable = makeSortable(container, {
//     prefix: 'sh',              // → sh-sortable-ghost / sh-sortable-chosen / sh-sortable-drag
//     draggable: '.sh-item',
//     onEnd: (evt) => { … },
//   });
//
// Le prefix génère les classes CSS ghost/chosen/drag selon la convention
// `{prefix}-sortable-{ghost|chosen|drag}`.
// Surcharger ghostClass/chosenClass/dragClass explicitement si la convention
// ne correspond pas (ex: world.js utilise world-drag-*).
// ════════════════════════════════════════════════════════════════════════════

import Sortable from '../vendor/sortable.esm.js';

const DRAG_DEFAULTS = {
  animation: 150,
  easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  filter: 'button, a, input, select, textarea, .btn, .btn-icon',
  preventOnFilter: false,
  forceFallback: true,
  fallbackOnBody: true,
  fallbackTolerance: 5,
  delay: 150,
  delayOnTouchOnly: true,
  touchStartThreshold: 5,
  // La zone de 30 px fournie par Sortable est trop étroite pour les longues
  // listes : le pointeur sort facilement de la fenêtre avant que la page ne
  // commence à suivre. Ces valeurs gardent le défilement progressif tout en
  // laissant le temps de déposer précisément entre deux éléments.
  scroll: true,
  forceAutoScrollFallback: true,
  scrollSensitivity: 96,
  scrollSpeed: 18,
  bubbleScroll: true,
};

/**
 * @param {HTMLElement} el
 * @param {{ prefix?: string } & SortableOptions} opts
 * @returns {Sortable}
 */
export function makeSortable(el, { prefix, ...opts } = {}) {
  const prefixClasses = prefix ? {
    ghostClass:  `${prefix}-sortable-ghost`,
    chosenClass: `${prefix}-sortable-chosen`,
    dragClass:   `${prefix}-sortable-drag`,
  } : {};
  return new Sortable(el, { ...DRAG_DEFAULTS, ...prefixClasses, ...opts });
}
