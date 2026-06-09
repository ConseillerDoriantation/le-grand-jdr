// ═══════════════════════════════════════════════════════════════════
// VTT — Table de Jeu Virtuelle
//
// PRINCIPE : chaque personnage ET chaque PNJ possède déjà son token.
// Pas de création manuelle — les tokens sont auto-générés et resten
// en sync bidirectionnel avec les fiches (HP, nom, photo).
// ═══════════════════════════════════════════════════════════════════

import { STATE } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import Sortable from '../vendor/sortable.esm.js';
import { getCurrentAdventureId, getDocData, getDocDataSilent, saveDoc, loadCollection, subscribeCollection } from '../data/firestore.js';
import {
  db, doc, getDoc, collection, addDoc, updateDoc, deleteDoc,
  setDoc, onSnapshot, serverTimestamp, writeBatch,
  query, orderBy, limit,
} from '../config/firebase.js';
import { getMod, getModFromScore, calcVitesse, calcCA, calcPVMax, calcPMMax, calcPalier, calcDeckMax, getMaitriseBonus, statShort, computeEquipStatsBonus, getItemStatBonus, computeEquipSkillBonus, sortCharactersForDisplay } from '../shared/char-stats.js';
import { shopItemToInvEntry } from '../shared/inventory-utils.js';
import { openShopPicker, getShopItemById } from '../shared/shop-picker.js';
import { getArmorSetData, getMainWeapon, DEFAULT_UNARMED } from '../shared/equipment-utils.js';
import { loadWeaponFormats } from '../shared/weapon-formats.js';
import { loadDamageTypes, getDamageTypeRules, getDamageTypeById } from '../shared/damage-types.js';
import { DAMAGE_INTERACTIONS, applyDamageTypeInteraction, previewDamageInteraction } from '../shared/damage-profile.js';
import { runeBadges, spellTypeBadges } from '../shared/spell-action-card.js';
import { calcSpellDuration, calcSpellTargets } from '../shared/spell-runes.js';
import { loadSpellMatrices, getInvokedArm } from '../shared/spell-matrices.js';
import { CONDITION_DEFAULT_LIBRARY, CONDITION_DEFAULT_IDS, loadConditionLibrary } from '../shared/conditions.js';
import { showNotif } from '../shared/notifications.js';
import { uploadCloudinary, hasCloudinaryConfig, openCloudinaryConfigModal } from '../shared/upload-cloudinary.js';
import {
  fogInit, fogSetPgRef, fogUpdate, fogUpdateSoon, fogRenderWalls,
  fogIsEditMode, fogToggleEditMode, fogSetEditTool, fogWallBlocksPath,
} from './vtt-fog.js';
import { openModal, closeModalDirect, confirmModal, updateModalContent } from '../shared/modal.js';
import { _esc, _norm, _searchIncludes, appSplashHtml } from '../shared/html.js';
import { lsJson } from '../shared/local-storage.js';
import { DICE_SKILLS_DEFAULT, DICE_SKILLS_STORAGE_KEY } from '../shared/dice-skills.js';
import PAGES from './pages.js';

let _vttDelegSearch = '';

// ── Constantes ──────────────────────────────────────────────────────
const CELL        = 70;
const MIN_SCALE   = 0.15;
const MAX_SCALE   = 4;

const TYPE_COLOR  = { player:'#4f8cff', enemy:'#ef4444', npc:'#a78bfa' };
const hpColor     = r => r > 0.5 ? '#22c38e' : r > 0.25 ? '#f59e0b' : '#ef4444';

// ══════════════════════════════════════════════════════════════════════════════
// DÉLÉGATION D'ÉVÉNEMENTS — dispatcher générique pour vtt.js
// Pattern : <button data-vtt-fn="_vttFoo" data-vtt-args="arg1|arg2">…</button>
//   - data-vtt-fn   : nom de la fonction (sur `window`)
//   - data-vtt-args : args séparés par "|" (vide pour appel sans args)
//   - data-vtt-on   : type d'event ('click' par défaut, sinon 'input'/'change')
//   - Tokens dans args : $value, $checked, $this, $id → résolus depuis l'élément
//   - Auto-conversion : "true"/"false"/"null", entiers, floats
// ══════════════════════════════════════════════════════════════════════════════
function _vttResolveArg(token, el) {
  if (token === '$value')   {
    // Coercion auto en nombre si l'input est type="number" — les handlers attendent souvent un Number
    if (el.type === 'number' || el.type === 'range') {
      const n = parseFloat(el.value);
      return Number.isFinite(n) ? n : 0;
    }
    return el.value;
  }
  if (token === '$checked') return el.checked;
  if (token === '$this')    return el;
  if (token === '$id')      return el.id;
  if (token === 'true')     return true;
  if (token === 'false')    return false;
  if (token === 'null')     return null;
  if (token === '')         return '';
  if (/^-?\d+$/.test(token))      return parseInt(token, 10);
  if (/^-?\d*\.\d+$/.test(token)) return parseFloat(token);
  return token;
}
// Helper : ferme la modal avant d'appeler fn(...args). Utilisable via data-vtt-fn.
function _vttCloseAnd(fnName, ...args) {
  if (typeof closeModal === 'function') closeModal();
  const fn = VTT_ACTIONS?.[fnName] || window[fnName];
  if (typeof fn !== 'function') {
    console.warn('[vtt] action introuvable apres fermeture modale:', fnName);
    return;
  }
  const result = fn(...args);
  if (result?.catch) result.catch(e => console.error('[vtt] action modale:', fnName, e));
}

// Helper : toggle d'un bloc "détail" dans le chat log (data-vtt-fn="_vttToggleLogDetail" data-vtt-args="ID_DU_DETAIL")
// Le bouton lui-même reçoit la classe `.open` quand le détail est visible.
function _vttToggleLogDetail(detailId) {
  // `this` est le bouton via data-vtt-fn — le dispatcher l'a comme `$this` si demandé,
  // sinon on retrouve le bouton via querySelector du detail puis previousElementSibling.
  const d = document.getElementById(detailId);
  if (!d) return;
  const open = d.style.display !== 'none';
  d.style.display = open ? 'none' : 'block';
  // Le bouton cliqué est passé par event.currentTarget — récupérable via l'élément délégué.
  // Approche pragmatique : on cherche le bouton qui matche cette action+args dans le DOM.
  const btn = document.querySelector(`[data-vtt-fn="_vttToggleLogDetail"][data-vtt-args="${detailId}"]`);
  btn?.classList.toggle('open', !open);
}

// Helpers ciblés pour les cas inline restants (raccourcis / manipulation DOM directe)
function _vttCourirAndClose(srcId) {
  _vttCourir(srcId);
  _closeActionModal();
}

// ── Actions de base : Esquiver / Se cacher / Se désengager (état sur soi) ──
async function _vttSelfAction(srcId, condId) {
  const t = _tokens[srcId]?.data; if (!t) return;
  if (!_canControlToken(t)) return;
  const lib = CONDITION_BY_ID[condId]; if (!lib) return;
  const round = _session?.combat?.round ?? 0;
  const dur = (Number.isFinite(lib.defaultDuration) && lib.defaultDuration > 0) ? lib.defaultDuration : 1;
  // En combat : actif pendant `dur` round(s) (expire à la fin du round courant).
  // Hors combat (round 0) : on cale sur le 1er round de combat → l'état est gardé
  // au tour 1 puis disparaît au tour 2.
  const expiresAtRound = round > 0 ? (round + dur - 1) : dur;
  const existing = (t.conditions || []).filter(c => c.id !== condId); // remplace si déjà posé
  const newCond = {
    id: condId, appliedAt: Date.now(), appliedBy: srcId,
    source: lib.label, saveDC: null, saveStat: null, expiresAtRound,
  };
  await updateDoc(_tokRef(srcId), { conditions: [...existing, newCond] }).catch(() => {});
  const name = _live(t).displayName ?? t.name;
  showNotif(`${lib.icon} ${name} : ${lib.label}`, 'success');
}
function _vttSelfActionClose(srcId, condId) {
  _vttSelfAction(srcId, condId);
  _closeActionModal();
}

// ── Aider : relève un allié à 0 PV à 1 PV et retire tous ses états ──
async function _vttAider(srcId, tgtId) {
  const s = _tokens[srcId]?.data; if (!s) return;
  if (!_canControlToken(s)) return;
  const t = _tokens[tgtId]?.data; if (!t) return;
  await _setHp(t, 1).catch(() => {});
  await updateDoc(_tokRef(tgtId), { conditions: [] }).catch(() => {});
  const name = _live(t).displayName ?? t.name;
  showNotif(`🤝 ${name} relevé à 1 PV — états retirés`, 'success');
}
function _vttAiderClose(srcId, tgtId) {
  _vttAider(srcId, tgtId);
  _closeActionModal();
}
function _vttClearAoptSearch(btn) {
  const inp = btn.previousElementSibling;
  if (inp) { inp.value = ''; _vttAoptSearch(''); inp.focus(); }
}
function _vttMoveTokenAndReset(sel, tid) {
  if (!sel.value) return;
  _vttMoveTokenToPage(tid, sel.value);
  sel.value = '';
}
function _vttSetEmoteAlbum(v) {
  const t = (v || '').trim();
  if (t) localStorage.setItem('vtt-emote-folder', t);
  else localStorage.removeItem('vtt-emote-folder');
}
function _vttPreviewEmoteFile(input, previewId) {
  const f = input.files?.[0]; if (!f) return;
  const u = URL.createObjectURL(f);
  const p = document.getElementById(previewId); if (p) p.src = u;
}
function _vttCancelEmoteEdit() {
  document.getElementById('emote-edit-zone').innerHTML = '';
  document.querySelectorAll('.vtt-emote-card').forEach(c => c.classList.remove('is-editing'));
}
function _vttCcTriSet(btn, value) {
  const w = btn.parentElement;
  w.dataset.ccTriValue = value;
  w.querySelectorAll('.vtt-cc-tri-opt').forEach(b => b.classList.remove('is-on'));
  btn.classList.add('is-on');
}
function _vttCcFlagToggle(btn) {
  btn.classList.toggle('is-on');
  btn.dataset.ccFlagOn = btn.classList.contains('is-on') ? '1' : '';
}
function _vttLibMoveToAndClose(imgId, folderId) {
  _vttLibMoveTo(imgId, folderId);
  document.getElementById('vtt-lib-move-popup')?.remove();
}
function _vttPlColorSelect(btn) {
  document.querySelectorAll('.vtt-pl-color-btn').forEach(b => b.classList.remove('sel'));
  btn.classList.add('sel');
}
// No-op pour les wrappers qui servaient juste à event.stopPropagation() (closest() suffit)
function _vttNoop() {}

function _vttBindDispatch() {
  if (_vttBindDispatch._bound) return;
  _vttBindDispatch._bound = true;
  const dispatch = (e) => {
    const el = e.target.closest('[data-vtt-fn]');
    if (!el) return;
    const expectedOn = el.dataset.vttOn || 'click';
    if (expectedOn === 'keydown-enter') {
      if (e.type !== 'keydown' || e.key !== 'Enter') return;
      e.preventDefault();
    } else if (expectedOn === 'contextmenu') {
      if (e.type !== 'contextmenu') return;
      e.preventDefault();
    } else if (expectedOn !== e.type) {
      return;
    }
    const fn = VTT_ACTIONS[el.dataset.vttFn];
    if (typeof fn !== 'function') return;
    const argsStr = el.dataset.vttArgs;
    const args = (argsStr === undefined || argsStr === '')
      ? []
      : argsStr.split('|').map(a => a === '$event' ? e : _vttResolveArg(a, el));
    fn(...args);
    if (el.dataset.vttBlur !== undefined) el.blur();
  };
  document.addEventListener('click',       dispatch, true);
  document.addEventListener('input',       dispatch, true);
  document.addEventListener('change',      dispatch, true);
  document.addEventListener('keydown',     dispatch, true);
  document.addEventListener('contextmenu', dispatch, true);
}
_vttBindDispatch();

// ── État module ─────────────────────────────────────────────────────
let _stage   = null, _layers = {}, _unsubs = [], _resizeObs = null;
let _session = {}, _pages = {}, _tokens = {};
let _vttEntered = false;   // le client a-t-il cliqué « Entrer » (listeners actifs) ?
let _characters = {};   // characterId → character doc
let _npcs       = {};   // npcId → npc doc
let _bestiary   = {};   // beastId → creature doc (bestiaire)
let _bestiaryLoads = new Map(); // beastId → Promise lecture doc ciblée
let _bstTracker = {};   // creatureId → tracker joueur (pvActuel, pmActuel, caEstimee…)
let _activePage = null;
let _tool       = 'select';
let _selected   = null, _attackSrc = null, _moveHL = [];
let _mtCtx      = null; // contexte multi-cibles actif { srcId, opt, optIdx, targets[], maxTargets, lines Map }
let _mtBroadcasting = false; // évite un write active:false si rien n'a été diffusé
let _mtPending  = null; // cibles validées en attente du roll : string[]
let _zoneCtx    = null; // contexte zone AoE { srcId, tgtId, opt, optIdx, wPx, hPx, x, y, placed }
let _zonePreview= null; // Konva.Group prévisualisation zone
let _selfCtx    = null; // contexte déplacement "soi" { srcId, cells, opt }
let _selfCells  = [];   // cases Konva cliquables (losange Manhattan)
let _chatMsgs   = [];   // derniers messages du chat rendus (pour lookup "répondre")
let _chatReplyTo= null; // message auquel on répond { id, authorName, text }
let _selectedMulti  = new Set();   // ids des tokens en multi-sélection
let _multiDragOrigin= null;        // { [id]: {x,y} } positions au début du drag groupé
let _middlePanActive= false;       // true pendant le pan caméra au clic molette
let _suppressTokenClickUntil = 0;   // bloque le click synthétique après clic droit/molette
let _autoSyncDone = false;   // empêche la double-création de tokens
let _weaponFormats = null;   // cache formats d'armes (damageType, etc.)
let _damageTypes   = null;   // cache types de dégâts (règles de combat)
let _spellMatrices = null;   // cache matrices MJ (armes invoquées, combos config)
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
let _lootLoading     = false;
let _lootReady       = null;
let _lootCloseOutside = null;
const _lootRef  = () => doc(db, `adventures/${_aid()}/vtt/loot`);
// ── Lanceur de dés libre ───────────────────────────────────────────
let _diceFormula   = {};        // { faces→count } ex: { 20:2, 6:1 }
let _diceFreeBonus = 0;
let _diceFreeMode  = 'normal';  // 'advantage'|'normal'|'disadvantage'
let _diceCloseOut  = null;
let _diceSkills = [];        // [{name, stat}] chargées depuis world/dice_skills
// — Musique / sons
let _sounds        = [];     // [{id, name, url, createdAt}]
let _playlists     = [];     // [{id, name, color, soundIds[]}]
let _musicState    = {};     // état Firestore courant
let _musicCatalogStarted = false;
let _musicCatalogLoading = false;
let _musicCatalogReady   = null;
let _musicSoundLoads     = new Map(); // soundId → Promise lecture doc ciblée
let _audioEl       = null;   // HTMLAudioElement actif
let _musicSearch   = ''; // filtre texte unique (vue unifiée), persisté en session
let _musicCloseOut = null;
let _musicProgTimer = null;
let _musicSortables = [];   // instances Sortable actives
let _previewEl     = null;  // aperçu local MJ (non diffusé)
let _rollMode   = 'normal';  // 'advantage' | 'normal' | 'disadvantage'
let _rollBonus  = 0;         // bonus contextuel temporaire (anneau, sort, etc.)
let _insTab     = 'stats';   // onglet actif de l'inspecteur token
let _rollHidden = lsJson.get('vtt-roll-hidden', false); // MJ only — jet caché des joueurs
const _renderedPings     = new Set();
const _renderedReactions = new Set();

// ── Outils de dessin & règle ────────────────────────────────────────
const CELL_M = 1.5;          // 1 case = 1.5 mètre
let _annotations      = {};   // id → { data, shape }
let _selectedAnnotId  = null; // id de l'annotation sélectionnée (sélection simple)
let _selectedAnnotIds = new Set(); // multi-sélection annotations
let _annotTransformer = null; // Konva Transformer pour resize/rotation
let _annotGroupDragOrigins = null; // { [id]: {x,y} } pour déplacement groupé annotations
let _skipAnnotRebuild = new Set(); // ids dont le onSnapshot doit sauter le rebuild (transform local)

// Marquee (lasso rectangle)
let _marqueeActive  = false;
let _marqueeOrigin  = null;   // world coords du départ
let _marqueeLastWp  = null;   // dernière position pendant le drag
let _marqueeShape   = null;   // Konva Rect visuel
let _suppressNextClick = false; // empêche le click de désélectionner après un marquee

// Ping (remonté au niveau module pour accès depuis les fonctions externes)
let _pingTimer  = null;
let _pingOrigin = null;
let _drawHistory  = [];      // ids des annotations créées dans la session (pour Ctrl+Z)
let _drawing      = false;   // tracé en cours
let _erasing      = false;   // gomme : effacement pressé en cours
let _drawPts      = [];      // points crayon libre (world coords)
let _drawOrigin   = null;    // point de départ pour formes
let _drawLive     = null;    // forme Konva live (avant sauvegarde)
let _drawColor    = '#ef4444';
let _drawWidth    = 2;
let _drawShape    = 'pencil'; // 'pencil'|'line'|'rect'|'circle'
let _drawFill     = false;
let _rulerActive  = false;
let _rulerOrigin  = null;
let _rulerHideTimer = null;

// ══════════════════════════════════════════════════════════════════════════════
// LIBRAIRIE DES ÉTATS (CONDITIONS) — inspirée des conditions D&D 5e
// ──────────────────────────────────────────────────────────────────────────────
// Stocké sur le token : t.conditions = [{
//   id, source, saveDC, saveStat, expiresAtRound, appliedAt
// }]
// `effects` est consommé par le moteur de combat pour appliquer
// automatiquement avantage/désavantage et restrictions de déplacement.
// ══════════════════════════════════════════════════════════════════════════════
// Librairie en mémoire — peut être surchargée par les overrides MJ chargés depuis Firestore
let CONDITION_LIBRARY = CONDITION_DEFAULT_LIBRARY.map(c => ({ ...c, effects: { ...c.effects } }));
let CONDITION_BY_ID   = Object.fromEntries(CONDITION_LIBRARY.map(c => [c.id, c]));
function _rebuildConditionIndex() {
  CONDITION_BY_ID = Object.fromEntries(CONDITION_LIBRARY.map(c => [c.id, c]));
}
function _isCustomCondition(id) { return !CONDITION_DEFAULT_IDS.has(id); }

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
}
const _signed = n => n > 0 ? `+${n}` : `${n}`;
const _npcStatScore = (npc, key) => _numOr(npc?.stats?.[key], 8);
const _npcStatMod = (npc, key) => getModFromScore(_npcStatScore(npc, key));
const _npcCombat = (npc = {}) => npc?.combat || {};
const _tokenStatMod = (t, statKey) => {
  if (!t || !statKey) return 0;
  if (t.characterId) {
    const c = _characters[t.characterId];
    return c ? getMod(c, statKey) : 0;
  }
  if (t.npcId) return _npcStatMod(_npcs[t.npcId] || {}, statKey);
  if (t.beastId) {
    const b = _bestiary[t.beastId];
    // Le bestiaire stocke les stats DIRECTEMENT sur l'objet (b.force, b.constitution…)
    // et non dans b.stats. Fallback sur b.stats si jamais des données legacy utilisent
    // cette structure. Score par défaut 10 si non saisi (mod 0).
    let score = b?.[statKey];
    if (!Number.isFinite(score) || score <= 0) score = b?.stats?.[statKey];
    if (!Number.isFinite(score) || score <= 0) score = 10;
    return getModFromScore(score);
  }
  return 0;
}

// ── État présence & mini-fiche ──────────────────────────────────────
let _presence     = {};   // uid → { uid, pseudo }
const VTT_PRESENCE_HEARTBEAT_MS = 75_000;
let _presHeartbeat= null; // intervalId du heartbeat
let _presLastWriteAt = 0;
let _presVisibility = null; // listener visibilitychange (pause heartbeat onglet masqué)
let _presUnload = null; // listener beforeunload VTT
let _presRefresh  = null; // intervalId du rafraîchissement présence
let _emoteCloseOutside = null; // listener mousedown fermeture picker émotes
let _trayFilter       = 'all'; // filtre actif : 'all'|'player'|'npc'|'enemy'
let _traySearch       = '';    // filtre texte appliqué à la réserve
let _pageSearch       = '';    // filtre texte appliqué à la liste des pages
const _pageFoldClosed = (() => { // dossiers de pages repliés (persistés)
  try { return new Set(JSON.parse(localStorage.getItem('vtt-page-folds') || '[]')); } catch { return new Set(); }
})();
const _savePageFolds = () => { try { localStorage.setItem('vtt-page-folds', JSON.stringify([..._pageFoldClosed])); } catch {} };
// Sous-sections togglables (en ligne reste toujours visible) — persistées
// par navigateur via localStorage, défaut : repliées (le MJ regarde d'abord
// les joueurs présents).
const _loadTrayPref = (k, dflt = false) => {
  try { const v = localStorage.getItem('vtt-tray-' + k); return v == null ? dflt : v === '1'; }
  catch { return dflt; }
}
const _saveTrayPref = (k, v) => { try { localStorage.setItem('vtt-tray-' + k, v ? '1' : '0'); } catch {} };
let _trayOnOpen  = _loadTrayPref('on');
let _trayOffOpen = _loadTrayPref('off');
let _trayNpcOpen = _loadTrayPref('npc');
let _miniUid      = null; // uid du joueur dont la mini-fiche est ouverte
let _miniCharId   = null; // characterId sélectionné dans la mini-fiche
let _miniTab      = 'combat'; // onglet actif de la mini-fiche
let _msOpenNote   = null; // index de la note dépliée (onglet Notes)
// Filtres locaux des onglets Sac / Sorts (recherche texte + catégorie active).
// Filtrage DOM in-place (pas de re-render) → le focus de la recherche est conservé.
let _msInvQuery   = '', _msInvCat  = 'all';
let _msSortQuery  = '', _msSortCat = 'all';

// ── Timer de session ────────────────────────────────────────────────
// Stocké dans _session.timer = { startedAt:ms, accumulated:ms, running:bool, label:string }
let _timerTick = null; // intervalId pour rafraîchir l'affichage

// ── Combat tracker (overlay haut-gauche sur le canvas) ──────────────
let _combatTab = 'allies'; // 'allies' (joueurs + PNJ) | 'enemies' (MJ only)

// ── Refs Firestore ──────────────────────────────────────────────────
const _aid     = ()   => getCurrentAdventureId();
const _sesRef  = ()   => doc(db,  `adventures/${_aid()}/vtt/session`);
const _pgsCol  = ()   => collection(db, `adventures/${_aid()}/vttPages`);
const _toksCol = ()   => collection(db, `adventures/${_aid()}/vttTokens`);
const _pgRef   = (id) => doc(db, `adventures/${_aid()}/vttPages/${id}`);
const _tokRef  = (id) => doc(db, `adventures/${_aid()}/vttTokens/${id}`);
const _chrRef  = (id) => doc(db, `adventures/${_aid()}/characters/${id}`);
const _npcRef  = (id) => doc(db, `adventures/${_aid()}/npcs/${id}`);
const _bstTrackerRef = (uid) => doc(db, `adventures/${_aid()}/bestiary_tracker/${uid}`);
const _logCol      = ()  => collection(db, `adventures/${_aid()}/vttLog`);
const _castingCol  = ()  => collection(db, `adventures/${_aid()}/vttCasting`);
const _castingRef  = uid => doc(db, `adventures/${_aid()}/vttCasting/${uid}`);
const _pingsCol     = ()  => collection(db, `adventures/${_aid()}/vttPings`);
const _pingRef      = uid => doc(db, `adventures/${_aid()}/vttPings/${uid}`);
const _reactionsCol = ()  => collection(db, `adventures/${_aid()}/vttEmoteReactions`);
const _reactionRef  = uid => doc(db, `adventures/${_aid()}/vttEmoteReactions/${uid}`);
const _annotCol      = ()  => collection(db, `adventures/${_aid()}/vttAnnotations`);
const _annotRef      = id  => doc(db, `adventures/${_aid()}/vttAnnotations/${id}`);
const _sonsCol       = ()  => collection(db, `adventures/${_aid()}/vttSons`);
const _sonRef        = id  => doc(db, `adventures/${_aid()}/vttSons/${id}`);
const _playlistsCol  = ()  => collection(db, `adventures/${_aid()}/vttPlaylists`);
const _playlistRef   = id  => doc(db, `adventures/${_aid()}/vttPlaylists/${id}`);
const _musicStateRef = ()  => doc(db, `adventures/${_aid()}/vtt/music`);

// ═══════════════════════════════════════════════════════════════════
// DONNÉES EFFECTIVES — fusion token + entité liée
// C'est ici que la sync temps réel prend tout son sens :
// HP/nom/image viennent toujours de la fiche source.
// ═══════════════════════════════════════════════════════════════════

/** Somme des bonus de toucher actifs (enchantement mode Toucher) sur un token.
 *  Lu FRAIS au moment du jet / de l'affichage HUD (jamais figé dans l'option). */
function _touchBuffOf(tok) {
  const round = _session?.combat?.round ?? 0;
  return (tok?.buffs || [])
    .filter(b => b.type === 'toucher_bonus' && (b.expiresAtRound == null || round === 0 || round <= b.expiresAtRound))
    .reduce((s, b) => s + (parseInt(b.bonus) || 0), 0);
}

function _conditionMoveBonusOf(tok) {
  return _activeConditionsOf(tok)
    .reduce((sum, { cond, lib }) => {
      const raw = cond.movementBonus ?? lib.effects?.movementBonus;
      const bonus = Number.isFinite(parseInt(raw)) ? parseInt(raw) : 0;
      return sum + bonus;
    }, 0);
}

function _conditionDmgBonusOf(tok) {
  const active = _activeConditionsOf(tok)
    .map(({ cond, lib }) => ({
      cond,
      lib,
      formula: (cond.dmgDealtBonusFormula || lib.effects?.dmgDealtBonus || '').trim(),
    }))
    .filter(x => !!x.formula);
  return active[0] || null;
}

function _scaledEnchantConditionFields(lib, power = 0, amplification = 0, overrides = {}) {
  const eff = lib?.effects || {};
  const fields = { enchantPower: Math.max(0, parseInt(power) || 0) };
  const amp = Math.max(0, parseInt(amplification) || 0);

  if (eff.movementBonus != null) {
    const base = Number.isFinite(parseInt(eff.movementBonus)) ? parseInt(eff.movementBonus) : 0;
    fields.movementBonus = Number.isFinite(parseInt(overrides.movementBonus))
      ? parseInt(overrides.movementBonus)
      : base + amp;
  }
  if (eff.dmgDealtBonus) {
    fields.dmgDealtBonusFormula = (overrides.dmgFormula || '').trim() || `${1 + fields.enchantPower}d4 +2`;
  }
  return fields;
}

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
    displayMovement: Math.max(0, (t.movement ?? 6) + _conditionMoveBonusOf(t)),
    displayAttack:   t.attack   ?? 5,
    displayAttackDice: t.attackDice || '1d6',
    displayDefense:  t.defense  ?? 0,
    realDefense:     t.defense  ?? 0,
    // Ennemi custom (posé sur la carte, sans fiche) : pas d'estimation possible
    // → "?" pour les joueurs, jamais la CA réelle saisie par le MJ.
    caBadge:         (!STATE.isAdmin && t.type === 'enemy') ? '?' : String(t.defense ?? 0),
    displayRange:    t.range    ?? 1,
    displayTokenW:   Math.max(1, Math.min(5, t.tokenW ?? t.tokenSize ?? 1)),
    displayTokenH:   Math.max(1, Math.min(5, t.tokenH ?? t.tokenSize ?? 1)),
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

  // Formule de dégâts : arme équipée (incl. Poings 2d4 par défaut) > bestiary > override token
  const weapon      = c ? getMainWeapon(c) : null;
  const weapStats   = weapon?.degatsStats?.length ? weapon.degatsStats : [weapon?.degatsStat || 'force'];
  const toucherStat = (weapon?.toucherStats?.[0] || weapon?.toucherStat || weapStats[0]);
  const weapMod     = c ? weapStats.reduce((sum, s) => sum + getMod(c, s), 0) : 0;
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

  // Valeurs dérivées calculées une seule fois pour éviter les recalculs dans result
  const _round   = _session?.combat?.round ?? 0;
  const _pmMax   = c ? calcPMMax(c) : n ? npcPmMax : null;
  const _caBase  = t.defense ?? (c ? calcCA(c) : (b ? (_numOr(b.ca, 10)) : (_numOr(e.ca, _numOr(e.defense, 0)))));
  const _caBuffs = (t.buffs || []).filter(bf => bf.type === 'ca' && (bf.expiresAtRound == null || _round === 0 || _round <= bf.expiresAtRound));
  const _ca      = _caBase + _caBuffs.reduce((sum, bf) => sum + (bf.bonus || 0), 0);
  // Attaque de base (stat). Le bonus toucher d'enchantement N'est PAS inclus ici :
  // il est appliqué frais au moment du jet (_vttRollAttack) pour ne pas dépendre
  // d'une option figée à l'ouverture du panneau (le buff peut être posé après).
  const _baseAtk = t.attack   ?? (c ? toucherMod+setBonus : (b ? (_numOr(b.attaques?.[0]?.toucher, 5)) : (_numOr(e.bonusAttaque, _numOr(e.attack, _numOr(npcWeapon.toucher, (npcWeapon.toucherStat || npcWeapon.statAttaque) ? _npcStatMod(e, npcWeapon.toucherStat || npcWeapon.statAttaque) : e.stats?.force != null ? _npcStatMod(e, 'force') : 5))))));

  const result = {
    ...t,
    // Ennemis : le nom du token (instance) prime sur le nom générique du bestiaire
    // Joueurs/PNJ : le nom de la fiche prime (toujours à jour)
    displayName:       b ? (t.name || b.nom) : (e.nom || t.name),
    displayImage:      e.photoURL || e.photo || e.avatar || e.imageUrl || t.imageUrl || null,
    displayHp:         hpCurrent,
    displayHpMax:      hpMax,
    displayPm:         c ? (c.pm ?? _pmMax) : n ? npcPmCur : null,
    displayPmMax:      _pmMax,
    displayMovement: (() => {
      const baseMv = t.movement ?? (c ? calcVitesse(c) : (b ? (_numOr(b.vitesse, 4)) : (_numOr(e.vitesse, _numOr(e.deplacement, 6)))));
      const moveDelta = (t.buffs || [])
        .filter(bf => (bf.type === 'move_bonus' || bf.type === 'move_debuff')
          && (bf.expiresAtRound == null || _round === 0 || _round <= bf.expiresAtRound))
        .reduce((sum, bf) => sum + (bf.bonus || 0), 0);
      return Math.max(0, baseMv + moveDelta + _conditionMoveBonusOf(t));
    })(),
    displayAttack: _baseAtk,
    displayAttackDice: atkDice,
    displayDefense:    _ca,
    // VRAIE CA, JAMAIS écrasée par l'estimation joueur. Sert au calcul authoritatif
    // du hit/miss côté serveur. À ne PAS afficher aux joueurs (utiliser displayDefense
    // ou _viewCA pour le rendu UI).
    realDefense:       _ca,
    _activeCaBuff:     _caBuffs[0] ?? null,
    // Pour un perso : arme équipée > override admin (t.range > 1) > défaut 1
    // Pour bestiaire/custom : t.range > 1ère attaque bestiary > défaut 1
    // Bonus de portée temporaire (buff range_bonus = Allonge magique etc.)
    displayRange: (() => {
      const baseRange = c
        ? (t.range > 1 ? t.range : (weapon?.portee ? parseInt(weapon.portee)||1 : 1))
        : b
          ? (t.range > 1 ? t.range : (_numOr(b.attaques?.[0]?.portee, 1)))
          : n
            ? (t.range > 1 ? t.range : (_numOr(npcCombat.range, _numOr(npcWeapon.portee, 1))))
            : (t.range ?? 1);
      const r = _session?.combat?.round ?? 0;
      const rangeBonus = (t.buffs || [])
        .filter(bf => bf.type === 'range_bonus' && (bf.expiresAtRound == null || r === 0 || r <= bf.expiresAtRound))
        .reduce((sum, bf) => sum + (bf.bonus || 0), 0);
      return baseRange + rangeBonus;
    })(),
    _beast:            b,   // référence directe pour _buildAttackOptions
    displayTokenW:     Math.max(1, Math.min(5, t.tokenW ?? t.tokenSize ?? b?.tokenW ?? b?.tokenSize ?? 1)),
    displayTokenH:     Math.max(1, Math.min(5, t.tokenH ?? t.tokenSize ?? b?.tokenH ?? b?.tokenSize ?? 1)),
  };

  // Joueur sur token ennemi : remplace HP et CA par les estimations du tracker.
  // Sans estimation = null → affichage "?/?" sur le token (ne révèle pas les vraies valeurs MJ).
  if (!STATE.isAdmin && t.type === 'enemy') {
    if (b) {
      const track  = _bstTracker[t.beastId] || {};
      const estMax = track.pvActuel !== undefined ? parseInt(track.pvActuel) : null;
      if (estMax !== null) {
        // pvCombatHp est stocké sur le token lui-même (écrit lors des attaques joueur).
        // Tous les clients le reçoivent via le onSnapshot vttTokens existant.
        // null → token frais ou jamais frappé par un joueur → afficher pleins PV estimés.
        const pvCombatHp = t.pvCombatHp != null
          ? Math.max(0, parseInt(t.pvCombatHp) || 0) : null;
        if (pvCombatHp !== null) {
          result.displayHp = pvCombatHp;           // suivi de groupe via token (prioritaire)
        } else if (t.hp !== null) {
          result.displayHp = Math.min(hpCurrent, estMax); // HP réel borné à l'estimation
        } else {
          result.displayHp = estMax;               // token frais = pleins PV estimés
        }
        result.displayHpMax = estMax;
      } else {
        result.displayHp    = null;
        result.displayHpMax = null;
      }
      if (track.caEstimee !== undefined) result.displayDefense = parseInt(track.caEstimee) || 0;
    } else {
      // Ennemi sans fiche bestiaire → HP toujours inconnus pour les joueurs
      result.displayHp    = null;
      result.displayHpMax = null;
    }
  }

  // ── Badge CA affiché sur le token ────────────────────────────────────────
  // • MJ : vraie CA (avec buffs) — toujours.
  // • Joueur sur N'IMPORTE quel ennemi : son estimation (tracker bestiaire) ou "?".
  //   Jamais la vraie CA du MJ — y compris pour un ennemi custom (sans beastId).
  // • Reste (son perso, allié, PNJ) : vraie CA (displayDefense).
  if (!STATE.isAdmin && t.type === 'enemy') {
    const track = t.beastId ? (_bstTracker[t.beastId] || {}) : null;
    result.caBadge = (track && track.caEstimee !== undefined && track.caEstimee !== '')
      ? String(parseInt(track.caEstimee) || 0)
      : '?';
  } else {
    result.caBadge = String(result.displayDefense ?? 0);
  }

  return result;
}

/**
 * Peut-on contrôler ce token ?
 *   - admin (MJ) → toujours
 *   - propriétaire du token (ownerId) → toujours
 *   - délégué de contrôle (controlDelegates: [uid…]) → permission accordée par le propriétaire
 *
 * Sert à toutes les actions « contrôler le token » : drag, lancement d'attaque/sort,
 * déclenchement de buff en attente, ouverture du menu d'actions, etc.
 */
function _canControlToken(t, uid = STATE.user?.uid) {
  if (!t || !uid) return false;
  if (STATE.isAdmin) return true;
  if (t.ownerId === uid) return true;
  const delegates = Array.isArray(t.controlDelegates) ? t.controlDelegates : [];
  return delegates.includes(uid);
}

/**
 * Résout un UID en nom affichable : ownerPseudo / nom du perso lié → fallback UID court.
 * Centralise la logique pour afficher les délégués, log-author, etc.
 */
function _resolveUidName(uid) {
  if (!uid) return '?';
  // Cherche le perso lié à cet UID
  const ch = Object.values(_characters || {}).find(c => c?.uid === uid);
  if (ch?.ownerPseudo) return ch.ownerPseudo;
  if (ch?.nom)         return ch.nom;
  // Fallback : UID court
  return uid.slice(0, 6) + '…';
}

// HP écrit sur la fiche source (bidirectionnel)
async function _setHp(t, newHp) {
  const v = Math.max(0, newHp);
  if (t.characterId) await updateDoc(_chrRef(t.characterId), { hp: v });
  else if (t.npcId)  await updateDoc(_npcRef(t.npcId),       { hp: v });
  else               await updateDoc(_tokRef(t.id),          { hp: v });
  await _syncDownedCondition(t, v);
}

/**
 * Créature du MJ (ennemi / PNJ, pas un perso joueur) tombée à 0 PV → applique
 * automatiquement l'état « Inconscient ». Retiré dès qu'elle remonte au-dessus
 * de 0. L'état auto est marqué (`auto0hp`) pour ne jamais effacer un Inconscient
 * posé manuellement (sort de sommeil, etc.). Écriture séparée et bornée au
 * franchissement du seuil → coût Firestore négligeable, et n'impacte pas la MAJ
 * des PV si les règles la refusent (.catch).
 */
async function _syncDownedCondition(t, hp) {
  if (!t || t.type === 'player') return;
  const conds = t.conditions || [];
  if (hp <= 0) {
    if (conds.some(c => c.id === 'unconscious')) return; // déjà inconscient (manuel ou auto)
    const newConds = [...conds, {
      id: 'unconscious', appliedAt: Date.now(), appliedBy: 'auto', auto0hp: true,
      source: 'PV à 0', saveDC: null, saveStat: null, expiresAtRound: null,
    }];
    t.conditions = newConds;
    await updateDoc(_tokRef(t.id), { conditions: newConds }).catch(() => {});
    const name = _live(t).displayName ?? t.name;
    showNotif(`😵 ${name} tombe inconscient (0 PV)`, 'info');
  } else if (conds.some(c => c.id === 'unconscious' && c.auto0hp)) {
    const newConds = conds.filter(c => !(c.id === 'unconscious' && c.auto0hp));
    t.conditions = newConds;
    await updateDoc(_tokRef(t.id), { conditions: newConds }).catch(() => {});
  }
}

/**
 * Déclenche un JS Sa de concentration auto sur tous les buffs canalisés du token
 * qui vient de subir des dégâts. À appeler depuis tout point qui inflige des dégâts
 * hors `_vttRollAttack` (édition manuelle, DoT, environnement…).
 * Retourne un tableau de notes pour log/notif.
 */
async function _vttTriggerConcentrationSave(td, damageAmount) {
  if (!td || damageAmount <= 0) return [];
  const buffs = (td.buffs || []).filter(b => b?.canalisePersistant && b?.concentrationDD != null);
  const round = _session?.combat?.round ?? 0;
  const activeConditions = (td.conditions || []).filter(c => {
    if (c.expiresAtRound != null && round > 0 && round > c.expiresAtRound) return false;
    return !!CONDITION_BY_ID[c.id]?.effects?.concentrationCheck;
  });
  if (!buffs.length && !activeConditions.length) return [];
  const sagMod = _tokenStatMod(td, 'sagesse');
  const tgtName = _live(td).displayName ?? td.name;
  const notes = [];
  let removed = [];
  for (const cb of buffs) {
    const dd = cb.concentrationDD;
    const roll = Math.floor(Math.random() * 20) + 1;
    const tot = roll + sagMod;
    const success = roll === 20 || (roll !== 1 && tot >= dd);
    const rollStr = `JS Sa ${roll}${sagMod>=0?'+':''}${sagMod}=${tot} vs DD${dd}`;
    if (success) {
      notes.push(`🧠 ${rollStr} · ${cb.sortLabel} tenu (${tgtName})`);
    } else {
      notes.push(`💢 ${rollStr} ÉCHEC · ${cb.sortLabel} rompu sur ${tgtName}`);
      removed.push(cb);
      // Supprime les summons canalisés liés
      const summonsToKill = Object.values(_tokens).filter(e =>
        e?.data?.summonOwnerId === (cb.casterId || td.id) && e?.data?.summonCanalise
      );
      for (const s of summonsToKill) { await _persistInvocationState(s.data); await deleteDoc(_tokRef(s.data.id)).catch(() => {}); }
    }
  }

  const removedConditionIds = new Set();
  for (const cond of activeConditions) {
    const lib = CONDITION_BY_ID[cond.id];
    const dd = cond.saveDC || lib?.defaultDC || 11;
    const roll = Math.floor(Math.random() * 20) + 1;
    const tot = roll + sagMod;
    const success = roll === 20 || (roll !== 1 && tot >= dd);
    const rollStr = `JS Sa ${roll}${sagMod>=0?'+':''}${sagMod}=${tot} vs DD${dd}`;
    if (success) {
      notes.push(`🧠 ${rollStr} · ${lib?.label || cond.id} tenu (${tgtName})`);
    } else {
      notes.push(`💢 ${rollStr} ÉCHEC · ${lib?.label || cond.id} rompu sur ${tgtName}`);
      removedConditionIds.add(cond.id);
    }
  }

  if (removed.length) {
    const remaining = (td.buffs || []).filter(b => !removed.includes(b));
    await updateDoc(_tokRef(td.id), { buffs: remaining }).catch(() => {});
  }
  if (removedConditionIds.size) {
    const remainingConditions = (td.conditions || []).filter(c => !removedConditionIds.has(c.id));
    await updateDoc(_tokRef(td.id), { conditions: remainingConditions }).catch(() => {});
  }
  return notes;
}

// ═══════════════════════════════════════════════════════════════════
// AUTO-SYNC TOKENS — crée les tokens manquants pour persos et PNJ
// ═══════════════════════════════════════════════════════════════════
let _charsReady = false, _npcsReady = false, _toksReady = false;

function _maybeSyncAutoTokens() {
  if (!STATE.isAdmin || _autoSyncDone) return;
  if (!_charsReady || !_npcsReady || !_toksReady) return;
  _autoSyncDone = true;
  _syncAutoTokens();
}

const _tokenEntityKey = t => t?.characterId ? 'c:' + t.characterId : t?.npcId ? 'n:' + t.npcId : null;
let _reserveCleanupRunning = false;

async function _cleanupReserveDuplicates() {
  if (!STATE.isAdmin || _reserveCleanupRunning) return;
  const seen = new Map();
  const duplicateIds = [];
  const reserve = Object.values(_tokens)
    .map(e => e.data)
    .filter(t => !t.pageId && _tokenEntityKey(t))
    .sort((a, b) => {
      const aAuto = a.id?.startsWith('auto_') ? 0 : 1;
      const bAuto = b.id?.startsWith('auto_') ? 0 : 1;
      return aAuto - bAuto || String(a.id).localeCompare(String(b.id));
    });
  for (const t of reserve) {
    const key = _tokenEntityKey(t);
    if (seen.has(key)) duplicateIds.push(t.id);
    else seen.set(key, t.id);
  }
  if (!duplicateIds.length) return;

  _reserveCleanupRunning = true;
  try {
    const batch = writeBatch(db);
    duplicateIds.forEach(id => batch.delete(_tokRef(id)));
    await batch.commit();
    duplicateIds.forEach(id => { _tokens[id]?.shape?.destroy(); delete _tokens[id]; });
    _renderTraySoon();
  } catch (e) {
    console.error('[vtt] cleanup reserve duplicates:', e);
  } finally {
    _reserveCleanupRunning = false;
  }
}

async function _syncAutoTokens() {
  // ─ 1. Scanner les tokens existants : tokens orphelins + doublons réserve ─
  // Règle : un perso/PNJ peut avoir plusieurs tokens *placés* sur des pages
  // différentes (cf. _vttDuplicateOnPage), mais UN SEUL token en réserve
  // (pageId === null). Les doublons en réserve viennent de syncs concurrents
  // historiques (multi-tab / multi-admin) avant l'introduction des IDs
  // déterministes ci-dessous.
  const hasAnyToken     = new Set();  // 'c:<id>' | 'n:<id>' : a au moins 1 token
  const reserveSeen     = new Map();  // 'c:<id>' | 'n:<id>' → 1er token réserve gardé
  const toDelete        = [];

  for (const { data } of Object.values(_tokens)) {
    let key = null;
    if (data.characterId) key = 'c:' + data.characterId;
    else if (data.npcId)  key = 'n:' + data.npcId;
    if (!key) continue;

    // Orphelin : l'entité a été supprimée → drop quoi qu'il arrive
    if (data.characterId && !_characters[data.characterId]) { toDelete.push(data.id); continue; }
    if (data.npcId       && !_npcs[data.npcId])             { toDelete.push(data.id); continue; }

    hasAnyToken.add(key);

    // Doublons réserve : on garde le 1er rencontré, on drop les autres
    if (!data.pageId) {
      if (reserveSeen.has(key)) toDelete.push(data.id);
      else                      reserveSeen.set(key, data);
    }
  }

  // ─ 2. Identifier les entités sans aucun token → à créer ──────────────
  const toCreate = [];
  for (const c of Object.values(_characters)) {
    if (!hasAnyToken.has('c:' + c.id)) toCreate.push({
      detId: `auto_c_${c.id}`,
      name: c.nom || 'Personnage', type: 'player',
      characterId: c.id, npcId: null, beastId: null, ownerId: c.uid || null,
    });
  }
  for (const n of Object.values(_npcs)) {
    if (!hasAnyToken.has('n:' + n.id)) toCreate.push({
      detId: `auto_n_${n.id}`,
      name: n.nom || 'PNJ', type: 'npc',
      characterId: null, npcId: n.id, beastId: null, ownerId: null,
    });
  }
  // Les ennemis ne sont PAS auto-créés depuis le bestiaire : ils sont placés
  // manuellement depuis la section Bestiaire du tray.

  if (!toCreate.length && !toDelete.length) return;

  const batch = writeBatch(db);
  for (const { detId, ...base } of toCreate) {
    // ID déterministe (auto_c_<id> / auto_n_<id>) : si deux syncs concurrents
    // (multi-tab, multi-admin) créent en même temps, `batch.set` écrase au
    // lieu de dupliquer → garantie d'unicité au niveau Firestore.
    batch.set(doc(_toksCol(), detId), {
      ...base,
      pageId: null, col: 0, row: 0,
      visible: false, imageUrl: null,
      movement: null, range: 1, attack: null, defense: null,
      hp: null, hpMax: null,
      movedThisTurn: false, attackedThisTurn: false, bonusActionThisTurn: false, reactionThisTurn: false,
      createdAt: serverTimestamp(),
    });
  }
  for (const id of new Set(toDelete)) batch.delete(_tokRef(id));
  await batch.commit().catch(e => console.error('[vtt] auto-sync tokens:', e));
}

// ═══════════════════════════════════════════════════════════════════
// KONVA — chargement dynamique CDN
// ═══════════════════════════════════════════════════════════════════
async function _loadKonva() {
  if (window.Konva) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = './assets/js/vendor/konva-10.3.0.min.js';
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
  if (_presVisibility)   { document.removeEventListener('visibilitychange', _presVisibility); _presVisibility = null; }
  if (_presUnload)       { window.removeEventListener('beforeunload', _presUnload); _presUnload = null; }
  if (_presRefresh)      { clearInterval(_presRefresh);    _presRefresh   = null; }
  _presLastWriteAt = 0;
  _timerStopTick();
  if (_emoteCloseOutside){ document.removeEventListener('mousedown', _emoteCloseOutside, true); _emoteCloseOutside = null; }
  if (_mapLibUnsub) { _mapLibUnsub(); _mapLibUnsub = null; }
  _mapLib = { folders: [], images: [] }; _libFolder = null;
  if (_lootUnsub) { _lootUnsub(); _lootUnsub = null; }
  _lootLoading = false; _lootReady = null;
  if (_lootCloseOutside) { document.removeEventListener('mousedown', _lootCloseOutside, true); _lootCloseOutside = null; }
  _loot = { stash: [], loot: [] };
  _killAudio();
  _sounds = []; _playlists = []; _musicState = {};
  _musicCatalogStarted = false; _musicCatalogLoading = false; _musicCatalogReady = null;
  _musicSoundLoads.clear();
  _mtClear(true);
  _mtBroadcasting = false;
  _presence = {}; _miniUid = null; _miniCharId = null;
  _tokens = {}; _pages = {}; _characters = {}; _npcs = {}; _bestiary = {}; _bstTracker = {};
  _bestiaryLoads.clear();
  _session = {}; _activePage = null; _selected = null; _attackSrc = null;
  _moveHL = []; _autoSyncDone = false; _renderedPings.clear(); _renderedReactions.clear();
  _selectedMulti.clear(); _multiDragOrigin = null;
  _annotations = {}; _drawing = false; _drawLive = null; _drawHistory = [];
  _selectedAnnotId = null; _selectedAnnotIds.clear(); _annotTransformer = null;
  _annotGroupDragOrigins = null;
  _marqueeActive = false; _marqueeOrigin = null; _marqueeLastWp = null;
  _marqueeShape = null; _suppressNextClick = false;
  _pingTimer = null; _pingOrigin = null;
  _rulerActive = false; _rulerOrigin = null; _rulerNodes = null; _rulerLastCell = null; _rulerHoverDot = null;
  if (_rulerHideTimer) { clearTimeout(_rulerHideTimer); _rulerHideTimer = null; }
  if (_mjRulerPendingTimer) { clearTimeout(_mjRulerPendingTimer); _mjRulerPendingTimer = null; }
  _mjRulerLastWrite = 0; _mjRulerBroadcasting = false; _mjRulerRemote = null;
  _charsReady = false; _npcsReady = false; _toksReady = false;
  _traySearch = '';
  _imgTr = null; _imgTrFg = null; _selImg = null; _mapMode = false;
  _hideCtxMenu();
  document.removeEventListener('keydown', _keyHandler);
  const mc = document.getElementById('main-content');
  if (mc) { mc.style.overflow = ''; mc.style.height = ''; mc.style.paddingBottom = ''; }
}

// ═══════════════════════════════════════════════════════════════════
// CANVAS
// ═══════════════════════════════════════════════════════════════════
function _initCanvas(container) {
  const K = window.Konva;
  K.dragButtons = [0, 2]; // Drag autorisé au clic gauche et droit (tokens/images/annotations).
  _stage = new K.Stage({ container, width: container.clientWidth, height: container.clientHeight });
  // Konva recommande max 3-5 layers. On consolide bg+map dans `backLayer` et
  // fog+walls+mapFg+ping dans `frontLayer` via des Konva.Group. L'ordre interne
  // préserve le z-order, et chaque "_layers.X" garde son API usuelle.
  // batchDraw() est forwardé vers le layer parent.
  // Ordre visuel : bg → map → grid → draw → token → fog → walls → mapFg → ping.
  // Le Stage ne contient ainsi que 5 vrais layers Konva.
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
  _layers.walls = _asLayer(new K.Group({ listening: true }), frontLayer);  // murs/portes/fenêtres/lumières
  _layers.token = new K.Layer();
  _layers.fog   = _asLayer(new K.Group({ listening: false }), frontLayer); // masque de brouillard
  _layers.mapFg = _asLayer(new K.Group({ listening: false }), frontLayer);
  _layers.ping  = _asLayer(new K.Group({ listening: false }), frontLayer);
  backLayer.add(_layers.bg, _layers.map);
  // fog AVANT walls : les murs/portes/lumières restent toujours lisibles au-dessus du brouillard.
  frontLayer.add(_layers.fog, _layers.walls, _layers.mapFg, _layers.ping);
  _stage.add(backLayer, _layers.grid, _layers.draw, _layers.token, frontLayer);
  fogInit(_stage, _layers, CELL);
  fogSetPgRef(id => _pgRef(id));

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
    borderStroke: '#ffe600', borderStrokeWidth: 2, borderDash: [4, 3],
    anchorStroke: '#ffe600', anchorFill: '#1a1a2e', anchorSize: 13, anchorCornerRadius: 3,
    rotateAnchorOffset: 26, padding: 5,
    rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315], rotationSnapTolerance: 8,
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
    else if (!wp && _rulerHoverDot) _hideRulerHover();

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
    if (fogIsEditMode()) return; // éditeur de murs gère ses propres events
    if (e.evt.button===2) {
      e.evt.preventDefault();
      // Règle : clic droit = annulation immédiate (en cours ou figée), sans changer d'outil.
      if (_tool === 'ruler' && (_rulerActive || _rulerNodes)) {
        _clearRuler();
        _rightStageDown = null;
        return;
      }
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
      // Dessin : cliquer-glisser. Gomme : supprime au survol pressé.
      if (_tool === 'draw') {
        if (_pingTimer) { clearTimeout(_pingTimer); _pingTimer = null; }
        if (_drawShape === 'eraser') { _erasing = true; _eraseAtPointer(); return; }
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
    else if (_tool === 'ruler')                 _showRulerHover(wp);
    if (_tool === 'draw'  && _drawShape === 'eraser' && _erasing && !_pan) _eraseAtPointer();
    else if (_tool === 'draw' && _drawing && !_pan) _updateDraw(wp);
    if (_zoneCtx) _zoneUpdatePreview(wp);
  });
  _stage.on('mouseup', () => {
    _pan = false;
    _erasing = false;
    if (_pingTimer) { clearTimeout(_pingTimer); _pingTimer = null; }
    if (_marqueeActive) { _endMarquee(); _suppressNextClick = true; }
    _marqueeOrigin = null;
    if (_tool === 'draw' && _drawing) _endDraw();
  });
  _stage.on('contextmenu', e => {
    e.evt.preventDefault();
    if (e.target !== _stage) return;
    if (_tool === 'ruler') return; // clic droit en mode règle = annulation, pas de désélection
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
      if (_selfCtx) return; // placement déplacement actif : clic hors case = ne rien faire
      if (_zoneCtx) { _zoneCtx.placed = !_zoneCtx.placed; return; }
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
  if (_pm0!=null) {
    const pmMax0=ld.displayPmMax??1, pmRat0=pmMax0>0?Math.min(1,Math.max(0,_pm0/pmMax0)):1;
    const PMH=8;
    g.add(new K.Rect({ x:-bW/2, y:r+BH+6, width:bW, height:PMH, fill:'#0d1117', cornerRadius:4, listening:false }));
    g.add(new K.Rect({ x:-bW/2, y:r+BH+6, width:Math.max(2,bW*pmRat0), height:PMH, fill:'#9b6dff', cornerRadius:4, listening:false, name:'pm-fill' }));
    g.add(new K.Text({ x:-bW/2, y:r+BH+6, width:bW, height:PMH, align:'center', verticalAlign:'middle',
      text:`✨${_pm0}/${pmMax0}`, fontSize:7, fontStyle:'bold', fill:'#fff',
      shadowColor:'#000', shadowBlur:2, shadowOpacity:.9,
      fontFamily:'Inter,sans-serif', listening:false, name:'pm-val' }));
    _lblY=r+BH+PMH+10;
  }
  // ── Badge CA (coin haut-droit) + indicateur buff ─────────────────
  const _buff = ld._activeCaBuff;
  const _buffed = !!_buff;
  const _round  = _session?.combat?.round ?? 0;
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
  const _condRound = _session?.combat?.round ?? 0;
  const _activeConditions = (t.conditions || []).filter(c =>
    c.expiresAtRound == null || _condRound === 0 || _condRound <= c.expiresAtRound
  );
  if (_activeConditions.length) {
    const maxShow = 4;
    const display = _activeConditions.slice(0, maxShow);
    const overflow = _activeConditions.length - display.length;
    display.forEach((cond, i) => {
      const lib = CONDITION_BY_ID[cond.id] || { icon: '❓', color: '#888' };
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
  const _buffsRound = _session?.combat?.round ?? 0;
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
      clipGrp.zIndex(2); _layers.token.batchDraw();
    };
    el.src = imgSrc;
    g.add(clipGrp); clipGrp.zIndex(2);
  }

  const canDrag = _canControlToken(t);
  let rightDown = null;
  if (canDrag) {
    g.draggable(true);
    g.on('mousedown', e => {
      if (e.evt.button === 2) rightDown = { x:e.evt.clientX, y:e.evt.clientY, dragged:false };
    });
    // ─ Début du drag : mémoriser les positions du groupe ─
    g.on('dragstart', () => {
      if (rightDown) rightDown.dragged = true;
      // En mode placement de zone ou de ciblage multi-cibles : pas de déplacement de token
      // (le sort doit rester prioritaire — un drag accidentel ne déplace pas le PJ)
      if (_zoneCtx || _mtCtx) {
        g.stopDrag();
        g.position({ x:t.col*CELL+sw*CELL/2, y:t.row*CELL+sh*CELL/2 });
        _layers.token?.batchDraw();
        return;
      }
      if (_middlePanActive) {
        g.stopDrag();
        g.position({ x:t.col*CELL+sw*CELL/2, y:t.row*CELL+sh*CELL/2 });
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
      const sx=Math.round((g.x()-sw*CELL/2)/CELL)*CELL+sw*CELL/2;
      const sy=Math.round((g.y()-sh*CELL/2)/CELL)*CELL+sh*CELL/2;
      g.position({x:sx,y:sy});
      if (_multiDragOrigin && _selectedMulti.has(t.id)) {
        const dx=sx-_multiDragOrigin[t.id].x, dy=sy-_multiDragOrigin[t.id].y;
        for (const [id,orig] of Object.entries(_multiDragOrigin)) {
          if (id===t.id) continue;
          const s=_tokens[id]?.shape; if (!s) continue;
          const d2=_tokenDims(_tokens[id].data);
          s.position({
            x:Math.round((orig.x+dx-d2.w*CELL/2)/CELL)*CELL+d2.w*CELL/2,
            y:Math.round((orig.y+dy-d2.h*CELL/2)/CELL)*CELL+d2.h*CELL/2,
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
          const d2=_tokenDims(_tokens[id].data);
          const nc=Math.max(0,Math.min(pg.cols-d2.w,Math.round((s.x()-d2.w*CELL/2)/CELL)));
          const nr=Math.max(0,Math.min(pg.rows-d2.h,Math.round((s.y()-d2.h*CELL/2)/CELL)));
          s.position({x:nc*CELL+d2.w*CELL/2,y:nr*CELL+d2.h*CELL/2});
          batch.update(_tokRef(id),{col:nc,row:nr});
        }
        _layers.token.batchDraw();
        await batch.commit().catch(()=>showNotif('Erreur déplacement groupe','error'));
        _multiDragOrigin=null; return;
      }
      // Token seul
      const c=Math.max(0,Math.min(pg.cols-sw,Math.round((g.x()-sw*CELL/2)/CELL)));
      const r=Math.max(0,Math.min(pg.rows-sh,Math.round((g.y()-sh*CELL/2)/CELL)));
      if (!STATE.isAdmin && _session?.combat?.active) {
        const cur=_tokens[t.id]?.data;
        if (cur) {
          const d=Math.abs(c-cur.col)+Math.abs(r-cur.row);
          const maxMvt=(_live(cur).displayMovement??6)+(cur.bonusMvt||0);
          const rem=maxMvt-(cur.movedCells||0);
          if (d > rem) {
            showNotif(rem<=0 ? 'Plus de mouvement ce tour !' : `Trop loin ! (${rem} case${rem!==1?'s':''} restante${rem!==1?'s':''})`, 'error');
            g.position({x:cur.col*CELL+sw*CELL/2,y:cur.row*CELL+sh*CELL/2}); _layers.token.batchDraw(); return;
          }
        }
      }
      // Blocage par les murs (joueurs seulement)
      if (!STATE.isAdmin && (_activePage?.walls||[]).length) {
        const cur=_tokens[t.id]?.data;
        if (cur && fogWallBlocksPath(cur.col, cur.row, c, r, _activePage.walls)) {
          showNotif('🧱 Chemin bloqué !', 'error');
          g.position({x:cur.col*CELL+sw*CELL/2,y:cur.row*CELL+sh*CELL/2}); _layers.token.batchDraw(); return;
        }
      }
      g.position({x:c*CELL+sw*CELL/2,y:r*CELL+sh*CELL/2}); _layers.token.batchDraw();
      const patch={col:c,row:r};
      if (!STATE.isAdmin&&_session?.combat?.active) {
        const cur=_tokens[t.id]?.data;
        const d=Math.abs(c-(cur?.col??c))+Math.abs(r-(cur?.row??r));
        patch.movedCells=(cur?.movedCells||0)+d;
        patch.movedThisTurn=true;
      }
      await updateDoc(_tokRef(t.id),patch).catch(()=>showNotif('Erreur déplacement','error'));
      // Mise à jour optimiste + refresh des zones (déplacement et attaque)
      const _entry=_tokens[t.id];
      if (_entry?.data) {
        _entry.data.col=c; _entry.data.row=r;
        if (patch.movedCells!==undefined)   _entry.data.movedCells=patch.movedCells;
        if (patch.movedThisTurn!==undefined) _entry.data.movedThisTurn=patch.movedThisTurn;
      }
      _refreshRanges(t.id, _entry?.data);
      fogUpdateSoon(_activePage, _tokens, STATE.isAdmin);
    });
  }

  const _isAttackTargetInRange = (srcId, tgtId) => {
    const src = _tokens[srcId]?.data;
    const tgt = _tokens[tgtId]?.data;
    if (!src || !tgt) return false;
    const options = _buildAttackOptions(src);
    if (options.some(o => _tokenAttackDistance(src, tgt, o.portee) <= o.portee)) return true;
    const dist = _tokenAttackDistance(src, tgt);
    const maxRange = options.length ? Math.max(...options.map(o => o.portee)) : 0;
    showNotif(`Hors de portée (${dist} case${dist>1?'s':''}, portée max ${maxRange})`, 'error');
    return false;
  };

  const handleTokenAction = (e, opts = {}) => {
    e.cancelBubble = true;
    if (_tool === 'ruler' || _tool === 'draw') return; // outils de dessin ignorent les tokens
    // Si le token du joueur est masqué sous un autre token, prioriser son propre token
    // lors d'une sélection simple (sauf attaque/zone/cible multi/shift).
    if (!STATE.isAdmin && !_attackSrc && !_zoneCtx && !_mtCtx && !e.evt.shiftKey
        && t.ownerId !== STATE.user?.uid) {
      const ownId = _findOwnTokenAtPointer();
      if (ownId && ownId !== t.id) {
        _clearMultiSelect();
        _select(ownId);
        return;
      }
    }
    if (e.evt.shiftKey && _canControlToken(t)) {
      // Shift+clic : ajouter / retirer du groupe multi-sélection
      _toggleMultiSelect(t.id); return;
    }
    _clearMultiSelect();

    // Mode zone AoE actif → le clic verrouille / déverrouille le placement
    if (_zoneCtx && t.id !== _zoneCtx.srcId) {
      _zoneCtx.placed = !_zoneCtx.placed;
      return;
    }

    // Mode ciblage multi-cibles actif → basculer la cible
    if (_mtCtx && t.id !== _mtCtx.srcId) {
      _mtToggleTarget(t.id);
      return;
    }

    if (_attackSrc) {
      // Attaquant désigné → clic sur n'importe quel token (y compris soi-même) = attaque/soin
      // Vérification portée uniquement pour les cibles différentes
      if (_attackSrc !== t.id && opts.deselectOutOfRange && !_isAttackTargetInRange(_attackSrc, t.id)) {
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
  // Garde-fou : un token d'une autre page (ou en réserve) n'a rien à dessiner
  // sur le calque courant. Sans ça, un patch (ex. édition PV/PM d'un perso ayant
  // un token sur une autre page) ré-ajoute son shape — détruit mais encore
  // référencé — au calque actif → des tokens d'une autre page « apparaissent ».
  if (e.data.pageId !== _activePage?.id) return;
  const ld=_live(e.data); const g=e.shape;
  const hasPmBar   = !!g.findOne('.pm-val');
  const hasCaBuff  = !!g.findOne('.ca-buff-turns');
  const needsCaBuff = !!ld._activeCaBuff;
  const sw = ld.displayTokenW || 1, sh = ld.displayTokenH || 1;
  // Si la taille a changé (modif bestiaire ou override), reconstruire
  const sizeMismatch = (g.getAttr('tokenW') || 1) !== sw || (g.getAttr('tokenH') || 1) !== sh;
  // Un token peut être construit avant le chargement de sa fiche liée (bestiaire,
  // PNJ, personnage). Quand son image effective arrive ensuite, il faut rebâtir
  // la forme Konva ; un simple patch des textes/barres laisse le cercle coloré.
  const imageMismatch = (g.getAttr('displayImage') || null) !== (ld.displayImage || null);
  // Conditions : si le nombre d'états actifs change, reconstruire (badges canvas)
  const _condRoundP = _session?.combat?.round ?? 0;
  const _activeCondCount = (e.data.conditions || []).filter(c =>
    c.expiresAtRound == null || _condRoundP === 0 || _condRoundP <= c.expiresAtRound
  ).length;
  const _renderedCondCount = g.find('.cond-ic').length;
  const condMismatch = _activeCondCount !== _renderedCondCount;
  // Buffs : pareil que les conditions, on regarde le compteur affiché vs actif
  const _activeBuffCount = (e.data.buffs || []).filter(b =>
    b.expiresAtRound == null || _condRoundP === 0 || _condRoundP <= b.expiresAtRound
  ).length;
  const _renderedBuffCount = g.find('.buff-ic').length;
  const buffMismatch = _activeBuffCount !== _renderedBuffCount;
  if ((ld.displayPm != null) !== hasPmBar || hasCaBuff !== needsCaBuff || sizeMismatch || imageMismatch || condMismatch || buffMismatch) {
    const shape = _buildShape(e.data);
    g.destroy();
    _tokens[id] = { ...e, shape };
    _layers.token?.add(shape);
    if (_selected === id) shape.findOne('.sel')?.visible(true);
    if (_attackSrc === id) shape.findOne('.atk')?.visible(true);
    _layers.token?.batchDraw();
    return;
  }
  g.to({ x:e.data.col*CELL+sw*CELL/2, y:e.data.row*CELL+sh*CELL/2, duration:0.12 });
  const hpKnownU = ld.displayHp !== null && ld.displayHpMax !== null;
  const hp=hpKnownU?ld.displayHp:0, hpm=hpKnownU?ld.displayHpMax:1;
  const rat=hpKnownU?(hpm>0?Math.min(1,Math.max(0,hp/hpm)):1):0.5, bW=CELL*sw*0.9;
  const fill=g.findOne('.hp-fill');
  if (fill){fill.width(bW*rat);fill.fill(hpKnownU?hpColor(rat):'#555');}
  g.findOne('.hp-val')?.text(hpKnownU?`${hp}/${hpm}`:'?/?');
  // PM
  const _pm=ld.displayPm;
  if (_pm!=null) {
    const pmMax=ld.displayPmMax??1, pmRat=pmMax>0?Math.min(1,Math.max(0,_pm/pmMax)):1;
    g.findOne('.pm-fill')?.width(bW*pmRat);
    g.findOne('.pm-val')?.text(`✨${_pm}/${pmMax}`);
  }
  // CA + buff
  const _buff   = ld._activeCaBuff;
  const _buffed = !!_buff;
  const _round  = _session?.combat?.round ?? 0;
  g.findOne('.ca-lbl')?.text(`🛡${ld.caBadge ?? (ld.displayDefense??0)}`);
  g.findOne('.ca-lbl')?.fill(_buffed ? '#c4b5fd' : '#e2e8f0');
  g.findOne('.ca-bg')?.stroke(_buffed ? '#818cf8' : '#64748b');
  g.findOne('.ca-bg')?.strokeWidth(_buffed ? 2.5 : 1.5);
  g.findOne('.ca-bg')?.fill(_buffed ? 'rgba(30,27,80,0.95)' : 'rgba(15,15,25,0.9)');
  if (_buff) {
    const tl = _buff.expiresAtRound != null && _round > 0 ? _buff.expiresAtRound - _round + 1 : _buff.totalDuration ?? '∞';
    g.findOne('.ca-buff-turns')?.text(`${tl}↺`);
  }
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
  if (data && _canControlToken(data)) {
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
  const K=window.Konva, ld=_live(t);
  const inCombat = !!_session?.combat?.active;
  const maxMvt = (ld.displayMovement??6) + (t.bonusMvt||0);
  const mv = (inCombat && !STATE.isAdmin) ? Math.max(0, maxMvt - (t.movedCells||0)) : (ld.displayMovement??6);
  const sw = ld.displayTokenW || 1, sh = ld.displayTokenH || 1;
  const {cols,rows}=_activePage;
  // Pas de check collision : le drag & drop laisse passer, l'affichage doit faire pareil.
  for (let dc=-mv;dc<=mv;dc++) for (let dr=-mv;dr<=mv;dr++) {
    if (Math.abs(dc)+Math.abs(dr)>mv) continue;
    const c=t.col+dc,r=t.row+dr;
    if (c<0||r<0||c+sw>cols||r+sh>rows||(!dc&&!dr)) continue;
    const rect=new K.Rect({ x:c*CELL,y:r*CELL,width:CELL,height:CELL,
      fill:'rgba(79,140,255,0.28)', stroke:'rgba(79,140,255,0.70)', strokeWidth:1.5, listening:true });
    const tc=c, tr=r;
    const moveSelectedHere = async e => {
      // En mode placement de zone ou de ciblage multi-cibles : le sort est prioritaire
      // on bascule placed pour zone et on annule le déplacement
      if (_zoneCtx) {
        e.cancelBubble = true;
        _zoneCtx.placed = !_zoneCtx.placed;
        return;
      }
      if (_mtCtx) { e.cancelBubble = true; return; }
      e.cancelBubble = true;
      if (_selected) await _moveTo(_selected, tc, tr);
    };
    rect.on('click', e => { if (e.evt.button!==0) return; moveSelectedHere(e); });
    rect.on('contextmenu', e => { e.evt.preventDefault(); moveSelectedHere(e); });
    _layers.grid.add(rect); _moveHL.push(rect);
  }
  _layers.grid.batchDraw();
}
function _clearHL() { _moveHL.forEach(r=>r.destroy()); _moveHL=[]; _layers.grid?.batchDraw(); }

/**
 * Refresh immédiat des zones de déplacement + attaque du token sélectionné.
 * Appeler après chaque commit de mouvement pour garder l'interface active.
 * @param {string} id - token id
 * @param {object} [overrideData] - données à jour si l'objet Firestore n'est pas encore mis à jour
 */
function _refreshRanges(id, overrideData) {
  if (!id || id !== _selected) { _clearHL(); return; }
  const data = overrideData ?? _tokens[id]?.data;
  if (!data) { _clearHL(); return; }
  if (!_canControlToken(data)) { _clearHL(); return; }
  _showMoveRange(data);   // _clearHL() est appelé en tête de _showMoveRange
  _showAttackRange(data);
  _renderInspector(data); // actualise les compteurs (mouvement restant, etc.)
}

// ── Pings ────────────────────────────────────────────────────────────
async function _emitPing(wx, wy) {
  const uid = STATE.user?.uid; if (!uid || !_activePage) return;
  const authorName = STATE.profile?.pseudo || STATE.profile?.prenom || 'Joueur';
  const color = '#ffe600'; // jaune néon — visible sur toutes les cartes
  try {
    await setDoc(_pingRef(uid), {
      x: wx, y: wy, pageId: _activePage.id,
      authorName, color, createdAt: serverTimestamp(),
    }, { merge: true });
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
// Dispatcher : émote ancrée au-dessus du token émetteur si présent sur la page
// active (rendu Konva en coords monde → suit pan/zoom), sinon bulle de repli
// dans le coin du canvas.
function _showEmoteBubble(tokenId, emoteUrl, emoteName, key) {
  if (_renderedReactions.has(key)) return;
  _renderedReactions.add(key);
  // purge mémoire douce (évite la croissance infinie du Set sur longue session)
  if (_renderedReactions.size > 400) _renderedReactions.clear();

  const e = tokenId ? _tokens[tokenId] : null;
  if (e?.data && e.shape && e.data.pageId === _activePage?.id && _layers.ping && window.Konva) {
    _spawnTokenEmote(e.data, emoteUrl, emoteName);
  } else {
    _spawnCornerEmote(emoteUrl, emoteName);
  }
}

// Émote ancrée : pop-in élastique au-dessus du token, légère montée puis fondu.
function _spawnTokenEmote(t, emoteUrl, emoteName) {
  const K = window.Konva;
  const dim = _tokenDims(t);
  const cx = t.col * CELL + dim.w * CELL / 2;
  const topY = t.row * CELL;
  const D = CELL * 1.5, R = D / 2;
  const cy = topY - R * 0.95;              // centre de la bulle, au-dessus du token

  const group = new K.Group({ x: cx, y: cy, opacity: 0, scaleX: 0.2, scaleY: 0.2, listening: false });
  // Pointeur vers le token (triangle vers le bas)
  group.add(new K.Line({
    points: [-R * 0.26, R * 0.82, R * 0.26, R * 0.82, 0, R * 1.32],
    closed: true, fill: '#fff',
    shadowColor: '#000', shadowBlur: R * 0.25, shadowOpacity: 0.4, shadowOffsetY: 2,
  }));
  // Cercle blanc + ombre
  group.add(new K.Circle({
    radius: R, fill: '#fff',
    stroke: 'rgba(0,0,0,0.18)', strokeWidth: Math.max(1.5, R * 0.05),
    shadowColor: '#000', shadowBlur: R * 0.35, shadowOpacity: 0.45, shadowOffsetY: 3,
  }));
  // Image rognée en cercle
  const clip = new K.Group({ clipFunc: ctx => { ctx.arc(0, 0, R * 0.86, 0, Math.PI * 2, false); } });
  group.add(clip);
  _layers.ping.add(group);
  _layers.ping.batchDraw();

  const imgEl = new Image();
  imgEl.onload = () => {
    if (group.getStage() === null) return; // déjà détruit
    const side = R * 1.78;
    clip.add(new K.Image({ image: imgEl, width: side, height: side, x: -side / 2, y: -side / 2 }));
    _layers.ping.batchDraw();
  };
  imgEl.onerror = () => {};
  imgEl.src = emoteUrl;

  // Animation : pop élastique → settle → maintien → montée + fondu
  group.to({
    scaleX: 1.12, scaleY: 1.12, opacity: 1, duration: 0.26, easing: K.Easings.BackEaseOut,
    onFinish: () => group.to({
      scaleX: 1, scaleY: 1, duration: 0.12,
      onFinish: () => {
        group._holdTimer = setTimeout(() => {
          if (group.getStage() === null) return; // stage détruit (changement de page / sortie)
          group.to({
            y: cy - CELL * 0.9, opacity: 0, duration: 0.85, easing: K.Easings.EaseIn,
            onFinish: () => { group.destroy(); _layers.ping?.batchDraw(); },
          });
        }, 1700);
      },
    }),
  });
}

// Émote de repli (token absent de la page) : bulle qui monte dans le coin du canvas.
function _spawnCornerEmote(emoteUrl, emoteName) {
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
        width: 96px; height: 96px; border-radius: 50%;
        background: #fff;
        box-shadow: 0 6px 22px rgba(0,0,0,0.5);
        overflow: hidden;
        animation: vttEmoteRise 3.6s cubic-bezier(.22,.8,.46,1) forwards;
        pointer-events: none;
      }
      .vtt-emote-bubble img {
        width: 88px; height: 88px;
        object-fit: cover; border-radius: 50%;
        position: absolute; top: 4px; left: 4px;
      }
    `;
    document.head.appendChild(s);
  }
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
  const K = window.Konva;
  const options = _buildAttackOptions(t);
  if (!options.length) return;
  // Portée "naturelle" = celle de l'ARME du perso (option sans sortIdx et sans
  // _itemAction). C'est ce que le joueur considère comme sa portée de base, même
  // pour un grimoire portée 8. Fallback : plus courte portée si aucune arme
  // identifiable (tokens enemy/sentinelle).
  const weaponOpt = options.find(o => !o._itemAction && o.sortIdx === undefined && !o.targetSelf);
  const weaponPortee = weaponOpt ? weaponOpt.portee : Math.min(...options.map(o => o.portee));
  const { cols, rows } = _activePage;
  const sd = _tokenDims(t);

  // Métrique de distance par option : mêlée (portée=1) = Chebyshev, sinon Manhattan
  const _reachByOpt = (dx, dy, portee) =>
    (portee === 1 ? Math.max(dx, dy) : (dx + dy)) <= portee;

  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    if (c >= t.col && c < t.col + sd.w && r >= t.row && r < t.row + sd.h) continue;
    const dx = Math.max(0, Math.max(c, t.col) - Math.min(c, t.col + sd.w - 1));
    const dy = Math.max(0, Math.max(r, t.row) - Math.min(r, t.row + sd.h - 1));

    // Une case est ROUGE si elle est atteinte par l'arme principale.
    // VIOLET pointillé si elle n'est atteinte que par des sorts/actions plus longues.
    const reachedByWeapon = weaponOpt ? _reachByOpt(dx, dy, weaponPortee) : false;
    let reachedByOther = false;
    if (!reachedByWeapon) {
      for (const o of options) {
        if (o === weaponOpt) continue;
        if (_reachByOpt(dx, dy, o.portee)) { reachedByOther = true; break; }
      }
    }
    if (!reachedByWeapon && !reachedByOther) continue;

    const isPrimary = reachedByWeapon;
    const rect = isPrimary
      // Portée principale (arme / attaque immédiate) — rouge plein
      ? new K.Rect({ x:c*CELL, y:r*CELL, width:CELL, height:CELL,
          fill:'rgba(239,68,68,0.22)', stroke:'rgba(239,68,68,0.65)',
          strokeWidth:1.5, listening:false })
      // Portée étendue (sorts / actions longue distance uniquement) — violet pointillé
      : new K.Rect({ x:c*CELL, y:r*CELL, width:CELL, height:CELL,
          fill:'rgba(167,139,250,0.10)', stroke:'rgba(167,139,250,0.55)',
          strokeWidth:1.2, dash:[6,4], listening:false });
    _layers.grid.add(rect); _moveHL.push(rect);
  }
  _layers.grid.batchDraw();
}
async function _moveTo(id, col, row) {
  const cur = _tokens[id]?.data;
  // Blocage par les murs (joueurs seulement)
  if (!STATE.isAdmin && (_activePage?.walls||[]).length) {
    if (cur && fogWallBlocksPath(cur.col, cur.row, col, row, _activePage.walls)) {
      showNotif('🧱 Chemin bloqué !', 'error');
      return;
    }
  }
  // Limite de mouvement en combat (joueurs seulement)
  if (!STATE.isAdmin && _session?.combat?.active && cur) {
    const d = Math.abs(col - cur.col) + Math.abs(row - cur.row);
    const maxMvt = (_live(cur).displayMovement ?? 6) + (cur.bonusMvt || 0);
    const rem = maxMvt - (cur.movedCells || 0);
    if (d > rem) {
      showNotif(rem <= 0 ? 'Plus de mouvement ce tour !' : `Trop loin ! (${rem} case${rem!==1?'s':''} restante${rem!==1?'s':''})`, 'error');
      return;
    }
  }
  const patch = {col, row};
  if (!STATE.isAdmin && _session?.combat?.active && cur) {
    const d = Math.abs(col - cur.col) + Math.abs(row - cur.row);
    patch.movedCells = (cur.movedCells || 0) + d;
    patch.movedThisTurn = true;
  }
  await updateDoc(_tokRef(id), patch).catch(() => showNotif('Déplacement refusé', 'error'));

  // Mise à jour optimiste : ne pas attendre le snapshot Firestore pour rafraîchir les zones
  const entry = _tokens[id];
  if (entry?.data) {
    entry.data.col = col;
    entry.data.row = row;
    if (patch.movedCells  !== undefined) entry.data.movedCells  = patch.movedCells;
    if (patch.movedThisTurn !== undefined) entry.data.movedThisTurn = patch.movedThisTurn;
  }
  _refreshRanges(id, entry?.data);
}

// ═══════════════════════════════════════════════════════════════════
// ATTAQUE — sélection arme/sort puis confirmation
// ═══════════════════════════════════════════════════════════════════

/** Parse "2d6+3", "1d8", "1d4-1" → lance et retourne le total. */
// Parse "NdM[+K]" ou nombre fixe → { n, sides, mod } ou null si non-formule.
function _parseDice(formula) {
  if (!formula) return null;
  // Tolère les espaces autour du +/- (ex: "1d4 +2", "2d6 + 3", "1d4-2")
  const cleaned = String(formula).replace(/\s+/g, '');
  const m = cleaned.match(/^(\d+)[dD](\d+)([+-]\d+)?$/);
  return m ? { n:+m[1], sides:+m[2], mod:+(m[3]||0) } : null;
}

function _rollDice(formula) {
  const p = _parseDice(formula);
  if (!p) return Math.max(1, parseInt(formula)||1);
  let total = 0;
  for (let i=0; i<p.n; i++) total += Math.floor(Math.random()*p.sides)+1;
  return total + p.mod;
}
/** Variante détaillée : retourne aussi les rolls individuels et le mod.
 *  Utile pour afficher "1d4(3) +2 = 5" dans les logs. */
function _rollDiceDetailed(formula) {
  const p = _parseDice(formula);
  if (!p) {
    const flat = Math.max(0, parseInt(formula)||0);
    return { rolls: [], mod: flat, total: flat, n: 0, sides: 0, formula: String(formula) };
  }
  const rolls = [];
  for (let i=0; i<p.n; i++) rolls.push(Math.floor(Math.random()*p.sides)+1);
  const total = rolls.reduce((a,b)=>a+b, 0) + p.mod;
  return { rolls, mod: p.mod, total, n: p.n, sides: p.sides, formula: String(formula) };
}

/** Valeur maximale possible d'une formule de dés (ex: "2d6+3" → 15). */
function _maxDice(formula) {
  const p = _parseDice(formula);
  return p ? p.n * p.sides + p.mod : Math.max(1, parseInt(formula)||1);
}

/**
 * Formule de dégâts calculée d'un sort offensif.
 * Miroir local de _calcSortDegats (spells.js) — évite le cross-import.
 * Inclut : dés de base + runes Puissance + maîtrise arme principale.
 */
function _vttSortDmgFormula(s, c, opts = {}) {
  // ⚠️ Utiliser getMainWeapon(c) pour récupérer le Poings (2d4) par défaut
  // si aucune arme principale équipée — aligne avec _calcSortDegats du sheet.
  const mainP   = c ? getMainWeapon(c) : null;
  const armeDeg = mainP?.degats || DEFAULT_UNARMED.degats;
  let base = (s.degats || '').trim();
  if (!base || base.toLowerCase() === '= arme') base = armeDeg;
  const runes    = s.runes || [];
  const nbPuiss  = opts.includePower === false ? 0 : runes.filter(r => r === 'Puissance').length;
  // Seule la Puissance ajoute des dés. La Protection ne sert qu'au drain % — elle
  // NE double PAS les dégâts (bug : le combo Drain affichait 2d10 au lieu de 1d10).
  // Aligne strictement avec _calcSortDegats du sheet.
  const maitrise = getMaitriseBonus(c, mainP || {});
  const m = base.match(/^(\d+)(d\d+)(.*)$/i);
  if (m) {
    let r = `${parseInt(m[1]) + nbPuiss}${m[2]}${m[3]}`;
    if (maitrise > 0) r += ` +${maitrise}`; else if (maitrise < 0) r += ` ${maitrise}`;
    return r;
  }
  let r = base;
  if (nbPuiss > 0) r += ` +${nbPuiss}d6`;
  if (maitrise > 0) r += ` +${maitrise}`; else if (maitrise < 0) r += ` ${maitrise}`;
  return r;
}

/**
 * Formule de soin calculée d'un sort défensif (mode soin).
 * Miroir local de _calcSortSoin (spells.js).
 * Inclut : 1d4 base + runes Protection + maîtrise + mod de stat.
 * Stat utilisée :
 *  - Noyau magique avec arme magique équipée → stat d'attaque de l'arme
 *  - Noyau magique sans arme magique (Poings) → Intelligence
 *  - Noyau physique / pas de noyau → Constitution
 */
function _vttSortSoinFormula(s, c) {
  // Aligne sur le sheet : getMainWeapon retourne Poings par défaut si vide.
  const mainP    = c ? getMainWeapon(c) : null;
  const maitrise = getMaitriseBonus(c, mainP || {});
  const runes    = s.runes || [];
  const nbProt   = runes.filter(r => r === 'Protection').length;
  const base     = (s.soin || '').trim();

  // Détermine la stat de soin :
  //  - Override explicite du sort (s.degatsStat) → priorité absolue
  //  - Sinon auto selon la nature du noyau (magique vs physique)
  let statKey;
  if (s?.degatsStat) {
    statKey = s.degatsStat;
  } else {
    const dmgTypes = _damageTypes;
    const noyauTypeId = s?.noyauTypeId;
    const isMagic = !!(dmgTypes && noyauTypeId && dmgTypes.find(x => x.id === noyauTypeId)?.isMagic);
    statKey = 'constitution';
    if (isMagic) {
      const fmt = _weaponFormats?.find(f => f.label === mainP?.format);
      // Les Poings par défaut (isDefault) ne sont pas une arme magique
      const isMagicWeapon = fmt?.isMagic === true && mainP?.nom && !mainP?.isDefault;
      statKey = isMagicWeapon ? (mainP.statAttaque || mainP.toucherStat || 'intelligence') : 'intelligence';
    }
  }
  // Stat 'none' : aucun modificateur de carac (potion à valeur fixe, etc.)
  // Dans ce cas on n'ajoute NI la stat NI la maîtrise → effet 100% fixe.
  const noStatMod = statKey === 'none';
  const statMod = noStatMod ? 0 : (c ? getMod(c, statKey) : 0);
  const effectiveMaitrise = noStatMod ? 0 : maitrise;

  const totalFlat = effectiveMaitrise + statMod;
  const flatStr = totalFlat > 0 ? ` +${totalFlat}` : totalFlat < 0 ? ` ${totalFlat}` : '';
  if (!base || base.toLowerCase() === '= base') {
    return `${1 + nbProt}d4${flatStr}`;
  }
  if (nbProt > 0) {
    const m = base.match(/^(\d+)(d\d+)(.*)$/i);
    if (m) {
      return `${parseInt(m[1]) + nbProt}${m[2]}${m[3]}${flatStr}`;
    }
    return base;
  }
  return flatStr ? base + flatStr : base;
}

/** Parse le bonus CA numérique depuis la chaîne libre (ex: "CA +2 (2 tours)" → 2). */
function _parseCaBonus(caStr) {
  const m = (caStr || '+2').match(/([+-]?\d+)/);
  return m ? (parseInt(m[1]) || 2) : 2;
}

const _sortDureeVtt = calcSpellDuration;
const _vttSortCibles = calcSpellTargets;

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

// Métadonnées d'affichage des interactions de dégâts (icône, couleur, label).
// Palette neutre côté attaquant : aucune couleur ne sous-entend "bon / mauvais"
// pour ne pas tromper le joueur (la valeur ½ / ×2 / 0 / +N reste la source
// de lecture).
// Dimensions du token en cases (W × H). Compat : si seul tokenSize est défini, on l'applique aux deux.
const _tokenDims = t => {
  const b = t?.beastId ? _bestiary[t.beastId] : null;
  const w = t?.tokenW ?? t?.tokenSize ?? b?.tokenW ?? b?.tokenSize ?? 1;
  const h = t?.tokenH ?? t?.tokenSize ?? b?.tokenH ?? b?.tokenSize ?? 1;
  return { w: Math.max(1, Math.min(5, w)), h: Math.max(1, Math.min(5, h)) };
}

// Cherche un token possédé par le joueur courant couvrant la position du pointeur.
// Sert à débloquer la sélection quand le token du joueur est masqué sous un autre.
function _findOwnTokenAtPointer() {
  const uid = STATE.user?.uid; if (!uid || !_stage) return null;
  const pos = _stage.getPointerPosition(); if (!pos) return null;
  const w = _stageToWorld(pos);
  const cx = Math.floor(w.x / CELL), cy = Math.floor(w.y / CELL);
  for (const [id, entry] of Object.entries(_tokens)) {
    const d = entry?.data; if (!d || d.ownerId !== uid) continue;
    const dim = _tokenDims(d);
    if (cx >= d.col && cx < d.col + dim.w && cy >= d.row && cy < d.row + dim.h) return id;
  }
  return null;
}
// Distance d'attaque entre bounding boxes WxH (0 = adjacent / chevauchement de côté).
// portee === 1 (mêlée) → Chebyshev (8 directions, inclut diagonales).
// portee > 1 ou non précisé → Manhattan (losange, 4 directions).
const _tokenAttackDistance = (src, tgt, portee = null) => {
  const s = _tokenDims(src), g = _tokenDims(tgt);
  const dx = Math.max(0, Math.max(src.col, tgt.col) - Math.min(src.col + s.w - 1, tgt.col + g.w - 1));
  const dy = Math.max(0, Math.max(src.row, tgt.row) - Math.min(src.row + s.h - 1, tgt.row + g.h - 1));
  return portee === 1 ? Math.max(dx, dy) : dx + dy;
}

const VTT_ACTION_RUNE = 'Déclenchement';

function _vttAmpDispCircleSize(nbAmp, nbDisp) {
  const rank = Math.min(parseInt(nbAmp) || 0, parseInt(nbDisp) || 0);
  return rank >= 1 ? (4 * rank - 1) : 0;
}

function _vttSpellActionMode(s) {
  const runes = s?.runes || [];
  if (runes.includes(VTT_ACTION_RUNE) && (s?.actionMode === 'reaction' || s?.actionMode === 'action_bonus')) return s.actionMode;
  if (runes.includes('Réaction')) return 'reaction';
  if (runes.includes('Action Bonus')) return 'action_bonus';
  return 'action';
}

function _vttDisplayRunes(runes = []) {
  let hasActionRune = false;
  const out = [];
  runes.forEach(r => {
    if (r === 'Réaction' || r === 'Action Bonus' || r === VTT_ACTION_RUNE) {
      if (!hasActionRune) out.push(VTT_ACTION_RUNE);
      hasActionRune = true;
      return;
    }
    out.push(r);
  });
  return out;
}

/**
 * Détecte les modificateurs spéciaux d'un sort (combos, lacération, chance, déplacement…).
 * Miroir local des helpers de spells.js — évite cross-import features/characters.
 * Renvoie null si aucun mod actif, sinon un objet avec les flags pertinents.
 */
function _vttSpellMods(s) {
  if (!s) return null;
  const runes = s.runes || [];
  const counts = {};
  runes.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  if ((counts[VTT_ACTION_RUNE] || 0) > 0) {
    if (_vttSpellActionMode(s) === 'reaction') counts.Réaction = Math.max(counts.Réaction || 0, counts[VTT_ACTION_RUNE]);
    if (_vttSpellActionMode(s) === 'action_bonus') counts['Action Bonus'] = Math.max(counts['Action Bonus'] || 0, counts[VTT_ACTION_RUNE]);
  }
  const nbP    = counts.Puissance     || 0;
  const nbProt = counts.Protection    || 0;
  const nbLac  = counts.Lacération    || 0;
  const nbCh   = counts.Chance        || 0;
  const nbReac = counts.Réaction      || 0;
  const nbEnch = counts.Enchantement  || 0;
  const nbInv  = counts.Invocation    || 0;
  const nbAff  = counts.Affliction    || 0;
  const nbAmp  = counts.Amplification || 0;
  const nbDur  = counts.Durée         || 0;
  const nbConc = counts.Concentration || 0;
  const nbDisp = counts.Dispersion    || 0;
  const protMode = s.protectionMode || 'ca';
  // Lacération = branche d'Affliction (afflictionMode='laceration') · legacy = ancienne rune
  const isLacMode = s.afflictionMode === 'laceration' && nbAff > 0;
  const lacCount  = nbLac + (isLacMode ? nbAff : 0);
  // Sentinelle = Affliction (toute branche) + Invocation → la branche est absorbée,
  // pas de Lacération directe du lanceur (l'affliction est portée par la sentinelle).
  const isSentinelle = nbAff > 0 && nbInv > 0;
  // Bonus chiffré d'un enchantement non-dégâts (toucher/déplacement/CA) :
  // valeur saisie sinon auto = 2 + Puissance.
  const _enchBonus = Number.isFinite(parseInt(s.enchantBonus)) ? parseInt(s.enchantBonus) : (2 + nbP);

  // Stats propres de la Sentinelle (combo Affliction + Invocation)
  const sentinelDice  = 1 + nbP;
  const sentinelDmg   = `${sentinelDice}d4`;
  const sentinelHp    = 10 + 5 * nbProt;
  const sentinelCa    = 10 + 2 * nbProt;
  const sentinelRangeM = nbAmp === 0 ? 1 : (3 * nbAmp);

  const mods = {
    // Drain : sort OFFENSIF (attaque de base) + Protection → soigne le lanceur
    // d'un % des dégâts, plafonné à l'exécution par la frappe de base hors Puissance.
    // Puissance non requise ; mode CA/Soin hors-sujet.
    // Formule : 25% + 25% × nbProt → Prot×1=50% · ×2=75% · ×3=100%
    drain: (nbProt > 0 && (s.types || []).includes('offensif'))
      ? { pct: 0.25 + 0.25 * nbProt, nbProt } : null,
    // Lacération (branche d'Affliction) : -CA brut sur la cible, -1 par rune
    // Affliction (plafonné en jeu : 2 joueur · 4 élite/boss).
    // Neutralisée si combo Sentinelle (Affliction + Invocation) : portée par la sentinelle.
    laceration: (lacCount > 0 && !isSentinelle)
      ? { runes: lacCount, reduction: lacCount, max: 2, maxElite: 4 } : null,
    // Chance : étend la plage critique, plafonné à RC 17-20.
    chance: nbCh > 0
      ? { rc: Math.max(17, 20 - nbCh) } : null,
    // Concentration : chaque rune supplémentaire facilite le JS de maintien.
    concentration: nbConc > 0
      ? { dd: Math.max(5, 11 - 2 * (nbConc - 1)), runes: nbConc } : null,
    // Déplacement (rune Amplification en mode déplacement) : soi / pousse / attire.
    // Portée = 3N cases. Sous-mode dans s.deplacement.mode.
    deplacement: (s.ampMode === 'deplacement' && nbAmp > 0)
      ? { mode: s.deplacement?.mode || 'self', cells: Math.max(1, 3 * nbAmp) }
      : null,
    // Allonge magique : Ench + Amp + slot arme → portée étendue (au lieu d'une zone)
    allonge: (nbEnch > 0 && nbAmp > 0 && (s.enchantSlot || 'arme') === 'arme')
      ? { meters: 3 * nbAmp, cells: Math.ceil((3 * nbAmp) / CELL_M) } : null,
    // Enchantement mode Dégâts : bonus dégâts sur les attaques d'arme de l'allié
    // Formule auto : (1+Puiss)d4 +2 — appliquée pendant la durée du sort
    // ⚠️ Absorbé par le combo Arme invoquée (Ench + Inv) → on ne le déclenche pas alors
    enchantArmeDmg: (nbEnch > 0 && nbInv === 0
                     && (s.enchantMode || 'dmg') === 'dmg'
                     && (s.enchantSlot || 'arme') === 'arme')
      ? {
          formula: (s.enchantDegats || '').trim() || `${1 + nbP}d4 +2`,
          element: s.noyauTypeId || null,
          nbCibles: nbEnch,
        } : null,
    // Enchantement mode État : applique l'état choisi directement à l'allié
    enchantEtatId: (nbEnch > 0 && nbInv === 0 && s.enchantMode === 'etat')
      ? (s.enchantEtatId || null) : null,
    enchantStatePower: (nbEnch > 0 && nbInv === 0 && s.enchantMode === 'etat')
      ? nbP : 0,
    enchantStateAmplification: (nbEnch > 0 && nbInv === 0 && s.enchantMode === 'etat')
      ? nbAmp : 0,
    enchantStateMoveBonus: (nbEnch > 0 && nbInv === 0 && s.enchantMode === 'etat' && Number.isFinite(parseInt(s.enchantStateMoveBonus)))
      ? parseInt(s.enchantStateMoveBonus) : null,
    enchantStateDmgFormula: (nbEnch > 0 && nbInv === 0 && s.enchantMode === 'etat')
      ? ((s.enchantStateDmgFormula || '').trim()) : '',
    // Enchantement mode Toucher : bonus au toucher de l'allié (auto = 2 + Puissance)
    enchantToucher: (nbEnch > 0 && nbInv === 0 && s.enchantMode === 'toucher')
      ? { bonus: _enchBonus, nbCibles: nbEnch } : null,
    // Enchantement mode Déplacement : cases de mouvement en plus (auto = 2 + Puissance)
    enchantMove: (nbEnch > 0 && nbInv === 0 && s.enchantMode === 'deplacement')
      ? { bonusCells: _enchBonus, nbCibles: nbEnch } : null,
    // Enchantement slot=pieds : bonus mouvement (cases supplémentaires)
    // Auto : +2 cases / rune Puissance, ou +1 par défaut
    enchantPieds: (nbEnch > 0 && nbInv === 0 && s.enchantSlot === 'pieds')
      ? { bonusCells: Math.max(1, nbP * 2 || 1), nbCibles: nbEnch } : null,
    // Enchantement slot=tete / torse : effet libre (matrice), buff générique
    enchantGeneric: (nbEnch > 0 && nbInv === 0 && (s.enchantSlot === 'tete' || s.enchantSlot === 'torse'))
      ? { slot: s.enchantSlot, effect: s.enchantEffect || '', nbCibles: nbEnch } : null,
    // Affliction : JS Sa DD scalable selon nb runes Affliction.
    // Base 11, +2 par rune supplémentaire.
    // Slot détermine la nature : torse=DoT · pieds=mouvement · tete=sensoriel · arme=combat
    // ⚠️ Absorbé par le combo Sentinelle (Aff + Inv) → l'affliction est portée par la sentinelle
    // ⚠️ Absorbé par le combo Régénération (Prot + Aff) → l'affliction devient un HoT allié
    affliction: (nbAff > 0 && nbInv === 0 && !(nbProt > 0) && !isLacMode)
      ? (() => {
          // Mode DoT : formule scalable par défaut, override possible via afflictionDotFormula
          // Base 1d4+2, +1 dé par Puissance
          // → nbP=0:1d4+2 · nbP=1:2d4+2 · nbP=2:3d4+2
          const dotDice = 1 + nbP;
          const dotAutoFormula = `${dotDice}d4 +2`;
          const dotFormula = (s.afflictionDotFormula || '').trim() || dotAutoFormula;
          // Stat de sauvegarde dérivée :
          //  - mode "État" : prend la defaultSaveStat de l'état choisi (si lib chargée)
          //  - mode "DoT"  : Constitution (poison/brûlure D&D standard)
          //  - fallback final : Constitution
          const mode = s.afflictionMode || 'dot';
          let saveStat = 'constitution';
          let conditionLib = null;
          if (mode === 'etat' && s.afflictionEtatId) {
            conditionLib = CONDITION_BY_ID[s.afflictionEtatId] || null;
            if (conditionLib?.defaultSaveStat) saveStat = conditionLib.defaultSaveStat;
          }
          // Legacy : si un ancien sort a explicitement afflictionSaveStat, on respecte
          if (s.afflictionSaveStat && !(mode === 'etat' && conditionLib?.defaultSaveStat)) saveStat = s.afflictionSaveStat;
          const dd = mode === 'etat'
            ? (Number.isFinite(parseInt(conditionLib?.defaultDC)) ? parseInt(conditionLib.defaultDC) : 11)
            : 11 + 2 * (nbAff - 1);
          return {
            slot:     s.afflictionSlot || 'torse',
            mode,
            effect:   s.afflictionEffect || '',
            element:  s.noyauTypeId || null,
            dd,
            nbAff,
            nbP,
            dotFormula,
            etatId:   s.afflictionEtatId || null,
            saveStat,
          };
        })() : null,
    // Régénération : Protection + Affliction → soin sur la durée, pas de soin flat
    // ni d'affliction ennemie. Chaque rune Protection/Affliction ajoute un d4 au tick.
    regeneration: (nbProt > 0 && nbAff > 0 && !isLacMode)
      ? {
          formula: `${nbProt + nbAff}d4`,
          nbProt,
          nbAff,
        } : null,
    // Sort suspendu : Réaction + Durée. Stocke le sort pour déclenchement hors-tour
    sortSuspendu: (nbReac > 0 && nbDur > 0)
      ? { graceTurns: nbDur + 1 } : null,
    // Coup de chance : Chance + Réaction. Permet de relancer un d20 d'attaque raté
    coupChance: (nbCh > 0 && nbReac > 0)
      ? { charges: nbCh } : null,
    // Bouclier réactif : Réaction + Protection (CA) → annule 1 attaque (sans bonus CA)
    bouclierReactif: (nbReac > 0 && nbProt > 0 && protMode === 'ca')
      ? { nbProt, tier: nbProt >= 3 ? 'boss' : nbProt === 2 ? 'elite' : 'mob' } : null,
    // Arme invoquée : Ench + Invocation → token allié temporaire (2 tours)
    armeInvoquee: (nbEnch > 0 && nbInv > 0)
      ? { elementId: s.noyauTypeId || null, nbPuissance: nbP } : null,
    // Sentinelle : Affliction + Invocation → token stationnaire (stats propres, 2 tours)
    // Dispersion permet d'invoquer plusieurs sentinelles : 1 + N pour N runes.
    sentinelle: (nbAff > 0 && nbInv > 0)
      ? {
          slot: s.afflictionSlot || 'arme',
          elementId: s.noyauTypeId || null,
          effect: s.afflictionEffect || '',
          dmgDice: sentinelDmg,
          hp: sentinelHp, ca: sentinelCa,
          rangeCells: Math.max(1, Math.ceil(sentinelRangeM / CELL_M)),
          rangeMeters: sentinelRangeM,
          nbInvocations: nbDisp > 0 ? 1 + nbDisp : 1,
          nbP, nbProt, nbAmp,
        } : null,
    // Canalisé persistant : Durée + Concentration → durée liée à la concentration
    canalisePersistant: (nbDur > 0 && nbConc > 0)
      ? { graceTurns: nbDur + 1, dd: Math.max(5, 11 - 2 * (nbConc - 1)) } : null,
    // Invocation (hors combos Sentinelle/Arme invoquée). NOUVEAU modèle : la rune
    // Invocation SÉLECTIONNE des invocations de la bibliothèque du lanceur
    // (s.invocation.ids), 1 par rune. Stats finales = base (lib) + bonus de runes,
    // résolues au SPAWN (_vttSpawnSummon, qui a le perso lanceur). Le nombre n'est
    // plus piloté par Dispersion. Rétro-compat : s.invocation.stats sans ids =
    // ancienne invocation "inline" (ou défaut dérivé si rien).
    invocation: (nbInv > 0 && nbAff === 0 && nbEnch === 0)
      ? (() => {
          // Les créatures sont CHOISIES au lancement dans le VTT (versatilité).
          // defaultIds = pré-sélection éventuelle du sort (carte 🐾), pré-cochée.
          const defaultIds = Array.isArray(s.invocation?.ids) ? s.invocation.ids.filter(Boolean) : [];
          const ov  = s.invocation?.stats || {};
          const has = v => v !== undefined && v !== null && v !== '';
          // Legacy : ancien sort sans bibliothèque (stats inline ou défaut dérivé).
          const legacy = {
            attaque:     has(ov.attaque)     ? String(ov.attaque)     : `${1 + nbP}d4 +2`,
            toucher:     has(ov.toucher)     ? parseInt(ov.toucher)     : (2 + 2 * nbCh),
            pv:          has(ov.pv)          ? parseInt(ov.pv)          : (10 + 5 * nbProt),
            ca:          has(ov.ca)          ? parseInt(ov.ca)          : 10,
            deplacement: has(ov.deplacement) ? parseInt(ov.deplacement) : (3 + 3 * nbAmp),
            image:       s.invocation?.image || null,
            actions:     Array.isArray(s.invocation?.actions) ? s.invocation.actions : [],
            name:        s.nom || 'Invocation',
          };
          return {
            maxInvocations: nbInv,                          // 1 par rune Invocation
            defaultIds,
            elementId: s.noyauTypeId || null,               // élément du noyau → attaque de base de l'invocation
            legacy,
            bonuses:      { nbP, nbCh, nbProt, nbAmp },     // base + bonus appliqué au spawn (stats de base UNIQUEMENT, pas les actions)
            concentration: nbConc > 0,
            duree:        2 + 2 * nbDur,
            nbInvocations: 1,                               // fallback (placement legacy 1×) — écrasé par la sélection au lancement
          };
        })() : null,
  };

  // Renvoie null si aucun mod actif (évite de polluer opt.mods inutilement)
  const any = Object.values(mods).some(v => v !== null);
  return any ? mods : null;
}

/** Rang d'un attaquant pour comparaisons de tier (PJ = 'classique' par défaut). */
function _attackerRank(src) {
  if (!src) return 'classique';
  if (src.beastId) return String(_bestiary[src.beastId]?.rang || 'classique').toLowerCase();
  if (src.npcId)   return String(_npcs[src.npcId]?.rang || 'classique').toLowerCase();
  if (src.characterId) return 'classique'; // PJ : tier classique par défaut
  return 'classique';
}

/** Le bouclier réactif (tier) bloque-t-il une attaque venant d'un rang donné ?
 *  tier=mob  → bloque rang ≤ classique/mob
 *  tier=elite→ bloque rang ≤ élite
 *  tier=boss → bloque tous les rangs
 */
function _shieldBlocks(shieldTier, attackerRank) {
  const RANK = { 'classique': 1, 'mob': 1, 'élite': 2, 'elite': 2, 'boss': 3 };
  const r = RANK[String(attackerRank).toLowerCase()] || 1;
  const t = RANK[String(shieldTier).toLowerCase()] || 1;
  return r <= t;
}

/**
 * Déplace une cible de N cases dans la direction (push) ou opposée (pull) au lanceur.
 * Snap grille, s'arrête au premier blocage (autre token sur la case, hors-page).
 * Renvoie le nombre de cases effectivement parcourues.
 */
async function _vttApplyDeplacement(src, tgtData, mode, distance) {
  if (!src || !tgtData || !distance) return 0;
  // Vecteur source → cible (toujours en cellules, repère grille)
  const dCol = tgtData.col - src.col;
  const dRow = tgtData.row - src.row;
  const len  = Math.hypot(dCol, dRow);
  if (len < 0.001) return 0;
  // Direction unitaire en cellules ; push = sens cible→loin, pull = inverse
  const sign = mode === 'pull' ? -1 : 1;
  const stepC = Math.sign(Math.round((dCol / len) * sign));
  const stepR = Math.sign(Math.round((dRow / len) * sign));
  if (stepC === 0 && stepR === 0) return 0;

  // En diagonale, chaque case coûte 2 de déplacement : portée arrondie au pair
  // supérieur puis ÷2 (ex. 3 → 2 cases, 7 → 4 cases). Orthogonal = portée brute.
  const isDiagonal = stepC !== 0 && stepR !== 0;
  const maxCells = isDiagonal ? Math.ceil(distance / 2) : distance;

  let nc = tgtData.col, nr = tgtData.row;
  let moved = 0;
  for (let i = 0; i < maxCells; i++) {
    const tryC = nc + stepC, tryR = nr + stepR;
    // Collision avec un autre token sur la même page
    const collide = Object.values(_tokens).some(e => {
      const d = e?.data;
      if (!d || d.id === tgtData.id || d.pageId !== tgtData.pageId) return false;
      const dim = _tokenDims(d);
      return tryC >= d.col && tryC < d.col + dim.w && tryR >= d.row && tryR < d.row + dim.h;
    });
    if (collide) break;
    nc = tryC; nr = tryR; moved++;
  }
  if (moved > 0) {
    try {
      await updateDoc(_tokRef(tgtData.id), { col: nc, row: nr });
    } catch (err) {
      console.error('[VTT] Déplacement de sort refusé', err);
      showNotif('Déplacement refusé par Firestore', 'error');
      return 0;
    }
  }
  return moved;
}

// ══ Sorts de déplacement (rune Amplification mode Déplacement) ════════════════

// Déduit le coût PM du lanceur (réplique la logique de _deductPm de l'attaque).
async function _vttSpendSpellPm(src, opt) {
  if (opt.pmCost > 0 && src.characterId) {
    const c = _characters[src.characterId];
    if (c) await updateDoc(_chrRef(src.characterId), { pm: Math.max(0, (c.pm ?? calcPMMax(c)) - opt.pmCost) });
  }
}

// Vrai si la case (col,row) pour un token de dimensions dim recouvre un autre token.
function _selfCellOccupied(col, row, dim, src) {
  return Object.values(_tokens).some(e => {
    const dd = e?.data;
    if (!dd || dd.id === src.id || dd.pageId !== src.pageId) return false;
    const od = _tokenDims(dd);
    return col < dd.col + od.w && col + dim.w > dd.col && row < dd.row + od.h && row + dim.h > dd.row;
  });
}

// Push/Pull : déplace la cible cliquée le long de l'axe lanceur↔cible (sans dégât).
async function _vttCastPushPull(srcId, tgtId, opt, d) {
  const src = _tokens[srcId]?.data, tgt = _tokens[tgtId]?.data;
  if (!src || !tgt) return;
  if (src.id === tgt.id) { showNotif('Choisis une cible (pas toi-même)', 'error'); return; }
  if (_tokenAttackDistance(src, tgt, opt.portee) > (opt.portee || 1) + 0.001) {
    showNotif(`Cible hors de portée (${opt.portee || 1}c)`, 'error');
    return;
  }
  await _vttSpendSpellPm(src, opt);
  const moved = await _vttApplyDeplacement(src, tgt, d.mode, d.cells);
  const verb = d.mode === 'pull' ? '↙ attirée' : '↗ poussée';
  const tgtName = _live(tgt).displayName ?? tgt.name;
  showNotif(moved > 0
    ? `${verb} de ${moved} case${moved > 1 ? 's' : ''} — ${tgtName}`
    : `${tgtName} n'a pas pu être déplacée (obstacle)`, moved > 0 ? 'success' : 'info');
}

// Déplacement "Soi" : losange de cases atteignables (distance Manhattan, comme le
// déplacement classique), clic sur une case libre → le lanceur s'y déplace.
function _selfClear() {
  const hud = document.getElementById('vtt-self-hud');
  if (hud?._removeKey) hud._removeKey();
  hud?.remove();
  _selfCells.forEach(r => r.destroy());
  _selfCells = [];
  _selfCtx = null;
  _layers.grid?.batchDraw();
}

function _startSelfMove(srcId, opt, cells) {
  _zoneClear(); _selfClear();
  _clearHL(); // retire les cases de déplacement classique pour éviter la confusion
  const src = _tokens[srcId]?.data; if (!src || !_layers.grid || !_activePage) return;
  const mv  = Math.max(1, cells || 1);
  _selfCtx = { srcId, cells: mv, opt };
  const K = window.Konva;
  const dim = _tokenDims(src);
  const { cols, rows } = _activePage;
  for (let dc = -mv; dc <= mv; dc++) for (let dr = -mv; dr <= mv; dr++) {
    if (Math.abs(dc) + Math.abs(dr) > mv || (!dc && !dr)) continue; // losange Manhattan
    const c = src.col + dc, r = src.row + dr;
    if (c < 0 || r < 0 || c + dim.w > cols || r + dim.h > rows) continue;
    if (_selfCellOccupied(c, r, dim, src)) continue;
    const rect = new K.Rect({
      x: c * CELL, y: r * CELL, width: dim.w * CELL, height: dim.h * CELL,
      fill: 'rgba(180,127,255,0.30)', stroke: 'rgba(180,127,255,0.8)', strokeWidth: 1.5, listening: true,
    });
    const tc = c, tr = r;
    rect.on('click', async e => { if (e.evt.button !== 0) return; e.cancelBubble = true; await _selfMoveTo(tc, tr); });
    rect.on('contextmenu', e => { e.evt.preventDefault(); });
    _layers.grid.add(rect);
    _selfCells.push(rect);
  }
  _layers.grid.batchDraw();
  _showSelfHud();
  showNotif(`Clic sur une case (≤ ${mv} case${mv > 1 ? 's' : ''})`, 'info');
}

async function _selfMoveTo(col, row) {
  if (!_selfCtx) return;
  const { srcId, opt } = _selfCtx;
  const src = _tokens[srcId]?.data; if (!src) { _selfClear(); return; }
  const dist = Math.abs(col - src.col) + Math.abs(row - src.row);
  const name = _live(src).displayName ?? src.name;
  _selfClear();
  await _vttSpendSpellPm(src, opt);
  try {
    await updateDoc(_tokRef(srcId), { col, row });
  } catch (err) {
    console.error('[VTT] Déplacement personnel refusé', err);
    showNotif('Déplacement refusé par Firestore', 'error');
    return;
  }
  showNotif(`🏃 ${name} se déplace de ${dist} case${dist > 1 ? 's' : ''} (${opt.label})`, 'success');
}

function _selfMoveCancel() { _selfClear(); showNotif('Déplacement annulé', 'info'); }

function _showSelfHud() {
  document.getElementById('vtt-self-hud')?.remove();
  const opt = _selfCtx.opt;
  const hud = document.createElement('div');
  hud.id = 'vtt-self-hud';
  hud.className = 'vtt-mt-hud';
  hud.innerHTML = `
    <div class="vtt-mt-hud-header">
      <span>🏃 ${_esc(opt.label || 'Déplacement')}</span>
      <span class="vtt-mt-hud-count" style="color:#4f8cff;background:rgba(79,140,255,.12);border-color:rgba(79,140,255,.35)">↔ ${_selfCtx.cells} case${_selfCtx.cells > 1 ? 's' : ''} max</span>
    </div>
    <div class="vtt-zone-hint">Clic sur une case bleue · <kbd>Échap</kbd> = annuler</div>
    <div class="vtt-mt-hud-actions">
      <button class="vtt-mt-btn-cancel" data-vtt-fn="_selfMoveCancel">✕ Annuler</button>
    </div>`;
  const onKey = e => { if (e.key === 'Escape') _selfMoveCancel(); };
  document.addEventListener('keydown', onKey);
  hud._removeKey = () => document.removeEventListener('keydown', onKey);
  document.body.appendChild(hud);
}

// ── Sélecteur d'invocations AU LANCEMENT (versatilité : on choisit dans le VTT) ──
let _invPickState = null;  // { srcId, tgtId, opt, optIdx, lib, max, ids:Set }
function _vttPickInvocations(srcId, tgtId, opt, optIdx) {
  const src = _tokens[srcId]?.data;
  const c = src?.characterId ? _characters[src.characterId] : null;
  const lib = Array.isArray(c?.invocations) ? c.invocations : [];
  const max = opt?.mods?.invocation?.maxInvocations || 1;
  if (!lib.length) {
    // Pas de bibliothèque → invocation générique (legacy) 1×, sans sélecteur.
    opt._invSelIds = null; opt._invSelDone = true;
    _startZonePlacement(srcId, tgtId, opt, optIdx);
    return;
  }
  const defaults = (opt?.mods?.invocation?.defaultIds || []).filter(id => lib.some(iv => iv.id === id)).slice(0, max);
  _invPickState = { srcId, tgtId, opt, optIdx, lib, max, ids: new Set(defaults) };
  openModal('🐾 Invoquer', _renderInvPickBody());
}
function _renderInvPickBody() {
  const st = _invPickState; if (!st) return '';
  const sel = st.ids;
  const cards = st.lib.map(iv => {
    const on = sel.has(iv.id);
    const full = !on && sel.size >= st.max;
    const hp = (iv.currentHp != null && iv.stats?.pv != null && parseInt(iv.currentHp) < parseInt(iv.stats.pv)) ? `${iv.currentHp}/${iv.stats.pv}` : (iv.stats?.pv ?? '?');
    return `<button class="cs-invsel-card${on?' is-on':''}" data-vtt-fn="_invPickToggle" data-vtt-args="${iv.id}" ${full?'disabled':''}>
      <span class="cs-invsel-portrait">${iv.image ? `<img src="${iv.image}" alt="">` : '🐾'}</span>
      <span class="cs-invsel-body"><span class="cs-invsel-name">${_esc(iv.nom||'Invocation')}</span>
      <span class="cs-invsel-stats">❤️ ${hp} · 🛡️ ${iv.stats?.ca ?? 10} · ⚔️ ${_esc(iv.stats?.attaque||'1d4 +2')}</span></span>
      <span class="cs-invsel-check">${on?'✓':'+'}</span>
    </button>`;
  }).join('');
  return `<div class="cs-invsel">
    <div class="cs-invsel-hd">Choisis jusqu'à <b>${st.max}</b> invocation(s) — <b>${sel.size}/${st.max}</b></div>
    <div class="cs-invsel-list">${cards}</div>
    <div class="cs-invsel-foot">
      <button class="btn btn-outline btn-sm" data-vtt-fn="_invPickCancel">Annuler</button>
      <button class="btn btn-gold" data-vtt-fn="_invPickConfirm" ${sel.size?'':'disabled'}>🐾 Invoquer (${sel.size})</button>
    </div>
  </div>`;
}
function _invPickToggle(id) {
  const st = _invPickState; if (!st) return;
  if (st.ids.has(id)) st.ids.delete(id);
  else if (st.ids.size < st.max) st.ids.add(id);
  updateModalContent('🐾 Invoquer', _renderInvPickBody());
}
function _invPickConfirm() {
  const st = _invPickState; if (!st || !st.ids.size) return;
  const { srcId, tgtId, opt, optIdx } = st;
  opt._invSelIds = [...st.ids];
  opt._invSelDone = true;
  _invPickState = null;
  closeModalDirect();
  _startZonePlacement(srcId, tgtId, opt, optIdx);
}
function _invPickCancel() { _invPickState = null; closeModalDirect(); }

// Avant de désinvoquer un token d'invocation : sauvegarde ses PV/PM courants sur
// l'entrée de bibliothèque du lanceur (instance unique → réapparaît avec son état).
// Best-effort (écriture autorisée surtout pour le propriétaire / le MJ).
async function _persistInvocationState(tokData) {
  try {
    const t = (tokData?.id && _tokens[tokData.id]?.data) ? _tokens[tokData.id].data : tokData;
    if (!t || t.summonKind !== 'invocation' || !t.summonInvId) return;
    const charId = t.summonOwnerCharId; if (!charId) return;
    const c = _characters[charId]; if (!c || !Array.isArray(c.invocations)) return;
    const inv = c.invocations.find(iv => iv.id === t.summonInvId); if (!inv) return;
    inv.currentHp = Math.max(0, parseInt(t.hp ?? inv.currentHp ?? inv.stats?.pv) || 0);
    inv.currentPm = Math.max(0, parseInt(t.pm ?? inv.currentPm ?? inv.stats?.pmMax) || 0);
    await updateDoc(_chrRef(charId), { invocations: c.invocations });
  } catch (_) { /* non bloquant */ }
}

/**
 * Crée un token "convoqué" (sentinelle, arme invoquée, etc.) sur la page active.
 * - kind: 'sentinelle' | 'arme_invoquee'
 * - center: { col, row } position désirée (sera ajustée si occupée pour arme invoquée)
 * - Le token : 10 PV / CA 10 par défaut, owner = lanceur, durée 2 tours (expiresAtRound)
 * - Persisté en Firestore via _toksCol, visible par tous, contrôlable par l'owner
 */
async function _vttSpawnSummon({ kind, srcId, col, row, opt, durationTurns = 2 }) {
  if (!_activePage) return null;
  const src = _tokens[srcId]?.data; if (!src) return null;
  const round = _session?.combat?.round ?? 0;
  const baseRound = Math.max(1, round);
  const ownerName = _live(src).displayName ?? src.name;

  // Snap dans les bornes de la page (commun à tous les kinds)
  const targetCol = Math.max(0, Math.min(_activePage.cols - 1, col));
  const targetRow = Math.max(0, Math.min(_activePage.rows - 1, row));

  // ── Invocation : résout la N-ième invocation choisie sur la bibliothèque du
  //    lanceur, applique base + bonus de runes, et RESTAURE les PV/PM persistants. ──
  if (kind === 'invocation') {
    const mod = opt?.mods?.invocation || {};
    const idx = _zoneCtx?.invocationsDone || 0;   // quelle invocation on pose (0-based)
    const selIds = opt._invSelIds || null;        // créatures choisies au lancement
    let name = 'Invocation', image = null, actions = [], summonInvId = null;
    let attaque = '1d4', toucher = 0, pvMax = 10, ca = 10, deplacement = 0, pmMax = 0;
    let baseAttackUnscaled = '1d4';   // attaque de base NON scalée → sert aux ACTIONS (runes du sort n'y touchent pas)
    let restoreHp = null, restorePm = null;

    if (selIds && selIds.length) {
      const c = src.characterId ? _characters[src.characterId] : null;
      const invDef = (c?.invocations || []).find(iv => iv.id === selIds[idx])
                  || (c?.invocations || []).find(iv => selIds.includes(iv.id));
      if (!invDef) return null;   // invocation supprimée de la bibliothèque
      const base = invDef.stats || {};
      const b = mod.bonuses || {};
      // Base + bonus (miroir de _calcSummonStats) — UNIQUEMENT sur les stats de base.
      baseAttackUnscaled = String(base.attaque || '1d4 +2');   // les ACTIONS calculent à partir de ÇA (non scalé)
      attaque = baseAttackUnscaled;
      if (b.nbP > 0) { const m = attaque.match(/^(\d+)(d\d+)(.*)$/i); attaque = m ? `${parseInt(m[1]) + b.nbP}${m[2]}${m[3]}` : `${attaque} +${b.nbP}d6`; }
      toucher     = (parseInt(base.toucher) || 0) + 2 * (b.nbCh || 0);
      pvMax       = (parseInt(base.pv) || 10) + 5 * (b.nbProt || 0);
      ca          = parseInt(base.ca) || 10;
      deplacement = (parseInt(base.deplacement) || 0) + 3 * (b.nbAmp || 0);
      pmMax       = parseInt(base.pmMax) || 0;
      name        = invDef.nom || 'Invocation';
      image       = invDef.image || null;
      actions     = Array.isArray(invDef.actions) ? invDef.actions : [];
      summonInvId = invDef.id;
      restoreHp   = (invDef.currentHp != null) ? parseInt(invDef.currentHp) : null;
      restorePm   = (invDef.currentPm != null) ? parseInt(invDef.currentPm) : null;
    } else {
      const iv = mod.legacy || {};
      attaque = iv.attaque || '1d4'; baseAttackUnscaled = attaque; toucher = parseInt(iv.toucher) || 0;
      pvMax = parseInt(iv.pv) || 10; ca = parseInt(iv.ca) || 10;
      deplacement = parseInt(iv.deplacement) || 0;
      name = iv.name || 'Invocation'; image = iv.image || null;
      actions = Array.isArray(iv.actions) ? iv.actions : [];
    }

    const hp = (restoreHp != null) ? Math.max(0, Math.min(restoreHp, pvMax)) : pvMax;
    const pm = (restorePm != null) ? Math.max(0, Math.min(restorePm, pmMax)) : pmMax;
    const tokenData = {
      name: `🐾 ${name} de ${ownerName}`,
      type: 'npc',
      characterId: null, npcId: null, beastId: null,
      ownerId: src.characterId ? STATE.user?.uid || null : null,
      summonOwnerId: srcId,
      summonOwnerCharId: src.characterId || null,
      summonKind: 'invocation',
      summonInvId,
      summonExpiresAtRound: mod.concentration ? null : baseRound + durationTurns - 1,
      summonCanalise: !!mod.concentration,
      summonConcentrationDD: opt?.mods?.concentration?.dd || null,
      summonChanceRc: opt?.mods?.chance?.rc ?? 20,
      summonActions: actions,
      summonElementId: mod.elementId || null,   // attaque de base = élément du sort d'invocation
      pageId: _activePage.id,
      col: targetCol, row: targetRow,
      visible: true,
      hp, hpMax: pvMax, pm, pmMax,
      defense: ca,
      movement: deplacement,
      range: 1,
      attackDice: attaque,
      summonBaseAttack: baseAttackUnscaled,   // base NON scalée pour le calcul des actions
      attack: toucher,
      imageUrl: image,
      movedThisTurn: false, attackedThisTurn: false, bonusActionThisTurn: false, reactionThisTurn: false,
      createdAt: serverTimestamp(),
    };
    const ref = doc(_toksCol());
    await setDoc(ref, tokenData).catch(() => {});
    return { id: ref.id, ...tokenData };
  }

  if (kind !== 'sentinelle') return null; // autres kinds non supportés

  const baseName  = `🪤 Sentinelle de ${ownerName}`;

  // Stats propres de la sentinelle (calculées en amont dans _vttSpellMods)
  const st = opt?.mods?.sentinelle || {};
  const attackDice = st.dmgDice || '1d4';
  const hp = st.hp || 10;
  const ca = st.ca || 10;
  const rangeCells = st.rangeCells || 1;

  // Bonus au toucher = stat de spell du lanceur (mod) + 5 baseline
  // Permet à la sentinelle de toucher à peu près comme une attaque de sort du lanceur
  let attackBonus = 5;
  if (src.characterId) {
    const c = _characters[src.characterId];
    if (c) {
      const mainP   = getMainWeapon(c);
      const statKey = mainP?.toucherStat || mainP?.statAttaque || 'force';
      attackBonus = (getMod(c, statKey) || 0) + 5;
    }
  } else if (src.npcId) {
    attackBonus = (_npcStatMod(_npcs[src.npcId] || {}, 'force') || 0) + 5;
  }

  // Seuil critique hérité du sort (combo Chance)
  const chanceRc = opt?.mods?.chance?.rc ?? 20;

  const tokenData = {
    name: baseName,
    type: 'npc',                       // allié contrôlable
    characterId: null, npcId: null, beastId: null,
    ownerId: src.characterId ? STATE.user?.uid || null : null,
    summonOwnerId: srcId,              // lien vers le lanceur (contrôle + cleanup)
    summonKind: kind,
    summonExpiresAtRound: baseRound + durationTurns - 1,
    summonCanalise: !!opt?.mods?.canalisePersistant,
    summonConcentrationDD: opt?.mods?.canalisePersistant?.dd || opt?.mods?.concentration?.dd || null,
    // Stats héritées du sort qui l'a invoquée — utilisées par _buildAttackOptions
    summonChanceRc: chanceRc,
    // Élément : priorité au noyau du sort (st.elementId), sinon damageTypeId de l'option offensive, sinon null
    summonElementId: st.elementId || opt?.damageTypeId || null,
    summonNbPuissance: st.nbP || 0,
    summonNbProtection: st.nbProt || 0,
    summonNbAmplification: st.nbAmp || 0,
    pageId: _activePage.id,
    col: targetCol, row: targetRow,
    visible: true,
    hp, hpMax: hp,
    defense: ca,
    movement: 0,                       // sentinelle stationnaire
    range: rangeCells,
    attackDice,
    attack: attackBonus,
    imageUrl: null,
    movedThisTurn: false, attackedThisTurn: false, bonusActionThisTurn: false, reactionThisTurn: false,
    createdAt: serverTimestamp(),
  };

  const ref = doc(_toksCol());
  await setDoc(ref, tokenData).catch(() => {});
  return { id: ref.id, ...tokenData };
}

/**
 * Helper commun : champs de buff partagés (durée, canalisation, source).
 * Évite la duplication entre les différents types d'enchantements/afflictions.
 */
function _buffShared(opt, srcId) {
  const round = _session?.combat?.round ?? 0;
  const baseRound = Math.max(1, round);
  const dur = opt.sortDuree ?? 2;
  const isCanalise = !!opt.mods?.canalisePersistant;
  const concDD = opt.mods?.concentration?.dd ?? (isCanalise ? 11 : null);
  // Firestore rejette `undefined` — on omet les champs au lieu de les mettre à undefined
  return {
    startRound: round,
    totalDuration: isCanalise ? null : dur,
    expiresAtRound: isCanalise ? null : baseRound + dur - 1,
    casterId: srcId || null,
    sortLabel: opt.label || '',
    ...(isCanalise ? { canalisePersistant: true, concentrationDD: concDD } : {}),
  };
}

/** Applique les buffs d'enchantement (mode Dégâts arme OU mode État sur allié). */
async function _vttApplyEnchantBuffs(srcId, targetIds, opt) {
  const shared = _buffShared(opt, srcId);

  // Mode "État" : applique directement un état choisi à chaque allié ciblé.
  // Pas de JS (effet bénéfique consenti). Durée selon defaultDuration de l'état.
  const etatId = opt.mods?.enchantEtatId;
  if (etatId && CONDITION_BY_ID[etatId]) {
    const lib = CONDITION_BY_ID[etatId];
    const round = _session?.combat?.round ?? 0;
    const isConsumed = !!lib.effects?.consumedByAttackAgainst;
    const dur = Number.isFinite(lib.defaultDuration) && lib.defaultDuration > 0
      ? lib.defaultDuration : 2;
    const expiresAtRound = (round > 0 && !isConsumed && dur > 0) ? round + dur - 1 : null;
    const scaledFields = _scaledEnchantConditionFields(
      lib,
      opt.mods?.enchantStatePower || 0,
      opt.mods?.enchantStateAmplification || 0,
      {
        movementBonus: opt.mods?.enchantStateMoveBonus,
        dmgFormula: opt.mods?.enchantStateDmgFormula,
      }
    );
    for (const tid of targetIds) {
      const td = _tokens[tid]?.data; if (!td) continue;
      const existingConds = (td.conditions || []).filter(c => c.source !== opt.label);
      if (existingConds.some(c => c.id === etatId)) continue;
      const newCond = {
        id: etatId, appliedAt: Date.now(), appliedBy: srcId || null,
        source: opt.label || '',
        saveDC: lib.defaultSaveStat ? (lib.defaultDC || 11) : null,
        saveStat: lib.defaultSaveStat || null,
        expiresAtRound,
        ...scaledFields,
      };
      await updateDoc(_tokRef(tid), { conditions: [...existingConds, newCond] }).catch(() => {});
      const name = _live(td).displayName ?? td.name;
      showNotif(`${lib.icon} ${name} : ${lib.label}`, 'success');
    }
    return;
  }

  // Mode "Dégâts" (par défaut) : buffs slot-based legacy
  const buffs = [];
  if (opt.mods?.enchantArmeDmg) {
    buffs.push({ ...shared, type: 'dmg_bonus', slot: 'arme', icon: '⚔️',
      formula: opt.mods.enchantArmeDmg.formula, element: opt.mods.enchantArmeDmg.element });
  }
  if (opt.mods?.enchantPieds) {
    buffs.push({ ...shared, type: 'move_bonus', slot: 'pieds', icon: '👢',
      bonus: opt.mods.enchantPieds.bonusCells });
  }
  if (opt.mods?.enchantGeneric) {
    buffs.push({ ...shared, type: 'enchantment',
      slot: opt.mods.enchantGeneric.slot, effect: opt.mods.enchantGeneric.effect,
      icon: opt.mods.enchantGeneric.slot === 'tete' ? '👁️' : '👕' });
  }
  // Nouveaux enchantements chiffrés (mode-based) sur l'allié
  if (opt.mods?.enchantToucher) {
    buffs.push({ ...shared, type: 'toucher_bonus', icon: '🎯', bonus: opt.mods.enchantToucher.bonus });
  }
  if (opt.mods?.enchantMove) {
    buffs.push({ ...shared, type: 'move_bonus', slot: 'pieds', icon: '👢', bonus: opt.mods.enchantMove.bonusCells });
  }
  if (!buffs.length) return;
  // ── Anti-stack global : un buff dmg_bonus arme remplace TOUS les anciens dmg_bonus arme.
  // Les autres types (move_bonus, range_bonus, enchantment) se filtrent par sort label
  // pour permettre des effets différents de sources différentes.
  for (const tid of targetIds) {
    const td = _tokens[tid]?.data; if (!td) continue;
    const existing = (td.buffs || []).filter(b => {
      // Retire tout buff dmg_bonus arme : non cumulable, le dernier en vigueur l'emporte
      if (b.type === 'dmg_bonus' && b.slot === 'arme') return false;
      // Autres types : retire seulement les buffs du même sort (par label)
      return !(b.type !== 'dmg_bonus' && b.sortLabel === opt.label);
    });
    await updateDoc(_tokRef(tid), { buffs: [...existing, ...buffs] }).catch(() => {});
  }
}

const _STAT_SHORT = { force:'For', dexterite:'Dex', constitution:'Con', sagesse:'Sag', intelligence:'Int', charisme:'Cha' };

/** Applique une affliction : JS Sa de la cible, buff selon slot si échec. */
async function _vttApplyAfflictions(srcId, targetIds, opt) {
  const aff = opt.mods?.affliction; if (!aff) return;
  const shared = _buffShared(opt, srcId);
  const statShortStr = _STAT_SHORT[aff.saveStat] || aff.saveStat;
  const dotFormula = aff.dotFormula || '1d4';
  const mode = aff.mode || 'dot';
  const srcTok = _tokens[srcId]?.data;
  const srcName = srcTok ? (_live(srcTok).displayName ?? srcTok.name) : '?';

  // ── Log d'annonce du cast (1 message global) ────────────────────────
  // « A lance Silence sur B » avant les JS individuels
  const tgtNames = targetIds.map(tid => {
    const td = _tokens[tid]?.data;
    return td ? (_live(td).displayName ?? td.name) : '?';
  }).join(', ');
  await addDoc(_logCol(), {
    type: 'affliction-cast',
    authorId: STATE.user?.uid || null,
    authorName: STATE.profile?.pseudo || STATE.profile?.prenom || '?',
    casterName: srcName, characterImage: srcTok?.image || null,
    targetName: tgtNames,
    optLabel: opt.label || 'Affliction',
    mode, dd: aff.dd, statLabel: statShortStr,
    effectLbl: mode === 'etat' && aff.etatId && CONDITION_BY_ID[aff.etatId]
               ? `${CONDITION_BY_ID[aff.etatId].icon} ${CONDITION_BY_ID[aff.etatId].label}`
               : `🩸 DoT ${dotFormula}/tour`,
    createdAt: serverTimestamp(),
  }).catch(() => {});

  for (const tid of targetIds) {
    const td = _tokens[tid]?.data; if (!td) continue;
    const saveMod = _tokenStatMod(td, aff.saveStat);
    const roll = Math.floor(Math.random() * 20) + 1;
    const tot = roll + saveMod;
    const success = roll === 20 || (roll !== 1 && tot >= aff.dd);
    const tgtName = _live(td).displayName ?? td.name;
    const rollStr = `JS ${statShortStr} ${roll}${saveMod>=0?'+':''}${saveMod}=${tot} vs DD${aff.dd}`;

    // ── Log du JS dans le chat ──────────────────────────────────────────
    // Permet au MJ et aux joueurs de voir le résultat du jet, le mod utilisé
    // et la résolution (résistance vs application de l'effet).
    const _effectLbl = (() => {
      if (mode === 'etat' && aff.etatId && CONDITION_BY_ID[aff.etatId]) {
        const l = CONDITION_BY_ID[aff.etatId];
        return `${l.icon} ${l.label}`;
      }
      return `🩸 DoT ${dotFormula}/tour`;
    })();
    await addDoc(_logCol(), {
      type: 'save',
      authorId: STATE.user?.uid || null,
      authorName: STATE.profile?.pseudo || STATE.profile?.prenom || '?',
      tokenName: tgtName,
      conditionLabel: _effectLbl,
      sortLabel: opt.label || '',
      statLabel: statShortStr, mod: saveMod, d20: roll, total: tot, dd: aff.dd,
      passed: success,
      createdAt: serverTimestamp(),
    }).catch(() => {});

    if (success) {
      showNotif(`🛡️ ${tgtName} résiste · ${rollStr}`, 'info');
      continue;
    }

    // ── Mode "État" : applique l'état choisi avec sa durée par défaut ──
    if (mode === 'etat') {
      // Diagnostic clair si l'état est mal configuré
      if (!aff.etatId) {
        showNotif(`⚠️ Sort "${opt.label}" en mode État sans état choisi — rien n'est appliqué`, 'warning');
        continue;
      }
      const lib = CONDITION_BY_ID[aff.etatId];
      if (!lib) {
        showNotif(`⚠️ État "${aff.etatId}" introuvable en BDD — vérifier les réglages`, 'error');
        continue;
      }
      const round = _session?.combat?.round ?? 0;
      const isConsumed = !!lib.effects?.consumedByAttackAgainst;
      const dur = Number.isFinite(lib.defaultDuration) && lib.defaultDuration > 0
        ? lib.defaultDuration : 2;
      // Si combat actif (round > 0) : expiresAtRound calculé direct
      // Si combat inactif (round = 0) : on stocke pendingDuration pour reporter
      //   le calcul au démarrage du combat (sinon l'état durerait à l'infini)
      const expiresAtRound = (round > 0 && !isConsumed && dur > 0) ? round + dur - 1 : null;
      const pendingDuration = (round === 0 && !isConsumed && dur > 0) ? dur : null;
      const existingConds = td.conditions || [];
      if (existingConds.some(c => c.id === aff.etatId)) {
        showNotif(`${lib.icon} ${tgtName} portait déjà ${lib.label}`, 'info');
        continue;
      }
      const newCond = {
        id: aff.etatId,
        appliedAt: Date.now(),
        appliedBy: srcId || null,
        source: opt.label || '',
        saveDC: lib.defaultSaveStat ? (lib.defaultDC || 11) : null,
        saveStat: lib.defaultSaveStat || aff.saveStat || null,
        expiresAtRound,
        ...(pendingDuration != null ? { pendingDuration } : {}),
      };
      // Surface l'erreur si l'update Firestore échoue (permissions, etc.)
      try {
        await updateDoc(_tokRef(tid), { conditions: [...existingConds, newCond] });
        showNotif(`${lib.icon} ${tgtName} subit ${lib.label} · ${rollStr} (échec)`, 'success');
      } catch (err) {
        console.error('[VTT] État non appliqué :', err);
        showNotif(`⚠️ ${tgtName} : échec d'application de ${lib.label} (${err?.message || err})`, 'error');
      }
      continue;
    }

    // ── Mode "DoT" (par défaut) : applique un buff de type 'dot' avec la formule ──
    // ⚠️ Non cumulable : un seul DoT actif à la fois sur une cible. Le dernier
    // appliqué remplace TOUS les DoT existants (peu importe la source).
    // ✦ Proc immédiat : le DoT inflige son tick au moment du cast aussi (pas
    //   seulement aux rounds suivants).
    const newBuff = {
      ...shared, type: 'dot', slot: aff.slot, icon: '🩸',
      formula: dotFormula, element: aff.element, effect: aff.effect,
    };
    const existing = (td.buffs || []).filter(b => b.type !== 'dot');
    try {
      await updateDoc(_tokRef(tid), { buffs: [...existing, newBuff] });
    } catch (err) {
      console.error('[VTT] DoT non appliqué :', err);
      showNotif(`⚠️ ${tgtName} : échec d'application du DoT (${err?.message || err})`, 'error');
      continue;
    }

    // Roll du tick immédiat avec détail des dés
    const det = _rollDiceDetailed(dotFormula);
    if (det.total > 0) {
      const lT = _live(td);
      const curHp = lT.displayHp ?? td.hp ?? 20;
      const newHp = Math.max(0, curHp - det.total);
      let hpApplied = true;
      await _setHp(td, newHp).catch(err => {
        hpApplied = false;
        console.error('[VTT] DoT tick immédiat : HP non appliqués', err);
        showNotif(`⚠️ ${tgtName} : tick de DoT non appliqué (${err?.code || err?.message || 'permissions ?'})`, 'error');
      });
      if (!hpApplied) continue;
      // Log du tick immédiat (cohérent avec le tick de round suivant)
      await addDoc(_logCol(), {
        type: 'dot-tick',
        authorId: STATE.user?.uid || null,
        authorName: STATE.profile?.pseudo || STATE.profile?.prenom || '?',
        tokenName: tgtName,
        rolls: [{ formula: dotFormula, rolled: det.total, rolledDice: det.rolls, mod: det.mod, sides: det.sides, sortLabel: opt.label || 'DoT' }],
        total: det.total, newHp, hpMax: lT.displayHpMax ?? 20,
        immediate: true,
        createdAt: serverTimestamp(),
      }).catch(() => {});
      showNotif(`🩸 ${tgtName} : DoT ${dotFormula} → ${det.total} dégâts (proc cast)`, 'success');
    } else {
      showNotif(`🩸 ${tgtName} : DoT ${dotFormula}/tour · ${rollStr} (échec)`, 'success');
    }
  }
}

async function _vttApplyRegeneration(srcId, targetIds, opt) {
  const regen = opt.mods?.regeneration;
  if (!regen) return;
  const shared = _buffShared(opt, srcId);
  const newBuff = {
    ...shared,
    type: 'regen',
    icon: '💚',
    formula: regen.formula || '2d4',
    effect: 'Régénération',
  };
  for (const tid of targetIds) {
    const td = _tokens[tid]?.data; if (!td) continue;
    const existing = (td.buffs || []).filter(b => !(b.type === 'regen' && b.sortLabel === opt.label));
    await updateDoc(_tokRef(tid), { buffs: [...existing, newBuff] }).catch(() => {});
    const name = _live(td).displayName ?? td.name;
    showNotif(`💚 ${name} : Régénération ${newBuff.formula}/tour`, 'success');
  }
}

/** Construit une option d'attaque à partir d'un sort `s` (schéma deck_sorts).
 *
 *  Pipeline unifié utilisé par TROIS branches :
 *    1. Sorts de personnage (`c.deck_sorts`)
 *    2. Actions d'objet (`c.inventaire[i].actions`)
 *    3. Actions de créature (`b.actions`)
 *
 *  Chaque branche fournit son `ctx` (identité, char pour calculs, fallbacks
 *  pour stats par défaut, extras à fusionner type `_itemAction` / `_catMeta`).
 *
 *  Retourne l'option (caller pushe dans `options`).
 */
function _buildSpellOption(s, ctx) {
  const {
    id, sortIdx, label,
    c,                              // char ou char synthétique (utilisé par getMod / formules)
    portee,
    pmCost, basePm, pmRaw, pmSetDelta = 0,
    fallbackTouchStat,              // stat toucher par défaut si s.toucherStat absent
    fallbackDmgStat,                // stat dégâts par défaut si s.degatsStat absent
    fallbackTouchMod = 0,           // mod toucher si c absent / 'none'
    fallbackDmgMod   = 0,           // mod dégâts si c absent / 'none'
    touchSetBonus    = 0,           // bonus set armure (perso uniquement)
    enchantOnlyAlsoEtat = true,     // false = item branch (que enchantArmeDmg compte)
    extras = {},                    // _itemAction / _catMeta / etc.
  } = ctx;

  // ── Pré-calculs communs aux 3 branches ─────────────────────────────────
  const mods = _vttSpellMods(s);
  const types = Array.isArray(s.types) && s.types.length ? s.types
              : (s.typeSoin ? ['defensif'] : (s.noyau ? ['offensif'] : ['utilitaire']));
  const protMode = s.protectionMode || 'ca';
  // En mode Déplacement, l'Amplification produit un déplacement, pas une zone.
  const _isDepl = s.ampMode === 'deplacement';
  let zoneW = (mods?.allonge || _isDepl) ? 0 : (s.zoneW || 0);
  let zoneH = (mods?.allonge || _isDepl) ? 0 : (s.zoneH || 0);
  // Si pas de zone manuelle ni allonge : calcule depuis les runes (Amplification × Dispersion).
  // Miroir EXACT de _calcSortZone (spells.js) : Amp seul → ligne 3N ;
  // Amp+Disp → zone carrée plaçable 3×3, puis 7×7, 11×11...
  // L'éditeur affiche ces nombres comme la taille de zone (ex. 1 Amp + 1 Disp = 3×3) ;
  // le VTT doit poser la MÊME grille → 1 case par unité (pas de reconversion mètres→cases,
  // qui rétrécissait le sort, ex. 3×3 affiché → 2×2 posé).
  if (!mods?.allonge && !_isDepl && zoneW <= 0 && zoneH <= 0) {
    const _runes = s.runes || [];
    const _nbAmp  = _runes.filter(r => r === 'Amplification').length;
    const _nbDisp = _runes.filter(r => r === 'Dispersion').length;
    if (_nbAmp >= 1) {
      if (_nbDisp >= 1) {
        const size = _vttAmpDispCircleSize(_nbAmp, _nbDisp);
        zoneW = size;
        zoneH = size;
      } else {
        zoneW = 3 * _nbAmp;
        zoneH = 1;
      }
    }
  }
  // Sentinelle / Invocation : force une zone min 1×1 (utile pour le placement)
  if ((mods?.sentinelle || mods?.invocation) && (zoneW <= 0 || zoneH <= 0)) {
    zoneW = Math.max(1, zoneW || 1);
    zoneH = Math.max(1, zoneH || 1);
  }
  const nbCibles = _vttSortCibles(s) || 1;

  const actionMode = _vttSpellActionMode(s);
  const actionType = actionMode === 'reaction'
    ? 'reaction'
    : actionMode === 'action_bonus'
      ? 'bonus'
      : 'action';
  const sortIcon = actionType === 'reaction' ? '⚡' : actionType === 'bonus' ? '💫' : '✨';

  // Bloc de champs communs réutilisé dans chaque variante d'option
  const common = {
    id, sortIdx, portee,
    pmCost, basePm, pmRaw, pmSetDelta,
    nbCibles, zoneW, zoneH, mods, actionType,
    ...extras,
  };

  // Sort de déplacement (rune Amplification mode Déplacement) : aucun dégât, pas d'attaque.
  if (mods?.deplacement) {
    const dm = mods.deplacement.mode;
    return { ...common, label, dice: '',
      icon: dm === 'self' ? '🏃' : dm === 'pull' ? '↙' : '↗',
      isUtil: true, isDeplacement: true, halfOnMiss: false };
  }

  // Invocation générique : place une créature (aucun dégât du lanceur — la créature frappe).
  if (mods?.invocation) {
    return { ...common, label, dice: '', icon: '🐾',
      isUtil: true, isInvocation: true, halfOnMiss: false };
  }

  // Toucher / Déplacement : buff pur sur allié → toujours buff-only, même si un
  // degats résiduel traîne (sinon le sort attaquerait ET poserait le buff).
  const _enchBuffNoImpact = !!mods?.enchantToucher || !!mods?.enchantMove;
  const isEnchantOnly = _enchBuffNoImpact || (enchantOnlyAlsoEtat
    ? (!!mods?.enchantArmeDmg || !!mods?.enchantEtatId) && !((s.degats || '').trim())
    : ( !!mods?.enchantArmeDmg && !((s.degats || '').trim())));
  const isAfflictionOnly = !!mods?.affliction;

  if (isEnchantOnly) {
    const enchMode  = s.enchantMode || 'dmg';
    const isEtat    = enchMode === 'etat' && !!mods?.enchantEtatId;
    const elementId = mods?.enchantArmeDmg?.element || s.noyauTypeId || null;
    const enchTypeObj = elementId ? getDamageTypeById(_damageTypes, elementId) : null;
    return { ...common,
      icon: isEtat ? '✨' : '🪄', label, dice: '',
      isEnchant: true, enchantMode: enchMode,
      enchantFormula: mods.enchantArmeDmg?.formula || '',
      enchantEtatId: mods.enchantEtatId || null,
      enchantElement: elementId,
      enchantElementIcon: enchTypeObj?.icon || '',
      enchantElementColor: enchTypeObj?.color || '',
      isUtil: true, halfOnMiss: false,
    };
  }
  if (mods?.regeneration) {
    return { ...common,
      icon: '💚', label,
      dice: `${mods.regeneration.formula}/tour`,
      isRegen: true,
      isUtil: true,
      halfOnMiss: false,
    };
  }
  if (isAfflictionOnly) {
    const aff = mods.affliction;
    const aTypeObj = aff.element ? getDamageTypeById(_damageTypes, aff.element) : null;
    return { ...common,
      icon: aff.mode === 'etat' ? '⛓' : '🩸', label,
      dice: aff.mode === 'dot'
            ? `${aff.dotFormula}/tour`
            : (aff.etatId && CONDITION_BY_ID[aff.etatId]?.label || 'État'),
      isAffliction: true,
      afflictionMode: aff.mode,
      afflictionDotFormula: aff.dotFormula,
      afflictionEtatId: aff.etatId || null,
      afflictionDD: aff.dd, afflictionSaveStat: aff.saveStat,
      afflictionElement: aff.element || null,
      afflictionElementIcon: aTypeObj?.icon || '',
      afflictionElementColor: aTypeObj?.color || '',
      isUtil: true, halfOnMiss: false,
    };
  }
  // Lacération frappe toujours l'attaque de base, même si « offensif » n'est pas coché.
  // (branche Lacération d'Affliction → mods.laceration ; ou ancienne rune legacy)
  if (types.includes('offensif') || _sRunes.includes('Lacération') || !!mods?.laceration) {
    const fullFormula    = _vttSortDmgFormula(s, c);
    const { rawDice: sRawDice, fixed: sFixed } = _splitDiceFormula(fullFormula);
    const spellTypeId    = s.noyauTypeId || null;
    const spellTypeRules = spellTypeId
      ? getDamageTypeRules(_damageTypes, spellTypeId)
      : { missEffect: 'half', armorPen: 0, dmgBonus: 0 };
    const spellTypeObj   = spellTypeId ? getDamageTypeById(_damageTypes, spellTypeId) : null;
    const ovrTouchStat   = s.toucherStat || fallbackTouchStat;
    const ovrDmgStat     = s.degatsStat  || fallbackDmgStat;
    const ovrTouchNoMod  = ovrTouchStat === 'none';
    const ovrDmgNoMod    = ovrDmgStat   === 'none';
    const ovrTouchMod    = ovrTouchNoMod ? 0 : (c ? getMod(c, ovrTouchStat) : fallbackTouchMod);
    const ovrDmgMod      = ovrDmgNoMod   ? 0 : (c ? getMod(c, ovrDmgStat)   : fallbackDmgMod);
    // Multi-noyau : si le sort a plusieurs éléments, on laisse le joueur choisir
    // au lancement (cf. _vttPickOpt → _showSpellElementPicker). L'élément primaire
    // (spellTypeId) sert d'affichage par défaut.
    const spellElementChoices = (Array.isArray(s.noyauTypeIds) && s.noyauTypeIds.length > 1)
      ? s.noyauTypeIds.filter(Boolean)
      : null;
    return { ...common,
      icon: sortIcon, label,
      rawDice: sRawDice, dice: fullFormula,
      typeRules: spellTypeRules,
      damageTypeId: spellTypeId,
      damageTypeIcon: spellTypeObj?.icon || '',
      damageTypeColor: spellTypeObj?.color || '',
      spellElementChoices,
      toucherMod: ovrTouchMod, toucherSetBonus: touchSetBonus,
      toucherStatLabel: ovrTouchNoMod ? '' : (statShort(ovrTouchStat) || ovrTouchStat),
      dmgStatMod: ovrDmgMod,
      dmgStatLabel: ovrDmgNoMod ? '' : (statShort(ovrDmgStat) || ovrDmgStat),
      maitriseBonus: sFixed,
      drainBaseFormula: mods?.drain ? _vttSortDmgFormula(s, c, { includePower: false }) : null,
      mjAlwaysMax: !!s.mjAlwaysMax,
    };
  }
  const isAmpSupportHeal = types.includes('defensif')
    && (s.runes || []).includes('Amplification')
    && s.ampMode !== 'deplacement'
    && !(s.runes || []).includes('Protection');
  if (types.includes('defensif') && (protMode === 'soin' || isAmpSupportHeal)) {
    const soinFormula = _vttSortSoinFormula(s, c);
    const { rawDice: sRawDice, fixed: sFixed } = _splitDiceFormula(soinFormula);
    // Stat de soin : override > auto (magique → stat arme magique ou Int ; physique → Con)
    let soinStatKey;
    if (s.degatsStat) {
      soinStatKey = s.degatsStat;
    } else {
      const mainP = c ? getMainWeapon(c) : null;
      const isMagic = !!(_damageTypes && s?.noyauTypeId
        && _damageTypes.find(x => x.id === s.noyauTypeId)?.isMagic);
      if (isMagic) {
        const fmt = _weaponFormats?.find(f => f.label === mainP?.format);
        // Les Poings (isDefault) ne sont jamais une "arme magique" → Int par défaut
        const isMagicWeapon = fmt?.isMagic === true && mainP?.nom && !mainP?.isDefault;
        soinStatKey = isMagicWeapon ? (mainP.statAttaque || mainP.toucherStat || 'intelligence') : 'intelligence';
      } else {
        soinStatKey = 'constitution';
      }
    }
    const soinNoMod   = soinStatKey === 'none';
    const soinStatMod = soinNoMod ? 0 : (c ? getMod(c, soinStatKey) : 0);
    const soinTouchStat = s.toucherStat || fallbackTouchStat;
    const soinTouchNoMod = soinTouchStat === 'none';
    const soinTouchMod   = soinTouchNoMod ? 0 : (c ? getMod(c, soinTouchStat) : fallbackTouchMod);
    return { ...common,
      icon: '💚', label, rawDice: sRawDice, dice: soinFormula,
      isHeal: true, halfOnMiss: false, maitriseBonus: sFixed,
      mjAlwaysMax: !!s.mjAlwaysMax,
      dmgStatMod: soinStatMod,
      dmgStatLabel: soinNoMod ? '' : (statShort(soinStatKey) || soinStatKey),
      toucherMod: soinTouchMod, toucherSetBonus: touchSetBonus,
      toucherStatLabel: soinTouchNoMod ? '' : (statShort(soinTouchStat) || soinTouchStat),
    };
  }
  if (types.includes('defensif') && protMode === 'ca') {
    return { ...common,
      icon: '🛡️', label,
      dice: s.ca || 'CA +2 (2 tours)',
      isCaSort: true, halfOnMiss: false,
      caBonus: _parseCaBonus(s.ca), sortDuree: _sortDureeVtt(s),
    };
  }
  // Utilitaire libre
  return { ...common,
    icon: sortIcon, label,
    dice: s.effet ? s.effet.slice(0, 40) : '—',
    isUtil: true, halfOnMiss: false,
  };
}

/** Construit la liste des options d'attaque pour un token (arme / attaques bestiaire / sorts). */
function _buildAttackOptions(t) {
  const ld = _live(t);
  const c  = t.characterId ? _characters[t.characterId] : null;
  const b  = ld._beast || null;
  const options = [];

  // ── Token convoqué (sentinelle / invocation) : utilise ses stats propres
  //    stockées au spawn (attackDice/toucher), pas le fallback "poings" (2d4).
  //    Les combos Chance/Puissance hérités du sort sont propagés via summon*.
  if (t.summonKind === 'sentinelle' || t.summonKind === 'invocation') {
    const _isInvoc = t.summonKind === 'invocation';
    const sentinelMods = {
      // Réinjecte le combo Chance hérité pour que _vttRollAttack utilise le bon RC
      chance: (t.summonChanceRc && t.summonChanceRc < 20) ? { rc: t.summonChanceRc } : null,
    };
    options.push({
      id: 'summon_attack',
      icon: _isInvoc ? '🐾' : '🪤',
      label: _isInvoc ? "Attaque de l'invocation" : 'Attaque sentinelle',
      rawDice: t.attackDice || '1d4',
      dice:    t.attackDice || '1d4',
      portee:  t.range ?? 1,
      pmCost:  0,
      toucher: t.attack ?? 5,           // bonus toucher hérité du lanceur
      dmgStatMod: 0,
      dmgStatLabel: '—',
      maitriseBonus: 0,
      halfOnMiss: false,
      // Invocation : attaque de base de l'élément du sort, mais AUCUN dégât sur un
      // échec (on neutralise le missEffect 'half'/'full' du type). La sentinelle
      // garde le comportement du type.
      typeRules: _isInvoc
        ? { ...getDamageTypeRules(_damageTypes, t.summonElementId || 'physique'), missEffect: 'none' }
        : getDamageTypeRules(_damageTypes, t.summonElementId || 'physique'),
      damageTypeId:    t.summonElementId || 'physique',
      damageTypeIcon:  getDamageTypeById(_damageTypes, t.summonElementId || 'physique')?.icon || '',
      damageTypeColor: getDamageTypeById(_damageTypes, t.summonElementId || 'physique')?.color || '',
      mods: sentinelMods,
    });

    // ── Invocation : ses actions (sorts connus) deviennent des attaques ──
    if (_isInvoc && Array.isArray(t.summonActions) && t.summonActions.length) {
      // Perso "créature" virtuel : arme principale = l'attaque de l'invocation
      // (base des dégâts), stats neutres → aucun modificateur parasite.
      const _cChar = {
        stats: { force:10, dexterite:10, constitution:10, intelligence:10, sagesse:10, charisme:10 },
        statsBonus: {}, maitrises: {},
        equipement: { 'Main principale': { nom: 'Attaque', degats: t.summonBaseAttack || t.attackDice || '1d4', statAttaque: 'force', isDefault: true } },
      };
      // L'invocation profite du SET du lanceur : le set léger (spellPmDelta -2)
      // réduit le coût en mana de ses sorts (payés par le lanceur).
      let _ownerSetPmDelta = 0;
      if (t.summonOwnerId) {
        const _ownerData = _tokens[t.summonOwnerId]?.data;
        const _ownerChar = _ownerData?.characterId ? _characters[_ownerData.characterId] : null;
        if (_ownerChar) _ownerSetPmDelta = getArmorSetData(_ownerChar).modifiers?.spellPmDelta || 0;
      }
      t.summonActions.forEach((a, ai) => {
        // Seules les actions offensives sont jouables ici (effets complexes : à venir)
        const isOff = (Array.isArray(a.types) && a.types.includes('offensif'))
                   || (Array.isArray(a.runes) && (a.runes.includes('Lacération')
                       || (a.afflictionMode === 'laceration' && a.runes.includes('Affliction'))));
        if (!isOff) return;
        const dmg  = _vttSortDmgFormula(a, _cChar);
        const elId = a.noyauTypeId || t.summonElementId || 'physique';
        const elObj = getDamageTypeById(_damageTypes, elId);
        const nbCh = Array.isArray(a.runes) ? a.runes.filter(r => r === 'Chance').length : 0;
        const rc   = nbCh > 0 ? Math.max(17, 20 - nbCh) : (t.summonChanceRc ?? 20);
        options.push({
          id: `summon_action_${ai}`,
          icon: a.icon || '✨',
          label: a.nom || 'Action',
          rawDice: dmg, dice: dmg,
          portee: parseInt(a.portee) || t.range || 1,
          // Coût payé sur le perso du lanceur (cf. _vttRollAttack), réduit par son set léger
          pmCost: Math.max(0, (parseInt(a.pm) || 0) + _ownerSetPmDelta),
          basePm: parseInt(a.pm) || 0,
          pmSetDelta: _ownerSetPmDelta,
          toucher: t.attack ?? 0,
          dmgStatMod: 0, dmgStatLabel: '—', maitriseBonus: 0,
          halfOnMiss: false,
          typeRules: getDamageTypeRules(_damageTypes, elId),
          damageTypeId: elId,
          damageTypeIcon: elObj?.icon || '',
          damageTypeColor: elObj?.color || '',
          mods: { chance: (rc < 20) ? { rc } : null },
        });
      });
    }
    return options;
  }

  // ── Créature du bestiaire : armes naturelles + actions (sorts) ───────────
  // Helper : modificateur d'une stat sur la créature (sans char)
  const _bMod = (statKey) => {
    if (!b || statKey === 'none' || !statKey) return 0;
    const v = parseInt(b[statKey]);
    if (!Number.isFinite(v)) return 0;
    return getModFromScore(v);
  };

  // 1) Armes naturelles : une option par arme, avec stat dégâts/toucher + bonus fixes
  if (Array.isArray(b?.armesNaturelles) && b.armesNaturelles.length) {
    b.armesNaturelles.forEach((w, idx) => {
      if (!w.degats && !w.nom) return;
      const dStat   = w.degatsStat  || 'force';
      const tStat   = w.toucherStat || dStat;
      const dMod    = _bMod(dStat);
      const tMod    = _bMod(tStat);
      const flatD   = parseInt(w.degatsFlat)  || 0;
      const flatT   = parseInt(w.toucherFlat) || 0;
      const toucherTotal = (tStat === 'none' ? 0 : tMod) + flatT;
      // Type de dégâts défini par le MJ (feu/eau/…) → règles associées (dont
      // missEffect:'half' des types magiques = ½ dégâts), icône et couleur.
      const dtypeId = w.damageTypeId || 'physique';
      const dtype   = (_damageTypes || []).find(t => t.id === dtypeId) || null;
      options.push({
        id:      `beast_arme_${idx}`,
        icon:    '🦷',
        label:   w.nom || `Arme ${idx+1}`,
        rawDice: w.degats || '1d4',
        dice:    w.degats || '1d4',
        portee:  parseInt(w.portee) || 1,
        actionDescription: w.info || '',   // effet complémentaire (ex : « Si touche, applique Poison »)
        pmCost:  0,
        toucher: toucherTotal,            // total numérique utilisé par les jets
        toucherMod: toucherTotal,         // pour l'affichage détaillé (formule 1d20 +X (stat))
        toucherSetBonus: 0,
        toucherStatLabel: tStat === 'none'
          ? (flatT ? 'fixe' : '')
          : (statShort(tStat) || tStat) + (flatT ? ` +${flatT}` : ''),
        dmgStatMod:   dStat === 'none' ? flatD : dMod + flatD,
        dmgStatLabel: dStat === 'none'
          ? (flatD ? 'fixe' : '—')
          : (statShort(dStat) || dStat) + (flatD ? ` +${flatD}` : ''),
        maitriseBonus: 0,
        halfOnMiss: false,
        weaponFormat: w.format || 'physique',   // Physique / Magique (descriptif)
        typeRules: getDamageTypeRules(_damageTypes, dtypeId),
        damageTypeId: dtypeId,
        damageTypeIcon: dtype?.icon || '',
        damageTypeColor: dtype?.color || '',
      });
    });
  }

  // 2) Legacy `attaques` : conservé en fallback si une vieille créature n'a pas
  //    encore été migrée vers armesNaturelles. N'apparaît que si aucune arme
  //    naturelle n'a été définie (pour éviter doublons pendant la transition).
  if (b && !options.length && Array.isArray(b.attaques) && b.attaques.length) {
    b.attaques.forEach((atk, idx) => {
      if (!atk.degats) return;
      const atkTypeId = atk.damageTypeId || null;
      const atkTypeObj = atkTypeId ? getDamageTypeById(_damageTypes, atkTypeId) : null;
      const atkTypeRules = atkTypeId ? getDamageTypeRules(_damageTypes, atkTypeId) : getDamageTypeRules(_damageTypes, 'physique');
      options.push({
        id:      `beast_${idx}`,
        icon:    '👹',
        label:   atk.nom || `Attaque ${idx+1}`,
        dice:    atk.degats,
        toucher: atk.toucher !== undefined && atk.toucher !== '' ? parseInt(atk.toucher)||0 : null,
        portee:  parseInt(atk.portee)||1,
        pmCost:  0,
        typeRules: atkTypeRules,
        damageTypeId: atkTypeId,
        damageTypeIcon: atkTypeObj?.icon || '',
        damageTypeColor: atkTypeObj?.color || '',
      });
    });
  }

  // ── Créature : actions/sorts unifiés (sorts du bestiaire) ───────────────
  // Construit un char synthétique depuis la créature et utilise les helpers
  // existants pour les formules de dégâts/soin/affliction/enchant.
  if (b && Array.isArray(b.actions) && b.actions.length) {
    const armesN = Array.isArray(b.armesNaturelles) ? b.armesNaturelles : [];
    const arme0  = armesN[0] || null;
    const bChar = {
      id:   b.id || `beast_${t.beastId}`,
      nom:  b.nom || 'Créature',
      stats: {
        force:        parseInt(b.force)        || 10,
        dexterite:    parseInt(b.dexterite)    || 10,
        intelligence: parseInt(b.intelligence) || 10,
        sagesse:      parseInt(b.sagesse)      || 10,
        constitution: parseInt(b.constitution) || 10,
        charisme:     parseInt(b.charisme)     || 10,
      },
      statsBonus: {},
      equipement: arme0 ? {
        'Main principale': {
          nom:         arme0.nom || 'Arme naturelle',
          degats:      arme0.degats || '1d4',
          degatsStat:  arme0.degatsStat  || 'force',
          degatsStats: [arme0.degatsStat || 'force'],
          toucherStat: arme0.toucherStat || arme0.degatsStat || 'force',
          statAttaque: arme0.toucherStat || arme0.degatsStat || 'force',
          portee:      arme0.portee || '',
          typeArme:    'CaC',
          format:      'Arme naturelle',
          sousType:    arme0.nom || '',
          traits:      [],
        },
      } : {},
      deck_sorts: b.actions, sort_cats: [], elements: [],
    };
    const bMainP   = bChar.equipement['Main principale'];
    const bStatKey = bMainP?.statAttaque || bMainP?.toucherStat || 'force';

    b.actions.forEach((s, actIdx) => {
      const baseRange = (s.portee != null && Number.isFinite(parseInt(s.portee)))
        ? parseInt(s.portee) : (parseInt(arme0?.portee) || 1);
      const pmRaw = (Number.isFinite(s.pmOverride) && s.pmOverride >= 0)
                    ? s.pmOverride : (parseInt(s.pm) || 0);
      const cout  = Math.max(0, pmRaw);

      options.push(_buildSpellOption(s, {
        id:    `beast_act_${actIdx}`,
        sortIdx: `b${actIdx}`,
        label: s.nom || `Action ${actIdx+1}`,
        c:     bChar,
        portee: baseRange,
        pmCost: cout, basePm: cout, pmRaw, pmSetDelta: 0,
        fallbackTouchStat: bStatKey, fallbackDmgStat: bStatKey,
        touchSetBonus: 0,
        enchantOnlyAlsoEtat: true,
      }));
    });
  }

  // Beast token : on n'enchaîne PAS sur les branches PNJ / personnage —
  // une créature n'a ni inventaire de PJ ni "poings" génériques.
  if (t.beastId) return options;

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
      damageTypeId: 'physique',
      damageTypeIcon: '💪',
      damageTypeColor: '#9ca3af',
    });
    return options;
  }

  // ── Arme invoquée active (buff weapon_replace) : remplace l'arme principale ──
  const _r0 = _session?.combat?.round ?? 0;
  const wReplace = (t.buffs || []).find(b => b?.type === 'weapon_replace'
    && (b.expiresAtRound == null || _r0 === 0 || _r0 <= b.expiresAtRound));

  // ── Arme principale du personnage (ou attaque générique) ──
  const weapon       = c?.equipement?.['Main principale'];
  const isUnarmed    = !wReplace && !weapon?.nom;
  // Stats actives : buff weapon_replace > équipement > poings
  const wDmgStats    = wReplace ? [wReplace.statDegats || 'force']
                                : isUnarmed ? ['force']
                                  : (weapon?.degatsStats?.length ? weapon.degatsStats : [weapon?.degatsStat || 'force']);
  const wTchStat     = wReplace ? (wReplace.statToucher || 'force')
                                : isUnarmed ? 'force'
                                  : (weapon?.toucherStats?.[0] || weapon?.toucherStat || wDmgStats[0]);
  const wDmgMod      = c ? wDmgStats.reduce((sum, s) => sum + getMod(c, s), 0) : 0;
  const wDmgStatLabel= wDmgStats.map(s => statShort(s) || s).join('+');
  const wTchMod      = c ? getMod(c, wTchStat)  : 0;
  const wSetBonus    = c ? (getArmorSetData(c).modifiers.toucherBonus || 0) : 0;
  const wMaitrise    = c && !wReplace && weapon ? getMaitriseBonus(c, weapon) : 0;
  // Règles de type de dégâts (missEffect, armorPen, dmgBonus)
  const wReplaceTypeId = wReplace?.element || 'physique';
  const fmt        = wReplace ? null : _weaponFormats?.find(f => f.label === weapon?.format);
  const isMagicW   = wReplace ? true : fmt?.isMagic === true;
  const typeRules  = wReplace
    ? getDamageTypeRules(_damageTypes, wReplaceTypeId)
    : (isMagicW
        ? getDamageTypeRules(_damageTypes, 'physique')
        : getDamageTypeRules(_damageTypes, fmt?.damageType || 'physique'));

  // Formule dés finale : arme invoquée → buff.weaponDice + mod stat ; sinon comportement actuel
  const wDmgDiceRaw = wReplace ? wReplace.weaponDice
                                : (isUnarmed ? '2d4' : (weapon?.degats || '1d6'));
  const wDmgDiceFinal = wReplace
    ? `${wReplace.weaponDice}${wDmgMod!==0?(wDmgMod>0?'+':'')+wDmgMod:''}`
    : (isUnarmed ? `2d4${wDmgMod!==0?(wDmgMod>0?'+':'')+wDmgMod:''}` : (ld.displayAttackDice || '1d6'));
  const wLabel = wReplace ? `⚔️ ${wReplace.weaponName} (invoquée)`
                          : (isUnarmed ? 'Coup de poing' : (weapon.nom || 'Attaque de base'));
  const wPortee = wReplace ? Math.max(1, wReplace.weaponRange || 1) : (ld.displayRange ?? 1);

  // ── Détecte un buff d'enchantement actif (purement visuel/marquage ici).
  // L'enchantement N'override PAS l'élément de l'arme : l'arme reste PHYSIQUE
  // (donc miss = 0 dégâts, pas de demi-dégâts). Le bonus s'ajoute uniquement
  // sur un coup réussi (géré dans _vttRollAttack). On garde juste le label
  // « · enchantée » et l'élément du bonus en métadonnée pour affichage.
  const _round_eff = _session?.combat?.round ?? 0;
  const _enchantBuff = (t.buffs || []).find(b =>
    b.type === 'dmg_bonus' && b.slot === 'arme'
    && (b.expiresAtRound == null || _round_eff === 0 || _round_eff <= b.expiresAtRound)
  );
  const _enchantDmgCondition = _conditionDmgBonusOf(t);
  // NB : le bonus toucher d'enchantement (toucher_bonus) n'est PAS baked ici —
  // il est ajouté frais au jet (_vttRollAttack) et au HUD pour rester à jour si
  // le buff est posé après la construction du panneau.
  const _wDefaultTypeId = wReplace ? wReplaceTypeId : (isMagicW ? null : (fmt?.damageType || 'physique'));
  const _wFinalTypeObj  = _wDefaultTypeId ? getDamageTypeById(_damageTypes, _wDefaultTypeId) : null;

  options.push({
    id:               'weapon',
    icon:             wReplace ? '🔮' : ((_enchantBuff || _enchantDmgCondition) ? '🪄' : (isUnarmed ? '👊' : '⚔️')),
    label:            wLabel + ((_enchantBuff || _enchantDmgCondition) ? ' · enchantée' : ''),
    rawDice:          wDmgDiceRaw,
    dice:             wDmgDiceFinal,
    portee:           wPortee,
    pmCost:           0,
    toucherMod:       wTchMod,
    toucherSetBonus:  wSetBonus,
    toucherStatLabel: statShort(wTchStat) || wTchStat,
    dmgStatMod:       wDmgMod,
    dmgStatLabel:     wDmgStatLabel,
    maitriseBonus:    wMaitrise,
    typeRules:        typeRules,           // règles d'arme PHYSIQUE inchangées
    damageTypeId:     _wDefaultTypeId,
    damageTypeIcon:   _wFinalTypeObj?.icon || (wReplace ? '✨' : ''),
    damageTypeColor: _wFinalTypeObj?.color || '',
    isMagicWeapon:    !!wReplace || (isMagicW && !isUnarmed),
    charElements:     wReplace ? [wReplaceTypeId] : ((isMagicW && !isUnarmed) ? (c?.elements || []) : []),
    isInvokedWeapon:  !!wReplace,
    enchantedElement: _enchantBuff?.element || null,
  });

  // ── Tous les sorts actifs du deck ──
  // Silence : si le porteur a un état avec cantCastSpells, on saute toute la
  // génération des options de sort. Les attaques d'arme restent disponibles.
  const _silenced = _hasConditionEffect(t, 'cantCastSpells');
  if (!_silenced && c?.deck_sorts?.length) {
    // Aligne sur le sheet : Poings (statAttaque=force) si rien équipé
    const mainP2      = getMainWeapon(c);
    const sStatKey    = mainP2?.statAttaque || mainP2?.toucherStat || 'force';
    const sStatMod    = getMod(c, sStatKey);
    // Réduction PM du set léger (spellPmDelta est négatif pour le set léger → coût réduit)
    const spellPmDelta = c ? (getArmorSetData(c).modifiers.spellPmDelta || 0) : 0;

    c.deck_sorts.forEach((s, idx) => {
      if (!s.actif) return;
      // Portée du sort : préserve EXPLICITEMENT 0 (sur soi uniquement).
      const baseRange = (s.portee != null && Number.isFinite(parseInt(s.portee)))
        ? parseInt(s.portee)
        : (ld.displayRange || 1);
      // Coût PM : pmOverride MJ > calc auto, puis delta set léger (clampé à 0 min),
      // puis vérification si cible gratuite (multi-cibles ou sort suspendu).
      const pmRaw     = (Number.isFinite(s.pmOverride) && s.pmOverride >= 0)
                        ? s.pmOverride : (parseInt(s.pm) || 0);
      const basePm    = Math.max(0, pmRaw + spellPmDelta);
      const freeKey   = `${t.id}_${idx}`;
      const freeCasts = _multiCastFree.get(freeKey) || 0;
      const isOneShot = _freeNextCast.has(freeKey);
      const cout      = (freeCasts > 0 || isOneShot) ? 0 : basePm;
      // Catégorie pour le tri dans le modal VTT
      const sortCats = c.sort_cats || [];
      const sortCat  = s.catId ? sortCats.find(ct => ct.id === s.catId) : null;
      const catMeta  = { catId: s.catId || null, catLabel: sortCat?.nom || null, catColor: sortCat?.couleur || null };

      options.push(_buildSpellOption(s, {
        id: `sort_${idx}`, sortIdx: idx, label: s.nom || `Sort ${idx+1}`,
        c,
        portee: baseRange,
        pmCost: cout, basePm, pmRaw, pmSetDelta: spellPmDelta,
        fallbackTouchStat: wTchStat,    fallbackDmgStat: sStatKey,
        fallbackTouchMod:  wTchMod,     fallbackDmgMod:  sStatMod,
        touchSetBonus: wSetBonus,
        enchantOnlyAlsoEtat: true,
        extras: catMeta,
      }));
    });
  }

  // ── Actions d'objets : traitées EXACTEMENT comme des sorts du deck ─────
  // Chaque item.actions[i] est un sort complet (mêmes champs que deck_sorts) :
  // noyau, runes, types, modes (Affliction DoT/État, Enchantement Dégâts/État…).
  // On réutilise donc tout le pipeline sort (_vttSpellMods, isAfflictionOnly, etc.)
  // en ajoutant juste les méta de consommation et d'identification objet.
  if (c && Array.isArray(c.inventaire)) {
    // Aligne sur le sheet : Poings (statAttaque=force) si rien équipé
    const mainP2I    = getMainWeapon(c);
    const sStatKeyI  = mainP2I?.statAttaque || mainP2I?.toucherStat || 'force';
    const spellPmDeltaI = getArmorSetData(c).modifiers.spellPmDelta || 0;

    // Indices d'inventaire actuellement équipés (un slot pointe vers l'objet
    // via sourceInvIndex). Les actions d'armes/armures ne sont accessibles que
    // si l'objet est équipé ; les consommables restent utilisables depuis l'inventaire.
    const equippedInvIdx = new Set(
      Object.values(c.equipement || {})
        .filter(e => e && Number.isInteger(e.sourceInvIndex))
        .map(e => e.sourceInvIndex)
    );

    c.inventaire.forEach((item, invIdx) => {
      const acts = Array.isArray(item?.actions) ? item.actions : [];
      if (!acts.length) return;
      // Silence bloque les actions d'objet non consommables, mais les potions,
      // parchemins et autres consommables restent utilisables depuis l'inventaire.
      if (_silenced && !item.consommable) return;
      // Arme / armure / bijou : utilisable seulement si équipé.
      // Consommable : utilisable depuis l'inventaire.
      if (!item.consommable && !equippedInvIdx.has(invIdx)) return;
      acts.forEach((s, actIdx) => {
        // Portée du sort : préserve EXPLICITEMENT 0 (sur soi uniquement).
        const baseRange = (s.portee != null && Number.isFinite(parseInt(s.portee)))
          ? parseInt(s.portee) : (ld.displayRange || 1);
        const pmRaw  = (Number.isFinite(s.pmOverride) && s.pmOverride >= 0)
                       ? s.pmOverride : (parseInt(s.pm) || 0);
        const basePm = Math.max(0, pmRaw + spellPmDeltaI);
        const cout   = basePm;

        // Méta objet (consommation à l'usage, identification)
        const itemMeta = {
          invIndex:    invIdx,
          itemId:      item.itemId || '',
          itemNom:     item.nom    || '',
          actionId:    s.id        || `a${actIdx}`,
          consommable: !!item.consommable,
        };

        const labelBase = s.nom || `Action ${actIdx+1}`;
        const fullLabel = `${item.nom || 'Objet'} — ${labelBase}`;

        options.push(_buildSpellOption(s, {
          id: `itemact_${invIdx}_${actIdx}`,
          sortIdx: `i${invIdx}_${actIdx}`,
          label: fullLabel,
          c,
          portee: baseRange,
          pmCost: cout, basePm, pmRaw, pmSetDelta: spellPmDeltaI,
          fallbackTouchStat: sStatKeyI, fallbackDmgStat: sStatKeyI,
          touchSetBonus: 0,
          // Différence historique : items ne déclenchent isEnchantOnly que pour enchantArmeDmg
          // (pas enchantEtatId). Préservé pour rétrocompat.
          enchantOnlyAlsoEtat: false,
          extras: { _itemAction: itemMeta },
        }));
      });
    });
  }

  // ── Stacking : si un objet est présent en N exemplaires (3 potions), on ne
  // veut PAS N×K lignes dans le picker — on déduplique par (item, action).
  // Pour les consommables : on affiche " (×N)" pour indiquer le stock restant.
  // Pour les non-consommables : pas de compteur (une seule entrée suffit).
  // L'entrée conservée (première rencontrée) garde son invIndex → _consumeItem
  // retire la 1ère copie correspondante via itemId/itemNom, donc le stack diminue
  // proprement au fil des usages.
  {
    const seen = new Map();
    const stacked = [];
    for (const o of options) {
      if (!o._itemAction) { stacked.push(o); continue; }
      const m = o._itemAction;
      const key = `${m.itemId || m.itemNom || ''}__${m.actionId || ''}`;
      const existing = seen.get(key);
      if (existing) {
        existing._itemAction.stackCount = (existing._itemAction.stackCount || 1) + 1;
        continue; // doublon écarté
      }
      o._itemAction.stackCount = 1;
      seen.set(key, o);
      stacked.push(o);
    }
    // Décorer les libellés des stacks > 1 pour les consommables
    for (const o of seen.values()) {
      const n = o._itemAction.stackCount;
      if (n > 1 && o._itemAction.consommable) {
        o.label = `${o.label} (×${n})`;
      }
    }
    options.length = 0;
    options.push(...stacked);
  }

  // ── Portée 0 = sur le lanceur uniquement (clic strict sur soi) ─────────
  // On garde portee=0 strict. Le filtre `inRange` ne sera satisfait que si
  // src === tgt (distance 0). targetSelf n'est PAS forcé : sinon l'option
  // apparaîtrait peu importe le clic. L'utilisateur doit cliquer sur son
  // propre token pour accéder à ces sorts.
  // Pour les actions explicitement "sur soi" via flag targetSelf (potions),
  // le comportement existant est préservé (l'option apparaît toujours).

  return options;
}

// Cache des options d'attaque — évite tout JSON/HTML dans les onclick
const _atkOptsCache = {};
// Contexte de l'attaque en cours (multi-étapes)
let _atkCtx = null;
// Sorts multi-cibles : casts gratuits restants — key: "${tokenId}_${sortIdx}"
const _multiCastFree = new Map();
// Sorts gratuits one-shot (déclenchement d'un sort suspendu) — Set<"${tokenId}_${sortIdx}">
const _freeNextCast = new Set();
// Flag : true pendant l'exécution d'un sort suspendu (évite la re-suspension en boucle)
let _suspendedTriggerActive = false;

/** Affiche le modal de sélection d'attaque. */
async function _execAttack(srcId, tgtId) {
  const src=_tokens[srcId]?.data, tgt=_tokens[tgtId]?.data;
  if (!src||!tgt) return;
  const lS=_live(src), lT=_live(tgt);
  const dist=_tokenAttackDistance(src, tgt);

  const options = _buildAttackOptions(src);
  // Les actions "sur soi" sont toujours disponibles (la portée et la distance n'ont pas de sens).
  const inRange = options.filter(o => o.targetSelf || _tokenAttackDistance(src, tgt, o.portee) <= o.portee);
  // Aucune attaque à portée : on bloque SAUF si on contrôle le token source —
  // dans ce cas la modale s'ouvre quand même pour les Actions de base
  // (Esquiver, Se cacher, Se désengager, Aider).
  if (!inRange.length && !_canControlToken(src)) {
    showNotif(`Hors de portée (${dist} case${dist>1?'s':''}, portée max ${Math.max(...options.map(o=>o.portee))})`, 'error');
    return;
  }
  if (!inRange.length) {
    showNotif(`Aucune attaque à portée (${dist} case${dist>1?'s':''}) — actions de base disponibles.`, 'info');
  }

  // Stocke les options dans un cache indexé — pas de JSON dans les onclick
  const cacheKey = `${srcId}__${tgtId}`;
  _atkOptsCache[cacheKey] = inRange;

  const pm = lS.displayPm, pmMax = lS.displayPmMax;
  const pmBar = (pm!=null)
    ? `<div class="vtt-atk-pm-bar">
        <span style="color:#b47fff">✨</span>
        <div class="vtt-atk-pm-track"><div class="vtt-atk-pm-fill" style="width:${pmMax>0?Math.round(pm/pmMax*100):0}%"></div></div>
        <span style="font-size:.72rem;color:#b47fff;font-weight:700">${pm}/${pmMax}</span>
      </div>` : '';

  // Séparer armes, sorts et actions d'objet
  const itemActOpts = inRange.filter(o => o._itemAction);
  const weaponOpts  = inRange.filter(o => !o._itemAction && o.sortIdx === undefined);
  const spellOpts   = inRange.filter(o => !o._itemAction && o.sortIdx !== undefined);

  // Grouper les sorts par catégorie (ordre des sort_cats du personnage)
  const srcChar   = _characters[src.characterId] || null;
  const sortCats  = srcChar?.sort_cats || [];
  const hasCats   = sortCats.length > 0 && spellOpts.some(o => o.catId);

  // Construire une map catId → opts (préserve l'ordre des sort_cats)
  const catMap = new Map();
  spellOpts.forEach(o => {
    const cId = o.catId || '__none';
    if (!catMap.has(cId)) catMap.set(cId, []);
    catMap.get(cId).push(o);
  });
  // Ordre : catégories connues d'abord (dans l'ordre du joueur), puis __none
  const catOrder = [
    ...sortCats.filter(c => catMap.has(c.id)),
    ...(catMap.has('__none') ? [{ id: '__none', nom: null, couleur: '#6b7280' }] : []),
  ];

  // Rendu d'un bouton option — card avec stats pills bien lisibles
  const _pill = (cls, html) => `<span class="vtt-aopt-pill ${cls}">${html}</span>`;
  const _optBtn = (o, i) => {
    const dist     = _tokenAttackDistance(src, tgt, o.portee);
    const canHit   = dist <= o.portee;
    const isHeal   = !!o.isHeal;
    const isUtil   = !!(o.isCaSort || o.isUtil);
    const stack    = o._itemAction?.stackCount > 1 && o._itemAction?.consommable
                       ? `<span class="vtt-aopt-stack">×${o._itemAction.stackCount}</span>` : '';
    const desc     = (o.actionDescription || '').trim();

    // Pills principales
    const pills = [];
    const targetSelf = !!o.targetSelf;
    const isEnchant  = !!o.isEnchant;

    // ── Type d'action en PREMIER (visible d'un coup d'œil) ─────────────
    if (o.actionType === 'bonus') {
      pills.push(_pill('action-bonus', `💫 Action Bonus`));
    } else if (o.actionType === 'reaction') {
      pills.push(_pill('action-reaction', `⚡ Réaction`));
    }
    // ── Coût en PM : badge dédié à DROITE du titre (pas en pill) ──────
    // Construit ici, injecté dans .vtt-aopt-head pour qu'il soit la 1re info
    // visible avec le nom du sort, sans noyer les pills techniques.
    let pmBadge = '';
    // Indicateur set léger : delta négatif → coût réduit visible sur le badge
    const _setReduc = o.pmSetDelta && o.pmSetDelta < 0;
    const _setExtra = _setReduc
      ? `<span class="vtt-aopt-pm-set" title="Set léger : −${-o.pmSetDelta} PM (coût brut ${o.pmRaw})">🍃 −${-o.pmSetDelta}</span>`
      : '';
    if (o.pmCost > 0) {
      pmBadge = `<span class="vtt-aopt-pm ${_setReduc?'vtt-aopt-pm--reduced':''}">🔮 ${o.pmCost} PM${_setExtra}</span>`;
    } else if (o.pmCost === 0 && o.basePm > 0) {
      pmBadge = `<span class="vtt-aopt-pm vtt-aopt-pm--free" title="Cast offert (multi-cibles ou sort suspendu déclenché)">🎁 Gratuit</span>`;
    } else if (o.basePm > 0) {
      pmBadge = `<span class="vtt-aopt-pm ${_setReduc?'vtt-aopt-pm--reduced':''}">🔮 ${o.basePm} PM${_setExtra}</span>`;
    }

    // Portée — si "soi-même", on n'affiche pas la portée (sans objet)
    if (!targetSelf) pills.push(_pill('range', `🎯 ${o.portee}c`));
    // Cible / zone / soi / allié / ennemi (selon le type de sort)
    const isFriendly = isEnchant || isHeal || o.isRegen; // alliés
    const isHostile  = !!o.isAffliction;             // ennemis explicites
    if (targetSelf) {
      pills.push(_pill('targets self', `🧍 Sur soi`));
    } else if (o.zoneW > 0 || o.zoneH > 0) {
      pills.push(_pill('zone', `📐 ${o.zoneW||o.zoneH}×${o.zoneH||o.zoneW}c`));
    } else if ((o.nbCibles || 1) > 1) {
      const lbl = isFriendly ? 'alliés' : isHostile ? 'ennemis' : 'cibles';
      pills.push(_pill('targets', `👥 ${o.nbCibles} ${lbl}`));
    } else if (isFriendly) {
      pills.push(_pill('targets single', `🤝 1 allié`));
    } else if (isHostile) {
      pills.push(_pill('targets single', `💢 1 ennemi`));
    } else {
      pills.push(_pill('targets single', `🎯 1 cible`));
    }
    // Effet principal de l'option (dégâts / soin / enchant / affliction / utilitaire)
    if (isEnchant) {
      // Sort d'enchantement : pas de dégâts d'impact, juste un buff/état sur l'allié
      const elemIcon = o.enchantElementIcon || '🪄';
      const elemCol  = o.enchantElementColor || '#a78bfa';
      if (o.enchantMode === 'etat' && o.enchantEtatId) {
        const lib = CONDITION_BY_ID[o.enchantEtatId];
        const lbl = lib ? `${lib.icon} ${lib.label} sur allié` : '✨ État sur allié';
        pills.push(`<span class="vtt-aopt-pill enchant" style="color:${elemCol};border-color:${elemCol}66;background:${elemCol}1a">${lbl}</span>`);
      } else if (o.enchantMode === 'toucher') {
        const b = o.mods?.enchantToucher?.bonus;
        pills.push(`<span class="vtt-aopt-pill enchant" style="color:#e8b84b;border-color:#e8b84b66;background:#e8b84b1a">🎯 +${b ?? '?'} au toucher / allié</span>`);
      } else if (o.enchantMode === 'deplacement') {
        const b = o.mods?.enchantMove?.bonusCells;
        pills.push(`<span class="vtt-aopt-pill enchant" style="color:#22c55e;border-color:#22c55e66;background:#22c55e1a">👢 +${b ?? '?'} case${b > 1 ? 's' : ''} de déplacement / allié</span>`);
      } else {
        pills.push(`<span class="vtt-aopt-pill enchant" style="color:${elemCol};border-color:${elemCol}66;background:${elemCol}1a">${elemIcon} +${_esc(o.enchantFormula || '1d4+2')} / arme alliée</span>`);
      }
    } else if (o.isRegen) {
      pills.push(`<span class="vtt-aopt-pill heal" style="color:#22c38e;border-color:#22c38e66;background:#22c38e1a">💚 ${_esc(o.dice || '2d4/tour')}</span>`);
    } else if (o.isAffliction) {
      // Sort d'affliction : pas de dégâts d'impact, JS de la cible → DoT ou État
      const elemIcon = o.afflictionElementIcon || '💀';
      const elemCol  = o.afflictionElementColor || '#ef4444';
      if (o.afflictionMode === 'etat' && o.afflictionEtatId) {
        const lib = CONDITION_BY_ID[o.afflictionEtatId];
        const lbl = lib ? `${lib.icon} ${lib.label}` : '⛓ État';
        pills.push(`<span class="vtt-aopt-pill" style="color:${elemCol};border-color:${elemCol}66;background:${elemCol}1a">${lbl}</span>`);
      } else {
        pills.push(`<span class="vtt-aopt-pill" style="color:${elemCol};border-color:${elemCol}66;background:${elemCol}1a">${elemIcon} ${_esc(o.afflictionDotFormula || '1d4')} / tour</span>`);
      }
      // Pill séparé pour le JS de sauvegarde
      const statLbl = (_STAT_SHORT[o.afflictionSaveStat] || o.afflictionSaveStat || '').toUpperCase();
      pills.push(_pill('save', `🛡 JS ${statLbl} DD ${o.afflictionDD}`));
    } else if (isUtil) {
      // Sort utilitaire : pas de damage pill, juste un résumé de l'effet
      const effetTxt = (o.dice || '').trim();
      pills.push(_pill('util', `🔧 ${effetTxt ? _esc(effetTxt) : 'Utilitaire'}`));
    } else if (o.rawDice || o.dice) {
      const formula = o.rawDice || o.dice;
      pills.push(_pill(isHeal ? 'heal' : 'dmg', `${isHeal ? '🩹' : '🎲'} ${isHeal ? '+' : ''}${_esc(formula)}${isHeal ? ' PV' : ''}`));
    }

    // Pill explicite de la stat utilisée (pour comprendre d'où vient le +X)
    if (o.dmgStatLabel && (o.dmgStatMod !== undefined && o.dmgStatMod !== null)) {
      const m = o.dmgStatMod;
      const modStr = m > 0 ? `+${m}` : m < 0 ? `${m}` : '±0';
      pills.push(_pill('stat', `📊 ${_esc(o.dmgStatLabel)} ${modStr}`));
    }
    // Traits courts
    if (o.traits?.length) {
      pills.push(`<span class="vtt-aopt-pill traits">${o.traits.slice(0,2).map(_esc).join(' · ')}</span>`);
    }

    // ── Couleur d'accent + pastille d'élément (langage visuel des cartes de sort) ──
    const accentCol = o.isHeal ? '#22c55e'
      : o.isEnchant ? (o.enchantElementColor || '#a78bfa')
      : o.isAffliction ? (o.afflictionElementColor || '#ef4444')
      : (o.isCaSort || o.isUtil) ? '#b47fff'
      : o.isMagicWeapon ? '#c084fc'
      : o.damageTypeColor ? o.damageTypeColor
      : (o.sortIdx !== undefined ? '#818cf8' : '#94a3b8');
    // Pastille d'élément (≈ noyau des cartes de sort) : seulement pour un VRAI
    // élément magique, pas le physique (sinon redondant avec l'icône de l'arme).
    const elemPastille = o.isMagicWeapon
      ? `<span class="cs-spellcard-noyau" style="--c:#c084fc" title="Élément choisi au lancement">🔮</span>`
      : (o.damageTypeIcon && o.damageTypeId && o.damageTypeId !== 'physique'
          ? `<span class="cs-spellcard-noyau" style="--c:${o.damageTypeColor||'#9ca3af'}" title="Élément">${o.damageTypeIcon}</span>` : '');
    // Chip de type d'action (même style que la carte de sort de la fiche).
    const actChip = o.actionType === 'bonus'
      ? `<span class="cs-spellcard-act" style="--c:#f97316">✴️ Bonus</span>`
      : o.actionType === 'reaction'
        ? `<span class="cs-spellcard-act" style="--c:#a78bfa">🔄 Réac.</span>`
        : `<span class="cs-spellcard-act" style="--c:#e8b84b">⚡ Act.</span>`;

    // Runes du sort (chips lecture seule) — comme sur la carte de la fiche perso.
    let runeChipsHtml = '';
    if (o.sortIdx !== undefined && srcChar?.deck_sorts) {
      const _s = srcChar.deck_sorts[o.sortIdx];
      const _runes = _vttDisplayRunes(_s?.runes || []);
      if (_runes.length) {
        const _counts = {}; _runes.forEach(r => { _counts[r] = (_counts[r]||0)+1; });
        runeChipsHtml = `<div class="cs-spellcard-runes">${Object.entries(_counts).map(([nom, n]) => {
          const m = _VTT_RUNE_META[nom] || { icon:'•', color:'#888' };
          return `<span class="cs-runechip" style="--c:${m.color}" title="${_esc(nom)}">${m.icon} ${_esc(nom)}${n>1?` ×${n}`:''}</span>`;
        }).join('')}</div>`;
      }
    }

    // Carte d'action — présentation identique aux cartes de sort de la fiche perso
    // (.cs-spellcard, scope .cs-v3), cliquable pour lancer.
    return `
      <button class="cs-spellcard vtt-castcard ${canHit?'':'is-oor'}" style="--type-col:${accentCol}" data-vtt-fn="_vttPickOpt" data-vtt-args="${srcId}|${tgtId}|${i}">
        <header class="cs-spellcard-head">
          <span class="cs-spellcard-icon">${o.icon}</span>
          <div class="cs-spellcard-id">
            <div class="cs-spellcard-name" title="${_esc(o.label)}">${_esc(o.label)}</div>
            <div class="cs-spellcard-sub">${actChip}${elemPastille}${stack}</div>
          </div>
          ${pmBadge}
        </header>
        ${pills.length ? `<div class="cs-spellcard-tags">${pills.join('')}</div>` : ''}
        ${runeChipsHtml}
        ${desc ? `<p class="cs-spellcard-desc">${_esc(desc)}</p>` : ''}
      </button>`;
  };

  // Construire le HTML des options groupées + tabs filtrables.
  // Chaque section porte data-tab-id, chaque option porte data-name pour la recherche.
  let optsHtml = '';
  const tabs = []; // { id, icon, title, color, count }
  const _section = (tabId, icon, title, color, count, body) => `
    <div class="vtt-aopt-section" data-tab-id="${tabId}">
      <div class="vtt-aopt-section-hd" style="--cat-col:${color}">
        <span class="vtt-aopt-section-icon">${icon}</span>
        <span class="vtt-aopt-section-title">${title}</span>
        <span class="vtt-aopt-section-count">${count}</span>
      </div>
      <div class="vtt-aopt-section-body">${body}</div>
    </div>`;
  const _optBtnWithName = (o, i) => {
    const html = _optBtn(o, i);
    const name = _norm(o.label || '').replace(/"/g, '');
    return html.replace('<button ', `<button data-name="${name}" `);
  };

  // ── 🛡 Arsenal : armes + actions d'objets (équipement physique) ──
  //   Regroupe ce qui est "immédiatement utilisable" depuis l'équipement,
  //   par opposition aux sorts (catégories dédiées) et au déplacement.
  const arsenalOpts = [...weaponOpts, ...itemActOpts];
  if (arsenalOpts.length) {
    const body = arsenalOpts.map(o => _optBtnWithName(o, inRange.indexOf(o))).join('');
    optsHtml += _section('arsenal', '🛡', 'Arsenal', '#94a3b8', arsenalOpts.length, body);
    tabs.push({ id:'arsenal', icon:'🛡', title:'Arsenal', color:'#94a3b8', count:arsenalOpts.length });
  }

  // ── Sorts (groupés par catégorie ou non) ──
  if (spellOpts.length) {
    if (hasCats) {
      catOrder.forEach(cat => {
        const catOpts = catMap.get(cat.id) || [];
        if (!catOpts.length) return;
        const title = cat.nom || 'Autres sorts';
        const color = cat.couleur || '#818cf8';
        const tabId = `cat_${cat.id}`;
        const body  = catOpts.map(o => _optBtnWithName(o, inRange.indexOf(o))).join('');
        optsHtml += _section(tabId, '✨', title, color, catOpts.length, body);
        tabs.push({ id:tabId, icon:'✨', title, color, count:catOpts.length });
      });
    } else {
      const body = spellOpts.map(o => _optBtnWithName(o, inRange.indexOf(o))).join('');
      optsHtml += _section('spells', '✨', 'Sorts', '#818cf8', spellOpts.length, body);
      tabs.push({ id:'spells', icon:'✨', title:'Sorts', color:'#818cf8', count:spellOpts.length });
    }
  }

  // ── Section Actions de base (Courir / Esquiver / Se cacher / Se désengager / Aider) ──
  // Disponibles dès que tu contrôles le token source (pas seulement en combat
  // formel : un allié peut tomber à 0 PV hors tracker d'initiative).
  const inCombat = !!_session?.combat?.active;
  const couru    = (src.bonusMvt || 0) > 0;
  const canEditSrc = _canControlToken(src);
  let basicHtml = '';
  if (canEditSrc) {
    // Carte d'action de base — même présentation (.cs-spellcard) que les sorts.
    const _basicCard = (icon, name, desc, col, fn, args) => `
        <button class="cs-spellcard vtt-castcard" style="--type-col:${col}" data-name="${_norm(name).replace(/"/g,'')}" data-vtt-fn="${fn}" data-vtt-args="${args}">
          <header class="cs-spellcard-head">
            <span class="cs-spellcard-icon">${icon}</span>
            <div class="cs-spellcard-id"><div class="cs-spellcard-name" title="${name}">${name}</div></div>
          </header>
          <div class="cs-spellcard-tags"><span class="vtt-aopt-pill" style="color:${col};border-color:${col}66">${desc}</span></div>
        </button>`;
    const selfBtn = (cond, icon, name, desc, col) =>
      _basicCard(icon, name, desc, col, '_vttSelfActionClose', `${srcId}|${cond}`);
    let bBody = '', bCount = 0;
    // Courir : combat actif et pas encore utilisé ce tour.
    if (inCombat && !couru) {
      bBody += _basicCard('🏃', 'Courir', `+${lS.displayMovement??6} cases ce tour`, '#4ade80', '_vttCourirAndClose', `${srcId}`);
      bCount++;
    }
    bBody += selfBtn('dodge', '🤸', 'Esquiver', 'Désavantage aux attaques contre toi', '#38bdf8'); bCount++;
    bBody += selfBtn('hidden', '🫥', 'Se cacher', 'Avantage à tes attaques · désav. contre toi', '#94a3b8'); bCount++;
    bBody += selfBtn('disengaged', '💨', 'Se désengager', 'Pas d\'attaque d\'opportunité ce tour', '#a3e635'); bCount++;
    // Aider : visible seulement si la cible est un allié à 0 PV.
    if (tgt && tgt.id !== srcId && (lT?.displayHp ?? null) === 0) {
      bBody += _basicCard('🤝', `Aider — relever ${_esc(lT.displayName??tgt.name)}`, 'Relève à 1 PV · retire ses états', '#fbbf24', '_vttAiderClose', `${srcId}|${tgt.id}`);
      bCount++;
    }
    basicHtml = _section('basic', '🎭', 'Actions de base', '#fbbf24', bCount, bBody);
    tabs.push({ id:'basic', icon:'🎭', title:'Actions', color:'#fbbf24', count:bCount });
  }

  // Tabs HTML : "Tous" en premier, puis une tab par catégorie (si plus d'une catégorie)
  const totalCount = tabs.reduce((s, t) => s + t.count, 0);
  const showTabs = tabs.length > 1;
  const tabsHtml = showTabs ? `
    <div class="vtt-aopt-tabs" role="tablist">
      <button type="button" class="vtt-aopt-tab is-active" data-tab="__all"
        data-vtt-fn="_vttAoptFilter" data-vtt-args="__all|$this">
        <span class="vtt-aopt-tab-ic">⚡</span>
        <span class="vtt-aopt-tab-lbl">Tous</span>
        <span class="vtt-aopt-tab-cnt">${totalCount}</span>
      </button>
      ${tabs.map(t => `
        <button type="button" class="vtt-aopt-tab" data-tab="${t.id}"
          style="--tab-col:${t.color}"
          data-vtt-fn="_vttAoptFilter" data-vtt-args="${t.id}|$this">
          <span class="vtt-aopt-tab-ic">${t.icon}</span>
          <span class="vtt-aopt-tab-lbl">${_esc(t.title)}</span>
          <span class="vtt-aopt-tab-cnt">${t.count}</span>
        </button>`).join('')}
    </div>` : '';

  const searchHtml = totalCount >= 6 ? `
    <div class="vtt-aopt-search">
      <span class="vtt-aopt-search-ic">🔍</span>
      <input type="text" class="vtt-aopt-search-input" placeholder="Filtrer par nom…"
        data-vtt-fn="_vttAoptSearch" data-vtt-on="input" data-vtt-args="$value" autofocus>
      <button type="button" class="vtt-aopt-search-clr" title="Effacer"
        data-vtt-fn="_vttClearAoptSearch" data-vtt-args="$this">✕</button>
    </div>` : '';

  openModal('⚔️ Choisir une action', `
    <div class="vtt-form vtt-aopt-modal">
      <div class="vtt-aopt-modal-hd">
        <div class="vtt-aopt-modal-targets">
          <span class="vtt-aopt-modal-src"><strong>${_esc(lS.displayName??src.name)}</strong></span>
          <span class="vtt-aopt-modal-arrow">→</span>
          <span class="vtt-aopt-modal-tgt"><strong>${_esc(lT.displayName??tgt.name)}</strong></span>
        </div>
        <span class="vtt-aopt-modal-dist" title="Distance source → cible">📏 ${dist}c</span>
      </div>
      ${pmBar}
      ${tabsHtml}
      ${searchHtml}
      <div class="vtt-aopt-list cs-v3">${optsHtml}${basicHtml}
        <div class="vtt-aopt-empty" style="display:none"><span style="opacity:.5">Aucune action ne correspond.</span></div>
      </div>
      <div class="vtt-aopt-footer">
        <button class="btn-secondary" data-action="close-modal">Annuler</button>
      </div>
    </div>`);
  // Marque #modal-box pour le styling spécifique (plus fiable que :has() seul).
  // Nettoyé à chaque réouverture (au cas où) et au close via observer.
  const box = document.getElementById('modal-box');
  if (box) {
    box.classList.add('modal--aopt');
    box.classList.remove('modal--atk');   // on revient au grand sélecteur (ex: bouton Retour)
    const overlay = document.getElementById('modal-overlay');
    if (overlay && !overlay._aoptObs) {
      const obs = new MutationObserver(() => {
        if (!overlay.classList.contains('show')) {
          box.classList.remove('modal--aopt', 'modal--atk');
        }
      });
      obs.observe(overlay, { attributes: true, attributeFilter: ['class'] });
      overlay._aoptObs = obs;
    }
  }
}

/** Filtre les sections du picker d'actions par tab. '__all' = tout afficher. */
function _vttAoptFilter(tabId, btn) {
  document.querySelectorAll('.vtt-aopt-tab').forEach(b => b.classList.remove('is-active'));
  btn?.classList.add('is-active');
  document.querySelectorAll('.vtt-aopt-section').forEach(s => {
    s.style.display = (tabId === '__all' || s.dataset.tabId === tabId) ? '' : 'none';
  });
  // Re-applique le filtre de recherche (au cas où)
  const q = document.querySelector('.vtt-aopt-search-input')?.value || '';
  if (q) _vttAoptSearch(q);
  else _vttAoptCheckEmpty();
}

/** Filtre les options du picker par texte (cherche dans data-name). */
function _vttAoptSearch(raw) {
  const q = _norm(raw || '');   // minuscules + sans accents (data-name est normalisé)
  const activeTab = document.querySelector('.vtt-aopt-tab.is-active')?.dataset.tab || '__all';
  document.querySelectorAll('.vtt-aopt-section').forEach(s => {
    const inTab = activeTab === '__all' || s.dataset.tabId === activeTab;
    if (!inTab) { s.style.display = 'none'; return; }
    let visibleCount = 0;
    s.querySelectorAll('.vtt-aopt').forEach(btn => {
      const name = btn.dataset.name || '';
      const match = !q || name.includes(q);
      btn.style.display = match ? '' : 'none';
      if (match) visibleCount++;
    });
    s.style.display = visibleCount > 0 ? '' : 'none';
    // Met à jour le compteur affiché — mémorise la valeur d'origine pour pouvoir restaurer
    const cnt = s.querySelector('.vtt-aopt-section-count');
    if (cnt) {
      if (cnt.dataset.origCount == null) cnt.dataset.origCount = cnt.textContent;
      cnt.textContent = q ? visibleCount : cnt.dataset.origCount;
    }
  });
  _vttAoptCheckEmpty();
}

function _vttAoptCheckEmpty() {
  const list = document.querySelector('.vtt-aopt-list');
  const empty = document.querySelector('.vtt-aopt-empty');
  if (!list || !empty) return;
  const anyVisible = !!list.querySelector('.vtt-aopt-section:not([style*="display: none"])');
  empty.style.display = anyVisible ? 'none' : '';
}

function _vttAttackModeControlsHtml(comment = 'Sélecteur de mode') {
  return `
    <!-- ${comment} -->
    <div style="margin-bottom:.85rem">
      <div style="font-size:.6rem;text-transform:uppercase;letter-spacing:.09em;color:var(--text-dim);margin-bottom:.4rem">Mode de lancer</div>
      <div style="display:flex;gap:2px;background:var(--border);border-radius:9px;padding:3px">
        <button id="atk-mode-dis" data-vtt-fn="_vttSetMode" data-vtt-args="dis"
          style="flex:1;padding:.5rem .3rem;border:none;border-radius:6px;cursor:pointer;font-family:inherit;
                 font-size:.7rem;line-height:1.35;background:transparent;color:var(--text-dim);transition:none">
          <div style="font-size:.9rem">⬇</div>Désavantage
        </button>
        <button id="atk-mode-normal" data-vtt-fn="_vttSetMode" data-vtt-args="normal"
          style="flex:1;padding:.5rem .3rem;border:none;border-radius:6px;cursor:pointer;font-family:inherit;
                 font-size:.75rem;font-weight:700;background:var(--bg-elevated);color:var(--text)">
          Normal
        </button>
        <button id="atk-mode-adv" data-vtt-fn="_vttSetMode" data-vtt-args="adv"
          style="flex:1;padding:.5rem .3rem;border:none;border-radius:6px;cursor:pointer;font-family:inherit;
                 font-size:.7rem;line-height:1.35;background:transparent;color:var(--text-dim);transition:none">
          <div style="font-size:.9rem">⬆</div>Avantage
        </button>
      </div>
    </div>
  `;
}
// Aperçu d'interaction élémentaire (immunité/résistance/faiblesse) — recalculable
// quand on change l'élément directement dans la modale d'attaque.
function _atkInteractionHtml(opt) {
  if (!opt || opt.isCaSort || opt.isUtil || opt.isHeal || !opt.damageTypeId) return '';
  const tids = (_atkCtx?.allTargets?.length ? _atkCtx.allTargets : (_atkCtx?.tgtId ? [_atkCtx.tgtId] : []));
  const buckets = {};
  for (const tid of tids) {
    const td = _tokens[tid]?.data;
    if (!td || td.type !== 'enemy' || !td.beastId) continue;
    const inter = previewDamageInteraction(opt.damageTypeId, _bestiary[td.beastId]);
    if (inter) buckets[inter] = (buckets[inter] || 0) + 1;
  }
  const entries = Object.entries(buckets);
  if (!entries.length) return '';
  const isMulti = tids.length > 1;
  const badges = entries.map(([label, n]) => {
    const meta = DAMAGE_INTERACTIONS[label] || { icon: 'ℹ️', color: 'var(--text-dim)', short: '' };
    return `<span style="display:inline-flex;align-items:center;gap:.25rem;font-size:.7rem;font-weight:700;
              color:${meta.color};background:${meta.color}1a;border:1px solid ${meta.color}55;
              padding:.18rem .45rem;border-radius:999px">
              ${meta.icon} ${_esc(label)}${isMulti ? ` ×${n}` : ''}
              <span style="font-size:.6rem;font-weight:400;opacity:.8">${meta.short}</span>
            </span>`;
  }).join(' ');
  return `<div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;font-size:.65rem;color:var(--text-dim);padding:.3rem .1rem 0">
    <span>🎯 Cible :</span>${badges}
  </div>`;
}

// Note "½ / dégâts complets même en cas d'échec" — dépend du type de dégâts (élément).
function _atkMissNoteHtml(opt) {
  if (opt?.typeRules?.missEffect === 'full') {
    return `<div style="display:flex;align-items:center;gap:.3rem;font-size:.65rem;color:#f97316;padding:.25rem .1rem 0">
      <span>✦</span><span>Dégâts complets même en cas d'échec</span></div>`;
  }
  if (opt?.typeRules?.missEffect === 'half' || opt?.pmCost > 0) {
    return `<div style="display:flex;align-items:center;gap:.3rem;font-size:.65rem;color:#b47fff;padding:.25rem .1rem 0">
      <span>✦</span><span>½ dégâts garantis même en cas d'échec${opt?.typeRules?.missEffect !== 'half' && opt?.pmCost > 0 ? ' (mana consommé)' : ''}</span></div>`;
  }
  return '';
}

// Change l'élément d'un sort multi-noyau DIRECTEMENT dans la modale d'attaque
// (plus de modale séparée). Met à jour le contexte du jet + l'affichage en place.
function _vttAtkSetElement(elemId) {
  const ctx = _atkCtx; if (!ctx?.opt) return;
  const t = getDamageTypeById(_damageTypes, elemId);
  ctx.opt.damageTypeId    = elemId;
  ctx.opt.typeRules       = getDamageTypeRules(_damageTypes, elemId);
  ctx.opt.damageTypeIcon  = t?.icon || '';
  ctx.opt.damageTypeColor = t?.color || '';
  document.querySelectorAll('.vtt-atk-elem').forEach(b => b.classList.toggle('is-active', b.dataset.elem === elemId));
  const ic = document.getElementById('atk-dmgtype-ic');
  if (ic) { ic.textContent = t?.icon || ''; ic.style.color = t?.color || '#9ca3af'; }
  const inter = document.getElementById('atk-interaction');
  if (inter) inter.innerHTML = _atkInteractionHtml(ctx.opt);
  const miss = document.getElementById('atk-miss-note');
  if (miss) miss.innerHTML = _atkMissNoteHtml(ctx.opt);
}

function _vttPickOpt(srcId, tgtId, idx) {
  const opt = _atkOptsCache[`${srcId}__${tgtId}`]?.[+idx];
  if (!opt) return;
  closeModalDirect();

  // Auto-cible le lanceur si l'action est marquée "sur soi" (potions, buffs perso, etc.)
  // → la cible cliquée à l'origine est ignorée, l'effet s'applique au lanceur.
  if (opt.targetSelf) tgtId = srcId;

  // NB : le choix de l'élément (sort multi-noyau OU arme magique) est désormais
  // INTÉGRÉ à la modale d'attaque (sélecteur en haut), plus de modale séparée.
  // On laisse donc tomber jusqu'à la modale finale (élément par défaut résolu là).

  // Sort de déplacement (rune Amplification mode Déplacement) : soi / pousse / attire.
  if (opt.mods?.deplacement && opt.sortIdx !== undefined && !_mtPending) {
    const d = opt.mods.deplacement;
    if (d.mode === 'self') _startSelfMove(srcId, opt, d.cells);
    else                   _vttCastPushPull(srcId, tgtId, opt, d);
    return;
  }

  // Sort à zone AoE : entrer en mode placement (sauf si on revient d'une validation)
  if ((opt.zoneW > 0 || opt.zoneH > 0) && opt.sortIdx !== undefined && !_mtPending) {
    _startZonePlacement(srcId, tgtId, opt, +idx);
    return;
  }

  // Sort multi-cibles : entrer en mode de sélection (sauf si on revient d'une validation)
  if ((opt.nbCibles || 1) > 1 && opt.sortIdx !== undefined && !_mtPending) {
    _startMultiTarget(srcId, tgtId, opt, +idx);
    return;
  }

  const src=_tokens[srcId]?.data, tgt=_tokens[tgtId]?.data;
  if (!src||!tgt) return;
  const lS=_live(src), lT=_live(tgt);
  // Si on arrive d'une validation multi-cibles, stocker les cibles dans le contexte
  const allTargets = _mtPending && _mtPending.length > 0 ? [..._mtPending] : null;
  _mtPending = null;

  // Arme magique : l'élément se choisit maintenant DANS cette modale (sélecteur en
  // haut), plus de modale séparée. On fixe un défaut tout de suite (1er élément
  // accessible, sinon physique) pour que les dégâts/aperçus s'affichent.
  if (opt.isMagicWeapon && !opt._mwElemReady) {
    const avail = (opt.charElements || []).map(id => getDamageTypeById(_damageTypes, id)).filter(Boolean);
    const def = avail[0] || getDamageTypeById(_damageTypes, 'physique');
    if (def) {
      opt.damageTypeId    = def.id;
      opt.typeRules       = getDamageTypeRules(_damageTypes, def.id);
      opt.damageTypeIcon  = def.icon || '';
      opt.damageTypeColor = def.color || '';
    }
    opt._mwElemReady = true;   // évite de réinitialiser à chaque réouverture (Retour)
  }

  _atkCtx = { srcId, tgtId, opt, lS, lT, allTargets };

  const dist    = _tokenAttackDistance(src, tgt);
  // Bonus toucher d'enchantement — lu frais sur le lanceur (jamais figé dans l'option)
  const _touchBuff = _touchBuffOf(src);
  const atkBase = (opt.toucher !== null && opt.toucher !== undefined ? opt.toucher : (lS.displayAttack ?? 5)) + _touchBuff;
  const sn      = n => n>0?`+${n}`:n<0?`${n}`:'';
  const tag     = (txt, col='var(--text-dim)') =>
    `<span style="font-size:.6rem;color:${col};margin-left:.05rem">(${txt})</span>`;

  // ── Cellule formule : ligne principale "dés +TOTAL" + petite légende du détail ──
  // Évite les longues lignes "1d6 +6 (Int) +2 (Maîtrise)" qui cassaient la mise en
  // forme : le total est regroupé, la provenance passe en sous-ligne discrète.
  const _mkCell = (leadHtml, total, parts, totalCol) => {
    const totStr = total ? ` <span style="font-size:.85rem;font-weight:700;color:${totalCol}">${sn(total)}</span>` : '';
    const bd = parts.filter(Boolean).join(' · ');
    return `<div style="display:flex;flex-direction:column;gap:1px;min-width:0">
      <div style="display:flex;align-items:baseline;gap:.25rem;flex-wrap:wrap">${leadHtml}${totStr}</div>
      ${bd ? `<div style="font-size:.58rem;color:var(--text-dim);line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${bd}</div>` : ''}
    </div>`;
  };

  // ── Formule toucher ────────────────────────────────────────────────
  let toucherFormula;
  if (opt.toucherMod !== undefined) {
    const parts = []; let tot = 0;
    if (opt.toucherMod)        { tot += opt.toucherMod;      parts.push(`${opt.toucherStatLabel} ${sn(opt.toucherMod)}`); }
    if (opt.toucherSetBonus>0) { tot += opt.toucherSetBonus; parts.push(`Set +${opt.toucherSetBonus}`); }
    if (_touchBuff>0)          { tot += _touchBuff;          parts.push(`🎯 Ench +${_touchBuff}`); }
    toucherFormula = _mkCell(`<code style="font-size:.88rem;color:var(--gold)">1d20</code>`, tot, parts, 'var(--gold)');
  } else {
    toucherFormula = _mkCell(`<code style="font-size:.88rem;color:var(--gold)">1d20</code>`, atkBase, [], 'var(--text-muted)');
  }

  // ── Formule dégâts / soin ────────────────────────────────────────────
  const dmgAccent = opt.isHeal ? '#22c38e' : '#ef4444';
  const _dmgIcon = `<span id="atk-dmgtype-ic" style="font-size:.85rem;color:${opt.damageTypeColor||'#9ca3af'}">${opt.damageTypeIcon||''}</span>`;
  let degatsFormula;
  if (opt.rawDice !== undefined) {
    const parts = []; let tot = 0;
    if (opt.dmgStatMod)        { tot += opt.dmgStatMod;     parts.push(`${opt.dmgStatLabel} ${sn(opt.dmgStatMod)}`); }
    if (opt.maitriseBonus>0)   { tot += opt.maitriseBonus;  parts.push(`Maîtrise +${opt.maitriseBonus}`); }
    degatsFormula = _mkCell(`${_dmgIcon} <code style="font-size:.88rem;color:${dmgAccent}">${opt.rawDice}</code>`, tot, parts, dmgAccent);
  } else {
    degatsFormula = _mkCell(`${_dmgIcon} <code style="font-size:.88rem;color:${dmgAccent}">${_esc(opt.dice)}</code>`, 0, [], dmgAccent);
  }

  const inpStyle = `width:52px;padding:4px 6px;text-align:center;font-size:.88rem;border-radius:7px;
    border:1px solid var(--border);background:var(--bg-base,var(--bg));color:var(--text);font-family:inherit`;

  // Bloc central conditionnel selon le type
  const isCastOnly = opt.isCaSort || opt.isUtil;
  const btnColor   = opt.isHeal ? '#22c38e' : isCastOnly ? '#b47fff' : 'var(--gold,#f59e0b)';
  const btnFg      = opt.isHeal || isCastOnly ? '#fff' : '#1a1a1a';
  const btnLabel   = opt.isHeal ? '💚 Soigner !' : isCastOnly ? '✨ Activer !' : '🎲 Lancer !';

  // ── Preview d'interaction (immunité / résistance / faiblesse / absorption) ──
  // Aperçu donné pour l'attaque offensive uniquement, et seulement si la cible
  // est une créature liée au bestiaire (les joueurs n'ont pas de profil).
  // Sélecteur d'élément intégré (sorts multi-noyau) — remplace l'ancienne modale.
  // Choix d'élément intégré : sort multi-noyau OU arme magique (≥ 2 éléments dispo).
  let _elemChoices = [];
  if (Array.isArray(opt.spellElementChoices) && opt.spellElementChoices.length > 1) {
    _elemChoices = opt.spellElementChoices.map(id => getDamageTypeById(_damageTypes, id)).filter(Boolean);
  } else if (opt.isMagicWeapon) {
    _elemChoices = (opt.charElements || []).map(id => getDamageTypeById(_damageTypes, id)).filter(Boolean);
  }
  const elemSelectorHtml = _elemChoices.length > 1 ? `
    <div class="vtt-atk-elemrow">
      <span class="vtt-atk-elemrow-lbl">🔮 Élément</span>
      <div class="vtt-atk-elems">
        ${_elemChoices.map(t => `<button type="button" class="vtt-atk-elem ${t.id===opt.damageTypeId?'is-active':''}" style="--ec:${t.color||'#9ca3af'}" data-vtt-fn="_vttAtkSetElement" data-vtt-args="${t.id}" title="${_esc(t.label)}">${t.icon||''} ${_esc(t.label)}</button>`).join('')}
      </div>
    </div>` : '';

  // ── Bloc spécifique Affliction (JS de la cible) ────────────────────
  const _STAT_SH = { force:'For', dexterite:'Dex', constitution:'Con', intelligence:'Int', sagesse:'Sag', charisme:'Cha' };
  const isAffCast = !!opt.isAffliction;
  const isEnchCast = !!opt.isEnchant;
  let utilBlock = '';
  if (isAffCast) {
    const statLbl = (_STAT_SH[opt.afflictionSaveStat] || opt.afflictionSaveStat || 'Con').toUpperCase();
    const dd = opt.afflictionDD;
    const effectLbl = opt.afflictionMode === 'etat' && opt.afflictionEtatId
      ? (() => { const l = CONDITION_BY_ID[opt.afflictionEtatId]; return l ? `${l.icon} ${l.label}` : 'État'; })()
      : `🩸 DoT ${opt.afflictionDotFormula}/tour`;
    utilBlock = `
      <div style="background:var(--bg-elevated);border-radius:10px;padding:.7rem .85rem;margin-bottom:.85rem;
                  border-left:3px solid #ef4444">
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.45rem">
          <span style="font-size:1.4rem">${opt.icon}</span>
          <div style="flex:1">
            <div style="font-size:.85rem;color:var(--text);font-weight:700">Affliction</div>
            <div style="font-size:.7rem;color:var(--text-dim)">Sur échec du JS : applique l'effet</div>
          </div>
        </div>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;font-size:.75rem">
          <span style="background:rgba(239,68,68,.14);color:#fca5a5;padding:.2rem .55rem;border-radius:999px;border:1px solid rgba(239,68,68,.35);font-weight:700">
            🛡 JS ${statLbl} DD ${dd}
          </span>
          <span style="background:rgba(139,92,246,.14);color:#c4b5fd;padding:.2rem .55rem;border-radius:999px;border:1px solid rgba(139,92,246,.35);font-weight:700">
            ${effectLbl}
          </span>
        </div>
      </div>`;
  } else if (isEnchCast) {
    const effectLbl = opt.enchantMode === 'etat' && opt.enchantEtatId
      ? (() => { const l = CONDITION_BY_ID[opt.enchantEtatId]; return l ? `${l.icon} ${l.label}` : 'État'; })()
      : opt.enchantMode === 'toucher'     ? `🎯 +${opt.mods?.enchantToucher?.bonus ?? '?'} au toucher`
      : opt.enchantMode === 'deplacement' ? `👢 +${opt.mods?.enchantMove?.bonusCells ?? '?'} déplacement`
      : `⚔️ +${opt.enchantFormula || '1d4+2'} / arme alliée`;
    utilBlock = `
      <div style="background:var(--bg-elevated);border-radius:10px;padding:.7rem .85rem;margin-bottom:.85rem;
                  border-left:3px solid #e8b84b">
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.45rem">
          <span style="font-size:1.4rem">${opt.icon}</span>
          <div style="flex:1">
            <div style="font-size:.85rem;color:var(--text);font-weight:700">Enchantement</div>
            <div style="font-size:.7rem;color:var(--text-dim)">Buff direct sur l'allié — pas de JS</div>
          </div>
        </div>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;font-size:.75rem">
          <span style="background:rgba(232,184,75,.14);color:#fbbf24;padding:.2rem .55rem;border-radius:999px;border:1px solid rgba(232,184,75,.35);font-weight:700">
            ${effectLbl}
          </span>
        </div>
      </div>`;
  }

  const centerBlock = (isAffCast || isEnchCast) ? utilBlock : isCastOnly ? `
    <div style="background:var(--bg-elevated);border-radius:10px;padding:.85rem;margin-bottom:.85rem;
                display:flex;align-items:center;gap:.6rem">
      <span style="font-size:1.2rem">${opt.icon}</span>
      <div style="flex:1;min-width:0">${degatsFormula}</div>
    </div>
  ` : opt.isHeal ? `
    <div style="background:var(--bg-elevated);border-radius:10px;padding:.7rem .85rem;margin-bottom:.85rem">
      <div style="display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;row-gap:.6rem;column-gap:.5rem">
        <div style="grid-column:1/3"></div>
        <span style="font-size:.55rem;text-align:center;color:var(--text-dim)">±mod</span>
        <span style="font-size:.55rem;text-align:center;color:var(--text-dim)">+dés</span>
        <span style="font-size:.68rem;color:#22c38e;white-space:nowrap">💚 Soin</span>
        ${degatsFormula}
        <input type="number" id="atk-bonus-dmg" value="0" style="${inpStyle}" placeholder="0" title="Bonus / malus flat au soin">
        <input type="number" id="atk-bonus-dmg-dice" value="0" min="-9" max="20" style="${inpStyle}" placeholder="0" title="Dés bonus au soin (même type de dé)">
        <div style="grid-column:1/-1;font-size:.62rem;color:var(--text-dim);font-style:italic;padding-top:.15rem">
          ✦ Jet de toucher (DD 2) — vise les critiques 💥 et les fumbles 💔
        </div>
      </div>
    </div>
    ${_vttAttackModeControlsHtml('Sélecteur de mode (Avantage / Normal / Désavantage) — partagé avec les attaques')}
  ` : `
    <div style="background:var(--bg-elevated);border-radius:10px;padding:.7rem .85rem;margin-bottom:.85rem">
      <div style="display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;row-gap:.6rem;column-gap:.5rem">
        <div style="grid-column:1/3"></div>
        <span style="font-size:.55rem;text-align:center;color:var(--text-dim)">±mod</span>
        <span style="font-size:.55rem;text-align:center;color:var(--text-dim)">+dés</span>
        <span style="font-size:.68rem;color:var(--text-dim);white-space:nowrap">🎯 Toucher</span>
        ${toucherFormula}
        <input type="number" id="atk-bonus-hit" value="0" style="${inpStyle}" placeholder="0" title="Bonus flat au toucher">
        <input type="number" id="atk-bonus-hit-dice" value="0" min="-9" max="20" style="${inpStyle}" placeholder="0" title="d20 supplémentaires au toucher (sommés)">

        <div style="grid-column:1/-1;height:1px;background:var(--border);margin:-.1rem 0"></div>

        <span style="font-size:.68rem;color:var(--text-dim);white-space:nowrap">⚔️ Dégâts</span>
        ${degatsFormula}
        <input type="number" id="atk-bonus-dmg" value="0" style="${inpStyle}" placeholder="0" title="Bonus flat aux dégâts">
        <input type="number" id="atk-bonus-dmg-dice" value="0" min="-9" max="20" style="${inpStyle}" placeholder="0" title="Dés supplémentaires aux dégâts (même type)">
        <div id="atk-miss-note" style="grid-column:1/-1">${_atkMissNoteHtml(opt)}</div>
        <div id="atk-interaction" style="grid-column:1/-1">${_atkInteractionHtml(opt)}</div>
      </div>
    </div>
    ${_vttAttackModeControlsHtml()}
  `;

  openModal(`${opt.icon} ${opt.label}`, `
    <div class="vtt-form" style="min-width:260px;max-width:340px">

      <!-- En-tête : retour + attaquant → cible(s) -->
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.85rem">
        <button data-vtt-fn="_vttBackToAtk"
          style="flex-shrink:0;display:flex;align-items:center;gap:.25rem;background:none;
                 border:1px solid var(--border);border-radius:7px;color:var(--text-dim);
                 cursor:pointer;font-family:inherit;font-size:.75rem;padding:.3rem .55rem;
                 white-space:nowrap">
          ← Retour
        </button>
        <div style="flex:1;min-width:0;text-align:center;overflow:hidden;text-overflow:ellipsis;font-size:.82rem">
          <strong>${_esc(lS.displayName??src.name)}</strong>
          <span style="color:var(--text-dim);margin:0 .3rem">→</span>
          ${allTargets && allTargets.length > 1
            ? `<strong style="color:#4f8cff">🎯 ${allTargets.length} cibles</strong>`
            : `<strong style="color:${opt.isHeal?'#22c38e':'#ef4444'}">${_esc(lT.displayName??tgt.name)}</strong>`}
        </div>
        <span style="flex-shrink:0;font-size:.62rem;color:var(--text-dim);background:var(--bg-elevated);
                     padding:.18rem .45rem;border-radius:999px">${dist}c</span>
      </div>
      ${allTargets && allTargets.length > 1 ? `
      <div style="display:flex;flex-wrap:wrap;gap:.3rem;margin-bottom:.7rem">
        ${allTargets.map(id => {
          const td = _tokens[id]?.data;
          const nm = td ? (_live(td).displayName ?? td.name ?? id) : id;
          return `<span style="font-size:.65rem;padding:.15rem .45rem;border-radius:999px;
            background:rgba(79,140,255,.12);border:1px solid rgba(79,140,255,.3);color:#4f8cff">${_esc(nm)}</span>`;
        }).join('')}
      </div>` : ''}

      ${elemSelectorHtml}

      ${centerBlock}

      <!-- Effet complémentaire de l'attaque (ex : « Si touche, applique Poison ») -->
      ${opt.actionDescription ? `
      <div style="display:flex;gap:.4rem;font-size:.72rem;color:var(--text-soft);line-height:1.35;
                  background:rgba(232,184,75,.08);border:1px solid rgba(232,184,75,.25);
                  border-radius:8px;padding:.45rem .6rem;margin-bottom:.7rem">
        <span>ℹ️</span><span>${_esc(opt.actionDescription)}</span>
      </div>` : ''}

      <!-- Infos zone / multi-cibles + PM -->
      ${(opt.zoneW>0||opt.zoneH>0) || (opt.nbCibles||1) > 1 || opt.pmCost > 0 || (opt.pmCost===0 && opt.basePm>0) ? `
      <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.7rem">
        ${(opt.zoneW>0||opt.zoneH>0)?`<span style="font-size:.7rem;color:#f97316;display:flex;align-items:center;gap:.25rem">
          📐 Zone <strong style="color:#fde047">${opt.zoneW}×${opt.zoneH} cases</strong>
          · <strong>${allTargets?.length||1}</strong> cible${(allTargets?.length||1)>1?'s':''}
          ${opt.pmCost===0&&opt.basePm>0?'<span style="color:#22c38e;font-size:.65rem">(PM déjà payé)</span>':''}
        </span>`:''}
        ${!(opt.zoneW>0||opt.zoneH>0)&&(opt.nbCibles||1)>1?`<span style="font-size:.7rem;color:#4f8cff;display:flex;align-items:center;gap:.25rem">
          🎯 <strong>${opt.nbCibles}</strong> cibles différentes
          ${opt.pmCost===0&&opt.basePm>0?'<span style="color:#22c38e;font-size:.65rem">(PM déjà payé)</span>':''}
        </span>`:''}
        ${opt.pmCost>0?`<span style="font-size:.7rem;color:#b47fff">✨ ${opt.pmCost} PM</span>`:''}
        ${opt.pmCost===0&&opt.basePm>0&&(opt.nbCibles||1)<=1&&!(opt.zoneW>0||opt.zoneH>0)?`<span style="font-size:.7rem;color:#22c38e">✨ Gratuit</span>`:''}
      </div>` : ''}

      <!-- Bouton Lancer -->
      <input type="hidden" id="atk-mode" value="normal">
      <button data-vtt-fn="_vttRollAttack"
        style="width:100%;height:46px;border:none;border-radius:10px;cursor:pointer;font-family:inherit;
               font-size:.95rem;font-weight:700;letter-spacing:.02em;
               background:${btnColor};color:${btnFg}">
        ${btnLabel}
      </button>

    </div>`);
  // Cette modale (jet) n'est PAS le grand sélecteur d'actions : on bascule sur une
  // largeur ajustée au formulaire (.modal--atk) et on retire la large .modal--aopt
  // (héritée car l'overlay n'est pas masqué entre les deux) → plus de boîte 808px
  // avec un formulaire étroit qui flotte.
  const _mb = document.getElementById('modal-box');
  if (_mb) { _mb.classList.remove('modal--aopt'); _mb.classList.add('modal--atk'); }
}

function _vttCancelAtk() { _atkCtx=null; closeModalDirect(); }
function _closeActionModal() { closeModalDirect(); }

/** Affiche le sélecteur d'élément pour une arme magique. */
function _vttPickElement(srcId, tgtId, optIdx, elementId) {
  const cacheKey = `${srcId}__${tgtId}`;
  const opt = _atkOptsCache[cacheKey]?.[+optIdx];
  if (!opt) return;
  const typeRules  = getDamageTypeRules(_damageTypes, elementId);
  const elemType   = getDamageTypeById(_damageTypes, elementId);
  _atkOptsCache[cacheKey][+optIdx] = {
    ...opt,
    isMagicWeapon:    false,
    spellElementChoices: null,   // élément choisi → ne plus redemander
    typeRules,
    damageTypeId:     elementId,
    damageTypeIcon:   elemType?.icon  || '',
    damageTypeColor:  elemType?.color || '',
  };
  closeModalDirect();
  _vttPickOpt(srcId, tgtId, +optIdx);
}

/** Sélecteur d'élément pour un sort multi-noyau (réutilise _vttPickElement). */
/** Retourne à la liste de sélection d'attaque sans annuler le combat. */
function _vttBackToAtk() {
  const ctx = _atkCtx;
  closeModalDirect();
  _atkCtx = null;
  if (ctx) _execAttack(ctx.srcId, ctx.tgtId);
}

/** Met à jour le toggle Désavantage / Normal / Avantage. */
function _vttSetMode(mode) {
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
}

// ═══════════════════════════════════════════════════════════════════
// MULTI-CIBLAGE — sélection visuelle pour les sorts multi-cibles
// ═══════════════════════════════════════════════════════════════════

/** Centre pixel d'un token dans le repère Konva (tient compte de la taille W×H). */
function _tokenCenter(t) {
  const d = _tokenDims(t);
  return { x: t.col * CELL + d.w * CELL / 2, y: t.row * CELL + d.h * CELL / 2 };
}

/** Dessine une ligne pointillée src→tgt sur le layer token. */
function _mtDrawLine(srcData, tgtData, color) {
  const K = window.Konva; if (!K || !_layers.token) return null;
  const s = _tokenCenter(srcData), t = _tokenCenter(tgtData);
  const line = new K.Line({
    points: [s.x, s.y, t.x, t.y],
    stroke: color || '#c084fc',
    strokeWidth: 2.5,
    dash: [10, 6],
    lineCap: 'round',
    opacity: 0.9,
    listening: false,
    name: 'mt-line',
  });
  _layers.token.add(line);
  _layers.token.batchDraw();
  return line;
}

/** Supprime toutes les lignes du contexte local. */
function _mtClearLines() {
  if (!_mtCtx?.lines) return;
  _mtCtx.lines.forEach(l => l.destroy());
  _mtCtx.lines.clear();
  _layers.token?.batchDraw();
}

/** Supprime les lignes distantes (broadcast). */
function _clearRemoteLines() {
  _layers.token?.find('.remote-mt-line').forEach(l => l.destroy());
  _layers.token?.batchDraw();
}

/** Affiche ou met à jour le HUD flottant. */
function _mtRefreshHud() {
  const existing = document.getElementById('vtt-mt-hud');
  if (existing) existing.remove();
  if (!_mtCtx) return;

  const { opt, targets, maxTargets } = _mtCtx;
  const names = targets.map(id => {
    const td = _tokens[id]?.data;
    return td ? (_live(td).displayName ?? td.name ?? id) : id;
  });
  const remaining = maxTargets - targets.length;

  const div = document.createElement('div');
  div.id = 'vtt-mt-hud';
  div.className = 'vtt-mt-hud';
  div.innerHTML = `
    <div class="vtt-mt-hud-header">
      <span>${opt.icon} <strong>${_esc(opt.label)}</strong></span>
      <span class="vtt-mt-hud-count">${targets.length} / ${maxTargets}</span>
    </div>
    <div class="vtt-mt-hud-chips">
      ${names.map(n => `<span class="vtt-mt-chip vtt-mt-chip--sel">${_esc(n)}</span>`).join('')}
      ${remaining > 0 ? `<span class="vtt-mt-chip vtt-mt-chip--empty">+${remaining} cible${remaining > 1 ? 's' : ''}</span>` : ''}
    </div>
    <div class="vtt-mt-hud-hint">Cliquez sur les tokens cibles · Entrée = valider</div>
    <div class="vtt-mt-hud-actions">
      <button class="vtt-mt-btn-cancel" data-vtt-fn="_mtCancel">✕ Annuler</button>
      <button class="vtt-mt-btn-validate" data-vtt-fn="_mtValidate"
        ${targets.length === 0 ? 'disabled' : ''}>✓ Valider (${targets.length})</button>
    </div>`;
  document.body.appendChild(div);

  // Entrée = valider
  const _hudKey = e => { if (e.key === 'Enter') _mtValidate(); if (e.key === 'Escape') _mtCancel(); };
  div._hudKey = _hudKey;
  document.addEventListener('keydown', _hudKey, { once: false });
  div._removeKey = () => document.removeEventListener('keydown', _hudKey);
}

/** Broadcast l'état du ciblage à tous les clients via Firestore. */
async function _mtBroadcast() {
  const uid = STATE.user?.uid || 'anon';
  if (!_mtCtx) {
    if (_mtBroadcasting) {
      _mtBroadcasting = false;
      await setDoc(_castingRef(uid), { active: false }, { merge: true }).catch(() => {});
    }
    return;
  }
  const { srcId, targets, opt } = _mtCtx;
  _mtBroadcasting = true;
  await setDoc(_castingRef(uid), {
    active: true, srcId, targets,
    spellName: opt.label, spellIcon: opt.icon,
    pageId: _activePage?.id || null,
    updatedAt: Date.now(),
  }).catch(() => {});
}

/** Supprime lignes, HUD, contexte et broadcast. */
function _mtClear(broadcast = true) {
  _zoneClear();
  const hud = document.getElementById('vtt-mt-hud');
  if (hud?._removeKey) hud._removeKey();
  hud?.remove();
  _mtClearLines();
  _mtCtx = null;
  if (broadcast && _mtBroadcasting) {
    const uid = STATE.user?.uid || 'anon';
    _mtBroadcasting = false;
    setDoc(_castingRef(uid), { active: false }, { merge: true }).catch(() => {});
  }
}

/** Entre en mode ciblage pour un sort multi-cibles. */
function _startMultiTarget(srcId, firstTgtId, opt, optIdx) {
  _mtClear(false);
  _mtCtx = { srcId, opt, optIdx, targets: [firstTgtId], maxTargets: opt.nbCibles, lines: new Map() };

  const srcData = _tokens[srcId]?.data, tgtData = _tokens[firstTgtId]?.data;
  if (srcData && tgtData) {
    const line = _mtDrawLine(srcData, tgtData);
    if (line) _mtCtx.lines.set(firstTgtId, line);
  }

  _mtRefreshHud();
  _mtBroadcast();
}

/** Bascule une cible dans/hors de la sélection. */
function _mtToggleTarget(tgtId) {
  if (!_mtCtx) return;
  const { srcId, targets, maxTargets, lines } = _mtCtx;
  const idx = targets.indexOf(tgtId);

  if (idx !== -1) {
    targets.splice(idx, 1);
    lines.get(tgtId)?.destroy();
    lines.delete(tgtId);
    _layers.token?.batchDraw();
  } else {
    if (targets.length >= maxTargets) {
      showNotif(`Maximum ${maxTargets} cibles pour ce sort`, 'error');
      return;
    }
    const srcData = _tokens[srcId]?.data, tgtData = _tokens[tgtId]?.data;
    if (srcData && tgtData) {
      const portee = _mtCtx.opt.portee || 1;
      const dist = _tokenAttackDistance(srcData, tgtData, portee);
      if (dist > portee) {
        showNotif(`Hors de portée (${dist}c — portée du sort : ${portee}c)`, 'error');
        return;
      }
    }
    targets.push(tgtId);
    if (srcData && tgtData) {
      const line = _mtDrawLine(srcData, tgtData);
      if (line) lines.set(tgtId, line);
    }
  }

  _mtRefreshHud();
  _mtBroadcast();
}

function _mtCancel() { _mtClear(); showNotif('Ciblage annulé', 'info'); }

function _mtValidate() {
  if (!_mtCtx || _mtCtx.targets.length === 0) return;
  const { srcId, opt, optIdx, targets } = _mtCtx;

  // Stocker les cibles avant de vider le contexte
  _mtPending = [...targets];
  _mtClear(true);

  // Rouvrir le modal d'attaque pour cette sélection (en sautant le re-ciblage)
  // On utilise la première cible comme tgtId pour l'affichage modal
  const firstTgt = targets[0];
  const cacheKey = `${srcId}__${firstTgt}`;
  // Le cache peut ne pas exister pour firstTgt si ce n'est pas la cible initiale
  // → on reconstruire le cache pour cette cible
  const src = _tokens[srcId]?.data; if (!src) { _mtPending = null; return; }
  const tgtData = _tokens[firstTgt]?.data; if (!tgtData) { _mtPending = null; return; }
  const options = _buildAttackOptions(src);
  const inRange = options.filter(o => _tokenAttackDistance(src, tgtData, o.portee) <= o.portee);
  _atkOptsCache[cacheKey] = inRange;
  // Réutilise l'option DÉJÀ résolue (élément multi-noyau choisi, spellElementChoices
  // effacé) au lieu de l'option fraîchement reconstruite : sinon le picker d'élément
  // se redéclencherait → boucle élément/cibles, et l'élément choisi serait perdu.
  _atkOptsCache[cacheKey][optIdx] = opt;

  // Appeler _vttPickOpt — _mtPending non null empêche la re-entrée en mode ciblage
  _vttPickOpt(srcId, firstTgt, optIdx);
}

// ── Zone AoE ──────────────────────────────────────────────────────────

/** Supprime la prévisualisation zone et son HUD. */
function _zoneClear() {
  const hud = document.getElementById('vtt-zone-hud');
  if (hud?._removeKey) hud._removeKey();
  hud?.remove();
  _zonePreview?.destroy();
  _zonePreview = null;
  _zoneCtx = null;
  _layers.token?.batchDraw();
}

/** (Re)Construit le rectangle Konva de prévisualisation. */
function _buildZonePreview() {
  if (!_zoneCtx || !_layers.token) return;
  _zonePreview?.destroy();
  const K = window.Konva;
  const { wPx, hPx, x, y } = _zoneCtx;
  const group = new K.Group({ x, y, listening: false, name: 'zone-preview' });
  group.add(new K.Rect({
    x: -wPx / 2, y: -hPx / 2,
    width: wPx, height: hPx,
    fill: 'rgba(253,224,71,0.22)',
    stroke: '#fde047',
    strokeWidth: 3, dash: [10, 5],
    cornerRadius: 3, listening: false,
  }));
  // Halo intérieur pour la lisibilité sur fond clair ou sombre
  group.add(new K.Rect({
    x: -wPx / 2 + 2, y: -hPx / 2 + 2,
    width: wPx - 4, height: hPx - 4,
    fill: 'transparent',
    stroke: 'rgba(253,224,71,0.45)',
    strokeWidth: 1, listening: false,
  }));
  group.add(new K.Text({
    x: -wPx / 2 + 5, y: -hPx / 2 + 4,
    text: `${_zoneCtx.opt.zoneW}×${_zoneCtx.opt.zoneH}c`,
    fill: '#fde047', fontSize: 11, fontStyle: 'bold', listening: false,
  }));
  _layers.token.add(group);
  _zonePreview = group;
  _layers.token.batchDraw();
}

/** Déplace la prévisualisation si la zone n'est pas posée. */
function _zoneUpdatePreview(wp) {
  if (!_zoneCtx || !_zonePreview || _zoneCtx.placed) return;
  const { wPx, hPx } = _zoneCtx;
  // Snapper le coin haut-gauche sur la grille (pas le centre)
  const snapX = Math.round((wp.x - wPx / 2) / CELL) * CELL + wPx / 2;
  const snapY = Math.round((wp.y - hPx / 2) / CELL) * CELL + hPx / 2;
  _zoneCtx.x = snapX; _zoneCtx.y = snapY;
  _zonePreview.position({ x: snapX, y: snapY });
  _layers.token.batchDraw();
}

/** Affiche le HUD de placement de zone. */
function _showZoneHud() {
  document.getElementById('vtt-zone-hud')?.remove();
  const opt = _zoneCtx.opt;
  const hud = document.createElement('div');
  hud.id = 'vtt-zone-hud';
  hud.className = 'vtt-mt-hud';
  hud.innerHTML = `
    <div class="vtt-mt-hud-header">
      <span>${_esc(opt.icon || '✨')} ${_esc(opt.label)}</span>
      <span class="vtt-mt-hud-count" style="color:#fde047;background:rgba(253,224,71,.12);border-color:rgba(253,224,71,.35)">📐 ${opt.zoneW}×${opt.zoneH} cases</span>
    </div>
    <div class="vtt-zone-hint">
      Déplacez · Clic = poser/reprendre · <kbd>R</kbd> = tourner · <kbd>Entrée</kbd> = valider
    </div>
    <div class="vtt-mt-hud-actions">
      <button class="vtt-mt-btn-cancel"   data-vtt-fn="_zoneCancel">✕ Annuler</button>
      <button class="vtt-mt-btn-validate" data-vtt-fn="_zoneValidate">✓ Valider</button>
    </div>`;
  const onKey = e => {
    if (e.key === 'Enter')              { e.preventDefault(); _zoneValidate(); }
    if (e.key === 'Escape')             _zoneCancel();
    if (e.key === 'r' || e.key === 'R') _zoneRotate();
  };
  document.addEventListener('keydown', onKey);
  hud._removeKey = () => document.removeEventListener('keydown', onKey);
  document.body.appendChild(hud);
}

/** Entre en mode placement de zone pour un sort AoE. */
function _startZonePlacement(srcId, tgtId, opt, optIdx) {
  // Invocation : on choisit d'abord les créatures (sélecteur au lancement), puis on
  // place. La sélection (opt._invSelIds) pilote le nombre de placements.
  if (opt?.mods?.invocation && !opt._invSelDone) {
    _vttPickInvocations(srcId, tgtId, opt, optIdx);
    return;
  }
  _zoneClear();
  _mtCtx = null; // annuler multi-cibles sans broadcast (zone prend la main)
  const wPx = opt.zoneW * CELL;  // zoneW/H = nombre de cases
  const hPx = opt.zoneH * CELL;
  // Nombre de placements : invocations choisies au lancement, sinon sentinelle (Dispersion) / 1.
  const nbInvoc = (opt._invSelIds && opt._invSelIds.length)
    ? opt._invSelIds.length
    : (opt?.mods?.sentinelle?.nbInvocations || opt?.mods?.invocation?.nbInvocations || 1);
  _zoneCtx = {
    srcId, tgtId, opt, optIdx, wPx, hPx, x: 0, y: 0, placed: false,
    invocationsTotal: nbInvoc,
    invocationsDone: 0,
  };
  _buildZonePreview();
  _showZoneHud();
}

function _zoneCancel() { _zoneClear(); showNotif('Zone annulée', 'info'); }

function _zoneRotate() {
  if (!_zoneCtx) return;
  [_zoneCtx.wPx, _zoneCtx.hPx] = [_zoneCtx.hPx, _zoneCtx.wPx];
  _buildZonePreview();
  _zonePreview?.position({ x: _zoneCtx.x, y: _zoneCtx.y });
  _layers.token?.batchDraw();
}

async function _zoneValidate() {
  if (!_zoneCtx) return;
  const { srcId, opt, wPx, hPx, x, y } = _zoneCtx;

  // Vérification portée : centre de la zone vs lanceur
  const srcData = _tokens[srcId]?.data;
  if (srcData) {
    const sc = _tokenCenter(srcData);
    const distCells = Math.hypot(x - sc.x, y - sc.y) / CELL;
    if (distCells > (opt.portee || 1) + 0.5) {
      showNotif(`Zone hors de portée (${Math.round(distCells)}c — portée : ${opt.portee}c)`, 'error');
      return;
    }
  }

  // Détection des tokens dans le rectangle (centré sur x, y)
  const x1 = x - wPx / 2, x2 = x + wPx / 2;
  const y1 = y - hPx / 2, y2 = y + hPx / 2;
  const targets = Object.values(_tokens)
    .filter(e => {
      if (!e.data || e.data.pageId !== _activePage?.id) return false;
      if (!e.data.visible && !STATE.isAdmin) return false;
      // Exclure le lanceur seulement pour les sorts offensifs (soin/buff zone peut se cibler)
      if (e.data.id === srcId && !opt.isHeal && !opt.isCaSort && !opt.isUtil) return false;
      const tc = _tokenCenter(e.data);
      return tc.x >= x1 && tc.x <= x2 && tc.y >= y1 && tc.y <= y2;
    })
    .map(e => e.data.id);

  // ── Invocation générique : place la créature à l'emplacement choisi ──
  // (pas d'attaque du lanceur — la créature a ses propres stats/actions)
  if (opt?.mods?.invocation) {
    const col = Math.round((x - wPx / 2) / CELL);
    const row = Math.round((y - hPx / 2) / CELL);
    await _vttSpawnSummon({ kind: 'invocation', srcId, col, row, opt, durationTurns: opt.mods.invocation.duree || 2 });
    _zoneCtx.invocationsDone = (_zoneCtx.invocationsDone || 0) + 1;
    const total = _zoneCtx.invocationsTotal || 1;
    const done  = _zoneCtx.invocationsDone;
    if (done < total) {
      showNotif(`🐾 Invocation ${done}/${total} placée — place la suivante`, 'info');
      _zoneCtx.placed = false;
      _zoneCtx.opt = { ..._zoneCtx.opt, label: `${opt.label} (${done + 1}/${total})` };
      _showZoneHud();
      _zonePreview?.position({ x: _zoneCtx.x, y: _zoneCtx.y });
      _layers.token?.batchDraw();
      return; // reste en mode placement
    }
    const srcD = _tokens[srcId]?.data;
    if (srcD) await _vttSpendSpellPm(srcD, opt);
    showNotif(`🐾 ${total} invocation${total > 1 ? 's' : ''} placée${total > 1 ? 's' : ''}`, 'success');
    _zoneClear();
    return;
  }

  // ── Combo Sentinelle : spawn d'un token au centre de la zone ────────
  // Le token apparaît même sans cible présente (le piège attend les ennemis)
  // Avec Dispersion, plusieurs sentinelles peuvent être posées en boucle.
  if (opt?.mods?.sentinelle) {
    const col = Math.round((x - wPx / 2) / CELL);
    const row = Math.round((y - hPx / 2) / CELL);
    await _vttSpawnSummon({ kind: 'sentinelle', srcId, col, row, opt, durationTurns: 2 });
    _zoneCtx.invocationsDone = (_zoneCtx.invocationsDone || 0) + 1;
    const total = _zoneCtx.invocationsTotal || 1;
    const done  = _zoneCtx.invocationsDone;
    if (done < total) {
      // Reste des sentinelles à placer : on re-prépare le placement
      showNotif(`🪤 Sentinelle ${done}/${total} posée — place la suivante`, 'info');
      _zoneCtx.placed = false;
      // Rafraîchit le HUD pour montrer la progression
      _zoneCtx.opt = {
        ..._zoneCtx.opt,
        label: `${opt.label} (${done + 1}/${total})`,
      };
      _showZoneHud();
      // Reposionne la prévisualisation au centre du stage actuel
      _zonePreview?.position({ x: _zoneCtx.x, y: _zoneCtx.y });
      _layers.token?.batchDraw();
      return; // reste en mode placement
    }
    showNotif(`🪤 ${total} sentinelle${total > 1 ? 's' : ''} posée${total > 1 ? 's' : ''}`, 'success');
    // Si aucune cible présente, on s'arrête là (sentinelles posées, pas d'attaque)
    if (!targets.length) {
      _zoneClear();
      return;
    }
  } else if (!targets.length) {
    showNotif('Aucune cible dans la zone', 'error');
    return;
  }

  const { optIdx } = _zoneCtx;
  _zoneClear();

  // Flux identique à multi-cibles : stocker les cibles, ouvrir la modale d'attaque
  _mtPending = targets;
  const firstTgt = targets[0];
  const src = _tokens[srcId]?.data; if (!src) { _mtPending = null; return; }
  if (!_tokens[firstTgt]?.data) { _mtPending = null; return; }
  // Le sort zone est mis seul dans le cache à l'index 0 (portée déjà vérifiée sur la zone)
  _atkOptsCache[`${srcId}__${firstTgt}`] = [opt];
  _vttPickOpt(srcId, firstTgt, 0);
}

/** Rendu des lignes de ciblage distantes (broadcast Firestore). */
function _renderRemoteCastings(docs) {
  if (!_layers.token) return;
  _clearRemoteLines();
  const myUid = STATE.user?.uid;
  docs.forEach(d => {
    const c = d.data();
    if (!c.active || c.pageId !== _activePage?.id || d.id === myUid) return;
    const srcEntry = Object.values(_tokens).find(e => e.data?.id === c.srcId);
    if (!srcEntry) return;
    (c.targets || []).forEach(tgtId => {
      const tgtEntry = Object.values(_tokens).find(e => e.data?.id === tgtId);
      if (!tgtEntry) return;
      const K = window.Konva;
      const s = _tokenCenter(srcEntry.data), t = _tokenCenter(tgtEntry.data);
      const line = new K.Line({
        points: [s.x, s.y, t.x, t.y],
        stroke: '#4f8cff', strokeWidth: 2,
        dash: [10, 6], lineCap: 'round',
        opacity: 0.55, listening: false, name: 'remote-mt-line',
      });
      _layers.token.add(line);
    });
  });
  _layers.token.batchDraw();
}

async function _vttRollAttack() {
  const ctx = _atkCtx; if (!ctx) return;
  const mode     = document.getElementById('atk-mode')?.value || 'normal';
  const bonusHit     = parseInt(document.getElementById('atk-bonus-hit')?.value)||0;
  const bonusDmg     = parseInt(document.getElementById('atk-bonus-dmg')?.value)||0;
  const bonusHitDice = parseInt(document.getElementById('atk-bonus-hit-dice')?.value)||0;
  const bonusDmgDice = parseInt(document.getElementById('atk-bonus-dmg-dice')?.value)||0;
  closeModalDirect();
  _atkCtx = null;

  const { srcId, tgtId, opt, lS, lT, allTargets } = ctx;
  const src=_tokens[srcId]?.data, tgt=_tokens[tgtId]?.data;
  if (!src||!tgt) return;
  // Liste des cibles : multi si allTargets, sinon cible unique
  const targetIds = allTargets && allTargets.length > 0 ? allTargets : [tgtId];

  const authorName = STATE.profile?.pseudo||STATE.profile?.prenom||STATE.user?.displayName||'MJ';
  // Payeur du mana : un token convoqué (invocation) n'a pas de PM propre — ses
  // sorts/actions sont payés sur le personnage du LANCEUR (summonOwnerId).
  const _pmPayerCharId = src.characterId
    || (src.summonOwnerId ? (_tokens[src.summonOwnerId]?.data?.characterId || null) : null);
  const _deductPm  = async () => {
    if (opt.pmCost > 0 && _pmPayerCharId) {
      const c = _characters[_pmPayerCharId];
      if (c) await updateDoc(_chrRef(_pmPayerCharId), {pm: Math.max(0, (c.pm ?? calcPMMax(c)) - opt.pmCost)});
    }
  };
  // Consomme 1 exemplaire de l'objet si l'option vient d'un item-action marqué `consommable`.
  // Convention "1 entrée = 1 unité" → on retire la 1ère entrée correspondante.
  // Ré-évaluation par itemId (l'index peut s'être déplacé entre build et usage).
  const _consumeItem = async () => {
    const meta = opt._itemAction;
    if (!meta?.consommable || !src.characterId) return;
    const c = _characters[src.characterId]; if (!c) return;
    const inv = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
    let idx = -1;
    if (meta.itemId)  idx = inv.findIndex(it => it?.itemId === meta.itemId);
    if (idx < 0 && meta.itemNom) idx = inv.findIndex(it => it?.nom === meta.itemNom);
    if (idx < 0) return; // déjà consommé
    inv.splice(idx, 1);
    await updateDoc(_chrRef(src.characterId), { inventaire: inv }).catch(() => {});
    showNotif(`🧪 ${meta.itemNom || 'Objet'} consommé`, 'info');
  };
  const _markActionUsed = async () => {
    if (!_session?.combat?.active) return;
    const field = opt.actionType === 'bonus'
      ? 'bonusActionThisTurn'
      : opt.actionType === 'reaction'
        ? 'reactionThisTurn'
        : 'attackedThisTurn';
    await updateDoc(_tokRef(src.id), { [field]: true }).catch(()=>{});
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

    // ── Vérification PM (payés par le lanceur si c'est une invocation) ──
    if (opt.pmCost > 0 && _pmPayerCharId) {
      const cPm = _characters[_pmPayerCharId];
      if (cPm) {
        const actualPm = cPm.pm ?? calcPMMax(cPm);
        if (actualPm < opt.pmCost) {
          const _who = src.summonOwnerId ? ' du lanceur' : '';
          showNotif(`⚠ PM insuffisants${_who} (${actualPm}/${opt.pmCost} requis)`, 'error');
          return;
        }
      }
    }

    // ── Combo Sort suspendu : on stocke l'opt + cible et on n'exécute pas l'effet ──
    // Le sort sera déclenché plus tard via le bouton dans l'inspector du porteur.
    if (opt.mods?.sortSuspendu && !_suspendedTriggerActive) {
      await _deductPm();
      const sharedSusp = _buffShared(opt, srcId);
      const suspBuff = {
        ...sharedSusp,
        type: 'suspended_spell',
        sortIdx: opt.sortIdx ?? null,
        tgtId: tgtId,
        icon: '🔮',
      };
      const existing = (src.buffs || []).filter(b => !(b.type === 'suspended_spell' && b.sortLabel === opt.label));
      await updateDoc(_tokRef(srcId), { buffs: [...existing, suspBuff] }).catch(() => {});
      showNotif(`🔮 ${opt.label} suspendu — à déclencher hors de votre tour`, 'success');
      _cleanup();
      return;
    }

    // ── Combo Coup de chance : applique le buff lucky_reroll au lanceur ──
    if (opt.mods?.coupChance) {
      const sharedLuck = _buffShared(opt, srcId);
      const luckBuff = {
        ...sharedLuck,
        type: 'lucky_reroll',
        charges: opt.mods.coupChance.charges,
        icon: '🍀',
      };
      const existing = (src.buffs || []).filter(b => !(b.type === 'lucky_reroll' && b.sortLabel === opt.label));
      await updateDoc(_tokRef(srcId), { buffs: [...existing, luckBuff] }).catch(() => {});
    }

    // ── Combo Régénération : Protection + Affliction → soin sur la durée allié ──
    if (opt.mods?.regeneration) {
      await _vttApplyRegeneration(srcId, allTargets && allTargets.length ? allTargets : [tgtId], opt);
    }

    // ── Combo Arme invoquée : remplace temporairement l'arme principale ───
    // Le lanceur "manifeste" une arme magique (selon la matrice MJ de l'élément)
    // pour la durée du sort (2 tours par défaut). Pas de token séparé : le PJ utilise
    // simplement cette arme à la place de son équipement habituel pendant l'effet.
    if (opt.mods?.armeInvoquee) {
      const shared = _buffShared(opt, srcId);
      const arm    = getInvokedArm(_spellMatrices, opt.mods.armeInvoquee.elementId);
      const baseDmg = arm?.degats || '1d8';
      const nbP     = opt.mods.armeInvoquee.nbPuissance || 0;
      let armDice = baseDmg;
      if (nbP > 0) {
        const m = baseDmg.match(/^(\d+)(d\d+)(.*)$/i);
        armDice = m ? `${parseInt(m[1]) + nbP}${m[2]}${m[3]}` : `${baseDmg} +${nbP}d6`;
      }
      const wrBuff = {
        ...shared,
        type: 'weapon_replace',
        icon: '⚔️',
        weaponName:  arm?.weapon || 'Arme invoquée',
        weaponDice:  armDice,
        weaponRange: arm?.portee || 1,
        statToucher: arm?.statToucher || 'force',
        statDegats:  arm?.statDegats  || 'force',
        element:     opt.mods.armeInvoquee.elementId || null,
        note:        arm?.note || '',
      };
      const existing = (src.buffs || []).filter(b => !(b.type === 'weapon_replace' && b.sortLabel === opt.label));
      await updateDoc(_tokRef(srcId), { buffs: [...existing, wrBuff] }).catch(() => {});
      showNotif(`⚔️ ${wrBuff.weaponName} équipée (${armDice})`, 'success');
    }

    // ── Combo Allonge magique : applique un buff de portée +X cases sur les cibles ──
    // L'enchantement s'applique aux alliés (slot=arme) pour 2 tours par défaut.
    if (opt.mods?.allonge) {
      const shared = _buffShared(opt, srcId);
      const rangeBuff = { ...shared, type: 'range_bonus', icon: '🏹',
        bonus: opt.mods.allonge.cells, bonusMeters: opt.mods.allonge.meters };
      for (const tid of (allTargets && allTargets.length ? allTargets : [tgtId])) {
        const td = _tokens[tid]?.data; if (!td) continue;
        const existing = (td.buffs || []).filter(b => !(b.type === 'range_bonus' && b.sortLabel === opt.label));
        await updateDoc(_tokRef(tid), { buffs: [...existing, rangeBuff] }).catch(() => {});
      }
    }

    // ── Enchantements (Dégâts, État, Toucher, Déplacement, slots) : buffs / états sur alliés ──
    if (opt.mods?.enchantArmeDmg || opt.mods?.enchantPieds || opt.mods?.enchantGeneric
        || opt.mods?.enchantEtatId || opt.mods?.enchantToucher || opt.mods?.enchantMove) {
      await _vttApplyEnchantBuffs(srcId, allTargets && allTargets.length ? allTargets : [tgtId], opt);
    }

    // ── Afflictions : JS Sa de la cible, buff (DoT, débuff mouvement, etc.) sur échec ──
    if (opt.mods?.affliction) {
      await _vttApplyAfflictions(srcId, allTargets && allTargets.length ? allTargets : [tgtId], opt);
    }

    // ── CA / Utilitaire : consommer PM, appliquer buff, loguer ─────────
    if (opt.isCaSort || opt.isUtil) {
      await _deductPm();
      await _consumeItem();
      await _markActionUsed();
      const rCa = _handleMultiCast();


      // Appliquer le buff CA sur chaque cible (ou bouclier réactif si combo détecté)
      const buffResults = [];
      const isShieldReactive = !!opt.mods?.bouclierReactif;
      if (opt.isCaSort) {
        const round = _session?.combat?.round ?? 0;
        const dur   = opt.sortDuree ?? null;
        const baseRound = Math.max(1, round); // traiter round 0 comme round 1
        // Canalisé persistant : pas d'expiration automatique (jusqu'à rupture concentration)
      const isCanalise = !!opt.mods?.canalisePersistant;
      const concDD = opt.mods?.concentration?.dd ?? (isCanalise ? 11 : null);
      // Firestore : pas de `undefined` → spread conditionnel pour les champs facultatifs
      const _canFields = isCanalise ? { canalisePersistant: true, concentrationDD: concDD } : {};
      const newBuff = isShieldReactive ? {
          // Bouclier réactif : annule 1 attaque (pas de bonus CA)
          type: 'shield_reactive',
          tier: opt.mods.bouclierReactif.tier,         // 'mob' | 'elite' | 'boss'
          nbProt: opt.mods.bouclierReactif.nbProt,
          charges: 1,
          totalDuration: isCanalise ? null : dur,
          startRound: round,
          expiresAtRound: isCanalise ? null : (dur != null ? baseRound + dur - 1 : null),
          casterId: srcId,
          sortLabel: opt.label,
          icon: '🛡️',
          ..._canFields,
        } : {
          type: 'ca',
          bonus: opt.caBonus ?? 2,
          totalDuration: isCanalise ? null : dur,
          startRound: round,
          expiresAtRound: isCanalise ? null : (dur != null ? baseRound + dur - 1 : null),
          casterId: srcId,
          sortLabel: opt.label,
          icon: isCanalise ? '🧠' : '🛡',
          ..._canFields,
        };
        const buffType = newBuff.type;
        for (const curTgtId of targetIds) {
          const curTgtData = _tokens[curTgtId]?.data; if (!curTgtData) continue;
          // Filtre les buffs existants du même sort (anti-stack)
          const existingBuffs = (curTgtData.buffs || []).filter(b => !(b.type === buffType && b.sortLabel === opt.label));
          await updateDoc(_tokRef(curTgtId), { buffs: [...existingBuffs, newBuff] }).catch(()=>{});
          buffResults.push(_live(curTgtData).displayName ?? curTgtData.name);
        }
      }

      const targetsLabel = buffResults.length > 1
        ? buffResults.join(', ')
        : (lT.displayName ?? tgt.name);

      // ── Construit un castEffect détaillé selon le type de sort ──
      let castEffect = opt.dice || '';
      const _STAT_LBL = { force:'For', dexterite:'Dex', constitution:'Con', intelligence:'Int', sagesse:'Sag', charisme:'Cha' };
      if (opt.isAffliction) {
        const statLbl = (_STAT_LBL[opt.afflictionSaveStat] || opt.afflictionSaveStat || 'Con').toUpperCase();
        if (opt.afflictionMode === 'etat' && opt.afflictionEtatId) {
          const lib = CONDITION_BY_ID[opt.afflictionEtatId];
          castEffect = `${lib ? `${lib.icon} ${lib.label}` : 'État'} · JS ${statLbl} DD ${opt.afflictionDD}`;
        } else {
          castEffect = `🩸 DoT ${opt.afflictionDotFormula}/tour · JS ${statLbl} DD ${opt.afflictionDD}`;
        }
      } else if (opt.isRegen) {
        castEffect = `💚 Régénération ${opt.mods?.regeneration?.formula || opt.dice || '2d4/tour'}`;
      } else if (opt.isEnchant) {
        if (opt.enchantMode === 'etat' && opt.enchantEtatId) {
          const lib = CONDITION_BY_ID[opt.enchantEtatId];
          castEffect = `${lib ? `${lib.icon} ${lib.label}` : 'État'} (sans JS)`;
        } else if (opt.enchantMode === 'toucher') {
          castEffect = `🎯 +${opt.mods?.enchantToucher?.bonus ?? '?'} au toucher sur allié`;
        } else if (opt.enchantMode === 'deplacement') {
          castEffect = `👢 +${opt.mods?.enchantMove?.bonusCells ?? '?'} déplacement sur allié`;
        } else if (opt.enchantFormula) {
          castEffect = `⚔️ +${opt.enchantFormula} / arme alliée`;
        }
      }

      // Log "cast" générique : sauté pour les afflictions (déjà loggées via
      // 'affliction-cast' AVANT, suivi du save log et de l'application).
      // Évite le doublon trompeur "Brulure activé!" qui suggère un succès
      // alors que le JS pourrait avoir réussi.
      if (!opt.isAffliction) {
        await addDoc(_logCol(), {
          type: 'cast',
          authorId: STATE.user?.uid||null, authorName,
          casterName: lS.displayName??src.name,
          characterImage: lS.displayImage||null,
          targetName: targetsLabel,
          optLabel: opt.label, pmCost: opt.pmCost,
          castEffect,
          createdAt: serverTimestamp(),
        }).catch(()=>{});
      }
      // Notif post-cast : neutre pour les afflictions (les notifs JS et effet
      // arrivent juste après dans _vttApplyAfflictions et indiquent le résultat)
      if (opt.isAffliction) {
        showNotif(`🪄 ${opt.label} lancé · résultat des JS ci-dessous`, 'info');
      } else {
        const buffInfo = opt.isCaSort ? ` (+${opt.caBonus??2} CA${opt.sortDuree ? `, ${opt.sortDuree}t` : ''})`
                       : opt.isEnchant    ? ` · ${castEffect}`
                       : '';
        showNotif(`✨ ${opt.label} activé !${buffInfo}${_ciblSuffix(rCa)}`, 'success');
      }
      return;
    }

    // ── Helper : formule de dés effective (bonus dés dégâts) ────────
    const _effectiveDmgDice = formula => {
      if (!bonusDmgDice) return formula;
      const p = _parseDice(formula);
      if (!p) return formula;
      const newN = Math.max(1, p.n + bonusDmgDice);
      return `${newN}d${p.sides}` + (p.mod !== 0 ? (p.mod > 0 ? `+${p.mod}` : `${p.mod}`) : '');
    };

    // ── Soin : d20 partagé (crit / fumble), puis roll appliqué à toutes les cibles ──
    // Le jet de toucher utilise la stat du sort (toucherStat override, sinon arme)
    // et se compare à un DD fixe de 2 — donc tout sauf un nat 1 passe.
    // L'intérêt : voir les crits (20 nat) qui maximisent le soin, et les fumbles (1 nat) qui ratent.
    const HEAL_DD = 2;
    if (opt.isHeal) {
      // Mode effectif : choix utilisateur + états du lanceur uniquement
      // (les états de la cible ne devraient pas affecter un soin)
      let hMode = mode;
      const hCondMods = _conditionsAttackMods(src, null, opt);
      if (hMode === 'normal') {
        if (hCondMods.hasAdv && !hCondMods.hasDis) hMode = 'adv';
        else if (hCondMods.hasDis && !hCondMods.hasAdv) hMode = 'dis';
      }
      // Roll d20 avec mode adv/dis
      const hRoll1 = Math.floor(Math.random()*20)+1;
      const hRoll2 = hMode !== 'normal' ? Math.floor(Math.random()*20)+1 : null;
      const hD20   = hMode === 'adv' ? Math.max(hRoll1, hRoll2)
                    : hMode === 'dis' ? Math.min(hRoll1, hRoll2)
                    : hRoll1;
      // Combo Chance : élargit la plage critique (RC abaissé sur le sort)
      const hCritThreshold = Math.max(2, Math.min(20, opt.mods?.chance?.rc ?? 20));
      const hIsCrit   = hD20 >= hCritThreshold;
      const hIsFumble = hD20 === 1;
      // Total : d20 + mod toucher + bonus set + bonus contextuel
      const hTouchMod = opt.toucherMod || 0;
      const hSetBon   = opt.toucherSetBonus || 0;
      const hHitTotal = hD20 + hTouchMod + hSetBon + bonusHit;

      const diceToRoll   = opt.rawDice || opt.dice;
      const effectiveDice = _effectiveDmgDice(diceToRoll);
      const healFixed    = (opt.maitriseBonus || 0) + bonusDmg;

      // PM toujours consommé (même sur échec critique) — le mana brûle quand on tente le sort
      await _deductPm();
      await _consumeItem();
      await _markActionUsed();

      // ── Échec critique : sort raté, aucun soin appliqué ─────────────
      if (hIsFumble) {
        const tgtNames = targetIds.map(tid => _live(_tokens[tid]?.data || {}).displayName).filter(Boolean).join(', ');
        await addDoc(_logCol(), {
          type: 'attack', isHeal: true, isFumble: true, advMode: hMode, advAuto: hMode !== mode,
          advReasons: hMode !== mode ? hCondMods.reasons : null,
          authorId: STATE.user?.uid||null, authorName,
          attackerName: lS.displayName??src.name,
          characterImage: lS.displayImage||null,
          defenderName: tgtNames || (lT.displayName??tgt.name),
          optLabel: opt.label,
          hitD20: hD20, hitRoll1: hRoll1, hitRoll2: hRoll2,
          hitD20rolls: hRoll2 != null ? [hRoll1, hRoll2] : null,
          hitToucherMod: hTouchMod, hitToucherSetBonus: hSetBon,
          hitToucherStatLabel: opt.toucherStatLabel || '',
          hitBonus: bonusHit, hitTotal: hHitTotal, healDD: HEAL_DD,
          dmgTotal: 0, newHp: null, hpMax: null,
          dmgFormula: opt.dice, pmCost: opt.pmCost || 0,
          createdAt: serverTimestamp(),
        }).catch(()=>{});
        showNotif(`💔 Échec critique (${hD20}) — sort raté, ${opt.pmCost||0} PM consommés`, 'error');
        return;
      }

      // ── Soin normal ou critique ────────────────────────────────────
      // Crit : max(dés) + 1 roll supplémentaire + 2× les bonus fixes
      // Si opt.mjAlwaysMax (flag MJ) : remplace le jet par la valeur max systématique
      let healRaw, healTotal;
      if (opt.mjAlwaysMax) {
        // Valeur max garantie (potion 1d6+4 → toujours 10, etc.)
        const maxDice = _maxDice(effectiveDice);
        healRaw   = maxDice;
        healTotal = Math.max(1, maxDice + healFixed);
      } else if (hIsCrit) {
        const maxDice = _maxDice(effectiveDice);
        const critRoll = _rollDice(effectiveDice);
        healRaw   = critRoll;          // pour le log (le "raw" est le 2e jet)
        healTotal = Math.max(1, maxDice + critRoll + 2 * healFixed);
      } else {
        healRaw   = _rollDice(effectiveDice);
        healTotal = Math.max(1, healRaw + healFixed);
      }

      // Appliquer à chaque cible
      const healResults = [];
      for (const curTgtId of targetIds) {
        const curTgtData = _tokens[curTgtId]?.data; if (!curTgtData) continue;
        const lCur = _live(curTgtData);
        const curHp = lCur.displayHp ?? 20, hpMax = lCur.displayHpMax ?? 20;
        const newHp = Math.min(hpMax, curHp + healTotal);
        await _setHp(curTgtData, newHp);
        healResults.push({ name: lCur.displayName ?? curTgtData.name, newHp, hpMax });
      }

      const isMultiHeal = healResults.length > 1;
      const critTag = hIsCrit ? ' 💥 CRITIQUE' : '';
      // Payload commun pour le log (jet de toucher détaillé)
      const hitPayload = {
        isCrit: hIsCrit, isFumble: false, advMode: hMode, advAuto: hMode !== mode,
        advReasons: hMode !== mode ? hCondMods.reasons : null,
        hitD20: hD20, hitRoll1: hRoll1, hitRoll2: hRoll2,
        hitD20rolls: hRoll2 != null ? [hRoll1, hRoll2] : null,
        hitToucherMod: hTouchMod, hitToucherSetBonus: hSetBon,
        hitToucherStatLabel: opt.toucherStatLabel || '',
        hitBonus: bonusHit, hitTotal: hHitTotal, healDD: HEAL_DD,
      };

      if (isMultiHeal) {
        await addDoc(_logCol(), {
          type: 'attack-multi', isHeal: true,
          authorId: STATE.user?.uid||null, authorName,
          attackerName: lS.displayName??src.name,
          characterImage: lS.displayImage||null,
          optLabel: opt.label,
          ...hitPayload,
          dmgFormula: opt.dice, dmgRawDice: opt.rawDice||null,
          dmgEffectiveDice: bonusDmgDice ? effectiveDice : null,
          dmgMaitriseBonus: opt.maitriseBonus??0,
          dmgRaw: healRaw, dmgBonus: bonusDmg, dmgBonusDice: bonusDmgDice||null,
          targets: healResults.map(r => ({ ...r, hit: true, halfDmg: false, dmgTotal: healTotal, targetCA: HEAL_DD })),
          createdAt: serverTimestamp(),
        }).catch(()=>{});
        showNotif(`💚${critTag} ${healTotal} PV soignés → ${healResults.map(r=>r.name).join(', ')}`, 'success');
      } else {
        const r = healResults[0];
        if (r) {
          await addDoc(_logCol(), {
            type:'attack', isHeal:true,
            authorId: STATE.user?.uid||null, authorName,
            attackerName: lS.displayName??src.name,
            characterImage: lS.displayImage||null,
            defenderName: r.name,
            defenderImage: _live(tgt)?.displayImage || null,
            optLabel: opt.label,
            ...hitPayload,
            dmgFormula: opt.dice, dmgRawDice: opt.rawDice||null,
            dmgEffectiveDice: bonusDmgDice ? effectiveDice : null,
            dmgMaitriseBonus: opt.maitriseBonus??0,
            dmgRaw: healRaw, dmgBonus: bonusDmg, dmgBonusDice: bonusDmgDice||null,
            dmgTotal: healTotal, newHp: r.newHp, hpMax: r.hpMax,
            createdAt: serverTimestamp(),
          }).catch(()=>{});
          showNotif(`💚${critTag} ${healTotal} PV soignés → ${r.name}`, 'success');
        }
      }
      return;
    }

    // ── Bouclier réactif : check des cibles, consomme charges, marque les "blocked" ──
    const attackerRank = _attackerRank(src);
    const blockedTargets = new Set();
    {
      const curRound = _session?.combat?.round ?? 0;
      for (const tid of targetIds) {
        const td = _tokens[tid]?.data;
        const buffs = td?.buffs || [];
        const shield = buffs.find(b =>
          b?.type === 'shield_reactive'
          && (b.charges == null || b.charges > 0)
          && (b.expiresAtRound == null || b.expiresAtRound >= curRound)
          && _shieldBlocks(b.tier, attackerRank)
        );
        if (!shield) continue;
        blockedTargets.add(tid);
        // Consommer la charge (1 charge → retire le buff ; >1 → décrémente)
        const remaining = (shield.charges == null) ? 0 : Math.max(0, shield.charges - 1);
        const newBuffs = remaining > 0
          ? buffs.map(b => b === shield ? { ...b, charges: remaining } : b)
          : buffs.filter(b => b !== shield);
        await updateDoc(_tokRef(tid), { buffs: newBuffs }).catch(() => {});
      }
    }

    // ── Mode effectif : combine choix utilisateur + états sur attaquant/cible ──
    // Règle D&D : avantage + désavantage = annulés (mode 'normal').
    // Le mode explicite du joueur est respecté mais peut être renforcé.
    let effectiveMode = mode;
    const condMods = _conditionsAttackMods(src, tgt, opt);
    if (mode === 'normal') {
      if (condMods.hasAdv && !condMods.hasDis) effectiveMode = 'adv';
      else if (condMods.hasDis && !condMods.hasAdv) effectiveMode = 'dis';
    }
    // ── Attaque offensive — un seul roll d20, appliqué à chaque cible ──
    const roll1    = Math.floor(Math.random()*20)+1;
    const roll2    = effectiveMode !== 'normal' ? Math.floor(Math.random()*20)+1 : null;
    let d20        = effectiveMode === 'adv' ? Math.max(roll1, roll2)
                   : effectiveMode === 'dis' ? Math.min(roll1, roll2)
                   : roll1;
    // Combo Chance : RC abaissée (19-20, 17-20…) — élargit la plage critique
    const critThreshold = Math.max(2, Math.min(20, opt.mods?.chance?.rc ?? 20));
    let isCrit   = d20 >= critThreshold;
    let isFumble = d20 === 1;

    // ── Combo Coup de chance : relance si le d20 est sous le seuil de touche estimé ──
    // On vérifie le buff lucky_reroll sur le lanceur. Si charge dispo ET (fumble ou attaque
    // probablement ratée), on relance. Critère pragmatique : on relance si d20 < 10 (non-crit).
    const luckyReroll = (src.buffs || []).find(b =>
      b?.type === 'lucky_reroll' && (b.charges || 0) > 0
      && (b.expiresAtRound == null || (_session?.combat?.round ?? 0) === 0 || (_session?.combat?.round ?? 0) <= b.expiresAtRound)
    );
    let luckUsed = false;
    if (luckyReroll && !isCrit && d20 < 10) {
      const newRoll = Math.floor(Math.random() * 20) + 1;
      if (newRoll > d20) {
        d20 = newRoll;
        isCrit   = d20 >= critThreshold;
        isFumble = d20 === 1;
      }
      luckUsed = true;
      // Décrémente / retire le buff
      const remaining = luckyReroll.charges - 1;
      const newBuffs = remaining > 0
        ? (src.buffs || []).map(b => b === luckyReroll ? { ...b, charges: remaining } : b)
        : (src.buffs || []).filter(b => b !== luckyReroll);
      await updateDoc(_tokRef(srcId), { buffs: newBuffs }).catch(() => {});
    }
    const atkBase  = opt.toucher !== null && opt.toucher !== undefined ? opt.toucher : (lS.displayAttack ?? 5);
    // Bonus de toucher d'enchantement (mode Toucher) — lu FRAIS sur le lanceur,
    // pas figé dans l'option (le buff peut avoir été posé après l'ouverture du panneau).
    const _touchBuff = _touchBuffOf(src);
    // Dés supplémentaires au toucher (sommés au total)
    const extraHitRolls = [];
    let extraHitSum = 0;
    if (bonusHitDice !== 0) {
      const cnt = Math.abs(bonusHitDice);
      for (let k = 0; k < cnt; k++) {
        const r = Math.floor(Math.random() * 20) + 1;
        extraHitRolls.push(r);
        extraHitSum += bonusHitDice > 0 ? r : -r;
      }
    }
    const hitTotal = d20 + atkBase + bonusHit + extraHitSum + _touchBuff;
    const rules      = opt.typeRules || {};
    const armorPen   = rules.armorPen || 0;
    const typeDmgBon = rules.dmgBonus || 0;
    let   missEffect = rules.missEffect || 'none';
    // Règle générale : tout sort / compétence qui consomme du mana fait au moins
    // ½ dégâts (arrondi inf.) en cas d'échec. Si le type de dégâts définit déjà
    // 'half' ou 'full', on respecte (pas de cumul, on ne dégrade pas non plus).
    if (missEffect === 'none' && opt.pmCost > 0) missEffect = 'half';

    const diceToRoll    = opt.rawDice || opt.dice;
    const effectiveDice = _effectiveDmgDice(diceToRoll);
    const dmgFixed      = opt.rawDice !== undefined ? ((opt.dmgStatMod || 0) + (opt.maitriseBonus || 0)) : 0;
    const totalFixed  = dmgFixed + bonusDmg + typeDmgBon;

    // ── Dés tirés UNE SEULE fois, partagés entre toutes les cibles ──────
    // On stocke aussi les rolls individuels pour affichage détaillé dans le log
    let sharedDmgRaw = 0, sharedDmgTotalHit = 0, sharedDmgTotalHalf = 0;
    let sharedCritNormalMax = 0, sharedCritRaw2 = 0, sharedCritFixed2 = 0;
    let sharedDmgRollsDetail = null; // { rolls:[3,5,2], sides:6, mod:0 } - rolls individuels
    let sharedCritRollsDetail = null;
    if (!isFumble) {
      if (opt.mjAlwaysMax) {
        // Flag MJ : la formule de base tire toujours sa valeur max (potions, objets fixes).
        // Le crit ne s'applique pas — la valeur est déjà maximale.
        const maxDice = _maxDice(effectiveDice);
        sharedDmgRaw         = maxDice;
        sharedDmgRollsDetail = null;  // pas de rolls individuels en mode max
        sharedDmgTotalHit    = Math.max(1, maxDice + totalFixed);
      } else if (isCrit) {
        sharedCritNormalMax = _maxDice(effectiveDice) + totalFixed;
        const critDet = _rollDiceDetailed(effectiveDice);
        sharedCritRaw2      = critDet.total;
        sharedCritRollsDetail = { rolls: critDet.rolls, sides: critDet.sides, mod: critDet.mod };
        sharedCritFixed2    = totalFixed;
        sharedDmgRaw        = sharedCritRaw2;
        sharedDmgTotalHit   = sharedCritNormalMax + sharedCritRaw2 + sharedCritFixed2;
      } else {
        const det = _rollDiceDetailed(effectiveDice);
        sharedDmgRaw      = det.total;
        sharedDmgRollsDetail = { rolls: det.rolls, sides: det.sides, mod: det.mod };
        sharedDmgTotalHit = Math.max(1, sharedDmgRaw + totalFixed);
      }
      if (missEffect === 'half')  sharedDmgTotalHalf = Math.max(1, Math.floor(sharedDmgTotalHit / 2));
      else if (missEffect === 'full') sharedDmgTotalHalf = sharedDmgTotalHit;
    }

    // ── Bonus dégâts depuis buff d'enchantement arme actif sur le lanceur ──
    // Règles :
    //  • S'applique aux Actions uniquement (attaques d'arme + sorts type 'action').
    //    Exclu : Actions Bonus, Réactions (actionType === 'bonus' / 'reaction')
    //  • Bonus appliqué UNIQUEMENT sur un coup réussi (pas sur les demi-dégâts).
    //  • Non cumulable : un seul buff dmg_bonus actif (le dernier appliqué wins,
    //    déjà garanti par _vttApplyEnchantBuffs qui retire les anciens).
    const _isWeaponAttack = opt.id === 'weapon' || opt.id === 'npc_attack' || opt.id?.startsWith?.('beast_');
    const _isActionType   = !opt.actionType || opt.actionType === 'action';
    const _eligibleForEnchant = (_isWeaponAttack || opt.sortIdx !== undefined) && _isActionType;
    let buffDmgBonus = 0;
    const buffDmgNotes = [];
    let buffDmgDetail = null; // { formula, rolls, mod, total, sortLabel, element }
    if (_eligibleForEnchant && !isFumble) {
      const round_eff = _session?.combat?.round ?? 0;
      const srcDmgCondition = _conditionDmgBonusOf(src);
      const srcDmgBuff = (src.buffs || []).find(b =>
        b.type === 'dmg_bonus' && b.slot === 'arme'
        && (b.expiresAtRound == null || round_eff === 0 || round_eff <= b.expiresAtRound)
      );
      const srcDmgFormula = srcDmgCondition?.formula || srcDmgBuff?.formula;
      if (srcDmgFormula) {
        const det = _rollDiceDetailed(srcDmgFormula);
        if (det.total > 0) {
          buffDmgBonus = det.total;
          buffDmgDetail = {
            formula: srcDmgFormula,
            rolls: det.rolls, mod: det.mod, sides: det.sides,
            total: det.total,
            sortLabel: srcDmgCondition?.cond?.source || srcDmgBuff?.sortLabel || 'Enchantement',
            element: srcDmgBuff?.element || null,
          };
          // Affichage détaillé dans la notif : "+1d4(3) +2 = 5 (Boule de Feu)"
          const rollsStr = det.rolls.length ? `(${det.rolls.join(',')})` : '';
          const modStr = det.mod > 0 ? ` +${det.mod}` : det.mod < 0 ? ` ${det.mod}` : '';
          const icon = srcDmgCondition?.lib?.icon || srcDmgBuff?.icon || '⚔️';
          buffDmgNotes.push(`${icon} +${det.n}d${det.sides}${rollsStr}${modStr} = ${det.total} (${buffDmgDetail.sortLabel})`);
          sharedDmgTotalHit += det.total;
        }
      }
    }

    await _deductPm();
    await _consumeItem();
    await _markActionUsed();

    // ── Appliquer les HP + collecter résultats par cible ──────────────
    const targetResults = [];
    for (const curTgtId of targetIds) {
      const curTgtData = _tokens[curTgtId]?.data;
      if (!curTgtData) continue;
      const lCurTgt = _live(curTgtData);

      // ⚠️ TOUJOURS la VRAIE CA (realDefense), JAMAIS l'estimation du joueur.
      // Si un joueur attaque, lCurTgt.displayDefense renverrait son estimation
      // (track.caEstimee) — ce qui fausserait le hit/miss. On utilise realDefense
      // qui contourne ce filtre d'affichage.
      const rawCA    = lCurTgt.realDefense ?? lCurTgt.displayDefense ?? 10;
      const targetCA = armorPen > 0 ? Math.round(rawCA * (1 - armorPen / 100)) : rawCA;
      // Bouclier réactif : annule complètement l'attaque (pas de touche, pas de demi-dégâts, pas de fumble visuel)
      const isBlocked = blockedTargets.has(curTgtId);
      const hit      = isBlocked ? false : (isCrit ? true : isFumble ? false : hitTotal >= targetCA);
      const halfDmg  = !isBlocked && !hit && missEffect !== 'none' && !isFumble;
      let dmgTotal   = hit ? sharedDmgTotalHit : halfDmg ? sharedDmgTotalHalf : 0;
      let interaction = null;

      // ── Bonus de dégâts subis depuis les états actifs de la cible (Marqué, etc.) ──
      // Roule la formule (ex: "1d6") par état. Appliqué sur hit ET demi-dégâts.
      const _condDmgNotes = [];
      if ((hit || halfDmg) && dmgTotal > 0) {
        for (const { lib } of _activeConditionsOf(curTgtData)) {
          const f = lib?.effects?.dmgTakenBonus;
          if (!f) continue;
          const b = _rollDice(String(f));
          if (b > 0) {
            dmgTotal += b;
            _condDmgNotes.push(`+${b} ${lib.icon || ''} ${lib.label}`);
          }
        }
      }

      // ── Réduction des dégâts subis depuis les états actifs (Pétrifié, etc.) ──
      // On prend la plus forte réduction parmi tous les états actifs (ne stack pas).
      if ((hit || halfDmg) && dmgTotal > 0) {
        let bestPct = 0; let bestLib = null;
        for (const { lib } of _activeConditionsOf(curTgtData)) {
          const p = lib?.effects?.dmgReductionPct || 0;
          if (p > bestPct) { bestPct = p; bestLib = lib; }
        }
        if (bestPct > 0) {
          const before = dmgTotal;
          dmgTotal = bestPct >= 100 ? 0 : Math.max(0, Math.floor(dmgTotal * (1 - bestPct / 100)));
          if (bestLib) {
            _condDmgNotes.push(`−${before - dmgTotal} ${bestLib.icon || '🛡'} ${bestLib.label} (${bestPct}%)`);
          }
        }
      }

      const curHp = lCurTgt.displayHp ?? 20, hpMax = lCurTgt.displayHpMax ?? 20;
      let newHp = curHp;
      // Valeur AVANT interaction du profil de la créature (pour log "10 → 5").
      let dmgPre = dmgTotal;
      let dmgReduction = 0;
      if (hit || halfDmg) {
        if (curTgtData.type === 'enemy' && curTgtData.beastId) {
          const bEnt    = _bestiary[curTgtData.beastId];
          const result  = applyDamageTypeInteraction(dmgTotal, opt.damageTypeId, bEnt);
          dmgTotal      = result.dmgTotal;
          interaction   = result.interaction;

          const realMax = _numOr(bEnt?.pvMax, 20);
          const realCur = curTgtData.hp !== null ? _numOr(curTgtData.hp, realMax) : realMax;
          // Plafonner par realMax pour éviter qu'une absorption (dmgTotal négatif)
          // ne soigne au-dessus du PV max de la créature.
          newHp = Math.max(0, Math.min(realMax, realCur - dmgTotal));
          const prevEst = curTgtData.pvCombatHp != null ? Math.max(0, parseInt(curTgtData.pvCombatHp)||0) : (lCurTgt.displayHpMax??realMax);
          const newEst  = Math.max(0, Math.min(realMax, prevEst - dmgTotal));
          await updateDoc(_tokRef(curTgtData.id), { hp: newHp, pvCombatHp: newEst });
          await _syncDownedCondition(curTgtData, newHp);
        } else {
          // Set Lourd : réduction de 2 dégâts par coup, minimum 1 dégât
          if (dmgTotal > 0 && curTgtData.characterId) {
            const tgtChar = STATE.characters.find(x => x.id === curTgtData.characterId);
            if (tgtChar) {
              dmgReduction = getArmorSetData(tgtChar).modifiers.damageReduction || 0;
              if (dmgReduction > 0) dmgTotal = Math.max(1, dmgTotal - dmgReduction);
            }
          }
          newHp = Math.max(0, curHp - dmgTotal);
          await _setHp(curTgtData, newHp);
        }
      }
      // ── États consommés au 1er coup (Marqué, etc.) : retire ceux dont
      //    l'effet `consumedByAttackAgainst` est activé après que les bonus
      //    de dégâts aient été appliqués. Persistance immédiate.
      const _consumedNotes = [];
      if (hit) {
        const curConds = curTgtData.conditions || [];
        const remaining = [];
        for (const c of curConds) {
          const lib = CONDITION_BY_ID[c.id];
          if (lib?.effects?.consumedByAttackAgainst) {
            _consumedNotes.push(`${lib.icon || '🎯'} ${lib.label} consommé`);
          } else {
            remaining.push(c);
          }
        }
        if (remaining.length !== curConds.length) {
          await updateDoc(_tokRef(curTgtData.id), { conditions: remaining }).catch(() => {});
        }
      }

      targetResults.push({
        name: lCurTgt.displayName ?? curTgtData.name, targetCA, hit, halfDmg,
        dmgTotal, dmgPre, dmgReduction, newHp, hpMax, interaction,
        shieldBlocked: isBlocked,
        condDmgNotes: _condDmgNotes, consumedNotes: _consumedNotes,
        // Métadonnées pour le rendu côté joueur (estimation CA, portrait)
        beastId: curTgtData.beastId || null,
        npcId:   curTgtData.npcId   || null,
        characterId: curTgtData.characterId || null,
        targetImage: lCurTgt.displayImage || null,
        _data: curTgtData,
      });
    }


    // ── Combos post-attaque (Lacération, Déplacement, Drain, Concentration) ──
    const _mods = opt.mods || null;
    const modNotes = []; // notes textuelles pour la notif/log

    // Remonte dans modNotes les effets liés aux états (dégâts bonus + consommations)
    for (const r of targetResults) {
      if (r.condDmgNotes?.length) {
        for (const n of r.condDmgNotes) modNotes.push(`💢 ${n} → ${r.name}`);
      }
      if (r.consumedNotes?.length) {
        for (const n of r.consumedNotes) modNotes.push(n + ` (${r.name})`);
      }
    }

    // ── JS Concentration auto : buffs canalisés + états de type Concentré.
    for (const r of targetResults) {
      if (!(r.hit || r.halfDmg) || r.dmgTotal <= 0) continue;
      const td = r._data; if (!td) continue;
      const concNotes = await _vttTriggerConcentrationSave(td, r.dmgTotal);
      modNotes.push(...concNotes);
    }

    if (_mods) {
      const round = _session?.combat?.round ?? 0;
      const baseRound = Math.max(1, round);

      for (const r of targetResults) {
        const wasHit = r.hit || r.halfDmg;
        if (!wasHit || !r._data) continue;
        const curTgtData = r._data;

        // ── Lacération : -CA brut sur la cible (plafonné selon rang) ────
        if (_mods.laceration) {
          const lac = _mods.laceration;
          const beast = curTgtData.beastId ? _bestiary[curTgtData.beastId] : null;
          const rang = (beast?.rang || 'classique').toLowerCase();
          const cap = (rang === 'elite' || rang === 'élite' || rang === 'boss') ? lac.maxElite : lac.max;
          const reduction = Math.min(lac.reduction, cap);
          const sortLabel = `Lacération · ${opt.label}`;
          const newBuff = {
            type: 'ca', bonus: -reduction,
            totalDuration: 2, startRound: round,
            expiresAtRound: baseRound + 2 - 1,
            sortLabel, icon: '🩸',
          };
          const existingBuffs = (curTgtData.buffs || []).filter(b => !(b.type === 'ca' && b.sortLabel === sortLabel));
          await updateDoc(_tokRef(curTgtData.id), { buffs: [...existingBuffs, newBuff] }).catch(() => {});
          modNotes.push(`🩸 CA −${reduction} → ${r.name}`);
        }

        // (Le déplacement n'est plus géré ici : c'est un sort dédié sans dégâts,
        //  exécuté via la branche de cast déplacement, pas via l'attaque.)
      }

      // ── Drain : soigne le lanceur d'un % des dégâts infligés ──
      // Équilibrage : le soin est plafonné par la frappe de base hors Puissance.
      // Puissance augmente donc les dégâts, mais Protection reste la rune qui améliore
      // réellement la régénération.
      if (_mods.drain && targetResults.some(r => r.hit || r.halfDmg)) {
        const totalDealt = targetResults.reduce((acc, r) => {
          if (!(r.hit || r.halfDmg)) return acc;
          // Utilise dmgPre (avant interaction immunité/absorption) pour le drain
          const base = (r.dmgPre != null && r.dmgPre > 0) ? r.dmgPre : Math.max(0, r.dmgTotal);
          return acc + base;
        }, 0);
        const rawHeal = Math.max(1, Math.floor(totalDealt * _mods.drain.pct));
        const baseCap = opt.drainBaseFormula ? Math.max(1, Math.floor(_maxDice(opt.drainBaseFormula) * _mods.drain.pct)) : rawHeal;
        const healAmt = Math.min(rawHeal, baseCap);
        const srcLive = _live(src);
        const srcHp = srcLive.displayHp ?? 20;
        const srcHpMax = srcLive.displayHpMax ?? 20;
        const newSrcHp = Math.min(srcHpMax, srcHp + healAmt);
        if (newSrcHp > srcHp) {
          await _setHp(src, newSrcHp);
          const pctLabel = Math.round(_mods.drain.pct * 100);
          const capLabel = baseCap < rawHeal ? ` · cap ${baseCap}` : '';
          modNotes.push(`🩸 Drain ${pctLabel}%${capLabel} → +${healAmt} PV (${srcLive.displayName ?? src.name})`);
        }
      }
    }

    // ── Un seul message dans le log ────────────────────────────────────
    // Strip _data (référence token interne, non sérialisable Firestore)
    const cleanResults = targetResults.map(({ _data, ...rest }) => rest);
    const isMulti = cleanResults.length > 1;
    if (isMulti) {
      await addDoc(_logCol(), {
        type: 'attack-multi',
        authorId: STATE.user?.uid||null, authorName,
        attackerName: lS.displayName??src.name,
        characterImage: lS.displayImage||null,
        optLabel: opt.label,
        isCrit, isFumble, advMode: effectiveMode, advAuto: effectiveMode !== mode,
        advReasons: effectiveMode !== mode ? condMods.reasons : null,
        hitD20: d20, hitD20rolls: roll2 !== null ? [roll1, roll2] : [roll1],
        hitBase: atkBase, hitBonus: bonusHit, hitTotal,
        hitToucherMod: opt.toucherMod??null, hitToucherSetBonus: opt.toucherSetBonus??0,
        hitToucherStatLabel: opt.toucherStatLabel??null, hitTouchBuff: _touchBuff || 0,
        dmgFormula: opt.dice, dmgRawDice: opt.rawDice||null,
        dmgEffectiveDice: bonusDmgDice ? effectiveDice : null,
        dmgStatMod: opt.dmgStatMod??null, dmgStatLabel: opt.dmgStatLabel??null,
        dmgMaitriseBonus: opt.maitriseBonus??0,
        dmgRaw: sharedDmgRaw, dmgBonus: bonusDmg, dmgBonusDice: bonusDmgDice||null,
        dmgFull: sharedDmgTotalHit, dmgFullHalf: sharedDmgTotalHalf,
        bonusHitDice: bonusHitDice||null, extraHitRolls: extraHitRolls.length ? extraHitRolls : null,
        critNormalMax: sharedCritNormalMax, critRaw2: sharedCritRaw2, critFixed2: sharedCritFixed2,
        damageTypeId: opt.damageTypeId||null, damageTypeIcon: opt.damageTypeIcon||null,
        damageTypeColor: opt.damageTypeColor||null,
        buffDmgBonus: buffDmgBonus || 0,
        buffDmgNotes: buffDmgNotes.length ? buffDmgNotes : null,
        buffDmgDetail: buffDmgDetail || null,
        dmgRollsDetail: sharedDmgRollsDetail || null,
        critRollsDetail: sharedCritRollsDetail || null,
        targets: cleanResults,
        createdAt: serverTimestamp(),
      }).catch(()=>{});
    } else {
      const r = cleanResults[0];
      // Image de la cible pour affichage dans le chat (single target)
      const _defImg = _live(tgt)?.displayImage || r?.targetImage || null;
      if (r) await addDoc(_logCol(), {
        type: 'attack',
        authorId: STATE.user?.uid||null, authorName,
        attackerName: lS.displayName??src.name,
        characterImage: lS.displayImage||null,
        defenderName: r.name,
        defenderImage: _defImg,
        // Identifiants cible pour rendu côté joueur (estimation CA)
        beastId: r.beastId || null,
        npcId: r.npcId || null,
        characterId: r.characterId || null,
        optLabel: opt.label,
        isCrit, isFumble, advMode: effectiveMode, advAuto: effectiveMode !== mode,
        advReasons: effectiveMode !== mode ? condMods.reasons : null,
        hitD20: d20, hitD20rolls: roll2 !== null ? [roll1, roll2] : [roll1],
        hitBase: atkBase, hitBonus: bonusHit, hitTotal,
        hitToucherMod: opt.toucherMod??null, hitToucherSetBonus: opt.toucherSetBonus??0,
        hitToucherStatLabel: opt.toucherStatLabel??null, hitTouchBuff: _touchBuff || 0,
        targetCA: r.targetCA, hit: r.hit,
        dmgFormula: opt.dice, dmgRawDice: opt.rawDice||null,
        dmgEffectiveDice: bonusDmgDice ? effectiveDice : null,
        dmgStatMod: opt.dmgStatMod??null, dmgStatLabel: opt.dmgStatLabel??null,
        dmgMaitriseBonus: opt.maitriseBonus??0,
        dmgRaw: sharedDmgRaw, dmgBonus: bonusDmg, dmgBonusDice: bonusDmgDice||null,
        dmgTotal: r.dmgTotal, dmgFull: sharedDmgTotalHit, dmgPre: r.dmgPre ?? r.dmgTotal, dmgReduction: r.dmgReduction || 0,
        bonusHitDice: bonusHitDice||null, extraHitRolls: extraHitRolls.length ? extraHitRolls : null,
        critNormalMax: sharedCritNormalMax, critRaw2: sharedCritRaw2, critFixed2: sharedCritFixed2,
        halfDmg: r.halfDmg, newHp: r.newHp, hpMax: r.hpMax,
        damageTypeId: opt.damageTypeId||null, damageTypeIcon: opt.damageTypeIcon||null,
        damageTypeColor: opt.damageTypeColor||null,
        buffDmgBonus: buffDmgBonus || 0,
        buffDmgNotes: buffDmgNotes.length ? buffDmgNotes : null,
        buffDmgDetail: buffDmgDetail || null,
        dmgRollsDetail: sharedDmgRollsDetail || null,
        critRollsDetail: sharedCritRollsDetail || null,
        interaction: r.interaction || null,
        createdAt: serverTimestamp(),
      }).catch(()=>{});
    }

    // Notif consolidée
    const notifParts = cleanResults.map(r => {
      const nm = r.name;
      const interMeta = r.interaction ? DAMAGE_INTERACTIONS[r.interaction] : null;
      const interTag  = interMeta ? ` ${interMeta.icon}${interMeta.short}` : '';
      const dmgLabel = r.dmgTotal < 0 ? `+${Math.abs(r.dmgTotal)}` : r.dmgTotal;
      return r.shieldBlocked ? `🛡️ Bouclier réactif · ${nm}`
           : isFumble       ? `💀 Fumble`
           : r.interaction === 'Immunité' && r.hit ? `🚫 Immunisé · ${nm}`
           : r.halfDmg     ? `✦ ${dmgLabel}(½)${interTag} → ${nm}`
           : !r.hit        ? `🎯 Raté vs ${nm}`
           : r.newHp===0   ? `💀 ${nm} tombe !`
           : isCrit        ? `💥 ${dmgLabel}${interTag} → ${nm}`
                           : `⚔️ ${dmgLabel}${interTag} → ${nm}`;
    });
    // Ajoute les notes de combo (Lacération, Déplacement, Drain) à la notif
    if (modNotes.length) notifParts.push(...modNotes);
    // Notes d'enchantement uniquement si au moins une cible a été touchée
    // (pas de pollution sur les ratés)
    const _anyHitForEnchant = cleanResults.some(r => r.hit);
    if (buffDmgNotes.length && _anyHitForEnchant) notifParts.push(...buffDmgNotes);
    if (luckUsed) notifParts.unshift(`🍀 Coup de chance utilisé (d20 → ${d20})`);
    const anyHit = cleanResults.some(r => r.hit || r.halfDmg);
    showNotif(notifParts.join(' · '), anyHit ? 'success' : 'error');

  } catch (err) {
    console.error('[VTT] Erreur attaque', err);
    showNotif(`Erreur attaque : ${err?.message || err}`, 'error');
  }
  finally {
    // Consomme un éventuel "free cast one-shot" (déclenchement d'un sort suspendu)
    if (opt.sortIdx !== undefined) {
      _freeNextCast.delete(`${srcId}_${opt.sortIdx}`);
    }
    // Reset du flag de déclenchement de sort suspendu (le cast est terminé)
    _suspendedTriggerActive = false;
    _cleanup();
  }
}

// ═══════════════════════════════════════════════════════════════════
// INSPECTOR
// ═══════════════════════════════════════════════════════════════════
// Coalesce les rafales de snapshots (chrs/npcs/bsts/toks) → 1 render par tick
let _inspectorDirty = false;
function _renderInspectorSoon() {
  if (_inspectorDirty) return;
  _inspectorDirty = true;
  queueMicrotask(() => {
    _inspectorDirty = false;
    const t = _selected ? (_tokens[_selected]?.data ?? null) : null;
    _renderInspector(t);
  });
}

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
  // vitalsHtml = barres PV/PM (épinglées sous le header) · coreStatsHtml = onglet Stats
  let vitalsHtml = '', coreStatsHtml = '';
  if (!STATE.isAdmin && t.type === 'enemy' && t.beastId) {
    const track    = _bstTracker[t.beastId] || {};
    const pvMax    = track.pvActuel !== undefined ? parseInt(track.pvActuel) : null;
    const pvCur    = ld.displayHp !== null ? ld.displayHp : pvMax;
    const pvPct    = pvMax > 0 ? Math.round((pvCur??pvMax) / pvMax * 100) : 0;
    const pvBarCol = pvPct > 50 ? '#22c38e' : pvPct > 25 ? '#f59e0b' : '#ef4444';
    const caLabel  = track.caEstimee  !== undefined && track.caEstimee  !== '' ? String(track.caEstimee)  : '?';
    const vitLabel = track.vitEstimee !== undefined && track.vitEstimee !== '' ? String(track.vitEstimee)+' cases' : '?';
    const pos      = t.pageId ? 'Col '+t.col+' · Lig '+t.row : 'Non placé';
    vitalsHtml =
      '<div class="vtt-ins-bars">' +
        (pvMax !== null
          ? _bar('PV', pvCur??pvMax, pvMax, pvBarCol)
          : '<div class="vtt-ins-bar-row"><span class="vtt-ins-bar-lbl">PV</span><span style="color:var(--text-muted);font-size:.75rem;grid-column:2/-1">inconnus</span></div>') +
      '</div>';
    coreStatsHtml =
      '<div class="vtt-ins-stats">' +
        _stat('🛡', 'CA est.', caLabel) +
        _stat('🏃', 'Vitesse', vitLabel) +
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
    const _canEditToken = _canControlToken(t);
    const _inCombat = !!_session?.combat?.active;
    const pvEditHtml = _canEditToken
      ? '<input class="vtt-ins-input" type="number" value="'+hp+'" min="0" max="'+hpm+'" data-vtt-fn="_vttSetHp" data-vtt-on="change" data-vtt-args="'+t.id+'|$value">'
      : null;
    const pmEditHtml = (_canEditToken && pm !== null && pmMax !== null)
      ? '<input class="vtt-ins-input" type="number" value="'+pm+'" min="0" max="'+pmMax+'" data-vtt-fn="_vttSetPm" data-vtt-on="change" data-vtt-args="'+t.id+'|$value">'
      : null;
    // Bonus manuels « du tour » via les BUFFS du token. ld.display* les inclut
    // DÉJÀ (move_bonus / ca / range_bonus) → ne pas re-additionner. Le badge
    // affiche juste la part manuelle. Éditable par qui contrôle le token.
    const _badge = (k) => { const b = _manualBuffVal(t, k); return b ? `<sup class="vtt-ins-bonus ${b>0?'pos':'neg'}">${b>0?'+':''}${b}</sup>` : ''; };
    const _steps = (k) => _canEditToken
      ? `<span class="vtt-ins-stat-steps">`+
          `<button class="vtt-ins-stat-step" data-vtt-fn="_vttTokenBonus" data-vtt-args="${t.id}|${k}|-1" title="−1">−</button>`+
          `<button class="vtt-ins-stat-step" data-vtt-fn="_vttTokenBonus" data-vtt-args="${t.id}|${k}|1" title="+1">+</button>`+
        `</span>` : '';
    const _anyBonus = ['vitesse','ca','portee'].some(k => _manualBuffVal(t, k) !== 0);

    vitalsHtml =
      '<div class="vtt-ins-bars">' +
        _bar('PV', hp, hpm, hpColor(rat), pvEditHtml) +
        (pm !== null && pmMax !== null ? _bar('PM', pm, pmMax, '#b47fff', pmEditHtml) : '') +
      '</div>';
    coreStatsHtml =
      '<div class="vtt-ins-stats">' +
        (() => {
          const baseMvt = ld.displayMovement ?? 6;   // inclut déjà le buff move_bonus manuel
          const maxMvt  = baseMvt + (t.bonusMvt||0);
          const rem     = _inCombat ? Math.max(0, maxMvt - (t.movedCells||0)) : null;
          const mvLabel = _inCombat ? `${rem} / ${maxMvt} cases` : `${baseMvt} cases`;
          const remColor = _inCombat ? (rem===0?'#f87171':rem<=2?'#f59e0b':'#4ade80') : 'inherit';
          return `<div class="vtt-ins-stat"><span class="vtt-ins-stat-icon">🏃</span>`+
            `<span class="vtt-ins-stat-lbl">Mouvement</span>`+
            `<span class="vtt-ins-stat-val" style="color:${remColor}">${mvLabel}${_badge('vitesse')}</span>${_steps('vitesse')}</div>`;
        })() +
        _stat('⚔️', 'Attaque', atkLabel) +
        `<div class="vtt-ins-stat"><span class="vtt-ins-stat-label">🛡 CA</span>`+
          `<span class="vtt-ins-stat-val">${ld.caBadge ?? (ld.displayDefense??0)}${ld.caBadge === '?' ? '' : _badge('ca')}</span>${_steps('ca')}</div>` +
        `<div class="vtt-ins-stat"><span class="vtt-ins-stat-label">🎯 Portée</span>`+
          `<span class="vtt-ins-stat-val">${ld.displayRange??1} case(s)${_badge('portee')}</span>${_steps('portee')}</div>` +
        _stat('📍', 'Position', pos, true) +
        ((_canEditToken && _anyBonus)
          ? `<div class="vtt-ins-stat full" style="justify-content:flex-end">`+
              `<button class="vtt-ins-bonus-reset" data-vtt-fn="_vttTokenResetBonus" data-vtt-args="${t.id}" title="Réinitialiser les bonus manuels">↺ Reset bonus</button>`+
            `</div>` : '') +
        (t.attackedThisTurn
          ? '<div class="vtt-ins-stat full" style="gap:.4rem;flex-wrap:wrap">'+
              '<span class="vtt-ins-badge vtt-ins-badge-atk">✓ A attaqué</span>'+
            '</div>'
          : '') +
      '</div>';
  }

  // ── Infos créature (bestiaire) ─────────────────────────────────────────
  // MJ : fiche complète (CA réelle, stats, attaques, traits, butins…)
  // Joueur : ses propres déductions sur les attaques et traits
  let _creatureHtml = '';
  if (t.type === 'enemy' && t.beastId) {
    const beast = _bestiary[t.beastId];
    if (beast) {
      // Nouveau schéma : armesNaturelles + actions (spells unifiés) + butins (objets boutique)
      // Legacy : `attaques` (texte libre) — affiché en fallback si encore présent.
      const _atk     = Array.isArray(beast.attaques)        ? beast.attaques        : [];
      const _armesN  = Array.isArray(beast.armesNaturelles) ? beast.armesNaturelles : [];
      const _actions = Array.isArray(beast.actions)         ? beast.actions         : [];
      const _trt     = Array.isArray(beast.traits)          ? beast.traits          : [];
      const _btn     = Array.isArray(beast.butins)          ? beast.butins          : [];

      if (STATE.isAdmin) {
        // ── Vue MJ : tout est révélé ───────────────────────────────────
        const _stats6 = ['force','dexterite','constitution','intelligence','sagesse','charisme']
          .map(k => {
            const v = parseInt(beast[k]);
            if (!v && v !== 0) return null;
            const m = Math.floor((v - 10) / 2);
            const ms = m >= 0 ? '+'+m : m;
            return `<span class="vtt-creat-stat-pill"><b>${k.slice(0,3).toUpperCase()}</b> ${v} <span style="color:var(--text-dim)">(${ms})</span></span>`;
          }).filter(Boolean).join('');

        const _affHtml = ((arr, label, color) => {
          if (!Array.isArray(arr) || !arr.length) return '';
          return `<div class="vtt-creat-aff"><span class="vtt-creat-aff-lbl" style="color:${color}">${label}</span> ${arr.map(x => _esc(typeof x === 'object' ? (x.nom || x.type || '?') : x)).join(', ')}</div>`;
        });

        const realCaBuffed = (typeof calcCA === 'function' && ld.displayDefense !== undefined) ? ld.displayDefense : (beast.ca ?? 0);
        const rsLabel = { classique:'Classique', elite:'Élite', boss:'Boss' }[String(beast.rang||'').toLowerCase()] || 'Classique';

        _creatureHtml = `
          <div class="vtt-ins-section vtt-creat-mj">
            <div class="vtt-ins-section-title">📜 Fiche créature
              <span class="vtt-creat-rang vtt-creat-rang--${String(beast.rang||'classique').toLowerCase()}">${rsLabel}</span>
            </div>
            <div class="vtt-creat-vitals">
              <span class="vtt-creat-vital">🛡 CA <b>${beast.ca ?? '?'}</b>${realCaBuffed !== (beast.ca ?? 0) ? ` <span style="color:#a78bfa">(actuel ${realCaBuffed})</span>` : ''}</span>
              <span class="vtt-creat-vital">❤️ PV max <b>${beast.pvMax ?? '?'}</b></span>
              ${beast.pmMax ? `<span class="vtt-creat-vital">💧 PM max <b>${beast.pmMax}</b></span>` : ''}
              <span class="vtt-creat-vital">🏃 Vit. <b>${beast.vitesse ?? '?'}</b></span>
              ${beast.initiative ? `<span class="vtt-creat-vital">⚡ Init. <b>${beast.initiative}</b></span>` : ''}
              ${beast.niveau ? `<span class="vtt-creat-vital">📊 Nv. <b>${beast.niveau}</b></span>` : ''}
            </div>
            ${_stats6 ? `<div class="vtt-creat-stats6">${_stats6}</div>` : ''}
            ${_affHtml(beast.faiblesses,  'Faiblesses',   '#f87171')}
            ${_affHtml(beast.resistances, 'Résistances',  '#fbbf24')}
            ${_affHtml(beast.immunites,   'Immunités',    '#94a3b8')}
            ${_affHtml(beast.absorptions, 'Absorptions',  '#a78bfa')}
            ${beast.description ? `<div class="vtt-creat-desc">${_esc(beast.description)}</div>` : ''}
            ${_armesN.length ? `
              <div class="vtt-creat-sub-title">🦷 Armes naturelles (${_armesN.length})</div>
              ${_armesN.map(w => {
                const statShort = { force:'For', dexterite:'Dex', intelligence:'Int', sagesse:'Sag', constitution:'Con', charisme:'Cha', none:'—' };
                const dStat = statShort[w.degatsStat]  || '';
                const tStat = statShort[w.toucherStat] || '';
                const flatD = parseInt(w.degatsFlat)  || 0;
                const flatT = parseInt(w.toucherFlat) || 0;
                return `<div class="vtt-creat-atk">
                  <div class="vtt-creat-atk-name">${_esc(w.nom || 'Arme')}</div>
                  <div class="vtt-creat-atk-stats">
                    ${w.degats ? `<span class="vtt-creat-atk-stat dmg">⚔️ ${_esc(w.degats)}${dStat?` <span style="opacity:.7">(${dStat}${flatD?` ${flatD>0?'+':''}${flatD}`:''})</span>`:''}</span>` : ''}
                    ${tStat || flatT ? `<span class="vtt-creat-atk-stat touch">🎯 ${tStat}${flatT?` ${flatT>0?'+':''}${flatT}`:''}</span>` : ''}
                    ${w.portee  ? `<span class="vtt-creat-atk-stat range">📏 ${_esc(w.portee)}</span>` : ''}
                  </div>
                </div>`;
              }).join('')}` : ''}
            ${_actions.length ? `
              <div class="vtt-creat-sub-title">⚔️ Actions (${_actions.length})</div>
              ${_actions.map(a => {
                const runeBadgesHtml = runeBadges(a.runes || [], { className: 'vtt-creat-rune' });
                const typeBadges = spellTypeBadges(a.types || [], { className: 'vtt-creat-act-type', stylePrefix: '--c:' });
                return `<div class="vtt-creat-act">
                  <div class="vtt-creat-act-head">
                    <span class="vtt-creat-act-ico">${_esc(a.icon||'🔮')}</span>
                    <span class="vtt-creat-act-name">${_esc(a.nom||'Action')}</span>
                    <span class="vtt-creat-act-pm">${a.pmOverride ?? a.pm ?? '?'} PM</span>
                  </div>
                  ${typeBadges || runeBadgesHtml ? `<div class="vtt-creat-act-badges">${typeBadges}${runeBadgesHtml}</div>` : ''}
                </div>`;
              }).join('')}` : ''}
            ${(_atk.length && !_armesN.length && !_actions.length) ? `
              <div class="vtt-creat-sub-title">🗡 Attaques (${_atk.length})</div>
              ${_atk.map(a => `
                <div class="vtt-creat-atk">
                  <div class="vtt-creat-atk-name">${_esc(a.nom || 'Attaque')}</div>
                  <div class="vtt-creat-atk-stats">
                    ${a.toucher ? `<span class="vtt-creat-atk-stat touch">🎯 ${_esc(a.toucher)}</span>` : ''}
                    ${a.degats  ? `<span class="vtt-creat-atk-stat dmg">⚔️ ${_esc(a.degats)}</span>`   : ''}
                    ${a.portee  ? `<span class="vtt-creat-atk-stat range">📏 ${_esc(a.portee)}</span>` : ''}
                  </div>
                  ${a.description ? `<div class="vtt-creat-atk-desc">${_esc(a.description)}</div>` : ''}
                </div>`).join('')}` : ''}
            ${_trt.length ? `
              <div class="vtt-creat-sub-title">✨ Traits (${_trt.length})</div>
              ${_trt.map(tr => `
                <div class="vtt-creat-trait">
                  <div class="vtt-creat-trait-name">${_esc(tr.nom || '')}</div>
                  ${tr.description ? `<div class="vtt-creat-trait-desc">${_esc(tr.description)}</div>` : ''}
                </div>`).join('')}` : ''}
            ${_btn.length ? `
              <div class="vtt-creat-sub-title">💰 Butins (${_btn.length})</div>
              <div class="vtt-creat-loots">
                ${_btn.map((b,i) => {
                  const orphan = !b.itemId;
                  return `<div class="vtt-creat-loot" data-loot-idx="${i}">
                    ${b.image
                      ? `<img class="vtt-creat-loot-img" src="${_esc(b.image)}" alt="">`
                      : `<span class="vtt-creat-loot-img vtt-creat-loot-img--empty">📦</span>`}
                    <span class="vtt-creat-loot-name">${_esc(b.nom || 'Objet')}</span>
                    ${b.quantite ? `<span class="vtt-creat-loot-meta">${_esc(b.quantite)}</span>` : ''}
                    ${b.chance   ? `<span class="vtt-creat-loot-meta">${_esc(b.chance)}</span>`   : ''}
                    ${orphan
                      ? `<span class="vtt-creat-loot-add" style="opacity:.4;cursor:not-allowed" title="Objet supprimé de la boutique">＋</span>`
                      : `<button class="vtt-creat-loot-add" data-vtt-fn="_vttCreatSendLootToStash" data-vtt-args="${t.beastId}|${i}|$this" title="Envoyer à la réserve MJ">＋</button>`}
                  </div>`;
                }).join('')}
              </div>` : ''}
          </div>`;
      } else {
        // ── Vue joueur : seulement ses propres déductions ──────────────
        const track = _bstTracker[t.beastId] || {};
        const ded   = track.deductions || {};
        const _bid  = t.beastId;
        const _hasNotes = (track.notes || '').trim().length > 0;
        // Détermine si au moins une déduction d'attaque ou de trait est renseignée
        const _hasAnyDed = Object.values(ded).some(v => v && String(v).trim());

        _creatureHtml = `
          <div class="vtt-ins-section vtt-creat-pl">
            <div class="vtt-ins-section-title">📝 Mes observations</div>
            <div class="vtt-creat-help">Renseigne ici ce que tu as découvert sur cette créature. Sauvegardé automatiquement (visible aussi dans le Bestiaire).</div>
            ${_actions.length ? `
              <div class="vtt-creat-sub-title">⚔️ Actions observées (${_actions.length})</div>
              ${_actions.map((act, i) => {
                const k = act.id || `idx_${i}`;
                return `<div class="vtt-creat-atk-edit">
                  <input class="vtt-creat-input" placeholder="Nom de l'action…"
                    value="${_esc(ded['act_nom_'+k] || '')}"
                    data-vtt-fn="_vttBstDed" data-vtt-on="change" data-vtt-args="${_bid}|act_nom_${k}|$value">
                  <div class="vtt-creat-atk-row3">
                    <input class="vtt-creat-input" placeholder="🎯 Toucher"
                      value="${_esc(ded['act_toucher_'+k] || '')}"
                      data-vtt-fn="_vttBstDed" data-vtt-on="change" data-vtt-args="${_bid}|act_toucher_${k}|$value">
                    <input class="vtt-creat-input" placeholder="⚔️ Dégâts"
                      value="${_esc(ded['act_degats_'+k] || '')}"
                      data-vtt-fn="_vttBstDed" data-vtt-on="change" data-vtt-args="${_bid}|act_degats_${k}|$value">
                    <input class="vtt-creat-input" placeholder="📏 Portée"
                      value="${_esc(ded['act_portee_'+k] || '')}"
                      data-vtt-fn="_vttBstDed" data-vtt-on="change" data-vtt-args="${_bid}|act_portee_${k}|$value">
                  </div>
                </div>`;
              }).join('')}` : ''}
            ${_trt.length ? `
              <div class="vtt-creat-sub-title">✨ Traits observés (${_trt.length})</div>
              ${_trt.map((_, i) => `
                <div class="vtt-creat-trait-edit">
                  <input class="vtt-creat-input" placeholder="Nom du trait…"
                    value="${_esc(ded['tr_nom_'+i] || '')}"
                    data-vtt-fn="_vttBstDed" data-vtt-on="change" data-vtt-args="${_bid}|tr_nom_${i}|$value">
                  <input class="vtt-creat-input" placeholder="Description…"
                    value="${_esc(ded['tr_desc_'+i] || '')}"
                    data-vtt-fn="_vttBstDed" data-vtt-on="change" data-vtt-args="${_bid}|tr_desc_${i}|$value">
                </div>`).join('')}` : ''}
            <div class="vtt-creat-sub-title">📔 Notes</div>
            <textarea class="vtt-creat-input vtt-creat-notes" rows="3" placeholder="Tes notes sur cette créature…"
              data-vtt-fn="_vttBstNotes" data-vtt-on="change" data-vtt-args="${_bid}|$value">${_esc(track.notes || '')}</textarea>
            ${!_actions.length && !_trt.length && !_hasNotes && !_hasAnyDed
              ? '<div class="vtt-creat-help" style="margin-top:.4rem">Aucune action/trait recensé par le MJ pour cette créature pour le moment.</div>'
              : ''}
          </div>`;
      }
    }
  }

  // ── Effets actifs (buffs, debuffs, DoT, enchantements, afflictions…) ──
  const _r = _session?.combat?.round ?? 0;
  const _activeBuffs = (t.buffs || []).filter(bf =>
    bf?.expiresAtRound == null || _r === 0 || _r <= bf.expiresAtRound);
  const _buffsHtml = _activeBuffs.length ? (() => {
    const _BUFF_LABEL = {
      ca: 'Bonus CA', dot: 'Dégâts/tour', regen: 'Régénération',
      dmg_bonus: 'Dégâts bonus',
      move_bonus: 'Mouvement +', move_debuff: 'Mouvement −',
      range_bonus: 'Portée +', shield_reactive: 'Bouclier réactif',
      enchantment: 'Enchantement', affliction: 'Affliction',
    };
    const items = _activeBuffs.map((bf, i) => {
      const ic = bf.icon || '✨';
      const lbl = bf.sortLabel || _BUFF_LABEL[bf.type] || bf.type || 'Effet';
      // Calcul durée restante
      let durStr;
      if (bf.canalisePersistant) durStr = '∞ canalisé';
      else if (bf.expiresAtRound != null && _r > 0) durStr = `${bf.expiresAtRound - _r + 1}t`;
      else if (bf.totalDuration != null) durStr = `${bf.totalDuration}t`;
      else durStr = '∞';
      // Détail (bonus, formule, slot, charges)
      const detail = bf.type === 'dmg_bonus' ? `+${bf.formula}`
                   : bf.type === 'move_bonus' || bf.type === 'move_debuff' ? `${bf.bonus > 0 ? '+' : ''}${bf.bonus} c`
                   : bf.type === 'range_bonus' ? `+${bf.bonus} c`
                   : bf.type === 'ca' ? `${bf.bonus >= 0 ? '+' : ''}${bf.bonus} CA`
                   : bf.type === 'dot' || bf.type === 'regen' ? `${bf.formula} / tour`
                   : bf.type === 'shield_reactive' ? `${bf.charges || 1} charge · ${bf.tier}`
                   : bf.effect ? bf.effect.slice(0, 24) : '';
      const rmBtn = STATE.isAdmin
        ? `<button class="vtt-buff-rm" data-vtt-fn="_vttRemoveBuff" data-vtt-args="${t.id}|${i}" title="Retirer">✕</button>` : '';
      // Sort suspendu : bouton ▶ pour le déclencher (porteur ou MJ)
      const canTrigger = bf.type === 'suspended_spell' && _canControlToken(t);
      const trigBtn = canTrigger
        ? `<button class="vtt-buff-trigger" data-vtt-fn="_vttTriggerSuspendedSpell" data-vtt-args="${t.id}|${i}" title="Déclencher le sort suspendu">▶</button>` : '';
      return `<div class="vtt-buff-item" title="${_esc(lbl)}${detail?' · '+_esc(detail):''}">
        <span class="vtt-buff-ic">${ic}</span>
        <span class="vtt-buff-lbl">${_esc(lbl)}</span>
        ${detail ? `<span class="vtt-buff-detail">${_esc(detail)}</span>` : ''}
        <span class="vtt-buff-dur">${durStr}</span>
        ${trigBtn}${rmBtn}
      </div>`;
    }).join('');
    const addBtn = STATE.isAdmin
      ? `<button class="vtt-btn-sm" data-vtt-fn="_vttAddBuffPrompt" data-vtt-args="${t.id}" title="Ajouter un effet manuel">＋</button>` : '';
    return `<div class="vtt-ins-section">
      <div class="vtt-ins-section-title">✨ Effets actifs ${addBtn}</div>
      <div class="vtt-buff-list">${items}</div>
    </div>`;
  })() : (STATE.isAdmin
    ? `<div class="vtt-ins-section">
        <div class="vtt-ins-section-title">✨ Effets actifs <button class="vtt-btn-sm" data-vtt-fn="_vttAddBuffPrompt" data-vtt-args="${t.id}">＋</button></div>
        <div style="font-size:.72rem;color:var(--text-dim);font-style:italic">Aucun effet actif</div>
      </div>` : '');

  // ── Conditions / États du token (visibles par tous, gérables par le MJ) ──
  const _conds = Array.isArray(t.conditions) ? t.conditions : [];
  const _condIsActive = c => c.expiresAtRound == null || _r === 0 || _r <= c.expiresAtRound;
  const _activeConds = _conds.filter(_condIsActive);
  const _condsHtml = (() => {
    const addBtn = STATE.isAdmin
      ? `<span class="vtt-ins-section-actions">
          <button class="vtt-btn-sm" data-vtt-fn="_vttConditionAdd" data-vtt-args="${t.id}" title="Appliquer un état">＋</button>
          <button class="vtt-btn-sm" data-vtt-fn="_vttConditionConfig" title="Réglages : ce que chaque état fait, sa stat de JS et son DD par défaut">⚙</button>
        </span>` : '';
    if (!_activeConds.length && !STATE.isAdmin) return ''; // joueurs : section cachée si vide
    const rows = _activeConds.map((cond, i) => {
      const lib = CONDITION_BY_ID[cond.id] || { label: cond.id, icon: '❓', color: '#888', desc: '' };
      const dur = cond.expiresAtRound != null && _r > 0
        ? `${cond.expiresAtRound - _r + 1}t`
        : (cond.expiresAtRound != null ? 'fin' : '∞');
      const srcLine = cond.source ? `<div class="vtt-cond-src">📝 ${_esc(cond.source)}</div>` : '';
      const saveLbl = cond.saveDC && cond.saveStat
        ? `${statShort(cond.saveStat) || cond.saveStat} DD ${cond.saveDC}` : null;
      const realIdx = _conds.indexOf(cond);
      const ctrls = STATE.isAdmin ? `
        <div class="vtt-cond-ctrls">
          ${saveLbl ? `<button class="vtt-cond-save" data-vtt-fn="_vttConditionSave" data-vtt-args="${t.id}|${realIdx}" title="Lancer le jet de sauvegarde">🎲 JS ${saveLbl}</button>` : ''}
          <button class="vtt-cond-edit" data-vtt-fn="_vttConditionEdit" data-vtt-args="${t.id}|${realIdx}" title="Modifier durée, DD, source">✏️</button>
          <button class="vtt-cond-rm" data-vtt-fn="_vttConditionRemove" data-vtt-args="${t.id}|${realIdx}" title="Retirer l'état">✕</button>
        </div>` : '';
      return `<div class="vtt-cond-item" style="--cond-c:${lib.color}">
        <div class="vtt-cond-hd">
          <span class="vtt-cond-ic">${lib.icon}</span>
          <span class="vtt-cond-nom">${lib.label}</span>
          <span class="vtt-cond-dur">${dur}</span>
        </div>
        <div class="vtt-cond-desc">${lib.desc}</div>
        ${srcLine}
        ${ctrls}
      </div>`;
    }).join('');
    return `<div class="vtt-ins-section">
      <div class="vtt-ins-section-title">⚡ États ${addBtn}</div>
      <div class="vtt-cond-list">${rows || '<div style="font-size:.72rem;color:var(--text-dim);font-style:italic">Aucun état actif</div>'}</div>
    </div>`;
  })();

  // ── Fragments par onglet (calculés puis répartis) ──────────────────────
  const _combatActionsHtml = (() => {
    const inCombat = !!_session?.combat?.active;
    const canEdit  = _canControlToken(t);
    if (!inCombat || !canEdit || (t.type !== 'player' && t.type !== 'npc')) return '';
    const ld2  = _live(t);
    const base = ld2.displayMovement ?? 6;
    const couru = (t.bonusMvt||0) > 0;
    return `<div class="vtt-ins-section">
        <div class="vtt-ins-section-title">⚔️ Actions de combat</div>
        <div class="vtt-combat-actions">
          <button class="vtt-combat-action-btn${couru?' used':''}"
            data-vtt-fn="_vttCourir" data-vtt-args="${t.id}"
            ${couru?'disabled':''}>
            <span class="vtt-ca-icon">🏃</span>
            <span class="vtt-ca-body">
              <span class="vtt-ca-name">Courir</span>
              <span class="vtt-ca-desc">${couru?'Déjà utilisé':'Ajoute +'+base+' cases de mouvement'}</span>
            </span>
          </button>
        </div>
      </div>`;
  })();

  const _skillsHtml = ((t.type==='player'||t.type==='npc') && _diceSkills.length && _canControlToken(t)) ? (() => {
    const cForBonus = t?.characterId ? _characters[t.characterId] : null;
    const btns = _diceSkills.map(s => {
      const statKey = _STAT_KEY[s.stat] || '';
      const statMod = _tokenStatMod(t, statKey);
      const eqBonus = cForBonus ? computeEquipSkillBonus(cForBonus.equipement || {}, s.name) : 0;
      const mod = statMod + eqBonus;
      const modStr = mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : '±0';
      const col  = _STAT_COLOR[s.stat] || 'var(--text-dim)';
      const eqTitle = eqBonus !== 0 ? ` title="Inclut ${eqBonus>0?'+':''}${eqBonus} équip."` : '';
      return `<button class="vtt-skill-btn" data-vtt-fn="_vttRollSkill" data-vtt-args="${_esc(s.name)}|${s.stat}"${eqTitle}>
          <span class="vtt-sk-name">${s.name}${eqBonus!==0?' <span style="color:#22c38e;font-size:.7em">●</span>':''}</span>
          <span class="vtt-sk-mod" style="color:${col}">${s.stat ? s.stat+' '+modStr : '—'}</span>
        </button>`;
    }).join('');
    return `<div class="vtt-ins-section">
        <div class="vtt-ins-section-title">🎲 Jets de compétences</div>
        <div class="vtt-roll-mode-row">
          <button class="vtt-roll-mode-btn${_rollMode==='disadvantage'?' active':''}" data-mode="disadvantage" data-vtt-fn="_vttSetRollMode" data-vtt-args="disadvantage" title="Désavantage — prend le plus bas des 2 dés">⬇ Désav.</button>
          <button class="vtt-roll-mode-btn${_rollMode==='normal'?' active':''}" data-mode="normal" data-vtt-fn="_vttSetRollMode" data-vtt-args="normal" title="Jet classique — 1d20">⚪ Normal</button>
          <button class="vtt-roll-mode-btn${_rollMode==='advantage'?' active':''}" data-mode="advantage" data-vtt-fn="_vttSetRollMode" data-vtt-args="advantage" title="Avantage — prend le plus haut des 2 dés">⬆ Avantage</button>
        </div>
        <div class="vtt-roll-bonus-row">
          <span class="vtt-roll-bonus-lbl">Bonus contextuel</span>
          <button class="vtt-roll-bonus-adj" data-vtt-fn="_vttAdjBonus" data-vtt-args="-1">−</button>
          <span class="vtt-roll-bonus-val${_rollBonus!==0?' nonzero':''}" id="vtt-bonus-val">${_rollBonus>0?'+'+_rollBonus:_rollBonus}</span>
          <button class="vtt-roll-bonus-adj" data-vtt-fn="_vttAdjBonus" data-vtt-args="1">+</button>
          <button class="vtt-roll-bonus-reset" data-vtt-fn="_vttAdjBonus" data-vtt-args="0|true" title="Réinitialiser">↺</button>
        </div>
        ${STATE.isAdmin ? `
        <div class="vtt-roll-bonus-row">
          <span class="vtt-roll-bonus-lbl">Visibilité</span>
          <button class="vtt-roll-mode-btn vtt-roll-hide-btn${_rollHidden?' active':''}" id="vtt-roll-hide-btn"
            data-vtt-fn="_vttToggleRollHidden"
            title="Jet caché : seul le MJ voit le résultat dans le log">
            ${_rollHidden ? '🕶 Jet caché MJ' : '👁 Visible joueurs'}
          </button>
        </div>` : ''}
        <div class="vtt-ins-skills">${btns}</div>
      </div>`;
  })() : '';

  const _delegateHtml = (() => {
    // Délégation de contrôle — visible pour propriétaire OU MJ
    const uid = STATE.user?.uid;
    const isOwner = uid && t.ownerId === uid;
    if (!isOwner && !STATE.isAdmin) return '';
    const dels = Array.isArray(t.controlDelegates) ? t.controlDelegates : [];
    const lookupName = _resolveUidName;
    const chips = dels.length
      ? dels.map(u => `<span class="vtt-delegate-chip">
            <span>${_esc(lookupName(u))}</span>
            <button class="vtt-delegate-x" data-vtt-fn="_vttRemoveTokenDelegate"
              data-vtt-args="${t.id}|${u}" title="Retirer">×</button>
          </span>`).join('')
      : '<span class="vtt-delegate-empty">Personne — vous seul contrôlez ce token.</span>';
    return `<div class="vtt-ins-section">
        <div class="vtt-ins-section-title">🤝 Contrôle délégué</div>
        <div class="vtt-delegate-list">${chips}</div>
        <button class="vtt-btn-sm vtt-delegate-add"
          data-vtt-fn="_vttOpenTokenDelegatesModal" data-vtt-args="${t.id}"
          title="Autoriser un autre joueur à contrôler ce token">＋ Ajouter un joueur</button>
      </div>`;
  })();

  const _sendPageHtml = (STATE.isAdmin && pageOpts) ? `
      <div class="vtt-ins-section">
        <div class="vtt-ins-section-title">📡 Envoyer le joueur vers</div>
        <select class="vtt-ins-select" data-vtt-fn="_vttMoveTokenAndReset" data-vtt-on="change" data-vtt-args="$this|${t.id}">
          <option value="">— choisir une page —</option>${pageOpts}
        </select>
      </div>` : '';

  const _footerHtml = STATE.isAdmin ? `
      <div class="vtt-ins-section">
        <div class="vtt-ins-section-title">🛠 Outils MJ</div>
        <div class="vtt-ins-actions">
          <button class="vtt-btn-sm" data-vtt-fn="_vttEditToken" data-vtt-args="${t.id}" title="Modifier les stats combat">⚙️ Stats</button>
          <button class="vtt-btn-sm" data-vtt-fn="_vttToggleVisible" data-vtt-args="${t.id}" title="Visibilité joueurs">${t.visible?'👁 Visible':'🙈 Caché'}</button>
          ${_session?.combat?.active?`<button class="vtt-btn-sm" data-vtt-fn="_vttResetTurn" data-vtt-args="${t.id}" title="Réinitialiser le tour de ce token">↺ Tour</button>`:''}
          ${t.pageId?`<button class="vtt-btn-sm" data-vtt-fn="_vttRetireToken" data-vtt-args="${t.id}" title="Retirer de la carte">↩ Retirer</button>`:''}
          ${(t.buffs||[]).length?`<button class="vtt-btn-sm vtt-btn-danger" data-vtt-fn="_vttClearBuffs" data-vtt-args="${t.id}" title="Supprimer tous les buffs actifs">🗑 Buffs</button>`:''}
        </div>
      </div>` : '';

  // ── Répartition en onglets ─────────────────────────────────────────────
  // Actions d'une créature invoquée (token summonKind='invocation')
  const _summonActionsHtml = (Array.isArray(t.summonActions) && t.summonActions.length)
    ? `<div class="vtt-ins-section">
        <div class="vtt-ins-section-title">🎬 Actions de la créature</div>
        ${t.summonActions.map(a => {
          const det = [a.degats && `🎲 ${_esc(a.degats)}`, a.portee && `📏 ${_esc(a.portee)}`, a.pm ? `${a.pm} PM` : ''].filter(Boolean).join(' · ');
          return `<div class="vtt-creat-act">
            <div class="vtt-creat-act-name">🎬 ${_esc(a.nom || 'Action')}</div>
            ${det ? `<div style="font-size:.7rem;color:var(--text-muted);margin-top:.12rem">${det}</div>` : ''}
            ${a.effet ? `<div class="vtt-creat-atk-desc">${_esc(a.effet)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>`
    : '';

  const _tabs = [
    { k:'stats',    ic:'📊', lb:'Stats',     html: coreStatsHtml },
    { k:'combat',   ic:'🎲', lb:'Jets',      html: _combatActionsHtml + _skillsHtml },
    { k:'invoc',    ic:'🐾', lb:'Actions',   html: _summonActionsHtml },
    { k:'effets',   ic:'✨', lb:'Effets',    html: _condsHtml + _buffsHtml },
    { k:'creature', ic:'📜', lb:'Bestiaire', html: _creatureHtml },
    { k:'gerer',    ic:'⚙️', lb:'Gérer',     html: _delegateHtml + _sendPageHtml + _footerHtml },
  ].filter(s => s.html && s.html.trim());

  const _active = _tabs.some(s => s.k === _insTab) ? _insTab : (_tabs[0]?.k || 'stats');
  const _tabBar = _tabs.length > 1
    ? `<div class="vtt-ins-tabbar">${_tabs.map(s =>
        `<button class="vtt-ins-tab${s.k===_active?' active':''}" data-vtt-fn="_vttInsTab" data-vtt-args="${s.k}" title="${s.lb}">
          <span class="vtt-ins-tab-ic">${s.ic}</span><span class="vtt-ins-tab-lbl">${s.lb}</span>
        </button>`).join('')}</div>`
    : '';
  const _tabBody = _tabs.find(s => s.k === _active)?.html || '';

  el.innerHTML=`
    <div class="vtt-ins-header">
      ${img?`<img src="${img}" class="vtt-ins-avatar" alt="">`
           :`<div class="vtt-ins-avatar-icon" style="background:${TYPE_COLOR[t.type]??'#888'}">${icon}</div>`}
      <div style="min-width:0">
        <div class="vtt-ins-name">${ld.displayName??t.name}</div>
        <div class="vtt-ins-type">${icon} ${lbl}${linked?' · 🔗':''}</div>
      </div>
    </div>
    ${vitalsHtml}
    ${_tabBar}
    <div class="vtt-ins-tabbody">${_tabBody}</div>`;
}

function _vttInsTab(tab) {
  _insTab = tab;
  const t = _selected ? (_tokens[_selected]?.data ?? null) : null;
  if (t) _renderInspector(t);
}

// ═══════════════════════════════════════════════════════════════════
// TRAY — panneau latéral MJ
// ═══════════════════════════════════════════════════════════════════
function _vttTrayFilter(f) { _trayFilter = f; _renderTraySoon(); }
function _vttTraySearch(v) { _traySearch = String(v || ''); _renderTraySoon(); }
function _vttTrayClearSearch() { _traySearch = ''; _renderTraySoon(); }
function _vttToggleOn() { _trayOnOpen  = !_trayOnOpen;  _saveTrayPref('on',  _trayOnOpen);  _renderTraySoon(); }
function _vttToggleOff() { _trayOffOpen = !_trayOffOpen; _saveTrayPref('off', _trayOffOpen); _renderTraySoon(); }
function _vttToggleNpc() { _trayNpcOpen = !_trayNpcOpen; _saveTrayPref('npc', _trayNpcOpen); _renderTraySoon(); }

// Coalesce les rafales de snapshots (chrs/npcs/bsts/toks au mount) → 1 render par tick
let _trayDirty = false;
function _renderTraySoon() {
  if (_trayDirty) return;
  _trayDirty = true;
  queueMicrotask(() => { _trayDirty = false; _renderTray(); });
}

function _renderTray() {
  if (!STATE.isAdmin) { _renderPageTabs(); return; }
  _renderPageList();
  const el = document.getElementById('vtt-tray-tokens'); if (!el) return;

  // Sauve focus + caret du champ recherche : sans ça, chaque keystroke
  // déclenche un rerender qui détruit l'input → focus perdu.
  const ae = document.activeElement;
  const searchFocused = ae?.classList?.contains('vtt-tray-search-input') && el.contains(ae);
  const caretPos = searchFocused ? ae.selectionStart : null;

  const all      = Object.values(_tokens).map(e => e.data);
  const onPage   = all.filter(t => t.pageId === _activePage?.id);
  const reserveSeen = new Set();
  const reserve  = all.filter(t => {
    if (t.pageId || t.type === 'enemy') return false;
    const key = _tokenEntityKey(t);
    if (!key) return true;
    if (reserveSeen.has(key)) return false;
    reserveSeen.add(key);
    return true;
  });
  const inCombat = !!_session?.combat?.active;

  // Tokens placés sur d'autres pages (perso/PNJ seulement, déduplication par entité,
  // et on cache les persos déjà présents sur la page active).
  const entityOnCurrent = new Set();
  for (const t of onPage) {
    if (t.characterId) entityOnCurrent.add('c:' + t.characterId);
    if (t.npcId)       entityOnCurrent.add('n:' + t.npcId);
  }
  const elsewhereRaw = all.filter(t =>
    t.pageId && t.pageId !== _activePage?.id
    && t.type !== 'enemy'
    && (t.characterId || t.npcId)
    && !entityOnCurrent.has((t.characterId ? 'c:' + t.characterId : 'n:' + t.npcId))
  );
  const elsewhereSeen = new Set();
  const elsewhere = elsewhereRaw.filter(t => {
    const k = t.characterId ? 'c:' + t.characterId : 'n:' + t.npcId;
    if (elsewhereSeen.has(k)) return false;
    elsewhereSeen.add(k);
    return true;
  });

  // Filtre par type
  const applyFilter = arr => _trayFilter === 'all' ? arr : arr.filter(t => t.type === _trayFilter);

  // ── Item liste (sur la page) ──────────────────────────────────────
  const mkItem = (t, placed) => {
    const ld = _live(t);
    const hpKnownL = ld.displayHp !== null && ld.displayHpMax !== null;
    const hp = hpKnownL ? ld.displayHp : 0, hpm = hpKnownL ? ld.displayHpMax : 1;
    const rat = hpKnownL ? (hpm > 0 ? Math.max(0, hp / hpm) : 1) : 0.5;
    const typeIcon = t.type === 'player' ? '🧑' : t.type === 'npc' ? '👤' : '👹';
    const dupBtn = t.type === 'enemy'
      ? `<button class="vtt-tray-btn" data-vtt-fn="_vttDuplicateToken" data-vtt-args="${t.id}" title="Dupliquer">＋</button>` : '';
    const delBtn = t.type === 'enemy'
      ? `<button class="vtt-tray-btn vtt-tray-btn-del" data-vtt-fn="_vttDeleteToken" data-vtt-args="${t.id}" title="Supprimer">×</button>` : '';
    const actionBtn = !placed
      ? `<button class="vtt-tray-btn" data-vtt-fn="_vttPlace" data-vtt-args="${t.id}" title="Placer">▶</button>`
      : `<button class="vtt-tray-btn" data-vtt-fn="_vttRetireToken" data-vtt-args="${t.id}" title="Retirer">↩</button>`;
    // HP fraction visible pour les ennemis en combat
    const hpFrac = inCombat && t.type === 'enemy' && hpKnownL
      ? `<span class="vtt-tray-hp-frac" style="color:${hpColor(rat)}">${hp}/${hpm}</span>` : '';
    return `<div class="vtt-tray-item ${_selected === t.id ? 'active' : ''}" data-vtt-fn="_vttSelectFromTray" data-vtt-args="${t.id}">
      <div class="vtt-tray-dot" style="background:${TYPE_COLOR[t.type] ?? '#888'}">
        ${ld.displayImage
          ? `<img src="${ld.displayImage}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
          : `<span style="font-size:.65rem">${typeIcon}</span>`}
      </div>
      <div class="vtt-tray-info">
        <div class="vtt-tray-name">${_esc(ld.displayName ?? t.name)}</div>
        <div class="vtt-tray-hp-row">
          <div class="vtt-tray-hp-bar" style="flex:1"><div style="width:${Math.round(rat * 100)}%;height:100%;background:${hpKnownL ? hpColor(rat) : '#555'};border-radius:2px"></div></div>
          ${hpFrac}
        </div>
      </div>
      <div class="vtt-tray-actions">${dupBtn}${actionBtn}${delBtn}</div>
    </div>`;
  };

  // ── Ligne compacte (réserve) — 1 par ligne, nom complet, statut online ─
  const _onlineTs = Date.now();
  const isOnline = uid => !!(uid && _presence[uid] && _onlineTs - (_presence[uid].lastSeen || 0) < 120_000);
  const mkResLine = t => {
    const ld = _live(t);
    const typeIcon = t.type === 'player' ? '🧑' : '👤';
    const col = TYPE_COLOR[t.type] ?? '#888';
    const showStatus = t.type === 'player';
    const online = showStatus && isOnline(t.ownerId);
    const statusDot = showStatus
      ? `<span class="vtt-res-line-status ${online ? 'is-online' : ''}" title="${online ? 'En ligne' : 'Hors ligne'}"></span>`
      : '';
    const name = _esc(ld.displayName ?? t.name);
    return `<button class="vtt-res-line" data-vtt-fn="_vttPlace" data-vtt-args="${t.id}" title="Placer ${name}">
      <span class="vtt-res-line-dot" style="border-color:${col};color:${col}">
        ${ld.displayImage
          ? `<img src="${ld.displayImage}" alt="">`
          : `<span>${typeIcon}</span>`}
        ${statusDot}
      </span>
      <span class="vtt-res-line-name">${name}</span>
    </button>`;
  };

  // Conservé pour la section "Sur d'autres pages" qui utilise toujours la grid.
  const mkChip = t => {
    const ld = _live(t);
    const typeIcon = t.type === 'player' ? '🧑' : '👤';
    const col = TYPE_COLOR[t.type] ?? '#888';
    return `<button class="vtt-res-chip" data-vtt-fn="_vttPlace" data-vtt-args="${t.id}"
        title="Placer ${_esc(ld.displayName ?? t.name)}">
      <div class="vtt-res-chip-dot" style="border-color:${col};color:${col}">
        ${ld.displayImage
          ? `<img src="${ld.displayImage}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
          : `<span>${typeIcon}</span>`}
      </div>
      <span class="vtt-res-chip-name">${_esc(ld.displayName ?? t.name)}</span>
    </button>`;
  };

  // ── Pills de filtre ───────────────────────────────────────────────
  const filterPills = `<div class="vtt-tray-filters">
    ${[['all','Tout'],['player','🧑'],['npc','👤'],['enemy','👹']].map(([v,l]) =>
      `<button class="vtt-tray-fp${_trayFilter === v ? ' active' : ''}" data-vtt-fn="_vttTrayFilter" data-vtt-args="${v}">${l}</button>`
    ).join('')}
  </div>`;

  // ── Sur la page — groupé par type ────────────────────────────────
  const filteredPage = applyFilter(onPage);
  let pageSec = '';
  if (!filteredPage.length) {
    pageSec = `<div class="vtt-tray-empty">${_trayFilter === 'all' ? 'Aucun token sur cette page' : 'Aucun ici'}</div>`;
  } else {
    const pagePlayers = filteredPage.filter(t => t.type === 'player');
    const pageNpcs    = filteredPage.filter(t => t.type === 'npc');
    let   pageEnemies = filteredPage.filter(t => t.type === 'enemy');

    // En combat : ennemis triés par HP% croissant (blessés en premier)
    if (inCombat && pageEnemies.length > 1) {
      pageEnemies = [...pageEnemies].sort((a, b) => {
        const la = _live(a), lb = _live(b);
        const ra = (la.displayHp ?? 1) / Math.max(1, la.displayHpMax ?? 1);
        const rb = (lb.displayHp ?? 1) / Math.max(1, lb.displayHpMax ?? 1);
        return ra - rb; // plus blessé = plus haut
      });
    }

    const multiType = [pagePlayers, pageNpcs, pageEnemies].filter(g => g.length).length > 1;
    const mkGrp = (icon, label, items) => {
      if (!items.length) return '';
      const hdr = multiType ? `<div class="vtt-tray-sublabel">${icon} ${label}</div>` : '';
      return hdr + items.map(t => mkItem(t, true)).join('');
    };
    pageSec = mkGrp('🧑', 'Joueurs', pagePlayers)
            + mkGrp('👤', 'PNJ', pageNpcs)
            + mkGrp('👹', 'Ennemis', pageEnemies);
  }

  // ── Sur d'autres pages — chips avec "+" pour dupliquer ici ───────
  const filteredElsewhere = applyFilter(elsewhere);
  let elsewhereSec = '';
  if (filteredElsewhere.length) {
    const mkElsewhereChip = t => {
      const ld = _live(t);
      const typeIcon = t.type === 'player' ? '🧑' : '👤';
      const col = TYPE_COLOR[t.type] ?? '#888';
      const pageName = _pages[t.pageId]?.name || '?';
      return `<button class="vtt-res-chip vtt-res-chip--elsewhere" data-vtt-fn="_vttDuplicateOnPage" data-vtt-args="${t.id}"
          title="${_esc(ld.displayName ?? t.name)} — sur « ${_esc(pageName)} ». Clic = placer aussi ici (HP partagés).">
        <div class="vtt-res-chip-dot" style="border-color:${col};color:${col}">
          ${ld.displayImage
            ? `<img src="${ld.displayImage}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
            : `<span>${typeIcon}</span>`}
          <span class="vtt-res-chip-plus">+</span>
        </div>
        <span class="vtt-res-chip-name">${_esc(ld.displayName ?? t.name)}</span>
        <span class="vtt-res-chip-sub">${_esc(pageName)}</span>
      </button>`;
    };
    elsewhereSec = `<div class="vtt-tray-sect">
      <div class="vtt-tray-sect-hd">
        <span>🗂 Sur d'autres pages</span>
        <span class="vtt-tray-count">${filteredElsewhere.length}</span>
      </div>
      <div class="vtt-reserve-grid">${filteredElsewhere.map(mkElsewhereChip).join('')}</div>
    </div>`;
  }

  // ── Réserve — toujours dépliée, triée par utilité (online > offline > PNJ) ─
  // Objectif : 1 coup d'œil = je sais qui placer ; 1 clic = c'est placé.
  const filteredRes = applyFilter(reserve);
  let reserveSec = '';
  if (filteredRes.length) {
    const sortByName = arr => [...arr].sort((a, b) =>
      (_live(a).displayName ?? a.name ?? '').localeCompare(_live(b).displayName ?? b.name ?? '', 'fr', { sensitivity:'base' }));
    const searched = filteredRes.filter(t =>
      !_traySearch || _searchIncludes(_live(t).displayName ?? t.name ?? '', _traySearch));

    // Tri par utilité MJ : ceux qui jouent maintenant en haut.
    const presentPlayers = sortByName(searched.filter(t => t.type === 'player' && isOnline(t.ownerId)));
    const absentPlayers  = sortByName(searched.filter(t => t.type === 'player' && !isOnline(t.ownerId)));
    const npcs           = sortByName(searched.filter(t => t.type === 'npc'));

    // La recherche force l'ouverture des sous-sections — sinon le MJ tape
    // et ne voit aucun résultat parce que la section est repliée.
    const forceOpen = !!_traySearch;
    const mkBlock = (label, items, toggleFn = null, open = true) => {
      if (!items.length) return '';
      const collapsible = !!toggleFn;
      const isOpen = collapsible ? (open || forceOpen) : true;
      const caret = collapsible ? `<span class="vtt-tray-sub-caret">${isOpen ? '▾' : '▸'}</span>` : '';
      const attrs = collapsible ? `data-vtt-fn="${toggleFn}"` : '';
      const cls = `vtt-tray-sublabel${collapsible ? ' vtt-tray-sub-toggle' : ''}`;
      const body = isOpen ? items.map(mkResLine).join('') : '';
      return `<div class="${cls}" ${attrs}>${caret}${label} <span class="vtt-tray-sublabel-n">${items.length}</span></div>${body}`;
    };

    const clrBtn = _traySearch
      ? `<button class="vtt-tray-search-clr" data-vtt-fn="_vttTrayClearSearch" title="Effacer">✕</button>` : '';

    const scrollContent = searched.length
      ? mkBlock('🟢 En ligne',   presentPlayers, '_vttToggleOn',  _trayOnOpen)
        + mkBlock('🕓 Hors ligne', absentPlayers,  '_vttToggleOff', _trayOffOpen)
        + mkBlock('👤 PNJ',        npcs,           '_vttToggleNpc', _trayNpcOpen)
      : `<div class="vtt-tray-empty">Aucun résultat</div>`;

    reserveSec = `<div class="vtt-tray-sect">
      <div class="vtt-tray-sect-hd">
        <span>📦 Réserve</span>
        <span class="vtt-tray-count">${filteredRes.length}</span>
      </div>
      <div class="vtt-tray-search">
        <span class="vtt-tray-search-ic">🔍</span>
        <input type="text" class="vtt-tray-search-input" placeholder="Rechercher…"
          value="${_esc(_traySearch)}"
          data-vtt-fn="_vttTraySearch" data-vtt-on="input" data-vtt-args="$value">
        ${clrBtn}
      </div>
      <div class="vtt-res-scroll">${scrollContent}</div>
    </div>`;
  }

  // ── Bestiaire ─────────────────────────────────────────────────────
  const showBst = _trayFilter === 'all' || _trayFilter === 'enemy';
  const bsts = Object.values(_bestiary);
  const bstGrid = showBst
    ? (bsts.length
        ? bsts.map(b => {
            const img = b.photoURL || b.photo || b.avatar || b.imageUrl || '';
            const init = (b.nom || '?')[0].toUpperCase();
            return `<button class="vtt-bst-tile" data-vtt-fn="_vttPlaceFromBestiary" data-vtt-args="${b.id}"
                title="${_esc(b.nom || 'Créature')} · PV ${parseInt(b.pvMax) || '?'}">
              ${img ? `<img src="${img}" alt="${_esc(b.nom || '')}">` : `<span class="vtt-bst-icon">${init}</span>`}
              <div class="vtt-bst-name">${_esc((b.nom || 'Créature').slice(0, 8))}</div>
            </button>`;
          }).join('')
        : `<div class="vtt-tray-empty">Bestiaire vide</div>`)
    : '';

  el.innerHTML = `
    ${filterPills}
    <div class="vtt-tray-sect">
      <div class="vtt-tray-sect-hd">
        <span>🗺 Sur la page</span>
        <span class="vtt-tray-count">${filteredPage.length}${filteredPage.length !== onPage.length ? `/${onPage.length}` : ''}</span>
      </div>
      ${pageSec}
    </div>
    ${elsewhereSec}
    ${reserveSec}
    ${showBst ? `<div class="vtt-tray-sect">
      <div class="vtt-tray-sect-hd" style="justify-content:space-between">
        <span>👹 Bestiaire</span>
        <button class="vtt-tray-add-btn" data-vtt-fn="_vttCreateEnemy" title="Créer un ennemi">＋</button>
      </div>
      <div class="vtt-bst-grid">${bstGrid}</div>
    </div>` : ''}
  `;

  // Restaure le focus + caret de la recherche après le rerender.
  if (searchFocused) {
    const inp = el.querySelector('.vtt-tray-search-input');
    if (inp) {
      inp.focus();
      if (caretPos != null) {
        try { inp.setSelectionRange(caretPos, caretPos); } catch (_) {}
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// PAGES
// ═══════════════════════════════════════════════════════════════════
// ─ Liste verticale des pages dans le tray (MJ) ─────────────────────
function _renderPageList() {
  const el=document.getElementById('vtt-tray-pages'); if (!el) return;
  const broadcastId=_session.activePageId;
  const all=Object.values(_pages).sort((a,b)=>(a.order??0)-(b.order??0));

  // Préserve le focus/caret de la barre de recherche au rerender
  const ae = document.activeElement;
  const searchFocused = ae?.id === 'vtt-page-search' && el.contains(ae);
  const caretPos = searchFocused ? ae.selectionStart : null;

  if (!all.length) {
    el.innerHTML=`<div class="vtt-tray-empty">Aucune page<br><small>Clique ＋ pour créer</small></div>`;
    return;
  }

  const matches = p => _searchIncludes(p.name || '', _pageSearch);
  const q = String(_pageSearch || '').trim();

  // Regroupe par dossier ('' = sans dossier, affiché en dernier)
  const groups = new Map();
  for (const p of all) {
    if (!matches(p)) continue;
    const f = (p.folder||'').trim();
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(p);
  }
  // Ordre des dossiers : ordre MJ persisté (session.pageFolderOrder) puis alpha
  // pour les nouveaux ; '' (sans dossier) toujours en dernier.
  const fOrder = Array.isArray(_session.pageFolderOrder) ? _session.pageFolderOrder : [];
  const fIdx = f => { const i = fOrder.indexOf(f); return i < 0 ? 1e9 : i; };
  const folders = [...groups.keys()].sort((a,b)=>{
    if (a==='') return 1; if (b==='') return -1;          // sans dossier en dernier
    const d = fIdx(a) - fIdx(b); if (d) return d;
    return a.localeCompare(b,'fr',{sensitivity:'base'});
  });

  const _pageRow = p => {
    const isPlayers=p.id===broadcastId, isMj=p.id===_activePage?.id;
    const cls=isMj&&isPlayers?'mj-and-players':isMj?'mj':isPlayers?'players':'';
    return `<div class="vtt-page-item ${cls}" data-page-id="${p.id}" data-vtt-fn="_vttSwitchPage" data-vtt-args="${p.id}" title="${_esc(p.name)} · ${p.cols||24}×${p.rows||18} cases">
      <span class="vtt-page-item-grip" title="Glisser pour déplacer">⠿</span>
      <div class="vtt-page-item-badges">
        ${isMj     ?'<span title="Votre vue">📍</span>':''}
        ${isPlayers?'<span title="Joueurs ici">👥</span>':''}
      </div>
      <div class="vtt-page-item-name">${_esc(p.name)}</div>
      <div class="vtt-page-item-acts">
        <button class="vtt-page-item-btn" data-vtt-fn="_vttSendToPage" data-vtt-args="${p.id}" title="Envoyer tous les joueurs ici">📡</button>
        <button class="vtt-page-item-btn" data-vtt-fn="_vttEditPage" data-vtt-args="${p.id}" title="Renommer / dossier / taille">✏</button>
        <button class="vtt-page-item-btn vtt-page-item-del" data-vtt-fn="_vttDeletePage" data-vtt-args="${p.id}" title="Supprimer">×</button>
      </div>
    </div>`;
  };

  // Une seule "section" implicite (sans dossier) et pas de recherche → pas de header de groupe
  const onlyUngrouped = folders.length === 1 && folders[0] === '';
  let listHtml;
  if (!groups.size) {
    listHtml = `<div class="vtt-tray-empty">Aucune page ne correspond</div>`;
  } else if (onlyUngrouped) {
    listHtml = `<div class="vtt-page-folder-body" data-folder="">${groups.get('').map(_pageRow).join('')}</div>`;
  } else {
    listHtml = folders.map(f => {
      const rows = groups.get(f);
      const label = f || '— Sans dossier —';
      // En recherche, tout est déplié ; sinon respecte l'état persistant
      const closed = !q && _pageFoldClosed.has(f);
      return `<div class="vtt-page-folder${closed?' closed':''}" data-folder="${encodeURIComponent(f)}">
        <div class="vtt-page-folder-hd" data-vtt-fn="_vttPageFolderToggle" data-vtt-args="${encodeURIComponent(f)}">
          <span class="vtt-page-folder-grip" title="Glisser pour réordonner">⠿</span>
          <span class="vtt-page-folder-chev">▸</span>
          <span class="vtt-page-folder-name">${_esc(label)}</span>
          <span class="vtt-page-folder-count">${rows.length}</span>
        </div>
        <div class="vtt-page-folder-body" data-folder="${encodeURIComponent(f)}">${rows.map(_pageRow).join('')}</div>
      </div>`;
    }).join('');
  }

  el.innerHTML = `
    <div class="vtt-page-search-row">
      <input type="text" id="vtt-page-search" class="vtt-page-search" placeholder="🔍 Rechercher une page…"
        autocomplete="off" value="${_esc(_pageSearch)}"
        data-vtt-fn="_vttPageSearch" data-vtt-on="input" data-vtt-args="$value">
      ${_pageSearch?`<button class="vtt-page-search-x" data-vtt-fn="_vttPageSearchClear" title="Effacer">✕</button>`:''}
    </div>
    <div class="vtt-page-list">${listHtml}</div>`;

  if (searchFocused) {
    const inp = document.getElementById('vtt-page-search');
    if (inp) { inp.focus(); if (caretPos != null) { try { inp.setSelectionRange(caretPos, caretPos); } catch {} } }
  }
  // Drag & drop désactivé pendant une recherche (la liste filtrée n'est pas l'ordre réel)
  _initPageSortables(el, { pages: !q, folders: !q && !onlyUngrouped });
}

let _pageSortables = [];
function _destroyPageSortables() {
  _pageSortables.forEach(s => { try { s.destroy(); } catch {} });
  _pageSortables = [];
}
// Initialise le drag & drop : pages (entre dossiers) + dossiers (réordonner).
function _initPageSortables(el, { pages = true, folders = true } = {}) {
  _destroyPageSortables();
  // Pages : chaque corps de dossier est une zone de dépôt partagée
  if (pages) el.querySelectorAll('.vtt-page-folder-body').forEach(body => {
    _pageSortables.push(new Sortable(body, {
      group: 'vtt-pages', animation: 150, handle: '.vtt-page-item-grip',
      draggable: '.vtt-page-item', ghostClass: 'vtt-page-ghost', fallbackOnBody: true,
      onEnd: () => _onPageDrop(el),
    }));
  });
  // Dossiers : réordonner via la poignée de l'en-tête (hors recherche / mono-dossier)
  if (folders) {
    const list = el.querySelector('.vtt-page-list');
    if (list) _pageSortables.push(new Sortable(list, {
      group: 'vtt-folders', animation: 150, handle: '.vtt-page-folder-grip',
      draggable: '.vtt-page-folder', ghostClass: 'vtt-page-ghost',
      onEnd: () => _onFolderDrop(el),
    }));
  }
}

// Persiste folder + order de toutes les pages d'après l'ordre DOM après un drop.
async function _onPageDrop(el) {
  const batch = writeBatch(db);
  let order = 0, changed = 0;
  el.querySelectorAll('.vtt-page-folder-body').forEach(body => {
    const folder = decodeURIComponent(body.dataset.folder || '');
    body.querySelectorAll('.vtt-page-item').forEach(item => {
      const id = item.dataset.pageId; const p = _pages[id]; if (!p) { order++; return; }
      if ((p.folder||'') !== folder || (p.order??0) !== order) {
        batch.update(_pgRef(id), { folder, order });
        changed++;
      }
      order++;
    });
  });
  if (changed) await batch.commit().catch(() => showNotif('Erreur déplacement', 'error'));
}

// Persiste l'ordre des dossiers (session.pageFolderOrder) d'après l'ordre DOM.
async function _onFolderDrop(el) {
  const order = [...el.querySelectorAll('.vtt-page-folder')]
    .map(f => decodeURIComponent(f.dataset.folder || ''))
    .filter(f => f !== '');
  await setDoc(_sesRef(), { pageFolderOrder: order }, { merge: true }).catch(() => {});
}

function _vttPageSearch(v) { _pageSearch = String(v || ''); _renderPageList(); }
function _vttPageSearchClear() { _pageSearch = ''; _renderPageList(); }
function _vttPageFolderToggle(f) {
  // Dossier vide ('') : le dispatcher ne passe aucun arg (data-vtt-args="") → f undefined.
  const key = f ? decodeURIComponent(f) : '';
  if (_pageFoldClosed.has(key)) _pageFoldClosed.delete(key); else _pageFoldClosed.add(key);
  _savePageFolds();
  _renderPageList();
}

// ─ Indicateur de page courant pour les joueurs (lecture seule) ──────
function _renderPageTabs() {
  if (STATE.isAdmin) { _renderPageList(); return; } // MJ : liste dans le tray
  const el=document.getElementById('vtt-page-tabs'); if (!el) return;
  // Les joueurs ne naviguent pas — ils voient juste le nom de leur page courante
  const name = _activePage?.name ?? '…';
  const uid  = STATE.user?.uid;
  const myTok = uid ? Object.values(_tokens).find(e => e.data?.ownerId === uid)?.data : null;
  const canInvoke = !!(myTok && _activePage && myTok.pageId !== _activePage.id);
  const onActivePage = !!(myTok && _activePage && myTok.pageId === _activePage.id);
  const actionBtn = canInvoke
    ? `<button class="vtt-btn-sm" data-vtt-fn="_vttInvokeMyToken" title="Placer ton token sur cette carte">🧑 Invoquer mon token</button>`
    : onActivePage
    ? `<button class="vtt-btn-sm" data-vtt-fn="_vttRetireMyToken" title="Retirer ton token de la carte">📦 Ranger mon token</button>`
    : '';
  el.innerHTML = `<span class="vtt-page-current-label">📍 ${_esc(name)}</span>${actionBtn}`;
}

async function _switchPage(pageId) {
  const page=_pages[pageId]; if (!page) return;
  _activePage=page;
  // Ne pas détruire _layers.map entièrement : _imgTr (Transformer) y vit.
  // _renderMapImages() et _renderAllTokens() gèrent leur propre nettoyage.
  _layers.token?.destroyChildren(); _clearHL();
  _drawGrid(); _renderMapImages(); _renderAllTokens(); _renderAnnotLayer();
  fogRenderWalls(page, STATE.isAdmin);
  fogUpdateSoon(page, _tokens, STATE.isAdmin);
  _renderPageTabs(); _renderTray(); _deselect();
  _renderCombatTracker();
  _renderMjRulerRemote(_session?.mjRuler);
  // Le MJ navigue librement — les joueurs ne suivent que via 📡 Envoyer
}

function _renderAllTokens() {
  if (!_activePage) return;
  _layers.token?.destroyChildren();
  for (const e of Object.values(_tokens)) {
    const t=e.data;
    // destroyChildren() a détruit tous les shapes : on remet la référence à null
    // pour les tokens non rendus ici (autre page / réserve / invisibles).
    if (t.pageId!==_activePage.id || (!t.visible&&!STATE.isAdmin)) {
      if (e.shape) _tokens[t.id]={...e,shape:null};
      continue;
    }
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
// Comptage Manhattan (|dc|+|dr|) : cohérent avec _moveTo / _showMoveRange.
// Les extrémités sont snappées au centre de la case sous le curseur.
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

let _rulerNodes = null;     // nodes locaux (MJ ou joueur, pour l'utilisateur courant)
let _rulerLastCell = null;  // dernière case survolée — court-circuite si inchangée
let _rulerHoverDot = null;  // aperçu de la case de départ avant le 1er clic

function _showRulerHover(wp) {
  if (!_layers.ping || _rulerNodes) { _hideRulerHover(); return; } // pas d'aperçu si une règle est déjà visible
  const o = _snapToCellCenter(wp);
  if (!_rulerHoverDot) {
    const K = window.Konva;
    _rulerHoverDot = new K.Circle({
      radius: 5, fill: RULER_COLOR, opacity: 0.45,
      stroke: '#000', strokeWidth: 1, listening: false, name: 'ruler-hover',
    });
    _layers.ping.add(_rulerHoverDot);
  }
  _rulerHoverDot.position({ x: o.x, y: o.y });
  _layers.ping.batchDraw();
}
function _hideRulerHover() {
  if (!_rulerHoverDot) return;
  _rulerHoverDot.destroy();
  _rulerHoverDot = null;
  _layers.ping?.batchDraw();
}

function _startRuler(wp) {
  const K = window.Konva;
  _clearRuler();
  _hideRulerHover();
  const o = _snapToCellCenter(wp);
  _rulerActive = true;
  _rulerOrigin = o;
  _rulerLastCell = { c: o.c, r: o.r };
  _rulerNodes = _buildRulerNodes(K, 'ruler');
  _setRulerNodes(_rulerNodes, o.x, o.y, o.x, o.y, _fmtRulerCells(0));
  _layers.ping.add(_rulerNodes.group);
  _layers.ping.batchDraw();
  _broadcastMjRuler(o.x, o.y, 0);
}
function _updateRuler(wp) {
  if (!_rulerNodes || !_rulerOrigin) return;
  const e = _snapToCellCenter(wp);
  // Court-circuit : pas de redraw ni de broadcast si la case n'a pas changé.
  if (_rulerLastCell && e.c === _rulerLastCell.c && e.r === _rulerLastCell.r) return;
  _rulerLastCell = { c: e.c, r: e.r };
  const cells = Math.abs(e.c - _rulerOrigin.c) + Math.abs(e.r - _rulerOrigin.r);
  _setRulerNodes(_rulerNodes, _rulerOrigin.x, _rulerOrigin.y, e.x, e.y, _fmtRulerCells(cells));
  _layers.ping.batchDraw();
  _broadcastMjRuler(e.x, e.y, cells);
}
function _endRuler() {
  _rulerActive = false;
  if (_rulerHideTimer) clearTimeout(_rulerHideTimer);
  _rulerHideTimer = setTimeout(_clearRuler, 5000);
}
function _clearRuler() {
  if (_rulerHideTimer) { clearTimeout(_rulerHideTimer); _rulerHideTimer = null; }
  _rulerNodes?.group.destroy();
  _rulerNodes = null;
  _rulerActive = false; _rulerOrigin = null; _rulerLastCell = null;
  _layers.ping?.batchDraw();
  _clearMjRulerBroadcast();
}

// Diffusion de la règle du MJ (visible par tous les joueurs via _session.mjRuler).
// Throttle pour lisser les écritures Firestore.
const MJ_RULER_THROTTLE = 120;
let _mjRulerLastWrite = 0;
let _mjRulerPendingTimer = null;
let _mjRulerBroadcasting = false; // évite un setDoc(null) inutile si jamais diffusé
function _broadcastMjRuler(x2, y2, cells) {
  if (!STATE.isAdmin || !_activePage || !_rulerOrigin) return;
  const payload = {
    pageId: _activePage.id,
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
function _renderMjRulerRemote(data) {
  if (STATE.isAdmin) return; // le MJ voit déjà sa règle locale
  if (!_layers.ping) return;
  const visible = data && _activePage && data.pageId === _activePage.id;
  if (!visible) {
    if (_mjRulerRemote) {
      _mjRulerRemote.group.destroy();
      _mjRulerRemote = null;
      _layers.ping.batchDraw();
    }
    return;
  }
  if (!_mjRulerRemote) {
    _mjRulerRemote = _buildRulerNodes(window.Konva, 'mj-ruler', 0.85);
    _layers.ping.add(_mjRulerRemote.group);
  }
  const cells = data.cells ?? 0;
  _setRulerNodes(_mjRulerRemote, data.x1, data.y1, data.x2, data.y2,
    `MJ : ${_fmtRulerCells(cells)}`);
  _layers.ping.batchDraw();
}

// ── Annotations ────────────────────────────────────────────────────
function _buildAnnotShape(K, data) {
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
        // Marquer skip rebuild pour éviter le saut visuel au retour onSnapshot
        _skipAnnotRebuild.add(id);
        const update = (ann.type === 'freehand' || ann.type === 'line')
          ? { offsetX: s.x(), offsetY: s.y() }
          : { x: s.x(), y: s.y() };
        if (ann.type !== 'freehand' && ann.type !== 'line') {
          ann.x = s.x(); ann.y = s.y();
        }
        updateDoc(_annotRef(id), update).catch(() => {});
      }
      _annotGroupDragOrigins = null;
    });
    // Fin de transformation (rotate/resize) → sauvegarder
    shape.on('transformend', () => {
      // Marquer cet id pour éviter le destroy/rebuild local dans onSnapshot
      _skipAnnotRebuild.add(data.id);

      if (data.centered) {
        // Normaliser scale dans les dimensions pour que le rebuild distant soit correct
        const newW = Math.max(1, shape.width()  * shape.scaleX());
        const newH = Math.max(1, shape.height() * shape.scaleY());
        shape.width(newW); shape.height(newH);
        shape.scaleX(1);   shape.scaleY(1);
        shape.offsetX(newW / 2); shape.offsetY(newH / 2);
        // Mettre à jour data en place (la closure reste valide)
        data.w = newW; data.h = newH; data.scaleX = 1; data.scaleY = 1;
      }
      data.rotation = shape.rotation();
      data.x = shape.x();
      data.y = shape.y();

      const patch = {
        rotation: shape.rotation(),
        scaleX: shape.scaleX(), scaleY: shape.scaleY(),
        x: shape.x(), y: shape.y(),
        ...(data.centered ? { centered: true, w: data.w, h: data.h } : {}),
      };
      updateDoc(_annotRef(data.id), patch).catch(() => {});
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
    const { x: cx, y: cy } = _tokenCenter(t);
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
  const inErase  = _tool === 'draw' && _drawShape === 'eraser';
  const uid = STATE.user?.uid;
  Object.values(_annotations).forEach(e => {
    if (!e.shape) return;
    const canEdit = STATE.isAdmin || e.data.createdBy === uid;
    const active  = inSelect && canEdit;
    e.shape.draggable(active);
    // Écoute en sélection (clic/drag) ET en gomme (hit-test), sinon non listening.
    e.shape.listening((inSelect || inErase) && canEdit);
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
    // Amincissement : on n'ajoute un point que s'il s'éloigne assez du précédent.
    // → trait plus lisse (moins de zigzags du tremblement de souris) et bien moins
    //   de données stockées. Le lissage Konva (tension) fait le reste.
    const lx = _drawPts[_drawPts.length - 2], ly = _drawPts[_drawPts.length - 1];
    const minDist = Math.max(2.5, _drawWidth * 0.8);
    if (Math.hypot(wp.x - lx, wp.y - ly) < minDist) return;
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
    const rw = _drawLive.width(), rh = _drawLive.height();
    // x, y = centre du rect — l'ancrage est le centre pour que la rotation pivote sur place
    data = { type:'rect', x: _drawLive.x() + rw/2, y: _drawLive.y() + rh/2, w: rw, h: rh, fill:_drawFill, centered:true };
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
    _drawHistory.push(id); // permet Ctrl+Z
    liveCopy.destroy(); // l'onSnapshot va recréer la version persistée
  } catch(err) {
    console.error('[VTT] Annotation save error:', err?.code, err?.message);
    showNotif('Erreur sauvegarde annotation — vérifiez les règles Firestore', 'error');
    // Garder liveCopy visible temporairement (non persistée)
  }
  _layers.draw.batchDraw();
}

// ── Bestiaire VTT : catalogue MJ, lecture ciblée joueurs ─────────────────────
function _patchBestiaryTokenShapes(changedIds) {
  if (!changedIds?.size) return;
  for (const [id, e] of Object.entries(_tokens)) {
    if (e.data?.beastId && changedIds.has(e.data.beastId)) {
      _patchShape(id);
      if (_selected === id) _renderInspectorSoon();
    }
  }
  _renderCombatTrackerSoon();
}

function _applyBestiaryCatalog(list) {
  const before = new Set(Object.keys(_bestiary));
  const next = {};
  for (const b of list || []) {
    if (!b?.id) continue;
    next[b.id] = b;
  }
  _bestiary = next;
  const changed = new Set([...before, ...Object.keys(next)]);
  _patchBestiaryTokenShapes(changed);
  _renderTraySoon();
}

async function _loadBestiaryCatalog() {
  try {
    _applyBestiaryCatalog(await loadCollection('bestiary'));
  } catch (e) {
    console.warn('[vtt] bestiaire catalogue:', e?.code || e);
    _applyBestiaryCatalog([]);
  }
}

function _ensureBestiaryDoc(beastId) {
  if (!beastId) return Promise.resolve(null);
  if (_bestiary[beastId]) return Promise.resolve(_bestiary[beastId]);
  if (_bestiaryLoads.has(beastId)) return _bestiaryLoads.get(beastId);
  const promise = getDocDataSilent('bestiary', beastId)
    .then(data => {
      if (!data) return null;
      const docData = { ...data, id: data.id || beastId };
      _bestiary[beastId] = docData;
      _patchBestiaryTokenShapes(new Set([beastId]));
      return docData;
    })
    .catch(e => {
      console.debug('[vtt] bestiaire doc:', beastId, e?.code || e);
      return null;
    })
    .finally(() => _bestiaryLoads.delete(beastId));
  _bestiaryLoads.set(beastId, promise);
  return promise;
}

function _ensureBestiaryForTokens() {
  if (STATE.isAdmin) return;
  const ids = new Set();
  for (const { data } of Object.values(_tokens)) {
    if (data?.beastId) ids.add(data.beastId);
  }
  ids.forEach(id => { void _ensureBestiaryDoc(id); });
}

// SYNC FIRESTORE — listeners temps réel
// ═══════════════════════════════════════════════════════════════════
function _initListeners() {
  if (!_aid()) return;

  // 1. Session
  _unsubs.push(onSnapshot(_sesRef(), snap => {
    _session=snap.exists()?snap.data():{};
    _renderSessionBtn();
    _renderPageTabs();
    if (!STATE.isAdmin) {
      const uid=STATE.user?.uid;
      const target=_session.playerPages?.[uid]??_session.activePageId;
      if (target&&_pages[target]&&_activePage?.id!==target) _switchPage(target);
    }
    _renderTimer();
    _renderCombatTracker();
    _renderMjRulerRemote(_session.mjRuler);
    _renderShortRest();
    _checkShortRestAutoApply();
  },()=>{}));

  // 2. Pages
  _unsubs.push(onSnapshot(_pgsCol(), snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type==='removed') delete _pages[ch.doc.id];
      else {
        _pages[ch.doc.id]={id:ch.doc.id,...ch.doc.data()};
        if (_activePage?.id===ch.doc.id) {
          _activePage=_pages[ch.doc.id];
          _renderMapImages();
          fogRenderWalls(_activePage, STATE.isAdmin);
          fogUpdateSoon(_activePage, _tokens, STATE.isAdmin);
        }
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
  _unsubs.push(subscribeCollection("characters", data => {
    const prev = _characters;
    const next = {};
    for (const c of data || []) next[c.id] = c;
    const wasReady = _charsReady;

    const changed = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const id of Object.keys(prev)) {
      if (next[id]) continue;
      const tok = Object.values(_tokens).find(e => e.data.characterId === id);
      if (tok) deleteDoc(_tokRef(tok.data.id)).catch(() => {});
    }

    _characters = next;
    for (const [id, e] of Object.entries(_tokens)) {
      if (e.data.characterId && changed.has(e.data.characterId)) {
        _patchShape(id); if (_selected === id) _renderInspectorSoon();
      }
    }
    _renderTraySoon();
    _charsReady = true; _maybeSyncAutoTokens();
    // Signale immédiatement au destinataire les objets reçus pendant qu’il est
    // sur le VTT. Le premier snapshot est ignoré pour ne pas annoncer tout
    // l’inventaire existant à l’ouverture de la table.
    if (wasReady) {
      for (const c of Object.values(next)) {
        if (c.uid !== STATE.user?.uid) continue;
        const previousInv = prev[c.id]?.inventaire || [];
        const currentInv = c.inventaire || [];
        if (currentInv.length <= previousInv.length) continue;
        const labels = currentInv.slice(previousInv.length).map(item => item?.nom || "Objet").join(", ");
        showNotif("📦 Inventaire de " + (c.nom || "votre personnage") + " mis à jour : " + labels, "success");
      }
    }
    // Ne re-rend la mini-fiche que si le perso AFFICHÉ a changé : évite d'écraser
    // une saisie en cours (note, XP) quand un autre personnage est mis à jour.
    if (_miniUid && _miniCharId &&
        JSON.stringify(prev[_miniCharId]) !== JSON.stringify(next[_miniCharId])) {
      _renderMiniSheet(_miniUid);
    }
  }));

  // 4. PNJ — source de vérité des HP PNJ
  _unsubs.push(subscribeCollection("npcs", data => {
    const prev = _npcs;
    const next = {};
    for (const n of data || []) next[n.id] = n;

    const changed = new Set([...Object.keys(prev), ...Object.keys(next)]);
    _npcs = next;
    for (const [id, e] of Object.entries(_tokens)) {
      if (e.data.npcId && changed.has(e.data.npcId)) {
        _patchShape(id); if (_selected === id) _renderInspectorSoon();
      }
    }
    _renderTraySoon();
    _npcsReady = true; _maybeSyncAutoTokens();
  }));

  // 5. Bestiaire
  // MJ : catalogue complet pour le tray, mais sans listener permanent.
  // Joueurs : chargement doc par doc des créatures réellement présentes en tokens.
  if (STATE.isAdmin) void _loadBestiaryCatalog();

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
          if (td?.type === 'enemy') _renderInspectorSoon();
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
        if (_selected===id) { _renderInspectorSoon(); _refreshRanges(id); }
      } else {
        _tokens[id]={data,shape:null};
        if (_activePage&&data.pageId===_activePage.id&&(data.visible||STATE.isAdmin)) {
          const shape=_buildShape(data);
          _tokens[id].shape=shape;
          _layers.token?.add(shape); _layers.token?.batchDraw();
        }
      }
    });
    _renderTraySoon();
    _renderCombatTrackerSoon();
    void _cleanupReserveDuplicates();
    _toksReady=true; _maybeSyncAutoTokens();
    _ensureBestiaryForTokens();
    // Joueur : le bouton « Invoquer mon token » dépend de l'état de SON token
    // (créé / assigné / déplacé par le MJ). Sans ce refresh, le bouton n'apparaît
    // pas tant qu'un autre événement (changement de page) ne relance pas le rendu.
    if (!STATE.isAdmin) {
      const _myUid = STATE.user?.uid;
      if (snap.docChanges().some(ch => ch.doc.data()?.ownerId === _myUid)) _renderPageTabs();
    }
    // Recalcul fog si un token joueur a bougé
    if (snap.docChanges().some(ch => ch.doc.data()?.type === 'player'))
      fogUpdateSoon(_activePage, _tokens, STATE.isAdmin);
    // Si la composition des joueurs présents change, le panneau "Court repos" doit suivre
    if (snap.docChanges().some(ch => ch.doc.data()?.type === 'player')) {
      _renderShortRest(); _checkShortRestAutoApply();
    }
  },()=>{}));

  // 7. Annotations (dessins + formes)
  _unsubs.push(onSnapshot(_annotCol(), snap => {
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        // Retirer du transformer avant destroy
        if (_selectedAnnotIds.has(id)) {
          _selectedAnnotIds.delete(id);
          _annotTransformer?.nodes([]);
        }
        _annotations[id]?.shape?.destroy();
        delete _annotations[id];
        if (_selectedAnnotId === id) { _selectedAnnotId = null; }
      } else {
        const newData = { id, ...ch.doc.data() };
        if (_skipAnnotRebuild.has(id)) {
          // Transform local : le shape visuel est déjà correct — juste mettre à jour les données
          _skipAnnotRebuild.delete(id);
          if (_annotations[id]) Object.assign(_annotations[id].data, newData);
        } else {
          if (_annotations[id]) {
            // Vider le transformer avant de détruire l'ancien shape
            if (_selectedAnnotIds.has(id)) _annotTransformer?.nodes([]);
            _annotations[id].shape?.destroy();
          }
          _annotations[id] = { data: newData, shape: null };
          // Rendre sur la page active seulement
          if (_activePage && newData.pageId === _activePage.id) {
            const K = window.Konva;
            const shape = _buildAnnotShape(K, newData);
            if (shape) { _annotations[id].shape = shape; _layers.draw?.add(shape); }
          }
        }
      }
    });
    _updateAnnotDraggable();
    // Réappliquer le transformer sur les shapes reconstruits
    if (_selectedAnnotIds.size > 0) _applyAnnotTransformer();
    _layers.draw?.batchDraw();
  }, () => {}));

  // 8. Ciblage multi-sorts temps réel (lignes pointillées broadcast)
  _unsubs.push(onSnapshot(_castingCol(), snap => {
    _renderRemoteCastings(snap.docs);
  }, () => {}));

  // 9. Pings + présence temps réel
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
    // Le tray range les joueurs par statut online → faut re-render quand la
    // présence change, sinon la section "En ligne" reste vide à l'arrivée
    // jusqu'au prochain clic.
    if (STATE.isAdmin) _renderTraySoon();

    // Pings visuels (< 5 s)
    const pings = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.pageId === _activePage?.id && p.createdAt && (now - p.createdAt.toMillis()) < 5000);
    _renderPings(pings);
  }, () => {})); // silencieux si pas de règle Firestore

  // 10. Réactions émotes temps réel
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

  // 11. Chat / Log de dés — limité côté serveur aux 80 derniers messages.
  // Évite de relire l'historique complet du chat à chaque ouverture de page
  // (économie majeure sur des sessions longues : passe d'une lecture par
  // message historique à une lecture par message récent).
  _unsubs.push(onSnapshot(
    query(_logCol(), orderBy('createdAt', 'desc'), limit(80)),
    snap => {
      const msgs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
      _renderChatLog(msgs);
    },
    e => {
      console.error('[vtt] chat listener:', e);
      const el = document.getElementById('vtt-chat-log');
      if (el) el.innerHTML = `<div class="vtt-log-entry vtt-log-roll" style="color:#ef4444">⚠ Accès refusé — ajouter <code>vttLog</code> aux règles Firestore</div>`;
    }
  ));

  // Bibliothèque de cartes (MJ only)
  if (STATE.isAdmin) {
    _mapLibUnsub = onSnapshot(_mapLibRef(), snap => {
      _mapLib = snap.exists() ? snap.data() : {};
      if (!Array.isArray(_mapLib.folders)) _mapLib.folders = [];
      if (!Array.isArray(_mapLib.images))  _mapLib.images  = [];
      _renderLibSection();
    }, () => {});
  }

  // Butin d'aventure : listener lazy, démarré seulement à l'ouverture du panneau
  // ou quand le MJ ajoute du butin depuis une créature.

  // 12. Sons/playlists VTT : listeners lazy, démarrés seulement par le panneau MJ
  // ou par une lecture musicale qui a besoin de résoudre l'URL du son courant.

  // 13. État musique — sync pour tous les clients
  _unsubs.push(onSnapshot(_musicStateRef(), snap => {
    _syncMusicPlayback(snap.exists() ? snap.data() : {});
  }, ()=>{}));
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
  el.style.cssText=`left:${x}px;top:${y}px;visibility:hidden`;
  document.body.appendChild(el);
  const r=el.getBoundingClientRect(), vw=window.innerWidth, vh=window.innerHeight;
  const left = r.right  > vw ? Math.max(0, x - r.width)  : x;
  const top  = r.bottom > vh ? Math.max(0, y - r.height) : y;
  el.style.cssText=`left:${left}px;top:${top}px;`;
  _ctxClose=e=>{ if (!el.contains(e.target)) _hideCtxMenu(); };
  requestAnimationFrame(()=>document.addEventListener('mousedown',_ctxClose));
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
function _vttToggleMapMode() { return _setMapMode(!_mapMode); }

// ═══════════════════════════════════════════════════════════════════
// CHAT & LOG DE DÉS
// ═══════════════════════════════════════════════════════════════════
// ── Émotes ──────────────────────────────────────────────────────────
async function _loadEmotes() {
  // 1. Tenter le path scopé à l'aventure (path normal)
  try {
    const data = await getDocData('world', 'vtt_emotes');
    if (Array.isArray(data?.emotes)) { _emotes = data.emotes; return; }
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

// Initialiser immédiatement : localStorage (ordre perso) > défauts
_diceSkills = lsJson.get(DICE_SKILLS_STORAGE_KEY, [...DICE_SKILLS_DEFAULT]);

async function _loadDiceSkills() {
  try {
    const data = await getDocData('world', 'dice_skills');
    if (data?.skills?.length) _diceSkills = data.skills;
  } catch { /* garde le cache local */ }
  // Re-render l'inspector si un token est déjà sélectionné
  if (_selected) _renderInspector(_tokens[_selected]?.data ?? null);
}

function _vttSetRollMode(mode) {
  _rollMode = mode;
  // Mettre à jour les boutons visuellement sans re-render complet
  document.querySelectorAll('.vtt-roll-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
}

function _vttAdjBonus(delta, reset = false) {
  _rollBonus = reset ? 0 : Math.max(-20, Math.min(20, _rollBonus + delta));
  const el = document.getElementById('vtt-bonus-val');
  if (el) {
    el.textContent = _rollBonus > 0 ? `+${_rollBonus}` : `${_rollBonus}`;
    el.classList.toggle('nonzero', _rollBonus !== 0);
  }
}

function _vttToggleRollHidden() {
  if (!STATE.isAdmin) return;
  _rollHidden = !_rollHidden;
  lsJson.set('vtt-roll-hidden', _rollHidden);
  const btn = document.getElementById('vtt-roll-hide-btn');
  if (btn) {
    btn.classList.toggle('active', _rollHidden);
    btn.textContent = _rollHidden ? '🕶 Jet caché MJ' : '👁 Visible joueurs';
  }
}

async function _vttRollSkill(skillName, stat) {
  const t = _tokens[_selected]?.data;
  if (!t) return;
  if (!_canControlToken(t)) return; // joueur ne peut lancer que son propre token (ou ceux délégués)
  const c = t?.characterId ? _characters[t.characterId] : null;
  const n = t?.npcId ? _npcs[t.npcId] : null;
  const statKey = _STAT_KEY[stat] || '';
  const mod = _tokenStatMod(t, statKey);
  // Bonus de compétence depuis les items équipés (pour les PJ)
  const equipSkillBonus = c ? computeEquipSkillBonus(c.equipement || {}, skillName) : 0;
  const d20 = () => Math.floor(Math.random() * 20) + 1;

  let d1 = d20(), d2, roll;
  if (_rollMode === 'advantage')    { d2 = d20(); roll = Math.max(d1, d2); }
  else if (_rollMode === 'disadvantage') { d2 = d20(); roll = Math.min(d1, d2); }
  else                              { roll = d1; }

  const total   = roll + mod + _rollBonus + equipSkillBonus;
  const isCrit  = roll === 20, isFumble = roll === 1;
  const authorName    = STATE.profile?.pseudo || STATE.profile?.prenom || 'Joueur';
  const characterName = c?.nom || n?.nom || t?.name || null;
  const characterImage = c?.photoURL || c?.photo || c?.avatar || n?.photoURL || n?.photo || n?.avatar || n?.imageUrl || null;
  const gmOnly = STATE.isAdmin && _rollHidden;
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
      rollEquipBonus: equipSkillBonus || 0,
      isCrit, isFumble,
      gmOnly,
      createdAt: serverTimestamp(),
    });
    if (gmOnly) showNotif('Jet caché — visible uniquement par le MJ', 'success');
  } catch(e) { showNotif('Erreur jet : ' + e.message, 'error'); }
}

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
const _getFavs = () => lsJson.get('vtt-emote-favs', []);
const _setFavs = v => lsJson.set('vtt-emote-favs', v);
const _getRecents = () => lsJson.get('vtt-emote-recents', []);
function _pushRecent(name) {
  const r = _getRecents().filter(n => n !== name);
  r.unshift(name);
  lsJson.set('vtt-emote-recents', r.slice(0, 8));
}

function _emoteGridHtml(list, favSet=new Set()) {
  if (!list.length) return '<div class="vtt-emote-empty-grid">Aucune émote trouvée</div>';
  return list.map(em => {
    const safe = em.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const isFav = favSet.has(em.name);
    return `<div class="vtt-emote-item-wrap">
      <button class="vtt-emote-item" data-vtt-fn="_vttPickEmote" data-vtt-args="${safe}" title=":${_esc(em.name)}:">
        <img src="${em.url}" alt="${_esc(em.name)}" loading="lazy">
        <span>${_esc(em.name)}</span>
      </button>
      <button class="vtt-emote-fav-btn${isFav?' active':''}" data-vtt-fn="_vttToggleFav" data-vtt-args="${safe}" title="${isFav?'Retirer des favoris':'Ajouter aux favoris'}">${isFav?'★':'☆'}</button>
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
  const byName = new Map(_emotes.map(e => [e.name, e]));
  const recentEmotes = _getRecents().map(n => byName.get(n)).filter(Boolean);
  const favEmotes = _emotes.filter(e => favSet.has(e.name));

  const recentBlock = recentEmotes.length
    ? `<div id="vtt-emote-recent-section">
        <div class="vtt-emote-section-lbl">🕘 Récents</div>
        <div class="vtt-emote-grid">${_emoteGridHtml(recentEmotes, favSet)}</div>
      </div>`
    : `<div id="vtt-emote-recent-section" data-empty="1" style="display:none"></div>`;
  const favBlock = favEmotes.length
    ? `<div id="vtt-emote-fav-section">
        <div class="vtt-emote-section-lbl gold">⭐ Favoris</div>
        <div class="vtt-emote-grid" id="vtt-emote-fav-grid">${_emoteGridHtml(favEmotes, favSet)}</div>
      </div>`
    : `<div id="vtt-emote-fav-section" data-empty="1" style="display:none"></div>`;
  const allLbl = (recentEmotes.length || favEmotes.length)
    ? `<div class="vtt-emote-section-lbl" id="vtt-emote-all-lbl">Toutes</div>` : '';
  el.innerHTML = `
    <div class="vtt-emote-picker-search">
      <input type="text" id="vtt-emote-search" placeholder="🔍 Rechercher…" autocomplete="off"
        data-vtt-fn="_vttFilterEmotes" data-vtt-on="input" data-vtt-args="$value">
    </div>
    <div class="vtt-emote-picker-body">
      ${recentBlock}
      ${favBlock}
      ${allLbl}
      <div class="vtt-emote-grid" id="vtt-emote-grid">${_emoteGridHtml(_emotes, favSet)}</div>
    </div>`;
  setTimeout(() => document.getElementById('vtt-emote-search')?.focus(), 40);
}

function _vttFilterEmotes(q) {
  const favSet = new Set(_getFavs());
  const grid = document.getElementById('vtt-emote-grid'); if (!grid) return;
  const filtered = q.trim() ? _emotes.filter(e => _searchIncludes(e.name, q)) : _emotes;
  grid.innerHTML = _emoteGridHtml(filtered, favSet);
  const hide = !!q.trim();
  const recentSection = document.getElementById('vtt-emote-recent-section');
  const favSection = document.getElementById('vtt-emote-fav-section');
  const allLbl = document.getElementById('vtt-emote-all-lbl');
  if (recentSection && recentSection.dataset.empty !== '1') recentSection.style.display = hide ? 'none' : '';
  if (favSection && favSection.dataset.empty !== '1') favSection.style.display = hide ? 'none' : '';
  if (allLbl) allLbl.style.display = hide ? 'none' : '';
}

function _vttToggleFav(name) {
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
}

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

function _vttToggleEmotePicker() {
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
}

async function _vttPickEmote(name) {
  const uid = STATE.user?.uid; if (!uid) return;
  const em = _emotes.find(e => e.name === name); if (!em) return;
  // Le picker reste ouvert — l'utilisateur ferme manuellement

  _pushRecent(name);

  // Token émetteur : sélection courante, sinon le token possédé par le joueur
  let tokenId = _selected;
  if (!tokenId) {
    const own = Object.values(_tokens).find(e => e.data.ownerId === uid);
    tokenId = own?.data?.id ?? null;
  }

  // Clé partagée locale + Firestore : même timestamp → _renderedReactions évite le double affichage
  const ts = Date.now();
  const key = `${uid}_${ts}`;

  // Affichage local immédiat (ancré au token émetteur si présent)
  _showEmoteBubble(tokenId, em.url, name, key);

  // Propagation aux autres joueurs via Firestore
  setDoc(_reactionRef(uid), {
    tokenId, emoteName: name, emoteUrl: em.url,
    pageId: _activePage?.id ?? null,
    createdAt: ts,           // nombre (ms) — même valeur que la clé locale
  }).catch(err => {
    console.error('[vtt] émote temps réel — écriture refusée. Vérifier vttEmoteReactions dans Firestore.', err);
  });
}

async function _ouvrirGestionEmotes() {
  await _loadEmotes();
  const { default: Sortable } = await import('../vendor/sortable.esm.js');

  // ── Helper upload Cloudinary (avec sous-dossier optionnel pour grouper) ──
  const _getEmoteAlbum = () => localStorage.getItem('vtt-emote-folder') || localStorage.getItem('vtt-imgbb-emote-album') || '';
  const _setEmoteAlbum = v => v ? localStorage.setItem('vtt-emote-folder', v) : localStorage.removeItem('vtt-emote-folder');

  const _uploadEmote = async (file) => {
    if (!hasCloudinaryConfig()) {
      openCloudinaryConfigModal();
      if (!hasCloudinaryConfig()) throw new Error('Configuration Cloudinary requise (bouton 🔑)');
    }
    const sub = _getEmoteAlbum().trim();
    const folder = sub ? `emotes/${sub}` : 'emotes';
    const up = await uploadCloudinary(file, { folder, tags: ['emote'] });
    return up.url;
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
              <button class="vtt-ec-btn vtt-ec-edit" data-vtt-fn="_vttEditEmote" data-vtt-args="${i}" title="Modifier">✏</button>
              <button class="vtt-ec-btn vtt-ec-del"  data-vtt-fn="_vttDeleteEmote" data-vtt-args="${i}" title="Supprimer">✕</button>
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
        <label style="font-size:.75rem;color:var(--text-muted);white-space:nowrap">📁 Dossier</label>
        <input type="text" id="emote-album-id" placeholder="nom du sous-dossier Cloudinary (optionnel)" value="${_getEmoteAlbum()}" style="${_inpStyle};flex:1"
          data-vtt-fn="_vttSetEmoteAlbum" data-vtt-on="input" data-vtt-args="$value">
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
        <label style="font-size:.75rem;color:var(--text-muted)">URL directe <span style="opacity:.6">(si déjà hébergée ailleurs)</span></label>
        <input type="text" id="emote-add-url" placeholder="https://…" style="${_inpStyle}">
      </div>
      <div style="display:flex;align-items:center;gap:.7rem">
        <button class="btn btn-primary" style="flex:1" data-vtt-fn="_vttAddEmote">➕ Ajouter l'émote</button>
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
  VTT_ACTIONS._vttDeleteEmote = async (i) => {
    if (!await confirmModal(`Supprimer :${_emotes[i]?.name}: ?`)) return;
    const list = [..._emotes]; list.splice(i, 1);
    await _saveEmotes(list); _refresh();
    showNotif('Émote supprimée', 'success');
  };

  // ── Ouvrir le panneau d'édition (horizontal, sous la grille) ─────
  VTT_ACTIONS._vttEditEmote = (i) => {
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
              data-vtt-fn="_vttSaveEmote" data-vtt-on="keydown-enter" data-vtt-args="${i}">
          </div>
          <div class="vtt-ec-panel-row">
            <label>Nouvelle image <span style="opacity:.6">(optionnel)</span></label>
            <input type="file" id="ec-file-${i}" accept="image/*"
              data-vtt-fn="_vttPreviewEmoteFile" data-vtt-on="change" data-vtt-args="$this|ec-preview-${i}">
          </div>
          <div class="vtt-ec-panel-btns">
            <button class="vtt-ec-save"   data-vtt-fn="_vttSaveEmote" data-vtt-args="${i}">✓ Enregistrer</button>
            <button class="vtt-ec-cancel" data-vtt-fn="_vttCancelEmoteEdit">✕ Annuler</button>
          </div>
        </div>
      </div>`;
    document.getElementById(`ec-name-${i}`)?.focus();
  };

  // ── Sauvegarder l'édition ────────────────────────────────────────
  VTT_ACTIONS._vttSaveEmote = window._vttSaveEmote = async (i) => {
    const nameEl = document.getElementById(`ec-name-${i}`);
    const fileEl = document.getElementById(`ec-file-${i}`);
    const newName = nameEl?.value.trim().replace(/\s+/g, '_').toLowerCase();
    if (!newName) { showNotif('Nom requis', 'error'); return; }
    const list = [..._emotes];
    const em = { ...list[i], name: newName };
    if (fileEl?.files?.[0]) {
      showNotif('Upload en cours…', 'info');
      try { em.url = await _uploadEmote(fileEl.files[0]); }
      catch(e) { showNotif('⚠ ' + e.message, 'error'); return; }
    }
    list[i] = em;
    await _saveEmotes(list); _refresh();
    showNotif(`✓ :${newName}: mis à jour`, 'success');
  };

  // ── Ajouter ──────────────────────────────────────────────────────
  VTT_ACTIONS._vttAddEmote = async () => {
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
      try { url = await _uploadEmote(file); }
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
}

function _renderChatLog(msgs) {
  const el = document.getElementById('vtt-chat-log'); if (!el) return;
  const myUid = STATE.user?.uid;
  if (!STATE.isAdmin) msgs = msgs.filter(m => !m.gmOnly);
  _chatMsgs = msgs;   // pour le lookup "Répondre"

  // ═══════════════════════════════════════════════════════════════════
  // HELPERS — composants réutilisables pour tous les types de log
  // ═══════════════════════════════════════════════════════════════════
  const sn  = n => n>0?`+${n}`:n<0?`${n}`:'';
  const sub = t => `<span style="color:var(--text-dim);font-size:.65rem">(${_esc(t||'')})</span>`;

  // Portrait 30px : image si dispo, sinon initiale colorée
  const _portrait = (url, name) => url
    ? `<img class="vtt-log-portrait-lg" src="${_esc(url)}" alt="${_esc(name||'')}" onerror="this.style.visibility='hidden'">`
    : `<div class="vtt-log-portrait-lg">${_esc((name||'?')[0].toUpperCase())}</div>`;

  // Acteur = portrait + nom
  const _actor = (image, name) => `<span class="vtt-log-actor">${_portrait(image, name)}<span class="vtt-log-name">${_esc(name||'?')}</span></span>`;

  // Header source ▸ cible avec label optionnel
  const _header = ({ srcImg, srcName, tgtImg, tgtName, label, badges = '', ts = '' }) => {
    const arrow = tgtName ? `<span class="vtt-log-arrow">▸</span>` : '';
    const tgt = tgtName ? _actor(tgtImg, tgtName) : '';
    const lbl = label ? `<span class="vtt-log-label">${_esc(label)}</span>` : '';
    return `<div class="vtt-log-head">
      ${_actor(srcImg, srcName)}${arrow}${tgt}${lbl}
      <span class="vtt-log-meta">${badges}${ts}</span>
    </div>`;
  };

  // Timestamp HH:MM
  const _ts = m => {
    const ms = m.createdAt?.toMillis?.();
    if (!ms) return '';
    const d = new Date(ms);
    return `<span class="vtt-log-time">${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}</span>`;
  };

  // Bouton de toggle détail (avec écouteur attaché plus bas)
  const _toggle = (id) => `<button class="vtt-log-toggle" data-detail="${id}">détail ▾</button>`;

  // Ligne de détail (formule + valeur) — finale = surlignée à la couleur du type
  const _row = (label, val, { op = '🎲', isFinal = false } = {}) => `
    <div class="vtt-log-detail-row${isFinal ? ' is-final' : ''}">
      <span class="vtt-log-detail-label"><span class="op">${op}</span>${label}</span>
      <span class="vtt-log-detail-val">${val}</span>
    </div>`;

  // Affichage d'un jet de dés : 1d6(4) ou 2d6(3,5) — gras sur les rolls individuels
  const _dice = (det, fallback = '?') => {
    if (det?.rolls?.length) {
      const rollsTxt = det.rolls.map(r => `<strong>${r}</strong>`).join(',');
      const modPart = det.mod > 0 ? ` +${det.mod}` : det.mod < 0 ? ` ${det.mod}` : '';
      return `${det.rolls.length}d${det.sides}(${rollsTxt})${modPart}`;
    }
    return String(fallback);
  };

  // d20 avec adv/dis (dé rejeté barré)
  const _d20 = (kept, allRolls) => {
    if (Array.isArray(allRolls) && allRolls.length > 1) {
      const dropped = allRolls.find(r => r !== kept) ?? allRolls[1];
      return `d20[<strong>${kept}</strong>&thinsp;<span style="text-decoration:line-through;color:var(--text-dim);font-weight:400">${dropped}</span>]`;
    }
    return `d20[<strong>${kept ?? '?'}</strong>]`;
  };

  // Estimation CA visible par le joueur (pas spoil pour les non-MJ)
  //  • MJ : voit la vraie CA enregistrée dans le log
  //  • Joueur : voit son estimation (track.caEstimee du bestiaire) ; sinon "?"
  //  • Pour un PJ allié : on montre la CA réelle (les joueurs connaissent leurs alliés)
  const _viewCA = (target, realCA) => {
    if (STATE.isAdmin) return realCA ?? '?';
    if (target.characterId) return realCA ?? '?';
    if (target.beastId) {
      const track = _bstTracker[target.beastId];
      if (track?.caEstimee !== undefined && track.caEstimee !== '') {
        return parseInt(track.caEstimee) || '?';
      }
      return '?';
    }
    if (target.npcId) return '?'; // PNJ : pas d'estimation, masquée
    return realCA ?? '?';
  };

  // Badges avantage / désavantage
  const _advBadge = (mode) => mode === 'adv'
    ? `<span class="vtt-log-badge vtt-log-badge--adv" title="Avantage">⬆ ADV</span>`
    : mode === 'dis'
      ? `<span class="vtt-log-badge vtt-log-badge--dis" title="Désavantage">⬇ DIS</span>`
      : '';

  // ═══════════════════════════════════════════════════════════════════
  // RENDERS — un par type de message, tous au même format
  // ═══════════════════════════════════════════════════════════════════

  /** Attaque single-target (offensive ET heal) */
  const renderAttack = (m, i, ts) => {
    const isHeal = !!m.isHeal;
    const isCrit = !!m.isCrit, isFumble = !!m.isFumble;
    const isHalf = !!m.halfDmg, isHit = !!m.hit;
    let theme = 'miss';
    if (isHeal) theme = isFumble ? 'fumble' : 'heal';
    else if (isCrit) theme = 'crit';
    else if (isFumble) theme = 'fumble';
    else if (isHit)  theme = 'hit';
    else if (isHalf) theme = 'half';

    const badges = [
      _advBadge(m.advMode),
      isCrit   ? `<span class="vtt-log-badge vtt-log-badge--crit">💥 CRIT</span>` : '',
      isFumble ? `<span class="vtt-log-badge vtt-log-badge--fumble">💀 FUMBLE</span>` : '',
    ].join('');

    const head = _header({
      srcImg: m.characterImage, srcName: m.attackerName || m.authorName || '?',
      tgtImg: m.defenderImage, tgtName: m.defenderName,
      label:  m.optLabel, badges, ts,
    });

    // Headline : résultat principal
    let bodyHtml = '';
    if (isHeal) {
      if (isFumble) {
        bodyHtml = `<div class="vtt-log-body">
          <span class="vtt-log-icon">💔</span>
          <strong class="vtt-log-result">RATÉ</strong>
          <span class="vtt-log-result-sub">${m.pmCost||0} PM consommés</span>
          ${_toggle(`d${i}`)}
        </div>`;
      } else {
        bodyHtml = `<div class="vtt-log-body">
          <span class="vtt-log-icon">💚</span>
          <strong class="vtt-log-result">+${m.dmgTotal}</strong>
          <span class="vtt-log-result-sub">PV soignés</span>
          ${isCrit ? `<span class="vtt-log-result-sub" style="color:#f59e0b">(critique)</span>` : ''}
          ${_toggle(`d${i}`)}
        </div>`;
      }
    } else {
      // Attaque offensive : Toucher en premier, dégâts en second
      const dmgCol = m.interaction === 'Absorption' ? '#22c38e'
                   : isHalf                          ? '#b47fff'
                   :                                   '#ef4444';
      const dmgIcon = m.interaction === 'Absorption' ? '💚'
                    : m.interaction === 'Immunité'   ? '🚫'
                    :                                   '⚔️';
      const dmgLabel = m.interaction === 'Absorption' ? 'PV soignés'
                     : m.interaction === 'Immunité'   ? 'aucun dégât'
                     : m.newHp === 0                  ? 'KO'
                     : isHalf                         ? '½ dégâts'
                     :                                  'dégâts';
      const interTag = m.interaction && DAMAGE_INTERACTIONS[m.interaction]
        ? (() => { const im = DAMAGE_INTERACTIONS[m.interaction];
            return `<span class="vtt-log-badge" style="color:${im.color};background:${im.color}1a">${im.icon} ${_esc(m.interaction)}</span>`;
          })()
        : '';
      const dmgVal = m.dmgTotal < 0 ? `+${-m.dmgTotal}` : m.dmgTotal;
      // Ligne 1 : jet de toucher — on affiche le TOTAL calculé ET le dé naturel.
      // (CA estimée pour les joueurs sur les ennemis)
      const _shownCA = _viewCA(m, m.targetCA);
      const natDie = (m.hitD20 != null)
        ? `<span class="vtt-log-nat" title="Jet naturel du dé (avant modificateurs)">${_d20(m.hitD20, m.hitD20rolls)}</span>`
        : '';
      const hitRow = `<div class="vtt-log-body">
        <span class="vtt-log-icon">🎯</span>
        <strong class="vtt-log-result" style="font-size:1.15rem;color:${isHit?'#22c38e':'#ef4444'}">${m.hitTotal ?? '?'}</strong>
        ${natDie}
        <span class="vtt-log-vs">vs CA ${_shownCA}</span>
        <span class="vtt-log-result-sub" style="color:${isHit?'#22c38e':'#ef4444'};font-weight:700">${isHit ? '✓ TOUCHE' : '✗ RATÉ'}</span>
        ${_toggle(`d${i}`)}
      </div>`;
      // Ligne 2 : dégâts (si applicable)
      const dmgRow = (isHit || isHalf) ? `<div class="vtt-log-body" style="padding-top:.05rem">
        <span class="vtt-log-icon">${dmgIcon}</span>
        <strong class="vtt-log-result" style="color:${dmgCol}">${dmgVal}</strong>
        <span class="vtt-log-result-sub" style="color:${dmgCol}">${dmgLabel}</span>
        ${interTag}
        ${m.dmgReduction > 0 ? `<span class="vtt-log-badge" style="color:#60a5fa;background:rgba(96,165,250,.18)">🛡 Set Lourd −${m.dmgReduction}</span>` : ''}
      </div>` : '';
      bodyHtml = hitRow + dmgRow;
    }

    // Panneau détail
    const detail = buildAttackDetail(m, isHeal);

    return `<div class="vtt-log vtt-log--${theme}">
      ${head}
      ${bodyHtml}
      <div class="vtt-log-detail" id="d${i}">${detail}</div>
    </div>`;
  };

  /** Détail d'une attaque : toucher détaillé + dégâts détaillés (chaque dé visible) */
  const buildAttackDetail = (m, isHeal) => {
    const rows = [];
    // ── TOUCHER ──
    const d20 = _d20(m.hitD20, m.hitD20rolls);
    const touchParts = [d20];
    if (m.hitToucherMod != null && m.hitToucherStatLabel) touchParts.push(`${sn(m.hitToucherMod)}${sub(m.hitToucherStatLabel)}`);
    if (m.hitToucherSetBonus > 0) touchParts.push(`+${m.hitToucherSetBonus}${sub('Set')}`);
    if (m.hitTouchBuff > 0) touchParts.push(`+${m.hitTouchBuff}${sub('🎯 Ench')}`);
    if (m.hitBonus) touchParts.push(`${sn(m.hitBonus)}${sub('bonus')}`);
    if (m.extraHitRolls?.length) m.extraHitRolls.forEach(r => touchParts.push(`+d20[${r}]`));
    const _caShown = isHeal ? null : _viewCA(m, m.targetCA);
    rows.push(_row(touchParts.join(' '), `<strong>${m.hitTotal ?? '?'}</strong>${isHeal ? ` vs DD ${m.healDD ?? 2}` : ` vs CA ${_caShown}`}`, { op: '🎯', isFinal: false }));

    // ── DÉGÂTS / SOIN ──
    if (m.hit || m.halfDmg || isHeal) {
      const baseRoll = _dice(m.dmgRollsDetail, `${_esc(m.dmgEffectiveDice || m.dmgRawDice || m.dmgFormula || '')}(${m.dmgRaw})`);
      const critRoll = _dice(m.critRollsDetail, baseRoll);
      const mods = [];
      if (m.dmgStatMod) mods.push(`${sn(m.dmgStatMod)}${sub(m.dmgStatLabel || '')}`);
      if (m.dmgMaitriseBonus > 0) mods.push(`+${m.dmgMaitriseBonus}${sub('Maîtrise')}`);
      if (m.dmgBonus) mods.push(`${sn(m.dmgBonus)}${sub('bonus')}`);
      if (m.dmgBonusDice) mods.push(`${sn(m.dmgBonusDice)}${sub('dés')}`);
      // Bonus enchant détaillé
      if (m.buffDmgDetail) {
        const bd = m.buffDmgDetail;
        const rollsTxt = bd.rolls?.length ? bd.rolls.map(r=>`<strong>${r}</strong>`).join(',') : '';
        const modStr = bd.mod > 0 ? ` +${bd.mod}` : bd.mod < 0 ? ` ${bd.mod}` : '';
        mods.push(`+${bd.rolls?.length ? `${bd.rolls.length}d${bd.sides}(${rollsTxt})${modStr}` : bd.total}${sub(bd.sortLabel || 'Enchant')}`);
      } else if (m.buffDmgBonus) {
        mods.push(`+${m.buffDmgBonus}${sub('Enchant')}`);
      }
      const formula = m.isCrit && m.critNormalMax
        ? `max(${m.critNormalMax}) + ${critRoll} ${mods.join(' ')}`
        : `${baseRoll} ${mods.join(' ')}`;

      // Si tout droit : valeur finale = dmgFull
      const fullVal = m.dmgFull ?? m.dmgTotal;
      const halfVal = m.halfDmg ? Math.max(1, Math.floor(fullVal / 2)) : null;
      const hasReduction = m.dmgReduction > 0;
      const hasInter = m.interaction && m.dmgTotal !== (halfVal ?? fullVal);

      const isFinalBrut = !halfVal && !hasInter && !hasReduction;
      rows.push(_row(formula, `<strong>${fullVal}</strong>`, { op: isHeal ? '💚' : '⚔️', isFinal: isFinalBrut }));

      if (halfVal != null && halfVal !== fullVal) {
        rows.push(_row(`Échec ½ (sort/arme magique)`, `<strong>${halfVal}</strong>`, { op: '✦', isFinal: !hasInter && !hasReduction }));
      }
      if (hasInter) {
        const im = DAMAGE_INTERACTIONS[m.interaction];
        const fmt = m.dmgTotal < 0 ? `+${-m.dmgTotal}` : m.dmgTotal;
        rows.push(_row(`${im?.icon || '✦'} ${m.interaction}`, `<strong>${fmt}</strong>`, { op: im?.icon || '✦', isFinal: !hasReduction }));
      }
      if (hasReduction) {
        const fmt = m.dmgTotal < 0 ? `+${-m.dmgTotal}` : m.dmgTotal;
        rows.push(_row(`Set Lourd −${m.dmgReduction} (min. 1)`, `<strong>${fmt}</strong>`, { op: '🛡', isFinal: true }));
      }
    }
    return rows.join('');
  };

  /** Attaque multi-cibles (sort à plusieurs cibles, AoE) */
  const renderMultiAttack = (m, i, ts) => {
    const isCrit = !!m.isCrit, isFumble = !!m.isFumble;
    const theme = isCrit ? 'crit' : isFumble ? 'fumble' : (m.targets?.some(r=>r.hit) ? 'hit' : 'miss');
    const badges = [
      _advBadge(m.advMode),
      isCrit   ? `<span class="vtt-log-badge vtt-log-badge--crit">💥 CRIT</span>` : '',
      isFumble ? `<span class="vtt-log-badge vtt-log-badge--fumble">💀 FUMBLE</span>` : '',
    ].join('');

    const head = _header({
      srcImg: m.characterImage, srcName: m.attackerName || m.authorName || '?',
      tgtName: `${(m.targets||[]).length} cibles`,
      label:   m.optLabel, badges, ts,
    });

    // Headline : touche total (commun à toutes les cibles)
    const body = `<div class="vtt-log-body">
      <span class="vtt-log-icon">🎯</span>
      <strong class="vtt-log-result" style="font-size:1.15rem">${m.hitTotal}</strong>
      <span class="vtt-log-vs">contre les CA</span>
      ${_toggle(`d${i}`)}
    </div>`;

    // Liste des cibles avec leur résolution individuelle
    // CA affichée selon le viewer : MJ = réelle, joueur = estimation perso
    const targets = (m.targets || []).map(r => {
      const baseCol = r.hit ? '#22c38e' : r.halfDmg ? '#b47fff' : '#6b7280';
      const icon = r.hit ? '✓' : r.halfDmg ? '✦' : '✗';
      const dmgVal = (r.hit || r.halfDmg) ? (r.dmgTotal < 0 ? `+${-r.dmgTotal}` : r.dmgTotal) : '—';
      const dmgSuffix = r.newHp === 0 ? ' 💀' : '';
      const shownCA = _viewCA(r, r.targetCA);
      // Portrait de la cible : son image si disponible (ex. invocation), sinon
      // l'icône de résolution. La pastille de couleur reste le statut hit/miss.
      const portraitInner = r.targetImage
        ? `<img src="${_esc(r.targetImage)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit" onerror="this.replaceWith(document.createTextNode('${icon}'))">`
        : icon;
      return `<div class="vtt-log-target" style="--row-c:${baseCol}">
        <div class="vtt-log-target-portrait" style="background:${baseCol}">${portraitInner}</div>
        <span class="vtt-log-target-name">${_esc(r.name)}</span>
        <span class="vtt-log-target-ca">CA ${shownCA}</span>
        <span class="vtt-log-target-dmg">${dmgVal}${dmgSuffix}</span>
      </div>`;
    }).join('');

    return `<div class="vtt-log vtt-log--${theme}">
      ${head}
      ${body}
      <div class="vtt-log-targets">${targets}</div>
      <div class="vtt-log-detail" id="d${i}">${buildAttackDetail(m, false)}</div>
    </div>`;
  };

  /** Cast de sort (CA, utilitaire) */
  const renderCast = (m, i, ts) => {
    const pmBadge = m.pmCost > 0
      ? `<span class="vtt-log-badge vtt-log-badge--pm">−${m.pmCost} PM</span>` : '';
    const head = _header({
      srcImg: m.characterImage, srcName: m.casterName || m.authorName || '?',
      tgtName: m.targetName, label: m.optLabel,
      badges: pmBadge, ts,
    });
    const body = `<div class="vtt-log-body">
      <span class="vtt-log-icon">✨</span>
      <span class="vtt-log-text">${_esc(m.castEffect || 'Sort activé')}</span>
    </div>`;
    return `<div class="vtt-log vtt-log--cast">${head}${body}</div>`;
  };

  /** Annonce d'affliction : "A lance Silence sur B" */
  const renderAfflictionCast = (m, i, ts) => {
    const head = _header({
      srcImg: m.characterImage, srcName: m.casterName || m.authorName || '?',
      tgtName: m.targetName, label: m.optLabel,
      badges: `<span class="vtt-log-badge" style="color:#c4b5fd;background:rgba(180,127,255,.18)">🛡 JS ${_esc(m.statLabel||'?')} DD ${m.dd}</span>`,
      ts,
    });
    const body = `<div class="vtt-log-body">
      <span class="vtt-log-icon">🪄</span>
      <span class="vtt-log-text">Tente d'appliquer ${_esc(m.effectLbl||'')}</span>
    </div>`;
    return `<div class="vtt-log vtt-log--aff">${head}${body}</div>`;
  };

  /** Jet de sauvegarde */
  const renderSave = (m, i, ts) => {
    const passed = !!m.passed;
    const theme = passed ? 'saveok' : 'savefail';
    const modStr = (m.mod >= 0 ? '+' : '') + m.mod;
    const badge = passed
      ? `<span class="vtt-log-badge vtt-log-badge--ok">✅ RÉUSSI</span>`
      : `<span class="vtt-log-badge vtt-log-badge--fail">❌ ÉCHEC</span>`;
    const head = _header({
      srcImg: null, srcName: m.tokenName || '?',
      label: m.sortLabel ? `JS vs ${m.sortLabel}` : `JS ${m.statLabel||''}`,
      badges: badge, ts,
    });
    const body = `<div class="vtt-log-body">
      <span class="vtt-log-icon">🛡</span>
      <strong class="vtt-log-result" style="font-size:1.15rem">${m.total}</strong>
      <span class="vtt-log-vs">vs DD ${m.dd}</span>
      <span class="vtt-log-result-sub">d20[<strong>${m.d20}</strong>] ${modStr}${sub(m.statLabel||'')}</span>
      ${!passed && m.conditionLabel
        ? `<span class="vtt-log-result-sub" style="color:#fca5a5;font-weight:700">→ subit ${_esc(m.conditionLabel)}</span>`
        : passed
          ? `<span class="vtt-log-result-sub" style="color:#86efac;font-weight:700">→ résiste</span>`
          : ''}
    </div>`;
    return `<div class="vtt-log vtt-log--${theme}">${head}${body}</div>`;
  };

  /** Tick DoT */
  const renderDotTick = (m, i, ts) => {
    const isHealTick = !!m.isHeal;
    const lbl = m.immediate ? 'Proc immédiat' : (isHealTick ? 'Régénération' : 'Tick de round');
    const rollsDetail = (m.rolls || []).map(r => {
      const dicePart = r.rolledDice?.length
        ? `${r.rolledDice.length}d${r.sides}(${r.rolledDice.map(x=>`<strong>${x}</strong>`).join(',')})`
        : r.formula;
      const modPart = r.mod > 0 ? ` +${r.mod}` : r.mod < 0 ? ` ${r.mod}` : '';
      return `${_esc(r.sortLabel)}: ${dicePart}${modPart} = <strong>${r.rolled}</strong>`;
    }).join(' · ');
    const head = _header({
      srcImg: null, srcName: m.tokenName || '?',
      label: lbl, badges: '', ts,
    });
    const body = `<div class="vtt-log-body">
      <span class="vtt-log-icon">${isHealTick ? '💚' : '🩸'}</span>
      <strong class="vtt-log-result" style="font-size:1.15rem">${isHealTick ? '+' : '−'}${m.total}</strong>
      <span class="vtt-log-result-sub">PV (${isHealTick ? 'Régénération' : 'DoT'})</span>
      ${m.newHp != null && m.hpMax ? `<span class="vtt-log-vs">→ ${m.newHp}/${m.hpMax}</span>` : ''}
    </div>`;
    const detailHtml = rollsDetail
      ? `<div class="vtt-log-detail-row"><span class="vtt-log-detail-label"><span class="op">🎲</span>${rollsDetail}</span><span class="vtt-log-detail-val"><strong>${m.total}</strong></span></div>`
      : '';
    const wrapper = detailHtml
      ? `<div class="vtt-log-detail is-open">${detailHtml}</div>` : '';
    return `<div class="vtt-log vtt-log--dot">${head}${body}${wrapper}</div>`;
  };

  /** Jet libre (test de carac) */
  const renderRoll = (m, i, ts) => {
    const resultCol = m.isCrit ? '#ffd700' : m.isFumble ? '#ef4444' : 'var(--text)';
    const modStr   = m.rollMod > 0 ? `+${m.rollMod}` : m.rollMod < 0 ? `${m.rollMod}` : '';
    const bonusStr = m.rollBonus > 0 ? `+${m.rollBonus}` : m.rollBonus < 0 ? `${m.rollBonus}` : '';
    const equipStr = m.rollEquipBonus > 0 ? `+${m.rollEquipBonus}` : m.rollEquipBonus < 0 ? `${m.rollEquipBonus}` : '';
    const badges = [
      m.gmOnly ? `<span class="vtt-log-badge vtt-log-badge--hidden" title="Jet caché — invisible des joueurs">🕶 Caché</span>` : '',
      m.isCrit ? `<span class="vtt-log-badge vtt-log-badge--crit">✨ CRIT</span>` : '',
      m.isFumble ? `<span class="vtt-log-badge vtt-log-badge--fumble">💀 FUMBLE</span>` : '',
      _advBadge(m.rollMode === 'advantage' ? 'adv' : m.rollMode === 'disadvantage' ? 'dis' : null),
    ].join('');
    const head = _header({
      srcImg: m.characterImage, srcName: m.characterName || m.authorName || '?',
      label: m.rollSkill || m.rollFormula || 'Jet', badges, ts,
    });
    const diceStr = Array.isArray(m.rollDice) && m.rollDice.length === 2
      ? _d20(m.rollRaw, m.rollDice)
      : `d20[<strong>${m.rollRaw ?? '?'}</strong>]`;
    const body = `<div class="vtt-log-body">
      <span class="vtt-log-icon">🎲</span>
      <strong class="vtt-log-result" style="color:${resultCol};font-size:1.3rem">${m.rollResult ?? '?'}</strong>
      <span class="vtt-log-result-sub">${diceStr} ${modStr ? `${modStr}${sub(m.rollStat||'')}` : ''} ${equipStr ? `${equipStr}${sub('équip.')}` : ''} ${bonusStr ? `${bonusStr}${sub('bonus')}` : ''}</span>
    </div>`;
    return `<div class="vtt-log vtt-log--roll">${head}${body}</div>`;
  };

  /** Jet libre formule (dice-free) */
  const renderDiceFree = (m, i, ts) => {
    const totalCol = m.total >= 20 ? '#22c38e' : m.total <= 3 ? '#ef4444' : 'var(--text)';
    const detail = (m.groups || []).map(g => {
      if (g.kept != null) {
        const dropped = g.rolls.find(r=>r!==g.kept) ?? g.rolls[1];
        return `d${g.faces}[<strong>${g.kept}</strong>&thinsp;<span style="color:var(--text-dim);text-decoration:line-through">${dropped}</span>]`;
      }
      return `${g.count}d${g.faces}[${g.rolls.map(r=>`<strong>${r}</strong>`).join(',')}]`;
    });
    if (m.bonus) detail.push(m.bonus>0 ? `<span style="color:#e8b84b">+${m.bonus}</span>` : `<span style="color:#ef4444">${m.bonus}</span>`);
    const badges = m.mode === 'advantage'
      ? `<span class="vtt-log-badge vtt-log-badge--adv">⬆ ADV</span>`
      : m.mode === 'disadvantage'
        ? `<span class="vtt-log-badge vtt-log-badge--dis">⬇ DIS</span>` : '';
    const head = _header({
      srcImg: null, srcName: m.authorName || '?',
      label: m.formula || 'Jet libre', badges, ts,
    });
    const body = `<div class="vtt-log-body">
      <span class="vtt-log-icon">🎲</span>
      <strong class="vtt-log-result" style="color:${totalCol};font-size:1.3rem">${m.total}</strong>
      <span class="vtt-log-result-sub">${detail.join(' · ')}</span>
    </div>`;
    return `<div class="vtt-log vtt-log--roll">${head}${body}</div>`;
  };

  /** Message chat normal */
  const renderChat = (m) => {
    const isMe = m.authorId === myUid;
    const quote = m.replyTo ? `<div class="vtt-chat-quote">
        <span class="vtt-chat-quote-who">↩ ${_esc(m.replyTo.authorName||'?')}</span>
        <span class="vtt-chat-quote-text">${_esc(m.replyTo.text||'')}</span>
      </div>` : '';
    return `<div class="vtt-log vtt-log--chat">
      <div class="vtt-log-chat-msg">
        ${quote}
        <span class="vtt-log-chat-who${isMe?' me':''}">${_esc(m.authorName||'?')}</span>
        <span class="vtt-log-chat-text">${_applyEmotes(_esc(m.text||''))}</span>
        <span class="vtt-log-meta">${_ts(m)}</span>
        <button class="vtt-chat-reply-btn" data-vtt-fn="_vttChatReply" data-vtt-args="${m.id}" title="Répondre">↩</button>
      </div>
    </div>`;
  };

  // ═══════════════════════════════════════════════════════════════════
  // RENDU
  // ═══════════════════════════════════════════════════════════════════
  el.innerHTML = msgs.map((m, i) => {
    const ts = _ts(m);
    if (m.type === 'attack')          return renderAttack(m, i, ts);
    if (m.type === 'attack-multi')    return renderMultiAttack(m, i, ts);
    if (m.type === 'cast')            return renderCast(m, i, ts);
    if (m.type === 'affliction-cast') return renderAfflictionCast(m, i, ts);
    if (m.type === 'save')            return renderSave(m, i, ts);
    if (m.type === 'dot-tick')        return renderDotTick(m, i, ts);
    if (m.type === 'roll')            return renderRoll(m, i, ts);
    if (m.type === 'dice-free')       return renderDiceFree(m, i, ts);
    return renderChat(m);
  }).join('');

  // Wire up detail toggles (clic = ouvre/ferme le panneau associé)
  el.querySelectorAll('.vtt-log-toggle').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.detail;
      const panel = document.getElementById(id);
      if (!panel) return;
      const open = panel.classList.toggle('is-open');
      btn.classList.toggle('is-open', open);
      btn.textContent = open ? 'détail ▴' : 'détail ▾';
    };
  });

  el.scrollTop = el.scrollHeight;
}

async function _vttSendChat() {
  const input=document.getElementById('vtt-chat-input');
  const text=input?.value.trim(); if (!text) return;
  input.value='';
  const replyTo = _chatReplyTo;   // capture avant reset
  _vttChatReplyCancel();          // ferme la barre de réponse
  const authorName=STATE.profile?.pseudo||STATE.profile?.prenom||STATE.user?.displayName||'Joueur';
  const payload = { type:'chat', authorId:STATE.user?.uid||null, authorName, text, createdAt:serverTimestamp() };
  if (replyTo) {
    // Extrait court du message cité (évite de stocker un pavé)
    payload.replyTo = {
      id: replyTo.id || '',
      authorName: replyTo.authorName || '?',
      text: (replyTo.text || '').slice(0, 140),
    };
  }
  try {
    await addDoc(_logCol(), payload);
  } catch(e) {
    if (input) input.value=text; // restaurer le texte si échec
    console.error('[vtt] chat send:', e);
    const reason=e.code==='permission-denied'
      ? 'Règles Firestore : ajouter vttLog (voir docs/firestore-rules.md)'
      : e.message;
    showNotif(`Erreur chat : ${reason}`,'error');
  }
}

// ── Répondre à un message (citation type messagerie) ──────────────────────
// Construit un extrait textuel du message cité (gère aussi les jets/attaques).
function _chatMsgExcerpt(m) {
  if (!m) return '';
  if (m.text) return m.text;
  if (m.type === 'attack' || m.type === 'attack-multi') return `⚔️ ${m.optLabel || 'Attaque'}`;
  if (m.type === 'cast' || m.type === 'affliction-cast') return `✨ ${m.optLabel || 'Sort'}`;
  if (m.type === 'roll' || m.type === 'dice-free') return `🎲 Jet${m.total != null ? ' : '+m.total : ''}`;
  if (m.type === 'save') return `🛡 Jet de sauvegarde`;
  return 'message';
}
function _vttChatReply(msgId) {
  const m = _chatMsgs.find(x => x.id === msgId);
  if (!m) return;
  _chatReplyTo = { id: m.id, authorName: m.authorName || '?', text: _chatMsgExcerpt(m) };
  _renderChatReplyBar();
  document.getElementById('vtt-chat-input')?.focus();
}
function _vttChatReplyCancel() {
  _chatReplyTo = null;
  _renderChatReplyBar();
}
function _renderChatReplyBar() {
  const bar = document.getElementById('vtt-chat-reply-bar');
  if (!bar) return;
  if (!_chatReplyTo) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  bar.style.display = 'flex';
  bar.innerHTML = `
    <div class="vtt-chat-reply-bar-body">
      <span class="vtt-chat-reply-bar-who">↩ Réponse à ${_esc(_chatReplyTo.authorName)}</span>
      <span class="vtt-chat-reply-bar-text">${_esc((_chatReplyTo.text||'').slice(0,80))}</span>
    </div>
    <button class="vtt-chat-reply-bar-x" data-vtt-fn="_vttChatReplyCancel" title="Annuler">✕</button>`;
}

// ═══════════════════════════════════════════════════════════════════
// ACTIONS GLOBALES
// ═══════════════════════════════════════════════════════════════════
function _vttTool(t) { return _setTool(_tool === t ? 'select' : t); }
// ── Courir : double le mouvement de base pour ce tour ───────────────
async function _vttCourir(id) {
  const tok = _tokens[id]?.data;
  if (!tok || !_session?.combat?.active) return;
  if (tok.bonusMvt > 0) { showNotif('Course déjà utilisée ce tour', 'error'); return; }
  const bonus = _live(tok).displayMovement ?? 6;
  await updateDoc(_tokRef(id), { bonusMvt: bonus }).catch(() => showNotif('Erreur', 'error'));
  showNotif(`🏃 Course ! +${bonus} cases de mouvement`, 'success');
}

// ── Déplacement clavier (flèches + pavé numérique) ──────────────────
async function _moveSelectedBy(dc, dr) {
  if (!_selected || !_activePage || _tool !== 'select') return;
  const tok = _tokens[_selected]?.data;
  if (!tok || tok.pageId !== _activePage.id) return;
  const ld  = _live(tok);
  const sw  = ld.displayTokenW || 1, sh = ld.displayTokenH || 1;
  const nc  = Math.max(0, Math.min(_activePage.cols - sw, tok.col + dc));
  const nr  = Math.max(0, Math.min(_activePage.rows - sh, tok.row + dr));
  if (nc === tok.col && nr === tok.row) return;
  await _moveTo(_selected, nc, nr);
  fogUpdateSoon(_activePage, _tokens, STATE.isAdmin);
}

function _vttFogTool(t) { return fogSetEditTool(t, _activePage); }
async function _vttToggleFog() {
  if (!_activePage) return;
  const next = !_activePage.fogEnabled;
  await updateDoc(_pgRef(_activePage.id), { fogEnabled: next }).catch(() => showNotif('Erreur fog','error'));
}
async function _vttFogClearOps() {
  if (!_activePage) return;
  const n = (_activePage.fogOps || []).length;
  if (!n) { showNotif('Aucune zone de brouillard sur cette page', 'info'); return; }
  if (!confirm(`Supprimer ${n} zone(s) de brouillard manuel de cette page ?`)) return;
  await updateDoc(_pgRef(_activePage.id), { fogOps: [] }).catch(() => showNotif('Erreur', 'error'));
}
function _vttSwitchPage(id) { return _switchPage(id); }

// ══════════════════════════════════════════════════════════════════════════
// COURT REPOS — Vote du groupe, régénère ½ PV / ½ PM (arrondi sup.)
// ──────────────────────────────────────────────────────────────────────────
// Stockage session.shortRest = { max, count, vote: { votes: {uid:true} } | null }
// Vote complet (tous les owners de player tokens placés ont voté) → MJ applique.
// MJ peut forcer / annuler / régler max / reset compteur.
// ══════════════════════════════════════════════════════════════════════════
function _shortRestPresentUids() {
  const uids = new Set();
  for (const e of Object.values(_tokens)) {
    const t = e?.data;
    if (t?.type === 'player' && t.pageId && t.ownerId) uids.add(t.ownerId);
  }
  return [...uids];
}
function _shortRestPresentChars() {
  const seen = new Set(), chars = [];
  for (const e of Object.values(_tokens)) {
    const t = e?.data;
    if (t?.type === 'player' && t.pageId && t.characterId && !seen.has(t.characterId)) {
      seen.add(t.characterId);
      const c = _characters[t.characterId];
      if (c) chars.push(c);
    }
  }
  return chars;
}
function _shortRestPresentNames() {
  // ownerId → nom à afficher (perso le plus récemment vu)
  const out = {};
  for (const e of Object.values(_tokens)) {
    const t = e?.data;
    if (t?.type === 'player' && t.ownerId && !out[t.ownerId]) {
      const c = t.characterId ? _characters[t.characterId] : null;
      out[t.ownerId] = c?.nom || t.name || t.ownerId.slice(0, 6);
    }
  }
  return out;
}

async function _vttShortRestVote() {
  const uid = STATE.user?.uid; if (!uid) return;
  const sr  = _session?.shortRest || { max: 0, count: 0, vote: null };
  if ((sr.count || 0) >= (sr.max ?? 0)) {
    showNotif('Plus de court repos disponible', 'error'); return;
  }
  const votes = { ...(sr.vote?.votes || {}), [uid]: true };
  await setDoc(_sesRef(), { shortRest: { ...sr, vote: { votes } } }, { merge: true })
    .catch(() => showNotif('Erreur vote', 'error'));
}

async function _vttShortRestUnvote() {
  const uid = STATE.user?.uid; if (!uid) return;
  const sr  = _session?.shortRest; if (!sr?.vote) return;
  const votes = { ...sr.vote.votes };
  delete votes[uid];
  // ⚠️ setDoc(..., {merge:true}) FUSIONNE les maps → il ne supprimerait jamais la
  // clé retirée (le vote resterait collé). updateDoc avec un field-path REMPLACE
  // la valeur à ce chemin → le retrait fonctionne réellement.
  const patch = Object.keys(votes).length
    ? { 'shortRest.vote': { votes } }
    : { 'shortRest.vote': null };
  await updateDoc(_sesRef(), patch).catch(() => {});
}

async function _vttShortRestCancel() {
  if (!STATE.isAdmin) return;
  const sr = _session?.shortRest; if (!sr) return;
  await setDoc(_sesRef(), { shortRest: { ...sr, vote: null } }, { merge: true });
}

async function _vttShortRestForce() {
  if (!STATE.isAdmin) return;
  await _applyShortRest({ forced: true });
}

async function _vttShortRestSetMax(val) {
  if (!STATE.isAdmin) return;
  const max = Math.max(0, Math.min(20, parseInt(val) || 0));
  const sr  = _session?.shortRest || { count: 0, vote: null };
  await setDoc(_sesRef(), { shortRest: { ...sr, max } }, { merge: true });
}

async function _vttShortRestResetCount() {
  if (!STATE.isAdmin) return;
  const sr = _session?.shortRest || { max: 0 };
  await setDoc(_sesRef(), { shortRest: { ...sr, count: 0, vote: null } }, { merge: true });
}

async function _applyShortRest({ forced = false } = {}) {
  const sr = _session?.shortRest || { max: 0, count: 0, vote: null };
  if ((sr.count || 0) >= (sr.max ?? 0)) {
    showNotif('Plus de court repos disponible', 'error'); return;
  }
  const chars = _shortRestPresentChars();
  await Promise.all(chars.map(c => {
    const maxHp = calcPVMax(c);
    const maxPm = calcPMMax(c);
    const curHp = Math.max(0, Number(c.hp) || 0);
    const curPm = Math.max(0, Number(c.pm) || 0);
    const newHp = Math.min(maxHp, curHp + Math.ceil(maxHp / 2));
    const newPm = Math.min(maxPm, curPm + Math.ceil(maxPm / 2));
    return updateDoc(_chrRef(c.id), { hp: newHp, pm: newPm }).catch(() => {});
  }));
  const newCount = (sr.count || 0) + 1;
  await setDoc(_sesRef(), { shortRest: { ...sr, count: newCount, vote: null } }, { merge: true });
  const tag = forced ? ' (forcé par le MJ)' : '';
  showNotif(`💤 Court repos pris${tag} — ${chars.length} perso(s) régénéré(s) · ${newCount}/${sr.max ?? 0}`, 'success');
}

// Auto-apply : seul le MJ déclenche pour éviter les races.
function _checkShortRestAutoApply() {
  if (!STATE.isAdmin) return;
  const sr = _session?.shortRest;
  if (!sr?.vote) return;
  if ((sr.count || 0) >= (sr.max ?? 0)) return;
  const present = _shortRestPresentUids();
  if (!present.length) return;
  const voted = Object.keys(sr.vote.votes || {});
  if (!present.every(u => voted.includes(u))) return;
  _applyShortRest({ forced: false });
}

function _renderShortRest() {
  const trigger = document.getElementById('vtt-rest-trigger');
  const panel   = document.getElementById('vtt-rest-panel');
  const body    = document.getElementById('vtt-rest-body');
  if (!trigger) return;

  const sr   = _session?.shortRest || { max: 0, count: 0, vote: null };
  const max  = sr.max ?? 0;
  const used = sr.count || 0;
  const rem  = Math.max(0, max - used);

  trigger.textContent = `💤 ${used}/${max}`;
  trigger.classList.toggle('vtt-rest-trigger--out',    rem === 0);
  trigger.classList.toggle('vtt-rest-trigger--voting', !!sr.vote);

  if (!panel || panel.dataset.open !== '1' || !body) return;

  const uid     = STATE.user?.uid;
  const present = _shortRestPresentUids();
  const voted   = Object.keys(sr.vote?.votes || {});
  const names   = _shortRestPresentNames();
  const onPage  = present.includes(uid);
  const hasV    = voted.includes(uid);

  const voteList = sr.vote ? present.map(u => `
    <div class="vtt-rest-voter">
      <span class="vtt-rest-voter-ic ${voted.includes(u) ? 'on' : ''}">${voted.includes(u) ? '✓' : '⋯'}</span>
      <span class="vtt-rest-voter-name">${_esc(names[u] || u.slice(0,6))}</span>
    </div>`).join('') : '';

  body.innerHTML = `
    <div class="vtt-rest-counter">
      <span><b>${used}</b>/${max} utilisé(s)</span>
      <span class="vtt-rest-remaining">${rem} restant${rem>1?'s':''}</span>
    </div>
    <div class="vtt-rest-desc">Régénère <b>½ PV</b> et <b>½ PM</b> (arrondi sup.) à tous les persos placés.</div>
    ${sr.vote ? `
      <div class="vtt-rest-vote-hd">Vote en cours · ${voted.length}/${present.length || '?'}</div>
      <div class="vtt-rest-voters">${voteList || '<div class="vtt-rest-help">Aucun joueur sur la map.</div>'}</div>` : ''}
    ${rem > 0 && onPage ? `
      <div class="vtt-rest-actions">
        ${hasV
          ? `<button class="vtt-rest-btn vtt-rest-btn--voted" data-vtt-fn="_vttShortRestUnvote">✓ Voté — retirer</button>`
          : `<button class="vtt-rest-btn vtt-rest-btn--vote" data-vtt-fn="_vttShortRestVote">Voter pour un court repos</button>`}
      </div>` : ''}
    ${rem === 0 ? '<div class="vtt-rest-help">Plus de court repos disponible pour cette aventure.</div>' : ''}
    ${rem > 0 && !onPage && !STATE.isAdmin ? '<div class="vtt-rest-help">Tu n\'as aucun token placé sur la map.</div>' : ''}
    ${STATE.isAdmin ? `
      <div class="vtt-rest-mj">
        <div class="vtt-rest-mj-row">
          <label class="vtt-rest-mj-lbl">Max pour l'aventure</label>
          <input type="number" min="0" max="20" value="${max}" class="vtt-rest-mj-input"
            data-vtt-fn="_vttShortRestSetMax" data-vtt-on="change" data-vtt-args="$value">
        </div>
        <div class="vtt-rest-mj-btns">
          ${rem > 0 ? `<button class="vtt-rest-btn vtt-rest-btn--force" data-vtt-fn="_vttShortRestForce">💤 Forcer le court repos</button>` : ''}
          ${sr.vote ? `<button class="vtt-rest-btn vtt-rest-btn--cancel" data-vtt-fn="_vttShortRestCancel">✕ Annuler le vote</button>` : ''}
          ${used > 0 ? `<button class="vtt-rest-btn vtt-rest-btn--reset" data-vtt-fn="_vttShortRestResetCount">↺ Reset compteur</button>` : ''}
        </div>
      </div>` : ''}
  `;
}

// Ferme le panneau et détache le listener de clic extérieur.
function _closeShortRest() {
  const panel = document.getElementById('vtt-rest-panel');
  if (panel) { panel.dataset.open = '0'; panel.style.display = 'none'; }
  document.getElementById('vtt-rest-trigger')?.classList.remove('active');
  document.removeEventListener('mousedown', _shortRestOutsideClick);
}
// Clic en dehors du float (panneau + déclencheur) → fermer.
function _shortRestOutsideClick(e) {
  if (e.target.closest('.vtt-rest-float')) return;
  _closeShortRest();
}
function _vttToggleShortRest() {
  const panel = document.getElementById('vtt-rest-panel'); if (!panel) return;
  const open = panel.dataset.open === '1';
  if (open) {
    _closeShortRest();
  } else {
    panel.dataset.open = '1'; panel.style.display = 'flex';
    document.getElementById('vtt-rest-trigger')?.classList.add('active');
    _renderShortRest();
    // Défère l'ajout du listener pour que le clic d'ouverture ne le ferme pas aussitôt.
    requestAnimationFrame(() => document.addEventListener('mousedown', _shortRestOutsideClick));
  }
}

// ── Suivi joueur du bestiaire (déductions, notes) depuis l'inspecteur VTT ──
// Écrit dans le même document Firestore que la fiche bestiaire → cohérent partout.
const _saveBstTracker = async () => {
  const uid = STATE.user?.uid; if (!uid) return;
  try { await saveDoc('bestiary_tracker', uid, { data: _bstTracker }); }
  catch (e) { console.error('[vtt] tracker save', e); }
}
function _vttBstDed(beastId, key, val) {
  if (!_bstTracker[beastId]) _bstTracker[beastId] = {};
  if (!_bstTracker[beastId].deductions) _bstTracker[beastId].deductions = {};
  const v = (val ?? '').toString();
  if (!v.trim()) delete _bstTracker[beastId].deductions[key];
  else           _bstTracker[beastId].deductions[key] = v;
  _saveBstTracker();
}
function _vttBstNotes(beastId, val) {
  if (!_bstTracker[beastId]) _bstTracker[beastId] = {};
  _bstTracker[beastId].notes = (val ?? '').toString();
  _saveBstTracker();
}

// ── Outils de dessin ────────────────────────────────────────────────
function _vttDrawShape(shape) {
  _drawShape = shape;
  ['pencil','line','rect','circle','eraser'].forEach(s => {
    document.getElementById(`vtt-ds-${s}`)?.classList.toggle('active', s === shape);
  });
  // La gomme a besoin que les annotations soient « écoutables » pour le hit-test ;
  // les formes de dessin non. On (dé)sélectionne et on met à jour l'écoute.
  if (shape === 'eraser') _deselectAnnot?.();
  _updateAnnotDraggable();
  const wrap = document.getElementById('vtt-canvas-wrap');
  if (wrap) wrap.style.cursor = shape === 'eraser' ? 'cell' : 'crosshair';
}

// Annule le dernier tracé de la session (bouton ↩ et Ctrl+Z).
function _vttUndoDraw() {
  const lastId = _drawHistory.pop();
  if (lastId) deleteDoc(_annotRef(lastId)).catch(() => {});
}

// Gomme : supprime l'annotation (éditable) sous le curseur. Utilise la détection de
// hit Konva → gère correctement rotation/échelle/zoom. Optimiste + suppression doc.
function _eraseAtPointer() {
  if (!_layers?.draw || !_stage) return;
  const pos = _stage.getPointerPosition(); if (!pos) return;
  let node = _layers.draw.getIntersection(pos);
  let id = null;
  while (node && !id) { id = node._annotId || null; node = node.getParent?.(); }
  if (!id || !_annotations[id]) return;
  const canEdit = STATE.isAdmin || _annotations[id].data.createdBy === STATE.user?.uid;
  if (!canEdit) return;
  _annotations[id].shape?.destroy();
  delete _annotations[id];
  const hi = _drawHistory.indexOf(id);
  if (hi >= 0) _drawHistory.splice(hi, 1);
  _layers.draw.batchDraw();
  deleteDoc(_annotRef(id)).catch(() => {});
}
function _vttDrawColor(color) {
  _drawColor = color;
  document.querySelectorAll('.vtt-draw-color').forEach(b => b.classList.toggle('active', b.dataset.color === color));
}
function _vttDrawWidth(w) {
  _drawWidth = w;
  document.querySelectorAll('.vtt-draw-wbtn').forEach(b => b.classList.toggle('active', +b.dataset.w === w));
}
function _vttToggleDrawFill() {
  _drawFill = !_drawFill;
  const btn = document.getElementById('vtt-draw-fill-btn');
  if (btn) { btn.textContent = _drawFill ? '◼' : '◻'; btn.classList.toggle('active', _drawFill); }
}
async function _vttClearAnnots() {
  if (!_activePage) return;
  if (!await confirmModal('Effacer toutes les annotations de cette page ?')) return;
  const toDelete = Object.values(_annotations).filter(e => e.data.pageId === _activePage.id);
  await Promise.all(toDelete.map(e => deleteDoc(_annotRef(e.data.id)).catch(()=>{})));
}

// Presets de taille communs aux modales création / édition (préfixe vpf-/vpe-)
const _PG_PRESETS = [
  { lb:'Petite',  c:16, r:12 },
  { lb:'Moyenne', c:24, r:18 },
  { lb:'Grande',  c:32, r:24 },
  { lb:'Vaste',   c:48, r:36 },
];
function _pgModalBody(pfx, { name='', folder='', cols=24, rows=18, fog=null } = {}) {
  const presets = _PG_PRESETS.map(p =>
    `<button type="button" class="vtt-pgm-preset" data-vtt-fn="_vttPgPreset" data-vtt-args="${pfx}|${p.c}|${p.r}">${p.lb}<small>${p.c}×${p.r}</small></button>`
  ).join('');
  return `
    <div class="vtt-pgm">
      <label class="vtt-pgm-field">
        <span class="vtt-pgm-lbl">Nom de la page</span>
        <input id="${pfx}name" type="text" value="${_esc(name)}" placeholder="ex : Forêt Sombre" autofocus>
      </label>
      <label class="vtt-pgm-field">
        <span class="vtt-pgm-lbl">📁 Dossier <em>(optionnel)</em></span>
        <input id="${pfx}folder" type="text" value="${_esc(folder)}" placeholder="ex : Chapitre 1, Donjons…" list="${pfx}folders" autocomplete="off">
        ${_pageFolderDatalist(pfx+'folders')}
        <span class="vtt-pgm-hint">Tape un nom existant ou nouveau — ou range la page par glisser-déposer.</span>
      </label>
      <div class="vtt-pgm-field">
        <span class="vtt-pgm-lbl">Dimensions de la grille</span>
        <div class="vtt-pgm-presets">${presets}</div>
        <div class="vtt-pgm-dims">
          <div><input id="${pfx}cols" type="number" value="${cols}" min="8" max="200"><span>colonnes</span></div>
          <span class="vtt-pgm-x">×</span>
          <div><input id="${pfx}rows" type="number" value="${rows}" min="8" max="200"><span>lignes</span></div>
        </div>
      </div>
      ${fog !== null ? `
      <label class="vtt-pgm-check">
        <input type="checkbox" id="${pfx}fog" ${fog?'checked':''}>
        <span>👁 Éclairage dynamique (brouillard de guerre)</span>
      </label>` : ''}
    </div>`;
}
function _vttPgPreset(pfx, c, r) {
  const cEl = document.getElementById(pfx+'cols'), rEl = document.getElementById(pfx+'rows');
  if (cEl) cEl.value = c;
  if (rEl) rEl.value = r;
  document.querySelectorAll('.vtt-pgm-preset').forEach(b => {
    const [bp, bc, br] = (b.dataset.vttArgs||'').split('|');
    b.classList.toggle('active', bp===pfx && +bc===+c && +br===+r);
  });
}

function _vttAddPage() {
  openModal('🗺️ Nouvelle page', `
    ${_pgModalBody('vpf-')}
    <div class="vtt-pgm-actions">
      <button class="btn-secondary" data-action="close-modal">Annuler</button>
      <button class="btn-primary" data-vtt-fn="_vttConfirmAddPage">Créer la page</button>
    </div>`);
}
// Datalist des dossiers de pages existants (suggestions de saisie)
function _pageFolderDatalist(id) {
  const folders = [...new Set(Object.values(_pages).map(p => (p.folder||'').trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'}));
  return `<datalist id="${id}">${folders.map(f=>`<option value="${_esc(f)}">`).join('')}</datalist>`;
}

async function _vttConfirmAddPage() {
  const name=(document.getElementById('vpf-name')?.value||'').trim();
  const folder=(document.getElementById('vpf-folder')?.value||'').trim();
  const cols=Math.max(8,Math.min(200,parseInt(document.getElementById('vpf-cols')?.value)||24));
  const rows=Math.max(8,Math.min(200,parseInt(document.getElementById('vpf-rows')?.value)||18));
  if (!name) { showNotif('Nom requis','error'); return; }
  closeModalDirect();
  await addDoc(_pgsCol(),{name,folder,cols,rows,backgroundImages:[],order:Object.keys(_pages).length,createdAt:serverTimestamp()})
    .catch(()=>showNotif('Erreur création page','error'));
}

function _vttEditPage(id) {
  const p=_pages[id]; if (!p) return;
  openModal('✏️ Modifier la page', `
    ${_pgModalBody('vpe-', { name:p.name, folder:p.folder||'', cols:p.cols||24, rows:p.rows||18, fog:!!p.fogEnabled })}
    <div class="vtt-pgm-actions">
      <button class="btn-secondary" data-action="close-modal">Annuler</button>
      <button class="btn-primary" data-vtt-fn="_vttConfirmEditPage" data-vtt-args="${id}">Enregistrer</button>
    </div>`);
}
async function _vttConfirmEditPage(id) {
  const name=(document.getElementById('vpe-name')?.value||'').trim();
  const folder=(document.getElementById('vpe-folder')?.value||'').trim();
  const cols=Math.max(8,Math.min(200,parseInt(document.getElementById('vpe-cols')?.value)||24));
  const rows=Math.max(8,Math.min(200,parseInt(document.getElementById('vpe-rows')?.value)||18));
  if (!name) { showNotif('Nom requis','error'); return; }
  const fogEnabled = document.getElementById('vpe-fog')?.checked ?? false;
  closeModalDirect();
  await updateDoc(_pgRef(id),{name,folder,cols,rows,fogEnabled}).catch(()=>showNotif('Erreur','error'));
  if (_activePage?.id===id) { _activePage={..._activePage,name,folder,cols,rows,fogEnabled}; _drawGrid(); }
}

async function _vttDeletePage(id) {
  if (!await confirmModal('Supprimer cette page ?',{title:'Supprimer ?',danger:true})) return;
  await deleteDoc(_pgRef(id)).catch(()=>{});
}

// Envoyer tous les joueurs vers une page spécifique (depuis la liste)
async function _vttSendToPage(pageId) {
  const p=_pages[pageId]; if (!p) return;
  await setDoc(_sesRef(),{activePageId:pageId},{merge:true}).catch(()=>{});
  showNotif(`📡 Tous les joueurs → « ${p.name} »`,'success');
}

// Placer un token sur la page active (depuis le tray)
async function _vttPlace(tokenId) {
  if (!_activePage) { showNotif('Crée d\'abord une page','error'); return; }
  const cC=Math.floor(_activePage.cols/2), cR=Math.floor(_activePage.rows/2);
  await updateDoc(_tokRef(tokenId),{pageId:_activePage.id,col:cC,row:cR,visible:true})
    .catch(()=>showNotif('Erreur placement','error'));
}
// Dupliquer un perso/PNJ déjà placé sur une autre page → nouveau token sur la page active.
// Le HP/PM/stats sont partagés via la fiche perso ; les buffs et état de tour restent par-instance.
async function _vttDuplicateOnPage(srcTokenId) {
  if (!STATE.isAdmin) return;
  if (!_activePage) { showNotif('Crée d\'abord une page','error'); return; }
  const src = _tokens[srcTokenId]?.data;
  if (!src) { showNotif('Token introuvable','error'); return; }
  if (src.type === 'enemy') { _vttDuplicateToken(srcTokenId); return; }
  const cC = Math.floor(_activePage.cols/2), cR = Math.floor(_activePage.rows/2);
  try {
    await addDoc(_toksCol(), {
      name: src.name || 'Token',
      type: src.type,
      characterId: src.characterId || null,
      npcId:       src.npcId       || null,
      beastId:     src.beastId     || null,
      ownerId:     src.ownerId     || null,
      pageId: _activePage.id, col: cC, row: cR,
      visible: true,
      imageUrl: src.imageUrl || null,
      movement: src.movement ?? null, range: src.range ?? 1,
      attack: src.attack ?? null, attackDice: src.attackDice || null,
      defense: src.defense ?? null,
      hp: src.hp ?? null, hpMax: src.hpMax ?? null,
      tokenW: src.tokenW ?? null, tokenH: src.tokenH ?? null,
      buffs: [],
      movedThisTurn: false, attackedThisTurn: false, bonusActionThisTurn: false, reactionThisTurn: false, movedCells: 0, bonusMvt: 0,
      createdAt: serverTimestamp(),
    });
    showNotif('+ Placé sur cette page','success');
  } catch (e) {
    console.error('[vtt] duplicate-on-page:', e);
    showNotif('Erreur duplication','error');
  }
}
// Retirer un token de la carte.
// Si plusieurs tokens partagent la même entité (perso/PNJ dupliqué), on supprime celui-ci ;
// sinon on le renvoie en réserve.
async function _vttRetireToken(tokenId) {
  const t = _tokens[tokenId]?.data; if (!t) return;
  const key = t.characterId || t.npcId; // les ennemis (beastId) sont gérés par _vttDeleteToken
  let isDuplicate = false;
  if (key) {
    let count = 0;
    for (const e of Object.values(_tokens)) {
      const d = e.data;
      if ((d.characterId && d.characterId === t.characterId) ||
          (d.npcId && d.npcId === t.npcId)) count++;
      if (count > 1) { isDuplicate = true; break; }
    }
  }
  await _persistInvocationState(t);   // sauvegarde PV/PM si c'est une invocation
  try {
    if (isDuplicate) {
      await deleteDoc(_tokRef(tokenId));
      _tokens[tokenId]?.shape?.destroy();
      delete _tokens[tokenId];
    } else {
      await updateDoc(_tokRef(tokenId),{pageId:null,visible:false});
      const entry = _tokens[tokenId];
      if (entry) {
        entry.shape?.destroy();
        _tokens[tokenId] = { data: { ...entry.data, pageId:null, visible:false }, shape:null };
      }
    }
  } catch (e) {
    console.error('[vtt] retire token:', e);
    showNotif('Erreur lors du retrait du token', 'error');
    return;
  }
  if (_selected===tokenId) _deselect();
  _layers.token?.batchDraw();
  _renderTraySoon();
  void _cleanupReserveDuplicates();
}
// Le joueur invoque son propre token sur la carte active
async function _vttInvokeMyToken() {
  if (!_activePage) { showNotif('Aucune carte active','error'); return; }
  const uid = STATE.user?.uid; if (!uid) return;
  const tok = Object.values(_tokens).find(e => e.data?.ownerId === uid)?.data;
  if (!tok) { showNotif('Aucun token associé à ton personnage','error'); return; }
  const cC = Math.floor(_activePage.cols/2), cR = Math.floor(_activePage.rows/2);
  await updateDoc(_tokRef(tok.id),{pageId:_activePage.id,col:cC,row:cR,visible:true})
    .catch(err => { console.error('[vtt] invocation:', err); showNotif('Erreur invocation','error'); });
}
// Le joueur range son propre token (le renvoie en réserve, sans le supprimer)
async function _vttRetireMyToken() {
  const uid = STATE.user?.uid; if (!uid) return;
  const tok = Object.values(_tokens).find(e => e.data?.ownerId === uid)?.data;
  if (!tok) { showNotif('Aucun token associé à ton personnage','error'); return; }
  if (!tok.pageId) return; // déjà rangé
  await updateDoc(_tokRef(tok.id),{pageId:null,visible:false})
    .catch(err => { console.error('[vtt] rangement:', err); showNotif('Erreur rangement','error'); });
  if (_selected===tok.id) _deselect();
}
// Déplacer le token vers une autre page
async function _vttMoveTokenToPage(tokenId,pageId) {
  if (!pageId) return;
  await updateDoc(_tokRef(tokenId),{pageId}).catch(()=>{});
}
// Sélectionner depuis le tray (place si non placé)
function _vttSelectFromTray(id) {
  const t=_tokens[id]?.data; if (!t) return;
  if (!t.pageId&&STATE.isAdmin) { _vttPlace(id); return; }
  if (t.pageId===_activePage?.id) _select(id);
}
async function _vttToggleVisible(id) {
  const t=_tokens[id]?.data; if (!t) return;
  await updateDoc(_tokRef(id),{visible:!t.visible}).catch(()=>{});
}
async function _vttClearBuffs(id) {
  if (!STATE.isAdmin) return;
  const t=_tokens[id]?.data; if (!t) return;
  await updateDoc(_tokRef(id),{buffs:[]}).catch(()=>{});
  showNotif('Buffs supprimés.','success');
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLERS — Conditions (états) sur les tokens
// ══════════════════════════════════════════════════════════════════════════════
/** Ouvre la modal de sélection d'un état à appliquer. */
function getVttConditionLibrary() {
  return CONDITION_LIBRARY.map(c => ({
    id: c.id, label: c.label, icon: c.icon, color: c.color,
  }));
}

function _conditionSpellUsage(c = {}) {
  const su = c.spellUsage;
  return {
    enchantment: !!su?.enchantment,
    affliction: !!su?.affliction,
  };
}
async function _vttEnsureConditionsLoaded() {
  if (CONDITION_LIBRARY.length <= CONDITION_DEFAULT_LIBRARY.length) {
    await _loadConditionsOverrides().catch(() => {});
  }
  return getVttConditionLibrary();
}

function _vttConditionAdd(tokenId) {
  if (!STATE.isAdmin) return;
  openModal('⚡ Appliquer un état', `
    <div class="vtt-cond-picker">
      ${CONDITION_LIBRARY.map(c => `
        <button class="vtt-cond-pick" style="--cond-c:${c.color}"
          data-vtt-fn="_vttConditionApply" data-vtt-args="${tokenId}|${c.id}">
          <span class="vtt-cond-pick-ic">${c.icon}</span>
          <div class="vtt-cond-pick-body">
            <div class="vtt-cond-pick-nom">${c.label}</div>
            <div class="vtt-cond-pick-desc">${c.desc}</div>
          </div>
        </button>
      `).join('')}
    </div>
    <div style="font-size:.7rem;color:var(--text-dim);font-style:italic;margin-top:.5rem">
      Durée par défaut : 2 tours en combat (1 coup pour les états « on hit »). Modifiable via ✏️ dans l'inspector.
    </div>
  `);
}

/** Applique l'état avec les défauts de la librairie (DC + stat préremplis),
 *  puis ouvre la modal d'édition pour ajuster source/durée si besoin. */
async function _vttConditionApply(tokenId, condId) {
  const lib = CONDITION_BY_ID[condId]; if (!lib) return;
  const t = _tokens[tokenId]?.data; if (!t) return;
  // Évite les doublons (même état déjà appliqué)
  const existing = (t.conditions || []).some(c => c.id === condId);
  if (existing) {
    showNotif(`${lib.icon} ${lib.label} déjà appliqué`, 'info');
    closeModalDirect();
    return;
  }
  // Durée par défaut : valeur définie sur l'état (defaultDuration), sinon
  // 2 tours par convention. Ignorée pour les états qui se consomment au 1er coup.
  const round = _session?.combat?.round ?? 0;
  const isConsumed = !!lib.effects?.consumedByAttackAgainst;
  const dur = Number.isFinite(lib.defaultDuration) && lib.defaultDuration > 0
    ? lib.defaultDuration
    : 2;
  // Hors combat (round=0) : on stocke pendingDuration pour différer le calcul
  // à l'ouverture du combat. Sinon l'état durerait à l'infini.
  const expiresAtRound = (round > 0 && !isConsumed && dur > 0) ? round + dur - 1 : null;
  const pendingDuration = (round === 0 && !isConsumed && dur > 0) ? dur : null;
  const cond = {
    id: condId,
    appliedAt: Date.now(),
    appliedBy: STATE.user?.uid || null,
    source: '',
    saveDC: lib.defaultSaveStat ? (lib.defaultDC || 11) : null,
    saveStat: lib.defaultSaveStat || null,
    expiresAtRound,
    ...(pendingDuration != null ? { pendingDuration } : {}),
  };
  const newConds = [...(t.conditions || []), cond];
  await updateDoc(_tokRef(tokenId), { conditions: newConds }).catch(() => {});
  closeModalDirect();
  const durLbl = isConsumed ? ' (1 coup)'
    : (expiresAtRound != null || pendingDuration != null) ? ` (${dur} tour${dur>1?'s':''})` : '';
  showNotif(`${lib.icon} ${lib.label} appliqué${durLbl}`, 'success');
  _renderInspectorSoon?.();
}

/** Retire un état du token (par index dans le tableau). */
async function _vttConditionRemove(tokenId, idx) {
  if (!STATE.isAdmin) return;
  const t = _tokens[tokenId]?.data; if (!t) return;
  const conds = [...(t.conditions || [])];
  const removed = conds[idx]; if (!removed) return;
  conds.splice(idx, 1);
  await updateDoc(_tokRef(tokenId), { conditions: conds }).catch(() => {});
  const lib = CONDITION_BY_ID[removed.id];
  if (lib) showNotif(`${lib.icon} ${lib.label} retiré`, 'info');
}

/** Lance un jet de sauvegarde pour tenter de finir l'état. */
async function _vttConditionSave(tokenId, idx) {
  const t = _tokens[tokenId]?.data; if (!t) return;
  const cond = (t.conditions || [])[idx]; if (!cond) return;
  const lib = CONDITION_BY_ID[cond.id];
  const statKey = cond.saveStat || 'constitution';
  const DD = cond.saveDC || 11;
  const mod = c => getMod(c, statKey);
  // Récupère le perso ou NPC source des stats
  const ch = t.characterId ? _characters[t.characterId] : null;
  const np = t.npcId ? _npcs[t.npcId] : null;
  const statSrc = ch || np || { stats: {} };
  const modVal = ch || np ? mod(statSrc) : 0;
  const d20 = Math.floor(Math.random()*20)+1;
  const total = d20 + modVal;
  const passed = d20 !== 1 && (d20 === 20 || total >= DD);
  const statLbl = statShort(statKey) || statKey;
  showNotif(`🎲 JS ${statLbl} : d20[${d20}]${modVal>=0?'+':''}${modVal} = ${total} vs DD ${DD} → ${passed?'✅ Réussi — état retiré':'❌ Échec'}`, passed?'success':'error');
  // Log
  await addDoc(_logCol(), {
    type: 'save', authorId: STATE.user?.uid||null,
    authorName: STATE.profile?.pseudo||STATE.profile?.prenom||'?',
    tokenName: _live(t).displayName || t.name,
    conditionId: cond.id, conditionLabel: lib?.label || cond.id,
    statLabel: statLbl, mod: modVal, d20, total, dd: DD, passed,
    createdAt: serverTimestamp(),
  }).catch(()=>{});
  if (passed) {
    const conds = [...(t.conditions || [])]; conds.splice(idx, 1);
    await updateDoc(_tokRef(tokenId), { conditions: conds }).catch(() => {});
  }
}

/** Modal d'édition d'un état (source / DD / stat / durée). */
function _vttConditionEdit(tokenId, idx) {
  if (!STATE.isAdmin) return;
  const t = _tokens[tokenId]?.data; if (!t) return;
  const cond = (t.conditions || [])[idx]; if (!cond) return;
  const lib = CONDITION_BY_ID[cond.id] || { label: cond.id, icon: '❓' };
  const round = _session?.combat?.round ?? 0;
  const turnsLeft = cond.expiresAtRound != null && round > 0
    ? (cond.expiresAtRound - round + 1)
    : (cond.expiresAtRound != null ? 0 : '');
  openModal(`✏️ ${lib.icon} ${lib.label}`, `
    <div class="vtt-cond-edit">
      <div class="form-group">
        <label>Source / Origine</label>
        <input class="input-field" id="ce-source" value="${_esc(cond.source||'')}" placeholder="Ex: Lacération de l'orc, gaz toxique…">
      </div>
      <div class="form-group" style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem">
        <div>
          <label>DD du jet de sauvegarde</label>
          <input type="number" class="input-field" id="ce-dd" value="${cond.saveDC||''}" placeholder="ex: 11">
        </div>
        <div>
          <label>Stat du jet</label>
          <select class="input-field" id="ce-stat">
            <option value="">— Aucun JS —</option>
            <option value="force"        ${cond.saveStat==='force'?'selected':''}>Force</option>
            <option value="dexterite"    ${cond.saveStat==='dexterite'?'selected':''}>Dextérité</option>
            <option value="constitution" ${cond.saveStat==='constitution'?'selected':''}>Constitution</option>
            <option value="intelligence" ${cond.saveStat==='intelligence'?'selected':''}>Intelligence</option>
            <option value="sagesse"      ${cond.saveStat==='sagesse'?'selected':''}>Sagesse</option>
            <option value="charisme"     ${cond.saveStat==='charisme'?'selected':''}>Charisme</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Durée (tours restants) <span style="font-size:.7rem;color:var(--text-dim)">— vide = jusqu'à dissipation manuelle</span></label>
        <input type="number" class="input-field" id="ce-turns" value="${turnsLeft}" min="0" max="100" placeholder="∞">
      </div>
      <button class="btn btn-gold" style="width:100%;margin-top:.5rem"
        data-vtt-fn="_vttConditionEditSave" data-vtt-args="${tokenId}|${idx}">💾 Enregistrer</button>
    </div>
  `);
}

async function _vttConditionEditSave(tokenId, idx) {
  const t = _tokens[tokenId]?.data; if (!t) return;
  const cond = (t.conditions || [])[idx]; if (!cond) return;
  const source = document.getElementById('ce-source')?.value?.trim() || '';
  const saveDC = parseInt(document.getElementById('ce-dd')?.value) || null;
  const saveStat = document.getElementById('ce-stat')?.value || null;
  const turns = parseInt(document.getElementById('ce-turns')?.value) || 0;
  const round = _session?.combat?.round ?? 0;
  const expiresAtRound = turns > 0 && round > 0 ? round + turns - 1 : null;
  const conds = [...(t.conditions || [])];
  conds[idx] = { ...cond, source, saveDC, saveStat: saveDC ? saveStat : null, expiresAtRound };
  await updateDoc(_tokRef(tokenId), { conditions: conds }).catch(() => {});
  closeModalDirect();
  showNotif('État mis à jour', 'success');
}

// ══════════════════════════════════════════════════════════════════════════════
// RÉGLAGES DES ÉTATS — modal accessible via le bouton ⚙ de la section États
// Sauvegardé dans world/conditions → utilisable sur toutes les aventures.
// Surcharge la librairie par défaut au chargement (loadConditions).
// ══════════════════════════════════════════════════════════════════════════════
async function _loadConditionsOverrides() {
  CONDITION_LIBRARY = await loadConditionLibrary({ refresh: true, seedDefaults: STATE.isAdmin });
  _rebuildConditionIndex();
}

async function _vttConditionConfig(opts = {}) {
  if (!STATE.isAdmin) return;
  // S'assure que les overrides MJ sont chargés (utile quand on l'appelle depuis
  // la Console MJ sans avoir encore ouvert le VTT cette session).
  // skipReload : utilisé après un ajout/édition local en mémoire pour ne pas
  // écraser les changements non encore persistés avec les données de Firestore.
  if (!opts.skipReload) {
    await _loadConditionsOverrides().catch(() => {});
  }

  const STATS = [
    ['', '—'], ['force','For'], ['dexterite','Dex'],
    ['constitution','Con'], ['intelligence','Int'],
    ['sagesse','Sag'], ['charisme','Cha'],
  ];
  // Pill toggle 3 options : —/Avantage/Désavantage
  const advTriToggle = (id, current) => {
    const opts = [
      ['',    '—',    'none'],
      ['adv', '⬆ Adv', 'adv'],
      ['dis', '⬇ Dis', 'dis'],
    ];
    return `<div class="vtt-cc-tri" data-cc-tri-id="${id}" data-cc-tri-value="${current||''}">
      ${opts.map(([v, lbl, cls]) => `
        <button type="button" class="vtt-cc-tri-opt vtt-cc-tri-${cls} ${(current||'')===v?'is-on':''}"
          data-vtt-fn="_vttCcTriSet" data-vtt-args="$this|${v}">${lbl}</button>
      `).join('')}
    </div>`;
  };
  // Pill bool toggle (flag)
  const boolToggle = (id, label, on) =>
    `<button type="button" class="vtt-cc-flag-pill ${on?'is-on':''}" data-cc-flag-id="${id}"
       data-vtt-fn="_vttCcFlagToggle" data-vtt-args="$this">
       <span class="vtt-cc-flag-check">${on?'✓':'○'}</span><span>${label}</span>
     </button>`;

  // Compte les effets actifs (pour le badge dans la liste)
  const _countActiveEffects = (eff = {}) =>
    [eff.attackBy, eff.attackAgainst, eff.attackAgainstMelee, eff.attackAgainstRanged]
      .filter(v => v === 'adv' || v === 'dis').length
    + (eff.movementMod === 0 ? 1 : 0)
    + (eff.cantAct ? 1 : 0) + (eff.failsStrSaves ? 1 : 0)
    + (eff.failsDexSaves ? 1 : 0) + (eff.meleeCritOnHit ? 1 : 0);

  // Liste à gauche (compacte, scrollable) + bouton création
  const addBtn = `<button type="button" class="vtt-cc-list-add"
      data-vtt-fn="_vttConditionConfigAddNew">＋ Nouvel état</button>`;
  const listItems = addBtn + CONDITION_LIBRARY.map((c, idx) => {
    const count = _countActiveEffects(c.effects || {});
    const isCustom = _isCustomCondition(c.id);
    return `<button type="button" class="vtt-cc-list-item ${idx === 0 ? 'is-active' : ''} ${isCustom ? 'is-custom' : ''}"
        style="--cond-c:${c.color}"
        data-vtt-fn="_vttConditionConfigSelect" data-vtt-args="${idx}"
        title="${isCustom ? 'État personnalisé' : ''}">
      <span class="vtt-cc-list-ic">${c.icon}</span>
      <span class="vtt-cc-list-nom">${_esc(c.label)}</span>
      ${count ? `<span class="vtt-cc-list-cnt">${count}</span>` : ''}
    </button>`;
  }).join('');

  // Détails à droite (tous rendus, seul l'index 0 visible)
  const details = CONDITION_LIBRARY.map((c, idx) => {
    const eff = c.effects || {};
    const usage = _conditionSpellUsage(c);
    const statOpts = STATS.map(([v, l]) =>
      `<option value="${v}" ${(c.defaultSaveStat||'')===v?'selected':''}>${l}</option>`).join('');
    const isCustom = _isCustomCondition(c.id);
    return `<div class="vtt-cc-detail ${idx === 0 ? 'is-active' : ''}"
        id="vtt-cc-detail-${idx}" style="--cond-c:${c.color}">
      <div class="vtt-cc-detail-hd">
        <input type="text" class="input-field vtt-cc-detail-icon"
          id="cc-${idx}-icon" value="${_esc(c.icon || '')}" maxlength="3"
          title="Emoji ou caractère affiché sur le token"
          style="width:46px;text-align:center;font-size:1.3rem;padding:.3rem">
        <div class="vtt-cc-detail-titles">
          <input type="text" class="input-field vtt-cc-detail-label"
            id="cc-${idx}-label" value="${_esc(c.label)}" placeholder="Nom de l'état">
          <span class="vtt-cc-detail-id">id : <code>${c.id}</code>${isCustom ? ' · personnalisé' : ''}</span>
        </div>
        <input type="color" class="vtt-cc-color-pick" id="cc-${idx}-color"
          value="${c.color}" title="Couleur de l'état">
        ${isCustom ? `<button type="button" class="vtt-cc-detail-del"
          data-vtt-fn="_vttConditionConfigDelete" data-vtt-args="${idx}"
          title="Supprimer cet état personnalisé">🗑</button>` : ''}
      </div>

      <div class="vtt-cc-grp">
        <div class="vtt-cc-grp-title">📖 Description / règles narratives</div>
        <textarea class="input-field" id="cc-${idx}-desc" rows="3"
          placeholder="Effet narratif et règles racontées au joueur…">${_esc(c.desc||'')}</textarea>
      </div>

      <div class="vtt-cc-grp">
        <div class="vtt-cc-grp-title">✨ Utilisation dans les sorts</div>
        <div class="vtt-cc-grp-hint">Détermine dans quels sélecteurs de la modal de sort cet état apparaît.</div>
        <div class="vtt-cc-flags-pills">
          ${boolToggle(`cc-${idx}-useEnchant`, '✨ Enchantement', usage.enchantment)}
          ${boolToggle(`cc-${idx}-useAffliction`, '💀 Affliction', usage.affliction)}
        </div>
      </div>

      <div class="vtt-cc-grp">
        <div class="vtt-cc-grp-title">🎲 Jet de sauvegarde par défaut</div>
        <div class="vtt-cc-grp-hint">Pré-rempli quand le MJ applique l'état. Modifiable au cas par cas.</div>
        <div class="vtt-cc-save-grid">
          <label><span>Caractéristique du jet</span>
            <select class="input-field" id="cc-${idx}-stat">${statOpts}</select>
          </label>
          <label><span>DD par défaut</span>
            <input type="number" class="input-field" id="cc-${idx}-dc"
              value="${c.defaultDC ?? ''}" min="0" max="30" placeholder="—">
          </label>
        </div>
      </div>

      <div class="vtt-cc-grp">
        <div class="vtt-cc-grp-title">⏱ Durée par défaut</div>
        <div class="vtt-cc-grp-hint">Nombre de tours en combat à l'application. Vide / 0 = jusqu'à dissipation manuelle. Ignoré si l'état se consomme au 1er coup.</div>
        <input type="number" class="input-field" id="cc-${idx}-duration"
          value="${c.defaultDuration ?? ''}" min="0" max="100" placeholder="ex: 2"
          style="max-width:140px">
      </div>

      <div class="vtt-cc-grp">
        <div class="vtt-cc-grp-title">⚔️ Effets sur les jets d'attaque</div>
        <div class="vtt-cc-grp-hint">Avantage / Désavantage automatique appliqué en combat.</div>
        <div class="vtt-cc-adv-grid">
          <div class="vtt-cc-adv-row">
            <span class="vtt-cc-adv-lbl">Quand <strong>il attaque</strong></span>
            ${advTriToggle(`cc-${idx}-atkBy`, eff.attackBy)}
          </div>
          <div class="vtt-cc-adv-row">
            <span class="vtt-cc-adv-lbl">Quand <strong>on l'attaque</strong></span>
            ${advTriToggle(`cc-${idx}-atkAg`, eff.attackAgainst)}
          </div>
          <div class="vtt-cc-adv-row">
            <span class="vtt-cc-adv-lbl">Attaque <strong>CaC</strong> contre <small>(≤1,5m)</small></span>
            ${advTriToggle(`cc-${idx}-atkAgM`, eff.attackAgainstMelee)}
          </div>
          <div class="vtt-cc-adv-row">
            <span class="vtt-cc-adv-lbl">Attaque <strong>à distance</strong> contre</span>
            ${advTriToggle(`cc-${idx}-atkAgR`, eff.attackAgainstRanged)}
          </div>
        </div>
      </div>

      <div class="vtt-cc-grp">
        <div class="vtt-cc-grp-title">🚷 Restrictions & effets spéciaux</div>
        <div class="vtt-cc-grp-hint">Clique pour activer / désactiver. Plusieurs peuvent être cumulés.</div>
        <div class="vtt-cc-flags-pills">
          ${boolToggle(`cc-${idx}-movementZero`, '🚷 Vitesse 0',           eff.movementMod === 0)}
          ${boolToggle(`cc-${idx}-cantAct`,      '💤 Ne peut pas agir',   !!eff.cantAct)}
          ${boolToggle(`cc-${idx}-cantCast`,     '🤐 Ne peut pas lancer de sort', !!eff.cantCastSpells)}
          ${boolToggle(`cc-${idx}-failsStr`,     '❌ Échec JS Force',     !!eff.failsStrSaves)}
          ${boolToggle(`cc-${idx}-failsDex`,     '❌ Échec JS Dextérité', !!eff.failsDexSaves)}
          ${boolToggle(`cc-${idx}-meleeCrit`,    '💥 CaC ≤1,5m = critique', !!eff.meleeCritOnHit)}
          ${boolToggle(`cc-${idx}-consumed`,     '🎯 Se consomme au 1er coup encaissé', !!eff.consumedByAttackAgainst)}
        </div>
      </div>

      <div class="vtt-cc-grp">
        <div class="vtt-cc-grp-title">💢 Dégâts subis bonus</div>
        <div class="vtt-cc-grp-hint">Dés/valeur ajoutés aux dégâts reçus par la cible portant l'état (ex: <code>1d6</code> ou <code>4</code>).</div>
        <input type="text" class="input-field" id="cc-${idx}-dmgTaken"
          value="${_esc(eff.dmgTakenBonus || '')}" placeholder="—" maxlength="20"
          style="max-width:160px">
      </div>

      <div class="vtt-cc-grp">
        <div class="vtt-cc-grp-title">🛡 Réduction des dégâts subis</div>
        <div class="vtt-cc-grp-hint">Pourcentage des dégâts reçus annulé (0 = aucun effet, 50 = demi-dégâts, 100 = immunité totale).</div>
        <input type="number" class="input-field" id="cc-${idx}-dmgReduc"
          value="${eff.dmgReductionPct ?? ''}" min="0" max="100" placeholder="—"
          style="max-width:140px">
      </div>
    </div>`;
  }).join('');

  openModal('🎭 Réglages des états', `
    <div class="vtt-cc-modal vtt-cc-modal--master">
      <div class="vtt-cc-intro">
        Chaque état appliqué utilise ces réglages par défaut. Tu peux les ajuster au cas par cas via ✏️ dans l'inspector. Sélectionne un état dans la liste pour configurer ses effets.
      </div>
      <div class="vtt-cc-layout">
        <aside class="vtt-cc-list">${listItems}</aside>
        <section class="vtt-cc-details">${details}</section>
      </div>
      <div class="vtt-cc-footer">
        <button class="btn btn-outline" data-vtt-fn="_vttConditionConfigReset">↺ Réinitialiser aux défauts</button>
        <button class="btn btn-gold" data-vtt-fn="_vttConditionConfigSave">💾 Enregistrer</button>
      </div>
    </div>
  `);
}

/** Sélectionne un état dans la modal de réglages (left list → swap right detail). */
function _vttConditionConfigSelect(idx) {
  document.querySelectorAll('.vtt-cc-list-item').forEach((b, i) => {
    b.classList.toggle('is-active', i === idx);
  });
  document.querySelectorAll('.vtt-cc-detail').forEach((d, i) => {
    d.classList.toggle('is-active', i === idx);
  });
  // Scroll top du détail
  document.querySelector('.vtt-cc-details')?.scrollTo({ top: 0, behavior: 'smooth' });
}

function _vttReadConditionConfigEntry(c, idx) {
  const get = (k) => document.getElementById(`cc-${idx}-${k}`);
  const triVal = (id) => document.querySelector(`[data-cc-tri-id="${id}"]`)?.dataset.ccTriValue || '';
  const flagOn = (id) => document.querySelector(`[data-cc-flag-id="${id}"]`)?.classList.contains('is-on');
  const eff = {};
  const atkBy  = triVal(`cc-${idx}-atkBy`);  if (atkBy)  eff.attackBy = atkBy;
  const atkAg  = triVal(`cc-${idx}-atkAg`);  if (atkAg)  eff.attackAgainst = atkAg;
  const atkAgM = triVal(`cc-${idx}-atkAgM`); if (atkAgM) eff.attackAgainstMelee  = atkAgM;
  const atkAgR = triVal(`cc-${idx}-atkAgR`); if (atkAgR) eff.attackAgainstRanged = atkAgR;
  if (flagOn(`cc-${idx}-movementZero`)) eff.movementMod = 0;
  if (flagOn(`cc-${idx}-cantAct`))      eff.cantAct = true;
  if (flagOn(`cc-${idx}-cantCast`))     eff.cantCastSpells = true;
  if (flagOn(`cc-${idx}-failsStr`))     eff.failsStrSaves = true;
  if (flagOn(`cc-${idx}-failsDex`))     eff.failsDexSaves = true;
  if (flagOn(`cc-${idx}-meleeCrit`))    eff.meleeCritOnHit = true;
  if (flagOn(`cc-${idx}-consumed`))     eff.consumedByAttackAgainst = true;
  const dmgTaken = get('dmgTaken')?.value?.trim();
  if (dmgTaken) eff.dmgTakenBonus = dmgTaken;
  const dmgReduc = parseInt(get('dmgReduc')?.value);
  if (Number.isFinite(dmgReduc) && dmgReduc > 0) eff.dmgReductionPct = Math.min(100, dmgReduc);
  const dc = parseInt(get('dc')?.value);
  const stat = get('stat')?.value || null;
  const dur = parseInt(get('duration')?.value);
  return {
    ...c,
    label: get('label')?.value?.trim() || c.label,
    icon:  get('icon')?.value?.trim() || c.icon,
    color: get('color')?.value?.trim() || c.color,
    desc:  get('desc')?.value ?? c.desc,
    defaultSaveStat: stat,
    defaultDC: Number.isFinite(dc) && dc > 0 ? dc : null,
    defaultDuration: Number.isFinite(dur) && dur > 0 ? dur : null,
    spellUsage: {
      enchantment: !!flagOn(`cc-${idx}-useEnchant`),
      affliction: !!flagOn(`cc-${idx}-useAffliction`),
    },
    effects: eff,
  };
}
async function _vttConditionConfigSave() {
  if (!STATE.isAdmin) return;
  const newLib = CONDITION_LIBRARY.map((c, idx) => _vttReadConditionConfigEntry(c, idx));
  try {
    await saveDoc('world', 'conditions', { library: newLib });
    CONDITION_LIBRARY = newLib;
    _rebuildConditionIndex();
    showNotif('✅ Réglages des états enregistrés', 'success');
    closeModalDirect();
  } catch (e) {
    showNotif('Erreur sauvegarde : ' + (e?.message || e), 'error');
  }
}

async function _vttConditionConfigReset() {
  if (!STATE.isAdmin) return;
  if (!await confirmModal(
    'Remettre tous les états aux valeurs par défaut ? Les overrides MJ et les états personnalisés seront effacés.',
    { title: '↺ Réinitialiser ?', confirmLabel: 'Réinitialiser', danger: true, icon: '↺' }
  )) return;
  try {
    await saveDoc('world', 'conditions', { library: [] });
    CONDITION_LIBRARY = await loadConditionLibrary({ refresh: true });
    _rebuildConditionIndex();
    closeModalDirect();
    showNotif('↺ Réglages remis aux défauts', 'success');
    // Réouvrir pour confirmation visuelle
    setTimeout(() => _vttConditionConfig(), 100);
  } catch {}
}

/** Ajoute un nouvel état personnalisé à la lib en mémoire et réouvre la modale dessus.
 *  La persistance se fait quand le MJ clique sur Enregistrer. */
async function _vttConditionConfigAddNew() {
  if (!STATE.isAdmin) return;
  // Capture les modifs en cours dans la modale avant de la fermer/rouvrir
  const _capture = () => {
    CONDITION_LIBRARY = CONDITION_LIBRARY.map((c, idx) => (
      document.getElementById(`cc-${idx}-label`) ? _vttReadConditionConfigEntry(c, idx) : c
    ));
  };
  try { _capture(); } catch {}

  const newId = `custom_${Date.now().toString(36)}`;
  CONDITION_LIBRARY.push({
    id: newId,
    label: 'Nouvel état',
    icon: '✨',
    color: '#9ca3af',
    desc: '',
    defaultSaveStat: null,
    defaultDC: 11,
    spellUsage: { enchantment: false, affliction: false },
    effects: {},
  });
  _rebuildConditionIndex();
  closeModalDirect();
  // Réouvre SANS reload Firestore (la nouvelle entrée n'est pas encore persistée,
  // un reload l'écraserait → bug "+ Nouvel état n'ajoute qu'une fois")
  setTimeout(async () => {
    await _vttConditionConfig({ skipReload: true });
    const lastIdx = CONDITION_LIBRARY.length - 1;
    _vttConditionConfigSelect(lastIdx);
    // Focus l'input label pour rename direct
    document.getElementById(`cc-${lastIdx}-label`)?.focus();
    document.getElementById(`cc-${lastIdx}-label`)?.select();
  }, 80);
}

/** Supprime un état personnalisé (non-default). Persistance immédiate. */
async function _vttConditionConfigDelete(idx) {
  if (!STATE.isAdmin) return;
  const c = CONDITION_LIBRARY[idx]; if (!c) return;
  if (!_isCustomCondition(c.id)) {
    showNotif('Les états par défaut ne peuvent pas être supprimés', 'warning');
    return;
  }
  if (!await confirmModal(
    `Supprimer l'état « ${c.label} » ? Les tokens qui le portent garderont la donnée mais elle ne sera plus reconnue.`,
    { title: `🗑 Supprimer ${c.label} ?`, confirmLabel: 'Supprimer', danger: true, icon: '🗑' }
  )) return;
  CONDITION_LIBRARY = CONDITION_LIBRARY.filter((_, i) => i !== idx);
  _rebuildConditionIndex();
  try {
    // Persiste l'état actuel de la lib (sans le state supprimé)
    // On ne sauvegarde QUE les non-défauts modifiés + customs restants
    const toSave = CONDITION_LIBRARY.filter(c2 =>
      _isCustomCondition(c2.id) || true /* keep all so future loads merge correctly */);
    await saveDoc('world', 'conditions', { library: toSave });
    closeModalDirect();
    showNotif('🗑 État supprimé', 'success');
    setTimeout(() => _vttConditionConfig(), 80);
  } catch (e) {
    showNotif('Erreur suppression : ' + (e?.message || e), 'error');
  }
}

/** Helper : true si le token porte un état actif dont l'effet `effectKey` est truthy. */
function _hasConditionEffect(token, effectKey) {
  const round = _session?.combat?.round ?? 0;
  for (const c of (token?.conditions || [])) {
    if (c.expiresAtRound != null && round > 0 && round > c.expiresAtRound) continue;
    const eff = CONDITION_BY_ID[c.id]?.effects;
    if (eff && eff[effectKey]) return true;
  }
  return false;
}

/** Helper : retourne la liste des états actifs sur un token (objets {cond, lib}). */
function _activeConditionsOf(token) {
  const round = _session?.combat?.round ?? 0;
  const out = [];
  for (const c of (token?.conditions || [])) {
    if (c.expiresAtRound != null && round > 0 && round > c.expiresAtRound) continue;
    const lib = CONDITION_BY_ID[c.id]; if (!lib) continue;
    out.push({ cond: c, lib });
  }
  return out;
}

/** Helper : retourne les modificateurs avantage/désavantage d'un attaquant et d'une cible
 *  selon leurs états actifs. À appeler par _vttRollAttack. */
function _conditionsAttackMods(srcToken, tgtToken, opt) {
  const isMelee = (opt?.portee || 1) <= 1;
  const round = _session?.combat?.round ?? 0;
  const isActive = c => c.expiresAtRound == null || round === 0 || round <= c.expiresAtRound;

  let hasAdv = false, hasDis = false;
  const reasons = []; // pour log

  // Attaquant : ses propres états affectent ses attaques
  for (const c of (srcToken?.conditions || [])) {
    if (!isActive(c)) continue;
    const eff = CONDITION_BY_ID[c.id]?.effects; if (!eff) continue;
    if (eff.attackBy === 'adv') { hasAdv = true; reasons.push(`+adv (${CONDITION_BY_ID[c.id].label} sur lanceur)`); }
    if (eff.attackBy === 'dis') { hasDis = true; reasons.push(`+dis (${CONDITION_BY_ID[c.id].label} sur lanceur)`); }
  }
  // Cible : ses états affectent les attaques entrantes
  for (const c of (tgtToken?.conditions || [])) {
    if (!isActive(c)) continue;
    const eff = CONDITION_BY_ID[c.id]?.effects; if (!eff) continue;
    if (eff.attackAgainst === 'adv') { hasAdv = true; reasons.push(`+adv (${CONDITION_BY_ID[c.id].label} sur cible)`); }
    if (eff.attackAgainst === 'dis') { hasDis = true; reasons.push(`+dis (${CONDITION_BY_ID[c.id].label} sur cible)`); }
    // À terre : adv si CaC, dis si distance
    if (isMelee && eff.attackAgainstMelee === 'adv')  { hasAdv = true; reasons.push(`+adv (CaC vs ${CONDITION_BY_ID[c.id].label})`); }
    if (isMelee && eff.attackAgainstMelee === 'dis')  { hasDis = true; reasons.push(`+dis (CaC vs ${CONDITION_BY_ID[c.id].label})`); }
    if (!isMelee && eff.attackAgainstRanged === 'adv'){ hasAdv = true; reasons.push(`+adv (dist. vs ${CONDITION_BY_ID[c.id].label})`); }
    if (!isMelee && eff.attackAgainstRanged === 'dis'){ hasDis = true; reasons.push(`+dis (dist. vs ${CONDITION_BY_ID[c.id].label})`); }
  }
  return { hasAdv, hasDis, reasons };
}
/** Déclenche un sort suspendu : marque le sort gratuit puis ouvre le modal d'attaque. */
async function _vttTriggerSuspendedSpell(tokenId, buffIdx) {
  const t = _tokens[tokenId]?.data; if (!t?.buffs?.length) return;
  if (!_canControlToken(t)) return;
  // Index visible (parmi les buffs actifs) → index réel dans t.buffs
  const r = _session?.combat?.round ?? 0;
  const activeIdxs = t.buffs.map((bf, i) => ({ bf, i }))
    .filter(({ bf }) => bf?.expiresAtRound == null || r === 0 || r <= bf.expiresAtRound)
    .map(({ i }) => i);
  const realIdx = activeIdxs[buffIdx];
  const buff = t.buffs[realIdx];
  if (!buff || buff.type !== 'suspended_spell') return;
  // Marque le sort comme gratuit pour le prochain cast
  if (buff.sortIdx != null) _freeNextCast.add(`${tokenId}_${buff.sortIdx}`);
  // Retire le buff suspendu
  const remaining = t.buffs.filter((_, i) => i !== realIdx);
  await updateDoc(_tokRef(tokenId), { buffs: remaining }).catch(() => {});
  // Active le flag pour éviter la re-suspension immédiate
  _suspendedTriggerActive = true;
  try {
    await _execAttack(tokenId, buff.tgtId || tokenId);
  } finally {
    // Le flag reste actif jusqu'à la fin du modal — désactivé par sécurité après 30s
    setTimeout(() => { _suspendedTriggerActive = false; }, 30_000);
  }
}

/** Retire un buff à l'index donné (MJ uniquement). */
async function _vttRemoveBuff(tokenId, idx) {
  if (!STATE.isAdmin) return;
  const t = _tokens[tokenId]?.data; if (!t || !Array.isArray(t.buffs)) return;
  // Recalcule l'index parmi les buffs actifs (pour matcher l'affichage)
  const r = _session?.combat?.round ?? 0;
  const activeIndexes = t.buffs
    .map((bf, i) => ({ bf, i }))
    .filter(({ bf }) => bf?.expiresAtRound == null || r === 0 || r <= bf.expiresAtRound)
    .map(({ i }) => i);
  const realIdx = activeIndexes[idx];
  if (realIdx == null) return;
  const newBuffs = t.buffs.filter((_, i) => i !== realIdx);
  await updateDoc(_tokRef(tokenId), { buffs: newBuffs }).catch(() => {});
  showNotif('Effet retiré', 'info');
}

/** Ouvre une modale simple pour ajouter manuellement un effet sur le token (MJ). */
async function _vttAddBuffPrompt(tokenId) {
  if (!STATE.isAdmin) return;
  const t = _tokens[tokenId]?.data; if (!t) return;
  const TYPES = [
    { v:'ca',          ic:'🛡', lbl:'Bonus CA',         needsBonus:true },
    { v:'dot',         ic:'🩸', lbl:'DoT (dégâts/tour)', needsFormula:true },
    { v:'dmg_bonus',   ic:'⚔️', lbl:'Dégâts bonus arme', needsFormula:true },
    { v:'move_bonus',  ic:'👢', lbl:'Mouvement +',       needsBonus:true },
    { v:'move_debuff', ic:'👢', lbl:'Mouvement −',       needsBonus:true },
    { v:'range_bonus', ic:'🏹', lbl:'Portée +',          needsBonus:true },
    { v:'enchantment', ic:'✨', lbl:'Enchantement (libre)', needsEffect:true },
    { v:'affliction',  ic:'💀', lbl:'Affliction (libre)',   needsEffect:true },
  ];
  const opts = TYPES.map(t => `<option value="${t.v}">${t.ic} ${t.lbl}</option>`).join('');
  openModal(`✨ Ajouter un effet sur ${t.name}`, `
    <div class="vtt-form" style="display:flex;flex-direction:column;gap:.7rem">
      <div class="form-group">
        <label>Type d'effet</label>
        <select id="vab-type" class="input-field" data-vtt-fn="_vttSyncAddBuffRows" data-vtt-on="change" data-vtt-args="$value">${opts}</select>
      </div>
      <div class="form-group">
        <label>Label / nom du sort</label>
        <input id="vab-label" class="input-field" placeholder="ex : Brûlure (Feu)" value="Effet manuel">
      </div>
      <div class="form-group" id="vab-bonus-row">
        <label>Valeur numérique (positive ou négative)</label>
        <input id="vab-bonus" class="input-field" type="number" value="2">
      </div>
      <div class="form-group" id="vab-formula-row" style="display:none">
        <label>Formule de dés</label>
        <input id="vab-formula" class="input-field" placeholder="ex : 1d4 +2" value="1d4 +2">
      </div>
      <div class="form-group" id="vab-effect-row" style="display:none">
        <label>Effet (texte libre)</label>
        <input id="vab-effect" class="input-field" placeholder="ex : Aveuglé, désavantage attaque…">
      </div>
      <div class="form-group">
        <label>Durée (tours · vide = permanent)</label>
        <input id="vab-dur" class="input-field" type="number" value="2" min="0">
      </div>
      <button class="btn btn-gold" data-vtt-fn="_vttConfirmAddBuff" data-vtt-args="${tokenId}">Ajouter</button>
    </div>
  `);
}

function _vttSyncAddBuffRows(type) {
  const meta = {
    ca: { needsBonus: true },
    dot: { needsFormula: true },
    dmg_bonus: { needsFormula: true },
    move_bonus: { needsBonus: true },
    move_debuff: { needsBonus: true },
    range_bonus: { needsBonus: true },
    enchantment: { needsEffect: true },
    affliction: { needsEffect: true },
  }[type] || {};
  document.getElementById('vab-bonus-row').style.display = meta.needsBonus ? '' : 'none';
  document.getElementById('vab-formula-row').style.display = meta.needsFormula ? '' : 'none';
  document.getElementById('vab-effect-row').style.display = meta.needsEffect ? '' : 'none';
}

async function _vttConfirmAddBuff(tokenId) {
  if (!STATE.isAdmin) return;
  const t = _tokens[tokenId]?.data; if (!t) return;
  const type    = document.getElementById('vab-type')?.value || 'ca';
  const label   = document.getElementById('vab-label')?.value?.trim() || 'Effet manuel';
  const bonus   = parseInt(document.getElementById('vab-bonus')?.value) || 0;
  const formula = document.getElementById('vab-formula')?.value?.trim() || '';
  const effect  = document.getElementById('vab-effect')?.value?.trim() || '';
  const durRaw  = document.getElementById('vab-dur')?.value;
  const dur     = durRaw === '' ? null : Math.max(0, parseInt(durRaw) || 0);
  const round = _session?.combat?.round ?? 0;
  const baseRound = Math.max(1, round);
  const ICONS = { ca:'🛡', dot:'🩸', dmg_bonus:'⚔️', move_bonus:'👢', move_debuff:'👢', range_bonus:'🏹', enchantment:'✨', affliction:'💀' };
  const newBuff = {
    type, bonus, formula: formula || undefined, effect: effect || undefined,
    sortLabel: label, icon: ICONS[type] || '✨',
    startRound: round, totalDuration: dur,
    expiresAtRound: dur != null && dur > 0 ? baseRound + dur - 1 : null,
    casterId: null,
  };
  // Slot par défaut pour les types qui en dépendent (dmg_bonus → arme, move_* → pieds)
  if (type === 'dmg_bonus')                       newBuff.slot = 'arme';
  if (type === 'move_bonus' || type === 'move_debuff') newBuff.slot = 'pieds';
  const existing = (t.buffs || []);
  await updateDoc(_tokRef(tokenId), { buffs: [...existing, newBuff] }).catch(() => {});
  closeModalDirect();
  showNotif(`${newBuff.icon} ${label} appliqué`, 'success');
}

async function _vttSetHp(tokenId,hp) {
  const t=_tokens[tokenId]?.data; if (!t) return;
  // Détecte une perte de PV pour déclencher un JS de concentration auto
  const lT = _live(t);
  const prevHp = lT.displayHp ?? t.hp ?? null;
  const newHp  = Math.max(0, hp);
  const delta  = prevHp != null ? Math.max(0, prevHp - newHp) : 0;
  await _setHp(t,hp).catch(()=>{});
  if (delta > 0) {
    const notes = await _vttTriggerConcentrationSave(t, delta);
    notes.forEach(msg => showNotif(msg, msg.startsWith('💢') ? 'error' : 'info'));
  }
}
async function _vttSetPm(tokenId,pm) {
  const t=_tokens[tokenId]?.data; if (!t) return;
  const v=Math.max(0,pm);
  if (t.characterId) await updateDoc(_chrRef(t.characterId),{pm:v}).catch(()=>{});
  else if (t.npcId)  await updateDoc(_npcRef(t.npcId),{pmCurrent:v}).catch(()=>{});
}

// Bonus temporaire manuel (Mouvement / CA / Portée) via le système de BUFFS du
// token. Avantages : déjà intégré dans displayMovement/Defense/Range ET la
// logique de jeu (portée d'attaque, déplacement sur le plateau), et les `buffs`
// sont écrivables par le joueur ET le MJ (règle Firestore vttTokens).
const _MS_BONUS_BUFF = {
  vitesse: { type: 'move_bonus',  icon: '👢' },
  ca:      { type: 'ca',          icon: '🛡' },
  portee:  { type: 'range_bonus', icon: '🏹' },
}
// Lit la valeur du buff manuel d'un type donné sur un token.
function _manualBuffVal(t, key) {
  const cfg = _MS_BONUS_BUFF[key]; if (!cfg) return 0;
  const b = (t?.buffs || []).find(x => x && x.type === cfg.type && x.manual);
  return b ? (parseInt(b.bonus) || 0) : 0;
}
async function _vttTokenBonus(tokenId, key, delta) {
  const t = _tokens[tokenId]?.data; if (!t) return;
  if (!_canControlToken(t)) return;
  const cfg = _MS_BONUS_BUFF[key]; if (!cfg) return;
  const d = parseInt(delta) || 0;
  const buffs = (t.buffs || []).map(b => ({ ...b }));
  const idx = buffs.findIndex(b => b && b.type === cfg.type && b.manual);
  const cur = idx >= 0 ? (parseInt(buffs[idx].bonus) || 0) : 0;
  const next = Math.max(-50, Math.min(50, cur + d));
  if (idx >= 0) {
    if (next === 0) buffs.splice(idx, 1);
    else buffs[idx].bonus = next;
  } else if (next !== 0) {
    buffs.push({ type: cfg.type, bonus: next, manual: true, icon: cfg.icon, label: 'Bonus du tour', expiresAtRound: null });
  }
  if (_tokens[tokenId]) _tokens[tokenId].data = { ...t, buffs }; // optimiste
  await updateDoc(_tokRef(tokenId), { buffs }).catch(() => {});
  _renderInspector(_tokens[tokenId]?.data || t);
  _patchShape(tokenId);
}
async function _vttTokenResetBonus(tokenId) {
  const t = _tokens[tokenId]?.data; if (!t) return;
  if (!_canControlToken(t)) return;
  const buffs = (t.buffs || []).filter(b => !(b && b.manual));
  if (_tokens[tokenId]) _tokens[tokenId].data = { ...t, buffs };
  await updateDoc(_tokRef(tokenId), { buffs }).catch(() => {});
  _renderInspector(_tokens[tokenId]?.data || t);
  _patchShape(tokenId);
}

async function _vttMsSetXp(charId, uid, xp) {
  if (!_msCanEdit(uid)) return;
  const c = _characters[charId]; if (!c) return;
  const val = Math.max(0, Math.round(xp));
  await updateDoc(_chrRef(charId), { exp: val }).catch(() => {});
  c.exp = val;
  _renderMiniSheet(uid);
}

async function _vttMsAddXp(charId, uid, delta) {
  if (!_msCanEdit(uid)) return;
  const c = _characters[charId]; if (!c) return;
  const d = Math.round(delta);
  if (!d || d <= 0) return;
  const newXp = Math.max(0, (parseInt(c.exp) || 0) + d);
  await updateDoc(_chrRef(charId), { exp: newXp }).catch(() => {});
  c.exp = newXp;
  _renderMiniSheet(uid);
}

async function _vttMsSetNiveau(charId, uid, niveau) {
  if (!_msCanEdit(uid)) return;
  const c = _characters[charId]; if (!c) return;
  const val = Math.max(1, Math.min(20, Math.round(niveau)));
  await updateDoc(_chrRef(charId), { niveau: val }).catch(() => {});
  c.niveau = val;
  _renderMiniSheet(uid);
}
function _vttEditToken(id) { return _openStatsModal(_tokens[id]?.data??null); }

// ═══════════════════════════════════════════════════════════════════
// DÉLÉGATION DE CONTRÔLE — autoriser d'autres joueurs sur son token
// ═══════════════════════════════════════════════════════════════════
// Construit un descripteur enrichi d'un membre {uid, pseudo, charName, photo, aura, isAdmin, isGhost}
// isGhost = compte présent dans adventure.players mais sans aucun personnage rattaché
//           ET qui n'est pas admin → résidu de base de données, à ne pas proposer.
function _vttMemberInfo(uid) {
  const adv = STATE.adventure || {};
  const ch = Object.values(_characters || {}).find(c => c?.uid === uid);
  const isAdmin = (adv.admins || []).includes(uid);
  return {
    uid,
    pseudo:   ch?.ownerPseudo || (uid ? uid.slice(0, 6) + '…' : '?'),
    charName: ch?.nom || '',
    photo:    ch?.photo || '',
    aura:     ch?.aura  || 'blue',
    isAdmin,
    // Ghost = pas de perso rattaché ET pas admin → résidu de BDD
    isGhost: !ch && !isAdmin,
  };
}

function _vttRenderDelegateModalBody(tokenId, search = '') {
  const t = _tokens[tokenId]?.data; if (!t) return '';
  const uid = STATE.user?.uid;
  const adv = STATE.adventure || {};
  const dels = new Set(Array.isArray(t.controlDelegates) ? t.controlDelegates : []);
  // Liste membres = players + admins, sauf soi-même + propriétaire
  const memberUidsRaw = [...new Set([...(adv.players || []), ...(adv.admins || [])])]
    .filter(u => u && u !== uid && u !== t.ownerId);
  const allMembers = memberUidsRaw.map(_vttMemberInfo);
  // ── Filtrage des comptes fantômes (résidus de BDD) ──
  // Les ghosts ne s'affichent jamais dans la liste : ils sont remplacés par
  // un bandeau de nettoyage visible uniquement pour le MJ.
  const ghosts = allMembers.filter(m => m.isGhost);
  const members = allMembers.filter(m => !m.isGhost);

  // Filtre par recherche (pseudo OU nom personnage)
  const q = _norm(search || '');
  const filtered = q
    ? members.filter(m => _searchIncludes(m.pseudo || '', search)
                       || _searchIncludes(m.charName || '', search))
    : members;

  // Trie : délégués actifs en premier, puis alphabétique
  filtered.sort((a, b) => {
    const ad = dels.has(a.uid) ? 0 : 1;
    const bd = dels.has(b.uid) ? 0 : 1;
    if (ad !== bd) return ad - bd;
    return (a.pseudo || '').localeCompare(b.pseudo || '', 'fr');
  });

  const activeCount = dels.size;

  if (members.length === 0) {
    return `<div class="vtt-deleg-empty-state">
      <div class="vtt-deleg-empty-ico">👥</div>
      <div><b>Aucun autre joueur dans l'aventure</b></div>
      <div class="vtt-deleg-empty-hint">Invite d'autres joueurs depuis le menu d'aventure pour pouvoir leur déléguer un token.</div>
    </div>`;
  }

  const rows = filtered.length ? filtered.map(m => {
    const active = dels.has(m.uid);
    const initials = (m.pseudo || '?')[0].toUpperCase();
    const portraitHtml = m.photo
      ? `<img src="${_esc(m.photo)}" alt="">`
      : `<span class="vtt-deleg-portrait-initial">${_esc(initials)}</span>`;
    return `<div class="vtt-deleg-row ${active?'is-on':''}" data-uid="${m.uid}"
        data-action="_vttToggleTokenDelegate" data-token-id="${tokenId}" data-uid2="${m.uid}">
      <div class="vtt-deleg-portrait" data-aura="${_esc(m.aura)}">${portraitHtml}</div>
      <div class="vtt-deleg-body">
        <div class="vtt-deleg-pseudo">
          ${_esc(m.pseudo)}
          ${m.isAdmin ? '<span class="vtt-deleg-badge admin" title="Maître du jeu">MJ</span>' : ''}
        </div>
        ${m.charName ? `<div class="vtt-deleg-char">Joue&nbsp;: ${_esc(m.charName)}</div>` : '<div class="vtt-deleg-char vtt-deleg-char-empty">Aucun perso lié</div>'}
      </div>
      <div class="vtt-deleg-switch ${active?'on':''}" aria-label="${active?'Autorisé':'Bloqué'}">
        <span class="vtt-deleg-switch-thumb"></span>
      </div>
    </div>`;
  }).join('') : `<div class="vtt-deleg-noresult">
    <span>🔎</span><div>Aucun joueur ne correspond à « ${_esc(search)} »</div>
  </div>`;

  return `<div class="vtt-deleg-intro">
      Toggle chaque joueur pour autoriser / retirer le contrôle. <b>Tu restes propriétaire</b> et peux révoquer à tout moment.
    </div>
    <div class="vtt-deleg-summary">
      <span class="vtt-deleg-summary-ico">🤝</span>
      <span><b>${activeCount}</b> joueur${activeCount>1?'s':''} autorisé${activeCount>1?'s':''}
        ${activeCount === 0 ? '· vous seul contrôlez ce token' : ''}</span>
    </div>
    <div class="vtt-deleg-search-wrap">
      <span class="vtt-deleg-search-ico">🔍</span>
      <input type="text" id="vtt-deleg-search" class="vtt-deleg-search"
        placeholder="Rechercher un joueur ou un personnage…"
        value="${_esc(search)}"
        data-input="_vttFilterDelegates" data-token-id="${tokenId}">
    </div>
    <div class="vtt-deleg-list">${rows}</div>
    ${(STATE.isAdmin && ghosts.length) ? `
      <div class="vtt-deleg-ghosts">
        <span class="vtt-deleg-ghosts-ico">🧹</span>
        <div class="vtt-deleg-ghosts-body">
          <b>${ghosts.length} compte${ghosts.length>1?'s':''} orphelin${ghosts.length>1?'s':''}</b>
          <span>résidus de base de données — masqués de la liste.</span>
        </div>
        <button class="btn btn-outline btn-sm"
          data-action="_vttCleanGhostMembers" title="Retirer ces UIDs de l'aventure">Nettoyer</button>
      </div>` : ''}
    <button class="btn btn-outline btn-sm vtt-deleg-close" data-action="_vttDelegClose">Fermer</button>`;
}

function _vttOpenTokenDelegatesModal(tokenId) {
  const t = _tokens[tokenId]?.data; if (!t) return;
  const uid = STATE.user?.uid;
  const isOwner = uid && t.ownerId === uid;
  if (!isOwner && !STATE.isAdmin) {
    showNotif('Seul le propriétaire du token peut gérer les délégations.', 'error');
    return;
  }
  const tgtName = (typeof _live === 'function' ? _live(t).displayName : t.name) || t.name || 'Token';
  _vttDelegSearch = '';
  openModal(`🤝 Déléguer le contrôle — ${_esc(tgtName)}`,
    `<div id="vtt-deleg-modal" class="vtt-deleg-modal">${_vttRenderDelegateModalBody(tokenId, '')}</div>`);
}

function _vttFilterDelegates(tokenId, value) {
  _vttDelegSearch = value || '';
  const host = document.getElementById('vtt-deleg-modal');
  if (!host) return;
  host.innerHTML = _vttRenderDelegateModalBody(tokenId, _vttDelegSearch);
  // Restaure focus + caret dans la search box
  requestAnimationFrame(() => {
    const el = document.getElementById('vtt-deleg-search');
    if (el) {
      el.focus();
      try { el.setSelectionRange(el.value.length, el.value.length); } catch {}
    }
  });
}

async function _vttToggleTokenDelegate(tokenId, targetUid) {
  const t = _tokens[tokenId]?.data; if (!t || !targetUid) return;
  const uid = STATE.user?.uid;
  const isOwner = uid && t.ownerId === uid;
  if (!isOwner && !STATE.isAdmin) return;
  const cur = Array.isArray(t.controlDelegates) ? t.controlDelegates : [];
  const wasOn = cur.includes(targetUid);
  const next = wasOn ? cur.filter(u => u !== targetUid) : [...cur, targetUid];
  try {
    await updateDoc(_tokRef(tokenId), { controlDelegates: next });
    // Mise à jour optimiste du cache local pour rafraîchir immédiatement la modal
    if (_tokens[tokenId]?.data) _tokens[tokenId].data.controlDelegates = next;
    const host = document.getElementById('vtt-deleg-modal');
    if (host) host.innerHTML = _vttRenderDelegateModalBody(tokenId, _vttDelegSearch || '');
    const name = _resolveUidName(targetUid);
    showNotif(wasOn ? `Contrôle retiré à ${name}` : `${name} peut maintenant contrôler ce token`,
      wasOn ? 'info' : 'success');
  } catch (err) {
    console.error('[VTT] toggle delegate', err);
    showNotif(`Erreur : ${err?.message || err}`, 'error');
  }
}

// Suppression rapide depuis le chip de l'inspector — alias vers le toggle
async function _vttRemoveTokenDelegate(tokenId, uid) {
  await _vttToggleTokenDelegate(tokenId, uid);
}

// Nettoie les UIDs orphelins (sans perso lié + non admin) du doc d'aventure.
// Réservé MJ — agit sur adventure.players + accessList.
async function _vttCleanGhostMembers() {
  if (!STATE.isAdmin) return;
  const adv = STATE.adventure; if (!adv?.id) return;
  // Recalcule la liste des ghosts à l'instant T
  const ghosts = [...new Set([...(adv.players || []), ...(adv.admins || [])])]
    .filter(u => u && u !== STATE.user?.uid)
    .map(_vttMemberInfo)
    .filter(m => m.isGhost)
    .map(m => m.uid);
  if (!ghosts.length) { showNotif('Aucun compte orphelin à nettoyer', 'info'); return; }

  const players    = (adv.players    || []).filter(u => !ghosts.includes(u));
  const accessList = (adv.accessList || []).filter(u => !ghosts.includes(u));
  const admins     = (adv.admins     || []).filter(u => !ghosts.includes(u));

  try {
    await updateDoc(doc(db, 'adventures', adv.id), { players, accessList, admins });
    // Synchro de l'état local pour rafraîchir la modal
    STATE.adventure = { ...adv, players, accessList, admins };
    showNotif(`🧹 ${ghosts.length} compte${ghosts.length>1?'s':''} orphelin${ghosts.length>1?'s':''} retiré${ghosts.length>1?'s':''} de l'aventure`, 'success');
    // Re-render la modal (le body si elle est encore ouverte)
    const host = document.getElementById('vtt-deleg-modal');
    if (host) {
      // Récupère le tokenId courant depuis le data-attribute de l'inspector ou ré-extrait
      const sel = document.querySelector('[data-vtt-fn="_vttOpenTokenDelegatesModal"]');
      const tokenId = sel?.dataset?.vttArgs;
      if (tokenId) host.innerHTML = _vttRenderDelegateModalBody(tokenId, _vttDelegSearch || '');
    }
  } catch (err) {
    console.error('[VTT] clean ghosts', err);
    showNotif(`Erreur : ${err?.message || err}`, 'error');
  }
}

/** Réinitialise le déplacement et les actions d'un token (MJ, tour individuel). */
async function _vttResetTurn(id) {
  if (!STATE.isAdmin) return;
  await updateDoc(_tokRef(id), { movedThisTurn: false, movedCells: 0, bonusMvt: 0, attackedThisTurn: false, bonusActionThisTurn: false, reactionThisTurn: false })
    .catch(() => showNotif('Erreur reset tour', 'error'));
  showNotif('Tour réinitialisé', 'success');
}

async function _vttToggleTurnFlag(id, field) {
  if (!STATE.isAdmin || !["bonusActionThisTurn", "reactionThisTurn"].includes(field)) return;
  const token = _tokens[id]?.data;
  if (!token) return;
  await updateDoc(_tokRef(id), { [field]: !token[field] })
    .catch(() => showNotif("Erreur de suivi du tour", "error"));
}

async function _vttAddImageUrl() {
  const url=prompt('URL de l\'image :')?.trim(); if (!url||!_activePage) return;
  const imgs=[...(_activePage.backgroundImages??[]),{id:Date.now().toString(),url,x:0,y:0,w:_activePage.cols,h:_activePage.rows}];
  await updateDoc(_pgRef(_activePage.id),{backgroundImages:imgs}).catch(()=>{});
}
function _vttUploadClick() { return document.getElementById('vtt-img-input')?.click(); }

async function _vttToggleCombat() {
  if (!STATE.isAdmin) return;
  const active=!_session?.combat?.active;
  await setDoc(_sesRef(),{combat:{active,round:active?1:0}},{merge:true});
  if (active) {
    const b=writeBatch(db);
    // Au démarrage du combat (round 1), on convertit les conditions à durée
    // différée (pendingDuration, posées hors combat) en expiresAtRound réel.
    // Sinon ces états resteraient indéfiniment.
    const startRound = 1;
    Object.keys(_tokens).forEach(id => {
      const tokData = _tokens[id]?.data;
      if (!tokData) return;
      const updates = { movedThisTurn:false, movedCells:0, bonusMvt:0, attackedThisTurn:false, bonusActionThisTurn:false, reactionThisTurn:false };
      if (Array.isArray(tokData.conditions) && tokData.conditions.length) {
        let changed = false;
        const newConds = tokData.conditions.map(c => {
          if (c.pendingDuration != null && c.expiresAtRound == null) {
            changed = true;
            const dur = parseInt(c.pendingDuration) || 0;
            const { pendingDuration, ...rest } = c;
            return { ...rest, expiresAtRound: dur > 0 ? startRound + dur - 1 : null };
          }
          return c;
        });
        if (changed) updates.conditions = newConds;
      }
      b.update(_tokRef(id), updates);
    });
    await b.commit().catch(()=>{});
    showNotif('⚔️ Combat démarré !','success');
  } else showNotif('Combat terminé.','success');
}
async function _vttNextRound() {
  if (!STATE.isAdmin||!_session?.combat?.active) return;
  const round=(_session.combat.round??1)+1;
  await setDoc(_sesRef(),{combat:{active:true,round}},{merge:true});

  // ── Application des effets périodiques en début de round (avant cleanup) ──
  // DoT : dégâts/tour · Regen : soin/tour
  const dotNotifs = [];
  for (const id of Object.keys(_tokens)) {
    const td = _tokens[id]?.data;
    const dots = (td?.buffs || []).filter(b => (b.type === 'dot' || b.type === 'regen')
      && (b.expiresAtRound == null || round <= b.expiresAtRound));
    if (!dots.length) continue;
    let totalDmg = 0;
    let totalHeal = 0;
    const dmgRolls = [];
    const healRolls = [];
    for (const dot of dots) {
      const det = _rollDiceDetailed(dot.formula || '1d4 +2');
      const entry = {
        formula: dot.formula || '1d4 +2',
        rolled: det.total, rolledDice: det.rolls, mod: det.mod, sides: det.sides,
        sortLabel: dot.sortLabel || (dot.type === 'regen' ? 'Régénération' : 'DoT'),
      };
      if (dot.type === 'regen') {
        totalHeal += det.total;
        healRolls.push(entry);
      } else {
        totalDmg += det.total;
        dmgRolls.push(entry);
      }
    }
    const lT = _live(td);
    const tgtName = lT.displayName ?? td.name;
    const curHp = lT.displayHp ?? td.hp ?? 20;
    const hpMax = lT.displayHpMax ?? 20;
    if (totalDmg > 0) {
      const newHp = Math.max(0, curHp - totalDmg);
      await _setHp(td, newHp).catch(() => {});
      dotNotifs.push(`🩸 ${totalDmg} dégâts DoT → ${tgtName}`);
      await addDoc(_logCol(), {
        type: 'dot-tick',
        authorId: STATE.user?.uid || null,
        authorName: STATE.profile?.pseudo || STATE.profile?.prenom || 'MJ',
        tokenName: tgtName,
        rolls: dmgRolls, total: totalDmg, newHp, hpMax,
        createdAt: serverTimestamp(),
      }).catch(() => {});
      const concNotes = await _vttTriggerConcentrationSave(td, totalDmg);
      dotNotifs.push(...concNotes);
    }
    if (totalHeal > 0) {
      const afterDmg = Math.max(0, curHp - totalDmg);
      const newHp = Math.min(hpMax, afterDmg + totalHeal);
      const effectiveHeal = Math.max(0, newHp - afterDmg);
      if (effectiveHeal <= 0) continue;
      await _setHp(td, newHp).catch(() => {});
      dotNotifs.push(`💚 ${effectiveHeal} PV Régénération → ${tgtName}`);
      await addDoc(_logCol(), {
        type: 'dot-tick',
        isHeal: true,
        authorId: STATE.user?.uid || null,
        authorName: STATE.profile?.pseudo || STATE.profile?.prenom || 'MJ',
        tokenName: tgtName,
        rolls: healRolls, total: effectiveHeal, rolledTotal: totalHeal, newHp, hpMax,
        createdAt: serverTimestamp(),
      }).catch(() => {});
    }
  }

  const b=writeBatch(db);
  const expiredNotifs = [];
  Object.keys(_tokens).forEach(id => {
    const tokData = _tokens[id]?.data;
    if (!tokData) return;
    // ── Cleanup auto des tokens summons expirés (sentinelle, arme invoquée) ──
    // Les summons non-canalisés expirent à round > summonExpiresAtRound.
    // Les summons canalisés (summonCanalise: true) persistent tant que la
    // concentration tient — supprimés via le JS Sa raté.
    if (tokData.summonExpiresAtRound != null && !tokData.summonCanalise && round > tokData.summonExpiresAtRound) {
      expiredNotifs.push(`${tokData.summonKind === 'invocation' ? '🐾' : tokData.summonKind === 'sentinelle' ? '🪤' : '⚔️'} ${tokData.name} dissipé`);
      _persistInvocationState(tokData);   // PV/PM persistants avant dissipation (invocations)
      b.delete(_tokRef(id));
      return; // skip buff cleanup pour token supprimé
    }
    const updates = { movedThisTurn: false, movedCells: 0, bonusMvt: 0, attackedThisTurn: false, bonusActionThisTurn: false, reactionThisTurn: false };
    if (tokData.buffs?.length) {
      const remaining = tokData.buffs.filter(bf => {
        const isExpired =
          // cas normal : expiresAtRound calculé
          (bf.expiresAtRound != null && round > bf.expiresAtRound) ||
          // fallback : anciens buffs (expiresAtRound null) avec totalDuration+startRound
          (bf.expiresAtRound == null && bf.totalDuration != null && bf.startRound != null &&
           round - Math.max(1, bf.startRound) >= bf.totalDuration);
        if (isExpired) {
          expiredNotifs.push(`${bf.icon ?? '✨'} ${bf.sortLabel ?? 'Buff'} expiré sur ${_live(tokData).displayName ?? tokData.name}`);
          return false;
        }
        return true;
      });
      if (remaining.length !== tokData.buffs.length) updates.buffs = remaining;
    }
    // ── Cleanup des états (conditions) expirés ────────────────────────
    // Les conditions ont aussi un expiresAtRound (posé au cast d'affliction
    // ou via l'édition manuelle). Mêmes règles d'expiration que les buffs.
    if (tokData.conditions?.length) {
      const remainingConds = tokData.conditions.filter(c => {
        if (c.expiresAtRound != null && round > c.expiresAtRound) {
          const lib = CONDITION_BY_ID[c.id];
          const icon = lib?.icon || '⛓';
          const label = lib?.label || c.id;
          expiredNotifs.push(`${icon} ${label} expiré sur ${_live(tokData).displayName ?? tokData.name}`);
          return false;
        }
        return true;
      });
      if (remainingConds.length !== tokData.conditions.length) updates.conditions = remainingConds;
    }
    b.update(_tokRef(id), updates);
  });
  await b.commit().catch(()=>{});
  dotNotifs.forEach(msg => showNotif(msg, 'error'));
  expiredNotifs.forEach(msg => showNotif(msg, 'info'));
  showNotif(`Round ${round} !`, 'success');
}

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
      <div class="form-group"><label>📐 Taille token (cases L × H)</label>
        <div style="display:flex;gap:.5rem;align-items:center">
          <select id="vsf-tokenW" class="input-field" style="flex:1">
            <option value=""${t.tokenW==null?' selected':''}>Auto (${ld.displayTokenW||1})</option>
            ${[1,2,3,4,5].map(n => `<option value="${n}"${t.tokenW===n?' selected':''}>${n}</option>`).join('')}
          </select>
          <span style="color:var(--text-dim)">×</span>
          <select id="vsf-tokenH" class="input-field" style="flex:1">
            <option value=""${t.tokenH==null?' selected':''}>Auto (${ld.displayTokenH||1})</option>
            ${[1,2,3,4,5].map(n => `<option value="${n}"${t.tokenH===n?' selected':''}>${n}</option>`).join('')}
          </select>
        </div>
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
        <button class="btn-primary" data-vtt-fn="_vttSaveStats" data-vtt-args="${t.id}">💾 Enregistrer</button>
      </div>
    </div>`);
}
// ── Création d'ennemis personnalisés ────────────────────────────────
function _vttCreateEnemy() {
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
        <button class="btn-primary" data-vtt-fn="_vttConfirmCreateEnemy">Créer</button>
      </div>
    </div>`);
}
async function _vttConfirmCreateEnemy() {
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
      imageUrl: null, movedThisTurn: false, attackedThisTurn: false, bonusActionThisTurn: false, reactionThisTurn: false,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit().catch(()=>showNotif('Erreur création','error'));
  showNotif(`👹 ${count>1?`${count} ennemis créés`:'Ennemi créé'} !`,'success');
}

// Créer une nouvelle instance indépendante d'un ennemi (PV séparés)
async function _vttDuplicateToken(tokenId) {
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
    movedThisTurn: false, attackedThisTurn: false, bonusActionThisTurn: false, reactionThisTurn: false,
    createdAt: serverTimestamp(),
  }).catch(()=>showNotif('Erreur duplication','error'));
  showNotif(`👹 ${baseName} ${num} créé !`,'success');
}

// Placer une instance depuis le bestiaire (crée + place sur la page active)
async function _vttPlaceFromBestiary(beastId) {
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
  const sw = Math.max(1, Math.min(5, b.tokenW || b.tokenSize || 1));
  const sh = Math.max(1, Math.min(5, b.tokenH || b.tokenSize || 1));
  const cx=Math.floor(_activePage.cols/2), cy=Math.floor(_activePage.rows/2);
  const ref=doc(_toksCol());
  await setDoc(ref,{
    name, type:'enemy',
    characterId:null, npcId:null, beastId,
    ownerId:null,
    pageId:_activePage.id,
    col:Math.max(0,Math.min(_activePage.cols-sw,cx+active.length)),
    row:Math.max(0,Math.min(_activePage.rows-sh,cy)),
    visible:true,
    imageUrl:null, movement:null, range:1, attack:null, defense:null,
    hp:null, hpMax:null,
    movedThisTurn:false, attackedThisTurn:false, bonusActionThisTurn:false, reactionThisTurn:false,
    createdAt:serverTimestamp(),
  }).catch(()=>showNotif('Erreur placement','error'));
  showNotif(`👹 ${name} placé !`,'success');
}

// Supprimer définitivement un token ennemi
async function _vttDeleteToken(tokenId) {
  const t=_tokens[tokenId]?.data; if (!t||t.type!=='enemy') return;
  if (!confirm(`Supprimer définitivement "${t.name}" ?`)) return;
  await deleteDoc(_tokRef(tokenId)).catch(()=>showNotif('Erreur suppression','error'));
  showNotif(`🗑 ${t.name} supprimé`,'success');
}

async function _vttSaveStats(id) {
  const mv  = document.getElementById('vsf-mv')?.value;
  const rng = document.getElementById('vsf-range')?.value;
  const atk = document.getElementById('vsf-atk')?.value;
  const def = document.getElementById('vsf-def')?.value;
  const img = document.getElementById('vsf-img')?.value.trim();
  const vis = document.getElementById('vsf-visible')?.checked;
  const tw = document.getElementById('vsf-tokenW')?.value;
  const th = document.getElementById('vsf-tokenH')?.value;
  const patch = {
    movement: mv  ? +mv  : null,
    range:    rng ? +rng : 1,
    attack:   atk ? +atk : null,
    defense:  def ? +def : null,
    imageUrl: img || null,
    visible:  vis ?? true,
    tokenW:   tw ? Math.max(1, Math.min(5, parseInt(tw)||1)) : null,
    tokenH:   th ? Math.max(1, Math.min(5, parseInt(th)||1)) : null,
  };
  // Clamper la position dans la nouvelle bounding box (héritage bête si override null)
  const cur = _tokens[id]?.data;
  if (cur && _activePage) {
    const b = cur.beastId ? _bestiary[cur.beastId] : null;
    const sw = patch.tokenW ?? b?.tokenW ?? b?.tokenSize ?? 1;
    const sh = patch.tokenH ?? b?.tokenH ?? b?.tokenSize ?? 1;
    patch.col = Math.max(0, Math.min(_activePage.cols - sw, cur.col ?? 0));
    patch.row = Math.max(0, Math.min(_activePage.rows - sh, cur.row ?? 0));
  }
  await updateDoc(_tokRef(id),patch).catch(()=>showNotif('Erreur','error'));
  closeModalDirect();
  showNotif('Stats mises à jour','success');
}

// ── Upload via Cloudinary ───────────────────────────────────────────
// Config (cloud name + upload preset) stockée en localStorage par le module
// shared/upload-cloudinary.js. Helper conservé sous le nom legacy
// `_vttSetImgbbKey` pour ne pas casser les `data-vtt-fn` existants.

function _vttSetImgbbKey() {
  openCloudinaryConfigModal();
  if (hasCloudinaryConfig()) showNotif('Configuration Cloudinary enregistrée ✓','success');
}

async function _handleUpload(file) {
  if (!file||!_activePage) return;
  if (!hasCloudinaryConfig()) {
    showNotif('Configure ta config Cloudinary d\'abord (bouton 🔑)','error');
    openCloudinaryConfigModal();
    if (!hasCloudinaryConfig()) return;
  }
  showNotif('Upload en cours…','success');
  try {
    const up = await uploadCloudinary(file, { folder: 'maps', tags: ['map'] });
    const url = up.url;
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
  // Walls bar
  const wallsBar = document.getElementById('vtt-walls-bar');
  if (wallsBar) wallsBar.style.display = tool === 'walls' ? 'flex' : 'none';
  // Curseur
  const wrap = document.getElementById('vtt-canvas-wrap');
  if (wrap) wrap.style.cursor = (tool === 'ruler' || tool === 'draw' || tool === 'walls') ? 'crosshair' : '';
  // Éditeur de murs
  fogToggleEditMode(tool === 'walls', _activePage);
  if (tool === 'walls') fogRenderWalls(_activePage, true);
  else if (_activePage) fogRenderWalls(_activePage, STATE.isAdmin); // quitter édition → redraw normal
  // Règle : effacer si on quitte
  if (tool !== 'ruler') { _clearRuler(); _hideRulerHover(); }
  // Désélection annotation si on quitte le mode select
  if (tool !== 'select') _deselectAnnot();
  // Draggability des annotations
  _updateAnnotDraggable();
}
// Directions : flèches (4 cardinales) + pavé numérique (8 dirs)
const _MOVE_KEYS = {
  'ArrowLeft':  {dc:-1,dr: 0}, 'ArrowRight': {dc: 1,dr: 0},
  'ArrowUp':    {dc: 0,dr:-1}, 'ArrowDown':  {dc: 0,dr: 1},
}
const _NUMPAD_KEYS = {
  'Numpad4':{dc:-1,dr: 0}, 'Numpad6':{dc: 1,dr: 0},
  'Numpad8':{dc: 0,dr:-1}, 'Numpad2':{dc: 0,dr: 1},
  'Numpad7':{dc:-1,dr:-1}, 'Numpad9':{dc: 1,dr:-1},
  'Numpad1':{dc:-1,dr: 1}, 'Numpad3':{dc: 1,dr: 1},
}

function _keyHandler(e) {
  if (!document.getElementById('vtt-canvas-wrap')) return;
  if (e.target.matches('input,textarea,select')) return;
  if (e.key==='Escape') { if (_tool !== 'select') _setTool('select'); else _deselect(); }
  // Raccourci R : bascule l'outil règle (sans modificateur, hors saisie)
  if ((e.key==='r' || e.key==='R') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    _vttTool('ruler');
  }
  if ((e.key==='Delete'||e.key==='Backspace') && _tool==='select') {
    // 1) Annotations sélectionnées
    if (_selectedAnnotIds.size > 0) {
      e.preventDefault();
      [..._selectedAnnotIds].forEach(id => deleteDoc(_annotRef(id)).catch(()=>{}));
      _deselectAnnot();
    }
    // 2) Image de carte sélectionnée (MJ, mode édition)
    else if (STATE.isAdmin && _selImg && _mapMode && _activePage) {
      e.preventDefault();
      const imgs = (_activePage.backgroundImages ?? []).filter(i => i.id !== _selImg);
      updateDoc(_pgRef(_activePage.id), { backgroundImages: imgs }).catch(()=>{});
      _selImg = null;
      _imgTr?.nodes([]); _imgTrFg?.nodes([]);
      _layers.map?.batchDraw(); _layers.mapFg?.batchDraw();
    }
    // 3) Tokens sélectionnés → retrait du canvas (pageId=null)
    else {
      const ids = _selectedMulti.size > 0 ? [..._selectedMulti] : (_selected ? [_selected] : []);
      if (ids.length) {
        e.preventDefault();
        const uid = STATE.user?.uid;
        for (const id of ids) {
          const t = _tokens[id]?.data; if (!t) continue;
          if (STATE.isAdmin || t.ownerId === uid) {
            updateDoc(_tokRef(id), { pageId: null, visible: false }).catch(()=>{});
          }
        }
        _deselect();
      }
    }
  }
  // Ctrl+Z : annuler le dernier tracé de la session
  if ((e.ctrlKey||e.metaKey) && e.key==='z' && !e.shiftKey) {
    e.preventDefault();
    _vttUndoDraw();
  }
  // Flèches / pavé numérique : déplacer le token sélectionné
  if (!e.ctrlKey && !e.metaKey && !e.altKey && _selected) {
    const dir = _MOVE_KEYS[e.key] ?? _NUMPAD_KEYS[e.code];
    if (dir) {
      e.preventDefault(); // empêche le scroll de la page
      _moveSelectedBy(dir.dc, dir.dr);
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
    return `<div class="vtt-lib-folder-chip" data-vtt-fn="_vttLibOpenFolder" data-vtt-args="${f.id}">
      <span>📁 ${_esc(f.name)}</span>
      <span class="vtt-lib-chip-cnt">${cnt}</span>
      <button class="vtt-icon-btn" data-vtt-fn="_vttLibDelFolder" data-vtt-args="${f.id}" title="Supprimer le dossier">✕</button>
    </div>`;
  }).join('') : '';

  const imgGrid = visible.length
    ? `<div class="vtt-lib-grid">${visible.map(img => `
        <div class="vtt-lib-card" title="${_esc(img.name||'')}">
          <img src="${img.url}" loading="lazy" onerror="this.parentNode.classList.add('vtt-lib-card--err')">
          <div class="vtt-lib-card-ov">
            <button data-vtt-fn="_vttLibPlace" data-vtt-args="${img.id}" title="Placer sur la carte">▶</button>
            ${folders.length && !_libFolder ? `<button data-vtt-fn="_vttLibMoveMenu" data-vtt-args="${img.id}|event" title="Déplacer dans un dossier">📁</button>` : ''}
            ${_libFolder ? `<button data-vtt-fn="_vttLibMoveRoot" data-vtt-args="${img.id}" title="Retirer du dossier">↩</button>` : ''}
            <button data-vtt-fn="_vttLibDelImg" data-vtt-args="${img.id}" title="Supprimer">🗑</button>
          </div>
          <div class="vtt-lib-card-name">${_esc(img.name||'image')}</div>
        </div>`).join('')}</div>`
    : `<div class="vtt-tray-empty">Aucune image${_libFolder ? ' dans ce dossier' : ''}</div>`;

  el.innerHTML = `
    ${_libFolder
      ? `<button class="vtt-lib-back" data-vtt-fn="_vttLibOpenFolder" data-vtt-args="null">← ${_esc(curFolder?.name||'Racine')}</button>`
      : folderChips}
    ${imgGrid}`;
}

function _vttLibOpenFolder(id) { _libFolder = id; _renderLibSection(); }
function _vttLibToggle() { _libOpen = !_libOpen; _renderLibSection();
  document.getElementById('vtt-lib-toggle')?.classList.toggle('open', _libOpen); }

function _vttLibNewFolder() {
  const name = prompt('Nom du dossier :')?.trim();
  if (!name) return;
  _mapLib.folders.push({ id: crypto.randomUUID(), name });
  _saveMapLib();
}

function _vttLibDelFolder(id) {
  // Retirer les images du dossier (les remettre en racine)
  _mapLib.images  = _mapLib.images.map(i => i.folderId === id ? { ...i, folderId: null } : i);
  _mapLib.folders = _mapLib.folders.filter(f => f.id !== id);
  if (_libFolder === id) _libFolder = null;
  _saveMapLib();
}

function _vttLibDelImg(id) {
  _mapLib.images = _mapLib.images.filter(i => i.id !== id);
  _saveMapLib();
}

function _vttLibMoveRoot(id) {
  _mapLib.images = _mapLib.images.map(i => i.id === id ? { ...i, folderId: null } : i);
  _saveMapLib();
}

function _vttLibMoveMenu(imgId, evt) {
  evt.stopPropagation();
  // Mini popup de sélection de dossier
  const existing = document.getElementById('vtt-lib-move-popup');
  if (existing) { existing.remove(); return; }
  const popup = document.createElement('div');
  popup.id = 'vtt-lib-move-popup';
  popup.className = 'vtt-lib-move-popup';
  popup.innerHTML = _mapLib.folders.map(f =>
    `<div class="vtt-lib-move-opt" data-vtt-fn="_vttLibMoveToAndClose" data-vtt-args="${imgId}|${f.id}">📁 ${_esc(f.name)}</div>`
  ).join('') || '<div style="padding:.4rem;font-size:.75rem;color:var(--text-dim)">Aucun dossier</div>';
  const rect = evt.currentTarget.getBoundingClientRect();
  popup.style.top  = (rect.bottom + 4) + 'px';
  popup.style.left = rect.left + 'px';
  document.body.appendChild(popup);
  const close = (e) => { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('mousedown', close, true); } };
  requestAnimationFrame(() => document.addEventListener('mousedown', close, true));
}

function _vttLibMoveTo(imgId, folderId) {
  _mapLib.images = _mapLib.images.map(i => i.id === imgId ? { ...i, folderId } : i);
  _saveMapLib();
}

function _vttLibPlace(imgId) {
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
}

// ═══════════════════════════════════════════════════════════════════
// BUTIN D'AVENTURE
// ═══════════════════════════════════════════════════════════════════

async function _saveLoot() {
  await _ensureLootListener();
  await setDoc(_lootRef(), { stash: _loot.stash, loot: _loot.loot });
}

function _normalizeLoot(data) {
  _loot = data || {};
  if (!Array.isArray(_loot.stash)) _loot.stash = [];
  if (!Array.isArray(_loot.loot))  _loot.loot  = [];
}

function _ensureLootListener() {
  if (_lootUnsub) return _lootReady || Promise.resolve(_loot);
  _lootLoading = true;
  _lootReady = new Promise(resolve => {
    let resolved = false;
    const finish = () => {
      _lootLoading = false;
      _renderLootPanel();
      if (!resolved) { resolved = true; resolve(_loot); }
    };
    _lootUnsub = onSnapshot(_lootRef(), snap => {
      _normalizeLoot(snap.exists() ? snap.data() : {});
      finish();
    }, () => {
      _normalizeLoot(_loot);
      finish();
    });
  });
  return _lootReady;
}

function _renderLootPanel() {
  const panel = document.getElementById('vtt-loot-panel');
  if (!panel || panel.dataset.open !== '1') return;
  const mj = STATE.isAdmin;

  if (_lootLoading) {
    panel.innerHTML = '<div class="vtt-loot-empty">Chargement du butin…</div>';
    return;
  }

  const uid = STATE.user?.uid;
  const myChars = sortCharactersForDisplay(Object.values(_characters).filter(c => c.uid === uid));
  const _itemRow = (item, zone) => {
    const rarColor = { commune:'#9ca3af', peu_commune:'#22c38e', rare:'#4f8cff', tres_rare:'#b47fff', legendaire:'#f59e0b' }[item.rarete] || '#9ca3af';
    return `<div class="vtt-loot-row-wrap" data-id="${item.id}">
      <div class="vtt-loot-row" data-id="${item.id}">
        ${mj ? `<span class="vtt-loot-drag" title="${zone === 'stash' ? 'Glisser vers le butin' : 'Glisser vers la réserve'}">⠿</span>` : ''}
        <span class="vtt-loot-dot" style="background:${rarColor}"></span>
        <span class="vtt-loot-name">${_esc(item.nom)}</span>
        <span class="vtt-loot-qty">×${item.qty}</span>
        ${zone === 'stash' && mj ? `<button class="vtt-icon-btn" data-vtt-fn="_vttLootRemoveStash" data-vtt-args="${item.id}" title="Retirer">✕</button>` : ''}
        ${zone === 'loot'  && mj ? `<button class="vtt-icon-btn" data-vtt-fn="_vttLootRemoveLoot" data-vtt-args="${item.id}" title="Retirer">✕</button>` : ''}
        ${zone === 'loot' && myChars.length ? `<button class="vtt-loot-take-btn" data-vtt-fn="_vttLootToggleTake" data-vtt-args="${item.id}">Prendre</button>` : ''}
      </div>
      ${zone === 'loot' ? `<div class="vtt-loot-take-inline" id="vtt-take-inline-${item.id}" style="display:none"></div>` : ''}
    </div>`;
  };

  panel.innerHTML = `
    ${mj ? `
    <div class="vtt-loot-section">
      <div class="vtt-loot-sec-hd">
        <span>🔒 Réserve MJ</span>
        <button class="vtt-btn-sm" data-vtt-fn="_vttLootOpenShop">＋ Ajouter</button>
      </div>
      <div class="vtt-loot-list" id="vtt-stash-list">
        ${_loot.stash.length ? _loot.stash.map(i => _itemRow(i, 'stash')).join('') : '<div class="vtt-loot-empty">Vide — ajoutez des objets</div>'}
      </div>
    </div>
    <div class="vtt-loot-divider">↕ Glisser entre réserve et butin</div>
    ` : ''}
    <div class="vtt-loot-section">
      <div class="vtt-loot-sec-hd">
        <span>💰 Butin disponible</span>
        ${mj ? `<button class="vtt-btn-sm vtt-btn-danger" data-vtt-fn="_vttLootClear">🗑</button>` : ''}
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
      group: { name: 'vtt-loot', pull: 'clone', put: true },
      animation: 150,
      handle: '.vtt-loot-drag',
      sort: false,
      ghostClass: 'vtt-loot-ghost',
      onAdd(evt) {
        // Item glissé depuis le butin vers la réserve
        const id = evt.item.dataset.id;
        evt.item.remove();
        const src = _loot.loot.find(i => i.id === id);
        if (!src) return;
        const existing = _loot.stash.find(i => i.itemId === src.itemId);
        if (existing) { existing.qty += src.qty; }
        else { _loot.stash.push({ ...src, id: crypto.randomUUID() }); }
        _loot.loot = _loot.loot.filter(i => i.id !== id);
        _saveLoot();
      },
    });
    Sortable.create(lootEl, {
      group: { name: 'vtt-loot', pull: true, put: true },
      animation: 150,
      handle: '.vtt-loot-drag',
      sort: false,
      ghostClass: 'vtt-loot-ghost',
      onAdd(evt) {
        // Item glissé depuis la réserve vers le butin
        const id = evt.item.dataset.id;
        evt.item.remove();
        const src = _loot.stash.find(i => i.id === id);
        if (!src) return;
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

function _vttToggleLoot() {
  const panel = document.getElementById('vtt-loot-panel');
  if (!panel) return;
  const open = panel.dataset.open === '1';
  if (open) { _closeLootPanel(); return; }
  panel.dataset.open = '1';
  panel.style.display = 'flex';
  document.getElementById('vtt-loot-trigger')?.classList.add('active');
  void _ensureLootListener();
  _renderLootPanel();
  _lootCloseOutside = (e) => {
    const float = document.querySelector('.vtt-loot-float');
    if (float && !float.contains(e.target)) _closeLootPanel();
  };
  document.addEventListener('mousedown', _lootCloseOutside, true);
}

function _vttLootRemoveStash(id) {
  _loot.stash = _loot.stash.filter(i => i.id !== id);
  _saveLoot();
}

function _vttLootRemoveLoot(id) {
  _loot.loot = _loot.loot.filter(i => i.id !== id);
  _saveLoot();
}

function _vttLootClear() {
  _loot.loot = [];
  _saveLoot();
}

// ─────────────────────────────────────────────────────────────────────────────
// PICKER OBJET BOUTIQUE — utilise le composant partagé shared/shop-picker.js
// ─────────────────────────────────────────────────────────────────────────────

/** Helper interne : ajoute un objet boutique au stash (avec fusion). */
async function _vttLootAddItemToStash(item, qty, catTemplate) {
  await _ensureLootListener();
  const template = catTemplate || 'classique';
  const prixVente = Math.round((item.prix || 0) * 0.5);
  const base = shopItemToInvEntry(item, { source: 'butin', template, prixVente });
  const entry = { ...base, id: crypto.randomUUID(), qty };
  delete entry.qte;
  delete entry.source;
  const existing = _loot.stash.find(s => s.itemId === item.id);
  if (existing) { existing.qty += qty; } else { _loot.stash.push(entry); }
  await _saveLoot();
}

function _vttLootOpenShop() { openShopPicker({
  title: '🎒 Ajouter à la réserve MJ',
  hint: 'Tu peux enchaîner les ajouts sans fermer cette fenêtre.',
  showQtyInput: true,
  // Map<itemId, qty> exposé en mode "has-like" pour le badge "×N déjà dedans"
  alreadyPicked: () => {
    const map = new Map();
    (_loot.stash || []).forEach(s => { if (s.itemId) map.set(s.itemId, s.qty); });
    // L'API attend un Set#has — on adapte avec un proxy : `has(id)` retourne la qty (truthy)
    return { has: (id) => map.get(id) || false };
  },
  ownedBadgeTitle: 'Déjà dans la réserve',
  onPick: async (item, { qty }) => {
    const { catMap } = await getShopItemById(item.id);
    const template = catMap?.[item.categorieId]?.template || 'classique';
    await _vttLootAddItemToStash(item, qty, template);
    showNotif(`+${qty} "${item.nom}"`, 'success');
  },
}); }

/** MJ : envoie un butin de créature (depuis le panneau token) vers la réserve. */
async function _vttCreatSendLootToStash(beastId, idx, btn) {
  if (!STATE.isAdmin) return;
  const beast = _bestiary[beastId];
  const b = beast?.butins?.[idx];
  if (!b?.itemId) { showNotif('Butin invalide', 'error'); return; }

  const { item, catMap } = await getShopItemById(b.itemId);
  if (!item) { showNotif('Objet introuvable en boutique', 'error'); return; }

  // Quantité : extrait le 1er entier du champ libre ("1", "1-3", "2d4"…), défaut 1
  const qMatch = String(b.quantite || '').match(/\d+/);
  const qty = Math.max(1, qMatch ? parseInt(qMatch[0]) : 1);

  const template = catMap?.[item.categorieId]?.template || 'classique';
  await _vttLootAddItemToStash(item, qty, template);

  if (btn) {
    btn.textContent = '✓';
    btn.classList.add('vtt-creat-loot-add--ok');
    setTimeout(() => {
      btn.textContent = '＋';
      btn.classList.remove('vtt-creat-loot-add--ok');
    }, 800);
  }
  showNotif(`+${qty} "${item.nom}" → réserve MJ`, 'success');
}

// Joueur : expand inline sur la ligne pour choisir perso + quantité (pas de 2e modal)
// État courant par item : qty choisie + perso sélectionné (chip)
const _lootTakeState = {}; // { [itemId]: { qty, charId } }

function _vttLootToggleTake(id) {
  const el = document.getElementById(`vtt-take-inline-${id}`);
  if (!el) return;
  document.querySelectorAll('.vtt-loot-take-inline').forEach(o => {
    if (o !== el) { o.style.display = 'none'; o.innerHTML = ''; }
  });
  if (el.style.display === 'block') { el.style.display = 'none'; el.innerHTML = ''; delete _lootTakeState[id]; return; }

  const item = _loot.loot.find(i => i.id === id);
  if (!item) return;
  const uid = STATE.user?.uid;
  const myChars = sortCharactersForDisplay(Object.values(_characters).filter(c => c.uid === uid));
  if (!myChars.length) { showNotif('Aucun personnage trouvé', 'error'); return; }

  _lootTakeState[id] = { qty: item.qty, charId: myChars[0].id };
  _renderLootTake(id);
  el.style.display = 'block';
}

function _renderLootTake(id) {
  const el = document.getElementById(`vtt-take-inline-${id}`);
  const item = _loot.loot.find(i => i.id === id);
  const st = _lootTakeState[id];
  if (!el || !item || !st) return;
  const uid = STATE.user?.uid;
  const myChars = sortCharactersForDisplay(Object.values(_characters).filter(c => c.uid === uid));
  const max = item.qty;
  st.qty = Math.max(1, Math.min(max, st.qty || 1));

  const charBar = myChars.length > 1 ? `
    <div class="vtt-loot-take-chars">
      ${myChars.map(c => `
        <button class="vtt-loot-char-chip${st.charId === c.id ? ' active' : ''}"
          data-vtt-fn="_vttLootTakeSetChar" data-vtt-args="${id}|${c.id}"
          title="${_esc(c.nom || c.pseudo || '?')}">
          ${_esc(c.nom || c.pseudo || '?')}
        </button>`).join('')}
    </div>` : '';

  el.innerHTML = `
    ${charBar}
    <div class="vtt-loot-take-row">
      <div class="vtt-loot-stepper">
        <button class="vtt-loot-step" data-vtt-fn="_vttLootTakeStep" data-vtt-args="${id}|-1" ${st.qty<=1?'disabled':''}>−</button>
        <span class="vtt-loot-step-val">${st.qty}<span class="vtt-loot-step-max">/${max}</span></span>
        <button class="vtt-loot-step" data-vtt-fn="_vttLootTakeStep" data-vtt-args="${id}|1" ${st.qty>=max?'disabled':''}>+</button>
      </div>
      ${max > 1 ? `<button class="vtt-loot-step-all" data-vtt-fn="_vttLootTakeStep" data-vtt-args="${id}|max" ${st.qty>=max?'disabled':''}>Tout</button>` : ''}
      <button class="vtt-loot-take-cancel" data-vtt-fn="_vttLootToggleTake" data-vtt-args="${id}" title="Annuler">✕</button>
    </div>
    <button class="vtt-loot-take-go" data-vtt-fn="_vttLootConfirmTake" data-vtt-args="${id}">Prendre ×${st.qty}</button>
  `;
}

function _vttLootTakeSetChar(id, charId) {
  if (!_lootTakeState[id]) return;
  _lootTakeState[id].charId = charId;
  _renderLootTake(id);
}
function _vttLootTakeStep(id, delta) {
  const item = _loot.loot.find(i => i.id === id);
  const st = _lootTakeState[id];
  if (!item || !st) return;
  if (delta === 'max') st.qty = item.qty;
  else st.qty = Math.max(1, Math.min(item.qty, (st.qty || 1) + delta));
  _renderLootTake(id);
}

async function _vttLootConfirmTake(id) {
  const item    = _loot.loot.find(i => i.id === id);
  if (!item) return;
  const st      = _lootTakeState[id] || {};
  const charId  = st.charId;
  const qty     = Math.min(item.qty, Math.max(1, st.qty || 1));
  const char    = _characters[charId];
  if (!char || !charId) { showNotif('Personnage introuvable', 'error'); return; }

  const inv = Array.isArray(char.inventaire) ? [...char.inventaire] : [];
  // Snapshot canonique loot → inventaire (préserve tous les champs présents et futurs)
  const baseEntry = shopItemToInvEntry(item, { source: 'butin' });
  for (let k = 0; k < qty; k++) inv.push({ ...baseEntry });

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
    delete _lootTakeState[id];
    showNotif(`×${qty} "${item.nom}" → ${_esc(char.nom || char.pseudo || '?')}`, 'success');
  } catch { showNotif('Erreur lors de la prise du butin', 'error'); }
}

// ═══════════════════════════════════════════════════════════════════
// LANCEUR DE DÉS LIBRE
// ═══════════════════════════════════════════════════════════════════
const _ALL_DICE = [4, 6, 8, 10, 12, 20, 100];

function _closeDicePanel() {
  const panel = document.getElementById('vtt-dice-panel');
  const btn   = document.getElementById('vtt-dice-trigger');
  if (panel) { panel.dataset.open='0'; panel.style.display='none'; }
  btn?.classList.remove('active');
  if (_diceCloseOut) { document.removeEventListener('mousedown', _diceCloseOut, true); _diceCloseOut=null; }
}

function _vttToggleDice() {
  const panel = document.getElementById('vtt-dice-panel'); if (!panel) return;
  if (panel.dataset.open==='1') { _closeDicePanel(); return; }
  panel.dataset.open='1'; panel.style.display='flex';
  document.getElementById('vtt-dice-trigger')?.classList.add('active');
  _renderDicePanel();
  _diceCloseOut = e => { const f=document.querySelector('.vtt-dice-float'); if(f&&!f.contains(e.target)) _closeDicePanel(); };
  document.addEventListener('mousedown', _diceCloseOut, true);
}

function _vttDiceAddDie(f) { _diceFormula[f]=(_diceFormula[f]||0)+1; _renderDicePanel(); }
function _vttDiceRemoveDie(f) { if(_diceFormula[f]>1) _diceFormula[f]--; else delete _diceFormula[f]; _renderDicePanel(); }
function _vttDiceClear() { _diceFormula={}; _diceFreeBonus=0; _renderDicePanel(); }
function _vttDiceBonusStep(d) { _diceFreeBonus=(_diceFreeBonus||0)+d; _renderDicePanel(); }
function _vttDiceBonusSet(v) { _diceFreeBonus=isNaN(v)?0:+v; }
function _vttDiceMode(m) { _diceFreeMode=m; _renderDicePanel(); }

function _renderDicePanel() {
  const el = document.getElementById('vtt-dice-panel'); if (!el) return;
  const faces = Object.keys(_diceFormula).map(Number).sort((a,b)=>b-a);
  const hasDice = faces.some(f => _diceFormula[f]>0);
  const hasD20single = _diceFormula[20]===1;

  // Formule lisible
  const fmtParts = faces.map(f=>`${_diceFormula[f]}d${f===100?'%':f}`);
  if (_diceFreeBonus>0) fmtParts.push(`+${_diceFreeBonus}`);
  else if (_diceFreeBonus<0) fmtParts.push(String(_diceFreeBonus));
  const formulaStr = fmtParts.join(' + ') || '—';

  el.innerHTML = `
    <div class="vtt-dice-hd">
      <span>🎲 Lancer des dés</span>
      <button class="vtt-icon-btn" data-vtt-fn="_vttToggleDice" title="Fermer">✕</button>
    </div>
    <div class="vtt-dice-grid">
      ${_ALL_DICE.map(f => {
        const cnt = _diceFormula[f]||0;
        const lbl = f===100?'%':f;
        return `<button class="vtt-dice-die-btn${cnt?' active':''}"
          data-vtt-fn="_vttDiceAddDie" data-vtt-args="${f}"
          title="Clic : +1 d${lbl}${cnt?` · clic sur ×${cnt} : −1`:''}">
          d${lbl}${cnt?`<span class="vtt-dice-die-cnt" data-vtt-fn="_vttDiceRemoveDie" data-vtt-args="${f}" title="Retirer un d${lbl}">×${cnt}</span>`:''}
        </button>`;
      }).join('')}
    </div>
    <div class="vtt-dice-formula-row">
      <code class="vtt-dice-formula-str">${formulaStr}</code>
      ${hasDice?`<button class="vtt-dice-clear-btn" data-vtt-fn="_vttDiceClear">✕</button>`:''}
    </div>
    <div class="vtt-dice-bonus-row">
      <span class="vtt-dice-bonus-lbl">Bonus</span>
      <button class="vtt-icon-btn" data-vtt-fn="_vttDiceBonusStep" data-vtt-args="-1">−</button>
      <input id="vtt-dice-bonus-inp" type="number" class="vtt-dice-bonus-inp" value="${_diceFreeBonus}"
        data-vtt-fn="_vttDiceBonusSet" data-vtt-on="input" data-vtt-args="$value">
      <button class="vtt-icon-btn" data-vtt-fn="_vttDiceBonusStep" data-vtt-args="+1">＋</button>
    </div>
    ${hasD20single ? `<div class="vtt-dice-mode-row">
      <button class="vtt-roll-mode-btn${_diceFreeMode==='disadvantage'?' active':''}" data-vtt-fn="_vttDiceMode" data-vtt-args="disadvantage">⬇ Désav.</button>
      <button class="vtt-roll-mode-btn${_diceFreeMode==='normal'?' active':''}" data-vtt-fn="_vttDiceMode" data-vtt-args="normal">⚪ Normal</button>
      <button class="vtt-roll-mode-btn${_diceFreeMode==='advantage'?' active':''}" data-vtt-fn="_vttDiceMode" data-vtt-args="advantage">⬆ Avantage</button>
    </div>` : ''}
    <button class="vtt-dice-roll-btn" data-vtt-fn="_vttDiceRoll"
      ${!hasDice&&!_diceFreeBonus?'disabled':''}>
      🎲 Lancer !
    </button>`;
}

function _vttDiceRoll() {
  const faces = Object.keys(_diceFormula).map(Number).sort((a,b)=>b-a);
  if (!faces.length && !_diceFreeBonus) return;
  const authorName = STATE.profile?.pseudo||STATE.profile?.prenom||STATE.user?.displayName||'Joueur';

  const groups = [];
  let total = 0;
  for (const f of faces) {
    const count = _diceFormula[f]; if (!count) continue;
    const rolls = []; let subtotal = 0;
    let kept;
    if (f===20 && count===1 && _diceFreeMode!=='normal') {
      const r1=Math.floor(Math.random()*20)+1, r2=Math.floor(Math.random()*20)+1;
      kept = _diceFreeMode==='advantage' ? Math.max(r1,r2) : Math.min(r1,r2);
      rolls.push(r1,r2); subtotal=kept;
    } else {
      for(let i=0;i<count;i++){ const r=Math.floor(Math.random()*f)+1; rolls.push(r); subtotal+=r; }
    }
    const g = { faces:f, count, rolls, subtotal };
    if (kept !== undefined) g.kept = kept;
    groups.push(g);
    total += subtotal;
  }
  total += (_diceFreeBonus||0);

  const fmtParts = faces.map(f=>`${_diceFormula[f]}d${f===100?'%':f}`);
  if (_diceFreeBonus>0) fmtParts.push(`+${_diceFreeBonus}`);
  else if (_diceFreeBonus<0) fmtParts.push(String(_diceFreeBonus));
  const formula = fmtParts.join('+');

  addDoc(_logCol(), {
    type:'dice-free', authorId:STATE.user?.uid||null, authorName,
    formula, groups, bonus:_diceFreeBonus||0, mode:_diceFreeMode, total,
    createdAt:serverTimestamp(),
  }).catch(()=>{});
  showNotif(`🎲 ${formula} = ${total}`, 'success');
  _closeDicePanel();
}

// ═══════════════════════════════════════════════════════════════════
// MUSIQUE / SONS
// ═══════════════════════════════════════════════════════════════════

function _sortSoundsByCreatedAt(list) {
  return [...(list || [])].sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
}

function _startMusicCatalogListeners() {
  if (_musicCatalogStarted) return _musicCatalogReady || Promise.resolve();
  _musicCatalogStarted = true;
  _musicCatalogLoading = true;

  _musicCatalogReady = new Promise(resolve => {
    let soundsReady = false;
    let playlistsReady = false;
    const done = () => {
      if (!soundsReady || !playlistsReady) return;
      _musicCatalogLoading = false;
      if (document.getElementById('vtt-music-panel')?.dataset.open === '1') _renderMusicPanel();
      if (_musicState?.currentSoundId) _syncMusicPlayback(_musicState);
      resolve();
    };

    _unsubs.push(onSnapshot(_sonsCol(), snap => {
      _sounds = _sortSoundsByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      soundsReady = true;
      if (document.getElementById('vtt-music-panel')?.dataset.open === '1') _renderMusicPanel();
      done();
    }, () => { soundsReady = true; done(); }));

    _unsubs.push(onSnapshot(_playlistsCol(), snap => {
      _playlists = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
      playlistsReady = true;
      if (document.getElementById('vtt-music-panel')?.dataset.open === '1') _renderMusicPanel();
      done();
    }, () => { playlistsReady = true; done(); }));
  });

  return _musicCatalogReady;
}

function _loadMusicSoundById(soundId) {
  if (!soundId) return Promise.resolve(null);
  const existing = _sounds.find(s => s.id === soundId);
  if (existing) return Promise.resolve(existing);
  if (_musicSoundLoads.has(soundId)) return _musicSoundLoads.get(soundId);

  const promise = getDoc(_sonRef(soundId))
    .then(snap => {
      if (!snap.exists()) return null;
      const sound = { id: snap.id, ...snap.data() };
      _sounds = _sortSoundsByCreatedAt([..._sounds.filter(s => s.id !== sound.id), sound]);
      return sound;
    })
    .catch(e => {
      console.debug('[vtt music] son introuvable:', soundId, e?.code || e);
      return null;
    })
    .finally(() => _musicSoundLoads.delete(soundId));
  _musicSoundLoads.set(soundId, promise);
  return promise;
}

function _closeMusicPanel() {
  const panel = document.getElementById('vtt-music-panel');
  if (panel) { panel.dataset.open='0'; panel.style.display='none'; }
  document.getElementById('vtt-music-trigger')?.classList.remove('active');
  if (_musicCloseOut) { document.removeEventListener('mousedown', _musicCloseOut, true); _musicCloseOut=null; }
  clearInterval(_musicProgTimer); _musicProgTimer=null;
  _musicSortables.forEach(s => s.destroy()); _musicSortables=[];
  _stopPreview();
}

function _stopPreview() {
  if (_previewEl) { _previewEl.pause(); _previewEl.src=''; _previewEl=null; }
  document.querySelectorAll('.vtt-mact-preview.on').forEach(b => b.classList.remove('on'));
}

// Préférence de volume locale à chaque utilisateur, persistée entre sessions
// pour ne pas être réinitialisée à chaque nouvelle musique.
const _USER_VOL_KEY = 'vtt:musicVolume';
function _getUserVolume() {
  const v = parseFloat(localStorage.getItem(_USER_VOL_KEY));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.7;
}
function _setUserVolume(v) {
  const clamped = Math.max(0, Math.min(1, v));
  try { localStorage.setItem(_USER_VOL_KEY, String(clamped)); } catch(e){}
  return clamped;
}

// État replié/déplié des catégories — persisté localement (par utilisateur)
const _CAT_COLLAPSE_KEY = 'vtt:musicCollapsed';
function _loadCollapseMap() {
  try { return JSON.parse(localStorage.getItem(_CAT_COLLAPSE_KEY) || '{}') || {}; }
  catch { return {}; }
}
function _isCatCollapsed(catId) { return !!_loadCollapseMap()[catId]; }
function _setCatCollapsed(catId, collapsed) {
  const map = _loadCollapseMap();
  if (collapsed) map[catId] = true; else delete map[catId];
  try { localStorage.setItem(_CAT_COLLAPSE_KEY, JSON.stringify(map)); } catch {}
}
function _vttToggleMusicCat(catId) {
  const cat = document.querySelector(`.vtt-music-cat[data-cat-id="${CSS.escape(catId)}"]`);
  if (!cat) return;
  const collapsed = cat.dataset.collapsed === '1';
  cat.dataset.collapsed = collapsed ? '0' : '1';
  _setCatCollapsed(catId, !collapsed);
}
function _vttToggleAllMusicCats() {
  const cats = document.querySelectorAll('.vtt-music-body .vtt-music-cat');
  if (!cats.length) return;
  const collapseAll = [...cats].some(c => c.dataset.collapsed !== '1');
  cats.forEach(c => {
    c.dataset.collapsed = collapseAll ? '1' : '0';
    _setCatCollapsed(c.dataset.catId, collapseAll);
  });
}

function _vttPreview(soundId, btn) {
  const sound = _sounds.find(s=>s.id===soundId); if (!sound) return;
  // Même son → stop
  if (_previewEl && _previewEl.dataset.soundId===soundId) { _stopPreview(); return; }
  _stopPreview();
  const el = new Audio(sound.url);
  el.dataset.soundId = soundId;
  el.volume = _getUserVolume();
  el.addEventListener('ended', _stopPreview);
  el.play().catch(() => showNotif('Impossible de lire ce son', 'error'));
  _previewEl = el;
  btn?.classList.add('on');
}

function _vttToggleMusic() {
  const panel = document.getElementById('vtt-music-panel'); if (!panel) return;
  if (panel.dataset.open==='1') { _closeMusicPanel(); return; }
  panel.dataset.open='1'; panel.style.display='flex';
  document.getElementById('vtt-music-trigger')?.classList.add('active');
  if (STATE.isAdmin) void _startMusicCatalogListeners();
  _renderMusicPanel();
  _musicCloseOut = e => {
    const f = document.querySelector('.vtt-music-float');
    const ctx = document.getElementById('vtt-ctx-menu');
    if (f && !f.contains(e.target) && !ctx?.contains(e.target)) _closeMusicPanel();
  };
  document.addEventListener('mousedown', _musicCloseOut, true);
}

// ── Rendu du panel ──────────────────────────────────────────────────
function _renderMusicPanel() {
  const panel = document.getElementById('vtt-music-panel'); if (!panel) return;
  const mj = STATE.isAdmin;
  const ms = _musicState;
  const playing = !!(ms.playing && ms.currentSoundId);
  const curSound = playing ? _sounds.find(s=>s.id===ms.currentSoundId) : null;

  // Joueurs : panel minimal — uniquement en lecture + volume
  if (!mj) {
    panel.innerHTML = `
      <div class="vtt-music-hd">
        <span>🎵 Musique</span>
        <button class="vtt-ms-close" data-vtt-fn="_vttToggleMusic">✕</button>
      </div>
      ${_renderNowPlaying(curSound, ms)}`;
  } else {
    panel.innerHTML = `
      <div class="vtt-music-hd">
        <span>🎵 Sons &amp; Musique</span>
        <button class="vtt-ms-close" data-vtt-fn="_vttToggleMusic">✕</button>
      </div>
      <div class="vtt-music-body">${_renderMusicList(mj)}</div>
      ${_renderNowPlaying(curSound, ms)}`;
  }

  // Bind champ de recherche — filtre unique persisté en session
  const sf = panel.querySelector('#vtt-music-search');
  if (sf) {
    sf.value = _musicSearch || '';
    sf.oninput = e => {
      _musicSearch = e.target.value;
      _applyMusicFilter(e.target.value);
    };
    _applyMusicFilter(sf.value);
  }
  // Bind volume slider local — préférence par utilisateur (localStorage)
  const vsl = panel.querySelector('#vtt-music-vol');
  if (vsl) {
    vsl.value = Math.round(_getUserVolume() * 100);
    vsl.oninput = e => {
      const v = _setUserVolume(+e.target.value / 100);
      if (_audioEl)   _audioEl.volume = v;
      if (_previewEl) _previewEl.volume = v;
    };
  }
  // Barre de progression
  clearInterval(_musicProgTimer);
  if (_audioEl && !_audioEl.paused) {
    _musicProgTimer = setInterval(_updateMusicProg, 500);
  }
  // Sortables (MJ uniquement — vue unifiée)
  if (mj) _initMusicSortable();
}

function _updateMusicProg() {
  if (!_audioEl) return;
  const fill = document.getElementById('vtt-music-prog-fill');
  const time = document.getElementById('vtt-music-prog-time');
  const d = _audioEl.duration || 0;
  const c = _audioEl.currentTime || 0;
  if (fill) fill.style.width = d ? `${(c/d)*100}%` : '0%';
  if (time) time.textContent = `${_fmtTime(c)} / ${_fmtTime(d)}`;
}

function _fmtTime(s) {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s/60), sec = Math.floor(s%60);
  return `${m}:${String(sec).padStart(2,'0')}`;
}

// Filtre la vue unifiée par texte : masque les catégories sans match,
// auto-déplie les catégories qui en ont un. Préserve l'état persisté quand
// le champ est vidé. NB: on utilise style.display car les items portent
// `display: flex` (classe) qui bat la règle UA `[hidden]{display:none}`.
function _applyMusicFilter(query) {
  const q = _norm(query || '');
  const root = document.querySelector('.vtt-music-body'); if (!root) return;
  const text = el => _norm(el?.textContent || '');
  const show = (el, ok) => { if (el) el.style.display = ok ? '' : 'none'; };

  root.querySelectorAll('.vtt-music-cat').forEach(cat => {
    const catId = cat.dataset.catId;
    const catNameEl = cat.querySelector('.vtt-music-cat-name');
    const catMatch = !q || text(catNameEl).includes(q);
    const sons = cat.querySelectorAll('[data-sound-id]');
    let anySonMatch = false;
    sons.forEach(s => {
      const nameEl = s.querySelector('.vtt-music-pool-name, .vtt-music-pl-sname');
      const ok = !q || catMatch || text(nameEl).includes(q);
      show(s, ok);
      if (ok && q) anySonMatch = true;
    });
    if (q) {
      const visible = catMatch || anySonMatch;
      show(cat, visible);
      // Force déplie pendant une recherche (sans toucher au localStorage)
      if (visible) cat.dataset.collapsed = '0';
    } else {
      show(cat, true);
      cat.dataset.collapsed = _isCatCollapsed(catId) ? '1' : '0';
    }
  });
}

// Rendu unifié : pool "Non classés" + playlists, tous pliables.
function _renderMusicList(mj) {
  let h = `<div class="vtt-music-search-row">
    <input type="search" id="vtt-music-search" class="vtt-music-search"
      placeholder="🔍 Rechercher un son ou une catégorie…" autocomplete="off">
    <button class="vtt-music-collapse-all" data-vtt-fn="_vttToggleAllMusicCats" title="Tout replier / déplier">⇕</button>
  </div>`;

  if (mj) {
    h += `<div class="vtt-music-son-actions-row">
      <button class="vtt-music-upload-btn" data-vtt-fn="_vttAddSonUrl" style="flex:1" title="Ajouter un son via URL">＋ URL</button>
      <button class="vtt-music-upload-btn" data-vtt-fn="_vttImportGithubRelease" style="flex:1.4" title="Importer depuis une release GitHub">📥 GitHub</button>
      <button class="vtt-music-upload-btn" data-vtt-fn="_vttCreatePlaylist" style="flex:1.2" title="Créer une nouvelle catégorie/playlist">＋ Catégorie</button>
    </div>`;
  }

  if (!_sounds.length && !_playlists.length) {
    const msg = _musicCatalogLoading ? 'Chargement des sons…' : 'Aucun son — ajoutez une URL ou importez depuis GitHub';
    return h + `<div class="vtt-music-empty">${msg}</div>`;
  }

  // "Non classés" : sons absents de toute playlist
  const usedIds = new Set(_playlists.flatMap(pl => pl.soundIds || []));
  const poolSounds = _sounds.filter(s => !usedIds.has(s.id));
  if (poolSounds.length) {
    const collapsed = _isCatCollapsed('pool');
    h += `<div class="vtt-music-cat" data-cat-id="pool" data-collapsed="${collapsed?1:0}">
      <div class="vtt-music-cat-hd" data-vtt-fn="_vttToggleMusicCat" data-vtt-args="pool">
        <span class="vtt-music-cat-chevron"></span>
        <span class="vtt-music-cat-name">📦 Non classés</span>
        <span class="vtt-music-pl-cnt">${poolSounds.length}</span>
      </div>
      <div class="vtt-music-cat-body">
        <div class="vtt-music-pool" id="vtt-music-pool">
          ${poolSounds.map(s => _renderSonRow(s, null, mj)).join('')}
        </div>
      </div>
    </div>`;
  }

  if (_playlists.length) {
    h += _playlists.map(pl => {
      const active = _musicState.playing && _musicState.currentPlaylistId===pl.id;
      const sounds = (pl.soundIds||[]).map(sid=>_sounds.find(s=>s.id===sid)).filter(Boolean);
      const collapsed = _isCatCollapsed(pl.id);
      return `<div class="vtt-music-cat vtt-music-pl-item${active?' is-playing':''}" data-cat-id="${pl.id}" data-collapsed="${collapsed?1:0}">
        <div class="vtt-music-cat-hd vtt-music-pl-hd" data-vtt-fn="_vttToggleMusicCat" data-vtt-args="${pl.id}">
          <span class="vtt-music-cat-chevron"></span>
          <span class="vtt-music-pl-dot" style="background:${pl.color||'#6366f1'}"></span>
          <span class="vtt-music-pl-name vtt-music-cat-name">${_esc(pl.name)}</span>
          <span class="vtt-music-pl-cnt">${sounds.length}</span>
          <div class="vtt-music-son-acts" data-vtt-fn="_vttNoop">
            <button class="vtt-mact${active&&!_musicState.shuffle?' on':''}" data-vtt-fn="_vttPlayPlaylist" data-vtt-args="${pl.id}|false" title="Lire en ordre">▶</button>
            <button class="vtt-mact${active&&_musicState.shuffle?' on':''}" data-vtt-fn="_vttPlayPlaylist" data-vtt-args="${pl.id}|true" title="Aléatoire">🔀</button>
            ${mj?`<button class="vtt-mact vtt-mact-del" data-vtt-fn="_vttDeletePlaylist" data-vtt-args="${pl.id}" title="Supprimer">🗑</button>`:''}
          </div>
        </div>
        <div class="vtt-music-cat-body">
          <div class="vtt-music-pl-sounds vtt-pl-drop" id="vtt-pl-drop-${pl.id}" data-pl-id="${pl.id}">
            ${sounds.map(s => _renderSonRow(s, pl.id, mj)).join('')}
            ${!sounds.length?`<div class="vtt-music-pl-empty-drop">Glisser des sons ici</div>`:''}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  return h;
}

// Ligne d'un son (utilisée dans pool et dans chaque playlist)
// plId=null → son dans le pool "Non classés"
function _renderSonRow(s, plId, mj) {
  const ms = _musicState;
  const isPool = !plId;
  const isCurrent = ms.playing && ms.currentSoundId === s.id;
  const inSingleMode = isCurrent && !ms.currentPlaylistId;
  const inThisPlaylist = isCurrent && ms.currentPlaylistId === plId;
  const rowActive = inSingleMode || inThisPlaylist;
  const playOn = inSingleMode && !ms.loop;
  const loopOn = inSingleMode && !!ms.loop;
  const rowClass = isPool ? 'vtt-music-pool-item' : 'vtt-music-pl-sound';
  const nameClass = isPool ? 'vtt-music-pool-name' : 'vtt-music-pl-sname';
  const ctx = mj
    ? `data-vtt-fn="_vttSoundCtxMenu" data-vtt-on="contextmenu" data-vtt-args="$event|${s.id}${isPool?'':`|${plId}`}"`
    : '';
  const delBtn = mj
    ? (isPool
        ? `<button class="vtt-mact vtt-mact-del" data-vtt-fn="_vttDeleteSound" data-vtt-args="${s.id}" title="Supprimer définitivement">🗑</button>`
        : `<button class="vtt-mact vtt-mact-del" data-vtt-fn="_vttRemoveSoundFromPlaylist" data-vtt-args="${plId}|${s.id}" title="Retirer de la catégorie">✕</button>`)
    : '';
  return `<div class="${rowClass}${rowActive?' is-playing':''}" data-sound-id="${s.id}" title="${_esc(s.name)}" ${ctx}>
    ${mj?'<span class="vtt-music-pool-grip">⠿</span>':''}
    <span class="${nameClass}">${_esc(s.name)}</span>
    <button class="vtt-mact${playOn?' on':''}" data-vtt-fn="_vttPlaySound" data-vtt-args="${s.id}|false" title="Lire">${playOn && !ms.paused?'⏸':'▶'}</button>
    <button class="vtt-mact${loopOn?' on':''}" data-vtt-fn="_vttPlaySound" data-vtt-args="${s.id}|true" title="Boucle">🔁</button>
    <button class="vtt-mact vtt-mact-preview" data-vtt-fn="_vttPreview" data-vtt-args="${s.id}|$this" title="Aperçu local (MJ)">🎧</button>
    ${delBtn}
  </div>`;
}

// ── Initialisation Sortable ────────────────────────────────────────
function _initMusicSortable() {
  _musicSortables.forEach(s => s.destroy()); _musicSortables = [];

  const pool = document.getElementById('vtt-music-pool');
  if (pool) {
    _musicSortables.push(new Sortable(pool, {
      group: { name: 'vtt-sounds', pull: 'clone', put: false },
      sort: false,
      animation: 120,
      ghostClass: 'vtt-sort-ghost',
      filter: '.vtt-mact',
      handle: '.vtt-music-pool-grip,.vtt-music-pool-name',
    }));
  }

  document.querySelectorAll('.vtt-pl-drop').forEach(el => {
    const plId = el.dataset.plId;
    _musicSortables.push(new Sortable(el, {
      group: { name: 'vtt-sounds', pull: false, put: true },
      animation: 120,
      ghostClass: 'vtt-sort-ghost',
      filter: '.vtt-music-pl-empty-drop,.vtt-mact',
      handle: '.vtt-music-pool-grip,.vtt-music-pl-sname',
      onAdd: async evt => {
        const soundId = evt.item.dataset.soundId;
        evt.item.remove(); // Sortable a cloné → on supprime, Firestore va re-render
        const pl = _playlists.find(p=>p.id===plId); if (!pl||!soundId) return;
        if ((pl.soundIds||[]).includes(soundId)) return;
        await updateDoc(_playlistRef(plId), { soundIds:[...(pl.soundIds||[]), soundId] }).catch(()=>{});
      },
      onUpdate: async evt => {
        const pl = _playlists.find(p=>p.id===plId); if (!pl) return;
        const items = [...el.querySelectorAll('[data-sound-id]')];
        const newOrder = items.map(i=>i.dataset.soundId).filter(Boolean);
        await updateDoc(_playlistRef(plId), { soundIds: newOrder }).catch(()=>{});
      },
    }));
  });
}

function _renderNowPlaying(curSound, ms) {
  const mj = STATE.isAdmin;
  const pl = ms.currentPlaylistId ? _playlists.find(p=>p.id===ms.currentPlaylistId) : null;
  return `<div class="vtt-music-np">
    <div class="vtt-music-np-name">${curSound
      ? `🎵 ${_esc(curSound.name)}${pl?` · <em>${_esc(pl.name)}</em>`:''}${ms.loop?' 🔁':''}${ms.shuffle?' 🔀':''}`
      : '<span style="color:var(--text-dim)">— Rien en lecture —</span>'
    }</div>
    ${curSound ? `<div class="vtt-music-prog-row">
      <div class="vtt-music-prog-bar"${mj?' data-vtt-fn="_vttSeek" data-vtt-args="event|$this"':''} style="${mj?'':'cursor:default'}">
        <div class="vtt-music-prog-fill" id="vtt-music-prog-fill" style="width:0%"></div>
      </div>
      <span class="vtt-music-prog-time" id="vtt-music-prog-time">0:00 / 0:00</span>
    </div>` : ''}
    <div class="vtt-music-ctrl-row">
      ${mj && curSound ? `
        <button class="vtt-music-ctrl" data-vtt-fn="_vttToggleMusicPause" title="${ms.paused?'Reprendre':'Pause'}">${ms.paused?'▶':'⏸'}</button>
        ${pl?`<button class="vtt-music-ctrl" data-vtt-fn="_vttMusicNext" title="Suivant">⏭</button>`:''}
        <button class="vtt-music-ctrl" data-vtt-fn="_vttStopMusic" title="Arrêter">⏹</button>
      ` : ''}
      <label class="vtt-music-vol-lbl">🔊<input type="range" id="vtt-music-vol" class="vtt-music-vol-inp" min="0" max="100" step="1"></label>
    </div>
  </div>`;
}

// ── Seek sur clic barre de progression ─────────────────────────────
function _vttSeek(e, bar) {
  if (!_audioEl || !_audioEl.duration) return;
  const rect = bar.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  _audioEl.currentTime = ratio * _audioEl.duration;
  _updateMusicProg();
}

// ── Lecture / contrôles ─────────────────────────────────────────────
async function _vttPlaySound(soundId, loop) {
  const ms = _musicState;
  // Toggle si même son sans playlist
  if (ms.playing && ms.currentSoundId===soundId && !ms.currentPlaylistId && !!ms.loop===!!loop)
    return _vttStopMusic();
  await _setMusicState({ playing:true, paused:false, currentSoundId:soundId,
    currentPlaylistId:null, loop:!!loop, shuffle:false,
    startedAt:serverTimestamp() });
}

async function _vttPlayPlaylist(playlistId, shuffle) {
  const pl = _playlists.find(p=>p.id===playlistId);
  if (!pl || !pl.soundIds?.length) return;
  const ms = _musicState;
  // Toggle si même playlist + même mode
  if (ms.playing && ms.currentPlaylistId===playlistId && !!ms.shuffle===!!shuffle)
    return _vttStopMusic();
  // Ordre (Fisher-Yates si shuffle)
  const order = pl.soundIds.map((_,i)=>i);
  if (shuffle) {
    for (let i=order.length-1;i>0;i--) {
      const j=Math.floor(Math.random()*(i+1));
      [order[i],order[j]]=[order[j],order[i]];
    }
  }
  await _setMusicState({ playing:true, paused:false,
    currentSoundId:pl.soundIds[order[0]], currentPlaylistId:playlistId,
    loop:false, shuffle:!!shuffle, shuffleOrder:order, playlistIndex:0,
    startedAt:serverTimestamp() });
}

async function _vttMusicNext() {
  const ms = _musicState;
  if (!ms.currentPlaylistId) return;
  const pl = _playlists.find(p=>p.id===ms.currentPlaylistId); if (!pl) return;
  const order = ms.shuffleOrder || pl.soundIds.map((_,i)=>i);
  const nextIdx = ((ms.playlistIndex||0) + 1) % order.length;
  await _setMusicState({ ...ms, playlistIndex:nextIdx,
    currentSoundId:pl.soundIds[order[nextIdx]], startedAt:serverTimestamp() });
}

async function _vttToggleMusicPause() {
  const paused = !_musicState.paused;
  if (_audioEl) { paused ? _audioEl.pause() : _audioEl.play().catch(()=>{}); }
  await _setMusicState({ ..._musicState, paused });
}

async function _vttStopMusic() {
  _killAudio();
  await _setMusicState({ playing:false, paused:false, currentSoundId:null, currentPlaylistId:null });
}

function _killAudio() {
  if (_audioEl) {
    _audioEl.pause();
    if (_audioEl._endedHandler)  _audioEl.removeEventListener('ended', _audioEl._endedHandler);
    if (_audioEl._errorHandler)  _audioEl.removeEventListener('error', _audioEl._errorHandler);
    _audioEl.src=''; _audioEl=null;
  }
  clearInterval(_musicProgTimer); _musicProgTimer=null;
}

async function _setMusicState(patch) {
  if (!_aid()) return;
  await setDoc(_musicStateRef(), patch, {merge:true}).catch(()=>{});
}

// ── Sync lecture ────────────────────────────────────────────────────
function _syncMusicPlayback(ms) {
  _musicState = ms;
  const panel = document.getElementById('vtt-music-panel');

  if (!ms.playing || !ms.currentSoundId) {
    _killAudio();
    if (panel?.dataset.open==='1') _renderMusicPanel();
    return;
  }

  if (ms.paused) {
    if (_audioEl && !_audioEl.paused) _audioEl.pause();
    if (panel?.dataset.open==='1') _renderMusicPanel();
    return;
  }

  const sound = _sounds.find(s=>s.id===ms.currentSoundId);
  if (!sound) {
    const loader = STATE.isAdmin
      ? _startMusicCatalogListeners().then(() => _sounds.find(s => s.id === ms.currentSoundId) || null)
      : _loadMusicSoundById(ms.currentSoundId);
    loader.then(found => {
      if (found && _musicState?.currentSoundId === ms.currentSoundId) _syncMusicPlayback(_musicState);
      else if (panel?.dataset.open==='1') _renderMusicPanel();
    });
    if (panel?.dataset.open==='1') _renderMusicPanel();
    return;
  }

  // Même son déjà en lecture → pas de restart
  if (_audioEl && _audioEl.dataset.soundId===ms.currentSoundId && !_audioEl.paused && !_audioEl.ended) {
    _audioEl.loop = ms.loop ?? false;
    if (panel?.dataset.open==='1') _renderMusicPanel();
    return;
  }

  // Nouveau son
  _killAudio();
  const el = new Audio(sound.url);
  el.dataset.soundId = ms.currentSoundId;
  el.volume = _getUserVolume();
  el.loop = ms.loop ?? false;

  // Sync temps (non-loop uniquement)
  if (ms.startedAt && !ms.loop) {
    el.addEventListener('loadedmetadata', () => {
      const elapsed = (Date.now() - (ms.startedAt?.toMillis?.() ?? Date.now())) / 1000;
      if (elapsed < el.duration - 0.5) el.currentTime = elapsed;
    }, {once:true});
  }

  // Auto-avance playlist (MJ uniquement pour éviter les doublons)
  if (ms.currentPlaylistId && STATE.isAdmin) {
    el._endedHandler = () => _vttMusicNext();
    el.addEventListener('ended', el._endedHandler);
  }

  // Erreur de chargement (URL inaccessible, format non supporté…)
  el._errorHandler = () => {
    const codes = {1:'Chargement interrompu', 2:'Erreur réseau', 3:'Décodage impossible', 4:'URL inaccessible'};
    const msg = codes[el.error?.code] ?? 'Erreur audio inconnue';
    console.error('[vtt music] audio error:', el.error?.code, el.error?.message, sound.url);
    showNotif(`🔇 ${msg} — vérifier l'URL du son`, 'error');
    _killAudio();
    if (document.getElementById('vtt-music-panel')?.dataset.open==='1') _renderMusicPanel();
  };
  el.addEventListener('error', el._errorHandler, {once:true});

  // Démarre le timer de progression seulement quand les métadonnées sont chargées
  el.addEventListener('loadedmetadata', () => {
    _updateMusicProg();
    if (!_musicProgTimer) _musicProgTimer = setInterval(_updateMusicProg, 500);
  }, {once:true});

  el.play().catch(err => {
    if (err.name === 'NotAllowedError')
      showNotif('🔇 Cliquez sur la page pour activer le son', 'info');
    else
      console.error('[vtt music] play() error:', err.name, err.message);
  });
  _audioEl = el;
  if (panel?.dataset.open==='1') _renderMusicPanel();
}

// ── Menu contextuel son ──────────────────────────────────────────────
// currentPlId : playlist d'où vient le clic (undefined = pool)
function _vttSoundCtxMenu(e, soundId, currentPlId) {
  if (!_playlists.length) return;
  const sound = _sounds.find(s=>s.id===soundId); if (!sound) return;

  const items = [];

  // Playlists cibles (exclut celle d'où il vient s'il y est déjà)
  const targets = _playlists.filter(pl =>
    pl.id !== currentPlId && !(pl.soundIds||[]).includes(soundId)
  );
  if (targets.length) {
    items.push({ label: `<span style="color:var(--text-dim);font-size:.65rem">Ajouter à…</span>`, fn: null });
    targets.forEach(pl => items.push({
      label: `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${pl.color||'#6366f1'};margin-right:.4rem"></span>${_esc(pl.name)}`,
      fn: () => _vttAddSoundToPlaylist(pl.id, soundId),
    }));
  }

  // Retirer de la playlist courante
  if (currentPlId) {
    if (items.length) items.push('---');
    items.push({ label: '✕ Retirer de cette playlist', fn: () => _vttRemoveSoundFromPlaylist(currentPlId, soundId) });
  }

  if (items.length) _showCtxMenu(e.clientX, e.clientY, items);
}

// ── Import GitHub Release ────────────────────────────────────────────
async function _vttImportGithubRelease() {
  const LS_REPO = 'vtt-music-gh-repo', LS_TAG = 'vtt-music-gh-tag';
  const defRepo = localStorage.getItem(LS_REPO) || 'ConseillerDoriantation/le-grand-jdr';
  const defTag  = localStorage.getItem(LS_TAG)  || 'sounds-v1';
  const repo = prompt('Repo GitHub (owner/repo) :', defRepo)?.trim(); if (!repo) return;
  const tag  = prompt('Tag de la release :', defTag)?.trim();          if (!tag)  return;
  localStorage.setItem(LS_REPO, repo); localStorage.setItem(LS_TAG, tag);

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`);
    if (!res.ok) { showNotif(`Release introuvable (${res.status})`, 'error'); return; }
    const data = await res.json();
    const audioExts = /\.(mp3|ogg|wav|flac|m4a|aac)$/i;
    const assets = (data.assets||[]).filter(a => audioExts.test(a.name));
    if (!assets.length) { showNotif('Aucun fichier audio dans cette release', 'info'); return; }

    const existingUrls = new Set(_sounds.map(s => s.url));
    const newAssets = assets.filter(a => !existingUrls.has(a.browser_download_url));
    if (!newAssets.length) { showNotif('Tous ces sons sont déjà importés', 'info'); return; }

    for (const a of newAssets) {
      const name = a.name.replace(/\.[^.]+$/, '').replace(/[._-]+/g, ' ').trim();
      await addDoc(_sonsCol(), { name, url: a.browser_download_url, createdAt: serverTimestamp(), addedBy: STATE.user?.uid||null });
    }
    showNotif(`✅ ${newAssets.length} son(s) importé(s)`, 'success');
  } catch(e) {
    console.error('[vtt music] github import:', e);
    showNotif('Erreur lors de l\'import GitHub', 'error');
  }
}

// ── Ajout d'un son par URL ───────────────────────────────────────────
async function _vttAddSonUrl() {
  const url  = prompt('URL directe du fichier audio (mp3, ogg, wav…) :')?.trim();
  if (!url) return;
  const name = prompt('Nom du son :', url.split('/').pop()?.replace(/\.[^.]+$/,'') || 'Son')?.trim();
  if (!name) return;
  await addDoc(_sonsCol(), { name, url, createdAt:serverTimestamp(), addedBy:STATE.user?.uid||null });
  showNotif(`✅ "${name}" ajouté`, 'success');
}

async function _vttDeleteSound(soundId) {
  const s = _sounds.find(x=>x.id===soundId); if (!s) return;
  if (!await confirmModal(`Supprimer "${s.name}" ?`)) return;
  if (_musicState.currentSoundId===soundId) await _vttStopMusic();
  for (const pl of _playlists.filter(p=>(p.soundIds||[]).includes(soundId)))
    await updateDoc(_playlistRef(pl.id), { soundIds:(pl.soundIds||[]).filter(id=>id!==soundId) }).catch(()=>{});
  await deleteDoc(_sonRef(soundId)).catch(()=>{});
}

// ── Playlists ───────────────────────────────────────────────────────
function _vttCreatePlaylist() {
  const colors = ['#6366f1','#22c38e','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899'];
  const defColor = colors[_playlists.length % colors.length];
  openModal('Nouvelle playlist', `
    <div style="display:flex;flex-direction:column;gap:.9rem">
      <div>
        <label class="vtt-pl-modal-lbl">Nom</label>
        <input id="vtt-pl-name-inp" type="text" class="vtt-pl-modal-inp"
          placeholder="Ex : Donjon, Combat, Ambiance…"
          data-vtt-fn="_vttCreatePlaylistConfirm" data-vtt-on="keydown-enter">
      </div>
      <div>
        <label class="vtt-pl-modal-lbl">Couleur</label>
        <div class="vtt-pl-color-row">
          ${colors.map(c=>`<button type="button" class="vtt-pl-color-btn${c===defColor?' sel':''}"
            data-color="${c}" style="background:${c}"
            data-vtt-fn="_vttPlColorSelect" data-vtt-args="$this">
          </button>`).join('')}
        </div>
      </div>
      <button class="vtt-pl-modal-submit" data-vtt-fn="_vttCreatePlaylistConfirm">Créer la playlist</button>
    </div>`);
  setTimeout(() => { document.getElementById('vtt-pl-name-inp')?.focus(); }, 60);
}

async function _vttCreatePlaylistConfirm() {
  const name  = document.getElementById('vtt-pl-name-inp')?.value?.trim(); if (!name) return;
  const color = document.querySelector('.vtt-pl-color-btn.sel')?.dataset.color || '#6366f1';
  closeModalDirect();
  await addDoc(_playlistsCol(), { name, color, soundIds:[], createdAt:serverTimestamp() });
}

async function _vttDeletePlaylist(plId) {
  const pl = _playlists.find(p=>p.id===plId); if (!pl) return;
  if (!await confirmModal(`Supprimer la playlist "${pl.name}" ?`)) return;
  if (_musicState.currentPlaylistId===plId) await _vttStopMusic();
  await deleteDoc(_playlistRef(plId)).catch(()=>{});
}

async function _vttAddSoundToPlaylist(plId, soundId) {
  if (!soundId) return;
  const pl = _playlists.find(p=>p.id===plId); if (!pl) return;
  if ((pl.soundIds||[]).includes(soundId)) return;
  await updateDoc(_playlistRef(plId), { soundIds:[...(pl.soundIds||[]), soundId] }).catch(()=>{});
}

async function _vttRemoveSoundFromPlaylist(plId, soundId) {
  const pl = _playlists.find(p=>p.id===plId); if (!pl) return;
  await updateDoc(_playlistRef(plId), { soundIds:(pl.soundIds||[]).filter(id=>id!==soundId) }).catch(()=>{});
}

// ═══════════════════════════════════════════════════════════════════
// TIMER DE SESSION — partagé via _session.timer, visible par tous
// ═══════════════════════════════════════════════════════════════════
function _timerElapsedMs() {
  const t = _session?.timer;
  if (!t) return 0;
  const acc = +t.accumulated || 0;
  if (t.running && t.startedAt) return acc + Math.max(0, Date.now() - (+t.startedAt));
  return acc;
}
function _timerFmt(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}
function _renderTimer() {
  const el = document.getElementById('vtt-timer');
  if (!el) return;
  const t = _session?.timer || {};
  const mj = STATE.isAdmin;
  const running = !!t.running;
  const label = (t.label || '').toString().slice(0, 40);
  const ms = _timerElapsedMs();
  const idle = ms === 0 && !running && !label;

  // Joueur sans timer actif et sans label → on cache
  if (!mj && idle) { el.innerHTML = ''; el.classList.remove('vtt-timer--on'); return; }

  el.classList.toggle('vtt-timer--on', running);
  el.classList.toggle('vtt-timer--paused', !running && ms > 0);
  el.innerHTML = `
    <span class="vtt-timer-ico" title="${running ? 'En cours' : (ms > 0 ? 'En pause' : 'Arrêté')}">${running ? '⏱️' : (ms > 0 ? '⏸️' : '⏱️')}</span>
    <span class="vtt-timer-val">${_timerFmt(ms)}</span>
    ${label ? `<span class="vtt-timer-label" title="${_esc(label)}">${_esc(label)}</span>` : ''}
    ${mj ? `
      <span class="vtt-timer-ctrls">
        <button class="vtt-timer-btn" data-vtt-fn="_vttTimerToggle" title="${running ? 'Mettre en pause' : (ms > 0 ? 'Reprendre' : 'Démarrer')}">${running ? '⏸' : '▶'}</button>
        <button class="vtt-timer-btn" data-vtt-fn="_vttTimerReset" title="Réinitialiser">↺</button>
        <button class="vtt-timer-btn" data-vtt-fn="_vttTimerLabel" title="Modifier le libellé (Combat, Repos, Énigme…)">🏷</button>
      </span>` : ''}
  `;
}
function _timerStartTick() {
  if (_timerTick) return;
  _timerTick = setInterval(() => {
    if (_session?.timer?.running) _renderTimer();
  }, 1000);
}
function _timerStopTick() {
  if (_timerTick) { clearInterval(_timerTick); _timerTick = null; }
}

async function _vttTimerToggle() {
  if (!STATE.isAdmin) return;
  const t = _session?.timer || {};
  const now = Date.now();
  if (t.running && t.startedAt) {
    const acc = (+t.accumulated || 0) + Math.max(0, now - (+t.startedAt));
    await setDoc(_sesRef(), { timer: { ...t, running: false, accumulated: acc, startedAt: null } }, { merge: true }).catch(()=>{});
  } else {
    await setDoc(_sesRef(), { timer: { accumulated: +t.accumulated || 0, label: t.label || '', running: true, startedAt: now } }, { merge: true }).catch(()=>{});
  }
}
async function _vttTimerReset() {
  if (!STATE.isAdmin) return;
  const ok = await confirmModal('Réinitialiser le minuteur à 00:00 ?', { title: '↺ Reset minuteur', okLabel: 'Réinitialiser', cancelLabel: 'Annuler' }).catch(()=>false);
  if (!ok) return;
  const t = _session?.timer || {};
  await setDoc(_sesRef(), { timer: { running: false, accumulated: 0, startedAt: null, label: t.label || '' } }, { merge: true }).catch(()=>{});
}
async function _vttTimerLabel() {
  if (!STATE.isAdmin) return;
  const cur = _session?.timer?.label || '';
  const next = prompt('Libellé du minuteur (laisser vide pour effacer) :', cur);
  if (next === null) return;
  const t = _session?.timer || {};
  await setDoc(_sesRef(), { timer: { ...t, label: next.trim().slice(0, 40) } }, { merge: true }).catch(()=>{});
}

// ═══════════════════════════════════════════════════════════════════
// COMBAT TRACKER — overlay haut-gauche, visible quand combat actif
// ═══════════════════════════════════════════════════════════════════
function _trackerPortrait(ld, t) {
  // Photo prioritaire : fiche perso/PNJ via _live (champ displayImage)
  const url = ld.displayImage || null;
  if (url) return `<img class="vct-photo" src="${url}" alt="">`;
  const init = ((ld.displayName || t.name || '?').trim()[0] || '?').toUpperCase();
  return `<div class="vct-photo vct-photo-init">${init}</div>`;
}
function _trackerRow(t) {
  const ld = _live(t);
  const moved = !!t.movedThisTurn || (t.movedCells || 0) > 0;
  const acted = !!t.attackedThisTurn;
  const bonusActed = !!t.bonusActionThisTurn;
  const reacted = !!t.reactionThisTurn;
  const done  = moved && acted;
  const partial = moved !== acted;
  const cls = done ? "vct-row--done" : (partial ? "vct-row--partial" : "vct-row--todo");
  const name = _esc(ld.displayName || t.name || "—");
  const turnPill = (field, active, icon, title) => STATE.isAdmin
    ? `<button type="button" class="vct-pill vct-pill--toggle ${active ? "vct-pill--on" : ""}" data-vtt-fn="_vttToggleTurnFlag" data-vtt-args="${t.id}|${field}" title="${title} — cliquer pour modifier">${icon} ${active ? "✓" : "·"}</button>`
    : `<span class="vct-pill ${active ? "vct-pill--on" : ""}" title="${title}">${icon} ${active ? "✓" : "·"}</span>`;
  return `
    <div class="vct-row ${cls}" data-tok="${t.id}" data-vtt-fn="_vttTrackerFocus" data-vtt-args="${t.id}" title="Cliquer pour centrer sur ce token">
      ${_trackerPortrait(ld, t)}
      <div class="vct-info">
        <div class="vct-name">${name}</div>
        <div class="vct-status">
          <span class="vct-pill ${moved ? "vct-pill--on" : ""}" title="Déplacement effectué">🏃 ${moved ? "✓" : "·"}</span>
          <span class="vct-pill ${acted ? "vct-pill--on" : ""}" title="Action effectuée">⚔ ${acted ? "✓" : "·"}</span>
          ${turnPill("bonusActionThisTurn", bonusActed, "✦", "Action bonus effectuée")}
          ${turnPill("reactionThisTurn", reacted, "⚡", "Réaction effectuée")}
        </div>
      </div>
    </div>`;
}
function _renderCombatTracker() {
  const el = document.getElementById('vtt-combat-tracker');
  if (!el) return;
  const active = !!_session?.combat?.active;
  const mj = STATE.isAdmin;

  // Combat inactif :
  //   - MJ → carte compacte avec bouton "Démarrer le combat"
  //   - Joueur → masqué
  if (!active) {
    if (!mj) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'block';
    el.innerHTML = `
      <div class="vct-header vct-header--idle">
        <div class="vct-title">
          <span class="vct-title-ico">⚔️</span>
          <span class="vct-title-txt vct-title-txt--idle">Combat</span>
        </div>
        <button class="vct-mj-btn vct-mj-btn--start" data-vtt-fn="_vttToggleCombat" title="Démarrer le combat — reset déplacement et actions de tous les tokens">▶ Démarrer</button>
      </div>`;
    return;
  }
  el.style.display = 'block';

  const round = _session?.combat?.round ?? 1;
  const pageId = _activePage?.id;
  const onPage = Object.values(_tokens).map(x => x?.data || x).filter(t => t && t.pageId === pageId);
  const allies = onPage.filter(t => t.type === 'player' || t.type === 'npc');
  const enemies = onPage.filter(t => t.type === 'enemy');

  // tab par défaut "allies" — joueurs non-MJ ne voient pas l'onglet ennemis
  const tab = (!mj && _combatTab === 'enemies') ? 'allies' : _combatTab;
  const list = tab === 'enemies' ? enemies : allies;

  // tri : joueurs d'abord, puis PNJ ; ennemis par HP% croissant
  if (tab === 'allies') {
    list.sort((a, b) => {
      const r = (a.type === 'player' ? 0 : 1) - (b.type === 'player' ? 0 : 1);
      if (r !== 0) return r;
      const na = _live(a).displayName || a.name || '';
      const nb = _live(b).displayName || b.name || '';
      return na.localeCompare(nb);
    });
  }

  const rows = list.length
    ? list.map(_trackerRow).join('')
    : `<div class="vct-empty">${tab === 'enemies' ? 'Aucun ennemi sur la page' : 'Aucun token allié sur la page'}</div>`;

  el.innerHTML = `
    <div class="vct-header">
      <div class="vct-title">
        <span class="vct-title-ico">⚔️</span>
        <span class="vct-title-txt">Combat</span>
        <span class="vct-round">Tour ${round}</span>
      </div>
      ${mj ? `
        <div class="vct-mj-ctrls">
          <button class="vct-mj-btn" data-vtt-fn="_vttNextRound" title="Tour suivant — reset déplacement et actions">▶ Tour</button>
          <button class="vct-mj-btn vct-mj-btn--danger" data-vtt-fn="_vttToggleCombat" title="Terminer le combat">⏹</button>
        </div>` : ''}
    </div>
    ${mj ? `
      <div class="vct-tabs">
        <button class="vct-tab ${tab==='allies' ? 'active' : ''}" data-vtt-fn="_vttCombatTab" data-vtt-args="allies">👥 Joueurs &amp; PNJ <span class="vct-tab-count">${allies.length}</span></button>
        <button class="vct-tab ${tab==='enemies' ? 'active' : ''}" data-vtt-fn="_vttCombatTab" data-vtt-args="enemies">👹 Ennemis <span class="vct-tab-count">${enemies.length}</span></button>
      </div>` : ''}
    <div class="vct-list">${rows}</div>
  `;
}
// Re-render groupé via microtask (évite les multi-rerender lors d'un batch reset)
let _trackerDirty = false;
function _renderCombatTrackerSoon() {
  if (_trackerDirty) return;
  _trackerDirty = true;
  queueMicrotask(() => { _trackerDirty = false; _renderCombatTracker(); });
}

function _vttCombatTab(tab) {
  if (tab !== 'allies' && tab !== 'enemies') return;
  if (tab === 'enemies' && !STATE.isAdmin) return;
  _combatTab = tab;
  _renderCombatTracker();
}
function _vttTrackerFocus(tokId) {
  // Centrer/sélectionner le token cliqué
  const t = _tokens[tokId]?.data;
  if (!t) return;
  if (STATE.isAdmin || t.type !== 'enemy') {
    try { _select(tokId); } catch {}
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
    <div class="vtt-tool-group vtt-right">
      ${mj?`
        <button class="vtt-btn-sm vtt-session-btn" id="vtt-session-btn" data-vtt-fn="_vttToggleSessionLive" title="Démarrer / terminer la session — prévient les joueurs qui rejoignent">⚪ Session</button>
        <button class="vtt-btn-sm" id="vtt-map-mode-btn" data-vtt-fn="_vttToggleMapMode" title="Verrouille / déverrouille le calque des cartes en arrière-plan">🗺 Carte</button>
        <label  class="vtt-btn-sm vtt-upload-lbl" title="Upload une image via Cloudinary — sauvegardée dans la bibliothèque">⬆ Upload<input type="file" id="vtt-img-input" accept="image/*" hidden></label>
        <button class="vtt-btn-sm" data-vtt-fn="_vttSetImgbbKey" title="Configurer Cloudinary (cloud name + upload preset)">🔑</button>`:''}
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
          <button class="vtt-tray-add-btn" data-vtt-fn="_vttAddPage" title="Nouvelle page">＋</button>
        </div>
        <div id="vtt-tray-pages"><div class="vtt-tray-empty">Chargement…</div></div>
      </div>
      <div class="vtt-tray-section">
        <div id="vtt-tray-tokens"></div>
      </div>
      <div class="vtt-tray-section vtt-tray-section--lib">
        <div class="vtt-tray-section-hd vtt-tray-collapsible" data-vtt-fn="_vttLibToggle">
          <span>📁 Bibliothèque</span>
          <div style="display:flex;gap:3px;align-items:center">
            <button class="vtt-tray-add-btn" data-vtt-fn="_vttLibNewFolder" title="Nouveau dossier">📁</button>
            <span id="vtt-lib-toggle" class="vtt-tray-count open">▲</span>
          </div>
        </div>
        <div id="vtt-tray-library"></div>
      </div>
    </div>`:''}
    <div class="vtt-canvas-wrap" id="vtt-canvas-wrap"></div>
    <div class="vtt-right-col" id="vtt-right-col">
      <div class="vtt-inspector" id="vtt-inspector">
        <div class="vtt-ins-empty"><div style="font-size:1.8rem">🎲</div>Sélectionne un token</div>
      </div>
      <div class="vtt-chat">
        <div class="vtt-chat-hd">💬 Chat &amp; Dés</div>
        <div class="vtt-chat-log" id="vtt-chat-log"></div>
        <div class="vtt-chat-reply-bar" id="vtt-chat-reply-bar" style="display:none"></div>
        <div class="vtt-chat-input-row">
          <input type="text" id="vtt-chat-input" class="vtt-chat-input" placeholder="Message…"
            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
            data-vtt-fn="_vttSendChat" data-vtt-on="keydown-enter">
          <button class="vtt-chat-send" data-vtt-fn="_vttSendChat" title="Envoyer">↵</button>
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
  _vttEntered = false;                 // nouvelle navigation → re-passage par le sas
  const content=document.getElementById('main-content');
  if (!content) return;
  content.style.overflow='hidden';
  content.style.height='100vh';
  content.style.paddingBottom='0';
  // Le MJ pilote la table → il entre directement. Les JOUEURS passent par un SAS :
  // ils ne s'abonnent à AUCUN listener Firestore tant qu'ils n'ont pas cliqué
  // « Entrer » → grosse économie de quota pour ceux qui ouvrent sans jouer.
  if (STATE.isAdmin) { _vttEntered = true; return _vttMountTable(content); }
  content.innerHTML = appSplashHtml('Connexion à la table…');
  let _ses = {};
  try { const _snap = await getDoc(_sesRef()); _ses = _snap.exists() ? _snap.data() : {}; } catch {}
  // Si on a quitté la page entre-temps, ne rien afficher.
  if (document.getElementById('main-content') !== content) return;
  content.innerHTML = _vttGateHtml(!!_ses.live, _ses);
}

// Sas d'entrée joueur : aucun listener tant qu'on n'a pas cliqué « Entrer ».
function _vttGateHtml(live, ses = {}) {
  const since = live && ses.liveSince ? _vttSessionSince(ses.liveSince) : '';
  return `<div class="vtt-gate">
    <div class="vtt-gate-card ${live ? 'is-live' : ''}">
      <div class="vtt-gate-ico">${live ? '🔴' : '🎲'}</div>
      <h2 class="vtt-gate-title">${live ? 'Session de jeu en cours' : 'Table virtuelle'}</h2>
      <p class="vtt-gate-text">${live
        ? `Le MJ a déclaré une <b>session en cours</b>${since ? ` (démarrée ${since})` : ''}.<br>Tu peux rejoindre la table maintenant — ou revenir plus tard.`
        : `Aucune session déclarée pour le moment.<br>Tu peux entrer pour explorer la table.`}</p>
      <div class="vtt-gate-actions">
        <button class="btn btn-gold" data-vtt-fn="_vttEnterTable">➡ Entrer dans la table</button>
        <button class="btn btn-outline" data-vtt-fn="_vttGateBack">← Plus tard</button>
      </div>
      <p class="vtt-gate-note">💡 Tant que tu n'es pas entré, tu ne consommes aucune ressource temps réel.</p>
    </div>
  </div>`;
}
function _vttSessionSince(ts) {
  const ms = ts?.seconds ? ts.seconds * 1000 : (typeof ts === 'number' ? ts : 0);
  if (!ms) return '';
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  return `il y a ${h} h`;
}
async function _vttGateBack() {
  const { navigate } = await import('../core/navigation.js');
  navigate('dashboard');
}
async function _vttEnterTable() {
  _vttEntered = true;
  const content = document.getElementById('main-content');
  if (content) await _vttMountTable(content);
}

async function _vttMountTable(content) {
  content.innerHTML = appSplashHtml('Chargement de la table…');
  // Lancer en parallèle : téléchargement Konva + reads Firestore non critiques
  const _konvaP   = _loadKonva();
  const _emotesP  = _loadEmotes();
  const _skillsP  = _loadDiceSkills();
  const _formatsP = Promise.all([loadWeaponFormats(), loadDamageTypes()]);
  try { await _konvaP; }
  catch {
    content.innerHTML='<div style="padding:2rem;color:var(--text-dim)">Impossible de charger Konva.js.</div>';
    content.style.overflow=''; return;
  }
  content.innerHTML=_buildHtml();
  // Overlay "tourne ton téléphone" — visible uniquement en portrait sur petit
  // écran (piloté par media-query CSS). En paysage il disparaît et la table
  // s'utilise nativement (tactile correct, pas de rotation CSS du canvas).
  content.insertAdjacentHTML('beforeend', `
    <div class="vtt-rotate-prompt" aria-hidden="true">
      <div class="vtt-rotate-phone">📱</div>
      <div class="vtt-rotate-title">Tourne ton téléphone</div>
      <div class="vtt-rotate-text">La Table Virtuelle s'utilise en mode paysage.</div>
    </div>`);
  const wrap=document.getElementById('vtt-canvas-wrap');
  if (!wrap) return;
  _initCanvas(wrap);
  _timerStartTick();
  // Floats injectés APRÈS Konva pour être au-dessus des canvas layers
  const _tf = document.createElement('div');
  _tf.className = 'vtt-tool-float';
  _tf.innerHTML = `
    <div class="vtt-tool-float-tools">
      <button class="vtt-tool active" data-tool="select" data-vtt-fn="_vttTool" data-vtt-args="select" title="↖ Sélection">↖</button>
      <button class="vtt-tool" data-tool="ruler"  data-vtt-fn="_vttTool" data-vtt-args="ruler"  title="📏 Règle (R) — clic gauche pour mesurer · clic droit pour annuler">📏</button>
      <button class="vtt-tool" data-tool="draw"   data-vtt-fn="_vttTool" data-vtt-args="draw"   title="✏️ Dessin">✏️</button>
      ${STATE.isAdmin?`<button class="vtt-tool" data-tool="walls" data-vtt-fn="_vttTool" data-vtt-args="walls" title="🧱 Murs / Éclairage dynamique">🧱</button>`:''}
    </div>
    <div id="vtt-draw-bar" class="vtt-draw-bar" style="display:none">
      <div class="vtt-draw-row">
        <span class="vtt-draw-glabel">Forme</span>
        <div class="vtt-draw-group">
          <button class="vtt-draw-btn active" id="vtt-ds-pencil"  data-vtt-fn="_vttDrawShape" data-vtt-args="pencil"  title="Crayon libre">✏️</button>
          <button class="vtt-draw-btn"        id="vtt-ds-line"    data-vtt-fn="_vttDrawShape" data-vtt-args="line"    title="Ligne">╱</button>
          <button class="vtt-draw-btn"        id="vtt-ds-rect"    data-vtt-fn="_vttDrawShape" data-vtt-args="rect"    title="Rectangle">⬜</button>
          <button class="vtt-draw-btn"        id="vtt-ds-circle"  data-vtt-fn="_vttDrawShape" data-vtt-args="circle"  title="Cercle">⬭</button>
          <button class="vtt-draw-btn"        id="vtt-ds-eraser"  data-vtt-fn="_vttDrawShape" data-vtt-args="eraser"  title="Gomme — passe sur un tracé pour l'effacer">🧽</button>
        </div>
      </div>
      <div class="vtt-draw-row">
        <span class="vtt-draw-glabel">Couleur</span>
        <div class="vtt-draw-group vtt-draw-colors">
          ${['#ef4444','#ff8c42','#f59e0b','#ffe600','#22c38e','#14b8a6','#4f8cff','#8b5cf6','#b47fff','#ec4899','#ffffff','#9ca3af','#1a1a2e'].map((c,i)=>
            `<button class="vtt-draw-color${i===0?' active':''}" data-color="${c}" data-vtt-fn="_vttDrawColor" data-vtt-args="${c}" style="background:${c}" title="${c}"></button>`
          ).join('')}
        </div>
      </div>
      <div class="vtt-draw-row">
        <span class="vtt-draw-glabel">Trait</span>
        <div class="vtt-draw-group">
          ${[2,4,6,10,16].map((w,i)=>
            `<button class="vtt-draw-wbtn${i===0?' active':''}" data-w="${w}" data-vtt-fn="_vttDrawWidth" data-vtt-args="${w}" title="${w}px"><span class="vtt-draw-wdot" style="width:${Math.min(w,14)}px;height:${Math.min(w,14)}px"></span></button>`
          ).join('')}
        </div>
      </div>
      <div class="vtt-draw-row">
        <span class="vtt-draw-glabel">Actions</span>
        <div class="vtt-draw-group">
          <button class="vtt-draw-btn" id="vtt-draw-fill-btn" data-vtt-fn="_vttToggleDrawFill" title="Remplir les rectangles/cercles">◻</button>
          <button class="vtt-draw-btn" id="vtt-draw-undo-btn" data-vtt-fn="_vttUndoDraw" title="Annuler le dernier tracé (Ctrl+Z)">↩</button>
          ${STATE.isAdmin?`<button class="vtt-draw-btn vtt-draw-btn--danger" data-vtt-fn="_vttClearAnnots" title="Tout effacer les annotations de la page">🗑</button>`:''}
        </div>
      </div>
    </div>
    ${STATE.isAdmin?`
    <div id="vtt-walls-bar" class="vtt-walls-bar" style="display:none">
      <span class="vtt-walls-bar-label">Outil :</span>
      <button class="vtt-btn-sm active" data-fog-tool="wall"   data-vtt-fn="_vttFogTool" data-vtt-args="wall"   title="Tracer un mur">🧱 Mur</button>
      <button class="vtt-btn-sm"        data-fog-tool="door"   data-vtt-fn="_vttFogTool" data-vtt-args="door"   title="Tracer une porte">🚪 Porte</button>
      <button class="vtt-btn-sm"        data-fog-tool="window" data-vtt-fn="_vttFogTool" data-vtt-args="window" title="Tracer une fenêtre">🪟 Fenêtre</button>
      <button class="vtt-btn-sm"        data-fog-tool="light"  data-vtt-fn="_vttFogTool" data-vtt-args="light"  title="Placer une source lumineuse">💡 Lumière</button>
      <div class="vtt-tb-sep"></div>
      <button class="vtt-btn-sm"        data-fog-tool="hide"   data-vtt-fn="_vttFogTool" data-vtt-args="hide"   title="Cacher une zone (drag rectangle)">🌑 Cacher</button>
      <button class="vtt-btn-sm"        data-fog-tool="reveal" data-vtt-fn="_vttFogTool" data-vtt-args="reveal" title="Révéler une zone (drag rectangle, prioritaire sur le LOS)">🔦 Révéler</button>
      <div class="vtt-tb-sep"></div>
      <button class="vtt-btn-sm"        data-fog-tool="eraser" data-vtt-fn="_vttFogTool" data-vtt-args="eraser" title="Effacer (clic sur mur, lumière ou zone de brouillard)">🗑 Effacer</button>
      <button class="vtt-btn-sm vtt-btn-danger" data-vtt-fn="_vttFogClearOps" title="Supprimer toutes les zones de brouillard manuel de cette page">🧹 Vider brouillard</button>
      <div class="vtt-tb-sep"></div>
      <button class="vtt-btn-sm" id="vtt-fog-toggle" data-vtt-fn="_vttToggleFog" title="Activer / désactiver l'éclairage dynamique sur cette page" style="color:#9ca3af">👁 Éclairage OFF</button>
      <div class="vtt-walls-bar-hint">
        Murs : grille · Brouillard : demi-case · <kbd>Alt</kbd> = précision ×2 · <kbd>Shift</kbd> = libre · Clic segment/zone = menu<br>
        <span class="vtt-fog-legend"><span class="vtt-fog-dot vtt-fog-dot--ok"></span>sommet raccordé ·
        <span class="vtt-fog-dot vtt-fog-dot--bad"></span>sommet isolé (fuite possible) ·
        <span class="vtt-fog-dot vtt-fog-dot--snap"></span>aimantation pendant tracé</span>
      </div>
    </div>`:''}`;
  wrap.appendChild(_tf);

  // ─── Overlay haut-gauche : Timer + Combat tracker ──────────────────
  const _ovTL = document.createElement('div');
  _ovTL.className = 'vtt-overlay-tl';
  _ovTL.innerHTML = `
    <div id="vtt-timer" class="vtt-timer" aria-live="polite"></div>
    <div id="vtt-combat-tracker" class="vtt-combat-tracker" style="display:none"></div>
  `;
  wrap.appendChild(_ovTL);
  _renderTimer();
  _renderCombatTracker();
  const _ef = document.createElement('div');
  _ef.className = 'vtt-emote-float';
  _ef.innerHTML = `<div class="vtt-emote-picker" id="vtt-emote-picker"></div>
    <button class="vtt-emote-trigger" data-vtt-fn="_vttToggleEmotePicker" title="Émotes">😄</button>`;
  wrap.appendChild(_ef);
  // Float Butin (bas-gauche du canvas)
  const _lf = document.createElement('div');
  _lf.className = 'vtt-loot-float';
  _lf.innerHTML = `
    <div class="vtt-loot-panel" id="vtt-loot-panel" data-open="0" style="display:none"></div>
    <button class="vtt-loot-trigger" id="vtt-loot-trigger" data-vtt-fn="_vttToggleLoot" title="Butin d'aventure">💰</button>`;
  wrap.appendChild(_lf);
  // Float Lanceur de dés (bas-gauche du canvas, 3e bouton)
  const _drf = document.createElement('div');
  _drf.className = 'vtt-dice-float';
  _drf.innerHTML = `
    <div class="vtt-dice-panel" id="vtt-dice-panel" data-open="0" style="display:none"></div>
    <button class="vtt-dice-trigger" id="vtt-dice-trigger" data-vtt-fn="_vttToggleDice" title="Lancer des dés libres">🎲</button>`;
  wrap.appendChild(_drf);
  // Float Musique (bas-gauche du canvas, 4e bouton)
  const _mf = document.createElement('div');
  _mf.className = 'vtt-music-float';
  _mf.innerHTML = `
    <div class="vtt-music-panel" id="vtt-music-panel" data-open="0" style="display:none"></div>
    <button class="vtt-music-trigger" id="vtt-music-trigger" data-vtt-fn="_vttToggleMusic" title="Sons &amp; Musique">🎵</button>`;
  wrap.appendChild(_mf);
  // Float Court repos (bas-gauche du canvas, 5e bouton)
  const _rf = document.createElement('div');
  _rf.className = 'vtt-rest-float';
  _rf.innerHTML = `
    <div class="vtt-rest-panel" id="vtt-rest-panel" data-open="0" style="display:none">
      <div class="vtt-rest-header">💤 Court repos</div>
      <div class="vtt-rest-body" id="vtt-rest-body"></div>
    </div>
    <button class="vtt-rest-trigger" id="vtt-rest-trigger" data-vtt-fn="_vttToggleShortRest" title="Court repos du groupe">💤 0/0</button>`;
  wrap.appendChild(_rf);
  document.addEventListener('keydown',_keyHandler);
  document.getElementById('vtt-img-input')?.addEventListener('change',e=>{
    const f=e.target.files?.[0]; if (f) _handleUpload(f); e.target.value='';
  });
  // Récupérer les promesses lancées en amont (parallèles à Konva)
  _emotesP.then(() => {
    _renderEmotePicker();
    // Précharge + décode en mémoire pour affichage instantané au clic
    _emotes.forEach(em => {
      const img = new Image();
      img.src = em.url;
      img.decode().catch(() => {}); // ignore erreurs réseau / format
    });
  });
  _formatsP.then(([f, d]) => { _weaponFormats = f; _damageTypes = d; });
  // Précharge les matrices MJ (combos, armes invoquées) pour les sorts en combat
  loadSpellMatrices().then(m => { _spellMatrices = m; }).catch(() => {});
  // Précharge les overrides MJ de la librairie d'états (CONDITION_LIBRARY)
  _loadConditionsOverrides().catch(() => {});
  // _skillsP : _loadDiceSkills met à jour _diceSkills et rerend l'inspector si besoin
  void _skillsP;
  _initListeners();
  // Présence : heartbeat espacé, suspendu en arrière-plan
  const _presUid = STATE.user?.uid;
  if (_presUid) {
    const _presWrite = () => {
      // Onglet en arrière-plan : on ne dépense pas de write (la présence expire
      // à 120 s côté lecture, le joueur réapparaît dès qu'il revient sur l'onglet).
      if (document.hidden) return;
      const pseudo = STATE.profile?.pseudo || STATE.user?.email?.split('@')[0] || '?';
      const now = Date.now();
      if (now - _presLastWriteAt < 10_000) return;
      _presLastWriteAt = now;
      setDoc(_pingRef(_presUid), { pres: { pseudo, lastSeen: serverTimestamp() } }, { merge: true }).catch(() => {});
    };
    _presWrite();
    _presHeartbeat = setInterval(_presWrite, VTT_PRESENCE_HEARTBEAT_MS);
    // Retour au premier plan : ré-annoncer immédiatement sans attendre le prochain tick.
    _presVisibility = () => { if (!document.hidden) _presWrite(); };
    document.addEventListener('visibilitychange', _presVisibility);
    // Fermeture navigateur : tentative de suppression (best-effort)
    _presUnload = () => { deleteDoc(_pingRef(_presUid)).catch(()=>{}); };
    window.addEventListener('beforeunload', _presUnload);
  }
  // Filet de sécurité : re-rendre la présence toutes les 30s pour expirer les entrants inactifs
  _presRefresh = setInterval(_renderPresenceCol, 30_000);
}

// ═══════════════════════════════════════════════════════════════════
// PRÉSENCE — joueurs actifs sur le VTT
// ═══════════════════════════════════════════════════════════════════

// MJ : retire un joueur de la présence du VTT en supprimant son doc ping/présence.
// Effet : il disparaît de la colonne pour tout le monde, et son doc cesse d'être
// relu à chaque ouverture du VTT (utile pour les entrées fantômes). Un joueur
// encore actif se ré-annonce à son prochain heartbeat (≤75 s) — c'est voulu.
// MJ : déclare / termine une session de jeu en cours (vtt/session.live).
// Les joueurs qui ouvrent le VTT voient alors un message dans le sas d'entrée.
function _renderSessionBtn() {
  const btn = document.getElementById('vtt-session-btn');
  if (!btn) return;
  const live = !!_session?.live;
  btn.classList.toggle('is-live', live);
  btn.innerHTML = live ? '🔴 Session en cours' : '⚪ Démarrer la session';
  btn.title = live
    ? 'Session déclarée en cours — clique pour la terminer'
    : 'Démarrer la session (prévient les joueurs qui rejoignent)';
}
async function _vttToggleSessionLive() {
  if (!STATE.isAdmin) return;
  const live = !_session?.live;
  try {
    await setDoc(_sesRef(), live ? { live: true, liveSince: serverTimestamp() } : { live: false }, { merge: true });
    showNotif(live ? '🔴 Session déclarée en cours.' : '⏹ Session terminée.', 'success');
  } catch { showNotif('Erreur d\'enregistrement de la session.', 'error'); }
}

async function _vttKickPresence(uid) {
  if (!STATE.isAdmin || !uid) return;
  const pseudo = _presence[uid]?.pseudo || 'ce joueur';
  if (!confirm(`Retirer ${pseudo} de la présence du VTT ?\n(Réapparaîtra automatiquement s'il est toujours actif sur la table.)`)) return;
  try {
    await deleteDoc(_pingRef(uid));
    // Optimiste : retire localement sans attendre le snapshot.
    delete _presence[uid];
    if (_miniUid === uid) { _miniUid = null; _renderMiniSheet(null); }
    _renderPresenceCol();
    if (STATE.isAdmin) _renderTraySoon();
    showNotif(`${pseudo} retiré de la présence`, 'info');
  } catch (e) { console.error('[vtt] kick presence', e); showNotif('Erreur', 'error'); }
}

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
    const chars = sortCharactersForDisplay(Object.values(_characters).filter(c => c.uid === p.uid));
    // Préfère le perso ★ par défaut comme "visage" du joueur
    const char  = chars.find(c => c.id === _miniCharId)
               || chars.find(c => c.isDefault)
               || chars[0];
    const img   = char?.photoURL || char?.photo || char?.avatar || null;
    const init  = (char?.nom || p.pseudo || '?')[0].toUpperCase();
    const isOpen = _miniUid === p.uid;
    const isSelf = p.uid === myUid;
    return `<div class="vtt-pres-entry${isOpen?' is-open':''}${isSelf?' is-self':''}"
      data-vtt-fn="_vttToggleMiniSheet" data-vtt-args="${p.uid}"
      title="${p.pseudo}${char?.nom ? ' · '+char.nom : ''}">
      <div class="vtt-pres-avatar"${img?` style="background-image:url('${img}')"`:''}>
        ${img ? '' : `<span>${init}</span>`}
        ${isSelf ? '<div class="vtt-pres-self-dot"></div>' : ''}
        ${(STATE.isAdmin && !isSelf) ? `<button class="vtt-pres-kick" data-vtt-fn="_vttKickPresence" data-vtt-args="${p.uid}" title="Retirer ${_esc(p.pseudo)} de la présence" aria-label="Retirer de la présence">✕</button>` : ''}
      </div>
      <div class="vtt-pres-name">${p.pseudo}</div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════
// MINI-FICHE PERSONNAGE — 4 onglets
// ═══════════════════════════════════════════════════════════════════

// Slots canoniques — mêmes clés que la vraie fiche personnage (characters/combat.js
// + characters/equipment.js). NE PAS inventer d'emplacements ici.
const _MS_SLOTS = [
  'Main principale', 'Main secondaire',
  'Tête', 'Torse', 'Bottes',
  'Anneau', 'Amulette', 'Objet magique',
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
    fo: getItemStatBonus(item, 'force'), dex: getItemStatBonus(item, 'dexterite'),
    in: getItemStatBonus(item, 'intelligence'), sa:  getItemStatBonus(item, 'sagesse'),
    co: getItemStatBonus(item, 'constitution'), ch:  getItemStatBonus(item, 'charisme'),
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

// Reproduit STRICTEMENT la logique de characters/equipment.js (editEquipSlot)
// pour que les items équipables dans la vraie fiche le soient aussi ici.
function _msItemFitsSlot(item, slot, equip, idx) {
  if (!item?.nom) return false;
  // Déjà équipé dans un autre slot → exclu
  if (Object.entries(equip).some(([s, e]) => s !== slot && e?.sourceInvIndex === idx)) return false;

  const tpl = item.template || '';

  // ── Armes (Main principale / Main secondaire) ────────────────────
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
  // slotArmure stocké côté item = 'Tête' | 'Torse' | 'Pieds'
  // (libellé "Bottes" pour l'affichage, mais valeur réelle "Pieds")
  const ARMOR_MAP = { 'Tête':'Tête', 'Torse':'Torse', 'Bottes':'Pieds' };
  if (ARMOR_MAP[slot] !== undefined) {
    if (tpl === 'armure' || item.slotArmure) {
      return item.slotArmure === ARMOR_MAP[slot];
    }
    const t = (item.type||'').toLowerCase();
    return ['armure','armor','casque','torse','cuirasse','botte','chapeau'].some(k => t.includes(k));
  }

  // ── Bijoux / accessoires (Anneau / Amulette / Objet magique) ─────
  // Règle stricte = même que la vraie fiche : item.slotBijou === slot
  if (slot === 'Anneau' || slot === 'Amulette' || slot === 'Objet magique') {
    return item.slotBijou === slot;
  }

  return false;
}

// ─── Handlers exposés ────────────────────────────────────────────

function _vttMsTab(tab) { _miniTab = tab; if (_miniUid) _renderMiniSheet(_miniUid); }

// ── Filtres des onglets Sac / Sorts ──────────────────────────────
// Barre commune : puces de catégorie + champ de recherche. `kind` = 'inv'|'sorts'.
// `chips` = [{ key, label, color? }] ; la puce active vient de l'état module.
function _msFilterBar(kind, chips, query) {
  const activeCat = kind === 'inv' ? _msInvCat : _msSortCat;
  const catFn     = kind === 'inv' ? '_vttMsInvCat' : '_vttMsSortCat';
  const searchFn  = kind === 'inv' ? '_vttMsInvSearch' : '_vttMsSortSearch';
  const clrFn     = kind === 'inv' ? '_vttMsInvClear' : '_vttMsSortClear';
  // ch.label / ch.color viennent de noms de catégorie saisis par le joueur → échappés.
  const chipsHtml = chips.map(ch =>
    `<button class="vtt-ms-fchip${activeCat===ch.key?' active':''}"${ch.color?` style="--chip-col:${_esc(ch.color)}"`:''}
      data-vtt-fn="${catFn}" data-vtt-args="${ch.key}|$this">${_esc(ch.label)}</button>`
  ).join('');
  return `<div class="vtt-ms-filter" data-kind="${kind}">
    ${chipsHtml ? `<div class="vtt-ms-fchips">${chipsHtml}</div>` : ''}
    <div class="vtt-ms-fsearch">
      <span class="vtt-ms-fsearch-ic">🔍</span>
      <input type="text" class="vtt-ms-fsearch-input" placeholder="Rechercher…"
        value="${_esc(query)}" data-vtt-fn="${searchFn}" data-vtt-on="input" data-vtt-args="$value">
      ${query ? `<button class="vtt-ms-fsearch-clr" title="Effacer" data-vtt-fn="${clrFn}">✕</button>` : ''}
    </div>
  </div>`;
}

// Applique le filtre Sac (catégorie + recherche) par show/hide, sans re-render.
function _msApplyInvFilter() {
  const q = _norm(_msInvQuery);
  const groups = document.querySelectorAll('#vtt-mini-panel .vtt-ms-inv-group');
  let anyVisible = false;
  groups.forEach(g => {
    if (_msInvCat !== 'all' && g.dataset.cat !== _msInvCat) { g.style.display = 'none'; return; }
    let n = 0;
    g.querySelectorAll('.vtt-ms-inv-item').forEach(it => {
      const m = !q || (it.dataset.name || '').includes(q);
      it.style.display = m ? '' : 'none';
      if (m) n++;
    });
    g.style.display = n ? '' : 'none';
    if (n) anyVisible = true;
  });
  _msToggleEmpty('inv', anyVisible || !groups.length);
}

// Applique le filtre Sorts (catégorie / deck actif + recherche) sans re-render.
function _msApplySortFilter() {
  const q = _norm(_msSortQuery);
  const cards = document.querySelectorAll('#vtt-mini-panel .vtt-ms-spellgrid .cs-spellcard');
  let anyVisible = false;
  cards.forEach(card => {
    const catOk = _msSortCat === 'all'
      || (_msSortCat === '__deck' ? card.dataset.actif === '1' : card.dataset.cat === _msSortCat);
    const m = catOk && (!q || (card.dataset.name || '').includes(q));
    card.style.display = m ? '' : 'none';
    if (m) anyVisible = true;
  });
  _msToggleEmpty('sorts', anyVisible || !cards.length);
}

function _msToggleEmpty(kind, anyVisible) {
  const el = document.querySelector(`#vtt-mini-panel .vtt-ms-filter-empty[data-kind="${kind}"]`);
  if (el) el.style.display = anyVisible ? 'none' : '';
}

function _msSetActiveChip(kind, btn) {
  const root = document.querySelector(`#vtt-mini-panel .vtt-ms-filter[data-kind="${kind}"]`);
  root?.querySelectorAll('.vtt-ms-fchip').forEach(b => b.classList.toggle('active', b === btn));
}

function _vttMsInvSearch(val)  { _msInvQuery = val || ''; _msApplyInvFilter(); _msSyncClearBtn('inv'); }
function _vttMsInvCat(cat, btn){ _msInvCat = cat; _msSetActiveChip('inv', btn); _msApplyInvFilter(); }
function _vttMsInvClear()      { _msInvQuery = ''; if (_miniUid) _renderMiniSheet(_miniUid); }
function _vttMsSortSearch(val) { _msSortQuery = val || ''; _msApplySortFilter(); _msSyncClearBtn('sorts'); }
function _vttMsSortCat(cat,btn){ _msSortCat = cat; _msSetActiveChip('sorts', btn); _msApplySortFilter(); }
function _vttMsSortClear()     { _msSortQuery = ''; if (_miniUid) _renderMiniSheet(_miniUid); }

// Affiche/masque le bouton ✕ de la recherche sans re-render complet (préserve le focus).
function _msSyncClearBtn(kind) {
  const query = kind === 'inv' ? _msInvQuery : _msSortQuery;
  const wrap  = document.querySelector(`#vtt-mini-panel .vtt-ms-filter[data-kind="${kind}"] .vtt-ms-fsearch`);
  if (!wrap) return;
  let btn = wrap.querySelector('.vtt-ms-fsearch-clr');
  if (query && !btn) {
    btn = document.createElement('button');
    btn.className = 'vtt-ms-fsearch-clr'; btn.title = 'Effacer'; btn.textContent = '✕';
    btn.dataset.vttFn = kind === 'inv' ? '_vttMsInvClear' : '_vttMsSortClear';
    wrap.appendChild(btn);
  } else if (!query && btn) {
    btn.remove();
  }
}

async function _vttMsEquip(charId, uid, slot, invIndex) {
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
}

async function _vttMsUnequip(charId, uid, slot) {
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
}

// Appelé par le <select> de l'onglet Équipement
function _vttMsSlotChange(sel, charId, uid, slotIdx) {
  const slot = _MS_SLOTS[parseInt(slotIdx)]; if (!slot) return;
  const val = sel.value;
  if (val === '') _vttMsUnequip(charId, uid, slot);
  else            _vttMsEquip(charId, uid, slot, parseInt(val));
}

// Ouvre une modale pour choisir le slot cible depuis l'inventaire
function _vttMsEquipPicker(charId, uid, invIndex) {
  if (!_msCanEdit(uid)) return;
  const c = _characters[charId]; if (!c) return;
  invIndex = parseInt(invIndex);
  const item = (c.inventaire||[])[invIndex]; if (!item) return;
  const equip = c.equipement||{};
  // Seuls les slots compatibles avec cet item (sans check "usedElsewhere" pour qu'on puisse déplacer)
  const slots = _MS_SLOTS.filter(s => _msItemFitsSlot(item, s, {}, invIndex));
  if (!slots.length) { showNotif('Aucun slot compatible pour cet objet', 'info'); return; }
  if (slots.length === 1) { _vttMsEquip(charId, uid, slots[0], invIndex); return; }
  openModal(`⚔️ Équiper "${item.nom}"`, `
    <div style="display:flex;flex-direction:column;gap:.4rem">
      ${slots.map(s => `<button class="btn btn-outline"
        data-vtt-fn="_vttCloseAnd" data-vtt-args="_vttMsEquip|${charId}|${uid}|${s}|${invIndex}">${s}</button>`).join('')}
      <button class="btn btn-outline btn-sm" style="margin-top:.3rem" data-vtt-fn="closeModal">Annuler</button>
    </div>`);
}

// Déséquipe un item depuis l'inventaire (tous les slots où il est équipé)
async function _vttMsUnequipAll(charId, uid, invIndex) {
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
}

// Active / désactive un sort
async function _vttToggleMsSort(charId, uid, idx) {
  if (!_msCanEdit(uid)) return;
  const c = _characters[charId]; if (!c) return;
  const sorts = [...(c.deck_sorts||[])];
  const s = sorts[idx]; if (!s) return;
  // Un joueur ne peut mettre dans son Deck qu'un sort VALIDÉ par le MJ (le MJ n'est pas limité).
  const isValidated = (s.mjValidation || (s.mjValidated ? 'ok' : 'pending')) === 'ok';
  if (!s.actif && !isValidated && !STATE.isAdmin) {
    showNotif('Ce sort doit être validé par le MJ avant d\'entrer dans le Deck.', 'error');
    return;
  }
  sorts[idx] = { ...s, actif: !s.actif };
  try { await updateDoc(_chrRef(charId), { deck_sorts: sorts }); }
  catch(e) { showNotif('Erreur sauvegarde', 'error'); }
}

// Modale pour choisir le destinataire d'un objet
function _vttMsSendPicker(charId, uid, invIndex) {
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
        data-vtt-fn="_vttCloseAnd" data-vtt-args="_vttMsConfirmSend|${charId}|${uid}|${invIndex}|${t.charId}">
        ${t.pseudo} → ${t.charNom}</button>`).join('')}
      <button class="btn btn-outline btn-sm" style="margin-top:.3rem" data-vtt-fn="closeModal">Annuler</button>
    </div>`);
}

// Effectue le transfert d'objet entre deux personnages
async function _vttMsConfirmSend(senderCharId, senderUid, invIndex, recipCharId) {
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
    const batch = writeBatch(db);
    batch.update(_chrRef(senderCharId), { inventaire: senderInv, equipement: senderEquip, statsBonus: senderBonus });
    batch.update(_chrRef(recipCharId), { inventaire: recipInv });
    await batch.commit();
    showNotif(`${item.nom||'Objet'} envoyé à ${recip.nom||'joueur'}`, 'success');
  } catch(e) { console.error('[vtt] send item', e); showNotif('Erreur envoi', 'error'); }
}

// Supprime définitivement un exemplaire de l'inventaire (sans destinataire).
// Même logique de réindexation de l'équipement que _vttMsConfirmSend.
async function _vttMsDeleteItem(charId, uid, invIndex) {
  if (!_msCanEdit(uid)) return;
  invIndex = parseInt(invIndex);
  const c = _characters[charId]; if (!c) return;
  const inv = [...(c.inventaire||[])];
  const item = inv[invIndex]; if (!item) return;
  if (!confirm(`Supprimer "${item.nom||'cet objet'}" de l'inventaire ?`)) return;
  inv.splice(invIndex, 1);
  const equip = { ...(c.equipement||{}) };
  Object.keys(equip).forEach(s => {
    const e = equip[s]; if (!e) return;
    if (e.sourceInvIndex === invIndex)    delete equip[s];
    else if (e.sourceInvIndex > invIndex) equip[s] = { ...e, sourceInvIndex: e.sourceInvIndex - 1 };
  });
  const bonus = computeEquipStatsBonus(equip);
  try {
    await updateDoc(_chrRef(charId), { inventaire: inv, equipement: equip, statsBonus: bonus });
    showNotif(`${item.nom||'Objet'} supprimé`, 'info');
  } catch(e) { console.error('[vtt] delete item', e); showNotif('Erreur suppression', 'error'); }
}

// ─── Rendus par onglet ────────────────────────────────────────────

function _msTabCombat(c, uid, canEdit) {
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
    ${weaponHtml}${setHtml}
    ${_msXpSection(c, uid, canEdit)}`;
}

function _msXpSection(c, uid, canEdit) {
  const xp     = parseInt(c?.exp)    || 0;
  const niv    = parseInt(c?.niveau) || 1;
  const palier = calcPalier(niv);
  const pct    = palier > 0 ? Math.min(100, Math.round(xp / palier * 100)) : 0;

  if (canEdit) {
    return `
    <div class="vtt-ms-xp">
      <div class="vtt-ms-xp-row">
        <span class="vtt-ms-xp-label">⭐ XP</span>
        <input class="vtt-ms-xp-input" type="number" value="${xp}" min="0"
          data-vtt-fn="_vttMsSetXp" data-vtt-on="change" data-vtt-args="${c.id}|${uid}|$value"
          onkeydown="if(event.key==='Enter'){this.dispatchEvent(new Event('change'));this.blur();}"
          title="XP total — Entrée pour valider">
        <span class="vtt-ms-xp-sep">/ ${palier}</span>
        <span class="vtt-ms-xp-niv">Niv.</span>
        <input class="vtt-ms-niv-input" type="number" value="${niv}" min="1" max="20"
          data-vtt-fn="_vttMsSetNiveau" data-vtt-on="change" data-vtt-args="${c.id}|${uid}|$value">
      </div>
      <div class="vtt-ms-xp-row vtt-ms-xp-add-row">
        <span class="vtt-ms-xp-add-icon">+</span>
        <input class="vtt-ms-xp-input vtt-ms-xp-delta-input" type="number" min="1" placeholder="gagné"
          id="vtt-xp-delta-${c.id}-${uid}"
          data-vtt-fn="_vttMsAddXp" data-vtt-on="keydown-enter" data-vtt-args="${c.id}|${uid}|$value"
          title="XP à ajouter — Entrée pour valider">
      </div>
      <div class="vtt-ms-bar-track"><div class="vtt-ms-bar-fill" style="width:${pct}%;background:#f59e0b"></div></div>
    </div>`;
  }
  return `
    <div class="vtt-ms-xp">
      <div class="vtt-ms-xp-row">
        <span class="vtt-ms-xp-label">⭐ XP</span>
        <span class="vtt-ms-xp-val">${xp} / ${palier}</span>
        <span class="vtt-ms-xp-badge">Niv. ${niv}</span>
      </div>
      <div class="vtt-ms-bar-track"><div class="vtt-ms-bar-fill" style="width:${pct}%;background:#f59e0b"></div></div>
    </div>`;
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
        ? `<select class="vtt-ms-slot-sel" data-vtt-fn="_vttMsSlotChange" data-vtt-on="change" data-vtt-args="$this|${c.id}|${uid}|${slotIdx}">
             <option value="">— vide —</option>${opts}</select>`
        : `<span class="vtt-ms-slot-val">${equipped?.nom||'—'}</span>`}
      </div>
    </div>`;
  }).join('')}</div>`;
}

// Méta runes (icône/couleur) — miroir de RUNE_META (spells.js) pour un rendu de
// carte identique côté VTT, sans importer le gros module de la fiche.
const _VTT_RUNE_META = {
  'Puissance':{icon:'⚔️',color:'#ef4444'}, 'Protection':{icon:'💚',color:'#22c38e'},
  'Amplification':{icon:'🌐',color:'#4f8cff'}, 'Dispersion':{icon:'🎯',color:'#a855f7'},
  'Enchantement':{icon:'✨',color:'#e8b84b'}, 'Affliction':{icon:'💀',color:'#8b5cf6'},
  'Invocation':{icon:'🐾',color:'#a16207'}, 'Lacération':{icon:'🩸',color:'#dc2626'},
  'Chance':{icon:'🍀',color:'#facc15'}, 'Durée':{icon:'⏱️',color:'#06b6d4'},
  'Concentration':{icon:'🧠',color:'#6366f1'}, 'Réaction':{icon:'🔄',color:'#ec4899'},
  'Action Bonus':{icon:'✴️',color:'#f97316'},
  'Déclenchement':{icon:'⚡',color:'#f97316'},
};

// Chips d'effets clés (dégâts/soin/cibles/zone/durée), calculés avec les helpers
// natifs du VTT (cache-free → cohérents avec les options d'attaque du VTT).
function _vttSpellChips(s, c) {
  const chips = [];
  const types = (Array.isArray(s.types) && s.types.length) ? s.types
              : (s.typeSoin ? ['defensif'] : (s.noyau ? ['offensif'] : []));
  const runes = s.runes || [];
  const _isLac = runes.includes('Lacération') || (s.afflictionMode === 'laceration' && runes.includes('Affliction'));
  if (types.includes('offensif') || _isLac) {
    const dmg = _vttSortDmgFormula(s, c);
    if (dmg) chips.push({ icon:'⚔️', val: dmg, color:'#ff6b6b' });
  }
  if (runes.includes('Protection') && runes.includes('Affliction') && !_isLac) {
    const nbProt = runes.filter(r => r === 'Protection').length;
    const nbAff = runes.filter(r => r === 'Affliction').length;
    chips.push({ icon:'💚', val:`${nbProt + nbAff}d4/t`, color:'#22c38e' });
  }
  const isAmpSupportHeal = types.includes('defensif')
    && runes.includes('Amplification')
    && s.ampMode !== 'deplacement'
    && !runes.includes('Protection');
  if (!(runes.includes('Protection') && runes.includes('Affliction') && !_isLac)
      && types.includes('defensif') && (s.protectionMode === 'soin' || s.typeSoin || isAmpSupportHeal)) {
    const soin = _vttSortSoinFormula(s, c);
    if (soin) chips.push({ icon:'💚', val: soin, color:'#22c38e' });
  }
  const nbT = calcSpellTargets(s);
  if (nbT > 1) chips.push({ icon:'🎯', val:`×${nbT}`, color:'#4f8cff' });
  const nbAmp = runes.filter(r => r === 'Amplification').length;
  if (nbAmp > 0 && s.ampMode !== 'deplacement') {
    const nbDisp = runes.filter(r => r === 'Dispersion').length;
    const zoneW = nbDisp >= 1 ? _vttAmpDispCircleSize(nbAmp, nbDisp) : 3 * nbAmp;
    const zoneH = nbDisp >= 1 ? zoneW : 1;
    chips.push({ icon:'📐', val:`${zoneW}×${zoneH} cases`, color:'#b47fff' });
  }
  if (runes.includes('Durée') || (s.dureeBase && s.dureeBase >= 2)) {
    chips.push({ icon:'⏱️', val:`${calcSpellDuration(s)}t`, color:'#9ca3af' });
  }
  return chips;
}

// Carte de sort VTT — même présentation que la fiche perso (classes .cs-spellcard,
// scope .cs-v3) avec câblage VTT (toggle deck par data-vtt-fn).
function _vttSpellCardHtml(s, i, c, uid, canEdit) {
  const runes = s.runes || [];
  const types = (Array.isArray(s.types) && s.types.length) ? s.types
              : (s.typeSoin ? ['defensif'] : (s.noyau ? ['offensif'] : []));
  const action = _vttSpellActionMode(s);
  const ACTION_CFG = {
    action:       { label:'⚡ Act.',   color:'#e8b84b' },
    action_bonus: { label:'✴️ Bonus', color:'#f97316' },
    reaction:     { label:'🔄 Réac.', color:'#a78bfa' },
  };
  const acfg = ACTION_CFG[action];
  const concentration = runes.includes('Concentration');
  const ids = (Array.isArray(s.noyauTypeIds) && s.noyauTypeIds.length) ? s.noyauTypeIds
            : (s.noyauTypeId ? [s.noyauTypeId] : []);
  const nts = ids.map(id => getDamageTypeById(_damageTypes, id)).filter(Boolean);
  const noyauPills = nts.map(t =>
    `<span class="cs-spellcard-noyau" style="--c:${t.color||'#888'}" title="Noyau ${_esc(t.label)}">${t.icon||''}</span>`).join('');
  const typeCol = types.includes('offensif') ? '#ff6b6b' : types.includes('defensif') ? '#22c38e' : '#b47fff';
  const vs = s.mjValidation || (s.mjValidated ? 'ok' : 'pending');
  const valBadge = vs === 'ok'
    ? `<span class="cs-spellcard-val ok" title="Sort validé par le MJ">✅ Validé</span>`
    : vs === 'no'
      ? `<span class="cs-spellcard-val no" title="Sort refusé par le MJ">❌ Refusé</span>`
      : `<span class="cs-spellcard-val wait" title="Pas encore validé par le MJ">⏳ À valider</span>`;
  const chips = _vttSpellChips(s, c);
  const counts = {}; _vttDisplayRunes(runes).forEach(r => { counts[r] = (counts[r]||0)+1; });
  const runeChips = Object.keys(counts).length ? `<div class="cs-spellcard-runes">${
    Object.entries(counts).map(([nom, n]) => {
      const m = _VTT_RUNE_META[nom] || { icon:'•', color:'#888' };
      return `<span class="cs-runechip" style="--c:${m.color}" title="${_esc(nom)}">${m.icon} ${_esc(nom)}${n>1?` ×${n}`:''}</span>`;
    }).join('')}</div>` : '';
  const canActivate = STATE.isAdmin || vs === 'ok';
  const toggle = canEdit
    ? `<div class="toggle ${s.actif?'on':''} ${(!canActivate && !s.actif)?'is-locked':''}" data-vtt-fn="_vttToggleMsSort" data-vtt-args="${c.id}|${uid}|${i}" title="${(!canActivate && !s.actif)?'Doit être validé par le MJ pour entrer dans le Deck':(s.actif?'Retirer du deck':'Ajouter au deck')}"></div>`
    : `<div class="toggle ${s.actif?'on':''}"></div>`;
  return `<article class="cs-spellcard ${s.actif?'is-actif':''}" style="--type-col:${typeCol}"
      data-name="${_esc(_norm(s.nom||''))}" data-cat="${_esc(s.catId||'__none')}" data-actif="${s.actif?1:0}">
    <header class="cs-spellcard-head">
      ${toggle}
      <span class="cs-spellcard-icon">${s.icon ? _esc(s.icon) : '✦'}</span>
      <div class="cs-spellcard-id">
        <div class="cs-spellcard-name" title="${_esc(s.nom||'Sans nom')}">${_esc(s.nom||'Sans nom')}</div>
        <div class="cs-spellcard-sub">
          <span class="cs-spellcard-act" style="--c:${acfg.color}">${acfg.label}</span>
          ${concentration ? `<span class="cs-spellcard-conc" title="Concentration">🧠</span>` : ''}
          ${noyauPills}
        </div>
      </div>
      <span class="cs-spellcard-pm" title="Coût en PM">${s.pm||0}<small>PM</small></span>
    </header>
    <div class="cs-spellcard-tags">${valBadge}${chips.map(ch => `<span class="cs-sort-sstat" style="--c:${ch.color}">${ch.icon} ${_esc(ch.val)}</span>`).join('')}</div>
    ${s.effet ? `<p class="cs-spellcard-desc">${_esc(s.effet)}</p>` : ''}
    ${s.mjNotes ? `<div class="cs-spellcard-mjnote" title="Note / restriction du MJ"><span class="cs-spellcard-mjnote-ic">📌</span><span class="cs-spellcard-mjnote-tx">${_esc(s.mjNotes)}</span></div>` : ''}
    ${runeChips}
  </article>`;
}

function _msTabSorts(c, uid, canEdit) {
  const sorts = c?.deck_sorts || [];
  if (!sorts.length) return '<div class="vtt-ms-empty">Aucun sort</div>';
  const deckCount = sorts.filter(s => s.actif).length;
  const deckMax = calcDeckMax(c);
  const over = deckCount > deckMax;

  // Barre de filtre : Tous · ⚡ Deck actif · catégories du perso (présentes) · Sans cat.
  let filterBar = '';
  if (sorts.length >= 4) {
    const cats = (c?.sort_cats || []).filter(ct => sorts.some(s => s.catId === ct.id));
    const chips = [
      { key:'all',    label:'Tous' },
      { key:'__deck', label:`⚡ Deck (${deckCount})` },
      ...cats.map(ct => ({ key: ct.id, label: ct.nom || 'Catégorie', color: ct.couleur })),
    ];
    if (sorts.some(s => !s.catId)) chips.push({ key:'__none', label:'Sans cat.' });
    // Garde-fou : si la catégorie active n'existe plus, on retombe sur "Tous".
    if (!chips.some(ch => ch.key === _msSortCat)) _msSortCat = 'all';
    filterBar = _msFilterBar('sorts', chips, _msSortQuery);
  } else {
    _msSortCat = 'all'; _msSortQuery = '';
  }

  return `
    <div class="vtt-ms-deckbar${over ? ' is-over' : ''}">
      <span class="vtt-ms-deck-lbl">⚡ Deck</span>
      <span class="vtt-ms-deck-val">${deckCount}<small>/${deckMax}</small></span>
      ${canEdit ? `<span class="vtt-ms-deck-hint">Coche un sort pour l'ajouter / le retirer du deck</span>` : ''}
    </div>
    ${filterBar}
    <div class="cs-v3"><div class="cs-spellcard-grid vtt-ms-spellgrid">
      ${sorts.map((s, i) => _vttSpellCardHtml(s, i, c, uid, canEdit)).join('')}
    </div></div>
    <div class="vtt-ms-filter-empty" data-kind="sorts" style="display:none">Aucun sort ne correspond.</div>`;
}

function _msTabInventaire(c, uid, canEdit) {
  const inv = c?.inventaire||[];
  if (!inv.length) return '<div class="vtt-ms-empty">Inventaire vide</div>';

  const equip = c?.equipement||{};
  const CAT_LABEL = { arme:'⚔️ Armes', armure:'🛡 Armures', bijou:'💍 Bijoux', consommable:'🧪 Consommables', divers:'📦 Divers' };
  const cats = { arme:[], armure:[], bijou:[], consommable:[], divers:[] };

  // 1) Empilage par `itemId` UNIQUEMENT (objets boutique). Les entrées sans
  //    itemId restent une ligne par exemplaire — pas de fusion sur le nom.
  const stacksById = new Map();
  const singletons = [];
  inv.forEach((item, i) => {
    if (!item?.nom) return;
    if (item.itemId) {
      if (!stacksById.has(item.itemId)) stacksById.set(item.itemId, { item, indices: [] });
      stacksById.get(item.itemId).indices.push(i);
    } else {
      singletons.push({ item, indices: [i] });
    }
  });
  // 2) Range les groupes/singletons par catégorie
  for (const g of [...stacksById.values(), ...singletons]) {
    cats[_msCatItem(g.item)].push(g);
  }

  const _rarColor = (rar) => ({
    commune:'#9ca3af', peu_commune:'#22c38e', rare:'#4f8cff',
    tres_rare:'#b47fff', legendaire:'#f59e0b',
  })[rar] || '#9ca3af';

  // Barre de filtre dès 4 objets : recherche toujours dispo ; puces de catégorie
  // seulement s'il y en a plusieurs (inutiles sur une seule catégorie).
  const presentCats = Object.entries(cats).filter(([, g]) => g.length);
  let filterBar = '';
  if (inv.length >= 4) {
    const chips = presentCats.length > 1
      ? [{ key:'all', label:'Tous' }, ...presentCats.map(([cat]) => ({ key: cat, label: CAT_LABEL[cat] }))]
      : [];
    if (!chips.some(ch => ch.key === _msInvCat)) _msInvCat = 'all';
    filterBar = _msFilterBar('inv', chips, _msInvQuery);
  } else { _msInvCat = 'all'; _msInvQuery = ''; }

  let html = filterBar + '<div class="vtt-ms-inv">';
  for (const [cat, groups] of Object.entries(cats)) {
    if (!groups.length) continue;
    const totalUnits = groups.reduce((s,g) => s + g.indices.length, 0);
    html += `<div class="vtt-ms-inv-group" data-cat="${cat}">
      <div class="vtt-ms-inv-cat">
        <span class="vtt-ms-inv-cat-lbl">${CAT_LABEL[cat]}</span>
        <span class="vtt-ms-inv-cnt">${totalUnits}</span>
      </div>`;
    for (const g of groups) {
      const item = g.item;
      const firstIdx = g.indices[0];
      const total = g.indices.length;
      const equippedIdx = g.indices.find(idx => Object.values(equip).some(e => e?.sourceInvIndex === idx));
      const isEq = equippedIdx !== undefined;
      const idxToEquip = g.indices.find(idx => !Object.values(equip).some(e => e?.sourceInvIndex === idx)) ?? firstIdx;
      const idxToUnequip = equippedIdx ?? firstIdx;
      const detail = item.degats
        ? `${item.degats}${item.typeArme?' · '+item.typeArme:''}${item.portee?' · '+item.portee:''}`
        : (item.typeArmure ? `${item.typeArmure}${item.ca?' · CA +'+item.ca:''}` : '');
      const rarDot = item.rarete
        ? `<span class="vtt-ms-inv-rar" style="background:${_rarColor(item.rarete)}"></span>` : '';
      html += `<div class="vtt-ms-inv-item${isEq?' is-equipped':''}" data-name="${_esc(_norm(item.nom||''))}">
        ${rarDot}
        ${item.image
          ? `<img class="vtt-ms-inv-img" src="${item.image}" alt="">`
          : `<span class="vtt-ms-inv-img vtt-ms-inv-img--empty">${cat==='consommable'?'🧪':cat==='arme'?'⚔️':cat==='armure'?'🛡':cat==='bijou'?'💍':'📦'}</span>`}
        <div class="vtt-ms-inv-body">
          <div class="vtt-ms-inv-line1">
            <span class="vtt-ms-inv-nom" title="${_esc(item.nom)}">${_esc(item.nom)}</span>
            ${total>1?`<span class="vtt-ms-inv-qte">×${total}</span>`:''}
            ${isEq?'<span class="vtt-ms-inv-badge">équipé</span>':''}
          </div>
          ${detail?`<div class="vtt-ms-inv-detail">${_esc(detail)}</div>`:''}
        </div>
        ${canEdit?`<div class="vtt-ms-inv-actions">
          ${(cat==='arme'||cat==='armure'||cat==='bijou') && (!isEq || total > 1)
            ?`<button class="vtt-ms-inv-btn" data-vtt-fn="_vttMsEquipPicker" data-vtt-args="${c.id}|${uid}|${idxToEquip}" title="Équiper">⚔️</button>`
            :''}
          ${isEq
            ?`<button class="vtt-ms-inv-btn" data-vtt-fn="_vttMsUnequipAll" data-vtt-args="${c.id}|${uid}|${idxToUnequip}" title="Déséquiper">🔓</button>`
            :''}
          <button class="vtt-ms-inv-btn" data-vtt-fn="_vttMsSendPicker" data-vtt-args="${c.id}|${uid}|${firstIdx}" title="Envoyer">📤</button>
          <button class="vtt-ms-inv-btn" data-vtt-fn="_vttMsDeleteItem" data-vtt-args="${c.id}|${uid}|${firstIdx}" title="Supprimer">🗑️</button>
        </div>`:''}
      </div>`;
    }
    html += `</div>`; // .vtt-ms-inv-group
  }
  html += '</div>';
  html += `<div class="vtt-ms-filter-empty" data-kind="inv" style="display:none">Aucun objet ne correspond.</div>`;
  return html;
}

// ── Onglet Notes (modèle notesList partagé avec la vraie fiche) ──────────
function _msTabNotes(c, uid, canEdit) {
  const notes = c?.notesList || [];
  let html = `<div class="vtt-ms-notes">`;
  if (canEdit) {
    html += `<button class="vtt-ms-note-add" data-vtt-fn="_vttMsAddNote" data-vtt-args="${c.id}|${uid}">+ Nouvelle note</button>`;
  }
  if (!notes.length) {
    html += `<div class="vtt-ms-empty">${canEdit ? 'Aucune note. Crée-en une.' : 'Aucune note.'}</div></div>`;
    return html;
  }
  notes.forEach((note, i) => {
    const open = _msOpenNote === i;
    const body = open ? (canEdit
      ? `<div class="vtt-ms-note-body">
          <textarea class="vtt-ms-note-area" id="vtt-ms-note-${c.id}-${i}" rows="6"
            placeholder="Contenu de la note…">${_esc(_msNoteText(note.contenu))}</textarea>
          <button class="vtt-ms-note-save" data-vtt-fn="_vttMsSaveNote" data-vtt-args="${c.id}|${uid}|${i}">💾 Enregistrer</button>
        </div>`
      : `<div class="vtt-ms-note-body"><div class="vtt-ms-note-content">${note.contenu || '<em style="opacity:.5">Vide</em>'}</div></div>`)
      : '';
    html += `<div class="vtt-ms-note-card${open ? ' open' : ''}">
      <div class="vtt-ms-note-hd" data-vtt-fn="_vttMsToggleNote" data-vtt-args="${i}">
        <span class="vtt-ms-note-title">${_esc(note.titre || 'Note sans titre')}</span>
        <div class="vtt-ms-note-hd-r">
          ${canEdit ? `<button class="vtt-ms-note-ic" data-vtt-fn="_vttMsRenameNote" data-vtt-args="${c.id}|${uid}|${i}" title="Renommer">✏️</button>
                       <button class="vtt-ms-note-ic" data-vtt-fn="_vttMsDeleteNote" data-vtt-args="${c.id}|${uid}|${i}" title="Supprimer">🗑️</button>` : ''}
          <span class="vtt-ms-note-chev">${open ? '▲' : '▼'}</span>
        </div>
      </div>
      ${note.date ? `<div class="vtt-ms-note-date">${_esc(note.date)}</div>` : ''}
      ${body}
    </div>`;
  });
  html += '</div>';
  return html;
}

// Texte affiché dans le textarea : si la note vient de l'éditeur riche de la vraie
// fiche (HTML), on la convertit en texte lisible pour ne pas montrer de balises.
function _msNoteText(contenu) {
  if (!contenu) return '';
  if (!/<[a-z][\s\S]*>/i.test(contenu)) return contenu; // déjà du texte brut
  const tmp = document.createElement('div');
  tmp.innerHTML = contenu.replace(/<\/(p|div|li)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
  return (tmp.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

async function _vttMsAddNote(charId, uid) {
  if (!_msCanEdit(uid)) return;
  const c = _characters[charId]; if (!c) return;
  const notes = [...(c.notesList || [])];
  notes.push({ titre: 'Nouvelle note', contenu: '', date: new Date().toLocaleDateString('fr-FR') });
  _msOpenNote = notes.length - 1;
  await updateDoc(_chrRef(charId), { notesList: notes }).catch(() => showNotif('Erreur sauvegarde', 'error'));
}

function _vttMsToggleNote(idx) {
  idx = parseInt(idx);
  _msOpenNote = _msOpenNote === idx ? null : idx;
  if (_miniUid) _renderMiniSheet(_miniUid);
}

async function _vttMsRenameNote(charId, uid, idx) {
  if (!_msCanEdit(uid)) return;
  idx = parseInt(idx);
  const c = _characters[charId]; if (!c) return;
  const notes = [...(c.notesList || [])];
  if (!notes[idx]) return;
  const val = prompt('Titre de la note :', notes[idx].titre || 'Note sans titre');
  if (val === null) return;
  notes[idx] = { ...notes[idx], titre: val.trim() || notes[idx].titre || 'Note sans titre' };
  await updateDoc(_chrRef(charId), { notesList: notes }).catch(() => showNotif('Erreur sauvegarde', 'error'));
}

async function _vttMsSaveNote(charId, uid, idx) {
  if (!_msCanEdit(uid)) return;
  idx = parseInt(idx);
  const c = _characters[charId]; if (!c) return;
  const ta = document.getElementById(`vtt-ms-note-${charId}-${idx}`);
  const notes = [...(c.notesList || [])];
  if (!notes[idx] || !ta) return;
  notes[idx] = { ...notes[idx], contenu: ta.value };
  if (await updateDoc(_chrRef(charId), { notesList: notes }).then(() => true).catch(() => false))
    showNotif('Note enregistrée', 'success');
  else showNotif('Erreur sauvegarde', 'error');
}

async function _vttMsDeleteNote(charId, uid, idx) {
  if (!_msCanEdit(uid)) return;
  idx = parseInt(idx);
  const c = _characters[charId]; if (!c) return;
  const notes = [...(c.notesList || [])];
  if (!notes[idx]) return;
  if (!confirm('Supprimer cette note ?')) return;
  notes.splice(idx, 1);
  if (_msOpenNote === idx) _msOpenNote = null;
  else if (_msOpenNote > idx) _msOpenNote--;
  if (await updateDoc(_chrRef(charId), { notesList: notes }).then(() => true).catch(() => false))
    showNotif('Note supprimée', 'info');
}

// ─── Rendu principal ─────────────────────────────────────────────

function _renderMiniSheet(uid) {
  const panel = document.getElementById('vtt-mini-panel');
  if (!panel) return;

  const pres = _presence[uid];
  if (!uid || !pres) { panel.classList.remove('open'); panel.innerHTML = ''; return; }

  const chars = sortCharactersForDisplay(Object.values(_characters).filter(c => c.uid === uid));
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
          data-vtt-fn="_vttSelectMiniChar" data-vtt-args="${uid}|${ch.id}">${ch.nom||'Perso'}</button>`
      ).join('')}</div>`
    : '';

  const TABS = [
    { key:'combat', icon:'⚔️', label:'Combat' },
    { key:'equip',  icon:'🛡',  label:'Équip.' },
    { key:'sorts',  icon:'✨',  label:'Sorts'  },
    { key:'inv',    icon:'🎒',  label:'Sac'    },
    { key:'notes',  icon:'📝', label:'Notes'  },
  ];
  const tabBarHtml = `<div class="vtt-ms-tabbar">${TABS.map(t =>
    `<button class="vtt-ms-tab${_miniTab===t.key?' active':''}" data-vtt-fn="_vttMsTab" data-vtt-args="${t.key}" title="${t.label}">
      <span class="vtt-ms-tab-ic">${t.icon}</span><span class="vtt-ms-tab-lbl">${t.label}</span>
    </button>`
  ).join('')}</div>`;

  const tabHtml =
      _miniTab === 'combat' ? _msTabCombat(c, uid, canEdit)
    : _miniTab === 'equip'  ? _msTabEquipement(c, uid, canEdit)
    : _miniTab === 'sorts'  ? _msTabSorts(c, uid, canEdit)
    : _miniTab === 'notes'  ? _msTabNotes(c, uid, canEdit)
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
      <button class="vtt-ms-close" data-vtt-fn="_vttToggleMiniSheet" data-vtt-args="${uid}" title="Fermer">✕</button>
    </div>
    ${selectorHtml}
    ${tabBarHtml}
    <div class="vtt-ms-tab-content">${tabHtml}</div>`;

  // Applique le filtre de l'onglet actif sur le DOM fraîchement rendu.
  if (_miniTab === 'inv')        _msApplyInvFilter();
  else if (_miniTab === 'sorts') _msApplySortFilter();
}

function _vttToggleMiniSheet(uid) {
  if (_miniUid === uid) {
    _miniUid = null; _miniCharId = null;
    const panel = document.getElementById('vtt-mini-panel');
    if (panel) { panel.classList.remove('open'); panel.innerHTML = ''; }
  } else {
    _miniUid = uid; _miniCharId = null;
    _renderMiniSheet(uid);
  }
  _renderPresenceCol();
}

function _vttSelectMiniChar(uid, charId) {
  _miniCharId = charId;
  // Reset des filtres : l'inventaire/les sorts diffèrent d'un perso à l'autre.
  _msInvQuery = ''; _msInvCat = 'all'; _msSortQuery = ''; _msSortCat = 'all';
  _renderMiniSheet(uid);
}

PAGES.vtt=renderVttPage;


// Registre des actions pour le dispatcher data-vtt-fn
const VTT_ACTIONS = {
  _vttEnterTable,
  _vttGateBack,
  _vttToggleSessionLive,
  _vttUndoDraw,
  _invPickToggle,
  _invPickConfirm,
  _invPickCancel,
  _vttAiderClose,
  _vttAider,
  _vttSelfActionClose,
  _vttSelfAction,
  _vttLootOpenShop,
  _vttLibToggle,
  _closeActionModal,
  _closeDicePanel,
  _closeEmotePicker,
  _closeLootPanel,
  _closeMusicPanel,
  _closeShortRest,
  _mtBroadcast,
  _mtCancel,
  _mtClear,
  _mtClearLines,
  _mtDrawLine,
  _mtRefreshHud,
  _mtToggleTarget,
  _mtValidate,
  _vttAddBuffPrompt,
  _vttAddImageUrl,
  _vttAddPage,
  _vttAddSonUrl,
  _vttAddSoundToPlaylist,
  _vttAdjBonus,
  _vttAoptCheckEmpty,
  _vttAoptFilter,
  _vttAoptSearch,
  _vttApplyAfflictions,
  _vttApplyDeplacement,
  _vttApplyEnchantBuffs,
  _vttBackToAtk,
  _vttBindDispatch,
  _vttBstDed,
  _vttBstNotes,
  _vttCancelAtk,
  _vttCancelEmoteEdit,
  _vttCcFlagToggle,
  _vttCcTriSet,
  _vttCleanGhostMembers,
  _vttClearAnnots,
  _vttClearAoptSearch,
  _vttClearBuffs,
  _vttCloseAnd,
  _vttCombatTab,
  _vttConditionAdd,
  _vttConditionApply,
  _vttConditionConfig,
  _vttConditionConfigAddNew,
  _vttConditionConfigDelete,
  _vttConditionConfigReset,
  _vttConditionConfigSave,
  _vttConditionConfigSelect,
  _vttConditionEdit,
  _vttConditionEditSave,
  _vttConditionRemove,
  _vttConditionSave,
  _vttConfirmAddBuff,
  _vttSyncAddBuffRows,
  _vttConfirmAddPage,
  _vttConfirmCreateEnemy,
  _vttConfirmEditPage,
  _vttCourir,
  _vttCourirAndClose,
  _vttCreatSendLootToStash,
  _vttCreateEnemy,
  _vttCreatePlaylist,
  _vttDeletePage,
  _vttDeletePlaylist,
  _vttDeleteSound,
  _vttDeleteToken,
  _vttDiceAddDie,
  _vttDiceBonusSet,
  _vttDiceBonusStep,
  _vttDiceClear,
  _vttDiceMode,
  _vttDiceRoll,
  _vttDrawColor,
  _vttDrawShape,
  _vttDrawWidth,
  _vttDuplicateOnPage,
  _vttDuplicateToken,
  _vttEditPage,
  _vttEditToken,
  _vttEnsureConditionsLoaded,
  _vttFilterDelegates,
  _vttFilterEmotes,
  _vttFogClearOps,
  _vttFogTool,
  _vttImportGithubRelease,
  _vttInsTab,
  _vttInvokeMyToken,
  _vttKickPresence,
  _vttLibDelFolder,
  _vttLibDelImg,
  _vttLibMoveMenu,
  _vttLibMoveRoot,
  _vttLibMoveTo,
  _vttLibMoveToAndClose,
  _vttLibNewFolder,
  _vttLibOpenFolder,
  _vttLibPlace,
  _vttLootAddItemToStash,
  _vttLootClear,
  _vttLootConfirmTake,
  _vttLootRemoveLoot,
  _vttLootRemoveStash,
  _vttLootTakeSetChar,
  _vttLootTakeStep,
  _vttLootToggleTake,
  _vttMemberInfo,
  _vttMoveTokenAndReset,
  _vttMoveTokenToPage,
  _vttMsAddNote,
  _vttMsConfirmSend,
  _vttMsDeleteItem,
  _vttMsDeleteNote,
  _vttMsEquip,
  _vttMsEquipPicker,
  _vttMsInvCat,
  _vttMsInvClear,
  _vttMsInvSearch,
  _vttMsRenameNote,
  _vttMsSaveNote,
  _vttMsSendPicker,
  _vttMsSetNiveau,
  _vttMsSlotChange,
  _vttMsSortCat,
  _vttMsSortClear,
  _vttMsSortSearch,
  _vttMsTab,
  _vttMsToggleNote,
  _vttMsUnequip,
  _vttMsUnequipAll,
  _vttMusicNext,
  _vttNextRound,
  _vttNoop,
  _vttOpenTokenDelegatesModal,
  _vttPickElement,
  _vttPickEmote,
  _vttPageFolderToggle,
  _vttPageSearch,
  _vttPageSearchClear,
  _vttPgPreset,
  _vttPickOpt,
  _vttPlColorSelect,
  _vttPlace,
  _vttPlaceFromBestiary,
  _vttPlayPlaylist,
  _vttPlaySound,
  _vttPreview,
  _vttPreviewEmoteFile,
  _vttRemoveBuff,
  _vttRemoveSoundFromPlaylist,
  _vttRemoveTokenDelegate,
  _vttRenderDelegateModalBody,
  _vttResetTurn,
  _vttResolveArg,
  _vttRetireMyToken,
  _vttRetireToken,
  _vttRollAttack,
  _vttAtkSetElement,
  _vttRollSkill,
  _vttSaveStats,
  _vttSeek,
  _vttSelectFromTray,
  _vttSelectMiniChar,
  _vttSendToPage,
  _vttSetEmoteAlbum,
  _vttSetHp,
  _vttSetImgbbKey,
  _vttSetMode,
  _vttSetPm,
  _vttSetRollMode,
  _vttShortRestCancel,
  _vttShortRestForce,
  _vttShortRestResetCount,
  _vttShortRestSetMax,
  _vttShortRestUnvote,
  _vttShortRestVote,
  _vttSortCibles,
  _vttSortDmgFormula,
  _vttSortSoinFormula,
  _vttSpawnSummon,
  _vttSpellMods,
  _vttStopMusic,
  _vttSwitchPage,
  _vttTimerLabel,
  _vttTimerReset,
  _vttTimerToggle,
  _vttToggleAllMusicCats,
  _vttToggleCombat,
  _vttToggleDice,
  _vttToggleDrawFill,
  _vttToggleEmotePicker,
  _vttToggleFav,
  _vttToggleFog,
  _vttToggleLogDetail,
  _vttToggleLoot,
  _vttToggleMapMode,
  _vttToggleMiniSheet,
  _vttToggleMsSort,
  _vttToggleMusic,
  _vttToggleMusicCat,
  _vttToggleMusicPause,
  _vttToggleNpc,
  _vttToggleOff,
  _vttToggleOn,
  _vttToggleRollHidden,
  _vttToggleShortRest,
  _vttToggleTokenDelegate,
  _vttToggleTurnFlag,
  _vttToggleVisible,
  _vttTokenBonus,
  _vttTokenResetBonus,
  _vttTool,
  _vttTrackerFocus,
  _vttTrayClearSearch,
  _vttTrayFilter,
  _vttTraySearch,
  _vttTriggerConcentrationSave,
  _vttTriggerSuspendedSpell,
  _vttUploadClick,
  _zoneCancel,
  _zoneClear,
  _zoneRotate,
  _zoneUpdatePreview,
  _zoneValidate,
  _selfMoveCancel,
  _vttChatReply,
  _vttChatReplyCancel,
  _vttCreatePlaylistConfirm,
  _vttDiceRemoveDie,
  _vttMsAddXp,
  _vttMsSetXp,
  _vttSendChat,
  _vttSoundCtxMenu,
};

registerActions({
  _vttFilterDelegates:     (el)  => _vttFilterDelegates(el.dataset.tokenId, el.value),
  _vttToggleTokenDelegate: (btn) => _vttToggleTokenDelegate(btn.dataset.tokenId, btn.dataset.uid2),
  _vttCleanGhostMembers:   ()    => _vttCleanGhostMembers(),
  _vttDelegClose:          ()    => closeModalDirect(),
  _vttConditionConfig:     ()    => _vttConditionConfig(),
  _ouvrirGestionEmotes:    ()    => _ouvrirGestionEmotes(),
});
