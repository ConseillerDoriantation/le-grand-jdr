// ══════════════════════════════════════════════
// characters.js — Point d'entrée mince
// Toute la logique est dans assets/js/features/characters/
// ══════════════════════════════════════════════
import { STATE } from '../core/state.js';
import { updateInCol } from '../data/firestore.js';
import { _esc, _norm, loadingHtml } from '../shared/html.js';
import { charSession } from '../shared/char-session.js';
import { characterPortraitContent } from '../shared/portraits.js';
import { openImageLightbox } from '../shared/image-lightbox.js';
import { characterOriginalPhotoFor } from '../shared/character-media.js';
import { avatarSrcOf } from '../shared/avatar.js';
import {
  applyActiveBuild, buildProjectionPatch, createBuild, deleteBuild,
  getActiveBuild, normalizeCharacterBuilds, renameBuild, saveBuildPatch, switchBuild,
} from '../shared/character-builds.js';
import {
  getMod, calcCA, calcVitesse, calcDeckMax, calcPVMax, calcPMMax,
  calcOr, calcPalier, pct, getItemStatBonus, getItemEffectText,
  sortCharactersForDisplay, modStr,
} from '../shared/char-stats.js';
import { getCharacterRules } from '../shared/character-rules.js';
import { getDeckUsage } from '../shared/spell-deck.js';
import { isFeatureEnabled } from '../shared/features.js';
import { recordRecentNavigation } from '../shared/recent-navigation.js';
import {
  recipeBookButton, openCharacterRecipeBook,
} from './recipes.js';

import { canControlCharacter, getCharacterById, getVisibleCharacters } from '../shared/character-state.js';
// ── Sous-modules ─────────────────────────────────────────────────────────────
import {
  loadCombatStyles, detectCombatStyle,
  openCombatStylesAdmin, openDamageTypesAdmin,
  _weaponFormats,
  _getTraits, getEquippedInventoryIndexMap, getArmorTypeMeta, getArmorSetChipText, getArmorSetData,
  // V3 — combat helpers
  getMainWeapon, getWeaponToucherParts, getWeaponDegatsParts,
} from './characters/data.js';

import {
  renderCharDeck, bindSortCardsDnd,
  addSort, editSort, clearSpellHost,
} from './characters/spells.js';

import { toggleCharElement, setFavoriteElement } from './characters/combat.js';
import {
  renderCharLedger,
  _csV3LedgerSaveField, _csV3LedgerSaveAmount,
  _csV3LedgerSetSearch, _csV3LedgerSetKind, _csV3LedgerSetAddKind,
  _csV3AddLedger, _csV3DeleteLedger, _csV3LedgerMore,
} from './characters/ledger.js';
import { renderCharCapacites } from './characters/capacites.js';
import {
  renderCharJournal, getCurrentJournalSub,
  _bindNotesDnd, _bindQuetesDnd,
  _csV3JournalSub, _csV3ToggleNote, _csV3AddNote, _csV3DeleteNote, _csV3SaveNoteTitle, _csV3CycleNoteCat,
  _csV3SaveOpenNote, _csV3CloseNote,
  _csV3AddRelation, _csV3EditRelation,
  _csV3RelSent, _csV3RelPickNpc, _csV3SaveRelation, _csV3DeleteRelation,
} from './characters/journal.js';
import {
  renderCharProfilV3,
  _csV3SaveQuote, _csV3SaveIdentityValue, _csV3SaveVisibility,
  _csV3AddProfilTag, _csV3AddProfilTagFromInput, _csV3RemoveProfilTag,
  _csV3RenameIdentity, _csV3AddFact,
  _csV3EnterBioEdit, _csV3CancelBio, _csV3SaveBioRt, csV3ToggleBioLock,
  bindCharProfilV3,
} from './characters/profil.js';

import {
  openSellInvModal, sellInvItemBulk,
  openDeleteInvModal, deleteInvItemBulk,
  openSendInvModal, sendInvItem,
  openSendGoldModal, sendGold,
  addInvItem, saveInvItemFromShop,
  editInvItem, saveInvItem,
  renderInvPersonalLine, saveInvPersonalLine,
  filterInvRows, openInventoryItemDetail, inventoryHistoryButton, openInventoryHistoryModal,
  ensureInventoryCatalog, isInventoryCatalogReady, getInventoryCatalogItem, renderCharInventaire,
} from './characters/inventory.js';
import { openCreateItemModal } from './characters/item-forge.js';
import {
  getInventoryItemValue,
  getInventoryItemResaleValue,
  getInventoryItemImage,
  getInventoryReadableDocument,
} from '../shared/inventory-utils.js';
import { RARETE_NAMES, _rareteColor, _rareteLabel } from '../shared/rarity.js';
import {
  getArmorTorsoSlotId, getEquipmentSlot, getEquipmentSlots, getPrimaryWeaponSlotId,
  getSecondaryWeaponSlotId, resolveEquipmentSlotForItem, equipmentSlotAcceptsItem,
} from '../shared/equipment-slots.js';
import { weaponHands } from '../shared/weapon-family.js';

import { editEquipSlot } from './characters/equipment.js';

import {
  renderCharCarac, renderCharNotes,
  toggleNote, addNote, editNoteTitle, saveNote, deleteNote,
  renderCharCompte, refreshOrDisplay,
  addCompteRow, deleteCompteRow, saveCompteField,
  renderCharMaitrises,
  addMaitrise, editMaitrise, saveMaitrise, deleteMaitrise,
  previewXpBar, saveXpDirect, addXpDelta,
  allocStatPoint, addXpFromInput, levelUpChar, adjVitalBase, toggleCompteHist,
  openProfilImageUpload, removeProfilImage,
  STATS_KEYS,
  scheduleNoteAutosave,
} from './characters/tabs.js';
import { bindQuillEditors } from '../shared/rich-text-quill.js';
import { registerActions } from '../core/actions.js';
// URL de la fiche : #characters/<idPerso>/<onglet> — permet le clic molette sur
// un onglet (nouvel onglet navigateur sur CE perso) et le partage d'un lien direct.
import { getRouteSub, setRouteSub } from '../shared/route.js';
import {
  captureViewContext,
  restoreViewContextAfterRender,
} from '../shared/view-context.js';

import {
  inlineEditText, inlineEditNum, inlineEditChip,
  inlineEditStatFromCard, inlineEditStat,
} from './characters/inline-edit.js';

import {
  adjustStat, editVitalCurrent,
  toggleSort, toggleQuete, deleteQuete,
  duplicateSort, setSortValidation,
  deleteSort, deleteChar, createNewChar,
  addQuete,
} from './characters/forms.js';

import { openCharExportMenu } from './characters/export.js';

import { quickViewChar } from './characters/quick-view.js';
import { loadDamageTypes, getDamageTypeRules, getMagicTypes } from '../shared/damage-types.js';
import { getAttackMissEffect } from '../shared/damage-type-rules.js';
import { resolveWeaponDamageContext } from '../shared/weapon-damage-context.js';
import { combatStyleRuleLabels } from '../shared/combat-styles.js';
import Sortable from '../vendor/sortable.esm.js';
import { makeSortable } from '../shared/sortable-helper.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { openModal, closeModalDirect } from '../shared/modal.js';
import { lsJson } from '../shared/local-storage.js';

// Caches partagés Phase 2 — chargés à la demande au 1er affichage Combat
let _combatTabCache = { styles: null, dmgTypes: null };
let _combatTabUi = { charId: '', open: null };
let _currentTopTab   = 'combat';
let _csV3InvFilter = { cat: 'all', search: '' };
let _csV3InvDensity = lsJson.get('cs-inventory-density') === 'list' ? 'list' : 'cards';
let _inventoryCatalogRefreshQueued = false;

// Palette d'auras — constante partagée par renderCharSheet et setCharAura
const AURA_PALETTE = {
  blue: '#4f8cff', arcane: '#9d6fff', crimson: '#ff5a7e',
  gold: '#e8b84b', emerald: '#22c38e', ember: '#ff9544',
};
const CHARACTER_LIFE_STATUSES = Object.freeze({
  alive: { label: 'En vie' },
  dead: { label: 'Mort' },
  other: { label: 'Autre' },
});
const _auraColor = (key) => AURA_PALETTE[key] || AURA_PALETTE.blue;
const _charBlurActions = {};
let _charCalcPopover = null;
let _charCalcAnchor = null;
const _identityUi = {
  charId: null,
  popover: null,
  vitalBreakdown: null,
};

function _identityStateFor(c) {
  if (_identityUi.charId !== c?.id) {
    _identityUi.charId = c?.id || null;
    _identityUi.popover = null;
    _identityUi.vitalBreakdown = null;
  }
  return _identityUi;
}

function _characterLifeStatus(c) {
  const raw = _norm(c?.lifeStatus || 'alive');
  if (['dead', 'mort', 'morte', 'decede', 'decedee'].includes(raw)) return 'dead';
  if (['other', 'autre'].includes(raw)) return 'other';
  return 'alive';
}

const _calcRow = (label, value, detail = '') => `
  <div class="cs-calc-row">
    <div><span>${_esc(label)}</span>${detail ? `<small>${_esc(detail)}</small>` : ''}</div>
    <strong>${_esc(String(value))}</strong>
  </div>`;

function _closeCharCalculationPopover() {
  if (_charCalcAnchor) _charCalcAnchor.classList.remove('is-open');
  if (_charCalcPopover) _charCalcPopover.remove();
  _charCalcPopover = null;
  _charCalcAnchor = null;
  document.removeEventListener('pointerdown', _onCharCalcOutside, true);
  document.removeEventListener('keydown', _onCharCalcKeydown, true);
  window.removeEventListener('resize', _positionCharCalculationPopover);
  window.removeEventListener('scroll', _positionCharCalculationPopover, true);
}

function _onCharCalcOutside(event) {
  if (_charCalcPopover?.contains(event.target) || _charCalcAnchor?.contains(event.target)) return;
  _closeCharCalculationPopover();
}

function _onCharCalcKeydown(event) {
  if (event.key === 'Escape') _closeCharCalculationPopover();
}

function _positionCharCalculationPopover() {
  if (!_charCalcPopover || !_charCalcAnchor) return;
  const gap = 10;
  const pad = 10;
  const anchorRect = _charCalcAnchor.getBoundingClientRect();
  const popRect = _charCalcPopover.getBoundingClientRect();
  const maxLeft = Math.max(pad, window.innerWidth - popRect.width - pad);
  const centered = anchorRect.left + anchorRect.width / 2 - popRect.width / 2;
  const left = Math.min(maxLeft, Math.max(pad, centered));
  const below = anchorRect.bottom + gap;
  const above = anchorRect.top - popRect.height - gap;
  const top = below + popRect.height <= window.innerHeight - pad
    ? below
    : Math.max(pad, above);
  const arrowLeft = Math.min(popRect.width - 18, Math.max(18, anchorRect.left + anchorRect.width / 2 - left));

  _charCalcPopover.style.left = `${left}px`;
  _charCalcPopover.style.top = `${top}px`;
  _charCalcPopover.style.setProperty('--calc-arrow-left', `${arrowLeft}px`);
  _charCalcPopover.classList.toggle('is-above', top < anchorRect.top);
}

function _showCharCalculationPopover(anchor, { title, result, rows, note }) {
  const wasOpenOnSameAnchor = _charCalcAnchor === anchor && _charCalcPopover;
  _closeCharCalculationPopover();
  if (wasOpenOnSameAnchor) return;

  const popover = document.createElement('div');
  popover.className = 'cs-calc-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', title);
  popover.innerHTML = `
    <div class="cs-calc-popover-head">
      <div>
        <span>Calcul</span>
        <strong>${_esc(title)}</strong>
      </div>
      <button type="button" class="cs-calc-popover-close" aria-label="Fermer" data-calc-popover-close>×</button>
    </div>
    <div class="cs-calc-modal">
      <div class="cs-calc-result"><span>Valeur finale</span><strong>${_esc(String(result))}</strong></div>
      <div class="cs-calc-rows">${rows}</div>
      ${note ? `<p class="cs-calc-note">${_esc(note)}</p>` : ''}
    </div>`;

  document.body.appendChild(popover);
  _charCalcPopover = popover;
  _charCalcAnchor = anchor;
  anchor.classList.add('is-open');
  popover.querySelector('[data-calc-popover-close]')?.addEventListener('click', _closeCharCalculationPopover);
  _positionCharCalculationPopover();
  setTimeout(() => {
    document.addEventListener('pointerdown', _onCharCalcOutside, true);
    document.addEventListener('keydown', _onCharCalcKeydown, true);
    window.addEventListener('resize', _positionCharCalculationPopover);
    window.addEventListener('scroll', _positionCharCalculationPopover, true);
  }, 0);
}

function _derivedBonusSources(c, key) {
  return Object.entries(c?.equipement || {}).flatMap(([slot, item]) => {
    const base = parseInt(item?.[key]);
    if (!Number.isFinite(base) || base === 0) return [];
    const upgrade = base > 0 ? Math.max(0, parseInt(item?.upgrades?.effectBonus) || 0) : 0;
    return [{ label: item.nom || slot, value: base + upgrade, detail: slot }];
  });
}

function _calcEquipmentRows(c, key) {
  const sources = _derivedBonusSources(c, key);
  if (!sources.length) return _calcRow('Équipement', '0', 'Aucun bonus actif');
  return sources.map(source =>
    _calcRow(source.label, modStr(source.value), source.detail)
  ).join('');
}

function _weaponForSlot(c, slot = getPrimaryWeaponSlotId()) {
  const raw = c?.equipement?.[slot] || {};
  return slot === getPrimaryWeaponSlotId() && !raw.nom ? getMainWeapon(c) : raw;
}

function _computeCharCalculation(btn) {
  const c = getCharacterById(btn.dataset.id) || charSession.getCurrentChar();
  if (!c) return null;

  const type = btn.dataset.calc;
  const level = c.niveau || 1;
  let title = 'Détail du calcul';
  let result = '';
  let rows = '';
  let note = '';
  let identityRows = '';
  let baseField = '';
  let baseValue = null;
  let identityFormula = '';
  let identityItems = [];

  if (type === 'pv' || type === 'pm') {
    const isPv = type === 'pv';
    const statKey = isPv ? 'constitution' : 'sagesse';
    const statLabel = isPv ? 'Constitution' : 'Sagesse';
    const base = c[isPv ? 'pvBase' : 'pmBase'] || 10;
    const mod = getMod(c, statKey);
    const progression = mod > 0 ? Math.floor(mod * (level - 1)) : mod;
    const derivedKey = isPv ? 'pvMaxBonus' : 'pmMaxBonus';
    title = isPv ? 'Points de Vie maximum' : 'Points de Magie maximum';
    result = isPv ? calcPVMax(c) : calcPMMax(c);
    rows = [
      _calcRow(isPv ? 'PV de base' : 'PM de base', base),
      _calcRow(`Progression de ${statLabel}`, modStr(progression),
        mod > 0 ? `${modStr(mod)} × ${level - 1} niveau(x) gagné(s)` : `Malus ${modStr(mod)} appliqué une fois`),
      _calcEquipmentRows(c, derivedKey),
    ].join('');
    identityRows = [
      _calcRow(`Progression de ${statLabel}`, modStr(progression),
        mod > 0 ? `${modStr(mod)} × ${level - 1} niveau(x) gagné(s)` : `Malus ${modStr(mod)} appliqué une fois`),
      _calcEquipmentRows(c, derivedKey),
    ].join('');
    baseField = isPv ? 'pvBase' : 'pmBase';
    baseValue = base;
    const statShort = isPv ? 'CON' : 'SAG';
    const levelFactor = mod > 0 ? Math.max(0, level - 1) : 1;
    identityFormula = `Base + ${statShort} × niveau + talents`;
    identityItems = [
      { label: `${statShort} ${modStr(mod)} × niv. ${levelFactor}`, value: modStr(progression) },
      ..._derivedBonusSources(c, derivedKey).map(source => ({ label: source.label, value: modStr(source.value) })),
    ];
    note = `Le modificateur de ${statLabel} provient de la valeur totale de la caractéristique.`;
  } else if (type === 'ca') {
    const equip = c.equipement || {};
    const armorBase = getCharacterRules().armorBases?.none ?? 10;
    const dex = getMod(c, 'dexterite');
    const rawCaSources = Object.entries(equip).flatMap(([slot, item]) => {
      const value = parseInt(item?.ca) || 0;
      return value ? [{ slot, item, value }] : [];
    });
    const secondary = equip[getSecondaryWeaponSlotId()];
    const secondaryName = (secondary?.sousType || secondary?.nom || '').toLowerCase();
    const hasShield = secondaryName.includes('bouclier') || secondaryName.includes('shield');
    const shieldOwnBonus = Number.isFinite(parseInt(secondary?.caBonus)) && parseInt(secondary.caBonus) !== 0;
    title = 'Classe d’Armure';
    result = calcCA(c);
    rows = [
      _calcRow('Base de CA', armorBase),
      _calcRow('Modificateur de Dextérité', modStr(dex)),
      ...rawCaSources.map(({ slot, item, value }) => _calcRow(item.nom || slot, modStr(value), slot)),
      _calcEquipmentRows(c, 'caBonus'),
      hasShield && !shieldOwnBonus ? _calcRow('Bouclier', '+2', 'Bonus par défaut') : '',
    ].join('');
    identityFormula = 'Base + DEX + équipement';
    identityItems = [
      { label: 'Base de CA', value: String(armorBase) },
      { label: `DEX ${modStr(dex)}`, value: modStr(dex) },
      ...rawCaSources.map(({ slot, item, value }) => ({ label: item.nom || slot, value: modStr(value) })),
      ..._derivedBonusSources(c, 'caBonus').map(source => ({ label: source.label, value: modStr(source.value) })),
      ...(hasShield && !shieldOwnBonus ? [{ label: 'Bouclier', value: '+2' }] : []),
    ];
    note = 'La CA additionne une base unique, la Dextérité et les bonus explicites de l’équipement. Le type d’armure sert à classer l’objet, pas à ajouter une CA automatique.';
  } else if (type === 'speed') {
    const strength = getMod(c, 'force');
    title = 'Vitesse';
    result = `${calcVitesse(c)} m`;
    rows = [
      _calcRow('Base', '3 m'),
      _calcRow('Modificateur de Force', `${modStr(strength)} m`),
      _calcEquipmentRows(c, 'vitesseBonus'),
    ].join('');
    identityFormula = 'Base + FOR + équipement';
    identityItems = [
      { label: 'Vitesse de base', value: '3 m' },
      { label: `FOR ${modStr(strength)}`, value: `${modStr(strength)} m` },
      ..._derivedBonusSources(c, 'vitesseBonus').map(source => ({ label: source.label, value: `${modStr(source.value)} m` })),
    ];
    note = 'La vitesse ne peut pas descendre sous 0 m.';
  } else if (type === 'deck') {
    const intMod = getMod(c, 'intelligence');
    const progression = Math.floor(Math.max(0, intMod) * Math.pow(Math.max(0, level - 1), 0.75));
    const penalty = Math.min(0, intMod);
    const usage = getDeckUsage(c.deck_sorts);
    title = 'Capacité du deck';
    result = `${usage.used} / ${calcDeckMax(c)}${usage.free ? ` + ${usage.free} libre${usage.free > 1 ? 's' : ''}` : ''}`;
    rows = [
      _calcRow('Capacité de base', 3),
      _calcRow('Malus d’Intelligence', modStr(penalty)),
      _calcRow('Progression', modStr(progression), `Intelligence ${modStr(intMod)} · niveau ${level}`),
      usage.free ? _calcRow('Toujours prêts', usage.free, 'Ne consomment aucun emplacement') : '',
    ].join('');
    identityFormula = 'Base + INT + niveau';
    identityItems = [
      { label: 'Capacité de base', value: '3' },
      ...(penalty ? [{ label: 'Malus d’INT', value: modStr(penalty) }] : []),
      { label: `INT ${modStr(intMod)} · niv. ${level}`, value: modStr(progression) },
      ...(usage.free ? [{ label: 'Toujours prêts', value: `+${usage.free}` }] : []),
    ];
    note = 'Le premier nombre correspond aux emplacements utilisés. Les sorts « Toujours prêts » restent disponibles sans réduire cette capacité.';
  } else if (type === 'or') {
    const compte = c.compte || { recettes: [], depenses: [] };
    const totalR = (compte.recettes || []).reduce((sum, item) => sum + (parseFloat(item?.montant) || 0), 0);
    const totalD = (compte.depenses || []).reduce((sum, item) => sum + (parseFloat(item?.montant) || 0), 0);
    title = 'Bourse';
    result = `${calcOr(c)} or`;
    rows = totalR > 0 || totalD > 0
      ? [
          _calcRow('Recettes', `+${Math.round(totalR * 100) / 100} or`),
          _calcRow('Dépenses', `−${Math.round(totalD * 100) / 100} or`),
        ].join('')
      : _calcRow('Or disponible', `${calcOr(c)} or`, 'Solde direct du personnage');
    identityFormula = 'Recettes − dépenses';
    identityItems = totalR > 0 || totalD > 0
      ? [
          { label: 'Recettes', value: `+${Math.round(totalR * 100) / 100} or` },
          { label: 'Dépenses', value: `−${Math.round(totalD * 100) / 100} or` },
        ]
      : [{ label: 'Or disponible', value: `${calcOr(c)} or` }];
    note = 'La bourse correspond aux recettes moins les dépenses enregistrées dans le journal du trésor.';
  } else if (type?.startsWith('weapon-')) {
    const slot = btn.dataset.slot || getPrimaryWeaponSlotId();
    const item = _weaponForSlot(c, slot);
    const fallback = item.statAttaque === 'dexterite'
      ? 'dexterite'
      : item.statAttaque === 'intelligence' ? 'intelligence' : 'force';
    if (!item?.nom) return null;

    if (type === 'weapon-touch') {
      const parts = getWeaponToucherParts(c, item, fallback);
      title = `Toucher · ${item.nom}`;
      result = parts.roll;
      rows = parts.statLabel
        ? [
            _calcRow('Jet de base', '1d20'),
            _calcRow(`Modificateur de ${parts.statLabel}`, modStr(parts.statMod || 0)),
            _calcRow('Bonus de set', modStr(parts.setBonus || 0)),
          ].join('')
        : [
            _calcRow('Jet défini par l’arme', item.toucher || parts.roll),
            _calcRow('Bonus de set', modStr(parts.setBonus || 0)),
          ].join('');
      note = `Arme équipée en ${slot}.`;
    } else if (type === 'weapon-damage') {
      const parts = getWeaponDegatsParts(c, item, fallback);
      title = `Dégâts · ${item.nom}`;
      result = parts?.roll || '—';
      rows = parts ? [
        _calcRow('Dés de l’arme', item.degats),
        _calcRow(`Modificateur · ${parts.statLabel}`, modStr(parts.statMod || 0)),
        _calcRow('Maîtrise', modStr(parts.maitriseBonus || 0)),
      ].join('') : _calcRow('Dégâts', 'Aucun');
      note = 'La maîtrise utilisée est la meilleure maîtrise compatible avec cette arme.';
    } else {
      title = `Portée · ${item.nom}`;
      result = item.portee || '1 case';
      rows = [
        _calcRow('Portée de l’arme', item.portee || '1 case'),
        _calcRow('Source', item.nom, slot),
      ].join('');
      note = 'Les sorts utilisant la portée de l’arme reprennent cette valeur, sauf réglage propre au sort.';
    }
  } else {
    return null;
  }

  return { title, result, rows, note, identityRows, baseField, baseValue, identityFormula, identityItems };
}

function openCharCalculation(btn) {
  const data = _computeCharCalculation(btn);
  if (data) _showCharCalculationPopover(btn, data);
}

// Dérivées inline : clic sur une tuile CA/Vit/Deck → détail déplié sous la grille
// (un seul panneau ouvert ; re-clic referme). PV/PM gardent le popover ancré.
function toggleCharDerivative(btn) {
  const panel = document.getElementById('cs-brk-panel');
  if (!panel) { openCharCalculation(btn); return; }
  const key = btn.dataset.calc || '';
  const isSame = panel.classList.contains('on') && panel.dataset.calc === key;
  const group = btn.closest('.ids-facts') || btn.closest('.cs-mini-grid');
  group?.querySelectorAll('.on').forEach(b => b.classList.remove('on'));
  if (isSame) { panel.classList.remove('on'); panel.dataset.calc = ''; panel.innerHTML = ''; return; }
  const d = _computeCharCalculation(btn);
  if (!d) { panel.classList.remove('on'); panel.dataset.calc = ''; panel.innerHTML = ''; return; }
  btn.classList.add('on');
  panel.dataset.calc = key;
  panel.innerHTML = `
    <div class="ids-vital-detail-head"><b>${_esc(d.title)}</b><span>${_esc(d.identityFormula || 'Détail du calcul')}</span></div>
    ${(d.identityItems || []).map(item => `<div class="ids-calc-row"><span>${_esc(item.label)}</span><b>${_esc(item.value)}</b></div>`).join('')}
    <div class="ids-vital-total"><span>Total</span><b>${_esc(String(d.result))}</b></div>
    ${key === 'or' ? `<div class="ids-brk-a">
      ${canControlCharacter(getCharacterById(btn.dataset.id) || charSession.getCurrentChar())
        ? `<button class="ids-btn gold" data-action="openSendGoldModal" data-id="${_esc(btn.dataset.id)}">↗ Envoyer</button>`
        : ''}
      <button class="ids-btn" data-action="showCharTab" data-tab="compte">Historique</button>
    </div>` : ''}`;
  panel.classList.add('on');
}

function registerCharBlurActions(map) { Object.assign(_charBlurActions, map); }
document.addEventListener('focusout', (event) => {
  const el = event.target?.closest?.('[data-blur]');
  if (!el) return;
  const handler = _charBlurActions[el.dataset.blur];
  if (handler) handler(el, event);
}, true);

// ══════════════════════════════════════════════
// SÉLECTION
// ══════════════════════════════════════════════
function selectChar(id, el) {
  _closeCharPicker();
  document.querySelectorAll('#char-pills .char-pill').forEach(p=>p.classList.toggle('active', p.dataset.charid === id));
  if (el) el.classList.add('active');
  const c = STATE.characters.find(x=>x.id===id);
  if (c) { STATE.activeChar=c; renderCharSheet(c, charSession.getCurrentCharTab()||'carac'); }
}

function _adminOwnerKey(c = {}) {
  return c.uid ? `uid:${c.uid}` : `owner:${c.ownerPseudo || 'unknown'}`;
}

function _characterOwnerMeta(c = {}) {
  const profile = c.uid ? (STATE.adventure?.memberProfiles?.[c.uid] || {}) : {};
  return {
    label: profile.pseudo || c.ownerPseudo || profile.email || (c.uid ? 'Compte lié' : 'Sans compte'),
    avatar: avatarSrcOf(profile),
  };
}

// ══════════════════════════════════════════════
// RENDER PRINCIPAL
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// V3 — Tabs simplifiés (6 onglets) selon HANDOFF_Claude_Code.md
//   combat · sorts · inv · compte · journal · profil
// On garde le legacy resolveTab pour la rétro-compat des liens entrants.
// ══════════════════════════════════════════════════════════════════════════════
const V3_TABS = ['combat', 'capacites', 'sorts', 'inv', 'compte', 'journal', 'profil'];
const V3_TAB_REMAP = {
  // anciens → nouveaux
  equipement: 'combat',
  maitrises:  'combat',
  carac:      'combat',
  inventaire: 'inv',
  notes:      'journal',
  quetes:     'journal',
};

function _characterRouteSub(charId, tab) {
  const [routeCharId, routeTab, routeMode] = getRouteSub('characters').split('/');
  if (tab === 'sorts' && routeCharId === charId && routeTab === 'sorts'
    && ['grimoire', 'prepare'].includes(routeMode)) {
    return `${charId}/sorts/${routeMode}`;
  }
  return `${charId}/${tab}`;
}

function _resolveV3Tab(raw) {
  if (V3_TABS.includes(raw)) return raw;
  return V3_TAB_REMAP[raw] || 'combat';
}


// Couleur d'aura effective : couleur perso (hex libre) sinon preset nommé.
function _auraHex(c) {
  const cust = (c?.auraColor || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(cust) ? cust : _auraColor(c?.aura);
}
// Convertit une couleur hex aura (#rrggbb) + intensité en variables CSS.
function _auraVars(hexCol, intensity = 1) {
  const r = parseInt(hexCol.slice(1,3),16);
  const g = parseInt(hexCol.slice(3,5),16);
  const b = parseInt(hexCol.slice(5,7),16);
  const k = Math.max(0.3, Math.min(2, intensity || 1));
  const a = (base) => Math.min(0.96, base * k).toFixed(3);
  return {
    aura:       hexCol,
    auraGlow:   `rgba(${r},${g},${b},${a(0.14)})`,
    auraSoft:   `rgba(${r},${g},${b},${a(0.07)})`,
    auraBd:     `rgba(${r},${g},${b},${a(0.55)})`,
    auraStrong: `rgba(${r},${g},${b},${a(0.85)})`,
    auraSh:     `0 0 ${Math.round(38*k)}px rgba(${r},${g},${b},${a(0.28)})`,
  };
}
// Chaîne de variables CSS d'aura posée sur la racine .cs-v3 (toute la feuille en hérite).
function _auraStyleVars(c) {
  const v = _auraVars(_auraHex(c));
  return `--aura:${v.aura};--aura-glow:${v.auraGlow};--aura-soft:${v.auraSoft};--aura-border:${v.auraBd};--aura-strong:${v.auraStrong};--aura-shadow:${v.auraSh}`;
}
// Réapplique les variables d'aura en direct (sans re-render complet) + états actifs du picker.
function _applyAuraVars(c) {
  const root = document.querySelector('.cs-v3');
  if (root) {
    const v = _auraVars(_auraHex(c));
    root.style.setProperty('--aura',        v.aura);
    root.style.setProperty('--aura-glow',   v.auraGlow);
    root.style.setProperty('--aura-soft',   v.auraSoft);
    root.style.setProperty('--aura-border', v.auraBd);
    root.style.setProperty('--aura-strong', v.auraStrong);
    root.style.setProperty('--aura-shadow', v.auraSh);
  }
  const side = document.getElementById('cs-sidebar');
  if (side) side.setAttribute('data-aura', c.auraColor ? 'custom' : (c.aura || 'blue'));
  const isCustom = !!c.auraColor;
  document.querySelectorAll('.aura-dot:not(.aura-dot--custom)').forEach(d =>
    d.classList.toggle('active', !isCustom && d.dataset.auraKey === (c.aura || 'blue')));
  document.querySelector('.aura-dot--custom')?.classList.toggle('active', isCustom);
  document.querySelectorAll('.ids-dot:not(.custom)').forEach(dot =>
    dot.classList.toggle('active', !isCustom && dot.dataset.auraKey === (c.aura || 'blue')));
  document.querySelector('.ids-dot.custom')?.classList.toggle('active', isCustom);
}

const PLAYER_PORTRAIT_SWITCH_MAX = 5;

// Pour les joueurs qui ont peu de personnages : tous les choix restent visibles
// sans ouvrir de menu. Le portrait porte l'action, le nom sert de légende.
function _playerCharPortraitHtml(ch, activeCharId) {
  const active = ch.id === activeCharId;
  const col = _auraHex(ch);
  const meta = `Niv.${ch.niveau || 1}${ch.classe ? ` · ${ch.classe}` : ''}${ch.isDefault ? ' · ★ Favori' : ''}`;
  return `<button type="button" class="cs-player-char${active ? ' active' : ''}${ch.isDefault ? ' is-default' : ''}"
    data-charid="${_esc(ch.id)}" data-action="selectChar" data-id="${_esc(ch.id)}"
    style="--av-c:${col}" title="${_esc(`${ch.nom || 'Sans nom'} — ${meta}`)}"
    aria-label="Afficher ${_esc(ch.nom || 'ce personnage')}" aria-current="${active ? 'true' : 'false'}">
    <span class="cs-player-char-avatar">
      <span class="char-pill-av">${characterPortraitContent(ch)}</span>
      ${ch.isDefault ? '<span class="char-pill-star" title="Personnage favori">★</span>' : ''}
    </span>
    <span class="char-pill-name">${_esc(ch.nom || 'Sans nom')}</span>
  </button>`;
}

// Comptes propriétaires (pour le filtre du sélecteur en vue MJ), avec le profil
// du joueur (image + pseudo) et ses persos triés.
function _charOwners(chars) {
  const profiles = STATE.adventure?.memberProfiles || {};
  const map = new Map();
  chars.forEach(c => {
    const key = _adminOwnerKey(c);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(c);
  });
  return [...map.entries()].map(([key, list]) => {
    const uid = key.startsWith('uid:') ? key.slice(4) : '';
    const profile = uid ? (profiles[uid] || {}) : {};
    const sorted = sortCharactersForDisplay(list);
    return {
      key, profile, chars: sorted, count: sorted.length,
      label: profile.pseudo || sorted[0]?.ownerPseudo || profile.email || (uid ? 'Compte lié' : 'Sans compte'),
    };
  }).sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

// Filtre visuel par compte : liste verticale avec avatar, nom et nombre de
// personnages. Elle reste lisible même avec beaucoup de joueurs.
function _charPickAccountsHtml(owners, total) {
  if (owners.length <= 1) return '';
  const buttons = owners.map(o =>
    `<button type="button" class="cs-charpick-account" data-acct="${_esc(o.key)}" data-action="charPickAccount" aria-pressed="false">
      <img class="cs-charpick-account-avatar" src="${_esc(avatarSrcOf(o.profile))}" alt="" loading="lazy" decoding="async">
      <span class="cs-charpick-account-body"><b>${_esc(o.label)}</b><small>${o.count} personnage${o.count > 1 ? 's' : ''}</small></span>
      <span class="cs-charpick-account-count" aria-hidden="true">${o.count}</span>
    </button>`
  ).join('');
  return `<details class="cs-charpick-account-filter">
    <summary class="cs-charpick-account-summary">
      <span class="cs-charpick-account-summary-avatar" aria-hidden="true"><span>👥</span><img alt="" hidden></span>
      <span class="cs-charpick-account-summary-body"><small>Compte affiché</small><b>Tous les comptes</b></span>
      <span class="cs-charpick-account-summary-count">${total}</span>
      <svg class="nav-icon" aria-hidden="true"><use href="./assets/img/icons.svg#icon-chevron"/></svg>
    </summary>
    <header class="cs-charpick-account-head"><span>Choisir un compte</span><small>${owners.length} disponibles</small></header>
    <div class="cs-charpick-account-list">
      <button type="button" class="cs-charpick-account cs-charpick-account-all active" data-acct="" data-action="charPickAccount" aria-pressed="true">
        <span class="cs-charpick-account-avatar" aria-hidden="true">👥</span>
        <span class="cs-charpick-account-body"><b>Tous les comptes</b><small>${total} personnages</small></span>
        <span class="cs-charpick-account-count" aria-hidden="true">${total}</span>
      </button>
      ${buttons}
    </div>
  </details>`;
}

// Une ligne du menu du sélecteur (recherche/filtre par data-attributs).
function _charPickRowHtml(ch, activeCharId, ownerLabels = new Map()) {
  const owner = ownerLabels.get(_adminOwnerKey(ch)) || ch.ownerPseudo || (ch.uid ? '' : 'Sans compte');
  const meta = `Niv.${ch.niveau||1}${ch.classe ? ' · ' + _esc(ch.classe) : ''}`;
  return `<button type="button" role="option" class="cs-charpick-row${ch.id===activeCharId?' active':''}"
    data-action="selectChar" data-id="${ch.id}" data-charid="${ch.id}"
    data-search="${_esc(`${ch.nom || ''} ${owner}`.toLowerCase())}" data-owner="${_esc(_adminOwnerKey(ch))}"
    aria-selected="${ch.id===activeCharId?'true':'false'}">
    <span class="char-pill-av" style="--av-c:${_auraColor(ch.aura)}">${characterPortraitContent(ch)}${ch.isDefault?'<span class="char-pill-star">★</span>':''}</span>
    <span class="cs-charpick-row-body"><b>${_esc(ch.nom || 'Sans nom')}</b><small>${meta}</small></span>
    ${STATE.isAdmin && owner ? `<span class="cs-charpick-row-owner">${_esc(owner)}</span>` : ''}
  </button>`;
}

function _buildCharSwitchHtml(activeCharId, canEdit) {
  const switchable = sortCharactersForDisplay(getVisibleCharacters());

  // Un joueur avec une petite collection voit immédiatement tous ses portraits.
  // Le MJ conserve le sélecteur avancé, même sur une aventure encore peu remplie.
  if (!STATE.isAdmin && switchable.length <= PLAYER_PORTRAIT_SWITCH_MAX) {
    return `<div class="cs-player-switch" role="navigation" aria-label="Mes personnages">
      ${switchable.map(ch => _playerCharPortraitHtml(ch, activeCharId)).join('')}
      ${canEdit ? `<button type="button" class="cs-player-char cs-player-char-new" data-action="createNewChar" title="Créer un personnage" aria-label="Créer un personnage">
        <span class="cs-player-char-new-icon" aria-hidden="true">＋</span>
        <span class="char-pill-name">Nouveau</span>
      </button>` : ''}
    </div>`;
  }

  // Vue MJ ou collection joueur importante → bouton courant + menu
  // (recherche + filtre par compte + liste). Tient dans le bandeau collant.
  const cur = switchable.find(c => c.id === activeCharId) || switchable[0];
  const owners = STATE.isAdmin ? _charOwners(switchable) : [];
  const ownerLabels = new Map(owners.map(o => [o.key, o.label]));
  const accountsHtml = _charPickAccountsHtml(owners, switchable.length);
  return `<div class="cs-charpick" data-charpick>
    <button type="button" class="cs-charpick-btn" data-action="toggleCharPicker" aria-haspopup="listbox" aria-expanded="false">
      <span class="char-pill-av" style="--av-c:${_auraColor(cur?.aura)}">${cur ? characterPortraitContent(cur) : ''}</span>
      <span class="cs-charpick-cur"><b>${_esc(cur?.nom || '—')}</b><small>Niv.${cur?.niveau||1}${cur?.classe?' · '+_esc(cur.classe):''}${STATE.isAdmin && cur?.ownerPseudo ? ' · '+_esc(cur.ownerPseudo) : ''}</small></span>
      <svg class="nav-icon cs-charpick-chev" aria-hidden="true"><use href="./assets/img/icons.svg#icon-chevron"/></svg>
    </button>
    <div class="cs-charpick-menu" hidden role="listbox" aria-label="Choisir un personnage">
      <div class="cs-charpick-tools">
        <input type="search" class="cs-charpick-search" placeholder="Personnage ou compte…" data-input="charPickSearch" aria-label="Rechercher un personnage ou un compte">
      </div>
      ${accountsHtml}
      <header class="cs-charpick-character-head"><span>Personnages</span><small><span class="cs-charpick-result-count">${switchable.length}</span> affichés</small></header>
      <div class="cs-charpick-list">
        ${switchable.map(ch => _charPickRowHtml(ch, activeCharId, ownerLabels)).join('')}
      </div>
      <div class="cs-charpick-empty" hidden>Aucun personnage trouvé.</div>
      ${canEdit ? `<button type="button" class="cs-charpick-new" data-action="createNewChar">➕ Nouveau personnage</button>` : ''}
    </div>
  </div>`;
}

// ── Sélecteur de personnage (menu recherche + filtre compte) ─────────────────
function _closeCharPicker() {
  const btn = document.querySelector('.cs-charpick-btn[aria-expanded="true"]');
  const menu = document.querySelector('.cs-charpick-menu:not([hidden])');
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', _onCharPickOutside, true);
}
function _onCharPickOutside(e) {
  if (!e.target.closest('.cs-charpick')) _closeCharPicker();
}
function toggleCharPicker(btn) {
  const menu = btn.parentElement?.querySelector('.cs-charpick-menu');
  if (!menu) return;
  const willOpen = menu.hidden;
  menu.hidden = !willOpen;
  btn.setAttribute('aria-expanded', String(willOpen));
  document.removeEventListener('pointerdown', _onCharPickOutside, true);
  if (willOpen) {
    setTimeout(() => {
      document.addEventListener('pointerdown', _onCharPickOutside, true);
      menu.querySelector('.cs-charpick-search')?.focus();
    }, 0);
  }
}
function _charPickFilter() {
  const menu = document.querySelector('.cs-charpick-menu');
  if (!menu) return;
  const q = (menu.querySelector('.cs-charpick-search')?.value || '').toLowerCase().trim();
  const acct = menu.querySelector('.cs-charpick-account.active')?.dataset.acct || '';
  let visibleCount = 0;
  menu.querySelectorAll('.cs-charpick-row').forEach(row => {
    const okName = !q || (row.dataset.search || '').includes(q);
    const okAcct = !acct || row.dataset.owner === acct;
    row.hidden = !(okName && okAcct);
    if (!row.hidden) visibleCount += 1;
  });
  const empty = menu.querySelector('.cs-charpick-empty');
  const resultCount = menu.querySelector('.cs-charpick-result-count');
  if (empty) empty.hidden = visibleCount > 0;
  if (resultCount) resultCount.textContent = String(visibleCount);
}
function charPickAccount(btn) {
  const filter = btn.closest('.cs-charpick-account-filter');
  filter?.querySelectorAll('.cs-charpick-account').forEach(account => {
    const active = account === btn;
    account.classList.toggle('active', active);
    account.setAttribute('aria-pressed', String(active));
  });
  const summary = filter?.querySelector('.cs-charpick-account-summary');
  const sourceImg = btn.querySelector('img');
  const summaryImg = summary?.querySelector('img');
  const summaryIcon = summary?.querySelector('.cs-charpick-account-summary-avatar > span');
  const label = btn.querySelector('.cs-charpick-account-body b')?.textContent || 'Tous les comptes';
  const count = btn.querySelector('.cs-charpick-account-count')?.textContent || '';
  if (summaryImg) {
    summaryImg.hidden = !sourceImg;
    if (sourceImg) summaryImg.src = sourceImg.currentSrc || sourceImg.src;
    else summaryImg.removeAttribute('src');
  }
  if (summaryIcon) summaryIcon.hidden = !!sourceImg;
  const summaryLabel = summary?.querySelector('.cs-charpick-account-summary-body b');
  const summaryCount = summary?.querySelector('.cs-charpick-account-summary-count');
  if (summaryLabel) summaryLabel.textContent = label;
  if (summaryCount) summaryCount.textContent = count;
  if (filter) filter.open = false;
  _charPickFilter();
}

// 6 tuiles de statistiques avec segmentation base/niveau/équipement
function _buildStatTilesHtml(c, canEdit, lvlPointsRemaining) {
  const s  = c.stats      || {};
  const sb = c.statsBonus || {};
  const sLvl = c.statsLevelUps || {};
  const isAdmin = !!STATE.isAdmin;
  const STAT_FULL = {
    force: 'Force', dexterite: 'Dextérité', intelligence: 'Intelligence',
    constitution: 'Constitution', sagesse: 'Sagesse', charisme: 'Charisme',
  };
  const stats = [
    {key:'force',        abbr:'FOR'},
    {key:'dexterite',    abbr:'DEX'},
    {key:'intelligence', abbr:'INT'},
    {key:'constitution', abbr:'CON'},
    {key:'sagesse',      abbr:'SAG'},
    {key:'charisme',     abbr:'CHA'},
  ];
  // Résumé au-dessus des tuiles : Base + Niveau + Équipement = total.
  const summary = stats.reduce((t, st) => {
    const value = Number(s[st.key]) || 8;
    const level = Number.parseInt(sLvl[st.key], 10) || 0;
    const equipment = Number(sb[st.key]) || 0;
    t.base += value - level; t.level += level; t.equipment += equipment;
    t.total += value + equipment;
    return t;
  }, { base: 0, level: 0, equipment: 0, total: 0 });
  const signed = v => v > 0 ? `+${v}` : String(v);
  const summaryHtml = `<div class="stats-summary" title="Somme des six caractéristiques">
    <div class="stats-summary-title"><span>Points de caractéristiques</span><strong>${summary.total}</strong></div>
    <div class="stats-summary-formula" aria-label="Base ${summary.base}, niveau ${summary.level}, équipement ${summary.equipment}, total ${summary.total}">
      <span><small>Base</small><b>${summary.base}</b></span><i>+</i>
      <span><small>Niveau</small><b>${signed(summary.level)}</b></span><i>+</i>
      <span><small>Équip.</small><b class="${summary.equipment > 0 ? 'pos' : summary.equipment < 0 ? 'neg' : ''}">${signed(summary.equipment)}</b></span><i>=</i>
      <span class="is-total"><small>Total</small><b>${summary.total}</b></span>
    </div>
  </div>`;

  // Tuile façon maquette : abréviation · total · pastille de mod · détail
  // « base X · (niv +N) · eq Y ». Allocation : clic sur la tuile = +1 (badge
  // ambre = points restants) ; la portion « niv +N » cliquable = −1 ; base
  // éditable par le MJ.
  return summaryHtml + stats.map(st => {
    const totalBase = Number(s[st.key]) || 8;
    const lvlUp     = Number.parseInt(sLvl[st.key], 10) || 0;
    const pureBase  = totalBase - lvlUp;
    const bonus     = Number(sb[st.key]) || 0;
    const total     = totalBase + bonus;
    const m         = getMod(c, st.key);
    const mStr      = m >= 0 ? `+${m}` : String(m);
    const mCls      = m > 0 ? 'pos' : m < 0 ? 'neg' : 'zero';
    const eqCls     = bonus > 0 ? 'pos' : bonus < 0 ? 'neg' : 'zero';
    const eqDisp    = bonus > 0 ? `+${bonus}` : bonus < 0 ? String(bonus) : '+0';
    const canPlus   = canEdit && lvlPointsRemaining > 0;
    const canMinus  = canEdit && lvlUp > 0;
    const full      = _esc(STAT_FULL[st.key] || st.key);

    const baseDetail = (canEdit && isAdmin)
      ? `<button class="stat-detail-edit" data-action="inlineEditStat" data-id="${c.id}" data-key="${st.key}" title="MJ — modifier la base">base <b class="js-stat-base">${pureBase}</b> ✎</button>`
      : `<span>base <b class="js-stat-base">${pureBase}</b></span>`;
    // Niveau : afficher +N pour les non-éditeurs ; les éditeurs ont le stepper.
    const nivInline = (!canEdit && lvlUp > 0) ? `<span>niv <b>+${lvlUp}</b></span>` : '';
    // Stepper explicite − / + (toujours visible pour l'éditeur ; boutons grisés
    // aux bornes). Remplace l'ancien « clic sur la tuile » peu découvrable.
    const nivStepper = canEdit
      ? `<div class="stat-lvl-ctrls" role="group" aria-label="Points de niveau — ${full}">
          <button class="stat-lvl-btn minus" data-action="allocateStat" data-id="${c.id}" data-key="${st.key}" data-delta="-1"${canMinus ? '' : ' disabled'} title="Retirer 1 point de niveau" aria-label="Retirer 1 point de niveau sur ${full}">−</button>
          <span class="stat-lvl-val" title="Points de niveau alloués"><small>niv</small> <b>${lvlUp > 0 ? '+' : ''}${lvlUp}</b></span>
          <button class="stat-lvl-btn plus" data-action="allocateStat" data-id="${c.id}" data-key="${st.key}" data-delta="1"${canPlus ? '' : ' disabled'} title="Dépenser 1 point de niveau" aria-label="Ajouter 1 point de niveau sur ${full}">+</button>
        </div>`
      : '';

    return `<div class="stat-tile${canPlus ? ' is-alloc' : ''}" data-stat="${st.key}"
      title="${full} — base ${pureBase} + niveau +${lvlUp} + équip. ${eqDisp} = ${total}">
      ${canPlus ? `<span class="stat-alloc" title="${lvlPointsRemaining} point(s) de niveau à dépenser">${lvlPointsRemaining}</span>` : ''}
      <span class="stat-tile-abbr">${st.abbr}</span>
      <span class="stat-tile-total">${total}</span>
      <span class="stat-tile-mod ${mCls}">${mStr}</span>
      <span class="stat-tile-detail">${baseDetail}${nivInline}<span>eq <b class="${eqCls}">${eqDisp}</b></span></span>
      ${nivStepper}
    </div>`;
  }).join('');
}

// Navigation par onglets v3
function _buildTabsHtml(c, v3Tab) {
  // Icône SVG du jeu maison (rendu homogène cross-OS vs émoji ; hérite currentColor).
  const _ico = (id) => `<svg class="cs-tab-svg" aria-hidden="true"><use href="./assets/img/icons.svg#icon-${id}"/></svg>`;
  const deckUsage = getDeckUsage(c.deck_sorts);
  return [
    { k: 'combat',    ico: 'sword',       lbl: 'Combat' },
    { k: 'capacites', ico: 'star',        lbl: 'Capacités' },
    { k: 'sorts',     ico: 'sparkles',    lbl: 'Sorts',      badge: `${deckUsage.used}/${calcDeckMax(c)}${deckUsage.free ? ` +${deckUsage.free}` : ''}` },
    { k: 'inv',     ico: 'bag',         lbl: 'Inventaire', badge: `${(c.inventaire||[]).length||''}` },
    { k: 'compte',  ico: 'coin',        lbl: 'Bourse' },
    { k: 'journal', ico: 'book',        lbl: 'Journal' },
    { k: 'profil',  ico: 'user-circle', lbl: 'Profil' },
  ].map(t => `<button class="tab-v3 ${t.k===v3Tab?'active':''}" id="cs-tab-${t.k}"
    role="tab" aria-selected="${t.k===v3Tab?'true':'false'}" aria-controls="char-tab-content"
    tabindex="${t.k===v3Tab?'0':'-1'}"
    data-tab-v3="${t.k}" data-action="showCharTab" data-tab="${t.k}"
    data-nav-page="characters" data-nav-sub="${_characterRouteSub(c.id, t.k)}">
    <span class="tab-ico" aria-hidden="true">${_ico(t.ico)}</span> ${t.lbl}
    ${t.badge?`<span class="tab-badge">${t.badge}</span>`:''}
  </button>`).join('');
}

const _identityNumber = value => Number(value || 0).toLocaleString('fr-FR');

function _identityPopoverHtml(c, canEdit, { xpCur, xpPalier, xpPct }) {
  const ui = _identityStateFor(c);
  if (!ui.popover) return '';
  if (ui.popover === 'builds') return canEdit ? _buildBuildManagerHtml(c) : '';
  if (ui.popover === 'status') {
    if (!canEdit) return '';
    const current = _characterLifeStatus(c);
    const descriptions = {
      alive: 'Participe normalement à l’aventure',
      dead: 'Portrait affiché en noir et blanc',
      other: 'Situation particulière ou indéterminée',
    };
    return `<section class="ids-pop ids-pop-status" role="menu" aria-label="État du personnage">
      <span class="ids-pop-kicker">État du personnage</span>
      <div class="ids-status-options">
        ${Object.entries(CHARACTER_LIFE_STATUSES).map(([value, meta]) => `<button type="button" class="ids-status-option is-${value}${value === current ? ' active' : ''}" role="menuitemradio" aria-checked="${value === current}" data-action="setCharacterLifeStatus" data-id="${c.id}" data-status="${value}">
          <i aria-hidden="true"></i><span><b>${meta.label}</b><small>${descriptions[value]}</small></span><em aria-hidden="true">✓</em>
        </button>`).join('')}
      </div>
    </section>`;
  }
  if (ui.popover === 'aura') {
    if (!canEdit) return '';
    const isCustom = !!c.auraColor;
    return `<section class="ids-pop ids-pop-look" role="dialog" aria-label="Aura du personnage">
      <span class="ids-pop-kicker">Aura</span>
      <p class="ids-aura-help">Couleur de l'anneau d'expérience autour du portrait.</p>
      <div class="ids-aura">
        ${Object.entries(AURA_PALETTE).map(([key, color]) => `<button class="ids-dot${!isCustom && (c.aura || 'blue') === key ? ' active' : ''}"
          style="--dot-c:${color}" data-aura-key="${key}" data-action="setCharAura" data-id="${c.id}" title="${key}"></button>`).join('')}
        <label class="ids-dot custom${isCustom ? ' active' : ''}" style="--dot-c:${_auraHex(c)}" title="Couleur personnalisée">
          <input type="color" value="${_auraHex(c)}" data-change="setCharAuraColor" data-id="${c.id}">
        </label>
      </div>
      ${c.photo ? `<div class="ids-pop-divider"></div><button class="ids-photo-remove" data-action="delete-character-photo" data-charid="${c.id}">Retirer la photo</button>` : ''}
    </section>`;
  }
  const ready = xpPalier > 0 && xpCur >= xpPalier;
  return `<section class="ids-pop ids-pop-xp" role="dialog" aria-label="Progression du personnage">
    <header><b>Progression</b><button data-action="closeIdentityPopover" aria-label="Fermer">×</button></header>
    <div class="ids-xp-pop-head"><span>Niveau ${c.niveau || 1}</span><b>${xpPct}%</b></div>
    <div class="ids-xp-track"><i style="width:${xpPct}%"></i></div>
    <p class="ids-xp-current-line">${canEdit
      ? `<button class="ids-xp-current" data-action="inlineEditNum" data-id="${c.id}" data-field="exp" data-min="0" data-max="999999" title="Modifier l’XP actuel">${_identityNumber(xpCur)}</button>`
      : `<b>${_identityNumber(xpCur)}</b>`}<span>/ ${_identityNumber(xpPalier)} XP</span></p>
    ${canEdit ? `<div class="ids-xp-add"><input type="number" id="xp-add-input-${c.id}" placeholder="Gain d'XP" data-char-id="${c.id}" data-xp-input data-enter-click="#xp-add-button-${c.id}" aria-label="Ajouter de l'expérience"><button id="xp-add-button-${c.id}" data-action="addXpDelta" data-id="${c.id}">Ajouter</button></div>
    ${ready ? `<button class="ids-levelup" data-action="identityLevelUp" data-id="${c.id}">Niveau ${(c.niveau || 1) + 1}<small>Garde ${xpCur - xpPalier} XP</small></button>` : ''}` : ''}
    ${STATE.isAdmin ? `<div class="ids-manual-level"><span>Niveau manuel</span><div>
      <button data-action="adjustIdentityLevel" data-id="${c.id}" data-delta="-1" aria-label="Baisser le niveau">−</button>
      <button class="ids-level-value" data-action="inlineEditNum" data-id="${c.id}" data-field="niveau" data-min="1" data-max="20" title="Saisir le niveau">${c.niveau || 1}</button>
      <button data-action="adjustIdentityLevel" data-id="${c.id}" data-delta="1" aria-label="Monter le niveau">+</button>
    </div></div>` : ''}
  </section>`;
}

function _identityVitalBreakdownHtml(c, canEdit) {
  const key = _identityStateFor(c).vitalBreakdown;
  if (!key) return '';
  const d = _computeCharCalculation({ dataset: { id: c.id, calc: key } });
  if (!d) return '';
  const shortLabel = key === 'pv' ? 'PV' : 'PM';
  return `<div class="ids-vital-detail" data-vital-detail="${key}">
    <div class="ids-vital-detail-head"><b>${shortLabel}<br>maximum</b><span>${_esc(d.identityFormula)}</span></div>
    <div class="ids-base-row"><span>${shortLabel} de base</span>${canEdit ? `<div>
      <button data-action="_adjVitalBase" data-id="${c.id}" data-field="${d.baseField}" data-delta="-1">−</button>
      <button class="ids-base-value" data-action="inlineEditNum" data-id="${c.id}" data-field="${d.baseField}" data-min="1" data-max="999">${d.baseValue}</button>
      <button data-action="_adjVitalBase" data-id="${c.id}" data-field="${d.baseField}" data-delta="1">+</button>
    </div>` : `<b>${d.baseValue}</b>`}</div>
    ${(d.identityItems || []).map(item => `<div class="ids-calc-row"><span>${_esc(item.label)}</span><b>${_esc(item.value)}</b></div>`).join('')}
    <div class="ids-vital-total"><span>Total</span><b>${_esc(String(d.result))}</b></div>
  </div>`;
}

function _buildSidebarHtml(c, canEdit, { pvCur, pvMax, pvPct, hpBarCls, pmCur, pmMax, pmPct, xpCur, xpPalier, xpPct, deckActifs, deckFree, deckMax }) {
  _identityStateFor(c);
  const owner = _characterOwnerMeta(c);
  const lifeStatus = _characterLifeStatus(c);
  const lifeStatusLabel = CHARACTER_LIFE_STATUSES[lifeStatus].label;
  const ready = xpPalier > 0 && xpCur >= xpPalier;
  const classRace = [c.classe, c.race].filter(Boolean).map(_esc).join(' · ') || 'Identité à compléter';
  const vital = (key, label, current, max, percent, barClass) => `<div class="ids-vital ${key}${percent < 25 ? ' danger' : ''}"${key === 'pv' ? ' id="vital-hp"' : ''}>
    <div class="ids-vital-head"><div class="ids-vital-value"><span>${label}</span>${canEdit ? `<button id="${key}-val" data-action="editVital" data-field="${key === 'pv' ? 'pvActuel' : 'pmActuel'}" data-id="${c.id}" title="Saisir la valeur exacte">${current}</button>` : `<b id="${key}-val">${current}</b>`}<em>/ ${max}</em>${key === 'pv' && percent < 25 ? '<mark>Critique</mark>' : ''}</div>${canEdit ? `<div class="ids-step"><button data-action="adjustStat" data-field="${key === 'pv' ? 'pvActuel' : 'pmActuel'}" data-delta="-1" data-id="${c.id}" aria-label="Retirer 1 ${label}">−</button><button data-action="adjustStat" data-field="${key === 'pv' ? 'pvActuel' : 'pmActuel'}" data-delta="1" data-id="${c.id}" aria-label="Ajouter 1 ${label}">＋</button></div>` : ''}</div>
    <div class="vital-bar ids-vital-bar"><div class="${barClass}" id="${key}-bar" style="width:${percent}%"></div></div>
    <div class="ids-vital-foot"><button data-action="toggleIdentityVitalBreakdown" data-calc="${key}" data-id="${c.id}">Base <b>${key === 'pv' ? (c.pvBase || 10) : (c.pmBase || 10)}</b> · calcul du max</button></div>
  </div>`;

  return `<aside class="id-side ids" id="cs-sidebar" data-aura="${c.auraColor ? 'custom' : (c.aura || 'blue')}">
    <div class="ids-top">
      ${STATE.isAdmin ? `<button class="ids-owner" data-action="reassignCharOwner" data-id="${c.id}" title="Réassigner ce personnage"><img src="${_esc(owner.avatar)}" alt=""><span>${_esc(owner.label)}</span></button>` : `<span class="ids-owner readonly" title="Propriétaire : ${_esc(owner.label)}"><img src="${_esc(owner.avatar)}" alt=""><span>${_esc(owner.label)}</span></span>`}
      ${canEdit ? `<div class="ids-tools"><button class="${c.isDefault ? 'on' : ''}" data-action="_setDefaultCharacter" data-id="${c.id}" title="Personnage favori">${c.isDefault ? '★' : '☆'}</button><button data-action="openCharExportMenu" data-id="${c.id}" title="Exporter">⇩</button><button class="danger" data-action="deleteChar" data-id="${c.id}" title="Supprimer">⌫</button></div>` : ''}
    </div>

    <div class="ids-hero">
      <div class="ids-portrait${ready ? ' is-ready' : ''}${lifeStatus === 'dead' ? ' is-dead' : ''}">
        <svg viewBox="0 0 144 144" aria-label="${xpPct}% d'expérience"><circle class="ids-ring-bg" cx="72" cy="72" r="65"></circle><circle class="ids-ring" cx="72" cy="72" r="65" pathLength="100" stroke-dasharray="${xpPct} ${Math.max(0, 100 - xpPct)}"></circle></svg>
        ${canEdit
          ? `<button type="button" class="ids-portrait-in is-clickable" data-action="open-character-photo" data-charid="${c.id}" data-character-photo-drop="${c.id}" title="Cliquer ou déposer une image" aria-label="Changer le portrait de ${_esc(c.nom || 'ce personnage')}">${characterPortraitContent(c, { fallbackTag: 'span' })}<span class="ids-portrait-hover">${c.photo ? 'Changer' : 'Ajouter'} la photo</span></button>`
          : `<div class="ids-portrait-in">${characterPortraitContent(c, { fallbackTag: 'span' })}</div>`}
        ${canEdit ? `<button class="ids-portrait-edit ids-aura-button" style="--dot-c:${_auraHex(c)}" data-action="toggleIdentityPopover" data-popover="aura" data-id="${c.id}" title="Aura du personnage" aria-label="Modifier l'aura"></button>` : ''}
      </div>
      <button class="ids-level${ready ? ' is-ready' : ''}" data-action="toggleIdentityPopover" data-popover="xp" data-id="${c.id}" title="Expérience et niveau"><small>NIV.</small><b>${c.niveau || 1}</b></button>
      <div class="ids-copy">
        ${canEdit
          ? `<input class="ids-inline ids-name" data-change="identityInlineCommit" data-id="${c.id}" data-field="nom" data-original="${_esc(c.nom || '')}" value="${_esc(c.nom || '')}" maxlength="80" placeholder="Nom du personnage" aria-label="Nom du personnage" autocomplete="off">
            <div class="ids-sub"><input class="ids-inline" data-change="identityInlineCommit" data-id="${c.id}" data-field="classe" data-original="${_esc(c.classe || '')}" value="${_esc(c.classe || '')}" maxlength="60" placeholder="Classe" aria-label="Classe" autocomplete="off"><span>·</span><input class="ids-inline" data-change="identityInlineCommit" data-id="${c.id}" data-field="race" data-original="${_esc(c.race || '')}" value="${_esc(c.race || '')}" maxlength="60" placeholder="Race" aria-label="Race" autocomplete="off"></div>`
          : `<h2>${_esc(c.nom || 'Sans nom')}</h2><p>${classRace}</p>`}
        ${canEdit ? `<button type="button" class="ids-life is-${lifeStatus}" data-action="toggleIdentityPopover" data-popover="status" data-id="${c.id}" title="Modifier l’état du personnage" aria-label="État : ${lifeStatusLabel}. Modifier">
          <i aria-hidden="true"></i>
          <span>${lifeStatusLabel}</span>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5l3-3"/></svg>
        </button>` : `<span class="ids-life is-${lifeStatus}" title="État du personnage"><i aria-hidden="true"></i><span>${lifeStatusLabel}</span></span>`}
        ${_characterTitlesHtml(c, canEdit)}
        <button class="ids-xp-line${ready ? ' ready' : ''}" data-action="toggleIdentityPopover" data-popover="xp" data-id="${c.id}">${ready ? `<b>Niveau ${(c.niveau || 1) + 1} prêt</b><span>· gérer</span>` : `<b>${_identityNumber(xpCur)}</b><span>/ ${_identityNumber(xpPalier)} XP · encore ${_identityNumber(Math.max(0, xpPalier - xpCur))}</span>`}</button>
      </div>
    </div>

    ${_buildBuildSwitcherHtml(c, canEdit)}

    <section class="ids-section ids-vitals">
      ${vital('pv', 'PV', pvCur, pvMax, pvPct, hpBarCls)}
      ${vital('pm', 'PM', pmCur, pmMax, pmPct, 'vital-bar-fill')}
      ${_identityVitalBreakdownHtml(c, canEdit)}
    </section>

    <section class="ids-section">
      <div class="ids-facts">
        <button data-action="toggleCharDerivative" data-calc="ca" data-id="${c.id}"><b>${calcCA(c)}</b><span>CA</span></button>
        <button data-action="toggleCharDerivative" data-calc="speed" data-id="${c.id}"><b>${calcVitesse(c)}<small>m</small></b><span>Vitesse</span></button>
        <button data-action="toggleCharDerivative" data-calc="deck" data-id="${c.id}" title="${deckFree ? `${deckFree} sort${deckFree > 1 ? 's' : ''} toujours prêt${deckFree > 1 ? 's' : ''}` : ''}"><b>${deckActifs}<small>/${deckMax}</small></b><span>Deck</span></button>
        <button data-action="toggleCharDerivative" data-calc="or" data-id="${c.id}"><b class="or-card-amount">${calcOr(c)}</b><span>Or</span></button>
      </div>
      <div class="brk cs-brk ids-breakdown" id="cs-brk-panel"></div>
    </section>
  </aside>`;
}

function _buildBuildSwitcherHtml(c, canEdit) {
  const { builds, activeBuildId } = normalizeCharacterBuilds(c);
  const active = builds.find(b => b.id === activeBuildId) || builds[0];
  if (!canEdit && builds.length <= 1) return '';
  const menuOpen = _identityStateFor(c).popover === 'builds';
  return `<div class="ids-build${menuOpen ? ' is-open' : ''}" title="${_esc(`${active?.name || 'Principal'} modifie image, équipement, stats et bases PV/PM.`)}">
    <span>Build</span>
    <select data-change="switchCharacterBuild" data-id="${c.id}" ${canEdit ? '' : 'disabled'}>
      ${builds.map(b => `<option value="${_esc(b.id)}" ${b.id === activeBuildId ? 'selected' : ''}>${_esc(b.name || 'Build')}</option>`).join('')}
    </select>
    <em>${builds.length}</em>
    ${canEdit ? `<button type="button" class="ids-build-more${menuOpen ? ' is-open' : ''}" data-action="toggleIdentityPopover" data-popover="builds" data-id="${c.id}" title="Gérer les builds" aria-label="Gérer les builds" aria-expanded="${menuOpen}">⚙</button>` : ''}
  </div>`;
}

function _buildBuildManagerHtml(c) {
  const { builds, activeBuildId } = normalizeCharacterBuilds(c);
  return `<section class="ids-pop ids-pop-builds" role="dialog" aria-label="Gestion des builds">
    <header><div><b>Builds</b><small>${builds.length} configuration${builds.length > 1 ? 's' : ''}</small></div><button data-action="closeIdentityPopover" aria-label="Fermer">×</button></header>
    <p>Le build actif définit le portrait, l’équipement et les statistiques de base.</p>
    <div class="ids-build-options">
      ${builds.map((build, index) => {
        const isActive = build.id === activeBuildId;
        const name = build.name || `Build ${index + 1}`;
        return `<div class="ids-build-option${isActive ? ' is-active' : ''}">
          <button class="ids-build-activate" data-action="switchCharacterBuild" data-id="${c.id}" data-build-id="${_esc(build.id)}" ${isActive ? 'disabled' : ''} title="${isActive ? 'Build actif' : 'Activer ce build'}" aria-label="${isActive ? 'Build actif' : `Activer ${_esc(name)}`}">${isActive ? '✓' : ''}</button>
          <label><input value="${_esc(name)}" data-build-name="${_esc(build.id)}" maxlength="32" aria-label="Nom du build">${isActive ? '<small>Actif</small>' : ''}</label>
          <button class="ids-build-save" data-action="renameCharacterBuild" data-id="${c.id}" data-build-id="${_esc(build.id)}" title="Enregistrer le nom" aria-label="Enregistrer le nom">✓</button>
          <button class="ids-build-delete" data-action="deleteCharacterBuild" data-id="${c.id}" data-build-id="${_esc(build.id)}" ${builds.length <= 1 ? 'disabled' : ''} title="${builds.length <= 1 ? 'Le dernier build ne peut pas être supprimé' : 'Supprimer ce build'}" aria-label="Supprimer ce build">×</button>
        </div>`;
      }).join('')}
    </div>
    <button class="ids-build-create" data-action="createCharacterBuild" data-id="${c.id}"><b>+</b><span>Nouveau build<small>Copie la configuration actuelle</small></span></button>
  </section>`;
}

function _buildMainColHtml(canEdit, { tilesHtml, tabsHtml, lvlPointsRemaining, v3Tab }) {
  return `<section class="main-col">

    <!-- Stats banner 6 tuiles -->
    <div class="stats-banner" id="cs-stats-banner">
      ${tilesHtml}
    </div>

    ${lvlPointsRemaining > 0 && canEdit ? `
    <div class="alloc-banner">
      <span>🎯 <b>${lvlPointsRemaining}</b> point${lvlPointsRemaining>1?'s':''} de niveau à dépenser — cliquez sur une caractéristique</span>
      <span class="alloc-banner-hint">Modificateur recalculé instantanément</span>
    </div>` : ''}

    <div id="char-tab-content" class="tab-body-v3" role="tabpanel" tabindex="0" aria-labelledby="cs-tab-${v3Tab}"></div>

  </section>`;
}

function _characterTitlesHtml(c, canEdit, values = c.titres) {
  const titres = Array.isArray(values) ? values : [];
  if (!titres.length && !canEdit) return '';
  if (!canEdit) return `<div class="ids-titles">${titres.map(_esc).join('<span aria-hidden="true"> · </span>')}</div>`;
  return `<div class="ids-title-editor ids-titles">
    <div class="ids-title-list" id="identity-title-list-${_esc(c.id)}">
      ${titres.map((titre, index) => `<div class="ids-title-item">
        <span class="ids-title-handle" title="Glisser pour réordonner" aria-hidden="true">⠿</span>
        <input class="ids-inline" data-change="identityTitleCommit" data-id="${c.id}" data-identity-title data-index="${index}" data-original="${_esc(titre)}" value="${_esc(titre)}" maxlength="80" aria-label="Titre ${index + 1}">
        <button data-action="identityRemoveTitle" data-id="${c.id}" data-index="${index}" title="Retirer ce titre" aria-label="Retirer ce titre">×</button>
      </div>`).join('')}
    </div>
    <input class="ids-inline ids-title-new" id="identity-title-new-${_esc(c.id)}" data-change="identityAddTitle" data-id="${c.id}" placeholder="+ titre" maxlength="80" aria-label="Ajouter un titre">
  </div>`;
}

let _characterTitlesSortable = null;

function _initCharacterTitlesSortable(c) {
  const host = document.getElementById(`identity-title-list-${c.id}`);
  if (!host) return;
  try { _characterTitlesSortable?.destroy(); } catch {}
  _characterTitlesSortable = makeSortable(host, {
    prefix: 'char-title',
    draggable: '.ids-title-item',
    handle: '.ids-title-handle',
    fallbackOnBody: false,
    onEnd: async () => {
      const titres = [...host.querySelectorAll('[data-identity-title]')]
        .map(input => input.value.trim()).filter(Boolean);
      c.titres = titres;
      try {
        await updateInCol('characters', c.id, { titres });
        _rerenderIdentity(c);
      } catch (error) {
        notifySaveError(error);
        renderCharSheet(c, charSession.getCurrentCharTab() || 'combat');
      }
    },
  });
}

function _rerenderIdentity(c, focusSelector = '') {
  const current = document.getElementById('cs-sidebar');
  if (!current) { renderCharSheet(c, charSession.getCurrentCharTab() || 'combat'); return; }
  const scrollTop = current.scrollTop || 0;
  const pvMax = calcPVMax(c);
  const pmMax = calcPMMax(c);
  const pvCur = c.hp ?? c.pvActuel ?? pvMax;
  const pmCur = c.pmActuel ?? c.pm ?? pmMax;
  const pvPct = pct(pvCur, pvMax);
  const pmPct = pct(pmCur, pmMax);
  const xpCur = c.exp || 0;
  const xpPalier = calcPalier(c.niveau || 1);
  const deckUsage = getDeckUsage(c.deck_sorts);
  const wrap = document.createElement('div');
  wrap.innerHTML = _buildSidebarHtml(c, canControlCharacter(c), {
    pvCur, pvMax, pvPct,
    hpBarCls: pvPct < 25 ? 'vital-bar-fill low' : pvPct < 50 ? 'vital-bar-fill mid' : 'vital-bar-fill',
    pmCur, pmMax, pmPct,
    xpCur, xpPalier, xpPct: pct(xpCur, xpPalier),
    deckActifs: deckUsage.used,
    deckFree: deckUsage.free,
    deckMax: calcDeckMax(c),
  });
  const next = wrap.firstElementChild;
  current.replaceWith(next);
  if (canControlCharacter(c)) _initCharacterTitlesSortable(c);
  requestAnimationFrame(() => {
    const side = document.getElementById('cs-sidebar');
    if (side) side.scrollTop = scrollTop;
    if (focusSelector) {
      const field = side?.querySelector(focusSelector) || document.querySelector(focusSelector);
      field?.focus();
      field?.select?.();
    }
  });
}

function _removeIdentityPopover() {
  document.getElementById('identity-popover-layer')?.remove();
}

function _toggleIdentityPopover(btn) {
  const c = getCharacterById(btn.dataset.id) || charSession.getCurrentChar();
  if (!c) return;
  const ui = _identityStateFor(c);
  ui.popover = ui.popover === btn.dataset.popover ? null : btn.dataset.popover;
  const side = document.getElementById('cs-sidebar');
  _removeIdentityPopover();
  if (!ui.popover || !side) return;
  const xpCur = c.exp || 0;
  const xpPalier = calcPalier(c.niveau || 1);
  const layer = document.createElement('div');
  layer.id = 'identity-popover-layer';
  layer.className = 'cs-v3 ids-pop-layer';
  layer.setAttribute('style', _auraStyleVars(c));
  layer.innerHTML = _identityPopoverHtml(c, canControlCharacter(c), {
    xpCur,
    xpPalier,
    xpPct: pct(xpCur, xpPalier),
  });
  document.body.appendChild(layer);
  requestAnimationFrame(() => {
    const popover = layer.querySelector('.ids-pop');
    if (!popover) return;
    const anchor = ui.popover === 'aura'
      ? side.querySelector('.ids-aura-button') || btn
      : ui.popover === 'status'
        ? side.querySelector('.ids-life') || btn
      : ui.popover === 'builds'
        ? side.querySelector('.ids-build') || btn
        : side.querySelector('.ids-hero') || btn;
    const rect = anchor.getBoundingClientRect();
    const halfWidth = popover.offsetWidth / 2;
    const left = Math.max(halfWidth + 12, Math.min(window.innerWidth - halfWidth - 12, rect.left + rect.width / 2 + 10));
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(rect.bottom + 8)}px`;
    if (ui.popover === 'xp') layer.querySelector(`#xp-add-input-${CSS.escape(c.id)}`)?.focus({ preventScroll: true });
  });
}

async function _openCharacterPortraitViewer(btn) {
  const c = getCharacterById(btn.dataset.id) || charSession.getCurrentChar();
  if (!c?.photo) return;
  const src = await characterOriginalPhotoFor(c);
  openImageLightbox({
    src,
    alt: `Portrait complet de ${c.nom || 'ce personnage'}`,
  });
}

function _identityFieldSaved(input) {
  input.classList.add('is-saved');
  setTimeout(() => input.isConnected && input.classList.remove('is-saved'), 900);
}

async function _identityInlineCommit(input) {
  const c = getCharacterById(input.dataset.id);
  const field = input.dataset.field;
  if (!c || !canControlCharacter(c) || !['nom', 'classe', 'race'].includes(field)) return;
  const previous = input.dataset.original ?? String(c[field] || '');
  const next = input.value.trim();
  if (field === 'nom' && !next) { input.value = previous; return; }
  if (next === previous) return;
  c[field] = next;
  input.value = next;
  input.dataset.original = next;
  try {
    await updateInCol('characters', c.id, { [field]: next });
    _identityFieldSaved(input);
    if (field === 'nom') {
      document.querySelectorAll(`#char-pills .char-pill[data-charid="${CSS.escape(c.id)}"] .char-pill-name`).forEach(el => { el.textContent = next; });
    }
  } catch (error) {
    c[field] = previous;
    input.value = previous;
    input.dataset.original = previous;
    notifySaveError(error);
  }
}

async function _identityTitleCommit(input) {
  const c = getCharacterById(input.dataset.id);
  if (!c || !canControlCharacter(c)) return;
  const index = Number(input.dataset.index);
  const previousTitles = [...(c.titres || [])];
  const next = input.value.trim();
  if (!next) {
    c.titres.splice(index, 1);
    try { await updateInCol('characters', c.id, { titres: c.titres }); }
    catch (error) { c.titres = previousTitles; notifySaveError(error); }
    _rerenderIdentity(c);
    return;
  }
  if (next === previousTitles[index]) return;
  c.titres[index] = next;
  input.value = next;
  input.dataset.original = next;
  try {
    await updateInCol('characters', c.id, { titres: c.titres });
    _identityFieldSaved(input);
  } catch (error) {
    c.titres = previousTitles;
    input.value = previousTitles[index] || '';
    input.dataset.original = input.value;
    notifySaveError(error);
  }
}

async function _identityAddTitle(input) {
  const c = getCharacterById(input.dataset.id) || charSession.getCurrentChar();
  const title = input.value.trim();
  if (!c || !canControlCharacter(c) || !title) return;
  if ((c.titres || []).some(item => _norm(item) === _norm(title))) { input.select(); return; }
  const previousTitles = [...(c.titres || [])];
  c.titres = [...previousTitles, title];
  try {
    await updateInCol('characters', c.id, { titres: c.titres });
    _rerenderIdentity(c, `#identity-title-new-${CSS.escape(c.id)}`);
  } catch (error) {
    c.titres = previousTitles;
    notifySaveError(error);
  }
}

async function _identityRemoveTitle(btn) {
  const c = getCharacterById(btn.dataset.id) || charSession.getCurrentChar();
  if (!c || !canControlCharacter(c)) return;
  const previousTitles = [...(c.titres || [])];
  c.titres = previousTitles.filter((_, index) => index !== Number(btn.dataset.index));
  try { await updateInCol('characters', c.id, { titres: c.titres }); }
  catch (error) { c.titres = previousTitles; notifySaveError(error); }
  _rerenderIdentity(c);
}

function _toggleIdentityVitalBreakdown(btn) {
  const c = getCharacterById(btn.dataset.id) || charSession.getCurrentChar();
  if (!c) return;
  const ui = _identityStateFor(c);
  ui.vitalBreakdown = ui.vitalBreakdown === btn.dataset.calc ? null : btn.dataset.calc;
  _rerenderIdentity(c);
}

async function _setCharacterLifeStatus(el) {
  const c = getCharacterById(el.dataset.id) || charSession.getCurrentChar();
  if (!c || !canControlCharacter(c)) return;
  const next = CHARACTER_LIFE_STATUSES[el.dataset.status] ? el.dataset.status : 'alive';
  const previous = _characterLifeStatus(c);
  if (next === previous) return;
  c.lifeStatus = next;
  _identityUi.popover = null;
  _removeIdentityPopover();
  _rerenderIdentity(c);
  try {
    await updateInCol('characters', c.id, { lifeStatus: next });
  } catch (error) {
    c.lifeStatus = previous;
    _rerenderIdentity(c);
    notifySaveError(error);
  }
}

function _closeIdentityPopover() {
  const c = charSession.getCurrentChar();
  if (!c) return;
  _identityStateFor(c).popover = null;
  _removeIdentityPopover();
}

async function _adjustIdentityLevel(btn) {
  const c = getCharacterById(btn.dataset.id);
  if (!c || !STATE.isAdmin) return;
  const next = Math.max(1, Math.min(20, (Number(c.niveau) || 1) + Number(btn.dataset.delta || 0)));
  if (next === Number(c.niveau || 1)) return;
  const previous = c.niveau;
  c.niveau = next;
  try {
    await updateInCol('characters', c.id, { niveau: next });
  } catch (error) {
    c.niveau = previous;
    notifySaveError(error);
  }
  renderCharSheet(c, charSession.getCurrentCharTab() || 'combat');
}

async function _identityLevelUp(btn) {
  _identityUi.popover = null;
  await levelUpChar(btn.dataset.id);
}

function renderCharSheet(c, keepTab) {
  _identityUi.popover = null;
  _removeIdentityPopover();
  const area = document.getElementById('char-sheet-area');
  if (!area) return;
  clearSpellHost();   // fiche perso affichée → moteur de sorts sur STATE.activeChar (annule un éventuel override PNJ)
  if (c?.id) recordRecentNavigation({ type: 'character', id: c.id, title: c.nom || '' });
  const previousCharId = charSession.getCurrentChar()?.id;
  const sheetViewContext = previousCharId === c?.id
    ? captureViewContext(area, { includeWindow: true, includeFocus: true })
    : null;
  applyActiveBuild(c);
  const canEdit = canControlCharacter(c);

  const v3Tab = _resolveV3Tab(keepTab || charSession.getCurrentCharTab() || 'combat');
  // Source unique : le perso rendu EST le perso actif et celui que relit
  // charSession.getCurrentChar(). Sans ça, une édition qui mute STATE.activeChar
  // et un re-render qui relit getCurrentChar() divergeaient → « faut refresh ».
  STATE.activeChar = c;
  charSession.set(c, canEdit, v3Tab);
  _currentTopTab = v3Tab;
  setRouteSub('characters', _characterRouteSub(c.id, v3Tab));

  // ── Valeurs dérivées ──────────────────────────
  const pvMax  = calcPVMax(c), pmMax = calcPMMax(c);
  // PV/PM courants connectés au VTT : le VTT écrit `hp` (PV) et `pm` (PM) sur le
  // doc perso → on les lit en priorité pour refléter les dégâts/soins du VTT.
  const pvCur  = c.hp ?? c.pvActuel ?? pvMax, pmCur = c.pmActuel ?? c.pm ?? pmMax;
  const pvPct  = pct(pvCur, pvMax), pmPct = pct(pmCur, pmMax);
  const xpCur  = c.exp || 0, xpPalier = calcPalier(c.niveau || 1), xpPct = pct(xpCur, xpPalier);
  const deckUsage  = getDeckUsage(c.deck_sorts);
  const deckActifs = deckUsage.used;
  const deckFree   = deckUsage.free;
  const deckMax    = calcDeckMax(c);
  const hpBarCls   = pvPct < 25 ? 'vital-bar-fill low' : pvPct < 50 ? 'vital-bar-fill mid' : 'vital-bar-fill';

  // ── Points de niveau restants ──────────────────
  const _lvlEarned = Math.max(0, (c.niveau||1) - 1);
  const _lvlSpent  = ['force','dexterite','intelligence','constitution','sagesse','charisme']
    .reduce((s,k) => s + (parseInt((c.statsLevelUps||{})[k])||0), 0);
  const lvlPointsRemaining = _lvlEarned - _lvlSpent;

  // ── Sous-composants HTML ───────────────────────
  const charSwitchHtml = _buildCharSwitchHtml(c.id, canEdit);
  const tilesHtml      = _buildStatTilesHtml(c, canEdit, lvlPointsRemaining);
  const tabsHtml       = _buildTabsHtml(c, v3Tab);

  _identityStateFor(c);
  const sidebarHtml = _buildSidebarHtml(c, canEdit, { pvCur, pvMax, pvPct, hpBarCls, pmCur, pmMax, pmPct, xpCur, xpPalier, xpPct, deckActifs, deckFree, deckMax });
  const mainColHtml = _buildMainColHtml(canEdit, { tilesHtml, tabsHtml, lvlPointsRemaining, v3Tab });

  area.innerHTML = `<div class="cs-v3" style="${_auraStyleVars(c)}">
  <div class="cs-top">
    <div class="cs-top-in">
      <div class="cs-top-row">
        <div class="cs-brand"><h1>Personnage</h1>${STATE.adventure?.nom ? `<small>${_esc(STATE.adventure.nom)}</small>` : ''}</div>
        <span class="cs-top-spacer"></span>
        ${charSwitchHtml}
      </div>
      <nav class="tabs-v3" id="char-tabs-v3" role="tablist" aria-label="Sections de la fiche personnage">
        ${tabsHtml}
      </nav>
    </div>
  </div>
  <div class="app-shell">
    <div class="sheet">
      ${sidebarHtml}
      ${mainColHtml}
    </div>
  </div>
</div>`;

  if (canEdit) _initCharacterTitlesSortable(c);

  _renderTabV3(v3Tab, c, canEdit);

  restoreViewContextAfterRender(area, sheetViewContext, {
    includeWindow: true,
    includeFocus: true,
    shouldRestore: () => charSession.getCurrentChar()?.id === c.id,
  });
}


function _renderTab(leafTab, c, canEdit) {
  // Legacy router — devient un proxy vers V3.
  _renderTabV3(_resolveV3Tab(leafTab), c, canEdit);
}

// ══════════════════════════════════════════════════════════════════════════════
// V3 — Tab router (6 onglets)
// ══════════════════════════════════════════════════════════════════════════════
function _renderTabV3(tab, c, canEdit) {
  const area = document.getElementById('char-tab-content');
  if (!area) return;
  const samePanel = area.dataset.renderedTab === tab && area.dataset.renderedCharId === String(c?.id || '');
  const viewContext = samePanel
    ? captureViewContext(area, { includeFocus: true })
    : null;
  const savedScroll = samePanel ? _readTabScroll(area) : null;
  if (samePanel && savedScroll > 0 && c?.id) _scrollByTab.set(_scrollKey(c.id, tab), savedScroll);
  const sub = getCurrentJournalSub() || 'notes';
  const renders = {
    combat:    () => renderCharCombatV3(c, canEdit),
    capacites: () => renderCharCapacites(c, canEdit),
    sorts:     () => renderCharDeck(c, canEdit),
    inv:     () => renderCharInventaire(c, canEdit),
    compte:  () => renderCharLedger(c, canEdit),
    journal: () => renderCharJournal(c, canEdit, sub),
    profil:  () => renderCharProfilV3(c, canEdit),
  };
  area.innerHTML = renders[tab]?.() || '';
  area.dataset.renderedTab = tab;
  area.dataset.renderedCharId = c?.id || '';
  if (!samePanel) {
    area.classList.remove('cs-tab-fadein');
    void area.offsetWidth;
    area.classList.add('cs-tab-fadein');
  }
  if (tab === 'profil') {
    bindCharProfilV3(area);
  }
  if (tab === 'journal' && sub === 'notes') { bindQuillEditors(area, { onUserEdit: scheduleNoteAutosave }); _bindNotesDnd(c, canEdit); }
  if (tab === 'journal' && sub === 'quetes') _bindQuetesDnd(c, canEdit);
  if (tab === 'sorts') { _bindSortsCatDrag(c, canEdit); bindSortCardsDnd(c, canEdit); }
  if (tab === 'inv' && !isInventoryCatalogReady() && !_inventoryCatalogRefreshQueued) {
    _inventoryCatalogRefreshQueued = true;
    ensureInventoryCatalog().finally(() => {
      _inventoryCatalogRefreshQueued = false;
      if (charSession.getCurrentChar()?.id === c.id && charSession.getCurrentCharTab() === 'inv') {
        _renderTabV3('inv', c, canEdit);
      }
    });
  }
  restoreViewContextAfterRender(area, viewContext, {
    includeFocus: true,
    shouldRestore: () => (
      charSession.getCurrentChar()?.id === c.id
      && charSession.getCurrentCharTab() === tab
    ),
  });
  if (samePanel && savedScroll != null) _restoreTabScroll(savedScroll);
}

// ── Drag & drop des catégories de sorts (Sortable.esm.js) ──────────────────
let _sortsCatSortable = null;
function _bindSortsCatDrag(c, canEdit) {
  // Détruit le précédent Sortable s'il existe (évite les leaks au re-render)
  try { _sortsCatSortable?.destroy(); } catch {}
  _sortsCatSortable = null;
  if (!canEdit) return;
  const wrap = document.getElementById('cs-sort-cats-wrap');
  if (!wrap) return;

  _sortsCatSortable = makeSortable(wrap, {
    prefix: 'cs',
    handle: '.cs-sort-cat-drag',
    draggable: '.cs-sort-cat-block:not(.is-default)',
    delay: 80,
    // Garde le clone de drag dans .cs-v3 (CSS scopé) → rendu correct pendant le drag.
    fallbackOnBody: false,
    onEnd: async () => {
      // Reconstitue l'ordre des cat IDs depuis le DOM (en excluant le bloc __none)
      const newOrderIds = [...wrap.querySelectorAll('.cs-sort-cat-block:not(.is-default)')]
        .map(el => el.dataset.catId)
        .filter(Boolean);
      const currentCats = c.sort_cats || [];
      // Reconstruit le tableau cats dans le nouvel ordre
      const reordered = newOrderIds
        .map(id => currentCats.find(cat => cat.id === id))
        .filter(Boolean);
      // Concatène les éventuelles catégories non présentes dans le DOM (sécurité)
      currentCats.forEach(cat => {
        if (!reordered.find(x => x.id === cat.id)) reordered.push(cat);
      });
      if (JSON.stringify(reordered) === JSON.stringify(currentCats)) return;
      c.sort_cats = reordered;
      try { await updateInCol('characters', c.id, { sort_cats: reordered }); }
      catch (e) { console.warn('[sort cats reorder]', e); }
    },
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// V3 — COMBAT (.weap-card / .armor-card / .cstyle / .elem-chip / .mait-card)
// Renderer compact qui réutilise les helpers data.js (getMainWeapon, traits,
// détection de style, etc.) et préserve les actions existantes (editEquipSlot).
// ══════════════════════════════════════════════════════════════════════════════
// Helper partagé : retourne la liste de badges des bonus offerts par un item
// (stats principales + dérivés PV/PM/Vit./Init.). Utilisé par les armes
// équipées, les armures et l'inventaire pour une présentation cohérente.
const _ITEM_STAT_LABELS = {
  force: 'FOR', dexterite: 'DEX', intelligence: 'INT',
  constitution: 'CON', sagesse: 'SAG', charisme: 'CHA',
};
const _ITEM_DERIVED_LABELS = {
  pvMaxBonus: 'PV', pmMaxBonus: 'PM',
  vitesseBonus: 'Vit.', initiativeBonus: 'Init.',
};
const _ITEM_DERIVED_TONES = {
  pvMaxBonus: 'derived-tone derived-pv',
  pmMaxBonus: 'derived-tone derived-pm',
  vitesseBonus: 'derived-tone derived-speed',
  initiativeBonus: 'derived-tone derived-init',
};
// Bump une valeur de bonus dérivé par le palier d'amélioration Artisan
// (cohérent avec _bumpBonus de char-stats.js : ne bump que les valeurs positives).
function _bumpDerived(val, item) {
  if (!Number.isFinite(val) || val <= 0) return val;
  const up = parseInt(item?.upgrades?.effectBonus);
  if (Number.isFinite(up) && up > 0) return val + up;
  return val;
}
function _itemBonusBadges(it = {}) {
  const out = [];
  // Stats : items utilisent les codes courts (fo/dex/in/sa/co/ch + alias 'for').
  // getItemStatBonus gère tous les alias ET les upgrades (upgrades.statBonus).
  Object.entries(_ITEM_STAT_LABELS).forEach(([fullKey, lbl]) => {
    let b = 0;
    try { b = getItemStatBonus(it, fullKey); } catch {}
    if (b) out.push({ lbl: `${lbl} ${b>0?'+':''}${b}`, cls: `stat-tone stat-${fullKey}` });
  });
  // Dérivés : applique le palier Artisan (upgrades.effectBonus) sur les positifs.
  Object.entries(_ITEM_DERIVED_LABELS).forEach(([k, lbl]) => {
    const v = _bumpDerived(parseInt(it[k]) || 0, it);
    if (!v) return;
    out.push({ lbl: `${lbl} ${v>0?'+':''}${v}`, cls: _ITEM_DERIVED_TONES[k] });
  });
  return out;
}

function renderCharCombatV3(c, canEdit) {
  const mj = canEdit && STATE.isAdmin;
  const equip = c.equipement || {};
  const inventory = Array.isArray(c.inventaire) ? c.inventaire : [];
  const slotDefs = getEquipmentSlots();
  const weaponSlots = slotDefs.filter(slot => slot.kind === 'weapon');
  const armorSlots = slotDefs.filter(slot => slot.kind !== 'weapon');
  const primarySlot = getPrimaryWeaponSlotId();
  const secondarySlot = getSecondaryWeaponSlotId();
  const equippedInvMap = (() => { try { return getEquippedInventoryIndexMap?.(c) || new Map(); } catch { return new Map(); } })();
  const sourceItem = (slot, fallback = {}) => {
    const index = [...equippedInvMap.entries()].find(([, slots]) => slots.includes(slot))?.[0];
    return Number.isInteger(index) ? (inventory[index] || fallback) : fallback;
  };
  const currentItem = slot => {
    const raw = equip[slot] || {};
    if (slot === primarySlot && !raw.nom && !equip[secondarySlot]?.nom) { try { return getMainWeapon(c) || raw; } catch { return raw; } }
    return raw;
  };
  const rarityOf = (slot, item) => {
    const live = sourceItem(slot, item);
    const level = parseInt(live?.rarete ?? item?.rarete) || 0;
    return { level, label: RARETE_NAMES[level] || '', color: (level >= 2 && RARETE_NAMES[level]) ? (_rareteColor(RARETE_NAMES[level]) || '#7a8fa8') : '' };
  };
  const notable = lvl => lvl >= 2 && !!RARETE_NAMES[lvl];
  const gem = lvl => notable(lvl) ? `<i class="cb-gem" style="--rc:${_rareteColor(RARETE_NAMES[lvl]) || '#7a8fa8'}"></i>` : '';
  const nm = (name, lvl) => `<span class="cb-nm">${gem(lvl)}<b class="${notable(lvl) ? 'r' : ''}" style="--rc:${notable(lvl) ? _rareteColor(RARETE_NAMES[lvl]) : 'inherit'}">${_esc(name)}</b></span>`;
  const family = item => item?.typeArme || item?.sousType || item?.format || '';
  const plainStyleName = style => String(style?.label || style?.name || 'Sans style').replace(/^[^\p{L}\p{N}]+/u, '').trim() || 'Sans style';

  if (_combatTabUi.charId !== String(c.id || '')) _combatTabUi = { charId: String(c.id || ''), open: null };
  const open = _combatTabUi.open;

  if (!_combatTabCache.styles) { loadCombatStyles().then(styles => { _combatTabCache.styles = styles || []; if (charSession.getCurrentChar()?.id === c.id && charSession.getCurrentCharTab() === 'combat') _renderTabV3('combat', c, canEdit); }).catch(() => { _combatTabCache.styles = []; }); }
  if (!_combatTabCache.dmgTypes) { loadDamageTypes().then(types => { _combatTabCache.dmgTypes = types || []; if (charSession.getCurrentChar()?.id === c.id && charSession.getCurrentCharTab() === 'combat') _renderTabV3('combat', c, canEdit); }).catch(() => { _combatTabCache.dmgTypes = []; }); }
  const styles = _combatTabCache.styles || [];
  const damageTypes = _combatTabCache.dmgTypes || [];
  const damageContextFor = item => resolveWeaponDamageContext(_weaponFormats || [], damageTypes, item || {}, c.elements || []);
  const missRuleFor = context => {
    const rules = getDamageTypeRules(damageTypes, context.damageTypeId || 'physique');
    const effect = getAttackMissEffect({ damageTypeId: context.damageTypeId, isMagicWeapon: context.isMagic, typeRules: rules }, damageTypes);
    return effect === 'half' ? { tone: 'arc', label: '½ dégâts' } : { tone: 'muted', label: '0 dégât' };
  };
  let activeStyle = null; try { activeStyle = detectCombatStyle?.(c, styles); } catch {}
  const styleColor = activeStyle?.couleur || activeStyle?.color || '#7a8fa8';
  const styleName = activeStyle ? plainStyleName(activeStyle) : 'Aucun style';
  const styleRules = activeStyle ? combatStyleRuleLabels(activeStyle) : [];
  const ruleTone = t => ({ reaction: 'pos', positive: 'pos', warning: 'warn', arcane: 'arc', muted: 'muted' }[t] || 'muted');
  const statKeyOf = item => item?.statAttaque === 'dexterite' ? 'dexterite' : item?.statAttaque === 'intelligence' ? 'intelligence' : (item?.statAttaque || item?.toucherStat || 'force');
  const toucherOf = item => { try { return item?.nom ? getWeaponToucherParts(c, item, statKeyOf(item)) : null; } catch { return null; } };
  const degatsOf = item => { try { return item?.nom ? getWeaponDegatsParts(c, item, statKeyOf(item)) : null; } catch { return null; } };

  const calc = (rows, total) => `<div class="cb-calc">${rows.filter(Boolean).map(r => `<div><span>${_esc(r[0])}</span><b>${_esc(r[1])}</b></div>`).join('')}<div class="tot"><span>Total</span><b>${_esc(total)}</b></div></div>`;
  const chips = (vals, cls = '') => vals?.length ? `<div class="cb-chips">${vals.map(v => `<span class="${cls}">${_esc(v)}</span>`).join('')}</div>` : '';
  const extras = item => {
    const bonus = _itemBonusBadges(item).map(b => b.lbl);
    const traits = _getTraits(item) || [];
    const part = item.particularite || (getItemEffectText(item) && degatsOf(item) ? '' : '');
    return `${bonus.length || traits.length ? `<div class="cb-sec"><h5>Bonus et traits</h5>${chips(bonus, 'st')}${chips(traits)}</div>` : ''}${item.particularite ? `<div class="cb-sec"><h5>Particularité</h5><p class="edito">${_esc(item.particularite)}</p></div>` : ''}`;
  };

  // Aperçu d'un changement d'arme : nouveau jet + changement de style + objet rangé.
  const weaponPreview = (slot, item, index) => {
    const parts = [];
    const dmg = degatsOf(item), hit = toucherOf(item);
    if (dmg) { const ctx = damageContextFor(item); const t = damageTypes.find(x => x.id === ctx.damageTypeId); parts.push(`d20 ${_esc(hit?.roll || '').replace('1d20', '').trim() || '+0'} · ${_esc(dmg.roll)} ${_esc(t?.label || (ctx.isMagic ? 'magique' : 'physique'))}`); }
    else parts.push(_esc(item.particularite || getItemEffectText(item) || 'Objet de soutien'));
    let sty = '';
    try {
      const before = activeStyle ? plainStyleName(activeStyle) : '';
      const hypo = { ...c, equipement: { ...equip, [slot]: item, ...(slot === primarySlot && weaponHands(item) === 2 ? { [secondarySlot]: {} } : {}) } };
      const after = detectCombatStyle?.(hypo, styles);
      const afterN = after ? plainStyleName(after) : '';
      if (afterN && afterN !== before) sty = `Style : ${before || '—'} → ${afterN}`;
    } catch {}
    const warn = (slot === primarySlot && weaponHands(item) === 2 && equip[secondarySlot]?.nom) ? `Range ${equip[secondarySlot].nom}` : '';
    return { line: parts.join(''), sty, warn };
  };
  const weaponCandidates = slot => inventory.map((item, index) => ({ item, index }))
    .filter(({ item, index }) => item?.nom && equipmentSlotAcceptsItem(weaponSlots.find(s => s.id === slot), item) && !(equippedInvMap.get(index) || []).length && !(slot === secondarySlot && weaponHands(item) === 2));

  function wCard(slotDef) {
    const slot = slotDef.id, key = 'w:' + slot, isOpen = open === key;
    const locked = slot === secondarySlot && weaponHands(currentItem(primarySlot)) === 2;
    if (locked) return `<div class="cb-w lock"><span class="cb-k">${_esc(slotDef.label)}</span><div class="cb-meta">Occupée : arme à deux mains.</div></div>`;
    const item = currentItem(slot);
    if (!item?.nom) return `<button type="button" class="cb-w empty${isOpen ? ' on' : ''}" data-action="cbOpen" data-k="${key}"><span class="cb-k">${_esc(slotDef.label)}</span><div class="cb-meta">Main libre · <b>Équiper…</b></div></button>`;
    const rare = rarityOf(slot, item), dmg = degatsOf(item), hit = toucherOf(item);
    const ctx = damageContextFor(item), type = damageTypes.find(x => x.id === ctx.damageTypeId);
    const dColor = type?.color || (ctx.isMagic ? '#bca0ff' : 'var(--text-muted)'), dLabel = type?.label || (ctx.isMagic ? 'Magique' : 'Physique');
    const body = dmg
      ? `<div class="cb-roll"><b><i>d20</i>${_esc((hit?.roll || '').replace('1d20', '').trim() || '+0')}</b><b style="--dc:${_esc(dColor)}">${_esc(dmg.roll)} <em>${_esc(dLabel)}</em></b></div>`
      : `<div class="cb-meta" style="color:var(--text-soft)">${_esc(item.particularite || getItemEffectText(item) || 'Objet de soutien.')}</div>`;
    const meta = [item.portee, weaponHands(item) === 2 ? '2 mains' : '', ...(_getTraits(sourceItem(slot, item)) || [])].filter(Boolean).map(_esc).join(' · ');
    return `<button type="button" class="cb-w${isOpen ? ' on' : ''}" style="--rc:${_esc(rare.color || 'transparent')}" data-action="cbOpen" data-k="${key}"><span class="cb-k">${_esc(slotDef.label)}</span>${nm(item.nom, rare.level)}${body}${meta ? `<div class="cb-meta">${meta}</div>` : ''}</button>`;
  }
  function wDetail(slot) {
    const item = currentItem(slot), dmg = degatsOf(item), hit = toucherOf(item);
    const cands = weaponCandidates(slot);
    const candHtml = cands.length ? `<div class="cb-cand">${cands.map(({ item: it, index }) => { const p = weaponPreview(slot, it, index); const r = parseInt(it.rarete) || 0;
      return `<div class="cb-ci">${nm(it.nom, r)}<span class="d">${_esc(p.line)}</span>${p.sty ? `<span class="d">${_esc(p.sty)}</span>` : ''}${p.warn ? `<span class="warn">${_esc(p.warn)}</span>` : ''}${canEdit ? `<button class="cb-btn" data-action="equipInventoryItem" data-index="${index}" data-slot="${_esc(slot)}" data-render-tab="combat">Équiper</button>` : ''}</div>`; }).join('')}</div>` : '<div class="cb-none">Rien de compatible dans le sac.</div>';
    let left = '';
    if (dmg) {
      left += `<div class="cb-sec"><h5>Toucher</h5>${calc([['Dé', '1d20'], hit?.statLabel ? [`Modificateur ${hit.statLabel}`, modStr(hit.statMod || 0)] : null, hit?.setBonus ? ['Bonus de set', modStr(hit.setBonus)] : null], hit?.roll || '—')}</div>`;
      const ctx = damageContextFor(item), t = damageTypes.find(x => x.id === ctx.damageTypeId);
      left += `<div class="cb-sec"><h5>Dégâts<span style="color:${_esc(t?.color || 'var(--text-muted)')}">${_esc(t?.label || (ctx.isMagic ? 'magique' : 'physique'))}</span></h5>${calc([["Dé de l'arme", item.degats || '—'], dmg.statLabel ? [`Modificateur ${dmg.statLabel}`, modStr(dmg.statMod || 0)] : null, dmg.maitriseBonus ? ['Bonus de maîtrise', modStr(dmg.maitriseBonus)] : null], dmg.roll)}</div>`;
    } else if (item?.nom) left += `<div class="cb-sec"><h5>Effet</h5><p>${_esc(item.particularite || getItemEffectText(item) || 'Objet de soutien.')}</p></div>`;
    if (item?.nom) left += extras(item);
    return `<div class="cb-x">${left ? `<div class="cb-sec" style="gap:14px">${left}</div>` : ''}<div class="cb-sec"><h5>${item?.nom ? 'Changer pour' : 'Équiper'}</h5>${candHtml}</div>${item?.nom && canEdit ? `<div class="cb-acts"><button class="cb-btn danger" data-action="clearEquipSlot" data-slot="${_esc(slot)}" data-render-tab="combat">Ranger dans le sac</button></div>` : ''}</div>`;
  }
  function styleDetail() {
    const activeKey = String(activeStyle?.id || _norm(activeStyle?.label || activeStyle?.name || ''));
    const list = styles.map(s => { const k = String(s?.id || _norm(s?.label || s?.name || '')); const cur = activeKey && k === activeKey;
      const cond = [(s.condPrincipale || []).filter(Boolean).join(', ') || ((s.condPrincipale || []).length ? 'main vide' : 'toute arme'), s.condMains ? `${s.condMains} main${s.condMains === '2' ? 's' : ''}` : '', (s.condSecondaire || []).filter(Boolean).join(', ') || ((s.condSecondaire || []).length ? 'seconde main vide' : '')].filter(Boolean).join(' · ');
      return `<div class="${cur ? 'cur' : ''}" style="--sc:${_esc(s.couleur || s.color || '#7a8fa8')}"><b>${_esc(plainStyleName(s))}</b><span>${_esc(cond)}</span>${cur ? '<em>Actif</em>' : ''}</div>`; }).join('');
    const mainMag = damageContextFor(currentItem(primarySlot)).isMagic;
    return `<div class="cb-x"><div class="cb-sec"><h5>Effet</h5><p>${_esc(activeStyle?.description || 'Style déduit des armes en main.')}</p><p style="color:var(--text-muted);font-size:.72rem">${mainMag ? 'Arme magique : la moitié des dégâts passe même si la CA résiste.' : 'Arme non magique : aucun dégât si la CA résiste.'}</p></div>
      <div class="cb-sec"><h5>Tous les styles${mj ? '<span><span class="cb-mj">MJ</span> <button class="cb-btn ghost" data-action="openCombatStylesAdmin">Gérer</button></span>' : ''}</h5><div class="cb-sl">${list}</div></div></div>`;
  }

  const armorSet = (() => { try { return getArmorSetData(c) || {}; } catch { return {}; } })();
  const tracked = new Set(armorSet.trackedSlots || []);
  const armorKey = item => { const ca = (parseInt(item.ca) || 0) + (parseInt(item.caBonus) || 0); return [ca ? `CA +${ca}` : '', ..._itemBonusBadges(item).map(b => b.lbl)].filter(Boolean).join(' · ') || (item.typeArmure || '—'); };
  const armorCandidates = slot => inventory.map((item, index) => ({ item, index }))
    .filter(({ item, index }) => item?.nom && equipmentSlotAcceptsItem(armorSlots.find(s => s.id === slot), item) && !(equippedInvMap.get(index) || []).length);
  function aRow(slotDef) {
    const slot = slotDef.id, key = 'a:' + slot, isOpen = open === key;
    const item = sourceItem(slot, equip[slot] || {});
    const row = item?.nom
      ? `<button type="button" class="cb-row${isOpen ? ' on' : ''}" style="--rc:${_esc(rarityOf(slot, item).color || 'transparent')}" data-action="cbOpen" data-k="${key}"><span class="cb-k">${_esc(slotDef.label)}</span>${nm(item.nom, rarityOf(slot, item).level)}<span class="kd">${_esc(armorKey(item))}</span><span class="cb-chev">›</span></button>`
      : `<button type="button" class="cb-row empty${isOpen ? ' on' : ''}" data-action="cbOpen" data-k="${key}"><span class="cb-k">${_esc(slotDef.label)}</span><span class="cb-nm"><b>Vide</b></span><span class="kd">Équiper…</span><span class="cb-chev">›</span></button>`;
    return row + (isOpen ? aDetail(slot) : '');
  }
  function aDetail(slot) {
    const slotDef = armorSlots.find(s => s.id === slot);
    const item = sourceItem(slot, equip[slot] || {});
    const warnOf = it => {
      if (!tracked.has(slot)) return '';
      const t = it.typeArmure;
      if (armorSet.isActive && armorSet.dominantType && t && _norm(t) !== _norm(armorSet.dominantType)) return `Casse ${armorSet.fullType || armorSet.dominantType}`;
      const others = (armorSlots.filter(s => tracked.has(s.id) && s.id !== slot)).map(s => sourceItem(s.id, equip[s.id] || {})?.typeArmure).filter(Boolean);
      if (t && others.length && others.every(x => _norm(x) === _norm(t))) return `Active un ensemble ${t}`;
      return '';
    };
    const cands = armorCandidates(slot);
    const candHtml = cands.length ? `<div class="cb-cand">${cands.map(({ item: it, index }) => { const w = warnOf(it); const r = parseInt(it.rarete) || 0;
      return `<div class="cb-ci">${nm(it.nom, r)}<span class="d">${_esc(armorKey(it))}${it.typeArmure ? ' · ' + _esc(it.typeArmure) : ''}</span>${w ? `<span class="${w.startsWith('Casse') ? 'warn' : 'd'}">${_esc(w)}</span>` : ''}${canEdit ? `<button class="cb-btn" data-action="equipInventoryItem" data-index="${index}" data-slot="${_esc(slot)}" data-render-tab="combat">Équiper</button>` : ''}</div>`; }).join('')}</div>` : '<div class="cb-none">Rien pour cet emplacement dans le sac.</div>';
    let left = '';
    if (item?.nom) {
      if (item.typeArmure) left += `<div class="cb-sec"><h5>Matière</h5><p>${_esc(item.typeArmure)}${tracked.has(slot) ? ' · compte pour un ensemble' : ''}</p></div>`;
      left += extras(item);
    }
    return `<div class="cb-x">${left ? `<div class="cb-sec" style="gap:14px">${left}</div>` : ''}<div class="cb-sec"><h5>${item?.nom ? 'Changer pour' : 'Équiper'}</h5>${candHtml}</div>${item?.nom && canEdit ? `<div class="cb-acts"><button class="cb-btn danger" data-action="clearEquipSlot" data-slot="${_esc(slot)}" data-render-tab="combat">Retirer</button></div>` : ''}</div>`;
  }

  // Protection : état d'ensemble (pips + nom/effet ou n/3).
  const setPips = (armorSet.slots || []).map(e => `<i class="${e.equipped ? 'on' : ''}" style="--pc:${_esc(e.type ? (getArmorTypeMeta(e.type)?.color || '#7a8fa8') : '')}"></i>`).join('');
  const activeSetName = [...new Set((armorSet.activeSets || []).map(a => a?.set?.label || a?.type).filter(Boolean))].join(' + ') || armorSet.fullType || '';
  const activeSetEffect = getArmorSetChipText(armorSet, { includeNames: false });
  const setH = (armorSet.trackedSlots || []).length
    ? (armorSet.isActive
      ? `<span class="cb-set ok" title="${_esc(activeSetEffect)}"><span class="cb-pips">${setPips}</span><b>${_esc(activeSetName)}</b>${activeSetEffect ? _esc(activeSetEffect) : ''}</span>`
      : `<span class="cb-set"><span class="cb-pips">${setPips}</span><b>Ensemble ${armorSet.equippedCount || 0}/${armorSet.trackedSlots.length}</b>tête, torse, bottes de même matière</span>`)
    : '';

  // Savoir-faire : maîtrises (édition MJ) + éléments.
  const heldFamilies = weaponSlots.map(s => currentItem(s.id)).filter(i => i?.nom).map(i => _norm(family(i)));
  const mrows = (c.maitrises || []).map((m, i) => {
    const name = m.typeArme || m.nom || m.name || 'Sans type';
    const level = Math.max(0, Math.min(5, parseInt(m.niveau) || 0));
    const inHand = heldFamilies.some(v => v && (v.includes(_norm(name)) || _norm(name).includes(v)));
    const isOpen = open === 'm:' + i;
    const pips = [0, 1, 2, 3, 4].map(k => `<i class="${k < level ? 'on' : ''}"></i>`).join('');
    const lvl = mj
      ? `<span class="cb-lvl"><button class="cb-step" data-action="stepCombatMastery" data-idx="${i}" data-delta="-1" ${level <= 0 ? 'disabled' : ''}>−</button><span class="cb-mp">${pips}</span><button class="cb-step" data-action="stepCombatMastery" data-idx="${i}" data-delta="1" ${level >= 5 ? 'disabled' : ''}>+</button></span>`
      : `<span class="cb-lvl"><span class="cb-mp">${pips}</span></span>`;
    const head = `<div class="cb-m${isOpen ? ' on' : ''}">${mj ? `<button class="cb-m-n" data-action="cbOpen" data-k="m:${i}"><span>${_esc(name)}</span>${inHand ? '<em>En main</em>' : ''}</button>` : `<span class="cb-m-n"><span>${_esc(name)}</span>${inHand ? '<em>En main</em>' : ''}</span>`}<span class="cb-m-fx">${level ? `+${level} dégât${level > 1 ? 's' : ''}` : 'Initié'}</span>${lvl}</div>`;
    const editor = (mj && isOpen) ? `<div class="cb-mx"><div class="cb-mx-r"><input class="cb-inp" data-change="saveCombatMasteryName" data-idx="${i}" value="${_esc(name === 'Sans type' ? '' : name)}" placeholder="Type d'arme, ex. Épées longues"><button class="cb-btn danger" data-action="deleteMaitrise" data-idx="${i}">Supprimer</button></div><input class="cb-inp" data-change="saveCombatMasteryNote" data-idx="${i}" value="${_esc(m.note || '')}" placeholder="Note : où, avec qui…"></div>` : '';
    return head + editor;
  }).join('');
  const charElements = c.elements || [];
  const els = (damageTypes.length ? getMagicTypes(damageTypes) : []).filter(t => mj || charElements.includes(t.id)).map(t => {
    const active = charElements.includes(t.id), favorite = active && c.favoriteElement === t.id;
    const toggle = mj ? `data-action="toggleCharElement" data-id="${_esc(c.id)}" data-elem="${_esc(t.id)}" title="${active ? 'Retirer' : 'Accorder'} (MJ)"` : '';
    // Octroi d'un élément = MJ. Mais choisir son élément par défaut au VTT parmi
    // ceux déjà maîtrisés est une préférence du propriétaire de la fiche
    // (setFavoriteElement est ouvert au joueur). On rend donc l'étoile cliquable
    // dès que la fiche est éditable, pas seulement pour le MJ.
    const fav = active && canEdit ? `<button class="${favorite ? 'fav' : ''}" data-action="setFavoriteElement" data-id="${_esc(c.id)}" data-elem="${_esc(t.id)}" title="${favorite ? 'Élément par défaut au VTT' : 'Définir par défaut au VTT'}">${favorite ? '★' : '☆'}</button>` : (favorite ? '<span class="fav">★</span>' : '');
    return `<span class="cb-el${active ? ' on' : ''}" style="--c:${_esc(t.color || '#9ca3af')}" ${toggle}><i></i>${_esc(t.label)}${fav}</span>`;
  }).join('');

  const legend = `<div class="cb-leg">${RARETE_NAMES.map((n, i) => [n, i]).filter(([n, i]) => i >= 2 && n).map(([n, i]) => `<span style="--rc:${_rareteColor(n) || '#7a8fa8'}">${_esc(n)}</span>`).join('')}</div>`;
  const wOpen = typeof open === 'string' && open.startsWith('w:') ? wDetail(open.slice(2)) : '';

  return `<div class="cb">
    <section class="cb-zone"><div class="cb-zh"><h3>En main</h3></div><div class="cb-zb">
      <div class="cb-hands">${weaponSlots.map(wCard).join('')}</div>${wOpen}
      <button type="button" class="cb-style${open === 'style' ? ' on' : ''}" style="--sc:${_esc(styleColor)}" data-action="cbOpen" data-k="style"><span class="cb-k">Style</span><b>${_esc(styleName)}</b>${styleRules.map(r => `<span class="cb-rule ${ruleTone(r.tone)}" title="${_esc(r.detail || '')}">${_esc(r.label)}</span>`).join('')}<span class="cb-chev">›</span></button>
      ${open === 'style' ? styleDetail() : ''}</div></section>
    <section class="cb-zone"><div class="cb-zh"><h3>Protection</h3><div class="cb-zh-r">${setH}${mj ? '<button type="button" class="cb-btn ghost" data-action="openArmorSetsAdmin">Sets <span class="cb-mj">MJ</span></button>' : ''}</div></div><div class="cb-zb"><div class="cb-list">${armorSlots.map(aRow).join('')}</div></div></section>
    <section class="cb-zone"><div class="cb-zh"><h3>Savoir-faire</h3></div><div class="cb-zb">
      <div class="cb-sub">Maîtrises d'arme${mj ? '<span class="cb-mj">MJ</span><button type="button" class="cb-btn ghost" data-action="addMaitrise">+ Maîtrise</button>' : ''}</div>
      <div class="cb-list cb-mlist">${mrows || '<div class="cb-none">Aucune maîtrise.</div>'}</div>
      <div class="cb-sub">Éléments${mj ? '<span class="cb-mj">MJ</span>' : ''}<span style="margin-left:auto;letter-spacing:0;text-transform:none;font-weight:500">★ par défaut au VTT</span></div>
      <div class="cb-elems">${els || '<div class="cb-none">Aucun élément.</div>'}</div></div></section>
    ${legend}
  </div>`;
}


// ══════════════════════════════════════════════════════════════════════════════
// V3 — INVENTAIRE (header avec summary + filter chips, puis renderer existant)
// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// V3 — INVENTAIRE (.inv-card grid + summary + filter chips + search)
// ══════════════════════════════════════════════════════════════════════════════
// Regroupements spécifiques par type (le MJ saisit le type libre des objets).
// Clé = type normalisé (minuscules, sans accents) → catégorie cible.
const _INV_MATERIAUX = { id: 'materiaux', lbl: 'Matériaux', icon: '🧱' };
const _INV_TYPE_MAP = {
  'skin':       { id: 'armure', lbl: 'Armures', icon: '🛡️' }, // routé vers la catégorie Armures
  'instrument': { id: 'objet',  lbl: 'Objet',   icon: '🎒' },
};

// Catégorie complète d'un objet ({ id, lbl, icon }) pour le filtre d'inventaire.
// • Équipement → 3 catégories fixes qui absorbent tous leurs sous-types :
//   toute arme → Armes, toute armure → Armures, bagues/amulettes → Bijoux.
// • Mat.* (Mat.Arme, Mat.Armure, Mat.Bijoux…) → Matériaux.
// • Règles ponctuelles (_INV_TYPE_MAP) : skin → Armures, Instrument → Objet…
// • Tout le reste → une catégorie par `type` d'objet (libellé = le type réel).
// • Sans type → Divers.
function _invCat(it) {
  const tpl = (it.template || '').toLowerCase();
  const hay = _norm([it.type, it.categorie, it.nom, it.sousType, it.sousCategorie].filter(Boolean).join(' '));
  const has = (...k) => k.some(x => hay.includes(x));
  if (tpl === 'arme'   || tpl.includes('arme')   || it.degats || it.toucher) return { id: 'arme',   lbl: 'Armes',   icon: '⚔️' };
  if (tpl === 'armure' || tpl.includes('armure') || it.typeArmure || it.slotArmure) return { id: 'armure', lbl: 'Armures', icon: '🛡️' };
  if (tpl === 'bijou'  || it.slotBijou || has('anneau','amulette','bijou','talisman','pendentif','bague')) return { id: 'bijou', lbl: 'Bijoux', icon: '💍' };
  const type = (it.type || '').trim();
  if (!type) return { id: 'autre', lbl: 'Divers', icon: '📦' };
  const nt = _norm(type);
  if (nt.startsWith('mat.') || nt.startsWith('mat ') || nt === 'materiau' || nt === 'materiaux') return _INV_MATERIAUX;
  if (_INV_TYPE_MAP[nt]) return _INV_TYPE_MAP[nt];
  return { id: 'type:' + nt, lbl: type, icon: _invTypeIcon(type) };
}

// Renvoie l'id de catégorie (pour le filtrage).
function _detectInvCategory(it) { return _invCat(it).id; }

// Icône d'agrément d'un filtre de type (cosmétique ; le libellé reste le type réel).
function _invTypeIcon(type) {
  const t = _norm(type || '');
  if (/plante|fleur|champignon|graine|botaniqu/.test(t)) return '🌿';
  if (/potion|consommable|elixir|antidote|nourriture|herbe|ingredient|ressource|materiau/.test(t)) return '🧪';
  if (/parchemin|grimoire|rouleau|scroll|livre/.test(t)) return '📜';
  if (/precieux|gemme|joyau|pierre|tresor|lingot|diamant|rubis|saphir|emeraude|perle|cristal|pepite|relique|valeur/.test(t)) return '💎';
  if (/cle|clef|outil|kit|piege/.test(t)) return '🔧';
  return '📦';
}

// Puces de filtre dynamiques : « Tout » + uniquement les catégories réellement
// présentes dans l'inventaire (Armes/Armures/Bijoux, puis les autres par libellé,
// puis « Divers »).
function _invFilters(inv) {
  const present = new Map();
  (inv || []).forEach(it => {
    const cat = _invCat(it);
    if (!present.has(cat.id)) present.set(cat.id, cat);
  });
  const FIX = ['arme', 'armure', 'bijou'];
  const fixed = FIX.map(id => present.get(id)).filter(Boolean);
  const dyn = [...present.values()]
    .filter(c => !FIX.includes(c.id) && c.id !== 'autre')
    .sort((a, b) => a.lbl.localeCompare(b.lbl, 'fr', { sensitivity: 'base' }));
  const autre = present.get('autre');
  return [{ id: 'all', lbl: 'Tout', icon: '' }, ...fixed, ...dyn, ...(autre ? [autre] : [])];
}

function _invLooksMechanicalEffect(text = '') {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 90) return false;
  const n = _norm(raw);
  if (/[+\-]?\d/.test(raw)) return true;
  return /\b(pv|pm|ca|degat|degats|soin|vitesse|portee|toucher|critique|avantage|desavantage|relance|dd|etat|reaction|action bonus|resistance|immunite|mana)\b/.test(n);
}

function _inventoryBuildUsageMap(c = {}) {
  const inv = Array.isArray(c?.inventaire) ? c.inventaire : [];
  const { builds, activeBuildId } = normalizeCharacterBuilds(c);
  const usageMap = new Map();
  const sameItem = (entry, eq) => {
    if (!entry || !eq) return false;
    if (eq.itemId && entry.itemId) return entry.itemId === eq.itemId;
    return String(entry.nom || '') === String(eq.nom || '');
  };
  const readIdx = value => {
    const n = Number.isInteger(value) ? value : parseInt(value, 10);
    return Number.isInteger(n) && n >= 0 ? n : -1;
  };

  builds.forEach((build, buildIndex) => {
    const claimed = new Set();
    Object.entries(build?.equipement || {}).forEach(([slot, eq]) => {
      if (!eq?.nom) return;
      let idx = readIdx(eq.sourceInvIndex);
      if (!(idx >= 0 && !claimed.has(idx) && sameItem(inv[idx], eq))) {
        idx = inv.findIndex((entry, i) => !claimed.has(i) && sameItem(entry, eq));
      }
      if (idx < 0) return;
      claimed.add(idx);
      const list = usageMap.get(idx) || [];
      list.push({
        buildId: build.id || `build-${buildIndex}`,
        buildName: build.name || build.nom || `Build ${buildIndex + 1}`,
        slot,
        active: (build.id || '') === activeBuildId,
      });
      usageMap.set(idx, list);
    });
  });

  return usageMap;
}

function _inventoryBuildUsagesForIndices(usageMap, indices = []) {
  const seen = new Set();
  const out = [];
  indices.forEach(rawIdx => {
    const idx = Number.isInteger(rawIdx) ? rawIdx : parseInt(rawIdx, 10);
    (usageMap.get(idx) || []).forEach(usage => {
      const key = `${usage.buildId}|${usage.slot}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(usage);
    });
  });
  return out.sort((a, b) => Number(b.active) - Number(a.active)
    || String(a.buildName).localeCompare(String(b.buildName), 'fr', { sensitivity: 'base' })
    || String(a.slot).localeCompare(String(b.slot), 'fr', { sensitivity: 'base' }));
}

function _inventorySlotLabel(slot = '') {
  const definition = getEquipmentSlots().find(entry => entry.id === slot);
  return definition?.label || slot || 'Emplacement';
}

function _renderInventoryBuildBadges(usages = []) {
  const inactive = usages.filter(u => !u.active);
  if (!inactive.length) return '';
  const otherByBuild = new Map();
  inactive.forEach(u => {
    if (!otherByBuild.has(u.buildId)) otherByBuild.set(u.buildId, { name: u.buildName, slots: [] });
    otherByBuild.get(u.buildId).slots.push(_inventorySlotLabel(u.slot));
  });

  const detail = inactive
    .map(u => `${u.buildName} — ${_inventorySlotLabel(u.slot)}`)
    .join('\n');
  const title = _esc(detail);
  const badges = [];

  const others = [...otherByBuild.values()];
  if (others.length === 1) {
    badges.push(`<span class="inv-equipped-badge inv-build-badge is-other" title="${title}">Autre build · ${_esc(others[0].name)}</span>`);
  } else if (others.length > 1) {
    badges.push(`<span class="inv-equipped-badge inv-build-badge is-other" title="${title}">${others.length} autres builds</span>`);
  }

  return `<span class="inv-build-badges">${badges.join('')}</span>`;
}

function _renderCurrentBuildEquipment(usages = []) {
  const active = usages.filter(usage => usage.active);
  if (!active.length) return '';
  const slots = [...new Set(active.map(usage => _inventorySlotLabel(usage.slot)))];
  const buildName = active[0].buildName || 'Principal';
  const detail = `Build actuel : ${buildName}\n${slots.join(', ')}`;
  return `<div class="inv-equipped-current" title="${_esc(detail)}">
    <span class="inv-equipped-current-check" aria-hidden="true">✓</span>
    <span class="inv-equipped-current-copy">
      <small>Équipé · build actuel</small>
      <strong>${_esc(slots.join(' · '))}</strong>
    </span>
  </div>`;
}

function renderCharInventaireV3(c, canEdit) {
  const inv = c.inventaire || [];
  const totalItems = inv.reduce((sum, item) =>
    sum + (parseInt(item.quantite || item.qte || 1) || 1), 0);
  let equipped = 0;
  let currentEquippedMap = new Map();
  try {
    currentEquippedMap = getEquippedInventoryIndexMap?.(c) || new Map();
    equipped = currentEquippedMap.size;
  } catch {}
  const totals = inv.reduce((sum, it) => {
    const catalogItem = getInventoryCatalogItem(it.itemId);
    const q = parseInt(it.quantite || it.qte || 1) || 1;
    sum.value += getInventoryItemValue(it, catalogItem) * q;
    sum.resale += getInventoryItemResaleValue(it, catalogItem) * q;
    return sum;
  }, { value: 0, resale: 0 });

  // État du filtre / search module-local
  const filter = _csV3InvFilter;
  const q = _norm(filter.search || '');   // minuscules + sans accents
  // Puces dynamiques d'après les objets présents ; un filtre devenu absent
  // (ex. ancienne catégorie supprimée) retombe sur « Tout ».
  const filters = _invFilters(inv);
  const activeCat = filters.some(f => f.id === filter.cat) ? filter.cat : 'all';
  const buildUsageMap = _inventoryBuildUsageMap(c);

  // Stack : regroupe les items identiques qui portent aussi les mêmes traits.
  // Garde la liste d'indices originaux pour les actions (vente/envoi/suppression bulk).
  const stackMap = new Map();
  inv.forEach((it, idx) => {
    const catalogItem = getInventoryCatalogItem(it.itemId);
    const baseKey = it.itemId || `${it.nom||''}|${it.template||it.type||''}|${parseInt(it.rarete||it.rare||0)}|${getInventoryItemValue(it, catalogItem)}`;
    const traitsKey = (_getTraits?.(it) || []).join('\u001f');
    const key = `${baseKey}|traits:${traitsKey}`;
    if (!stackMap.has(key)) {
      stackMap.set(key, { it: { ...it }, indices: [idx], qte: parseInt(it.quantite || it.qte || 1) || 1 });
    } else {
      const cur = stackMap.get(key);
      cur.indices.push(idx);
      cur.qte += parseInt(it.quantite || it.qte || 1) || 1;
    }
  });

  // Filtrage sur les stacks
  const filteredInv = [...stackMap.values()].filter(({ it }) => {
    if (activeCat !== 'all' && _detectInvCategory(it) !== activeCat) return false;
    if (!q) return true;
    const traits = (_getTraits?.(it) || []).join(' ');
    const hay = _norm(`${it.nom||''} ${it.type||''} ${it.template||''} ${it.description||''} ${getItemEffectText(it)||''} ${traits}`);
    return hay.includes(q);
  });

  const categoryCount = catId => inv.reduce((count, item) => {
    if (catId !== 'all' && _detectInvCategory(item) !== catId) return count;
    return count + (parseInt(item.quantite || item.qte || 1) || 1);
  }, 0);

  const summaryHtml = `<div class="inv-overview">
    <span class="inv-overview-tile count"><small>Total</small><b>${totalItems}</b><em>objet${totalItems > 1 ? 's' : ''}</em></span>
    <span class="inv-overview-tile equipped"><small>Porté</small><b>${equipped}</b><em>équipé${equipped > 1 ? 's' : ''}</em></span>
    <span class="inv-overview-tile value"><small>Valeur</small><b>${totals.value} or</b></span>
    <span class="inv-overview-tile resale"><small>Revente</small><b>${totals.resale} or</b></span>
  </div>`;

  const filterBarHtml = `<div class="inv-toolbar">
    <div class="inv-search">
      <svg class="inv-search-ico" aria-hidden="true"><use href="./assets/img/icons.svg#icon-search"/></svg>
      <input placeholder="Rechercher un objet…" value="${_esc(filter.search)}"
        aria-label="Rechercher dans l’inventaire" data-input="_csV3InvSetSearch">
      ${filter.search ? `<button class="inv-search-clear" data-action="csV3InvClearSearch" title="Effacer la recherche" aria-label="Effacer la recherche">×</button>` : ''}
    </div>
    <div class="inv-toolbar-actions">
    ${isFeatureEnabled('recettes') ? recipeBookButton(c) : ''}
    ${inventoryHistoryButton(c)}
    <div class="inv-densityseg" role="group" aria-label="Mode d’affichage">
      <button class="${_csV3InvDensity === 'cards' ? 'on' : ''}" data-action="csV3InvSetDensity"
        data-density="cards" aria-pressed="${_csV3InvDensity === 'cards'}" title="Vue cartes">▦</button>
      <button class="${_csV3InvDensity === 'list' ? 'on' : ''}" data-action="csV3InvSetDensity"
        data-density="list" aria-pressed="${_csV3InvDensity === 'list'}" title="Vue liste">☰</button>
    </div>
    ${canEdit ? `<div class="inv-add-group">
      <button class="btn btn-outline btn-sm inv-add-btn" data-action="openCreateItemModal" data-id="${c.id}" title="Créer un objet selon les règles de l’aventure">🛠️ <span>Créer</span></button>
      <button class="btn btn-gold btn-sm inv-add-btn" data-action="addInvItem" data-id="${c.id}" title="Ajouter un objet">＋ <span>Objet</span></button>
    </div>` : ''}
    </div>
  </div>
  <div class="inv-category-bar" role="tablist" aria-label="Catégories de l’inventaire">
    ${filters.map(f => `<button class="inv-category ${activeCat===f.id?'on':''}" role="tab"
      aria-selected="${activeCat===f.id}" data-action="csV3InvSetCat" data-cat="${_esc(f.id)}">
      ${f.icon ? `<span aria-hidden="true">${f.icon}</span>` : ''}${_esc(f.lbl)}
      <b>${categoryCount(f.id)}</b>
    </button>`).join('')}
  </div>`;

  if (filteredInv.length === 0) {
    return `<div class="cs-section cs-section--compact cs-inventory-v3">${filterBarHtml}${summaryHtml}<div class="q-empty">${inv.length===0?"Inventaire vide.":"Aucun objet ne correspond aux filtres."}</div></div>`;
  }

  const cardsHtml = filteredInv.map(({ it, indices, qte }) => {
    const idx = indices[0];               // index principal pour Modifier
    const allIdx = indices;               // tous les indices pour bulk actions
    const cat = _invCat(it);
    const rareRaw = parseInt(it.rarete || it.rare || 0) || 0;
    const rareIdx = Math.max(0, rareRaw);
    const rareName = RARETE_NAMES[rareIdx] || '';
    const col = rareName ? _rareteColor(rareName) : '#7a8fa8';
    const allIdxB64 = btoa(JSON.stringify(allIdx));

    // Prix d'achat (référence) et prix de vente (au joueur quand il revend)
    const catalogItem = getInventoryCatalogItem(it.itemId);
    const prixAchat = getInventoryItemValue(it, catalogItem);
    const prixVente = getInventoryItemResaleValue(it, catalogItem);
    const image = getInventoryItemImage(it, catalogItem);
    const readableDocument = getInventoryReadableDocument(it, catalogItem);

    // Effet principal : une seule information forte, le reste devient secondaire.
    const caTotal = (parseInt(it.ca) || 0) + (parseInt(it.caBonus) || 0);
    const rawEffectTxt = String(getItemEffectText(it) || '').trim();
    const descriptionTxt = String(it.description || '').trim();
    const effectCandidateTxt = rawEffectTxt && _norm(rawEffectTxt) !== _norm(descriptionTxt)
      ? rawEffectTxt
      : '';
    const effetTxt = _invLooksMechanicalEffect(effectCandidateTxt) ? effectCandidateTxt : '';
    const displayDescription = descriptionTxt || (!effetTxt ? effectCandidateTxt : '');
    const heroEffectTxt = effetTxt.length > 56 ? `${effetTxt.slice(0, 53).trim()}…` : effetTxt;
    const hero = it.degats
      ? { k: 'Dégâts', v: it.degats, c: 'dmg', icon: '⚔' }
      : caTotal
        ? { k: 'Armure', v: `CA ${caTotal > 0 ? '+' : ''}${caTotal}`, c: 'ca', icon: '◈' }
        : effetTxt
          ? { k: 'Effet', v: heroEffectTxt, c: 'effect', icon: '✦' }
          : null;

    // Propriétés secondaires
    const props = [];
    const rawType = String(it.sousType || it.type || '').trim();
    if (rawType) {
      const rawTypeNorm = _norm(rawType);
      const catNorm = _norm(cat.lbl || '');
      if (!catNorm.includes(rawTypeNorm) && !rawTypeNorm.includes(catNorm)) {
        props.push({ k: 'Type', v: rawType });
      }
    }
    if (it.toucher) props.push({ k: 'Toucher', v: it.toucher });
    if (it.portee) props.push({ k: 'Portée', v: it.portee });
    if (it.typeArmure) props.push({ k: 'Type', v: it.typeArmure });
    if (it.slotArmure)  props.push({ k: 'Slot', v: it.slotArmure });
    else if (it.slotBijou) props.push({ k: 'Slot', v: it.slotBijou });
    if (it.format) props.push({ k: 'Type d’arme', v: it.format });
    if (it.mains) props.push({ k: 'Maniement', v: it.mains });
    if (effetTxt && hero?.k !== 'Effet') props.push({ k: 'Effet', v: effetTxt, c: 'effect' });
    const traits = _getTraits?.(it) || [];

    const buildUsages = _inventoryBuildUsagesForIndices(buildUsageMap, allIdx);
    const isEquipped = buildUsages.length > 0;
    const hasActiveBuildUsage = buildUsages.some(u => u.active);
    const buildBadgesHtml = _renderInventoryBuildBadges(buildUsages);
    const currentBuildEquipmentHtml = _renderCurrentBuildEquipment(buildUsages);
    const equipSlotId = resolveEquipmentSlotForItem(it);
    const equipSlot = equipSlotId ? getEquipmentSlot(equipSlotId) : null;
    const equipIndex = allIdx.find(index => !(currentEquippedMap.get(index) || []).length) ?? idx;
    const equippedInTarget = !!equipSlotId && allIdx.some(index =>
      (currentEquippedMap.get(index) || []).includes(equipSlotId));
    const replacedName = equipSlotId && !equippedInTarget ? c.equipement?.[equipSlotId]?.nom : '';
    const equipTitle = equippedInTarget
      ? `Déjà équipé dans ${equipSlot?.label || equipSlotId}`
      : `Équiper dans ${equipSlot?.label || equipSlotId}${replacedName ? ` · remplace ${replacedName}` : ''}`;

    return `<div class="inv-card ${isEquipped ? `is-equipped ${hasActiveBuildUsage ? 'is-equipped-active' : 'is-equipped-other'}` : ''}" style="--rare-c:${col}">
      <div class="inv-card-head">
        <button class="inv-card-visual" data-action="openInventoryItemDetail" data-id="${c.id}"
          data-indices="${allIdxB64}" title="Inspecter ${_esc(it.nom || 'l’objet')}">
          ${image ? `<img src="${_esc(image)}" alt="">` : `<span aria-hidden="true">${cat.icon || '◇'}</span>`}
        </button>
        <div class="inv-card-identity">
          <div class="inv-card-name">${_esc(it.nom || 'Sans nom')}</div>
          <div class="inv-card-subline">
            <span class="inv-card-cat">${cat.icon ? `<span aria-hidden="true">${cat.icon}</span>` : ''}${_esc(cat.lbl)}</span>
            ${rareName
              ? `<span class="inv-card-rare" style="color:${col}">${_rareteLabel(rareIdx)}</span>`
              : ''}
            ${readableDocument && canEdit ? `<button class="inv-card-read" data-action="openInventoryReadableContent"
              data-id="${_esc(c.id)}" data-indices="${allIdxB64}" title="Lire ${_esc(readableDocument.title)}">📖 Lire</button>` : ''}
            ${buildBadgesHtml}
          </div>
          ${currentBuildEquipmentHtml}
        </div>
        <div class="inv-card-head-actions">
          ${qte > 1
            ? `<span class="inv-qte" title="${qte} items empilés">×${qte}</span>`
            : `<span class="inv-qte">×1</span>`}
        </div>
      </div>
      ${hero ? `<div class="inv-card-hero ${hero.c}">
        <span class="inv-card-hero-icon" aria-hidden="true">${hero.icon}</span>
        <span><small>${hero.k}</small><strong>${_esc(hero.v)}</strong></span>
      </div>` : ''}
      ${props.length?`<div class="inv-card-props">
        ${props.map(p => `<span class="kv">
          <span class="k">${_esc(p.k)}</span>
          <span class="v ${p.c||''}">${_esc(p.v)}</span>
        </span>`).join('')}
      </div>`:''}
      ${traits.length ? `<div class="inv-card-traits">
        <span class="inv-card-traits-label">Traits</span>
        <div class="inv-card-traits-list">
          ${traits.map(trait => `<span class="trait">${_esc(trait)}</span>`).join('')}
        </div>
      </div>` : ''}
      ${(() => {
        const badges = _itemBonusBadges(it);
        return badges.length ? `<div class="inv-card-badges">${badges.map(b=>`<span class="badge-chip ${b.cls}">${b.lbl}</span>`).join('')}</div>` : '';
      })()}
      ${displayDescription?`<div class="inv-card-desc">${_esc(displayDescription)}</div>`:''}
      ${renderInvPersonalLine(c, allIdx, allIdxB64, 'card', canEdit)}
      <div class="inv-card-footer">
        <button class="inv-detail-btn" data-action="openInventoryItemDetail" data-id="${c.id}" data-indices="${allIdxB64}">Inspecter</button>
        <div class="inv-card-values">
          ${prixAchat ? `<span title="Valeur unitaire"><small>Valeur</small>${prixAchat}</span>` : ''}
          ${prixVente ? `<span class="resale" title="Revente unitaire"><small>Revente</small>${prixVente}</span>` : ''}
        </div>
        ${canEdit?`<div class="inv-card-actions">
          ${equipSlot ? `<button class="inv-act eq${equippedInTarget ? ' is-on' : ''}" data-action="equipInventoryItem"
            data-index="${equipIndex}" data-slot="${_esc(equipSlotId)}" data-render-tab="inv"
            title="${_esc(equipTitle)}" aria-label="${_esc(equipTitle)}" ${equippedInTarget ? 'disabled' : ''}>
            <span aria-hidden="true">${equippedInTarget ? '✓' : '⚔'}</span><span class="inv-equip-label">${equippedInTarget ? 'Équipé' : 'Équiper'}</span>
          </button>` : ''}
          <button class="inv-act sell" data-action="openSellInvModal" data-id="${c.id}" data-indices="${allIdxB64}" data-prix="${prixVente}" data-name="${_esc(it.nom||'')}" title="Vendre ${prixVente} or/u" aria-label="Vendre"><svg aria-hidden="true"><use href="./assets/img/icons.svg#icon-coin"/></svg></button>
          <button class="inv-act send" data-action="openSendInvModal" data-id="${c.id}" data-indices="${allIdxB64}" data-name="${_esc(it.nom||'')}" title="Envoyer" aria-label="Envoyer">↗</button>
          <button class="inv-act del" data-action="openDeleteInvModal" data-id="${c.id}" data-indices="${allIdxB64}" data-name="${_esc(it.nom||'')}" title="Supprimer" aria-label="Supprimer">×</button>
        </div>`:''}
      </div>
    </div>`;
  }).join('');

  return `<div class="cs-section cs-section--compact cs-inventory-v3">
    ${filterBarHtml}
    ${summaryHtml}
    <div class="inv-grid ${_csV3InvDensity === 'list' ? 'is-list' : 'is-cards'}">${cardsHtml}</div>
  </div>`;
}

function _csV3InvSetCat(cat) {
  _csV3InvFilter = { ..._csV3InvFilter, cat };
  if (charSession.getCurrentChar() && charSession.getCurrentCharTab() === 'inv') _renderTabV3('inv', charSession.getCurrentChar(), charSession.getCanEditChar());
}
function _csV3InvSetSearch(search) {
  _csV3InvFilter = { ..._csV3InvFilter, search };
  if (!charSession.getCurrentChar()) return;
  const caret = document.querySelector('.inv-search input')?.selectionStart;
  if (charSession.getCurrentCharTab() === 'inv') _renderTabV3('inv', charSession.getCurrentChar(), charSession.getCanEditChar());
  requestAnimationFrame(() => {
    const inp = document.querySelector('.inv-search input');
    if (inp) { inp.focus(); try { inp.setSelectionRange(caret, caret); } catch {} }
  });
}

function _csV3InvClearSearch() {
  _csV3InvSetSearch('');
}

function _csV3InvSetDensity(density) {
  const next = density === 'list' ? 'list' : 'cards';
  if (next === _csV3InvDensity) return;
  _csV3InvDensity = next;
  lsJson.set('cs-inventory-density', next);
  if (charSession.getCurrentChar() && charSession.getCurrentCharTab() === 'inv') {
    _renderTabV3('inv', charSession.getCurrentChar(), charSession.getCanEditChar());
  }
}

// ── Allocation ±1 point de niveau sur une stat depuis le stats banner ───────
async function allocateStat(charId, key, delta = 1) {
  const c = getCharacterById(charId);
  if (!c) return;
  if (!STATS_KEYS.includes(key)) return;

  const earned = Math.max(0, (c.niveau||1) - 1);
  const spent  = STATS_KEYS.reduce((s,k) => s + (parseInt((c.statsLevelUps||{})[k])||0), 0);
  const remaining = earned - spent;
  const lvlNow = parseInt((c.statsLevelUps||{})[key]) || 0;

  // Garde-fous : ne pas dépasser les points dispos / ne pas descendre sous 0
  if (delta > 0 && remaining <= 0) return;
  if (delta < 0 && lvlNow <= 0)    return;

  const stats = { ...(c.stats || {}) };
  stats[key] = Math.max(1, (stats[key] || 8) + delta);
  const levelUps = { ...(c.statsLevelUps || {}) };
  levelUps[key] = Math.max(0, lvlNow + delta);

  c.stats = stats; c.statsLevelUps = levelUps;
  await saveBuildPatch(charId, c, { stats, statsLevelUps: levelUps });
  renderCharSheet(c, charSession.getCurrentCharTab() || 'combat');
}

/**
 * Définit le personnage par défaut du joueur courant (ou du joueur propriétaire
 * du perso ciblé si admin). Désactive automatiquement isDefault sur les autres
 * personnages du même uid pour garantir l'unicité.
 */
async function _setDefaultCharacter(charId) {
  const all = STATE.characters || [];
  const c = all.find(x => x.id === charId);
  if (!c) return;
  const ownerUid = c.uid;
  if (!ownerUid) { showNotif('Personnage sans propriétaire.', 'error'); return; }
  const wasOn = !!c.isDefault;
  try {
    // Désactive isDefault sur tous les autres persos du même propriétaire en parallèle
    const updates = all
      .filter(x => x.uid === ownerUid && x.id !== charId && x.isDefault)
      .map(x => {
        x.isDefault = false;
        return updateInCol('characters', x.id, { isDefault: false });
      });
    // Toggle sur le perso ciblé
    c.isDefault = !wasOn;
    updates.push(updateInCol('characters', charId, { isDefault: c.isDefault }));
    await Promise.all(updates);
    showNotif(c.isDefault
      ? `★ ${c.nom || 'Personnage'} mis en favori — sélectionné d'office`
      : 'Favori retiré', 'success');
    // Re-render la sheet pour mettre à jour les pills et l'étoile
    if (charSession.getCurrentChar()?.id === charId) {
      renderCharSheet(c, charSession.getCurrentCharTab() || 'combat');
    } else if (typeof renderCharSheet === 'function') {
      const cur = charSession.getCurrentChar() || STATE.activeChar;
      if (cur) renderCharSheet(cur, charSession.getCurrentCharTab() || 'combat');
    }
  } catch (e) {
    console.error('[set default char]', e);
    notifySaveError(e);
  }
};

async function _persistCharacterBuildState(c) {
  const payload = buildProjectionPatch(c, getActiveBuild(c));
  await updateInCol('characters', c.id, payload);
  const idx = (STATE.characters || []).findIndex(x => x.id === c.id);
  if (idx >= 0) STATE.characters[idx] = { ...STATE.characters[idx], ...payload };
  // Muter en place (ne pas remplacer l'objet) pour préserver l'identité de
  // STATE.activeChar === charSession.getCurrentChar() (cf. renderCharSheet).
  if (STATE.activeChar?.id === c.id) Object.assign(STATE.activeChar, payload);
}

async function switchCharacterBuild(charId, buildId) {
  const c = getCharacterById(charId);
  if (!c || !buildId) return;
  const target = switchBuild(c, buildId);
  if (!target) return;
  try {
    await _persistCharacterBuildState(c);
    _closeIdentityPopover();
    showNotif(`Build actif : ${target.name || 'Build'}`, 'success');
    renderCharSheet(c, charSession.getCurrentCharTab() || 'combat');
  } catch (e) {
    notifySaveError(e);
  }
}

async function createCharacterBuild(charId) {
  const c = getCharacterById(charId);
  if (!c) return;
  const build = createBuild(c, { fromActive: true });
  try {
    await _persistCharacterBuildState(c);
    _closeIdentityPopover();
    showNotif(`Build créé : ${build.name}`, 'success');
    renderCharSheet(c, charSession.getCurrentCharTab() || 'combat');
  } catch (e) {
    notifySaveError(e);
  }
}

async function renameCharacterBuild(charId, buildId) {
  const c = getCharacterById(charId);
  const input = document.querySelector(`[data-build-name="${CSS.escape(buildId)}"]`);
  if (!c || !input) return;
  const build = renameBuild(c, buildId, input.value);
  if (!build) return;
  try {
    await _persistCharacterBuildState(c);
    showNotif('Build renommé.', 'success');
    _closeIdentityPopover();
    renderCharSheet(c, charSession.getCurrentCharTab() || 'combat');
  } catch (e) {
    notifySaveError(e);
  }
}

async function deleteCharacterBuild(charId, buildId) {
  const c = getCharacterById(charId);
  if (!c) return;
  const active = deleteBuild(c, buildId);
  if (!active) {
    showNotif('Impossible de supprimer le dernier build.', 'error');
    return;
  }
  try {
    await _persistCharacterBuildState(c);
    _closeIdentityPopover();
    showNotif('Build supprimé.', 'success');
    renderCharSheet(c, charSession.getCurrentCharTab() || 'combat');
  } catch (e) {
    notifySaveError(e);
  }
}

async function setCharAura(charId, aura) {
  const c = getCharacterById(charId);
  if (!c) return;
  c.aura = aura; c.auraColor = null;   // preset choisi → efface la couleur personnalisée
  document.querySelectorAll('.ids-aura .ids-dot').forEach(dot => dot.classList.toggle('active', dot.dataset.auraKey === aura));
  document.querySelector('.ids-aura-button')?.style.setProperty('--dot-c', _auraHex(c));
  await updateInCol('characters', charId, { aura, auraColor: null });
  _applyAuraVars(c);
}
async function setCharAuraColor(charId, hex) {
  const c = getCharacterById(charId);
  if (!c || !/^#[0-9a-fA-F]{6}$/.test(hex || '')) return;
  c.auraColor = hex;
  document.querySelectorAll('.ids-aura .ids-dot').forEach(dot => dot.classList.toggle('active', dot.classList.contains('custom')));
  document.querySelector('.ids-aura-button')?.style.setProperty('--dot-c', hex);
  await updateInCol('characters', charId, { auraColor: hex });
  _applyAuraVars(c);
}

// Mémorise la position de scroll par onglet (clé : charId + tab)
const _scrollByTab = new Map();
function _scrollKey(charId, tab) { return `${charId || '?'}::${tab}`; }
function _readTabScroll(area = document.getElementById('char-tab-content')) {
  return area?.scrollTop || window.scrollY || document.documentElement.scrollTop || 0;
}
function _restoreTabScroll(scrollTop) {
  if (scrollTop == null) return;
  requestAnimationFrame(() => {
    const area = document.getElementById('char-tab-content');
    if (area) area.scrollTop = scrollTop;
    window.scrollTo({ top: scrollTop, behavior: 'instant' });
  });
}

function showCharTab(tab, el, { syncRoute = true } = {}) {
  // V3 : 6 onglets uniquement. Toute valeur legacy est remappée.
  const v3 = _resolveV3Tab(tab);

  // Mémorise la position de scroll de l'onglet quitté (pour le restituer plus tard)
  const prevLeaf = charSession.getCurrentCharTab();
  const prevChar = charSession.getCurrentChar()?.id;
  if (prevLeaf && prevChar) {
    const area = document.getElementById('char-tab-content');
    const scrollTop = _readTabScroll(area);
    if (scrollTop > 0) _scrollByTab.set(_scrollKey(prevChar, prevLeaf), scrollTop);
  }

  _currentTopTab  = v3;
  charSession.set(charSession.getCurrentChar(), charSession.getCanEditChar(), v3);
  // L'URL suit l'onglet affiché (le perso, lui, ne change pas ici → prevChar).
  if (prevChar && syncRoute) setRouteSub('characters', _characterRouteSub(prevChar, v3));

  // Onglets v3 (nouveau template) — classe active + ARIA (sélection + roving tabindex)
  document.querySelectorAll('#char-tabs-v3 .tab-v3').forEach(t => {
    const on = t.dataset.tabV3 === v3;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
    t.tabIndex = on ? 0 : -1;
  });
  // Le panneau pointe vers l'onglet actif (role=tabpanel)
  document.getElementById('char-tab-content')?.setAttribute('aria-labelledby', `cs-tab-${v3}`);
  // Rétro-compat : les anciennes barres .cs-tab / .cs-subtab si une vieille page tarde à se rafraîchir
  document.querySelectorAll('#char-tabs .cs-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === v3)
  );

  _renderTabV3(v3, charSession.getCurrentChar(), charSession.getCanEditChar());

  // Restitue le scroll de l'onglet rejoint (si on y était déjà passé)
  const charId = charSession.getCurrentChar()?.id;
  const saved  = charId ? _scrollByTab.get(_scrollKey(charId, v3)) : null;
  if (saved != null) _restoreTabScroll(saved);
}

// Retour/Avance entre deux onglets du même personnage : mise à jour locale,
// sans démonter la fiche ni réamorcer son abonnement live. Un changement de
// personnage reste géré par le routeur complet afin de recalculer les droits.
document.addEventListener('app:route-sub-changed', event => {
  if (event.detail?.page !== 'characters') return;
  const [charId, tab] = String(event.detail.sub || '').split('/');
  if (!charId || !tab || charId !== charSession.getCurrentChar()?.id) return;
  event.preventDefault();
  showCharTab(tab, null, { syncRoute: false });
});

// ══════════════════════════════════════════════
// EXPORT — expose tout sur window pour les onclick HTML
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// REGISTRY data-action — délégation centralisée
// ══════════════════════════════════════════════
function _rerenderCombatTab() {
  const c = charSession.getCurrentChar();
  if (c && charSession.getCurrentCharTab() === 'combat') _renderTabV3('combat', c, charSession.getCanEditChar());
}

async function _stepCombatMastery(index, delta) {
  if (!STATE.isAdmin) return;
  const c = STATE.activeChar;
  const current = c?.maitrises?.[index];
  if (!c || !current) return;
  const previous = c.maitrises;
  const maitrises = previous.map((entry, i) => i === index
    ? { ...entry, niveau: Math.max(0, Math.min(5, (parseInt(entry.niveau) || 0) + delta)) }
    : entry);
  c.maitrises = maitrises;
  _rerenderCombatTab();
  try { await updateInCol('characters', c.id, { maitrises }); }
  catch (error) {
    c.maitrises = previous;
    _rerenderCombatTab();
    showNotif(error?.message || 'Impossible de modifier la maîtrise.', 'error');
  }
}

async function _saveCombatMasteryNote(el) {
  const c = STATE.activeChar;
  const index = Number(el.dataset.idx);
  const current = c?.maitrises?.[index];
  if (!c || !current) return;
  const note = el.value.trim();
  if ((current.note || '') === note) return;
  const previous = c.maitrises;
  const maitrises = previous.map((entry, i) => i === index ? { ...entry, note } : entry);
  c.maitrises = maitrises;
  try { await updateInCol('characters', c.id, { maitrises }); }
  catch (error) {
    c.maitrises = previous;
    el.value = current.note || '';
    showNotif(error?.message || 'Impossible d’enregistrer la note.', 'error');
  }
}

async function _saveCombatMasteryName(el) {
  const c = STATE.activeChar;
  const index = Number(el.dataset.idx);
  const current = c?.maitrises?.[index];
  if (!c || !current) return;
  const name = el.value.trim();
  if ((current.typeArme || current.nom || current.name || '') === name) return;
  const previous = c.maitrises;
  const maitrises = previous.map((entry, i) => i === index ? { ...entry, typeArme: name } : entry);
  c.maitrises = maitrises;
  const row = el.closest('.cb-mx')?.previousElementSibling?.querySelector('.cb-m-n span');
  if (row) row.textContent = name || 'Sans type';
  try { await updateInCol('characters', c.id, { maitrises }); }
  catch (error) {
    c.maitrises = previous;
    el.value = current.typeArme || current.nom || current.name || '';
    showNotif(error?.message || 'Impossible d’enregistrer la maîtrise.', 'error');
  }
}

registerCharBlurActions({
  csV3LedgerSaveField: (el) => _csV3LedgerSaveField(el, el.dataset.kind, Number(el.dataset.idx), el.dataset.field),
  csV3LedgerSaveAmount: (el) => _csV3LedgerSaveAmount(el, el.dataset.kind, Number(el.dataset.idx), Number(el.dataset.sign)),
  csV3SaveNoteTitle: (el) => _csV3SaveNoteTitle(Number(el.dataset.idx), el.value),
  csV3SaveIdentityValue: (el) => _csV3SaveIdentityValue(el.dataset.id, el.dataset.key, el.value),
  csV3SaveQuote: (el) => { el.classList.toggle('is-empty', !el.value); _csV3SaveQuote(el.dataset.id, el.value); },
});

registerActions({
  // Champs édités (change / input)
  saveXpDirect:            (el)     => saveXpDirect(el.dataset.id, el),
  previewXpBar:            (el)     => previewXpBar(el, Number(el.dataset.palier)),
  _csV3LedgerSetSearch:    (el)     => _csV3LedgerSetSearch(el.dataset.id, el.value),
  _csQuoteToggleEmpty:     (el)     => el.classList.toggle('is-empty', !el.value),
  _csV3SaveVisibility:     (el)     => _csV3SaveVisibility(el.dataset.id, el.dataset.key, el.checked),
  _csV3InvSetSearch:       (el)     => _csV3InvSetSearch(el.value),
  saveCombatMasteryNote:   (el)     => _saveCombatMasteryNote(el),
  saveCombatMasteryName:   (el)     => _saveCombatMasteryName(el),
  // Sélection
  selectChar:              (btn)    => selectChar(btn.dataset.id, btn),
  createNewChar:           ()       => createNewChar(),
  toggleCharPicker:        (btn)    => toggleCharPicker(btn),
  charPickSearch:          ()       => _charPickFilter(),
  charPickAccount:         (btn)    => charPickAccount(btn),
  _setDefaultCharacter:    (btn)    => _setDefaultCharacter(btn.dataset.id),
  switchCharacterBuild:    (el)     => switchCharacterBuild(el.dataset.id, el.dataset.buildId || el.value),
  createCharacterBuild:    (btn)    => createCharacterBuild(btn.dataset.id),
  renameCharacterBuild:    (btn)    => renameCharacterBuild(btn.dataset.id, btn.dataset.buildId),
  deleteCharacterBuild:    (btn)    => deleteCharacterBuild(btn.dataset.id, btn.dataset.buildId),

  // Tabs
  showCharTab:             (btn)    => showCharTab(btn.dataset.tab, btn),

  // Identité inline
  inlineEditText: (btn) => {
    const sel = btn.dataset.targetSel;
    const el = sel ? (btn.closest('.id-name-row')?.querySelector(sel) ?? btn) : btn;
    inlineEditText(btn.dataset.id, btn.dataset.field, el);
  },
  inlineEditChip:          (btn)    => inlineEditChip(btn.dataset.id, btn.dataset.field, btn, btn.dataset.label),
  inlineEditNum:           (btn)    => inlineEditNum(btn.dataset.id, btn.dataset.field, btn, Number(btn.dataset.min || 1), Number(btn.dataset.max || 999)),
  inlineEditStat:          (btn)    => inlineEditStat(btn.dataset.id, btn.dataset.key, btn),
  inlineEditStatFromCard:  (btn, e) => inlineEditStatFromCard(e, btn.dataset.id, btn.dataset.key, btn),
  allocateStat:            (btn)    => allocateStat(btn.dataset.id, btn.dataset.key, Number(btn.dataset.delta)),

  // Stats vitales
  adjustStat:              (btn)    => adjustStat(btn.dataset.field, Number(btn.dataset.delta), btn.dataset.id),
  editVital:               (btn)    => editVitalCurrent(btn.dataset.field, btn, btn.dataset.id),
  addXpDelta:              (btn)    => addXpDelta(btn.dataset.id),

  // Actions identité
  openCharacterPortraitViewer: (btn) => _openCharacterPortraitViewer(btn),
  toggleIdentityPopover:   (btn)    => _toggleIdentityPopover(btn),
  closeIdentityPopover:    ()       => _closeIdentityPopover(),
  identityInlineCommit:    (el)     => _identityInlineCommit(el),
  identityTitleCommit:     (el)     => _identityTitleCommit(el),
  identityAddTitle:        (el)     => _identityAddTitle(el),
  identityRemoveTitle:     (btn)    => _identityRemoveTitle(btn),
  identityLevelUp:         (btn)    => _identityLevelUp(btn),
  adjustIdentityLevel:     (btn)    => _adjustIdentityLevel(btn),
  toggleIdentityVitalBreakdown: (btn) => _toggleIdentityVitalBreakdown(btn),
  openCharExportMenu:      (btn)    => openCharExportMenu(btn.dataset.id, btn),
  deleteChar:              (btn)    => deleteChar(btn.dataset.id),
  setCharAura:             (btn)    => setCharAura(btn.dataset.id, btn.dataset.auraKey),
  setCharAuraColor:        (el)     => setCharAuraColor(el.dataset.id, el.value),
  setCharacterLifeStatus:  (btn)    => _setCharacterLifeStatus(btn),
  openSendGoldModal:       (btn)    => openSendGoldModal(btn.dataset.id),

  // Ledger
  csV3LedgerSetKind:       (btn)    => _csV3LedgerSetKind(btn.dataset.id, btn.dataset.kind),
  csV3LedgerSetAddKind:    (btn)    => _csV3LedgerSetAddKind(btn.dataset.kind, btn.dataset.id),
  csV3AddLedger:           (btn)    => _csV3AddLedger(btn.dataset.id),
  csV3DeleteLedger:        (btn)    => _csV3DeleteLedger(btn.dataset.id, btn.dataset.kind, Number(btn.dataset.idx)),
  csV3LedgerMore:          (btn)    => _csV3LedgerMore(btn.dataset.id),

  // Journal
  csV3JournalSub:          (btn)    => _csV3JournalSub(btn.dataset.sub),
  csV3AddNote:             ()       => _csV3AddNote(),
  csV3DeleteNote:          (btn)    => _csV3DeleteNote(Number(btn.dataset.idx)),
  addNote:                 ()       => addNote(),
  addQuete:                ()       => addQuete(),
  csV3AddRelation:         (btn)    => _csV3AddRelation(btn.dataset.id),
  toggleQuete:             (btn)    => toggleQuete(Number(btn.dataset.idx)),
  deleteQuete:             (btn)    => deleteQuete(Number(btn.dataset.idx)),
  csV3ToggleNote:          (btn)    => _csV3ToggleNote(Number(btn.dataset.idx)),
  csV3CycleNoteCat:        (btn)    => _csV3CycleNoteCat(Number(btn.dataset.idx)),
  csV3SaveOpenNote:        ()       => _csV3SaveOpenNote(),
  csV3CloseNote:           ()       => _csV3CloseNote(),
  deleteNote:              (btn)    => deleteNote(Number(btn.dataset.idx)),
  saveNote:                (btn)    => saveNote(Number(btn.dataset.idx)),
  csV3EditRelation:        (btn)    => _csV3EditRelation(btn.dataset.id, Number(btn.dataset.idx)),
  csV3DeleteRelation:      (btn)    => _csV3DeleteRelation(btn.dataset.id, Number(btn.dataset.idx)),
  csV3RelSent:             (btn)    => _csV3RelSent(btn.dataset.sent),
  csV3RelPickNpc:          (el)     => _csV3RelPickNpc(el),
  csV3SaveRelation:        (btn)    => _csV3SaveRelation(btn.dataset.id, Number(btn.dataset.idx)),
  closeRelModal:           ()       => closeModalDirect(),

  // Profil
  csV3RemoveProfilTag:      (btn)   => _csV3RemoveProfilTag(btn.dataset.id, btn.dataset.tag),
  csV3AddProfilTagFromInput:(btn)   => _csV3AddProfilTagFromInput(btn.dataset.id),
  csV3AddProfilTag:         (btn)   => _csV3AddProfilTag(btn.dataset.id, btn.dataset.tag),
  csV3RenameIdentity:       (btn)   => _csV3RenameIdentity(btn.dataset.id, btn.dataset.key),
  csV3SaveBioRt:            (btn)   => _csV3SaveBioRt(btn.dataset.id),
  csV3CancelBio:            (btn)   => _csV3CancelBio(btn.dataset.id),
  csV3EnterBioEdit:         (btn)   => _csV3EnterBioEdit(btn.dataset.id),
  csV3ToggleBioLock:        (btn)   => csV3ToggleBioLock(btn.dataset.id),
  csV3AddFact:              (btn)   => _csV3AddFact(btn.dataset.id),
  openProfilImageUpload:    (btn)   => openProfilImageUpload(btn.dataset.id),
  removeProfilImage:        (btn)   => removeProfilImage(btn.dataset.id),

  // Équipement & combat
  openCharCalculation:       (btn)   => openCharCalculation(btn),
  toggleCharDerivative:      (btn)   => toggleCharDerivative(btn),
  editEquipSlot:            (btn)   => editEquipSlot(btn.dataset.slot),
  openCombatStylesAdmin:    ()      => openCombatStylesAdmin(),
  openDamageTypesAdmin:     ()      => openDamageTypesAdmin(),
  toggleCharElement:        (btn)   => toggleCharElement(btn.dataset.id, btn.dataset.elem),
  setFavoriteElement:       (btn)   => setFavoriteElement(btn.dataset.id, btn.dataset.elem),
  cbOpen:                   (btn)   => { const k = btn.dataset.k; _combatTabUi.open = _combatTabUi.open === k ? null : k; _rerenderCombatTab(); },
  stepCombatMastery:        (btn)   => _stepCombatMastery(Number(btn.dataset.idx), Number(btn.dataset.delta)),

  // Maîtrises
  addMaitrise:              ()      => addMaitrise(),
  editMaitrise:             (btn)   => editMaitrise(Number(btn.dataset.idx)),

  // Inventaire
  openCharacterRecipeBook:    (btn)   => openCharacterRecipeBook(btn.dataset.id),
  openInventoryHistoryModal:(btn)   => openInventoryHistoryModal(btn.dataset.id),
  openInventoryItemDetail:  (btn)   => openInventoryItemDetail(btn.dataset.id, btn.dataset.indices),
  addInvItem:               ()      => addInvItem(),
  openCreateItemModal:      (btn)   => openCreateItemModal(btn?.dataset?.id,
    btn?.dataset?.index != null ? { index: Number(btn.dataset.index) } : {}),
  csV3InvSetCat:            (btn)   => _csV3InvSetCat(btn.dataset.cat),
  csV3InvClearSearch:       ()      => _csV3InvClearSearch(),
  csV3InvSetDensity:        (btn)   => _csV3InvSetDensity(btn.dataset.density),
  openSellInvModal:         (btn)   => openSellInvModal(btn.dataset.id, btn.dataset.indices, Number(btn.dataset.prix), btn.dataset.name),
  openSendInvModal:         (btn)   => openSendInvModal(btn.dataset.id, btn.dataset.indices, btn.dataset.name),
  openDeleteInvModal:       (btn)   => openDeleteInvModal(btn.dataset.id, btn.dataset.indices, btn.dataset.name),
  saveInvPersonalLine:      (el)    => saveInvPersonalLine(el.dataset.id, el.dataset.indices, el),
  sellInvItemBulk:          (btn)   => sellInvItemBulk(btn.dataset.id, btn.dataset.indices, Number(btn.dataset.prix)),
  deleteInvItemBulk:        (btn)   => deleteInvItemBulk(btn.dataset.id, btn.dataset.indices),
  sendInvItem:              (btn)   => sendInvItem(btn.dataset.id, btn.dataset.indices),
  sendGold:                 (btn)   => sendGold(btn.dataset.id),
  saveInvItemFromShop:      ()      => saveInvItemFromShop(),
  saveInvItem:              (btn)   => saveInvItem(Number(btn.dataset.idx)),
  editInvItem:              (btn)   => editInvItem(Number(btn.dataset.idx)),
  filterInvClear:           (btn)   => { filterInvRows(''); const w = btn.closest('.inv-search-wrap'); if (w) w.querySelector('input').value = ''; },

  // Sorts
  addSort:                  ()      => addSort(),
  toggleSort:               (btn)   => toggleSort(Number(btn.dataset.idx), btn),
  editSort:                 (btn)   => editSort(Number(btn.dataset.idx)),
  duplicateSort:            (btn)   => duplicateSort(Number(btn.dataset.idx)),
  setSortValidation:        (btn)   => setSortValidation(Number(btn.dataset.idx), btn.dataset.val),
  deleteSort:               (btn)   => deleteSort(Number(btn.dataset.idx)),

  // Tabs legacy (renderCharCarac, renderCharNotes, renderCharCompte, renderCharMaitrises, renderCharProfil)
  toggleNote:               (btn)   => toggleNote(Number(btn.dataset.idx)),
  editNoteTitle:            (btn)   => editNoteTitle(Number(btn.dataset.idx)),
  addCompteRow:             (btn)   => addCompteRow(btn.dataset.compteType),
  deleteCompteRow:          (btn)   => deleteCompteRow(btn.dataset.compteType, Number(btn.dataset.idx)),
  saveCompteField:          (el)    => saveCompteField(el.dataset.compteType, Number(el.dataset.idx), el.dataset.field, el.value),
  _toggleCompteHist:        (btn)   => toggleCompteHist(btn.dataset.compteType, Number(btn.dataset.count)),
  _csAddXp:                 (btn)   => addXpFromInput(btn.dataset.id),
  _csLevelUp:               (btn)   => levelUpChar(btn.dataset.id),
  _allocStatPoint:          (btn)   => allocStatPoint(btn.dataset.id, btn.dataset.key, Number(btn.dataset.delta)),
  _adjVitalBase:            (btn)   => adjVitalBase(btn.dataset.id, btn.dataset.field, Number(btn.dataset.delta)),
  saveMaitrise:             (btn)   => saveMaitrise(Number(btn.dataset.idx)),
  deleteMaitrise:           (btn)   => deleteMaitrise(Number(btn.dataset.idx)),
});

charSession.bindRender(_renderTab, renderCharSheet, refreshOrDisplay);

// Les popovers de l'identité se ferment au clic extérieur sans re-rendre toute
// la fiche : la cible extérieure reste en place et reçoit normalement son clic.
document.addEventListener('pointerdown', (e) => {
  if (!_identityUi.popover) return;
  if (e.target.closest?.('.ids-pop, [data-action="toggleIdentityPopover"]')) return;
  _identityUi.popover = null;
  _removeIdentityPopover();
}, true);

// Navigation clavier des onglets de fiche (pattern WAI-ARIA tablist) :
// ← → bouclent, Home/End vont au premier/dernier, activation automatique au focus.
// Listener délégué unique (module importé une seule fois en lazy).
document.addEventListener('keydown', (e) => {
  const identityInput = e.target.closest?.('#cs-sidebar .ids-inline');
  if (identityInput && e.key === 'Enter') {
    e.preventDefault();
    identityInput.blur();
    return;
  }
  if (identityInput && e.key === 'Escape') {
    e.preventDefault();
    identityInput.value = identityInput.dataset.original || '';
    identityInput.blur();
    return;
  }
  if (e.key === 'Escape' && _identityUi.popover) {
    const c = charSession.getCurrentChar();
    if (!c) return;
    e.preventDefault();
    _identityUi.popover = null;
    _removeIdentityPopover();
    return;
  }
  const tab = e.target.closest?.('#char-tabs-v3 .tab-v3[role="tab"]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const tabs = [...document.querySelectorAll('#char-tabs-v3 .tab-v3[role="tab"]')];
  const i = tabs.indexOf(tab);
  const next = e.key === 'Home' ? tabs[0]
    : e.key === 'End' ? tabs[tabs.length - 1]
    : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length]
    : tabs[(i + 1) % tabs.length];
  if (next) { next.focus(); showCharTab(next.dataset.tab, next); }
});
