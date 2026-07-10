// ══════════════════════════════════════════════
// characters.js — Point d'entrée mince
// Toute la logique est dans assets/js/features/characters/
// ══════════════════════════════════════════════
import { STATE } from '../core/state.js';
import { updateInCol } from '../data/firestore.js';
import { _esc, _norm, loadingHtml } from '../shared/html.js';
import { charSession } from '../shared/char-session.js';
import { characterPortraitContent } from '../shared/portraits.js';
import {
  getMod, calcCA, calcVitesse, calcDeckMax, calcPVMax, calcPMMax,
  calcOr, calcPalier, pct, getItemStatBonus, getItemEffectText,
  sortCharactersForDisplay, modStr,
} from '../shared/char-stats.js';

import { getCharacterById, getVisibleCharacters } from '../shared/character-state.js';
// ── Sous-modules ─────────────────────────────────────────────────────────────
import {
  loadCombatStyles, detectCombatStyle,
  openCombatStylesAdmin, openDamageTypesAdmin,
  _getTraits, getEquippedInventoryIndexMap, getArmorSetData,
  // V3 — combat helpers
  getMainWeapon, getWeaponToucherParts, getWeaponDegatsParts,
} from './characters/data.js';

import {
  renderCharDeck, bindSortCardsDnd,
  addSort, editSort,
} from './characters/spells.js';

import { toggleCharElement } from './characters/combat.js';
import {
  renderCharLedger,
  _csV3LedgerSaveField, _csV3LedgerSaveAmount,
  _csV3LedgerSetSearch, _csV3LedgerSetKind, _csV3LedgerSetAddKind,
  _csV3AddLedger, _csV3DeleteLedger, _csV3LedgerMore,
} from './characters/ledger.js';
import {
  renderCharJournal, getCurrentJournalSub,
  _bindNotesDnd, _bindQuetesDnd,
  _csV3JournalSub, _csV3ToggleNote, _csV3SaveNoteTitle,
  _csV3AddRelation, _csV3EditRelation,
  _csV3RelSent, _csV3RelPickNpc, _csV3SaveRelation, _csV3DeleteRelation,
} from './characters/journal.js';
import {
  renderCharProfilV3,
  _csV3SaveQuote, _csV3SaveIdentityValue, _csV3SaveVisibility,
  _csV3AddProfilTag, _csV3AddProfilTagFromInput, _csV3RemoveProfilTag,
  _csV3RenameIdentity, _csV3AddFact,
  _csV3EnterBioEdit, _csV3CancelBio, _csV3SaveBioRt,
} from './characters/profil.js';

import {
  openSellInvModal, sellInvItemBulk,
  openDeleteInvModal, deleteInvItemBulk,
  openSendInvModal, sendInvItem,
  openSendGoldModal, sendGold,
  addInvItem, saveInvItemFromShop,
  editInvItem, saveInvItem,
  renderInvPersonalLine, saveInvPersonalLine,
  filterInvRows, openInventoryItemDetail,
  ensureInventoryCatalog, isInventoryCatalogReady, getInventoryCatalogItem,
} from './characters/inventory.js';
import {
  getInventoryItemValue,
  getInventoryItemResaleValue,
  getInventoryItemImage,
} from '../shared/inventory-utils.js';

import { editEquipSlot } from './characters/equipment.js';

import {
  renderCharCarac, renderCharNotes,
  toggleNote, addNote, editNoteTitle, saveNote, deleteNote,
  renderCharCompte, refreshOrDisplay,
  addCompteRow, deleteCompteRow, saveCompteField,
  renderCharMaitrises,
  addMaitrise, editMaitrise, saveMaitrise, deleteMaitrise,
  previewXpBar, saveXpDirect, addXpDelta,
  allocStatPoint, addXpFromInput, adjVitalBase, toggleCompteHist,
  openProfilImageUpload, removeProfilImage,
  STATS_KEYS,
} from './characters/tabs.js';
import { bindQuillEditors } from '../shared/rich-text-quill.js';
import { registerActions } from '../core/actions.js';

import {
  inlineEditText, inlineEditNum, inlineEditChip,
  inlineEditStatFromCard, inlineEditStat,
} from './characters/inline-edit.js';

import {
  adjustStat,
  toggleSort, toggleQuete, deleteQuete,
  duplicateSort, setSortValidation,
  deleteSort, deleteChar, createNewChar,
  manageTitres, addQuete,
} from './characters/forms.js';

import { openCharExportMenu } from './characters/export.js';

import { quickViewChar } from './characters/quick-view.js';
import { loadDamageTypes, getMagicTypes } from '../shared/damage-types.js';
import Sortable from '../vendor/sortable.esm.js';
import { makeSortable } from '../shared/sortable-helper.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { openModal, closeModalDirect } from '../shared/modal.js';
import { lsJson } from '../shared/local-storage.js';

// Caches partagés Phase 2 — chargés à la demande au 1er affichage Combat
let _combatTabCache = { styles: null, dmgTypes: null };
let _charAdminFilter = null;
let _currentTopTab   = 'combat';
let _csV3InvFilter = { cat: 'all', search: '' };
let _csV3InvDensity = lsJson.get('cs-inventory-density') === 'list' ? 'list' : 'cards';
let _inventoryCatalogRefreshQueued = false;

// Palette d'auras — constante partagée par renderCharSheet et setCharAura
const AURA_PALETTE = {
  blue: '#4f8cff', arcane: '#9d6fff', crimson: '#ff5a7e',
  gold: '#e8b84b', emerald: '#22c38e', ember: '#ff9544',
};
const _auraColor = (key) => AURA_PALETTE[key] || AURA_PALETTE.blue;
const _charBlurActions = {};

const _calcRow = (label, value, detail = '') => `
  <div class="cs-calc-row">
    <div><span>${_esc(label)}</span>${detail ? `<small>${_esc(detail)}</small>` : ''}</div>
    <strong>${_esc(String(value))}</strong>
  </div>`;

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

function _weaponForSlot(c, slot = 'Main principale') {
  const raw = c?.equipement?.[slot] || {};
  return slot === 'Main principale' && !raw.nom ? getMainWeapon(c) : raw;
}

function openCharCalculation(btn) {
  const c = getCharacterById(btn.dataset.id) || charSession.getCurrentChar();
  if (!c) return;

  const type = btn.dataset.calc;
  const level = c.niveau || 1;
  let title = 'Détail du calcul';
  let result = '';
  let rows = '';
  let note = '';

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
    note = `Le modificateur de ${statLabel} provient de la valeur totale de la caractéristique.`;
  } else if (type === 'ca') {
    const equip = c.equipement || {};
    const torse = equip.Torse || {};
    const armorType = torse.typeArmure || 'Sans armure';
    const armorBases = { 'Légère': 10, 'Intermédiaire': 12, 'Lourde': 14 };
    const armorBase = armorBases[armorType] || 8;
    const dex = getMod(c, 'dexterite');
    const rawCaSources = Object.entries(equip).flatMap(([slot, item]) => {
      const value = parseInt(item?.ca) || 0;
      return value ? [{ slot, item, value }] : [];
    });
    const secondary = equip['Main secondaire'];
    const secondaryName = (secondary?.sousType || secondary?.nom || '').toLowerCase();
    const hasShield = secondaryName.includes('bouclier') || secondaryName.includes('shield');
    const shieldOwnBonus = Number.isFinite(parseInt(secondary?.caBonus)) && parseInt(secondary.caBonus) !== 0;
    title = 'Classe d’Armure';
    result = calcCA(c);
    rows = [
      _calcRow(`Base · ${armorType}`, armorBase),
      _calcRow('Modificateur de Dextérité', modStr(dex)),
      ...rawCaSources.map(({ slot, item, value }) => _calcRow(item.nom || slot, modStr(value), slot)),
      _calcEquipmentRows(c, 'caBonus'),
      hasShield && !shieldOwnBonus ? _calcRow('Bouclier', '+2', 'Bonus par défaut') : '',
    ].join('');
    note = 'La CA additionne la base de l’armure de torse, la Dextérité et les bonus de l’équipement.';
  } else if (type === 'speed') {
    const strength = getMod(c, 'force');
    title = 'Vitesse';
    result = `${calcVitesse(c)} m`;
    rows = [
      _calcRow('Base', '3 m'),
      _calcRow('Modificateur de Force', `${modStr(strength)} m`),
      _calcEquipmentRows(c, 'vitesseBonus'),
    ].join('');
    note = 'La vitesse ne peut pas descendre sous 0 m.';
  } else if (type === 'deck') {
    const intMod = getMod(c, 'intelligence');
    const progression = Math.floor(Math.max(0, intMod) * Math.pow(Math.max(0, level - 1), 0.75));
    const penalty = Math.min(0, intMod);
    const active = (c.deck_sorts || []).filter(spell => spell.actif).length;
    title = 'Capacité du deck';
    result = `${active} / ${calcDeckMax(c)}`;
    rows = [
      _calcRow('Capacité de base', 3),
      _calcRow('Malus d’Intelligence', modStr(penalty)),
      _calcRow('Progression', modStr(progression), `Intelligence ${modStr(intMod)} · niveau ${level}`),
    ].join('');
    note = 'Le premier nombre correspond aux sorts actifs, le second à la capacité maximale.';
  } else if (type?.startsWith('weapon-')) {
    const slot = btn.dataset.slot || 'Main principale';
    const item = _weaponForSlot(c, slot);
    const fallback = item.statAttaque === 'dexterite'
      ? 'dexterite'
      : item.statAttaque === 'intelligence' ? 'intelligence' : 'force';
    if (!item?.nom) return;

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
    return;
  }

  openModal(`ⓘ ${title}`, `
    <div class="cs-calc-modal">
      <div class="cs-calc-result"><span>Valeur finale</span><strong>${_esc(String(result))}</strong></div>
      <div class="cs-calc-rows">${rows}</div>
      ${note ? `<p class="cs-calc-note">${_esc(note)}</p>` : ''}
    </div>`, {
    subtitle: 'Origine de chaque valeur',
    accent: '#4f8cff',
  });
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
  document.querySelectorAll('#char-pills .char-pill').forEach(p=>p.classList.toggle('active', p.dataset.charid === id));
  if (el) el.classList.add('active');
  const c = STATE.characters.find(x=>x.id===id);
  if (c) { STATE.activeChar=c; renderCharSheet(c, charSession.getCurrentCharTab()||'carac'); }
}

function filterAdminChars(pseudo, el) {
  // Met à jour la pill active du filtre admin
  document.querySelectorAll('#admin-player-filter .cs-admin-filter').forEach(p=>p.classList.remove('active'));
  if (el) el.classList.add('active');
  // Mémorise le filtre actif pour que renderCharSheet le réutilise au prochain rendu
  _charAdminFilter = pseudo || null;
  // Sélectionne le 1er perso du filtre et rerendre
  const filtered = pseudo ? STATE.characters.filter(c=>c.ownerPseudo===pseudo) : STATE.characters;
  // Sélectionne le ★ par défaut du joueur filtré si possible, sinon le premier (alpha)
  const chars = sortCharactersForDisplay(filtered);
  // Affichage alphabétique, mais on sélectionne le ★ par défaut du joueur si présent.
  const pick = chars.find(c => c.isDefault) || chars[0];
  if (pick) { STATE.activeChar = pick; renderCharSheet(pick); }
}

// ══════════════════════════════════════════════
// RENDER PRINCIPAL
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// V3 — Tabs simplifiés (6 onglets) selon HANDOFF_Claude_Code.md
//   combat · sorts · inv · compte · journal · profil
// On garde le legacy resolveTab pour la rétro-compat des liens entrants.
// ══════════════════════════════════════════════════════════════════════════════
const V3_TABS = ['combat', 'sorts', 'inv', 'compte', 'journal', 'profil'];
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
}

// Pastilles de sélection de personnage (char-switch)
function _buildCharSwitchHtml(activeCharId, canEdit) {
  let switchable = getVisibleCharacters();
  if (STATE.isAdmin && _charAdminFilter)
    switchable = switchable.filter(x => x.ownerPseudo === _charAdminFilter);
  switchable = sortCharactersForDisplay(switchable);

  const pillsHtml = switchable.map(ch => {
    const col = _auraColor(ch.aura);
    const titleSuffix = ch.isDefault ? ' · ★ Par défaut' : '';
    return `<button class="char-pill${ch.id===activeCharId?' active':''}${ch.isDefault?' is-default':''}"
      data-charid="${ch.id}" data-action="selectChar" data-id="${ch.id}"
      style="--av-c:${col}" title="${_esc(ch.nom || 'Sans nom')} — Niv.${ch.niveau||1}${ch.classe?' · '+_esc(ch.classe):''}${titleSuffix}">
      <span class="char-pill-av">${characterPortraitContent(ch)}${ch.isDefault?'<span class="char-pill-star" title="Personnage par défaut">★</span>':''}</span>
      <span class="char-pill-name">${_esc(ch.nom || 'Sans nom')}</span>
    </button>`;
  }).join('');

  return `<div class="char-switch">
    ${pillsHtml}
    ${canEdit ? `<button class="char-pill char-pill-new" data-action="createNewChar">➕ Nouveau</button>` : ''}
  </div>`;
}

// 6 tuiles de statistiques avec segmentation base/niveau/équipement
function _buildStatTilesHtml(c, canEdit, lvlPointsRemaining) {
  const s  = c.stats      || {};
  const sb = c.statsBonus || {};
  const isAdmin = !!STATE.isAdmin;
  const STAT_FULL = {
    force: 'Force', dexterite: 'Dextérité', intelligence: 'Intelligence',
    constitution: 'Constitution', sagesse: 'Sagesse', charisme: 'Charisme',
  };
  return [
    {key:'force',        abbr:'FOR'},
    {key:'dexterite',    abbr:'DEX'},
    {key:'intelligence', abbr:'INT'},
    {key:'constitution', abbr:'CON'},
    {key:'sagesse',      abbr:'SAG'},
    {key:'charisme',     abbr:'CHA'},
  ].map(st => {
    const totalBase = s[st.key]  || 8;
    const lvlUp     = parseInt((c.statsLevelUps || {})[st.key]) || 0;
    const pureBase  = totalBase - lvlUp;
    const bonus     = sb[st.key] || 0;
    const total     = totalBase + bonus;
    const m         = getMod(c, st.key);
    const mStr      = m >= 0 ? `+${m}` : String(m);
    const mCls      = m > 0 ? 'pos' : m < 0 ? 'neg' : 'zero';
    const eqCls     = bonus > 0 ? 'pos' : bonus < 0 ? 'neg' : 'zero';
    const eqDisp    = bonus > 0 ? `+${bonus}` : bonus < 0 ? String(bonus) : '0';
    const canPlus   = canEdit && lvlPointsRemaining > 0;
    const canMinus  = canEdit && lvlUp > 0;

    const baseSegment = (canEdit && isAdmin)
      ? `<button class="stat-seg stat-seg-base editable" title="MJ — Modifier la base"
            data-action="inlineEditStat" data-id="${c.id}" data-key="${st.key}" data-stop-propagation>
          <span class="stat-seg-val js-stat-base">${pureBase}</span>
          <span class="stat-seg-lbl">Base <small>✎</small></span>
        </button>`
      : `<div class="stat-seg stat-seg-base">
          <span class="stat-seg-val js-stat-base">${pureBase}</span>
          <span class="stat-seg-lbl">Base</span>
        </div>`;

    const nivSegment = `<div class="stat-seg stat-seg-niv ${lvlUp>0?'has':'zero'}">
        <span class="stat-seg-val">+${lvlUp}</span>
        <span class="stat-seg-lbl">Niveau</span>
        ${canEdit ? `<span class="stat-seg-ctrls">
          <button class="stat-lvl-btn" ${canMinus?'':'disabled'}
            data-action="allocateStat" data-id="${c.id}" data-key="${st.key}" data-delta="-1" data-stop-propagation title="Retirer 1 point">−</button>
          <button class="stat-lvl-btn plus" ${canPlus?'':'disabled'}
            data-action="allocateStat" data-id="${c.id}" data-key="${st.key}" data-delta="1" data-stop-propagation title="Ajouter 1 point">+</button>
        </span>` : ''}
      </div>`;

    const eqSegment = `<div class="stat-seg stat-seg-eq ${eqCls}">
        <span class="stat-seg-val">${eqDisp}</span>
        <span class="stat-seg-lbl">Équip.</span>
      </div>`;

    return `<div class="stat-tile" data-stat="${st.key}"
      title="${_esc(STAT_FULL[st.key]||st.key)} — Base ${pureBase} + Niveau +${lvlUp} + Équip. ${eqDisp} = ${total}">
      <header class="stat-tile-head">
        <span class="stat-tile-name">${_esc(STAT_FULL[st.key]||st.abbr)}</span>
        <span class="stat-tile-mod ${mCls}">${mStr}</span>
      </header>
      <div class="stat-tile-total-row">
        <span class="stat-tile-total">${total}</span>
        <span class="stat-tile-total-lbl">Total</span>
      </div>
      <div class="stat-tile-formula">
        ${baseSegment}
        <span class="stat-formula-op">+</span>
        ${nivSegment}
        <span class="stat-formula-op">+</span>
        ${eqSegment}
      </div>
    </div>`;
  }).join('');
}

// Navigation par onglets v3
function _buildTabsHtml(c, v3Tab) {
  // Icône SVG du jeu maison (rendu homogène cross-OS vs émoji ; hérite currentColor).
  const _ico = (id) => `<svg class="cs-tab-svg" aria-hidden="true"><use href="./assets/img/icons.svg#icon-${id}"/></svg>`;
  return [
    { k: 'combat',  ico: 'sword',       lbl: 'Combat' },
    { k: 'sorts',   ico: 'sparkles',    lbl: 'Sorts',      badge: `${(c.deck_sorts||[]).filter(x=>x.actif).length}/${calcDeckMax(c)}` },
    { k: 'inv',     ico: 'bag',         lbl: 'Inventaire', badge: `${(c.inventaire||[]).length||''}` },
    { k: 'compte',  ico: 'coin',        lbl: 'Bourse' },
    { k: 'journal', ico: 'book',        lbl: 'Journal' },
    { k: 'profil',  ico: 'user-circle', lbl: 'Profil' },
  ].map(t => `<button class="tab-v3 ${t.k===v3Tab?'active':''}" id="cs-tab-${t.k}"
    role="tab" aria-selected="${t.k===v3Tab?'true':'false'}" aria-controls="char-tab-content"
    tabindex="${t.k===v3Tab?'0':'-1'}"
    data-tab-v3="${t.k}" data-action="showCharTab" data-tab="${t.k}">
    <span class="tab-ico" aria-hidden="true">${_ico(t.ico)}</span> ${t.lbl}
    ${t.badge?`<span class="tab-badge">${t.badge}</span>`:''}
  </button>`).join('');
}

function _buildSidebarHtml(c, canEdit, { auraGlow, auraBd, auraSh, pvCur, pvMax, pvPct, hpBarCls, pmCur, pmMax, pmPct, xpCur, xpPalier, xpPct, deckActifs, deckMax, titresChips }) {
  return `<aside class="id-side" id="cs-sidebar" data-aura="${c.auraColor?'custom':(c.aura||'blue')}">

    <div class="id-identity">
      ${canEdit?`<div class="id-actions-mini" aria-label="Actions du personnage">
        <button class="id-default-btn${c.isDefault?' is-on':''}"
          title="${c.isDefault?"Personnage par défaut — il représente le joueur":'Définir comme personnage par défaut'}"
          data-action="_setDefaultCharacter" data-id="${c.id}">${c.isDefault?'★':'☆'}</button>
        <button title="Exporter" data-action="openCharExportMenu" data-id="${c.id}">⇩</button>
        <button class="id-del-btn" title="Supprimer ce personnage" data-action="deleteChar" data-id="${c.id}">⌫</button>
      </div>`:''}
      <div class="id-portrait-wrap">
        <div class="id-portrait"
             ${canEdit ? `data-action="open-character-photo" data-charid="${c.id}"` : ''}>
          ${characterPortraitContent(c, {
            imgStyle: `transform:scale(${c.photoZoom||1}) translate(${c.photoX||0}px,${c.photoY||0}px);transform-origin:center`,
            fallbackTag: 'span',
          })}
        </div>
        <div class="id-lvl-badge">${canEdit
          ? `<button type="button" class="id-lvl-edit" data-action="inlineEditNum" data-id="${c.id}" data-field="niveau" data-min="1" data-max="20" title="Modifier le niveau" style="background:none;border:none;color:inherit;font:inherit;letter-spacing:inherit;cursor:pointer;padding:0">Niv. <strong>${c.niveau||1}</strong></button>`
          : `Niv. <strong>${c.niveau||1}</strong>`}</div>
      </div>

      <div class="id-name-row">
        ${canEdit
          ? `<span class="id-name" data-action="inlineEditText" data-id="${c.id}" data-field="nom" title="Renommer">${_esc(c.nom||'Sans nom')}</span>`
          : `<span class="id-name">${_esc(c.nom||'Sans nom')}</span>`}
      </div>

      ${titresChips}

      <div class="id-chips">
        ${canEdit
          ? `<span class="id-chip classe" data-action="inlineEditChip" data-id="${c.id}" data-field="classe" data-label="Classe">${_esc(c.classe||'Classe')}</span>`
          : (c.classe?`<span class="id-chip classe">${_esc(c.classe)}</span>`:'')}
        ${canEdit
          ? `<span class="id-chip race" data-action="inlineEditChip" data-id="${c.id}" data-field="race" data-label="Race">${_esc(c.race||'Race')}</span>`
          : (c.race?`<span class="id-chip race">${_esc(c.race)}</span>`:'')}
        ${STATE.isAdmin
          ? `<span class="id-chip owner" data-action="reassignCharOwner" data-id="${c.id}" title="Réassigner à un autre compte joueur">👤 ${_esc(c.ownerPseudo || (c.uid ? 'Compte lié' : 'Sans compte'))}</span>`
          : ''}
      </div>
    </div>

    <!-- XP -->
    <div class="xp-block">
      <div class="xp-head">
        <div>
          <span class="xp-kicker">Progression</span>
          <strong>Niveau ${c.niveau||1}</strong>
        </div>
        <span class="xp-pct">${xpPct}%</span>
      </div>
      <div class="xp-track" aria-label="Progression d'expérience">
        <div class="xp-fill" id="xp-bar-fill" style="width:${xpPct}%"></div>
      </div>
      <div class="xp-meta">
        <span>${canEdit
          ? `<button type="button" class="xp-set-btn" data-action="inlineEditNum" data-id="${c.id}" data-field="exp" data-min="0" data-max="${xpPalier}" title="Définir l'XP total">${xpCur.toLocaleString('fr-FR').replace(/ /g,' ')}</button>`
          : xpCur.toLocaleString('fr-FR').replace(/ /g,' ')} / ${xpPalier.toLocaleString('fr-FR').replace(/ /g,' ')} XP</span>
        <span>Prochain : Niv. ${(c.niveau||1)+1}</span>
      </div>
      ${canEdit?`<div class="xp-add">
        <label for="xp-add-input-${c.id}">Gain d'XP</label>
        <div class="xp-add-control">
          <input type="number" id="xp-add-input-${c.id}" placeholder="0" data-char-id="${c.id}" data-xp-input>
          <button data-action="addXpDelta" data-id="${c.id}">Ajouter</button>
        </div>
      </div>`:''}
    </div>

    <!-- PV -->
    <div class="vital hp ${pvPct<25?'danger':''}" id="vital-hp">
      <div class="vital-icon">❤</div>
      <div class="vital-body">
        <div class="vital-head">
          <span class="vital-label">Points de Vie</span>
          <span class="vital-num"><span id="pv-val">${pvCur}</span><button class="cs-calc-inline" data-action="openCharCalculation" data-calc="pv" data-id="${c.id}" title="Voir le calcul des PV maximum">/ ${pvMax} ⓘ</button></span>
        </div>
        <div class="vital-bar"><div class="${hpBarCls}" id="pv-bar" style="width:${pvPct}%"></div></div>
        <div class="vital-ctrls">
          ${canEdit ? `<div class="vital-current-control">
            <span class="vital-control-label">Valeur actuelle</span>
            <span class="vital-stepper">
              <button class="vital-btn" data-action="adjustStat" data-field="pvActuel" data-delta="-1" data-id="${c.id}" title="Retirer 1 PV">−</button>
              <button class="vital-btn plus" data-action="adjustStat" data-field="pvActuel" data-delta="1" data-id="${c.id}" title="Ajouter 1 PV">+</button>
            </span>
          </div>
          <button class="cs-vital-base-btn" data-action="inlineEditNum" data-id="${c.id}" data-field="pvBase"
            data-min="1" data-max="999" title="Modifier les PV de base">
            <span class="cs-vital-base-copy"><span>PV de base</span><strong>${c.pvBase||10}</strong></span>
            <span class="cs-vital-base-edit" aria-hidden="true">✎</span>
          </button>` : `<div class="cs-vital-base-readonly"><span>PV de base</span><strong>${c.pvBase||10}</strong></div>`}
        </div>
      </div>
    </div>

    <!-- PM -->
    <div class="vital mp">
      <div class="vital-icon">✦</div>
      <div class="vital-body">
        <div class="vital-head">
          <span class="vital-label">Points de Magie</span>
          <span class="vital-num"><span id="pm-val">${pmCur}</span><button class="cs-calc-inline" data-action="openCharCalculation" data-calc="pm" data-id="${c.id}" title="Voir le calcul des PM maximum">/ ${pmMax} ⓘ</button></span>
        </div>
        <div class="vital-bar"><div class="vital-bar-fill" id="pm-bar" style="width:${pmPct}%"></div></div>
        <div class="vital-ctrls">
          ${canEdit ? `<div class="vital-current-control">
            <span class="vital-control-label">Valeur actuelle</span>
            <span class="vital-stepper">
              <button class="vital-btn" data-action="adjustStat" data-field="pmActuel" data-delta="-1" data-id="${c.id}" title="Retirer 1 PM">−</button>
              <button class="vital-btn plus" data-action="adjustStat" data-field="pmActuel" data-delta="1" data-id="${c.id}" title="Ajouter 1 PM">+</button>
            </span>
          </div>
          <button class="cs-vital-base-btn" data-action="inlineEditNum" data-id="${c.id}" data-field="pmBase"
            data-min="1" data-max="999" title="Modifier les PM de base">
            <span class="cs-vital-base-copy"><span>PM de base</span><strong>${c.pmBase||10}</strong></span>
            <span class="cs-vital-base-edit" aria-hidden="true">✎</span>
          </button>` : `<div class="cs-vital-base-readonly"><span>PM de base</span><strong>${c.pmBase||10}</strong></div>`}
        </div>
      </div>
    </div>

    <!-- Mini stats : CA · Vit. · Deck (3 colonnes) -->
    <div class="cs-mini-grid cs-mini-grid-3">
      <button class="cs-mini cs-calc-trigger" data-action="openCharCalculation" data-calc="ca" data-id="${c.id}" title="Voir le calcul de la CA"><span class="cs-mini-icon">🛡️</span><span class="cs-mini-body"><span class="cs-mini-lbl">CA</span><span class="cs-mini-val">${calcCA(c)}</span></span></button>
      <button class="cs-mini cs-calc-trigger" data-action="openCharCalculation" data-calc="speed" data-id="${c.id}" title="Voir le calcul de la vitesse"><span class="cs-mini-icon">🏃</span><span class="cs-mini-body"><span class="cs-mini-lbl">Vit.</span><span class="cs-mini-val">${calcVitesse(c)}m</span></span></button>
      <button class="cs-mini cs-calc-trigger" data-action="openCharCalculation" data-calc="deck" data-id="${c.id}" title="Voir le calcul de la capacité du deck"><span class="cs-mini-icon">✦</span><span class="cs-mini-body"><span class="cs-mini-lbl">Deck</span><span class="cs-mini-val">${deckActifs}<small style="font-size:.62rem;color:var(--text-dim);font-weight:600;margin-left:1px">/${deckMax}</small></span></span></button>
    </div>

    <!-- Or -->
    <div class="or-card">
      <div class="or-card-left">
        <div class="or-card-icon">💰</div>
        <div>
          <div class="or-card-lbl">Bourse</div>
          <div class="or-card-val"><span class="or-card-amount">${calcOr(c)}</span> <small style="font-size:.65rem;color:var(--text-dim)">or</small></div>
        </div>
      </div>
      ${canEdit?`<button class="or-card-btn" data-action="openSendGoldModal" data-id="${c.id}">↗ Envoyer</button>`:''}
    </div>

    ${canEdit?(() => {
      const isCustom = !!c.auraColor, curHex = _auraHex(c);
      return `<div class="aura-row">
        <span class="aura-lbl">Aura</span>
        <div class="aura-dots">
          ${Object.entries(AURA_PALETTE).map(([k,col]) => `
            <button class="aura-dot${(!isCustom && (c.aura||'blue')===k)?' active':''}"
              style="--dot-c:${col}" data-aura-key="${k}"
              data-action="setCharAura" data-id="${c.id}"
              title="${k}"></button>`).join('')}
          <label class="aura-dot aura-dot--custom${isCustom?' active':''}" style="--dot-c:${curHex}" title="Couleur personnalisée">
            <input type="color" class="aura-color-input" value="${curHex}" data-change="setCharAuraColor" data-id="${c.id}">
          </label>
        </div>
      </div>`;})():''}

  </aside>`;
}

function _buildMainColHtml(canEdit, { tilesHtml, tabsHtml, lvlPointsRemaining, v3Tab }) {
  return `<section class="main-col">

    <!-- Stats banner 6 tuiles -->
    <div class="stats-banner" id="cs-stats-banner">
      ${tilesHtml}
    </div>

    ${lvlPointsRemaining > 0 && canEdit ? `
    <div class="alloc-banner">
      <span>🎯 <b>${lvlPointsRemaining}</b> point${lvlPointsRemaining>1?'s':''} de niveau à dépenser — cliquez sur le badge <b>+1</b> d'une caractéristique</span>
      <span class="alloc-banner-hint">Modificateur recalculé instantanément</span>
    </div>` : ''}

    <!-- Tabs v3 -->
    <nav class="tabs-v3" id="char-tabs-v3" role="tablist" aria-label="Sections de la fiche personnage">
      ${tabsHtml}
    </nav>

    <div id="char-tab-content" class="tab-body-v3" role="tabpanel" tabindex="0" aria-labelledby="cs-tab-${v3Tab}"></div>

  </section>`;
}

function renderCharSheet(c, keepTab) {
  const area = document.getElementById('char-sheet-area');
  if (!area) return;
  const canEdit = STATE.isAdmin || c.uid === STATE.user?.uid;

  const v3Tab = _resolveV3Tab(keepTab || charSession.getCurrentCharTab() || 'combat');
  charSession.set(c, canEdit, v3Tab);
  _currentTopTab = v3Tab;

  // ── Valeurs dérivées ──────────────────────────
  const pvMax  = calcPVMax(c), pmMax = calcPMMax(c);
  const pvCur  = c.pvActuel ?? pvMax, pmCur = c.pmActuel ?? pmMax;
  const pvPct  = pct(pvCur, pvMax), pmPct = pct(pmCur, pmMax);
  const xpCur  = c.exp || 0, xpPalier = calcPalier(c.niveau || 1), xpPct = pct(xpCur, xpPalier);
  const deckActifs = (c.deck_sorts || []).filter(s => s.actif).length;
  const deckMax    = calcDeckMax(c);
  const titres     = c.titres || [];
  const hpBarCls   = pvPct < 25 ? 'vital-bar-fill low' : pvPct < 50 ? 'vital-bar-fill mid' : 'vital-bar-fill';

  // ── Points de niveau restants ──────────────────
  const _lvlEarned = Math.max(0, (c.niveau||1) - 1);
  const _lvlSpent  = ['force','dexterite','intelligence','constitution','sagesse','charisme']
    .reduce((s,k) => s + (parseInt((c.statsLevelUps||{})[k])||0), 0);
  const lvlPointsRemaining = _lvlEarned - _lvlSpent;

  // ── Sous-composants HTML ───────────────────────
  const charSwitchHtml = _buildCharSwitchHtml(c.id, canEdit);
  const { auraGlow, auraBd, auraSh } = _auraVars(_auraHex(c));
  const tilesHtml      = _buildStatTilesHtml(c, canEdit, lvlPointsRemaining);
  const tabsHtml       = _buildTabsHtml(c, v3Tab);

  const titresChips = (titres.length || canEdit)
    ? `<div class="id-titres">
        ${titres.map(t => `<span class="id-titre">${_esc(t)}</span>`).join('')}
        ${canEdit ? `<button class="id-titre id-titre-add"
          data-action="manageTitres" data-id="${c.id}"
          title="${titres.length ? 'Gérer les titres' : 'Ajouter un titre'}">${titres.length ? '✎ Titres' : '＋ Titre'}</button>` : ''}
      </div>`
    : '';

  const sidebarHtml = _buildSidebarHtml(c, canEdit, { auraGlow, auraBd, auraSh, pvCur, pvMax, pvPct, hpBarCls, pmCur, pmMax, pmPct, xpCur, xpPalier, xpPct, deckActifs, deckMax, titresChips });
  const mainColHtml = _buildMainColHtml(canEdit, { tilesHtml, tabsHtml, lvlPointsRemaining, v3Tab });

  area.innerHTML = `<div class="cs-v3" style="${_auraStyleVars(c)}">
  <div class="app-shell">
    <div class="char-switch-row">${charSwitchHtml}</div>
    <div class="sheet">
      ${sidebarHtml}
      ${mainColHtml}
    </div>
  </div>
</div>`;

  _renderTabV3(v3Tab, c, canEdit);

  document.querySelector('[data-xp-input]')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addXpDelta(e.currentTarget.dataset.charId); }
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
  const savedScroll = samePanel ? _readTabScroll(area) : null;
  if (samePanel && savedScroll > 0 && c?.id) _scrollByTab.set(_scrollKey(c.id, tab), savedScroll);
  const sub = getCurrentJournalSub() || 'notes';
  const renders = {
    combat:  () => renderCharCombatV3(c, canEdit),
    sorts:   () => renderCharDeck(c, canEdit),
    inv:     () => renderCharInventaireV3(c, canEdit),
    compte:  () => renderCharLedger(c, canEdit),
    journal: () => renderCharJournal(c, canEdit, sub),
    profil:  () => renderCharProfilV3(c, canEdit),
  };
  area.innerHTML = renders[tab]?.() || '';
  area.dataset.renderedTab = tab;
  area.dataset.renderedCharId = c?.id || '';
  area.classList.remove('cs-tab-fadein');
  void area.offsetWidth;
  area.classList.add('cs-tab-fadein');
  if (tab === 'profil') {
    bindQuillEditors(area);
  }
  if (tab === 'journal' && sub === 'notes') { bindQuillEditors(area); _bindNotesDnd(c, canEdit); }
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
    if (b) out.push({ lbl: `${lbl} ${b>0?'+':''}${b}`, cls: b > 0 ? 'pos' : 'neg' });
  });
  // Dérivés : applique le palier Artisan (upgrades.effectBonus) sur les positifs.
  Object.entries(_ITEM_DERIVED_LABELS).forEach(([k, lbl]) => {
    const v = _bumpDerived(parseInt(it[k]) || 0, it);
    if (!v) return;
    out.push({ lbl: `${lbl} ${v>0?'+':''}${v}`, cls: 'gold' });
  });
  return out;
}

function renderCharCombatV3(c, canEdit) {
  const equip = c.equipement || {};
  const equippedInvMap = (() => {
    try { return getEquippedInventoryIndexMap?.(c) || new Map(); }
    catch { return new Map(); }
  })();
  const getEquippedInventoryItem = (slot, fallback) => {
    const invIndex = [...equippedInvMap.entries()]
      .find(([, slots]) => slots.includes(slot))?.[0];
    return Number.isInteger(invIndex) ? (c.inventaire?.[invIndex] || fallback) : fallback;
  };
  const weaponSlots = ['Main principale', 'Main secondaire'];
  const armorSlotsRow1 = ['Tête', 'Torse', 'Bottes'];
  const armorSlotsRow2 = ['Anneau', 'Amulette', 'Objet magique'];

  // ── ARMES
  const weapsHtml = weaponSlots.map(slot => {
    const raw = equip[slot] || {};
    let item = raw;
    let isDefault = false;
    try {
      if (slot === 'Main principale' && !raw.nom && typeof getMainWeapon === 'function') {
        item = getMainWeapon(c) || {};
        isDefault = !!item.isDefault;
      }
    } catch {}
    const statKey = item.statAttaque === 'dexterite' ? 'dexterite'
                  : item.statAttaque === 'intelligence' ? 'intelligence' : 'force';
    let tp = null, dp = null;
    try { tp = getWeaponToucherParts?.(c, item, statKey); } catch {}
    try { dp = getWeaponDegatsParts?.(c, item, statKey); } catch {}
    const traits = item.nom ? (_getTraits?.(getEquippedInventoryItem(slot, item)) || []) : [];

    if (!item.nom) {
      return `<div class="weap-card" style="opacity:.65;border-style:dashed">
        <div class="weap-head">
          <div>
            <div class="weap-slot">${slot}</div>
            <div class="weap-name" style="color:var(--text-dim);font-style:italic">— Vide —</div>
          </div>
          ${canEdit?`<button class="weap-edit" data-action="editEquipSlot" data-slot="${slot}" title="Équiper">✏️</button>`:''}
        </div>
      </div>`;
    }
    return `<div class="weap-card ${slot==='Main principale'?'main':''}">
      <div class="weap-head">
        <div>
          <div class="weap-slot">${slot}</div>
          <div class="weap-name">${_esc(item.nom)}${isDefault?' <span class="def">par défaut</span>':''}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          ${item.format?`<span class="weap-format">${_esc(item.format)}</span>`:''}
          ${canEdit?`<button class="weap-edit" data-action="editEquipSlot" data-slot="${slot}">✏️</button>`:''}
        </div>
      </div>
      <div class="weap-rolls">
        <div class="weap-roll">
          <span class="weap-roll-lbl">Toucher</span>
          <span class="weap-roll-val touch">${_esc(tp?.roll || '—')}</span>
          ${tp?.statLabel?`<span class="weap-roll-sub">${_esc(tp.statLabel)}${tp.setBonus>0?` · Set +${tp.setBonus}`:''}</span>`:''}
        </div>
        <div class="weap-rolls-sep"></div>
        <div class="weap-roll">
          <span class="weap-roll-lbl">Dégâts</span>
          <span class="weap-roll-val dmg">${_esc(dp?.roll || '—')}</span>
          ${dp?.statLabel?`<span class="weap-roll-sub">${_esc(dp.statLabel)}${dp.maitriseBonus>0?` · Maît. +${dp.maitriseBonus}`:''}</span>`:''}
        </div>
      </div>
      ${(() => {
        const badges = _itemBonusBadges(item);
        return badges.length ? `<div class="weap-badges">${badges.map(b=>`<span class="badge-chip ${b.cls}">${b.lbl}</span>`).join('')}</div>` : '';
      })()}
      ${(item.portee || traits.length || item.particularite) ? `<div class="weap-meta">
        ${item.portee?`<span>↗ ${_esc(item.portee)}</span>`:''}
        ${item.particularite?`<div class="weap-particularite">${_esc(item.particularite)}</div>`:''}
        ${traits.length?`<div class="weap-traits">${traits.map(t=>`<span class="trait">${_esc(t)}</span>`).join('')}</div>`:''}
      </div>`:''}
    </div>`;
  }).join('');

  // ── ARMURES (2 rangées fixes de 3 : Tête/Torse/Bottes + Anneau/Amulette/Obj magique)
  // Affiche les traits + tous les bonus offerts (stats / CA / dérivés)
  const STAT_LABELS = {
    force: 'FOR', dexterite: 'DEX', intelligence: 'INT',
    constitution: 'CON', sagesse: 'SAG', charisme: 'CHA',
  };
  // Code couleur des types d'armure (partagé pill de carte + badge de set) :
  // Léger = bleu, Intermédiaire = vert, Lourd = rouge.
  const ARMOR_TYPE_META = {
    'Légère':        { key: 'light',  short: 'Légère' },
    'Intermédiaire': { key: 'medium', short: 'Inter.' },
    'Lourde':        { key: 'heavy',  short: 'Lourde' },
  };
  const renderArmor = slot => {
    const it = equip[slot] || {};
    const has = !!it.nom;
    if (!has) {
      return `<div class="armor-card empty">
        <div class="armor-slot">
          <span>${_esc(slot)}</span>
          ${canEdit?`<button class="weap-edit" data-action="editEquipSlot" data-slot="${slot}" title="Équiper">✎</button>`:''}
        </div>
        <div class="armor-name muted">— Vide —</div>
      </div>`;
    }
    // Type d'armure → pill colorée placée dans l'en-tête du slot (pas mélangée
    // aux bonus de stats). Léger/Inter/Lourd = bleu/vert/rouge.
    const tmeta = ARMOR_TYPE_META[it.typeArmure];
    const typePill = it.typeArmure
      ? `<span class="armor-type-pill ${tmeta?.key || ''}">${_esc(tmeta?.short || it.typeArmure)}</span>`
      : '';
    // Bonus : stats + CA + caBonus + dérivés
    const badges = [];
    const caTotal = (parseInt(it.ca) || 0) + (parseInt(it.caBonus) || 0);
    if (caTotal) badges.push({ lbl: `CA +${caTotal}`, cls: 'gold' });
    // Stats : items stockent sous codes courts (fo/dex/in/sa/co/ch + alias 'for').
    // getItemStatBonus gère tous les alias + les upgrades.
    Object.entries(STAT_LABELS).forEach(([fullKey, lbl]) => {
      let b = 0;
      try { b = getItemStatBonus(it, fullKey); } catch {}
      if (b) badges.push({ lbl: `${lbl} ${b>0?'+':''}${b}`, cls: b > 0 ? 'pos' : 'neg' });
    });
    ['pvMaxBonus','pmMaxBonus','vitesseBonus','initiativeBonus'].forEach(k => {
      // Applique le palier Artisan (upgrades.effectBonus) sur les bonus positifs
      const v = _bumpDerived(parseInt(it[k]) || 0, it);
      if (!v) return;
      const shortLbl = { pvMaxBonus:'PV', pmMaxBonus:'PM', vitesseBonus:'Vit.', initiativeBonus:'Init.' }[k];
      badges.push({ lbl: `${shortLbl} ${v>0?'+':''}${v}`, cls: 'gold' });
    });
    // Traits via _getTraits (importé de data.js)
    const traits = (_getTraits?.(getEquippedInventoryItem(slot, it)) || []);
    return `<div class="armor-card equipped">
      <div class="armor-slot">
        <span class="armor-slot-name">${_esc(slot)}</span>
        <span class="armor-slot-right">
          ${typePill}
          ${canEdit?`<button class="weap-edit" data-action="editEquipSlot" data-slot="${slot}" title="Changer">✎</button>`:''}
        </span>
      </div>
      <div class="armor-name">${_esc(it.nom)}</div>
      ${badges.length?`<div class="armor-badges">${badges.map(b=>`<span class="badge-chip ${b.cls}">${b.lbl}</span>`).join('')}</div>`:''}
      ${traits.length?`<div class="armor-traits">${traits.map(t=>`<span class="trait">${_esc(t)}</span>`).join('')}</div>`:''}
    </div>`;
  };
  // Rangée 1 (3 cols) + rangée 2 (3 cols)
  const armorRows = `
    <div class="armor-grid">${armorSlotsRow1.map(renderArmor).join('')}</div>
    <div class="armor-grid" style="margin-top:8px">${armorSlotsRow2.map(renderArmor).join('')}</div>`;

  // Set bonus — actif UNIQUEMENT si Tête + Torse + Bottes du même type (Légère / Intermédiaire / Lourde)
  // Rendu compacté : un badge dans l'en-tête de la section (le type de chaque
  // pièce est déjà affiché sur sa carte → pas de liste slot-par-slot redondante).
  let setBadgeHtml = '', setHintHtml = '';
  try {
    const setData = getArmorSetData?.(c) || {};
    const trackedSlots = setData.trackedSlots || ['Tête', 'Torse', 'Bottes'];
    const slots = setData.slots || trackedSlots.map(s => ({ slot: s, type: '', equipped: false }));
    const counts = setData.counts || {};
    const fullType = setData.fullType || ''; // 'Légère' / 'Intermédiaire' / 'Lourde'
    const isActive = setData.isActive || Boolean(fullType);
    const equippedCount = setData.equippedCount || 0;

    const TYPE_ICONS = { 'Légère': '🪶', 'Intermédiaire': '🛡️', 'Lourde': '⛨' };
    const EFFECT_BY_TYPE = {
      'Légère':        { tag: 'Léger',         fx: 'Coût des sorts −2 PM' },
      'Intermédiaire': { tag: 'Intermédiaire', fx: 'Toucher +2' },
      'Lourde':        { tag: 'Lourd',         fx: 'Réduction de 2 dégâts (toute source)' },
    };

    if (isActive) {
      const fx   = EFFECT_BY_TYPE[fullType] || { tag: fullType, fx: setData.activeEffect?.chipText || '' };
      const ico  = TYPE_ICONS[fullType] || '✨';
      const tkey = ARMOR_TYPE_META[fullType]?.key || '';
      setBadgeHtml = `<span class="set-badge active ${tkey}" title="Tête, Torse et Bottes de type ${_esc(fullType)} équipés (set complet)">
        <span class="set-badge-ico">${ico}</span><b>Set ${_esc(fx.tag)} 3/3</b><span class="set-badge-fx">${_esc(fx.fx)}</span>
      </span>`;
    } else {
      const types = Object.keys(counts);
      let reason;
      if (equippedCount < 3) {
        reason = `Équipe Tête, Torse et Bottes du même type pour activer un bonus d'ensemble.`;
      } else if (types.length > 1) {
        const list = types.map(t => `${counts[t]}× ${t}`).join(', ');
        reason = `Types mélangés (${list}) — il faut 3× le même type.`;
      } else {
        reason = `Continue d'équiper les 3 pièces d'un même type.`;
      }
      setBadgeHtml = `<span class="set-badge" title="${_esc(reason)}"><span class="set-badge-ico">🌱</span><b>Set ${equippedCount}/3</b></span>`;
      setHintHtml  = `<div class="set-hint">${_esc(reason)}</div>`;
    }
  } catch (e) { console.warn('[set bonus]', e); }

  // ── Bootstrap async des caches DB (styles de combat + types de dégâts magiques)
  // Au 1er rendu, les caches sont vides → on déclenche les chargements et on re-render
  // quand chacun est prêt. Style/Éléments affichent un placeholder dim entre temps.
  if (!_combatTabCache.styles) {
    loadCombatStyles().then(s => {
      _combatTabCache.styles = s || [];
      if (charSession.getCurrentCharTab() === 'combat') _renderTabV3('combat', c, canEdit);
    }).catch(() => { _combatTabCache.styles = []; });
  }
  if (!_combatTabCache.dmgTypes) {
    loadDamageTypes().then(t => {
      _combatTabCache.dmgTypes = t || [];
      if (charSession.getCurrentCharTab() === 'combat') _renderTabV3('combat', c, canEdit);
    }).catch(() => { _combatTabCache.dmgTypes = []; });
  }

  // ── STYLE de combat : auto-détecté depuis les armes équipées (comme avant)
  // Style de combat — détecté depuis les armes. Rendu en bande compacte (1 ligne)
  // placée sous la grille d'armes, à sa source logique : nom + aperçu de l'effet,
  // description complète au survol. Économise tout un bloc.
  let styleHtml = '';
  let detected = null;
  try { detected = detectCombatStyle?.(c, _combatTabCache.styles || []); } catch (e) { console.warn('[style detect]', e); }
  const _styleCog = STATE.isAdmin ? `<button class="cstyle-strip-cog" data-action="openCombatStylesAdmin" title="Gérer les styles (admin)">⚙️</button>` : '';
  if (!_combatTabCache.styles) {
    styleHtml = `<div class="cstyle-strip" style="--style-c:var(--text-dim)">
      <span class="cstyle-strip-ico">🧙</span>
      <span class="cstyle-strip-name" style="color:var(--text-dim);font-style:italic">Style — chargement…</span>
    </div>`;
  } else if (detected) {
    const col  = detected.couleur || detected.color || '#9d6fff';
    const name = detected.label || detected.name || 'Sans nom';
    const desc = detected.description || '';
    styleHtml = `<div class="cstyle-strip" style="--style-c:${col}"${desc?` title="${_esc(desc)}"`:''}>
      <span class="cstyle-strip-ico">${_esc(detected.icon || detected.icone || '🧙')}</span>
      <span class="cstyle-strip-name" style="color:${col}">${_esc(name)}</span>
      ${desc?`<span class="cstyle-strip-desc">${_esc(desc)}</span>`:''}
      ${_styleCog}
    </div>`;
  } else {
    styleHtml = `<div class="cstyle-strip" style="--style-c:var(--text-dim)">
      <span class="cstyle-strip-ico">🧙</span>
      <span class="cstyle-strip-name" style="color:var(--text-dim);font-style:italic">Aucun style — équipe une arme</span>
      ${_styleCog}
    </div>`;
  }

  // ── ÉLÉMENTS : depuis les types de dégâts magiques définis en BDD
  const dmgTypes = _combatTabCache.dmgTypes || [];
  const magicTypes = dmgTypes.length ? getMagicTypes(dmgTypes) : [];
  const charElems = c.elements || [];
  let elemsHtml = '';
  if (!dmgTypes.length) {
    elemsHtml = `<div class="elem-card">
      <div class="elem-card-head">Éléments maîtrisés</div>
      ${loadingHtml('Chargement…', { compact: true })}
    </div>`;
  } else {
    const elemChips = magicTypes.map(t => {
      const on = charElems.includes(t.id);
      const col = t.color || '#9ca3af';
      const cls = on ? 'elem-chip on' : 'elem-chip';
      const style = `--elem-bg:${col}22;--elem-bd:${col}66;--elem-c:${col}`;
      const handler = canEdit ? `data-action="toggleCharElement" data-id="${c.id}" data-elem="${t.id}"` : '';
      return `<span class="${cls}" data-elem-id="${_esc(t.id)}" style="${style}" ${handler}>${_esc(t.icon || '')} ${_esc(t.label)}</span>`;
    }).join('');
    elemsHtml = `<div class="elem-card">
      <div class="elem-card-head">
        Éléments maîtrisés
        ${STATE.isAdmin ? `<button class="section-action" style="float:right" data-action="openDamageTypesAdmin" title="Gérer les types (admin)">⚙️</button>` : ''}
      </div>
      <div class="elem-row">${elemChips || '<span style="font-size:.72rem;color:var(--text-dim);font-style:italic">Aucun type magique défini.</span>'}</div>
    </div>`;
  }

  // ── MAÎTRISES (champ canonique: m.typeArme + m.niveau + m.note)
  const maits = c.maitrises || [];
  const maitsHtml = maits.length ? `<div class="mait-grid">
    ${maits.map((m, i) => {
      const niv = parseInt(m.niveau) || 0;
      const pips = Array.from({ length: 5 }, (_, k) => `<span class="mait-pip ${k < niv ? 'on' : ''}"></span>`).join('');
      const bonus = niv > 0 ? `+${niv} dégât${niv>1?'s':''}` : 'Initié';
      const name = m.typeArme || m.nom || m.name || 'Sans type';
      return `<div class="mait-card" ${canEdit?`data-action="editMaitrise" data-idx="${i}" style="cursor:pointer"`:''}>
        <div class="mait-head">
          <span class="mait-name">${_esc(name)}</span>
          <span class="mait-bonus">${_esc(bonus)}</span>
        </div>
        <div class="mait-pips">${pips}</div>
        ${m.note ? `<div class="mait-note">${_esc(m.note)}</div>` : ''}
      </div>`;
    }).join('')}
  </div>` : `<div class="q-empty">Aucune maîtrise enregistrée.</div>`;

  return `
  <div class="section">
    <div class="section-head">
      <div class="section-title"><span class="ico">⚔️</span> Armes équipées</div>
      ${canEdit?`<button class="section-action" data-action="editEquipSlot" data-slot="Main principale">＋ Équiper</button>`:''}
    </div>
    <div class="weap-grid">${weapsHtml}</div>
    ${styleHtml}
  </div>

  <div class="section">
    <div class="section-head">
      <div class="section-title"><span class="ico">🪖</span> Armures & Accessoires</div>
      ${setBadgeHtml}
    </div>
    ${armorRows}
    ${setHintHtml}
  </div>

  <div class="section">
    <div class="section-head">
      <div class="section-title"><span class="ico">🎯</span> Maîtrises &amp; affinités</div>
      ${canEdit?`<button class="section-action" data-action="addMaitrise">＋ Maîtrise</button>`:''}
    </div>
    <div class="combat-footer">
      <div class="cmeta-col">
        <div class="cmeta-col-head">Maîtrises d'armes</div>
        ${maitsHtml}
      </div>
      ${elemsHtml}
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// V3 — INVENTAIRE (header avec summary + filter chips, puis renderer existant)
// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// V3 — INVENTAIRE (.inv-card grid + summary + filter chips + search)
// ══════════════════════════════════════════════════════════════════════════════
// Aligné sur shared/rarity.js (5 niveaux + niveau 0 sans rareté)
// 1=Commun · 2=Singulier · 3=Rare · 4=Mythique · 5=Légendaire
const _RARE_NAMES = ['', 'Commun', 'Singulier', 'Rare', 'Mythique', 'Légendaire'];
const _RARE_COLS  = ['#7a8fa8', '#9ca3af', '#4ade80', '#60a5fa', '#c084fc', '#f97316'];

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

function renderCharInventaireV3(c, canEdit) {
  const inv = c.inventaire || [];
  const totalItems = inv.reduce((sum, item) =>
    sum + (parseInt(item.quantite || item.qte || 1) || 1), 0);
  let equipped = 0;
  try {
    const equipMap = getEquippedInventoryIndexMap?.(c) || new Map();
    equipped = equipMap.size;
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
    <div class="inv-densityseg" role="group" aria-label="Mode d’affichage">
      <button class="${_csV3InvDensity === 'cards' ? 'on' : ''}" data-action="csV3InvSetDensity"
        data-density="cards" aria-pressed="${_csV3InvDensity === 'cards'}" title="Vue cartes">▦</button>
      <button class="${_csV3InvDensity === 'list' ? 'on' : ''}" data-action="csV3InvSetDensity"
        data-density="list" aria-pressed="${_csV3InvDensity === 'list'}" title="Vue liste">☰</button>
    </div>
    ${canEdit ? `<button class="btn btn-gold btn-sm inv-add-btn" data-action="addInvItem" data-id="${c.id}" title="Ajouter un objet">＋ <span>Objet</span></button>` : ''}
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
    // Rareté : 0=aucune, 1=Commun → 5=Légendaire (aligné sur la boutique)
    const rareRaw = parseInt(it.rarete || it.rare || 0) || 0;
    const rareIdx = Math.min(5, Math.max(0, rareRaw));
    const col = _RARE_COLS[rareIdx];
    const stars = rareIdx > 0 ? ('★'.repeat(rareIdx) + '☆'.repeat(5 - rareIdx)) : '';
    const allIdxB64 = btoa(JSON.stringify(allIdx));

    // Prix d'achat (référence) et prix de vente (au joueur quand il revend)
    const catalogItem = getInventoryCatalogItem(it.itemId);
    const prixAchat = getInventoryItemValue(it, catalogItem);
    const prixVente = getInventoryItemResaleValue(it, catalogItem);
    const image = getInventoryItemImage(it, catalogItem);

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
    if (it.format) props.push({ k: 'Format', v: it.format });
    if (effetTxt && hero?.k !== 'Effet') props.push({ k: 'Effet', v: effetTxt, c: 'effect' });
    const traits = _getTraits?.(it) || [];

    const equipMap = (() => { try { return getEquippedInventoryIndexMap?.(c) || new Map(); } catch { return new Map(); } })();
    const isEquipped = allIdx.some(i => equipMap.has(i));

    return `<div class="inv-card ${isEquipped?'is-equipped':''}" style="--rare-c:${col}">
      <div class="inv-card-head">
        <button class="inv-card-visual" data-action="openInventoryItemDetail" data-id="${c.id}"
          data-indices="${allIdxB64}" title="Inspecter ${_esc(it.nom || 'l’objet')}">
          ${image ? `<img src="${_esc(image)}" alt="">` : `<span aria-hidden="true">${cat.icon || '◇'}</span>`}
        </button>
        <div class="inv-card-identity">
          <div class="inv-card-name">${_esc(it.nom || 'Sans nom')}</div>
          <div class="inv-card-subline">
            <span class="inv-card-cat">${cat.icon ? `<span aria-hidden="true">${cat.icon}</span>` : ''}${_esc(cat.lbl)}</span>
            ${rareIdx > 0
              ? `<span class="inv-card-rare" style="color:${col}">${stars} ${_RARE_NAMES[rareIdx]}</span>`
              : ''}
            ${isEquipped ? '<span class="inv-equipped-badge">Équipé</span>' : ''}
          </div>
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
  await updateInCol('characters', charId, { stats, statsLevelUps: levelUps });
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
      ? `★ ${c.nom || 'Personnage'} défini comme personnage par défaut`
      : 'Personnage par défaut retiré', 'success');
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
  // Sélection
  selectChar:              (btn)    => selectChar(btn.dataset.id, btn),
  createNewChar:           ()       => createNewChar(),
  filterAdminChars:        (btn)    => filterAdminChars(btn.dataset.pseudo, btn),
  _setDefaultCharacter:    (btn)    => _setDefaultCharacter(btn.dataset.id),

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
  addXpDelta:              (btn)    => addXpDelta(btn.dataset.id),

  // Actions identité
  manageTitres:            (btn)    => manageTitres(btn.dataset.id),
  openCharExportMenu:      (btn)    => openCharExportMenu(btn.dataset.id, btn),
  deleteChar:              (btn)    => deleteChar(btn.dataset.id),
  setCharAura:             (btn)    => setCharAura(btn.dataset.id, btn.dataset.auraKey),
  setCharAuraColor:        (el)     => setCharAuraColor(el.dataset.id, el.value),
  openSendGoldModal:       (btn)    => openSendGoldModal(btn.dataset.id),

  // Ledger
  csV3LedgerSetKind:       (btn)    => _csV3LedgerSetKind(btn.dataset.id, btn.dataset.kind),
  csV3LedgerSetAddKind:    (btn)    => _csV3LedgerSetAddKind(btn.dataset.kind, btn.dataset.id),
  csV3AddLedger:           (btn)    => _csV3AddLedger(btn.dataset.id),
  csV3DeleteLedger:        (btn)    => _csV3DeleteLedger(btn.dataset.id, btn.dataset.kind, Number(btn.dataset.idx)),
  csV3LedgerMore:          (btn)    => _csV3LedgerMore(btn.dataset.id),

  // Journal
  csV3JournalSub:          (btn)    => _csV3JournalSub(btn.dataset.sub),
  addNote:                 ()       => addNote(),
  addQuete:                ()       => addQuete(),
  csV3AddRelation:         (btn)    => _csV3AddRelation(btn.dataset.id),
  toggleQuete:             (btn)    => toggleQuete(Number(btn.dataset.idx)),
  deleteQuete:             (btn)    => deleteQuete(Number(btn.dataset.idx)),
  csV3ToggleNote:          (btn)    => _csV3ToggleNote(Number(btn.dataset.idx)),
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
  csV3AddFact:              (btn)   => _csV3AddFact(btn.dataset.id),
  openProfilImageUpload:    (btn)   => openProfilImageUpload(btn.dataset.id),
  removeProfilImage:        (btn)   => removeProfilImage(btn.dataset.id),

  // Équipement & combat
  openCharCalculation:       (btn)   => openCharCalculation(btn),
  editEquipSlot:            (btn)   => editEquipSlot(btn.dataset.slot),
  openCombatStylesAdmin:    ()      => openCombatStylesAdmin(),
  openDamageTypesAdmin:     ()      => openDamageTypesAdmin(),
  toggleCharElement:        (btn)   => toggleCharElement(btn.dataset.id, btn.dataset.elem),

  // Maîtrises
  addMaitrise:              ()      => addMaitrise(),
  editMaitrise:             (btn)   => editMaitrise(Number(btn.dataset.idx)),

  // Inventaire
  openInventoryItemDetail:  (btn)   => openInventoryItemDetail(btn.dataset.id, btn.dataset.indices),
  addInvItem:               ()      => addInvItem(),
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
  _allocStatPoint:          (btn)   => allocStatPoint(btn.dataset.id, btn.dataset.key, Number(btn.dataset.delta)),
  _adjVitalBase:            (btn)   => adjVitalBase(btn.dataset.id, btn.dataset.field, Number(btn.dataset.delta)),
  saveMaitrise:             (btn)   => saveMaitrise(Number(btn.dataset.idx)),
  deleteMaitrise:           (btn)   => deleteMaitrise(Number(btn.dataset.idx)),
});

charSession.bindRender(_renderTab, renderCharSheet, refreshOrDisplay);

// Navigation clavier des onglets de fiche (pattern WAI-ARIA tablist) :
// ← → bouclent, Home/End vont au premier/dernier, activation automatique au focus.
// Listener délégué unique (module importé une seule fois en lazy).
document.addEventListener('keydown', (e) => {
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

