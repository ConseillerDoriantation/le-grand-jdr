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
import { CELL, TYPE_COLOR, hpColor } from './vtt-constants.js';
import { STATE } from '../../core/state.js';
import { updateDoc } from '../../config/firebase.js';
import { normalizeImageUrl } from '../../shared/html.js';
import { githubRawUrl } from '../../shared/github-folder.js';
import { _pgRef } from './vtt-refs.js';
import { _showCtxMenu } from './vtt-utils.js';
import { showNotif } from '../../shared/notifications.js';

function _resolveMapImageUrl(url) {
  const raw = String(url || '').trim();
  if (/^\.?\/?images\/maps\//i.test(raw)) return githubRawUrl(raw);
  return normalizeImageUrl(raw);
}

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

// ── Construction visuelle d'un token (Konva) ─────────────────────────────────
// Partie PURE-RENDU de _buildShape : forme, anneaux sél/atk, barres HP/PM, badges
// CA/états/buffs, nom, portrait clippé. AUCUN handler d'interaction (ceux-ci
// restent dans vtt.js, attachés au groupe retourné). `ld` = données effectives
// (calculées par _live côté vtt.js), `condById` = index des conditions.
export function _buildTokenVisual(t, ld, condById) {
  const K  = window.Konva;
  const sw = ld.displayTokenW || 1, sh = ld.displayTokenH || 1;
  // Rayons ellipse (proportionnels à la bounding box) ; r = rayon vertical, sert d'ancre Y aux barres.
  const rx = CELL*sw*0.42, ry = CELL*sh*0.42, r = ry, bW = CELL*sw*0.9;
  const hpKnown = ld.displayHp !== null && ld.displayHpMax !== null;
  const hp  = hpKnown ? ld.displayHp  : 0;
  const hpm = hpKnown ? ld.displayHpMax : 1;
  const rat = hpKnown ? (hpm>0 ? Math.min(1, Math.max(0,hp/hpm)) : 1) : 0.5;
  const g = new K.Group({ x:t.col*CELL+sw*CELL/2, y:t.row*CELL+sh*CELL/2, id:`tok-${t.id}` });
  g.setAttr('tokenW', sw);
  g.setAttr('tokenH', sh);
  g.setAttr('displayImage', ld.displayImage || null);
  // ── Forme de base (ellipse, équivalente à un cercle quand W===H) ──
  g.add(new K.Ellipse({ radiusX:rx, radiusY:ry, fill:TYPE_COLOR[t.type]??'#888', opacity:.9 }));
  // ── Anneaux sélection / attaque ───────────────────────────────────
  g.add(new K.Ellipse({ radiusX:rx+4, radiusY:ry+4, stroke:'#fff',    strokeWidth:3, fill:'transparent',visible:false,name:'sel' }));
  g.add(new K.Ellipse({ radiusX:rx+4, radiusY:ry+4, stroke:'#ef4444', strokeWidth:3, dash:[5,3],fill:'transparent',visible:false,name:'atk' }));
  // ── Barre HP (texte superposé sur la barre) ───────────────────────
  const BH=9; // hauteur barre HP
  g.add(new K.Rect({ x:-bW/2, y:r+4, width:bW, height:BH, fill:'#0d1117', cornerRadius:4, listening:false }));
  g.add(new K.Rect({ x:-bW/2, y:r+4, width:Math.max(2,bW*rat), height:BH, fill:hpKnown?hpColor(rat):'#555', cornerRadius:4, listening:false, name:'hp-fill' }));
  g.add(new K.Text({ x:-bW/2, y:r+4, width:bW, height:BH, align:'center', verticalAlign:'middle',
    text:hpKnown?`${hp}/${hpm}`:'?/?', fontSize:8, fontStyle:'bold', fill:'#fff',
    shadowColor:'#000', shadowBlur:2, shadowOpacity:.9,
    fontFamily:'Inter,sans-serif', listening:false, name:'hp-val' }));
  // ── Barre PM (joueurs + PNJ avec PM renseignés, texte superposé) ──
  const _pm0=ld.displayPm;
  let _lblY=r+BH+8;
  if (_pm0!=null || ld.hasMana) {
    const _pmKnown = _pm0!=null;
    const pmMax0=ld.displayPmMax??1, pmRat0=_pmKnown&&pmMax0>0?Math.min(1,Math.max(0,_pm0/pmMax0)):(_pmKnown?1:0);
    const PMH=8;
    g.add(new K.Rect({ x:-bW/2, y:r+BH+6, width:bW, height:PMH, fill:'#0d1117', cornerRadius:4, listening:false }));
    g.add(new K.Rect({ x:-bW/2, y:r+BH+6, width:Math.max(2,bW*pmRat0), height:PMH, fill:_pmKnown?'#9b6dff':'#555', cornerRadius:4, listening:false, name:'pm-fill' }));
    g.add(new K.Text({ x:-bW/2, y:r+BH+6, width:bW, height:PMH, align:'center', verticalAlign:'middle',
      text:_pmKnown?`✨${_pm0}/${pmMax0}`:'✨?', fontSize:7, fontStyle:'bold', fill:'#fff',
      shadowColor:'#000', shadowBlur:2, shadowOpacity:.9,
      fontFamily:'Inter,sans-serif', listening:false, name:'pm-val' }));
    _lblY=r+BH+PMH+10;
  }
  // ── Badge CA (coin haut-droit) + indicateur buff ─────────────────
  const _buff = ld._activeCaBuff;
  const _buffed = !!_buff;
  const _round  = VS.session?.combat?.round ?? 0;
  const _toursLeft = _buff
    ? (_buff.expiresAtRound != null && _round > 0 ? _buff.expiresAtRound - _round + 1 : _buff.totalDuration ?? '∞')
    : null;
  const _caX = rx*.7, _caY = -ry*.7;
  g.add(new K.Circle({ x:_caX, y:_caY, radius:10,
    fill: _buffed ? 'rgba(30,27,80,0.95)' : 'rgba(15,15,25,0.9)',
    stroke: _buffed ? '#818cf8' : '#64748b',
    strokeWidth: _buffed ? 2.5 : 1.5,
    listening:false, name:'ca-bg' }));
  g.add(new K.Text({ x:_caX-10, y:_caY-6, width:20, height:12,
    text:`🛡${ld.caBadge ?? (ld.displayDefense??0)}`, fontSize:9, fontStyle:'bold',
    fill: _buffed ? '#c4b5fd' : '#e2e8f0',
    fontFamily:'Inter,sans-serif', align:'center', listening:false, name:'ca-lbl' }));
  if (_buffed) {
    g.add(new K.Text({ x:_caX-10, y:_caY+5, width:20, height:9,
      text:`${_toursLeft}↺`, fontSize:7, fontStyle:'bold',
      fill:'#818cf8', fontFamily:'Inter,sans-serif', align:'center', listening:false, name:'ca-buff-turns' }));
  }
  // ── Badges d'états (conditions / debuffs) — top-left du token ──────────────
  const _condRound = VS.session?.combat?.round ?? 0;
  const _activeConditions = (t.conditions || []).filter(c =>
    c.expiresAtRound == null || _condRound === 0 || _condRound <= c.expiresAtRound
  );
  if (_activeConditions.length) {
    const maxShow = 4;
    const display = _activeConditions.slice(0, maxShow);
    const overflow = _activeConditions.length - display.length;
    display.forEach((cond, i) => {
      const lib = condById[cond.id] || { icon: '❓', color: '#888' };
      const cx = -rx*.7;
      const cy = -ry*.7 + i * 20;
      g.add(new K.Circle({ x:cx, y:cy, radius:10,
        fill: lib.color, stroke: '#000', strokeWidth: 1.2,
        listening:false, name:'cond-bg' }));
      g.add(new K.Text({ x:cx-10, y:cy-7, width:20, height:14,
        text: lib.icon, fontSize:11, fontStyle:'bold',
        fontFamily:'Inter,sans-serif', align:'center', verticalAlign:'middle',
        listening:false, name:'cond-ic' }));
    });
    if (overflow > 0) {
      const cx = -rx*.7, cy = -ry*.7 + maxShow * 20;
      g.add(new K.Circle({ x:cx, y:cy, radius:10,
        fill: '#374151', stroke: '#000', strokeWidth: 1.2, listening:false }));
      g.add(new K.Text({ x:cx-10, y:cy-6, width:20, height:12,
        text: `+${overflow}`, fontSize:9, fontStyle:'bold',
        fill:'#fff', fontFamily:'Inter,sans-serif', align:'center', listening:false }));
    }
  }

  // ── Badges de buffs/debuffs (DoT, enchant, CA bonus…) — top-right du token ──
  // Affiché en miroir des états : permet de voir d'un coup d'œil les effets actifs
  // qui ne sont pas des conditions D&D (enchant arme, DoT, bouclier, etc.)
  const _buffsRound = VS.session?.combat?.round ?? 0;
  const _BUFF_VIZ = {
    dot:             { icon:'🩸', color:'#dc2626' }, // DoT (debuff)
    dmg_bonus:       { icon:'⚔️', color:'#f59e0b' }, // enchant arme alliée
    move_bonus:      { icon:'👢', color:'#22c55e' }, // mouvement +
    move_debuff:     { icon:'👢', color:'#7c2d12' }, // mouvement −
    range_bonus:     { icon:'🏹', color:'#0ea5e9' }, // portée +
    toucher_bonus:   { icon:'🎯', color:'#e8b84b' }, // toucher + (enchant)
    ca:              { icon:'🛡', color:'#06b6d4' }, // bonus CA
    shield_reactive: { icon:'🛡', color:'#a78bfa' }, // bouclier réactif
    enchantment:     { icon:'✨', color:'#e8b84b' }, // enchant générique
    affliction:      { icon:'💀', color:'#8b5cf6' }, // affliction générique
    weapon_replace:  { icon:'🔮', color:'#a78bfa' }, // arme invoquée
  };
  const _activeBuffs = (t.buffs || []).filter(b =>
    b.expiresAtRound == null || _buffsRound === 0 || _buffsRound <= b.expiresAtRound
  );
  if (_activeBuffs.length) {
    const maxShow = 4;
    const display = _activeBuffs.slice(0, maxShow);
    const overflow = _activeBuffs.length - display.length;
    display.forEach((bf, i) => {
      const viz = _BUFF_VIZ[bf.type] || { icon: bf.icon || '✨', color: '#9ca3af' };
      const cx = rx*.7;
      const cy = -ry*.7 + i * 20;
      g.add(new K.Circle({ x:cx, y:cy, radius:10,
        fill: viz.color, stroke: '#000', strokeWidth: 1.2,
        listening:false, name:'buff-bg' }));
      g.add(new K.Text({ x:cx-10, y:cy-7, width:20, height:14,
        text: viz.icon, fontSize:11, fontStyle:'bold',
        fontFamily:'Inter,sans-serif', align:'center', verticalAlign:'middle',
        listening:false, name:'buff-ic' }));
    });
    if (overflow > 0) {
      const cx = rx*.7, cy = -ry*.7 + maxShow * 20;
      g.add(new K.Circle({ x:cx, y:cy, radius:10,
        fill: '#374151', stroke: '#000', strokeWidth: 1.2, listening:false }));
      g.add(new K.Text({ x:cx-10, y:cy-6, width:20, height:12,
        text: `+${overflow}`, fontSize:9, fontStyle:'bold',
        fill:'#fff', fontFamily:'Inter,sans-serif', align:'center', listening:false }));
    }
  }
  // ── Nom ───────────────────────────────────────────────────────────
  // listening:false → le label ne capte pas les clics : ils traversent vers le
  // token situé en dessous (évite de se cibler soi-même quand le nom déborde
  // au-dessus du token d'une cible).
  g.add(new K.Text({ text:ld.displayName??t.name, x:-bW/2, y:_lblY,
    width:bW, align:'center', fontSize:11, fontStyle:'bold', fill:'#fff',
    fontFamily:'Inter,sans-serif', name:'lbl', listening:false,
    shadowColor:'#000', shadowBlur:4, shadowOpacity:1 }));

  // ── Image clippée à l'ellipse (équivalent cercle quand W===H) ─────
  const imgSrc = ld.displayImage;
  if (imgSrc) {
    const clipGrp = new K.Group({ clipFunc: ctx => { ctx.ellipse(0,0,rx,ry,0,0,Math.PI*2,false); }, listening:false });
    const el=new Image(); el.crossOrigin='anonymous';
    el.onload = () => {
      clipGrp.add(new K.Image({ image:el, x:-rx, y:-ry, width:rx*2, height:ry*2, listening:false }));
      clipGrp.zIndex(2); VS.layers.token.batchDraw();
    };
    el.src = imgSrc;
    g.add(clipGrp); clipGrp.zIndex(2);
  }
  return g;
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
    // Auto-répare les URLs GitHub/anciennes entrées `images/maps/...`.
    el.src = _resolveMapImageUrl(img.url);
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

// ── Construction visuelle d'une annotation (dessin libre / ligne / rect / cercle) ──
// Partie PURE-RENDU : shape Konva à partir des données (K + data). Les handlers
// d'édition (sélection/drag/transform) restent dans vtt.js (cluster annotations).
export function _buildAnnotVisual(K, data) {
  const col  = data.color || '#ef4444';
  const fill = data.fill ? col + '30' : 'transparent';
  // listening sera ajusté par _updateAnnotDraggable selon l'outil et la propriété
  const base = { stroke: col, strokeWidth: data.strokeWidth || 2,
    lineCap:'round', lineJoin:'round', name:'annot', listening: false,
    // Zone de clic/gomme élargie : un trait fin (2px) reste facile à sélectionner/effacer.
    hitStrokeWidth: Math.max(16, (data.strokeWidth || 2) + 12) };
  let shape;
  if (data.type === 'freehand' || data.type === 'line') {
    shape = new K.Line({ ...base, points: data.points || [],
      x: data.offsetX||0, y: data.offsetY||0,
      tension: data.type === 'freehand' ? 0.3 : 0, fill:'transparent' });
  } else if (data.type === 'polygon') {
    // Forme tracée sommet par sommet (triangle, etc.) → ligne fermée + remplissage opt.
    shape = new K.Line({ ...base, points: data.points || [],
      x: data.offsetX||0, y: data.offsetY||0, closed: true, fill });
  } else if (data.type === 'spellzone') {
    // Zone de sort persistante (utilitaire) : rectangle pointillé teinté + label,
    // visible de tous, posé au centre (x,y). Auto-supprimé à expiration (par round).
    const zw = data.w || CELL, zh = data.h || CELL;
    const g = new K.Group({ name: 'annot', listening: false });
    const _zsw = data.strokeWidth || 2;
    if (data.shape === 'cross') {
      // Croix : barre verticale (1 case × hauteur) + barre horizontale (largeur × 1 case).
      g.add(new K.Rect({ x: -CELL / 2, y: -zh / 2, width: CELL, height: zh,
        fill: col + '24', stroke: col, strokeWidth: _zsw, dash: [10, 6], hitStrokeWidth: 0, listening: true }));
      g.add(new K.Rect({ x: -zw / 2, y: -CELL / 2, width: zw, height: CELL,
        fill: col + '24', stroke: col, strokeWidth: _zsw, dash: [10, 6], hitStrokeWidth: 0, listening: true }));
    } else if (data.shape === 'diamond') {
      g.add(new K.Line({
        points: [0, -zh / 2, zw / 2, 0, 0, zh / 2, -zw / 2, 0],
        closed: true, fill: col + '24', stroke: col, strokeWidth: _zsw,
        dash: [10, 6], hitStrokeWidth: 0, listening: true,
      }));
    } else {
      g.add(new K.Rect({ x: 0, y: 0, width: zw, height: zh, offsetX: zw / 2, offsetY: zh / 2,
        fill: col + '24', stroke: col, strokeWidth: _zsw, dash: [10, 6], cornerRadius: 4,
        hitStrokeWidth: 0, listening: true }));
    }
    if (data.label) {
      g.add(new K.Text({ text: `${data.icon ? data.icon + ' ' : ''}${data.label}`,
        fontSize: 13, fontStyle: 'bold', fill: '#fff', align: 'center',
        width: zw, offsetX: zw / 2, offsetY: zh / 2 + 18,
        shadowColor: '#000', shadowBlur: 4, shadowOpacity: 0.9, listening: false }));
    }
    g.position({ x: data.x || 0, y: data.y || 0 });
    shape = g;
  } else if (data.type === 'rect') {
    const rw = data.w||10, rh = data.h||10;
    shape = new K.Rect({ ...base, x:data.x||0, y:data.y||0,
      width:rw, height:rh, fill, cornerRadius:3,
      // centered:true = x,y est le centre → offsetX/Y pour pivoter sur place
      ...(data.centered ? { offsetX: rw/2, offsetY: rh/2 } : {}) });
  } else if (data.type === 'circle') {
    shape = new K.Circle({ ...base, x:data.x||0, y:data.y||0, radius:data.r||10, fill });
  }
  if (!shape) return null;
  shape._annotId = data.id;
  // Restaurer rotation / scale sauvegardés
  if (data.rotation) shape.rotation(data.rotation);
  if (data.scaleX)   shape.scaleX(data.scaleX);
  if (data.scaleY)   shape.scaleY(data.scaleY);
  return shape;
}
