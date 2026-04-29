// ═══════════════════════════════════════════════════════════════════
// VTT — Table de Jeu Virtuelle
//
// PRINCIPE : chaque personnage ET chaque PNJ possède déjà son token.
// Pas de création manuelle — les tokens sont auto-générés et resten
// en sync bidirectionnel avec les fiches (HP, nom, photo).
// ═══════════════════════════════════════════════════════════════════

import { STATE } from '../core/state.js';
import { getCurrentAdventureId, getDocData, saveDoc, loadCollection } from '../data/firestore.js';
import {
  db, doc, getDoc, collection, addDoc, updateDoc, deleteDoc,
  setDoc, onSnapshot, serverTimestamp, writeBatch,
} from '../config/firebase.js';
import { getMod, getModFromScore, calcVitesse, calcCA, calcPVMax, calcPMMax, getMaitriseBonus, statShort, computeEquipStatsBonus } from '../shared/char-stats.js';
import { getArmorSetData } from './characters/data.js';
import { showNotif } from '../shared/notifications.js';
import { openModal, closeModalDirect, confirmModal } from '../shared/modal.js';
import { _esc } from '../shared/html.js';
import PAGES from './pages.js';

// ── Constantes ──────────────────────────────────────────────────────
const CELL        = 70;
const MIN_SCALE   = 0.15;
const MAX_SCALE   = 4;

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
let _selected   = null, _attackSrc = null, _moveHL = [];
let _selectedMulti  = new Set();   // ids des tokens en multi-sélection
let _multiDragOrigin= null;        // { [id]: {x,y} } positions au début du drag groupé
let _middlePanActive= false;       // true pendant le pan caméra au clic molette
let _suppressTokenClickUntil = 0;   // bloque le click synthétique après clic droit/molette
let _autoSyncDone = false;   // empêche la double-création de tokens
let _imgTr      = null;      // Transformer pour images BG (sous tokens)
let _imgTrFg    = null;      // Transformer pour images FG (au-dessus des tokens)
let _selImg     = null;      // id de l'image sélectionnée
let _mapMode    = false;     // true = édition carte activée (images déplaçables)
let _emotes     = [];        // [{id, name, url}] chargées depuis world/vtt_emotes
// ── Bibliothèque de cartes ─────────────────────────────────────────
let _mapLib      = { folders: [], images: [] };
let _mapLibUnsub = null;
let _libFolder   = null;   // null = racine, string = folderId ouvert
let _libOpen     = true;   // section collapsible dans le tray
const _mapLibRef = () => doc(db, `adventures/${_aid()}/vtt/mapLibrary`);

// ── Butin ─────────────────────────────────────────────────────────
let _loot            = { stash: [], loot: [] };
let _lootUnsub       = null;
let _lootCloseOutside = null;
const _lootRef  = () => doc(db, `adventures/${_aid()}/vtt/loot`);
let _diceSkills = [];        // [{name, stat}] chargées depuis world/dice_skills
let _rollMode   = 'normal';  // 'advantage' | 'normal' | 'disadvantage'
let _rollBonus  = 0;         // bonus contextuel temporaire (anneau, sort, etc.)
const _renderedPings     = new Set();
const _renderedReactions = new Set();

// ── Outils de dessin & règle ────────────────────────────────────────
const CELL_M = 1.5;          // 1 case = 1.5 mètre
let _annotations      = {};   // id → { data, shape }
let _selectedAnnotId  = null; // id de l'annotation sélectionnée (sélection simple)
let _selectedAnnotIds = new Set(); // multi-sélection annotations
let _annotTransformer = null; // Konva Transformer pour resize/rotation
let _annotGroupDragOrigins = null; // { [id]: {x,y} } pour déplacement groupé annotations

// Marquee (lasso rectangle)
let _marqueeActive  = false;
let _marqueeOrigin  = null;   // world coords du départ
let _marqueeLastWp  = null;   // dernière position pendant le drag
let _marqueeShape   = null;   // Konva Rect visuel
let _suppressNextClick = false; // empêche le click de désélectionner après un marquee

// Ping (remonté au niveau module pour accès depuis les fonctions externes)
let _pingTimer  = null;
let _pingOrigin = null;
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
const _MS_STATS   = [
  { key:'force',        abbr:'FOR' }, { key:'dexterite',    abbr:'DEX' },
  { key:'constitution', abbr:'CON' }, { key:'intelligence', abbr:'INT' },
  { key:'sagesse',      abbr:'SAG' }, { key:'charisme',     abbr:'CHA' },
];

const _numOr = (value, fallback = null) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};
const _signed = n => n > 0 ? `+${n}` : `${n}`;
const _npcStatScore = (npc, key) => _numOr(npc?.stats?.[key], 8);
const _npcStatMod = (npc, key) => getModFromScore(_npcStatScore(npc, key));
const _npcCombat = (npc = {}) => npc?.combat || {};
const _tokenStatMod = (t, statKey) => {
  if (!statKey) return 0;
  if (t?.characterId) return getMod(_characters[t.characterId], statKey);
  if (t?.npcId) return _npcStatMod(_npcs[t.npcId], statKey);
  return 0;
};

// ── État présence & mini-fiche ──────────────────────────────────────
let _presence     = {};   // uid → { uid, pseudo }
let _presHeartbeat= null; // intervalId du heartbeat
let _presRefresh  = null; // intervalId du rafraîchissement présence
let _emoteCloseOutside = null; // listener mousedown fermeture picker émotes
let _trayReserveOpen  = false; // section réserve ouverte/fermée dans le tray MJ
let _miniUid      = null; // uid du joueur dont la mini-fiche est ouverte
let _miniCharId   = null; // characterId sélectionné dans la mini-fiche
let _miniTab      = 'combat'; // onglet actif de la mini-fiche

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

  const npcHpMax = n ? _numOr(e.pv, _numOr(e.hpMax, _numOr(e.pvMax, 20))) : null;
  const npcPmMax = n ? _numOr(e.pmMax, _numOr(e.pm, null)) : null;
  const npcPmCur = n ? _numOr(e.pmCurrent, npcPmMax) : null;
  const npcCombat = n ? _npcCombat(e) : {};
  const npcWeapon = npcCombat.weapon || {};

  const hpMax = c ? (calcPVMax(c) || c.pvBase || 20)
              : b ? (_numOr(b.pvMax, 20))
              : n ? npcHpMax
              : (_numOr(e.hpMax, _numOr(e.pvMax, _numOr(e.pv, 20))));

  // Pour les créatures du bestiaire : HP suivi sur le TOKEN (pas sur la fiche template)
  const hpCurrent = c ? (c.hp ?? hpMax)
                  : n ? (_numOr(n.hp, hpMax))
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
  const npcDice   = npcWeapon.degats || npcCombat.damage || e.attackDice || null;
  const atkDice   = t.attackDice || weapDice || beastDice || npcDice
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
    displayPm:         c ? (c.pm ?? calcPMMax(c)) : n ? npcPmCur : null,
    displayPmMax:      c ? calcPMMax(c) : n ? npcPmMax : null,
    displayMovement:   t.movement ?? (c ? calcVitesse(c) : (b ? (_numOr(b.vitesse, 4)) : (_numOr(e.vitesse, _numOr(e.deplacement, 6))))),
    displayAttack:     t.attack   ?? (c ? toucherMod+setBonus : (b ? (_numOr(b.attaques?.[0]?.toucher, 5)) : (_numOr(e.bonusAttaque, _numOr(e.attack, _numOr(npcWeapon.toucher, (npcWeapon.toucherStat || npcWeapon.statAttaque) ? _npcStatMod(e, npcWeapon.toucherStat || npcWeapon.statAttaque) : e.stats?.force != null ? _npcStatMod(e, 'force') : 5)))))),
    displayAttackDice: atkDice,
    displayDefense:    t.defense  ?? (c ? calcCA(c) : (b ? (_numOr(b.ca, 10)) : (_numOr(e.ca, _numOr(e.defense, 0))))),
    // Pour un perso : arme équipée > override admin (t.range > 1) > défaut 1
    // Pour bestiaire/custom : t.range > 1ère attaque bestiary > défaut 1
    displayRange: c
      ? (t.range > 1 ? t.range : (weapon?.portee ? parseInt(weapon.portee)||1 : 1))
      : b
        ? (t.range > 1 ? t.range : (_numOr(b.attaques?.[0]?.portee, 1)))
        : n
          ? (t.range > 1 ? t.range : (_numOr(npcCombat.range, _numOr(npcWeapon.portee, 1))))
          : (t.range ?? 1),
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
  if (_presHeartbeat) {
    clearInterval(_presHeartbeat); _presHeartbeat = null;
    // Supprimer le doc de présence immédiatement pour que les autres voient le départ
    const _uid = STATE.user?.uid;
    if (_uid) { try { deleteDoc(_pingRef(_uid)).catch(()=>{}); } catch(e){} }
  }
  if (_presRefresh)      { clearInterval(_presRefresh);    _presRefresh   = null; }
  if (_emoteCloseOutside){ document.removeEventListener('mousedown', _emoteCloseOutside, true); _emoteCloseOutside = null; }
  if (_mapLibUnsub) { _mapLibUnsub(); _mapLibUnsub = null; }
  _mapLib = { folders: [], images: [] }; _libFolder = null;
  if (_lootUnsub) { _lootUnsub(); _lootUnsub = null; }
  if (_lootCloseOutside) { document.removeEventListener('mousedown', _lootCloseOutside, true); _lootCloseOutside = null; }
  _loot = { stash: [], loot: [] };
  _presence = {}; _miniUid = null; _miniCharId = null;
  _tokens = {}; _pages = {}; _characters = {}; _npcs = {}; _bestiary = {}; _bstTracker = {};
  _session = {}; _activePage = null; _selected = null; _attackSrc = null;
  _moveHL = []; _autoSyncDone = false; _renderedPings.clear(); _renderedReactions.clear();
  _selectedMulti.clear(); _multiDragOrigin = null;
  _annotations = {}; _drawing = false; _drawLive = null;
  _selectedAnnotId = null; _selectedAnnotIds.clear(); _annotTransformer = null;
  _annotGroupDragOrigins = null;
  _marqueeActive = false; _marqueeOrigin = null; _marqueeLastWp = null;
  _marqueeShape = null; _suppressNextClick = false;
  _pingTimer = null; _pingOrigin = null;
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
  K.dragButtons = [0, 2]; // Drag autorisé au clic gauche et droit (tokens/images/annotations).
  _stage = new K.Stage({ container, width: container.clientWidth, height: container.clientHeight });
  // Konva recommande max 3-5 layers. On consolide bg+map dans `backLayer` et
  // mapFg+ping dans `frontLayer` via des Konva.Group — l'ordre interne préserve
  // le z-order, et chaque "_layers.X" garde son API (add/find/destroyChildren/listening).
  // batchDraw() est forwardé vers le layer parent.
  // Ordre visuel : bg → map → grid → draw → token → mapFg → ping (5 layers Konva).
  const backLayer  = new K.Layer();
  const frontLayer = new K.Layer();
  const _asLayer = (group, parentLayer) => {
    group.batchDraw = () => parentLayer.batchDraw();
    return group;
  };
  _layers.bg    = _asLayer(new K.Group({ listening: false }), backLayer);
  _layers.map   = _asLayer(new K.Group({ listening: false }), backLayer);
  _layers.grid  = new K.Layer({ listening: true });
  _layers.draw  = new K.Layer();                     // annotations (entre grille et tokens)
  _layers.token = new K.Layer();
  _layers.mapFg = _asLayer(new K.Group({ listening: false }), frontLayer);
  _layers.ping  = _asLayer(new K.Group({ listening: false }), frontLayer);
  backLayer.add(_layers.bg, _layers.map);
  frontLayer.add(_layers.mapFg, _layers.ping);
  _stage.add(backLayer, _layers.grid, _layers.draw, _layers.token, frontLayer);

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

  // Transformer annotations — disponible pour tous (chaque joueur interagit avec ses propres dessins)
  _annotTransformer = new K.Transformer({
    rotateEnabled: true, keepRatio: false,
    borderStroke: '#ffe600', borderStrokeWidth: 1,
    anchorStroke: '#ffe600', anchorFill: '#1a1a2e', anchorSize: 8, anchorCornerRadius: 2,
  });
  _layers.draw.add(_annotTransformer);

  // Listener natif window : règle + marquee (bypass Konva, garanti même hors drag)
  const _nativeMoveHandler = e => {
    if (!_stage) return;
    const rect = container.getBoundingClientRect();
    const inCanvas = e.clientX >= rect.left && e.clientX <= rect.right &&
                     e.clientY >= rect.top  && e.clientY <= rect.bottom;
    const wp = inCanvas
      ? _stageToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      : null;

    // Règle (free-hover, reste dans le canvas)
    if (wp && _tool === 'ruler' && _rulerActive) _updateRuler(wp);

    // Marquee : suivi pendant le drag (peut sortir légèrement du canvas)
    if (_tool === 'select' && _marqueeOrigin) {
      const trackWp = wp ?? _marqueeLastWp; // utiliser la dernière pos connue si hors canvas
      if (!trackWp) return;
      if (!_marqueeActive) {
        const dx = trackWp.x - _marqueeOrigin.x, dy = trackWp.y - _marqueeOrigin.y;
        if (Math.hypot(dx, dy) > 8) {
          _marqueeActive = true;
          if (_pingTimer) { clearTimeout(_pingTimer); _pingTimer = null; }
          _clearMultiSelect();
          _deselectAnnot();
          const K = window.Konva;
          _marqueeShape = new K.Rect({
            x: _marqueeOrigin.x, y: _marqueeOrigin.y, width: 0, height: 0,
            stroke: '#4f8cff', strokeWidth: 1.5, fill: 'rgba(79,140,255,0.1)',
            dash: [6, 3], listening: false, name: 'marquee',
          });
          _layers.ping.add(_marqueeShape);
        }
      }
      if (_marqueeActive && wp) {
        _marqueeLastWp = wp;
        const x = Math.min(_marqueeOrigin.x, wp.x), y = Math.min(_marqueeOrigin.y, wp.y);
        _marqueeShape?.setAttrs({ x, y,
          width:  Math.abs(wp.x - _marqueeOrigin.x),
          height: Math.abs(wp.y - _marqueeOrigin.y) });
        _layers.ping?.batchDraw();
      }
    }
  };
  window.addEventListener('mousemove', _nativeMoveHandler);
  _unsubs.push(() => window.removeEventListener('mousemove', _nativeMoveHandler));

  _stage.on('wheel', e => {
    e.evt.preventDefault();
    const old = _stage.scaleX();
    const dir = e.evt.deltaY < 0 ? 1 : -1;
    const sc  = Math.min(MAX_SCALE, Math.max(MIN_SCALE, old * (1 + dir * 0.1)));
    const ptr = _stage.getPointerPosition();
    _stage.scale({ x:sc, y:sc });
    _stage.position({ x: ptr.x - (ptr.x-_stage.x())*(sc/old), y: ptr.y - (ptr.y-_stage.y())*(sc/old) });
  });

  let _pan = false, _po = null, _rightStageDown = null;

  // Pan caméra au clic molette. K.dragButtons=[0] empêche déjà tout drag de
  // tokens/images/annotations sur autre que clic gauche, donc pas besoin de
  // toucher .draggable() ici.
  const _startMiddlePan = e => {
    if (e.button !== 1) return;
    if (!_stage) return;
    e.preventDefault();
    if (_middlePanActive) return;

    _middlePanActive = true;
    _pan = true;
    _po = { x: e.clientX - _stage.x(), y: e.clientY - _stage.y() };

    const onMove = ev => {
      if ((ev.buttons & 4) === 0) { onUp(); return; }
      ev.preventDefault();
      _stage.position({ x: ev.clientX - _po.x, y: ev.clientY - _po.y });
    };
    const onUp = () => {
      _middlePanActive = false;
      _pan = false;
      _po = null;
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup',   onUp,   true);
      window.removeEventListener('blur',      onUp,   true);
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup',   onUp,   true);
    window.addEventListener('blur',      onUp,   true);
  };
  const _preventMiddleAuxClick = e => {
    if (e.button === 1) e.preventDefault();
  };
  container.addEventListener('mousedown', _startMiddlePan, true);
  container.addEventListener('auxclick',  _preventMiddleAuxClick, true);
  _unsubs.push(() => {
    container.removeEventListener('mousedown', _startMiddlePan, true);
    container.removeEventListener('auxclick',  _preventMiddleAuxClick, true);
  });

  _stage.on('mousedown', e => {
    if (e.evt.button===2) {
      e.evt.preventDefault();
      // Pan caméra au clic droit UNIQUEMENT sur stage vide.
      // Sur un token/image/annotation, on laisse Konva gérer le drag (K.dragButtons=[0,2]).
      if (e.target === _stage) {
        _pan = true; _po = { x:e.evt.clientX-_stage.x(), y:e.evt.clientY-_stage.y() };
        _rightStageDown = { x:e.evt.clientX, y:e.evt.clientY };
      }
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
      // Clic normal → ping (+ départ marquee en mode select)
      if (e.target===_stage) {
        if (_tool === 'select') _marqueeOrigin = _stageToWorld(np);
        _pingOrigin = { ...np };
        _pingTimer = setTimeout(() => {
          _pingTimer = null;
          if (_marqueeActive) return; // pas de ping si le lasso est en cours
          const sc = _stage.scaleX(), sp = _stage.position();
          _emitPing((_pingOrigin.x - sp.x) / sc, (_pingOrigin.y - sp.y) / sc);
        }, 300);
      }
    }
  });
  _stage.on('mousemove', e => {
    if (_pan && _po) _stage.position({ x:e.evt.clientX-_po.x, y:e.evt.clientY-_po.y });
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
    if (_marqueeActive) { _endMarquee(); _suppressNextClick = true; }
    _marqueeOrigin = null;
    if (_tool === 'draw' && _drawing) _endDraw();
  });
  _stage.on('contextmenu', e => {
    e.evt.preventDefault();
    if (e.target !== _stage) return;
    const moved = _rightStageDown
      ? Math.hypot(e.evt.clientX - _rightStageDown.x, e.evt.clientY - _rightStageDown.y) > 6
      : false;
    _rightStageDown = null;
    if (!moved) { _deselect(); _deselectAnnot(); }
  });
  _stage.on('click', e => {
    if (e.evt.button !== 0) return; // ignore middle/right (pan caméra)
    if (e.target===_stage) {
      if (_suppressNextClick) { _suppressNextClick = false; return; }
      _deselect(); _deselectAnnot();
    }
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
          if (e.evt.button !== 0) return; // ignore middle/right (pan caméra)
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
  // ── Barre PM (joueurs + PNJ avec PM renseignés, texte superposé) ──
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
  let rightDown = null;
  if (canDrag) {
    g.draggable(true);
    g.on('mousedown', e => {
      if (e.evt.button === 2) rightDown = { x:e.evt.clientX, y:e.evt.clientY, dragged:false };
    });
    // ─ Début du drag : mémoriser les positions du groupe ─
    g.on('dragstart', () => {
      if (rightDown) rightDown.dragged = true;
      if (_middlePanActive) {
        g.stopDrag();
        g.position({ x:t.col*CELL+CELL/2, y:t.row*CELL+CELL/2 });
        _layers.token?.batchDraw();
        return;
      }
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
      if (rightDown) rightDown.dragged = true;
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

  const _isAttackTargetInRange = (srcId, tgtId) => {
    const src = _tokens[srcId]?.data;
    const tgt = _tokens[tgtId]?.data;
    if (!src || !tgt) return false;
    const dist = _tokenAttackDistance(src, tgt);
    const options = _buildAttackOptions(src);
    const maxRange = options.length ? Math.max(...options.map(o => o.portee)) : 0;
    if (options.some(o => dist <= o.portee)) return true;
    showNotif(`Hors de portée (${dist} case${dist>1?'s':''}, portée max ${maxRange})`, 'error');
    return false;
  };

  const handleTokenAction = (e, opts = {}) => {
    e.cancelBubble = true;
    if (_tool === 'ruler' || _tool === 'draw') return; // outils de dessin ignorent les tokens
    if (e.evt.shiftKey && (STATE.isAdmin||t.ownerId===STATE.user?.uid)) {
      // Shift+clic : ajouter / retirer du groupe multi-sélection
      _toggleMultiSelect(t.id); return;
    }
    _clearMultiSelect();
    if (_attackSrc && _attackSrc!==t.id) {
      // Attaquant déjà désigné → clic sur une cible → lancer l'attaque
      if (opts.deselectOutOfRange && !_isAttackTargetInRange(_attackSrc, t.id)) {
        _deselect();
        return;
      }
      _execAttack(_attackSrc, t.id);
    } else {
      // Sélectionner le token (si token propre, montre la portée d'attaque)
      _select(t.id);
    }
  };

  g.on('click', e => {
    if (e.evt.button !== 0) return; // le clic droit court passe par contextmenu
    handleTokenAction(e);
  });

  g.on('contextmenu', e => {
    e.evt.preventDefault();
    e.cancelBubble = true;
    const moved = rightDown
      ? rightDown.dragged || Math.hypot(e.evt.clientX - rightDown.x, e.evt.clientY - rightDown.y) > 6
      : false;
    rightDown = null;
    if (moved) return;
    handleTokenAction(e, { deselectOutOfRange: true });
  });

  return g;
}

function _patchShape(id) {
  const e=_tokens[id]; if (!e?.shape) return;
  const ld=_live(e.data); const g=e.shape;
  const hasPmBar = !!g.findOne('.pm-val');
  if ((ld.displayPm != null) !== hasPmBar) {
    const shape = _buildShape(e.data);
    g.destroy();
    _tokens[id] = { ...e, shape };
    _layers.token?.add(shape);
    if (_selected === id) shape.findOne('.sel')?.visible(true);
    if (_attackSrc === id) shape.findOne('.atk')?.visible(true);
    _layers.token?.batchDraw();
    return;
  }
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
    if (!blk){
      const tc=c, tr=r;
      const moveSelectedHere = async e => { e.cancelBubble=true; if (_selected) await _moveTo(_selected, tc, tr); };
      rect.on('click', e => { if (e.evt.button!==0) return; moveSelectedHere(e); });
      rect.on('contextmenu', e => { e.evt.preventDefault(); moveSelectedHere(e); });
    }
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
// Parse "NdM[+K]" ou nombre fixe → { n, sides, mod } ou null si non-formule.
function _parseDice(formula) {
  if (!formula) return null;
  const m = String(formula).match(/^(\d+)[dD](\d+)([+-]\d+)?$/);
  return m ? { n:+m[1], sides:+m[2], mod:+(m[3]||0) } : null;
}

function _rollDice(formula) {
  const p = _parseDice(formula);
  if (!p) return Math.max(1, parseInt(formula)||1);
  let total = 0;
  for (let i=0; i<p.n; i++) total += Math.floor(Math.random()*p.sides)+1;
  return total + p.mod;
}

/** Valeur maximale possible d'une formule de dés (ex: "2d6+3" → 15). */
function _maxDice(formula) {
  const p = _parseDice(formula);
  return p ? p.n * p.sides + p.mod : Math.max(1, parseInt(formula)||1);
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

const _tokenAttackDistance = (src, tgt) => Math.abs(src.col - tgt.col) + Math.abs(src.row - tgt.row);

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

  // ── PNJ : stats saisies dans la fiche PNJ ──
  if (!c && t.npcId) {
    const n = _npcs[t.npcId] || {};
    const combat = _npcCombat(n);
    const weapon = combat.weapon || {};
    const dmgStat = (Array.isArray(weapon.degatsStats) && weapon.degatsStats.length
      ? weapon.degatsStats[0]
      : (weapon.degatsStat || weapon.statAttaque || 'force'));
    const dmgMod = _npcStatMod(n, dmgStat);
    options.push({
      id: 'npc_attack',
      icon: '⚔️',
      label: weapon.nom || combat.weaponName || 'Attaque',
      rawDice: t.attackDice || weapon.degats || combat.damage || n.attackDice || '1d6',
      dice: t.attackDice || weapon.degats || combat.damage || n.attackDice || '1d6',
      portee: ld.displayRange ?? 1,
      pmCost: 0,
      toucher: ld.displayAttack ?? 5,
      dmgStatMod: dmgMod,
      dmgStatLabel: statShort(dmgStat) || dmgStat,
      maitriseBonus: 0,
      halfOnMiss: false,
      traits: Array.isArray(weapon.traits) ? weapon.traits : [],
    });
    return options;
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
  const dist=_tokenAttackDistance(src, tgt);

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
              ${o.traits?.length ? `· <span style="color:#b47fff">${o.traits.slice(0, 2).map(_esc).join(', ')}</span>` : ''}
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

  const dist    = _tokenAttackDistance(src, tgt);
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
    degatsFormula = `<code style="font-size:.88rem;color:${dmgAccent}">${_esc(opt.dice)}</code>`;
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
          <strong>${_esc(lS.displayName??src.name)}</strong>
          <span style="color:var(--text-dim);margin:0 .3rem">→</span>
          <strong style="color:${opt.isHeal?'#22c38e':'#ef4444'}">${_esc(lT.displayName??tgt.name)}</strong>
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
          return;
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
  finally { _cleanup(); }
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
    const npcCombat = t.npcId ? _npcCombat(_npcs[t.npcId]) : {};
    const npcWeapon = npcCombat.weapon || {};
    const atkLabel = t.npcId
      ? (npcWeapon.nom || npcCombat.weaponName ? (npcWeapon.nom || npcCombat.weaponName) + ' · ' : '') + (ld.displayAttackDice || '1d6') + _signed(ld.displayAttack ?? 0)
      : (ld.displayAttackDice || (ld.displayAttack??5));
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
        _stat('⚔️', 'Attaque', atkLabel) +
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
    ${(t.type==='player'||t.type==='npc') && _diceSkills.length && (STATE.isAdmin||t.ownerId===STATE.user?.uid) ? (() => {
      const btns = _diceSkills.map(s => {
        const statKey = _STAT_KEY[s.stat] || '';
        const mod  = _tokenStatMod(t, statKey);
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
// TRAY — panneau latéral MJ
// ═══════════════════════════════════════════════════════════════════
window._vttToggleTrayReserve = () => { _trayReserveOpen = !_trayReserveOpen; _renderTray(); };

function _renderTray() {
  if (!STATE.isAdmin) return;
  _renderPageList();
  const el=document.getElementById('vtt-tray-tokens'); if (!el) return;

  const all    = Object.values(_tokens).map(e=>e.data);
  const onPage = all.filter(t=>t.pageId===_activePage?.id);
  const reserve= all.filter(t=>!t.pageId && t.type!=='enemy');

  // ── Item de token (liste) ─────────────────────────────────────────
  const mkItem=(t,placed)=>{
    const ld=_live(t);
    const hp=ld.displayHp??20, hpm=ld.displayHpMax??20;
    const rat=hpm>0?Math.max(0,hp/hpm):1;
    const typeIcon = t.type==='player'?'🧑':t.type==='npc'?'👤':'👹';
    const dupBtn=t.type==='enemy'
      ?`<button class="vtt-tray-btn" onclick="event.stopPropagation();window._vttDuplicateToken('${t.id}')" title="Dupliquer">＋</button>`:'';
    const delBtn=t.type==='enemy'
      ?`<button class="vtt-tray-btn vtt-tray-btn-del" onclick="event.stopPropagation();window._vttDeleteToken('${t.id}')" title="Supprimer">×</button>`:'';
    const actionBtn=!placed
      ?`<button class="vtt-tray-btn" onclick="event.stopPropagation();window._vttPlace('${t.id}')" title="Placer">▶</button>`
      :`<button class="vtt-tray-btn" onclick="event.stopPropagation();window._vttRetireToken('${t.id}')" title="Retirer">↩</button>`;
    return `<div class="vtt-tray-item ${_selected===t.id?'active':''}" onclick="window._vttSelectFromTray('${t.id}')">
      <div class="vtt-tray-dot" style="background:${TYPE_COLOR[t.type]??'#888'}">
        ${ld.displayImage?`<img src="${ld.displayImage}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
          :`<span style="font-size:.65rem">${typeIcon}</span>`}
      </div>
      <div class="vtt-tray-info">
        <div class="vtt-tray-name">${ld.displayName??t.name}</div>
        <div class="vtt-tray-hp-bar"><div style="width:${Math.round(rat*100)}%;height:100%;background:${hpColor(rat)};border-radius:2px"></div></div>
      </div>
      <div class="vtt-tray-actions">${dupBtn}${actionBtn}${delBtn}</div>
    </div>`;
  };

  // ── Helper sous-groupe ───────────────────────────────────────────
  const mkSubGroup = (label, items, placed) => {
    if (!items.length) return '';
    return `<div class="vtt-tray-sublabel">${label}</div>${items.map(t=>mkItem(t,placed)).join('')}`;
  };

  // ── Section 1 : Sur cette page — alliés / ennemis séparés ────────
  const pageAllies  = onPage.filter(t=>t.type!=='enemy');
  const pageEnemies = onPage.filter(t=>t.type==='enemy');
  let pageSec;
  if (!onPage.length) {
    pageSec = `<div class="vtt-tray-empty">Aucun token sur cette page</div>`;
  } else if (!pageAllies.length || !pageEnemies.length) {
    // Un seul type : pas besoin de sous-groupe
    pageSec = onPage.map(t=>mkItem(t,true)).join('');
  } else {
    pageSec = mkSubGroup('🧑 Alliés', pageAllies, true)
            + mkSubGroup('👹 Ennemis', pageEnemies, true);
  }

  // ── Section 2 : Bestiaire — grille d'icônes ───────────────────────
  const bsts=Object.values(_bestiary);
  const bstGrid = bsts.length
    ? bsts.map(b=>{
        const img=b.photoURL||b.photo||b.avatar||b.imageUrl||'';
        const pvMax=parseInt(b.pvMax)||'?';
        const init=(b.nom||'?')[0].toUpperCase();
        return `<button class="vtt-bst-tile" onclick="window._vttPlaceFromBestiary('${b.id}')"
            title="${_esc(b.nom||'Créature')} · PV ${pvMax}">
          ${img
            ?`<img src="${img}" alt="${_esc(b.nom||'')}">`
            :`<span class="vtt-bst-icon">${init}</span>`}
          <div class="vtt-bst-name">${_esc((b.nom||'Créature').slice(0,8))}</div>
        </button>`;
      }).join('')
    : `<div class="vtt-tray-empty">Bestiaire vide</div>`;

  // ── Section 3 : Réserve — joueurs / PNJ séparés ──────────────────
  const resPlayers = reserve.filter(t=>t.type==='player');
  const resNpcs    = reserve.filter(t=>t.type==='npc');
  const reserveSec = _trayReserveOpen && reserve.length
    ? mkSubGroup('🧑 Joueurs', resPlayers, false) + mkSubGroup('👤 PNJ', resNpcs, false)
    : '';

  el.innerHTML=`
    <div class="vtt-tray-sect">
      <div class="vtt-tray-sect-hd">
        <span>🗺 Sur la page</span>
        <span class="vtt-tray-count">${onPage.length}</span>
      </div>
      ${pageSec}
    </div>
    <div class="vtt-tray-sect">
      <div class="vtt-tray-sect-hd" style="justify-content:space-between">
        <span>👹 Bestiaire</span>
        <button class="vtt-tray-add-btn" onclick="window._vttCreateEnemy()" title="Créer un ennemi">＋</button>
      </div>
      <div class="vtt-bst-grid">${bstGrid}</div>
    </div>
    ${reserve.length || _trayReserveOpen ? `
    <div class="vtt-tray-sect">
      <div class="vtt-tray-sect-hd vtt-tray-collapsible" onclick="window._vttToggleTrayReserve()">
        <span>📦 Réserve</span>
        <span class="vtt-tray-count">${reserve.length} ${_trayReserveOpen?'▲':'▼'}</span>
      </div>
      ${reserveSec}
    </div>` : ''}
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

// ─ Indicateur de page courant pour les joueurs (lecture seule) ──────
function _renderPageTabs() {
  if (STATE.isAdmin) { _renderPageList(); return; } // MJ : liste dans le tray
  const el=document.getElementById('vtt-page-tabs'); if (!el) return;
  // Les joueurs ne naviguent pas — ils voient juste le nom de leur page courante
  const name = _activePage?.name ?? '…';
  el.innerHTML = `<span class="vtt-page-current-label">📍 ${name}</span>`;
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
  // listening sera ajusté par _updateAnnotDraggable selon l'outil et la propriété
  const base = { stroke: col, strokeWidth: data.strokeWidth || 2,
    lineCap:'round', lineJoin:'round', name:'annot', listening: false };
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

  // MJ peut tout modifier, joueur seulement ses propres dessins
  const canEdit = STATE.isAdmin || data.createdBy === STATE.user?.uid;

  if (canEdit) {
    // Clic gauche → sélectionner (mode select uniquement)
    shape.on('click', e => {
      if (e.evt.button !== 0) return; // ignore middle/right (pan caméra)
      if (_tool !== 'select') return;
      e.cancelBubble = true;
      if (e.evt.shiftKey) {
        // Shift+clic : toggle dans la multi-sélection
        if (_selectedAnnotIds.has(data.id)) _selectedAnnotIds.delete(data.id);
        else _selectedAnnotIds.add(data.id);
      } else {
        _selectedAnnotIds.clear();
        _selectedAnnotIds.add(data.id);
        _selectedAnnotId = data.id;
      }
      _applyAnnotTransformer();
    });
    // Clic-droit → supprimer la sélection (mode select uniquement)
    shape.on('contextmenu', e => {
      if (_tool !== 'select') return;
      e.evt.preventDefault(); e.cancelBubble = true;
      // Supprimer toutes les annotations sélectionnées (ou juste celle-ci si pas sélectionnée)
      const toDelete = _selectedAnnotIds.has(data.id) ? [..._selectedAnnotIds] : [data.id];
      toDelete.forEach(id => deleteDoc(_annotRef(id)).catch(() => {}));
      _deselectAnnot();
    });
    // Début de drag groupé
    shape.on('dragstart', () => {
      if (_selectedAnnotIds.has(data.id) && _selectedAnnotIds.size > 1) {
        _annotGroupDragOrigins = {};
        for (const id of _selectedAnnotIds) {
          const s = _annotations[id]?.shape;
          if (s) _annotGroupDragOrigins[id] = { x: s.x(), y: s.y() };
        }
      } else { _annotGroupDragOrigins = null; }
    });
    // Déplacement groupé
    shape.on('dragmove', () => {
      if (!_annotGroupDragOrigins || !_selectedAnnotIds.has(data.id)) return;
      const orig = _annotGroupDragOrigins[data.id];
      if (!orig) return;
      const dx = shape.x() - orig.x, dy = shape.y() - orig.y;
      for (const [id, o] of Object.entries(_annotGroupDragOrigins)) {
        if (id === data.id) continue;
        _annotations[id]?.shape?.position({ x: o.x + dx, y: o.y + dy });
      }
      _layers.draw.batchDraw();
    });
    // Fin de drag → sauvegarder position(s)
    shape.on('dragend', () => {
      const idsToSave = (_annotGroupDragOrigins && _selectedAnnotIds.has(data.id))
        ? [..._selectedAnnotIds] : [data.id];
      for (const id of idsToSave) {
        const s = _annotations[id]?.shape, ann = _annotations[id]?.data;
        if (!s || !ann) continue;
        const update = (ann.type === 'freehand' || ann.type === 'line')
          ? { offsetX: s.x(), offsetY: s.y() }
          : { x: s.x(), y: s.y() };
        updateDoc(_annotRef(id), update).catch(() => {});
      }
      _annotGroupDragOrigins = null;
    });
    // Fin de transformation (rotate/resize) → sauvegarder
    shape.on('transformend', () => {
      updateDoc(_annotRef(data.id), {
        rotation: shape.rotation(), scaleX: shape.scaleX(), scaleY: shape.scaleY(),
        x: shape.x(), y: shape.y(),
      }).catch(() => {});
    });
  }
  return shape;
}

// ── Sélection groupée annotations ──────────────────────────────────
function _applyAnnotTransformer() {
  if (!_annotTransformer) return;
  const shapes = [..._selectedAnnotIds].map(id => _annotations[id]?.shape).filter(Boolean);
  _annotTransformer.nodes(shapes);
  _layers.draw?.batchDraw();
}

function _inRect(cx, cy, r) {
  return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
}

function _selectByRect(r) {
  _clearMultiSelect();
  _deselectAnnot();
  const uid = STATE.user?.uid;

  // Tokens sur la page active
  for (const [id, {data: t}] of Object.entries(_tokens)) {
    if (!t || t.pageId !== _activePage?.id) continue;
    const cx = t.col * CELL + CELL / 2, cy = t.row * CELL + CELL / 2;
    if (_inRect(cx, cy, r)) {
      _selectedMulti.add(id);
      _tokens[id]?.shape?.findOne('.sel')?.visible(true);
    }
  }

  // Annotations interactives sur la page active
  for (const [id, e] of Object.entries(_annotations)) {
    if (!e.data || e.data.pageId !== _activePage?.id || !e.shape) continue;
    if (!STATE.isAdmin && e.data.createdBy !== uid) continue;
    const bb = e.shape.getClientRect({ relativeTo: _stage });
    const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
    if (_inRect(cx, cy, r)) _selectedAnnotIds.add(id);
  }

  _applyAnnotTransformer();
  if (_selectedMulti.size > 0) _renderInspector(null);
  else if (_selectedAnnotIds.size > 0) _renderInspector(null);
  _layers.token?.batchDraw();
}

function _endMarquee() {
  _marqueeActive = false;
  _marqueeShape?.destroy(); _marqueeShape = null;
  _layers.ping?.batchDraw();
  if (!_marqueeLastWp || !_marqueeOrigin) { _marqueeLastWp = null; return; }
  const r = {
    x: Math.min(_marqueeOrigin.x, _marqueeLastWp.x),
    y: Math.min(_marqueeOrigin.y, _marqueeLastWp.y),
    w: Math.abs(_marqueeLastWp.x - _marqueeOrigin.x),
    h: Math.abs(_marqueeLastWp.y - _marqueeOrigin.y),
  };
  _marqueeLastWp = null;
  if (r.w < 5 && r.h < 5) return;
  _selectByRect(r);
}

function _deselectAnnot() {
  _selectedAnnotId = null;
  _selectedAnnotIds.clear();
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
  if (!_layers.draw) return;
  const inSelect = _tool === 'select';
  const uid = STATE.user?.uid;
  Object.values(_annotations).forEach(e => {
    if (!e.shape) return;
    const canEdit = STATE.isAdmin || e.data.createdBy === uid;
    const active  = inSelect && canEdit;
    e.shape.draggable(active);
    e.shape.listening(active);
  });
  if (inSelect) _applyAnnotTransformer(); // maintenir le transformer sur la sélection courante
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
    if (_miniUid) _renderMiniSheet(_miniUid); // refresh mini-fiche en temps réel
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

  // 8. Pings + présence temps réel
  _unsubs.push(onSnapshot(_pingsCol(), snap => {
    const now = Date.now();

    // Présence : actif si lastSeen < 2 min (double filtrage : ici + render)
    _presence = {};
    snap.docs.forEach(d => {
      const pres = d.data().pres;
      if (!pres?.lastSeen) return;
      const ts = pres.lastSeen?.toMillis?.() ?? (typeof pres.lastSeen === 'number' ? pres.lastSeen : 0);
      if (ts > 0 && now - ts < 120_000) _presence[d.id] = { uid: d.id, pseudo: pres.pseudo || '?', lastSeen: ts };
    });
    _renderPresenceCol();

    // Pings visuels (< 5 s)
    const pings = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.pageId === _activePage?.id && p.createdAt && (now - p.createdAt.toMillis()) < 5000);
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

  // Bibliothèque de cartes (MJ only)
  if (STATE.isAdmin) {
    _mapLibUnsub = onSnapshot(_mapLibRef(), snap => {
      _mapLib = snap.exists() ? snap.data() : {};
      if (!Array.isArray(_mapLib.folders)) _mapLib.folders = [];
      if (!Array.isArray(_mapLib.images))  _mapLib.images  = [];
      _renderLibSection();
    }, () => {});
  }

  // Butin d'aventure
  _lootUnsub = onSnapshot(_lootRef(), snap => {
    _loot = snap.exists() ? snap.data() : {};
    if (!Array.isArray(_loot.stash)) _loot.stash = [];
    if (!Array.isArray(_loot.loot))  _loot.loot  = [];
    _renderLootPanel();
  }, () => {});
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
// ── Émotes ──────────────────────────────────────────────────────────
async function _loadEmotes() {
  // 1. Tenter le path scopé à l'aventure (path normal)
  try {
    const data = await getDocData('world', 'vtt_emotes');
    if (data?.emotes?.length) { _emotes = data.emotes; return; }
  } catch(e) { console.warn('[vtt] emotes (adventure path) :', e.message); }

  // 2. Fallback : path global world/vtt_emotes (migration ancien stockage)
  try {
    const snap = await getDoc(doc(db, 'world', 'vtt_emotes'));
    _emotes = snap.data()?.emotes || [];
    if (_emotes.length) console.info('[vtt] emotes chargées depuis le path global (migration)');
  } catch(e) {
    console.warn('[vtt] emotes (global path) :', e.message);
    _emotes = [];
  }
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
  if (!t) return;
  if (!STATE.isAdmin && t.ownerId !== STATE.user?.uid) return; // joueur ne peut lancer que son propre token
  const c = t?.characterId ? _characters[t.characterId] : null;
  const n = t?.npcId ? _npcs[t.npcId] : null;
  const statKey = _STAT_KEY[stat] || '';
  const mod = _tokenStatMod(t, statKey);
  const d20 = () => Math.floor(Math.random() * 20) + 1;

  let d1 = d20(), d2, roll;
  if (_rollMode === 'advantage')    { d2 = d20(); roll = Math.max(d1, d2); }
  else if (_rollMode === 'disadvantage') { d2 = d20(); roll = Math.min(d1, d2); }
  else                              { roll = d1; }

  const total   = roll + mod + _rollBonus;
  const isCrit  = roll === 20, isFumble = roll === 1;
  const authorName    = STATE.profile?.pseudo || STATE.profile?.prenom || 'Joueur';
  const characterName = c?.nom || n?.nom || t?.name || null;
  const characterImage = c?.photoURL || c?.photo || c?.avatar || n?.photoURL || n?.photo || n?.avatar || n?.imageUrl || null;
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
    const key = `:${_esc(em.name)}:`;
    const img = `<img class="vtt-emote-inline" src="${em.url}" alt="${key}" title="${key}">`;
    escaped = escaped.split(key).join(img);
  }
  return escaped;
}

// Favoris émotes — stockés en localStorage
const _getFavs = () => { try { return JSON.parse(localStorage.getItem('vtt-emote-favs')||'[]'); } catch { return []; } };
const _setFavs = v => localStorage.setItem('vtt-emote-favs', JSON.stringify(v));

function _emoteGridHtml(list, favSet=new Set()) {
  if (!list.length) return '<div class="vtt-emote-empty-grid">Aucune émote trouvée</div>';
  return list.map(em => {
    const safe = em.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const isFav = favSet.has(em.name);
    return `<div class="vtt-emote-item-wrap">
      <button class="vtt-emote-item" onclick="window._vttPickEmote('${safe}')" title=":${_esc(em.name)}:">
        <img src="${em.url}" alt="${_esc(em.name)}" loading="lazy">
        <span>${_esc(em.name)}</span>
      </button>
      <button class="vtt-emote-fav-btn${isFav?' active':''}" onclick="window._vttToggleFav('${safe}')" title="${isFav?'Retirer des favoris':'Ajouter aux favoris'}">${isFav?'★':'☆'}</button>
    </div>`;
  }).join('');
}

function _renderEmotePicker() {
  const el = document.getElementById('vtt-emote-picker');
  if (!el) return;
  if (!_emotes.length) {
    el.innerHTML = '<div class="vtt-emote-picker-search"><span style="padding:.5rem;display:block;font-size:.75rem;color:var(--text-muted)">Aucune émote — à configurer dans la Console MJ</span></div>';
    return;
  }
  const favSet = new Set(_getFavs());
  const favEmotes = _emotes.filter(e => favSet.has(e.name));
  const favBlock = favEmotes.length
    ? `<div id="vtt-emote-fav-section">
        <div class="vtt-emote-section-lbl gold">⭐ Favoris</div>
        <div class="vtt-emote-grid" id="vtt-emote-fav-grid">${_emoteGridHtml(favEmotes, favSet)}</div>
      </div>
      <div class="vtt-emote-section-lbl">Toutes</div>`
    : `<div id="vtt-emote-fav-section" style="display:none"></div>`;
  el.innerHTML = `
    <div class="vtt-emote-picker-search">
      <input type="text" id="vtt-emote-search" placeholder="🔍 Rechercher…" autocomplete="off"
        oninput="window._vttFilterEmotes(this.value)">
    </div>
    <div class="vtt-emote-picker-body">
      ${favBlock}
      <div class="vtt-emote-grid" id="vtt-emote-grid">${_emoteGridHtml(_emotes, favSet)}</div>
    </div>`;
  setTimeout(() => document.getElementById('vtt-emote-search')?.focus(), 40);
}

window._vttFilterEmotes = (q) => {
  const favSet = new Set(_getFavs());
  const grid = document.getElementById('vtt-emote-grid'); if (!grid) return;
  const filtered = q.trim() ? _emotes.filter(e => e.name.includes(q.trim().toLowerCase())) : _emotes;
  grid.innerHTML = _emoteGridHtml(filtered, favSet);
  const favSection = document.getElementById('vtt-emote-fav-section');
  if (favSection) favSection.style.display = q.trim() ? 'none' : '';
};

window._vttToggleFav = (name) => {
  const favs = _getFavs();
  const idx = favs.indexOf(name);
  if (idx >= 0) favs.splice(idx, 1); else favs.push(name);
  _setFavs(favs);
  // Re-render en préservant la query de recherche
  const q = document.getElementById('vtt-emote-search')?.value || '';
  _renderEmotePicker();
  if (q) {
    const input = document.getElementById('vtt-emote-search');
    if (input) { input.value = q; _vttFilterEmotes(q); }
  }
};

function _closeEmotePicker() {
  const el  = document.getElementById('vtt-emote-picker');
  const btn = document.querySelector('.vtt-emote-trigger');
  el?.classList.remove('open');
  btn?.classList.remove('open');
  if (_emoteCloseOutside) {
    document.removeEventListener('mousedown', _emoteCloseOutside, true);
    _emoteCloseOutside = null;
  }
}

window._vttToggleEmotePicker = () => {
  const el  = document.getElementById('vtt-emote-picker');
  const btn = document.querySelector('.vtt-emote-trigger');
  if (!el) return;
  const open = el.classList.toggle('open');
  btn?.classList.toggle('open', open);
  if (open) {
    _renderEmotePicker();
    _emoteCloseOutside = (e) => {
      const float = document.querySelector('.vtt-emote-float');
      if (float && !float.contains(e.target)) _closeEmotePicker();
    };
    document.addEventListener('mousedown', _emoteCloseOutside, true);
  } else {
    _closeEmotePicker();
  }
};

window._vttPickEmote = async (name) => {
  const uid = STATE.user?.uid; if (!uid) return;
  const em = _emotes.find(e => e.name === name); if (!em) return;
  // Le picker reste ouvert — l'utilisateur ferme manuellement

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
  const _getEmoteAlbum = () => localStorage.getItem('vtt-imgbb-emote-album') || '';
  const _setEmoteAlbum = v => v ? localStorage.setItem('vtt-imgbb-emote-album', v) : localStorage.removeItem('vtt-imgbb-emote-album');

  const _uploadImgbb = async (file) => {
    const key = _getImgbbKey();
    if (!key) throw new Error('Clé ImgBB non configurée (bouton 🔑 dans le VTT)');
    const b64 = await new Promise((res, rej) => {
      const rd = new FileReader(); rd.onload = () => res(rd.result.split(',')[1]); rd.onerror = rej;
      rd.readAsDataURL(file);
    });
    const fd = new FormData(); fd.append('key', key); fd.append('image', b64);
    const album = _getEmoteAlbum();
    if (album) fd.append('album', album);
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
            <img src="${em.url}" alt="${_esc(em.name)}">
            <span class="vtt-emote-card-name" title=":${_esc(em.name)}:">:${_esc(em.name)}:</span>
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
      <div style="display:flex;align-items:center;gap:.6rem">
        <label style="font-size:.75rem;color:var(--text-muted);white-space:nowrap">📁 Album ImgBB</label>
        <input type="text" id="emote-album-id" placeholder="ID de l'album (optionnel)" value="${_getEmoteAlbum()}" style="${_inpStyle};flex:1" oninput="(v=>v?localStorage.setItem('vtt-imgbb-emote-album',v):localStorage.removeItem('vtt-imgbb-emote-album'))(this.value.trim())">
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:0">
      <div style="font-weight:600;font-size:.85rem">➕ Ajouter une émote</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">
        <div class="form-group" style="margin:0">
          <label style="font-size:.75rem;color:var(--text-muted)">Nom (ex: <code>rire</code>)</label>
          <input type="text" id="emote-add-name" placeholder="nomemote" style="${_inpStyle}">
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:.75rem;color:var(--text-muted)">Fichier <span style="opacity:.6">(ou URL ci-dessous)</span></label>
          <input type="file" id="emote-add-file" accept="image/*" style="font-size:.78rem;margin-top:.25rem">
        </div>
      </div>
      <div class="form-group" style="margin:0">
        <label style="font-size:.75rem;color:var(--text-muted)">URL directe <span style="opacity:.6">(si déjà hébergé sur ImgBB)</span></label>
        <input type="text" id="emote-add-url" placeholder="https://i.ibb.co/…" style="${_inpStyle}">
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
        <img class="vtt-ec-panel-preview" id="ec-preview-${i}" src="${em.url}" alt="${_esc(em.name)}">
        <div class="vtt-ec-panel-fields">
          <div class="vtt-ec-panel-title">✏ Modifier <span style="font-family:monospace">:${_esc(em.name)}:</span></div>
          <div class="vtt-ec-panel-row">
            <label>Nouveau nom</label>
            <input type="text" id="ec-name-${i}" value="${_esc(em.name)}" autocomplete="off"
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
    const urlEl    = document.getElementById('emote-add-url');
    const statusEl = document.getElementById('emote-add-status');
    const name = nameEl?.value.trim().replace(/\s+/g, '_').toLowerCase();
    const file = fileEl?.files?.[0];
    const directUrl = urlEl?.value.trim();
    if (!name) { if (statusEl) statusEl.textContent = '⚠ Nom requis'; return; }
    if (!file && !directUrl) { if (statusEl) statusEl.textContent = '⚠ Fichier ou URL requis'; return; }
    let url;
    if (file) {
      if (statusEl) statusEl.textContent = '⏳ Upload…';
      try { url = await _uploadImgbb(file); }
      catch(e) { if (statusEl) statusEl.textContent = '⚠ ' + e.message; return; }
    } else {
      url = directUrl;
    }
    await _saveEmotes([..._emotes, { id: Date.now().toString(), name, url }]);
    if (statusEl) statusEl.textContent = `✓ :${name}: ajoutée !`;
    if (nameEl) nameEl.value = '';
    if (fileEl) fileEl.value = '';
    if (urlEl)  urlEl.value  = '';
    _refresh();
  };
};

function _renderChatLog(msgs) {
  const el=document.getElementById('vtt-chat-log'); if (!el) return;
  const myUid=STATE.user?.uid;

  // Portrait 22px : image si dispo, sinon initiale colorée
  const _portrait = (url, name, color='var(--gold)') => url
    ? `<img class="vtt-log-portrait" src="${url}" alt="${_esc(name||'')}" onerror="this.style.visibility='hidden'">`
    : `<div class="vtt-log-portrait" style="background:${color}">${_esc((name||'?')[0].toUpperCase())}</div>`;

  // Timestamp HH:MM depuis le serverTimestamp Firestore
  const _ts = m => {
    const ms = m.createdAt?.toMillis?.();
    if (!ms) return '';
    const d = new Date(ms);
    return `<span class="vtt-log-time">${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}</span>`;
  };

  // Groupe badge + timestamp aligné à droite dans un header flex
  const _right = (badge, ts) => {
    const inner = [badge, ts].filter(Boolean).join('');
    return inner ? `<span style="margin-left:auto;display:flex;align-items:center;gap:.25rem">${inner}</span>` : '';
  };

  el.innerHTML=msgs.map((m, i)=>{
    const isMe=m.authorId===myUid;
    const who=`<span class="vtt-log-who${isMe?' me':''}">${_esc(m.authorName||'?')}</span>`;
    const ts = _ts(m);

    if (m.type==='cast') {
      // Sort CA / utilitaire — pas de jet de dés
      const pmStr = m.pmCost > 0
        ? `<span style="font-size:.65rem;color:#b47fff">−${m.pmCost} PM</span>` : '';
      const castWho = m.casterName || m.authorName || '?';
      return `<div class="vtt-log-entry vtt-log-roll"
          style="border-left:3px solid #b47fff;padding:.3rem .3rem .3rem .5rem;background:rgba(180,127,255,.05);border-radius:0 6px 6px 0">
        <div style="display:flex;align-items:center;gap:.35rem;flex-wrap:wrap">
          ${_portrait(m.characterImage, castWho, '#b47fff')}
          <span style="font-weight:700;font-size:.78rem;color:var(--text)">${_esc(castWho)}</span>
          <span style="font-size:.72rem;color:var(--text-dim)">✨</span>
          <strong style="font-size:.82rem">${_esc(m.optLabel||'')}</strong>
          <span style="color:var(--text-dim);font-size:.65rem">→ ${_esc(m.targetName||'')}</span>
          ${pmStr}
          ${_right('', ts)}
        </div>
        ${m.castEffect && m.castEffect !== '—' ? `<div style="font-size:.68rem;color:var(--text-dim);margin-top:.15rem;padding-left:calc(22px + .35rem)">${_esc(m.castEffect)}</div>` : ''}
      </div>`;
    }
    if (m.type==='attack' && m.isHeal) {
      // Sort de soin
      const sn  = n => n>0?`+${n}`:n<0?`${n}`:'';
      const sub = t => `<span style="font-size:.6rem;color:var(--text-dim)">(${t})</span>`;
      const baseDice = _esc(m.dmgRawDice || m.dmgFormula || '');
      const mods = [
        m.dmgMaitriseBonus > 0 ? `+${m.dmgMaitriseBonus}` + sub('Maîtrise') : '',
        m.dmgBonus ? sn(m.dmgBonus) + sub('bonus') : '',
      ].filter(Boolean).join(' ');
      const healWho = m.attackerName || m.authorName || '?';
      const detailId = `vtt-d-${i}`;
      const detailHtml = `<div style="font-size:.65rem;color:var(--text-dim)">${baseDice}(${m.dmgRaw}) ${mods} = ${m.dmgTotal}</div>`;
      return `<div class="vtt-log-entry vtt-log-roll"
          style="border-left:3px solid #22c38e;padding:.3rem .3rem .3rem .5rem;background:rgba(34,195,142,.05);border-radius:0 6px 6px 0">
        <div style="display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;margin-bottom:.2rem">
          ${_portrait(m.characterImage, healWho, '#22c38e')}
          <span style="font-weight:700;font-size:.78rem;color:var(--text)">${_esc(healWho)}</span>
          <span style="color:var(--text-dim);font-size:.72rem">→</span>
          <strong style="font-size:.82rem">${_esc(m.defenderName||'')}</strong>
          <span style="color:var(--text-dim);font-size:.65rem">· ${_esc(m.optLabel||'')}</span>
          ${_right('', ts)}
        </div>
        <div style="display:flex;align-items:center;gap:.3rem;flex-wrap:wrap;padding-left:calc(22px + .35rem)">
          <span style="font-size:.78rem">💚</span>
          <strong style="font-size:1.05rem;color:#22c38e;letter-spacing:-.01em">${m.dmgTotal}</strong>
          <span style="font-size:.72rem;color:#22c38e">PV soignés</span>
          <button class="vtt-log-detail-btn" onclick="(e=>{const d=document.getElementById('${detailId}');const o=d.style.display!=='none';d.style.display=o?'none':'block';e.currentTarget.classList.toggle('open',!o)})(event)">détail</button>
        </div>
        <div id="${detailId}" style="display:none;padding-left:calc(22px + .35rem);margin-top:.15rem">${detailHtml}</div>
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
        ? `<span style="font-size:.68rem;font-weight:700;color:#f59e0b">💥 CRITIQUE</span>`
        : isFumble
        ? `<span style="font-size:.68rem;font-weight:700;color:#ef4444">💀 FUMBLE</span>`
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

      const detailId = `vtt-d-${i}`;

      // Ligne dégâts résumée + détail formule
      let dmgSummary = '', dmgDetailHtml = '';
      if (m.hit || m.halfDmg) {
        const baseDice = _esc(m.dmgRawDice || m.dmgFormula || '');
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
        const dmgSuffix = m.newHp===0 ? '💀' : m.halfDmg ? '✦ ½' : 'dégâts';
        dmgSummary = `<div style="display:flex;align-items:center;gap:.3rem;flex-wrap:wrap;padding-left:calc(22px + .35rem);margin-top:.15rem">
          <span style="font-size:.78rem">⚔️</span>
          <strong style="font-size:1.05rem;color:${dmgColor};letter-spacing:-.01em">${m.dmgTotal}</strong>
          <span style="font-size:.72rem;color:${dmgColor}">${dmgSuffix}</span>
        </div>`;
        dmgDetailHtml = `<div style="font-size:.65rem;color:var(--text-dim);margin-top:.1rem">⚔️ ${dmgFormula} = <strong style="color:${dmgColor}">${m.dmgTotal}</strong></div>`;
      }

      const atkWho = m.attackerName || m.authorName || '?';
      return `<div class="vtt-log-entry vtt-log-roll"
          style="border-left:3px solid ${borderCol};padding:.3rem .3rem .3rem .5rem;background:rgba(${bgRgb},.05);border-radius:0 6px 6px 0">
        <div style="display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;margin-bottom:.2rem">
          ${_portrait(m.characterImage, atkWho, borderCol)}
          <span style="font-weight:700;font-size:.78rem;color:var(--text)">${_esc(atkWho)}</span>
          <span style="color:var(--text-dim);font-size:.72rem">→</span>
          <strong style="font-size:.82rem">${_esc(m.defenderName||'')}</strong>
          <span style="color:var(--text-dim);font-size:.65rem">· ${_esc(m.optLabel||'')}</span>
          ${_right(resultBadge, ts)}
        </div>
        <div style="display:flex;align-items:center;gap:.3rem;flex-wrap:wrap;padding-left:calc(22px + .35rem)">
          <span style="font-size:.78rem">🎯</span>
          <strong style="font-size:1.05rem;color:${accentCol};letter-spacing:-.01em">${m.hitTotal}</strong>
          <span style="font-size:.88rem;color:${accentCol};font-weight:700">${m.hit?'✓':'✗'}</span>
          <button class="vtt-log-detail-btn" onclick="(e=>{const d=document.getElementById('${detailId}');const o=d.style.display!=='none';d.style.display=o?'none':'block';e.currentTarget.classList.toggle('open',!o)})(event)">détail</button>
        </div>
        ${dmgSummary}
        <div id="${detailId}" style="display:none;padding-left:calc(22px + .35rem);margin-top:.2rem;border-top:1px solid rgba(255,255,255,.06);padding-top:.2rem">
          <div style="font-size:.65rem;color:var(--text-dim)">🎯 ${hitFormula} = <strong style="color:${accentCol}">${m.hitTotal}</strong></div>
          ${dmgDetailHtml}
        </div>
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
        ? `<span style="font-size:.65rem;font-weight:700;color:#ffd700">✨ CRITIQUE</span>`
        : m.isFumble
        ? `<span style="font-size:.65rem;font-weight:700;color:#ef4444">💀 FUMBLE</span>`
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
            <span style="font-weight:700;font-size:.78rem;color:var(--text)">${_esc(rollWho)}</span>
            <span style="font-size:.65rem;color:var(--text-dim)">🎲</span>
            <span style="font-size:.72rem;font-weight:600;color:${statCol}">${_esc(m.rollSkill)}</span>
            <span style="font-size:.6rem;color:var(--text-dim)">${m.rollStat||''}</span>
            ${modeIcon}
            ${_right(badge, ts)}
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
          <em style="font-size:.68rem;color:var(--text-dim)">${_esc(m.rollFormula||'')}</em>
          <span style="font-size:.72rem;color:var(--text-dim)">→</span>
          <strong style="color:${resultCol}">${m.rollResult}</strong>
          ${_right(badge, ts)}
        </div>
      </div>`;
    }
    // Message chat simple
    return `<div class="vtt-log-entry vtt-log-msg" style="display:flex;align-items:baseline;gap:.25rem">
      ${who}<span style="flex:1">${_applyEmotes(_esc(m.text||''))}</span>${ts}
    </div>`;
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
  else if (t.npcId)  await updateDoc(_npcRef(t.npcId),{pmCurrent:v}).catch(()=>{});
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
    // Sauver dans la bibliothèque
    const entry = { id: crypto.randomUUID(), url, name: file.name, folderId: _libFolder || null };
    const updLib = { folders: _mapLib.folders||[], images: [...(_mapLib.images||[]), entry] };
    setDoc(_mapLibRef(), updLib).catch(()=>{});
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
  if ((e.key==='Delete'||e.key==='Backspace') && _tool==='select') {
    if (_selectedAnnotIds.size > 0) {
      [..._selectedAnnotIds].forEach(id => deleteDoc(_annotRef(id)).catch(()=>{}));
      _deselectAnnot();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// BIBLIOTHÈQUE DE CARTES
// ═══════════════════════════════════════════════════════════════════

async function _saveMapLib() {
  await setDoc(_mapLibRef(), { folders: _mapLib.folders, images: _mapLib.images });
}

function _renderLibSection() {
  const el = document.getElementById('vtt-tray-library');
  if (!el) return;

  if (!_libOpen) { el.innerHTML = ''; return; }

  const folders = _mapLib.folders || [];
  const images  = _mapLib.images  || [];
  const curFolder = _libFolder ? folders.find(f => f.id === _libFolder) : null;
  const visible = _libFolder
    ? images.filter(i => i.folderId === _libFolder)
    : images.filter(i => !i.folderId);

  const folderChips = !_libFolder ? folders.map(f => {
    const cnt = images.filter(i => i.folderId === f.id).length;
    return `<div class="vtt-lib-folder-chip" onclick="window._vttLibOpenFolder('${f.id}')">
      <span>📁 ${_esc(f.name)}</span>
      <span class="vtt-lib-chip-cnt">${cnt}</span>
      <button class="vtt-icon-btn" onclick="event.stopPropagation();window._vttLibDelFolder('${f.id}')" title="Supprimer le dossier">✕</button>
    </div>`;
  }).join('') : '';

  const imgGrid = visible.length
    ? `<div class="vtt-lib-grid">${visible.map(img => `
        <div class="vtt-lib-card" title="${_esc(img.name||'')}">
          <img src="${img.url}" loading="lazy" onerror="this.parentNode.classList.add('vtt-lib-card--err')">
          <div class="vtt-lib-card-ov">
            <button onclick="window._vttLibPlace('${img.id}')" title="Placer sur la carte">▶</button>
            ${folders.length && !_libFolder ? `<button onclick="window._vttLibMoveMenu('${img.id}',event)" title="Déplacer dans un dossier">📁</button>` : ''}
            ${_libFolder ? `<button onclick="window._vttLibMoveRoot('${img.id}')" title="Retirer du dossier">↩</button>` : ''}
            <button onclick="window._vttLibDelImg('${img.id}')" title="Supprimer">🗑</button>
          </div>
          <div class="vtt-lib-card-name">${_esc(img.name||'image')}</div>
        </div>`).join('')}</div>`
    : `<div class="vtt-tray-empty">Aucune image${_libFolder ? ' dans ce dossier' : ''}</div>`;

  el.innerHTML = `
    ${_libFolder
      ? `<button class="vtt-lib-back" onclick="window._vttLibOpenFolder(null)">← ${_esc(curFolder?.name||'Racine')}</button>`
      : folderChips}
    ${imgGrid}`;
}

window._vttLibOpenFolder  = (id) => { _libFolder = id; _renderLibSection(); };
window._vttLibToggle      = ()  => { _libOpen = !_libOpen; _renderLibSection();
  document.getElementById('vtt-lib-toggle')?.classList.toggle('open', _libOpen); };

window._vttLibNewFolder   = () => {
  const name = prompt('Nom du dossier :')?.trim();
  if (!name) return;
  _mapLib.folders.push({ id: crypto.randomUUID(), name });
  _saveMapLib();
};

window._vttLibDelFolder   = (id) => {
  // Retirer les images du dossier (les remettre en racine)
  _mapLib.images  = _mapLib.images.map(i => i.folderId === id ? { ...i, folderId: null } : i);
  _mapLib.folders = _mapLib.folders.filter(f => f.id !== id);
  if (_libFolder === id) _libFolder = null;
  _saveMapLib();
};

window._vttLibDelImg      = (id) => {
  _mapLib.images = _mapLib.images.filter(i => i.id !== id);
  _saveMapLib();
};

window._vttLibMoveRoot    = (id) => {
  _mapLib.images = _mapLib.images.map(i => i.id === id ? { ...i, folderId: null } : i);
  _saveMapLib();
};

window._vttLibMoveMenu    = (imgId, evt) => {
  evt.stopPropagation();
  // Mini popup de sélection de dossier
  const existing = document.getElementById('vtt-lib-move-popup');
  if (existing) { existing.remove(); return; }
  const popup = document.createElement('div');
  popup.id = 'vtt-lib-move-popup';
  popup.className = 'vtt-lib-move-popup';
  popup.innerHTML = _mapLib.folders.map(f =>
    `<div class="vtt-lib-move-opt" onclick="window._vttLibMoveTo('${imgId}','${f.id}');document.getElementById('vtt-lib-move-popup')?.remove()">📁 ${_esc(f.name)}</div>`
  ).join('') || '<div style="padding:.4rem;font-size:.75rem;color:var(--text-dim)">Aucun dossier</div>';
  const rect = evt.currentTarget.getBoundingClientRect();
  popup.style.top  = (rect.bottom + 4) + 'px';
  popup.style.left = rect.left + 'px';
  document.body.appendChild(popup);
  const close = (e) => { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('mousedown', close, true); } };
  setTimeout(() => document.addEventListener('mousedown', close, true), 10);
};

window._vttLibMoveTo      = (imgId, folderId) => {
  _mapLib.images = _mapLib.images.map(i => i.id === imgId ? { ...i, folderId } : i);
  _saveMapLib();
};

window._vttLibPlace       = (imgId) => {
  if (!_activePage) { showNotif('Aucune page active', 'error'); return; }
  const img = _mapLib.images.find(i => i.id === imgId);
  if (!img) return;
  const imgs = [...(_activePage.backgroundImages??[]), {
    id: Date.now().toString(), url: img.url, x: 0, y: 0,
    w: _activePage.cols, h: _activePage.rows,
  }];
  updateDoc(_pgRef(_activePage.id), { backgroundImages: imgs })
    .then(() => showNotif('Image placée sur la carte', 'success'))
    .catch(() => showNotif('Erreur lors du placement', 'error'));
};

// ═══════════════════════════════════════════════════════════════════
// BUTIN D'AVENTURE
// ═══════════════════════════════════════════════════════════════════

async function _saveLoot() {
  await setDoc(_lootRef(), { stash: _loot.stash, loot: _loot.loot });
}

function _renderLootPanel() {
  const panel = document.getElementById('vtt-loot-panel');
  if (!panel || panel.dataset.open !== '1') return;
  const mj = STATE.isAdmin;

  const _itemRow = (item, zone) => {
    const rarColor = { commune:'#9ca3af', peu_commune:'#22c38e', rare:'#4f8cff', tres_rare:'#b47fff', legendaire:'#f59e0b' }[item.rarete] || '#9ca3af';
    return `<div class="vtt-loot-row" data-id="${item.id}">
      ${zone === 'stash' && mj ? `<span class="vtt-loot-drag" title="Glisser vers le butin">⠿</span>` : ''}
      <span class="vtt-loot-dot" style="background:${rarColor}"></span>
      <span class="vtt-loot-name">${_esc(item.nom)}</span>
      <span class="vtt-loot-qty">×${item.qty}</span>
      ${zone === 'stash' && mj ? `<button class="vtt-icon-btn" onclick="window._vttLootRemoveStash('${item.id}')" title="Retirer">✕</button>` : ''}
      ${zone === 'loot'  && mj ? `<button class="vtt-icon-btn" onclick="window._vttLootRemoveLoot('${item.id}')" title="Retirer">✕</button>` : ''}
      ${zone === 'loot'  && !mj ? `<button class="vtt-loot-take-btn" onclick="window._vttLootPickQty('${item.id}')">Prendre</button>` : ''}
    </div>`;
  };

  panel.innerHTML = `
    ${mj ? `
    <div class="vtt-loot-section">
      <div class="vtt-loot-sec-hd">
        <span>🔒 Réserve MJ</span>
        <button class="vtt-btn-sm" onclick="window._vttLootOpenShop()">＋ Ajouter</button>
      </div>
      <div class="vtt-loot-list" id="vtt-stash-list">
        ${_loot.stash.length ? _loot.stash.map(i => _itemRow(i, 'stash')).join('') : '<div class="vtt-loot-empty">Vide — ajoutez des objets</div>'}
      </div>
    </div>
    <div class="vtt-loot-divider">↓ Glisser vers le butin ↓</div>
    ` : ''}
    <div class="vtt-loot-section">
      <div class="vtt-loot-sec-hd">
        <span>💰 Butin disponible</span>
        ${mj ? `<button class="vtt-btn-sm vtt-btn-danger" onclick="window._vttLootClear()">🗑</button>` : ''}
      </div>
      <div class="vtt-loot-list" id="vtt-loot-list">
        ${_loot.loot.length ? _loot.loot.map(i => _itemRow(i, 'loot')).join('') : '<div class="vtt-loot-empty">Aucun butin</div>'}
      </div>
    </div>`;

  if (mj) _initLootSortable();
}

function _initLootSortable() {
  const stashEl = document.getElementById('vtt-stash-list');
  const lootEl  = document.getElementById('vtt-loot-list');
  if (!stashEl || !lootEl) return;
  import('../vendor/sortable.esm.js').then(({ default: Sortable }) => {
    Sortable.create(stashEl, {
      group: { name: 'vtt-loot', pull: 'clone', put: false },
      animation: 150,
      handle: '.vtt-loot-drag',
      sort: false,
      ghostClass: 'vtt-loot-ghost',
    });
    Sortable.create(lootEl, {
      group: { name: 'vtt-loot', pull: false, put: true },
      animation: 150,
      ghostClass: 'vtt-loot-ghost',
      onAdd(evt) {
        const id = evt.item.dataset.id;
        evt.item.remove(); // on laisse onSnapshot re-render
        const src = _loot.stash.find(i => i.id === id);
        if (!src) return;
        // Fusionner si même item déjà dans le butin
        const existing = _loot.loot.find(i => i.itemId === src.itemId);
        if (existing) { existing.qty += src.qty; }
        else { _loot.loot.push({ ...src, id: crypto.randomUUID() }); }
        _loot.stash = _loot.stash.filter(i => i.id !== id);
        _saveLoot();
      },
    });
  });
}

function _closeLootPanel() {
  const panel = document.getElementById('vtt-loot-panel');
  const btn   = document.getElementById('vtt-loot-trigger');
  if (panel) { panel.dataset.open = '0'; panel.style.display = 'none'; }
  btn?.classList.remove('active');
  if (_lootCloseOutside) {
    document.removeEventListener('mousedown', _lootCloseOutside, true);
    _lootCloseOutside = null;
  }
}

window._vttToggleLoot = () => {
  const panel = document.getElementById('vtt-loot-panel');
  if (!panel) return;
  const open = panel.dataset.open === '1';
  if (open) { _closeLootPanel(); return; }
  panel.dataset.open = '1';
  panel.style.display = 'flex';
  document.getElementById('vtt-loot-trigger')?.classList.add('active');
  _renderLootPanel();
  _lootCloseOutside = (e) => {
    const float = document.querySelector('.vtt-loot-float');
    if (float && !float.contains(e.target)) _closeLootPanel();
  };
  document.addEventListener('mousedown', _lootCloseOutside, true);
};

window._vttLootRemoveStash = (id) => {
  _loot.stash = _loot.stash.filter(i => i.id !== id);
  _saveLoot();
};

window._vttLootRemoveLoot = (id) => {
  _loot.loot = _loot.loot.filter(i => i.id !== id);
  _saveLoot();
};

window._vttLootClear = () => {
  _loot.loot = [];
  _saveLoot();
};

// MJ : choisir un item de la boutique à ajouter au stash
window._vttLootOpenShop = async () => {
  const [items, cats] = await Promise.all([loadCollection('shop'), loadCollection('shopCategories')]);
  const catMap = Object.fromEntries((cats||[]).map(c => [c.id, c]));
  let filtered = [...items];

  const render = (q = '') => {
    const q2 = q.toLowerCase().trim();
    const list = q2 ? filtered.filter(i => i.nom?.toLowerCase().includes(q2)) : filtered;
    const rows = list.slice(0, 40).map(item => {
      const cat = catMap[item.categorieId];
      const rarColor = { commune:'#9ca3af', peu_commune:'#22c38e', rare:'#4f8cff', tres_rare:'#b47fff', legendaire:'#f59e0b' }[item.rarete] || '#9ca3af';
      return `<div class="vtt-shop-row" onclick="window._vttLootPickFromShop('${item.id}')">
        <span class="vtt-loot-dot" style="background:${rarColor}"></span>
        <span class="vtt-shop-name">${_esc(item.nom||'?')}</span>
        <span class="vtt-shop-cat">${_esc(cat?.nom||'')}</span>
      </div>`;
    }).join('') || '<div style="padding:.5rem;color:var(--text-muted);font-size:.78rem">Aucun résultat</div>';
    const el = document.getElementById('vtt-shop-list');
    if (el) el.innerHTML = rows;
  };

  window._vttLootShopSearch = (q) => render(q);
  window._vttLootPickFromShop = (itemId) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    openModal(`Ajouter "${_esc(item.nom)}" au stash`, `
      <div style="padding:.5rem 0">
        <label style="font-size:.83rem;color:var(--text-muted)">Quantité</label>
        <input id="vtt-loot-qty-input" type="number" min="1" value="1"
          style="width:80px;margin-left:.5rem;padding:.3rem .5rem;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text);font-size:.9rem">
      </div>
      <button class="btn-primary" style="width:100%;margin-top:.5rem"
        onclick="window._vttLootConfirmAdd('${item.id}')">Ajouter au stash</button>`,
    );
  };
  window._vttLootConfirmAdd = (itemId) => {
    const item = items.find(i => i.id === itemId);
    const qty  = Math.max(1, parseInt(document.getElementById('vtt-loot-qty-input')?.value) || 1);
    if (!item) return;
    const prixVente = Math.round((item.prix || 0) * 0.5);
    const entry = {
      id: crypto.randomUUID(), itemId: item.id,
      nom: item.nom || '?', qty,
      rarete: item.rarete || 'commune',
      template: catMap[item.categorieId]?.template || 'classique',
      categorieId: item.categorieId || '',
      prixAchat: item.prix || 0, prixVente,
      format: item.format || '', degats: item.degats || '',
      degatsStat: item.degatsStat || '', toucherStat: item.toucherStat || '',
      ca: item.ca || '', effet: item.effet || '', description: item.description || '',
      slotArmure: item.slotArmure || '', typeArmure: item.typeArmure || '',
      slotBijou: item.slotBijou || '', sousType: item.sousType || '',
      portee: item.portee || '', traits: Array.isArray(item.traits) ? [...item.traits] : [],
      for: parseInt(item.for)||0, dex: parseInt(item.dex)||0, in: parseInt(item.in)||0,
      sa: parseInt(item.sa)||0, co: parseInt(item.co)||0, ch: parseInt(item.ch)||0,
    };
    // Fusionner si même item déjà dans le stash
    const existing = _loot.stash.find(s => s.itemId === item.id);
    if (existing) { existing.qty += qty; } else { _loot.stash.push(entry); }
    _saveLoot();
    closeModalDirect();
    showNotif(`×${qty} "${item.nom}" ajouté au stash`, 'success');
  };

  openModal('🎒 Ajouter au stash MJ', `
    <div style="margin-bottom:.5rem">
      <input type="text" placeholder="🔍 Rechercher…" oninput="window._vttLootShopSearch(this.value)"
        style="width:100%;padding:.4rem .7rem;border-radius:8px;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text);font-size:.85rem;box-sizing:border-box">
    </div>
    <div id="vtt-shop-list" style="max-height:340px;overflow-y:auto;display:flex;flex-direction:column;gap:2px"></div>`,
  );
  setTimeout(() => render(), 50);
};

// Joueur : choisir la quantité qu'il prend
window._vttLootPickQty = (id) => {
  const item = _loot.loot.find(i => i.id === id);
  if (!item) return;
  const uid  = STATE.user?.uid;
  const myChars = Object.values(_characters).filter(c => c.uid === uid);
  if (!myChars.length) { showNotif('Aucun personnage trouvé', 'error'); return; }

  const charOptions = myChars.map(c =>
    `<option value="${c.id}">${_esc(c.nom || c.pseudo || '?')}</option>`).join('');

  openModal(`Prendre — ${_esc(item.nom)}`, `
    <div style="display:flex;flex-direction:column;gap:.7rem;padding:.3rem 0">
      ${myChars.length > 1 ? `
        <div>
          <label style="font-size:.83rem;color:var(--text-muted);display:block;margin-bottom:.3rem">Personnage</label>
          <select id="vtt-take-char" style="width:100%;padding:.35rem .6rem;border-radius:8px;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text);font-size:.85rem">
            ${charOptions}
          </select>
        </div>` : `<input type="hidden" id="vtt-take-char" value="${myChars[0].id}">`}
      <div>
        <label style="font-size:.83rem;color:var(--text-muted);display:block;margin-bottom:.3rem">Quantité (max ${item.qty})</label>
        <input id="vtt-take-qty" type="number" min="1" max="${item.qty}" value="1"
          style="width:80px;padding:.35rem .6rem;border-radius:8px;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text);font-size:.9rem">
      </div>
      <button class="btn-primary" onclick="window._vttLootConfirmTake('${id}')">Prendre</button>
    </div>`);
};

window._vttLootConfirmTake = async (id) => {
  const item    = _loot.loot.find(i => i.id === id);
  if (!item) return;
  const charId  = document.getElementById('vtt-take-char')?.value;
  const qty     = Math.min(item.qty, Math.max(1, parseInt(document.getElementById('vtt-take-qty')?.value) || 1));
  const char    = _characters[charId];
  if (!char || !charId) { showNotif('Personnage introuvable', 'error'); return; }

  const inv = Array.isArray(char.inventaire) ? [...char.inventaire] : [];
  for (let k = 0; k < qty; k++) {
    inv.push({
      nom: item.nom, source: 'butin', itemId: item.itemId || '',
      categorieId: item.categorieId || '', template: item.template || 'classique',
      qte: '1', prixAchat: item.prixAchat || 0, prixVente: item.prixVente || 0,
      format: item.format || '', rarete: item.rarete || '',
      degats: item.degats || '', degatsStat: item.degatsStat || '',
      degatsStats: item.degatsStats || [], toucherStat: item.toucherStat || '',
      ca: item.ca || '', effet: item.effet || '', description: item.description || '',
      slotArmure: item.slotArmure || '', typeArmure: item.typeArmure || '',
      slotBijou: item.slotBijou || '', sousType: item.sousType || '',
      portee: item.portee || '', traits: Array.isArray(item.traits) ? [...item.traits] : [],
      for: item.for||0, dex: item.dex||0, in: item.in||0,
      sa: item.sa||0, co: item.co||0, ch: item.ch||0,
    });
  }

  // Réduire ou retirer du butin
  if (item.qty - qty <= 0) {
    _loot.loot = _loot.loot.filter(i => i.id !== id);
  } else {
    item.qty -= qty;
  }

  try {
    await Promise.all([
      updateDoc(_chrRef(charId), { inventaire: inv }),
      _saveLoot(),
    ]);
    char.inventaire = inv;
    closeModalDirect();
    showNotif(`×${qty} "${item.nom}" envoyé dans l'inventaire de ${_esc(char.nom || char.pseudo || '?')} !`, 'success');
  } catch { showNotif('Erreur lors de la prise du butin', 'error'); }
};

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
        <button class="vtt-btn-sm" id="vtt-map-mode-btn" onclick="window._vttToggleMapMode()" title="Activer l'édition des images">🗺 Carte</button>
        <label  class="vtt-btn-sm vtt-upload-lbl" title="Upload une image via ImgBB — sauvegardée dans la bibliothèque">⬆ Upload<input type="file" id="vtt-img-input" accept="image/*" hidden></label>
        <button class="vtt-btn-sm" onclick="window._vttSetImgbbKey()" title="Configurer la clé API ImgBB">🔑</button>
        <div class="vtt-tb-sep"></div>
        <button class="vtt-btn-sm" onclick="window._vttToggleCombat()" title="Démarrer/arrêter le combat">⚔ Combat</button>
        <button class="vtt-btn-sm" onclick="window._vttNextRound()"    title="Tour suivant">▶ Tour</button>`:''}
    </div>
  </div>
  <div class="vtt-body">
    <div class="vtt-presence-col" id="vtt-presence-col">
      <div class="vtt-pres-hd" title="Joueurs en ligne">👥</div>
      <div id="vtt-pres-list" class="vtt-pres-list"></div>
    </div>
    <div class="vtt-mini-panel" id="vtt-mini-panel"></div>
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
        <div id="vtt-tray-tokens"></div>
      </div>
      <div class="vtt-tray-section vtt-tray-section--lib">
        <div class="vtt-tray-section-hd vtt-tray-collapsible" onclick="window._vttLibToggle()">
          <span>📁 Bibliothèque</span>
          <div style="display:flex;gap:3px;align-items:center">
            <button class="vtt-tray-add-btn" onclick="event.stopPropagation();window._vttLibNewFolder()" title="Nouveau dossier">📁</button>
            <span id="vtt-lib-toggle" class="vtt-tray-count open">▲</span>
          </div>
        </div>
        <div id="vtt-tray-library"></div>
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
  // Floats injectés APRÈS Konva pour être au-dessus des canvas layers
  const _tf = document.createElement('div');
  _tf.className = 'vtt-tool-float';
  _tf.innerHTML = `
    <div class="vtt-tool-float-tools">
      <button class="vtt-tool active" data-tool="select" onclick="window._vttTool('select')" title="↖ Sélection">↖</button>
      <button class="vtt-tool" data-tool="ruler"  onclick="window._vttTool('ruler')"  title="📏 Règle">📏</button>
      <button class="vtt-tool" data-tool="draw"   onclick="window._vttTool('draw')"   title="✏️ Dessin">✏️</button>
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
      ${STATE.isAdmin?`<div class="vtt-draw-sep"></div><button class="vtt-btn-sm vtt-btn-danger" onclick="window._vttClearAnnots()" title="Effacer toutes les annotations">🗑</button>`:''}
    </div>`;
  wrap.appendChild(_tf);
  const _ef = document.createElement('div');
  _ef.className = 'vtt-emote-float';
  _ef.innerHTML = `<div class="vtt-emote-picker" id="vtt-emote-picker"></div>
    <button class="vtt-emote-trigger" onclick="window._vttToggleEmotePicker()" title="Émotes">😄</button>`;
  wrap.appendChild(_ef);
  // Float Butin (bas-gauche du canvas)
  const _lf = document.createElement('div');
  _lf.className = 'vtt-loot-float';
  _lf.innerHTML = `
    <div class="vtt-loot-panel" id="vtt-loot-panel" data-open="0" style="display:none"></div>
    <button class="vtt-loot-trigger" id="vtt-loot-trigger" onclick="window._vttToggleLoot()" title="Butin d'aventure">💰</button>`;
  wrap.appendChild(_lf);
  document.addEventListener('keydown',_keyHandler);
  document.getElementById('vtt-img-input')?.addEventListener('change',e=>{
    const f=e.target.files?.[0]; if (f) _handleUpload(f); e.target.value='';
  });
  _loadEmotes();      // non bloquant
  _loadDiceSkills();  // non bloquant
  _initListeners();
  // Présence : heartbeat toutes les 45 s
  const _presUid = STATE.user?.uid;
  if (_presUid) {
    const _presWrite = () => {
      const pseudo = STATE.profile?.pseudo || STATE.user?.email?.split('@')[0] || '?';
      setDoc(_pingRef(_presUid), { pres: { pseudo, lastSeen: serverTimestamp() } }, { merge: true }).catch(() => {});
    };
    _presWrite();
    _presHeartbeat = setInterval(_presWrite, 45_000);
    // Fermeture navigateur : tentative de suppression (best-effort)
    const _onUnload = () => { deleteDoc(_pingRef(_presUid)).catch(()=>{}); };
    window.addEventListener('beforeunload', _onUnload, { once: true });
  }
  // Filet de sécurité : re-rendre la présence toutes les 30s pour expirer les entrants inactifs
  _presRefresh = setInterval(_renderPresenceCol, 30_000);
}

// ═══════════════════════════════════════════════════════════════════
// PRÉSENCE — joueurs actifs sur le VTT
// ═══════════════════════════════════════════════════════════════════

function _renderPresenceCol() {
  const list = document.getElementById('vtt-pres-list');
  if (!list) return;
  const now = Date.now();
  const players = Object.values(_presence).filter(p => now - (p.lastSeen ?? 0) < 120_000);
  if (!players.length) {
    list.innerHTML = '<div class="vtt-pres-empty">—</div>';
    return;
  }
  const myUid = STATE.user?.uid;
  list.innerHTML = players.map(p => {
    const chars = Object.values(_characters).filter(c => c.uid === p.uid);
    const char  = chars.find(c => c.id === _miniCharId) || chars[0];
    const img   = char?.photoURL || char?.photo || char?.avatar || null;
    const init  = (char?.nom || p.pseudo || '?')[0].toUpperCase();
    const isOpen = _miniUid === p.uid;
    const isSelf = p.uid === myUid;
    return `<div class="vtt-pres-entry${isOpen?' is-open':''}${isSelf?' is-self':''}"
      onclick="window._vttToggleMiniSheet('${p.uid}')"
      title="${p.pseudo}${char?.nom ? ' · '+char.nom : ''}">
      <div class="vtt-pres-avatar"${img?` style="background-image:url('${img}')"`:''}>
        ${img ? '' : `<span>${init}</span>`}
        ${isSelf ? '<div class="vtt-pres-self-dot"></div>' : ''}
      </div>
      <div class="vtt-pres-name">${p.pseudo}</div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════
// MINI-FICHE PERSONNAGE — 4 onglets
// ═══════════════════════════════════════════════════════════════════

const _MS_SLOTS = [
  'Main principale','Hors-main','Tête','Torse','Bottes',
  'Amulette','Anneau gauche','Anneau droit','Cou','Dos',
];

// ─── Helpers locaux ───────────────────────────────────────────────

function _msCatItem(item) {
  const t = item?.template || '';
  if (t === 'arme'   || item?.degats)                     return 'arme';
  if (t === 'armure' || item?.slotArmure || item?.typeArmure) return 'armure';
  if (t === 'bijou'  || item?.slotBijou)                  return 'bijou';
  if (t === 'consommable')                                return 'consommable';
  return 'divers';
}

function _msBuildEquipItem(slot, item, invIndex) {
  if (!item) return null;
  const isWeapon = slot.startsWith('Main');
  const base = {
    nom: item.nom||'',
    fo: parseInt(item.fo)||0, dex: parseInt(item.dex)||0,
    in: parseInt(item.in)||0, sa:  parseInt(item.sa)||0,
    co: parseInt(item.co)||0, ch:  parseInt(item.ch)||0,
    sourceInvIndex: invIndex, itemId: item.itemId||'',
  };
  if (isWeapon) {
    const statAtk = item.toucherStat || item.statAttaque
      || (String(item.format||'').includes('Mag.') ? 'intelligence'
          : String(item.format||'').includes('Dist.') ? 'dexterite' : 'force');
    return { ...base,
      degats: item.degats||'', degatsStat: item.degatsStat||statAtk,
      toucherStat: statAtk, typeArme: item.typeArme||'',
      portee: item.portee||'', particularite: item.particularite||item.effet||'',
      format: item.format||'' };
  }
  return { ...base,
    ca: parseInt(item.ca)||0, typeArmure: item.typeArmure||'',
    slotArmure: item.slotArmure||'', slotBijou: item.slotBijou||'' };
}

function _msCanEdit(uid) { return STATE.isAdmin || STATE.user?.uid === uid; }

// Reproduit la logique de compatibilité de characters/equipment.js
function _msItemFitsSlot(item, slot, equip, idx) {
  if (!item?.nom) return false;
  // Déjà équipé dans un autre slot → exclu
  if (Object.entries(equip).some(([s, e]) => s !== slot && e?.sourceInvIndex === idx)) return false;

  const tpl = item.template || '';

  // ── Armes ────────────────────────────────────────────────────────
  if (slot.startsWith('Main')) {
    if (tpl === 'arme') return true;
    const WFMT = new Set([
      'Arme 1M CaC Phy.','Arme 2M CaC Phy.','Arme 2M Dist Phy.',
      'Arme 2M CaC Mag.','Arme 2M Dist Mag.','Arme Secondaire (Bouclier, Torche...)',
    ]);
    if (item.format && WFMT.has(item.format)) return true;
    const combined = [item.type, item.sousType, item.nom, item.categorie]
      .map(v => (v||'').toLowerCase()).join(' ');
    return ['arme','weapon','épée','lance','hache','arc','arbalète','dague',
      'baguette','baton','bouclier','shield','torche','masse','marteau',
      'fléau','rapière','cimeterre','sabre'].some(k => combined.includes(k));
  }

  // ── Armures (Tête / Torse / Bottes) ─────────────────────────────
  // Note : slotArmure stocké = 'Tête', 'Torse', 'Pieds' (pas 'Bottes')
  const ARMOR_MAP = { 'Tête':'Tête', 'Torse':'Torse', 'Bottes':'Pieds' };
  if (ARMOR_MAP[slot] !== undefined) {
    if (tpl === 'armure' || item.slotArmure) {
      return item.slotArmure === ARMOR_MAP[slot] || item.slotArmure === slot;
    }
    const t = (item.type||'').toLowerCase();
    return ['armure','armor','casque','torse','cuirasse','botte','chapeau'].some(k => t.includes(k));
  }

  // ── Bijoux / accessoires ─────────────────────────────────────────
  if (['Amulette','Anneau gauche','Anneau droit','Cou','Dos'].includes(slot)) {
    if (!item.slotBijou) return tpl === 'bijou';
    if (item.slotBijou === slot) return true;
    // 'Anneau' générique → compatible avec les deux emplacements bague
    if (item.slotBijou === 'Anneau' && (slot === 'Anneau gauche' || slot === 'Anneau droit')) return true;
    return false;
  }

  return false;
}

// ─── Handlers exposés ────────────────────────────────────────────

window._vttMsTab = (tab) => { _miniTab = tab; if (_miniUid) _renderMiniSheet(_miniUid); };

window._vttMsEquip = async (charId, uid, slot, invIndex) => {
  if (!_msCanEdit(uid)) return;
  const c = _characters[charId]; if (!c) return;
  invIndex = parseInt(invIndex);
  const item = (c.inventaire||[])[invIndex]; if (!item) return;
  const equip = { ...(c.equipement||{}) };
  // Libère l'item s'il était déjà équipé ailleurs
  Object.keys(equip).forEach(s => { if (s !== slot && equip[s]?.sourceInvIndex === invIndex) delete equip[s]; });
  const built = _msBuildEquipItem(slot, item, invIndex); if (!built) return;
  equip[slot] = built;
  const bonus = computeEquipStatsBonus(equip);
  try {
    await updateDoc(_chrRef(charId), { equipement: equip, statsBonus: bonus });
    showNotif(`${item.nom} → ${slot}`, 'success');
  } catch(e) { showNotif('Erreur sauvegarde', 'error'); }
};

window._vttMsUnequip = async (charId, uid, slot) => {
  if (!_msCanEdit(uid)) return;
  const c = _characters[charId]; if (!c) return;
  const equip = { ...(c.equipement||{}) };
  const nom = equip[slot]?.nom || slot;
  delete equip[slot];
  const bonus = computeEquipStatsBonus(equip);
  try {
    await updateDoc(_chrRef(charId), { equipement: equip, statsBonus: bonus });
    showNotif(`${nom} retiré`, 'success');
  } catch(e) { showNotif('Erreur sauvegarde', 'error'); }
};

// Appelé par le <select> de l'onglet Équipement
window._vttMsSlotChange = (sel, charId, uid, slotIdx) => {
  const slot = _MS_SLOTS[parseInt(slotIdx)]; if (!slot) return;
  const val = sel.value;
  if (val === '') window._vttMsUnequip(charId, uid, slot);
  else            window._vttMsEquip(charId, uid, slot, parseInt(val));
};

// Ouvre une modale pour choisir le slot cible depuis l'inventaire
window._vttMsEquipPicker = (charId, uid, invIndex) => {
  if (!_msCanEdit(uid)) return;
  const c = _characters[charId]; if (!c) return;
  invIndex = parseInt(invIndex);
  const item = (c.inventaire||[])[invIndex]; if (!item) return;
  const equip = c.equipement||{};
  // Seuls les slots compatibles avec cet item (sans check "usedElsewhere" pour qu'on puisse déplacer)
  const slots = _MS_SLOTS.filter(s => _msItemFitsSlot(item, s, {}, invIndex));
  if (!slots.length) { showNotif('Aucun slot compatible pour cet objet', 'info'); return; }
  if (slots.length === 1) { window._vttMsEquip(charId, uid, slots[0], invIndex); return; }
  openModal(`⚔️ Équiper "${item.nom}"`, `
    <div style="display:flex;flex-direction:column;gap:.4rem">
      ${slots.map(s => `<button class="btn btn-outline"
        onclick="closeModal();window._vttMsEquip('${charId}','${uid}',${JSON.stringify(s)},${invIndex})">${s}</button>`).join('')}
      <button class="btn btn-outline btn-sm" style="margin-top:.3rem" onclick="closeModal()">Annuler</button>
    </div>`);
};

// Déséquipe un item depuis l'inventaire (tous les slots où il est équipé)
window._vttMsUnequipAll = async (charId, uid, invIndex) => {
  if (!_msCanEdit(uid)) return;
  invIndex = parseInt(invIndex);
  const c = _characters[charId]; if (!c) return;
  const equip = { ...(c.equipement||{}) };
  Object.keys(equip).forEach(s => { if (equip[s]?.sourceInvIndex === invIndex) delete equip[s]; });
  const bonus = computeEquipStatsBonus(equip);
  try {
    await updateDoc(_chrRef(charId), { equipement: equip, statsBonus: bonus });
    showNotif('Déséquipé', 'success');
  } catch(e) { showNotif('Erreur sauvegarde', 'error'); }
};

// Active / désactive un sort
window._vttToggleMsSort = async (charId, uid, idx) => {
  if (!_msCanEdit(uid)) return;
  const c = _characters[charId]; if (!c) return;
  const sorts = [...(c.deck_sorts||[])];
  if (!sorts[idx]) return;
  sorts[idx] = { ...sorts[idx], actif: !sorts[idx].actif };
  try { await updateDoc(_chrRef(charId), { deck_sorts: sorts }); }
  catch(e) { showNotif('Erreur sauvegarde', 'error'); }
};

// Modale pour choisir le destinataire d'un objet
window._vttMsSendPicker = (charId, uid, invIndex) => {
  if (!_msCanEdit(uid)) return;
  invIndex = parseInt(invIndex);
  const c = _characters[charId]; if (!c) return;
  const item = (c.inventaire||[])[invIndex]; if (!item) return;
  const targets = Object.entries(_presence)
    .filter(([pUid]) => pUid !== uid)
    .flatMap(([pUid, p]) =>
      Object.values(_characters)
        .filter(ch => ch.uid === pUid)
        .map(ch => ({ pUid, charId: ch.id, charNom: ch.nom||p.pseudo, pseudo: p.pseudo }))
    );
  if (!targets.length) { showNotif('Aucun joueur présent à qui envoyer l\'objet', 'info'); return; }
  openModal(`📦 Envoyer "${item.nom||'objet'}"`, `
    <div style="display:flex;flex-direction:column;gap:.5rem">
      <p style="margin:0;font-size:.85rem;color:var(--text-dim)">Destinataire :</p>
      ${targets.map(t => `<button class="btn btn-outline" style="text-align:left"
        onclick="closeModal();window._vttMsConfirmSend('${charId}','${uid}',${invIndex},'${t.charId}')">
        ${t.pseudo} → ${t.charNom}</button>`).join('')}
      <button class="btn btn-outline btn-sm" style="margin-top:.3rem" onclick="closeModal()">Annuler</button>
    </div>`);
};

// Effectue le transfert d'objet entre deux personnages
window._vttMsConfirmSend = async (senderCharId, senderUid, invIndex, recipCharId) => {
  invIndex = parseInt(invIndex);
  const sender = _characters[senderCharId]; if (!sender) return;
  const recip  = _characters[recipCharId];  if (!recip)  return;
  const senderInv = [...(sender.inventaire||[])];
  const item = senderInv[invIndex]; if (!item) return;
  senderInv.splice(invIndex, 1);
  // Ajuste les sourceInvIndex dans l'équipement du sender
  const senderEquip = { ...(sender.equipement||{}) };
  Object.keys(senderEquip).forEach(s => {
    const e = senderEquip[s]; if (!e) return;
    if (e.sourceInvIndex === invIndex)    delete senderEquip[s];
    else if (e.sourceInvIndex > invIndex) senderEquip[s] = { ...e, sourceInvIndex: e.sourceInvIndex - 1 };
  });
  const senderBonus = computeEquipStatsBonus(senderEquip);
  const recipInv = [...(recip.inventaire||[]), { ...item }];
  try {
    await updateDoc(_chrRef(senderCharId), { inventaire: senderInv, equipement: senderEquip, statsBonus: senderBonus });
    await updateDoc(_chrRef(recipCharId),  { inventaire: recipInv });
    showNotif(`${item.nom||'Objet'} envoyé à ${recip.nom||'joueur'}`, 'success');
  } catch(e) { console.error('[vtt] send item', e); showNotif('Erreur envoi', 'error'); }
};

// ─── Rendus par onglet ────────────────────────────────────────────

function _msTabCombat(c) {
  const pvMax = calcPVMax(c), pmMax = calcPMMax(c);
  const pvCur = c?.hp ?? pvMax, pmCur = c?.pm ?? pmMax;
  const pvPct = pvMax > 0 ? Math.round(Math.max(0, pvCur) / pvMax * 100) : 0;
  const pmPct = pmMax > 0 ? Math.round(Math.max(0, pmCur) / pmMax * 100) : 0;
  const pvCol = pvPct > 50 ? '#22c38e' : pvPct > 25 ? '#f59e0b' : '#ef4444';

  const statsHtml = _MS_STATS.map(s => {
    const base  = (c?.stats||{})[s.key]      || 8;
    const bonus = (c?.statsBonus||{})[s.key] || 0;
    const total = Math.min(22, base + bonus);
    const mod   = getMod(c, s.key);
    const col   = _STAT_COLOR[s.abbr];
    return `<div class="vtt-ms-stat">
      <span class="vtt-ms-stat-abbr" style="color:${col}">${s.abbr}</span>
      <span class="vtt-ms-stat-val">${total}</span>
      <span class="vtt-ms-stat-mod" style="color:${col}">${mod>=0?'+'+mod:mod}</span>
    </div>`;
  }).join('');

  const weapon = c?.equipement?.['Main principale'];
  const weaponHtml = weapon?.nom ? (() => {
    const wDmgStat = weapon.degatsStat || weapon.degatStat || 'force';
    const wTchStat = weapon.toucherStat || weapon.statAttaque || 'force';
    const setBonus = getArmorSetData(c).modifiers.toucherBonus || 0;
    const maitrise = getMaitriseBonus(c, weapon);
    const dmgMod   = getMod(c, wDmgStat);
    const tchTotal = getMod(c, wTchStat) + maitrise + setBonus;
    return `<div class="vtt-ms-weapon">
      <div class="vtt-ms-weapon-nom">⚔️ ${weapon.nom}</div>
      <div class="vtt-ms-weapon-stats">
        <span>🎲 ${weapon.degats||'—'}${dmgMod!==0?' '+(dmgMod>=0?'+'+dmgMod:dmgMod):''}</span>
        <span>🎯 ${tchTotal>=0?'+'+tchTotal:tchTotal}</span>
      </div>
    </div>`;
  })() : '';

  const setData = getArmorSetData(c);
  const setHtml = setData?.active ? `<div class="vtt-ms-setbonus">✨ Set ${setData.type}</div>` : '';

  return `
    <div class="vtt-ms-bars">
      <div class="vtt-ms-bar-row">
        <span class="vtt-ms-bar-lbl">❤ PV</span>
        <div class="vtt-ms-bar-track"><div class="vtt-ms-bar-fill" style="width:${pvPct}%;background:${pvCol}"></div></div>
        <span class="vtt-ms-bar-num">${pvCur}/${pvMax}</span>
      </div>
      <div class="vtt-ms-bar-row">
        <span class="vtt-ms-bar-lbl">💧 PM</span>
        <div class="vtt-ms-bar-track"><div class="vtt-ms-bar-fill" style="width:${pmPct}%;background:#4f8cff"></div></div>
        <span class="vtt-ms-bar-num">${pmCur}/${pmMax}</span>
      </div>
    </div>
    <div class="vtt-ms-grid">${statsHtml}</div>
    <div class="vtt-ms-defenses">
      <div class="vtt-ms-def-item"><span>🛡 CA</span><strong>${calcCA(c)}</strong></div>
      <div class="vtt-ms-def-item"><span>⚡ Vit.</span><strong>${calcVitesse(c)}</strong></div>
      <div class="vtt-ms-def-item"><span>🎯 Maît.</span><strong>+${getMaitriseBonus(c)}</strong></div>
    </div>
    ${weaponHtml}${setHtml}`;
}

function _msTabEquipement(c, uid, canEdit) {
  const equip = c?.equipement||{}, inv = c?.inventaire||[];
  return `<div class="vtt-ms-slots">${_MS_SLOTS.map((slot, slotIdx) => {
    const equipped    = equip[slot];
    const equippedIdx = equipped?.sourceInvIndex ?? -1;
    const opts = inv.map((item, i) => {
      if (!_msItemFitsSlot(item, slot, equip, i)) return '';
      return `<option value="${i}"${equippedIdx===i?' selected':''}>${item.nom}${(item.qte||1)>1?' ×'+item.qte:''}</option>`;
    }).join('');
    return `<div class="vtt-ms-slot-row">
      <span class="vtt-ms-slot-lbl">${slot}</span>
      <div class="vtt-ms-slot-ctrl">${canEdit
        ? `<select class="vtt-ms-slot-sel" onchange="window._vttMsSlotChange(this,'${c.id}','${uid}',${slotIdx})">
             <option value="">— vide —</option>${opts}</select>`
        : `<span class="vtt-ms-slot-val">${equipped?.nom||'—'}</span>`}
      </div>
    </div>`;
  }).join('')}</div>`;
}

function _msTabSorts(c, uid, canEdit) {
  const sorts = c?.deck_sorts||[];
  if (!sorts.length) return '<div class="vtt-ms-empty">Aucun sort</div>';
  return `<div class="vtt-ms-sorts">${sorts.map((s, i) => {
    const types = Array.isArray(s.types) ? s.types.join(' · ') : (s.types||'');
    return `<div class="vtt-ms-sort${s.actif?' is-actif':''}">
      ${canEdit
        ? `<button class="vtt-ms-sort-toggle" onclick="window._vttToggleMsSort('${c.id}','${uid}',${i})" title="${s.actif?'Désactiver':'Activer'}">${s.actif?'✅':'⬜'}</button>`
        : `<span class="vtt-ms-sort-dot${s.actif?' on':''}">${s.actif?'●':'○'}</span>`}
      <div class="vtt-ms-sort-info">
        <span class="vtt-ms-sort-nom">${s.nom||'Sort'}</span>
        <div class="vtt-ms-sort-meta">
          ${s.pm?`<span class="vtt-ms-sort-pm">${s.pm} PM</span>`:''}
          ${types?`<span class="vtt-ms-sort-types">${types}</span>`:''}
        </div>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function _msTabInventaire(c, uid, canEdit) {
  const inv = c?.inventaire||[];
  if (!inv.length) return '<div class="vtt-ms-empty">Inventaire vide</div>';
  const groups = { arme:[], armure:[], bijou:[], consommable:[], divers:[] };
  inv.forEach((item, i) => { if (item?.nom) groups[_msCatItem(item)].push({ item, i }); });
  const CAT_LABEL = { arme:'⚔️ Armes', armure:'🛡 Armures', bijou:'💍 Bijoux', consommable:'🧪 Consommables', divers:'📦 Divers' };
  const equip = c?.equipement||{};
  let html = '<div class="vtt-ms-inv">';
  for (const [cat, entries] of Object.entries(groups)) {
    if (!entries.length) continue;
    html += `<div class="vtt-ms-inv-cat">${CAT_LABEL[cat]} <span class="vtt-ms-inv-cnt">(${entries.length})</span></div>`;
    for (const { item, i } of entries) {
      const isEq = Object.values(equip).some(e => e?.sourceInvIndex === i);
      html += `<div class="vtt-ms-inv-item${isEq?' is-equipped':''}">
        <div class="vtt-ms-inv-main">
          <span class="vtt-ms-inv-nom">${item.nom}</span>
          ${(item.qte||1)>1?`<span class="vtt-ms-inv-qte">×${item.qte}</span>`:''}
          ${isEq?'<span class="vtt-ms-inv-badge">équipé</span>':''}
        </div>
        ${item.degats?`<div class="vtt-ms-inv-detail">${item.degats}${item.typeArme?' · '+item.typeArme:''}</div>`:''}
        ${item.typeArmure&&!item.degats?`<div class="vtt-ms-inv-detail">${item.typeArmure}</div>`:''}
        ${canEdit?`<div class="vtt-ms-inv-actions">
          ${(cat==='arme'||cat==='armure'||cat==='bijou')&&!isEq
            ?`<button class="vtt-ms-inv-btn" onclick="window._vttMsEquipPicker('${c.id}','${uid}',${i})" title="Équiper">⚔️</button>`
            :isEq?`<button class="vtt-ms-inv-btn" onclick="window._vttMsUnequipAll('${c.id}','${uid}',${i})" title="Déséquiper">🔓</button>`:''}
          <button class="vtt-ms-inv-btn" onclick="window._vttMsSendPicker('${c.id}','${uid}',${i})" title="Envoyer">📤</button>
        </div>`:''}
      </div>`;
    }
  }
  html += '</div>';
  return html;
}

// ─── Rendu principal ─────────────────────────────────────────────

function _renderMiniSheet(uid) {
  const panel = document.getElementById('vtt-mini-panel');
  if (!panel) return;

  const pres = _presence[uid];
  if (!uid || !pres) { panel.classList.remove('open'); panel.innerHTML = ''; return; }

  const chars = Object.values(_characters).filter(c => c.uid === uid);
  if (!chars.length) {
    panel.classList.add('open');
    panel.innerHTML = `<div class="vtt-ms-empty">Aucun personnage lié pour ${pres.pseudo}.</div>`;
    return;
  }

  const validId = chars.find(c => c.id === _miniCharId) ? _miniCharId : chars[0].id;
  _miniCharId = validId;
  const c = chars.find(c => c.id === validId);
  const canEdit = _msCanEdit(uid);

  const img      = c?.photoURL || c?.photo || c?.avatar || null;
  const init     = (c?.nom || '?')[0].toUpperCase();
  const subtitle = [c?.race, c?.titreActuel||c?.titre, c?.niveau ? 'Niv.'+c.niveau : ''].filter(Boolean).join(' · ');

  const selectorHtml = chars.length > 1
    ? `<div class="vtt-ms-selector">${chars.map(ch =>
        `<button class="vtt-ms-sel-btn${ch.id===validId?' active':''}"
          onclick="window._vttSelectMiniChar('${uid}','${ch.id}')">${ch.nom||'Perso'}</button>`
      ).join('')}</div>`
    : '';

  const TABS = [
    { key:'combat', icon:'⚔️', label:'Combat'  },
    { key:'equip',  icon:'🛡',  label:'Équip.'  },
    { key:'sorts',  icon:'✨',  label:'Sorts'   },
    { key:'inv',    icon:'🎒',  label:'Invent.' },
  ];
  const tabBarHtml = `<div class="vtt-ms-tabbar">${TABS.map(t =>
    `<button class="vtt-ms-tab${_miniTab===t.key?' active':''}" onclick="window._vttMsTab('${t.key}')">${t.icon} ${t.label}</button>`
  ).join('')}</div>`;

  const tabHtml =
      _miniTab === 'combat' ? _msTabCombat(c)
    : _miniTab === 'equip'  ? _msTabEquipement(c, uid, canEdit)
    : _miniTab === 'sorts'  ? _msTabSorts(c, uid, canEdit)
    :                         _msTabInventaire(c, uid, canEdit);

  panel.classList.add('open');
  panel.innerHTML = `
    <div class="vtt-ms-header">
      ${img
        ? `<img class="vtt-ms-avatar" src="${img}" alt="">`
        : `<div class="vtt-ms-avatar-init">${init}</div>`}
      <div class="vtt-ms-info">
        <div class="vtt-ms-name">${c?.nom||'Personnage'}</div>
        ${subtitle ? `<div class="vtt-ms-sub">${subtitle}</div>` : ''}
        <div class="vtt-ms-player">👤 ${pres.pseudo}</div>
      </div>
      <button class="vtt-ms-close" onclick="window._vttToggleMiniSheet('${uid}')" title="Fermer">✕</button>
    </div>
    ${selectorHtml}
    ${tabBarHtml}
    <div class="vtt-ms-tab-content">${tabHtml}</div>`;
}

window._vttToggleMiniSheet = (uid) => {
  if (_miniUid === uid) {
    _miniUid = null; _miniCharId = null;
    const panel = document.getElementById('vtt-mini-panel');
    if (panel) { panel.classList.remove('open'); panel.innerHTML = ''; }
  } else {
    _miniUid = uid; _miniCharId = null;
    _renderMiniSheet(uid);
  }
  _renderPresenceCol();
};

window._vttSelectMiniChar = (uid, charId) => {
  _miniCharId = charId;
  _renderMiniSheet(uid);
};

PAGES.vtt=renderVttPage;
