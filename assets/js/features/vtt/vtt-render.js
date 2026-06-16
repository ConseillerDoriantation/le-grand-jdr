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
import { STATE } from '../../core/state.js';
import { updateDoc } from '../../config/firebase.js';
import { _pgRef } from './vtt-refs.js';
import { _showCtxMenu } from './vtt-utils.js';
import { showNotif } from '../../shared/notifications.js';

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

// ── Images BG/FG de la carte ─────────────────────────────────────────────────
// Patch Firestore d'une image (privé : utilisé seulement par _renderMapImages).
async function _patchImg(imgId, patch) {
  if (!VS.activePage) return;
  await updateDoc(_pgRef(VS.activePage.id), {
    backgroundImages: (VS.activePage.backgroundImages??[]).map(i=>i.id===imgId?{...i,...patch}:i)
  }).catch(()=>{});
}

/**
 * Rend les images de fond/avant-plan de la page active sur VS.layers.map/mapFg.
 * Les effets cross-domaine du clic de sélection (désélection token + inspecteur
 * + barre d'action) sont injectés en callbacks → le renderer reste découplé du
 * combat/inspecteur (vtt.js câble les callbacks).
 * @param {{hideActBar?:Function, clearHL?:Function, renderInspector?:Function}} deps
 */
export function _renderMapImages(deps = {}) {
  const { hideActBar = () => {}, clearHL = () => {}, renderInspector = () => {} } = deps;
  if (!VS.activePage) return;
  const K = window.Konva;
  // Nettoyer les images des deux couches (sans détruire les transformers)
  VS.layers.map.find('Image').forEach(n=>n.destroy());
  VS.layers.mapFg?.find('Image').forEach(n=>n.destroy());
  if (VS.imgTr)   { VS.imgTr.nodes([]);   }
  if (VS.imgTrFg) { VS.imgTrFg.nodes([]); }
  VS.selImg = null;

  for (const img of (VS.activePage.backgroundImages??[])) {
    const isFg   = img.layer === 'fg';
    const tgtLyr = isFg ? VS.layers.mapFg : VS.layers.map;
    const tr     = isFg ? VS.imgTrFg      : VS.imgTr;

    const el = new Image(); el.crossOrigin='anonymous';
    el.onload = () => {
      if (!VS.activePage) return; // page changée entre temps
      const ki = new K.Image({
        image:el, x:img.x*CELL, y:img.y*CELL,
        width:img.w*CELL, height:img.h*CELL,
        name:`img-${img.id}`,
      });

      if (STATE.isAdmin) {
        // Drag activé uniquement en mode édition carte
        ki.draggable(VS.mapMode);
        ki.on('dragmove', () => {
          ki.x(Math.round(ki.x()/CELL)*CELL);
          ki.y(Math.round(ki.y()/CELL)*CELL);
        });
        ki.on('dragend', () => {
          _patchImg(img.id, { x:Math.round(ki.x()/CELL), y:Math.round(ki.y()/CELL) });
        });

        // Clic → sélectionner l'image (seulement en mode édition carte)
        ki.on('click', e => {
          if (e.evt.button !== 0) return; // ignore middle/right (pan caméra)
          if (!VS.mapMode) return;
          e.cancelBubble = true;
          VS.tokens[VS.selected]?.shape?.findOne('.sel')?.visible(false);
          hideActBar();
          VS.selected=null; clearHL(); renderInspector(null); VS.layers.token.batchDraw();
          VS.selImg = img.id;
          // Vider l'autre transformer
          const otherTr = isFg ? VS.imgTr : VS.imgTrFg;
          otherTr?.nodes([]);
          if (tr?.getParent()) { tr.nodes([ki]); tr.moveToTop(); }
          tgtLyr.batchDraw();
        });

        // Fin de redimensionnement → snap + sauvegarde
        ki.on('transformend', () => {
          const w=Math.max(1,Math.round(ki.width()*ki.scaleX()/CELL));
          const h=Math.max(1,Math.round(ki.height()*ki.scaleY()/CELL));
          const x=Math.round(ki.x()/CELL), y=Math.round(ki.y()/CELL);
          ki.width(w*CELL); ki.height(h*CELL);
          ki.scaleX(1); ki.scaleY(1);
          ki.x(x*CELL); ki.y(y*CELL);
          tgtLyr.batchDraw();
          _patchImg(img.id, { x, y, w, h });
        });

        // Clic-droit → menu contextuel
        ki.on('contextmenu', e => {
          e.evt.preventDefault();
          if (!VS.mapMode) return;
          _showCtxMenu(e.evt.clientX, e.evt.clientY, [
            {
              label: isFg ? '⬇ Arrière-plan (sous les tokens)' : '⬆ Premier plan (au-dessus des tokens)',
              fn: () => _patchImg(img.id, { layer: isFg ? 'bg' : 'fg' }),
            },
            '---',
            {
              label: '🗑 Supprimer cette image',
              fn: () => {
                const imgs=(VS.activePage.backgroundImages??[]).filter(i=>i.id!==img.id);
                updateDoc(_pgRef(VS.activePage.id),{backgroundImages:imgs}).catch(e=>{ console.error('[vtt] suppr image carte', e); showNotif("Échec de la suppression de l'image de carte", 'error'); });
              },
            },
          ]);
        });
      }

      tgtLyr.add(ki);
      if (tr?.getParent()) tr.moveToTop();
      tgtLyr.batchDraw();
    };
    el.src = img.url;
  }
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
