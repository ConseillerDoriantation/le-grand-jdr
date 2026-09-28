import { STATE } from '../core/state.js';
import { loadCollection, loadChars, addToCol, updateInCol, deleteFromCol, batchUpdateInCol, getDocDataSilent, saveDoc } from '../data/firestore.js';
import { deleteField } from '../config/firebase.js';
import { confirmDelete, trySave } from '../shared/crud.js';
import { openModal, pushModal, updateModalContent, closeModalDirect, confirmModal, promptModal } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { RARETE_NAMES, _rareteColor, buildRaretePicker, pickRarete, loadRarities, openRaritiesAdmin } from '../shared/rarity.js';
import { _esc, _norm, _searchIncludes, loadingHtml, eyeIcon } from '../shared/html.js';
import { lsJson } from '../shared/local-storage.js';
import { calcOr, computeEquipStatsBonus, getItemStatBonus, calcCA, calcPVMax, calcPMMax, calcVitesse, ITEM_STAT_META, statShort as _statShort, getDefaultCharForUser } from '../shared/char-stats.js';
import { useGold } from '../shared/economy.js';
import { loadWeaponFormats } from '../shared/weapon-formats.js';
import { WEAPON_HANDS_OPTIONS, hasWeaponDefaults, normalizeWeaponDefaults, resolveWeaponFamily, weaponHandsLabel } from '../shared/weapon-family.js';
import { loadDamageTypes } from '../shared/damage-types.js';
import { DAMAGE_RELATIONS } from '../shared/damage-profile.js';
import { getShopItemEditableText, shopItemToInvEntry } from '../shared/inventory-utils.js';
import { sanitizeRichTextHtml } from '../shared/rich-text.js';
import { bindQuillEditors, getQuillHtml, markQuillSaved, quillEditorHtml } from '../shared/rich-text-quill.js';
import { inventoryHistoryPayload, makeInventoryHistoryEntry, inventoryHistoryEntries } from '../shared/inventory-history.js';
import { openUpgradeSettingsAdmin } from '../shared/upgrade-settings.js';
import { getArmorTypeOptions } from '../shared/armor-set-settings.js';
import { mountArtisanPage, unmountArtisanPage } from './artisan.js';
import {
  openShopExport, switchShopExportTab, selectAllShopExport,
  doShopExport, previewShopImport, doShopImport,
} from './shop-export.js';
import {
  ITEM_STATS, ITEM_STAT_BY_KEY,
  _parseLegacyStats, _legacyStatsTextFromData,
  _formatDegatsStatsText, _legacyToucherTextFromData,
  _getRareteNum, _getItemStatFilterKeys,
} from './shop-item-stats.js';
import { openWeaponFormatsAdmin } from './characters/data.js';
import { syncEquipmentAfterInventoryMutation, normalizeStatKey as _normalizeStatKey, getWeaponDamageStatKeys as _getDegatsStats, isWeaponLikeItem } from '../shared/equipment-utils.js';
import { autocompleteHTML, initAutocomplete } from '../shared/autocomplete.js';
import { bindScopedActions } from '../shared/scoped-actions.js';
import { getShopCharId, setShopCharId } from '../shared/shop-session.js';
import { characterPortraitContent, characterAvatarHtml } from '../shared/portraits.js';
import { loadConditionLibrary } from '../shared/conditions.js';
import { makeSortable } from '../shared/sortable-helper.js';
import { compareManualOrder, manualOrderValue, mergeVisibleManualOrder, nextManualOrder } from '../shared/manual-order.js';
import { spellActionCardHtml } from '../shared/spell-action-card.js';
import { getVisibleCharacters } from '../shared/character-state.js';
import { consumeTargetEntity } from '../shared/entity-navigation.js';
import {
  equipmentSlotAcceptsItem, getEquipmentItemOptions, getEquipmentSlot,
  getEquipmentSlots, resolveEquipmentSlotForItem,
} from '../shared/equipment-slots.js';

// ══════════════════════════════════════════════════════════════════════════════
// DÉLÉGATION D'ÉVÉNEMENTS — remplace les onclick/oninput/onchange inline
// Pattern : <button data-sh-action="open" data-id="…">…</button>
// + shHandlers.open = (el) => openItemModal(el.dataset.id)
// ══════════════════════════════════════════════════════════════════════════════
const shHandlers = {};
bindScopedActions('sh', shHandlers);
document.addEventListener('keydown', _shopKeyboardQol);

// ══════════════════════════════════════════════════════════════════════════════
function _inventoryHistoryActor() {
  return {
    actorUid: STATE.user?.uid || '',
    actorName: STATE.user?.pseudo || STATE.user?.displayName || STATE.user?.email || '',
  };
}

// TEMPLATES DE CHAMPS PAR TYPE DE BOUTIQUE
// ══════════════════════════════════════════════════════════════════════════════
const TEMPLATES = {
  arme: {
    label: '⚔️ Arme',
    fields: [
      { id:'format',      label:'Type d\'arme',  type:'format_select' },
      { id:'mains',       label:'Maniement',     type:'select', options: WEAPON_HANDS_OPTIONS },
      { id:'rarete',      label:'Rareté',        type:'rarete' },
      { id:'degats',      label:'Dégâts',        type:'damage_with_stat', placeholder:'1D10, 2D6...' },
      { id:'toucherStat', label:'Toucher',       type:'stat_select' },
      { id:'portee',      label:'Portée',        type:'text',   placeholder:'Contact, 1m50, 9m / 27m...' },
      { id:'statBonuses', label:'Bonus de stats',type:'stat_bonus_grid' },
      { id:'derivedBonuses', label:'Bonus dérivés', type:'derived_bonus_grid' },
      { id:'skillBonuses',   label:'Bonus de compétences', type:'skill_bonus_grid' },
      { id:'traits',      label:'Traits',        type:'trait_list', placeholder:'Ajouter un trait...' },
      { id:'prix',        label:'Prix 🪙',       type:'number', placeholder:'0' },
      { id:'dispo',       label:'Dispo',         type:'dispo' },
    ],
  },
  armure: {
    label: '🛡️ Armure',
    fields: [
      { id:'slotArmure',  label:'Emplacement',   type:'select',
        options:['Tête','Torse','Pieds'] },
      { id:'typeArmure',  label:'Type',          type:'select',
        options:[] },
      { id:'rarete',      label:'Rareté',        type:'rarete' },
      { id:'ca',          label:'CA bonus',      type:'number', placeholder:'0' },
      { id:'statBonuses', label:'Bonus de stats',type:'stat_bonus_grid' },
      { id:'derivedBonuses', label:'Bonus dérivés', type:'derived_bonus_grid' },
      { id:'skillBonuses',   label:'Bonus de compétences', type:'skill_bonus_grid' },
      { id:'traits',      label:'Traits',        type:'trait_list', placeholder:'Ajouter un trait...' },
      { id:'prix',        label:'Prix 🪙',       type:'number', placeholder:'0' },
      { id:'dispo',       label:'Dispo',         type:'dispo' },
    ],
  },
  bijou: {
    label: '💍 Bijou',
    fields: [
      { id:'slotBijou',   label:'Emplacement',   type:'select',
        options:['Amulette','Anneau','Objet magique'] },
      { id:'rarete',      label:'Rareté',        type:'rarete' },
      { id:'statBonuses', label:'Bonus de stats',type:'stat_bonus_grid' },
      { id:'derivedBonuses', label:'Bonus dérivés', type:'derived_bonus_grid' },
      { id:'skillBonuses',   label:'Bonus de compétences', type:'skill_bonus_grid' },
      { id:'traits',      label:'Traits',        type:'trait_list', placeholder:'Ajouter un trait...' },
      { id:'prix',        label:'Prix 🪙',       type:'number', placeholder:'0' },
      { id:'dispo',       label:'Dispo',         type:'dispo' },
    ],
  },
  classique: {
    label: '🧪 Classique',
    fields: [
      { id:'type',        label:'Type',          type:'text',     placeholder:'Consommable, Matériau, Accessoire...' },
      { id:'effet',       label:'Description',   type:'textarea', placeholder:'(Action) Rend 10 PV...' },
      { id:'prix',        label:'Prix 🪙',       type:'number',   placeholder:'0' },
      { id:'dispo',       label:'Dispo',         type:'dispo' },
    ],
  },
  libre: {
    label: '📦 Libre',
    fields: [
      { id:'type',        label:'Type',          type:'text',     placeholder:'Type...' },
      { id:'description', label:'Description',   type:'textarea', placeholder:'...' },
      { id:'prix',        label:'Prix 🪙',       type:'number',   placeholder:'0' },
      { id:'dispo',       label:'Dispo',         type:'dispo' },
    ],
  },
};

const PRIX_VENTE_RATIO = 0.6; // 60%

// ══════════════════════════════════════════════════════════════════════════════
// ÉTAT
// ══════════════════════════════════════════════════════════════════════════════
let _cats  = [];
let _items = [];
let _shopReadableDraft = null;
let _shopSousTypes = [];
let _shopCharactersScope = '';
let _shopCharactersLoad = null;
// Index local id → texte normalisé : recherches et filtres sans lecture Firestore.
let _shopSearchText = new Map();
function _setShopCharId(id = '') {
  setShopCharId(id);
}
let _weaponFormats = [];
let _view  = 'home';   // 'home' (tous les articles) | 'items' (une catégorie)
let _shopSection = 'shop'; // shop | atelier | artisan
let _artisanNeedsReset = false;
let _activeCat = null;
let _page = 1;
let _pendingTargetShopItemId = null;
let _pendingTargetShopMode = '';
const PAGE_SIZE = 24; // divisible par 2, 3, 4 et 6 colonnes

// Filtres actifs (multi-sélection)
let _filterSearch = '';
let _filterTags   = new Set(); // valeurs de tags actifs
let _filterSort   = localStorage.getItem('shop_sort') || 'ordre'; // ordre | nom | prix_asc | prix_desc | rarete
// ── Smart filters (refonte boutique — lot 3) ────────────────────────────────
// Ensemble de chips actives parmi : fav | payable | boost | upgrade | new.
// Les filtres se cumulent en AND ; les compteurs sont recalculés à chaque render.
let _smartFilters = new Set();

// ── Favoris boutique (par utilisateur, en localStorage → aucun coût Firestore) ──
let _shopFavs = null;
function _favKey() { return `shopFavs:${STATE.user?.uid || 'anon'}`; }
function _getFavs() {
  if (!_shopFavs) _shopFavs = new Set(lsJson.get(_favKey(), []) || []);
  return _shopFavs;
}
function _isFav(id) { return _getFavs().has(id); }
function toggleFav(id) {
  if (!id) return;
  const f = _getFavs();
  if (f.has(id)) f.delete(id); else f.add(id);
  lsJson.set(_favKey(), [...f]);
  // Atelier ouvert : on le rafraîchit ; catalogue : résultats + compteurs seulement.
  if (document.getElementById('atelier-items-col')) _renderAtelier();
  else if (document.getElementById('sh-items-results')) _refreshSmartFiltersFromCache();
  else renderShop();
}
const SMART_KINDS = ['fav', 'payable', 'boost', 'upgrade', 'new'];
const CHAR_SMART_KINDS = new Set(['payable', 'boost', 'upgrade']);

// ── Préférences d'affichage (localStorage, propres à ce navigateur) ──
// Vue : 'grille' (cartes) | 'liste' (tableau dense). Reprend l'ancien réglage
// « Liste » des tweaks s'il existait. Le panneau Filtres garde son état ouvert.
function _lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function _lsSet(key, val) { try { localStorage.setItem(key, val); } catch {} }
let _shopView = (() => {
  const v = _lsGet('shop_view');
  if (v === 'grille' || v === 'liste') return v;
  try { return JSON.parse(_lsGet('shop_tweaks') || '{}')?.card === 'liste' ? 'liste' : 'grille'; }
  catch { return 'grille'; }
})();
let _filtersOpen = _lsGet('shop_filters_open') === '1';

// Menus déroulants <details> de l'en-tête (Gérer, personnage) : fermés au clic
// extérieur et dès qu'une option est choisie.
document.addEventListener('click', (e) => {
  document.querySelectorAll('.shc-manage[open], .sh-char-picker[open]').forEach(d => {
    if (!d.contains(e.target) || e.target.closest('.shc-manage-opt')) d.open = false;
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CHARGEMENT
// ══════════════════════════════════════════════════════════════════════════════
async function loadShopData() {
  const [cats, items, weaponFormats] = await Promise.all([
    loadCollection('shopCategories'),
    loadCollection('shop'),
    loadWeaponFormats(),
    loadRarities(),
  ]);
  _cats = cats;
  _items = items;
  _weaponFormats = weaponFormats;
  _cats.sort((a,b) => (a.ordre||0)-(b.ordre||0));
  _items.sort(compareManualOrder);
  _shopSousTypes = [...new Set(_items.filter(i=>i.sousType).map(i=>i.sousType))].sort();
  _rebuildShopSearchIndex();
}

async function loadShopCharacters() {
  const scope = `${STATE.adventure?.id || ''}:${STATE.isAdmin ? 'all' : STATE.user?.uid || ''}`;
  if (_shopCharactersScope === scope) return;
  if (_shopCharactersLoad?.scope === scope) return _shopCharactersLoad.promise;

  // La délégation est portée par chaque fiche : il faut donc charger la
  // collection live complète avant de filtrer propriétaire + délégués.
  const promise = loadChars()
    .then(chars => {
      STATE.characters = chars;
      _shopCharactersScope = scope;
    })
    .finally(() => {
      if (_shopCharactersLoad?.scope === scope) _shopCharactersLoad = null;
    });
  _shopCharactersLoad = { scope, promise };
  return promise;
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function _catEmoji(nom) {
  const n = (nom||'').toLowerCase();
  if (n.includes('arme'))                          return '⚔️';
  if (n.includes('armure') || n.includes('armor')) return '🛡️';
  if (n.includes('bijou') || n.includes('anneau') || n.includes('amulette')) return '💍';
  if (n.includes('potion'))                        return '🧪';
  if (n.includes('magie') || n.includes('rune'))   return '✨';
  if (n.includes('épicerie') || n.includes('cuisine')) return '🍖';
  if (n.includes('outil'))                         return '🔧';
  return '📦';
}

// ──────────────────────────────────────────────────────────────────────────────
// VISIBILITÉ — une catégorie « masquée » et tous ses articles sont cachés aux
// joueurs dans la boutique. Ils restent accessibles via le butin et leur
// revente fonctionne toujours (le prix de revente est stocké sur l'objet).
// ──────────────────────────────────────────────────────────────────────────────
function _visibleCats() {
  return STATE.isAdmin ? _cats : _cats.filter(c => !c.masquee);
}
function _visibleItems() {
  if (STATE.isAdmin) return _items;
  const hidden = new Set(_cats.filter(c => c.masquee).map(c => c.id));
  // Un article `masque` (par le MJ) est caché aux joueurs, comme une catégorie
  // masquée. Il reste récupérable en butin et revendable (prix stocké sur l'objet).
  return _items.filter(i => !i.masque && !hidden.has(i.categorieId));
}

// ══════════════════════════════════════════════════════════════════════════════
// ANIMATION — count-up/down d'un nombre
// ══════════════════════════════════════════════════════════════════════════════
function _animateCount(el, from, to, duration = 400) {
  if (!el) return;
  const start = performance.now();
  const delta = to - from;
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + delta * eased);
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = to;
  }
  requestAnimationFrame(tick);
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDER PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
// Menu MJ « Gérer » de l'en-tête (remplace l'ancienne barre de 6 boutons).
function _renderManageMenu() {
  if (!STATE.isAdmin) return '';
  const opt = (action, label, title) =>
    `<button type="button" class="shc-manage-opt" role="menuitem" data-sh-action="${action}" title="${title}">${label}</button>`;
  return `<details class="shc-manage">
    <summary class="shc-btn" aria-label="Gérer la boutique">Gérer <span class="shc-caret" aria-hidden="true">⌄</span></summary>
    <div class="shc-manage-menu" role="menu">
      ${opt('openItemModal', '＋ Nouvel article', 'Créer un article')}
      ${opt('openCatModal', '📁 Nouvelle catégorie', 'Créer une catégorie')}
      <hr>
      ${opt('openWeaponFmts', '⚔️ Types d’arme', 'Gérer les types d’arme et leurs techniques')}
      ${opt('openRarities', '★ Raretés', 'Gérer les raretés')}
      ${opt('openUpgradeStg', '⚙️ Améliorations', 'Tarifs et plafonds des améliorations')}
      <hr>
      ${opt('openExport', '⬆️ Export / Import', 'Exporter ou importer la boutique')}
    </div>
  </details>`;
}

export async function renderShop() {
  await Promise.all([loadShopData(), loadShopCharacters()]);
  const target = consumeTargetEntity('shop');
  const targetItemId = target?.id || _pendingTargetShopItemId;
  const targetMode = target?.meta?.mode || _pendingTargetShopMode || 'detail';
  let targetItemToOpen = null;
  if (targetItemId) {
    const item = _items.find(i => i.id === targetItemId);
    if (item) {
      _shopSection = 'shop';
      _view = 'items';
      _activeCat = _cats.some(c => c.id === item.categorieId) ? item.categorieId : '__uncategorized__';
      _filterSearch = '';
      _filterTags.clear();
      _smartFilters.clear();
      const visibleItems = _getFilteredItems(_activeCat);
      const idx = visibleItems.findIndex(i => i.id === item.id);
      _page = idx >= 0 ? Math.floor(idx / PAGE_SIZE) + 1 : 1;
      targetItemToOpen = { id: item.id, mode: targetMode };
      _pendingTargetShopItemId = null;
      _pendingTargetShopMode = '';
    } else {
      _pendingTargetShopItemId = targetItemId;
      _pendingTargetShopMode = targetMode;
    }
  }
  // Un joueur ne peut pas rester sur une catégorie devenue masquée (ni personne
  // sur une catégorie supprimée entre-temps).
  if (_view === 'items' && _activeCat !== '__uncategorized__') {
    const cat = _cats.find(c => c.id === _activeCat);
    if (!cat || (!STATE.isAdmin && cat.masquee)) { _view = 'home'; _activeCat = null; }
  }
  const content = document.getElementById('main-content');
  if (!content) return;

  let html = `<div class="sh-page sh-page--v2">`;
  const visibleShopItems = _visibleItems();
  const visibleShopCats = _visibleCats();
  const pageContext = _shopSection === 'atelier'
    ? 'Composer et comparer un équipement avant achat'
    : _shopSection === 'artisan'
      ? 'Améliorer, sertir et recycler son équipement'
      : `${visibleShopItems.length} article${visibleShopItems.length !== 1 ? 's' : ''} · ${visibleShopCats.length} catégorie${visibleShopCats.length !== 1 ? 's' : ''}`;

  // ── Char-strip riche (avatar + select + or proéminent) ──
  const activeChar = _getActiveShopChar();
  const chars      = _getShopChars();
  const charStripHtml = chars.length ? (() => {
    const or = calcOr(activeChar);
    // Portrait résolu proprement (photoURL/photo/avatar…) via le helper partagé,
    // plus grand → on voit d'un coup d'œil pour qui on achète.
    const avatar = (c, size) => characterAvatarHtml(c, { size, border: '1px solid rgba(255,255,255,.16)' });
    const subOf = (c) => [c?.niveau ? `Niv.${c.niveau}` : '', c?.classe ? _esc(c.classe) : ''].filter(Boolean).join(' · ');
    const orPill = `<span class="sh-char-strip-or" title="Solde du personnage">
          <span class="sh-char-strip-or-val">${or}</span>
          <small>or</small>
        </span>`;
    const triggerInner = `${avatar(activeChar, 36)}
        <span class="sh-char-picker-copy"><strong>${_esc(activeChar?.nom || '?')}</strong>${subOf(activeChar) ? `<small>${subOf(activeChar)}</small>` : ''}</span>`;

    // Un seul personnage : pas de menu, juste la carte identité.
    if (chars.length === 1) {
      return `<div class="sh-char-strip" title="Personnage actif">
        <div class="sh-char-picker-trigger sh-char-picker-trigger--solo">${triggerInner}</div>
        ${orPill}
      </div>`;
    }

    // Plusieurs : menu déroulant à portraits.
    return `<div class="sh-char-strip">
        <details class="sh-char-picker">
          <summary class="sh-char-picker-trigger" aria-label="Changer de personnage">
            ${triggerInner}
            <span class="sh-char-picker-chevron" aria-hidden="true">⌄</span>
          </summary>
          <div class="sh-char-picker-menu">
            ${chars.map(c => {
              const sub = [subOf(c), (STATE.isAdmin && c.ownerPseudo) ? _esc(c.ownerPseudo) : ''].filter(Boolean).join(' — ');
              return `<button type="button" class="sh-char-picker-option${c.id === activeChar?.id ? ' is-active' : ''}" data-sh-action="setChar" data-id="${_esc(c.id)}">
              ${avatar(c, 34)}
              <span class="sh-char-picker-option-copy"><strong>${_esc(c.nom || '?')}</strong>${sub ? `<small>${sub}</small>` : ''}</span>
              ${c.id === activeChar?.id ? '<span class="sh-char-picker-check" aria-hidden="true">✓</span>' : ''}
            </button>`;
            }).join('')}
          </div>
        </details>
        ${orPill}
      </div>`;
  })() : '';

  html += `
    <header class="sh-page-top sh-topbar sh-topbar--v2">
      <div class="sh-page-top-in">
        <div class="sh-page-top-row">
          <div class="sh-page-brand sh-topbar-title-wrap">
            <h1 class="sh-topbar-title">Boutique</h1>
            <small class="sh-topbar-subtitle">${_esc(pageContext)}</small>
          </div>

          <div class="sh-topbar-tools">
            <div class="sh-topbar-character">${charStripHtml}</div>
            ${_shopSection === 'shop' ? `
              <button type="button" class="shc-btn" data-sh-action="openShopHistory" title="Historique des objets achetés et vendus" aria-label="Historique">🧾<span class="shc-btn-lbl">Historique</span></button>
              ${_renderManageMenu()}
            ` : ''}
          </div>
        </div>
  `;

  html += `
      <nav class="sh-page-tabs" role="tablist" aria-label="Sections de la boutique">
        <button type="button" class="sh-page-tab ${_shopSection === 'shop' ? 'active' : ''}"
          data-sh-action="setSection" data-section="shop" role="tab" aria-selected="${_shopSection === 'shop'}">
          <span aria-hidden="true">🛍️</span> Boutique
        </button>
        <button type="button" class="sh-page-tab ${_shopSection === 'atelier' ? 'active' : ''}"
          data-sh-action="setSection" data-section="atelier" role="tab" aria-selected="${_shopSection === 'atelier'}">
          <span aria-hidden="true">🪄</span> Atelier
        </button>
        <button type="button" class="sh-page-tab ${_shopSection === 'artisan' ? 'active' : ''}"
          data-sh-action="setSection" data-section="artisan" role="tab" aria-selected="${_shopSection === 'artisan'}">
          <span aria-hidden="true">🔨</span> Artisan
        </button>
      </nav>
      </div>
    </header>

    <div class="sh-page-body">
      ${_shopSection === 'atelier'
        ? _renderAtelierPage()
        : _shopSection === 'artisan'
          ? `<div class="sh-artisan-page" id="sh-artisan-page" aria-live="polite">${loadingHtml('Préparation de l\'artisan…')}</div>`
          : _renderCatalog()}
    </div>
  </div>`;

  content.innerHTML = html;
  if (_shopSection === 'shop') {
    unmountArtisanPage();
    _mountSortables();
  } else if (_shopSection === 'atelier') {
    unmountArtisanPage();
    _renderAtelier();
  } else {
    await mountArtisanPage('sh-artisan-page', { reset: _artisanNeedsReset });
    _artisanNeedsReset = false;
  }
  if (targetItemToOpen) {
    requestAnimationFrame(() => {
      const card = [...document.querySelectorAll('[data-item-id]')]
        .find(el => el.dataset.itemId === targetItemToOpen.id);
      card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (targetItemToOpen.mode !== 'list') openShopItemDetail(targetItemToOpen.id);
    });
  }
}

function _renderNoCharBanner() {
  if (_getActiveShopChar()) return '';
  const hasAnyChar = _getShopChars().length > 0;
  const msg = hasAnyChar
    ? 'Sélectionne un personnage pour pouvoir acheter.'
    : 'Crée un personnage pour pouvoir acheter dans la boutique.';
  return `<div class="sh-no-char-banner" role="status">
    <span class="sh-no-char-banner-icon">🧙</span>
    <span class="sh-no-char-banner-text">${msg}</span>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// CATALOGUE — rail des catégories + barre d'outils + résultats.
// « Tout » (_view 'home', _activeCat null) et une catégorie partagent le même
// rendu : seule la base d'articles change.
// ══════════════════════════════════════════════════════════════════════════════
const _SVG_GRID = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
const _SVG_LIST = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const _SVG_FILTER = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12l-4.6 5.3v4.6L6.6 14.3V8.3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';

function _catInfo(catId) {
  if (!catId) return { id: null, nom: 'Tous les articles' };
  if (catId === '__uncategorized__') return { id: catId, nom: 'Non classé', emoji: '📦', template: 'classique' };
  return _cats.find(c => c.id === catId) || null;
}

function _renderRail() {
  const items = _visibleItems();
  const countBy = new Map();
  items.forEach(i => countBy.set(i.categorieId, (countBy.get(i.categorieId) || 0) + 1));
  const orphans = items.filter(i => !_cats.some(c => c.id === i.categorieId)).length;
  const link = ({ id = null, nom, ico, count, masked = false, sortable = false }) => {
    const active = id ? (_view === 'items' && _activeCat === id) : _view === 'home';
    return `<button type="button" class="shc-rail-link${active ? ' is-active' : ''}${masked ? ' is-masked' : ''}${sortable ? ' sh-sortable-item' : ''}"
      data-sh-action="${id ? 'goCat' : 'goHome'}"${id ? ` data-id="${_esc(id)}" data-cat-id="${_esc(id)}"` : ''}${active ? ' aria-current="page"' : ''}>
      <span class="shc-rail-ico" aria-hidden="true">${ico}</span>
      <span class="shc-rail-name">${_esc(nom)}</span>
      ${masked ? `<span class="shc-rail-eye" title="Masquée aux joueurs">${eyeIcon(true)}</span>` : ''}
      <span class="shc-rail-count">${count}</span>
    </button>`;
  };
  return `<nav class="shc-rail" aria-label="Catégories de la boutique">
    ${link({ nom: 'Tout', ico: '<svg class="shc-rail-svg"><use href="./assets/img/icons.svg#icon-bag"/></svg>', count: items.length })}
    <div class="shc-rail-list${STATE.isAdmin ? ' sh-sortable' : ''}" id="sh-cat-rail">
      ${_visibleCats().map(cat => link({
        id: cat.id, nom: cat.nom, ico: _esc(cat.emoji || _catEmoji(cat.nom)),
        count: countBy.get(cat.id) || 0, masked: !!cat.masquee, sortable: STATE.isAdmin,
      })).join('')}
    </div>
    ${orphans ? link({ id: '__uncategorized__', nom: 'Non classé', ico: '📦', count: orphans }) : ''}
  </nav>`;
}

// État calculé une fois par rendu (en-tête, filtres et résultats le partagent).
function _catalogState() {
  const base = _getBaseItems(_activeCat);
  const items = _getFilteredItems(_activeCat);
  const organizeAll = _isManualOrganizeMode();
  const total = items.length;
  const pages = organizeAll ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p = organizeAll ? 1 : Math.max(1, Math.min(_page, pages));
  const slice = organizeAll ? items : items.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
  const hasFilters = Boolean(_norm(_filterSearch) || _filterTags.size || _smartFilters.size);
  return { base, items, organizeAll, total, pages, p, slice, hasFilters, groups: _buildTagGroups(base) };
}

function _catalogMetaText(st) {
  const n = st.base.length;
  let txt = `${n} article${n !== 1 ? 's' : ''}`;
  if (st.hasFilters && st.total !== n) txt += ` · ${st.total} affiché${st.total !== 1 ? 's' : ''}`;
  if (st.organizeAll && n > 1) txt += ' · glisser pour réordonner';
  return txt;
}

function _renderCatalog() {
  const st = _catalogState();
  return `<div class="shc">
    ${_renderRail()}
    <section class="shc-main" aria-label="Articles">
      ${_renderNoCharBanner()}
      ${_renderCatalogHead(st)}
      <div class="shc-smart" id="sh-smart" role="group" aria-label="Suggestions personnalisées">${_renderSmartChips()}</div>
      <div class="shc-filters" id="sh-filters"${_filtersOpen && st.groups.length ? '' : ' hidden'}>${_renderFilterGroups(st.groups)}</div>
      <div class="shc-active" id="sh-active-filters">${_renderActiveFilters(st.groups)}</div>
      <div class="shc-results" id="sh-items-results">${_renderResultsHtml(st)}</div>
    </section>
  </div>`;
}

function _renderCatalogHead(st) {
  const cat = _catInfo(_activeCat) || _catInfo(null);
  const isRealCat = _view === 'items' && cat.id && cat.id !== '__uncategorized__';
  const edit = STATE.isAdmin;
  const ico = cat.id
    ? _esc(cat.emoji || _catEmoji(cat.nom))
    : '<svg class="shc-title-svg"><use href="./assets/img/icons.svg#icon-bag"/></svg>';
  const sortOpt = (v, l) => `<option value="${v}"${_filterSort === v ? ' selected' : ''}>${l}</option>`;
  const viewBtn = (v, label, svg) => `<button type="button" class="shc-view-btn${_shopView === v ? ' is-on' : ''}"
    data-sh-action="setView" data-view="${v}" aria-pressed="${_shopView === v}" title="${label}" aria-label="${label}">${svg}</button>`;
  return `<div class="shc-head">
    <div class="shc-title">
      <span class="shc-title-ico" aria-hidden="true">${ico}</span>
      <div class="shc-title-txt">
        <h2>${_esc(cat.nom)}${cat.masquee ? ` <span class="shc-title-eye" title="Masquée aux joueurs">${eyeIcon(true)}</span>` : ''}</h2>
        <span class="shc-title-meta" id="sh-category-meta" role="status" aria-live="polite">${_catalogMetaText(st)}</span>
      </div>
      ${edit && isRealCat ? `<div class="shc-title-admin">
        <button type="button" class="shc-icon-btn" data-sh-action="openCatModal" data-id="${_esc(cat.id)}" title="Modifier la catégorie" aria-label="Modifier la catégorie">✏️</button>
        <button type="button" class="shc-icon-btn" data-sh-action="deleteCat" data-id="${_esc(cat.id)}" title="Supprimer la catégorie" aria-label="Supprimer la catégorie">🗑️</button>
      </div>` : ''}
    </div>
    <div class="shc-tools">
      <div class="shc-search">
        <svg class="shc-search-ico" aria-hidden="true"><use href="./assets/img/icons.svg#icon-search"/></svg>
        <input type="search" id="sh-search" class="shc-search-input"
          placeholder="${_view === 'home' ? 'Rechercher un objet, un effet, un trait…' : `Rechercher dans ${_esc(cat.nom)}…`}"
          value="${_esc(_filterSearch)}" data-sh-action="search" data-sh-on="input"
          autocomplete="off" aria-label="Rechercher dans la boutique" aria-controls="sh-items-results">
        <button type="button" class="shc-search-clear" data-sh-action="clearSearch" aria-label="Effacer la recherche"${_filterSearch ? '' : ' hidden'}>✕</button>
      </div>
      <select class="input-field shc-sort" data-sh-action="setSort" data-sh-on="change" aria-label="Trier les articles">
        ${sortOpt('ordre', _view === 'home' ? 'Par catégorie' : 'Ordre manuel')}
        ${sortOpt('recommande', 'Recommandé pour moi')}
        ${sortOpt('nom', 'Nom (A → Z)')}
        ${sortOpt('prix_asc', 'Prix croissant')}
        ${sortOpt('prix_desc', 'Prix décroissant')}
        ${sortOpt('rarete', 'Rareté')}
      </select>
      ${_renderFilterToggle(st.groups)}
      <div class="shc-view" role="group" aria-label="Affichage des articles">
        ${viewBtn('grille', 'Grille', _SVG_GRID)}${viewBtn('liste', 'Liste', _SVG_LIST)}
      </div>
      ${edit ? `<button type="button" class="shc-btn is-primary" data-sh-action="openItemModal" title="Créer un article${isRealCat ? ' dans cette catégorie' : ''}">＋ Article</button>` : ''}
    </div>
  </div>`;
}

// ── Suggestions personnalisées (favoris, budget, progression) ─────────────────
// Parlent au joueur ; les critères propres aux objets restent dans « Filtres ».
const SMART_META = [
  { k: 'fav',     ico: '★',  lbl: 'Favoris',             tip: 'Articles marqués ☆ en favori' },
  { k: 'payable', ico: '🪙', lbl: 'Abordable',           tip: 'Articles que ton personnage peut payer' },
  { k: 'boost',   ico: '⚡', lbl: 'Booste ma stat',      tip: 'Articles qui augmentent la stat principale du personnage' },
  { k: 'upgrade', ico: '▲',  lbl: 'Meilleur que l’équipé', tip: 'Meilleurs que l’objet équipé au même emplacement (stat principale ou CA)' },
  { k: 'new',     ico: '✨', lbl: 'Nouveautés',          tip: 'Ajouts récents du MJ' },
];

function _renderSmartChips() {
  const base = _getBaseItems(_activeCat);
  const ctx = _shopSmartCtx();
  const chips = SMART_META.map(m => {
    const unavailable = CHAR_SMART_KINDS.has(m.k) && !ctx.char;
    const on = !unavailable && _smartFilters.has(m.k);
    const n = unavailable ? 0 : base.filter(it => _shopItemMatchesSmart(it, m.k, ctx)).length;
    const lbl = m.k === 'boost' && ctx.char && ITEM_STAT_BY_KEY[ctx.primary] ? `Booste ${ITEM_STAT_BY_KEY[ctx.primary].short}` : m.lbl;
    return `<button type="button" class="shc-chip shc-chip--${m.k}${on ? ' is-on' : ''}"
      data-sh-action="toggleSmart" data-smart="${m.k}" aria-pressed="${on}"${unavailable || (!n && !on) ? ' disabled' : ''}
      title="${_esc(unavailable ? 'Sélectionne un personnage' : m.tip)}">
      <span class="shc-chip-ico" aria-hidden="true">${m.ico}</span>${_esc(lbl)}<span class="shc-chip-n">${unavailable ? '—' : n}</span>
    </button>`;
  }).join('');
  return `<span class="shc-bar-lbl">${ctx.char?.nom ? `Pour ${_esc(ctx.char.nom)}` : 'Suggestions'}</span>${chips}`;
}

function _renderFilterToggle(groups) {
  if (!groups.length) return '';
  const n = _filterTags.size;
  return `<button type="button" class="shc-chip shc-filter-toggle${n ? ' has-active' : ''}" id="sh-filter-toggle"
    data-sh-action="toggleFilters" aria-expanded="${_filtersOpen}" aria-controls="sh-filters">
    ${_SVG_FILTER}Filtres${n ? `<span class="shc-chip-n">${n}</span>` : ''}<span class="shc-caret" aria-hidden="true">⌄</span>
  </button>`;
}

function _renderFilterGroups(groups) {
  return groups.map(g => `<div class="shc-fgroup">
    <span class="shc-fgroup-lbl">${_esc(g.label)}</span>
    <div class="shc-fgroup-tags">
      ${g.tags.map(t => {
        const on = _filterTags.has(t.value);
        return `<button type="button" class="shc-tag${on ? ' is-on' : ''}" style="--tag:${_esc(t.color)}"
          data-tag-value="${_esc(t.value)}" data-sh-action="toggleTag" data-tag="${_esc(t.value)}" aria-pressed="${on}">${_esc(t.label)}</button>`;
      }).join('')}
    </div>
  </div>`).join('');
}

// Filtres actifs rappelés en pastilles retirables (utile panneau replié).
function _renderActiveFilters(groups) {
  if (!_filterTags.size) return '';
  const labelOf = new Map(groups.flatMap(g => g.tags.map(t => [t.value, t.label])));
  return [..._filterTags].map(v => `<button type="button" class="shc-active-chip" data-sh-action="toggleTag" data-tag="${_esc(v)}" title="Retirer ce filtre">
      ${_esc(labelOf.get(v) || v.split(':').slice(1).join(':'))}<span aria-hidden="true">✕</span>
    </button>`).join('')
    + '<button type="button" class="shc-link" data-sh-action="resetFilters">Tout effacer</button>';
}

function _renderResultsHtml(st) {
  if (!st.slice.length) {
    if (st.hasFilters) {
      return `<div class="shc-empty">
        <p>Aucun article ne correspond à ces critères.</p>
        <button type="button" class="shc-btn" data-sh-action="resetFilters">Réinitialiser la recherche et les filtres</button>
      </div>`;
    }
    const emptyShop = _view === 'home';
    return `<div class="shc-empty">
      <p>${emptyShop ? 'La boutique est vide.' : 'Aucun article dans cette catégorie.'}</p>
      ${STATE.isAdmin ? `<button type="button" class="shc-btn is-primary" data-sh-action="${emptyShop && !_cats.length ? 'openCatModal' : 'openItemModal'}">${emptyShop && !_cats.length ? '📁 Créer une catégorie' : '＋ Ajouter un article'}</button>` : ''}
    </div>`;
  }
  const ctx = _cardCtx();
  const opts = { showCat: _view === 'home', sortable: STATE.isAdmin && _view === 'items' };
  const body = _shopView === 'liste'
    ? _renderItemList(st.slice, ctx, opts)
    : `<div class="shc-grid${opts.sortable ? ' sh-sortable' : ''}" id="sh-items-grid">${st.slice.map(it => _renderCard(it, ctx, opts)).join('')}</div>`;
  return body + _renderPagination(st.p, st.pages);
}

function _renderPagination(p, pages) {
  if (pages <= 1) return '';
  const btn = (n, label = n) => `<button type="button" class="shc-page${n === p ? ' is-on' : ''}" data-sh-action="page" data-page="${n}"${n === p ? ' aria-current="page"' : ''}>${label}</button>`;
  const gap = '<span class="shc-page-gap" aria-hidden="true">…</span>';
  const st = Math.max(1, p - 2), en = Math.min(pages, p + 2);
  let html = p > 1 ? btn(p - 1, '← Précédent') : '';
  if (st > 1) html += btn(1) + (st > 2 ? gap : '');
  for (let i = st; i <= en; i++) html += btn(i);
  if (en < pages) html += (en < pages - 1 ? gap : '') + btn(pages);
  if (p < pages) html += btn(p + 1, 'Suivant →');
  return `<nav class="shc-pages" aria-label="Pagination">${html}</nav>`;
}

/**
 * Score « Recommandé » pour le tri intelligent.
 * Plus le score est élevé, plus l'item est pertinent pour le perso actif.
 *   • +200 si finançable (prix ≤ or du perso), -100 si trop cher
 *   • -500 si épuisé (rejeté en bas de liste)
 *   • +120 si améliore le slot équivalent (stat principale OU CA)
 *   • +stat * 25 pour le bonus sur la stat principale (max 100)
 *   • +rare * 12 pour valoriser les pièces rares (max 60 = légendaire)
 *   • +30 en stock > 3, +10 en stock 1-3, 0 sinon
 *   • Tiebreaker : prix décroissant (équipement plus cher = meilleur dans le band)
 */
function _shopItemRecommendScore(item, ctx) {
  const { char, primary, gold } = ctx;
  if (!char) return 0;
  let score = 0;
  const prix = parseFloat(item.prix) || 0;
  const dispo = (item.dispo !== undefined && item.dispo !== '' && item.dispo !== null) ? parseInt(item.dispo) : null;
  const epuise = dispo === 0;
  if (epuise) score -= 500;
  // Affordable
  if (prix <= gold) score += 200;
  else score -= 100;
  // Upgrade vs slot équivalent
  try {
    if (_shopItemMatchesSmart(item, 'upgrade', ctx)) score += 120;
  } catch {}
  // Bonus stat principale
  try {
    const b = getItemStatBonus(item, primary);
    if (b > 0) score += Math.min(100, b * 25);
  } catch {}
  // Rareté
  const rare = _getRareteNum(item.rarete);
  if (rare > 0) score += Math.min(60, rare * 12);
  // Stock
  if (dispo === null || dispo < 0) score += 20;        // illimité = bonus léger
  else if (dispo >= 3) score += 30;
  else if (dispo > 0) score += 10;
  // Tiebreak sur le prix décroissant (item plus cher = mieux)
  score += Math.min(50, prix / 20);
  return score;
}

// Helper : template à utiliser pour rendre un item (priorité item.template,
// fallback cat.template, fallback 'classique').
function _resolveItemTemplate(item) {
  if (item?.template && TEMPLATES[item.template]) return item.template;
  const cat = _cats.find(c => c.id === item?.categorieId);
  return cat?.template || 'classique';
}

// ══════════════════════════════════════════════════════════════════════════════
// FILTRAGE — recherche temps réel + suggestions + tags, sans lecture Firestore
// ══════════════════════════════════════════════════════════════════════════════
// catId null = tous les articles visibles (vue « Tout »).
function _getBaseItems(catId) {
  const items = _visibleItems();
  if (!catId) return items;
  return catId === '__uncategorized__'
    ? items.filter(i => !_cats.find(c => c.id === i.categorieId))
    : items.filter(i => i.categorieId === catId);
}

function _itemSearchText(item = {}) {
  return _norm([
    item.nom,
    item.type,
    item.sousType,
    item.categorie,
    item.format,
    item.slotArmure,
    item.typeArmure,
    item.slotBijou,
    item.description,
    item.effet,
    ...(Array.isArray(item.traits) ? item.traits : []),
  ].filter(Boolean).join(' '));
}

function _rebuildShopSearchIndex() {
  _shopSearchText = new Map(_items.map(item => [item.id, _itemSearchText(item)]));
}

function _getFilteredItems(catId) {
  let items = _getBaseItems(catId);

  // 🔎 Recherche
  const search = _norm(_filterSearch);
  if (search) {
    items = items.filter(i => _searchIncludes(_shopSearchText.get(i.id) ?? _itemSearchText(i), search));
  }

  // ⚡ Smart filters (cumulables en AND)
  items = _shopApplySmart(items);

  // 🏷️ Tags
  if (_filterTags.size > 0) {
    const tagGroups = _buildTagGroups(_getBaseItems(catId));
    const activeByGroup = new Map();

    for (const group of tagGroups) {
      const active = group.tags
        .filter(t => _filterTags.has(t.value))
        .map(t => t.value);

      if (active.length > 0) {
        activeByGroup.set(group.key, new Set(active));
      }
    }

    items = items.filter(i => {
      const iTags = _getItemTags(i);

      for (const [, groupVals] of activeByGroup) {
        if (![...groupVals].some(v => iTags.has(v))) return false;
      }

      return true;
    });
  }

  // 🔀 Tri
  if (!_filterSort || _filterSort === 'ordre') {
    // Toujours recalculer l'ordre manuel : les retours du cache Firestore et
    // les mises à jour partielles ne garantissent pas l'ordre du tableau reçu.
    // Vue « Tout » : regroupé par catégorie (ordre des catégories), puis manuel.
    if (catId) {
      items = [...items].sort(compareManualOrder);
    } else {
      const catRank = new Map(_cats.map((c, i) => [c.id, i]));
      const rank = it => catRank.has(it.categorieId) ? catRank.get(it.categorieId) : _cats.length;
      items = [...items].sort((a, b) => rank(a) - rank(b) || compareManualOrder(a, b));
    }
  } else {
    // Pour le tri "Recommandé", on précalcule les scores (évite N appels au getter)
    let recoScores = null;
    if (_filterSort === 'recommande') {
      const ctx = _shopSmartCtx();
      if (ctx.char) {
        recoScores = new Map(items.map(it => [it.id, _shopItemRecommendScore(it, ctx)]));
      } else {
        // Pas de perso actif → fallback rareté (impossible de scorer)
        recoScores = null;
      }
    }
    items = [...items].sort((a, b) => {
      switch (_filterSort) {
        case 'nom':
          return (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity:'base' });
        case 'prix_asc':
          return (parseFloat(a.prix)||0) - (parseFloat(b.prix)||0);
        case 'prix_desc':
          return (parseFloat(b.prix)||0) - (parseFloat(a.prix)||0);
        case 'rarete':
          return _getRareteNum(b.rarete) - _getRareteNum(a.rarete);
        case 'recommande': {
          if (!recoScores) return _getRareteNum(b.rarete) - _getRareteNum(a.rarete);
          return (recoScores.get(b.id) || 0) - (recoScores.get(a.id) || 0);
        }
        default:
          return 0;
      }
    });
  }

  return items;
}

// Réorganisation manuelle (MJ) : dans une catégorie, en « Ordre manuel » →
// tous les articles sont affichés (pas de pagination) pour pouvoir les glisser.
function _isManualOrganizeMode() {
  return STATE.isAdmin && _view === 'items' && (!_filterSort || _filterSort === 'ordre');
}

// Type d'arme affiché/filtré : le format EST le type d'arme. Une ancienne arme
// (format « Arme 1M CaC Phy. ») est rangée sous son type saisi (sousType).
function _itemWeaponType(item) {
  if (!item.format && !item.sousType) return '';
  return resolveWeaponFamily(_weaponFormats, item)?.label || item.sousType || item.format || '';
}
function _itemWeaponHands(item) {
  return (item.format || item.sousType || item.mains) && isWeaponLikeItem(item) ? weaponHandsLabel(item) : '';
}

function _getItemTags(item) {
  const tags = new Set();

  const weaponType = _itemWeaponType(item);
  if (weaponType)      tags.add(`typeArme:${weaponType}`);
  const hands = _itemWeaponHands(item);
  if (hands)           tags.add(`mains:${hands}`);
  if (item.slotArmure) tags.add(`slotArmure:${item.slotArmure}`);
  if (item.typeArmure) tags.add(`typeArmure:${item.typeArmure}`);
  if (item.slotBijou)  tags.add(`slotBijou:${item.slotBijou}`);
  if (item.type)       tags.add(`type:${item.type}`);

  _getItemStatFilterKeys(item).forEach(key => tags.add(`stat:${key}`));

  const rareteNum = _getRareteNum(item.rarete);
  if (rareteNum) tags.add(`rarete:${RARETE_NAMES[rareteNum] || String(rareteNum)}`);

  const dispo = item.dispo !== undefined && item.dispo !== '' ? parseInt(item.dispo) : null;
  if (dispo !== null && dispo > 0) tags.add('dispo:En stock');
  if (dispo === null || dispo < 0) tags.add('dispo:Illimité');

  return tags;
}

function _buildTagGroups(items) {
  const uniq = arr => [...new Set(arr)].sort();
  // Ordre forcé pour certains groupes (sinon alpha). Type armure : ordre configuré par le MJ.
  const TYPE_ARMURE_ORDER = getArmorTypeOptions({ includeDisabled: true });
  const orderBy = (arr, ref) => [...new Set(arr)].sort((a, b) => {
    const ia = ref.indexOf(a), ib = ref.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b, 'fr');
  });
  const mk = (label, key, values, color) =>
    values.length ? { label, key, tags: values.map(v => ({ value: `${key}:${v}`, label: v, color })) } : null;

  const groups = [
    mk('Type d’arme', 'typeArme',   uniq(items.map(_itemWeaponType).filter(Boolean)), '#e8b84b'),
    mk('Maniement',   'mains',      uniq(items.map(_itemWeaponHands).filter(Boolean)), '#e8b84b'),
    mk('Emplacement', 'slotArmure', uniq(items.filter(i => i.slotArmure).map(i => i.slotArmure)), '#4f8cff'),
    mk('Type armure', 'typeArmure', orderBy(items.filter(i => i.typeArmure).map(i => i.typeArmure), TYPE_ARMURE_ORDER), '#4f8cff'),
    mk('Bijou',       'slotBijou',  uniq(items.filter(i => i.slotBijou).map(i => i.slotBijou)), '#c084fc'),
    mk('Type',        'type',       uniq(items.filter(i => i.type && !i.format && !i.slotArmure && !i.slotBijou).map(i => i.type)), 'var(--text-muted)'),
  ].filter(Boolean);

  const statKeys = ITEM_STATS
    .map(stat => stat.key)
    .filter(key => items.some(item => _getItemStatFilterKeys(item).includes(key)));

  if (statKeys.length) {
    groups.push({
      label: 'Stats',
      key: 'stat',
      tags: statKeys.map(key => {
        const visual = _statVisual(key);
        const stat = ITEM_STAT_BY_KEY[key];
        return {
          value: `stat:${key}`,
          label: stat?.short || visual.short,
          color: visual.color,
        };
      }),
    });
  }

  const raretes = uniq(items.map(i => _getRareteNum(i.rarete)).filter(Boolean));
  if (raretes.length) {
    groups.push({
      label: 'Rareté',
      key: 'rarete',
      tags: raretes.map(r => ({
        value: `rarete:${RARETE_NAMES[r] || String(r)}`,
        label: `${'★'.repeat(r)} ${RARETE_NAMES[r] || ''}`,
        color: _rareteColor(RARETE_NAMES[r]),
      })),
    });
  }

  if (items.some(i => {
    const d = i.dispo != null && i.dispo !== '' ? parseInt(i.dispo) : null;
    return d === null || d > 0;
  })) {
    groups.push({
      label: 'Dispo',
      key: 'dispo',
      tags: [
        { value: 'dispo:En stock', label: 'En stock', color: '#22c38e' },
        { value: 'dispo:Illimité', label: '∞ Illimité', color: '#22c38e' },
      ],
    });
  }

  return groups;
}

function _getShopChars() {
  return getVisibleCharacters();
}

// ══════════════════════════════════════════════════════════════════════════════
// SMART FILTERS — payable / boost / upgrade / stock / new
// Sélectionne automatiquement les articles pertinents pour le personnage actif :
//   • payable : prix ≤ or du personnage
//   • boost   : item donne un bonus > 0 sur la stat principale du perso
//   • upgrade : item ferait progresser le slot équivalent (stat principale OU CA)
//   • stock   : dispo > 0 ou illimité
//   • new     : flag créé côté admin (fallback : 14 derniers jours)
// ══════════════════════════════════════════════════════════════════════════════

// Stat "principale" déduite du personnage : la plus haute parmi For/Dex/Int.
// Si tie, on prend INT pour les casters (présence de deck_sorts).
function _shopPrimaryStat(c) {
  if (!c) return 'intelligence';
  const s = c.stats || {};
  const candidates = ['force', 'dexterite', 'intelligence', 'sagesse', 'constitution', 'charisme'];
  let best = candidates[0], bestVal = -Infinity;
  for (const k of candidates) {
    const v = parseInt(s[k]) || 0;
    if (v > bestVal) { bestVal = v; best = k; }
  }
  return best;
}

// Date d'expiration « nouveauté » en ms (0 si non défini). Gère Timestamp
// Firestore ({seconds}) ET number (ms) selon la source.
function _itemNewUntilMs(item) {
  const v = item?.newUntil;
  if (v == null) return 0;
  return v?.seconds ? v.seconds * 1000 : (parseInt(v) || 0);
}

function _shopItemMatchesSmart(item, kind, ctx) {
  const { char, primary, gold } = ctx;
  switch (kind) {
    case 'fav': return _isFav(item.id);
    case 'payable': {
      if (!char) return false;
      return (parseFloat(item.prix) || 0) <= gold;
    }
    case 'boost': {
      if (!char) return false;
      try { return getItemStatBonus(item, primary) > 0; } catch { return false; }
    }
    case 'stock': {
      const d = (item.dispo === '' || item.dispo == null) ? null : parseInt(item.dispo);
      return d === null || d > 0;
    }
    case 'new': {
      // Toggle admin (newUntil) = autoritatif dès qu'il a été défini (0 ou date).
      if (item.newUntil !== undefined && item.newUntil !== null) {
        return _itemNewUntilMs(item) > Date.now();
      }
      // Legacy : flag permanent OU heuristique createdAt 14 j (items jamais réenregistrés).
      if (item.isNew === true) return true;
      const ts = item.createdAt?.seconds ? item.createdAt.seconds * 1000 : (parseInt(item.createdAt) || 0);
      if (!ts) return false;
      return (Date.now() - ts) < 14 * 24 * 3600 * 1000;
    }
    case 'upgrade': {
      if (!char) return false;
      const slot = _resolveSlotForItem(item);
      if (!slot) return false;
      const cur = (char.equipement || {})[slot] || null;
      // Bonus stat principale
      let curBonus = 0;
      try { curBonus = cur ? getItemStatBonus(cur, primary) : 0; } catch {}
      let itemBonus = 0;
      try { itemBonus = getItemStatBonus(item, primary); } catch {}
      // CA totale
      const curCa  = (parseInt(cur?.ca) || 0) + (parseInt(cur?.caBonus) || 0);
      const itemCa = (parseInt(item.ca) || 0) + (parseInt(item.caBonus) || 0);
      return (itemBonus > curBonus) || (itemCa > curCa);
    }
  }
  return true;
}

function _shopSmartCtx() {
  const char = _getActiveShopChar();
  return {
    char,
    primary: _shopPrimaryStat(char),
    gold: calcOr(char),
  };
}

function _shopApplySmart(items) {
  if (!_smartFilters.size) return items;
  const ctx = _shopSmartCtx();
  const active = [..._smartFilters]
    .filter(k => ctx.char || !CHAR_SMART_KINDS.has(k));
  return items.filter(it => active.every(k => _shopItemMatchesSmart(it, k, ctx)));
}

// Avatar coloré du personnage actif — pour le char-strip
function _shopCharAvatarColor(c) {
  const palette = { blue:'#4f8cff', arcane:'#9d6fff', crimson:'#ff5a7e', gold:'#e8b84b', emerald:'#22c38e', ember:'#ff9544' };
  return palette[c?.aura] || palette.blue;
}

function _getActiveShopChar() {
  const chars = _getShopChars();
  if (!chars.length) {
    _setShopCharId('');
    return null;
  }

  let active = chars.find(c => c.id === getShopCharId());

  if (!active) {
    // Pas de sélection en cours → perso favori (★ par défaut) du joueur, sinon premier
    active = getDefaultCharForUser(chars, STATE.user?.uid) || chars[0];
    _setShopCharId(active?.id || '');
  }

  return active || null;
}

// ══════════════════════════════════════════════════════════════════════════════
// PRÉSENTATION D'UN ARTICLE — helpers partagés carte / ligne / fiche détail
// ══════════════════════════════════════════════════════════════════════════════
function _statVisual(statKey) {
  const key = _normalizeStatKey(statKey);

  const map = {
    force:        { color: '#ef4444', short: 'For'  },
    dexterite:    { color: '#22c55e', short: 'Dex' },
    intelligence: { color: '#60a5fa', short: 'Int' },
    sagesse:      { color: '#a78bfa', short: 'Sag' },
    constitution: { color: '#f59e0b', short: 'Con' },
    charisme:     { color: '#ec4899', short: 'Cha' },
  };

  return map[key] || {
    color: 'var(--text-dim)',
    short: _statShort(statKey) || '?',
  };
}

function _getStatBonusEntries(item = {}) {
  const parsed = _parseLegacyStats(item);

  return ITEM_STATS
    .map(stat => {
      const val = parseInt(parsed[stat.store]) || 0;
      if (!val) return null;

      const visual = _statVisual(stat.key);

      return {
        short: stat.short,
        val,
        color: visual.color,
      };
    })
    .filter(Boolean);
}

function _getItemTraits(item) {
  if (Array.isArray(item.traits)) return item.traits.filter(Boolean);
  if (item.trait) return String(item.trait).split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

// Contexte commun à tous les articles d'un rendu (calculé une seule fois).
function _cardCtx() {
  return { ..._shopSmartCtx(), favs: _getFavs() };
}

// Stock : null = illimité (champ vide ou négatif).
function _itemDispo(item) {
  const raw = item.dispo !== undefined && item.dispo !== null && item.dispo !== '' ? parseInt(item.dispo) : null;
  return raw == null || Number.isNaN(raw) || raw < 0 ? null : raw;
}

function _itemBuyState(item, ctx) {
  const prix = parseFloat(item.prix) || 0;
  const dispo = _itemDispo(item);
  const tropCher = !!ctx.char && prix > ctx.gold;
  return { prix, dispo, epuise: dispo === 0, tropCher, manque: tropCher ? Math.ceil(prix - ctx.gold) : 0 };
}

function _itemRarity(item) {
  const n = _getRareteNum(item.rarete);
  const name = n ? (RARETE_NAMES[n] || '') : '';
  return { n, name, color: n ? _rareteColor(name) : '' };
}

// Sous-titre : type d'arme + maniement, ou emplacement + type d'armure, ou type.
function _itemTypeChips(item) {
  const chips = [];
  const weaponType = _itemWeaponType(item);
  const hands = _itemWeaponHands(item);
  if (weaponType)      chips.push(weaponType);
  if (hands)           chips.push(hands);
  if (item.slotArmure) chips.push(item.slotArmure);
  if (item.typeArmure) chips.push(item.typeArmure);
  if (item.slotBijou)  chips.push(item.slotBijou);
  if (item.type && !chips.length) chips.push(item.type);
  return chips;
}

// Caractéristiques clés (dégâts, toucher, portée, CA).
function _itemFacts(item) {
  const facts = [];
  if (item.degats) {
    const arr = _getDegatsStats(item);
    facts.push({ lbl: 'Dégâts', val: `${item.degats}${arr.length ? ` + ${_formatDegatsStatsText(arr)}` : ''}`, cls: 'dmg' });
  }
  if (item.toucherStat) facts.push({ lbl: 'Toucher', val: _statShort(item.toucherStat), color: _statVisual(item.toucherStat).color });
  if (item.portee) facts.push({ lbl: 'Portée', val: item.portee });
  const ca = parseInt(item.ca) || 0;
  if (ca) facts.push({ lbl: 'CA', val: `${ca > 0 ? '+' : ''}${ca}`, cls: 'ca' });
  return facts;
}

// Pictogramme de repli quand l'article n'a pas d'image.
function _itemGlyph(item, tplKey, cat) {
  if (tplKey === 'arme') {
    const t = _norm(`${item.nom || ''} ${_itemWeaponType(item)}`);
    if (/bouclier/.test(t)) return '🛡️';
    if (/focal|baton|baguette|sceptre|grimoire/.test(t)) return '🪄';
    if (/\b(arc|arbalete|fronde)\b|distance/.test(t)) return '🏹';
    if (/dague|poignard|couteau/.test(t)) return '🗡️';
    if (/hache/.test(t)) return '🪓';
    if (/marteau|masse/.test(t)) return '🔨';
    return '⚔️';
  }
  if (tplKey === 'armure') return { 'Tête': '🪖', 'Pieds': '🥾' }[item.slotArmure] || '🛡️';
  if (tplKey === 'bijou') return { 'Anneau': '💍', 'Amulette': '📿' }[item.slotBijou] || '🔮';
  return cat?.emoji || _catEmoji(cat?.nom || item.type || '');
}

// Écarts vs l'objet équipé au même emplacement (stats + CA).
function _itemDeltas(item, char) {
  const slot = char ? _resolveSlotForItem(item) : null;
  if (!slot) return { slot: null, diffs: [] };
  const cur = (char.equipement || {})[slot] || null;
  const diffs = [];
  ITEM_STAT_META.forEach(m => {
    let cb = 0, nb = 0;
    try { cb = cur ? getItemStatBonus(cur, m.full) : 0; } catch {}
    try { nb = getItemStatBonus(item, m.full); } catch {}
    if (nb !== cb) diffs.push({ lbl: m.short, d: nb - cb });
  });
  const curCa  = (parseInt(cur?.ca) || 0) + (parseInt(cur?.caBonus) || 0);
  const itemCa = (parseInt(item.ca) || 0) + (parseInt(item.caBonus) || 0);
  if (itemCa !== curCa) diffs.push({ lbl: 'CA', d: itemCa - curCa });
  return { slot, diffs };
}

function _fmtOr(n) {
  return (Number(n) || 0).toLocaleString('fr-FR');
}

// Bouton « Acheter » et ses états — partagé carte ↔ liste. Un seul message
// quand l'or manque (le prix passe aussi en rouge).
function _buyBtnHtml(item, hasChar, st) {
  if (!hasChar)    return `<button type="button" class="shc-buy" disabled title="Sélectionne un personnage pour acheter">Acheter</button>`;
  if (st.epuise)   return `<button type="button" class="shc-buy" disabled title="Cet article est épuisé">Épuisé</button>`;
  if (st.tropCher) return `<button type="button" class="shc-buy is-short" disabled title="Il te manque ${_fmtOr(st.manque)} or">Manque ${_fmtOr(st.manque)} or</button>`;
  return `<button type="button" class="shc-buy" data-sh-action="buyItem" data-id="${item.id}">Acheter</button>`;
}

function _tryBtnHtml(item) {
  return `<button type="button" class="shc-try" data-sh-action="openAtelier" data-id="${item.id}" title="Essayer dans l’Atelier" aria-label="Essayer dans l’Atelier">🪄</button>`;
}

function _adminItemBtns(item, st) {
  return `${st.epuise ? `<button type="button" class="shc-icon-btn" data-sh-action="restockItem" data-id="${item.id}" title="Restocker +1" aria-label="Restocker +1">📦</button>` : ''}
    <button type="button" class="shc-icon-btn" data-sh-action="toggleItemVis" data-id="${item.id}"
      title="${item.masque ? 'Rendre visible aux joueurs' : 'Masquer aux joueurs'}" aria-label="${item.masque ? 'Rendre visible' : 'Masquer'}">${eyeIcon(!!item.masque)}</button>
    <button type="button" class="shc-icon-btn" data-sh-action="openItemModal" data-id="${item.id}" title="Modifier l’article" aria-label="Modifier l’article">✏️</button>
    <button type="button" class="shc-icon-btn" data-sh-action="deleteItem" data-id="${item.id}" title="Supprimer l’article" aria-label="Supprimer l’article">🗑️</button>`;
}

function _itemVisStyle(item) {
  return item.image ? ` style="background-image:url('${_esc(item.image)}')"` : '';
}

// Variables CSS de couleur : --rar (rareté) et --tint (couleur de catégorie,
// sinon rareté) pour le fond de la vignette sans image.
function _itemColorVars(rar, cat) {
  const tint = cat?.couleur || rar.color;
  return [rar.color && `--rar:${_esc(rar.color)}`, tint && `--tint:${_esc(tint)}`].filter(Boolean).join(';');
}

// ══════════════════════════════════════════════════════════════════════════════
// CARTE ARTICLE (vue grille)
// ══════════════════════════════════════════════════════════════════════════════
function _renderCard(item, ctx, { showCat = false, sortable = false } = {}) {
  const tplKey = _resolveItemTemplate(item);
  const cat = _cats.find(c => c.id === item.categorieId);
  const edit = STATE.isAdmin;
  const st = _itemBuyState(item, ctx);
  const rar = _itemRarity(item);
  const fav = ctx.favs.has(item.id);
  const owned = ctx.char && Array.isArray(ctx.char.inventaire)
    ? ctx.char.inventaire.filter(inv => inv?.itemId && inv.itemId === item.id).length
    : 0;
  const { slot, diffs } = _itemDeltas(item, ctx.char);
  const typeChips = _itemTypeChips(item);
  const facts = _itemFacts(item);
  const traits = _getItemTraits(item);
  const desc = (tplKey === 'classique' || tplKey === 'libre') ? (item.effet || item.description || '') : '';
  const nom = item.nom || '?';

  const stock = st.dispo == null ? ''
    : st.dispo === 0 ? '<span class="shc-stock is-out">Épuisé</span>'
    : `<span class="shc-stock${st.dispo < 3 ? ' is-low' : ''}">${st.dispo < 3 ? `Plus que ${st.dispo}` : `${st.dispo} en stock`}</span>`;

  const kicker = [
    rar.n ? `<span class="shc-rar">${'★'.repeat(rar.n)} ${_esc(rar.name)}</span>` : '',
    showCat && cat ? `<span class="shc-card-cat">${_esc(cat.nom)}</span>` : '',
  ].filter(Boolean).join('');

  const tags = [
    ..._getStatBonusEntries(item).map(b => `<span class="shc-bonus" style="--stat:${b.color}">${_esc(b.short)} ${b.val > 0 ? '+' : ''}${b.val}</span>`),
    ...traits.slice(0, 2).map(t => `<span class="shc-trait" title="${_esc(t)}">${_esc(t)}</span>`),
    traits.length > 2 ? `<span class="shc-trait is-more" title="${_esc(traits.slice(2).join(' · '))}">+${traits.length - 2}</span>` : '',
  ].join('');

  return `
    <article class="shc-card${st.epuise ? ' is-out' : ''}${edit && item.masque ? ' is-masked' : ''}${sortable ? ' sh-sortable-item' : ''}"
      style="${_itemColorVars(rar, cat)}"
      data-item-id="${item.id}" data-sh-action="openDetail" data-id="${item.id}"
      data-sh-key-card="item" tabindex="0" role="button" aria-label="Ouvrir ${_esc(nom)}">
      <div class="shc-card-vis${item.image ? ' has-img' : ''}"${_itemVisStyle(item)}>
        ${item.image ? '' : `<span class="shc-card-glyph" aria-hidden="true">${_esc(_itemGlyph(item, tplKey, cat))}</span>`}
        <button type="button" class="shc-card-fav${fav ? ' is-on' : ''}" data-sh-action="toggleFav" data-id="${item.id}"
          aria-pressed="${fav}" title="${fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}" aria-label="Favori">${fav ? '★' : '☆'}</button>
        ${stock}
        ${owned ? `<span class="shc-owned" title="Tu en possèdes déjà ×${owned}">✓ ${owned > 1 ? `×${owned}` : 'Possédé'}</span>` : ''}
        ${edit ? `<div class="shc-card-admin" data-sh-action="stop">${_adminItemBtns(item, st)}</div>` : ''}
      </div>
      <div class="shc-card-body">
        ${kicker ? `<div class="shc-card-kicker">${kicker}</div>` : ''}
        <div class="shc-card-name">${edit && item.masque ? `<span class="shc-masked-eye" title="Masqué aux joueurs">${eyeIcon(true)}</span>` : ''}${_esc(nom)}</div>
        ${typeChips.length ? `<div class="shc-card-type">${typeChips.map(_esc).join(' · ')}</div>` : ''}
        ${facts.length ? `<dl class="shc-facts">${facts.map(f => `<div class="shc-fact"><dt>${f.lbl}</dt><dd${f.color ? ` style="color:${f.color}"` : ''}>${_esc(f.val)}</dd></div>`).join('')}</dl>` : ''}
        ${desc ? `<p class="shc-card-desc">${_esc(desc)}</p>` : ''}
        ${tags ? `<div class="shc-card-tags">${tags}</div>` : ''}
        ${diffs.length ? `<div class="shc-delta" title="Comparé à ton équipement actuel (${_esc(slot)})">
          <span class="shc-delta-lbl">vs équipé</span>
          ${diffs.map(x => `<b class="${x.d > 0 ? 'is-up' : 'is-down'}">${_esc(x.lbl)} ${x.d > 0 ? '▲' : '▼'}${Math.abs(x.d)}</b>`).join('')}
        </div>` : ''}
      </div>
      <div class="shc-card-foot">
        <span class="shc-price${st.tropCher && !st.epuise ? ' is-short' : ''}"><b>${_fmtOr(st.prix)}</b> or</span>
        <div class="shc-card-cta" data-sh-action="stop">
          ${slot ? _tryBtnHtml(item) : ''}
          ${_buyBtnHtml(item, !!ctx.char, st)}
        </div>
      </div>
    </article>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// VUE LISTE — tableau dense : 1 ligne par article, colonnes alignées.
// L'en-tête est HORS du conteneur sortable (#sh-items-grid) pour ne pas
// décaler les index de drag.
// ══════════════════════════════════════════════════════════════════════════════
function _renderItemList(items, ctx, opts = {}) {
  return `<div class="shc-list${STATE.isAdmin ? ' shc-list--admin' : ''}">
    <div class="shc-row shc-row--head" aria-hidden="true">
      <span></span><span>Article</span><span>Caractéristiques</span><span>Rareté</span><span>Stock</span><span>Prix</span><span></span>
    </div>
    <div class="shc-list-body${opts.sortable ? ' sh-sortable' : ''}" id="sh-items-grid">
      ${items.map(item => _renderItemRow(item, ctx, opts)).join('')}
    </div>
  </div>`;
}

function _renderItemRow(item, ctx, { showCat = false, sortable = false } = {}) {
  const tplKey = _resolveItemTemplate(item);
  const cat = _cats.find(c => c.id === item.categorieId);
  const edit = STATE.isAdmin;
  const st = _itemBuyState(item, ctx);
  const rar = _itemRarity(item);
  const fav = ctx.favs.has(item.id);
  const slot = ctx.char ? _resolveSlotForItem(item) : null;
  const typeLine = [..._itemTypeChips(item), ...(showCat && cat ? [cat.nom] : [])].map(_esc).join(' · ');
  const nom = item.nom || '?';

  const info = [
    ..._itemFacts(item).map(f => `<span class="shc-row-fact"><i>${f.lbl}</i> ${_esc(f.val)}</span>`),
    ..._getStatBonusEntries(item).map(b => `<span class="shc-bonus" style="--stat:${b.color}">${_esc(b.short)} ${b.val > 0 ? '+' : ''}${b.val}</span>`),
  ];
  const desc = (tplKey === 'classique' || tplKey === 'libre') ? (item.effet || item.description || '') : '';
  if (desc) info.push(`<span class="shc-row-desc">${_esc(desc)}</span>`);

  const stock = st.dispo == null ? '<span class="shc-row-stock">∞</span>'
    : `<span class="shc-row-stock${st.dispo === 0 ? ' is-out' : st.dispo < 3 ? ' is-low' : ''}">${st.dispo === 0 ? 'Épuisé' : st.dispo}</span>`;

  return `
    <div class="shc-row${st.epuise ? ' is-out' : ''}${edit && item.masque ? ' is-masked' : ''}${sortable ? ' sh-sortable-item' : ''}"
      style="${_itemColorVars(rar, cat)}"
      data-item-id="${item.id}" data-sh-action="openDetail" data-id="${item.id}"
      data-sh-key-card="item" tabindex="0" role="button" aria-label="Ouvrir ${_esc(nom)}">
      <span class="shc-row-thumb${item.image ? ' has-img' : ''}"${_itemVisStyle(item)}>
        ${item.image ? '' : `<span aria-hidden="true">${_esc(_itemGlyph(item, tplKey, cat))}</span>`}
        <button type="button" class="shc-card-fav${fav ? ' is-on' : ''}" data-sh-action="toggleFav" data-id="${item.id}"
          aria-pressed="${fav}" title="${fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}" aria-label="Favori">${fav ? '★' : '☆'}</button>
      </span>
      <span class="shc-row-name">
        <b>${edit && item.masque ? `<span class="shc-masked-eye" title="Masqué aux joueurs">${eyeIcon(true)}</span>` : ''}${_esc(nom)}</b>
        ${typeLine ? `<small>${typeLine}</small>` : ''}
      </span>
      <span class="shc-row-info">${info.join('')}</span>
      <span class="shc-row-rar">${rar.n ? `<span class="shc-rar">${'★'.repeat(rar.n)} ${_esc(rar.name)}</span>` : '<span class="shc-row-dash">—</span>'}</span>
      ${stock}
      <span class="shc-price${st.tropCher && !st.epuise ? ' is-short' : ''}"><b>${_fmtOr(st.prix)}</b> or</span>
      <span class="shc-row-actions" data-sh-action="stop">
        ${slot ? _tryBtnHtml(item) : ''}
        ${_buyBtnHtml(item, !!ctx.char, st)}
        ${edit ? _adminItemBtns(item, st) : ''}
      </span>
    </div>`;
}

// ── Comparaison d'équipement (boutique → fiche perso) ─────────────────────────
// Résout le slot d'équipement ciblé par un item boutique.
// Armes → 'Main principale' par défaut. Armures/bijoux → leur slot dédié.
function _resolveSlotForItem(item) {
  return resolveEquipmentSlotForItem(item);
}

// Construit un item équipé minimal à partir d'un item boutique
// (champs nécessaires aux calculs : statsBonus, CA, type d'armure pour le bouclier).
function _buildSimEquipFromShop(slot, shopItem) {
  const base = {
    nom: shopItem.nom || '',
    fo:  getItemStatBonus(shopItem, 'force'),
    dex: getItemStatBonus(shopItem, 'dexterite'),
    in:  getItemStatBonus(shopItem, 'intelligence'),
    sa:  getItemStatBonus(shopItem, 'sagesse'),
    co:  getItemStatBonus(shopItem, 'constitution'),
    ch:  getItemStatBonus(shopItem, 'charisme'),
  };
  if (slot.startsWith('Main')) {
    return { ...base, degats: shopItem.degats || '', sousType: shopItem.sousType || '', format: shopItem.format || '', mains: shopItem.mains || '', toucherStat: shopItem.toucherStat || '' };
  }
  return {
    ...base,
    ca: parseInt(shopItem.ca) || 0,
    typeArmure: shopItem.typeArmure || '',
    slotArmure: shopItem.slotArmure || '',
    slotBijou:  shopItem.slotBijou  || '',
  };
}

function _simulateCharWithItem(c, slot, shopItem) {
  const equip = { ...(c.equipement || {}) };
  equip[slot] = _buildSimEquipFromShop(slot, shopItem);
  const statsBonus = computeEquipStatsBonus(equip);
  return { ...c, equipement: equip, statsBonus };
}

/** Simule un perso avec plusieurs slots overrides (map slot → shopItem|null).
 *  Si la valeur est null pour un slot → on retire l'équipement actuel. */
function _simulateCharWithBuild(c, slotMap) {
  const equip = { ...(c.equipement || {}) };
  Object.entries(slotMap || {}).forEach(([slot, item]) => {
    if (item === null) delete equip[slot];
    else if (item)     equip[slot] = _buildSimEquipFromShop(slot, item);
  });
  const statsBonus = computeEquipStatsBonus(equip);
  return { ...c, equipement: equip, statsBonus };
}

function _cmpRow(label, cur, next, { numeric = true } = {}) {
  let deltaHtml = '';
  if (numeric) {
    const d = (parseFloat(next) || 0) - (parseFloat(cur) || 0);
    if (d > 0)      deltaHtml = `<span class="sh-cmp-delta sh-cmp-delta--up">+${d}</span>`;
    else if (d < 0) deltaHtml = `<span class="sh-cmp-delta sh-cmp-delta--down">${d}</span>`;
    else            deltaHtml = `<span class="sh-cmp-delta sh-cmp-delta--eq">=</span>`;
  }
  const curDisp  = (cur === '' || cur == null) ? '—' : cur;
  const nextDisp = (next === '' || next == null) ? '—' : next;
  return `<div class="sh-cmp-row">
    <span class="sh-cmp-label">${label}</span>
    <span class="sh-cmp-cur">${curDisp}</span>
    <span class="sh-cmp-arr">→</span>
    <span class="sh-cmp-new">${nextDisp}</span>
    ${deltaHtml}
  </div>`;
}

function _renderComparePanel(c, item, slot) {
  if (!c || !slot) return '';
  const current = (c.equipement || {})[slot] || null;
  const sim = _simulateCharWithItem(c, slot, item);
  const isWeapon = slot.startsWith('Main');

  const rows = [];
  rows.push(_cmpRow('CA',     calcCA(c),     calcCA(sim)));
  rows.push(_cmpRow('PV max', calcPVMax(c), calcPVMax(sim)));
  rows.push(_cmpRow('PM max', calcPMMax(c), calcPMMax(sim)));

  ITEM_STAT_META.forEach(meta => {
    const cur  = (c.statsBonus  || {})[meta.full] || 0;
    const next = (sim.statsBonus || {})[meta.full] || 0;
    if (cur === 0 && next === 0) return;
    rows.push(_cmpRow(meta.short, cur, next));
  });

  if (isWeapon) {
    rows.push(_cmpRow('Dégâts', current?.degats || '—', item.degats || '—', { numeric: false }));
  }

  // Traits gagnés / perdus
  const curTraits = new Set(Array.isArray(current?.traits) ? current.traits.filter(Boolean) : []);
  const newTraitsArr = Array.isArray(item.traits)
    ? item.traits
    : (item.trait ? String(item.trait).split(',').map(t => t.trim()).filter(Boolean) : []);
  const newTraits = new Set(newTraitsArr);
  const added   = [...newTraits].filter(t => !curTraits.has(t));
  const removed = [...curTraits].filter(t => !newTraits.has(t));

  const traitsBlock = (added.length || removed.length) ? `
    <div class="sh-cmp-traits">
      ${added.map(t => `<span class="sh-cmp-trait sh-cmp-trait--add">+ ${_esc(t)}</span>`).join('')}
      ${removed.map(t => `<span class="sh-cmp-trait sh-cmp-trait--del">− ${_esc(t)}</span>`).join('')}
    </div>` : '';

  const curName = current?.nom ? _esc(current.nom) : '<em style="color:var(--text-dim)">— Aucun —</em>';
  const newName = _esc(item.nom || '');

  return `
    <div class="sh-cmp">
      <div class="sh-cmp-head">
        <span class="sh-cmp-title">🔄 Impact sur ${_esc(c.nom || 'le personnage')}</span>
        <span class="sh-cmp-slot">${slot}</span>
      </div>
      <div class="sh-cmp-names">
        <div class="sh-cmp-name sh-cmp-name--cur"><span class="sh-cmp-coltitle">Actuel</span>${curName}</div>
        <div class="sh-cmp-name sh-cmp-name--new"><span class="sh-cmp-coltitle">Nouveau</span>${newName}</div>
      </div>
      <div class="sh-cmp-rows">
        ${rows.join('')}
      </div>
      ${traitsBlock}
    </div>`;
}

// Vente intégrée : revend l'objet d'inventaire actuellement équipé sur ce slot.
async function _sellCurrentEquipForShop(slot) {
  const c = _getActiveShopChar();
  if (!c) return;
  const eq = (c.equipement || {})[slot];
  const invIndex = eq?.sourceInvIndex;
  if (!Number.isInteger(invIndex) || invIndex < 0) {
    showNotif("Cet équipement n'a pas d'objet d'inventaire associé.", 'error');
    return;
  }

  const invItem = c.inventaire?.[invIndex] || {};
  const itemNom = invItem.nom || eq?.nom || 'cet objet';
  const prixVente = parseFloat(invItem.prixVente) || 0;
  const ok = await confirmModal(
    `Tu vas vendre l'objet équipé sur <strong>${_esc(slot)}</strong> :<br>
    <strong>${_esc(itemNom)}</strong>${prixVente ? ` pour <strong>${prixVente} or</strong>` : ''}.<br>
    Aucun achat ne sera effectué.`,
    {
      title: 'Vendre l’équipement porté',
      confirmLabel: 'Vendre cet objet',
      cancelLabel: 'Garder l’objet',
      icon: '💰',
    },
  );
  if (!ok) return;

  closeModalDirect();
  await sellInvItemFromShop(c.id, invIndex, { skipConfirm: true });
}
function openShopItemDetail(itemId) {
  const item = _items.find(i => i.id === itemId);
  if (!item) return;
  const cat    = _cats.find(c => c.id === item.categorieId);
  const ctx    = _cardCtx();
  const { prix, dispo, epuise, tropCher, manque } = _itemBuyState(item, ctx);
  const prixV  = Math.round(prix * PRIX_VENTE_RATIO);
  const traitsArr = _getItemTraits(item);
  const activeChar = ctx.char;
  const hasChar = !!activeChar;

  const compareSlot   = hasChar ? _resolveSlotForItem(item) : null;
  const comparePanel  = compareSlot ? _renderComparePanel(activeChar, item, compareSlot) : '';
  const equippedHere  = compareSlot ? (activeChar.equipement || {})[compareSlot] : null;
  const sellPrice     = equippedHere && Number.isInteger(equippedHere.sourceInvIndex)
    ? (parseFloat(activeChar.inventaire?.[equippedHere.sourceInvIndex]?.prixVente) || 0)
    : 0;
  const canSellCurrent = !!equippedHere && Number.isInteger(equippedHere.sourceInvIndex) && equippedHere.sourceInvIndex >= 0;
  const equippedItemName = equippedHere?.nom || activeChar?.inventaire?.[equippedHere?.sourceInvIndex]?.nom || '';

  const rar = _itemRarity(item);
  const rareNum = rar.n, rareCol = rar.color, rareName = rar.name;
  const tplKey = _resolveItemTemplate(item);
  const tplLabel = TEMPLATES[tplKey]?.label || '';

  const typeChips = _itemTypeChips(item);
  const typeLine = typeChips.length ? typeChips.map(_esc).join(' · ') : _esc(cat?.nom || '');
  const facts = _itemFacts(item);
  const bonusEntries = _getStatBonusEntries(item);
  const descTxt = item.effet || item.description || '';

  // Visuel : image, sinon pictogramme sur fond teinté (catégorie ou rareté).
  const heroAttrs = item.image
    ? `class="sh-detail-hero" style="background-image:url('${_esc(item.image)}');background-size:cover;background-position:center"`
    : `class="sh-detail-hero sh-detail-hero--glyph" style="${_itemColorVars(rar, cat)}"`;

  // Footer buttons
  let actionBtn;
  if (!hasChar) {
    actionBtn = `<button class="btn btn-outline btn-sm" disabled title="Sélectionne un personnage">Choisis un personnage</button>`;
  } else if (epuise) {
    actionBtn = `<button class="btn btn-outline btn-sm" disabled title="Cet article est épuisé">Épuisé</button>`;
  } else if (tropCher) {
    actionBtn = `<button class="btn btn-outline btn-sm" disabled title="Il te manque ${_fmtOr(manque)} or">Manque ${_fmtOr(manque)} or</button>`;
  } else {
    actionBtn = `<button class="btn btn-gold btn-sm" data-sh-action="buyFromDetail" data-id="${item.id}">🛒 Acheter pour ${_fmtOr(prix)} or</button>`;
  }

  // pushModal (et non openModal) : si une modale est déjà ouverte (ex. historique),
  // la fiche s'EMPILE au lieu de la remplacer → ✕ / Échap / clic overlay reviennent
  // à la modale précédente. Sans modale de fond, se comporte comme une modale de base.
  pushModal('', `
  <div class="sh-detail">
    <!-- HERO image avec étoiles + stock -->
    <div ${heroAttrs}>
      ${item.image ? '' : `<span class="sh-detail-glyph" aria-hidden="true">${_esc(_itemGlyph(item, tplKey, cat))}</span>`}
      <div class="sh-detail-hero-fade"></div>
      ${rareNum ? `<span class="sh-detail-stars" title="${_esc(rareName)}">${'★'.repeat(rareNum)}</span>` : ''}
      <span class="sh-detail-stock ${epuise?'is-empty':(dispo!==null && dispo<3?'is-limited':'is-ok')}">${
        dispo===null||dispo<0 ? '∞ Stock illimité' :
        epuise ? 'Épuisé' :
        `${dispo} en stock`}</span>
      ${rareNum ? `<span class="sh-detail-rare-pill" style="color:${rareCol};border-color:${rareCol};background:${rareCol}1a">${_esc(rareName)}</span>` : ''}
      <button class="sh-detail-close" data-sh-action="closeModal" title="Fermer">✕</button>
    </div>

    <!-- BODY -->
    <div class="sh-detail-body">
      <div class="sh-detail-head">
        <div class="sh-detail-name-wrap">
          <h2 class="sh-detail-name">${_esc(item.nom)}</h2>
          <div class="sh-detail-sub">${typeLine}${tplLabel?` <span class="sh-detail-tpl">${_esc(tplLabel)}</span>`:''}</div>
        </div>
        <div class="sh-detail-price-block">
          <div class="sh-detail-price-main">🪙 ${_fmtOr(prix)} or</div>
          <div class="sh-detail-price-sub">Revente ${_fmtOr(prixV)} or</div>
          ${tropCher && !epuise ? `<div class="sh-detail-price-warn">Il te manque ${_fmtOr(manque)} or</div>` : ''}
        </div>
      </div>

      ${facts.length ? `<div class="sh-detail-facts">
        ${facts.map(f => `<div class="sh-detail-fact ${f.cls || ''}">
          <span class="sh-detail-fact-lbl">${_esc(f.lbl)}</span>
          <span class="sh-detail-fact-val"${f.color ? ` style="color:${f.color}"` : ''}>${_esc(f.val)}</span>
        </div>`).join('')}
      </div>` : ''}

      ${bonusEntries.length ? `<div class="sh-detail-bonus">
        ${bonusEntries.map(b => `<span class="shc-bonus" style="--stat:${b.color}">${b.short} ${b.val > 0 ? '+' : ''}${b.val}</span>`).join('')}
      </div>` : ''}

      ${traitsArr.length ? `<div class="sh-detail-traits">
        <span class="sh-detail-traits-lbl">Traits</span>
        ${traitsArr.map(t=>`<span class="sh-trait-pill">${_esc(t)}</span>`).join('')}
      </div>` : ''}

      ${descTxt ? `<div class="sh-detail-desc">${_esc(descTxt)}</div>` : ''}

      ${comparePanel ? `<div class="sh-detail-compare">${comparePanel}</div>` : ''}
    </div>

    <!-- FOOTER -->
    <div class="sh-detail-footer">
      ${STATE.isAdmin ? `<button class="btn btn-outline btn-sm" data-sh-action="editFromDetail" data-id="${item.id}">✏️ Modifier</button>` : ''}
      <div class="sh-detail-footer-spacer"></div>
      ${canSellCurrent ? `
        <button class="btn btn-outline btn-sm sh-detail-sell-current"
          title="Vendre l'objet équipé sur ${_esc(compareSlot)}${equippedItemName ? ` : ${_esc(equippedItemName)}` : ''}"
          data-sh-action="sellEquip" data-slot="${_esc(compareSlot)}">
          💰 Vendre équipé${sellPrice ? ` (+${_fmtOr(sellPrice)} or)` : ''}
        </button>` : ''}
      ${compareSlot ? `<button class="btn btn-outline btn-sm" data-sh-action="tryFromDetail" data-id="${item.id}" title="Essayer dans l’Atelier">🪄 Essayer</button>` : ''}
      ${actionBtn}
    </div>
  </div>
  `);
}

// ══════════════════════════════════════════════════════════════════════════════
// SÉLECTEUR PERSONNAGE
// ══════════════════════════════════════════════════════════════════════════════
function shopSetChar(charId) {
  _setShopCharId(charId);
  if (_shopSection === 'atelier') {
    _atelier = { activeSlot: null, simulated: {}, itemSearch: '', sort: _atelier.sort || 'rarity' };
  } else if (_shopSection === 'artisan') {
    _artisanNeedsReset = true;
  }
  const c  = STATE.characters?.find(x => x.id === charId);
  const or = calcOr(c);
  const valEl = document.getElementById('sh-char-or-value');
  if (valEl) valEl.textContent = or;
  renderShop();
}

// ══════════════════════════════════════════════════════════════════════════════
// ACHAT — modal avec sélection de quantité
// ══════════════════════════════════════════════════════════════════════════════
async function buyItem(itemId) {
  const c = _getActiveShopChar();
  if (!c) { showNotif("Sélectionne un personnage d'abord.", 'error'); return; }

  const item = _items.find(i => i.id === itemId);
  if (!item) return;
  // Un article masqué (ou d'une catégorie masquée) n'est pas achetable par un
  // joueur — garde UI, la vraie protection reste les règles Firestore.
  if (!STATE.isAdmin && !_visibleItems().some(i => i.id === itemId)) {
    showNotif('Cet article n’est pas disponible.', 'error'); return;
  }

  const dispo    = (item.dispo !== undefined && item.dispo !== '') ? parseInt(item.dispo) : null;
  const illimite = dispo === null || dispo < 0;
  if (!illimite && dispo === 0) { showNotif('Article épuisé.', 'error'); return; }

  const prix  = parseFloat(item.prix) || 0;
  const solde = calcOr(c);

  const maxAffordable = prix > 0 ? Math.floor(solde / prix) : 99;
  const maxStock      = illimite ? 99 : dispo;
  const maxQte        = Math.min(maxAffordable, maxStock, 99);
  if (maxQte < 1) { showNotif(`Fonds insuffisants — Solde : ${solde} or / Prix : ${prix} or.`, 'error'); return; }

  if (maxQte === 1) {
    return confirmBuyItem(itemId, 1);
  }

  openModal('', `
  <div class="sh-admin-modal is-cat">
    <div class="sh-admin-head">
      <div class="sh-admin-head-ico">🛒</div>
      <div class="sh-admin-head-title">
        <h2>Acheter — ${_esc(item.nom)}</h2>
        <small>💰 <b>${prix}</b> or l'unité · Solde : <b style="color:var(--amber, #f4c430)">${solde} or</b>${!illimite ? ` · Stock : <b>${dispo}</b>` : ' · ∞ illimité'}</small>
      </div>
      <button class="sh-admin-close" data-sh-action="closeModal" title="Fermer">✕</button>
    </div>

    <div class="sh-admin-body">
      <div class="sh-admin-section">
        <div class="sh-admin-section-title">📦 Quantité</div>
        <div class="sh-buy-stepper">
          <button type="button" class="sh-buy-step-btn" data-sh-action="qtyDown" title="−1">−</button>
          <input type="number" id="buy-qty" min="1" max="${maxQte}" value="1"
            class="sh-buy-step-input"
            data-sh-action="qtyInput" data-sh-on="input" data-prix="${prix}">
          <button type="button" class="sh-buy-step-btn" data-sh-action="qtyUp" title="+1">+</button>
          <span class="sh-buy-step-arrow">→</span>
          <span class="sh-buy-step-total" id="buy-total">${prix} or</span>
        </div>
        <p class="sh-admin-section-hint" style="margin-top:8px">
          Tu peux acheter jusqu'à <b style="color:var(--text)">${maxQte}</b> unité${maxQte>1?'s':''} (limite : fonds + stock).
        </p>
      </div>
    </div>

    <div class="sh-admin-footer">
      <button class="btn btn-outline btn-sm" data-sh-action="closeModal">Annuler</button>
      <div class="sh-admin-footer-spacer"></div>
      <button id="buy-confirm" class="btn btn-gold btn-sm"
        data-sh-action="confirmBuy" data-id="${itemId}">
        🛒 Acheter ×1 — ${prix} or
      </button>
    </div>
  </div>
  `);
}

let _buyInProgress = false;
async function confirmBuyItem(itemId, directQty) {
  if (_buyInProgress) return;
  try {
    _buyInProgress = true;
    const charId   = getShopCharId();
    const item     = _items.find(i => i.id === itemId);
    if (!item || !charId) return;
    const qty      = directQty != null
      ? Math.max(1, parseInt(directQty) || 1)
      : Math.max(1, parseInt(document.getElementById('buy-qty')?.value)||1);
    const dispo    = (item.dispo !== undefined && item.dispo !== '') ? parseInt(item.dispo) : null;
    const illimite = dispo === null || dispo < 0;
    const prix     = parseFloat(item.prix) || 0;
    const c        = STATE.characters?.find(x => x.id === charId);
    if (!c) return;
    const solde    = calcOr(c);
    const total    = prix * qty;
    if (solde < total) { showNotif(`Fonds insuffisants — ${solde} or disponibles.`, 'error'); return; }
    if (!illimite && dispo < qty) { showNotif(`Stock insuffisant — ${dispo} dispo.`, 'error'); return; }

    if (!illimite) {
      await updateInCol('shop', itemId, { dispo: dispo - qty });
      item.dispo = dispo - qty;
    }

    const prixVente = Math.round(prix * PRIX_VENTE_RATIO);
    const cat       = _cats.find(cc => cc.id === item.categorieId);
    const tplKey    = _resolveItemTemplate(item);
    const invItem   = shopItemToInvEntry(item, {
      source:    'boutique',
      template:  tplKey,
      prixAchat: prix,
      prixVente,
    });

    const inv = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
    for (let i = 0; i < qty; i++) inv.push({...invItem});
    const historyPatch = inventoryHistoryPayload(c, makeInventoryHistoryEntry('add', invItem, qty, {
      ..._inventoryHistoryActor(),
      source: 'Boutique',
      note: `${total} or`,
    }));

    const libelle = qty > 1 ? `Achat ×${qty} : ${item.nom}` : `Achat : ${item.nom}`;
    const res = await useGold(charId, -total, libelle, {
      charObj: c,
      extraPayload: { inventaire: inv, ...historyPatch },
    });
    if (!res.ok) { showNotif(res.error || 'Erreur achat', 'error'); return; }
    c.inventoryHistory = historyPatch.inventoryHistory;

    const newOr = res.newBalance;
    if (directQty == null) closeModalDirect();
    showNotif(`✅ ×${qty} "${item.nom}" acheté${qty>1?'s':''} pour ${total} or !`, 'success');
    renderShop();

    requestAnimationFrame(() => {
      const valEl = document.getElementById('sh-char-or-value');
      const pastille = document.getElementById('sh-char-or-display');
      if (valEl) _animateCount(valEl, solde, newOr, 450);
      if (pastille) {
        pastille.classList.remove('sh-wallet-or--flash');
        void pastille.offsetWidth;
        pastille.classList.add('sh-wallet-or--flash');
      }
    });
  } catch (e) { notifySaveError(e); }
  finally { _buyInProgress = false; }
}

// ── Historique boutique : achats & ventes du personnage courant ──────────────
// Source : c.inventoryHistory (déjà alimenté par l'achat `add` et la vente
// `sell`). Chaque ligne rouvre la fiche de l'objet si l'article existe encore.
function _shHistoryTimeAgo(ts) {
  const s = Math.floor((Date.now() - (Number(ts) || 0)) / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.floor(s / 60); if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60); if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24); if (d < 30) return `il y a ${d} j`;
  return new Date(Number(ts)).toLocaleDateString('fr-FR');
}

const _SH_HIST_KINDS = {
  buy:  { ic: '🛒', lbl: 'Acheté' },
  sell: { ic: '💰', lbl: 'Vendu'  },
  add:  { ic: '＋', lbl: 'Ajouté' },
};
// buy = achat boutique · sell = vente · add = ajout hors boutique (MJ/craft…).
function _shHistKind(e) {
  if (e.type === 'sell') return 'sell';
  return e.source === 'Boutique' ? 'buy' : 'add';
}

// Construit { title, html } pour un filtre donné : un charId (perso précis) ou
// '__all' (toute la campagne, MJ). Renvoie null si le perso est introuvable.
function _shHistoryBuild(filter) {
  const isMj  = STATE.isAdmin;
  const chars = STATE.characters || [];
  if (!isMj) filter = getShopCharId();          // joueur : uniquement son perso
  else if (!filter) filter = '__all';
  const isAll = filter === '__all';

  let entries = [];
  if (isAll) {
    chars.forEach(ch => {
      inventoryHistoryEntries(ch.inventoryHistory)
        .filter(e => e.type === 'add' || e.type === 'sell')
        .forEach(e => entries.push({ ...e, _ownerChar: ch }));
    });
    entries.sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
    entries = entries.slice(0, 300);
  } else {
    const c = chars.find(x => x.id === filter);
    if (!c) return null;
    entries = inventoryHistoryEntries(c.inventoryHistory)
      .filter(e => e.type === 'add' || e.type === 'sell')
      .map(e => ({ ...e, _ownerChar: c }));
  }

  const activeChar = isAll ? null : chars.find(x => x.id === filter);
  const title   = isAll ? '🧾 Historique — toute la campagne' : `🧾 Historique — ${activeChar?.nom || 'Personnage'}`;
  const subject = isAll ? 'la campagne' : (activeChar?.nom || 'ce personnage');
  const buys  = entries.filter(e => e.type === 'add').reduce((s, e) => s + (parseInt(e.qty) || 1), 0);
  const sells = entries.filter(e => e.type === 'sell').reduce((s, e) => s + (parseInt(e.qty) || 1), 0);

  // Filtre par personnage (MJ) : menu déroulant compact (comme les Hauts-faits),
  // adapté à un grand nombre de joueurs. Recherche si beaucoup de persos.
  const pickAv = isAll
    ? '<span class="sh-hist-pick-av sh-hist-pick-av--all">🌍</span>'
    : characterAvatarHtml(activeChar || {}, { size: 26, className: 'sh-hist-pick-av', title: false });
  const filterBar = isMj && chars.length ? `
    <details class="sh-hist-picker">
      <summary class="sh-hist-pick-summary">
        ${pickAv}
        <span class="sh-hist-pick-label"><small>Filtrer par joueur</small><b>${_esc(isAll ? 'Tous les joueurs' : (activeChar?.nom || 'Personnage'))}</b></span>
        <span class="sh-hist-pick-count">${entries.length}</span>
        <span class="sh-hist-pick-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="sh-hist-pick-menu">
        ${chars.length > 6 ? `<label class="sh-hist-pick-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Rechercher un joueur…" data-sh-action="histPickSearch" data-sh-on="input" autocomplete="off"></label>` : ''}
        <button type="button" class="sh-hist-pick-opt${isAll ? ' is-on' : ''}" data-sh-action="historyScope" data-scope="__all">
          <span class="sh-hist-pick-av sh-hist-pick-av--all">🌍</span>
          <span class="sh-hist-pick-opt-main"><strong>Tous les joueurs</strong><small>${chars.length} perso${chars.length > 1 ? 's' : ''}</small></span>
          <span class="sh-hist-pick-opt-check">${isAll ? '✓' : ''}</span>
        </button>
        ${chars.map(ch => `
          <button type="button" class="sh-hist-pick-opt${filter === ch.id ? ' is-on' : ''}" data-sh-action="historyScope" data-scope="${_esc(ch.id)}" data-name="${_esc((ch.nom || '').toLowerCase())}">
            ${characterAvatarHtml(ch, { size: 26, className: 'sh-hist-pick-av', title: false })}
            <span class="sh-hist-pick-opt-main"><strong>${_esc(ch.nom || '?')}</strong><small>${calcOr(ch)} or</small></span>
            <span class="sh-hist-pick-opt-check">${filter === ch.id ? '✓' : ''}</span>
          </button>`).join('')}
      </div>
    </details>` : '';

  const rows = entries.length ? entries.map(e => {
    const kind      = _shHistKind(e);
    const meta      = _SH_HIST_KINDS[kind];
    const item      = e.itemId ? _items.find(i => i.id === e.itemId) : null;
    const clickable = !!item;
    const qty       = Math.max(1, parseInt(e.qty) || 1);
    const media     = e.image
      ? `<img src="${_esc(e.image)}" alt="">`
      : `<span>${_esc(e.icon || meta.ic)}</span>`;
    const ownerCh   = e._ownerChar;
    const owner     = (isAll && ownerCh)
      ? `<span class="sh-hist-owner">${characterAvatarHtml(ownerCh, { size: 18, className: 'sh-hist-owner-av', title: false })}<b>${_esc(ownerCh.nom || '?')}</b></span> · `
      : '';
    return `<button type="button" class="sh-hist-row sh-hist-row--${kind}${clickable ? '' : ' is-disabled'}"
        ${clickable ? `data-sh-action="historyOpenItem" data-id="${_esc(e.itemId)}"` : 'disabled'}
        title="${clickable ? "Ouvrir la fiche de l'objet" : 'Article retiré de la boutique'}">
      <span class="sh-hist-badge sh-hist-badge--${kind}">${meta.ic} ${meta.lbl}</span>
      <span class="sh-hist-media">${media}</span>
      <span class="sh-hist-main">
        <span class="sh-hist-name">${_esc(e.name || 'Objet')}${qty > 1 ? ` <b>×${qty}</b>` : ''}</span>
        <span class="sh-hist-meta">${owner}${_esc(_shHistoryTimeAgo(e.at))}${e.note ? ` · ${_esc(e.note)}` : ''}${clickable ? '' : ' · <i>retiré</i>'}</span>
      </span>
      ${clickable ? '<span class="sh-hist-arrow" aria-hidden="true">→</span>' : ''}
    </button>`;
  }).join('') : `<div class="sh-hist-empty">Aucun achat ni vente pour <strong>${_esc(subject)}</strong>.<br><small>Les objets achetés et vendus apparaîtront ici.</small></div>`;

  const html = `
    <div class="sh-hist-modal">
      ${filterBar}
      <div class="sh-hist-summary">
        <span class="sh-hist-stat sh-hist-stat--buy"><b>🛒 ${buys}</b> acheté${buys > 1 ? 's' : ''}</span>
        <span class="sh-hist-stat sh-hist-stat--sell"><b>💰 ${sells}</b> vendu${sells > 1 ? 's' : ''}</span>
      </div>
      <div class="sh-hist-list">${rows}</div>
      <p class="sh-hist-hint">Clique une ligne pour ouvrir la fiche de l'objet.</p>
    </div>`;
  return { title, html };
}

export function openShopHistory(scope) {
  if (!scope) {
    const id = getShopCharId();
    const hasChar = !!STATE.characters?.find(x => x.id === id);
    scope = hasChar ? id : (STATE.isAdmin ? '__all' : id);
  }
  const built = _shHistoryBuild(scope);
  if (!built) { showNotif('Sélectionne un personnage pour voir son historique.', 'error'); return; }
  openModal(built.title, built.html);
}

function _shHistorySetScope(scope) {
  const built = _shHistoryBuild(scope);
  if (!built) { showNotif('Sélectionne un personnage pour voir son historique.', 'error'); return; }
  updateModalContent(built.title, built.html);
}

function _shHistoryOpenItem(itemId) {
  // Ouvre la fiche PAR-DESSUS l'historique (pile de modales) : « Échap » ou
  // fermeture de la fiche ramène à l'historique au lieu de tout fermer.
  openShopItemDetail(itemId);
}

export async function restockShopItem(itemId) {
  const shopItem = _items.find(i => i.id === itemId);
  if (!shopItem) return;
  const cur = shopItem.dispo !== undefined && shopItem.dispo !== '' ? parseInt(shopItem.dispo) : null;
  if (cur !== null && cur >= 0) {
    await updateInCol('shop', itemId, { dispo: cur + 1 });
    shopItem.dispo = cur + 1;
  }
}

// MJ : bascule la visibilité d'un article aux joueurs (un clic, sans modale).
// Retourne le nouvel état `masque` pour le feedback appelant.
export async function toggleShopItemVisibility(itemId) {
  const shopItem = _items.find(i => i.id === itemId);
  if (!shopItem) return null;
  const next = !shopItem.masque;
  await updateInCol('shop', itemId, { masque: next });
  shopItem.masque = next;
  return next;
}

// ══════════════════════════════════════════════════════════════════════════════
// VENDRE un item de l'inventaire (appelé depuis characters.js)
// ══════════════════════════════════════════════════════════════════════════════
export async function sellInvItemFromShop(charId, invIndex, opts = {}) {
  try {
    const c = STATE.characters?.find(x => x.id === charId);
    if (!c) return;

    const inv  = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
    const item = inv[invIndex];
    if (!item) return;

    const prixVente = parseFloat(item.prixVente) || 0;
    const itemNom   = item.nom || 'cet objet';

    if (!opts.skipConfirm && !await confirmModal(`Vendre "${_esc(itemNom)}" pour ${prixVente} or ?`, { title: 'Confirmation de vente' })) return;

    if (item.itemId) {
      const shopItem = await import('../data/firestore.js').then(m => m.getDocData('shop', item.itemId)).catch(()=>null);
      if (shopItem) {
        const curDispo = shopItem.dispo !== undefined && shopItem.dispo !== '' ? parseInt(shopItem.dispo) : null;
        if (curDispo !== null && curDispo >= 0) {
          await updateInCol('shop', item.itemId, { dispo: curDispo + 1 });
          const si = _items.find(i => i.id === item.itemId);
          if (si) si.dispo = curDispo + 1;
        }
      }
    }

    inv.splice(invIndex, 1);
    const equipSync = syncEquipmentAfterInventoryMutation(c, [invIndex]);
    const historyPatch = inventoryHistoryPayload(c, makeInventoryHistoryEntry('sell', item, 1, {
      ..._inventoryHistoryActor(),
      source: 'Boutique',
      note: `${prixVente} or`,
    }));
    const extraPayload = { inventaire: inv, ...historyPatch };
    if (equipSync.changed) {
      extraPayload.equipement = equipSync.equipement;
      extraPayload.statsBonus = equipSync.statsBonus;
    }

    const res = await useGold(charId, +prixVente, `Vente : ${itemNom}`, {
      charObj: c,
      extraPayload,
    });
    if (!res.ok) { showNotif(res.error || 'Erreur vente', 'error'); return; }
    c.inventoryHistory = historyPatch.inventoryHistory;

    const unequipMsg = equipSync.removedSlots.length
      ? ' Objet déséquipé automatiquement.'
      : '';
    showNotif(`💰 "${itemNom}" vendu pour ${prixVente} or !${unequipMsg}`, 'success');
  } catch (e) { notifySaveError(e); }
}


// ══════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════════
function shopGoHome()     { _view='home';  _activeCat=null; _page=1; _filterSearch=''; _filterTags.clear(); renderShop(); }
export function shopGoCat(catId) { _view='items'; _activeCat=catId; _page=1; _filterSearch=''; _filterTags.clear(); renderShop(); }
function shopPage(p) {
  _page = p;
  _updateResults();
  document.querySelector('.shc-main')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// ── Fonctions de filtre ───────────────────────────────────────────────────────
function shopSetSort(val) {
  _filterSort = val;
  _lsSet('shop_sort', val);
  _page = 1;
  _updateResults();
}

export function shopFilterSearch(val) {
  _filterSearch = val;
  _page = 1;
  _updateResults();
  _syncShopSearchChrome();
}

function _syncShopSearchChrome() {
  const clear = document.querySelector('.shc-search-clear');
  if (clear) clear.hidden = !_filterSearch;
}

function shopClearSearch() {
  const input = document.getElementById('sh-search');
  if (input) input.value = '';
  shopFilterSearch('');
  requestAnimationFrame(() => input?.focus({ preventScroll: true }));
}

function _shopKeyboardQol(event) {
  if (STATE.currentPage !== 'shop' && !document.querySelector('.sh-page--v2')) return;
  if (event.key === 'Escape') {
    const menu = document.querySelector('.shc-manage[open], .sh-char-picker[open]');
    if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); return; }
  }
  const search = event.target?.closest?.('#sh-search');
  if (search && (event.key === 'Enter' || event.key === 'ArrowDown')) {
    const first = document.getElementById('sh-items-results')?.querySelector('[data-sh-key-card="item"]');
    if (!first) return;
    event.preventDefault();
    if (event.key === 'Enter') first.click();
    else {
      first.focus({ preventScroll: true });
      first.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    return;
  }

  const card = event.target?.closest?.('[data-sh-key-card]');
  if (!card || event.target !== card || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  card.click();
}

function shopToggleTag(val) {
  if (_filterTags.has(val)) _filterTags.delete(val);
  else _filterTags.add(val);
  _page = 1;
  _updateResults();
}

function shopFilterReset() {
  _filterSearch = '';
  _filterTags.clear();
  _smartFilters.clear();
  _page = 1;
  const inp = document.getElementById('sh-search');
  if (inp) inp.value = '';
  _syncShopSearchChrome();
  _refreshSmartFiltersFromCache();
}

// Rend le focus à l'élément équivalent après un re-rendu partiel (clavier).
function _refocus(selector) {
  if (!selector) return;
  requestAnimationFrame(() => document.querySelector(selector)?.focus({ preventScroll: true }));
}
function _focusKey() {
  const el = document.activeElement;
  if (el?.dataset?.smart) return `[data-smart="${el.dataset.smart}"]`;
  if (el?.dataset?.shAction === 'toggleFav' && el.dataset.id) return `[data-sh-action="toggleFav"][data-id="${CSS.escape(el.dataset.id)}"]`;
  return '';
}

// ── Mise à jour partielle : résultats + compteurs + filtres, sans toucher le
// champ de recherche (la saisie garde le focus et le curseur).
function _updateResults() {
  const results = document.getElementById('sh-items-results');
  if (!results) { renderShop(); return; }
  const refocus = _focusKey();
  const st = _catalogState();

  const meta = document.getElementById('sh-category-meta');
  if (meta) meta.textContent = _catalogMetaText(st);

  const toggle = document.getElementById('sh-filter-toggle');
  if (toggle) toggle.outerHTML = _renderFilterToggle(st.groups);
  document.querySelectorAll('#sh-filters [data-tag-value]').forEach(btn => {
    const on = _filterTags.has(btn.dataset.tagValue);
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  const active = document.getElementById('sh-active-filters');
  if (active) active.innerHTML = _renderActiveFilters(st.groups);

  results.innerHTML = _renderResultsHtml(st);
  _refocus(refocus);
  // Le remplacement de innerHTML détruit l'ancien conteneur Sortable. Le
  // remonter à la frame suivante permet d'enchaîner les déplacements sans
  // recharger la page, y compris après le re-rendu déclenché par un drag.
  _scheduleSortablesMount();
}

function _refreshSmartFiltersFromCache() {
  const refocus = _focusKey();
  const smart = document.getElementById('sh-smart');
  if (smart) smart.innerHTML = _renderSmartChips();
  _updateResults();
  _refocus(refocus);
}

// ══════════════════════════════════════════════════════════════════════════════
// DRAG & DROP (SortableJS) — Catégories & Articles
// ══════════════════════════════════════════════════════════════════════════════
let _sortCats = null, _sortItems = null, _dragBlockClick = false, _clickGuardInstalled = false;
let _sortMountFrame = null;

function _scheduleSortablesMount() {
  if (_sortMountFrame) cancelAnimationFrame(_sortMountFrame);
  _sortMountFrame = requestAnimationFrame(() => {
    _sortMountFrame = null;
    _mountSortables();
  });
}

function _installClickGuard() {
  if (_clickGuardInstalled) return;
  _clickGuardInstalled = true;
  // Sur window (et non document) : la délégation data-sh-action écoute déjà
  // document en capture ; window passe avant elle, sinon le clic qui suit le
  // lâcher (Firefox) ouvrait la carte / la catégorie glissée.
  window.addEventListener('click', (e) => {
    if (_dragBlockClick) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}

function _mountSortables() {
  if (!STATE.isAdmin) return;
  _installClickGuard();

  _sortCats?.destroy(); _sortCats = null;
  _sortItems?.destroy(); _sortItems = null;

  const shOpts = {
    prefix: 'sh',
    animation: 120,
    draggable: '.sh-sortable-item',
    filter: 'button, a, input, select, textarea, .shc-card-admin, .shc-card-cta, .shc-row-actions',
    onStart: () => { document.body.classList.add('sh-dragging'); _dragBlockClick = true; },
  };
  const finishDrag = () => {
    document.body.classList.remove('sh-dragging');
    setTimeout(() => { _dragBlockClick = false; }, 350);
  };

  // Catégories : réordonnées en glissant les liens du rail (des <button> →
  // pas de filtre « button » ici, le garde-clic évite l'ouverture au lâcher).
  const catRail = document.getElementById('sh-cat-rail');
  if (catRail?.classList.contains('sh-sortable')) {
    _sortCats = makeSortable(catRail, {
      ...shOpts,
      filter: '.shc-rail-eye',
      onEnd: async (evt) => {
        finishDrag();
        if (evt.oldIndex === evt.newIndex) return;
        const [moved] = _cats.splice(evt.oldIndex, 1);
        _cats.splice(evt.newIndex, 0, moved);
        try {
          // N'écrire que les catégories dont l'ordre change réellement
          // (déplacer 1 item ≈ 2 writes au lieu de N).
          const writes = [];
          _cats.forEach((cat, i) => { if (Number(cat.ordre) !== i) writes.push(updateInCol('shopCategories', cat.id, { ordre: i })); });
          await Promise.all(writes);
          _cats.forEach((cat, i) => { cat.ordre = i; });
          if (_view === 'home') _updateResults(); // « Tout » est groupé par catégorie
        } catch (err) { notifySaveError(err); renderShop(); }
      },
    });
  }

  const itemGrid = document.getElementById('sh-items-grid');
  if (itemGrid && itemGrid.classList.contains('sh-sortable')) {
    _sortItems = makeSortable(itemGrid, {
      ...shOpts,
      onEnd: async (evt) => {
        finishDrag();
        if (evt.oldIndex === evt.newIndex) return;

        // L'ordre du DOM est la seule source fiable ici : les index Sortable
        // portent sur la page affichée, qui peut être filtrée, paginée ou triée.
        const domIds = [...itemGrid.children]
          .filter(element => element.classList.contains('sh-sortable-item'))
          .map(element => element.dataset.itemId)
          .filter(Boolean);
        const displayed = _getFilteredItems(_activeCat);
        const pageStart = _isManualOrganizeMode() ? 0 : (Math.max(1, _page) - 1) * PAGE_SIZE;
        const desiredVisibleIds = displayed.map(item => item.id);
        desiredVisibleIds.splice(pageStart, domIds.length, ...domIds);

        const base = [..._getBaseItems(_activeCat)].sort(compareManualOrder);
        const reordered = mergeVisibleManualOrder(base, desiredVisibleIds);
        const previousSort = _filterSort;
        _filterSort = 'ordre';
        localStorage.setItem('shop_sort', 'ordre');
        try {
          // Les lots réduisent les allers-retours sans dépasser la limite
          // Firestore. Tous les articles déplacés reçoivent un ordre unique.
          const updates = reordered
            .map((item, ordre) => ({ item, ordre }))
            .filter(({ item, ordre }) => manualOrderValue(item) !== ordre)
            .map(({ item, ordre }) => ({ col: 'shop', id: item.id, data: { ordre } }));
          for (let i = 0; i < updates.length; i += 450) {
            await batchUpdateInCol(updates.slice(i, i + 450));
          }
          reordered.forEach((item, ordre) => { item.ordre = ordre; });
          _items.sort(compareManualOrder);
          if (previousSort !== 'ordre') showNotif('Ordre manuel activé et enregistré.', 'success');
          _updateResults();
        } catch (err) { notifySaveError(err); renderShop(); }
      },
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL CATÉGORIE
// ══════════════════════════════════════════════════════════════════════════════
function openCatModal(catId) {
  const cat        = catId ? _cats.find(c=>c.id===catId) : null;
  const tplOptions = Object.entries(TEMPLATES).map(([k,v])=>`<option value="${k}" ${(cat?.template||'classique')===k?'selected':''}>${v.label}</option>`).join('');
  openModal('', `
  <div class="sh-admin-modal is-cat">
    <div class="sh-admin-head">
      <div class="sh-admin-head-ico">${cat ? '✏️' : '📁'}</div>
      <div class="sh-admin-head-title">
        <h2>${cat ? `Modifier « ${_esc(cat.nom||'?')} »` : 'Nouvelle catégorie'}</h2>
        <small>${cat ? 'Édite les méta de cette catégorie boutique.' : 'Crée une nouvelle catégorie pour ranger tes articles.'}</small>
      </div>
      <button class="sh-admin-close" data-sh-action="closeModal" title="Fermer">✕</button>
    </div>

    <div class="sh-admin-body">
      <div class="sh-admin-section">
        <div class="sh-admin-section-title">📝 Identité</div>
        <div class="sh-admin-row">
          <div class="sh-admin-row-line">
            <span class="sh-admin-row-lbl">Nom de la catégorie</span>
          </div>
          <input class="sh-admin-row-input" id="cat-nom" value="${_esc(cat?.nom||'')}"
            placeholder="Armes physiques, Épicerie…"
            style="width:100%;text-align:left">
        </div>
        <div class="sh-admin-grid-2" style="margin-top:8px">
          <div class="sh-admin-row">
            <div class="sh-admin-row-line">
              <span class="sh-admin-row-lbl">Emoji</span>
              <input class="sh-admin-row-input small" id="cat-emoji" value="${_esc(cat?.emoji||'')}" placeholder="⚔️">
            </div>
          </div>
          <div class="sh-admin-row">
            <label class="sh-admin-row-checkbox" style="cursor:pointer">
              <input type="checkbox" id="cat-masquee" ${cat?.masquee?'checked':''}>
              <span>👁️ Masquer aux joueurs</span>
            </label>
          </div>
        </div>
      </div>

      <div class="sh-admin-section">
        <div class="sh-admin-section-title">🎯 Type par défaut <small class="sh-label">(fallback pour les anciens items)</small></div>
        <p class="sh-admin-section-hint">Désormais chaque article a son propre type. Cette valeur sert uniquement de défaut pour les articles créés sans type explicite.</p>
        <select class="sh-admin-row-input" id="cat-template" style="width:100%;text-align:left;font-family:inherit;font-weight:500">${tplOptions}</select>
        <div id="cat-tpl-preview" class="sh-admin-preview"></div>
      </div>

      <div class="sh-admin-section">
        <div class="sh-admin-section-title">🖼️ Illustration <small class="sh-label">(optionnelle)</small></div>
        <p class="sh-admin-section-hint">Affichée en background de la pastille catégorie sur la page d'accueil.</p>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <div id="cat-img-preview" style="width:90px;height:60px;border-radius:8px;background:rgba(0,0,0,.30);border:1px dashed var(--border-md);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0">
            ${cat?.image ? `<img src="${cat.image}" alt="${_esc(cat.nom || '')}" style="width:100%;height:100%;object-fit:cover">` : '<span style="color:var(--text-dim);font-size:1.4rem">🖼️</span>'}
          </div>
          <label style="flex:1;min-width:0">
            <input type="file" id="cat-img-file" accept="image/*"
              data-sh-action="uploadImg" data-sh-on="change" data-preview="cat-img-preview" data-hidden="cat-img-b64"
              style="font-size:.78rem;color:var(--text-muted);width:100%">
            <input type="hidden" id="cat-img-b64" value="${cat?.image||''}">
          </label>
        </div>
      </div>

      <p class="sh-admin-intro" style="font-size:.7rem;font-style:italic">
        💡 Si tu supprimes cette catégorie, ses articles restent disponibles en butin et revendables — ils basculent juste dans « Non classé ».
      </p>
    </div>

    <div class="sh-admin-footer">
      <button class="btn btn-outline btn-sm" data-sh-action="closeModal">Annuler</button>
      <div class="sh-admin-footer-spacer"></div>
      ${cat ? `<button class="btn btn-outline btn-sm sh-buy-btn--poor" data-sh-action="deleteCat" data-id="${cat.id}">🗑️ Supprimer</button>` : ''}
      <button class="btn btn-gold btn-sm" data-sh-action="saveCat" data-id="${catId||''}">
        ${cat ? '💾 Enregistrer' : '➕ Créer'}
      </button>
    </div>
  </div>
  `);
  setTimeout(()=>{
    document.getElementById('cat-nom')?.focus();
    _updateTplPreview();
    document.getElementById('cat-template')?.addEventListener('change', _updateTplPreview);
  }, 60);
}

function _updateTplPreview() {
  const sel  = document.getElementById('cat-template')?.value;
  const prev = document.getElementById('cat-tpl-preview');
  if (!sel || !prev) return;
  const tpl = TEMPLATES[sel]; if (!tpl) return;
  prev.innerHTML = tpl.fields.map(f => `<span class="sh-admin-preview-chip">${_esc(f.label)}</span>`).join('');
}

async function saveCat(catId) {
  try {
    const nom=document.getElementById('cat-nom')?.value.trim();
    if(!nom){showNotif('Nom requis.','error');return;}
    const data={ nom, template:document.getElementById('cat-template')?.value||'classique', emoji:document.getElementById('cat-emoji')?.value.trim()||'', image:document.getElementById('cat-img-b64')?.value||'', masquee:document.getElementById('cat-masquee')?.checked||false };
    if(catId) await updateInCol('shopCategories',catId,data);
    else await addToCol('shopCategories',{...data,ordre:_cats.length,sousCats:[]});
    closeModalDirect(); showNotif(catId?'Catégorie mise à jour.':'Catégorie créée !','success'); renderShop();
  } catch (e) { notifySaveError(e); }
}

async function deleteCat(catId) {
  try {
    const cat = _cats.find(entry => entry.id === catId);
    if (!cat) return;
    const n = _items.filter(i => i.categorieId === catId).length;
    const message = n > 0
      ? `Supprimer cette catégorie ? Ses ${n} article${n > 1 ? 's' : ''} passeront dans « Non classé » et ne seront pas supprimés.`
      : 'Supprimer cette catégorie ?';
    const deleted = await confirmDelete('shopCategories', catId, message, {
      snapshot: cat,
      title: 'Confirmation de suppression',
      successMessage: n > 0 ? `Catégorie supprimée · ${n} article${n > 1 ? 's' : ''} conservé${n > 1 ? 's' : ''}.` : 'Catégorie supprimée.',
      onRestore: () => renderShop(),
    });
    if (!deleted) return;
    if(_activeCat===catId){_view='home';_activeCat=null;}
    renderShop();
  } catch (e) { notifySaveError(e); }
}

// ══════════════════════════════════════════════════════════════════════════════
// ÉDITEUR D'ACTIONS — chaque article peut exposer 1+ Actions/Bonus/Réactions
// ──────────────────────────────────────────────────────────────────────────────
// Schéma d'une action :
//   { id, type:'action'|'bonus'|'reaction', nom, description,
//     pmCost, consommable,
//     degats (formule), degatsStat (force/dex/in/sa/co/ch),
//     typeId (damageType), portee, nbCibles, isHeal, targetSelf }
// ══════════════════════════════════════════════════════════════════════════════
let _shopDamageTypes = null;
async function _shopEnsureDamageTypes() {
  if (!_shopDamageTypes) _shopDamageTypes = await loadDamageTypes();
  return _shopDamageTypes;
}

// ── Profil de dégâts porté (résistances / immunités / absorptions / faiblesses) ──
// Affiché dans l'onglet « Bonus » des objets équipables (arme/armure/bijou).
// Appliqué côté VTT quand le perso est touché (cf. getCharDamageProfile + applyDamageTypeInteraction).

function _shopRenderDamageProfileSection(item) {
  const prof  = item?.damageProfile || {};
  const types = _shopDamageTypes;
  const rows = !types
    ? loadingHtml('Chargement des types de dégâts…', { compact: true })
    : DAMAGE_RELATIONS.map(rel => {
        const active = Array.isArray(prof[rel.key]) ? prof[rel.key] : [];
        return `<div class="sh-dmgprof-row" style="border-left:3px solid ${rel.color};background:${rel.color}0d">
          <div class="sh-dmgprof-head">
            <span>${rel.icon}</span>
            <span style="color:${rel.color}">${rel.label}</span>
            <span class="sh-dmgprof-rule">${rel.shortLabel}</span>
          </div>
          <div class="sh-dmgprof-chips">
            ${types.map(t => {
              const on = active.includes(t.id);
              return `<button type="button" class="sh-dmgprof-chip${on ? ' is-on' : ''}"
                style="${on ? `color:${rel.color};border-color:${rel.color};background:${rel.color}1a` : ''}"
                data-sh-action="toggleDmgProfile" data-rel="${rel.key}" data-tid="${t.id}" aria-pressed="${on}">
                ${t.icon || ''} ${_esc(t.label)}
              </button>`;
            }).join('')}
          </div>
        </div>`;
      }).join('');
  return `<div class="sh-dmgprof sh-field-full">
    <div class="sh-dmgprof-title">🛡️ Résistances accordées <span class="sh-dmgprof-sub">— quand l'objet est équipé</span></div>
    <div class="sh-dmgprof-hint">Non cumulable. En cas de conflit sur un même type : Immunité &gt; Absorption &gt; Faiblesse &gt; Résistance.</div>
    <div id="si-dmgprof-rows">${rows}</div>
  </div>`;
}

/** Lit le profil de dégâts coché dans le modal. Retourne null si la section est absente. */
function _shopCollectDamageProfile() {
  const host = document.getElementById('si-dmgprof-rows');
  if (!host) return null;
  const out = { resistances: [], immunites: [], absorptions: [], faiblesses: [] };
  host.querySelectorAll('.sh-dmgprof-chip.is-on').forEach(ch => {
    const rel = ch.dataset.rel, tid = ch.dataset.tid;
    if (out[rel] && tid && !out[rel].includes(tid)) out[rel].push(tid);
  });
  return out;
}

/** Toggle d'un type sur une relation (résistance/immunité/…). État porté par le DOM jusqu'au save. */
function _shopToggleDmgProfile(btn) {
  if (!btn) return;
  const on = !btn.classList.contains('is-on');
  const rel = DAMAGE_RELATIONS.find(r => r.key === btn.dataset.rel);
  btn.classList.toggle('is-on', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.style.cssText = on && rel ? `color:${rel.color};border-color:${rel.color};background:${rel.color}1a` : '';
}

// Cache des compétences de dés (chargées depuis world/dice_skills)
let _shopDiceSkillsCache = null;
async function _shopLoadDiceSkills() {
  if (_shopDiceSkillsCache) return _shopDiceSkillsCache;
  try {
    const { getDocData } = await import('../data/firestore.js');
    const doc = await getDocData('world', 'dice_skills');
    if (doc?.skills?.length) {
      _shopDiceSkillsCache = doc.skills;
      return _shopDiceSkillsCache;
    }
  } catch {}
  // Fallback : liste par défaut
  try {
    const mod = await import('../shared/dice-skills.js');
    _shopDiceSkillsCache = mod.DICE_SKILLS_DEFAULT || [];
  } catch {
    _shopDiceSkillsCache = [];
  }
  return _shopDiceSkillsCache;
}

/** Rend une chip de bonus de compétence (skillName + value + bouton ✕). */
function _shopRenderSkillChipHTML(skillName, val) {
  const v = parseInt(val) || 0;
  const sign = v > 0 ? '+' : '';
  const col = v > 0 ? '#22c38e' : v < 0 ? '#ef4444' : 'var(--text-dim)';
  return `<span class="sh-skill-chip" data-skill="${_esc(skillName)}" data-val="${v}"
      style="display:inline-flex;align-items:center;gap:.35rem;padding:.25rem .55rem;
             background:rgba(255,255,255,.05);border:1px solid var(--border);border-radius:999px;
             font-size:.78rem;font-weight:600">
      <strong style="color:${col};font-variant-numeric:tabular-nums">${sign}${v}</strong>
      <span>${_esc(skillName)}</span>
      <button type="button" data-sh-action="skillRemove" data-skill="${skillName.replace(/"/g, '&quot;')}"
        style="background:transparent;border:0;cursor:pointer;color:var(--text-dim);padding:0;
               font-size:.85rem;line-height:1;margin-left:.15rem"
        title="Retirer">✕</button>
    </span>`;
}

/** Peuple le dropdown des compétences disponibles à ajouter (exclut celles déjà sélectionnées). */
async function _shopPopulateSkillPicker(savedBonuses = {}) {
  const picker = document.getElementById('si-skill-picker');
  if (!picker) return;
  const skills = await _shopLoadDiceSkills();
  const used = new Set(Object.keys(savedBonuses));
  if (!skills.length) {
    picker.innerHTML = '<option value="">⚠️ Aucune compétence — définir dans Console MJ</option>';
    return;
  }
  // Filtre les compétences déjà ajoutées
  const available = skills.filter(sk => !used.has(sk.name));
  picker.innerHTML = `<option value="">— Choisir une compétence —</option>`
    + available.map(sk => `<option value="${_esc(sk.name)}">${_esc(sk.name)}${sk.stat ? ` (${sk.stat})` : ''}</option>`).join('');
}

/** Ajoute un bonus de compétence (chip) depuis le picker. */
function addSkillBonus() {
  const picker = document.getElementById('si-skill-picker');
  const valInp = document.getElementById('si-skill-val');
  const skillName = picker?.value;
  const val = parseInt(valInp?.value);
  if (!skillName) { showNotif('Choisis une compétence', 'warning'); return; }
  if (!Number.isFinite(val) || val === 0) { showNotif('Valeur invalide (≠ 0)', 'warning'); return; }
  // Ajoute la chip dans le container
  const chips = document.getElementById('si-skill-chips');
  const empty = chips?.querySelector('.sh-skill-empty');
  if (empty) empty.remove();
  chips?.insertAdjacentHTML('beforeend', _shopRenderSkillChipHTML(skillName, val));
  // Retire l'option du picker
  picker.querySelector(`option[value="${skillName}"]`)?.remove();
  picker.value = '';
  if (valInp) valInp.value = '';
}

/** Retire un bonus de compétence. */
function removeSkillBonus(skillName) {
  const chips = document.getElementById('si-skill-chips');
  const chip = chips?.querySelector(`.sh-skill-chip[data-skill="${CSS.escape(skillName)}"]`);
  chip?.remove();
  // Réinjecte dans le picker (au bon endroit alphabétique, avec sa stat)
  const picker = document.getElementById('si-skill-picker');
  if (picker && _shopDiceSkillsCache) {
    const sk = _shopDiceSkillsCache.find(s => s.name === skillName);
    if (sk) {
      const opt = document.createElement('option');
      opt.value = sk.name;
      opt.textContent = sk.name + (sk.stat ? ` (${sk.stat})` : '');
      picker.appendChild(opt);
    }
  }
  // Si plus aucune chip : ré-affiche le placeholder vide
  if (chips && !chips.querySelector('.sh-skill-chip')) {
    chips.innerHTML = '<span class="sh-skill-empty" style="font-size:.75rem;color:var(--text-dim);font-style:italic">Aucun bonus — clique sur ＋ pour en ajouter</span>';
  }
}

// Lib des états (chargée depuis world/conditions).
async function _shopEnsureConditions() {
  return loadConditionLibrary();
}


// ═══════════════════════════════════════════════════════════════════
// ÉDITEUR D'ACTIONS — réutilise la modal de sort de perso (spells.js)
// ═══════════════════════════════════════════════════════════════════
// L'item.actions[i] est un sort complet (mêmes champs que deck_sorts).
// On ouvre la VRAIE modal de création de sort (editItemSpell) pour éditer.
// Cache mémoire pendant l'édition de l'item courant :
let _shopActionsCache = [];

/** Reset/charge le cache d'actions au moment d'ouvrir un item dans le shop. */
function _shopActionsCacheLoad(actions) {
  _shopActionsCache = Array.isArray(actions) ? actions.map(a => ({ ...a })) : [];
}

/** Carte récap d'une action (lecture seule + boutons Edit/Suppr). */
function _shopRenderActionCard(act, idx) {
  return spellActionCardHtml(act, idx, {
    className: 'si-action-card',
    actionAttr: 'data-sh-action',
    style: 'display:flex;align-items:center;gap:.6rem;padding:.55rem .7rem;background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px',
  });
}


function _shopRenderActionsSection(actions) {
  // Init le cache si pas déjà fait (premier render)
  if (actions && _shopActionsCache.length === 0 && Array.isArray(actions) && actions.length) {
    _shopActionsCacheLoad(actions);
  }
  // Précharge la lib des états (utile pour l'éditeur de sort)
  _shopEnsureConditions();
  const list = _shopActionsCache;
  return `
    <div class="form-group si-actions-section">
      <label class="si-actions-label">
        <span>⚡ Actions disponibles <span class="si-actions-hint">(sorts embarqués — même modal que les sorts de personnage)</span></span>
        <button type="button" class="btn btn-outline btn-sm" data-sh-action="addAction">＋ Ajouter</button>
      </label>
      <div id="si-actions-list" style="display:flex;flex-direction:column;gap:.4rem">
        ${list.length
          ? list.map((a, i) => _shopRenderActionCard(a, i)).join('')
          : '<div class="si-actions-empty">Aucune action définie — clique sur ＋ Ajouter pour ouvrir l\'éditeur de sort.</div>'}
      </div>
    </div>`;
}

function _shopCollectActions() {
  // Les actions sont maintenant éditées via la modal de sort qui maintient
  // _shopActionsCache. On retourne le cache courant tel quel.
  return _shopActionsCache.map(a => ({ ...a }));
}

/** Re-render in-place de la section actions depuis le cache. */
function _shopRefreshActionsHost() {
  const host = document.getElementById('si-actions-host');
  if (host) host.innerHTML = _shopRenderActionsSection(_shopActionsCache);
}

/** Hook commun appelé par la modal de sort après save : met à jour le cache. */
async function _shopActionsOnSave(itemSnapshot) {
  // editItemSpell passe l'item avec son nouveau item.actions. On synchronise le cache.
  _shopActionsCache = Array.isArray(itemSnapshot?.actions)
    ? itemSnapshot.actions.map(a => ({ ...a })) : [];
  _shopRefreshActionsHost();
}

/** Charge spells.js pour enregistrer ses actions et utiliser l'éditeur de sorts embarqués. */
async function _shopEnsureSpellsModule() {
  return import('./characters/spells.js');
}

async function addShopAction() {
  const mod = await _shopEnsureSpellsModule();
  if (typeof mod.addItemSpell !== 'function') {
    showNotif('Module sorts indisponible', 'error'); return;
  }
  const fakeItem = { actions: _shopActionsCache, nom: document.getElementById('si-nom')?.value || 'Objet' };
  mod.addItemSpell(fakeItem, async (updatedItem) => {
    await _shopActionsOnSave(updatedItem);
  });
}

async function editShopAction(idx) {
  const mod = await _shopEnsureSpellsModule();
  if (typeof mod.editItemSpell !== 'function') {
    showNotif('Module sorts indisponible', 'error'); return;
  }
  const fakeItem = { actions: _shopActionsCache, nom: document.getElementById('si-nom')?.value || 'Objet' };
  mod.editItemSpell(fakeItem, idx, async (updatedItem) => {
    await _shopActionsOnSave(updatedItem);
  });
}

async function removeShopAction(idx) {
  if (!Number.isFinite(idx)) return;
  const act = _shopActionsCache[idx];
  const nom = act?.nom || act?.label || 'cette action';
  if (!await confirmModal(`Supprimer <b>${_esc(nom)}</b> ?`, {
    title: 'Confirmation de suppression',
    confirmLabel: 'Supprimer',
    icon: '🗑️',
  })) return;
  _shopActionsCache.splice(idx, 1);
  _shopRefreshActionsHost();
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL ARTICLE — refonte (v2) : header compact + onglets sticky + footer fixe.
// Les IDs d'inputs sont préservés (saveShopItem inchangé).
// ══════════════════════════════════════════════════════════════════════════════

// Onglets disponibles par template (ordre = ordre d'affichage)
const _SI_TABS = {
  arme:      ['essentiel', 'bonus', 'traits', 'actions', 'lecture', 'meta'],
  armure:    ['essentiel', 'bonus', 'traits', 'actions', 'lecture', 'meta'],
  bijou:     ['essentiel', 'bonus', 'traits', 'actions', 'lecture', 'meta'],
  classique: ['essentiel', 'actions', 'lecture', 'meta'],
  libre:     ['essentiel', 'lecture', 'meta'],
};

const _SI_TAB_DEF = {
  essentiel: { label: 'Essentiel', icon: '⚙️' },
  bonus:     { label: 'Bonus',     icon: '✨' },
  traits:    { label: 'Traits',    icon: '🏷️' },
  actions:   { label: 'Actions',   icon: '⚡' },
  lecture:   { label: 'Texte',      icon: '📖' },
  meta:      { label: 'Méta',      icon: '🔧' },
};

// Champs de chaque onglet, par template. L'onglet "essentiel" regroupe TOUT
// ce qu'on touche 95% du temps : caractéristiques + prix/dispo/rareté.
const _SI_TAB_FIELDS = {
  arme: {
    essentiel: ['format','mains','rarete','degats','toucherStat','portee','prix','dispo'],
    bonus:     ['statBonuses','derivedBonuses','skillBonuses'],
    traits:    ['traits'],
  },
  armure: {
    essentiel: ['slotArmure','typeArmure','rarete','ca','prix','dispo'],
    bonus:     ['statBonuses','derivedBonuses','skillBonuses'],
    traits:    ['traits'],
  },
  bijou: {
    essentiel: ['slotBijou','rarete','prix','dispo'],
    bonus:     ['statBonuses','derivedBonuses','skillBonuses'],
    traits:    ['traits'],
  },
  classique: {
    essentiel: ['type','effet','description','prix','dispo'],
  },
  libre: {
    essentiel: ['type','description','prix','dispo'],
  },
};

function _siBuildFieldsSubset(tpl, item, fieldIds) {
  if (!fieldIds?.length) return '';
  const subTpl = { ...tpl, fields: tpl.fields.filter(f => fieldIds.includes(f.id)) };
  if (!subTpl.fields.length) return '';
  return _buildFieldsHtml(subTpl, item);
}

/** Contenu d'un onglet (HTML). */
function _siBuildTabContent(tab, tpl, item, tplKey) {
  if (tab === 'essentiel' || tab === 'bonus' || tab === 'traits') {
    let h = _siBuildFieldsSubset(tpl, item, _SI_TAB_FIELDS[tplKey]?.[tab] || []);
    if (tab === 'bonus' && ['arme', 'armure', 'bijou'].includes(tplKey)) {
      h += _shopRenderDamageProfileSection(item);
    }
    return h;
  }
  if (tab === 'actions') {
    return `<div class="si-actions-toggle">
      <label>
        <input type="checkbox" id="si-consommable" ${item?.consommable?'checked':''}>
        <span class="si-actions-toggle-lbl">🧪 Objet consommable</span>
        <span class="si-actions-toggle-hint">— perd 1 exemplaire à chaque utilisation</span>
      </label>
    </div>
    <div id="si-actions-host">${_shopRenderActionsSection(item?.actions)}</div>`;
  }
  if (tab === 'lecture') {
    const readableContent = sanitizeRichTextHtml(item?.readableContent || '');
    return `<div class="si-readable-editor">
      <div class="si-readable-intro">
        <span aria-hidden="true">📖</span>
        <div>
          <strong>Contenu à découvrir après acquisition</strong>
          <p>Ce texte n'est jamais affiché dans la boutique. Le joueur pourra l'ouvrir depuis l'inventaire du personnage qui possède l'objet.</p>
        </div>
      </div>
      <label class="si-readable-title">
        <span>Titre du document</span>
        <input class="input-field" id="si-readable-title" value="${_esc(item?.readableTitle || '')}"
          placeholder="Ex. Chroniques de Vaudral — Tome I">
      </label>
      ${quillEditorHtml({
        id: 'si-readable-content',
        html: readableContent,
        placeholder: 'Écris ici l’histoire, la lettre, les notes ou le contenu du livre…',
        minHeight: 300,
      })}
      <small class="si-readable-hint">Laisse le texte vide si l'objet ne doit rien contenir de lisible.</small>
    </div>`;
  }
  if (tab === 'meta') {
    const recipeChk = item ? !(item?.recipeMeta?.hidden) : ['arme','armure','bijou'].includes(tplKey);
    // Nouveauté : actif si newUntil dans le futur (ou legacy isNew). Nouveau
    // article → coché par défaut (il sera flaggé 2 semaines à la création).
    const newUntilMs = _itemNewUntilMs(item);
    const newActive  = item ? (newUntilMs > Date.now() || item.isNew === true) : true;
    const newHint    = newUntilMs > Date.now()
      ? `Actif dans le filtre « Nouveautés » jusqu'au ${new Date(newUntilMs).toLocaleDateString('fr-FR')}`
      : 'Place l\'article dans le filtre « Nouveautés » pendant 2 semaines, puis se désactive seul.';
    return `<div class="si-meta-grid">
      <label class="si-meta-row">
        <input type="checkbox" id="si-masque" ${item?.masque ? 'checked' : ''}>
        <span>
          <strong>${eyeIcon(true)} Masquer aux joueurs</strong>
          <em>L'article n'apparaît plus dans la boutique pour les joueurs (visible du MJ). Reste récupérable en butin.</em>
        </span>
      </label>
      <label class="si-meta-row">
        <input type="checkbox" id="si-new" ${newActive ? 'checked' : ''}>
        <span>
          <strong>✨ Nouveauté (2 semaines)</strong>
          <em>${newHint}</em>
        </span>
      </label>
      <label class="si-meta-row">
        <input type="checkbox" id="si-has-recipe" ${recipeChk ? 'checked' : ''}>
        <span>
          <strong>Recette d'artisanat</strong>
          <em>Permet de fabriquer cet objet via l'Artisan</em>
        </span>
      </label>
    </div>`;
  }
  return '';
}

/** Construit la barre d'onglets + tous les panneaux (1 seul visible à la fois). */
function _siBuildTabs(tpl, item, tplKey, activeTab = 'essentiel') {
  const tabs = _SI_TABS[tplKey] || ['essentiel'];
  const active = tabs.includes(activeTab) ? activeTab : tabs[0];
  const strip = tabs.map((t, i) => {
    const d = _SI_TAB_DEF[t];
    return `<button type="button" class="si-tab${t===active?' is-active':''}"
              data-tab="${t}" data-sh-action="setTab"
              title="Alt+${i+1}">${d.icon} <span>${d.label}</span></button>`;
  }).join('');
  const panels = tabs.map(t => `
    <div class="si-panel${t===active?' is-active':''}" data-panel="${t}">
      ${_siBuildTabContent(t, tpl, item, tplKey)}
    </div>`).join('');
  return `<nav class="si-tabs">${strip}</nav>
    <div class="si-panels">${panels}</div>`;
}

/** Switch d'onglet — pure manipulation DOM, ne reconstruit rien. */
function setItemTab(name) {
  document.querySelectorAll('.si-tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === name));
  document.querySelectorAll('.si-panel').forEach(p => p.classList.toggle('is-active', p.dataset.panel === name));
  if (name === 'lecture') bindQuillEditors(document.querySelector('.si-modal') || document).catch(() => {});
}

/** Mini "carte" live qui montre comment l'objet apparaîtra dans la boutique. */
function _siRefreshChip() {
  const chip = document.getElementById('si-name-chip');
  if (!chip) return;
  const nom = document.getElementById('si-nom')?.value || '—';
  const rN  = parseInt(document.getElementById('si-rarete')?.value) || 0;
  const rar = rN > 0 ? (RARETE_NAMES[rN] || '') : '';
  const col = rar ? (_rareteColor(rar) || 'var(--text)') : 'var(--text)';
  chip.innerHTML = `<span style="color:${col}">${_esc(nom)}</span>${rar?` <em style="color:${col};opacity:.7;font-size:.72rem;font-style:normal">· ${_esc(rar)}</em>`:''}`;
}
async function openItemModal(itemId) {
  const catalogItem = itemId ? _items.find(i=>i.id===itemId) : null;
  const storedContent = itemId ? await getDocDataSilent('shopContent', itemId) : null;
  _shopReadableDraft = {
    itemId: itemId || '',
    title: storedContent?.title || catalogItem?.readableTitle || '',
    html: storedContent?.html || catalogItem?.readableContent || '',
  };
  const item = catalogItem ? {
    ...catalogItem,
    readableTitle: _shopReadableDraft.title,
    readableContent: _shopReadableDraft.html,
  } : null;
  _shopActionsCacheLoad(item?.actions || []);
  _shopEnsureSpellsModule().catch(() => {});

  const defCatId   = item?.categorieId || _activeCat || '';
  const cat        = _cats.find(c=>c.id===defCatId);
  // Le template vient désormais DE L'ITEM en priorité (item.template),
  // avec fallback sur la catégorie pour rétrocompat sur les vieux items.
  const tplKey     = item?.template || cat?.template || 'classique';
  const tpl        = TEMPLATES[tplKey] || TEMPLATES.classique;
  const catOptions = _cats.map(c=>`<option value="${c.id}" ${defCatId===c.id?'selected':''}>${c.nom}</option>`).join('');
  const tplOptions = Object.entries(TEMPLATES).map(([k, t]) =>
    `<option value="${k}" ${tplKey===k?'selected':''}>${t.label || k}</option>`
  ).join('');

  const imgPreviewHtml = item?.image
    ? `<img src="${_esc(item.image)}" alt="Aperçu de ${_esc(item.nom || 'l’article')}">`
    : `<span class="si-img-placeholder">+</span>`;

  const headerHtml = `
    <div class="si-header">
      <label class="si-img-btn" title="Cliquer pour changer l'image">
        <input type="file" id="si-img-file" accept="image/*"
               data-sh-action="uploadImg" data-sh-on="change" data-preview="si-img-preview-thumb" data-hidden="si-img-b64"
               style="display:none">
        <input type="hidden" id="si-img-b64" value="${item?.image||''}">
        <div id="si-img-preview-thumb" class="si-img-thumb">${imgPreviewHtml}</div>
      </label>
      <div class="si-header-fields">
        <input class="input-field si-name-input" id="si-nom"
               value="${(item?.nom||'').replace(/"/g,'&quot;')}"
               placeholder="Nom de l'article…"
               data-sh-action="refreshChip" data-sh-on="input">
        <div class="si-header-row2">
          <select class="input-field sh-modal-select si-cat-select" id="si-cat"
                  data-sh-action="setItemCat" data-sh-on="change"
                  title="Catégorie d'affichage dans la boutique">
            <option value="">— Catégorie —</option>${catOptions}
          </select>
          <select class="input-field sh-modal-select si-tpl-select" id="si-template"
                  data-sh-action="setItemTemplate" data-sh-on="change"
                  title="Type de boutique (détermine les champs disponibles)">
            ${tplOptions}
          </select>
          <span class="si-name-chip" id="si-name-chip"></span>
        </div>
      </div>
    </div>`;

  openModal(item ? `✏️ ${item.nom||'Article'}` : '🛒 Nouvel article', `
    <div class="si-modal">
      ${headerHtml}
      <div class="si-body" id="si-sections-dynamic">${_siBuildTabs(tpl, item, tplKey)}</div>
      <footer class="si-footer">
        <button class="btn btn-outline" data-sh-action="closeModal">Annuler</button>
        <button class="btn btn-gold" data-sh-action="saveItem" data-id="${itemId||''}">
          ${item ? '💾 Enregistrer' : '➕ Ajouter'}
        </button>
      </footer>
    </div>`);

  setTimeout(() => {
    document.getElementById('si-nom')?.focus();
    _bindPrixListener();
    _initAutocompletes();
    _siRefreshChip();
    _siBindShortcuts();
  }, 60);

  _shopEnsureDamageTypes().then(() => {
    const host = document.getElementById('si-actions-host');
    if (host) host.innerHTML = _shopRenderActionsSection(_shopCollectActions().length ? _shopCollectActions() : (item?.actions || []));
    // Re-rend la section « Résistances accordées » maintenant que les types sont chargés.
    const dp = document.querySelector('.sh-dmgprof');
    if (dp) dp.outerHTML = _shopRenderDamageProfileSection(item);
  });
}

/** Alt+1..5 pour switcher d'onglet + rafraîchir la chip de prévisualisation. */
function _siBindShortcuts() {
  const modal = document.querySelector('.si-modal');
  if (!modal || modal._siBound) return;
  modal._siBound = true;

  // Raccourcis clavier Alt+1..9 → onglet
  document.addEventListener('keydown', (e) => {
    if (!document.querySelector('.si-modal')) return;
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const n = parseInt(e.key);
    if (!Number.isFinite(n) || n < 1 || n > 9) return;
    const btns = document.querySelectorAll('.si-tab');
    if (btns[n-1]) { e.preventDefault(); btns[n-1].click(); }
  });

  // Délégation : tout clic sur une étoile de rareté → refresh de la chip
  modal.addEventListener('click', (e) => {
    if (e.target.closest('.sh-rarete-star-btn')) {
      setTimeout(_siRefreshChip, 0); // après que pickRarete ait mis à jour le hidden
    }
  });
}

const _pendingAutocompletes = [];

function _initAutocompletes() {
  _pendingAutocompletes.splice(0).forEach(({ id, options }) => initAutocomplete(id, options));
}

function _buildFieldsHtml(tpl,item) {
  if(!tpl?.fields) return '';
  _pendingAutocompletes.length = 0;
  let html=`<div class="sh-fields-grid">`;
  tpl.fields.forEach(f=>{
    let val = getShopItemEditableText(item, f.id);
    if(f.id==='prix'){
      const pv=Math.round((parseFloat(val)||0)*PRIX_VENTE_RATIO);
      html+=`<div class="form-group"><label>${f.label}</label>
        <div class="sh-prix-wrap">
          <input type="number" class="input-field" id="si-${f.id}" value="${val}" min="0" data-sh-action="prixInput" data-sh-on="input">
          <span class="sh-prix-vente-display" id="si-prix-vente" title="Prix de rachat — 60% du prix d'achat">🔄<strong id="si-pv-val">${pv}</strong></span>
        </div></div>`;
    } else if(f.type==='rarete'){
      html+=`<div class="form-group"><label>${f.label}</label>${buildRaretePicker('si', val)}</div>`;
    } else if(f.type==='dispo'){
      const isInfini=val!==undefined&&val!==''&&parseInt(val)<0;
      const dispoVal=isInfini?'':(val===''?'':parseInt(val)||'');
      html+=`<div class="form-group"><label>${f.label}</label>
        <div class="sh-dispo-wrap">
          <input type="number" class="input-field" id="si-dispo" value="${dispoVal}" min="0"
            placeholder="${isInfini?'∞':'3'}" ${isInfini?'disabled':''}>
          <input type="checkbox" id="si-dispo-infini" class="sh-dispo-infini-cb" ${isInfini?'checked':''}
            data-sh-action="dispoInfini" data-sh-on="change" hidden>
          <button type="button" class="sh-dispo-infini-btn ${isInfini?'is-on':''}"
            id="si-dispo-infini-btn" title="Activer le stock illimité"
            data-sh-action="dispoInfiniBtn">
            <span class="sh-dispo-infini-ico">∞</span>
            <span class="sh-dispo-infini-txt">Illimité</span>
          </button>
        </div></div>`;
    } else if(f.type==='select'){
      // Maniement : les anciennes armes le déduisent du libellé « 2M ».
      if (f.id === 'mains' && !val && item) val = weaponHandsLabel(item);
      const configured = f.id === 'slotArmure' ? getEquipmentItemOptions('armor')
        : f.id === 'typeArmure' ? getArmorTypeOptions()
        : f.id === 'slotBijou' ? getEquipmentItemOptions('accessory') : (f.options || []);
      const options = [...new Set([...configured, ...(val ? [val] : [])])];
      html+=`<div class="form-group"><label>${f.label}</label>
        <select class="input-field sh-modal-select" id="si-${f.id}">
          <option value="">— Choisir —</option>
          ${options.map(o=>`<option value="${_esc(o)}" ${val===o?'selected':''}>${_esc(o)}</option>`).join('')}
        </select></div>`;
    } else if(f.type==='format_select'){
      // Type d'arme : une ancienne arme (format « Arme 1M CaC Phy. » supprimé)
      // est présélectionnée sur son type saisi ; une valeur inconnue est conservée.
      const current = resolveWeaponFamily(_weaponFormats, item || {})?.label || val;
      const known = _weaponFormats.some(o => o.label === current);
      html+=`<div class="form-group"><label>${f.label}</label>
        <select class="input-field sh-modal-select" id="si-${f.id}" data-sh-action="weaponTypeDefaults" data-sh-on="change">
          <option value="">— Choisir —</option>
          ${!known && current ? `<option value="${_esc(current)}" selected>${_esc(current)} (ancien)</option>` : ''}
          ${_weaponFormats.map(o=>`<option value="${_esc(o.label)}" ${current===o.label?'selected':''}>${_esc(o.label)}</option>`).join('')}
        </select></div>`;
    } else if(f.type==='damage_with_stat'){
      const statsArr = _getDegatsStats(item||{});
      const statsJson = JSON.stringify(statsArr).replace(/"/g,'&quot;');
      html+=`<div class="form-group sh-field-full"><label>${f.label}</label>
        <div class="sh-dmg-row">
          <input class="input-field sh-dmg-dice" id="si-degats" value="${item?.degats||''}" placeholder="${f.placeholder||'1d6, 2d4...'}">
          <input type="hidden" id="si-degats-stats-data" value="${statsJson}">
          <div id="si-degats-stats-list" class="sh-dmg-chips">
            ${statsArr.map((key,i)=>_renderDegatsStatChip(key,i)).join('')}
          </div>
          <button type="button" class="sh-dmg-add" data-sh-action="degatsAdd">+ Mod</button>
        </div>
        <div style="font-size:0.72rem;color:var(--text-dim);margin-top:0.4rem">Ex : 2d4 + For + Sa pour les Bandes du moine.</div>
      </div>`;
    } else if(f.type==='stat_select'){
      const selected = _normalizeStatKey(item?.[f.id] || item?.toucher || item?.statAttaque || '');
      html+=`<div class="form-group"><label>${f.label}</label>
        <select class="input-field sh-modal-select" id="si-${f.id}">
          <option value="">— Choisir —</option>
          ${ITEM_STATS.map(stat=>`<option value="${stat.key}" ${selected===stat.key?'selected':''}>${stat.label}</option>`).join('')}
        </select></div>`;
    } else if(f.type==='stat_bonus_grid'){
      const parsed = _parseLegacyStats(item||{});
      html+=`<div class="form-group sh-field-full"><label>${f.label}</label>
        <div class="sh-bonus-row">
          ${ITEM_STATS.map(stat=>`<label class="sh-bonus-cell">
            <span>${stat.short}</span>
            <input type="number" id="si-${stat.store}" value="${parsed[stat.store]||''}" placeholder="0">
          </label>`).join('')}
        </div>
      </div>`;
    } else if(f.type==='derived_bonus_grid'){
      // Bonus dérivés : +X PV max, +X PM max, +X Vitesse, +X Initiative
      const D = [
        { id:'pvMaxBonus',     short:'PV',   label:'PV max',     icon:'❤️' },
        { id:'pmMaxBonus',     short:'PM',   label:'PM max',     icon:'✨' },
        { id:'vitesseBonus',   short:'Vit',  label:'Vitesse',    icon:'👢' },
        { id:'initiativeBonus',short:'Init', label:'Initiative', icon:'⚡' },
        { id:'caBonus',        short:'CA',   label:'Classe d\'Armure', icon:'🛡️' },
      ];
      html+=`<div class="form-group sh-field-full"><label>${f.label} <span style="font-size:.7rem;color:var(--text-dim);font-weight:400">— ajoutés au calcul de base quand l'objet est équipé</span></label>
        <div class="sh-bonus-row">
          ${D.map(d=>`<label class="sh-bonus-cell" title="${d.label}">
            <span>${d.icon} ${d.short}</span>
            <input type="number" id="si-${d.id}" value="${item?.[d.id]||''}" placeholder="0">
          </label>`).join('')}
        </div>
      </div>`;
    } else if(f.type==='skill_bonus_grid'){
      // Bonus de compétences en mode "chips ajoutables" — UX compacte.
      // Le MJ ajoute uniquement les compétences pertinentes via un sélecteur.
      const sb = item?.skillBonuses || {};
      const chips = Object.entries(sb)
        .filter(([_, v]) => parseInt(v) !== 0 && v !== '')
        .map(([name, val]) => _shopRenderSkillChipHTML(name, val))
        .join('');
      html+=`<div class="form-group sh-field-full">
        <label>${f.label} <span style="font-size:.7rem;color:var(--text-dim);font-weight:400">— bonus sur les jets de compétences (Intimidation, Perception…)</span></label>
        <div id="si-skill-chips" class="sh-skill-chips" style="display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.4rem;min-height:1.5rem">
          ${chips || '<span class="sh-skill-empty" style="font-size:.75rem;color:var(--text-dim);font-style:italic">Aucun bonus — clique sur ＋ pour en ajouter</span>'}
        </div>
        <div style="display:flex;gap:.4rem;align-items:center">
          <select class="input-field" id="si-skill-picker" style="flex:1">
            <option value="">— Choisir une compétence —</option>
          </select>
          <input type="number" class="input-field" id="si-skill-val" placeholder="+1" min="-10" max="10"
            style="width:80px;text-align:center">
          <button type="button" class="btn btn-outline btn-sm" data-sh-action="skillAdd">＋</button>
        </div>
      </div>`;
      // Le HTML n'est pas encore dans le DOM (on construit la string).
      // On défère le populate au prochain tick pour que getElementById trouve le select.
      setTimeout(() => _shopPopulateSkillPicker(sb).catch(() => {}), 0);
    } else if(f.type==='textarea'){
      html+=`<div class="form-group sh-field-full"><label>${f.label}</label>
        <textarea class="input-field" id="si-${f.id}" rows="2">${_esc(val)}</textarea></div>`;
    } else if(f.type==='trait_list'){
      const traitsArr = Array.isArray(item?.traits) ? item.traits : (item?.trait ? [item.trait] : []);
      const traitsJson = JSON.stringify(traitsArr).replace(/"/g,'&quot;');
      html+=`<div class="form-group sh-field-full">
        <label>${f.label}</label>
        <input type="hidden" id="si-traits-data" value="${traitsJson}">
        <div id="si-traits-list" style="display:flex;flex-direction:column;gap:.35rem;margin-bottom:.4rem">
          ${traitsArr.map((t,i)=>`
          <div style="display:flex;gap:.4rem;align-items:center" data-trait-idx="${i}">
            <input class="input-field" style="flex:1;font-size:.83rem" value="${t.replace(/"/g,'&quot;')}"
              data-sh-action="traitUpdate" data-sh-on="input" data-idx="${i}" placeholder="Trait...">
            <button type="button" data-sh-action="traitRemove" data-idx="${i}"
              style="background:none;border:none;cursor:pointer;color:#ff6b6b;font-size:.9rem;padding:2px 6px">✕</button>
          </div>`).join('')}
        </div>
        <button type="button" data-sh-action="traitAdd"
          style="font-size:.75rem;padding:4px 12px;border-radius:8px;cursor:pointer;
          border:1px dashed var(--border);background:transparent;color:var(--text-dim);
          transition:all .12s;width:100%"
          data-hov-border="var(--gold)" data-hov-color="var(--gold)">
          + Ajouter un trait
        </button>
      </div>`;
    } else if(f.type==='dispo'){
      // Quantité en stock + case « Illimité » (dispo = -1). Restauré : le
      // renderer avait sauté lors du refactor, cassant l'option illimité.
      const cur = item?.dispo;
      const isInf = cur === undefined || cur === null || cur === '' || parseInt(cur) < 0;
      const num = isInf ? '' : (parseInt(cur) || 0);
      html+=`<div class="form-group"><label>${f.label}</label>
        <div style="display:flex;align-items:center;gap:.6rem">
          <input type="number" class="input-field" id="si-dispo" min="0" value="${num}" placeholder="Quantité en stock" style="flex:1" ${isInf?'disabled':''}>
          <label style="display:flex;align-items:center;gap:.35rem;white-space:nowrap;cursor:pointer;font-size:.85rem">
            <input type="checkbox" id="si-dispo-infini" ${isInf?'checked':''}
              data-toggle-disable="si-dispo">
            ♾️ Illimité
          </label>
        </div>
      </div>`;
    } else {
      if (f.type === 'autocomplete') {
        const opts = [...new Set(_items.map(i => i?.[f.id]).filter(Boolean))];
        const inputId = `si-${f.id}`;
        _pendingAutocompletes.push({ id: inputId, options: opts });
        html+=`<div class="form-group" style="position:relative"><label>${f.label}</label>
          ${autocompleteHTML({ id: inputId, value: val, placeholder: f.placeholder || '' })}
        </div>`;
      } else {
        const inputType = f.type === 'number' ? 'number' : 'text';
        html+=`<div class="form-group"><label>${f.label}</label>
          <input type="${inputType}" class="input-field" id="si-${f.id}" value="${val}" placeholder="${f.placeholder||''}"></div>`;
      }
    }
  });
  html+=`</div>`;
  return html;
}

function _bindPrixListener() {
  const input=document.getElementById('si-prix');
  if(input) input.addEventListener('input',()=>updatePrixVente(input.value));
}

// ── Gestion dynamique des traits (trait_list) ─────────────────────────────────
function _shopTraitsGet() {
  const hidden = document.getElementById('si-traits-data');
  try { return JSON.parse(hidden?.value || '[]'); } catch { return []; }
}
function _shopTraitsSet(arr) {
  const hidden = document.getElementById('si-traits-data');
  if (hidden) hidden.value = JSON.stringify(arr);
}
function _shopTraitsRender(arr) {
  const list = document.getElementById('si-traits-list');
  if (!list) return;
  list.innerHTML = arr.map((t,i)=>`
    <div style="display:flex;gap:.4rem;align-items:center" data-trait-idx="${i}">
      <input class="input-field" style="flex:1;font-size:.83rem" value="${t.replace(/"/g,'&quot;')}"
        data-sh-action="traitUpdate" data-sh-on="input" data-idx="${i}" placeholder="Trait...">
      <button type="button" data-sh-action="traitRemove" data-idx="${i}"
        style="background:none;border:none;cursor:pointer;color:#ff6b6b;font-size:.9rem;padding:2px 6px">✕</button>
    </div>`).join('');
}
function addShopTrait() {
  const arr = _shopTraitsGet(); arr.push(''); _shopTraitsSet(arr); _shopTraitsRender(arr);
  const list = document.getElementById('si-traits-list');
  const inputs = list?.querySelectorAll('input');
  inputs?.[inputs.length-1]?.focus();
}
function updateShopTrait(i, val) {
  const arr = _shopTraitsGet(); arr[i] = val; _shopTraitsSet(arr);
}
function removeShopTrait(i) {
  const arr = _shopTraitsGet(); arr.splice(i,1); _shopTraitsSet(arr); _shopTraitsRender(arr);
}

// ── Gestion dynamique des modificateurs de dégâts ─────────────────────────────
function _renderDegatsStatChip(key, i) {
  return `<span class="sh-dmg-sep">+</span><span class="sh-dmg-chip" data-dstat-idx="${i}">
    <select data-sh-action="degatsUpdate" data-sh-on="change" data-idx="${i}">
      ${ITEM_STATS.map(s=>`<option value="${s.key}" ${key===s.key?'selected':''}>${s.short}</option>`).join('')}
    </select>
    <button type="button" title="Retirer ce modificateur" data-sh-action="degatsRemove" data-idx="${i}">✕</button>
  </span>`;
}
function _shopDegatsStatsGet() {
  const hidden = document.getElementById('si-degats-stats-data');
  try { return JSON.parse(hidden?.value || '[]'); } catch { return []; }
}
function _shopDegatsStatsSet(arr) {
  const hidden = document.getElementById('si-degats-stats-data');
  if (hidden) hidden.value = JSON.stringify(arr);
}
function _shopDegatsStatsRender(arr) {
  const list = document.getElementById('si-degats-stats-list');
  if (!list) return;
  list.innerHTML = arr.map((key,i)=>_renderDegatsStatChip(key,i)).join('');
}
function addShopDegatsStat() {
  const arr = _shopDegatsStatsGet();
  arr.push(ITEM_STATS[0].key);
  _shopDegatsStatsSet(arr);
  _shopDegatsStatsRender(arr);
}
function updateShopDegatsStat(i, val) {
  const arr = _shopDegatsStatsGet(); arr[i] = val; _shopDegatsStatsSet(arr);
}
function removeShopDegatsStat(i) {
  const arr = _shopDegatsStatsGet(); arr.splice(i,1); _shopDegatsStatsSet(arr); _shopDegatsStatsRender(arr);
}

// ── Pré-remplissage par type d'arme ─────────────────────────────────────────
// Applique les défauts du type choisi aux champs VIDES, ou encore égaux à ce
// qu'un type précédent avait pré-rempli (data-type-default) : une valeur saisie
// à la main n'est jamais écrasée.
function applyWeaponTypeDefaults(select) {
  const family = _weaponFormats.find(f => f.label === select?.value);
  if (!family || !hasWeaponDefaults(family.defaults)) return;
  const d = normalizeWeaponDefaults(family.defaults);
  const filled = [];
  const fill = (el, value, label) => {
    if (!el || value === '' || value == null) return;
    const current = String(el.value ?? '');
    const untouched = current === '' || (el.dataset.typeDefault != null && el.dataset.typeDefault === current)
      || (el.type === 'number' && (parseInt(current, 10) || 0) === 0);
    if (!untouched) return;
    el.value = String(value);
    el.dataset.typeDefault = String(value);
    filled.push(label);
  };
  fill(document.getElementById('si-degats'), d.degats, 'dégâts');
  fill(document.getElementById('si-toucherStat'), d.toucherStat, 'toucher');
  fill(document.getElementById('si-portee'), d.portee, 'portée');
  fill(document.getElementById('si-mains'), d.mains, 'maniement');
  if (d.caBonus) fill(document.getElementById('si-caBonus'), d.caBonus, 'CA');
  const hidden = document.getElementById('si-degats-stats-data');
  if (hidden && d.degatsStats.length) {
    const current = hidden.value || '[]';
    if (current === '[]' || current === hidden.dataset.typeDefault) {
      _shopDegatsStatsSet(d.degatsStats);
      _shopDegatsStatsRender(d.degatsStats);
      hidden.dataset.typeDefault = hidden.value;
      filled.push('stats de dégâts');
    }
  }
  if (filled.length) showNotif(`📋 ${family.label} : ${filled.join(', ')} pré-rempli${filled.length > 1 ? 's' : ''}`, 'info');
}

function toggleDispoInfini(cb){
  const input=document.getElementById('si-dispo');
  const btn=document.getElementById('si-dispo-infini-btn');
  if(!input) return;
  if(cb.checked){
    input.value=''; input.disabled=true; input.placeholder='∞';
    btn?.classList.add('is-on');
  } else {
    input.disabled=false; input.placeholder='3'; input.value='5';
    btn?.classList.remove('is-on');
    input.focus();
  }
}
function toggleDispoInfiniBtn(){
  const cb=document.getElementById('si-dispo-infini'); if(!cb) return;
  cb.checked=!cb.checked;
  toggleDispoInfini(cb);
}
function updatePrixVente(val){ const pv=Math.round((parseFloat(val)||0)*PRIX_VENTE_RATIO); const el=document.getElementById('si-pv-val'); if(el) el.textContent=pv; }

function refreshItemFields(catId) {
  // La catégorie ne dicte plus le template — c'est le select #si-template.
  // Cette fonction reste pour rétrocompat mais redirige vers refreshTemplateFields.
  const tplKey = document.getElementById('si-template')?.value
              || _cats.find(c=>c.id===catId)?.template
              || 'classique';
  refreshTemplateFields(tplKey);
}

/** Re-render les champs de la modale article selon le type sélectionné. */
function refreshTemplateFields(tplKey) {
  const tpl  = TEMPLATES[tplKey] || TEMPLATES.classique;
  const host = document.getElementById('si-sections-dynamic');
  if (!host) return;
  // Conserve l'onglet actif si possible (sinon retombe sur "essentiel")
  const cur = document.querySelector('.si-tab.is-active')?.dataset.tab || 'essentiel';
  host.innerHTML = _siBuildTabs(tpl, null, tplKey, cur);
  _bindPrixListener(); _initAutocompletes(); _siRefreshChip();
}

// ── Upload image ──────────────────────────────────────────────────────────────
function previewUpload(fileInputId,previewId,hiddenId) {
  const file=document.getElementById(fileInputId)?.files?.[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      const MAX=400; let w=img.width,h=img.height;
      if(w>MAX||h>MAX){ if(w>h){h=Math.round(h*MAX/w);w=MAX;}else{w=Math.round(w*MAX/h);h=MAX;} }
      const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
      canvas.getContext('2d').drawImage(img,0,0,w,h);
      const b64=canvas.toDataURL('image/jpeg',0.72);
      const hidden=document.getElementById(hiddenId); if(hidden) hidden.value=b64;
      const preview=document.getElementById(previewId);
      if (preview) {
        // Si le conteneur est la vignette ronde du nouveau modal, remplit-la full.
        if (preview.classList.contains('si-img-thumb')) {
          preview.innerHTML = `<img src="${b64}" alt="">`;
        } else {
          preview.innerHTML = `<img src="${b64}" alt="" style="max-height:80px;border-radius:8px;margin-top:0.4rem;display:block">`;
        }
      }
      const kb=Math.round(b64.length*3/4/1024);
      if(kb>700) showNotif(`⚠️ Image encore lourde (${kb}KB).`,'error');
      else showNotif(`✅ Image prête (${kb}KB)`,'success');
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}

async function saveShopItem(itemId) {
  try {
    const item = itemId ? _items.find(i=>i.id===itemId) : null;
    const catId=document.getElementById('si-cat')?.value||'';
    const cat=_cats.find(c=>c.id===catId);
    // Le template vient désormais du select dédié de la modale ; fallback
    // sur le template de la catégorie (rétrocompat avec les items créés avant
    // l'unification de la modale).
    const tplKey = document.getElementById('si-template')?.value
                || item?.template
                || cat?.template
                || 'classique';
    const tpl=TEMPLATES[tplKey]||TEMPLATES.classique;
    const nom=document.getElementById('si-nom')?.value.trim();
    if(!nom){showNotif('Nom requis.','error');return;}

    const sameCategory = item && item.categorieId === catId;
    const categoryItems = _items.filter(entry => entry.id !== itemId && entry.categorieId === catId);
    const existingOrder = manualOrderValue(item);
    const data={
      nom,
      categorieId:catId,
      template:tplKey,
      image:document.getElementById('si-img-b64')?.value||'',
      // Une modification conserve sa place. Un nouvel article, ou un article
      // déplacé vers une autre catégorie, est ajouté proprement à la fin.
      ordre: sameCategory && existingOrder !== null
        ? existingOrder
        : nextManualOrder(categoryItems),
    };

    // Si l'onglet Texte n'a jamais été ouvert, Quill n'est pas chargé pour rien
    // et le contenu catalogue existant est conservé tel quel.
    const readableEditor = document.querySelector('[data-rtq-id="si-readable-content"]');
    const readableTitle = document.getElementById('si-readable-title')?.value.trim() || '';
    const readableContent = readableEditor?.classList.contains('ql-container')
      ? getQuillHtml('si-readable-content')
      : String(_shopReadableDraft?.itemId === (itemId || '') ? _shopReadableDraft.html : item?.readableContent || '');
    const sanitizedReadableContent = sanitizeRichTextHtml(readableContent);
    const readablePlainText = sanitizedReadableContent.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
    const hasReadableContent = !!readablePlainText || /<(img|video|audio|iframe)\b/i.test(sanitizedReadableContent);
    data.readableTitle = readableTitle;
    data.hasReadableContent = hasReadableContent;
    // Migration des anciens articles : le texte long quitte le document boutique.
    if (itemId && item?.readableContent != null) data.readableContent = deleteField();

    tpl.fields.forEach(f=>{
      if(f.type==='dispo'){
        const infini=document.getElementById('si-dispo-infini')?.checked;
        data[f.id]=infini?-1:(parseInt(document.getElementById('si-dispo')?.value)||0);
      } else if (f.type === 'damage_with_stat') {
        data.degats = document.getElementById('si-degats')?.value.trim() || '';
        let statsArr = [];
        try { statsArr = JSON.parse(document.getElementById('si-degats-stats-data')?.value || '[]'); } catch {}
        statsArr = statsArr.map(_normalizeStatKey).filter(Boolean);
        data.degatsStats = statsArr;
        data.degatsStat = statsArr[0] || '';
      } else if (f.type === 'stat_select') {
        data[f.id] = document.getElementById(`si-${f.id}`)?.value || '';
      } else if (f.type === 'stat_bonus_grid') {
        ITEM_STATS.forEach(stat => {
          data[stat.store] = parseInt(document.getElementById(`si-${stat.store}`)?.value) || 0;
        });
      } else if (f.type === 'derived_bonus_grid') {
        // Bonus dérivés : PV/PM max, Vitesse, Initiative, CA
        ['pvMaxBonus','pmMaxBonus','vitesseBonus','initiativeBonus','caBonus'].forEach(k => {
          const v = parseInt(document.getElementById(`si-${k}`)?.value);
          data[k] = Number.isFinite(v) ? v : 0;
        });
      } else if (f.type === 'skill_bonus_grid') {
        // Bonus de compétences : lecture depuis les chips ajoutées
        const out = {};
        document.querySelectorAll('#si-skill-chips .sh-skill-chip').forEach(chip => {
          const name = chip.dataset.skill;
          const v = parseInt(chip.dataset.val);
          if (name && Number.isFinite(v) && v !== 0) out[name] = v;
        });
        data.skillBonuses = out;
      } else if (f.type === 'trait_list') {
        const inputs = document.querySelectorAll('#si-traits-list input');
        const arr = [...inputs].map(inp=>inp.value.trim()).filter(Boolean);
        data.traits = arr;
      } else if (f.type === 'textarea') {
        const el = document.getElementById(`si-${f.id}`);
        if (el) data[f.id] = el.value;
      } else {
        const el=document.getElementById(`si-${f.id}`);
        if(el) data[f.id]=f.type==='number'?(parseFloat(el.value)||0):el.value.trim();
      }
    });

    // Migration douce des anciens articles : la boutique a historiquement
    // alterné entre `effet` et `description`. Les deux restent synchronisés
    // pour qu'un prochain changement de template ne vide plus le champ.
    if (tplKey === 'classique') data.description = data.effet || '';
    if (tplKey === 'libre') data.effet = data.description || '';

    if (tplKey === 'arme') {
      // Le type d'arme (ex-format) alimente aussi sousType : maîtrises, filtres, recettes.
      const family = _weaponFormats.find(f => f.label === data.format);
      if (family) { data.formatId = family.id; data.sousType = family.label; }
      else if (data.format) data.sousType = data.format;
      data.toucher = _legacyToucherTextFromData(data);
      data.stats = _legacyStatsTextFromData(data);
      data.statAttaque = data.degatsStat || data.toucherStat || '';
    } else if (tplKey === 'armure' || tplKey === 'bijou') {
      data.stats = _legacyStatsTextFromData(data);
    }

    data.prixVente=Math.round((parseFloat(data.prix)||0)*PRIX_VENTE_RATIO);

    // Actions/Bonus/Réactions définies sur l'item — propagées à l'inventaire
    data.actions = _shopCollectActions();
    // Profil de dégâts porté (résistances/immunités/…) — uniquement si la section existe (équipables)
    const dmgProfile = _shopCollectDamageProfile();
    if (dmgProfile) data.damageProfile = dmgProfile;
    // Flag consommable (item-level) : retire 1 exemplaire à chaque usage d'action
    data.consommable = !!document.getElementById('si-consommable')?.checked;
    // Masqué aux joueurs (MJ) — confort d'affichage, cf. _visibleItems.
    data.masque = !!document.getElementById('si-masque')?.checked;

    // Nouveauté : toggle → fenêtre de 2 semaines (newUntil). On ne ré-arme la
    // fenêtre que si elle n'est pas déjà active (éditer un item en cours de
    // période ne remet pas le compteur à zéro). Décoché → 0 (désactivé).
    {
      const checked = document.getElementById('si-new')?.checked;
      const existing = _itemNewUntilMs(item);
      data.newUntil = checked
        ? (existing > Date.now() ? existing : Date.now() + 14 * 24 * 3600 * 1000)
        : 0;
    }

    const hasRecipe = document.getElementById('si-has-recipe')?.checked;
    if (hasRecipe) {
      if (item?.recipeMeta) {
        const recipeMeta = { ...item.recipeMeta };
        delete recipeMeta.hidden;
        data.recipeMeta = recipeMeta;
      }
    } else {
      data.recipeMeta = { hidden: true };
    }

    let savedItemId = itemId;
    if(itemId) await updateInCol('shop',itemId,data);
    else savedItemId = await addToCol('shop',data);

    if (hasReadableContent) {
      await saveDoc('shopContent', savedItemId, {
        title: readableTitle || nom,
        html: sanitizedReadableContent,
        updatedAt: new Date().toISOString(),
      });
    } else if (item?.hasReadableContent || item?.readableContent) {
      await deleteFromCol('shopContent', savedItemId);
    }

    if (itemId) await _syncCharactersAfterItemUpdate(itemId, data);

    markQuillSaved('si-readable-content');
    closeModalDirect(); showNotif('Article enregistré !','success'); renderShop();
  } catch (e) { notifySaveError(e); }
}

/**
 * Après modification d'un article boutique :
 * - Met à jour les copies dans les inventaires des personnages (source:'boutique', itemId = itemId)
 * - Met à jour les slots d'équipement qui référencent cet itemId
 */
async function _syncCharactersAfterItemUpdate(itemId, newData) {
  const chars = STATE.characters || [];
  if (!chars.length) return;

  // Tous les champs présents dans `newData` sont propagés SAUF ceux qui n'ont
  // pas de sens dans un inventaire (méta boutique). Ce blocklist est aligné avec
  // celui de `shopItemToInvEntry` (assets/js/shared/inventory-utils.js) pour
  // garantir la cohérence des 4 paths (achat / butin take / butin add / sync).
  const SYNC_BLOCKLIST = new Set([
    'id', 'image', 'dispo', 'recipeMeta', 'prix', 'categorieId', 'newUntil', 'isNew',
    // Les textes longs restent dans le catalogue et sont lus à la demande par
    // l'inventaire : ne pas les dupliquer dans chaque document personnage.
    'readableContent', 'readableTitle', 'hasReadableContent',
  ]);
  const SYNC_FIELDS = Object.keys(newData).filter(k => !SYNC_BLOCKLIST.has(k));

  const updates = [];

  chars.forEach(c => {
    let changed = false;
    const inv   = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
    const equip = { ...(c.equipement||{}) };

    inv.forEach((item, i) => {
      if (item.source === 'boutique' && item.itemId === itemId) {
        SYNC_FIELDS.forEach(f => {
          if (newData[f] !== undefined) inv[i] = { ...inv[i], [f]: newData[f] };
        });
        if (newData.prix !== undefined) inv[i].prixAchat = parseFloat(newData.prix)||0;
        changed = true;
      }
    });

    Object.entries(equip).forEach(([slot, equipped]) => {
      if (equipped?.itemId === itemId) {
        const syncEquip = {};
        SYNC_FIELDS.forEach(f => { if (newData[f] !== undefined) syncEquip[f] = newData[f]; });
        if (newData.nom !== undefined) syncEquip.nom = newData.nom;
        equip[slot] = { ...equipped, ...syncEquip };
        changed = true;
      } else if (equipped?.sourceInvIndex !== undefined) {
        const invItem = inv[equipped.sourceInvIndex];
        if (invItem?.itemId === itemId) {
          const syncEquip = {};
          SYNC_FIELDS.forEach(f => { if (newData[f] !== undefined) syncEquip[f] = newData[f]; });
          equip[slot] = { ...equipped, ...syncEquip };
          changed = true;
        }
      }
    });

    if (changed) {
      // Recalcule statsBonus en fonction du nouvel équipement —
      // crucial quand le MJ change les stats d'un objet (ex: +Int → +Sa)
      // pour que les bonus du perso restent en phase avec l'objet équipé.
      const newStatsBonus = computeEquipStatsBonus(equip);
      c.inventaire = inv;
      c.equipement = equip;
      c.statsBonus = newStatsBonus;
      updates.push(updateInCol('characters', c.id, {
        inventaire: inv,
        equipement: equip,
        statsBonus: newStatsBonus,
      }));
    }
  });

  if (updates.length > 0) {
    await Promise.all(updates);
    showNotif(`🔄 ${updates.length} personnage${updates.length>1?'s':''} mis à jour.`, 'success');
  }
}

async function deleteShopItem(itemId) {
  try {
    const item = _items.find(entry => entry.id === itemId);
    if (!item) return;
    const deleted = await confirmDelete('shop', itemId, 'Supprimer cet article ?', {
      snapshot: item,
      title: 'Confirmation de suppression',
      successMessage: 'Article supprimé.',
      onRestore: () => renderShop(),
    });
    if (deleted) renderShop();
  } catch (e) { notifySaveError(e); }
}

// ══════════════════════════════════════════════════════════════════════════════
// ATELIER D'ESSAYAGE — version simplifiée
// Modale plein écran à 3 colonnes :
//   • Doll : silhouette du perso avec les slots configurés pour l'aventure.
//   • Stats : 6 caracs + 4 dérivés (CA, PV max, PM max, Vitesse) avec
//     cur → next + delta coloré live.
//   • Items : liste des articles compatibles avec le slot actif, clic = toggle
//     l'essai. Reset bouton pour vider tous les essais.
// État local (réinitialisé à chaque ouverture) :
//   _atelier = { activeSlot, simulated: { slot → shopItem } }
// ══════════════════════════════════════════════════════════════════════════════
const _atelierSlots = () => getEquipmentSlots().map(slot => ({
  name: slot.id,
  label: slot.label,
  ico: slot.icon,
}));
let _atelier = { activeSlot: null, simulated: {}, itemSearch: '', sort: 'rarity' };

/** Filtre les items boutique compatibles avec un slot d'équipement donné. */
function _atelierItemsForSlot(slotName) {
  if (!slotName) return [];
  const slotMeta = getEquipmentSlot(slotName);
  if (!slotMeta) return [];
  return _visibleItems().filter(it => {
    if (!it.nom) return false;
    return equipmentSlotAcceptsItem(slotMeta, it);
  });
}

/** Construit le perso simulé avec tous les essais en cours. */
function _atelierBuildSimChar() {
  const c = _getActiveShopChar();
  if (!c) return null;
  return _simulateCharWithBuild(c, _atelier.simulated);
}

/** Rendu de la silhouette paper-doll */
function _renderAtelierDoll() {
  const c = _getActiveShopChar();
  if (!c) return '';
  const eq = c.equipement || {};
  const av = _shopCharAvatarColor(c);
  const init = (c.nom || '?')[0].toUpperCase();

  const slotsHtml = _atelierSlots().map(s => {
    const cur = eq[s.name];
    const sim = _atelier.simulated[s.name];
    const filled = !!cur?.nom;
    const simulated = !!sim;
    const active = _atelier.activeSlot === s.name;
    const itemName = simulated ? sim.nom : (cur?.nom || '');
    const classes = ['atelier-slot'];
    if (active)    classes.push('is-active');
    if (simulated) classes.push('is-simulated');
    else if (filled) classes.push('is-filled');
    return `<button class="${classes.join(' ')}" data-slot="${_esc(s.name)}"
      data-sh-action="atelierSelectSlot"
      title="${_esc(s.label)}${itemName?` — ${_esc(itemName)}`:''}">
      <span class="atelier-slot-ico">${s.ico}</span>
      <span class="atelier-slot-name">${_esc(s.label)}</span>
      ${itemName ? `<span class="atelier-slot-item">${_esc(itemName)}</span>` : ''}
      ${simulated ? `<span class="atelier-slot-clear"
        data-sh-action="atelierClearSlot" data-slot="${_esc(s.name)}"
        title="Retirer cet essai">✕</span>` : ''}
    </button>`;
  }).join('');

  return `
    <div class="atelier-char">
      <span class="atelier-char-av" style="--av-c:${av}">${characterPortraitContent(c, { fallbackText: init })}</span>
      <div class="atelier-char-body">
        <div class="atelier-char-name">${_esc(c.nom || 'Personnage')}</div>
        <div class="atelier-char-meta">Niv. ${c.niveau||1}${c.classe?' · '+_esc(c.classe):''}</div>
      </div>
      <span class="atelier-char-or" title="Solde">${calcOr(c)}<small>or</small></span>
    </div>
    <div class="atelier-doll">${slotsHtml}</div>`;
}

/** Rendu du panneau de stats (cur → next + delta) */
function _renderAtelierStats() {
  const c = _getActiveShopChar();
  if (!c) return '';
  const sim = _atelierBuildSimChar();
  if (!sim) return '';

  // ── Dérivés ──
  const derived = [
    { lbl:"Classe d'armure", ico:'🛡', cur: calcCA(c),       next: calcCA(sim) },
    { lbl:'PV max',          ico:'❤', cur: calcPVMax(c),    next: calcPVMax(sim) },
    { lbl:'PM max',          ico:'✦', cur: calcPMMax(c),    next: calcPMMax(sim) },
    { lbl:'Vitesse',         ico:'🏃', cur: calcVitesse(c), next: calcVitesse(sim) },
  ];
  const derivedHtml = derived.map(d => {
    const delta = d.next - d.cur;
    const cls = delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : '';
    return `<div class="atelier-derived ${cls}">
      <span class="atelier-derived-ico">${d.ico}</span>
      <div class="atelier-derived-body">
        <span class="atelier-derived-lbl">${d.lbl}</span>
        <div class="atelier-derived-row">
          <span class="atelier-derived-val">${d.cur}</span>
          ${delta !== 0 ? `<span class="atelier-derived-arr">→</span><span class="atelier-derived-new">${d.next}</span>` : ''}
        </div>
      </div>
      ${delta !== 0 ? `<span class="atelier-derived-delta">${delta>0?'+':''}${delta}</span>` : ''}
    </div>`;
  }).join('');

  // ── 6 caracs ──
  const statsList = ITEM_STAT_META.map(m => {
    const cur  = (c?.stats?.[m.full]   || 0) + (c?.statsBonus?.[m.full]   || 0);
    const next = (sim?.stats?.[m.full] || 0) + (sim?.statsBonus?.[m.full] || 0);
    const delta = next - cur;
    const cls = delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : '';
    const visual = _statVisual(m.full);
    return `<div class="atelier-stat-row ${cls}">
      <span class="atelier-stat-key" style="--st-c:${visual.color};--st-bg:${visual.color}1a;--st-bd:${visual.color}55">${m.short}</span>
      <span class="atelier-stat-name">${m.label || m.full}</span>
      <span class="atelier-stat-cur">${cur}</span>
      ${delta !== 0 ? `<span class="atelier-stat-arr">→</span><span class="atelier-stat-new">${next}</span><span class="atelier-stat-delta">${delta>0?'+':''}${delta}</span>` : `<span class="atelier-stat-eq">=</span>`}
    </div>`;
  }).join('');

  // ── Build summary ──
  const tried = Object.values(_atelier.simulated).filter(Boolean);
  const cost = tried.reduce((s, it) => s + (parseFloat(it?.prix) || 0), 0);
  const solde = calcOr(c);
  const finance = cost <= solde;
  // Détecte les essais épuisés (bloque "Tout acheter")
  const epuiseList = tried.filter(it => {
    const d = (it.dispo !== undefined && it.dispo !== '' && it.dispo !== null) ? parseInt(it.dispo) : null;
    return d === 0;
  });
  const hasEpuise = epuiseList.length > 0;
  const canBuyAll = tried.length > 0 && finance && !hasEpuise;

  return `
    <div class="atelier-stats-section">
      <div class="atelier-stats-title">Dérivés</div>
      <div class="atelier-derived-grid">${derivedHtml}</div>
    </div>
    <div class="atelier-stats-section">
      <div class="atelier-stats-title">Caractéristiques</div>
      <div class="atelier-stats-list">${statsList}</div>
    </div>
    <div class="atelier-build-summary">
      <div class="atelier-build-head">
        <span class="atelier-build-lbl">Build en cours</span>
        <span class="atelier-build-cost ${finance?'':'is-poor'}">${cost} or</span>
      </div>
      <div class="atelier-build-meta">
        ${tried.length === 0
          ? 'Aucun essai. Clique sur un slot pour commencer.'
          : `${tried.length} article${tried.length>1?'s':''} essayé${tried.length>1?'s':''}${finance ? '' : ` · Il te manque ${cost-solde} or`}`}
      </div>
      ${hasEpuise ? `<div class="atelier-build-warn">
        ⚠️ <b>${epuiseList.length} article${epuiseList.length>1?'s':''} épuisé${epuiseList.length>1?'s':''}</b> dans le build —
        ${epuiseList.map(it => _esc(it.nom)).join(', ')}. Tu peux toujours comparer mais pas tout acheter d'un coup.
      </div>` : ''}
      <div class="atelier-build-actions">
        <button class="btn btn-gold btn-sm" data-sh-action="atelierBuyAll"
          ${canBuyAll ? '' : 'disabled'}
          title="${canBuyAll ? 'Acheter tous les articles essayés'
                  : hasEpuise ? 'Au moins un article du build est épuisé'
                  : !finance ? `Fonds insuffisants (manque ${cost-solde} or)`
                  : 'Aucun essai'}">
          🛒 Tout acheter
        </button>
        <button class="btn btn-arcane btn-sm" data-sh-action="atelierSaveBuild"
          ${tried.length === 0 ? 'disabled' : ''}
          title="Sauvegarder cette configuration comme build nommé">
          💾 Sauver
        </button>
        <button class="btn btn-outline btn-sm" data-sh-action="atelierReset"
          ${tried.length === 0 ? 'disabled' : ''}>↺ Reset</button>
      </div>
      ${_renderAtelierSavedBuilds(c)}
    </div>`;
}

/** Liste des builds sauvegardés du perso (charger / supprimer). */
function _renderAtelierSavedBuilds(c) {
  const builds = Array.isArray(c?.shopBuilds) ? c.shopBuilds : [];
  if (!builds.length) return '';
  return `
    <div class="atelier-builds-saved">
      <div class="atelier-builds-saved-lbl">Builds sauvegardés</div>
      <div class="atelier-builds-list">
        ${builds.map(b => `
          <div class="atelier-build-row">
            <button class="atelier-build-load" data-sh-action="atelierLoadBuild" data-id="${_esc(b.id)}"
              title="Charger ce build">
              <span class="atelier-build-load-name">${_esc(b.name || 'Sans nom')}</span>
              <span class="atelier-build-load-count">${Object.keys(b.slots || {}).length} slot${Object.keys(b.slots||{}).length>1?'s':''}</span>
            </button>
            <button class="atelier-build-del" data-sh-action="atelierDeleteBuild" data-id="${_esc(b.id)}"
              title="Supprimer ce build">✕</button>
          </div>
        `).join('')}
      </div>
    </div>`;
}

/** Barre d'onglets de slots (navigation rapide entre les types d'équipement) :
 *  clic = sélectionne directement le slot (sans repasser par la silhouette),
 *  avec le nombre d'articles compatibles et un point vert si un essai est en cours. */
function _renderAtelierSlotTabs() {
  return _atelierSlots().map(s => {
    const active = _atelier.activeSlot === s.name;
    const count  = _atelierItemsForSlot(s.name).length;
    const sim    = !!_atelier.simulated[s.name];
    return `<button class="atelier-slot-tab${active?' is-active':''}${sim?' is-simulated':''}${count?'':' is-empty'}"
      data-sh-action="atelierGoSlot" data-slot="${_esc(s.name)}"
      title="${_esc(s.label)} — ${count} article${count>1?'s':''} compatible${count>1?'s':''}">
      <span class="atelier-slot-tab-ico">${s.ico}</span>
      <span class="atelier-slot-tab-name">${_esc(s.label)}</span>
      <span class="atelier-slot-tab-count">${count}</span>
    </button>`;
  }).join('');
}

/** Chips de tri de la liste d'articles de l'atelier. */
function _renderAtelierSort() {
  const cur = _atelier.sort || 'rarity';
  const opts = [
    { k:'rarity', lbl:'✨ Rareté' },
    { k:'price',  lbl:'🪙 Prix' },
    { k:'name',   lbl:'🔤 Nom' },
    { k:'type',   lbl:'🏷️ Type' },
    { k:'dispo',  lbl:'📦 Dispo' },
    { k:'fav',    lbl:'⭐ Favoris' },
  ];
  return `<span class="atelier-items-sort-lbl">Trier :</span>` + opts.map(o =>
    `<button class="atelier-sort-chip${cur===o.k?' is-active':''}" data-sh-action="atelierSetSort" data-sort="${o.k}">${o.lbl}</button>`
  ).join('');
}

/** Rendu de la colonne droite : items compatibles avec le slot actif. */
function _renderAtelierItems() {
  const slot = _atelier.activeSlot;
  if (!slot) {
    return `<div class="atelier-items-empty">
      <div class="atelier-items-empty-ico">👈</div>
      <div><b>Choisis un slot</b></div>
      <div class="atelier-items-empty-hint">Clique un emplacement sur la silhouette pour voir les articles compatibles.</div>
    </div>`;
  }
  const q = _norm(_atelier.itemSearch || '');
  let items = _atelierItemsForSlot(slot);
  if (q) items = items.filter(it => _searchIncludes(_itemSearchText(it), q));
  const sortMode = _atelier.sort || 'rarity';
  const byName = (a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr');
  const byRare = (a, b) => (_getRareteNum(b.rarete) - _getRareteNum(a.rarete)) || byName(a, b);
  // Type : tri selon les types *structurés* existants, dans leur ordre logique —
  // arme → format (ordre des _weaponFormats : Arme 1M CaC Phy., 2M CaC Phy.…),
  // armure → typeArmure configuré par le MJ, sinon slotBijou / type libre.
  // Renvoie [rang, libellé] : rang défini d'abord, puis alpha pour le reste.
  const ARMURE_ORDER = getArmorTypeOptions();
  const typeRank = (it) => {
    const family = (it.format || it.sousType) ? resolveWeaponFamily(_weaponFormats, it) : null;
    if (family)        return [_weaponFormats.indexOf(family), family.label];
    if (it.format)     return [999, it.format];
    if (it.sousType)   return [998, it.sousType]; // arme sans format défini → après les formats connus
    if (it.typeArmure) { const i = ARMURE_ORDER.indexOf(it.typeArmure); return [i < 0 ? 999 : i, it.typeArmure]; }
    return [999, it.slotArmure || it.slotBijou || it.type || ''];
  };
  const byType = (a, b) => {
    const [ra, la] = typeRank(a), [rb, lb] = typeRank(b);
    return (ra - rb) || la.localeCompare(lb, 'fr') || byRare(a, b);
  };
  // Dispo : illimité (∞) en tête, puis stock décroissant, épuisé (0) en bas
  const stockVal = (it) => {
    const d = (it.dispo !== undefined && it.dispo !== '' && it.dispo !== null) ? parseInt(it.dispo) : null;
    return (d === null || d < 0) ? Infinity : d;
  };
  items = items.sort((a, b) => {
    if (sortMode === 'fav')   { const d = (_isFav(a.id)?0:1) - (_isFav(b.id)?0:1); if (d) return d; return byRare(a, b); }
    if (sortMode === 'price') return ((parseFloat(a.prix)||0) - (parseFloat(b.prix)||0)) || byName(a, b);
    if (sortMode === 'name')  return byName(a, b);
    if (sortMode === 'type')  return byType(a, b);
    if (sortMode === 'dispo') return (stockVal(b) - stockVal(a)) || byRare(a, b);
    return byRare(a, b); // 'rarity' (défaut)
  }).slice(0, 40);

  if (!items.length) {
    return `<div class="atelier-items-empty">
      <div class="atelier-items-empty-ico">🔎</div>
      <div><b>Aucun article compatible</b></div>
      <div class="atelier-items-empty-hint">Aucun article boutique ne correspond au slot « ${_esc(getEquipmentSlot(slot)?.label || slot)} ».</div>
    </div>`;
  }

  const c = _getActiveShopChar();
  const solde = calcOr(c);

  return items.map(it => {
    const tried = _atelier.simulated[slot]?.id === it.id;
    const rareNum = _getRareteNum(it.rarete);
    const rareCol = rareNum > 0 ? _rareteColor(RARETE_NAMES[rareNum]) : 'var(--border)';
    const bonus = _getStatBonusEntries(it);
    const prix = parseFloat(it.prix) || 0;
    const poor = prix > solde;
    // Stock : dispo === 0 → épuisé ; <3 → limité ; null/-1 → illimité
    const dispo = (it.dispo !== undefined && it.dispo !== '' && it.dispo !== null)
      ? parseInt(it.dispo) : null;
    const epuise = dispo === 0;
    const limited = dispo !== null && dispo > 0 && dispo < 3;
    const stockTxt = dispo === null || dispo < 0 ? '∞'
                   : epuise ? 'Épuisé'
                   : `${dispo} dispo`;
    const stockCls = epuise ? 'is-empty' : limited ? 'is-limited' : 'is-ok';

    const classes = ['atelier-item'];
    if (tried) classes.push('is-tried');
    if (epuise) classes.push('is-epuise');

    return `<button class="${classes.join(' ')}" data-id="${it.id}"
      data-sh-action="atelierTryItem"
      style="--rare-c:${rareCol}"
      title="${epuise ? "Article épuisé — tu peux l'essayer pour comparer mais pas l'acheter" : ''}">
      <div class="atelier-item-ico">${_esc(it.image ? '' : (it.icon || '📦'))}${it.image ? `<img src="${_esc(it.image)}" alt="">` : ''}</div>
      <div class="atelier-item-body">
        <div class="atelier-item-name">${_esc(it.nom)}</div>
        <div class="atelier-item-meta">
          ${it.sousType ? `<span>${_esc(it.sousType)}</span>` : ''}
          ${it.slotArmure ? `<span>${_esc(it.slotArmure)}${it.typeArmure?' · '+_esc(it.typeArmure):''}</span>` : ''}
          ${it.slotBijou ? `<span>${_esc(it.slotBijou)}</span>` : ''}
          <span class="atelier-item-stock ${stockCls}">${stockTxt}</span>
          <span class="atelier-item-price ${poor?'is-poor':''}"${poor?` title="Hors budget — il te manque ${prix-solde} or"`:''}>${poor?'🔒 ':''}${prix} or</span>
        </div>
        ${bonus.length ? `<div class="atelier-item-bonus">
          ${bonus.slice(0,4).map(b => `<span class="sh-item-bonus-chip" style="border-color:${b.color}55;background:${b.color}18;color:${b.color}">${b.short} ${b.val>0?'+':''}${b.val}</span>`).join('')}
        </div>` : ''}
        ${(() => { const tr = _getItemTraits(it); return tr.length ? `<div class="atelier-item-traits">🔖 ${tr.slice(0,4).map(t => `<span class="atelier-item-trait">${_esc(t)}</span>`).join('')}${tr.length>4?`<span class="atelier-item-trait-more">+${tr.length-4}</span>`:''}</div>` : ''; })()}
      </div>
      <span class="atelier-item-fav ${_isFav(it.id)?'is-fav':''}" data-sh-action="toggleFav" data-id="${it.id}"
        title="${_isFav(it.id)?'Retirer des favoris':'Ajouter aux favoris'}">${_isFav(it.id)?'★':'☆'}</span>
      <span class="atelier-item-toggle">${tried ? '✓' : '+'}</span>
    </button>`;
  }).join('');
}

/** Render complet de l'atelier (silhouette + stats + items). */
function _renderAtelier() {
  const doll  = document.getElementById('atelier-doll-col');
  const stats = document.getElementById('atelier-stats-col');
  const items = document.getElementById('atelier-items-col');
  const tabs  = document.getElementById('atelier-slot-tabs');
  const slotLbl = document.getElementById('atelier-slot-name');
  const searchInput = document.getElementById('atelier-items-search');
  const focusedSearch = (document.activeElement === searchInput);
  const caret = focusedSearch ? searchInput.selectionStart : null;

  if (doll)    doll.innerHTML  = _renderAtelierDoll();
  if (stats)   stats.innerHTML = _renderAtelierStats();
  if (items)   items.innerHTML = _renderAtelierItems();
  if (tabs)    tabs.innerHTML  = _renderAtelierSlotTabs();
  const sortEl = document.getElementById('atelier-items-sort');
  if (sortEl)  sortEl.innerHTML = _renderAtelierSort();
  if (slotLbl) slotLbl.textContent = getEquipmentSlot(_atelier.activeSlot)?.label || '—';

  // Restaure focus + caret de la search (n'est pas re-rendue, mais sa value oui
  // si on perd le focus pendant un re-render distant)
  if (focusedSearch && searchInput) {
    requestAnimationFrame(() => {
      searchInput.focus();
      try { searchInput.setSelectionRange(caret, caret); } catch {}
    });
  }
}

/** Achète tous les items du build en cours et vide le build. */
async function _atelierBuyAll() {
  const c = _getActiveShopChar();
  if (!c) return;
  const entries = Object.entries(_atelier.simulated).filter(([, it]) => !!it);
  if (!entries.length) return;
  const totalCost = entries.reduce((s, [, it]) => s + (parseFloat(it.prix) || 0), 0);
  const solde = calcOr(c);
  if (totalCost > solde) {
    showNotif(`Fonds insuffisants (${totalCost} or pour ${solde}).`, 'error');
    return;
  }
  // Vérifie stocks
  for (const [, it] of entries) {
    const dispo = (it.dispo !== undefined && it.dispo !== '') ? parseInt(it.dispo) : null;
    if (dispo !== null && dispo >= 0 && dispo < 1) {
      showNotif(`"${it.nom}" est épuisé.`, 'error');
      return;
    }
  }
  // Achat séquentiel — réutilise confirmBuyItem qui gère stock + or + log
  let bought = 0;
  for (const [, it] of entries) {
    try { await confirmBuyItem(it.id, 1); bought++; } catch (e) { console.warn('[atelier buyAll]', e); }
  }
  showNotif(`✅ ${bought} article${bought>1?'s':''} acheté${bought>1?'s':''} pour ${totalCost} or !`, 'success');
  _atelier = { activeSlot: null, simulated: {}, itemSearch: '', sort: _atelier.sort || 'rarity' };
  _renderAtelier();
}

/** Sauvegarde le build courant comme entrée nommée sur le perso. */
async function _atelierSaveBuild() {
  const c = _getActiveShopChar();
  if (!c) return;
  const entries = Object.entries(_atelier.simulated).filter(([, it]) => !!it);
  if (!entries.length) { showNotif('Aucun essai à sauver.', 'error'); return; }
  const name = await promptModal('Nom du build :', { title: 'Sauvegarder le build', default: `Build ${(c.shopBuilds||[]).length + 1}`, required: true });
  if (!name?.trim()) return;
  const slots = {};
  entries.forEach(([slot, it]) => { slots[slot] = it.id; });
  const newBuild = {
    id: `bld_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    slots,
    createdAt: Date.now(),
  };
  const builds = [...(c.shopBuilds || []), newBuild];
  if (await trySave('characters', c.id, { shopBuilds: builds })) {
    c.shopBuilds = builds;
    showNotif(`💾 Build « ${newBuild.name} » sauvegardé.`, 'success');
  }
  _renderAtelier();
}

/** Charge un build sauvegardé dans la simulation courante. */
function _atelierLoadBuild(buildId) {
  const c = _getActiveShopChar();
  if (!c) return;
  const b = (c.shopBuilds || []).find(x => x.id === buildId);
  if (!b) return;
  _atelier.simulated = {};
  _atelier.activeSlot = null;
  Object.entries(b.slots || {}).forEach(([slot, itemId]) => {
    const item = _items.find(i => i.id === itemId);
    if (item) _atelier.simulated[slot] = item;
  });
  _renderAtelier();
  showNotif(`Build « ${b.name} » chargé.`, 'success');
}

/** Supprime un build sauvegardé. */
async function _atelierDeleteBuild(buildId) {
  const c = _getActiveShopChar();
  if (!c) return;
  const builds = (c.shopBuilds || []).filter(b => b.id !== buildId);
  await trySave('characters', c.id, { shopBuilds: builds });
  c.shopBuilds = builds;
  _renderAtelier();
}

function _prepareAtelier(prefillItemId = '') {
  const char = _getActiveShopChar();
  if (!char) return false;
  _atelier = { activeSlot: null, simulated: {}, itemSearch: '', sort: 'rarity' };
  if (prefillItemId) {
    const item = _items.find(i => i.id === prefillItemId);
    const slot = item ? _resolveSlotForItem(item) : null;
    if (item && slot) {
      _atelier.activeSlot = slot;
      _atelier.simulated[slot] = item;
    }
  }
  return true;
}

function _renderAtelierShell({ embedded = false } = {}) {
  return `
    <div class="atelier-shell">
      <div class="atelier-head">
        <div class="atelier-head-ico">🪄</div>
        <div class="atelier-head-title">
          <h2>Atelier d'essayage</h2>
          <small>Construis et compare des configurations avant d'acheter</small>
        </div>
        ${embedded ? '' : '<button class="atelier-close" data-sh-action="closeModal" title="Fermer">✕</button>'}
      </div>
      <div class="atelier-body">
        <div class="atelier-col atelier-col-doll" id="atelier-doll-col"></div>
        <div class="atelier-col atelier-col-stats" id="atelier-stats-col"></div>
        <div class="atelier-col atelier-col-items">
          <div class="atelier-items-head">
            <span class="atelier-items-title">Compatibles : <b id="atelier-slot-name">—</b></span>
          </div>
          <div class="atelier-slot-tabs" id="atelier-slot-tabs"></div>
          <div class="atelier-items-search-wrap">
            <span class="atelier-items-search-ico">🔍</span>
            <input type="text" class="atelier-items-search" id="atelier-items-search"
              placeholder="Filtrer la liste…"
              data-sh-action="atelierSearch" data-sh-on="input"
              autocomplete="off">
          </div>
          <div class="atelier-items-sort" id="atelier-items-sort"></div>
          <div class="atelier-items-list" id="atelier-items-col"></div>
        </div>
      </div>
    </div>`;
}

function _renderAtelierPage() {
  if (!_getActiveShopChar()) {
    return `<div class="sh-atelier-page">${_renderNoCharBanner()}</div>`;
  }
  return `<div class="sh-atelier-page" role="tabpanel">${_renderAtelierShell({ embedded: true })}</div>`;
}

function shopOpenAtelier(prefillItemId = '') {
  if (!_prepareAtelier(prefillItemId)) {
    showNotif('Sélectionne d\'abord un personnage.', 'error');
    return;
  }
  _shopSection = 'atelier';
  renderShop();
}

function shopSetSection(section) {
  if (!['shop', 'atelier', 'artisan'].includes(section) || section === _shopSection) return;
  if (section === 'atelier' && !_prepareAtelier()) {
    showNotif('Sélectionne d\'abord un personnage.', 'error');
    return;
  }
  if (section === 'artisan') _artisanNeedsReset = true;
  else unmountArtisanPage();
  _shopSection = section;
  renderShop();
}

// ──────────────────────────────────────────────────────────────────────────────
// HANDLERS DE DÉLÉGATION (data-sh-action="…")
// ──────────────────────────────────────────────────────────────────────────────
Object.assign(shHandlers, {
  // Header / navigation principale
  setSection:     (el) => shopSetSection(el?.dataset?.section || 'shop'),
  openArtisan:    () => shopSetSection('artisan'),
  openAtelier:    (el) => shopOpenAtelier(el?.dataset?.id || ''),
  // Atelier (slot + items + reset)
  atelierSelectSlot: (el) => {
    const s = el.dataset.slot || '';
    _atelier.activeSlot = (_atelier.activeSlot === s) ? null : s;
    _renderAtelier();
  },
  // Onglet de slot : sélection directe (pas de toggle off, contrairement à la silhouette).
  atelierGoSlot: (el) => {
    _atelier.activeSlot = el.dataset.slot || null;
    _renderAtelier();
  },
  atelierClearSlot: (el, ev) => {
    ev?.stopPropagation?.();
    const s = el.dataset.slot;
    if (s) { delete _atelier.simulated[s]; _renderAtelier(); }
  },
  atelierTryItem: (el) => {
    const id = el.dataset.id; if (!id) return;
    const item = _items.find(i => i.id === id); if (!item) return;
    const slot = _atelier.activeSlot || _resolveSlotForItem(item);
    if (!slot) { showNotif('Slot inconnu pour cet article.', 'error'); return; }
    if (_atelier.simulated[slot]?.id === item.id) delete _atelier.simulated[slot];
    else _atelier.simulated[slot] = item;
    _atelier.activeSlot = slot;
    _renderAtelier();
  },
  atelierReset: () => {
    _atelier = { activeSlot: null, simulated: {}, itemSearch: '', sort: _atelier.sort || 'rarity' };
    _renderAtelier();
  },
  atelierSearch:      (el) => { _atelier.itemSearch = el.value || ''; _renderAtelier(); },
  atelierSetSort:     (el) => { _atelier.sort = el.dataset.sort || 'rarity'; _renderAtelier(); },
  atelierBuyAll:      () => _atelierBuyAll(),
  atelierSaveBuild:   () => _atelierSaveBuild(),
  atelierLoadBuild:   (el) => _atelierLoadBuild(el.dataset.id),
  atelierDeleteBuild: (el, ev) => { ev?.stopPropagation?.(); _atelierDeleteBuild(el.dataset.id); },
  // Restock 1-clic MJ (carte épuisée)
  restockItem:    async (el, ev) => {
    ev?.stopPropagation?.();
    if (!STATE.isAdmin) return;
    const itemId = el.dataset.id; if (!itemId) return;
    await restockShopItem(itemId);
    showNotif('📦 Stock +1', 'success');
    renderShop();
  },
  toggleItemVis:  async (el, ev) => {
    ev?.stopPropagation?.();
    if (!STATE.isAdmin) return;
    const itemId = el.dataset.id; if (!itemId) return;
    const masque = await toggleShopItemVisibility(itemId);
    showNotif(masque ? 'Article masqué aux joueurs' : 'Article visible', masque ? 'info' : 'success');
    renderShop();
  },
  // Affichage : grille / liste (préférence locale) + panneau Filtres
  setView:        (el) => {
    const v = el.dataset.view;
    if (!['grille', 'liste'].includes(v) || v === _shopView) return;
    _shopView = v;
    _lsSet('shop_view', v);
    document.querySelectorAll('.shc-view-btn').forEach(b => {
      const on = b.dataset.view === v;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    _updateResults();
  },
  toggleFilters:  (el) => {
    _filtersOpen = !_filtersOpen;
    _lsSet('shop_filters_open', _filtersOpen ? '1' : '0');
    const panel = document.getElementById('sh-filters');
    if (panel) panel.hidden = !_filtersOpen;
    el.setAttribute('aria-expanded', String(_filtersOpen));
  },
  openCatModal:   (el) => openCatModal(el.dataset.id || ''),
  openItemModal:  (el) => openItemModal(el.dataset.id || ''),
  openWeaponFmts: () => openWeaponFormatsAdmin(),
  openRarities:   () => openRaritiesAdmin(),
  openUpgradeStg: () => openUpgradeSettingsAdmin(),
  openExport:     () => openShopExport({
    getCats: () => _cats,
    getItems: () => _items,
    onImported: () => renderShop(),
  }),
  closeModal:     () => closeModalDirect(),
  // Smart filters (lot 3)
  toggleSmart:    (el) => {
    const k = el.dataset.smart;
    if (!k || !SMART_KINDS.includes(k)) return;
    if (_smartFilters.has(k)) _smartFilters.delete(k); else _smartFilters.add(k);
    _page = 1;
    _refreshSmartFiltersFromCache();
  },
  resetSmart:     () => {
    _smartFilters.clear();
    _page = 1;
    _refreshSmartFiltersFromCache();
  },
  toggleFav:      (el) => toggleFav(el?.dataset?.id || ''),
  // Sidebar / catégories
  goHome:         () => shopGoHome(),
  goCat:          (el) => shopGoCat(el.dataset.id),
  setChar:        (el) => shopSetChar(el.dataset.id || el.value),
  search:         (el) => shopFilterSearch(el.value),
  clearSearch:    () => shopClearSearch(),
  setSort:        (el) => shopSetSort(el.value),
  resetFilters:   () => shopFilterReset(),
  toggleTag:      (el) => shopToggleTag(el.dataset.tag),
  page:           (el) => shopPage(parseInt(el.dataset.page)),
  deleteCat:      (el) => deleteCat(el.dataset.id),
  // Items
  buyItem:        (el, ev) => { ev?.stopPropagation?.(); buyItem(el.dataset.id); },
  confirmBuy:     (el) => confirmBuyItem(el.dataset.id),
  openDetail:     (el) => openShopItemDetail(el.dataset.id),
  openShopHistory:(el, ev) => { ev?.stopPropagation?.(); openShopHistory(); },
  historyScope:   (el) => _shHistorySetScope(el.dataset.scope),
  histPickSearch: (el) => {
    const q = (el.value || '').trim().toLowerCase();
    el.closest('.sh-hist-pick-menu')?.querySelectorAll('.sh-hist-pick-opt[data-name]')
      .forEach(o => { o.hidden = !!q && !(o.dataset.name || '').includes(q); });
  },
  historyOpenItem:(el) => _shHistoryOpenItem(el.dataset.id),
  deleteItem:     (el) => deleteShopItem(el.dataset.id),
  editFromDetail: (el) => { closeModalDirect(); openItemModal(el.dataset.id); },
  buyFromDetail:  (el) => { closeModalDirect(); buyItem(el.dataset.id); },
  tryFromDetail:  (el) => { closeModalDirect(); shopOpenAtelier(el.dataset.id || ''); },
  sellEquip:      (el) => _sellCurrentEquipForShop(el.dataset.slot),
  // Stepper quantité achat
  qtyDown:        (el) => { const inp = el.nextElementSibling; inp?.stepDown(); inp?.dispatchEvent(new Event('input')); },
  qtyUp:          (el) => { const inp = el.previousElementSibling; inp?.stepUp(); inp?.dispatchEvent(new Event('input')); },
  qtyInput:       (el) => _shBuyQtyInput(el),
  // Modal article : tabs, prix, dispo, image, nom
  setTab:         (el) => setItemTab(el.dataset.tab),
  refreshChip:    () => _siRefreshChip(),
  refreshFields:  (el) => refreshItemFields(el.value),
  setItemTemplate:(el) => refreshTemplateFields(el.value),
  setItemCat:     () => { /* la catégorie n'affecte plus les champs ; juste un changement de référence */ },
  toggleDmgProfile: (el) => _shopToggleDmgProfile(el),
  prixInput:      (el) => updatePrixVente(el.value),
  dispoInfini:    (el) => toggleDispoInfini(el),
  dispoInfiniBtn: ()   => toggleDispoInfiniBtn(),
  uploadImg:      (el) => previewUpload(el.id, el.dataset.preview, el.dataset.hidden),
  saveItem:       (el) => saveShopItem(el.dataset.id || ''),
  // Modal article : actions/sorts
  addAction:      () => addShopAction(),
  editAction:     (el) => editShopAction(parseInt(el.dataset.idx)),
  removeAction:   (el) => removeShopAction(parseInt(el.dataset.idx)),
  // Modal article : traits + degats stats + skills
  traitAdd:       () => addShopTrait(),
  traitUpdate:    (el) => updateShopTrait(parseInt(el.dataset.idx), el.value),
  traitRemove:    (el) => removeShopTrait(parseInt(el.dataset.idx)),
  degatsAdd:      () => addShopDegatsStat(),
  degatsUpdate:   (el) => updateShopDegatsStat(parseInt(el.dataset.idx), el.value),
  weaponTypeDefaults: (el) => applyWeaponTypeDefaults(el),
  degatsRemove:   (el) => removeShopDegatsStat(parseInt(el.dataset.idx)),
  skillAdd:       () => addSkillBonus(),
  skillRemove:    (el) => removeSkillBonus(el.dataset.skill),
  // Modal catégorie
  saveCat:        (el) => saveCat(el.dataset.id || ''),
  // Export / import
  tabSwitch:      (el) => switchShopExportTab(el.dataset.tab),
  exportSelectAll:(el) => selectAllShopExport(el.dataset.all === 'true'),
  doExport:       () => doShopExport(),
  previewImport:  (el) => previewShopImport(el),
  doImport:       () => doShopImport(),
  // No-op : juste pour empêcher la propagation au parent (équivalent stopPropagation)
  stop:           (el, ev) => ev?.stopPropagation?.(),
});

// Handler dédié à l'input de quantité de l'achat (calcul total live)
function _shBuyQtyInput(el) {
  const max = parseInt(el.max) || 1;
  const prix = parseInt(el.dataset.prix) || 0;
  const v = Math.min(Math.max(1, parseInt(el.value) || 1), max);
  el.value = v;
  const total = document.getElementById('buy-total');
  const confirmBtn = document.getElementById('buy-confirm');
  if (total) total.textContent = (v * prix) + ' or';
  if (confirmBtn) confirmBtn.textContent = `🛒 Acheter ×${v} — ${v * prix} or`;
}
