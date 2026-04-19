// ═══════════════════════════════════════════════════════════════════
// VTT — Table de Jeu Virtuelle
//
// PRINCIPE : chaque personnage ET chaque PNJ possède déjà son token.
// Pas de création manuelle — les tokens sont auto-générés et resten
// en sync bidirectionnel avec les fiches (HP, nom, photo).
// ═══════════════════════════════════════════════════════════════════

import { STATE } from '../core/state.js';
import { getCurrentAdventureId } from '../data/firestore.js';
import {
  db, doc, collection, addDoc, updateDoc, deleteDoc,
  setDoc, onSnapshot, serverTimestamp, writeBatch,
} from '../config/firebase.js';
import { getMod, calcVitesse, calcCA, calcPVMax, calcPMMax } from '../shared/char-stats.js';
import { showNotif } from '../shared/notifications.js';
import { openModal, closeModalDirect, confirmModal } from '../shared/modal.js';
import PAGES from './pages.js';

// ── Constantes ──────────────────────────────────────────────────────
const CELL        = 70;
const MIN_SCALE   = 0.15;
const MAX_SCALE   = 4;
const THROTTLE_MS = 100;

const TYPE_COLOR  = { player:'#4f8cff', enemy:'#ef4444', npc:'#a78bfa' };
const hpColor     = r => r > 0.5 ? '#22c38e' : r > 0.25 ? '#f59e0b' : '#ef4444';

// ── État module ─────────────────────────────────────────────────────
let _stage   = null, _layers = {}, _unsubs = [], _resizeObs = null;
let _session = {}, _pages = {}, _tokens = {};
let _characters = {};   // characterId → character doc
let _npcs       = {};   // npcId → npc doc
let _bestiary   = {};   // beastId → creature doc (bestiaire)
let _activePage = null;
let _tool       = 'select';
let _selected   = null, _attackSrc = null, _moveHL = [], _lastDrag = 0;
let _selectedMulti  = new Set();   // ids des tokens en multi-sélection
let _multiDragOrigin= null;        // { [id]: {x,y} } positions au début du drag groupé
let _autoSyncDone = false;   // empêche la double-création de tokens
let _imgTr      = null;      // Transformer pour images BG (sous tokens)
let _imgTrFg    = null;      // Transformer pour images FG (au-dessus des tokens)
let _selImg     = null;      // id de l'image sélectionnée
let _mapMode    = false;     // true = édition carte activée (images déplaçables)

// ── Refs Firestore ──────────────────────────────────────────────────
const _aid     = ()   => getCurrentAdventureId();
const _sesRef  = ()   => doc(db,  `adventures/${_aid()}/vtt/session`);
const _pgsCol  = ()   => collection(db, `adventures/${_aid()}/vttPages`);
const _toksCol = ()   => collection(db, `adventures/${_aid()}/vttTokens`);
const _chrsCol = ()   => collection(db, `adventures/${_aid()}/characters`);
const _npcsCol = ()   => collection(db, `adventures/${_aid()}/npcs`);
const _pgRef   = (id) => doc(db, `adventures/${_aid()}/vttPages/${id}`);
const _tokRef  = (id) => doc(db, `adventures/${_aid()}/vttTokens/${id}`);
const _chrRef  = (id) => doc(db, `adventures/${_aid()}/characters/${id}`);
const _npcRef  = (id) => doc(db, `adventures/${_aid()}/npcs/${id}`);
const _bstCol  = ()   => collection(db, `adventures/${_aid()}/bestiary`);
const _bstRef  = (id) => doc(db, `adventures/${_aid()}/bestiary/${id}`);
const _logCol  = ()   => collection(db, `adventures/${_aid()}/vttLog`);

// ═══════════════════════════════════════════════════════════════════
// DONNÉES EFFECTIVES — fusion token + entité liée
// C'est ici que la sync temps réel prend tout son sens :
// HP/nom/image viennent toujours de la fiche source.
// ═══════════════════════════════════════════════════════════════════
function _live(t) {
  if (!t) return null;
  const c = t.characterId ? _characters[t.characterId] : null;
  const n = t.npcId       ? _npcs[t.npcId]             : null;
  const b = t.beastId     ? _bestiary[t.beastId]       : null;
  const e = c || n || b;

  if (!e) return {
    ...t,
    displayName:     t.name,
    displayImage:    t.imageUrl ?? null,
    displayHp:       t.hp    ?? 20,
    displayHpMax:    t.hpMax ?? 20,
    displayMovement: t.movement ?? 6,
    displayAttack:   t.attack   ?? 5,
    displayAttackDice: t.attackDice || '1d6',
    displayDefense:  t.defense  ?? 0,
    displayRange:    t.range    ?? 1,
  };

  const hpMax = c ? (calcPVMax(c) || c.pvBase || 20)
              : b ? (parseInt(b.pvMax) || 20)
              : (e.hpMax || e.pvMax || e.pv || 20);

  // Pour les créatures du bestiaire : HP suivi sur le TOKEN (pas sur la fiche template)
  const hpCurrent = c ? (c.hp ?? hpMax)
                  : n ? (n.hp ?? hpMax)
                  : (t.hp ?? hpMax); // bestiaire + tokens custom

  // Formule de dégâts : arme équipée > première attaque bestiary > override token > fallback
  const weapon    = c?.equipement?.['Main principale'];
  const weapStat  = (weapon?.degatsStats?.[0] || weapon?.degatsStat || 'force');
  const weapMod   = c ? getMod(c, weapStat) : 0;
  const weapDice  = weapon?.degats
    ? (weapMod !== 0 ? `${weapon.degats}${weapMod>0?'+':''}${weapMod}` : weapon.degats)
    : null;
  const beastDice = b?.attaques?.[0]?.degats || null;
  const atkDice   = t.attackDice || weapDice || beastDice
    || (c ? `1d6${weapMod>=0?'+':''}${weapMod}` : null)
    || (typeof t.attack==='string' ? t.attack : null)
    || '1d6';

  return {
    ...t,
    // Ennemis : le nom du token (instance) prime sur le nom générique du bestiaire
    // Joueurs/PNJ : le nom de la fiche prime (toujours à jour)
    displayName:       b ? (t.name || b.nom) : (e.nom || t.name),
    displayImage:      e.photoURL || e.photo || e.avatar || e.imageUrl || t.imageUrl || null,
    displayHp:         e.hp  ?? t.hp  ?? hpMax,
    displayHp:         hpCurrent,
    displayHpMax:      hpMax,
    displayPm:         c ? (c.pm ?? calcPMMax(c)) : null,
    displayPmMax:      c ? calcPMMax(c) : null,
    displayMovement:   t.movement ?? (c ? calcVitesse(c) : (b ? (parseInt(b.vitesse)||4) : (e.vitesse || e.deplacement || 6))),
    displayAttack:     t.attack   ?? (c ? 5+getMod(c,'force') : (b ? (parseInt(b.attaques?.[0]?.toucher)||5) : (e.bonusAttaque||e.attack||5))),
    displayAttackDice: atkDice,
    displayDefense:    t.defense  ?? (c ? calcCA(c) : (b ? (parseInt(b.ca)||10) : (e.ca||e.defense||0))),
    // Pour un perso : arme équipée > override admin (t.range > 1) > défaut 1
    // Pour bestiaire/custom : t.range > 1ère attaque bestiary > défaut 1
    displayRange: c
      ? (t.range > 1 ? t.range : (weapon?.portee ? parseInt(weapon.portee)||1 : 1))
      : (t.range ?? (b ? parseInt(b.attaques?.[0]?.portee)||1 : 1)),
    _beast:            b,   // référence directe pour _buildAttackOptions
  };
}

// HP écrit sur la fiche source (bidirectionnel)
async function _setHp(t, newHp) {
  const v = Math.max(0, newHp);
  if (t.characterId) await updateDoc(_chrRef(t.characterId), { hp: v });
  else if (t.npcId)  await updateDoc(_npcRef(t.npcId),       { hp: v });
  else               await updateDoc(_tokRef(t.id),          { hp: v });
}

// ═══════════════════════════════════════════════════════════════════
// AUTO-SYNC TOKENS — crée les tokens manquants pour persos et PNJ
// ═══════════════════════════════════════════════════════════════════
let _charsReady = false, _npcsReady = false, _toksReady = false, _bstsReady = false;

function _maybeSyncAutoTokens() {
  if (!STATE.isAdmin || _autoSyncDone) return;
  if (!_charsReady || !_npcsReady || !_toksReady || !_bstsReady) return;
  _autoSyncDone = true;
  _syncAutoTokens();
}

async function _syncAutoTokens() {
  // Index des entités déjà tokenisées
  const byChar  = new Set();
  const byNpc   = new Set();
  const byBeast = new Set();
  for (const { data } of Object.values(_tokens)) {
    if (data.characterId) byChar.add(data.characterId);
    if (data.npcId)       byNpc.add(data.npcId);
    if (data.beastId)     byBeast.add(data.beastId);
  }

  const toCreate = [];

  for (const c of Object.values(_characters)) {
    if (!byChar.has(c.id)) toCreate.push({
      name: c.nom || 'Personnage', type: 'player',
      characterId: c.id, npcId: null, beastId: null, ownerId: c.uid || null,
    });
  }
  for (const n of Object.values(_npcs)) {
    if (!byNpc.has(n.id)) toCreate.push({
      name: n.nom || 'PNJ', type: 'npc',
      characterId: null, npcId: n.id, beastId: null, ownerId: null,
    });
  }
  // Les ennemis ne sont PAS auto-créés depuis le bestiaire :
  // ils sont placés manuellement depuis la section Bestiaire du tray.

  if (!toCreate.length) return;

  // Batch write pour limiter les appels
  const batch = writeBatch(db);
  for (const base of toCreate) {
    const ref = doc(_toksCol());
    batch.set(ref, {
      ...base,
      pageId: null, col: 0, row: 0,
      visible: false, imageUrl: null,
      movement: null, range: 1, attack: null, defense: null,
      hp: null, hpMax: null,
      movedThisTurn: false, attackedThisTurn: false,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit().catch(e => console.error('[vtt] auto-sync tokens:', e));
}

// ═══════════════════════════════════════════════════════════════════
// KONVA — chargement dynamique CDN
// ═══════════════════════════════════════════════════════════════════
async function _loadKonva() {
  if (window.Konva) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/konva@9.3.18/konva.min.js';
    s.onload = res; s.onerror = () => rej(new Error('Konva.js introuvable'));
    document.head.appendChild(s);
  });
}

// ═══════════════════════════════════════════════════════════════════
// NETTOYAGE
// ═══════════════════════════════════════════════════════════════════
function _cleanup() {
  _unsubs.forEach(u => u?.());
  _unsubs = []; _stage?.destroy(); _stage = null; _layers = {};
  _resizeObs?.disconnect(); _resizeObs = null;
  _tokens = {}; _pages = {}; _characters = {}; _npcs = {}; _bestiary = {};
  _session = {}; _activePage = null; _selected = null; _attackSrc = null;
  _moveHL = []; _autoSyncDone = false;
  _selectedMulti.clear(); _multiDragOrigin = null;
  _charsReady = false; _npcsReady = false; _toksReady = false; _bstsReady = false;
  _imgTr = null; _imgTrFg = null; _selImg = null; _mapMode = false;
  _hideCtxMenu();
  document.removeEventListener('keydown', _keyHandler);
  const mc = document.getElementById('main-content');
  if (mc) mc.style.overflow = '';
}

// ═══════════════════════════════════════════════════════════════════
// CANVAS
// ═══════════════════════════════════════════════════════════════════
function _initCanvas(container) {
  const K = window.Konva;
  _stage = new K.Stage({ container, width: container.clientWidth, height: container.clientHeight });
  // Ordre : bg → map (fond, sous tokens) → grid → token → mapFg (premier plan, au-dessus)
  _layers.bg    = new K.Layer({ listening: false });
  _layers.map   = new K.Layer({ listening: false }); // verrouillé par défaut
  _layers.grid  = new K.Layer({ listening: true });
  _layers.token = new K.Layer();
  _layers.mapFg = new K.Layer({ listening: false }); // 1er plan, verrouillé par défaut
  _stage.add(_layers.bg, _layers.map, _layers.grid, _layers.token, _layers.mapFg);

  // Transformers pour redimensionner les images (MJ uniquement)
  if (STATE.isAdmin) {
    const trCfg = {
      rotateEnabled: false, keepRatio: false,
      borderStroke: '#4f8cff', borderStrokeWidth: 2,
      anchorStroke: '#4f8cff', anchorFill: '#fff',
      anchorSize: 10, anchorCornerRadius: 3,
    };
    _imgTr   = new K.Transformer(trCfg); _layers.map.add(_imgTr);
    _imgTrFg = new K.Transformer(trCfg); _layers.mapFg.add(_imgTrFg);
  }

  _stage.on('wheel', e => {
    e.evt.preventDefault();
    const old = _stage.scaleX();
    const dir = e.evt.deltaY < 0 ? 1 : -1;
    const sc  = Math.min(MAX_SCALE, Math.max(MIN_SCALE, old * (1 + dir * 0.1)));
    const ptr = _stage.getPointerPosition();
    _stage.scale({ x:sc, y:sc });
    _stage.position({ x: ptr.x - (ptr.x-_stage.x())*(sc/old), y: ptr.y - (ptr.y-_stage.y())*(sc/old) });
  });

  let _pan = false, _po = null;
  _stage.on('mousedown', e => {
    if (e.evt.button===1||e.evt.button===2) {
      _pan = true; _po = { x:e.evt.clientX-_stage.x(), y:e.evt.clientY-_stage.y() };
    }
  });
  _stage.on('mousemove', e => { if (_pan) _stage.position({ x:e.evt.clientX-_po.x, y:e.evt.clientY-_po.y }); });
  _stage.on('mouseup', () => { _pan = false; });
  _stage.on('contextmenu', e => e.evt.preventDefault());
  _stage.on('click', e => { if (e.target===_stage) _deselect(); });

  _resizeObs = new ResizeObserver(() => {
    if (!_stage) return;
    _stage.width(container.clientWidth); _stage.height(container.clientHeight);
  });
  _resizeObs.observe(container);
}

function _drawGrid() {
  if (!_stage||!_activePage) return;
  const K = window.Konva;
  _layers.bg.destroyChildren();
  _layers.grid.find('Line').forEach(n=>n.destroy());
  const { cols, rows } = _activePage;
  const W=cols*CELL, H=rows*CELL;
  // Fond sur la couche bg (sous les images)
  _layers.bg.add(new K.Rect({ x:0,y:0,width:W,height:H,fill:'#12121f',listening:false }));
  _layers.bg.batchDraw();
  // Lignes de grille sur la couche grid (au-dessus des images)
  const s = { stroke:'rgba(255,255,255,0.22)',strokeWidth:1,listening:false };
  for (let c=0;c<=cols;c++) _layers.grid.add(new K.Line({ points:[c*CELL,0,c*CELL,H], ...s }));
  for (let r=0;r<=rows;r++) _layers.grid.add(new K.Line({ points:[0,r*CELL,W,r*CELL], ...s }));
  _layers.grid.batchDraw();
}

function _renderMapImages() {
  if (!_activePage) return;
  const K = window.Konva;
  // Nettoyer les images des deux couches (sans détruire les transformers)
  _layers.map.find('Image').forEach(n=>n.destroy());
  _layers.mapFg?.find('Image').forEach(n=>n.destroy());
  if (_imgTr)   { _imgTr.nodes([]);   }
  if (_imgTrFg) { _imgTrFg.nodes([]); }
  _selImg = null;

  for (const img of (_activePage.backgroundImages??[])) {
    const isFg   = img.layer === 'fg';
    const tgtLyr = isFg ? _layers.mapFg : _layers.map;
    const tr     = isFg ? _imgTrFg      : _imgTr;

    const el = new Image(); el.crossOrigin='anonymous';
    el.onload = () => {
      if (!_activePage) return; // page changée entre temps
      const ki = new K.Image({
        image:el, x:img.x*CELL, y:img.y*CELL,
        width:img.w*CELL, height:img.h*CELL,
        name:`img-${img.id}`,
      });

      if (STATE.isAdmin) {
        // Drag activé uniquement en mode édition carte
        ki.draggable(_mapMode);
        ki.on('dragmove', () => {
          ki.x(Math.round(ki.x()/CELL)*CELL);
          ki.y(Math.round(ki.y()/CELL)*CELL);
        });
        ki.on('dragend', () => {
          _patchImg(img.id, { x:Math.round(ki.x()/CELL), y:Math.round(ki.y()/CELL) });
        });

        // Clic → sélectionner l'image (seulement en mode édition carte)
        ki.on('click', e => {
          if (!_mapMode) return;
          e.cancelBubble = true;
          _tokens[_selected]?.shape?.findOne('.sel')?.visible(false);
          _selected=null; _clearHL(); _renderInspector(null); _layers.token.batchDraw();
          _selImg = img.id;
          // Vider l'autre transformer
          const otherTr = isFg ? _imgTr : _imgTrFg;
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
          if (!_mapMode) return;
          _showCtxMenu(e.evt.clientX, e.evt.clientY, [
            {
              label: isFg ? '⬇ Arrière-plan (sous les tokens)' : '⬆ Premier plan (au-dessus des tokens)',
              fn: () => _patchImg(img.id, { layer: isFg ? 'bg' : 'fg' }),
            },
            '---',
            {
              label: '🗑 Supprimer cette image',
              fn: () => {
                const imgs=(_activePage.backgroundImages??[]).filter(i=>i.id!==img.id);
                updateDoc(_pgRef(_activePage.id),{backgroundImages:imgs}).catch(()=>{});
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
async function _patchImg(imgId, patch) {
  if (!_activePage) return;
  await updateDoc(_pgRef(_activePage.id), {
    backgroundImages: (_activePage.backgroundImages??[]).map(i=>i.id===imgId?{...i,...patch}:i)
  }).catch(()=>{});
}

// ═══════════════════════════════════════════════════════════════════
// TOKENS — shapes Konva
// ═══════════════════════════════════════════════════════════════════
function _buildShape(t) {
  const K  = window.Konva;
  const ld = _live(t);
  const r  = CELL*0.42, bW = CELL*0.72;
  const hp = ld.displayHp??20, hpm = ld.displayHpMax??20;
  const rat = hpm>0 ? Math.max(0,hp/hpm) : 1;

  const g = new K.Group({ x:t.col*CELL+CELL/2, y:t.row*CELL+CELL/2, id:`tok-${t.id}` });
  g.add(new K.Circle({ radius:r, fill:TYPE_COLOR[t.type]??'#888', opacity:.9, stroke:'rgba(255,255,255,0.2)',strokeWidth:2 }));
  g.add(new K.Circle({ radius:r+7, stroke:'#fff',     strokeWidth:3, fill:'transparent',visible:false,name:'sel' }));
  g.add(new K.Circle({ radius:r+7, stroke:'#ef4444',  strokeWidth:3, dash:[5,3],fill:'transparent',visible:false,name:'atk' }));
  // ── Barre HP (texte centré sur la barre, fond opaque) ───────────
  const hpH=10, hpY=r+4;
  g.add(new K.Rect({ x:-bW/2,y:hpY,width:bW,height:hpH,fill:'rgba(0,0,0,0.75)',cornerRadius:3,name:'hp-bg' }));
  g.add(new K.Rect({ x:-bW/2,y:hpY,width:bW*rat,height:hpH,fill:hpColor(rat),cornerRadius:3,name:'hp-fill' }));
  g.add(new K.Text({ text:`${hp}/${hpm}`, x:-bW/2,y:hpY+1,
    width:bW,align:'center',fontSize:7,fontStyle:'bold',
    fill:'rgba(255,255,255,0.95)',fontFamily:'Inter,sans-serif',listening:false,name:'hp-val' }));
  // ── Barre PM (joueurs seulement) ────────────────────────────────
  const _pm0=ld.displayPm;
  let _nextY = hpY+hpH+2;
  if (_pm0!=null) {
    const pmMax0=ld.displayPmMax??1, pmRat0=pmMax0>0?Math.max(0,_pm0/pmMax0):1;
    g.add(new K.Rect({ x:-bW/2,y:_nextY,width:bW,height:8,fill:'rgba(0,0,0,0.6)',cornerRadius:2,name:'pm-bg' }));
    g.add(new K.Rect({ x:-bW/2,y:_nextY,width:bW*pmRat0,height:8,fill:'#9b6dff',cornerRadius:2,name:'pm-fill' }));
    g.add(new K.Text({ text:`✨${_pm0}/${pmMax0}`, x:-bW/2,y:_nextY+1,
      width:bW,align:'center',fontSize:7,
      fill:'rgba(210,180,255,0.95)',fontFamily:'Inter,sans-serif',listening:false,name:'pm-val' }));
    _nextY += 10;
  }
  // ── CA (fond sombre propre) ──────────────────────────────────────
  g.add(new K.Rect({ x:-bW/2,y:_nextY,width:bW,height:11,fill:'rgba(0,0,0,0.6)',cornerRadius:2,listening:false,name:'ca-bg' }));
  g.add(new K.Text({ text:`🛡${ld.displayDefense??0}`, x:-bW/2,y:_nextY+1,
    width:bW, align:'center', fontSize:8, fill:'rgba(220,220,220,0.95)',
    fontFamily:'Inter,sans-serif', listening:false, name:'ca-lbl' }));
  // ── Nom (fond sombre, séparé de la CA) ──────────────────────────
  const nameH=13, nameY=_nextY+13;
  g.add(new K.Rect({ x:-bW/2,y:nameY,width:bW,height:nameH,fill:'rgba(0,0,0,0.65)',cornerRadius:2,listening:false }));
  g.add(new K.Text({ text:ld.displayName??t.name, x:-bW/2,y:nameY+1,
    width:bW,align:'center',fontSize:10,fontStyle:'bold',fill:'#fff',
    fontFamily:'Inter,sans-serif',name:'lbl' }));

  const imgSrc = ld.displayImage;
  if (imgSrc) {
    const el=new Image(); el.crossOrigin='anonymous';
    el.onload = () => {
      const ki = new K.Image({ image:el,x:-r,y:-r,width:r*2,height:r*2,listening:false,
        clipFunc(ctx){ctx.arc(0,0,r,0,Math.PI*2,false);} });
      g.add(ki); ki.zIndex(1); _layers.token.batchDraw();
    };
    el.src = imgSrc;
  }

  const canDrag = STATE.isAdmin || t.ownerId===STATE.user?.uid;
  if (canDrag) {
    g.draggable(true);
    // ─ Début du drag : mémoriser les positions du groupe ─
    g.on('dragstart', () => {
      if (_selectedMulti.has(t.id) && _selectedMulti.size>1) {
        _multiDragOrigin={};
        for (const id of _selectedMulti) {
          const s=_tokens[id]?.shape;
          if (s) _multiDragOrigin[id]={x:s.x(),y:s.y()};
        }
      } else { _multiDragOrigin=null; }
    });
    // ─ Pendant le drag : snap + déplacer le groupe ─
    g.on('dragmove', () => {
      const sx=Math.round((g.x()-CELL/2)/CELL)*CELL+CELL/2;
      const sy=Math.round((g.y()-CELL/2)/CELL)*CELL+CELL/2;
      g.position({x:sx,y:sy});
      if (_multiDragOrigin && _selectedMulti.has(t.id)) {
        const dx=sx-_multiDragOrigin[t.id].x, dy=sy-_multiDragOrigin[t.id].y;
        for (const [id,orig] of Object.entries(_multiDragOrigin)) {
          if (id===t.id) continue;
          const s=_tokens[id]?.shape; if (!s) continue;
          s.position({
            x:Math.round((orig.x+dx-CELL/2)/CELL)*CELL+CELL/2,
            y:Math.round((orig.y+dy-CELL/2)/CELL)*CELL+CELL/2,
          });
        }
        _layers.token.batchDraw();
      }
    });
    // ─ Fin du drag : commit Firestore ─
    g.on('dragend', async () => {
      const pg=_activePage; if (!pg) return;
      if (_multiDragOrigin && _selectedMulti.has(t.id) && _selectedMulti.size>1) {
        // Batch : sauver tous les tokens du groupe
        const batch=writeBatch(db);
        for (const id of _selectedMulti) {
          const s=_tokens[id]?.shape; if (!s) continue;
          const nc=Math.max(0,Math.min(pg.cols-1,Math.round((s.x()-CELL/2)/CELL)));
          const nr=Math.max(0,Math.min(pg.rows-1,Math.round((s.y()-CELL/2)/CELL)));
          s.position({x:nc*CELL+CELL/2,y:nr*CELL+CELL/2});
          batch.update(_tokRef(id),{col:nc,row:nr});
        }
        _layers.token.batchDraw();
        await batch.commit().catch(()=>showNotif('Erreur déplacement groupe','error'));
        _multiDragOrigin=null; return;
      }
      // Token seul
      const c=Math.max(0,Math.min(pg.cols-1,Math.round((g.x()-CELL/2)/CELL)));
      const r=Math.max(0,Math.min(pg.rows-1,Math.round((g.y()-CELL/2)/CELL)));
      if (!STATE.isAdmin && _session?.combat?.active) {
        const cur=_tokens[t.id]?.data;
        if (cur) {
          const d=Math.abs(c-cur.col)+Math.abs(r-cur.row);
          if (d>(_live(cur).displayMovement??6)||cur.movedThisTurn) {
            showNotif(cur.movedThisTurn?'Déjà bougé ce tour.':'Déplacement trop loin !','error');
            g.position({x:cur.col*CELL+CELL/2,y:cur.row*CELL+CELL/2}); _layers.token.batchDraw(); return;
          }
        }
      }
      g.position({x:c*CELL+CELL/2,y:r*CELL+CELL/2}); _layers.token.batchDraw();
      const patch={col:c,row:r};
      if (!STATE.isAdmin&&_session?.combat?.active) patch.movedThisTurn=true;
      await updateDoc(_tokRef(t.id),patch).catch(()=>showNotif('Erreur déplacement','error'));
    });
  }

  g.on('click', e => {
    e.cancelBubble=true;
    if (e.evt.shiftKey && (STATE.isAdmin||t.ownerId===STATE.user?.uid)) {
      // Shift+clic : ajouter / retirer du groupe multi-sélection
      _toggleMultiSelect(t.id); return;
    }
    _clearMultiSelect();
    if (_attackSrc && _attackSrc!==t.id) {
      // Attaquant déjà désigné → clic sur une cible → lancer l'attaque
      _execAttack(_attackSrc, t.id);
    } else {
      // Sélectionner le token (si token propre, montre la portée d'attaque)
      _select(t.id);
    }
  });

  return g;
}

function _patchShape(id) {
  const e=_tokens[id]; if (!e?.shape) return;
  const ld=_live(e.data); const g=e.shape;
  g.to({ x:e.data.col*CELL+CELL/2, y:e.data.row*CELL+CELL/2, duration:0.12 });
  const hp=ld.displayHp??20, hpm=ld.displayHpMax??20;
  const rat=hpm>0?Math.max(0,hp/hpm):1, bW=CELL*0.72;
  const fill=g.findOne('.hp-fill');
  if (fill){fill.width(bW*rat);fill.fill(hpColor(rat));}
  g.findOne('.hp-val')?.text(`${hp}/${hpm}`);
  // PM
  const _pm=ld.displayPm;
  if (_pm!=null) {
    const pmMax=ld.displayPmMax??1, pmRat=pmMax>0?Math.max(0,_pm/pmMax):1;
    g.findOne('.pm-fill')?.width(bW*pmRat);
    g.findOne('.pm-val')?.text(`✨${_pm}/${pmMax}`);
  }
  g.findOne('.ca-lbl')?.text(`🛡${ld.displayDefense??0}`);
  g.findOne('.lbl')?.text(ld.displayName??e.data.name);
  g.visible(!!(e.data.visible||STATE.isAdmin));
  _layers.token?.batchDraw();
}

// ── Sélection ───────────────────────────────────────────────────────
function _select(id) {
  if (_imgTr&&_selImg) { _imgTr.nodes([]); _selImg=null; _layers.map?.batchDraw(); }
  _tokens[_selected]?.shape?.findOne('.sel')?.visible(false);
  _tokens[_attackSrc]?.shape?.findOne('.atk')?.visible(false);
  _attackSrc=null; _clearHL();
  _selected=id;
  _tokens[id]?.shape?.findOne('.sel')?.visible(true);
  _layers.token.batchDraw();
  const data=_tokens[id]?.data;
  _renderInspector(data??null);
  // Clic sur un token allié/propre : portée de déplacement (bleu) + portée d'attaque (rouge)
  if (data&&(STATE.isAdmin||data.ownerId===STATE.user?.uid)) {
    _attackSrc=id;
    _tokens[id]?.shape?.findOne('.atk')?.visible(true);
    _layers.token.batchDraw();
    _showMoveRange(data);    // cases bleues cliquables (déplacement)
    _showAttackRange(data);  // cases rouges par-dessus (visuel portée)
  }
}

function _deselect() {
  _tokens[_selected]?.shape?.findOne('.sel')?.visible(false);
  _tokens[_attackSrc]?.shape?.findOne('.atk')?.visible(false);
  _selected=null; _attackSrc=null; _clearHL(); _clearMultiSelect(); _renderInspector(null);
  if (_imgTr)   { _imgTr.nodes([]); _layers.map?.batchDraw(); }
  if (_imgTrFg) { _imgTrFg.nodes([]); _layers.mapFg?.batchDraw(); }
  _selImg=null;
  _layers.token?.batchDraw();
}

// ── Portée de mouvement ─────────────────────────────────────────────
function _showMoveRange(t) {
  _clearHL(); if (!_activePage) return;
  const K=window.Konva, ld=_live(t), mv=ld.displayMovement??6;
  const {cols,rows}=_activePage;
  const occ=new Set(Object.values(_tokens)
    .filter(e=>e.data?.pageId===_activePage.id&&e.data.id!==t.id)
    .map(e=>`${e.data.col},${e.data.row}`));
  for (let dc=-mv;dc<=mv;dc++) for (let dr=-mv;dr<=mv;dr++) {
    if (Math.abs(dc)+Math.abs(dr)>mv) continue;
    const c=t.col+dc,r=t.row+dr;
    if (c<0||r<0||c>=cols||r>=rows||(!dc&&!dr)) continue;
    const blk=occ.has(`${c},${r}`);
    const rect=new K.Rect({ x:c*CELL,y:r*CELL,width:CELL,height:CELL,
      fill:blk?'rgba(239,68,68,0.1)':'rgba(79,140,255,0.14)',
      stroke:blk?'rgba(239,68,68,0.3)':'rgba(79,140,255,0.3)',strokeWidth:1,listening:!blk });
    if (!blk){const tc=c,tr=r;rect.on('click',async e=>{e.cancelBubble=true;if(_selected)await _moveTo(_selected,tc,tr);});}
    _layers.grid.add(rect); _moveHL.push(rect);
  }
  _layers.grid.batchDraw();
}
function _clearHL() { _moveHL.forEach(r=>r.destroy()); _moveHL=[]; _layers.grid?.batchDraw(); }

// ── Multi-sélection ─────────────────────────────────────────────
function _clearMultiSelect() {
  for (const id of _selectedMulti) {
    if (id!==_selected) _tokens[id]?.shape?.findOne('.sel')?.visible(false);
  }
  _selectedMulti.clear();
  _layers.token?.batchDraw();
}

function _toggleMultiSelect(id) {
  // Inclure le token principal courant dans la multi-sélection
  if (_selected && !_selectedMulti.has(_selected)) {
    _selectedMulti.add(_selected);
    _tokens[_selected]?.shape?.findOne('.sel')?.visible(true);
  }
  if (_selectedMulti.has(id)) {
    _selectedMulti.delete(id);
    _tokens[id]?.shape?.findOne('.sel')?.visible(false);
  } else {
    _selectedMulti.add(id);
    _tokens[id]?.shape?.findOne('.sel')?.visible(true);
    _selected = id;
    _renderInspector(_tokens[id]?.data??null);
  }
  _layers.token?.batchDraw();
}

/** Surbrillance rouge des cases à portée d'attaque de t (sans clear — le caller nettoie). */
function _showAttackRange(t) {
  if (!_activePage) return;
  const K=window.Konva;
  const options=_buildAttackOptions(t);
  const maxRange=options.length?Math.max(...options.map(o=>o.portee)):(_live(t).displayRange??1);
  const {cols,rows}=_activePage;
  for (let dc=-maxRange;dc<=maxRange;dc++) for (let dr=-maxRange;dr<=maxRange;dr++) {
    if (!dc&&!dr) continue;
    if (Math.abs(dc)+Math.abs(dr)>maxRange) continue;
    const c=t.col+dc, r=t.row+dr;
    if (c<0||r<0||c>=cols||r>=rows) continue;
    const rect=new K.Rect({ x:c*CELL,y:r*CELL,width:CELL,height:CELL,
      fill:'rgba(239,68,68,0.1)', stroke:'rgba(239,68,68,0.28)', strokeWidth:1, listening:false });
    _layers.grid.add(rect); _moveHL.push(rect);
  }
  _layers.grid.batchDraw();
}
async function _moveTo(id,col,row) {
  const patch={col,row};
  if (!STATE.isAdmin&&_session?.combat?.active) patch.movedThisTurn=true;
  await updateDoc(_tokRef(id),patch).catch(()=>showNotif('Déplacement refusé','error'));
  _clearHL();
}

// ═══════════════════════════════════════════════════════════════════
// ATTAQUE — sélection arme/sort puis confirmation
// ═══════════════════════════════════════════════════════════════════

/** Parse "2d6+3", "1d8", "1d4-1" → lance et retourne le total. */
function _rollDice(formula) {
  if (!formula) return 1;
  const m = String(formula).match(/^(\d+)[dD](\d+)([+-]\d+)?$/);
  if (!m) return Math.max(1, parseInt(formula)||1);
  let total = 0;
  for (let i=0; i<parseInt(m[1]); i++) total += Math.floor(Math.random()*parseInt(m[2]))+1;
  return total + (parseInt(m[3])||0);
}

/** Construit la liste des options d'attaque pour un token (arme / attaques bestiaire / sorts). */
function _buildAttackOptions(t) {
  const ld = _live(t);
  const c  = t.characterId ? _characters[t.characterId] : null;
  const b  = ld._beast || null;
  const options = [];

  // ── Créature du bestiaire : ses attaques nommées ──
  if (b?.attaques?.length) {
    b.attaques.forEach((atk, idx) => {
      if (!atk.degats) return;
      options.push({
        id:     `beast_${idx}`,
        icon:   '👹',
        label:  atk.nom || `Attaque ${idx+1}`,
        dice:   atk.degats,
        portee: parseInt(atk.portee)||1,
        pmCost: 0,
      });
    });
    if (options.length) return options; // on utilise les attaques dédiées
  }

  // ── Arme principale du personnage (ou attaque générique) ──
  const weapon = c?.equipement?.['Main principale'];
  options.push({
    id:     'weapon',
    icon:   '⚔️',
    label:  weapon?.nom || 'Attaque de base',
    dice:   ld.displayAttackDice || '1d6',
    portee: ld.displayRange ?? 1,
    pmCost: 0,
  });

  // ── Sorts offensifs actifs du deck ──
  if (c?.deck_sorts?.length) {
    const pm       = c.pm ?? 0;
    const mainDice = ld.displayAttackDice || '1d6';
    c.deck_sorts.forEach((s, idx) => {
      if (!s.actif) return;
      if (!s.types?.includes('offensif')) return;
      const cout = parseInt(s.cout)||0;
      if (cout > pm) return;
      options.push({
        id:     `sort_${idx}`,
        icon:   '✨',
        label:  s.nom || `Sort ${idx+1}`,
        dice:   (s.degats?.trim()) || mainDice,
        portee: parseInt(s.portee)||ld.displayRange||1,
        pmCost: cout,
        sortIdx: idx,
      });
    });
  }

  return options;
}

// Cache des options d'attaque — évite tout JSON/HTML dans les onclick
const _atkOptsCache = {};

/** Affiche le modal de sélection d'attaque. */
async function _execAttack(srcId, tgtId) {
  const src=_tokens[srcId]?.data, tgt=_tokens[tgtId]?.data;
  if (!src||!tgt) return;
  const lS=_live(src), lT=_live(tgt);
  const dist=Math.max(Math.abs(src.col-tgt.col),Math.abs(src.row-tgt.row));

  const options = _buildAttackOptions(src);
  const inRange = options.filter(o => dist <= o.portee);
  if (!inRange.length) {
    showNotif(`Hors de portée (${dist} case${dist>1?'s':''}, portée max ${Math.max(...options.map(o=>o.portee))})`, 'error');
    return;
  }

  // Stocke les options dans un cache indexé — pas de JSON dans les onclick
  const cacheKey = `${srcId}__${tgtId}`;
  _atkOptsCache[cacheKey] = inRange;

  const pm = lS.displayPm, pmMax = lS.displayPmMax;
  const pmLine = (pm!=null)
    ? `<div style="font-size:.75rem;color:var(--text-dim);margin-bottom:.5rem">PM : ${pm}/${pmMax}</div>` : '';

  openModal('⚔️ Choisir une attaque', `
    <div class="vtt-form">
      <div style="font-size:.82rem;margin-bottom:.4rem">
        <strong>${lS.displayName??src.name}</strong>
        → <strong style="color:#ef4444">${lT.displayName??tgt.name}</strong>
        <span style="color:var(--text-dim);font-size:.72rem">(${dist} case${dist>1?'s':''})</span>
      </div>
      ${pmLine}
      <div class="vtt-attack-opts">
        ${inRange.map((o,i)=>`
        <button class="vtt-attack-opt" onclick="window._vttPickOpt('${srcId}','${tgtId}',${i})">
          <span class="vtt-attack-opt-icon">${o.icon}</span>
          <div class="vtt-attack-opt-body">
            <div class="vtt-attack-opt-name">${o.label}</div>
            <div class="vtt-attack-opt-meta">
              🎲 ${o.dice}
              · 🎯 portée ${o.portee}
              ${o.pmCost>0?`· <span style="color:#b47fff">✨ ${o.pmCost} PM</span>`:''}
            </div>
          </div>
        </button>`).join('')}
      </div>
      <div style="text-align:right;margin-top:.5rem">
        <button class="btn-secondary" data-action="close-modal">Annuler</button>
      </div>
    </div>`);
}

window._vttPickOpt = (srcId, tgtId, idx) => {
  const opt = _atkOptsCache[`${srcId}__${tgtId}`]?.[+idx];
  if (opt) window._vttExecWithOpt(srcId, tgtId, opt);
};

window._vttExecWithOpt = async (srcId, tgtId, opt) => {
  closeModalDirect();
  const src=_tokens[srcId]?.data, tgt=_tokens[tgtId]?.data;
  if (!src||!tgt) return;
  const lS=_live(src), lT=_live(tgt);

  const dmg    = Math.max(1, _rollDice(opt.dice));
  const curHp  = lT.displayHp??20, hpMax=lT.displayHpMax??20;
  const newHp  = Math.max(0, curHp-dmg);

  const ok = await confirmModal(
    `${opt.icon} <strong>${lS.displayName??src.name}</strong>
     utilise <strong>${opt.label}</strong><br>
     🎲 ${opt.dice} → <strong>${dmg} dégâts</strong><br>
     PV : ${curHp} → <strong>${newHp}/${hpMax}</strong>`,
    {title:`${opt.icon} ${opt.label}`, confirmLabel:'Confirmer', cancelLabel:'Annuler', danger:true}
  );
  if (!ok) return; // annulé : reste en mode attaque avec l'attaquant sélectionné

  try {
    await _setHp(tgt, newHp);
    if (opt.pmCost>0 && src.characterId) {
      const c=_characters[src.characterId];
      if (c) await updateDoc(_chrRef(src.characterId),{pm:Math.max(0,(c.pm??0)-opt.pmCost)});
    }
    if (_session?.combat?.active) await updateDoc(_tokRef(src.id),{attackedThisTurn:true}).catch(()=>{});
    // Log dans le chat
    await addDoc(_logCol(), {
      type:'roll',
      authorId: STATE.user?.uid||null,
      authorName: STATE.profile?.pseudo||STATE.profile?.prenom||STATE.user?.displayName||'MJ',
      rollFormula: opt.dice, rollResult: dmg,
      text:`${lS.displayName??src.name} attaque ${lT.displayName??tgt.name} · ${opt.label} · 🎲${opt.dice}=${dmg}`,
      createdAt: serverTimestamp(),
    }).catch(()=>{});
    showNotif(
      newHp===0 ? `💀 ${lT.displayName??tgt.name} tombe à 0 PV !`
                : `${opt.icon} ${dmg} dégâts → ${lT.displayName??tgt.name} (${newHp}/${hpMax} PV)`,
      'success'
    );
  } catch { showNotif('Erreur attaque','error'); }
  // Rester en mode attaque — effacer juste l'attaquant courant
  _tokens[srcId]?.shape?.findOne('.atk')?.visible(false);
  _tokens[_selected]?.shape?.findOne('.sel')?.visible(false);
  _selected=null; _attackSrc=null; _clearHL(); _renderInspector(null);
  _layers.token?.batchDraw();
};

// ═══════════════════════════════════════════════════════════════════
// INSPECTOR
// ═══════════════════════════════════════════════════════════════════
function _renderInspector(t) {
  const el=document.getElementById('vtt-inspector'); if (!el) return;
  // Multi-sélection active
  if (_selectedMulti.size>1) {
    const types=[..._selectedMulti].map(id=>_tokens[id]?.data?.type).filter(Boolean);
    const uniq=t=>({player:'🧑 Joueurs',enemy:'👹 Ennemis',npc:'👤 PNJ'})[t]||t;
    const typeStr=[...new Set(types)].map(uniq).join(' · ');
    el.innerHTML=`<div class="vtt-ins-multi">
      <div style="font-size:2rem;text-align:center">↖↖</div>
      <div class="vtt-ins-name" style="text-align:center">${_selectedMulti.size} tokens</div>
      <div class="vtt-ins-type" style="text-align:center">${typeStr}</div>
      <div style="font-size:.72rem;color:var(--text-dim);text-align:center;margin-top:.5rem;line-height:1.4">
        Glisse un token pour<br>déplacer tout le groupe
      </div>
    </div>`;
    return;
  }
  if (!t) { el.innerHTML=`<div class="vtt-ins-empty"><div style="font-size:1.8rem">🎲</div>Sélectionne un token</div>`; return; }
  const ld=_live(t);
  const hp=ld.displayHp??20, hpm=ld.displayHpMax??20;
  const rat=hpm>0?Math.max(0,hp/hpm):1;
  const icon={player:'🧑',enemy:'👹',npc:'👤'}[t.type]??'🎭';
  const lbl={player:'Joueur',enemy:'Ennemi',npc:'PNJ'}[t.type]??t.type;
  const img=ld.displayImage;
  const linked=t.characterId||t.npcId;

  const pageOpts=STATE.isAdmin
    ? Object.values(_pages).filter(p=>p.id!==t.pageId)
        .map(p=>`<option value="${p.id}">${p.name}</option>`).join('') : '';

  el.innerHTML=`
    <div class="vtt-ins-header">
      ${img?`<img src="${img}" class="vtt-ins-avatar" alt="">`
           :`<div class="vtt-ins-avatar-icon" style="background:${TYPE_COLOR[t.type]??'#888'}">${icon}</div>`}
      <div style="min-width:0">
        <div class="vtt-ins-name">${ld.displayName??t.name}</div>
        <div class="vtt-ins-type">${icon} ${lbl}${linked?' · 🔗':''}</div>
      </div>
    </div>
    <div class="vtt-ins-hp-wrap">
      <div class="vtt-ins-hp-bar"><div class="vtt-ins-hp-fill" style="width:${Math.round(rat*100)}%;background:${hpColor(rat)}"></div></div>
      <span class="vtt-ins-hp-pct" style="color:${hpColor(rat)}">${Math.round(rat*100)}%</span>
    </div>
    <div class="vtt-ins-stats">
      <div class="vtt-ins-stat"><span class="vtt-ins-lbl">PV</span>
        <span class="vtt-ins-val">${STATE.isAdmin
          ?`<input class="vtt-ins-input" type="number" value="${hp}" min="0" max="${hpm}" onchange="window._vttSetHp('${t.id}',+this.value)">`
          :hp} / ${hpm}</span></div>
      <div class="vtt-ins-stat"><span class="vtt-ins-lbl">🏃 Mouvement</span><span class="vtt-ins-val">${ld.displayMovement??6} cases</span></div>
      <div class="vtt-ins-stat"><span class="vtt-ins-lbl">⚔️ Attaque</span>  <span class="vtt-ins-val">${ld.displayAttack??5}</span></div>
      <div class="vtt-ins-stat"><span class="vtt-ins-lbl">🛡 CA / Défense</span><span class="vtt-ins-val">${ld.displayDefense??0}</span></div>
      <div class="vtt-ins-stat"><span class="vtt-ins-lbl">🎯 Portée</span>   <span class="vtt-ins-val">${ld.displayRange??1} case(s)</span></div>
      <div class="vtt-ins-stat"><span class="vtt-ins-lbl">📍 Position</span> <span class="vtt-ins-val">${t.pageId?`C${t.col} L${t.row}`:'Non placé'}</span></div>
      ${t.movedThisTurn    ?'<div class="vtt-ins-badge">✓ A bougé</div>'      :''}
      ${t.attackedThisTurn ?'<div class="vtt-ins-badge vtt-ins-badge-atk">✓ A attaqué</div>':''}
    </div>
    ${STATE.isAdmin&&pageOpts?`
      <div class="vtt-ins-section">
        <div class="vtt-ins-section-title">Envoyer le joueur vers</div>
        <select class="vtt-ins-select" onchange="window._vttMoveTokenToPage('${t.id}',this.value);this.value=''">
          <option value="">— choisir une page —</option>${pageOpts}
        </select>
      </div>` :''}
    ${STATE.isAdmin?`
      <div class="vtt-ins-actions">
        <button class="vtt-btn-sm" onclick="window._vttEditToken('${t.id}')" title="Modifier les stats combat">⚙️ Stats</button>
        <button class="vtt-btn-sm" onclick="window._vttToggleVisible('${t.id}')" title="Visibilité joueurs">${t.visible?'👁':'🙈'}</button>
        ${t.pageId?`<button class="vtt-btn-sm" onclick="window._vttRetireToken('${t.id}')" title="Retirer de la carte">↩</button>`:''}
      </div>` :''}`;
}

// ═══════════════════════════════════════════════════════════════════
// TRAY — panneau latéral des tokens non placés (MJ uniquement)
// ═══════════════════════════════════════════════════════════════════
function _renderTray() {
  if (!STATE.isAdmin) return;
  _renderPageList();
  const el=document.getElementById('vtt-tray-tokens'); if (!el) return;

  const all=Object.values(_tokens).map(e=>e.data);
  const unplaced=all.filter(t=>!t.pageId);
  const onPage  =all.filter(t=>t.pageId===_activePage?.id);

  const mkItem=(t,placed)=>{
    const ld=_live(t);
    const hp=ld.displayHp??20, hpm=ld.displayHpMax??20;
    const rat=hpm>0?Math.max(0,hp/hpm):1;
    const dupBtn=t.type==='enemy'
      ?`<button class="vtt-tray-btn" onclick="event.stopPropagation();window._vttDuplicateToken('${t.id}')" title="Créer une instance supplémentaire">＋</button>`:'';
    const delBtn=t.type==='enemy'
      ?`<button class="vtt-tray-btn" style="color:#ef4444" onclick="event.stopPropagation();window._vttDeleteToken('${t.id}')" title="Supprimer définitivement">×</button>`:'';
    return `<div class="vtt-tray-item ${_selected===t.id?'active':''}" onclick="window._vttSelectFromTray('${t.id}')">
      <div class="vtt-tray-dot" style="background:${TYPE_COLOR[t.type]??'#888'}">
        ${ld.displayImage?`<img src="${ld.displayImage}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`:''}
      </div>
      <div class="vtt-tray-info">
        <div class="vtt-tray-name">${ld.displayName??t.name}</div>
        <div class="vtt-tray-hp-bar"><div style="width:${Math.round(rat*100)}%;height:100%;background:${hpColor(rat)};border-radius:2px"></div></div>
      </div>
      <div style="display:flex;gap:.15rem">
        ${dupBtn}
        ${!placed
          ?`<button class="vtt-tray-btn" onclick="event.stopPropagation();window._vttPlace('${t.id}')" title="Placer sur cette page">▶</button>`
          :`<button class="vtt-tray-btn" onclick="event.stopPropagation();window._vttRetireToken('${t.id}')" title="Retirer de la carte">↩</button>`
        }
        ${delBtn}
      </div>
    </div>`;
  };

  // Section "sur la page" : tous types ; section "non placés" : joueurs + PNJ seulement
  const byType=(arr,includeEnemies=true)=>{
    const players=arr.filter(t=>t.type==='player');
    const npcs   =arr.filter(t=>t.type==='npc');
    const enemies=includeEnemies?arr.filter(t=>t.type==='enemy'):[];
    let html='';
    if (players.length) html+=`<div class="vtt-tray-sep">🧑 Joueurs</div>${players.map(t=>mkItem(t,!!t.pageId)).join('')}`;
    if (npcs.length)    html+=`<div class="vtt-tray-sep">👤 PNJ</div>${npcs.map(t=>mkItem(t,!!t.pageId)).join('')}`;
    if (enemies.length) html+=`<div class="vtt-tray-sep">👹 Ennemis</div>${enemies.map(t=>mkItem(t,!!t.pageId)).join('')}`;
    return html;
  };

  // Section Bestiaire : entrées du bestiaire → bouton ▶ pour créer + placer une instance
  const bsts=Object.values(_bestiary);
  const bestiaryHtml=bsts.length
    ? bsts.map(b=>{
        const img=b.photoURL||b.photo||b.avatar||b.imageUrl||'';
        const pvMax=parseInt(b.pvMax)||'?';
        return `<div class="vtt-tray-item">
          <div class="vtt-tray-dot" style="background:#ef4444">
            ${img?`<img src="${img}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`:''}
          </div>
          <div class="vtt-tray-info">
            <div class="vtt-tray-name">${b.nom||'Créature'}</div>
            <div class="vtt-tray-hp-bar" style="background:rgba(239,68,68,0.18)"><div style="width:100%;height:100%;background:#ef4444;border-radius:2px;opacity:.5"></div></div>
          </div>
          <div style="display:flex;gap:.15rem">
            <button class="vtt-tray-btn" onclick="event.stopPropagation();window._vttPlaceFromBestiary('${b.id}')" title="Placer une instance sur cette page">▶</button>
          </div>
        </div>`;
      }).join('')
    : '<div class="vtt-tray-empty" style="font-size:.7rem">Bestiaire vide</div>';

  const unplacedNonEnemy=unplaced.filter(t=>t.type!=='enemy');

  el.innerHTML=`
    ${onPage.length?`<div class="vtt-tray-group"><div class="vtt-tray-group-title">Sur cette page (${onPage.length})</div>${byType(onPage,true)}</div>`:''}
    ${unplacedNonEnemy.length?`<div class="vtt-tray-group"><div class="vtt-tray-group-title">Non placés (${unplacedNonEnemy.length})</div>${byType(unplacedNonEnemy,false)}</div>`:''}
    <div class="vtt-tray-group"><div class="vtt-tray-group-title">👹 Bestiaire</div>${bestiaryHtml}</div>
  `;
}

// ═══════════════════════════════════════════════════════════════════
// PAGES
// ═══════════════════════════════════════════════════════════════════
// ─ Liste verticale des pages dans le tray (MJ) ─────────────────────
function _renderPageList() {
  const el=document.getElementById('vtt-tray-pages'); if (!el) return;
  const broadcastId=_session.activePageId;
  const sorted=Object.values(_pages).sort((a,b)=>(a.order??0)-(b.order??0));

  if (!sorted.length) {
    el.innerHTML=`<div class="vtt-tray-empty">Aucune page<br><small>Clique ＋ pour créer</small></div>`;
    return;
  }
  el.innerHTML=sorted.map(p=>{
    const isPlayers=p.id===broadcastId, isMj=p.id===_activePage?.id;
    const cls=isMj&&isPlayers?'mj-and-players':isMj?'mj':isPlayers?'players':'';
    return `
    <div class="vtt-page-item ${cls}" onclick="window._vttSwitchPage('${p.id}')" title="${p.cols||24}×${p.rows||18} cases">
      <div class="vtt-page-item-badges">
        ${isMj     ?'<span title="Votre vue">📍</span>':''}
        ${isPlayers?'<span title="Joueurs ici">👥</span>':''}
      </div>
      <div class="vtt-page-item-name">${p.name}</div>
      <div class="vtt-page-item-acts">
        <button class="vtt-page-item-btn" onclick="event.stopPropagation();window._vttSendToPage('${p.id}')" title="Envoyer tous les joueurs ici">📡</button>
        <button class="vtt-page-item-btn" onclick="event.stopPropagation();window._vttEditPage('${p.id}')" title="Renommer / redimensionner">✏</button>
        <button class="vtt-page-item-btn vtt-page-item-del" onclick="event.stopPropagation();window._vttDeletePage('${p.id}')" title="Supprimer">×</button>
      </div>
    </div>`;
  }).join('');
}

// ─ Onglets horizontaux pour les joueurs (toolbar) ───────────────────
function _renderPageTabs() {
  if (STATE.isAdmin) { _renderPageList(); return; } // MJ : liste dans le tray
  const el=document.getElementById('vtt-page-tabs'); if (!el) return;
  const sorted=Object.values(_pages).sort((a,b)=>(a.order??0)-(b.order??0));
  const broadcastId=_session.activePageId;

  // Compte les joueurs par page (tokens placés de type player)
  const playerCount={};
  for (const {data:t} of Object.values(_tokens)) {
    if (t.type==='player'&&t.pageId) playerCount[t.pageId]=(playerCount[t.pageId]??0)+1;
  }

  el.innerHTML=sorted.map(p=>{
    const isPlayers = p.id===broadcastId;        // où sont les joueurs
    const isMj      = p.id===_activePage?.id;    // où est le MJ (sa propre vue)
    const cnt       = playerCount[p.id]??0;

    // Badges d'état : chacun indépendant et cumulable
    const mjBadge      = isMj      ? `<span class="vtt-tab-badge vtt-tab-badge-mj"   title="Votre vue">📍</span>` : '';
    const playersBadge = isPlayers ? `<span class="vtt-tab-badge vtt-tab-badge-pl"   title="Vos joueurs sont ici">👥</span>` : '';
    const cntBadge     = cnt>0&&!isPlayers ? `<span class="vtt-page-player-cnt">${cnt}j</span>` : '';

    // Classe de fond : priorité au statut joueurs si le MJ n'est pas dessus
    const cls = isMj&&isPlayers ? 'active mj-and-players'
              : isMj            ? 'active'
              : isPlayers       ? 'players-here'
              : '';

    const title = [isMj?'📍 Votre vue':'', isPlayers?'👥 Vos joueurs sont ici':'']
                   .filter(Boolean).join(' · ') || p.name;

    return `
    <button class="vtt-page-tab ${cls}" onclick="window._vttSwitchPage('${p.id}')" title="${title}">
      ${mjBadge}${playersBadge}
      <span class="vtt-tab-name">${p.name}</span>
      ${cntBadge}
      ${STATE.isAdmin?`<span class="vtt-page-del" onclick="event.stopPropagation();window._vttDeletePage('${p.id}')">×</span>`:''}
    </button>`;
  }).join('')+
  (sorted.length===0&&STATE.isAdmin
    ? `<span style="font-size:.75rem;color:var(--text-dim);padding:.3rem .5rem;white-space:nowrap">
         ← clique <strong>＋ Page</strong> pour commencer
       </span>`
    : '');
}

async function _switchPage(pageId) {
  const page=_pages[pageId]; if (!page) return;
  _activePage=page;
  // Ne pas détruire _layers.map entièrement : _imgTr (Transformer) y vit.
  // _renderMapImages() et _renderAllTokens() gèrent leur propre nettoyage.
  _layers.token?.destroyChildren(); _clearHL();
  _drawGrid(); _renderMapImages(); _renderAllTokens();
  _renderPageTabs(); _renderTray(); _deselect();
  // Le MJ navigue librement — les joueurs ne suivent que via 📡 Envoyer
}

function _renderAllTokens() {
  if (!_activePage) return;
  _layers.token?.destroyChildren();
  for (const e of Object.values(_tokens)) {
    const t=e.data;
    if (t.pageId!==_activePage.id) continue;
    if (!t.visible&&!STATE.isAdmin) continue;
    const shape=_buildShape(t);
    _tokens[t.id]={...e,shape}; _layers.token.add(shape);
  }
  _layers.token?.batchDraw();
}

// ═══════════════════════════════════════════════════════════════════
// SYNC FIRESTORE — onSnapshot sur 5 collections
// ═══════════════════════════════════════════════════════════════════
function _initListeners() {
  if (!_aid()) return;

  // 1. Session
  _unsubs.push(onSnapshot(_sesRef(), snap => {
    _session=snap.exists()?snap.data():{};
    _renderPageTabs();
    if (!STATE.isAdmin) {
      const uid=STATE.user?.uid;
      const target=_session.playerPages?.[uid]??_session.activePageId;
      if (target&&_pages[target]&&_activePage?.id!==target) _switchPage(target);
    }
    _renderCombatBadge();
  },()=>{}));

  // 2. Pages
  _unsubs.push(onSnapshot(_pgsCol(), snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type==='removed') delete _pages[ch.doc.id];
      else {
        _pages[ch.doc.id]={id:ch.doc.id,...ch.doc.data()};
        if (_activePage?.id===ch.doc.id) { _activePage=_pages[ch.doc.id]; _renderMapImages(); }
      }
    });
    _renderPageTabs();
    if (!_activePage&&Object.keys(_pages).length>0) {
      const uid=STATE.user?.uid;
      const target=(_session.playerPages?.[uid]??_session.activePageId)
        ||Object.values(_pages).sort((a,b)=>(a.order??0)-(b.order??0))[0]?.id;
      if (target&&_pages[target]) _switchPage(target);
    }
  },()=>{}));

  // 3. Personnages — source de vérité des HP joueurs
  _unsubs.push(onSnapshot(_chrsCol(), snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type==='removed') delete _characters[ch.doc.id];
      else _characters[ch.doc.id]={id:ch.doc.id,...ch.doc.data()};
    });
    // Refresh des shapes liés
    const changed=new Set(snap.docChanges().map(c=>c.doc.id));
    for (const [id,e] of Object.entries(_tokens)) {
      if (e.data.characterId&&changed.has(e.data.characterId)) {
        _patchShape(id); if (_selected===id) _renderInspector(e.data);
      }
    }
    _renderTray();
    _charsReady=true; _maybeSyncAutoTokens();
  },()=>{}));

  // 4. PNJ — source de vérité des HP PNJ
  _unsubs.push(onSnapshot(_npcsCol(), snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type==='removed') delete _npcs[ch.doc.id];
      else _npcs[ch.doc.id]={id:ch.doc.id,...ch.doc.data()};
    });
    const changed=new Set(snap.docChanges().map(c=>c.doc.id));
    for (const [id,e] of Object.entries(_tokens)) {
      if (e.data.npcId&&changed.has(e.data.npcId)) {
        _patchShape(id); if (_selected===id) _renderInspector(e.data);
      }
    }
    _renderTray();
    _npcsReady=true; _maybeSyncAutoTokens();
  },()=>{}));

  // 5. Bestiaire — source de vérité des créatures ennemies
  _unsubs.push(onSnapshot(_bstCol(), snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type==='removed') delete _bestiary[ch.doc.id];
      else _bestiary[ch.doc.id]={id:ch.doc.id,...ch.doc.data()};
    });
    const changed=new Set(snap.docChanges().map(c=>c.doc.id));
    for (const [id,e] of Object.entries(_tokens)) {
      if (e.data.beastId&&changed.has(e.data.beastId)) {
        _patchShape(id); if (_selected===id) _renderInspector(e.data);
      }
    }
    _renderTray();
    _bstsReady=true; _maybeSyncAutoTokens();
  },()=>{}));

  // 6. Tokens
  _unsubs.push(onSnapshot(_toksCol(), snap => {
    snap.docChanges().forEach(ch => {
      const id=ch.doc.id, data={id,...ch.doc.data()};
      if (ch.type==='removed') {
        _tokens[id]?.shape?.destroy(); delete _tokens[id];
        if (_selected===id) _deselect();
        _layers.token?.batchDraw(); return;
      }
      const prev=_tokens[id];
      if (prev) {
        const changedPage=prev.data.pageId!==data.pageId;
        prev.data=data;
        if (changedPage) {
          prev.shape?.destroy(); prev.shape=null;
          if (_activePage&&data.pageId===_activePage.id&&(data.visible||STATE.isAdmin)) {
            const shape=_buildShape(data);
            _tokens[id]={data,shape}; _layers.token?.add(shape); _layers.token?.batchDraw();
          } else {
            _tokens[id]={data,shape:null};
          }
        } else {
          _patchShape(id);
        }
        if (_selected===id) _renderInspector(data);
      } else {
        _tokens[id]={data,shape:null};
        if (_activePage&&data.pageId===_activePage.id&&(data.visible||STATE.isAdmin)) {
          const shape=_buildShape(data);
          _tokens[id].shape=shape;
          _layers.token?.add(shape); _layers.token?.batchDraw();
        }
      }
    });
    _renderTray();
    _toksReady=true; _maybeSyncAutoTokens();
  },()=>{}));

  // 7. Chat / Log de dés
  _unsubs.push(onSnapshot(_logCol(), snap => {
    const msgs=snap.docs
      .map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(a.createdAt?.toMillis?.()??0)-(b.createdAt?.toMillis?.()??0))
      .slice(-60);
    _renderChatLog(msgs);
  }, e => {
    console.error('[vtt] chat listener:', e);
    const el=document.getElementById('vtt-chat-log');
    if (el) el.innerHTML=`<div class="vtt-log-entry vtt-log-roll" style="color:#ef4444">⚠ Accès refusé — ajouter <code>vttLog</code> aux règles Firestore</div>`;
  }));
}

// ═══════════════════════════════════════════════════════════════════
// MENU CONTEXTUEL (clic-droit images)
// ═══════════════════════════════════════════════════════════════════
let _ctxClose = null;
const _CTX_ACTIONS = {};

function _hideCtxMenu() {
  document.getElementById('vtt-ctx-menu')?.remove();
  if (_ctxClose) { document.removeEventListener('mousedown', _ctxClose); _ctxClose=null; }
}

function _showCtxMenu(x, y, items) {
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
  el.style.cssText=`left:${x}px;top:${y}px;`;
  document.body.appendChild(el);
  _ctxClose=e=>{ if (!el.contains(e.target)) _hideCtxMenu(); };
  setTimeout(()=>document.addEventListener('mousedown',_ctxClose), 0);
}

// ── Mode édition carte ───────────────────────────────────────────
function _setMapMode(on) {
  _mapMode=on;
  _layers.map?.listening(on);
  _layers.mapFg?.listening(on);
  // Mettre à jour le draggable de toutes les images existantes
  const toggle = lyr => lyr?.find('Image').forEach(ki=>ki.draggable(on));
  toggle(_layers.map); toggle(_layers.mapFg);
  if (!on) {
    _imgTr?.nodes([]); _imgTrFg?.nodes([]); _selImg=null;
    _layers.map?.batchDraw(); _layers.mapFg?.batchDraw();
    _hideCtxMenu();
  }
  const btn=document.getElementById('vtt-map-mode-btn');
  if (btn) { btn.classList.toggle('active',on); btn.textContent=on?'🗺 Carte ✏':'🗺 Carte 🔒'; }
}
window._vttToggleMapMode = () => _setMapMode(!_mapMode);

// ═══════════════════════════════════════════════════════════════════
// CHAT & LOG DE DÉS
// ═══════════════════════════════════════════════════════════════════
function _escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _renderChatLog(msgs) {
  const el=document.getElementById('vtt-chat-log'); if (!el) return;
  const myUid=STATE.user?.uid;
  el.innerHTML=msgs.map(m=>{
    const isMe=m.authorId===myUid;
    const who=`<span class="vtt-log-who${isMe?' me':''}">${_escHtml(m.authorName||'?')}</span>`;
    if (m.type==='roll') {
      return `<div class="vtt-log-entry vtt-log-roll">${who} 🎲 <em>${_escHtml(m.rollFormula||'')}</em> → <strong>${m.rollResult}</strong>`
        +(m.text?`<span class="vtt-log-desc">${_escHtml(m.text)}</span>`:'')
        +`</div>`;
    }
    return `<div class="vtt-log-entry vtt-log-msg">${who} ${_escHtml(m.text||'')}</div>`;
  }).join('');
  el.scrollTop=el.scrollHeight;
}

window._vttSendChat = async () => {
  const input=document.getElementById('vtt-chat-input');
  const text=input?.value.trim(); if (!text) return;
  input.value='';
  const authorName=STATE.profile?.pseudo||STATE.profile?.prenom||STATE.user?.displayName||'Joueur';
  try {
    await addDoc(_logCol(),{
      type:'chat', authorId:STATE.user?.uid||null, authorName, text, createdAt:serverTimestamp(),
    });
  } catch(e) {
    if (input) input.value=text; // restaurer le texte si échec
    console.error('[vtt] chat send:', e);
    const reason=e.code==='permission-denied'
      ? 'Règles Firestore : ajouter vttLog (voir docs/firestore-rules.md)'
      : e.message;
    showNotif(`Erreur chat : ${reason}`,'error');
  }
};

function _renderCombatBadge() {
  const el=document.getElementById('vtt-combat-badge'); if (!el) return;
  if (_session?.combat?.active) { el.textContent=`⚔️ Round ${_session.combat.round??1}`; el.style.display='flex'; }
  else el.style.display='none';
}

// ═══════════════════════════════════════════════════════════════════
// ACTIONS GLOBALES
// ═══════════════════════════════════════════════════════════════════
window._vttTool       = t => _setTool(t);
window._vttSwitchPage = id => _switchPage(id);

window._vttAddPage = () => {
  openModal('➕ Nouvelle page', `
    <div class="vtt-form">
      <div class="form-group"><label>Nom</label>
        <input id="vpf-name" type="text" placeholder="ex : Forêt Sombre" autofocus></div>
      <div class="vtt-form-row">
        <div class="form-group"><label>Colonnes (largeur)</label>
          <input id="vpf-cols" type="number" value="24" min="8" max="200"></div>
        <div class="form-group"><label>Lignes (hauteur)</label>
          <input id="vpf-rows" type="number" value="18" min="8" max="200"></div>
      </div>
      <small style="color:var(--text-dim);font-size:.72rem">1 case = ${CELL}px · ex : 30×22 pour une grande carte</small>
      <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">
        <button class="btn-secondary" data-action="close-modal">Annuler</button>
        <button class="btn-primary" onclick="window._vttConfirmAddPage()">Créer</button>
      </div>
    </div>`);
};
window._vttConfirmAddPage = async () => {
  const name=(document.getElementById('vpf-name')?.value||'').trim();
  const cols=Math.max(8,Math.min(200,parseInt(document.getElementById('vpf-cols')?.value)||24));
  const rows=Math.max(8,Math.min(200,parseInt(document.getElementById('vpf-rows')?.value)||18));
  if (!name) { showNotif('Nom requis','error'); return; }
  closeModalDirect();
  await addDoc(_pgsCol(),{name,cols,rows,backgroundImages:[],order:Object.keys(_pages).length,createdAt:serverTimestamp()})
    .catch(()=>showNotif('Erreur création page','error'));
};

window._vttEditPage = id => {
  const p=_pages[id]; if (!p) return;
  openModal('✏️ Modifier la page', `
    <div class="vtt-form">
      <div class="form-group"><label>Nom</label>
        <input id="vpe-name" type="text" value="${p.name}" autofocus></div>
      <div class="vtt-form-row">
        <div class="form-group"><label>Colonnes</label>
          <input id="vpe-cols" type="number" value="${p.cols||24}" min="8" max="200"></div>
        <div class="form-group"><label>Lignes</label>
          <input id="vpe-rows" type="number" value="${p.rows||18}" min="8" max="200"></div>
      </div>
      <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">
        <button class="btn-secondary" data-action="close-modal">Annuler</button>
        <button class="btn-primary" onclick="window._vttConfirmEditPage('${id}')">Enregistrer</button>
      </div>
    </div>`);
};
window._vttConfirmEditPage = async id => {
  const name=(document.getElementById('vpe-name')?.value||'').trim();
  const cols=Math.max(8,Math.min(200,parseInt(document.getElementById('vpe-cols')?.value)||24));
  const rows=Math.max(8,Math.min(200,parseInt(document.getElementById('vpe-rows')?.value)||18));
  if (!name) { showNotif('Nom requis','error'); return; }
  closeModalDirect();
  await updateDoc(_pgRef(id),{name,cols,rows}).catch(()=>showNotif('Erreur','error'));
  if (_activePage?.id===id) { _activePage={..._activePage,name,cols,rows}; _drawGrid(); }
};

window._vttDeletePage = async id => {
  if (!await confirmModal('Supprimer cette page ?',{title:'Supprimer ?',danger:true})) return;
  await deleteDoc(_pgRef(id)).catch(()=>{});
};

// Envoyer tous les joueurs vers une page spécifique (depuis la liste)
window._vttSendToPage = async pageId => {
  const p=_pages[pageId]; if (!p) return;
  await setDoc(_sesRef(),{activePageId:pageId},{merge:true}).catch(()=>{});
  showNotif(`📡 Tous les joueurs → « ${p.name} »`,'success');
};

// Placer un token sur la page active (depuis le tray)
window._vttPlace = async tokenId => {
  if (!_activePage) { showNotif('Crée d\'abord une page','error'); return; }
  const cC=Math.floor(_activePage.cols/2), cR=Math.floor(_activePage.rows/2);
  await updateDoc(_tokRef(tokenId),{pageId:_activePage.id,col:cC,row:cR,visible:true})
    .catch(()=>showNotif('Erreur placement','error'));
};
// Retirer un token de la carte (le remet dans le tray)
window._vttRetireToken = async tokenId => {
  await updateDoc(_tokRef(tokenId),{pageId:null,visible:false}).catch(()=>{});
  if (_selected===tokenId) _deselect();
};
// Déplacer le token vers une autre page
window._vttMoveTokenToPage = async (tokenId,pageId) => {
  if (!pageId) return;
  await updateDoc(_tokRef(tokenId),{pageId}).catch(()=>{});
};
// Sélectionner depuis le tray (place si non placé)
window._vttSelectFromTray = id => {
  const t=_tokens[id]?.data; if (!t) return;
  if (!t.pageId&&STATE.isAdmin) { window._vttPlace(id); return; }
  if (t.pageId===_activePage?.id) _select(id);
};
window._vttToggleVisible = async id => {
  const t=_tokens[id]?.data; if (!t) return;
  await updateDoc(_tokRef(id),{visible:!t.visible}).catch(()=>{});
};
window._vttSetHp = async (tokenId,hp) => {
  const t=_tokens[tokenId]?.data; if (!t) return;
  await _setHp(t,hp).catch(()=>{});
};
window._vttEditToken = id => _openStatsModal(_tokens[id]?.data??null);

window._vttAddImageUrl = async () => {
  const url=prompt('URL de l\'image :')?.trim(); if (!url||!_activePage) return;
  const imgs=[...(_activePage.backgroundImages??[]),{id:Date.now().toString(),url,x:0,y:0,w:_activePage.cols,h:_activePage.rows}];
  await updateDoc(_pgRef(_activePage.id),{backgroundImages:imgs}).catch(()=>{});
};
window._vttUploadClick = () => document.getElementById('vtt-img-input')?.click();

window._vttToggleCombat = async () => {
  if (!STATE.isAdmin) return;
  const active=!_session?.combat?.active;
  await setDoc(_sesRef(),{combat:{active,round:active?1:0}},{merge:true});
  if (active) {
    const b=writeBatch(db);
    Object.keys(_tokens).forEach(id=>b.update(_tokRef(id),{movedThisTurn:false,attackedThisTurn:false}));
    await b.commit().catch(()=>{});
    showNotif('⚔️ Combat démarré !','success');
  } else showNotif('Combat terminé.','success');
};
window._vttNextRound = async () => {
  if (!STATE.isAdmin||!_session?.combat?.active) return;
  const round=(_session.combat.round??1)+1;
  await setDoc(_sesRef(),{combat:{active:true,round}},{merge:true});
  const b=writeBatch(db);
  Object.keys(_tokens).forEach(id=>b.update(_tokRef(id),{movedThisTurn:false,attackedThisTurn:false}));
  await b.commit().catch(()=>{});
  showNotif(`Round ${round} !`,'success');
};

// ── Modal stats combat (override des stats auto) ────────────────────
function _openStatsModal(t) {
  if (!t) return;
  const ld=_live(t);
  openModal('⚙️ Stats de combat', `
    <div class="vtt-form">
      <div class="vtt-form-row">
        <div class="form-group"><label>🏃 Mouvement</label><input id="vsf-mv"    type="number" value="${t.movement??''}"  placeholder="${ld.displayMovement??6} (auto)"></div>
        <div class="form-group"><label>🎯 Portée</label>   <input id="vsf-range" type="number" value="${t.range??1}"       min="0"></div>
      </div>
      <div class="vtt-form-row">
        <div class="form-group"><label>⚔️ Attaque</label>  <input id="vsf-atk"   type="number" value="${t.attack??''}"    placeholder="${ld.displayAttack??5} (auto)"></div>
        <div class="form-group"><label>🛡 CA/Défense</label><input id="vsf-def"  type="number" value="${t.defense??''}"   placeholder="${ld.displayDefense??0} (auto)"></div>
      </div>
      <div class="form-group"><label>URL image (optionnel)</label>
        <input id="vsf-img" type="text" value="${t.imageUrl??''}" placeholder="Remplace la photo du perso">
      </div>
      <label class="vtt-check-label"><input id="vsf-visible" type="checkbox" ${t.visible?'checked':''}> Visible par les joueurs</label>
      <small style="color:var(--text-dim);font-size:.7rem;margin-top:.25rem">
        Laisser vide pour utiliser les stats calculées depuis la fiche de personnage.
      </small>
      <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">
        <button class="btn-secondary" data-action="close-modal">Annuler</button>
        <button class="btn-primary" onclick="window._vttSaveStats('${t.id}')">💾 Enregistrer</button>
      </div>
    </div>`);
}
// ── Création d'ennemis personnalisés ────────────────────────────────
window._vttCreateEnemy = () => {
  openModal('👹 Créer un ennemi', `
    <div class="vtt-form">
      <div class="form-group"><label>Nom</label>
        <input id="ve-name" type="text" placeholder="ex : Gobelin" autofocus></div>
      <div class="vtt-form-row">
        <div class="form-group"><label>PV Max</label>
          <input id="ve-hp" type="number" value="20" min="1"></div>
        <div class="form-group"><label>CA / Défense</label>
          <input id="ve-ca" type="number" value="10" min="0"></div>
      </div>
      <div class="vtt-form-row">
        <div class="form-group"><label>⚔️ Dégâts (dés)</label>
          <input id="ve-atk" type="text" value="1d6" placeholder="1d6, 2d4+2…"></div>
        <div class="form-group"><label>🏃 Mouvement</label>
          <input id="ve-mv" type="number" value="4" min="1"></div>
      </div>
      <div class="vtt-form-row">
        <div class="form-group"><label>🎯 Portée (cases)</label>
          <input id="ve-range" type="number" value="1" min="1"></div>
        <div class="form-group"><label>Nombre à créer</label>
          <input id="ve-count" type="number" value="1" min="1" max="20"></div>
      </div>
      <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">
        <button class="btn-secondary" data-action="close-modal">Annuler</button>
        <button class="btn-primary" onclick="window._vttConfirmCreateEnemy()">Créer</button>
      </div>
    </div>`);
};
window._vttConfirmCreateEnemy = async () => {
  const name  = (document.getElementById('ve-name')?.value||'').trim() || 'Ennemi';
  const hp    = Math.max(1, parseInt(document.getElementById('ve-hp')?.value)||20);
  const ca    = parseInt(document.getElementById('ve-ca')?.value)||10;
  const atk   = document.getElementById('ve-atk')?.value.trim()||'1d6';
  const mv    = Math.max(1, parseInt(document.getElementById('ve-mv')?.value)||4);
  const range = Math.max(1, parseInt(document.getElementById('ve-range')?.value)||1);
  const count = Math.min(20, Math.max(1, parseInt(document.getElementById('ve-count')?.value)||1));
  closeModalDirect();
  const batch = writeBatch(db);
  for (let i=0; i<count; i++) {
    const ref = doc(_toksCol());
    batch.set(ref, {
      name: count>1 ? `${name} ${i+1}` : name,
      type: 'enemy', characterId: null, npcId: null, ownerId: null,
      pageId: _activePage?.id||null,
      col: _activePage ? Math.min(_activePage.cols-1, Math.floor(_activePage.cols/2)+i) : i,
      row: _activePage ? Math.floor(_activePage.rows/2) : 0,
      visible: true,
      hp, hpMax: hp, attackDice: atk, defense: ca, movement: mv, range,
      imageUrl: null, movedThisTurn: false, attackedThisTurn: false,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit().catch(()=>showNotif('Erreur création','error'));
  showNotif(`👹 ${count>1?`${count} ennemis créés`:'Ennemi créé'} !`,'success');
};

// Créer une nouvelle instance indépendante d'un ennemi (PV séparés)
window._vttDuplicateToken = async tokenId => {
  const t=_tokens[tokenId]?.data; if (!t) return;
  const baseName=t.name.replace(/ \d+$/, '');
  const sameGroup=Object.values(_tokens).filter(e=>
    t.beastId ? e.data.beastId===t.beastId
              : e.data.name.replace(/ \d+$/,'')===baseName
  );
  const num=sameGroup.length+1;
  const { id:_tid, createdAt:_ca, ...base } = t;
  const ref=doc(_toksCol());
  await setDoc(ref, {
    ...base,
    name:`${baseName} ${num}`,
    hp: null,   // PV frais depuis le template bestiaire
    pageId: _activePage?.id||null,
    col: _activePage ? Math.min(_activePage.cols-1,(t.col||0)+sameGroup.length) : 0,
    row: t.row||0,
    visible: true,
    movedThisTurn: false, attackedThisTurn: false,
    createdAt: serverTimestamp(),
  }).catch(()=>showNotif('Erreur duplication','error'));
  showNotif(`👹 ${baseName} ${num} créé !`,'success');
};

// Placer une instance depuis le bestiaire (crée + place sur la page active)
window._vttPlaceFromBestiary = async beastId => {
  if (!_activePage) return showNotif('Aucune page active — ouvre une page d\'abord','error');
  const b=_bestiary[beastId]; if (!b) return;
  const existing=Object.values(_tokens).filter(e=>e.data.beastId===beastId);
  const num=existing.length+1;
  const name=num>1?`${b.nom} ${num}`:(b.nom||'Créature');
  const cx=Math.floor(_activePage.cols/2), cy=Math.floor(_activePage.rows/2);
  const ref=doc(_toksCol());
  await setDoc(ref,{
    name, type:'enemy',
    characterId:null, npcId:null, beastId,
    ownerId:null,
    pageId:_activePage.id,
    col:Math.min(_activePage.cols-1,cx+existing.length),
    row:cy,
    visible:true,
    imageUrl:null, movement:null, range:1, attack:null, defense:null,
    hp:null, hpMax:null,
    movedThisTurn:false, attackedThisTurn:false,
    createdAt:serverTimestamp(),
  }).catch(()=>showNotif('Erreur placement','error'));
  showNotif(`👹 ${name} placé !`,'success');
};

// Supprimer définitivement un token ennemi
window._vttDeleteToken = async tokenId => {
  const t=_tokens[tokenId]?.data; if (!t||t.type!=='enemy') return;
  if (!confirm(`Supprimer définitivement "${t.name}" ?`)) return;
  await deleteDoc(_tokRef(tokenId)).catch(()=>showNotif('Erreur suppression','error'));
  showNotif(`🗑 ${t.name} supprimé`,'success');
};

window._vttSaveStats = async id => {
  const mv  = document.getElementById('vsf-mv')?.value;
  const rng = document.getElementById('vsf-range')?.value;
  const atk = document.getElementById('vsf-atk')?.value;
  const def = document.getElementById('vsf-def')?.value;
  const img = document.getElementById('vsf-img')?.value.trim();
  const vis = document.getElementById('vsf-visible')?.checked;
  const patch = {
    movement: mv  ? +mv  : null,
    range:    rng ? +rng : 1,
    attack:   atk ? +atk : null,
    defense:  def ? +def : null,
    imageUrl: img || null,
    visible:  vis ?? true,
  };
  await updateDoc(_tokRef(id),patch).catch(()=>showNotif('Erreur','error'));
  closeModalDirect();
  showNotif('Stats mises à jour','success');
};

// ── Upload via ImgBB ────────────────────────────────────────────────
// Clé API stockée en localStorage (jamais dans le code)
const _IMGBB_KEY_LS = 'vtt-imgbb-key';

function _getImgbbKey() { return localStorage.getItem(_IMGBB_KEY_LS)||''; }

window._vttSetImgbbKey = () => {
  const current = _getImgbbKey();
  const key = prompt('Clé API ImgBB (imgbb.com → Get API key) :', current)?.trim();
  if (key === null) return;
  if (key) { localStorage.setItem(_IMGBB_KEY_LS, key); showNotif('Clé ImgBB enregistrée ✓','success'); }
  else      { localStorage.removeItem(_IMGBB_KEY_LS); showNotif('Clé ImgBB supprimée','success'); }
};

async function _handleUpload(file) {
  if (!file||!_activePage) return;
  const key = _getImgbbKey();
  if (!key) {
    showNotif('Configure ta clé ImgBB d\'abord (bouton 🔑)','error');
    return;
  }
  showNotif('Upload en cours…','success');
  try {
    const b64 = await new Promise((res,rej)=>{
      const r=new FileReader(); r.onload=()=>res(r.result.split(',')[1]); r.onerror=rej; r.readAsDataURL(file);
    });
    const form=new FormData();
    form.append('key', key);
    form.append('image', b64);
    const resp = await fetch('https://api.imgbb.com/1/upload', { method:'POST', body:form });
    const json = await resp.json();
    if (!json.success) throw new Error(json.error?.message||'ImgBB error');
    const url = json.data.url;
    const imgs=[...(_activePage.backgroundImages??[]),{id:Date.now().toString(),url,x:0,y:0,w:_activePage.cols,h:_activePage.rows}];
    await updateDoc(_pgRef(_activePage.id),{backgroundImages:imgs});
    showNotif('Image ajoutée !','success');
  } catch(e) { console.error(e); showNotif('Erreur upload : '+e.message,'error'); }
}

// ── Outil + clavier ─────────────────────────────────────────────────
function _setTool(tool) {
  _tool=tool;
  document.querySelectorAll('.vtt-tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));
}
function _keyHandler(e) {
  if (!document.getElementById('vtt-canvas-wrap')) return;
  if (e.target.matches('input,textarea,select')) return;
  if (e.key==='Escape') _deselect();
}

// ═══════════════════════════════════════════════════════════════════
// HTML
// ═══════════════════════════════════════════════════════════════════
function _buildHtml() {
  const mj=STATE.isAdmin;
  return `
<div class="vtt-root" id="vtt-root">
  <div class="vtt-toolbar">
    ${mj?'':`<div id="vtt-page-tabs" class="vtt-page-tabs"></div>`}
    <div class="vtt-tool-group vtt-right">
      <div id="vtt-combat-badge" class="vtt-combat-badge" style="display:none"></div>
      ${mj?`
        <button class="vtt-btn-sm" id="vtt-map-mode-btn" onclick="window._vttToggleMapMode()" title="Activer l'édition des images (🔒 verrouillé par défaut — évite les déplacements accidentels)">🗺 Carte 🔒</button>
        <button class="vtt-btn-sm" onclick="window._vttAddImageUrl()"  title="Fond par URL">🖼 URL</button>
        <label  class="vtt-btn-sm vtt-upload-lbl" title="Upload via ImgBB">📁 Upload<input type="file" id="vtt-img-input" accept="image/*" hidden></label>
        <button class="vtt-btn-sm" onclick="window._vttSetImgbbKey()" title="Configurer la clé API ImgBB">🔑</button>
        <button class="vtt-btn-sm" onclick="window._vttToggleCombat()" title="Démarrer/arrêter le combat">⚔ Combat</button>
        <button class="vtt-btn-sm" onclick="window._vttNextRound()"    title="Tour suivant">▶ Tour</button>`:''}
    </div>
  </div>
  <div class="vtt-body">
    ${mj?`
    <div class="vtt-tray" id="vtt-tray">
      <div class="vtt-tray-section">
        <div class="vtt-tray-section-hd">
          <span>Pages</span>
          <button class="vtt-tray-add-btn" onclick="window._vttAddPage()" title="Nouvelle page">＋</button>
        </div>
        <div id="vtt-tray-pages"><div class="vtt-tray-empty">Chargement…</div></div>
      </div>
      <div class="vtt-tray-section">
        <div class="vtt-tray-section-hd">
          <span>Tokens</span>
          <button class="vtt-tray-add-btn" onclick="window._vttCreateEnemy()" title="Créer un ennemi personnalisé">＋ Ennemi</button>
        </div>
        <div id="vtt-tray-tokens"></div>
      </div>
    </div>`:''}
    <div class="vtt-canvas-wrap" id="vtt-canvas-wrap"></div>
    <div class="vtt-right-col">
      <div class="vtt-inspector" id="vtt-inspector">
        <div class="vtt-ins-empty"><div style="font-size:1.8rem">🎲</div>Sélectionne un token</div>
      </div>
      <div class="vtt-chat">
        <div class="vtt-chat-hd">💬 Chat &amp; Dés</div>
        <div class="vtt-chat-log" id="vtt-chat-log"></div>
        <div class="vtt-chat-input-row">
          <input type="text" id="vtt-chat-input" class="vtt-chat-input" placeholder="Message…"
            onkeydown="if(event.key==='Enter')window._vttSendChat()">
          <button class="vtt-chat-send" onclick="window._vttSendChat()" title="Envoyer">↵</button>
        </div>
      </div>
    </div>
  </div>
  <div class="vtt-hint">Clic token allié → portée · Clic ennemi → attaque · Échap désélect. · Molette zoom · Clic-droit pan${mj?' · Clic image → redimensionner':''}</div>
</div>`;
}

// ═══════════════════════════════════════════════════════════════════
// POINT D'ENTRÉE
// ═══════════════════════════════════════════════════════════════════
export async function renderVttPage() {
  _cleanup();
  const content=document.getElementById('main-content');
  if (!content) return;
  content.innerHTML='<div class="loading"><div class="spinner"></div> Chargement de la table…</div>';
  content.style.overflow='hidden';
  try { await _loadKonva(); }
  catch {
    content.innerHTML='<div style="padding:2rem;color:var(--text-dim)">Impossible de charger Konva.js.</div>';
    content.style.overflow=''; return;
  }
  content.innerHTML=_buildHtml();
  const wrap=document.getElementById('vtt-canvas-wrap');
  if (!wrap) return;
  _initCanvas(wrap);
  document.addEventListener('keydown',_keyHandler);
  document.getElementById('vtt-img-input')?.addEventListener('change',e=>{
    const f=e.target.files?.[0]; if (f) _handleUpload(f); e.target.value='';
  });
  _initListeners();
}

PAGES.vtt=renderVttPage;
