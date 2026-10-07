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
  _getTraits, getEquippedInventoryIndexMap, getArmorTypeMeta, getArmorSetData,
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
import { setRouteSub } from '../shared/route.js';
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
let _combatTabUi = { charId: '', selected: '', open: false, candidates: false };
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
  editing: false,
  draft: null,
  vitalBreakdown: null,
};

function _identityStateFor(c) {
  if (_identityUi.charId !== c?.id) {
    _identityUi.charId = c?.id || null;
    _identityUi.popover = null;
    _identityUi.editing = false;
    _identityUi.draft = null;
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
    data-nav-sub="${c.id}/${t.k}">
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
  if (ui.popover === 'appearance') {
    if (!canEdit) return '';
    const isCustom = !!c.auraColor;
    return `<section class="ids-pop ids-pop-look" role="dialog" aria-label="Apparence du personnage">
      <span class="ids-pop-kicker">Apparence</span>
      <button class="ids-photo-btn" data-action="open-character-photo" data-charid="${c.id}">Choisir une photo</button>
      <div class="ids-pop-divider"></div>
      <span class="ids-pop-kicker">Aura</span>
      <p class="ids-aura-help">Couleur de l'anneau d'expérience autour du portrait.</p>
      <div class="ids-aura">
        ${Object.entries(AURA_PALETTE).map(([key, color]) => `<button class="ids-dot${!isCustom && (c.aura || 'blue') === key ? ' active' : ''}"
          style="--dot-c:${color}" data-aura-key="${key}" data-action="setCharAura" data-id="${c.id}" title="${key}"></button>`).join('')}
        <label class="ids-dot custom${isCustom ? ' active' : ''}" style="--dot-c:${_auraHex(c)}" title="Couleur personnalisée">
          <input type="color" value="${_auraHex(c)}" data-change="setCharAuraColor" data-id="${c.id}">
        </label>
      </div>
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

function _identityFormHtml(c) {
  const ui = _identityStateFor(c);
  const draft = ui.draft || { nom: c.nom || '', classe: c.classe || '', race: c.race || '', titres: [...(c.titres || [])] };
  ui.draft = draft;
  return `<div class="ids-edit" data-identity-edit="${c.id}">
    <label>Nom<input data-identity-field="nom" maxlength="80" value="${_esc(draft.nom)}"></label>
    <div class="ids-edit-pair">
      <label>Classe<input data-identity-field="classe" maxlength="60" value="${_esc(draft.classe)}" list="identity-class-list"></label>
      <label>Race<input data-identity-field="race" maxlength="60" value="${_esc(draft.race)}" list="identity-race-list"></label>
    </div>
    <datalist id="identity-class-list"><option>Guerrier</option><option>Mage</option><option>Voleur</option><option>Clerc</option><option>Rôdeur</option><option>Barde</option></datalist>
    <datalist id="identity-race-list"><option>Humain</option><option>Elfe</option><option>Demi-Elfe</option><option>Nain</option><option>Halfelin</option><option>Tieffelin</option></datalist>
    <label>Titres</label>${_characterTitlesHtml(c, true, draft.titres, true)}
    <div class="ids-edit-actions"><button data-action="identityCancelEdit">Annuler</button><button class="primary" data-action="identitySaveEdit" data-id="${c.id}">Enregistrer</button></div>
  </div>`;
}

function _buildSidebarHtml(c, canEdit, { pvCur, pvMax, pvPct, hpBarCls, pmCur, pmMax, pmPct, xpCur, xpPalier, xpPct, deckActifs, deckFree, deckMax }) {
  const ui = _identityStateFor(c);
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
        ${c.photo
          ? `<button type="button" class="ids-portrait-in is-clickable" data-action="openCharacterPortraitViewer" data-id="${c.id}" title="Afficher le portrait en entier" aria-label="Afficher le portrait de ${_esc(c.nom || 'ce personnage')} en entier">${characterPortraitContent(c, { imgStyle: `transform:scale(${c.photoZoom || 1}) translate(${c.photoX || 0}px,${c.photoY || 0}px);transform-origin:center`, fallbackTag: 'span' })}</button>`
          : `<div class="ids-portrait-in">${characterPortraitContent(c, { fallbackTag: 'span' })}</div>`}
        ${canEdit ? `<button class="ids-portrait-edit" data-action="toggleIdentityPopover" data-popover="appearance" data-id="${c.id}" title="Modifier l'apparence">✎</button>` : ''}
        <button class="ids-level" data-action="toggleIdentityPopover" data-popover="xp" data-id="${c.id}" title="Voir la progression"><small>NIV</small>${c.niveau || 1}</button>
      </div>
      ${ui.editing ? _identityFormHtml(c) : `<div class="ids-copy"><h2>${_esc(c.nom || 'Sans nom')}</h2><p>${classRace}</p>
        ${canEdit ? `<button type="button" class="ids-life is-${lifeStatus}" data-action="toggleIdentityPopover" data-popover="status" data-id="${c.id}" title="Modifier l’état du personnage" aria-label="État : ${lifeStatusLabel}. Modifier">
          <i aria-hidden="true"></i>
          <span>${lifeStatusLabel}</span>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5l3-3"/></svg>
        </button>` : `<span class="ids-life is-${lifeStatus}" title="État du personnage"><i aria-hidden="true"></i><span>${lifeStatusLabel}</span></span>`}
        ${_characterTitlesHtml(c, false)}
        <button class="ids-xp-line${ready ? ' ready' : ''}" data-action="toggleIdentityPopover" data-popover="xp" data-id="${c.id}">${ready ? `<b>Niveau ${(c.niveau || 1) + 1} prêt</b><span>· gérer</span>` : `<b>${_identityNumber(xpCur)}</b><span>/ ${_identityNumber(xpPalier)} XP · encore ${_identityNumber(Math.max(0, xpPalier - xpCur))}</span>`}</button>
        ${canEdit ? `<button class="ids-edit-open" data-action="identityStartEdit" data-id="${c.id}">✎ Modifier l'identité</button>` : ''}
      </div>`}
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
    ${canEdit ? `<button type="button" class="ids-build-more${menuOpen ? ' is-open' : ''}" data-action="toggleIdentityPopover" data-popover="builds" data-id="${c.id}" title="Gérer les builds" aria-label="Gérer les builds" aria-expanded="${menuOpen}">⋯</button>` : ''}
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

function _characterTitlesHtml(c, canEdit, values = c.titres, draftMode = false) {
  const titres = Array.isArray(values) ? values : [];
  if (!titres.length && !canEdit) return '';
  if (!draftMode) return `<div class="ids-titles">${titres.map(_esc).join('<span aria-hidden="true"> · </span>')}</div>`;
  return `<div class="ids-title-editor">
    <div class="ids-title-list" id="identity-title-list-${_esc(c.id)}">
      ${titres.map((titre, index) => `<div class="ids-title-item">
        <span class="ids-title-handle" title="Glisser pour réordonner" aria-hidden="true">⠿</span>
        <input data-identity-title data-index="${index}" value="${_esc(titre)}" maxlength="80" aria-label="Titre ${index + 1}">
        <button data-action="identityRemoveTitle" data-index="${index}" title="Retirer ce titre" aria-label="Retirer ce titre">×</button>
      </div>`).join('')}
    </div>
    <div class="ids-title-new"><input id="identity-title-new-${_esc(c.id)}" placeholder="Nouveau titre…" maxlength="80" data-enter-click="#identity-title-add-${_esc(c.id)}"><button id="identity-title-add-${_esc(c.id)}" data-action="identityAddTitle" data-id="${c.id}" aria-label="Ajouter le titre">＋</button></div>
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
    onEnd: () => {
      _identityUi.draft.titres = [...host.querySelectorAll('[data-identity-title]')]
        .map(input => input.value.trim())
        .filter(Boolean);
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

function _readIdentityDraft(c) {
  const ui = _identityStateFor(c);
  if (!ui.draft) ui.draft = { nom: c.nom || '', classe: c.classe || '', race: c.race || '', titres: [...(c.titres || [])] };
  document.querySelectorAll('[data-identity-field]').forEach(input => { ui.draft[input.dataset.identityField] = input.value; });
  const titleInputs = [...document.querySelectorAll('[data-identity-title]')];
  if (titleInputs.length) ui.draft.titres = titleInputs.map(input => input.value.trim()).filter(Boolean);
  return ui.draft;
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
    const anchor = ui.popover === 'appearance'
      ? side.querySelector('.ids-portrait') || btn
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

function _openCharacterPortraitViewer(btn) {
  const c = getCharacterById(btn.dataset.id) || charSession.getCurrentChar();
  if (!c?.photo) return;
  openImageLightbox({
    src: c.photoOriginal || c.photo,
    alt: `Portrait complet de ${c.nom || 'ce personnage'}`,
  });
}

function _identityStartEdit(btn) {
  const c = getCharacterById(btn.dataset.id);
  if (!c || !canControlCharacter(c)) return;
  const ui = _identityStateFor(c);
  ui.editing = true;
  ui.popover = null;
  ui.draft = { nom: c.nom || '', classe: c.classe || '', race: c.race || '', titres: [...(c.titres || [])] };
  _rerenderIdentity(c, '[data-identity-field="nom"]');
}

function _identityCancelEdit() {
  const c = charSession.getCurrentChar();
  if (!c) return;
  const ui = _identityStateFor(c);
  ui.editing = false;
  ui.draft = null;
  _rerenderIdentity(c);
}

function _identityAddTitle(btn) {
  const c = getCharacterById(btn.dataset.id) || charSession.getCurrentChar();
  if (!c) return;
  const draft = _readIdentityDraft(c);
  const input = document.getElementById(`identity-title-new-${c.id}`);
  const title = input?.value.trim();
  if (!title) { input?.focus(); return; }
  if (draft.titres.some(item => _norm(item) === _norm(title))) { showNotif('Ce titre est déjà présent.', 'info'); input.select(); return; }
  draft.titres.push(title);
  _rerenderIdentity(c, `#identity-title-new-${c.id}`);
}

function _identityRemoveTitle(btn) {
  const c = charSession.getCurrentChar();
  if (!c) return;
  const draft = _readIdentityDraft(c);
  draft.titres.splice(Number(btn.dataset.index), 1);
  _rerenderIdentity(c);
}

async function _identitySaveEdit(btn) {
  const c = getCharacterById(btn.dataset.id);
  if (!c || !canControlCharacter(c)) return;
  const previous = { nom: c.nom, classe: c.classe, race: c.race, titres: [...(c.titres || [])] };
  const draft = _readIdentityDraft(c);
  const payload = {
    nom: draft.nom.trim() || 'Sans nom',
    classe: draft.classe.trim(),
    race: draft.race.trim(),
    titres: [...new Map(draft.titres.map(title => [title.trim().toLocaleLowerCase('fr'), title.trim()])).values()].filter(Boolean),
  };
  Object.assign(c, payload);
  try {
    await updateInCol('characters', c.id, payload);
    _identityUi.editing = false;
    _identityUi.draft = null;
    showNotif('Identité mise à jour.', 'success');
  } catch (error) {
    Object.assign(c, previous);
    notifySaveError(error);
  }
  renderCharSheet(c, charSession.getCurrentCharTab() || 'combat');
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
  setRouteSub('characters', `${c.id}/${v3Tab}`);

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
  const equip = c.equipement || {};
  const inventory = Array.isArray(c.inventaire) ? c.inventaire : [];
  const slotDefs = getEquipmentSlots();
  const weaponSlots = slotDefs.filter(slot => slot.kind === 'weapon');
  const armorSlots = slotDefs.filter(slot => slot.kind !== 'weapon');
  const primarySlot = getPrimaryWeaponSlotId();
  const secondarySlot = getSecondaryWeaponSlotId();
  const equippedInvMap = (() => {
    try { return getEquippedInventoryIndexMap?.(c) || new Map(); }
    catch { return new Map(); }
  })();
  const sourceItem = (slot, fallback = {}) => {
    const index = [...equippedInvMap.entries()].find(([, slots]) => slots.includes(slot))?.[0];
    return Number.isInteger(index) ? (inventory[index] || fallback) : fallback;
  };
  const currentItem = slot => {
    const raw = equip[slot] || {};
    if (slot === primarySlot && !raw.nom && !equip[secondarySlot]?.nom) {
      try { return getMainWeapon(c) || raw; } catch { return raw; }
    }
    return raw;
  };
  const isDefaultItem = (slot, item) => slot === primarySlot && !equip[slot]?.nom && Boolean(item?.isDefault);
  const rarity = (slot, item) => {
    const live = sourceItem(slot, item);
    const level = parseInt(live?.rarete ?? item?.rarete) || 0;
    const label = RARETE_NAMES[level] || '';
    return { level, label, color: label ? _rareteColor(label) : '#7a8fa8' };
  };
  const family = item => item?.typeArme || item?.sousType || item?.format || '';
  const plainStyleName = style => String(style?.label || style?.name || 'Sans style')
    .replace(/^[^\p{L}\p{N}]+/u, '').trim() || 'Sans style';
  const selectedClass = key => _combatTabUi.selected === key ? ' is-selected' : '';

  if (_combatTabUi.charId !== String(c.id || '')) {
    _combatTabUi = { charId: String(c.id || ''), selected: `weapon:${primarySlot}`, open: false, candidates: false };
  }
  if (!_combatTabUi.selected) _combatTabUi.selected = `weapon:${primarySlot}`;

  if (!_combatTabCache.styles) {
    loadCombatStyles().then(styles => {
      _combatTabCache.styles = styles || [];
      if (charSession.getCurrentChar()?.id === c.id && charSession.getCurrentCharTab() === 'combat') _renderTabV3('combat', c, canEdit);
    }).catch(() => { _combatTabCache.styles = []; });
  }
  if (!_combatTabCache.dmgTypes) {
    loadDamageTypes().then(types => {
      _combatTabCache.dmgTypes = types || [];
      if (charSession.getCurrentChar()?.id === c.id && charSession.getCurrentCharTab() === 'combat') _renderTabV3('combat', c, canEdit);
    }).catch(() => { _combatTabCache.dmgTypes = []; });
  }

  const styles = _combatTabCache.styles || [];
  const damageTypes = _combatTabCache.dmgTypes || [];
  let activeStyle = null;
  try { activeStyle = detectCombatStyle?.(c, styles); } catch (error) { console.warn('[style detect]', error); }
  const styleColor = activeStyle?.couleur || activeStyle?.color || '#7a8fa8';
  const styleName = activeStyle ? plainStyleName(activeStyle) : 'Aucun style détecté';
  const styleRules = activeStyle ? combatStyleRuleLabels(activeStyle) : [];
  const mainWeapon = currentItem(primarySlot);
  const damageContextFor = item => resolveWeaponDamageContext(_weaponFormats || [], damageTypes, item || {}, c.elements || []);
  const missRuleFor = context => {
    const rules = getDamageTypeRules(damageTypes, context.damageTypeId || 'physique');
    const effect = getAttackMissEffect({
      damageTypeId: context.damageTypeId,
      isMagicWeapon: context.isMagic,
      typeRules: rules,
    }, damageTypes);
    return effect === 'full'
      ? { tone: 'arc', label: 'Échec : dégâts complets', detail: 'Échec critique : 0 dégât' }
      : effect === 'half'
        ? { tone: 'arc', label: 'Échec : ½ dégâts', detail: 'Échec critique : 0 dégât' }
        : { tone: 'muted', label: 'Échec : 0 dégât', detail: 'Aucun dégât si la CA résiste' };
  };
  const damageContext = damageContextFor(mainWeapon);
  const missRule = missRuleFor(damageContext);
  const ruleTone = tone => ({ reaction: 'pos', positive: 'pos', warning: 'warn', arcane: 'arc', muted: 'muted' }[tone] || 'muted');
  const rulesHtml = [
    ...styleRules.map(rule => `<span class="cb-rule ${ruleTone(rule.tone)}" title="${_esc(rule.detail)}">${_esc(rule.label)}</span>`),
    `<span class="cb-rule ${missRule.tone}" title="${_esc(missRule.detail)}">${_esc(missRule.label)}</span>`,
  ].join('');

  const weaponData = slotDef => {
    const item = currentItem(slotDef.id);
    const locked = slotDef.id === secondarySlot && weaponHands(currentItem(primarySlot)) === 2;
    const isDefault = isDefaultItem(slotDef.id, item);
    const statKey = item?.statAttaque === 'dexterite' ? 'dexterite'
      : item?.statAttaque === 'intelligence' ? 'intelligence' : 'force';
    let toucher = null, degats = null;
    try { toucher = item?.nom ? getWeaponToucherParts(c, item, statKey) : null; } catch {}
    try { degats = item?.nom ? getWeaponDegatsParts(c, item, statKey) : null; } catch {}
    return { slotDef, item, locked, isDefault, toucher, degats, damageContext: damageContextFor(item), traits: item?.nom ? (_getTraits(sourceItem(slotDef.id, item)) || []) : [] };
  };
  const weapons = weaponSlots.map(weaponData);
  const equipmentBonusChips = (slot, item, ca = 0) => {
    const badges = _itemBonusBadges(sourceItem(slot, item));
    if (ca) badges.unshift({ lbl: `CA +${ca}`, cls: 'derived-tone derived-ca' });
    if (!badges.length) return '';
    return `<span class="cb-item-bonuses">${badges.map(badge => `<i class="badge-chip ${_esc(badge.cls)}">${_esc(badge.lbl)}</i>`).join('')}</span>`;
  };
  const weaponCard = data => {
    const { slotDef, item, locked, isDefault, toucher, degats, damageContext: itemDamageContext, traits } = data;
    const key = `weapon:${slotDef.id}`;
    if (locked) {
      return `<div class="cb-w is-locked"><div class="cb-w-head"><div><span class="cb-k">${_esc(slotDef.label)}</span><strong>Prise par l’arme</strong></div></div><p>${_esc(currentItem(primarySlot).nom)} se tient à deux mains.</p></div>`;
    }
    if (!item?.nom) {
      return `<button type="button" class="cb-w is-empty${selectedClass(key)}" data-action="selectCombatDetail" data-detail="${_esc(key)}" data-empty="true"><div class="cb-w-head"><div><span class="cb-k">${_esc(slotDef.label)}</span><strong>Main libre</strong></div></div><p>Rien en main. <b>Équiper…</b></p></button>`;
    }
    const rare = rarity(slotDef.id, item);
    const handLabel = isDefault ? 'Par défaut' : weaponHands(item) === 2 ? '2 mains' : family(item) || '1 main';
    const head = `<div class="cb-w-head"><div><span class="cb-k">${_esc(slotDef.label)}</span><strong class="${isDefault ? 'is-default' : ''}">${_esc(item.nom)}</strong></div><span class="cb-tag">${_esc(handLabel)}</span></div>`;
    const bonusChips = equipmentBonusChips(slotDef.id, item);
    if (!degats) {
      const effect = item.particularite || getItemEffectText(item) || 'Objet de soutien tenu en main.';
      return `<button type="button" class="cb-w is-focus${selectedClass(key)}" style="--cb-rare:${_esc(rare.color)}" data-action="selectCombatDetail" data-detail="${_esc(key)}">${head}<span class="cb-focus-effect">${_esc(effect)}</span>${bonusChips}<span class="cb-w-meta">${[family(item), ...traits].filter(Boolean).map(_esc).join(' · ')}</span></button>`;
    }
    const type = damageTypes.find(entry => entry.id === itemDamageContext.damageTypeId);
    const damageLabel = type?.label || (itemDamageContext.isMagic ? 'Magique' : 'Physique');
    const damageColor = type?.color || (itemDamageContext.isMagic ? '#bca0ff' : 'var(--text-muted)');
    return `<button type="button" class="cb-w${selectedClass(key)}" style="--cb-rare:${_esc(rare.color)};--cb-damage:${_esc(damageColor)}" data-action="selectCombatDetail" data-detail="${_esc(key)}">${head}<span class="cb-rolls"><span class="cb-roll"><small>Toucher</small><b>${_esc(toucher?.roll || '—')}</b></span><span class="cb-roll"><small>Dégâts</small><b>${_esc(degats.roll)}</b><em>${_esc(damageLabel)}</em></span></span>${bonusChips}<span class="cb-w-meta">${[item.portee, family(item), ...traits].filter(Boolean).map(_esc).join(' · ')}</span></button>`;
  };

  const armorSet = (() => { try { return getArmorSetData(c) || {}; } catch { return {}; } })();
  const tracked = new Set(armorSet.trackedSlots || []);
  const setPips = (armorSet.slots || []).map(entry => {
    const color = entry.type ? (getArmorTypeMeta(entry.type)?.color || '#7a8fa8') : '';
    return `<i class="${entry.equipped ? 'is-on' : ''}" style="--cb-pip:${_esc(color)}"></i>`;
  }).join('');
  let setHint = '';
  if ((armorSet.trackedSlots || []).length && !armorSet.isActive) {
    // Nouvelle règle (paliers) : une pièce d'un autre type ne casse plus le set,
    // elle ne compte juste pas. On guide vers le prochain palier du type dominant.
    const domType = armorSet.dominantType || '';
    const domCount = (armorSet.counts || {})[domType] || 0;
    const domTiers = domType ? (getArmorTypeMeta(domType)?.set?.tiers || []) : [];
    const maxPieces = armorSet.trackedSlots.length;
    const nextTier = domTiers
      .map(t => Math.min(t.pieces, maxPieces))
      .filter(p => p > domCount)
      .sort((a, b) => a - b)[0];
    setHint = nextTier != null
      ? `Encore ${nextTier - domCount} pièce${nextTier - domCount > 1 ? 's' : ''} ${domType} pour le ${nextTier === maxPieces ? 'set complet' : `palier à ${nextTier} pièces`}.`
      : 'Aucun bonus d’ensemble configuré pour ce type.';
  }
  const activeSetName = armorSet.activeEffect?.set?.label || armorSet.fullType || '';
  const activeSetEffect = armorSet.activeEffect?.chipText || '';
  const setChip = (armorSet.trackedSlots || []).length
    ? `<span class="cb-set${armorSet.isActive ? ' is-on' : ''}" title="${_esc(activeSetEffect || setHint)}"><span class="cb-pips">${setPips}</span><b>${armorSet.isActive ? _esc(activeSetName) : `Set ${armorSet.equippedCount || 0}/${armorSet.trackedSlots.length}`}</b>${armorSet.isActive && activeSetEffect ? `<span>${_esc(activeSetEffect)}</span>` : ''}</span>`
    : '';
  const armorCard = slotDef => {
    const raw = equip[slotDef.id] || {};
    const item = sourceItem(slotDef.id, raw);
    const key = `armor:${slotDef.id}`;
    if (!item?.nom) return `<button type="button" class="cb-slot is-empty${selectedClass(key)}" data-action="selectCombatDetail" data-detail="${_esc(key)}" data-empty="true"><span class="cb-slot-label">${_esc(slotDef.label)}</span><b>Vide</b><span>Équiper…</span></button>`;
    const rare = rarity(slotDef.id, item);
    const armorType = item.typeArmure ? getArmorTypeMeta(item.typeArmure) : null;
    const ca = (parseInt(item.ca) || 0) + (parseInt(item.caBonus) || 0);
    const summary = item.typeArmure ? (armorType?.label || item.typeArmure) : 'Équipé';
    return `<button type="button" class="cb-slot${selectedClass(key)}" style="--cb-rare:${_esc(rare.color)}" data-action="selectCombatDetail" data-detail="${_esc(key)}"><span class="cb-slot-label">${_esc(slotDef.label)}${tracked.has(slotDef.id) && item.typeArmure ? `<i style="--cb-pip:${_esc(armorType?.color || '#7a8fa8')}" title="Compte pour le set"></i>` : ''}</span><b>${_esc(item.nom)}</b><span class="cb-slot-summary">${_esc(summary)}</span>${equipmentBonusChips(slotDef.id, item, ca)}</button>`;
  };

  const heldFamilies = weapons.filter(entry => entry.item?.nom && !entry.isDefault).map(entry => _norm(family(entry.item)));
  const masteryRows = (c.maitrises || []).map((mastery, index) => {
    const name = mastery.typeArme || mastery.nom || mastery.name || 'Sans type';
    const level = Math.max(0, Math.min(5, parseInt(mastery.niveau) || 0));
    const inHand = heldFamilies.some(value => value && (value.includes(_norm(name)) || _norm(name).includes(value)));
    return `<button type="button" class="cb-mastery${selectedClass(`mastery:${index}`)}" data-action="selectCombatDetail" data-detail="mastery:${index}"><b>${_esc(name)}${inHand ? '<em>En main</em>' : ''}</b><span class="cb-mastery-pips">${Array.from({ length: 5 }, (_, pip) => `<i class="${pip < level ? 'is-on' : ''}"></i>`).join('')}</span><span>${level ? `+${level} dégât${level > 1 ? 's' : ''}` : 'Initié'}</span></button>`;
  }).join('');
  const charElements = c.elements || [];
  const elementChips = damageTypes.length ? getMagicTypes(damageTypes).map(type => {
    const active = charElements.includes(type.id);
    const favorite = active && c.favoriteElement === type.id;
    const toggle = canEdit && STATE.isAdmin ? `data-action="toggleCharElement" data-id="${_esc(c.id)}" data-elem="${_esc(type.id)}" title="${active ? 'Retirer' : 'Accorder'} cet élément (MJ)"` : '';
    const fav = active && canEdit
      ? `<button type="button" class="cb-element-fav${favorite ? ' is-on' : ''}" data-action="setFavoriteElement" data-id="${_esc(c.id)}" data-elem="${_esc(type.id)}" aria-pressed="${favorite}">${favorite ? '★' : '☆'}</button>`
      : favorite ? '<span class="cb-element-fav is-on">★</span>' : '';
    return `<span class="cb-element${active ? ' is-on' : ''}${toggle ? ' is-editable' : ''}" style="--cb-element:${_esc(type.color || '#9ca3af')}" ${toggle}><i></i>${_esc(type.label)}${fav}</span>`;
  }).join('') : loadingHtml('Chargement…', { compact: true });

  const calcBlock = (rows, total) => `<div class="cb-calc">${rows.filter(Boolean).map(([label, value]) => `<div><span>${_esc(label)}</span><b>${_esc(value)}</b></div>`).join('')}<div class="cb-calc-total"><span>Total</span><b>${_esc(total)}</b></div></div>`;
  const chips = (values, tone = '') => values?.length ? `<div class="cb-chips">${values.map(value => `<span class="${tone}">${_esc(value)}</span>`).join('')}</div>` : '';
  const detailShell = ({ color = '#7a8fa8', kicker, title, tags = [], body = '', footer = '' }) => `<aside class="cb-detail"><header style="--cb-detail:${_esc(color)}"><button type="button" class="cb-detail-close" data-action="closeCombatDetail" aria-label="Fermer">×</button><span>${_esc(kicker)}</span><h4>${_esc(title)}</h4>${tags.length ? `<div>${tags.map(tag => `<i>${_esc(tag)}</i>`).join('')}</div>` : ''}</header><div class="cb-detail-body">${body}</div>${footer ? `<footer>${footer}</footer>` : ''}</aside>`;
  const compatibleCandidates = (slotDef, selectedItem) => inventory.map((item, index) => ({ item, index })).filter(({ item, index }) => {
    if (!item?.nom || !equipmentSlotAcceptsItem(slotDef, item)) return false;
    if ((equippedInvMap.get(index) || []).length) return false;
    if (slotDef.id === secondarySlot && weaponHands(item) === 2) return false;
    return index !== selectedItem?.sourceInvIndex;
  });
  const candidateList = (slotDef, selectedItem) => {
    const candidates = compatibleCandidates(slotDef, selectedItem);
    if (!candidates.length) return '<p class="cb-empty-copy">Rien de compatible dans le sac.</p>';
    return `<div class="cb-candidates">${candidates.map(({ item, index }) => {
      const level = parseInt(item.rarete) || 0;
      const label = RARETE_NAMES[level] || '';
      const color = label ? _rareteColor(label) : '#7a8fa8';
      let summary = '';
      let warning = '';
      if (slotDef.kind === 'weapon') {
        const statKey = item.statAttaque || item.toucherStat || 'force';
        const hit = getWeaponToucherParts(c, item, statKey);
        const dmg = getWeaponDegatsParts(c, item, statKey);
        summary = dmg ? `${hit.roll} · ${dmg.roll}${weaponHands(item) === 2 ? ' · 2 mains' : ''}` : (item.particularite || getItemEffectText(item));
        if (slotDef.id === primarySlot && weaponHands(item) === 2 && equip[secondarySlot]?.nom) warning = `Range ${equip[secondarySlot].nom}`;
      } else {
        const ca = (parseInt(item.ca) || 0) + (parseInt(item.caBonus) || 0);
        summary = [item.typeArmure, ca ? `CA +${ca}` : '', ..._itemBonusBadges(item).map(badge => badge.lbl)].filter(Boolean).join(' · ');
        if (tracked.has(slotDef.id) && armorSet.dominantType && item.typeArmure && _norm(item.typeArmure) !== _norm(armorSet.dominantType) && armorSet.equippedCount >= 2) warning = `Casse le set ${armorSet.dominantType}`;
      }
      return `<article class="cb-candidate" style="--cb-rare:${_esc(color)}"><div><b>${_esc(item.nom)}</b><span class="${warning ? 'is-warning' : ''}">${_esc(warning || summary || 'Compatible')}</span></div><button type="button" class="cb-btn" data-action="equipInventoryItem" data-index="${index}" data-slot="${_esc(slotDef.id)}" data-render-tab="combat">Équiper</button></article>`;
    }).join('')}</div>`;
  };

  const renderDetail = () => {
    const [kind, rawId] = _combatTabUi.selected.split(':');
    if (kind === 'weapon') {
      const slotDef = weaponSlots.find(slot => slot.id === rawId) || weaponSlots[0];
      if (!slotDef) return '';
      const data = weapons.find(entry => entry.slotDef.id === slotDef.id) || weaponData(slotDef);
      const { item, isDefault, toucher, degats, damageContext: itemDamageContext, traits } = data;
      const rare = rarity(slotDef.id, item);
      const candidates = _combatTabUi.candidates || !item?.nom ? `<section><h5>Dans le sac</h5>${candidateList(slotDef, item)}</section>` : '';
      if (!item?.nom) return detailShell({ color: '#7a8fa8', kicker: slotDef.label, title: 'Main libre', body: `<section><p>Rien en main. Une arme ou un objet de soutien modifiera automatiquement le style actif.</p></section>${candidates}` });
      const tags = [isDefault ? 'Par défaut' : rare.label, weaponHands(item) === 2 ? '2 mains' : '1 main', family(item)].filter(Boolean);
      let body = candidates;
      if (degats) {
        body += `<section><h5>Jet d’attaque</h5>${calcBlock([
          ['Dé', '1d20'],
          toucher?.statLabel ? [`Modificateur ${toucher.statLabel}`, modStr(toucher.statMod || 0)] : null,
          toucher?.setBonus ? ['Bonus de set', modStr(toucher.setBonus)] : null,
        ], toucher?.roll || '—')}</section>`;
        body += `<section><h5>Dégâts</h5>${calcBlock([
          ['Dé de l’arme', item.degats || '—'],
          degats.statLabel ? [`Modificateur ${degats.statLabel}`, modStr(degats.statMod || 0)] : null,
          degats.maitriseBonus ? ['Bonus de maîtrise', modStr(degats.maitriseBonus)] : null,
        ], degats.roll)}</section>`;
        const itemMissRule = missRuleFor(itemDamageContext);
        body += `<section><h5>Si la CA résiste</h5><p>${_esc(itemMissRule.label.replace('Échec : ', ''))}${itemDamageContext.isMagic ? ' · arme de nature magique.' : ' · arme de nature physique.'}</p></section>`;
      } else {
        body += `<section><h5>Effet</h5><p>${_esc(item.particularite || getItemEffectText(item) || 'Objet de soutien.')}</p></section>`;
      }
      if (item.portee) body += `<section><h5>Portée</h5><p>${_esc(item.portee)}</p></section>`;
      const bonusLabels = _itemBonusBadges(sourceItem(slotDef.id, item)).map(badge => badge.lbl);
      if (bonusLabels.length || traits.length) body += `<section><h5>Bonus et traits</h5>${chips(bonusLabels, 'is-stat')}${chips(traits, 'is-trait')}</section>`;
      if (item.particularite && degats) body += `<section><h5>Particularité</h5><p class="cb-editorial">${_esc(item.particularite)}</p></section>`;
      const footer = canEdit ? `<button type="button" class="cb-btn${_combatTabUi.candidates ? ' is-primary' : ''}" data-action="toggleCombatCandidates">${_combatTabUi.candidates ? 'Masquer le sac' : 'Changer…'}</button>${!isDefault ? `<button type="button" class="cb-btn is-danger" data-action="clearEquipSlot" data-slot="${_esc(slotDef.id)}" data-render-tab="combat">Ranger</button>` : ''}` : '';
      return detailShell({ color: isDefault ? '#7a8fa8' : rare.color, kicker: slotDef.label, title: item.nom, tags, body, footer });
    }
    if (kind === 'armor') {
      const slotDef = armorSlots.find(slot => slot.id === rawId) || armorSlots[0];
      if (!slotDef) return '';
      const raw = equip[slotDef.id] || {};
      const item = sourceItem(slotDef.id, raw);
      const rare = rarity(slotDef.id, item);
      const candidates = _combatTabUi.candidates || !item?.nom ? `<section><h5>Dans le sac</h5>${candidateList(slotDef, item)}</section>` : '';
      if (!item?.nom) return detailShell({ color: '#7a8fa8', kicker: slotDef.label, title: 'Emplacement libre', body: candidates });
      const armorMeta = item.typeArmure ? getArmorTypeMeta(item.typeArmure) : null;
      const ca = (parseInt(item.ca) || 0) + (parseInt(item.caBonus) || 0);
      const bonusLabels = _itemBonusBadges(item).map(badge => badge.lbl);
      const traits = _getTraits(item) || [];
      let body = candidates;
      if (ca) body += `<section><h5>Classe d’armure</h5><p>+${ca} à la CA · total actuel ${calcCA(c)}.</p></section>`;
      if (bonusLabels.length || traits.length) body += `<section><h5>Bonus et traits</h5>${chips(bonusLabels, 'is-stat')}${chips(traits, 'is-trait')}</section>`;
      if (tracked.has(slotDef.id)) body += `<section><h5>Ensemble</h5><p>${armorSet.isActive ? `Pièce du set ${activeSetName} · ${activeSetEffect}` : `Compte pour le set d’armure (${armorSet.equippedCount || 0}/${armorSet.trackedSlots.length} pièces).`}</p></section>`;
      if (item.particularite || getItemEffectText(item)) body += `<section><h5>Particularité</h5><p class="cb-editorial">${_esc(item.particularite || getItemEffectText(item))}</p></section>`;
      const footer = canEdit ? `<button type="button" class="cb-btn${_combatTabUi.candidates ? ' is-primary' : ''}" data-action="toggleCombatCandidates">${_combatTabUi.candidates ? 'Masquer le sac' : 'Changer…'}</button><button type="button" class="cb-btn is-danger" data-action="clearEquipSlot" data-slot="${_esc(slotDef.id)}" data-render-tab="combat">Retirer</button>` : '';
      return detailShell({ color: rare.color, kicker: slotDef.label, title: item.nom, tags: [rare.label, armorMeta?.label || item.typeArmure].filter(Boolean), body, footer });
    }
    if (kind === 'style') {
      const activeStyleKey = String(activeStyle?.id || _norm(activeStyle?.label || activeStyle?.name || ''));
      const styleList = styles.map(style => {
        const styleKey = String(style?.id || _norm(style?.label || style?.name || ''));
        const active = Boolean(activeStyleKey && styleKey === activeStyleKey);
        const condition = [
          (style.condPrincipale || []).filter(Boolean).join(', ') || ((style.condPrincipale || []).length ? 'main vide' : 'toute arme'),
          style.condMains ? `${style.condMains} main${style.condMains === '2' ? 's' : ''}` : '',
          (style.condSecondaire || []).filter(Boolean).join(', ') || ((style.condSecondaire || []).length ? 'seconde main vide' : ''),
        ].filter(Boolean).join(' · ');
        return `<div class="cb-style-row${active ? ' is-current' : ''}" style="--cb-style:${_esc(style.couleur || style.color || '#7a8fa8')}"><b>${_esc(plainStyleName(style))}</b><span>${_esc(condition)}</span>${active ? '<em>Actif</em>' : ''}</div>`;
      }).join('');
      const body = activeStyle
        ? `<section><p>${_esc(activeStyle.description || 'Style déduit des armes actuellement en main.')}</p></section><section><h5>Règles appliquées au VTT</h5><div class="cb-rules">${rulesHtml}</div></section><section><h5>Tous les styles</h5><div class="cb-style-list">${styleList}</div></section>`
        : `<section><p>Équipe une combinaison d’armes correspondant à un style configuré.</p></section>${styleList ? `<section><h5>Tous les styles</h5><div class="cb-style-list">${styleList}</div></section>` : ''}`;
      const footer = STATE.isAdmin ? '<button type="button" class="cb-btn" data-action="openCombatStylesAdmin">Gérer les styles <span class="cb-mj">MJ</span></button>' : '';
      return detailShell({ color: styleColor, kicker: 'Style de combat actif', title: styleName, body, footer });
    }
    if (kind === 'mastery') {
      const index = parseInt(rawId);
      const mastery = (c.maitrises || [])[index];
      if (!mastery) return '';
      const name = mastery.typeArme || mastery.nom || mastery.name || 'Sans type';
      const level = Math.max(0, Math.min(5, parseInt(mastery.niveau) || 0));
      const weaponsConcerned = inventory.filter(item => item?.nom && _norm(family(item)) === _norm(name)).map(item => item.nom);
      const body = `<section><h5>Niveau ${STATE.isAdmin ? '<span class="cb-mj">MJ</span>' : ''}</h5><div class="cb-level">${STATE.isAdmin ? `<button type="button" data-action="stepCombatMastery" data-idx="${index}" data-delta="-1" ${level <= 0 ? 'disabled' : ''}>−</button>` : ''}<span class="cb-mastery-pips">${Array.from({ length: 5 }, (_, pip) => `<i class="${pip < level ? 'is-on' : ''}"></i>`).join('')}</span>${STATE.isAdmin ? `<button type="button" data-action="stepCombatMastery" data-idx="${index}" data-delta="1" ${level >= 5 ? 'disabled' : ''}>+</button>` : ''}</div></section><section><h5>Effet</h5><p>Ajoute +${level} aux dégâts avec ce type d’arme.</p></section>${weaponsConcerned.length ? `<section><h5>Armes concernées</h5>${chips([...new Set(weaponsConcerned)])}</section>` : ''}<section><h5>Note</h5>${canEdit ? `<textarea class="cb-input" data-change="saveCombatMasteryNote" data-idx="${index}" placeholder="Où, avec qui…">${_esc(mastery.note || '')}</textarea>` : `<p>${_esc(mastery.note || 'Aucune note.')}</p>`}</section>`;
      const footer = STATE.isAdmin ? `<button type="button" class="cb-btn" data-action="editMaitrise" data-idx="${index}">Modifier</button><button type="button" class="cb-btn is-danger" data-action="deleteMaitrise" data-idx="${index}">Supprimer</button>` : '';
      return detailShell({ color: '#7eb0ff', kicker: 'Maîtrise d’arme', title: name, tags: [level ? `Niveau ${level}` : 'Initié'], body, footer });
    }
    return '';
  };

  const styleBand = `<button type="button" class="cb-style-band${selectedClass('style:active')}" style="--cb-style:${_esc(styleColor)}" data-action="selectCombatDetail" data-detail="style:active"><span><small>Style actif</small><b>${_esc(styleName)}</b></span><span class="cb-rules">${rulesHtml}</span><em>Règles ›</em></button>`;
  const masterySection = `<section class="cb-zone"><header class="cb-zone-head"><h3>Maîtrises</h3>${STATE.isAdmin ? '<button type="button" class="cb-btn is-ghost" data-action="addMaitrise">+ Maîtrise <span class="cb-mj">MJ</span></button>' : ''}</header><div class="cb-zone-body cb-mastery-list">${masteryRows || '<p class="cb-empty-copy">Aucune maîtrise enregistrée.</p>'}</div></section>`;
  const elementsSection = `<section class="cb-zone"><header class="cb-zone-head"><h3>Éléments</h3>${STATE.isAdmin ? '<button type="button" class="cb-btn is-ghost" data-action="openDamageTypesAdmin">Types <span class="cb-mj">MJ</span></button>' : ''}</header><div class="cb-zone-body"><div class="cb-elements">${elementChips}</div><p class="cb-note">L’étoile marque l’élément sélectionné par défaut pour les actions au VTT.</p></div></section>`;
  return `<div class="cb-wrap"><div class="cb-layout${_combatTabUi.open ? ' is-open' : ''}"><main class="cb-main"><section class="cb-zone"><header class="cb-zone-head"><div><h3>Armes en main</h3><p>Le style de combat se déduit de ce que tu tiens.</p></div></header><div class="cb-zone-body"><div class="cb-hands">${weapons.map(weaponCard).join('')}</div>${styleBand}</div></section><section class="cb-zone"><header class="cb-zone-head"><h3>Protection</h3><div class="cb-zone-tools"><span class="cb-ca"><small>CA</small><b>${calcCA(c)}</b></span>${setChip}${STATE.isAdmin ? '<button type="button" class="cb-btn is-ghost" data-action="openArmorSetsAdmin">Sets <span class="cb-mj">MJ</span></button>' : ''}</div></header><div class="cb-zone-body"><div class="cb-slots">${armorSlots.map(armorCard).join('')}</div>${setHint ? `<p class="cb-set-hint">${_esc(setHint)}</p>` : ''}</div></section><div class="cb-duo">${masterySection}${elementsSection}</div></main>${renderDetail()}</div></div>`;
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
  await updateInCol('characters', charId, { aura, auraColor: null });
  _applyAuraVars(c);
}
async function setCharAuraColor(charId, hex) {
  const c = getCharacterById(charId);
  if (!c || !/^#[0-9a-fA-F]{6}$/.test(hex || '')) return;
  c.auraColor = hex;
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

function showCharTab(tab, el) {
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
  if (prevChar) setRouteSub('characters', `${prevChar}/${v3}`);

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

function _selectCombatDetail(btn) {
  _combatTabUi.selected = btn.dataset.detail || _combatTabUi.selected;
  _combatTabUi.open = true;
  _combatTabUi.candidates = btn.dataset.empty === 'true';
  _rerenderCombatTab();
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
  identityStartEdit:       (btn)    => _identityStartEdit(btn),
  identityCancelEdit:      ()       => _identityCancelEdit(),
  identitySaveEdit:        (btn)    => _identitySaveEdit(btn),
  identityAddTitle:        (btn)    => _identityAddTitle(btn),
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
  selectCombatDetail:       (btn)   => _selectCombatDetail(btn),
  toggleCombatCandidates:   ()      => { _combatTabUi.candidates = !_combatTabUi.candidates; _combatTabUi.open = true; _rerenderCombatTab(); },
  closeCombatDetail:        ()      => { _combatTabUi.open = false; _combatTabUi.candidates = false; _rerenderCombatTab(); },
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
  if (e.key === 'Escape' && (_identityUi.popover || _identityUi.editing)) {
    const c = charSession.getCurrentChar();
    if (!c) return;
    e.preventDefault();
    if (_identityUi.popover) {
      _identityUi.popover = null;
      _removeIdentityPopover();
      if (!_identityUi.editing) return;
    }
    _identityUi.editing = false;
    _identityUi.draft = null;
    _rerenderIdentity(c);
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
