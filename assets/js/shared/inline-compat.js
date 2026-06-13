// ══════════════════════════════════════════════════════════════════════════════
// INLINE-COMPAT.JS — Délégation CSP-safe des comportements jadis inline.
//
// Permet d'activer une CSP stricte (script-src SANS 'unsafe-inline', voir
// docs/security.md §3) : les handlers onmouseover/onmouseout/onkeydown/onfocus/
// onerror/onchange générés dans le HTML sont remplacés par des attributs data-*
// interprétés ici via des écouteurs délégués (un seul par type d'événement).
//
// Importé une seule fois au boot par app.js. Additif : n'interfère pas avec les
// autres systèmes de câblage (data-action, data-vtt-fn, scoped-actions).
// ══════════════════════════════════════════════════════════════════════════════

// ── Survol : data-hov-bg / data-hov-border / data-hov-color / data-hov-opacity ──
// Valeurs appliquées au survol. data-hov-skip-if-bg : sous-chaîne ; si le
// background courant la contient, on ne fait rien (ex. ligne déjà sélectionnée).
// Restauration par réécriture complète de l'attribut style → robuste face aux
// raccourcis CSS (`border:…`) et aux var() que CSSOM gère mal en lecture/écriture.
const HOV_SEL = '[data-hov-bg],[data-hov-border],[data-hov-color],[data-hov-opacity]';

document.addEventListener('mouseover', (e) => {
  const el = e.target.closest?.(HOV_SEL);
  if (!el || el._hovActive) return;
  const skip = el.dataset.hovSkipIfBg;
  if (skip && (el.style.background || '').includes(skip)) return;
  el._hovActive = true;
  el._hovPrevStyle = el.getAttribute('style') || '';
  if (el.dataset.hovBg)      el.style.background  = el.dataset.hovBg;
  if (el.dataset.hovBorder)  el.style.borderColor = el.dataset.hovBorder;
  if (el.dataset.hovColor)   el.style.color       = el.dataset.hovColor;
  if (el.dataset.hovOpacity) el.style.opacity     = el.dataset.hovOpacity;
});

document.addEventListener('mouseout', (e) => {
  const el = e.target.closest?.(HOV_SEL);
  if (!el || !el._hovActive) return;
  if (el.contains(e.relatedTarget)) return;   // déplacement interne : on reste survolé
  el._hovActive = false;
  el.setAttribute('style', el._hovPrevStyle || '');
});

// ── Clavier sur champs : data-enter / data-enter-click / data-esc ──────────────
//   data-enter="blur"         → Entrée : preventDefault + blur
//   data-enter="change-blur"  → Entrée : preventDefault + dispatch('change') + blur
//   data-enter-click="<sel>"  → Entrée : preventDefault + clic sur querySelector(sel)
//   data-esc="revert-blur"    → Échap : restaure la valeur d'origine + blur
//   data-esc="clear-blur"     → Échap : vide la valeur + blur
function _origValue(el) {
  return el.isContentEditable ? (el._origText ?? '') : (el.defaultValue ?? '');
}
function _setValue(el, v) {
  if (el.isContentEditable) el.textContent = v; else el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

document.addEventListener('keydown', (e) => {
  const el = e.target;
  if (!el || el.nodeType !== 1) return;
  if (e.key === 'Enter') {
    const click = el.getAttribute?.('data-enter-click');
    if (click) { e.preventDefault(); document.querySelector(click)?.click(); return; }
    const mode = el.dataset?.enter;
    if (mode === 'blur')             { e.preventDefault(); el.blur(); }
    else if (mode === 'change-blur') { e.preventDefault(); el.dispatchEvent(new Event('change', { bubbles: true })); el.blur(); }
  } else if (e.key === 'Escape') {
    const esc = el.dataset?.esc;
    if (esc === 'revert-blur')     { _setValue(el, _origValue(el)); el.blur(); }
    else if (esc === 'clear-blur') { _setValue(el, ''); el.blur(); }
  }
});

// Mémorise le texte d'origine d'un contenteditable au focus (pour data-esc="revert-blur").
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (el?.isContentEditable && el.hasAttribute?.('data-esc')) el._origText = el.textContent;
});

// ── Images : data-img-err = "hide" | "text" | "mark-parent" ───────────────────
//   "hide"        → visibility:hidden
//   "text"        → remplace l'image par data-img-err-text (ex. une icône)
//   "mark-parent" → ajoute data-img-err-class au parent
// (l'événement `error` ne bulle pas → écoute en phase de capture.)
document.addEventListener('error', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLImageElement)) return;
  const mode = el.dataset.imgErr;
  if (!mode) return;
  if (mode === 'hide')             el.style.visibility = 'hidden';
  else if (mode === 'text')        el.replaceWith(document.createTextNode(el.dataset.imgErrText || ''));
  else if (mode === 'mark-parent') el.parentNode?.classList.add(el.dataset.imgErrClass || '');
}, true);

// ── Case à cocher activant/désactivant un champ : data-toggle-disable="<id>" ───
document.addEventListener('change', (e) => {
  const cb = e.target.closest?.('[data-toggle-disable]');
  if (!cb) return;
  const t = document.getElementById(cb.dataset.toggleDisable);
  if (!t) return;
  t.disabled = cb.checked;
  if (!cb.checked) t.focus();
});
