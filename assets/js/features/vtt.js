// ═══════════════════════════════════════════════════════════════════
// VTT — Table de Jeu Virtuelle
//
// PRINCIPE : chaque personnage ET chaque PNJ possède déjà son token.
// Pas de création manuelle — les tokens sont auto-générés et resten
// en sync bidirectionnel avec les fiches (HP, nom, photo).
// ═══════════════════════════════════════════════════════════════════

import { STATE } from '../core/state.js';
import { getCurrentAdventureId, getDocData, saveDoc } from '../data/firestore.js';
import {
  db, doc, collection, addDoc, updateDoc, deleteDoc,
  setDoc, getDocs, onSnapshot, serverTimestamp, writeBatch,
} from '../config/firebase.js';
import { getMod, calcVitesse, calcCA, calcPVMax, calcPMMax, getMaitriseBonus, statShort } from '../shared/char-stats.js';
import { getArmorSetData } from './characters/data.js';
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
let _bstTracker = {};   // creatureId → tracker joueur (pvActuel, pmActuel, caEstimee…)
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
let _emotes     = [];        // [{id, name, url}] chargées depuis world/vtt_emotes
let _diceSkills = [];        // [{name, stat}] chargées depuis world/dice_skills
let _rollMode   = 'normal';  // 'advantage' | 'normal' | 'disadvantage'
let _rollBonus  = 0;         // bonus contextuel temporaire (anneau, sort, etc.)
const _renderedPings     = new Set();
const _renderedReactions = new Set();

// ── Outils de dessin & règle ────────────────────────────────────────
const CELL_M = 1.5;          // 1 case = 1.5 mètre
let _annotations      = {};   // id → { data, shape }
let _selectedAnnotId  = null; // id de l'annotation sélectionnée
let _annotTransformer = null; // Konva Transformer pour resize/rotation
let _drawing      = false;   // tracé en cours
let _drawPts      = [];      // points crayon libre (world coords)
let _drawOrigin   = null;    // point de départ pour formes
let _drawLive     = null;    // forme Konva live (avant sauvegarde)
let _drawColor    = '#ef4444';
let _drawWidth    = 2;
let _drawShape    = 'pencil'; // 'pencil'|'line'|'rect'|'circle'
let _drawFill     = false;
let _rulerActive  = false;
let _rulerOrigin  = null;
let _rulerLine    = null;
let _rulerLabel   = null;
let _rulerHideTimer = null;

// Mapping abréviation compétence → clé getMod
const _STAT_KEY = { FOR:'force', DEX:'dexterite', CON:'constitution', INT:'intelligence', SAG:'sagesse', CHA:'charisme' };
const _STAT_COLOR = { FOR:'#ef4444', DEX:'#22c38e', CON:'#f59e0b', INT:'#4f8cff', SAG:'#b47fff', CHA:'#fd6c9e' };
const _STAT_RGB   = { FOR:'239,68,68', DEX:'34,195,142', CON:'245,158,11', INT:'79,140,255', SAG:'180,127,255', CHA:'253,108,158' };

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
const _bstCol        = ()    => collection(db, `adventures/${_aid()}/bestiary`);
const _bstRef        = (id)  => doc(db, `adventures/${_aid()}/bestiary/${id}`);
const _bstTrackerRef = (uid) => doc(db, `adventures/${_aid()}/bestiary_tracker/${uid}`);
const _logCol  = ()   => collection(db, `adventures/${_aid()}/vttLog`);
const _pingsCol     = ()  => collection(db, `adventures/${_aid()}/vttPings`);
const _pingRef      = uid => doc(db, `adventures/${_aid()}/vttPings/${uid}`);
const _reactionsCol = ()  => collection(db, `adventures/${_aid()}/vttEmoteReactions`);
const _reactionRef  = uid => doc(db, `adventures/${_aid()}/vttEmoteReactions/${uid}`);
const _annotCol     = ()  => collection(db, `adventures/${_aid()}/vttAnnotations`);
const _annotRef     = id  => doc(db, `adventures/${_aid()}/vttAnnotations/${id}`);

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
  const weapon      = c?.equipement?.['Main principale'];
  const weapStat    = (weapon?.degatsStats?.[0]  || weapon?.degatsStat  || 'force');
  const toucherStat = (weapon?.toucherStats?.[0] || weapon?.toucherStat || weapStat);
  const weapMod     = c ? getMod(c, weapStat)    : 0;
  const toucherMod  = c ? getMod(c, toucherStat) : 0;
  const setBonus    = c ? (getArmorSetData(c).modifiers.toucherBonus || 0) : 0;
  const weapDice  = weapon?.degats
    ? (weapMod !== 0 ? `${weapon.degats}${weapMod>0?'+':''}${weapMod}` : weapon.degats)
    : null;
  const beastDice = b?.attaques?.[0]?.degats || null;
  const atkDice   = t.attackDice || weapDice || beastDice
    || (c ? `1d6${weapMod>=0?'+':''}${weapMod}` : null)
    || (typeof t.attack==='string' ? t.attack : null)
    || '1d6';

  const result = {
    ...t,
    // Ennemis : le nom du token (instance) prime sur le nom générique du bestiaire
    // Joueurs/PNJ : le nom de la fiche prime (toujours à jour)
    displayName:       b ? (t.name || b.nom) : (e.nom || t.name),
    displayImage:      e.photoURL || e.photo || e.avatar || e.imageUrl || t.imageUrl || null,
    displayHp:         hpCurrent,
    displayHpMax:      hpMax,
    displayPm:         c ? (c.pm ?? calcPMMax(c)) : null,
    displayPmMax:      c ? calcPMMax(c) : null,
    displayMovement:   t.movement ?? (c ? calcVitesse(c) : (b ? (parseInt(b.vitesse)||4) : (e.vitesse || e.deplacement || 6))),
    displayAttack:     t.attack   ?? (c ? toucherMod+setBonus : (b ? (parseInt(b.attaques?.[0]?.toucher)||5) : (e.bonusAttaque||e.attack||5))),
    displayAttackDice: atkDice,
    displayDefense:    t.defense  ?? (c ? calcCA(c) : (b ? (parseInt(b.ca)||10) : (e.ca||e.defense||0))),
    // Pour un perso : arme équipée > override admin (t.range > 1) > défaut 1
    // Pour bestiaire/custom : t.range > 1ère attaque bestiary > défaut 1
    displayRange: c
      ? (t.range > 1 ? t.range : (weapon?.portee ? parseInt(weapon.portee)||1 : 1))
      : (t.range ?? (b ? parseInt(b.attaques?.[0]?.portee)||1 : 1)),
    _beast:            b,   // référence directe pour _buildAttackOptions
  };

  // Joueur sur token ennemi : remplace HP et CA par les estimations du tracker
  // pvActuel = total estimé (inchangé), pvCombat = HP courant de combat (diminue avec les coups)
  if (!STATE.isAdmin && b) {
    const track  = _bstTracker[t.beastId] || {};
    const estMax = track.pvActuel !== undefined ? parseInt(track.pvActuel) : null;
    if (estMax !== null) {
      const estCur = track.pvCombat !== undefined ? parseInt(track.pvCombat) : estMax;
      result.displayHp    = estCur;
      result.displayHpMax = estMax;
    }
    if (track.caEstimee !== undefined) result.displayDefense = parseInt(track.caEstimee) || 0;
  }

  return result;
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
  _tokens = {}; _pages = {}; _characters = {}; _npcs = {}; _bestiary = {}; _bstTracker = {};
  _session = {}; _activePage = null; _selected = null; _attackSrc = null;
  _moveHL = []; _autoSyncDone = false; _renderedPings.clear(); _renderedReactions.clear();
  _selectedMulti.clear(); _multiDragOrigin = null;
  _annotations = {}; _drawing = false; _drawLive = null;
  _selectedAnnotId = null; _annotTransformer = null;
  _rulerActive = false; _rulerLine = null; _rulerLabel = null;
  if (_rulerHideTimer) { clearTimeout(_rulerHideTimer); _rulerHideTimer = null; }
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
  _layers.draw  = new K.Layer();                     // annotations (entre grille et tokens)
  _layers.token = new K.Layer();
  _layers.mapFg = new K.Layer({ listening: false }); // 1er plan, verrouillé par défaut
  _layers.ping  = new K.Layer({ listening: false }); // pings + règle (au-dessus de tout)
  _stage.add(_layers.bg, _layers.map, _layers.grid, _layers.draw, _layers.token, _layers.mapFg, _layers.ping);

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

    // Transformer pour sélectionner/tourner/redimensionner les annotations
    _annotTransformer = new K.Transformer({
      rotateEnabled: true, keepRatio: false,
      borderStroke: '#ffe600', borderStrokeWidth: 1,
      anchorStroke: '#ffe600', anchorFill: '#1a1a2e', anchorSize: 8, anchorCornerRadius: 2,
    });
    _layers.draw.add(_annotTransformer);
  }

  // Listener window pour la règle — window est garanti, pas de conflit avec Konva
  const _rulerMoveNative = e => {
    if (_tool !== 'ruler' || !_rulerActive || !_stage) return;
    const rect = container.getBoundingClientRect();
    // Ignorer si la souris est hors du canvas
    if (e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top  || e.clientY > rect.bottom) return;
    _updateRuler(_stageToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top }));
  };
  window.addEventListener('mousemove', _rulerMoveNative);
  _unsubs.push(() => window.removeEventListener('mousemove', _rulerMoveNative));

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
  let _pingTimer = null, _pingOrigin = null;
  _stage.on('mousedown', e => {
    if (e.evt.button===1||e.evt.button===2) {
      _pan = true; _po = { x:e.evt.clientX-_stage.x(), y:e.evt.clientY-_stage.y() };
    }
    if (e.evt.button===0) {
      const rect0 = _stage.container().getBoundingClientRect();
      const np = { x: e.evt.clientX - rect0.left, y: e.evt.clientY - rect0.top };
      // Règle : 1er clic = départ, 2e clic = fin (pas besoin de maintenir)
      if (_tool === 'ruler') {
        if (_pingTimer) { clearTimeout(_pingTimer); _pingTimer = null; }
        const wp = _stageToWorld(np);
        if (!_rulerActive) _startRuler(wp);
        else               _endRuler();
        return;
      }
      // Dessin : cliquer-glisser
      if (_tool === 'draw') {
        if (_pingTimer) { clearTimeout(_pingTimer); _pingTimer = null; }
        _startDraw(_stageToWorld(np));
        return;
      }
      // Clic normal → ping sur la stage uniquement
      if (e.target===_stage) {
        _pingOrigin = { ...np };
        _pingTimer = setTimeout(() => {
          _pingTimer = null;
          const sc = _stage.scaleX(), sp = _stage.position();
          _emitPing((_pingOrigin.x - sp.x) / sc, (_pingOrigin.y - sp.y) / sc);
        }, 300);
      }
    }
  });
  _stage.on('mousemove', e => {
    if (_pan) _stage.position({ x:e.evt.clientX-_po.x, y:e.evt.clientY-_po.y });
    // Coordonnées canvas-relatives à partir de l'événement natif (plus fiable que getPointerPosition)
    const rect = _stage.container().getBoundingClientRect();
    const stagePtr = { x: e.evt.clientX - rect.left, y: e.evt.clientY - rect.top };
    if (_pingTimer && _pingOrigin) {
      const dx = stagePtr.x - _pingOrigin.x, dy = stagePtr.y - _pingOrigin.y;
      if (dx*dx + dy*dy > 64) { clearTimeout(_pingTimer); _pingTimer = null; }
    }
    const wp = _stageToWorld(stagePtr);
    if (_tool === 'ruler' && _rulerActive)      _updateRuler(wp);
    if (_tool === 'draw'  && _drawing && !_pan) _updateDraw(wp);
  });
  _stage.on('mouseup', () => {
    _pan = false;
    if (_pingTimer) { clearTimeout(_pingTimer); _pingTimer = null; }
    if (_tool === 'draw' && _drawing) _endDraw();
  });
  _stage.on('contextmenu', e => e.evt.preventDefault());
  _stage.on('click', e => {
    if (e.target===_stage) { _deselect(); _deselectAnnot(); }
  });

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
  const r  = CELL*0.42, bW = CELL*0.9;   // bW élargi pour labels plus lisibles
  const hp = ld.displayHp??20, hpm = ld.displayHpMax??20;
  const rat = hpm>0 ? Math.max(0,hp/hpm) : 1;
  const g = new K.Group({ x:t.col*CELL+CELL/2, y:t.row*CELL+CELL/2, id:`tok-${t.id}` });
  // ── Cercle de base ────────────────────────────────────────────────
  g.add(new K.Circle({ radius:r, fill:TYPE_COLOR[t.type]??'#888', opacity:.9 }));
  // ── Anneaux sélection / attaque ───────────────────────────────────
  g.add(new K.Circle({ radius:r+4, stroke:'#fff',    strokeWidth:3, fill:'transparent',visible:false,name:'sel' }));
  g.add(new K.Circle({ radius:r+4, stroke:'#ef4444', strokeWidth:3, dash:[5,3],fill:'transparent',visible:false,name:'atk' }));
  // ── Barre HP (texte superposé sur la barre) ───────────────────────
  const BH=9; // hauteur barre HP
  g.add(new K.Rect({ x:-bW/2, y:r+4, width:bW, height:BH, fill:'#0d1117', cornerRadius:4, listening:false }));
  g.add(new K.Rect({ x:-bW/2, y:r+4, width:Math.max(2,bW*rat), height:BH, fill:hpColor(rat), cornerRadius:4, listening:false, name:'hp-fill' }));
  g.add(new K.Text({ x:-bW/2, y:r+4, width:bW, height:BH, align:'center', verticalAlign:'middle',
    text:`${hp}/${hpm}`, fontSize:8, fontStyle:'bold', fill:'#fff',
    shadowColor:'#000', shadowBlur:2, shadowOpacity:.9,
    fontFamily:'Inter,sans-serif', listening:false, name:'hp-val' }));
  // ── Barre PM (joueurs seulement, texte superposé) ─────────────────
  const _pm0=ld.displayPm;
  let _lblY=r+BH+8;
  if (_pm0!=null) {
    const pmMax0=ld.displayPmMax??1, pmRat0=pmMax0>0?Math.max(0,_pm0/pmMax0):1;
    const PMH=8;
    g.add(new K.Rect({ x:-bW/2, y:r+BH+6, width:bW, height:PMH, fill:'#0d1117', cornerRadius:4, listening:false }));
    g.add(new K.Rect({ x:-bW/2, y:r+BH+6, width:Math.max(2,bW*pmRat0), height:PMH, fill:'#9b6dff', cornerRadius:4, listening:false, name:'pm-fill' }));
    g.add(new K.Text({ x:-bW/2, y:r+BH+6, width:bW, height:PMH, align:'center', verticalAlign:'middle',
      text:`✨${_pm0}/${pmMax0}`, fontSize:7, fontStyle:'bold', fill:'#fff',
      shadowColor:'#000', shadowBlur:2, shadowOpacity:.9,
      fontFamily:'Inter,sans-serif', listening:false, name:'pm-val' }));
    _lblY=r+BH+PMH+10;
  }
  // ── Badge CA (coin haut-droit) ────────────────────────────────────
  g.add(new K.Circle({ x:r*.7, y:-r*.7, radius:10, fill:'rgba(15,15,25,0.9)',
    stroke:'#64748b', strokeWidth:1.5, listening:false, name:'ca-bg' }));
  g.add(new K.Text({ x:r*.7-10, y:-r*.7-6, width:20, height:12,
    text:`🛡${ld.displayDefense??0}`, fontSize:9, fontStyle:'bold',
    fill:'#e2e8f0', fontFamily:'Inter,sans-serif', align:'center', listening:false, name:'ca-lbl' }));
  // ── Nom ───────────────────────────────────────────────────────────
  g.add(new K.Text({ text:ld.displayName??t.name, x:-bW/2, y:_lblY,
    width:bW, align:'center', fontSize:11, fontStyle:'bold', fill:'#fff',
    fontFamily:'Inter,sans-serif', name:'lbl',
    shadowColor:'#000', shadowBlur:4, shadowOpacity:1 }));

  // ── Image ronde (K.Group clipper pour repère correct) ─────────────
  const imgSrc = ld.displayImage;
  if (imgSrc) {
    const clipGrp = new K.Group({ clipFunc: ctx => { ctx.arc(0,0,r,0,Math.PI*2,false); }, listening:false });
    const el=new Image(); el.crossOrigin='anonymous';
    el.onload = () => {
      clipGrp.add(new K.Image({ image:el, x:-r, y:-r, width:r*2, height:r*2, listening:false }));
      clipGrp.zIndex(2); _layers.token.batchDraw();
    };
    el.src = imgSrc;
    g.add(clipGrp); clipGrp.zIndex(2);
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
    if (_tool === 'ruler' || _tool === 'draw') return; // outils de dessin ignorent les tokens
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
  const rat=hpm>0?Math.max(0,hp/hpm):1, bW=CELL*0.9;
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
      fill:blk?'rgba(239,68,68,0.22)':'rgba(79,140,255,0.28)',
      stroke:blk?'rgba(239,68,68,0.65)':'rgba(79,140,255,0.70)',strokeWidth:1.5,listening:!blk });
    if (!blk){const tc=c,tr=r;rect.on('click',async e=>{e.cancelBubble=true;if(_selected)await _moveTo(_selected,tc,tr);});}
    _layers.grid.add(rect); _moveHL.push(rect);
  }
  _layers.grid.batchDraw();
}
function _clearHL() { _moveHL.forEach(r=>r.destroy()); _moveHL=[]; _layers.grid?.batchDraw(); }

// ── Pings ────────────────────────────────────────────────────────────
async function _emitPing(wx, wy) {
  const uid = STATE.user?.uid; if (!uid || !_activePage) return;
  const authorName = STATE.profile?.pseudo || STATE.profile?.prenom || 'Joueur';
  const color = '#ffe600'; // jaune néon — visible sur toutes les cartes
  try {
    await setDoc(_pingRef(uid), {
      x: wx, y: wy, pageId: _activePage.id,
      authorName, color, createdAt: serverTimestamp(),
    });
  } catch(e) { console.warn('[vtt] ping:', e); }
}

function _animatePing({ id, x, y, color }, pingKey) {
  if (!_layers.ping) return;
  const K = window.Konva;
  const g = new K.Group({ x, y, listening: false });

  // Halo blanc central (flash d'impact)
  const flash = new K.Circle({ radius: 28, fill: 'white', opacity: 0.9,
    shadowColor: 'white', shadowBlur: 30, shadowOpacity: 1 });
  // Point coloré persistant
  const dot   = new K.Circle({ radius: 16, fill: color, opacity: 1,
    shadowColor: color, shadowBlur: 20, shadowOpacity: 1 });
  // 4 anneaux expansifs
  const mkRing = (sw, op) => new K.Circle({ radius: 24, stroke: color, strokeWidth: sw,
    fill: 'transparent', opacity: op, shadowColor: color, shadowBlur: 12, shadowOpacity: 0.8 });
  const ring1 = mkRing(5, 1);
  const ring2 = mkRing(4, 0.85);
  const ring3 = mkRing(3, 0.65);
  const ring4 = mkRing(2, 0.45);
  g.add(flash, ring1, ring2, ring3, ring4, dot);
  _layers.ping.add(g);
  _layers.ping.batchDraw();

  const upd = () => _layers.ping?.batchDraw();
  // Flash s'efface rapidement
  new K.Tween({ node: flash, duration: 0.35, radius: 50, opacity: 0, easing: K.Easings.EaseOut, onUpdate: upd }).play();
  // Anneaux s'expandent en cascade
  new K.Tween({ node: ring1, duration: 1.2,           radius: 120, opacity: 0, easing: K.Easings.EaseOut, onUpdate: upd }).play();
  new K.Tween({ node: ring2, duration: 1.4, delay: 0.12, radius: 170, opacity: 0, easing: K.Easings.EaseOut, onUpdate: upd }).play();
  new K.Tween({ node: ring3, duration: 1.6, delay: 0.24, radius: 220, opacity: 0, easing: K.Easings.EaseOut, onUpdate: upd }).play();
  new K.Tween({ node: ring4, duration: 1.8, delay: 0.36, radius: 280, opacity: 0, easing: K.Easings.EaseOut, onUpdate: upd }).play();
  // Point disparaît en dernier
  new K.Tween({ node: dot, duration: 0.5, delay: 1.5, opacity: 0, easing: K.Easings.EaseIn,
    onFinish: () => { g.destroy(); _layers.ping?.batchDraw(); } }).play();

  setTimeout(() => _renderedPings.delete(pingKey), 4000);
}

function _renderPings(pings) {
  for (const p of pings) {
    const pingKey = `${p.id}_${p.createdAt?.toMillis?.() ?? 0}`;
    if (_renderedPings.has(pingKey)) continue;
    _renderedPings.add(pingKey);
    _animatePing(p, pingKey);
  }
}

// ── Réaction émote style stream — toujours bas-droite, indépendant du zoom ──
function _showEmoteBubble(tokenId, emoteUrl, emoteName, key) {
  if (_renderedReactions.has(key)) return;
  _renderedReactions.add(key);

  // Injecter le CSS une seule fois
  if (!document.getElementById('vtt-emote-anim-css')) {
    const s = document.createElement('style');
    s.id = 'vtt-emote-anim-css';
    s.textContent = `
      @keyframes vttEmoteRise {
        0%   { transform: scale(0.1)  translateY(0px);   opacity: 0; }
        12%  { transform: scale(1.22) translateY(0px);   opacity: 1; }
        22%  { transform: scale(1)    translateY(0px);   opacity: 1; }
        78%  { transform: scale(1)    translateY(-155px);opacity: 1; }
        100% { transform: scale(0.08) translateY(-180px);opacity: 0; }
      }
      .vtt-emote-bubble {
        position: absolute; bottom: 0; right: 0;
        width: 104px; height: 104px; border-radius: 50%;
        background: #fff;
        box-shadow: 0 6px 22px rgba(0,0,0,0.5);
        overflow: hidden;
        animation: vttEmoteRise 3.6s cubic-bezier(.22,.8,.46,1) forwards;
        pointer-events: none;
      }
      .vtt-emote-bubble img {
        width: 96px; height: 96px;
        object-fit: cover; border-radius: 50%;
        position: absolute; top: 4px; left: 4px;
      }
    `;
    document.head.appendChild(s);
  }

  // Créer ou réutiliser l'overlay (coin bas-droit du canvas, z-index au-dessus de la vignette)
  const wrap = document.getElementById('vtt-canvas-wrap');
  if (!wrap) return;
  let overlay = document.getElementById('vtt-emote-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'vtt-emote-overlay';
    overlay.style.cssText = 'position:absolute;bottom:18px;right:18px;width:0;height:0;pointer-events:none;z-index:20;overflow:visible';
    wrap.appendChild(overlay);
  }

  const bubble = document.createElement('div');
  bubble.className = 'vtt-emote-bubble';
  const img = document.createElement('img');
  img.src = emoteUrl; img.alt = emoteName;
  bubble.appendChild(img);
  overlay.appendChild(bubble);
  bubble.addEventListener('animationend', () => bubble.remove(), { once: true });
}

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
      fill:'rgba(239,68,68,0.22)', stroke:'rgba(239,68,68,0.65)', strokeWidth:1.5, listening:false });
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

/** Valeur maximale possible d'une formule de dés (ex: "2d6+3" → 15). */
function _maxDice(formula) {
  if (!formula) return 1;
  const m = String(formula).match(/^(\d+)[dD](\d+)([+-]\d+)?$/);
  if (!m) return Math.max(1, parseInt(formula)||1);
  return parseInt(m[1]) * parseInt(m[2]) + (parseInt(m[3])||0);
}

/**
 * Formule de dégâts calculée d'un sort offensif.
 * Miroir local de _calcSortDegats (spells.js) — évite le cross-import.
 * Inclut : dés de base + runes Puissance/Protection + chaînage + maîtrise arme principale.
 */
function _vttSortDmgFormula(s, c) {
  const mainP   = c?.equipement?.['Main principale'];
  const armeDeg = mainP?.degats || '1d6';
  let base = (s.degats || '').trim();
  if (!base || base.toLowerCase() === '= arme') base = armeDeg;
  const runes    = s.runes || [];
  const nbPuiss  = runes.filter(r => r === 'Puissance').length;
  const nbProt   = runes.filter(r => r === 'Protection').length;
  const totalPP  = nbPuiss + nbProt;
  const bonusVal = totalPP > 1 ? (totalPP - 1) * 2 : 0;
  const maitrise = getMaitriseBonus(c, mainP || {});
  const m = base.match(/^(\d+)(d\d+)(.*)$/i);
  if (m) {
    let r = `${parseInt(m[1]) + totalPP}${m[2]}${m[3]}`;
    const tot = bonusVal + maitrise;
    if (tot > 0) r += ` +${tot}`; else if (tot < 0) r += ` ${tot}`;
    return r;
  }
  let r = base;
  if (totalPP > 0) r += ` +${totalPP}d6`;
  const tot = bonusVal + maitrise;
  if (tot > 0) r += ` +${tot}`; else if (tot < 0) r += ` ${tot}`;
  return r;
}

/**
 * Formule de soin calculée d'un sort défensif (mode soin).
 * Miroir local de _calcSortSoin (spells.js).
 * Inclut : 1d4 base + runes Protection + chaînage + maîtrise arme principale.
 */
function _vttSortSoinFormula(s, c) {
  const mainP    = c?.equipement?.['Main principale'];
  const maitrise = getMaitriseBonus(c, mainP || {});
  const runes    = s.runes || [];
  const nbProt   = runes.filter(r => r === 'Protection').length;
  const chainSoin = nbProt > 1 ? nbProt - 1 : 0;
  const base     = (s.soin || '').trim();
  const maitrStr = maitrise > 0 ? ` +${maitrise}` : maitrise < 0 ? ` ${maitrise}` : '';
  if (!base || base.toLowerCase() === '= base') {
    let r = `${1 + nbProt}d4`;
    if (chainSoin > 0) r += ` +${chainSoin * 2}`;
    return r + maitrStr;
  }
  if (nbProt > 0) {
    const m = base.match(/^(\d+)(d\d+)(.*)$/i);
    if (m) {
      let r = `${parseInt(m[1]) + nbProt}${m[2]}${m[3]}`;
      if (chainSoin > 0) r += ` +${chainSoin * 2}`;
      return r + maitrStr;
    }
    return base;
  }
  return maitrStr ? base + maitrStr : base;
}

/**
 * Nombre de cibles d'un sort (rune Dispersion).
 * Miroir local de _calcSortCibles (spells.js).
 * 0 rune = 1 cible ; N runes = 2N cibles (chaînage).
 */
function _vttSortCibles(s) {
  const n = (s.runes || []).filter(r => r === 'Dispersion').length;
  return n === 0 ? 1 : 1 + n + (n - 1); // = 2N
}

/** Sépare "NdM +K +L" en { rawDice:"NdM", fixed:K+L }. */
function _splitDiceFormula(str) {
  const s = String(str || '').replace(/\s+/g, '');
  const dm = s.match(/^(\d+d\d+)/i);
  if (!dm) return { rawDice: str, fixed: 0 };
  const rawDice = dm[1];
  let fixed = 0;
  const re = /([+-])(\d+)/g;
  let m;
  while ((m = re.exec(s.slice(rawDice.length))) !== null) {
    fixed += m[1] === '+' ? parseInt(m[2]) : -parseInt(m[2]);
  }
  return { rawDice, fixed };
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
        id:      `beast_${idx}`,
        icon:    '👹',
        label:   atk.nom || `Attaque ${idx+1}`,
        dice:    atk.degats,
        toucher: atk.toucher !== undefined && atk.toucher !== '' ? parseInt(atk.toucher)||0 : null,
        portee:  parseInt(atk.portee)||1,
        pmCost:  0,
      });
    });
    if (options.length) return options;
  }

  // ── Arme principale du personnage (ou attaque générique) ──
  const weapon      = c?.equipement?.['Main principale'];
  const wDmgStat    = weapon?.degatsStats?.[0] || weapon?.degatsStat || 'force';
  const isUnarmed   = !weapon?.nom;
  const wDmgStat2   = isUnarmed ? 'force' : (weapon?.degatsStats?.[0] || weapon?.degatsStat || 'force');
  const wTchStat    = isUnarmed ? 'force' : (weapon?.toucherStats?.[0] || weapon?.toucherStat || wDmgStat2);
  const wDmgMod     = c ? getMod(c, wDmgStat2) : 0;
  const wTchMod     = c ? getMod(c, wTchStat)  : 0;
  const wSetBonus   = c ? (getArmorSetData(c).modifiers.toucherBonus || 0) : 0;
  const wMaitrise   = c && weapon ? getMaitriseBonus(c, weapon) : 0;
  // Armes magiques à 2 mains → ½ dégâts garanti même sur raté
  const MAG_2H      = ['Arme 2M CaC Mag.', 'Arme 2M Dist Mag.'];
  const halfOnMiss  = MAG_2H.includes(weapon?.format || '');

  options.push({
    id:               'weapon',
    icon:             isUnarmed ? '👊' : '⚔️',
    label:            isUnarmed ? 'Coup de poing' : (weapon.nom || 'Attaque de base'),
    rawDice:          isUnarmed ? '2d4' : (weapon?.degats || '1d6'),
    dice:             isUnarmed ? `2d4${wDmgMod!==0?(wDmgMod>0?'+':'')+wDmgMod:''}` : (ld.displayAttackDice || '1d6'),
    portee:           ld.displayRange ?? 1,
    pmCost:           0,
    toucherMod:       wTchMod,
    toucherSetBonus:  wSetBonus,
    toucherStatLabel: statShort(wTchStat) || wTchStat,
    dmgStatMod:       wDmgMod,
    dmgStatLabel:     statShort(wDmgStat2) || wDmgStat2,
    maitriseBonus:    wMaitrise,
    halfOnMiss,
  });

  // ── Tous les sorts actifs du deck ──
  if (c?.deck_sorts?.length) {
    const mainP2      = c?.equipement?.['Main principale'];
    const sStatKey    = mainP2?.statAttaque || mainP2?.toucherStat || 'force';
    const sStatMod    = getMod(c, sStatKey);
    const sStatLbl    = statShort(sStatKey) || sStatKey;
    // Réduction PM du set léger (spellPmDelta est négatif pour le set léger → coût réduit)
    const spellPmDelta = c ? (getArmorSetData(c).modifiers.spellPmDelta || 0) : 0;

    c.deck_sorts.forEach((s, idx) => {
      if (!s.actif) return;
      const portee    = parseInt(s.portee) || ld.displayRange || 1;
      const types     = Array.isArray(s.types) && s.types.length ? s.types
                      : (s.typeSoin ? ['defensif'] : (s.noyau ? ['offensif'] : ['utilitaire']));
      const protMode  = s.protectionMode || 'ca';
      const nbCibles  = _vttSortCibles(s);

      // Coût PM : applique le delta du set, puis vérifie si cible gratuite (multi-cibles)
      const basePm    = Math.max(0, (parseInt(s.pm) || 0) + spellPmDelta);
      const freeKey   = `${t.id}_${idx}`;
      const freeCasts = _multiCastFree.get(freeKey) || 0;
      const cout      = freeCasts > 0 ? 0 : basePm;

      if (types.includes('offensif')) {
        const fullFormula = _vttSortDmgFormula(s, c);
        const { rawDice: sRawDice, fixed: sFixed } = _splitDiceFormula(fullFormula);
        options.push({
          id: `sort_${idx}`, icon: '✨', label: s.nom || `Sort ${idx+1}`,
          rawDice: sRawDice, dice: fullFormula,
          portee, pmCost: cout, basePm, sortIdx: idx, nbCibles,
          halfOnMiss: true,
          toucherMod: wTchMod, toucherSetBonus: wSetBonus,
          toucherStatLabel: statShort(wTchStat) || wTchStat,
          dmgStatMod: sStatMod, dmgStatLabel: sStatLbl,
          maitriseBonus: sFixed,
        });

      } else if (types.includes('defensif') && protMode === 'soin') {
        const soinFormula = _vttSortSoinFormula(s, c);
        const { rawDice: sRawDice, fixed: sFixed } = _splitDiceFormula(soinFormula);
        options.push({
          id: `sort_${idx}`, icon: '💚', label: s.nom || `Sort ${idx+1}`,
          rawDice: sRawDice, dice: soinFormula,
          portee, pmCost: cout, basePm, sortIdx: idx, nbCibles,
          isHeal: true, halfOnMiss: false, maitriseBonus: sFixed,
        });

      } else if (types.includes('defensif') && protMode === 'ca') {
        options.push({
          id: `sort_${idx}`, icon: '🛡️', label: s.nom || `Sort ${idx+1}`,
          dice: s.ca || 'CA +2 (2 tours)',
          portee, pmCost: cout, basePm, sortIdx: idx, nbCibles,
          isCaSort: true, halfOnMiss: false,
        });

      } else {
        options.push({
          id: `sort_${idx}`, icon: '✨', label: s.nom || `Sort ${idx+1}`,
          dice: s.effet ? s.effet.slice(0, 40) : '—',
          portee, pmCost: cout, basePm, sortIdx: idx, nbCibles,
          isUtil: true, halfOnMiss: false,
        });
      }
    });
  }

  return options;
}

// Cache des options d'attaque — évite tout JSON/HTML dans les onclick
const _atkOptsCache = {};
// Contexte de l'attaque en cours (multi-étapes)
let _atkCtx = null;
// Sorts multi-cibles : casts gratuits restants — key: "${tokenId}_${sortIdx}"
const _multiCastFree = new Map();

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
              🎲 ${o.rawDice || o.dice}
              · 🎯 portée ${o.portee}
              ${(o.nbCibles||1)>1?`· <span style="color:#4f8cff">×${o.nbCibles} cibles</span>`:''}
              ${o.pmCost>0?`· <span style="color:#b47fff">✨ ${o.pmCost} PM</span>`:o.pmCost===0&&o.basePm>0?`· <span style="color:#22c38e">✨ gratuit</span>`:''}
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
  if (!opt) return;
  closeModalDirect();
  const src=_tokens[srcId]?.data, tgt=_tokens[tgtId]?.data;
  if (!src||!tgt) return;
  const lS=_live(src), lT=_live(tgt);
  _atkCtx = { srcId, tgtId, opt, lS, lT };

  const dist    = Math.max(Math.abs(src.col-tgt.col),Math.abs(src.row-tgt.row));
  const atkBase = opt.toucher !== null && opt.toucher !== undefined ? opt.toucher : (lS.displayAttack ?? 5);
  const sn      = n => n>0?`+${n}`:n<0?`${n}`:'';
  const tag     = (txt, col='var(--text-dim)') =>
    `<span style="font-size:.6rem;color:${col};margin-left:.05rem">(${txt})</span>`;

  // ── Formule toucher ────────────────────────────────────────────────
  let toucherFormula;
  if (opt.toucherMod !== undefined) {
    const p = [`<code style="font-size:.88rem;color:var(--gold)">1d20</code>`];
    if (opt.toucherMod !== 0)
      p.push(`<span style="font-size:.85rem;color:var(--gold)">${sn(opt.toucherMod)}</span>${tag(opt.toucherStatLabel)}`);
    if (opt.toucherSetBonus > 0)
      p.push(`<span style="font-size:.85rem;color:#22c38e">+${opt.toucherSetBonus}</span>${tag('Set','#22c38e')}`);
    toucherFormula = p.join(' ');
  } else {
    toucherFormula = `<code style="font-size:.88rem;color:var(--gold)">1d20</code>`
      + (atkBase!==0 ? ` <span style="font-size:.82rem;color:var(--text-muted)">${sn(atkBase)}</span>` : '');
  }

  // ── Formule dégâts / soin ────────────────────────────────────────────
  const dmgAccent = opt.isHeal ? '#22c38e' : '#ef4444';
  let degatsFormula;
  if (opt.rawDice !== undefined) {
    const p = [`<code style="font-size:.88rem;color:${dmgAccent}">${opt.rawDice}</code>`];
    if (opt.dmgStatMod)
      p.push(`<span style="font-size:.85rem;color:${dmgAccent}">${sn(opt.dmgStatMod)}</span>${tag(opt.dmgStatLabel)}`);
    if (opt.maitriseBonus > 0)
      p.push(`<span style="font-size:.85rem;color:#f59e0b">+${opt.maitriseBonus}</span>${tag('Maîtrise')}`);
    degatsFormula = p.join(' ');
  } else {
    degatsFormula = `<code style="font-size:.88rem;color:${dmgAccent}">${_escHtml(opt.dice)}</code>`;
  }

  const inpStyle = `width:52px;padding:4px 6px;text-align:center;font-size:.88rem;border-radius:7px;
    border:1px solid var(--border);background:var(--bg-base,var(--bg));color:var(--text);font-family:inherit`;

  // Bloc central conditionnel selon le type
  const isCastOnly = opt.isCaSort || opt.isUtil;
  const btnColor   = opt.isHeal ? '#22c38e' : isCastOnly ? '#b47fff' : 'var(--gold,#f59e0b)';
  const btnFg      = opt.isHeal || isCastOnly ? '#fff' : '#1a1a1a';
  const btnLabel   = opt.isHeal ? '💚 Soigner !' : isCastOnly ? '✨ Activer !' : '🎲 Lancer !';

  const centerBlock = isCastOnly ? `
    <div style="background:var(--bg-elevated);border-radius:10px;padding:.85rem;margin-bottom:.85rem;
                display:flex;align-items:center;gap:.6rem">
      <span style="font-size:1.2rem">${opt.icon}</span>
      <span style="font-size:.82rem;color:var(--text);flex:1">${degatsFormula}</span>
    </div>
  ` : opt.isHeal ? `
    <div style="background:var(--bg-elevated);border-radius:10px;padding:.7rem .85rem;margin-bottom:.85rem">
      <div style="display:grid;grid-template-columns:auto 1fr auto;align-items:center;row-gap:.6rem;column-gap:.7rem">
        <span style="font-size:.68rem;color:#22c38e;white-space:nowrap">💚 Soin</span>
        <div style="display:flex;align-items:center;gap:.28rem;flex-wrap:wrap;min-width:0">${degatsFormula}</div>
        <input type="number" id="atk-bonus-dmg" value="0" style="${inpStyle}" placeholder="±0" title="Bonus / malus au soin">
      </div>
    </div>
  ` : `
    <div style="background:var(--bg-elevated);border-radius:10px;padding:.7rem .85rem;margin-bottom:.85rem">
      <div style="display:grid;grid-template-columns:auto 1fr auto;align-items:center;row-gap:.6rem;column-gap:.7rem">
        <span style="font-size:.68rem;color:var(--text-dim);white-space:nowrap">🎯 Toucher</span>
        <div style="display:flex;align-items:center;gap:.28rem;flex-wrap:wrap;min-width:0">${toucherFormula}</div>
        <input type="number" id="atk-bonus-hit" value="0" style="${inpStyle}" placeholder="±0" title="Bonus / malus au toucher">

        <div style="grid-column:1/-1;height:1px;background:var(--border);margin:-.1rem 0"></div>

        <span style="font-size:.68rem;color:var(--text-dim);white-space:nowrap">⚔️ Dégâts</span>
        <div style="display:flex;align-items:center;gap:.28rem;flex-wrap:wrap;min-width:0">${degatsFormula}</div>
        <input type="number" id="atk-bonus-dmg" value="0" style="${inpStyle}" placeholder="±0" title="Bonus / malus aux dégâts">
        ${opt.halfOnMiss ? `<div style="grid-column:1/-1;display:flex;align-items:center;gap:.3rem;
          font-size:.65rem;color:#b47fff;padding:.25rem .1rem 0">
          <span>✦</span><span>½ dégâts garantis même en cas d'échec</span>
        </div>` : ''}
      </div>
    </div>

    <!-- Sélecteur de mode -->
    <div style="margin-bottom:.85rem">
      <div style="font-size:.6rem;text-transform:uppercase;letter-spacing:.09em;color:var(--text-dim);margin-bottom:.4rem">Mode de lancer</div>
      <div style="display:flex;gap:2px;background:var(--border);border-radius:9px;padding:3px">
        <button id="atk-mode-dis" onclick="window._vttSetMode('dis')"
          style="flex:1;padding:.5rem .3rem;border:none;border-radius:6px;cursor:pointer;font-family:inherit;
                 font-size:.7rem;line-height:1.35;background:transparent;color:var(--text-dim);transition:none">
          <div style="font-size:.9rem">⬇</div>Désavantage
        </button>
        <button id="atk-mode-normal" onclick="window._vttSetMode('normal')"
          style="flex:1;padding:.5rem .3rem;border:none;border-radius:6px;cursor:pointer;font-family:inherit;
                 font-size:.75rem;font-weight:700;background:var(--bg-elevated);color:var(--text)">
          Normal
        </button>
        <button id="atk-mode-adv" onclick="window._vttSetMode('adv')"
          style="flex:1;padding:.5rem .3rem;border:none;border-radius:6px;cursor:pointer;font-family:inherit;
                 font-size:.7rem;line-height:1.35;background:transparent;color:var(--text-dim);transition:none">
          <div style="font-size:.9rem">⬆</div>Avantage
        </button>
      </div>
    </div>
  `;

  openModal(`${opt.icon} ${opt.label}`, `
    <div class="vtt-form" style="min-width:260px;max-width:340px">

      <!-- En-tête : retour + attaquant → cible -->
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.85rem">
        <button onclick="window._vttBackToAtk()"
          style="flex-shrink:0;display:flex;align-items:center;gap:.25rem;background:none;
                 border:1px solid var(--border);border-radius:7px;color:var(--text-dim);
                 cursor:pointer;font-family:inherit;font-size:.75rem;padding:.3rem .55rem;
                 white-space:nowrap">
          ← Retour
        </button>
        <div style="flex:1;min-width:0;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.82rem">
          <strong>${_escHtml(lS.displayName??src.name)}</strong>
          <span style="color:var(--text-dim);margin:0 .3rem">→</span>
          <strong style="color:${opt.isHeal?'#22c38e':'#ef4444'}">${_escHtml(lT.displayName??tgt.name)}</strong>
        </div>
        <span style="flex-shrink:0;font-size:.62rem;color:var(--text-dim);background:var(--bg-elevated);
                     padding:.18rem .45rem;border-radius:999px">${dist}c</span>
      </div>

      ${centerBlock}

      <!-- Infos multi-cibles + PM -->
      ${(opt.nbCibles||1) > 1 || opt.pmCost > 0 || (opt.pmCost===0 && opt.basePm>0) ? `
      <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.7rem">
        ${(opt.nbCibles||1)>1?`<span style="font-size:.7rem;color:#4f8cff;display:flex;align-items:center;gap:.25rem">
          🎯 <strong>${opt.nbCibles}</strong> cibles différentes
          ${opt.pmCost===0&&opt.basePm>0?'<span style="color:#22c38e;font-size:.65rem">(PM déjà payé)</span>':''}
        </span>`:''}
        ${opt.pmCost>0?`<span style="font-size:.7rem;color:#b47fff">✨ ${opt.pmCost} PM</span>`:''}
        ${opt.pmCost===0&&opt.basePm>0&&(opt.nbCibles||1)<=1?`<span style="font-size:.7rem;color:#22c38e">✨ Gratuit</span>`:''}
      </div>` : ''}

      <!-- Bouton Lancer -->
      <input type="hidden" id="atk-mode" value="normal">
      <button onclick="window._vttRollAttack()"
        style="width:100%;height:46px;border:none;border-radius:10px;cursor:pointer;font-family:inherit;
               font-size:.95rem;font-weight:700;letter-spacing:.02em;
               background:${btnColor};color:${btnFg}">
        ${btnLabel}
      </button>

    </div>`);
};

window._vttCancelAtk  = () => { _atkCtx=null; closeModalDirect(); };

/** Retourne à la liste de sélection d'attaque sans annuler le combat. */
window._vttBackToAtk  = () => {
  const ctx = _atkCtx;
  closeModalDirect();
  _atkCtx = null;
  if (ctx) _execAttack(ctx.srcId, ctx.tgtId);
};

/** Met à jour le toggle Désavantage / Normal / Avantage. */
window._vttSetMode = (mode) => {
  const cfg = {
    dis:    { bg:'rgba(239,68,68,.18)',  color:'#f87171', weight:'700' },
    normal: { bg:'var(--bg-elevated)',   color:'var(--text)', weight:'700' },
    adv:    { bg:'rgba(34,195,142,.18)', color:'#22c38e', weight:'700' },
  };
  const off = { bg:'transparent', color:'var(--text-dim)', weight:'400' };
  ['dis','normal','adv'].forEach(m => {
    const el = document.getElementById(`atk-mode-${m}`);
    if (!el) return;
    const s = m === mode ? cfg[m] : off;
    el.style.background  = s.bg;
    el.style.color       = s.color;
    el.style.fontWeight  = s.weight;
  });
  const inp = document.getElementById('atk-mode');
  if (inp) inp.value = mode;
};

window._vttRollAttack = async () => {
  const ctx = _atkCtx; if (!ctx) return;
  const mode     = document.getElementById('atk-mode')?.value || 'normal';
  const bonusHit = parseInt(document.getElementById('atk-bonus-hit')?.value)||0;
  const bonusDmg = parseInt(document.getElementById('atk-bonus-dmg')?.value)||0;
  closeModalDirect();
  _atkCtx = null;

  const { srcId, tgtId, opt, lS, lT } = ctx;
  const src=_tokens[srcId]?.data, tgt=_tokens[tgtId]?.data;
  if (!src||!tgt) return;

  const authorName = STATE.profile?.pseudo||STATE.profile?.prenom||STATE.user?.displayName||'MJ';
  const _deductPm  = async () => {
    if (opt.pmCost > 0 && src.characterId) {
      const c = _characters[src.characterId];
      if (c) await updateDoc(_chrRef(src.characterId), {pm: Math.max(0, (c.pm ?? calcPMMax(c)) - opt.pmCost)});
    }
  };
  const _markAttacked = async () => {
    if (_session?.combat?.active) await updateDoc(_tokRef(src.id), {attackedThisTurn:true}).catch(()=>{});
  };
  const _cleanup = () => {
    _tokens[srcId]?.shape?.findOne('.atk')?.visible(false);
    _tokens[_selected]?.shape?.findOne('.sel')?.visible(false);
    _selected=null; _attackSrc=null; _clearHL(); _renderInspector(null);
    _layers.token?.batchDraw();
  };

  /** Met à jour _multiCastFree et retourne le nombre de cibles restantes. */
  const _handleMultiCast = () => {
    if ((opt.nbCibles||1) <= 1 || opt.sortIdx === undefined) return 0;
    const freeKey = `${srcId}_${opt.sortIdx}`;
    const already = _multiCastFree.get(freeKey);
    if (already == null) {
      // Première cible (PM payé) : enregistrer les casts gratuits restants
      _multiCastFree.set(freeKey, opt.nbCibles - 1);
      setTimeout(() => _multiCastFree.delete(freeKey), 120_000);
      return opt.nbCibles - 1;
    }
    // Cast gratuit : décrémenter
    const nv = already - 1;
    nv > 0 ? _multiCastFree.set(freeKey, nv) : _multiCastFree.delete(freeKey);
    return nv;
  };
  const _ciblSuffix = r => r > 0 ? ` · 🎯 ${r} cible${r>1?'s':''} restante${r>1?'s':''}` : '';

  try {

    // ── Vérification PM ──────────────────────────────────────────────
    if (opt.pmCost > 0 && src.characterId) {
      const cPm = _characters[src.characterId];
      if (cPm) {
        const actualPm = cPm.pm ?? calcPMMax(cPm);
        if (actualPm < opt.pmCost) {
          showNotif(`⚠ PM insuffisants (${actualPm}/${opt.pmCost} requis)`, 'error');
          _cleanup(); return;
        }
      }
    }

    // ── CA / Utilitaire : juste consommer le PM, loguer ─────────────
    if (opt.isCaSort || opt.isUtil) {
      await _deductPm();
      await _markAttacked();
      const rCa = _handleMultiCast();
      await addDoc(_logCol(), {
        type:'cast',
        authorId: STATE.user?.uid||null, authorName,
        casterName: lS.displayName??src.name,
        characterImage: lS.displayImage||null,
        targetName: lT.displayName??tgt.name,
        optLabel: opt.label, pmCost: opt.pmCost,
        castEffect: opt.dice,
        createdAt: serverTimestamp(),
      }).catch(()=>{});
      showNotif(`✨ ${opt.label} activé !${_ciblSuffix(rCa)}`, 'success');
      _cleanup();
      return;
    }

    // ── Soin : roll du soin, ajout de PV à la cible ─────────────────
    if (opt.isHeal) {
      const diceToRoll = opt.rawDice || opt.dice;
      const healFixed  = (opt.maitriseBonus || 0) + bonusDmg;
      const healRaw    = _rollDice(diceToRoll);
      const healTotal  = Math.max(1, healRaw + healFixed);
      const curHp  = lT.displayHp ?? 20, hpMax = lT.displayHpMax ?? 20;
      const newHp  = Math.min(hpMax, curHp + healTotal);
      await _setHp(tgt, newHp);
      await _deductPm();
      await _markAttacked();
      const rHeal = _handleMultiCast();
      await addDoc(_logCol(), {
        type:'attack', isHeal:true,
        authorId: STATE.user?.uid||null, authorName,
        attackerName: lS.displayName??src.name,
        characterImage: lS.displayImage||null,
        defenderName: lT.displayName??tgt.name,
        optLabel: opt.label,
        dmgFormula: opt.dice, dmgRawDice: opt.rawDice||null,
        dmgMaitriseBonus: opt.maitriseBonus??0,
        dmgRaw: healRaw, dmgBonus: bonusDmg, dmgTotal: healTotal,
        newHp, hpMax,
        createdAt: serverTimestamp(),
      }).catch(()=>{});
      showNotif(`💚 ${healTotal} PV soignés → ${lT.displayName??tgt.name}${_ciblSuffix(rHeal)}`, 'success');
      _cleanup();
      return;
    }

    // ── Attaque offensive ─────────────────────────────────────────────
    const roll1    = Math.floor(Math.random()*20)+1;
    const roll2    = mode !== 'normal' ? Math.floor(Math.random()*20)+1 : null;
    const d20      = mode === 'adv' ? Math.max(roll1, roll2)
                   : mode === 'dis' ? Math.min(roll1, roll2)
                   : roll1;
    const isCrit   = d20 === 20;
    const isFumble = d20 === 1;
    const atkBase  = opt.toucher !== null && opt.toucher !== undefined ? opt.toucher : (lS.displayAttack ?? 5);
    const hitTotal = d20 + atkBase + bonusHit;
    const targetCA = lT.displayDefense ?? 10;
    const hit      = isCrit ? true : isFumble ? false : hitTotal >= targetCA;

    const diceToRoll = opt.rawDice || opt.dice;
    const dmgFixed   = opt.rawDice !== undefined ? ((opt.dmgStatMod || 0) + (opt.maitriseBonus || 0)) : 0;

    let dmgRaw=0, dmgTotal=0, critNormalMax=0, critRaw2=0, critFixed2=0;
    let halfDmg = false;
    if (hit) {
      if (isCrit) {
        critNormalMax = _maxDice(diceToRoll) + dmgFixed + bonusDmg;
        critRaw2      = _rollDice(diceToRoll);
        critFixed2    = dmgFixed + bonusDmg;
        dmgRaw        = critRaw2;
        dmgTotal      = critNormalMax + critRaw2 + critFixed2;
      } else {
        dmgRaw   = _rollDice(diceToRoll);
        dmgTotal = Math.max(1, dmgRaw + dmgFixed + bonusDmg);
      }
    } else if (opt.halfOnMiss && !isFumble) {
      // ½ dégâts sur raté — SAUF échec critique (nat 1 = 0 dégâts)
      halfDmg  = true;
      dmgRaw   = _rollDice(diceToRoll);
      dmgTotal = Math.max(1, Math.floor(Math.max(1, dmgRaw + dmgFixed + bonusDmg) / 2));
    }

    const isEstimated = !STATE.isAdmin && tgt.type==='enemy' && tgt.beastId;
    const curHp = lT.displayHp??20, hpMax = lT.displayHpMax??20;
    const newHp = (hit || halfDmg) ? Math.max(0, curHp - dmgTotal) : curHp;

    if (hit || halfDmg) {
      if (isEstimated) {
        const uid=STATE.user?.uid;
        if (uid) {
          if (!_bstTracker[tgt.beastId]) _bstTracker[tgt.beastId]={};
          _bstTracker[tgt.beastId].pvCombat=newHp;
          await setDoc(_bstTrackerRef(uid),{data:_bstTracker});
        }
      } else {
        await _setHp(tgt, newHp);
      }
    }
    await _deductPm();
    await _markAttacked();
    const rAtk = _handleMultiCast();

    await addDoc(_logCol(),{
      type: 'attack',
      authorId: STATE.user?.uid||null, authorName,
      attackerName: lS.displayName??src.name,
      characterImage: lS.displayImage||null,
      defenderName: lT.displayName??tgt.name,
      optLabel: opt.label,
      isCrit, isFumble,
      advMode: mode,
      hitD20: d20, hitD20rolls: roll2 !== null ? [roll1, roll2] : [roll1],
      hitBase: atkBase, hitBonus: bonusHit, hitTotal,
      hitToucherMod:      opt.toucherMod ?? null,
      hitToucherSetBonus: opt.toucherSetBonus ?? 0,
      hitToucherStatLabel:opt.toucherStatLabel ?? null,
      targetCA, hit,
      dmgFormula: opt.dice, dmgRawDice: opt.rawDice || null,
      dmgStatMod: opt.dmgStatMod ?? null, dmgStatLabel: opt.dmgStatLabel ?? null,
      dmgMaitriseBonus: opt.maitriseBonus ?? 0,
      dmgRaw, dmgBonus: bonusDmg, dmgTotal,
      critNormalMax, critRaw2, critFixed2,
      halfDmg, newHp, hpMax,
      createdAt: serverTimestamp(),
    }).catch(()=>{});

    const _baseNotif =
      isFumble    ? `💀 Échec critique !`
      : halfDmg   ? `✦ ${dmgTotal} dégâts (½) → ${lT.displayName??tgt.name}`
      : !hit      ? `🎯 Raté ! (${hitTotal})`
      : newHp===0 ? `💀 ${lT.displayName??tgt.name} tombe à 0 PV !`
      : isCrit    ? `💥 Critique ! ${dmgTotal} dégâts → ${lT.displayName??tgt.name}`
                  : `⚔️ ${dmgTotal} dégâts → ${lT.displayName??tgt.name}`;
    showNotif(_baseNotif + _ciblSuffix(rAtk), (hit || halfDmg) ? 'success' : 'error');

  } catch { showNotif('Erreur attaque','error'); }

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

  // ── Helpers rendu stats ──────────────────────────────────────────
  const _bar = (lbl, cur, max, col, editHtml='') => {
    const pct = max > 0 ? Math.round(Math.max(0, cur) / max * 100) : 0;
    const val = editHtml
      ? editHtml + '<span style="color:var(--text-muted)"> / '+max+'</span>'
      : '<span>'+cur+' / '+max+'</span>';
    return '<div class="vtt-ins-bar-row">' +
      '<span class="vtt-ins-bar-lbl">'+lbl+'</span>' +
      '<div class="vtt-ins-bar-track"><div class="vtt-ins-bar-fill" style="width:'+pct+'%;background:'+col+'"></div></div>' +
      '<span class="vtt-ins-bar-val">'+val+'</span>' +
    '</div>';
  };
  const _stat = (icon, lbl, val, full=false) =>
    '<div class="vtt-ins-stat'+(full?' full':'')+'">'+
      '<span class="vtt-ins-stat-label">'+icon+' '+lbl+'</span>'+
      '<span class="vtt-ins-stat-val">'+val+'</span>'+
    '</div>';

  // Précalcul du bloc stats (évite l'imbrication de backticks dans le template)
  let statsHtml;
  if (!STATE.isAdmin && t.type === 'enemy' && t.beastId) {
    const track    = _bstTracker[t.beastId] || {};
    const pvMax    = track.pvActuel   !== undefined ? parseInt(track.pvActuel)   : null;
    const pvCur    = track.pvCombat   !== undefined ? parseInt(track.pvCombat)   : pvMax;
    const pvPct    = pvMax > 0 ? Math.round((pvCur??pvMax) / pvMax * 100) : 0;
    const pvBarCol = pvPct > 50 ? '#22c38e' : pvPct > 25 ? '#f59e0b' : '#ef4444';
    const caLabel  = track.caEstimee  !== undefined ? String(track.caEstimee)  : '?';
    const vitLabel = track.vitEstimee !== undefined ? String(track.vitEstimee)+' cases' : '?';
    const pos      = t.pageId ? 'Col '+t.col+' · Lig '+t.row : 'Non placé';
    statsHtml =
      '<div class="vtt-ins-bars">' +
        (pvMax !== null
          ? _bar('PV', pvCur??pvMax, pvMax, pvBarCol)
          : '<div class="vtt-ins-bar-row"><span class="vtt-ins-bar-lbl">PV</span><span style="color:var(--text-muted);font-size:.75rem;grid-column:2/-1">inconnus</span></div>') +
      '</div>' +
      '<div class="vtt-ins-stats">' +
        _stat('🛡', 'CA est.', caLabel) +
        _stat('🏃', 'Vitesse', vitLabel) +
        _stat('⚔️', 'Attaque', '?') +
        _stat('🎯', 'Portée', '?') +
        _stat('📍', 'Position', pos, true) +
      '</div>' +
      '<div style="font-size:.62rem;color:var(--text-dim);font-style:italic">Valeurs issues de ton bestiaire personnel</div>';
  } else {
    const pos    = t.pageId ? 'Col '+t.col+' · Lig '+t.row : 'Non placé';
    const pm     = ld.displayPm    ?? null;
    const pmMax  = ld.displayPmMax ?? null;
    const pvEditHtml = STATE.isAdmin
      ? '<input class="vtt-ins-input" type="number" value="'+hp+'" min="0" max="'+hpm+'" onchange="window._vttSetHp(\''+t.id+'\',+this.value)">'
      : null;
    const pmEditHtml = (STATE.isAdmin && pm !== null && pmMax !== null)
      ? '<input class="vtt-ins-input" type="number" value="'+pm+'" min="0" max="'+pmMax+'" onchange="window._vttSetPm(\''+t.id+'\',+this.value)">'
      : null;
    statsHtml =
      '<div class="vtt-ins-bars">' +
        _bar('PV', hp, hpm, hpColor(rat), pvEditHtml) +
        (pm !== null && pmMax !== null ? _bar('PM', pm, pmMax, '#b47fff', pmEditHtml) : '') +
      '</div>' +
      '<div class="vtt-ins-stats">' +
        _stat('🏃', 'Mouvement', (ld.displayMovement??6)+' cases') +
        _stat('⚔️', 'Attaque', ld.displayAttackDice || (ld.displayAttack??5)) +
        _stat('🛡', 'CA', ld.displayDefense??0) +
        _stat('🎯', 'Portée', (ld.displayRange??1)+' case(s)') +
        _stat('📍', 'Position', pos, true) +
        ((t.movedThisTurn || t.attackedThisTurn)
          ? '<div class="vtt-ins-stat full" style="gap:.4rem;flex-wrap:wrap">'+
              (t.movedThisTurn    ? '<span class="vtt-ins-badge">✓ A bougé</span>' : '')+
              (t.attackedThisTurn ? '<span class="vtt-ins-badge vtt-ins-badge-atk">✓ A attaqué</span>' : '')+
            '</div>'
          : '') +
      '</div>';
  }

  el.innerHTML=`
    <div class="vtt-ins-header">
      ${img?`<img src="${img}" class="vtt-ins-avatar" alt="">`
           :`<div class="vtt-ins-avatar-icon" style="background:${TYPE_COLOR[t.type]??'#888'}">${icon}</div>`}
      <div style="min-width:0">
        <div class="vtt-ins-name">${ld.displayName??t.name}</div>
        <div class="vtt-ins-type">${icon} ${lbl}${linked?' · 🔗':''}</div>
      </div>
    </div>
    ${statsHtml}
    ${(t.type==='player'||t.type==='npc') && _diceSkills.length ? (() => {
      const c = t.characterId ? _characters[t.characterId] : null;
      const btns = _diceSkills.map(s => {
        const statKey = _STAT_KEY[s.stat] || '';
        const mod  = c && statKey ? getMod(c, statKey) : 0;
        const modStr = mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : '±0';
        const col  = _STAT_COLOR[s.stat] || 'var(--text-dim)';
        return `<button class="vtt-skill-btn" onclick="window._vttRollSkill('${s.name.replace(/'/g,"\\'")}','${s.stat}')">
          <span class="vtt-sk-name">${s.name}</span>
          <span class="vtt-sk-mod" style="color:${col}">${s.stat ? s.stat+' '+modStr : '—'}</span>
        </button>`;
      }).join('');
      return `<div class="vtt-ins-section">
        <div class="vtt-ins-section-title">🎲 Jets de compétences</div>
        <div class="vtt-roll-mode-row">
          <button class="vtt-roll-mode-btn${_rollMode==='disadvantage'?' active':''}" data-mode="disadvantage" onclick="window._vttSetRollMode('disadvantage')" title="Désavantage — prend le plus bas des 2 dés">⬇ Désav.</button>
          <button class="vtt-roll-mode-btn${_rollMode==='normal'?' active':''}" data-mode="normal" onclick="window._vttSetRollMode('normal')" title="Jet classique — 1d20">⚪ Normal</button>
          <button class="vtt-roll-mode-btn${_rollMode==='advantage'?' active':''}" data-mode="advantage" onclick="window._vttSetRollMode('advantage')" title="Avantage — prend le plus haut des 2 dés">⬆ Avantage</button>
        </div>
        <div class="vtt-roll-bonus-row">
          <span class="vtt-roll-bonus-lbl">Bonus contextuel</span>
          <button class="vtt-roll-bonus-adj" onclick="window._vttAdjBonus(-1)">−</button>
          <span class="vtt-roll-bonus-val${_rollBonus!==0?' nonzero':''}" id="vtt-bonus-val">${_rollBonus>0?'+'+_rollBonus:_rollBonus}</span>
          <button class="vtt-roll-bonus-adj" onclick="window._vttAdjBonus(1)">+</button>
          <button class="vtt-roll-bonus-reset" onclick="window._vttAdjBonus(0,true)" title="Réinitialiser">↺</button>
        </div>
        <div class="vtt-ins-skills">${btns}</div>
      </div>`;
    })() : ''}
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
  _drawGrid(); _renderMapImages(); _renderAllTokens(); _renderAnnotLayer();
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
// ═══════════════════════════════════════════════════════════════════
// OUTILS — RÈGLE & ANNOTATIONS
// ═══════════════════════════════════════════════════════════════════

// Conversion coords écran → monde
function _stageToWorld(ptr) {
  const sc = _stage.scaleX(), sp = _stage.position();
  return { x: (ptr.x - sp.x) / sc, y: (ptr.y - sp.y) / sc };
}

// ── Règle ──────────────────────────────────────────────────────────
function _startRuler(wp) {
  const K = window.Konva;
  _rulerActive = true; _rulerOrigin = wp;
  _clearRuler();
  _rulerLine  = new K.Line({ points:[wp.x,wp.y,wp.x,wp.y], stroke:'#ffe600', strokeWidth:2,
    dash:[8,4], lineCap:'round', listening:false, name:'ruler' });
  _rulerLabel = new K.Text({ x:wp.x, y:wp.y, text:'', fill:'#ffe600', fontSize:13,
    fontStyle:'bold', shadowColor:'#000', shadowBlur:6, shadowOpacity:.9,
    shadowOffset:{x:1,y:1}, listening:false, name:'ruler' });
  _layers.ping.add(_rulerLine, _rulerLabel);
  _layers.ping.batchDraw();
}
function _updateRuler(wp) {
  if (!_rulerLine || !_rulerOrigin) return;
  _rulerLine.points([_rulerOrigin.x, _rulerOrigin.y, wp.x, wp.y]);
  const dxC = (wp.x - _rulerOrigin.x) / CELL;
  const dyC = (wp.y - _rulerOrigin.y) / CELL;
  const dist = Math.sqrt(dxC**2 + dyC**2);
  const distC = Math.round(dist * 2) / 2;
  const distM = (dist * CELL_M).toFixed(1);
  _rulerLabel.text(`${distC} case${distC!==1?'s':''} · ${distM}m`);
  _rulerLabel.position({
    x: (_rulerOrigin.x + wp.x) / 2 + 6,
    y: (_rulerOrigin.y + wp.y) / 2 - 18,
  });
  _layers.ping.batchDraw();
}
function _endRuler() {
  _rulerActive = false;
  if (_rulerHideTimer) clearTimeout(_rulerHideTimer);
  _rulerHideTimer = setTimeout(_clearRuler, 5000);
}
function _clearRuler() {
  if (_rulerHideTimer) { clearTimeout(_rulerHideTimer); _rulerHideTimer = null; }
  _layers.ping?.find('.ruler').forEach(s => s.destroy());
  _rulerLine = null; _rulerLabel = null; _rulerActive = false;
  _layers.ping?.batchDraw();
}

// ── Annotations ────────────────────────────────────────────────────
function _buildAnnotShape(K, data) {
  const col  = data.color || '#ef4444';
  const fill = data.fill ? col + '30' : 'transparent';
  const base = { stroke: col, strokeWidth: data.strokeWidth || 2,
    lineCap:'round', lineJoin:'round', name:'annot', listening: STATE.isAdmin };
  let shape;
  if (data.type === 'freehand' || data.type === 'line') {
    shape = new K.Line({ ...base, points: data.points || [],
      x: data.offsetX||0, y: data.offsetY||0,
      tension: data.type === 'freehand' ? 0.3 : 0, fill:'transparent' });
  } else if (data.type === 'rect') {
    shape = new K.Rect({ ...base, x:data.x||0, y:data.y||0,
      width:data.w||10, height:data.h||10, fill, cornerRadius:3 });
  } else if (data.type === 'circle') {
    shape = new K.Circle({ ...base, x:data.x||0, y:data.y||0, radius:data.r||10, fill });
  }
  if (!shape) return null;
  shape._annotId = data.id;

  // Restaurer rotation / scale sauvegardés
  if (data.rotation) shape.rotation(data.rotation);
  if (data.scaleX)   shape.scaleX(data.scaleX);
  if (data.scaleY)   shape.scaleY(data.scaleY);

  if (STATE.isAdmin) {
    // Clic gauche → sélectionner (mode select uniquement)
    shape.on('click', e => {
      if (_tool !== 'select') return;
      e.cancelBubble = true;
      _selectedAnnotId = data.id;
      if (_annotTransformer) { _annotTransformer.nodes([shape]); _layers.draw.batchDraw(); }
    });
    // Clic-droit → supprimer (mode select uniquement)
    shape.on('contextmenu', e => {
      if (_tool !== 'select') return;
      e.evt.preventDefault(); e.cancelBubble = true;
      _deselectAnnot();
      deleteDoc(_annotRef(data.id)).catch(() => {});
    });
    // Fin de drag → sauvegarder position
    shape.on('dragend', () => {
      const update = (data.type === 'freehand' || data.type === 'line')
        ? { offsetX: shape.x(), offsetY: shape.y() }
        : { x: shape.x(), y: shape.y() };
      updateDoc(_annotRef(data.id), update).catch(() => {});
    });
    // Fin de transformation (rotate/resize) → sauvegarder
    shape.on('transformend', () => {
      updateDoc(_annotRef(data.id), {
        rotation: shape.rotation(),
        scaleX:   shape.scaleX(),
        scaleY:   shape.scaleY(),
        x: shape.x(), y: shape.y(),
      }).catch(() => {});
    });
  }
  return shape;
}

function _deselectAnnot() {
  _selectedAnnotId = null;
  if (_annotTransformer) { _annotTransformer.nodes([]); _layers.draw?.batchDraw(); }
}

function _renderAnnotLayer() {
  if (!_layers.draw || !_activePage) return;
  const K = window.Konva;
  Object.values(_annotations).forEach(e => { e.shape?.destroy(); e.shape = null; });
  for (const [id, e] of Object.entries(_annotations)) {
    if (e.data.pageId !== _activePage.id) continue;
    const shape = _buildAnnotShape(K, e.data);
    if (shape) { _annotations[id].shape = shape; _layers.draw.add(shape); }
  }
  _updateAnnotDraggable();
  _layers.draw.batchDraw();
}

function _updateAnnotDraggable() {
  if (!STATE.isAdmin || !_layers.draw) return;
  const canInteract = _tool === 'select';
  Object.values(_annotations).forEach(e => {
    if (!e.shape) return;
    e.shape.draggable(canInteract);
    e.shape.listening(canInteract);
  });
  _layers.draw.batchDraw();
}

// ── Draw live (crayon + formes) ────────────────────────────────────
function _startDraw(wp) {
  const K = window.Konva;
  _drawOrigin = wp;
  const base = { stroke:_drawColor, strokeWidth:_drawWidth, lineCap:'round', lineJoin:'round', listening:false, name:'draw-live' };
  const fill  = _drawFill ? _drawColor+'30' : 'transparent';
  if (_drawShape === 'pencil') {
    _drawPts = [wp.x, wp.y];
    _drawLive = new K.Line({ ...base, points:_drawPts, tension:0.3 });
  } else if (_drawShape === 'line') {
    _drawLive = new K.Line({ ...base, points:[wp.x,wp.y,wp.x,wp.y] });
  } else if (_drawShape === 'rect') {
    _drawLive = new K.Rect({ ...base, x:wp.x, y:wp.y, width:0, height:0, fill, cornerRadius:3 });
  } else if (_drawShape === 'circle') {
    _drawLive = new K.Circle({ ...base, x:wp.x, y:wp.y, radius:0, fill });
  }
  if (_drawLive) { _layers.draw.add(_drawLive); }
  _drawing = true;
}
function _updateDraw(wp) {
  if (!_drawLive || !_drawOrigin) return;
  if (_drawShape === 'pencil') {
    _drawPts.push(wp.x, wp.y);
    _drawLive.points([..._drawPts]);
  } else if (_drawShape === 'line') {
    _drawLive.points([_drawOrigin.x, _drawOrigin.y, wp.x, wp.y]);
  } else if (_drawShape === 'rect') {
    const x = Math.min(_drawOrigin.x, wp.x), y = Math.min(_drawOrigin.y, wp.y);
    _drawLive.setAttrs({ x, y, width:Math.abs(wp.x-_drawOrigin.x), height:Math.abs(wp.y-_drawOrigin.y) });
  } else if (_drawShape === 'circle') {
    _drawLive.radius(Math.hypot(wp.x-_drawOrigin.x, wp.y-_drawOrigin.y));
  }
  _layers.draw.batchDraw();
}
async function _endDraw() {
  _drawing = false;
  if (!_drawLive || !_activePage) { _drawLive?.destroy(); _drawLive=null; return; }
  let data;
  if (_drawShape === 'pencil' && _drawPts.length >= 6) {
    data = { type:'freehand', points:_drawPts, offsetX:0, offsetY:0 };
  } else if (_drawShape === 'line') {
    const pts = _drawLive.points();
    if (Math.hypot(pts[2]-pts[0], pts[3]-pts[1]) < 3) { _drawLive.destroy(); _drawLive=null; return; }
    data = { type:'line', points:pts, offsetX:0, offsetY:0 };
  } else if (_drawShape === 'rect') {
    if (_drawLive.width() < 3 && _drawLive.height() < 3) { _drawLive.destroy(); _drawLive=null; return; }
    data = { type:'rect', x:_drawLive.x(), y:_drawLive.y(), w:_drawLive.width(), h:_drawLive.height(), fill:_drawFill };
  } else if (_drawShape === 'circle') {
    if (_drawLive.radius() < 3) { _drawLive.destroy(); _drawLive=null; return; }
    data = { type:'circle', x:_drawLive.x(), y:_drawLive.y(), r:_drawLive.radius(), fill:_drawFill };
  }
  const liveCopy = _drawLive;
  _drawLive = null;
  if (!data) { liveCopy.destroy(); _layers.draw.batchDraw(); return; }
  data = { ...data, pageId:_activePage.id, color:_drawColor, strokeWidth:_drawWidth,
    createdBy: STATE.user?.uid||null, createdAt: serverTimestamp() };
  const id = 'a' + Date.now() + Math.random().toString(36).slice(2,5);
  try {
    await setDoc(_annotRef(id), data);
    liveCopy.destroy(); // l'onSnapshot va recréer la version persistée
  } catch(err) {
    console.error('[VTT] Annotation save error:', err?.code, err?.message);
    showNotif('Erreur sauvegarde annotation — vérifiez les règles Firestore', 'error');
    // Garder liveCopy visible temporairement (non persistée)
  }
  _layers.draw.batchDraw();
}

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

  // 5b. Tracker bestiaire joueur (estimations personnelles)
  if (!STATE.isAdmin) {
    const uid = STATE.user?.uid;
    if (uid) {
      _unsubs.push(onSnapshot(_bstTrackerRef(uid), snap => {
        _bstTracker = snap.exists() ? (snap.data().data || {}) : {};
        // Mettre à jour la barre HP de tous les tokens ennemis sur le canvas
        for (const [id, e] of Object.entries(_tokens)) {
          if (e.data?.type === 'enemy' && e.data?.beastId) _patchShape(id);
        }
        // Rafraîchit l'inspector si un token ennemi est sélectionné
        if (_selected) {
          const td = _tokens[_selected]?.data;
          if (td?.type === 'enemy') _renderInspector(td);
        }
      }, () => {}));
    }
  }

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

  // 7. Annotations (dessins + formes)
  _unsubs.push(onSnapshot(_annotCol(), snap => {
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        _annotations[id]?.shape?.destroy();
        delete _annotations[id];
        if (_selectedAnnotId === id) _deselectAnnot();
      } else {
        const data = { id, ...ch.doc.data() };
        if (_annotations[id]) {
          // Mise à jour : si le shape existe encore, l'enlever d'abord
          _annotations[id].shape?.destroy();
        }
        _annotations[id] = { data, shape: null };
        // Rendre sur la page active seulement
        if (_activePage && data.pageId === _activePage.id) {
          const K = window.Konva;
          const shape = _buildAnnotShape(K, data);
          if (shape) { _annotations[id].shape = shape; _layers.draw?.add(shape); }
        }
      }
    });
    _updateAnnotDraggable();
    _layers.draw?.batchDraw();
  }, () => {}));

  // 8. Pings temps réel
  _unsubs.push(onSnapshot(_pingsCol(), snap => {
    const now = Date.now();
    const pings = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.pageId === _activePage?.id
               && p.createdAt
               && (now - p.createdAt.toMillis()) < 5000);
    _renderPings(pings);
  }, () => {})); // silencieux si pas de règle Firestore

  // 8. Réactions émotes temps réel
  _unsubs.push(onSnapshot(_reactionsCol(), snap => {
    const now = Date.now();
    snap.docs.forEach(d => {
      const r = { id: d.id, ...d.data() };
      if (!r.emoteUrl) return;
      // createdAt stocké comme nombre (ms) — pas de serverTimestamp
      const ts = typeof r.createdAt === 'number' ? r.createdAt : r.createdAt?.toMillis?.() ?? now;
      if (now - ts > 12000) return; // ignorer les réactions de plus de 12s
      const key = `${r.id}_${ts}`;
      // _renderedReactions.has(key) bloque le double affichage pour l'émetteur
      _showEmoteBubble(r.tokenId, r.emoteUrl, r.emoteName, key);
    });
  }, err => {
    console.error('[vtt] réactions émotes — erreur listener:', err);
  }));

  // 9. Chat / Log de dés
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

// ── Émotes ──────────────────────────────────────────────────────────
async function _loadEmotes() {
  try {
    const data = await getDocData('world', 'vtt_emotes');
    _emotes = data?.emotes || [];
  } catch { _emotes = []; }
}

const _DICE_SKILLS_DEFAULT = [
  { name:'Acrobaties',stat:'DEX'},{name:'Arcanes',stat:'INT'},{name:'Athlétisme',stat:'FOR'},
  {name:'Charisme',stat:'CHA'},{name:'Combat',stat:''},{name:'Constitution',stat:'CON'},
  {name:'Dextérité',stat:'DEX'},{name:'Discrétion',stat:'DEX'},{name:'Dressage',stat:'SAG'},
  {name:'Force',stat:'FOR'},{name:'Histoire',stat:'INT'},{name:'Intimidation',stat:'CHA'},
  {name:'Investigation',stat:'INT'},{name:'Intelligence',stat:'INT'},{name:'Médecine',stat:'SAG'},
  {name:'Nature',stat:'INT'},{name:'Perception',stat:'SAG'},{name:'Perspicacité',stat:'SAG'},
  {name:'Persuasion',stat:'CHA'},{name:'Religion',stat:'INT'},{name:'Représentation',stat:'CHA'},
  {name:'Sagesse',stat:'SAG'},{name:'Survie',stat:'SAG'},{name:'Tromperie',stat:'CHA'},
];
// Initialiser immédiatement : localStorage (ordre perso) > défauts
_diceSkills = (() => {
  try { const s = localStorage.getItem('hist_dice_skills'); if (s) return JSON.parse(s); } catch {}
  return [..._DICE_SKILLS_DEFAULT];
})();

async function _loadDiceSkills() {
  try {
    const data = await getDocData('world', 'dice_skills');
    if (data?.skills?.length) _diceSkills = data.skills;
  } catch { /* garde le cache local */ }
  // Re-render l'inspector si un token est déjà sélectionné
  if (_selected) _renderInspector(_tokens[_selected]?.data ?? null);
}

window._vttSetRollMode = mode => {
  _rollMode = mode;
  // Mettre à jour les boutons visuellement sans re-render complet
  document.querySelectorAll('.vtt-roll-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
};

window._vttAdjBonus = (delta, reset = false) => {
  _rollBonus = reset ? 0 : Math.max(-20, Math.min(20, _rollBonus + delta));
  const el = document.getElementById('vtt-bonus-val');
  if (el) {
    el.textContent = _rollBonus > 0 ? `+${_rollBonus}` : `${_rollBonus}`;
    el.classList.toggle('nonzero', _rollBonus !== 0);
  }
};

window._vttRollSkill = async (skillName, stat) => {
  const t = _tokens[_selected]?.data;
  const c = t?.characterId ? _characters[t.characterId] : null;
  const statKey = _STAT_KEY[stat] || '';
  const mod = c && statKey ? getMod(c, statKey) : 0;
  const d20 = () => Math.floor(Math.random() * 20) + 1;

  let d1 = d20(), d2, roll;
  if (_rollMode === 'advantage')    { d2 = d20(); roll = Math.max(d1, d2); }
  else if (_rollMode === 'disadvantage') { d2 = d20(); roll = Math.min(d1, d2); }
  else                              { roll = d1; }

  const total   = roll + mod + _rollBonus;
  const isCrit  = roll === 20, isFumble = roll === 1;
  const authorName    = STATE.profile?.pseudo || STATE.profile?.prenom || 'Joueur';
  const characterName = c?.nom || t?.name || null;
  const characterImage = c?.photoURL || c?.photo || c?.avatar || null;
  try {
    await addDoc(_logCol(), {
      type: 'roll',
      authorId: STATE.user?.uid || null,
      authorName, characterName, characterImage,
      rollMode: _rollMode,
      rollDice: d2 !== undefined ? [d1, d2] : [d1],
      rollRaw: roll, rollMod: mod, rollBonus: _rollBonus || 0,
      rollResult: total,
      rollSkill: skillName, rollStat: stat,
      isCrit, isFumble,
      createdAt: serverTimestamp(),
    });
  } catch(e) { showNotif('Erreur jet : ' + e.message, 'error'); }
};

async function _saveEmotes(list) {
  _emotes = list;
  try { await saveDoc('world', 'vtt_emotes', { emotes: list }); }
  catch(e) { showNotif('Erreur sauvegarde émotes : ' + e.message, 'error'); }
}

// Convertit les balises :nom: en <img> dans un texte déjà échappé
function _applyEmotes(escaped) {
  for (const em of _emotes) {
    const key = `:${_escHtml(em.name)}:`;
    const img = `<img class="vtt-emote-inline" src="${em.url}" alt="${key}" title="${key}">`;
    escaped = escaped.split(key).join(img);
  }
  return escaped;
}

function _emoteGridHtml(list) {
  if (!list.length) return '<div class="vtt-emote-empty-grid">Aucune émote trouvée</div>';
  return list.map(em => {
    const safe = em.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return `<button class="vtt-emote-item" onclick="window._vttPickEmote('${safe}')" title=":${_escHtml(em.name)}:">
      <img src="${em.url}" alt="${_escHtml(em.name)}" loading="lazy">
      <span>${_escHtml(em.name)}</span>
    </button>`;
  }).join('');
}

function _renderEmotePicker() {
  const el = document.getElementById('vtt-emote-picker');
  if (!el) return;
  if (!_emotes.length) {
    el.innerHTML = '<div class="vtt-emote-picker-search"><span class="vtt-emote-empty" style="padding:.5rem;display:block;font-size:.75rem;color:var(--text-muted)">Aucune émote — à configurer dans la Console MJ</span></div>';
    return;
  }
  el.innerHTML = `
    <div class="vtt-emote-picker-search">
      <input type="text" id="vtt-emote-search" placeholder="🔍 Rechercher…" autocomplete="off"
        oninput="window._vttFilterEmotes(this.value)">
    </div>
    <div class="vtt-emote-grid" id="vtt-emote-grid">${_emoteGridHtml(_emotes)}</div>`;
  setTimeout(() => document.getElementById('vtt-emote-search')?.focus(), 40);
}

window._vttFilterEmotes = (q) => {
  const el = document.getElementById('vtt-emote-grid'); if (!el) return;
  const filtered = q.trim() ? _emotes.filter(e => e.name.includes(q.trim().toLowerCase())) : _emotes;
  el.innerHTML = _emoteGridHtml(filtered);
};

window._vttToggleEmotePicker = () => {
  const el = document.getElementById('vtt-emote-picker');
  if (!el) return;
  const open = el.classList.toggle('open');
  if (open) _renderEmotePicker();
};

window._vttPickEmote = async (name) => {
  const uid = STATE.user?.uid; if (!uid) return;
  const em = _emotes.find(e => e.name === name); if (!em) return;
  document.getElementById('vtt-emote-picker')?.classList.remove('open');

  // Clé partagée locale + Firestore : même timestamp → _renderedReactions évite le double affichage
  const ts = Date.now();
  const key = `${uid}_${ts}`;

  // Affichage local immédiat
  _showEmoteBubble(null, em.url, name, key);

  // Propagation aux autres joueurs via Firestore
  let tokenId = _selected;
  if (!tokenId) {
    const own = Object.values(_tokens).find(e => e.data.ownerId === uid);
    tokenId = own?.data?.id ?? null;
  }
  setDoc(_reactionRef(uid), {
    tokenId, emoteName: name, emoteUrl: em.url,
    pageId: _activePage?.id ?? null,
    createdAt: ts,           // nombre (ms) — même valeur que la clé locale
  }).catch(err => {
    console.error('[vtt] émote temps réel — écriture refusée. Vérifier vttEmoteReactions dans Firestore.', err);
  });
};

window._ouvrirGestionEmotes = async () => {
  await _loadEmotes();
  const { default: Sortable } = await import('../vendor/sortable.esm.js');

  // ── Helper upload ImgBB ──────────────────────────────────────────
  const _uploadImgbb = async (file) => {
    const key = _getImgbbKey();
    if (!key) throw new Error('Clé ImgBB non configurée (bouton 🔑 dans le VTT)');
    const b64 = await new Promise((res, rej) => {
      const rd = new FileReader(); rd.onload = () => res(rd.result.split(',')[1]); rd.onerror = rej;
      rd.readAsDataURL(file);
    });
    const fd = new FormData(); fd.append('key', key); fd.append('image', b64);
    const resp = await fetch('https://api.imgbb.com/1/upload', { method:'POST', body:fd });
    const json = await resp.json();
    if (!json.success) throw new Error(json.error?.message || 'ImgBB error');
    return json.data.url;
  };

  // ── Rendu de la grille de cartes ─────────────────────────────────
  const _cardsHtml = (list) => list.length
    ? `<div id="emote-cards-grid" class="vtt-emote-cards">${
        list.map((em, i) => `
          <div class="vtt-emote-card" data-i="${i}">
            <span class="vtt-emote-card-drag" title="Déplacer">⠿</span>
            <img src="${em.url}" alt="${_escHtml(em.name)}">
            <span class="vtt-emote-card-name" title=":${_escHtml(em.name)}:">:${_escHtml(em.name)}:</span>
            <div class="vtt-emote-card-actions">
              <button class="vtt-ec-btn vtt-ec-edit" onclick="window._vttEditEmote(${i})" title="Modifier">✏</button>
              <button class="vtt-ec-btn vtt-ec-del"  onclick="window._vttDeleteEmote(${i})" title="Supprimer">✕</button>
            </div>
          </div>`).join('')
      }</div>`
    : '<div style="color:var(--text-dim);font-size:.8rem;padding:.5rem 0">Aucune émote pour l\'instant.</div>';

  const _inpStyle = 'width:100%;box-sizing:border-box;background:var(--bg-elevated);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:.8rem;padding:.3rem .5rem';

  openModal('😄 Gestion des Émotes', `
    <div style="display:flex;flex-direction:column;gap:.85rem;padding:.3rem 0">
      <div style="font-size:.72rem;color:var(--text-muted)">Maintenez ⠿ pour réordonner par glisser-déposer. Cliquez ✏ pour modifier.</div>
      <div id="emote-manage-list">${_cardsHtml(_emotes)}</div>
      <div id="emote-edit-zone"></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:0">
      <div style="font-weight:600;font-size:.85rem">➕ Ajouter une émote</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">
        <div class="form-group" style="margin:0">
          <label style="font-size:.75rem;color:var(--text-muted)">Nom (ex: <code>rire</code>)</label>
          <input type="text" id="emote-add-name" placeholder="nomemote" style="${_inpStyle}">
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:.75rem;color:var(--text-muted)">Image</label>
          <input type="file" id="emote-add-file" accept="image/*" style="font-size:.78rem;margin-top:.25rem">
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:.7rem">
        <button class="btn btn-primary" style="flex:1" onclick="window._vttAddEmote()">➕ Ajouter l'émote</button>
        <span id="emote-add-status" style="font-size:.78rem;color:var(--text-dim);flex:1;min-height:1rem"></span>
      </div>
    </div>`);

  // ── SortableJS ───────────────────────────────────────────────────
  const _initSort = () => {
    const grid = document.getElementById('emote-cards-grid'); if (!grid) return;
    new Sortable(grid, {
      animation: 180, handle: '.vtt-emote-card-drag',
      ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen',
      onEnd: async (evt) => {
        if (evt.oldIndex === evt.newIndex) return;
        const list = [..._emotes];
        const [moved] = list.splice(evt.oldIndex, 1);
        list.splice(evt.newIndex, 0, moved);
        await _saveEmotes(list);
        showNotif('Ordre sauvegardé', 'success');
      },
    });
  };
  _initSort();

  // ── Rafraîchit la grille ─────────────────────────────────────────
  const _refresh = (clearEdit = true) => {
    const el = document.getElementById('emote-manage-list'); if (!el) return;
    el.innerHTML = _cardsHtml(_emotes); _initSort();
    if (clearEdit) { const ez = document.getElementById('emote-edit-zone'); if (ez) ez.innerHTML = ''; }
  };

  // ── Supprimer ────────────────────────────────────────────────────
  window._vttDeleteEmote = async (i) => {
    if (!await confirmModal(`Supprimer :${_emotes[i]?.name}: ?`)) return;
    const list = [..._emotes]; list.splice(i, 1);
    await _saveEmotes(list); _refresh();
    showNotif('Émote supprimée', 'success');
  };

  // ── Ouvrir le panneau d'édition (horizontal, sous la grille) ─────
  window._vttEditEmote = (i) => {
    const em = _emotes[i]; if (!em) return;
    // Mettre en évidence la carte sélectionnée
    document.querySelectorAll('.vtt-emote-card').forEach(c => c.classList.remove('is-editing'));
    document.querySelector(`.vtt-emote-card[data-i="${i}"]`)?.classList.add('is-editing');
    // Remplir la zone d'édition
    const ez = document.getElementById('emote-edit-zone'); if (!ez) return;
    ez.innerHTML = `
      <div class="vtt-ec-panel">
        <img class="vtt-ec-panel-preview" id="ec-preview-${i}" src="${em.url}" alt="${_escHtml(em.name)}">
        <div class="vtt-ec-panel-fields">
          <div class="vtt-ec-panel-title">✏ Modifier <span style="font-family:monospace">:${_escHtml(em.name)}:</span></div>
          <div class="vtt-ec-panel-row">
            <label>Nouveau nom</label>
            <input type="text" id="ec-name-${i}" value="${_escHtml(em.name)}" autocomplete="off"
              onkeydown="if(event.key==='Enter') window._vttSaveEmote(${i})">
          </div>
          <div class="vtt-ec-panel-row">
            <label>Nouvelle image <span style="opacity:.6">(optionnel)</span></label>
            <input type="file" id="ec-file-${i}" accept="image/*"
              onchange="const f=this.files?.[0];if(f){const u=URL.createObjectURL(f);document.getElementById('ec-preview-${i}').src=u}">
          </div>
          <div class="vtt-ec-panel-btns">
            <button class="vtt-ec-save"   onclick="window._vttSaveEmote(${i})">✓ Enregistrer</button>
            <button class="vtt-ec-cancel" onclick="document.getElementById('emote-edit-zone').innerHTML='';document.querySelectorAll('.vtt-emote-card').forEach(c=>c.classList.remove('is-editing'))">✕ Annuler</button>
          </div>
        </div>
      </div>`;
    document.getElementById(`ec-name-${i}`)?.focus();
  };

  // ── Sauvegarder l'édition ────────────────────────────────────────
  window._vttSaveEmote = async (i) => {
    const nameEl = document.getElementById(`ec-name-${i}`);
    const fileEl = document.getElementById(`ec-file-${i}`);
    const newName = nameEl?.value.trim().replace(/\s+/g, '_').toLowerCase();
    if (!newName) { showNotif('Nom requis', 'error'); return; }
    const list = [..._emotes];
    const em = { ...list[i], name: newName };
    if (fileEl?.files?.[0]) {
      showNotif('Upload en cours…', 'info');
      try { em.url = await _uploadImgbb(fileEl.files[0]); }
      catch(e) { showNotif('⚠ ' + e.message, 'error'); return; }
    }
    list[i] = em;
    await _saveEmotes(list); _refresh();
    showNotif(`✓ :${newName}: mis à jour`, 'success');
  };

  // ── Ajouter ──────────────────────────────────────────────────────
  window._vttAddEmote = async () => {
    const nameEl   = document.getElementById('emote-add-name');
    const fileEl   = document.getElementById('emote-add-file');
    const statusEl = document.getElementById('emote-add-status');
    const name = nameEl?.value.trim().replace(/\s+/g, '_').toLowerCase();
    const file = fileEl?.files?.[0];
    if (!name) { if (statusEl) statusEl.textContent = '⚠ Nom requis'; return; }
    if (!file) { if (statusEl) statusEl.textContent = '⚠ Image requise'; return; }
    if (statusEl) statusEl.textContent = '⏳ Upload…';
    try {
      const url = await _uploadImgbb(file);
      await _saveEmotes([..._emotes, { id: Date.now().toString(), name, url }]);
      if (statusEl) statusEl.textContent = `✓ :${name}: ajoutée !`;
      if (nameEl) nameEl.value = ''; if (fileEl) fileEl.value = '';
      _refresh();
    } catch(e) { if (statusEl) statusEl.textContent = '⚠ ' + e.message; }
  };
};

function _renderChatLog(msgs) {
  const el=document.getElementById('vtt-chat-log'); if (!el) return;
  const myUid=STATE.user?.uid;

  // Portrait 22px : image si dispo, sinon initiale colorée
  const _portrait = (url, name, color='var(--gold)') => url
    ? `<img class="vtt-log-portrait" src="${url}" alt="${_escHtml(name||'')}" onerror="this.style.visibility='hidden'">`
    : `<div class="vtt-log-portrait" style="background:${color}">${_escHtml((name||'?')[0].toUpperCase())}</div>`;

  el.innerHTML=msgs.map(m=>{
    const isMe=m.authorId===myUid;
    const who=`<span class="vtt-log-who${isMe?' me':''}">${_escHtml(m.authorName||'?')}</span>`;
    if (m.type==='cast') {
      // Sort CA / utilitaire — pas de jet de dés
      const pmStr = m.pmCost > 0
        ? `<span style="font-size:.65rem;color:#b47fff;margin-left:.3rem">−${m.pmCost} PM</span>` : '';
      const castWho = m.casterName || m.authorName || '?';
      return `<div class="vtt-log-entry vtt-log-roll"
          style="border-left:3px solid #b47fff;padding:.3rem .3rem .3rem .5rem;background:rgba(180,127,255,.05);border-radius:0 6px 6px 0">
        <div style="display:flex;align-items:center;gap:.35rem;flex-wrap:wrap">
          ${_portrait(m.characterImage, castWho, '#b47fff')}
          <span style="font-weight:700;font-size:.78rem;color:var(--text)">${_escHtml(castWho)}</span>
          <span style="font-size:.72rem;color:var(--text-dim)">✨</span>
          <strong style="font-size:.82rem">${_escHtml(m.optLabel||'')}</strong>
          <span style="color:var(--text-dim);font-size:.65rem">→ ${_escHtml(m.targetName||'')}</span>
          ${pmStr}
        </div>
        ${m.castEffect && m.castEffect !== '—' ? `<div style="font-size:.68rem;color:var(--text-dim);margin-top:.15rem;padding-left:calc(22px + .35rem)">${_escHtml(m.castEffect)}</div>` : ''}
      </div>`;
    }
    if (m.type==='attack' && m.isHeal) {
      // Sort de soin
      const sn  = n => n>0?`+${n}`:n<0?`${n}`:'';
      const sub = t => `<span style="font-size:.6rem;color:var(--text-dim)">(${t})</span>`;
      const baseDice = _escHtml(m.dmgRawDice || m.dmgFormula || '');
      const mods = [
        m.dmgMaitriseBonus > 0 ? `+${m.dmgMaitriseBonus}` + sub('Maîtrise') : '',
        m.dmgBonus ? sn(m.dmgBonus) + sub('bonus') : '',
      ].filter(Boolean).join(' ');
      const healWho = m.attackerName || m.authorName || '?';
      return `<div class="vtt-log-entry vtt-log-roll"
          style="border-left:3px solid #22c38e;padding:.3rem .3rem .3rem .5rem;background:rgba(34,195,142,.05);border-radius:0 6px 6px 0">
        <div style="display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;margin-bottom:.2rem">
          ${_portrait(m.characterImage, healWho, '#22c38e')}
          <span style="font-weight:700;font-size:.78rem;color:var(--text)">${_escHtml(healWho)}</span>
          <span style="color:var(--text-dim);font-size:.72rem">→</span>
          <strong style="font-size:.82rem">${_escHtml(m.defenderName||'')}</strong>
          <span style="color:var(--text-dim);font-size:.65rem">· ${_escHtml(m.optLabel||'')}</span>
        </div>
        <div style="display:flex;align-items:baseline;gap:.3rem;flex-wrap:wrap">
          <span style="font-size:.78rem">💚</span>
          <span style="font-size:.7rem;color:var(--text-dim)">${baseDice}(${m.dmgRaw}) ${mods}</span>
          <span style="font-size:.72rem;color:var(--text-dim)">=</span>
          <strong style="font-size:1.05rem;color:#22c38e;letter-spacing:-.01em">${m.dmgTotal}</strong>
          <span style="font-size:.72rem;color:#22c38e">PV soignés</span>
        </div>
      </div>`;
    }
    if (m.type==='attack') {
      const sn  = n => n>0?`+${n}`:n<0?`${n}`:'';
      const sub = t => `<span style="font-size:.6rem;color:var(--text-dim)">(${t})</span>`;

      // Couleurs selon résultat
      const isCrit   = m.isCrit;
      const isFumble = m.isFumble;
      const isHalf   = m.halfDmg;
      const borderCol = isCrit   ? '#f59e0b'
                      : isFumble ? '#7f1d1d'
                      : isHalf   ? '#b47fff'
                      : m.hit    ? '#22c38e' : '#6b7280';
      const bgRgb     = isCrit   ? '245,158,11'
                      : isFumble ? '127,29,29'
                      : isHalf   ? '180,127,255'
                      : m.hit    ? '34,195,142' : '107,114,128';
      const accentCol = isCrit   ? '#f59e0b'
                      : m.hit    ? '#22c38e' : '#ef4444';

      const resultBadge = isCrit
        ? `<span style="font-size:.7rem;font-weight:700;color:#f59e0b;margin-left:auto">💥 CRITIQUE</span>`
        : isFumble
        ? `<span style="font-size:.7rem;font-weight:700;color:#ef4444;margin-left:auto">💀 FUMBLE</span>`
        : '';

      const rolls    = Array.isArray(m.hitD20rolls) && m.hitD20rolls.length > 1 ? m.hitD20rolls : null;
      const advIcon  = m.advMode === 'adv' ? '⬆' : m.advMode === 'dis' ? '⬇' : '';
      const diceDisp = rolls
        ? `1d20(${rolls[0]},${rolls[1]}${advIcon}→${m.hitD20})`
        : `1d20(${m.hitD20})`;
      const hitFormula = m.hitToucherStatLabel != null
        ? [
            diceDisp,
            m.hitToucherMod       ? sn(m.hitToucherMod)    + sub(m.hitToucherStatLabel) : '',
            m.hitToucherSetBonus > 0 ? `+${m.hitToucherSetBonus}` + sub('Set') : '',
            m.hitBonus            ? sn(m.hitBonus) + sub('bonus') : '',
          ].filter(Boolean).join(' ')
        : `${diceDisp} ${sn(m.hitBase)}${m.hitBonus?' '+sn(m.hitBonus)+sub('bonus'):''}`;

      let dmgRow = '';
      if (m.hit || m.halfDmg) {
        const baseDice = _escHtml(m.dmgRawDice || m.dmgFormula || '');
        const mods = [
          m.dmgStatMod       ? sn(m.dmgStatMod)       + sub(m.dmgStatLabel||'') : '',
          m.dmgMaitriseBonus > 0 ? `+${m.dmgMaitriseBonus}` + sub('Maîtrise') : '',
          m.dmgBonus         ? sn(m.dmgBonus)          + sub('bonus') : '',
        ].filter(Boolean).join(' ');

        let dmgFormula;
        if (isCrit && m.critNormalMax) {
          dmgFormula = `max<span style="font-size:.6rem;color:var(--text-dim)">(${m.critNormalMax})</span> + ${baseDice}(${m.dmgRaw}) ${mods}`;
        } else if (m.halfDmg) {
          dmgFormula = `${baseDice}(${m.dmgRaw}) ${mods} ÷2`;
        } else {
          dmgFormula = `${baseDice}(${m.dmgRaw}) ${mods}`;
        }

        const dmgColor  = m.halfDmg ? '#b47fff' : '#ef4444';
        const dmgSuffix = m.newHp===0 ? '💀' : m.halfDmg ? '✦ ½ dégâts' : 'dégâts';
        dmgRow = `<div style="display:flex;align-items:baseline;gap:.3rem;flex-wrap:wrap;margin-top:.2rem">
          <span style="font-size:.78rem">⚔️</span>
          <span style="font-size:.7rem;color:var(--text-dim)">${dmgFormula}</span>
          <span style="font-size:.72rem;color:var(--text-dim)">=</span>
          <strong style="font-size:1.05rem;color:${dmgColor};letter-spacing:-.01em">${m.dmgTotal}</strong>
          <span style="font-size:.72rem;color:${dmgColor}">${dmgSuffix}</span>
        </div>`;
      }

      const atkWho = m.attackerName || m.authorName || '?';
      return `<div class="vtt-log-entry vtt-log-roll"
          style="border-left:3px solid ${borderCol};padding:.3rem .3rem .3rem .5rem;background:rgba(${bgRgb},.05);border-radius:0 6px 6px 0">
        <div style="display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;margin-bottom:.3rem">
          ${_portrait(m.characterImage, atkWho, borderCol)}
          <span style="font-weight:700;font-size:.78rem;color:var(--text)">${_escHtml(atkWho)}</span>
          <span style="color:var(--text-dim);font-size:.72rem">→</span>
          <strong style="font-size:.82rem">${_escHtml(m.defenderName||'')}</strong>
          <span style="color:var(--text-dim);font-size:.65rem">· ${_escHtml(m.optLabel||'')}</span>
          ${resultBadge}
        </div>
        <div style="display:flex;align-items:baseline;gap:.3rem;flex-wrap:wrap;padding-left:calc(22px + .35rem)">
          <span style="font-size:.78rem">🎯</span>
          <span style="font-size:.7rem;color:var(--text-dim)">${hitFormula}</span>
          <span style="font-size:.72rem;color:var(--text-dim)">=</span>
          <strong style="font-size:1.05rem;color:${accentCol};letter-spacing:-.01em">${m.hitTotal}</strong>
          <span style="font-size:.72rem;color:${accentCol};font-weight:600">${m.hit?'✓':'✗'}</span>
        </div>
        ${dmgRow}
      </div>`;
    }
    if (m.type==='roll') {
      const rollWho  = m.characterName || m.authorName || '?';
      const statCol  = _STAT_COLOR[m.rollStat] || 'var(--gold)';
      const statRgb  = _STAT_RGB[m.rollStat]   || '255,210,0';
      const resultCol = m.isCrit ? '#ffd700' : m.isFumble ? '#ef4444' : 'var(--text)';
      const modStr   = m.rollMod > 0 ? `+${m.rollMod}` : m.rollMod < 0 ? `${m.rollMod}` : '';
      const bonusStr = m.rollBonus > 0 ? `+${m.rollBonus}` : m.rollBonus < 0 ? `${m.rollBonus}` : '';
      const badge = m.isCrit
        ? `<span style="font-size:.65rem;font-weight:700;color:#ffd700;margin-left:auto">✨ CRITIQUE</span>`
        : m.isFumble
        ? `<span style="font-size:.65rem;font-weight:700;color:#ef4444;margin-left:auto">💀 FUMBLE</span>`
        : '';
      const modeIcon = m.rollMode==='advantage'
        ? `<span style="font-size:.6rem;font-weight:700;color:#22c38e">⬆ Avantage</span>`
        : m.rollMode==='disadvantage'
        ? `<span style="font-size:.6rem;font-weight:700;color:#ef4444">⬇ Désav.</span>`
        : '';
      const diceStr = m.rollDice?.length === 2
        ? (() => {
            const [a, b] = m.rollDice;
            const kept = m.rollRaw, dropped = a === kept ? b : a;
            return `[<strong>${kept}</strong>,<span style="color:var(--text-dim);text-decoration:line-through">${dropped}</span>]`;
          })()
        : `[${m.rollRaw}]`;
      if (m.rollSkill) {
        return `<div class="vtt-log-entry vtt-log-roll" style="border-left:3px solid ${statCol};background:rgba(${statRgb},.06);border-radius:0 6px 6px 0;padding:.3rem .3rem .3rem .5rem">
          <div style="display:flex;align-items:center;gap:.35rem;margin-bottom:.2rem">
            ${_portrait(m.characterImage, rollWho, statCol)}
            <span style="font-weight:700;font-size:.78rem;color:var(--text)">${_escHtml(rollWho)}</span>
            <span style="font-size:.65rem;color:var(--text-dim)">🎲</span>
            <span style="font-size:.72rem;font-weight:600;color:${statCol}">${_escHtml(m.rollSkill)}</span>
            <span style="font-size:.6rem;color:var(--text-dim)">${m.rollStat||''}</span>
            ${modeIcon}
            ${badge}
          </div>
          <div style="display:flex;align-items:baseline;gap:.3rem;flex-wrap:wrap;padding-left:calc(22px + .35rem)">
            <span style="font-size:.7rem;color:var(--text-dim)">${diceStr}</span>
            ${modStr ? `<span style="font-size:.7rem;color:${statCol}">${modStr}</span>` : ''}
            ${bonusStr ? `<span style="font-size:.7rem;color:var(--gold)" title="bonus contextuel">${bonusStr}</span>` : ''}
            <span style="font-size:.72rem;color:var(--text-dim)">=</span>
            <strong style="font-size:1.05rem;color:${resultCol}">${m.rollResult}</strong>
          </div>
        </div>`;
      }
      // Jet libre (sans token)
      return `<div class="vtt-log-entry vtt-log-roll" style="border-left:3px solid var(--gold);padding:.3rem .3rem .3rem .5rem;background:rgba(255,210,0,.04);border-radius:0 6px 6px 0">
        <div style="display:flex;align-items:center;gap:.35rem">
          ${who} <span style="font-size:.65rem;color:var(--text-dim)">🎲</span>
          <em style="font-size:.68rem;color:var(--text-dim)">${_escHtml(m.rollFormula||'')}</em>
          <span style="font-size:.72rem;color:var(--text-dim)">→</span>
          <strong style="color:${resultCol}">${m.rollResult}</strong>
          ${badge}
        </div>
      </div>`;
    }
    return `<div class="vtt-log-entry vtt-log-msg">${who} ${_applyEmotes(_escHtml(m.text||''))}</div>`;
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
window._vttTool       = t => _setTool(_tool === t ? 'select' : t);
window._vttSwitchPage = id => _switchPage(id);

// ── Outils de dessin ────────────────────────────────────────────────
window._vttDrawShape = shape => {
  _drawShape = shape;
  ['pencil','line','rect','circle'].forEach(s => {
    document.getElementById(`vtt-ds-${s}`)?.classList.toggle('active', s === shape);
  });
};
window._vttDrawColor = color => {
  _drawColor = color;
  document.querySelectorAll('.vtt-draw-color').forEach(b => b.classList.toggle('active', b.dataset.color === color));
};
window._vttDrawWidth = w => {
  _drawWidth = w;
  document.querySelectorAll('.vtt-draw-wbtn').forEach(b => b.classList.toggle('active', +b.dataset.w === w));
};
window._vttToggleDrawFill = () => {
  _drawFill = !_drawFill;
  const btn = document.getElementById('vtt-draw-fill-btn');
  if (btn) { btn.textContent = _drawFill ? '◼' : '◻'; btn.classList.toggle('active', _drawFill); }
};
window._vttClearAnnots = async () => {
  if (!_activePage) return;
  if (!await confirmModal('Effacer toutes les annotations de cette page ?')) return;
  const toDelete = Object.values(_annotations).filter(e => e.data.pageId === _activePage.id);
  await Promise.all(toDelete.map(e => deleteDoc(_annotRef(e.data.id)).catch(()=>{})));
};

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
window._vttSetPm = async (tokenId,pm) => {
  const t=_tokens[tokenId]?.data; if (!t) return;
  const v=Math.max(0,pm);
  if (t.characterId) await updateDoc(_chrRef(t.characterId),{pm:v}).catch(()=>{});
  else if (t.npcId)  await updateDoc(_npcRef(t.npcId),{pm:v}).catch(()=>{});
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
              : (e.data.name||'').replace(/ \d+$/,'')===baseName
  );
  const usedNums=new Set(sameGroup.map(e=>{const m=(e.data.name||'').match(/\s(\d+)$/);return m?parseInt(m[1]):1;}));
  let num=1; while(usedNums.has(num))num++;
  const { id:_tid, createdAt:_ca, ...base } = t;
  const ref=doc(_toksCol());
  await setDoc(ref, {
    ...base,
    name: num===1 ? baseName : `${baseName} ${num}`,
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
  // Purger les tokens fantômes (anciens auto-créés, non placés, non modifiés)
  const ghosts=Object.values(_tokens).filter(e=>e.data.beastId===beastId&&!e.data.pageId&&e.data.hp==null);
  if (ghosts.length) {
    const batch=writeBatch(db);
    ghosts.forEach(g=>batch.delete(_tokRef(g.data.id)));
    await batch.commit().catch(()=>{});
  }
  // Trouver le premier numéro libre parmi les tokens actifs
  const active=Object.values(_tokens).filter(e=>e.data.beastId===beastId&&(e.data.pageId||e.data.hp!=null));
  const usedNums=new Set(active.map(e=>{const m=(e.data.name||'').match(/\s(\d+)$/);return m?parseInt(m[1]):1;}));
  let num=1; while(usedNums.has(num))num++;
  const name=num===1?(b.nom||'Créature'):`${b.nom} ${num}`;
  const cx=Math.floor(_activePage.cols/2), cy=Math.floor(_activePage.rows/2);
  const ref=doc(_toksCol());
  await setDoc(ref,{
    name, type:'enemy',
    characterId:null, npcId:null, beastId,
    ownerId:null,
    pageId:_activePage.id,
    col:Math.min(_activePage.cols-1,cx+active.length),
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
  _tool = tool;
  document.querySelectorAll('.vtt-tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  // Draw bar
  const drawBar = document.getElementById('vtt-draw-bar');
  if (drawBar) drawBar.style.display = tool === 'draw' ? 'flex' : 'none';
  // Curseur
  const wrap = document.getElementById('vtt-canvas-wrap');
  if (wrap) wrap.style.cursor = (tool === 'ruler' || tool === 'draw') ? 'crosshair' : '';
  // Règle : effacer si on quitte
  if (tool !== 'ruler') _clearRuler();
  // Désélection annotation si on quitte le mode select
  if (tool !== 'select') _deselectAnnot();
  // Draggability des annotations
  _updateAnnotDraggable();
}
function _keyHandler(e) {
  if (!document.getElementById('vtt-canvas-wrap')) return;
  if (e.target.matches('input,textarea,select')) return;
  if (e.key==='Escape') { if (_tool !== 'select') _setTool('select'); else _deselect(); }
  if ((e.key==='Delete'||e.key==='Backspace') && _selectedAnnotId && _tool==='select') {
    deleteDoc(_annotRef(_selectedAnnotId)).catch(()=>{});
    _deselectAnnot();
  }
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
    <div class="vtt-tool-group">
      <button class="vtt-tool active" data-tool="select" onclick="window._vttTool('select')" title="↖ Sélection — interagir avec les tokens et annotations">↖</button>
      <button class="vtt-tool" data-tool="ruler"  onclick="window._vttTool('ruler')"  title="📏 Règle — 1er clic départ, 2e clic fin">📏</button>
      ${mj?`<button class="vtt-tool" data-tool="draw" onclick="window._vttTool('draw')" title="✏️ Dessin — dessiner sur la carte">✏️</button>`:''}
    </div>
    <div id="vtt-draw-bar" class="vtt-draw-bar" style="display:none">
      <button class="vtt-draw-btn active" id="vtt-ds-pencil"  onclick="window._vttDrawShape('pencil')"  title="Crayon libre">✏️</button>
      <button class="vtt-draw-btn"        id="vtt-ds-line"    onclick="window._vttDrawShape('line')"    title="Ligne">╱</button>
      <button class="vtt-draw-btn"        id="vtt-ds-rect"    onclick="window._vttDrawShape('rect')"    title="Rectangle">⬜</button>
      <button class="vtt-draw-btn"        id="vtt-ds-circle"  onclick="window._vttDrawShape('circle')"  title="Cercle">⬭</button>
      <div class="vtt-draw-sep"></div>
      ${['#ef4444','#f59e0b','#22c38e','#4f8cff','#b47fff','#ffffff','#1a1a2e'].map((c,i)=>
        `<button class="vtt-draw-color${i===0?' active':''}" data-color="${c}" onclick="window._vttDrawColor('${c}')" style="background:${c}" title="${c}"></button>`
      ).join('')}
      <div class="vtt-draw-sep"></div>
      ${[2,4,8].map((w,i)=>
        `<button class="vtt-draw-wbtn${i===0?' active':''}" data-w="${w}" onclick="window._vttDrawWidth(${w})" title="${w}px">${w}</button>`
      ).join('')}
      <div class="vtt-draw-sep"></div>
      <button class="vtt-draw-btn" id="vtt-draw-fill-btn" onclick="window._vttToggleDrawFill()" title="Remplissage (rect/cercle)">◻</button>
      <div style="flex:1"></div>
      <button class="vtt-btn-sm vtt-btn-danger" onclick="window._vttClearAnnots()" title="Effacer toutes les annotations de cette page">🗑 Effacer tout</button>
    </div>
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
        <div class="vtt-emote-picker" id="vtt-emote-picker"></div>
        <div class="vtt-chat-input-row">
          <button class="vtt-emote-trigger" onclick="window._vttToggleEmotePicker()" title="Émotes">😄</button>
          <input type="text" id="vtt-chat-input" class="vtt-chat-input" placeholder="Message…"
            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
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
  _loadEmotes();      // non bloquant
  _loadDiceSkills();  // non bloquant
  _initListeners();
}

PAGES.vtt=renderVttPage;

// ── Debug émotes (console) ────────────────────────────────────────
// Tester l'affichage visuel : window._vttDebugEmote('https://url-image.png')
// Tester la couche Firestore : window._vttDebugFire()
window._vttDebugEmote = (url) => {
  const testUrl = url || _emotes[0]?.url || 'https://i.imgur.com/removed.png';
  console.log('[vtt-emote] test visuel avec', testUrl);
  _showEmoteBubble(null, testUrl, 'debug', 'dbg_' + Date.now());
};
window._vttDebugFire = async () => {
  console.log('[vtt-emote] collection:', _reactionsCol().path);
  console.log('[vtt-emote] adventure id:', _aid());
  console.log('[vtt-emote] emotes chargées:', _emotes.length);
  console.log('[vtt-emote] réactions déjà vues:', [..._renderedReactions]);
  const snap = await getDocs(_reactionsCol()).catch(e => { console.error('[vtt-emote] getDocs error:', e); return null; });
  if (snap) console.log('[vtt-emote] docs Firestore:', snap.docs.map(d => ({ id: d.id, ...d.data() })));
};
