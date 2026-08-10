// ════════════════════════════════════════════════════════════════════════════
// A11Y — noms des boutons icône et activation clavier des pseudo-boutons.
//
// Beaucoup de boutons icône (🗑 ✕ ✏ ⚙ ▶ …) ont un `title` (infobulle) mais pas
// d'`aria-label` → les lecteurs d'écran les annoncent de façon incohérente
// (« bouton » seul, ou rien). On copie `title → aria-label` quand :
//   • le bouton n'a PAS déjà d'aria-label (jamais d'écrasement d'un label voulu) ;
//   • il est ICÔNE-SEULE (aucun mot/chiffre dans son texte) → sinon le texte
//     visible sert déjà de nom accessible (et un aria-label divergent nuirait).
//
// Les éléments non natifs déclarés role="button" reçoivent aussi un tabindex si
// nécessaire et réagissent à Entrée/Espace, sans intercepter les vrais contrôles
// imbriqués. Couvre le rendu dynamique via un MutationObserver. Auto-init à
// l'import (comme inline-compat.js). Idempotent, zéro dépendance.
// ════════════════════════════════════════════════════════════════════════════

const SEL = 'button[title]:not([aria-label]), [role="button"][title]:not([aria-label])';
const ROLE_BUTTON_SEL = '[role="button"]:not(button):not(a[href])';

// Icône-seule = pas de lettre ni de chiffre dans le texte (emoji/symboles only).
function _isIconOnly(el) {
  const txt = (el.textContent || '').trim();
  return !/[\p{L}\p{N}]/u.test(txt);
}

function _labelize(el) {
  if (!el || el.nodeType !== 1 || el.hasAttribute('aria-label')) return;
  const t = el.getAttribute('title')?.trim();
  if (t && _isIconOnly(el)) el.setAttribute('aria-label', t);
}

function _enhanceRoleButton(el) {
  if (!el || el.nodeType !== 1 || !el.matches?.(ROLE_BUTTON_SEL)) return;
  if (!el.hasAttribute('tabindex')) el.tabIndex = el.getAttribute('aria-disabled') === 'true' ? -1 : 0;
}

function _sweep(node) {
  if (!node || node.nodeType !== 1) return;
  if (node.matches?.(SEL)) _labelize(node);
  node.querySelectorAll?.(SEL).forEach(_labelize);
  if (node.matches?.(ROLE_BUTTON_SEL)) _enhanceRoleButton(node);
  node.querySelectorAll?.(ROLE_BUTTON_SEL).forEach(_enhanceRoleButton);
}

function _roleButtonFromEvent(event) {
  const target = event.target;
  if (!target?.closest || target.closest('button, a[href], input, select, textarea, summary')) return null;
  const button = target.closest(ROLE_BUTTON_SEL);
  if (!button || button.getAttribute('aria-disabled') === 'true') return null;
  return button;
}

function _activateRoleButton(button) {
  if (typeof button.click === 'function') button.click();
  else button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
}

let _started = false;
function _init() {
  if (_started) return;
  _started = true;
  try { _sweep(document.body); } catch {}
  try {
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') { if (m.target?.matches?.(SEL)) _labelize(m.target); }
        else m.addedNodes.forEach(_sweep);
      }
    }).observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['title'],
    });
  } catch (e) { console.error('[a11y] observer:', e); }
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const button = _roleButtonFromEvent(event);
    if (!button) return;
    event.preventDefault();
    _activateRoleButton(button);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _init, { once: true });
} else {
  _init();
}
