// ════════════════════════════════════════════════════════════════════════════
// A11Y — accessibilité : aria-label automatique sur les boutons icône-seule.
//
// Beaucoup de boutons icône (🗑 ✕ ✏ ⚙ ▶ …) ont un `title` (infobulle) mais pas
// d'`aria-label` → les lecteurs d'écran les annoncent de façon incohérente
// (« bouton » seul, ou rien). On copie `title → aria-label` quand :
//   • le bouton n'a PAS déjà d'aria-label (jamais d'écrasement d'un label voulu) ;
//   • il est ICÔNE-SEULE (aucun mot/chiffre dans son texte) → sinon le texte
//     visible sert déjà de nom accessible (et un aria-label divergent nuirait).
//
// Couvre le rendu dynamique via un MutationObserver. Auto-init à l'import (comme
// inline-compat.js). Idempotent, zéro dépendance.
// ════════════════════════════════════════════════════════════════════════════

const SEL = 'button[title]:not([aria-label]), [role="button"][title]:not([aria-label])';

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

function _sweep(node) {
  if (!node || node.nodeType !== 1) return;
  if (node.matches?.(SEL)) _labelize(node);
  node.querySelectorAll?.(SEL).forEach(_labelize);
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _init, { once: true });
} else {
  _init();
}
