// ══════════════════════════════════════════════════════════════════════════════
// VTT — Utilitaires transverses sans état (frontière d'erreur de panneau, …)
// ──────────────────────────────────────────────────────────────────────────────
// Module LEAF : ne dépend que de helpers partagés (notifications, html). Importé
// par vtt.js ET ses sous-modules → évite l'import circulaire vers vtt.js.
// ══════════════════════════════════════════════════════════════════════════════
import { showNotif } from '../../shared/notifications.js';
import { _esc } from '../../shared/html.js';

// Frontière d'erreur par panneau : un rendu qui plante n'abat pas toute la table.
// Loggue, notifie une seule fois par panneau, et remplit le conteneur d'un message.
const _vttPanelErrSeen = new Set();
export function _vttPanelError(label, e, elId) {
  console.error(`[vtt] panneau « ${label} » : rendu échoué`, e);
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
const _CTX_ACTIONS = {};

export function _hideCtxMenu() {
  document.getElementById('vtt-ctx-menu')?.remove();
  if (_ctxClose) { document.removeEventListener('mousedown', _ctxClose); _ctxClose=null; }
}

export function _showCtxMenu(x, y, items) {
  _hideCtxMenu();
  const el=document.createElement('div');
  el.id='vtt-ctx-menu'; el.className='vtt-ctx-menu';
  let idx=0;
  el.innerHTML=items.map(item=>{
    if (item==='---') return '<div class="vtt-ctx-sep"></div>';
    const i=idx++;
    _CTX_ACTIONS[i]=item.fn;
    return `<div class="vtt-ctx-item" data-i="${i}">${item.label}</div>`;
  }).join('');
  el.addEventListener('click', e=>{
    const i=e.target.closest('.vtt-ctx-item')?.dataset.i;
    if (i!=null) { _CTX_ACTIONS[+i]?.(); _hideCtxMenu(); }
  });
  // Positionner en évitant de sortir de l'écran
  el.style.cssText=`left:${x}px;top:${y}px;visibility:hidden`;
  document.body.appendChild(el);
  const r=el.getBoundingClientRect(), vw=window.innerWidth, vh=window.innerHeight;
  const left = r.right  > vw ? Math.max(0, x - r.width)  : x;
  const top  = r.bottom > vh ? Math.max(0, y - r.height) : y;
  el.style.cssText=`left:${left}px;top:${top}px;`;
  _ctxClose=e=>{ if (!el.contains(e.target)) _hideCtxMenu(); };
  requestAnimationFrame(()=>document.addEventListener('mousedown',_ctxClose));
}
