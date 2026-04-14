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
  addInvItem, _lootPillStyle, saveInvItemFromShop,
  editInvItem, saveInvItem,
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
// RENDER PRINCIPAL
// ══════════════════════════════════════════════
function renderCharSheet(c, keepTab) {
  const area = document.getElementById('char-sheet-area');
  if (!area) return;
  const canEdit = STATE.isAdmin || c.uid === STATE.user?.uid;
  const currentTab = keepTab || window._currentCharTab || 'combat';

  window._currentChar = c;
  window._canEditChar = canEdit;
  window._currentCharTab = currentTab;

  const pvMax = calcPVMax(c);
  const pmMax = calcPMMax(c);
  const pvCur = c.pvActuel ?? pvMax;
  const pmCur = c.pmActuel ?? pmMax;
  const pvPct = pct(pvCur, pvMax);
  const pmPct = pct(pmCur, pmMax);
  const xpPct = pct(c.exp||0, calcPalier(c.niveau||1));
  const deckActifs = (c.deck_sorts||[]).filter(s=>s.actif).length;
  const deckMax = calcDeckMax(c);
  const pvColor = pvPct < 25 ? 'var(--crimson-light)' : pvPct < 50 ? '#f59e0b' : 'var(--green)';

  const titres = c.titres||[];
  const titreHtml = titres.map(t=>`<span class="badge badge-gold" style="font-size:0.65rem">${t}</span>`).join('');

  const STATS = [
    {key:'force',abbr:'Fo',label:'Force'},
    {key:'dexterite',abbr:'Dex',label:'Dextérité'},
    {key:'constitution',abbr:'Co',label:'Constitution'},
    {key:'intelligence',abbr:'Int',label:'Intelligence'},
    {key:'sagesse',abbr:'Sag',label:'Sagesse'},
    {key:'charisme',abbr:'Cha',label:'Charisme'},
  ];
  const s = c.stats||{force:10,dexterite:8,intelligence:8,sagesse:8,constitution:8,charisme:10};
  const sb = c.statsBonus||{};

  const caracHtml = STATS.map(st => {
    const base = s[st.key]||8;
    const bonus = sb[st.key]||0;
    const total = base + bonus;
    const m = getMod(c, st.key);
    const mStr = m >= 0 ? '+'+m : String(m);
    const mClass = m > 0 ? 'pos' : m < 0 ? 'neg' : 'zero';
    const bonusStr = bonus >= 0 ? `+${bonus}` : String(bonus);
    const bonusTone = bonus > 0 ? 'is-pos' : bonus < 0 ? 'is-neg' : 'is-zero';
    return `<div class="cs-carac-card ${canEdit ? 'is-clickable' : ''}"
             title="${canEdit ? `Modifier la base de ${st.label}` : st.label}"
             ${canEdit ? `onclick="inlineEditStatFromCard(event,'${c.id}','${st.key}',this)"` : ''}>
      <div class="cs-carac-head">
        <div class="cs-carac-abbr">${st.abbr}</div>
        <div class="cs-carac-mod-badge ${mClass}">${mStr}</div>
      </div>
      <div class="cs-carac-total-label">Total</div>
      <div class="cs-carac-val">${total}</div>
      <div class="cs-carac-breakdown">
        <div class="cs-carac-breakdown-item">
          <span class="cs-carac-breakdown-label">Base</span>
          <span class="cs-carac-breakdown-value ${canEdit ? 'cs-editable js-stat-base' : ''}"
                ${canEdit ? `title="Modifier la base"` : ''}>${base}</span>
        </div>
        <div class="cs-carac-breakdown-item">
          <span class="cs-carac-breakdown-label">Équip.</span>
          <span class="cs-carac-breakdown-value ${bonusTone}">${bonusStr}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  const allChars = STATE.characters || [];
  const switchableChars = STATE.isAdmin
    ? allChars
    : allChars.filter(x => x.uid === STATE.user?.uid);
  const charSwitcher = switchableChars.length > 1
    ? `<div style="display:flex;gap:.35rem;flex-wrap:wrap;margin-bottom:.5rem">
        ${switchableChars.map(ch => `
        <button onclick="selectChar('${ch.id}',document.querySelector('[data-charid=\\'${ch.id}\\']') || document.querySelector('.char-pill'))"
          style="font-size:.68rem;padding:2px 9px;border-radius:999px;cursor:pointer;
          border:1px solid ${ch.id===c.id?'var(--gold)':'var(--border)'};
          background:${ch.id===c.id?'rgba(232,184,75,.12)':'var(--bg-elevated)'};
          color:${ch.id===c.id?'var(--gold)':'var(--text-dim)'};
          font-weight:${ch.id===c.id?'700':'400'};transition:all .12s"
          ${ch.id===c.id?'disabled':''}>
          ${ch.nom||'?'}
        </button>`).join('')}
      </div>`
    : '';

  const TABS = [
    { id:'combat',     label:'⚔️ Combat'     },
    { id:'sorts',      label:'✨ Sorts'       },
    { id:'inventaire', label:'🎒 Inventaire'  },
    { id:'quetes',     label:'📜 Quêtes'      },
    { id:'plus',       label:'···'            },
  ];
  const isSecondaryTab = ['compte','notes','maitrises'].includes(currentTab);

  area.innerHTML = `
<div class="cs-shell">

  <!-- ═══ LIGNE HAUTE : panneau gauche + caractéristiques ═══ -->
  <div class="cs-top">

    <div class="cs-identity-panel">

      ${charSwitcher}

      <!-- Photo + Nom -->
      <div class="cs-id-header">
        <div class="cs-photo-wrap" id="char-photo-wrap">
          <div class="cs-photo" id="char-photo"
               onclick="${canEdit?`openPhotoCropper('${c.id}')`:''}"
               style="cursor:${canEdit?'pointer':'default'}">
            ${c.photo
              ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;
                   transform:scale(${c.photoZoom||1}) translate(${c.photoX||0}px,${c.photoY||0}px);
                   transform-origin:center center;">`
              : `<div class="cs-photo-placeholder">
                   ${canEdit?'<span style="font-size:1.5rem">📷</span>':'<span style="font-size:1.8rem;opacity:0.3">⚔️</span>'}
                 </div>`}
          </div>
          ${canEdit&&c.photo?`<button class="cs-photo-del" onclick="deleteCharPhoto('${c.id}')" title="Supprimer">✕</button>`:''}
        </div>
        <div class="cs-id-info">
          <div class="cs-name-row">
            ${canEdit
              ? `<span class="cs-name cs-editable" onclick="inlineEditText('${c.id}','nom',this)" title="Cliquer pour modifier">${c.nom||'Nouveau personnage'}</span>`
              : `<span class="cs-name">${c.nom||'Nouveau personnage'}</span>`}
            ${canEdit?`<button class="cs-delete-btn" onclick="deleteChar('${c.id}')" title="Supprimer le personnage">🗑️</button>`:''}
          </div>
          <div class="cs-titres">
            ${titreHtml}
            ${canEdit?`<button class="cs-add-titre" onclick="manageTitres('${c.id}')">＋ titre</button>`:''}
          </div>
        </div>
      </div>

      <!-- Niveau + Or + XP compact sur une ligne -->
      <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
        <span class="cs-level-badge">
          ${canEdit
            ? `<span class="cs-editable-num" onclick="inlineEditNum('${c.id}','niveau',this,1,20)" title="Modifier">Niv. ${c.niveau||1}</span>`
            : `Niv. ${c.niveau||1}`}
        </span>
        <span class="cs-or" title="Solde du Livret de Compte">💰 ${calcOr(c)} or</span>
        <div style="display:flex;align-items:center;gap:.35rem;flex:1;min-width:80px" title="XP : ${c.exp||0} / ${calcPalier(c.niveau||1)}">
          <div style="flex:1;height:4px;background:rgba(255,255,255,.07);border-radius:2px;overflow:hidden">
            <div id="xp-bar-fill" style="width:${xpPct}%;height:100%;background:var(--gold);border-radius:2px;transition:width .4s"></div>
          </div>
          <span id="xp-pct" style="font-size:.6rem;color:var(--text-dim);white-space:nowrap">${xpPct}%</span>
          ${canEdit ? `<input type="number" class="cs-xp-input cs-inline-num"
            id="xp-direct-input" value="${c.exp||0}" min="0" max="${calcPalier(c.niveau||1)}"
            onchange="saveXpDirect('${c.id}',this)" oninput="previewXpBar(this,${calcPalier(c.niveau||1)})"
            style="width:50px;font-size:.65rem;padding:1px 4px;text-align:center;
            background:rgba(255,255,255,.05);border:1px solid var(--border);border-radius:5px;
            color:var(--text-dim)" title="XP actuel">` : ''}
        </div>
      </div>

      <div class="cs-divider"></div>

      <!-- PV / PM -->
      <div class="cs-vitals-row">
        <div class="cs-vital-block">
          <div class="cs-vital-label">❤️ PV</div>
          <div class="cs-vital-controls">
            ${canEdit?`<button class="cs-vbtn" onclick="adjustStat('pvActuel',-1,'${c.id}')" style="width:30px;height:30px;font-size:1.1rem">−</button>`:''}
            <span class="cs-vital-val" id="pv-val" style="color:${pvColor}">${pvCur}</span>
            ${canEdit?`<button class="cs-vbtn cs-vbtn-plus" onclick="adjustStat('pvActuel',1,'${c.id}')" style="width:30px;height:30px;font-size:1.1rem">+</button>`:''}
          </div>
          <div class="cs-bar-bg cs-bar-hp"><div class="cs-bar-fill cs-bar-hp-fill ${pvPct>50?'high':pvPct>25?'mid':''}" id="pv-bar" style="width:${pvPct}%"></div></div>
          <div class="cs-vital-sub">max <span id="pv-max">${pvMax}</span></div>
        </div>
        <div class="cs-vital-block">
          <div class="cs-vital-label">🔵 PM</div>
          <div class="cs-vital-controls">
            ${canEdit?`<button class="cs-vbtn" onclick="adjustStat('pmActuel',-1,'${c.id}')" style="width:30px;height:30px;font-size:1.1rem">−</button>`:''}
            <span class="cs-vital-val" id="pm-val" style="color:var(--blue)">${pmCur}</span>
            ${canEdit?`<button class="cs-vbtn cs-vbtn-plus" onclick="adjustStat('pmActuel',1,'${c.id}')" style="width:30px;height:30px;font-size:1.1rem">+</button>`:''}
          </div>
          <div class="cs-bar-bg cs-bar-pm"><div class="cs-bar-fill cs-bar-pm-fill" id="pm-bar" style="width:${pmPct}%"></div></div>
          <div class="cs-vital-sub">max <span id="pm-max">${pmMax}</span></div>
        </div>
      </div>

      <!-- CA / Vit / Deck -->
      <div class="cs-secondary-row">
        <div class="cs-stat-chip">
          <span class="cs-chip-label">🛡️ CA</span>
          <span class="cs-chip-val">${calcCA(c)}</span>
        </div>
        <div class="cs-stat-chip">
          <span class="cs-chip-label">🏃 Vit</span>
          <span class="cs-chip-val">${calcVitesse(c)}m</span>
        </div>
        <div class="cs-stat-chip">
          <span class="cs-chip-label">🃏 Deck</span>
          <span class="cs-chip-val">${deckActifs}/${deckMax}</span>
        </div>
      </div>

    </div><!-- /cs-identity-panel -->

    <!-- BLOC DROIT : Caractéristiques compactes -->
    <div class="cs-carac-panel">
      <div class="cs-carac-panel-title">
        Caractéristiques
        ${canEdit?'<span class="cs-hint">cliquer pour modifier</span>':''}
      </div>
      <div class="cs-carac-grid">
        ${caracHtml}
      </div>
      <div class="cs-base-row">
        <div class="cs-base-chip">
          <span class="cs-base-chip-label">PV base</span>
          <div class="cs-base-chip-val ${canEdit?'cs-editable-num':''}"
               ${canEdit?`onclick="inlineEditNum('${c.id}','pvBase',this,1,999)" title="Modifier"`:''}
          >${c.pvBase||10}</div>
          <div class="cs-base-chip-sub">→ max ${pvMax}</div>
        </div>
        <div class="cs-base-chip">
          <span class="cs-base-chip-label">PM base</span>
          <div class="cs-base-chip-val ${canEdit?'cs-editable-num':''}"
               ${canEdit?`onclick="inlineEditNum('${c.id}','pmBase',this,1,999)" title="Modifier"`:''}
          >${c.pmBase||10}</div>
          <div class="cs-base-chip-sub">→ max ${pmMax}</div>
        </div>
        <div class="cs-base-chip">
          <span class="cs-base-chip-label">Palier XP</span>
          <div class="cs-base-chip-val">${calcPalier(c.niveau||1)}</div>
          <div class="cs-base-chip-sub">100 × niv²</div>
        </div>
      </div>
    </div><!-- /cs-carac-panel -->

  </div><!-- /cs-top -->

  <!-- ═══ ONGLETS + CONTENU ═══ -->
  <div class="cs-right-col">
    <div class="cs-tabs" id="char-tabs">
      ${TABS.map(tab => {
        const isActive = tab.id === 'plus'
          ? isSecondaryTab
          : currentTab === tab.id;
        return `<button class="cs-tab ${isActive?'active':''}"
          onclick="${tab.id === 'plus' ? `window._toggleSecondaryTabs(this)` : `showCharTab('${tab.id}',this)`}"
          data-tab="${tab.id}">${tab.label}</button>`;
      }).join('')}
    </div>

    <!-- Sous-menu onglets secondaires -->
    <div id="cs-secondary-tabs" style="display:${isSecondaryTab?'flex':'none'};
      gap:.35rem;padding:.4rem 0 .1rem;border-bottom:1px solid var(--border);margin-bottom:.15rem">
      ${['compte','notes','maitrises'].map(tab => `
      <button class="cs-tab ${currentTab===tab?'active':''}" style="font-size:.72rem;min-height:30px;padding:.3rem .65rem"
        onclick="showCharTab('${tab}',this)">
        ${tab==='compte'?'💰 Compte':tab==='notes'?'📝 Notes':'⚔️ Maîtrises'}
      </button>`).join('')}
    </div>

    <div id="char-tab-content" class="cs-tab-body"></div>
  </div>

</div>`;

  _renderTab(currentTab, c, canEdit);

  window._toggleSecondaryTabs = (btn) => {
    const panel = document.getElementById('cs-secondary-tabs');
    const isVisible = panel.style.display !== 'none';
    panel.style.display = isVisible ? 'none' : 'flex';
    if (!isVisible && !['compte','notes','maitrises'].includes(window._currentCharTab)) {
      showCharTab('compte', document.querySelector('#cs-secondary-tabs .cs-tab'));
    }
  };
}

function _renderTab(tab, c, canEdit) {
  const area = document.getElementById('char-tab-content');
  if (!area) return;
  const renders = {
    combat:     ()=>renderCharEquip(c,canEdit),
    carac:      ()=>renderCharEquip(c,canEdit),
    sorts:      ()=>renderCharDeck(c,canEdit),
    inventaire: ()=>renderCharInventaire(c,canEdit),
    quetes:     ()=>renderCharQuetes(c,canEdit),
    compte:     ()=>renderCharCompte(c,canEdit),
    notes:      ()=>renderCharNotes(c,canEdit),
    maitrises:  ()=>renderCharMaitrises(c,canEdit),
  };
  area.innerHTML = renders[tab]?.() || '';
}

function showCharTab(tab, el) {
  const isSecondary = ['compte','notes','maitrises'].includes(tab);
  document.querySelectorAll('#char-tabs .cs-tab').forEach(t => {
    t.classList.remove('active');
    if (isSecondary && t.dataset.tab === 'plus') t.classList.add('active');
  });
  if (!isSecondary && el) el.classList.add('active');

  window._currentCharTab = tab;
  const secondary = document.getElementById('cs-secondary-tabs');
  if (secondary) secondary.style.display = isSecondary ? 'flex' : 'none';

  _renderTab(tab, window._currentChar, window._canEditChar);
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
  addInvItem, _lootPillStyle, saveInvItemFromShop,
  editInvItem, saveInvItem,

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
