// ═══════════════════════════════════════════════════════════════════
// VTT — Table de Jeu Virtuelle
//
// PRINCIPE : chaque personnage ET chaque PNJ possède déjà son token.
// Pas de création manuelle — les tokens sont auto-générés et resten
// en sync bidirectionnel avec les fiches (HP, nom, photo).
// ═══════════════════════════════════════════════════════════════════

import { STATE } from '../../core/state.js';
import { registerActions } from '../../core/actions.js';
import Sortable from '../../vendor/sortable.esm.js';
import { getDocData, getDocDataSilent, saveDoc, loadCollection, subscribeCollection } from '../../data/firestore.js';
import {
  db, doc, getDoc, addDoc, updateDoc, deleteDoc,
  setDoc, onSnapshot, serverTimestamp, writeBatch,
  query, orderBy, limit,
} from '../../config/firebase.js';
import { getMod, getModFromScore, calcVitesse, calcCA, calcPVMax, calcPMMax, calcPalier, calcDeckMax, getMaitriseBonus, statShort, computeEquipStatsBonus, getItemStatBonus, computeEquipSkillBonus, sortCharactersForDisplay } from '../../shared/char-stats.js';
import { calcCriticalEffectTotal, criticalEffectFormulaLabel } from '../../shared/character-rules.js';
import { shopItemToInvEntry } from '../../shared/inventory-utils.js';
import { openShopPicker, getShopItemById } from '../../shared/shop-picker.js';
import { getArmorSetData, getMainWeapon, DEFAULT_UNARMED, getCharDamageProfile } from '../../shared/equipment-utils.js';
import { buildProjectionPatch, switchBuild } from '../../shared/character-builds.js';
import { loadWeaponFormats } from '../../shared/weapon-formats.js';
import { loadDamageTypes, getDamageTypeRules, getDamageTypeById } from '../../shared/damage-types.js';
import { playSigil, playImpact, playProjectile, playSlash } from './vtt-rune-sigil.js';
import { DAMAGE_INTERACTIONS, applyDamageTypeInteraction, previewDamageInteraction } from '../../shared/damage-profile.js';
import { runeBadges, spellTypeBadges } from '../../shared/spell-action-card.js';
import { calcSpellDuration, calcSpellTargets } from '../../shared/spell-runes.js';
import { loadSpellMatrices, getInvokedArm } from '../../shared/spell-matrices.js';
import { CONDITION_DEFAULT_LIBRARY, CONDITION_DEFAULT_IDS, loadConditionLibrary } from '../../shared/conditions.js';
import { showNotif } from '../../shared/notifications.js';
import { accAttackDelta, accCastDelta, applyStatsDelta, bumpBiggestHit, bumpBiggestTaken, bumpDamageTaken } from '../../shared/stats.js';
import { uploadCloudinary, hasCloudinaryConfig, openCloudinaryConfigModal, CLOUDINARY_ENABLED } from '../../shared/upload-cloudinary.js';
import {
  fogInit, fogSetPgRef, fogUpdate, fogUpdateSoon, fogRenderWalls,
  fogIsEditMode, fogToggleEditMode, fogSetEditTool, fogWallBlocksPath, fogUndo, fogRedo,
} from './vtt-fog.js';
import { openModal, closeModalDirect, confirmModal, updateModalContent, promptModal } from '../../shared/modal.js';
import { _esc, _norm, _searchIncludes, appSplashHtml, loadingHtml, normalizeImageUrl } from '../../shared/html.js';
import { lsJson } from '../../shared/local-storage.js';
import { DICE_SKILLS_DEFAULT, DICE_SKILLS_STORAGE_KEY } from '../../shared/dice-skills.js';
import PAGES from '../pages.js';
import { VS, aid } from './vtt-state.js';
import {
  _sesRef, _pgsCol, _toksCol, _pgRef, _tokRef, _chrRef, _npcRef, _bstTrackerRef,
  _logCol, _logGmCol, _castingCol, _castingRef, _pingsCol, _pingRef,
  _reactionsCol, _reactionRef, _annotCol, _annotRef,
} from './vtt-refs.js';
import { CELL, CELL_M, TYPE_COLOR, hpColor, _STAT_KEY, _STAT_COLOR, _STAT_RGB, _VTT_RUNE_META, _MS_BONUS_BUFF } from './vtt-constants.js';
import { _drawGrid, _loadKonva, _stageToWorld, _renderMapImages, _buildTokenVisual, _buildAnnotVisual } from './vtt-render.js';
import {
  _startRuler, _updateRuler, _endRuler, _clearRuler, _showRulerHover, _hideRulerHover,
  _renderMjRulerRemote, _resetRuler, rulerActive, rulerBusy,
} from './vtt-ruler.js';
import {
  _initChatLogSubs, _vttToggleLogDetail, _vttSendChat, _vttChatReply, _vttChatReplyCancel, _chatMsgs,
} from './vtt-chat.js';
import {
  _loadEmotes, _loadDiceSkills, _vttSetRollMode, _vttAdjBonus, _vttToggleRollHidden, _vttRollSkill,
  _vttFilterEmotes, _vttToggleFav, _closeEmotePicker, _vttToggleEmotePicker, _vttPickEmote,
  _ouvrirGestionEmotes, _renderEmotePicker, _emotes,
} from './vtt-emotes.js';
import {
  _live, _characterForToken, _touchBuffOf, _conditionDmgBonusOf,
  _scaledEnchantConditionFields, _vttPrimaryWeapon, _conditionCritRangeBonusOf,
} from './vtt-effective.js';
import { _renderInspector, _renderInspectorSoon, _vttInsTab, _vttSkillFilter, _vttSkillFilterClear } from './vtt-inspector.js?v=20260713-creature-info';
import {
  _renderLibSection, _resetMapLib, _libFolder, _vttLibToggle, _vttLibOpenFolder, _vttLibNewFolder,
  _vttLibDelFolder, _vttLibDelImg, _vttLibMoveRoot, _vttLibMoveMenu, _vttLibMoveTo, _vttLibPlace,
  _vttLibMoveToAndClose, _mapLibRef, _vttLibImportGithub, _vttLibSearch, _vttLibSearchClear,
} from './vtt-maplib.js';
import { _markCharsReady, _markNpcsReady, _markToksReady, _resetAutoSync, _charsReady, _cleanupReserveDuplicates } from './vtt-autosync.js';
import { _vttPanelError, _showCtxMenu, _hideCtxMenu, _tokenEntityKey } from './vtt-utils.js';
import {
  _vttConditionConfig, _vttConditionConfigSelect, _vttConditionConfigSave, _vttConditionConfigReset,
  _vttConditionConfigAddNew, _vttConditionConfigDelete, _vttCcTriSet, _vttCcFlagToggle,
} from './vtt-conditions-config.js';
import {
  _vttConditionAdd, _vttConditionApply, _vttConditionRemove, _vttConditionSave,
  _vttConditionEdit, _vttConditionEditSave, _vttEnsureConditionsLoaded,
} from './vtt-conditions.js';
import {
  _vttResetTurn, _vttToggleTurnFlag, _vttToggleCombat, _vttNextRound,
} from './vtt-combat-turns.js';
import {
  _vttApplyEnchantBuffs, _vttApplyAfflictions, _vttApplyRegeneration,
} from './vtt-spell-effects.js';
import {
  _renderTraySoon, _renderPageTabs, _switchPage, _trayTab, _resetTraySearch,
  _vttTrayFilter, _vttTraySearch, _vttTrayClearSearch, _vttBstSearch, _vttBstClearSearch, _vttTrayTab,
  _vttToggleOn, _vttToggleOff, _vttToggleNpc, _vttReserveFilter, _vttPageSearch, _vttPageSearchClear, _vttPageFolderToggle,
  _vttPageFolderFilter, _vttPageFavToggle,
} from './vtt-tray.js';
import {
  VTT_ACTION_RUNE, _parseDice, _maxDice, _maxEffectDisplay, _effectDisplay,
  _vttSortDmgFormula, _vttSortSoinFormula, _vttAmpDispCircleSize, _vttSpellActionMode,
  _vttDisplayRunes,
} from './vtt-spell-display.js';
import { _getSortTypes } from '../characters/spells-calc.js';
import {
  _musicStateRef, _syncMusicPlayback, _resetMusicState, _closeMusicPanel,
  _vttToggleMusicCat, _vttToggleAllMusicCats, _vttToggleMusic, _vttPlaySound,
  _vttPlayPlaylist, _vttMusicNext, _vttToggleMusicPause, _vttStopMusic,
  _vttSoundCtxMenu, _vttDeleteSound, _vttCreatePlaylist, _vttCreatePlaylistConfirm,
  _vttDeletePlaylist, _vttAddSoundToPlaylist, _vttRemoveSoundFromPlaylist,
  _vttPlColorSelect, _vttPreview, _vttSeek, _vttAddSonUrl, _vttImportGithubRelease,
  _vttMusicToggleHideTitle, _vttRenamePlaylistConfirm,
} from './vtt-music.js';
import {
  _vttShortRestVote, _vttShortRestUnvote, _vttShortRestCancel, _vttShortRestForce,
  _vttShortRestSetMax, _vttShortRestResetCount, _vttToggleShortRest, _closeShortRest,
  _renderShortRest, _checkShortRestAutoApply,
} from './vtt-rest.js';
import {
  _vttToggleLoot, _vttLootRemoveStash, _vttLootRemoveLoot, _vttLootClear,
  _vttLootAddItemToStash, _vttLootOpenShop, _vttLootToggleTake, _vttLootTakeSetChar,
  _vttLootTakeStep, _vttLootConfirmTake, _vttCreatSendLootToStash, _vttCreatSendGoldToStash,
  _vttLootAddGoldPrompt, _resetLootState,
  _closeLootPanel,
  _vttLootOpenVote, _vttLootCloseVote, _vttLootForceDistribute,
  _vttLootClaimSetChar, _vttLootClaimStep, _vttLootClaimEdit,
  _vttLootClaimSubmit, _vttLootClaimWithdraw,
} from './vtt-loot.js';
import {
  _vttToggleDice, _vttDiceAddDie, _vttDiceRemoveDie, _vttDiceClear, _vttDiceBonusStep,
  _vttDiceBonusSet, _vttDiceMode, _vttDiceRoll, _closeDicePanel,
  _vttDiceRerollLast, _vttDiceUseHistory,
} from './vtt-dice.js';
import {
  _renderTimer, _timerStartTick, _timerStopTick, _vttTimerToggle, _vttTimerReset, _vttTimerLabel,
} from './vtt-timer.js';
import { _renderWeatherBtn, _applyWeather, _vttWeatherToggle, _vttSetWeather } from './vtt-weather.js';
import {
  _renderCombatTracker, _renderCombatTrackerSoon, _vttCombatTab, _vttTrackerFocus,
} from './vtt-combat-tracker.js';
import {
  _startPresence, _resetPresence, _renderSessionBtn, _vttToggleSessionLive,
  _vttKickPresence, _renderPresenceCol,
} from './vtt-presence.js';
import {
  _renderMiniSheet, _vttToggleMiniSheet, _vttSelectMiniChar, _msCanEdit,
  _vttMsTab, _vttMsAddNote, _vttMsToggleNote, _vttMsRenameNote, _vttMsSaveNote,
  _vttMsDeleteNote, _vttMsEquip, _vttMsUnequip, _vttMsUnequipAll, _vttMsEquipPicker,
  _vttMsSlotChange, _vttMsDeleteItem, _vttMsSendPicker, _vttMsConfirmSend,
  _vttMsInvSearch, _vttMsInvCat, _vttMsInvClear, _vttMsSortSearch, _vttMsSortCat,
  _vttMsSortClear, _vttToggleMsSort, _vttMsCompteAdd, _vttMsCompteDel, _vttMsCraft,
  _vttMsCraftSearch, _vttMsCraftClear,
  _vttMsSendGoldPicker, _vttMsConfirmSendGold,
} from './vtt-mini-fiche.js';

let _vttDelegSearch = '';

// ── Constantes ──────────────────────────────────────────────────────
// [CELL → vtt-constants.js (importé en haut, partagé avec vtt-render.js)]
const MIN_SCALE   = 0.15;
const MAX_SCALE   = 4;

// [TYPE_COLOR / hpColor → vtt-constants.js (importés en haut)]

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

// [_vttToggleLogDetail → vtt-chat.js (importé en haut)]

// Helpers ciblés pour les cas inline restants (raccourcis / manipulation DOM directe)
function _vttCourirAndClose(srcId) {
  _vttCourir(srcId);
  _closeActionModal();
}

// ── Actions de base : Esquiver / Se cacher / Se désengager (état sur soi) ──
async function _vttSelfAction(srcId, condId) {
  const t = VS.tokens[srcId]?.data; if (!t) return;
  if (!_canControlToken(t)) return;
  const lib = CONDITION_BY_ID[condId]; if (!lib) return;
  const round = VS.session?.combat?.round ?? 0;
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
  const s = VS.tokens[srcId]?.data; if (!s) return;
  if (!_canControlToken(s)) return;
  const t = VS.tokens[tgtId]?.data; if (!t) return;
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
// [_vttCcTriSet/_vttCcFlagToggle (toggles du modal états) → vtt-conditions-config.js]
// [_vttLibMoveToAndClose → vtt-maplib.js]
// [plcolor musique → vtt-music.js]
// No-op pour les wrappers qui servaient juste à event.stopPropagation() (closest() suffit)
function _vttNoop() {}
function _vttIsTypingTarget(target) {
  const el = target?.nodeType === 1 ? target : target?.parentElement;
  if (!el?.closest) return false;
  const editable = el.closest('[contenteditable]');
  return !!(
    el.closest('input, textarea, select, [role="textbox"]') ||
    (editable && editable.getAttribute('contenteditable') !== 'false') ||
    el.isContentEditable
  );
}

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
let _resizeObs = null;   // VS.stage, VS.layers, VS.unsubs → VS (cœur Konva/teardown partagé)
let _vttEntered = false;   // le client a-t-il cliqué « Entrer » (listeners actifs) ?
let _bestiaryLoads = new Map(); // beastId → Promise lecture doc ciblée
// [VS.bstTracker → VS.bstTracker] (défaut dans vtt-state.js)
let _attackSrc = null, _moveHL = [];   // VS.selected, VS.tool → VS ; VS.characters/VS.npcs/VS.bestiary → VS
// (état de scène : session, pages, tokens, activePage, stage, layers, characters,
//  npcs, bestiary, selected, tool → VS / vtt-state.js)
// Mode "action d'abord" (action-first) : l'action est choisie AVANT la cible.
// Quand _aimOpt est posée, un clic sur un token résout l'action sur cette cible.
export let _aimOpt     = null;   // option pré-choisie en attente de cible
let _aimSrcId   = null;   // token source de la visée
let _actBar     = null;   // barre d'action DOM ancrée au token sélectionné
let _actBarSrc  = null;   // srcId courant de la barre d'action
let _actBarRAF  = 0;      // rAF de re-positionnement de la barre
let _mtCtx      = null; // contexte multi-cibles actif { srcId, opt, optIdx, targets[], maxTargets, lines Map }
let _mtBroadcasting = false; // évite un write active:false si rien n'a été diffusé
let _mtPending  = null; // cibles validées en attente du roll : string[]
let _zoneCtx    = null; // contexte zone AoE { srcId, tgtId, opt, optIdx, wPx, hPx, x, y, placed }
let _zonePreview= null; // Konva.Group prévisualisation zone
let _selfCtx    = null; // contexte déplacement "soi" { srcId, cells, opt }
let _selfCells  = [];   // cases Konva cliquables (losange Manhattan)
// [état chat (_chatMsgs/_chatReplyTo/_logMain/_logGm) → vtt-chat.js ; _chatMsgs importé pour bouclier/undo]
// [VS.selectedMulti → VS.selectedMulti] (défaut dans vtt-state.js)
let _multiDragOrigin= null;        // { [id]: {x,y} } positions au début du drag groupé
let _middlePanActive= false;       // true pendant le pan caméra au clic molette
let _suppressTokenClickUntil = 0;   // bloque le click synthétique après clic droit/molette
// [_autoSyncDone → vtt-autosync.js]
// [VS.weaponFormats / VS.damageTypes → VS.weaponFormats / VS.damageTypes (vtt-state.js)]
let _spellMatrices = null;   // cache matrices MJ (armes invoquées, combos config)
// [_emotes → vtt-emotes.js (importé en haut)]
// ── Bibliothèque de cartes ─────────────────────────────────────────
// (images BG/FG, mapMode, mapLib, mapLibUnsub → migrés dans VS / vtt-state.js)
// [_libFolder/_libOpen/_mapLibRef → vtt-maplib.js]

// ── Butin ─────────────────────────────────────────────────────────
// [état butin → vtt-loot.js]
// ── Lanceur de dés libre ───────────────────────────────────────────
// [état dés libre → vtt-dice.js]
// [VS.diceSkills → VS.diceSkills] (défaut dans vtt-state.js)
// [state musique → vtt-music.js]
// [VS.rollMode → VS.rollMode] (défaut dans vtt-state.js)
// [VS.rollBonus → VS.rollBonus] (défaut dans vtt-state.js)
// [_insTab → vtt-inspector.js]
VS.rollHidden = lsJson.get('vtt-roll-hidden', false); // MJ only — jet caché des joueurs
const _renderedPings     = new Set();
const _renderedReactions = new Set();

// ── Outils de dessin & règle ────────────────────────────────────────
// [CELL_M → vtt-constants.js ; état/fonctions règle → vtt-ruler.js]
let _annotations      = {};   // id → { data, shape }
let _selectedAnnotId  = null; // id de l'annotation sélectionnée (sélection simple)
let _selectedAnnotIds = new Set(); // multi-sélection annotations
let _vttClipboard = { tokens: [], annots: [] }; // presse-papier Ctrl+C/V (mémoire de session)
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
let _drawRedo     = [];      // data des annotations annulées (pour Ctrl+Y) — vidée à tout nouveau tracé
let _drawing      = false;   // tracé en cours
let _erasing      = false;   // gomme : effacement pressé en cours
let _drawPts      = [];      // points crayon libre (world coords)
let _drawOrigin   = null;    // point de départ pour formes
let _drawLive     = null;    // forme Konva live (avant sauvegarde)
let _drawColor    = '#ef4444';
let _drawWidth    = 2;
let _drawShape    = 'pencil'; // 'pencil'|'line'|'rect'|'circle'|'poly'|'eraser'
let _drawFill     = false;
// Polygone (tracé sommet par sommet) : clic = pose un sommet, double-clic / clic sur
// le 1er point = ferme. État séparé du drag (pas de _drawing : multi-clics).
let _polyPts      = [];      // sommets posés [x,y,…] (world coords)
let _polyLive     = null;    // ligne Konva fermée (aperçu)
let _polyActive   = false;   // tracé polygone en cours
// Types d'annotation « à points » (position via offsetX/Y, pas x/y centre).
const _ANNOT_PTS_TYPES = new Set(['freehand', 'line', 'polygon']);
// [état règle (_rulerActive/_rulerOrigin/_rulerHideTimer/…) → vtt-ruler.js]

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
export let CONDITION_LIBRARY = CONDITION_DEFAULT_LIBRARY.map(c => ({ ...c, effects: { ...c.effects } }));
export let CONDITION_BY_ID   = Object.fromEntries(CONDITION_LIBRARY.map(c => [c.id, c]));
export function _rebuildConditionIndex() {
  CONDITION_BY_ID = Object.fromEntries(CONDITION_LIBRARY.map(c => [c.id, c]));
}
export function _isCustomCondition(id) { return !CONDITION_DEFAULT_IDS.has(id); }
// Setter de CONDITION_LIBRARY pour les modules externes (le binding live ne peut
// être réassigné que par son module propriétaire). Cf. vtt-conditions-config.js.
export function _setConditionLibrary(lib) { CONDITION_LIBRARY = lib; }

// [_STAT_KEY / _STAT_COLOR / _STAT_RGB → vtt-constants.js (importés en haut)]
// [_MS_STATS → vtt-mini-fiche.js]

export const _numOr = (value, fallback = null) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}
export const _signed = n => n > 0 ? `+${n}` : `${n}`;
const _npcStatScore = (npc, key) => _numOr(npc?.stats?.[key], 8);
export const _npcStatMod = (npc, key) => getModFromScore(_npcStatScore(npc, key));
export const _npcCombat = (npc = {}) => npc?.combat || {};
export const _tokenStatMod = (t, statKey) => {
  if (!t || !statKey) return 0;
  if (t.characterId) {
    const c = VS.characters[t.characterId];
    return c ? getMod(c, statKey) : 0;
  }
  if (t.npcId) return _npcStatMod(VS.npcs[t.npcId] || {}, statKey);
  if (t.beastId) {
    const b = VS.bestiary[t.beastId];
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
// [VS.presence → VS.presence] (défaut dans vtt-state.js)
// [VTT_PRESENCE_HEARTBEAT_MS → vtt-presence.js]
// [état présence → vtt-presence.js]
// [_emoteCloseOutside → vtt-emotes.js ; teardown via _closeEmotePicker()]
// [état tray (_trayFilter/_traySearch/_trayTab/_pageFold…) → vtt-tray.js]
// [VS.miniUid → VS.miniUid] (défaut dans vtt-state.js)
// [VS.miniCharId → VS.miniCharId] (défaut dans vtt-state.js)
// [_miniTab → vtt-mini-fiche.js]
// [état mini-fiche → vtt-mini-fiche.js]
// Filtres locaux des onglets Sac / Sorts (recherche texte + catégorie active).
// Filtrage DOM in-place (pas de re-render) → le focus de la recherche est conservé.
// [état mini-fiche → vtt-mini-fiche.js]
// [état mini-fiche → vtt-mini-fiche.js]

// ── Timer de session ────────────────────────────────────────────────
// Stocké dans VS.session.timer = { startedAt:ms, accumulated:ms, running:bool, label:string }
// [_timerTick → vtt-timer.js]

// ── Combat tracker (overlay haut-gauche sur le canvas) ──────────────
// [_combatTab → vtt-combat-tracker.js]

// ── Refs Firestore ──────────────────────────────────────────────────
// Déplacées dans le module leaf ./vtt-refs.js (importées en haut de fichier) ;
// les sous-modules les importent de là plutôt que circulairement d'ici.
// [refs musique → vtt-music.js]

// ═══════════════════════════════════════════════════════════════════
// DONNÉES EFFECTIVES — fusion token + entité liée
// C'est ici que la sync temps réel prend tout son sens :
// HP/nom/image viennent toujours de la fiche source.
// ═══════════════════════════════════════════════════════════════════

// [Données effectives (_live + helpers token/entité) → vtt-effective.js (importées en haut)]

/**
 * Peut-on contrôler ce token ?
 *   - admin (MJ) → toujours
 *   - propriétaire du token (ownerId) → toujours
 *   - délégué de contrôle (controlDelegates: [uid…]) → permission accordée par le propriétaire
 *
 * Sert à toutes les actions « contrôler le token » : drag, lancement d'attaque/sort,
 * déclenchement de buff en attente, ouverture du menu d'actions, etc.
 */
export function _canControlToken(t, uid = STATE.user?.uid) {
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
export function _resolveUidName(uid) {
  if (!uid) return '?';
  // Cherche le perso lié à cet UID
  const ch = Object.values(VS.characters || {}).find(c => c?.uid === uid);
  if (ch?.ownerPseudo) return ch.ownerPseudo;
  if (ch?.nom)         return ch.nom;
  // Fallback : UID court
  return uid.slice(0, 6) + '…';
}

// ── Ressource PM CANONIQUE d'un perso ────────────────────────────────────────
// La fiche écrit `pmActuel` ; le VTT écrivait `pm` → deux vérités qui divergent
// (PM pleins affichés sur la fiche après plusieurs lancements). Lecture :
// pmActuel (fiche) > pm (legacy VTT) > max. Écriture : LES DEUX champs, pour
// rester cohérent avec les anciennes sessions et tous les consommateurs.
export function _charPmCur(c) { return c?.pmActuel ?? c?.pm ?? calcPMMax(c); }
export function _charPmPatch(v) { return { pm: v, pmActuel: v }; }

// HP écrit sur la fiche source (bidirectionnel)
export async function _setHp(t, newHp) {
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
export async function _vttTriggerConcentrationSave(td, damageAmount, nextHp = null, opts = {}) {
  if (!td || damageAmount <= 0) return [];
  let liveTd = VS.tokens?.[td.id]?.data || td;
  const freshSnap = td.id ? await getDoc(_tokRef(td.id)).catch(() => null) : null;
  if (freshSnap?.exists?.()) {
    liveTd = { ...liveTd, ...freshSnap.data(), id: td.id };
  }
  const buffs = (liveTd.buffs || []).filter(b => b?.canalisePersistant && b?.concentrationDD != null);
  const round = VS.session?.combat?.round ?? 0;
  const activeConditions = (liveTd.conditions || []).filter(c => {
    if (c.expiresAtRound != null && round > 0 && round > c.expiresAtRound) return false;
    return !!c.concentrationSpell || !!CONDITION_BY_ID[c.id]?.effects?.concentrationCheck;
  });
  if (!buffs.length && !activeConditions.length) return [];
  const sagMod = _tokenStatMod(liveTd, 'sagesse');
  const tgtName = _live(liveTd).displayName ?? liveTd.name;
  const notes = [];
  const deferredLogs = [];
  const graceBuffs = [];
  const baseRound = Math.max(1, round);
  const graceExpiresAtRound = baseRound + 2 - 1;
  const forcedBreak = nextHp != null && nextHp <= 0;
  const logConcentration = async ({ cond, lib, roll = null, total = null, dd = null, passed = false, forced = false }) => {
    const label = cond?.sortLabel || cond?.source || lib?.label || 'Concentration';
    const payload = {
      type: 'concentration-save',
      authorId: STATE.user?.uid || null,
      authorName: STATE.profile?.pseudo || STATE.profile?.prenom || 'MJ',
      tokenName: tgtName,
      characterImage: _live(liveTd).displayImage || null,
      ..._vttLogTargetFields(liveTd),
      sortLabel: label,
      conditionLabel: lib?.label || 'Concentré',
      statLabel: 'Sa',
      mod: sagMod,
      d20: roll,
      total,
      dd,
      passed,
      forcedBreak: forced,
      newHp: nextHp,
      createdAt: serverTimestamp(),
    };
    if (opts.deferLog) deferredLogs.push(payload);
    else await addDoc(_logCol(), payload).catch(() => {});
  };
  for (const cb of buffs) {
    const dd = cb.concentrationDD;
    const roll = Math.floor(Math.random() * 20) + 1;
    const tot = roll + sagMod;
    const success = roll === 20 || (roll !== 1 && tot >= dd);
    const rollStr = `JS Sa ${roll}${sagMod>=0?'+':''}${sagMod}=${tot} vs DD${dd}`;
    if (success) {
      notes.push(`🧠 ${rollStr} · ${cb.sortLabel} tenu (${tgtName})`);
    } else {
      notes.push(`💢 ${rollStr} ÉCHEC · ${cb.sortLabel} rompu sur ${tgtName} · persiste encore 2 tours`);
      graceBuffs.push(cb);
      // Les summons canalisés liés perdent la concentration, mais restent 2 tours.
      const summonsToExpire = Object.values(VS.tokens).filter(e =>
        e?.data?.summonOwnerId === (cb.casterId || td.id) && e?.data?.summonCanalise
      );
      for (const s of summonsToExpire) {
        await updateDoc(_tokRef(s.data.id), {
          summonCanalise: false,
          summonExpiresAtRound: graceExpiresAtRound,
        }).catch(() => {});
      }
    }
  }

  const removedConditions = [];
  for (const cond of activeConditions) {
    const lib = CONDITION_BY_ID[cond.id];
    if (forcedBreak && cond?.concentrationSpell) {
      await logConcentration({ cond, lib, passed: false, forced: true });
      removedConditions.push(cond);
      continue;
    }
    const dd = cond.saveDC || lib?.defaultDC || 11;
    const roll = Math.floor(Math.random() * 20) + 1;
    const tot = roll + sagMod;
    const success = roll === 20 || (roll !== 1 && tot >= dd);
    const rollStr = `JS Sa ${roll}${sagMod>=0?'+':''}${sagMod}=${tot} vs DD${dd}`;
    if (success) {
      await logConcentration({ cond, lib, roll, total: tot, dd, passed: true });
    } else {
      await logConcentration({ cond, lib, roll, total: tot, dd, passed: false });
      removedConditions.push(cond);
    }
  }

  if (graceBuffs.length) {
    const remaining = (liveTd.buffs || []).map(b => {
      if (!graceBuffs.includes(b)) return b;
      const { canalisePersistant, concentrationDD, ...rest } = b;
      return {
        ...rest,
        totalDuration: 2,
        startRound: baseRound,
        expiresAtRound: graceExpiresAtRound,
        concentrationGrace: true,
      };
    });
    await updateDoc(_tokRef(liveTd.id), { buffs: remaining }).catch(() => {});
  }
  if (removedConditions.length) {
    const remainingConditions = (liveTd.conditions || []).filter(c => !removedConditions.includes(c));
    await updateDoc(_tokRef(liveTd.id), { conditions: remainingConditions }).catch(() => {});
    for (const cond of removedConditions) {
      if (cond?.concentrationSpell) {
        await _vttBreakConcentrationEffects(liveTd.id, cond);
      }
    }
  }
  notes.concentrationLogs = deferredLogs;
  return notes;
}

// ═══════════════════════════════════════════════════════════════════
// AUTO-SYNC TOKENS — crée les tokens manquants pour persos et PNJ
// ═══════════════════════════════════════════════════════════════════
// [_charsReady/_npcsReady/_toksReady → vtt-autosync.js]

// [Auto-sync des tokens (création/réserve) → vtt-autosync.js (importé en haut)]
// ═══════════════════════════════════════════════════════════════════
// KONVA — chargement dynamique CDN
// ═══════════════════════════════════════════════════════════════════
// [_loadKonva → vtt-render.js (importé en haut)]

// ═══════════════════════════════════════════════════════════════════
// NETTOYAGE
// ═══════════════════════════════════════════════════════════════════
function _cleanup() {
  VS.unsubs.forEach(u => u?.());
  VS.unsubs = []; VS.stage?.destroy(); VS.stage = null; VS.layers = {};
  _resizeObs?.disconnect(); _resizeObs = null;
  _resetPresence();
  _timerStopTick();
  _closeEmotePicker();  // retire le listener mousedown du picker (état dans vtt-emotes.js)
  if (VS.mapLibUnsub) { VS.mapLibUnsub(); VS.mapLibUnsub = null; }
  VS.mapLib = { folders: [], images: [] }; _resetMapLib();
  _resetLootState();
  _resetMusicState();
  _mtClear(true);
  _mtBroadcasting = false;
  VS.presence = {}; VS.miniUid = null; VS.miniCharId = null;
  VS.tokens = {}; VS.pages = {}; VS.characters = {}; VS.npcs = {}; VS.bestiary = {}; VS.bstTracker = {};
  _bestiaryLoads.clear();
  VS.session = {}; VS.activePage = null; VS.selected = null; _attackSrc = null;
  _clearAim(); _hideActBar();
  _moveHL = []; _renderedPings.clear(); _renderedReactions.clear();
  VS.selectedMulti.clear(); _multiDragOrigin = null;
  _annotations = {}; _drawing = false; _drawLive = null; _drawHistory = []; _drawRedo = [];
  _polyPts = []; _polyLive = null; _polyActive = false;
  _selectedAnnotId = null; _selectedAnnotIds.clear(); _annotTransformer = null;
  _annotGroupDragOrigins = null;
  _marqueeActive = false; _marqueeOrigin = null; _marqueeLastWp = null;
  _marqueeShape = null; _suppressNextClick = false;
  _pingTimer = null; _pingOrigin = null;
  _resetRuler();  // réinitialise aussi l'état de diffusion MJ (cf. vtt-ruler.js)
  _resetAutoSync();
  _resetTraySearch();
  VS.imgTr = null; VS.imgTrFg = null; VS.selImg = null; VS.mapMode = false;
  _hideCtxMenu();
  document.removeEventListener('keydown', _keyHandler);
  const mc = document.getElementById('main-content');
  if (mc) { mc.style.overflow = ''; mc.style.height = ''; mc.style.paddingBottom = ''; }
}

// ═══════════════════════════════════════════════════════════════════
// CANVAS
// ── Drag & drop tray → canvas ──────────────────────────────────────
// Rend les items du tray déposables sur la case voulue (au lieu du clic → case
// fixe). Le clic reste (fallback tactile). Payload = "beast:<id>" | "token:<id>" | "image:<id>"
// posé par un dragstart délégué (les items portent draggable + data-vtt-drag).
const _VTT_DND_MIME = 'text/vtt-place';
function _wireTrayDrop(container) {
  const onDragStart = (e) => {
    const el = e.target?.closest?.('[data-vtt-drag]');
    if (!el || !e.dataTransfer) return;
    e.dataTransfer.setData(_VTT_DND_MIME, el.dataset.vttDrag);
    e.dataTransfer.effectAllowed = 'copy';
  };
  const isPlaceDrag = (e) => Array.from(e.dataTransfer?.types || []).includes(_VTT_DND_MIME);
  const onDragOver = (e) => {
    if (!isPlaceDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    container.classList.add('vtt-drop-active');
  };
  const onDragLeave = (e) => {
    if (e.relatedTarget && container.contains(e.relatedTarget)) return;
    container.classList.remove('vtt-drop-active');
  };
  const onDrop = (e) => {
    const payload = e.dataTransfer?.getData(_VTT_DND_MIME);
    if (!payload) return;
    e.preventDefault();
    container.classList.remove('vtt-drop-active');
    const rect = VS.stage.container().getBoundingClientRect();
    const wp = _stageToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    const cell = { col: Math.floor(wp.x / CELL), row: Math.floor(wp.y / CELL) };
    const sep = payload.indexOf(':');
    const kind = payload.slice(0, sep), id = payload.slice(sep + 1);
    if (kind === 'beast') _vttPlaceFromBestiary(id, cell);
    else if (kind === 'token') _vttPlace(id, cell);
    else if (kind === 'image') _vttLibPlace(id, cell);
  };
  document.addEventListener('dragstart', onDragStart);
  container.addEventListener('dragover', onDragOver);
  container.addEventListener('dragleave', onDragLeave);
  container.addEventListener('drop', onDrop);
  VS.unsubs.push(() => {
    document.removeEventListener('dragstart', onDragStart);
    container.removeEventListener('dragover', onDragOver);
    container.removeEventListener('dragleave', onDragLeave);
    container.removeEventListener('drop', onDrop);
  });
}

// ═══════════════════════════════════════════════════════════════════
function _initCanvas(container) {
  const K = window.Konva;
  K.dragButtons = [0, 2]; // Drag autorisé au clic gauche et droit (tokens/images/annotations).
  VS.stage = new K.Stage({ container, width: container.clientWidth, height: container.clientHeight });
  // Le calque d'effets DOM (sceaux/impacts) suit pan + zoom du stage.
  VS.stage.on('xChange yChange scaleXChange scaleYChange', _syncSigilLayer);
  // Drag & drop : poser une créature du bestiaire / un token de la réserve à la case voulue.
  _wireTrayDrop(container);
  // Konva recommande max 3-5 layers. On consolide bg+map dans `backLayer` et
  // fog+walls+mapFg+ping dans `frontLayer` via des Konva.Group. L'ordre interne
  // préserve le z-order, et chaque "VS.layers.X" garde son API usuelle.
  // batchDraw() est forwardé vers le layer parent.
  // MJ : ordre historique inchangé. Joueur : le fog recouvre aussi les
  // structures et le premier plan pour ne révéler aucun élément hors LOS.
  // Le Stage ne contient ainsi que 5 vrais layers Konva.
  const backLayer  = new K.Layer();
  const frontLayer = new K.Layer();
  const _asLayer = (group, parentLayer) => {
    group.batchDraw = () => parentLayer.batchDraw();
    return group;
  };
  VS.layers.bg    = _asLayer(new K.Group({ listening: false }), backLayer);
  VS.layers.map   = _asLayer(new K.Group({ listening: false }), backLayer);
  VS.layers.grid  = new K.Layer({ listening: true });
  VS.layers.draw  = new K.Layer();                     // annotations (entre grille et tokens)
  VS.layers.walls = _asLayer(new K.Group({ listening: true }), frontLayer);  // murs/portes/fenêtres/lumières
  VS.layers.token = new K.Layer();
  VS.layers.fog   = _asLayer(new K.Group({ listening: false }), frontLayer); // masque de brouillard
  VS.layers.mapFg = _asLayer(new K.Group({ listening: false }), frontLayer);
  VS.layers.ping  = _asLayer(new K.Group({ listening: false }), frontLayer);
  backLayer.add(VS.layers.bg, VS.layers.map);
  if (STATE.isAdmin) {
    frontLayer.add(VS.layers.fog, VS.layers.walls, VS.layers.mapFg, VS.layers.ping);
  } else {
    frontLayer.add(VS.layers.walls, VS.layers.mapFg, VS.layers.fog, VS.layers.ping);
  }
  VS.stage.add(backLayer, VS.layers.grid, VS.layers.draw, VS.layers.token, frontLayer);
  fogInit(VS.stage, VS.layers, CELL);
  fogSetPgRef(id => _pgRef(id));

  // Transformers pour redimensionner les images (MJ uniquement)
  if (STATE.isAdmin) {
    const trCfg = {
      rotateEnabled: false, keepRatio: false,
      borderStroke: '#4f8cff', borderStrokeWidth: 2,
      anchorStroke: '#4f8cff', anchorFill: '#fff',
      anchorSize: 10, anchorCornerRadius: 3,
    };
    VS.imgTr   = new K.Transformer(trCfg); VS.layers.map.add(VS.imgTr);
    VS.imgTrFg = new K.Transformer(trCfg); VS.layers.mapFg.add(VS.imgTrFg);
  }

  // Transformer annotations — disponible pour tous (chaque joueur interagit avec ses propres dessins)
  _annotTransformer = new K.Transformer({
    rotateEnabled: true, keepRatio: false,
    borderStroke: '#ffe600', borderStrokeWidth: 2, borderDash: [4, 3],
    anchorStroke: '#ffe600', anchorFill: '#1a1a2e', anchorSize: 13, anchorCornerRadius: 3,
    rotateAnchorOffset: 26, padding: 5,
    rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315], rotationSnapTolerance: 8,
  });
  VS.layers.draw.add(_annotTransformer);

  // Listener natif window : règle + marquee (bypass Konva, garanti même hors drag)
  const _nativeMoveHandler = e => {
    if (!VS.stage) return;
    const rect = container.getBoundingClientRect();
    const inCanvas = e.clientX >= rect.left && e.clientX <= rect.right &&
                     e.clientY >= rect.top  && e.clientY <= rect.bottom;
    const wp = inCanvas
      ? _stageToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      : null;

    // Règle (free-hover, reste dans le canvas)
    if (wp && VS.tool === 'ruler' && rulerActive()) _updateRuler(wp);
    else if (!wp) _hideRulerHover();

    // Marquee : suivi pendant le drag (peut sortir légèrement du canvas)
    if (VS.tool === 'select' && _marqueeOrigin) {
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
          VS.layers.ping.add(_marqueeShape);
        }
      }
      if (_marqueeActive && wp) {
        _marqueeLastWp = wp;
        const x = Math.min(_marqueeOrigin.x, wp.x), y = Math.min(_marqueeOrigin.y, wp.y);
        _marqueeShape?.setAttrs({ x, y,
          width:  Math.abs(wp.x - _marqueeOrigin.x),
          height: Math.abs(wp.y - _marqueeOrigin.y) });
        VS.layers.ping?.batchDraw();
      }
    }
  };
  window.addEventListener('mousemove', _nativeMoveHandler);
  VS.unsubs.push(() => window.removeEventListener('mousemove', _nativeMoveHandler));

  VS.stage.on('wheel', e => {
    e.evt.preventDefault();
    const old = VS.stage.scaleX();
    const dir = e.evt.deltaY < 0 ? 1 : -1;
    const sc  = Math.min(MAX_SCALE, Math.max(MIN_SCALE, old * (1 + dir * 0.1)));
    const ptr = VS.stage.getPointerPosition();
    VS.stage.scale({ x:sc, y:sc });
    VS.stage.position({ x: ptr.x - (ptr.x-VS.stage.x())*(sc/old), y: ptr.y - (ptr.y-VS.stage.y())*(sc/old) });
  });

  let _pan = false, _po = null, _rightStageDown = null;

  // Pan caméra au clic molette. K.dragButtons=[0] empêche déjà tout drag de
  // tokens/images/annotations sur autre que clic gauche, donc pas besoin de
  // toucher .draggable() ici.
  const _startMiddlePan = e => {
    if (e.button !== 1) return;
    if (!VS.stage) return;
    e.preventDefault();
    if (_middlePanActive) return;

    _middlePanActive = true;
    _pan = true;
    _po = { x: e.clientX - VS.stage.x(), y: e.clientY - VS.stage.y() };

    const onMove = ev => {
      if ((ev.buttons & 4) === 0) { onUp(); return; }
      ev.preventDefault();
      VS.stage.position({ x: ev.clientX - _po.x, y: ev.clientY - _po.y });
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
  VS.unsubs.push(() => {
    container.removeEventListener('mousedown', _startMiddlePan, true);
    container.removeEventListener('auxclick',  _preventMiddleAuxClick, true);
  });

  VS.stage.on('mousedown', e => {
    if (fogIsEditMode()) return; // éditeur de murs gère ses propres events
    if (e.evt.button===2) {
      e.evt.preventDefault();
      // Règle : clic droit = annulation immédiate (en cours ou figée), sans changer d'outil.
      if (VS.tool === 'ruler' && rulerBusy()) {
        _clearRuler();
        _rightStageDown = null;
        return;
      }
      // Pan caméra au clic droit UNIQUEMENT sur stage vide.
      // Sur un token/image/annotation, on laisse Konva gérer le drag (K.dragButtons=[0,2]).
      if (e.target === VS.stage) {
        _pan = true; _po = { x:e.evt.clientX-VS.stage.x(), y:e.evt.clientY-VS.stage.y() };
        _rightStageDown = { x:e.evt.clientX, y:e.evt.clientY };
      }
    }
    if (e.evt.button===0) {
      const rect0 = VS.stage.container().getBoundingClientRect();
      const np = { x: e.evt.clientX - rect0.left, y: e.evt.clientY - rect0.top };
      // Règle : 1er clic = départ, 2e clic = fin (pas besoin de maintenir)
      if (VS.tool === 'ruler') {
        if (_pingTimer) { clearTimeout(_pingTimer); _pingTimer = null; }
        const wp = _stageToWorld(np);
        if (!rulerActive()) _startRuler(wp);
        else                _endRuler();
        return;
      }
      // Dessin : cliquer-glisser. Gomme : supprime au survol pressé.
      if (VS.tool === 'draw') {
        if (_pingTimer) { clearTimeout(_pingTimer); _pingTimer = null; }
        if (_drawShape === 'eraser') { _erasing = true; _eraseAtPointer(); return; }
        if (_drawShape === 'poly') { _polyClick(_stageToWorld(np)); return; }
        _startDraw(_stageToWorld(np));
        return;
      }
      // Clic normal → ping (+ départ marquee en mode select)
      if (e.target===VS.stage) {
        if (VS.tool === 'select') _marqueeOrigin = _stageToWorld(np);
        _pingOrigin = { ...np };
        _pingTimer = setTimeout(() => {
          _pingTimer = null;
          if (_marqueeActive) return; // pas de ping si le lasso est en cours
          const sc = VS.stage.scaleX(), sp = VS.stage.position();
          _emitPing((_pingOrigin.x - sp.x) / sc, (_pingOrigin.y - sp.y) / sc);
        }, 300);
      }
    }
  });
  VS.stage.on('mousemove', e => {
    if (_pan && _po) VS.stage.position({ x:e.evt.clientX-_po.x, y:e.evt.clientY-_po.y });
    // Coordonnées canvas-relatives à partir de l'événement natif (plus fiable que getPointerPosition)
    const rect = VS.stage.container().getBoundingClientRect();
    const stagePtr = { x: e.evt.clientX - rect.left, y: e.evt.clientY - rect.top };
    if (_pingTimer && _pingOrigin) {
      const dx = stagePtr.x - _pingOrigin.x, dy = stagePtr.y - _pingOrigin.y;
      if (dx*dx + dy*dy > 64) { clearTimeout(_pingTimer); _pingTimer = null; }
    }
    const wp = _stageToWorld(stagePtr);
    if (VS.tool === 'ruler' && rulerActive())     _updateRuler(wp);
    else if (VS.tool === 'ruler')                 _showRulerHover(wp);
    if (VS.tool === 'draw'  && _drawShape === 'eraser' && _erasing && !_pan) _eraseAtPointer();
    else if (VS.tool === 'draw' && _drawShape === 'poly' && _polyActive && !_pan) _polyHover(wp);
    else if (VS.tool === 'draw' && _drawing && !_pan) _updateDraw(wp);
    if (_zoneCtx) _zoneUpdatePreview(wp);
  });
  VS.stage.on('mouseup', () => {
    _pan = false;
    _erasing = false;
    if (_pingTimer) { clearTimeout(_pingTimer); _pingTimer = null; }
    if (_marqueeActive) { _endMarquee(); _suppressNextClick = true; }
    _marqueeOrigin = null;
    if (VS.tool === 'draw' && _drawing) _endDraw();
  });
  VS.stage.on('contextmenu', e => {
    e.evt.preventDefault();
    if (e.target !== VS.stage) return;
    if (VS.tool === 'ruler') return; // clic droit en mode règle = annulation, pas de désélection
    const moved = _rightStageDown
      ? Math.hypot(e.evt.clientX - _rightStageDown.x, e.evt.clientY - _rightStageDown.y) > 6
      : false;
    _rightStageDown = null;
    if (moved) return;                 // clic droit glissé = pan caméra
    if (_polyActive) { _polyUndoPoint(); return; } // polygone en cours → retirer le dernier sommet
    _deselect(); _deselectAnnot();
  });
  // Double-clic : ferme le polygone en cours.
  VS.stage.on('dblclick dbltap', () => {
    if (VS.tool === 'draw' && _drawShape === 'poly' && _polyActive) _polyFinish();
  });
  VS.stage.on('click', e => {
    if (e.evt.button !== 0) return; // ignore middle/right (pan caméra)
    if (e.target===VS.stage) {
      if (_suppressNextClick) { _suppressNextClick = false; return; }
      if (_selfCtx) return; // placement déplacement actif : clic hors case = ne rien faire
      if (_zoneCtx) { _zoneCtx.placed = !_zoneCtx.placed; return; }
      _deselect(); _deselectAnnot();
    }
  });

  // ── Pan tactile : un doigt glissé sur le stage VIDE déplace la caméra ──
  //    Sur desktop le pan se fait au clic droit / molette ; le tactile n'a
  //    aucun de ces boutons → sans ça, impossible de se déplacer sur mobile.
  //    Toucher un token/image laisse Konva gérer le drag (e.target ≠ stage).
  let _touchPanOff = null;
  VS.stage.on('touchstart', e => {
    if (fogIsEditMode() || VS.tool === 'draw' || VS.tool === 'ruler') { _touchPanOff = null; return; }
    const ts = e.evt.touches;
    _touchPanOff = (ts && ts.length === 1 && e.target === VS.stage)
      ? { x: ts[0].clientX - VS.stage.x(), y: ts[0].clientY - VS.stage.y() }
      : null;
  });
  VS.stage.on('touchmove', e => {
    if (!_touchPanOff) return;
    const ts = e.evt.touches;
    if (!ts || ts.length !== 1) { _touchPanOff = null; return; }
    e.evt.preventDefault();   // empêche le scroll/zoom de page natif
    VS.stage.position({ x: ts[0].clientX - _touchPanOff.x, y: ts[0].clientY - _touchPanOff.y });
  });
  VS.stage.on('touchend touchcancel', () => { _touchPanOff = null; });

  _resizeObs = new ResizeObserver(() => {
    if (!VS.stage) return;
    VS.stage.width(container.clientWidth); VS.stage.height(container.clientHeight);
  });
  _resizeObs.observe(container);
}

// [_drawGrid → vtt-render.js (importé en haut) — 1re tranche du moteur de rendu]

// [_renderMapImages + _patchImg → vtt-render.js (importés en haut). Les effets
//  cross-domaine du clic de sélection sont injectés via _MAP_IMG_DEPS.]
export const _MAP_IMG_DEPS = { hideActBar: _hideActBar, clearHL: _clearHL, renderInspector: _renderInspector };

// ── Infobulle de token au survol (nom + états/buffs en clair) ──────────────
// Les badges d'états/buffs sur les tokens sont des icônes canvas non survolables.
// Ce tooltip DOM explique ce qu'ils signifient sans avoir à sélectionner le token.
const _BUFF_LABEL = {
  dot: 'Dégâts par tour', dmg_bonus: 'Bonus de dégâts (arme)', move_bonus: 'Déplacement +',
  move_debuff: 'Déplacement −', range_bonus: 'Portée +', toucher_bonus: 'Bonus au toucher',
  ca: 'Bonus de CA', shield_reactive: 'Bouclier réactif', enchantment: 'Enchantement',
  affliction: 'Affliction', weapon_replace: 'Arme invoquée', suspended_spell: 'Sort suspendu',
  lucky_reroll: 'Relance chanceuse', regen: 'Régénération',
};
let _tokenTipEl = null;
function _tokenTipEnsure() {
  if (_tokenTipEl) return _tokenTipEl;
  _tokenTipEl = document.createElement('div');
  _tokenTipEl.id = 'vtt-token-tip';
  document.body.appendChild(_tokenTipEl);
  return _tokenTipEl;
}
function _hideTokenTip() { if (_tokenTipEl) _tokenTipEl.style.display = 'none'; }
function _moveTokenTip(e) {
  if (!_tokenTipEl || _tokenTipEl.style.display === 'none' || !e?.evt) return;
  const pad = 14;
  let x = e.evt.clientX + pad, y = e.evt.clientY + pad;
  const w = _tokenTipEl.offsetWidth, h = _tokenTipEl.offsetHeight;
  if (x + w > window.innerWidth - 8)  x = e.evt.clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = e.evt.clientY - h - pad;
  _tokenTipEl.style.left = `${Math.max(4, x)}px`;
  _tokenTipEl.style.top  = `${Math.max(4, y)}px`;
}
function _showTokenTip(id, e) {
  const td = VS.tokens[id]?.data; if (!td) return;
  const round = VS.session?.combat?.round ?? 0;
  const active = (arr) => (arr || []).filter(x => x.expiresAtRound == null || round === 0 || round <= x.expiresAtRound);
  const conds = active(td.conditions), buffs = active(td.buffs);
  if (!conds.length && !buffs.length) { _hideTokenTip(); return; }   // rien à expliquer
  const ld = _live(td);
  const tl = (x) => (x.expiresAtRound != null && round > 0) ? ` (${x.expiresAtRound - round + 1}t)` : '';
  let html = `<div class="vtt-tip-name">${_esc(ld.displayName ?? td.name ?? '?')}</div>`;
  if (conds.length) html += `<div class="vtt-tip-row"><span class="vtt-tip-lbl">États</span>${conds.map(c => { const l = CONDITION_BY_ID[c.id]; return ` ${l?.icon || '⛓'} ${_esc(l?.label || c.id)}${tl(c)}`; }).join(' ·')}</div>`;
  if (buffs.length) html += `<div class="vtt-tip-row"><span class="vtt-tip-lbl">Effets</span>${buffs.map(b => { const lbl = _BUFF_LABEL[b.type] || b.sortLabel || 'Effet'; const src = (b.sortLabel && _BUFF_LABEL[b.type]) ? ` (${_esc(b.sortLabel)})` : ''; return ` ${_esc(lbl)}${src}${tl(b)}`; }).join(' ·')}</div>`;
  const el = _tokenTipEnsure();
  el.innerHTML = html;
  el.style.display = 'block';
  _moveTokenTip(e);
}

// ═══════════════════════════════════════════════════════════════════
// TOKENS — shapes Konva
// ═══════════════════════════════════════════════════════════════════
function _buildShape(t) {
  // Visuel pur (forme, barres, badges, nom, portrait) → vtt-render.js.
  // `ld` = données effectives (via _live) ; les handlers d'interaction ci-dessous
  // restent ici, attachés au groupe retourné.
  const ld = _live(t);
  const sw = ld.displayTokenW || 1, sh = ld.displayTokenH || 1;
  const g = _buildTokenVisual(t, ld, CONDITION_BY_ID);

  // Survol : infobulle nom + états/buffs EN CLAIR (comprendre les badges des tokens).
  g.on('mouseenter', e => _showTokenTip(t.id, e));
  g.on('mousemove',  e => _moveTokenTip(e));
  g.on('mouseleave', () => _hideTokenTip());

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
      _hideTokenTip();
      // En mode Règle (mesure) ou Dessin : le token ne doit pas se déplacer — la
      // mesure/le tracé (pilotés par le stage) restent prioritaires.
      if (VS.tool === 'ruler' || VS.tool === 'draw') {
        g.stopDrag();
        g.position({ x:t.col*CELL+sw*CELL/2, y:t.row*CELL+sh*CELL/2 });
        VS.layers.token?.batchDraw();
        return;
      }
      // En mode placement de zone ou de ciblage multi-cibles : pas de déplacement de token
      // (le sort doit rester prioritaire — un drag accidentel ne déplace pas le PJ)
      if (_zoneCtx || _mtCtx) {
        g.stopDrag();
        g.position({ x:t.col*CELL+sw*CELL/2, y:t.row*CELL+sh*CELL/2 });
        VS.layers.token?.batchDraw();
        return;
      }
      if (_middlePanActive) {
        g.stopDrag();
        g.position({ x:t.col*CELL+sw*CELL/2, y:t.row*CELL+sh*CELL/2 });
        VS.layers.token?.batchDraw();
        return;
      }
      if (VS.selectedMulti.has(t.id) && VS.selectedMulti.size>1) {
        _multiDragOrigin={};
        for (const id of VS.selectedMulti) {
          const s=VS.tokens[id]?.shape;
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
      if (_multiDragOrigin && VS.selectedMulti.has(t.id)) {
        const dx=sx-_multiDragOrigin[t.id].x, dy=sy-_multiDragOrigin[t.id].y;
        for (const [id,orig] of Object.entries(_multiDragOrigin)) {
          if (id===t.id) continue;
          const s=VS.tokens[id]?.shape; if (!s) continue;
          const d2=_tokenDims(VS.tokens[id].data);
          s.position({
            x:Math.round((orig.x+dx-d2.w*CELL/2)/CELL)*CELL+d2.w*CELL/2,
            y:Math.round((orig.y+dy-d2.h*CELL/2)/CELL)*CELL+d2.h*CELL/2,
          });
        }
        VS.layers.token.batchDraw();
      }
    });
    // ─ Fin du drag : commit Firestore ─
    g.on('dragend', async () => {
      const pg=VS.activePage; if (!pg) return;
      if (_multiDragOrigin && VS.selectedMulti.has(t.id) && VS.selectedMulti.size>1) {
        // Batch : sauver tous les tokens du groupe
        const batch=writeBatch(db);
        for (const id of VS.selectedMulti) {
          const s=VS.tokens[id]?.shape; if (!s) continue;
          const d2=_tokenDims(VS.tokens[id].data);
          const nc=_clampTokenCell(Math.round((s.x()-d2.w*CELL/2)/CELL), d2.w, pg.cols);
          const nr=_clampTokenCell(Math.round((s.y()-d2.h*CELL/2)/CELL), d2.h, pg.rows);
          s.position({x:nc*CELL+d2.w*CELL/2,y:nr*CELL+d2.h*CELL/2});
          batch.update(_tokRef(id),{col:nc,row:nr});
        }
        VS.layers.token.batchDraw();
        await batch.commit().catch(()=>showNotif('Erreur déplacement groupe','error'));
        _multiDragOrigin=null; return;
      }
      // Token seul
      const c=_clampTokenCell(Math.round((g.x()-sw*CELL/2)/CELL), sw, pg.cols);
      const r=_clampTokenCell(Math.round((g.y()-sh*CELL/2)/CELL), sh, pg.rows);
      if (!STATE.isAdmin && VS.session?.combat?.active) {
        const cur=VS.tokens[t.id]?.data;
        if (cur) {
          const d=Math.abs(c-cur.col)+Math.abs(r-cur.row);
          const maxMvt=(_live(cur).displayMovement??6)+(cur.bonusMvt||0);
          const rem=maxMvt-(cur.movedCells||0);
          if (d > rem) {
            showNotif(rem<=0 ? 'Plus de mouvement ce tour !' : `Trop loin ! (${rem} case${rem!==1?'s':''} restante${rem!==1?'s':''})`, 'error');
            g.position({x:cur.col*CELL+sw*CELL/2,y:cur.row*CELL+sh*CELL/2}); VS.layers.token.batchDraw(); return;
          }
        }
      }
      // Blocage par les murs (joueurs seulement)
      if (!STATE.isAdmin && (VS.activePage?.walls||[]).length) {
        const cur=VS.tokens[t.id]?.data;
        if (cur && fogWallBlocksPath(cur.col, cur.row, c, r, VS.activePage.walls)) {
          showNotif('🧱 Chemin bloqué !', 'error');
          g.position({x:cur.col*CELL+sw*CELL/2,y:cur.row*CELL+sh*CELL/2}); VS.layers.token.batchDraw(); return;
        }
      }
      g.position({x:c*CELL+sw*CELL/2,y:r*CELL+sh*CELL/2}); VS.layers.token.batchDraw();
      const patch={col:c,row:r};
      if (!STATE.isAdmin&&VS.session?.combat?.active) {
        const cur=VS.tokens[t.id]?.data;
        const d=Math.abs(c-(cur?.col??c))+Math.abs(r-(cur?.row??r));
        patch.movedCells=(cur?.movedCells||0)+d;
        patch.movedThisTurn=true;
      }
      await updateDoc(_tokRef(t.id),patch).catch(()=>showNotif('Erreur déplacement','error'));
      // Mise à jour optimiste + refresh des zones (déplacement et attaque)
      const _entry=VS.tokens[t.id];
      if (_entry?.data) {
        _entry.data.col=c; _entry.data.row=r;
        if (patch.movedCells!==undefined)   _entry.data.movedCells=patch.movedCells;
        if (patch.movedThisTurn!==undefined) _entry.data.movedThisTurn=patch.movedThisTurn;
      }
      _refreshRanges(t.id, _entry?.data);
      fogUpdateSoon(VS.activePage, VS.tokens, STATE.isAdmin);
    });
  }

  const _isAttackTargetInRange = (srcId, tgtId) => {
    const src = VS.tokens[srcId]?.data;
    const tgt = VS.tokens[tgtId]?.data;
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
    if (VS.tool === 'ruler' || VS.tool === 'draw') return; // outils de dessin ignorent les tokens
    // Si le token du joueur est masqué sous un autre token, prioriser son propre token
    // lors d'une sélection simple (sauf attaque/zone/cible multi/shift).
    if (!STATE.isAdmin && !_attackSrc && !_zoneCtx && !_mtCtx
        && !e.evt.shiftKey && !e.evt.ctrlKey && !e.evt.metaKey
        && t.ownerId !== STATE.user?.uid) {
      const ownId = _findOwnTokenAtPointer();
      if (ownId && ownId !== t.id) {
        _clearMultiSelect();
        _select(ownId);
        return;
      }
    }
    if ((e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey) && _canControlToken(t)) {
      // Ctrl/Cmd/Maj+clic : ajouter / retirer du groupe multi-sélection (un par un)
      _toggleMultiSelect(t.id); return;
    }
    _clearMultiSelect();

    // Mode zone AoE actif → le clic verrouille / déverrouille le placement.
    // Aucun token n'est sélectionnable ici, lanceur compris : sinon cliquer sur
    // le lanceur tombait dans le `else` final et rouvrait le HUD d'action.
    if (_zoneCtx) {
      _zoneCtx.placed = !_zoneCtx.placed;
      return;
    }

    // Mode ciblage multi-cibles actif → basculer la cible
    if (_mtCtx && t.id !== _mtCtx.srcId) {
      _mtToggleTarget(t.id);
      return;
    }

    // Mode visée "action d'abord" : l'action est déjà choisie, ce clic désigne la cible.
    if (_aimOpt && _aimSrcId) {
      if (t.id !== _aimSrcId && !_isAimTargetInRange(_aimSrcId, t.id, _aimOpt)) return;
      _resolveAim(_aimSrcId, t.id, _aimOpt);
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
  // Frontière d'erreur par token : un token corrompu ne casse pas le rendu des
  // autres (la boucle onSnapshot continue). Le token garde son état précédent.
  try { return _patchShapeImpl(id); }
  catch (e) { _vttPanelError('Token', e, null); }
}
function _patchShapeImpl(id) {
  const e=VS.tokens[id]; if (!e?.shape) return;
  // Garde-fou : un token d'une autre page (ou en réserve) n'a rien à dessiner
  // sur le calque courant. Sans ça, un patch (ex. édition PV/PM d'un perso ayant
  // un token sur une autre page) ré-ajoute son shape — détruit mais encore
  // référencé — au calque actif → des tokens d'une autre page « apparaissent ».
  if (e.data.pageId !== VS.activePage?.id) return;
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
  const _condRoundP = VS.session?.combat?.round ?? 0;
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
  if ((ld.displayPm != null || ld.hasMana) !== hasPmBar || hasCaBuff !== needsCaBuff || sizeMismatch || imageMismatch || condMismatch || buffMismatch) {
    const shape = _buildShape(e.data);
    g.destroy();
    VS.tokens[id] = { ...e, shape };
    VS.layers.token?.add(shape);
    if (VS.selected === id) shape.findOne('.sel')?.visible(true);
    if (_attackSrc === id) shape.findOne('.atk')?.visible(true);
    VS.layers.token?.batchDraw();
    return;
  }
  g.to({ x:e.data.col*CELL+sw*CELL/2, y:e.data.row*CELL+sh*CELL/2, duration:0.12 });
  const hpKnownU = ld.displayHp !== null && ld.displayHpMax !== null;
  const hp=hpKnownU?ld.displayHp:0, hpm=hpKnownU?ld.displayHpMax:1;
  const rat=hpKnownU?(hpm>0?Math.min(1,Math.max(0,hp/hpm)):1):0.5, bW=CELL*sw*0.9;
  const fill=g.findOne('.hp-fill');
  if (fill){fill.width(bW*rat);fill.fill(hpKnownU?hpColor(rat):'#555');}
  g.findOne('.hp-val')?.text(hpKnownU?`${hp}/${hpm}`:'?/?');
  // PM (créatures avec mana ; "✨?" si pas d'estimation côté joueur)
  const _pm=ld.displayPm;
  if (_pm!=null || ld.hasMana) {
    const _pmK=_pm!=null;
    const pmMax=ld.displayPmMax??1, pmRat=_pmK&&pmMax>0?Math.min(1,Math.max(0,_pm/pmMax)):(_pmK?1:0);
    g.findOne('.pm-fill')?.width(bW*pmRat);
    g.findOne('.pm-fill')?.fill(_pmK?'#9b6dff':'#555');
    g.findOne('.pm-val')?.text(_pmK?`✨${_pm}/${pmMax}`:'✨?');
  }
  // CA + buff
  const _buff   = ld._activeCaBuff;
  const _buffed = !!_buff;
  const _round  = VS.session?.combat?.round ?? 0;
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
  g.visible(STATE.isAdmin || (!!e.data.visible && !_tokenOffGrid(e.data)));
  VS.layers.token?.batchDraw();
}

// ── Sélection ───────────────────────────────────────────────────────
export function _select(id) {
  _clearAim(); // changer de sélection annule une visée action-first en cours
  if (VS.imgTr&&VS.selImg) { VS.imgTr.nodes([]); VS.selImg=null; VS.layers.map?.batchDraw(); }
  VS.tokens[VS.selected]?.shape?.findOne('.sel')?.visible(false);
  VS.tokens[_attackSrc]?.shape?.findOne('.atk')?.visible(false);
  _attackSrc=null; _clearHL();
  VS.selected=id;
  VS.tokens[id]?.shape?.findOne('.sel')?.visible(true);
  VS.layers.token.batchDraw();
  const data=VS.tokens[id]?.data;
  _renderInspector(data??null);
  // Clic sur un token allié/propre : portée de déplacement (bleu) + portée d'attaque (rouge)
  if (data && _canControlToken(data)) {
    _attackSrc=id;
    VS.tokens[id]?.shape?.findOne('.atk')?.visible(true);
    VS.layers.token.batchDraw();
    _showMoveRange(data);    // cases bleues cliquables (déplacement)
    _showAttackRange(data);  // cases rouges par-dessus (visuel portée)
    _showActBar(id);         // barre d'action ancrée (Armes/Sorts/Objets/Actions)
  } else {
    _hideActBar();
  }
}

export function _deselect() {
  VS.tokens[VS.selected]?.shape?.findOne('.sel')?.visible(false);
  VS.tokens[_attackSrc]?.shape?.findOne('.atk')?.visible(false);
  _clearAim(); _hideActBar();
  VS.selected=null; _attackSrc=null; _clearHL(); _clearMultiSelect(); _renderInspector(null);
  if (VS.imgTr)   { VS.imgTr.nodes([]); VS.layers.map?.batchDraw(); }
  if (VS.imgTrFg) { VS.imgTrFg.nodes([]); VS.layers.mapFg?.batchDraw(); }
  VS.selImg=null;
  VS.layers.token?.batchDraw();
}

// ════════════════════════════════════════════════════════════════════
// COMBAT « ACTION D'ABORD » : barre d'action ancrée + mode visée
//  Flux : clic sur son token → barre de catégories ancrée (Armes/Sorts/
//  Objets/Actions) → on choisit l'action → portée affichée → clic cible → jet.
//  Le flux historique « clic sur l'ennemi = attaque » reste actif en parallèle.
// ════════════════════════════════════════════════════════════════════

// ── HUD d'action fixe en bas du canvas (remplace la barre ancrée) ────
// Le picker d'actions (construit par _execAttack en mode noTgt) est désormais
// DOCKÉ en bas du canvas plutôt qu'ancré au token : il ne flotte plus sur le
// jeu et ne bloque plus les clics là où on veut viser. Il persiste pendant la
// visée (le canvas au-dessus reste cliquable).
export function _showActBar(srcId) {
  const t = VS.tokens[srcId]?.data;
  if (!t || !_canControlToken(t)) { _hideActBar(); return; }
  _execAttack(srcId, null).catch(e => console.error('[vtt] HUD action:', e));   // rend le picker dans le HUD (cf. fin de _execAttack)
}

function _hideActBar() { _hideActionHud(); }

// Repli du tiroir d'actions (overlay bas du canvas) — état persistant.
// Replié = barre fine (en-tête token seul) → la carte est rendue ; déplié =
// cartes d'action visibles. Distinct du ✕ (qui ferme tout le tiroir).
let _hudCollapsed = false;
try { _hudCollapsed = localStorage.getItem('vtt-hud-collapsed') === '1'; } catch {}
function _applyHudCollapsed() {
  document.getElementById('vtt-action-hud')?.classList.toggle('is-collapsed', _hudCollapsed);
}
function _vttToggleHudCollapse() {
  _hudCollapsed = !_hudCollapsed;
  try { localStorage.setItem('vtt-hud-collapsed', _hudCollapsed ? '1' : '0'); } catch {}
  _applyHudCollapsed();
}

// Conteneur du HUD : overlay absolu en bas du container Konva (créé à la volée).
function _actionHudEl() {
  let hud = document.getElementById('vtt-action-hud');
  if (!hud) {
    const wrap = VS.stage?.container();
    if (!wrap) return null;
    hud = document.createElement('div');
    hud.id = 'vtt-action-hud';
    hud.className = 'vtt-action-hud';
    // Molette verticale → défilement horizontal de la rangée d'actions (hotbar).
    hud.addEventListener('wheel', (e) => {
      const list = hud.querySelector('.vtt-aopt-list');
      if (!list || !e.deltaY || list.scrollWidth <= list.clientWidth) return;
      list.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
    wrap.appendChild(hud);
  }
  return hud;
}
function _showActionHud(html) {
  const hud = _actionHudEl();
  if (!hud) return;
  hud.innerHTML = html;
  hud.classList.add('show');
  _applyHudCollapsed();   // réapplique l'état replié persistant à chaque rendu
}
function _hideActionHud() {
  const hud = document.getElementById('vtt-action-hud');
  if (hud) { hud.classList.remove('show'); hud.innerHTML = ''; }
}

// Clic sur une catégorie de la barre → ouvre le picker filtré, SANS cible (action d'abord).
function _vttActBarCat(srcId, cat) {
  _execAttack(srcId, null, { only: cat });
}

// ── Mode visée : action choisie, en attente d'un clic sur la cible ───
function _vttAimOpt(srcId, idx) {
  const opt = _atkOptsCache[`${srcId}__`]?.[+idx];
  if (!opt) return;
  if ((opt.cooldownRemaining || 0) > 0) {
    showNotif(`Sort en recharge (${opt.cooldownRemaining} tour${opt.cooldownRemaining > 1 ? 's' : ''}).`, 'warning');
    return;
  }
  closeModalDirect();
  if (opt.targetSelf) { _resolveAim(srcId, srcId, opt); return; }  // potions/buffs perso : direct
  // Sort de zone (ou invocation, zone min 1×1) : pas besoin de viser une cible →
  // on entre directement en placement de zone (clic token → clic sort → place).
  if (opt.zoneW > 0 || opt.zoneH > 0) { _hideActBar(); _startZonePlacement(srcId, srcId, opt, +idx); return; }
  _startAim(srcId, opt);
}

function _startAim(srcId, opt) {
  _mtClear(false); _zoneClear(); _selfClear();
  _aimSrcId = srcId; _aimOpt = opt;
  _attackSrc = srcId;   // garde l'anneau d'attaque + court-circuite la redirection vers son propre token
  VS.tokens[srcId]?.shape?.findOne('.atk')?.visible(true);
  VS.layers.token?.batchDraw();
  _showAimRange(srcId, opt);
  _showAimHud(opt);
}

// Surligne uniquement les cases atteignables par CETTE action (sa portée propre).
function _showAimRange(srcId, opt) {
  _clearHL();
  const t = VS.tokens[srcId]?.data; if (!t || !VS.activePage || !VS.layers.grid) return;
  const K = window.Konva;
  const portee = Math.max(1, parseInt(opt.portee) || 1);
  const sd = _tokenDims(t);
  const { cols, rows } = VS.activePage;
  const reach = (dx, dy) => (portee === 1 ? Math.max(dx, dy) : dx + dy) <= portee;
  const friendly = opt.isHeal || opt.isEnchant || opt.isRegen;
  const c3 = friendly ? '34,197,94' : '239,68,68';
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    if (c >= t.col && c < t.col + sd.w && r >= t.row && r < t.row + sd.h) continue;
    const dx = Math.max(0, Math.max(c, t.col) - Math.min(c, t.col + sd.w - 1));
    const dy = Math.max(0, Math.max(r, t.row) - Math.min(r, t.row + sd.h - 1));
    if (!reach(dx, dy)) continue;
    const rect = new K.Rect({ x:c*CELL, y:r*CELL, width:CELL, height:CELL,
      fill:`rgba(${c3},0.16)`, stroke:`rgba(${c3},0.62)`, strokeWidth:1.4, listening:false });
    VS.layers.grid.add(rect); _moveHL.push(rect);
  }
  VS.layers.grid.batchDraw();
}

function _showAimHud(opt) {
  document.getElementById('vtt-aim-hud')?.remove();
  const portee = Math.max(1, parseInt(opt.portee) || 1);
  const hud = document.createElement('div');
  hud.id = 'vtt-aim-hud';
  hud.className = 'vtt-mt-hud';
  hud.innerHTML = `
    <div class="vtt-mt-hud-header">
      <span>${opt.icon || '🎯'} <strong>${_esc(opt.label)}</strong></span>
      <span class="vtt-mt-hud-count">🎯 ${portee}c</span>
    </div>
    <div class="vtt-mt-hud-hint">Clique une cible à portée · <kbd>Échap</kbd> = annuler</div>
    <div class="vtt-mt-hud-actions">
      <button class="vtt-mt-btn-cancel" data-vtt-fn="_aimCancel">✕ Annuler</button>
    </div>`;
  const onKey = e => { if (!_vttIsTypingTarget(e.target) && e.key === 'Escape') _aimCancel(); };
  document.addEventListener('keydown', onKey);
  hud._removeKey = () => document.removeEventListener('keydown', onKey);
  document.body.appendChild(hud);
}

function _isAimTargetInRange(srcId, tgtId, opt) {
  const s = VS.tokens[srcId]?.data, t = VS.tokens[tgtId]?.data;
  if (!s || !t) return false;
  const portee = opt.portee || 1;
  const dist = _tokenAttackDistance(s, t, portee);
  if (dist <= portee) return true;
  showNotif(`Hors de portée (${dist}c — portée ${portee}c)`, 'error');
  return false;
}

// Cible choisie → on injecte l'option dans le cache et on rejoint le flux de lancer existant
// (jet simple, ou ciblage zone/multi qui gèrent ensuite leur propre HUD).
function _resolveAim(srcId, tgtId, opt) {
  _atkOptsCache[`${srcId}__${tgtId}`] = [opt];
  _clearAim();
  _vttPickOpt(srcId, tgtId, 0);
}

function _clearAim() {
  if (!_aimOpt && !_aimSrcId) return;
  _aimOpt = null; _aimSrcId = null;
  const hud = document.getElementById('vtt-aim-hud');
  if (hud?._removeKey) hud._removeKey();
  hud?.remove();
  _clearHL();
}

function _aimCancel() {
  const sid = _aimSrcId;
  _clearAim();
  const d = VS.tokens[sid]?.data;   // restaure les portées de sélection normales
  if (d && _canControlToken(d)) { _showMoveRange(d); _showAttackRange(d); }
  showNotif('Visée annulée', 'info');
}

// ── Portée de mouvement ─────────────────────────────────────────────
function _showMoveRange(t) {
  _clearHL(); if (!VS.activePage) return;
  const K=window.Konva, ld=_live(t);
  const inCombat = !!VS.session?.combat?.active;
  const maxMvt = (ld.displayMovement??6) + (t.bonusMvt||0);
  const mv = (inCombat && !STATE.isAdmin) ? Math.max(0, maxMvt - (t.movedCells||0)) : (ld.displayMovement??6);
  const sw = ld.displayTokenW || 1, sh = ld.displayTokenH || 1;
  const {cols,rows}=VS.activePage;
  // Grandes créatures : le déplacement est basé sur TOUTE l'empreinte (hit-box),
  // pas un point unique. On calcule la RÉUNION des empreintes atteignables → une
  // région symétrique autour du corps (marche pour 2×2, 3×3, taille paire ou non).
  // Chaque case de la région pointe vers la meilleure destination : celle où cette
  // case est la plus « centrale » dans la nouvelle empreinte → cliquer y recentre
  // la créature. Le coût reste |dc|+|dr| (translation rigide de la hit-box).
  const cxG = (sw-1)/2, cyG = (sh-1)/2;   // centre géométrique (peut valoir .5)
  const cellMap = new Map();              // "c,r" → { aC, aR, score }
  for (let dc=-mv;dc<=mv;dc++) for (let dr=-mv;dr<=mv;dr++) {
    if (Math.abs(dc)+Math.abs(dr)>mv || (!dc&&!dr)) continue;
    const aC=t.col+dc, aR=t.row+dr;       // coin haut-gauche de destination
    if (aC<0||aR<0||aC+sw>cols||aR+sh>rows) continue;
    for (let fx=0;fx<sw;fx++) for (let fy=0;fy<sh;fy++) {
      const cc=aC+fx, cr=aR+fy;
      const score=Math.abs(cc-(aC+cxG))+Math.abs(cr-(aR+cyG));   // centralité dans l'empreinte
      const key=cc+','+cr, prev=cellMap.get(key);
      if (!prev || score<prev.score) cellMap.set(key,{aC,aR,score});
    }
  }
  // Pas de check collision : le drag & drop laisse passer, l'affichage doit faire pareil.
  for (const [key,dest] of cellMap) {
    const [cc,cr]=key.split(',').map(Number);
    const rect=new K.Rect({ x:cc*CELL,y:cr*CELL,width:CELL,height:CELL,
      fill:'rgba(79,140,255,0.28)', stroke:'rgba(79,140,255,0.70)', strokeWidth:1.5, listening:true });
    const tc=dest.aC, tr=dest.aR;
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
      if (VS.selected) await _moveTo(VS.selected, tc, tr);
    };
    rect.on('click', e => { if (e.evt.button!==0) return; moveSelectedHere(e); });
    rect.on('contextmenu', e => { e.evt.preventDefault(); moveSelectedHere(e); });
    VS.layers.grid.add(rect); _moveHL.push(rect);
  }
  VS.layers.grid.batchDraw();
}
export function _clearHL() { _moveHL.forEach(r=>r.destroy()); _moveHL=[]; VS.layers.grid?.batchDraw(); }

/**
 * Refresh immédiat des zones de déplacement + attaque du token sélectionné.
 * Appeler après chaque commit de mouvement pour garder l'interface active.
 * @param {string} id - token id
 * @param {object} [overrideData] - données à jour si l'objet Firestore n'est pas encore mis à jour
 */
function _refreshRanges(id, overrideData) {
  if (!id || id !== VS.selected) { _clearHL(); return; }
  const data = overrideData ?? VS.tokens[id]?.data;
  if (!data) { _clearHL(); return; }
  if (!_canControlToken(data)) { _clearHL(); return; }
  _showMoveRange(data);   // _clearHL() est appelé en tête de _showMoveRange
  _showAttackRange(data);
  _renderInspector(data); // actualise les compteurs (mouvement restant, etc.)
}

// ── Pings ────────────────────────────────────────────────────────────
async function _emitPing(wx, wy) {
  const uid = STATE.user?.uid; if (!uid || !VS.activePage) return;
  const authorName = STATE.profile?.pseudo || STATE.profile?.prenom || 'Joueur';
  const color = '#ffe600'; // jaune néon — visible sur toutes les cartes
  try {
    await setDoc(_pingRef(uid), {
      x: wx, y: wy, pageId: VS.activePage.id,
      authorName, color, createdAt: serverTimestamp(),
    }, { merge: true });
  } catch(e) { console.warn('[vtt] ping:', e); }
}

function _animatePing({ id, x, y, color }, pingKey) {
  if (!VS.layers.ping) return;
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
  VS.layers.ping.add(g);
  VS.layers.ping.batchDraw();

  const upd = () => VS.layers.ping?.batchDraw();
  // Flash s'efface rapidement
  new K.Tween({ node: flash, duration: 0.35, radius: 50, opacity: 0, easing: K.Easings.EaseOut, onUpdate: upd }).play();
  // Anneaux s'expandent en cascade
  new K.Tween({ node: ring1, duration: 1.2,           radius: 120, opacity: 0, easing: K.Easings.EaseOut, onUpdate: upd }).play();
  new K.Tween({ node: ring2, duration: 1.4, delay: 0.12, radius: 170, opacity: 0, easing: K.Easings.EaseOut, onUpdate: upd }).play();
  new K.Tween({ node: ring3, duration: 1.6, delay: 0.24, radius: 220, opacity: 0, easing: K.Easings.EaseOut, onUpdate: upd }).play();
  new K.Tween({ node: ring4, duration: 1.8, delay: 0.36, radius: 280, opacity: 0, easing: K.Easings.EaseOut, onUpdate: upd }).play();
  // Point disparaît en dernier
  new K.Tween({ node: dot, duration: 0.5, delay: 1.5, opacity: 0, easing: K.Easings.EaseIn,
    onFinish: () => { g.destroy(); VS.layers.ping?.batchDraw(); } }).play();

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
export function _showEmoteBubble(tokenId, emoteUrl, emoteName, key) {
  if (_renderedReactions.has(key)) return;
  _renderedReactions.add(key);
  // purge mémoire douce (évite la croissance infinie du Set sur longue session)
  if (_renderedReactions.size > 400) _renderedReactions.clear();

  const e = tokenId ? VS.tokens[tokenId] : null;
  if (e?.data && e.shape && e.data.pageId === VS.activePage?.id && VS.layers.ping && window.Konva) {
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
  VS.layers.ping.add(group);
  VS.layers.ping.batchDraw();

  const imgEl = new Image();
  imgEl.onload = () => {
    if (group.getStage() === null) return; // déjà détruit
    const side = R * 1.78;
    clip.add(new K.Image({ image: imgEl, width: side, height: side, x: -side / 2, y: -side / 2 }));
    VS.layers.ping.batchDraw();
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
            onFinish: () => { group.destroy(); VS.layers.ping?.batchDraw(); },
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
  for (const id of VS.selectedMulti) {
    if (id!==VS.selected) VS.tokens[id]?.shape?.findOne('.sel')?.visible(false);
  }
  VS.selectedMulti.clear();
  VS.layers.token?.batchDraw();
}

function _toggleMultiSelect(id) {
  // Inclure le token principal courant dans la multi-sélection
  if (VS.selected && !VS.selectedMulti.has(VS.selected)) {
    VS.selectedMulti.add(VS.selected);
    VS.tokens[VS.selected]?.shape?.findOne('.sel')?.visible(true);
  }
  if (VS.selectedMulti.has(id)) {
    VS.selectedMulti.delete(id);
    VS.tokens[id]?.shape?.findOne('.sel')?.visible(false);
  } else {
    VS.selectedMulti.add(id);
    VS.tokens[id]?.shape?.findOne('.sel')?.visible(true);
    VS.selected = id;
    _renderInspector(VS.tokens[id]?.data??null);
  }
  VS.layers.token?.batchDraw();
}

/** Surbrillance rouge des cases à portée d'attaque de t (sans clear — le caller nettoie). */
function _showAttackRange(t) {
  if (!VS.activePage) return;
  const K = window.Konva;
  const options = _buildAttackOptions(t)
    .map(o => ({ ...o, portee: Math.max(0, parseInt(o.portee) || 0) }))
    .filter(o => !o.targetSelf && o.portee > 0);
  if (!options.length) return;
  // Portée "naturelle" = celle de l'ARME du perso (option sans sortIdx et sans
  // _itemAction). C'est ce que le joueur considère comme sa portée de base, même
  // pour un grimoire portée 8. Fallback : plus courte portée si aucune arme
  // identifiable (tokens enemy/sentinelle).
  const weaponOpt = options.find(o => !o._itemAction && o.sortIdx === undefined && !o.targetSelf);
  const weaponPortee = weaponOpt ? weaponOpt.portee : Math.min(...options.map(o => o.portee));
  const { cols, rows } = VS.activePage;
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
    VS.layers.grid.add(rect); _moveHL.push(rect);
  }
  VS.layers.grid.batchDraw();
}
async function _moveTo(id, col, row) {
  const cur = VS.tokens[id]?.data;
  // Blocage par les murs (joueurs seulement)
  if (!STATE.isAdmin && (VS.activePage?.walls||[]).length) {
    if (cur && fogWallBlocksPath(cur.col, cur.row, col, row, VS.activePage.walls)) {
      showNotif('🧱 Chemin bloqué !', 'error');
      return;
    }
  }
  // Limite de mouvement en combat (joueurs seulement)
  if (!STATE.isAdmin && VS.session?.combat?.active && cur) {
    const d = Math.abs(col - cur.col) + Math.abs(row - cur.row);
    const maxMvt = (_live(cur).displayMovement ?? 6) + (cur.bonusMvt || 0);
    const rem = maxMvt - (cur.movedCells || 0);
    if (d > rem) {
      showNotif(rem <= 0 ? 'Plus de mouvement ce tour !' : `Trop loin ! (${rem} case${rem!==1?'s':''} restante${rem!==1?'s':''})`, 'error');
      return;
    }
  }
  const patch = {col, row};
  if (!STATE.isAdmin && VS.session?.combat?.active && cur) {
    const d = Math.abs(col - cur.col) + Math.abs(row - cur.row);
    patch.movedCells = (cur.movedCells || 0) + d;
    patch.movedThisTurn = true;
  }
  await updateDoc(_tokRef(id), patch).catch(() => showNotif('Déplacement refusé', 'error'));

  // Mise à jour optimiste : ne pas attendre le snapshot Firestore pour rafraîchir les zones
  const entry = VS.tokens[id];
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
// [_parseDice → vtt-spell-display.js (importé en haut)]

function _rollDice(formula) {
  const p = _parseDice(formula);
  if (!p) return Math.max(1, parseInt(formula)||1);
  let total = 0;
  for (let i=0; i<p.n; i++) total += Math.floor(Math.random()*p.sides)+1;
  return total + p.mod;
}
/** Variante détaillée : retourne aussi les rolls individuels et le mod.
 *  Utile pour afficher "1d4(3) +2 = 5" dans les logs. */
export function _rollDiceDetailed(formula) {
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

function _rollCritExtraDieDetailed(formula, { maximize = false } = {}) {
  const p = _parseDice(formula);
  if (!p || !p.sides) return { rolls: [], mod: 0, total: 0, n: 0, sides: 0, formula: '0' };
  const roll = maximize ? p.sides : Math.floor(Math.random() * p.sides) + 1;
  return { rolls: [roll], mod: 0, total: roll, n: 1, sides: p.sides, formula: `1d${p.sides}` };
}

function _diceLogFields(prefix, det) {
  if (!det || !Array.isArray(det.rolls) || !det.rolls.length) return {};
  return {
    [`${prefix}Rolls`]: det.rolls,
    [`${prefix}Sides`]: det.sides || 0,
    [`${prefix}Mod`]: det.mod || 0,
    [`${prefix}Count`]: det.n || det.rolls.length,
    [`${prefix}FormulaDetail`]: det.formula || '',
  };
}

// [_maxDice / _maxEffectDisplay / _effectDisplay → vtt-spell-display.js (importés en haut)]

function _optionFixedBonus(opt) {
  return (opt?.rawDice !== undefined)
    ? ((opt.dmgStatMod || 0) + (opt.maitriseBonus || 0))
    : 0;
}

// [_vttSortDmgFormula / _vttSortSoinFormula → vtt-spell-display.js (importés en haut)]

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
  const b = t?.beastId ? VS.bestiary[t.beastId] : null;
  const w = t?.tokenW ?? t?.tokenSize ?? b?.tokenW ?? b?.tokenSize ?? 1;
  const h = t?.tokenH ?? t?.tokenSize ?? b?.tokenH ?? b?.tokenSize ?? 1;
  return { w: Math.max(1, Math.min(5, w)), h: Math.max(1, Math.min(5, h)) };
}

// MJ uniquement : marge "backstage" hors de la grille de jeu. Le MJ peut y glisser
// des tokens pour les préparer / les cacher aux joueurs (un token hors grille n'est
// pas rendu côté joueur — cf. _tokenOffGrid + _applyTokenVisibility dans vtt-fog.js).
const OFF_GRID_BAND = 20;
// Clampe une case : joueurs = strictement dans la grille ; MJ = grille + marge backstage.
const _clampTokenCell = (raw, span, max) => {
  const band = STATE.isAdmin ? OFF_GRID_BAND : 0;
  return Math.max(-band, Math.min(max - span + band, raw));
};
// Vrai si le token (par sa taille) sort de la grille de jeu → caché aux joueurs.
const _tokenOffGrid = (d, pg = VS.activePage) => {
  if (!pg || !d) return false;
  const { w:sw, h:sh } = _tokenDims(d);
  return (d.col ?? 0) < 0 || (d.row ?? 0) < 0
      || (d.col ?? 0) + sw > pg.cols || (d.row ?? 0) + sh > pg.rows;
};

// Cherche un token possédé par le joueur courant couvrant la position du pointeur.
// Sert à débloquer la sélection quand le token du joueur est masqué sous un autre.
function _findOwnTokenAtPointer() {
  const uid = STATE.user?.uid; if (!uid || !VS.stage) return null;
  const pos = VS.stage.getPointerPosition(); if (!pos) return null;
  const w = _stageToWorld(pos);
  const cx = Math.floor(w.x / CELL), cy = Math.floor(w.y / CELL);
  for (const [id, entry] of Object.entries(VS.tokens)) {
    const d = entry?.data; if (!d || d.ownerId !== uid) continue;
    const dim = _tokenDims(d);
    if (cx >= d.col && cx < d.col + dim.w && cy >= d.row && cy < d.row + dim.h) return id;
  }
  return null;
}

function _vttCenterOnMyToken() {
  const uid = STATE.user?.uid;
  if (!uid || !VS.stage || !VS.activePage) return;

  const owned = Object.entries(VS.tokens)
    .filter(([, entry]) => {
      const t = entry?.data;
      return t?.ownerId === uid
        && t.pageId === VS.activePage.id
        && t.visible !== false;
    });

  const selectedEntry = VS.tokens[VS.selected];
  const selectedData = selectedEntry?.data;
  const selected = selectedData
    && selectedData.pageId === VS.activePage.id
    && selectedData.visible !== false
    && (selectedData.ownerId === uid || STATE.isAdmin)
      ? [VS.selected, selectedEntry]
      : null;

  if (!owned.length && !selected) {
    showNotif(
      STATE.isAdmin
        ? 'Sélectionne un token ou place ton personnage sur cette carte.'
        : 'Ton personnage n’est pas présent sur cette carte.',
      'info',
    );
    return;
  }

  const defaultChar = owned.find(([, entry]) =>
    entry.data?.characterId && VS.characters[entry.data.characterId]?.isDefault);
  const [, entry] = selected || defaultChar || owned[0];
  const t = entry.data;
  const dims = _tokenDims(t);
  const scale = VS.stage.scaleX();
  const worldX = (t.col + dims.w / 2) * CELL;
  const worldY = (t.row + dims.h / 2) * CELL;

  VS.stage.to({
    x: VS.stage.width() / 2 - worldX * scale,
    y: VS.stage.height() / 2 - worldY * scale,
    duration: 0.2,
  });
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

// [VTT_ACTION_RUNE / _vttAmpDispCircleSize / _vttSpellActionMode / _vttDisplayRunes
//  → vtt-spell-display.js (importés en haut)]

/**
 * Détecte les modificateurs spéciaux d'un sort (combos, lacération, chance, déplacement…).
 * Miroir local des helpers de spells.js — évite cross-import features/characters.
 * Renvoie null si aucun mod actif, sinon un objet avec les flags pertinents.
 */
function _vttSpellMods(s) {
  if (!s) return null;
  if (s.designMode === 'classic') {
    if (s.classicEffect === 'summon') {
      const inv = (s.invocation && typeof s.invocation === 'object') ? s.invocation : {};
      const maxInvocations = Math.max(1, parseInt(inv.max ?? s.classicInvocationCount) || 1);
      const defaultIds = Array.isArray(inv.ids) ? inv.ids.filter(Boolean).slice(0, maxInvocations) : [];
      const legacyStats = inv.stats || {};
      const legacy = {
        attaque: legacyStats.attaque || '1d4 +2',
        toucher: Number.isFinite(parseInt(legacyStats.toucher)) ? parseInt(legacyStats.toucher) : 2,
        pv: Number.isFinite(parseInt(legacyStats.pv)) ? parseInt(legacyStats.pv) : 10,
        ca: Number.isFinite(parseInt(legacyStats.ca)) ? parseInt(legacyStats.ca) : 10,
        deplacement: Number.isFinite(parseInt(legacyStats.deplacement)) ? parseInt(legacyStats.deplacement) : 3,
        image: inv.image || null,
        actions: Array.isArray(inv.actions) ? inv.actions : [],
        name: s.nom || 'Invocation',
      };
      return {
        concentration: null,
        invocation: {
          maxInvocations,
          defaultIds,
          elementId: s.noyauTypeId || null,
          legacy,
          bonuses: { nbP: 0, nbCh: 0, nbProt: 0, nbAmp: 0 },
          concentration: false,
          duree: Math.max(1, parseInt(s.classicDuration ?? s.dureeBase) || 2),
          nbInvocations: defaultIds.length || maxInvocations,
        },
      };
    }
    const stateId = s.classicStateId || s.enchantEtatId || s.afflictionEtatId || null;
    if (!stateId) return null;
    const friendly = s.classicTarget === 'ally' || s.classicTarget === 'self';
    return {
      concentration: null,
      enchantEtatId: friendly ? stateId : null,
      enchantEtatIds: friendly ? [stateId] : [],
      enchantStatePower: 0,
      enchantStateAmplification: 0,
      enchantStateChance: 0,
      affliction: friendly ? null : {
        slot: 'torse',
        mode: 'etat',
        effect: s.effet || '',
        element: s.noyauTypeId || null,
        dd: Math.max(1, parseInt(s.classicStateDC) || 11),
        nbAff: 1,
        nbP: 0,
        dotFormula: '',
        etatId: stateId,
        saveStat: s.classicStateSaveStat || s.afflictionSaveStat || 'sagesse',
      },
    };
  }
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
  const isZoneElargie = nbAmp > 0 && nbDisp > 0;
  const isArmeInvoquee = nbEnch > 0 && nbInv > 0;
  const isRegeneration = nbProt > 0 && nbAff > 0 && nbInv === 0 && !isLacMode;
  const isCoupChance = nbCh > 0 && nbReac > 0;
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
    // Chance : étend la plage critique (RC = 20 - nb runes Chance), sans plafond.
    // Plancher à 2 pour garder le 1 naturel en échec critique.
    chance: nbCh > 0 && !isCoupChance
      ? { rc: Math.max(2, 20 - nbCh) } : null,
    // Concentration : chaque rune supplémentaire facilite le JS de maintien.
    concentration: nbConc > 0
      ? { dd: Math.max(5, 11 - 2 * (nbConc - 1)), runes: nbConc } : null,
    // Déplacement (rune Amplification en mode déplacement) : soi / pousse / attire.
    // Portée = 3N cases. Sous-mode dans s.deplacement.mode.
    // Avec Enchantement, l'Amplification BOOSTE l'effet (pas de déplacement) → désactivé.
    deplacement: (!isZoneElargie && nbEnch === 0 && s.ampMode === 'deplacement' && nbAmp > 0)
      ? { mode: s.deplacement?.mode || 'self', cells: Math.max(1, 3 * nbAmp) }
      : null,
    // Enchantement mode Dégâts : bonus dégâts sur les attaques d'arme de l'allié
    // Formule auto : (1+Puiss)d4 +2 — appliquée pendant la durée du sort
    // ⚠️ Absorbé par le combo Arme invoquée (Ench + Inv) → on ne le déclenche pas alors
    enchantArmeDmg: (nbEnch > 0 && nbInv === 0
                     && (s.enchantMode || 'dmg') === 'dmg'
                     && (s.enchantSlot || 'arme') === 'arme')
      ? {
          formula: (s.enchantDegats || '').trim() || `${1 + nbP}d4 +2`,
          element: s.noyauTypeId || null,
          nbCibles: _vttSortCibles(s),
        } : null,
    // Enchantement mode État : applique l'état choisi directement à l'allié
    enchantEtatId: (nbEnch > 0 && nbInv === 0 && s.enchantMode === 'etat')
      ? (s.enchantEtatId || null) : null,
    // Multi-états : 1 par rune Enchantement (le 1er garde ses réglages fins, les
    // suivants sont auto-modulés par Puissance/Amplification). Limité à nbEnch.
    enchantEtatIds: (nbEnch > 0 && nbInv === 0 && s.enchantMode === 'etat')
      ? ((Array.isArray(s.enchantEtatIds) && s.enchantEtatIds.length
          ? s.enchantEtatIds : [s.enchantEtatId]).filter(Boolean).slice(0, nbEnch))
      : [],
    enchantStatePower: (nbEnch > 0 && nbInv === 0 && s.enchantMode === 'etat')
      ? nbP : 0,
    enchantStateAmplification: (nbEnch > 0 && nbInv === 0 && s.enchantMode === 'etat')
      ? nbAmp : 0,
    // Runes Chance : pilotent la réduction de RC de l'état « Chanceux ».
    enchantStateChance: (nbEnch > 0 && nbInv === 0 && s.enchantMode === 'etat')
      ? nbCh : 0,
    enchantStateMoveBonus: (nbEnch > 0 && nbInv === 0 && s.enchantMode === 'etat' && Number.isFinite(parseInt(s.enchantStateMoveBonus)))
      ? parseInt(s.enchantStateMoveBonus) : null,
    enchantStateDmgFormula: (nbEnch > 0 && nbInv === 0 && s.enchantMode === 'etat')
      ? ((s.enchantStateDmgFormula || '').trim()) : '',
    // Enchantement mode Toucher : bonus au toucher de l'allié (auto = 2 + Puissance)
    enchantToucher: (nbEnch > 0 && nbInv === 0 && s.enchantMode === 'toucher')
      ? { bonus: _enchBonus, nbCibles: _vttSortCibles(s) } : null,
    // Enchantement mode Déplacement : cases de mouvement en plus (auto = 2 + Puissance)
    enchantMove: (nbEnch > 0 && nbInv === 0 && s.enchantMode === 'deplacement')
      ? { bonusCells: _enchBonus, nbCibles: _vttSortCibles(s) } : null,
    // Enchantement slot=pieds : bonus mouvement (cases supplémentaires)
    // Auto : +2 cases / rune Puissance, ou +1 par défaut
    enchantPieds: (nbEnch > 0 && nbInv === 0 && s.enchantSlot === 'pieds')
      ? { bonusCells: Math.max(1, nbP * 2 || 1), nbCibles: _vttSortCibles(s) } : null,
    // Enchantement slot=tete / torse : effet libre (matrice), buff générique
    enchantGeneric: (nbEnch > 0 && nbInv === 0 && (s.enchantSlot === 'tete' || s.enchantSlot === 'torse'))
      ? { slot: s.enchantSlot, effect: s.enchantEffect || '', nbCibles: _vttSortCibles(s) } : null,
    // Affliction : JS Sa DD scalable selon nb runes Affliction.
    // Base 11, +2 par rune supplémentaire.
    // Slot détermine la nature : torse=DoT · pieds=mouvement · tete=sensoriel · arme=combat
    // ⚠️ Absorbé par le combo Sentinelle (Aff + Inv) → l'affliction est portée par la sentinelle
    // ⚠️ Absorbé par le combo Régénération (Prot + Aff) → l'affliction devient un HoT allié
    affliction: (nbAff > 0 && nbInv === 0 && !isRegeneration && !isLacMode)
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
    regeneration: isRegeneration
      ? {
          formula: (s.regenerationFormula || '').trim() || `${nbProt + nbAff}d4`,
          nbProt,
          nbAff,
        } : null,
    // Sort suspendu : Concentration + Réaction. Stocke un sort onHit INSTANTANÉ
    // pour déclenchement hors-tour ; la rune Durée prolonge le stockage (+2 tours
    // chacune). Restreint aux sorts sans effet sur la durée (pas d'Affliction/DoT,
    // Régénération, Enchantement, Invocation/Sentinelle ni Lacération).
    sortSuspendu: (nbConc > 0 && nbReac > 0
        && nbAff === 0 && nbEnch === 0 && nbInv === 0 && lacCount === 0)
      ? { graceTurns: 2 + 2 * nbDur } : null,
    // Coup de chance : Chance + Réaction. Les runes sont absorbées en 1 relance auto.
    coupChance: isCoupChance
      ? { charges: 1 } : null,
    // Bouclier réactif : Réaction + Protection (CA) → annule 1 attaque (sans bonus CA)
    bouclierReactif: (nbReac > 0 && nbProt > 0 && protMode === 'ca')
      ? { nbProt, tier: nbProt >= 3 ? 'boss' : nbProt === 2 ? 'elite' : 'mob' } : null,
    // Arme invoquée : Ench + Invocation → token allié temporaire (2 tours)
    armeInvoquee: isArmeInvoquee
      ? { elementId: s.noyauTypeId || null, nbPuissance: nbP } : null,
    // Sentinelle : Affliction + Invocation → token stationnaire (stats propres, 2 tours)
    // Le nombre de sentinelles est piloté par la rune Invocation (1 par rune).
    sentinelle: (nbAff > 0 && nbInv > 0)
      ? {
          slot: s.afflictionSlot || 'arme',
          elementId: s.noyauTypeId || null,
          effect: s.afflictionEffect || '',
          dmgDice: sentinelDmg,
          hp: sentinelHp, ca: sentinelCa,
          rangeCells: Math.max(1, Math.ceil(sentinelRangeM / CELL_M)),
          rangeMeters: sentinelRangeM,
          nbInvocations: nbInv,
          nbP, nbProt, nbAmp,
        } : null,
    // Canalisé persistant : Durée + Concentration (SANS Réaction → sinon c'est un
    // Sort suspendu) → durée liée à la concentration.
    canalisePersistant: (nbDur > 0 && nbConc > 0 && nbReac === 0)
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
            ca:          has(ov.ca)          ? parseInt(ov.ca)          : (10 + 2 * nbProt),
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
  if (src.beastId) return String(VS.bestiary[src.beastId]?.rang || 'classique').toLowerCase();
  if (src.npcId)   return String(VS.npcs[src.npcId]?.rang || 'classique').toLowerCase();
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
    const collide = Object.values(VS.tokens).some(e => {
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
  const c = _characterForToken(src);
  if (opt.pmCost > 0 && c?.id) {
    await updateDoc(_chrRef(c.id), {
      ..._charPmPatch(Math.max(0, _charPmCur(c) - opt.pmCost)),
      vttControlTokenId: src.id,
    });
  }
}

function _vttCooldownRemaining(token, opt) {
  if (!VS.session?.combat?.active || !opt?.cooldownTurns || !opt?.cooldownKey) return 0;
  const round = Math.max(0, parseInt(VS.session?.combat?.round) || 0);
  const readyRound = parseInt(token?.spellCooldowns?.[opt.cooldownKey]) || 0;
  return Math.max(0, readyRound - round);
}

function _withSpellCooldown(token, opt) {
  if (opt) opt.cooldownRemaining = _vttCooldownRemaining(token, opt);
  return opt;
}

function _vttCooldownPatch(token, opt) {
  if (!VS.session?.combat?.active || !opt?.cooldownTurns || !opt?.cooldownKey) return null;
  const round = Math.max(0, parseInt(VS.session?.combat?.round) || 0);
  return {
    ...(token?.spellCooldowns || {}),
    [opt.cooldownKey]: round + Math.max(1, parseInt(opt.cooldownTurns) || 1),
  };
}

async function _vttStartSpellCooldown(token, opt) {
  const spellCooldowns = _vttCooldownPatch(token, opt);
  if (!spellCooldowns || !token?.id) return;
  token.spellCooldowns = spellCooldowns;
  await updateDoc(_tokRef(token.id), { spellCooldowns }).catch(() => {});
}

// Vrai si la case (col,row) pour un token de dimensions dim recouvre un autre token.
function _selfCellOccupied(col, row, dim, src) {
  return Object.values(VS.tokens).some(e => {
    const dd = e?.data;
    if (!dd || dd.id === src.id || dd.pageId !== src.pageId) return false;
    const od = _tokenDims(dd);
    return col < dd.col + od.w && col + dim.w > dd.col && row < dd.row + od.h && row + dim.h > dd.row;
  });
}

// Push/Pull : déplace la cible cliquée le long de l'axe lanceur↔cible (sans dégât).
async function _vttCastPushPull(srcId, tgtId, opt, d) {
  const src = VS.tokens[srcId]?.data, tgt = VS.tokens[tgtId]?.data;
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
  VS.layers.grid?.batchDraw();
}

function _startSelfMove(srcId, opt, cells) {
  _zoneClear(); _selfClear();
  _clearHL(); // retire les cases de déplacement classique pour éviter la confusion
  const src = VS.tokens[srcId]?.data; if (!src || !VS.layers.grid || !VS.activePage) return;
  const mv  = Math.max(1, cells || 1);
  _selfCtx = { srcId, cells: mv, opt };
  const K = window.Konva;
  const dim = _tokenDims(src);
  const { cols, rows } = VS.activePage;
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
    VS.layers.grid.add(rect);
    _selfCells.push(rect);
  }
  VS.layers.grid.batchDraw();
  _showSelfHud();
  showNotif(`Clic sur une case (≤ ${mv} case${mv > 1 ? 's' : ''})`, 'info');
}

async function _selfMoveTo(col, row) {
  if (!_selfCtx) return;
  const { srcId, opt } = _selfCtx;
  const src = VS.tokens[srcId]?.data; if (!src) { _selfClear(); return; }
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
  const onKey = e => { if (!_vttIsTypingTarget(e.target) && e.key === 'Escape') _selfMoveCancel(); };
  document.addEventListener('keydown', onKey);
  hud._removeKey = () => document.removeEventListener('keydown', onKey);
  document.body.appendChild(hud);
}

// ── Sélecteur d'invocations AU LANCEMENT (versatilité : on choisit dans le VTT) ──
let _invPickState = null;  // { srcId, tgtId, opt, optIdx, lib, max, ids:Set }
function _vttPickInvocations(srcId, tgtId, opt, optIdx) {
  const src = VS.tokens[srcId]?.data;
  const c = src?.characterId ? VS.characters[src.characterId] : null;
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
export async function _persistInvocationState(tokData) {
  try {
    const t = (tokData?.id && VS.tokens[tokData.id]?.data) ? VS.tokens[tokData.id].data : tokData;
    if (!t || t.summonKind !== 'invocation' || !t.summonInvId) return;
    const charId = t.summonOwnerCharId; if (!charId) return;
    const c = VS.characters[charId]; if (!c || !Array.isArray(c.invocations)) return;
    const inv = c.invocations.find(iv => iv.id === t.summonInvId); if (!inv) return;
    inv.currentHp = Math.max(0, parseInt(t.hp ?? inv.currentHp ?? inv.stats?.pv) || 0);
    inv.currentPm = Math.max(0, parseInt(t.pm ?? inv.currentPm ?? inv.stats?.pmMax) || 0);
    await updateDoc(_chrRef(charId), { invocations: c.invocations });
  } catch (_) { /* non bloquant */ }
}

// Personnage crédité par les statistiques pour un token donné : le perso lié, ou
// — pour une INVOCATION (characterId null) — le personnage du LANCEUR
// (summonOwnerCharId). Ainsi les dégâts/soins/actions d'une invocation comptent
// pour son propriétaire. Le nom est résolu sur le perso propriétaire (pas le nom
// « 🐾 … de X » de l'invocation).
function _statsActor(t) {
  if (t?.characterId) return { id: t.characterId, name: t.name || '' };
  if (t?.summonOwnerCharId) {
    const oc = VS.characters[t.summonOwnerCharId];
    return { id: t.summonOwnerCharId, name: oc?.nom || t.name || '' };
  }
  return { id: null, name: t?.name || '' };
}

function _hasStatsDelta(delta) {
  return !!(delta?.chars && Object.keys(delta.chars).length);
}

function _castStatKinds(opt = {}) {
  const mods = opt.mods || {};
  const support = !!(
    opt.isCaSort
    || opt.isRegen
    || opt.isEnchant
    || mods.enchant
    || mods.regeneration
    || mods.enchantArmeDmg
    || mods.enchantPieds
    || mods.enchantGeneric
    || mods.enchantEtatId
    || mods.enchantToucher
    || mods.enchantMove
    || opt.enchantMode === 'etat'
    || opt.enchantEtatId
    || mods.rangeBuff
    || mods.hot
    || opt.category === 'support'
  );
  const affliction = !!(
    opt.isAffliction
    || mods.affliction
    || mods.laceration
    || opt.afflictionMode
    || opt.afflictionEtatId
  );
  const tactical = support || affliction || !!(
    opt.isInvocation
    || mods.invocation
    || mods.sentinelle
    || mods.move
    || mods.push
    || mods.pull
    || mods.zone
    || opt.zoneW > 0
    || opt.zoneH > 0
  );
  return { tactical, support, affliction };
}

function _buildCastStatsDelta(src, opt) {
  const actor = _statsActor(src);
  const delta = { chars: {} };
  const isSpellLike = opt?.sortIdx !== undefined || !!opt?.spellId || !!opt?.isUtil || !!opt?.isCaSort || !!opt?.isHeal || !!opt?.isInvocation;
  if (!actor.id || (!isSpellLike && !(opt?.pmCost > 0))) return delta;
  const kinds = _castStatKinds(opt);
  accCastDelta(delta, {
    casterId: actor.id,
    casterName: actor.name,
    spellName: isSpellLike ? (opt.label || 'Sort') : null,
    pm: opt.pmCost || 0,
    tactical: kinds.tactical ? 1 : 0,
    support: kinds.support ? 1 : 0,
    affliction: kinds.affliction ? 1 : 0,
  });
  return delta;
}

function _applyCastStatsDelta(src, opt) {
  const delta = _buildCastStatsDelta(src, opt);
  if (_hasStatsDelta(delta)) applyStatsDelta(delta, +1);
  return delta;
}

/**
 * Crée un token "convoqué" (sentinelle, arme invoquée, etc.) sur la page active.
 * - kind: 'sentinelle' | 'arme_invoquee'
 * - center: { col, row } position désirée (sera ajustée si occupée pour arme invoquée)
 * - Le token : 10 PV / CA 10 par défaut, owner = lanceur, durée 2 tours (expiresAtRound)
 * - Persisté en Firestore via _toksCol, visible par tous, contrôlable par l'owner
 */
async function _vttSpawnSummon({ kind, srcId, col, row, opt, durationTurns = 2 }) {
  if (!VS.activePage) return null;
  const src = VS.tokens[srcId]?.data; if (!src) return null;
  const round = VS.session?.combat?.round ?? 0;
  const baseRound = Math.max(1, round);
  const ownerName = _live(src).displayName ?? src.name;

  // Snap dans les bornes de la page (commun à tous les kinds)
  const targetCol = Math.max(0, Math.min(VS.activePage.cols - 1, col));
  const targetRow = Math.max(0, Math.min(VS.activePage.rows - 1, row));

  // ── Invocation : résout la N-ième invocation choisie sur la bibliothèque du
  //    lanceur, applique base + bonus de runes, et RESTAURE les PV/PM persistants. ──
  if (kind === 'invocation') {
    const ownerCharId = src.characterId || src.summonOwnerCharId || null;
    const mod = opt?.mods?.invocation || {};
    const idx = _zoneCtx?.invocationsDone || 0;   // quelle invocation on pose (0-based)
    const selIds = opt._invSelIds || null;        // créatures choisies au lancement
    let name = 'Invocation', image = null, actions = [], summonInvId = null;
    let attaque = '1d4', toucher = 0, pvMax = 10, ca = 10, deplacement = 0, pmMax = 0;
    let baseAttackUnscaled = '1d4';   // attaque de base NON scalée → sert aux ACTIONS (runes du sort n'y touchent pas)
    let restoreHp = null, restorePm = null;

    if (selIds && selIds.length) {
      const c = ownerCharId ? VS.characters[ownerCharId] : null;
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
      ca          = (parseInt(base.ca) || 10) + 2 * (b.nbProt || 0);   // Protection → +2 CA / rune
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
      ownerId: ownerCharId ? (VS.characters[ownerCharId]?.uid || STATE.user?.uid || null) : null,
      summonOwnerId: srcId,
      summonOwnerCharId: ownerCharId,
      summonKind: 'invocation',
      summonInvId,
      summonSortLabel: opt?.label || '',
      summonExpiresAtRound: mod.concentration ? baseRound + 10 - 1 : baseRound + durationTurns - 1,
      summonCanalise: !!mod.concentration,
      summonCanalisePersistant: !!opt?.mods?.canalisePersistant,
      summonConcentrationDD: opt?.mods?.concentration?.dd || null,
      summonChanceRc: opt?.mods?.chance?.rc ?? 20,
      summonActions: actions,
      summonElementId: mod.elementId || null,   // attaque de base = élément du sort d'invocation
      pageId: VS.activePage.id,
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
    try {
      await setDoc(ref, tokenData);
    } catch (e) {
      console.error('[vtt] création invocation refusée', e);
      showNotif("Invocation impossible — mets à jour les règles Firestore (création de token par un joueur).", 'error');
      return null;
    }
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
    const c = VS.characters[src.characterId];
    if (c) {
      const mainP   = getMainWeapon(c);
      const statKey = mainP?.toucherStat || mainP?.statAttaque || 'force';
      attackBonus = (getMod(c, statKey) || 0) + 5;
    }
  } else if (src.npcId) {
    attackBonus = (_npcStatMod(VS.npcs[src.npcId] || {}, 'force') || 0) + 5;
  }

  // Seuil critique hérité du sort (combo Chance)
  const chanceRc = opt?.mods?.chance?.rc ?? 20;

  const tokenData = {
    name: baseName,
    type: 'npc',                       // allié contrôlable
    characterId: null, npcId: null, beastId: null,
    ownerId: src.characterId ? (VS.characters[src.characterId]?.uid || STATE.user?.uid || null) : null,
    summonOwnerId: srcId,              // lien vers le lanceur (contrôle + cleanup)
    summonKind: kind,
    summonSortLabel: opt?.label || '',
    summonExpiresAtRound: opt?.mods?.concentration ? baseRound + 10 - 1 : baseRound + durationTurns - 1,
    summonCanalise: !!opt?.mods?.concentration,
    summonCanalisePersistant: !!opt?.mods?.canalisePersistant,
    summonConcentrationDD: opt?.mods?.canalisePersistant?.dd || opt?.mods?.concentration?.dd || null,
    // Stats héritées du sort qui l'a invoquée — utilisées par _buildAttackOptions
    summonChanceRc: chanceRc,
    // Élément : priorité au noyau du sort (st.elementId), sinon damageTypeId de l'option offensive, sinon null
    summonElementId: st.elementId || opt?.damageTypeId || null,
    summonNbPuissance: st.nbP || 0,
    summonNbProtection: st.nbProt || 0,
    summonNbAmplification: st.nbAmp || 0,
    pageId: VS.activePage.id,
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
  await setDoc(ref, tokenData).catch(e => { console.error('[vtt] invocation', e); showNotif("Échec de l'invocation (réseau / permissions)", 'error'); });
  return { id: ref.id, ...tokenData };
}

/**
 * Helper commun : champs de buff partagés (durée, canalisation, source).
 * Évite la duplication entre les différents types d'enchantements/afflictions.
 */
export function _buffShared(opt, srcId) {
  const round = VS.session?.combat?.round ?? 0;
  const baseRound = Math.max(1, round);
  const isCanalise = !!opt.mods?.canalisePersistant;
  const dur = isCanalise ? null : (opt.mods?.concentration ? 10 : (opt.sortDuree ?? 2));
  // Firestore rejette `undefined` — on omet les champs au lieu de les mettre à undefined
  return {
    startRound: round,
    totalDuration: isCanalise ? null : dur,
    expiresAtRound: isCanalise ? null : (dur != null ? baseRound + dur - 1 : null),
    casterId: srcId || null,
    sortLabel: opt.label || '',
    ...(isCanalise ? { canalisePersistant: true } : {}),
  };
}

function _vttConcentrationDurationFields(opt) {
  const round = VS.session?.combat?.round ?? 0;
  const baseRound = Math.max(1, round);
  const dur = 10;
  return {
    expiresAtRound: dur != null && dur > 0 ? baseRound + dur - 1 : null,
    ...(round === 0 && dur != null && dur > 0 ? { pendingDuration: dur } : {}),
  };
}

async function _vttApplyCasterConcentration(srcId, opt) {
  if (!srcId || !opt?.mods?.concentration) return;
  const src = VS.tokens[srcId]?.data;
  if (!src) return;
  const label = opt.label || 'Sort concentré';
  const dd = opt.mods.concentration.dd ?? 11;
  const existing = (src.conditions || []).filter(c =>
    !(c.id === 'focused' && c.concentrationSpell && (c.source || '') === label)
  );
  const cond = {
    id: 'focused',
    appliedAt: Date.now(),
    appliedBy: srcId,
    source: label,
    sortLabel: label,
    saveDC: dd,
    saveStat: 'sagesse',
    concentrationSpell: true,
    ..._vttConcentrationDurationFields(opt),
  };
  await updateDoc(_tokRef(srcId), { conditions: [...existing, cond] }).catch(() => {});
}

export async function _vttBreakConcentrationEffects(casterId, cond) {
  const label = cond?.sortLabel || cond?.source || '';
  if (!casterId || !label) return;
  const round = VS.session?.combat?.round ?? 0;
  const baseRound = Math.max(1, round);
  const graceExpiresAtRound = baseRound + 2 - 1;

  for (const entry of Object.values(VS.tokens || {})) {
    const tok = entry?.data;
    if (!tok?.id) continue;
    const updates = {};

    if (tok.summonOwnerId === casterId && tok.summonCanalise && (tok.summonSortLabel || '') === label) {
      if (tok.summonCanalisePersistant) {
        updates.summonCanalise = false;
        updates.summonExpiresAtRound = graceExpiresAtRound;
      } else {
        await _persistInvocationState(tok);
        await deleteDoc(_tokRef(tok.id)).catch(() => {});
        continue;
      }
    }

    if (Array.isArray(tok.buffs) && tok.buffs.length) {
      let changed = false;
      const nextBuffs = [];
      for (const buff of tok.buffs) {
        const linked = buff?.casterId === casterId && (buff.sortLabel || '') === label;
        if (!linked) {
          nextBuffs.push(buff);
          continue;
        }
        changed = true;
        if (buff.canalisePersistant) {
          const { canalisePersistant, concentrationDD, ...rest } = buff;
          nextBuffs.push({
            ...rest,
            totalDuration: 2,
            startRound: baseRound,
            expiresAtRound: graceExpiresAtRound,
            concentrationGrace: true,
          });
        }
      }
      if (changed) updates.buffs = nextBuffs;
    }

    if (Array.isArray(tok.conditions) && tok.conditions.length) {
      const nextConditions = tok.conditions.filter(c =>
        !(c?.appliedBy === casterId && (c.source || '') === label && c.id !== 'focused')
      );
      if (nextConditions.length !== tok.conditions.length) updates.conditions = nextConditions;
    }

    if (Object.keys(updates).length) {
      await updateDoc(_tokRef(tok.id), updates).catch(() => {});
    }
  }
}

export async function _consumeLuckyReroll(tokenId, tokenData, currentD20, shouldUse = true) {
  if (!tokenId || !tokenData || !shouldUse) return null;
  const round = VS.session?.combat?.round ?? 0;
  const lucky = (tokenData.buffs || []).find(b =>
    b?.type === 'lucky_reroll' && (b.charges || 0) > 0
    && (b.expiresAtRound == null || round === 0 || round <= b.expiresAtRound)
  );
  if (!lucky) return null;

  const reroll = Math.floor(Math.random() * 20) + 1;
  const finalD20 = Math.max(currentD20, reroll);
  const remaining = (lucky.charges || 0) - 1;
  const newBuffs = remaining > 0
    ? (tokenData.buffs || []).map(b => b === lucky ? { ...b, charges: remaining } : b)
    : (tokenData.buffs || []).filter(b => b !== lucky);
  await updateDoc(_tokRef(tokenId), { buffs: newBuffs }).catch(() => {});
  return { d20: finalD20, reroll, label: lucky.sortLabel || 'Coup de chance' };
}

// [_vttApplyEnchantBuffs → vtt-spell-effects.js]

export const _STAT_SHORT = { force:'For', dexterite:'Dex', constitution:'Con', sagesse:'Sag', intelligence:'Int', charisme:'Cha' };

// [_vttApplyAfflictions / _vttApplyRegeneration → vtt-spell-effects.js]

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
    id, sortIdx, spellId = null, label,
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
  const runes = Array.isArray(s.runes) ? s.runes : [];
  const types = Array.isArray(s.types) && s.types.length ? s.types
              : (s.typeSoin ? ['defensif'] : (s.noyau ? ['offensif'] : ['utilitaire']));
  const protMode = s.protectionMode || 'ca';
  // En mode Déplacement, l'Amplification produit un déplacement, pas une zone.
  const _isDepl = s.ampMode === 'deplacement';
  // Avec Enchantement, l'Amplification BOOSTE l'effet (portée/déplacement de l'état) :
  // elle ne crée ni zone ni déplacement.
  const _enchActive = runes.filter(r => r === 'Enchantement').length > 0
                   && runes.filter(r => r === 'Invocation').length === 0;
  let zoneW = (_isDepl || _enchActive) ? 0 : (s.zoneW || 0);
  let zoneH = (_isDepl || _enchActive) ? 0 : (s.zoneH || 0);
  let zoneShape = ['cross', 'diamond'].includes(s.zoneShape) ? s.zoneShape : 'rect';
  // Miroir EXACT de _calcSortZone (spells-calc) : Amp seul → ligne 3N×1 ;
  // combo Amp+Disp → Amplification = HAUTEUR, Dispersion = LARGEUR (4N−1 par axe),
  // forme rectangle/carré ou croix selon s.zoneShape. 1 case par unité (pas de conversion mètres).
  if (!_isDepl && !_enchActive && zoneW <= 0 && zoneH <= 0) {
    const _runes = s.runes || [];
    const _nbAmp  = _runes.filter(r => r === 'Amplification').length;
    const _nbDisp = _runes.filter(r => r === 'Dispersion').length;
    if (_nbAmp >= 1) {
      if (_nbDisp >= 1) {
        zoneShape = s.zoneShape === 'cross' ? 'cross' : 'rect';
        const _m = zoneShape === 'cross' ? 6 : 4;   // croix : bras plus longs (6N−1)
        zoneH = _m * _nbAmp - 1;    // Amplification → hauteur
        zoneW = _m * _nbDisp - 1;   // Dispersion → largeur
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
    id, sortIdx, spellId, portee,
    pmCost, basePm, pmRaw, pmSetDelta,
    nbCibles, zoneW, zoneH, zoneShape, mods, actionType,
    sortDuree: _sortDureeVtt(s),
    classicDuration: s.designMode === 'classic' ? _sortDureeVtt(s) : null,
    cooldownTurns: Math.max(0, parseInt(s.cooldownTurns) || 0),
    cooldownKey: spellId || id || null,
    friendlyOnly: s.designMode === 'classic' && s.classicTarget === 'ally',
    hostileOnly: s.designMode === 'classic' && s.classicTarget === 'enemy',
    targetSelf: !!s.targetSelf || (s.designMode === 'classic' && s.classicTarget === 'self'),
    actionDescription: s.designMode === 'classic' ? (s.effet || '') : '',
    mjAlwaysMax: !!s.mjAlwaysMax, autoHit: !!s.mjAutoHit,
    ...extras,
  };

  // Combo Coup de chance : effet unique, les effets normaux de Chance/Réaction
  // sont absorbés en une relance automatique.
  if (mods?.coupChance) {
    return { ...common, label,
      icon: '🍀',
      dice: 'prochain jet échoué',
      isUtil: true,
      isLuckyReroll: true,
      friendlyOnly: true,
      halfOnMiss: false };
  }

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

  const _enchBuffNoImpact = !!mods?.enchantToucher || !!mods?.enchantMove;
  const _classicHasPrimary = s.designMode === 'classic'
    && ((s.classicEffect === 'damage' && !!String(s.degats || '').trim())
      || (s.classicEffect === 'heal' && !!String(s.soin || '').trim()));
  const isEnchantOnly = !_classicHasPrimary && (_enchBuffNoImpact || (enchantOnlyAlsoEtat
    ? (!!mods?.enchantArmeDmg || !!mods?.enchantEtatId) && !((s.degats || '').trim())
    : ( !!mods?.enchantArmeDmg && !((s.degats || '').trim()))));
  const isAfflictionOnly = !!mods?.affliction && !_classicHasPrimary;

  if (isEnchantOnly) {
    const enchMode  = s.enchantMode || 'dmg';
    const isEtat    = enchMode === 'etat' && !!mods?.enchantEtatId;
    const elementId = mods?.enchantArmeDmg?.element || s.noyauTypeId || null;
    const enchTypeObj = elementId ? getDamageTypeById(VS.damageTypes, elementId) : null;
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
    const aTypeObj = aff.element ? getDamageTypeById(VS.damageTypes, aff.element) : null;
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
  if (types.includes('offensif') || runes.includes('Lacération') || !!mods?.laceration) {
    const fullFormula    = _vttSortDmgFormula(s, c);
    const { rawDice: sRawDice, fixed: sFixed } = _splitDiceFormula(fullFormula);
    const spellTypeId    = s.noyauTypeId || null;
    const spellTypeRules = spellTypeId
      ? getDamageTypeRules(VS.damageTypes, spellTypeId)
      : { missEffect: 'half', armorPen: 0, dmgBonus: 0 };
    const spellTypeObj   = spellTypeId ? getDamageTypeById(VS.damageTypes, spellTypeId) : null;
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
      mjAlwaysMax: !!s.mjAlwaysMax, autoHit: !!s.mjAutoHit,
    };
  }
  const isAmpSupportHeal = types.includes('defensif')
    && (s.runes || []).includes('Amplification')
    && s.ampMode !== 'deplacement'
    && !(s.runes || []).includes('Protection');
  const isClassicHeal = s.designMode === 'classic' && s.classicEffect === 'heal' && !!String(s.soin || '').trim();
  if (types.includes('defensif') && (isClassicHeal || protMode === 'soin' || isAmpSupportHeal)) {
    const soinFormula = _vttSortSoinFormula(s, c);
    const { rawDice: sRawDice, fixed: sFixed } = _splitDiceFormula(soinFormula);
    // Stat de soin : override > auto (magique → stat arme magique ou Int ; physique → Con)
    let soinStatKey;
    if (s.degatsStat) {
      soinStatKey = s.degatsStat;
    } else {
      const mainP = c ? getMainWeapon(c) : null;
      const isMagic = !!(VS.damageTypes && s?.noyauTypeId
        && VS.damageTypes.find(x => x.id === s.noyauTypeId)?.isMagic);
      if (isMagic) {
        const fmt = VS.weaponFormats?.find(f => f.label === mainP?.format);
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
      mjAlwaysMax: !!s.mjAlwaysMax, autoHit: !!s.mjAutoHit,
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
  const c  = _characterForToken(t);
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
        ? { ...getDamageTypeRules(VS.damageTypes, t.summonElementId || 'physique'), missEffect: 'none' }
        : getDamageTypeRules(VS.damageTypes, t.summonElementId || 'physique'),
      damageTypeId:    t.summonElementId || 'physique',
      damageTypeIcon:  getDamageTypeById(VS.damageTypes, t.summonElementId || 'physique')?.icon || '',
      damageTypeColor: getDamageTypeById(VS.damageTypes, t.summonElementId || 'physique')?.color || '',
      mods: sentinelMods,
    });

    // ── Invocation : ses actions (sorts connus) deviennent des attaques ──
    if (_isInvoc && Array.isArray(t.summonActions) && t.summonActions.length) {
      const _cChar = {
        id: `__summon_${t.id || 'token'}`,
        nom: t.name || 'Invocation',
        stats: { force:10, dexterite:10, constitution:10, intelligence:10, sagesse:10, charisme:10 },
        statsBonus: {}, maitrises: {},
        equipement: { 'Main principale': {
          nom: 'Attaque',
          degats: t.summonBaseAttack || t.attackDice || '1d4',
          statAttaque: 'force',
          toucherStat: 'force',
          degatsStat: 'force',
          portee: t.range || 1,
          isDefault: true,
        } },
        sort_cats: [],
        elements: [],
      };
      let _ownerSetPmDelta = 0;
      if (t.summonOwnerId) {
        const _ownerData = VS.tokens[t.summonOwnerId]?.data;
        const _ownerChar = _ownerData?.characterId ? VS.characters[_ownerData.characterId] : null;
        if (_ownerChar) _ownerSetPmDelta = getArmorSetData(_ownerChar).modifiers?.spellPmDelta || 0;
      }
      const summonTouchBonus = Number.isFinite(parseInt(t.attack)) ? parseInt(t.attack) : 0;
      t.summonActions.forEach((a, ai) => {
        const baseRange = (a.portee != null && Number.isFinite(parseInt(a.portee)))
          ? parseInt(a.portee)
          : (t.range || 1);
        const pmRaw = (Number.isFinite(a.pmOverride) && a.pmOverride >= 0)
          ? a.pmOverride
          : (parseInt(a.pm) || 0);
        const pmCost = Math.max(0, pmRaw + _ownerSetPmDelta);
        const opt = _buildSpellOption(a, {
          id: `summon_action_${ai}`,
          sortIdx: `summon_${t.id || 'token'}_${ai}`,
          spellId: a.id || null,
          label: a.nom || `Action ${ai + 1}`,
          c: _cChar,
          portee: baseRange,
          pmCost,
          basePm: Math.max(0, pmRaw),
          pmRaw,
          pmSetDelta: _ownerSetPmDelta,
          fallbackTouchStat: 'force',
          fallbackDmgStat: 'force',
          fallbackTouchMod: summonTouchBonus,
          fallbackDmgMod: 0,
          touchSetBonus: 0,
          enchantOnlyAlsoEtat: true,
          extras: { _summonAction: true },
        });
        if (!opt) return;
        if (!opt.autoHit && opt.toucher === undefined) {
          opt.toucherMod = summonTouchBonus;
          opt.toucherSetBonus = 0;
          opt.toucherStatLabel = 'Invoc.';
        }
        options.push(_withSpellCooldown(t, opt));
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
      const dtype   = (VS.damageTypes || []).find(t => t.id === dtypeId) || null;
      options.push({
        id:      `beast_arme_${idx}`,
        icon:    '🦷',
        label:   w.nom || `Arme ${idx+1}`,
        rawDice: w.degats || '1d4',
        dice:    w.degats || '1d4',
        portee:  parseInt(w.portee) || 1,
        actionDescription: w.info || '',   // effet complémentaire (ex : « Si touche, applique Poison »)
        pmCost:  0,
        autoHit: !!w.toucherAuto,          // touche auto : pas de jet de toucher
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
        typeRules: getDamageTypeRules(VS.damageTypes, dtypeId),
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
      const atkTypeObj = atkTypeId ? getDamageTypeById(VS.damageTypes, atkTypeId) : null;
      const atkTypeRules = atkTypeId ? getDamageTypeRules(VS.damageTypes, atkTypeId) : getDamageTypeRules(VS.damageTypes, 'physique');
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

      options.push(_withSpellCooldown(t, _buildSpellOption(s, {
        id:    `beast_act_${actIdx}`,
        sortIdx: `b${actIdx}`,
        label: s.nom || `Action ${actIdx+1}`,
        c:     bChar,
        portee: baseRange,
        pmCost: cout, basePm: cout, pmRaw, pmSetDelta: 0,
        fallbackTouchStat: bStatKey, fallbackDmgStat: bStatKey,
        touchSetBonus: 0,
        enchantOnlyAlsoEtat: true,
      })));
    });
  }

  // Beast token : on n'enchaîne PAS sur les branches PNJ / personnage —
  // une créature n'a ni inventaire de PJ ni "poings" génériques.
  if (t.beastId) return options;

  // ── PNJ : stats saisies dans la fiche PNJ ──
  if (!c && t.npcId) {
    const n = VS.npcs[t.npcId] || {};
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
  const _r0 = VS.session?.combat?.round ?? 0;
  const wReplace = (t.buffs || []).find(b => b?.type === 'weapon_replace'
    && (b.expiresAtRound == null || _r0 === 0 || _r0 <= b.expiresAtRound));

  // ── Arme principale du personnage (ou attaque générique) ──
  const weapon       = c ? _vttPrimaryWeapon(c) : null;
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
  const fmt        = wReplace ? null : VS.weaponFormats?.find(f => f.label === weapon?.format);
  const isMagicW   = wReplace ? true : fmt?.isMagic === true;
  const typeRules  = wReplace
    ? getDamageTypeRules(VS.damageTypes, wReplaceTypeId)
    : (isMagicW
        ? getDamageTypeRules(VS.damageTypes, 'physique')
        : getDamageTypeRules(VS.damageTypes, fmt?.damageType || 'physique'));

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
  const _round_eff = VS.session?.combat?.round ?? 0;
  const _enchantBuff = (t.buffs || []).find(b =>
    b.type === 'dmg_bonus' && b.slot === 'arme'
    && (b.expiresAtRound == null || _round_eff === 0 || _round_eff <= b.expiresAtRound)
  );
  const _enchantDmgCondition = _conditionDmgBonusOf(t);
  // NB : le bonus toucher d'enchantement (toucher_bonus) n'est PAS baked ici —
  // il est ajouté frais au jet (_vttRollAttack) et au HUD pour rester à jour si
  // le buff est posé après la construction du panneau.
  const _wDefaultTypeId = wReplace ? wReplaceTypeId : (isMagicW ? null : (fmt?.damageType || 'physique'));
  const _wFinalTypeObj  = _wDefaultTypeId ? getDamageTypeById(VS.damageTypes, _wDefaultTypeId) : null;

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
      // Sort suspendu actif pour CE sort (buff non expiré) → une version GRATUITE
      // du sort est dispo dans la liste (cast une fois → consomme le buff).
      // Match par ID STABLE (s.id) d'abord — un réordonnancement du Grimoire ne
      // doit pas faire pointer le buff vers un autre sort ; sortIdx = legacy.
      const _rNow = VS.session?.combat?.round ?? 0;
      const hasSuspendedBuff = (t.buffs || []).some(b =>
        b.type === 'suspended_spell'
        && ((b.spellId && s.id) ? b.spellId === s.id : b.sortIdx === idx)
        && (b.expiresAtRound == null || _rNow === 0 || _rNow <= b.expiresAtRound));
      const isOneShot = _freeNextCast.has(freeKey) || hasSuspendedBuff;
      const cout      = (freeCasts > 0 || isOneShot) ? 0 : basePm;
      // Catégorie pour le tri dans le modal VTT
      const sortCats = c.sort_cats || [];
      const sortCat  = s.catId ? sortCats.find(ct => ct.id === s.catId) : null;
      const catMeta  = { catId: s.catId || null, catLabel: sortCat?.nom || null, catColor: sortCat?.couleur || null };

      options.push(_withSpellCooldown(t, _buildSpellOption(s, {
        id: `sort_${idx}`, sortIdx: idx, spellId: s.id || null, label: s.nom || `Sort ${idx+1}`,
        c,
        portee: baseRange,
        pmCost: cout, basePm, pmRaw, pmSetDelta: spellPmDelta,
        fallbackTouchStat: wTchStat,    fallbackDmgStat: sStatKey,
        fallbackTouchMod:  wTchMod,     fallbackDmgMod:  sStatMod,
        touchSetBonus: wSetBonus,
        enchantOnlyAlsoEtat: true,
        extras: catMeta,
      })));
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

        options.push(_withSpellCooldown(t, _buildSpellOption(s, {
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
        })));
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
// _execAttack ouvre le sélecteur d'action.
//  - Mode "cible d'abord" (tgtId fourni)   : flux historique, options filtrées par portée.
//  - Mode "action d'abord" (tgtId == null) : ouvert depuis la barre d'action, AUCUNE cible
//    encore ; toutes les options de la catégorie `only` sont listées, et chaque carte entre
//    en mode visée (_vttAimOpt) au lieu de lancer directement.
// `only` ∈ 'weapons' | 'items' | 'spells' | 'basic' | null restreint les sections affichées.
// Méta des runes (icône/couleur) — utilisée par _optBtn pour les pastilles de
// rune sur les cartes d'action. (Miroir de la copie de vtt-mini-fiche.js.)
// [_VTT_RUNE_META → vtt-constants.js (importé en haut, partagé avec mini-fiche)]

// Snapshot pré-action des entités impliquées (lanceur + cibles) : PV/PM/buffs/
// états. Stocké sur le log de l'action → l'annulation MJ restaure cet état exact
// (dégâts/soins rendus, PM rendus, buffs et états posés retirés). Voir
// _vttUndoAction.
// PV courants RÉELS d'un token (indépendant du filtre d'estimation joueur) —
// au bon endroit selon le type (perso → fiche, PNJ → doc PNJ, ennemi → token).
function _effectiveTokenHp(t) {
  if (t.characterId) { const c = VS.characters[t.characterId]; return c ? (c.hp ?? calcPVMax(c)) : (t.hp ?? null); }
  if (t.npcId)       { const n = VS.npcs[t.npcId];            return n ? _numOr(n.hp, _numOr(n.pvMax, t.hp ?? null)) : (t.hp ?? null); }
  if (t.beastId)     { const b = VS.bestiary[t.beastId];      return t.hp != null ? t.hp : (b ? _numOr(b.pvMax, null) : null); }
  return t.hp ?? null;
}

// PM courant RÉEL stocké SUR LE TOKEN (créatures bestiaire / invocations qui
// paient leurs compétences sur leur propre mana). null si le token ne porte pas
// de PM (perso/PNJ → le PM est sur la fiche, capturé via `chars`).
function _effectiveTokenPm(t) {
  if (t.beastId) { const b = VS.bestiary[t.beastId]; return t.pm != null ? t.pm : (b ? _numOr(b.pmMax, null) : null); }
  return t.pm ?? null;
}

function _captureUndoSnapshot(srcId, targetIds) {
  const ids = [...new Set([srcId, ...(targetIds || [])].filter(Boolean))];
  const tokens = {}, chars = {};
  const addChar = (cid) => { if (cid && chars[cid] === undefined) { const c = VS.characters[cid]; chars[cid] = { pm: c ? _charPmCur(c) : null }; } };
  for (const id of ids) {
    const t = VS.tokens[id]?.data; if (!t) continue;
    tokens[id] = {
      hp: _effectiveTokenHp(t),
      pvCombatHp: t.pvCombatHp ?? null,
      pm: _effectiveTokenPm(t),
      pmCombat: t.pmCombat ?? _effectiveTokenPm(t),
      buffs: Array.isArray(t.buffs) ? JSON.parse(JSON.stringify(t.buffs)) : [],
      conditions: Array.isArray(t.conditions) ? JSON.parse(JSON.stringify(t.conditions)) : [],
    };
    if (t.characterId) addChar(t.characterId);
  }
  const srcT = VS.tokens[srcId]?.data;
  addChar(_characterForToken(srcT)?.id);
  if (srcT?.summonOwnerCharId) addChar(srcT.summonOwnerCharId);
  if (srcT?.summonOwnerId) addChar(_characterForToken(VS.tokens[srcT.summonOwnerId]?.data)?.id);
  return { tokens, chars };
}

// Ids des tokens invoqués lors de la séquence de placement en cours (pour que
// l'annulation MJ d'une invocation supprime les tokens créés).
let _summonSpawnIds = [];

// ── Pills d'une action/sort (SOURCE UNIQUE) ──────────────────────────────────
// Partagé par les cartes du picker (_optBtn) ET la modale de confirmation, pour
// que les deux affichent EXACTEMENT la même info (portée, zone/cibles, effet, JS…).
const _vttAoptPill = (cls, html) => `<span class="vtt-aopt-pill ${cls}">${html}</span>`;
function _vttSpellPills(o) {
  const pills = [];
  const targetSelf = !!o.targetSelf;
  const isHeal = !!o.isHeal;
  const isUtil = !!(o.isCaSort || o.isUtil);
  const isEnchant = !!o.isEnchant;
  if (o.actionType === 'bonus')         pills.push(_vttAoptPill('action-bonus', `💫 Action Bonus`));
  else if (o.actionType === 'reaction') pills.push(_vttAoptPill('action-reaction', `⚡ Réaction`));
  if (o.cooldownRemaining > 0) pills.push(_vttAoptPill('cooldown', `⏳ Recharge ${o.cooldownRemaining} tour${o.cooldownRemaining > 1 ? 's' : ''}`));
  else if (o.cooldownTurns > 0) pills.push(_vttAoptPill('cooldown ready', `↻ Recharge ${o.cooldownTurns} tour${o.cooldownTurns > 1 ? 's' : ''}`));
  if (!targetSelf) pills.push(_vttAoptPill('range', `🎯 ${o.portee}c`));
  const isFriendly = isEnchant || isHeal || o.isRegen || o.friendlyOnly;
  const isHostile  = !!o.isAffliction || !!o.hostileOnly;
  if (targetSelf) {
    pills.push(_vttAoptPill('targets self', `🧍 Sur soi`));
  } else if (o.zoneW > 0 || o.zoneH > 0) {
    const zoneIcon = o.zoneShape === 'cross' ? '✚' : o.zoneShape === 'diamond' ? '◇' : '📐';
    pills.push(_vttAoptPill('zone', `${zoneIcon} ${o.zoneW||o.zoneH}×${o.zoneH||o.zoneW}c`));
  } else if ((o.nbCibles || 1) > 1) {
    const lbl = isFriendly ? 'alliés' : isHostile ? 'ennemis' : 'cibles';
    pills.push(_vttAoptPill('targets', `👥 ${o.nbCibles} ${lbl}`));
  } else if (isFriendly) {
    pills.push(_vttAoptPill('targets single', `🤝 1 allié`));
  } else if (isHostile) {
    pills.push(_vttAoptPill('targets single', `💢 1 ennemi`));
  } else {
    pills.push(_vttAoptPill('targets single', `🎯 1 cible`));
  }
  // Effet principal (dégâts / soin / enchant / affliction / utilitaire)
  if (isEnchant) {
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
      const enchFormula = _effectDisplay(o, o.enchantFormula || '1d4+2');
      pills.push(`<span class="vtt-aopt-pill enchant" style="color:${elemCol};border-color:${elemCol}66;background:${elemCol}1a">${elemIcon} +${_esc(enchFormula)} / arme alliée</span>`);
    }
  } else if (o.isRegen) {
    pills.push(`<span class="vtt-aopt-pill heal" style="color:#22c38e;border-color:#22c38e66;background:#22c38e1a">💚 ${_esc(_effectDisplay(o, o.dice || '2d4/tour'))}</span>`);
  } else if (o.isInvocation) {
    const maxInv = o.mods?.invocation?.maxInvocations || o.mods?.invocation?.nbInvocations || 1;
    pills.push(`<span class="vtt-aopt-pill" style="color:#f3d27d;border-color:#a1620766;background:#a162071a">🐾 ${maxInv} invocation${maxInv > 1 ? 's' : ''}</span>`);
  } else if (o.isAffliction) {
    const elemIcon = o.afflictionElementIcon || '💀';
    const elemCol  = o.afflictionElementColor || '#ef4444';
    if (o.afflictionMode === 'etat' && o.afflictionEtatId) {
      const lib = CONDITION_BY_ID[o.afflictionEtatId];
      const lbl = lib ? `${lib.icon} ${lib.label}` : '⛓ État';
      pills.push(`<span class="vtt-aopt-pill" style="color:${elemCol};border-color:${elemCol}66;background:${elemCol}1a">${lbl}</span>`);
    } else {
      pills.push(`<span class="vtt-aopt-pill" style="color:${elemCol};border-color:${elemCol}66;background:${elemCol}1a">${elemIcon} ${_esc(_effectDisplay(o, o.afflictionDotFormula || '1d4'))} / tour</span>`);
    }
    const statLbl = (_STAT_SHORT[o.afflictionSaveStat] || o.afflictionSaveStat || '').toUpperCase();
    pills.push(_vttAoptPill('save', `🛡 JS ${statLbl} DD ${o.afflictionDD}`));
  } else if (isUtil) {
    const effetTxt = _effectDisplay(o, o.dice || '').trim();
    pills.push(_vttAoptPill('util', `🔧 ${effetTxt ? _esc(effetTxt) : 'Utilitaire'}`));
  } else if (o.rawDice || o.dice) {
    const formula = o.rawDice || o.dice;
    const displayFormula = _effectDisplay(o, formula, _optionFixedBonus(o));
    pills.push(_vttAoptPill(isHeal ? 'heal' : 'dmg', `${isHeal ? '🩹' : '🎲'} ${isHeal ? '+' : ''}${_esc(displayFormula)}${isHeal ? ' PV' : ''}`));
  }
  // Stat utilisée (provenance du +X)
  if (o.dmgStatLabel && (o.dmgStatMod !== undefined && o.dmgStatMod !== null)) {
    const m = o.dmgStatMod;
    const modStr = m > 0 ? `+${m}` : m < 0 ? `${m}` : '±0';
    pills.push(_vttAoptPill('stat', `📊 ${_esc(o.dmgStatLabel)} ${modStr}`));
  }
  if (o.traits?.length) {
    pills.push(`<span class="vtt-aopt-pill traits">${o.traits.slice(0,2).map(_esc).join(' · ')}</span>`);
  }
  return pills;
}
// Chips de runes du sort (lecture seule), comme sur la carte de la fiche perso.
function _vttSpellRuneChips(o, srcChar) {
  if (o.sortIdx === undefined || !srcChar?.deck_sorts) return '';
  const _s = srcChar.deck_sorts[o.sortIdx];
  const _runes = _vttDisplayRunes(_s?.runes || []);
  if (!_runes.length) return '';
  const _counts = {}; _runes.forEach(r => { _counts[r] = (_counts[r]||0)+1; });
  return `<div class="cs-spellcard-runes">${Object.entries(_counts).map(([nom, n]) => {
    const m = _VTT_RUNE_META[nom] || { icon:'•', color:'#888' };
    return `<span class="cs-runechip" style="--c:${m.color}" title="${_esc(nom)}">${m.icon} ${_esc(nom)}${n>1?` ×${n}`:''}</span>`;
  }).join('')}</div>`;
}

async function _execAttack(srcId, tgtId, exOpts = {}) {
  const only  = exOpts.only || null;
  const noTgt = tgtId == null;
  const src=VS.tokens[srcId]?.data;
  if (!src) return;
  const tgt = noTgt ? null : VS.tokens[tgtId]?.data;
  if (!noTgt && !tgt) return;
  const lS=_live(src), lT = tgt ? _live(tgt) : null;
  const dist = noTgt ? null : _tokenAttackDistance(src, tgt);

  const options = _buildAttackOptions(src);
  // Cible d'abord : filtre par portee, en gardant les actions "sur soi".
  // Action d'abord : pas de cible, on garde tout et la portee sera verifiee a la visee.
  const inRange = noTgt
    ? options
    : options.filter(o => {
        if (o.friendlyOnly && tgt.type === 'enemy') return false;
        if (o.hostileOnly && tgt.type !== 'enemy') return false;
        return o.targetSelf || _tokenAttackDistance(src, tgt, o.portee) <= o.portee;
      });
  if (!noTgt) {
    // Aucune attaque a portee : on bloque sauf si on controle le token source.
    // Dans ce cas la modale reste disponible pour les actions de base.
    if (!inRange.length && !_canControlToken(src)) {
      showNotif(`Hors de portee (${dist} case${dist>1?'s':''}, portee max ${Math.max(...options.map(o=>o.portee))})`, 'error');
      return;
    }
    if (!inRange.length) {
      showNotif(`Aucune attaque a portee (${dist} case${dist>1?'s':''}) - actions de base disponibles.`, 'info');
    }
  }

  // Stocke les options dans un cache indexé — pas de JSON dans les onclick.
  // En mode action d'abord, la clé sans cible (`${srcId}__`) est lue par _vttAimOpt.
  const cacheKey = noTgt ? `${srcId}__` : `${srcId}__${tgtId}`;
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
  const srcChar   = _characterForToken(src);
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
    const dist     = noTgt ? null : _tokenAttackDistance(src, tgt, o.portee);
    const canHit   = noTgt ? true : dist <= o.portee;
    const onCooldown = (o.cooldownRemaining || 0) > 0;
    const isHeal   = !!o.isHeal;
    const isUtil   = !!(o.isCaSort || o.isUtil);
    const stack    = o._itemAction?.stackCount > 1 && o._itemAction?.consommable
                       ? `<span class="vtt-aopt-stack">×${o._itemAction.stackCount}</span>` : '';
    const desc     = (o.actionDescription || '').trim();
    const source = (() => {
      if (o._itemAction) {
        const itemId = o._itemAction.itemId || '';
        if (itemId) return { label: `🎒 ${o._itemAction.itemNom || 'Objet'}`, args: `shop|${itemId}|detail`, title: 'Ouvrir cet article boutique' };
        if (src.characterId) return { label: `🎒 ${o._itemAction.itemNom || 'Objet'}`, args: `char|${src.characterId}|inv`, title: "Ouvrir l'inventaire source" };
        return { label: `🎒 ${o._itemAction.itemNom || 'Objet'}`, args: '', title: 'Objet' };
      }
      if (o.sortIdx !== undefined) {
        const key = String(o.sortIdx);
        if (/^b\d+/.test(key) && src.beastId) return { label: '🐉 Bestiaire', args: `bestiary|${src.beastId}`, title: 'Ouvrir la créature source' };
        if (/^i\d+_/.test(key) && src.characterId) return { label: '🎒 Objet', args: `char|${src.characterId}|inv`, title: "Ouvrir l'inventaire source" };
        if (src.characterId) return { label: o.catLabel ? `✨ ${o.catLabel}` : '✨ Sort', args: `char|${src.characterId}|sorts`, title: 'Ouvrir les sorts du personnage' };
        return { label: o.catLabel ? `✨ ${o.catLabel}` : '✨ Sort', args: '', title: 'Sort' };
      }
      if ((src.beastId || src.type === 'enemy') && src.beastId) return { label: '🐉 Bestiaire', args: `bestiary|${src.beastId}`, title: 'Ouvrir la créature source' };
      if (src.npcId) return { label: '👥 PNJ', args: `npc|${src.npcId}`, title: 'Ouvrir le PNJ source' };
      if (src.characterId) return { label: '⚔ Arme équipée', args: `char|${src.characterId}|combat`, title: 'Ouvrir le combat du personnage' };
      return { label: '⚔ Action', args: '', title: 'Action' };
    })();
    // IMPORTANT : la carte entière est le bouton de lancement. Garder un
    // data-vtt-fn imbriqué ici rendait la puce "Bestiaire" prioritaire au clic
    // (dispatcher en capture), ce qui envoyait le MJ sur la page Bestiaire.
    const sourceChip = source?.label
      ? `<span class="vtt-aopt-source" title="${_esc(source?.title || 'Source')}">${_esc(source.label)}</span>`
      : '';

    // ── Coût en PM : badge dédié à DROITE du titre (pas en pill) ──────
    let pmBadge = '';
    const _setDelta = o.pmSetDelta || 0;
    const _setReduc = _setDelta < 0;
    const _setExtra = _setDelta
      ? `<span class="vtt-aopt-pm-set" title="Set d'armure : ${_setDelta > 0 ? '+' : '−'}${Math.abs(_setDelta)} PM (coût brut ${o.pmRaw})">${_setDelta > 0 ? '⬆' : '🍃'} ${_setDelta > 0 ? '+' : '−'}${Math.abs(_setDelta)}</span>`
      : '';
    if (o.pmCost > 0) {
      pmBadge = `<span class="vtt-aopt-pm ${_setReduc?'vtt-aopt-pm--reduced':''}">🔮 ${o.pmCost} PM${_setExtra}</span>`;
    } else if (o.pmCost === 0 && o.basePm > 0) {
      pmBadge = `<span class="vtt-aopt-pm vtt-aopt-pm--free" title="Cast offert (multi-cibles ou sort suspendu déclenché)">🎁 Gratuit</span>`;
    } else if (o.basePm > 0) {
      pmBadge = `<span class="vtt-aopt-pm ${_setReduc?'vtt-aopt-pm--reduced':''}">🔮 ${o.basePm} PM${_setExtra}</span>`;
    }

    // Pills (portée, zone/cibles, effet, JS, stat, traits) — source unique partagée.
    const pills = _vttSpellPills(o);

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
    const runeChipsHtml = _vttSpellRuneChips(o, srcChar);

    const cardKind = o._itemAction ? 'is-item'
      : o.sortIdx !== undefined ? 'is-spell'
      : o.isDeplacement ? 'is-move'
      : 'is-weapon';
    const cardState = onCooldown ? 'is-cooldown' : noTgt ? 'is-aim' : canHit ? 'is-ready' : 'is-oor';
    const cardHint = onCooldown ? `Recharge ${o.cooldownRemaining}t`
      : noTgt ? 'Choisir puis viser'
      : canHit ? 'Lancer'
      : 'Hors portée';

    // Carte d'action — présentation identique aux cartes de sort de la fiche perso
    // (.cs-spellcard, scope .cs-v3), cliquable pour lancer.
    return `
      <button type="button" class="cs-spellcard vtt-castcard ${cardKind} ${cardState}" style="--type-col:${accentCol}" data-vtt-fn="${noTgt?'_vttAimOpt':'_vttPickOpt'}" data-vtt-args="${noTgt?`${srcId}|${i}`:`${srcId}|${tgtId}|${i}`}" ${onCooldown ? 'disabled aria-disabled="true"' : ''}>
        <header class="cs-spellcard-head">
          <span class="cs-spellcard-icon">${o.icon}</span>
          <div class="cs-spellcard-id">
            <div class="cs-spellcard-name" title="${_esc(o.label)}">${_esc(o.label)}</div>
            <div class="cs-spellcard-sub">${actChip}${sourceChip}${elemPastille}${stack}</div>
          </div>
          ${pmBadge}
          <span class="vtt-castcard-cta">${cardHint}</span>
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
  //   En mode action d'abord, `only` scinde Armes / Objets (chips séparés de la barre).
  const arsenalOpts = [
    ...(!only || only === 'arsenal' || only === 'weapons' ? weaponOpts : []),
    ...(!only || only === 'arsenal' || only === 'items'   ? itemActOpts : []),
  ];
  if (arsenalOpts.length) {
    const title = only === 'weapons' ? 'Armes' : only === 'items' ? 'Objets' : 'Arsenal';
    const icon  = only === 'items' ? '🎒' : only === 'weapons' ? '⚔️' : '🛡';
    const body = arsenalOpts.map(o => _optBtnWithName(o, inRange.indexOf(o))).join('');
    optsHtml += _section('arsenal', icon, title, '#94a3b8', arsenalOpts.length, body);
    tabs.push({ id:'arsenal', icon, title, color:'#94a3b8', count:arsenalOpts.length });
  }

  // ── Sorts (groupés par catégorie ou non) ──
  if (spellOpts.length && (!only || only === 'spells')) {
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
  const inCombat = !!VS.session?.combat?.active;
  const couru    = (src.bonusMvt || 0) > 0;
  const canEditSrc = _canControlToken(src);
  let basicHtml = '';
  if (canEditSrc && (!only || only === 'basic')) {
    // Carte d'action de base — même présentation (.cs-spellcard) que les sorts.
    const _basicCard = (icon, name, desc, col, fn, args) => `
        <button type="button" class="cs-spellcard vtt-castcard is-basic is-ready" style="--type-col:${col}" data-name="${_norm(name).replace(/"/g,'')}" data-vtt-fn="${fn}" data-vtt-args="${args}">
          <header class="cs-spellcard-head">
            <span class="cs-spellcard-icon">${icon}</span>
            <div class="cs-spellcard-id"><div class="cs-spellcard-name" title="${name}">${name}</div></div>
            <span class="vtt-castcard-cta">Faire</span>
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

  const innerHtml = `
      <div class="vtt-aopt-modal-hd">
        <div class="vtt-aopt-modal-targets">
          <span class="vtt-aopt-modal-src"><strong>${_esc(lS.displayName??src.name)}</strong></span>
          ${noTgt ? '' : `<span class="vtt-aopt-modal-arrow">→</span>
          <span class="vtt-aopt-modal-tgt"><strong>${_esc(lT.displayName??tgt.name)}</strong></span>`}
        </div>
        ${noTgt
          ? `<span class="vtt-aopt-modal-dist" title="Choisis l'action puis clique une cible">🎯 puis clique une cible</span>`
          : `<span class="vtt-aopt-modal-dist" title="Distance source → cible">📏 ${dist}c</span>`}
      </div>
      ${pmBar}
      ${tabsHtml}
      ${noTgt ? searchHtml.replace(' autofocus', '') : searchHtml}
      <div class="vtt-aopt-list cs-v3">${optsHtml}${basicHtml}
        <div class="vtt-aopt-empty" style="display:none"><span style="opacity:.5">Aucune action ne correspond.</span></div>
      </div>`;

  // Flux « action d'abord » (sans cible) → HUD docké en bas du canvas.
  // Flux « clic sur une cible » → modale centrée (inchangé).
  if (noTgt) {
    _showActionHud(`<div class="vtt-form vtt-aopt-modal vtt-aopt-hud">
      <button type="button" class="vtt-aopt-hud-toggle" title="Replier / déplier les actions" data-vtt-fn="_vttToggleHudCollapse">▾</button>
      <button type="button" class="vtt-aopt-hud-close" title="Fermer" data-vtt-fn="_hideActBar">✕</button>
      ${innerHtml}</div>`);
    return;
  }

  openModal('⚔️ Choisir une action', `
    <div class="vtt-form vtt-aopt-modal">${innerHtml}
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
    const td = VS.tokens[tid]?.data;
    if (!td) continue;
    // Profil de la cible : créature (bestiaire) OU personnage (via son équipement).
    let prof = null;
    if (td.type === 'enemy' && td.beastId) prof = VS.bestiary[td.beastId];
    else if (td.characterId) prof = getCharDamageProfile(STATE.characters.find(x => x.id === td.characterId));
    if (!prof) continue;
    const inter = previewDamageInteraction(opt.damageTypeId, prof);
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
  const t = getDamageTypeById(VS.damageTypes, elemId);
  ctx.opt.damageTypeId    = elemId;
  ctx.opt.typeRules       = getDamageTypeRules(VS.damageTypes, elemId);
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
  if ((opt.cooldownRemaining || 0) > 0) {
    showNotif(`Sort en recharge (${opt.cooldownRemaining} tour${opt.cooldownRemaining > 1 ? 's' : ''}).`, 'warning');
    return;
  }
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
  if ((opt.zoneW > 0 || opt.zoneH > 0) && !_mtPending) {
    _startZonePlacement(srcId, tgtId, opt, +idx);
    return;
  }

  // Sort multi-cibles : entrer en mode de sélection (sauf si on revient d'une validation)
  if ((opt.nbCibles || 1) > 1 && !_mtPending) {
    _startMultiTarget(srcId, tgtId, opt, +idx);
    return;
  }

  const src=VS.tokens[srcId]?.data, tgt=VS.tokens[tgtId]?.data;
  if (!src||!tgt) return;
  const lS=_live(src), lT=_live(tgt);
  const srcChar = _characterForToken(src);   // pour les chips de runes (cohérence carte ↔ modale)
  // Si on arrive d'une validation multi-cibles, stocker les cibles dans le contexte
  const allTargets = _mtPending && _mtPending.length > 0 ? [..._mtPending] : null;
  _mtPending = null;

  // Arme magique : l'élément se choisit maintenant DANS cette modale (sélecteur en
  // haut), plus de modale séparée. On fixe un défaut tout de suite (1er élément
  // accessible, sinon physique) pour que les dégâts/aperçus s'affichent.
  if (opt.isMagicWeapon && !opt._mwElemReady) {
    const avail = (opt.charElements || []).map(id => getDamageTypeById(VS.damageTypes, id)).filter(Boolean);
    const def = avail[0] || getDamageTypeById(VS.damageTypes, 'physique');
    if (def) {
      opt.damageTypeId    = def.id;
      opt.typeRules       = getDamageTypeRules(VS.damageTypes, def.id);
      opt.damageTypeIcon  = def.icon || '';
      opt.damageTypeColor = def.color || '';
    }
    opt._mwElemReady = true;   // évite de réinitialiser à chaque réouverture (Retour)
  }

  // Sceau runique signature : capturé ici (le sort est en main) pour être joué à
  // la résolution. Couleur = élément, géométrie = runes, forme = catégorie.
  const _sigil = _buildCastSigil(src, opt);

  _atkCtx = { srcId, tgtId, opt, lS, lT, allTargets, sigil: _sigil };

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
    if (opt.toucherSetBonus)   { tot += opt.toucherSetBonus; parts.push(`Set ${sn(opt.toucherSetBonus)}`); }
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
    if (opt.mjAlwaysMax) {
      const maxVal = _maxEffectDisplay(opt.rawDice, tot);
      degatsFormula = _mkCell(`${_dmgIcon} <code style="font-size:.88rem;color:${dmgAccent}">${_esc(maxVal)}</code>`, 0, [`effet max de ${opt.rawDice}${tot ? ` ${sn(tot)}` : ''}`], dmgAccent);
    } else {
      degatsFormula = _mkCell(`${_dmgIcon} <code style="font-size:.88rem;color:${dmgAccent}">${opt.rawDice}</code>`, tot, parts, dmgAccent);
    }
  } else {
    const displayDice = _effectDisplay(opt, opt.dice);
    const detail = opt.mjAlwaysMax ? [`effet max de ${opt.dice}`] : [];
    degatsFormula = _mkCell(`${_dmgIcon} <code style="font-size:.88rem;color:${dmgAccent}">${_esc(displayDice)}</code>`, 0, detail, dmgAccent);
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
    _elemChoices = opt.spellElementChoices.map(id => getDamageTypeById(VS.damageTypes, id)).filter(Boolean);
  } else if (opt.isMagicWeapon) {
    _elemChoices = (opt.charElements || []).map(id => getDamageTypeById(VS.damageTypes, id)).filter(Boolean);
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
          const td = VS.tokens[id]?.data;
          const nm = td ? (_live(td).displayName ?? td.name ?? id) : id;
          return `<span style="font-size:.65rem;padding:.15rem .45rem;border-radius:999px;
            background:rgba(79,140,255,.12);border:1px solid rgba(79,140,255,.3);color:#4f8cff">${_esc(nm)}</span>`;
        }).join('')}
      </div>` : ''}

      <!-- Pills + runes IDENTIQUES à la carte d'action (source unique _vttSpellPills) -->
      <div class="cs-v3 vtt-atk-pills" style="display:flex;flex-direction:column;gap:.4rem;margin-bottom:.85rem">
        ${(() => { const p = _vttSpellPills(opt); return p.length ? `<div class="cs-spellcard-tags">${p.join('')}</div>` : ''; })()}
        ${_vttSpellRuneChips(opt, srcChar)}
      </div>

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
          ${opt.zoneShape === 'cross' ? '✚' : opt.zoneShape === 'diamond' ? '◇' : '📐'} Zone <strong style="color:#fde047">${opt.zoneShape === 'cross' ? 'croix ' : opt.zoneShape === 'diamond' ? 'cercle ' : ''}${opt.zoneW}×${opt.zoneH} cases</strong>
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
  const typeRules  = getDamageTypeRules(VS.damageTypes, elementId);
  const elemType   = getDamageTypeById(VS.damageTypes, elementId);
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
  const K = window.Konva; if (!K || !VS.layers.token) return null;
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
  VS.layers.token.add(line);
  VS.layers.token.batchDraw();
  return line;
}

/** Supprime toutes les lignes du contexte local. */
function _mtClearLines() {
  if (!_mtCtx?.lines) return;
  _mtCtx.lines.forEach(l => l.destroy());
  _mtCtx.lines.clear();
  VS.layers.token?.batchDraw();
}

/** Supprime les lignes distantes (broadcast). */
function _clearRemoteLines() {
  VS.layers.token?.find('.remote-mt-line').forEach(l => l.destroy());
  VS.layers.token?.batchDraw();
}

/** Affiche ou met à jour le HUD flottant. */
function _mtRefreshHud() {
  const existing = document.getElementById('vtt-mt-hud');
  if (existing) existing.remove();
  if (!_mtCtx) return;

  const { opt, targets, maxTargets } = _mtCtx;
  const names = targets.map(id => {
    const td = VS.tokens[id]?.data;
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
  const _hudKey = e => {
    if (_vttIsTypingTarget(e.target)) return;
    if (e.key === 'Enter') _mtValidate();
    if (e.key === 'Escape') _mtCancel();
  };
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
    pageId: VS.activePage?.id || null,
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

  const srcData = VS.tokens[srcId]?.data, tgtData = VS.tokens[firstTgtId]?.data;
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
    VS.layers.token?.batchDraw();
  } else {
    if (targets.length >= maxTargets) {
      showNotif(`Maximum ${maxTargets} cibles pour ce sort`, 'error');
      return;
    }
    const srcData = VS.tokens[srcId]?.data, tgtData = VS.tokens[tgtId]?.data;
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
  const src = VS.tokens[srcId]?.data; if (!src) { _mtPending = null; return; }
  const tgtData = VS.tokens[firstTgt]?.data; if (!tgtData) { _mtPending = null; return; }
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
  VS.layers.token?.batchDraw();
}

/** (Re)Construit le rectangle Konva de prévisualisation. */
function _buildZonePreview() {
  if (!_zoneCtx || !VS.layers.token) return;
  _zonePreview?.destroy();
  const K = window.Konva;
  const { wPx, hPx, x, y } = _zoneCtx;
  const group = new K.Group({ x, y, listening: false, name: 'zone-preview' });
  const _fill = 'rgba(253,224,71,0.22)', _stroke = '#fde047';
  if (_zoneCtx.opt?.zoneShape === 'cross') {
    // Croix : barre verticale (1 case × hauteur) + barre horizontale (largeur × 1 case).
    group.add(new K.Rect({ x: -CELL / 2, y: -hPx / 2, width: CELL, height: hPx,
      fill: _fill, stroke: _stroke, strokeWidth: 3, dash: [10, 5], listening: false }));
    group.add(new K.Rect({ x: -wPx / 2, y: -CELL / 2, width: wPx, height: CELL,
      fill: _fill, stroke: _stroke, strokeWidth: 3, dash: [10, 5], listening: false }));
  } else if (_zoneCtx.opt?.zoneShape === 'diamond') {
    group.add(new K.Line({
      points: [0, -hPx / 2, wPx / 2, 0, 0, hPx / 2, -wPx / 2, 0],
      closed: true,
      fill: _fill, stroke: _stroke, strokeWidth: 3, dash: [10, 5], listening: false,
    }));
  } else {
    group.add(new K.Rect({
      x: -wPx / 2, y: -hPx / 2,
      width: wPx, height: hPx,
      fill: _fill, stroke: _stroke,
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
  }
  group.add(new K.Text({
    x: -wPx / 2 + 5, y: -hPx / 2 + 4,
    text: `${_zoneCtx.opt.zoneW}×${_zoneCtx.opt.zoneH}c`,
    fill: '#fde047', fontSize: 11, fontStyle: 'bold', listening: false,
  }));
  VS.layers.token.add(group);
  _zonePreview = group;
  VS.layers.token.batchDraw();
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
  VS.layers.token.batchDraw();
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
    if (_vttIsTypingTarget(e.target)) return;
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

// Pose une zone de sort PERSISTANTE (sort utilitaire) : un dessin partagé par
// tous, qui disparaît après la durée du sort (défaut 2 tours). Réutilise la
// collection d'annotations (rendu + sync gratuits). Renvoie l'id (pour l'undo).
async function _vttPlaceSpellZone(srcId, opt, { x, y, wPx, hPx }) {
  if (!VS.activePage) return null;
  const round = VS.session?.combat?.round ?? 0;
  const dur = opt.mods?.concentration ? 10 : (opt.sortDuree ?? 2);
  // Même convention d'expiration que buffs/états : en combat → round+dur−1 ;
  // hors combat → dur (converti au démarrage du round 1).
  const expiresAtRound = round > 0 ? (round + dur - 1) : dur;
  const sigil = _buildCastSigil(VS.tokens[srcId]?.data, opt);
  const color = sigil?.color || opt.enchantElementColor || opt.afflictionElementColor || '#b47fff';
  const data = {
    type: 'spellzone',
    x, y, w: wPx, h: hPx,
    shape: ['cross', 'diamond'].includes(opt.zoneShape) ? opt.zoneShape : 'rect',
    color, fill: true, strokeWidth: 2,
    label: opt.label || 'Zone', icon: opt.icon || '✨',
    totalDuration: dur, startRound: round, expiresAtRound,
    pageId: VS.activePage.id,
    createdBy: STATE.user?.uid || null, createdAt: serverTimestamp(),
  };
  const id = 'z' + Date.now() + Math.random().toString(36).slice(2, 5);
  try { await setDoc(_annotRef(id), data); _pushDrawHistory(id); return id; }
  catch (err) { console.error('[VTT] spellzone save', err?.code, err?.message); return null; }
}

// Supprime les zones de sort dont la durée est écoulée (appelé au passage de round
// par le MJ). Les zones sans expiration (posées hors combat) restent.
export function _vttExpireSpellZones(round) {
  if (!STATE.isAdmin) return;
  for (const [id, e] of Object.entries(_annotations)) {
    const d = e?.data;
    if (d?.type === 'spellzone' && d.expiresAtRound != null && round > d.expiresAtRound) {
      _annotations[id]?.shape?.destroy?.();
      delete _annotations[id];
      deleteDoc(_annotRef(id)).catch(() => {});
    }
  }
  VS.layers.draw?.batchDraw();
}

function _zoneCancel() { _zoneClear(); showNotif('Zone annulée', 'info'); }

function _zoneRotate() {
  if (!_zoneCtx) return;
  [_zoneCtx.wPx, _zoneCtx.hPx] = [_zoneCtx.hPx, _zoneCtx.wPx];
  _buildZonePreview();
  _zonePreview?.position({ x: _zoneCtx.x, y: _zoneCtx.y });
  VS.layers.token?.batchDraw();
}

async function _zoneValidate() {
  if (!_zoneCtx) return;
  const { srcId, opt, wPx, hPx, x, y } = _zoneCtx;

  // Vérification portée : centre de la zone vs lanceur
  const srcData = VS.tokens[srcId]?.data;
  if (srcData) {
    const sc = _tokenCenter(srcData);
    const distCells = Math.hypot(x - sc.x, y - sc.y) / CELL;
    if (distCells > (opt.portee || 1) + 0.5) {
      showNotif(`Zone hors de portée (${Math.round(distCells)}c — portée : ${opt.portee}c)`, 'error');
      return;
    }
  }

  // Détection des tokens dans la zone (centrée sur x, y). Croix = colonne + rangée centrales.
  const x1 = x - wPx / 2, x2 = x + wPx / 2;
  const y1 = y - hPx / 2, y2 = y + hPx / 2;
  const _isCross = opt.zoneShape === 'cross';
  const _isDiamond = opt.zoneShape === 'diamond';
  const targets = Object.values(VS.tokens)
    .filter(e => {
      if (!e.data || e.data.pageId !== VS.activePage?.id) return false;
      if (e.data.id === srcId) return false;   // le lanceur ne subit JAMAIS sa propre zone
      if (!e.data.visible && !STATE.isAdmin) return false;
      if (opt.friendlyOnly && e.data.type === 'enemy') return false;
      if (opt.hostileOnly && e.data.type !== 'enemy') return false;
      const tc = _tokenCenter(e.data);
      if (tc.x < x1 || tc.x > x2 || tc.y < y1 || tc.y > y2) return false;
      if (_isDiamond) {
        const rx = Math.max(1, wPx / 2);
        const ry = Math.max(1, hPx / 2);
        return Math.abs(tc.x - x) / rx + Math.abs(tc.y - y) / ry <= 1;
      }
      if (!_isCross) return true;
      return Math.abs(tc.x - x) <= CELL / 2 || Math.abs(tc.y - y) <= CELL / 2;
    })
    .map(e => e.data.id);

  // ── Sceau runique + effet de zone (projectile → centre, onde, impacts) ──
  const _zoneSigil = _buildCastSigil(srcData, opt);
  if (_zoneSigil) {
    const _isSummon = _zoneSigil.category === 'summon';
    const _zImpColor = _zoneSigil.category === 'heal' ? '#22c38e' : _zoneSigil.color;
    _playSigilForToken(srcId, _zoneSigil);
    _playZoneFx(srcId, { x, y }, { w: wPx, h: hPx }, targets, _zImpColor, _zoneSigil.physical, _isSummon);
    try {
      const _uid = STATE.user?.uid;
      if (_uid) {
        const _n = Date.now();
        _seenSigilFire[_uid] = _n;
        setDoc(_castingRef(_uid), {
          sigilFire: {
            tokenId: srcId, sigil: _zoneSigil, pageId: VS.activePage?.id || null, n: _n,
            targets, impColor: _zImpColor, physical: _zoneSigil.physical,
            zone: { x, y, w: wPx, h: hPx }, isSummon: _isSummon,
          },
        }, { merge: true }).catch(() => {});
      }
    } catch {}
  }

  // ── Sort « pose de zone » : utilitaire SANS effet appliqué sur cible (Mur de
  //    pierre, ou Affliction « sans état défini »…). Pose UNIQUEMENT un marqueur
  //    visuel persistant qui disparaît après la durée (défaut 2 tours).
  //    Les sorts qui APPLIQUENT un effet au cast (dégâts, soin, enchant/régén, ou
  //    affliction AVEC un état/DoT réel) sont instantanés et ne passent PAS ici.
  const _afflHasEffect = opt.isAffliction && (
    (opt.afflictionMode === 'dot' && String(opt.afflictionDotFormula || '').trim())
    || (opt.afflictionMode === 'etat' && opt.afflictionEtatId)
  );
  // Sorts à effet INSTANTANÉ (dégâts, soin, CA, enchant, régén, affliction-avec-effet) :
  // ils appliquent leur effet aux cibles de la zone et ne laissent PAS de marqueur.
  const _zoneAppliesEffect = opt.isHeal || opt.isRegen || opt.isEnchant || opt.isCaSort || _afflHasEffect;
  if (opt.isUtil && (opt.zoneW > 0 || opt.zoneH > 0) && !_zoneAppliesEffect
      && !opt?.mods?.invocation && !opt?.mods?.sentinelle) {
    const _zid = await _vttPlaceSpellZone(srcId, opt, { x, y, wPx, hPx });
    const srcD = VS.tokens[srcId]?.data;
    const _snap = _captureUndoSnapshot(srcId, []);
    if (_zid) _snap.createdAnnots = [_zid];
    if (srcD) await _vttSpendSpellPm(srcD, opt);
    if (srcD) await _vttStartSpellCooldown(srcD, opt);
    await _vttApplyCasterConcentration(srcId, opt);
    const _statsDelta = srcD ? _applyCastStatsDelta(srcD, opt) : null;
    await addDoc(_logCol(), {
      type: 'cast', undo: _snap,
      ...(_hasStatsDelta(_statsDelta) ? { statsDelta: _statsDelta } : {}),
      ..._vttLogSourceFields(srcD),
      authorId: STATE.user?.uid || null,
      authorName: STATE.profile?.pseudo || STATE.profile?.prenom || STATE.user?.displayName || 'MJ',
      casterName: srcD ? (_live(srcD).displayName ?? srcD.name) : '?',
      characterImage: srcD ? (_live(srcD).displayImage || null) : null,
      targetName: 'zone', optLabel: opt.label,
      castEffect: `${opt.icon || '✨'} ${opt.label} — zone (${opt.sortDuree ?? 2} t)`,
      createdAt: serverTimestamp(),
    }).catch(() => {});
    showNotif(`${opt.icon || '✨'} Zone « ${opt.label} » placée`, 'success');
    _zoneClear();
    return;
  }

  // ── Invocation générique : place la créature à l'emplacement choisi ──
  // (pas d'attaque du lanceur — la créature a ses propres stats/actions)
  if (opt?.mods?.invocation) {
    if (!_zoneCtx.invocationsDone) _summonSpawnIds = []; // 1ère pose → reset collecteur
    const col = Math.round((x - wPx / 2) / CELL);
    const row = Math.round((y - hPx / 2) / CELL);
    const _spawned = await _vttSpawnSummon({ kind: 'invocation', srcId, col, row, opt, durationTurns: opt.mods.invocation.duree || 2 });
    if (_spawned?.id) _summonSpawnIds.push(_spawned.id);
    _zoneCtx.invocationsDone = (_zoneCtx.invocationsDone || 0) + 1;
    const total = _zoneCtx.invocationsTotal || 1;
    const done  = _zoneCtx.invocationsDone;
    if (done < total) {
      showNotif(`🐾 Invocation ${done}/${total} placée — place la suivante`, 'info');
      _zoneCtx.placed = false;
      _zoneCtx.opt = { ..._zoneCtx.opt, label: `${opt.label} (${done + 1}/${total})` };
      _showZoneHud();
      _zonePreview?.position({ x: _zoneCtx.x, y: _zoneCtx.y });
      VS.layers.token?.batchDraw();
      return; // reste en mode placement
    }
    const srcD = VS.tokens[srcId]?.data;
    // Snapshot AVANT déduction PM/concentration + tokens créés → annulable par le MJ.
    const _snap = _captureUndoSnapshot(srcId, []);
    _snap.createdTokens = [..._summonSpawnIds];
    if (srcD) await _vttSpendSpellPm(srcD, opt);
    await _vttApplyCasterConcentration(srcId, opt);
    const _statsDelta = srcD ? _applyCastStatsDelta(srcD, opt) : null;
    await addDoc(_logCol(), {
      type: 'cast', undo: _snap,
      ...(_hasStatsDelta(_statsDelta) ? { statsDelta: _statsDelta } : {}),
      ..._vttLogSourceFields(srcD),
      authorId: STATE.user?.uid || null,
      authorName: STATE.profile?.pseudo || STATE.profile?.prenom || STATE.user?.displayName || 'MJ',
      casterName: srcD ? (_live(srcD).displayName ?? srcD.name) : '?',
      characterImage: srcD ? (_live(srcD).displayImage || null) : null,
      targetName: `${total} invocation${total > 1 ? 's' : ''}`,
      optLabel: opt.label, castEffect: `🐾 ${total} invocation${total > 1 ? 's' : ''} placée${total > 1 ? 's' : ''}`,
      createdAt: serverTimestamp(),
    }).catch(() => {});
    showNotif(`🐾 ${total} invocation${total > 1 ? 's' : ''} placée${total > 1 ? 's' : ''}`, 'success');
    _zoneClear();
    return;
  }

  // ── Combo Sentinelle : spawn d'un token au centre de la zone ────────
  // Le token apparaît même sans cible présente (le piège attend les ennemis)
  // Avec Dispersion, plusieurs sentinelles peuvent être posées en boucle.
  if (opt?.mods?.sentinelle) {
    if (!_zoneCtx.invocationsDone) _summonSpawnIds = []; // 1ère pose → reset collecteur
    const col = Math.round((x - wPx / 2) / CELL);
    const row = Math.round((y - hPx / 2) / CELL);
    const _spawned = await _vttSpawnSummon({ kind: 'sentinelle', srcId, col, row, opt, durationTurns: 2 });
    if (_spawned?.id) _summonSpawnIds.push(_spawned.id);
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
      VS.layers.token?.batchDraw();
      return; // reste en mode placement
    }
    await _vttApplyCasterConcentration(srcId, opt);
    // Snapshot + tokens créés → annulable par le MJ.
    const _srcD = VS.tokens[srcId]?.data;
    const _snap = _captureUndoSnapshot(srcId, []);
    _snap.createdTokens = [..._summonSpawnIds];
    const _statsDelta = !targets.length && _srcD ? _applyCastStatsDelta(_srcD, opt) : null;
    await addDoc(_logCol(), {
      type: 'cast', undo: _snap,
      ...(_hasStatsDelta(_statsDelta) ? { statsDelta: _statsDelta } : {}),
      ..._vttLogSourceFields(_srcD),
      authorId: STATE.user?.uid || null,
      authorName: STATE.profile?.pseudo || STATE.profile?.prenom || STATE.user?.displayName || 'MJ',
      casterName: _srcD ? (_live(_srcD).displayName ?? _srcD.name) : '?',
      characterImage: _srcD ? (_live(_srcD).displayImage || null) : null,
      targetName: `${total} sentinelle${total > 1 ? 's' : ''}`,
      optLabel: opt.label, castEffect: `🪤 ${total} sentinelle${total > 1 ? 's' : ''} posée${total > 1 ? 's' : ''}`,
      createdAt: serverTimestamp(),
    }).catch(() => {});
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
  const src = VS.tokens[srcId]?.data; if (!src) { _mtPending = null; return; }
  if (!VS.tokens[firstTgt]?.data) { _mtPending = null; return; }
  // Le sort zone est mis seul dans le cache à l'index 0 (portée déjà vérifiée sur la zone)
  _atkOptsCache[`${srcId}__${firstTgt}`] = [opt];
  _vttPickOpt(srcId, firstTgt, 0);
}

/** Construit la donnée du sceau {color,runes,category,melee,physical} depuis un
 *  sort du deck (sortIdx numérique), ou null si ce n'est pas un sort. Partagé
 *  entre le cast ciblé (_vttPickOpt) et le cast à zone (_zoneValidate). */
function _buildCastSigil(src, opt) {
  try {
    const char  = _characterForToken(src);
    const spell = (typeof opt.sortIdx === 'number') ? char?.deck_sorts?.[opt.sortIdx] : null;
    if (!spell) return null;
    const elem  = opt.element || spell.noyauTypeId || opt.damageTypeId || null;
    const color = (elem && getDamageTypeById(VS.damageTypes, elem)?.color) || opt.damageTypeColor || null;
    if (!color) return null;
    let cat = 'attack';
    if (opt.isHeal) cat = 'heal';
    else if (opt.mods?.invocation) cat = 'summon';
    else if (opt.mods?.affliction) cat = 'affliction';
    else if (opt.mods && (opt.mods.enchantArmeDmg || opt.mods.enchantToucher || opt.mods.enchantMove || opt.mods.enchantPieds || opt.mods.enchantGeneric)) cat = 'buff';
    return { color, runes: spell.runes || [], category: cat,
             melee: (parseInt(opt.portee) || 1) <= 1, physical: (elem === 'physique') };
  } catch { return null; }
}

/** Effet de cast À ZONE : projectile lanceur→centre, onde au centre, impacts sur
 *  les cibles touchées (sauf invocation). center/zonePx en coords Konva. */
// ── Effets de sort (sceau/impact/projectile) ────────────────────────────────
// Overlays DOM placés en coords LOGIQUES (comme les tokens) dans .vtt-sigil-layer ;
// ce calque suit en continu le transform du layer Konva (rAF tant qu'un effet est
// actif) → les effets restent ancrés sous les tokens au pan ET au zoom.
// Synchronise le transform du calque d'effets DOM sur celui du layer Konva, pour
// que les effets (sceau/impact/projectile) suivent pan ET zoom. Appelé à chaque
// effet (pose initiale) + abonné aux évènements de transform du stage (au montage,
// cf. l'abonnement après VS.stage = new K.Stage…).
function _syncSigilLayer() {
  const layer = VS.stage?.container()?.querySelector('.vtt-sigil-layer');
  if (!layer || !VS.layers?.token) return;
  const m = VS.layers.token.getAbsoluteTransform().getMatrix();
  layer.style.transform = `matrix(${m[0]},${m[1]},${m[2]},${m[3]},${m[4]},${m[5]})`;
}
function _ensureSigilSync() { _syncSigilLayer(); }

/** Données token depuis un id (clé directe ou recherche par data.id). */
function _tokenDataById(tokenId) {
  return (VS.tokens[tokenId]?.data) ? VS.tokens[tokenId].data
       : Object.values(VS.tokens).find(e => e?.data?.id === tokenId)?.data || null;
}
function _tokenFxIsVisible(tokenId) {
  if (STATE.isAdmin) return true;
  const entry = VS.tokens[tokenId]
    || Object.values(VS.tokens).find(e => e?.data?.id === tokenId);
  return !!entry?.shape?.isVisible();
}
/** Centre LOGIQUE d'un token (coords Konva) + taille de cellule logique. */
function _tokenLogicalCenter(data) {
  const c = _tokenCenter(data);
  const dims = _tokenDims(data);
  return { x: c.x, y: c.y, cellPx: Math.max(dims.w, dims.h) * CELL };
}

/** Effet de cast à ZONE : projectile lanceur→centre, onde, impacts (coords logiques). */
function _playZoneFx(srcId, center, zonePx, targetIds, color, physical, isSummon) {
  try {
    const cont = VS.stage?.container();
    const src = _tokenDataById(srcId);
    const srcVisible = src && _tokenFxIsVisible(srcId);
    const visibleTargets = (targetIds || []).filter(_tokenFxIsVisible);
    if (!srcVisible && !visibleTargets.length) return;
    if (srcVisible) {
      const sp = _tokenLogicalCenter(src);
      playProjectile(cont, sp.x, sp.y, center.x, center.y, { color, physical });
    }
    playImpact(cont, center.x, center.y, Math.max(zonePx?.w || 0, zonePx?.h || 0, CELL) * 1.15, color);
    _ensureSigilSync();
    if (!isSummon) visibleTargets.forEach(tid => _playImpactForToken(tid, color));
  } catch (e) { console.warn('[zonefx]', e); }
}

// Sceaux déjà rejoués (par uid → dernier n) pour ne pas rejouer un même cast.
let _seenSigilFire = {};

/** Joue le sceau runique sur un token (coords logiques → suit pan/zoom). */
function _playSigilForToken(tokenId, sigil) {
  if (!sigil || !_tokenFxIsVisible(tokenId)) return;
  const data = _tokenDataById(tokenId); if (!data) return;
  try {
    const lc = _tokenLogicalCenter(data);
    playSigil(VS.stage?.container(), lc.x, lc.y, lc.cellPx * 3, sigil);
    _ensureSigilSync();
  } catch (e) { console.warn('[sigil]', e); }
}
/** Effet de cast sur une cible : projectile (distance) ou frappe (CaC) + impact. */
function _playCastTargetFx(srcId, tid, color, melee, physical) {
  const tgt = _tokenDataById(tid); if (!tgt || !_tokenFxIsVisible(tid)) return;
  try {
    const cont = VS.stage?.container();
    const tp = _tokenLogicalCenter(tgt);
    const src = _tokenDataById(srcId);
    const srcVisible = src && _tokenFxIsVisible(srcId);
    if (!srcVisible) {
      _playImpactForToken(tid, color);
      return;
    }
    if (melee) {
      playSlash(cont, tp.x, tp.y, Math.max(60, tp.cellPx * 1.5), color);
    } else {
      const sp = _tokenLogicalCenter(src);
      playProjectile(cont, sp.x, sp.y, tp.x, tp.y, { color, physical });
    }
    _ensureSigilSync();
  } catch (e) { console.warn('[castfx]', e); }
  _playImpactForToken(tid, color);
}
/** Éclat d'impact coloré sur un token (coords logiques → suit pan/zoom). */
function _playImpactForToken(tokenId, color) {
  if (!color || !_tokenFxIsVisible(tokenId)) return;
  const data = _tokenDataById(tokenId); if (!data) return;
  try {
    const lc = _tokenLogicalCenter(data);
    playImpact(VS.stage?.container(), lc.x, lc.y, lc.cellPx * 1.6, color);
    _ensureSigilSync();
  } catch (e) { console.warn('[impact]', e); }
}

/** Rendu des lignes de ciblage distantes (broadcast Firestore). */
function _renderRemoteCastings(docs, prime = false) {
  if (!VS.layers.token) return;
  _clearRemoteLines();
  const myUid = STATE.user?.uid;
  docs.forEach(d => {
    const c = d.data();
    // Sceau runique diffusé : rejoué chez les autres au déclenchement (indépendant
    // des lignes de visée ; clé = n unique pour ne jouer qu'une fois par cast).
    const sf = c.sigilFire;
    if (sf && sf.n && sf.pageId === VS.activePage?.id && _seenSigilFire[d.id] !== sf.n) {
      _seenSigilFire[d.id] = sf.n;   // dédup par n : l'onglet du lanceur l'a déjà → ignoré
      // Amorce (1er snapshot) : on marque vu mais on NE rejoue PAS les anciens casts.
      if (!prime) {
        _playSigilForToken(sf.tokenId, sf.sigil);
        if (sf.zone) {
          _playZoneFx(sf.tokenId, { x: sf.zone.x, y: sf.zone.y }, { w: sf.zone.w, h: sf.zone.h }, sf.targets || [], sf.impColor, !!sf.physical, !!sf.isSummon);
        } else {
          (sf.targets || []).forEach(tid => _playCastTargetFx(sf.tokenId, tid, sf.impColor, !!sf.melee, !!sf.physical));
          if (sf.selfAura) _playImpactForToken(sf.tokenId, sf.impColor);
        }
      }
    }
    if (!c.active || c.pageId !== VS.activePage?.id || d.id === myUid) return;
    const srcEntry = Object.values(VS.tokens).find(e => e.data?.id === c.srcId);
    if (!srcEntry) return;
    (c.targets || []).forEach(tgtId => {
      const tgtEntry = Object.values(VS.tokens).find(e => e.data?.id === tgtId);
      if (!tgtEntry) return;
      const K = window.Konva;
      const s = _tokenCenter(srcEntry.data), t = _tokenCenter(tgtEntry.data);
      const line = new K.Line({
        points: [s.x, s.y, t.x, t.y],
        stroke: '#4f8cff', strokeWidth: 2,
        dash: [10, 6], lineCap: 'round',
        opacity: 0.55, listening: false, name: 'remote-mt-line',
      });
      VS.layers.token.add(line);
    });
  });
  VS.layers.token.batchDraw();
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
  const src=VS.tokens[srcId]?.data, tgt=VS.tokens[tgtId]?.data;
  if (!src||!tgt) return;

  // Liste des cibles : multi si allTargets, sinon cible unique
  const targetIds = allTargets && allTargets.length > 0 ? allTargets : [tgtId];

  // Sceau runique signature sur le lanceur — joué localement ET diffusé à tous
  // les joueurs via le canal casting (champ sigilFire, keyé par n unique).
  // ⚠ Doit rester APRÈS la déclaration de targetIds (sinon zone morte temporelle).
  if (ctx.sigil) {
    _playSigilForToken(srcId, ctx.sigil);
    const _impColor = ctx.sigil.category === 'heal' ? '#22c38e' : ctx.sigil.color;
    const _melee = ctx.sigil.category === 'heal' ? false : !!ctx.sigil.melee;  // pas de "frappe" pour un soin
    const _physical = !!ctx.sigil.physical;
    const _self = targetIds.includes(srcId);   // sort sur soi (buff/soin perso) → aura, pas de projectile
    for (const tid of targetIds) {
      if (tid === srcId) _playImpactForToken(srcId, _impColor);          // aura sur le lanceur
      else _playCastTargetFx(srcId, tid, _impColor, _melee, _physical);
    }
    try {
      const _uid = STATE.user?.uid;
      if (_uid) {
        const _n = Date.now();
        _seenSigilFire[_uid] = _n;   // marque comme déjà joué localement → pas de double sur cet onglet
        setDoc(_castingRef(_uid), {
          sigilFire: {
            tokenId: srcId, sigil: ctx.sigil, pageId: VS.activePage?.id || null, n: _n,
            targets: targetIds.filter(t => t !== srcId), impColor: _impColor,
            melee: _melee, physical: _physical, selfAura: _self,
          },
        }, { merge: true }).catch(() => {});
      }
    } catch {}
  }
  // Snapshot pré-action pour l'annulation MJ (attaché aux logs de l'action).
  const _undoSnap = _captureUndoSnapshot(srcId, targetIds);

  const authorName = STATE.profile?.pseudo||STATE.profile?.prenom||STATE.user?.displayName||'MJ';
  let _preAppliedCastStatsDelta = null;
  // Payeur du mana : un token convoqué (invocation) n'a pas de PM propre — ses
  // sorts/actions sont payés sur le personnage du LANCEUR (summonOwnerId).
  const _srcChar = _characterForToken(src);
  const _ownerTok = src.summonOwnerId ? VS.tokens[src.summonOwnerId]?.data : null;
  const _pmPayerCharId = src.summonOwnerCharId || _srcChar?.id || (_ownerTok ? _characterForToken(_ownerTok)?.id : null);
  const _deductPm  = async () => {
    if (opt.pmCost <= 0) return;
    if (_pmPayerCharId) {
      const c = VS.characters[_pmPayerCharId];
      if (c) await updateDoc(_chrRef(_pmPayerCharId), {
        ..._charPmPatch(Math.max(0, _charPmCur(c) - opt.pmCost)),
        vttControlTokenId: src.id,
      });
      return;
    }
    // Créature du bestiaire avec mana : déduit du token. `pm` = PM réels (vus du
    // MJ), `pmCombat` = suivi public pour l'estimation joueur (la jauge baisse).
    const _beastPmMax = _numOr(VS.bestiary[src.beastId]?.pmMax, 0);
    if (src.beastId && _beastPmMax > 0) {
      const curPm  = src.pm != null ? src.pm : _beastPmMax;
      const curCmb = src.pmCombat != null ? src.pmCombat : _beastPmMax;
      await updateDoc(_tokRef(srcId), {
        pm: Math.max(0, curPm - opt.pmCost),
        pmCombat: Math.max(0, curCmb - opt.pmCost),
      }).catch(() => {});
    }
  };
  // Consomme 1 exemplaire de l'objet si l'option vient d'un item-action marqué `consommable`.
  // Convention "1 entrée = 1 unité" → on retire la 1ère entrée correspondante.
  // Ré-évaluation par itemId (l'index peut s'être déplacé entre build et usage).
  const _consumeItem = async () => {
    const meta = opt._itemAction;
    if (!meta?.consommable || !_srcChar?.id) return;
    const c = VS.characters[_srcChar.id] || _srcChar;
    const inv = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
    let idx = -1;
    if (meta.itemId)  idx = inv.findIndex(it => it?.itemId === meta.itemId);
    if (idx < 0 && meta.itemNom) idx = inv.findIndex(it => it?.nom === meta.itemNom);
    if (idx < 0) return; // déjà consommé
    inv.splice(idx, 1);
    await updateDoc(_chrRef(_srcChar.id), { inventaire: inv }).catch(() => {});
    showNotif(`🧪 ${meta.itemNom || 'Objet'} consommé`, 'info');
  };
  const _markActionUsed = async () => {
    if (!VS.session?.combat?.active) return;
    const field = opt.actionType === 'bonus'
      ? 'bonusActionThisTurn'
      : opt.actionType === 'reaction'
        ? 'reactionThisTurn'
        : 'attackedThisTurn';
    const patch = { [field]: true };
    const spellCooldowns = _vttCooldownPatch(src, opt);
    if (spellCooldowns) {
      patch.spellCooldowns = spellCooldowns;
      src.spellCooldowns = spellCooldowns;
    }
    await updateDoc(_tokRef(src.id), patch).catch(()=>{});
  };
  const _cleanup = () => {
    VS.tokens[srcId]?.shape?.findOne('.atk')?.visible(false);
    VS.tokens[VS.selected]?.shape?.findOne('.sel')?.visible(false);
    _hideActBar(); _clearAim();
    VS.selected=null; _attackSrc=null; _clearHL(); _renderInspector(null);
    VS.layers.token?.batchDraw();
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
      const cPm = VS.characters[_pmPayerCharId];
      if (cPm) {
        const actualPm = _charPmCur(cPm);
        if (actualPm < opt.pmCost) {
          const _who = src.summonOwnerId ? ' du lanceur' : '';
          showNotif(`⚠ PM insuffisants${_who} (${actualPm}/${opt.pmCost} requis)`, 'error');
          return;
        }
      }
    }

    // ── Combo Sort suspendu ──────────────────────────────────────────────
    // 1er cast : on STOCKE le sort (PM payé) sans exécuter l'effet. Une version
    // GRATUITE du sort apparaît alors directement dans la liste d'actions
    // (cf. hasSuspendedBuff dans _buildAttackOptions).
    // Cast de la version gratuite (le buff existe) : on consomme le buff puis on
    // laisse l'exécution onHit normale suivre — pas de re-suspension.
    if (opt.mods?.sortSuspendu) {
      const _suspMatch = (b) => b.type === 'suspended_spell'
        && ((b.spellId && opt.spellId) ? b.spellId === opt.spellId : b.sortIdx === opt.sortIdx);
      const alreadySuspended = (src.buffs || []).some(_suspMatch);
      if (!alreadySuspended) {
        await _deductPm();
        // Durée de stockage pilotée par le combo (2 tours + 2 par rune Durée),
        // indépendante de la durée d'effet du sort (qui est instantané : onHit).
        const graceTurns = opt.mods.sortSuspendu.graceTurns || 2;
        const round = VS.session?.combat?.round ?? 0;
        const baseRound = Math.max(1, round);
        const sharedSusp = _buffShared(opt, srcId);
        const suspBuff = {
          ...sharedSusp,
          type: 'suspended_spell',
          sortIdx: opt.sortIdx ?? null,
          spellId: opt.spellId ?? null,   // id STABLE : survit au réordonnancement du Grimoire
          icon: '🔮',
          totalDuration: graceTurns,
          expiresAtRound: baseRound + graceTurns - 1,
        };
        const existing = (src.buffs || []).filter(b => !(b.type === 'suspended_spell' && b.sortLabel === opt.label));
        await updateDoc(_tokRef(srcId), { buffs: [...existing, suspBuff] }).catch(() => {});
        showNotif(`🔮 ${opt.label} suspendu — version gratuite dispo dans tes sorts (${graceTurns} tours)`, 'success');
        _cleanup();
        return;
      }
      // Version gratuite : retire le buff (consommé), puis l'effet onHit s'exécute
      // normalement (coût déjà 0). Pas de return → on continue le flux d'attaque.
      const remaining = (src.buffs || []).filter(b => !_suspMatch(b));
      await updateDoc(_tokRef(srcId), { buffs: remaining }).catch(() => {});
    }

    // ── Combo Coup de chance : applique le buff lucky_reroll à l'allié ciblé ──
    if (opt.mods?.coupChance) {
      await _deductPm();
      await _consumeItem();
      await _markActionUsed();
      const sharedLuck = _buffShared(opt, srcId);
      const luckBuff = {
        ...sharedLuck,
        type: 'lucky_reroll',
        charges: opt.mods.coupChance.charges,
        icon: '🍀',
        totalDuration: null,
        expiresAtRound: null,
      };
      const appliedTargets = [];
      for (const tid of targetIds) {
        const td = VS.tokens[tid]?.data;
        if (!td || td.type === 'enemy') continue;
        const existing = (td.buffs || []).filter(b => !(b.type === 'lucky_reroll' && b.sortLabel === opt.label));
        await updateDoc(_tokRef(tid), { buffs: [...existing, luckBuff] }).catch(() => {});
        appliedTargets.push(_live(td).displayName ?? td.name);
      }
      if (!appliedTargets.length) {
        showNotif('Choisis un allié pour Coup de chance.', 'error');
        _cleanup();
        return;
      }
      await _vttApplyCasterConcentration(srcId, opt);
      const targetsLabel = appliedTargets.join(', ');
      await addDoc(_logCol(), {
        type: 'cast',
        undo: _undoSnap,
        ..._vttLogSourceFields(src),
        ..._vttLogSingleTargetFields(targetIds),
        authorId: STATE.user?.uid||null, authorName,
        casterName: lS.displayName??src.name,
        characterImage: lS.displayImage||null,
        targetName: targetsLabel,
        optLabel: opt.label, pmCost: opt.pmCost,
        castEffect: '🍀 1 relance automatique sur le prochain jet échoué',
        createdAt: serverTimestamp(),
      }).catch(()=>{});
      showNotif(`🍀 ${opt.label} → ${targetsLabel} — prochaine relance automatique prête`, 'success');
      _cleanup();
      return;
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
      await _vttApplyCasterConcentration(srcId, opt);
      showNotif(`⚔️ ${wrBuff.weaponName} équipée (${armDice})`, 'success');
    }

    // ── Enchantement : jet de d20 pour Réussite / Échec critique ────────────
    // Un enchantement (buff allié) ne vise pas une CA, mais on lance quand même
    // un d20 :
    //  • Échec critique (1 naturel) → le sort ÉCHOUE, le mana est tout de même perdu.
    //  • Réussite critique (20 nat, ou seuil abaissé par la rune Chance) → signalée.
    // (avantage/désavantage du lanceur pris en compte, relance chanceuse sur un 1.)
    let _enchD20 = null, _enchRC = false;
    if (opt.isEnchant) {
      let eMode = mode;
      const eCondMods = _conditionsAttackMods(src, null, opt);
      if (eMode === 'normal') {
        if (eCondMods.hasAdv && !eCondMods.hasDis) eMode = 'adv';
        else if (eCondMods.hasDis && !eCondMods.hasAdv) eMode = 'dis';
      }
      const eR1 = Math.floor(Math.random()*20)+1;
      const eR2 = eMode !== 'normal' ? Math.floor(Math.random()*20)+1 : null;
      _enchD20 = eMode === 'adv' ? Math.max(eR1, eR2) : eMode === 'dis' ? Math.min(eR1, eR2) : eR1;
      const eLuck = await _consumeLuckyReroll(srcId, src, _enchD20, _enchD20 === 1);
      if (eLuck) _enchD20 = eLuck.d20;
      const eCritThreshold = Math.max(2, Math.min(20, (opt.mods?.chance?.rc ?? 20) - _conditionCritRangeBonusOf(src)));
      _enchRC = _enchD20 >= eCritThreshold;

      if (_enchD20 === 1) {
        // Échec critique : le sort ne se lance pas, mais le mana est perdu.
        await _deductPm();
        await _consumeItem();
        await _markActionUsed();
        const ecTgt = targetIds.map(id => { const td = VS.tokens[id]?.data; return td ? (_live(td).displayName ?? td.name) : null; })
          .filter(Boolean).join(', ') || (lT?.displayName ?? tgt?.name ?? '');
        await addDoc(_logCol(), {
          type: 'cast', undo: _undoSnap,
          ..._vttLogSourceFields(src),
          ..._vttLogSingleTargetFields(targetIds),
          authorId: STATE.user?.uid||null, authorName,
          casterName: lS.displayName??src.name,
          characterImage: lS.displayImage||null,
          targetName: ecTgt,
          optLabel: opt.label, pmCost: opt.pmCost,
          castEC: true,
          castEffect: `💔 Échec critique (d20 = 1) — sort raté${opt.pmCost>0?`, ${opt.pmCost} PM perdus`:''}`,
          createdAt: serverTimestamp(),
        }).catch(()=>{});
        showNotif(`💔 Échec critique ! ${opt.label} raté${opt.pmCost>0?` — ${opt.pmCost} PM perdus`:''}`, 'error');
        _cleanup();
        return;
      }
    }

    // ── Enchantements (Dégâts, État, Toucher, Déplacement, slots) : buffs / états sur alliés ──
    if (opt.mods?.enchantArmeDmg || opt.mods?.enchantPieds || opt.mods?.enchantGeneric
        || opt.mods?.enchantEtatId || opt.mods?.enchantToucher || opt.mods?.enchantMove) {
      await _vttApplyEnchantBuffs(srcId, allTargets && allTargets.length ? allTargets : [tgtId], opt);
      await _vttApplyCasterConcentration(srcId, opt);
    }

    // ── Afflictions : JS Sa de la cible, buff (DoT, débuff mouvement, etc.) sur échec ──
    if (opt.mods?.affliction) {
      if (opt.isCaSort || opt.isUtil) _preAppliedCastStatsDelta = _applyCastStatsDelta(src, opt);
      await _vttApplyAfflictions(srcId, allTargets && allTargets.length ? allTargets : [tgtId], opt, {
        undo: _undoSnap,
        statsDelta: _hasStatsDelta(_preAppliedCastStatsDelta) ? _preAppliedCastStatsDelta : null,
      });
      await _vttApplyCasterConcentration(srcId, opt);
    }

    // ── CA / Utilitaire : consommer PM, appliquer buff, loguer ─────────
    if (opt.isCaSort || opt.isUtil) {
      // Bouclier réactif (Réaction + Protection) : PAS de cast direct ni de buff
      // de CA. Il s'utilise en RÉACTION depuis le chat, sur le coup reçu à
      // annuler (bouton « 🛡 Annuler »). Les PM sont consommés à ce moment-là.
      if (opt.mods?.bouclierReactif) {
        showNotif('🛡 Bouclier réactif : clique « Annuler » sur le coup reçu dans le chat', 'info');
        _cleanup();
        return;
      }
      await _deductPm();
      await _consumeItem();
      await _markActionUsed();
      const rCa = _handleMultiCast();
      const _utilStatsDelta = _preAppliedCastStatsDelta || _applyCastStatsDelta(src, opt);


      // Appliquer le buff CA sur chaque cible
      const buffResults = [];
      if (opt.isCaSort) {
        const round = VS.session?.combat?.round ?? 0;
        const dur   = opt.mods?.concentration ? 10 : (opt.sortDuree ?? null);
        const baseRound = Math.max(1, round); // traiter round 0 comme round 1
        // Canalisé persistant : pas d'expiration automatique (jusqu'à rupture concentration)
        const isCanalise = !!opt.mods?.canalisePersistant;
        // Firestore : pas de `undefined` → spread conditionnel pour les champs facultatifs
        const _canFields = isCanalise ? { canalisePersistant: true } : {};
        const newBuff = {
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
          const curTgtData = VS.tokens[curTgtId]?.data; if (!curTgtData) continue;
          // Filtre les buffs existants du même sort (anti-stack)
          const existingBuffs = (curTgtData.buffs || []).filter(b => !(b.type === buffType && b.sortLabel === opt.label));
          await updateDoc(_tokRef(curTgtId), { buffs: [...existingBuffs, newBuff] }).catch(()=>{});
          buffResults.push(_live(curTgtData).displayName ?? curTgtData.name);
        }
        if (buffResults.length) await _vttApplyCasterConcentration(srcId, opt);
      }

      const targetsLabel = targetIds
        .map(id => {
          const td = VS.tokens[id]?.data;
          return td ? (_live(td).displayName ?? td.name) : null;
        })
        .filter(Boolean)
        .join(', ') || (buffResults.length ? buffResults.join(', ') : (lT.displayName ?? tgt.name));

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
        // Résultat du jet de cast (RC/EC) devant l'effet.
        if (_enchD20 != null) castEffect = `🎲 ${_enchD20}${_enchRC ? ' 💥 RC' : ''} · ${castEffect}`;
      }

      // Log "cast" générique : sauté pour les afflictions (déjà loggées via
      // 'affliction-cast' AVANT, suivi du save log et de l'application).
      // Évite le doublon trompeur "Brulure activé!" qui suggère un succès
      // alors que le JS pourrait avoir réussi.
      if (!opt.isAffliction) {
        await addDoc(_logCol(), {
          type: 'cast',
          undo: _undoSnap,
          ...(_hasStatsDelta(_utilStatsDelta) ? { statsDelta: _utilStatsDelta } : {}),
          ..._vttLogSourceFields(src),
          ..._vttLogSingleTargetFields(targetIds),
          authorId: STATE.user?.uid||null, authorName,
          casterName: lS.displayName??src.name,
          characterImage: lS.displayImage||null,
          targetName: targetsLabel,
          optLabel: opt.label, pmCost: opt.pmCost,
          castEffect,
          createdAt: serverTimestamp(),
        }).catch(()=>{});
      }

      // Le proc immédiat de Régénération doit apparaître après l'annonce du sort
      // dans le chat, comme le DoT d'affliction.
      if (opt.mods?.regeneration) {
        await _vttApplyRegeneration(srcId, allTargets && allTargets.length ? allTargets : [tgtId], opt);
        await _vttApplyCasterConcentration(srcId, opt);
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
      // Total : d20 + mod toucher + bonus set + bonus contextuel
      const hTouchMod = opt.toucherMod || 0;
      const hSetBon   = opt.toucherSetBonus || 0;
      let hD20   = hMode === 'adv' ? Math.max(hRoll1, hRoll2)
                 : hMode === 'dis' ? Math.min(hRoll1, hRoll2)
                 : hRoll1;
      let hHitTotal = hD20 + hTouchMod + hSetBon + bonusHit;
      const hLuck = await _consumeLuckyReroll(srcId, src, hD20, hD20 === 1 || hHitTotal < HEAL_DD);
      if (hLuck) {
        hD20 = hLuck.d20;
        hHitTotal = hD20 + hTouchMod + hSetBon + bonusHit;
      }
      // Combo Chance : élargit la plage critique (RC abaissé sur le sort)
      const hCritThreshold = Math.max(2, Math.min(20, (opt.mods?.chance?.rc ?? 20) - _conditionCritRangeBonusOf(src)));
      const hIsCrit   = hD20 >= hCritThreshold;
      const hIsFumble = hD20 === 1;

      const diceToRoll   = opt.rawDice || opt.dice;
      const effectiveDice = _effectiveDmgDice(diceToRoll);
      const healFixed    = (opt.maitriseBonus || 0) + bonusDmg;

      // PM toujours consommé (même sur échec critique) — le mana brûle quand on tente le sort
      await _deductPm();
      await _consumeItem();
      await _markActionUsed();

      // ── Échec critique : sort raté, aucun soin appliqué ─────────────
      if (hIsFumble) {
        const tgtNames = targetIds.map(tid => _live(VS.tokens[tid]?.data || {}).displayName).filter(Boolean).join(', ');
        // Stats : soin raté → compte quand même 1 sort lancé + PM (soin 0), réversible.
        const _healDelta = { chars: {} };
        const _healActor = _statsActor(src);
        if (_healActor.id) {
          accCastDelta(_healDelta, { casterId: _healActor.id, casterName: _healActor.name, spellName: opt.label || 'Soin', pm: opt.pmCost || 0, heal: 0 });
          applyStatsDelta(_healDelta, +1);
        }
        await addDoc(_logCol(), {
          type: 'attack', isHeal: true, isFumble: true, advMode: hMode, advAuto: hMode !== mode,
          advReasons: hMode !== mode ? hCondMods.reasons : null,
          undo: _undoSnap,
          statsDelta: _healDelta,
          ..._vttLogSourceFields(src),
          authorId: STATE.user?.uid||null, authorName,
          attackerName: lS.displayName??src.name,
          characterImage: lS.displayImage||null,
          defenderName: tgtNames || (lT.displayName??tgt.name),
          optLabel: opt.label,
          hitD20: hD20, hitRoll1: hRoll1, hitRoll2: hRoll2,
          hitD20rolls: hLuck ? [hRoll1, ...(hRoll2 != null ? [hRoll2] : []), hLuck.reroll] : (hRoll2 != null ? [hRoll1, hRoll2] : null),
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
      let healRollsDetail = null;
      let healCritRollsDetail = null;
      let healCritNormalMax = 0;
      if (opt.mjAlwaysMax) {
        // Valeur max garantie (potion 1d6+4 → toujours 10, etc.)
        const maxDice = _maxDice(effectiveDice);
        healRaw   = maxDice;
        healTotal = Math.max(1, maxDice + healFixed);
      } else if (hIsCrit) {
        const maxDice = _maxDice(effectiveDice);
        healCritNormalMax = maxDice + healFixed;
        const baseDet = _rollDiceDetailed(effectiveDice);
        healRaw = baseDet.total;
        healRollsDetail = {
          rolls: baseDet.rolls, sides: baseDet.sides, mod: baseDet.mod,
          n: baseDet.n, formula: baseDet.formula,
        };
        const critDet = _rollCritExtraDieDetailed(effectiveDice, { maximize: !!opt.mods?.chance });
        const critRoll = critDet.total;
        healCritRollsDetail = critDet?.rolls?.length ? {
          rolls: critDet.rolls, sides: critDet.sides, mod: critDet.mod,
          n: critDet.n, formula: critDet.formula,
        } : null;
        healTotal = Math.max(1, calcCriticalEffectTotal({
          baseRoll: healRaw,
          diceMax: maxDice,
          critRoll,
          fixedBonus: healFixed,
        }));
      } else {
        const det = _rollDiceDetailed(effectiveDice);
        healRaw   = det.total;
        healRollsDetail = {
          rolls: det.rolls, sides: det.sides, mod: det.mod,
          n: det.n, formula: det.formula,
        };
        healTotal = Math.max(1, healRaw + healFixed);
      }

      // Appliquer à chaque cible
      const healResults = [];
      let _healActual = 0;   // soin RÉEL cumulé (hors surplus au-delà du max) pour les stats
      for (const curTgtId of targetIds) {
        const curTgtData = VS.tokens[curTgtId]?.data; if (!curTgtData) continue;
        const lCur = _live(curTgtData);
        const curHp = lCur.displayHp ?? 20, hpMax = lCur.displayHpMax ?? 20;
        const newHp = Math.min(hpMax, curHp + healTotal);
        _healActual += Math.max(0, newHp - curHp);
        await _setHp(curTgtData, newHp);
        healResults.push({
          name: lCur.displayName ?? curTgtData.name,
          newHp, hpMax,
          characterId: curTgtData.characterId || null,
          npcId: curTgtData.npcId || null,
          beastId: curTgtData.beastId || null,
          targetImage: lCur.displayImage || null,
        });
      }
      // Statistiques (soin) : 1 sort lancé + PM + soin réel, réversible à l'annulation.
      const _healDelta = { chars: {} };
      const _healActor = _statsActor(src);
      if (_healActor.id) {
        accCastDelta(_healDelta, { casterId: _healActor.id, casterName: _healActor.name, spellName: opt.label || 'Soin', pm: opt.pmCost || 0, heal: _healActual });
        applyStatsDelta(_healDelta, +1);
      }

      const isMultiHeal = healResults.length > 1;
      const critTag = hIsCrit ? ' 💥 CRITIQUE' : '';
      const luckTag = hLuck ? ` 🍀 Relance ${hLuck.reroll}→${hD20}` : '';
      // Payload commun pour le log (jet de toucher détaillé)
      const hitPayload = {
        isCrit: hIsCrit, isFumble: false, advMode: hMode, advAuto: hMode !== mode,
        advReasons: hMode !== mode ? hCondMods.reasons : null,
        hitD20: hD20, hitRoll1: hRoll1, hitRoll2: hRoll2,
        hitD20rolls: hLuck ? [hRoll1, ...(hRoll2 != null ? [hRoll2] : []), hLuck.reroll] : (hRoll2 != null ? [hRoll1, hRoll2] : null),
        hitToucherMod: hTouchMod, hitToucherSetBonus: hSetBon,
        hitToucherStatLabel: opt.toucherStatLabel || '',
        hitBonus: bonusHit, hitTotal: hHitTotal, healDD: HEAL_DD,
      };

      if (isMultiHeal) {
        await addDoc(_logCol(), {
          type: 'attack-multi', isHeal: true,
          undo: _undoSnap,
          statsDelta: _healDelta,
          ..._vttLogSourceFields(src),
          authorId: STATE.user?.uid||null, authorName,
          attackerName: lS.displayName??src.name,
          characterImage: lS.displayImage||null,
          optLabel: opt.label,
          ...hitPayload,
          dmgFormula: opt.dice, dmgRawDice: opt.rawDice||null,
          dmgEffectiveDice: bonusDmgDice ? effectiveDice : null,
          dmgMaitriseBonus: opt.maitriseBonus??0,
          dmgRaw: healRaw, dmgBonus: bonusDmg, dmgBonusDice: bonusDmgDice||null,
          dmgRollsDetail: healRollsDetail || null,
          critRollsDetail: healCritRollsDetail || null,
          critFormula: criticalEffectFormulaLabel(),
          ..._diceLogFields('dmg', healRollsDetail),
          ..._diceLogFields('crit', healCritRollsDetail),
          critNormalMax: healCritNormalMax || 0,
          targets: healResults.map(r => ({ ...r, hit: true, halfDmg: false, dmgTotal: healTotal, targetCA: HEAL_DD })),
          createdAt: serverTimestamp(),
        }).catch(()=>{});
        showNotif(`💚${critTag}${luckTag} ${healTotal} PV soignés → ${healResults.map(r=>r.name).join(', ')}`, 'success');
      } else {
        const r = healResults[0];
        if (r) {
          await addDoc(_logCol(), {
            type:'attack', isHeal:true,
            undo: _undoSnap,
            statsDelta: _healDelta,
            ..._vttLogSourceFields(src),
            authorId: STATE.user?.uid||null, authorName,
            attackerName: lS.displayName??src.name,
            characterImage: lS.displayImage||null,
            defenderName: r.name,
            defenderImage: _live(tgt)?.displayImage || null,
            characterId: tgt?.characterId || null,
            npcId: tgt?.npcId || null,
            beastId: tgt?.beastId || null,
            optLabel: opt.label,
            ...hitPayload,
            dmgFormula: opt.dice, dmgRawDice: opt.rawDice||null,
            dmgEffectiveDice: bonusDmgDice ? effectiveDice : null,
            dmgMaitriseBonus: opt.maitriseBonus??0,
            dmgRaw: healRaw, dmgBonus: bonusDmg, dmgBonusDice: bonusDmgDice||null,
            dmgRollsDetail: healRollsDetail || null,
            critRollsDetail: healCritRollsDetail || null,
            critFormula: criticalEffectFormulaLabel(),
            ..._diceLogFields('dmg', healRollsDetail),
            ..._diceLogFields('crit', healCritRollsDetail),
            critNormalMax: healCritNormalMax || 0,
            dmgTotal: healTotal, newHp: r.newHp, hpMax: r.hpMax,
            createdAt: serverTimestamp(),
          }).catch(()=>{});
          showNotif(`💚${critTag}${luckTag} ${healTotal} PV soignés → ${r.name}`, 'success');
        }
      }
      return;
    }

    // ── Bouclier réactif : plus d'auto-blocage. L'attaque TOUCHE normalement ;
    // le porteur d'un bouclier adapté pourra ANNULER l'attaque depuis le chat
    // (rend les PV, consomme 1 charge, PM non remboursés) — cf.
    // _vttShieldCancelAttack. On ne garde que le rang de l'attaquant pour le log.
    const attackerRank = _attackerRank(src);
    const blockedTargets = new Set(); // conservé vide (isBlocked toujours false)

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
    // RC = rc du sort (rune Chance) abaissée par l'état « Chanceux » de l'attaquant,
    // plancher 17. Le crit reste normal (max + relance) — le double-max n'est pas ici.
    const critThreshold = Math.max(2, Math.min(20, (opt.mods?.chance?.rc ?? 20) - _conditionCritRangeBonusOf(src)));
    let isCrit   = d20 >= critThreshold;
    let isFumble = d20 === 1;

    let luckUsed = false;
    let luckRerollValue = null;
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
    let hitTotal = d20 + atkBase + bonusHit + extraHitSum + _touchBuff;
    const rules      = opt.typeRules || {};
    const armorPen   = rules.armorPen || 0;
    const typeDmgBon = rules.dmgBonus || 0;
    let   missEffect = rules.missEffect || 'none';
    // Règle générale : tout sort / compétence qui consomme du mana fait au moins
    // ½ dégâts (arrondi inf.) en cas d'échec. Si le type de dégâts définit déjà
    // 'half' ou 'full', on respecte (pas de cumul, on ne dégrade pas non plus).
    if (missEffect === 'none' && opt.pmCost > 0) missEffect = 'half';

    const targetCas = targetIds.map(curTgtId => {
      const curTgtData = VS.tokens[curTgtId]?.data;
      const lCurTgt = _live(curTgtData || {});
      const rawCA = lCurTgt.realDefense ?? lCurTgt.displayDefense ?? 10;
      return armorPen > 0 ? Math.round(rawCA * (1 - armorPen / 100)) : rawCA;
    });
    const missesEveryTarget = targetCas.length
      ? targetCas.every(targetCA => hitTotal < targetCA)
      : false;
    const luckyReroll = await _consumeLuckyReroll(srcId, src, d20, !isCrit && (isFumble || missesEveryTarget));
    if (luckyReroll) {
      d20 = luckyReroll.d20;
      luckRerollValue = luckyReroll.reroll;
      isCrit   = d20 >= critThreshold;
      isFumble = d20 === 1;
      hitTotal = d20 + atkBase + bonusHit + extraHitSum + _touchBuff;
      luckUsed = true;
    }
    // Touche automatique : aucun jet de toucher → toujours touché, ni critique ni
    // échec (les dégâts restent normaux, roulés ensuite comme d'habitude).
    if (opt.autoHit) { isCrit = false; isFumble = false; }

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
        const baseDet = _rollDiceDetailed(effectiveDice);
        sharedDmgRaw = baseDet.total;
        sharedDmgRollsDetail = {
          rolls: baseDet.rolls, sides: baseDet.sides, mod: baseDet.mod,
          n: baseDet.n, formula: baseDet.formula,
        };
        const critDet = _rollCritExtraDieDetailed(effectiveDice, { maximize: !!opt.mods?.chance });
        sharedCritRaw2 = critDet.total;
        sharedCritRollsDetail = critDet?.rolls?.length ? {
          rolls: critDet.rolls, sides: critDet.sides, mod: critDet.mod,
          n: critDet.n, formula: critDet.formula,
        } : null;
        sharedCritFixed2    = totalFixed;
        sharedDmgTotalHit   = calcCriticalEffectTotal({
          baseRoll: sharedDmgRaw,
          diceMax: _maxDice(effectiveDice),
          critRoll: sharedCritRaw2,
          fixedBonus: totalFixed,
        });
      } else {
        const det = _rollDiceDetailed(effectiveDice);
        sharedDmgRaw      = det.total;
        sharedDmgRollsDetail = {
          rolls: det.rolls, sides: det.sides, mod: det.mod,
          n: det.n, formula: det.formula,
        };
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
      const round_eff = VS.session?.combat?.round ?? 0;
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
    const _statsDelta = { chars: {} };   // delta de stats accumulé (réversible à l'annulation)
    let _maxHit = 0;                      // plus gros coup de cette attaque (record, non réversible)
    for (const curTgtId of targetIds) {
      const curTgtData = VS.tokens[curTgtId]?.data;
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
      const hit      = isBlocked ? false : (opt.autoHit ? true : (isCrit ? true : isFumble ? false : hitTotal >= targetCA));
      const halfDmg  = !isBlocked && !hit && missEffect !== 'none' && !isFumble;
      let dmgTotal   = hit ? sharedDmgTotalHit : halfDmg ? sharedDmgTotalHalf : 0;
      let interaction = null;

      // ── Bonus de dégâts subis depuis les états actifs de la cible (Marqué, etc.) ──
      // Roule la formule (ex: "1d6") par état. Appliqué sur hit ET demi-dégâts.
      const _condDmgNotes = [];
      const _condDmgDetails = [];
      if ((hit || halfDmg) && dmgTotal > 0) {
        for (const { lib } of _activeConditionsOf(curTgtData)) {
          const f = lib?.effects?.dmgTakenBonus;
          if (!f) continue;
          const det = _rollDiceDetailed(String(f));
          if (det.total > 0) {
            dmgTotal += det.total;
            _condDmgNotes.push(`+${det.total} ${lib.icon || ''} ${lib.label}`);
            _condDmgDetails.push({
              type: 'taken_bonus',
              formula: String(f),
              icon: lib.icon || '💢',
              label: lib.label || 'État',
              rolls: det.rolls || [],
              sides: det.sides || null,
              mod: det.mod || 0,
              total: det.total,
            });
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
            _condDmgDetails.push({
              type: 'reduction_pct',
              icon: bestLib.icon || '🛡',
              label: bestLib.label || 'Réduction',
              pct: bestPct,
              before,
              total: before - dmgTotal,
              after: dmgTotal,
            });
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
          const bEnt    = VS.bestiary[curTgtData.beastId];
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
          const tgtChar = curTgtData.characterId
            ? STATE.characters.find(x => x.id === curTgtData.characterId) : null;
          // Résistances / immunités / absorptions / faiblesses accordées par
          // l'équipement du personnage (non cumulable — cf. getCharDamageProfile).
          if (tgtChar) {
            const prof = getCharDamageProfile(tgtChar);
            if (prof) {
              const result = applyDamageTypeInteraction(dmgTotal, opt.damageTypeId, prof);
              dmgTotal    = result.dmgTotal;
              interaction = result.interaction;
            }
          }
          // Set Lourd : réduction plate par coup (sur des dégâts positifs uniquement —
          // une absorption rend des PV et ne doit pas être rognée).
          if (dmgTotal > 0 && tgtChar) {
            dmgReduction = getArmorSetData(tgtChar).modifiers.damageReduction || 0;
            if (dmgReduction > 0) dmgTotal = Math.max(1, dmgTotal - dmgReduction);
          }
          // Borne haute = hpMax pour qu'une absorption ne soigne pas au-delà du max.
          newHp = Math.max(0, Math.min(hpMax, curHp - dmgTotal));
          await _setHp(curTgtData, newHp);
        }
      }

      // ── Statistiques de combat : accumule (écrit une fois après la boucle,
      //    stocké dans le log pour pouvoir l'annuler avec l'action) ──
      const _atkActor = _statsActor(src);
      accAttackDelta(_statsDelta, {
        attackerId:   _atkActor.id,
        attackerName: _atkActor.name,
        targetId:     curTgtData.characterId || null,
        targetName:   curTgtData.name || '',
        hit, crit: isCrit, fumble: isFumble,
        dmg: (hit || halfDmg) ? Math.max(0, dmgTotal) : 0,
        ko: (curHp > 0 && newHp <= 0),
      });
      if ((hit || halfDmg) && dmgTotal > _maxHit) _maxHit = dmgTotal;
      // Record du plus gros coup REÇU par la cible (PJ).
      if ((hit || halfDmg) && dmgTotal > 0 && curTgtData.characterId)
        bumpBiggestTaken(curTgtData.characterId, curTgtData.name || '', dmgTotal);

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
        tokenId: curTgtData.id,   // pour l'annulation manuelle (bouclier réactif)
        shieldBlocked: isBlocked,
        condDmgNotes: _condDmgNotes, condDmgDetails: _condDmgDetails, consumedNotes: _consumedNotes,
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
    const concentrationLogs = [];

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
      const concNotes = await _vttTriggerConcentrationSave(td, r.dmgTotal, r.newHp, { deferLog: true });
      modNotes.push(...concNotes);
      if (concNotes.concentrationLogs?.length) concentrationLogs.push(...concNotes.concentrationLogs);
    }

    if (_mods) {
      const round = VS.session?.combat?.round ?? 0;
      const baseRound = Math.max(1, round);

      for (const r of targetResults) {
        const wasHit = r.hit || r.halfDmg;
        if (!wasHit || !r._data) continue;
        const curTgtData = r._data;

        // ── Lacération : -CA brut sur la cible (plafonné selon rang) ────
        if (_mods.laceration) {
          const lac = _mods.laceration;
          const beast = curTgtData.beastId ? VS.bestiary[curTgtData.beastId] : null;
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

    const _castKinds = _castStatKinds(opt);

    // ── Statistiques : cast (sort lancé + PM) puis écriture du delta ──
    const _castActor = _statsActor(src);
    if (_castActor.id && (opt.sortIdx !== undefined || (opt.pmCost || 0) > 0)) {
      accCastDelta(_statsDelta, {
        casterId: _castActor.id, casterName: _castActor.name,
        spellName: opt.sortIdx !== undefined ? (opt.label || 'Sort') : null,
        pm: opt.pmCost || 0,
        tactical: _castKinds.tactical ? 1 : 0,
        support: _castKinds.support ? 1 : 0,
        affliction: _castKinds.affliction ? 1 : 0,
      });
    }
    applyStatsDelta(_statsDelta, +1);
    if (_castActor.id && _maxHit > 0) bumpBiggestHit(_castActor.id, _castActor.name, _maxHit);

    // ── Un seul message dans le log ────────────────────────────────────
    // Strip _data (référence token interne, non sérialisable Firestore)
    const cleanResults = targetResults.map(({ _data, ...rest }) => rest);
    const isMulti = cleanResults.length > 1;
    if (isMulti) {
      await addDoc(_logCol(), {
        type: 'attack-multi',
        undo: _undoSnap,
        statsDelta: _statsDelta,
        ..._vttLogSourceFields(src),
        authorId: STATE.user?.uid||null, authorName,
        attackerName: lS.displayName??src.name,
        characterImage: lS.displayImage||null,
        attackerRank,
        optLabel: opt.label,
        autoHit: !!opt.autoHit,
        isCrit, isFumble, advMode: effectiveMode, advAuto: effectiveMode !== mode,
        advReasons: effectiveMode !== mode ? condMods.reasons : null,
        hitD20: d20, hitD20rolls: luckUsed ? [roll1, ...(roll2 !== null ? [roll2] : []), luckRerollValue] : (roll2 !== null ? [roll1, roll2] : [roll1]),
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
        critFormula: criticalEffectFormulaLabel(),
        damageTypeId: opt.damageTypeId||null, damageTypeIcon: opt.damageTypeIcon||null,
        damageTypeColor: opt.damageTypeColor||null,
        buffDmgBonus: buffDmgBonus || 0,
        buffDmgNotes: buffDmgNotes.length ? buffDmgNotes : null,
        buffDmgDetail: buffDmgDetail || null,
        dmgRollsDetail: sharedDmgRollsDetail || null,
        critRollsDetail: sharedCritRollsDetail || null,
        ..._diceLogFields('dmg', sharedDmgRollsDetail),
        ..._diceLogFields('crit', sharedCritRollsDetail),
        targets: cleanResults,
        createdAt: serverTimestamp(),
      }).catch(()=>{});
    } else {
      const r = cleanResults[0];
      // Image de la cible pour affichage dans le chat (single target)
      const _defImg = _live(tgt)?.displayImage || r?.targetImage || null;
      if (r) await addDoc(_logCol(), {
        type: 'attack',
        undo: _undoSnap,
        statsDelta: _statsDelta,
        ..._vttLogSourceFields(src),
        authorId: STATE.user?.uid||null, authorName,
        attackerName: lS.displayName??src.name,
        characterImage: lS.displayImage||null,
        defenderName: r.name,
        defenderImage: _defImg,
        // Bouclier réactif manuel : token cible + rang attaquant (vérif du palier).
        defenderTokenId: r.tokenId || null,
        attackerRank,
        // Identifiants cible pour rendu côté joueur (estimation CA)
        beastId: r.beastId || null,
        npcId: r.npcId || null,
        characterId: r.characterId || null,
        optLabel: opt.label,
        autoHit: !!opt.autoHit,
        isCrit, isFumble, advMode: effectiveMode, advAuto: effectiveMode !== mode,
        advReasons: effectiveMode !== mode ? condMods.reasons : null,
        hitD20: d20, hitD20rolls: luckUsed ? [roll1, ...(roll2 !== null ? [roll2] : []), luckRerollValue] : (roll2 !== null ? [roll1, roll2] : [roll1]),
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
        critFormula: criticalEffectFormulaLabel(),
        halfDmg: r.halfDmg, newHp: r.newHp, hpMax: r.hpMax,
        damageTypeId: opt.damageTypeId||null, damageTypeIcon: opt.damageTypeIcon||null,
        damageTypeColor: opt.damageTypeColor||null,
        buffDmgBonus: buffDmgBonus || 0,
        buffDmgNotes: buffDmgNotes.length ? buffDmgNotes : null,
        buffDmgDetail: buffDmgDetail || null,
        condDmgNotes: r.condDmgNotes?.length ? r.condDmgNotes : null,
        condDmgDetails: r.condDmgDetails?.length ? r.condDmgDetails : null,
        consumedNotes: r.consumedNotes?.length ? r.consumedNotes : null,
        dmgRollsDetail: sharedDmgRollsDetail || null,
        critRollsDetail: sharedCritRollsDetail || null,
        ..._diceLogFields('dmg', sharedDmgRollsDetail),
        ..._diceLogFields('crit', sharedCritRollsDetail),
        interaction: r.interaction || null,
        createdAt: serverTimestamp(),
      }).catch(()=>{});
    }

    for (const payload of concentrationLogs) {
      await addDoc(_logCol(), payload).catch(() => {});
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
// [_inspectorDirty → vtt-inspector.js]
// [Inspecteur de token (_renderInspector + onglets) → vtt-inspector.js (importé en haut)]

// [Tray MJ + pages (_renderTray*/_renderPageList/_switchPage…) → vtt-tray.js]

export function _renderAllTokens() {
  if (!VS.activePage) return;
  VS.layers.token?.destroyChildren();
  for (const e of Object.values(VS.tokens)) {
    const t=e.data;
    // destroyChildren() a détruit tous les shapes : on remet la référence à null
    // pour les tokens non rendus ici (autre page / réserve / invisibles).
    if (t.pageId!==VS.activePage.id || (!t.visible&&!STATE.isAdmin)) {
      if (e.shape) VS.tokens[t.id]={...e,shape:null};
      continue;
    }
    const shape=_buildShape(t);
    VS.tokens[t.id]={...e,shape}; VS.layers.token.add(shape);
  }
  VS.layers.token?.batchDraw();
}

// ═══════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════
// OUTILS — RÈGLE & ANNOTATIONS
// ═══════════════════════════════════════════════════════════════════

// Conversion coords écran → monde
// [_stageToWorld → vtt-render.js (importé en haut)]

// [Règle de mesure (état + fonctions + diffusion MJ) → vtt-ruler.js (importé en haut)]

// ── Annotations ────────────────────────────────────────────────────
function _buildAnnotShape(K, data) {
  const shape = _buildAnnotVisual(K, data);  // construction pure → vtt-render.js
  if (!shape) return null;

  // MJ peut tout modifier, joueur seulement ses propres dessins
  const canEdit = STATE.isAdmin || data.createdBy === STATE.user?.uid;

  if (canEdit) {
    // Clic gauche → sélectionner (mode select uniquement). Cliquer un membre d'un
    // groupe sélectionne TOUT le groupe.
    shape.on('click', e => {
      if (e.evt.button !== 0) return; // ignore middle/right (pan caméra)
      if (VS.tool !== 'select') return;
      e.cancelBubble = true;
      const grp = _annotIdsInGroup(data);
      if (e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey) {
        // Ctrl/Cmd/Maj+clic : toggle dans la multi-sélection (un par un / groupe entier)
        const anySel = grp.some(id => _selectedAnnotIds.has(id));
        grp.forEach(id => anySel ? _selectedAnnotIds.delete(id) : _selectedAnnotIds.add(id));
      } else {
        _selectedAnnotIds.clear();
        grp.forEach(id => _selectedAnnotIds.add(id));
        _selectedAnnotId = data.id;
      }
      _applyAnnotTransformer();
    });
    // Clic-droit → MENU (Grouper / Dégrouper / Supprimer) — NE supprime plus d'un clic.
    shape.on('contextmenu', e => {
      if (VS.tool !== 'select') return;
      e.evt.preventDefault(); e.cancelBubble = true;
      // La forme cliquée (et son groupe) entre dans la sélection si elle n'y est pas.
      if (!_selectedAnnotIds.has(data.id)) {
        _selectedAnnotIds.clear();
        _annotIdsInGroup(data).forEach(id => _selectedAnnotIds.add(id));
        _selectedAnnotId = data.id;
        _applyAnnotTransformer();
      }
      const selCount = _selectedAnnotIds.size;
      const items = [];
      if (selCount >= 2) items.push({ label: `🔗 Grouper (${selCount})`, fn: _groupSelectedAnnots });
      if (data.groupId)  items.push({ label: '✂️ Dégrouper', fn: () => _ungroupAnnot(data.id) });
      if (items.length)  items.push('---');
      items.push({ label: `🗑️ Supprimer${selCount > 1 ? ` (${selCount})` : ''}`, fn: () => _deleteSelectedAnnots(data.id) });
      _showCtxMenu(e.evt.clientX, e.evt.clientY, items);
    });
    // Début de drag groupé
    shape.on('dragstart', () => {
      // Un dessin GROUPÉ entraîne tout son groupe (une seule entité), même sans
      // sélection préalable ; sinon on retombe sur la multi-sélection courante (>1).
      const grp = _annotIdsInGroup(data);
      const movers = grp.length > 1 ? grp
        : (_selectedAnnotIds.has(data.id) && _selectedAnnotIds.size > 1 ? [..._selectedAnnotIds] : null);
      if (movers) {
        _annotGroupDragOrigins = {};
        for (const id of movers) {
          const s = _annotations[id]?.shape;
          if (s) _annotGroupDragOrigins[id] = { x: s.x(), y: s.y() };
        }
      } else { _annotGroupDragOrigins = null; }
    });
    // Déplacement groupé (piloté par les origines capturées, indépendant de la sélection)
    shape.on('dragmove', () => {
      const orig = _annotGroupDragOrigins?.[data.id];
      if (!orig) return;
      const dx = shape.x() - orig.x, dy = shape.y() - orig.y;
      for (const [id, o] of Object.entries(_annotGroupDragOrigins)) {
        if (id === data.id) continue;
        _annotations[id]?.shape?.position({ x: o.x + dx, y: o.y + dy });
      }
      VS.layers.draw.batchDraw();
    });
    // Fin de drag → sauvegarder position(s)
    shape.on('dragend', () => {
      const idsToSave = _annotGroupDragOrigins ? Object.keys(_annotGroupDragOrigins) : [data.id];
      for (const id of idsToSave) {
        const s = _annotations[id]?.shape, ann = _annotations[id]?.data;
        if (!s || !ann) continue;
        // Marquer skip rebuild pour éviter le saut visuel au retour onSnapshot
        _skipAnnotRebuild.add(id);
        const isPts = _ANNOT_PTS_TYPES.has(ann.type);
        const update = isPts
          ? { offsetX: s.x(), offsetY: s.y() }
          : { x: s.x(), y: s.y() };
        if (!isPts) {
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
  VS.layers.draw?.batchDraw();
}

function _inRect(cx, cy, r) {
  return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
}

function _selectByRect(r) {
  _clearMultiSelect();
  _deselectAnnot();
  const uid = STATE.user?.uid;

  // Tokens sur la page active
  for (const [id, {data: t}] of Object.entries(VS.tokens)) {
    if (!t || t.pageId !== VS.activePage?.id) continue;
    const { x: cx, y: cy } = _tokenCenter(t);
    if (_inRect(cx, cy, r)) {
      VS.selectedMulti.add(id);
      VS.tokens[id]?.shape?.findOne('.sel')?.visible(true);
    }
  }

  // Annotations interactives sur la page active
  for (const [id, e] of Object.entries(_annotations)) {
    if (!e.data || e.data.pageId !== VS.activePage?.id || !e.shape) continue;
    if (!STATE.isAdmin && e.data.createdBy !== uid) continue;
    const bb = e.shape.getClientRect({ relativeTo: VS.stage });
    const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
    if (_inRect(cx, cy, r)) _selectedAnnotIds.add(id);
  }

  _applyAnnotTransformer();
  if (VS.selectedMulti.size > 0) _renderInspector(null);
  else if (_selectedAnnotIds.size > 0) _renderInspector(null);
  VS.layers.token?.batchDraw();
}

function _endMarquee() {
  _marqueeActive = false;
  _marqueeShape?.destroy(); _marqueeShape = null;
  VS.layers.ping?.batchDraw();
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
  if (_annotTransformer) { _annotTransformer.nodes([]); VS.layers.draw?.batchDraw(); }
}

// ── Groupes de dessins (groupId persistant sur l'annotation) ────────
// Ids de toutes les annotations du groupe de `data` (sur la page active), ou juste
// [data.id] si le dessin n'est pas groupé.
function _annotIdsInGroup(data) {
  if (!data?.groupId) return [data.id];
  const gid = data.groupId, pid = VS.activePage?.id;
  return Object.entries(_annotations)
    .filter(([, e]) => e.data?.groupId === gid && e.data?.pageId === pid)
    .map(([id]) => id);
}
// Grouper les annotations actuellement sélectionnées sous un même groupId.
function _groupSelectedAnnots() {
  const ids = [..._selectedAnnotIds];
  if (ids.length < 2) return;
  const gid = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  ids.forEach(id => {
    const ann = _annotations[id]?.data; if (ann) ann.groupId = gid;
    _skipAnnotRebuild.add(id);
    updateDoc(_annotRef(id), { groupId: gid }).catch(() => {});
  });
  showNotif(`🔗 ${ids.length} dessins groupés`, 'success');
}
// Dégrouper : retire le groupId de tous les membres du groupe de `id`.
function _ungroupAnnot(id) {
  const gid = _annotations[id]?.data?.groupId; if (!gid) return;
  const ids = Object.entries(_annotations).filter(([, e]) => e.data?.groupId === gid).map(([i]) => i);
  ids.forEach(i => {
    const a = _annotations[i]?.data; if (a) a.groupId = null;
    _skipAnnotRebuild.add(i);
    updateDoc(_annotRef(i), { groupId: null }).catch(() => {});
  });
  showNotif('✂️ Dessins dégroupés', 'success');
}
// Supprimer la sélection (ou juste `fallbackId` si non sélectionné).
function _deleteSelectedAnnots(fallbackId) {
  const toDelete = _selectedAnnotIds.has(fallbackId) ? [..._selectedAnnotIds] : [fallbackId];
  toDelete.forEach(id => deleteDoc(_annotRef(id)).catch(() => {}));
  _deselectAnnot();
}

export function _renderAnnotLayer() {
  try { return _renderAnnotLayerImpl(); }
  catch (e) { _vttPanelError('Dessins', e, null); }
}
function _syncPlayerAnnotClip() {
  if (STATE.isAdmin || !VS.layers.draw || !VS.activePage) return;
  VS.layers.draw.clip({
    x: 0,
    y: 0,
    width: VS.activePage.cols * CELL,
    height: VS.activePage.rows * CELL,
  });
}
function _renderAnnotLayerImpl() {
  if (!VS.layers.draw || !VS.activePage) return;
  const K = window.Konva;
  // Le canvas de brouillard s'arrête aux limites de la grille. Sans découpe,
  // les annotations placées dans l'espace de travail autour de la carte restent
  // donc visibles des joueurs. Le MJ conserve tout son espace de préparation.
  _syncPlayerAnnotClip();
  Object.values(_annotations).forEach(e => { e.shape?.destroy(); e.shape = null; });
  for (const [id, e] of Object.entries(_annotations)) {
    if (e.data.pageId !== VS.activePage.id) continue;
    const shape = _buildAnnotShape(K, e.data);
    if (shape) { _annotations[id].shape = shape; VS.layers.draw.add(shape); }
  }
  _updateAnnotDraggable();
  VS.layers.draw.batchDraw();
}

function _updateAnnotDraggable() {
  if (!VS.layers.draw) return;
  const inSelect = VS.tool === 'select';
  const inErase  = VS.tool === 'draw' && _drawShape === 'eraser';
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
  VS.layers.draw.batchDraw();
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
  if (_drawLive) { VS.layers.draw.add(_drawLive); }
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
  VS.layers.draw.batchDraw();
}
async function _endDraw() {
  _drawing = false;
  if (!_drawLive || !VS.activePage) { _drawLive?.destroy(); _drawLive=null; return; }
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
  if (!data) { liveCopy.destroy(); VS.layers.draw.batchDraw(); return; }
  data = { ...data, pageId:VS.activePage.id, color:_drawColor, strokeWidth:_drawWidth,
    createdBy: STATE.user?.uid||null, createdAt: serverTimestamp() };
  const id = 'a' + Date.now() + Math.random().toString(36).slice(2,5);
  try {
    await setDoc(_annotRef(id), data);
    _pushDrawHistory(id); // permet Ctrl+Z / invalide le redo
    liveCopy.destroy(); // l'onSnapshot va recréer la version persistée
  } catch(err) {
    console.error('[VTT] Annotation save error:', err?.code, err?.message);
    showNotif('Erreur sauvegarde annotation — vérifiez les règles Firestore', 'error');
    // Garder liveCopy visible temporairement (non persistée)
  }
  VS.layers.draw.batchDraw();
}

// ── Polygone (sommet par sommet : triangles & formes libres) ───────────────
function _polyEnsureLive() {
  if (_polyLive) return;
  const K = window.Konva;
  _polyLive = new K.Line({ stroke:_drawColor, strokeWidth:_drawWidth, lineCap:'round', lineJoin:'round',
    listening:false, name:'draw-live', points:[], closed:true,
    fill: _drawFill ? _drawColor+'30' : 'transparent' });
  VS.layers.draw.add(_polyLive);
}
// Clic : pose un sommet (ou ferme si on clique près du premier).
function _polyClick(wp) {
  _polyEnsureLive();
  const scale = VS.stage.scaleX() || 1;
  // Fermeture : clic à proximité du 1er sommet (et au moins un triangle posé).
  if (_polyPts.length >= 6) {
    if (Math.hypot(wp.x - _polyPts[0], wp.y - _polyPts[1]) < 12 / scale) { _polyFinish(); return; }
  }
  // Dé-doublonne les sommets quasi-confondus (ex. les 2 clics d'un double-clic).
  if (_polyPts.length >= 2) {
    const lx = _polyPts[_polyPts.length - 2], ly = _polyPts[_polyPts.length - 1];
    if (Math.hypot(wp.x - lx, wp.y - ly) < 3 / scale) return;
  }
  _polyPts.push(wp.x, wp.y);
  _polyActive = true;
  _polyLive.points([..._polyPts]);
  VS.layers.draw.batchDraw();
}
// Survol : aperçu du segment courant vers le curseur.
function _polyHover(wp) {
  if (!_polyActive || !_polyLive) return;
  _polyLive.points([..._polyPts, wp.x, wp.y]);
  VS.layers.draw.batchDraw();
}
// Annule le tracé en cours (Échap, changement d'outil…).
function _polyCancel() {
  _polyLive?.destroy();
  _polyLive = null; _polyPts = []; _polyActive = false;
  VS.layers.draw?.batchDraw();
}
// Retire le dernier sommet posé (clic droit).
function _polyUndoPoint() {
  if (!_polyActive) return;
  _polyPts.splice(-2, 2);
  if (!_polyPts.length) { _polyCancel(); return; }
  _polyLive.points([..._polyPts]);
  VS.layers.draw.batchDraw();
}
// Termine et persiste le polygone (double-clic, Entrée, clic sur 1er sommet).
async function _polyFinish() {
  const pts = [..._polyPts];
  _polyCancel();
  if (pts.length < 6 || !VS.activePage) return;   // < 3 sommets = pas un polygone
  const data = { type:'polygon', points:pts, offsetX:0, offsetY:0, fill:_drawFill,
    pageId:VS.activePage.id, color:_drawColor, strokeWidth:_drawWidth,
    createdBy: STATE.user?.uid||null, createdAt: serverTimestamp() };
  const id = 'a' + Date.now() + Math.random().toString(36).slice(2,5);
  try {
    await setDoc(_annotRef(id), data);
    _pushDrawHistory(id);   // permet Ctrl+Z / invalide le redo
  } catch(err) {
    console.error('[VTT] Annotation save error:', err?.code, err?.message);
    showNotif('Erreur sauvegarde annotation — vérifiez les règles Firestore', 'error');
  }
  VS.layers.draw.batchDraw();
}

// ── Bestiaire VTT : catalogue MJ, lecture ciblée joueurs ─────────────────────
function _patchBestiaryTokenShapes(changedIds) {
  if (!changedIds?.size) return;
  for (const [id, e] of Object.entries(VS.tokens)) {
    if (e.data?.beastId && changedIds.has(e.data.beastId)) {
      _patchShape(id);
      if (VS.selected === id) _renderInspectorSoon();
    }
  }
  _renderCombatTrackerSoon();
}

function _applyBestiaryCatalog(list) {
  const before = new Set(Object.keys(VS.bestiary));
  const next = {};
  for (const b of list || []) {
    if (!b?.id) continue;
    next[b.id] = b;
  }
  VS.bestiary = next;
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
  if (VS.bestiary[beastId]) return Promise.resolve(VS.bestiary[beastId]);
  if (_bestiaryLoads.has(beastId)) return _bestiaryLoads.get(beastId);
  const promise = getDocDataSilent('bestiary', beastId)
    .then(data => {
      if (!data) return null;
      const docData = { ...data, id: data.id || beastId };
      VS.bestiary[beastId] = docData;
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
  for (const { data } of Object.values(VS.tokens)) {
    if (data?.beastId) ids.add(data.beastId);
  }
  ids.forEach(id => { void _ensureBestiaryDoc(id); });
}

// SYNC FIRESTORE — listeners temps réel
// ═══════════════════════════════════════════════════════════════════
function _initListeners() {
  if (!aid()) return;

  // 1. Session
  VS.unsubs.push(onSnapshot(_sesRef(), snap => {
    VS.session=snap.exists()?snap.data():{};
    _renderSessionBtn();
    _renderPageTabs();
    if (!STATE.isAdmin) {
      const uid=STATE.user?.uid;
      const target=VS.session.playerPages?.[uid]??VS.session.activePageId;
      if (target&&VS.pages[target]&&VS.activePage?.id!==target) _switchPage(target);
    }
    _renderTimer();
    _renderWeatherBtn();
    _applyWeather();
    _renderCombatTracker();
    _renderMjRulerRemote(VS.session.mjRuler);
    _renderShortRest();
    _checkShortRestAutoApply();
  },()=>{}));

  // 2. Pages
  VS.unsubs.push(onSnapshot(_pgsCol(), snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type==='removed') delete VS.pages[ch.doc.id];
      else {
        VS.pages[ch.doc.id]={id:ch.doc.id,...ch.doc.data()};
        if (VS.activePage?.id===ch.doc.id) {
          VS.activePage=VS.pages[ch.doc.id];
          _syncPlayerAnnotClip();
          _renderMapImages(_MAP_IMG_DEPS);
          fogRenderWalls(VS.activePage, STATE.isAdmin);
          fogUpdateSoon(VS.activePage, VS.tokens, STATE.isAdmin);
        }
      }
    });
    _renderPageTabs();
    if (!VS.activePage&&Object.keys(VS.pages).length>0) {
      const uid=STATE.user?.uid;
      const target=(VS.session.playerPages?.[uid]??VS.session.activePageId)
        ||Object.values(VS.pages).sort((a,b)=>(a.order??0)-(b.order??0))[0]?.id;
      if (target&&VS.pages[target]) _switchPage(target);
    }
  },()=>{}));

  // 3. Personnages — source de vérité des HP joueurs
  VS.unsubs.push(subscribeCollection("characters", data => {
    const prev = VS.characters;
    const next = {};
    for (const c of data || []) next[c.id] = c;
    const wasReady = _charsReady;

    const changed = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const id of Object.keys(prev)) {
      if (next[id]) continue;
      const tok = Object.values(VS.tokens).find(e => e.data.characterId === id);
      if (tok) deleteDoc(_tokRef(tok.data.id)).catch(() => {});
    }

    VS.characters = next;
    for (const [id, e] of Object.entries(VS.tokens)) {
      if (e.data.characterId && changed.has(e.data.characterId)) {
        _patchShape(id); if (VS.selected === id) _renderInspectorSoon();
      }
    }
    _renderTraySoon();
    _markCharsReady();
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
    if (VS.miniUid && VS.miniCharId &&
        JSON.stringify(prev[VS.miniCharId]) !== JSON.stringify(next[VS.miniCharId])) {
      _renderMiniSheet(VS.miniUid);
    }
  }));

  // 4. PNJ — source de vérité des HP PNJ
  VS.unsubs.push(subscribeCollection("npcs", data => {
    const prev = VS.npcs;
    const next = {};
    for (const n of data || []) next[n.id] = n;

    const changed = new Set([...Object.keys(prev), ...Object.keys(next)]);
    VS.npcs = next;
    for (const [id, e] of Object.entries(VS.tokens)) {
      if (e.data.npcId && changed.has(e.data.npcId)) {
        _patchShape(id); if (VS.selected === id) _renderInspectorSoon();
      }
    }
    _renderTraySoon();
    _markNpcsReady();
  }));

  // 5. Bestiaire
  // MJ : catalogue complet pour le tray, mais sans listener permanent.
  // Joueurs : chargement doc par doc des créatures réellement présentes en tokens.
  if (STATE.isAdmin) void _loadBestiaryCatalog();

  // 5b. Tracker bestiaire joueur (estimations personnelles)
  if (!STATE.isAdmin) {
    const uid = STATE.user?.uid;
    if (uid) {
      VS.unsubs.push(onSnapshot(_bstTrackerRef(uid), snap => {
        VS.bstTracker = snap.exists() ? (snap.data().data || {}) : {};
        // Mettre à jour la barre HP de tous les tokens ennemis sur le canvas
        for (const [id, e] of Object.entries(VS.tokens)) {
          if (e.data?.type === 'enemy' && e.data?.beastId) _patchShape(id);
        }
        // Rafraîchit l'inspector si un token ennemi est sélectionné
        if (VS.selected) {
          const td = VS.tokens[VS.selected]?.data;
          if (td?.type === 'enemy') _renderInspectorSoon();
        }
      }, () => {}));
    }
  }

  // 6. Tokens
  VS.unsubs.push(onSnapshot(_toksCol(), snap => {
    snap.docChanges().forEach(ch => {
     try {
      const id=ch.doc.id, data={id,...ch.doc.data()};
      if (ch.type==='removed') {
        VS.tokens[id]?.shape?.destroy(); delete VS.tokens[id];
        if (VS.selected===id) _deselect();
        VS.layers.token?.batchDraw(); return;
      }
      const prev=VS.tokens[id];
      if (prev) {
        const changedPage=prev.data.pageId!==data.pageId;
        prev.data=data;
        if (changedPage) {
          prev.shape?.destroy(); prev.shape=null;
          if (VS.activePage&&data.pageId===VS.activePage.id&&(data.visible||STATE.isAdmin)) {
            const shape=_buildShape(data);
            VS.tokens[id]={data,shape}; VS.layers.token?.add(shape); VS.layers.token?.batchDraw();
          } else {
            VS.tokens[id]={data,shape:null};
          }
        } else {
          _patchShape(id);
        }
        if (VS.selected===id) { _renderInspectorSoon(); _refreshRanges(id); }
      } else {
        VS.tokens[id]={data,shape:null};
        if (VS.activePage&&data.pageId===VS.activePage.id&&(data.visible||STATE.isAdmin)) {
          const shape=_buildShape(data);
          VS.tokens[id].shape=shape;
          VS.layers.token?.add(shape); VS.layers.token?.batchDraw();
        }
      }
     } catch (e) { _vttPanelError('Token', e, null); }
    });
    _renderTraySoon();
    _renderCombatTrackerSoon();
    void _cleanupReserveDuplicates();
    _markToksReady();
    _ensureBestiaryForTokens();
    // Joueur : le bouton « Invoquer mon token » dépend de l'état de SON token
    // (créé / assigné / déplacé par le MJ). Sans ce refresh, le bouton n'apparaît
    // pas tant qu'un autre événement (changement de page) ne relance pas le rendu.
    if (!STATE.isAdmin) {
      const _myUid = STATE.user?.uid;
      if (snap.docChanges().some(ch => ch.doc.data()?.ownerId === _myUid)) _renderPageTabs();
    }
    // Le fog pilote aussi la visibilité/interactivité de tous les tokens.
    if (snap.docChanges().length)
      fogUpdateSoon(VS.activePage, VS.tokens, STATE.isAdmin);
    // Si la composition des joueurs présents change, le panneau "Court repos" doit suivre
    if (snap.docChanges().some(ch => ch.doc.data()?.type === 'player')) {
      _renderShortRest(); _checkShortRestAutoApply();
    }
  },()=>{}));

  // 7. Annotations (dessins + formes)
  VS.unsubs.push(onSnapshot(_annotCol(), snap => {
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
          if (VS.activePage && newData.pageId === VS.activePage.id) {
            const K = window.Konva;
            const shape = _buildAnnotShape(K, newData);
            if (shape) { _annotations[id].shape = shape; VS.layers.draw?.add(shape); }
          }
        }
      }
    });
    _updateAnnotDraggable();
    // Réappliquer le transformer sur les shapes reconstruits
    if (_selectedAnnotIds.size > 0) _applyAnnotTransformer();
    VS.layers.draw?.batchDraw();
  }, () => {}));

  // 8. Ciblage multi-sorts temps réel (lignes pointillées broadcast)
  // Le 1er snapshot livre les docs vttCasting persistés (anciens casts) → on
  // « amorce » : on marque leurs sigils comme déjà vus SANS les rejouer, sinon
  // toutes les runes des casts précédents se redessinent à l'arrivée sur le VTT.
  let _castingPrimed = false;
  VS.unsubs.push(onSnapshot(_castingCol(), snap => {
    _renderRemoteCastings(snap.docs, !_castingPrimed);
    _castingPrimed = true;
  }, () => {}));

  // 9. Pings + présence temps réel
  VS.unsubs.push(onSnapshot(_pingsCol(), snap => {
    const now = Date.now();

    // Présence : actif si lastSeen < 2 min (double filtrage : ici + render)
    VS.presence = {};
    snap.docs.forEach(d => {
      const pres = d.data().pres;
      if (!pres?.lastSeen) return;
      const ts = pres.lastSeen?.toMillis?.() ?? (typeof pres.lastSeen === 'number' ? pres.lastSeen : 0);
      if (ts > 0 && now - ts < 120_000) VS.presence[d.id] = { uid: d.id, pseudo: pres.pseudo || '?', lastSeen: ts };
    });
    _renderPresenceCol();
    // Le tray range les joueurs par statut online → faut re-render quand la
    // présence change, sinon la section "En ligne" reste vide à l'arrivée
    // jusqu'au prochain clic.
    if (STATE.isAdmin) _renderTraySoon();
    // Le quorum du court repos se base sur la présence : un joueur bloquant qui se
    // déconnecte doit pouvoir débloquer le vote sans attendre une autre action.
    _renderShortRest();
    _checkShortRestAutoApply();

    // Pings visuels (< 5 s)
    const pings = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.pageId === VS.activePage?.id && p.createdAt && (now - p.createdAt.toMillis()) < 5000);
    _renderPings(pings);
  }, () => {})); // silencieux si pas de règle Firestore

  // 10. Réactions émotes temps réel
  VS.unsubs.push(onSnapshot(_reactionsCol(), snap => {
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

  // 11. Chat / Log de dés (public + jets cachés MJ) → souscriptions dans vtt-chat.js.
  _initChatLogSubs();

  // Bibliothèque de cartes (MJ only)
  if (STATE.isAdmin) {
    VS.mapLibUnsub = onSnapshot(_mapLibRef(), snap => {
      VS.mapLib = snap.exists() ? snap.data() : {};
      if (!Array.isArray(VS.mapLib.folders)) VS.mapLib.folders = [];
      if (!Array.isArray(VS.mapLib.images))  VS.mapLib.images  = [];
      _renderLibSection();
    }, () => {});
  }

  // Butin d'aventure : listener lazy, démarré seulement à l'ouverture du panneau
  // ou quand le MJ ajoute du butin depuis une créature.

  // 12. Sons/playlists VTT : listeners lazy, démarrés seulement par le panneau MJ
  // ou par une lecture musicale qui a besoin de résoudre l'URL du son courant.

  // 13. État musique — sync pour tous les clients
  VS.unsubs.push(onSnapshot(_musicStateRef(), snap => {
    _syncMusicPlayback(snap.exists() ? snap.data() : {});
  }, ()=>{}));
}

// ═══════════════════════════════════════════════════════════════════
// MENU CONTEXTUEL (clic-droit images)
// ═══════════════════════════════════════════════════════════════════
// [menu contextuel _showCtxMenu / _hideCtxMenu → vtt-utils.js (importés en haut)]

// ── Mode édition carte ───────────────────────────────────────────
function _setMapMode(on) {
  VS.mapMode=on;
  VS.layers.map?.listening(on);
  VS.layers.mapFg?.listening(on);
  // Mettre à jour le draggable de toutes les images existantes
  const toggle = lyr => lyr?.find('Image').forEach(ki=>ki.draggable(on));
  toggle(VS.layers.map); toggle(VS.layers.mapFg);
  if (!on) {
    VS.imgTr?.nodes([]); VS.imgTrFg?.nodes([]); VS.selImg=null;
    VS.layers.map?.batchDraw(); VS.layers.mapFg?.batchDraw();
    _hideCtxMenu();
  }
  const btn=document.getElementById('vtt-map-mode-btn');
  if (btn) { btn.classList.toggle('active',on); btn.textContent=on?'🗺 Carte ✏':'🗺 Carte 🔒'; }
}
function _vttToggleMapMode() { return _setMapMode(!VS.mapMode); }

// ═══════════════════════════════════════════════════════════════════
// CHAT & LOG DE DÉS
// ═══════════════════════════════════════════════════════════════════
// ── Émotes ──────────────────────────────────────────────────────────
// [Émotes + dés libres (picker/favoris/gestion/mode de jet/compétences) → vtt-emotes.js]

// Fusionne le log public et (pour le MJ) les jets cachés, trie chronologiquement
// et garde les 80 plus récents — quelle que soit la collection qui vient de changer.
// [Chat & log de dés (rendu/envoi/réponses) → vtt-chat.js (importé en haut)]

// ═══════════════════════════════════════════════════════════════════
// ACTIONS GLOBALES
// ═══════════════════════════════════════════════════════════════════
function _vttTool(t) { return _setTool(VS.tool === t ? 'select' : t); }
// ── Courir : double le mouvement de base pour ce tour ───────────────
async function _vttCourir(id) {
  const tok = VS.tokens[id]?.data;
  if (!tok || !VS.session?.combat?.active) return;
  if (tok.bonusMvt > 0) { showNotif('Course déjà utilisée ce tour', 'error'); return; }
  const bonus = _live(tok).displayMovement ?? 6;
  await updateDoc(_tokRef(id), { bonusMvt: bonus }).catch(() => showNotif('Erreur', 'error'));
  showNotif(`🏃 Course ! +${bonus} cases de mouvement`, 'success');
}

// ── Déplacement clavier (flèches + pavé numérique) ──────────────────
async function _moveSelectedBy(dc, dr) {
  if (!VS.selected || !VS.activePage || VS.tool !== 'select') return;
  const tok = VS.tokens[VS.selected]?.data;
  if (!tok || tok.pageId !== VS.activePage.id) return;
  const ld  = _live(tok);
  const sw  = ld.displayTokenW || 1, sh = ld.displayTokenH || 1;
  const nc  = _clampTokenCell(tok.col + dc, sw, VS.activePage.cols);
  const nr  = _clampTokenCell(tok.row + dr, sh, VS.activePage.rows);
  if (nc === tok.col && nr === tok.row) return;
  await _moveTo(VS.selected, nc, nr);
  fogUpdateSoon(VS.activePage, VS.tokens, STATE.isAdmin);
}

function _vttFogTool(t) { return fogSetEditTool(t, VS.activePage); }
function _vttFogUndo() { if (!fogUndo()) showNotif('Rien à annuler', 'info'); }
function _vttFogRedo() { if (!fogRedo()) showNotif('Rien à rétablir', 'info'); }
async function _vttToggleFog() {
  if (!VS.activePage) return;
  const next = !VS.activePage.fogEnabled;
  await updateDoc(_pgRef(VS.activePage.id), { fogEnabled: next }).catch(() => showNotif('Erreur fog','error'));
}
async function _vttFogClearOps() {
  if (!VS.activePage) return;
  const n = (VS.activePage.fogOps || []).length;
  if (!n) { showNotif('Aucune zone de brouillard sur cette page', 'info'); return; }
  if (!await confirmModal(`Supprimer ${n} zone(s) de brouillard manuel de cette page ?`, { title: 'Brouillard', confirmLabel: 'Supprimer' })) return;
  await updateDoc(_pgRef(VS.activePage.id), { fogOps: [] }).catch(() => showNotif('Erreur', 'error'));
}
function _vttSwitchPage(id) { return _switchPage(id); }

// [COURT REPOS → vtt-rest.js]

// ── Suivi joueur du bestiaire (déductions, notes) depuis l'inspecteur VTT ──
// Écrit dans le même document Firestore que la fiche bestiaire → cohérent partout.
const _saveBstTracker = async () => {
  const uid = STATE.user?.uid; if (!uid) return;
  try { await saveDoc('bestiary_tracker', uid, { data: VS.bstTracker }); }
  catch (e) { console.error('[vtt] tracker save', e); }
}
function _vttBstDed(beastId, key, val) {
  if (!VS.bstTracker[beastId]) VS.bstTracker[beastId] = {};
  if (!VS.bstTracker[beastId].deductions) VS.bstTracker[beastId].deductions = {};
  const v = (val ?? '').toString();
  if (!v.trim()) delete VS.bstTracker[beastId].deductions[key];
  else           VS.bstTracker[beastId].deductions[key] = v;
  _saveBstTracker();
}
function _vttBstNotes(beastId, val) {
  if (!VS.bstTracker[beastId]) VS.bstTracker[beastId] = {};
  VS.bstTracker[beastId].notes = (val ?? '').toString();
  _saveBstTracker();
}

// ── Outils de dessin ────────────────────────────────────────────────
function _vttDrawShape(shape) {
  _polyCancel();   // abandonne un polygone en cours si on change d'outil de dessin
  _drawShape = shape;
  ['pencil','line','rect','circle','poly','eraser'].forEach(s => {
    document.getElementById(`vtt-ds-${s}`)?.classList.toggle('active', s === shape);
  });
  // La gomme a besoin que les annotations soient « écoutables » pour le hit-test ;
  // les formes de dessin non. On (dé)sélectionne et on met à jour l'écoute.
  if (shape === 'eraser') _deselectAnnot?.();
  _updateAnnotDraggable();
  const wrap = document.getElementById('vtt-canvas-wrap');
  if (wrap) wrap.style.cursor = shape === 'eraser' ? 'cell' : 'crosshair';
}

// Empile un nouvel id de tracé et invalide la pile de rétablissement (nouvelle action).
function _pushDrawHistory(id) { _drawHistory.push(id); _drawRedo = []; }

// Annule le dernier tracé de la session (bouton ↩ et Ctrl+Z). Mémorise la donnée
// annulée pour permettre le rétablissement (Ctrl+Y).
function _vttUndoDraw() {
  const lastId = _drawHistory.pop();
  if (!lastId) return;
  const data = _annotations[lastId]?.data;
  if (data) _drawRedo.push({ id: lastId, data: { ...data } }); // capture avant suppression
  deleteDoc(_annotRef(lastId)).catch(() => {});
}

// Rétablit le dernier tracé annulé (bouton ↪ et Ctrl+Y). Recrée l'annotation avec
// le même id et re-empile son id dans l'historique d'annulation.
function _vttRedoDraw() {
  const last = _drawRedo.pop();
  if (!last) { showNotif('Rien à rétablir', 'info'); return; }
  _drawHistory.push(last.id); // ne pas vider _drawRedo (ce n'est pas une nouvelle action)
  setDoc(_annotRef(last.id), last.data).catch(err => {
    console.error('[VTT] redo annotation', err?.code, err?.message);
    showNotif('Erreur rétablissement', 'error');
  });
}

// Gomme : supprime l'annotation (éditable) sous le curseur. Utilise la détection de
// hit Konva → gère correctement rotation/échelle/zoom. Optimiste + suppression doc.
function _eraseAtPointer() {
  if (!VS.layers?.draw || !VS.stage) return;
  const pos = VS.stage.getPointerPosition(); if (!pos) return;
  let node = VS.layers.draw.getIntersection(pos);
  let id = null;
  while (node && !id) { id = node._annotId || null; node = node.getParent?.(); }
  if (!id || !_annotations[id]) return;
  const canEdit = STATE.isAdmin || _annotations[id].data.createdBy === STATE.user?.uid;
  if (!canEdit) return;
  _annotations[id].shape?.destroy();
  delete _annotations[id];
  const hi = _drawHistory.indexOf(id);
  if (hi >= 0) _drawHistory.splice(hi, 1);
  VS.layers.draw.batchDraw();
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
  if (!VS.activePage) return;
  if (!await confirmModal('Effacer toutes les annotations de cette page ?')) return;
  const toDelete = Object.values(_annotations).filter(e => e.data.pageId === VS.activePage.id);
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
  const folders = [...new Set(Object.values(VS.pages).map(p => (p.folder||'').trim()).filter(Boolean))]
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
  await addDoc(_pgsCol(),{name,folder,cols,rows,backgroundImages:[],order:Object.keys(VS.pages).length,createdAt:serverTimestamp()})
    .catch(()=>showNotif('Erreur création page','error'));
}

function _vttEditPage(id) {
  const p=VS.pages[id]; if (!p) return;
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
  if (VS.activePage?.id===id) { VS.activePage={...VS.activePage,name,folder,cols,rows,fogEnabled}; _drawGrid(); }
}

async function _vttDeletePage(id) {
  if (!await confirmModal('Supprimer cette page ?',{title:'Supprimer ?',danger:true})) return;
  await deleteDoc(_pgRef(id)).catch(()=>{});
}

// Envoyer tous les joueurs vers une page spécifique (depuis la liste)
async function _vttSendToPage(pageId) {
  const p=VS.pages[pageId]; if (!p) return;
  await setDoc(_sesRef(),{activePageId:pageId},{merge:true}).catch(e=>{ console.error('[vtt] changement page', e); showNotif('Échec du changement de page', 'error'); });
  showNotif(`📡 Tous les joueurs → « ${p.name} »`,'success');
}

// Placer un token sur la page active (depuis le tray)
async function _vttPlace(tokenId, cell = null) {
  if (!VS.activePage) { showNotif('Crée d\'abord une page','error'); return; }
  // `cell` fourni = drop à l'emplacement voulu ; sinon clic → centre de la page.
  const cC = cell ? Math.max(0, Math.min(VS.activePage.cols-1, cell.col)) : Math.floor(VS.activePage.cols/2);
  const cR = cell ? Math.max(0, Math.min(VS.activePage.rows-1, cell.row)) : Math.floor(VS.activePage.rows/2);
  await updateDoc(_tokRef(tokenId),{pageId:VS.activePage.id,col:cC,row:cR,visible:true})
    .catch(()=>showNotif('Erreur placement','error'));
}
// Dupliquer un perso/PNJ déjà placé sur une autre page → nouveau token sur la page active.
// Le HP/PM/stats sont partagés via la fiche perso ; les buffs et état de tour restent par-instance.
async function _vttDuplicateOnPage(srcTokenId) {
  if (!STATE.isAdmin) return;
  if (!VS.activePage) { showNotif('Crée d\'abord une page','error'); return; }
  const src = VS.tokens[srcTokenId]?.data;
  if (!src) { showNotif('Token introuvable','error'); return; }
  if (src.type === 'enemy') { _vttDuplicateToken(srcTokenId); return; }
  const cC = Math.floor(VS.activePage.cols/2), cR = Math.floor(VS.activePage.rows/2);
  try {
    await addDoc(_toksCol(), {
      name: src.name || 'Token',
      type: src.type,
      characterId: src.characterId || null,
      npcId:       src.npcId       || null,
      beastId:     src.beastId     || null,
      ownerId:     src.ownerId     || null,
      pageId: VS.activePage.id, col: cC, row: cR,
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
  const t = VS.tokens[tokenId]?.data; if (!t) return;
  const key = t.characterId || t.npcId; // les ennemis (beastId) sont gérés par _vttDeleteToken
  let isDuplicate = false;
  if (key) {
    let count = 0;
    for (const e of Object.values(VS.tokens)) {
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
      VS.tokens[tokenId]?.shape?.destroy();
      delete VS.tokens[tokenId];
    } else {
      await updateDoc(_tokRef(tokenId),{pageId:null,visible:false});
      const entry = VS.tokens[tokenId];
      if (entry) {
        entry.shape?.destroy();
        VS.tokens[tokenId] = { data: { ...entry.data, pageId:null, visible:false }, shape:null };
      }
    }
  } catch (e) {
    console.error('[vtt] retire token:', e);
    showNotif('Erreur lors du retrait du token', 'error');
    return;
  }
  if (VS.selected===tokenId) _deselect();
  VS.layers.token?.batchDraw();
  _renderTraySoon();
  void _cleanupReserveDuplicates();
}
// Le joueur invoque son propre token sur la carte active
async function _vttInvokeMyToken(tokenId) {
  if (!VS.activePage) { showNotif('Aucune carte active','error'); return; }
  const uid = STATE.user?.uid; if (!uid) return;
  // Persos du joueur PAS sur la scène courante → invocables.
  const reserve = Object.values(VS.tokens)
    .filter(e => e.data?.ownerId === uid && e.data.pageId !== VS.activePage.id)
    .map(e => e.data);
  if (!reserve.length) { showNotif('Aucun personnage à invoquer','info'); return; }
  const tok = tokenId ? reserve.find(t => t.id === tokenId) : (reserve.length === 1 ? reserve[0] : null);
  if (!tok) { _vttMyTokenPicker(reserve, '_vttInvokeMyToken', '🧑 Quel personnage invoquer ?', '<span style="color:var(--gold-2,#7eb0ff)">🧑 Invoquer</span>'); return; }
  if (tokenId) closeModalDirect();
  const cC = Math.floor(VS.activePage.cols/2), cR = Math.floor(VS.activePage.rows/2);
  await updateDoc(_tokRef(tok.id),{pageId:VS.activePage.id,col:cC,row:cR,visible:true})
    .catch(err => { console.error('[vtt] invocation:', err); showNotif('Erreur invocation','error'); });
}
// Le joueur range un de ses persos présents sur la scène (retour en réserve).
async function _vttRetireMyToken(tokenId) {
  const uid = STATE.user?.uid; if (!uid) return;
  const onScene = Object.values(VS.tokens)
    .filter(e => e.data?.ownerId === uid && e.data.pageId && e.data.pageId === VS.activePage?.id)
    .map(e => e.data);
  if (!onScene.length) { showNotif('Aucun personnage à ranger','info'); return; }
  const tok = tokenId ? onScene.find(t => t.id === tokenId) : (onScene.length === 1 ? onScene[0] : null);
  if (!tok) { _vttMyTokenPicker(onScene, '_vttRetireMyToken', '📦 Quel personnage ranger ?', '<span style="color:var(--text-muted)">📦 Ranger</span>'); return; }
  if (tokenId) closeModalDirect();
  await updateDoc(_tokRef(tok.id),{pageId:null,visible:false})
    .catch(err => { console.error('[vtt] rangement:', err); showNotif('Erreur rangement','error'); });
  if (VS.selected===tok.id) _deselect();
}
// Sélecteur générique d'un de mes personnages (invoquer / ranger).
function _vttMyTokenPicker(toks, fn, title, actionHtml) {
  const cards = toks.map(t => {
    const ld = _live(t);
    const name = _esc(ld.displayName || t.name || 'Personnage');
    const img = ld.displayImage;
    const av = img
      ? `<img src="${_esc(img)}" alt="" style="width:38px;height:38px;border-radius:9px;object-fit:cover;flex-shrink:0">`
      : `<div style="width:38px;height:38px;border-radius:9px;display:flex;align-items:center;justify-content:center;background:rgba(79,140,255,.15);border:1px solid rgba(79,140,255,.3);font-weight:700;flex-shrink:0">${(name[0]||'?').toUpperCase()}</div>`;
    return `<button class="vtt-btn-sm" style="display:flex;align-items:center;gap:10px;width:100%;justify-content:flex-start;padding:8px 11px;height:auto"
      data-vtt-fn="${fn}" data-vtt-args="${_esc(t.id)}">
      ${av}<span style="flex:1;text-align:left;font-size:.85rem">${name}</span>${actionHtml}
    </button>`;
  }).join('');
  openModal(title, `<div style="display:flex;flex-direction:column;gap:8px;min-width:250px">${cards}</div>`);
}
// Déplacer le token vers une autre page
async function _vttMoveTokenToPage(tokenId,pageId) {
  if (!pageId) return;
  await updateDoc(_tokRef(tokenId),{pageId}).catch(()=>{});
}
// Sélectionner depuis le tray (place si non placé)
function _vttSelectFromTray(id) {
  const t=VS.tokens[id]?.data; if (!t) return;
  if (!t.pageId&&STATE.isAdmin) { _vttPlace(id); return; }
  if (t.pageId===VS.activePage?.id) _select(id);
}
async function _vttToggleVisible(id) {
  const t=VS.tokens[id]?.data; if (!t) return;
  await updateDoc(_tokRef(id),{visible:!t.visible}).catch(()=>{});
}
async function _vttClearBuffs(id) {
  if (!STATE.isAdmin) return;
  const t=VS.tokens[id]?.data; if (!t) return;
  await updateDoc(_tokRef(id),{buffs:[]}).catch(()=>{});
  showNotif('Buffs supprimés.','success');
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLERS — Conditions (états) sur les tokens
// ══════════════════════════════════════════════════════════════════════════════
/** Ouvre la modal de sélection d'un état à appliquer. */
// [getVttConditionLibrary → vtt-conditions.js]

export function _conditionSpellUsage(c = {}) {
  const su = c.spellUsage;
  return {
    enchantment: !!su?.enchantment,
    affliction: !!su?.affliction,
  };
}
// [Conditions sur tokens (_vttConditionApply/Remove/Save/Edit…) → vtt-conditions.js]

// ══════════════════════════════════════════════════════════════════════════════
// RÉGLAGES DES ÉTATS — modal accessible via le bouton ⚙ de la section États
// Sauvegardé dans world/conditions → utilisable sur toutes les aventures.
// Surcharge la librairie par défaut au chargement (loadConditions).
// ══════════════════════════════════════════════════════════════════════════════
export async function _loadConditionsOverrides() {
  CONDITION_LIBRARY = await loadConditionLibrary({ refresh: true, seedDefaults: STATE.isAdmin });
  _rebuildConditionIndex();
}

// [Modal réglages des états (_vttConditionConfig*) → vtt-conditions-config.js]

/** Helper : true si le token porte un état actif dont l'effet `effectKey` est truthy. */
function _hasConditionEffect(token, effectKey) {
  const round = VS.session?.combat?.round ?? 0;
  for (const c of (token?.conditions || [])) {
    if (c.expiresAtRound != null && round > 0 && round > c.expiresAtRound) continue;
    const eff = CONDITION_BY_ID[c.id]?.effects;
    if (eff && eff[effectKey]) return true;
  }
  return false;
}

/** Helper : retourne la liste des états actifs sur un token (objets {cond, lib}). */
export function _activeConditionsOf(token) {
  const round = VS.session?.combat?.round ?? 0;
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
  const round = VS.session?.combat?.round ?? 0;
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
/** Retire un buff à l'index donné (MJ uniquement). */
async function _vttRemoveBuff(tokenId, idx) {
  if (!STATE.isAdmin) return;
  const t = VS.tokens[tokenId]?.data; if (!t || !Array.isArray(t.buffs)) return;
  // Recalcule l'index parmi les buffs actifs (pour matcher l'affichage)
  const r = VS.session?.combat?.round ?? 0;
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

/** Cherche, dans le deck du perso d'un token, un sort Bouclier réactif
 *  (Réaction + Protection CA) utilisable : palier couvrant `rank` et PM dispo.
 *  Renvoie { spell, cost } (le moins cher) ou null. */
export function _findUsableReactiveShield(dtok, rank) {
  const char = _characterForToken(dtok);
  if (!char) return null;
  const curPm = _charPmCur(char);
  let chosen = null;
  for (const s of (char.deck_sorts || [])) {
    if (!s?.actif) continue;
    const br = _vttSpellMods(s)?.bouclierReactif;
    if (!br || !_shieldBlocks(br.tier, rank || 'classique')) continue;
    const cost = (Number.isFinite(s.pmOverride) && s.pmOverride >= 0) ? s.pmOverride : (parseInt(s.pm) || 0);
    if (cost > curPm) continue;
    if (!chosen || cost < chosen.cost) chosen = { char, spell: s, cost };
  }
  return chosen;
}

/** Bouclier réactif (Réaction + Protection) : annule LE coup reçu sélectionné
 *  dans le chat. Rend les PV infligés au porteur et consomme les PM du sort
 *  bouclier (PM NON remboursés). Pas de buff/état. */
async function _vttShieldCancelAttack(logId) {
  const m = (_chatMsgs || []).find(x => x.id === logId);
  if (!m || m.shieldCancelled) return;
  const dtok = VS.tokens[m.defenderTokenId]?.data;
  if (!dtok) { showNotif('Cible introuvable sur la carte', 'error'); return; }
  if (!STATE.isAdmin && !_canControlToken(dtok)) { showNotif('Ce n\'est pas ta cible', 'info'); return; }

  const pick = _findUsableReactiveShield(dtok, m.attackerRank || 'classique');
  if (!pick) { showNotif('Aucun bouclier réactif utilisable (palier d\'attaquant ou PM insuffisants)', 'info'); return; }

  // Restaure les PV infligés (cap au max) via _setHp (sync fiche perso incluse).
  const restore = Math.max(0, m.dmgTotal || 0);
  const lt = _live(dtok);
  const hpMax = m.hpMax ?? lt.displayHpMax ?? 20;
  const curHp = lt.displayHp ?? dtok.hp ?? 0;
  const newHp = Math.min(hpMax, curHp + restore);
  const curPm = _charPmCur(pick.char);

  try {
    await _setHp(dtok, newHp);
    await _syncDownedCondition(dtok, newHp);
    await updateDoc(_chrRef(pick.char.id), {
      ..._charPmPatch(Math.max(0, curPm - pick.cost)),
      vttControlTokenId: dtok.id,
    });
    await updateDoc(doc(_logCol(), logId), {
      shieldCancelled: true, shieldCancelledBy: STATE.user?.uid || null,
      shieldSpell: pick.spell.nom || 'Bouclier réactif',
    });
    showNotif(`🛡 ${pick.spell.nom || 'Bouclier réactif'} — coup annulé · +${restore} PV (−${pick.cost} PM)`, 'success');
  } catch (e) {
    console.error('[vtt] shield cancel', e);
    showNotif('Annulation refusée (permissions ?)', 'error');
  }
}

/** MJ : annule une action loggée dans le chat. Restaure l'état pré-action
 *  (snapshot `m.undo`) des entités impliquées : PV/PM rendus, buffs et états
 *  posés retirés. Réservé au MJ. Marque le log comme annulé. */
async function _vttUndoAction(logId) {
  if (!STATE.isAdmin) return;
  const m = (_chatMsgs || []).find(x => x.id === logId);
  if (!m || m.actionUndone || !m.undo) { showNotif('Action non annulable', 'info'); return; }
  const snap = m.undo;
  try {
    // Invocations : supprimer les tokens créés par l'action.
    for (const tid of (snap.createdTokens || [])) {
      await deleteDoc(_tokRef(tid)).catch(() => {});
      VS.tokens[tid]?.shape?.destroy?.();
      delete VS.tokens[tid];
    }
    // Zones de sort persistantes créées par l'action.
    for (const aid of (snap.createdAnnots || [])) {
      _annotations[aid]?.shape?.destroy?.();
      delete _annotations[aid];
      await deleteDoc(_annotRef(aid)).catch(() => {});
    }
    for (const [tid, st] of Object.entries(snap.tokens || {})) {
      const t = VS.tokens[tid]?.data;
      const patch = { buffs: st.buffs || [], conditions: st.conditions || [] };
      if (st.pvCombatHp != null) patch.pvCombatHp = st.pvCombatHp;
      // PM porté par le token (créatures bestiaire / invocations) → rendu.
      if (st.pm != null)       patch.pm = st.pm;
      if (st.pmCombat != null) patch.pmCombat = st.pmCombat;
      await updateDoc(_tokRef(tid), patch).catch(() => {});
      if (t && st.hp != null) await _setHp(t, st.hp).catch(() => {});
    }
    for (const [cid, st] of Object.entries(snap.chars || {})) {
      if (st.pm != null) await updateDoc(_chrRef(cid), _charPmPatch(st.pm)).catch(() => {});
    }
    // Statistiques : réverse le delta enregistré avec l'action (décrémente).
    if (m.statsDelta) applyStatsDelta(m.statsDelta, -1);
    await updateDoc(doc(_logCol(), logId), { actionUndone: true, actionUndoneBy: STATE.user?.uid || null }).catch(() => {});
    showNotif('↩ Action annulée — PV/PM/états restaurés', 'success');
  } catch (e) {
    console.error('[vtt] undo action', e);
    showNotif('Annulation échouée', 'error');
  }
}

/** Ouvre une modale simple pour ajouter manuellement un effet sur le token (MJ). */
async function _vttAddBuffPrompt(tokenId) {
  if (!STATE.isAdmin) return;
  const t = VS.tokens[tokenId]?.data; if (!t) return;
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
  const t = VS.tokens[tokenId]?.data; if (!t) return;
  const type    = document.getElementById('vab-type')?.value || 'ca';
  const label   = document.getElementById('vab-label')?.value?.trim() || 'Effet manuel';
  const bonus   = parseInt(document.getElementById('vab-bonus')?.value) || 0;
  const formula = document.getElementById('vab-formula')?.value?.trim() || '';
  const effect  = document.getElementById('vab-effect')?.value?.trim() || '';
  const durRaw  = document.getElementById('vab-dur')?.value;
  const dur     = durRaw === '' ? null : Math.max(0, parseInt(durRaw) || 0);
  const round = VS.session?.combat?.round ?? 0;
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
  const t=VS.tokens[tokenId]?.data; if (!t) return;
  // Détecte une perte de PV pour déclencher un JS de concentration auto
  const lT = _live(t);
  const prevHp = lT.displayHp ?? t.hp ?? null;
  const newHp  = Math.max(0, hp);
  const delta  = prevHp != null ? Math.max(0, prevHp - newHp) : 0;
  let hpUpdated = false;
  await _setHp(t,hp).then(() => { hpUpdated = true; }).catch(()=>{});
  if (delta > 0) {
    if (hpUpdated && t.characterId) {
      const ko = prevHp > 0 && newHp <= 0;
      const name = lT.displayName ?? t.name ?? '';
      bumpDamageTaken(t.characterId, name, delta, { ko });
      bumpBiggestTaken(t.characterId, name, delta);
    }
    const notes = await _vttTriggerConcentrationSave(t, delta, newHp);
    notes.forEach(msg => showNotif(msg, msg.startsWith('💢') ? 'error' : 'info'));
  }
}
async function _vttSetPm(tokenId,pm) {
  const t=VS.tokens[tokenId]?.data; if (!t) return;
  const v=Math.max(0,pm);
  if (t.characterId) await updateDoc(_chrRef(t.characterId), { ..._charPmPatch(v), vttControlTokenId:tokenId }).catch(()=>{});
  else if (t.npcId)  await updateDoc(_npcRef(t.npcId),{pmCurrent:v}).catch(()=>{});
}

async function _vttSwitchCharacterBuild(charId, buildId) {
  const c = VS.characters[charId]; if (!c) return;
  const controlledToken = Object.values(VS.tokens || {})
    .map(e => e?.data)
    .find(t => t?.characterId === charId && _canControlToken(t));
  if (!STATE.isAdmin && !controlledToken) {
    showNotif("Tu ne contrôles pas ce personnage.", "error");
    return;
  }
  const target = switchBuild(c, buildId);
  if (!target) return;
  const payload = buildProjectionPatch(c, target);
  VS.characters[charId] = { ...c, ...payload };
  try {
    await updateDoc(_chrRef(charId), payload);
    showNotif(`Build actif : ${target.name || 'Build'}`, 'success');
  } catch (e) {
    console.error('[vtt] switch build', e);
    showNotif("Impossible de changer de build.", "error");
    return;
  }
  Object.entries(VS.tokens || {}).forEach(([tokenId, entry]) => {
    if (entry?.data?.characterId !== charId) return;
    _patchShape(tokenId);
    if (VS.selected === tokenId) _renderInspectorSoon();
    _refreshRanges(tokenId);
  });
  _renderTraySoon();
  if (controlledToken?.id && VS.selected === controlledToken.id && !_aimOpt) _showActBar(controlledToken.id);
}

// Bonus temporaire manuel (Mouvement / CA / Portée) via le système de BUFFS du
// token. Avantages : déjà intégré dans displayMovement/Defense/Range ET la
// logique de jeu (portée d'attaque, déplacement sur le plateau), et les `buffs`
// sont écrivables par le joueur ET le MJ (règle Firestore vttTokens).
// [_MS_BONUS_BUFF → vtt-constants.js (importé en haut)]
// Lit la valeur du buff manuel d'un type donné sur un token.
export function _manualBuffVal(t, key) {
  const cfg = _MS_BONUS_BUFF[key]; if (!cfg) return 0;
  const b = (t?.buffs || []).find(x => x && x.type === cfg.type && x.manual);
  return b ? (parseInt(b.bonus) || 0) : 0;
}
async function _vttTokenBonus(tokenId, key, delta) {
  const t = VS.tokens[tokenId]?.data; if (!t) return;
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
  if (VS.tokens[tokenId]) VS.tokens[tokenId].data = { ...t, buffs }; // optimiste
  await updateDoc(_tokRef(tokenId), { buffs }).catch(() => {});
  _renderInspector(VS.tokens[tokenId]?.data || t);
  _patchShape(tokenId);
}
async function _vttTokenResetBonus(tokenId) {
  const t = VS.tokens[tokenId]?.data; if (!t) return;
  if (!_canControlToken(t)) return;
  const buffs = (t.buffs || []).filter(b => !(b && b.manual));
  if (VS.tokens[tokenId]) VS.tokens[tokenId].data = { ...t, buffs };
  await updateDoc(_tokRef(tokenId), { buffs }).catch(() => {});
  _renderInspector(VS.tokens[tokenId]?.data || t);
  _patchShape(tokenId);
}

async function _vttMsSetXp(charId, uid, xp) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  const val = Math.max(0, Math.round(xp));
  await updateDoc(_chrRef(charId), { exp: val }).catch(() => {});
  c.exp = val;
  _renderMiniSheet(uid);
}

async function _vttMsAddXp(charId, uid, delta) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  const d = Math.round(delta);
  if (!d || d <= 0) return;
  const newXp = Math.max(0, (parseInt(c.exp) || 0) + d);
  await updateDoc(_chrRef(charId), { exp: newXp }).catch(() => {});
  c.exp = newXp;
  _renderMiniSheet(uid);
}

async function _vttMsSetNiveau(charId, uid, niveau) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  const val = Math.max(1, Math.min(20, Math.round(niveau)));
  await updateDoc(_chrRef(charId), { niveau: val }).catch(() => {});
  c.niveau = val;
  _renderMiniSheet(uid);
}

async function _vttMsSetHp(charId, uid, hp) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  if (!STATE.isAdmin && c.uid !== STATE.user?.uid) return;
  const max = calcPVMax(c);
  const val = Math.max(0, Math.min(max, Math.round(hp)));
  await updateDoc(_chrRef(charId), { hp: val }).catch(() => {});
  c.hp = val;
  _renderMiniSheet(uid);
}

async function _vttMsSetPm(charId, uid, pm) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  if (!STATE.isAdmin && c.uid !== STATE.user?.uid) return;
  const max = calcPMMax(c);
  const val = Math.max(0, Math.min(max, Math.round(pm)));
  await updateDoc(_chrRef(charId), _charPmPatch(val)).catch(() => {});
  c.pm = val;
  c.pmActuel = val;
  _renderMiniSheet(uid);
}
function _vttEditToken(id) { return _openStatsModal(VS.tokens[id]?.data??null); }

// ═══════════════════════════════════════════════════════════════════
// DÉLÉGATION DE CONTRÔLE — autoriser d'autres joueurs sur son token
// ═══════════════════════════════════════════════════════════════════
// Construit un descripteur enrichi d'un membre {uid, pseudo, charName, photo, aura, isAdmin, isGhost}
// isGhost = compte présent dans adventure.players mais sans aucun personnage rattaché
//           ET qui n'est pas admin → résidu de base de données, à ne pas proposer.
function _vttMemberInfo(uid) {
  const adv = STATE.adventure || {};
  const ch = Object.values(VS.characters || {}).find(c => c?.uid === uid);
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
  const t = VS.tokens[tokenId]?.data; if (!t) return '';
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
  const t = VS.tokens[tokenId]?.data; if (!t) return;
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
  const t = VS.tokens[tokenId]?.data; if (!t || !targetUid) return;
  const uid = STATE.user?.uid;
  const isOwner = uid && t.ownerId === uid;
  if (!isOwner && !STATE.isAdmin) return;
  const cur = Array.isArray(t.controlDelegates) ? t.controlDelegates : [];
  const wasOn = cur.includes(targetUid);
  const next = wasOn ? cur.filter(u => u !== targetUid) : [...cur, targetUid];
  try {
    await updateDoc(_tokRef(tokenId), { controlDelegates: next });
    // Mise à jour optimiste du cache local pour rafraîchir immédiatement la modal
    if (VS.tokens[tokenId]?.data) VS.tokens[tokenId].data.controlDelegates = next;
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
// [Combat: reset tour + flags (_vttResetTurn/_vttToggleTurnFlag) → vtt-combat-turns.js]

async function _vttAddImageUrl() {
  let url=(await promptModal('Colle l\'URL d\'une image (ex. carte hébergée dans un dossier GitHub) :', { title: '🔗 Carte par URL', placeholder: 'https://…github.io/le-grand-jdr/images/maps/…', required: true }))?.trim(); if (!url||!VS.activePage) return;
  url = normalizeImageUrl(url);   // tolère github.com/.../tree/... (page web) + encode les espaces du nom
  const imgs=[...(VS.activePage.backgroundImages??[]),{id:Date.now().toString(),url,x:0,y:0,w:VS.activePage.cols,h:VS.activePage.rows}];
  try {
    await updateDoc(_pgRef(VS.activePage.id),{backgroundImages:imgs});
    // Sauver dans la bibliothèque pour réutilisation (même flux que l'upload).
    const entry = { id: crypto.randomUUID(), url, name: (url.split('/').pop()||'Carte').split('?')[0], folderId: _libFolder || null };
    setDoc(_mapLibRef(), { folders: VS.mapLib.folders||[], images: [...(VS.mapLib.images||[]), entry] }).catch(()=>{});
    showNotif('Carte ajoutée par URL !', 'success');
  } catch (e) { console.error('[vtt] ajout image fond', e); showNotif("Échec de l'ajout de l'image de fond", 'error'); }
}
function _vttUploadClick() { return document.getElementById('vtt-img-input')?.click(); }

// [Combat: démarrer/terminer + round suivant (_vttToggleCombat/_vttNextRound) → vtt-combat-turns.js]

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
      pageId: VS.activePage?.id||null,
      col: VS.activePage ? Math.min(VS.activePage.cols-1, Math.floor(VS.activePage.cols/2)+i) : i,
      row: VS.activePage ? Math.floor(VS.activePage.rows/2) : 0,
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
  const t=VS.tokens[tokenId]?.data; if (!t) return;
  const baseName=t.name.replace(/ \d+$/, '');
  const sameGroup=Object.values(VS.tokens).filter(e=>
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
    pageId: VS.activePage?.id||null,
    col: VS.activePage ? Math.min(VS.activePage.cols-1,(t.col||0)+sameGroup.length) : 0,
    row: t.row||0,
    visible: true,
    movedThisTurn: false, attackedThisTurn: false, bonusActionThisTurn: false, reactionThisTurn: false,
    createdAt: serverTimestamp(),
  }).catch(()=>showNotif('Erreur duplication','error'));
  showNotif(`👹 ${baseName} ${num} créé !`,'success');
}

// Placer une instance depuis le bestiaire (crée + place sur la page active)
async function _vttPlaceFromBestiary(beastId, cell = null) {
  if (!STATE.isAdmin) return;
  if (!VS.activePage) return showNotif('Aucune page active — ouvre une page d\'abord','error');
  const b=VS.bestiary[beastId]; if (!b) return;
  // Purger les tokens fantômes (anciens auto-créés, non placés, non modifiés)
  const ghosts=Object.values(VS.tokens).filter(e=>e.data.beastId===beastId&&!e.data.pageId&&e.data.hp==null);
  if (ghosts.length) {
    const batch=writeBatch(db);
    ghosts.forEach(g=>batch.delete(_tokRef(g.data.id)));
    await batch.commit().catch(()=>{});
  }
  // Numérotation d'après les créatures de ce bestiaire PRÉSENTES SUR LA PAGE
  // COURANTE : supprimer/retirer une créature libère son numéro → le compteur se
  // "réinitialise" naturellement (Loup 1, 2… repartent de 1 quand la page est vidée),
  // et les créatures d'autres pages n'inflent plus le compteur.
  const active=Object.values(VS.tokens).filter(e=>e.data.beastId===beastId&&e.data.pageId===VS.activePage.id);
  const usedNums=new Set(active.map(e=>{const m=(e.data.name||'').match(/\s(\d+)$/);return m?parseInt(m[1]):1;}));
  let num=1; while(usedNums.has(num))num++;
  const name=num===1?(b.nom||'Créature'):`${b.nom} ${num}`;
  const sw = Math.max(1, Math.min(5, b.tokenW || b.tokenSize || 1));
  const sh = Math.max(1, Math.min(5, b.tokenH || b.tokenSize || 1));
  // `cell` fourni = drop à l'emplacement voulu ; sinon clic → centre décalé par le
  // nombre de créatures déjà posées (évite l'empilement).
  const cx = cell ? cell.col : Math.floor(VS.activePage.cols/2) + active.length;
  const cy = cell ? cell.row : Math.floor(VS.activePage.rows/2);
  const ref=doc(_toksCol());
  await setDoc(ref,{
    name, type:'enemy',
    characterId:null, npcId:null, beastId,
    ownerId:null,
    pageId:VS.activePage.id,
    col:Math.max(0,Math.min(VS.activePage.cols-sw,cx)),
    row:Math.max(0,Math.min(VS.activePage.rows-sh,cy)),
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
  const t=VS.tokens[tokenId]?.data; if (!t||t.type!=='enemy') return;
  if (!await confirmModal(`Supprimer définitivement <b>${_esc(t.name)}</b> ?`, { title: 'Token', confirmLabel: 'Supprimer' })) return;
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
  const cur = VS.tokens[id]?.data;
  if (cur && VS.activePage) {
    const b = cur.beastId ? VS.bestiary[cur.beastId] : null;
    const sw = patch.tokenW ?? b?.tokenW ?? b?.tokenSize ?? 1;
    const sh = patch.tokenH ?? b?.tokenH ?? b?.tokenSize ?? 1;
    patch.col = Math.max(0, Math.min(VS.activePage.cols - sw, cur.col ?? 0));
    patch.row = Math.max(0, Math.min(VS.activePage.rows - sh, cur.row ?? 0));
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
  if (!file||!VS.activePage) return;
  if (!hasCloudinaryConfig()) {
    showNotif('Configure ta config Cloudinary d\'abord (bouton 🔑)','error');
    openCloudinaryConfigModal();
    if (!hasCloudinaryConfig()) return;
  }
  showNotif('Upload en cours…','success');
  try {
    const up = await uploadCloudinary(file, { folder: 'maps', tags: ['map'] });
    const url = up.url;
    const imgs=[...(VS.activePage.backgroundImages??[]),{id:Date.now().toString(),url,x:0,y:0,w:VS.activePage.cols,h:VS.activePage.rows}];
    await updateDoc(_pgRef(VS.activePage.id),{backgroundImages:imgs});
    // Sauver dans la bibliothèque
    const entry = { id: crypto.randomUUID(), url, name: file.name, folderId: _libFolder || null };
    const updLib = { folders: VS.mapLib.folders||[], images: [...(VS.mapLib.images||[]), entry] };
    setDoc(_mapLibRef(), updLib).catch(()=>{});
    showNotif('Image ajoutée !','success');
  } catch(e) { console.error(e); showNotif('Erreur upload : '+e.message,'error'); }
}

// ── Outil + clavier ─────────────────────────────────────────────────
function _setTool(tool) {
  VS.tool = tool;
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
  fogToggleEditMode(tool === 'walls', VS.activePage);
  if (tool === 'walls') fogRenderWalls(VS.activePage, true);
  else if (VS.activePage) fogRenderWalls(VS.activePage, STATE.isAdmin); // quitter édition → redraw normal
  // Règle : effacer si on quitte
  if (tool !== 'ruler') { _clearRuler(); _hideRulerHover(); }
  // Polygone : abandonner un tracé en cours si on quitte le dessin
  if (tool !== 'draw') _polyCancel();
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

// ── Copier / coller (Ctrl+C / Ctrl+V) : tokens + dessins ─────────────
// Presse-papier interne (mémoire de session). Capture les data sélectionnées ;
// le collage recrée des docs neufs, décalés d'une demi-case pour ne pas se
// superposer. Tokens = MJ uniquement (règle vttTokens). Dessins = chacun les
// siens (createdBy = soi).
function _vttCopySelection() {
  const tokIds   = VS.selectedMulti.size > 0 ? [...VS.selectedMulti] : (VS.selected ? [VS.selected] : []);
  const annotIds = _selectedAnnotIds.size > 0 ? [..._selectedAnnotIds] : (_selectedAnnotId ? [_selectedAnnotId] : []);
  const tokens = tokIds.map(id => VS.tokens[id]?.data).filter(Boolean).map(d => ({ ...d }));
  const annots = annotIds.map(id => _annotations[id]?.data).filter(Boolean).map(d => ({ ...d }));
  if (!tokens.length && !annots.length) return false;
  _vttClipboard = { tokens, annots };
  const parts = [];
  if (tokens.length) parts.push(`${tokens.length} token${tokens.length > 1 ? 's' : ''}`);
  if (annots.length) parts.push(`${annots.length} dessin${annots.length > 1 ? 's' : ''}`);
  showNotif(`📋 Copié : ${parts.join(' + ')}`, 'info');
  return true;
}

async function _vttPasteClipboard() {
  const { tokens, annots } = _vttClipboard;
  if (!tokens.length && !annots.length) return;
  if (!VS.activePage) { showNotif('Aucune page active', 'error'); return; }
  const pg = VS.activePage;
  const D  = Math.round(CELL * 0.5);
  let nTok = 0, nAnnot = 0;

  // Dessins : autorisés à tous (createdBy = soi).
  for (const a of annots) {
    const { id: _oid, createdAt: _ca, ...base } = a;
    const data = { ...base, pageId: pg.id, createdBy: STATE.user?.uid || null, createdAt: serverTimestamp() };
    if (_ANNOT_PTS_TYPES.has(data.type)) {
      data.offsetX = (data.offsetX || 0) + D; data.offsetY = (data.offsetY || 0) + D;
    } else {
      data.x = (data.x || 0) + D; data.y = (data.y || 0) + D;
    }
    const nid = 'a' + Date.now() + Math.random().toString(36).slice(2, 5);
    try { await setDoc(_annotRef(nid), data); _pushDrawHistory(nid); nAnnot++; }
    catch (e) { console.error('[vtt] paste annot', e); }
  }

  // Tokens : création réservée au MJ (règle Firestore vttTokens = isAdvAdmin).
  if (tokens.length && STATE.isAdmin) {
    const batch = writeBatch(db);
    for (const t of tokens) {
      const { id: _tid, createdAt: _ca, ...base } = t;
      const ref = doc(_toksCol());
      batch.set(ref, { ...base,
        pageId: pg.id,
        col: Math.max(0, Math.min(pg.cols - 1, (t.col || 0) + 1)),
        row: Math.max(0, Math.min(pg.rows - 1, (t.row || 0) + 1)),
        visible: true,
        movedThisTurn: false, attackedThisTurn: false, bonusActionThisTurn: false, reactionThisTurn: false,
        createdAt: serverTimestamp() });
      nTok++;
    }
    try { await batch.commit(); }
    catch (e) { console.error('[vtt] paste tokens', e); showNotif('Erreur collage tokens', 'error'); nTok = 0; }
  } else if (tokens.length) {
    showNotif('Coller des tokens est réservé au MJ', 'info');
  }

  const parts = [];
  if (nTok)   parts.push(`${nTok} token${nTok > 1 ? 's' : ''}`);
  if (nAnnot) parts.push(`${nAnnot} dessin${nAnnot > 1 ? 's' : ''}`);
  if (parts.length) showNotif(`📌 Collé : ${parts.join(' + ')}`, 'success');
}

// Échap : ferme le premier panneau flottant ouvert (dés, musique, butin,
// repos, émotes) ou le HUD d'action. Renvoie true si quelque chose a été fermé.
function _vttEscapeCloseFloaters() {
  const panels = [
    ['vtt-dice-panel',  _closeDicePanel],
    ['vtt-music-panel', _closeMusicPanel],
    ['vtt-loot-panel',  _closeLootPanel],
    ['vtt-rest-panel',  _closeShortRest],
  ];
  for (const [id, close] of panels) {
    if (document.getElementById(id)?.dataset.open === '1') { close(); return true; }
  }
  if (document.getElementById('vtt-emote-picker')?.classList.contains('open')) { _closeEmotePicker(); return true; }
  if (document.getElementById('vtt-action-hud')?.classList.contains('show'))    { _hideActBar();      return true; }
  return false;
}

function _keyHandler(e) {
  if (!document.getElementById('vtt-canvas-wrap')) return;
  const typingTarget = _vttIsTypingTarget(e.target);

  // Échap : traité AVANT le filtre de saisie, pour fermer un panneau dont le
  // champ de recherche a le focus (émotes, dés, musique…).
  if (e.key === 'Escape') {
    // a) Modale ouverte → la modale gère sa propre fermeture (ne pas désélectionner derrière).
    if (document.getElementById('modal-overlay')?.classList.contains('show')) return;
    // b) Visée en cours → écouteur dédié (_aimCancel) s'en charge.
    if (_aimOpt || _aimSrcId) return;
    // c) Fermer un panneau flottant / le HUD d'action (même si un de leurs champs a le focus).
    if (_vttEscapeCloseFloaters()) { e.preventDefault(); if (typeof e.target.blur === 'function') e.target.blur(); return; }
    // d) Focus dans un champ de saisie hors panneau (chat, notes…) → on se contente de blur.
    if (typingTarget) { if (typeof e.target.blur === 'function') e.target.blur(); return; }
    // d-bis) Polygone en cours → annuler le tracé (sans quitter l'outil dessin).
    if (_polyActive) { _polyCancel(); e.preventDefault(); return; }
    // e) Outil ≠ sélection → revenir à l'outil sélection.
    if (VS.tool !== 'select') { _setTool('select'); e.preventDefault(); return; }
    // f) Désélectionner tokens ET dessins.
    if (VS.selected || VS.selectedMulti.size || _selectedAnnotId || _selectedAnnotIds.size) {
      _deselect(); _deselectAnnot(); e.preventDefault();
    }
    return;
  }

  // Autres raccourcis : ignorés quand la frappe vise un champ de saisie.
  if (typingTarget) return;
  // Entrée : ferme le polygone en cours.
  if (e.key === 'Enter' && _polyActive) { e.preventDefault(); _polyFinish(); return; }
  // Ctrl+C / Ctrl+V : copier / coller la sélection (tokens + dessins)
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
    if (_vttCopySelection()) e.preventDefault();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'v' || e.key === 'V')) {
    if (_vttClipboard.tokens.length || _vttClipboard.annots.length) { e.preventDefault(); _vttPasteClipboard(); }
    return;
  }
  // Raccourci R : bascule l'outil règle (sans modificateur, hors saisie)
  if ((e.key==='r' || e.key==='R') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    _vttTool('ruler');
  }
  if ((e.key==='Delete'||e.key==='Backspace') && VS.tool==='select') {
    // 1) Annotations sélectionnées
    if (_selectedAnnotIds.size > 0) {
      e.preventDefault();
      [..._selectedAnnotIds].forEach(id => deleteDoc(_annotRef(id)).catch(()=>{}));
      _deselectAnnot();
    }
    // 2) Image de carte sélectionnée (MJ, mode édition)
    else if (STATE.isAdmin && VS.selImg && VS.mapMode && VS.activePage) {
      e.preventDefault();
      const imgs = (VS.activePage.backgroundImages ?? []).filter(i => i.id !== VS.selImg);
      updateDoc(_pgRef(VS.activePage.id), { backgroundImages: imgs }).catch(e=>{ console.error('[vtt] suppr image carte', e); showNotif("Échec de la suppression de l'image de carte", 'error'); });
      VS.selImg = null;
      VS.imgTr?.nodes([]); VS.imgTrFg?.nodes([]);
      VS.layers.map?.batchDraw(); VS.layers.mapFg?.batchDraw();
    }
    // 3) Tokens sélectionnés → retrait du canvas (pageId=null)
    else {
      const ids = VS.selectedMulti.size > 0 ? [...VS.selectedMulti] : (VS.selected ? [VS.selected] : []);
      if (ids.length) {
        e.preventDefault();
        const uid = STATE.user?.uid;
        for (const id of ids) {
          const t = VS.tokens[id]?.data; if (!t) continue;
          if (STATE.isAdmin || t.ownerId === uid) {
            updateDoc(_tokRef(id), { pageId: null, visible: false }).catch(()=>{});
          }
        }
        _deselect();
      }
    }
  }
  // Ctrl+Z : en mode édition murs → annuler la dernière pose (mur/lumière/zone) ;
  // sinon → annuler le dernier tracé d'annotation.
  if ((e.ctrlKey||e.metaKey) && e.key==='z' && !e.shiftKey) {
    e.preventDefault();
    if (fogIsEditMode()) { if (!fogUndo()) showNotif('Rien à annuler', 'info'); }
    else _vttUndoDraw();
  }
  // Ctrl+Y (ou Ctrl+Shift+Z) : rétablir la dernière annulation (fog ou tracé).
  if ((e.ctrlKey||e.metaKey) && (e.key==='y' || (e.key==='z' && e.shiftKey))) {
    e.preventDefault();
    if (fogIsEditMode()) { if (!fogRedo()) showNotif('Rien à rétablir', 'info'); }
    else _vttRedoDraw();
  }
  // Flèches / pavé numérique : déplacer le token sélectionné
  if (!e.ctrlKey && !e.metaKey && !e.altKey && VS.selected) {
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

// [Bibliothèque de cartes (catalogue MJ) → vtt-maplib.js (importée en haut)]

// [BUTIN D'AVENTURE → vtt-loot.js]

// ═══════════════════════════════════════════════════════════════════
// [LANCEUR DE DÉS LIBRE → vtt-dice.js]

// [block musique → vtt-music.js]

// [TIMER DE SESSION → vtt-timer.js]

// ═══════════════════════════════════════════════════════════════════
// [COMBAT TRACKER → vtt-combat-tracker.js]

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
        <button class="vtt-btn-sm" data-vtt-fn="_vttAddImageUrl" title="Ajouter une carte par URL (ex. image hébergée dans un dossier GitHub) — gratuit, sauvegardée dans la bibliothèque">🔗 URL</button>
        ${CLOUDINARY_ENABLED?`<label  class="vtt-btn-sm vtt-upload-lbl" title="Upload une image via Cloudinary — sauvegardée dans la bibliothèque">⬆ Upload<input type="file" id="vtt-img-input" accept="image/*" hidden></label>
        <button class="vtt-btn-sm" data-vtt-fn="_vttSetImgbbKey" title="Configurer Cloudinary (cloud name + upload preset)">🔑</button>`:''}`:''}
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
      <div class="vtt-tray-tabs" role="tablist">
        <button class="vtt-tray-tab${_trayTab==='scenes'?' active':''}" data-tab="scenes" data-vtt-fn="_vttTrayTab" data-vtt-args="scenes" title="Scènes &amp; pages"><span class="vtt-tt-ic">🗺</span>Scènes</button>
        <button class="vtt-tray-tab${_trayTab==='reserve'?' active':''}" data-tab="reserve" data-vtt-fn="_vttTrayTab" data-vtt-args="reserve" title="Réserve (joueurs / PNJ)"><span class="vtt-tt-ic">👥</span>Réserve</button>
        <button class="vtt-tray-tab${_trayTab==='bestiary'?' active':''}" data-tab="bestiary" data-vtt-fn="_vttTrayTab" data-vtt-args="bestiary" title="Bestiaire"><span class="vtt-tt-ic">🐾</span>Bestiaire</button>
        <button class="vtt-tray-tab${_trayTab==='images'?' active':''}" data-tab="images" data-vtt-fn="_vttTrayTab" data-vtt-args="images" title="Bibliothèque d'images"><span class="vtt-tt-ic">🖼</span>Images</button>
      </div>
      <div class="vtt-tray-views">
        <div class="vtt-tray-view${_trayTab==='scenes'?' active':''}" data-view="scenes">
          <div class="vtt-tray-section-hd"><span>Pilotage des scènes</span></div>
          <div id="vtt-tray-pages">${loadingHtml('Chargement…', { compact: true })}</div>
          <div class="vtt-tray-section-hd vtt-scene-tok-hd"><span>🗺 Sur la scène</span></div>
          <div id="vtt-scene-tokens"></div>
        </div>
        <div class="vtt-tray-view${_trayTab==='reserve'?' active':''}" data-view="reserve"><div id="vtt-reserve-body"></div></div>
        <div class="vtt-tray-view${_trayTab==='bestiary'?' active':''}" data-view="bestiary">
          <div class="vtt-tray-section-hd"><span>👹 Bestiaire</span><button class="vtt-tray-add-btn" data-vtt-fn="_vttCreateEnemy" title="Créer un ennemi">＋</button></div>
          <div id="vtt-bestiary-body"></div>
        </div>
        <div class="vtt-tray-view${_trayTab==='images'?' active':''}" data-view="images">
          <div id="vtt-tray-library"></div>
        </div>
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
  <div class="vtt-hint">Clic token allié → portée · Clic ennemi → attaque · Ctrl+clic → sélection multiple · Échap désélect. · Molette zoom · Clic-droit pan${mj?' · Clic image → redimensionner':''}</div>
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
  const { navigate } = await import('../../core/navigation.js');
  navigate('dashboard');
}
async function _vttOpenSource(kind, id = '', tab = '') {
  const { navigate } = await import('../../core/navigation.js');
  if (kind === 'char') {
    if (!id) { showNotif('Personnage source introuvable.', 'error'); return; }
    const { setTargetCharacter } = await import('../../shared/character-navigation.js');
    setTargetCharacter(id, tab || null);
    navigate('characters');
    return;
  }
  if (id && (kind === 'npc' || kind === 'bestiary' || kind === 'shop')) {
    const { setTargetEntity } = await import('../../shared/entity-navigation.js');
    setTargetEntity(kind, id, { mode: tab || '' });
  }
  const page = {
    npc: 'npcs',
    bestiary: 'bestiaire',
    shop: 'shop',
  }[kind];
  if (!page) { showNotif('Source introuvable.', 'error'); return; }
  navigate(page);
}
export function _vttLogSourceFields(t) {
  return {
    sourceTokenId: t?.id || null,
    sourceCharacterId: t?.characterId || null,
    sourceNpcId: t?.npcId || null,
    sourceBeastId: t?.beastId || null,
  };
}
export function _vttLogTargetFields(t) {
  return {
    tokenId: t?.id || null,
    characterId: t?.characterId || null,
    npcId: t?.npcId || null,
    beastId: t?.beastId || null,
  };
}
export function _vttLogSingleTargetFields(targetIds = []) {
  if (!Array.isArray(targetIds) || targetIds.length !== 1) return {};
  return _vttLogTargetFields(VS.tokens[targetIds[0]]?.data);
}
async function _vttEnterTable() {
  _vttEntered = true;
  const content = document.getElementById('main-content');
  if (content) await _vttMountTable(content);
}

// Échappatoire du bandeau « tourne ton téléphone » : une fois rejeté, on ne le
// ré-affiche plus de la session (persiste aux re-rendus et à la navigation SPA).
let _vttRotateDismissed = (() => { try { return sessionStorage.getItem('vtt-rotate-dismissed') === '1'; } catch { return false; } })();

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
  // Bouton d'échappatoire : si l'orientation ne bascule jamais (verrouillage
  // d'écran, navigateur in-app, émulateur…), le joueur n'est jamais bloqué.
  content.insertAdjacentHTML('beforeend', `
    <div class="vtt-rotate-prompt${_vttRotateDismissed ? ' dismissed' : ''}" aria-hidden="true">
      <div class="vtt-rotate-phone">📱</div>
      <div class="vtt-rotate-title">Tourne ton téléphone</div>
      <div class="vtt-rotate-text">La Table Virtuelle est plus confortable en mode paysage.</div>
      <button class="vtt-rotate-dismiss" data-vtt-fn="_vttDismissRotate">Utiliser quand même</button>
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
      <button class="vtt-tool" data-vtt-fn="_vttCenterOnMyToken" title="Recentrer sur mon personnage" aria-label="Recentrer sur mon personnage">⌖</button>
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
          <button class="vtt-draw-btn"        id="vtt-ds-poly"    data-vtt-fn="_vttDrawShape" data-vtt-args="poly"    title="Polygone (triangle, etc.) — un clic par sommet · double-clic ou clic sur le 1er point pour fermer · clic droit annule le dernier sommet · Échap annule">△</button>
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
          <button class="vtt-draw-btn" id="vtt-draw-redo-btn" data-vtt-fn="_vttRedoDraw" title="Rétablir le dernier tracé annulé (Ctrl+Y)">↪</button>
          ${STATE.isAdmin?`<button class="vtt-draw-btn vtt-draw-btn--danger" data-vtt-fn="_vttClearAnnots" title="Tout effacer les annotations de la page">🗑</button>`:''}
        </div>
      </div>
    </div>
    ${STATE.isAdmin?`
    <div id="vtt-walls-bar" class="vtt-walls-bar" style="display:none">
      <div class="vtt-walls-row">
        <div class="vtt-walls-grp">
          <span class="vtt-walls-grp-lbl">Structures</span>
          <button class="vtt-btn-sm active" data-fog-tool="wall"   data-vtt-fn="_vttFogTool" data-vtt-args="wall"   title="Tracer un mur (bloque vision + déplacement)">🧱 Mur</button>
          <button class="vtt-btn-sm"        data-fog-tool="door"   data-vtt-fn="_vttFogTool" data-vtt-args="door"   title="Tracer une porte (ouvrable)">🚪 Porte</button>
          <button class="vtt-btn-sm"        data-fog-tool="window" data-vtt-fn="_vttFogTool" data-vtt-args="window" title="Tracer une fenêtre (laisse passer la vision, bloque le passage)">🪟 Fenêtre</button>
        </div>
        <div class="vtt-walls-grp">
          <span class="vtt-walls-grp-lbl">Lumière</span>
          <button class="vtt-btn-sm"        data-fog-tool="light"  data-vtt-fn="_vttFogTool" data-vtt-args="light"  title="Placer une source lumineuse">💡 Source</button>
          <button class="vtt-btn-sm" id="vtt-fog-toggle" data-vtt-fn="_vttToggleFog" title="Activer / désactiver l'éclairage dynamique sur cette page" style="color:#9ca3af">👁 Éclairage OFF</button>
        </div>
        <div class="vtt-walls-grp">
          <span class="vtt-walls-grp-lbl">Brouillard</span>
          <button class="vtt-btn-sm"        data-fog-tool="hide"   data-vtt-fn="_vttFogTool" data-vtt-args="hide"   title="Cacher une zone (drag rectangle)">🌑 Cacher</button>
          <button class="vtt-btn-sm"        data-fog-tool="reveal" data-vtt-fn="_vttFogTool" data-vtt-args="reveal" title="Révéler une zone (drag rectangle, prioritaire sur le LOS)">🔦 Révéler</button>
          <button class="vtt-btn-sm vtt-btn-danger" data-vtt-fn="_vttFogClearOps" title="Supprimer toutes les zones de brouillard manuel de cette page">🧹 Vider</button>
        </div>
        <div class="vtt-walls-grp">
          <span class="vtt-walls-grp-lbl">Édition</span>
          <button class="vtt-btn-sm"        data-fog-tool="eraser" data-vtt-fn="_vttFogTool" data-vtt-args="eraser" title="Effacer (clic sur mur, lumière ou zone de brouillard)">🗑 Effacer</button>
          <button class="vtt-btn-sm"        data-vtt-fn="_vttFogUndo" title="Annuler la dernière pose (Ctrl+Z)">↩ Annuler</button>
          <button class="vtt-btn-sm"        data-vtt-fn="_vttFogRedo" title="Rétablir la dernière pose annulée (Ctrl+Y)">↪ Rétablir</button>
        </div>
      </div>
      <div class="vtt-walls-bar-hint">
        Murs : grille · Brouillard : demi-case · <kbd>Alt</kbd> = précision ×2 · <kbd>Shift</kbd> = libre · <kbd>Ctrl</kbd>+<kbd>Z</kbd> = annuler la pose · Clic segment/zone = menu<br>
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
    <div class="vtt-tl-toprow">
      <div id="vtt-timer" class="vtt-timer" aria-live="polite"></div>
      <div id="vtt-weather" class="vtt-weather"></div>
    </div>
    <div id="vtt-combat-tracker" class="vtt-combat-tracker" style="display:none"></div>
  `;
  wrap.appendChild(_ovTL);
  _renderTimer();
  _renderWeatherBtn();
  _applyWeather();
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
  _formatsP.then(([f, d]) => { VS.weaponFormats = f; VS.damageTypes = d; });
  // Précharge les matrices MJ (combos, armes invoquées) pour les sorts en combat
  loadSpellMatrices().then(m => { _spellMatrices = m; }).catch(() => {});
  // Précharge les overrides MJ de la librairie d'états (CONDITION_LIBRARY)
  _loadConditionsOverrides().catch(() => {});
  // _skillsP : _loadDiceSkills met à jour VS.diceSkills et rerend l'inspector si besoin
  void _skillsP;
  _initListeners();
  // Présence : heartbeat espacé, suspendu en arrière-plan
  _startPresence();
}

// [PRÉSENCE → vtt-presence.js]

// ═══════════════════════════════════════════════════════════════════
// [MINI-FICHE PERSONNAGE → vtt-mini-fiche.js]

PAGES.vtt=renderVttPage;


// Registre des actions pour le dispatcher data-vtt-fn
export const VTT_ACTIONS = {
  _vttDismissRotate: () => {
    _vttRotateDismissed = true;
    try { sessionStorage.setItem('vtt-rotate-dismissed', '1'); } catch {}
    document.querySelectorAll('.vtt-rotate-prompt').forEach(el => el.classList.add('dismissed'));
  },
  _vttActBarCat,
  _vttAimOpt,
  _hideActBar,
  _vttToggleHudCollapse,
  _aimCancel,
  _vttEnterTable,
  _vttGateBack,
  _vttToggleSessionLive,
  _vttUndoDraw,
  _vttRedoDraw,
  _invPickToggle,
  _invPickConfirm,
  _invPickCancel,
  _vttAiderClose,
  _vttAider,
  _vttSelfActionClose,
  _vttSelfAction,
  _vttShieldCancelAttack,
  _vttUndoAction,
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
  _vttCreatSendGoldToStash,
  _vttLootAddGoldPrompt,
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
  _vttDiceRerollLast,
  _vttDiceUseHistory,
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
  _vttFogUndo,
  _vttFogRedo,
  _vttImportGithubRelease,
  _vttInsTab,
  _vttOpenSource,
  _vttSkillFilter,
  _vttSkillFilterClear,
  _vttSwitchCharacterBuild,
  _vttInvokeMyToken,
  _vttKickPresence,
  _vttLibDelFolder,
  _vttLibDelImg,
  _vttLibImportGithub,
  _vttLibMoveMenu,
  _vttLibMoveRoot,
  _vttLibMoveTo,
  _vttLibMoveToAndClose,
  _vttLibNewFolder,
  _vttLibOpenFolder,
  _vttLibPlace,
  _vttLibSearch,
  _vttLibSearchClear,
  _vttLootAddItemToStash,
  _vttLootClaimEdit,
  _vttLootClaimSetChar,
  _vttLootClaimStep,
  _vttLootClaimSubmit,
  _vttLootClaimWithdraw,
  _vttLootClear,
  _vttLootCloseVote,
  _vttLootConfirmTake,
  _vttLootForceDistribute,
  _vttLootOpenVote,
  _vttLootRemoveLoot,
  _vttLootRemoveStash,
  _vttLootTakeSetChar,
  _vttLootTakeStep,
  _vttLootToggleTake,
  _vttMemberInfo,
  _vttMoveTokenAndReset,
  _vttMoveTokenToPage,
  _vttMsAddNote,
  _vttMsCompteAdd,
  _vttMsCompteDel,
  _vttMsSendGoldPicker,
  _vttMsConfirmSendGold,
  _vttMsConfirmSend,
  _vttMsCraft,
  _vttMsCraftSearch,
  _vttMsCraftClear,
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
  _vttMsSetHp,
  _vttMsSetPm,
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
  _vttPageFolderFilter,
  _vttPageFavToggle,
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
  _vttReserveFilter,
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
  _vttWeatherToggle,
  _vttSetWeather,
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
  _vttCenterOnMyToken,
  _vttTool,
  _vttTrackerFocus,
  _vttTrayClearSearch,
  _vttTrayFilter,
  _vttTraySearch,
  _vttBstSearch,
  _vttBstClearSearch,
  _vttTrayTab,
  _vttTriggerConcentrationSave,
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
  _vttMusicToggleHideTitle,
  _vttRenamePlaylistConfirm,
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
