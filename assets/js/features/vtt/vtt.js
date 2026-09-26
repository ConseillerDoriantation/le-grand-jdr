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
  setDoc, onSnapshot, serverTimestamp, writeBatch, deleteField,
  query, orderBy, limit,
} from '../../config/firebase.js';
import { getMod, getModFromScore, calcVitesse, calcCA, calcPVMax, calcPMMax, calcGardeMax, calcPalier, calcDeckMax, getMaitriseBonus, statShort, computeEquipStatsBonus, getItemStatBonus, computeEquipSkillBonus, sortCharactersForDisplay, calcOr } from '../../shared/char-stats.js';
import { useGold } from '../../shared/economy.js';
import { calcCriticalEffectTotal, criticalEffectFormulaLabel } from '../../shared/character-rules.js';
import { shopItemToInvEntry } from '../../shared/inventory-utils.js';
import { inventoryHistoryPayload, makeInventoryHistoryEntry } from '../../shared/inventory-history.js';
import { openShopPicker, getShopItemById } from '../../shared/shop-picker.js';
import { getArmorSetData, getMainWeapon, getItemTraits, getEquippedSourceItem, resolveEquippedInventoryIndices, DEFAULT_UNARMED, getCharDamageProfile, getCharFullDamageProfile } from '../../shared/equipment-utils.js';
import { getSecondaryWeaponSlotId } from '../../shared/equipment-slots.js';
import { buildProjectionPatch, switchBuild } from '../../shared/character-builds.js';
import { loadWeaponFormats } from '../../shared/weapon-formats.js';
import { ZONE_SHAPES, _zoneDims, _zoneCount } from '../../shared/spell-zones.js';
import { _zoneCellRects } from './vtt-render.js';
import { resolveWeaponDamageContext } from '../../shared/weapon-damage-context.js';
import {
  combinedTechniqueTargetCA, techniqueAllowedForAction, techniqueAreaIntersects, techniqueOutcomeMultiplier, techniqueTriggerApplies,
  weaponTechniqueDamageTerms,
} from '../../shared/weapon-techniques.js';
import { loadDamageTypes, getDamageTypeRules, getDamageTypeById } from '../../shared/damage-types.js';
import { getAttackMissEffect } from '../../shared/damage-type-rules.js';
import { combatStyleAttackModifiers, defaultCombatStyles, detectCombatStyle, nearestHostileDistance, normalizeCombatStyle, normalizeCombatStyles } from '../../shared/combat-styles.js';
import { playSigil, playImpact, playProjectile, playSlash, playTechniqueArea } from './vtt-rune-sigil.js';
import { DAMAGE_INTERACTIONS, applyDamageTypeInteraction, previewDamageInteraction } from '../../shared/damage-profile.js';
import { runeBadges, spellTypeBadges } from '../../shared/spell-action-card.js';
import { calcSpellDuration, calcSpellTargets, getProtectionRestoreMode, resolveSpellModifierStat, usesHealingMastery, usesSpellMastery } from '../../shared/spell-runes.js';
import { calculateSummonStats, getPreparedInvocationActions, INVOCATION_ABILITIES, invocationStatModifier, invocationStatShort, invocationsAllowedForSpell, normalizeInvocationSelection, normalizeInvocationStats, toggleInvocationChoice } from '../../shared/invocation-stats.js';
import { loadSpellMatrices, getInvokedArm } from '../../shared/spell-matrices.js';
import { CONDITION_DEFAULT_LIBRARY, CONDITION_DEFAULT_IDS, loadConditionLibrary } from '../../shared/conditions.js';
import { showNotif } from '../../shared/notifications.js';
import { toggleTheme } from '../../shared/theme.js';
import { accAttackDelta, accCastDelta, applyStatsDelta, bumpBiggestHit, bumpBiggestTaken, bumpDamageTaken, setActiveStatsSession } from '../../shared/stats.js';
import { appliedDamageAmount } from '../../shared/stats-analysis.js';
import { shouldTrackSpellStats } from '../../shared/spell-stats-policy.js';
import { uploadCloudinary, hasCloudinaryConfig, openCloudinaryConfigModal, CLOUDINARY_ENABLED } from '../../shared/upload-cloudinary.js';
import {
  fogInit, fogSetPgRef, fogUpdate, fogUpdateSoon, fogRenderWalls,
  fogIsEditMode, fogToggleEditMode, fogSetEditTool, fogWallBlocksPath, fogUndo, fogRedo, fogCanUndo, fogCanRedo,
} from './vtt-fog.js';
import { openModal, closeModalDirect, confirmModal, updateModalContent, promptModal, setModalCloseGuard } from '../../shared/modal.js';
import { _esc, _norm, _searchIncludes, appSplashHtml, loadingHtml, normalizeImageUrl } from '../../shared/html.js';
import { lsJson } from '../../shared/local-storage.js';
import { githubPagesUrl } from '../../shared/github-folder.js';
import { DICE_SKILLS_DEFAULT, DICE_SKILLS_STORAGE_KEY } from '../../shared/dice-skills.js';
import { hasAdventurePremiumAccess } from '../../shared/premium.js';
import PAGES from '../pages.js';
import { VS, aid } from './vtt-state.js';
import {
  _sesRef, _pgsCol, _toksCol, _pgRef, _tokRef, _chrRef, _npcRef, _bstTrackerRef,
  _logCol, _logGmCol, _castingCol, _castingRef, _pingsCol, _pingRef,
  _reactionsCol, _reactionRef, _annotCol, _annotRef,
} from './vtt-refs.js';
import { CELL, CELL_M, TYPE_COLOR, hpColor, _STAT_KEY, _STAT_COLOR, _STAT_RGB, _VTT_RUNE_META, _MS_BONUS_BUFF } from './vtt-constants.js';
import { _drawGrid, _loadKonva, _stageToWorld, _renderMapImages, _buildTokenVisual, _buildAnnotVisual, vttLowFx, setVttLowFx, _stripShadows } from './vtt-render.js';
import { fogHasUnlimitedVision, fogVisionRadiusCells, vttCanvasPixelRatio, vttPinchCameraTransform } from './vtt-fog-performance.js';
import { vttStructureLegendSvg } from './vtt-wall-utils.js';
import { tokenActiveEffects, tokenDeltaMeta, tokenDetailLevel, tokenEffectsSignature, tokenFootprintIntersectsZone, tokenHealthMeta, tokenMovementMeta, tokenRelationTone } from './vtt-token-visual.js';
import { isTemporarySummonToken, reserveSummonTokens, resolveInvocationManaChange } from './vtt-summon-utils.js';
import { attackRollHitsTarget, receivesOffensiveDamageBonus } from './vtt-attack-rules.js';
import { conditionDamageReductionApplies, conditionStatRollMode } from './vtt-condition-rules.js';
import { planGroupGridStep } from './vtt-group-movement.js';
import { invocableCharacterTokens, resolveCharacterControlToken } from './vtt-token-control.js';
import { naturalWeaponCombatContext } from '../../shared/bestiary-combat.js';
import { canControlCharacter, getCharacterDelegates } from '../../shared/character-state.js';
import { _calcAfflictionDD, splitSpellDiceFormula } from '../../shared/spell-math.js';
import {
  _startRuler, _updateRuler, _endRuler, _clearRuler, _showRulerHover, _hideRulerHover,
  _renderMjRulerRemote, _resetRuler, rulerActive, rulerBusy, rulerCells,
} from './vtt-ruler.js';
import {
  _initChatLogSubs, _vttToggleLogDetail, _vttSendChat, _vttChatReply, _vttChatReplyCancel, _chatMsgs,
  _vttPublishOptimisticLog, _vttRefreshCombatHpEstimates, _vttResetCombatHpLog,
  _vttChatFilter, _vttChatShowNew, _vttRefreshChatPortraits,
} from './vtt-chat.js';
import {
  _loadEmotes, _loadDiceSkills, _vttSetRollMode, _vttAdjBonus, _vttSetBonus, _vttToggleRollHidden, _vttRollSkill,
  _vttToggleFav, _closeEmotePicker, _vttToggleEmotePicker, _vttPickEmote,
  _ouvrirGestionEmotes, _renderEmotePicker, _emotes,
  _vttSendEmote, _vttEmoteTab, _vttEmoteMenu, _vttEmotePickEmitter, _vttSetEmoteEmitter,
  _updateEmoteTrigger, _emoteEmitterId, _emoteTokenColor, _initEmoteGestures,
} from './vtt-emotes.js';
import {
  _live, _characterForToken, _touchBuffOf, _conditionDmgBonusOf,
  _scaledEnchantConditionFields, _vttPrimaryWeapon, _vttBestWeaponRange, _conditionCritRangeBonusOf,
} from './vtt-effective.js';
import { _renderInspector, _renderInspectorSoon, _vttInsTab, _vttBuildJetsBody, _vttSkillFilter, _vttSkillFilterClear } from './vtt-inspector.js';
import {
  _renderLibSection, _resetMapLib, _libFolder, _vttLibToggle, _vttLibOpenFolder, _vttLibNewFolder,
  _vttLibDelFolder, _vttLibDelImg, _vttLibMoveRoot, _vttLibMoveMenu, _vttLibMoveTo, _vttLibPlace,
  _vttLibMoveToAndClose, _mapLibRef, _saveMapLib, _vttLibImportGithub, _vttLibCleanDuplicates, _vttLibSearch, _vttLibSearchClear,
} from './vtt-maplib.js';
import { dedupeMapLibraryImages } from './vtt-map-library-utils.js';
import { _markCharsReady, _markNpcsReady, _markToksReady, _resetAutoSync, _charsReady, _cleanupReserveDuplicates } from './vtt-autosync.js';
import { _vttPanelError, _showCtxMenu, _hideCtxMenu, _tokenEntityKey } from './vtt-utils.js';
import { sceneGridSizeForImages } from './vtt-scene-utils.js';
import {
  _vttConditionConfig, _vttConditionConfigSelect, _vttConditionConfigSave, _vttConditionConfigReset,
  _vttConditionConfigAddNew, _vttConditionConfigDelete, _vttCcTriSet, _vttCcFlagToggle,
} from './vtt-conditions-config.js';
import {
  _vttConditionAdd, _vttConditionApply, _vttConditionRemove, _vttConditionSave,
  _vttConditionEdit, _vttConditionEditSave, _vttEnsureConditionsLoaded, _vttConditionGlossary,
} from './vtt-conditions.js';
import {
  _vttMoveTurnOrder, _vttNextActiveTurn, _vttResetTurn, _vttSetActiveTurn,
  _vttToggleTurnFlag, _vttToggleCombat, _vttNextRound, _vttSetTurnTimer,
} from './vtt-combat-turns.js';
import {
  _vttApplyEnchantBuffs, _vttApplyAfflictions, _vttApplyRegeneration,
} from './vtt-spell-effects.js';
import {
  _renderTraySoon, _renderPageTabs, _switchPage, _trayTab, _resetTraySearch,
  _vttTrayFilter, _vttTraySearch, _vttTrayClearSearch, _vttBstSearch, _vttBstClearSearch, _vttTrayTab,
  _vttToggleOn, _vttToggleOff, _vttToggleNpc, _vttReserveFilter, _vttPageSearch, _vttPageSearchClear, _vttPageFolderToggle,
  _vttPageFolderFilter, _vttPageMenu, _vttPageFoldersMenu, _vttPageFolderRename,
  _vttReserveLayout, _vttReservePick, _vttReserveCard, _vttReserveClearPicked,
  _vttReservePlacePicked, _vttPlaceOnlineReserve,
} from './vtt-tray.js';
import {
  VTT_ACTION_RUNE, _parseDice, _maxDice, _maxEffectDisplay, _effectDisplay,
  _vttSortDmgFormula, _vttSortSoinFormula, _vttAmpDispCircleSize, _vttSpellActionMode,
  _vttDisplayRunes,
} from './vtt-spell-display.js';
import { _getSortTypes, spellCostRes, _calcSortMana } from '../characters/spells-calc.js';
import { spellSetCostDelta } from '../../shared/spell-system.js';
import {
  _musicStateRef, _syncMusicPlayback, _resetMusicState, _closeMusicPanel,
  _refreshMusicDockTrigger,
  _vttToggleMusic, _vttPlaySound,
  _vttPlayPlaylist, _vttMusicNext, _vttMusicPrev, _vttToggleLoop, _vttToggleMusicPause, _vttStopMusic,
  _vttSoundCtxMenu, _vttDeleteSound, _vttCreatePlaylist, _vttCreatePlaylistConfirm,
  _vttDeletePlaylist, _vttAddSoundToPlaylist, _vttRemoveSoundFromPlaylist, _vttCleanMissingSounds,
  _vttPlayAmbience, _vttStopAmbience, _vttPlaylistCtxMenu, _vttMusicAddMenu, _vttMusicToolsMenu,
  _vttPlColorSelect, _vttPreview, _vttSeek, _vttAddSonUrl, _vttImportGithubRelease,
  _vttMusicToggleHideTitle, _vttMusicToggleSoundTitle, _vttRenamePlaylistConfirm,
  _vttMusicSelectRail,
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
  _resetLootState,
  _ensureLootListener, _refreshLootDockTrigger,
  _closeLootPanel,
  _vttLootOpenVote, _vttLootCloseVote, _vttLootForceDistribute,
  _vttLootClaimSetChar, _vttLootClaimStep, _vttLootClaimEdit,
  _vttLootClaimSubmit, _vttLootClaimWithdraw,
  _vttLootMove, _vttLootMove1, _vttLootQtyEdit, _vttLootQtyStep, _vttLootRevealAll,
  _vttLootGoldEdit, _vttLootGoldCancel, _vttLootGoldOk, _vttLootGoldMove, _vttLootGoldSplit,
  _vttLootStashMenu, _vttLootTableMenu, _vttLootQaPick,
  _vttLootCataBack, _vttLootCataSel, _vttLootCataRar, _vttLootCataAdd,
  _vttLootBasketStep, _vttLootBasketRemove, _vttLootBasketClear, _vttLootBasketSend,
  _vttLootCreatureAll, _vttLootCreatureDraw, _vttLootSetMe,
} from './vtt-loot.js';
import {
  _vttToggleDice, _vttDiceAddDie, _vttDiceRemoveDie, _vttDiceClear, _vttDiceBonusStep,
  _vttDiceBonusSet, _vttDiceMode, _vttDiceRoll, _closeDicePanel,
  _vttDiceUseHistory, setJetsBuilder,
  _vttDiceCmdInput, _vttDiceSelectSkill, _vttDiceRerollHistory, _vttDiceRollTyped,
} from './vtt-dice.js';
import { initVttSessionDock, vttSessionDockButton, vttSessionDockIcon } from './vtt-session-dock.js';
import {
  _renderTimer, _timerStartTick, _timerStopTick, _vttTimerToggle, _vttTimerReset, _vttTimerLabel,
} from './vtt-timer.js';
import { _renderWeatherBtn, _applyWeather, _vttWeatherToggle, _vttSetWeather } from './vtt-weather.js';
import {
  _renderCombatTracker, _renderCombatTrackerSoon, _vttCombatTab, _vttTrackerFocus, _vttToggleOrderPanel,
} from './vtt-combat-tracker.js';
import {
  _startPresence, _resetPresence, _renderSessionBtn, _vttToggleSessionLive,
  _vttKickPresence, _renderPresenceCol,
} from './vtt-presence.js';
import {
  _renderMiniSheet, _vttToggleMiniSheet, _vttSelectMiniChar, _msCanEdit, _msCanEditVitals,
  _vttMsTab, _vttMsToggleCollapsed, _vttMsAttackSlot, _vttMsAddNote, _vttMsToggleNote,
  _vttMsDeleteNote, _vttMsEquip, _vttMsUnequip, _vttMsUnequipAll, _vttMsEquipPicker,
  _vttMsSlotChange, _vttMsDeleteItem, _vttMsSendPicker, _vttMsConfirmSend,
  _vttMsInvSearch, _vttMsInvCat, _vttMsInvClear, _vttMsSortSearch, _vttMsSortCat,
  _vttMsSortClear, _vttToggleMsSort, _vttMsCompteAdd, _vttMsCompteDel, _vttMsCraft, _vttMsCraftAsk, _vttMsCraftCancel,
  _vttMsCraftSearch, _vttMsCraftClear,
  _vttMsSendGoldPicker, _vttMsConfirmSendGold,
  _vttMsSac, _vttMsGoPurse, _vttMsPop, _vttMsToggleSpell, _vttMsKeyToggle,
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

// ── Actions de base : Esquiver / Se désengager (état sur soi) ──
async function _vttSelfAction(srcId, condId) {
  const t = VS.tokens[srcId]?.data; if (!t) return;
  if (!_canControlToken(t)) return;
  // L'action libre de furtivité est volontairement désactivée. Cette liste
  // blanche bloque aussi un ancien onglet resté ouvert ou un appel direct.
  if (!['dodge', 'disengaged'].includes(condId)) return;
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
  const previous = t.conditions || [];
  const conditions = [...existing, newCond];
  _vttPatchTokenOptimistically(srcId, { conditions });
  await updateDoc(_tokRef(srcId), { conditions }).catch(error => {
    _vttPatchTokenOptimistically(srcId, { conditions: previous });
    console.error('[vtt] action défensive non appliquée', error);
  });
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
  const previousConditions = t.conditions || [];
  _vttPatchTokenOptimistically(tgtId, { conditions: [] });
  const hpWrite = _setHp(t, 1).catch(error => {
    console.error('[vtt] PV non restaurés après Aider', error);
  });
  const conditionsWrite = updateDoc(_tokRef(tgtId), { conditions: [] }).catch(error => {
    _vttPatchTokenOptimistically(tgtId, { conditions: previousConditions });
    console.error('[vtt] états non retirés après Aider', error);
  });
  await Promise.all([hpWrite, conditionsWrite]);
  const name = _live(t).displayName ?? t.name;
  showNotif(`🤝 ${name} relevé à 1 PV — états retirés`, 'success');
}
function _vttAiderClose(srcId, tgtId) {
  _vttAider(srcId, tgtId);
  _closeActionModal();
}
function _vttClearAoptSearch(btn) {
  const inp = btn.previousElementSibling;
  if (inp) { inp.value = ''; _vttAoptSearch('', inp); inp.focus(); }
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

function _vttSetActionPending(el) {
  if (!el || el.dataset.actionPending === 'true') return false;
  el.dataset.actionPending = 'true';
  el.dataset.pendingWasDisabled = el.disabled ? 'true' : 'false';
  el.setAttribute('aria-busy', 'true');
  if ('disabled' in el) el.disabled = true;
  el.classList.add('is-action-pending');
  el._pendingTimer = setTimeout(() => {
    if (el.dataset.actionPending === 'true') el.classList.add('is-action-pending-visible');
  }, 180);
  return true;
}

function _vttClearActionPending(el) {
  clearTimeout(el?._pendingTimer);
  if (!el || el.dataset.actionPending !== 'true') return;
  delete el._pendingTimer;
  if ('disabled' in el && el.dataset.pendingWasDisabled !== 'true') el.disabled = false;
  delete el.dataset.pendingWasDisabled;
  delete el.dataset.actionPending;
  el.removeAttribute('aria-busy');
  el.classList.remove('is-action-pending', 'is-action-pending-visible');
}

function _vttReportActionFailure(action, error) {
  console.error(`[vtt] action ${action}`, error);
  showNotif('Action impossible — réessaie dans un instant.', 'error');
}

function _vttBindDispatch() {
  if (_vttBindDispatch._bound) return;
  _vttBindDispatch._bound = true;
  const dispatch = (e) => {
    const el = e.target.closest('[data-vtt-fn]');
    if (!el) return;
    if (el.dataset.actionPending === 'true') {
      if (e.type === 'click' || e.type === 'keydown') e.preventDefault();
      return;
    }
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
    try {
      const output = fn(...args);
      if (output && typeof output.then === 'function') {
        const showPending = expectedOn === 'click' || expectedOn === 'keydown-enter';
        if (showPending) _vttSetActionPending(el);
        Promise.resolve(output)
          .catch(error => _vttReportActionFailure(el.dataset.vttFn, error))
          .finally(() => {
            if (showPending) _vttClearActionPending(el);
          });
      }
    } catch (error) {
      _vttReportActionFailure(el.dataset.vttFn, error);
    }
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
let _mapLibCleanupWrite = null;

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
let _annotMovePassthrough = false; // les cases de mouvement priment temporairement sur les dessins
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
const _VTT_TOOL_PANEL_STORAGE = 'vtt-tool-panels-v1';
let _vttToolPanel = null;
let _vttToolPanelCollapsed = lsJson.get(_VTT_TOOL_PANEL_STORAGE, {});
let _vttStructureHelp = false;
let _vttFogActiveTool = 'wall';

const _VTT_TOOL_ICON_PATHS = {
  select:'<path d="M5 3l13 7.5-5.6 1.6L10 18z"/><path d="M12.6 12.2l4.4 5.3"/>',
  ruler:'<path d="M3.5 16.5L16.5 3.5l4 4-13 13z"/><path d="M7.5 12.5l2 2M10.5 9.5l1.5 1.5M13.5 6.5l2 2"/>',
  draw:'<path d="M4 20h4L19.5 8.5a2.1 2.1 0 00-4-4L4 16z"/><path d="M14 6l4 4"/>',
  walls:'<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 12h18M9 5v7M15 12v7"/>',
  center:'<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>',
  keys:'<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9"/>',
  perf:'<path d="M13 2.5L4.5 13.5h6.5l-1 8 8.5-11h-6.5z"/>',
  pencil:'<path d="M4 20l1-4L16 5l3 3L8 19z"/>',
  line:'<path d="M5 19L19 5"/>', rect:'<rect x="4" y="6" width="16" height="12" rx="1"/>',
  circle:'<circle cx="12" cy="12" r="8"/>', poly:'<path d="M12 4l9 15H3z"/>',
  eraser:'<path d="M7.5 20H20M4.6 14.6l8.8-8.8a2 2 0 012.8 0l2.9 2.9a2 2 0 010 2.8L12 18.6 8.6 20 4.6 16a1 1 0 010-1.4z"/><path d="M9 10l5 5"/>',
  fill:'<rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" fill-opacity=".35"/>',
  undo:'<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
  redo:'<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>',
  trash:'<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  light:'<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 00-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0012 3z"/>',
  hide:'<path d="M20 14.5A8 8 0 119.5 4a6.5 6.5 0 0010.5 10.5z"/>',
  reveal:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  min:'<path d="M6 12h12"/>', max:'<path d="M6 9l6 6 6-6"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 17h.01"/>',
};
const _vttToolIcon = name => `<svg class="vtt-tool-icon" viewBox="0 0 24 24" aria-hidden="true">${_VTT_TOOL_ICON_PATHS[name] || ''}</svg>`;
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
const _npcStatScore = (npc, key) => {
  const base = _numOr(npc?.stats?.[key], 10);
  const equipBonus = computeEquipStatsBonus(npc?.equipement || {})[key] || 0;
  return base + equipBonus;
};
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
  if (delegates.includes(uid)) return true;
  return !!t.characterId && canControlCharacter(VS.characters[t.characterId], uid);
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
/** Réserve de Garde courante (ressource défensive), bornée à ≥ 0. */
export function _charGardeCur(c) { const n = parseInt(c?.garde, 10); return Number.isFinite(n) && n > 0 ? n : 0; }

// ── Ressource de coût d'un sort (PM par défaut, sinon PV / Or / aucune) ──────────
// Un sort peut se payer en PM, PV ou Or (choisi sur la fiche). On route la
// lecture du solde et la dépense vers la bonne ressource du LANCEUR. NPC/monstres
// n'ont pas de costResource → 'pm', comportement inchangé.
function _optCostRes(opt) { return opt?.costRes || 'pm'; }
/** Solde courant d'un perso pour une ressource de coût. */
function _charResCur(c, res) {
  if (res === 'pv') return c?.hp ?? calcPVMax(c);
  if (res === 'or') return calcOr(c);
  if (res === 'garde') return _charGardeCur(c);
  return _charPmCur(c);
}
const _RES_LABEL = { pm: 'PM', pv: 'PV', or: 'Or', garde: 'Garde', none: '' };
/** Dépense `cost` de la ressource `res` sur le perso `cid`. */
async function _spendCharSpellCost(cid, res, cost, tokenId, label) {
  const c = VS.characters[cid];
  if (!c || !(cost > 0) || res === 'none') return;
  if (res === 'or') {
    await useGold(cid, -cost, `Sort : ${label || ''}`.trim(), { charObj: c, allowOverdraft: true, refreshUI: false }).catch(() => {});
    return;
  }
  if (res === 'pv') {
    const cur = c.hp ?? calcPVMax(c);
    const next = Math.max(0, cur - cost);
    c.hp = next;
    _patchEntityTokenShapes('characterId', cid);
    await updateDoc(_chrRef(cid), { hp: next, vttControlTokenId: tokenId }).catch(error => {
      c.hp = cur;
      _patchEntityTokenShapes('characterId', cid);
      throw error;
    });
    return;
  }
  if (res === 'garde') {
    const cur = _charGardeCur(c);
    const next = Math.max(0, cur - cost);
    c.garde = next;
    _patchEntityTokenShapes('characterId', cid);
    await updateDoc(_chrRef(cid), { garde: next, vttControlTokenId: tokenId }).catch(error => {
      c.garde = cur;
      _patchEntityTokenShapes('characterId', cid);
      throw error;
    });
    return;
  }
  const cur = _charPmCur(c);
  const next = Math.max(0, cur - cost);
  Object.assign(c, _charPmPatch(next));
  _patchEntityTokenShapes('characterId', cid);
  await updateDoc(_chrRef(cid), { ..._charPmPatch(next), vttControlTokenId: tokenId }).catch(error => {
    Object.assign(c, _charPmPatch(cur));
    _patchEntityTokenShapes('characterId', cid);
    throw error;
  });
}

// « Garde » : un coup DIRECT reçu et bloqué par la CA (jet d'attaque < CA, ni
// critique, ni maladresse, ni auto-touche) charge de +1 la réserve défensive du
// PERSONNAGE ciblé, s'il possède la mécanique (gardeMax > 0). Réservé aux persos
// joueurs (t.characterId) — pas les PNJ/créatures. Écriture bornée (1 par blocage).
function _awardGardeOnBlock(td) {
  const cid = td?.characterId; if (!cid) return;
  const c = VS.characters[cid]; if (!c) return;
  const max = calcGardeMax(c); if (max <= 0) return;
  const cur = _charGardeCur(c);
  if (cur >= max) return;
  const next = Math.min(max, cur + 1);
  c.garde = next;
  _patchEntityTokenShapes('characterId', cid);
  updateDoc(_chrRef(cid), { garde: next }).catch(error => {
    c.garde = cur;
    _patchEntityTokenShapes('characterId', cid);
    console.error('[vtt] Garde non enregistrée', error);
  });
  const who = _live(td).displayName ?? c.nom ?? 'Personnage';
  showNotif(`🛡️ ${who} pare le coup : +1 Garde (${next}/${max})`, 'info');
}

// HP écrit sur la fiche source (bidirectionnel)
export async function _setHp(t, newHp, tokenPatch = null) {
  const v = Math.max(0, newHp);
  const live = _live(t);
  const previous = (t.characterId ? VS.characters[t.characterId]?.hp
    : t.npcId ? VS.npcs[t.npcId]?.hp
    : t.hp) ?? live.displayHp;
  const previousTokenPatch = {};
  if (!t.characterId && !t.npcId && tokenPatch) {
    for (const key of Object.keys(tokenPatch)) previousTokenPatch[key] = t[key];
    Object.assign(t, tokenPatch);
  }
  _showAppliedHpDelta(t, live.displayHp ?? previous, v);
  _patchHpOptimistically(t, v);
  try {
    if (t.characterId) await updateDoc(_chrRef(t.characterId), { hp: v });
    else if (t.npcId)  await updateDoc(_npcRef(t.npcId),       { hp: v });
    else               await updateDoc(_tokRef(t.id),          { hp: v, ...(tokenPatch || {}) });
  } catch (error) {
    for (const [key, value] of Object.entries(previousTokenPatch)) {
      if (value === undefined) delete t[key];
      else t[key] = value;
    }
    if (previous != null) _patchHpOptimistically(t, previous);
    throw error;
  }
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
/** Écrit les PM propres d'une invocation sur son token, puis mémorise la valeur
 * dans sa fiche de bibliothèque afin qu'une réinvocation conserve cet état. */
async function _setInvocationPm(td, requestedPm) {
  const next = resolveInvocationManaChange(td, requestedPm);
  if (!next) return null;
  const patch = { pm: next.value, pmCombat: next.value };
  const live = VS.tokens?.[td.id]?.data;
  const target = live || td;
  const previous = { pm: target.pm, pmCombat: target.pmCombat };
  Object.assign(target, patch);
  _patchShape(td.id);
  _refreshDisplayedIdentitySoon(td.id);
  try {
    await updateDoc(_tokRef(td.id), patch);
    void _persistInvocationState(target);
  } catch (error) {
    Object.assign(target, previous);
    _patchShape(td.id);
    _refreshDisplayedIdentitySoon(td.id);
    throw error;
  }
  return next;
}

/** Restaure `amount` PM sur un token (perso / PNJ / créature bestiaire / invocation), capé au
 *  max. Retourne { applied, cur, max } (PM réellement rendus + nouvel état). */
async function _restoreTokenPm(td, amount, { deferWrite = false } = {}) {
  const add = Math.max(0, parseInt(amount) || 0);
  if (td?.summonKind === 'invocation') {
    const state = resolveInvocationManaChange(td, td.pm ?? td.pmMax);
    if (!state) return { applied: 0, cur: 0, max: 0 };
    const cur = state.value;
    const nv = Math.min(state.max, cur + add);
    if (nv !== cur) {
      const write = _setInvocationPm(td, nv);
      if (deferWrite) return { applied: Math.max(0, nv - cur), cur: nv, max: state.max, write };
      try {
        await write;
      } catch (err) {
        console.error('[vtt] régénération des PM de l’invocation refusée', err);
        return { applied: 0, cur, max: state.max };
      }
    }
    return { applied: Math.max(0, nv - cur), cur: nv, max: state.max };
  }
  if (td?.characterId) {
    const c = VS.characters[td.characterId];
    if (!c) return { applied: 0, cur: 0, max: 0 };
    const max = calcPMMax(c), cur = Math.max(0, _charPmCur(c));
    const nv = Math.min(max, cur + add);
    if (nv !== cur) {
      Object.assign(c, _charPmPatch(nv));
      _patchEntityTokenShapes('characterId', td.characterId);
      // La fiche n'appartient pas nécessairement au joueur qui agit : un token
      // peut lui avoir été délégué. Le token cible sert de preuve bornée aux
      // règles Firestore, comme lors d'une dépense ou d'une saisie manuelle.
      const write = updateDoc(_chrRef(td.characterId), {
        ..._charPmPatch(nv),
        vttControlTokenId: td.id,
      }).catch(error => {
        Object.assign(c, _charPmPatch(cur));
        _patchEntityTokenShapes('characterId', td.characterId);
        console.error('[vtt] régénération PM personnage', error);
        throw error;
      });
      if (deferWrite) return { applied: Math.max(0, nv - cur), cur: nv, max, write };
      await write;
    }
    return { applied: Math.max(0, nv - cur), cur: nv, max };
  }
  if (td?.npcId) {
    const n = VS.npcs[td.npcId];
    const max = _numOr(n?.pmMax, _numOr(n?.pm, 0));
    const cur = Math.max(0, _numOr(n?.pmCurrent, max));
    const nv = Math.min(max, cur + add);
    if (nv !== cur) {
      n.pmCurrent = nv;
      _patchEntityTokenShapes('npcId', td.npcId);
      const write = updateDoc(_npcRef(td.npcId), { pmCurrent: nv }).catch(error => {
        n.pmCurrent = cur;
        _patchEntityTokenShapes('npcId', td.npcId);
        console.error('[vtt] régénération PM PNJ', error);
      });
      if (deferWrite) return { applied: Math.max(0, nv - cur), cur: nv, max, write };
      await write;
    }
    return { applied: Math.max(0, nv - cur), cur: nv, max };
  }
  const max = _numOr(VS.bestiary[td?.beastId]?.pmMax, 0);
  if (max <= 0) return { applied: 0, cur: 0, max: 0 };
  const cur = Math.max(0, td?.pm != null ? td.pm : max);
  const nv = Math.min(max, cur + add);
  if (nv !== cur) {
    const previousCombat = td.pmCombat;
    Object.assign(td, { pm: nv, pmCombat: nv });
    _patchShape(td.id);
    const write = updateDoc(_tokRef(td.id), { pm: nv, pmCombat: nv }).catch(error => {
      Object.assign(td, { pm: cur, pmCombat: previousCombat });
      _patchShape(td.id);
      console.error('[vtt] régénération PM créature', error);
    });
    if (deferWrite) return { applied: Math.max(0, nv - cur), cur: nv, max, write };
    await write;
  }
  return { applied: Math.max(0, nv - cur), cur: nv, max };
}

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
function _hasActiveConcentration(td, round = VS.session?.combat?.round ?? 0) {
  if (!td) return false;
  if ((td.buffs || []).some(b => b?.canalisePersistant && b?.concentrationDD != null)) return true;
  return (td.conditions || []).some(c => {
    if (c.expiresAtRound != null && round > 0 && round > c.expiresAtRound) return false;
    return !!c.concentrationSpell || !!CONDITION_BY_ID[c.id]?.effects?.concentrationCheck;
  });
}

export async function _vttTriggerConcentrationSave(td, damageAmount, nextHp = null, opts = {}) {
  if (!td || damageAmount <= 0) return [];
  let liveTd = VS.tokens?.[td.id]?.data || td;
  const round = VS.session?.combat?.round ?? 0;
  const isActiveConcentrationCondition = c => {
    if (c.expiresAtRound != null && round > 0 && round > c.expiresAtRound) return false;
    return !!c.concentrationSpell || !!CONDITION_BY_ID[c.id]?.effects?.concentrationCheck;
  };
  // Cas ultra-majoritaire : aucune concentration. Éviter une lecture Firestore
  // par cible, particulièrement coûteuse et visible sur les AoE 3×3.
  if (!_hasActiveConcentration(liveTd, round)) return [];
  const freshSnap = td.id ? await getDoc(_tokRef(td.id)).catch(() => null) : null;
  if (freshSnap?.exists?.()) {
    liveTd = { ...liveTd, ...freshSnap.data(), id: td.id };
  }
  const buffs = (liveTd.buffs || []).filter(b => b?.canalisePersistant && b?.concentrationDD != null);
  const activeConditions = (liveTd.conditions || []).filter(isActiveConcentrationCondition);
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
    else await _publishCombatLog(payload);
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
// ── Abonnements Firestore différés (économie de quota, sans écran bloquant) ──
// Les listeners temps réel ne démarrent qu'à la 1re interaction (souris, clic,
// clavier, molette, tactile) OU après un repli de 2,5 s. Un joueur qui ouvre la
// table et repart sans rien toucher ne déclenche AUCUN read. La table est déjà
// affichée pendant ce temps : les données (tokens, map…) apparaissent dès
// l'armement. Annulé par _cleanup si on quitte avant.
let _vttListenersArmed = false;
let _vttArmTimer = null;
let _vttArmDetach = null;
let _vttPageActive = false;
function _vttArmListeners() {
  if (_vttListenersArmed) return;
  _vttListenersArmed = true;
  if (_vttArmTimer) { clearTimeout(_vttArmTimer); _vttArmTimer = null; }
  if (_vttArmDetach) { _vttArmDetach(); _vttArmDetach = null; }
  _initListeners();
  _startPresence();
}
function _vttScheduleListeners(host) {
  _vttListenersArmed = false;
  if (_vttArmTimer) clearTimeout(_vttArmTimer);
  if (_vttArmDetach) _vttArmDetach();
  const arm = () => _vttArmListeners();
  const evts = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];
  evts.forEach(e => host.addEventListener(e, arm, { once: true, passive: true }));
  _vttArmDetach = () => evts.forEach(e => host.removeEventListener(e, arm));
  _vttArmTimer = setTimeout(_vttArmListeners, 2500);
}
function _vttCancelListenerSchedule() {
  if (_vttArmTimer) { clearTimeout(_vttArmTimer); _vttArmTimer = null; }
  if (_vttArmDetach) { _vttArmDetach(); _vttArmDetach = null; }
  _vttListenersArmed = false;
}

function _cleanup() {
  _vttPageActive = false;
  _vttCancelListenerSchedule();
  _resetKeyboardMovement({ persist:true });
  VS.unsubs.forEach(u => u?.());
  VS.unsubs = []; VS.stage?.destroy(); VS.stage = null; VS.layers = {};
  _resizeObs?.disconnect(); _resizeObs = null;
  _resetPresence();
  _timerStopTick();
  _closeEmotePicker();  // retire le listener mousedown du picker (état dans vtt-emotes.js)
  if (VS.mapLibUnsub) { VS.mapLibUnsub(); VS.mapLibUnsub = null; }
  VS.mapLib = { folders: [], images: [] }; _resetMapLib();
  _mapLibCleanupWrite = null;
  _resetLootState();
  // Remontage de la table (retour d'onglet) : on garde la lecture musicale en
  // cours pour éviter la coupure — _syncMusicPlayback la reconnaît sans restart.
  _resetMusicState(true);
  _mtClear(true);
  _mtBroadcasting = false;
  VS.presence = {}; VS.miniUid = null; VS.miniCharId = null;
  VS.tokens = {}; VS.pages = {}; VS.characters = {}; VS.npcs = {}; VS.bestiary = {}; VS.bstTracker = {};
  VS.combatHpEstimates.clear();
  _vttResetCombatHpLog();
  setActiveStatsSession(null);
  _bestiaryLoads.clear();
  VS.session = {}; VS.activePage = null; VS.selected = null; _attackSrc = null;
  _clearAim(); _hideActBar();
  _moveHL = []; _renderedPings.clear(); _renderedReactions.clear();
  for (const k of Object.keys(_emoteStacks)) delete _emoteStacks[k];
  VS.selectedMulti.clear(); _multiDragOrigin = null;
  _annotations = {}; _drawing = false; _drawLive = null; _drawHistory = []; _drawRedo = [];
  _polyPts = []; _polyLive = null; _polyActive = false;
  _selectedAnnotId = null; _selectedAnnotIds.clear(); _annotTransformer = null;
  _annotMovePassthrough = false;
  _annotGroupDragOrigins = null;
  _marqueeActive = false; _marqueeOrigin = null; _marqueeLastWp = null;
  _marqueeShape = null; _suppressNextClick = false;
  _pingTimer = null; _pingOrigin = null;
  _resetRuler();  // réinitialise aussi l'état de diffusion MJ (cf. vtt-ruler.js)
  _resetAutoSync();
  _delegationSyncAttempts.clear();
  _resetTraySearch();
  VS.imgTr = null; VS.imgTrFg = null; VS.selImg = null; VS.mapMode = false;
  _hideCtxMenu();
  document.removeEventListener('keydown', _keyHandler);
  const mc = document.getElementById('main-content');
  if (mc) { mc.style.overflow = ''; mc.style.height = ''; mc.style.paddingBottom = ''; }
}

// Le module VTT reste en cache après la première visite. Ses listeners propres
// doivent cependant vivre uniquement tant que la table est affichée, et être
// coupés avant que l'authentification ne disparaisse lors d'une déconnexion.
document.addEventListener('app:page-changed', event => {
  if (_vttPageActive && event.detail?.page !== 'vtt') _cleanup();
});
document.addEventListener('app:session-releasing', () => {
  if (_vttPageActive) _cleanup();
});

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
  VS.stage.on('scaleXChange', _applyTokenDetailLevel);
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
    anchorStroke: '#ffe600', anchorStrokeWidth: 2,
    anchorFill: '#101827', anchorSize: 20, anchorCornerRadius: 6,
    rotateAnchorOffset: 34, padding: 7,
    rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315], rotationSnapTolerance: 8,
  });
  VS.layers.draw.add(_annotTransformer);
  _syncAnnotTransformerHandles();

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
    if (wp && VS.tool === 'ruler' && rulerActive()) { _updateRuler(wp); _vttRefreshRulerMeasure(); }
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
    _syncAnnotTransformerHandles();
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
        _vttRefreshRulerMeasure();
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
        _vttRefreshRulerMeasure();
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
    if (VS.tool === 'ruler' && rulerActive())     { _updateRuler(wp); _vttRefreshRulerMeasure(); }
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
      if (_zoneCtx) { _zoneClickAction(); return; }
      _deselect(); _deselectAnnot();
    }
  });

  // ── Pan tactile : un doigt glissé sur le stage VIDE déplace la caméra ──
  //    Sur desktop le pan se fait au clic droit / molette ; le tactile n'a
  //    aucun de ces boutons → sans ça, impossible de se déplacer sur mobile.
  //    Toucher un token/image laisse Konva gérer le drag (e.target ≠ stage).
  let _touchPanOff = null, _touchPinch = null;
  const _touchPair = touches => {
    if (!touches || touches.length < 2) return null;
    const rect = VS.stage.container().getBoundingClientRect();
    const a = touches[0], b = touches[1];
    return {
      center: {
        x: (a.clientX + b.clientX) / 2 - rect.left,
        y: (a.clientY + b.clientY) / 2 - rect.top,
      },
      distance: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
    };
  };
  const _stopTouchDrag = target => {
    window.Konva?.DD?.node?.stopDrag?.();
    let node = target;
    while (node && node !== VS.stage) {
      if (node.isDragging?.()) { node.stopDrag(); break; }
      node = node.getParent?.();
    }
  };
  VS.stage.on('touchstart', e => {
    if (fogIsEditMode() || VS.tool === 'draw' || VS.tool === 'ruler') { _touchPanOff = null; return; }
    const ts = e.evt.touches;
    if (ts?.length >= 2) {
      e.evt.preventDefault();
      _stopTouchDrag(e.target);
      const pair = _touchPair(ts);
      _touchPanOff = null;
      _touchPinch = pair ? {
        startScale: VS.stage.scaleX(),
        startPosition: { ...VS.stage.position() },
        startCenter: pair.center,
        startDistance: pair.distance,
      } : null;
      return;
    }
    _touchPinch = null;
    const rect = VS.stage.container().getBoundingClientRect();
    _touchPanOff = (ts && ts.length === 1 && e.target === VS.stage)
      ? { x: ts[0].clientX - rect.left - VS.stage.x(), y: ts[0].clientY - rect.top - VS.stage.y() }
      : null;
  });
  VS.stage.on('touchmove', e => {
    const ts = e.evt.touches;
    if (ts?.length >= 2) {
      e.evt.preventDefault();
      _stopTouchDrag(e.target);
      const pair = _touchPair(ts);
      if (!_touchPinch && pair) {
        _touchPinch = {
          startScale: VS.stage.scaleX(),
          startPosition: { ...VS.stage.position() },
          startCenter: pair.center,
          startDistance: pair.distance,
        };
      }
      if (_touchPinch && pair) {
        const view = vttPinchCameraTransform({ ..._touchPinch, currentCenter:pair.center, currentDistance:pair.distance, minScale:MIN_SCALE, maxScale:MAX_SCALE });
        VS.stage.scale({ x:view.scale, y:view.scale });
        VS.stage.position({ x:view.x, y:view.y });
        _syncAnnotTransformerHandles();
        VS.stage.batchDraw();
      }
      _touchPanOff = null;
      return;
    }
    if (!_touchPanOff) return;
    if (!ts || ts.length !== 1) { _touchPanOff = null; _touchPinch = null; return; }
    e.evt.preventDefault();   // empêche le scroll/zoom de page natif
    const rect = VS.stage.container().getBoundingClientRect();
    VS.stage.position({ x: ts[0].clientX - rect.left - _touchPanOff.x, y: ts[0].clientY - rect.top - _touchPanOff.y });
  });
  VS.stage.on('touchend touchcancel', e => {
    _touchPanOff = null;
    if (!e.evt.touches || e.evt.touches.length < 2) _touchPinch = null;
  });

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

// ═══════════════════════════════════════════════════════════════════
// TOKENS — shapes Konva
// ═══════════════════════════════════════════════════════════════════
const _TOKEN_RING_TONES = {
  selected: { stroke:'#60a5fa', shadow:'#2563eb' },
  friendly: { stroke:'#4ade80', shadow:'#16a34a' },
  hostile:  { stroke:'#fb7185', shadow:'#dc2626' },
};

function _setRingTone(ring, tone='selected') {
  if (!ring) return;
  const colors=_TOKEN_RING_TONES[tone] || _TOKEN_RING_TONES.selected;
  ring.stroke(colors.stroke);
  ring.shadowColor(colors.shadow);
}

function _setSelectionRing(id, visible=true) {
  const shape=VS.tokens[id]?.shape;
  const ring=shape?.findOne('.sel');
  if (!ring) return;
  _setRingTone(ring, 'selected');
  ring.visible(visible);
  const footprint=shape.findOne('.sel-footprint');
  _setRingTone(footprint, 'selected');
  footprint?.visible(visible);
  const spin=shape.findOne('.sel-spin');
  if (spin) { spin.visible(visible); if (!visible) spin.rotation(0); }
  _syncFxAnim();
}

// Effets animés des tokens : RETIRÉS pour cause de perf. Une Konva.Animation
// redessinait TOUT le calque des tokens (ombres comprises) à 60 fps EN CONTINU
// dès qu'un token était sélectionné ou actif → FPS effondré sur les machines
// modestes des joueurs (la machine du MJ absorbait le coût, d'où l'asymétrie).
// Les anneaux de sélection / de tour restent STATIQUES (aucun redraw permanent).
// no-op conservé pour ne pas toucher aux points d'appel existants.
function _syncFxAnim() { /* volontairement vide : plus d'animation continue (perf joueurs) */ }

function _targetTone(srcId, tgtId, friendlyAction=false) {
  return tokenRelationTone(VS.tokens[srcId]?.data, VS.tokens[tgtId]?.data, friendlyAction);
}

function _configureTargetRings(shape, tone='hostile', visible=true) {
  const ring=shape?.findOne('.target');
  const inner=shape?.findOne('.target-inner');
  const footprint=shape?.findOne('.target-footprint');
  if (!ring) return;
  _setRingTone(ring, tone);
  ring.dash(tone==='hostile'?[6,3]:[]);
  ring.visible(visible);
  if (inner) {
    _setRingTone(inner, tone);
    inner.visible(visible && tone==='friendly');
  }
  if (footprint) {
    _setRingTone(footprint, tone);
    footprint.dash(tone==='hostile'?[8,4]:[]);
    footprint.fill(tone==='friendly'?'rgba(34,197,94,.08)':'rgba(239,68,68,.08)');
    footprint.visible(visible);
  }
}

function _setAttackRing(id, visible=true) {
  const shape=VS.tokens[id]?.shape;
  shape?.findOne('.atk')?.visible(visible);
  shape?.findOne('.atk-footprint')?.visible(visible);
}

function _setReachableFootprint(id, mode='weapon', visible=true) {
  const footprint=VS.tokens[id]?.shape?.findOne('.reachable-footprint');
  if (!footprint) return;
  const extended=mode==='extended';
  const friendly=mode==='friendly';
  const stroke=friendly?'#4ade80':extended?'#a78bfa':'#fb7185';
  footprint.stroke(stroke);
  footprint.shadowColor(stroke);
  footprint.fill(friendly?'rgba(34,197,94,.08)':extended?'rgba(167,139,250,.08)':'rgba(239,68,68,.08)');
  footprint.dash(extended?[7,4]:[]);
  footprint.visible(visible);
}

function _clearReachableFootprints() {
  Object.values(VS.tokens || {}).forEach(entry => entry?.shape?.findOne('.reachable-footprint')?.visible(false));
}

function _setTargetRing(id, tone='hostile', visible=true) {
  _configureTargetRings(VS.tokens[id]?.shape, tone, visible);
}

function _clearTargetRings() {
  Object.values(VS.tokens || {}).forEach(entry => _configureTargetRings(entry?.shape, 'hostile', false));
}

function _syncTokenResourceLabels(shape, scale=VS.stage?.scaleX?.() ?? 1) {
  if (!shape) return;
  // Sous 90 %, afficher seulement la valeur restante et agrandir légèrement le
  // panneau complet. Son texte conserve ainsi une taille visuelle exploitable.
  const compact=scale<.9;
  const fontSize=compact?10:8;
  const panelScale=Math.min(1.45,Math.max(1,.86/Math.max(.25,scale)));
  const hp=shape.getAttr('displayHpSnapshot');
  const hpMax=shape.getAttr('displayHpMaxSnapshot');
  const pm=shape.getAttr('displayPmSnapshot');
  const pmMax=shape.getAttr('displayPmMaxSnapshot');
  const hpText=shape.findOne('.hp-val');
  const pmText=shape.findOne('.pm-val');
  if (hpText) {
    hpText.text(hp==null?'♥?':(compact?`♥${hp}`:`♥${hp}/${hpMax ?? '?'}`));
    hpText.fontSize(fontSize);
  }
  if (pmText) {
    pmText.text(pm==null?'✦?':(compact?`✦${pm}`:`✦${pmMax>0?`${pm}/${pmMax}`:pm}`));
    pmText.fontSize(fontSize);
  }
  shape.findOne('.resource-panel')?.scale({x:panelScale,y:panelScale});
}

function _applyTokenDetailToShape(shape, scale=VS.stage?.scaleX?.() ?? 1) {
  if (!shape) return;
  const level=tokenDetailLevel(scale);
  const showIdentity=level!=='compact';
  const showEffects=level==='detailed';
  shape.find('.token-name').forEach(node=>node.visible(showIdentity));
  // Les valeurs PV/PM sont essentielles au jeu : elles restent visibles même
  // au zoom compact, contrairement au nom et aux détails d'effets.
  shape.find('.resource-value').forEach(node=>node.visible(true));
  shape.find('.effect-detail').forEach(node=>node.visible(showEffects));
  _syncTokenResourceLabels(shape, scale);
  shape.setAttr('detailLevel', level);
}

function _applyTokenDetailLevel() {
  const scale=VS.stage?.scaleX?.() ?? 1;
  Object.values(VS.tokens || {}).forEach(entry=>_applyTokenDetailToShape(entry?.shape, scale));
  VS.layers.token?.batchDraw();
}

function _stackPeers(token) {
  if (!token) return [];
  const typeRank={player:0,npc:1,enemy:2};
  return Object.values(VS.tokens || {})
    .filter(entry=>{
      const other=entry?.data;
      return other && entry.shape?.visible() && other.pageId===token.pageId
        && other.col===token.col && other.row===token.row;
    })
    .map(entry=>entry.data)
    .sort((a,b)=>{
      const controlled=Number(_canControlToken(b))-Number(_canControlToken(a));
      if (controlled) return controlled;
      const type=(typeRank[a.type]??9)-(typeRank[b.type]??9);
      if (type) return type;
      return String(_live(a).displayName||a.name||a.id).localeCompare(String(_live(b).displayName||b.name||b.id));
    });
}

function _syncTokenStackVisuals() {
  Object.values(VS.tokens || {}).forEach(entry=>{
    const count=_stackPeers(entry?.data).length;
    const visible=count>1;
    entry?.shape?.findOne('.stack-badge')?.visible(visible);
    const label=entry?.shape?.findOne('.stack-count');
    if (label) { label.text(`×${count}`); label.visible(visible); }
  });
  VS.layers.token?.batchDraw();
}

function _nextStackToken(token) {
  const peers=_stackPeers(token);
  if (peers.length<2) return token?.id || null;
  const current=peers.findIndex(peer=>peer.id===VS.selected);
  return peers[(current>=0?current+1:peers.findIndex(peer=>peer.id===token.id))%peers.length]?.id || token.id;
}

function _syncTokenMovementVisual() {
  Object.entries(VS.tokens || {}).forEach(([id,entry])=>{
    const token=entry?.data;
    const visible=id===VS.selected && !!VS.session?.combat?.active && _canControlToken(token);
    const bg=entry?.shape?.findOne('.move-badge');
    const value=entry?.shape?.findOne('.move-value');
    bg?.visible(visible);
    value?.visible(visible);
    if (visible && value) {
      const movement=tokenMovementMeta(_live(token).displayMovement??6,token.bonusMvt,token.movedCells);
      value.text(`🏃 ${movement.remaining}/${movement.maximum}`);
      bg.stroke(movement.exhausted?'#f97316':'#38bdf8');
      bg.fill(movement.exhausted?'rgba(67,20,7,.94)':'rgba(8,47,73,.94)');
      value.fill(movement.exhausted?'#ffedd5':'#e0f2fe');
    }
  });
  VS.layers.token?.batchDraw();
}

function _buildShape(t) {
  // Visuel pur (forme, barres, badges, nom, portrait) → vtt-render.js.
  // `ld` = données effectives (via _live) ; les handlers d'interaction ci-dessous
  // restent ici, attachés au groupe retourné.
  const ld = _live(t);
  const sw = ld.displayTokenW || 1, sh = ld.displayTokenH || 1;
  const g = _buildTokenVisual(t, ld, CONDITION_BY_ID);
  _applyTokenDetailToShape(g);

  const canDrag = _canControlToken(t);
  g.setAttr('vttCanDragToken', canDrag);
  let rightDown = null;
  if (canDrag) {
    g.draggable(VS.tool === 'select');
    g.on('mousedown', e => {
      if (e.evt.button === 2) rightDown = { x:e.evt.clientX, y:e.evt.clientY, dragged:false };
    });
    // ─ Début du drag : mémoriser les positions du groupe ─
    g.on('dragstart', () => {
      // La delegation peut changer apres la creation du shape : revalider au
      // moment exact du geste, pas uniquement lors du rendu initial.
      if (!_canControlToken(VS.tokens[t.id]?.data || t)) {
        g.stopDrag();
        g.position({ x:t.col*CELL+sw*CELL/2, y:t.row*CELL+sh*CELL/2 });
        VS.layers.token?.batchDraw();
        return;
      }
      if (rightDown) rightDown.dragged = true;
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
          if (!_canControlToken(VS.tokens[id]?.data)) continue;
          const s=VS.tokens[id]?.shape;
          if (s) _multiDragOrigin[id]={x:s.x(),y:s.y()};
        }
      } else { _multiDragOrigin=null; }
    });
    // ─ Pendant le drag : snap + déplacer le groupe ─
    g.on('dragmove', () => {
      if (!_canControlToken(VS.tokens[t.id]?.data || t)) {
        g.stopDrag();
        g.position({ x:t.col*CELL+sw*CELL/2, y:t.row*CELL+sh*CELL/2 });
        VS.layers.token?.batchDraw();
        return;
      }
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
      if (!_canControlToken(VS.tokens[t.id]?.data || t)) {
        g.position({ x:t.col*CELL+sw*CELL/2, y:t.row*CELL+sh*CELL/2 });
        VS.layers.token?.batchDraw();
        _multiDragOrigin = null;
        return;
      }
      if (VS.tool !== 'select' || _zoneCtx || _mtCtx || _middlePanActive) {
        g.position({ x:t.col*CELL+sw*CELL/2, y:t.row*CELL+sh*CELL/2 });
        VS.layers.token?.batchDraw();
        _multiDragOrigin = null;
        return;
      }
      const pg=VS.activePage; if (!pg) return;
      if (_multiDragOrigin && VS.selectedMulti.has(t.id) && VS.selectedMulti.size>1) {
        // Batch : valider tout le groupe avant d'écrire. Un déplacement groupé
        // est atomique : si un token dépasse son mouvement ou traverse un mur,
        // aucun token ne bouge et les shapes reviennent à leur point de départ.
        const restoreGroup = () => {
          for (const [id, orig] of Object.entries(_multiDragOrigin || {})) {
            VS.tokens[id]?.shape?.position({ x: orig.x, y: orig.y });
          }
          VS.layers.token?.batchDraw();
        };
        const moves=[];
        for (const id of VS.selectedMulti) {
          const s=VS.tokens[id]?.shape; if (!s) continue;
          const tokenData=VS.tokens[id].data;
          if (!_canControlToken(tokenData)) continue;
          const d2=_tokenDims(tokenData);
          const nc=_clampTokenCell(Math.round((s.x()-d2.w*CELL/2)/CELL), d2.w, pg.cols);
          const nr=_clampTokenCell(Math.round((s.y()-d2.h*CELL/2)/CELL), d2.h, pg.rows);
          s.position({x:nc*CELL+d2.w*CELL/2,y:nr*CELL+d2.h*CELL/2});
          const distance=Math.abs(nc-tokenData.col)+Math.abs(nr-tokenData.row);
          if (!STATE.isAdmin && VS.session?.combat?.active) {
            const maxMvt=(_live(tokenData).displayMovement??6)+(tokenData.bonusMvt||0);
            const rem=maxMvt-(tokenData.movedCells||0);
            if (distance>rem) {
              restoreGroup();
              showNotif(rem<=0 ? 'Plus de mouvement ce tour !' : `Déplacement groupé trop loin (${rem} case${rem!==1?'s':''} restante${rem!==1?'s':''}).`, 'error');
              _multiDragOrigin=null; return;
            }
          }
          if (!STATE.isAdmin && distance && (VS.activePage?.walls||[]).length
              && fogWallBlocksPath(tokenData.col, tokenData.row, nc, nr, VS.activePage.walls)) {
            restoreGroup();
            showNotif('🧱 Un token du groupe est bloqué par un obstacle.', 'error');
            _multiDragOrigin=null; return;
          }
          const movePatch={col:nc,row:nr};
          if (VS.session?.combat?.active && distance) {
            movePatch.moveOrigin = _combatMoveOrigin(tokenData);
            if (!STATE.isAdmin) {
              movePatch.movedCells=(tokenData.movedCells||0)+distance;
              movePatch.movedThisTurn=true;
            }
          }
          moves.push({id, tokenData, patch:movePatch});
        }
        const batch=writeBatch(db);
        moves.forEach(move=>{
          move.previous=Object.fromEntries(Object.keys(move.patch).map(key=>[key,move.tokenData[key]]));
          Object.assign(move.tokenData,move.patch);
          batch.update(_tokRef(move.id),move.patch);
        });
        VS.layers.token.batchDraw();
        const selectedMove=moves.find(move=>move.id===VS.selected);
        if (selectedMove) _refreshRanges(selectedMove.id, selectedMove.tokenData);
        fogUpdateSoon(VS.activePage, VS.tokens, STATE.isAdmin);
        try {
          await batch.commit();
        } catch (error) {
          console.error('[vtt] déplacement groupé', error);
          moves.forEach(move=>Object.assign(move.tokenData,move.previous));
          restoreGroup();
          showNotif('Erreur déplacement groupe', 'error');
        }
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
      const moveCur=VS.tokens[t.id]?.data;
      if (VS.session?.combat?.active && moveCur && (c !== moveCur.col || r !== moveCur.row)) {
        patch.moveOrigin = _combatMoveOrigin(moveCur);
      }
      if (!STATE.isAdmin&&VS.session?.combat?.active && moveCur && (c !== moveCur.col || r !== moveCur.row)) {
        const cur=VS.tokens[t.id]?.data;
        const d=Math.abs(c-(cur?.col??c))+Math.abs(r-(cur?.row??r));
        patch.movedCells=(cur?.movedCells||0)+d;
        patch.movedThisTurn=true;
      }
      const previous=moveCur
        ? Object.fromEntries(Object.keys(patch).map(key=>[key,moveCur[key]]))
        : null;
      if (moveCur) Object.assign(moveCur,patch);
      _refreshRanges(t.id, moveCur);
      fogUpdateSoon(VS.activePage, VS.tokens, STATE.isAdmin);
      try {
        await updateDoc(_tokRef(t.id),patch);
      } catch (error) {
        console.error('[vtt] déplacement token', error);
        if (moveCur && previous) Object.assign(moveCur,previous);
        g.position({x:(moveCur?.col??c)*CELL+sw*CELL/2,y:(moveCur?.row??r)*CELL+sh*CELL/2});
        VS.layers.token?.batchDraw();
        showNotif('Erreur déplacement', 'error');
        return;
      }
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
    // Le calque des dessins est sous celui des tokens : si le clic atteint bien un
    // token, l'intention est d'interagir avec lui. Retirer alors le Transformer évite
    // qu'une forme englobante reprenne visuellement le focus au clic suivant.
    if (_selectedAnnotIds.size > 0) _deselectAnnot();
    // Si le token du joueur est masqué sous un autre token, prioriser son propre token
    // lors d'une sélection simple (sauf attaque/zone/cible multi/shift).
    const stack=_stackPeers(t);
    if (!STATE.isAdmin && !_attackSrc && !_zoneCtx && !_mtCtx
        && !e.evt.shiftKey && !e.evt.ctrlKey && !e.evt.metaKey
        && !_canControlToken(t)) {
      const ownId = _findOwnTokenAtPointer();
      const alreadyBrowsing=stack.some(peer=>peer.id===VS.selected);
      if (ownId && ownId !== t.id && !alreadyBrowsing) {
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

    // Plusieurs tokens exactement sur la même case : le premier clic sélectionne
    // le token visible, les suivants parcourent la pile et amènent le choix au-dessus.
    if (!opts.deselectOutOfRange && !_attackSrc && !_zoneCtx && !_mtCtx && !_aimOpt
        && stack.length>1 && stack.some(peer=>peer.id===VS.selected)) {
      const nextId=_nextStackToken(t);
      if (nextId) { _select(nextId); return; }
    }

    // Mode zone AoE actif → le clic verrouille / déverrouille le placement.
    // Aucun token n'est sélectionnable ici, lanceur compris : sinon cliquer sur
    // le lanceur tombait dans le `else` final et rouvrait le HUD d'action.
    if (_zoneCtx) {
      _zoneClickAction();
      return;
    }

    // Mode ciblage multi-cibles actif → basculer toute cible, lanceur compris.
    // Le clic sur son propre token ne doit jamais retomber sur l'ouverture des
    // actions : un soin/buff multicible peut tout à fait inclure le lanceur.
    if (_mtCtx) {
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
      const srcId = _attackSrc;
      if (srcId === t.id) {
        _renderInspector(t);
        _execAttack(srcId, t.id, { selfTarget: true });
        return;
      }
      if (!_isAttackTargetInRange(srcId, t.id)) {
        _select(t.id);
        return;
      }
      _setSelectionRing(VS.selected, false);
      _clearTargetRings();
      VS.selected = t.id;
      _setTargetRing(t.id, _targetTone(srcId, t.id));
      _renderInspector(t);
      VS.layers.token?.batchDraw();
      _execAttack(srcId, t.id);
    } else {
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

function _showTokenDelta(token, delta, resource='hp') {
  const meta=tokenDeltaMeta(delta, resource);
  if (!token || !meta || token.pageId!==VS.activePage?.id
      || !VS.layers.ping || !window.Konva) return;
  const shape=VS.tokens[token.id]?.shape;
  if (!shape?.visible()) return;
  const K=window.Konva;
  const scale=Math.max(.2, VS.stage?.scaleX?.() || 1);
  const { color, label }=meta;
  const width=Math.max(44, label.length*6.2);
  const group=new K.Group({
    x:shape.x(), y:shape.y()-CELL*.42+(meta.resource==='pm'?9/scale:0),
    scaleX:1/scale, scaleY:1/scale, listening:false, opacity:1,
  });
  group.add(new K.Rect({ x:-width/2, y:-9, width, height:18, cornerRadius:9,
    fill:'rgba(5,8,14,.9)', stroke:color, strokeWidth:1.5,
    shadowColor:'#000', shadowBlur:7, shadowOpacity:.65, listening:false }));
  group.add(new K.Text({ x:-width/2, y:-5.5, width, height:12, text:label,
    align:'center', fontSize:10, fontStyle:'bold', fill:color,
    fontFamily:'Inter,sans-serif', listening:false }));
  VS.layers.ping.add(group);
  VS.layers.ping.batchDraw();
  const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  // Temps de lecture fixe, puis montée/fondu. Auparavant le texte disparaissait
  // dès son apparition, ce qui le rendait facile à manquer en plein combat.
  group._holdTimer=setTimeout(()=>{
    if (group.getStage()===null) return;
    group.to({
      y:group.y()-(reduced?8:30)/scale, opacity:0, duration:reduced ? .35 : 1.2,
      easing:K.Easings.EaseOut,
      onFinish:()=>{group.destroy();VS.layers.ping?.batchDraw();},
    });
  }, reduced ? 1000 : 900);
}

/** Affiche immédiatement la variation calculée avant que Firestore ne renvoie
 * son snapshot local. Le snapshot mémorisé est avancé à la nouvelle valeur :
 * le patch temps réel mettra les jauges à jour sans rejouer une seconde bulle. */
function _showAppliedHpDelta(token, beforeHp, afterHp, nextDisplayedHp = afterHp) {
  const before = Number(beforeHp);
  const after = Number(afterHp);
  if (!token || !Number.isFinite(before) || !Number.isFinite(after) || before === after) return;
  const displayed = Number(nextDisplayedHp);
  if (Number.isFinite(displayed)) VS.tokens[token.id]?.shape?.setAttr('displayHpSnapshot', displayed);
  _showTokenDelta(token, after - before, 'hp');
}

/** Rafraîchit sans attendre Firestore uniquement si le carré d'identité montre
 * ce token. Couvre aussi le personnage affiché par défaut côté joueur, même
 * lorsqu'aucun token n'a été sélectionné explicitement. */
function _refreshDisplayedIdentitySoon(tokenId) {
  if (!tokenId) return;
  const inspector = document.getElementById('vtt-inspector');
  if (VS.selected === tokenId || inspector?.dataset.tokenId === tokenId) {
    _renderInspectorSoon();
  }
}

function _patchEntityTokenShapes(linkField, entityId) {
  if (!entityId) return;
  Object.values(VS.tokens || {}).forEach(entry => {
    if (entry?.data?.[linkField] !== entityId) return;
    _patchShape(entry.data.id);
    _refreshDisplayedIdentitySoon(entry.data.id);
  });
}

export function _vttPatchTokenOptimistically(id, patch) {
  const token = VS.tokens?.[id]?.data;
  if (!token || !patch) return;
  Object.assign(token, patch);
  _patchShape(id);
  _refreshDisplayedIdentitySoon(id);
}

// Répercute immédiatement les PV dans le cache vivant et sur la jauge Konva.
// Le snapshot Firestore confirmera ensuite la même valeur sans saut visuel.
function _patchHpOptimistically(token, hp, pvCombatHp = undefined) {
  if (!token) return;
  if (token.characterId && VS.characters[token.characterId]) {
    VS.characters[token.characterId].hp = hp;
  } else if (token.npcId && VS.npcs[token.npcId]) {
    VS.npcs[token.npcId].hp = hp;
  } else {
    token.hp = hp;
  }
  if (pvCombatHp !== undefined) token.pvCombatHp = pvCombatHp;
  _patchShape(token.id);
  _refreshDisplayedIdentitySoon(token.id);
  // L'anneau de PV du panneau « En scène » est du DOM (pas du Konva) : il
  // doit suivre la valeur optimiste sans attendre le retour Firestore.
  _renderTraySoon();
}

function _showTokenNotice(token, label, color='#fbbf24') {
  if (!token || !label || token.pageId!==VS.activePage?.id || !VS.layers.ping || !window.Konva) return;
  const shape=VS.tokens[token.id]?.shape;
  if (!shape?.visible()) return;
  const K=window.Konva, scale=Math.max(.2,VS.stage?.scaleX?.()||1);
  const width=Math.max(58,Math.min(132,label.length*5.8));
  const group=new K.Group({x:shape.x(),y:shape.y()-CELL*.56,scaleX:1/scale,scaleY:1/scale,listening:false});
  group.add(new K.Rect({x:-width/2,y:-9,width,height:18,cornerRadius:9,
    fill:'rgba(5,8,14,.92)',stroke:color,strokeWidth:1.3,shadowColor:'#000',shadowBlur:7,shadowOpacity:.65,listening:false}));
  group.add(new K.Text({x:-width/2+4,y:-5.5,width:width-8,height:12,text:label,
    align:'center',fontSize:9,fontStyle:'bold',fill:color,ellipsis:true,wrap:'none',fontFamily:'Inter,sans-serif',listening:false}));
  VS.layers.ping.add(group);VS.layers.ping.batchDraw();
  group._holdTimer=setTimeout(()=>{
    if(group.getStage()===null)return;
    group.to({y:group.y()-24/scale,opacity:0,duration:1.1,easing:K.Easings.EaseOut,
      onFinish:()=>{group.destroy();VS.layers.ping?.batchDraw();}});
  },900);
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
  const previousHp=g.getAttr('displayHpSnapshot');
  const previousPm=g.getAttr('displayPmSnapshot');
  const currentHp=ld.displayHp==null?null:Number(ld.displayHp);
  const currentPm=ld.displayPm==null?null:Number(ld.displayPm);
  const hpDelta=Number.isFinite(previousHp)&&Number.isFinite(currentHp)?currentHp-previousHp:0;
  const pmDelta=Number.isFinite(previousPm)&&Number.isFinite(currentPm)?currentPm-previousPm:0;
  const hasPmBar   = !!g.findOne('.pm-fill');
  const hasCaBuff  = !!g.findOne('.ca-buff-turns');
  const needsCaBuff = !!ld._activeCaBuff;
  const sw = ld.displayTokenW || 1, sh = ld.displayTokenH || 1;
  // Si la taille a changé (modif bestiaire ou override), reconstruire
  const sizeMismatch = (g.getAttr('tokenW') || 1) !== sw || (g.getAttr('tokenH') || 1) !== sh;
  // Un token peut être construit avant le chargement de sa fiche liée (bestiaire,
  // PNJ, personnage). Quand son image effective arrive ensuite, il faut rebâtir
  // la forme Konva ; un simple patch des textes/barres laisse le cercle coloré.
  const imageMismatch = (g.getAttr('displayImage') || null) !== (ld.displayImage || null);
  // Les icônes, leur ordre et leur durée comptent aussi : remplacer Paralysé par
  // Brûlé sans changer le nombre d'états doit bien reconstruire le rail.
  const _condRoundP = VS.session?.combat?.round ?? 0;
  const currentEffects=tokenActiveEffects(e.data, CONDITION_BY_ID, _condRoundP);
  const effectSignature = tokenEffectsSignature(currentEffects);
  const effectsMismatch = effectSignature !== (g.getAttr('effectSignature') || '');
  const currentEffectKeys=new Set(currentEffects.map(effect=>`${effect.kind}:${effect.key}`));
  const expiredEffects=(g.getAttr('activeEffectsSnapshot')||[])
    .filter(effect=>!currentEffectKeys.has(`${effect.kind}:${effect.key}`));
  if ((ld.displayPm != null || ld.hasMana) !== hasPmBar || hasCaBuff !== needsCaBuff
      || sizeMismatch || imageMismatch || effectsMismatch) {
    const shape = _buildShape(e.data);
    g.destroy();
    VS.tokens[id] = { ...e, shape };
    VS.layers.token?.add(shape);
    if (VS.selected === id && _attackSrc!==id) {
      if (_attackSrc) {
        _configureTargetRings(shape, _targetTone(_attackSrc, id), true);
      } else {
        _setSelectionRing(id, true);
      }
    }
    if (_attackSrc === id) _setAttackRing(id, true);
    if (hpDelta) _showTokenDelta(e.data, hpDelta, 'hp');
    if (pmDelta) _showTokenDelta(e.data, pmDelta, 'pm');
    if (expiredEffects.length) {
      const labels=expiredEffects.slice(0,2).map(effect=>`${effect.icon||'✨'} ${effect.label||'Effet'}`);
      _showTokenNotice(e.data, `${labels.join(', ')} terminé${expiredEffects.length>1?'s':''}`);
    }
    if (VS.selected===id) _syncTokenMovementVisual();
    _syncFxAnim();
    VS.layers.token?.batchDraw();
    return;
  }
  g.to({ x:e.data.col*CELL+sw*CELL/2, y:e.data.row*CELL+sh*CELL/2, duration:0.22, easing:window.Konva?.Easings?.EaseInOut });
  const health = tokenHealthMeta(ld.displayHp, ld.displayHpMax);
  // KO visible par tous, même PV masqués (ld.isDown = PV réels, sans le nombre).
  const isDown = health.isDown || !!ld.isDown;
  const bW=Math.max(62, Math.min(CELL*sw*0.98, 150));
  const hasMana=ld.displayPm!=null || ld.hasMana;
  const hpW=hasMana?(bW-1)/2:bW;
  const fill=g.findOne('.hp-fill');
  if (fill){fill.width(Math.max(2,(hpW-2)*health.ratio));fill.fill(health.color);}
  g.findOne('.hp-val')?.text(health.known?`♥${health.current}/${health.maximum}`:'♥?');
  g.findOne('.portrait')?.opacity(isDown ? .46 : 1);
  g.findOne('.down-overlay')?.visible(isDown);
  g.findOne('.down-icon')?.visible(isDown);
  const tokenRing=g.findOne('.token-ring');
  if (tokenRing) {
    tokenRing.stroke(isDown ? '#ef4444' : (TYPE_COLOR[e.data.type] ?? '#94a3b8'));
    tokenRing.shadowColor(isDown ? '#ef4444' : '#000');
    tokenRing.shadowBlur(isDown ? 10 : 5);
  }
  g.setAttr('healthTone', health.tone);
  g.setAttr('displayHpSnapshot', health.known ? health.current : null);
  g.setAttr('displayHpMaxSnapshot', health.known ? health.maximum : null);
  // PM (créatures avec mana ; "✨?" si pas d'estimation côté joueur)
  const _pm=ld.displayPm;
  if (_pm!=null || ld.hasMana) {
    const _pmK=_pm!=null;
    const pmMax=Number(ld.displayPmMax);
    const pmMaxKnown=Number.isFinite(pmMax)&&pmMax>0;
    const pmRat=_pmK&&pmMaxKnown?Math.min(1,Math.max(0,_pm/pmMax)):(_pmK?1:0);
    const pmW=bW-hpW-1;
    g.findOne('.pm-fill')?.width(Math.max(2,(pmW-2)*pmRat));
    g.findOne('.pm-fill')?.fill(_pmK?'#a78bfa':'#475569');
    g.findOne('.pm-val')?.text(_pmK?(pmMaxKnown?`✦${_pm}/${pmMax}`:`✦${_pm}`):'✦?');
  }
  g.setAttr('displayPmSnapshot', _pm == null ? null : Number(_pm));
  g.setAttr('displayPmMaxSnapshot', Number.isFinite(Number(ld.displayPmMax)) ? Number(ld.displayPmMax) : null);
  _syncTokenResourceLabels(g);
  // CA + buff
  const _buff   = ld._activeCaBuff;
  const _buffed = !!_buff;
  const _round  = VS.session?.combat?.round ?? 0;
  g.findOne('.ca-lbl')?.text(`🛡${ld.caBadge ?? (ld.displayDefense??0)}`);
  g.findOne('.ca-lbl')?.fill(_buffed ? '#c4b5fd' : '#e2e8f0');
  g.findOne('.ca-bg')?.stroke(_buffed ? '#818cf8' : '#64748b');
  g.findOne('.ca-bg')?.strokeWidth(_buffed ? 1.5 : 1);
  g.findOne('.ca-bg')?.fill(_buffed ? 'rgba(30,27,80,0.95)' : 'rgba(15,15,25,0.9)');
  if (_buff) {
    const tl = _buff.expiresAtRound != null && _round > 0 ? _buff.expiresAtRound - _round + 1 : _buff.totalDuration ?? '∞';
    g.findOne('.ca-buff-turns')?.text(String(tl));
  }
  g.findOne('.lbl')?.text(ld.displayName??e.data.name);
  g.findOne('.turn-active')?.visible(!!VS.session?.combat?.active && VS.session?.combat?.activeTokenId===id);
  _syncFxAnim();
  if (hpDelta) _showTokenDelta(e.data, hpDelta, 'hp');
  if (pmDelta) _showTokenDelta(e.data, pmDelta, 'pm');
  g.visible(STATE.isAdmin || (!!e.data.visible && !_tokenOffGrid(e.data)));
  if (VS.selected===id) _syncTokenMovementVisual();
  VS.layers.token?.batchDraw();
}

// ── Sélection ───────────────────────────────────────────────────────
export function _select(id, { quiet = false } = {}) {
  _clearAim(); // changer de sélection annule une visée action-first en cours
  if (_selectedAnnotIds.size > 0) _deselectAnnot();
  if (VS.imgTr&&VS.selImg) { VS.imgTr.nodes([]); VS.selImg=null; VS.layers.map?.batchDraw(); }
  _setSelectionRing(VS.selected, false);
  _clearTargetRings();
  _setAttackRing(_attackSrc, false);
  _attackSrc=null; _clearHL();
  VS.selected=id;
  _setSelectionRing(id, true);
  if (_stackPeers(VS.tokens[id]?.data).length>1) VS.tokens[id]?.shape?.moveToTop();
  _syncTokenMovementVisual();
  VS.layers.token.batchDraw();
  const data=VS.tokens[id]?.data;
  _renderInspector(data??null);
  if (!quiet && data) _vttFocusInspectorIfTabbed();
  // Clic sur un token allié/propre : portée de déplacement (bleu) + portée d'attaque (rouge).
  // `quiet` (auto-sélection à l'arrivée sur la carte) : on N'ARME PAS les portées ni
  // la visée — juste la fiche + l'anneau — pour ne pas noyer la carte de surbrillances
  // que le joueur n'a pas demandées. Un vrai clic (non quiet) les activera.
  if (!quiet && data && _canControlToken(data)) {
    _showMoveRange(data);    // cases bleues cliquables (déplacement)
    _attackSrc = id;
    _setAttackRing(id, true);
    VS.layers.token.batchDraw();
    _showAttackRange(data);
    _hideActBar();
    _vttSetEmoteEmitter(id);  // ce token devient l'émetteur d'émotes
  } else {
    _hideActBar();
  }
}

// Joueur : affiche sa fiche par défaut dans le pupitre sans sélectionner le token
// sur le canvas. Sélection tactique et identité persistante restent indépendantes.
function _vttAutoSelectOwnToken() {
  if (STATE.isAdmin || VS.selected) return;
  _renderInspectorSoon();
}

function _updateTokenDraggable() {
  const active = VS.tool === 'select';
  Object.values(VS.tokens || {}).forEach(entry => {
    const shape = entry?.shape;
    if (!shape) return;
    const canDrag = _canControlToken(entry.data);
    shape.setAttr('vttCanDragToken', canDrag);
    shape.draggable(active && canDrag);
  });
  VS.layers.token?.batchDraw();
}

export function _deselect() {
  _setSelectionRing(VS.selected, false);
  _clearTargetRings();
  _setAttackRing(_attackSrc, false);
  _clearAim(); _hideActBar();
  VS.selected=null; _attackSrc=null; _clearHL(); _clearMultiSelect(); _renderInspector(null);
  _syncTokenMovementVisual();
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
  _clearTargetRings();
  _setAttackRing(_attackSrc, false);
  _attackSrc = srcId;
  _setAttackRing(srcId, true);
  VS.layers.token?.batchDraw();
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
  _setAttackRing(srcId, true);
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
    const rect = new K.Rect({ x:c*CELL+1.5, y:r*CELL+1.5, width:CELL-3, height:CELL-3, cornerRadius:5,
      fill:`rgba(${c3},0.16)`, stroke:`rgba(${c3},0.60)`, strokeWidth:1.4, listening:false });
    VS.layers.grid.add(rect); _moveHL.push(rect);
  }
  Object.values(VS.tokens || {}).forEach(entry => {
    const target=entry?.data;
    if (!target || target.id===srcId || target.pageId!==VS.activePage?.id) return;
    if (_tokenAttackDistance(t, target, portee) <= portee) {
      _setReachableFootprint(target.id, friendly?'friendly':'weapon', true);
    }
  });
  VS.layers.grid.batchDraw();
  VS.layers.token?.batchDraw();
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
  _clearTargetRings();
  _setTargetRing(tgtId, _targetTone(srcId, tgtId, !!(opt.isHeal || opt.isEnchant || opt.isRegen)));
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
  if (d && _canControlToken(d)) {
    _showMoveRange(d);
    _showAttackRange(d);
    _setAttackRing(sid, true);
    VS.layers.token?.batchDraw();
  }
  showNotif('Visée annulée', 'info');
}

// ── Portée de mouvement ─────────────────────────────────────────────
function _showMoveRange(t) {
  _clearHL(); if (!VS.activePage) return;
  const moveTokenId = t.id;
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
    const rect=new K.Rect({ x:cc*CELL+1.5,y:cr*CELL+1.5,width:CELL-3,height:CELL-3, cornerRadius:5,
      fill:'rgba(79,140,255,0.20)', stroke:'rgba(79,140,255,0.55)', strokeWidth:1.4, listening:true });
    // Survol : la case s'éclaire (retour tactile facon maquette).
    rect.on('mouseenter', () => { rect.fill('rgba(79,140,255,0.42)'); rect.stroke('rgba(126,176,255,0.9)'); VS.layers.grid.batchDraw(); VS.stage && (VS.stage.container().style.cursor='pointer'); });
    rect.on('mouseleave', () => { rect.fill('rgba(79,140,255,0.20)'); rect.stroke('rgba(79,140,255,0.55)'); VS.layers.grid.batchDraw(); VS.stage && (VS.stage.container().style.cursor=''); });
    const tc=dest.aC, tr=dest.aR;
    const moveSelectedHere = async e => {
      // En mode placement de zone ou de ciblage multi-cibles : le sort est prioritaire
      // on bascule placed pour zone et on annule le déplacement
      if (_zoneCtx) {
        e.cancelBubble = true;
        _zoneClickAction();
        return;
      }
      if (_mtCtx) { e.cancelBubble = true; return; }
      e.cancelBubble = true;
      const moveToken = VS.tokens[moveTokenId]?.data;
      if (!moveToken || !_canControlToken(moveToken)) {
        _clearHL();
        showNotif('Tu ne peux pas déplacer ce token.', 'info');
        return;
      }
      // La portée appartient au token qui l'a générée. Une cible d'attaque peut
      // temporairement remplacer VS.selected : elle ne doit jamais devenir le
      // token déplacé quand le joueur clique ensuite sur une case bleue.
      if (VS.selected !== moveTokenId) _select(moveTokenId);
      await _moveTo(moveTokenId, tc, tr);
    };
    rect.on('click', e => { if (e.evt.button!==0) return; moveSelectedHere(e); });
    rect.on('contextmenu', e => { e.evt.preventDefault(); moveSelectedHere(e); });
    VS.layers.grid.add(rect); _moveHL.push(rect);
  }
  // Les dessins restent visibles, mais ne capturent plus les clics destinés aux
  // cases bleues. Le token et les autres tokens restent au-dessus et interactifs.
  _setAnnotMovePassthrough(_moveHL.length > 0);
  VS.layers.grid.batchDraw();
}
export function _clearHL() {
  _moveHL.forEach(r=>r.destroy());
  _moveHL=[];
  _setAnnotMovePassthrough(false);
  _clearReachableFootprints();
  if (VS.stage) VS.stage.container().style.cursor='';   // le survol des cases de déplacement le passait à 'pointer'
  VS.layers.grid?.batchDraw();
  VS.layers.token?.batchDraw();
}

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
  _syncTokenMovementVisual();
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
export function _showEmoteBubble(tokenId, emoteUrl, emoteName, key, opts = {}) {
  if (_renderedReactions.has(key)) return;
  _renderedReactions.add(key);
  // purge mémoire douce (évite la croissance infinie du Set sur longue session)
  if (_renderedReactions.size > 400) _renderedReactions.clear();

  const e = tokenId ? VS.tokens[tokenId] : null;
  if (e?.data && e.shape && e.data.pageId === VS.activePage?.id && VS.layers.ping && window.Konva) {
    _spawnTokenEmote(tokenId, e.data, emoteUrl, emoteName, opts);
  } else {
    _spawnCornerEmote(emoteUrl, emoteName);
  }
}

// Pile de bulles par token : 3 emplacements alignés au-dessus. Un 4ᵉ envoi fait
// sortir le plus ancien. Combo : même émote/même cible pendant qu'une bulle est
// visible → pas d'empilement, badge ×N + grossissement + durée relancée.
const _emoteStacks = {};      // tokenId -> record | null  (UNE bulle par token)

function _emoteRetire(rec) {
  if (!rec || rec._out) return;
  rec._out = true;
  clearTimeout(rec.timer);
  const g = rec.group, K = window.Konva;
  if (_emoteStacks[rec.tokenId] === rec) _emoteStacks[rec.tokenId] = null;
  if (!g || g.getStage() === null) { try { g?.destroy(); } catch {} VS.layers.ping?.batchDraw(); return; }
  g.to({ y: g.y() - CELL * 0.5, opacity: 0, scaleX: g.scaleX() * 0.85, scaleY: g.scaleY() * 0.85,
    duration: 0.4, easing: K.Easings.EaseIn,
    onFinish: () => { g.destroy(); VS.layers.ping?.batchDraw(); } });
}

// Émote ancrée : UNE bulle par token, centrée au-dessus. Une nouvelle émote
// remplace la précédente ; la même (combo) incrémente ×N sans empiler.
// opts : { big, targetTokenId, authorName, remote, count }.
function _spawnTokenEmote(tokenId, t, emoteUrl, emoteName, opts = {}) {
  const K = window.Konva;
  if (!K || !VS.layers.ping) return;
  const big = !!opts.big;
  const targetId = opts.targetTokenId || null;
  const color = _emoteTokenColor(t);
  const dim = _tokenDims(t);
  const cx = t.col * CELL + dim.w * CELL / 2;
  const topY = t.row * CELL;
  const D = (big ? CELL * 2.5 : CELL * 1.65), R = D / 2;
  const cy = topY - R * 1.12;    // au-dessus du token, la pointe descend vers lui

  const cur = _emoteStacks[tokenId];

  // ── Combo : même bulle vivante (même émote + cible, non amplifiée) → ×N ──
  if (cur && !cur._out && !big && !cur.big && cur.name === emoteName && (cur.target || '') === (targetId || '')) {
    const n = Math.max((cur.count || 1) + 1, opts.count || 0);
    cur.count = n;
    const grow = cur.baseScale * Math.min(1 + 0.07 * (n - 1), 1.35);
    cur.group.to({ scaleX: grow, scaleY: grow, duration: 0.2, easing: K.Easings.BackEaseOut });
    _emoteBadge(cur, n, color);
    clearTimeout(cur.timer);
    cur.timer = setTimeout(() => _emoteRetire(cur), 2600);
    if (targetId) _emoteAim(t, targetId, color);
    VS.layers.ping.batchDraw();
    return;
  }

  // ── Émote différente (ou amplifiée) → remplace la précédente ──
  if (cur) _emoteRetire(cur);

  const baseScale = 1;
  const group = new K.Group({ x: cx, y: cy, opacity: 0, scaleX: 0.2, scaleY: 0.2, listening: false });
  // Pointe vers le token
  group.add(new K.Line({ points: [-R * 0.26, R * 0.82, R * 0.26, R * 0.82, 0, R * 1.3], closed: true, fill: color,
    shadowColor: '#000', shadowBlur: R * 0.2, shadowOpacity: 0.35, shadowOffsetY: 2 }));
  // Cercle blanc, anneau couleur émetteur
  group.add(new K.Circle({ radius: R, fill: '#fff', stroke: color, strokeWidth: Math.max(2, R * 0.09),
    shadowColor: '#000', shadowBlur: R * 0.35, shadowOpacity: 0.45, shadowOffsetY: 3 }));
  if (big) group.add(new K.Circle({ radius: R, fill: '#fff', stroke: color, strokeWidth: Math.max(1.5, R * 0.05), opacity: 0.5 }));
  const clip = new K.Group({ clipFunc: ctx => { ctx.arc(0, 0, R * 0.86, 0, Math.PI * 2, false); } });
  group.add(clip);
  VS.layers.ping.add(group);

  const rec = { tokenId, group, name: emoteName, target: targetId, big, R, count: Math.max(1, opts.count || 1),
    ts: Date.now(), baseScale, timer: null, _out: false };
  _emoteStacks[tokenId] = rec;

  const imgEl = new Image();
  imgEl.onload = () => { if (group.getStage() === null) return; const side = R * 1.78;
    clip.add(new K.Image({ image: imgEl, width: side, height: side, x: -side / 2, y: -side / 2 })); VS.layers.ping.batchDraw(); };
  imgEl.onerror = () => {};
  imgEl.src = emoteUrl;

  // Étiquettes : envoyeur (remote) + cible (« → Nom »).
  const labels = [];
  if (opts.remote && opts.authorName) labels.push(opts.authorName);
  if (targetId) { const tt = VS.tokens[targetId]?.data; if (tt) labels.push(`→ ${tt.name || '?'}`); }
  if (labels.length) {
    const txt = new K.Text({ text: labels.join('   '), fontSize: Math.max(10, R * 0.34), fontStyle: '600',
      fill: '#fff', align: 'center' });
    txt.offsetX(txt.width() / 2); txt.y(-R - txt.height() - 4); txt.offsetY(0);
    const bg = new K.Rect({ x: -txt.width() / 2 - 5, y: -R - txt.height() - 7, width: txt.width() + 10, height: txt.height() + 6,
      cornerRadius: 8, fill: 'rgba(8,12,20,.82)', stroke: targetId ? 'rgba(255,90,126,.5)' : color, strokeWidth: 1 });
    group.add(bg); group.add(txt);
  }

  // Badge combo si count > 1 dès l'arrivée (rattrapage après fusion d'écritures).
  if (rec.count > 1) _emoteBadge(rec, rec.count, color);

  // Pop élastique → maintien → (retire via timer).
  group.to({ scaleX: 1.12 * baseScale, scaleY: 1.12 * baseScale, opacity: 1, duration: 0.28, easing: K.Easings.BackEaseOut,
    onFinish: () => group.to({ scaleX: baseScale, scaleY: baseScale, duration: 0.12 }) });

  if (big) {
    // Onde de choc + deux secousses.
    const wave = new K.Circle({ x: cx, y: cy, radius: R, stroke: color, strokeWidth: 3, opacity: 0.8, listening: false });
    VS.layers.ping.add(wave);
    wave.to({ radius: R * 2.1, opacity: 0, duration: 0.9, easing: K.Easings.EaseOut, onFinish: () => wave.destroy() });
    setTimeout(() => { if (group.getStage()) group.to({ rotation: -9, duration: 0.12, onFinish: () => group.to({ rotation: 9, duration: 0.16, onFinish: () => group.to({ rotation: 0, duration: 0.12 }) }) }); }, 420);
  }

  rec.timer = setTimeout(() => _emoteRetire(rec), big ? 4200 : 2800);
  if (targetId) _emoteAim(t, targetId, color);
  VS.layers.ping.batchDraw();
}

// Badge « ×N » en haut-droite d'une bulle (créé/màj avec un petit rebond).
function _emoteBadge(rec, n, color) {
  const K = window.Konva, g = rec.group;
  if (!g || g.getStage() === null) return;
  const R = rec.R || (CELL * 1.65) / 2;
  if (!rec.badge) {
    const bg = new K.Group({ x: R * 0.72, y: -R * 0.72 });
    bg.add(new K.Circle({ radius: Math.max(9, R * 0.34), fill: color, stroke: '#fff', strokeWidth: 2 }));
    const t = new K.Text({ text: `×${n}`, fontSize: Math.max(9, R * 0.3), fontStyle: '700', fill: '#fff' });
    t.offsetX(t.width() / 2); t.offsetY(t.height() / 2);
    bg.add(t); bg._txt = t; g.add(bg); rec.badge = bg;
  } else {
    rec.badge._txt.text(`×${n}`); rec.badge._txt.offsetX(rec.badge._txt.width() / 2);
  }
  rec.badge.to({ scaleX: 1.3, scaleY: 1.3, duration: 0.12, onFinish: () => rec.badge.to({ scaleX: 1, scaleY: 1, duration: 0.14 }) });
}

// Courbe de ciblage émetteur → cible + impulsion d'anneau sur la cible.
function _emoteAim(fromT, targetId, color) {
  const K = window.Konva;
  const to = VS.tokens[targetId]?.data;
  if (!to || !VS.layers.ping) return;
  const df = _tokenDims(fromT), dt = _tokenDims(to);
  const x1 = fromT.col * CELL + df.w * CELL / 2, y1 = fromT.row * CELL + df.h * CELL / 2;
  const x2 = to.col * CELL + dt.w * CELL / 2, y2 = to.row * CELL + dt.h * CELL / 2;
  const mx = (x1 + x2) / 2, my = Math.min(y1, y2) - Math.abs(x2 - x1) * 0.25 - CELL * 0.8;
  const curve = new K.Shape({ stroke: color, strokeWidth: 2.5, dash: [6, 7], lineCap: 'round', listening: false,
    sceneFunc: (ctx, shape) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.fillStrokeShape(shape); } });
  VS.layers.ping.add(curve);
  let off = 0; const anim = new K.Animation(() => { off -= 1.6; curve.dashOffset(off); }, VS.layers.ping);
  anim.start();
  curve.to({ opacity: 0, duration: 1.8, easing: K.Easings.EaseIn, onFinish: () => { anim.stop(); curve.destroy(); VS.layers.ping?.batchDraw(); } });
  // Impulsion d'anneau sur la cible
  const ring = new K.Circle({ x: x2, y: y2, radius: Math.max(dt.w, dt.h) * CELL * 0.45, stroke: color, strokeWidth: 3, opacity: 0.85, listening: false });
  VS.layers.ping.add(ring);
  ring.to({ radius: ring.radius() * 1.7, opacity: 0, duration: 0.9, easing: K.Easings.EaseOut, onFinish: () => ring.destroy() });
}

// Halo de cible pendant le glisser d'une émote (Konva, coords monde).
let _emoteDropHalo = null;
export function _vttEmoteDropHalo(tokenId) {
  const K = window.Konva;
  if (_emoteDropHalo) { _emoteDropHalo.destroy(); _emoteDropHalo = null; }
  const t = tokenId ? VS.tokens[tokenId]?.data : null;
  if (!t || !K || !VS.layers.ping || t.pageId !== VS.activePage?.id) { VS.layers.ping?.batchDraw(); return; }
  const dim = _tokenDims(t);
  const cx = t.col * CELL + dim.w * CELL / 2, cy = t.row * CELL + dim.h * CELL / 2;
  _emoteDropHalo = new K.Circle({ x: cx, y: cy, radius: Math.max(dim.w, dim.h) * CELL * 0.62, stroke: '#ff5a7e', strokeWidth: 3, dash: [7, 6], opacity: 0.9, listening: false });
  VS.layers.ping.add(_emoteDropHalo);
  VS.layers.ping.batchDraw();
}

// Hit-test « écran → token » (glisser d'émote). Position en grille (robuste au
// pan/zoom) plutôt que le DOM : le panneau ne masque pas les tokens.
export function _vttTokenIdAtClient(clientX, clientY) {
  if (!VS.stage) return null;
  const rect = VS.stage.container().getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
  const wp = _stageToWorld({ x: clientX - rect.left, y: clientY - rect.top });
  const col = Math.floor(wp.x / CELL), row = Math.floor(wp.y / CELL);
  const pid = VS.activePage?.id || null;
  for (const [id, e] of Object.entries(VS.tokens || {})) {
    const t = e?.data; if (!t || t.pageId !== pid) continue;
    const dim = _tokenDims(t);
    if (col >= t.col && col < t.col + dim.w && row >= t.row && row < t.row + dim.h) return id;
  }
  return null;
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
    if (id!==VS.selected) _setSelectionRing(id, false);
  }
  VS.selectedMulti.clear();
  VS.layers.token?.batchDraw();
}

function _toggleMultiSelect(id) {
  const target = VS.tokens[id]?.data;
  if (!_canControlToken(target)) return;
  // Inclure le token principal courant dans la multi-sélection
  if (VS.selected && _canControlToken(VS.tokens[VS.selected]?.data)
      && !VS.selectedMulti.has(VS.selected)) {
    VS.selectedMulti.add(VS.selected);
    _setSelectionRing(VS.selected, true);
  }
  if (VS.selectedMulti.has(id)) {
    VS.selectedMulti.delete(id);
    _setSelectionRing(id, false);
  } else {
    VS.selectedMulti.add(id);
    _setSelectionRing(id, true);
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
      ? new K.Rect({ x:c*CELL+1.5, y:r*CELL+1.5, width:CELL-3, height:CELL-3, cornerRadius:5,
          fill:'rgba(239,68,68,0.18)', stroke:'rgba(239,68,68,0.58)',
          strokeWidth:1.4, listening:false })
      // Portée étendue (sorts / actions longue distance uniquement) — violet pointillé
      : new K.Rect({ x:c*CELL+1.5, y:r*CELL+1.5, width:CELL-3, height:CELL-3, cornerRadius:5,
          fill:'rgba(167,139,250,0.10)', stroke:'rgba(167,139,250,0.5)',
          strokeWidth:1.1, dash:[6,4], listening:false });
    VS.layers.grid.add(rect); _moveHL.push(rect);
  }
  // La cible atteignable est encadrée sur toute son empreinte. Le calcul reste
  // bord à bord entre rectangles, donc les angles d'un 3×3 comptent réellement.
  Object.values(VS.tokens || {}).forEach(entry => {
    const target=entry?.data;
    if (!target || target.id===t.id || target.pageId!==VS.activePage?.id) return;
    const weaponReach = !!weaponOpt && _tokenAttackDistance(t, target, weaponPortee) <= weaponPortee;
    const extendedReach = !weaponReach && options.some(o => _tokenAttackDistance(t, target, o.portee) <= o.portee);
    if (weaponReach) _setReachableFootprint(target.id, 'weapon', true);
    else if (extendedReach) _setReachableFootprint(target.id, 'extended', true);
  });
  VS.layers.grid.batchDraw();
  VS.layers.token?.batchDraw();
}
async function _moveTo(id, col, row) {
  const cur = VS.tokens[id]?.data;
  if (!cur || !_canControlToken(cur)) {
    showNotif('Tu ne peux pas déplacer ce token.', 'info');
    return false;
  }
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
  const moved = !!cur && (col !== cur.col || row !== cur.row);
  if (moved && VS.session?.combat?.active) {
    patch.moveOrigin = _combatMoveOrigin(cur);
  }
  if (!STATE.isAdmin && VS.session?.combat?.active && moved) {
    const d = Math.abs(col - cur.col) + Math.abs(row - cur.row);
    patch.movedCells = (cur.movedCells || 0) + d;
    patch.movedThisTurn = true;
  }
  const previous = Object.fromEntries(Object.keys(patch).map(key => [key, cur[key]]));
  Object.assign(cur, patch);
  const dims = _tokenDims(cur);
  VS.tokens[id]?.shape?.position({
    x: col * CELL + dims.w * CELL / 2,
    y: row * CELL + dims.h * CELL / 2,
  });
  VS.layers.token?.batchDraw();
  _refreshRanges(id, cur);
  fogUpdateSoon(VS.activePage, VS.tokens, STATE.isAdmin);
  try {
    await updateDoc(_tokRef(id), patch);
  } catch (e) {
    Object.assign(cur, previous);
    VS.tokens[id]?.shape?.position({
      x: cur.col * CELL + dims.w * CELL / 2,
      y: cur.row * CELL + dims.h * CELL / 2,
    });
    VS.layers.token?.batchDraw();
    _refreshRanges(id, cur);
    showNotif('Déplacement refusé', 'error');
    return false;
  }
  return true;
}

export function _getCombatMoveOrigin(token = {}) {
  return token.moveOrigin || null;
}

function _combatMoveOrigin(token = {}) {
  const round = VS.session?.combat?.round ?? 0;
  const pageId = token.pageId || VS.activePage?.id || null;
  const existing = _getCombatMoveOrigin(token);
  if (existing && existing.round === round && existing.pageId === pageId) return existing;
  const origin = {
    col: Number(token.col) || 0,
    row: Number(token.row) || 0,
    movedCells: Number(token.movedCells) || 0,
    movedThisTurn: !!token.movedThisTurn,
    round,
    pageId,
  };
  return origin;
}

async function _vttUndoMove(id) {
  const entry = VS.tokens[id];
  const token = entry?.data;
  const origin = _getCombatMoveOrigin(token);
  const round = VS.session?.combat?.round ?? 0;
  const pageId = token?.pageId || VS.activePage?.id || null;
  if (!token || !_canControlToken(token) || !VS.session?.combat?.active) return;
  if (!origin || origin.round !== round || origin.pageId !== pageId) {
    showNotif('Aucun déplacement à annuler pour ce tour.', 'info');
    return;
  }
  const patch = {
    col: Number(origin.col) || 0,
    row: Number(origin.row) || 0,
    movedCells: Number(origin.movedCells) || 0,
    movedThisTurn: !!origin.movedThisTurn,
  };
  patch.moveOrigin = deleteField();
  const previous = {
    col: token.col,
    row: token.row,
    movedCells: token.movedCells,
    movedThisTurn: token.movedThisTurn,
    moveOrigin: token.moveOrigin,
  };
  token.col = patch.col;
  token.row = patch.row;
  token.movedCells = patch.movedCells;
  token.movedThisTurn = patch.movedThisTurn;
  delete token.moveOrigin;
  const dims = _tokenDims(token);
  entry.shape?.to({
    x: patch.col * CELL + dims.w * CELL / 2,
    y: patch.row * CELL + dims.h * CELL / 2,
    duration: .08,
  });
  VS.layers.token?.batchDraw();
  _refreshRanges(id, token);
  fogUpdateSoon(VS.activePage, VS.tokens, STATE.isAdmin);
  try {
    await updateDoc(_tokRef(id), patch);
    showNotif('Déplacement annulé : position et mouvement restaurés.', 'success');
  } catch (error) {
    Object.assign(token, previous);
    entry.shape?.to({
      x: previous.col * CELL + dims.w * CELL / 2,
      y: previous.row * CELL + dims.h * CELL / 2,
      duration: .08,
    });
    VS.layers.token?.batchDraw();
    console.error('[vtt] undo move', error);
    showNotif('Impossible d’annuler le déplacement.', 'error');
  }
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

// Ne jamais recopier une image encodée (data:/blob:) dans un journal de combat.
// En AoE, elle serait dupliquée une fois par cible et peut faire dépasser la
// limite Firestore de 1 Mio, ce qui annule entièrement le message du chat.
function _combatLogImage(value) {
  const src = String(value || '').trim();
  if (!src || src.startsWith('data:') || src.startsWith('blob:')) return null;
  return src.length <= 8192 ? src : null;
}

async function _publishCombatLog(payload) {
  return _vttPublishOptimisticLog(payload);
}

// [_maxDice / _maxEffectDisplay / _effectDisplay → vtt-spell-display.js (importés en haut)]

function _optionFixedBonus(opt) {
  return (opt?.rawDice !== undefined)
    ? ((opt.formulaFixedBonus || 0) + (opt.dmgStatMod || 0) + (opt.maitriseBonus || 0))
    : 0;
}

function _effectFormulaWithFixedBonus(opt, formula, fixed = 0) {
  const displayed = _effectDisplay(opt, formula, fixed);
  if (opt?.mjAlwaysMax || !fixed) return displayed;
  const text = String(displayed || '').trim();
  if (!text || !/\d+\s*d\s*\d+/i.test(text)) return text;
  const suffixMatch = text.match(/(\s*\/\s*(?:tour|t)\b.*)$/i);
  const suffix = suffixMatch ? suffixMatch[1] : '';
  const core = suffix ? text.slice(0, -suffix.length).trim() : text;
  return `${core}${fixed > 0 ? `+${fixed}` : fixed}${suffix}`;
}

// [_vttSortDmgFormula / _vttSortSoinFormula → vtt-spell-display.js (importés en haut)]

/** Parse le bonus CA numérique depuis la chaîne libre (ex: "CA +2 (2 tours)" → 2). */
function _parseCaBonus(caStr) {
  const m = (caStr || '+2').match(/([+-]?\d+)/);
  return m ? (parseInt(m[1]) || 2) : 2;
}

const _sortDureeVtt = calcSpellDuration;
const _vttSortCibles = calcSpellTargets;

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
    const d = entry?.data; if (!d || !_canControlToken(d, uid)) continue;
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
      return _canControlToken(t, uid)
        && t.pageId === VS.activePage.id
        && t.visible !== false;
    });

  const selectedEntry = VS.tokens[VS.selected];
  const selectedData = selectedEntry?.data;
  const selected = selectedData
    && selectedData.pageId === VS.activePage.id
    && selectedData.visible !== false
    && _canControlToken(selectedData, uid)
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
    duration: 0.55,
    easing: window.Konva?.Easings?.EaseOut,
    onFinish: () => { void _emitPing(worldX, worldY); },
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
      const selection = normalizeInvocationSelection(inv);
      const hasInlineLegacy = !!(inv.stats || inv.image || (Array.isArray(inv.actions) && inv.actions.length));
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
          selection,
          allowLegacy: !Object.hasOwn(inv, 'mode') || hasInlineLegacy,
          elementId: s.noyauTypeId || null,
          legacy,
          bonuses: { nbP: 0, nbCh: 0, nbProt: 0, nbAmp: 0 },
          concentration: false,
          duree: Math.max(1, parseInt(s.classicDuration ?? s.dureeBase) || 2),
          nbInvocations: maxInvocations,
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
  // Enchantement mode État sur un allié : une Lacération éventuelle n'est PAS une
  // frappe directe (qui baisserait la CA de l'allié) — elle est PORTÉE par l'allié
  // et s'applique aux ennemis qu'il touche (cf. mods.enchantLaceration).
  const isEnchantEtat = nbEnch > 0 && nbInv === 0 && s.enchantMode === 'etat';
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
    laceration: (lacCount > 0 && !isSentinelle && !isEnchantEtat)
      ? { runes: lacCount, reduction: lacCount, max: 2, maxElite: 4 } : null,
    // Lacération PORTÉE par un Enchantement d'État : conférée à l'allié enchanté,
    // appliquée à la CA des ennemis qu'il touche — jamais à l'allié lui-même.
    enchantLaceration: (lacCount > 0 && isEnchantEtat)
      ? { reduction: lacCount, max: 2, maxElite: 4 } : null,
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
          // Le DD appartient à la composition du sort, pas à l'état choisi.
          // Les modes DoT et État progressent donc pareil avec les runes.
          const dd = _calcAfflictionDD(s) ?? 11;
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
    // Invocation (hors combos Sentinelle/Arme invoquée). La portée enregistrée sur
    // le sort autorise toute la bibliothèque ou une sélection. Une rune permet
    // toujours d'en placer une. Stats finales = base (lib) + bonus de runes,
    // résolues au SPAWN (_vttSpawnSummon, qui a le perso lanceur). Le nombre n'est
    // plus piloté par Dispersion. Rétro-compat : s.invocation.stats sans ids =
    // ancienne invocation "inline" (ou défaut dérivé si rien).
    invocation: (nbInv > 0 && nbAff === 0 && nbEnch === 0)
      ? (() => {
          // Les créatures autorisées sont choisies au lancement dans le VTT.
          const selection = normalizeInvocationSelection(s.invocation);
          const ov  = s.invocation?.stats || {};
          const hasInlineLegacy = !!(s.invocation?.stats || s.invocation?.image
            || (Array.isArray(s.invocation?.actions) && s.invocation.actions.length));
          const normalizedOv = normalizeInvocationStats(ov);
          const has = v => v !== undefined && v !== null && v !== '';
          // Legacy : ancien sort sans bibliothèque (stats inline ou défaut dérivé).
          const legacy = {
            niveau:      normalizedOv.niveau,
            attaque:     has(ov.attaque)     ? String(ov.attaque)     : `${1 + nbP}d4 +2`,
            toucher:     has(ov.toucher)     ? parseInt(ov.toucher)     : (2 + 2 * nbCh),
            pv:          has(ov.pv)          ? parseInt(ov.pv)          : (10 + 5 * nbProt),
            ca:          has(ov.ca)          ? parseInt(ov.ca)          : (10 + 2 * nbProt),
            deplacement: has(ov.deplacement) ? parseInt(ov.deplacement) : (3 + 3 * nbAmp),
            pmMax:       normalizedOv.pmMax,
            usesOwnMana: normalizedOv.usesOwnMana,
            portee:      normalizedOv.portee,
            toucherStat: normalizedOv.toucherStat,
            degatsStat:  normalizedOv.degatsStat,
            ...Object.fromEntries(INVOCATION_ABILITIES.map(({ key }) => [key, normalizedOv[key]])),
            image:       s.invocation?.image || null,
            actions:     Array.isArray(s.invocation?.actions) ? s.invocation.actions : [],
            name:        s.nom || 'Invocation',
          };
          return {
            maxInvocations: nbInv,                          // 1 par rune Invocation
            selection,
            allowLegacy: !Object.hasOwn(s.invocation || {}, 'mode') || hasInlineLegacy,
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
    const previous = { col: tgtData.col, row: tgtData.row };
    Object.assign(tgtData, { col: nc, row: nr });
    const dims = _tokenDims(tgtData);
    VS.tokens[tgtData.id]?.shape?.to({
      x: nc * CELL + dims.w * CELL / 2,
      y: nr * CELL + dims.h * CELL / 2,
      duration: .08,
    });
    VS.layers.token?.batchDraw();
    fogUpdateSoon(VS.activePage, VS.tokens, STATE.isAdmin);
    try {
      await updateDoc(_tokRef(tgtData.id), { col: nc, row: nr });
    } catch (err) {
      Object.assign(tgtData, previous);
      VS.tokens[tgtData.id]?.shape?.to({
        x: previous.col * CELL + dims.w * CELL / 2,
        y: previous.row * CELL + dims.h * CELL / 2,
        duration: .08,
      });
      console.error('[VTT] Déplacement de sort refusé', err);
      showNotif('Déplacement refusé par Firestore', 'error');
      return 0;
    }
  }
  return moved;
}

// ══ Sorts de déplacement (rune Amplification mode Déplacement) ════════════════

// Déduit le coût PM des actions utilitaires. Une invocation peut utiliser sa
// propre réserve ; sinon elle conserve le comportement historique (invocateur).
async function _vttSpendSpellPm(src, opt) {
  const cost = Math.max(0, parseInt(opt?.pmCost) || 0);
  if (cost <= 0) return true;
  if (src.summonKind === 'invocation' && src.summonUsesOwnMana) {
    const current = Math.max(0, _numOr(src.pm, _numOr(src.pmMax, 0)));
    if (current < cost) {
      showNotif(`⚠ PM insuffisants de l’invocation (${current}/${cost} requis)`, 'error');
      return false;
    }
    const patch = {
      pm: current - cost,
      pmCombat: Math.max(0, _numOr(src.pmCombat, current) - cost),
    };
    const previousCombat = src.pmCombat;
    Object.assign(src, patch);
    _patchShape(src.id);
    try {
      await updateDoc(_tokRef(src.id), patch);
    } catch (error) {
      Object.assign(src, { pm: current, pmCombat: previousCombat });
      _patchShape(src.id);
      throw error;
    }
    return true;
  }
  const c = src.summonOwnerCharId ? VS.characters[src.summonOwnerCharId] : _characterForToken(src);
  if (c?.id) {
    // Route vers la ressource choisie (PM/PV/Or) du lanceur.
    const res = _optCostRes(opt);
    const current = _charResCur(c, res);
    if (current < cost) {
      const who = src.summonKind === 'invocation' ? ' de l’invocateur' : '';
      const lbl = _RES_LABEL[res] || 'PM';
      showNotif(`⚠ ${lbl} insuffisant${lbl === 'PM' || lbl === 'PV' ? 's' : ''}${who} (${current}/${cost} requis)`, 'error');
      return false;
    }
    await _spendCharSpellCost(c.id, res, cost, src.id, opt.label);
  }
  return true;
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
  if (!(await _vttSpendSpellPm(src, opt))) return;
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
  if (!(await _vttSpendSpellPm(src, opt))) return;
  try {
    await updateDoc(_tokRef(srcId), { col, row });
  } catch (err) {
    console.error('[VTT] Déplacement personnel refusé', err);
    showNotif('Déplacement refusé par Firestore', 'error');
    return;
  }
  showNotif(`🏃 ${name} se déplace de ${dist} case${dist > 1 ? 's' : ''} (${opt.label})`, 'success');
}

function _selfMoveCancel() { _selfClear(); showNotif('Déplacement annulé', 'info'); _vttReturnToActions(); }

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
  const fullLibrary = Array.isArray(c?.invocations) ? c.invocations : [];
  const max = opt?.mods?.invocation?.maxInvocations || 1;
  const selection = normalizeInvocationSelection(opt?.mods?.invocation?.selection);
  if (!fullLibrary.length) {
    if (selection.mode === 'selected' || opt?.mods?.invocation?.allowLegacy === false) {
      showNotif('Aucune invocation n’est disponible dans la bibliothèque de ce personnage.', 'warning');
      return;
    }
    // Ancien sort sans bibliothèque → invocation générique, sans sélecteur.
    opt._invSelIds = null; opt._invSelDone = true;
    _startZonePlacement(srcId, tgtId, opt, optIdx);
    return;
  }
  const lib = invocationsAllowedForSpell(fullLibrary, selection);
  if (!lib.length) {
    showNotif('Ce sort ne possède aucune invocation autorisée disponible.', 'warning');
    return;
  }
  // Les ids du sort définissent la liste AUTORISÉE, pas une pré-sélection.
  // Le joueur choisit donc explicitement à chaque lancement.
  _invPickState = { srcId, tgtId, opt, optIdx, lib, max, ids: new Set() };
  openModal('🐾 Invoquer', _renderInvPickBody());
}
function _renderInvPickBody() {
  const st = _invPickState; if (!st) return '';
  const sel = st.ids;
  const cards = st.lib.map(iv => {
    const id = String(iv.id);
    const on = sel.has(id);
    const full = st.max > 1 && !on && sel.size >= st.max;
    const hp = (iv.currentHp != null && iv.stats?.pv != null && parseInt(iv.currentHp) < parseInt(iv.stats.pv)) ? `${iv.currentHp}/${iv.stats.pv}` : (iv.stats?.pv ?? '?');
    return `<button class="cs-invsel-card${on?' is-on':''}" data-vtt-fn="_invPickToggle" data-vtt-args="${_esc(id)}" aria-pressed="${on}" ${full?'disabled':''}>
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
  st.ids = new Set(toggleInvocationChoice([...st.ids], id, st.max));
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

// Sauvegarde les PV/PM courants d'un token d'invocation sur l'entrée de
// bibliothèque du lanceur (pendant une restauration ou avant la désinvocation).
// L'instance unique réapparaît ainsi avec son dernier état connu.
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

function _ensureStatsActionId(opt = {}) {
  if (!opt._statsActionId) {
    opt._statsActionId = globalThis.crypto?.randomUUID?.()
      || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return opt._statsActionId;
}

function _statsLogMeta(opt = {}) {
  const item = opt?._itemAction;
  return {
    statsActionId: _ensureStatsActionId(opt),
    statsExcluded: opt?.countInStats === false,
    statsSource: item ? 'item' : (opt?.sortIdx !== undefined ? 'spell' : 'weapon'),
    ...(item ? {
      statsItemId: item.itemId || null,
      statsItemName: item.itemNom || null,
      statsItemActionId: item.actionId || null,
    } : {}),
  };
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
  // Contrôle réel : déplacement imposé, invocation/sentinelle ou zone purement
  // utilitaire. Une simple AoE offensive ne rapporte pas de soutien au MVP.
  const control = affliction || !!(
    opt.isInvocation
    || mods.invocation
    || mods.sentinelle
    || mods.move
    || mods.push
    || mods.pull
    || opt.isDeplacement
    || (opt.isUtil && (mods.zone || opt.zoneW > 0 || opt.zoneH > 0))
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
  return { tactical, support, affliction, control };
}

function _buildCastStatsDelta(src, opt, roll = {}) {
  const actor = _statsActor(src);
  const delta = { chars: {} };
  if (opt?.countInStats === false) return delta;
  const isSpellLike = opt?.sortIdx !== undefined || !!opt?.spellId || !!opt?.isUtil || !!opt?.isCaSort || !!opt?.isHeal || !!opt?.isInvocation;
  if (!actor.id || (!isSpellLike && !(opt?.pmCost > 0))) return delta;
  const kinds = _castStatKinds(opt);
  accCastDelta(delta, {
    casterId: actor.id,
    casterName: actor.name,
    spellName: isSpellLike ? (opt.label || 'Sort') : null,
    pm: ((opt.costRes||'pm')==='pm' ? (opt.pmCost||0) : 0),
    tactical: kinds.tactical ? 1 : 0,
    support: kinds.support ? 1 : 0,
    affliction: kinds.affliction ? 1 : 0,
    control: kinds.control ? 1 : 0,
    natural: roll.natural ?? null,
    result: roll.result ?? null,
    crit: roll.crit === true,
    fumble: roll.fumble === true,
  });
  return delta;
}

function _applyCastStatsDelta(src, opt, roll = {}) {
  const delta = _buildCastStatsDelta(src, opt, roll);
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
    let attaque = '1d4', toucher = 0, toucherFlat = 0, pvMax = 10, ca = 10, deplacement = 0, portee = 1, pmMax = 0;
    let toucherStat = 'force', degatsStat = 'force', usesOwnMana = false, summonLevel = 1, summonDeckMax = 0;
    let summonAbilities = Object.fromEntries(INVOCATION_ABILITIES.map(({ key }) => [key, 10]));
    let baseAttackUnscaled = '1d4';   // attaque de base NON scalée → sert aux ACTIONS (runes du sort n'y touchent pas)
    let restoreHp = null, restorePm = null;

    if (selIds && selIds.length) {
      const c = ownerCharId ? VS.characters[ownerCharId] : null;
      const invDef = (c?.invocations || []).find(iv => iv.id === selIds[idx])
                  || (c?.invocations || []).find(iv => selIds.includes(iv.id));
      if (!invDef) return null;   // invocation supprimée de la bibliothèque
      const base = normalizeInvocationStats(invDef.stats);
      const b = mod.bonuses || {};
      const bonusRunes = [
        ...Array(Math.max(0, b.nbP || 0)).fill('Puissance'),
        ...Array(Math.max(0, b.nbCh || 0)).fill('Chance'),
        ...Array(Math.max(0, b.nbProt || 0)).fill('Protection'),
        ...Array(Math.max(0, b.nbAmp || 0)).fill('Amplification'),
      ];
      const finalStats = calculateSummonStats(invDef, bonusRunes);
      // Base + bonus de runes — uniquement sur les valeurs de base, jamais sur
      // les caractéristiques ou la portée définies dans la fiche.
      baseAttackUnscaled = String(base.attaque || '1d4 +2');   // les ACTIONS calculent à partir de ÇA (non scalé)
      attaque = finalStats.attaque;
      toucherFlat = finalStats.toucher;
      toucherStat = base.toucherStat;
      degatsStat  = base.degatsStat;
      summonAbilities = Object.fromEntries(INVOCATION_ABILITIES.map(({ key }) => [key, base[key]]));
      toucher     = toucherFlat + invocationStatModifier(base, toucherStat);
      pvMax       = finalStats.pv;
      ca          = finalStats.ca + 2 * (b.nbProt || 0);   // Protection → +2 CA / rune
      deplacement = finalStats.deplacement;
      portee      = finalStats.portee;
      pmMax       = finalStats.pmMax;
      usesOwnMana = finalStats.usesOwnMana;
      summonLevel = finalStats.niveau;
      summonDeckMax = finalStats.deckMax;
      name        = invDef.nom || 'Invocation';
      image       = invDef.image || null;
      actions     = getPreparedInvocationActions(invDef);
      summonInvId = invDef.id;
      restoreHp   = (invDef.currentHp != null) ? parseInt(invDef.currentHp) : null;
      restorePm   = (invDef.currentPm != null) ? parseInt(invDef.currentPm) : null;
    } else {
      const legacy = mod.legacy || {};
      const iv = normalizeInvocationStats(legacy);
      attaque = iv.attaque; baseAttackUnscaled = attaque;
      toucherFlat = iv.toucher; toucherStat = iv.toucherStat; degatsStat = iv.degatsStat;
      summonAbilities = Object.fromEntries(INVOCATION_ABILITIES.map(({ key }) => [key, iv[key]]));
      toucher = toucherFlat + invocationStatModifier(iv, toucherStat);
      const legacyFinal = calculateSummonStats({ stats: iv, actions: legacy.actions }, []);
      pvMax = legacyFinal.pv; ca = legacyFinal.ca;
      deplacement = legacyFinal.deplacement; portee = legacyFinal.portee; pmMax = legacyFinal.pmMax;
      usesOwnMana = legacyFinal.usesOwnMana;
      summonLevel = legacyFinal.niveau;
      summonDeckMax = legacyFinal.deckMax;
      name = legacy.name || 'Invocation'; image = legacy.image || null;
      actions = getPreparedInvocationActions({ stats: iv, actions: legacy.actions });
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
      summonLevel,
      summonDeckMax,
      summonAbilities,
      summonToucherStat: toucherStat,
      summonDegatsStat: degatsStat,
      summonToucherFlat: toucherFlat,
      summonUsesOwnMana: usesOwnMana,
      summonElementId: mod.elementId || null,   // attaque de base = élément du sort d'invocation
      pageId: VS.activePage.id,
      col: targetCol, row: targetRow,
      visible: true,
      hp, hpMax: pvMax, pm, pmMax,
      defense: ca,
      movement: deplacement,
      range: portee,
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
    countInStats: opt?.countInStats !== false,
    statsSource: opt?._itemAction ? 'item' : 'spell',
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
  // Rage et états équivalents interdisent de démarrer ou maintenir une
  // concentration, y compris si l'état vient d'être appliqué par ce sort.
  if (_hasConditionEffect(src, 'cantCastSpells')) return;
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
  const previous = src.conditions || [];
  const conditions = [...existing, cond];
  _vttPatchTokenOptimistically(srcId, { conditions });
  // L'effet est déjà visible localement ; la confirmation Firestore ne doit pas
  // retarder le résultat principal du sort ni son message dans le journal.
  void updateDoc(_tokRef(srcId), { conditions }).catch(error => {
    _vttPatchTokenOptimistically(srcId, { conditions: previous });
    console.error('[vtt] concentration non appliquée', error);
  });
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
  const previous = tokenData.buffs || [];
  _vttPatchTokenOptimistically(tokenId, { buffs: newBuffs });
  void updateDoc(_tokRef(tokenId), { buffs: newBuffs }).catch(error => {
    _vttPatchTokenOptimistically(tokenId, { buffs: previous });
    console.error('[vtt] relance chanceuse non consommée', error);
  });
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
    fallbackTouchMod = null,        // mod toucher pré-calculé si fourni
    fallbackDmgMod   = null,        // mod dégâts pré-calculé si fourni
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
  let zoneShape = [...ZONE_SHAPES, 'diamond'].includes(s.zoneShape) ? s.zoneShape : 'rect';
  // Modèle « zones » v2 (source unique : shared/spell-zones.js) — Amplification pilote
  // la TAILLE d'UNE zone (forme au choix), Dispersion la RÉPÈTE (cf. nbCibles ci-dessous).
  if (!_isDepl && !_enchActive && zoneW <= 0 && zoneH <= 0) {
    const _nbAmp = (s.runes || []).filter(r => r === 'Amplification').length;
    if (_nbAmp >= 1) {
      const _shape = ZONE_SHAPES.includes(s.zoneShape) ? s.zoneShape : 'rect';
      const _d = _zoneDims(_shape, _nbAmp);
      zoneW = _d.w; zoneH = _d.h; zoneShape = _d.shape;   // à 1 Amp → ligne 3×1 (forme forcée rect)
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
  // Les capacités peuvent autoriser les techniques du format de l'arme tenue.
  // La technique elle-même garde le dernier mot via `allowWithAbilities`.
  const abilityWeapon = c ? getMainWeapon(c) : null;
  const abilityWeaponContext = abilityWeapon && !abilityWeapon.isDefault
    ? resolveWeaponDamageContext(VS.weaponFormats, VS.damageTypes, abilityWeapon, c?.elements || [])
    : null;
  const abilityWeaponTechniques = Array.isArray(abilityWeaponContext?.format?.techniques)
    ? abilityWeaponContext.format.techniques : [];

  // Bloc de champs communs réutilisé dans chaque variante d'option
  const common = {
    id, sortIdx, spellId, portee,
    pmCost, basePm, pmRaw, pmSetDelta,
    costRes: s.costResource || 'pm',   // ressource dépensée : 'pm' | 'pv' | 'or' | 'none'
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
    weaponTechniques: abilityWeaponTechniques,
    ...extras,
    // Les actions d'objet legacy sont hors statistiques par défaut. Le choix
    // explicite du MJ sur l'action reste prioritaire.
    countInStats: shouldTrackSpellStats(s, { source: extras?._itemAction ? 'item' : 'spell' }),
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
    const { rawDice: sRawDice, fixed: sFixed } = splitSpellDiceFormula(fullFormula);
    const spellTypeId    = s.noyauTypeId || null;
    const spellTypeRules = spellTypeId
      ? getDamageTypeRules(VS.damageTypes, spellTypeId)
      : { missEffect: 'half', armorPen: 0, dmgBonus: 0 };
    const spellTypeObj   = spellTypeId ? getDamageTypeById(VS.damageTypes, spellTypeId) : null;
    const ovrTouchStat   = resolveSpellModifierStat(s, 'toucherStat', fallbackTouchStat);
    const ovrDmgStat     = resolveSpellModifierStat(s, 'degatsStat', fallbackDmgStat);
    const ovrTouchNoMod  = !ovrTouchStat;
    const ovrDmgNoMod    = !ovrDmgStat;
    const touchAutoMod   = !s.toucherStat && Number.isFinite(fallbackTouchMod) ? fallbackTouchMod : null;
    const dmgAutoMod     = !s.degatsStat && Number.isFinite(fallbackDmgMod) ? fallbackDmgMod : null;
    const ovrTouchMod    = ovrTouchNoMod ? 0 : (touchAutoMod ?? (c ? getMod(c, ovrTouchStat) : 0));
    const ovrDmgMod      = ovrDmgNoMod   ? 0 : (dmgAutoMod ?? (c ? getMod(c, ovrDmgStat) : 0));
    const mainP          = c ? getMainWeapon(c) : null;
    const spellMaitrise  = s.designMode !== 'classic' && usesSpellMastery(s)
      ? getMaitriseBonus(c, mainP || {})
      : 0;
    const formulaFixedBonus = sFixed - spellMaitrise;
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
      // Valeur réellement utilisée par le jet. Sans cette copie, le VTT
      // retombait sur displayAttack (souvent +5), malgré un toucher auto à +10.
      toucher: ovrTouchMod + (parseInt(touchSetBonus) || 0),
      toucherMod: ovrTouchMod, toucherSetBonus: touchSetBonus,
      toucherStatLabel: ovrTouchNoMod ? '' : (statShort(ovrTouchStat) || ovrTouchStat),
      dmgStatMod: ovrDmgMod,
      dmgStatLabel: ovrDmgNoMod ? '' : (statShort(ovrDmgStat) || ovrDmgStat),
      formulaFixedBonus,
      maitriseBonus: spellMaitrise,
      drainBaseFormula: mods?.drain ? _vttSortDmgFormula(s, c, { includePower: false }) : null,
      mjAlwaysMax: !!s.mjAlwaysMax, autoHit: !!s.mjAutoHit,
    };
  }
  const isAmpSupportHeal = types.includes('defensif')
    && (s.runes || []).includes('Amplification')
    && s.ampMode !== 'deplacement'
    && !(s.runes || []).includes('Protection');
  const isClassicHeal = s.designMode === 'classic' && s.classicEffect === 'heal' && !!String(s.soin || '').trim();
  // Protection en mode Soin/Mana suffit à définir l'effet. Certains sorts
  // existants n'ont pas (ou plus) le type éditorial « defensif » : les exiger
  // transformait leur AoE en simple zone persistante sans restauration.
  const protectionRestoreMode = getProtectionRestoreMode(s);
  // Mode Mana : même mécanique que le Soin mais restaure des PM (drapeau isMana).
  const isManaRegen = protectionRestoreMode === 'mana';
  if (isClassicHeal || protectionRestoreMode === 'soin' || isManaRegen || isAmpSupportHeal) {
    // Régén PM : formule littérale (pas de scaling Protection ni de stat auto) ;
    // la stat explicite éventuelle est déjà intégrée dans la formule.
    const soinFormula = isManaRegen ? _calcSortMana(s, c) : _vttSortSoinFormula(s, c);
    const { rawDice: sRawDice, fixed: soinFormulaFixed } = splitSpellDiceFormula(soinFormula);
    const mainP = c ? getMainWeapon(c) : null;
    const soinIsMagic = !!(VS.damageTypes && s?.noyauTypeId
      && VS.damageTypes.find(x => x.id === s.noyauTypeId)?.isMagic);
    // Stat de soin : override > auto (magique → stat arme ou Int ; physique → Con)
    let soinStatKey;
    if (isManaRegen) {
      soinStatKey = 'none';          // régén PM : aucun modificateur auto
    } else if (s.degatsStat) {
      soinStatKey = s.degatsStat;
    } else {
      if (soinIsMagic) {
        soinStatKey = mainP?.isDefault
          ? 'intelligence'
          : (mainP?.statAttaque || 'intelligence');
      } else {
        soinStatKey = 'constitution';
      }
    }
    const soinNoMod   = soinStatKey === 'none';
    const soinStatMod = soinNoMod ? 0 : (c ? getMod(c, soinStatKey) : 0);
    const soinMaitrise = !isClassicHeal && !isManaRegen && usesHealingMastery(s, soinIsMagic, soinStatKey)
      ? getMaitriseBonus(c, mainP || {})
      : 0;
    // La formule calculée contient déjà stat + maîtrise. On conserve séparément
    // un éventuel bonus écrit dans la formule afin de ne rien compter deux fois.
    const soinBaseFixed = (isClassicHeal || isManaRegen)
      ? soinFormulaFixed
      : soinFormulaFixed - soinStatMod - soinMaitrise;
    const soinTouchStat = s.toucherStat || fallbackTouchStat;
    const soinTouchNoMod = soinTouchStat === 'none';
    const soinTouchMod   = soinTouchNoMod ? 0 : (c ? getMod(c, soinTouchStat) : fallbackTouchMod);
    return { ...common,
      icon: isManaRegen ? '💙' : '💚', label, rawDice: sRawDice, dice: soinFormula,
      isHeal: true, isMana: isManaRegen, halfOnMiss: false,
      formulaFixedBonus: soinBaseFixed,
      maitriseBonus: soinMaitrise,
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
    const summonAbilities = t.summonAbilities || Object.fromEntries(INVOCATION_ABILITIES.map(({ key }) => [key, 10]));
    const summonTouchStat = t.summonToucherStat || 'force';
    const summonDmgStat = t.summonDegatsStat || 'force';
    const hasSummonStatProfile = !!t.summonAbilities || !!t.summonToucherStat || !!t.summonDegatsStat;
    const summonTouchStatMod = _isInvoc && summonTouchStat !== 'none'
      ? getModFromScore(summonAbilities[summonTouchStat] ?? 10)
      : 0;
    const summonDmgStatMod = _isInvoc && summonDmgStat !== 'none'
      ? getModFromScore(summonAbilities[summonDmgStat] ?? 10)
      : 0;
    const summonTouchFlat = Number.isFinite(parseInt(t.summonToucherFlat)) ? parseInt(t.summonToucherFlat) : 0;
    const summonTouchTotal = hasSummonStatProfile ? summonTouchFlat + summonTouchStatMod : (t.attack ?? 5);
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
      // Portée effective du token : inclut notamment l'état « Allonge ».
      portee:  ld.displayRange ?? t.range ?? 1,
      isMeleeAttack: (parseInt(t.range) || 1) <= 1,
      pmCost:  0,
      toucher: summonTouchTotal,
      toucherMod: _isInvoc ? summonTouchStatMod : undefined,
      toucherSetBonus: _isInvoc ? summonTouchFlat : undefined,
      toucherSetBonusLabel: 'Base',
      toucherStatLabel: invocationStatShort(summonTouchStat),
      dmgStatKey: summonDmgStat,
      dmgStatMod: summonDmgStatMod,
      dmgStatLabel: invocationStatShort(summonDmgStat),
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
    if (_isInvoc && !_hasConditionEffect(t, 'cantCastSpells') && Array.isArray(t.summonActions) && t.summonActions.length) {
      const _cChar = {
        id: `__summon_${t.id || 'token'}`,
        nom: t.name || 'Invocation',
        niveau: Math.max(1, parseInt(t.summonLevel) || 1),
        pvBase: t.hpMax || 10,
        pmBase: t.pmMax || 0,
        stats: summonAbilities,
        statsBonus: {}, maitrises: {},
        equipement: { 'Main principale': {
          nom: 'Attaque',
          degats: t.summonBaseAttack || t.attackDice || '1d4',
          statAttaque: summonTouchStat,
          toucherStat: summonTouchStat,
          degatsStat: summonDmgStat,
          portee: t.range || 1,
          isDefault: true,
        } },
        sort_cats: [],
        elements: [],
      };
      let _ownerSetPmDelta = 0;
      if (!t.summonUsesOwnMana && t.summonOwnerId) {
        const _ownerData = VS.tokens[t.summonOwnerId]?.data;
        const _ownerChar = _ownerData?.characterId ? VS.characters[_ownerData.characterId] : null;
        if (_ownerChar) _ownerSetPmDelta = getArmorSetData(_ownerChar).modifiers?.spellPmDelta || 0;
      }
      const summonTouchBonus = summonTouchTotal;
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
          fallbackTouchStat: summonTouchStat,
          fallbackDmgStat: summonDmgStat,
          fallbackTouchMod: summonTouchBonus,
          fallbackDmgMod: summonDmgStatMod,
          touchSetBonus: summonTouchFlat,
          enchantOnlyAlsoEtat: true,
          extras: {
            _summonAction: true,
            toucherSetBonusLabel: 'Base',
            summonManaSource: t.summonUsesOwnMana ? 'invocation' : 'invocateur',
          },
        });
        if (!opt) return;
        if (!opt.autoHit && opt.toucher === undefined && opt.toucherMod !== undefined) {
          opt.toucher = (opt.toucherMod || 0) + (opt.toucherSetBonus || 0);
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
        isMeleeAttack: (parseInt(w.portee) || 1) <= 1,
        actionDescription: w.info || '',   // effet complémentaire (ex : « Si touche, applique Poison »)
        pmCost:  0,
        autoHit: !!w.toucherAuto,          // touche auto : pas de jet de toucher
        toucher: toucherTotal,            // total numérique utilisé par les jets
        toucherMod: toucherTotal,         // pour l'affichage détaillé (formule 1d20 +X (stat))
        toucherSetBonus: 0,
        toucherStatLabel: tStat === 'none'
          ? (flatT ? 'fixe' : '')
          : (statShort(tStat) || tStat) + (flatT ? ` +${flatT}` : ''),
        dmgStatKey: dStat,
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
        isMeleeAttack: (parseInt(atk.portee) || 1) <= 1,
        dmgStatKey: atk.degatsStat || 'force',
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
  if (b && !_hasConditionEffect(t, 'cantCastSpells') && Array.isArray(b.actions) && b.actions.length) {
    const armesN = Array.isArray(b.armesNaturelles) ? b.armesNaturelles : [];
    const arme0  = armesN[0] || null;
    const bWeapon = naturalWeaponCombatContext(arme0 || {}, _bMod);
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
          degats:      bWeapon.damageFormula,
          degatsStat:  bWeapon.damageStat,
          degatsStats: [bWeapon.damageStat],
          toucherStat: bWeapon.touchStat,
          statAttaque: bWeapon.touchStat,
          toucherFlat: bWeapon.touchFlat,
          portee:      arme0.portee || '',
          typeArme:    'CaC',
          format:      'Arme naturelle',
          sousType:    arme0.nom || '',
          traits:      [],
        },
      } : {},
      deck_sorts: b.actions, sort_cats: [], elements: [],
    };

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
        fallbackTouchStat: bWeapon.touchStat,
        fallbackDmgStat: bWeapon.damageStat,
        fallbackTouchMod: bWeapon.touchStatMod,
        fallbackDmgMod: bWeapon.damageStatMod,
        touchSetBonus: bWeapon.touchFlat,
        enchantOnlyAlsoEtat: true,
        extras: { toucherSetBonusLabel: 'Arme naturelle' },
      })));
    });
  }

  // Beast token : on n'enchaîne PAS sur les branches PNJ / personnage —
  // une créature n'a ni inventaire de PJ ni "poings" génériques.
  if (t.beastId) return options;

  // ── PNJ : stats saisies dans la fiche PNJ ──
  if (!c && t.npcId) {
    const n = VS.npcs[t.npcId] || {};
    const weapon = getMainWeapon({ equipement: n.equipement || {} });
    const weaponDamage = resolveWeaponDamageContext(
      VS.weaponFormats,
      VS.damageTypes,
      weapon,
      Array.isArray(n.elements) ? n.elements : [],
    );
    const damageType = weaponDamage.damageTypeId
      ? getDamageTypeById(VS.damageTypes, weaponDamage.damageTypeId)
      : null;
    const setData = getArmorSetData({ equipement: n.equipement || {} });
    const dmgStat = (Array.isArray(weapon.degatsStats) && weapon.degatsStats.length
      ? weapon.degatsStats[0]
      : (weapon.degatsStat || weapon.statAttaque || 'force'));
    const touchStat = weapon.toucherStats?.[0] || weapon.toucherStat || weapon.statAttaque || dmgStat;
    const dmgMod = _npcStatMod(n, dmgStat);
    const touchMod = _npcStatMod(n, touchStat);
    const setTouch = setData.modifiers?.toucherBonus || 0;
    // La fiche et l'arme équipée priment sur les anciennes valeurs copiées dans
    // le token à sa création. Changer l'arme du PNJ prend donc effet sans recréer
    // le token ni la scène.
    const rawDice = weapon.degats || t.attackDice || '2d4';
    const dice = `${rawDice}${dmgMod ? (dmgMod > 0 ? '+' : '') + dmgMod : ''}`;
    options.push({
      id: 'npc_attack',
      icon: weapon.isDefault ? '👊' : '⚔️',
      label: weapon.isDefault ? 'Coup de poing' : (weapon.nom || 'Attaque'),
      rawDice,
      dice,
      portee: ld.displayRange ?? 1,
      isMeleeAttack: (parseInt(weapon.portee) || 1) <= 1,
      pmCost: 0,
      toucher: ld.displayAttack ?? (touchMod + setTouch),
      toucherMod: touchMod,
      toucherSetBonus: setTouch,
      toucherStatLabel: statShort(touchStat) || touchStat,
      dmgStatKey: dmgStat,
      dmgStatMod: dmgMod,
      dmgStatLabel: statShort(dmgStat) || dmgStat,
      maitriseBonus: 0,
      traits: getItemTraits(weapon),
      typeRules: getDamageTypeRules(VS.damageTypes, weaponDamage.damageTypeId || 'physique'),
      damageTypeId: weaponDamage.damageTypeId,
      damageTypeIcon: damageType?.icon || (weaponDamage.isMagic ? '✨' : '💪'),
      damageTypeColor: damageType?.color || (weaponDamage.isMagic ? '#c084fc' : '#9ca3af'),
      isMagicWeapon: weaponDamage.isMagic,
      charElements: weaponDamage.elementIds,
      weaponTechniques: Array.isArray(weaponDamage.format?.techniques) ? weaponDamage.format.techniques : [],
    });
    const npcSpells = Array.isArray(n.deck_sorts)
      ? n.deck_sorts
      : (Array.isArray(n.actions) ? n.actions : []);
    if (!_hasConditionEffect(t, 'cantCastSpells') && npcSpells.length) {
      const nChar = {
        id: n.id || `npc_${t.npcId}`,
        nom: n.nom || 'PNJ',
        stats: {
          force: _numOr(n.stats?.force, 10),
          dexterite: _numOr(n.stats?.dexterite, 10),
          intelligence: _numOr(n.stats?.intelligence, 10),
          sagesse: _numOr(n.stats?.sagesse, 10),
          constitution: _numOr(n.stats?.constitution, 10),
          charisme: _numOr(n.stats?.charisme, 10),
        },
        statsBonus: computeEquipStatsBonus(n.equipement || {}),
        equipement: n.equipement || {},
        deck_sorts: npcSpells,
        sort_cats: [],
        elements: [],
      };
      const pmSetDelta = setData.modifiers?.spellPmDelta || 0;
      npcSpells.forEach((s, actIdx) => {
        if (s.actif === false) return;
        const baseRange = (s.portee != null && Number.isFinite(parseInt(s.portee)))
          ? parseInt(s.portee)
          : (ld.displayRange || 1);
        const pmRaw = Number.isFinite(parseInt(s.pmOverride)) ? parseInt(s.pmOverride) : (parseInt(s.pm) || 0);
        const pmCost = Math.max(0, pmRaw + pmSetDelta);
        const opt = _buildSpellOption(s, {
          id: `npc_action_${actIdx}`,
          sortIdx: `npc_${t.npcId}_${actIdx}`,
          spellId: s.id || null,
          label: s.nom || `Action ${actIdx + 1}`,
          c: nChar,
          portee: baseRange,
          pmCost,
          basePm: pmCost,
          pmRaw,
          pmSetDelta,
          fallbackTouchStat: touchStat,
          fallbackDmgStat: dmgStat,
          fallbackTouchMod: touchMod,
          fallbackDmgMod: dmgMod,
          touchSetBonus: setTouch,
          enchantOnlyAlsoEtat: true,
          extras: { _npcAction: true },
        });
        if (opt) options.push(_withSpellCooldown(t, opt));
      });
    }
    return options;
  }

  // ── Arme invoquée active (buff weapon_replace) : remplace l'arme principale ──
  const _r0 = VS.session?.combat?.round ?? 0;
  const wReplace = (t.buffs || []).find(b => b?.type === 'weapon_replace'
    && (b.expiresAtRound == null || _r0 === 0 || _r0 <= b.expiresAtRound));

  // ── Arme principale du personnage (ou attaque générique) ──
  const weapon       = c ? _vttPrimaryWeapon(c) : null;
  const weaponSlot   = c ? Object.entries(c.equipement || {}).find(([, item]) => item === weapon)?.[0] : '';
  const weaponSource = weaponSlot ? getEquippedSourceItem(c, weaponSlot, weapon) : weapon;
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
  const _weaponIsMelee = wReplace
    ? Math.max(1, parseInt(wReplace.weaponRange) || 1) <= 1
    : (isUnarmed || _vttBestWeaponRange(c) <= 1);
  const _enchantDmgCondition = _conditionDmgBonusOf(t, {
    id: 'weapon', portee: wPortee, isMeleeAttack: _weaponIsMelee, dmgStatKeys: wDmgStats,
  });
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
    isMeleeAttack:    _weaponIsMelee,
    pmCost:           0,
    toucherMod:       wTchMod,
    toucherSetBonus:  wSetBonus,
    toucherStatLabel: statShort(wTchStat) || wTchStat,
    dmgStatKeys:       wDmgStats,
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
    traits:           !wReplace && !isUnarmed ? getItemTraits(weaponSource) : [],
    weaponTechniques: !wReplace && !isUnarmed && Array.isArray(fmt?.techniques) ? fmt.techniques : [],
  });

  // ── Arme secondaire équipée ─────────────────────────────────────────────
  // Contrairement à la main principale, un slot vide ne génère jamais de
  // poings de secours. Une vraie arme secondaire reste une Action normale et
  // conserve ses propres stats, sa portée, sa maîtrise et son type de dégâts.
  const secondaryWeapon = c?.equipement?.[getSecondaryWeaponSlotId()] || null;
  if (secondaryWeapon?.nom && secondaryWeapon?.degats) {
    const secondaryDmgStats = Array.isArray(secondaryWeapon.degatsStats) && secondaryWeapon.degatsStats.length
      ? secondaryWeapon.degatsStats
      : [secondaryWeapon.degatsStat || secondaryWeapon.statAttaque || 'force'];
    const secondaryTouchStat = secondaryWeapon.toucherStats?.[0]
      || secondaryWeapon.toucherStat
      || secondaryWeapon.statAttaque
      || secondaryDmgStats[0];
    const secondaryDmgMod = secondaryDmgStats.reduce((sum, stat) => sum + getMod(c, stat), 0);
    const secondaryTouchMod = getMod(c, secondaryTouchStat);
    const secondaryMastery = getMaitriseBonus(c, secondaryWeapon);
    const secondaryFormat = VS.weaponFormats?.find(format => format.label === secondaryWeapon.format);
    const secondaryMagic = secondaryFormat?.isMagic === true;
    const secondaryTypeId = secondaryMagic ? null : (secondaryFormat?.damageType || 'physique');
    const secondaryType = secondaryTypeId ? getDamageTypeById(VS.damageTypes, secondaryTypeId) : null;
    const secondaryBaseRange = Math.max(1, parseInt(secondaryWeapon.portee) || 1);
    const secondaryRangeBonus = Math.max(0, (ld.displayRange || secondaryBaseRange) - _vttBestWeaponRange(c));

    options.push({
      id: 'weapon_secondary',
      icon: '🗡️',
      label: `${secondaryWeapon.nom} · main secondaire`,
      rawDice: secondaryWeapon.degats,
      dice: secondaryWeapon.degats,
      portee: secondaryBaseRange + secondaryRangeBonus,
      isMeleeAttack: secondaryBaseRange <= 1,
      pmCost: 0,
      actionType: 'action',
      toucherMod: secondaryTouchMod,
      toucherSetBonus: wSetBonus,
      toucherStatLabel: statShort(secondaryTouchStat) || secondaryTouchStat,
      dmgStatKeys: secondaryDmgStats,
      dmgStatMod: secondaryDmgMod,
      dmgStatLabel: secondaryDmgStats.map(stat => statShort(stat) || stat).join('+'),
      maitriseBonus: secondaryMastery,
      typeRules: secondaryMagic
        ? getDamageTypeRules(VS.damageTypes, 'physique')
        : getDamageTypeRules(VS.damageTypes, secondaryTypeId),
      damageTypeId: secondaryTypeId,
      damageTypeIcon: secondaryType?.icon || '',
      damageTypeColor: secondaryType?.color || '',
      isMagicWeapon: secondaryMagic,
      charElements: secondaryMagic ? (c.elements || []) : [],
      traits: getItemTraits(getEquippedSourceItem(c, getSecondaryWeaponSlotId(), secondaryWeapon)),
      weaponSlot: 'secondary',
      weaponTechniques: Array.isArray(secondaryFormat?.techniques) ? secondaryFormat.techniques : [],
    });
  }

  // ── Sorts connus du personnage ──
  // Le picker affiche le Deck par défaut, mais conserve aussi les sorts validés
  // hors Deck afin que le joueur puisse exceptionnellement les lancer depuis
  // l'onglet « Tous les sorts ». Un sort en attente/refusé reste inutilisable.
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
      const validation = s?.mjValidation
        || (typeof s?.mjValidated === 'boolean' ? (s.mjValidated ? 'ok' : 'pending') : 'ok');
      if (!s.actif && validation !== 'ok') return;
      // Portée du sort : préserve EXPLICITEMENT 0 (sur soi uniquement).
      const baseRange = (s.portee != null && Number.isFinite(parseInt(s.portee)))
        ? parseInt(s.portee)
        : (ld.displayRange || 1);
      // Coût PM : pmOverride MJ > calc auto, puis delta set léger (clampé à 0 min),
      // puis vérification si cible gratuite (multi-cibles ou sort suspendu).
      const pmRaw     = (Number.isFinite(s.pmOverride) && s.pmOverride >= 0)
                        ? s.pmOverride : (parseInt(s.pm) || 0);
      // Le delta du set d'armure ne réduit que les coûts en PM.
      const setDelta  = spellSetCostDelta(spellPmDelta, s.costResource || 'pm');
      const basePm    = Math.max(0, pmRaw + setDelta);
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
        pmCost: cout, basePm, pmRaw, pmSetDelta: setDelta,
        fallbackTouchStat: wTchStat,    fallbackDmgStat: sStatKey,
        fallbackTouchMod:  wTchMod,     fallbackDmgMod:  sStatMod,
        touchSetBonus: wSetBonus,
        enchantOnlyAlsoEtat: true,
        extras: { ...catMeta, _isDeckSpell: !!s.actif },
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

    // Indices d'inventaire actuellement équipés. Les actions d'armes/armures ne
    // sont accessibles que si l'objet est équipé ; les consommables restent
    // utilisables depuis l'inventaire.
    // IMPORTANT : on résout par IDENTITÉ (itemId/nom) et non via le sourceInvIndex
    // stocké — celui-ci devient périmé dès que l'inventaire est réordonné en séance
    // (ajout d'objet, normalisation « 1 entrée = 1 unité »…). Sinon l'action d'un
    // objet équipé (ex. « Lancer de dagues ») disparaît brutalement en cours de partie.
    const equippedInvIdx = new Set(resolveEquippedInventoryIndices(c).values());

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
        const setDeltaI = spellSetCostDelta(spellPmDeltaI, s.costResource || 'pm');
        const basePm = Math.max(0, pmRaw + setDeltaI);
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
          pmCost: cout, basePm, pmRaw, pmSetDelta: setDeltaI,
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
// Modale d'action d'où l'on vient : annuler un sort en cours (zone / multi-cibles /
// déplacement) rouvre cette modale plutôt que de tout fermer. { srcId, tgtId }.
let _actModalReturn = null;
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
  if (t.npcId)       { const n = VS.npcs[t.npcId];            return n ? _numOr(n.hp, _live(t)?.displayHpMax ?? t.hp ?? null) : (t.hp ?? null); }
  if (t.beastId)     { const b = VS.bestiary[t.beastId];      return t.hp != null ? t.hp : (b ? _numOr(b.pvMax, null) : null); }
  return t.hp ?? null;
}

// Maximum RÉEL correspondant. Ne jamais utiliser displayHpMax pour résoudre un
// soin : côté joueur, cette valeur est volontairement remplacée par son estimation.
function _effectiveTokenHpMax(t) {
  if (t.characterId) {
    const c = VS.characters[t.characterId];
    return c ? calcPVMax(c) : _numOr(t.hpMax, _numOr(t.pvMax, null));
  }
  if (t.npcId) {
    const n = VS.npcs[t.npcId];
    if (!n) return _numOr(t.hpMax, _numOr(t.pvMax, null));
    return calcPVMax({
      ...n,
      niveau: Math.max(1, parseInt(n.niveau, 10) || 1),
      pvBase: _numOr(n.pvBase, _numOr(n.pv, 20)),
      statsBonus: computeEquipStatsBonus(n.equipement || {}),
      equipement: n.equipement || {},
    });
  }
  if (t.beastId) return _numOr(VS.bestiary[t.beastId]?.pvMax, _numOr(t.hpMax, null));
  return _numOr(t.hpMax, _numOr(t.pvMax, _numOr(t.pv, null)));
}

// PM courant RÉEL stocké SUR LE TOKEN (créatures bestiaire / invocations qui
// paient leurs compétences sur leur propre mana). null si le token ne porte pas
// de PM (perso/PNJ → le PM est sur la fiche, capturé via `chars`).
function _effectiveTokenPm(t) {
  if (t.npcId) {
    const n = VS.npcs[t.npcId];
    if (!n) return t.pm ?? null;
    return _numOr(n.pmCurrent, _live(t)?.displayPmMax ?? t.pm ?? null);
  }
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
      combatHpEstimate: VS.combatHpEstimates.has(t.id)
        ? { ...VS.combatHpEstimates.get(t.id) }
        : null,
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
function _vttSpellPills(o, { includeTraits = true } = {}) {
  const pills = [];
  const targetSelf = !!o.targetSelf;
  const isHeal = !!o.isHeal;
  const isUtil = !!(o.isCaSort || o.isUtil);
  const isEnchant = !!o.isEnchant;
  if (o.cooldownRemaining > 0) pills.push(_vttAoptPill('cooldown', `⏳ Recharge ${o.cooldownRemaining} tour${o.cooldownRemaining > 1 ? 's' : ''}`));
  else if (o.cooldownTurns > 0) pills.push(_vttAoptPill('cooldown ready', `↻ Recharge ${o.cooldownTurns} tour${o.cooldownTurns > 1 ? 's' : ''}`));
  const isFriendly = isEnchant || isHeal || o.isRegen || o.friendlyOnly;
  const isHostile  = !!o.isAffliction || !!o.hostileOnly;
  if (targetSelf) {
    pills.push(_vttAoptPill('targets self', `🧍 Sur soi`));
  } else if (o.zoneW > 0 || o.zoneH > 0) {
    const zoneIcon = o.zoneShape === 'cross' ? '✚' : o.zoneShape === 'cone' ? '🔺' : o.zoneShape === 'ring' ? '◯' : o.zoneShape === 'line' ? '▬' : o.zoneShape === 'diamond' ? '◇' : '📐';
    pills.push(_vttAoptPill('zone', `${zoneIcon} ${o.zoneW||o.zoneH}×${o.zoneH||o.zoneW}c · ${o.portee}c`));
  } else if ((o.nbCibles || 1) > 1) {
    const lbl = isFriendly ? 'alliés' : isHostile ? 'ennemis' : 'cibles';
    pills.push(_vttAoptPill('targets', `🎯 ${o.nbCibles} ${lbl} · ${o.portee}c`));
  } else if (isFriendly) {
    pills.push(_vttAoptPill('targets single', `🎯 1 allié · ${o.portee}c`));
  } else if (isHostile) {
    pills.push(_vttAoptPill('targets single', `🎯 1 ennemi · ${o.portee}c`));
  } else {
    pills.push(_vttAoptPill('targets single', `🎯 1 cible · ${o.portee}c`));
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
    const fixedBonus = _optionFixedBonus(o);
    const displayFormula = _effectFormulaWithFixedBonus(o, formula, fixedBonus);
    const statNote = o.dmgStatLabel && (o.dmgStatMod !== undefined && o.dmgStatMod !== null)
      ? ` (${_esc(o.dmgStatLabel)})`
      : '';
    const _healIco = o.isMana ? '💙' : '🩹';
    const _healUnit = o.isMana ? ' PM' : ' PV';
    pills.push(_vttAoptPill(isHeal ? 'heal' : 'dmg', `${isHeal ? _healIco : '🎲'} ${isHeal ? '+' : ''}${_esc(displayFormula)}${statNote}${isHeal ? _healUnit : ''}`));
  }
  if (o.activeDmgCondition?.formula) {
    const cond = o.activeDmgCondition;
    pills.push(_vttAoptPill('enchant', `${_esc(cond.icon || '✨')} ${_esc(cond.label || 'État')} : +${_esc(cond.formula)}`));
  }
  if (includeTraits) {
    _vttActionTraits(o).forEach(trait => pills.push(_vttAoptPill('traits', `🔖 ${_esc(trait)}`)));
  }
  return pills;
}

function _vttActionTraits(o) {
  return [...new Set((Array.isArray(o?.traits) ? o.traits : (o?.traits ? [o.traits] : []))
    .map(trait => typeof trait === 'string' ? trait.trim() : String(trait?.nom || trait?.label || '').trim())
    .filter(Boolean))];
}

function _vttWeaponTraitsHtml(o) {
  const traits = _vttActionTraits(o);
  if (!traits.length) return '';
  return `<span class="vtt-action-weapon-traits">
    <span class="vtt-action-weapon-traits-label">🔖 Traits de l’arme</span>
    <span class="vtt-action-weapon-traits-list">${traits.map(trait => `<span>${_esc(trait)}</span>`).join('')}</span>
  </span>`;
}
// Chips de runes du sort (lecture seule), comme sur la carte de la fiche perso.
function _vttSpellRuneChips(o, srcChar) {
  if (o.sortIdx === undefined || !srcChar?.deck_sorts) return '';
  const _s = srcChar.deck_sorts[o.sortIdx];
  const _runes = _vttDisplayRunes(_s?.runes || []);
  if (!_runes.length) return '';
  const _counts = {}; _runes.forEach(r => { _counts[r] = (_counts[r]||0)+1; });
  return `<div class="vtt-atk-runes" aria-label="Composition du sort">
    <span class="vtt-atk-runes-label">Runes du sort</span>
    <span class="vtt-atk-runes-list">${Object.entries(_counts).map(([nom, n]) => {
    const m = _VTT_RUNE_META[nom] || { icon:'•', color:'#888' };
    return `<span class="vtt-atk-rune" style="--rune-color:${m.color}" title="${_esc(nom)}">
      <span class="vtt-atk-rune-icon">${m.icon}</span>
      <span>${_esc(nom)}</span>${n > 1 ? `<b>×${n}</b>` : ''}
    </span>`;
  }).join('')}</span>
  </div>`;
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
  const selfTarget = !!exOpts.selfTarget || (!noTgt && srcId === tgtId);

  const options = _buildAttackOptions(src);
  // Les bonus d'état sont lus sur le TOKEN, y compris pour une invocation qui
  // n'a volontairement aucune fiche personnage liée. On les rend visibles dès
  // le sélecteur d'action ; le jet les relira ensuite à frais avant application.
  options.forEach(option => {
    if (!receivesOffensiveDamageBonus(option)) return;
    const activeDmgCondition = _conditionDmgBonusOf(src, option);
    if (activeDmgCondition) {
      option.activeDmgCondition = {
        formula: activeDmgCondition.formula,
        icon: activeDmgCondition.lib?.icon || '✨',
        label: activeDmgCondition.lib?.label || 'État offensif',
      };
    }
  });
  // Cible d'abord : filtre par portee, en gardant les actions "sur soi".
  // Action d'abord : pas de cible, on garde tout et la portee sera verifiee a la visee.
  const inRange = noTgt
    ? options
    : options.filter(o => {
        if (o.friendlyOnly && tgt.type === 'enemy') return false;
        if (o.hostileOnly && tgt.type !== 'enemy') return false;
        if (selfTarget) {
          return !!(o.targetSelf || o.friendlyOnly || o.isHeal || o.isRegen || o.isEnchant || o.isCaSort || o.isUtil || o._itemAction);
        }
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
  const characterSpellOpts = spellOpts.filter(o => typeof o._isDeckSpell === 'boolean');
  const deckSpellCount = characterSpellOpts.filter(o => o._isDeckSpell).length;
  const allSpellCount = characterSpellOpts.length;
  const hasOutOfDeckSpells = allSpellCount > deckSpellCount;
  const showSpellScope = hasOutOfDeckSpells && (!only || only === 'spells');

  // Grouper les sorts par catégorie (ordre des sort_cats du personnage)
  const srcChar   = _characterForToken(src);
  const sortCats  = srcChar?.sort_cats || [];
  const hasCats   = sortCats.length > 0 && spellOpts.some(o => o.catId);

  // Jauges de ressources HORS PM (PV / Garde / Or) : affichées uniquement pour les
  // ressources qu'un sort RÉELLEMENT disponible du lanceur consomme. Le lanceur doit
  // être un personnage (les PNJ/créatures n'ont ni Garde ni Or de fiche).
  const _spellReses = srcChar ? new Set(spellOpts.map(o => o.costRes || 'pm')) : new Set();
  const _resRows = [];
  if (srcChar) {
    if (_spellReses.has('pv'))    _resRows.push({ resId: 'pv',    icon: '❤️', label: 'PV',    color: '#e0556f', cur: Math.max(0, lS.displayHp ?? 0), max: lS.displayHpMax ?? 0 });
    if (_spellReses.has('garde')) _resRows.push({ resId: 'garde', icon: '🛡️', label: 'Garde', color: '#5fb0c8', cur: _charGardeCur(srcChar),        max: calcGardeMax(srcChar) });
    if (_spellReses.has('or'))    _resRows.push({ resId: 'or',    icon: '🪙', label: 'Or',    color: '#d9a441', cur: calcOr(srcChar),               max: 0 });
  }
  const _resPct = (r) => r.max > 0 ? Math.round(Math.min(r.cur, r.max) / r.max * 100) : 0;
  // Réserve courante par ressource → contrôle « coût > réserve » sur les cartes.
  const _resCurMap = { pm };
  _resRows.forEach(r => { _resCurMap[r.resId] = r.cur; });
  // Jauge unifiée (Mana + PV / Garde / Or) : label + valeur + coût « −X » + barre avec
  // FANTÔME, tous pilotés au survol par _vttAoptBindControls. Chaque jauge porte sa
  // ressource (data-aopt-res) et sa réserve (data-cur / data-max) → l'aperçu retrouve
  // la bonne barre à réduire selon la ressource du sort survolé.
  const _resGauge = (r) => `
    <div class="vtt-aopt-mana" data-aopt-res="${r.resId}" data-cur="${r.cur}" data-max="${r.max}" style="--rc:${r.color}">
      <div class="vtt-aopt-mana-top">
        <span style="color:${r.color}">${r.icon} ${r.label}</span>
        <b style="color:${r.color}"><u class="vtt-aopt-mana-now">${r.cur}</u>${r.max > 0 ? `<i>/${r.max}</i>` : ''}<em class="vtt-aopt-mana-cost" hidden></em></b>
      </div>
      ${r.max > 0 ? `<div class="vtt-aopt-mana-track">
        <i class="vtt-aopt-mana-fill" style="width:${_resPct(r)}%${r.resId === 'pm' ? '' : `;background:${r.color}`}"></i>
        <u class="vtt-aopt-mana-ghost"></u>
      </div>` : ''}
    </div>`;
  const _allResRows = [
    ...(pm != null && pmMax != null && pmMax > 0 ? [{ resId: 'pm', icon: '✨', label: 'Mana', color: '#b47fff', cur: pm, max: pmMax }] : []),
    ..._resRows,
  ];
  const resGaugesHtml = _allResRows.map(_resGauge).join('');
  // Style « barre HUD » (à côté de pmBar, flux action d'abord)
  const resPmBars = _resRows.map(r => `<div class="vtt-atk-pm-bar">
      <span style="color:${r.color}">${r.icon}</span>
      ${r.max > 0 ? `<div class="vtt-atk-pm-track"><div class="vtt-atk-pm-fill" style="width:${_resPct(r)}%;background:${r.color}"></div></div>` : ''}
      <span style="font-size:.72rem;color:${r.color};font-weight:700">${r.cur}${r.max > 0 ? `/${r.max}` : ''}</span>
    </div>`).join('');

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
  const _actionKind = (o) => {
    const raw = String(o?.actionType || o?.actionMode || o?.modeAction || o?._itemAction?.actionType || o?._itemAction?.actionMode || '').toLowerCase();
    if (raw.includes('bonus')) return 'bonus';
    if (raw.includes('reaction') || raw.includes('réaction') || raw.includes('reac') || raw.includes('réac')) return 'reaction';
    return 'action';
  };
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
    const deckChip = o._isDeckSpell === false
      ? '<span class="vtt-aopt-source vtt-aopt-source--outdeck" title="Ce sort est connu mais n’est pas préparé">Hors Deck</span>'
      : '';

    // ── Coût : badge dédié à DROITE du titre (PM par défaut, sinon PV / Or) ──
    let pmBadge = '';
    const _res = spellCostRes({ costResource: o.costRes || 'pm' });
    const _resIco = _res.id === 'pm' ? '🔮' : _res.icon;   // 🔮 conservé pour les PM
    const _setDelta = o.pmSetDelta || 0;
    const _setReduc = _setDelta < 0;
    const _setExtra = _setDelta
      ? `<span class="vtt-aopt-pm-set" title="Set d'armure : ${_setDelta > 0 ? '+' : '−'}${Math.abs(_setDelta)} ${_res.label} (coût brut ${o.pmRaw})">${_setDelta > 0 ? '⬆' : '🍃'} ${_setDelta > 0 ? '+' : '−'}${Math.abs(_setDelta)}</span>`
      : '';
    const _manaSource = o.summonManaSource ? ` · ${o.summonManaSource}` : '';
    if (o.pmCost > 0) {
      pmBadge = `<span class="vtt-aopt-pm ${_setReduc?'vtt-aopt-pm--reduced':''}"${_manaSource ? ` title="Réserve utilisée : ${_esc(o.summonManaSource)}"` : ''}>${_resIco} ${o.pmCost} ${_res.label}${_manaSource}${_setExtra}</span>`;
    } else if (o.pmCost === 0 && o.basePm > 0) {
      pmBadge = `<span class="vtt-aopt-pm vtt-aopt-pm--free" title="Cast offert (multi-cibles ou sort suspendu déclenché)">🎁 Gratuit</span>`;
    } else if (o.basePm > 0) {
      pmBadge = `<span class="vtt-aopt-pm ${_setReduc?'vtt-aopt-pm--reduced':''}">${_resIco} ${o.basePm} ${_res.label}${_setExtra}</span>`;
    }

    const cardKind = o._itemAction ? 'is-item'
      : o.sortIdx !== undefined ? 'is-spell'
      : o.isDeplacement ? 'is-move'
      : 'is-weapon';

    // Arme principale (1re) et secondaire (2e) : mises en avant en JAUNE pour rester
    // repérables d'un coup d'œil, comme dans l'ancienne modale.
    const isPrimaryWeapon   = cardKind === 'is-weapon' && weaponOpts[0] === o;
    const isSecondaryWeapon = cardKind === 'is-weapon' && weaponOpts[1] === o;
    const isMainWeapon      = isPrimaryWeapon || isSecondaryWeapon;

    // Dans la modale ciblée, les traits d'arme ont leur propre ligne lisible.
    // Le HUD compact conserve ses pills afin de ne pas agrandir ses cartes.
    const pills = _vttSpellPills(o, { includeTraits: noTgt || cardKind !== 'is-weapon' });

    // ── Couleur d'accent + pastille d'élément (langage visuel des cartes de sort) ──
    // Armes principale/secondaire → accent AMBRE (jaune) pour les distinguer.
    const accentCol = isMainWeapon ? 'var(--amber)'
      : o.isHeal ? '#22c55e'
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
    const actionKind = _actionKind(o);
    const actChip = actionKind === 'bonus'
      ? `<span class="cs-spellcard-act" style="--c:#f97316">✴️ Action bonus</span>`
      : actionKind === 'reaction'
        ? `<span class="cs-spellcard-act" style="--c:#a78bfa">🔄 Réaction</span>`
        : `<span class="cs-spellcard-act" style="--c:#e8b84b">⚡ Action</span>`;

    // Runes du sort (chips lecture seule) — comme sur la carte de la fiche perso.
    const runeChipsHtml = _vttSpellRuneChips(o, srcChar);

    const weaponTraitsHtml = cardKind === 'is-weapon' ? _vttWeaponTraitsHtml(o) : '';
    const cardState = onCooldown ? 'is-cooldown' : noTgt ? 'is-aim' : canHit ? 'is-ready' : 'is-oor';
    const cardHint = onCooldown ? `Recharge ${o.cooldownRemaining}t`
      : noTgt ? 'Choisir puis viser'
      : canHit ? 'Lancer'
      : 'Hors portée';

    const launchFn = noTgt ? '_vttAimOpt' : '_vttPickOpt';
    const launchArgs = noTgt ? `${srcId}|${i}` : `${srcId}|${tgtId}|${i}`;
    const buttonAttrs = `type="button" style="--type-col:${accentCol}" data-vtt-fn="${launchFn}" data-vtt-args="${launchArgs}" ${onCooldown ? 'disabled aria-disabled="true"' : ''}`;

    if (!noTgt) {
      // Coût rapporté à la réserve (fantôme + alerte « mana insuffisant »). On ne
      // prévisualise sur la jauge MANA que pour un coût EN PM sans réserve alternative
      // (summonManaSource / coût PV·Or → badge sans fantôme). Aucune logique de cast
      // touchée : purement visuel.
      // Aperçu du coût sur la jauge de la ressource concernée (PM / PV / Garde / Or).
      // Exclu si le coût est payé par une réserve d'invocation (pas la barre du lanceur).
      const _canPreview = o.pmCost > 0 && !o.summonManaSource;
      const _ghostCost = _canPreview ? o.pmCost : 0;
      const _ghostRes  = _canPreview ? _res.id : '';
      const _resCur    = _resCurMap[_res.id];
      const _insuff = _canPreview && _resCur != null && o.pmCost > _resCur;
      let costHtml;
      if (o.pmCost > 0) {
        costHtml = `<span class="vtt-aopt-cost ${_insuff ? 'vtt-aopt-cost--warn' : 'vtt-aopt-cost--pm'}"${_manaSource ? ` title="Réserve utilisée : ${_esc(o.summonManaSource)}"` : ''}>${_resIco} ${o.pmCost} ${_res.label}${_manaSource}${_setExtra}</span>`;
      } else if (o.pmCost === 0 && o.basePm > 0) {
        costHtml = `<span class="vtt-aopt-cost vtt-aopt-cost--free" title="Cast offert (multi-cibles ou sort suspendu déclenché)">🎁 Gratuit</span>`;
      } else if (o.basePm > 0) {
        costHtml = `<span class="vtt-aopt-cost vtt-aopt-cost--pm">${_resIco} ${o.basePm} ${_res.label}${_setExtra}</span>`;
      } else {
        costHtml = `<span class="vtt-aopt-cost vtt-aopt-cost--none">Sans PM</span>`;
      }
      // Chip de type d'action : petit libellé texte coloré (Action/Bonus/Réaction),
      // couleur par rôle depuis les tokens (amber / ember / arcane) → --k.
      const _kind = actionKind === 'bonus' ? ['Bonus', 'var(--ember)']
        : actionKind === 'reaction' ? ['Réaction', 'var(--arcane)']
        : ['Action', 'var(--amber)'];
      const kindChip = `<span class="vtt-action-choice-kind" style="--k:${_kind[1]}">${_kind[0]}</span>`;
      // Badge « arme principale / secondaire » en jaune pour les repérer vite.
      const weaponTag = isPrimaryWeapon
        ? `<span class="vtt-action-choice-wtag" title="Arme principale">★ Principale</span>`
        : isSecondaryWeapon
          ? `<span class="vtt-action-choice-wtag" title="Arme secondaire">Secondaire</span>` : '';
      const metaExtra = `${sourceChip}${deckChip}${stack}`;
      const _detail = `${weaponTraitsHtml}${runeChipsHtml}${desc ? `<span class="vtt-action-choice-desc">${_esc(desc)}</span>` : ''}`;
      return `
      <button ${buttonAttrs} class="vtt-aopt vtt-action-choice ${cardKind} ${cardState} ${isPrimaryWeapon ? 'is-primary-weapon' : ''} ${isSecondaryWeapon ? 'is-secondary-weapon' : ''}" data-cost="${_ghostCost}" data-cost-res="${_ghostRes}">
        <span class="vtt-action-choice-icon">${o.icon}</span>
        <span class="vtt-action-choice-body">
          <span class="vtt-action-choice-head">
            <span class="vtt-action-choice-name" title="${_esc(o.label)}">${_esc(o.label)}</span>
            ${kindChip}${weaponTag}
          </span>
          ${(pills.length || metaExtra) ? `<span class="vtt-action-choice-tags">${pills.join('')}${metaExtra}</span>` : ''}
          ${_detail ? `<span class="vtt-action-choice-detail">${_detail}</span>` : ''}
        </span>
        <span class="vtt-action-choice-end">${costHtml}<span class="vtt-action-choice-hint">${cardHint}</span></span>
        <span class="vtt-action-choice-key" aria-hidden="true"></span>
      </button>`;
    }

    // Carte compacte pour le HUD action-d'abord.
    return `
      <button ${buttonAttrs} class="vtt-aopt cs-spellcard vtt-castcard ${cardKind} ${cardState} ${isPrimaryWeapon ? 'is-primary-weapon' : ''}">
        <header class="cs-spellcard-head">
          <span class="cs-spellcard-icon">${o.icon}</span>
          <div class="cs-spellcard-id">
            <div class="cs-spellcard-name" title="${_esc(o.label)}">${_esc(o.label)}</div>
            <div class="cs-spellcard-sub">${actChip}${sourceChip}${deckChip}${elemPastille}${stack}</div>
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
    const deckState = o._isDeckSpell === false ? 'out' : o._isDeckSpell === true ? 'deck' : '';
    const deckAttrs = deckState ? ` data-deck-state="${deckState}"${deckState === 'out' ? ' hidden' : ''}` : '';
    return html.replace('<button ', `<button data-name="${name}"${deckAttrs} `);
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
        const deckCount = catOpts.filter(o => o._isDeckSpell !== false).length;
        optsHtml += _section(tabId, '✨', title, color, deckCount, body);
        tabs.push({ id:tabId, icon:'✨', title, color, count:deckCount, allCount:catOpts.length });
      });
    } else {
      const body = spellOpts.map(o => _optBtnWithName(o, inRange.indexOf(o))).join('');
      const deckCount = spellOpts.filter(o => o._isDeckSpell !== false).length;
      optsHtml += _section('spells', '✨', 'Sorts', '#818cf8', deckCount, body);
      tabs.push({ id:'spells', icon:'✨', title:'Sorts', color:'#818cf8', count:deckCount, allCount:spellOpts.length });
    }
  }

  // ── Section Actions de base (Courir / Esquiver / Se désengager / Aider) ──
  // Disponibles dès que tu contrôles le token source (pas seulement en combat
  // formel : un allié peut tomber à 0 PV hors tracker d'initiative).
  const inCombat = !!VS.session?.combat?.active;
  const couru    = (src.bonusMvt || 0) > 0;
  const canEditSrc = _canControlToken(src);
  let basicHtml = '';
  if (canEditSrc && (!only || only === 'basic')) {
    // Carte d'action de base — même présentation (.cs-spellcard) que les sorts.
    const _basicCard = (icon, name, desc, col, fn, args) => `
        <button type="button" class="vtt-aopt ${noTgt ? 'cs-spellcard' : 'vtt-action-choice'} vtt-castcard is-basic is-ready" style="--type-col:${col}" data-name="${_norm(name).replace(/"/g,'')}" data-vtt-fn="${fn}" data-vtt-args="${args}">
          ${noTgt ? `
            <header class="cs-spellcard-head">
              <span class="cs-spellcard-icon">${icon}</span>
              <div class="cs-spellcard-id"><div class="cs-spellcard-name" title="${name}">${name}</div></div>
              <span class="vtt-castcard-cta">Faire</span>
            </header>
            <div class="cs-spellcard-tags"><span class="vtt-aopt-pill" style="color:${col};border-color:${col}66">${desc}</span></div>
          ` : `
            <span class="vtt-action-choice-icon">${icon}</span>
            <span class="vtt-action-choice-body">
              <span class="vtt-action-choice-head">
                <strong title="${name}">${name}</strong>
                <span class="vtt-action-choice-kinds"><span class="cs-spellcard-act" style="--c:${col}">Action</span></span>
              </span>
              <span class="vtt-action-choice-tags"><span class="vtt-aopt-pill" style="color:${col};border-color:${col}66">${desc}</span></span>
            </span>
            <span class="vtt-action-choice-end"><span class="vtt-castcard-cta">Faire</span></span>
          `}
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
  const allActionsCount = tabs.reduce((s, t) => s + (t.allCount ?? t.count), 0);
  const showTabs = tabs.length > 1;
  const tabsHtml = showTabs ? `
    <div class="vtt-aopt-tabs" role="tablist" aria-label="Catégories d'actions">
      <button type="button" class="vtt-aopt-tab is-active" data-tab="__all" style="--tab-col:#f59e0b"
        data-vtt-fn="_vttAoptFilter" data-vtt-args="__all|$this" role="tab" aria-selected="true">
        <span class="vtt-aopt-tab-ic">⚡</span>
        <span class="vtt-aopt-tab-lbl">Tous</span>
        <span class="vtt-aopt-tab-cnt">${totalCount}</span>
      </button>
      ${tabs.map(t => `
        <button type="button" class="vtt-aopt-tab" data-tab="${t.id}"
          style="--tab-col:${t.color}"
          data-vtt-fn="_vttAoptFilter" data-vtt-args="${t.id}|$this" role="tab" aria-selected="false">
          <span class="vtt-aopt-tab-ic">${t.icon}</span>
          <span class="vtt-aopt-tab-lbl">${_esc(t.title)}</span>
          <span class="vtt-aopt-tab-cnt">${t.count}</span>
        </button>`).join('')}
    </div>` : '';

  // En combat, les joueurs sont limités à leur Deck préparé : l'onglet « Tous les
  // sorts » est verrouillé (le MJ garde l'accès complet).
  const scopeLocked = inCombat && !STATE.isAdmin;
  const spellScopeHtml = showSpellScope ? `
    <div class="vtt-aopt-spell-scope" role="group" aria-label="Sorts affichés">
      <span class="vtt-aopt-spell-scope-label">Sorts affichés</span>
      <button type="button" class="vtt-aopt-spell-scope-btn is-active" data-spell-scope="deck"
        data-vtt-fn="_vttAoptSpellScope" data-vtt-args="deck|$this" aria-pressed="true">
        <span>⚡ Deck</span><b>${deckSpellCount}</b>
      </button>
      <button type="button" class="vtt-aopt-spell-scope-btn${scopeLocked ? ' is-locked' : ''}" data-spell-scope="all"
        ${scopeLocked
          ? 'disabled title="En combat, tu es limité aux sorts préparés dans ton Deck"'
          : 'data-vtt-fn="_vttAoptSpellScope" data-vtt-args="all|$this"'} aria-pressed="false">
        <span>${scopeLocked ? '🔒' : '✨'} Tous les sorts</span><b>${allSpellCount}</b>
      </button>
    </div>` : '';

  const searchHtml = allActionsCount >= 6 ? `
    <div class="vtt-aopt-search">
      <span class="vtt-aopt-search-ic">🔍</span>
      <input type="text" class="vtt-aopt-search-input" placeholder="Filtrer par nom…"
        data-vtt-fn="_vttAoptSearch" data-vtt-on="input" data-vtt-args="$value|$this" autofocus>
      <button type="button" class="vtt-aopt-search-clr" title="Effacer"
        data-vtt-fn="_vttClearAoptSearch" data-vtt-args="$this">✕</button>
    </div>` : '';

  const _tokenFace = (token, live, role, tone = '') => {
    const name = live?.displayName ?? token?.name ?? 'Token';
    const img = live?.displayImage || token?.imageUrl || '';
    const initial = String(name || '?').trim().slice(0, 1).toUpperCase() || '?';
    return `<span class="vtt-aopt-actor ${tone}">
      <span class="vtt-aopt-actor-avatar">
        ${img ? `<img src="${_esc(img)}" alt="">` : `<b>${_esc(initial)}</b>`}
      </span>
      <span class="vtt-aopt-actor-copy">
        <small>${_esc(role)}</small>
        <strong title="${_esc(name)}">${_esc(name)}</strong>
      </span>
    </span>`;
  };
  const sourceFace = _tokenFace(src, lS, 'Lanceur');
  const targetFace = noTgt
    ? `<span class="vtt-aopt-actor vtt-aopt-actor--pending">
        <span class="vtt-aopt-actor-avatar">?</span>
        <span class="vtt-aopt-actor-copy"><small>Cible</small><strong>À choisir</strong></span>
      </span>`
    : _tokenFace(tgt, lT, selfTarget ? 'Sur soi' : 'Cible', 'vtt-aopt-actor--target');

  const innerHtml = `
      <div class="vtt-aopt-modal-hd">
        <div class="vtt-aopt-modal-targets">
          ${sourceFace}
          <span class="vtt-aopt-modal-arrow">→</span>
          ${targetFace}
        </div>
        ${noTgt
          ? `<span class="vtt-aopt-modal-dist" title="Choisis l'action puis clique une cible">🎯 puis clique une cible</span>`
          : `<span class="vtt-aopt-modal-dist" title="Distance source → cible">📏 ${dist}c</span>`}
      </div>
      ${pmBar}${resPmBars}
      ${spellScopeHtml}
      ${tabsHtml}
      ${noTgt ? searchHtml.replace(' autofocus', '') : searchHtml}
      <div class="vtt-aopt-list cs-v3">${optsHtml}${basicHtml}
        <div class="vtt-aopt-empty" hidden><span style="opacity:.5">Aucune action ne correspond.</span></div>
      </div>`;

  // Pips d'économie d'action — UNIQUEMENT en combat, où l'état est réellement suivi
  // sur le token (attackedThisTurn / bonusActionThisTurn / reactionThisTurn, remis à
  // zéro à chaque tour par vtt-combat-turns.js). Hors combat : pas de pips (ornement).
  // « on » = ressource dispo (barre colorée), « used » = dépensée (atténuée).
  const _ecoPip = (spent, label, col) =>
    `<span class="vtt-aopt-econ-pip ${spent ? 'is-used' : 'is-on'}" style="--c:${col}"><s>${label}</s><em></em></span>`;
  const econPips = inCombat ? `
    <div class="vtt-aopt-econ" role="group" aria-label="Économie d'action">
      ${_ecoPip(src.attackedThisTurn, 'Action', 'var(--amber)')}
      ${_ecoPip(src.bonusActionThisTurn, 'Bonus', 'var(--ember)')}
      ${_ecoPip(src.reactionThisTurn, 'Réaction', 'var(--arcane)')}
    </div>` : '';

  const ctrlHtml = (tabsHtml || searchHtml || spellScopeHtml)
    ? `<div class="vtt-aopt-ctrl">${tabsHtml}${searchHtml}${spellScopeHtml}</div>`
    : '';

  const modalInnerHtml = `
    <div class="vtt-aopt-banner">
      <div class="vtt-aopt-banner-duel">
        ${sourceFace}
        <span class="vtt-aopt-banner-arrow">→</span>
        ${targetFace}
        <span class="vtt-aopt-banner-dist" title="${selfTarget ? 'Action sur soi' : 'Distance source → cible'}">${selfTarget ? '◉ Sur soi' : `📏 ${dist} case${dist > 1 ? 's' : ''} · à portée`}</span>
      </div>
      ${(resGaugesHtml || econPips) ? `<div class="vtt-aopt-banner-res" style="flex-direction:column;align-items:stretch;gap:8px">${resGaugesHtml}${econPips}</div>` : ''}
    </div>
    ${ctrlHtml}
    <div class="vtt-aopt-list vtt-action-list cs-v3">${optsHtml}${basicHtml}
      <div class="vtt-aopt-empty" hidden><span style="opacity:.5">Aucune action ne correspond.</span></div>
    </div>`;

  // Flux « action d'abord » (sans cible) → HUD docké en bas du canvas.
  // Flux « clic sur une cible » → modale centrée (inchangé).
  if (noTgt) {
    _showActionHud(`<div class="vtt-form vtt-aopt-modal vtt-aopt-hud">
      <button type="button" class="vtt-aopt-hud-toggle" title="Replier / déplier les actions" data-vtt-fn="_vttToggleHudCollapse">▾</button>
      <button type="button" class="vtt-aopt-hud-close" title="Fermer" data-vtt-fn="_hideActBar">✕</button>
      ${innerHtml}</div>`);
    _vttAoptApplyFilters(document.querySelector('#vtt-action-hud .vtt-aopt-modal'));
    return;
  }

  openModal('⚔️ Action tactique', `
    <div class="vtt-form vtt-aopt-modal vtt-action-modal">${modalInnerHtml}
      <div class="vtt-aopt-footer">
        <span class="vtt-aopt-footer-recap" data-aopt-recap>Choisis une action — survole pour prévisualiser son coût.</span>
        <span class="vtt-aopt-footer-keys" aria-hidden="true"><span><kbd>1</kbd>–<kbd>9</kbd> choisir</span><span><kbd>↑↓</kbd> naviguer</span><span><kbd>⏎</kbd> lancer</span></span>
        <button class="btn-secondary" data-vtt-fn="_closeActionModal">Annuler</button>
        <button type="button" class="btn-primary vtt-aopt-launch" data-aopt-launch disabled>Lancer</button>
      </div>
    </div>`);
  setModalCloseGuard(() => { _restoreAttackSourceSelection(); return false; });
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
  const _aoptRoot = document.querySelector('#modal-box .vtt-aopt-modal');
  _vttAoptApplyFilters(_aoptRoot);
  _vttAoptBindControls(_aoptRoot);
}

/**
 * Clavier + sélection + prévisualisation du coût pour la modale ciblée.
 * Interaction hybride : clic sur une carte = lancement direct (via son
 * data-vtt-fn, inchangé) ; clavier = sélection puis ⏎ pour lancer.
 *   1–9 : sélectionne la n-ième carte visible · ↑↓ : navigue la sélection ·
 *   / : focus recherche · ⏎ : lance la carte sélectionnée · Échap : désélectionne
 *   puis ferme. Survol d'une carte → fantôme du coût sur la jauge de mana.
 * Écoute au niveau document seulement tant que la modale est montée ; le handler
 * s'auto-retire dès que la racine quitte le DOM (fermeture, réouverture).
 */
function _vttAoptBindControls(root) {
  if (!root || root._aoptCtrlBound) return;
  root._aoptCtrlBound = true;

  const launchBtn = root.querySelector('[data-aopt-launch]');
  const recap = root.querySelector('[data-aopt-recap]');
  const gauges = Array.from(root.querySelectorAll('[data-aopt-res]'));
  const searchInput = root.querySelector('.vtt-aopt-search-input');

  // Cartes sélectionnables/lançables = cartes d'action visibles et non en recharge.
  const cards = () => Array.from(root.querySelectorAll('.vtt-action-choice'))
    .filter(c => !c.hidden && c.offsetParent !== null && !c.disabled && !c.classList.contains('is-cooldown'));

  // Numérote les 9 premières cartes visibles (badge de raccourci 1–9) ; vide les
  // autres. À rejouer après chaque filtre car l'ordre visible change.
  const renumber = () => {
    const vis = cards();
    root.querySelectorAll('.vtt-action-choice-key').forEach(k => { k.textContent = ''; });
    vis.slice(0, 9).forEach((c, n) => {
      const k = c.querySelector('.vtt-action-choice-key');
      if (k) k.textContent = String(n + 1);
    });
  };

  // Aperçu du coût sur la jauge de la ressource concernée : fantôme (segment rouge
  // ancré à droite) + lecture « −X » + reliquat sur la valeur. Toutes les autres
  // jauges sont remises à neutre. `resId` = ressource débitée (pm/pv/garde/or).
  const setGhost = (cost, resId) => {
    gauges.forEach(g => {
      const cur = +g.dataset.cur || 0;
      const max = +g.dataset.max || 0;
      const on = !!resId && g.dataset.aoptRes === resId && cost > 0;
      const ghost = g.querySelector('.vtt-aopt-mana-ghost');
      const costOut = g.querySelector('.vtt-aopt-mana-cost');
      const now = g.querySelector('.vtt-aopt-mana-now');
      if (ghost) {
        ghost.style.width = (on && max > 0) ? `${(Math.min(cur, cost) / max) * 100}%` : '0';
        ghost.classList.toggle('is-over', on && cost > cur);
      }
      if (costOut) {
        costOut.textContent = on ? `−${cost}` : '';
        costOut.hidden = !on;
        costOut.classList.toggle('is-over', on && cost > cur);
      }
      if (now) {
        now.textContent = on ? String(Math.max(0, cur - cost)) : g.dataset.cur;
        now.classList.toggle('is-preview', on);
      }
    });
  };

  // Nom de la cible (pour le récap) lu depuis le bandeau.
  const targetName = root.querySelector('.vtt-aopt-actor--target .vtt-aopt-actor-copy strong')?.textContent?.trim();

  const selected = () => root.querySelector('.vtt-action-choice.sel');
  const select = (card) => {
    if (!card) return;
    cards().forEach(c => { if (c !== card) c.classList.remove('sel'); });
    card.classList.add('sel');
    card.scrollIntoView({ block: 'nearest' });
    setGhost(+card.dataset.cost || 0, card.dataset.costRes);
    const name = card.querySelector('.vtt-action-choice-name')?.textContent?.trim() || 'Action';
    const kind = card.querySelector('.vtt-action-choice-kind')?.textContent?.trim() || '';
    const cost = card.querySelector('.vtt-aopt-cost')?.textContent?.trim() || '';
    const oor = card.classList.contains('is-oor');
    if (launchBtn) {
      launchBtn.disabled = false;
      launchBtn.classList.toggle('is-oor', oor);
      launchBtn.textContent = `Lancer ${name}`;
    }
    if (recap) {
      const bits = [`<strong>${_esc(name)}</strong>`];
      if (kind) bits.push(_esc(kind));
      if (cost) bits.push(_esc(cost));
      if (targetName) bits.push(`sur ${_esc(targetName)}`);
      recap.innerHTML = bits.join('<span class="vtt-aopt-footer-dot"></span>') +
        (oor ? ' <em class="vtt-aopt-footer-warn">hors portée</em>' : '');
    }
  };
  const clearSel = () => {
    const c = selected();
    if (c) c.classList.remove('sel');
    setGhost(0, '');
    if (launchBtn) { launchBtn.disabled = true; launchBtn.classList.remove('is-oor'); launchBtn.textContent = 'Lancer'; }
    if (recap) recap.textContent = 'Choisis une action — survole pour prévisualiser son coût.';
  };
  const launch = (card) => { if (card && !card.disabled && !card.hidden && card.offsetParent !== null) card.click(); };

  // Survol : prévisualise le coût de la carte survolée ; au départ, on restaure le
  // fantôme de la carte sélectionnée (ou on masque).
  root.addEventListener('mouseover', (e) => {
    const card = e.target.closest?.('.vtt-action-choice');
    if (card && root.contains(card)) setGhost(+card.dataset.cost || 0, card.dataset.costRes);
  });
  root.addEventListener('mouseout', (e) => {
    if (e.target.closest?.('.vtt-action-choice')) {
      const sel = selected();
      setGhost(sel ? (+sel.dataset.cost || 0) : 0, sel ? sel.dataset.costRes : '');
    }
  });

  if (launchBtn) launchBtn.addEventListener('click', () => launch(selected()));

  // Re-numéroter après un filtre (clic onglet / portée) ou une recherche. On
  // laisse d'abord le filtre s'appliquer (dispatch VTT synchrone → rAF suffit).
  const reflow = () => requestAnimationFrame(() => {
    renumber();
    const sel = selected();
    if (sel && (sel.hidden || sel.offsetParent === null)) clearSel();
  });
  root.querySelector('.vtt-aopt-ctrl')?.addEventListener('click', (e) => {
    if (e.target.closest('.vtt-aopt-tab, .vtt-aopt-spell-scope-btn')) reflow();
  });
  searchInput?.addEventListener('input', reflow);
  renumber();

  const onKey = (e) => {
    // Auto-nettoyage : la modale a été fermée/réouverte.
    if (!document.body.contains(root)) { document.removeEventListener('keydown', onKey, true); return; }
    // Ne rien intercepter hors de cette modale (une autre modale pourrait être au-dessus).
    if (document.querySelector('#modal-box .vtt-aopt-modal') !== root) return;
    const typing = document.activeElement === searchInput;

    if (e.key === '/' && !typing) { e.preventDefault(); searchInput?.focus(); return; }
    if (e.key === 'Escape') {
      if (selected()) { e.preventDefault(); e.stopPropagation(); clearSel(); return; }
      return; // sinon : laisse la modale se fermer normalement
    }
    if (typing && e.key !== 'Enter' && !e.key.startsWith('Arrow')) return;

    const list = cards();
    if (!list.length) return;
    const cur = selected();
    const idx = cur ? list.indexOf(cur) : -1;

    if (/^[1-9]$/.test(e.key) && !typing) {
      const n = +e.key - 1;
      if (n < list.length) { e.preventDefault(); select(list[n]); }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault(); select(list[Math.min(list.length - 1, idx < 0 ? 0 : idx + 1)]); return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault(); select(list[Math.max(0, idx < 0 ? 0 : idx - 1)]); return;
    }
    if (e.key === 'Enter') {
      if (cur) { e.preventDefault(); launch(cur); }
    }
  };
  document.addEventListener('keydown', onKey, true);
}

/** Filtre les sections du picker d'actions par tab. '__all' = tout afficher. */
function _vttAoptFilter(tabId, btn) {
  const root = btn?.closest('.vtt-aopt-modal') || document.querySelector('.vtt-aopt-modal');
  if (!root) return;
  root.querySelectorAll('.vtt-aopt-tab').forEach((b) => {
    const active = b === btn;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  _vttAoptApplyFilters(root);
}

/** Filtre les options du picker par texte (cherche dans data-name). */
function _vttAoptSearch(raw, input) {
  const root = input?.closest('.vtt-aopt-modal') || document.querySelector('.vtt-aopt-modal');
  if (root) _vttAoptApplyFilters(root, raw);
}

/** Bascule entre les seuls sorts préparés et tout le grimoire validé. */
function _vttAoptSpellScope(scope, btn) {
  const root = btn?.closest('.vtt-aopt-modal') || document.querySelector('.vtt-aopt-modal');
  if (!root) return;
  root.querySelectorAll('.vtt-aopt-spell-scope-btn').forEach((b) => {
    const active = b.dataset.spellScope === scope;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  _vttAoptApplyFilters(root);
}

/** Applique ensemble catégorie, recherche et portée Deck/Tous les sorts. */
function _vttAoptApplyFilters(root, searchValue) {
  if (!root) return;
  const activeTab = root.querySelector('.vtt-aopt-tab.is-active')?.dataset.tab || '__all';
  const spellScope = root.querySelector('.vtt-aopt-spell-scope-btn.is-active')?.dataset.spellScope || 'deck';
  const rawSearch = searchValue ?? root.querySelector('.vtt-aopt-search-input')?.value ?? '';
  const q = _norm(rawSearch);
  let totalVisible = 0;

  root.querySelectorAll('.vtt-aopt-section').forEach((section) => {
    let sectionVisible = 0;
    section.querySelectorAll('.vtt-aopt').forEach((action) => {
      const matchesDeck = spellScope === 'all' || action.dataset.deckState !== 'out';
      const matchesSearch = !q || (action.dataset.name || '').includes(q);
      const visible = matchesDeck && matchesSearch;
      action.hidden = !visible;
      if (visible) sectionVisible++;
    });

    const inTab = activeTab === '__all' || section.dataset.tabId === activeTab;
    section.hidden = !inTab || sectionVisible === 0;
    if (inTab) totalVisible += sectionVisible;

    const count = section.querySelector('.vtt-aopt-section-count');
    if (count) count.textContent = sectionVisible;
    const sectionTab = [...root.querySelectorAll('.vtt-aopt-tab')]
      .find(tab => tab.dataset.tab === section.dataset.tabId);
    const tabCount = sectionTab?.querySelector('.vtt-aopt-tab-cnt');
    if (tabCount) tabCount.textContent = sectionVisible;
  });

  const allTabCount = root.querySelector('.vtt-aopt-tab[data-tab="__all"] .vtt-aopt-tab-cnt');
  if (allTabCount) {
    allTabCount.textContent = [...root.querySelectorAll('.vtt-aopt-section')]
      .reduce((sum, section) => sum + [...section.querySelectorAll('.vtt-aopt')].filter(action => !action.hidden).length, 0);
  }
  const actionCount = root.querySelector('.vtt-action-count');
  if (actionCount) actionCount.textContent = `${totalVisible} choix`;
  _vttAoptCheckEmpty(root);
}

function _vttAoptCheckEmpty(root = document) {
  const list = root.querySelector('.vtt-aopt-list');
  const empty = root.querySelector('.vtt-aopt-empty');
  if (!list || !empty) return;
  const anyVisible = !![...list.querySelectorAll('.vtt-aopt-section')].find(section => !section.hidden);
  empty.hidden = anyVisible;
}

// Mode de lancer : 3 pastilles inline (− • +) posées sur la ligne de toucher.
// Ids atk-mode-dis/-normal/-adv conservés (bascule is-active/aria-pressed par _vttSetMode).
function _vttAttackModeControlsHtml() {
  const b = (m, sym, title) =>
    `<button type="button" id="atk-mode-${m}" class="vtt-atk-mode-btn${m === 'normal' ? ' is-active' : ''}" data-m="${m}" data-vtt-fn="_vttSetMode" data-vtt-args="${m}" aria-pressed="${m === 'normal'}" title="${title}">${sym}</button>`;
  return `<span class="vtt-atk-mode" role="group" aria-label="Mode de lancer">${b('dis', '−', 'Désavantage — garde le plus bas')}${b('normal', '•', 'Normal — 1d20')}${b('adv', '+', 'Avantage — garde le plus haut')}</span>`;
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
    else if (td.characterId) prof = getCharFullDamageProfile(STATE.characters.find(x => x.id === td.characterId));
    if (!prof) continue;
    const inter = previewDamageInteraction(opt.damageTypeId, prof);
    if (inter) buckets[inter] = (buckets[inter] || 0) + 1;
  }
  const entries = Object.entries(buckets);
  if (!entries.length) return '';
  const isMulti = tids.length > 1;
  // Puces d'interaction (couleur = type d'interaction, pilotée par les données —
  // pas une couleur inventée) intégrées à la bande de notes.
  return entries.map(([label, n]) => {
    const meta = DAMAGE_INTERACTIONS[label] || { icon: 'ℹ️', color: 'var(--text-muted)', short: '' };
    return `<span class="vtt-atk-note" style="color:${meta.color};border-color:color-mix(in srgb,${meta.color} 45%,transparent);background:color-mix(in srgb,${meta.color} 12%,transparent)">🎯 ${meta.icon} ${_esc(label)}${isMulti ? ` ×${n}` : ''}${meta.short ? ` · ${meta.short}` : ''}</span>`;
  }).join('');
}

// « Dégâts sur un raté » (½ / complets) : la résolution commune tient compte de
// l'arme, du sort ET du type élémentaire. Les attaques du bestiaire suivent donc
// les mêmes règles que celles des personnages.
function _effectiveMissEffect(opt) {
  return getAttackMissEffect(opt, VS.damageTypes);
}

// Note « ½ / dégâts complets même en cas d'échec » selon la règle configurée.
function _atkMissNoteHtml(opt) {
  const me = _effectiveMissEffect(opt);
  if (me === 'full') {
    return `<span class="vtt-atk-note weak">✦ Échec : dégâts complets · échec critique : 0</span>`;
  }
  if (me === 'half' || opt?.pmCost > 0) {
    return `<span class="vtt-atk-note free">◐ Échec : ½ dégâts · échec critique : 0${me !== 'half' && opt?.pmCost > 0 ? ' · mana consommé' : ''}</span>`;
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
  document.querySelectorAll('.vtt-atk-elem').forEach(b => {
    b.classList.toggle('is-active', b.dataset.vttArgs === elemId);
  });
  const ic = document.getElementById('atk-dmgtype-ic');
  if (ic) { ic.textContent = t?.icon || ''; ic.style.color = t?.color || '#9ca3af'; }
  const inter = document.getElementById('atk-interaction');
  if (inter) inter.innerHTML = _atkInteractionHtml(ctx.opt);
  const miss = document.getElementById('atk-miss-note');
  if (miss) miss.innerHTML = _atkMissNoteHtml(ctx.opt);
  // Une technique élémentaire dépend du type actuellement choisi. On conserve
  // une technique d'arme, mais on retire proprement celle de l'ancien élément.
  const choices = _vttAttackTechniques(ctx.opt);
  if (ctx.damageTechnique && !choices.some(choice => choice._choiceId === ctx.damageTechnique._choiceId)) {
    ctx.damageTechnique = null;
  }
  const techniqueSlot = document.getElementById('atk-techniques-slot');
  if (techniqueSlot) techniqueSlot.innerHTML = _vttWeaponTechniquesHtml(ctx.opt);
}

function _weaponTechniqueEffectParts(technique) {
  if (!technique) return [];
  const parts = [];
  const triggers = { hit: 'sur touche', miss: 'sur échec', crit: 'sur critique', always: 'toujours' };
  parts.push(triggers[technique.trigger] || 'sur touche');
  if (technique.allowWithAbilities !== false) parts.push('sorts/compétences autorisés');
  if (technique.trigger === 'hit') {
    const missLabels = {
      none: 'aucun effet sur échec',
      half: 'effets + ½ dégâts sur échec',
      full: 'effets complets sur échec',
    };
    parts.push(missLabels[technique.missEffectMode] || missLabels.none);
  }
  if (technique.defenseBonus > 0) parts.push(`CA cible +${technique.defenseBonus}`);
  if (technique.attackModifier) parts.push(`${technique.attackModifier > 0 ? '+' : ''}${technique.attackModifier} au toucher`);
  if (technique.extraWeaponDice > 0) parts.push(`+${technique.extraWeaponDice} dé${technique.extraWeaponDice > 1 ? 's' : ''} d'arme`);
  if (technique.extraDamageFormula) parts.push(`+${technique.extraDamageFormula}`);
  if (technique.addWeaponModifier) parts.push('+ mod. de l’arme');
  if (technique.extraDamageFlat > 0) parts.push(`+${technique.extraDamageFlat} dégâts`);
  if (technique.damageTypeId) parts.push(`type ${getDamageTypeById(VS.damageTypes, technique.damageTypeId)?.label || technique.damageTypeId}`);
  if (technique.criticalMode === 'double') parts.push('bonus ×2 sur critique');
  if (technique.scalingMode !== 'none' && technique.scalingFormula) parts.push(`progression ${technique.scalingFormula} / ${technique.scalingEvery}`);
  if (technique.blastRadius > 0) {
    const shapes = { square: 'carré', circle: 'cercle', line: 'ligne', cone: 'cône' };
    parts.push(`${shapes[technique.areaShape] || 'zone'} · rayon ${technique.blastRadius}`);
  }
  if (technique.conditionId) parts.push(`état ${CONDITION_BY_ID[technique.conditionId]?.label || technique.conditionId}`);
  if (technique.forcedMovement !== 'none' && technique.forcedMovementDistance > 0) parts.push(`${technique.forcedMovement === 'pull' ? 'attire' : 'pousse'} ${technique.forcedMovementDistance}c`);
  if (technique.resourceType !== 'none' && technique.resourceCost > 0) parts.push(`${technique.resourceCost} ${_RES_LABEL[technique.resourceType] || technique.resourceType}`);
  if (technique.maxUses > 0 && technique.usageScope !== 'none') parts.push(`${technique.maxUses}/${technique.usageScope === 'combat' ? 'combat' : 'session'}`);
  if (technique.cooldownRounds > 0) parts.push(`recharge ${technique.cooldownRounds}t`);
  if (technique.onHitEffect) parts.push(technique.onHitEffect);
  return parts;
}

function _vttTechniqueKey(technique) {
  return String(technique?._choiceId || `${technique?._source || 'weapon'}:${technique?.id || 'technique'}`)
    .replace(/[^a-z0-9:_-]/gi, '_');
}

function _vttTechniqueAvailability(technique, src) {
  if (!technique || !src) return { available: true, remaining: null, cooldown: 0 };
  const key = _vttTechniqueKey(technique);
  const round = Math.max(0, parseInt(VS.session?.combat?.round, 10) || 0);
  const readyRound = parseInt(src.techniqueCooldowns?.[key], 10) || 0;
  const cooldown = VS.session?.combat?.active ? Math.max(0, readyRound - round) : 0;
  let remaining = null;
  if (technique.maxUses > 0 && technique.usageScope === 'combat' && VS.session?.combat?.active) {
    const sameCombat = src.techniqueCombatKey === VS.session?.combat?.techniqueCombatKey;
    const used = sameCombat ? (parseInt(src.techniqueCombatUses?.[key], 10) || 0) : 0;
    remaining = Math.max(0, technique.maxUses - used);
  } else if (technique.maxUses > 0 && technique.usageScope === 'session') {
    const sessionKey = VS.session?.techniqueSessionKey || 'legacy';
    const sameSession = src.techniqueSessionKey === sessionKey;
    const used = sameSession ? (parseInt(src.techniqueSessionUses?.[key], 10) || 0) : 0;
    remaining = Math.max(0, technique.maxUses - used);
  }
  return { available: cooldown <= 0 && (remaining == null || remaining > 0), remaining, cooldown };
}

function _vttAttackTechniques(opt) {
  const ability = opt?.sortIdx !== undefined || !!opt?._itemAction || !!opt?._npcAction || !!opt?._summonAction;
  const weapon = (Array.isArray(opt?.weaponTechniques) ? opt.weaponTechniques : [])
    .filter(technique => technique?.label && techniqueAllowedForAction(technique, { ability }))
    .map(technique => ({ ...technique, _source: 'weapon', _choiceId: `weapon:${technique.id}` }));
  const damageType = getDamageTypeById(VS.damageTypes, opt?.damageTypeId);
  const elemental = (Array.isArray(damageType?.techniques) ? damageType.techniques : [])
    .filter(technique => technique?.label && techniqueAllowedForAction(technique, { ability }))
    .map(technique => ({
      ...technique,
      _source: 'damage-type',
      _sourceLabel: damageType.label || opt?.damageTypeId || 'Élément',
      _choiceId: `damage:${damageType.id}:${technique.id}`,
    }));
  return [...weapon, ...elemental];
}

function _vttWeaponTechniquesHtml(opt) {
  const techniques = _vttAttackTechniques(opt);
  if (!techniques.length) return '';
  const renderGroup = (sourceKey, label) => {
    const group = techniques.filter(technique => technique._source === sourceKey);
    if (!group.length) return '';
    const selected = sourceKey === 'weapon' ? _atkCtx?.weaponTechnique : _atkCtx?.damageTechnique;
    return `<div class="vtt-atk-optrow vtt-atk-techniques" data-technique-source="${sourceKey}" role="group" aria-label="${_esc(label)} optionnelle">
      <b>${_esc(label)}</b>
      ${group.map(t => {
        const detail = [t.description, ..._weaponTechniqueEffectParts(t)].filter(Boolean).join(' · ');
        const source = t._source === 'damage-type' ? `${t._sourceLabel} · ` : '';
        const active = selected?._choiceId === t._choiceId;
        const availability = _vttTechniqueAvailability(t, VS.tokens[_atkCtx?.srcId]?.data);
        const availabilityLabel = availability.cooldown > 0 ? ` · recharge ${availability.cooldown}t`
          : availability.remaining != null ? ` · ${availability.remaining}/${t.maxUses}` : '';
        return `<button type="button" class="vtt-atk-pick vtt-atk-technique-choice ${active ? 'is-active' : ''}" style="--ec:${t._source === 'damage-type' ? (opt.damageTypeColor || '#f97316') : 'var(--amber)'}" data-technique-id="${_esc(t._choiceId)}"
          data-vtt-fn="_vttSetWeaponTechnique" data-vtt-args="${sourceKey}|${_esc(t._choiceId)}" aria-pressed="${active ? 'true' : 'false'}"
          ${availability.available ? '' : 'disabled aria-disabled="true"'} title="${_esc(`${source}${detail || t.label}${availabilityLabel}`)}">${_esc(t.icon || '🎯')} ${_esc(t.label)}${availabilityLabel}</button>`;
      }).join('')}
      <em>1 choix dans cette famille · cumulable avec l’autre</em>
    </div>`;
  };
  return `${renderGroup('weapon', 'Technique d’arme')}${renderGroup('damage-type', 'Technique élémentaire')}`;
}

function _vttSetWeaponTechnique(sourceKey, techniqueId) {
  const ctx = _atkCtx;
  if (!ctx?.opt) return;
  const source = sourceKey === 'damage-type' ? 'damage-type' : 'weapon';
  const stateKey = source === 'damage-type' ? 'damageTechnique' : 'weaponTechnique';
  const id = String(techniqueId || '');
  const clicked = _vttAttackTechniques(ctx.opt)
    .find(technique => technique._source === source && technique._choiceId === id) || null;
  if (clicked && !_vttTechniqueAvailability(clicked, VS.tokens[ctx.srcId]?.data).available) {
    showNotif('Cette technique n’est pas encore disponible.', 'warning');
    return;
  }
  ctx[stateKey] = clicked && ctx[stateKey]?._choiceId !== clicked._choiceId ? clicked : null;
  const section = document.querySelector(`.vtt-atk-techniques[data-technique-source="${source}"]`);
  section?.classList.toggle('has-technique', !!ctx[stateKey]);
  section?.querySelectorAll('.vtt-atk-technique-choice').forEach(btn => {
    const active = btn.dataset.techniqueId === ctx[stateKey]?._choiceId;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function _vttTechniqueSplashTargets(technique, originIds, srcId) {
  if (!technique || (parseInt(technique.blastRadius, 10) || 0) <= 0) return [];
  const src = VS.tokens[srcId]?.data;
  const origins = (originIds || []).map(id => VS.tokens[id]?.data).filter(Boolean);
  if (!src || !origins.length) return [];
  const excluded = new Set(originIds || []);
  if (!technique.includeCaster) excluded.add(srcId);
  const srcDims = _tokenDims(src);
  const sourceRect = { col: src.col, row: src.row, width: srcDims.w, height: srcDims.h };
  const srcEnemy = src.type === 'enemy';
  return Object.entries(VS.tokens)
    .filter(([id, entry]) => {
      const candidate = entry?.data;
      if (!candidate || excluded.has(id) || candidate.pageId !== VS.activePage?.id) return false;
      if (!candidate.visible && !STATE.isAdmin) return false;
      const candidateEnemy = candidate.type === 'enemy';
      if (technique.areaTargets === 'enemies' && candidateEnemy === srcEnemy) return false;
      if (technique.areaTargets === 'allies' && candidateEnemy !== srcEnemy) return false;
      const candidateDims = _tokenDims(candidate);
      const candidateRect = { col: candidate.col, row: candidate.row, width: candidateDims.w, height: candidateDims.h };
      return origins.some(aim => {
        const aimDims = _tokenDims(aim);
        const aimRect = { col: aim.col, row: aim.row, width: aimDims.w, height: aimDims.h };
        const originRect = technique.areaOrigin === 'caster' ? sourceRect : aimRect;
        return techniqueAreaIntersects({ origin: originRect, candidate: candidateRect, source: sourceRect, aim: aimRect }, technique);
      });
    })
    .map(([id]) => id);
}

function _vttPickOpt(srcId, tgtId, idx) {
  const opt = _atkOptsCache[`${srcId}__${tgtId}`]?.[+idx];
  if (!opt) return;
  if ((opt.cooldownRemaining || 0) > 0) {
    showNotif(`Sort en recharge (${opt.cooldownRemaining} tour${opt.cooldownRemaining > 1 ? 's' : ''}).`, 'warning');
    return;
  }
  // Mémorise la modale d'action pour pouvoir y revenir si on annule le sort à une
  // étape suivante (placement de zone, ciblage, déplacement). Pas sur une ré-entrée
  // depuis une validation (_mtPending) : on garde la modale d'origine.
  if (!_mtPending) _actModalReturn = { srcId, tgtId };
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

  const dist    = _tokenAttackDistance(src, tgt);
  const combatStyle = _combatStyleContext(src, tgt, opt);
  _atkCtx = { srcId, tgtId, opt, lS, lT, allTargets, sigil: _sigil, weaponTechnique: null, damageTechnique: null, combatStyle };
  // Bonus toucher d'enchantement — lu frais sur le lanceur (jamais figé dans l'option)
  const _touchBuff = _touchBuffOf(src);
  const atkBase = (opt.toucher !== null && opt.toucher !== undefined ? opt.toucher : (lS.displayAttack ?? 5)) + _touchBuff;
  const sn      = n => n>0?`+${n}`:n<0?`${n}`:'';
  const tag     = (txt, col='var(--text-dim)') =>
    `<span style="font-size:.6rem;color:${col};margin-left:.05rem">(${txt})</span>`;

  // ── Cellule formule : ligne principale "dés +TOTAL" + petite légende du détail ──
  // Évite les longues lignes "1d6 +6 (Int) +2 (Maîtrise)" qui cassaient la mise en
  // forme : le total est regroupé, la provenance passe en sous-ligne discrète.
  // Rendu façon maquette « table de jet » : formule (dés mono) sur une ligne, la
  // provenance passe en sous-ligne LISIBLE (--text-muted, pas --text-dim minuscule).
  // Le calcul (leadHtml, total, parts) reste inchangé — seule la présentation change.
  const _mkCell = (leadHtml, total, parts, totalCol) => {
    const totStr = total ? ` <span class="vtt-atk-mod" style="color:${totalCol}">${sn(total)}</span>` : '';
    const bd = parts.filter(Boolean).join(' · ');
    return `<span class="vtt-atk-cell">
      <span class="vtt-atk-formula">${leadHtml}${totStr}</span>
      ${bd ? `<span class="vtt-atk-src">${bd}</span>` : ''}
    </span>`;
  };

  // ── Formule toucher ────────────────────────────────────────────────
  let toucherFormula;
  if (opt.toucherMod !== undefined) {
    const parts = []; let tot = 0;
    if (opt.toucherMod)        { tot += opt.toucherMod;      parts.push(`${opt.toucherStatLabel} ${sn(opt.toucherMod)}`); }
    if (opt.toucherSetBonus)   { tot += opt.toucherSetBonus; parts.push(`${opt.toucherSetBonusLabel || 'Set'} ${sn(opt.toucherSetBonus)}`); }
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
    if (opt.formulaFixedBonus) { tot += opt.formulaFixedBonus; parts.push(`Formule ${sn(opt.formulaFixedBonus)}`); }
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

  // Bloc central conditionnel selon le type
  const isCastOnly = opt.isCaSort || opt.isUtil;
  const btnColor   = opt.isHeal ? '#22c38e' : isCastOnly ? '#b47fff' : 'var(--gold,#f59e0b)';
  const btnFg      = opt.isHeal || isCastOnly ? '#fff' : '#1a1a1a';
  const btnLabel   = opt.isMana ? '💙 Régénérer !' : opt.isHeal ? '💚 Soigner !' : isCastOnly ? '✨ Activer !' : '🎲 Lancer !';
  // Champ de tiroir « Ajuster » (label + stepper). Ids INCHANGÉS : _vttRollAttack les
  // relit par getElementById ; le tiroir reste dans le DOM (masqué en CSS) une fois replié.
  const _bonusInput = (id, label, title, extra = '') => `
    <label class="vtt-atk-fld" title="${_esc(title)}">
      <span>${_esc(label)}</span>
      <span class="vtt-atk-step">
        <button type="button" data-vtt-fn="_vttAtkBonusStep" data-vtt-args="${id}|-1" data-vtt-blur title="Retirer 1">−</button>
        <input type="number" id="${id}" value="0" ${extra} data-vtt-fn="_vttRollAttack" data-vtt-on="keydown-enter">
        <button type="button" data-vtt-fn="_vttAtkBonusStep" data-vtt-args="${id}|1" data-vtt-blur title="Ajouter 1">+</button>
      </span>
    </label>`;
  // Ligne de jet compacte (maquette « table de jet ») : icône · libellé + formule +
  // provenance · (mode + Ajuster) ; tiroir de steppers replié dessous. `fields` présent
  // ⇒ ligne ajustable (bouton Ajuster + tiroir). `mode` = pastilles inline (ligne toucher).
  const _atkRow = ({ c, icon, label, formulaHtml, hint = '', mode = '', fields = '' }) => `
    <div class="vtt-atk-row" style="--c:${c}" data-atk-row>
      <span class="vtt-atk-rico">${icon}</span>
      <span class="vtt-atk-rbody">
        <span class="vtt-atk-rlbl">${_esc(label)}</span>
        ${formulaHtml}
        ${hint ? `<span class="vtt-atk-hint">${hint}</span>` : ''}
      </span>
      ${(mode || fields) ? `<span class="vtt-atk-rend">${mode}${fields ? `<button type="button" class="vtt-atk-adjbtn" data-atk-adj aria-expanded="false">Ajuster <s>▾</s></button>` : ''}</span>` : ''}
      ${fields ? `<div class="vtt-atk-drawer">${fields}<button type="button" class="vtt-atk-reset" data-vtt-fn="_vttAtkBonusReset" data-vtt-blur hidden>Réinitialiser</button></div>` : ''}
    </div>`;

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
    <div class="vtt-atk-optrow" role="group" aria-label="Élément">
      <b>Élément</b>
      ${_elemChoices.map(t => `<button type="button" class="vtt-atk-pick vtt-atk-elem ${t.id===opt.damageTypeId?'is-active':''}" style="--ec:${t.color||'#9ca3af'}" data-vtt-fn="_vttAtkSetElement" data-vtt-args="${t.id}" title="${_esc(t.label)}">${t.icon||''} ${_esc(t.label)}</button>`).join('')}
    </div>` : '';

  // ── Branches sans jet (Affliction / Enchantement) : une ligne d'effet + puces ──
  const _STAT_SH = { force:'For', dexterite:'Dex', constitution:'Con', intelligence:'Int', sagesse:'Sag', charisme:'Cha' };
  const isAffCast = !!opt.isAffliction;
  const isEnchCast = !!opt.isEnchant;
  let utilBlock = '';
  const utilNotes = [];   // puces fusionnées dans la bande de notes (JS, effet…)
  if (isAffCast) {
    const statLbl = (_STAT_SH[opt.afflictionSaveStat] || opt.afflictionSaveStat || 'Con').toUpperCase();
    const dd = opt.afflictionDD;
    const isEtat = opt.afflictionMode === 'etat' && opt.afflictionEtatId;
    const etat = isEtat ? CONDITION_BY_ID[opt.afflictionEtatId] : null;
    const lead = isEtat
      ? `<code>${etat ? `${etat.icon} ${_esc(etat.label)}` : 'État'}</code>`
      : `<code>🩸 ${_esc(opt.afflictionDotFormula || '')}</code>`;
    utilBlock = _atkRow({ c:'var(--crimson)', icon:opt.icon, label:'Sur échec du JS',
      formulaHtml:_mkCell(lead, 0, isEtat ? [] : ['par tour'], 'var(--crimson)') });
    utilNotes.push(['save', `🛡 JS ${statLbl} DD ${dd}`]);
    if (!isEtat) utilNotes.push(['weak', `🩸 DoT ${_esc(opt.afflictionDotFormula || '')}/tour`]);
  } else if (isEnchCast) {
    const isEtat = opt.enchantMode === 'etat' && opt.enchantEtatId;
    const etat = isEtat ? CONDITION_BY_ID[opt.enchantEtatId] : null;
    const effectLbl = isEtat ? (etat ? `${etat.icon} ${_esc(etat.label)}` : 'État')
      : opt.enchantMode === 'toucher'     ? `🎯 +${_esc(String(opt.mods?.enchantToucher?.bonus ?? '?'))} au toucher`
      : opt.enchantMode === 'deplacement' ? `👢 +${_esc(String(opt.mods?.enchantMove?.bonusCells ?? '?'))} déplacement`
      : `⚔️ +${_esc(opt.enchantFormula || '1d4+2')} / arme alliée`;
    utilBlock = _atkRow({ c:'var(--amber)', icon:opt.icon, label:"Buff sur l'allié — pas de JS",
      formulaHtml:_mkCell(`<code>${effectLbl}</code>`, 0, [], 'var(--amber)') });
  }

  // Champs de tiroir « Ajuster » par ligne de jet (ids inchangés).
  const _hitFields = `
    ${_bonusInput('atk-bonus-hit', 'Bonus au jet', 'Bonus / malus fixe ajouté au d20')}
    ${_bonusInput('atk-bonus-hit-dice', 'd20 en plus', 'd20 supplémentaires, sommés au résultat', 'min="-9" max="20"')}`;
  const _dmgFields = opt.isHeal ? `
    ${_bonusInput('atk-bonus-dmg', opt.isMana ? 'Bonus aux PM' : 'Bonus au soin', 'Bonus / malus fixe')}
    ${_bonusInput('atk-bonus-dmg-dice', opt.isMana ? 'Dés de PM' : 'Dés de soin', 'Dés supplémentaires, même type de dé', 'min="-9" max="20"')}`
    : `
    ${_bonusInput('atk-bonus-dmg', 'Bonus dégâts', 'Bonus / malus fixe aux dégâts')}
    ${_bonusInput('atk-bonus-dmg-dice', 'Dés en plus', 'Dés supplémentaires aux dégâts, même type de dé', 'min="-9" max="20"')}`;

  const centerBlock = (isAffCast || isEnchCast) ? utilBlock
    : isCastOnly ? _atkRow({ c:'var(--arcane)', icon:opt.icon, label:'Effet', formulaHtml:degatsFormula })
    : opt.isHeal ? `
      ${_atkRow({ c:'var(--gold)', icon:'🎯', label:opt.isMana ? 'Jet de régénération' : 'Jet de soin', formulaHtml:toucherFormula, hint:'DD 2 — sert surtout au critique / échec critique', mode:_vttAttackModeControlsHtml(), fields:_hitFields })}
      ${_atkRow({ c:'var(--emerald)', icon:opt.isMana ? '💙' : '💚', label:opt.isMana ? 'PM régénérés' : 'Soin produit', formulaHtml:degatsFormula, fields:_dmgFields })}
    ` : `
      ${_atkRow({ c:'var(--gold)', icon:'🎯', label:'Jet pour toucher', formulaHtml:toucherFormula, mode:_vttAttackModeControlsHtml(), fields:_hitFields })}
      ${_atkRow({ c:'var(--crimson)', icon:'⚔️', label:'Dégâts infligés', formulaHtml:degatsFormula, fields:_dmgFields })}
    `;

  const targetTone = opt.isHeal ? 'is-heal' : 'is-target';
  const _selfCast = tgtId === srcId;
  const _srcName = _esc(lS?.displayName ?? src?.name ?? 'Lanceur');
  const _tgtName = _esc((allTargets && allTargets.length > 1) ? `${allTargets.length} cibles` : (lT?.displayName ?? tgt?.name ?? 'Cible'));
  const _distTxt = _selfCast ? 'sur soi' : `${dist} case${dist > 1 ? 's' : ''}`;
  const _kindRaw = String(opt.actionType || opt.actionMode || opt.modeAction || opt._itemAction?.actionType || '').toLowerCase();
  const _typeTag = _kindRaw.includes('bonus') ? 'Action bonus' : (_kindRaw.includes('reac') || _kindRaw.includes('réac')) ? 'Réaction' : 'Action';

  // Cible(s) supplémentaires en multi-cibles (liste sous la ligne de contexte).
  const targetChips = allTargets && allTargets.length > 1 ? `
    <div class="vtt-atk-targets">
      ${allTargets.map(id => {
        const td = VS.tokens[id]?.data;
        const tl = td ? _live(td) : null;
        const nm = tl?.displayName ?? td?.name ?? id;
        const img = tl?.displayImage || td?.imageUrl || '';
        return `<span class="vtt-atk-target-chip">${img ? `<img src="${_esc(img)}" alt="">` : ''}${_esc(nm)}</span>`;
      }).join('')}
    </div>` : '';

  // Chips de la ligne de contexte : coût + portée + (zone / multi-cibles éventuels).
  let _costChip = '';
  if (opt.pmCost > 0) _costChip = `<span class="vtt-atk-chip pm">🔮 ${opt.pmCost} ${_esc(_RES_LABEL[_optCostRes(opt)] || 'PM')}</span>`;
  else if (opt.pmCost === 0 && opt.basePm > 0) _costChip = `<span class="vtt-atk-chip pm">🔮 Gratuit</span>`;
  let _extraChip = '';
  if (opt.zoneW > 0 || opt.zoneH > 0) {
    const zoneIcon = opt.zoneShape === 'cross' ? '✚' : opt.zoneShape === 'cone' ? '🔺' : opt.zoneShape === 'ring' ? '◯' : opt.zoneShape === 'line' ? '▬' : opt.zoneShape === 'diamond' ? '◇' : '📐';
    _extraChip = `<span class="vtt-atk-chip">${zoneIcon} ${opt.zoneW}×${opt.zoneH}</span>`;
  } else if ((opt.nbCibles || 1) > 1) {
    _extraChip = `<span class="vtt-atk-chip">🎯 ${opt.nbCibles} cibles</span>`;
  }

  // Bande de notes : pills + runes + effet(s) Affliction/Enchantement + note de raté +
  // interaction élémentaire + description (dépliable). Les conteneurs à id restent
  // présents (mis à jour par _vttAtkSetElement au changement d'élément).
  const _pills = _vttSpellPills(opt);
  const _runes = _vttSpellRuneChips(opt, srcChar);
  const _utilNotesHtml = utilNotes.map(([cls, txt]) => `<span class="vtt-atk-note ${cls}">${txt}</span>`).join('');
  const _styleRules = combatStyle?.style ? normalizeCombatStyle(combatStyle.style).rules : null;
  const _styleNotesHtml = [
    combatStyle?.modifiers?.hasDis ? '<span class="vtt-atk-note weak">↘ Désavantage automatique · ennemi au contact du lanceur</span>' : '',
    combatStyle?.modifiers?.hasAdv ? '<span class="vtt-atk-note free">↗ Avantage automatique · ennemi au contact du lanceur</span>' : '',
    _styleRules?.opportunityAttack === 'allow' ? '<span class="vtt-atk-note">↪ Réaction d’opportunité · sortie de portée</span>' : '',
    _styleRules?.opportunityAttack === 'forbid' ? '<span class="vtt-atk-note weak">⊘ Attaque d’opportunité indisponible</span>' : '',
  ].join('');
  const _notesHtml = `
    ${_pills.length ? `<span class="cs-spellcard-tags">${_pills.join('')}</span>` : ''}
    ${_runes}
    ${_utilNotesHtml}
    ${_styleNotesHtml}
    <span id="atk-miss-note">${_atkMissNoteHtml(opt)}</span>
    <span id="atk-interaction">${_atkInteractionHtml(opt)}</span>
    ${opt.actionDescription ? `<details class="vtt-atk-desc"><summary>ℹ️ Description</summary><p>${_esc(opt.actionDescription)}</p></details>` : ''}`;

  openModal('⚔️ Résoudre l’action', `
    <div class="vtt-form vtt-atk-confirm" style="--atk-accent:${btnColor};--atk-fg:${btnFg}">
      <header class="vtt-atk-ctx">
        <button type="button" class="vtt-atk-back" data-vtt-fn="_vttBackToAtk" title="Retour au choix d'action">←</button>
        <span class="vtt-atk-aico">${opt.icon}</span>
        <span class="vtt-atk-ctxmain">
          <span class="vtt-atk-ctxname"><b title="${_esc(opt.label)}">${_esc(opt.label)}</b><span class="vtt-atk-tag">${_typeTag}</span></span>
          <span class="vtt-atk-route">${_srcName}<i>→</i><span class="vtt-atk-tgt ${targetTone}">${_tgtName}</span><i>·</i>${_distTxt}</span>
        </span>
        <span class="vtt-atk-ctxres">${_costChip}${_extraChip}<span class="vtt-atk-chip ok">à portée</span></span>
      </header>
      ${targetChips}

      <div class="vtt-atk-rows" data-atk-rows>${centerBlock}</div>

      ${(elemSelectorHtml || _vttWeaponTechniquesHtml(opt)) ? `<div class="vtt-atk-opts">${elemSelectorHtml}<div id="atk-techniques-slot">${_vttWeaponTechniquesHtml(opt)}</div></div>` : ''}

      <div class="vtt-atk-notes">${_notesHtml}</div>

      <input type="hidden" id="atk-mode" value="normal">
      <footer class="vtt-atk-footer">
        <span class="vtt-atk-ftk"><kbd>⏎</kbd> lancer <kbd>Échap</kbd> retour</span>
        <button type="button" class="btn-secondary" data-vtt-fn="_vttBackToAtk">Retour</button>
        <button type="button" class="vtt-atk-launch" data-vtt-fn="_vttRollAttack">${btnLabel}</button>
      </footer>
    </div>`);
  _vttAtkBindResolve(document.querySelector('#modal-box .vtt-atk-confirm'));
  // Toute fermeture du sélecteur (bouton, croix, Échap ou clic sur l'overlay)
  // rend la sélection au lanceur. La cible n'est qu'un contexte temporaire.
  setModalCloseGuard(() => { _restoreAttackSourceSelection(); return false; });
  // Cette modale (jet) n'est PAS le grand sélecteur d'actions : on bascule sur une
  // largeur ajustée au formulaire (.modal--atk) et on retire la large .modal--aopt
  // (héritée car l'overlay n'est pas masqué entre les deux) → plus de boîte 808px
  // avec un formulaire étroit qui flotte.
  const _mb = document.getElementById('modal-box');
  if (_mb) { _mb.classList.remove('modal--aopt'); _mb.classList.add('modal--atk'); }
}

function _restoreAttackSourceSelection() {
  const srcId = _attackSrc;
  const src = VS.tokens[srcId]?.data;
  if (srcId && src && _canControlToken(src) && VS.selected !== srcId) _select(srcId);
}
// Rouvre la modale d'action mémorisée (après annulation d'un sort en cours). Renvoie
// true si une modale a été rouverte. La cible peut avoir disparu → _execAttack gère.
function _vttReturnToActions() {
  const ret = _actModalReturn;
  _actModalReturn = null;
  if (!ret || !VS.tokens[ret.srcId]?.data) return false;
  if (ret.tgtId != null && ret.tgtId !== ret.srcId && !VS.tokens[ret.tgtId]?.data) {
    _execAttack(ret.srcId, null);   // cible partie → on rouvre en « action d'abord »
  } else {
    _execAttack(ret.srcId, ret.tgtId);
  }
  return true;
}

function _vttCancelAtk() { _atkCtx=null; _restoreAttackSourceSelection(); closeModalDirect(); }
function _closeActionModal() { _restoreAttackSourceSelection(); closeModalDirect(); }

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
  ['dis','normal','adv'].forEach(m => {
    const el = document.getElementById(`atk-mode-${m}`);
    if (!el) return;
    const active = m === mode;
    el.classList.toggle('is-active', active);
    el.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const inp = document.getElementById('atk-mode');
  if (inp) inp.value = mode;
}

function _vttAtkBonusStep(id, delta = 0) {
  const input = document.getElementById(String(id || ''));
  if (!input) return;
  const min = input.min !== '' ? Number(input.min) : -99;
  const max = input.max !== '' ? Number(input.max) : 99;
  const next = Math.max(min, Math.min(max, (parseInt(input.value, 10) || 0) + Number(delta || 0)));
  input.value = String(next);
  input.classList.toggle('has-value', next !== 0);
}

/**
 * Contrôleur local de la modale de jet : dépliage du tiroir « Ajuster » et pastille
 * ambre d'ajustement affichée DANS la formule quand un bonus ≠ 0 (replié ≠ caché).
 * Les steppers passent par _vttAtkBonusStep (dispatch global) ; on ne duplique pas sa
 * logique — on relit les 4 champs après coup et on synchronise l'affichage.
 */
function _vttAtkBindResolve(root) {
  if (!root || root._atkBound) return;
  root._atkBound = true;

  const syncRow = (row) => {
    if (!row) return;
    let fixed = 0, dice = 0, hasHit = false;
    row.querySelectorAll('.vtt-atk-drawer input').forEach(inp => {
      const v = parseInt(inp.value, 10) || 0;
      if (/hit/.test(inp.id)) hasHit = true;
      if (/-dice$/.test(inp.id)) dice = v; else fixed = v;
    });
    const active = fixed !== 0 || dice !== 0;
    const formula = row.querySelector('.vtt-atk-formula');
    let pill = formula?.querySelector('.vtt-atk-adj');
    if (active && formula) {
      if (!pill) { pill = document.createElement('span'); pill.className = 'vtt-atk-adj'; formula.appendChild(pill); }
      const dtxt = dice ? `${dice > 0 ? '+' : ''}${dice}d${hasHit ? '20' : 'é'}` : '';
      const ftxt = fixed ? `${fixed > 0 ? '+' : ''}${fixed}` : '';
      pill.textContent = [dtxt, ftxt].filter(Boolean).join(' ');
    } else if (pill) { pill.remove(); }
    const adjBtn = row.querySelector('[data-atk-adj]');
    if (adjBtn) adjBtn.classList.toggle('is-on', active || row.classList.contains('open'));
    const reset = row.querySelector('.vtt-atk-reset');
    if (reset) reset.hidden = !active;
  };
  const syncAll = () => root.querySelectorAll('.vtt-atk-row').forEach(syncRow);

  root.addEventListener('click', (e) => {
    const adj = e.target.closest('[data-atk-adj]');
    if (adj) {
      const row = adj.closest('.vtt-atk-row');
      const open = row.classList.toggle('open');
      adj.setAttribute('aria-expanded', open ? 'true' : 'false');
      syncRow(row);
      return;
    }
    // Stepper ou « Réinitialiser » : re-synchroniser après le handler global.
    if (e.target.closest('.vtt-atk-reset')) { requestAnimationFrame(syncAll); return; }
    if (e.target.closest('.vtt-atk-step button')) {
      const row = e.target.closest('.vtt-atk-row');
      requestAnimationFrame(() => syncRow(row));
    }
  });
  root.addEventListener('input', (e) => {
    if (e.target.matches?.('.vtt-atk-drawer input')) syncRow(e.target.closest('.vtt-atk-row'));
  });
}

function _vttAtkBonusReset() {
  document.querySelectorAll('.vtt-atk-drawer input').forEach(input => {
    input.value = '0';
    input.classList.remove('has-value');
  });
}

// ═══════════════════════════════════════════════════════════════════
// MULTI-CIBLAGE — sélection visuelle pour les sorts multi-cibles
// ═══════════════════════════════════════════════════════════════════

/** Centre pixel d'un token dans le repère Konva (tient compte de la taille W×H). */
function _tokenCenter(t) {
  const d = _tokenDims(t);
  return { x: t.col * CELL + d.w * CELL / 2, y: t.row * CELL + d.h * CELL / 2 };
}

/** Distance en CASES (Manhattan, comme la règle de mesure) entre le lanceur et la
 *  case centrale d'une zone (px centre → case entière). Sert au contrôle de portée. */
function _zoneCenterDistCells(casterCenter, zx, zy) {
  const cCol = Math.floor(casterCenter.x / CELL), cRow = Math.floor(casterCenter.y / CELL);
  const zCol = Math.floor(zx / CELL), zRow = Math.floor(zy / CELL);
  return Math.abs(zCol - cCol) + Math.abs(zRow - cRow);
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
  _clearTargetRings();
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
    _setTargetRing(firstTgtId, _targetTone(srcId, firstTgtId, !!(opt.isHeal || opt.isEnchant || opt.isRegen)));
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
    _setTargetRing(tgtId, 'hostile', false);
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
    _setTargetRing(tgtId, _targetTone(srcId, tgtId, !!(_mtCtx.opt.isHeal || _mtCtx.opt.isEnchant || _mtCtx.opt.isRegen)));
    if (srcData && tgtData) {
      const line = _mtDrawLine(srcData, tgtData);
      if (line) lines.set(tgtId, line);
    }
  }

  _mtRefreshHud();
  _mtBroadcast();
}

function _mtCancel() { _mtClear(); showNotif('Ciblage annulé', 'info'); _vttReturnToActions(); }

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
  _zoneCtx?._dropGroup?.destroy();   // zones posées en attente (aperçu Dispersion)
  _zoneCtx = null;
  VS.layers.token?.batchDraw();
}

/** Dessine une zone posée (déjà validée en attente de résolution) — plus discrète
 *  que le fantôme actif, pour qu'on voie ce qui est déjà placé. Renvoie un groupe
 *  Konva positionné en absolu. */
function _zoneDroppedGroup(K, v) {
  const g = new K.Group({ x: v.x, y: v.y, listening: false, name: 'zone-dropped' });
  const zv = v.zoneVisual || {};
  const wPx = zv.w || v.wPx, hPx = zv.h || v.hPx;
  const shp = zv.shape || 'rect';
  const col = v.color || '#60a5fa';
  const style = { fill: col + '3a', stroke: col, strokeWidth: 2, shadowColor: col, shadowBlur: 5, shadowOpacity: 0.5, listening: false };
  if (shp === 'rect') {
    g.add(new K.Rect({ x: -wPx / 2, y: -hPx / 2, width: wPx, height: hPx, ...style, cornerRadius: 3 }));
  } else {
    for (const cell of _zoneCellRects(K, wPx, hPx, shp, zv.coneDir || 'down', style)) g.add(cell);
  }
  return g;
}

/** (Re)Construit le rectangle Konva de prévisualisation. */
function _buildZonePreview() {
  if (!_zoneCtx || !VS.layers.token) return;
  _zonePreview?.destroy();
  _zoneCtx._dropGroup?.destroy();
  _zoneCtx._dropGroup = null;
  const K = window.Konva;
  // Zones à effet déjà posées (Dispersion) : rendues en clair pour rester visibles
  // pendant qu'on place les suivantes.
  if (Array.isArray(_zoneCtx._accFx) && _zoneCtx._accFx.length) {
    const dg = new K.Group({ listening: false, name: 'zone-dropped-layer' });
    for (const v of _zoneCtx._accFx) dg.add(_zoneDroppedGroup(K, v));
    VS.layers.token.add(dg);
    _zoneCtx._dropGroup = dg;
  }
  const { wPx, hPx, x, y } = _zoneCtx;
  const group = new K.Group({ x, y, listening: false, name: 'zone-preview' });
  // Hors de portée (centre de la zone > portée) → aperçu ROUGE (feedback direct :
  // le placement sera refusé à la validation).
  const _srcC = VS.tokens[_zoneCtx.srcId]?.data ? _tokenCenter(VS.tokens[_zoneCtx.srcId].data) : null;
  const _range = Math.max(0, parseInt(_zoneCtx.opt?.portee) || 1);
  const _oor = !!(_srcC && _zoneCenterDistCells(_srcC, x, y) > _range);
  _zoneCtx._oor = _oor;   // mémorise l'état (détection du basculement dans _zoneUpdatePreview)
  const _fill = _oor ? 'rgba(255,90,110,0.30)' : 'rgba(253,224,71,0.42)';
  const _stroke = _oor ? '#ff5a6e' : '#ffe86b';
  const _shp = _zoneCtx.opt?.zoneShape;
  // Cases bien visibles : remplissage opaque + bordure pleine + halo par case.
  const _cellStyle = { fill: _oor ? 'rgba(255,90,110,0.42)' : 'rgba(253,224,71,0.52)', stroke: _stroke, strokeWidth: 2.5, shadowColor: _stroke, shadowBlur: 9, shadowOpacity: 0.7, listening: false };
  if (_shp === 'cone') {
    // Cône EN CASES (1, 3, 5…). Direction : manuelle (R) sinon celle calculée au
    // snapping (coneDirEff) pour que le dessin colle exactement aux cases snappées.
    const cl = _coneLayout(_zoneCtx.srcId, x, y, wPx, hPx, _zoneCtx.coneDirManual || _zoneCtx.coneDirEff);
    for (const cell of _zoneCellRects(K, cl.w, cl.h, 'cone', cl.dir, _cellStyle)) group.add(cell);
  } else if (_shp === 'cross' || _shp === 'ring' || _shp === 'diamond' || _shp === 'line') {
    // Formes EN CASES (croix, anneau en losange évidé, losange plein, ligne 1×L) → cohérent avec le ciblage.
    for (const cell of _zoneCellRects(K, wPx, hPx, _shp, 'down', _cellStyle)) group.add(cell);
  } else {
    group.add(new K.Rect({
      x: -wPx / 2, y: -hPx / 2,
      width: wPx, height: hPx,
      fill: _fill, stroke: _stroke,
      strokeWidth: 3, dash: [10, 5],
      cornerRadius: 3, listening: false,
    }));
    // Halo intérieur pour la lisibilité sur fond clair ou sombre (rouge hors portée)
    group.add(new K.Rect({
      x: -wPx / 2 + 2, y: -hPx / 2 + 2,
      width: wPx - 4, height: hPx - 4,
      fill: 'transparent',
      stroke: _oor ? 'rgba(255,90,110,0.5)' : 'rgba(253,224,71,0.45)',
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
  let wPx = _zoneCtx.wPx, hPx = _zoneCtx.hPx;
  // Cône : la box est pivotée pour les sens horizontaux → on snappe avec la box
  // RÉELLEMENT dessinée (sinon les cases sont à cheval sur la grille). On mémorise
  // la direction effective pour que l'aperçu se dessine à l'identique.
  if (_zoneCtx.opt?.zoneShape === 'cone') {
    const cl = _coneLayout(_zoneCtx.srcId, wp.x, wp.y, _zoneCtx.wPx, _zoneCtx.hPx, _zoneCtx.coneDirManual);
    wPx = cl.w; hPx = cl.h; _zoneCtx.coneDirEff = cl.dir;
  }
  // Snapper le coin haut-gauche sur la grille → cases alignées quelles que soient
  // les dimensions (paires ou impaires).
  const snapX = Math.round((wp.x - wPx / 2) / CELL) * CELL + wPx / 2;
  const snapY = Math.round((wp.y - hPx / 2) / CELL) * CELL + hPx / 2;
  _zoneCtx.x = snapX; _zoneCtx.y = snapY;
  // Recoloration LIVE (toutes les formes) : rouge si le centre sort de la portée,
  // jaune si la zone est posable. On reconstruit quand l'état hors-portée bascule
  // (ou pour le cône auto, dont l'orientation dépend aussi de la position).
  const _srcC = VS.tokens[_zoneCtx.srcId]?.data ? _tokenCenter(VS.tokens[_zoneCtx.srcId].data) : null;
  const _range = Math.max(0, parseInt(_zoneCtx.opt?.portee) || 1);
  const _oorNow = !!(_srcC && _zoneCenterDistCells(_srcC, snapX, snapY) > _range);
  const _coneAuto = _zoneCtx.opt?.zoneShape === 'cone' && !_zoneCtx.coneDirManual;
  if (_coneAuto || _oorNow !== _zoneCtx._oor) {
    _buildZonePreview();   // recouleur (rouge/jaune) + orientation du cône
  } else {
    _zonePreview.position({ x: snapX, y: snapY });
  }
  VS.layers.token.batchDraw();
}

/** Affiche le HUD de placement de zone. */
function _showZoneHud() {
  document.getElementById('vtt-zone-hud')?.remove();
  const opt = _zoneCtx.opt;
  const total = _zoneCtx.invocationsTotal || 1;
  const done  = _zoneCtx.invocationsDone || 0;
  const multi = total > 1;   // Dispersion / invocations multiples → on pose plusieurs zones
  const hud = document.createElement('div');
  hud.id = 'vtt-zone-hud';
  hud.className = 'vtt-mt-hud';
  hud.innerHTML = `
    <div class="vtt-mt-hud-header">
      <span>${_esc(opt.icon || '✨')} ${_esc(_zoneCtx.baseLabel || opt.label)}</span>
      <span class="vtt-mt-hud-count" style="color:#fde047;background:rgba(253,224,71,.12);border-color:rgba(253,224,71,.35)">📐 ${opt.zoneW}×${opt.zoneH} cases${multi ? ` · ${done}/${total} posées` : ''}</span>
    </div>
    <div class="vtt-zone-hint">
      ${multi
        ? `Déplacez · <kbd>Clic</kbd> = poser une zone · <kbd>R</kbd> = tourner · <kbd>Retour</kbd> = annuler la dernière · <kbd>Entrée</kbd> = valider`
        : `Déplacez · Clic = poser/reprendre · <kbd>R</kbd> = tourner · <kbd>Entrée</kbd> = valider`}
    </div>
    <div class="vtt-mt-hud-actions">
      <button class="vtt-mt-btn-cancel"   data-vtt-fn="_zoneCancel">✕ Annuler</button>
      <button class="vtt-mt-btn-validate" data-vtt-fn="_zoneValidate">✓ Valider${multi ? ` (${done}/${total})` : ''}</button>
    </div>`;
  const onKey = e => {
    if (_vttIsTypingTarget(e.target)) return;
    if (e.key === 'Enter')                     { e.preventDefault(); _zoneValidate(); }
    if (e.key === 'Escape')                    _zoneCancel();
    if (e.key === 'r' || e.key === 'R')        _zoneRotate();
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); _zoneUndoLast(); }
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
  // Nombre de placements : invocations choisies, sinon sentinelle, sinon — modèle
  // zones v2 — Dispersion répète la zone (1 + nDisp poses via nbCibles), sinon 1.
  // (La pose répétée n'est branchée que pour les zones-MARQUEUR utilitaires ; les
  // zones à effet instantané [dégâts/soin] restent une pose — cf. Passe 2b.)
  const nbInvoc = (opt._invSelIds && opt._invSelIds.length)
    ? opt._invSelIds.length
    : (opt?.mods?.sentinelle?.nbInvocations || opt?.mods?.invocation?.nbInvocations
       || Math.max(1, opt.nbCibles || 1));
  _zoneCtx = {
    srcId, tgtId, opt, optIdx, wPx, hPx, x: 0, y: 0, placed: false,
    baseLabel: opt.label,        // libellé de référence (le compteur « (n/T) » se recompose dessus)
    invocationsTotal: nbInvoc,
    invocationsDone: 0,
    _accFx: [],                  // poses accumulées (zones à effet) → aperçu + résolution groupée
  };
  _buildZonePreview();
  _showZoneHud();
}

// Orientation d'un cône : direction cardinale lanceur→zone (l'apex est du côté du
// lanceur, la base au loin). Pour les sens horizontaux, la bounding-box est pivotée
// (profondeur = largeur px). wPx/hPx = base×profondeur (issus de _zoneDims).
function _coneLayout(srcId, x, y, wPx, hPx, forcedDir) {
  let dir = forcedDir || null;
  if (!dir) {
    const cc = _tokenCenter(VS.tokens[srcId]?.data);
    dir = 'down';
    if (cc && Number.isFinite(cc.x) && Number.isFinite(cc.y)) {
      const dx = x - cc.x, dy = y - cc.y;
      dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'down' : 'up');
    }
  }
  const horiz = dir === 'left' || dir === 'right';
  return { dir, w: horiz ? hPx : wPx, h: horiz ? wPx : hPx };
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
  const _shape = [...ZONE_SHAPES, 'diamond'].includes(opt.zoneShape) ? opt.zoneShape : 'rect';
  // Cône : orienté en 4 directions cardinales (apex du côté du lanceur, base au loin) ;
  // la bounding-box est pivotée pour les sens horizontaux.
  let _w = wPx, _h = hPx, _coneDir = null;
  if (_shape === 'cone') { const cl = _coneLayout(srcId, x, y, wPx, hPx, _zoneCtx?.coneDirManual || _zoneCtx?.coneDirEff); _w = cl.w; _h = cl.h; _coneDir = cl.dir; }
  const data = {
    type: 'spellzone',
    x, y, w: _w, h: _h, ...(_coneDir ? { coneDir: _coneDir } : {}),
    shape: _shape,
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

function _zoneCancel() { _zoneClear(); showNotif('Zone annulée', 'info'); _vttReturnToActions(); }

const _CONE_DIRS = ['down', 'right', 'up', 'left'];
function _zoneRotate() {
  if (!_zoneCtx) return;
  if (_zoneCtx.opt?.zoneShape === 'cone') {
    // Cône : on ne permute PAS la bounding-box (ça cassait la forme). On fait
    // tourner sa DIRECTION dans les 4 sens (l'apex reste du côté visé). Le 1er R
    // part du sens auto (lanceur→curseur), puis cycle.
    const cur = _zoneCtx.coneDirManual || _coneLayout(_zoneCtx.srcId, _zoneCtx.x, _zoneCtx.y, _zoneCtx.wPx, _zoneCtx.hPx).dir;
    _zoneCtx.coneDirManual = _CONE_DIRS[(_CONE_DIRS.indexOf(cur) + 1) % 4];
  } else {
    [_zoneCtx.wPx, _zoneCtx.hPx] = [_zoneCtx.hPx, _zoneCtx.wPx];
  }
  _buildZonePreview();
  _zonePreview?.position({ x: _zoneCtx.x, y: _zoneCtx.y });
  VS.layers.token?.batchDraw();
}

// Clic pendant un placement de zone :
//  · zone MULTIPLE (Dispersion / invocations) → POSE une zone et on continue (on ne
//    résout qu'à l'Entrée / bouton Valider) ;
//  · zone UNIQUE → verrouille/déverrouille la position (comportement historique).
function _zoneClickAction() {
  if (!_zoneCtx) return;
  const total = _zoneCtx.invocationsTotal || 1;
  if (total > 1) { _zoneValidate(false); return; }
  _zoneCtx.placed = !_zoneCtx.placed;
}

// Annule la DERNIÈRE zone posée sans quitter le placement (déplacer une zone mal
// posée = Retour puis re-clic ailleurs). Marche pour les 3 familles :
//  · marqueurs / invocations / sentinelles → détruit le dernier token/annotation créé ;
//  · zones à effet → retire la dernière pose accumulée (_accFx).
async function _zoneUndoLast() {
  if (!_zoneCtx) return;
  const done = _zoneCtx.invocationsDone || 0;
  if (done <= 0) { showNotif('Aucune zone à annuler', 'info'); return; }
  // Zones à effet instantané : la pose n'est qu'accumulée (pas encore résolue).
  if (Array.isArray(_zoneCtx._accFx) && _zoneCtx._accFx.length) _zoneCtx._accFx.pop();
  // Marqueurs utilitaires : supprime la dernière annotation persistante posée.
  if (Array.isArray(_zoneCtx.placedZoneIds) && _zoneCtx.placedZoneIds.length) {
    const zid = _zoneCtx.placedZoneIds.pop();
    if (zid) { _annotations[zid]?.shape?.destroy?.(); delete _annotations[zid]; await deleteDoc(_annotRef(zid)).catch(() => {}); }
  }
  // Invocations / sentinelles : supprime le dernier token invoqué.
  if (Array.isArray(_summonSpawnIds) && _summonSpawnIds.length
      && (_zoneCtx.opt?.mods?.invocation || _zoneCtx.opt?.mods?.sentinelle)) {
    const tid = _summonSpawnIds.pop();
    if (tid) { VS.tokens[tid]?.shape?.destroy?.(); delete VS.tokens[tid]; await deleteDoc(_tokRef(tid)).catch(() => {}); }
  }
  _zoneCtx.invocationsDone = done - 1;
  _zoneCtx.placed = false;
  const total = _zoneCtx.invocationsTotal || 1;
  _zoneCtx.opt = { ..._zoneCtx.opt, label: `${_zoneCtx.baseLabel} (${Math.min((_zoneCtx.invocationsDone || 0) + 1, total)}/${total})` };
  showNotif(`Dernière zone annulée (${_zoneCtx.invocationsDone}/${total})`, 'info');
  _showZoneHud();
  _buildZonePreview();
  VS.layers.token?.batchDraw();
}

// finalize=false : « poser » une zone (clic) et rester en placement pour la suivante.
// finalize=true (défaut : Entrée / bouton Valider) : résoudre toutes les zones posées.
async function _zoneValidate(finalize = true) {
  if (!_zoneCtx) return;
  const { srcId, opt, wPx, hPx, x, y } = _zoneCtx;

  // Vérification portée : le CENTRE de la zone doit être dans la portée du lanceur
  // (si la zone déborde au-delà, ce n'est pas grave). NB : `opt.portee` peut arriver
  // en chaîne → on force un nombre, sinon `"6" + 0.5` = "60.5" et la portée saute.
  const srcData = VS.tokens[srcId]?.data;
  if (srcData) {
    const sc = _tokenCenter(srcData);
    // Distance en CASES ENTIÈRES entre la case centrale de la zone et le lanceur,
    // en Manhattan (|Δcol|+|Δligne|) — MÊME métrique que la règle de mesure. La
    // case centrale ne peut PAS dépasser la portée (pas de tolérance flottante).
    const distCells = _zoneCenterDistCells(sc, x, y);
    const range = Math.max(0, parseInt(opt.portee) || 1);
    if (distCells > range) {
      showNotif(`Zone hors de portée (${distCells}c — portée : ${range}c)`, 'error');
      return;
    }
  }

  // Détection sur l'empreinte complète du token, pas uniquement sur le centre
  // de son portrait. La clé du dictionnaire est conservée comme id canonique
  // pour que toutes les cibles détectées soient ensuite résolues sans perte.
  // Descripteur de zone pour le ciblage : cône orienté (box pivotée + sens) sinon w×h.
  const _zShape = opt.zoneShape || 'rect';
  const _zLay = _zShape === 'cone' ? _coneLayout(srcId, x, y, wPx, hPx, _zoneCtx?.coneDirManual || _zoneCtx?.coneDirEff) : { w: wPx, h: hPx, dir: null };
  const _zoneHit = { x, y, width: _zLay.w, height: _zLay.h, shape: _zShape, cellSize: CELL, coneDir: _zLay.dir };
  const targets = Object.entries(VS.tokens)
    .filter(([, e]) => {
      if (!e.data || e.data.pageId !== VS.activePage?.id) return false;
      if (e.data.id === srcId) return false;   // le lanceur ne subit JAMAIS sa propre zone
      if (!e.data.visible && !STATE.isAdmin) return false;
      if (opt.friendlyOnly && e.data.type === 'enemy') return false;
      if (opt.hostileOnly && e.data.type !== 'enemy') return false;
      const dims = _tokenDims(e.data);
      return tokenFootprintIntersectsZone(
        { col: e.data.col, row: e.data.row, width: dims.w, height: dims.h },
        _zoneHit,
      );
    })
    .map(([id]) => id);

  // ── Sceau runique + zone visible (projectile → zone → impacts) ──────
  // La zone est rendue pour TOUTES les AoE, même celles sans sceau runique.
  const _zoneSigil = _buildCastSigil(srcData, opt);
  const _isSummon = _zoneSigil?.category === 'summon' || !!opt?.mods?.invocation || !!opt?.mods?.sentinelle;
  const _isHealingZone = _zoneSigil?.category === 'heal' || !!opt.isHeal || !!opt.isRegen;
  const _zoneDamageType = getDamageTypeById(VS.damageTypes, opt.damageTypeId);
  const _zImpColor = _isHealingZone
    ? '#22c38e'
    : (_zoneSigil?.color || _zoneDamageType?.color || opt.damageTypeColor || (opt.isCaSort ? '#4f8cff' : '#b47fff'));
  const _zoneVisual = {
    x, y, w: _zLay.w, h: _zLay.h,
    shape: opt.zoneShape || 'rect',
    ...(_zLay.dir ? { coneDir: _zLay.dir } : {}),
    label: `${opt.icon || (_isHealingZone ? '💚' : '✨')} ${opt.label || (_isHealingZone ? 'Zone de soin' : 'Zone d’effet')}`,
    cellSize: CELL,
  };
  // TOUS les effets de rune (sceau/dessin + projectile + empreinte de zone + diffusion)
  // sont DIFFÉRÉS : ils apparaissent une fois l'action RÉSOLUE, pas à l'ouverture de
  // la modale de résolution.
  //  · sorts à cibles → joués à la fin de _vttRollAttack (via opt._zoneFx) ;
  //  · pose de marqueur / sentinelle (résolution synchrone) → joués sur place ci-dessous.
  opt._zoneFx = () => _emitOneZoneFx({ srcId, x, y, zoneVisual: _zoneVisual, targets, color: _zImpColor, physical: !!_zoneSigil?.physical, isSummon: _isSummon, sigil: _zoneSigil });   // différée par défaut

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
    // Modèle zones v2 : la Dispersion pose la zone 1 + nDisp fois (invocationsTotal).
    // On boucle comme les invocations : PM/journal une seule fois, à la dernière pose.
    if (!_zoneCtx.invocationsDone) _zoneCtx.placedZoneIds = [];
    const total = _zoneCtx.invocationsTotal || 1;
    const _done0 = _zoneCtx.invocationsDone || 0;
    if (_done0 < total) {   // pose un marqueur (sauf si le quota est déjà atteint)
      const _zid = await _vttPlaceSpellZone(srcId, opt, { x, y, wPx, hPx });
      if (_zid) _zoneCtx.placedZoneIds.push(_zid);
      _zoneCtx.invocationsDone = _done0 + 1;
    }
    const done = _zoneCtx.invocationsDone || 0;
    if (!finalize) {   // clic : pose et reste en placement ; Entrée validera
      showNotif(done >= total ? `${done}/${total} zones posées — Entrée pour valider (Retour = annuler la dernière)` : `${opt.icon || '✨'} Zone ${done}/${total} posée — clic pour la suivante`, 'info');
      _zoneCtx.placed = false;
      _zoneCtx.opt = { ..._zoneCtx.opt, label: `${_zoneCtx.baseLabel} (${Math.min(done + 1, total)}/${total})` };
      _showZoneHud();
      _zonePreview?.position({ x: _zoneCtx.x, y: _zoneCtx.y });
      VS.layers.token?.batchDraw();
      return; // reste en mode placement
    }
    const _ids = _zoneCtx.placedZoneIds || [];
    const srcD = VS.tokens[srcId]?.data;
    const _snap = _captureUndoSnapshot(srcId, []);
    _snap.createdAnnots = [..._ids];
    if (srcD && !(await _vttSpendSpellPm(srcD, opt))) {
      for (const zid of _ids) {
        _annotations[zid]?.shape?.destroy?.();
        delete _annotations[zid];
        await deleteDoc(_annotRef(zid)).catch(() => {});
      }
      _zoneClear();
      return;
    }
    if (srcD) await _vttStartSpellCooldown(srcD, opt);
    await _vttApplyCasterConcentration(srcId, opt);
    const _statsDelta = srcD ? _applyCastStatsDelta(srcD, opt) : null;
    const _zLbl = total > 1 ? `${total} zones` : 'zone';
    await _publishCombatLog({
      ..._statsLogMeta(opt),
      type: 'cast', undo: _snap,
      ...(_hasStatsDelta(_statsDelta) ? { statsDelta: _statsDelta } : {}),
      ..._vttLogSourceFields(srcD),
      authorId: STATE.user?.uid || null,
      authorName: STATE.profile?.pseudo || STATE.profile?.prenom || STATE.user?.displayName || 'MJ',
      casterName: srcD ? (_live(srcD).displayName ?? srcD.name) : '?',
      characterImage: srcD ? _combatLogImage(_live(srcD).displayImage) : null,
      targetName: _zLbl, optLabel: opt.label,
      castEffect: `${opt.icon || '✨'} ${opt.label} — ${_zLbl} (${opt.sortDuree ?? 2} t)`,
      createdAt: serverTimestamp(),
    }).catch(() => {});
    showNotif(`${opt.icon || '✨'} ${total > 1 ? total + ' zones' : 'Zone'} « ${opt.label} » placée${total > 1 ? 's' : ''}`, 'success');
    opt._zoneFx?.(); opt._zoneFx = null;   // pose de marqueur = résolution → empreinte maintenant
    _zoneClear();
    return;
  }

  // ── Invocation générique : place la créature à l'emplacement choisi ──
  // (pas d'attaque du lanceur — la créature a ses propres stats/actions)
  if (opt?.mods?.invocation) {
    if (!_zoneCtx.invocationsDone) _summonSpawnIds = []; // 1ère pose → reset collecteur
    const total = _zoneCtx.invocationsTotal || 1;
    const done0 = _zoneCtx.invocationsDone || 0;
    if (done0 < total) {   // place une invocation (sauf quota déjà atteint)
      const col = Math.round((x - wPx / 2) / CELL);
      const row = Math.round((y - hPx / 2) / CELL);
      const _spawned = await _vttSpawnSummon({ kind: 'invocation', srcId, col, row, opt, durationTurns: opt.mods.invocation.duree || 2 });
      if (_spawned?.id) _summonSpawnIds.push(_spawned.id);
      _zoneCtx.invocationsDone = done0 + 1;
    }
    const done = _zoneCtx.invocationsDone || 0;
    if (!finalize) {   // clic : place et reste en placement ; Entrée validera
      showNotif(done >= total ? `${done}/${total} invocations placées — Entrée pour valider (Retour = annuler la dernière)` : `🐾 Invocation ${done}/${total} placée — clic pour la suivante`, 'info');
      _zoneCtx.placed = false;
      _zoneCtx.opt = { ..._zoneCtx.opt, label: `${_zoneCtx.baseLabel} (${Math.min(done + 1, total)}/${total})` };
      _showZoneHud();
      _zonePreview?.position({ x: _zoneCtx.x, y: _zoneCtx.y });
      VS.layers.token?.batchDraw();
      return; // reste en mode placement
    }
    const srcD = VS.tokens[srcId]?.data;
    // Snapshot AVANT déduction PM/concentration + tokens créés → annulable par le MJ.
    const _snap = _captureUndoSnapshot(srcId, []);
    _snap.createdTokens = [..._summonSpawnIds];
    if (srcD && !(await _vttSpendSpellPm(srcD, opt))) {
      for (const tokenId of _summonSpawnIds) {
        VS.tokens[tokenId]?.shape?.destroy?.();
        delete VS.tokens[tokenId];
        await deleteDoc(_tokRef(tokenId)).catch(() => {});
      }
      _zoneClear();
      return;
    }
    await _vttApplyCasterConcentration(srcId, opt);
    const _statsDelta = srcD ? _applyCastStatsDelta(srcD, opt) : null;
    await _publishCombatLog({
      ..._statsLogMeta(opt),
      type: 'cast', undo: _snap,
      ...(_hasStatsDelta(_statsDelta) ? { statsDelta: _statsDelta } : {}),
      ..._vttLogSourceFields(srcD),
      authorId: STATE.user?.uid || null,
      authorName: STATE.profile?.pseudo || STATE.profile?.prenom || STATE.user?.displayName || 'MJ',
      casterName: srcD ? (_live(srcD).displayName ?? srcD.name) : '?',
      characterImage: srcD ? _combatLogImage(_live(srcD).displayImage) : null,
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
    const total = _zoneCtx.invocationsTotal || 1;
    const done0 = _zoneCtx.invocationsDone || 0;
    if (done0 < total) {   // pose une sentinelle (sauf quota déjà atteint)
      const col = Math.round((x - wPx / 2) / CELL);
      const row = Math.round((y - hPx / 2) / CELL);
      const _spawned = await _vttSpawnSummon({ kind: 'sentinelle', srcId, col, row, opt, durationTurns: 2 });
      if (_spawned?.id) _summonSpawnIds.push(_spawned.id);
      _zoneCtx.invocationsDone = done0 + 1;
    }
    const done = _zoneCtx.invocationsDone || 0;
    if (!finalize) {   // clic : pose et reste en placement ; Entrée validera
      showNotif(done >= total ? `${done}/${total} sentinelles posées — Entrée pour valider (Retour = annuler la dernière)` : `🪤 Sentinelle ${done}/${total} posée — clic pour la suivante`, 'info');
      _zoneCtx.placed = false;
      _zoneCtx.opt = { ..._zoneCtx.opt, label: `${_zoneCtx.baseLabel} (${Math.min(done + 1, total)}/${total})` };
      _showZoneHud();
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
    await _publishCombatLog({
      ..._statsLogMeta(opt),
      type: 'cast', undo: _snap,
      ...(_hasStatsDelta(_statsDelta) ? { statsDelta: _statsDelta } : {}),
      ..._vttLogSourceFields(_srcD),
      authorId: STATE.user?.uid || null,
      authorName: STATE.profile?.pseudo || STATE.profile?.prenom || STATE.user?.displayName || 'MJ',
      casterName: _srcD ? (_live(_srcD).displayName ?? _srcD.name) : '?',
      characterImage: _srcD ? _combatLogImage(_live(_srcD).displayImage) : null,
      targetName: `${total} sentinelle${total > 1 ? 's' : ''}`,
      optLabel: opt.label, castEffect: `🪤 ${total} sentinelle${total > 1 ? 's' : ''} posée${total > 1 ? 's' : ''}`,
      createdAt: serverTimestamp(),
    }).catch(() => {});
    showNotif(`🪤 ${total} sentinelle${total > 1 ? 's' : ''} posée${total > 1 ? 's' : ''}`, 'success');
    // Si aucune cible présente, on s'arrête là (sentinelles posées, pas d'attaque)
    if (!targets.length) {
      opt._zoneFx?.(); opt._zoneFx = null;   // sentinelle posée = résolution → empreinte maintenant
      _zoneClear();
      return;
    }
  } else {
    // ── Effet instantané (dégâts/soin/…). Modèle zones v2 : Dispersion = PLUSIEURS
    //    ZONES. On accumule les cibles de CHAQUE pose puis on résout tout ensemble.
    const _zTotal = _zoneCtx.invocationsTotal || 1;
    if (_zTotal > 1) {
      // Pose N zones : le clic POSE et enchaîne (finalize=false), Entrée/Valider RÉSOUT tout.
      const _done = _zoneCtx.invocationsDone || 0;
      if (_done < _zTotal) {   // ajoute la pose courante (sauf si quota déjà atteint)
        _zoneCtx._accFx = [ ...(_zoneCtx._accFx || []), { srcId, x, y, wPx, hPx, coneDir: _zoneCtx.coneDirManual || _zoneCtx.coneDirEff, zoneVisual: _zoneVisual, targets: [...targets], color: _zImpColor, physical: !!_zoneSigil?.physical, isSummon: _isSummon, sigil: _zoneSigil } ];
        _zoneCtx.invocationsDone = _done + 1;
      }
      const _nowDone = _zoneCtx.invocationsDone || 0;
      if (!finalize) {
        showNotif(_nowDone >= _zTotal
          ? `${_nowDone}/${_zTotal} zones posées — Entrée pour valider (Retour = annuler la dernière)`
          : `Zone ${_nowDone}/${_zTotal} posée — clic pour la suivante · Entrée pour valider`, 'info');
        _zoneCtx.placed = false;
        _zoneCtx.opt = { ..._zoneCtx.opt, label: `${_zoneCtx.baseLabel} (${Math.min(_nowDone + 1, _zTotal)}/${_zTotal})` };
        _showZoneHud();
        _buildZonePreview();   // affiche la zone qu'on vient de poser (aperçu clair) + le fantôme
        _zonePreview?.position({ x: _zoneCtx.x, y: _zoneCtx.y });
        VS.layers.token?.batchDraw();
        return;   // reste en placement — on résoudra à l'Entrée
      }
      // finalize : cibles = union de toutes les zones posées ; empreinte = toutes les poses.
      const _fxList = _zoneCtx._accFx || [];
      _zoneCtx._finalTargets = [...new Set(_fxList.flatMap(v => v.targets || []))];
      opt._zoneFx = () => { for (const v of _fxList) _emitOneZoneFx({ ...v, cellsOnly: true }); };
      if (!_zoneCtx._finalTargets.length) { showNotif('Aucune cible dans les zones', 'error'); _zoneClear(); return; }
    } else if (!targets.length) {
      showNotif('Aucune cible dans la zone', 'error');
      return;
    } else {
      // Zone unique à effet : empreinte en cases seule (sceau/impacts via _vttRollAttack).
      opt._zoneFx = () => _emitOneZoneFx({ srcId, x, y, zoneVisual: _zoneVisual, color: _zImpColor, cellsOnly: true });
    }
  }

  const { optIdx } = _zoneCtx;
  const _finalTargets = _zoneCtx._finalTargets || targets;   // union (multi-zones) ou cibles de l'unique zone
  _zoneClear();

  // Flux identique à multi-cibles : stocker les cibles, ouvrir la modale d'attaque
  _mtPending = _finalTargets;
  const firstTgt = _finalTargets[0];
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
  if (!layer || !VS.stage) return;
  // Les effets sont exprimés dans les mêmes coordonnées monde que les tokens.
  // Copier directement le transform du stage évite les matrices intermédiaires
  // du layer, qui pouvaient dériver pendant un zoom centré sur le pointeur.
  const position = VS.stage.position();
  const scaleX = VS.stage.scaleX() || 1;
  const scaleY = VS.stage.scaleY() || scaleX;
  layer.style.transform = `translate(${position.x}px, ${position.y}px) scale(${scaleX}, ${scaleY})`;
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
    // Onde de zone (animation) : réservée au RECTANGLE. Les autres formes rendent
    // un contour lissé peu fidèle à la grille → on laisse l'empreinte EN CASES
    // (_playZoneCellImpact) porter le visuel exact.
    if ((zonePx?.shape || 'rect') === 'rect') {
      playTechniqueArea(cont, {
        x: center.x, y: center.y,
        width: Math.max(CELL, zonePx?.w || CELL),
        height: Math.max(CELL, zonePx?.h || CELL),
        shape: 'rect', color,
        label: zonePx?.label || 'Zone d’effet',
        cellSize: zonePx?.cellSize || CELL,
      });
    }
    playImpact(cont, center.x, center.y, Math.max(zonePx?.w || 0, zonePx?.h || 0, CELL) * 1.15, color);
    // Empreinte EN CASES qui s'estompe : montre à TOUS (le cast est diffusé) les
    // cases exactes touchées — même pour les sorts instantanés qui ne laissent pas
    // de marqueur persistant. Utilise le même prédicat que le ciblage.
    _playZoneCellImpact(zonePx, color);
    _ensureSigilSync();
    if (!isSummon) visibleTargets.forEach(tid => _playImpactForToken(tid, color));
  } catch (e) { console.warn('[zonefx]', e); }
}

/** Joue l'empreinte d'UNE zone (dessin local + diffusion à tous). Réutilisé pour
 *  une zone unique OU chaque zone d'une Dispersion (plusieurs zones). */
function _emitOneZoneFx(v) {
  if (!v) return;
  // cellsOnly : sort à effet (dégâts/soin) — le sceau de rune + les impacts sur les
  // cibles + la diffusion sont déjà joués À LA RÉSOLUTION par _vttRollAttack. On ne
  // dessine donc QUE l'empreinte en cases (localement), pour ne pas doubler le sceau.
  if (v.cellsOnly) { _playZoneCellImpact(v.zoneVisual, v.color); return; }
  if (v.sigil) _playSigilForToken(v.srcId, v.sigil);   // sceau/dessin de rune sur le lanceur (à la résolution)
  _playZoneFx(v.srcId, { x: v.x, y: v.y }, v.zoneVisual, v.targets || [], v.color, !!v.physical, !!v.isSummon);
  try {
    const _uid = STATE.user?.uid;
    if (_uid) {
      const _n = Date.now() + Math.floor(Math.random() * 1000);
      _seenSigilFire[_uid] = _n;
      setDoc(_castingRef(_uid), {
        sigilFire: {
          tokenId: v.srcId, sigil: v.sigil || null, pageId: VS.activePage?.id || null, n: _n,
          targets: v.targets || [], impColor: v.color, physical: !!v.physical,
          zone: v.zoneVisual, isSummon: !!v.isSummon,
        },
      }, { merge: true }).catch(() => {});
    }
  } catch {}
}

/** Overlay Konva des cases d'une zone, qui apparaît puis s'estompe (~1,7 s). */
function _playZoneCellImpact(zonePx, color) {
  const K = window.Konva;
  if (!K || !VS.layers?.token || !zonePx) return;
  const w = zonePx.w || 0, h = zonePx.h || 0;
  if (w <= 0 || h <= 0) return;
  const g = new K.Group({ x: zonePx.x, y: zonePx.y, listening: false });
  for (const cell of _zoneCellRects(K, w, h, zonePx.shape || 'rect', zonePx.coneDir || 'down', {
    fill: (color || '#b47fff') + '5a', stroke: color || '#b47fff', strokeWidth: 2,
    shadowColor: color || '#b47fff', shadowBlur: 8, shadowOpacity: 0.6, listening: false,
  })) g.add(cell);
  VS.layers.token.add(g);
  VS.layers.token.batchDraw();
  g.to({ opacity: 0, duration: 1.7, easing: K.Easings.EaseIn, onFinish: () => g.destroy() });
}

// Sceaux déjà rejoués (par uid → dernier n) pour ne pas rejouer un même cast.
let _seenSigilFire = {};
let _seenTechniqueFire = {};

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

/** Géométrie logique de la zone d'une technique, alignée sur ses tests de cible. */
function _techniqueAreaFxData(technique, originId, srcId, opt) {
  const radius = Math.max(0, parseInt(technique?.blastRadius, 10) || 0);
  const source = _tokenDataById(srcId);
  const aim = _tokenDataById(originId);
  if (!radius || !source || !aim) return null;
  const shape = ['square', 'circle', 'line', 'cone'].includes(technique.areaShape)
    ? technique.areaShape : 'square';
  const type = getDamageTypeById(VS.damageTypes, technique.damageTypeId || opt?.damageTypeId);
  const common = {
    shape,
    color: type?.color || opt?.damageTypeColor || '#f97316',
    label: `${technique.icon || '💥'} ${technique.label || 'Zone d’effet'}`,
    sourceId: srcId,
    originId,
  };

  if (shape === 'square' || shape === 'circle') {
    const centerData = technique.areaOrigin === 'caster' ? source : aim;
    const dims = _tokenDims(centerData);
    const center = _tokenCenter(centerData);
    return {
      ...common,
      x: center.x,
      y: center.y,
      width: (dims.w + radius * 2) * CELL,
      height: (dims.h + radius * 2) * CELL,
      rotation: 0,
    };
  }

  const from = _tokenCenter(source), toward = _tokenCenter(aim);
  const dx = toward.x - from.x, dy = toward.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.001) return null;
  const ux = dx / distance, uy = dy / distance;
  const length = Math.max(CELL, radius * CELL);
  return {
    ...common,
    x: from.x + ux * length / 2,
    y: from.y + uy * length / 2,
    width: length,
    height: shape === 'cone' ? Math.max(CELL, length * 2) : CELL,
    rotation: Math.atan2(dy, dx) * 180 / Math.PI,
  };
}

function _playTechniqueAreaFx(areas = []) {
  if (!areas.length) return;
  const container = VS.stage?.container();
  if (!container) return;
  for (const area of areas) {
    if (!STATE.isAdmin && !_tokenFxIsVisible(area.originId) && !_tokenFxIsVisible(area.sourceId)) continue;
    playTechniqueArea(container, area);
  }
  _ensureSigilSync();
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
          _playZoneFx(sf.tokenId, { x: sf.zone.x, y: sf.zone.y }, sf.zone, sf.targets || [], sf.impColor, !!sf.physical, !!sf.isSummon);
        } else {
          (sf.targets || []).forEach(tid => _playCastTargetFx(sf.tokenId, tid, sf.impColor, !!sf.melee, !!sf.physical));
          if (sf.selfAura) _playImpactForToken(sf.tokenId, sf.impColor);
        }
      }
    }
    const tf = c.techniqueFire;
    if (tf && tf.n && tf.pageId === VS.activePage?.id && _seenTechniqueFire[d.id] !== tf.n) {
      _seenTechniqueFire[d.id] = tf.n;
      if (!prime) _playTechniqueAreaFx(Array.isArray(tf.areas) ? tf.areas : []);
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
  const { srcId, tgtId, opt, lS, lT, allTargets } = ctx;
  const src=VS.tokens[srcId]?.data, tgt=VS.tokens[tgtId]?.data;
  if (!src || !tgt) return;
  _ensureStatsActionId(opt);
  // Le panneau peut être resté ouvert pendant qu'un état a été appliqué :
  // revérifier l'interdiction au clic empêche de contourner Rage via une UI obsolète.
  if (opt?.sortIdx !== undefined && _hasConditionEffect(src, 'cantCastSpells')) {
    showNotif('🔥 Rage : impossible de lancer un sort.', 'error');
    _atkCtx = null;
    closeModalDirect();
    return;
  }
  const mode     = document.getElementById('atk-mode')?.value || 'normal';
  const bonusHit     = parseInt(document.getElementById('atk-bonus-hit')?.value)||0;
  const bonusDmg     = parseInt(document.getElementById('atk-bonus-dmg')?.value)||0;
  const bonusHitDice = parseInt(document.getElementById('atk-bonus-hit-dice')?.value)||0;
  const bonusDmgDice = parseInt(document.getElementById('atk-bonus-dmg-dice')?.value)||0;
  closeModalDirect();
  _atkCtx = null;

  // Sort à ZONE : l'empreinte a été différée à _zoneValidate → on la dessine ET
  // on la diffuse à tous MAINTENANT, à l'ENVOI de la résolution (pas à l'ouverture
  // de la modale). opt est propre à ce cast → aucune empreinte parasite ailleurs.
  if (opt?._zoneFx) { try { opt._zoneFx(); } catch {} opt._zoneFx = null; }

  const selectedTechniques = [ctx.weaponTechnique, ctx.damageTechnique].filter(Boolean);
  const techniqueDefenseBonus = selectedTechniques.reduce(
    (total, technique) => total + Math.max(0, parseInt(technique?.defenseBonus, 10) || 0),
    0,
  );
  const techniqueAttackModifier = selectedTechniques.reduce(
    (total, technique) => total + Math.max(-30, Math.min(30, parseInt(technique?.attackModifier, 10) || 0)),
    0,
  );

  // Liste des cibles : multi si allTargets, sinon cible unique
  const targetIds = allTargets && allTargets.length > 0 ? allTargets : [tgtId];
  const primaryTargetSet = new Set(targetIds);
  // Capture aussi les victimes potentielles avant le jet : si l'explosion se
  // déclenche, l'annulation MJ pourra restaurer toutes leurs jauges.
  const potentialSplashTargetIds = [...new Set(selectedTechniques.flatMap(technique =>
    _vttTechniqueSplashTargets(technique, targetIds, srcId)
  ))].filter(id => !primaryTargetSet.has(id));

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
  const _undoSnap = _captureUndoSnapshot(srcId, [...targetIds, ...potentialSplashTargetIds]);

  const authorName = STATE.profile?.pseudo||STATE.profile?.prenom||STATE.user?.displayName||'MJ';
  let _preAppliedCastStatsDelta = null;
  // Payeur du mana : selon la configuration de l'invocation, ses actions débitent
  // soit le token lui-même, soit le personnage qui l'a invoquée.
  const _srcChar = _characterForToken(src);
  const _ownerTok = src.summonOwnerId ? VS.tokens[src.summonOwnerId]?.data : null;
  const _pmPayerToken = src.summonKind === 'invocation' && src.summonUsesOwnMana ? src : null;
  const _pmPayerCharId = !_pmPayerToken
    ? (src.summonOwnerCharId || _srcChar?.id || (_ownerTok ? _characterForToken(_ownerTok)?.id : null))
    : null;
  const _pmPayerNpcId = !_pmPayerCharId && src.npcId ? src.npcId : null;
  const _costRes = _optCostRes(opt);
  const _deductCost = async (resource, amount, label = opt.label) => {
    const cost = Math.max(0, parseInt(amount, 10) || 0);
    if (cost <= 0 || resource === 'none') return;
    if (resource !== 'pm') {
      if (_pmPayerCharId) {
        await _spendCharSpellCost(_pmPayerCharId, resource, cost, src.id, label);
        return;
      }
      if (resource === 'pv') {
        const live = _live(src);
        await _setHp(src, Math.max(0, (live.displayHp ?? 0) - cost));
        return;
      }
      throw new Error(`La ressource ${_RES_LABEL[resource] || resource} n’est pas disponible pour ce lanceur.`);
    }
    if (_pmPayerToken) {
      const curPm = Math.max(0, _numOr(_pmPayerToken.pm, _numOr(_pmPayerToken.pmMax, 0)));
      const curCmb = Math.max(0, _numOr(_pmPayerToken.pmCombat, curPm));
      const patch = {
        pm: Math.max(0, curPm - cost),
        pmCombat: Math.max(0, curCmb - cost),
      };
      Object.assign(_pmPayerToken, patch);
      _patchShape(srcId);
      await updateDoc(_tokRef(srcId), patch).catch(error => {
        Object.assign(_pmPayerToken, { pm: curPm, pmCombat: curCmb });
        _patchShape(srcId);
        throw error;
      });
      return;
    }
    if (_pmPayerCharId) {
      await _spendCharSpellCost(_pmPayerCharId, 'pm', cost, src.id, label);
      return;
    }
    if (_pmPayerNpcId) {
      const n = VS.npcs[_pmPayerNpcId];
      if (n) {
        const maxPm = _numOr(n.pmMax, _numOr(n.pm, 0));
        const curPm = _numOr(n.pmCurrent, maxPm);
        const nextPm = Math.max(0, curPm - cost);
        n.pmCurrent = nextPm;
        _patchEntityTokenShapes('npcId', _pmPayerNpcId);
        await updateDoc(_npcRef(_pmPayerNpcId), { pmCurrent: nextPm }).catch(error => {
          n.pmCurrent = curPm;
          _patchEntityTokenShapes('npcId', _pmPayerNpcId);
          throw error;
        });
      }
      return;
    }
    // Créature du bestiaire avec mana : déduit du token. `pm` = PM réels (vus du
    // MJ), `pmCombat` = suivi public pour l'estimation joueur (la jauge baisse).
    const _beastPmMax = _numOr(VS.bestiary[src.beastId]?.pmMax, 0);
    if (src.beastId && _beastPmMax > 0) {
      const curPm  = src.pm != null ? src.pm : _beastPmMax;
      const curCmb = src.pmCombat != null ? src.pmCombat : _beastPmMax;
      const patch = {
        pm: Math.max(0, curPm - cost),
        pmCombat: Math.max(0, curCmb - cost),
      };
      Object.assign(src, patch);
      _patchShape(srcId);
      await updateDoc(_tokRef(srcId), patch).catch(error => {
        Object.assign(src, { pm: curPm, pmCombat: curCmb });
        _patchShape(srcId);
        throw error;
      });
    }
  };
  const _deductPm = () => _deductCost(_costRes, opt.pmCost, opt.label);
  const _techniqueCosts = selectedTechniques
    .filter(technique => technique.resourceType !== 'none' && technique.resourceCost > 0)
    .map(technique => ({
      resource: technique.resourceType,
      amount: Math.max(0, parseInt(technique.resourceCost, 10) || 0),
      label: technique.label,
    }));
  const _deductTechniqueCosts = async () => {
    // Séquentiel par intention : deux techniques peuvent débiter la même jauge.
    // Chaque dépense relit alors la valeur optimiste de la précédente.
    for (const cost of _techniqueCosts) await _deductCost(cost.resource, cost.amount, cost.label);
  };
  const _deductAllCosts = async () => {
    await _deductPm();
    await _deductTechniqueCosts();
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
    const consumedItem = inv[idx];
    const historyPatch = inventoryHistoryPayload(c, makeInventoryHistoryEntry('consume', consumedItem, 1, {
      actorUid: STATE.user?.uid || '',
      actorName: STATE.user?.pseudo || STATE.user?.displayName || STATE.user?.email || '',
      source: 'VTT',
      note: opt.nom || opt.label || '',
    }));
    inv.splice(idx, 1);
    const previousInventory = c.inventaire;
    const previousHistory = c.inventoryHistory;
    c.inventaire = inv;
    c.inventoryHistory = historyPatch.inventoryHistory;
    await updateDoc(_chrRef(_srcChar.id), { inventaire: inv, ...historyPatch }).catch(error => {
      c.inventaire = previousInventory;
      c.inventoryHistory = previousHistory;
      throw error;
    });
    showNotif(`🧪 ${meta.itemNom || 'Objet'} consommé`, 'info');
  };
  const _markActionUsed = async () => {
    const combat = VS.session?.combat;
    const patch = {};
    if (combat?.active) {
      const field = opt.actionType === 'bonus'
        ? 'bonusActionThisTurn'
        : opt.actionType === 'reaction'
          ? 'reactionThisTurn'
          : 'attackedThisTurn';
      patch[field] = true;
      const spellCooldowns = _vttCooldownPatch(src, opt);
      if (spellCooldowns) patch.spellCooldowns = spellCooldowns;
    }
    const round = Math.max(0, parseInt(combat?.round, 10) || 0);
    const cooldowns = { ...(src.techniqueCooldowns || {}) };
    const combatKey = combat?.techniqueCombatKey || null;
    const combatUses = src.techniqueCombatKey === combatKey ? { ...(src.techniqueCombatUses || {}) } : {};
    const sessionKey = VS.session?.techniqueSessionKey || 'legacy';
    const sessionUses = src.techniqueSessionKey === sessionKey ? { ...(src.techniqueSessionUses || {}) } : {};
    let hasCooldown = false, hasCombatUses = false, hasSessionUses = false;
    for (const technique of selectedTechniques) {
      const key = _vttTechniqueKey(technique);
      if (combat?.active && technique.cooldownRounds > 0) {
        cooldowns[key] = round + technique.cooldownRounds;
        hasCooldown = true;
      }
      if (combat?.active && technique.usageScope === 'combat' && technique.maxUses > 0) {
        combatUses[key] = (parseInt(combatUses[key], 10) || 0) + 1;
        hasCombatUses = true;
      }
      if (technique.usageScope === 'session' && technique.maxUses > 0) {
        sessionUses[key] = (parseInt(sessionUses[key], 10) || 0) + 1;
        hasSessionUses = true;
      }
    }
    if (hasCooldown) patch.techniqueCooldowns = cooldowns;
    if (hasCombatUses) Object.assign(patch, { techniqueCombatKey: combatKey, techniqueCombatUses: combatUses });
    if (hasSessionUses) Object.assign(patch, { techniqueSessionKey: sessionKey, techniqueSessionUses: sessionUses });
    if (!Object.keys(patch).length) return;
    const previous = Object.fromEntries(Object.keys(patch).map(key => [key, src[key]]));
    Object.assign(src, patch);
    if (VS.selected === src.id) _renderInspectorSoon();
    await updateDoc(_tokRef(src.id), patch).catch(error => {
      Object.assign(src, previous);
      if (VS.selected === src.id) _renderInspectorSoon();
      throw error;
    });
  };
  const _cleanup = () => {
    _setAttackRing(srcId, false);
    _setSelectionRing(VS.selected, false);
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

    for (const technique of selectedTechniques) {
      if (!_vttTechniqueAvailability(technique, src).available) {
        showNotif(`⚠ ${technique.label} n’est plus disponible.`, 'error');
        return;
      }
    }

    // Le coût du sort et ceux des deux techniques sont contrôlés ensemble.
    // Une jauge à 5 PM ne peut donc pas valider un sort à 4 PM + une technique à 2 PM.
    const requiredResources = new Map();
    const addRequired = (resource, amount) => {
      const cost = Math.max(0, parseInt(amount, 10) || 0);
      if (cost > 0 && resource !== 'none') requiredResources.set(resource, (requiredResources.get(resource) || 0) + cost);
    };
    addRequired(_costRes, opt.pmCost);
    _techniqueCosts.forEach(cost => addRequired(cost.resource, cost.amount));
    const availableResource = resource => {
      if (_pmPayerCharId) return _charResCur(VS.characters[_pmPayerCharId], resource);
      if (resource === 'pv') return _live(src).displayHp ?? 0;
      if (resource === 'or') return 0;
      if (_pmPayerToken) return Math.max(0, _numOr(_pmPayerToken.pm, _numOr(_pmPayerToken.pmMax, 0)));
      if (_pmPayerNpcId) {
        const npc = VS.npcs[_pmPayerNpcId];
        return _numOr(npc?.pmCurrent, _numOr(npc?.pmMax, _numOr(npc?.pm, 0)));
      }
      return src.beastId ? Math.max(0, _numOr(src.pm, _numOr(VS.bestiary[src.beastId]?.pmMax, 0))) : 0;
    };
    for (const [resource, required] of requiredResources) {
      const available = availableResource(resource);
      if (available < required) {
        const label = _RES_LABEL[resource] || resource;
        showNotif(`⚠ ${label} insuffisant${label === 'PM' || label === 'PV' ? 's' : ''} (${available}/${required} requis)`, 'error');
        return;
      }
    }

    // ── Vérification PM sur la réserve choisie pour l'invocation ──
    if (opt.pmCost > 0 && _pmPayerToken) {
      const actualPm = Math.max(0, _numOr(_pmPayerToken.pm, _numOr(_pmPayerToken.pmMax, 0)));
      if (actualPm < opt.pmCost) {
        showNotif(`⚠ PM insuffisants de l’invocation (${actualPm}/${opt.pmCost} requis)`, 'error');
        return;
      }
    }
    if (opt.pmCost > 0 && _pmPayerCharId) {
      const cPm = VS.characters[_pmPayerCharId];
      if (cPm) {
        const actualPm = _charResCur(cPm, _costRes);
        if (actualPm < opt.pmCost) {
          const _who = src.summonOwnerId ? ' du lanceur' : '';
          const _lbl = _RES_LABEL[_costRes] || 'PM';
          showNotif(`⚠ ${_lbl} insuffisant${_lbl === 'PM' || _lbl === 'PV' ? 's' : ''}${_who} (${actualPm}/${opt.pmCost} requis)`, 'error');
          return;
        }
      }
    }
    if (opt.pmCost > 0 && _pmPayerNpcId) {
      const nPm = VS.npcs[_pmPayerNpcId];
      if (nPm) {
        const maxPm = _numOr(nPm.pmMax, _numOr(nPm.pm, 0));
        const actualPm = _numOr(nPm.pmCurrent, maxPm);
        if (actualPm < opt.pmCost) {
          showNotif(`⚠ PM insuffisants (${actualPm}/${opt.pmCost} requis)`, 'error');
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
        const previous = src.buffs || [];
        const buffs = [...existing, suspBuff];
        _vttPatchTokenOptimistically(srcId, { buffs });
        void updateDoc(_tokRef(srcId), { buffs }).catch(error => {
          _vttPatchTokenOptimistically(srcId, { buffs: previous });
          console.error('[vtt] sort suspendu non appliqué', error);
        });
        showNotif(`🔮 ${opt.label} suspendu — version gratuite dispo dans tes sorts (${graceTurns} tours)`, 'success');
        _cleanup();
        return;
      }
      // Version gratuite : retire le buff (consommé), puis l'effet onHit s'exécute
      // normalement (coût déjà 0). Pas de return → on continue le flux d'attaque.
      const remaining = (src.buffs || []).filter(b => !_suspMatch(b));
      const previous = src.buffs || [];
      _vttPatchTokenOptimistically(srcId, { buffs: remaining });
      void updateDoc(_tokRef(srcId), { buffs: remaining }).catch(error => {
        _vttPatchTokenOptimistically(srcId, { buffs: previous });
        console.error('[vtt] sort suspendu non consommé', error);
      });
    }

    // ── Combo Coup de chance : applique le buff lucky_reroll à l'allié ciblé ──
    if (opt.mods?.coupChance) {
      const sourceWrites = Promise.all([_deductPm(), _consumeItem(), _markActionUsed()]);
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
      const buffWrites = [];
      for (const tid of targetIds) {
        const td = VS.tokens[tid]?.data;
        if (!td || td.type === 'enemy') continue;
        const existing = (td.buffs || []).filter(b => !(b.type === 'lucky_reroll' && b.sortLabel === opt.label));
        const previous = td.buffs || [];
        const buffs = [...existing, luckBuff];
        td.buffs = buffs;
        _patchShape(tid);
        buffWrites.push(updateDoc(_tokRef(tid), { buffs }).catch(error => {
          td.buffs = previous;
          _patchShape(tid);
          console.error('[vtt] Coup de chance non appliqué', error);
        }));
        appliedTargets.push(_live(td).displayName ?? td.name);
      }
      if (!appliedTargets.length) {
        await sourceWrites;
        showNotif('Choisis un allié pour Coup de chance.', 'error');
        _cleanup();
        return;
      }
      await _vttApplyCasterConcentration(srcId, opt);
      const targetsLabel = appliedTargets.join(', ');
      const logWrite = _publishCombatLog({
        ..._statsLogMeta(opt),
        type: 'cast',
        undo: _undoSnap,
        ..._vttLogSourceFields(src),
        ..._vttLogSingleTargetFields(targetIds),
        authorId: STATE.user?.uid||null, authorName,
        casterName: lS.displayName??src.name,
        characterImage: _combatLogImage(lS.displayImage),
        targetName: targetsLabel,
        optLabel: opt.label, pmCost: opt.pmCost,
        castEffect: '🍀 1 relance automatique sur le prochain jet échoué',
        createdAt: serverTimestamp(),
      }).catch(()=>{});
      await Promise.all([sourceWrites, ...buffWrites, logWrite]);
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
      const previous = src.buffs || [];
      const buffs = [...existing, wrBuff];
      _vttPatchTokenOptimistically(srcId, { buffs });
      void updateDoc(_tokRef(srcId), { buffs }).catch(error => {
        _vttPatchTokenOptimistically(srcId, { buffs: previous });
        console.error('[vtt] arme invoquée non appliquée', error);
      });
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
    // Réussite automatique (mjAutoHit) : pas de d20 → ni échec critique (buff raté,
    // objet consommé pour rien) ni réussite critique. L'enchantement s'applique.
    if (opt.isEnchant && !opt.autoHit) {
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
        const sourceWrites = Promise.all([_deductPm(), _consumeItem(), _markActionUsed()]);
        const failedStatsDelta = _applyCastStatsDelta(src, opt, {
          natural: _enchD20, result: _enchD20, fumble: true,
        });
        const ecTgt = targetIds.map(id => { const td = VS.tokens[id]?.data; return td ? (_live(td).displayName ?? td.name) : null; })
          .filter(Boolean).join(', ') || (lT?.displayName ?? tgt?.name ?? '');
        const logWrite = _publishCombatLog({
          ..._statsLogMeta(opt),
          type: 'cast', undo: _undoSnap,
          ...(_hasStatsDelta(failedStatsDelta) ? { statsDelta: failedStatsDelta } : {}),
          ..._vttLogSourceFields(src),
          ..._vttLogSingleTargetFields(targetIds),
          authorId: STATE.user?.uid||null, authorName,
          casterName: lS.displayName??src.name,
          characterImage: _combatLogImage(lS.displayImage),
          targetName: ecTgt,
          optLabel: opt.label, pmCost: opt.pmCost,
          castD20: _enchD20, castIsCrit: false, castIsFumble: true, castEC: true,
          castEffect: `💔 Échec critique (d20 = 1) — sort raté${opt.pmCost>0?`, ${opt.pmCost} ${_RES_LABEL[_costRes]||'PM'} perdus`:''}`,
          createdAt: serverTimestamp(),
        }).catch(()=>{});
        await Promise.all([sourceWrites, logWrite]);
        showNotif(`💔 Échec critique ! ${opt.label} raté${opt.pmCost>0?` — ${opt.pmCost} ${_RES_LABEL[_costRes]||'PM'} perdus`:''}`, 'error');
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
      const sourceWrites = Promise.all([_deductPm(), _consumeItem(), _markActionUsed()]);
      const rCa = _handleMultiCast();
      const _utilStatsDelta = _preAppliedCastStatsDelta || _applyCastStatsDelta(src, opt, {
        natural: _enchD20,
        result: _enchD20,
        crit: _enchRC,
      });


      // Appliquer le buff CA sur chaque cible
      const buffResults = [];
      const effectWrites = [];
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
          const previous = curTgtData.buffs || [];
          const buffs = [...existingBuffs, newBuff];
          curTgtData.buffs = buffs;
          _patchShape(curTgtId);
          effectWrites.push(updateDoc(_tokRef(curTgtId), { buffs }).catch(error => {
            curTgtData.buffs = previous;
            _patchShape(curTgtId);
            console.error('[vtt] bonus de CA non appliqué', error);
          }));
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
        await Promise.all([sourceWrites, ...effectWrites, _publishCombatLog({
          ..._statsLogMeta(opt),
          type: 'cast',
          undo: _undoSnap,
          ...(_hasStatsDelta(_utilStatsDelta) ? { statsDelta: _utilStatsDelta } : {}),
          ..._vttLogSourceFields(src),
          ..._vttLogSingleTargetFields(targetIds),
          authorId: STATE.user?.uid||null, authorName,
          casterName: lS.displayName??src.name,
          characterImage: _combatLogImage(lS.displayImage),
          targetName: targetsLabel,
          optLabel: opt.label, pmCost: opt.pmCost,
          ...(_enchD20 != null ? { castD20: _enchD20, castIsCrit: _enchRC, castIsFumble: false } : {}),
          castEffect,
          createdAt: serverTimestamp(),
        }).catch(()=>{})]);
      } else {
        await Promise.all([sourceWrites, ...effectWrites]);
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
      // Recalculé au clic : un ennemi peut avoir bougé depuis l'ouverture de la modale.
      const hStyleMods = _combatStyleContext(src, tgt, opt).modifiers;
      const hHasAdv = mode === 'adv' || hCondMods.hasAdv || hStyleMods.hasAdv;
      const hHasDis = mode === 'dis' || hCondMods.hasDis || hStyleMods.hasDis;
      if (hHasAdv && hHasDis) hMode = 'normal';
      else if (hHasAdv) hMode = 'adv';
      else if (hHasDis) hMode = 'dis';
      const hAutomaticReasons = [...hCondMods.reasons, ...hStyleMods.reasons];
      // Roll d20 avec mode adv/dis
      const hRoll1 = Math.floor(Math.random()*20)+1;
      const hRoll2 = hMode !== 'normal' ? Math.floor(Math.random()*20)+1 : null;
      // Total : d20 + mod toucher + bonus set + bonus contextuel
      const hTouchMod = opt.toucherMod || 0;
      const hSetBon   = opt.toucherSetBonus || 0;
      let hD20   = hMode === 'adv' ? Math.max(hRoll1, hRoll2)
                 : hMode === 'dis' ? Math.min(hRoll1, hRoll2)
                 : hRoll1;
      const hExtraHitRolls = [];
      let hExtraHitSum = 0;
      if (bonusHitDice !== 0) {
        const cnt = Math.abs(bonusHitDice);
        for (let k = 0; k < cnt; k++) {
          const r = Math.floor(Math.random() * 20) + 1;
          hExtraHitRolls.push(r);
          hExtraHitSum += bonusHitDice > 0 ? r : -r;
        }
      }
      let hHitTotal = hD20 + hTouchMod + hSetBon + bonusHit + hExtraHitSum;
      const hLuck = await _consumeLuckyReroll(srcId, src, hD20, hD20 === 1 || hHitTotal < HEAL_DD);
      if (hLuck) {
        hD20 = hLuck.d20;
        hHitTotal = hD20 + hTouchMod + hSetBon + bonusHit + hExtraHitSum;
      }
      // Combo Chance : élargit la plage critique (RC abaissé sur le sort)
      const hCritThreshold = Math.max(2, Math.min(20, (opt.mods?.chance?.rc ?? 20) - _conditionCritRangeBonusOf(src)));
      // Réussite automatique (mjAutoHit) : le soin réussit toujours — ni échec
      // critique (potion consommée pour rien) ni réussite critique.
      const hIsCrit   = !opt.autoHit && hD20 >= hCritThreshold;
      const hIsFumble = !opt.autoHit && hD20 === 1;

      const diceToRoll   = opt.rawDice || opt.dice;
      const effectiveDice = _effectiveDmgDice(diceToRoll);
      const healFixed    = _optionFixedBonus(opt) + bonusDmg;

      // PM toujours consommé (même sur échec critique) — le mana brûle quand on tente le sort
      const healSourceWrites = Promise.all([_deductPm(), _consumeItem(), _markActionUsed()]);

      // ── Échec critique : sort raté, aucun soin appliqué ─────────────
      if (hIsFumble) {
        const tgtNames = targetIds.map(tid => _live(VS.tokens[tid]?.data || {}).displayName).filter(Boolean).join(', ');
        // Stats : soin raté → compte quand même 1 sort lancé + PM (soin 0), réversible.
        const _healDelta = { chars: {} };
        const _healActor = _statsActor(src);
        if (_healActor.id && opt.countInStats !== false) {
          accCastDelta(_healDelta, {
            casterId: _healActor.id, casterName: _healActor.name,
            spellName: opt.label || 'Soin', pm: ((opt.costRes||'pm')==='pm' ? (opt.pmCost||0) : 0), heal: 0,
            natural: hD20, result: hHitTotal, fumble: true,
          });
          applyStatsDelta(_healDelta, +1);
        }
        const logWrite = _publishCombatLog({
          ..._statsLogMeta(opt),
          type: 'attack', isHeal: true, isFumble: true, advMode: hMode, advAuto: hMode !== mode,
          advReasons: hMode !== mode ? hAutomaticReasons : null,
          undo: _undoSnap,
          ...(_hasStatsDelta(_healDelta) ? { statsDelta: _healDelta } : {}),
          ..._vttLogSourceFields(src),
          authorId: STATE.user?.uid||null, authorName,
          attackerName: lS.displayName??src.name,
          characterImage: _combatLogImage(lS.displayImage),
          defenderName: tgtNames || (lT.displayName??tgt.name),
          optLabel: opt.label,
          hitD20: hD20, hitRoll1: hRoll1, hitRoll2: hRoll2,
          hitD20rolls: hLuck ? [hRoll1, ...(hRoll2 != null ? [hRoll2] : []), hLuck.reroll] : (hRoll2 != null ? [hRoll1, hRoll2] : null),
          hitToucherMod: hTouchMod, hitToucherSetBonus: hSetBon,
          hitToucherStatLabel: opt.toucherStatLabel || '',
          hitBonus: bonusHit, bonusHitDice: bonusHitDice || null,
          extraHitRolls: hExtraHitRolls.length ? hExtraHitRolls : null,
          hitTotal: hHitTotal, healDD: HEAL_DD,
          dmgTotal: 0, newHp: null, hpMax: null,
          dmgFormula: opt.dice, pmCost: opt.pmCost || 0,
          createdAt: serverTimestamp(),
        }).catch(()=>{});
        await Promise.all([healSourceWrites, logWrite]);
        showNotif(`💔 Échec critique (${hD20}) — sort raté, ${opt.pmCost||0} ${_RES_LABEL[_costRes]||'PM'} consommés`, 'error');
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
      const healResults = (await Promise.all(targetIds.map(async curTgtId => {
        const curTgtData = VS.tokens[curTgtId]?.data; if (!curTgtData) return null;
        const lCur = _live(curTgtData);
        if (opt.isMana) {
          // Régénération de PM : même montant, appliqué sur la réserve de PM.
          const { applied, cur, max, write: _write } = await _restoreTokenPm(curTgtData, healTotal, { deferWrite: true });
          return {
            name: lCur.displayName ?? curTgtData.name,
            applied,
            _write,
            isMana: true, newPm: cur, pmMax: max,
            characterId: curTgtData.characterId || null,
            npcId: curTgtData.npcId || null,
            beastId: curTgtData.beastId || null,
            summonOwnerCharId: curTgtData.summonOwnerCharId || null,
            summonInvId: curTgtData.summonInvId || null,
            tokenId: curTgtData.id || curTgtId,
            targetImage: _combatLogImage(lCur.displayImage),
          };
        }
        // Résolution autoritative : les estimations joueur ne doivent jamais
        // modifier la quantité réellement rendue à une créature.
        const hpMax = _effectiveTokenHpMax(curTgtData) ?? 20;
        const curHp = Math.max(0, Math.min(hpMax, _effectiveTokenHp(curTgtData) ?? hpMax));
        const newHp = Math.min(hpMax, curHp + healTotal);
        // Le journal public fera évoluer l'estimation propre à chaque joueur.
        // Ne pas enregistrer l'estimation d'un joueur sur le token partagé.
        const _write = _setHp(curTgtData, newHp);
        return {
          name: lCur.displayName ?? curTgtData.name,
          applied: Math.max(0, newHp - curHp),
          _write,
          newHp, hpMax,
          characterId: curTgtData.characterId || null,
          npcId: curTgtData.npcId || null,
          beastId: curTgtData.beastId || null,
          summonOwnerCharId: curTgtData.summonOwnerCharId || null,
          summonInvId: curTgtData.summonInvId || null,
          tokenId: curTgtData.id || curTgtId,
          targetImage: _combatLogImage(lCur.displayImage),
        };
      }))).filter(Boolean);
      const healTargetWrites = healResults.map(result => result._write).filter(Boolean);
      const cleanHealResults = healResults.map(({ _write, ...result }) => result);
      // soin RÉEL cumulé (hors surplus au-delà du max) pour les stats
      const _healActual = cleanHealResults.reduce((total, result) => total + (result.applied || 0), 0);
      // Statistiques (soin) : 1 sort lancé + PM + soin réel, réversible à l'annulation.
      const _healDelta = { chars: {} };
      const _healActor = _statsActor(src);
      if (_healActor.id && opt.countInStats !== false) {
        accCastDelta(_healDelta, {
          casterId: _healActor.id, casterName: _healActor.name,
          spellName: opt.label || 'Soin', pm: ((opt.costRes||'pm')==='pm' ? (opt.pmCost||0) : 0),
          heal: opt.isMana ? 0 : _healActual, mana: opt.isMana ? _healActual : 0,
          natural: hD20, result: hHitTotal, crit: hIsCrit,
        });
        applyStatsDelta(_healDelta, +1);
      }

      const isMultiHeal = cleanHealResults.length > 1;
      const _healIco = opt.isMana ? '💙' : '💚';
      const _healUnit = opt.isMana ? 'PM régénérés' : 'PV soignés';
      const critTag = hIsCrit ? ' 💥 CRITIQUE' : '';
      const luckTag = hLuck ? ` 🍀 Relance ${hLuck.reroll}→${hD20}` : '';
      // Payload commun pour le log (jet de toucher détaillé)
      const hitPayload = {
        isCrit: hIsCrit, isFumble: false, advMode: hMode, advAuto: hMode !== mode,
        advReasons: hMode !== mode ? hAutomaticReasons : null,
        hitD20: hD20, hitRoll1: hRoll1, hitRoll2: hRoll2,
        hitD20rolls: hLuck ? [hRoll1, ...(hRoll2 != null ? [hRoll2] : []), hLuck.reroll] : (hRoll2 != null ? [hRoll1, hRoll2] : null),
        hitToucherMod: hTouchMod, hitToucherSetBonus: hSetBon,
        hitToucherStatLabel: opt.toucherStatLabel || '',
        hitBonus: bonusHit, bonusHitDice: bonusHitDice || null,
        extraHitRolls: hExtraHitRolls.length ? hExtraHitRolls : null,
        hitTotal: hHitTotal, healDD: HEAL_DD,
      };
      let healLogWrite = Promise.resolve();

      if (isMultiHeal) {
        healLogWrite = _publishCombatLog({
          ..._statsLogMeta(opt),
          type: 'attack-multi', isHeal: true, isMana: !!opt.isMana,
          undo: _undoSnap,
          ...(_hasStatsDelta(_healDelta) ? { statsDelta: _healDelta } : {}),
          ..._vttLogSourceFields(src),
          authorId: STATE.user?.uid||null, authorName,
          attackerName: lS.displayName??src.name,
          characterImage: _combatLogImage(lS.displayImage),
          optLabel: opt.label,
          ...hitPayload,
          dmgFormula: opt.dice, dmgRawDice: opt.rawDice||null,
          dmgEffectiveDice: bonusDmgDice ? effectiveDice : null,
          dmgFormulaBonus: opt.formulaFixedBonus??0,
          dmgStatMod: opt.dmgStatMod??null, dmgStatLabel: opt.dmgStatLabel??null,
          dmgMaitriseBonus: opt.maitriseBonus??0,
          dmgRaw: healRaw, dmgBonus: bonusDmg, dmgBonusDice: bonusDmgDice||null,
          dmgRollsDetail: healRollsDetail || null,
          critRollsDetail: healCritRollsDetail || null,
          critFormula: criticalEffectFormulaLabel(),
          ..._diceLogFields('dmg', healRollsDetail),
          ..._diceLogFields('crit', healCritRollsDetail),
          critNormalMax: healCritNormalMax || 0,
          healTotal,
          targets: cleanHealResults.map(r => ({ ...r, hit: true, halfDmg: false, dmgTotal: healTotal, targetCA: HEAL_DD })),
          createdAt: serverTimestamp(),
        }).catch(()=>{});
        showNotif(`${_healIco}${critTag}${luckTag} ${healTotal} ${_healUnit} → ${cleanHealResults.map(r=>r.name).join(', ')}`, 'success');
      } else {
        const r = cleanHealResults[0];
        if (r) {
          healLogWrite = _publishCombatLog({
            ..._statsLogMeta(opt),
            type:'attack', isHeal:true, isMana: !!opt.isMana,
            undo: _undoSnap,
            ...(_hasStatsDelta(_healDelta) ? { statsDelta: _healDelta } : {}),
            ..._vttLogSourceFields(src),
            authorId: STATE.user?.uid||null, authorName,
            attackerName: lS.displayName??src.name,
            characterImage: _combatLogImage(lS.displayImage),
            defenderName: r.name,
            // Le portrait complet reste résolu depuis le token/la fiche au rendu.
            // Ne jamais embarquer une image data:/blob: dans le document de log.
            defenderImage: _combatLogImage(_live(tgt)?.displayImage || r.targetImage),
            defenderTokenId: r.tokenId || null,
            tokenId: r.tokenId || null,
            characterId: tgt?.characterId || null,
            npcId: tgt?.npcId || null,
            beastId: tgt?.beastId || null,
            summonOwnerCharId: r.summonOwnerCharId || tgt?.summonOwnerCharId || null,
            summonInvId: r.summonInvId || tgt?.summonInvId || null,
            optLabel: opt.label,
            ...hitPayload,
            dmgFormula: opt.dice, dmgRawDice: opt.rawDice||null,
            dmgEffectiveDice: bonusDmgDice ? effectiveDice : null,
            dmgFormulaBonus: opt.formulaFixedBonus??0,
            dmgStatMod: opt.dmgStatMod??null, dmgStatLabel: opt.dmgStatLabel??null,
            dmgMaitriseBonus: opt.maitriseBonus??0,
            dmgRaw: healRaw, dmgBonus: bonusDmg, dmgBonusDice: bonusDmgDice||null,
            dmgRollsDetail: healRollsDetail || null,
            critRollsDetail: healCritRollsDetail || null,
            critFormula: criticalEffectFormulaLabel(),
            ..._diceLogFields('dmg', healRollsDetail),
            ..._diceLogFields('crit', healCritRollsDetail),
            critNormalMax: healCritNormalMax || 0,
            dmgTotal: healTotal, newHp: r.newHp ?? null, hpMax: r.hpMax ?? null,
            newPm: r.newPm ?? null, pmMax: r.pmMax ?? null,
            createdAt: serverTimestamp(),
          }).catch(()=>{});
          showNotif(`${_healIco}${critTag}${luckTag} ${healTotal} ${_healUnit} → ${r.name}`, 'success');
        }
      }
      await Promise.all([healSourceWrites, ...healTargetWrites, healLogWrite]);
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
    // Recalculé au clic : un ennemi peut avoir bougé depuis l'ouverture de la modale.
    const styleMods = _combatStyleContext(src, tgt, opt).modifiers;
    const hasAdv = mode === 'adv' || condMods.hasAdv || styleMods.hasAdv;
    const hasDis = mode === 'dis' || condMods.hasDis || styleMods.hasDis;
    if (hasAdv && hasDis) effectiveMode = 'normal';
    else if (hasAdv) effectiveMode = 'adv';
    else if (hasDis) effectiveMode = 'dis';
    const automaticReasons = [...condMods.reasons, ...styleMods.reasons];
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
    let hitTotal = d20 + atkBase + bonusHit + extraHitSum + _touchBuff + techniqueAttackModifier;
    const rules      = opt.typeRules || {};
    const armorPen   = rules.armorPen || 0;
    const typeDmgBon = rules.dmgBonus || 0;
    // missEffect est résolu depuis la règle du type pour tous les attaquants :
    // personnage, PNJ ou créature du bestiaire. Un type marqué magique suffit à
    // qualifier une attaque élémentaire, même sans arme de PJ ni coût en mana.
    let   missEffect = _effectiveMissEffect(opt);
    // Règle générale : tout sort / compétence qui consomme du mana fait au moins
    // ½ dégâts (arrondi inf.) en cas d'échec. Si le type de dégâts définit déjà
    // 'half' ou 'full', on respecte (pas de cumul, on ne dégrade pas non plus).
    if (missEffect === 'none' && opt.pmCost > 0) missEffect = 'half';

    const targetCas = targetIds.map(curTgtId => {
      const curTgtData = VS.tokens[curTgtId]?.data;
      const lCurTgt = _live(curTgtData || {});
      const rawCA = lCurTgt.realDefense ?? lCurTgt.displayDefense ?? 10;
      const effectiveCA = armorPen > 0 ? Math.round(rawCA * (1 - armorPen / 100)) : rawCA;
      return combinedTechniqueTargetCA(effectiveCA, selectedTechniques);
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
      hitTotal = d20 + atkBase + bonusHit + extraHitSum + _touchBuff + techniqueAttackModifier;
      luckUsed = true;
    }
    // Touche automatique : aucun jet de toucher → toujours touché, ni critique ni
    // échec (les dégâts restent normaux, roulés ensuite comme d'habitude).
    if (opt.autoHit) { isCrit = false; isFumble = false; }

    const diceToRoll    = opt.rawDice || opt.dice;
    const effectiveDice = _effectiveDmgDice(diceToRoll);
    const dmgFixed      = _optionFixedBonus(opt);
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

    // Chaque famille peut fournir une technique : une technique d'arme ET une
    // technique élémentaire peuvent donc être actives sur la même attaque.
    // Leurs dégâts sont tirés séparément afin que seule la technique portant
    // réellement une explosion propage sa propre part autour de la cible.
    const primaryOutcomes = new Map(targetIds.map(curTgtId => {
      const curTgtData = VS.tokens[curTgtId]?.data;
      if (!curTgtData || blockedTargets.has(curTgtId)) return [curTgtId, {
        hit: false, isCrit, isFumble, blocked: blockedTargets.has(curTgtId),
      }];
      const lCurTgt = _live(curTgtData);
      const rawCA = lCurTgt.realDefense ?? lCurTgt.displayDefense ?? 10;
      const effectiveCA = armorPen > 0 ? Math.round(rawCA * (1 - armorPen / 100)) : rawCA;
      const targetCA = combinedTechniqueTargetCA(effectiveCA, selectedTechniques);
      const hit = attackRollHitsTarget({ hitTotal, targetCA, autoHit: opt.autoHit, isCrit, isFumble });
      return [curTgtId, { hit, isCrit, isFumble, targetCA }];
    }));
    // Garde : chaque cible directe qui pare le coup par sa CA (jet < CA, hors
    // critique/maladresse/auto-touche) gagne +1 Garde si elle a la mécanique.
    if (!opt.autoHit && !isCrit && !isFumble) {
      for (const [curTgtId, oc] of primaryOutcomes) {
        if (oc.hit || oc.blocked || oc.targetCA == null) continue;
        if (hitTotal >= oc.targetCA) continue; // vrai blocage par la CA uniquement
        _awardGardeOnBlock(VS.tokens[curTgtId]?.data);
      }
    }
    const techniqueRolls = [];
    for (const technique of selectedTechniques) {
      const triggerOriginIds = targetIds.filter(id => techniqueTriggerApplies(technique, primaryOutcomes.get(id)));
      if (triggerOriginIds.length) {
        const damageDetails = [];
        let damageBonus = 0;
        const scalingStatModifier = _tokenStatMod(src, technique.scalingStat || 'force');
        const sourceLevel = Math.max(1, parseInt(
          _srcChar?.niveau ?? VS.npcs[src.npcId]?.niveau ?? VS.bestiary[src.beastId]?.niveau ?? src.summonLevel ?? 1,
          10,
        ) || 1);
        for (const term of weaponTechniqueDamageTerms(technique, effectiveDice, opt.dmgStatMod, {
          level: sourceLevel,
          masteryBonus: opt.maitriseBonus || 0,
          statModifier: scalingStatModifier,
        })) {
          if (Object.hasOwn(term, 'flat')) {
            damageBonus += term.flat;
            damageDetails.push({ rolls: [], mod: term.flat, total: term.flat, n: 0, sides: 0, kind: term.kind, formula: String(term.flat) });
            continue;
          }
          const det = _rollDiceDetailed(term.formula);
          damageBonus += Math.max(0, det.total);
          damageDetails.push({ ...det, kind: term.kind, formula: term.formula });
        }
        damageBonus = Math.max(0, damageBonus);
        if (isCrit && technique.criticalMode === 'double') damageBonus *= 2;
        techniqueRolls.push({ technique, damageBonus, damageDetails, triggerOriginIds });
      }
    }

    // L'explosion part uniquement des cibles principales pour lesquelles la
    // technique s'applique (touche, ou échec explicitement autorisé).
    // Les victimes secondaires partagent le jet de toucher initial, mais celui-ci
    // sera comparé séparément à leur propre CA lors de la résolution.
    const splashDamageByTarget = new Map();
    const splashTechniquesByTarget = new Map();
    for (const roll of techniqueRolls) {
      if ((parseInt(roll.technique?.blastRadius, 10) || 0) <= 0) continue;
      for (const originId of roll.triggerOriginIds) {
        const multiplier = techniqueOutcomeMultiplier(roll.technique, primaryOutcomes.get(originId));
        const damageBonus = Math.max(0, Math.floor(roll.damageBonus * multiplier));
        const splashIds = _vttTechniqueSplashTargets(roll.technique, [originId], srcId)
            .filter(id => !primaryTargetSet.has(id));
        for (const id of splashIds) {
          const previous = splashTechniquesByTarget.get(id) || [];
          const existing = previous.find(item => item.id === roll.technique.id && item.source === roll.technique._source);
          if (existing) {
            // Plusieurs zones identiques peuvent se recouvrir : une technique ne
            // frappe qu'une fois, avec le meilleur multiplicateur disponible.
            existing.damageBonus = Math.max(existing.damageBonus, damageBonus);
          } else {
            previous.push({
              id: roll.technique.id,
              source: roll.technique._source || 'weapon',
              icon: roll.technique.icon || '💥',
              label: roll.technique.label,
              damageBonus,
            });
          }
          splashTechniquesByTarget.set(id, previous);
          splashDamageByTarget.set(id, previous.reduce((total, item) => total + item.damageBonus, 0));
        }
      }
    }
    const splashTargetIds = [...splashDamageByTarget.keys()];
    const splashOutcomes = new Map(splashTargetIds.map(curTgtId => {
      const curTgtData = VS.tokens[curTgtId]?.data;
      if (!curTgtData) return [curTgtId, { hit: false, isCrit, isFumble, targetCA: null }];
      const lCurTgt = _live(curTgtData);
      const rawCA = lCurTgt.realDefense ?? lCurTgt.displayDefense ?? 10;
      const effectiveCA = armorPen > 0 ? Math.round(rawCA * (1 - armorPen / 100)) : rawCA;
      const targetCA = combinedTechniqueTargetCA(effectiveCA, selectedTechniques);
      const hit = attackRollHitsTarget({ hitTotal, targetCA, autoHit: opt.autoHit, isCrit, isFumble });
      return [curTgtId, { hit, isCrit, isFumble, targetCA }];
    }));
    const resolutionTargetIds = [...targetIds, ...new Set(splashTargetIds)];
    if (splashTargetIds.length) {
      const color = opt.damageTypeColor || '#f97316';
      splashTargetIds.filter(id => splashOutcomes.get(id)?.hit).forEach(id => _playImpactForToken(id, color));
    }

    // Montrer la zone réelle de chaque technique qui vient de se déclencher.
    // Les zones identiques (ex. origine « lanceur » en multicible) sont dédupliquées.
    const techniqueAreas = [];
    const techniqueAreaKeys = new Set();
    for (const roll of techniqueRolls) {
      if ((parseInt(roll.technique?.blastRadius, 10) || 0) <= 0) continue;
      for (const originId of roll.triggerOriginIds) {
        const area = _techniqueAreaFxData(roll.technique, originId, srcId, opt);
        if (!area) continue;
        const key = [area.shape, area.x, area.y, area.width, area.height, area.rotation, area.label].join('|');
        if (techniqueAreaKeys.has(key)) continue;
        techniqueAreaKeys.add(key);
        techniqueAreas.push(area);
      }
    }
    if (techniqueAreas.length) {
      _playTechniqueAreaFx(techniqueAreas);
      try {
        const uid = STATE.user?.uid;
        if (uid) {
          const n = Date.now();
          _seenTechniqueFire[uid] = n;
          setDoc(_castingRef(uid), {
            techniqueFire: { n, pageId: VS.activePage?.id || null, areas: techniqueAreas },
          }, { merge: true }).catch(() => {});
        }
      } catch {}
    }

    // ── Bonus dégâts depuis buff d'enchantement arme actif sur le lanceur ──
    // Règles :
    //  • S'applique aux Actions uniquement (attaques d'arme + sorts type 'action').
    //    Exclu : Actions Bonus, Réactions (actionType === 'bonus' / 'reaction')
    //  • Bonus appliqué UNIQUEMENT sur un coup réussi (pas sur les demi-dégâts).
    //  • Non cumulable : un seul buff dmg_bonus actif (le dernier appliqué wins,
    //    déjà garanti par _vttApplyEnchantBuffs qui retire les anciens).
    const _eligibleForEnchant = receivesOffensiveDamageBonus(opt);
    let buffDmgBonus = 0;
    const buffDmgNotes = [];
    let buffDmgDetail = null; // { formula, rolls, mod, total, sortLabel, element }
    if (_eligibleForEnchant && !isFumble) {
      const round_eff = VS.session?.combat?.round ?? 0;
      const srcDmgCondition = _conditionDmgBonusOf(src, opt);
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

    const sourceWritesDone = Promise.all([_deductAllCosts(), _consumeItem(), _markActionUsed()])
      .then(() => null, error => error);

    // ── Appliquer les HP + collecter résultats par cible ──────────────
    const targetResults = [];
    const targetWritePromises = [];
    const techniqueSaveLogs = [];
    const _statsDelta = { chars: {} };   // delta de stats accumulé (réversible à l'annulation)
    const _statsEnabled = opt.countInStats !== false;
    const _atkActor = _statsActor(src);
    let _maxHit = 0;                      // plus gros coup de cette attaque (record, non réversible)
    for (const curTgtId of resolutionTargetIds) {
      const curTgtData = VS.tokens[curTgtId]?.data;
      if (!curTgtData) continue;
      const lCurTgt = _live(curTgtData);
      const isTechniqueSplash = !primaryTargetSet.has(curTgtId);

      // ⚠️ TOUJOURS la VRAIE CA (realDefense), JAMAIS l'estimation du joueur.
      // Si un joueur attaque, lCurTgt.displayDefense renverrait son estimation
      // (track.caEstimee) — ce qui fausserait le hit/miss. On utilise realDefense
      // qui contourne ce filtre d'affichage.
      const rawCA    = lCurTgt.realDefense ?? lCurTgt.displayDefense ?? 10;
      const effectiveCA = armorPen > 0 ? Math.round(rawCA * (1 - armorPen / 100)) : rawCA;
      const targetCA = isTechniqueSplash
        ? (splashOutcomes.get(curTgtId)?.targetCA ?? combinedTechniqueTargetCA(effectiveCA, selectedTechniques))
        : combinedTechniqueTargetCA(effectiveCA, selectedTechniques);
      // Bouclier réactif : annule complètement l'attaque (pas de touche, pas de demi-dégâts, pas de fumble visuel)
      const isBlocked = blockedTargets.has(curTgtId);
      const hit      = isBlocked
        ? false
        : isTechniqueSplash
          ? (splashOutcomes.get(curTgtId)?.hit ?? false)
          : (primaryOutcomes.get(curTgtId)?.hit ?? false);
      const halfDmg  = !isTechniqueSplash && !isBlocked && !hit && missEffect !== 'none' && !isFumble;
      const applicableTechniqueRolls = isTechniqueSplash
        ? techniqueRolls.map(roll => {
          if (!hit) return null;
          const detail = splashTechniquesByTarget.get(curTgtId)?.find(item => item.id === roll.technique.id && item.source === (roll.technique._source || 'weapon'));
          return detail ? { ...roll, damageBonus: detail.damageBonus } : null;
        }).filter(Boolean)
        : techniqueRolls.map(roll => {
          const multiplier = techniqueOutcomeMultiplier(roll.technique, primaryOutcomes.get(curTgtId));
          return multiplier > 0 ? { ...roll, damageBonus: Math.max(0, Math.floor(roll.damageBonus * multiplier)) } : null;
        }).filter(Boolean);
      const techniqueDamageForTarget = applicableTechniqueRolls.reduce((total, roll) => total + roll.damageBonus, 0);
      let dmgTotal   = isTechniqueSplash
        ? techniqueDamageForTarget
        : (hit ? sharedDmgTotalHit : halfDmg ? sharedDmgTotalHalf : 0) + techniqueDamageForTarget;
      const damageBeforeTargetConditions = dmgTotal;
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
          if (!conditionDamageReductionApplies(lib?.effects, opt.damageTypeId || 'physique')) continue;
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
      let hpBeforeApplied = curHp;
      let targetWrite = Promise.resolve();
      // Valeur AVANT interaction du profil de la créature (pour log "10 → 5").
      let dmgPre = dmgTotal;
      let dmgReduction = 0;
      let damageBreakdown = [];
      const techniqueReductionRatio = damageBeforeTargetConditions > 0
        ? Math.min(1, Math.max(0, dmgTotal / damageBeforeTargetConditions)) : 0;
      const techniquePieces = applicableTechniqueRolls.filter(roll => roll.damageBonus > 0).map(roll => ({
        roll,
        amount: Math.max(0, Math.floor(roll.damageBonus * techniqueReductionRatio)),
      }));
      const techniqueRawTotal = techniquePieces.reduce((total, piece) => total + piece.amount, 0);
      const rawDamagePieces = [
        ...(dmgTotal - techniqueRawTotal > 0 ? [{
          label: opt.label || 'Attaque',
          icon: opt.damageTypeIcon || '⚔️',
          damageTypeId: opt.damageTypeId || 'physique',
          amount: dmgTotal - techniqueRawTotal,
          source: 'attack',
        }] : []),
        ...techniquePieces.map(({ roll, amount }) => {
          const typeId = roll.technique.damageTypeId || opt.damageTypeId || 'physique';
          const type = getDamageTypeById(VS.damageTypes, typeId);
          return {
            label: roll.technique.label,
            icon: type?.icon || roll.technique.icon || '🎯',
            damageTypeId: typeId,
            amount,
            source: 'technique',
          };
        }),
      ];
      const resolveDamagePieces = profile => {
        if (!profile || !rawDamagePieces.length) return dmgTotal;
        damageBreakdown = rawDamagePieces.map(piece => {
          const resolved = applyDamageTypeInteraction(piece.amount, piece.damageTypeId, profile);
          return { ...piece, resolved: resolved.dmgTotal, interaction: resolved.interaction || null };
        });
        const meaningful = damageBreakdown.find(piece => piece.interaction && piece.interaction !== 'Normal');
        interaction = meaningful?.interaction || null;
        return damageBreakdown.reduce((total, piece) => total + piece.resolved, 0);
      };
      if (hit || halfDmg) {
        if (curTgtData.type === 'enemy' && curTgtData.beastId) {
          const bEnt    = VS.bestiary[curTgtData.beastId];
          dmgTotal      = resolveDamagePieces(bEnt);

          const realMax = _numOr(bEnt?.pvMax, 20);
          const realCur = curTgtData.hp !== null ? _numOr(curTgtData.hp, realMax) : realMax;
          hpBeforeApplied = realCur;
          // Plafonner par realMax pour éviter qu'une absorption (dmgTotal négatif)
          // ne soigne au-dessus du PV max de la créature.
          newHp = Math.max(0, Math.min(realMax, realCur - dmgTotal));
          const playerEstimateMax = !STATE.isAdmin && lCurTgt.displayHpMax != null
            ? Math.max(0, Number(lCurTgt.displayHpMax) || 0)
            : null;
          const knownEstimate = VS.combatHpEstimates.get(curTgtData.id);
          const prevEst = knownEstimate?.current ?? playerEstimateMax;
          const estimateMax = knownEstimate?.max ?? playerEstimateMax ?? prevEst;
          const newEst = prevEst == null
            ? null
            : Math.max(0, Math.min(estimateMax, prevEst - dmgTotal));
          _showAppliedHpDelta(curTgtData, realCur, newHp, STATE.isAdmin ? newHp : newEst);
          _patchHpOptimistically(curTgtData, newHp);
          targetWrite = updateDoc(_tokRef(curTgtData.id), { hp:newHp })
            .then(() => _syncDownedCondition(curTgtData, newHp));
        } else {
          // Le registre VTT contient aussi les personnages des autres joueurs.
          // STATE.characters peut être volontairement limité au compte courant :
          // il ne suffit donc pas pour défendre une cible secondaire d'AoE.
          const tgtChar = curTgtData.characterId
            ? (VS.characters?.[curTgtData.characterId]
              || STATE.characters?.find?.(x => x.id === curTgtData.characterId))
            : null;
          // Résistances / immunités / absorptions / faiblesses accordées par
          // l'équipement du personnage (non cumulable — cf. getCharDamageProfile).
          if (tgtChar) {
            const prof = getCharFullDamageProfile(tgtChar);
            if (prof) {
              dmgTotal = resolveDamagePieces(prof);
            }
          }
          // Set Lourd : réduction plate par coup (sur des dégâts positifs uniquement —
          // une absorption rend des PV et ne doit pas être rognée).
          if (dmgTotal > 0 && tgtChar) {
            const setReduction = getArmorSetData(tgtChar).modifiers.damageReduction || 0;
            if (setReduction > 0) {
              const beforeSet = dmgTotal;
              dmgTotal = Math.max(1, dmgTotal - setReduction);
              dmgReduction = beforeSet - dmgTotal;
            }
          }
          // Borne haute = hpMax pour qu'une absorption ne soigne pas au-delà du max.
          newHp = Math.max(0, Math.min(hpMax, curHp - dmgTotal));
          targetWrite = _setHp(curTgtData, newHp);
        }
      }

      // Les statistiques mesurent les PV réellement retirés, pas la valeur
      // théorique du jet au-delà de 0 PV (overkill). Le détail du jet reste
      // conservé séparément dans `dmgTotal` pour le journal de combat.
      const dmgApplied = appliedDamageAmount({ beforeHp: hpBeforeApplied, afterHp: newHp, rolledDamage: dmgTotal });

      // ── Statistiques de combat : accumule (écrit une fois après la boucle,
      //    stocké dans le log pour pouvoir l'annuler avec l'action) ──
      if (_statsEnabled) {
        accAttackDelta(_statsDelta, {
          attackerId:   _atkActor.id,
          attackerName: _atkActor.name,
          targetId:     curTgtData.characterId || null,
          targetName:   curTgtData.name || '',
          hit, crit: false, fumble: false,
          dmg: (hit || halfDmg) ? dmgApplied : 0,
          ko: (hpBeforeApplied > 0 && newHp <= 0),
          countAction: false,
        });
        if ((hit || halfDmg) && dmgApplied > _maxHit) _maxHit = dmgApplied;
      }
      // Record du plus gros coup REÇU par la cible (PJ).
      if (_statsEnabled && (hit || halfDmg) && dmgApplied > 0 && curTgtData.characterId)
        bumpBiggestTaken(curTgtData.characterId, curTgtData.name || '', dmgApplied);

      // ── États consommés au 1er coup (Marqué, etc.) : retire ceux dont
      //    l'effet `consumedByAttackAgainst` est activé après que les bonus
      //    de dégâts aient été appliqués. Persistance immédiate.
      const _consumedNotes = [];
      if (hit && !isTechniqueSplash) {
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
          targetWrite = targetWrite.then(async () => {
            // _syncDownedCondition peut avoir ajouté Inconscient entre-temps :
            // repartir de l'état le plus récent et ne retirer que les effets consommés.
            const currentConditions = curTgtData.conditions || [];
            const nextConditions = currentConditions.filter(c => !CONDITION_BY_ID[c.id]?.effects?.consumedByAttackAgainst);
            await updateDoc(_tokRef(curTgtData.id), { conditions: nextConditions }).catch(() => {});
          });
        }
      }

      // Effets tactiques structurés : état (avec JS éventuel) et déplacement.
      // Le résultat est déterminé immédiatement pour que le journal ne dépende
      // pas de la latence Firestore ; la mutation reste chaînée après les PV.
      const techniqueEffects = [];
      for (const roll of applicableTechniqueRolls) {
        const technique = roll.technique;
        const lib = technique.conditionId ? CONDITION_BY_ID[technique.conditionId] : null;
        let applyCondition = false;
        if (lib) {
          const char = curTgtData.characterId
            ? (VS.characters?.[curTgtData.characterId] || STATE.characters?.find?.(item => item.id === curTgtData.characterId))
            : null;
          const normalize = value => String(value || '').trim().toLocaleLowerCase('fr');
          const resistance = Array.isArray(char?.resistances) ? char.resistances.find(entry => {
            if (entry?.cat !== 'etat') return false;
            return entry.t === lib.id || normalize(entry.label) === normalize(lib.label)
              || normalize(CONDITION_BY_ID[entry.t]?.label) === normalize(lib.label);
          }) : null;
          const saveStat = technique.conditionSaveStat || lib.defaultSaveStat || '';
          const saveDC = Math.max(0, parseInt(technique.conditionSaveDC, 10) || parseInt(lib.defaultDC, 10) || 0);
          const immune = resistance?.k === 'imm';
          let passed = immune;
          let saveResult = null;
          if (!immune && saveStat && saveDC > 0) {
            const rawBaseMode = _conditionStatRollMode(curTgtData, saveStat, 'save');
            const baseMode = rawBaseMode === 'normal' ? '' : rawBaseMode;
            const resistanceMode = resistance?.k === 'res' ? 'advantage' : resistance?.k === 'vul' ? 'disadvantage' : '';
            const rollMode = baseMode && resistanceMode && baseMode !== resistanceMode ? 'normal' : (resistanceMode || baseMode || 'normal');
            const d1 = Math.floor(Math.random() * 20) + 1;
            const d2 = rollMode === 'advantage' || rollMode === 'disadvantage' ? Math.floor(Math.random() * 20) + 1 : null;
            const d20 = rollMode === 'advantage' ? Math.max(d1, d2) : rollMode === 'disadvantage' ? Math.min(d1, d2) : d1;
            const mod = _tokenStatMod(curTgtData, saveStat);
            const total = d20 + mod;
            passed = d20 === 20 || (d20 !== 1 && total >= saveDC);
            saveResult = { saveStat, saveDC, d20, d20rolls: d2 == null ? null : [d1, d2], mod, total, rollMode };
          }
          applyCondition = !passed;
          techniqueEffects.push({
            type: 'condition', techniqueId: technique.id, icon: lib.icon || technique.icon || '✨',
            label: lib.label, applied: applyCondition, immune, ...(saveResult || {}),
          });
          if (saveResult || immune) {
            const tgtName = lCurTgt.displayName ?? curTgtData.name ?? 'Cible';
            techniqueSaveLogs.push({
              type: 'save', authorId: STATE.user?.uid || null, authorName,
              tokenName: tgtName, characterImage: lCurTgt.displayImage || null,
              ..._vttLogTargetFields(curTgtData),
              conditionLabel: `${lib.icon || '✨'} ${lib.label}`,
              sortLabel: technique.label, statLabel: statShort(saveResult?.saveStat || lib.defaultSaveStat || ''),
              mod: saveResult?.mod || 0, d20: saveResult?.d20 || null,
              d20rolls: saveResult?.d20rolls || null, rollMode: saveResult?.rollMode || 'normal',
              total: saveResult?.total || 0, dd: saveResult?.saveDC || technique.conditionSaveDC || lib.defaultDC || 0,
              passed, immune, createdAt: serverTimestamp(),
            });
          }
        }
        const moveDistance = technique.forcedMovement !== 'none'
          ? Math.max(0, parseInt(technique.forcedMovementDistance, 10) || 0) : 0;
        if (moveDistance > 0) {
          techniqueEffects.push({
            type: 'movement', techniqueId: technique.id, icon: technique.forcedMovement === 'pull' ? '🧲' : '💨',
            label: technique.forcedMovement === 'pull' ? 'Attraction' : 'Repoussement',
            mode: technique.forcedMovement, distance: moveDistance,
          });
        }
        if (applyCondition || moveDistance > 0) {
          targetWrite = targetWrite.then(async () => {
            if (applyCondition) {
              const round = Math.max(0, parseInt(VS.session?.combat?.round, 10) || 0);
              const consumed = !!lib.effects?.consumedByAttackAgainst;
              const duration = Math.max(1, parseInt(technique.conditionDuration, 10) || parseInt(lib.defaultDuration, 10) || 2);
              const before = curTgtData.conditions || [];
              const prepared = await _vttConditionsBeforeStateApplication({ ...curTgtData, conditions: before }, lib);
              const conditions = [...prepared.filter(condition => condition.id !== lib.id), {
                id: lib.id, appliedAt: Date.now(), appliedBy: srcId, source: technique.label,
                saveDC: technique.conditionSaveDC || lib.defaultDC || null,
                saveStat: technique.conditionSaveStat || lib.defaultSaveStat || null,
                expiresAtRound: round > 0 && !consumed ? round + duration - 1 : null,
                ...(round === 0 && !consumed ? { pendingDuration: duration } : {}),
              }];
              _vttPatchTokenOptimistically(curTgtData.id, { conditions });
              await updateDoc(_tokRef(curTgtData.id), { conditions }).catch(error => {
                _vttPatchTokenOptimistically(curTgtData.id, { conditions: before });
                throw error;
              });
            }
            if (moveDistance > 0) await _vttApplyDeplacement(src, curTgtData, technique.forcedMovement, moveDistance);
          });
        }
      }
      targetWritePromises.push(targetWrite);

      targetResults.push({
        name: lCurTgt.displayName ?? curTgtData.name ?? 'Cible', targetCA, hit, halfDmg,
        dmgTotal, dmgApplied, dmgPre, dmgReduction, newHp, hpMax, interaction,
        tokenId: curTgtData.id,   // pour l'annulation manuelle (bouclier réactif)
        shieldBlocked: isBlocked,
        techniqueDefenseBonus: isTechniqueSplash ? 0 : techniqueDefenseBonus,
        techniqueSplash: isTechniqueSplash,
        techniqueSplashDetails: isTechniqueSplash ? (splashTechniquesByTarget.get(curTgtId) || []) : null,
        techniqueEffects: techniqueEffects.length ? techniqueEffects : null,
        damageBreakdown: damageBreakdown.length ? damageBreakdown : null,
        condDmgNotes: _condDmgNotes, condDmgDetails: _condDmgDetails, consumedNotes: _consumedNotes,
        // Métadonnées pour le rendu côté joueur (estimation CA, portrait)
        beastId: curTgtData.beastId || null,
        npcId:   curTgtData.npcId   || null,
        characterId: curTgtData.characterId || null,
        summonOwnerCharId: curTgtData.summonOwnerCharId || null,
        summonInvId: curTgtData.summonInvId || null,
        targetImage: _combatLogImage(lCurTgt.displayImage),
        _data: curTgtData,
      });
    }

    // Les cibles sont indépendantes : leurs mises à jour partent ensemble. On
    // garde immédiatement un gestionnaire d'erreur, puis le journal peut être
    // créé pendant que Firestore termine les jauges.
    const targetWritesDone = Promise.all(targetWritePromises)
      .then(() => null, error => error);

    // Un seul d20 a été lancé pour toute l'action, même si elle touche plusieurs
    // cibles. Les impacts ont été comptés séparément dans la boucle ci-dessus.
    if (_statsEnabled && targetResults.length) {
      accAttackDelta(_statsDelta, {
        attackerId: _atkActor.id,
        attackerName: _atkActor.name,
        hit: targetResults.some(r => r.hit),
        crit: isCrit,
        fumble: isFumble,
        roll: d20,
        result: hitTotal,
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
      for (const effect of r.techniqueEffects || []) {
        if (effect.type === 'condition') {
          modNotes.push(effect.immune
            ? `🛡 ${r.name} immunisé à ${effect.label}`
            : effect.applied ? `${effect.icon} ${effect.label} appliqué à ${r.name}` : `🛡 ${r.name} résiste à ${effect.label}`);
        } else if (effect.type === 'movement') {
          modNotes.push(`${effect.icon} ${r.name} : ${effect.label.toLowerCase()} ${effect.distance}c`);
        }
      }
    }

    // ── JS Concentration auto : buffs canalisés + états de type Concentré.
    const concentrationResults = await Promise.all(targetResults.map(async (r, index) => {
      if (!(r.hit || r.halfDmg) || r.dmgTotal <= 0 || !r._data) return [];
      if (!_hasActiveConcentration(r._data)) return [];
      await targetWritePromises[index];
      return _vttTriggerConcentrationSave(r._data, r.dmgTotal, r.newHp, { deferLog: true });
    }));
    for (const concNotes of concentrationResults) {
      modNotes.push(...concNotes);
      if (concNotes.concentrationLogs?.length) concentrationLogs.push(...concNotes.concentrationLogs);
    }

    // ── Lacération PORTÉE : si l'attaquant a un buff `laceration_grant` (posé par
    //    un Enchantement d'État), chaque coup réussi réduit aussi la CA de la cible
    //    ennemie — l'allié enchanté, lui, n'a JAMAIS perdu de CA. Sauté si l'attaque
    //    courante applique déjà une Lacération directe (pas de double −CA). ──
    {
      const roundLg = VS.session?.combat?.round ?? 0;
      const grant = (src.buffs || []).find(b => b.type === 'laceration_grant'
        && (b.expiresAtRound == null || roundLg === 0 || roundLg <= b.expiresAtRound));
      if (grant && !_mods?.laceration) {
        const baseRoundLg = Math.max(1, roundLg);
        for (const r of targetResults) {
          if (r.techniqueSplash || !(r.hit || r.halfDmg) || !r._data) continue;
          const curTgtData = r._data;
          const beast = curTgtData.beastId ? VS.bestiary[curTgtData.beastId] : null;
          const rang = (beast?.rang || 'classique').toLowerCase();
          const cap = (rang === 'elite' || rang === 'élite' || rang === 'boss') ? grant.maxElite : grant.max;
          const reduction = Math.min(grant.reduction, cap);
          const sortLabel = `Lacération · ${grant.sortLabel || 'Enchantement'}`;
          const newBuff = {
            type: 'ca', bonus: -reduction, totalDuration: 2, startRound: roundLg,
            expiresAtRound: baseRoundLg + 2 - 1, sortLabel, icon: '🩸',
          };
          const existingBuffs = (curTgtData.buffs || []).filter(b => !(b.type === 'ca' && b.sortLabel === sortLabel));
          await updateDoc(_tokRef(curTgtData.id), { buffs: [...existingBuffs, newBuff] }).catch(() => {});
          modNotes.push(`🩸 CA −${reduction} → ${r.name}`);
        }
      }
    }

    if (_mods) {
      const round = VS.session?.combat?.round ?? 0;
      const baseRound = Math.max(1, round);

      for (const r of targetResults) {
        const wasHit = r.hit || r.halfDmg;
        if (r.techniqueSplash || !wasHit || !r._data) continue;
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
    if (_statsEnabled && _castActor.id && (opt.sortIdx !== undefined || (opt.pmCost || 0) > 0)) {
      accCastDelta(_statsDelta, {
        casterId: _castActor.id, casterName: _castActor.name,
        spellName: opt.sortIdx !== undefined ? (opt.label || 'Sort') : null,
        pm: ((opt.costRes||'pm')==='pm' ? (opt.pmCost||0) : 0),
        tactical: _castKinds.tactical ? 1 : 0,
        support: _castKinds.support ? 1 : 0,
        affliction: _castKinds.affliction ? 1 : 0,
        control: _castKinds.control ? 1 : 0,
      });
    }
    if (_hasStatsDelta(_statsDelta)) applyStatsDelta(_statsDelta, +1);
    if (_statsEnabled && _castActor.id && _maxHit > 0) bumpBiggestHit(_castActor.id, _castActor.name, _maxHit);

    // ── Un seul message dans le log ────────────────────────────────────
    // Strip _data (référence token interne, non sérialisable Firestore)
    const cleanResults = targetResults.map(({ _data, ...rest }) => rest);
    const techniqueLogs = selectedTechniques.map(technique => {
      const rolled = techniqueRolls.find(entry => entry.technique._choiceId === technique._choiceId);
      return {
        id: technique.id,
        icon: technique.icon || '🎯',
        label: technique.label,
        description: technique.description || '',
        source: technique._source || 'weapon',
        triggered: !!rolled,
        allowWithAbilities: technique.allowWithAbilities !== false,
        trigger: technique.trigger || 'hit',
        missEffectMode: technique.missEffectMode || 'none',
        attackModifier: parseInt(technique.attackModifier, 10) || 0,
        defenseBonus: Math.max(0, parseInt(technique.defenseBonus, 10) || 0),
        damageBonus: rolled?.damageBonus || 0,
        damageDetails: rolled?.damageDetails || [],
        damageTypeId: technique.damageTypeId || opt.damageTypeId || null,
        addWeaponModifier: !!technique.addWeaponModifier,
        criticalMode: technique.criticalMode || 'normal',
        scalingMode: technique.scalingMode || 'none',
        scalingEvery: technique.scalingEvery || 1,
        scalingFormula: technique.scalingFormula || '',
        scalingStat: technique.scalingStat || '',
        blastRadius: Math.max(0, parseInt(technique.blastRadius, 10) || 0),
        areaShape: technique.areaShape || 'square',
        areaOrigin: technique.areaOrigin || 'target',
        areaTargets: technique.areaTargets || 'all',
        includeCaster: !!technique.includeCaster,
        conditionId: technique.conditionId || '',
        conditionDuration: technique.conditionDuration || 0,
        conditionSaveStat: technique.conditionSaveStat || '',
        conditionSaveDC: technique.conditionSaveDC || 0,
        forcedMovement: technique.forcedMovement || 'none',
        forcedMovementDistance: technique.forcedMovementDistance || 0,
        resourceType: technique.resourceType || 'none',
        resourceCost: technique.resourceCost || 0,
        usageScope: technique.usageScope || 'none',
        maxUses: technique.maxUses || 0,
        cooldownRounds: technique.cooldownRounds || 0,
        onHitEffect: technique.onHitEffect || '',
      };
    });
    // `technique` reste renseigné pour les anciens clients ; les nouveaux
    // lisent `techniques`, qui conserve indépendamment les deux familles.
    const legacyTechnique = techniqueLogs[0] || null;
    const isMulti = cleanResults.length > 1;
    if (isMulti) {
      await _publishCombatLog({
        ..._statsLogMeta(opt),
        type: 'attack-multi',
        undo: _undoSnap,
        ...(_hasStatsDelta(_statsDelta) ? { statsDelta: _statsDelta } : {}),
        ..._vttLogSourceFields(src),
        authorId: STATE.user?.uid||null, authorName,
        attackerName: lS.displayName??src.name,
        characterImage: _combatLogImage(lS.displayImage),
        attackerRank,
        optLabel: opt.label,
        technique: legacyTechnique,
        techniques: techniqueLogs,
        techniqueDefenseBonus,
        techniqueAttackModifier,
        autoHit: !!opt.autoHit,
        isCrit, isFumble, advMode: effectiveMode, advAuto: effectiveMode !== mode,
        advReasons: effectiveMode !== mode ? automaticReasons : null,
        hitD20: d20, hitD20rolls: luckUsed ? [roll1, ...(roll2 !== null ? [roll2] : []), luckRerollValue] : (roll2 !== null ? [roll1, roll2] : [roll1]),
        hitBase: atkBase, hitBonus: bonusHit, hitTotal,
        hitToucherMod: opt.toucherMod??null, hitToucherSetBonus: opt.toucherSetBonus??0,
        hitToucherStatLabel: opt.toucherStatLabel??null, hitTouchBuff: _touchBuff || 0,
        dmgFormula: opt.dice, dmgRawDice: opt.rawDice||null,
        dmgEffectiveDice: bonusDmgDice ? effectiveDice : null,
        dmgFormulaBonus: opt.formulaFixedBonus??0,
        dmgStatMod: opt.dmgStatMod??null, dmgStatLabel: opt.dmgStatLabel??null,
        dmgMaitriseBonus: opt.maitriseBonus??0,
        dmgRaw: sharedDmgRaw, dmgBonus: bonusDmg, dmgBonusDice: bonusDmgDice||null,
        dmgFull: cleanResults.find(result => !result.techniqueSplash)?.dmgPre ?? sharedDmgTotalHit,
        dmgFullHalf: sharedDmgTotalHalf,
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
      });
    } else {
      const r = cleanResults[0];
      // Image de la cible pour affichage dans le chat (single target)
      const _defImg = _combatLogImage(_live(tgt)?.displayImage || r?.targetImage);
      if (r) await _publishCombatLog({
        ..._statsLogMeta(opt),
        type: 'attack',
        undo: _undoSnap,
        ...(_hasStatsDelta(_statsDelta) ? { statsDelta: _statsDelta } : {}),
        ..._vttLogSourceFields(src),
        authorId: STATE.user?.uid||null, authorName,
        attackerName: lS.displayName??src.name,
        characterImage: _combatLogImage(lS.displayImage),
        defenderName: r.name,
        defenderImage: _defImg,
        // Bouclier réactif manuel : token cible + rang attaquant (vérif du palier).
        defenderTokenId: r.tokenId || null,
        attackerRank,
        technique: legacyTechnique,
        techniques: techniqueLogs,
        techniqueDefenseBonus,
        techniqueAttackModifier,
        // Identifiants cible pour rendu côté joueur (estimation CA)
        beastId: r.beastId || null,
        npcId: r.npcId || null,
        characterId: r.characterId || null,
        summonOwnerCharId: r.summonOwnerCharId || null,
        summonInvId: r.summonInvId || null,
        optLabel: opt.label,
        autoHit: !!opt.autoHit,
        isCrit, isFumble, advMode: effectiveMode, advAuto: effectiveMode !== mode,
        advReasons: effectiveMode !== mode ? automaticReasons : null,
        hitD20: d20, hitD20rolls: luckUsed ? [roll1, ...(roll2 !== null ? [roll2] : []), luckRerollValue] : (roll2 !== null ? [roll1, roll2] : [roll1]),
        hitBase: atkBase, hitBonus: bonusHit, hitTotal,
        hitToucherMod: opt.toucherMod??null, hitToucherSetBonus: opt.toucherSetBonus??0,
        hitToucherStatLabel: opt.toucherStatLabel??null, hitTouchBuff: _touchBuff || 0,
        targetCA: r.targetCA, hit: r.hit,
        dmgFormula: opt.dice, dmgRawDice: opt.rawDice||null,
        dmgEffectiveDice: bonusDmgDice ? effectiveDice : null,
        dmgFormulaBonus: opt.formulaFixedBonus??0,
        dmgStatMod: opt.dmgStatMod??null, dmgStatLabel: opt.dmgStatLabel??null,
        dmgMaitriseBonus: opt.maitriseBonus??0,
        dmgRaw: sharedDmgRaw, dmgBonus: bonusDmg, dmgBonusDice: bonusDmgDice||null,
        dmgTotal: r.dmgTotal, dmgApplied: r.dmgApplied, dmgFull: r.dmgPre ?? sharedDmgTotalHit, dmgPre: r.dmgPre ?? r.dmgTotal, dmgReduction: r.dmgReduction || 0,
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
        damageBreakdown: r.damageBreakdown || null,
        techniqueEffects: r.techniqueEffects || null,
        createdAt: serverTimestamp(),
      });
    }

    await Promise.all([
      ...techniqueSaveLogs.map(payload => _vttPublishOptimisticLog(payload).catch(() => {})),
      ...concentrationLogs.map(payload => _publishCombatLog(payload)),
    ]);

    const [sourceWriteError, targetWriteError] = await Promise.all([sourceWritesDone, targetWritesDone]);
    if (sourceWriteError) throw sourceWriteError;
    if (targetWriteError) throw targetWriteError;

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
    if (techniqueLogs.length) {
      for (const technique of [...techniqueLogs].reverse()) {
        const splashCount = cleanResults.filter(r =>
          r.techniqueSplashDetails?.some(item => item.id === technique.id && item.source === technique.source)
        ).length;
        const techResult = !technique.triggered
          ? `${technique.icon} ${technique.label} · déclencheur non rempli`
          : `${technique.icon} ${technique.label}${technique.damageBonus > 0 ? ` +${technique.damageBonus}` : ''}${splashCount ? ` · zone sur ${splashCount} cible${splashCount > 1 ? 's' : ''}` : ''}`;
        notifParts.unshift(techResult);
        if (technique.triggered && technique.onHitEffect) notifParts.push(`Effet : ${technique.onHitEffect}`);
      }
    }
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
  _syncTokenStackVisuals();
  VS.layers.token?.batchDraw();
  // La fiche reflète le token sélectionné (MJ) ou, à défaut, le personnage du
  // joueur — tenue à jour à chaque re-rendu large des tokens.
  try { _renderInspectorSoon(); } catch {}
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
// Les poignées d'un Transformer Konva vivent dans les coordonnées de la scène :
// sans compensation, un dézoom les rend presque impossibles à saisir. On garde
// ici une taille VISUELLE stable, avec une cible un peu plus large sur écran tactile.
function _syncAnnotTransformerHandles() {
  if (!_annotTransformer || !VS.stage) return;
  const scale = Math.max(MIN_SCALE, Number(VS.stage.scaleX()) || 1);
  const coarsePointer = !!window.matchMedia?.('(pointer: coarse)')?.matches;
  const screenAnchor = coarsePointer ? 26 : 20;
  const anchorSize = Math.min(160, Math.max(5, screenAnchor / scale));
  _annotTransformer.setAttrs({
    anchorSize,
    anchorCornerRadius: Math.min(anchorSize / 2, Math.max(2, 6 / scale)),
    anchorStrokeWidth: Math.max(0.75, 2 / scale),
    borderStrokeWidth: Math.max(0.75, 2 / scale),
    padding: Math.min(48, Math.max(1.5, 7 / scale)),
    rotateAnchorOffset: Math.min(180, Math.max(8, 34 / scale)),
  });
  _annotTransformer.forceUpdate?.();
  VS.layers.draw?.batchDraw();
}

function _applyAnnotTransformer() {
  if (!_annotTransformer) return;
  const shapes = [..._selectedAnnotIds].map(id => _annotations[id]?.shape).filter(Boolean);
  _annotTransformer.nodes(shapes);
  // Les annotations sont reconstruites après le Transformer et peuvent donc passer
  // devant ses poignées. Le remonter garantit que saisir une poignée conserve la
  // forme courante ; un clic ailleurs atteint toujours normalement l'autre forme.
  _annotTransformer.moveToTop();
  _syncAnnotTransformerHandles();
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
    // Une cible reste inspectable par clic, mais ne rejoint jamais un groupe
    // de déplacement si le joueur n'en a pas le contrôle.
    if (!STATE.isAdmin && !_canControlToken(t)) continue;
    const { x: cx, y: cy } = _tokenCenter(t);
    if (_inRect(cx, cy, r)) {
      VS.selectedMulti.add(id);
      _setSelectionRing(id, true);
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
  void _deleteAnnotsWithUndo(toDelete);
}

async function _deleteAnnotsWithUndo(ids) {
  const snapshots = [...new Set(ids)]
    .map(id => ({ id, data: _annotations[id]?.data }))
    .filter(entry => entry.data)
    .map(({ id, data }) => ({ id, data: { ...data } }));
  if (!snapshots.length) return false;

  const results = await Promise.allSettled(snapshots.map(({ id }) => deleteDoc(_annotRef(id))));
  const removed = snapshots.filter((_, index) => results[index].status === 'fulfilled');
  const failures = results.filter(result => result.status === 'rejected');
  failures.forEach(result => console.error('[vtt] delete annotation:', result.reason));
  if (!removed.length) {
    showNotif('Impossible de supprimer la sélection.', 'error');
    return false;
  }

  _deselectAnnot();
  const count = removed.length;
  const suffix = failures.length ? ` · ${failures.length} échec${failures.length > 1 ? 's' : ''}` : '';
  showNotif(`${count} dessin${count > 1 ? 's' : ''} supprimé${count > 1 ? 's' : ''}${suffix}.`, failures.length ? 'warning' : 'success', {
    duration: 7000,
    action: {
      label: '↶ Annuler',
      onClick: async () => {
        await Promise.all(removed.map(({ id, data }) => {
          const payload = { ...data };
          delete payload.id;
          return setDoc(_annotRef(id), payload);
        }));
        showNotif('Suppression des dessins annulée.', 'success');
      },
    },
  });
  return true;
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
    const active  = inSelect && canEdit && !_annotMovePassthrough;
    e.shape.draggable(active);
    // Écoute en sélection (clic/drag) ET en gomme (hit-test), sinon non listening.
    e.shape.listening(!_annotMovePassthrough && (inSelect || inErase) && canEdit);
  });
  _annotTransformer?.listening(!_annotMovePassthrough);
  if (inSelect) _applyAnnotTransformer(); // maintenir le transformer sur la sélection courante
  VS.layers.draw.batchDraw();
}

function _setAnnotMovePassthrough(enabled) {
  const next = !!enabled;
  if (_annotMovePassthrough === next) return;
  _annotMovePassthrough = next;
  _updateAnnotDraggable();
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

// Les actions du Bestiaire sont éditées dans une autre feature de la SPA. Leur
// écriture explicite publie ce signal afin que le VTT déjà ouvert ne conserve
// jamais une ancienne formule (sans listener Firestore supplémentaire).
document.addEventListener('bestiary:creature-updated', event => {
  const id = event?.detail?.id;
  const patch = event?.detail?.patch;
  if (!id || !patch || !VS.bestiary[id]) return;
  VS.bestiary[id] = { ...VS.bestiary[id], ...patch };
  _patchBestiaryTokenShapes(new Set([id]));
});

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
function _entityTokenVisualKey(entity) {
  if (!entity) return '';
  // Une fiche peut approcher 1 Mio (journal, inventaire, sorts…). Le token n'en
  // dépend que par cette projection compacte. On évite ainsi de recalculer tous
  // les tokens lorsqu'une note ou un sort sans rapport avec le canvas change.
  return JSON.stringify({
    nom:entity.nom, photoURL:entity.photoURL, photo:entity.photo,
    avatar:entity.avatar, imageUrl:entity.imageUrl,
    hp:entity.hp, pv:entity.pv, pvBase:entity.pvBase,
    pm:entity.pm, pmCurrent:entity.pmCurrent, pmBase:entity.pmBase,
    niveau:entity.niveau, stats:entity.stats, statsBonus:entity.statsBonus,
    equipement:entity.equipement,
    bonusAttaque:entity.bonusAttaque, attack:entity.attack,
    ca:entity.ca, vitesse:entity.vitesse,
  });
}

function _changedEntityIds(previous, next) {
  const ids = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
  return new Set([...ids].filter(id => _entityTokenVisualKey(previous?.[id]) !== _entityTokenVisualKey(next?.[id])));
}

function _initListeners() {
  if (!aid()) return;

  // 1. Session
  VS.unsubs.push(onSnapshot(_sesRef(), snap => {
    const previousCombatActive = !!VS.session?.combat?.active;
    const previousRound = VS.session?.combat?.round ?? 0;
    const previousActiveTokenId = VS.session?.combat?.activeTokenId ?? null;
    VS.session=snap.exists()?snap.data():{};
    setActiveStatsSession(VS.session.live && VS.session.statsSessionKey
      ? { key: VS.session.statsSessionKey, date: VS.session.statsSessionDate }
      : null);
    const combatVisualChanged = previousCombatActive !== !!VS.session?.combat?.active
      || previousRound !== (VS.session?.combat?.round ?? 0)
      || previousActiveTokenId !== (VS.session?.combat?.activeTokenId ?? null);
    if (combatVisualChanged) {
      Object.keys(VS.tokens || {}).forEach(_patchShape);
    }
    _renderSessionBtn();
    _renderPageTabs();
    if (!STATE.isAdmin) {
      const uid=STATE.user?.uid;
      const target=VS.session.playerPages?.[uid]??VS.session.activePageId;
      if (target&&VS.pages[target]&&VS.activePage?.id!==target) { _switchPage(target); _vttAutoSelectOwnToken(); }
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
          // Ne re-rendre les images de fond QUE si elles ont changé : sinon chaque
          // écriture de page (ouvrir/fermer une porte, etc.) détruit+recharge la
          // carte de fond de façon asynchrone → flash visible.
          const _prevBgImgs = JSON.stringify(VS.activePage.backgroundImages || []);
          VS.activePage=VS.pages[ch.doc.id];
          _syncPlayerAnnotClip();
          if (JSON.stringify(VS.activePage.backgroundImages || []) !== _prevBgImgs) {
            _renderMapImages(_MAP_IMG_DEPS);
          }
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
      if (target&&VS.pages[target]) { _switchPage(target); _vttAutoSelectOwnToken(); }
    }
  },()=>{}));

  // 3. Personnages — source de vérité des HP joueurs
  VS.unsubs.push(subscribeCollection("characters", data => {
    const prev = VS.characters;
    const next = {};
    for (const c of data || []) next[c.id] = c;
    const wasReady = _charsReady;

    const changed = _changedEntityIds(prev, next);
    for (const id of Object.keys(prev)) {
      if (next[id]) continue;
      const tok = Object.values(VS.tokens).find(e => e.data.characterId === id);
      if (tok) deleteDoc(_tokRef(tok.data.id)).catch(() => {});
    }

    VS.characters = next;
    _vttRefreshChatPortraits();
    for (const [id, e] of Object.entries(VS.tokens)) {
      if (e.data.characterId && changed.has(e.data.characterId)) {
        _patchShape(id); if (VS.selected === id) _renderInspectorSoon();
      }
    }
    if (changed.size) _renderTraySoon();
    _markCharsReady();
    if (!STATE.isAdmin && !VS.selected) _renderInspectorSoon();
    void _syncOwnedCharacterDelegations();
    void _cleanupReserveSummons();
    // Signale immédiatement au destinataire les objets reçus pendant qu’il est
    // sur le VTT. Le premier snapshot est ignoré pour ne pas annoncer tout
    // l’inventaire existant à l’ouverture de la table.
    if (wasReady) {
      for (const c of Object.values(next)) {
        if (!canControlCharacter(c)) continue;
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

    const changed = _changedEntityIds(prev, next);
    VS.npcs = next;
    _vttRefreshChatPortraits();
    for (const [id, e] of Object.entries(VS.tokens)) {
      if (e.data.npcId && changed.has(e.data.npcId)) {
        _patchShape(id); if (VS.selected === id) _renderInspectorSoon();
      }
    }
    if (changed.size) _renderTraySoon();
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
        _vttRefreshCombatHpEstimates();
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
    let estimateTargetsChanged = false;
    snap.docChanges().forEach(ch => {
     try {
      const id=ch.doc.id;
      let data={id,...ch.doc.data()};
      if (ch.type==='removed') {
        if (VS.tokens[id]?.data?.type === 'enemy') estimateTargetsChanged = true;
        _keyboardOptimisticMoves.delete(id);
        VS.tokens[id]?.shape?.destroy(); delete VS.tokens[id];
        if (VS.selected===id) _deselect();
        VS.layers.token?.batchDraw(); return;
      }
      // Une écriture Firestore plus ancienne peut revenir pendant que le joueur
      // maintient une flèche. On conserve alors la dernière position affichée
      // localement, jusqu'à ce que le batch confirme cette position.
      const optimistic=_keyboardOptimisticMoves.get(id);
      if (optimistic && !_keyboardPatchMatches(data, optimistic.patch))
        data={...data,...optimistic.patch};
      const prev=VS.tokens[id];
      if (data.type === 'enemy' && (!prev || prev.data.type !== data.type || prev.data.beastId !== data.beastId)) {
        estimateTargetsChanged = true;
      }
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
    _syncTokenStackVisuals();
    _vttRefreshChatPortraits();
    if (estimateTargetsChanged) _vttRefreshCombatHpEstimates();
    // Joueur : dès que son token apparaît/arrive sur la carte active, on affiche sa
    // fiche sans clic (gardé : seulement si rien n'est sélectionné).
    if (!STATE.isAdmin) _vttAutoSelectOwnToken();
    _renderTraySoon();
    _renderCombatTrackerSoon();
    void _cleanupReserveDuplicates();
    void _cleanupReserveSummons();
    _markToksReady();
    void _syncOwnedCharacterDelegations();
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
      _showEmoteBubble(r.tokenId, r.emoteUrl, r.emoteName, key, {
        big: !!r.big,
        targetTokenId: r.targetTokenId || null,
        authorName: r.authorName || '',
        count: r.count || 1,
        remote: r.id !== STATE.user?.uid,
      });
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
      const cleaned = dedupeMapLibraryImages(VS.mapLib.images);
      VS.mapLib.images = cleaned.images;
      _renderLibSection();
      // Le premier snapshot peut provenir du cache local et être ancien. On ne
      // réécrit qu'après confirmation serveur afin de ne jamais écraser un ajout
      // récent fait depuis un autre onglet.
      if (cleaned.removed && !snap.metadata.fromCache && !_mapLibCleanupWrite) {
        _mapLibCleanupWrite = _saveMapLib()
          .then(() => showNotif(`🧹 Bibliothèque nettoyée : ${cleaned.removed} doublon${cleaned.removed > 1 ? 's' : ''} supprimé${cleaned.removed > 1 ? 's' : ''}.`, 'success'))
          .catch(error => console.error('[vtt] nettoyage automatique bibliothèque', error))
          .finally(() => { _mapLibCleanupWrite = null; });
      }
    }, () => {});
  }

  // Butin d'aventure : le listener du document est démarré au montage du dock
  // pour maintenir son badge « nouveaux objets » sans lecture supplémentaire.

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
  if (!STATE.isAdmin) return;
  VS.mapMode=!!on;
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
  if (btn) {
    btn.classList.toggle('active', on);
    btn.classList.toggle('is-unlocked', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Verrouiller les images' : 'Déverrouiller les images');
    btn.dataset.locked = String(!on);
    btn.innerHTML = on
      ? '<span class="vtt-canvas-ctl-icon" aria-hidden="true">🔓</span><span class="vtt-canvas-ctl-copy"><strong>Images</strong><small>Placement actif</small></span>'
      : '<span class="vtt-canvas-ctl-icon" aria-hidden="true">🔒</span><span class="vtt-canvas-ctl-copy"><strong>Images</strong><small>Verrouillées</small></span>';
    btn.title = on
      ? 'Images déverrouillées — elles peuvent être déplacées et redimensionnées'
      : 'Images verrouillées — cliquer pour modifier leur placement';
  }
}
function _vttToggleMapMode() {
  const unlock = !VS.mapMode;
  _setMapMode(unlock);
  showNotif(
    unlock ? '🔓 Images déverrouillées : mode édition actif' : '🔒 Images verrouillées pour jouer',
    'info'
  );
}

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
function _vttAdvancedPremium() { return hasAdventurePremiumAccess(STATE.adventure); }
function _vttPremiumInfo() {
  showNotif('VTT avancé Premium : brouillard de guerre, murs et éclairage dynamique.', 'info');
}
function _vttTool(t) {
  if (t === 'walls' && !_vttAdvancedPremium()) {
    _vttPremiumInfo();
    return _setTool('select');
  }
  if (VS.tool === t && t !== 'select') {
    if (_vttToolPanel !== t) _vttToolPanel = t;
    else {
      _vttToolPanelCollapsed[t] = !_vttToolPanelCollapsed[t];
      lsJson.set(_VTT_TOOL_PANEL_STORAGE, _vttToolPanelCollapsed);
    }
    return _vttRefreshToolPanels();
  }
  return _setTool(t);
}

function _vttOpenKeyboardHelp() {
  _vttToolPanel = _vttToolPanel === 'keys'
    ? (['ruler','draw','walls'].includes(VS.tool) ? VS.tool : null)
    : 'keys';
  _vttRefreshToolPanels();
}

function _vttToolPanelToggle(panel) {
  if (!panel || panel === 'keys') return;
  _vttToolPanelCollapsed[panel] = !_vttToolPanelCollapsed[panel];
  lsJson.set(_VTT_TOOL_PANEL_STORAGE, _vttToolPanelCollapsed);
  _vttRefreshToolPanels();
}

function _vttToolPanelClose(panel) {
  if (panel === 'keys') {
    _vttToolPanel = ['ruler','draw','walls'].includes(VS.tool) ? VS.tool : null;
    return _vttRefreshToolPanels();
  }
  _setTool('select');
}

function _vttStructureHelpToggle() {
  _vttStructureHelp = !_vttStructureHelp;
  _vttRefreshToolPanels();
}

function _vttToolHint() {
  if (_vttToolPanel === 'draw') return {
    pencil:'Glisse pour tracer à main levée.', line:'Glisse d’un point à l’autre.',
    rect:'Glisse pour tracer le rectangle.', circle:'Glisse depuis le centre.',
    poly:'Clic par sommet · double-clic ou Entrée ferme · clic droit retire un sommet.',
    eraser:'Passe sur un tracé pour l’effacer.',
  }[_drawShape];
  if (_vttToolPanel === 'walls') return {
    wall:'Glisse du début à la fin pour tracer un mur.', door:'Glisse pour poser une porte fermée.',
    window:'Glisse pour poser une vitre laissant passer la vision.', light:'Clic pour poser une source de lumière.',
    hide:'Glisse un rectangle à masquer aux joueurs.', reveal:'Glisse un rectangle à révéler.',
    eraser:'Clic sur un mur, une lumière ou une zone pour l’effacer.',
  }[_vttFogActiveTool];
  return '';
}

function _vttPositionToolPanel() {
  const host = document.querySelector('.vtt-tool-float');
  const panel = document.querySelector('.vtt-tool-panel:not([hidden])');
  const rail = host?.querySelector('.vtt-tool-float-tools');
  const btn = rail?.querySelector(`[data-tool-panel="${_vttToolPanel}"]`);
  if (!host || !panel || !rail || !btn) return;
  const hostRect = host.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  const maxTop = Math.max(0, window.innerHeight - hostRect.top - panel.offsetHeight - 12);
  panel.style.top = `${Math.max(0, Math.min(btnRect.top - hostRect.top - 5, maxTop))}px`;
}

function _vttRefreshRulerMeasure() {
  const rulerValue = document.getElementById('vtt-ruler-value');
  if (!rulerValue) return;
  const cells = rulerCells();
  const signature = cells == null ? 'none' : String(cells);
  if (rulerValue.dataset.value === signature) return;
  rulerValue.dataset.value = signature;
  rulerValue.innerHTML = cells == null
    ? '<b>—</b><span>Aucune mesure</span>'
    : `<b>${cells}</b><span>case${cells > 1 ? 's' : ''} · ${(cells * CELL_M).toLocaleString('fr-FR')} m</span>`;
}

function _vttRefreshToolPanels() {
  document.querySelectorAll('.vtt-tool-panel').forEach(panel => {
    const open = panel.dataset.panel === _vttToolPanel;
    panel.hidden = !open;
    panel.classList.toggle('is-collapsed', open && !!_vttToolPanelCollapsed[panel.dataset.panel]);
  });
  document.querySelectorAll('.vtt-tool[data-tool-panel]').forEach(btn => {
    btn.classList.toggle('has-panel-dot', !!_vttToolPanelCollapsed[btn.dataset.toolPanel]);
    btn.classList.toggle('panel-open', btn.dataset.toolPanel === _vttToolPanel);
  });
  document.querySelectorAll('.vtt-draw-color').forEach(btn => btn.classList.toggle('active', btn.dataset.color === _drawColor));
  document.querySelectorAll('.vtt-draw-wbtn').forEach(btn => {
    btn.classList.toggle('active', +btn.dataset.w === _drawWidth);
    btn.style.color = _drawColor === '#1a1a2e' ? 'var(--text-muted)' : _drawColor;
  });
  document.querySelectorAll('[data-fog-tool]').forEach(btn => btn.classList.toggle('active', btn.dataset.fogTool === _vttFogActiveTool));
  const fill = document.getElementById('vtt-draw-fill-btn');
  if (fill) { fill.classList.toggle('active', _drawFill); fill.setAttribute('aria-pressed', String(_drawFill)); }
  const drawUndo = document.getElementById('vtt-draw-undo-btn');
  const drawRedo = document.getElementById('vtt-draw-redo-btn');
  if (drawUndo) drawUndo.disabled = !_drawHistory.length;
  if (drawRedo) drawRedo.disabled = !_drawRedo.length;
  const fogUndoBtn = document.getElementById('vtt-fog-undo-btn');
  const fogRedoBtn = document.getElementById('vtt-fog-redo-btn');
  if (fogUndoBtn) fogUndoBtn.disabled = !fogCanUndo();
  if (fogRedoBtn) fogRedoBtn.disabled = !fogCanRedo();
  const fogClear = document.getElementById('vtt-fog-clear-btn');
  if (fogClear) fogClear.disabled = !(VS.activePage?.fogOps || []).length;
  const fogToggle = document.getElementById('vtt-fog-toggle');
  if (fogToggle) {
    const on = !!VS.activePage?.fogEnabled;
    fogToggle.classList.toggle('active', on);
    fogToggle.setAttribute('aria-checked', String(on));
    const status = document.querySelector('[data-fog-status]');
    if (status) status.textContent = on
      ? (fogHasUnlimitedVision(VS.activePage) ? 'Actif · vision illimitée' : `Actif · vision partagée ${fogVisionRadiusCells(VS.activePage)} cases`)
      : 'Coupé — carte entièrement visible';
  }
  const visionToggle = document.getElementById('vtt-vision-unlimited-toggle');
  if (visionToggle) {
    const unlimited = fogHasUnlimitedVision(VS.activePage);
    visionToggle.classList.toggle('active', unlimited);
    visionToggle.setAttribute('aria-checked', String(unlimited));
    visionToggle.disabled = !VS.activePage?.fogEnabled;
  }
  const visionStatus = document.querySelector('[data-vision-status]');
  if (visionStatus) visionStatus.textContent = fogHasUnlimitedVision(VS.activePage)
    ? 'Sans limite · murs respectés'
    : `${fogVisionRadiusCells(VS.activePage)} cases autour du groupe`;
  const lockVisibility = VS.activePage?.lockVisibility === 'discover' ? 'discover' : 'always';
  document.querySelectorAll('[data-lock-visibility]').forEach(button => {
    button.classList.toggle('active', button.dataset.lockVisibility === lockVisibility);
  });
  document.getElementById('vtt-structure-help')?.classList.toggle('open', _vttStructureHelp);
  document.getElementById('vtt-structure-help-btn')?.classList.toggle('active', _vttStructureHelp);
  document.querySelectorAll('[data-vtt-panel-collapse]').forEach(btn => {
    const panel = btn.dataset.vttPanelCollapse;
    btn.innerHTML = _vttToolIcon(_vttToolPanelCollapsed[panel] ? 'max' : 'min');
    btn.title = _vttToolPanelCollapsed[panel] ? 'Déplier' : 'Replier';
  });
  _vttRefreshRulerMeasure();
  const hint = document.querySelector('.vtt-tool-panel:not([hidden]) [data-vtt-tool-hint]');
  if (hint) hint.textContent = _vttToolHint();
  requestAnimationFrame(_vttPositionToolPanel);
}
// ── Courir : double le mouvement de base pour ce tour ───────────────
async function _vttCourir(id) {
  const tok = VS.tokens[id]?.data;
  if (!tok || !VS.session?.combat?.active) return;
  if (tok.bonusMvt > 0) { showNotif('Course déjà utilisée ce tour', 'error'); return; }
  const bonus = _live(tok).displayMovement ?? 6;
  _vttPatchTokenOptimistically(id, { bonusMvt: bonus });
  try {
    await updateDoc(_tokRef(id), { bonusMvt: bonus });
  } catch (error) {
    _vttPatchTokenOptimistically(id, { bonusMvt: 0 });
    console.error('[vtt] course non appliquée', error);
    showNotif('Erreur', 'error');
    return;
  }
  showNotif(`🏃 Course ! +${bonus} cases de mouvement`, 'success');
}

// ── Déplacement clavier (flèches + pavé numérique) ──────────────────
// Le canvas bouge immédiatement. Les répétitions clavier sont ensuite regroupées
// dans une seule écriture Firestore (avec un envoi intermédiaire lors d'un appui
// prolongé), ce qui évite que la latence réseau ralentisse les déplacements.
const _keyboardOptimisticMoves = new Map();
let _keyboardFlushTimer = null;
let _keyboardRangeTimer = null;
let _keyboardFogTimer = null;
let _keyboardBurstStartedAt = 0;
let _keyboardFlushRunning = false;
let _keyboardRevision = 0;

function _keyboardPatchMatches(data, patch) {
  if ((Number(data?.col)||0)!==(Number(patch?.col)||0)) return false;
  if ((Number(data?.row)||0)!==(Number(patch?.row)||0)) return false;
  if (Object.hasOwn(patch||{}, 'movedCells')
      && (Number(data?.movedCells)||0)!==(Number(patch.movedCells)||0)) return false;
  return true;
}

function _resetKeyboardMovement({ persist=false } = {}) {
  if (_keyboardFlushTimer) clearTimeout(_keyboardFlushTimer);
  if (_keyboardRangeTimer) clearTimeout(_keyboardRangeTimer);
  if (_keyboardFogTimer) clearTimeout(_keyboardFogTimer);
  // Une navigation dans les 85 ms suivant un appui ne doit pas perdre le
  // dernier pas. Les écritures Firestore du client restent ordonnées, y compris
  // si un précédent batch est encore en transit.
  if (persist && _keyboardOptimisticMoves.size) {
    const batch=writeBatch(db);
    _keyboardOptimisticMoves.forEach((entry,id)=>batch.update(_tokRef(id), entry.patch));
    void batch.commit().catch(error=>console.error('[vtt] sauvegarde finale déplacement clavier', error));
  }
  _keyboardFlushTimer=null;
  _keyboardRangeTimer=null;
  _keyboardFogTimer=null;
  _keyboardBurstStartedAt=0;
  _keyboardFlushRunning=false;
  _keyboardOptimisticMoves.clear();
}

function _scheduleKeyboardRangeRefresh(ids) {
  if (_keyboardRangeTimer) clearTimeout(_keyboardRangeTimer);
  _keyboardRangeTimer=setTimeout(()=>{
    _keyboardRangeTimer=null;
    const id=VS.selected && ids.includes(VS.selected) ? VS.selected : null;
    if (id) _refreshRanges(id, VS.tokens[id]?.data);
  }, 70);
}

function _scheduleKeyboardFogRefresh() {
  if (_keyboardFogTimer) return;
  // Le recalcul du masque de vision est bien plus coûteux que le mouvement du
  // token. 20 images/s suffisent pour le brouillard sans ralentir le canvas.
  _keyboardFogTimer=setTimeout(()=>{
    _keyboardFogTimer=null;
    if (VS.activePage) fogUpdateSoon(VS.activePage, VS.tokens, STATE.isAdmin);
  }, 50);
}

function _scheduleKeyboardFlush() {
  const now=Date.now();
  if (!_keyboardBurstStartedAt) _keyboardBurstStartedAt=now;
  const heldFor=now-_keyboardBurstStartedAt;
  if (_keyboardFlushTimer) clearTimeout(_keyboardFlushTimer);
  // 85 ms après le dernier pas, ou au moins toutes les 220 ms si la touche
  // reste maintenue : les autres participants voient un déplacement continu.
  _keyboardFlushTimer=setTimeout(_flushKeyboardMoves, heldFor>=220 ? 0 : 85);
}

async function _flushKeyboardMoves() {
  _keyboardFlushTimer=null;
  if (_keyboardFlushRunning) {
    _keyboardFlushTimer=setTimeout(_flushKeyboardMoves, 45);
    return;
  }
  const pending=[..._keyboardOptimisticMoves.entries()];
  if (!pending.length) { _keyboardBurstStartedAt=0; return; }

  _keyboardFlushRunning=true;
  _keyboardBurstStartedAt=0;
  const batch=writeBatch(db);
  pending.forEach(([id, entry])=>batch.update(_tokRef(id), entry.patch));
  try {
    await batch.commit();
    pending.forEach(([id,entry])=>{
      const current=_keyboardOptimisticMoves.get(id);
      if (!current) return;
      if (current.revision===entry.revision) {
        _keyboardOptimisticMoves.delete(id);
      } else if (current.revision>entry.revision) {
        // Si le joueur a continué à bouger pendant l'écriture, cette position
        // devient le nouveau point de repli confirmé.
        current.confirmed={...current.confirmed,...entry.patch};
      }
    });
  } catch (error) {
    console.error('[vtt] synchronisation déplacement clavier', error);
    // Le batch est atomique : en cas de refus, tous les tokens reviennent à
    // leur dernière position confirmée plutôt que de rester désynchronisés.
    _keyboardOptimisticMoves.forEach((entry,id)=>{
      const token=VS.tokens[id]?.data;
      if (!token) return;
      Object.assign(token, entry.confirmed);
      const dims=_tokenDims(token);
      VS.tokens[id]?.shape?.to({
        x:token.col*CELL+dims.w*CELL/2,
        y:token.row*CELL+dims.h*CELL/2,
        duration:.08,
      });
    });
    _keyboardOptimisticMoves.clear();
    VS.layers.token?.batchDraw();
    showNotif('Déplacement non synchronisé : position rétablie.', 'error');
  } finally {
    _keyboardFlushRunning=false;
    // Des appuis ont pu être ajoutés pendant l'écriture précédente.
    const hasNewer=pending.some(([id,entry])=>{
      const current=_keyboardOptimisticMoves.get(id);
      return current && current.revision>entry.revision;
    });
    if (hasNewer) _scheduleKeyboardFlush();
  }
}

function _queueSelectedMove(dc, dr) {
  const ids = VS.selectedMulti.size > 0
    ? [...VS.selectedMulti]
    : (VS.selected ? [VS.selected] : []);
  if (!ids.length) return;
  _moveSelectedBy(dc, dr, ids);
}

function _moveSelectedBy(dc, dr, selectionIds = null) {
  if (!VS.activePage || VS.tool !== 'select') return;
  const ids = [...new Set((selectionIds || []).filter(Boolean))];
  if (!ids.length) return;
  const page=VS.activePage;
  const tokens=ids.map(id=>VS.tokens[id]?.data).filter(Boolean);
  if (tokens.length!==ids.length || tokens.some(token=>token.pageId!==page.id || !_canControlToken(token))) {
    if (ids.length>1) showNotif('Un token du groupe ne peut pas être déplacé.', 'info');
    return;
  }

  const plan=planGroupGridStep(tokens, {
    dc, dr, cols:page.cols, rows:page.rows, getDimensions:_tokenDims,
  });
  if (!plan.ok) {
    if (plan.reason==='bounds' && ids.length>1) showNotif('Le groupe a atteint le bord de la carte.', 'info');
    return;
  }

  for (const move of plan.moves) {
    if (!STATE.isAdmin && (page.walls || []).length
        && fogWallBlocksPath(move.token.col, move.token.row, move.col, move.row, page.walls)) {
      showNotif(ids.length>1 ? '🧱 Un token du groupe est bloqué par un obstacle.' : '🧱 Passage bloqué par un obstacle.', 'error');
      return;
    }
    if (!STATE.isAdmin && VS.session?.combat?.active) {
      const maximum=(_live(move.token).displayMovement??6)+(move.token.bonusMvt||0);
      const remaining=maximum-(move.token.movedCells||0);
      if (move.distance>remaining) {
        const suffix=`${remaining} case${remaining!==1?'s':''} restante${remaining!==1?'s':''}`;
        showNotif(ids.length>1
          ? (remaining<=0 ? 'Un token du groupe n’a plus de mouvement ce tour.' : `Déplacement groupé impossible : ${suffix} pour un token.`)
          : (remaining<=0 ? 'Plus de mouvement ce tour !' : `Trop loin ! (${suffix})`), 'error');
        return;
      }
    }
  }

  const revision=++_keyboardRevision;
  const prepared=plan.moves.map(move=>{
    const patch={ col:move.col, row:move.row };
    if (VS.session?.combat?.active) patch.moveOrigin=_combatMoveOrigin(move.token);
    if (!STATE.isAdmin && VS.session?.combat?.active) {
      patch.movedCells=(move.token.movedCells||0)+move.distance;
      patch.movedThisTurn=true;
    }
    return { ...move, patch };
  });

  prepared.forEach(({token,col,row,patch})=>{
    const previous=_keyboardOptimisticMoves.get(token.id);
    const confirmed=previous?.confirmed || {
      col:token.col,
      row:token.row,
      movedCells:token.movedCells||0,
      movedThisTurn:!!token.movedThisTurn,
      moveOrigin:token.moveOrigin||null,
    };
    Object.assign(token, patch);
    _keyboardOptimisticMoves.set(token.id,{patch,confirmed,revision});
    const dims=_tokenDims(token);
    VS.tokens[token.id]?.shape?.to({
      x:col*CELL+dims.w*CELL/2,
      y:row*CELL+dims.h*CELL/2,
      duration:.065,
    });
  });
  VS.layers.token?.batchDraw();
  _scheduleKeyboardRangeRefresh(ids);
  _scheduleKeyboardFogRefresh();
  _scheduleKeyboardFlush();
}

function _vttFogTool(t) {
  if (!_vttAdvancedPremium()) return _vttPremiumInfo();
  _vttFogActiveTool = t;
  fogSetEditTool(t, VS.activePage);
  _vttRefreshToolPanels();
}
function _vttFogUndo() { if (!_vttAdvancedPremium()) return _vttPremiumInfo(); if (!fogUndo()) showNotif('Rien à annuler', 'info'); _vttRefreshToolPanels(); }
function _vttFogRedo() { if (!_vttAdvancedPremium()) return _vttPremiumInfo(); if (!fogRedo()) showNotif('Rien à rétablir', 'info'); _vttRefreshToolPanels(); }
async function _vttToggleFog() {
  if (!_vttAdvancedPremium()) return _vttPremiumInfo();
  if (!VS.activePage) return;
  const next = !VS.activePage.fogEnabled;
  VS.activePage.fogEnabled = next;
  _vttRefreshToolPanels();
  await updateDoc(_pgRef(VS.activePage.id), { fogEnabled: next }).catch(() => {
    VS.activePage.fogEnabled = !next;
    _vttRefreshToolPanels();
    showNotif('Erreur fog','error');
  });
}
async function _vttToggleVisionUnlimited() {
  if (!_vttAdvancedPremium()) return _vttPremiumInfo();
  if (!VS.activePage?.fogEnabled) {
    showNotif('Active d’abord l’éclairage dynamique sur cette scène.', 'info');
    return;
  }
  const previous = fogHasUnlimitedVision(VS.activePage);
  const next = !previous;
  VS.activePage.visionUnlimited = next;
  _vttRefreshToolPanels();
  fogUpdateSoon(VS.activePage, VS.tokens, STATE.isAdmin);
  await updateDoc(_pgRef(VS.activePage.id), { visionUnlimited: next }).catch(() => {
    VS.activePage.visionUnlimited = previous;
    _vttRefreshToolPanels();
    fogUpdateSoon(VS.activePage, VS.tokens, STATE.isAdmin);
    showNotif('Impossible de modifier la portée de vision.', 'error');
  });
}
async function _vttSetLockVisibility(mode) {
  if (!_vttAdvancedPremium()) return _vttPremiumInfo();
  if (!VS.activePage) return;
  const next = mode === 'discover' ? 'discover' : 'always';
  const previous = VS.activePage.lockVisibility || 'always';
  if (next === previous) return;
  VS.activePage.lockVisibility = next;
  _vttRefreshToolPanels();
  fogRenderWalls(VS.activePage, STATE.isAdmin);
  await updateDoc(_pgRef(VS.activePage.id), { lockVisibility:next }).catch(() => {
    VS.activePage.lockVisibility = previous;
    _vttRefreshToolPanels();
    fogRenderWalls(VS.activePage, STATE.isAdmin);
    showNotif('Impossible de modifier la visibilité des verrous.', 'error');
  });
}
async function _vttFogClearOps() {
  if (!_vttAdvancedPremium()) return _vttPremiumInfo();
  if (!VS.activePage) return;
  const n = (VS.activePage.fogOps || []).length;
  if (!n) { showNotif('Aucune zone de brouillard sur cette page', 'info'); return; }
  if (!await confirmModal(`Supprimer ${n} zone(s) de brouillard manuel de cette page ?`, { title: 'Brouillard', confirmLabel: 'Supprimer' })) return;
  await updateDoc(_pgRef(VS.activePage.id), { fogOps: [] }).catch(() => showNotif('Erreur', 'error'));
  _vttRefreshToolPanels();
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
  _vttRefreshToolPanels();
}

// Empile un nouvel id de tracé et invalide la pile de rétablissement (nouvelle action).
function _pushDrawHistory(id) { _drawHistory.push(id); _drawRedo = []; _vttRefreshToolPanels(); }

// Annule le dernier tracé de la session (bouton ↩ et Ctrl+Z). Mémorise la donnée
// annulée pour permettre le rétablissement (Ctrl+Y).
function _vttUndoDraw() {
  const lastId = _drawHistory.pop();
  if (!lastId) return;
  const data = _annotations[lastId]?.data;
  if (data) _drawRedo.push({ id: lastId, data: { ...data } }); // capture avant suppression
  deleteDoc(_annotRef(lastId)).catch(() => {});
  _vttRefreshToolPanels();
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
  _vttRefreshToolPanels();
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
  _vttRefreshToolPanels();
}
function _vttDrawWidth(w) {
  _drawWidth = Number(w);
  _vttRefreshToolPanels();
}
function _vttToggleDrawFill() {
  _drawFill = !_drawFill;
  _vttRefreshToolPanels();
}
async function _vttClearAnnots() {
  if (!VS.activePage) return;
  if (!await confirmModal('Effacer toutes les annotations de cette page ?')) return;
  const ids = Object.values(_annotations)
    .filter(entry => entry.data.pageId === VS.activePage.id)
    .map(entry => entry.data.id);
  if (!ids.length) { showNotif('Aucune annotation à effacer.', 'info'); return; }
  await _deleteAnnotsWithUndo(ids);
}

// Formats pensés pour des battlemaps. Les valeurs restent des cases de grille :
// l'image est ajustée séparément et n'impose jamais ses dimensions en pixels.
const _PG_PRESETS = [
  { icon:'⚔️', lb:'Escarmouche', c:20, r:15, desc:'Combat rapide' },
  { icon:'🗺️', lb:'Rencontre',   c:30, r:20, desc:'Format standard', recommended:true },
  { icon:'🏰', lb:'Donjon',       c:40, r:30, desc:'Plusieurs salles' },
  { icon:'🌍', lb:'Grande carte', c:60, r:40, desc:'Exploration vaste' },
];
function _pgPreviewImageUrl(image) {
  const source = String(image?.sourcePath || image?.url || '').trim();
  if (!source) return '';
  if (/^\.?\/?images\/maps\//i.test(source) || /(?:raw\.githubusercontent\.com|github\.com\/[^/]+\/[^/]+\/(?:blob|tree))\//i.test(source)) {
    return githubPagesUrl(source);
  }
  return normalizeImageUrl(String(image?.url || source).trim());
}
function _pgModalBody(pfx, { name='', folder='', cols=30, rows=20, fog=null, visionUnlimited=false, mapImages=[] } = {}) {
  const canUseAdvancedVtt = _vttAdvancedPremium();
  const placedImages = (Array.isArray(mapImages) ? mapImages : []).filter(image => _pgPreviewImageUrl(image));
  const previewLayers = placedImages.map(image => {
    const x = Number(image.x) || 0, y = Number(image.y) || 0;
    const w = Math.max(1, Number(image.w) || cols), h = Math.max(1, Number(image.h) || rows);
    return `<img class="vtt-pgm-map-layer${image.layer==='fg'?' is-foreground':''}" src="${_esc(_pgPreviewImageUrl(image))}" alt="" data-pg-map-layer data-x="${x}" data-y="${y}" data-w="${w}" data-h="${h}">`;
  }).join('');
  const presets = _PG_PRESETS.map(p =>
    `<button type="button" class="vtt-pgm-preset${p.c===cols&&p.r===rows?' active':''}" data-vtt-fn="_vttPgPreset" data-vtt-args="${pfx}|${p.c}|${p.r}" aria-pressed="${p.c===cols&&p.r===rows}">
      ${p.recommended ? '<span class="vtt-pgm-recommended">Conseillé</span>' : ''}
      <span class="vtt-pgm-preset-icon" aria-hidden="true">${p.icon}</span>
      <span class="vtt-pgm-preset-copy"><strong>${p.lb}</strong><small>${p.c} × ${p.r} cases</small><em>${p.desc}</em></span>
    </button>`
  ).join('');
  return `
    <div class="vtt-pgm-shell">
      <div class="vtt-pgm">
        <section class="vtt-pgm-section vtt-pgm-identity">
          <div class="vtt-pgm-section-head">
            <span class="vtt-pgm-step">1</span>
            <div><strong>Identifier la scène</strong><small>Retrouve-la rapidement pendant la partie.</small></div>
          </div>
          <div class="vtt-pgm-identity-grid">
            <label class="vtt-pgm-field">
              <span class="vtt-pgm-lbl">Nom de la scène</span>
              <input id="${pfx}name" type="text" value="${_esc(name)}" placeholder="ex : Embuscade dans la forêt" autofocus>
            </label>
            <label class="vtt-pgm-field">
              <span class="vtt-pgm-lbl">Dossier <em>(optionnel)</em></span>
              <input id="${pfx}folder" type="text" value="${_esc(folder)}" placeholder="ex : Chapitre 1" list="${pfx}folders" autocomplete="off">
              ${_pageFolderDatalist(pfx+'folders')}
            </label>
          </div>
        </section>

        <section class="vtt-pgm-section">
          <div class="vtt-pgm-section-head">
            <span class="vtt-pgm-step">2</span>
            <div><strong>Choisir le format de battlemap</strong><small>Les dimensions représentent les cases jouables, pas les pixels de l’image.</small></div>
          </div>
          <div class="vtt-pgm-presets">${presets}</div>
          <div class="vtt-pgm-size-editor">
            <div class="vtt-pgm-custom">
              <span class="vtt-pgm-lbl">Dimensions personnalisées</span>
              <div class="vtt-pgm-dims">
                <label><span>Largeur</span><input id="${pfx}cols" type="number" value="${cols}" min="8" max="200" inputmode="numeric" data-vtt-fn="_vttPgDimensions" data-vtt-on="input" data-vtt-args="${pfx}|cols"><small>cases</small></label>
                <button type="button" class="vtt-pgm-swap" data-vtt-fn="_vttPgSwap" data-vtt-args="${pfx}" title="Permuter largeur et hauteur" aria-label="Permuter largeur et hauteur">⇄</button>
                <label><span>Hauteur</span><input id="${pfx}rows" type="number" value="${rows}" min="8" max="200" inputmode="numeric" data-vtt-fn="_vttPgDimensions" data-vtt-on="input" data-vtt-args="${pfx}|rows"><small>cases</small></label>
              </div>
              <span class="vtt-pgm-hint">De 8 à 200 cases par côté. Utilise ⇄ pour passer en portrait.</span>
              ${placedImages.length ? `<button type="button" class="vtt-pgm-fit-map" id="${pfx}fit-map" data-vtt-fn="_vttPgToggleFit" data-vtt-args="${pfx}" aria-pressed="false">
                <span class="vtt-pgm-fit-icon" aria-hidden="true">⌗</span>
                <span><strong>Adapter la grille aux images</strong><small>Ajuste la scène à leur emprise, sans les déplacer ni les redimensionner.</small></span>
                <span class="vtt-pgm-fit-state">Calculer</span>
              </button>` : ''}
            </div>
            <div class="vtt-pgm-preview" aria-live="polite">
              <div class="vtt-pgm-preview-stage"><div class="vtt-pgm-preview-map ${previewLayers?'has-map':'is-empty'}" id="${pfx}preview-map">${previewLayers || '<span class="vtt-pgm-map-empty"><b>🗺️</b>Aucune carte placée</span>'}</div></div>
              <div class="vtt-pgm-preview-meta" id="${pfx}preview-meta"></div>
            </div>
          </div>
        </section>

        ${fog !== null ? `<section class="vtt-pgm-section vtt-pgm-options">
          <div class="vtt-pgm-section-head">
            <span class="vtt-pgm-step">3</span>
            <div><strong>Options de jeu</strong><small>Tu pourras encore les modifier plus tard.</small></div>
          </div>
          ${canUseAdvancedVtt ? `
          <label class="vtt-pgm-switch-row">
            <input type="checkbox" id="${pfx}fog" ${fog?'checked':''} data-vtt-fn="_vttPgFogMode" data-vtt-on="change" data-vtt-args="${pfx}">
            <span class="vtt-pgm-switch" aria-hidden="true"><span></span></span>
            <span class="vtt-pgm-switch-copy"><strong>Éclairage dynamique</strong><small>Brouillard de guerre, murs et lignes de vue.</small></span>
            <span class="vtt-pgm-switch-status"><span class="is-off">Désactivé</span><span class="is-on">Activé</span></span>
          </label>
          <label class="vtt-pgm-switch-row" id="${pfx}vision-row">
            <input type="checkbox" id="${pfx}vision-unlimited" ${visionUnlimited?'checked':''}>
            <span class="vtt-pgm-switch" aria-hidden="true"><span></span></span>
            <span class="vtt-pgm-switch-copy"><strong>Vision illimitée</strong><small>Les murs bloquent toujours la vue, mais aucun rayon ne limite les personnages.</small></span>
            <span class="vtt-pgm-switch-status"><span class="is-off">3 cases</span><span class="is-on">Illimitée</span></span>
          </label>` : `
          <div class="vtt-pgm-switch-row is-locked">
            <span class="vtt-pgm-switch" aria-hidden="true"><span></span></span>
            <span class="vtt-pgm-switch-copy"><strong>Éclairage dynamique</strong><small>Brouillard de guerre, murs et lignes de vue.</small></span>
            <em>Premium</em>
          </div>`}
        </section>` : ''}
      </div>
    </div>`;
}
function _vttPgPreset(pfx, c, r) {
  const cEl = document.getElementById(pfx+'cols'), rEl = document.getElementById(pfx+'rows');
  if (cEl) cEl.value = c;
  if (rEl) rEl.value = r;
  _vttPgSetFit(pfx, false);
  _vttPgDimensions(pfx, 'cols');
}
function _vttPgSwap(pfx) {
  const cEl = document.getElementById(pfx+'cols'), rEl = document.getElementById(pfx+'rows');
  if (!cEl || !rEl) return;
  _vttPgSetFit(pfx, false);
  [cEl.value, rEl.value] = [rEl.value, cEl.value];
  _vttPgDimensions(pfx);
}
function _vttPgSetFit(pfx, active) {
  const btn = document.getElementById(pfx+'fit-map');
  if (!btn) return;
  btn.classList.toggle('active', !!active);
  btn.setAttribute('aria-pressed', String(!!active));
  const state = btn.querySelector('.vtt-pgm-fit-state');
  if (state) state.textContent = active ? 'Ajustée' : 'Calculer';
}
function _vttPgImageBounds(pfx) {
  const layers = [...document.querySelectorAll(`#${pfx}preview-map [data-pg-map-layer]`)].map(layer => ({
    x: Number(layer.dataset.x) || 0,
    y: Number(layer.dataset.y) || 0,
    w: Math.max(1, Number(layer.dataset.w) || 1),
    h: Math.max(1, Number(layer.dataset.h) || 1),
  }));
  return sceneGridSizeForImages(layers);
}
function _vttPgToggleFit(pfx) {
  const btn = document.getElementById(pfx+'fit-map');
  if (!btn || btn.disabled) return;
  const bounds = _vttPgImageBounds(pfx);
  if (!bounds) return;
  const cEl = document.getElementById(pfx+'cols'), rEl = document.getElementById(pfx+'rows');
  if (cEl) cEl.value = bounds.cols;
  if (rEl) rEl.value = bounds.rows;
  _vttPgSetFit(pfx, true);
  _vttPgDimensions(pfx, 'fit');
  if (bounds.clippedByLimit) showNotif('La grille est limitée à 200 cases : certaines images dépassent encore.', 'warning');
  else if (bounds.hasNegativeOrigin) showNotif('Une image dépasse à gauche ou en haut de l’origine de la scène.', 'warning');
}
function _vttPgInit(pfx) {
  _vttPgDimensions(pfx);
  _vttPgFogMode(pfx);
}
function _vttPgFogMode(pfx) {
  const fog = document.getElementById(pfx+'fog');
  const vision = document.getElementById(pfx+'vision-unlimited');
  const row = document.getElementById(pfx+'vision-row');
  if (!vision || !row) return;
  const available = !!fog?.checked;
  vision.disabled = !available;
  row.classList.toggle('is-disabled', !available);
}
function _vttPgDimensions(pfx, changedAxis = '') {
  const cEl = document.getElementById(pfx+'cols'), rEl = document.getElementById(pfx+'rows');
  let c = Math.max(8, Math.min(200, parseInt(cEl?.value) || 8));
  let r = Math.max(8, Math.min(200, parseInt(rEl?.value) || 8));
  const map = document.getElementById(pfx+'preview-map');
  const meta = document.getElementById(pfx+'preview-meta');
  if (changedAxis && changedAxis !== 'fit') _vttPgSetFit(pfx, false);
  const scale = Math.min(226 / c, 126 / r);
  if (map) {
    map.style.width = `${Math.max(38, Math.round(c * scale))}px`;
    map.style.height = `${Math.max(38, Math.round(r * scale))}px`;
    map.style.setProperty('--pg-cols', c);
    map.style.setProperty('--pg-rows', r);
    map.querySelectorAll('[data-pg-map-layer]').forEach(layer => {
      const x = Number(layer.dataset.x) || 0, y = Number(layer.dataset.y) || 0;
      const w = Math.max(1, Number(layer.dataset.w) || c), h = Math.max(1, Number(layer.dataset.h) || r);
      layer.style.left = `${x / c * 100}%`;
      layer.style.top = `${y / r * 100}%`;
      layer.style.width = `${w / c * 100}%`;
      layer.style.height = `${h / r * 100}%`;
    });
  }
  if (meta) {
    const orientation = c === r ? 'Carrée' : c > r ? 'Paysage' : 'Portrait';
    const widthM = Math.round(c * CELL_M * 10) / 10;
    const heightM = Math.round(r * CELL_M * 10) / 10;
    const bounds = _vttPgImageBounds(pfx);
    const sourceSize = bounds
      ? `${bounds.imageCount} image${bounds.imageCount > 1 ? 's' : ''} · emprise jusqu’à ${Math.ceil(bounds.maxRight)} × ${Math.ceil(bounds.maxBottom)} cases`
      : `Repère image : ${c * CELL} × ${r * CELL} px à ${CELL} px/case`;
    meta.innerHTML = `<strong>${c} × ${r} cases</strong><span>${orientation} · ${widthM} × ${heightM} m</span><small>${sourceSize}</small>`;
  }
  document.querySelectorAll('.vtt-pgm-preset').forEach(b => {
    const [bp, bc, br] = (b.dataset.vttArgs||'').split('|');
    const active = bp===pfx && +bc===c && +br===r;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
}

function _vttAddPage(encodedFolder = '') {
  const folder = encodedFolder ? decodeURIComponent(encodedFolder) : '';
  openModal('🗺️ Nouvelle scène', `
    ${_pgModalBody('vpf-', { folder, fog:false })}
    <div class="vtt-pgm-actions">
      <button class="btn-secondary" data-action="close-modal">Annuler</button>
      <button class="btn-secondary" data-vtt-fn="_vttConfirmAddPage" data-vtt-args="false">Créer seulement</button>
      <button class="btn-primary" data-vtt-fn="_vttConfirmAddPage" data-vtt-args="true">Créer et ouvrir</button>
    </div>`, { subtitle:folder ? `Nouvelle scène dans « ${folder} »` : 'Une grille prête pour tes cartes et tes combats', accent:'#7eb0ff' });
  _vttPgInit('vpf-');
}

// Datalist des dossiers de pages existants (suggestions de saisie)
function _pageFolderDatalist(id) {
  const folders = [...new Set(Object.values(VS.pages).map(p => (p.folder||'').trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'}));
  return `<datalist id="${id}">${folders.map(f=>`<option value="${_esc(f)}">`).join('')}</datalist>`;
}

async function _vttConfirmAddPage(openAfter = true) {
  const name=(document.getElementById('vpf-name')?.value||'').trim();
  const folder=(document.getElementById('vpf-folder')?.value||'').trim();
  const cols=Math.max(8,Math.min(200,parseInt(document.getElementById('vpf-cols')?.value)||30));
  const rows=Math.max(8,Math.min(200,parseInt(document.getElementById('vpf-rows')?.value)||20));
  if (!name) { showNotif('Nom requis','error'); return; }
  const fogEnabled = _vttAdvancedPremium()
    ? (document.getElementById('vpf-fog')?.checked ?? false)
    : false;
  const visionUnlimited = _vttAdvancedPremium()
    ? (document.getElementById('vpf-vision-unlimited')?.checked ?? false)
    : false;
  const order = Object.keys(VS.pages).length;
  try {
    const pageRef = await addDoc(_pgsCol(),{
      name,folder,cols,rows,fogEnabled,visionUnlimited,backgroundImages:[],order,createdAt:serverTimestamp(),
    });
    VS.pages[pageRef.id] = {
      id:pageRef.id,name,folder,cols,rows,fogEnabled,visionUnlimited,backgroundImages:[],order,createdAt:new Date(),
    };
    closeModalDirect();
    if (openAfter !== 'false' && openAfter !== false) await _switchPage(pageRef.id);
    else _renderPageTabs();
    showNotif(openAfter !== 'false' && openAfter !== false ? 'Scène créée et ouverte.' : 'Scène créée.', 'success');
  } catch (error) {
    console.error('[vtt] création scène', error);
    showNotif('Erreur création de la scène','error');
  }
}

/** Prépare la liste d'états avant l'application d'un état qui rompt la
 * concentration (Rage). Les effets liés sont nettoyés avant l'écriture unique
 * de la nouvelle liste sur le token. */
export async function _vttConditionsBeforeStateApplication(token, conditionLib) {
  const conditions = Array.isArray(token?.conditions) ? token.conditions : [];
  if (!conditionLib?.effects?.breakConcentration) return conditions;
  const concentrating = conditions.filter(c => c?.concentrationSpell);
  for (const cond of concentrating) {
    await _vttBreakConcentrationEffects(token.id, cond);
  }
  return conditions.filter(c => !c?.concentrationSpell);
}

function _vttEditPage(id) {
  const p=VS.pages[id]; if (!p) return;
  openModal('✏️ Modifier la scène', `
    ${_pgModalBody('vpe-', { name:p.name, folder:p.folder||'', cols:p.cols||24, rows:p.rows||18, fog:!!p.fogEnabled, visionUnlimited:!!p.visionUnlimited, mapImages:p.backgroundImages||[] })}
    <div class="vtt-pgm-actions">
      <button class="btn-secondary" data-action="close-modal">Annuler</button>
      <button class="btn-primary" data-vtt-fn="_vttConfirmEditPage" data-vtt-args="${id}">Enregistrer</button>
    </div>`, { subtitle:'Dimensions, rangement et options de jeu', accent:'#7eb0ff' });
  _vttPgInit('vpe-');
}
async function _vttConfirmEditPage(id) {
  const name=(document.getElementById('vpe-name')?.value||'').trim();
  const folder=(document.getElementById('vpe-folder')?.value||'').trim();
  const cols=Math.max(8,Math.min(200,parseInt(document.getElementById('vpe-cols')?.value)||24));
  const rows=Math.max(8,Math.min(200,parseInt(document.getElementById('vpe-rows')?.value)||18));
  if (!name) { showNotif('Nom requis','error'); return; }
  const fogEnabled = _vttAdvancedPremium()
    ? (document.getElementById('vpe-fog')?.checked ?? false)
    : !!VS.pages[id]?.fogEnabled;
  const visionUnlimited = _vttAdvancedPremium()
    ? (document.getElementById('vpe-vision-unlimited')?.checked ?? false)
    : !!VS.pages[id]?.visionUnlimited;
  closeModalDirect();
  const patch = {name,folder,cols,rows,fogEnabled,visionUnlimited};
  await updateDoc(_pgRef(id),patch).catch(()=>showNotif('Erreur','error'));
  if (VS.activePage?.id===id) {
    VS.activePage={...VS.activePage,...patch};
    _drawGrid();
  }
}

async function _vttDeletePage(id) {
  if (!await confirmModal('Supprimer cette page ?',{title:'Supprimer ?',danger:true})) return;
  await deleteDoc(_pgRef(id)).catch(()=>{});
}

async function _vttDuplicatePage(id) {
  if (!STATE.isAdmin) return;
  const source = VS.pages[id];
  if (!source) return;
  const existingNames = new Set(Object.values(VS.pages).map(page => String(page.name || '').trim().toLocaleLowerCase('fr')));
  const baseName = `${source.name || 'Scène'} — copie`;
  let name = baseName;
  let suffix = 2;
  while (existingNames.has(name.toLocaleLowerCase('fr'))) name = `${baseName} ${suffix++}`;
  const { id:_id, createdAt:_createdAt, updatedAt:_updatedAt, order:_order, ...scene } = source;
  const order = Object.keys(VS.pages).length;
  try {
    const pageRef = await addDoc(_pgsCol(), {
      ...scene,
      name,
      folder:(source.folder || '').trim(),
      order,
      createdAt:serverTimestamp(),
    });
    VS.pages[pageRef.id] = {
      ...scene,
      id:pageRef.id,
      name,
      folder:(source.folder || '').trim(),
      order,
      createdAt:new Date(),
    };
    await _switchPage(pageRef.id);
    showNotif('Scène dupliquée sans ses tokens.', 'success');
  } catch (error) {
    console.error('[vtt] duplication scène', error);
    showNotif('Impossible de dupliquer cette scène.', 'error');
  }
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
    // Un summon est temporaire : « retirer » signifie le dissiper. Le mettre
    // en réserve le rendait impossible à rappeler ou à faire expirer.
    if (isDuplicate || isTemporarySummonToken(t)) {
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
  const reserve = invocableCharacterTokens(
    VS.tokens,
    VS.activePage.id,
    token => _canControlToken(token, uid),
  );
  if (!reserve.length) { showNotif('Ton personnage est déjà sur la carte.','info'); return; }
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
    .filter(e => _canControlToken(e.data, uid) && e.data.pageId && e.data.pageId === VS.activePage?.id)
    .map(e => e.data);
  if (!onScene.length) { showNotif('Aucun personnage à ranger','info'); return; }
  const tok = tokenId ? onScene.find(t => t.id === tokenId) : (onScene.length === 1 ? onScene[0] : null);
  if (!tok) { _vttMyTokenPicker(onScene, '_vttRetireMyToken', '📦 Quel personnage ranger ?', '<span style="color:var(--text-muted)">📦 Ranger</span>'); return; }
  if (tokenId) closeModalDirect();
  await _vttSendTokensToReserve([tok.id]);
}

async function _vttSendTokensToReserve(ids) {
  const uid = STATE.user?.uid;
  const snapshots = [...new Set(ids)]
    .map(id => VS.tokens[id]?.data)
    .filter(token => token && _canControlToken(token, uid))
    .map(token => ({ token, id: token.id, pageId: token.pageId ?? null, visible: token.visible !== false }));
  if (!snapshots.length) return false;

  const results = await Promise.allSettled(snapshots.map(async ({ token, id }) => {
    if (isTemporarySummonToken(token)) {
      await _persistInvocationState(token);
      await deleteDoc(_tokRef(id));
      return 'dismissed';
    }
    await updateDoc(_tokRef(id), { pageId: null, visible: false });
    return 'reserved';
  }));
  const succeeded = snapshots
    .map((snapshot, index) => ({ ...snapshot, outcome:results[index] }))
    .filter(entry => entry.outcome.status === 'fulfilled');
  const reserved = succeeded.filter(entry => entry.outcome.value === 'reserved');
  const dismissed = succeeded.filter(entry => entry.outcome.value === 'dismissed');
  const failures = results.filter(result => result.status === 'rejected');
  failures.forEach(result => console.error('[vtt] rangement:', result.reason));
  if (!succeeded.length) {
    showNotif('Impossible de retirer la sélection de la carte.', 'error');
    return false;
  }

  _deselect();
  const suffix = failures.length ? ` · ${failures.length} échec${failures.length > 1 ? 's' : ''}` : '';
  const parts = [];
  if (reserved.length) parts.push(`${reserved.length} token${reserved.length > 1 ? 's' : ''} placé${reserved.length > 1 ? 's' : ''} en réserve`);
  if (dismissed.length) parts.push(`${dismissed.length} invocation${dismissed.length > 1 ? 's' : ''} dissipée${dismissed.length > 1 ? 's' : ''}`);
  showNotif(`${parts.join(' · ')}${suffix}.`, failures.length ? 'warning' : 'success', reserved.length ? {
    duration: 7000,
    action: {
      label: '↶ Annuler',
      onClick: async () => {
        await Promise.all(reserved.map(({ id, pageId, visible }) => updateDoc(_tokRef(id), { pageId, visible })));
        showNotif('Retrait de la carte annulé.', 'success');
      },
    },
  } : undefined);
  return true;
}

let _reserveSummonCleanupRunning = false;

async function _cleanupReserveSummons({ notify = false } = {}) {
  // Attendre les fiches personnages permet de sauvegarder correctement les
  // PV/PM persistants avant de supprimer les invocations historiques.
  if (!STATE.isAdmin || !_charsReady || _reserveSummonCleanupRunning) return 0;
  const blocked = reserveSummonTokens(Object.values(VS.tokens).map(entry => entry?.data).filter(Boolean));
  if (!blocked.length) {
    if (notify) showNotif('Aucune invocation bloquée dans la réserve.', 'info');
    return 0;
  }
  _reserveSummonCleanupRunning = true;
  try {
    // Sauvegarde les PV/PM persistants avant de retirer les documents temporaires.
    await Promise.allSettled(blocked.map(token => _persistInvocationState(token)));
    for (let offset = 0; offset < blocked.length; offset += 400) {
      const batch = writeBatch(db);
      blocked.slice(offset, offset + 400).forEach(token => batch.delete(_tokRef(token.id)));
      await batch.commit();
    }
    blocked.forEach(token => {
      VS.tokens[token.id]?.shape?.destroy();
      delete VS.tokens[token.id];
    });
    if (blocked.some(token => token.id === VS.selected)) _deselect();
    _renderTraySoon();
    if (notify) {
      showNotif(`🧹 ${blocked.length} invocation${blocked.length > 1 ? 's' : ''} bloquée${blocked.length > 1 ? 's' : ''} supprimée${blocked.length > 1 ? 's' : ''}.`, 'success');
    }
    return blocked.length;
  } catch (error) {
    console.error('[vtt] cleanup reserve summons:', error);
    if (notify) showNotif('Impossible de nettoyer les invocations bloquées.', 'error');
    return 0;
  } finally {
    _reserveSummonCleanupRunning = false;
  }
}

async function _vttClearReserveSummons() {
  if (!STATE.isAdmin) return;
  const blocked = reserveSummonTokens(Object.values(VS.tokens).map(entry => entry?.data).filter(Boolean));
  if (!blocked.length) return showNotif('Aucune invocation bloquée dans la réserve.', 'info');
  const count = blocked.length;
  const confirmed = await confirmModal(
    `Dissiper ${count} invocation${count > 1 ? 's' : ''} bloquée${count > 1 ? 's' : ''} dans la réserve ?<br><br><span style="opacity:.75;font-size:.86em">Les personnages et PNJ permanents ne seront pas touchés.</span>`,
    { title:'Nettoyer la réserve', confirmLabel:'Dissiper', danger:true },
  );
  if (confirmed) await _cleanupReserveSummons({ notify:true });
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
  const previous = t.visible !== false;
  _vttPatchTokenOptimistically(id, { visible: !previous });
  await updateDoc(_tokRef(id),{visible:!previous}).catch(error => {
    _vttPatchTokenOptimistically(id, { visible: previous });
    console.error('[vtt] visibilité non modifiée', error);
  });
}
async function _vttClearBuffs(id) {
  if (!STATE.isAdmin) return;
  const t=VS.tokens[id]?.data; if (!t) return;
  const previous = t.buffs || [];
  _vttPatchTokenOptimistically(id, { buffs: [] });
  try {
    await updateDoc(_tokRef(id),{buffs:[]});
  } catch (error) {
    _vttPatchTokenOptimistically(id, { buffs: previous });
    console.error('[vtt] effets non supprimés', error);
    showNotif('Impossible de supprimer les effets.', 'error');
    return;
  }
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

/** Mode de jet apporté par les états pour une caractéristique donnée. */
export function _conditionStatRollMode(token, statKey, kind = 'check') {
  return conditionStatRollMode(_activeConditionsOf(token), statKey, kind);
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

/** Règles du style actif du personnage, résolues au moment du jet. */
function _combatStyleContext(srcToken, tgtToken, opt) {
  const character = _characterForToken(srcToken);
  const style = character ? detectCombatStyle(character, VS.combatStyles || []) : null;
  const hasAttackRoll = !opt?.autoHit && !opt?.isCaSort && !opt?.isUtil
    && !opt?.isAffliction && !opt?.isEnchant;
  if (!style || !hasAttackRoll) {
    return { style, modifiers: { hasAdv:false, hasDis:false, reasons:[] } };
  }
  const rules = normalizeCombatStyle(style).rules;
  const distance = nearestHostileDistance(
    srcToken,
    Object.values(VS.tokens || {}).map(entry => entry?.data || entry),
    (source, hostile) => _tokenAttackDistance(source, hostile, rules.contactDistance === 1 ? 1 : null),
    token => (_effectiveTokenHp(token) ?? 1) > 0,
  );
  return {
    style,
    modifiers: combatStyleAttackModifiers(style, {
      distance,
      // Un soin reste une action ciblée à distance pour cette gêne, même lancé
      // sur une cible adjacente : c'est la présence de l'ennemi qui compte.
      isMeleeAttack: !opt?.isHeal && (opt?.isMeleeAttack === true || (opt?.portee || 1) <= 1),
      isHealingAction: !!opt?.isHeal,
    }),
  };
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
  let chosen = null;
  for (const s of (char.deck_sorts || [])) {
    if (!s?.actif) continue;
    const br = _vttSpellMods(s)?.bouclierReactif;
    if (!br || !_shieldBlocks(br.tier, rank || 'classique')) continue;
    const cost = (Number.isFinite(s.pmOverride) && s.pmOverride >= 0) ? s.pmOverride : (parseInt(s.pm) || 0);
    const res = spellCostRes(s).id;
    if (cost > _charResCur(char, res)) continue;   // solde dans la ressource du sort
    if (!chosen || cost < chosen.cost) chosen = { char, spell: s, cost, res };
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
  if (!pick) { showNotif('Aucun bouclier réactif utilisable (palier d\'attaquant ou ressource insuffisante)', 'info'); return; }

  // Restaure les PV infligés (cap au max) via _setHp (sync fiche perso incluse).
  const restore = Math.max(0, m.dmgTotal || 0);
  const lt = _live(dtok);
  const hpMax = m.hpMax ?? lt.displayHpMax ?? 20;
  const curHp = lt.displayHp ?? dtok.hp ?? 0;
  // Coût en PV : on l'intègre à l'écriture PV unique (le sort rend des PV puis en
  // consomme). PM / Or : dépense séparée dans la bonne ressource.
  const isPvCost = pick.res === 'pv';
  const newHp = Math.max(0, Math.min(hpMax, curHp + restore) - (isPvCost ? pick.cost : 0));
  const costLbl = _RES_LABEL[pick.res] || 'PM';

  try {
    await _setHp(dtok, newHp);
    await _syncDownedCondition(dtok, newHp);
    if (!isPvCost) await _spendCharSpellCost(pick.char.id, pick.res, pick.cost, dtok.id, pick.spell.nom);
    await updateDoc(doc(_logCol(), logId), {
      shieldCancelled: true, shieldCancelledBy: STATE.user?.uid || null,
      shieldSpell: pick.spell.nom || 'Bouclier réactif',
    });
    showNotif(`🛡 ${pick.spell.nom || 'Bouclier réactif'} — coup annulé · +${restore} PV (−${pick.cost} ${costLbl})`, 'success');
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
      if (st.combatHpEstimate) VS.combatHpEstimates.set(tid, { ...st.combatHpEstimate });
      else VS.combatHpEstimates.delete(tid);
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
  const buffs = [...existing, newBuff];
  _vttPatchTokenOptimistically(tokenId, { buffs });
  closeModalDirect();
  await updateDoc(_tokRef(tokenId), { buffs }).catch(error => {
    _vttPatchTokenOptimistically(tokenId, { buffs: existing });
    console.error('[vtt] effet manuel non appliqué', error);
  });
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
function _vttAdjustVital(tokenId, kind, delta) {
  const t = VS.tokens[tokenId]?.data;
  if (!t || !_canControlToken(t)) return;
  const live = _live(t);
  const isHp = kind === 'PV';
  if (!isHp && kind !== 'PM') return;
  const current = Number(isHp ? live.displayHp : live.displayPm);
  const max = Number(isHp ? live.displayHpMax : live.displayPmMax);
  if (!Number.isFinite(current) || !Number.isFinite(max) || max < 0) return;
  const step = Math.sign(Number(delta));
  if (!Number.isFinite(step) || !step) return;
  const next = Math.max(0, Math.min(max, current + step));
  if (next === current) return;
  // Le cache est mis à jour immédiatement par les setters ; ne pas bloquer les
  // clics suivants en attendant l'acquittement Firestore de chaque pas.
  void (isHp ? _vttSetHp(tokenId, next) : _vttSetPm(tokenId, next))
    .catch(error => _vttReportActionFailure('_vttAdjustVital', error));
}
async function _vttSetPm(tokenId,pm) {
  const t=VS.tokens[tokenId]?.data; if (!t) return;
  if (!_canControlToken(t)) return;
  if (t.summonKind === 'invocation') {
    try {
      const next = await _setInvocationPm(t, pm);
      if (!next) return;
      _renderInspector(VS.tokens[tokenId]?.data || t);
      _patchShape(tokenId);
    } catch (err) {
      console.error('[vtt] modification des PM de l’invocation refusée', err);
      showNotif('Impossible de modifier les PM de cette invocation', 'error');
    }
    return;
  }
  const v=Math.max(0,pm);
  if (t.characterId) {
    const c = VS.characters[t.characterId]; if (!c) return;
    const previous = _charPmCur(c);
    Object.assign(c, _charPmPatch(v));
    _patchEntityTokenShapes('characterId', t.characterId);
    await updateDoc(_chrRef(t.characterId), { ..._charPmPatch(v), vttControlTokenId:tokenId }).catch(error => {
      Object.assign(c, _charPmPatch(previous));
      _patchEntityTokenShapes('characterId', t.characterId);
      console.error('[vtt] PM personnage non modifiés', error);
    });
  } else if (t.npcId) {
    const n = VS.npcs[t.npcId]; if (!n) return;
    const previous = n.pmCurrent;
    n.pmCurrent = v;
    _patchEntityTokenShapes('npcId', t.npcId);
    await updateDoc(_npcRef(t.npcId),{pmCurrent:v}).catch(error => {
      n.pmCurrent = previous;
      _patchEntityTokenShapes('npcId', t.npcId);
      console.error('[vtt] PM PNJ non modifiés', error);
    });
  }
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
  const previous = t.buffs || [];
  const buffs = previous.map(b => ({ ...b }));
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
  _renderInspector(VS.tokens[tokenId]?.data || t);
  _patchShape(tokenId);
  await updateDoc(_tokRef(tokenId), { buffs }).catch(error => {
    _vttPatchTokenOptimistically(tokenId, { buffs: previous });
    console.error('[vtt] bonus temporaire non modifié', error);
  });
}
async function _vttTokenResetBonus(tokenId) {
  const t = VS.tokens[tokenId]?.data; if (!t) return;
  if (!_canControlToken(t)) return;
  const previous = t.buffs || [];
  const buffs = previous.filter(b => !(b && b.manual));
  if (VS.tokens[tokenId]) VS.tokens[tokenId].data = { ...t, buffs };
  _renderInspector(VS.tokens[tokenId]?.data || t);
  _patchShape(tokenId);
  await updateDoc(_tokRef(tokenId), { buffs }).catch(error => {
    _vttPatchTokenOptimistically(tokenId, { buffs: previous });
    console.error('[vtt] bonus temporaires non réinitialisés', error);
  });
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

// Level up : consomme un palier d'XP, monte d'un niveau, conserve l'excédent.
async function _vttMsLevelUp(charId, uid) {
  if (!_msCanEdit(uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  const niv    = parseInt(c.niveau) || 1;
  const palier = calcPalier(niv);
  const xp     = parseInt(c.exp) || 0;
  if (palier <= 0 || xp < palier) return;
  const newNiv = niv + 1;
  const newXp  = xp - palier;                 // excédent reporté sur le niveau suivant
  await updateDoc(_chrRef(charId), { niveau: newNiv, exp: newXp }).catch(() => {});
  c.niveau = newNiv;
  c.exp    = newXp;
  _renderMiniSheet(uid);
}

async function _vttMsSetHp(charId, uid, hp) {
  if (!_msCanEditVitals(charId, uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  const controlledToken = resolveCharacterControlToken(charId, VS.tokens, STATE.user?.uid, VS.characters);
  if (!STATE.isAdmin && c.uid !== STATE.user?.uid && !controlledToken) return;
  const max = calcPVMax(c);
  const val = Math.max(0, Math.min(max, Math.round(hp)));
  const patch = controlledToken
    ? { hp: val, vttControlTokenId: controlledToken.id }
    : { hp: val };
  const saved = await updateDoc(_chrRef(charId), patch).then(() => true).catch(error => {
    console.error('[vtt] PV personnage non modifiés depuis la mini-fiche', error);
    showNotif('Impossible de modifier les PV de ce personnage', 'error');
    return false;
  });
  if (!saved) return;
  c.hp = val;
  _renderMiniSheet(uid);
}

async function _vttMsSetPm(charId, uid, pm) {
  if (!_msCanEditVitals(charId, uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  const controlledToken = resolveCharacterControlToken(charId, VS.tokens, STATE.user?.uid, VS.characters);
  if (!STATE.isAdmin && c.uid !== STATE.user?.uid && !controlledToken) return;
  const max = calcPMMax(c);
  const val = Math.max(0, Math.min(max, Math.round(pm)));
  const patch = {
    ..._charPmPatch(val),
    ...(controlledToken ? { vttControlTokenId: controlledToken.id } : {}),
  };
  const saved = await updateDoc(_chrRef(charId), patch).then(() => true).catch(error => {
    console.error('[vtt] PM personnage non modifiés depuis la mini-fiche', error);
    showNotif('Impossible de modifier les PM de ce personnage', 'error');
    return false;
  });
  if (!saved) return;
  c.pm = val;
  c.pmActuel = val;
  _renderMiniSheet(uid);
}

// Ajuste la réserve de Garde d'un personnage depuis la mini-fiche (bornée à
// [0, gardeMax]). Mêmes garde-fous que les PV/PM. No-op si la mécanique est inactive.
async function _vttMsSetGarde(charId, uid, garde) {
  if (!_msCanEditVitals(charId, uid)) return;
  const c = VS.characters[charId]; if (!c) return;
  const controlledToken = resolveCharacterControlToken(charId, VS.tokens, STATE.user?.uid, VS.characters);
  if (!STATE.isAdmin && c.uid !== STATE.user?.uid && !controlledToken) return;
  const max = calcGardeMax(c);
  if (max <= 0) return;
  const val = Math.max(0, Math.min(max, Math.round(garde)));
  const previous = Math.max(0, Math.min(max, parseInt(c.garde, 10) || 0));
  if (val === previous) return;
  const patch = { garde: val, ...(controlledToken ? { vttControlTokenId: controlledToken.id } : {}) };

  // Même ressenti que les PV/PM : le pupitre et le token réagissent avant le
  // retour Firestore. Les clics rapides ne sont donc plus bloqués par le réseau.
  c.garde = val;
  _patchEntityTokenShapes('characterId', charId);
  if (VS.miniUid === uid && VS.miniCharId === charId) _renderMiniSheet(uid);
  _renderInspectorSoon();

  await updateDoc(_chrRef(charId), patch).catch(error => {
    // Une écriture plus récente peut déjà avoir avancé la valeur : ne jamais
    // l'écraser lors du rollback d'un ancien clic.
    if ((parseInt(c.garde, 10) || 0) === val) {
      c.garde = previous;
      _patchEntityTokenShapes('characterId', charId);
      if (VS.miniUid === uid && VS.miniCharId === charId) _renderMiniSheet(uid);
      _renderInspectorSoon();
    }
    console.error('[vtt] Garde personnage non modifiée depuis la mini-fiche', error);
    showNotif('Impossible de modifier la Garde de ce personnage', 'error');
  });
}
function _vttEditToken(id) { return _openStatsModal(VS.tokens[id]?.data??null); }

// ═══════════════════════════════════════════════════════════════════
// DÉLÉGATION DE CONTRÔLE — autoriser d'autres joueurs sur son token
// ═══════════════════════════════════════════════════════════════════
const _delegationSyncAttempts = new Set();

function _delegatesForCharacterToken(t) {
  const character = t?.characterId ? VS.characters[t.characterId] : null;
  return character ? getCharacterDelegates(character)
    : getCharacterDelegates(t);
}

// Migration idempotente des délégations historiques, autrefois stockées sur un
// seul token. La fiche devient la source canonique et tous ses tokens suivent.
async function _syncOwnedCharacterDelegations() {
  const uid = STATE.user?.uid;
  if (!uid || !Object.keys(VS.characters || {}).length || !Object.keys(VS.tokens || {}).length) return;
  for (const character of Object.values(VS.characters)) {
    if (!STATE.isAdmin && character.uid !== uid) continue;
    const linked = Object.values(VS.tokens).map(e => e?.data).filter(t => t?.characterId === character.id);
    if (!linked.length) continue;
    const merged = [...new Set([
      ...getCharacterDelegates(character),
      ...linked.flatMap(t => getCharacterDelegates(t)),
    ])].sort();
    const needsCharacter = JSON.stringify(getCharacterDelegates(character).sort()) !== JSON.stringify(merged);
    const tokensToFix = linked.filter(t => (STATE.isAdmin || t.ownerId === uid)
      && JSON.stringify(getCharacterDelegates(t).sort()) !== JSON.stringify(merged));
    if (!needsCharacter && !tokensToFix.length) continue;
    const signature = `${character.id}:${merged.join(',')}`;
    if (_delegationSyncAttempts.has(signature)) continue;
    _delegationSyncAttempts.add(signature);
    try {
      const batch = writeBatch(db);
      if (needsCharacter) batch.update(_chrRef(character.id), { controlDelegates: merged });
      tokensToFix.forEach(t => batch.update(_tokRef(t.id), { controlDelegates: merged }));
      await batch.commit();
      character.controlDelegates = merged;
      linked.forEach(t => { t.controlDelegates = merged; });
    } catch (error) {
      console.warn('[VTT] migration délégation personnage', character.id, error);
    }
  }
}

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
  const dels = new Set(_delegatesForCharacterToken(t));
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
      <div class="vtt-deleg-empty-hint">Invite d'autres joueurs depuis le menu d'aventure pour pouvoir leur déléguer ce personnage.</div>
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
        ${activeCount === 0 ? `· vous seul contrôlez ce ${t.characterId ? 'personnage' : 'token'}` : ''}</span>
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
  openModal(`🤝 Déléguer ${t.characterId ? 'le personnage' : 'le contrôle'} — ${_esc(tgtName)}`,
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
  const cur = _delegatesForCharacterToken(t);
  const wasOn = cur.includes(targetUid);
  const next = wasOn ? cur.filter(u => u !== targetUid) : [...cur, targetUid];
  let rollback = null;
  try {
    const linkedTokens = (t.characterId
      ? Object.values(VS.tokens).map(e => e?.data).filter(token => token?.characterId === t.characterId)
      : [t]).filter(token => STATE.isAdmin || token.ownerId === uid);
    const batch = writeBatch(db);
    rollback = {
      tokens: new Map(linkedTokens.map(token => [token, token.controlDelegates])),
      character: t.characterId ? VS.characters[t.characterId] : null,
      characterDelegates: t.characterId ? VS.characters[t.characterId]?.controlDelegates : undefined,
    };
    linkedTokens.forEach(token => batch.update(_tokRef(token.id), { controlDelegates: next }));
    if (t.characterId && VS.characters[t.characterId]) {
      batch.update(_chrRef(t.characterId), { controlDelegates: next });
    }
    // Mettre le cache à jour AVANT le commit empêche les snapshots locaux du
    // batch de croiser un ancien token avec la nouvelle fiche et de ressusciter
    // involontairement une délégation que le propriétaire vient de retirer.
    linkedTokens.forEach(token => { token.controlDelegates = next; });
    if (t.characterId && VS.characters[t.characterId]) VS.characters[t.characterId].controlDelegates = next;
    await batch.commit();
    const host = document.getElementById('vtt-deleg-modal');
    if (host) host.innerHTML = _vttRenderDelegateModalBody(tokenId, _vttDelegSearch || '');
    const name = _resolveUidName(targetUid);
    showNotif(wasOn ? `Contrôle retiré à ${name}` : `${name} peut maintenant contrôler ce personnage`,
      wasOn ? 'info' : 'success');
  } catch (err) {
    rollback?.tokens.forEach((delegates, token) => { token.controlDelegates = delegates; });
    if (rollback?.character) rollback.character.controlDelegates = rollback.characterDelegates;
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
    VS.mapLib.images = [...(VS.mapLib.images||[]), entry];
    _saveMapLib().catch(()=>{});
    showNotif('Carte ajoutée par URL !', 'success');
  } catch (e) { console.error('[vtt] ajout image fond', e); showNotif("Échec de l'ajout de l'image de fond", 'error'); }
}
function _vttUploadClick() { return document.getElementById('vtt-img-input')?.click(); }
function _vttLibImportMenu(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const anchor = event?.currentTarget || event?.target?.closest?.('.vtt-lib-import');
  const rect = anchor?.getBoundingClientRect?.();
  const items = [
    ...(CLOUDINARY_ENABLED ? [{ label:'⬆ Importer une image', action:'_vttUploadClick' }] : []),
    { label:'🔗 Ajouter par URL', action:'_vttAddImageUrl' },
    { label:'📥 Importer un dossier GitHub', action:'_vttLibImportGithub' },
    '---',
    { label:'📁 Nouveau dossier', action:'_vttLibNewFolder' },
    { label:'🧹 Nettoyer les doublons', action:'_vttLibCleanDuplicates' },
    ...(CLOUDINARY_ENABLED ? [{ label:'🔑 Configurer l’hébergement', action:'_vttSetImgbbKey' }] : []),
  ];
  _showCtxMenu(event?.clientX || rect?.left || 0, event?.clientY || rect?.bottom || 0, items);
}

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
    VS.mapLib.images = [...(VS.mapLib.images||[]), entry];
    _saveMapLib().catch(()=>{});
    showNotif('Image ajoutée !','success');
  } catch(e) { console.error(e); showNotif('Erreur upload : '+e.message,'error'); }
}

// ── Outil + clavier ─────────────────────────────────────────────────
function _setTool(tool) {
  VS.tool = tool;
  _vttToolPanel = ['ruler','draw','walls'].includes(tool) ? tool : null;
  document.querySelectorAll('.vtt-tool[data-tool]').forEach((b) => {
    const active = b.dataset.tool === tool;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
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
  _updateTokenDraggable();
  // Draggability des annotations
  _updateAnnotDraggable();
  _vttRefreshToolPanels();
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
    ['vtt-dice-panel',  'vtt-dice-trigger',  _closeDicePanel],
    ['vtt-music-panel', 'vtt-music-trigger', _closeMusicPanel],
    ['vtt-loot-panel',  'vtt-loot-trigger',  _closeLootPanel],
    ['vtt-rest-panel',  'vtt-rest-trigger',  _closeShortRest],
  ];
  for (const [id, triggerId, close] of panels) {
    if (document.getElementById(id)?.dataset.open === '1') {
      close();
      document.getElementById(triggerId)?.focus({ preventScroll: true });
      return true;
    }
  }
  if (document.getElementById('vtt-emote-picker')?.classList.contains('open')) {
    _closeEmotePicker();
    document.querySelector('.vtt-emote-trigger')?.focus({ preventScroll: true });
    return true;
  }
  if (document.getElementById('vtt-action-hud')?.classList.contains('show'))    { _hideActBar();      return true; }
  return false;
}

async function _vttConfirmDeleteMapImage() {
  const page = VS.activePage;
  const imageId = VS.selImg;
  if (!STATE.isAdmin || !page || !imageId || !VS.mapMode) return false;
  const image = (page.backgroundImages || []).find(entry => entry.id === imageId);
  if (!image) return false;
  if (!await confirmModal('Retirer cette image de la carte ?', {
    title: 'Image de carte',
    confirmLabel: 'Retirer',
    cancelLabel: 'Conserver',
  })) return false;

  try {
    const images = (page.backgroundImages || []).filter(entry => entry.id !== imageId);
    await updateDoc(_pgRef(page.id), { backgroundImages: images });
    VS.selImg = null;
    VS.imgTr?.nodes([]);
    VS.imgTrFg?.nodes([]);
    VS.layers.map?.batchDraw();
    VS.layers.mapFg?.batchDraw();
    showNotif('Image retirée de la carte.', 'success');
    return true;
  } catch (error) {
    console.error('[vtt] suppr image carte:', error);
    showNotif("Échec de la suppression de l'image de carte", 'error');
    return false;
  }
}

function _keyHandler(e) {
  if (!document.getElementById('vtt-canvas-wrap')) return;
  const typingTarget = _vttIsTypingTarget(e.target);

  // Échap : traité AVANT le filtre de saisie, pour fermer un panneau dont le
  // champ de recherche a le focus (émotes, dés, musique…).
  if (e.key === 'Escape') {
    // a) Modale ouverte → la modale gère sa propre fermeture (ne pas désélectionner derrière).
    if (document.getElementById('modal-overlay')?.classList.contains('show')) return;
    // Le panneau des raccourcis est purement informatif : il se ferme avant
    // toute annulation d'action sur la carte.
    if (_vttToolPanel === 'keys') {
      _vttOpenKeyboardHelp();
      e.preventDefault();
      return;
    }
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
  if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    _vttOpenKeyboardHelp();
    return;
  }
  // Touche X : recentre la caméra sur le personnage contrôlé prioritaire.
  if ((e.key==='x' || e.key==='X') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    _vttCenterOnMyToken();
    return;
  }
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
  // Raccourci R : bascule l'outil règle (sans modificateur, hors saisie).
  // En placement de zone, R sert à PIVOTER la zone (géré par le HUD de placement)
  // → on ne déclenche pas la règle pour éviter que les deux s'entrechoquent.
  if ((e.key==='r' || e.key==='R') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (_zoneCtx) return;
    e.preventDefault();
    _setTool(VS.tool === 'ruler' ? 'select' : 'ruler');
    return;
  }
  if ((e.key==='v' || e.key==='V') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    _setTool('select');
    return;
  }
  if ((e.key==='d' || e.key==='D') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    _setTool(VS.tool === 'draw' ? 'select' : 'draw');
    return;
  }
  if ((e.key==='m' || e.key==='M') && !e.ctrlKey && !e.metaKey && !e.altKey && STATE.isAdmin) {
    e.preventDefault();
    if (!_vttAdvancedPremium()) _vttPremiumInfo();
    else _setTool(VS.tool === 'walls' ? 'select' : 'walls');
    return;
  }
  // Touche C : ouvre/ferme la mini-fiche du personnage contrôlé.
  if ((e.key==='c' || e.key==='C') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    _vttMsKeyToggle();
  }
  if ((e.key==='Delete'||e.key==='Backspace') && VS.tool==='select') {
    // 1) Annotations sélectionnées
    if (_selectedAnnotIds.size > 0) {
      e.preventDefault();
      void _deleteAnnotsWithUndo([..._selectedAnnotIds]);
    }
    // 2) Image de carte sélectionnée (MJ, mode édition)
    else if (STATE.isAdmin && VS.selImg && VS.mapMode && VS.activePage) {
      e.preventDefault();
      void _vttConfirmDeleteMapImage();
    }
    // 3) Tokens sélectionnés → retrait du canvas (pageId=null)
    else {
      const ids = VS.selectedMulti.size > 0 ? [...VS.selectedMulti] : (VS.selected ? [VS.selected] : []);
      if (ids.length) {
        e.preventDefault();
        void _vttSendTokensToReserve(ids);
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
  // Flèches / pavé numérique : déplacer le ou les tokens sélectionnés.
  if (!e.ctrlKey && !e.metaKey && !e.altKey && (VS.selected || VS.selectedMulti.size)) {
    const dir = _MOVE_KEYS[e.key] ?? _NUMPAD_KEYS[e.code];
    if (dir) {
      e.preventDefault(); // empêche le scroll de la page
      _queueSelectedMove(dir.dc, dir.dr);
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
// Rail droit : sur écran à faible hauteur, l'inspecteur (Token/Jets) et le chat
// empilés deviennent inutilisables. On les transforme alors en un panneau à
// onglets — un seul visible, pleine hauteur — sans ajouter de fenêtre. Choix
// mémorisé. Sur grand écran, le CSS ignore cet état et garde les deux empilés.
let _rcolView = 'inspector';
try { const v = localStorage.getItem('vtt-rcol-view'); if (v === 'chat' || v === 'inspector') _rcolView = v; } catch {}
function _vttRcolView(view) {
  if (view !== 'chat' && view !== 'inspector') return;
  _rcolView = view;
  try { localStorage.setItem('vtt-rcol-view', view); } catch {}
  const col = document.getElementById('vtt-right-col');
  if (col) col.dataset.rcolView = view;
  document.querySelectorAll('.vtt-rcol-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.vttArgs === view));
  // Voir le chat = tout est lu → on retire la pastille « non lu ».
  if (view === 'chat') {
    document.querySelector('.vtt-rcol-tab[data-vtt-args="chat"]')?.classList.remove('has-unread');
  }
  // Voir Token/Jets = l'alerte combat est prise en compte → on la retire.
  if (view === 'inspector') {
    document.querySelector('.vtt-rcol-tab[data-vtt-args="inspector"]')?.classList.remove('has-alert');
  }
}

// ── Panneau glissant : fiche/chat (right-col) + réserve (tray MJ) ──────────
// Fermé par défaut → la carte occupe toute la largeur. Ouvert par les boutons
// onglets de bord. Réutilise _vttRcolView et l'onglet courant du tray.
let _slideOpen = false;
let _slideUnread = 0;
let _slidePeekTimer = null;
let _slideInitialChatPending = true;
// Épinglage : quand actif, le panneau reste ouvert et se range À CÔTÉ de la
// toile (la toile rétrécit au lieu d'être recouverte). Préférence persistée.
let _slidePinned = lsJson.get('vtt-slide-pinned', false);
function _vttSlide(arg) {
  const slide = document.getElementById('vtt-slide');
  if (!slide) return;
  const wantReserve = arg === 'reserve';
  if (wantReserve && !STATE.isAdmin) return;   // réserve = MJ uniquement
  const nextMode = wantReserve ? 'reserve' : 'sheet';   // sheet = Chat
  // Toggle : re-cliquer le panneau déjà affiché le ferme.
  const already = _slideOpen && slide.dataset.slide === nextMode;
  if (already) {
    if (!_slidePinned) _vttSlideClose();
    return;
  }
  slide.dataset.slide = nextMode;
  _slideOpen = true;
  slide.classList.add('open');
  slide.setAttribute('aria-hidden', 'false');
  if (!wantReserve) {
    _vttRcolView('chat');
    _slideUnread = 0;
    _vttRemoveChatPeek();
    if (_slideInitialChatPending) {
      _slideInitialChatPending = false;
      requestAnimationFrame(() => _vttChatShowNew(true));
    }
  }
  _vttRefreshSlideShell();
}
function _vttSlideClose() {
  const slide = document.getElementById('vtt-slide');
  if (!slide) return;
  _slideOpen = false;
  if (_slidePinned) {
    _slidePinned = false;
    lsJson.set('vtt-slide-pinned', false);
    _vttApplySlidePin();
  }
  slide.classList.remove('open');
  slide.setAttribute('aria-hidden', 'true');
  _vttRefreshSlideShell();
}
function _vttOnlinePlayerCount() {
  const now = Date.now();
  return Object.values(VS.presence || {}).filter(p => p && now - (p.lastSeen || 0) < 120_000).length;
}
function _vttReserveCount() {
  const seen = new Set();
  return Object.values(VS.tokens || {}).reduce((count, entry) => {
    const token = entry?.data;
    if (!token || token.type === 'enemy' || isTemporarySummonToken(token) || token.pageId === VS.activePage?.id) return count;
    const key = _tokenEntityKey(token) || token.id;
    if (seen.has(key)) return count;
    seen.add(key);
    return count + 1;
  }, 0);
}
function _vttRefreshSlideShell({ ping = false } = {}) {
  const root = document.getElementById('vtt-root');
  const slide = document.getElementById('vtt-slide');
  if (!root || !slide) return;
  root.dataset.slideOpen = _slideOpen ? '1' : '';
  const reserve = slide.dataset.slide === 'reserve';
  const onlineCount = _vttOnlinePlayerCount();
  const title = document.getElementById('vtt-slide-title');
  if (title) title.innerHTML = reserve
    ? `Réserve<small>${_esc(VS.activePage?.name || 'Aucune scène')}</small>`
    : `Chat &amp; jets<small>${onlineCount} joueur${onlineCount > 1 ? 's' : ''} en ligne</small>`;
  document.querySelectorAll('.vtt-slide-edge-btn').forEach(btn => {
    const active = _slideOpen && btn.dataset.edgeMode === (reserve ? 'reserve' : 'chat');
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const unread = document.getElementById('vtt-edge-chat-count');
  if (unread) { unread.textContent = String(_slideUnread); unread.hidden = !_slideUnread; }
  const reserveBadge = document.getElementById('vtt-edge-reserve-count');
  if (reserveBadge) reserveBadge.textContent = String(_vttReserveCount());
  const chatBtn = document.querySelector('.vtt-slide-edge-btn[data-edge-mode="chat"]');
  if (chatBtn && ping) {
    chatBtn.classList.remove('ping');
    void chatBtn.offsetWidth;
    chatBtn.classList.add('ping');
  }
}
function _vttRemoveChatPeek() {
  clearTimeout(_slidePeekTimer);
  _slidePeekTimer = null;
  document.getElementById('vtt-chat-peek')?.remove();
}
export function _vttNotifyChatMessage(message, renderedNode) {
  if (!message || (message.gmOnly && !STATE.isAdmin)) return;
  const slide = document.getElementById('vtt-slide');
  const visible = _slideOpen && slide?.dataset.slide === 'sheet';
  if (visible) { _slideUnread = 0; _vttRefreshSlideShell(); return; }
  _slideUnread += 1;
  _vttRefreshSlideShell({ ping:true });
  if (matchMedia('(max-width: 699px)').matches) return;
  _vttRemoveChatPeek();
  const edge = document.querySelector('.vtt-slide-edge-btn[data-edge-mode="chat"]');
  if (!edge) return;
  const peek = document.createElement('button');
  peek.type = 'button';
  peek.id = 'vtt-chat-peek';
  peek.className = 'vtt-chat-peek';
  peek.setAttribute('aria-label', 'Ouvrir le nouveau message dans le chat');
  const clone = renderedNode?.cloneNode?.(true);
  if (clone) {
    clone.querySelectorAll('button,.vtt-log-detail,.vtt-log-private-note').forEach(node => node.remove());
    clone.classList.remove('vtt-log-enter');
    peek.appendChild(clone);
  } else {
    peek.textContent = message.type === 'chat' ? `${message.authorName || 'Message'} : ${message.text || ''}` : (message.optLabel || message.type || 'Nouvelle action');
  }
  const rect = edge.getBoundingClientRect();
  peek.style.top = `${Math.max(12, rect.top - 8)}px`;
  peek.dataset.vttFn = '_vttSlide';
  peek.dataset.vttArgs = 'chat';
  document.getElementById('vtt-root')?.appendChild(peek);
  _slidePeekTimer = setTimeout(() => {
    peek.classList.add('out');
    setTimeout(() => peek.remove(), 280);
  }, 5000);
}
// Reflète l'état épinglé sur la coquille (.vtt-root) + le bouton épingle. La
// toile rétrécit via le flux flex (la ResizeObserver de Konva suit tout seul).
function _vttApplySlidePin() {
  const root = document.getElementById('vtt-root');
  if (root) root.dataset.slidePinned = _slidePinned ? '1' : '';
  const btn = document.getElementById('vtt-slide-pin');
  if (btn) {
    btn.classList.toggle('is-on', _slidePinned);
    btn.setAttribute('aria-pressed', _slidePinned ? 'true' : 'false');
    btn.title = _slidePinned ? 'Détacher le panneau (retour en superposition)' : 'Épingler le panneau à droite de la table';
  }
  _vttRefreshSlideShell();
}
function _vttSlidePin() {
  _slidePinned = !_slidePinned;
  lsJson.set('vtt-slide-pinned', _slidePinned);
  // Épingler alors que rien n'est ouvert → ouvre le Chat par défaut.
  if (_slidePinned && !_slideOpen) _vttSlide('chat');
  _vttApplySlidePin();
}
// Échap ferme le panneau (sauf saisie en cours ou visée active — elles priment).
// Épinglé : le panneau est volontairement permanent → Échap ne le ferme pas.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !_slideOpen || _slidePinned) return;
  if (_aimOpt) return;
  try { if (_vttIsTypingTarget(e.target)) return; } catch {}
  _vttSlideClose();
});

// Petit écran (rail en onglets) : sélectionner un token amène son panneau
// Token/Jets devant, comme on s'y attend. Ne fait rien sur grand écran (barre
// masquée) et n'interrompt jamais une saisie de chat en cours.
function _vttFocusInspectorIfTabbed() {
  const col = document.getElementById('vtt-right-col');
  if (!col || col.dataset.rcolView === 'inspector') return;
  const tabs = col.querySelector('.vtt-rcol-tabs');
  if (!tabs || getComputedStyle(tabs).display === 'none') return;
  if (document.activeElement?.id === 'vtt-chat-input') return;
  _vttRcolView('inspector');
}

function _buildHtml() {
  const mj=STATE.isAdmin;
  return `
<div class="vtt-root" id="vtt-root" data-combat="off"${vttLowFx() ? ' data-vtt-lowfx="1"' : ''}>
  ${mj && CLOUDINARY_ENABLED ? '<input type="file" id="vtt-img-input" accept="image/*" hidden>' : ''}

  <!-- ── BANDEAU : état ambiant (scènes · session · minuteur · météo · présence · thème) ── -->
  <header class="vtt-band" id="vtt-band">
    <div class="vtt-band-brand"><b>Table</b></div>
    <span class="vtt-band-sep"></span>
    <nav id="vtt-page-tabs" class="vtt-scenes vtt-page-tabs" aria-label="Scènes"></nav>
    <span class="vtt-band-grow"></span>
    ${mj ? `<button class="vtt-canvas-control vtt-session-btn" id="vtt-session-btn" data-vtt-fn="_vttToggleSessionLive" title="Démarrer la session et prévenir les joueurs qui rejoignent">
      <span class="vtt-canvas-ctl-icon" aria-hidden="true">▶</span><span class="vtt-canvas-ctl-copy"><strong>Session</strong><small>Démarrer</small></span>
    </button>` : ''}
    <div id="vtt-timer" class="vtt-timer" aria-live="polite"></div>
    <div id="vtt-weather" class="vtt-weather"></div>
    <span class="vtt-band-sep"></span>
    <div id="vtt-pres-list" class="vtt-pres" aria-label="Joueurs en ligne"></div>
  </header>

  <!-- ── RUBAN D'INITIATIVE (collapsé hors combat) ── -->
  <div class="vtt-ribbon" id="vtt-ribbon" aria-hidden="true"></div>

  <div class="vtt-body">
    <div class="vtt-mini-panel" id="vtt-mini-panel"></div>
    <div class="vtt-canvas-wrap" id="vtt-canvas-wrap"></div>

    <!-- ── FICHE : dock flottant compact en bas à gauche (identité + onglets déployables + Jets) ── -->
    <div class="vtt-fiche-dock" id="vtt-fiche-dock">
      <div class="vtt-inspector" id="vtt-inspector">
        <div class="vtt-ins-empty"><div style="font-size:1.2rem">🎲</div>Sélectionne ton token</div>
      </div>
    </div>

    <!-- ── OUTILS DE SESSION : barre dédiée bas-centre (Repos · Musique · Butin · Émotes) ── -->
    <div class="vtt-session-tools" id="vtt-session-tools" role="toolbar" aria-label="Outils de session"></div>

    <!-- ── Onglets de bord : toujours accessibles, sans recouvrir la carte ── -->
    <nav class="vtt-slide-edge" id="vtt-slide-edge" aria-label="Panneaux de la table">
      <button class="vtt-slide-edge-btn" data-edge-mode="chat" data-vtt-fn="_vttSlide" data-vtt-args="chat" aria-pressed="false" title="Chat &amp; jets">
        <svg class="vtt-edge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg><small>Chat</small><b id="vtt-edge-chat-count" class="vtt-edge-badge" hidden>0</b>
      </button>
      ${mj ? `<button class="vtt-slide-edge-btn" data-edge-mode="reserve" data-vtt-fn="_vttSlide" data-vtt-args="reserve" aria-pressed="false" title="Réserve">
        <svg class="vtt-edge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.2a3 3 0 0 1 0 5.6M18 14.8c1.8.7 3 2.5 3 5.2"/></svg><small>Réserve</small><b id="vtt-edge-reserve-count" class="vtt-edge-badge is-soft">0</b>
      </button>` : ''}
    </nav>

    <!-- ── PANNEAU GLISSANT : fiche/chat + réserve MJ ── -->
    <aside class="vtt-slide" id="vtt-slide" data-slide="sheet" aria-hidden="true">
      <div class="vtt-slide-hd">
        <h2 id="vtt-slide-title">Chat &amp; jets<small>0 joueur en ligne</small></h2>
        <button class="vtt-slide-pin" id="vtt-slide-pin" data-vtt-fn="_vttSlidePin" title="Épingler le panneau à droite de la table" aria-label="Épingler le panneau" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6M10 4v5l-2 4h8l-2-4V4M12 17v3"/></svg></button>
        <button class="vtt-slide-x" data-vtt-fn="_vttSlideClose" title="Fermer (Échap)" aria-label="Fermer le panneau"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </div>
      <div class="vtt-slide-body">
    ${mj?`
    <div class="vtt-tray" id="vtt-tray">
      <div class="vtt-tray-tabs" role="tablist" aria-label="Panneau du maître de jeu">
        <button id="vtt-tray-tab-reserve" class="vtt-tray-tab${_trayTab==='reserve'?' active':''}" data-tab="reserve" data-vtt-fn="_vttTrayTab" data-vtt-args="reserve" title="Personnages en scène et en réserve" role="tab" aria-selected="${_trayTab === 'reserve'}" aria-controls="vtt-tray-view-reserve"><svg class="vtt-tt-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.2a3 3 0 0 1 0 5.6M18 14.8c1.8.7 3 2.5 3 5.2"/></svg>Personnages</button>
        <button id="vtt-tray-tab-scenes" class="vtt-tray-tab${_trayTab==='scenes'?' active':''}" data-tab="scenes" data-vtt-fn="_vttTrayTab" data-vtt-args="scenes" title="Scènes &amp; pages" role="tab" aria-selected="${_trayTab === 'scenes'}" aria-controls="vtt-tray-view-scenes"><svg class="vtt-tt-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14"/></svg>Scènes</button>
        <button id="vtt-tray-tab-bestiary" class="vtt-tray-tab${_trayTab==='bestiary'?' active':''}" data-tab="bestiary" data-vtt-fn="_vttTrayTab" data-vtt-args="bestiary" title="Bestiaire" role="tab" aria-selected="${_trayTab === 'bestiary'}" aria-controls="vtt-tray-view-bestiary"><svg class="vtt-tt-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="10" r="1.8"/><circle cx="11" cy="6.5" r="1.8"/><circle cx="15.5" cy="7.5" r="1.8"/><circle cx="18" cy="12" r="1.8"/><path d="M8 17c0-2.5 2-4.5 4.5-4.5S17 14 16 17c-.6 2-3 2.5-4 2-1 .5-3.6.3-4-2z"/></svg>Bestiaire</button>
        <button id="vtt-tray-tab-images" class="vtt-tray-tab${_trayTab==='images'?' active':''}" data-tab="images" data-vtt-fn="_vttTrayTab" data-vtt-args="images" title="Bibliothèque d'images" role="tab" aria-selected="${_trayTab === 'images'}" aria-controls="vtt-tray-view-images"><svg class="vtt-tt-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>Images</button>
      </div>
      <div class="vtt-tray-views">
        <div id="vtt-tray-view-scenes" class="vtt-tray-view${_trayTab==='scenes'?' active':''}" data-view="scenes" role="tabpanel" aria-labelledby="vtt-tray-tab-scenes" ${_trayTab === 'scenes' ? '' : 'hidden'}>
          <div id="vtt-tray-pages">${loadingHtml('Chargement…', { compact: true })}</div>
        </div>
        <div id="vtt-tray-view-reserve" class="vtt-tray-view${_trayTab==='reserve'?' active':''}" data-view="reserve" role="tabpanel" aria-labelledby="vtt-tray-tab-reserve" ${_trayTab === 'reserve' ? '' : 'hidden'}>
          <section class="vtt-reserve-stage"><div class="vtt-res-section-hd"><h3>En scène</h3><span id="vtt-scene-token-count"></span><i></i><small id="vtt-scene-token-page"></small></div><div id="vtt-scene-tokens"></div></section>
          <div id="vtt-reserve-body"></div>
        </div>
        <div id="vtt-tray-view-bestiary" class="vtt-tray-view${_trayTab==='bestiary'?' active':''}" data-view="bestiary" role="tabpanel" aria-labelledby="vtt-tray-tab-bestiary" ${_trayTab === 'bestiary' ? '' : 'hidden'}>
          <div id="vtt-bestiary-body"></div>
        </div>
        <div id="vtt-tray-view-images" class="vtt-tray-view${_trayTab==='images'?' active':''}" data-view="images" role="tabpanel" aria-labelledby="vtt-tray-tab-images" ${_trayTab === 'images' ? '' : 'hidden'}>
          <div id="vtt-tray-library"></div>
        </div>
      </div>
    </div>`:''}
    <div class="vtt-right-col vtt-right-col--chatonly" id="vtt-right-col">
      <div class="vtt-chat">
        <div class="vtt-chat-filters" id="vtt-chat-filters"></div>
        <div class="vtt-chat-log" id="vtt-chat-log"></div>
        <button type="button" class="vtt-chat-new" id="vtt-chat-new" data-vtt-fn="_vttChatShowNew" aria-label="Revenir aux messages récents" hidden>↓ <span>Messages récents</span></button>
        <div class="vtt-chat-reply-bar" id="vtt-chat-reply-bar" style="display:none"></div>
        <div class="vtt-chat-input-row">
          <input type="text" id="vtt-chat-input" class="vtt-chat-input" placeholder="Message…"
            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
            data-vtt-fn="_vttSendChat" data-vtt-on="keydown-enter">
          <button class="vtt-chat-send" data-vtt-fn="_vttSendChat" title="Envoyer" aria-label="Envoyer">➤</button>
        </div>
      </div>
    </div>
      </div>
    </aside>
  </div>
</div>`;
}

// ═══════════════════════════════════════════════════════════════════
// POINT D'ENTRÉE
// ═══════════════════════════════════════════════════════════════════
export async function renderVttPage() {
  _cleanup();
  const content=document.getElementById('main-content');
  if (!content) return;
  _vttPageActive = true;
  content.style.overflow='hidden';
  content.style.height='100vh';
  content.style.paddingBottom='0';
  // Plus de sas d'entrée : joueurs comme MJ arrivent DIRECTEMENT dans la table.
  // La navigation vers le VTT est déjà un clic délibéré ; l'écran intermédiaire
  // « Entrer dans la table » ajoutait une interaction inutile (les listeners sont
  // libérés à la sortie de page via _cleanup).
  return _vttMountTable(content);
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
    summonOwnerCharId: t?.summonOwnerCharId || null,
    summonInvId: t?.summonInvId || null,
  };
}
export function _vttLogSingleTargetFields(targetIds = []) {
  if (!Array.isArray(targetIds) || targetIds.length !== 1) return {};
  return _vttLogTargetFields(VS.tokens[targetIds[0]]?.data);
}
// Échappatoire du bandeau « tourne ton téléphone » : une fois rejeté, on ne le
// ré-affiche plus de la session (persiste aux re-rendus et à la navigation SPA).
let _vttRotateDismissed = (() => { try { return sessionStorage.getItem('vtt-rotate-dismissed') === '1'; } catch { return false; } })();

function _vttRailButton(id, label, shortcut, description, { tool = '', panel = '', active = false, extra = '' } = {}) {
  return `<button class="vtt-tool${active ? ' active' : ''}${extra ? ` ${extra}` : ''}"
      ${tool ? `data-tool="${tool}" data-vtt-fn="_vttTool" data-vtt-args="${tool}" aria-pressed="${active}"` : ''}
      ${panel ? `data-tool-panel="${panel}"` : ''}
      ${!tool && id === 'center' ? 'data-vtt-fn="_vttCenterOnMyToken"' : ''}
      ${!tool && id === 'perf' ? `data-vtt-fn="_vttToggleLowFx" aria-pressed="${vttLowFx()}"` : ''}
      ${!tool && id === 'keys' ? 'data-vtt-fn="_vttOpenKeyboardHelp"' : ''}
      aria-label="${label}">
    ${_vttToolIcon(id)}${shortcut ? `<span class="vtt-tool-key">${shortcut}</span>` : ''}
    <span class="vtt-tool-tooltip" role="tooltip"><span><strong>${label}</strong>${shortcut ? `<kbd>${shortcut}</kbd>` : ''}</span><small>${description}</small></span>
  </button>`;
}

function _vttPanelHeader(panel, title, shortcut, collapsible = true) {
  return `<header class="vtt-tool-panel-head"><h3>${title}</h3>${shortcut ? `<kbd>${shortcut}</kbd>` : ''}<span class="vtt-tool-panel-spacer"></span>
    ${collapsible ? `<button class="vtt-tool-panel-icon" data-vtt-fn="_vttToolPanelToggle" data-vtt-args="${panel}" data-vtt-panel-collapse="${panel}" aria-label="Replier">${_vttToolIcon('min')}</button>` : ''}
    <button class="vtt-tool-panel-icon" data-vtt-fn="_vttToolPanelClose" data-vtt-args="${panel}" aria-label="Fermer">${_vttToolIcon('x')}</button>
  </header>`;
}

function _vttToolbarMarkup() {
  const colors = ['#ef4444','#ff8c42','#f59e0b','#ffe600','#22c38e','#14b8a6','#4f8cff','#8b5cf6','#b47fff','#ec4899','#ffffff','#9ca3af','#1a1a2e'];
  const shape = (id, label) => `<button class="vtt-draw-btn${_drawShape === id ? ' active' : ''}" id="vtt-ds-${id}" data-vtt-fn="_vttDrawShape" data-vtt-args="${id}" aria-label="${label}" title="${label}">${_vttToolIcon(id)}</button>`;
  const fogChip = (id, label) => `<button class="vtt-tool-chip${_vttFogActiveTool === id ? ' active' : ''}" data-fog-tool="${id}" data-vtt-fn="_vttFogTool" data-vtt-args="${id}">${_vttToolIcon(id)}<span>${label}</span></button>`;
  const shortcutRow = (label, keys) => `<li><span>${label}</span><span>${keys.map(key => `<kbd>${key}</kbd>`).join('<i>+</i>')}</span></li>`;
  const legendRow = (kind, label, detail) => `<li class="vtt-map-legend-row"><span class="vtt-map-legend-icon">${vttStructureLegendSvg(kind)}</span><span><b>${label}</b><small>${detail}</small></span></li>`;
  return `<div class="vtt-tool-shell">
    <div class="vtt-tool-float-tools" role="toolbar" aria-label="Outils de la table virtuelle">
      <div class="vtt-tool-group">
        ${_vttRailButton('select','Sélection','V','Déplacer les tokens et naviguer sur la carte.',{tool:'select',active:true})}
        ${_vttRailButton('ruler','Règle','R','Mesurer une distance en cases et en mètres.',{tool:'ruler',panel:'ruler'})}
        ${_vttRailButton('draw','Dessin','D','Annoter la carte avec des formes et des couleurs.',{tool:'draw',panel:'draw'})}
        ${STATE.isAdmin ? (_vttAdvancedPremium()
          ? _vttRailButton('walls','Structure','M','Murs, portes, vitres, lumière et brouillard.',{tool:'walls',panel:'walls'})
          : `<button class="vtt-tool vtt-tool-premium" data-vtt-fn="_vttPremiumInfo" aria-label="Structure Premium">${_vttToolIcon('walls')}<span class="vtt-tool-key">M</span><span class="vtt-tool-tooltip"><span><strong>Structure</strong><kbd>M</kbd></span><small>Disponible avec le VTT avancé Premium.</small></span></button>`) : ''}
      </div>
      <div class="vtt-tool-group">${_vttRailButton('center','Recentrer','X','Ramène la vue sur ton personnage.')}</div>
      <div class="vtt-tool-group">
        ${_vttRailButton('perf','Mode performance','','Coupe les effets coûteux pour fluidifier la table.',{active:vttLowFx(),extra:'vtt-tool-performance'})}
        ${_vttRailButton('keys','Raccourcis','?','Affiche toutes les commandes clavier.',{panel:'keys'})}
      </div>
    </div>

    <section id="vtt-ruler-bar" class="vtt-tool-panel vtt-tool-panel--ruler" data-panel="ruler" hidden>
      ${_vttPanelHeader('ruler','Règle','R')}
      <div class="vtt-tool-panel-body"><div id="vtt-ruler-value" class="vtt-ruler-value"><b>—</b><span>Aucune mesure</span></div></div>
      <footer class="vtt-tool-panel-foot"><b>Clic</b> pose un point · <b>clic droit</b> annule<br>1 case = ${CELL_M.toLocaleString('fr-FR')} m</footer>
    </section>

    <section id="vtt-draw-bar" class="vtt-tool-panel vtt-draw-bar" data-panel="draw" hidden>
      ${_vttPanelHeader('draw','Dessin','D')}
      <div class="vtt-tool-panel-body">
        <div class="vtt-tool-section"><span class="vtt-tool-section-label">Forme</span><div class="vtt-tool-segment vtt-draw-shapes">${shape('pencil','Crayon libre')}${shape('line','Ligne')}${shape('rect','Rectangle')}${shape('circle','Cercle')}${shape('poly','Polygone')}${shape('eraser','Gomme')}</div></div>
        <div class="vtt-tool-section"><span class="vtt-tool-section-label">Couleur</span><div class="vtt-draw-colors">${colors.map(color => `<button class="vtt-draw-color${color === _drawColor ? ' active' : ''}" data-color="${color}" data-vtt-fn="_vttDrawColor" data-vtt-args="${color}" style="--draw-color:${color}" aria-label="Couleur ${color}"></button>`).join('')}</div></div>
        <div class="vtt-tool-section"><span class="vtt-tool-section-label">Trait</span><div class="vtt-tool-segment vtt-draw-widths">${[2,4,6,10,16].map(width => `<button class="vtt-draw-wbtn${width === _drawWidth ? ' active' : ''}" data-w="${width}" data-vtt-fn="_vttDrawWidth" data-vtt-args="${width}" aria-label="Trait ${width} pixels"><span style="width:${Math.min(width + 2, 16)}px;height:${Math.min(width + 2, 16)}px"></span></button>`).join('')}</div></div>
        <div class="vtt-tool-actions"><button class="vtt-tool-chip" id="vtt-draw-fill-btn" data-vtt-fn="_vttToggleDrawFill" aria-pressed="false">${_vttToolIcon('fill')}<span>Remplir</span></button><span></span><button class="vtt-tool-panel-icon" id="vtt-draw-undo-btn" data-vtt-fn="_vttUndoDraw" title="Annuler (Ctrl+Z)">${_vttToolIcon('undo')}</button><button class="vtt-tool-panel-icon" id="vtt-draw-redo-btn" data-vtt-fn="_vttRedoDraw" title="Rétablir (Ctrl+Y)">${_vttToolIcon('redo')}</button>${STATE.isAdmin ? `<button class="vtt-tool-panel-icon danger" data-vtt-fn="_vttClearAnnots" title="Effacer les annotations">${_vttToolIcon('trash')}</button>` : ''}</div>
      </div>
      <footer class="vtt-tool-panel-foot" data-vtt-tool-hint></footer>
    </section>

    ${STATE.isAdmin ? `<section id="vtt-walls-bar" class="vtt-tool-panel vtt-walls-bar" data-panel="walls" hidden>
      ${_vttPanelHeader('walls','Structure','M')}
      <div class="vtt-tool-panel-body">
        <div class="vtt-tool-section"><span class="vtt-tool-section-label">Tracer</span><div class="vtt-structure-kinds">
          <button class="vtt-structure-kind active" data-fog-tool="wall" data-vtt-fn="_vttFogTool" data-vtt-args="wall"><i class="wall"></i><span><b>Mur</b><small>Bloque vue et passage</small></span></button>
          <button class="vtt-structure-kind" data-fog-tool="door" data-vtt-fn="_vttFogTool" data-vtt-args="door"><i class="door"></i><span><b>Porte</b><small>Fermée puis ouvrable</small></span></button>
          <button class="vtt-structure-kind" data-fog-tool="window" data-vtt-fn="_vttFogTool" data-vtt-args="window"><i class="window"></i><span><b>Vitre</b><small>Vision libre, passage bloqué</small></span></button>
        </div></div>
        <div class="vtt-tool-section"><span class="vtt-tool-section-label">Lumière</span><div class="vtt-fog-toggle-row"><span><b>Éclairage dynamique</b><small data-fog-status>Coupé — carte entièrement visible</small></span><button id="vtt-fog-toggle" class="vtt-switch" data-vtt-fn="_vttToggleFog" role="switch" aria-checked="false"><i></i></button></div><div class="vtt-fog-toggle-row vtt-fog-toggle-row--sub"><span><b>Vision illimitée</b><small data-vision-status>3 cases autour du groupe</small></span><button id="vtt-vision-unlimited-toggle" class="vtt-switch" data-vtt-fn="_vttToggleVisionUnlimited" role="switch" aria-checked="false"><i></i></button></div><div class="vtt-tool-chip-row">${fogChip('light','Source')}</div></div>
        <div class="vtt-tool-section"><span class="vtt-tool-section-label">Verrous côté joueurs</span><div class="vtt-tool-segment vtt-lock-visibility"><button data-lock-visibility="always" data-vtt-fn="_vttSetLockVisibility" data-vtt-args="always">Toujours visibles</button><button data-lock-visibility="discover" data-vtt-fn="_vttSetLockVisibility" data-vtt-args="discover">À découvrir</button></div></div>
        <div class="vtt-tool-section"><span class="vtt-tool-section-label">Brouillard</span><div class="vtt-tool-chip-row">${fogChip('hide','Cacher')}${fogChip('reveal','Révéler')}<button id="vtt-fog-clear-btn" class="vtt-tool-chip danger" data-vtt-fn="_vttFogClearOps">Vider</button></div></div>
        <div class="vtt-tool-actions vtt-structure-actions">${fogChip('eraser','Gomme')}<span></span><button id="vtt-fog-undo-btn" class="vtt-tool-panel-icon" data-vtt-fn="_vttFogUndo" title="Annuler">${_vttToolIcon('undo')}</button><button id="vtt-fog-redo-btn" class="vtt-tool-panel-icon" data-vtt-fn="_vttFogRedo" title="Rétablir">${_vttToolIcon('redo')}</button><button id="vtt-structure-help-btn" class="vtt-tool-panel-icon" data-vtt-fn="_vttStructureHelpToggle" title="Aide">${_vttToolIcon('help')}</button></div>
        <div id="vtt-structure-help" class="vtt-structure-help"><p><kbd>Shift</kbd> tracé libre · <kbd>Alt</kbd> précision ×2</p><p>Hors édition, clique une porte ou une vitre pour l’ouvrir.</p><p><i class="ok"></i> raccordé <i class="bad"></i> isolé <i class="snap"></i> aimantation</p></div>
      </div>
      <footer class="vtt-tool-panel-foot" data-vtt-tool-hint></footer>
    </section>` : ''}

    <section id="vtt-keys-bar" class="vtt-tool-panel vtt-tool-panel--keys" data-panel="keys" hidden>
      ${_vttPanelHeader('keys','Raccourcis','?',false)}
      <div class="vtt-tool-panel-body vtt-shortcut-groups">
        <div><span class="vtt-tool-section-label">Outils</span><ul>${shortcutRow('Sélection',['V'])}${shortcutRow('Règle',['R'])}${shortcutRow('Dessin',['D'])}${STATE.isAdmin ? shortcutRow('Structure',['M']) : ''}${shortcutRow('Recentrer sur mon personnage',['X'])}${shortcutRow('Revenir à la sélection',['Échap'])}</ul></div>
        <div><span class="vtt-tool-section-label">Édition</span><ul>${shortcutRow('Annuler',['Ctrl','Z'])}${shortcutRow('Rétablir',['Ctrl','Y'])}${shortcutRow('Copier / coller',['Ctrl','C / V'])}${shortcutRow('Retirer',['Suppr'])}${shortcutRow('Fermer le polygone',['Entrée'])}</ul></div>
        <div><span class="vtt-tool-section-label">Table</span><ul>${shortcutRow('Mini-fiche',['C'])}${shortcutRow('Roue d’émotes',['E'])}${shortcutRow('Émote rapide',['1 — 8'])}</ul></div>
        <div class="vtt-map-legend"><span class="vtt-tool-section-label">Lire la carte</span><ul>${legendRow('wall','Mur','Vue et passage bloqués')}${legendRow('door-closed','Porte fermée','Vue et passage bloqués')}${legendRow('door-open','Porte ouverte','Passage libre')}${legendRow('window-closed','Vitre fermée','Vue libre, passage bloqué')}${legendRow('window-open','Vitre ouverte','Vue et passage libres')}${legendRow('locked','Verrou','Interaction réservée au MJ')}</ul></div>
      </div>
    </section>
  </div>`;
}

async function _vttMountTable(content) {
  content.innerHTML = appSplashHtml('Chargement de la table…');
  const _konvaP = _loadKonva();
  const _emotesP = _loadEmotes();
  const _skillsP = _loadDiceSkills();
  const _formatsP = Promise.all([loadWeaponFormats(), loadDamageTypes(), getDocData('world', 'combat_styles').catch(() => null)]);
  try { await _konvaP; }
  catch { content.innerHTML='<div style="padding:2rem;color:var(--text-dim)">Impossible de charger Konva.js.</div>'; content.style.overflow=''; return; }
  const [weaponFormats, damageTypes, combatStylesDoc] = await _formatsP;
  VS.weaponFormats = weaponFormats;
  VS.damageTypes = damageTypes;
  VS.combatStyles = normalizeCombatStyles(combatStylesDoc?.styles || defaultCombatStyles());
  content.innerHTML=_buildHtml();
  content.insertAdjacentHTML('beforeend', `<div class="vtt-rotate-prompt${_vttRotateDismissed ? ' dismissed' : ''}" aria-hidden="true"><div class="vtt-rotate-phone">📱</div><div class="vtt-rotate-title">Tourne ton téléphone</div><div class="vtt-rotate-text">La Table Virtuelle est plus confortable en mode paysage.</div><button class="vtt-rotate-dismiss" data-vtt-fn="_vttDismissRotate">Utiliser quand même</button></div>`);
  const wrap=document.getElementById('vtt-canvas-wrap');
  if (!wrap) return;
  _initCanvas(wrap);
  _timerStartTick();
  _vttToolPanel = null;
  const _tf = document.createElement('div');
  _tf.className = 'vtt-tool-float';
  _tf.innerHTML = `${STATE.isAdmin ? `<div class="vtt-canvas-quickbar" role="toolbar" aria-label="Commandes de la session"><button class="vtt-canvas-control vtt-map-lock" id="vtt-map-mode-btn" data-vtt-fn="_vttToggleMapMode" title="Images verrouillées — cliquer pour modifier leur placement" aria-label="Déverrouiller les images" aria-pressed="false" data-locked="true"><span class="vtt-canvas-ctl-icon" aria-hidden="true">🔒</span><span class="vtt-canvas-ctl-copy"><strong>Images</strong><small>Verrouillées</small></span></button></div>` : ''}${_vttToolbarMarkup()}`;
  wrap.appendChild(_tf);
  _vttRefreshToolPanels();
  const repositionToolPanel = () => _vttPositionToolPanel();
  window.addEventListener('resize', repositionToolPanel);
  VS.unsubs.push(() => window.removeEventListener('resize', repositionToolPanel));
  if (STATE.isAdmin) {
    _renderSessionBtn();
    _setMapMode(false);
  }

  // ─── Ruban d'initiative : rendu dans #vtt-ribbon de la coquille.
  // (Le minuteur/météo vivent désormais dans le bandeau ; plus d'overlay TL.)
  _renderTimer();
  _renderWeatherBtn();
  _applyWeather();
  _renderCombatTracker();
  const sessionTools = document.getElementById('vtt-session-tools') || wrap;

  // Outils de session regroupés dans le bandeau : ils restent accessibles sans
  // recouvrir la carte, le pupitre des tokens ou la bulle de chat globale.
  const _rf = document.createElement('div');
  _rf.className = 'vtt-rest-float';
  _rf.innerHTML = `
    <div class="vtt-rest-panel" id="vtt-rest-panel" data-open="0" style="display:none" role="dialog" aria-label="Court repos du groupe" aria-hidden="true">
      <div class="vtt-rest-header"><h2>Court repos<small>Rend ½ PV et ½ PM max (arrondi sup.) aux personnages présents</small></h2><button class="vtt-rest-close" data-vtt-fn="_vttToggleShortRest" aria-label="Fermer le panneau de repos">${vttSessionDockIcon('x')}</button></div>
      <div class="vtt-rest-body" id="vtt-rest-body"></div>
    </div>
    <i class="vtt-session-pop-arrow" data-for="rest" hidden aria-hidden="true"></i>
    ${vttSessionDockButton({ key: 'rest', id: 'vtt-rest-trigger', action: '_vttToggleShortRest', label: 'Repos', tipTitle: 'Court repos', tipDetail: 'Plus aucun disponible', iconExtra: '<b class="vtt-session-dock-badge out">0</b>' })}`;
  sessionTools.appendChild(_rf);

  const _mf = document.createElement('div');
  _mf.className = 'vtt-music-float';
  _mf.innerHTML = `
    <div class="vtt-music-panel" id="vtt-music-panel" data-open="0" style="display:none" role="dialog" aria-label="Sons et musique" aria-hidden="true"></div>
    <i class="vtt-session-pop-arrow" data-for="music" hidden aria-hidden="true"></i>
    ${vttSessionDockButton({ key: 'music', id: 'vtt-music-trigger', action: '_vttToggleMusic', label: 'Musique', tipTitle: 'Sons & musique', tipDetail: 'Rien en lecture' })}`;
  sessionTools.appendChild(_mf);

  const _lf = document.createElement('div');
  _lf.className = 'vtt-loot-float';
  _lf.innerHTML = `
    <div class="vtt-loot-panel" id="vtt-loot-panel" data-open="0" style="display:none" role="dialog" aria-label="Butin d'aventure" aria-hidden="true"></div>
    <i class="vtt-session-pop-arrow" data-for="loot" hidden aria-hidden="true"></i>
    ${vttSessionDockButton({ key: 'loot', id: 'vtt-loot-trigger', action: '_vttToggleLoot', label: 'Butin', tipTitle: 'Butin d’aventure', tipDetail: 'Réserve du groupe', iconExtra: '<b class="vtt-session-dock-badge hot" hidden>0</b>' })}`;
  sessionTools.appendChild(_lf);

  const _ef = document.createElement('div');
  _ef.className = 'vtt-emote-float';
  _ef.innerHTML = `<div class="vtt-emote-picker" id="vtt-emote-picker" role="dialog" aria-label="Choisir une émote" aria-hidden="true"></div>
    <i class="vtt-session-pop-arrow" data-for="emote" hidden aria-hidden="true"></i>
    ${vttSessionDockButton({ key: 'emote', action: '_vttToggleEmotePicker', label: 'Émotes', tipTitle: 'Émotes', tipDetail: 'Maintiens E pour la roue' })}`;
  sessionTools.appendChild(_ef);
  _initEmoteGestures();     // gestes (maintien/glisser) + roue E + touches 1-8

  sessionTools.insertAdjacentHTML('beforeend', '<span class="vtt-session-dock-separator" aria-hidden="true"></span>');

  // Lanceur de dés LIBRE dans le dock d'outils : accessible sans sélectionner de
  // token (le MJ notamment n'a pas de token). Réutilise _vttToggleDice/_renderDicePanel.
  const _df = document.createElement('div');
  _df.className = 'vtt-dice-float';
  _df.innerHTML = `
    <div class="vtt-dice-panel" id="vtt-dice-panel" data-open="0" style="display:none" role="dialog" aria-label="Lanceur de dés" aria-hidden="true"></div>
    <i class="vtt-session-pop-arrow" data-for="dice" hidden aria-hidden="true"></i>
    ${vttSessionDockButton({ key: 'dice', id: 'vtt-dice-trigger', action: '_vttToggleDice', label: 'Dés', tipTitle: 'Lanceur de dés', tipDetail: 'Jets libres & compétences', primary: true })}`;
  sessionTools.appendChild(_df);
  const destroySessionDock = initVttSessionDock();
  VS.unsubs.push(destroySessionDock);
  _renderShortRest();
  _refreshMusicDockTrigger();
  void _ensureLootListener().then(() => _refreshLootDockTrigger());
  // Le lanceur affiche aussi les compétences du token courant (fusion « Jets »).
  setJetsBuilder(_vttBuildJetsBody);

  // Épinglage du panneau : la table vient d'être reconstruite → le panneau DOM est
  // fermé. On remet _slideOpen à zéro (sinon un état périmé après re-navigation
  // empêche la ré-ouverture) puis on ré-ouvre docké si la préférence est active.
  // Fiable sur rechargement complet ET sur simple re-navigation vers la table.
  _slideOpen = false;
  _slideInitialChatPending = true;
  if (_slidePinned) _vttSlide('chat');
  _vttApplySlidePin();
  // NB : le lanceur de dés libre vit désormais dans le panneau « Jets » du
  // pupitre (vtt-inspector.js) — plus de puce flottante dédiée ici.
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
  // Précharge les matrices MJ (combos, armes invoquées) pour les sorts en combat
  loadSpellMatrices().then(m => { _spellMatrices = m; }).catch(() => {});
  // Précharge les overrides MJ de la librairie d'états (CONDITION_LIBRARY)
  _loadConditionsOverrides().catch(() => {});
  // _skillsP : _loadDiceSkills met à jour VS.diceSkills et rerend l'inspector si besoin
  void _skillsP;
  // Abonnements + présence différés (cf. _vttScheduleListeners) : armés à la 1re
  // interaction ou après 2,5 s. `content` = #main-content, hôte des évènements.
  _vttScheduleListeners(content);
}

// [PRÉSENCE → vtt-presence.js]

// ═══════════════════════════════════════════════════════════════════
// [MINI-FICHE PERSONNAGE → vtt-mini-fiche.js]

PAGES.vtt=renderVttPage;


// Registre des actions pour le dispatcher data-vtt-fn
export const VTT_ACTIONS = {
  _vttOpenKeyboardHelp,
  _vttToolPanelToggle,
  _vttToolPanelClose,
  _vttStructureHelpToggle,
  _vttDismissRotate: () => {
    _vttRotateDismissed = true;
    try { sessionStorage.setItem('vtt-rotate-dismissed', '1'); } catch {}
    document.querySelectorAll('.vtt-rotate-prompt').forEach(el => el.classList.add('dismissed'));
  },
  _vttActBarCat,
  _vttAimOpt,
  _showActBar,
  _hideActBar,
  _vttToggleHudCollapse,
  _aimCancel,
  _vttToggleSessionLive,
  _vttToggleTheme: () => toggleTheme(),
  // Mode performance : bascule live (coupe les ombres des tokens + bride le DPR).
  // Persisté par client ; le joueur qui lag l'active et retrouve du FPS.
  _vttToggleLowFx: () => {
    setVttLowFx(!vttLowFx());
    const on = vttLowFx();
    try {
      window.Konva.pixelRatio = on ? 1 : vttCanvasPixelRatio(window.devicePixelRatio, navigator.deviceMemory, navigator.hardwareConcurrency);
      VS.stage?.getLayers?.().forEach(l => { try { l.getCanvas().setPixelRatio(window.Konva.pixelRatio); l.getHitCanvas?.()?.setPixelRatio(window.Konva.pixelRatio); } catch {} });
    } catch {}
    // Reconstruit tokens ET annotations : à l'activation, leurs ombres (shadowBlur,
    // très coûteuses sous Firefox) sont coupées au build ; à la désactivation, elles
    // reviennent. Puis balayage global du stage pour couper les ombres restantes.
    try { _renderAllTokens(); } catch {}
    try { _renderAnnotLayer(); } catch {}
    if (on) { try { _stripShadows(VS.stage); } catch {} }
    VS.stage?.batchDraw?.();
    document.getElementById('vtt-root')?.toggleAttribute('data-vtt-lowfx', on);  // coupe les backdrop-filter (CSS)
    const b = document.querySelector('.vtt-tool-float-tools [data-vtt-fn="_vttToggleLowFx"]');
    if (b) { b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); }
    showNotif(on ? '⚡ Mode performance activé (ombres coupées, résolution bridée)' : 'Mode performance désactivé', 'success');
  },
  _vttToggleOrderPanel,
  _vttSlide,
  _vttSlideClose,
  _vttSlidePin,
  _vttChatFilter,
  _vttChatShowNew,
  _vttMsAttackSlot,
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
  _vttCleanMissingSounds,
  _vttPlayAmbience,
  _vttStopAmbience,
  _vttPlaylistCtxMenu,
  _vttMusicAddMenu,
  _vttMusicToolsMenu,
  _vttAdjBonus,
  _vttSetBonus,
  _vttAoptCheckEmpty,
  _vttAoptFilter,
  _vttAoptSearch,
  _vttAoptSpellScope,
  _vttAtkBonusReset,
  _vttAtkBonusStep,
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
  _vttClearReserveSummons,
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
  _vttConditionGlossary,
  _vttConditionRemove,
  _vttConditionSave,
  _vttUndoMove,
  _vttConfirmAddBuff,
  _vttSyncAddBuffRows,
  _vttConfirmAddPage,
  _vttConfirmCreateEnemy,
  _vttConfirmEditPage,
  _vttPremiumInfo,
  _vttCourir,
  _vttCourirAndClose,
  _vttCreatSendLootToStash,
  _vttCreatSendGoldToStash,
  _vttLootMove,
  _vttLootMove1,
  _vttLootQtyEdit,
  _vttLootQtyStep,
  _vttLootRevealAll,
  _vttLootGoldEdit,
  _vttLootGoldCancel,
  _vttLootGoldOk,
  _vttLootGoldMove,
  _vttLootGoldSplit,
  _vttLootStashMenu,
  _vttLootTableMenu,
  _vttLootQaPick,
  _vttLootCataBack,
  _vttLootCataSel,
  _vttLootCataRar,
  _vttLootCataAdd,
  _vttLootBasketStep,
  _vttLootBasketRemove,
  _vttLootBasketClear,
  _vttLootBasketSend,
  _vttLootCreatureAll,
  _vttLootCreatureDraw,
  _vttLootSetMe,
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
  _vttDiceCmdInput,
  _vttDiceMode,
  _vttDiceRoll,
  _vttDiceRollTyped,
  _vttDiceRerollHistory,
  _vttDiceSelectSkill,
  _vttDiceUseHistory,
  _vttDrawColor,
  _vttDrawShape,
  _vttDrawWidth,
  _vttDuplicateOnPage,
  _vttDuplicatePage,
  _vttDuplicateToken,
  _vttEditPage,
  _vttEditToken,
  _vttEnsureConditionsLoaded,
  _vttFilterDelegates,
  _vttSendEmote,
  _vttEmoteTab,
  _vttEmoteMenu,
  _vttEmotePickEmitter,
  _vttFogClearOps,
  _vttFogTool,
  _vttFogUndo,
  _vttFogRedo,
  _vttImportGithubRelease,
  _vttInsTab,
  _vttOpenSource,
  _vttRcolView,
  _vttSkillFilter,
  _vttSkillFilterClear,
  _vttSwitchCharacterBuild,
  _vttInvokeMyToken,
  _vttKickPresence,
  _vttLibDelFolder,
  _vttLibDelImg,
  _vttLibImportGithub,
  _vttLibImportMenu,
  _vttLibCleanDuplicates,
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
  _vttMsCraftAsk,
  _vttMsCraftCancel,
  _vttMsCraftSearch,
  _vttMsCraftClear,
  _vttMsDeleteItem,
  _vttMsDeleteNote,
  _vttMsEquip,
  _vttMsEquipPicker,
  _vttMsInvCat,
  _vttMsInvClear,
  _vttMsInvSearch,
  _vttMsSendPicker,
  _vttMsSetNiveau,
  _vttMsLevelUp,
  _vttMsSetHp,
  _vttMsSetPm,
  _vttMsSetGarde,
  _vttMsSac,
  _vttMsGoPurse,
  _vttMsPop,
  _vttMsToggleSpell,
  _vttMsSlotChange,
  _vttMsSortCat,
  _vttMsSortClear,
  _vttMsSortSearch,
  _vttMsTab,
  _vttMsToggleCollapsed,
  _vttMsToggleNote,
  _vttMsUnequip,
  _vttMsUnequipAll,
  _vttMusicNext,
  _vttMusicPrev,
  _vttMoveTurnOrder,
  _vttNextActiveTurn,
  _vttToggleLoop,
  _vttNextRound,
  _vttSetTurnTimer,
  _vttNoop,
  _vttOpenTokenDelegatesModal,
  _vttPickElement,
  _vttPickEmote,
  _vttPageFolderToggle,
  _vttPageFolderFilter,
  _vttPageFoldersMenu,
  _vttPageFolderRename,
  _vttPageMenu,
  _vttPageSearch,
  _vttPageSearchClear,
  _vttPgDimensions,
  _vttPgFogMode,
  _vttPgPreset,
  _vttPgSwap,
  _vttPgToggleFit,
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
  _vttReserveLayout,
  _vttReservePick,
  _vttReserveCard,
  _vttReserveClearPicked,
  _vttReservePlacePicked,
  _vttPlaceOnlineReserve,
  _vttResetTurn,
  _vttResolveArg,
  _vttRetireMyToken,
  _vttRetireToken,
  _vttRollAttack,
  _vttAtkSetElement,
  _vttSetWeaponTechnique,
  _vttRollSkill,
  _vttSaveStats,
  _vttSeek,
  _vttSelectFromTray,
  _vttSelectMiniChar,
  _vttSendToPage,
  _vttSetEmoteAlbum,
  _vttAdjustVital,
  _vttSetHp,
  _vttSetImgbbKey,
  _vttSetMode,
  _vttSetActiveTurn,
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
  _vttToggleCombat,
  _vttToggleDice,
  _vttToggleDrawFill,
  _vttToggleEmotePicker,
  _vttToggleFav,
  _vttToggleFog,
  _vttToggleVisionUnlimited,
  _vttSetLockVisibility,
  _vttToggleLogDetail,
  _vttToggleLoot,
  _vttToggleMapMode,
  _vttToggleMiniSheet,
  _vttToggleMsSort,
  _vttToggleMusic,
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
  _vttMusicToggleSoundTitle,
  _vttMusicSelectRail,
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
