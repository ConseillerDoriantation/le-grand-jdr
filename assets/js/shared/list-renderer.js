// ══════════════════════════════════════════════════════════════════════════════
// SHARED / LIST-RENDERER.JS — Helpers de rendu de liste
// Factorise les patterns "liste vide" et "filtre → carte → conteneur"
// répétés dans quests, bestiary, bastion, story, etc.
//
// Usage :
//   import { emptyStateHtml, renderList } from '../shared/list-renderer.js';
//
//   content.innerHTML = renderList(
//     sorted, q => _questCard(q), 'quest-grid',
//     emptyStateHtml('📋', 'Aucune quête pour l\'instant.')
//   );
// ══════════════════════════════════════════════════════════════════════════════

/**
 * HTML d'un état vide standard (icône + message).
 * @param {string} icon    - Emoji ou texte affiché dans .icon
 * @param {string} message - Texte du paragraphe (non échappé — doit être déjà sûr)
 */
export function emptyStateHtml(icon = '', message = '') {
  return `<div class="empty-state"><div class="icon">${icon}</div><p>${message}</p></div>`;
}

/**
 * Rend une liste d'items dans un conteneur, ou l'état vide si la liste est vide.
 * @param {Array}    items          - Items à afficher
 * @param {Function} cardFn         - Fonction (item) => HTML string
 * @param {string}   containerClass - Classe CSS du div conteneur
 * @param {string}   emptyHtml      - HTML à afficher si items est vide
 */
export function renderList(items, cardFn, containerClass = '', emptyHtml = '') {
  if (!items.length) return emptyHtml;
  return `<div class="${containerClass}">${items.map(cardFn).join('')}</div>`;
}
