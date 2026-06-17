// ══════════════════════════════════════════════════════════════════════════════
// VTT — Règle de mesure (outil MJ/joueur) + diffusion de la règle du MJ
// ──────────────────────────────────────────────────────────────────────────────
// Sous-système outils, extrait de vtt.js (cf. docs/vtt-decomposition.md).
// État local au module. vtt.js appelle les actions (_startRuler/_updateRuler/…)
// depuis les handlers canvas, et lit l'état via les getters (rulerActive/rulerBusy).
// Diffusion MJ throttlée via VS.session.mjRuler (Firestore).
// ══════════════════════════════════════════════════════════════════════════════
import { VS } from './vtt-state.js';
import { CELL, CELL_M } from './vtt-constants.js';
import { STATE } from '../../core/state.js';
import { setDoc } from '../../config/firebase.js';
import { _sesRef } from './vtt-refs.js';

const RULER_COLOR = '#ffe600';
const RULER_LABEL_OFFSET = { x: 6, y: -18 };
const _fmtRulerCells = n => `${n} case${n !== 1 ? 's' : ''} · ${(n * CELL_M).toFixed(1)}m`;
const _snapToCellCenter = wp => {
  const c = Math.floor(wp.x / CELL), r = Math.floor(wp.y / CELL);
  return { c, r, x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 };
}
const _rulerLabelPos = (x1, y1, x2, y2) => ({
  x: (x1 + x2) / 2 + RULER_LABEL_OFFSET.x,
  y: (y1 + y2) / 2 + RULER_LABEL_OFFSET.y,
});
// Crée line + label + dot d'origine, regroupés pour destruction unique.
function _buildRulerNodes(K, name, opacity = 1) {
  const group = new K.Group({ listening: false, name });
  const line = new K.Line({
    points: [0, 0, 0, 0], stroke: RULER_COLOR, strokeWidth: 2, dash: [8, 4],
    lineCap: 'round', opacity, listening: false,
  });
  const dot = new K.Circle({
    x: 0, y: 0, radius: 4, fill: RULER_COLOR, opacity,
    shadowColor: '#000', shadowBlur: 4, shadowOpacity: 0.7, listening: false,
  });
  const label = new K.Text({
    x: 0, y: 0, text: '', fill: RULER_COLOR, fontSize: 13, fontStyle: 'bold',
    shadowColor: '#000', shadowBlur: 6, shadowOpacity: 0.9,
    shadowOffset: { x: 1, y: 1 }, opacity, listening: false,
  });
  group.add(line, dot, label);
  return { group, line, dot, label };
}
function _setRulerNodes(nodes, x1, y1, x2, y2, text) {
  nodes.line.points([x1, y1, x2, y2]);
  nodes.dot.position({ x: x1, y: y1 });
  const p = _rulerLabelPos(x1, y1, x2, y2);
  nodes.label.text(text);
  nodes.label.position(p);
}

let _rulerActive  = false;
let _rulerOrigin  = null;
let _rulerHideTimer = null;
let _rulerNodes = null;     // nodes locaux (MJ ou joueur, pour l'utilisateur courant)
let _rulerLastCell = null;  // dernière case survolée — court-circuite si inchangée
let _rulerHoverDot = null;  // aperçu de la case de départ avant le 1er clic

// Getters d'état lus par les handlers canvas de vtt.js.
export const rulerActive = () => _rulerActive;
export const rulerBusy   = () => _rulerActive || !!_rulerNodes;

export function _showRulerHover(wp) {
  if (!VS.layers.ping || _rulerNodes) { _hideRulerHover(); return; } // pas d'aperçu si une règle est déjà visible
  const o = _snapToCellCenter(wp);
  if (!_rulerHoverDot) {
    const K = window.Konva;
    _rulerHoverDot = new K.Circle({
      radius: 5, fill: RULER_COLOR, opacity: 0.45,
      stroke: '#000', strokeWidth: 1, listening: false, name: 'ruler-hover',
    });
    VS.layers.ping.add(_rulerHoverDot);
  }
  _rulerHoverDot.position({ x: o.x, y: o.y });
  VS.layers.ping.batchDraw();
}
export function _hideRulerHover() {
  if (!_rulerHoverDot) return;
  _rulerHoverDot.destroy();
  _rulerHoverDot = null;
  VS.layers.ping?.batchDraw();
}

export function _startRuler(wp) {
  const K = window.Konva;
  _clearRuler();
  _hideRulerHover();
  const o = _snapToCellCenter(wp);
  _rulerActive = true;
  _rulerOrigin = o;
  _rulerLastCell = { c: o.c, r: o.r };
  _rulerNodes = _buildRulerNodes(K, 'ruler');
  _setRulerNodes(_rulerNodes, o.x, o.y, o.x, o.y, _fmtRulerCells(0));
  VS.layers.ping.add(_rulerNodes.group);
  VS.layers.ping.batchDraw();
  _broadcastMjRuler(o.x, o.y, 0);
}
export function _updateRuler(wp) {
  if (!_rulerNodes || !_rulerOrigin) return;
  const e = _snapToCellCenter(wp);
  // Court-circuit : pas de redraw ni de broadcast si la case n'a pas changé.
  if (_rulerLastCell && e.c === _rulerLastCell.c && e.r === _rulerLastCell.r) return;
  _rulerLastCell = { c: e.c, r: e.r };
  const cells = Math.abs(e.c - _rulerOrigin.c) + Math.abs(e.r - _rulerOrigin.r);
  _setRulerNodes(_rulerNodes, _rulerOrigin.x, _rulerOrigin.y, e.x, e.y, _fmtRulerCells(cells));
  VS.layers.ping.batchDraw();
  _broadcastMjRuler(e.x, e.y, cells);
}
export function _endRuler() {
  _rulerActive = false;
  if (_rulerHideTimer) clearTimeout(_rulerHideTimer);
  _rulerHideTimer = setTimeout(_clearRuler, 5000);
}
export function _clearRuler() {
  if (_rulerHideTimer) { clearTimeout(_rulerHideTimer); _rulerHideTimer = null; }
  _rulerNodes?.group.destroy();
  _rulerNodes = null;
  _rulerActive = false; _rulerOrigin = null; _rulerLastCell = null;
  VS.layers.ping?.batchDraw();
  _clearMjRulerBroadcast();
}

// Réinitialisation au teardown de la table (appelée par vtt.js).
export function _resetRuler() {
  if (_rulerHideTimer) { clearTimeout(_rulerHideTimer); _rulerHideTimer = null; }
  _rulerActive = false; _rulerOrigin = null; _rulerNodes = null;
  _rulerLastCell = null; _rulerHoverDot = null;
  if (_mjRulerPendingTimer) { clearTimeout(_mjRulerPendingTimer); _mjRulerPendingTimer = null; }
  _mjRulerLastWrite = 0; _mjRulerBroadcasting = false; _mjRulerRemote = null;
}

// Diffusion de la règle du MJ (visible par tous les joueurs via VS.session.mjRuler).
// Throttle pour lisser les écritures Firestore.
const MJ_RULER_THROTTLE = 120;
let _mjRulerLastWrite = 0;
let _mjRulerPendingTimer = null;
let _mjRulerBroadcasting = false; // évite un setDoc(null) inutile si jamais diffusé
function _broadcastMjRuler(x2, y2, cells) {
  if (!STATE.isAdmin || !VS.activePage || !_rulerOrigin) return;
  const payload = {
    pageId: VS.activePage.id,
    x1: _rulerOrigin.x, y1: _rulerOrigin.y,
    x2, y2, cells,
  };
  const now = Date.now();
  const wait = Math.max(0, MJ_RULER_THROTTLE - (now - _mjRulerLastWrite));
  if (_mjRulerPendingTimer) { clearTimeout(_mjRulerPendingTimer); _mjRulerPendingTimer = null; }
  const flush = () => {
    _mjRulerPendingTimer = null;
    _mjRulerLastWrite = Date.now();
    _mjRulerBroadcasting = true;
    setDoc(_sesRef(), { mjRuler: payload }, { merge: true }).catch(() => {});
  };
  if (wait === 0) flush();
  else _mjRulerPendingTimer = setTimeout(flush, wait);
}
function _clearMjRulerBroadcast() {
  if (!STATE.isAdmin) return;
  if (_mjRulerPendingTimer) { clearTimeout(_mjRulerPendingTimer); _mjRulerPendingTimer = null; }
  if (!_mjRulerBroadcasting) return; // rien n'a été diffusé → pas de write à effacer
  _mjRulerLastWrite = 0;
  _mjRulerBroadcasting = false;
  setDoc(_sesRef(), { mjRuler: null }, { merge: true }).catch(() => {});
}

// Rendu de la règle MJ chez les joueurs — mise à jour en place, sans destroy/rebuild.
let _mjRulerRemote = null;
export function _renderMjRulerRemote(data) {
  if (STATE.isAdmin) return; // le MJ voit déjà sa règle locale
  if (!VS.layers.ping) return;
  const visible = data && VS.activePage && data.pageId === VS.activePage.id;
  if (!visible) {
    if (_mjRulerRemote) {
      _mjRulerRemote.group.destroy();
      _mjRulerRemote = null;
      VS.layers.ping.batchDraw();
    }
    return;
  }
  if (!_mjRulerRemote) {
    _mjRulerRemote = _buildRulerNodes(window.Konva, 'mj-ruler', 0.85);
    VS.layers.ping.add(_mjRulerRemote.group);
  }
  const cells = data.cells ?? 0;
  _setRulerNodes(_mjRulerRemote, data.x1, data.y1, data.x2, data.y2,
    `MJ : ${_fmtRulerCells(cells)}`);
  VS.layers.ping.batchDraw();
}
