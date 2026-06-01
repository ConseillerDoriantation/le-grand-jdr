// ══════════════════════════════════════════════
// characters.js — Point d'entrée mince
// Toute la logique est dans assets/js/features/characters/
// ══════════════════════════════════════════════
import { STATE } from '../core/state.js';
import { updateInCol } from '../data/firestore.js';
import { _esc, modStr } from '../shared/html.js';
import { charSession } from '../shared/char-session.js';
import {
  getMod, calcCA, calcVitesse, calcDeckMax, calcPVMax, calcPMMax,
  calcOr, calcPalier, pct, getItemStatBonus, getItemEffectText,
  sortCharactersForDisplay,
} from '../shared/char-stats.js';

// ── Sous-modules ─────────────────────────────────────────────────────────────
import {
  loadCombatStyles, _defaultCombatStyles, detectCombatStyle,
  openCombatStylesAdmin, openWeaponFormatsAdmin, openDamageTypesAdmin, openSpellMatricesAdmin,
  _getTraits, getEquippedInventoryIndexMap, syncEquipmentAfterInventoryMutation,
  normalizeArmorType, getArmorTypeMeta, getArmorSetChipText, getArmorSetData,
  applyFlatBonusToRollText, getToucherDisplay, getDegatsDisplay,
  // V3 — combat helpers
  getMainWeapon, getWeaponToucherParts, getWeaponDegatsParts,
} from './characters/data.js';

import {
  sortDragStart, sortDragOver, sortDragEnd, sortDrop,
  renderCharDeck, openSortCatEditor, toggleSortDetail,
  addSort, editSort, openSortModal, saveSort,
  runeIncrement, runeDecrement, selectNoyau, updateSortPM,
} from './characters/spells.js';

import { renderCharEquip, toggleCharElement } from './characters/combat.js';

import {
  _renderInventaireBoutique, renderCharInventaire,
  openSellInvModal, sellInvItemBulk, sellInvItem,
  openDeleteInvModal, deleteInvItemBulk,
  openSendInvModal, sendInvItem,
  openSendGoldModal, sendGold,
  addInvItem, _lootPillStyle, saveInvItemFromShop,
  editInvItem, saveInvItem,
  filterInvRows,
} from './characters/inventory.js';

import {
  equipSlotFromInv, editEquipSlot, previewEquipFromInv,
  saveEquipSlot, clearEquipSlot,
} from './characters/equipment.js';

import {
  renderCharCarac, renderCharQuetes, renderCharNotes,
  toggleNote, addNote, editNoteTitle, saveNote, deleteNote,
  renderCharCompte, refreshOrDisplay,
  addCompteRow, deleteCompteRow, saveCompteField,
  renderCharMaitrises,
  addMaitrise, editMaitrise, saveMaitrise, deleteMaitrise,
  previewXpBar, saveXpDirect, addXpDelta,
  allocStatPoint, addXpFromInput, toggleCompteHist,
  renderCharProfil, saveCharProfil, openProfilImageUpload, removeProfilImage,
  addProfilTag, removeProfilTag, initProfilTagUi,
  getProfilCacheRef as _profilCache,
} from './characters/tabs.js';
import { bindRichTextEditors, richTextEditorHtml, getRichTextHtml, richTextContentHtml } from '../shared/rich-text.js';
import { registerActions } from '../core/actions.js';

import {
  inlineEditText, inlineEditNum, inlineEditChip,
  inlineEditStatFromCard, inlineEditStat,
} from './characters/inline-edit.js';

import {
  adjustStat, saveNotes,
  toggleSort, toggleQuete, deleteQuete,
  deleteSort, deleteInvItem, deleteChar, createNewChar,
  manageTitres, addTitre, removeTitre, saveTitres,
  addQuete, saveQuete, deleteCharPhoto,
} from './characters/forms.js';

import {
  exportCharJSON, exportCharPDF, openCharExportMenu,
} from './characters/export.js';

import { quickViewChar } from './characters/quick-view.js';
import { loadDamageTypes, getMagicTypes } from '../shared/damage-types.js';
import Sortable from '../vendor/sortable.esm.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { openModal, closeModalDirect, confirmModal } from '../shared/modal.js';

// Caches partagés Phase 2 — chargés à la demande au 1er affichage Combat
let _combatTabCache = { styles: null, dmgTypes: null };
let _charAdminFilter = null;
let _currentTopTab   = 'combat';
let _csV3LedgerFilter = { kind: 'all', search: '', limit: 25 };
let _csV3LedgerAddKind = 'recettes';
let _csV3InvFilter = { cat: 'all', search: '' };
let _currentJournalSub = 'notes';
let _openNote = null;
let _csV3EditingBio = null;

// Palette d'auras — constante partagée par renderCharSheet et setCharAura
const AURA_PALETTE = {
  blue: '#4f8cff', arcane: '#9d6fff', crimson: '#ff5a7e',
  gold: '#e8b84b', emerald: '#22c38e', ember: '#ff9544',
};
const _auraColor = (key) => AURA_PALETTE[key] || AURA_PALETTE.blue;
const _charBlurActions = {};
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
function charNavCardHtml(c, active = false) {
  const id = c.id || '';
  const name = c.nom || 'Sans nom';
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const level = c.niveau || 1;
  const photoPos = `${50 + (Number(c.photoX) || 0) * 50}% ${50 + (Number(c.photoY) || 0) * 50}%`;
  const details = [c.classe, c.race].filter(Boolean).join(' · ') || c.ownerPseudo || '';
  const portrait = c.photo
    ? `<img class="char-pill-img" src="${_esc(c.photo)}" alt="" style="object-position:${photoPos}">`
    : `<span class="char-pill-img char-pill-img--empty" aria-hidden="true">${_esc(initial)}</span>`;

  return `<button type="button" class="char-pill ${active ? 'active' : ''}" data-charid="${_esc(id)}" data-action="selectChar" data-id="${id}">
    <span class="char-pill-img-wrap">${portrait}</span>
    <span class="char-pill-niv" aria-label="Niveau ${_esc(level)}">${_esc(level)}</span>
    <span class="char-pill-body">
      <span class="char-pill-name">${_esc(name)}</span>
      ${details ? `<span class="char-pill-meta">${_esc(details)}</span>` : ''}
    </span>
  </button>`;
}

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
  if (chars.length > 0) { STATE.activeChar = chars[0]; renderCharSheet(chars[0]); }
}

// ══════════════════════════════════════════════
// ROUTING — correspondance onglets
// ══════════════════════════════════════════════
const _LEAF_TO_TOP = {
  equipement:'combat', sorts:'combat', maitrises:'combat',
  notes:'journal',     quetes:'journal',
  inventaire:'inventaire', compte:'compte', profil:'profil',
  // rétro-compat
  combat:'combat', carac:'combat',
};
const _TOP_DEFAULTS = {
  combat:'equipement', journal:'notes',
  inventaire:'inventaire', compte:'compte', profil:'profil',
};

function _resolveTab(raw) {
  const top  = _LEAF_TO_TOP[raw] || 'combat';
  const leaf = _TOP_DEFAULTS[raw] || (_LEAF_TO_TOP[raw] ? raw : 'equipement');
  return { top, leaf };
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


// Convertit une couleur hex aura (#rrggbb) en variables CSS rgba
function _auraVars(hexCol) {
  const r = parseInt(hexCol.slice(1,3),16);
  const g = parseInt(hexCol.slice(3,5),16);
  const b = parseInt(hexCol.slice(5,7),16);
  return {
    auraGlow: `rgba(${r},${g},${b},.14)`,
    auraBd:   `rgba(${r},${g},${b},.55)`,
    auraSh:   `0 0 38px rgba(${r},${g},${b},.28)`,
  };
}

// Pastilles de sélection de personnage (char-switch)
function _buildCharSwitchHtml(activeCharId, canEdit) {
  let switchable = STATE.isAdmin
    ? (STATE.characters || [])
    : (STATE.characters || []).filter(x => x.uid === STATE.user?.uid);
  if (STATE.isAdmin && _charAdminFilter)
    switchable = switchable.filter(x => x.ownerPseudo === _charAdminFilter);
  switchable = sortCharactersForDisplay(switchable);

  const pillsHtml = switchable.map(ch => {
    const col = _auraColor(ch.aura);
    const init = (ch.nom || '?')[0].toUpperCase();
    const photoPos = `${50+(ch.photoX||0)*50}% ${50+(ch.photoY||0)*50}%`;
    const titleSuffix = ch.isDefault ? ' · ★ Par défaut' : '';
    return `<button class="char-pill${ch.id===activeCharId?' active':''}${ch.isDefault?' is-default':''}"
      data-charid="${ch.id}" data-action="selectChar" data-id="${ch.id}"
      style="--av-c:${col}" title="${_esc(ch.nom || 'Sans nom')} — Niv.${ch.niveau||1}${ch.classe?' · '+_esc(ch.classe):''}${titleSuffix}">
      <span class="char-pill-av">${ch.photo
        ? `<img src="${ch.photo}" style="object-position:${photoPos}">`
        : init}${ch.isDefault?'<span class="char-pill-star" title="Personnage par défaut">★</span>':''}</span>
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
  return [
    { k: 'combat',  ico: '⚔️', lbl: 'Combat' },
    { k: 'sorts',   ico: '✨', lbl: 'Sorts',      badge: `${(c.deck_sorts||[]).filter(x=>x.actif).length}/${calcDeckMax(c)}` },
    { k: 'inv',     ico: '🎒', lbl: 'Inventaire', badge: `${(c.inventaire||[]).length||''}` },
    { k: 'compte',  ico: '💰', lbl: 'Compte' },
    { k: 'journal', ico: '📖', lbl: 'Journal' },
    { k: 'profil',  ico: '👤', lbl: 'Profil' },
  ].map(t => `<button class="tab-v3 ${t.k===v3Tab?'active':''}"
    data-tab-v3="${t.k}" data-action="showCharTab" data-tab="${t.k}">
    <span class="tab-ico">${t.ico}</span> ${t.lbl}
    ${t.badge?`<span class="tab-badge">${t.badge}</span>`:''}
  </button>`).join('');
}

function _buildSidebarHtml(c, canEdit, { auraGlow, auraBd, auraSh, pvCur, pvMax, pvPct, hpBarCls, pmCur, pmMax, pmPct, xpCur, xpPalier, xpPct, deckActifs, deckMax, titresChips }) {
  return `<aside class="id-side" id="cs-sidebar" data-aura="${c.aura||'blue'}"
    style="--aura-glow:${auraGlow};--aura-border:${auraBd};--aura-shadow:${auraSh}">

    <div class="id-portrait-wrap">
      <div class="id-portrait"
           ${canEdit ? `data-action="open-character-photo" data-charid="${c.id}"` : ''}>
        ${c.photo
          ? `<img src="${c.photo}" style="transform:scale(${c.photoZoom||1}) translate(${c.photoX||0}px,${c.photoY||0}px);transform-origin:center">`
          : `${(c.nom||'?')[0].toUpperCase()}`}
      </div>
      <div class="id-lvl-badge">${canEdit
        ? `<button type="button" class="id-lvl-edit" data-action="inlineEditNum" data-id="${c.id}" data-field="niveau" data-min="1" data-max="20" title="Modifier le niveau" style="background:none;border:none;color:inherit;font:inherit;letter-spacing:inherit;cursor:pointer;padding:0">Niv. <strong>${c.niveau||1}</strong></button>`
        : `Niv. <strong>${c.niveau||1}</strong>`}</div>
    </div>

    <div class="id-name-row">
      ${canEdit
        ? `<span class="id-name" data-action="inlineEditText" data-id="${c.id}" data-field="nom" title="Renommer">${_esc(c.nom||'Sans nom')}</span>`
        : `<span class="id-name">${_esc(c.nom||'Sans nom')}</span>`}
      <span class="id-actions-mini">
        ${canEdit?`<button class="id-default-btn${c.isDefault?' is-on':''}"
          title="${c.isDefault?"Personnage par défaut — il représente le joueur":'Définir comme personnage par défaut'}"
          data-action="_setDefaultCharacter" data-id="${c.id}">${c.isDefault?'★':'☆'}</button>`:''}
        ${canEdit?`<button title="Renommer" data-action="inlineEditText" data-id="${c.id}" data-field="nom" data-target-sel=".id-name">✎</button>`:''}
        ${canEdit?`<button title="Exporter" data-action="openCharExportMenu" data-id="${c.id}">📤</button>`:''}
        ${canEdit?`<button class="id-del-btn" title="Supprimer ce personnage" data-action="deleteChar" data-id="${c.id}">🗑️</button>`:''}
      </span>
    </div>

    ${titresChips}

    <div class="id-chips">
      ${canEdit
        ? `<span class="id-chip classe" data-action="inlineEditChip" data-id="${c.id}" data-field="classe" data-label="Classe">${_esc(c.classe||'Classe')}</span>`
        : (c.classe?`<span class="id-chip classe">${_esc(c.classe)}</span>`:'')}
      ${canEdit
        ? `<span class="id-chip race" data-action="inlineEditChip" data-id="${c.id}" data-field="race" data-label="Race">${_esc(c.race||'Race')}</span>`
        : (c.race?`<span class="id-chip race">${_esc(c.race)}</span>`:'')}
    </div>

    <!-- XP -->
    <div class="xp-block">
      <div class="xp-row"><span>Expérience</span><span class="xp-pct">${xpPct}%</span></div>
      <div class="xp-track"><div class="xp-fill" id="xp-bar-fill" style="width:${xpPct}%"></div></div>
      <div class="xp-meta">
        <span>${canEdit
          ? `<button type="button" class="xp-set-btn" data-action="inlineEditNum" data-id="${c.id}" data-field="exp" data-min="0" data-max="${xpPalier}" title="Définir l'XP total" style="background:none;border:none;color:inherit;font:inherit;cursor:pointer;padding:0;text-decoration:underline dotted">${xpCur.toLocaleString('fr-FR').replace(/ /g,' ')}</button>`
          : xpCur.toLocaleString('fr-FR').replace(/ /g,' ')} / ${xpPalier.toLocaleString('fr-FR').replace(/ /g,' ')} XP</span>
        <span>→ Niv. ${(c.niveau||1)+1}</span>
      </div>
      ${canEdit?`<div class="xp-add">
        <label>＋ XP</label>
        <input type="number" id="xp-add-input-${c.id}" placeholder="0"
          onkeydown="if(event.key==='Enter'){addXpDelta('${c.id}');event.preventDefault()}">
        <button data-action="addXpDelta" data-id="${c.id}">Ajouter</button>
      </div>`:''}
    </div>

    <!-- PV -->
    <div class="vital hp ${pvPct<25?'danger':''}" id="vital-hp">
      <div class="vital-icon">❤</div>
      <div class="vital-body">
        <div class="vital-head">
          <span class="vital-label">Points de Vie</span>
          <span class="vital-num"><span id="pv-val">${pvCur}</span><small>/ ${pvMax}</small></span>
        </div>
        <div class="vital-bar"><div class="${hpBarCls}" id="pv-bar" style="width:${pvPct}%"></div></div>
        <div class="vital-ctrls">
          ${canEdit?`<button class="vital-btn" data-action="adjustStat" data-field="pvActuel" data-delta="-1" data-id="${c.id}">−</button>`:''}
          <span class="vital-temp">${canEdit ? `<button class="cs-vital-base-btn" style="background:none;border:none;color:inherit;cursor:pointer" data-action="inlineEditNum" data-id="${c.id}" data-field="pvBase" data-min="1" data-max="999" title="PV base">base ${c.pvBase||10}</button>` : `base ${c.pvBase||10}`}</span>
          ${canEdit?`<button class="vital-btn plus" data-action="adjustStat" data-field="pvActuel" data-delta="1" data-id="${c.id}">+</button>`:''}
        </div>
      </div>
    </div>

    <!-- PM -->
    <div class="vital mp">
      <div class="vital-icon">✦</div>
      <div class="vital-body">
        <div class="vital-head">
          <span class="vital-label">Points de Magie</span>
          <span class="vital-num"><span id="pm-val">${pmCur}</span><small>/ ${pmMax}</small></span>
        </div>
        <div class="vital-bar"><div class="vital-bar-fill" id="pm-bar" style="width:${pmPct}%"></div></div>
        <div class="vital-ctrls">
          ${canEdit?`<button class="vital-btn" data-action="adjustStat" data-field="pmActuel" data-delta="-1" data-id="${c.id}">−</button>`:''}
          <span class="vital-temp">${canEdit ? `<button class="cs-vital-base-btn" style="background:none;border:none;color:inherit;cursor:pointer" data-action="inlineEditNum" data-id="${c.id}" data-field="pmBase" data-min="1" data-max="999" title="PM base">base ${c.pmBase||10}</button>` : `base ${c.pmBase||10}`}</span>
          ${canEdit?`<button class="vital-btn plus" data-action="adjustStat" data-field="pmActuel" data-delta="1" data-id="${c.id}">+</button>`:''}
        </div>
      </div>
    </div>

    <!-- Mini stats : CA · Vit. · Deck (3 colonnes) -->
    <div class="cs-mini-grid cs-mini-grid-3">
      <div class="cs-mini"><span class="cs-mini-icon">🛡️</span><div class="cs-mini-body"><span class="cs-mini-lbl">CA</span><span class="cs-mini-val">${calcCA(c)}</span></div></div>
      <div class="cs-mini"><span class="cs-mini-icon">🏃</span><div class="cs-mini-body"><span class="cs-mini-lbl">Vit.</span><span class="cs-mini-val">${calcVitesse(c)}m</span></div></div>
      <div class="cs-mini" title="Sorts actifs / capacité du deck (basée sur l'INT)" data-action="showCharTab" data-tab="sorts" style="cursor:pointer"><span class="cs-mini-icon">✦</span><div class="cs-mini-body"><span class="cs-mini-lbl">Deck</span><span class="cs-mini-val">${deckActifs}<small style="font-size:.62rem;color:var(--text-dim);font-weight:600;margin-left:1px">/${deckMax}</small></span></div></div>
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

    ${canEdit?`<div class="aura-row">
      <span class="aura-lbl">Aura</span>
      <div class="aura-dots">
        ${Object.entries(AURA_PALETTE).map(([k,col]) => `
          <button class="aura-dot${(c.aura||'blue')===k?' active':''}"
            style="--dot-c:${col}" data-aura="${k}"
            data-action="setCharAura" data-id="${c.id}" data-aura-key="${k}"
            title="${k}"></button>`).join('')}
      </div>
    </div>`:''}

  </aside>`;
}

function _buildMainColHtml(c, canEdit, { tilesHtml, tabsHtml, lvlPointsRemaining, titres, playerLbl, advLbl }) {
  return `<section class="main-col">

    <!-- Hero strip -->
    <div class="hero-strip">
      <div class="hero-id">
        <div class="hero-id-name">${_esc(c.nom || 'Sans nom')}
          <span class="hero-id-tag">${[c.classe, c.race, titres[0]].filter(Boolean).map(_esc).join(' · ')}</span>
        </div>
        ${advLbl || playerLbl ? `<div class="hero-id-tag" style="font-size:.7rem">
          ${advLbl}${playerLbl}
        </div>` : ''}
      </div>
    </div>

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
    <nav class="tabs-v3" id="char-tabs-v3">
      ${tabsHtml}
    </nav>

    <div id="char-tab-content" class="tab-body-v3"></div>

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
  const { auraGlow, auraBd, auraSh } = _auraVars(_auraColor(c.aura));
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

  const playerLbl = c.ownerPseudo ? `<span class="hero-tag-sep">·</span><span style="color:var(--text-dim)">Joueur :</span> ${_esc(c.ownerPseudo)}` : '';
  const advLbl    = STATE.adventure?.nom ? `<span style="color:var(--text-dim)">Aventure :</span> ${_esc(STATE.adventure.nom)}` : '';

  const sidebarHtml = _buildSidebarHtml(c, canEdit, { auraGlow, auraBd, auraSh, pvCur, pvMax, pvPct, hpBarCls, pmCur, pmMax, pmPct, xpCur, xpPalier, xpPct, deckActifs, deckMax, titresChips });
  const mainColHtml = _buildMainColHtml(c, canEdit, { tilesHtml, tabsHtml, lvlPointsRemaining, titres, playerLbl, advLbl });

  area.innerHTML = `<div class="cs-v3">
  <div class="app-shell">
    <div class="char-switch-row">${charSwitchHtml}</div>
    <div class="sheet">
      ${sidebarHtml}
      ${mainColHtml}
    </div>
  </div>
</div>`;

  _renderTabV3(v3Tab, c, canEdit);
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
  const sub = _currentJournalSub || 'notes';
  const renders = {
    combat:  () => renderCharCombatV3(c, canEdit),
    sorts:   () => renderCharDeck(c, canEdit),
    inv:     () => renderCharInventaireV3(c, canEdit),
    compte:  () => renderCharLedger(c, canEdit),
    journal: () => renderCharJournal(c, canEdit, sub),
    profil:  () => renderCharProfilV3(c, canEdit),
  };
  area.innerHTML = renders[tab]?.() || '';
  area.classList.remove('cs-tab-fadein');
  void area.offsetWidth;
  area.classList.add('cs-tab-fadein');
  if (tab === 'profil') {
    bindRichTextEditors(area);
    initProfilTagUi();
  }
  if (tab === 'journal' && sub === 'notes') { bindRichTextEditors(area); _bindNotesDnd(c, canEdit); }
  if (tab === 'journal' && sub === 'quetes') _bindQuetesDnd(c, canEdit);
  if (tab === 'sorts') _bindSortsCatDrag(c, canEdit);
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

  _sortsCatSortable = new Sortable(wrap, {
    animation: 150,
    handle: '.cs-sort-cat-drag',
    draggable: '.cs-sort-cat-block:not(.is-default)',
    ghostClass: 'cs-sortable-ghost',
    chosenClass: 'cs-sortable-chosen',
    forceFallback: true,
    fallbackOnBody: true,
    delay: 80,
    delayOnTouchOnly: true,
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

// ── Compte → Ledger chronologique unique ─────────────────────────────────────
// Lit le schéma existant c.compte = { recettes:[], depenses:[] } et fusionne
// les deux flux en une timeline triée chronologiquement décroissante.

// Normalise une date de livret en clé numérique AAAAMMJJ pour un tri fiable.
// Gère les DEUX formats stockés en base : ISO "AAAA-MM-JJ" (ajout manuel via
// <input type=date>) et FR "JJ/MM/AAAA" (ventes / economy.js). 0 = inconnue.
function _ledgerDateKey(s) {
  const v = String(s || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);   // ISO AAAA-MM-JJ
  if (m) return (+m[1]) * 10000 + (+m[2]) * 100 + (+m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);     // FR JJ/MM/AAAA
  if (m) return (+m[3]) * 10000 + (+m[2]) * 100 + (+m[1]);
  return 0;
}

function renderCharLedger(c, canEdit) {
  // ⚠️ Toujours re-fetch la référence FRAÎCHE en cas de re-render asynchrone
  const fresh = STATE.characters.find(x => x.id === c.id) || c;
  c = fresh;
  const compte = c.compte || { recettes: [], depenses: [] };
  const recettes = (compte.recettes || []).map((r, i) => ({ ...r, sign: 1, kind: 'recettes', idx: i }));
  const depenses = (compte.depenses || []).map((d, i) => ({ ...d, sign: -1, kind: 'depenses', idx: i }));
  const tR = recettes.reduce((s, r) => s + (parseFloat(r.montant) || 0), 0);
  const tD = depenses.reduce((s, d) => s + (parseFloat(d.montant) || 0), 0);
  const solde = tR - tD;
  const fmt = (n) => {
    const v = Math.round((parseFloat(n) || 0) * 100) / 100;
    return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
  };
  // Tri chronologique décroissant via une clé numérique AAAAMMJJ qui gère les
  // deux formats stockés (ISO et FR). À date égale → dernière insertion en haut
  // (idx élevé = ajouté plus récemment dans son tableau).
  const all = [...recettes, ...depenses].sort((a, b) => {
    const ka = _ledgerDateKey(a.date), kb = _ledgerDateKey(b.date);
    if (ka !== kb) return kb - ka; // plus récent en haut ; date inconnue (0) en bas
    return (b.idx || 0) - (a.idx || 0);
  });

  // Filtres (état module-local pour ne pas être perdu au re-render)
  const filter = _csV3LedgerFilter;
  const q = (filter.search || '').toLowerCase();
  const filtered = all.filter(e => {
    if (filter.kind === 'rcpt' && e.sign < 0) return false;
    if (filter.kind === 'dep'  && e.sign > 0) return false;
    if (!q) return true;
    return (e.libelle || '').toLowerCase().includes(q)
        || (e.date || '').toLowerCase().includes(q);
  });
  const limit = filter.limit || 25;
  const visible = filtered.slice(0, limit);
  const hasMore = filtered.length > visible.length;

  // Groupement par "mois" : ISO YYYY-MM-DD → "YYYY-MM" formaté en "Mois AAAA",
  // sinon legacy split par "/"
  const MOIS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const monthKeyOf = (date) => {
    if (!date) return 'Sans date';
    const iso = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
    if (iso) return `${MOIS_FR[parseInt(iso[2],10)-1]} ${iso[1]}`;
    return date.split('/')[0]?.trim() || 'Sans date';
  };
  const groups = [];
  let curMonth = null;
  visible.forEach(e => {
    const month = monthKeyOf(e.date);
    if (month !== curMonth) {
      curMonth = month;
      groups.push({ month, items: [] });
    }
    groups[groups.length - 1].items.push(e);
  });

  const addKind = _csV3LedgerAddKind === 'depenses' ? 'depenses' : 'recettes';
  return `
  <div class="compte-summary">
    <div class="compte-tile">
      <span class="compte-tile-ico" style="color:var(--emerald)">↗</span>
      <div class="compte-tile-body">
        <span class="compte-lbl">Recettes</span>
        <span class="compte-val pos">+${fmt(tR)} <small>or</small></span>
        <span class="compte-sub">${recettes.length} entrée${recettes.length>1?'s':''}</span>
      </div>
    </div>
    <div class="compte-tile">
      <span class="compte-tile-ico" style="color:var(--crimson-light,#ff8ca7)">↘</span>
      <div class="compte-tile-body">
        <span class="compte-lbl">Dépenses</span>
        <span class="compte-val neg">−${fmt(tD)} <small>or</small></span>
        <span class="compte-sub">${depenses.length} entrée${depenses.length>1?'s':''}</span>
      </div>
    </div>
    <div class="compte-tile main">
      <span class="compte-tile-ico" style="color:var(--amber,#f4c430)">💰</span>
      <div class="compte-tile-body">
        <span class="compte-lbl">Solde — Bourse</span>
        <span class="compte-val gold">${fmt(solde)} <small>or</small></span>
        <span class="compte-sub">Disponible en jeu</span>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-head">
      <div class="section-title"><span class="ico">📜</span> Journal du trésor</div>
      <span class="section-hint">${filtered.length} / ${all.length} écriture${all.length>1?'s':''}</span>
    </div>

    <!-- Filtres -->
    <div class="ledger-filters">
      <div class="ledger-filter-segs">
        <button class="${filter.kind==='all'?'on':''}" data-action="csV3LedgerSetKind" data-id="${c.id}" data-kind="all">Tout</button>
        <button class="${filter.kind==='rcpt'?'on':''}" data-action="csV3LedgerSetKind" data-id="${c.id}" data-kind="rcpt" style="color:var(--emerald)">+ Recettes</button>
        <button class="${filter.kind==='dep'?'on':''}" data-action="csV3LedgerSetKind" data-id="${c.id}" data-kind="dep" style="color:var(--crimson-light, #ff8ca7)">− Dépenses</button>
      </div>
      <input type="text" class="ledger-search" placeholder="🔍 Rechercher…"
        value="${_esc(filter.search)}"
        data-input="_csV3LedgerSetSearch" data-id="${c.id}">
    </div>

    ${canEdit ? `
    <div class="ledger-add ${addKind==='depenses'?'is-dep':'is-rcpt'}">
      <div class="ledger-add-seg">
        <button type="button" class="${addKind==='recettes'?'on rcpt':''}"
          data-action="csV3LedgerSetAddKind" data-id="${c.id}" data-kind="recettes">↗ Recette</button>
        <button type="button" class="${addKind==='depenses'?'on dep':''}"
          data-action="csV3LedgerSetAddKind" data-id="${c.id}" data-kind="depenses">↘ Dépense</button>
      </div>
      <div class="ledger-add-fields">
        <label class="ledger-add-field">
          <span>Date</span>
          <input type="date" id="ledger-date"
            value="${_csV3TodayISO()}" class="ledger-add-date"
            onkeydown="if(event.key==='Enter'){event.preventDefault();this.closest('.ledger-add')?.querySelector('[data-action=csV3AddLedger]')?.click();}">
        </label>
        <label class="ledger-add-field ledger-add-field-lib">
          <span>Libellé</span>
          <input type="text" id="ledger-lib" placeholder="${addKind==='recettes'?'Pillage du gobelin…':'Auberge du nain…'}" class="lib"
            onkeydown="if(event.key==='Enter'){event.preventDefault();this.closest('.ledger-add')?.querySelector('[data-action=csV3AddLedger]')?.click();}">
        </label>
        <label class="ledger-add-field ledger-add-field-amt">
          <span>Montant (or)</span>
          <input type="number" id="ledger-amount" placeholder="0" step="any" min="0" class="ledger-add-amount"
            onkeydown="if(event.key==='Enter'){event.preventDefault();this.closest('.ledger-add')?.querySelector('[data-action=csV3AddLedger]')?.click();}">
        </label>
      </div>
      <button class="ledger-add-btn ${addKind}" data-action="csV3AddLedger" data-id="${c.id}">
        ${addKind==='recettes'?'＋ Encaisser':'− Décaisser'}
      </button>
    </div>` : ''}

    ${filtered.length === 0 ? `<div class="q-empty">${all.length===0?"Aucune écriture pour l'instant.":"Aucun résultat avec ce filtre."}</div>` : `
    <div class="ledger-scroll">
      <ol class="ledger">
        ${groups.map(g => `
          <li class="ledger-month">${_esc(g.month)}</li>
          ${g.items.map(e => {
            const editAttr = canEdit
              ? `contenteditable="true" spellcheck="false"
                  data-blur="csV3LedgerSaveField" data-kind="${e.kind}" data-idx="${e.idx}" data-field="$FIELD$"
                  onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}else if(event.key==='Escape'){this.textContent=this.dataset.original||'';this.blur();}"
                  onfocus="this.dataset.original=this.textContent"`
              : '';
            return `<li class="ledger-row ${e.sign>0?'rcpt':'dep'}">
              <span class="ledger-sign" title="${e.sign>0?'Recette':'Dépense'}">${e.sign>0?'↗':'↘'}</span>
              <span class="ledger-lib" ${editAttr.replace('$FIELD$', 'libelle')}>${_esc(e.libelle || (canEdit?'Sans libellé':''))}</span>
              <span class="ledger-date" ${editAttr.replace('$FIELD$', 'date')}>${_esc(e.date || '—')}</span>
              <span class="ledger-amount-wrap">
                <span class="ledger-sgn">${e.sign>0?'+':'−'}</span><span class="ledger-amount" ${canEdit
                  ? `contenteditable="true" spellcheck="false"
                      data-blur="csV3LedgerSaveAmount" data-kind="${e.kind}" data-idx="${e.idx}" data-sign="${e.sign}"
                      onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}else if(event.key==='Escape'){this.textContent=this.dataset.original||'';this.blur();}"
                      onfocus="this.dataset.original=this.textContent"`
                  : ''}>${fmt(Math.abs(parseFloat(e.montant)||0))}</span><small class="ledger-or-suffix">or</small>
              </span>
              ${canEdit?`<button class="ledger-del" title="Supprimer" data-action="csV3DeleteLedger" data-id="${c.id}" data-kind="${e.kind}" data-idx="${e.idx}">🗑</button>`:'<span></span>'}
            </li>`;
          }).join('')}
        `).join('')}
      </ol>
    </div>
    ${hasMore ? `<button class="ledger-more" data-action="csV3LedgerMore" data-id="${c.id}">↓ Charger ${Math.min(25, filtered.length - visible.length)} de plus (${filtered.length - visible.length} restantes)</button>` : ''}
    `}
  </div>`;
}

// Helper : récupère la référence FRAÎCHE du char depuis STATE (jamais une copie stale)
function _csV3GetFreshChar(charId) {
  return STATE.characters.find(x => x.id === charId)
      || (charSession.getCurrentChar()?.id === charId ? charSession.getCurrentChar() : null)
      || STATE.activeChar;
}
function _csV3SyncCharRefs(c) {
  if (!c) return;
  if (STATE.activeChar?.id === c.id) STATE.activeChar = c;
  if (charSession.getCurrentChar()?.id === c.id) charSession.set(c, charSession.getCanEditChar(), charSession.getCurrentCharTab());
}
// Met à jour le solde de la bourse partout (sans tout re-render)
function _csV3RefreshBourse(c) {
  const value = String(calcOr(c));
  // 1) Tous les spans dédiés (hero badge + side card si markup à jour)
  document.querySelectorAll('.cs-or-amount, .or-card-amount').forEach(el => { el.textContent = value; });
  // 2) Fallback robuste : tout .or-card-val (peu importe le markup interne),
  //    on reconstruit "VAL or" en préservant le <small> existant.
  document.querySelectorAll('.or-card-val').forEach(el => {
    // Si on a déjà un span .or-card-amount à l'intérieur, il est déjà à jour.
    if (el.querySelector('.or-card-amount')) return;
    const small = el.querySelector('small');
    const smallHtml = small ? small.outerHTML : '<small style="font-size:.65rem;color:var(--text-dim)">or</small>';
    el.innerHTML = `<span class="or-card-amount">${value}</span> ${smallHtml}`;
  });
  // 3) Helper legacy (anciennes sidebars éventuelles)
  try { charSession.refresh(c); } catch {}
}
// Date du jour au format ISO court YYYY-MM-DD (compatible artisan + tri propre)
function _csV3TodayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
// Sauvegarde inline d'un champ texte (date / libelle) d'une écriture
async function _csV3LedgerSaveField(el, kind, idx, field) {
  const charId = charSession.getCurrentChar()?.id; if (!charId) return;
  const c = _csV3GetFreshChar(charId); if (!c) return;
  c.compte = c.compte || { recettes: [], depenses: [] };
  const row = (c.compte[kind] || [])[idx]; if (!row) return;
  const newVal = (el.textContent || '').trim();
  if ((row[field] || '') === newVal) return;
  row[field] = newVal;
  _csV3SyncCharRefs(c);
  try {
    await updateInCol('characters', c.id, { compte: c.compte });
    // Si on a modifié la date, re-render pour refléter le nouveau tri/groupement
    if (field === 'date' && charSession.getCurrentCharTab() === 'compte') {
      _renderTabV3('compte', c, charSession.getCanEditChar());
    }
  } catch (e) {
    console.warn('[ledger field save]', e);
    el.textContent = el.dataset.original || '';
  }
}
// Sauvegarde inline du montant (gère le signe + ou −)
async function _csV3LedgerSaveAmount(el, kind, idx, sign) {
  const charId = charSession.getCurrentChar()?.id; if (!charId) return;
  const c = _csV3GetFreshChar(charId); if (!c) return;
  c.compte = c.compte || { recettes: [], depenses: [] };
  const row = (c.compte[kind] || [])[idx]; if (!row) return;
  const txt = (el.textContent || '').replace(/[^\d.,\-]/g, '').replace(',', '.');
  const newVal = Math.abs(parseFloat(txt) || 0);
  if ((parseFloat(row.montant) || 0) === newVal) return;
  row.montant = newVal;
  _csV3SyncCharRefs(c);
  try {
    await updateInCol('characters', c.id, { compte: c.compte });
    _csV3RefreshBourse(c);
    // Re-render systématique pour actualiser les totaux/solde
    if (charSession.getCurrentCharTab() === 'compte') _renderTabV3('compte', c, charSession.getCanEditChar());
  } catch (e) {
    console.warn('[ledger amount save]', e);
    el.textContent = el.dataset.original || '';
  }
}

function _csV3LedgerSetAddKind(kind, charId) {
  _csV3LedgerAddKind = (kind === 'depenses') ? 'depenses' : 'recettes';
  // Préserve les valeurs déjà saisies avant le re-render
  const prevDate = document.getElementById('ledger-date')?.value || '';
  const prevLib  = document.getElementById('ledger-lib')?.value  || '';
  const prevAmt  = document.getElementById('ledger-amount')?.value || '';
  if (charId && charSession.getCurrentCharTab() === 'compte') {
    const c = _csV3GetFreshChar(charId);
    if (c) _renderTabV3('compte', c, charSession.getCanEditChar());
  }
  // Restaure les valeurs sur les nouveaux inputs
  requestAnimationFrame(() => {
    const dEl = document.getElementById('ledger-date');
    const lEl = document.getElementById('ledger-lib');
    const aEl = document.getElementById('ledger-amount');
    if (dEl && prevDate) dEl.value = prevDate;
    if (lEl) lEl.value = prevLib;
    if (aEl) aEl.value = prevAmt;
    lEl?.focus();
  });
}

// Suppression d'une ligne (re-fetch + re-render explicite, SANS confirmation)
async function _csV3DeleteLedger(charId, kind, idx) {
  const c = _csV3GetFreshChar(charId); if (!c) return;
  c.compte = c.compte || { recettes: [], depenses: [] };
  if (!(c.compte[kind] || [])[idx]) return;
  c.compte[kind].splice(idx, 1);
  _csV3SyncCharRefs(c);
  try {
    await updateInCol('characters', c.id, { compte: c.compte });
    _csV3RefreshBourse(c);
  } catch (e) { console.warn('[ledger del]', e); }
  if (charSession.getCurrentCharTab() === 'compte') _renderTabV3('compte', c, charSession.getCanEditChar());
}

function _csV3LedgerSetKind(charId, kind) {
  _csV3LedgerFilter = { ..._csV3LedgerFilter, kind, limit: 25 };
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar;
  if (c && charSession.getCurrentCharTab() === 'compte') _renderTabV3('compte', c, charSession.getCanEditChar());
}
function _csV3LedgerSetSearch(charId, search) {
  _csV3LedgerFilter = { ..._csV3LedgerFilter, search, limit: 25 };
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar;
  if (!c) return;
  // Re-render mais on restaure le focus + caret dans la search box
  const caret = document.querySelector('.ledger-search')?.selectionStart;
  if (charSession.getCurrentCharTab() === 'compte') _renderTabV3('compte', c, charSession.getCanEditChar());
  requestAnimationFrame(() => {
    const inp = document.querySelector('.ledger-search');
    if (inp) { inp.focus(); try { inp.setSelectionRange(caret, caret); } catch {} }
  });
}
function _csV3LedgerMore(charId) {
  _csV3LedgerFilter = { ..._csV3LedgerFilter, limit: (_csV3LedgerFilter.limit || 25) + 25 };
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar;
  if (c && charSession.getCurrentCharTab() === 'compte') _renderTabV3('compte', c, charSession.getCanEditChar());
}

// Ajoute une écriture au compte via le schéma existant `c.compte.{recettes,depenses}`.
async function _csV3AddLedger(charId) {
  const dateEl = document.getElementById('ledger-date');
  const libEl  = document.getElementById('ledger-lib');
  const amtEl  = document.getElementById('ledger-amount');
  if (!libEl || !amtEl) return;
  const kind = _csV3LedgerAddKind === 'depenses' ? 'depenses' : 'recettes';
  const date = (dateEl?.value || '').trim() || _csV3TodayISO();
  const lib  = (libEl.value || '').trim();
  const amt  = Math.abs(parseFloat((amtEl.value || '').replace(',', '.')) || 0);
  if (!lib) { showNotif('Libellé requis.', 'error'); libEl.focus(); return; }
  if (!amt) { showNotif('Montant requis.', 'error'); amtEl.focus(); return; }
  const c = _csV3GetFreshChar(charId);
  if (!c) return;
  c.compte = c.compte || { recettes: [], depenses: [] };
  c.compte[kind] = c.compte[kind] || [];
  c.compte[kind].push({ date, libelle: lib, montant: amt });
  _csV3SyncCharRefs(c);
  try { await updateInCol('characters', charId, { compte: c.compte }); }
  catch (e) { showNotif('Erreur de sauvegarde.', 'error'); return; }
  _csV3RefreshBourse(c);
  // Re-render complet → totaux + tri + nouvelle ligne visibles
  if (charSession.getCurrentCharTab() === 'compte') _renderTabV3('compte', c, charSession.getCanEditChar());
  // Focus l'input libellé pour la saisie en chaîne
  requestAnimationFrame(() => { document.getElementById('ledger-lib')?.focus(); });
}

// ── Journal → sub-tabs Notes / Quêtes / Relations ────────────────────────────
function renderCharJournal(c, canEdit, sub = 'notes') {
  const subTab = ['notes','quetes','relations'].includes(sub) ? sub : 'notes';
  const counts = {
    notes:     (c.notesList || []).length,
    quetes:    (c.quetes || []).length,
    relations: (c.relations || []).length,
  };
  const bodyHtml = subTab === 'notes'     ? renderCharNotesV3(c, canEdit)
                : subTab === 'quetes'    ? renderJournalQuetes(c, canEdit)
                : renderCharRelations(c, canEdit);

  return `<div class="journal-tabs">
    <span class="journal-tab ${subTab==='notes'?'on':''}" data-action="csV3JournalSub" data-sub="notes">📝 Notes (${counts.notes})</span>
    <span class="journal-tab ${subTab==='quetes'?'on':''}" data-action="csV3JournalSub" data-sub="quetes">📜 Quêtes (${counts.quetes})</span>
    <span class="journal-tab ${subTab==='relations'?'on':''}" data-action="csV3JournalSub" data-sub="relations">👥 Relations (${counts.relations})</span>
    ${canEdit && subTab==='notes' ? `<button class="section-action" style="margin-left:auto" data-action="addNote">＋ Note</button>` : ''}
    ${canEdit && subTab==='quetes' ? `<button class="section-action" style="margin-left:auto" data-action="addQuete">＋ Quête</button>` : ''}
    ${canEdit && subTab==='relations' ? `<button class="section-action" style="margin-left:auto" data-action="csV3AddRelation" data-id="${c.id}">＋ Relation</button>` : ''}
  </div>
  <div id="journal-body">${bodyHtml}</div>`;
}

function _csV3JournalSub(sub) {
  _currentJournalSub = sub;
  const c = charSession.getCurrentChar(); const canEdit = charSession.getCanEditChar();
  if (!c) return;
  // Rebuild juste l'onglet Journal sans recharger toute la fiche
  const area = document.getElementById('char-tab-content');
  if (area) {
    area.innerHTML = renderCharJournal(c, canEdit, sub);
    if (sub === 'notes') { bindRichTextEditors(area); _bindNotesDnd(c, canEdit); }
    if (sub === 'quetes') _bindQuetesDnd(c, canEdit);
  }
}

// Quêtes — schéma réel : { nom, type, description, valide }
function renderJournalQuetes(c, canEdit) {
  const quetes = c.quetes || [];
  if (!quetes.length) {
    return `<div class="q-empty">Aucune quête. ${canEdit?'Clique sur "＋ Quête" pour en ajouter.':''}</div>`;
  }
  const enCours  = quetes.filter(q => !q.valide);
  const validees = quetes.filter(q => q.valide);
  const card = (q) => {
    const idx = quetes.indexOf(q);
    const validee = !!q.valide;
    const typeLbl = q.type ? `<span class="quest-type">${_esc(q.type)}</span>` : '';
    return `<article class="quest ${validee?'done':''}${canEdit?' is-draggable':''}" data-quest-idx="${idx}">
      <header class="quest-head">
        <div class="quest-name-wrap">
          ${validee
            ? `<span class="quest-state-ico" title="Validée">✓</span>`
            : `<span class="quest-state-ico open" title="En cours">⚔</span>`}
          <h4 class="quest-name">${_esc(q.nom || 'Quête sans nom')}</h4>
          ${typeLbl}
        </div>
        ${canEdit ? `<div class="quest-actions">
          <button class="btn-icon" data-action="toggleQuete" data-idx="${idx}" title="${validee?'Rouvrir':'Marquer comme validée'}">${validee?'↺':'✔️'}</button>
          <button class="btn-icon" data-action="deleteQuete" data-idx="${idx}" title="Supprimer" style="color:#ff8ca7">🗑️</button>
        </div>` : ''}
      </header>
      ${q.description ? `<p class="quest-desc">${_esc(q.description)}</p>` : ''}
    </article>`;
  };
  return `
    <section class="quest-block">
      <div class="quest-section-head">
        <span class="q-lbl">En cours</span>
        <span class="q-count">${enCours.length}</span>
      </div>
      <div class="quest-list" data-quest-list="open">
        ${enCours.length ? enCours.map(card).join('') : '<div class="q-empty">Aucune quête en cours.</div>'}
      </div>
    </section>
    <section class="quest-block" style="margin-top:18px">
      <div class="quest-section-head">
        <span class="q-lbl done">Validées</span>
        <span class="q-count">${validees.length}</span>
      </div>
      <div class="quest-list" data-quest-list="done">
        ${validees.length ? validees.map(card).join('') : '<div class="q-empty">Aucune quête validée.</div>'}
      </div>
    </section>`;
}

// ── Drag & drop des quêtes (SortableJS) ───────────────────────────────────────
// Deux listes (En cours / Validées) partagent le même `group` → on réordonne ET
// on bascule l'état validé en glissant une quête d'une liste à l'autre.
let _questsSortables = [];
function _bindQuetesDnd(c, canEdit) {
  _questsSortables.forEach(s => { try { s.destroy(); } catch {} });
  _questsSortables = [];
  if (!canEdit) return;
  const area = document.getElementById('char-tab-content'); if (!area) return;
  area.querySelectorAll('.quest-list').forEach(list => {
    _questsSortables.push(new Sortable(list, {
      group: 'cs-quetes',
      animation: 160,
      draggable: '.quest',
      filter: '.btn-icon, .q-empty',
      preventOnFilter: false,
      ghostClass: 'cs-quete-ghost',
      chosenClass: 'cs-quete-chosen',
      onEnd: () => _onQuetesReordered(c),
    }));
  });
}
async function _onQuetesReordered(c) {
  const area = document.getElementById('char-tab-content'); if (!area) return;
  const old = Array.isArray(c.quetes) ? c.quetes : [];
  const next = [];
  // Première liste = « En cours » (valide=false), seconde = « Validées » (valide=true).
  area.querySelectorAll('.quest-list').forEach(list => {
    const valide = list.dataset.questList === 'done';
    list.querySelectorAll('.quest[data-quest-idx]').forEach(el => {
      const q = old[parseInt(el.dataset.questIdx)];
      if (q) next.push({ ...q, valide });
    });
  });
  // Garde-fou : si on n'a pas retrouvé toutes les quêtes, on annule (re-render).
  if (next.length !== old.length) { _csV3JournalSub('quetes'); return; }
  c.quetes = next;
  try { await updateInCol('characters', c.id, { quetes: next }); }
  catch (e) { console.error('[quetes reorder]', e); window.showNotif?.('Erreur d\'enregistrement.', 'error'); }
  _csV3JournalSub('quetes');
}

// Relations — liste éditable
// Notes V3 — édition inline du titre + cards repliables + rich-text body
function renderCharNotesV3(c, canEdit) {
  const notes = c.notesList || [];
  if (!notes.length) {
    return `<div class="q-empty">Aucune note. ${canEdit?'Clique sur "＋ Note" en haut pour en créer une.':''}</div>`;
  }
  return `<div class="notes-stack">${notes.map((n, i) => {
    const isOpen = _openNote === i;
    const titre = n.titre || 'Note sans titre';
    const date  = n.date  || '';
    return `<article class="note-v3 ${isOpen?'is-open':''}${canEdit?' is-draggable':''}" data-note-idx="${i}">
      <header class="note-v3-head">
        ${canEdit ? `<span class="note-v3-drag" title="Glisser pour réordonner">⠿</span>` : ''}
        <button class="note-v3-toggle" data-action="csV3ToggleNote" data-idx="${i}" title="${isOpen?'Replier':'Déplier'}">
          ${isOpen ? '▾' : '▸'}
        </button>
        ${canEdit
          ? `<input class="note-v3-titre" type="text" value="${_esc(titre)}"
              data-blur="csV3SaveNoteTitle" data-idx="${i}"
              onkeydown="if(event.key==='Enter'){this.blur();}else if(event.key==='Escape'){this.value=this.defaultValue;this.blur();}"
              placeholder="Titre de la note">`
          : `<span class="note-v3-titre note-v3-titre-ro">${_esc(titre)}</span>`}
        ${date ? `<span class="note-v3-date">${_esc(date)}</span>` : ''}
        ${canEdit ? `<button class="note-v3-del" data-action="deleteNote" data-idx="${i}" data-stop-propagation title="Supprimer">🗑️</button>` : ''}
      </header>
      ${isOpen ? `<div class="note-v3-body">
        ${canEdit
          ? `${richTextEditorHtml({ id: `note-area-${i}`, html: n.contenu || '', placeholder: 'Contenu de la note…', minHeight: 180 })}
             <div style="display:flex;gap:8px;margin-top:8px">
               <button class="btn btn-gold btn-sm" data-action="saveNote" data-idx="${i}">💾 Enregistrer</button>
             </div>`
          : richTextContentHtml({ html: n.contenu, className: 'note-v3-content', fallback: '<em style="opacity:.5">Aucun contenu.</em>' })}
      </div>` : ''}
    </article>`;
  }).join('')}</div>`;
}

// ── Drag & drop des notes (SortableJS) ────────────────────────────────────────
// Poignée ⠿ dans l'en-tête (n'interfère pas avec l'édition du titre/contenu).
let _notesSortable = null;
function _bindNotesDnd(c, canEdit) {
  try { _notesSortable?.destroy(); } catch {}
  _notesSortable = null;
  if (!canEdit) return;
  const area = document.getElementById('char-tab-content'); if (!area) return;
  const stack = area.querySelector('.notes-stack'); if (!stack) return;
  _notesSortable = new Sortable(stack, {
    handle: '.note-v3-drag',
    draggable: '.note-v3',
    animation: 160,
    ghostClass: 'cs-note-ghost',
    chosenClass: 'cs-note-chosen',
    onEnd: () => _onNotesReordered(c),
  });
}
async function _onNotesReordered(c) {
  const area = document.getElementById('char-tab-content'); if (!area) return;
  const stack = area.querySelector('.notes-stack'); if (!stack) return;
  const old = Array.isArray(c.notesList) ? c.notesList : [];
  const next = [];
  stack.querySelectorAll('.note-v3[data-note-idx]').forEach(el => {
    const n = old[parseInt(el.dataset.noteIdx)];
    if (n) next.push(n);
  });
  if (next.length !== old.length) { _currentJournalSub = 'notes'; _renderTabV3('journal', c, charSession.getCanEditChar()); return; }
  c.notesList = next;
  _openNote = null; // les index ont changé → on replie tout
  try { await updateInCol('characters', c.id, { notesList: next }); }
  catch (e) { console.error('[notes reorder]', e); window.showNotif?.('Erreur d\'enregistrement.', 'error'); }
  _currentJournalSub = 'notes';
  _renderTabV3('journal', c, charSession.getCanEditChar());
}

function _csV3ToggleNote(idx) {
  _openNote = _openNote === idx ? null : idx;
  const c = charSession.getCurrentChar(); if (!c) return;
  // Re-render journal en gardant le sub-tab notes
  _currentJournalSub = 'notes';
  _renderTabV3('journal', c, charSession.getCanEditChar());
}
async function _csV3SaveNoteTitle(idx, value) {
  const c = STATE.activeChar; if (!c) return;
  const note = (c.notesList || [])[idx]; if (!note) return;
  const trimmed = (value || '').trim() || 'Note sans titre';
  if (note.titre === trimmed) return;
  note.titre = trimmed;
  c.notesList[idx] = note;
  try { await updateInCol('characters', c.id, { notesList: c.notesList }); }
  catch (e) { console.warn('[note title]', e); }
}

const _RELATION_PALETTE = {
  lien:     ['rgba(157,111,255,.14)','rgba(157,111,255,.4)','#c8aaff'],
  allie:    ['rgba(34,195,142,.14)','rgba(34,195,142,.4)','#5dd5a8'],
  neutre:   ['rgba(244,196,48,.14)','rgba(244,196,48,.4)','#f4c430'],
  ennemi:   ['rgba(255,90,126,.14)','rgba(255,90,126,.4)','#ff8ca7'],
  mefiance: ['rgba(255,149,68,.14)','rgba(255,149,68,.4)','#ffb070'],
};
function renderCharRelations(c, canEdit) {
  const rels = c.relations || [];
  if (!rels.length) {
    return `<div class="q-empty">
      👥 Aucune relation enregistrée.${canEdit?` Clique sur « ＋ Relation » pour noter les alliés, ennemis et PNJ croisés par ${_esc(c.nom||'ce personnage')} — avec leur sentiment et une note.`:''}
    </div>`;
  }
  return `<div class="rel-grid">
    ${rels.map((r, i) => {
      const sent = _RELATION_PALETTE[r.sent] || _RELATION_PALETTE.neutre;
      const ini = (r.ini || r.nom || '?')[0]?.toUpperCase() || '?';
      return `<div class="rel-card" style="--rel-c:${sent[2]};--rel-bg:${sent[0]};--rel-bd:${sent[1]}">
        <div class="rel-avatar">${_esc(ini)}</div>
        <div class="rel-body">
          <div class="rel-name-row">
            <span class="rel-name">${_esc(r.nom || 'Sans nom')}</span>
            <span class="rel-sentiment">${_esc(r.sentiment || r.sent || 'neutre')}</span>
          </div>
          ${r.role ? `<span class="rel-role">${_esc(r.role)}</span>` : ''}
          ${r.note ? `<div class="rel-note">${_esc(r.note)}</div>` : ''}
          ${canEdit ? `<div style="display:flex;gap:6px;margin-top:6px;justify-content:flex-end">
            <button class="ledger-del" style="opacity:.6" data-action="csV3EditRelation" data-id="${c.id}" data-idx="${i}" title="Modifier">✎</button>
            <button class="ledger-del" style="opacity:.6" data-action="csV3DeleteRelation" data-id="${c.id}" data-idx="${i}" title="Supprimer">🗑️</button>
          </div>` : ''}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

const _REL_SENTS = [
  { k:'lien',     lbl:'💜 Lien' },
  { k:'allie',    lbl:'💚 Allié' },
  { k:'neutre',   lbl:'💛 Neutre' },
  { k:'mefiance', lbl:'🧡 Méfiance' },
  { k:'ennemi',   lbl:'❤️ Ennemi' },
];
const _REL_DEFAULT_LBL = { lien:'Lien', allie:'Allié', neutre:'Neutre', mefiance:'Méfiance', ennemi:'Ennemi' };

function _openRelationModal(charId, idx) {
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar; if (!c) return;
  const isEdit = Number.isInteger(idx) && idx >= 0;
  const r = isEdit ? (c.relations || [])[idx] : null;
  if (isEdit && !r) return;
  const curSent = r?.sent || 'neutre';
  openModal('', `
    <div class="rel-modal">
      <div class="rel-modal-head">
        <div class="rel-modal-ico">👥</div>
        <div class="rel-modal-head-txt">
          <h2>${isEdit ? 'Modifier la relation' : 'Nouvelle relation'}</h2>
          <small>Allié, ennemi ou PNJ croisé par <b>${_esc(c.nom||'ce personnage')}</b>, et le lien qui les unit.</small>
        </div>
      </div>
      <div class="rel-modal-body">
        <div class="form-group"><label>Nom</label>
          <input class="input-field" id="rel-nom" value="${_esc(r?.nom||'')}" placeholder="Maître Aldric, Capitaine Vex…" autocomplete="off"></div>
        <div class="form-group"><label>Rôle / lien <span class="rel-opt">(optionnel)</span></label>
          <input class="input-field" id="rel-role" value="${_esc(r?.role||'')}" placeholder="Mentor, Frère, Marchand, Rival…" autocomplete="off"></div>
        <div class="form-group"><label>Sentiment</label>
          <div class="rel-sent-seg">
            ${_REL_SENTS.map(s => `<button type="button" class="rel-sent-btn rel-sent-btn--${s.k} ${s.k===curSent?'is-active':''}" data-sent="${s.k}" data-action="csV3RelSent">${s.lbl}</button>`).join('')}
          </div>
          <input type="hidden" id="rel-sent" value="${curSent}">
          <input type="text" class="input-field" id="rel-sentiment" value="${_esc(r?.sentiment||'')}" placeholder="Libellé affiché (ex : Ami fidèle, Pacte, Dette…)" style="margin-top:.4rem" autocomplete="off"></div>
        <div class="form-group"><label>Note <span class="rel-opt">(optionnel)</span></label>
          <textarea class="input-field" id="rel-note" rows="3" placeholder="Histoire, dette, secret, dernière rencontre…">${_esc(r?.note||'')}</textarea></div>
      </div>
      <div class="rel-modal-foot">
        <button class="btn btn-outline btn-sm" data-action="closeRelModal">Annuler</button>
        <div style="flex:1"></div>
        <button class="btn btn-gold" data-action="csV3SaveRelation" data-id="${charId}" data-idx="${isEdit?idx:-1}">💾 Enregistrer</button>
      </div>
    </div>
  `);
  setTimeout(() => document.getElementById('rel-nom')?.focus(), 30);
}

function _csV3AddRelation(charId)       { _openRelationModal(charId, -1); }
function _csV3EditRelation(charId, idx) { _openRelationModal(charId, idx); }

function _csV3RelSent(sent) {
  const inp = document.getElementById('rel-sent'); if (inp) inp.value = sent;
  document.querySelectorAll('.rel-sent-btn').forEach(b => b.classList.toggle('is-active', b.dataset.sent === sent));
  const lbl = document.getElementById('rel-sentiment');
  if (lbl && !lbl.value.trim()) lbl.value = _REL_DEFAULT_LBL[sent] || sent;
}

async function _csV3SaveRelation(charId, idx) {
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar; if (!c) return;
  const nom = document.getElementById('rel-nom')?.value.trim();
  if (!nom) { showNotif('Indique au moins un nom.', 'error'); return; }
  const sent = document.getElementById('rel-sent')?.value || 'neutre';
  const rel = {
    nom,
    role:      document.getElementById('rel-role')?.value.trim() || '',
    sent,
    sentiment: document.getElementById('rel-sentiment')?.value.trim() || (_REL_DEFAULT_LBL[sent] || sent),
    note:      document.getElementById('rel-note')?.value.trim() || '',
  };
  const rels = Array.isArray(c.relations) ? c.relations.slice() : [];
  if (Number.isInteger(idx) && idx >= 0 && rels[idx]) rels[idx] = { ...rels[idx], ...rel };
  else rels.push(rel);
  c.relations = rels;
  try {
    await updateInCol('characters', charId, { relations: rels });
    closeModalDirect();
    _csV3JournalSub('relations');
  } catch (e) { console.error('[relation save]', e); showNotif('Erreur d\'enregistrement.', 'error'); }
}

async function _csV3DeleteRelation(charId, idx) {
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar;
  if (!c?.relations?.[idx]) return;
  const nom = c.relations[idx].nom || '?';
  if (!await confirmModal(`Supprimer la relation <b>${_esc(nom)}</b> ?`, { title:'Confirmation', confirmLabel:'Supprimer', icon:'🗑️' })) return;
  const rels = c.relations.slice(); rels.splice(idx, 1); c.relations = rels;
  await updateInCol('characters', charId, { relations: rels });
  _csV3JournalSub('relations');
}

// ══════════════════════════════════════════════════════════════════════════════
// V3 — PROFIL (lecture éditoriale + radar + identité + visibilité)
// ══════════════════════════════════════════════════════════════════════════════
const _TAG_PALETTE = [
  ['rgba(79,140,255,.14)','rgba(79,140,255,.35)','#7fb0ff'],
  ['rgba(34,195,142,.14)','rgba(34,195,142,.35)','#22c38e'],
  ['rgba(232,184,75,.14)','rgba(232,184,75,.35)','#e8b84b'],
  ['rgba(180,127,255,.14)','rgba(180,127,255,.35)','#b47fff'],
  ['rgba(255,107,107,.14)','rgba(255,107,107,.35)','#ff8080'],
];
function _v3TagColor(text) {
  let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) & 0xffff;
  return _TAG_PALETTE[h % _TAG_PALETTE.length];
}

function _renderRadarV3(c) {
  const STATS_K = [
    { k: 'FOR', v: c.stats?.force        || 8 },
    { k: 'DEX', v: c.stats?.dexterite    || 8 },
    { k: 'INT', v: c.stats?.intelligence || 8 },
    { k: 'CON', v: c.stats?.constitution || 8 },
    { k: 'SAG', v: c.stats?.sagesse      || 8 },
    { k: 'CHA', v: c.stats?.charisme     || 8 },
  ];
  const cx = 120, cy = 120, R = 80, n = STATS_K.length;
  const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI / n);
  const point = (i, v) => {
    const r = (Math.max(0, Math.min(20, v)) / 20) * R;
    const a = angle(i);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const rings = [1, .75, .5, .25].map(k => {
    const pts = STATS_K.map((_, i) => {
      const a = angle(i);
      return [cx + Math.cos(a) * R * k, cy + Math.sin(a) * R * k];
    });
    return `<polygon class="radar-grid" points="${pts.map(p => p.join(',')).join(' ')}"/>`;
  }).join('');
  const axes = STATS_K.map((_, i) => {
    const a = angle(i);
    return `<line class="radar-axis" x1="${cx}" y1="${cy}" x2="${cx + Math.cos(a) * R}" y2="${cy + Math.sin(a) * R}"/>`;
  }).join('');
  const poly = STATS_K.map((s, i) => point(i, s.v).join(',')).join(' ');
  const pts = STATS_K.map((s, i) => {
    const [x, y] = point(i, s.v);
    return `<circle class="radar-pt" cx="${x}" cy="${y}" r="2.5"/>`;
  }).join('');
  const lbls = STATS_K.map((s, i) => {
    const a = angle(i);
    const lx = cx + Math.cos(a) * (R + 14);
    const ly = cy + Math.sin(a) * (R + 14);
    return `<text class="radar-lbl" x="${lx}" y="${ly}" text-anchor="middle" dy="3">${s.k}</text>
            <text class="radar-val" x="${lx}" y="${ly + 10}" text-anchor="middle" dy="3">${s.v}</text>`;
  }).join('');
  return `<div class="radar-wrap"><svg class="radar-svg" viewBox="0 0 240 240">
    ${rings}${axes}<polygon class="radar-poly" points="${poly}"/>${pts}${lbls}
  </svg></div>`;
}

// La drop-cap est gérée 100% en CSS (.profil-text > p:first-of-type::first-letter)
// → rendu fidèle, on ne touche jamais à l'HTML du contenu.

// Champs d'identité par défaut (insérés si absents de c.identity)
const IDENTITY_DEFAULTS = ['Âge', 'Taille', 'Yeux', 'Cheveux', 'Origine', 'Idéal', 'Lien'];

// Normalise un tableau d'identité depuis le schéma legacy [[k,v]] OU le nouveau
// schéma [{k,v}]. Firestore n'accepte PAS les arrays d'arrays — on migre.
function _normalizeIdentity(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(x => {
    if (Array.isArray(x) && x[0]) return { k: String(x[0]), v: String(x[1] || '') };
    if (x && typeof x === 'object' && x.k) return { k: String(x.k), v: String(x.v || '') };
    return null;
  }).filter(Boolean);
}

function _mergeIdentityDefaults(arr) {
  // Renvoie [{k,v}] avec les 7 défauts toujours présents + les éventuels customs.
  const current = _normalizeIdentity(arr);
  const byKey = new Map(current.map(e => [e.k, e.v]));
  const out = [];
  IDENTITY_DEFAULTS.forEach(k => out.push({ k, v: byKey.get(k) || '' }));
  current.forEach(e => {
    if (!IDENTITY_DEFAULTS.includes(e.k)) out.push(e);
  });
  return out;
}

function renderCharProfilV3(c, canEdit) {
  // Bootstrap pres cache pour récupérer la bio rich-text
  if (!(c.id in _profilCache)) {
    try { renderCharProfil(c, canEdit); } catch {}
  }

  const quote = c.quote || '';
  const identity = _mergeIdentityDefaults(c.identity);
  const presCache = _profilCache?.[c.id] || null;
  const bioHtml = presCache?.content || c.bio || '';
  const tags = presCache?.tags || c.tags || [];

  const visEntries = [
    { k: 'afficherNiveau',    lbl: 'Niveau',           def: true  },
    { k: 'afficherPV',        lbl: 'PV',               def: true  },
    { k: 'afficherPM',        lbl: 'PM',               def: true  },
    { k: 'afficherCA',        lbl: "Classe d'armure",  def: true  },
    { k: 'afficherOr',        lbl: 'Or',               def: false },
    { k: 'afficherStats',     lbl: 'Statistiques',     def: true  },
    { k: 'afficherEquip',     lbl: 'Équipement',       def: true  },
    { k: 'afficherIdentite',  lbl: 'Identité',         def: true  },
    { k: 'afficherCitation',  lbl: 'Citation',         def: true  },
    { k: 'afficherBio',       lbl: 'Biographie',       def: true  },
    { k: 'afficherTags',      lbl: 'Traits perso.',    def: true  },
  ];

  const TAG_MAX_V3 = 8;
  const V3_TAG_SUGGESTIONS = [
    'Bienveillant','Vengeur','Courageux','Méfiant','Loyal','Obsessionnel',
    'Impulsif','Protecteur','Solitaire','Curieux','Ambitieux','Charismatique',
    'Prudent','Rusé','Empathique','Froid','Fervent','Téméraire',
  ];
  const tagsLow = tags.map(t => t.toLowerCase());
  const tagChips = tags.map(t => {
    const [bg, bd, col] = _v3TagColor(t);
    const removeBtn = canEdit
      ? `<button class="profil-tag-x" title="Retirer" data-action="csV3RemoveProfilTag" data-id="${c.id}" data-tag="${_esc(t)}">×</button>`
      : '';
    return `<span class="profil-tag" style="--tag-bg:${bg};--tag-bd:${bd};--tag-c:${col}">${_esc(t)}${removeBtn}</span>`;
  }).join('');

  const tagsFull = tags.length >= TAG_MAX_V3;
  const tagEditor = canEdit
    ? `<div class="profil-tags-editor">
        <div class="profil-tags-input-row">
          <input type="text" id="csv3-tag-input-${c.id}" class="profil-tag-input"
            placeholder="${tagsFull ? `Maximum ${TAG_MAX_V3} traits atteint` : 'Ajouter un trait personnalisé…'}"
            maxlength="24" ${tagsFull?'disabled':''}
            onkeydown="if(event.key==='Enter'){event.preventDefault();this.closest('.profil-tags-input-row')?.querySelector('[data-action=csV3AddProfilTagFromInput]')?.click();}else if(event.key==='Escape'){this.value='';this.blur();}">
          <button class="profil-tag-add-btn" ${tagsFull?'disabled':''}
            data-action="csV3AddProfilTagFromInput" data-id="${c.id}">Ajouter</button>
        </div>
        <div class="profil-tag-suggest-label">Suggestions :</div>
        <div class="profil-tag-suggest-row">
          ${V3_TAG_SUGGESTIONS.map(s => {
            const used = tagsLow.includes(s.toLowerCase());
            return `<button class="profil-tag-suggest ${used?'is-used':''}" ${used||tagsFull?'disabled':''}
              data-action="csV3AddProfilTag" data-id="${c.id}" data-tag="${_esc(s)}">${_esc(s)}</button>`;
          }).join('')}
        </div>
        <div class="profil-tag-counter">${tags.length} / ${TAG_MAX_V3} traits</div>
      </div>`
    : '';

  // Identité : 7 champs par défaut + éventuels custom. Valeur DIRECTEMENT éditable inline.
  const identityHtml = identity.map(({ k, v }) => {
    const isCustom = !IDENTITY_DEFAULTS.includes(k);
    const safeKey = k.replace(/'/g, "\\'");
    const valHtml = canEdit
      ? `<input type="text" class="profil-fact-input" value="${_esc(v)}" placeholder="—"
          data-id-key="${_esc(k)}"
          data-blur="csV3SaveIdentityValue" data-id="${c.id}" data-key="${safeKey}"
          onkeydown="if(event.key==='Enter'){this.blur();}else if(event.key==='Escape'){this.value=this.defaultValue;this.blur();}">`
      : `<span class="profil-fact-v">${v ? _esc(v) : '<span style="color:var(--text-dim)">—</span>'}</span>`;
    const keyClickable = isCustom && canEdit
      ? `data-action="csV3RenameIdentity" data-id="${c.id}" data-key="${safeKey}" style="cursor:pointer" title="Renommer / supprimer"`
      : '';
    return `<div class="profil-fact">
      <span class="profil-fact-k" ${keyClickable}>${_esc(k)}${isCustom && canEdit?' <small style="opacity:.5">✎</small>':''}</span>
      ${valHtml}
    </div>`;
  }).join('');

  // Bio : édition rich-text quand active, sinon rendu fidèle via richTextContentHtml
  const editingBio = _csV3EditingBio === c.id;
  const bioBlockHtml = editingBio && canEdit
    ? `<div class="profil-bio-edit">
        ${richTextEditorHtml({ id: 'profil-bio-rt', html: bioHtml, minHeight: 220, placeholder: 'Décris ton personnage…' })}
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn btn-gold btn-sm" data-action="csV3SaveBioRt" data-id="${c.id}">💾 Enregistrer</button>
          <button class="btn btn-outline btn-sm" data-action="csV3CancelBio" data-id="${c.id}">Annuler</button>
        </div>
      </div>`
    : `${bioHtml
        ? richTextContentHtml({ html: bioHtml, className: 'profil-text' })
        : `<div class="profil-text"><p style="color:var(--text-dim);font-style:italic">${canEdit?'Clique sur ✎ pour rédiger une bio.':'Aucune biographie publique.'}</p></div>`}
      ${canEdit ? `<button class="section-action" style="align-self:flex-start;margin-top:6px"
        data-action="csV3EnterBioEdit" data-id="${c.id}">✎ Modifier la bio</button>` : ''}`;

  return `
  ${canEdit
    ? `<input class="profil-quote profil-quote-edit ${!quote ? 'is-empty' : ''}" type="text"
        value="${_esc(quote)}"
        placeholder="Ajoute une citation pour ton personnage…"
        data-input="_csQuoteToggleEmpty"
        data-blur="csV3SaveQuote" data-id="${c.id}"
        onkeydown="if(event.key==='Enter'){this.blur();}else if(event.key==='Escape'){this.value=this.defaultValue;this.classList.toggle('is-empty',!this.value);this.blur();}">`
    : (quote
        ? `<div class="profil-quote">${_esc(quote)}</div>`
        : '')}
  <div class="profil-tags-block">
    ${canEdit ? `<div class="profil-tags-title">🎭 Traits de caractère</div>` : ''}
    <div class="profil-tags">${tagChips || (canEdit ? '<span class="profil-tags-empty">Aucun trait pour l\'instant</span>' : '')}</div>
    ${tagEditor}
  </div>

  <div class="profil-layout">
    <div class="profil-main">
      ${bioBlockHtml}
    </div>
    <div class="profil-side">
      <div class="profil-side-card">
        <h4>🎯 Profil de stats</h4>
        ${_renderRadarV3(c)}
      </div>
      <div class="profil-side-card">
        <h4>📜 Identité</h4>
        ${identityHtml}
        ${canEdit ? `<button class="section-action" style="margin-top:.6rem;width:100%" data-action="csV3AddFact" data-id="${c.id}">＋ Champ personnalisé</button>` : ''}
      </div>
      ${canEdit ? `
      <div class="profil-side-card">
        <h4>🖼️ Illustration page Joueurs</h4>
        <div class="profil-img-wrap">
          ${presCache?.imageUrl
            ? `<img class="profil-img" src="${_esc(presCache.imageUrl)}" alt="">`
            : `<div class="profil-img profil-img-empty">Aucune image</div>`}
        </div>
        <div class="profil-img-actions">
          <button class="section-action" style="flex:1" data-action="openProfilImageUpload" data-id="${c.id}">
            ${presCache?.imageUrl ? '🔄 Changer' : '📷 Upload image'}
          </button>
          ${presCache?.imageUrl ? `<button class="section-action" style="color:var(--crimson-light,#ff8ca7);border-color:rgba(255,90,126,.3)" data-action="removeProfilImage" data-id="${c.id}" title="Retirer">✕</button>` : ''}
        </div>
        <div class="profil-img-hint">L'image apparaît sur la page Joueurs comme illustration grand format du personnage.</div>
      </div>` : ''}
      ${canEdit ? `
      <div class="profil-side-card">
        <h4>👁️ Visible par les joueurs</h4>
        <div class="vis-toggles">
        ${visEntries.map(v => {
          const cur = presCache?.[v.k];
          const checked = cur === undefined ? v.def : !!cur;
          return `<label class="vis-toggle">
            <span class="vis-toggle-lbl">${_esc(v.lbl)}</span>
            <input type="checkbox" ${checked?'checked':''}
              data-change="_csV3SaveVisibility" data-id="${c.id}" data-key="${v.k}">
            <span class="vis-toggle-track"><span class="vis-toggle-thumb"></span></span>
          </label>`;
        }).join('')}
        </div>
      </div>` : ''}
    </div>
  </div>`;
}

// Handler édition citation — sauvegarde inline sans modal
async function _csV3SaveQuote(charId, value) {
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar; if (!c) return;
  const trimmed = (value || '').trim();
  if ((c.quote || '') === trimmed) return;
  c.quote = trimmed;
  try { await updateInCol('characters', charId, { quote: trimmed }); }
  catch (e) { console.warn('[quote save]', e); }
}
async function _csV3CommitTags(charId, nextTags) {
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar; if (!c) return;
  c.tags = nextTags;
  if (_profilCache?.[charId]) _profilCache[charId].tags = nextTags;
  try { await updateInCol('characters', charId, { tags: nextTags }); }
  catch (e) { console.warn('[tags save]', e); }
  if (charSession.getCurrentCharTab() === 'profil') _renderTabV3('profil', c, true);
}
async function _csV3AddProfilTag(charId, value) {
  const t = (value || '').trim(); if (!t) return;
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar; if (!c) return;
  const cur = (_profilCache?.[charId]?.tags || c.tags || []).slice();
  if (cur.length >= 8) return;
  if (cur.some(x => x.toLowerCase() === t.toLowerCase())) return;
  cur.push(t);
  await _csV3CommitTags(charId, cur);
}
async function _csV3AddProfilTagFromInput(charId) {
  const input = document.getElementById(`csv3-tag-input-${charId}`);
  if (!input) return;
  const val = input.value.trim();
  if (!val) { input.focus(); return; }
  await _csV3AddProfilTag(charId, val);
}
async function _csV3RemoveProfilTag(charId, value) {
  const t = (value || '').trim(); if (!t) return;
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar; if (!c) return;
  const cur = (_profilCache?.[charId]?.tags || c.tags || []).slice();
  const next = cur.filter(x => x.toLowerCase() !== t.toLowerCase());
  if (next.length === cur.length) return;
  await _csV3CommitTags(charId, next);
}
// Sauvegarde la VALEUR d'un champ identité (defaults ou custom) directement depuis l'input.
// Ne re-render PAS la fiche pour éviter de perdre le focus pendant la saisie.
async function _csV3SaveIdentityValue(charId, key, value) {
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar; if (!c) return;
  const merged = _mergeIdentityDefaults(c.identity);
  const trimmed = (value || '').trim();
  const old = (merged.find(e => e.k === key)?.v) || '';
  if (old === trimmed) return;
  // Schéma Firestore-friendly : array d'objets {k,v}. On ne stocke que les
  // defaults qui ont une valeur + tous les customs.
  const next = merged
    .map(e => e.k === key ? { k: e.k, v: trimmed } : e)
    .filter(e => IDENTITY_DEFAULTS.includes(e.k) ? !!e.v : true);
  c.identity = next;
  try { await updateInCol('characters', charId, { identity: next }); }
  catch (e) {
    console.warn('[identity save]', e);
    showNotif('Erreur de sauvegarde.', 'error');
  }
}
// Renomme / supprime un champ CUSTOM (les defaults ne sont pas renommables)
async function _csV3RenameIdentity(charId, key) {
  if (IDENTITY_DEFAULTS.includes(key)) return;
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar; if (!c) return;
  const newK = prompt(`Renommer "${key}" (laisser vide pour supprimer) :`, key);
  if (newK === null) return;
  const trimmed = newK.trim();
  let next = _normalizeIdentity(c.identity);
  if (!trimmed) {
    next = next.filter(e => e.k !== key);
  } else {
    next = next.map(e => e.k === key ? { k: trimmed, v: e.v } : e);
  }
  c.identity = next;
  try { await updateInCol('characters', charId, { identity: next }); }
  catch (e) { console.warn('[identity rename]', e); }
  if (charSession.getCurrentCharTab() === 'profil') _renderTabV3('profil', c, true);
}
// Ajoute un champ identité custom
async function _csV3AddFact(charId) {
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar; if (!c) return;
  const k = prompt('Nom du champ (ex: Bras-droit, Phobie…) :'); if (!k?.trim()) return;
  const v = prompt('Valeur :') || '';
  const next = _normalizeIdentity(c.identity);
  next.push({ k: k.trim(), v: v.trim() });
  c.identity = next;
  try { await updateInCol('characters', charId, { identity: next }); }
  catch (e) { console.warn('[identity add]', e); }
  if (charSession.getCurrentCharTab() === 'profil') _renderTabV3('profil', c, true);
}
// Édition bio avec l'éditeur rich-text — mode "édition" toggle
function _csV3EnterBioEdit(charId) {
  _csV3EditingBio = charId;
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar; if (!c) return;
  _renderTabV3('profil', c, true);
}
function _csV3CancelBio(charId) {
  _csV3EditingBio = null;
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar; if (!c) return;
  _renderTabV3('profil', c, true);
}
async function _csV3SaveBioRt(charId) {
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar; if (!c) return;
  const html = getRichTextHtml('profil-bio-rt') || '';
  // Sauvegarde : on écrit sur c.bio (string HTML) ET sur pres.content si présence
  c.bio = html;
  await updateInCol('characters', charId, { bio: html });
  const presCache = _profilCache?.[charId];
  if (presCache?.id) {
    try {
      await updateInCol('players', presCache.id, { content: html });
      presCache.content = html;
    } catch (e) { console.warn('[bio→pres sync]', e); }
  }
  _csV3EditingBio = null;
  _renderTabV3('profil', c, true);
}
async function _csV3SetCombatStyle(charId, styleId) {
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar; if (!c) return;
  // Toggle : reclic sur le style actif → on revient à la détection auto (null)
  const next = c.combatStyle === styleId ? null : styleId;
  c.combatStyle = next;
  await updateInCol('characters', charId, { combatStyle: next });
  if (charSession.getCurrentCharTab() === 'combat') _renderTabV3('combat', c, true);
}

async function _csV3SaveVisibility(charId, key, value) {
  // Sauvegarde directement sur le document pres (collection 'players'). Si pas en cache, on fallback char doc.
  const presCache = _profilCache?.[charId];
  if (presCache?.id) {
    try {
      await updateInCol('players', presCache.id, { [key]: value });
      presCache[key] = value;
    } catch (e) { console.error('[visibility]', e); }
  } else {
    // Fallback : stocker sur le char
    const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar;
    if (c) { c[key] = value; await updateInCol('characters', charId, { [key]: value }); }
  }
};

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
    const traits = item.nom ? (_getTraits?.(item) || []) : [];

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
      ${(item.portee || traits.length) ? `<div class="weap-meta">
        ${item.portee?`<span>↗ ${_esc(item.portee)}</span>`:''}
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
    // Bonus : stats + CA + caBonus + dérivés
    const badges = [];
    if (it.typeArmure) badges.push({ lbl: _esc(it.typeArmure), cls: 'green' });
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
    const traits = (_getTraits?.(it) || []);
    return `<div class="armor-card equipped">
      <div class="armor-slot">
        <span>${_esc(slot)}</span>
        ${canEdit?`<button class="weap-edit" data-action="editEquipSlot" data-slot="${slot}" title="Changer">✎</button>`:''}
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
  let setHtml = '';
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

    // Tableau slot-par-slot : Tête / Torse / Bottes avec leur type
    const slotsRow = slots.map(s => {
      const ico = TYPE_ICONS[s.type] || '·';
      const cls = !s.equipped ? 'empty' : (fullType && s.type === fullType ? 'match' : 'mismatch');
      const typeLbl = s.equipped ? (s.type || 'Sans type') : 'Vide';
      return `<div class="set-slot ${cls}">
        <span class="set-slot-name">${_esc(s.slot)}</span>
        <span class="set-slot-type"><span class="set-slot-ico">${ico}</span>${_esc(typeLbl)}</span>
      </div>`;
    }).join('');

    let headHtml, effectHtml, hintHtml = '';
    if (isActive) {
      const fx = EFFECT_BY_TYPE[fullType] || { tag: fullType, fx: setData.activeEffect?.chipText || '' };
      headHtml = `<span class="set-card-badge active">✨ Set ${_esc(fx.tag)} actif</span>
        <span class="set-card-title-name">${_esc(fullType)} · 3/3</span>`;
      effectHtml = `<div class="set-card-effect">
        <span class="set-card-fx-dot"></span>
        <div><b>Bonus actif :</b> ${_esc(fx.fx)}</div>
      </div>`;
    } else {
      // Diagnose pourquoi ce n'est pas actif
      const types = Object.keys(counts);
      headHtml = `<span class="set-card-badge">🌱 Set en cours</span>
        <span class="set-card-title-name">${equippedCount}/3 pièces équipées</span>`;
      let reason = '';
      if (equippedCount < 3) {
        reason = `Équipe les 3 emplacements (Tête, Torse, Bottes) du même type pour activer un bonus.`;
      } else if (types.length > 1) {
        const list = types.map(t => `${counts[t]}× ${t}`).join(', ');
        reason = `Types mélangés : ${list}. Il faut 3× le même type.`;
      } else {
        reason = `Continue à équiper les 3 pièces d'un même type.`;
      }
      hintHtml = `<div class="set-card-hint-block">${_esc(reason)}</div>`;
      // On liste tout de même les bonus disponibles selon le choix
      effectHtml = `<div class="set-card-rules">
        <div class="set-card-rules-title">Bonus possibles selon le type :</div>
        <ul>
          <li><span class="set-card-fx-dot light"></span><b>Léger</b> : Coût des sorts −2 PM</li>
          <li><span class="set-card-fx-dot medium"></span><b>Intermédiaire</b> : Toucher +2</li>
          <li><span class="set-card-fx-dot heavy"></span><b>Lourd</b> : Réduction de 2 dégâts</li>
        </ul>
      </div>`;
    }

    setHtml = `<div class="set-card ${isActive?'is-active':'is-progress'}" data-set-type="${_esc(fullType)}">
      <div class="set-card-head">${headHtml}</div>
      <div class="set-slots-row">${slotsRow}</div>
      ${effectHtml}
      ${hintHtml}
    </div>`;
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
  let styleHtml = '';
  let detected = null;
  try { detected = detectCombatStyle?.(c, _combatTabCache.styles || []); } catch (e) { console.warn('[style detect]', e); }
  if (!_combatTabCache.styles) {
    styleHtml = `<div class="cstyle" style="--style-c:var(--text-dim)">
      <span class="cstyle-ico">🧙</span>
      <div class="cstyle-body">
        <div class="cstyle-tag">Style de combat</div>
        <div class="cstyle-name" style="color:var(--text-dim);font-style:italic">Chargement…</div>
      </div>
    </div>`;
  } else if (detected) {
    const col = detected.couleur || detected.color || '#9d6fff';
    styleHtml = `<div class="cstyle" style="--style-c:${col}">
      <span class="cstyle-ico">${_esc(detected.icon || detected.icone || '🧙')}</span>
      <div class="cstyle-body">
        <div class="cstyle-tag">
          Style de combat
          ${STATE.isAdmin ? `<button class="section-action" style="float:right;font-size:.62rem;padding:2px 8px" data-action="openCombatStylesAdmin" title="Gérer les styles (admin)">⚙️</button>` : ''}
        </div>
        <div class="cstyle-name" style="color:${col}">${_esc(detected.label || detected.name || 'Sans nom')}</div>
        <div class="cstyle-desc">${_esc(detected.description || '')}</div>
        <div class="cstyle-detect">Détecté depuis les armes équipées</div>
      </div>
    </div>`;
  } else {
    styleHtml = `<div class="cstyle" style="--style-c:var(--text-dim)">
      <span class="cstyle-ico">🧙</span>
      <div class="cstyle-body">
        <div class="cstyle-tag">Style de combat</div>
        <div class="cstyle-name" style="color:var(--text-dim);font-style:italic">Aucun style détecté</div>
        <div class="cstyle-desc">Équipe une arme pour révéler ton style.</div>
      </div>
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
      <div style="font-size:.74rem;color:var(--text-dim);font-style:italic">Chargement…</div>
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
  </div>

  <div class="section">
    <div class="section-head">
      <div class="section-title"><span class="ico">🪖</span> Armures & Accessoires</div>
    </div>
    ${armorRows}
    ${setHtml}
  </div>

  <div class="section">
    <div class="section-head">
      <div class="section-title"><span class="ico">🧙</span> Style & Éléments</div>
    </div>
    <div class="combat-footer">
      ${styleHtml || '<div class="q-empty">Aucun style détecté.</div>'}
      ${elemsHtml}
    </div>
  </div>

  <div class="section">
    <div class="section-head">
      <div class="section-title"><span class="ico">🎯</span> Maîtrises d'armes</div>
      ${canEdit?`<button class="section-action" data-action="addMaitrise">＋ Ajouter</button>`:''}
    </div>
    ${maitsHtml}
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

const _INV_FILTERS = [
  { id: 'all',  lbl: 'Tout',          icon: '' },
  { id: 'arme', lbl: 'Armes',         icon: '⚔️' },
  { id: 'armure', lbl: 'Armures',     icon: '🛡️' },
  { id: 'conso', lbl: 'Consommables', icon: '🧪' },
  { id: 'parchemin', lbl: 'Parchemins', icon: '📜' },
  { id: 'bijou', lbl: 'Précieux',     icon: '💎' },
];

function _detectInvCategory(it) {
  const tpl = (it.template || it.categorie || it.type || '').toLowerCase();
  const nom = (it.nom || '').toLowerCase();
  if (tpl.includes('arme') || it.degats || it.toucher) return 'arme';
  if (tpl.includes('armure') || it.typeArmure || it.slotArmure) return 'armure';
  if (tpl.includes('bijou') || it.slotBijou) return 'bijou';
  if (tpl.includes('parchemin') || nom.includes('parchemin')) return 'parchemin';
  if (tpl.includes('conso') || tpl.includes('potion') || nom.includes('potion')) return 'conso';
  return 'autre';
}

function renderCharInventaireV3(c, canEdit) {
  const inv = c.inventaire || [];
  const totalItems = inv.length;
  let equipped = 0;
  try {
    const equipMap = getEquippedInventoryIndexMap?.(c) || new Map();
    equipped = equipMap.size;
  } catch {}
  const valeur = inv.reduce((s, it) => {
    const p = parseInt(it.prix || it.price || 0);
    const q = parseInt(it.quantite || it.qte || 1) || 1;
    return s + (Number.isFinite(p) ? p * q : 0);
  }, 0);

  // État du filtre / search module-local
  const filter = _csV3InvFilter;
  const q = (filter.search || '').toLowerCase();

  // Stack : regroupe les items identiques (même itemId ou même nom+rareté+template+prix)
  // Garde la liste d'indices originaux pour les actions (vente/envoi/suppression bulk).
  const stackMap = new Map();
  inv.forEach((it, idx) => {
    const key = it.itemId || `${it.nom||''}|${it.template||it.type||''}|${parseInt(it.rarete||it.rare||0)}|${parseInt(it.prix||0)}`;
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
    if (filter.cat !== 'all' && _detectInvCategory(it) !== filter.cat) return false;
    if (!q) return true;
    const hay = `${it.nom||''} ${it.type||''} ${it.template||''} ${it.description||''}`.toLowerCase();
    return hay.includes(q);
  });

  const summaryHtml = `<div class="inv-summary">
    <div class="inv-sum-item"><span class="inv-sum-lbl">Objets</span><span class="inv-sum-val">${totalItems}</span></div>
    <div class="inv-sum-item"><span class="inv-sum-lbl">Équipés</span><span class="inv-sum-val">${equipped}</span></div>
    <div class="inv-sum-item"><span class="inv-sum-lbl">Valeur totale</span><span class="inv-sum-val gold">${valeur} or</span></div>
    ${canEdit?`<button class="section-action" style="margin-left:auto;align-self:center" data-action="addInvItem" data-id="${c.id}">＋ Ajouter un objet</button>`:''}
  </div>`;

  const filterBarHtml = `<div class="inv-search">
    <input placeholder="🔍 Rechercher dans l'inventaire…" value="${_esc(filter.search)}"
      data-input="_csV3InvSetSearch">
    <div class="filter-chips">
      ${_INV_FILTERS.map(f => `<button class="filter-chip ${filter.cat===f.id?'on':''}" data-action="csV3InvSetCat" data-cat="${f.id}">
        ${f.icon} ${f.lbl}
      </button>`).join('')}
    </div>
  </div>`;

  if (filteredInv.length === 0) {
    return summaryHtml + filterBarHtml + `<div class="q-empty">${inv.length===0?"Inventaire vide.":"Aucun objet ne correspond aux filtres."}</div>`;
  }

  const cardsHtml = filteredInv.map(({ it, indices, qte }) => {
    const idx = indices[0];               // index principal pour Modifier
    const allIdx = indices;               // tous les indices pour bulk actions
    // Rareté : 0=aucune, 1=Commun → 5=Légendaire (aligné sur la boutique)
    const rareRaw = parseInt(it.rarete || it.rare || 0) || 0;
    const rareIdx = Math.min(5, Math.max(0, rareRaw));
    const col = _RARE_COLS[rareIdx];
    const stars = rareIdx > 0 ? ('★'.repeat(rareIdx) + '☆'.repeat(5 - rareIdx)) : '';
    const allIdxB64 = btoa(JSON.stringify(allIdx));

    // Prix d'achat (référence) et prix de vente (au joueur quand il revend)
    const prixAchat = parseFloat(it.prix || it.prixAchat || 0) || 0;
    const prixVente = parseFloat(it.prixVente) || Math.round(prixAchat * 0.6);

    // Propriétés : on génère des kv selon ce qui existe
    const props = [];
    if (it.degats) props.push({ k: 'Dégâts', v: it.degats, c: 'dmg' });
    if (it.toucher) props.push({ k: 'Toucher', v: it.toucher });
    if (it.portee) props.push({ k: 'Portée', v: it.portee });
    if (it.typeArmure) props.push({ k: 'Type', v: it.typeArmure });
    if (it.slotArmure)  props.push({ k: 'Slot', v: it.slotArmure });
    else if (it.slotBijou) props.push({ k: 'Slot', v: it.slotBijou });
    if (it.ca || it.caBonus) {
      const total = (parseInt(it.ca)||0) + (parseInt(it.caBonus)||0);
      if (total) props.push({ k: 'CA', v: '+'+total });
    }
    if (it.format) props.push({ k: 'Format', v: it.format });
    // Effet : applique les upgrades (Artisan) au texte affiché
    const effetTxt = getItemEffectText(it);
    if (effetTxt) props.push({ k: 'Effet', v: effetTxt });
    if (prixAchat) props.push({ k: 'Prix', v: prixAchat + ' or', c: 'gold' });

    const equipMap = (() => { try { return getEquippedInventoryIndexMap?.(c) || new Map(); } catch { return new Map(); } })();
    const isEquipped = allIdx.some(i => equipMap.has(i));
    const safeName = String(it.nom || '').replace(/`/g, '\\`').replace(/"/g, '&quot;');

    return `<div class="inv-card ${isEquipped?'is-equipped':''}" style="--rare-c:${col}">
      <div class="inv-card-head">
        <div style="min-width:0;flex:1">
          <div class="inv-card-name">${_esc(it.nom || 'Sans nom')}</div>
          ${rareIdx > 0
            ? `<div class="inv-card-rare" style="color:${col}">${stars} ${_RARE_NAMES[rareIdx]}</div>`
            : ''}
        </div>
        ${qte > 1
          ? `<span class="inv-qte" title="${qte} items empilés">×${qte}</span>`
          : `<span class="inv-qte">×1</span>`}
      </div>
      ${props.length?`<div class="inv-card-props">
        ${props.map(p => `<span class="kv">
          <span class="k">${_esc(p.k)}</span>
          <span class="v ${p.c||''}">${_esc(p.v)}</span>
        </span>`).join('')}
      </div>`:''}
      ${(() => {
        const badges = _itemBonusBadges(it);
        return badges.length ? `<div class="inv-card-badges">${badges.map(b=>`<span class="badge-chip ${b.cls}">${b.lbl}</span>`).join('')}</div>` : '';
      })()}
      ${it.description?`<div class="inv-card-desc">${_esc(it.description)}</div>`:''}
      ${canEdit?`<div class="inv-card-actions">
        <button class="inv-act sell" data-action="openSellInvModal" data-id="${c.id}" data-indices="${allIdxB64}" data-prix="${prixVente}" data-name="${_esc(it.nom||'')}" title="Vendre ${prixVente} or/u">💰 Vendre ${prixVente}or</button>
        <button class="inv-act send" data-action="openSendInvModal" data-id="${c.id}" data-indices="${allIdxB64}" data-name="${_esc(it.nom||'')}" title="Envoyer">↗ Envoyer</button>
        <button class="inv-act del" data-action="openDeleteInvModal" data-id="${c.id}" data-indices="${allIdxB64}" data-name="${_esc(it.nom||'')}" title="Supprimer">🗑️</button>
      </div>`:''}
    </div>`;
  }).join('');

  return summaryHtml + filterBarHtml + `<div class="inv-grid">${cardsHtml}</div>`;
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

// ══════════════════════════════════════════════════════════════════════════════
// V3 — SORTS (.spell list avec toggle + body + cost)
// ══════════════════════════════════════════════════════════════════════════════
function renderCharSortsV3(c, canEdit) {
  const deck = c.deck_sorts || [];
  const actives = deck.filter(s => s.actif).length;
  const max = (typeof calcDeckMax === 'function') ? calcDeckMax(c) : 6;

  if (!deck.length) {
    return `<div class="q-empty">Aucun sort. ${canEdit?'Crée un sort via la console de forge.':''}</div>`;
  }

  // Tri : actifs d'abord, puis par catégorie/nom
  const sorted = [...deck].map((s, idx) => ({ s, idx })).sort((a, b) => {
    if (!!a.s.actif !== !!b.s.actif) return a.s.actif ? -1 : 1;
    return (a.s.nom || '').localeCompare(b.s.nom || '', 'fr');
  });

  const headerHtml = `<div class="deck-meta">
    <span>Deck équipé : <b>${actives}</b> sort${actives>1?'s':''} actif${actives>1?'s':''} sur <b>${max}</b> emplacement${max>1?'s':''}</span>
    <span style="margin-left:auto;color:var(--text-dim);font-size:.7rem">Clique sur un sort pour l'activer / désactiver</span>
    ${canEdit?`<button class="section-action" style="margin-left:8px" data-action="addSort">＋ Sort</button>`:''}
  </div>`;

  const listHtml = `<div class="spell-list">${sorted.map(({ s, idx }) => {
    const cat = s.categorie || s.cat || s.element || '';
    const pm = parseInt(s.cout || s.pm || 0) || 0;
    const effect = s.effet || s.description || s.contenu || '';
    const dmg = s.degats || s.dmg || '';
    const portee = s.portee || s.range || '';
    const cls = s.actif ? 'spell active' : 'spell';
    const isFull = !s.actif && actives >= max;
    return `<div class="${cls} ${isFull?'is-locked':''}"
      ${canEdit && !isFull ? `data-action="toggleSort" data-idx="${idx}"` : (isFull?`title="Deck plein — désactive un sort d'abord"`:'')}>
      <span class="spell-toggle">${s.actif?'✓':''}</span>
      <div class="spell-body">
        <div class="spell-head">
          <span class="spell-name">${_esc(s.nom || 'Sans nom')}</span>
          ${cat?`<span class="spell-cat">${_esc(cat)}</span>`:''}
        </div>
        ${effect?`<div class="spell-effect">${_esc(String(effect).slice(0, 140))}${String(effect).length>140?'…':''}</div>`:''}
        ${dmg || portee ? `<div class="spell-stats">
          ${dmg?`<span>Dégâts : <b>${_esc(dmg)}</b></span>`:''}
          ${portee?`<span>Portée : <b>${_esc(portee)}</b></span>`:''}
        </div>`:''}
      </div>
      <div class="spell-pm">${pm}<small>PM</small></div>
      ${canEdit?`<button class="spell-edit-v3" data-action="editSort" data-idx="${idx}" data-stop-propagation title="Modifier">✎</button>`:''}
    </div>`;
  }).join('')}</div>`;

  return headerHtml + listHtml;
}

// ── Allocation ±1 point de niveau sur une stat depuis le stats banner ───────
async function allocateStat(charId, key, delta = 1) {
  const c = STATE.characters.find(x => x.id === charId) || STATE.activeChar;
  if (!c) return;
  const STATS_KEYS = ['force','dexterite','intelligence','constitution','sagesse','charisme'];
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
  const c = STATE.characters.find(x=>x.id===charId)||STATE.activeChar;
  if (!c) return;
  c.aura = aura;
  await updateInCol('characters', charId, {aura});
  const side = document.getElementById('cs-sidebar');
  if (side) {
    side.setAttribute('data-aura', aura);
    const { auraGlow, auraBd, auraSh } = _auraVars(_auraColor(aura));
    side.style.setProperty('--aura-glow',   auraGlow);
    side.style.setProperty('--aura-border', auraBd);
    side.style.setProperty('--aura-shadow', auraSh);
  }
  document.querySelectorAll('.cs-aura-dot, .aura-dot').forEach(d =>
    d.classList.toggle('active', d.dataset.aura === aura)
  );
}

// Mémorise la position de scroll par onglet (clé : charId + tab)
const _scrollByTab = new Map();
function _scrollKey(charId, tab) { return `${charId || '?'}::${tab}`; }

function showCharTab(tab, el) {
  // V3 : 6 onglets uniquement. Toute valeur legacy est remappée.
  const v3 = _resolveV3Tab(tab);

  // Mémorise la position de scroll de l'onglet quitté (pour le restituer plus tard)
  const prevLeaf = charSession.getCurrentCharTab();
  const prevChar = charSession.getCurrentChar()?.id;
  if (prevLeaf && prevChar) {
    const area = document.getElementById('char-tab-content');
    const scrollTop = area?.scrollTop ?? window.scrollY ?? 0;
    if (scrollTop > 0) _scrollByTab.set(_scrollKey(prevChar, prevLeaf), scrollTop);
  }

  _currentTopTab  = v3;
  charSession.set(charSession.getCurrentChar(), charSession.getCanEditChar(), v3);

  // Onglets v3 (nouveau template)
  document.querySelectorAll('#char-tabs-v3 .tab-v3').forEach(t =>
    t.classList.toggle('active', t.dataset.tabV3 === v3)
  );
  // Rétro-compat : les anciennes barres .cs-tab / .cs-subtab si une vieille page tarde à se rafraîchir
  document.querySelectorAll('#char-tabs .cs-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === v3)
  );

  _renderTabV3(v3, charSession.getCurrentChar(), charSession.getCanEditChar());

  // Restitue le scroll de l'onglet rejoint (si on y était déjà passé)
  const charId = charSession.getCurrentChar()?.id;
  const saved  = charId ? _scrollByTab.get(_scrollKey(charId, v3)) : null;
  if (saved != null) {
    requestAnimationFrame(() => {
      const area = document.getElementById('char-tab-content');
      if (area) area.scrollTop = saved;
      else window.scrollTo({ top: saved, behavior: 'instant' });
    });
  }
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
  editEquipSlot:            (btn)   => editEquipSlot(btn.dataset.slot),
  openCombatStylesAdmin:    ()      => openCombatStylesAdmin(),
  openDamageTypesAdmin:     ()      => openDamageTypesAdmin(),
  toggleCharElement:        (btn)   => toggleCharElement(btn.dataset.id, btn.dataset.elem),

  // Maîtrises
  addMaitrise:              ()      => addMaitrise(),
  editMaitrise:             (btn)   => editMaitrise(Number(btn.dataset.idx)),

  // Inventaire
  addInvItem:               ()      => addInvItem(),
  csV3InvSetCat:            (btn)   => _csV3InvSetCat(btn.dataset.cat),
  openSellInvModal:         (btn)   => openSellInvModal(btn.dataset.id, btn.dataset.indices, Number(btn.dataset.prix), btn.dataset.name),
  openSendInvModal:         (btn)   => openSendInvModal(btn.dataset.id, btn.dataset.indices, btn.dataset.name),
  openDeleteInvModal:       (btn)   => openDeleteInvModal(btn.dataset.id, btn.dataset.indices, btn.dataset.name),
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
  toggleSort:               (btn)   => toggleSort(Number(btn.dataset.idx)),
  editSort:                 (btn)   => editSort(Number(btn.dataset.idx)),
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
  saveMaitrise:             (btn)   => saveMaitrise(Number(btn.dataset.idx)),
  deleteMaitrise:           (btn)   => deleteMaitrise(Number(btn.dataset.idx)),
  removeProfilTag:          (btn)   => removeProfilTag(btn),
  addProfilTag:             (btn)   => addProfilTag(btn.dataset.tag),
  saveCharProfil:           (btn)   => saveCharProfil(btn.dataset.id),
});

charSession.bindRender(_renderTab, renderCharSheet, refreshOrDisplay);

// Exports legacy minimaux — uniquement ce qui est encore consommé via window.* par des modules lazy
// filterAdminChars : pages.js registerActions (bridge lazy)
// charNavCardHtml, selectChar : compatibilité externe résiduelle
Object.assign(window, { charNavCardHtml, selectChar, filterAdminChars, showCharTab });
