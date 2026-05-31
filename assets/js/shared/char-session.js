// ══════════════════════════════════════════════════════════════════════════════
// SHARED / CHAR-SESSION.JS — Contexte courant de la fiche personnage
//
// Remplace les globals window._currentChar / window._canEditChar /
// window._currentCharTab / window._renderTab / window.renderCharSheet /
// window.refreshOrDisplay utilisés par les sous-modules de characters/.
//
// Usage :
//   characters.js  → charSession.set(c, canEdit, tab)
//                    charSession.bindRender(renderTab, renderSheet, refresh)
//   sous-modules   → import { charSession } from '../../../shared/char-session.js'
// ══════════════════════════════════════════════════════════════════════════════

let _char    = null;
let _canEdit = false;
let _tab     = 'combat';

let _renderTabFn  = null;
let _renderSheetFn = null;
let _refreshFn    = null;

export const charSession = {
  // Appelé par characters.js à chaque rendu de fiche
  set(char, canEdit, tab) { _char = char; _canEdit = canEdit; _tab = tab; },

  // Appelé une fois par characters.js après définition de ses fonctions de rendu
  bindRender(renderTab, renderSheet, refresh) {
    _renderTabFn   = renderTab;
    _renderSheetFn = renderSheet;
    _refreshFn     = refresh;
  },

  getCurrentChar()    { return _char; },
  getCanEditChar()    { return _canEdit; },
  getCurrentCharTab() { return _tab; },

  renderTab(tab, c, canEdit)  { _renderTabFn?.(tab, c ?? _char, canEdit ?? _canEdit); },
  renderSheet(c, tab)          { _renderSheetFn?.(c ?? _char, tab); },
  refresh(c)                   { _refreshFn?.(c); },
};
