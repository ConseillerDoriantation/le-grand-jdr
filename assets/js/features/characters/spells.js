import { STATE } from '../../core/state.js';
import { charSession } from '../../shared/char-session.js';
import { registerActions } from '../../core/actions.js';
import { trySave } from '../../shared/crud.js';
import { openModal, closeModal, pushModal, popModal, closeModalDirect, updateModalContent, confirmModal } from '../../shared/modal.js';
import { showNotif, notifySaveError } from '../../shared/notifications.js';
import { _esc, _nl2br, _norm } from '../../shared/html.js';
import { getMod, calcPMMax, calcDeckMax, getMaitriseBonus as getSharedMaitriseBonus } from '../../shared/char-stats.js';
import { loadDamageTypes } from '../../shared/damage-types.js';
import { loadConditionLibrary } from '../../shared/conditions.js';
import { loadSpellMatrices, suggestSpellEffect, getMatrixSuggestions } from '../../shared/spell-matrices.js';
import { getArmorSetData, getMainWeapon } from './data.js';
import { makeSortable } from '../../shared/sortable-helper.js';
import { pickImageFile } from '../../shared/image-upload.js';
import { panZoomCropHTML, attachPanZoomCrop } from '../../shared/image-crop.js';
import { setSpellCaches, setConditionsLibCache, getSpellMatricesCache, SPELL_SLOTS, _SPELL_STAT_OPTIONS, _activeCombos, _ampDispCircleSize, _ampLength, _autoSourceAfflictionDot, _autoSourceCA, _autoSourceDegats, _autoSourceDuree, _autoSourceEnchantDeg, _autoSourceSoin, _autoValHtml, _buildSortResume, _calcAfflictionDot, _calcDrainPct, _calcEnchantDegats, _calcInvocationStats, _calcLaceration, _hasLaceration, _calcSortCibles, _calcSortDegats, _calcSortDeplacement, _calcSortDuree, _calcSortSoin, _calcSortZone, _getCurrentSpellChar, _getSortAction, _getSortCA, _getSortProtectionMode, _getSortTypes, _isNoyauMagic, _needsDureeBase, _readVisibleStatOverride, _runeCounts, noyauTypesFor } from './spells-calc.js';

// ── Drag and Drop sorts ──────────────────────
let _dragSortIdx = null;
let _sortsSearch = '';
let _sortsView = 'all';
let _sortsTypeFilter = '';
let _sortsCatCollapsed = {};
let _sortsCatPanelOpen = false;   // panneau inline de gestion des catégories (remplace la modale)
let _runeCountsEdit = {};
let _sortAllowedNoyauIds = null;
let _noyauIdsEdit = [];   // noyaux élémentaires sélectionnés (multi). [0] = primaire (compat soin/suggestions/VTT).
let _sortTypesEdit = new Set(['utilitaire']);
let _deplModeEdit = null;
let _actionModeEdit = 'reaction';
let _invImageEdit = '';      // image (dataUrl) de l'invocation en cours d'édition
let _invActionsEdit = [];    // actions (mini-sorts) de l'invocation — éditées à l'étape C
let _invCrop = null;         // instance du cropper pan/zoom inline de l'image d'invocation
let _invCfgIdx = -1;         // index (deck) du sort dont on configure l'invocation
let _invOriginal = null;     // s.invocation du sort en cours d'édition (préserve sélection/legacy)
let _sortIconPickerOutsideBound = false;

export function sortDragStart(e, idx) {
  _dragSortIdx = idx;
  e.currentTarget.style.opacity = '0.4';
  e.dataTransfer.effectAllowed = 'move';
}
export function sortDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.cs-spellcard').forEach(el => {
    el.classList.remove('cs-drop-before', 'cs-drop-after');
  });
  const rect = e.currentTarget.getBoundingClientRect();
  const mid  = rect.top + rect.height / 2;
  if (e.clientY < mid) {
    e.currentTarget.classList.add('cs-drop-before');
  } else {
    e.currentTarget.classList.add('cs-drop-after');
  }
}
export function sortDragEnd(e) {
  e.currentTarget.style.opacity = '';
  document.querySelectorAll('.cs-spellcard').forEach(el => {
    el.classList.remove('cs-sort-drag-over', 'cs-drop-before', 'cs-drop-after');
  });
}
export async function sortDrop(e, toIdx) {
  e.preventDefault();
  const card = e.currentTarget;
  const rect = card.getBoundingClientRect();
  const insertAfter = e.clientY >= rect.top + rect.height / 2;
  const actualIdx   = insertAfter ? toIdx + 1 : toIdx;
  card.classList.remove('cs-sort-drag-over', 'cs-drop-before', 'cs-drop-after');
  document.querySelectorAll('.cs-spellcard').forEach(el =>
    el.classList.remove('cs-drop-before', 'cs-drop-after'));
  const fromIdx = _dragSortIdx;
  _dragSortIdx = null;
  if (fromIdx === null) return;
  const c = STATE.activeChar; if (!c) return;
  const sorts = [...(c.deck_sorts||[])];
  if (fromIdx === actualIdx || fromIdx === actualIdx - 1) return;
  const [moved] = sorts.splice(fromIdx, 1);
  const insertAt = actualIdx > fromIdx ? actualIdx - 1 : actualIdx;
  sorts.splice(insertAt, 0, moved);
  c.deck_sorts = sorts;
  await trySave('characters', c.id, {deck_sorts: sorts});
  _renderSpellsTab(c);
}



function _renderSpellsTab(c = _getCurrentSpellChar()) {
  if (!c) return;
  if (charSession.getCurrentCharTab() === 'sorts') {
    charSession.renderTab('sorts', c, charSession.getCanEditChar());
  } else {
    charSession.renderSheet(c, 'sorts');
  }
}

// ── Drag & drop des CARTES de sorts (Sortable.js), y compris ENTRE catégories ──
// Chaque grille de catégorie est une zone Sortable du même groupe → on peut
// déplacer un sort dans une autre catégorie. À la dépose, on reconstruit l'ordre
// global + la catégorie de chaque sort depuis le DOM, puis on persiste et on
// re-render (pour rafraîchir les data-sort-idx, sinon une 2ᵉ dépose serait fausse).
let _sortCardSortables = [];
export function bindSortCardsDnd(c, canEdit) {
  _sortCardSortables.forEach(s => { try { s.destroy(); } catch {} });
  _sortCardSortables = [];
  if (!canEdit) return;
  document.querySelectorAll('.cs-spellcard-grid').forEach(grid => {
    _sortCardSortables.push(makeSortable(grid, {
      prefix: 'cs',
      group: 'cs-spell-cards',
      draggable: '.cs-spellcard',
      delay: 80,
      // Le clone de drag doit rester DANS .cs-v3 (sinon le CSS scopé .cs-v3 ne
      // s'applique pas → rendu brut empilé). Donc pas de clone sur <body>.
      fallbackOnBody: false,
      onEnd: async () => {
        const wrap = document.getElementById('cs-sort-cats-wrap');
        if (!wrap) return;
        const old = c.deck_sorts || [];
        const cats = c.sort_cats || [];
        const next = [];
        let changed = false;
        wrap.querySelectorAll('.cs-spellcard-grid').forEach(g => {
          const raw = g.dataset.cat;
          // Catégorie cible : '' si bloc « Sans catégorie » ou catégorie inconnue.
          const catId = (raw && raw !== '__none' && cats.some(ct => ct.id === raw)) ? raw : '';
          g.querySelectorAll('.cs-spellcard').forEach(card => {
            const s = old[Number(card.dataset.sortIdx)];
            if (!s) return;
            if ((s.catId || '') !== catId) { next.push({ ...s, catId }); changed = true; }
            else next.push(s);
          });
        });
        // Sécurité : on ne persiste que si tous les sorts sont bien retrouvés.
        if (next.length !== old.length) { _renderSpellsTab(c); return; }
        // Ordre inchangé ET aucune recatégorisation → rien à faire.
        if (!changed && next.every((s, k) => s === old[k])) return;
        c.deck_sorts = next;
        if (STATE.activeChar?.id === c.id) STATE.activeChar = c;
        if (charSession.getCurrentChar()?.id === c.id)
          charSession.set(c, charSession.getCanEditChar(), charSession.getCurrentCharTab());
        await trySave('characters', c.id, { deck_sorts: next });
        _renderSpellsTab(c);
      },
    }));
  });
}

export function renderCharDeck(c, canEdit) {
  const allSorts = c.deck_sorts || [];
  const cats     = c.sort_cats  || [];
  const mainP    = getMainWeapon(c);
  const armeDeg  = mainP.degats;
  const openIdx  = _openSortIdx ?? null;

  const armorSet = getArmorSetData(c);
  const pmDelta  = armorSet.modifiers?.spellPmDelta || 0;

  // ── État UI persistant (filtres / recherche / pliage) ─────────────
  const search   = _norm(_sortsSearch || '');   // minuscules + sans accents
  const view     = _sortsView || 'all';          // 'all' | 'deck'
  const typeFlt  = _sortsTypeFilter || '';        // '' | 'offensif' | 'defensif' | 'soin' | 'enchantement' | 'affliction' | 'utilitaire'
  const collapsed = _sortsCatCollapsed || {};     // { catId: true } = replié

  const DEFAULT_CAT = { id: '__none', nom: 'Sans catégorie', couleur: '#4f8cff' };
  const allCats = cats.length ? [...cats, DEFAULT_CAT] : [DEFAULT_CAT];

  // Stats globales avant filtre
  const deckCount = allSorts.filter(s => s.actif).length;
  const deckMax   = calcDeckMax(c);

  // ── Application des filtres : view + search + type ───────────────
  const matchSpell = (s) => {
    if (view === 'deck' && !s.actif) return false;
    if (search) {
      const hay = _norm([
        s.nom || '', s.effet || '', s.noyau || '',
        ...(s.runes || []),
      ].join(' '));
      if (!hay.includes(search)) return false;
    }
    if (typeFlt) {
      if (typeFlt.startsWith('rune:')) {
        // Filtre par rune utilisée
        if (!_displayRunes(s.runes || []).includes(typeFlt.slice(5))) return false;
      } else {
        const types = _getSortTypes(s);
        if (typeFlt === 'offensif'   && !types.includes('offensif')) return false;
        if (typeFlt === 'defensif'   && !types.includes('defensif')) return false;
        if (typeFlt === 'utilitaire' && !(types.includes('utilitaire') && !types.includes('offensif') && !types.includes('defensif'))) return false;
      }
    }
    return true;
  };

  // ── Filtre INTELLIGENT : ne proposer que les types et runes RÉELLEMENT utilisés ──
  const usedTypes = new Set();   // 'offensif' | 'defensif' | 'utilitaire'
  const usedRunes = new Set();   // noms de runes présents dans au moins un sort
  allSorts.forEach(s => {
    const t = _getSortTypes(s);
    if (t.includes('offensif')) usedTypes.add('offensif');
    if (t.includes('defensif')) usedTypes.add('defensif');
    if (t.includes('utilitaire') && !t.includes('offensif') && !t.includes('defensif')) usedTypes.add('utilitaire');
    _displayRunes(s.runes || []).forEach(r => usedRunes.add(r));
  });
  const TYPE_META = {
    offensif:   { lbl: '⚔️ Off',  cls: 'off' },
    defensif:   { lbl: '🛡️ Soutien',  cls: 'def' },
    utilitaire: { lbl: '🔧 Util.', cls: 'util' },
  };
  // Runes ordonnées comme RUNE_META, filtrées sur celles utilisées par le perso.
  const usedRuneMetas = RUNE_META.filter(rm => usedRunes.has(rm.nom));

  const sortsByCat = {};
  allCats.forEach(cat => { sortsByCat[cat.id] = []; });
  let visibleCount = 0;
  allSorts.forEach((s, globalIdx) => {
    const catId = s.catId && cats.find(cat => cat.id === s.catId) ? s.catId : '__none';
    const ok = matchSpell(s);
    sortsByCat[catId].push({ s, globalIdx, hidden: !ok });
    if (ok) visibleCount += 1;
  });

  // ── Header sticky : recherche + compteur Deck + actions ──────────
  const deckPct  = deckMax > 0 ? Math.min(100, (deckCount / deckMax) * 100) : 0;
  const deckOver = deckCount > deckMax;
  let html = `<div class="cs-section cs-section--compact cs-sorts-v3">

    <!-- Toolbar sticky : recherche + compteur deck + actions -->
    <div class="cs-sorts-toolbar">
      <div class="cs-sorts-search-wrap">
        <span class="cs-sorts-search-ico">🔍</span>
        <input type="text" class="cs-sorts-search" id="cs-sorts-search"
          placeholder="Rechercher (nom, effet, rune)…"
          value="${_esc(_sortsSearch || '')}"
          data-input="_sortsSearchInput">
        ${search ? `<button class="cs-sorts-search-clear" data-action="_sortsSetSearch" data-val="" title="Effacer">✕</button>` : ''}
      </div>
      <div class="cs-sorts-deck ${deckOver?'is-over':''}" title="Sorts actifs / capacité du deck (INT)">
        <span class="cs-sorts-deck-lbl">Deck</span>
        <span class="cs-sorts-deck-val">${deckCount}<small>/${deckMax}</small></span>
        <span class="cs-sorts-deck-bar"><span style="width:${deckPct}%"></span></span>
      </div>
      ${STATE.isAdmin ? (() => {
        const rl = Number.isFinite(parseInt(c.maxRunes)) ? parseInt(c.maxRunes) : 1;
        return `<div class="cs-sorts-mjrunes" title="MJ : nombre de runes d'effet débloquées pour ce personnage">
          <span class="cs-sorts-mjrunes-lbl">🔮 Runes MJ</span>
          <button class="cs-sorts-mjrunes-btn" data-action="_sortsAdjRuneLimit" data-delta="-1" title="Retirer une rune débloquée"${rl<=0?' disabled':''}>−</button>
          <span class="cs-sorts-mjrunes-val">${rl}</span>
          <button class="cs-sorts-mjrunes-btn" data-action="_sortsAdjRuneLimit" data-delta="1" title="Débloquer une rune"${rl>=20?' disabled':''}>＋</button>
        </div>`;
      })() : ''}
      <div class="cs-sorts-actions">
        ${canEdit ? `<button class="btn btn-gold btn-sm" data-action="addSort" title="Créer un sort">＋ Sort</button>` : ''}
        ${canEdit ? `<button class="btn btn-outline btn-sm" data-action="openInvocationLibrary" title="Gérer mes invocations (créatures à invoquer)">🐾</button>` : ''}
        ${canEdit ? `<button class="btn btn-outline btn-sm ${_sortsCatPanelOpen?'is-active':''}" data-action="openSortCatEditor" title="Gérer les catégories">📂</button>` : ''}
        ${cats.length ? `<button class="btn btn-outline btn-sm" data-action="_sortsToggleAllCats" title="Plier/déplier toutes les catégories">⇕</button>` : ''}
      </div>
    </div>

    <!-- Filtres rapides -->
    <div class="cs-sorts-filters">
      <div class="cs-sorts-filt-grp">
        <button class="cs-sorts-chip ${view==='all'?'on':''}"  data-action="_sortsSetView" data-view="all">Tous (${allSorts.length})</button>
        <button class="cs-sorts-chip ${view==='deck'?'on':''}" data-action="_sortsSetView" data-view="deck">⚡ Deck (${deckCount})</button>
      </div>
      ${(usedTypes.size || usedRuneMetas.length) ? `<div class="cs-sorts-filt-grp">
        <button class="cs-sorts-chip type ${typeFlt===''?'on':''}" data-action="_sortsSetType" data-type="">Toutes</button>
        ${['offensif','defensif','utilitaire'].filter(t => usedTypes.has(t)).map(t => {
          const m = TYPE_META[t];
          return `<button class="cs-sorts-chip type ${m.cls} ${typeFlt===t?'on':''}" data-action="_sortsSetType" data-type="${t}">${m.lbl}</button>`;
        }).join('')}
        ${usedRuneMetas.length ? `<span class="cs-sorts-filt-sep"></span>` : ''}
        ${usedRuneMetas.map(rm => {
          const v = `rune:${rm.nom}`;
          return `<button class="cs-sorts-chip rune ${typeFlt===v?'on':''}" style="--c:${rm.color}" data-action="_sortsSetType" data-type="${v}" title="${_esc(rm.effet || rm.nom)}">${rm.icon} ${_esc(rm.nom)}</button>`;
        }).join('')}
      </div>` : ''}
    </div>

    <!-- Bandeau Set Léger (PM offset) -->
    ${pmDelta !== 0 ? `<div class="cs-sort-pm-bar">
      <span>🧙</span>
      <span class="cs-sort-pm-bar-label">Set Léger</span>
      <span class="cs-sort-pm-bar-arrow">→ coût des sorts</span>
      <span class="cs-sort-pm-bar-val">${pmDelta > 0 ? '+' : ''}${pmDelta} PM</span>
      <span class="cs-sort-pm-bar-note">(appliqué automatiquement)</span>
    </div>` : ''}`;

  // ── Panneau inline de gestion des catégories (remplace la modale) ──
  if (canEdit && _sortsCatPanelOpen) html += _renderCatManager(cats);

  // ── État vide / aucun résultat ───────────────────────────────────
  if (allSorts.length === 0) {
    html += `<div class="cs-empty">🔮 Aucun sort créé</div></div>`;
    return html;
  }
  if (visibleCount === 0) {
    html += `<div class="cs-sorts-noresult">
      <span style="font-size:1.4rem">🔎</span>
      <div>
        <div style="font-weight:700">Aucun sort ne correspond</div>
        <div style="font-size:.74rem;color:var(--text-dim);margin-top:2px">
          ${search ? `« ${_esc(search)} » ${typeFlt?' · '+typeFlt:''}${view==='deck'?' · Deck uniquement':''}` : 'Essaie un autre filtre'}
        </div>
      </div>
      <button class="btn btn-outline btn-sm" data-action="_sortsResetFilters">Réinitialiser</button>
    </div></div>`;
    return html;
  }

  // ── Liste catégorisée avec catégories repliables ─────────────────
  html += `<div class="cs-sort-cats-wrap" id="cs-sort-cats-wrap">`;
  allCats.forEach(cat => {
    const entries = sortsByCat[cat.id] || [];
    const visibleEntries = entries.filter(e => !e.hidden);
    if (!visibleEntries.length) return;
    const isDefault = cat.id === '__none';
    const isCollapsed = !!collapsed[cat.id];
    const activeInCat = visibleEntries.filter(e => e.s.actif).length;

    html += `<div class="cs-sort-cat-block ${isDefault?'is-default':''} ${isCollapsed?'is-collapsed':''}" data-cat-id="${cat.id}">`;
    if (cats.length > 0) {
      html += `<div class="cs-sort-cat-hdr" style="--cat-col:${cat.couleur}"
          data-action="_sortsToggleCat" data-id="${cat.id}">
        ${(!isDefault && canEdit) ? `<span class="cs-sort-cat-drag" title="Glisser pour réordonner" data-stop-propagation>⠿</span>` : ''}
        <span class="cs-sort-cat-chev">${isCollapsed?'▸':'▾'}</span>
        <span class="cs-sort-cat-name">${_esc(cat.nom)}</span>
        <span class="cs-sort-cat-count">${visibleEntries.length} sort${visibleEntries.length>1?'s':''} · ${activeInCat} actif${activeInCat>1?'s':''}</span>
      </div>`;
    }
    if (!isCollapsed) {
      html += `<div class="cs-spellcard-grid" data-cat="${cat.id}">`;
      visibleEntries.forEach(({ s, globalIdx: i }) => {
        html += _renderSortCard(s, i, openIdx, canEdit, armeDeg, c, pmDelta);
      });
      html += `</div>`;
    }
    html += `</div>`;  // /cat-block
  });
  html += `</div>`;  // /cats-wrap

  html += `</div>`;
  return html;
}

// ── Handlers UI (search / filtres / pliage) ─────────────────────────
function _sortsRerender() {
  _renderSpellsTab();
}
function _sortsSetSearch(v) {
  _sortsSearch = v || '';
  _sortsRerender();
  // Re-focus + caret restaurés
  requestAnimationFrame(() => {
    const el = document.getElementById('cs-sorts-search');
    if (el) {
      el.focus();
      try { el.setSelectionRange(el.value.length, el.value.length); } catch {}
    }
  });
}
function _sortsSetView(v) {
  _sortsView = (v === 'deck') ? 'deck' : 'all';
  _sortsRerender();
}
function _sortsSetType(t) {
  _sortsTypeFilter = t || '';
  _sortsRerender();
}
// MJ : règle le nombre de runes d'effet débloquées (characters.maxRunes) directement
// depuis l'onglet Sorts, sans ouvrir l'éditeur de sort.
async function _sortsAdjRuneLimit(delta) {
  if (!STATE.isAdmin) return;
  const c = _getCurrentSpellChar() || STATE.activeChar; if (!c) return;
  const cur  = parseInt(c.maxRunes);
  const base = Number.isFinite(cur) ? cur : 1;
  const next = Math.max(0, Math.min(20, base + (parseInt(delta) || 0)));
  if (next === base) return;
  c.maxRunes = next;
  if (STATE.activeChar?.id === c.id) STATE.activeChar = c;
  if (charSession.getCurrentChar()?.id === c.id)
    charSession.set(c, charSession.getCanEditChar(), charSession.getCurrentCharTab());
  if (await trySave('characters', c.id, { maxRunes: next })) {
    _renderSpellsTab(c);
    showNotif(`🔮 Runes d'effet : ${next} pour ${_esc(c.nom || 'ce perso')}`, 'success');
  }
}
function _sortsToggleCat(catId) {
  _sortsCatCollapsed = { ...(_sortsCatCollapsed || {}) };
  _sortsCatCollapsed[catId] = !_sortsCatCollapsed[catId];
  _sortsRerender();
}
function _sortsToggleAllCats() {
  const c = _getCurrentSpellChar(); if (!c) return;
  const cats = c.sort_cats || [];
  const all = [...cats.map(cat => cat.id), '__none'];
  const cur = _sortsCatCollapsed || {};
  const anyOpen = all.some(id => !cur[id]);
  const next = {};
  all.forEach(id => { next[id] = anyOpen; });   // si au moins 1 ouvert → tout plier; sinon tout déplier
  _sortsCatCollapsed = next;
  _sortsRerender();
}
function _sortsResetFilters() {
  _sortsSearch = '';
  _sortsView = 'all';
  _sortsTypeFilter = '';
  _sortsRerender();
}

function _renderSortCard(s, i, openIdx, canEdit, armeDeg, c, pmDelta = 0) {
  const isOpen   = openIdx === i;
  const runesAll = s.runes || [];
  const types    = _getSortTypes(s);
  const { action, concentration } = _getSortAction(s);
  const nbCibles = _calcSortCibles(s);
  const nbProt   = runesAll.filter(r => r === 'Protection').length;
  const nbAmp    = runesAll.filter(r => r === 'Amplification').length;

  const ACTION_CFG = {
    action:       { label:'⚡ Act.',   color:'#e8b84b' },
    action_bonus: { label:'✴️ Bonus', color:'#f97316' },
    reaction:     { label:'🔄 Réac.', color:'#a78bfa' },
  };
  const acfg = ACTION_CFG[action] || ACTION_CFG.action;

  // Modificateur de l'arme principale + maîtrise (Poings 2d4+Force si vide)
  const mainP   = getMainWeapon(c);
  const statKey = mainP.statAttaque || mainP.toucherStat || 'force';
  const statVal = (c?.stats?.[statKey] || 8) + (c?.statsBonus?.[statKey] || 0);
  const statMod = Math.floor((Math.min(22, statVal) - 10) / 2);
  const statLbl = { force:'For', dexterite:'Dex', intelligence:'Int', constitution:'Con', sagesse:'Sag', charisme:'Cha' }[statKey] || statKey.slice(0,3);
  const statModS = statMod >= 0 ? `+${statMod}` : `${statMod}`;
  const maitrise = getSharedMaitriseBonus(c, mainP || {});

  // ── Détection des modes "sans dégâts d'impact" ─────────────────────
  const hasEnchant    = runesAll.includes('Enchantement');
  const hasAffliction = runesAll.includes('Affliction');
  const enchantMode   = s.enchantMode || 'dmg';
  const afflictionMode = s.afflictionMode || 'dot';
  // Branche Lacération d'Affliction : frappe l'attaque de base + réduit la CA,
  // donc PAS de suppression d'impact ni de chip DoT/État.
  const isLaceration  = _hasLaceration(s);
  const hasAfflictionDebuff = hasAffliction && afflictionMode !== 'laceration';
  // Enchantement-only : pas de dégâts d'impact si pas de degats explicite
  const isEnchantOnly = hasEnchant && !((s.degats || '').trim());
  // Modes Toucher / Déplacement : buff pur sur allié, JAMAIS de dégâts d'impact
  // (même si un degats résiduel traîne d'un ancien mode Dégâts).
  const enchantBuffOnly = hasEnchant && (enchantMode === 'toucher' || enchantMode === 'deplacement');
  // Affliction = jamais d'impact (comme défini côté VTT)
  // Déplacement (Amplification mode déplacement) = jamais de dégâts.
  // Invocation = le sort invoque une créature (qui a ses propres dégâts) — pas d'impact du lanceur.
  const suppressImpactDmg = isEnchantOnly || enchantBuffOnly || hasAfflictionDebuff || s.ampMode === 'deplacement' || runesAll.includes('Invocation');

  // Chips clés pour la ligne compacte
  const chips = [];

  // ── 1. Dégâts d'impact (offensif, OU Lacération qui frappe toujours) ──
  if ((types.includes('offensif') || isLaceration) && !suppressImpactDmg) {
    const degBase = _calcSortDegats(s, c);
    let val = degBase;
    if (statMod !== 0) val += ` · ${statLbl}${statModS}`;
    chips.push({ icon:'⚔️', val, color:'#ff6b6b' });
  }

  // ── 2. Affliction : mode décide (DoT / État / Lacération) ──
  // Sentinelle (Affliction + Invocation) absorbe la branche → pas de chip ici.
  const isSentinelle = hasAffliction && runesAll.includes('Invocation');
  if (isSentinelle) {
    // rien : l'affliction est portée par la sentinelle (chip Invocation géré ailleurs)
  } else if (isLaceration) {
    const lac = _calcLaceration(s);
    if (lac) chips.push({ icon:'🩸', val:`CA −${Math.min(lac.reduction, lac.maxElite)}`, color:'#dc2626' });
  } else if (hasAfflictionDebuff && !new Set(_activeCombos(s).map(co => co.id)).has('regeneration')) {
    if (afflictionMode === 'etat') {
      // Mode État : on affiche TOUJOURS un chip état, jamais DoT
      const etat = s.afflictionEtatId
        ? _conditionsLibCache?.find(c2 => c2.id === s.afflictionEtatId)
        : null;
      const lbl = etat ? `${etat.icon || ''} ${etat.label}` : '⚠ État non défini';
      chips.push({ icon:'⛓', val: lbl, color:'#8b5cf6' });
    } else {
      // Mode DoT : formule scalée
      const dot = _calcAfflictionDot(s);
      chips.push({ icon:'🩸', val: `${dot}/t`, color:'#8b5cf6' });
    }
  }

  // ── 3. Enchantement : mode décide, JAMAIS de fallback dégâts en mode État ──
  if (hasEnchant) {
    if (enchantMode === 'etat') {
      const etat = s.enchantEtatId
        ? _conditionsLibCache?.find(c2 => c2.id === s.enchantEtatId)
        : null;
      const lbl = etat ? `${etat.icon || ''} ${etat.label}` : '⚠ État non défini';
      chips.push({ icon:'✨', val: lbl, color:'#e8b84b' });
    } else if (enchantMode === 'toucher' || enchantMode === 'deplacement') {
      const nbP   = runesAll.filter(r => r === 'Puissance').length;
      const bonus = Number.isFinite(parseInt(s.enchantBonus)) ? parseInt(s.enchantBonus) : (2 + nbP);
      const ic    = enchantMode === 'toucher' ? '🎯' : '👢';
      chips.push({ icon: ic, val: `+${bonus}`, color:'#e8b84b' });
    } else {
      // Mode Dégâts : formule bonus sur arme alliée
      const degAuto = _calcEnchantDegats(s);
      if (degAuto) chips.push({ icon:'✨', val: `+${degAuto}`, color:'#e8b84b' });
    }
  }

  // ── 4. Protection (CA ou Soin) ──
  if (nbProt > 0) {
    const mode = _getSortProtectionMode(s);
    const activeIds = new Set(_activeCombos(s).map(co => co.id));
    if (activeIds.has('regeneration')) {
      const dice = nbProt + runesAll.filter(r => r === 'Affliction').length;
      chips.push({ icon:'💚', val: `${(s.regenerationFormula || '').trim() || `${dice}d4`}/t`, color:'#22c38e' });
    } else if (mode === 'soin') {
      if (activeIds.has('drain')) {
        const pct = Math.round(_calcDrainPct(s) * 100);
        chips.push({ icon:'🩸', val: `Drain ${pct}%`, color:'#ff6b6b' });
      } else {
        const soinBase = _calcSortSoin(s, c);
        chips.push({ icon:'💚', val: soinBase, color:'#22c38e' });
      }
    } else {
      if (activeIds.has('bouclier_reactif')) {
        chips.push({ icon:'🛡️', val:'Bloque 1', color:'#22c38e' });
      } else {
        chips.push({ icon:'🛡️', val:_getSortCA(s), color:'#22c38e' });
      }
    }
  } else if (types.includes('defensif') && nbAmp > 0 && s.ampMode !== 'deplacement') {
    const soinBase = _calcSortSoin(s, c);
    chips.push({ icon:'💚', val: soinBase, color:'#22c38e' });
  }

  // ── 5. Cibles / zone / déplacement / durée ──
  if (nbCibles > 1) chips.push({ icon:'🎯', val:`×${nbCibles}`, color:'#4f8cff' });
  const zone  = _calcSortZone(s);
  if (zone)  chips.push({ icon:'📐', val:`${zone.w}×${zone.h}c`, color:'#b47fff' });
  const depl  = _calcSortDeplacement(s);
  if (depl) {
    const dIcon = depl.mode === 'self' ? '🏃' : depl.mode === 'pull' ? '↙' : '↗';
    const dVal  = depl.max != null ? `1–${depl.max}c` : `${depl.distance}c`;
    chips.push({ icon: dIcon, val: dVal, color:'#e8b84b' });
  }
  // Durée : affichée uniquement pour les sorts persistants
  if (_needsDureeBase(s)) {
    const duree = _calcSortDuree(s);
    if (duree) chips.push({ icon:'⏱️', val:`${duree}t`, color:'#9ca3af' });
  }

  // ── 6. Pill JS sauvegarde pour Affliction (info utile au combat) ──
  // (Pas de JS en branche Lacération : c'est une frappe + réduction de CA.)
  if (hasAfflictionDebuff) {
    const nbAff = runesAll.filter(r => r === 'Affliction').length;
    const dd = 11 + 2 * (nbAff - 1);
    chips.push({ icon:'🛡', val:`DD ${dd}`, color:'#ef4444' });
  }

  const pmVal = pmDelta !== 0
    ? `<span class="cs-sort-pm-old">${s.pm||0}</span><span class="cs-sort-pm-new">${Math.max(0,(s.pm||0)+pmDelta)}</span>`
    : `${s.pm||0}`;

  const typeCol = types.includes('offensif') ? '#ff6b6b'
                : types.includes('defensif')  ? '#22c38e'
                : '#b47fff';

  // ── Validation MJ ──
  const vs = s.mjValidation || (s.mjValidated ? 'ok' : 'pending');
  const valBadge = vs === 'ok'
    ? `<span class="cs-spellcard-val ok" title="Sort validé par le Maître du Jeu">✅ Validé</span>`
    : vs === 'no'
      ? `<span class="cs-spellcard-val no" title="Sort refusé par le Maître du Jeu">❌ Refusé</span>`
      : `<span class="cs-spellcard-val wait" title="Pas encore validé par le Maître du Jeu">⏳ À valider</span>`;

  // ── Noyaux (éléments) en petites pastilles ──
  const nts = noyauTypesFor(s);
  const noyauPills = nts.map(t =>
    `<span class="cs-spellcard-noyau" style="--c:${t.color||'#888'}" title="Noyau ${_esc(t.label)}">${t.icon || ''}</span>`
  ).join('');

  // ── Runes présentes (comptées) — affichage seul (l'édition se fait dans l'éditeur) ──
  const counts = {};
  _displayRunes(runesAll).forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  const runeMetas = RUNE_META.filter(rm => (counts[rm.nom] || 0) > 0);
  const runeChips = runeMetas.length ? `<div class="cs-spellcard-runes">
    ${runeMetas.map(rm => `<span class="cs-runechip" style="--c:${rm.color}" title="${_esc(rm.nom)} — ${_esc(rm.effet)}">${rm.icon} ${_esc(rm.nom)}${(counts[rm.nom]>1)?` ×${counts[rm.nom]}`:''}</span>`).join('')}
  </div>` : '';

  // Deck : un joueur ne peut activer que les sorts VALIDÉS (le MJ n'est pas limité).
  const canActivate = STATE.isAdmin || vs === 'ok';

  return `<article class="cs-spellcard ${s.actif?'is-actif':''} ${isOpen?'is-open':''}" style="--type-col:${typeCol}"
    data-sort-idx="${i}">

    <header class="cs-spellcard-head">
      ${canEdit
        ? `<div class="toggle ${s.actif?'on':''} ${(!canActivate && !s.actif)?'is-locked':''}" data-action="toggleSort" data-idx="${i}" data-stop-propagation title="${(!canActivate && !s.actif)?'Doit être validé par le MJ pour entrer dans le Deck':(s.actif?'Retirer du deck':'Ajouter au deck')}"></div>`
        : `<div class="toggle ${s.actif?'on':''}"></div>`}
      <span class="cs-spellcard-icon">${s.icon ? _esc(s.icon) : '✦'}</span>
      <div class="cs-spellcard-id">
        <div class="cs-spellcard-name" title="${_esc(s.nom||'Sans nom')}">${_esc(s.nom||'Sans nom')}</div>
        <div class="cs-spellcard-sub">
          <span class="cs-spellcard-act" style="--c:${acfg.color}">${acfg.label}</span>
          ${concentration ? `<span class="cs-spellcard-conc" title="Concentration">🧠</span>` : ''}
          ${noyauPills}
        </div>
      </div>
      <span class="cs-spellcard-pm" title="Coût en points de magie">${pmVal}<small>PM</small></span>
    </header>

    <div class="cs-spellcard-tags">
      ${valBadge}
      ${chips.map(ch => `<span class="cs-sort-sstat" style="--c:${ch.color}">${ch.icon} ${_esc(ch.val)}</span>`).join('')}
    </div>

    ${s.effet ? `<p class="cs-spellcard-desc ${isOpen?'is-full':''}" data-action="toggleSortDetail" data-idx="${i}" title="Cliquer pour ${isOpen?'replier':'voir le détail'}">${isOpen ? _nl2br(_esc(s.effet)) : _esc(s.effet)}</p>` : ''}

    ${s.mjNotes ? `<div class="cs-spellcard-mjnote" title="Note / restriction du Maître du Jeu">
      <span class="cs-spellcard-mjnote-ic">📌</span>
      <span class="cs-spellcard-mjnote-tx">${isOpen ? _nl2br(_esc(s.mjNotes)) : _esc(s.mjNotes)}</span>
    </div>` : ''}

    ${runeChips}

    ${isOpen ? `<div class="cs-spellcard-detail">
      <div class="cs-sort-detail-effects">
        <div class="cs-sort-detail-effects-title">📋 Effets calculés</div>
        ${_buildSortResume(s, c).map(line => `
          <div class="cs-sort-detail-effect-row">
            <span class="cs-sort-detail-icon">${line.icon}</span>
            <span class="cs-sort-detail-label">${line.label}</span>
            ${line.detail ? `<span class="cs-sort-detail-meta">${line.detail}</span>` : ''}
          </div>`).join('')}
      </div>
    </div>` : ''}

    <footer class="cs-spellcard-foot">
      <button class="cs-spellcard-detailbtn" data-action="toggleSortDetail" data-idx="${i}">${isOpen?'▲ Replier':'▼ Détails'}</button>
      ${canEdit ? `<div class="cs-spellcard-acts" data-stop-propagation>
        ${runesAll.includes('Invocation') ? `<button class="btn-icon" data-action="_openInvocationConfig" data-idx="${i}" title="Configurer l'invocation (créatures à invoquer)">🐾</button>` : ''}
        <button class="btn-icon" data-action="editSort" data-idx="${i}" title="Éditer le sort">✏️</button>
        <button class="btn-icon" data-action="deleteSort" data-idx="${i}" title="Supprimer">🗑️</button>
      </div>` : ''}
    </footer>
  </article>`;
}

// ── Catégories de sorts ───────────────────────────────────────────────────────
const _CAT_COLORS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b','#9ca3af'];

// Panneau INLINE de gestion des catégories (plus de modale). Crée / renomme /
// recolorie / supprime — la suppression NE supprime PAS les sorts (catId remis à '').
function _renderCatManager(cats = []) {
  const swatch = (col, action, idx, sel) =>
    `<button class="cs-catmgr-col ${sel?'on':''}" style="background:${col}" data-action="${action}"${idx!=null?` data-idx="${idx}"`:''} data-col="${col}" title="${sel?'Couleur actuelle':'Choisir cette couleur'}"></button>`;
  return `<div class="cs-catmgr">
    <div class="cs-catmgr-head">
      <span class="cs-catmgr-title">📂 Catégories</span>
      <span class="cs-catmgr-sub">Glisse un sort d'une catégorie à l'autre. Supprimer une catégorie ne supprime pas ses sorts.</span>
    </div>
    ${cats.length ? `<div class="cs-catmgr-list">
      ${cats.map((cat, i) => `
        <div class="cs-catmgr-row" style="--cat-col:${cat.couleur}">
          <span class="cs-catmgr-dot" style="background:${cat.couleur}"></span>
          <input class="cs-catmgr-name" value="${_esc(cat.nom)}" maxlength="40"
            data-change="_renameSortCat" data-idx="${i}" placeholder="Nom de la catégorie">
          <div class="cs-catmgr-colors">${_CAT_COLORS.map(col => swatch(col, '_recolorSortCat', i, cat.couleur === col)).join('')}</div>
          <button class="btn-icon cs-catmgr-del" data-action="_delSortCat" data-idx="${i}" title="Supprimer (les sorts sont conservés)">🗑️</button>
        </div>`).join('')}
    </div>` : `<div class="cs-catmgr-empty">Aucune catégorie pour l'instant.</div>`}
    <div class="cs-catmgr-new">
      <input class="cs-catmgr-name" id="cs-newcat-name" maxlength="40" placeholder="Nouvelle catégorie…">
      <div class="cs-catmgr-colors">${_CAT_COLORS.map(col => swatch(col, '_addSortCat', null, false)).join('')}</div>
      <span class="cs-catmgr-hint">← clique une couleur pour créer</span>
    </div>
  </div>`;
}

// Toggle du panneau inline (remplace l'ancienne modale).
export function openSortCatEditor() {
  _sortsCatPanelOpen = !_sortsCatPanelOpen;
  _renderSpellsTab();
}

async function _addSortCat(couleur) {
  const c = STATE.activeChar; if (!c) return;
  const inp = document.getElementById('cs-newcat-name');
  const nom = (inp?.value || '').trim() || 'Nouvelle catégorie';
  const cats = [...(c.sort_cats || [])];
  cats.push({ id: `cat_${Date.now()}`, nom, couleur });
  c.sort_cats = cats;
  if (await trySave('characters', c.id, { sort_cats: cats })) {
    showNotif('Catégorie créée !', 'success');
    _renderSpellsTab(c);   // _sortsCatPanelOpen reste vrai → le panneau reste ouvert
  }
}

async function _renameSortCat(idx, value) {
  const c = STATE.activeChar; if (!c) return;
  const cats = [...(c.sort_cats || [])];
  if (!cats[idx]) return;
  const nom = (value || '').trim();
  if (!nom || nom === cats[idx].nom) return;
  cats[idx] = { ...cats[idx], nom };
  c.sort_cats = cats;
  if (await trySave('characters', c.id, { sort_cats: cats })) _renderSpellsTab(c);
}

async function _recolorSortCat(idx, couleur) {
  const c = STATE.activeChar; if (!c) return;
  const cats = [...(c.sort_cats || [])];
  if (!cats[idx] || cats[idx].couleur === couleur) return;
  cats[idx] = { ...cats[idx], couleur };
  c.sort_cats = cats;
  if (await trySave('characters', c.id, { sort_cats: cats })) _renderSpellsTab(c);
}

async function _delSortCat(idx) {
  const c = STATE.activeChar; if (!c) return;
  const cats  = [...(c.sort_cats || [])];
  const cat   = cats[idx]; if (!cat) return;
  if (!await confirmModal(`Supprimer la catégorie <b>${_esc(cat.nom)}</b> ?<br><span style="color:var(--text-dim);font-size:.85em">Ses sorts sont conservés (ils repassent « Sans catégorie »).</span>`, {
    title: 'Supprimer la catégorie', confirmLabel: 'Supprimer', icon: '🗑️',
  })) return;
  // Les sorts de la catégorie sont CONSERVÉS : on remet juste leur catId à ''.
  const sorts = (c.deck_sorts || []).map(s => s.catId === cat.id ? { ...s, catId: '' } : s);
  cats.splice(idx, 1);
  c.sort_cats  = cats;
  c.deck_sorts = sorts;
  if (await trySave('characters', c.id, { sort_cats: cats, deck_sorts: sorts })) {
    showNotif('Catégorie supprimée (sorts conservés).', 'success');
    _renderSpellsTab(c);
  }
}


export function toggleSortDetail(idx) {
  _openSortIdx = _openSortIdx === idx ? null : idx;
  _renderSpellsTab();
}


// ── Éditeur de sorts ──────────────────────────────────────────────────────────
// Contexte d'édition : null = sort de perso (STATE.activeChar.deck_sorts)
// sinon { item, idx, onSave } = sort embarqué dans un item de boutique.
// saveSort() lit ce contexte pour aiguiller la sauvegarde.
let _itemEditCtx = null;

export function addSort() { _itemEditCtx = null; openSortModal(-1, {}); }
export function editSort(idx) { _itemEditCtx = null; openSortModal(idx, (STATE.activeChar?.deck_sorts||[])[idx]); }

/** Ouvre la modal de sort pour éditer une action d'objet.
 *  item   : l'objet portant les actions
 *  idx    : index dans item.actions (-1 pour ajout)
 *  onSave : callback async(item) appelé après la sauvegarde — doit persister l'item
 *  charForCalc : perso optionnel pour les calculs d'aperçu (sinon null) */
export function editItemSpell(item, idx, onSave, charForCalc = null) {
  // Le perso de calcul est porté par le contexte (_itemEditCtx.charForCalc) et
  // résolu via _modalChar() : aucune mutation de STATE.activeChar.
  _itemEditCtx = { item, idx, onSave, charForCalc };
  const action = idx >= 0 ? (item.actions || [])[idx] || {} : {};
  openSortModal(idx, action);
}

/** Perso contextuel de la modale de sort en cours d'édition.
 *  - Édition d'un sort de perso : le perso actif global.
 *  - Édition d'une action d'item (boutique) : le perso de calcul passé à
 *    editItemSpell, sinon le perso actif en repli.
 *  Source unique pour tous les calculs/preview de la modale — supprime la
 *  substitution fragile de STATE.activeChar. */
function _modalChar() {
  return _itemEditCtx?.charForCalc ?? STATE.activeChar ?? null;
}
export function addItemSpell(item, onSave, charForCalc = null) {
  return editItemSpell(item, -1, onSave, charForCalc);
}

let _openSortIdx = -1;

// ── Métadonnées des runes ────────────────────────────────────────────────────
// Centralisé pour qu'un seul endroit définisse icône, couleur, effet de base et famille
const RUNE_META = [
  { nom:'Puissance',     icon:'⚔️', color:'#ef4444', family:'puissance', effet:'+1 dé de dégâts' },
  { nom:'Protection',    icon:'💚', color:'#22c38e', family:'puissance', effet:'+1d4 soin OU +2 CA (2 tours)' },
  { nom:'Amplification', icon:'🌐', color:'#4f8cff', family:'portee',    effet:'Zone +3 cases' },
  { nom:'Dispersion',    icon:'🎯', color:'#a855f7', family:'portee',    effet:'Touche plusieurs cibles (1 → 2 → 3 → 4…)' },
  { nom:'Enchantement',  icon:'✨', color:'#e8b84b', family:'soutien',   effet:'Booste un allié · 2 tours' },
  { nom:'Affliction',    icon:'💀', color:'#8b5cf6', family:'soutien',   effet:'Élément + état sur arme ennemie · 2 tours' },
  { nom:'Invocation',    icon:'🐾', color:'#a16207', family:'soutien',   effet:'Créature liée · 10 PV, CA 10' },
  { nom:'Chance',        icon:'🍀', color:'#facc15', family:'soutien',   effet:'RC 19–20, jusqu’à 17–20 max' },
  { nom:'Durée',         icon:'⏱️', color:'#06b6d4', family:'meta',      effet:'+2 tours' },
  { nom:'Concentration', icon:'🧠', color:'#6366f1', family:'meta',      effet:'Maintien hors tour · JS Sa DD 11 si touché' },
  { nom:'Déclenchement', icon:'⚡', color:'#f97316', family:'meta',      effet:'Transforme le sort en Réaction ou Action Bonus · non cumulable' },
];

const ACTION_RUNE = 'Déclenchement';
const ACTION_MODE_LABELS = {
  reaction: 'Réaction',
  action_bonus: 'Action Bonus',
};

function _spellActionMode(s) {
  const runes = s?.runes || [];
  if (runes.includes(ACTION_RUNE) && (s?.actionMode === 'reaction' || s?.actionMode === 'action_bonus')) return s.actionMode;
  if (runes.includes('Réaction')) return 'reaction';
  if (runes.includes('Action Bonus')) return 'action_bonus';
  return 'reaction';
}

function _buildRunesFromCounts() {
  const runes = [];
  Object.entries(_runeCountsEdit || {}).forEach(([nom, cnt]) => {
    for (let i = 0; i < cnt; i++) runes.push(nom);
  });
  return runes;
}

function _displayRunes(runes = []) {
  let hasActionRune = false;
  const out = [];
  runes.forEach(r => {
    if (r === 'Réaction' || r === 'Action Bonus' || r === ACTION_RUNE) {
      if (!hasActionRune) out.push(ACTION_RUNE);
      hasActionRune = true;
      return;
    }
    out.push(r);
  });
  return out;
}

const RUNE_GROUPS = [
  { id:'puissance', title:'⚔️ Puissance brute',    desc:'Dégâts et défense' },
  { id:'portee',    title:'🎯 Portée & cibles',    desc:'Zone et nombre de cibles' },
  { id:'soutien',   title:'✨ Soutien & contrôle', desc:'Buffs, debuffs et invocations' },
  { id:'meta',      title:'⏱️ Méta',              desc:'Timing et durée' },
];

/** Décrit la contribution actuelle d'une rune en clair. */
function _runeLiveContribution(nom, counts) {
  const cnt = counts[nom] || 0;
  if (cnt === 0) return null;

  switch (nom) {
    case 'Puissance': {
      return {
        main:  `+${cnt} dé${cnt>1?'s':''} de dégâts · sur 1 cible`,
      };
    }
    case 'Protection': {
      // Contexte : lit le mode et la présence de Réaction pour adapter le label
      const protMode = (typeof document !== 'undefined'
        ? document.getElementById('s-prot-mode')?.value : null) || 'ca';
      const hasReac = (counts.Réaction || 0) > 0 || ((counts[ACTION_RUNE] || 0) > 0 && _actionModeEdit === 'reaction');
      // Combo Bouclier réactif (Réa + Prot mode CA) : pas de soin, blocage 1 attaque
      if (hasReac && protMode === 'ca') {
        const tier = cnt >= 3 ? 'Boss ou inférieur' : cnt === 2 ? 'Élite ou inférieur' : 'Mob classique';
        return {
          main:  `Combo Bouclier réactif · Bloque 1 attaque entrante · plafond ${tier}`,
        };
      }
      // Mode CA pur (sans Réaction)
      if (protMode === 'ca') {
        return {
          main:  `+${cnt*2} CA · sur 1 cible (2 tours)`,
        };
      }
      // Mode soin
      return {
        main:  `+${cnt}d4 soin · sur 1 cible`,
      };
    }
    case 'Amplification': {
      const len = _ampLength(cnt);
      const nbDisp = counts['Dispersion'] || 0;
      const size = _ampDispCircleSize(cnt, nbDisp);
      const combo  = nbDisp > 0 ? ` · combo Dispersion → ${size}×${size} cases` : '';
      return {
        main:  `Zone ${len}×1 cases${combo}`,
      };
    }
    case 'Dispersion': {
      const nbAmp = counts['Amplification'] || 0;
      if (nbAmp > 0) {
        const size = _ampDispCircleSize(nbAmp, cnt);
        return {
          main:  `Combo Amp+Disp → zone ${size}×${size} cases plaçable`,
        };
      }
      return {
        main:  `${1 + cnt} cibles différentes`,
      };
    }
    case 'Lacération': {
      const red = cnt;
      return {
        main:  `CA cible −${red} · sur 1 cible`,
      };
    }
    case 'Chance': {
      const rawRc = 20 - cnt;
      const rcLow = Math.max(17, rawRc);
      const cap = rawRc < 17 ? ' · plafond atteint' : '';
      return {
        main:  `Critique RC ${rcLow}–20 · dé de crit max${cap}`,
      };
    }
    case 'Durée': {
      const bonus = 2 * cnt;
      return {
        main:  `+${bonus} tour${bonus>1?'s':''} de durée`,
      };
    }
    case 'Enchantement':
      return {
        main:  cnt === 1 ? 'Buff sur allié · 2 tours' : `${cnt} cibles alliées · 2 tours`,
      };
    case 'Affliction':
      return {
        main:  cnt === 1 ? 'Debuff sur ennemi · 2 tours · Action · JS pour résister' : `${cnt} cibles ennemies · 2 tours`,
      };
    case 'Invocation':
      return {
        main:  `Invoque ${cnt} créature${cnt>1?'s':''} (1 par rune) — choix au lancement`,
      };
    case 'Concentration':
      return { main: 'Maintenu hors tour · JS Sa DD 11 si dégâts reçus' };
    case ACTION_RUNE:
      return { main: `Lancé en ${ACTION_MODE_LABELS[_actionModeEdit] || 'Réaction'}` };
    default:
      return { main: `×${cnt}` };
  }
}

/**
 * Rend la section runes complète :
 *   ① "Mes runes" — grosses cartes pour les runes actives, avec contrib live
 *   ② "Ajouter une rune" — picker compact par famille
 * Re-appelée après chaque incrément/décrément pour rester synchro.
 */
// Nombre max de runes d'effet débloquées pour le perso courant (défaut 1).
// Le MJ peut le débloquer par personnage (champ characters.maxRunes).
function _spellRuneLimit() {
  const n = parseInt(STATE.activeChar?.maxRunes);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

function _renderRunesSection() {
  const counts = _runeCountsEdit || {};
  const activeMetas = RUNE_META.filter(r => (counts[r.nom] || 0) > 0);
  // ── En-tête : compteur de runes d'effet vs limite du perso ──────────────
  const limit  = _spellRuneLimit();
  const total  = Object.values(counts).reduce((a, b) => a + b, 0);
  const atLimit = total >= limit;
  const limitHeader = `<div class="cs-rune-limit${total > limit ? ' over' : atLimit ? ' full' : ''}">
    <span class="cs-rune-limit-count">🔮 Runes d'effet <b>${total}</b> / ${limit}</span>
    ${STATE.isAdmin
      ? `<span class="cs-rune-limit-mj">
          <span>Débloquées (MJ)</span>
          <button type="button" class="cs-rune-btn minus" data-action="_mjAdjRuneLimit" data-delta="-1" title="Retirer une rune débloquée">−</button>
          <button type="button" class="cs-rune-btn plus"  data-action="_mjAdjRuneLimit" data-delta="1" title="Débloquer une rune">+</button>
        </span>`
      : (atLimit ? `<span class="cs-rune-limit-hint">Limite atteinte — le MJ peut en débloquer</span>` : '')}
  </div>`;

  // ① Grosses cartes des runes actives
  const activeHtml = activeMetas.length ? activeMetas.map(r => {
    const cnt = counts[r.nom];
    const contrib = _runeLiveContribution(r.nom, counts);
    return `<div class="cs-rune-active" style="--rune-c:${r.color}">
      <div class="cs-rune-active-main">
        <div class="cs-rune-active-hdr">
          <span class="cs-rune-active-icon">${r.icon}</span>
          <span class="cs-rune-active-nom">${r.nom}</span>
          <span class="cs-rune-active-x">×${cnt}</span>
        </div>
        <div class="cs-rune-active-contrib">${contrib?.main || r.effet}</div>
      </div>
      <div class="cs-rune-active-ctrl">
        <button type="button" class="cs-rune-btn minus" data-action="runeDecrement" data-nom="${r.nom}">−</button>
        <button type="button" class="cs-rune-btn plus"  data-action="runeIncrement" data-nom="${r.nom}">+</button>
      </div>
    </div>`;
  }).join('') : `<div class="cs-rune-active-empty">
    <span class="cs-rune-active-empty-icon">🔮</span>
    <span>Aucune rune sélectionnée. Choisis ci-dessous pour façonner ton sort.</span>
  </div>`;

  // ② Picker compact — n'affiche QUE les runes pas encore actives
  // (les actives sont gérées via leurs cartes en haut, plus de doublon = plus d'ambiguïté)
  const pickerGroups = RUNE_GROUPS.map(g => {
    const runesInGroup = RUNE_META.filter(r => r.family === g.id && !((counts[r.nom] || 0) > 0));
    if (runesInGroup.length === 0) return ''; // groupe vide = caché
    return `<div class="cs-rune-pick-group">
      <div class="cs-rune-pick-group-title">${g.title} <span>${g.desc}</span></div>
      <div class="cs-rune-pick-list">
        ${runesInGroup.map(r => `
          <button type="button" class="cs-rune-pick-item"
            style="--rune-c:${r.color}" data-action="runeIncrement" data-nom="${r.nom}"
            data-tip="${r.effet}" aria-label="Ajouter ${r.nom} — ${r.effet}">
            <span class="cs-rune-pick-icon">${r.icon}</span>
            <span class="cs-rune-pick-nom">${r.nom}</span>
            <span class="cs-rune-pick-add" aria-hidden="true">+</span>
          </button>
        `).join('')}
      </div>
    </div>`;
  }).filter(Boolean).join('');

  const pickerEmpty = pickerGroups === '';
  const pickerHtml = pickerEmpty
    ? `<div class="cs-runes-picker-empty">✓ Toutes les runes sont actives — utilise les boutons + sur les cartes ci-dessus pour empiler une même rune.</div>`
    : pickerGroups;

  // Joueur ayant atteint sa limite → on verrouille l'ajout (le MJ n'est jamais bloqué)
  const locked = atLimit && !STATE.isAdmin;
  return `
    ${limitHeader}
    <div class="cs-runes-block${locked ? ' cs-runes-locked' : ''}">
      <div class="cs-runes-active-list">${activeHtml}</div>
      <div class="cs-runes-picker">
        <div class="cs-runes-picker-hdr">+ Ajouter une rune <span>(les runes actives sont gérées via les cartes au-dessus)</span></div>
        ${pickerHtml}
      </div>
    </div>
  `;
}

export async function openSortModal(idx, s) {
  const [allTypes, matrices] = await Promise.all([loadDamageTypes(), loadSpellMatrices()]);
  // Caches globaux utilisés par _getSortCA, _calcSortSoin, suggestions...
  setSpellCaches(matrices, allTypes);
  // Tous les types de dégâts restent la source globale des noyaux.
  // L'accès joueur aux noyaux magiques est ensuite filtré par personnage (c.elements).
  const RUNES = RUNE_META; // alias local pour compat ascendante

  const runesSrc = s?.runes||[];
  const runeCounts = {};
  _actionModeEdit = _spellActionMode(s);
  runesSrc.forEach(r => {
    const nom = (r === 'Réaction' || r === 'Action Bonus') ? ACTION_RUNE : r;
    runeCounts[nom] = (runeCounts[nom] || 0) + 1;
  });
  if (runeCounts[ACTION_RUNE] > 1) runeCounts[ACTION_RUNE] = 1;
  _runeCountsEdit = { ...runeCounts };

  // Noyau : id de type (nouveau) ou migration depuis label (ancien)
  let noyauTypeIdSel = s?.noyauTypeId || '';
  if (!noyauTypeIdSel && s?.noyau) {
    // Migration : chercher par label ou par label partiel (ex: 'Feu 🔥' → 'feu')
    const legacy = allTypes.find(n =>
      n.label === s.noyau ||
      s.noyau.toLowerCase().startsWith(n.label.toLowerCase())
    );
    noyauTypeIdSel = legacy?.id || '';
  }
  const charForAccess = _modalChar();
  const charElements  = new Set(charForAccess?.elements || []);
  const canUseAllNoyaux = STATE.isAdmin || !charForAccess;
  const allowedNoyaux = canUseAllNoyaux
    ? [...allTypes]
    : allTypes.filter(n => !n.isMagic || charElements.has(n.id));
  const selectedNoyau = noyauTypeIdSel ? allTypes.find(n => n.id === noyauTypeIdSel) : null;
  const selectedLocked = selectedNoyau && !allowedNoyaux.some(n => n.id === selectedNoyau.id);
  const NOYAUX = selectedLocked
    ? [...allowedNoyaux, { ...selectedNoyau, locked: true }]
    : allowedNoyaux;
  _sortAllowedNoyauIds = new Set(allowedNoyaux.map(n => n.id));
  // Multi-noyau : liste ordonnée des éléments sélectionnés ([0] = primaire).
  // Migration : noyauTypeIds (nouveau) → sinon le noyau unique migré ci-dessus.
  _noyauIdsEdit = Array.isArray(s?.noyauTypeIds) && s.noyauTypeIds.length
    ? s.noyauTypeIds.filter(Boolean)
    : (noyauTypeIdSel ? [noyauTypeIdSel] : []);

  const noyauSel      = noyauTypeIdSel
    ? (selectedNoyau?.label || s?.noyau || '')
    : (s?.noyau || '');
  // Pas de type par défaut sur un sort nouveau — l'utilisateur choisit. Compat legacy uniquement.
  const typesInit = Array.isArray(s?.types) ? s.types
    : (s?.typeSoin ? ['defensif'] : (s?.noyau ? ['offensif'] : []));

  _sortTypesEdit  = new Set(typesInit);
  _deplModeEdit   = s?.deplacement?.mode || (s?.ampMode === 'deplacement' ? 'self' : null);
  _invImageEdit   = s?.invocation?.image || '';
  _invActionsEdit = Array.isArray(s?.invocation?.actions) ? s.invocation.actions.map(a => ({ ...a })) : [];
  _invOriginal    = (s?.invocation && typeof s.invocation === 'object') ? s.invocation : null;

  const hasEnchant  = runesSrc.includes('Enchantement');
  const hasProt     = runesSrc.includes('Protection');
  const hasInvoc    = runesSrc.includes('Invocation') && !runesSrc.includes('Affliction') && !hasEnchant;
  const ivStats     = s?.invocation?.stats || {};                  // overrides sauvegardés
  const ivDerived   = _calcInvocationStats({ runes: runesSrc });   // valeurs dérivées (placeholders)
  const enchantModeForEdit = 'etat';
  const enchantEtatForEdit = s?.enchantEtatId
    || ((s?.enchantMode || 'etat') === 'dmg' ? 'empowered'
      : (s?.enchantMode === 'deplacement' ? 'swift'
        : (s?.enchantMode === 'toucher' ? 'guided' : '')));

  // Le rendu réel des runes est fait par _renderRunesSection (module-level),
  // appelé au mount et après chaque incrément/décrément pour rester synchro.
  const runesSectionHtml = _renderRunesSection();

  const TYPE_CFG = [
    { v:'offensif',   label:'⚔️ Offensif',   color:'#ff6b6b' },
    { v:'defensif',   label:'🛡️ Soutien',   color:'#22c38e' },
    { v:'utilitaire', label:'✨ Utilitaire', color:'#b47fff' },
  ];
  const typeBtnsHtml = TYPE_CFG.map(t => {
    const isSel = typesInit.includes(t.v);
    return `<button type="button" id="s-type-${t.v}"
      data-action="_toggleSortType" data-type="${t.v}"
      style="flex:1;padding:.4rem .3rem;border-radius:8px;font-size:.75rem;cursor:pointer;
      border:2px solid ${isSel?t.color:'var(--border)'};
      background:${isSel?t.color+'20':'var(--bg-elevated)'};
      color:${isSel?t.color:'var(--text-dim)'};
      font-weight:${isSel?'700':'400'};transition:all .15s">${t.label}</button>`;
  }).join('');

  // Amplification : mode Zone | Déplacement (calqué sur Protection soin/CA)
  const hasAmp   = runesSrc.includes('Amplification');
  const nbAmp    = runesSrc.filter(r => r === 'Amplification').length;
  const ampMode  = s?.ampMode || 'zone';
  const hasDisp  = runesSrc.includes('Dispersion');
  const isAllongeCombo = hasEnchant && hasAmp && !hasDisp;
  const hasActionRune = (_runeCountsEdit[ACTION_RUNE] || 0) > 0;
  const actionMode = _actionModeEdit || 'reaction';
  const actionModeBtnsHtml = [
    { v:'reaction', label:'🔄 Réaction', col:'#ec4899', detail:'Hors de son tour' },
    { v:'action_bonus', label:'✴️ Action Bonus', col:'#f97316', detail:'Action Bonus du tour' },
  ].map(opt => {
    const sel = actionMode === opt.v;
    return `<button type="button" id="s-action-mode-${opt.v}"
      data-action="_selectActionMode" data-val="${opt.v}"
      style="flex:1;padding:.42rem .35rem;border-radius:8px;cursor:pointer;transition:all .15s;
      border:2px solid ${sel?opt.col:'var(--border)'};
      background:${sel?opt.col+'18':'var(--bg-elevated)'};text-align:center">
      <div style="font-size:.76rem;font-weight:700;color:${sel?opt.col:'var(--text-dim)'}">${opt.label}</div>
      <div style="font-size:.64rem;color:var(--text-dim);margin-top:.08rem">${opt.detail}</div>
    </button>`;
  }).join('');
  // Sous-modes de déplacement (Soi / Pousser / Attirer)
  const deplCur = s?.deplacement?.mode || 'self';
  const deplBtnsHtml = [
    { v:'self', label:'🏃 Soi',     col:'#22c38e' },
    { v:'push', label:'↗ Pousser',  col:'#e8b84b' },
    { v:'pull', label:'↙ Attirer',  col:'#4f8cff' },
  ].map(opt => {
    const sel = deplCur === opt.v;
    return `<button type="button" id="s-depl-${opt.v}"
      data-action="_selectDeplMode" data-val="${opt.v}"
      style="flex:1;padding:.3rem .2rem;border-radius:7px;font-size:.72rem;cursor:pointer;transition:all .15s;
        border:2px solid ${sel?opt.col:'var(--border)'};
        background:${sel?opt.col+'20':'var(--bg-elevated)'};
        color:${sel?opt.col:'var(--text-dim)'};
        font-weight:${sel?'700':'400'}">${opt.label}</button>`;
  }).join('');

  // Si on édite une action d'item, on EMPILE la modal sur la modal du shop
  // (pushModal) pour pouvoir la restaurer après. Sinon openModal classique.
  const _modalOpen = _itemEditCtx ? pushModal : openModal;
  _modalOpen('', `
   <div class="sh-admin-modal is-spell">
    <div class="sh-admin-head">
      <div class="sh-admin-head-ico">${idx>=0?'✏️':'✨'}</div>
      <div class="sh-admin-head-title">
        <h2>${idx>=0?'Modifier le sort':'Nouveau sort'}</h2>
        <small>Construis le sort étape par étape : identité, noyau, runes, puis réglages.</small>
      </div>
      <button class="sh-admin-close" data-action="closeModalDirect" title="Fermer">✕</button>
    </div>
    <div class="sh-admin-body">
     <div class="cs-spell-forge">
    <!-- ① Essentiel : tout ce qui identifie le sort avant la mécanique -->
    <section class="cs-spell-card cs-spell-card--identity" aria-label="Essentiel du sort">
      <div class="cs-spell-card-head"><span>1</span><div><b>Essentiel</b><small>Nom, catégorie et intention du sort.</small></div></div>
      <div class="cs-spell-identity">
        <div class="cs-spell-identity-field"><label>Icône</label>
          <button type="button" id="s-icon-btn" class="cs-spell-icon-btn"
            data-action="_toggleSortIconPicker"
            title="Cliquer pour choisir une icône">${s?.icon || '🔮'}</button>
          <input type="hidden" id="s-icon" value="${s?.icon||''}">
          <div id="s-icon-picker" class="cs-spell-icon-picker" style="display:none"></div>
        </div>
        <div class="cs-spell-identity-field cs-spell-identity-field--name"><label>Nom du sort</label>
          <input class="input-field" id="s-nom" value="${s?.nom||''}" placeholder="Boule de feu, Vague de soin…">
        </div>
        <div class="cs-spell-identity-field"><label>Catégorie</label>
          <select class="input-field" id="s-catid">
            <option value="">— Aucune —</option>
            ${(_modalChar()?.sort_cats||[]).map(cat =>
              `<option value="${cat.id}" ${s?.catId===cat.id?'selected':''}>${cat.nom}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div class="cs-spell-inline-row cs-spell-type-row">
        <span class="cs-spell-inline-label" title="Optionnel · plusieurs possibles · cliquer pour activer/désactiver">Type</span>
        <div class="cs-spell-type-buttons">${typeBtnsHtml}</div>
      </div>
      <div class="form-group cs-spell-desc">
        <label>Description / effet libre <span>narration, conditions spéciales, fluff</span></label>
        <textarea class="input-field" id="s-effet" rows="2" placeholder="Décris brièvement le sort, son apparence, ses conditions particulières…">${s?.effet||''}</textarea>
      </div>
    </section>

   <!-- Atelier principal : construction à gauche, résumé et réglages à droite -->
   <div class="cs-spell-layout">
    <main class="cs-spell-main">

    <!-- ③ Noyau — section visuelle dédiée -->
    <div class="cs-spell-section cs-spell-section--noyau">
      <div class="cs-spell-section-title"><span class="cs-step-pill">2</span> Rune noyau <span class="cs-spell-section-hint">obligatoire · 2 PM · un ou plusieurs éléments</span></div>
      <div class="cs-noyau-grid" id="noyau-grid">
        ${NOYAUX.length ? NOYAUX.map(n => {
          const selected = _noyauIdsEdit.includes(n.id);
          const locked = !!n.locked;
          const selectedStyle = selected ? `border-color:${n.color};background:${n.color}20;color:${n.color}` : '';
          const attrs = locked
            ? `title="Ce noyau n'est plus accessible à ce personnage" aria-disabled="true"`
            : `data-action="selectNoyau" data-noyau-label="${_esc(n.label+' '+n.icon)}" data-noyau-color="${n.color}" title="Choisir ${n.label}"`;
          const lockedBadge = locked ? '<span class="cs-noyau-lock">non accessible</span>' : '';
          return `<div class="cs-noyau-btn ${selected?'selected':''}${locked?' cs-noyau-btn--locked':''}" style="${selectedStyle}" ${attrs} data-noyau-id="${n.id}">${n.icon} ${n.label}${lockedBadge}</div>`;
        }).join('') : '<div class="cs-noyau-empty">Aucun noyau accessible. Demande au MJ de débloquer un élément sur ta fiche.</div>'}
      </div>
      <input type="hidden" id="s-noyau" value="${noyauSel}">
      <input type="hidden" id="s-noyau-id" value="${noyauTypeIdSel}">
      <div id="s-noyau-error" class="cs-spell-field-error" hidden>Sélectionne une rune noyau pour enregistrer ce sort.</div>
    </div>

    <!-- ④ Runes — Forge -->
    <div class="cs-spell-section cs-spell-section--runes">
      <div class="cs-spell-section-title"><span class="cs-step-pill">3</span> Runes d’effet <span class="cs-spell-section-hint">+2 PM par rune · cumulables</span></div>
      <div id="cs-runes-section">${runesSectionHtml}</div>
    </div>

    <!-- ④ Effets générés par les choix précédents -->
    <section class="cs-spell-effects-panel" aria-label="Effets générés par le sort">
      <div class="cs-spell-effects-title"><span class="cs-step-pill">4</span><div><b>Effets actifs</b><small>Les options apparaissent uniquement quand les runes ou types concernés sont présents.</small></div></div>

    <!-- Dégâts — visible si type offensif (auto-val avec toggle Custom) ;
         masqué quand Affliction est présente (la Puissance scale le DoT à la place) -->
    <div id="s-degats-section" style="${(typesInit.includes('offensif') && !runesSrc.includes('Affliction') && ampMode !== 'deplacement')?'':'display:none'}">
      ${_autoValHtml({
        fieldId: 's-degats',
        label: '⚔️ Dégâts',
        autoValue:  _calcSortDegats(s || {}, _modalChar()),
        autoSource: _autoSourceDegats(s || {}, _modalChar()),
        currentValue: s?.degats,
        placeholder: 'ex : 3d8 +2, 2d10 Feu… (vide = formule auto)',
        // Mode Custom : la formule ET les stats sont éditables ensemble.
        extraEdit: {
          hasOverride: !!(s?.toucherStat || s?.degatsStat),
          html: `
            <div class="cs-spell-stats-grid">
              <div>
                <span class="cs-spell-stats-tag">🎯 Toucher</span>
                <select class="input-field" id="s-toucher-stat">
                  ${_SPELL_STAT_OPTIONS(s?.toucherStat)}
                </select>
              </div>
              <div>
                <span class="cs-spell-stats-tag">⚔️ Dégâts</span>
                <select class="input-field" id="s-degats-stat" data-change="_refreshAutoValChips">
                  ${_SPELL_STAT_OPTIONS(s?.degatsStat)}
                </select>
              </div>
            </div>`,
        },
      })}
    </div>

    <!-- Protection — visible si rune Protection > 0 -->
    <div id="s-prot-section" style="${hasProt?'':'display:none'}">
      <!-- Combo Drain (sort offensif + Protection) : la Protection devient un vol
           de vie %, le choix CA/Soin et le montant n'ont plus de sens → masqués. -->
      <div id="s-prot-drain" style="display:none" class="cs-prot-drain">
        🩸 <b>Vol de vie</b> — soigne le lanceur de <b><span id="s-prot-drain-pct">50</span>%</b> des dégâts infligés
        <span class="cs-prot-drain-sub">% fixé par Protection · capé par la frappe de base hors Puissance</span>
      </div>
      <div class="form-group" id="s-prot-mode-group">
        <label>Rune Protection — effet</label>
        <div style="display:flex;gap:.4rem">
          ${[
            { v:'ca',   label:'🛡️ Augmente la CA', color:'#22c38e', detail:'+2 CA · 2 tours' },
            { v:'soin', label:'💚 Soigne',           color:'#4f8cff', detail:'+1d4 par rune'  },
          ].map(opt => {
            const sel = (s?.protectionMode || 'ca') === opt.v;
            return `<button type="button" id="s-prot-${opt.v}" data-action="_selectProtMode" data-val="${opt.v}"
              style="flex:1;padding:.45rem .4rem;border-radius:8px;cursor:pointer;transition:all .15s;
              border:2px solid ${sel?opt.color:'var(--border)'};
              background:${sel?opt.color+'18':'var(--bg-elevated)'};text-align:center">
              <div style="font-size:.78rem;font-weight:700;color:${sel?opt.color:'var(--text-dim)'}">${opt.label}</div>
              <div style="font-size:.65rem;color:var(--text-dim);margin-top:.08rem">${opt.detail}</div>
            </button>`;
          }).join('')}
        </div>
        <input type="hidden" id="s-prot-mode" value="${s?.protectionMode||'ca'}">
      </div>
      <div id="s-ca-section" style="${(s?.protectionMode||'ca')==='ca'?'':'display:none'}">
        ${_autoValHtml({
          fieldId: 's-ca',
          label: '🛡️ Effet CA',
          autoValue:  _getSortCA(s || {}),
          autoSource: _autoSourceCA(s || {}),
          currentValue: s?.ca,
          placeholder: 'ex : CA +3, Bouclier magique +2…',
        })}
      </div>
    </div>

    <!-- Soin — visible si Protection en mode soin, ou Soutien + Amplification.
         Si le sort est aussi Offensif, on n'expose PAS le sélecteur de stat ici (déjà dans Dégâts). -->
    <div id="s-soin-section" style="${((hasProt && (s?.protectionMode||'ca')==='soin') || (typesInit.includes('defensif') && hasAmp && ampMode !== 'deplacement'))?'':'display:none'}">
      ${_autoValHtml({
        fieldId: 's-soin',
        label: '💚 Soin',
        autoValue:  _calcSortSoin(s || {}, _modalChar()),
        autoSource: _autoSourceSoin(s || {}, _modalChar()),
        currentValue: s?.soin,
        placeholder: 'ex : 3d6 +2, moitié des dégâts… (vide = formule auto)',
        extraEdit: typesInit.includes('offensif') ? null : {
          hasOverride: !!s?.degatsStat,
          html: `
            <div class="cs-spell-stats-grid one">
              <div>
                <span class="cs-spell-stats-tag">💚 Stat de soin</span>
                <select class="input-field" id="s-degats-stat-soin" data-change="_refreshAutoValChips">
                  ${_SPELL_STAT_OPTIONS(s?.degatsStat)}
                </select>
              </div>
            </div>`,
        },
      })}
    </div>

    <div id="s-regeneration-section" class="cs-spell-slot-box cs-spell-slot-box--def" style="display:none">
      <div class="cs-spell-slot-title">💚 Régénération <span>Protection + Affliction · soin sur la durée</span></div>
      ${_autoValHtml({
        fieldId: 's-regeneration-formula',
        label: '💚 HoT',
        autoValue: '',
        autoSource: 'Protection + Affliction',
        currentValue: s?.regenerationFormula,
        placeholder: 'ex : 2d4, 3d4...',
      })}
    </div>

    <div id="s-allonge-section" class="cs-spell-slot-box cs-spell-slot-box--ench" style="${isAllongeCombo?'':'display:none'}">
      <div class="cs-spell-slot-title">🏹 Allonge magique <span>Amplification + Enchantement · buff de portée</span></div>
      <div style="font-size:.82rem;line-height:1.5;color:var(--text-muted);background:rgba(79,140,255,.1);border:1px solid rgba(79,140,255,.28);border-radius:8px;padding:.65rem .75rem">
        L'arme enchantée gagne <strong style="color:#4f8cff">+<span id="s-allonge-range">${_ampLength(nbAmp)}</span> case<span id="s-allonge-range-plural">${_ampLength(nbAmp) > 1 ? 's' : ''}</span> de portée</strong> pendant la durée du sort.
        <span style="display:block;margin-top:.2rem;color:var(--text-dim)">Les modes Enchantement et Amplification sont absorbés par ce combo.</span>
      </div>
    </div>

    <!-- Enchantement — visible si rune Enchantement > 0 -->
    <div id="s-enchant-section" class="cs-spell-slot-box cs-spell-slot-box--ench" style="${hasEnchant && !isAllongeCombo?'':'display:none'}">
      <div class="cs-spell-slot-title">✨ Enchantement <span>Cible alliée · 2 tours</span></div>

      <input type="hidden" id="s-enchant-mode" value="${enchantModeForEdit}">

      <!-- Mode État : applique un état choisi à l'allié ciblé -->
      <div id="s-enchant-etat-block" class="form-group">
        <label>État appliqué à l'allié <span style="color:var(--text-dim);font-weight:400;font-size:.7rem">— buff/bénédiction ; durée selon l'état</span></label>
        <select class="input-field" id="s-enchant-etat">
          <option value="">— Aucun (effet libre uniquement) —</option>
        </select>
        <input type="hidden" id="s-enchant-etat-saved" value="${enchantEtatForEdit}">
        <div id="s-enchant-state-tuning" style="display:none;margin-top:.55rem">
          <div id="s-enchant-move-tune" style="display:none">
            ${_autoValHtml({
              fieldId: 's-enchant-state-move-bonus',
              label: '💨 Déplacement naturel',
              autoValue: '',
              autoSource: 'État + Amplification',
              currentValue: s?.enchantStateMoveBonus,
              placeholder: 'ex : 1, 2, 3...',
            })}
          </div>
          <div id="s-enchant-dmg-tune" style="display:none;margin-top:.45rem">
            ${_autoValHtml({
              fieldId: 's-enchant-state-dmg-formula',
              label: '✨ Dégâts naturels',
              autoValue: '',
              autoSource: 'État + Puissance',
              currentValue: s?.enchantStateDmgFormula,
              placeholder: 'ex : 1d4 +2, 2d4 +2...',
            })}
          </div>
        </div>
      </div>
    </div>

    <!-- Affliction — visible si rune Affliction > 0 -->
    <div id="s-affliction-section" class="cs-spell-slot-box cs-spell-slot-box--aff" style="${runesSrc.includes('Affliction')?'':'display:none'}">
      <div class="cs-spell-slot-title">💀 Affliction <span>Cible ennemie · 2 tours · Action · effet selon la branche</span></div>

      <!-- Combo Sentinelle (Affliction + Invocation) : les branches ne s'appliquent pas -->
      <div id="s-affliction-sentinelle-note" style="${runesSrc.includes('Invocation')?'':'display:none'};font-size:.78rem;line-height:1.5;color:var(--text-muted);background:rgba(161,98,7,.1);border:1px solid rgba(161,98,7,.3);border-radius:8px;padding:.55rem .7rem">
        🪤 <strong style="color:#d9a441">Sentinelle</strong> — Affliction + Invocation : l'affliction est <strong>portée par la sentinelle invoquée</strong>. Les branches (DoT / État / Lacération) ne s'appliquent pas ici.
      </div>

      <!-- Branches d'Affliction — masquées quand c'est une Sentinelle -->
      <div id="s-affliction-modes" style="${runesSrc.includes('Invocation')?'display:none':''}">

      <!-- Mode toggle : DoT (dégâts/tour) · État · Lacération (CA cible + frappe) -->
      <div class="form-group">
        <label>Branche</label>
        <div class="cs-slot-grid" style="grid-template-columns:1fr 1fr 1fr">
          <button type="button" id="s-affliction-mode-dot"
            data-action="_selectAfflictionMode" data-val="dot"
            class="cs-slot-btn ${(s?.afflictionMode||'dot')==='dot'?'selected':''}">🩸 DoT</button>
          <button type="button" id="s-affliction-mode-etat"
            data-action="_selectAfflictionMode" data-val="etat"
            class="cs-slot-btn ${s?.afflictionMode==='etat'?'selected':''}">⛓ État</button>
          <button type="button" id="s-affliction-mode-laceration"
            data-action="_selectAfflictionMode" data-val="laceration"
            class="cs-slot-btn ${s?.afflictionMode==='laceration'?'selected':''}">🩸 Lacération</button>
        </div>
        <input type="hidden" id="s-affliction-mode" value="${s?.afflictionMode||'dot'}">
      </div>

      <!-- Slot legacy conservé en hidden pour rétro-compat des sorts existants -->
      <input type="hidden" id="s-affliction-slot" value="${s?.afflictionSlot||'torse'}">
      <input type="hidden" id="s-affliction-save-stat" value="${s?.afflictionSaveStat||''}">

      <!-- DoT mode : formule de dégâts par tour (auto + custom override) -->
      <div id="s-affliction-dot-block" style="${(s?.afflictionMode||'dot')==='dot'?'':'display:none'}">
        ${_autoValHtml({
          fieldId: 's-affliction-dot-formula',
          label: '⚔️ Dégâts du DoT par tour',
          autoValue:  _calcAfflictionDot(s || {}),
          autoSource: _autoSourceAfflictionDot(s || {}),
          currentValue: s?.afflictionDotFormula,
          placeholder: 'ex : 1d4 +2, 3d6, 2d8 +4…',
        })}
      </div>

      <!-- État mode : liste déroulante -->
      <div id="s-affliction-etat-block" class="form-group" style="${s?.afflictionMode==='etat'?'':'display:none'}">
        <label>État infligé sur échec <span style="color:var(--text-dim);font-weight:400;font-size:.7rem">— appliqué avec sa durée par défaut</span></label>
        <select class="input-field" id="s-affliction-etat">
          <option value="">— Aucun (effet libre uniquement) —</option>
        </select>
        <input type="hidden" id="s-affliction-etat-saved" value="${s?.afflictionEtatId||''}">
      </div>

      <!-- Lacération mode : frappe l'attaque de base + réduit la CA de la cible -->
      <div id="s-affliction-laceration-block" style="${s?.afflictionMode==='laceration'?'':'display:none'};font-size:.78rem;line-height:1.5;color:var(--text-muted);background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.22);border-radius:8px;padding:.55rem .7rem;margin-top:.4rem">
        🩸 <strong style="color:#f87171">Lacération</strong> — le sort inflige <strong>l'attaque de base</strong> et réduit la <strong>CA de la cible de −1 par rune Affliction</strong>, plafonné à <strong>−2</strong> (joueur) / <strong>−4</strong> (Élite-Boss), pendant 2 tours. Pas de DoT ni d'état.
      </div>
      </div><!-- /s-affliction-modes -->
    </div><!-- /s-affliction-section -->

    <!-- Rune Déclenchement — mode Réaction ou Action Bonus -->
    <div id="s-action-rune-section" style="${hasActionRune?'':'display:none'}">
      <div class="form-group">
        <label>⚡ Rune Déclenchement — timing</label>
        <div style="display:flex;gap:.4rem">${actionModeBtnsHtml}</div>
        <input type="hidden" id="s-action-mode" value="${actionMode}">
        <div style="font-size:.72rem;color:var(--text-dim);padding:.35rem .1rem 0">
          Les combos de Réaction se déclenchent uniquement avec le mode <b>Réaction</b>.
        </div>
      </div>
    </div>

    <!-- ⑨ Rune Amplification — mode Zone ou Déplacement (visible si rune présente) -->
    <div id="s-amp-section" style="${hasAmp && !isAllongeCombo?'':'display:none'}">
      <div class="form-group">
        <label>🌐 Rune Amplification — effet</label>
        <div style="display:flex;gap:.4rem">
          ${[
            { v:'zone',        label:'📐 Zone',        color:'#b47fff', detail:'Zone alignée · 3N cases' },
            { v:'deplacement', label:'↔ Déplacement', color:'#e8b84b', detail:'Soi/cible · sans dégâts' },
          ].map(opt => {
            const sel = ampMode === opt.v;
            return `<button type="button" id="s-amp-${opt.v}" data-action="_selectAmpMode" data-val="${opt.v}"
              style="flex:1;padding:.45rem .4rem;border-radius:8px;cursor:pointer;transition:all .15s;
              border:2px solid ${sel?opt.color:'var(--border)'};
              background:${sel?opt.color+'18':'var(--bg-elevated)'};text-align:center">
              <div style="font-size:.78rem;font-weight:700;color:${sel?opt.color:'var(--text-dim)'}">${opt.label}</div>
              <div style="font-size:.65rem;color:var(--text-dim);margin-top:.08rem">${opt.detail}</div>
            </button>`;
          }).join('')}
        </div>
        <input type="hidden" id="s-amp-mode" value="${ampMode}">
      </div>

      <div id="s-amp-zone-section" style="${ampMode==='zone'?'':'display:none'}">
        <div style="font-size:.74rem;color:var(--text-dim);padding:.1rem .1rem .3rem">
          📐 Zone calculée depuis les runes (longueur 3N cases, largeur via Dispersion).
        </div>
      </div>

      <div id="s-amp-depl-section" style="${ampMode==='deplacement'?'':'display:none'}">
        <div class="cs-spell-inline-row">
          <span class="cs-spell-inline-label">↔️ Type</span>
          <div style="display:flex;gap:.25rem;flex:1">${deplBtnsHtml}</div>
        </div>
        <div style="font-size:.74rem;color:var(--text-dim);padding:.25rem .1rem">
          Portée : <b id="s-amp-depl-range" style="color:var(--text)">1 à ${_ampLength(nbAmp) || 0} cases</b>
          <span> · selon le nombre de runes Amplification</span>
        </div>
        <div style="font-size:.7rem;color:#e8b84b;padding:0 .1rem .2rem">⚠ Les sorts de déplacement n'infligent pas de dégâts.</div>
      </div>
    </div>

    <!-- Invocation : choix d'invocations de la BIBLIOTHÈQUE (stats/actions créées à l'avance) -->
    <div id="s-invocation-section" class="cs-inv-section" style="${hasInvoc?'':'display:none'}">
      <div class="cs-inv-head">
        <span class="cs-inv-head-icon">🐾</span>
        <div class="cs-inv-head-text">
          <div class="cs-inv-head-title">Invocations</div>
          <div class="cs-inv-head-sub">Crée tes créatures dans la bibliothèque, puis choisis lesquelles ce sort invoque (1 par rune Invocation) via le bouton 🐾 sur la carte du sort.</div>
        </div>
      </div>
      <div class="cs-inv-pick-row">
        <button type="button" class="btn btn-outline btn-sm" data-action="openInvocationLibrary">🐾 Mes invocations</button>
        <span class="cs-inv-pick-note">${(_invOriginal?.ids?.length) ? `${_invOriginal.ids.length} sélectionnée(s)` : (_invOriginal?.stats ? 'Invocation héritée (legacy) — re-sélectionne via 🐾' : 'Aucune sélectionnée')}</span>
      </div>
    </div>

    </section><!-- /cs-spell-effects-panel -->
    </main>

    <aside class="cs-spell-side" aria-label="Résumé et réglages du sort">
      <div class="cs-spell-side-card cs-spell-side-card--preview">
        <div class="cs-spell-preview cs-spell-preview--sticky">
          <div class="cs-spell-preview-title">Résumé jouable <span class="cs-spell-preview-pm">Coût : <strong id="s-pm-display">0</strong> PM</span></div>
          <div id="s-preview-body" class="cs-spell-preview-body"></div>
          <input type="hidden" id="s-pm" value="${s?.pm||2}">
        </div>
      </div>

      <details class="cs-spell-advanced" open>
        <summary><span>Réglages</span><small>Durée et portée optionnelles</small></summary>
        <div class="cs-spell-advanced-body">

    <!-- ⑧ Durée — auto-calculée (base 2 tours + Durée scalée), override possible.
         Visible pour tous les sorts persistants (Enchant, Affliction, Protection CA, rune Durée). -->
    <div id="s-duree-base-section" class="cs-duree-section" style="${_needsDureeBase(s)?'':'display:none'}">
      ${_autoValHtml({
        fieldId: 's-duree-base',
        label: '⏳ Durée (tours)',
        autoValue:  String(_calcSortDuree(s || {})),
        autoSource: _autoSourceDuree(s || {}),
        currentValue: s?.dureeBase,
        placeholder: 'ex : 5',
      })}
    </div>

    <!-- ⑧b Portée — override de la portée de l'arme (laisser vide = portée d'arme) -->
    <div class="form-group cs-spell-side-setting">
      <label>🎯 Portée <span style="color:var(--text-dim);font-weight:400;font-size:.7rem">cases — laisser vide pour utiliser la portée de l'arme</span></label>
      <div style="display:flex;gap:.4rem;align-items:center">
        <input type="number" class="input-field" id="s-portee" min="0" max="50"
          value="${s?.portee != null ? s.portee : ''}" placeholder="auto (arme)" style="width:100px;text-align:center;padding:.3rem">
        <span style="font-size:.8rem;color:var(--text-dim)">cases</span>
      </div>
    </div>

        </div>
      </details>

      <details class="cs-spell-advanced cs-spell-advanced--mj" ${STATE.isAdmin ? 'open' : ''}>
        <summary><span>Validation MJ</span><small>Statut, notes et exceptions</small></summary>
        <div class="cs-spell-advanced-body">

    <!-- ⑩ Limites MJ (équilibrage + overrides) -->
    <div class="cs-mj-limits">
      <div class="cs-mj-limits-title">🔒 Limites MJ <span>— équilibrage des combos & overrides</span></div>

      <!-- Validation MJ : 3 états (admins) / badge lecture seule (joueurs) -->
      ${(() => {
        const vs = s?.mjValidation || (s?.mjValidated ? 'ok' : 'pending');
        if (STATE.isAdmin) {
          const seg = (val, label) => `<button type="button" class="cs-mjval-btn cs-mjval-btn--${val} ${vs===val?'is-active':''}" data-mjval="${val}" data-action="_csSetMjVal">${label}</button>`;
          return `<div class="cs-mjval-block">
            <div class="cs-mjval-block-title">Validation MJ <span>— statut de ce sort</span></div>
            <input type="hidden" id="s-mj-validation" value="${vs}">
            <div class="cs-mjval-seg">
              ${seg('ok', '✅ Validé')}
              ${seg('pending', '⏳ En attente')}
              ${seg('no', '❌ Refusé')}
            </div>
          </div>`;
        }
        const lbl = vs === 'ok' ? '✅ Sort validé par le MJ'
                  : vs === 'no' ? '❌ Sort refusé par le MJ'
                  : '⏳ En attente de validation du MJ';
        return `<div class="cs-mjval-readonly cs-mjval-readonly--${vs}">${lbl}</div>`;
      })()}

      <div class="form-group" style="margin-bottom:.5rem">
        <label style="font-size:.72rem">Notes / restrictions <span style="color:var(--text-dim);font-weight:400;font-size:.68rem">(affichées dans la fiche)</span></label>
        <textarea class="input-field" id="s-mj-notes" rows="2" placeholder="ex : soin va uniquement au lanceur">${s?.mjNotes||''}</textarea>
      </div>

      ${STATE.isAdmin ? `
      <div class="form-group" style="margin-bottom:.5rem">
        <label style="font-size:.72rem">Coût PM personnalisé <span style="color:var(--text-dim);font-weight:400;font-size:.68rem">(MJ — vide = auto selon runes ; set léger appliqué par-dessus, jamais en dessous de 0)</span></label>
        <input type="number" class="input-field" id="s-pm-override" min="0" max="50"
          value="${s?.pmOverride ?? ''}" placeholder="auto"
          style="max-width:120px">
      </div>
      <div class="cs-mj-validation cs-mj-validation--max ${s?.mjAlwaysMax?'is-on':''}">
        <input type="checkbox" id="s-mj-always-max" ${s?.mjAlwaysMax?'checked':''}
          data-change="_csMjValToggle">
        <label for="s-mj-always-max" class="cs-mj-validation-label">
          <span class="cs-mj-validation-switch"><span class="cs-mj-validation-thumb"></span></span>
          <span class="cs-mj-validation-info">
            <span class="cs-mj-validation-title">🎲 Toujours valeur maximum</span>
            <span class="cs-mj-validation-sub">Les dés tirent leur valeur max (1d6 = 6, 2d4+2 = 10) — potions, objets à effet fixe</span>
          </span>
          <span class="cs-mj-validation-state"></span>
        </label>
      </div>` : ''}
    </div>
        </div>
      </details>

    </aside>
   </div><!-- /cs-spell-layout -->

   </div><!-- /cs-spell-forge -->
    </div><!-- /sh-admin-body -->
    <div class="sh-admin-footer">
      <button class="btn btn-outline btn-sm" data-action="closeModalDirect">Annuler</button>
      <div class="sh-admin-footer-spacer"></div>
      <button class="btn btn-gold btn-sm" data-action="saveSort" data-idx="${idx}">💾 Enregistrer le sort</button>
    </div>
   </div><!-- /sh-admin-modal -->
  `);

  setTimeout(() => {
    updateSortPM();
    // Applique l'état initial des sections conditionnelles (Dégâts/Soin/CA, Drain,
    // Invocation…) dès l'ouverture — sinon un sort déjà Drain affichait les onglets
    // CA/Soin tant qu'on n'avait pas interagi.
    _refreshConditionalSections();
    _updateSortPreview();
    // Listeners génériques pour rafraîchir la preview à chaque saisie
    const modal = document.querySelector('.modal');
    if (modal && !modal.dataset.previewBound) {
      modal.dataset.previewBound = '1';
      modal.addEventListener('input',  _updateSortPreview);
      modal.addEventListener('change', _updateSortPreview);
      modal.addEventListener('change', (event) => {
        if (event.target?.id === 's-enchant-etat') _refreshEnchantStateTuning();
      });
    }
    // Populate les listes déroulantes d'état (affliction + enchantement).
    // Au chargement initial, le dropdown n'a que l'option "— Aucun —" : la valeur
    // saved-etat-id n'est pas encore "sélectionnée" dans le <select>. Après async
    // populate, on re-render la preview pour qu'elle reflète l'état choisi.
    Promise.all([
      _populateAfflictionEtatSelect(),
      _populateEnchantEtatSelect(),
    ]).then(() => {
      _refreshEnchantStateTuning();
      _updateSortPreview();
    });
  }, 50);
}

// Cache des états en mémoire pour éviter de retaper Firestore à chaque dropdown
let _conditionsLibCache = null;

/** Source unique : lit world/conditions dans Firestore via le module partagé. */
async function _loadAllConditions() {
  if (_conditionsLibCache) return _conditionsLibCache;
  _conditionsLibCache = await loadConditionLibrary();
  setConditionsLibCache(_conditionsLibCache); // alimente aussi le cache de spells-calc.js
  return _conditionsLibCache;
}

function _conditionSupportsSpellUsage(condition, usage) {
  const su = condition?.spellUsage;
  if (!su || typeof su !== 'object') return true; // compat anciens états avant migration
  return usage === 'enchantment' ? !!su.enchantment : !!su.affliction;
}

/** Remplit un <select> d'état (Enchantement OU Affliction) depuis la BDD. */
async function _populateConditionSelect(selectId, savedHiddenId, usage) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const savedVal = document.getElementById(savedHiddenId)?.value || '';
  const lib = await _loadAllConditions();
  const filtered = lib.filter(c => _conditionSupportsSpellUsage(c, usage) || c.id === savedVal);
  if (!lib.length) {
    sel.innerHTML = `<option value="">⚠️ Aucun état en BDD — ouvrir le VTT une fois pour initialiser</option>`;
    return;
  }
  if (!filtered.length) {
    sel.innerHTML = `<option value="">— Aucun état compatible —</option>`;
    return;
  }
  sel.innerHTML = `<option value="">— Aucun —</option>`
    + filtered.map(c => `<option value="${c.id}" ${c.id===savedVal?'selected':''}>${c.icon||''} ${c.label}</option>`).join('');
}

function _populateEnchantEtatSelect()    { return _populateConditionSelect('s-enchant-etat', 's-enchant-etat-saved', 'enchantment'); }
function _populateAfflictionEtatSelect() { return _populateConditionSelect('s-affliction-etat', 's-affliction-etat-saved', 'affliction'); }

function _refreshEnchantStateTuning() {
  const wrap = document.getElementById('s-enchant-state-tuning');
  if (!wrap) return;
  const id = document.getElementById('s-enchant-etat')?.value || '';
  const condition = id ? _conditionsLibCache?.find(c => c.id === id) : null;
  const effects = condition?.effects || {};
  const hasMove = effects.movementBonus != null;
  const hasDmg = !!effects.dmgDealtBonus;
  const move = document.getElementById('s-enchant-move-tune');
  const dmg = document.getElementById('s-enchant-dmg-tune');
  if (move) move.style.display = hasMove ? '' : 'none';
  if (dmg) dmg.style.display = hasDmg ? '' : 'none';
  wrap.style.display = (hasMove || hasDmg) ? '' : 'none';
  _refreshAutoValChips();
  _collapseEnchantStateAutoIfMatching('s-enchant-state-move-bonus');
  _collapseEnchantStateAutoIfMatching('s-enchant-state-dmg-formula');
}

function _collapseEnchantStateAutoIfMatching(fieldId) {
  const input = document.getElementById(fieldId);
  const auto = document.getElementById(`${fieldId}-autoval`);
  const edit = document.getElementById(`${fieldId}-edit`);
  const display = document.getElementById(`${fieldId}-display`);
  const wrap = display?.parentElement;
  if (!input || !auto || !edit || !display || !wrap) return;
  if (!input.value.trim()) return;
  if (input.value.trim() !== auto.textContent.trim()) return;
  input.value = '';
  edit.style.display = 'none';
  display.style.display = '';
  wrap.classList.remove('is-custom');
}

function _calcEnchantStateMoveAuto(s) {
  const id = s?.enchantEtatId || '';
  const condition = id ? _conditionsLibCache?.find(c => c.id === id) : null;
  const baseRaw = condition?.effects?.movementBonus;
  if (baseRaw == null) return '';
  const base = Number.isFinite(parseInt(baseRaw)) ? parseInt(baseRaw) : 0;
  const nbAmp = (s?.runes || []).filter(r => r === 'Amplification').length;
  return String(base + nbAmp);
}

function _calcEnchantStateDmgAuto(s) {
  const id = s?.enchantEtatId || '';
  const condition = id ? _conditionsLibCache?.find(c => c.id === id) : null;
  if (!condition?.effects?.dmgDealtBonus) return '';
  const nbP = (s?.runes || []).filter(r => r === 'Puissance').length;
  return `${1 + nbP}d4 +2`;
}

function _isRegenerationComboActive(counts = _runeCountsEdit) {
  return (counts?.Protection || 0) > 0
    && (counts?.Affliction || 0) > 0
    && (document.getElementById('s-affliction-mode')?.value || 'dot') !== 'laceration';
}

function _isAllongeComboActive(counts = _runeCountsEdit) {
  return (counts?.Enchantement || 0) > 0
    && (counts?.Amplification || 0) > 0
    && (counts?.Dispersion || 0) === 0;
}

function _calcRegenerationAuto(s) {
  const runes = s?.runes || [];
  const nbProt = runes.filter(r => r === 'Protection').length;
  const nbAff = runes.filter(r => r === 'Affliction').length;
  return nbProt > 0 && nbAff > 0 ? `${nbProt + nbAff}d4` : '';
}

/** Re-style les boutons de type + ajuste la visibilité des sections conditionnelles. */
function _applyTypeChange() {
  const TYPE_CFG = {
    offensif:   '#ff6b6b',
    defensif:   '#22c38e',
    utilitaire: '#b47fff',
  };
  Object.entries(TYPE_CFG).forEach(([t, color]) => {
    const btn = document.getElementById(`s-type-${t}`);
    if (!btn) return;
    const active = _sortTypesEdit.has(t);
    btn.style.borderColor  = active ? color : 'var(--border)';
    btn.style.background   = active ? color+'20' : 'var(--bg-elevated)';
    btn.style.color        = active ? color : 'var(--text-dim)';
    btn.style.fontWeight   = active ? '700' : '400';
  });
  _refreshConditionalSections();
  _updateSortPreview();
}

/** Met à jour la visibilité des sections Dégâts/Soin selon types + runes + mode protection.
 *  Soin n'apparaît que si le mode Protection est explicitement 'soin' (ne s'affiche jamais
 *  en mode CA pour éviter la confusion avec le Bouclier réactif).
 */
function _refreshConditionalSections() {
  const isOffensive = _sortTypesEdit.has('offensif');
  const isSupport   = _sortTypesEdit.has('defensif');
  const counts      = _runeCountsEdit || {};
  const hasProt     = (counts.Protection || 0) > 0;
  const hasAmp      = (counts.Amplification || 0) > 0;
  const hasEnchant  = (counts.Enchantement || 0) > 0;
  const hasAffliction = (counts.Affliction || 0) > 0;
  const protMode    = document.getElementById('s-prot-mode')?.value || 'ca';
  const ampMode     = document.getElementById('s-amp-mode')?.value || 'zone';
  const isDepl      = ampMode === 'deplacement';
  const isAllonge   = _isAllongeComboActive(counts);
  const dSec = document.getElementById('s-degats-section');
  const sSec = document.getElementById('s-soin-section');
  // Affliction supprime les dégâts d'impact : la rune Puissance scale le DoT
  // de l'affliction, pas un dégât direct. Le mode Déplacement les supprime aussi.
  // Invocation : le sort n'a pas de dégâts propres (la créature frappe) → masque
  // la section Dégâts même en offensif (Puissance scale l'attaque de l'invocation).
  const anyInvoc = (counts.Invocation || 0) > 0;
  // Branche Lacération d'Affliction (ou legacy rune) : frappe toujours l'attaque
  // de base → section Dégâts visible même si « offensif » n'est pas coché, et
  // l'affliction n'est PAS en suppression d'impact dans ce mode.
  const _afflMode = document.getElementById('s-affliction-mode')?.value || 'dot';
  const isLaceration = (counts.Lacération || 0) > 0 || (hasAffliction && _afflMode === 'laceration');
  const isRegen = _isRegenerationComboActive(counts);
  const hasAfflictionDebuff = hasAffliction && _afflMode !== 'laceration';
  if (dSec) dSec.style.display = ((isOffensive || isLaceration) && !hasAfflictionDebuff && !isDepl && !anyInvoc) ? '' : 'none';
  // Combo Drain : sort offensif + Protection → la Protection devient un vol de vie %.
  // On masque alors le choix CA/Soin et leurs montants, et on affiche l'indicateur.
  const isDrain   = isOffensive && hasProt;
  const isAmpSupportHeal = isSupport && hasAmp && !isDepl && !hasProt;
  const protSec = document.getElementById('s-prot-section');
  const affSec = document.getElementById('s-affliction-section');
  const regenSec = document.getElementById('s-regeneration-section');
  const allongeSec = document.getElementById('s-allonge-section');
  const enchantSec = document.getElementById('s-enchant-section');
  const ampSec = document.getElementById('s-amp-section');
  const affModes = document.getElementById('s-affliction-modes');
  const protGroup = document.getElementById('s-prot-mode-group');
  const caSec     = document.getElementById('s-ca-section');
  const drainEl   = document.getElementById('s-prot-drain');
  if (protSec) protSec.style.display = (hasProt && !isRegen) ? '' : 'none';
  if (affSec)  affSec.style.display  = (hasAffliction && !isRegen) ? '' : 'none';
  if (regenSec)  regenSec.style.display  = isRegen ? '' : 'none';
  if (allongeSec) allongeSec.style.display = isAllonge ? '' : 'none';
  if (enchantSec) enchantSec.style.display = (hasEnchant && !isAllonge) ? '' : 'none';
  if (ampSec)     ampSec.style.display     = (hasAmp && !isAllonge) ? '' : 'none';
  const allongeRange = _ampLength(counts.Amplification || 0);
  const allongeRangeEl = document.getElementById('s-allonge-range');
  const allongePluralEl = document.getElementById('s-allonge-range-plural');
  if (allongeRangeEl) allongeRangeEl.textContent = String(allongeRange);
  if (allongePluralEl) allongePluralEl.textContent = allongeRange > 1 ? 's' : '';
  if (affModes)  affModes.style.display  = isRegen ? 'none' : '';
  if (protGroup) protGroup.style.display = (isDrain || isRegen) ? 'none' : '';
  if (caSec)     caSec.style.display     = (!isDrain && !isRegen && protMode === 'ca') ? '' : 'none';
  if (sSec)      sSec.style.display      = (!isDrain && !isRegen && ((hasProt && protMode === 'soin') || isAmpSupportHeal)) ? '' : 'none';
  if (drainEl) {
    drainEl.style.display = isDrain ? '' : 'none';
    if (isDrain) {
      const pctEl = document.getElementById('s-prot-drain-pct');
      if (pctEl) pctEl.textContent = Math.round((0.25 + 0.25 * (counts.Protection || 0)) * 100);
    }
  }
  // Section Invocation générique : rune Invocation seule (hors combos Sentinelle/Arme invoquée)
  const hasInvoc = anyInvoc && !(counts.Affliction > 0) && !(counts.Enchantement > 0);
  const iSec = document.getElementById('s-invocation-section');
  if (iSec) iSec.style.display = hasInvoc ? '' : 'none';
  if (hasInvoc) _refreshInvocationDerived();
}

function _toggleSortType(type) {
  if (_sortTypesEdit.has(type)) _sortTypesEdit.delete(type);
  else _sortTypesEdit.add(type);
  _applyTypeChange();
}

// ── Invocation : section éditeur (les ACTIONS se gèrent depuis la carte du sort,
//    via la vraie modale de sort — cf. _openInvocationConfig) ──────────────────
function _renderInvActionsList() {
  const n = (_invActionsEdit || []).length;
  return `<div class="cs-inv-actions-note">
    ${n ? `<b>${n}</b> action${n>1?'s':''} définie${n>1?'s':''}.` : 'Aucune action pour l\'instant.'}
    Conçois-les depuis la carte du sort (bouton <b>🐾</b>, après enregistrement) — chaque action est un vrai sort à runes.
  </div>`;
}

// ── Configuration de l'invocation (modale depuis la carte du sort) ─────────────
//    Les actions = vrais sorts, édités via la modale de sort complète
//    (editItemSpell). La modale de config N'EST PAS un éditeur de sort → ouvrir
//    l'éditeur d'action par-dessus ne crée aucun conflit d'état (pattern boutique).
function _invCfgSort() {
  const c = STATE.activeChar;
  return c ? (c.deck_sorts || [])[_invCfgIdx] : null;
}
// Bouton 🐾 de la carte du sort → SÉLECTEUR d'invocations de la bibliothèque.
export function openInvocationConfig(idx) {
  const c = STATE.activeChar; if (!c) return;
  const s = (c.deck_sorts || [])[idx]; if (!s) return;
  _invCfgIdx = idx;
  _itemEditCtx = null;
  openModal(`🐾 Invocations — ${_esc(s.nom || 'Sort')}`, _renderInvSelectBody());
}
function _invSelTitle() { const s = _invCfgSort(); return `🐾 Invocations — ${_esc(s?.nom || 'Sort')}`; }
function _renderInvSelectBody() {
  const s = _invCfgSort(); if (!s) return '<div style="padding:1rem">Sort introuvable.</div>';
  const nbInv = (s.runes || []).filter(r => r === 'Invocation').length || 1;
  const lib = _libInvs();
  if (!s.invocation || typeof s.invocation !== 'object' || !Array.isArray(s.invocation.ids)) {
    s.invocation = { ids: Array.isArray(s.invocation?.ids) ? s.invocation.ids : [] };
  }
  const sel = s.invocation.ids;
  const selCount = sel.filter(id => lib.some(iv => iv.id === id)).length;
  const cards = lib.map(iv => {
    const on = sel.includes(iv.id);
    const full = !on && selCount >= nbInv;
    return `<button class="cs-invsel-card${on?' is-on':''}" data-action="_toggleInvSelect" data-id="${iv.id}" ${full?'disabled':''}>
      <span class="cs-invsel-portrait">${iv.image ? `<img src="${iv.image}" alt="">` : '🐾'}</span>
      <span class="cs-invsel-body"><span class="cs-invsel-name">${_esc(iv.nom || 'Invocation')}</span>
      <span class="cs-invsel-stats">❤️ ${iv.stats?.pv ?? '?'} · 🛡️ ${iv.stats?.ca ?? 10} · ⚔️ ${_esc(iv.stats?.attaque || '1d4 +2')}</span></span>
      <span class="cs-invsel-check">${on ? '✓' : '+'}</span>
    </button>`;
  }).join('');
  return `<div class="cs-invsel">
    <div class="cs-invsel-hd">Choisis jusqu'à <b>${nbInv}</b> invocation${nbInv>1?'s':''} (1 par rune Invocation) — <b>${selCount}/${nbInv}</b> sélectionnée(s)</div>
    ${lib.length ? `<div class="cs-invsel-list">${cards}</div>`
      : `<div class="cs-invsel-empty">Aucune invocation en bibliothèque.<br><button class="btn btn-gold btn-sm" data-action="openInvocationLibrary" style="margin-top:.5rem">🐾 Créer une invocation</button></div>`}
    <div class="cs-invsel-foot">
      <button class="btn btn-outline btn-sm" data-action="openInvocationLibrary">🐾 Gérer la bibliothèque</button>
      <button class="btn btn-gold" data-action="closeModalDirect">Terminé</button>
    </div>
  </div>`;
}
async function _toggleInvSelect(id) {
  const c = STATE.activeChar; const s = _invCfgSort(); if (!s) return;
  const nbInv = (s.runes || []).filter(r => r === 'Invocation').length || 1;
  let ids = Array.isArray(s.invocation?.ids) ? [...s.invocation.ids] : [];
  if (ids.includes(id)) ids = ids.filter(x => x !== id);
  else { if (ids.length >= nbInv) return; ids.push(id); }
  s.invocation = { ids };
  await trySave('characters', c.id, { deck_sorts: c.deck_sorts });
  updateModalContent(_invSelTitle(), _renderInvSelectBody());
  _sortsRerender?.();
}
function _refreshInvocationConfig() {
  const s = _invCfgSort(); if (!s) return;
  updateModalContent(`🐾 Invocation — ${_esc(s.nom || 'Sort')}`, _renderInvocationConfigBody());
}
function _renderInvocationConfigBody() {
  const s = _invCfgSort(); if (!s) return '<div style="padding:1rem">Sort introuvable.</div>';
  const iv  = _calcInvocationStats(s);
  const img = s.invocation?.image;
  const acts = Array.isArray(s.invocation?.actions) ? s.invocation.actions : [];
  const _invCalcChar = _invocationCalcChar(s); // base de calcul = attaque de la créature
  const dureeStr = iv.concentration ? 'Concentration' : `${iv.duree} tour${iv.duree>1?'s':''}`;
  return `
    <div class="inv-cfg">
      <div class="inv-cfg-head">
        <div class="inv-cfg-portrait">${img ? `<img src="${img}" alt="">` : '<span>🐾</span>'}</div>
        <div class="inv-cfg-vitals">
          <span class="inv-cfg-vital">❤️ <b>${iv.pv}</b> PV</span>
          <span class="inv-cfg-vital">🛡️ CA <b>${iv.ca}</b></span>
          <span class="inv-cfg-vital">⚔️ <b>${_esc(iv.attaque)}</b> · +${iv.toucher}</span>
          <span class="inv-cfg-vital">👢 <b>${iv.deplacement}</b></span>
          <span class="inv-cfg-vital">⏱️ <b>${dureeStr}</b></span>
        </div>
      </div>
      <div class="inv-cfg-hint">Les stats et l'image se règlent dans l'éditeur du sort. Ici, conçois les <b>actions</b> de la créature — chacune s'édite avec la modale de sort complète (runes, dégâts, effets…).</div>
      <div class="inv-cfg-actions-hd">
        <span>🎬 Actions de la créature</span>
        <button class="btn btn-gold btn-sm" data-action="_invCfgAddAction">＋ Nouvelle action</button>
      </div>
      <div class="inv-cfg-list">
        ${acts.length ? acts.map((a, ai) => {
          // Dégâts calculés sur la base de l'ATTAQUE de la créature (pas l'arme du perso)
          const _off = _getSortTypes(a).includes('offensif') || _hasLaceration(a);
          const _dmg = _off ? _calcSortDegats(a, _invCalcChar) : '';
          const _meta = [
            _dmg ? `🎲 ${_esc(_dmg)}` : '',
            Array.isArray(a.runes) && a.runes.length ? `${a.runes.length} rune${a.runes.length>1?'s':''}` : 'sans rune',
            a.pm ? `${a.pm} PM` : '',
          ].filter(Boolean).join(' · ');
          return `
          <div class="inv-cfg-act">
            <div class="inv-cfg-act-main" data-action="_invCfgEditAction" data-aidx="${ai}">
              <span class="inv-cfg-act-name">🎬 ${_esc(a.nom || 'Action')}</span>
              <span class="inv-cfg-act-meta">${_meta}</span>
            </div>
            <button class="btn-icon" data-action="_invCfgEditAction" data-aidx="${ai}" title="Modifier">✏️</button>
            <button class="btn-icon" data-action="_invCfgDeleteAction" data-aidx="${ai}" title="Supprimer">🗑️</button>
          </div>`;
        }).join('') : '<div class="inv-cfg-empty">Aucune action. Crée la première attaque ou capacité de la créature.</div>'}
      </div>
      <div class="inv-cfg-foot">
        <button class="btn btn-outline" data-action="closeModalDirect">Fermer</button>
      </div>
    </div>`;
}
// Contexte de calcul "créature" : ses actions se basent sur l'ATTAQUE de
// l'invocation (ex. 1d4 +2), pas sur l'arme du personnage. On fabrique un perso
// virtuel neutre (stats 10 → mod 0) dont l'arme principale = l'attaque de la créature.
function _invocationCalcChar(invSort) {
  const iv = _calcInvocationStats(invSort || {});
  return {
    id: '__invocationCalc',
    nom: invSort?.nom ? `Créature (${invSort.nom})` : 'Créature invoquée',
    stats: { force:10, dexterite:10, constitution:10, intelligence:10, sagesse:10, charisme:10 },
    statsBonus: {},
    equipement: { 'Main principale': {
      nom: 'Attaque de la créature', degats: iv.attaque,
      statAttaque: 'force', toucherStat: 'force', degatsStat: 'force',
      portee: 1, isDefault: true,
    } },
    maitrises: {}, sort_cats: [], deck_sorts: [], inventaire: [], elements: [],
  };
}
function _invCfgAddAction() {
  const s = _invCfgSort(); if (!s) return;
  if (!s.invocation) s.invocation = {};
  if (!Array.isArray(s.invocation.actions)) s.invocation.actions = [];
  editItemSpell({ actions: s.invocation.actions }, -1, _invCfgOnActionSave, _invocationCalcChar(s));
}
function _invCfgEditAction(aidx) {
  const s = _invCfgSort(); if (!s?.invocation?.actions) return;
  editItemSpell({ actions: s.invocation.actions }, parseInt(aidx), _invCfgOnActionSave, _invocationCalcChar(s));
}
async function _invCfgOnActionSave(holder) {
  const c = STATE.activeChar, s = _invCfgSort(); if (!c || !s) return;
  if (!s.invocation) s.invocation = {};
  s.invocation.actions = holder.actions;
  await trySave('characters', c.id, { deck_sorts: c.deck_sorts });
  _refreshInvocationConfig();       // la modale de config est déjà restaurée (popModal)
}
async function _invCfgDeleteAction(aidx) {
  const c = STATE.activeChar, s = _invCfgSort(); if (!c || !s?.invocation?.actions) return;
  if (!await confirmModal('Supprimer cette action ?')) return;
  s.invocation.actions.splice(parseInt(aidx), 1);
  await trySave('characters', c.id, { deck_sorts: c.deck_sorts });
  _refreshInvocationConfig();
}
// Bloc image : aperçu + boutons (mode normal). Le cropper inline remplace ce
// contenu pendant le cadrage (cf. _invStartCrop).
function _renderInvImageBlock() {
  return `
    <div class="cs-inv-img-preview">${_invImageEdit ? `<img src="${_invImageEdit}" alt="">` : '<span>🐾</span>'}</div>
    <div class="cs-inv-img-actions">
      <button type="button" class="btn btn-outline btn-sm" data-action="_invPickImage">${_invImageEdit ? '🔄 Changer' : '⬆ Image'}</button>
      ${_invImageEdit ? `<button type="button" class="btn btn-outline btn-sm" data-action="_invClearImage">✕</button>` : ''}
    </div>`;
}
function _refreshInvImageBlock() {
  const el = document.getElementById('s-inv-img-block');
  if (el) el.innerHTML = _renderInvImageBlock();
}
function _invPickImage() {
  pickImageFile({ onImage: ({ dataUrl }) => _invStartCrop(dataUrl) });
}
// Cadrage INLINE (pas de modale imbriquée → aucune perte de saisie de l'éditeur)
function _invStartCrop(dataUrl) {
  const host = document.getElementById('s-inv-img-block'); if (!host) return;
  host.innerHTML = `
    ${panZoomCropHTML({ idPrefix: 'inv-crop', viewSize: 200 })}
    <div class="cs-inv-crop-actions">
      <button type="button" class="btn btn-outline btn-sm" data-action="_invCropCancel">Annuler</button>
      <button type="button" class="btn btn-gold btn-sm" data-action="_invCropSave">✅ Valider</button>
    </div>`;
  requestAnimationFrame(() => {
    _invCrop?.destroy?.();
    _invCrop = attachPanZoomCrop({ idPrefix: 'inv-crop', dataUrl, viewSize: 200, outputSize: 256 });
  });
}
function _invCropSave() {
  const b64 = _invCrop?.getBase64();
  _invCrop?.destroy?.(); _invCrop = null;
  if (b64) {
    _invImageEdit = b64;
    const hid = document.getElementById('s-inv-image'); if (hid) hid.value = b64;
  }
  _refreshInvImageBlock();
  _updateSortPreview();
}
function _invCropCancel() {
  _invCrop?.destroy?.(); _invCrop = null;
  _refreshInvImageBlock();
}
function _invClearImage() {
  _invImageEdit = '';
  const hid = document.getElementById('s-inv-image'); if (hid) hid.value = '';
  _refreshInvImageBlock();
  _updateSortPreview();
}
// Met à jour les placeholders (valeurs dérivées) selon les runes courantes.
function _refreshInvocationDerived() {
  const runes = _buildRunesFromCounts();
  const d = _calcInvocationStats({ runes });
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.placeholder = String(val); };
  set('s-inv-attaque', d.attaque); set('s-inv-toucher', d.toucher); set('s-inv-pv', d.pv);
  set('s-inv-ca', d.ca); set('s-inv-deplacement', d.deplacement); set('s-inv-duree', d.duree);
}
// Invocation du sort = SÉLECTION d'invocations de la bibliothèque (édit via 🐾 sur
// la carte). L'éditeur de sort ne fait que PRÉSERVER la sélection/legacy existante
// (null si pas de rune Invocation).
function _buildInvocationFromDOM() {
  if (!((_runeCountsEdit?.Invocation || 0) > 0)) return null;
  if (_invOriginal && Array.isArray(_invOriginal.ids)) return { ids: [..._invOriginal.ids] };
  // Rétro-compat : ancien sort avec invocation "inline" (stats/actions) → préservée telle quelle.
  if (_invOriginal && _invOriginal.stats) return _invOriginal;
  return { ids: [] };
}

// ══════════════════════════════════════════════════════════════════════════════
// BIBLIOTHÈQUE D'INVOCATIONS (par personnage : c.invocations[])
// Chaque invocation = instance unique { id, nom, image, stats:{attaque,toucher,pv,
// ca,deplacement,pmMax}, actions:[], currentHp, currentPm }. La rune Invocation
// d'un sort en SÉLECTIONNE (≤ nbInv). Stats finales au lancement = base + bonus de
// runes (_calcSummonStats, côté VTT). Les PV/PM courants persistent entre apparitions.
// ══════════════════════════════════════════════════════════════════════════════
let _libInvIdx = -1; // index de l'invocation de la bibliothèque en cours d'édition

function _libInvs() { return Array.isArray(STATE.activeChar?.invocations) ? STATE.activeChar.invocations : []; }
function _libInvCurrent() { return _libInvs()[_libInvIdx] || null; }
function _invUuid() { return 'inv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
async function _saveLibInvs() {
  const c = STATE.activeChar; if (!c) return;
  await trySave('characters', c.id, { invocations: c.invocations || [] });
}

// ── Manager : liste des invocations du perso ──────────────────────────────────
export function openInvocationLibrary() {
  const c = STATE.activeChar; if (!c) return;
  if (!Array.isArray(c.invocations)) c.invocations = [];
  _libInvIdx = -1;
  openModal('🐾 Mes invocations', _renderInvLibraryBody());
}
function _refreshInvLibrary() { updateModalContent('🐾 Mes invocations', _renderInvLibraryBody()); }
function _renderInvLibraryBody() {
  const invs = _libInvs();
  const cards = invs.map((iv, i) => {
    const hpTxt = (iv.currentHp != null && iv.stats?.pv != null && iv.currentHp < parseInt(iv.stats.pv))
      ? `${iv.currentHp}/${iv.stats.pv}` : (iv.stats?.pv ?? '?');
    return `<div class="cs-invlib-card">
      <div class="cs-invlib-portrait">${iv.image ? `<img src="${iv.image}" alt="">` : '<span>🐾</span>'}</div>
      <div class="cs-invlib-info">
        <div class="cs-invlib-name">${_esc(iv.nom || 'Invocation')}</div>
        <div class="cs-invlib-stats">❤️ ${hpTxt} · 🛡️ ${iv.stats?.ca ?? 10} · ⚔️ ${_esc(iv.stats?.attaque || '1d4 +2')}${(iv.actions||[]).length ? ` · 🎬 ${iv.actions.length}` : ''}</div>
      </div>
      <div class="cs-invlib-actions">
        <button class="btn-icon" data-action="_editLibInv" data-idx="${i}" title="Modifier">✏️</button>
        <button class="btn-icon" data-action="_deleteLibInv" data-idx="${i}" title="Supprimer">🗑️</button>
      </div>
    </div>`;
  }).join('');
  return `<div class="cs-invlib">
    <div class="cs-invlib-hint">Crée tes créatures à l'avance (stats, image, actions). Un sort à rune <b>Invocation</b> choisira ensuite laquelle/lesquelles invoquer (1 par rune). Chaque invocation garde ses PV/PM entre deux apparitions.</div>
    <div class="cs-invlib-list">${cards || '<div class="cs-invlib-empty">Aucune invocation. Crée ta première créature.</div>'}</div>
    <div class="cs-invlib-foot">
      <button class="btn btn-gold" data-action="_editLibInv" data-idx="-1">＋ Nouvelle invocation</button>
      <button class="btn btn-outline" data-action="closeModalDirect">Fermer</button>
    </div>
  </div>`;
}

// ── Éditeur d'une invocation de la bibliothèque ───────────────────────────────
function _editLibInv(idx) {
  const c = STATE.activeChar; if (!c) return;
  if (!Array.isArray(c.invocations)) c.invocations = [];
  if (idx < 0) {
    c.invocations.push({ id: _invUuid(), nom: '', image: '', stats: { attaque:'1d4 +2', toucher:2, pv:10, ca:10, deplacement:3, pmMax:0 }, actions: [], currentHp: null, currentPm: null });
    _libInvIdx = c.invocations.length - 1;
  } else {
    _libInvIdx = idx;
  }
  _invImageEdit = _libInvCurrent()?.image || '';
  openModal('🐾 Invocation', _renderLibInvEditorBody());
}
function _refreshLibInvEditor() { updateModalContent('🐾 Invocation', _renderLibInvEditorBody()); }
function _renderLibInvEditorBody() {
  const iv = _libInvCurrent(); if (!iv) return '<div style="padding:1rem">Invocation introuvable.</div>';
  const st = iv.stats || {};
  const fields = [
    { id:'attaque',     ic:'⚔️', lbl:'Attaque',     type:'text',   val:_esc(st.attaque ?? '1d4 +2'), ph:'1d4 +2' },
    { id:'toucher',     ic:'🎯', lbl:'Toucher',     type:'number', val:(st.toucher ?? 2),  ph:'2' },
    { id:'pv',          ic:'❤️', lbl:'PV',          type:'number', val:(st.pv ?? 10),      ph:'10' },
    { id:'ca',          ic:'🛡️', lbl:'CA',          type:'number', val:(st.ca ?? 10),      ph:'10' },
    { id:'deplacement', ic:'👢', lbl:'Déplacement', type:'number', val:(st.deplacement ?? 3), ph:'3' },
    { id:'pmMax',       ic:'✦',  lbl:'PM',          type:'number', val:(st.pmMax ?? 0),    ph:'0' },
  ];
  const acts = Array.isArray(iv.actions) ? iv.actions : [];
  const calcChar = _libInvCalcChar(iv);
  return `<div class="cs-invedit">
    <div class="cs-spell-section">
      <div class="cs-spell-section-title">🐾 Identité &amp; statistiques <span class="cs-spell-section-hint">stats de base de la créature</span></div>
      <div class="cs-inv-body">
        <div class="cs-inv-imgcol">
          <div id="s-inv-img-block" class="cs-inv-img-block">${_renderInvImageBlock()}</div>
          <input type="hidden" id="s-inv-image" value="${_invImageEdit||''}">
        </div>
        <div class="cs-inv-grid">
          <label class="cs-inv-stat" style="grid-column:1/-1">
            <span class="cs-inv-stat-lbl">🐾 Nom</span>
            <input class="cs-inv-stat-in" id="s-inv-nom" type="text" value="${_esc(iv.nom||'')}" placeholder="Nom de la créature">
          </label>
          ${fields.map(f => `<label class="cs-inv-stat">
            <span class="cs-inv-stat-lbl">${f.ic} ${f.lbl}</span>
            <input class="cs-inv-stat-in" id="s-inv-${f.id}" type="${f.type}" value="${f.val}" placeholder="${f.ph}">
          </label>`).join('')}
        </div>
      </div>
    </div>
    <div class="cs-spell-section">
      <div class="cs-spell-section-title">🎬 Actions de la créature <span class="cs-spell-section-hint">mini-sorts joués par l'invocation</span>
        <button class="btn btn-gold btn-sm" style="margin-left:auto" data-action="_libInvAddAction">＋ Action</button>
      </div>
      <div class="inv-cfg-list">
        ${acts.length ? acts.map((a, ai) => {
          const _off = _getSortTypes(a).includes('offensif') || _hasLaceration(a);
          const _dmg = _off ? _calcSortDegats(a, calcChar) : '';
          const _meta = [_dmg ? `🎲 ${_esc(_dmg)}` : '', (a.runes||[]).length ? `${a.runes.length} rune${a.runes.length>1?'s':''}` : 'sans rune', a.pm ? `${a.pm} PM` : ''].filter(Boolean).join(' · ');
          return `<div class="inv-cfg-act">
            <div class="inv-cfg-act-main" data-action="_libInvEditAction" data-aidx="${ai}">
              <span class="inv-cfg-act-name">🎬 ${_esc(a.nom || 'Action')}</span>
              <span class="inv-cfg-act-meta">${_meta}</span>
            </div>
            <button class="btn-icon" data-action="_libInvEditAction" data-aidx="${ai}" title="Modifier">✏️</button>
            <button class="btn-icon" data-action="_libInvDeleteAction" data-aidx="${ai}" title="Supprimer">🗑️</button>
          </div>`;
        }).join('') : '<div class="inv-cfg-empty">Aucune action — la créature attaquera avec son attaque de base.</div>'}
      </div>
    </div>
    <div class="cs-invedit-foot">
      <button class="btn btn-outline" data-action="_libInvBack">← Bibliothèque</button>
      <button class="btn btn-gold" data-action="_saveLibInv">💾 Enregistrer</button>
    </div>
  </div>`;
}
function _libInvCalcChar(iv) {
  return {
    id: '__invocationCalc', nom: iv?.nom ? `Créature (${iv.nom})` : 'Créature invoquée',
    stats: { force:10, dexterite:10, constitution:10, intelligence:10, sagesse:10, charisme:10 },
    statsBonus: {},
    equipement: { 'Main principale': { nom: 'Attaque de la créature', degats: iv?.stats?.attaque || '1d4 +2', statAttaque:'force', toucherStat:'force', degatsStat:'force', portee:1, isDefault:true } },
    maitrises: {}, sort_cats: [], deck_sorts: [], inventaire: [], elements: [],
  };
}
// Lit les champs DOM → stats de l'invocation courante (sans toucher aux actions).
function _readLibInvStatsFromDOM() {
  const iv = _libInvCurrent(); if (!iv) return;
  const v = id => (document.getElementById(id)?.value ?? '').trim();
  const num = id => { const n = parseInt(v(id)); return Number.isFinite(n) ? n : 0; };
  iv.nom = v('s-inv-nom');
  iv.image = _invImageEdit || document.getElementById('s-inv-image')?.value || '';
  iv.stats = {
    attaque: v('s-inv-attaque') || '1d4 +2', toucher: num('s-inv-toucher'), pv: num('s-inv-pv'),
    ca: num('s-inv-ca') || 10, deplacement: num('s-inv-deplacement'), pmMax: num('s-inv-pmMax'),
  };
}
async function _saveLibInv() {
  const iv = _libInvCurrent(); if (!iv) return;
  _readLibInvStatsFromDOM();
  if (!iv.nom) { showNotif('Donne un nom à l\'invocation.', 'error'); return; }
  await _saveLibInvs();
  showNotif('Invocation enregistrée !', 'success');
  openModal('🐾 Mes invocations', _renderInvLibraryBody());
}
function _libInvBack() {
  _readLibInvStatsFromDOM();              // ne perd pas la saisie en cours
  openModal('🐾 Mes invocations', _renderInvLibraryBody());
}
async function _deleteLibInv(idx) {
  const c = STATE.activeChar; if (!c?.invocations) return;
  if (!await confirmModal('Supprimer cette invocation ?')) return;
  c.invocations.splice(idx, 1);
  await _saveLibInvs();
  _refreshInvLibrary();
}
// Actions de l'invocation (mini-sorts) — réutilise editItemSpell.
function _libInvAddAction() {
  _readLibInvStatsFromDOM();
  const iv = _libInvCurrent(); if (!iv) return;
  if (!Array.isArray(iv.actions)) iv.actions = [];
  editItemSpell({ actions: iv.actions }, -1, _libInvOnActionSave, _libInvCalcChar(iv));
}
function _libInvEditAction(aidx) {
  _readLibInvStatsFromDOM();
  const iv = _libInvCurrent(); if (!iv?.actions) return;
  editItemSpell({ actions: iv.actions }, parseInt(aidx), _libInvOnActionSave, _libInvCalcChar(iv));
}
async function _libInvOnActionSave(holder) {
  const iv = _libInvCurrent(); if (!iv) return;
  iv.actions = holder.actions;
  await _saveLibInvs();
  _refreshLibInvEditor();
}
async function _libInvDeleteAction(aidx) {
  const iv = _libInvCurrent(); if (!iv?.actions) return;
  if (!await confirmModal('Supprimer cette action ?')) return;
  iv.actions.splice(parseInt(aidx), 1);
  await _saveLibInvs();
  _refreshLibInvEditor();
}

function _selectDeplMode(mode) {
  _deplModeEdit = mode;
  const DEPL_CFG = { self:'#22c38e', push:'#e8b84b', pull:'#4f8cff' };
  ['self', 'push', 'pull'].forEach(v => {
    const btn = document.getElementById(`s-depl-${v}`);
    if (!btn) return;
    const col = DEPL_CFG[v] || '#9ca3af';
    const active = v === mode;
    btn.style.borderColor = active ? col : 'var(--border)';
    btn.style.background  = active ? col+'20' : 'var(--bg-elevated)';
    btn.style.color       = active ? col : 'var(--text-dim)';
    btn.style.fontWeight  = active ? '700' : '400';
  });
  _updateSortPreview();
}

// Mode de la rune Amplification : 'zone' | 'deplacement' (calqué sur _selectProtMode).
function _selectAmpMode(mode) {
  const hidden = document.getElementById('s-amp-mode');
  if (hidden) hidden.value = mode;
  if (mode === 'deplacement' && !_deplModeEdit) _deplModeEdit = 'self';
  const zSec = document.getElementById('s-amp-zone-section');
  const dSec = document.getElementById('s-amp-depl-section');
  if (zSec) zSec.style.display = mode === 'zone' ? '' : 'none';
  if (dSec) dSec.style.display = mode === 'deplacement' ? '' : 'none';
  [['zone','#b47fff'], ['deplacement','#e8b84b']].forEach(([v, col]) => {
    const btn = document.getElementById(`s-amp-${v}`);
    if (!btn) return;
    const active = v === mode;
    btn.style.borderColor = active ? col : 'var(--border)';
    btn.style.background  = active ? col+'18' : 'var(--bg-elevated)';
    const t = btn.querySelector('div'); if (t) t.style.color = active ? col : 'var(--text-dim)';
  });
  if (mode === 'deplacement') _selectDeplMode(_deplModeEdit || 'self');
  _refreshConditionalSections();   // masque/affiche Dégâts selon le mode
  _updateSortPreview();
}

function _selectActionMode(mode) {
  _actionModeEdit = mode === 'action_bonus' ? 'action_bonus' : 'reaction';
  const hidden = document.getElementById('s-action-mode');
  if (hidden) hidden.value = _actionModeEdit;
  [
    ['reaction', '#ec4899'],
    ['action_bonus', '#f97316'],
  ].forEach(([v, col]) => {
    const btn = document.getElementById(`s-action-mode-${v}`);
    if (!btn) return;
    const active = v === _actionModeEdit;
    btn.style.borderColor = active ? col : 'var(--border)';
    btn.style.background = active ? col + '18' : 'var(--bg-elevated)';
    const t = btn.querySelector('div');
    if (t) t.style.color = active ? col : 'var(--text-dim)';
  });
  _refreshRunesSection?.(ACTION_RUNE);
  _updateSortPreview();
}

function _selectProtMode(mode) {
  const hidden  = document.getElementById('s-prot-mode');
  const caSec   = document.getElementById('s-ca-section');
  if (hidden)  hidden.value = mode;
  if (caSec)   caSec.style.display   = mode === 'ca'   ? '' : 'none';
  // La section Soin a maintenant sa propre logique (type Soutien OU Protection mode soin)
  _refreshConditionalSections();
  ['ca','soin'].forEach(v => {
    const btn = document.getElementById(`s-prot-${v}`);
    if (!btn) return;
    const colors = { ca:'#22c38e', soin:'#4f8cff' };
    const col = colors[v];
    const active = v === mode;
    btn.style.borderColor = active ? col : 'var(--border)';
    btn.style.background  = active ? col+'18' : 'var(--bg-elevated)';
    btn.querySelector('div').style.color = active ? col : 'var(--text-dim)';
  });
  // Section Durée base : visible si Protection mode CA actif
  const dureeSec = document.getElementById('s-duree-base-section');
  if (dureeSec) {
    const s = _buildSortFromDOM();
    dureeSec.style.display = _needsDureeBase(s) ? '' : 'none';
  }
  // Re-render des runes actives pour que la carte Protection reflète le mode courant
  // (CA → "+2 CA · sur 1 cible (2 tours)" / Soin → "+1d4 soin · sur 1 cible")
  _refreshRunesSection?.('Protection');
  _updateSortPreview();
}

export function runeIncrement(nom) {
  _runeCountsEdit = _runeCountsEdit||{};
  if (nom === ACTION_RUNE && (_runeCountsEdit[ACTION_RUNE] || 0) > 0) {
    _refreshRunesSection(nom);
    return;
  }
  // Limite de runes d'effet par personnage (le MJ et les contextes spéciaux
  // — actions d'objet/invocation — ne sont pas limités).
  if (!STATE.isAdmin && !_itemEditCtx) {
    const total = Object.values(_runeCountsEdit).reduce((a, b) => a + b, 0);
    const limit = _spellRuneLimit();
    if (total >= limit) {
      showNotif(`Limite de runes d'effet atteinte (${limit}). Le MJ peut en débloquer.`, 'error');
      return;
    }
  }
  const prevCnt = _runeCountsEdit[nom] || 0;
  _runeCountsEdit[nom] = prevCnt + 1;
  // Intelligence : la 1ère Protection suggère la branche Soutien.
  // Puissance ne coche pas Offensif : elle peut renforcer un enchantement, un DoT,
  // une invocation, etc. sans impliquer des dégâts directs au cast.
  if (prevCnt === 0 && _sortTypesEdit) {
    if (nom === 'Protection' && !_sortTypesEdit.has('defensif')) {
      _sortTypesEdit.add('defensif');
      _applyTypeChange();
    }
  }
  _refreshRunesSection(nom);
}

export function runeDecrement(nom) {
  _runeCountsEdit = _runeCountsEdit||{};
  if ((_runeCountsEdit[nom]||0) <= 0) return;
  _runeCountsEdit[nom]--;
  if (_runeCountsEdit[nom] === 0) delete _runeCountsEdit[nom];
  _refreshRunesSection(nom);
}

// MJ : débloque / retire des runes d'effet pour le perso courant (characters.maxRunes).
async function _mjAdjRuneLimit(delta) {
  if (!STATE.isAdmin) return;
  const c = STATE.activeChar; if (!c) return;
  const cur  = parseInt(c.maxRunes);
  const base = Number.isFinite(cur) ? cur : 1;
  const next = Math.max(0, Math.min(20, base + (parseInt(delta) || 0)));
  if (next === base) return;
  c.maxRunes = next;
  await trySave('characters', c.id, { maxRunes: next }).catch(() => {});
  _refreshRunesSection();
  showNotif(`🔮 Runes d'effet débloquées : ${next} pour ${_esc(c.nom || 'ce perso')}`, 'success');
}

/**
 * Re-render la section runes complète + sync les sections conditionnelles + PM + preview.
 * Appelée après chaque incrément/décrément. Évite la désync entre carte active et picker.
 */
function _refreshRunesSection(changedNom) {
  const section = document.getElementById('cs-runes-section');
  if (section) section.innerHTML = _renderRunesSection();
  // Sections conditionnelles (rune X > 0 → section X visible)
  const cnt = _runeCountsEdit[changedNom] || 0;
  const sectionMap = {
    Protection:    's-prot-section',
    Enchantement:  's-enchant-section',
    Affliction:    's-affliction-section',
    Amplification: 's-amp-section',
    [ACTION_RUNE]: 's-action-rune-section',
  };
  const sectionId = sectionMap[changedNom];
  if (sectionId) {
    const el = document.getElementById(sectionId);
    if (el) el.style.display = cnt > 0 ? '' : 'none';
  }
  // Combo Sentinelle (Affliction + Invocation) : masque les branches d'affliction
  // (DoT/État/Lacération) et affiche une note — c'est une invocation de sentinelle.
  {
    const isSentinelle = (_runeCountsEdit['Affliction'] || 0) > 0 && (_runeCountsEdit['Invocation'] || 0) > 0;
    const isRegen = _isRegenerationComboActive(_runeCountsEdit);
    const modesEl = document.getElementById('s-affliction-modes');
    const noteEl  = document.getElementById('s-affliction-sentinelle-note');
    if (modesEl) modesEl.style.display = (isSentinelle || isRegen) ? 'none' : '';
    if (noteEl)  noteEl.style.display  = isSentinelle ? '' : 'none';
  }
  // Plus aucune rune Amplification → on repasse en mode Zone (évite un état
  // « déplacement » fantôme sans rune, qui supprimerait zone/dégâts à tort).
  if (changedNom === 'Amplification' && cnt === 0) {
    const ampHidden = document.getElementById('s-amp-mode');
    if (ampHidden && ampHidden.value !== 'zone') _selectAmpMode('zone');
  }
  // Portée de déplacement : dépend du nombre de runes Amplification.
  const rangeEl = document.getElementById('s-amp-depl-range');
  if (rangeEl) rangeEl.textContent = `1 à ${_ampLength(_runeCountsEdit['Amplification'] || 0) || 0} cases`;
  // Section Durée de base : visible selon le contexte
  const dureeSec = document.getElementById('s-duree-base-section');
  if (dureeSec) {
    const s = _buildSortFromDOM();
    dureeSec.style.display = _needsDureeBase(s) ? '' : 'none';
  }
  // La visibilité Dégâts/Soin dépend des types ET de la rune Protection
  _refreshConditionalSections();
  if (changedNom === 'Puissance' || changedNom === 'Amplification' || changedNom === 'Enchantement') {
    _refreshEnchantStateTuning();
  }
  updateSortPM();
}

/**
 * Active le mode "Custom" sur un champ auto-calculé.
 * fieldId : 's-degats' | 's-soin' | 's-ca' | 's-enchant-degats'
 */
function _enableSortCustom(fieldId) {
  const display = document.getElementById(`${fieldId}-display`);
  const edit    = document.getElementById(`${fieldId}-edit`);
  const input   = document.getElementById(fieldId);
  const wrap    = display?.parentElement; // .cs-spell-autoval
  if (display) display.style.display = 'none';
  if (edit)    edit.style.display = '';
  if (wrap)    wrap.classList.add('is-custom');   // CSS gère aussi via la classe
  if (input) { input.focus(); input.select?.(); }
}

/** Repasse en mode "Auto" — vide UNIQUEMENT la formule override.
 *  Les overrides de stat sont indépendants : pour les remettre en Auto,
 *  l'utilisateur sélectionne "Auto (arme)" dans le menu déroulant.
 */
function _disableSortCustom(fieldId) {
  const display = document.getElementById(`${fieldId}-display`);
  const edit    = document.getElementById(`${fieldId}-edit`);
  const input   = document.getElementById(fieldId);
  const wrap    = display?.parentElement; // .cs-spell-autoval
  if (input)   input.value = '';
  if (edit)    edit.style.display = 'none';
  if (display) display.style.display = '';
  if (wrap)    wrap.classList.remove('is-custom');  // sinon la chip reste cachée par CSS
  _refreshAutoValChips();
  _updateSortPreview();
}

/** Recalcule les valeurs affichées dans les chips auto (dégâts, soin, CA, enchant). */
function _refreshAutoValChips() {
  const s = _buildSortFromDOM();
  const c = _modalChar();
  if (!c) return;
  const apply = (fieldId, value, source) => {
    const v = document.getElementById(`${fieldId}-autoval`);
    const r = document.getElementById(`${fieldId}-source`);
    if (v && value !== undefined) v.textContent = value || '—';
    if (r && source !== undefined) r.textContent = source || '';
  };
  apply('s-degats',         _calcSortDegats(s, c),  _autoSourceDegats(s, c));
  apply('s-soin',           _calcSortSoin(s, c),    _autoSourceSoin(s, c));
  apply('s-ca',             _getSortCA(s),          _autoSourceCA(s));
  apply('s-enchant-degats', _calcEnchantDegats(s),  _autoSourceEnchantDeg(s));
  apply('s-enchant-state-move-bonus', _calcEnchantStateMoveAuto(s), 'État + Amplification');
  apply('s-enchant-state-dmg-formula', _calcEnchantStateDmgAuto(s), 'État + Puissance');
  apply('s-regeneration-formula', _calcRegenerationAuto(s), 'Protection + Affliction');
  apply('s-affliction-dot-formula', _calcAfflictionDot(s), _autoSourceAfflictionDot(s));
  apply('s-duree-base', String(_calcSortDuree(s)), _autoSourceDuree(s));
}

/**
 * Met à jour les chips "💡 Suggéré : …" d'Enchantement et Affliction.
 * Lit le noyau + slot du DOM, interroge la matrice MJ.
 * Si une suggestion existe pour la combinaison, affiche le chip cliquable.
 *
 * Pré-remplissage agressif : si la textarea d'effet est encore VIDE (jamais touchée),
 * on injecte automatiquement la suggestion. Si l'utilisateur a tapé quoi que ce soit,
 * on respecte sa saisie et on n'écrase pas (juste le chip reste visible pour qu'il puisse l'appliquer manuellement).
 */
function _refreshSpellSuggestions() {
  const matrices = getSpellMatricesCache();
  if (!matrices) return;
  const noyauId  = document.getElementById('s-noyau-id')?.value || '';
  const enchSlot = document.getElementById('s-enchant-slot')?.value || 'arme';
  const affSlot  = document.getElementById('s-affliction-slot')?.value || 'arme';

  const renderSuggestions = (cat, suggestions) => {
    const wrap = document.getElementById(`s-${cat}-suggest`);
    const list = document.getElementById(`s-${cat}-suggest-list`);
    const txtEl = document.getElementById(`s-${cat}-effect`);
    if (!wrap || !list) return;
    if (!suggestions.length) { wrap.style.display = 'none'; list.innerHTML = ''; return; }
    wrap.style.display = '';
    // Encode chaque suggestion en base64 pour passage sans risque dans l'onclick
    list.innerHTML = suggestions.map(s => {
      const encoded = btoa(unescape(encodeURIComponent(s)));
      return `<button type="button" class="cs-spell-suggest-btn"
        data-action="_pickSpellSuggestion" data-cat="${cat}" data-encoded="${encoded}"
        title="Cliquer pour appliquer cette suggestion">↓ ${_esc(s)}</button>`;
    }).join('');
    // Pré-remplissage agressif : si la textarea est vide et jamais touchée,
    // injecte la 1ère suggestion (comportement historique)
    if (txtEl && !txtEl.value.trim() && !txtEl.dataset.userTouched) {
      txtEl.value = suggestions[0];
    }
  };

  renderSuggestions('enchant',    getMatrixSuggestions(matrices, 'enchant',    noyauId, enchSlot));
  renderSuggestions('affliction', getMatrixSuggestions(matrices, 'affliction', noyauId, affSlot));
}

/** Bibliothèque d'icônes pour les sorts (emojis sélectionnés pour le thème JdR). */
const SPELL_ICONS = [
  // Élémentaires
  '🔥','💧','🌪','🌍','⚡','❄️','☀️','🌙','⭐','✨',
  // Offensifs
  '⚔️','🗡️','🏹','💥','💣','☄️','🌋','🌊','🌩','🩸',
  // Soutien / soin
  '🛡️','🛡','💚','💗','❤️‍🩹','✝️','🪽','🕊','🌿','🍀',
  // Contrôle / état
  '💀','☠️','🕸','🪨','🪤','🧊','🔇','😵','🥶','🥵',
  // Magie / arcanes
  '🔮','🪄','📜','📖','🎴','🌀','♾️','♾','🧿','👁️',
  // Invocations / créatures
  '🐾','🐺','🐉','🦅','🦂','🐍','🦋','🦇','🦴','🐾',
  // Divers
  '👊','👋','🫳','🫸','🤚','🪦','🗿','🎭','🃏','🎲',
];

// Ferme le picker quand on clique en dehors
function _bindSortIconPickerOutsideClose() {
  if (_sortIconPickerOutsideBound) return;
  _sortIconPickerOutsideBound = true;
  document.addEventListener('click', (e) => {
    const picker = document.getElementById('s-icon-picker');
    const btn    = document.getElementById('s-icon-btn');
    if (!picker || picker.style.display === 'none') return;
    if (picker.contains(e.target) || btn?.contains(e.target)) return;
    picker.style.display = 'none';
  }, true);
}

function _toggleSortIconPicker() {
  _bindSortIconPickerOutsideClose();
  const picker = document.getElementById('s-icon-picker');
  if (!picker) return;
  if (picker.style.display !== 'none') { picker.style.display = 'none'; return; }
  // Génère la grille à l'ouverture (au cas où la sélection courante a changé)
  const current = document.getElementById('s-icon')?.value || '';
  picker.innerHTML = SPELL_ICONS.map(ic => {
    const sel = ic === current ? ' is-selected' : '';
    return `<button type="button" class="cs-spell-icon-opt${sel}"
      data-action="_pickSortIcon" data-icon="${_esc(ic)}">${ic}</button>`;
  }).join('') + `<button type="button" class="cs-spell-icon-opt cs-spell-icon-opt--clear"
      data-action="_pickSortIcon" data-icon="" title="Aucune icône — utilise celle du noyau">✕</button>`;
  picker.style.display = 'grid';
}

function _pickSortIcon(icon) {
  const hidden = document.getElementById('s-icon');
  const btn    = document.getElementById('s-icon-btn');
  const picker = document.getElementById('s-icon-picker');
  if (hidden) hidden.value = icon;
  if (btn)    btn.textContent = icon || '🔮';
  if (picker) picker.style.display = 'none';
  // Met à jour la preview live
  _updateSortPreview();
}

// Marque la textarea comme "touchée par l'utilisateur" dès qu'il y tape :
// empêche le pré-remplissage agressif d'écraser ses changements ultérieurs.
function _markSpellEffectTouched(cat) {
  const txtEl = document.getElementById(`s-${cat}-effect`);
  if (txtEl) txtEl.dataset.userTouched = '1';
}

/**
 * Applique une suggestion spécifique (base64 encodé) dans la textarea d'effet.
 * Appelé depuis les boutons générés par _refreshSpellSuggestions.
 * cat = 'enchant' | 'affliction'
 */
function _pickSpellSuggestion(cat, encoded) {
  const txtEl = document.getElementById(`s-${cat}-effect`);
  if (!txtEl) return;
  let suggestion = '';
  try { suggestion = decodeURIComponent(escape(atob(encoded))); } catch { suggestion = ''; }
  if (!suggestion) return;
  txtEl.value = suggestion;
  txtEl.dataset.userTouched = '1';                 // évite l'écrasement auto au prochain refresh
  txtEl.dispatchEvent(new Event('input', { bubbles: true })); // trigger preview update
  txtEl.focus();
}

// Compat ascendante : si du code legacy appelle encore _applySpellSuggest,
// on tente de prendre la 1ère suggestion disponible.
function _applySpellSuggest(cat) {
  const list = document.getElementById(`s-${cat}-suggest-list`);
  const firstBtn = list?.querySelector('.cs-spell-suggest-btn');
  if (firstBtn) firstBtn.click();
}

/**
 * Sélectionne un slot pour Enchantement ou Affliction.
 * groupId : 'enchant' ou 'affliction'
 */
/** Toggle Dégâts/État pour l'enchantement. */
function _selectEnchantMode(mode) {
  const hidden = document.getElementById('s-enchant-mode');
  if (hidden) hidden.value = mode;
  ['dmg','toucher','deplacement','etat'].forEach(m =>
    document.getElementById(`s-enchant-mode-${m}`)?.classList.toggle('selected', mode === m));
  const isBonus = ['toucher','deplacement'].includes(mode);
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  show('s-enchant-dmg-block',   mode === 'dmg');
  show('s-enchant-bonus-block', isBonus);
  show('s-enchant-etat-block',  mode === 'etat');
  // Adapte le libellé du champ bonus selon la cible boostée
  const lbl = document.getElementById('s-enchant-bonus-label');
  if (lbl) lbl.textContent = mode === 'toucher' ? '🎯 Bonus au toucher'
                           : mode === 'deplacement' ? '👢 Cases de déplacement en plus' : 'Bonus';
  _updateSortPreview();
}

/** Branche d'Affliction : DoT / État / Lacération. */
function _selectAfflictionMode(mode) {
  const hidden = document.getElementById('s-affliction-mode');
  if (hidden) hidden.value = mode;
  document.getElementById('s-affliction-mode-dot')?.classList.toggle('selected', mode === 'dot');
  document.getElementById('s-affliction-mode-etat')?.classList.toggle('selected', mode === 'etat');
  document.getElementById('s-affliction-mode-laceration')?.classList.toggle('selected', mode === 'laceration');
  const dotBlock = document.getElementById('s-affliction-dot-block');
  const etatBlock = document.getElementById('s-affliction-etat-block');
  const lacBlock = document.getElementById('s-affliction-laceration-block');
  if (dotBlock) dotBlock.style.display = mode === 'dot' ? '' : 'none';
  if (etatBlock) etatBlock.style.display = mode === 'etat' ? '' : 'none';
  if (lacBlock) lacBlock.style.display = mode === 'laceration' ? '' : 'none';
  _updateSortPreview();
}

function _selectSpellSlot(groupId, slotV) {
  const hidden = document.getElementById(`s-${groupId}-slot`);
  if (hidden) hidden.value = slotV;
  // Style des boutons
  SPELL_SLOTS.forEach(opt => {
    const btn = document.getElementById(`s-${groupId}-slot-${opt.v}`);
    if (!btn) return;
    btn.classList.toggle('selected', opt.v === slotV);
  });
  // Section dégâts visible UNIQUEMENT si slot=arme (Enchantement)
  if (groupId === 'enchant') {
    const row = document.getElementById('s-enchant-degats-row');
    if (row) row.style.display = slotV === 'arme' ? '' : 'none';
  }
  _updateSortPreview();
}

export function updateSortPM() {
  const noyau = document.getElementById('s-noyau')?.value||'';
  const total = (noyau ? 1 : 0) +
    Object.values(_runeCountsEdit||{}).reduce((s,v)=>s+v, 0);
  const pm = total * 2 || 2;
  const pmEl = document.getElementById('s-pm');
  const dispEl = document.getElementById('s-pm-display');
  if (pmEl)   pmEl.value = pm;
  if (dispEl) dispEl.textContent = pm;
  _updateSortPreview();
}

/** Reconstruit un objet sort depuis l'état du modal (pour la preview live) */
function _buildSortFromDOM() {
  const noyau       = document.getElementById('s-noyau')?.value || '';
  const noyauTypeId = document.getElementById('s-noyau-id')?.value || '';
  const runes = _buildRunesFromCounts();
  const types = [...(_sortTypesEdit || new Set(['utilitaire']))];
  const dureeBase = parseInt(document.getElementById('s-duree-base')?.value) || 0;
  const deplMode = _deplModeEdit || null;
  const iconRaw  = document.getElementById('s-icon')?.value || '';
  const mjVal    = document.getElementById('s-mj-validation')?.value || 'pending';
  return {
    icon:        iconRaw.trim() || '',
    mjValidation: mjVal, mjValidated: mjVal === 'ok',
    noyau, noyauTypeId, noyauTypeIds: [..._noyauIdsEdit], runes, types,
    actionMode: (_runeCountsEdit?.[ACTION_RUNE] || 0) > 0
      ? (document.getElementById('s-action-mode')?.value || _actionModeEdit || 'reaction')
      : null,
    degats: document.getElementById('s-degats')?.value || '',
    soin:   document.getElementById('s-soin')?.value || '',
    ca:     document.getElementById('s-ca')?.value || '',
    effet:  document.getElementById('s-effet')?.value || '',
    protectionMode: document.getElementById('s-prot-mode')?.value || 'ca',
    enchantDegats:    document.getElementById('s-enchant-degats')?.value?.trim() || '',
    enchantMode:      document.getElementById('s-enchant-mode')?.value || 'dmg',
    enchantBonus:     (() => { const v = document.getElementById('s-enchant-bonus')?.value; const n = parseInt(v); return (v != null && v !== '' && Number.isFinite(n)) ? n : null; })(),
    enchantEtatId:    document.getElementById('s-enchant-etat')?.value || null,
    enchantStateMoveBonus: (() => { const v = document.getElementById('s-enchant-state-move-bonus')?.value; const n = parseInt(v); return (v != null && v !== '' && Number.isFinite(n)) ? n : null; })(),
    enchantStateDmgFormula: document.getElementById('s-enchant-state-dmg-formula')?.value?.trim() || '',
    enchantSlot:      'arme', // legacy compat (preview live, sera écrasé à la save par la valeur en BDD)
    enchantEffect:    document.getElementById('s-enchant-effect')?.value ?? '',
    afflictionSlot:   document.getElementById('s-affliction-slot')?.value || 'arme',
    afflictionMode:   document.getElementById('s-affliction-mode')?.value || 'dot',
    afflictionEffect: document.getElementById('s-affliction-effect')?.value || '',
    afflictionEtatId: document.getElementById('s-affliction-etat')?.value || null,
    afflictionDotFormula: document.getElementById('s-affliction-dot-formula')?.value?.trim() || '',
    regenerationFormula: document.getElementById('s-regeneration-formula')?.value?.trim() || '',
    afflictionSaveStat: document.getElementById('s-affliction-save-stat')?.value || '',
    zoneW: null,
    zoneH: null,
    dureeBase: dureeBase >= 2 ? dureeBase : null,
    deplacement: deplMode ? { mode: deplMode } : null,
    ampMode: document.getElementById('s-amp-mode')?.value || 'zone',
    // Portée + stats overrides : doivent être lus du DOM pour que la preview live
    // et les chips auto reflètent la sélection courante (sinon auto-dérivation kick in).
    portee:      (() => {
      // Distingue champ VIDE (→ null = auto/arme) de la valeur 0 (→ "sur soi")
      const raw = document.getElementById('s-portee')?.value;
      if (raw === '' || raw == null) return null;
      const n = parseInt(raw);
      return Number.isFinite(n) && n >= 0 ? n : null;
    })(),
    toucherStat: _readVisibleStatOverride('s-toucher-stat'),
    degatsStat:  _readVisibleStatOverride('s-degats-stat', 's-degats-stat-soin'),
    invocation:  _buildInvocationFromDOM(),
    mjNotes: document.getElementById('s-mj-notes')?.value || '',
  };
}

/** Rafraîchit la preview live dans l'éditeur de sort */
/** Perso placeholder neutre pour la preview en contexte item (pas de perso actif).
 *  Stats 10 partout (mod 0), Poings (1d6 Phys, portée 1 case), pas d'équipement.
 *  Permet à _buildSortResume / _calcSortDegats / etc. de calculer un aperçu générique. */
function _itemPreviewPlaceholderChar() {
  return {
    id: '__itemPreview',
    nom: 'Objet',
    stats: { force:10, dexterite:10, constitution:10, intelligence:10, sagesse:10, charisme:10 },
    statsBonus: {},
    equipement: { 'Main principale': null },
    maitrises: {}, sort_cats: [], deck_sorts: [], inventaire: [],
    elements: [],
  };
}

function _updateSortPreview() {
  const body = document.getElementById('s-preview-body');
  if (!body) return;
  // En contexte item-edit : on utilise un perso virtuel pour avoir un aperçu générique
  //   (formules de base sans modificateurs perso, ce qui correspond au comportement réel
  //   de l'item — les modificateurs viennent du caster au moment de l'utilisation).
  const c = _modalChar() || (_itemEditCtx ? _itemPreviewPlaceholderChar() : null);
  if (!c) { body.innerHTML = ''; return; }
  if (typeof _refreshAutoValChips === 'function') _refreshAutoValChips();
  if (typeof _refreshSpellSuggestions === 'function') _refreshSpellSuggestions();
  const s = _buildSortFromDOM();
  let lines = [];
  try {
    lines = _buildSortResume(s, c);
  } catch (e) {
    console.warn('[Preview] _buildSortResume a échoué :', e);
    lines = [{ icon:'⚠️', label:'Aperçu indisponible', detail: String(e?.message || e) }];
  }
  body.innerHTML = lines.map(l => `
    <div class="cs-spell-preview-row ${l.isCombo ? 'cs-spell-preview-row--combo' : ''}">
      ${l.icon ? `<span class="cs-spell-preview-icon">${l.icon}</span>` : '<span class="cs-spell-preview-icon"></span>'}
      <span class="cs-spell-preview-label">${_esc(l.label)}</span>
      ${l.detail ? `<span class="cs-spell-preview-detail">${_esc(l.detail)}</span>` : ''}
    </div>
  `).join('');
}

function _setNoyauRequiredError(show, message = 'Sélectionne une rune noyau pour enregistrer ce sort.') {
  const section = document.querySelector('.cs-spell-section--noyau');
  const error   = document.getElementById('s-noyau-error');
  section?.classList.toggle('is-invalid', !!show);
  document.querySelectorAll('.cs-noyau-btn').forEach(btn => {
    btn.setAttribute('aria-invalid', show ? 'true' : 'false');
  });
  if (error) {
    error.textContent = message;
    error.hidden = !show;
  }
}

function _requireNoyauSelection() {
  const allowedIds = _sortAllowedNoyauIds;
  const ids = _noyauIdsEdit.filter(Boolean);
  const hasNoyau = ids.length > 0;
  const hasAccess = !allowedIds || ids.every(id => allowedIds.has(id));
  const valid = hasNoyau && hasAccess;
  const message = hasNoyau && !hasAccess
    ? "Ce noyau n'est pas accessible à ce personnage. Le MJ doit lui débloquer cet élément."
    : 'Sélectionne une rune noyau pour enregistrer ce sort.';
  _setNoyauRequiredError(!valid, message);
  if (!valid) {
    showNotif(message, 'error');
    document.querySelector('.cs-spell-section--noyau')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return valid;
}

export function selectNoyau(el, noyauId, noyauLabel, noyauColor) {
  // Multi-noyau : toggle de l'élément dans la sélection ([0] = primaire).
  const i = _noyauIdsEdit.indexOf(noyauId);
  if (i >= 0) _noyauIdsEdit.splice(i, 1);
  else        _noyauIdsEdit.push(noyauId);
  const on = _noyauIdsEdit.includes(noyauId);
  el.classList.toggle('selected', on);
  if (on && noyauColor) {
    el.style.borderColor = noyauColor;
    el.style.background  = noyauColor + '20';
    el.style.color       = noyauColor;
  } else {
    el.style.borderColor = '';
    el.style.background  = '';
    el.style.color       = '';
  }
  // Primaire = premier sélectionné → conserve s-noyau / s-noyau-id pour la compat
  // (calcul des soins, suggestions matrice, élément par défaut côté VTT).
  const primId  = _noyauIdsEdit[0] || '';
  const primBtn = primId ? document.querySelector(`.cs-noyau-btn[data-noyau-id="${primId}"]`) : null;
  const inputLabel = document.getElementById('s-noyau');
  const inputId    = document.getElementById('s-noyau-id');
  if (inputId)    inputId.value    = primId;
  if (inputLabel) inputLabel.value = primId
    ? (primBtn?.getAttribute('data-noyau-label') || noyauLabel || primId)
    : '';
  _setNoyauRequiredError(_noyauIdsEdit.length === 0);
  // Le changement de noyau affecte le calcul des soins (magique → arme · physique → Con)
  // et les suggestions matrice (Enchant/Affliction · Protection CA)
  updateSortPM();
  if (typeof _refreshAutoValChips === 'function') _refreshAutoValChips();
}


// Signature du CONTENU jouable d'un sort (hors champs volatils : actif, validation,
// catégorie, PM dérivé, notes/flags MJ). Sert à détecter une modification réelle.
function _sortContentSig(s) {
  if (!s) return '';
  const SKIP = new Set(['actif','mjValidation','mjValidated','catId','pm','pmOverride','mjNotes','mjAlwaysMax','enchantSlot']);
  const o = {};
  Object.keys(s).filter(k => !SKIP.has(k)).sort().forEach(k => { o[k] = s[k]; });
  return JSON.stringify(o);
}

export async function saveSort(idx) {
  // Si on édite une action d'item (depuis le shop), on aiguille vers le bon save
  if (_itemEditCtx) return _saveItemSpell();
  if (!_requireNoyauSelection()) return;
    const c = STATE.activeChar; if(!c) return;
    const sorts = c.deck_sorts||[];
    const noyau       = document.getElementById('s-noyau')?.value||'';
    const noyauTypeId = document.getElementById('s-noyau-id')?.value||'';

    // Runes depuis _runeCountsEdit
    const runes = _buildRunesFromCounts();

    const totalRunes = (noyau ? 1 : 0) + runes.length;
    const autoPm     = totalRunes * 2 || 2;

    // Types (multi)
    const types = [...(_sortTypesEdit || new Set(['utilitaire']))];

    // Action override (null = auto)

    const dureeBaseRaw = parseInt(document.getElementById('s-duree-base')?.value) || 0;
    const deplMode = _deplModeEdit || null;

    // Validation MJ (3 états) : seuls les admins peuvent la modifier ; sinon on garde la valeur existante
    const prevVal = idx >= 0 ? (sorts[idx]?.mjValidation || (sorts[idx]?.mjValidated ? 'ok' : 'pending')) : 'pending';
    const mjValidation = STATE.isAdmin
      ? (document.getElementById('s-mj-validation')?.value || 'pending')
      : prevVal;
    const mjValidated  = mjValidation === 'ok'; // rétro-compat booléen

    // PM override (MJ uniquement) : si vide → null (utilise autoPm). Si admin n'existe pas ce champ.
    const pmOvrRaw = STATE.isAdmin ? document.getElementById('s-pm-override')?.value : null;
    const pmOvrInt = pmOvrRaw != null && pmOvrRaw !== '' ? parseInt(pmOvrRaw) : null;
    const pmOverride = (pmOvrInt != null && Number.isFinite(pmOvrInt) && pmOvrInt >= 0)
      ? pmOvrInt
      : (STATE.isAdmin ? null : (idx >= 0 ? sorts[idx]?.pmOverride ?? null : null));
    const newSort = {
      icon:     (document.getElementById('s-icon')?.value || '').trim() || '',
      mjValidation, mjValidated,
      mjAlwaysMax: STATE.isAdmin
        ? !!document.getElementById('s-mj-always-max')?.checked
        : (idx >= 0 ? !!sorts[idx]?.mjAlwaysMax : false),
      nom:      document.getElementById('s-nom')?.value||'Sort',
      pm:       autoPm,
      pmOverride,
      noyau,
      noyauTypeId,
      noyauTypeIds: [..._noyauIdsEdit],
      runes,
      actionMode: (_runeCountsEdit?.[ACTION_RUNE] || 0) > 0
        ? (document.getElementById('s-action-mode')?.value || _actionModeEdit || 'reaction')
        : null,
      types,
      degats:   document.getElementById('s-degats')?.value||'',
      soin:     document.getElementById('s-soin')?.value||'',
      ca:       document.getElementById('s-ca')?.value||'',
      effet:    document.getElementById('s-effet')?.value||'',
      protectionMode: document.getElementById('s-prot-mode')?.value || 'ca',
      // Legacy compat : typeSoin si defensif sans offensif + mode soin
      typeSoin: types.includes('defensif') && !types.includes('offensif') && (document.getElementById('s-prot-mode')?.value === 'soin'),
      catId:         document.getElementById('s-catid')?.value || '',
      actif:         idx>=0 ? sorts[idx].actif : false,
      enchantDegats:    document.getElementById('s-enchant-degats')?.value?.trim() || '',
      enchantMode:      document.getElementById('s-enchant-mode')?.value || 'dmg',
    enchantBonus:     (() => { const v = document.getElementById('s-enchant-bonus')?.value; const n = parseInt(v); return (v != null && v !== '' && Number.isFinite(n)) ? n : null; })(),
      enchantEtatId:    document.getElementById('s-enchant-etat')?.value || null,
      enchantStateMoveBonus: (() => { const v = document.getElementById('s-enchant-state-move-bonus')?.value; const n = parseInt(v); return (v != null && v !== '' && Number.isFinite(n)) ? n : null; })(),
      enchantStateDmgFormula: document.getElementById('s-enchant-state-dmg-formula')?.value?.trim() || '',
      // enchantSlot legacy : conservé en BDD pour rétro-compat des combos, mais
      // l'UI n'expose plus de slot. Défaut 'arme' aligné sur le bonus dégâts.
      enchantSlot:      idx >= 0 ? (sorts[idx]?.enchantSlot || 'arme') : 'arme',
      enchantEffect:    document.getElementById('s-enchant-effect')?.value
                        ?? (idx >= 0 ? (sorts[idx]?.enchantEffect || '') : ''),
      afflictionSlot:    document.getElementById('s-affliction-slot')?.value || 'torse',
      afflictionSaveStat: document.getElementById('s-affliction-save-stat')?.value || '',
      afflictionMode:    document.getElementById('s-affliction-mode')?.value || 'dot',
      afflictionEffect:  document.getElementById('s-affliction-effect')?.value
                         ?? (idx >= 0 ? (sorts[idx]?.afflictionEffect || '') : ''),
      afflictionDotFormula: document.getElementById('s-affliction-dot-formula')?.value?.trim() || '',
      regenerationFormula: document.getElementById('s-regeneration-formula')?.value?.trim() || '',
      afflictionEtatId:  document.getElementById('s-affliction-etat')?.value || null,
      zoneW: null,
      zoneH: null,
      dureeBase:  dureeBaseRaw >= 2 ? dureeBaseRaw : null,
      deplacement: deplMode ? { mode: deplMode } : null,
    ampMode: document.getElementById('s-amp-mode')?.value || 'zone',
      // Portée override : 0 ou vide = utilise la portée de l'arme par défaut (côté VTT)
      portee:     (() => {
        const raw = document.getElementById('s-portee')?.value;
        if (raw === '' || raw == null) return null;
        const n = parseInt(raw);
        return Number.isFinite(n) && n >= 0 ? n : null;
      })(),
      // Stats overrides : '' = suit l'arme principale (auto).
      // On lit uniquement les sélecteurs VISIBLES (helper _readVisibleStatOverride)
      // → évite que le sélecteur d'une section cachée n'écrase la sélection utilisateur.
      toucherStat: _readVisibleStatOverride('s-toucher-stat'),
      degatsStat:  _readVisibleStatOverride('s-degats-stat', 's-degats-stat-soin'),
      invocation:   _buildInvocationFromDOM(),
      mjNotes:      document.getElementById('s-mj-notes')?.value?.trim() || '',
    };
    // Validation : un sort VALIDÉ modifié par un JOUEUR repasse « À valider » et
    // sort du Deck (un sort non validé ne peut pas rester actif). Le MJ pilote la
    // validation explicitement (sélecteur) → on ne touche pas à son choix.
    if (!STATE.isAdmin && idx >= 0 && prevVal === 'ok'
        && _sortContentSig(sorts[idx]) !== _sortContentSig(newSort)) {
      newSort.mjValidation = 'pending';
      newSort.mjValidated  = false;
      newSort.actif        = false;
      showNotif('Sort modifié → repasse « À valider » et sort du Deck.', 'info');
    }

    const isNew = idx < 0;
    if (idx>=0) sorts[idx]=newSort; else sorts.push(newSort);
    c.deck_sorts=sorts;
    // Sync les références pour que les filtres / re-render lisent la version fraîche
    if (charSession.getCurrentChar()?.id === c.id) charSession.set(c, charSession.getCanEditChar(), charSession.getCurrentCharTab());
    if (STATE.activeChar?.id === c.id)    STATE.activeChar    = c;
    if (await trySave('characters',c.id,{deck_sorts:sorts})) {
      closeModal();
      showNotif(`Sort enregistré — ${newSort.pm} PM`, 'success');
    }

    // ── Sur ajout : s'assure que le nouveau sort soit visible ────────
    if (isNew) {
      // Reset les filtres qui pourraient cacher le sort fraîchement créé
      _sortsSearch = '';
      _sortsTypeFilter = '';
      _sortsView = 'all';
      // Déplie la catégorie où le sort vient d'être ajouté
      const newCatId = newSort.catId
        && (c.sort_cats || []).find(cat => cat.id === newSort.catId)
        ? newSort.catId : '__none';
      _sortsCatCollapsed = { ...(_sortsCatCollapsed || {}) };
      _sortsCatCollapsed[newCatId] = false;
    }

    // Force un re-render du tab Sorts en V3 si dispo, sinon fallback legacy
    _renderSpellsTab(c);
}

/** Build d'un objet "sort" depuis le formulaire courant — réutilisable pour items. */
function _buildSortFromForm(idx, prevList = []) {
  const noyau       = document.getElementById('s-noyau')?.value||'';
  const noyauTypeId = document.getElementById('s-noyau-id')?.value||'';
  const runes = _buildRunesFromCounts();
  const totalRunes = (noyau ? 1 : 0) + runes.length;
  const autoPm     = totalRunes * 2 || 2;
  const types = [...(_sortTypesEdit || new Set(['utilitaire']))];
  const dureeBaseRaw = parseInt(document.getElementById('s-duree-base')?.value) || 0;
  const deplMode = _deplModeEdit || null;
  const prevVal = idx >= 0 ? (prevList[idx]?.mjValidation || (prevList[idx]?.mjValidated ? 'ok' : 'pending')) : 'pending';
  const mjValidation = STATE.isAdmin
    ? (document.getElementById('s-mj-validation')?.value || 'pending')
    : prevVal;
  const mjValidated  = mjValidation === 'ok'; // rétro-compat booléen
  const pmOvrRaw = STATE.isAdmin ? document.getElementById('s-pm-override')?.value : null;
  const pmOvrInt = pmOvrRaw != null && pmOvrRaw !== '' ? parseInt(pmOvrRaw) : null;
  const pmOverride = (pmOvrInt != null && Number.isFinite(pmOvrInt) && pmOvrInt >= 0)
    ? pmOvrInt
    : (STATE.isAdmin ? null : (idx >= 0 ? prevList[idx]?.pmOverride ?? null : null));
  return {
    icon:     (document.getElementById('s-icon')?.value || '').trim() || '',
    mjValidation, mjValidated,
    nom:      document.getElementById('s-nom')?.value||'Sort',
    pm:       autoPm,
    pmOverride,
    mjAlwaysMax: STATE.isAdmin
      ? !!document.getElementById('s-mj-always-max')?.checked
      : (idx >= 0 ? !!prevList[idx]?.mjAlwaysMax : false),
    noyau, noyauTypeId, runes,
    actionMode: (_runeCountsEdit?.[ACTION_RUNE] || 0) > 0
      ? (document.getElementById('s-action-mode')?.value || _actionModeEdit || 'reaction')
      : null,
    types,
    degats:   document.getElementById('s-degats')?.value||'',
    soin:     document.getElementById('s-soin')?.value||'',
    ca:       document.getElementById('s-ca')?.value||'',
    effet:    document.getElementById('s-effet')?.value||'',
    protectionMode: document.getElementById('s-prot-mode')?.value || 'ca',
    typeSoin: types.includes('defensif') && !types.includes('offensif') && (document.getElementById('s-prot-mode')?.value === 'soin'),
    enchantDegats:    document.getElementById('s-enchant-degats')?.value?.trim() || '',
    enchantMode:      document.getElementById('s-enchant-mode')?.value || 'dmg',
    enchantBonus:     (() => { const v = document.getElementById('s-enchant-bonus')?.value; const n = parseInt(v); return (v != null && v !== '' && Number.isFinite(n)) ? n : null; })(),
    enchantEtatId:    document.getElementById('s-enchant-etat')?.value || null,
    enchantStateMoveBonus: (() => { const v = document.getElementById('s-enchant-state-move-bonus')?.value; const n = parseInt(v); return (v != null && v !== '' && Number.isFinite(n)) ? n : null; })(),
    enchantStateDmgFormula: document.getElementById('s-enchant-state-dmg-formula')?.value?.trim() || '',
    enchantSlot:      idx >= 0 ? (prevList[idx]?.enchantSlot || 'arme') : 'arme',
    enchantEffect:    document.getElementById('s-enchant-effect')?.value ?? '',
    afflictionSlot:   document.getElementById('s-affliction-slot')?.value || 'torse',
    afflictionSaveStat: document.getElementById('s-affliction-save-stat')?.value || '',
    afflictionMode:   document.getElementById('s-affliction-mode')?.value || 'dot',
    afflictionEffect: document.getElementById('s-affliction-effect')?.value ?? '',
    afflictionDotFormula: document.getElementById('s-affliction-dot-formula')?.value?.trim() || '',
    regenerationFormula: document.getElementById('s-regeneration-formula')?.value?.trim() || '',
    afflictionEtatId: document.getElementById('s-affliction-etat')?.value || null,
    zoneW: null, zoneH: null,
    dureeBase:  dureeBaseRaw >= 2 ? dureeBaseRaw : null,
    deplacement: deplMode ? { mode: deplMode } : null,
    ampMode: document.getElementById('s-amp-mode')?.value || 'zone',
    portee:     (() => {
      const raw = document.getElementById('s-portee')?.value;
      if (raw === '' || raw == null) return null;
      const n = parseInt(raw);
      return Number.isFinite(n) && n >= 0 ? n : null;
    })(),
    toucherStat: _readVisibleStatOverride('s-toucher-stat'),
    degatsStat:  _readVisibleStatOverride('s-degats-stat', 's-degats-stat-soin'),
    mjNotes:      document.getElementById('s-mj-notes')?.value?.trim() || '',
  };
}

/** Hook de sauvegarde aiguillée : utilisé quand on édite une action d'item.
 *  Lance _itemEditCtx.onSave avec l'item mis à jour, puis ferme. */
async function _saveItemSpell() {
  if (!_itemEditCtx) return false;
  try {
    if (!_requireNoyauSelection()) return false;
    const { item, idx, onSave } = _itemEditCtx;
    const acts = Array.isArray(item.actions) ? [...item.actions] : [];
    const newSort = _buildSortFromForm(idx, acts);
    if (!newSort.id) newSort.id = idx >= 0 ? (acts[idx]?.id || `a${Date.now().toString(36)}`) : `a${Date.now().toString(36)}`;
    if (idx >= 0) acts[idx] = { ...acts[idx], ...newSort };
    else acts.push(newSort);
    item.actions = acts;
    const cb = onSave;
    _itemEditCtx = null;
    // 1) Pop la modal de sort → la modal du shop est restaurée à l'écran
    closeModal();
    // 2) Maintenant on déclenche le callback shop pour rafraîchir la section actions
    //    (l'#si-actions-host est de nouveau dans le DOM après la restauration)
    await cb(item);
    showNotif(`Action enregistrée — ${newSort.pm} PM`, 'success');
    return true;
  } catch (e) {
    notifySaveError(e);
    return false;
  }
}

// (le check _itemEditCtx est désormais en tête de saveSort — pas de monkey-patch)

registerActions({
  _sortsSearchInput:      (el)  => _sortsSetSearch(el.value),
  _refreshAutoValChips:   ()    => _refreshAutoValChips(),
  _csMjValToggle:         (el)  => el.closest('.cs-mj-validation')?.classList.toggle('is-on', el.checked),
  _csSetMjVal:            (btn) => {
    const val = btn.dataset.mjval;
    const inp = document.getElementById('s-mj-validation');
    if (inp) inp.value = val;
    document.querySelectorAll('.cs-mjval-btn').forEach(b => b.classList.toggle('is-active', b.dataset.mjval === val));
    window._updateSortPreview?.();
  },
  addSort:                ()    => addSort(),
  openSortCatEditor:      ()    => openSortCatEditor(),
  toggleSortDetail:       (btn) => toggleSortDetail(Number(btn.dataset.idx)),
  editSort:               (btn) => editSort(Number(btn.dataset.idx)),
  saveSort:               (btn) => saveSort(Number(btn.dataset.idx)),
  selectNoyau:            (btn) => selectNoyau(btn, btn.dataset.noyauId, btn.dataset.noyauLabel, btn.dataset.noyauColor),
  runeIncrement:          (btn) => runeIncrement(btn.dataset.nom),
  runeDecrement:          (btn) => runeDecrement(btn.dataset.nom),
  _mjAdjRuneLimit:        (btn) => _mjAdjRuneLimit(btn.dataset.delta),
  closeModalDirect:       ()    => closeModalDirect(),
  _enableSortCustom:      (btn) => _enableSortCustom(btn.dataset.field),
  _disableSortCustom:     (btn) => _disableSortCustom(btn.dataset.field),
  _sortsSetSearch:        (btn) => _sortsSetSearch(btn.dataset.val),
  _sortsSetView:          (btn) => _sortsSetView(btn.dataset.view),
  _sortsSetType:          (btn) => _sortsSetType(btn.dataset.type),
  _sortsAdjRuneLimit:     (btn) => _sortsAdjRuneLimit(btn.dataset.delta),
  _sortsToggleCat:        (btn) => _sortsToggleCat(btn.dataset.id),
  _sortsToggleAllCats:    ()    => _sortsToggleAllCats(),
  _sortsResetFilters:     ()    => _sortsResetFilters(),
  _renameSortCat:         (el)  => _renameSortCat(Number(el.dataset.idx), el.value),
  _recolorSortCat:        (btn) => _recolorSortCat(Number(btn.dataset.idx), btn.dataset.col),
  _delSortCat:            (btn) => _delSortCat(Number(btn.dataset.idx)),
  _addSortCat:            (btn) => _addSortCat(btn.dataset.col),
  _toggleSortType:        (btn) => _toggleSortType(btn.dataset.type),
  _selectDeplMode:        (btn) => _selectDeplMode(btn.dataset.val),
  _selectActionMode:      (btn) => _selectActionMode(btn.dataset.val),
  _selectProtMode:        (btn) => _selectProtMode(btn.dataset.val),
  _selectAmpMode:         (btn) => _selectAmpMode(btn.dataset.val),
  _selectEnchantMode:     (btn) => _selectEnchantMode(btn.dataset.val),
  _selectAfflictionMode:  (btn) => _selectAfflictionMode(btn.dataset.val),
  _toggleSortIconPicker:  ()    => _toggleSortIconPicker(),
  _pickSortIcon:          (btn) => _pickSortIcon(btn.dataset.icon),
  _pickSpellSuggestion:   (btn) => _pickSpellSuggestion(btn.dataset.cat, btn.dataset.encoded),
  _invPickImage:          ()    => _invPickImage(),
  _invClearImage:         ()    => _invClearImage(),
  _invCropSave:           ()    => _invCropSave(),
  _invCropCancel:         ()    => _invCropCancel(),
  _openInvocationConfig:  (btn) => openInvocationConfig(Number(btn.dataset.idx)),
  _invCfgAddAction:       ()    => _invCfgAddAction(),
  _invCfgEditAction:      (btn) => _invCfgEditAction(btn.dataset.aidx),
  _invCfgDeleteAction:    (btn) => _invCfgDeleteAction(btn.dataset.aidx),
  // Bibliothèque d'invocations + sélecteur
  openInvocationLibrary:  ()    => openInvocationLibrary(),
  _editLibInv:            (btn) => _editLibInv(Number(btn.dataset.idx)),
  _deleteLibInv:          (btn) => _deleteLibInv(Number(btn.dataset.idx)),
  _saveLibInv:            ()    => _saveLibInv(),
  _libInvBack:            ()    => _libInvBack(),
  _libInvAddAction:       ()    => _libInvAddAction(),
  _libInvEditAction:      (btn) => _libInvEditAction(btn.dataset.aidx),
  _libInvDeleteAction:    (btn) => _libInvDeleteAction(btn.dataset.aidx),
  _toggleInvSelect:       (btn) => _toggleInvSelect(btn.dataset.id),
});
