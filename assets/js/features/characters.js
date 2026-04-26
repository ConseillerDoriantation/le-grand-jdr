// ══════════════════════════════════════════════
// characters.js — Point d'entrée mince
// Toute la logique est dans assets/js/features/characters/
// ══════════════════════════════════════════════
import { STATE } from '../core/state.js';
import { modStr } from '../shared/html.js';
import {
  getMod, calcCA, calcVitesse, calcDeckMax, calcPVMax, calcPMMax,
  calcOr, calcPalier, pct,
} from '../shared/char-stats.js';

// ── Sous-modules ─────────────────────────────────────────────────────────────
import {
  loadCombatStyles, _defaultCombatStyles, detectCombatStyle,
  openCombatStylesAdmin, openWeaponFormatsAdmin,
  _getTraits, getEquippedInventoryIndexMap, syncEquipmentAfterInventoryMutation,
  normalizeArmorType, getArmorTypeMeta, getArmorSetChipText, getArmorSetData,
  applyFlatBonusToRollText, getToucherDisplay, getDegatsDisplay,
} from './characters/data.js';

import {
  sortDragStart, sortDragOver, sortDragEnd, sortDrop,
  renderCharDeck, openSortCatEditor, toggleSortDetail,
  addSort, editSort, openSortModal, saveSort,
  runeIncrement, runeDecrement, selectNoyau, updateSortPM,
} from './characters/spells.js';

import { renderCharEquip } from './characters/combat.js';

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
  addCompteRow, deleteCompteRow, inlineEditCompteField,
  renderCharMaitrises,
  addMaitrise, editMaitrise, saveMaitrise, deleteMaitrise,
  previewXpBar, saveXpDirect,
} from './characters/tabs.js';

import {
  inlineEditText, inlineEditNum,
  inlineEditStatFromCard, inlineEditStat,
} from './characters/inline-edit.js';

import {
  adjustStat, saveNotes,
  toggleSort, toggleQuete, deleteQuete,
  deleteSort, deleteInvItem, deleteChar, createNewChar,
  manageTitres, addTitre, removeTitre, saveTitres,
  addQuete, saveQuete, deleteCharPhoto,
} from './characters/forms.js';

// ══════════════════════════════════════════════
// SÉLECTION
// ══════════════════════════════════════════════
function selectChar(id, el) {
  document.querySelectorAll('#char-pills .char-pill').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  const c = STATE.characters.find(x=>x.id===id);
  if (c) { STATE.activeChar=c; renderCharSheet(c, window._currentCharTab||'carac'); }
}

function filterAdminChars(pseudo, el) {
  document.querySelectorAll('#admin-player-filter .char-pill').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  const pills = document.querySelector('#char-pills');
  if (!pills) return;
  const chars = pseudo ? STATE.characters.filter(c=>c.ownerPseudo===pseudo) : STATE.characters;
  pills.innerHTML = chars.map((c,i)=>`<div class="char-pill ${i===0?'active':''}" onclick="selectChar('${c.id}',this)">${c.nom||'Sans nom'}</div>`).join('');
  if (chars.length > 0) { STATE.activeChar=chars[0]; renderCharSheet(chars[0]); }
}

// ══════════════════════════════════════════════
// ROUTING — correspondance onglets
// ══════════════════════════════════════════════
const _LEAF_TO_TOP = {
  equipement:'combat', sorts:'combat', maitrises:'combat',
  notes:'journal',     quetes:'journal',
  inventaire:'inventaire', compte:'compte',
  // rétro-compat
  combat:'combat', carac:'combat',
};
const _TOP_DEFAULTS = {
  combat:'equipement', journal:'notes',
  inventaire:'inventaire', compte:'compte',
};

function _resolveTab(raw) {
  const top  = _LEAF_TO_TOP[raw] || 'combat';
  const leaf = _TOP_DEFAULTS[raw] || (_LEAF_TO_TOP[raw] ? raw : 'equipement');
  return { top, leaf };
}

// ══════════════════════════════════════════════
// RENDER PRINCIPAL
// ══════════════════════════════════════════════
function renderCharSheet(c, keepTab) {
  const area = document.getElementById('char-sheet-area');
  if (!area) return;
  const canEdit = STATE.isAdmin || c.uid === STATE.user?.uid;

  const { top: topTab, leaf: leafTab } = _resolveTab(keepTab || window._currentCharTab || 'equipement');

  window._currentChar    = c;
  window._canEditChar    = canEdit;
  window._currentCharTab = leafTab;
  window._currentTopTab  = topTab;

  // ── Valeurs dérivées ─────────────────────────
  const pvMax      = calcPVMax(c);
  const pmMax      = calcPMMax(c);
  const pvCur      = c.pvActuel ?? pvMax;
  const pmCur      = c.pmActuel ?? pmMax;
  const pvPct      = pct(pvCur, pvMax);
  const pmPct      = pct(pmCur, pmMax);
  const xpCur      = c.exp || 0;
  const xpPalier   = calcPalier(c.niveau || 1);
  const xpPct      = pct(xpCur, xpPalier);
  const deckActifs = (c.deck_sorts || []).filter(s => s.actif).length;
  const deckMax    = calcDeckMax(c);
  const pvColor    = pvPct < 25 ? 'var(--crimson-light)' : pvPct < 50 ? '#f59e0b' : 'var(--green)';
  const titres     = c.titres || [];

  // ── Stats en bloc 2×3 ────────────────────────
  // Ordre : For Dex Int / Con Sag Cha
  const STATS = [
    {key:'force',       abbr:'For', label:'Force'},
    {key:'dexterite',   abbr:'Dex', label:'Dextérité'},
    {key:'intelligence',abbr:'Int', label:'Intelligence'},
    {key:'constitution',abbr:'Con', label:'Constitution'},
    {key:'sagesse',     abbr:'Sag', label:'Sagesse'},
    {key:'charisme',    abbr:'Cha', label:'Charisme'},
  ];
  const s  = c.stats     || {};
  const sb = c.statsBonus || {};
  const statsHtml = STATS.map(st => {
    const base  = s[st.key]  || 8;
    const bonus = sb[st.key] || 0;
    const total = base + bonus;
    const m     = getMod(c, st.key);
    const mStr  = m >= 0 ? `+${m}` : String(m);
    const mCls  = m > 0 ? 'pos' : m < 0 ? 'neg' : 'zero';
    const equipStr = bonus > 0 ? `+${bonus}` : bonus < 0 ? String(bonus) : '+0';
    return `<div class="cs-stat-card${canEdit?' cs-stat-card--edit':''}"
      title="${st.label} — base ${base}, équip. ${equipStr}"
      ${canEdit?`onclick="inlineEditStatFromCard(event,'${c.id}','${st.key}',this)"`:''}
    >
      <div class="cs-stat-card-top">
        <span class="cs-stat-abbr">${st.abbr}</span>
        <span class="cs-stat-mod ${mCls}">${mStr}</span>
      </div>
      <div class="cs-stat-card-mid">
        <span class="cs-stat-total-lbl">TOTAL</span>
        <span class="cs-stat-total">${total}</span>
      </div>
      <div class="cs-stat-card-bot">
        <div class="cs-stat-sub"><span class="cs-stat-sub-lbl">BASE</span><span class="cs-stat-sub-val js-stat-base">${base}</span></div>
        <div class="cs-stat-sub"><span class="cs-stat-sub-lbl">EQUIP.</span><span class="cs-stat-sub-val">${equipStr}</span></div>
      </div>
    </div>`;
  }).join('');

  // ── Sélecteur multi-personnages ───────────────
  const allChars    = STATE.characters || [];
  const switchable  = STATE.isAdmin ? allChars : allChars.filter(x => x.uid === STATE.user?.uid);
  const switcher    = switchable.length > 1
    ? `<div class="cs-switcher">${
        switchable.map(ch => `<button class="cs-switch-pill${ch.id===c.id?' active':''}"
          data-charid="${ch.id}" onclick="selectChar('${ch.id}',this)"
          ${ch.id===c.id?'disabled':''}>${ch.nom||'?'}</button>`).join('')
      }</div>`
    : '';

  area.innerHTML = `
<div class="cs-layout">

  <!-- ══════════ SIDEBAR ══════════ -->
  <aside class="cs-sidebar" id="cs-sidebar">

    ${switcher}

    <!-- Identité -->
    <div class="cs-id-block">
      <div class="cs-photo-wrap" id="char-photo-wrap">
        <div class="cs-photo" id="char-photo"
             onclick="${canEdit?`openPhotoCropper('${c.id}')`:''}"
             style="cursor:${canEdit?'pointer':'default'}">
          ${c.photo
            ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;
                transform:scale(${c.photoZoom||1}) translate(${c.photoX||0}px,${c.photoY||0}px);
                transform-origin:center">`
            : `<div class="cs-photo-placeholder">${canEdit
                ? '<span style="font-size:1.3rem">📷</span>'
                : '<span style="font-size:1.5rem;opacity:.2">⚔️</span>'
               }</div>`}
        </div>
        ${canEdit&&c.photo?`<button class="cs-photo-del" onclick="deleteCharPhoto('${c.id}')" title="Supprimer la photo">✕</button>`:''}
      </div>
      <div class="cs-id-body">
        <div class="cs-name-row">
          ${canEdit
            ? `<span class="cs-name cs-editable" onclick="inlineEditText('${c.id}','nom',this)" title="Modifier">${c.nom||'Nouveau personnage'}</span>`
            : `<span class="cs-name">${c.nom||'Nouveau personnage'}</span>`}
          ${canEdit?`<button class="cs-delete-btn" onclick="deleteChar('${c.id}')" title="Supprimer ce personnage">🗑️</button>`:''}
        </div>
        ${titres.length||canEdit?`<div class="cs-titres">
          ${titres.map(t=>`<span class="badge badge-gold" style="font-size:.62rem">${t}</span>`).join('')}
          ${canEdit?`<button class="cs-add-titre" onclick="manageTitres('${c.id}')">＋ titre</button>`:''}
        </div>`:''}
      </div>
    </div>

    <!-- Niveau · Or -->
    <div class="cs-meta-strip">
      <span class="cs-level-badge">
        ${canEdit
          ? `<span class="cs-editable-num" onclick="inlineEditNum('${c.id}','niveau',this,1,20)" title="Modifier">Niv.&nbsp;${c.niveau||1}</span>`
          : `Niv.&nbsp;${c.niveau||1}`}
      </span>
      <span class="cs-or" title="Solde du Livret de Compte">💰&nbsp;${calcOr(c)}&nbsp;or</span>
    </div>

    <!-- XP -->
    <div class="cs-xp-section">
      <div class="cs-xp-row">
        <div class="cs-xp-track">
          <div class="cs-xp-fill" id="xp-bar-fill" style="width:${xpPct}%"></div>
        </div>
        <span id="xp-pct" class="cs-xp-pct">${xpPct}%</span>
      </div>
      ${canEdit
        ? `<div class="cs-xp-edit-row">
            <label class="cs-xp-edit-label">XP</label>
            <input type="number" class="cs-xp-input cs-inline-num" id="xp-direct-input"
              value="${xpCur}" min="0" max="${xpPalier}"
              onchange="saveXpDirect('${c.id}',this)"
              oninput="previewXpBar(this,${xpPalier})" title="XP actuel">
            <span class="cs-xp-edit-label">/ ${xpPalier}</span>
          </div>`
        : `<div class="cs-xp-edit-label" style="text-align:right">${xpCur} / ${xpPalier} xp</div>`}
    </div>

    <div class="cs-sb-divider"></div>

    <!-- PV / PM -->
    <div class="cs-vitals-row">
      <div class="cs-vital-block">
        <div class="cs-vital-label">❤️ PV</div>
        <div class="cs-vital-controls">
          ${canEdit?`<button class="cs-vbtn" onclick="adjustStat('pvActuel',-1,'${c.id}')">−</button>`:''}
          <span class="cs-vital-val" id="pv-val" style="color:${pvColor}">${pvCur}</span>
          ${canEdit?`<button class="cs-vbtn cs-vbtn-plus" onclick="adjustStat('pvActuel',1,'${c.id}')">+</button>`:''}
        </div>
        <div class="cs-bar-bg cs-bar-hp">
          <div class="cs-bar-fill cs-bar-hp-fill ${pvPct>50?'high':pvPct>25?'mid':''}" id="pv-bar" style="width:${pvPct}%"></div>
        </div>
        <div class="cs-vital-sub">
          <span>max <strong id="pv-max">${pvMax}</strong></span>
          ${canEdit
            ? `<button class="cs-vital-base-btn" onclick="inlineEditNum('${c.id}','pvBase',this,1,999)" title="Modifier PV de base">✎ ${c.pvBase||10}</button>`
            : `<span class="cs-vital-base-ro">base ${c.pvBase||10}</span>`}
        </div>
      </div>
      <div class="cs-vital-block">
        <div class="cs-vital-label">🔵 PM</div>
        <div class="cs-vital-controls">
          ${canEdit?`<button class="cs-vbtn" onclick="adjustStat('pmActuel',-1,'${c.id}')">−</button>`:''}
          <span class="cs-vital-val" id="pm-val" style="color:var(--blue)">${pmCur}</span>
          ${canEdit?`<button class="cs-vbtn cs-vbtn-plus" onclick="adjustStat('pmActuel',1,'${c.id}')">+</button>`:''}
        </div>
        <div class="cs-bar-bg cs-bar-pm">
          <div class="cs-bar-fill cs-bar-pm-fill" id="pm-bar" style="width:${pmPct}%"></div>
        </div>
        <div class="cs-vital-sub">
          <span>max <strong id="pm-max">${pmMax}</strong></span>
          ${canEdit
            ? `<button class="cs-vital-base-btn" onclick="inlineEditNum('${c.id}','pmBase',this,1,999)" title="Modifier PM de base">✎ ${c.pmBase||10}</button>`
            : `<span class="cs-vital-base-ro">base ${c.pmBase||10}</span>`}
        </div>
      </div>
    </div>

    <!-- CA · Vitesse · Deck -->
    <div class="cs-secondary-row">
      <div class="cs-stat-chip">
        <span class="cs-chip-label">🛡️ CA</span>
        <span class="cs-chip-val">${calcCA(c)}</span>
      </div>
      <div class="cs-stat-chip">
        <span class="cs-chip-label">🏃 Vit.</span>
        <span class="cs-chip-val">${calcVitesse(c)}m</span>
      </div>
      <div class="cs-stat-chip">
        <span class="cs-chip-label">🃏 Deck</span>
        <span class="cs-chip-val">${deckActifs}/${deckMax}</span>
      </div>
    </div>

    <div class="cs-sb-divider"></div>

    <!-- Caractéristiques en bloc 2×3 -->
    <div class="cs-stats-section">
      <div class="cs-stats-header">
        <span>Caractéristiques</span>
        ${canEdit?'<span class="cs-hint">clic = modifier</span>':''}
      </div>
      <div class="cs-stats-grid">${statsHtml}</div>
    </div>

  </aside>

  <!-- ══════════ CONTENU PRINCIPAL ══════════ -->
  <div class="cs-main-col">

    <!-- Onglets principaux -->
    <nav class="cs-tabs" id="char-tabs">
      <button class="cs-tab${topTab==='combat'?' active':''}"     data-tab="combat"
        onclick="showCharTab('combat',this)">⚔️ Combat</button>
      <button class="cs-tab${topTab==='inventaire'?' active':''}" data-tab="inventaire"
        onclick="showCharTab('inventaire',this)">🎒 Inventaire</button>
      <button class="cs-tab${topTab==='journal'?' active':''}"    data-tab="journal"
        onclick="showCharTab('journal',this)">📖 Journal</button>
      <button class="cs-tab${topTab==='compte'?' active':''}"     data-tab="compte"
        onclick="showCharTab('compte',this)">💰 Compte</button>
    </nav>

    <!-- Sous-onglets Combat : Équipement · Sorts · Maîtrises -->
    <div class="cs-subtab-bar" id="cs-subtabs-combat"
         style="display:${topTab==='combat'?'flex':'none'}">
      <button class="cs-subtab${leafTab==='equipement'?' active':''}" data-subtab="equipement"
        onclick="showCharTab('equipement',this)">🛡️ Équipement</button>
      <button class="cs-subtab${leafTab==='sorts'?' active':''}"      data-subtab="sorts"
        onclick="showCharTab('sorts',this)">✨ Sorts</button>
      <button class="cs-subtab${leafTab==='maitrises'?' active':''}"  data-subtab="maitrises"
        onclick="showCharTab('maitrises',this)">🎯 Maîtrises</button>
    </div>

    <!-- Sous-onglets Journal : Notes · Quêtes -->
    <div class="cs-subtab-bar" id="cs-subtabs-journal"
         style="display:${topTab==='journal'?'flex':'none'}">
      <button class="cs-subtab${leafTab==='notes'?' active':''}"  data-subtab="notes"
        onclick="showCharTab('notes',this)">📝 Notes</button>
      <button class="cs-subtab${leafTab==='quetes'?' active':''}" data-subtab="quetes"
        onclick="showCharTab('quetes',this)">📜 Quêtes</button>
    </div>

    <div id="char-tab-content" class="cs-tab-body"></div>

  </div><!-- /cs-main-col -->

</div><!-- /cs-layout -->`;

  _renderTab(leafTab, c, canEdit);
}

function _renderTab(leafTab, c, canEdit) {
  const area = document.getElementById('char-tab-content');
  if (!area) return;
  const renders = {
    equipement:  () => renderCharEquip(c, canEdit),
    sorts:       () => renderCharDeck(c, canEdit),
    maitrises:   () => renderCharMaitrises(c, canEdit),
    inventaire:  () => renderCharInventaire(c, canEdit),
    notes:       () => renderCharNotes(c, canEdit),
    quetes:      () => renderCharQuetes(c, canEdit),
    compte:      () => renderCharCompte(c, canEdit),
    // rétro-compat
    combat:      () => renderCharEquip(c, canEdit),
    carac:       () => renderCharEquip(c, canEdit),
  };
  area.innerHTML = renders[leafTab]?.() || '';
}

function showCharTab(tab, el) {
  const isTopTab = ['combat','inventaire','journal','compte'].includes(tab);
  const newTop  = isTopTab ? tab : (_LEAF_TO_TOP[tab] || 'combat');
  const newLeaf = isTopTab ? (_TOP_DEFAULTS[tab] || tab) : tab;

  window._currentTopTab  = newTop;
  window._currentCharTab = newLeaf;

  // Onglets principaux
  document.querySelectorAll('#char-tabs .cs-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === newTop)
  );

  // Barres de sous-onglets
  ['combat','journal'].forEach(group => {
    const bar = document.getElementById(`cs-subtabs-${group}`);
    if (bar) bar.style.display = newTop === group ? 'flex' : 'none';
  });

  // Sous-onglets actifs
  document.querySelectorAll('.cs-subtab').forEach(t =>
    t.classList.toggle('active', t.dataset.subtab === newLeaf)
  );

  _renderTab(newLeaf, window._currentChar, window._canEditChar);
}

// ══════════════════════════════════════════════
// EXPORT — expose tout sur window pour les onclick HTML
// ══════════════════════════════════════════════
Object.assign(window, {
  // Noyau
  selectChar, filterAdminChars,
  renderCharSheet, showCharTab,
  _renderTab, refreshOrDisplay,

  // Stats & affichage
  getMod, calcCA, calcVitesse, calcDeckMax, calcPVMax, calcPMMax, calcOr, calcPalier,

  // Render tabs
  renderCharCarac, renderCharEquip, renderCharDeck,
  _renderInventaireBoutique, renderCharInventaire,
  renderCharQuetes, renderCharNotes, renderCharCompte, renderCharMaitrises,

  // Inventaire
  openSellInvModal, sellInvItemBulk, sellInvItem,
  openDeleteInvModal, deleteInvItemBulk,
  openSendInvModal, sendInvItem,
  openSendGoldModal, sendGold,
  addInvItem, _lootPillStyle, saveInvItemFromShop,
  editInvItem, saveInvItem,
  filterInvRows,

  // Équipement
  editEquipSlot, saveEquipSlot, clearEquipSlot,
  equipSlotFromInv, previewEquipFromInv,

  // Sorts
  sortDragStart, sortDragOver, sortDragEnd, sortDrop,
  toggleSortDetail, selectNoyau,
  runeIncrement, runeDecrement, updateSortPM,
  addSort, editSort, openSortModal, saveSort,
  openSortCatEditor,

  // Combat styles
  openCombatStylesAdmin, openWeaponFormatsAdmin,

  // Compte
  addCompteRow, deleteCompteRow, inlineEditCompteField,

  // Notes
  addNote, editNoteTitle, saveNote, deleteNote, toggleNote,

  // XP
  previewXpBar, saveXpDirect,

  // Maîtrises
  addMaitrise, editMaitrise, saveMaitrise, deleteMaitrise,

  // Inline-edit
  inlineEditText, inlineEditNum, inlineEditStatFromCard, inlineEditStat,

  // Forms
  adjustStat, saveNotes,
  toggleSort, toggleQuete, deleteQuete, deleteSort, deleteInvItem,
  deleteChar, createNewChar,
  manageTitres, addTitre, removeTitre, saveTitres,
  addQuete, saveQuete, deleteCharPhoto,
});
