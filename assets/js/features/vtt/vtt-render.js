// ══════════════════════════════════════════════════════════════════════════════
// VTT — Rendu Konva (moteur de scène)
// ──────────────────────────────────────────────────────────────────────────────
// Extraction progressive du cœur de rendu hors de vtt.js (cf.
// docs/vtt-decomposition.md). Chaque renderer dessine sur les calques Konva
// partagés (VS.layers) à partir de l'état (VS) + constantes (CELL).
// Konva est chargé sur window.Konva par _loadKonva (reste dans vtt.js).
//
// Tranche 1 : la grille (renderer leaf — rien ne le rappelle).
// ══════════════════════════════════════════════════════════════════════════════
import { VS } from './vtt-state.js';
import { CELL } from './vtt-constants.js';

/** Charge Konva (vendored) sur window.Konva si pas déjà présent. */
export async function _loadKonva() {
  if (window.Konva) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = './assets/js/vendor/konva-10.3.0.min.js';
    s.onload = res; s.onerror = () => rej(new Error('Konva.js introuvable'));
    document.head.appendChild(s);
  });
}

/** Convertit une position écran (pointeur) en coordonnées monde (avant grille). */
export function _stageToWorld(ptr) {
  const sc = VS.stage.scaleX(), sp = VS.stage.position();
  return { x: (ptr.x - sp.x) / sc, y: (ptr.y - sp.y) / sc };
}

/** Redessine le fond + la grille de la page active sur les calques bg/grid. */
export function _drawGrid() {
  if (!VS.stage || !VS.activePage) return;
  const K = window.Konva;
  VS.layers.bg.destroyChildren();
  VS.layers.grid.find('Line').forEach(n => n.destroy());
  const { cols, rows } = VS.activePage;
  const W = cols * CELL, H = rows * CELL;
  // Fond sur la couche bg (sous les images)
  VS.layers.bg.add(new K.Rect({ x:0, y:0, width:W, height:H, fill:'#12121f', listening:false }));
  VS.layers.bg.batchDraw();
  // Lignes de grille sur la couche grid (au-dessus des images)
  const s = { stroke:'rgba(255,255,255,0.22)', strokeWidth:1, listening:false };
  for (let c=0; c<=cols; c++) VS.layers.grid.add(new K.Line({ points:[c*CELL,0,c*CELL,H], ...s }));
  for (let r=0; r<=rows; r++) VS.layers.grid.add(new K.Line({ points:[0,r*CELL,W,r*CELL], ...s }));
  VS.layers.grid.batchDraw();
}
