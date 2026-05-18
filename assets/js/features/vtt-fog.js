// ══════════════════════════════════════════════════════════════════════════════
// VTT-FOG.JS — Éclairage dynamique · Murs · Portes · Sources lumineuses
//
// Principe :
//  • Les murs (wall/door/window) sont stockés dans le document page Firestore
//    sous forme de segments en coordonnées grille (coins entiers).
//  • Le fog est un canvas offscreen (noir α=0.9) dont on découpe les zones
//    visibles via globalCompositeOperation = 'destination-out'.
//  • Algorithme de visibilité : Radial Sweep (polygone de visibilité).
//  • Brouillard partagé : chaque client calcule le même masque (union des
//    tokens joueurs de la page).
//  • En obscurité (token hors rayon de toute source) : vision 1 case.
//  • Fenêtres : transparentes à la LOS, bloquent le déplacement.
// ══════════════════════════════════════════════════════════════════════════════
import { updateDoc } from '../config/firebase.js';
import { showNotif }  from '../shared/notifications.js';

// ── État module ───────────────────────────────────────────────────────────────
let _CELL       = 70;
let _stage      = null;
let _fogLayer   = null;   // Konva.Layer pour le masque de brouillard
let _wallsLayer = null;   // Konva.Layer pour les visuels mur/porte/fenêtre

let _editMode   = false;  // éditeur de murs actif ?
let _editTool   = 'wall'; // 'wall' | 'door' | 'window' | 'light' | 'eraser'
let _drawStart  = null;   // {col,row} — début du segment en cours de tracé
let _preview    = null;   // Konva.Line de prévisualisation
let _selectedId = null;   // id du segment/lumière sélectionné
let _ctxMenu    = null;   // div du menu contextuel actif
let _stageEvts  = {};     // {event: fn} — listeners de l'éditeur, pour nettoyage
let _page       = null;   // référence TOUJOURS à jour vers la page active (évite closures stales)

let _fogPending = false;  // debounce requestAnimationFrame
let _snapDot    = null;   // indicateur d'aimantation pendant l'édition

let _pgRefFn = null;      // (pageId) → Firestore DocumentReference

// ── Constantes ────────────────────────────────────────────────────────────────
const FOG_ALPHA       = 0.92; // opacité pour les joueurs
const FOG_ALPHA_ADMIN = 0.40; // semi-transparent pour le MJ (voit la carte en dessous)
const DARK_CELLS  = 1;              // rayon de vision en obscurité (en cases)
const LIGHT_DEF_R = 5;              // rayon par défaut des sources (cases)

const WALL_COLOR  = { wall:'#64748b', door:'#c2410c', window:'#38bdf8' };
const WALL_W      = { wall:3,         door:3,          window:2          };
const EDIT_COLOR  = { wall:'#ef4444', door:'#fb923c',  window:'#67e8f9', light:'#fbbf24' };

// ═══════════════════════════════════════════════════════════════════════════════
// MATH
// ═══════════════════════════════════════════════════════════════════════════════

/** Distance t > 0 le long du rayon (ox,oy)+(t*rdx,t*rdy) jusqu'au segment (ax,ay)-(bx,by), ou null. */
function _raySegT(ox, oy, rdx, rdy, ax, ay, bx, by) {
  const sdx = bx - ax, sdy = by - ay;
  const d = rdx * sdy - rdy * sdx;
  if (Math.abs(d) < 1e-10) return null;
  const t = ((ax - ox) * sdy - (ay - oy) * sdx) / d;
  const u = ((ax - ox) * rdy - (ay - oy) * rdx) / d;
  if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) return t;
  return null;
}

/** Vrai si les deux segments se croisent (strictement, sans les extrémités). */
function _segsSect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1x = bx-ax, d1y = by-ay, d2x = dx-cx, d2y = dy-cy;
  const d = d1x*d2y - d1y*d2x;
  if (Math.abs(d) < 1e-10) return false;
  const t = ((cx-ax)*d2y - (cy-ay)*d2x) / d;
  const u = ((cx-ax)*d1y - (cy-ay)*d1x) / d;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ALGORITHME DE VISIBILITÉ — Radial Sweep
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calcule le polygone de visibilité depuis (ox, oy) dans un espace W×H pixels.
 * @param {number} ox - x de l'observateur (pixels)
 * @param {number} oy - y de l'observateur (pixels)
 * @param {Array}  blockers - [{x1,y1,x2,y2}] en pixels (murs opaques)
 * @param {number} W - largeur de la carte (pixels)
 * @param {number} H - hauteur de la carte (pixels)
 * @returns {Array} [{x,y}] — sommets du polygone, triés par angle
 */
// Soude les extrémités très proches sur un point canonique commun.
// Évite qu'un rayon "passe entre" deux murs censés se toucher (drift float).
function _weldBlockers(blockers, tol) {
  const unique = [];
  const find = (x, y) => {
    for (const u of unique) {
      if (Math.abs(u.x - x) <= tol && Math.abs(u.y - y) <= tol) return u;
    }
    const np = { x, y }; unique.push(np); return np;
  };
  return blockers.map(b => {
    const a = find(b.x1, b.y1);
    const c = find(b.x2, b.y2);
    return { x1: a.x, y1: a.y, x2: c.x, y2: c.y };
  });
}

function _visPoly(ox, oy, blockers, W, H) {
  // EPS angulaire augmenté : 0.0005 rad ≈ 0.029°, latéral ≈ 0.5px à 1000px.
  // Assez grand pour que les rayons "+/-EPS" passent réellement de part et d'autre d'un coin,
  // assez petit pour ne pas fusionner deux coins voisins.
  const EPS = 5e-4;
  // Soude les bouts de murs voisins (tolérance = 1/20 de case) pour éliminer les "fentes" sub-pixel
  blockers = _weldBlockers(blockers, _CELL / 20);

  const boundary = [
    { x1:0, y1:0, x2:W, y2:0 },
    { x1:W, y1:0, x2:W, y2:H },
    { x1:W, y1:H, x2:0, y2:H },
    { x1:0, y1:H, x2:0, y2:0 },
  ];
  const all = [...blockers, ...boundary];

  // Angles vers tous les coins de segments.
  // IMPORTANT : tous les angles doivent être dans la plage [-π, π] (= la plage de atan2).
  // Sinon le tri place certains sommets à la mauvaise position et le polygone
  // se referme avec une arête fantôme qui crée un wedge sombre dans la vision.
  const angles = [];
  for (const a of [-Math.PI/2, 0, Math.PI/2, Math.PI]) {
    angles.push(a-EPS, a, a+EPS);
  }
  for (const s of all) {
    for (const p of [{x:s.x1,y:s.y1},{x:s.x2,y:s.y2}]) {
      const a = Math.atan2(p.y - oy, p.x - ox);
      angles.push(a-EPS, a, a+EPS);
    }
  }

  // Pour chaque angle, intersecter avec le segment le plus proche
  const pts = [];
  for (const angle of angles) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let minT = Infinity, hit = null;
    for (const s of all) {
      const t = _raySegT(ox, oy, dx, dy, s.x1, s.y1, s.x2, s.y2);
      if (t !== null && t < minT) { minT = t; hit = { x: ox + dx*t, y: oy + dy*t }; }
    }
    if (hit) pts.push({ angle, x: hit.x, y: hit.y });
  }

  pts.sort((a, b) => a.angle - b.angle);
  return pts;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GÉNÉRATION DU CANVAS FOG
// ═══════════════════════════════════════════════════════════════════════════════

function _buildFogCanvas(page, tokens, isAdmin = false) {
  const C = _CELL;
  const W = (page.cols || 24) * C;
  const H = (page.rows || 18) * C;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Plein noir (semi-transparent pour le MJ, opaque pour les joueurs)
  ctx.fillStyle = `rgba(0,0,0,${isAdmin ? FOG_ALPHA_ADMIN : FOG_ALPHA})`;
  ctx.fillRect(0, 0, W, H);

  // Segments bloquants LOS : murs + portes fermées.
  // Les fenêtres (ouvertes OU fermées) laissent toujours passer la vision.
  const walls = page.walls || [];
  const blockers = walls
    .filter(w => w.type === 'wall' || (w.type === 'door' && !w.open))
    .map(w => ({ x1: w.x1*C, y1: w.y1*C, x2: w.x2*C, y2: w.y2*C }));

  ctx.globalCompositeOperation = 'destination-out';
  // fillStyle DOIT être opaque pour un effacement complet du masque
  ctx.fillStyle = 'rgba(0,0,0,1)';

  // Helpers canvas
  const fillPoly = poly => {
    if (poly.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
    ctx.fill();
  };
  const fillPolyClipped = (poly, cx, cy, r) => {
    if (poly.length < 3) return;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.clip();
    fillPoly(poly);
    ctx.restore();
  };

  const lights = page.lightSources || [];

  // Sources lumineuses : LOS depuis le centre, clippée au rayon
  for (const ls of lights) {
    const lx = ls.x * C, ly = ls.y * C;
    const r  = (ls.radius ?? LIGHT_DEF_R) * C;
    fillPolyClipped(_visPoly(lx, ly, blockers, W, H), lx, ly, r);
  }

  // Tokens joueurs
  const playerToks = Object.values(tokens || {})
    .map(e => e.data)
    .filter(t => t && t.type === 'player' && t.pageId === page.id);

  for (const tok of playerToks) {
    const tw = tok.tokenW ?? tok.tokenSize ?? 1;
    const th = tok.tokenH ?? tok.tokenSize ?? 1;
    const ox = (tok.col + tw * 0.5) * C;
    const oy = (tok.row + th * 0.5) * C;

    // En lumière si dans le rayon d'au moins une source, ou aucune source définie
    const inLight = lights.length === 0 || lights.some(ls => {
      const r = (ls.radius ?? LIGHT_DEF_R) * C;
      return Math.hypot(ox - ls.x*C, oy - ls.y*C) <= r;
    });

    const poly = _visPoly(ox, oy, blockers, W, H);
    if (inLight) {
      fillPoly(poly);
    } else {
      // Obscurité : vision limitée à DARK_CELLS case(s)
      fillPolyClipped(poly, ox, oy, DARK_CELLS * C);
    }
  }

  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

// ═══════════════════════════════════════════════════════════════════════════════
// API PUBLIQUE — Initialisation + mise à jour du fog
// ═══════════════════════════════════════════════════════════════════════════════

export function fogInit(stage, layers, CELL) {
  _stage      = stage;
  _CELL       = CELL;
  _fogLayer   = layers.fog;
  _wallsLayer = layers.walls;
}

export function fogSetPgRef(fn) { _pgRefFn = fn; }

/** Mise à jour de la référence page courante (appelée depuis vtt.js à chaque changement). */
export function fogSetPage(page) { _page = page; }

function _pgRef(id) { return _pgRefFn ? _pgRefFn(id) : null; }

/** Recalcule et affiche le fog immédiatement. */
export function fogUpdate(page, tokens, isAdmin) {
  if (!_fogLayer || !page) return;
  _fogLayer.destroyChildren();

  if (!page.fogEnabled) {
    _fogLayer.batchDraw();
    return; // fog désactivé sur cette page
  }

  const K = window.Konva;
  if (!K) return;
  // Le MJ voit le fog semi-transparent (FOG_ALPHA_ADMIN) pour garder la carte lisible
  const canvas = _buildFogCanvas(page, tokens, !!isAdmin);
  const img = new K.Image({ image: canvas, x: 0, y: 0, listening: false });
  _fogLayer.add(img);
  _fogLayer.batchDraw();
}

/** Version debounced (requestAnimationFrame) — appel sûr depuis n'importe où. */
export function fogUpdateSoon(page, tokens, isAdmin) {
  if (_fogPending) return;
  _fogPending = true;
  requestAnimationFrame(() => { _fogPending = false; fogUpdate(page, tokens, isAdmin); });
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDU DES MURS (layer walls)
// ═══════════════════════════════════════════════════════════════════════════════

export function fogRenderWalls(page, isAdmin) {
  if (!_wallsLayer || !page) return;
  _page = page; // toujours synchronisé
  _wallsLayer.destroyChildren();
  const K = window.Konva;
  if (!K) return;

  const C = _CELL;
  const walls  = page.walls        || [];
  const lights = page.lightSources || [];

  // ── Murs / portes / fenêtres ──────────────────────────────────────────────
  for (const w of walls) {
    const baseCol = WALL_COLOR[w.type] || WALL_COLOR.wall;
    const drawCol = (_editMode && isAdmin) ? (EDIT_COLOR[w.type] || EDIT_COLOR.wall) : baseCol;
    const width   = WALL_W[w.type] || 3;
    const pts     = [w.x1*C, w.y1*C, w.x2*C, w.y2*C];

    // Ligne du segment
    const line = new K.Line({
      points:      pts,
      stroke:      w.type === 'door' && w.open ? drawCol + '55' : drawCol,
      strokeWidth: _selectedId === w.id ? width + 2 : width,
      lineCap:     'round',
      dash:        w.type === 'window' ? [8, 5] : [],
      listening:   false,
    });
    _wallsLayer.add(line);

    // Porte ou fenêtre : pastille centrale cliquable
    if (w.type === 'door' || w.type === 'window') {
      const mx = (w.x1 + w.x2) * 0.5 * C;
      const my = (w.y1 + w.y2) * 0.5 * C;
      // Porte : rouge/vert. Fenêtre : bleu clair/vert, verrouillée = rouge.
      const dotCol = w.locked ? '#e53e3e'
        : w.open ? '#48bb78'
        : (w.type === 'window' ? '#38bdf8' : drawCol);
      const dot = new K.Circle({
        x: mx, y: my, radius: _editMode ? 8 : 6,
        fill: _selectedId === w.id ? '#fff' : dotCol,
        stroke: '#000', strokeWidth: 1,
        listening: true, id: `door-dot-${w.id}`,
      });
      dot.on('click tap', e => {
        e.cancelBubble = true;
        if (_editMode && isAdmin) { _selectItem(w.id); return; }
        _toggleDoor(w, isAdmin);
      });
      _wallsLayer.add(dot);

      // Zone de clic sur toute la ligne (en mode normal)
      if (!_editMode) {
        const hitLine = new K.Line({
          points: pts, stroke: 'transparent', strokeWidth: 12, listening: true,
        });
        hitLine.on('click tap', e => { e.cancelBubble = true; _toggleDoor(w, isAdmin); });
        _wallsLayer.add(hitLine);
      }
    }

    // Mode éditeur : clic pour sélectionner
    if (_editMode && isAdmin) {
      const hitLine = new K.Line({
        points: pts, stroke: 'transparent', strokeWidth: 14, listening: true,
      });
      hitLine.on('click tap', e => { e.cancelBubble = true; _selectItem(w.id); });
      _wallsLayer.add(hitLine);

      // Surlignage sélection
      if (_selectedId === w.id) {
        const hl = new K.Line({
          points: pts, stroke: '#fff', strokeWidth: width + 4,
          lineCap: 'round', opacity: 0.4, listening: false,
        });
        _wallsLayer.add(hl); hl.moveToBottom();
      }
    }
  }

  // ── Diagnostic des extrémités en mode édition ────────────────────────────
  // Vert = sommet partagé avec un autre mur (joint propre)
  // Jaune = sommet isolé (potentielle fuite de lumière → fermer la pièce !)
  if (_editMode && isAdmin) {
    const TOL = 0.05; // tolérance d'identification (1/20 case)
    const seen = []; // [{col, row, count}]
    const visit = (col, row) => {
      for (const s of seen) {
        if (Math.abs(s.col - col) <= TOL && Math.abs(s.row - row) <= TOL) { s.count++; return; }
      }
      seen.push({ col, row, count: 1 });
    };
    for (const w of walls) { visit(w.x1, w.y1); visit(w.x2, w.y2); }
    for (const s of seen) {
      const isolated = s.count < 2;
      _wallsLayer.add(new K.Circle({
        x: s.col * C, y: s.row * C,
        radius: isolated ? 5 : 3.5,
        fill: isolated ? '#fbbf24' : '#22c55e',
        stroke: '#000', strokeWidth: isolated ? 1 : 0.5,
        opacity: isolated ? 0.95 : 0.75,
        listening: false,
      }));
    }
  }

  // ── Sources lumineuses (MJ seulement) ────────────────────────────────────
  if (isAdmin) {
    for (const ls of lights) {
      const lx = ls.x * C, ly = ls.y * C;
      const r  = (ls.radius ?? LIGHT_DEF_R) * C;
      const sel = _selectedId === ls.id;

      _wallsLayer.add(new K.Circle({
        x: lx, y: ly, radius: r,
        stroke: sel ? '#fff' : '#fbbf24', strokeWidth: 1,
        fill: 'rgba(251,191,36,0.06)', dash: [6, 6],
        listening: false,
      }));

      const dot = new K.Circle({
        x: lx, y: ly, radius: sel ? 9 : 7,
        fill: sel ? '#fff' : '#fbbf24',
        stroke: '#000', strokeWidth: 1,
        listening: _editMode,
      });
      if (_editMode) {
        dot.on('click tap', e => { e.cancelBubble = true; _selectItem(ls.id); });
      }
      _wallsLayer.add(dot);
    }
  }

  // ── Indicateur outil courant (éditeur) ───────────────────────────────────
  if (_editMode && isAdmin) {
    _refreshWallsBar(page);
  }

  _wallsLayer.batchDraw();
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERACTION — Portes
// ═══════════════════════════════════════════════════════════════════════════════

function _toggleDoor(wall, _isAdmin) {
  if (wall.locked && !_isAdmin) { showNotif('Porte verrouillée 🔒', 'error'); return; }
  if (!_page) return;
  const ref = _pgRef(_page.id); if (!ref) return;
  const nw = (_page.walls || []).map(w => w.id === wall.id ? { ...w, open: !w.open } : w);
  updateDoc(ref, { walls: nw }).catch(() => showNotif('Erreur porte', 'error'));
}

// ═══════════════════════════════════════════════════════════════════════════════
// ÉDITEUR DE MURS
// ═══════════════════════════════════════════════════════════════════════════════

export function fogIsEditMode() { return _editMode; }

export function fogSetEditTool(tool, page) {
  _editTool   = tool;
  _selectedId = null;
  _removeCtxMenu();
  if (page) fogRenderWalls(page, true);
}

export function fogToggleEditMode(enabled, page) {
  _editMode   = enabled;
  if (page) _page = page; // synchroniser la référence
  _selectedId = null;
  _drawStart  = null;
  _removeCtxMenu();
  if (_preview) { _preview.destroy(); _preview = null; }
  if (_snapDot) { _snapDot.destroy(); _snapDot = null; }

  // Retirer les anciens listeners
  if (_stage) {
    Object.entries(_stageEvts).forEach(([ev, fn]) => _stage.off(ev, fn));
    _stageEvts = {};
  }

  if (!enabled || !_stage) return;

  // Convertir position écran → coordonnées monde Konva
  const _worldPos = () => {
    if (!_stage) return null;
    const p  = _stage.getPointerPosition(); if (!p) return null;
    const sc = _stage.scaleX(), sp = _stage.position();
    return { x: (p.x - sp.x) / sc, y: (p.y - sp.y) / sc };
  };

  // Snap dynamique selon les modificateurs clavier (lus sur l'évènement Konva)
  //   défaut : 1 case (coins de grille — propre)
  //   Alt    : 1/2 case (demi-case — ajustements fins)
  //   Shift  : 1/10 case (placement libre — précis au pixel près)
  const _snapStep = ev => {
    const e = ev?.evt || ev || {};
    if (e.shiftKey) return 0.1;
    if (e.altKey)   return 0.5;
    return 1;
  };
  const _snap = (pos, step) => ({
    col: Math.round(pos.x / _CELL / step) * step,
    row: Math.round(pos.y / _CELL / step) * step,
  });
  // Aimantation aux extrémités de murs existants (rayon = 0.35 case)
  // → assure que deux murs adjacents partagent EXACTEMENT le même point, donc l'éclairage est étanche.
  const _snapVertex = (col, row) => {
    if (!_page) return null;
    const TH = 0.35;
    for (const w of (_page.walls || [])) {
      if (Math.abs(w.x1 - col) <= TH && Math.abs(w.y1 - row) <= TH) return { col: w.x1, row: w.y1 };
      if (Math.abs(w.x2 - col) <= TH && Math.abs(w.y2 - row) <= TH) return { col: w.x2, row: w.y2 };
    }
    return null;
  };
  // Petit cercle indicateur quand on accroche un sommet (state module : _snapDot)
  const _showSnapDot = (col, row) => {
    const K = window.Konva; if (!K) return;
    if (!_snapDot) {
      _snapDot = new K.Circle({
        radius: 6, fill: '#fde047', stroke: '#000', strokeWidth: 1,
        opacity: 0.9, listening: false,
      });
      _wallsLayer?.add(_snapDot);
    }
    _snapDot.position({ x: col*_CELL, y: row*_CELL });
    _snapDot.visible(true);
  };
  const _hideSnapDot = () => { if (_snapDot) _snapDot.visible(false); };

  let _currentStep = 1; // mis à jour à mousedown, conservé pendant le drag

  const onDown = e => {
    if (e.evt?.button === 2) return; // clic-droit = pan
    const pos = _worldPos(); if (!pos) return;
    const K = window.Konva;

    _currentStep = _snapStep(e);

    if (_editTool === 'light') {
      // Lumière : même logique de snap, défaut 1/2 (centre de case)
      const step = _currentStep === 1 ? 0.5 : _currentStep;
      const s = _snap(pos, step);
      _addLightSource(s.col, s.row);
      return;
    }
    if (_editTool === 'eraser') {
      _deleteAtPos(pos);
      return;
    }

    let { col, row } = _snap(pos, _currentStep);
    const v = _snapVertex(col, row);
    if (v) { col = v.col; row = v.row; }
    _drawStart = { col, row };
    _hideSnapDot();
    _preview = new K.Line({
      points:      [col*_CELL, row*_CELL, col*_CELL, row*_CELL],
      stroke:      EDIT_COLOR[_editTool] || '#ef4444',
      strokeWidth: _editTool === 'window' ? 2 : 3,
      lineCap:     'round',
      dash:        _editTool === 'window' ? [8, 5] : [],
      listening:   false,
    });
    _wallsLayer?.add(_preview);
    _wallsLayer?.batchDraw();
  };

  const onMove = e => {
    if (!_drawStart || !_preview) {
      // Hors tracé : on indique quand même le sommet aimanté possible
      if (_editTool === 'wall' || _editTool === 'door' || _editTool === 'window') {
        const pos = _worldPos(); if (!pos) { _hideSnapDot(); _wallsLayer?.batchDraw(); return; }
        const step = _snapStep(e);
        const { col, row } = _snap(pos, step);
        const v = _snapVertex(col, row);
        if (v) _showSnapDot(v.col, v.row); else _hideSnapDot();
        _wallsLayer?.batchDraw();
      }
      return;
    }
    const pos = _worldPos(); if (!pos) return;
    _currentStep = _snapStep(e);
    let { col, row } = _snap(pos, _currentStep);
    const v = _snapVertex(col, row);
    if (v) { col = v.col; row = v.row; _showSnapDot(col, row); } else _hideSnapDot();
    _preview.points([_drawStart.col*_CELL, _drawStart.row*_CELL, col*_CELL, row*_CELL]);
    _wallsLayer?.batchDraw();
  };

  const onUp = e => {
    if (!_drawStart) return;
    const pos = _worldPos();
    if (_preview) { _preview.destroy(); _preview = null; }
    _hideSnapDot();
    if (!pos) { _drawStart = null; return; }
    _currentStep = _snapStep(e);
    let { col, row } = _snap(pos, _currentStep);
    const v = _snapVertex(col, row);
    if (v) { col = v.col; row = v.row; }
    // Éviter les segments trop courts (clic accidentel)
    const minLen = _currentStep;
    if (Math.abs(col - _drawStart.col) >= minLen * 0.5 || Math.abs(row - _drawStart.row) >= minLen * 0.5) {
      _addWall(_drawStart.col, _drawStart.row, col, row, _editTool);
    }
    _drawStart = null;
    _wallsLayer?.batchDraw();
  };

  _stageEvts = {
    mousedown: onDown, mousemove: onMove, mouseup: onUp,
    touchstart: onDown, touchmove: onMove, touchend: onUp,
  };
  Object.entries(_stageEvts).forEach(([ev, fn]) => _stage.on(ev, fn));
}

// ── Helpers éditeur ────────────────────────────────────────────────────────────

function _uid() { return Math.random().toString(36).slice(2, 10); }

function _addWall(x1, y1, x2, y2, type) {
  if (!_page) return;
  const w = { id: _uid(), x1, y1, x2, y2, type,
              ...(type === 'door' || type === 'window' ? { open: false, locked: false } : {}) };
  const ref = _pgRef(_page.id); if (!ref) return;
  // Lire les murs courants depuis _page (toujours à jour via fogSetPage)
  updateDoc(ref, { walls: [...(_page.walls || []), w] })
    .catch(() => showNotif('Erreur sauvegarde', 'error'));
}

function _addLightSource(x, y) {
  if (!_page) return;
  const ls = { id: _uid(), x, y, radius: LIGHT_DEF_R };
  const ref = _pgRef(_page.id); if (!ref) return;
  updateDoc(ref, { lightSources: [...(_page.lightSources || []), ls] })
    .catch(() => showNotif('Erreur sauvegarde', 'error'));
}

function _deleteAtPos(pos) {
  if (!_page) return;
  const C = _CELL, THRESH = C * 0.25;
  const walls  = _page.walls        || [];
  const lights = _page.lightSources || [];

  // Cherche un segment proche
  for (const w of walls) {
    const dx = w.x2-w.x1, dy = w.y2-w.y1, lenSq = (dx*dx+dy*dy)*C*C;
    if (lenSq < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((pos.x-w.x1*C)*dx*C+(pos.y-w.y1*C)*dy*C)/lenSq));
    const dist = Math.hypot(pos.x-(w.x1+t*dx)*C, pos.y-(w.y1+t*dy)*C);
    if (dist < THRESH) {
      const ref = _pgRef(_page.id); if (!ref) return;
      updateDoc(ref, { walls: walls.filter(x => x.id !== w.id) }).catch(() => {});
      return;
    }
  }
  // Cherche une source lumineuse proche
  for (const ls of lights) {
    if (Math.hypot(pos.x - ls.x*C, pos.y - ls.y*C) < THRESH) {
      const ref = _pgRef(_page.id); if (!ref) return;
      updateDoc(ref, { lightSources: lights.filter(x => x.id !== ls.id) }).catch(() => {});
      return;
    }
  }
}

function _selectItem(id) {
  if (_selectedId === id) {
    // Désélectionner → afficher menu contextuel
    _showCtxMenu(id);
  } else {
    _selectedId = id;
    _removeCtxMenu();
    fogRenderWalls(_page, true);
  }
}

// ── Menu contextuel ────────────────────────────────────────────────────────────

function _showCtxMenu(id) {
  _removeCtxMenu();
  if (!_stage || !_page) return;

  const wall  = (_page.walls        || []).find(w => w.id === id);
  const light = (_page.lightSources || []).find(l => l.id === id);
  if (!wall && !light) return;

  // Position écran
  const p  = _stage.getPointerPosition() || { x: 0, y: 0 };
  const sc = _stage.scaleX(), sp = _stage.position();
  const rect = _stage.container().getBoundingClientRect();
  const sx = p.x + rect.left;
  const sy = p.y + rect.top;

  const menu = document.createElement('div');
  menu.id = 'fog-ctx-menu';
  Object.assign(menu.style, {
    position: 'fixed', left: `${Math.min(sx+8, window.innerWidth-190)}px`,
    top: `${Math.min(sy+8, window.innerHeight-220)}px`,
    background: '#1e2030', border: '1px solid #3a3d52', borderRadius: '10px',
    padding: '.5rem', zIndex: '9999', boxShadow: '0 4px 24px rgba(0,0,0,.7)',
    display: 'flex', flexDirection: 'column', gap: '.25rem', minWidth: '168px',
    fontSize: '.8rem',
  });

  const btn = (label, fn, danger = false) => {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, {
      background: 'none', border: 'none',
      color: danger ? '#fc8181' : '#e2e8f0',
      padding: '.35rem .6rem', textAlign: 'left',
      borderRadius: '5px', cursor: 'pointer', width: '100%',
    });
    b.onmouseenter = () => b.style.background = danger ? '#7f1d1d33' : '#2d3047';
    b.onmouseleave = () => b.style.background = 'none';
    if (fn) b.onclick = () => { fn(); _removeCtxMenu(); };
    menu.appendChild(b);
    return b;
  };
  const sep = () => {
    const d = document.createElement('hr');
    Object.assign(d.style, { border: 'none', borderTop: '1px solid #3a3d52', margin: '.15rem 0' });
    menu.appendChild(d);
  };

  if (wall) {
    const TYPE = { wall: '🧱 Mur', door: '🚪 Porte', window: '🪟 Fenêtre' };
    const changeType = t => {
      if (t === wall.type) return;
      const nw = (_page?.walls||[]).map(w => w.id===id
        ? { ...w, type:t, ...(t==='door'||t==='window' ? {open:w.open??false,locked:w.locked??false} : {}) }
        : w);
      if (_page) updateDoc(_pgRef(_page.id), { walls: nw }).catch(() => {});
    };
    Object.entries(TYPE).forEach(([t, lbl]) => {
      const b = btn(lbl, () => changeType(t));
      if (t === wall.type) b.style.color = '#a78bfa';
    });
    // Porte ET fenêtre : verrouillage possible
    if (wall.type === 'door' || wall.type === 'window') {
      sep();
      btn(wall.locked ? '🔓 Déverrouiller' : '🔒 Verrouiller', () => {
        const nw = (_page?.walls||[]).map(w => w.id===id ? { ...w, locked: !w.locked } : w);
        if (_page) updateDoc(_pgRef(_page.id), { walls: nw }).catch(() => {});
      });
    }
    sep();
    btn('🗑 Supprimer', () => {
      if (_page) updateDoc(_pgRef(_page.id), { walls: (_page.walls||[]).filter(w=>w.id!==id) }).catch(()=>{});
      _selectedId = null;
    }, true);
  }

  if (light) {
    const row = document.createElement('div');
    Object.assign(row.style, { display:'flex', alignItems:'center', gap:'.4rem', padding:'.35rem .6rem' });
    row.innerHTML = `<span style="color:#e2e8f0">Rayon</span>
      <input type="number" value="${light.radius ?? LIGHT_DEF_R}" min="1" max="40"
        style="width:50px;background:#2d3047;border:1px solid #4a5568;border-radius:5px;
               color:#e2e8f0;padding:.2rem .4rem;font-size:.8rem">
      <span style="color:#9ca3af;font-size:.72rem">cases</span>`;
    const inp = row.querySelector('input');
    inp.onchange = () => {
      const r = Math.max(1, Math.min(40, parseInt(inp.value)||LIGHT_DEF_R));
      const nls = (_page?.lightSources||[]).map(l => l.id===id ? {...l,radius:r} : l);
      if (_page) updateDoc(_pgRef(_page.id), { lightSources: nls }).catch(()=>{});
    };
    menu.appendChild(row);
    sep();
    btn('🗑 Supprimer', () => {
      if (_page) updateDoc(_pgRef(_page.id), { lightSources: (_page.lightSources||[]).filter(l=>l.id!==id) }).catch(()=>{});
      _selectedId = null;
    }, true);
  }

  sep();
  btn('✕ Fermer', () => { _selectedId = null; if (_page) fogRenderWalls(_page, true); });

  document.body.appendChild(menu);
  _ctxMenu = menu;

  // Fermeture au clic extérieur
  const onOuter = e => {
    if (!menu.contains(e.target)) { _removeCtxMenu(); document.removeEventListener('mousedown', onOuter); }
  };
  setTimeout(() => document.addEventListener('mousedown', onOuter), 10);
}

function _removeCtxMenu() {
  if (_ctxMenu) { _ctxMenu.remove(); _ctxMenu = null; }
}

// ── Barre d'outils de l'éditeur (dans le DOM) ──────────────────────────────────

function _refreshWallsBar(page) {
  const bar = document.getElementById('vtt-walls-bar');
  if (!bar) return;
  const fogOn = page?.fogEnabled ?? false;
  bar.querySelectorAll('[data-fog-tool]').forEach(b => {
    b.classList.toggle('active', b.dataset.fogTool === _editTool);
  });
  const fogBtn = bar.querySelector('#vtt-fog-toggle');
  if (fogBtn) {
    fogBtn.textContent = fogOn ? '👁 Éclairage ON' : '👁 Éclairage OFF';
    fogBtn.style.color = fogOn ? '#4ade80' : '#9ca3af';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCAGE DE DÉPLACEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Renvoie true si un mur solide (mur ou porte fermée) bloque le chemin
 * d'un token entre deux cases.
 */
export function fogWallBlocksPath(fromC, fromR, toC, toR, walls) {
  if (!walls?.length) return false;
  const C = _CELL;
  const x1 = (fromC + 0.5)*C, y1 = (fromR + 0.5)*C;
  const x2 = (toC   + 0.5)*C, y2 = (toR   + 0.5)*C;
  return walls.some(w => {
    if (w.type === 'door'   && w.open)  return false; // porte ouverte   = libre
    if (w.type === 'window' && w.open)  return false; // fenêtre ouverte = libre
    return _segsSect(x1, y1, x2, y2, w.x1*C, w.y1*C, w.x2*C, w.y2*C);
  });
}
