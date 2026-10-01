import { STATE } from '../core/state.js';
import { loadCollection, loadChars, addToCol, updateInCol, deleteFromCol, batchUpdateInCol, getDocDataSilent, saveDoc } from '../data/firestore.js';
import { deleteField } from '../config/firebase.js';
import { confirmDelete, trySave } from '../shared/crud.js';
import { openModal, updateModalContent, closeModalDirect, confirmModal, promptModal, setModalCloseGuard, clearModalCloseGuard } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { RARETE_NAMES, _rareteColor, buildRaretePicker, pickRarete, loadRarities, getRarities, openRaritiesAdmin } from '../shared/rarity.js';
import { _esc, _norm, _searchIncludes, loadingHtml, eyeIcon } from '../shared/html.js';
import { lsJson } from '../shared/local-storage.js';
import { calcOr, computeEquipStatsBonus, getItemStatBonus, getMaitriseBonus, calcCA, calcPVMax, calcPMMax, calcVitesse, ITEM_STAT_META, statShort as _statShort, getDefaultCharForUser } from '../shared/char-stats.js';
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
import { openCraftSettingsAdmin } from '../shared/craft-settings.js';
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
import { getVisibleCharacters } from '../shared/character-state.js';
import { consumeTargetEntity } from '../shared/entity-navigation.js';
import { compressDataUrl } from '../shared/image-upload.js';
import { shopAffinityScore, shopCartTotals, shopItemBuyState, shopUpgradeGain } from '../shared/shop-cart.js';
import { atelierApplyBuild, atelierCompactSlots, atelierGainScore, atelierNetCost } from '../shared/shop-atelier.js';
import { damageProfileToRelations, parseShopItemQuickEntry, relationsToDamageProfile } from '../shared/shop-item-editor.js';
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
document.addEventListener('keydown', _shopCatKeydown, true);
document.addEventListener('paste', _shopCatPaste);

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
      { id:'nature',      label:'Nature',        type:'select', options: ['Physique', 'Magique'] },
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
};

function _normalizeShopTemplate(template) {
  if (template === 'libre') return 'classique';
  return TEMPLATES[template] ? template : 'classique';
}

function _normalizeLegacyShopItem(item = {}) {
  if (item.template !== 'libre') return item;
  const description = item.effet || item.description || '';
  return { ...item, template: 'classique', effet: description, description };
}

async function _persistLegacyShopTemplates(categories = [], items = []) {
  if (!STATE.isAdmin) return;
  const updates = [
    ...categories.filter(category => category.template === 'libre')
      .map(category => ({ col: 'shopCategories', id: category.id, data: { template: 'classique' } })),
    ...items.filter(item => item.template === 'libre').map(item => {
      const description = item.effet || item.description || '';
      return { col: 'shop', id: item.id, data: { template: 'classique', effet: description, description } };
    }),
  ];
  if (!updates.length) return;
  try {
    for (let index = 0; index < updates.length; index += 450) {
      await batchUpdateInCol(updates.slice(index, index + 450));
    }
  } catch (error) {
    console.warn('[shop] migration du type Libre vers Classique non persistée', error);
  }
}

const PRIX_VENTE_RATIO = 0.6; // 60%

const _SHOP_ICONS = {
  bag: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  wand: '<path d="M4 20 15 9M14 4v2M18 6l-1.4 1.4M20 10h-2M12 8l4 4"/>',
  hammer: '<path d="m14 6 4 4M4 20l9-9M12.5 4.5l2-2 7 7-2 2z"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  cart: '<path d="M3 4h2.5l2.2 11h10.6L20.5 7H7"/><circle cx="9.5" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M14.8 9.4c-.6-.7-1.5-1-2.7-1-1.5 0-2.5.7-2.5 1.8 0 2.8 5.2 1.3 5.2 4 0 1.1-1 1.9-2.7 1.9-1.3 0-2.3-.4-3-1.2M12 6.8v10.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  shield: '<path d="M12 3l7 3v5.5c0 4.3-3 7.7-7 9.5-4-1.8-7-5.2-7-9.5V6z"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  mana: '<path d="M12 3l6 9-6 9-6-9z"/>',
  move: '<path d="M13 4a1.6 1.6 0 1 1 0 .01M9 20l2.5-6 3 2.5V21M8 11l3-3 3.5 2 2.5 3.5M11.5 8 9.5 13"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 16-5-5-9 8"/>',
  swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
};
function _shopIcon(name, cls = 'shc-svg') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${_SHOP_ICONS[name] || ''}</svg>`;
}

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

// Panier local : aucun document Firestore supplémentaire et aucun listener.
// Il est volontairement vidé au changement de personnage pour éviter qu'un
// achat soit payé par le mauvais personnage.
let _cart = new Map();       // itemId → quantité
let _cartTrades = new Set(); // slots d'équipement repris au paiement
let _cartOpen = false;
let _detailItemId = null;

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
  else if (document.getElementById('sh-items-results')) {
    _refreshSmartFiltersFromCache();
    _syncCommerceChrome();
  }
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
  _cats = cats.map(category => category.template === 'libre' ? { ...category, template: 'classique' } : category);
  _items = items.map(_normalizeLegacyShopItem);
  _weaponFormats = weaponFormats;
  _cats.sort((a,b) => (a.ordre||0)-(b.ordre||0));
  _items.sort(compareManualOrder);
  _shopSousTypes = [...new Set(_items.filter(i=>i.sousType).map(i=>i.sousType))].sort();
  _rebuildShopSearchIndex();
  _persistLegacyShopTemplates(cats, items);
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

function _catImageFocus(cat = {}) {
  const focus = cat.imageFocus || {};
  const clamp = value => Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 50));
  return { x: clamp(focus.x), y: clamp(focus.y) };
}

function _catImageStyle(cat = {}) {
  if (!cat.image) return '';
  const focus = _catImageFocus(cat);
  return `background-image:url('${_esc(cat.image)}');background-position:${focus.x}% ${focus.y}%`;
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
      ${opt('openCraftStg', '🔨 Réglages du craft', 'Disciplines, compétences et paliers du craft')}
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
    const cartSummary = _cartTotals(activeChar);
    // Portrait résolu proprement (photoURL/photo/avatar…) via le helper partagé,
    // plus grand → on voit d'un coup d'œil pour qui on achète.
    const avatar = (c, size) => characterAvatarHtml(c, { size, border: '1px solid rgba(255,255,255,.16)' });
    const subOf = (c) => [c?.niveau ? `Niv.${c.niveau}` : '', c?.classe ? _esc(c.classe) : ''].filter(Boolean).join(' · ');
    const orPill = `<span class="sh-char-strip-or" id="sh-char-or-display" title="Solde du personnage">
          <span><span class="sh-char-strip-or-val" id="sh-char-or-value">${_fmtOr(or)}</span><small>or</small></span>
          <em class="sh-char-strip-after${cartSummary.remaining < 0 ? ' is-negative' : ''}">${cartSummary.total ? `après panier : ${_fmtOr(cartSummary.remaining)}` : 'solde'}</em>
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
              <span class="sh-char-picker-gold">${_fmtOr(calcOr(c))} or</span>
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
              <button type="button" class="shc-btn" data-sh-action="openShopHistory" title="Historique des objets achetés et vendus" aria-label="Historique">${_shopIcon('receipt')}<span class="shc-btn-lbl">Historique</span></button>
              ${_renderManageMenu()}
            ` : ''}
          </div>
        </div>
  `;

  html += `
      <nav class="sh-page-tabs" role="tablist" aria-label="Sections de la boutique">
        <button type="button" class="sh-page-tab ${_shopSection === 'shop' ? 'active' : ''}"
          data-sh-action="setSection" data-section="shop" role="tab" aria-selected="${_shopSection === 'shop'}">
          ${_shopIcon('bag')} Boutique${_cartTotals(activeChar).count ? `<span class="sh-page-tab-count">${_cartTotals(activeChar).count}</span>` : ''}
        </button>
        <button type="button" class="sh-page-tab ${_shopSection === 'atelier' ? 'active' : ''}"
          data-sh-action="setSection" data-section="atelier" role="tab" aria-selected="${_shopSection === 'atelier'}">
          ${_shopIcon('wand')} Atelier
        </button>
        ${STATE.isAdmin ? `<button type="button" class="sh-page-tab ${_shopSection === 'artisan' ? 'active' : ''}"
          data-sh-action="setSection" data-section="artisan" role="tab" aria-selected="${_shopSection === 'artisan'}">
          ${_shopIcon('hammer')} Artisan
        </button>` : '' /* Artisan masqué aux joueurs — refonte du craft en cours */}
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
    _syncShelfNavigation();
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
  const link = ({ id = null, nom, ico, count, masked = false, sortable = false, accent = 'var(--gold)', image = '', imageFocus = null }) => {
    const active = id ? (_view === 'items' && _activeCat === id) : _view === 'home';
    const imageCat = image ? { image, imageFocus } : null;
    return `<button type="button" class="shc-rail-link${active ? ' is-active' : ''}${masked ? ' is-masked' : ''}${sortable ? ' sh-sortable-item' : ''}"
      style="--cat-accent:${_esc(accent || 'var(--gold)')}" data-sh-action="${id ? 'goCat' : 'goHome'}"${id ? ` data-id="${_esc(id)}" data-cat-id="${_esc(id)}"` : ''}${active ? ' aria-current="page"' : ''}>
      <span class="shc-rail-ico${imageCat ? ' has-image' : ''}" aria-hidden="true"${imageCat ? ` style="${_catImageStyle(imageCat)}"` : ''}>${imageCat ? '' : ico}</span>
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
        accent: cat.couleur || 'var(--gold)', image: cat.image || '', imageFocus: cat.imageFocus,
      })).join('')}
    </div>
    ${orphans ? link({ id: '__uncategorized__', nom: 'Non classé', ico: '📦', count: orphans, accent: 'var(--text-dim)' }) : ''}
    ${STATE.isAdmin ? `<button type="button" class="shc-rail-add" data-sh-action="openCatModal">
      <span class="shc-rail-add-ico" aria-hidden="true">＋</span>
      <span>Nouvelle catégorie</span>
    </button>` : ''}
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
  const categoryGroups = _view === 'items' ? st.groups : [];
  const inlineGroups = categoryGroups.slice(0, 2);
  const foldedGroups = categoryGroups.length > 2 ? categoryGroups.slice(2) : (_view === 'items' ? [] : st.groups);
  return `<div class="shc">
    ${_renderRail()}
    <section class="shc-main" aria-label="Articles">
      ${_renderNoCharBanner()}
      ${_renderCatalogHead(st, foldedGroups)}
      <div class="shc-smart" id="sh-smart" role="group" aria-label="Suggestions personnalisées">${_renderSmartChips()}</div>
      <div class="shc-inline-filters" id="sh-inline-filters"${inlineGroups.length ? '' : ' hidden'}>${_renderFilterGroups(inlineGroups)}${_filterTags.size ? '<button type="button" class="shc-link" data-sh-action="resetTags">Effacer</button>' : ''}</div>
      <div class="shc-filters" id="sh-filters"${_filtersOpen && foldedGroups.length ? '' : ' hidden'}>${_renderFilterGroups(foldedGroups)}</div>
      <div class="shc-active" id="sh-active-filters">${_renderActiveFilters(st.groups)}</div>
      <div class="shc-results" id="sh-items-results">${_renderResultsHtml(st)}</div>
    </section>
    ${_renderCommerceOverlays()}
  </div>`;
}

function _renderCatalogHead(st, foldedGroups = st.groups) {
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
      ${_renderFilterToggle(foldedGroups)}
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
  if (_view === 'home' && !st.hasFilters) return _renderHomeShelves(ctx);
  const opts = { showCat: _view === 'home', sortable: STATE.isAdmin && _view === 'items' };
  const body = _shopView === 'liste'
    ? _renderItemList(st.slice, ctx, opts)
    : `<div class="shc-grid${opts.sortable ? ' sh-sortable' : ''}" id="sh-items-grid">${st.slice.map(it => _renderCard(it, ctx, opts)).join('')}</div>`;
  return body + _renderPagination(st.p, st.pages);
}

function _renderShelf(id, title, icon, color, items, subtitle, more = true, pick = false, category = null) {
  const categoryImage = category?.image ? _catImageStyle(category) : '';
  return `<section class="shc-shelf${pick ? ' is-pick' : ''}" style="--shelf:${_esc(color || 'var(--gold)')}">
    <div class="shc-shelf-head">
      <span class="shc-shelf-icon${categoryImage ? ' has-image' : ''}" aria-hidden="true"${categoryImage ? ` style="${categoryImage}"` : ''}>${categoryImage ? '' : icon}</span>
      <div><h2>${title}</h2><small>${subtitle}</small></div>
      <span class="shc-shelf-spacer"></span>
      ${more ? `<button type="button" class="shc-shelf-more" data-sh-action="goCat" data-id="${_esc(id)}">Voir tout ${_shopIcon('chevron')}</button>` : ''}
    </div>
    <div class="shc-shelf-scroll">
      <button type="button" class="shc-shelf-nav is-left" data-sh-action="shelfScroll" data-dir="-1" aria-label="Voir les articles précédents" hidden>${_shopIcon('chevronLeft')}</button>
      <div class="shc-shelf-row">${items.map(item => _renderCard(item, _cardCtx(), { showCat: pick })).join('')}</div>
      <button type="button" class="shc-shelf-nav is-right" data-sh-action="shelfScroll" data-dir="1" aria-label="Voir les articles suivants">${_shopIcon('chevron')}</button>
    </div>
  </section>`;
}

function _renderHomeShelves(ctx) {
  const visible = _visibleItems();
  let html = '';
  if (ctx.char) {
    const picks = visible
      .map(item => {
        const comparison = _itemDeltas(item, ctx.char);
        const candidate = _shopRecommendationCandidate(item);
        return { item, comparison, candidate, score: _shopItemRecommendScore(item, ctx) };
      })
      .filter(entry => entry.comparison.slot
        && (entry.comparison.gain > 0 || !entry.comparison.current)
        && _itemDispo(entry.item) !== 0
        && _shopRecommendationCompatible(entry.candidate, ctx.profile))
      .sort((a, b) => (Number((parseFloat(b.item.prix) || 0) <= ctx.remaining) - Number((parseFloat(a.item.prix) || 0) <= ctx.remaining)) || b.score - a.score)
      .slice(0, 8)
      .map(entry => entry.item);
    if (picks.length) {
      const affordable = picks.filter(item => (parseFloat(item.prix) || 0) <= ctx.remaining).length;
      html += _renderShelf('pick', `Sélection pour ${_esc(ctx.char.nom || 'ton personnage')}`, _shopIcon('up'), 'var(--emerald)', picks,
        `${_esc(ctx.profile?.summary || 'Selon ton équipement et tes caractéristiques')} · ${affordable} dans ton budget`, false, true);
    }
  }
  _visibleCats().forEach(cat => {
    const items = visible.filter(item => item.categorieId === cat.id);
    if (!items.length) return;
    html += _renderShelf(cat.id, _esc(cat.nom || 'Catégorie'), _esc(cat.emoji || _catEmoji(cat.nom)), cat.couleur || 'var(--gold)', items.slice(0, 8),
      `${items.length} article${items.length !== 1 ? 's' : ''}${cat.masquee ? ' · masquée aux joueurs' : ''}`, true, false, cat);
  });
  return html || `<div class="shc-empty"><p>La boutique est vide.</p></div>`;
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
 * Le cœur du score vient de l'affinité avec l'équipement porté : famille et
 * nature d'arme, type d'armure et caractéristiques dominantes. Le gain réel,
 * le budget et le stock départagent ensuite les articles compatibles.
 */
function _shopItemRecommendScore(item, ctx) {
  const { char, remaining, profile } = ctx;
  if (!char) return 0;
  let score = 0;
  const prix = parseFloat(item.prix) || 0;
  const dispo = (item.dispo !== undefined && item.dispo !== '' && item.dispo !== null) ? parseInt(item.dispo) : null;
  const epuise = dispo === 0;
  if (epuise) score -= 1200;
  score += prix <= remaining ? 140 : -90;
  const comparison = _itemDeltas(item, char);
  if (!comparison.current && comparison.slot) score += 80;
  else if (comparison.gain > 0) score += Math.min(240, 70 + comparison.gain * 35);
  else if (comparison.gain < 0) score -= Math.min(220, Math.abs(comparison.gain) * 45);
  score += shopAffinityScore(_shopRecommendationCandidate(item), profile);
  // Rareté
  const rare = _getRareteNum(item.rarete);
  if (rare > 0) score += Math.min(40, rare * 8);
  // Stock
  if (dispo === null || dispo < 0) score += 20;        // illimité = bonus léger
  else if (dispo >= 3) score += 30;
  else if (dispo > 0) score += 10;
  score += Math.min(15, prix / 50);
  return score;
}

function _shopWeaponNature(item = {}) {
  const explicit = _norm(item.nature);
  if (explicit.includes('mag')) return 'magique';
  if (explicit.includes('phy')) return 'physique';
  const family = resolveWeaponFamily(_weaponFormats, item);
  if (family?.isMagic === true) return 'magique';
  if (family?.isMagic === false) return 'physique';
  const legacy = _norm(`${item.format || ''} ${item.sousType || ''}`);
  if (legacy.includes('mag')) return 'magique';
  if (legacy.includes('phy')) return 'physique';
  return '';
}

function _shopRecommendationCandidate(item = {}) {
  const weapon = isWeaponLikeItem(item);
  const family = weapon ? resolveWeaponFamily(_weaponFormats, item) : null;
  const slot = _resolveSlotForItem(item) || '';
  return {
    kind: weapon ? 'weapon' : item.slotArmure ? 'armor' : 'other',
    slot,
    weaponFamily: weapon ? _norm(family?.label || _itemWeaponType(item)) : '',
    weaponNature: weapon ? _shopWeaponNature(item) : '',
    weaponHands: weapon ? _itemWeaponHands(item) : '',
    attackStat: weapon ? _normalizeStatKey(item.toucherStat || family?.defaults?.toucherStat || '') : '',
    armorType: item.slotArmure ? _norm(item.typeArmure) : '',
    statBonuses: Object.fromEntries(ITEM_STAT_META.map(meta => [meta.full, getItemStatBonus(item, meta.full)])),
  };
}

function _shopRecommendationCompatible(candidate = {}, profile = {}) {
  if (candidate.kind === 'weapon' && profile.weaponFamilies?.length) {
    if (!candidate.weaponFamily || !profile.weaponFamilies.includes(candidate.weaponFamily)) return false;
    if (candidate.weaponNature && profile.weaponNatures?.length && !profile.weaponNatures.includes(candidate.weaponNature)) return false;
  }
  if (candidate.kind === 'armor' && profile.armorType && candidate.armorType && candidate.armorType !== profile.armorType) return false;
  return true;
}

// Helper : template à utiliser pour rendre un item (priorité item.template,
// fallback cat.template, fallback 'classique').
function _resolveItemTemplate(item) {
  if (item?.template) return _normalizeShopTemplate(item.template);
  const cat = _cats.find(c => c.id === item?.categorieId);
  return _normalizeShopTemplate(cat?.template);
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
    const v = (parseInt(s[k]) || 0) + (parseInt(c.statsBonus?.[k]) || 0);
    if (v > bestVal) { bestVal = v; best = k; }
  }
  return best;
}

function _shopRecommendationProfile(c) {
  if (!c) return { dominantStats: [], weaponFamilies: [], weaponNatures: [], weaponHands: [], armorBySlot: {}, armorType: '', summary: '' };
  const stats = ['force', 'dexterite', 'intelligence', 'sagesse', 'constitution', 'charisme']
    .map(key => ({ key, value: (parseInt(c.stats?.[key]) || 0) + (parseInt(c.statsBonus?.[key]) || 0) }))
    .sort((a, b) => b.value - a.value);
  const equipped = Object.entries(c.equipement || {}).filter(([, item]) => item?.nom);
  const weapons = equipped.map(([, item]) => item).filter(isWeaponLikeItem);
  const weaponFamilies = [...new Set(weapons.map(item => _norm(_itemWeaponType(item))).filter(Boolean))];
  const weaponNatures = [...new Set(weapons.map(_shopWeaponNature).filter(Boolean))];
  const weaponHands = [...new Set(weapons.map(_itemWeaponHands).filter(Boolean))];
  const armorBySlot = {};
  const armorLabels = new Map();
  equipped.forEach(([slot, item]) => {
    const type = _norm(item.typeArmure);
    if (!type) return;
    armorBySlot[slot] = type;
    const entry = armorLabels.get(type) || { label: item.typeArmure, count: 0 };
    entry.count += 1;
    armorLabels.set(type, entry);
  });
  const armorEntry = [...armorLabels.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  const armorType = armorEntry?.[0] || '';
  const labels = [];
  if (weaponFamilies.length) labels.push(weaponFamilies.map(key => weapons.find(item => _norm(_itemWeaponType(item)) === key)).map(_itemWeaponType).filter(Boolean).join(' / '));
  if (weaponNatures.length === 1) labels.push(weaponNatures[0]);
  if (armorEntry?.[1]?.label) labels.push(armorEntry[1].label);
  labels.push(stats.slice(0, 2).map(entry => _statShort(entry.key)).filter(Boolean).join(' / '));
  return {
    dominantStats: stats.slice(0, 2).map(entry => entry.key),
    weaponFamilies,
    weaponNatures,
    weaponHands,
    armorBySlot,
    armorType,
    summary: labels.filter(Boolean).join(' · '),
  };
}

// Date d'expiration « nouveauté » en ms (0 si non défini). Gère Timestamp
// Firestore ({seconds}) ET number (ms) selon la source.
function _itemNewUntilMs(item) {
  const v = item?.newUntil;
  if (v == null) return 0;
  return v?.seconds ? v.seconds * 1000 : (parseInt(v) || 0);
}

function _shopItemMatchesSmart(item, kind, ctx) {
  const { char, primary, remaining } = ctx;
  switch (kind) {
    case 'fav': return _isFav(item.id);
    case 'payable': {
      if (!char) return false;
      return (parseFloat(item.prix) || 0) <= remaining;
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
      return _itemDeltas(item, char).gain > 0;
    }
  }
  return true;
}

function _shopSmartCtx() {
  const char = _getActiveShopChar();
  const gold = calcOr(char);
  return {
    char,
    primary: _shopPrimaryStat(char),
    profile: _shopRecommendationProfile(char),
    gold,
    remaining: _cartTotals(char).remaining,
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

function _tradeEntries(char = _getActiveShopChar()) {
  if (!char) return [];
  const seen = new Set();
  return [..._cartTrades].map(slot => {
    const equipped = (char.equipement || {})[slot];
    const invIndex = Number(equipped?.sourceInvIndex);
    const item = Number.isInteger(invIndex) && invIndex >= 0 ? char.inventaire?.[invIndex] : null;
    if (!item || seen.has(invIndex)) return null;
    seen.add(invIndex);
    return {
      slot,
      invIndex,
      item,
      credit: parseFloat(item.prixVente) || 0,
    };
  }).filter(Boolean);
}

function _cartLines() {
  return [..._cart].map(([id, qty]) => {
    const item = _items.find(entry => entry.id === id);
    return item ? { id, item, qty, price: parseFloat(item.prix) || 0 } : null;
  }).filter(Boolean);
}

function _cartTotals(char = _getActiveShopChar()) {
  return shopCartTotals(calcOr(char), _cartLines(), _tradeEntries(char));
}

function _clearCart({ close = true } = {}) {
  _cart.clear();
  _cartTrades.clear();
  if (close) _cartOpen = false;
}

function _cartQty(itemId) { return Math.max(0, parseInt(_cart.get(itemId), 10) || 0); }

function _diceAverage(formula) {
  const match = String(formula || '').replace(/\s+/g, '').match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!match) return 0;
  const count = parseInt(match[1] || '1', 10);
  const faces = parseInt(match[2], 10);
  const flat = parseInt(match[3] || '0', 10);
  return count * (faces + 1) / 2 + flat;
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
  return shopItemBuyState(item, ctx);
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

// Écarts vs l'objet équipé au même emplacement. Les dégâts utilisent leur
// moyenne et sont pondérés à moitié dans le score de recommandation.
function _itemDeltas(item, char) {
  const slot = char ? _resolveSlotForItem(item) : null;
  if (!slot) return { slot: null, current: null, diffs: [], gain: 0 };
  const cur = (char.equipement || {})[slot] || null;
  const diffs = [];
  if (item.degats || cur?.degats) {
    const before = cur?.degats || '—';
    const after = item.degats || '—';
    const d = _diceAverage(item.degats) - _diceAverage(cur?.degats);
    if (before !== after) diffs.push({ lbl: 'Dégâts', before, after, d, dice: true });
  }
  ITEM_STAT_META.forEach(m => {
    let cb = 0, nb = 0;
    try { cb = cur ? getItemStatBonus(cur, m.full) : 0; } catch {}
    try { nb = getItemStatBonus(item, m.full); } catch {}
    if (nb !== cb) diffs.push({ lbl: m.short, before: cb, after: nb, d: nb - cb });
  });
  const curCa  = (parseInt(cur?.ca) || 0) + (parseInt(cur?.caBonus) || 0);
  const itemCa = (parseInt(item.ca) || 0) + (parseInt(item.caBonus) || 0);
  if (itemCa !== curCa) diffs.push({ lbl: 'CA', before: curCa, after: itemCa, d: itemCa - curCa });
  return { slot, current: cur, diffs, gain: shopUpgradeGain(diffs) };
}

function _fmtOr(n) {
  return (Number(n) || 0).toLocaleString('fr-FR');
}

// Bouton panier partagé carte ↔ liste ↔ fiche. Une ligne déjà ajoutée devient
// un stepper afin d'éviter l'ancienne modale de quantité.
function _buyBtnHtml(item, hasChar, st, { detail = false } = {}) {
  const qty = _cartQty(item.id);
  const max = st.dispo == null ? 99 : st.dispo;
  if (qty) return `<div class="shc-step${detail ? ' is-detail' : ''}" data-sh-action="stop">
    <button type="button" data-sh-action="cartDec" data-id="${_esc(item.id)}" aria-label="Retirer un exemplaire">−</button>
    <b>${qty}</b>
    <button type="button" data-sh-action="cartInc" data-id="${_esc(item.id)}" aria-label="Ajouter un exemplaire"${qty >= max || st.prix > (_shopSmartCtx().remaining) ? ' disabled' : ''}>＋</button>
  </div>`;
  if (!hasChar)    return `<button type="button" class="shc-buy" disabled title="Sélectionne un personnage pour acheter">Ajouter</button>`;
  if (st.epuise)   return `<button type="button" class="shc-buy" disabled title="Cet article est épuisé">Épuisé</button>`;
  if (st.tropCher) return `<button type="button" class="shc-buy is-short" disabled title="Il te manque ${_fmtOr(st.manque)} or">Manque ${_fmtOr(st.manque)} or</button>`;
  return `<button type="button" class="shc-buy" data-sh-action="cartInc" data-id="${_esc(item.id)}">＋ Ajouter</button>`;
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
  const cartQty = _cartQty(item.id);
  const owned = ctx.char && Array.isArray(ctx.char.inventaire)
    ? ctx.char.inventaire.filter(inv => inv?.itemId && inv.itemId === item.id).length
    : 0;
  const { slot, diffs } = _itemDeltas(item, ctx.char);
  const typeChips = _itemTypeChips(item);
  const facts = _itemFacts(item);
  const traits = _getItemTraits(item);
  const desc = tplKey === 'classique' ? (item.effet || item.description || '') : '';
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
    <article class="shc-card${st.epuise ? ' is-out' : ''}${edit && item.masque ? ' is-masked' : ''}${cartQty ? ' is-in-cart' : ''}${_detailItemId === item.id ? ' is-current' : ''}${sortable ? ' sh-sortable-item' : ''}"
      style="${_itemColorVars(rar, cat)}"
      data-item-id="${item.id}" data-sh-action="openDetail" data-id="${item.id}"
      data-sh-key-card="item" tabindex="0" role="button" aria-label="Ouvrir ${_esc(nom)}">
      <div class="shc-card-vis${item.image ? ' has-img' : ''}"${_itemVisStyle(item)}>
        ${item.image ? '' : `<span class="shc-card-glyph" aria-hidden="true">${_esc(_itemGlyph(item, tplKey, cat))}</span>`}
        <button type="button" class="shc-card-fav${fav ? ' is-on' : ''}" data-sh-action="toggleFav" data-id="${item.id}"
          aria-pressed="${fav}" title="${fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}" aria-label="Favori">${fav ? '★' : '☆'}</button>
        ${!STATE.isAdmin && _itemNewUntilMs(item) > Date.now() ? '<span class="shc-new-badge">NOUVEAU</span>' : ''}
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
        ${diffs.filter(x => x.d).length ? `<div class="shc-delta" title="Comparé à ton équipement actuel (${_esc(slot)})">
          <span class="shc-delta-lbl">vs équipé</span>
          ${diffs.filter(x => x.d).slice(0, 3).map(x => `<b class="${x.d > 0 ? 'is-up' : 'is-down'}">${_esc(x.lbl)} ${x.d > 0 ? '▲' : '▼'}${x.dice ? '' : Math.abs(x.d)}</b>`).join('')}
        </div>` : ''}
      </div>
      <div class="shc-card-foot">
        <span class="shc-price${st.tropCher && !st.epuise && !cartQty ? ' is-short' : ''}"><b>${_fmtOr(st.prix)}</b> or</span>
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
  const cartQty = _cartQty(item.id);
  const slot = ctx.char ? _resolveSlotForItem(item) : null;
  const typeLine = [..._itemTypeChips(item), ...(showCat && cat ? [cat.nom] : [])].map(_esc).join(' · ');
  const nom = item.nom || '?';

  const info = [
    ..._itemFacts(item).map(f => `<span class="shc-row-fact"><i>${f.lbl}</i> ${_esc(f.val)}</span>`),
    ..._getStatBonusEntries(item).map(b => `<span class="shc-bonus" style="--stat:${b.color}">${_esc(b.short)} ${b.val > 0 ? '+' : ''}${b.val}</span>`),
  ];
  const desc = tplKey === 'classique' ? (item.effet || item.description || '') : '';
  if (desc) info.push(`<span class="shc-row-desc">${_esc(desc)}</span>`);

  const stock = st.dispo == null ? '<span class="shc-row-stock">∞</span>'
    : `<span class="shc-row-stock${st.dispo === 0 ? ' is-out' : st.dispo < 3 ? ' is-low' : ''}">${st.dispo === 0 ? 'Épuisé' : st.dispo}</span>`;

  return `
    <div class="shc-row${st.epuise ? ' is-out' : ''}${edit && item.masque ? ' is-masked' : ''}${cartQty ? ' is-in-cart' : ''}${_detailItemId === item.id ? ' is-current' : ''}${sortable ? ' sh-sortable-item' : ''}"
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
      <span class="shc-price${st.tropCher && !st.epuise && !cartQty ? ' is-short' : ''}"><b>${_fmtOr(st.prix)}</b> or</span>
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
    itemId: shopItem.id || shopItem.itemId || '',
    nom: shopItem.nom || '',
    template: shopItem.template || '',
    icon: shopItem.icon || '',
    image: shopItem.image || '',
    rarete: shopItem.rarete || '',
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
async function _sellCurrentEquipForShop(slot, draft = null) {
  const c = draft?.char || _getActiveShopChar();
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
  if (draft) {
    if (draft.tradeIndices.has(invIndex)) return { ok: true, duplicate: true };
    draft.tradeIndices.add(invIndex);
    draft.reprises += prixVente;
    draft.history.push(makeInventoryHistoryEntry('sell', invItem, 1, {
      ..._inventoryHistoryActor(),
      source: 'Boutique',
      note: `${prixVente} or`,
    }));
    if (invItem.itemId) {
      const shopItem = _items.find(item => item.id === invItem.itemId);
      if (_itemDispo(shopItem || {}) !== null) {
        draft.stockDeltas.set(invItem.itemId, (draft.stockDeltas.get(invItem.itemId) || 0) + 1);
      }
    }
    return { ok: true, credit: prixVente, invIndex, item: invItem };
  }
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
function _renderDetailPanelHtml() {
  const item = _detailItemId && _items.find(entry => entry.id === _detailItemId);
  if (!item) return '';
  const ctx = _cardCtx();
  const cat = _cats.find(entry => entry.id === item.categorieId);
  const st = _itemBuyState(item, ctx);
  const rar = _itemRarity(item);
  const tplKey = _resolveItemTemplate(item);
  const traits = _getItemTraits(item);
  const bonuses = _getStatBonusEntries(item);
  const typeLine = [_esc(cat?.nom || ''), ..._itemTypeChips(item).map(_esc)].filter(Boolean).join(' · ');
  const owned = ctx.char?.inventaire?.filter(entry => entry?.itemId === item.id).length || 0;
  const compare = ctx.char ? _itemDeltas(item, ctx.char) : { slot: null, current: null, diffs: [] };
  const trade = compare.slot ? _tradeEntries(ctx.char).find(entry => entry.slot === compare.slot) : null;
  const equipped = compare.current;
  const sourceIndex = Number(equipped?.sourceInvIndex);
  const sourceItem = Number.isInteger(sourceIndex) ? ctx.char?.inventaire?.[sourceIndex] : null;
  const canTrade = !!sourceItem;
  const tradeCredit = parseFloat(sourceItem?.prixVente) || 0;
  const facts = [
    ..._itemFacts(item),
    { lbl: 'Stock', val: st.dispo == null ? 'Illimité' : st.epuise ? 'Épuisé' : String(st.dispo) },
    { lbl: 'Revente', val: `${_fmtOr(Math.round(st.prix * PRIX_VENTE_RATIO))} or` },
  ];
  const desc = item.effet || item.description || '';
  const imageStyle = `${_itemColorVars(rar, cat)};${item.image
    ? `background-image:url('${_esc(item.image)}');background-size:cover;background-position:center;`
    : ''}`;
  const compareHtml = compare.slot ? `<div class="shc-detail-section">
    <div class="shc-detail-label">Comparé à ton équipement</div>
    <div class="shc-compare">
      <div class="shc-compare-head">${_esc(compare.slot)} · <b>${equipped?.nom ? _esc(equipped.nom) : 'Emplacement libre'}</b></div>
      ${compare.diffs.length ? compare.diffs.map(diff => `<div class="shc-compare-row">
        <span>${_esc(diff.lbl)}</span><i>${_esc(diff.before)}</i><span>→</span><b>${_esc(diff.after)}</b>
        <em class="${diff.d > 0 ? 'is-up' : diff.d < 0 ? 'is-down' : ''}">${diff.d ? (diff.dice ? (diff.d > 0 ? '▲' : '▼') : `${diff.d > 0 ? '+' : ''}${diff.d}`) : '='}</em>
      </div>`).join('') : '<div class="shc-compare-empty">Caractéristiques principales équivalentes.</div>'}
      ${canTrade ? `<label class="shc-trade"><input type="checkbox" data-sh-action="cartTrade" data-sh-on="change" data-slot="${_esc(compare.slot)}"${trade ? ' checked' : ''}>
        <span><b>Revendre ${_esc(sourceItem.nom || equipped.nom)}</b><small>Crédité lors du paiement du panier</small></span><strong>+${_fmtOr(tradeCredit)} or</strong>
      </label>` : ''}
    </div>
  </div>` : '';

  return `<div class="shc-detail-hero${item.image ? ' has-image' : ''}" style="${imageStyle}">
      ${item.image ? '' : `<span class="shc-detail-glyph" aria-hidden="true">${_esc(_itemGlyph(item, tplKey, cat))}</span>`}
      <button type="button" class="shc-detail-fav${_isFav(item.id) ? ' is-on' : ''}" data-sh-action="toggleFav" data-id="${_esc(item.id)}" aria-label="Favori">${_isFav(item.id) ? '★' : '☆'}</button>
      <button type="button" class="shc-detail-close" data-sh-action="closeDetail" aria-label="Fermer">${_shopIcon('x')}</button>
      ${rar.n ? `<span class="shc-detail-rarity" style="--rar:${_esc(rar.color)}">${'★'.repeat(rar.n)} ${_esc(rar.name)}</span>` : ''}
      ${owned ? `<span class="shc-detail-owned">✓ Tu en as ×${owned}</span>` : ''}
    </div>
    <div class="shc-detail-body">
      <div><h2>${_esc(item.nom || 'Article')}</h2><p class="shc-detail-type">${typeLine}</p></div>
      <div class="shc-detail-facts">${facts.map(fact => `<div><small>${_esc(fact.lbl)}</small><b${fact.color ? ` style="color:${fact.color}"` : ''}>${_esc(fact.val)}</b></div>`).join('')}</div>
      ${bonuses.length || traits.length ? `<div class="shc-detail-pills">${bonuses.map(b => `<span class="shc-bonus" style="--stat:${b.color}">${b.short} ${b.val > 0 ? '+' : ''}${b.val}</span>`).join('')}${traits.map(t => `<span class="shc-trait">${_esc(t)}</span>`).join('')}</div>` : ''}
      ${desc ? `<p class="shc-detail-desc">${_esc(desc)}</p>` : ''}
      ${compareHtml}
    </div>
    <div class="shc-detail-foot">
      ${STATE.isAdmin ? `<button type="button" class="shc-btn" data-sh-action="editFromDetail" data-id="${_esc(item.id)}">Modifier</button>` : ''}
      <span class="shc-price${st.tropCher && !_cartQty(item.id) ? ' is-short' : ''}"><b>${_fmtOr(st.prix)}</b> or</span>
      <span class="shc-detail-spacer"></span>
      ${compare.slot ? `<button type="button" class="shc-btn is-arcane" data-sh-action="tryFromDetail" data-id="${_esc(item.id)}">${_shopIcon('wand')}Essayer</button>` : ''}
      ${_buyBtnHtml(item, !!ctx.char, st, { detail: true })}
    </div>`;
}

function _renderCartPanelHtml() {
  const char = _getActiveShopChar();
  const lines = _cartLines();
  const trades = _tradeEntries(char);
  const totals = _cartTotals(char);
  const payLabel = totals.total < 0
    ? `Recevoir ${_fmtOr(Math.abs(totals.total))} or`
    : `Payer ${_fmtOr(totals.total)} or`;
  return `<div class="shc-cart-head"><h3><span>Panier</span><small>pour ${_esc(char?.nom || '—')}</small></h3>
      <button type="button" class="shc-cart-clear" data-sh-action="cartClear">Vider</button>
      <button type="button" class="shc-detail-close" data-sh-action="cartClose" aria-label="Fermer">${_shopIcon('x')}</button></div>
    <div class="shc-cart-lines">
      ${lines.map(({ item, qty, price }) => { const cat = _cats.find(c => c.id === item.categorieId); return `<div class="shc-cart-line">
        <span class="shc-cart-thumb${item.image ? ' has-image' : ''}"${item.image ? ` style="background-image:url('${_esc(item.image)}')"` : ''}>${item.image ? '' : _esc(_itemGlyph(item, _resolveItemTemplate(item), cat))}</span>
        <span><b>${_esc(item.nom || 'Article')}</b><small>${_fmtOr(price)} or${qty > 1 ? ' / unité' : ''}</small></span>
        ${_buyBtnHtml(item, !!char, _itemBuyState(item, _cardCtx()))}
        <strong>${_fmtOr(price * qty)}</strong>
      </div>`; }).join('')}
      ${trades.map(trade => `<div class="shc-cart-line is-trade"><span class="shc-cart-thumb">↺</span><span><b>Reprise : ${_esc(trade.item.nom || 'Équipement')}</b><small>${_esc(trade.slot)}</small></span>
        <button type="button" class="shc-cart-remove" data-sh-action="cartUntrade" data-slot="${_esc(trade.slot)}" aria-label="Annuler la reprise">${_shopIcon('x')}</button><strong>+${_fmtOr(trade.credit)} or</strong></div>`).join('')}
    </div>
    <div class="shc-cart-summary">
      <div><span>Articles (${totals.count})</span><b>${_fmtOr(totals.articles)} or</b></div>
      ${totals.reprises ? `<div><span>Reprises</span><b class="is-up">−${_fmtOr(totals.reprises)} or</b></div>` : ''}
      <div class="is-total"><span>Total</span><b>${_fmtOr(totals.total)} or</b></div>
      <div class="${totals.remaining < 0 ? 'is-negative' : ''}"><span>Solde après achat</span><b>${_fmtOr(calcOr(char))} → ${_fmtOr(totals.remaining)} or</b></div>
    </div>
    ${totals.remaining < 0 ? `<div class="shc-cart-warning">Il manque ${_fmtOr(-totals.remaining)} or pour régler ce panier.</div>` : ''}
    <div class="shc-cart-foot"><button type="button" class="shc-cart-pay" data-sh-action="cartPay"${totals.remaining < 0 || !totals.count || _buyInProgress ? ' disabled' : ''}>${_shopIcon('coin')}${payLabel}</button></div>`;
}

function _renderCommerceOverlays() {
  const totals = _cartTotals();
  const hasCart = totals.count > 0 || totals.reprises > 0;
  const detailOpen = !!(_detailItemId && _items.some(item => item.id === _detailItemId));
  const cartOpen = _cartOpen && hasCart;
  return `<div class="shc-commerce">
    <div class="shc-detail-scrim${detailOpen ? ' is-open' : ''}" data-sh-action="closeDetail"></div>
    <aside class="shc-detail-sheet${detailOpen ? ' is-open' : ''}" id="shc-detail-sheet" role="dialog" aria-modal="true" aria-label="Fiche article">${_renderDetailPanelHtml()}</aside>
    <button type="button" class="shc-cart-fab" id="shc-cart-fab" data-sh-action="cartToggle" aria-expanded="${_cartOpen}"${hasCart ? '' : ' hidden'}>${_shopIcon('cart')}Panier <span>${totals.count}</span><b>${_fmtOr(totals.total)} or</b></button>
    <section class="shc-cart-panel${cartOpen ? ' is-open' : ''}" id="shc-cart-panel" role="dialog" aria-label="Panier" aria-hidden="${!cartOpen}">${_renderCartPanelHtml()}</section>
  </div>`;
}

function _syncCommerceChrome({ bump = false } = {}) {
  const commerce = document.querySelector('.shc-commerce');
  const totals = _cartTotals();
  const hasCart = totals.count > 0 || totals.reprises > 0;
  if (!hasCart) _cartOpen = false;
  if (commerce) {
    const detailOpen = !!(_detailItemId && _items.some(item => item.id === _detailItemId));
    const scrim = commerce.querySelector('.shc-detail-scrim');
    const sheet = commerce.querySelector('.shc-detail-sheet');
    const fab = commerce.querySelector('.shc-cart-fab');
    const panel = commerce.querySelector('.shc-cart-panel');
    scrim?.classList.toggle('is-open', detailOpen);
    if (sheet) {
      sheet.classList.toggle('is-open', detailOpen);
      sheet.innerHTML = _renderDetailPanelHtml();
    }
    if (fab) {
      fab.hidden = !hasCart;
      fab.setAttribute('aria-expanded', String(_cartOpen && hasCart));
      fab.innerHTML = `${_shopIcon('cart')}Panier <span>${totals.count}</span><b>${_fmtOr(totals.total)} or</b>`;
    }
    if (panel) {
      const open = _cartOpen && hasCart;
      panel.classList.toggle('is-open', open);
      panel.setAttribute('aria-hidden', String(!open));
      panel.innerHTML = _renderCartPanelHtml();
    }
  }
  const char = _getActiveShopChar();
  const charTotals = _cartTotals(char);
  const wallet = document.getElementById('sh-char-or-display');
  if (wallet) wallet.innerHTML = `<span><span class="sh-char-strip-or-val" id="sh-char-or-value">${_fmtOr(calcOr(char))}</span><small>or</small></span><em class="sh-char-strip-after${charTotals.remaining < 0 ? ' is-negative' : ''}">${charTotals.total ? `après panier : ${_fmtOr(charTotals.remaining)}` : 'solde'}</em>`;
  const fab = document.getElementById('shc-cart-fab');
  if (bump && fab) { fab.classList.remove('is-bump'); void fab.offsetWidth; fab.classList.add('is-bump'); }
}

function _refreshCommerceUi(opts = {}) {
  const smart = document.getElementById('sh-smart');
  if (smart) smart.innerHTML = _renderSmartChips();
  _updateResults();
  _syncCommerceChrome(opts);
}

function openShopItemDetail(itemId) {
  if (!_items.some(item => item.id === itemId)) return;
  _detailItemId = itemId;
  _refreshCommerceUi();
  requestAnimationFrame(() => document.querySelector('.shc-detail-close')?.focus({ preventScroll: true }));
}

function _closeShopItemDetail() {
  if (!_detailItemId) return;
  _detailItemId = null;
  _refreshCommerceUi();
}

// ══════════════════════════════════════════════════════════════════════════════
// SÉLECTEUR PERSONNAGE
// ══════════════════════════════════════════════════════════════════════════════
function shopSetChar(charId) {
  const changed = charId !== getShopCharId();
  _setShopCharId(charId);
  if (changed) {
    _clearCart();
    _detailItemId = null;
  }
  if (_shopSection === 'atelier') {
    _atelier = _newAtelierState({ sort: _atelier?.sort || 'gain' });
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
// ACHAT — préparation pure puis commit atomique personnage + stocks.
// ══════════════════════════════════════════════════════════════════════════════
function _newPurchaseDraft(char) {
  return {
    char,
    inventory: Array.isArray(char?.inventaire) ? [...char.inventaire] : [],
    history: [],
    stockDeltas: new Map(),
    tradeIndices: new Set(),
    removedIndices: [],
    articles: 0,
    reprises: 0,
    count: 0,
  };
}

function _applyPurchase(char, item, qty, draft = _newPurchaseDraft(char)) {
  qty = Math.max(1, parseInt(qty, 10) || 1);
  const dispo = _itemDispo(item);
  if (!char || !item?.id) return { ok: false, error: 'Achat invalide', draft };
  if (dispo !== null && dispo < qty) return { ok: false, error: `Stock insuffisant pour « ${item.nom || 'Article'} »`, draft };

  const prix = parseFloat(item.prix) || 0;
  const invItem = shopItemToInvEntry(item, {
    source: 'boutique',
    template: _resolveItemTemplate(item),
    prixAchat: prix,
    prixVente: Math.round(prix * PRIX_VENTE_RATIO),
  });
  for (let i = 0; i < qty; i++) draft.inventory.push({ ...invItem });
  draft.history.push(makeInventoryHistoryEntry('add', invItem, qty, {
    ..._inventoryHistoryActor(),
    source: 'Boutique',
    note: `${prix * qty} or`,
  }));
  draft.articles += prix * qty;
  draft.count += qty;
  if (dispo !== null) draft.stockDeltas.set(item.id, (draft.stockDeltas.get(item.id) || 0) - qty);
  return { ok: true, draft, total: prix * qty };
}

function _accountPayloadForPurchase(char, delta, reason) {
  const compte = { recettes: [], depenses: [], ...(char.compte || {}) };
  const recettes = [...(compte.recettes || [])];
  const depenses = [...(compte.depenses || [])];
  const date = new Date().toLocaleDateString('fr-FR');
  // Migration transparente des très anciennes fiches qui n'avaient qu'un
  // champ `or`, sinon la première dépense ferait disparaître leur solde.
  if (!recettes.length && !depenses.length && calcOr(char) > 0) {
    recettes.push({ date, libelle: 'Solde initial', montant: calcOr(char) });
  }
  if (delta < 0) depenses.push({ date, libelle: reason, montant: Math.abs(delta) });
  else if (delta > 0) recettes.push({ date, libelle: reason, montant: delta });
  return { ...compte, recettes, depenses };
}

async function _commitPurchaseDraft(draft, { toast = true } = {}) {
  const char = draft?.char;
  if (!char || !draft.count) return { ok: false, error: 'Panier vide' };
  const total = draft.articles - draft.reprises;
  if (calcOr(char) - total < 0) return { ok: false, error: `Il manque ${_fmtOr(total - calcOr(char))} or` };

  const removed = [...draft.tradeIndices].sort((a, b) => a - b);
  if (removed.length) {
    const removedSet = new Set(removed);
    draft.inventory = draft.inventory.filter((_, index) => !removedSet.has(index));
  }
  const equipSync = syncEquipmentAfterInventoryMutation(char, removed);
  const historyPatch = inventoryHistoryPayload(char, draft.history);
  const compte = _accountPayloadForPurchase(char, -total, `Boutique · ${draft.count} article${draft.count > 1 ? 's' : ''}`);
  const payload = {
    inventaire: draft.inventory,
    inventoryHistory: historyPatch.inventoryHistory,
    compte,
    ...(equipSync.changed ? { equipement: equipSync.equipement, statsBonus: equipSync.statsBonus } : {}),
  };
  const updates = [{ col: 'characters', id: char.id, data: payload }];
  draft.stockDeltas.forEach((delta, itemId) => {
    const shopItem = _items.find(item => item.id === itemId);
    const dispo = _itemDispo(shopItem || {});
    if (dispo !== null) updates.push({ col: 'shop', id: itemId, data: { dispo: Math.max(0, dispo + delta) } });
  });

  try {
    await batchUpdateInCol(updates);
  } catch (error) {
    return { ok: false, error: error?.message || 'Le paiement n’a pas été appliqué' };
  }

  Object.assign(char, payload);
  draft.stockDeltas.forEach((delta, itemId) => {
    const shopItem = _items.find(item => item.id === itemId);
    const dispo = _itemDispo(shopItem || {});
    if (shopItem && dispo !== null) shopItem.dispo = Math.max(0, dispo + delta);
  });
  if (toast) {
    const money = total >= 0 ? `−${_fmtOr(total)}` : `+${_fmtOr(Math.abs(total))}`;
    showNotif(`${draft.count} article${draft.count > 1 ? 's' : ''} ajouté${draft.count > 1 ? 's' : ''} à l’inventaire · ${money} or`, 'success');
  }
  return { ok: true, total, count: draft.count, newBalance: calcOr(char) };
}

function _cartAdd(itemId) {
  const char = _getActiveShopChar();
  const item = _items.find(entry => entry.id === itemId);
  if (!char) { showNotif('Sélectionne un personnage.', 'error'); return; }
  if (!item || (!STATE.isAdmin && !_visibleItems().some(entry => entry.id === itemId))) return;
  const qty = _cartQty(itemId);
  const state = _itemBuyState(item, _shopSmartCtx());
  if (state.epuise || (state.dispo !== null && qty >= state.dispo)) { showNotif('Stock insuffisant.', 'error'); return; }
  if (state.tropCher) { showNotif(`Il manque ${_fmtOr(state.manque)} or.`, 'error'); return; }
  _cart.set(itemId, qty + 1);
  _refreshCommerceUi({ bump: true });
}

function _cartRemove(itemId) {
  const qty = _cartQty(itemId) - 1;
  if (qty > 0) _cart.set(itemId, qty); else _cart.delete(itemId);
  if (!_cart.size && !_cartTrades.size) _cartOpen = false;
  _refreshCommerceUi();
}

async function _payCart() {
  if (_buyInProgress) return;
  const char = _getActiveShopChar();
  if (!char) return;
  const lines = _cartLines();
  if (!lines.length) return;
  const draft = _newPurchaseDraft(char);
  try {
    _buyInProgress = true;
    for (const trade of _tradeEntries(char)) await _sellCurrentEquipForShop(trade.slot, draft);
    for (const { item, qty } of lines) {
      const applied = _applyPurchase(char, item, qty, draft);
      if (!applied.ok) { showNotif(applied.error, 'error'); return; }
    }
    const result = await _commitPurchaseDraft(draft);
    if (!result.ok) { showNotif(result.error, 'error'); return; }
    _clearCart();
    _detailItemId = null;
    _refreshCommerceUi();
  } finally {
    _buyInProgress = false;
    _syncCommerceChrome();
  }
}

let _buyInProgress = false;
async function confirmBuyItem(itemId, directQty) {
  if (_buyInProgress) return;
  try {
    _buyInProgress = true;
    const item = _items.find(i => i.id === itemId);
    const char = _getActiveShopChar();
    if (!item || !char) return { ok: false };
    const qty = directQty != null
      ? Math.max(1, parseInt(directQty) || 1)
      : Math.max(1, parseInt(document.getElementById('buy-qty')?.value)||1);
    const draft = _newPurchaseDraft(char);
    const applied = _applyPurchase(char, item, qty, draft);
    if (!applied.ok) { showNotif(applied.error, 'error'); return applied; }
    const result = await _commitPurchaseDraft(draft, { toast: false });
    if (!result.ok) { showNotif(result.error, 'error'); return result; }
    if (directQty == null) closeModalDirect();
    showNotif(`×${qty} « ${item.nom} » ajouté${qty > 1 ? 's' : ''} à l’inventaire · −${_fmtOr(result.total)} or`, 'success');
    if (_shopSection === 'shop') _refreshCommerceUi();
    return result;
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
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target?.matches?.('input, textarea, [contenteditable="true"]')) {
    const input = document.getElementById('sh-search');
    if (input) { event.preventDefault(); input.focus(); return; }
  }
  if (event.key === 'Escape') {
    if (_detailItemId) { event.preventDefault(); _closeShopItemDetail(); return; }
    if (_cartOpen) { event.preventDefault(); _cartOpen = false; _syncCommerceChrome(); return; }
    if (_filterSearch) { event.preventDefault(); shopClearSearch(); return; }
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

// Capture avant le gestionnaire Escape global de navigation : la modale de
// catégorie ferme d'abord son popover, puis sa confirmation de suppression.
function _shopCatKeydown(event) {
  if (!_catEditorState || !document.querySelector('.shcat')) return;
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopImmediatePropagation();
    if (_catEditorState.emojiOpen) _catEditorMutate(state => { state.emojiOpen = false; });
    else if (_catEditorState.deleting) _catEditorMutate(state => { state.deleting = false; });
    else _catClose();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault(); event.stopImmediatePropagation(); saveCat(); return;
  }
  if (event.key === 'Enter' && event.target?.id === 'shcat-name') {
    event.preventDefault(); event.stopImmediatePropagation(); saveCat(); return;
  }
  if (event.target?.classList?.contains('shcat-drop') && ['Enter', ' '].includes(event.key)) {
    event.preventDefault(); event.stopImmediatePropagation(); document.getElementById('shcat-file')?.click();
  }
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

  const categoryGroups = _view === 'items' ? st.groups : [];
  const inlineGroups = categoryGroups.slice(0, 2);
  const foldedGroups = categoryGroups.length > 2 ? categoryGroups.slice(2) : (_view === 'items' ? [] : st.groups);
  const toggle = document.getElementById('sh-filter-toggle');
  if (toggle) toggle.outerHTML = _renderFilterToggle(foldedGroups);
  const inline = document.getElementById('sh-inline-filters');
  if (inline) {
    inline.hidden = !inlineGroups.length;
    inline.innerHTML = _renderFilterGroups(inlineGroups) + (_filterTags.size ? '<button type="button" class="shc-link" data-sh-action="resetTags">Effacer</button>' : '');
  }
  const folded = document.getElementById('sh-filters');
  if (folded) {
    folded.hidden = !_filtersOpen || !foldedGroups.length;
    folded.innerHTML = _renderFilterGroups(foldedGroups);
  }
  document.querySelectorAll('#sh-filters [data-tag-value]').forEach(btn => {
    const on = _filterTags.has(btn.dataset.tagValue);
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  const active = document.getElementById('sh-active-filters');
  if (active) active.innerHTML = _renderActiveFilters(st.groups);

  results.innerHTML = _renderResultsHtml(st);
  _syncShelfNavigation();
  _refocus(refocus);
  // Le remplacement de innerHTML détruit l'ancien conteneur Sortable. Le
  // remonter à la frame suivante permet d'enchaîner les déplacements sans
  // recharger la page, y compris après le re-rendu déclenché par un drag.
  _scheduleSortablesMount();
}

function _syncShelfNavigation() {
  requestAnimationFrame(() => document.querySelectorAll('.shc-shelf-scroll').forEach(scroller => {
    const row = scroller.querySelector('.shc-shelf-row');
    const left = scroller.querySelector('.shc-shelf-nav.is-left');
    const right = scroller.querySelector('.shc-shelf-nav.is-right');
    if (!row || !left || !right) return;
    const sync = () => {
      left.hidden = row.scrollLeft < 4;
      right.hidden = row.scrollLeft + row.clientWidth >= row.scrollWidth - 4;
    };
    row.onscroll = sync;
    sync();
  }));
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
const CAT_EDITOR_COLORS = ['#4f8cff', '#22c38e', '#f4c430', '#ff9544', '#ff5a7e', '#9d6fff', '#38bdf8', '#a3a3a3'];
const CAT_EDITOR_EMOJIS = ['⚔️','🗡️','🏹','🪓','🔱','🛡️','⛑️','🥾','💍','📿','🔮','✨','🪄','📜','🧪','⚗️','🌿','🍄','🍖','🍞','🍺','🔧','⛏️','🪢','🧭','🗝️','💎','🪙','🎒','🐎','🐉','💀','🔥','❄️','⚡','📦'];
let _catEditorState = null;

function _catGuessTemplate(nom = '') {
  const value = _norm(nom);
  if (value.includes('armure')) return 'armure';
  if (value.includes('arme')) return 'arme';
  if (/bijou|anneau|amulette/.test(value)) return 'bijou';
  return null;
}

function _catEditorEmoji(state = _catEditorState) {
  return state?.emoji || _catEmoji(state?.nom || '');
}

function _catEditorPersisted(state = _catEditorState) {
  const focus = _catImageFocus({ imageFocus: state?.imageFocus });
  return {
    nom: String(state?.nom || '').trim(),
    emoji: state?.emoji || '',
    couleur: state?.couleur || '',
    template: _normalizeShopTemplate(state?.template),
    image: state?.image || '',
    imageFocus: focus,
    masquee: !!state?.masquee,
  };
}

function _catEditorDirty() {
  return !!_catEditorState && JSON.stringify(_catEditorPersisted()) !== _catEditorState.original;
}

function _catEditorCount(catId) {
  return catId ? _items.filter(item => item.categorieId === catId).length : 0;
}

function _catTemplateParts(key) {
  const label = TEMPLATES[key]?.label || key;
  const match = label.match(/^(\p{Extended_Pictographic}(?:\uFE0F)?)[\s\u00a0]+(.+)$/u);
  return { emoji: match?.[1] || '📦', label: match?.[2] || label };
}

function _catDeleteFooterHtml(state) {
  const count = _catEditorCount(state.id);
  const options = _cats.filter(cat => cat.id !== state.id).map(cat => `<option value="${_esc(cat.id)}"${state.destination === cat.id ? ' selected' : ''}>${_esc(cat.emoji || _catEmoji(cat.nom))} ${_esc(cat.nom || 'Catégorie')}</option>`).join('');
  return `<div class="shcat-delete-copy">${count
    ? `<span>Ses <b>${count} article${count > 1 ? 's' : ''}</b> iront dans</span><select data-sh-action="catDeleteDestination" data-sh-on="change"><option value="">📦 Non classé</option>${options}</select>`
    : '<span>Cette catégorie est vide.</span>'}</div>
    <span class="shcat-footer-spacer"></span>
    <button type="button" class="ghost" data-sh-action="catDeleteCancel">Garder</button>
    <button type="button" class="shcat-delete-confirm" data-sh-action="catDeleteConfirm" data-id="${_esc(state.id)}">${_shopIcon('trash', 'shcat-icon')} Supprimer « ${_esc(state.nom || '?')} »</button>`;
}

function _catEditorHtml() {
  const state = _catEditorState;
  if (!state) return '';
  const dirty = _catEditorDirty();
  const focus = _catImageFocus(state);
  const template = TEMPLATES[state.template] || TEMPLATES.classique;
  return `<div class="shcat" style="--shcat-accent:${_esc(state.couleur || 'var(--gold)')}">
    <div class="shcat-body">
      <section class="shcat-form">
        <div class="shcat-identity">
          <button type="button" class="shcat-emoji-btn" data-sh-action="catToggleEmoji" aria-label="Choisir l’icône" aria-expanded="${state.emojiOpen}">${_esc(_catEditorEmoji(state))}</button>
          <label class="shcat-name"><small>${state.id ? 'Modifier la catégorie' : 'Nouvelle catégorie'}</small>
            <input id="shcat-name" maxlength="40" placeholder="Nom de la catégorie" value="${_esc(state.nom)}" autocomplete="off" data-sh-action="catName" data-sh-on="input" data-modal-initial-focus>
            <span class="shcat-error" role="alert">${_esc(state.error || '')}</span>
          </label>
          <button type="button" class="shcat-close" data-sh-action="catClose" aria-label="Fermer (Échap)">${_shopIcon('x', 'shcat-icon')}</button>
          <div class="shcat-emoji-popover"${state.emojiOpen ? '' : ' hidden'}>
            <h4>Icône${state.emoji ? '' : ' · auto d’après le nom'}</h4>
            <div class="shcat-emoji-grid">${CAT_EDITOR_EMOJIS.map(emoji => `<button type="button" data-sh-action="catEmoji" data-value="${emoji}" class="${emoji === _catEditorEmoji(state) ? 'is-on' : ''}" aria-label="Choisir ${emoji}">${emoji}</button>`).join('')}</div>
            <div class="shcat-emoji-own"><input maxlength="8" placeholder="Ou colle un emoji…" data-sh-action="catEmojiOwn" data-sh-on="input"><button type="button" class="shcat-btn" data-sh-action="catEmojiAuto">Auto</button></div>
          </div>
        </div>
        <section class="shcat-field"><div class="shcat-field-label"><b>Couleur</b><small>teinte le rail, l’étagère et les cartes d’articles</small></div>
          <div class="shcat-swatches">${CAT_EDITOR_COLORS.map(color => `<button type="button" style="--swatch:${color}" class="${state.couleur === color ? 'is-on' : ''}" data-sh-action="catColor" data-value="${color}" aria-label="Couleur ${color}" aria-pressed="${state.couleur === color}"></button>`).join('')}
            <button type="button" class="is-none${state.couleur ? '' : ' is-on'}" data-sh-action="catColor" data-value="" aria-label="Aucune couleur" aria-pressed="${!state.couleur}"></button>
            <label class="shcat-custom-color" title="Couleur personnalisée"${state.couleur && !CAT_EDITOR_COLORS.includes(state.couleur) ? ` style="background:${_esc(state.couleur)};color:#fff"` : ''}>${_shopIcon('plus', 'shcat-icon')}<input type="color" value="${_esc(state.couleur || '#4f8cff')}" data-sh-action="catCustomColor" data-sh-on="change" aria-label="Choisir une couleur personnalisée"></label>
          </div>
        </section>

        <section class="shcat-field"><div class="shcat-field-label"><b>Type par défaut</b><small>pré-rempli à la création d’un article dans cette catégorie</small></div>
          <div class="shcat-types">${Object.keys(TEMPLATES).map(key => { const parts = _catTemplateParts(key); return `<button type="button" data-sh-action="catTemplate" data-value="${key}" class="${state.template === key ? 'is-on' : ''}" aria-pressed="${state.template === key}"><span>${parts.emoji}</span>${_esc(parts.label)}</button>`; }).join('')}</div>
          <div class="shcat-template-fields"><span>Champs proposés :</span>${template.fields.map(field => `<em>${_esc(field.label)}</em>`).join('')}</div>
        </section>

        <section class="shcat-field"><div class="shcat-field-label"><b>Illustration</b><small>optionnelle · fond de la catégorie sur l’accueil</small></div>
          <div class="shcat-drop${state.image ? ' has-image' : ''}" tabindex="0" role="button" data-sh-action="catImageZone" aria-label="${state.image ? 'Cliquer pour placer le point focal' : 'Ajouter une illustration'}">
            ${state.image ? `<img src="${_esc(state.image)}" alt="" style="object-position:${focus.x}% ${focus.y}%"><span class="shcat-focus" style="left:${focus.x}%;top:${focus.y}%"></span>
              <div class="shcat-image-actions"><button type="button" data-sh-action="catPickImage">${_shopIcon('swap', 'shcat-icon')} Remplacer</button><button type="button" data-sh-action="catRemoveImage">${_shopIcon('trash', 'shcat-icon')} Retirer</button></div><span class="shcat-image-tip">Clique pour cadrer</span>`
              : `<p>${_shopIcon('image', 'shcat-image-icon')}<span>Glisse une image, colle-la (<kbd>Ctrl</kbd>+<kbd>V</kbd>) ou clique</span><small>JPG, PNG, WebP · recadrée en 16:9</small></p>`}
          </div><input type="file" id="shcat-file" accept="image/*" hidden data-sh-action="catImageFile" data-sh-on="change">
        </section>

        <section class="shcat-field"><div class="shcat-field-label"><b>Visibilité</b></div><div class="shcat-visibility">
          <button type="button" data-sh-action="catVisibility" data-hidden="false" class="${state.masquee ? '' : 'is-on'}" aria-pressed="${!state.masquee}">${_shopIcon('eye', 'shcat-icon')}<span><b>Visible</b><small>Les joueurs la voient en boutique</small></span></button>
          <button type="button" data-sh-action="catVisibility" data-hidden="true" class="is-hidden${state.masquee ? ' is-on' : ''}" aria-pressed="${state.masquee}">${_shopIcon('eyeOff', 'shcat-icon')}<span><b>Masquée</b><small>MJ seulement · butin et revente disponibles</small></span></button>
        </div></section>
      </section>
    </div>
    <footer class="shcat-footer">${state.deleting ? _catDeleteFooterHtml(state) : `${state.id ? `<button type="button" class="ghost shcat-delete-arm" data-sh-action="catDeleteArm">${_shopIcon('trash', 'shcat-icon')} Supprimer</button>` : ''}<span class="shcat-footer-spacer"></span>${dirty ? '<span class="shcat-dirty"><i></i>Modifications non enregistrées</span>' : ''}<button type="button" class="ghost" data-sh-action="catClose">Annuler</button><button type="button" class="primary" data-sh-action="saveCat"${state.id && !dirty ? ' disabled' : ''}>${state.id ? 'Enregistrer' : 'Créer la catégorie'} <kbd>Ctrl ↵</kbd></button>`}</footer>
  </div>`;
}

function _bindCatEditorDom() {
  const drop = document.querySelector('.shcat-drop');
  if (!drop || drop.dataset.bound === 'true') return;
  drop.dataset.bound = 'true';
  drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('is-dragging'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
  drop.addEventListener('drop', event => {
    event.preventDefault(); drop.classList.remove('is-dragging');
    _catLoadImage([...event.dataTransfer?.files || []].find(file => file.type?.startsWith('image/')));
  });
}

function _renderCatEditor({ focusId = '', selection = null } = {}) {
  if (!_catEditorState) return;
  updateModalContent('', _catEditorHtml());
  _bindCatEditorDom();
  if (focusId) requestAnimationFrame(() => {
    const input = document.getElementById(focusId);
    input?.focus({ preventScroll: true });
    if (selection != null && input?.setSelectionRange) input.setSelectionRange(selection, selection);
  });
}

function openCatModal(catId) {
  const cat = catId ? _cats.find(entry => entry.id === catId) : null;
  const focus = _catImageFocus(cat || {});
  _catEditorState = {
    id: cat?.id || '', nom: cat?.nom || '', emoji: cat?.emoji || '', couleur: cat?.couleur || (cat ? '' : '#4f8cff'),
    template: _normalizeShopTemplate(cat?.template), templateAuto: !cat,
    image: cat?.image || '', imageFocus: focus, masquee: !!cat?.masquee,
    emojiOpen: false, deleting: false, destination: '', error: '',
  };
  _catEditorState.original = JSON.stringify(_catEditorPersisted(_catEditorState));
  openModal('', _catEditorHtml());
  setModalCloseGuard(() => {
    if (!_catEditorState || !_catEditorDirty()) { _catEditorState = null; return false; }
    const guardedState = _catEditorState;
    confirmModal('Fermer sans enregistrer les modifications ?', { title: 'Modifications non enregistrées', confirmLabel: 'Fermer', danger: true }).then(ok => {
      if (!ok || _catEditorState !== guardedState) return;
      _catEditorState = null; clearModalCloseGuard(); closeModalDirect();
    });
    return true;
  });
  _bindCatEditorDom();
}

function _catClose() {
  closeModalDirect();
}

async function saveCat() {
  const state = _catEditorState;
  if (!state) return false;
  try {
    const nom = state.nom.trim();
    if (!nom) {
      state.error = 'Donne un nom à la catégorie.';
      _renderCatEditor({ focusId: 'shcat-name' });
      return false;
    }
    if (_cats.some(cat => cat.id !== state.id && _norm(cat.nom) === _norm(nom))) {
      state.error = 'Une catégorie porte déjà ce nom.';
      _renderCatEditor({ focusId: 'shcat-name' });
      return false;
    }
    const data = { ..._catEditorPersisted(state), nom, emoji: state.emoji || _catEmoji(nom) };
    if (state.id) await updateInCol('shopCategories', state.id, data);
    else await addToCol('shopCategories', { ...data, ordre: _cats.length, sousCats: [] });
    const edited = state.id ? _cats.find(cat => cat.id === state.id) : null;
    if (edited) Object.assign(edited, data);
    _catEditorState = null; clearModalCloseGuard(); closeModalDirect();
    showNotif(state.id ? 'Catégorie mise à jour.' : 'Catégorie créée !', 'success'); renderShop();
    return true;
  } catch (error) { notifySaveError(error); return false; }
}

async function _catBatchMove(items, categorieId) {
  const updates = items.map(item => ({ col: 'shop', id: item.id, data: { categorieId } }));
  for (let index = 0; index < updates.length; index += 450) await batchUpdateInCol(updates.slice(index, index + 450));
  items.forEach(item => { item.categorieId = categorieId; });
}

async function deleteCat(catId, { destination = '', confirmed = false } = {}) {
  try {
    const cat = _cats.find(entry => entry.id === catId);
    if (!cat) return false;
    const affected = _items.filter(item => item.categorieId === catId);
    const n = affected.length;
    const message = n > 0
      ? `Supprimer cette catégorie ? Ses ${n} article${n > 1 ? 's' : ''} passeront dans « Non classé » et ne seront pas supprimés.`
      : 'Supprimer cette catégorie ?';
    if (!confirmed && !await confirmModal(message, { title: 'Confirmation de suppression', confirmLabel: 'Supprimer', danger: true })) return false;
    const validDestination = destination && _cats.some(entry => entry.id === destination && entry.id !== catId) ? destination : '';
    if (affected.length) await _catBatchMove(affected, validDestination);
    const deleted = await confirmDelete('shopCategories', catId, message, {
      confirmed: true,
      snapshot: cat,
      title: 'Confirmation de suppression',
      successMessage: n > 0 ? `Catégorie supprimée · ${n} article${n > 1 ? 's' : ''} conservé${n > 1 ? 's' : ''}.` : 'Catégorie supprimée.',
      onRestore: async () => { if (affected.length) await _catBatchMove(affected, catId); renderShop(); },
    });
    if (!deleted) {
      if (affected.length) await _catBatchMove(affected, catId);
      return false;
    }
    if(_activeCat===catId){_view='home';_activeCat=null;}
    if (_catEditorState?.id === catId) { _catEditorState = null; clearModalCloseGuard(); closeModalDirect(); }
    renderShop();
    return true;
  } catch (error) { notifySaveError(error); return false; }
}

function _catEditorMutate(mutator, options = {}) {
  if (!_catEditorState) return;
  mutator(_catEditorState);
  _renderCatEditor(options);
}

function _catNameInput(input) {
  if (!_catEditorState) return;
  _catEditorState.nom = input.value;
  _catEditorState.error = '';
  if (_catEditorState.templateAuto) {
    const guessed = _catGuessTemplate(input.value);
    if (guessed) _catEditorState.template = guessed;
  }
  _renderCatEditor({ focusId: 'shcat-name', selection: input.selectionStart });
}

function _catReadFile(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

async function _catLoadImage(file) {
  if (!_catEditorState || !file) return;
  if (!file.type?.startsWith('image/')) { showNotif('Choisis un fichier image.', 'error'); return; }
  const dataUrl = await _catReadFile(file);
  if (!dataUrl || !_catEditorState) return;
  _catEditorState.image = await compressDataUrl(dataUrl, { max: 1200, quality: 0.78 });
  _catEditorState.imageFocus = { x: 50, y: 50 };
  _renderCatEditor();
}

function _shopCatPaste(event) {
  if (!_catEditorState || !document.querySelector('.shcat')) return;
  const file = [...event.clipboardData?.files || []].find(entry => entry.type?.startsWith('image/'));
  if (!file) return;
  event.preventDefault();
  _catLoadImage(file);
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

const _SHOP_EDITOR_RELATION_COLORS = {
  resistances: '#4f8cff',
  immunites: '#22c38e',
  absorptions: '#9d6fff',
  faiblesses: '#ff5a7e',
};

function _shopEditorRelationColor(key) {
  return _SHOP_EDITOR_RELATION_COLORS[key] || DAMAGE_RELATIONS.find(rel => rel.key === key)?.color || 'transparent';
}

function _shopRenderDamageProfileSection(item) {
  const prof  = item?.damageProfile || {};
  const types = _shopDamageTypes;
  const rows = !types
    ? loadingHtml('Chargement des types de dégâts…', { compact: true })
    : (() => {
        const byType = damageProfileToRelations(prof);
        return types.map(type => {
          const selected = DAMAGE_RELATIONS.find(rel => byType[type.id] === rel.key);
          const selectedColor = _shopEditorRelationColor(selected?.key);
          return `<div class="sh-dmgprof-row si-dmgprof-type" style="--row-rel:${selectedColor};--row-bg:${selected ? `${selectedColor}18` : 'transparent'}">
          <div class="sh-dmgprof-head"><span>${type.icon || '◆'}</span><span>${_esc(type.label)}</span></div>
          <div class="sh-dmgprof-chips">${['resistances','immunites','absorptions','faiblesses'].map(key => DAMAGE_RELATIONS.find(rel => rel.key === key)).filter(Boolean).map(rel => {
            const on = byType[type.id] === rel.key;
            const short = ({ resistances:'Rés.', immunites:'Imm.', absorptions:'Abs.', faiblesses:'Faib.' })[rel.key];
            return `<button type="button" class="sh-dmgprof-chip${on ? ' is-on' : ''}" style="--rel:${_shopEditorRelationColor(rel.key)}" data-sh-action="toggleDmgProfile" data-rel="${rel.key}" data-tid="${type.id}" aria-pressed="${on}" title="${_esc(rel.label)} · ${_esc(rel.shortLabel)}">${short}</button>`;
          }).join('')}</div>
        </div>`;
        }).join('');
      })();
  return `<div class="sh-dmgprof sh-field-full">
    <div class="sh-dmgprof-title">Résistances accordées <span class="sh-dmgprof-sub">un seul effet par type · Immunité &gt; Absorption &gt; Faiblesse &gt; Résistance</span></div>
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
  const color = _shopEditorRelationColor(rel?.key);
  document.querySelectorAll(`.sh-dmgprof-chip[data-tid="${CSS.escape(btn.dataset.tid || '')}"]`).forEach(other => {
    other.classList.remove('is-on'); other.setAttribute('aria-pressed', 'false');
  });
  btn.classList.toggle('is-on', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  const row = btn.closest('.si-dmgprof-type');
  row?.style.setProperty('--row-rel', on && rel ? color : 'transparent');
  row?.style.setProperty('--row-bg', on && rel ? `${color}18` : 'transparent');
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
  const sign = '';
  const col = v > 0 ? '#22c38e' : v < 0 ? '#ef4444' : 'var(--text-dim)';
  return `<span class="sh-skill-chip" data-skill="${_esc(skillName)}" data-val="${v}"
      style="display:inline-flex;align-items:center;gap:.35rem;padding:.25rem .55rem;
             background:rgba(255,255,255,.05);border:1px solid var(--border);border-radius:999px;
             font-size:.78rem;font-weight:600">
      <span>${_esc(skillName)}</span>
      <input type="number" value="${sign}${v}" min="-10" max="10" aria-label="Bonus de ${_esc(skillName)}" data-sh-action="skillValue" data-sh-on="input">
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
  const list = document.getElementById('si-skill-options');
  if (picker.tagName === 'INPUT' && list) {
    list.innerHTML = skills.filter(sk => !used.has(sk.name))
      .map(sk => `<option value="${_esc(sk.name)}">${_esc(sk.name)}${sk.stat ? ` (${sk.stat})` : ''}</option>`).join('');
    picker.placeholder = skills.length ? '＋ Compétence… (Entrée)' : 'Aucune compétence configurée';
    return;
  }
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
  const val = parseInt(valInp?.value || '1');
  if (!skillName) { showNotif('Choisis une compétence', 'warning'); return; }
  if (!Number.isFinite(val) || val === 0) { showNotif('Valeur invalide (≠ 0)', 'warning'); return; }
  // Ajoute la chip dans le container
  const chips = document.getElementById('si-skill-chips');
  const empty = chips?.querySelector('.sh-skill-empty');
  if (empty) empty.remove();
  chips?.insertAdjacentHTML('beforeend', _shopRenderSkillChipHTML(skillName, val));
  // Retire l'option du picker
  picker.querySelector?.(`option[value="${skillName}"]`)?.remove();
  document.getElementById('si-skill-options')?.querySelector(`option[value="${CSS.escape(skillName)}"]`)?.remove();
  picker.value = '';
  if (valInp) valInp.value = '1';
}

/** Retire un bonus de compétence. */
function removeSkillBonus(skillName) {
  const chips = document.getElementById('si-skill-chips');
  const chip = chips?.querySelector(`.sh-skill-chip[data-skill="${CSS.escape(skillName)}"]`);
  chip?.remove();
  // Réinjecte dans le picker (au bon endroit alphabétique, avec sa stat)
  const picker = document.getElementById('si-skill-picker');
  if (picker?.tagName === 'SELECT' && _shopDiceSkillsCache) {
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
  const actionType = act?.actionType === 'bonus' ? 'Action bonus' : act?.actionType === 'reaction' ? 'Réaction' : 'Action';
  const cost = act?.cout || `${act?.pmOverride ?? act?.pm ?? 0} PM · ${actionType}`;
  const summary = act?.resume || act?.description || act?.effet || act?.degats || 'Action d’objet';
  return `<div class="si-action-card">
    <span class="si-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M13 3 5 14h6l-1 7 8-11h-6z"></path></svg></span>
    <div><b>${_esc(act?.nom || 'Sans nom')}</b><small>${_esc(cost)} · ${_esc(summary)}</small></div>
    <button type="button" class="si-action-edit" data-sh-action="editAction" data-idx="${idx}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"></path><path d="m13.5 6.5 4 4"></path></svg><span>Modifier</span></button>
    <button type="button" class="si-action-remove" data-sh-action="removeAction" data-idx="${idx}" aria-label="Supprimer l’action"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"></path></svg></button>
  </div>`;
}


function _shopRenderActionsSection(actions) {
  // Init le cache si pas déjà fait (premier render)
  if (actions && _shopActionsCache.length === 0 && Array.isArray(actions) && actions.length) {
    _shopActionsCacheLoad(actions);
  }
  // Précharge la lib des états (utile pour l'éditeur de sort)
  _shopEnsureConditions();
  const list = _shopActionsCache;
  return `<div id="si-actions-list" class="si-actions-list">
    ${list.map((a, i) => _shopRenderActionCard(a, i)).join('')}
    <button type="button" class="si-action-new" data-sh-action="addAction"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg><strong>Nouvelle action</strong><small>ouvre l’éditeur de sort</small></button>
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
  _siRefreshLive();
}

/** Hook commun appelé par la modal de sort après save : met à jour le cache. */
async function _shopActionsOnSave(itemSnapshot) {
  // editItemSpell passe l'item avec son nouveau item.actions. On synchronise le cache.
  _shopActionsCache = Array.isArray(itemSnapshot?.actions)
    ? itemSnapshot.actions.map(a => ({ ...a })) : [];
  _shopRefreshActionsHost();
  setTimeout(() => { _siBindEditor(); _siRefreshLive(); }, 0);
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
// ÉDITEUR D'ARTICLE « ÉTABLI » — page unique, sommaire et aperçu temps réel.
// Les IDs historiques restent inchangés : saveShopItem conserve son schéma.
// ══════════════════════════════════════════════════════════════════════════════

const _SI_SECTIONS = {
  arme:      ['identite', 'combat', 'bonus', 'traits', 'actions', 'commerce', 'lecture'],
  armure:    ['identite', 'combat', 'bonus', 'traits', 'actions', 'commerce', 'lecture'],
  bijou:     ['identite', 'combat', 'bonus', 'traits', 'actions', 'commerce', 'lecture'],
  classique: ['identite', 'description', 'actions', 'commerce', 'lecture'],
};

const _SI_SECTION_DEF = {
  identite:    { label: 'Identité', icon: '◆', hint: 'Nom, catégorie, rareté' },
  combat:      { label: 'Combat', icon: '⚔', hint: '' },
  bonus:       { label: 'Bonus & résistances', icon: '✦', hint: 'Quand l’objet est équipé', optional: true },
  traits:      { label: 'Traits', icon: '◇', hint: 'Propriétés textuelles', optional: true },
  actions:     { label: 'Actions', icon: 'ϟ', hint: 'Utilisables depuis l’inventaire', optional: true },
  description: { label: 'Description', icon: '≡', hint: 'Effet visible en boutique', optional: true },
  commerce:    { label: 'Vente & visibilité', icon: '◉', hint: 'Prix, stock, drapeaux' },
  lecture:     { label: 'Texte à lire', icon: '▤', hint: 'Livre, lettre, notes', optional: true },
};

let _siEditorState = null;

function _siClone(value) {
  try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value || {})); }
}

function _siBuildFieldsSubset(tpl, item, fieldIds) {
  if (!fieldIds?.length) return '';
  const subTpl = { ...tpl, fields: tpl.fields.filter(f => fieldIds.includes(f.id)) };
  if (!subTpl.fields.length) return '';
  return _buildFieldsHtml(subTpl, item);
}

function _siTemplateButtonHtml(key, active) {
  return `<button type="button" class="${key === active ? 'is-on' : ''}" data-sh-action="setItemTemplate" data-value="${key}">${TEMPLATES[key]?.label || key}</button>`;
}

function _siIdentityHtml(item, tplKey) {
  const defCatId = item?.categorieId || '';
  const cats = _cats.map(c => `<option value="${c.id}" ${defCatId === c.id ? 'selected' : ''}>${_esc(c.nom)}</option>`).join('');
  const rarities = getRarities();
  const rarity = parseInt(item?.rarete, 10) || 0;
  const rarityColor = rarities.find(entry => entry.value === rarity)?.color || 'var(--text)';
  const img = item?.image
    ? `<img src="${_esc(item.image)}" alt="Aperçu de ${_esc(item.nom || 'l’article')}">`
    : `<span class="si-img-placeholder">▧</span>`;
  return `<div class="si-identity-grid">
    <label class="si-img-btn" title="Changer l’image">
      <input type="file" id="si-img-file" accept="image/*" data-sh-action="uploadImg" data-sh-on="change" data-preview="si-img-preview-thumb" data-hidden="si-img-b64" hidden>
      <input type="hidden" id="si-img-b64" value="${_esc(item?.image || '')}">
      <div id="si-img-preview-thumb" class="si-img-thumb">${img}</div>
      <span>Image</span>
    </label>
    <div class="si-identity-main">
      <input class="input-field si-name-input" id="si-nom" style="--si-rarity:${rarityColor}" value="${_esc(item?.nom || '')}" placeholder="Nom de l’article…" aria-label="Nom de l’article">
      <div class="si-field si-template-picker"><span>Type d’article</span><div>${Object.keys(TEMPLATES).map(key => _siTemplateButtonHtml(key, tplKey)).join('')}</div><input type="hidden" id="si-template" value="${tplKey}"></div>
      <div class="si-identity-bottom">
        <label class="si-field"><span>Catégorie</span><select class="input-field sh-modal-select" id="si-cat" data-sh-action="setItemCat" data-sh-on="change"><option value="">— Catégorie —</option>${cats}</select></label>
        <div class="si-field"><span>Rareté</span><div class="si-rarity-row" id="si-rarity-row">
          <input type="hidden" id="si-rarete" value="${rarity}">
          ${rarities.map(r => `<button type="button" class="${rarity === r.value ? 'is-on' : ''}" style="--si-rarity:${r.color}" data-sh-action="editorRarity" data-value="${r.value}"><i></i>${_esc(r.name)}</button>`).join('')}
        </div></div>
      </div>
    </div>
  </div>`;
}

function _siWeaponCombatHtml(item) {
  const currentFormat = resolveWeaponFamily(_weaponFormats, item || {})?.label || item?.format || '';
  const known = _weaponFormats.some(format => format.label === currentFormat);
  const hands = item?.mains || (item ? weaponHandsLabel(item) : '');
  const nature = item?.nature || '';
  const damageStats = _getDegatsStats(item || {});
  const toucher = _normalizeStatKey(item?.toucherStat || item?.toucher || item?.statAttaque || '');
  const segment = (field, selected, values) => `<select id="si-${field}" hidden><option value=""></option>${values.map(([value, label]) => `<option value="${_esc(value)}" ${selected === value ? 'selected' : ''}>${_esc(label)}</option>`).join('')}</select><div class="si-segment">${values.map(([value, label]) => `<button type="button" class="${selected === value ? 'is-on' : ''}" data-sh-action="editorSelect" data-field="${field}" data-value="${_esc(value)}">${_esc(label)}</button>`).join('')}</div>`;
  const statButtons = (selectedKeys, action, single = false) => `<div class="si-segment si-segment--stats">${ITEM_STATS.map(stat => `<button type="button" class="${selectedKeys.includes(stat.key) ? 'is-on' : ''}" data-sh-action="${action}" data-field="${single ? 'toucherStat' : ''}" data-value="${stat.key}">${stat.short}</button>`).join('')}</div>`;
  return `<div class="si-combat-grid">
    <label class="si-field"><span>Type d’arme</span><select class="input-field sh-modal-select" id="si-format" data-sh-action="weaponTypeDefaults" data-sh-on="change"><option value="">— Choisir —</option>${!known && currentFormat ? `<option value="${_esc(currentFormat)}" selected>${_esc(currentFormat)} (ancien)</option>` : ''}${_weaponFormats.map(format => `<option value="${_esc(format.label)}" ${currentFormat === format.label ? 'selected' : ''}>${_esc(format.label)}</option>`).join('')}</select></label>
    <div class="si-field"><span>Maniement</span>${segment('mains', hands, [['1 main','1 main'],['2 mains','2 mains'],['Polyvalente','Polyvalente']])}</div>
    <div class="si-field"><span>Nature</span>${segment('nature', nature, [['','Auto'],['Physique','Physique'],['Magique','Magique']])}</div>
    <div class="si-field si-combat-damage"><span>Dégâts</span><div class="si-damage-line"><input class="input-field" id="si-degats" value="${_esc(item?.degats || '')}" placeholder="1d8"><b>＋</b><input type="hidden" id="si-degats-stats-data" value="${_esc(JSON.stringify(damageStats))}">${statButtons(damageStats, 'editorDamageStat')}</div></div>
    <div class="si-field si-combat-touch"><span>Toucher</span>${statButtons(toucher ? [toucher] : [], 'editorSelect', true)}</div>
    <label class="si-field si-combat-range"><span>Portée</span><input class="input-field" id="si-portee" value="${_esc(item?.portee || '')}" placeholder="Contact"></label>
  </div>`;
}

function _siBonusCount(item = {}) {
  const stats = ITEM_STATS.reduce((sum, stat) => sum + Math.abs(Number(item?.[stat.store]) || 0), 0);
  const derived = ['caBonus','pvMaxBonus','pmMaxBonus','vitesseBonus','initiativeBonus'].reduce((sum, key) => sum + Math.abs(Number(item?.[key]) || 0), 0);
  const skills = Object.values(item?.skillBonuses || {}).reduce((sum, value) => sum + Math.abs(Number(value) || 0), 0);
  const relations = Object.values(item?.damageProfile || {}).reduce((sum, values) => sum + (Array.isArray(values) ? values.length : 0), 0);
  return stats + derived + skills + relations;
}

function _siStepperHtml(label, field, value) {
  const num = Number(value) || 0;
  return `<div class="si-stepper${num > 0 ? ' is-positive' : num < 0 ? ' is-negative' : ''}"><span>${label}</span><button type="button" data-sh-action="editorStep" data-field="${field}" data-delta="-1">−</button><input type="number" id="si-${field}" value="${num}"><button type="button" data-sh-action="editorStep" data-field="${field}" data-delta="1">＋</button></div>`;
}

function _siBonusHtml(item) {
  const parsed = _parseLegacyStats(item || {});
  const skillBonuses = item?.skillBonuses || {};
  const chips = Object.entries(skillBonuses).filter(([, value]) => Number(value)).map(([name, value]) => _shopRenderSkillChipHTML(name, value)).join('');
  setTimeout(() => _shopPopulateSkillPicker(skillBonuses).catch(() => {}), 0);
  return `<div class="si-bonus-columns">
    <div><h4>Attributs</h4><div class="si-bonus-grid">${ITEM_STATS.map(stat => _siStepperHtml(stat.short, stat.store, parsed[stat.store])).join('')}</div></div>
    <div><h4>Dérivés</h4><div class="si-bonus-grid">${[
      ['CA','caBonus'],['PV','pvMaxBonus'],['PM','pmMaxBonus'],['Vit','vitesseBonus'],['Init','initiativeBonus'],
    ].map(([label, field]) => _siStepperHtml(label, field, item?.[field])).join('')}</div></div>
  </div>
  <div class="si-bonus-skills"><h4>Compétences</h4><div id="si-skill-chips" class="sh-skill-chips">${chips}</div><div class="si-skill-add"><input class="input-field" id="si-skill-picker" list="si-skill-options" placeholder="＋ Compétence… (Entrée)"><datalist id="si-skill-options"></datalist><input type="hidden" id="si-skill-val" value="1"></div></div>
  ${_shopRenderDamageProfileSection(item)}`;
}

function _siMetaHtml(item, tplKey) {
  const recipeChk = item?.hasRecipe != null ? !!item.hasRecipe : (item ? !item?.recipeMeta?.hidden : ['arme', 'armure', 'bijou'].includes(tplKey));
  const newUntilMs = _itemNewUntilMs(item);
  const newActive = item ? (newUntilMs > Date.now() || item.isNew === true) : true;
  const flag = (id, title, hint, checked) => `<label class="si-flag${checked ? ' is-on' : ''}"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><i></i><span><b>${title}</b><small>${hint}</small></span></label>`;
  return `<div class="si-meta-grid">
    ${flag('si-masque', 'Masqué aux joueurs', 'Visible uniquement du MJ et récupérable en butin.', !!item?.masque)}
    ${flag('si-new', 'Nouveauté', 'Présent dans le filtre Nouveautés pendant deux semaines.', newActive)}
    ${flag('si-has-recipe', 'Recette d’artisanat', 'Permet la fabrication via l’Artisan.', recipeChk)}
  </div>`;
}

function _siCommerceHtml(item, tplKey) {
  const price = Math.max(0, Number(item?.prix) || 0);
  const rawStock = Number(item?.dispo);
  const infinite = item?.dispo == null || rawStock < 0;
  const stock = infinite ? '' : Math.max(0, Math.trunc(rawStock));
  return `<div class="si-commerce-fields">
    <label class="si-field si-commerce-price"><span>Prix d’achat</span>
      <div><input type="number" id="si-prix" value="${price || ''}" min="0" inputmode="numeric" data-sh-action="prixInput" data-sh-on="input"><b>po</b></div>
      <small>Rachat : <strong id="si-pv-val">${Math.round(price * PRIX_VENTE_RATIO)}</strong> po (60 %)</small>
    </label>
    <div class="si-field si-commerce-stock"><span>Stock</span><div>
      <div class="si-stock-stepper${infinite ? ' is-disabled' : ''}">
        <button type="button" data-sh-action="editorStep" data-field="dispo" data-delta="-1" ${infinite ? 'disabled' : ''}>−</button>
        <input type="number" id="si-dispo" value="${stock}" min="0" inputmode="numeric" ${infinite ? 'disabled' : ''}>
        <button type="button" data-sh-action="editorStep" data-field="dispo" data-delta="1" ${infinite ? 'disabled' : ''}>＋</button>
      </div>
      <input type="checkbox" id="si-dispo-infini" ${infinite ? 'checked' : ''} hidden>
      <button type="button" id="si-dispo-infini-btn" class="si-infinite-toggle${infinite ? ' is-on' : ''}" data-sh-action="dispoInfiniBtn" aria-pressed="${infinite}"><i></i><span>∞ Illimité</span></button>
    </div></div>
  </div>${_siMetaHtml(item, tplKey)}`;
}

function _siSectionBody(section, tpl, item, tplKey) {
  if (section === 'identite') return _siIdentityHtml(item, tplKey);
  if (section === 'combat') {
    const prefill = _siEditorState?.prefill;
    const fields = tplKey === 'armure' ? ['slotArmure', 'typeArmure', 'ca'] : ['slotBijou'];
    const body = tplKey === 'arme' ? _siWeaponCombatHtml(item) : _siBuildFieldsSubset(tpl, item, fields);
    return `${prefill ? `<div class="si-prefill">✓ ${_esc(prefill.label)} a pré-rempli ${prefill.fields.map(_esc).join(', ')}.<button type="button" data-sh-action="editorUndoPrefill">Annuler</button></div>` : ''}${body}`;
  }
  if (section === 'bonus') return _siBonusHtml(item);
  if (section === 'traits') return _siBuildFieldsSubset(tpl, item, ['traits']);
  if (section === 'description') return _siBuildFieldsSubset(tpl, item, ['type', 'effet', 'description']);
  if (section === 'actions') {
    return `<input type="checkbox" id="si-consommable" ${item?.consommable ? 'checked' : ''} hidden>
    <button type="button" class="si-consumable-toggle${item?.consommable ? ' is-on' : ''}" data-sh-action="editorToggleConsumable" aria-pressed="${!!item?.consommable}"><i></i><span><b>Objet consommable</b> — perd 1 exemplaire à chaque utilisation</span></button>
    <div id="si-actions-host">${_shopRenderActionsSection(item?.actions)}</div>`;
  }
  if (section === 'commerce') return _siCommerceHtml(item, tplKey);
  if (section === 'lecture') {
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
  return '';
}

function _siSectionHasContent(section, item = {}) {
  if (section === 'bonus') return ITEM_STATS.some(s => Number(item?.[s.store]))
    || ['pvMaxBonus','pmMaxBonus','vitesseBonus','initiativeBonus','caBonus'].some(k => Number(item?.[k]))
    || Object.values(item?.skillBonuses || {}).some(Number)
    || Object.values(item?.damageProfile || {}).some(a => Array.isArray(a) && a.length);
  if (section === 'traits') return Array.isArray(item?.traits) && item.traits.some(Boolean);
  if (section === 'actions') return !!item?.consommable || (item?.actions?.length || _shopActionsCache.length) > 0;
  if (section === 'description') return !!String(item?.effet || item?.description || item?.type || '').trim();
  if (section === 'lecture') return !!String(item?.readableTitle || '').trim() || !!sanitizeRichTextHtml(item?.readableContent || '').replace(/<[^>]*>/g, '').trim();
  return true;
}

function _siSectionStatus(section, item) {
  if (section === 'identite' && !String(item?.nom || '').trim()) return { cls: 'req', text: 'Nom requis' };
  if (section === 'combat' && item?.template === 'arme' && !item?.degats) return { cls: 'warn', text: 'Dégâts à définir' };
  if (section === 'commerce' && !(Number(item?.prix) > 0)) return { cls: 'warn', text: 'Prix à définir' };
  return _siSectionHasContent(section, item) ? { cls: 'ok', text: 'Renseigné' } : { cls: '', text: 'Facultatif' };
}

function _siSectionSummary(section, item = {}) {
  if (section === 'identite') return RARETE_NAMES[parseInt(item.rarete, 10) || 0] || '';
  if (section === 'combat') return item.template === 'arme' ? item.degats || '' : item.template === 'armure' ? (item.ca ? `CA ${item.ca}` : '') : item.slotBijou || '';
  if (section === 'bonus') { const count = _siBonusCount(item); return count ? `${count} bonus` : ''; }
  if (section === 'traits') {
    const count = Array.isArray(item.traits) ? item.traits.filter(Boolean).length : 0;
    return count ? `${count} trait${count > 1 ? 's' : ''}` : '';
  }
  if (section === 'actions') {
    const count = _shopActionsCache.length || (Array.isArray(item.actions) ? item.actions.length : 0);
    return count ? `${count} action${count > 1 ? 's' : ''}` : '';
  }
  if (section === 'commerce') {
    const stock = Number(item.dispo);
    return `${Math.max(0, Number(item.prix) || 0)} po · ${item.dispo == null || stock < 0 ? '∞' : `×${Math.max(0, Math.trunc(stock))}`}`;
  }
  return '';
}

function _siSectionHtml(section, tpl, item, tplKey, index) {
  const def = _SI_SECTION_DEF[section];
  const has = _siSectionHasContent(section, item);
  const open = !def.optional || has || _siEditorState?.open?.has(section);
  const status = _siSectionStatus(section, item);
  const summary = _siSectionSummary(section, item);
  return `<section class="si-section${open ? '' : ' is-closed'}" id="si-section-${section}" data-si-section="${section}">
    <header class="si-section-head"><div><h3>${def.label}</h3>${def.hint ? `<small>${def.hint}</small>` : ''}</div><strong class="si-section-summary" ${summary ? '' : 'hidden'}>${_esc(summary)}</strong><span class="si-section-state ${status.cls}" ${summary ? 'hidden' : ''}>${status.text}</span>
      ${!open ? `<button type="button" class="si-section-add" data-sh-action="editorOpenSection" data-section="${section}">＋ Ajouter</button>` : ''}
    </header>
    ${open ? `<div class="si-section-body">${_siSectionBody(section, tpl, item, tplKey)}</div>` : ''}
  </section>`;
}

function _siNavHtml(sections, item) {
  return `${sections.map((section, index) => {
    const def = _SI_SECTION_DEF[section];
    const status = _siSectionStatus(section, item);
    return `<button type="button" class="si-nav-row${index === 0 ? ' is-on' : ''}" data-sh-action="editorGoSection" data-section="${section}" title="Alt + ${index + 1}"><i class="${status.cls}"></i><span><b>${def.label}</b><small>${status.text}</small></span></button>`;
  }).join('')}<div class="si-nav-shortcuts"><span><kbd>Alt</kbd><i>+</i><kbd>1–${sections.length}</kbd> Aller à une section</span><span><kbd>Alt</kbd><i>+</i><kbd>Q</kbd> Saisie rapide</span><span><kbd>Ctrl</kbd><i>+</i><kbd>↵</kbd> Enregistrer</span></div>`;
}

function _siPreviewHtml(item) {
  const rarity = parseInt(item?.rarete, 10) || 0;
  const rarityName = RARETE_NAMES[rarity] || 'Sans rareté';
  const rarityColor = _rareteColor(rarityName) || 'var(--text-muted)';
  const tpl = item?.template || 'classique';
  const stock = Number(item?.dispo);
  const signed = value => `${Number(value) > 0 ? '+' : ''}${Number(value) || 0}`;
  const damageStats = _getDegatsStats(item || {});
  let subtype = [];
  let mainValue = '';
  let mainDetail = '';
  if (tpl === 'arme') {
    subtype = [item?.format, item?.mains || weaponHandsLabel(item || {}), item?.nature].filter(Boolean);
    mainValue = [item?.degats || '—', ...damageStats.map(_statShort)].join(' + ');
    mainDetail = [item?.toucherStat && `Toucher ${_statShort(item.toucherStat)}`, item?.portee].filter(Boolean).join(' · ');
  } else if (tpl === 'armure') {
    subtype = [item?.slotArmure, item?.typeArmure].filter(Boolean);
    mainValue = `CA ${signed(item?.ca)}`;
  } else if (tpl === 'bijou') {
    subtype = [item?.slotBijou].filter(Boolean);
  } else {
    subtype = [item?.type].filter(Boolean);
  }
  const chips = [
    ...ITEM_STATS.filter(stat => Number(item?.[stat.store])).map(stat => ({
      text: `${stat.short} ${signed(item[stat.store])}`,
      negative: Number(item[stat.store]) < 0,
    })),
    ...['pvMaxBonus','pmMaxBonus','vitesseBonus','initiativeBonus','caBonus'].filter(key => Number(item?.[key])).map(key => ({
      text: `${({ pvMaxBonus:'PV', pmMaxBonus:'PM', vitesseBonus:'VIT', initiativeBonus:'INIT', caBonus:'CA' })[key]} ${signed(item[key])}`,
      negative: Number(item[key]) < 0,
    })),
    ...Object.entries(item?.skillBonuses || {}).filter(([, value]) => Number(value)).map(([name, value]) => ({
      text: `${name} ${signed(value)}`,
      negative: Number(value) < 0,
    })),
    ...Object.entries(damageProfileToRelations(item?.damageProfile || {})).map(([typeId, relationKey]) => {
      const relation = DAMAGE_RELATIONS.find(entry => entry.key === relationKey);
      const damageType = (_shopDamageTypes || []).find(entry => entry.id === typeId);
      return {
        text: `${relation?.name || relationKey} ${(damageType?.label || typeId).toLowerCase()}`,
        color: _shopEditorRelationColor(relationKey),
      };
    }),
  ];
  const traitsCount = Array.isArray(item?.traits) ? item.traits.filter(Boolean).length : 0;
  const actionsCount = Array.isArray(item?.actions) ? item.actions.length : 0;
  const metadata = [
    traitsCount ? `${traitsCount} trait${traitsCount > 1 ? 's' : ''}` : '',
    actionsCount ? `${actionsCount} action${actionsCount > 1 ? 's' : ''}` : '',
    item?.consommable ? 'consommable' : '',
  ].filter(Boolean);
  const description = !['arme', 'armure', 'bijou'].includes(tpl) ? String(item?.effet || item?.description || '').trim() : '';
  const glyph = TEMPLATES[tpl]?.label?.split(' ')[0] || '◆';
  const isNew = _itemNewUntilMs(item) > Date.now() || item?.isNew;
  const todo = [];
  if (!String(item?.nom || '').trim()) todo.push(['identite', 'Donner un nom', true]);
  if (!item?.categorieId) todo.push(['identite', 'Choisir une catégorie']);
  if (tpl === 'arme' && !item?.degats) todo.push(['combat', 'Définir les dégâts']);
  if (tpl === 'armure' && !item?.slotArmure) todo.push(['combat', 'Choisir l’emplacement']);
  if (tpl === 'bijou' && !item?.slotBijou) todo.push(['combat', 'Choisir l’emplacement']);
  if (!(Number(item?.prix) > 0)) todo.push(['commerce', 'Fixer un prix']);
  return `<div class="si-preview-heading">Aperçu boutique</div><article class="si-preview-card" style="--si-rarity:${rarityColor}">
    <div class="si-preview-img">${item?.image ? `<img src="${_esc(item.image)}" alt="">` : `<span>${glyph}</span>`}<div class="si-preview-badges">${isNew ? '<em class="si-preview-badge is-new">Nouveau</em>' : ''}${item?.masque ? '<em class="si-preview-badge is-hidden">Masqué</em>' : ''}</div></div>
    <div class="si-preview-body">
      <div class="si-preview-rarity">${_esc(rarityName)}${subtype.length ? ` · <span>${_esc(subtype.join(' · '))}</span>` : ''}</div>
      <h3>${String(item?.nom || '').trim() ? _esc(item.nom) : '<span class="si-preview-placeholder">Sans nom</span>'}</h3>
      ${mainValue ? `<div class="si-preview-main"><b>${_esc(mainValue)}</b>${mainDetail ? `<small>${_esc(mainDetail)}</small>` : ''}</div>` : ''}
      ${description ? `<p class="si-preview-effect">${_esc(description)}</p>` : ''}
      ${chips.length ? `<div class="si-preview-chips">${chips.map(chip => `<span class="${chip.negative ? 'is-negative' : ''}"${chip.color ? ` style="--si-chip:${chip.color}"` : ''}>${_esc(chip.text)}</span>`).join('')}</div>` : ''}
      ${metadata.length ? `<div class="si-preview-meta">${_esc(metadata.join(' · '))}</div>` : ''}
      <footer><b>${Number(item?.prix) || 0}<small>po</small></b><span>${stock < 0 || !Number.isFinite(stock) ? 'Stock illimité' : stock ? `${stock} en stock` : '<strong>Épuisé</strong>'}</span></footer>
    </div></article>
    <div class="si-preview-heading">${todo.length ? `À compléter · ${todo.length}` : 'Prêt'}</div>
    ${todo.length ? `<div class="si-preview-todo">${todo.map(([section, label, req]) => `<button type="button" class="${req ? 'req' : ''}" data-sh-action="editorGoSection" data-section="${section}">${req ? '⚠' : '›'} ${label}${req ? '<em>requis</em>' : ''}</button>`).join('')}</div>` : '<p class="si-preview-ready">✓ Tous les champs essentiels sont remplis.</p>'}`;
}

function _siQuickResultsHtml(value) {
  const parsed = parseShopItemQuickEntry(value, { rarities: getRarities(), weaponFormats: _weaponFormats, damageTypes: _shopDamageTypes || [], template: _siEditorState?.draft?.template });
  if (!parsed.length) return `<span>Sépare les informations par des virgules : nom, type, dés, rareté, bonus, prix, stock…</span>`;
  const count = parsed.filter(x => !x.bad).length;
  return `<div>${parsed.map(x => `<i class="${x.bad ? 'bad' : ''}">${_esc(x.label)}</i>`).join('')}</div><button type="button" data-sh-action="editorApplyQuick" ${count ? '' : 'disabled'}>Appliquer ${count} champ${count > 1 ? 's' : ''} <kbd>↵</kbd></button>`;
}

function _siQuickHtml() {
  const value = _siEditorState?.quick || '';
  return `<div class="si-quick"><label>ϟ <input id="si-quick-input" value="${_esc(value)}" placeholder="Saisie rapide : Lame de givre, épée, 1d8 + FOR, rare, DEX +1, 120 or, stock 2" autocomplete="off"><span class="si-quick-key"><kbd>Alt</kbd><i>+</i><kbd>Q</kbd></span></label><div id="si-quick-results">${_siQuickResultsHtml(value)}</div></div>`;
}

function _siDiffCount(current = {}, original = {}) {
  const ignored = new Set(['id', 'ordre', 'updatedAt']);
  return [...new Set([...Object.keys(current || {}), ...Object.keys(original || {})])]
    .filter(key => !ignored.has(key) && JSON.stringify(current?.[key]) !== JSON.stringify(original?.[key])).length;
}

function _siReadDraftFromDom() {
  const draft = _siEditorState?.draft;
  if (!draft) return null;
  const text = id => document.getElementById(id)?.value ?? '';
  const num = id => parseFloat(text(id)) || 0;
  draft.nom = text('si-nom').trim(); draft.categorieId = text('si-cat'); draft.template = _normalizeShopTemplate(text('si-template') || draft.template);
  draft.image = text('si-img-b64'); draft.rarete = parseInt(text('si-rarete'), 10) || 0;
  ['format','nature','mains','degats','toucherStat','portee','slotArmure','typeArmure','slotBijou','type','effet','description'].forEach(k => {
    const el = document.getElementById(`si-${k}`); if (el) draft[k] = el.value;
  });
  const readableTitle = document.getElementById('si-readable-title');
  if (readableTitle) draft.readableTitle = readableTitle.value;
  ['prix','ca','pvMaxBonus','pmMaxBonus','vitesseBonus','initiativeBonus','caBonus'].forEach(k => { if (document.getElementById(`si-${k}`)) draft[k] = num(`si-${k}`); });
  ITEM_STATS.forEach(stat => { if (document.getElementById(`si-${stat.store}`)) draft[stat.store] = num(`si-${stat.store}`); });
  const stockInput = document.getElementById('si-dispo');
  const stockInfinite = !!document.getElementById('si-dispo-infini')?.checked;
  const finiteStock = Math.max(0, parseInt(stockInput?.value, 10) || 0);
  if (!stockInfinite && stockInput) _siEditorState.lastFiniteStock = finiteStock;
  draft.dispo = stockInfinite ? -1 : finiteStock;
  draft.masque = !!document.getElementById('si-masque')?.checked; draft.isNew = !!document.getElementById('si-new')?.checked;
  draft.hasRecipe = !!document.getElementById('si-has-recipe')?.checked;
  draft.consommable = !!document.getElementById('si-consommable')?.checked;
  draft.actions = _shopCollectActions(); draft.damageProfile = _shopCollectDamageProfile() || draft.damageProfile || {};
  draft.traits = [...document.querySelectorAll('#si-traits-list input')].map(el => el.value.trim()).filter(Boolean);
  if (document.getElementById('si-skill-chips')) {
    draft.skillBonuses = {};
    document.querySelectorAll('#si-skill-chips .sh-skill-chip').forEach(chip => {
      const value = parseInt(chip.dataset.val, 10);
      if (chip.dataset.skill && Number.isFinite(value) && value !== 0) draft.skillBonuses[chip.dataset.skill] = value;
    });
  }
  try { draft.degatsStats = JSON.parse(text('si-degats-stats-data') || '[]'); } catch { draft.degatsStats = []; }
  const content = document.querySelector('[data-rtq-id="si-readable-content"]');
  if (content?.classList.contains('ql-container')) draft.readableContent = getQuillHtml('si-readable-content');
  return draft;
}

function _siRefreshLive() {
  const item = _siReadDraftFromDom() || _siEditorState?.draft;
  if (!item) return;
  const subtitle = document.getElementById('si-editor-subtitle');
  if (subtitle) {
    const category = _cats.find(entry => entry.id === item.categorieId);
    subtitle.textContent = _siEditorState?.itemId
      ? `${_siEditorState.itemId} · ${category?.nom || 'Sans catégorie'}`
      : 'Saisie rapide ou champ par champ — tout est sur une seule page';
  }
  const preview = document.getElementById('si-editor-preview');
  if (preview) preview.innerHTML = _siPreviewHtml(item);
  const sections = _SI_SECTIONS[_normalizeShopTemplate(item.template)] || _SI_SECTIONS.classique;
  sections.forEach(section => {
    const host = document.getElementById(`si-section-${section}`); if (!host) return;
    const summary = _siSectionSummary(section, item);
    const summaryEl = host.querySelector('.si-section-summary');
    const stateEl = host.querySelector('.si-section-state');
    if (summaryEl) { summaryEl.textContent = summary; summaryEl.hidden = !summary; }
    if (stateEl) stateEl.hidden = !!summary;
  });
  const nav = document.getElementById('si-editor-nav');
  if (nav) nav.innerHTML = _siNavHtml(sections, item);
  const dirty = document.getElementById('si-editor-dirty');
  const changes = _siDiffCount(item, _siEditorState.originalDraft || {});
  _siEditorState.dirty = !!changes;
  if (dirty) dirty.innerHTML = !_siEditorState.itemId
    ? ''
    : changes
      ? `<i class="is-warn"></i>${changes} modification${changes > 1 ? 's' : ''} non enregistrée${changes > 1 ? 's' : ''}`
      : '<i class="is-ok"></i>Aucune modification';
  const save = document.getElementById('si-editor-save');
  const saveNew = document.getElementById('si-editor-save-new');
  if (save) save.disabled = !item.nom?.trim();
  if (saveNew) saveNew.disabled = !item.nom?.trim();
  document.querySelectorAll('.si-stepper input').forEach(input => {
    const stepper = input.closest('.si-stepper'); const value = Number(input.value) || 0;
    stepper?.classList.toggle('is-positive', value > 0); stepper?.classList.toggle('is-negative', value < 0);
  });
}

function _siRenderEditorPanels({ keepScroll = true } = {}) {
  const state = _siEditorState; if (!state) return;
  const scroll = document.getElementById('si-editor-scroll');
  const y = keepScroll ? scroll?.scrollTop || 0 : 0;
  const item = state.draft;
  const tplKey = _normalizeShopTemplate(item.template);
  const tpl = TEMPLATES[tplKey] || TEMPLATES.classique;
  const sections = _SI_SECTIONS[tplKey] || _SI_SECTIONS.classique;
  const nav = document.getElementById('si-editor-nav');
  const form = document.getElementById('si-editor-form');
  const preview = document.getElementById('si-editor-preview');
  if (nav) nav.innerHTML = _siNavHtml(sections, item);
  if (form) form.innerHTML = `${_siQuickHtml()}${sections.map((section, index) => _siSectionHtml(section, tpl, item, tplKey, index)).join('')}`;
  if (preview) preview.innerHTML = _siPreviewHtml(item);
  _bindPrixListener(); _initAutocompletes();
  if (state.open.has('lecture') || _siSectionHasContent('lecture', item)) bindQuillEditors(document.querySelector('.si-editor') || document).catch(() => {});
  if (scroll) scroll.scrollTop = y;
  _siRefreshLive();
}

function _siEditorShellHtml(itemId, item) {
  const choices = _items.slice().sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr')).map(source => `<button type="button" data-sh-action="editorCopyItem" data-id="${source.id}"><span>${source.image ? `<img src="${_esc(source.image)}" alt="">` : '◆'}</span><b>${_esc(source.nom || 'Sans nom')}</b><em>${Number(source.prix) || 0} or</em></button>`).join('');
  const category = _cats.find(entry => entry.id === item?.categorieId);
  const subtitle = itemId
    ? `${itemId} · ${category?.nom || 'Sans catégorie'}`
    : 'Saisie rapide ou champ par champ — tout est sur une seule page';
  return `<div class="si-editor" data-item-id="${itemId || ''}">
    <header class="si-editor-head"><div class="si-editor-title"><h2 id="si-editor-title">${itemId ? 'Modifier l’article' : 'Nouvel article'}</h2><small id="si-editor-subtitle">${_esc(subtitle)}</small></div><div class="si-editor-library"><button type="button" data-sh-action="editorToggleLibrary"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"></path></svg><span>Partir d’un article…</span></button><div id="si-editor-library-menu" hidden><small>Copier un article existant</small>${choices || '<p>Aucun article disponible.</p>'}</div></div><button type="button" class="si-editor-close" data-sh-action="editorCancel" aria-label="Fermer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg></button></header>
    <div class="si-editor-grid"><nav id="si-editor-nav"></nav><main id="si-editor-scroll"><div id="si-editor-form"></div></main><aside id="si-editor-preview"></aside></div>
    <footer class="si-editor-footer"><div id="si-editor-dirty"></div><button type="button" class="ghost" data-sh-action="editorCancel">Annuler</button><button type="button" id="si-editor-save-new" data-sh-action="saveItemNew" data-id="${itemId || ''}" title="Ctrl+Maj+Entrée">Enregistrer &amp; nouveau</button><button type="button" class="primary" id="si-editor-save" data-sh-action="saveItem" data-id="${itemId || ''}" title="Ctrl+Entrée">Enregistrer <kbd>Ctrl ↵</kbd></button></footer>
  </div>`;
}

function _siInstallCloseGuard() {
  setModalCloseGuard(() => {
    if (!_siEditorState?.dirty || _siEditorState?.saving) return false;
    confirmModal('Quitter sans enregistrer les modifications ?', { title: 'Modifications non enregistrées' }).then(ok => {
      if (!ok) return;
      _siEditorState.dirty = false; clearModalCloseGuard(); closeModalDirect();
    });
    return true;
  });
}

async function openItemModal(itemId, seedItem = null) {
  const catalogItem = seedItem || (itemId ? _items.find(i=>i.id===itemId) : null);
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

  const defCatId = item?.categorieId || _activeCat || '';
  const cat = _cats.find(c => c.id === defCatId);
  const draft = { ...(item || {}), categorieId: defCatId, template: _normalizeShopTemplate(item?.template || cat?.template), readableTitle: _shopReadableDraft.title, readableContent: _shopReadableDraft.html };
  _siEditorState = {
    itemId: itemId || '', draft, originalDraft: _siClone(draft), dirty: false, quick: '', open: new Set(), saving: false,
    lastFiniteStock: Number.isFinite(Number(draft.dispo)) && Number(draft.dispo) >= 0 ? Math.trunc(Number(draft.dispo)) : 0,
  };
  ['bonus','traits','actions','description','lecture'].forEach(section => { if (_siSectionHasContent(section, draft)) _siEditorState.open.add(section); });
  openModal('', _siEditorShellHtml(itemId, draft));
  document.getElementById('modal-overlay')?.setAttribute('aria-labelledby', 'si-editor-title');
  _siRenderEditorPanels({ keepScroll: false });
  _siReadDraftFromDom();
  _siEditorState.originalDraft = _siClone(_siEditorState.draft);
  _siRefreshLive();
  _siBindEditor();
  _siInstallCloseGuard();
  requestAnimationFrame(() => document.getElementById('si-nom')?.focus({ preventScroll: true }));

  _shopEnsureDamageTypes().then(() => {
    if (_siEditorState) { _siReadDraftFromDom(); _siRenderEditorPanels(); }
  });
}

function _siGoSection(section) {
  const el = document.getElementById(`si-section-${section}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => el.querySelector('input:not([type="hidden"]), select, textarea, button')?.focus({ preventScroll: true }), 280);
}

let _siEditorGlobalBound = false;
function _siBindEditor() {
  const editor = document.querySelector('.si-editor');
  if (!editor) return;
  if (!_siEditorGlobalBound) {
    _siEditorGlobalBound = true;
    document.addEventListener('input', event => {
      if (!event.target?.closest?.('.si-editor')) return;
      if (event.target.id === 'si-quick-input') {
        _siEditorState.quick = event.target.value;
        const out = document.getElementById('si-quick-results'); if (out) out.innerHTML = _siQuickResultsHtml(event.target.value);
        return;
      }
      _siRefreshLive();
    });
    document.addEventListener('change', event => {
      if (event.target?.closest?.('.si-editor')) _siRefreshLive();
    });
    document.addEventListener('keydown', event => {
      if (!document.querySelector('.si-editor')) return;
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'q') { event.preventDefault(); document.getElementById('si-quick-input')?.focus(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault(); document.getElementById(event.shiftKey ? 'si-editor-save-new' : 'si-editor-save')?.click(); return;
      }
      if (event.altKey && /^[1-9]$/.test(event.key)) {
        const section = (_SI_SECTIONS[_siEditorState?.draft?.template] || [])[Number(event.key) - 1];
        if (section) { event.preventDefault(); _siGoSection(section); }
      }
      if (event.key === 'Enter' && event.target?.id === 'si-trait-new') { event.preventDefault(); addShopTraitsFromInput(event.target); return; }
      if (event.key === 'Enter' && event.target?.id === 'si-skill-picker') { event.preventDefault(); addSkillBonus(); _siRefreshLive(); return; }
      if (event.key === 'Enter' && event.target?.id === 'si-quick-input') { event.preventDefault(); shHandlers.editorApplyQuick?.(); }
    });
  }
  const scroller = document.getElementById('si-editor-scroll');
  if (scroller?._siBound) return;
  if (scroller) scroller._siBound = true;
  scroller?.addEventListener('scroll', () => {
    const sections = [...scroller.querySelectorAll('[data-si-section]')];
    const active = sections.filter(el => el.offsetTop <= scroller.scrollTop + 120).pop() || sections[0];
    document.querySelectorAll('.si-nav-row').forEach(btn => btn.classList.toggle('is-on', btn.dataset.section === active?.dataset.siSection));
  }, { passive: true });
}

function _siApplyWeaponDefaultsToDraft(draft, family) {
  if (!family || !hasWeaponDefaults(family.defaults)) return;
  const defaults = normalizeWeaponDefaults(family.defaults);
  const setIfEmpty = (key, value) => {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return;
    if (draft[key] == null || draft[key] === '' || (Array.isArray(draft[key]) && !draft[key].length) || Number(draft[key]) === 0) draft[key] = _siClone(value);
  };
  setIfEmpty('degats', defaults.degats); setIfEmpty('degatsStats', defaults.degatsStats);
  setIfEmpty('toucherStat', defaults.toucherStat); setIfEmpty('portee', defaults.portee);
  setIfEmpty('mains', defaults.mains); setIfEmpty('nature', defaults.nature);
  if (defaults.caBonus) setIfEmpty('caBonus', defaults.caBonus);
}

function _siApplyQuick() {
  const state = _siEditorState; if (!state) return;
  const parsed = parseShopItemQuickEntry(state.quick, { rarities: getRarities(), weaponFormats: _weaponFormats, damageTypes: _shopDamageTypes || [], template: state.draft.template }).filter(result => !result.bad);
  if (!parsed.length) return;
  _siReadDraftFromDom();
  const relations = damageProfileToRelations(state.draft.damageProfile || {});
  parsed.forEach(result => {
    Object.assign(state.draft, result.patch || {});
    if (result.weapon) _siApplyWeaponDefaultsToDraft(state.draft, result.weapon);
    if (result.trait) state.draft.traits = [...(state.draft.traits || []), result.trait];
    if (result.damage) relations[result.damage.typeId] = result.damage.relation;
  });
  state.draft.damageProfile = relationsToDamageProfile(relations);
  state.quick = '';
  _siRenderEditorPanels();
  showNotif(`${parsed.length} champ${parsed.length > 1 ? 's' : ''} appliqué${parsed.length > 1 ? 's' : ''}.`, 'success');
  requestAnimationFrame(() => document.getElementById('si-quick-input')?.focus({ preventScroll: true }));
}

async function _siCopyExistingItem(itemId) {
  const source = _items.find(item => item.id === itemId); if (!source) return;
  const content = await getDocDataSilent('shopContent', itemId);
  const copy = _siClone(source);
  delete copy.id; delete copy.ordre;
  copy.nom = `${copy.nom || 'Article'} (copie)`;
  copy.readableTitle = content?.title || copy.readableTitle || '';
  copy.readableContent = content?.html || copy.readableContent || '';
  _shopReadableDraft = { itemId: '', title: copy.readableTitle, html: copy.readableContent };
  _shopActionsCacheLoad(copy.actions || []);
  _siEditorState = {
    itemId: '', draft: copy, originalDraft: {}, dirty: true, quick: '', open: new Set(['bonus','traits','actions','description','lecture']), saving: false,
    lastFiniteStock: Number.isFinite(Number(copy.dispo)) && Number(copy.dispo) >= 0 ? Math.trunc(Number(copy.dispo)) : 0,
  };
  const body = document.getElementById('modal-body');
  if (body) body.innerHTML = _siEditorShellHtml('', copy);
  _siRenderEditorPanels({ keepScroll: false }); _siBindEditor(); _siRefreshLive();
  showNotif(`Copie de « ${source.nom || 'Article'} » prête.`, 'success');
}

function _siStep(field, delta) {
  const input = document.getElementById(`si-${field}`); if (!input) return;
  input.value = String((parseInt(input.value, 10) || 0) + Number(delta || 0));
  input.dispatchEvent(new Event('input', { bubbles: true }));
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
      // « Nature » : vide = auto (physique/magique selon le type d'arme) → compat
      // ascendante, aucune arme existante n'est modifiée tant qu'on n'y touche pas.
      const emptyLabel = f.id === 'nature' ? 'Auto (selon le type d\'arme)' : '— Choisir —';
      if (f.id === 'nature' || f.id === 'mains') {
        html += `<div class="form-group"><label>${f.label}</label><select id="si-${f.id}" hidden><option value="">${emptyLabel}</option>${options.map(o=>`<option value="${_esc(o)}" ${val===o?'selected':''}>${_esc(o)}</option>`).join('')}</select>
          <div class="si-segment">${[['', f.id === 'nature' ? 'Auto' : 'Auto'], ...options.map(o => [o, o])].map(([value, label]) => `<button type="button" class="${val === value ? 'is-on' : ''}" data-sh-action="editorSelect" data-field="${f.id}" data-value="${_esc(value)}">${_esc(label)}</button>`).join('')}</div></div>`;
      } else {
        html+=`<div class="form-group"><label>${f.label}</label>
          <select class="input-field sh-modal-select" id="si-${f.id}">
            <option value="">${emptyLabel}</option>
            ${options.map(o=>`<option value="${_esc(o)}" ${val===o?'selected':''}>${_esc(o)}</option>`).join('')}
          </select></div>`;
      }
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
      html+=`<div class="form-group"><label>${f.label}</label><select id="si-${f.id}" hidden><option value="">— Choisir —</option>${ITEM_STATS.map(stat=>`<option value="${stat.key}" ${selected===stat.key?'selected':''}>${stat.label}</option>`).join('')}</select>
        <div class="si-segment si-segment--stats">${ITEM_STATS.map(stat => `<button type="button" class="${selected === stat.key ? 'is-on' : ''}" data-sh-action="editorSelect" data-field="${f.id}" data-value="${stat.key}">${stat.short}</button>`).join('')}</div></div>`;
    } else if(f.type==='stat_bonus_grid'){
      const parsed = _parseLegacyStats(item||{});
      html+=`<div class="form-group sh-field-full"><label>${f.label}</label>
        <div class="sh-bonus-row">
          ${ITEM_STATS.map(stat=>`<div class="si-stepper"><span>${stat.short}</span><button type="button" data-sh-action="editorStep" data-field="${stat.store}" data-delta="-1">−</button><input type="number" id="si-${stat.store}" value="${parsed[stat.store]||0}"><button type="button" data-sh-action="editorStep" data-field="${stat.store}" data-delta="1">＋</button></div>`).join('')}
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
          ${D.map(d=>`<div class="si-stepper" title="${d.label}"><span>${d.icon} ${d.short}</span><button type="button" data-sh-action="editorStep" data-field="${d.id}" data-delta="-1">−</button><input type="number" id="si-${d.id}" value="${item?.[d.id]||0}"><button type="button" data-sh-action="editorStep" data-field="${d.id}" data-delta="1">＋</button></div>`).join('')}
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
        <div id="si-traits-list" class="si-traits-list">
          ${traitsArr.map((t,i)=>`
          <div class="si-trait-row" data-trait-idx="${i}">
            <input class="input-field" value="${t.replace(/"/g,'&quot;')}"
              data-sh-action="traitUpdate" data-sh-on="input" data-idx="${i}" placeholder="Trait...">
            <button type="button" data-sh-action="traitRemove" data-idx="${i}" aria-label="Retirer le trait">✕</button>
          </div>`).join('')}
        </div>
        <input class="input-field si-trait-new" id="si-trait-new" placeholder="Nouveau trait… (Entrée pour ajouter, virgules pour plusieurs)" autocomplete="off">
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
    <div class="si-trait-row" data-trait-idx="${i}">
      <input class="input-field" value="${t.replace(/"/g,'&quot;')}"
        data-sh-action="traitUpdate" data-sh-on="input" data-idx="${i}" placeholder="Trait...">
      <button type="button" data-sh-action="traitRemove" data-idx="${i}" aria-label="Retirer le trait">✕</button>
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
  const trackedFields = ['degats','toucherStat','portee','mains','nature','caBonus'];
  const before = Object.fromEntries(trackedFields.map(key => [key, document.getElementById(`si-${key}`)?.value ?? '']));
  before.degatsStats = _shopDegatsStatsGet();
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
  if (filled.length) {
    if (_siEditorState) _siEditorState.prefill = { label: family.label, fields: filled, before };
    showNotif(`📋 ${family.label} : ${filled.join(', ')} pré-rempli${filled.length > 1 ? 's' : ''}`, 'info');
  }
}
function addShopTraitsFromInput(input) {
  const additions = String(input?.value || '').split(/[,;]+/).map(value => value.trim()).filter(Boolean);
  if (!additions.length) return;
  const arr = [..._shopTraitsGet(), ...additions];
  _shopTraitsSet(arr); _shopTraitsRender(arr);
  input.value = '';
  _siRefreshLive();
  requestAnimationFrame(() => input.focus({ preventScroll: true }));
}

function toggleDispoInfini(cb){
  const input=document.getElementById('si-dispo');
  const btn=document.getElementById('si-dispo-infini-btn');
  if(!input) return;
  if(cb.checked){
    const current = Math.max(0, parseInt(input.value, 10) || 0);
    if (_siEditorState) _siEditorState.lastFiniteStock = current;
    input.value=''; input.disabled=true; input.placeholder='∞';
    btn?.classList.add('is-on');
    btn?.setAttribute('aria-pressed', 'true');
  } else {
    const previous = Math.max(0, Number(_siEditorState?.lastFiniteStock) || 0);
    input.disabled=false; input.placeholder='0'; input.value=String(previous);
    btn?.classList.remove('is-on');
    btn?.setAttribute('aria-pressed', 'false');
    input.focus();
  }
  const stepper = input.closest('.si-stock-stepper');
  stepper?.classList.toggle('is-disabled', cb.checked);
  stepper?.querySelectorAll('button').forEach(step => { step.disabled = cb.checked; });
  _siRefreshLive();
}
function toggleDispoInfiniBtn(){
  const cb=document.getElementById('si-dispo-infini'); if(!cb) return;
  cb.checked=!cb.checked;
  toggleDispoInfini(cb);
}
function updatePrixVente(val){ const pv=Math.round((parseFloat(val)||0)*PRIX_VENTE_RATIO); const el=document.getElementById('si-pv-val'); if(el) el.textContent=pv; }

function refreshItemFields(catId) {
  const cat = _cats.find(c => c.id === catId);
  if (!_siEditorState) return;
  _siReadDraftFromDom();
  _siEditorState.draft.categorieId = catId || '';
  // Sur un article encore vide, choisir une catégorie adopte naturellement son
  // type. Une fiche déjà renseignée ne change jamais de structure toute seule.
  if (!_siEditorState.itemId && !_siEditorState.draft.nom && cat?.template) _siEditorState.draft.template = _normalizeShopTemplate(cat.template);
  _siRenderEditorPanels();
}

/** Re-render les champs de la modale article selon le type sélectionné. */
function refreshTemplateFields(tplKey) {
  if (!_siEditorState || !TEMPLATES[tplKey]) return;
  _siReadDraftFromDom();
  _siEditorState.draft.template = tplKey;
  _siRenderEditorPanels();
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
      _siRefreshLive();
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}

async function saveShopItem(itemId, { createAnother = false } = {}) {
  try {
    const item = itemId ? _items.find(i=>i.id===itemId) : null;
    const catId=document.getElementById('si-cat')?.value||'';
    const cat=_cats.find(c=>c.id===catId);
    // Le template vient désormais du select dédié de la modale ; fallback
    // sur le template de la catégorie (rétrocompat avec les items créés avant
    // l'unification de la modale).
    const tplKey = _normalizeShopTemplate(document.getElementById('si-template')?.value
                || item?.template
                || cat?.template
                || 'classique');
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
    if (tplKey === 'classique') {
      const description = data.effet || data.description || '';
      data.effet = description;
      data.description = description;
    }

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
    const nextSeed = createAnother ? { categorieId: catId, template: tplKey } : null;
    if (_siEditorState) { _siEditorState.dirty = false; _siEditorState.saving = false; }
    clearModalCloseGuard(); closeModalDirect(); showNotif('Article enregistré !','success'); renderShop();
    if (nextSeed) await openItemModal('', nextSeed);
  } catch (e) {
    if (_siEditorState) { _siEditorState.saving = false; _siInstallCloseGuard(); }
    notifySaveError(e);
  }
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
// ATELIER D'ÉQUIPEMENT — builds différentiels, aperçu et panier local
// ══════════════════════════════════════════════════════════════════════════════
const _cloneSlots = slots => Object.fromEntries(Object.entries(slots || {}).map(([slot, id]) => [slot, id ?? null]));
const _atelierSlots = () => getEquipmentSlots().map(slot => ({ ...slot, name: slot.id, ico: slot.icon }));

function _newAtelierState({ sort = 'gain' } = {}) {
  return {
    buildId: 'equip', draft: {}, cmp: 'equip', slot: getEquipmentSlots()[0]?.id || null,
    src: 'all', sort, q: '', preview: undefined, resale: true, renaming: null,
    contextBuild: null, working: new Map(), localBuilds: [],
  };
}

let _atelier = _newAtelierState();

function _atelierBuilds(c = _getActiveShopChar()) {
  const saved = Array.isArray(c?.shopBuilds) ? c.shopBuilds : [];
  return [...saved, ..._atelier.localBuilds.filter(local => !saved.some(build => build.id === local.id))];
}

function _atelierBuild(buildId = _atelier.buildId) {
  return _atelierBuilds().find(build => build.id === buildId) || null;
}

function _atelierWork(buildId = _atelier.buildId) {
  if (buildId === 'equip') return null;
  if (!_atelier.working.has(buildId)) {
    const build = _atelierBuild(buildId);
    if (!build) return null;
    _atelier.working.set(buildId, {
      name: build.name || 'Sans nom',
      slots: _cloneSlots(build.slots),
      savedName: build.name || 'Sans nom',
      savedSlots: _cloneSlots(build.slots),
      isNew: _atelier.localBuilds.some(local => local.id === buildId),
    });
  }
  return _atelier.working.get(buildId);
}

function _atelierUseBuild(buildId) {
  if (buildId !== 'equip' && !_atelierBuild(buildId)) return;
  _atelier.buildId = buildId;
  const work = _atelierWork(buildId);
  _atelier.draft = work?.slots || {};
  _atelier.preview = undefined;
  if (_atelier.cmp === buildId) _atelier.cmp = 'equip';
}

function _atelierNewBuild({ rename = false, notify = false } = {}) {
  const id = `bld_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const build = { id, name: `Build ${_atelierBuilds().length + 1}`, slots: {}, createdAt: Date.now() };
  _atelier.localBuilds.push(build);
  _atelier.working.set(id, { name: build.name, slots: {}, savedName: build.name, savedSlots: {}, isNew: true });
  _atelierUseBuild(id);
  _atelier.renaming = rename ? id : null;
  if (notify) showNotif('Nouveau build créé à partir de ton équipement.', 'success');
  return _atelierWork(id);
}

function _atelierDirty(buildId = _atelier.buildId) {
  const work = _atelierWork(buildId);
  if (!work) return false;
  if (work.isNew) return true;
  return work.name !== work.savedName
    || JSON.stringify(atelierCompactSlots(_atelierEquippedIds(), work.slots)) !== JSON.stringify(atelierCompactSlots(_atelierEquippedIds(), work.savedSlots));
}

function _atelierCatalogId(entry, slot = '') {
  if (!entry) return null;
  const id = entry.itemId || entry.shopItemId || entry.id || '';
  if (id && _items.some(item => item.id === id)) return id;
  const sameName = _items.find(item => item.nom && item.nom === entry.nom && (!slot || equipmentSlotAcceptsItem(slot, item)));
  return sameName?.id || (slot ? `@equip:${slot}` : null);
}

function _atelierEquippedIds(c = _getActiveShopChar()) {
  return Object.fromEntries(_atelierSlots().map(slot => [slot.id, _atelierCatalogId(c?.equipement?.[slot.id], slot.id)]));
}

function _atelierItemById(id, slot = '', c = _getActiveShopChar()) {
  if (!id) return null;
  if (String(id).startsWith('@equip:')) return c?.equipement?.[slot] || null;
  return _items.find(item => item.id === id) || (c?.equipement?.[slot] && _atelierCatalogId(c.equipement[slot], slot) === id ? c.equipement[slot] : null);
}

function _atelierPrimarySlot() {
  return _atelierSlots().find(slot => slot.role === 'primaryWeapon')?.id || _atelierSlots().find(slot => slot.kind === 'weapon')?.id || 'Main principale';
}

function _atelierSecondarySlot() {
  const weapons = _atelierSlots().filter(slot => slot.kind === 'weapon');
  return weapons.find(slot => slot.role === 'secondaryWeapon')?.id || weapons[1]?.id || 'Main secondaire';
}

function _atelierTwoHanded(item) {
  return !!item && _itemWeaponHands(item) === '2 mains';
}

function _atelierEffectiveIds(slots = _atelier.draft, preview = undefined) {
  const c = _getActiveShopChar();
  const overrides = _cloneSlots(slots);
  if (preview !== undefined && _atelier.slot) overrides[_atelier.slot] = preview;
  return atelierApplyBuild(_atelierEquippedIds(c), overrides, {
    primarySlot: _atelierPrimarySlot(),
    secondarySlot: _atelierSecondarySlot(),
    isTwoHanded: id => _atelierTwoHanded(_atelierItemById(id, _atelierPrimarySlot(), c)),
  });
}

function _atelierOverrides(slots = _atelier.draft, preview = undefined) {
  const c = _getActiveShopChar();
  const equipped = _atelierEquippedIds(c);
  const effective = _atelierEffectiveIds(slots, preview);
  const overrides = {};
  _atelierSlots().forEach(slot => {
    const id = effective[slot.id] ?? null;
    if (id !== (equipped[slot.id] ?? null)) overrides[slot.id] = id ? _atelierItemById(id, slot.id, c) : null;
  });
  return overrides;
}

function _atelierSim(slots = _atelier.draft, preview = undefined) {
  const c = _getActiveShopChar();
  return c ? _simulateCharWithBuild(c, _atelierOverrides(slots, preview)) : null;
}

function _atelierCmpSlots() {
  if (_atelier.cmp === 'equip') return {};
  return _atelierWork(_atelier.cmp)?.slots || _atelierBuild(_atelier.cmp)?.slots || {};
}

/** Filtre les items boutique compatibles avec un slot d'équipement donné. */
function _atelierItemsForSlot(slotName) {
  const slot = getEquipmentSlot(slotName);
  if (!slot) return [];
  return _visibleItems().filter(item => item.nom && equipmentSlotAcceptsItem(slot, item));
}

function _atelierSlotArea(slot) {
  const key = _norm(`${slot.role || ''} ${slot.label || slot.id}`);
  if (/armorhead|tete/.test(key)) return 'head';
  if (/armortorso|torse|armure portee/.test(key)) return 'torse';
  if (/armorfeet|botte|pied/.test(key)) return 'feet';
  if (/primaryweapon|principale/.test(key)) return 'mainp';
  if (/secondaryweapon|secondaire/.test(key)) return 'mains';
  if (/anneau/.test(key)) return 'ring';
  if (/amulette/.test(key)) return 'amul';
  if (/harmonise.*(?:1|\bi\b)$/.test(key)) return 'amul';
  if (/harmonise.*(?:2|\bii\b)$/.test(key)) return 'ring';
  if (/harmonise.*(?:3|\biii\b)$/.test(key)) return 'obj';
  if (/objet magique/.test(key)) return 'obj';
  return '';
}

function _atelierItemVisual(item, slot) {
  if (!item) return { glyph: slot?.icon || '＋', image: '' };
  const cat = _cats.find(entry => entry.id === item.categorieId);
  return { glyph: item.icon || _itemGlyph(item, item.template, cat), image: item.image || '' };
}

function _atelierOwnedCounts(c = _getActiveShopChar()) {
  const counts = new Map();
  (c?.inventaire || []).forEach(item => {
    const id = item?.itemId || item?.shopItemId;
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  });
  return counts;
}

function _atelierMoney() {
  const c = _getActiveShopChar();
  const equipped = _atelierEquippedIds(c);
  const effective = _atelierEffectiveIds();
  const owned = _atelierOwnedCounts(c);
  const toBuy = [], alreadyOwned = [], replaced = [];
  const used = new Map();
  _atelierSlots().forEach(slot => {
    const id = effective[slot.id] ?? null;
    if (id && id === (equipped[slot.id] ?? null) && !String(id).startsWith('@equip:')) {
      used.set(id, (used.get(id) || 0) + 1);
    }
  });
  _atelierSlots().forEach(slot => {
    const before = equipped[slot.id] ?? null;
    const after = effective[slot.id] ?? null;
    if (before === after) return;
    if (after && !String(after).startsWith('@equip:')) {
      const item = _atelierItemById(after, slot.id, c);
      const usedCount = used.get(after) || 0;
      if (item && usedCount < (owned.get(after) || 0)) alreadyOwned.push({ slot: slot.id, item });
      else if (item) toBuy.push({ slot: slot.id, item });
      used.set(after, usedCount + 1);
    }
    const old = c?.equipement?.[slot.id];
    const invIndex = Number(old?.sourceInvIndex);
    const invItem = Number.isInteger(invIndex) && invIndex >= 0 ? c?.inventaire?.[invIndex] : null;
    if (old && invItem) replaced.push({ slot: slot.id, item: invItem, credit: parseFloat(invItem.prixVente) || 0 });
  });
  const gross = toBuy.reduce((sum, entry) => sum + (parseFloat(entry.item.prix) || 0), 0);
  const resaleCredit = replaced.reduce((sum, entry) => sum + entry.credit, 0);
  const money = atelierNetCost({ purchase: gross, resaleCredit, resale: _atelier.resale });
  const out = toBuy.filter(entry => _itemDispo(entry.item) === 0);
  return { ...money, resaleCredit, toBuy, alreadyOwned, replaced, out, remaining: calcOr(c) - money.net };
}

function _atelierBuildTabs() {
  const c = _getActiveShopChar();
  const builds = _atelierBuilds(c);
  const compareOptions = [['equip', 'Équipement actuel'], ...builds.filter(build => build.id !== _atelier.buildId).map(build => [build.id, _atelierWork(build.id)?.name || build.name])];
  if (_atelier.cmp === _atelier.buildId || !compareOptions.some(([id]) => id === _atelier.cmp)) _atelier.cmp = 'equip';
  return `<div class="at3-buildbar">
    <span class="at3-buildbar-label">Builds</span>
    <button type="button" class="at3-build${_atelier.buildId === 'equip' ? ' is-active' : ''} is-base" data-sh-action="atelierSelectBuild" data-id="equip">${_shopIcon('lock')}Équipé</button>
    ${builds.map(build => {
      const work = _atelierWork(build.id);
      const active = _atelier.buildId === build.id;
      if (_atelier.renaming === build.id) return `<span class="at3-build is-active"><input id="atelier-build-rename" value="${_esc(work?.name || build.name)}" maxlength="32" data-sh-action="atelierRenameInput" data-sh-on="input" aria-label="Nom du build"></span>`;
      return `<button type="button" class="at3-build${active ? ' is-active' : ''}" data-sh-action="atelierSelectBuild" data-id="${_esc(build.id)}" title="Double-clique pour renommer · clic droit pour les actions" data-atelier-build="${_esc(build.id)}">
        ${_esc(work?.name || build.name)}${_atelierDirty(build.id) ? '<i class="at3-dirty" title="Modifications non enregistrées"></i>' : ''}<em>${Object.keys(work?.slots || build.slots || {}).length}</em>
      </button>`;
    }).join('')}
    <button type="button" class="at3-build is-new" data-sh-action="atelierNewBuild">${_shopIcon('plus')}Nouveau</button>
    <span class="at3-buildbar-spacer"></span>
    <label class="at3-compare">Comparer à <select data-sh-action="atelierSetCompare" data-sh-on="change">${compareOptions.map(([id, name]) => `<option value="${_esc(id)}"${_atelier.cmp === id ? ' selected' : ''}>${_esc(name)}</option>`).join('')}</select></label>
    ${_atelier.contextBuild ? `<div class="at3-build-menu" role="menu" style="left:${Math.max(8, Number(_atelier.contextBuild.x) || 8)}px;top:${Math.max(8, Number(_atelier.contextBuild.y) || 8)}px">
      <button type="button" role="menuitem" data-sh-action="atelierDuplicateBuild" data-id="${_esc(_atelier.contextBuild.id)}">${_shopIcon('plus')}Dupliquer</button>
      <button type="button" role="menuitem" class="is-danger" data-sh-action="atelierDeleteBuild" data-id="${_esc(_atelier.contextBuild.id)}">${_shopIcon('trash')}Supprimer</button>
    </div>` : ''}
  </div>`;
}

function _renderAtelierDoll() {
  const c = _getActiveShopChar();
  if (!c) return '';
  const ids = _atelierEffectiveIds();
  const equipped = _atelierEquippedIds(c);
  const primary = _atelierItemById(ids[_atelierPrimarySlot()], _atelierPrimarySlot(), c);
  const secondaryLocked = _atelierTwoHanded(primary);
  const slotsHtml = _atelierSlots().map((slot, index) => {
    const locked = slot.id === _atelierSecondarySlot() && secondaryLocked;
    const id = ids[slot.id] ?? null;
    const item = locked ? null : _atelierItemById(id, slot.id, c);
    const changed = id !== (equipped[slot.id] ?? null);
    const active = _atelier.slot === slot.id;
    const rare = _itemRarity(item || {});
    const visual = _atelierItemVisual(item, slot);
    const area = _atelierSlotArea(slot);
    return `<button type="button" class="at3-slot${item ? '' : ' is-empty'}${changed ? ' is-changed' : ''}${active ? ' is-active' : ''}${locked ? ' is-locked' : ''}"
      ${area ? `style="grid-area:${area};--rar:${rare.color || 'var(--border-md)'}"` : `style="--rar:${rare.color || 'var(--border-md)'}"`}
      data-sh-action="atelierSelectSlot" data-slot="${_esc(slot.id)}" ${locked ? 'disabled' : ''}>
      ${changed && !locked ? `<span class="at3-slot-undo" data-sh-action="atelierRevertSlot" data-slot="${_esc(slot.id)}" title="Revenir à l'équipement actuel">${_shopIcon('undo')}</span>` : ''}
      <span class="at3-slot-icon"${visual.image ? ` style="background-image:url('${_esc(visual.image)}')"` : ''}>${locked ? _shopIcon('lock') : visual.image ? '' : _esc(visual.glyph)}</span>
      <small>${_esc(slot.label)}</small><b>${locked ? '2 mains' : item?.nom ? _esc(item.nom) : 'Vide'}</b>
    </button>`;
  }).join('');
  const init = (c.nom || '?')[0].toUpperCase();
  const work = _atelierWork();
  const money = _atelierMoney();
  const short = money.remaining < 0;
  const summary = _atelier.buildId === 'equip' ? `<div class="at3-summary"><p class="at3-muted">C'est ton équipement réel. Choisis une pièce à droite : un nouveau build sera créé automatiquement pour l'essayer, sans modifier ta fiche.</p></div>` : `<div class="at3-summary">
    <div class="at3-label"><span>Coût du build</span></div>
    <div class="at3-cost${short ? ' is-short' : ''}"><b>${_fmtOr(money.net)}<i>or</i></b><span>${money.toBuy.length ? `${money.toBuy.length} à acheter` : 'Rien à acheter'}</span></div>
    ${money.alreadyOwned.length ? `<div class="at3-summary-line"><span>Déjà possédé</span><b class="is-up">${money.alreadyOwned.map(entry => _esc(entry.item.nom)).join(', ')}</b></div>` : ''}
    ${money.replaced.length ? `<label class="at3-resale"><input type="checkbox" ${_atelier.resale ? 'checked' : ''} data-sh-action="atelierToggleResale" data-sh-on="change"><span>Revendre les pièces remplacées<small>${money.replaced.map(entry => _esc(entry.item.nom)).join(', ')}</small></span><b>+${_fmtOr(money.resaleCredit)} or</b></label>` : ''}
    <div class="at3-summary-line"><span>Solde après achat</span><b class="${short ? 'is-down' : ''}">${_fmtOr(calcOr(c))} → ${_fmtOr(money.remaining)} or</b></div>
    ${money.out.length ? `<div class="at3-warning is-danger">${_shopIcon('warn')}<span>${money.out.map(entry => _esc(entry.item.nom)).join(', ')} : stock épuisé.</span></div>` : ''}
    ${short ? `<div class="at3-warning">${_shopIcon('warn')}<span>Il manque ${_fmtOr(Math.abs(money.remaining))} or pour ce build.</span></div>` : ''}
    <div class="at3-actions">
      <button type="button" class="at3-btn is-primary" data-sh-action="atelierToCart" ${!money.toBuy.length || money.out.length === money.toBuy.length ? 'disabled' : ''}>${_shopIcon('cart')}Envoyer au panier${money.toBuy.length ? ` (${money.toBuy.length - money.out.length})` : ''}</button>
      <button type="button" class="at3-btn" data-sh-action="atelierSaveBuild" ${!_atelierDirty() ? 'disabled' : ''}>${_shopIcon('save')}${_atelierDirty() ? 'Enregistrer' : 'Enregistré'}</button>
      <button type="button" class="at3-btn" data-sh-action="atelierReset" ${!_atelierDirty() ? 'disabled' : ''}>${_shopIcon('undo')}Annuler</button>
    </div>
    <button type="button" class="at3-delete" data-sh-action="atelierDeleteBuild" data-id="${_esc(_atelier.buildId)}">${_shopIcon('trash')}Supprimer ce build</button>
  </div>`;
  return `<div class="at3-panel-head"><h2>${_atelier.buildId === 'equip' ? 'Équipement actuel' : _esc(work?.name || 'Build')}<small>${_atelier.buildId === 'equip' ? 'Ta fiche, telle qu’elle est' : 'Clique un emplacement pour le modifier'}</small></h2></div>
    <div class="at3-doll">${slotsHtml}<div class="at3-portrait"><span style="--av-c:${_shopCharAvatarColor(c)}">${characterPortraitContent(c, { fallbackText: init })}</span><b>${_esc((c.nom || 'Personnage').split(' ')[0])}</b><small>${_esc(c.classe || '')} · Niv. ${c.niveau || 1}</small></div></div>${summary}`;
}

function _atelierTotalStat(c, key) {
  return (parseInt(c?.stats?.[key]) || 0) + (parseInt(c?.statsBonus?.[key]) || 0);
}

function _atelierAttack(c) {
  const slot = _atelierPrimarySlot();
  const weapon = c?.equipement?.[slot] || null;
  const stat = _normalizeStatKey(weapon?.toucherStat || weapon?.statAttaque || weapon?.degatsStat || 'force') || 'force';
  const value = _atelierTotalStat(c, stat);
  const mod = Math.floor((value - 10) / 2);
  const formula = weapon?.degats || '1d4';
  return { weapon, stat, mod, formula, touch: mod + getMaitriseBonus(c, weapon || {}), avg: _diceAverage(formula) + mod };
}

function _atelierDiffs(base, next) {
  const diffs = [
    { key: 'ca', label: 'CA', delta: calcCA(next) - calcCA(base) },
    { key: 'pv', label: 'PV', delta: calcPVMax(next) - calcPVMax(base) },
    { key: 'pm', label: 'PM', delta: calcPMMax(next) - calcPMMax(base) },
    { key: 'vitesse', label: 'Vit.', delta: calcVitesse(next) - calcVitesse(base) },
    { key: 'degats', label: 'Dég.', delta: _atelierAttack(next).avg - _atelierAttack(base).avg },
    ...ITEM_STAT_META.map(meta => ({ key: `stat:${meta.full}`, label: meta.short, delta: _atelierTotalStat(next, meta.full) - _atelierTotalStat(base, meta.full) })),
  ];
  return diffs.filter(diff => diff.delta);
}

function _renderAtelierStats() {
  const c = _getActiveShopChar();
  const base = _atelierSim(_atelierCmpSlots());
  const previewing = _atelier.preview !== undefined;
  const current = _atelierSim();
  const target = _atelierSim(_atelier.draft, _atelier.preview);
  if (!c || !base || !target || !current) return '';
  const cmpName = _atelier.cmp === 'equip' ? 'l’équipement actuel' : (_atelierWork(_atelier.cmp)?.name || _atelierBuild(_atelier.cmp)?.name || 'un build');
  const derived = [
    ['CA', 'Armure (CA)', 'shield', '#60a5fa', calcCA],
    ['PV', 'PV max', 'heart', '#fb7185', calcPVMax],
    ['PM', 'PM max', 'mana', '#a78bfa', calcPMMax],
    ['VIT', 'Vitesse', 'move', '#38bdf8', calcVitesse],
  ];
  const cards = derived.map(([key, label, icon, color, calc]) => {
    const value = calc(target), was = calc(base), delta = value - was;
    const previewChanged = previewing && value !== calc(current);
    return `<div class="at3-derived${delta > 0 ? ' is-up' : delta < 0 ? ' is-down' : ''}${previewChanged ? ' is-preview' : ''}" style="--metric:${color}">
      <span class="at3-derived-key">${_shopIcon(icon)}${label}</span><span class="at3-derived-value">${value}${delta ? `<i>${delta > 0 ? '+' : ''}${delta}</i>` : ''}</span><small>${delta ? `était ${was}` : 'inchangé'}</small>
    </div>`;
  }).join('');
  const attack = _atelierAttack(target), baseAttack = _atelierAttack(base);
  const attackDelta = attack.avg - baseAttack.avg;
  const attackVisual = _atelierItemVisual(attack.weapon, getEquipmentSlot(_atelierPrimarySlot()));
  const statRows = ITEM_STAT_META.map(meta => {
    const value = _atelierTotalStat(target, meta.full), old = _atelierTotalStat(base, meta.full), delta = value - old;
    const visual = _statVisual(meta.full);
    const low = Math.min(value, old), width = Math.min(100, Math.abs(delta) / 20 * 100);
    return `<div class="at3-stat" style="--stat:${visual.color}"><span class="at3-stat-key">${meta.short}</span><span class="at3-stat-name">${_esc(meta.label || meta.full)}</span><span class="at3-stat-track"><i style="width:${Math.min(100, low / 20 * 100)}%"></i>${delta ? `<i class="${delta > 0 ? 'is-up' : 'is-down'}" style="left:${Math.min(100, low / 20 * 100)}%;width:${width}%"></i>` : ''}</span><b>${value}</b><span>${Math.floor((value - 10) / 2) >= 0 ? '+' : ''}${Math.floor((value - 10) / 2)}</span><em class="${delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : ''}">${delta ? `${delta > 0 ? '+' : ''}${delta}` : '='}</em></div>`;
  }).join('');
  const ids = _atelierEffectiveIds(), equipped = _atelierEquippedIds(c);
  const changes = _atelierSlots().filter(slot => (ids[slot.id] ?? null) !== (equipped[slot.id] ?? null));
  const primaryTwoHands = _atelierTwoHanded(_atelierItemById(ids[_atelierPrimarySlot()], _atelierPrimarySlot(), c));
  return `<div class="at3-panel-head"><h2>Bilan<small>${previewing ? 'Aperçu de la pièce survolée' : 'Build'} comparé à ${_esc(cmpName)}</small></h2>${previewing ? '<span class="at3-preview-tag">Aperçu</span>' : ''}</div>
    <div class="at3-bilan"><div class="at3-derived-grid">${cards}</div>
      <div class="at3-attack"><span class="at3-attack-icon"${attackVisual.image ? ` style="background-image:url('${_esc(attackVisual.image)}')"` : ''}>${attackVisual.image ? '' : _esc(attackVisual.glyph || '✊')}</span><div><span class="at3-label">Attaque principale</span><b>${_esc(attack.weapon?.nom || 'Mains nues')}</b><p>Dégâts <strong>${_esc(attack.formula)} ${attack.mod >= 0 ? '+' : ''}${attack.mod}</strong> · Toucher <strong>${attack.touch >= 0 ? '+' : ''}${attack.touch}</strong> (${_esc(_statShort(attack.stat))})</p></div><div class="at3-attack-avg"><small>Moyenne</small><b>${Number(attack.avg.toFixed(1))}</b>${attackDelta ? `<em class="${attackDelta > 0 ? 'is-up' : 'is-down'}">${attackDelta > 0 ? '+' : ''}${Number(attackDelta.toFixed(1))} / coup</em>` : ''}</div></div>
      <div><div class="at3-label at3-label-row"><span>Caractéristiques</span></div><div class="at3-stats">${statRows}</div></div>
      ${_atelier.buildId !== 'equip' ? `<div><div class="at3-label at3-label-row"><span>Changements vs équipé</span><em>${changes.length}</em></div>${changes.length ? `<div class="at3-change-list">${changes.map(slot => {
        const before = _atelierItemById(equipped[slot.id], slot.id, c), after = _atelierItemById(ids[slot.id], slot.id, c);
        const forced = slot.id === _atelierSecondarySlot() && !after && primaryTwoHands;
        return `<div class="at3-change"><span>${slot.icon}</span><span><s>${_esc(before?.nom || 'vide')}</s> → <b>${_esc(after?.nom || 'vide')}</b></span>${forced ? '<small>arme 2 mains</small>' : `<button type="button" data-sh-action="atelierRevertSlot" data-slot="${_esc(slot.id)}" aria-label="Annuler ce changement">${_shopIcon('x')}</button>`}</div>`;
      }).join('')}</div>` : '<p class="at3-muted">Aucun changement : ce build reprend ton équipement actuel.</p>'}</div>` : ''}
    </div>`;
}

function _atelierCandidateInfo(itemId) {
  const current = _atelierSim();
  const next = _atelierSim(_atelier.draft, itemId);
  const diffs = current && next ? _atelierDiffs(current, next) : [];
  return { diffs, score: atelierGainScore(diffs) };
}

function _renderAtelierItems() {
  const slot = getEquipmentSlot(_atelier.slot);
  if (!slot) return '<div class="at3-empty">Choisis un emplacement sur le mannequin.</div>';
  const ids = _atelierEffectiveIds();
  const currentId = ids[slot.id] ?? null;
  const locked = slot.id === _atelierSecondarySlot() && _atelierTwoHanded(_atelierItemById(ids[_atelierPrimarySlot()], _atelierPrimarySlot()));
  const owned = _atelierOwnedCounts();
  const equipped = _atelierEquippedIds();
  const q = _norm(_atelier.q);
  let rows = _atelierItemsForSlot(slot.id)
    .filter(item => !q || _searchIncludes(_itemSearchText(item), q))
    .filter(item => _atelier.src === 'all' || (_atelier.src === 'own' ? owned.has(item.id) || Object.values(equipped).includes(item.id) : !owned.has(item.id) && !Object.values(equipped).includes(item.id)))
    .map(item => ({ item, ..._atelierCandidateInfo(item.id) }));
  const byName = (a, b) => (a.item.nom || '').localeCompare(b.item.nom || '', 'fr');
  rows.sort(_atelier.sort === 'prix'
    ? (a, b) => ((owned.has(a.item.id) ? 0 : parseFloat(a.item.prix) || 0) - (owned.has(b.item.id) ? 0 : parseFloat(b.item.prix) || 0)) || byName(a, b)
    : _atelier.sort === 'rar'
      ? (a, b) => _getRareteNum(b.item.rarete) - _getRareteNum(a.item.rarete) || byName(a, b)
      : (a, b) => b.score - a.score || byName(a, b));
  const row = ({ item, diffs }) => {
    const active = currentId === item.id;
    const own = owned.has(item.id) || Object.values(equipped).includes(item.id);
    const eq = equipped[slot.id] === item.id;
    const stock = _itemDispo(item);
    const rarity = _itemRarity(item);
    const visual = _atelierItemVisual(item, slot);
    const price = own ? 0 : parseFloat(item.prix) || 0;
    return `<button type="button" class="at3-item${active ? ' is-selected' : ''}${stock === 0 && !own ? ' is-out' : ''}" data-sh-action="atelierPickItem" data-id="${_esc(item.id)}" data-atelier-preview="${_esc(item.id)}" style="--rar:${rarity.color || 'var(--border-md)'}" ${locked ? 'disabled' : ''}>
      <span class="at3-item-icon"${visual.image ? ` style="background-image:url('${_esc(visual.image)}')"` : ''}>${visual.image ? '' : _esc(visual.glyph)}</span><span class="at3-item-copy"><b>${_esc(item.nom)}</b><small>${_esc([rarity.name, ..._itemTypeChips(item)].filter(Boolean).join(' · '))}</small><span>${active ? '<i>Dans ce build</i>' : diffs.length ? diffs.slice(0, 4).map(diff => `<i class="${diff.delta > 0 ? 'is-up' : 'is-down'}">${_esc(diff.label)} ${diff.delta > 0 ? '+' : ''}${Number(diff.delta.toFixed(1))}</i>`).join('') : '<i>Aucun effet chiffré</i>'}</span></span>
      <span class="at3-item-side">${eq ? '<em>Équipé</em>' : own ? '<em class="is-owned">Possédé</em>' : `<strong class="${price > calcOr(_getActiveShopChar()) ? 'is-down' : ''}">${_fmtOr(price)} or</strong>`}${!own && stock === 0 ? '<em class="is-out">Épuisé</em>' : !own && stock !== null && stock < 3 ? `<em class="is-low">Plus que ${stock}</em>` : ''}</span>
    </button>`;
  };
  let list = '';
  if (locked) list = `<div class="at3-warning at3-picker-warning">${_shopIcon('lock')}<span>Emplacement occupé par une arme à deux mains. Choisis une arme à une main pour le libérer.</span></div>`;
  if (currentId && !locked) list += `<button type="button" class="at3-item is-none" data-sh-action="atelierPickItem" data-id="" data-atelier-preview=""><span class="at3-item-icon">${_shopIcon('x')}</span><span class="at3-item-copy"><b>Laisser vide</b><small>Retirer la pièce de ce build</small></span></button>`;
  if (_atelier.src === 'all' && _atelier.sort === 'gain') {
    const ownedRows = rows.filter(entry => owned.has(entry.item.id) || Object.values(equipped).includes(entry.item.id));
    const shopRows = rows.filter(entry => !owned.has(entry.item.id) && !Object.values(equipped).includes(entry.item.id));
    if (ownedRows.length) list += `<div class="at3-picker-group">Dans ton inventaire</div>${ownedRows.map(row).join('')}`;
    if (shopRows.length) list += `<div class="at3-picker-group">En boutique</div>${shopRows.map(row).join('')}`;
  } else list += rows.map(row).join('');
  if (!rows.length && !locked) list += '<div class="at3-empty">Aucune pièce ne correspond à ces filtres.</div>';
  const current = _atelierItemById(currentId, slot.id);
  return `<div class="at3-panel-head"><span class="at3-picker-slot">${slot.icon}</span><h2>${_esc(slot.label)}<small>${locked ? 'Bloqué par l’arme à deux mains' : current ? `Dans ce build : ${_esc(current.nom)}` : 'Emplacement vide'}</small></h2></div>
    <div class="at3-picker-tools"><label class="at3-search">${_shopIcon('search')}<input id="atelier-search" type="search" value="${_esc(_atelier.q)}" placeholder="Filtrer les pièces…" data-sh-action="atelierSearch" data-sh-on="input" autocomplete="off"></label>
      <div class="at3-picker-row"><div class="at3-segment">${[['all', 'Tout'], ['own', 'Possédé'], ['shop', 'Boutique']].map(([value, label]) => `<button type="button" class="${_atelier.src === value ? 'is-active' : ''}" data-sh-action="atelierSetSource" data-source="${value}">${label}</button>`).join('')}</div><select data-sh-action="atelierSetSort" data-sh-on="change"><option value="gain"${_atelier.sort === 'gain' ? ' selected' : ''}>Meilleur gain</option><option value="prix"${_atelier.sort === 'prix' ? ' selected' : ''}>Prix</option><option value="rar"${_atelier.sort === 'rar' ? ' selected' : ''}>Rareté</option></select></div>
    </div><div class="at3-picker-list">${list}</div><div class="at3-picker-foot">${_shopIcon('eye')}Survole une pièce pour voir son effet dans le bilan.</div>`;
}

function _renderAtelier() {
  const buildbar = document.getElementById('atelier-buildbar');
  const doll = document.getElementById('atelier-doll-col');
  const stats = document.getElementById('atelier-stats-col');
  const items = document.getElementById('atelier-items-col');
  const search = document.getElementById('atelier-search');
  const focused = document.activeElement === search;
  const caret = focused ? search.selectionStart : null;
  if (buildbar) buildbar.innerHTML = _atelierBuildTabs();
  if (doll) doll.innerHTML = _renderAtelierDoll();
  if (stats) stats.innerHTML = _renderAtelierStats();
  if (items) items.innerHTML = _renderAtelierItems();
  if (_atelier.renaming) requestAnimationFrame(() => document.getElementById('atelier-build-rename')?.select());
  else if (focused) requestAnimationFrame(() => {
    const input = document.getElementById('atelier-search');
    input?.focus();
    try { input?.setSelectionRange(caret, caret); } catch {}
  });
}

function _atelierSetSlot(slot, itemId) {
  if (_atelier.buildId === 'equip') _atelierNewBuild({ notify: true });
  const work = _atelierWork();
  if (!work || !slot) return;
  const equipped = _atelierEquippedIds();
  if ((itemId ?? null) === (equipped[slot] ?? null)) delete work.slots[slot];
  else work.slots[slot] = itemId ?? null;
  work.slots = atelierCompactSlots(equipped, work.slots);
  _atelier.draft = work.slots;
  _atelier.preview = undefined;
}

async function _atelierSaveBuild() {
  const c = _getActiveShopChar(), work = _atelierWork();
  if (!c || !work) return;
  const slots = atelierCompactSlots(_atelierEquippedIds(c), work.slots);
  const saved = (c.shopBuilds || []).map(build => ({ ...build }));
  const index = saved.findIndex(build => build.id === _atelier.buildId);
  const next = { id: _atelier.buildId, name: work.name.trim() || 'Sans nom', slots, createdAt: index >= 0 ? saved[index].createdAt || Date.now() : Date.now() };
  if (index >= 0) saved[index] = next; else saved.push(next);
  if (!await trySave('characters', c.id, { shopBuilds: saved })) return;
  c.shopBuilds = saved;
  _atelier.localBuilds = _atelier.localBuilds.filter(build => build.id !== next.id);
  work.slots = _cloneSlots(slots); work.savedSlots = _cloneSlots(slots); work.name = next.name; work.savedName = next.name; work.isNew = false;
  _atelier.draft = work.slots;
  showNotif(`Build « ${next.name} » enregistré.`, 'success');
  _renderAtelier();
}

async function _atelierDeleteBuild(buildId = _atelier.buildId) {
  const c = _getActiveShopChar();
  if (!c || buildId === 'equip') return;
  const wasActive = buildId === _atelier.buildId;
  const exists = (c.shopBuilds || []).some(build => build.id === buildId);
  if (exists) {
    const ok = await confirmModal('Supprimer définitivement ce build ?', { title: 'Supprimer le build', confirmLabel: 'Supprimer', danger: true });
    if (!ok) return;
    const builds = c.shopBuilds.filter(build => build.id !== buildId);
    if (!await trySave('characters', c.id, { shopBuilds: builds })) return;
    c.shopBuilds = builds;
  }
  _atelier.localBuilds = _atelier.localBuilds.filter(build => build.id !== buildId);
  _atelier.working.delete(buildId);
  _atelier.contextBuild = null;
  if (wasActive) _atelierUseBuild('equip');
  _renderAtelier();
}

function _atelierDuplicateBuild(buildId) {
  const source = _atelierWork(buildId) || (() => {
    const build = _atelierBuild(buildId);
    return build ? { name: build.name || 'Build', slots: _cloneSlots(build.slots) } : null;
  })();
  if (!source) return;
  const id = `bld_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const name = `${source.name || 'Build'} (copie)`;
  const slots = _cloneSlots(source.slots);
  _atelier.localBuilds.push({ id, name, slots: _cloneSlots(slots), createdAt: Date.now() });
  _atelier.working.set(id, { name, slots, savedName: name, savedSlots: _cloneSlots(slots), isNew: true });
  _atelier.contextBuild = null;
  _atelierUseBuild(id);
  showNotif(`Build « ${source.name || 'Build'} » dupliqué.`, 'success');
  _renderAtelier();
}

function _atelierToCart() {
  const money = _atelierMoney();
  let added = 0;
  money.toBuy.forEach(({ item }) => {
    const stock = _itemDispo(item), qty = _cartQty(item.id);
    if (stock === 0 || (stock !== null && qty >= stock)) return;
    _cart.set(item.id, qty + 1); added++;
  });
  if (_atelier.resale) money.replaced.forEach(entry => _cartTrades.add(entry.slot));
  if (!added) { showNotif('Aucun article disponible à envoyer au panier.', 'error'); return; }
  showNotif(`${added} article${added > 1 ? 's' : ''} envoyé${added > 1 ? 's' : ''} au panier${_atelier.resale && money.replaced.length ? ' · reprises incluses' : ''}.`, 'success');
  renderShop();
}

function _prepareAtelier(prefillItemId = '') {
  if (!_getActiveShopChar()) return false;
  _atelier = _newAtelierState();
  if (prefillItemId) {
    const item = _items.find(entry => entry.id === prefillItemId);
    const slot = item ? _resolveSlotForItem(item) : null;
    if (item && slot) { _atelier.slot = slot; _atelierSetSlot(slot, item.id); }
  }
  return true;
}

function _renderAtelierShell() {
  return `<div class="at3-shell"><div id="atelier-buildbar"></div><div class="at3-grid"><section class="at3-panel" id="atelier-doll-col" aria-label="Mannequin"></section><section class="at3-panel" id="atelier-stats-col" aria-label="Bilan du build"></section><section class="at3-panel at3-picker" id="atelier-items-col" aria-label="Choix d'équipement"></section></div></div>`;
}

function _renderAtelierPage() {
  if (!_getActiveShopChar()) return `<div class="sh-atelier-page">${_renderNoCharBanner()}</div>`;
  return `<div class="sh-atelier-page" role="tabpanel">${_renderAtelierShell()}</div>`;
}

function shopOpenAtelier(prefillItemId = '') {
  if (!_prepareAtelier(prefillItemId)) { showNotif('Sélectionne d’abord un personnage.', 'error'); return; }
  _shopSection = 'atelier';
  renderShop();
}

function shopSetSection(section) {
  if (!['shop', 'atelier', 'artisan'].includes(section) || section === _shopSection) return;
  if (section === 'atelier' && !_prepareAtelier()) { showNotif('Sélectionne d’abord un personnage.', 'error'); return; }
  if (section === 'artisan') _artisanNeedsReset = true;
  else unmountArtisanPage();
  _shopSection = section;
  renderShop();
}

function _atelierPointerOver(event) {
  if (_shopSection !== 'atelier') return;
  const row = event.target.closest?.('[data-atelier-preview]');
  if (!row || row.contains(event.relatedTarget)) return;
  _atelier.preview = row.dataset.atelierPreview || null;
  const stats = document.getElementById('atelier-stats-col');
  if (stats) stats.innerHTML = _renderAtelierStats();
}

function _atelierPointerOut(event) {
  if (_shopSection !== 'atelier') return;
  const row = event.target.closest?.('[data-atelier-preview]');
  if (!row || row.contains(event.relatedTarget)) return;
  _atelier.preview = undefined;
  const stats = document.getElementById('atelier-stats-col');
  if (stats) stats.innerHTML = _renderAtelierStats();
}

function _atelierRenameKey(event) {
  if (_atelier.contextBuild && event.key === 'Escape') {
    _atelier.contextBuild = null;
    const bar = document.getElementById('atelier-buildbar');
    if (bar) bar.innerHTML = _atelierBuildTabs();
    return;
  }
  if (event.target?.id !== 'atelier-build-rename' || !['Enter', 'Escape'].includes(event.key)) return;
  event.preventDefault();
  const work = _atelierWork(_atelier.renaming);
  if (event.key === 'Escape' && work) work.name = work.savedName;
  else if (work) work.name = event.target.value.trim() || work.name;
  _atelier.renaming = null;
  _renderAtelier();
}

function _atelierRenameBlur(event) {
  if (event.target?.id !== 'atelier-build-rename' || !_atelier.renaming) return;
  const work = _atelierWork(_atelier.renaming);
  if (work) work.name = event.target.value.trim() || work.name;
  _atelier.renaming = null;
  setTimeout(() => _shopSection === 'atelier' && _renderAtelier(), 0);
}

function _atelierBuildContextMenu(event) {
  if (_shopSection !== 'atelier') return;
  const build = event.target.closest?.('[data-atelier-build]');
  if (!build) return;
  event.preventDefault();
  _atelier.contextBuild = {
    id: build.dataset.atelierBuild,
    x: Math.min(event.clientX, window.innerWidth - 180),
    y: Math.min(event.clientY, window.innerHeight - 96),
  };
  const bar = document.getElementById('atelier-buildbar');
  if (bar) bar.innerHTML = _atelierBuildTabs();
  requestAnimationFrame(() => bar?.querySelector('.at3-build-menu button')?.focus({ preventScroll: true }));
}

function _atelierCloseContextMenu(event) {
  if (!_atelier.contextBuild || event.target.closest?.('.at3-build-menu')) return;
  _atelier.contextBuild = null;
  const bar = document.getElementById('atelier-buildbar');
  if (bar) bar.innerHTML = _atelierBuildTabs();
}

document.addEventListener('pointerover', _atelierPointerOver);
document.addEventListener('pointerout', _atelierPointerOut);
document.addEventListener('keydown', _atelierRenameKey);
document.addEventListener('focusout', _atelierRenameBlur);
document.addEventListener('contextmenu', _atelierBuildContextMenu);
document.addEventListener('click', _atelierCloseContextMenu);

// ──────────────────────────────────────────────────────────────────────────────
// HANDLERS DE DÉLÉGATION (data-sh-action="…")
// ──────────────────────────────────────────────────────────────────────────────
Object.assign(shHandlers, {
  // Header / navigation principale
  setSection:     (el) => shopSetSection(el?.dataset?.section || 'shop'),
  openArtisan:    () => shopSetSection('artisan'),
  openAtelier:    (el) => shopOpenAtelier(el?.dataset?.id || ''),
  // Atelier (builds différentiels + aperçu local)
  atelierSelectBuild: (el, event) => {
    const id = el.dataset.id || 'equip';
    if (event?.detail > 1 && id !== 'equip') _atelier.renaming = id;
    _atelierUseBuild(id);
    _renderAtelier();
  },
  atelierNewBuild: () => { _atelierNewBuild({ rename: true }); _renderAtelier(); },
  atelierRenameInput: (el) => {
    const work = _atelierWork(_atelier.renaming);
    if (work) work.name = el.value;
  },
  atelierSetCompare: (el) => { _atelier.cmp = el.value || 'equip'; _renderAtelier(); },
  atelierSelectSlot: (el) => { _atelier.slot = el.dataset.slot || null; _atelier.q = ''; _atelier.preview = undefined; _renderAtelier(); },
  atelierRevertSlot: (el, event) => {
    event?.stopPropagation?.();
    const work = _atelierWork();
    if (work && el.dataset.slot) { delete work.slots[el.dataset.slot]; _atelier.draft = work.slots; _atelier.preview = undefined; _renderAtelier(); }
  },
  atelierPickItem: (el) => { _atelierSetSlot(_atelier.slot, el.dataset.id || null); _renderAtelier(); },
  atelierReset: () => {
    const work = _atelierWork();
    if (!work) return;
    work.slots = _cloneSlots(work.savedSlots); work.name = work.savedName;
    _atelier.draft = work.slots; _atelier.preview = undefined; _renderAtelier();
  },
  atelierSearch: (el) => { _atelier.q = el.value || ''; _renderAtelier(); },
  atelierSetSource: (el) => { _atelier.src = el.dataset.source || 'all'; _renderAtelier(); },
  atelierSetSort: (el) => { _atelier.sort = el.value || 'gain'; _renderAtelier(); },
  atelierToggleResale: (el) => { _atelier.resale = !!el.checked; _renderAtelier(); },
  atelierToCart: () => _atelierToCart(),
  atelierSaveBuild: () => _atelierSaveBuild(),
  atelierDuplicateBuild: (el, event) => { event?.stopPropagation?.(); _atelierDuplicateBuild(el.dataset.id); },
  atelierDeleteBuild: (el, event) => { event?.stopPropagation?.(); _atelierDeleteBuild(el.dataset.id || _atelier.buildId); },
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
  openCraftStg: () => openCraftSettingsAdmin(),
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
  resetTags:      () => {
    _filterTags.clear();
    _page = 1;
    _updateResults();
  },
  toggleTag:      (el) => shopToggleTag(el.dataset.tag),
  page:           (el) => shopPage(parseInt(el.dataset.page)),
  deleteCat:      (el) => deleteCat(el.dataset.id),
  catClose:       () => _catClose(),
  catName:        (el) => _catNameInput(el),
  catToggleEmoji: () => _catEditorMutate(state => { state.emojiOpen = !state.emojiOpen; }),
  catEmoji:       (el) => _catEditorMutate(state => { state.emoji = el.dataset.value || ''; state.emojiOpen = false; }),
  catEmojiOwn:    (el) => {
    const value = el.value.trim();
    if (value) _catEditorMutate(state => { state.emoji = value; state.emojiOpen = false; });
  },
  catEmojiAuto:   () => _catEditorMutate(state => { state.emoji = ''; state.emojiOpen = false; }),
  catColor:       (el) => _catEditorMutate(state => { state.couleur = el.dataset.value || ''; }),
  catCustomColor: (el) => _catEditorMutate(state => { state.couleur = el.value || ''; }),
  catTemplate:    (el) => {
    if (!TEMPLATES[el.dataset.value]) return;
    _catEditorMutate(state => { state.template = el.dataset.value; state.templateAuto = false; });
  },
  catVisibility:  (el) => _catEditorMutate(state => { state.masquee = el.dataset.hidden === 'true'; }),
  catPickImage:   () => document.getElementById('shcat-file')?.click(),
  catImageFile:   (el) => { const file = el.files?.[0]; el.value = ''; return _catLoadImage(file); },
  catRemoveImage: () => _catEditorMutate(state => { state.image = ''; state.imageFocus = { x: 50, y: 50 }; }),
  catImageZone:   (el, event) => {
    if (!_catEditorState?.image) { document.getElementById('shcat-file')?.click(); return; }
    const rect = el.getBoundingClientRect();
    const x = Math.round((event.clientX - rect.left) / rect.width * 100);
    const y = Math.round((event.clientY - rect.top) / rect.height * 100);
    _catEditorMutate(state => { state.imageFocus = { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) }; });
  },
  catDeleteArm:    () => _catEditorMutate(state => { state.deleting = true; state.emojiOpen = false; }),
  catDeleteCancel: () => _catEditorMutate(state => { state.deleting = false; }),
  catDeleteDestination: (el) => { if (_catEditorState) _catEditorState.destination = el.value || ''; },
  catDeleteConfirm: (el) => deleteCat(el.dataset.id, { destination: _catEditorState?.destination || '', confirmed: true }),
  // Items
  buyItem:        (el, ev) => { ev?.stopPropagation?.(); _cartAdd(el.dataset.id); },
  confirmBuy:     (el) => confirmBuyItem(el.dataset.id),
  openDetail:     (el) => openShopItemDetail(el.dataset.id),
  closeDetail:    () => _closeShopItemDetail(),
  cartInc:        (el, ev) => { ev?.stopPropagation?.(); _cartAdd(el.dataset.id); },
  cartDec:        (el, ev) => { ev?.stopPropagation?.(); _cartRemove(el.dataset.id); },
  cartToggle:     () => { _cartOpen = !_cartOpen; _syncCommerceChrome(); },
  cartClose:      () => { _cartOpen = false; _syncCommerceChrome(); },
  cartClear:      () => { _clearCart(); _refreshCommerceUi(); },
  cartPay:        () => _payCart(),
  cartTrade:      (el) => {
    const slot = el.dataset.slot;
    if (!slot) return;
    if (el.checked) _cartTrades.add(slot); else _cartTrades.delete(slot);
    _refreshCommerceUi();
  },
  cartUntrade:    (el) => { _cartTrades.delete(el.dataset.slot); _refreshCommerceUi(); },
  shelfScroll:    (el) => {
    const row = el.closest('.shc-shelf-scroll')?.querySelector('.shc-shelf-row');
    row?.scrollBy({ left: (parseInt(el.dataset.dir, 10) || 1) * row.clientWidth * .8, behavior: 'smooth' });
  },
  openShopHistory:(el, ev) => { ev?.stopPropagation?.(); openShopHistory(); },
  historyScope:   (el) => _shHistorySetScope(el.dataset.scope),
  histPickSearch: (el) => {
    const q = (el.value || '').trim().toLowerCase();
    el.closest('.sh-hist-pick-menu')?.querySelectorAll('.sh-hist-pick-opt[data-name]')
      .forEach(o => { o.hidden = !!q && !(o.dataset.name || '').includes(q); });
  },
  historyOpenItem:(el) => _shHistoryOpenItem(el.dataset.id),
  deleteItem:     (el) => deleteShopItem(el.dataset.id),
  editFromDetail: (el) => { _detailItemId = null; _syncCommerceChrome(); openItemModal(el.dataset.id); },
  buyFromDetail:  (el) => _cartAdd(el.dataset.id),
  tryFromDetail:  (el) => { _detailItemId = null; _syncCommerceChrome(); shopOpenAtelier(el.dataset.id || ''); },
  sellEquip:      (el) => _sellCurrentEquipForShop(el.dataset.slot),
  // Stepper quantité achat
  qtyDown:        (el) => { const inp = el.nextElementSibling; inp?.stepDown(); inp?.dispatchEvent(new Event('input')); },
  qtyUp:          (el) => { const inp = el.previousElementSibling; inp?.stepUp(); inp?.dispatchEvent(new Event('input')); },
  qtyInput:       (el) => _shBuyQtyInput(el),
  // Éditeur d'article « Établi »
  editorGoSection:(el) => _siGoSection(el.dataset.section),
  editorOpenSection: (el) => {
    _siReadDraftFromDom(); _siEditorState?.open.add(el.dataset.section); _siRenderEditorPanels();
    requestAnimationFrame(() => _siGoSection(el.dataset.section));
  },
  editorToggleLibrary: () => {
    const menu = document.getElementById('si-editor-library-menu'); if (menu) menu.hidden = !menu.hidden;
  },
  editorCopyItem: (el) => _siCopyExistingItem(el.dataset.id),
  editorApplyQuick: () => _siApplyQuick(),
  editorRarity: (el) => {
    const current = parseInt(document.getElementById('si-rarete')?.value, 10) || 0;
    const clicked = parseInt(el.dataset.value, 10) || 0;
    const value = current === clicked ? 0 : clicked;
    const hidden = document.getElementById('si-rarete'); if (hidden) hidden.value = String(value);
    document.getElementById('si-nom')?.style.setProperty('--si-rarity', value ? (el.style.getPropertyValue('--si-rarity') || 'var(--text)') : 'var(--text)');
    document.querySelectorAll('#si-rarity-row button').forEach(btn => btn.classList.toggle('is-on', value > 0 && btn === el));
    _siRefreshLive();
  },
  editorDamageStat: (el) => {
    const hidden = document.getElementById('si-degats-stats-data'); if (!hidden) return;
    let values = []; try { values = JSON.parse(hidden.value || '[]'); } catch {}
    const key = el.dataset.value;
    values = values.includes(key) ? values.filter(value => value !== key) : [...values, key];
    hidden.value = JSON.stringify(values);
    el.classList.toggle('is-on', values.includes(key));
    _siRefreshLive();
  },
  editorToggleConsumable: (el) => {
    const input = document.getElementById('si-consommable'); if (!input) return;
    input.checked = !input.checked;
    el.classList.toggle('is-on', input.checked);
    el.setAttribute('aria-pressed', input.checked ? 'true' : 'false');
    _siRefreshLive();
  },
  editorStep: (el) => _siStep(el.dataset.field, el.dataset.delta),
  editorSelect: (el) => {
    const field = el.dataset.field;
    const select = document.getElementById(`si-${field}`); if (!select) return;
    select.value = el.dataset.value || '';
    el.parentElement?.querySelectorAll('button').forEach(btn => btn.classList.toggle('is-on', btn === el));
    _siRefreshLive();
  },
  editorUndoPrefill: () => {
    const prefill = _siEditorState?.prefill; if (!prefill) return;
    _siReadDraftFromDom();
    Object.assign(_siEditorState.draft, prefill.before);
    _siEditorState.prefill = null;
    _siRenderEditorPanels();
  },
  editorCancel: () => closeModalDirect(),
  refreshFields:  (el) => refreshItemFields(el.value),
  setItemTemplate:(el) => refreshTemplateFields(el.dataset.value || el.value),
  setItemCat:     (el) => refreshItemFields(el.value),
  toggleDmgProfile: (el) => { _shopToggleDmgProfile(el); _siRefreshLive(); },
  prixInput:      (el) => updatePrixVente(el.value),
  dispoInfini:    (el) => toggleDispoInfini(el),
  dispoInfiniBtn: ()   => toggleDispoInfiniBtn(),
  uploadImg:      (el) => previewUpload(el.id, el.dataset.preview, el.dataset.hidden),
  saveItem:       (el) => { if (_siEditorState) { _siEditorState.saving = true; clearModalCloseGuard(); } saveShopItem(el.dataset.id || ''); },
  saveItemNew:    (el) => { if (_siEditorState) { _siEditorState.saving = true; clearModalCloseGuard(); } saveShopItem(el.dataset.id || '', { createAnother: true }); },
  // Modal article : actions/sorts
  addAction:      () => addShopAction(),
  editAction:     (el) => editShopAction(parseInt(el.dataset.idx)),
  removeAction:   (el) => removeShopAction(parseInt(el.dataset.idx)),
  // Modal article : traits + degats stats + skills
  traitAdd:       () => { addShopTrait(); _siRefreshLive(); },
  traitUpdate:    (el) => { updateShopTrait(parseInt(el.dataset.idx), el.value); _siRefreshLive(); },
  traitRemove:    (el) => { removeShopTrait(parseInt(el.dataset.idx)); _siRefreshLive(); },
  degatsAdd:      () => { addShopDegatsStat(); _siRefreshLive(); },
  degatsUpdate:   (el) => { updateShopDegatsStat(parseInt(el.dataset.idx), el.value); _siRefreshLive(); },
  weaponTypeDefaults: (el) => { applyWeaponTypeDefaults(el); _siReadDraftFromDom(); _siRenderEditorPanels(); },
  degatsRemove:   (el) => { removeShopDegatsStat(parseInt(el.dataset.idx)); _siRefreshLive(); },
  skillAdd:       () => { addSkillBonus(); _siRefreshLive(); },
  skillValue:     (el) => { const chip = el.closest('.sh-skill-chip'); if (chip) chip.dataset.val = String(parseInt(el.value, 10) || 0); _siRefreshLive(); },
  skillRemove:    (el) => { removeSkillBonus(el.dataset.skill); _siRefreshLive(); },
  // Modal catégorie
  saveCat:        () => saveCat(),
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
