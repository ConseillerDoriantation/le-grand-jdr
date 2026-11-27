// Valeur d'un objet amélioré : prix de base + prix de ses améliorations au tarif
// ACTUEL (Gérer → Améliorations, même calcul que la reprise : upgrade-value.js).
// Affichée en infobulle sur la case « Valeur » (Inventaire, Marché du Bastion) :
// survol à la souris, focus au clavier, toucher sur mobile.
import { _esc } from './html.js';
import { upgradeTariffValue } from './upgrade-value.js';

/** { base, upgrades, total } en or, pour un exemplaire. */
export function upgradedItemValue(base, item, settings) {
  const b = Math.max(0, Number(base) || 0);
  const upgrades = Math.max(0, Math.round(upgradeTariffValue(item, settings) || 0));
  return { base: b, upgrades, total: b + upgrades };
}

/** Lignes de l'infobulle ([libellé, valeur, classe?]) ; vide si rien d'amélioré. */
export function upgradedValueTipRows({ base, upgrades, total }, gold, per = '') {
  if (!(upgrades > 0)) return [];
  return [
    ['Valeur améliorée', gold(total) + per, 'is-total'],
    ['Prix de base', gold(base) + per],
    ['Améliorations', `+${gold(upgrades)}${per}`],
    ['', 'Améliorations comptées au tarif actuel', 'is-note'],
  ];
}

/** Attributs à poser sur la case : rend l'infobulle disponible (rien si pas de lignes). */
export function valueTipAttrs(rows) {
  if (!rows?.length) return '';
  _bind();
  return ` class="has-value-tip" tabindex="0" data-value-tip="${_esc(JSON.stringify(rows))}" aria-label="${_esc(rows.map(r => [r[0], r[1]].filter(Boolean).join(' : ')).join(' · '))}"`;
}

let _bound = false;
let _tip = null;
let _anchor = null;
let _watch = null;

function _hide() {
  _watch?.disconnect();
  _watch = null;
  _tip?.remove();
  _tip = null;
  _anchor = null;
}

function _show(anchor) {
  if (_anchor === anchor) return;
  let rows;
  try { rows = JSON.parse(anchor.dataset.valueTip || '[]'); } catch { rows = []; }
  _hide();
  if (!rows.length) return;
  _anchor = anchor;
  _tip = document.createElement('div');
  _tip.className = 'value-tip';
  _tip.setAttribute('role', 'tooltip');
  _tip.innerHTML = rows.map(([label, value, cls]) =>
    `<div class="${_esc(cls || '')}">${label ? `<span>${_esc(label)}</span>` : ''}<b>${_esc(value)}</b></div>`).join('');
  document.body.appendChild(_tip);
  // Fixe dans le viewport : jamais rogné par un panneau qui défile.
  const a = anchor.getBoundingClientRect();
  const t = _tip.getBoundingClientRect();
  const left = Math.max(8, Math.min(a.left + a.width / 2 - t.width / 2, innerWidth - t.width - 8));
  const below = a.bottom + 6;
  const top = below + t.height <= innerHeight - 8 ? below : Math.max(8, a.top - t.height - 6);
  _tip.style.left = `${Math.round(left)}px`;
  _tip.style.top = `${Math.round(top)}px`;
  // Re-rendu de la fiche pendant l'affichage : l'ancre disparaît → on ferme.
  // Observé seulement tant que l'infobulle est ouverte.
  _watch = new MutationObserver(() => { if (!_anchor?.isConnected) _hide(); });
  _watch.observe(document.body, { childList: true, subtree: true });
}

function _bind() {
  if (_bound || typeof document === 'undefined') return;
  _bound = true;
  const anchorOf = e => e.target?.closest?.('[data-value-tip]');
  document.addEventListener('pointerover', e => { const a = anchorOf(e); if (a) _show(a); });
  document.addEventListener('pointerout', e => {
    const a = anchorOf(e);
    if (a && a === _anchor && !a.contains(e.relatedTarget) && document.activeElement !== a) _hide();
  });
  document.addEventListener('focusin', e => { const a = anchorOf(e); if (a) _show(a); else if (_anchor) _hide(); });
  document.addEventListener('focusout', e => { if (anchorOf(e) === _anchor && !_anchor?.matches(':hover')) _hide(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _tip) _hide(); });
  // Défilement : l'ancre bouge → on ferme.
  addEventListener('scroll', () => { if (_tip) _hide(); }, true);
  addEventListener('resize', () => { if (_tip) _hide(); });
}
