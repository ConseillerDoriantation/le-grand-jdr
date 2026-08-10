// ══════════════════════════════════════════════════════════════════════════════
// VTT — Utilitaires transverses sans état (frontière d'erreur de panneau, …)
// ──────────────────────────────────────────────────────────────────────────────
// Module LEAF : ne dépend que de helpers partagés (notifications, html). Importé
// par vtt.js ET ses sous-modules → évite l'import circulaire vers vtt.js.
// ══════════════════════════════════════════════════════════════════════════════
import { showNotif } from '../../shared/notifications.js';
import { _esc } from '../../shared/html.js';
import { reportError } from '../../shared/error-sensor.js';

// Clé d'identité de l'entité liée à un token (perso/PNJ) — null si token libre.
// Partagé par l'auto-sync (dédup réserve) et le rendu du tray.
export const _tokenEntityKey = t => t?.characterId ? 'c:' + t.characterId : t?.npcId ? 'n:' + t.npcId : null;

// Frontière d'erreur par panneau : un rendu qui plante n'abat pas toute la table.
// Loggue, notifie une seule fois par panneau, et remplit le conteneur d'un message.
const _vttPanelErrSeen = new Set();
export function _vttPanelError(label, e, elId) {
  console.error(`[vtt] panneau « ${label} » : rendu échoué`, e);
  reportError(e, { boundary: 'vtt:' + label });
  if (!_vttPanelErrSeen.has(label)) {
    _vttPanelErrSeen.add(label);
    try { showNotif(`⚠ Panneau « ${label} » en erreur — le reste de la table continue (détail en console).`, 'error'); } catch {}
  }
  if (elId) {
    const el = document.getElementById(elId);
    if (el) el.innerHTML = `<div class="vtt-panel-err">⚠ Erreur d'affichage de ce panneau.<br><small>${_esc(String(e?.message ?? e))}</small></div>`;
  }
}

// ── Menu contextuel générique (clic-droit) ───────────────────────────────────
// Pur DOM, sans état VTT → utilisable par vtt.js et les sous-modules (musique…).
let _ctxClose = null;
let _ctxRestoreFocus = null;
const _CTX_ACTIONS = {};

export function _hideCtxMenu({ restoreFocus = false } = {}) {
  document.getElementById('vtt-ctx-menu')?.remove();
  if (_ctxClose) { document.removeEventListener('mousedown', _ctxClose); _ctxClose=null; }
  const restore = _ctxRestoreFocus;
  _ctxRestoreFocus = null;
  if (restoreFocus && restore?.isConnected) restore.focus({ preventScroll: true });
}

export function _showCtxMenu(x, y, items) {
  _hideCtxMenu();
  _ctxRestoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  Object.keys(_CTX_ACTIONS).forEach(key => delete _CTX_ACTIONS[key]);
  const el=document.createElement('div');
  el.id='vtt-ctx-menu'; el.className='vtt-ctx-menu';
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', 'Actions contextuelles');
  let idx=0;
  el.innerHTML=items.map(item=>{
    if (item==='---') return '<div class="vtt-ctx-sep" role="separator"></div>';
    if (typeof item.fn !== 'function') return `<div class="vtt-ctx-label">${item.label}</div>`;
    const i=idx++;
    _CTX_ACTIONS[i]=item.fn;
    return `<button type="button" class="vtt-ctx-item" role="menuitem" tabindex="-1" data-i="${i}">${item.label}</button>`;
  }).join('');
  el.addEventListener('click', e=>{
    const i=e.target.closest('.vtt-ctx-item')?.dataset.i;
    if (i!=null) { _CTX_ACTIONS[+i]?.(); _hideCtxMenu(); }
  });
  el.addEventListener('keydown', e => {
    const menuItems = [...el.querySelectorAll('.vtt-ctx-item')];
    const current = menuItems.indexOf(document.activeElement);
    let next = null;
    if (e.key === 'ArrowDown') next = (current + 1) % menuItems.length;
    else if (e.key === 'ArrowUp') next = (current - 1 + menuItems.length) % menuItems.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = menuItems.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      document.activeElement?.click();
      return;
    }
    else if (e.key === 'Escape') {
      e.preventDefault();
      _hideCtxMenu({ restoreFocus: true });
      return;
    }
    if (next != null && menuItems[next]) {
      e.preventDefault();
      menuItems.forEach((item, index) => { item.tabIndex = index === next ? 0 : -1; });
      menuItems[next].focus({ preventScroll: true });
    }
  });
  el.addEventListener('focusout', () => {
    queueMicrotask(() => {
      if (el.isConnected && !el.contains(document.activeElement)) _hideCtxMenu();
    });
  });
  // Positionner en évitant de sortir de l'écran
  let posX = Number(x) || 0;
  let posY = Number(y) || 0;
  if (posX <= 0 && posY <= 0 && _ctxRestoreFocus && _ctxRestoreFocus !== document.body) {
    const anchor = _ctxRestoreFocus.getBoundingClientRect();
    posX = anchor.left;
    posY = anchor.bottom;
  }
  el.style.cssText=`left:${posX}px;top:${posY}px;visibility:hidden`;
  document.body.appendChild(el);
  const r=el.getBoundingClientRect(), vw=window.innerWidth, vh=window.innerHeight;
  const left = r.right  > vw ? Math.max(0, posX - r.width)  : Math.max(0, posX);
  const top  = r.bottom > vh ? Math.max(0, posY - r.height) : Math.max(0, posY);
  el.style.cssText=`left:${left}px;top:${top}px;`;
  _ctxClose=e=>{ if (!el.contains(e.target)) _hideCtxMenu(); };
  requestAnimationFrame(() => {
    document.addEventListener('mousedown', _ctxClose);
    const first = el.querySelector('.vtt-ctx-item');
    if (first) {
      first.tabIndex = 0;
      first.focus({ preventScroll: true });
    }
  });
}
