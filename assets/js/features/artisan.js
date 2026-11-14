// ══════════════════════════════════════════════════════════════════════════════
// ARTISAN — Améliorations d'équipement
//
// Outil accessible comme onglet de la boutique (et encore compatible modale). Gère :
//   - Sac de fragments de traits (catégorisé par slot d'origine)
//   - Liste des items améliorables de l'inventaire du joueur
//   - Actions : détruire, ajouter, écraser, améliorer stats
//
// Tarifs et plafonds : world/upgrade_settings (édité par le MJ).
// ══════════════════════════════════════════════════════════════════════════════

import { STATE } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { getShopCharId } from '../shared/shop-session.js';
import { weaponHands, weaponHandsLabel } from '../shared/weapon-family.js';
import { trySave } from '../shared/crud.js';
import { openModal, pushModal, closeModalDirect, confirmModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { _esc, _norm, _searchIncludes } from '../shared/html.js';
import {
  calcOr, getItemStatBonus, getItemBaseStatBonus, getItemUpgradeStatBonus,
  ITEM_STAT_META, ITEM_STAT_BY_FULL, computeEquipStatsBonus, getDefaultCharForUser,
} from '../shared/char-stats.js';
import { inventoryHistoryPayload, makeInventoryHistoryEntry } from '../shared/inventory-history.js';
import {
  _getTraits, _getBaseTraits, _getAddedTraits,
  syncEquipmentAfterInventoryMutation, buildEquippedItemFromInventory,
} from '../shared/equipment-utils.js';
import { loadUpgradeSettings, getUpgradeSettings, rarityCapFor } from '../shared/upgrade-settings.js';
import { getVisibleCharacters } from '../shared/character-state.js';
import { characterBuildsForStorage, patchBuildLocally } from '../shared/character-builds.js';
import { characterAvatarHtml } from '../shared/portraits.js';
// Catégories de fragments : partagées avec la revente (valeur des améliorations).
import { FRAGMENT_CATEGORIES, getItemFragmentCategory } from '../shared/upgrade-value.js';
// Reforge (monter la rareté) — gatée Bastion, Option A. Réutilise le mapping craft.
import { craftCategoryForItem, craftDiscipline, craftRecycleQty, countInventoryItem } from '../shared/craft-engine.js';
import { craftRecipeMaterials, loadCraftSettings, getCraftSettings } from '../shared/craft-settings.js';
import { evaluateReforge, scaleMaterials } from '../shared/reforge.js';
import { getRarities, loadRarities, RARETE_NAMES, _rareteColor } from '../shared/rarity.js';
import { getDocData, loadCollection } from '../data/firestore.js';
import { getInventoryItemImage, shopItemToInvEntry } from '../shared/inventory-utils.js';
import { isArmorItem, isJewelItem } from '../shared/item-facts.js';
import { isTraitRecyclable, recyclableTraits, nonRecyclableTraitNames } from '../shared/trait-recycling.js';
import {
  getItemTraitsSlotCount as getItemTraitsSlotCountPure, traitCapAt, statCapAt, unlockRarity, firstGainRarity,
  statPointUse, possibleActions, isMaxed, dismantlePreview,
} from '../shared/artisan-logic.js';

export { FRAGMENT_CATEGORIES, getItemFragmentCategory };

const FRAGMENT_CAT_BY_ID = Object.fromEntries(FRAGMENT_CATEGORIES.map(c => [c.id, c]));
const ARTISAN_FAMILIES = [
  { id: 'all', label: 'Tout', icon: '' },
  { id: 'weapons', label: 'Armes', icon: '⚔' },
  { id: 'armor', label: 'Armures', icon: '⬟' },
  { id: 'jewelry', label: 'Bijoux', icon: '◉' },
  { id: 'magic', label: 'Objets magiques', icon: '✦' },
];
const ARTISAN_STAT_COLORS = {
  force: '#ff6b6b', dexterite: '#4f8cff', constitution: '#22c38e',
  intelligence: '#9d6fff', sagesse: '#f4c430', charisme: '#ff78c8',
};

function _artisanFamily(category, item = null) {
  if (category === 'arme') return 'weapons';
  // Classer par l'objet quand on l'a (robuste aux slots personnalisés du MJ).
  if (item && _isArmorItem(item)) return 'armor';
  if (category === 'Amulette' || category === 'Anneau') return 'jewelry';
  if (item?.slotBijou) return 'magic';
  // Repli sans objet : noms de slots connus.
  if (['Tête', 'Torse', 'Pieds', 'Armure', 'armure'].includes(category)) return 'armor';
  if (category === 'Objet magique') return 'magic';
  return 'all';
}

function _catalogItem(item = {}) {
  const id = item.itemId || item.shopItemId || '';
  return id ? STORE.shopItems.find(entry => entry.id === id) || null : null;
}

function _artisanItemImage(item = {}) {
  return getInventoryItemImage(item, _catalogItem(item));
}

function _artisanItemVisual(item = {}, category = getItemFragmentCategory(item), className = '') {
  const image = _artisanItemImage(item);
  const glyph = FRAGMENT_CAT_BY_ID[category]?.icon || '◇';
  return `<span class="art-item-visual ${className}${image ? ' has-image' : ''}" aria-hidden="true">${image
    ? `<img src="${_esc(image)}" alt="" loading="lazy">`
    : `<span>${glyph}</span>`}</span>`;
}

const STORE = {
  activeCharId: null,
  activeItemIndex: null,   // objet sélectionné dans l'établi (index inventaire)
  mjFreeMode: false,
  inlineRootId: null,
  itemSearch: '',
  itemCategory: 'all',
  hideEmpty: false,
  operation: null,
  flash: null,
  resourceFlash: false,
  shopItems: [],
  bastion: null,           // doc bastion/main (niveaux de salles) pour la reforge
};

// Charge les réglages nécessaires à l'Artisan (améliorations + craft + raretés +
// niveaux de salles du Bastion). bastion/main est session-live → 0 lecture en plus.
async function _artisanLoadSettings() {
  await Promise.all([
    loadUpgradeSettings(),
    loadCraftSettings().catch(() => null),
    loadRarities().catch(() => null),
    getDocData('bastion', 'main').then(d => { STORE.bastion = d || null; }).catch(() => { STORE.bastion = null; }),
    loadCollection('shop').then(items => { STORE.shopItems = items || []; }).catch(() => { STORE.shopItems = []; }),
  ]);
}

export function getItemTraitsSlotCount(item = {}) {
  const s = getUpgradeSettings();
  const cat = getItemFragmentCategory(item);
  const cap = getItemTraitsSlotCountPure(item, s);
  // Repli défensif pour une configuration historique incomplète. Le calcul
  // normal reste centralisé dans artisan-logic.js.
  return Number.isFinite(cap) ? cap : Math.min(s.caps?.traitsPerItem?.[cat] ?? 1, rarityCapFor('traits', item.rarete, s));
}

// ══════════════════════════════════════════════
// FRAGMENTS — accès au sac du personnage
// Structure : c.traitFragments = { 'arme': { 'Tranchant': 2 }, 'Tête': { ... } }
// ══════════════════════════════════════════════

export function getCharacterFragments(c) {
  return c?.traitFragments || {};
}

export function getFragmentCount(c, category, traitName) {
  return c?.traitFragments?.[category]?.[traitName] || 0;
}

// Mutation pure d'un objet traitFragments — renvoie un nouvel objet
export function _addFragment(fragments, category, traitName, delta = 1) {
  const next = { ...(fragments || {}) };
  next[category] = { ...(next[category] || {}) };
  const cur = parseInt(next[category][traitName]) || 0;
  const updated = cur + delta;
  if (updated <= 0) {
    delete next[category][traitName];
    if (!Object.keys(next[category]).length) delete next[category];
  } else {
    next[category][traitName] = updated;
  }
  return next;
}

// ══════════════════════════════════════════════
// SÉLECTION DU PERSONNAGE CIBLE
// Joueur : son perso unique (ou le seul auquel il a accès)
// MJ : sélecteur de personnage
// ══════════════════════════════════════════════

// Mode MJ : si actif, toutes les améliorations sont gratuites mais loggent
// `mjOverride: true` dans l'historique de l'item. Réservé aux admins.

// Le coût est-il finançable (or suffisant OU mode MJ gratuit actif) ?
function _canAfford(c, cost) {
  return STORE.mjFreeMode || cost <= calcOr(c);
}

function _getEligibleChars() {
  return getVisibleCharacters();
}

function _getActiveArtisanChar() {
  const chars = _getEligibleChars();
  if (!chars.length) return null;
  let active = chars.find(c => c.id === STORE.activeCharId);
  if (!active) {
    // Réutilise la sélection boutique si valide, sinon le perso favori (★), sinon le premier
    active = chars.find(c => c.id === getShopCharId())
      || getDefaultCharForUser(chars, STATE.user?.uid)
      || chars[0];
    STORE.activeCharId = active?.id || null;
  }
  return active;
}

// ══════════════════════════════════════════════
// MODALE PRINCIPALE
// ══════════════════════════════════════════════

export async function openArtisanModal() {
  await _artisanLoadSettings();
  STORE.inlineRootId = null;
  STORE.activeCharId = null; // reset à chaque ouverture
  STORE.activeItemIndex = null;
  STORE.mjFreeMode = false;          // sécurité : MJ doit ré-activer le mode gratuit à chaque session
  STORE.itemSearch = '';
  STORE.itemCategory = 'all';
  STORE.hideEmpty = false;
  STORE.operation = null;
  _renderArtisanModal();
}

export async function mountArtisanPage(rootId = 'sh-artisan-page', { reset = false } = {}) {
  await _artisanLoadSettings();
  STORE.inlineRootId = rootId;
  // Le mode gratuit n'est jamais mémorisé d'une entrée dans l'Artisan à l'autre.
  STORE.mjFreeMode = false;
  if (reset) {
    STORE.activeCharId = null;
    STORE.activeItemIndex = null;
    STORE.itemSearch = '';
    STORE.itemCategory = 'all';
    STORE.hideEmpty = false;
    STORE.operation = null;
  }
  _renderArtisanModal();
}

export function unmountArtisanPage() {
  STORE.inlineRootId = null;
}

function _renderArtisanModal() {
  const inlineRoot = STORE.inlineRootId
    ? document.getElementById(STORE.inlineRootId)
    : null;
  const previousModal = document.getElementById('modal-box');
  const previousScrollTop = previousModal?.classList.contains('modal--artisan')
    ? previousModal.scrollTop
    : 0;
  const chars = _getEligibleChars();
  const c = _getActiveArtisanChar();

  if (!chars.length) {
    if (inlineRoot) {
      inlineRoot.innerHTML = `<div class="sh-tool-empty">
        <span aria-hidden="true">🔨</span>
        <strong>Aucun personnage disponible</strong>
        <small>${STATE.isAdmin ? 'Aucun personnage n\'existe.' : 'Crée un personnage pour utiliser l\'artisan.'}</small>
      </div>`;
      return;
    }
    openModal('🔨 Amélioration', `
      <div style="padding:1rem;text-align:center;color:var(--text-dim);font-size:.9rem">
        Aucun personnage disponible.<br>
        ${STATE.isAdmin ? 'Aucun personnage n\'existe.' : 'Crée un personnage pour utiliser l\'artisan.'}
      </div>`);
    return;
  }

  // Portrait plus grand + sous-titre qui identifie le personnage (et son joueur
  // pour le MJ) → on voit d'un coup d'œil qui on améliore. Le sélecteur déroulant
  // est utilisé aussi bien en page (onglet boutique) qu'en modale.
  const _charAvatar = (ch, size) => characterAvatarHtml(ch, { size, className: 'art-char-avatar', border: '1px solid rgba(255,255,255,.14)' });
  const _charSub = (ch) => (STATE.isAdmin && ch?.ownerPseudo) ? `Joueur · ${_esc(ch.ownerPseudo)}` : 'Personnage à améliorer';
  const charSelect = (chars.length > 1 || STATE.isAdmin)
    ? `<details class="art-char-picker">
        <summary class="art-char-picker-trigger">
          ${_charAvatar(c, 44)}
          <span class="art-char-picker-copy"><small>${_charSub(c)}</small><strong>${_esc(c?.nom || '?')}</strong></span>
          <span class="art-char-picker-chevron" aria-hidden="true">⌄</span>
        </summary>
        <div class="art-char-picker-menu">
          ${chars.map(ch => `<button type="button" class="art-char-picker-option${ch.id === c?.id ? ' is-active' : ''}"
            data-action="_artisanSelectChar" data-id="${_esc(ch.id)}">
            ${_charAvatar(ch, 40)}
            <span class="art-char-picker-option-copy">
              <strong>${_esc(ch.nom || '?')}</strong>
              ${STATE.isAdmin && ch.ownerPseudo ? `<small>${_esc(ch.ownerPseudo)}</small>` : ''}
            </span>
            ${ch.id === c?.id ? '<span class="art-char-picker-check">✓</span>' : ''}
          </button>`).join('')}
        </div>
      </details>`
    : `<div class="art-char-static">
        ${_charAvatar(c, 44)}
        <span><small>Personnage à améliorer</small><strong>${_esc(c?.nom || '?')}</strong></span>
      </div>`;

  const or = c ? Math.floor(calcOr(c)) : 0;

  const mjToggle = STATE.isAdmin ? `
    <label class="art-mj-toggle${STORE.mjFreeMode ? ' is-active' : ''}">
      <input type="checkbox" ${STORE.mjFreeMode ? 'checked' : ''} data-change="_artisanToggleMjFree">
      <span class="art-mj-switch" aria-hidden="true"><span></span></span>
      <span class="art-mj-toggle-copy">
        <strong>Mode MJ gratuit</strong>
        <small>${STORE.mjFreeMode ? 'Les coûts sont ignorés' : 'Les coûts restent appliqués'}</small>
      </span>
      <span class="art-mj-toggle-state">${STORE.mjFreeMode ? 'Actif' : 'Inactif'}</span>
    </label>` : '';

  const toolbar = `
    <div class="art-toolbar">
      <div class="art-toolbar-character">${charSelect}</div>
      ${mjToggle}
      <div class="art-wallet"><small>Solde</small><strong>💰 ${or} PO</strong></div>
    </div>`;

  const modalBody = `${toolbar}

    <div class="art-layout">
      <div class="art-left">
        <div class="art-left-hd">🛠️ Ton équipement</div>
        ${_renderItemList(c)}
        ${_renderFragmentBag(c)}
      </div>
      <div class="art-right">
        ${_renderWorkbench(c)}
      </div>
    </div>
  `;

  const mjBanner = STATE.isAdmin ? `<div class="art-mj-banner${STORE.mjFreeMode ? ' is-active' : ''}">
    <strong>Maître du jeu</strong>
    <label><input type="checkbox" ${STORE.mjFreeMode ? 'checked' : ''} data-change="_artisanToggleMjFree"><span class="art-mj-switch" aria-hidden="true"><span></span></span><b>Mode gratuit</b></label>
    <span>${STORE.mjFreeMode ? 'Coûts et conditions ignorés. Les opérations sont marquées MJ dans l’historique.' : 'Les coûts et conditions s’appliquent comme pour le joueur.'}</span>
  </div>` : '';

  const inlineBody = `${mjBanner}
    <div class="art-shell">
      <section class="art-panel art-equipment-pane">
        <div class="art-panel-head">
          <h2>Équipement<small>${_getEligibleItems(c).length} pièce${_getEligibleItems(c).length > 1 ? 's' : ''} améliorable${_getEligibleItems(c).length > 1 ? 's' : ''}</small></h2>
        </div>
        ${_renderItemFilters(c)}
        <div id="art-inline-item-list">${_renderItemList(c)}</div>
      </section>
      <main class="art-workbench-pane">
        <div id="art-inline-workbench">${_renderWorkbench(c)}</div>
      </main>
      <aside class="art-panel art-resources-pane">
        ${_renderFragmentBag(c, { page: true })}
      </aside>
    </div>`;

  if (inlineRoot) {
    inlineRoot.innerHTML = inlineBody;
    return;
  }

  openModal('🔨 Amélioration d\'équipement', modalBody,
    { subtitle: 'Choisis un objet à gauche pour l\'améliorer', accent: '#f4c430' });
  const modal = document.getElementById('modal-box');
  modal?.classList.add('modal--artisan');
  if (modal && previousScrollTop > 0) modal.scrollTop = previousScrollTop;
}

// ── Sac de fragments ────────────────────────────────────────────────
function _getEligibleItems(c) {
  const inv = Array.isArray(c?.inventaire) ? c.inventaire : [];
  return inv
    .map((it, idx) => ({ it, idx, cat: getItemFragmentCategory(it) }))
    .filter(({ cat }) => cat !== null);
}

function _renderItemFilters(c) {
  const eligible = _getEligibleItems(c);
  const counts = eligible.reduce((acc, { cat, it }) => {
    const family = _artisanFamily(cat, it);
    acc[family] = (acc[family] || 0) + 1;
    return acc;
  }, {});
  counts.all = eligible.length;
  const families = ARTISAN_FAMILIES.filter(family => family.id === 'all' || counts[family.id]);
  return `<div class="art-item-tools">
    <div class="art-item-search">
      <span aria-hidden="true">⌕</span>
      <input type="search" value="${_esc(STORE.itemSearch)}" placeholder="Rechercher une pièce, un trait…"
        data-input="_artisanFilterItems" aria-label="Rechercher un équipement améliorable">
    </div>
    <div class="art-item-categories" role="group" aria-label="Filtrer par famille">
      ${families.map(family => `<button type="button" class="art-item-category${STORE.itemCategory === family.id ? ' is-active' : ''}"
        data-action="_artisanFilterCategory" data-category="${family.id}" aria-pressed="${STORE.itemCategory === family.id}" title="${_esc(family.label)}">${family.icon ? `<i aria-hidden="true">${family.icon}</i>` : ''}${_esc(family.label)} <span>${counts[family.id] || 0}</span></button>`).join('')}
    </div>
  </div>`;
}

function _renderFragmentBag(c, { page = false } = {}) {
  const bag = getCharacterFragments(c);
  const selected = (c?.inventaire || [])[STORE.activeItemIndex];
  const selectedCategory = selected ? getItemFragmentCategory(selected) : null;
  // Le sac est construit sur les clés RÉELLEMENT présentes (slots par défaut ou
  // personnalisés compris), pas sur une liste figée : une catégorie inconnue
  // garde son nom comme libellé et un glyphe générique.
  const _catMeta = id => FRAGMENT_CAT_BY_ID[id] || { id, label: id, icon: '◆' };
  const fragmentEntries = Object.entries(bag).flatMap(([catId, traits]) => Object.entries(traits || {})
    .filter(([, qty]) => (parseInt(qty, 10) || 0) > 0)
    .map(([name, qty]) => ({ category: _catMeta(catId), name, qty: parseInt(qty, 10) || 0 })))
    .sort((a, b) => a.category.label.localeCompare(b.category.label, 'fr') || a.name.localeCompare(b.name, 'fr'));
  const totalCount = fragmentEntries.reduce((sum, entry) => sum + entry.qty, 0);
  const fragmentRow = entry => {
    const mine = selectedCategory === entry.category.id;
    return `<div class="art-fragment-row${mine ? ' is-compatible' : ''}" data-fragment-category="${_esc(entry.category.id)}"><span class="art-fragment-glyph">◆</span><span><b>${_esc(entry.name)}</b><small>Fragment ${_esc(entry.category.label.toLowerCase())}</small></span><em>×${entry.qty}</em>${mine ? `<button type="button" data-action="_artisanTraitPanel" data-i="${STORE.activeItemIndex}" data-frag="${_esc(entry.name)}">Poser</button>` : `<button type="button" data-action="_artisanSelectCompatible" data-category="${_esc(entry.category.id)}">Voir</button>`}</div>`;
  };
  const mine = fragmentEntries.filter(entry => entry.category.id === selectedCategory);
  const others = fragmentEntries.filter(entry => entry.category.id !== selectedCategory);

  const materialReq = selected ? (_reforgeContext(selected, c).materialReq || []) : [];
  const reqById = new Map(materialReq.map(req => [req.itemId, req]));
  const materialIds = new Set(materialReq.map(req => req.itemId));
  const collectIds = value => {
    if (!value || typeof value !== 'object') return;
    if (value.itemId) materialIds.add(String(value.itemId));
    Object.values(value).forEach(collectIds);
  };
  collectIds(getCraftSettings()?.recipes || {});
  const materials = [...materialIds].map(itemId => {
    const req = reqById.get(itemId);
    const owned = countInventoryItem(c?.inventaire || [], itemId);
    const shopItem = STORE.shopItems.find(entry => entry.id === itemId);
    const invItem = (c?.inventaire || []).find(entry => entry?.itemId === itemId);
    return { itemId, req, owned, shopItem, name: shopItem?.nom || invItem?.nom || 'Matériau' };
  }).filter(entry => entry.req || entry.owned > 0).sort((a, b) => Number(!!b.req) - Number(!!a.req) || a.name.localeCompare(b.name, 'fr'));
  const materialRow = entry => `<div class="art-material-row${entry.req ? ' is-required' : ''}${entry.req && entry.owned >= entry.req.quantite ? ' is-ready' : ''}"><span class="art-material-glyph">⬡</span><span><b>${_esc(entry.name)}</b>${entry.req ? `<small>Reforge : ${entry.req.quantite} requis</small>` : '<small>Matériau d’artisanat</small>'}</span><em>${entry.owned}</em>${entry.req && entry.shopItem && entry.owned < entry.req.quantite ? `<button type="button" data-sh-action="cartInc" data-id="${_esc(entry.itemId)}">Panier +</button>` : ''}</div>`;

  return `<div class="art-frag-bag${page ? ' art-frag-bag--page' : ''}${STORE.resourceFlash ? ' is-flash' : ''}"><div class="art-panel-head"><h2>Ton sac<small>Fragments et matériaux</small></h2></div><section class="art-bag-section"><header><b>Fragments</b><em>${totalCount}</em></header>${!fragmentEntries.length ? '<p class="art-frag-empty">Aucun fragment pour l’instant.</p>' : ''}${mine.length ? `<h3>Pour cette pièce</h3>${mine.map(fragmentRow).join('')}` : selectedCategory ? '<p class="art-frag-empty">Aucun fragment compatible avec cette pièce.</p>' : ''}${others.length ? `<h3>${selected ? 'Pour d’autres pièces' : 'Tous'}</h3>${others.map(fragmentRow).join('')}` : ''}</section><section class="art-bag-section"><header><b>Matériaux</b><em>${materials.reduce((sum, entry) => sum + entry.owned, 0)}</em></header>${materials.length ? `${materialReq.length ? '<h3>Pour cette pièce</h3>' : ''}${materials.map(materialRow).join('')}` : '<p class="art-frag-empty">Aucun matériau pour l’instant.</p>'}</section><div class="art-cycle"><strong>Le cycle de l’artisan</strong><ol><li>Démonte une pièce qui porte un trait.</li><li>Son trait devient un fragment dans ton sac.</li><li>Pose ce fragment sur une pièce de la même catégorie.</li></ol></div></div>`;
}

// Résumé d'un item pour la liste (traits + bonus de stats en une ligne courte).
function _itemSummary(item) {
  const totalTraits = _getTraits(item).length;
  const slotCount = getItemTraitsSlotCount(item);
  const upBonus = ITEM_STAT_META
    .map(m => [m.short, getItemUpgradeStatBonus(item, m.full)])
    .filter(([, v]) => v > 0)
    .map(([s, v]) => `+${v}${s}`).join(' ');
  const parts = [];
  if (slotCount > 0) parts.push(`${totalTraits}/${slotCount} trait${slotCount > 1 ? 's' : ''}`);
  if (upBonus) parts.push(upBonus);
  return parts.join(' · ');
}

function _artisanHeroProperties(item = {}) {
  const toucher = item.toucherStat || item.statAttaque || item.toucher || '';
  const toucherMeta = ITEM_STAT_META.find(meta => [meta.full, meta.store, ...(meta.aliases || [])].includes(String(toucher).toLowerCase()));
  return [
    item.degats ? ['Dégâts', item.degats] : null,
    toucher ? ['Toucher', toucherMeta?.short || String(toucher).slice(0, 3).toUpperCase()] : null,
    Number(item.ca) || Number(item.caBonus) ? ['CA', `${(Number(item.ca) || 0) + (Number(item.caBonus) || 0)}`] : null,
    item.portee ? ['Portée', item.portee] : null,
  ].filter(Boolean).map(([label, value]) => `<span class="art-hero-fact"><small>${_esc(label)}</small><b>${_esc(value)}</b></span>`).join('');
}

function _artisanHeroStats(item = {}) {
  const stats = ITEM_STAT_META.map(meta => {
    const base = getItemBaseStatBonus(item, meta.full);
    const upgrade = getItemUpgradeStatBonus(item, meta.full);
    const total = base + upgrade;
    return total ? `<span class="art-hero-stat" style="--stat:${ARTISAN_STAT_COLORS[meta.full] || '#8294ad'}"><b>${meta.short}</b>${total > 0 ? '+' : ''}${total}${upgrade ? `<i>+${upgrade}</i>` : ''}</span>` : '';
  }).filter(Boolean);
  const effect = Math.max(0, parseInt(item.upgrades?.effectBonus, 10) || 0);
  const derived = [
    ['PV', item.pvMaxBonus], ['PM', item.pmMaxBonus], ['Vit', item.vitesseBonus], ['Init', item.initiativeBonus],
  ].filter(([, value]) => Number(value) > 0).map(([label, value]) => `<span class="art-hero-derived">${label} +${Number(value) + effect}${effect ? `<i>+${effect} artisan</i>` : ''}</span>`);
  return [...stats, ...derived].join('');
}

// ── Liste des objets améliorables (colonne gauche, sélectionnable) ──────
function _renderItemList(c) {
  if (!c) return `<div class="art-empty">Sélectionne un personnage.</div>`;
  const allEligible = _getEligibleItems(c);
  const q = _norm(STORE.itemSearch);
  const eligible = allEligible.filter(({ it, cat }) => {
    if (STORE.itemCategory !== 'all' && _artisanFamily(cat, it) !== STORE.itemCategory) return false;
    if (!q) return true;
    const meta = FRAGMENT_CAT_BY_ID[cat];
    const haystack = [
      it.nom,
      it.format,
      it.type,
      it.sousType,
      it.slotArmure,
      it.slotBijou,
      meta?.label,
      ..._getTraits(it),
      _itemSummary(it),
    ].filter(Boolean).join(' ');
    return _searchIncludes(haystack, q);
  }).filter(({ it }) => !STORE.hideEmpty || !isMaxed(c, it, { upgrade: getUpgradeSettings() }));

  if (!allEligible.length) {
    return `<div class="art-empty">Aucun équipement améliorable dans l'inventaire.<br>
      <span style="font-size:.9em">Achète une arme, une armure ou un bijou dans la boutique.</span></div>`;
  }

  if (!eligible.length) {
    return `<div class="art-empty">Aucun équipement ne correspond à ces filtres.</div>`;
  }

  const equippedIndices = new Set(Object.values(c.equipement || {}).map(eq => Number(eq?.sourceInvIndex)).filter(Number.isInteger));
  const maxRarity = Math.max(5, ...getRarities().map(rarity => Number(rarity.value) || 0));
  const row = ({ it, idx, cat }) => {
      const meta = FRAGMENT_CAT_BY_ID[cat];
      const active = idx === STORE.activeItemIndex;
      const traits = _getTraits(it).length;
      const traitCap = getItemTraitsSlotCount(it);
      const traitFamilyCap = traitCapAt(it, maxRarity, getUpgradeSettings());
      const stats = statPointUse(it), statCap = statCapAt(it, it.rarete, getUpgradeSettings());
      const statFamilyCap = statCapAt(it, maxRarity, getUpgradeSettings());
      const reforge = _reforgeContext(it, c).ev;
      const actions = possibleActions(c, it, { upgrade: getUpgradeSettings(), gold: calcOr(c), freeMode: STORE.mjFreeMode, reforgeEval: reforge });
      const possible = [actions.addTrait && 'Poser un trait', actions.stat && 'Améliorer une stat', actions.reforge && 'Reforger'].filter(Boolean);
      const rarete = Math.max(1, parseInt(it.rarete, 10) || 1);
      const rarityName = RARETE_NAMES[rarete] || `Rareté ${rarete}`;
      const rarityColor = _rareteColor(rarityName) || '#8294ad';
      const meter = (used, cap, familyCap, tone) => familyCap > 0 ? `<span class="art-mini-meter is-${tone}" title="${tone === 'trait' ? 'Traits' : 'Points de stats'} : ${used}/${cap}">${Array.from({ length: familyCap }, (_, k) => `<i class="${k < used ? 'is-used' : k < cap ? 'is-free' : 'is-locked'}"></i>`).join('')}</span>` : '';
      const type = it.format || it.typeArmure || it.slotBijou || meta?.label || cat;
      const status = possible.length
        ? `<span class="art-item-possible" title="Possible maintenant : ${_esc(possible.join(', '))}">${possible.length} possible${possible.length > 1 ? 's' : ''}</span>`
        : isMaxed(c, it, { upgrade: getUpgradeSettings(), gold: calcOr(c), freeMode: STORE.mjFreeMode, reforgeEval: reforge })
          ? '<span class="art-item-maxed" title="Plus rien à améliorer sur cette pièce">Au max</span>' : '';
      return `<button class="art-item-card${active ? ' is-active' : ''}${STORE.flash === idx ? ' is-flash' : ''}" data-action="_artisanSelectItem" data-i="${idx}" style="--art-rarity:${rarityColor}" aria-pressed="${active}">
        ${_artisanItemVisual(it, cat)}
        <span class="art-item-card-body">
          <span class="art-item-name">${_esc(it.nom || 'Sans nom')}</span>
          <span class="art-item-rarity"><i>${'★'.repeat(Math.min(5, rarete))}</i> ${_esc(rarityName)} · ${_esc(type)}</span>
          <span class="art-item-meters">${meter(traits, traitCap, traitFamilyCap, 'trait')}${meter(stats, statCap, statFamilyCap, 'stat')}</span>
        </span>
        <span class="art-item-state">${status}</span>
      </button>`;
    };
  const equipped = eligible.filter(entry => equippedIndices.has(entry.idx));
  const bag = eligible.filter(entry => !equippedIndices.has(entry.idx));
  const group = (label, entries) => entries.length ? `<div class="art-item-group"><div class="art-item-group-title">${label}<span>${entries.length}</span></div>${entries.map(row).join('')}</div>` : '';
  return `<div class="art-item-list">${group('Équipé', equipped)}${group('Dans ton sac', bag)}</div>`;
}

// ── Établi (colonne droite) : tout ce qu'on peut faire à l'objet choisi ──
function _renderWorkbench(c) {
  if (!c) return '';
  if (STORE.activeItemIndex == null) {
    return `<section class="art-panel art-wb-empty"><span aria-hidden="true">◇</span><b>Choisis une pièce</b><p>Sélectionne une pièce dans la liste pour voir tout ce que tu peux lui faire.</p></section>`;
  }
  const item = (c.inventaire || [])[STORE.activeItemIndex];
  const cat = item ? getItemFragmentCategory(item) : null;
  if (!item || !cat) { STORE.activeItemIndex = null; return _renderWorkbench(c); }
  const meta = FRAGMENT_CAT_BY_ID[cat];
  const i = STORE.activeItemIndex;

  const allTraits = _getTraits(item);
  const historyCount = Array.isArray(item?.upgrades?.history) ? item.upgrades.history.length : 0;

  const rarity = Math.max(1, parseInt(item.rarete, 10) || 1);
  const traitCap = getItemTraitsSlotCount(item);
  const statCap = statCapAt(item, rarity, getUpgradeSettings());
  const statUsed = statPointUse(item);
  const nextGain = firstGainRarity(item, getUpgradeSettings());
  const equipped = Object.entries(c.equipement || {}).find(([, eq]) => Number(eq?.sourceInvIndex) === i)?.[0] || '';
  const rarityName = RARETE_NAMES[rarity] || `Rareté ${rarity}`;
  const rarityColor = _rareteColor(rarityName) || '#8294ad';
  const type = item.format || item.typeArmure || item.slotBijou || meta?.label || cat;
  const typeDetail = cat === 'arme' ? `${type} · ${weaponHandsLabel(item)}` : type;
  const traitUnlock = unlockRarity(item, 'traits', traitCap + 1, getUpgradeSettings());
  const statUnlock = unlockRarity(item, 'stats', statCap + 1, getUpgradeSettings());
  const capacityValue = value => {
    const match = String(value).match(/^(\d+)\/(\d+)$/);
    return match
      ? `<strong><span>${match[1]}</span><small>/${match[2]}</small></strong>`
      : `<strong><span>${_esc(value)}</span></strong>`;
  };
  const capacity = (label, value, sub, tone, target) => `<button type="button" class="art-capacity is-${tone}" data-action="_artisanScrollSection" data-target="${target}"><span class="art-capacity-label"><i aria-hidden="true"></i>${label}</span>${capacityValue(value)}<span class="art-capacity-sub">${sub}</span></button>`;
  const traitSub = traitCap > allTraits.length
    ? `${traitCap - allTraits.length} libre${traitCap - allTraits.length > 1 ? 's' : ''}${traitUnlock ? ` · +1 en ${RARETE_NAMES[traitUnlock] || traitUnlock}` : ''}`
    : traitUnlock ? `+1 en ${RARETE_NAMES[traitUnlock] || traitUnlock}` : 'Capacité atteinte';
  const statValue = statCap ? `${statUsed}/${statCap}` : '—';
  const statSub = statCap > statUsed
    ? `${statCap - statUsed} disponible${statCap - statUsed > 1 ? 's' : ''}${statUnlock ? ` · +1 en ${RARETE_NAMES[statUnlock] || statUnlock}` : ''}`
    : statUnlock ? `+1 en ${RARETE_NAMES[statUnlock] || statUnlock}` : statCap ? 'Capacité atteinte' : 'Non applicable';
  const nextRarity = _reforgeContext(item, c).ev.target;
  const raritySub = nextRarity ? (nextGain === nextRarity ? `Débloque de la capacité en ${RARETE_NAMES[nextRarity] || nextRarity}` : `Prochaine : ${RARETE_NAMES[nextRarity] || nextRarity}`) : 'Rareté maximale';

  return `<div class="art-wb">
    <section class="art-panel art-wb-hero" style="--art-rarity:${rarityColor}">
      <div class="art-hero-top">
        ${_artisanItemVisual(item, cat, 'art-hero-image')}
        <div class="art-wb-identity"><h2>${_esc(item.nom || 'Sans nom')}</h2><div><span class="art-rarity-pill">${'★'.repeat(Math.min(5, rarity))} ${_esc(rarityName)}</span><span>${_esc(typeDetail)}</span>${equipped ? `<span class="art-equipped-badge">✓ Équipement · ${_esc(equipped.toLowerCase())}</span>` : '<span>Dans ton sac</span>'}</div><div class="art-hero-properties">${_artisanHeroProperties(item)}${_artisanHeroStats(item)}</div></div>
        <button class="art-wb-hist" data-action="_artisanOpenHistory" data-i="${i}"${historyCount ? '' : ' disabled'}><span aria-hidden="true">↶</span> Historique${historyCount ? `<em>${historyCount}</em>` : ''}</button>
      </div>
    <div class="art-capacities">
      ${capacity('Traits', `${allTraits.length}/${traitCap}`, traitSub, 'trait', 'art-section-traits')}
      ${capacity('Points de stats', statValue, statSub, 'stat', 'art-section-stats')}
      ${capacity('Rareté', rarityName, raritySub, 'rarity', 'art-section-reforge')}
    </div>
    </section>
    <div id="art-section-traits">${_renderTraitsSection(item, i, c, cat)}</div>
    <div id="art-section-stats">${_renderStatsSection(item, i, c, cat)}</div>
    <div id="art-section-reforge">${_renderReforgeSection(item, i, c)}</div>
    ${_renderRecycleSection(item, i, cat, c)}
  </div>`;
}

function _renderOperationPanel(item, invIndex, c, cat, onlyType = '') {
  const op = STORE.operation;
  if (!op || op.invIndex !== invIndex || (onlyType && op.type !== onlyType)) return '';
  const close = '<button type="button" class="art-op-close" data-action="_artisanCloseOperation" aria-label="Fermer">×</button>';
  const s = getUpgradeSettings();
  const fragments = Object.entries(c.traitFragments?.[cat] || {}).filter(([, qty]) => (parseInt(qty, 10) || 0) > 0);
  if (op.type === 'trait') {
    const replace = !!op.oldTrait;
    return `<section class="art-op-panel"><header><span><small>${replace ? 'Remplacer un trait' : 'Ajouter un trait'}</small><strong>${replace ? `« ${_esc(op.oldTrait)} » sera perdu` : 'Choisis un fragment compatible'}</strong></span>${close}</header>
      <div class="art-op-options">${fragments.map(([name, qty]) => `<button type="button" class="${op.fragment === name ? 'is-selected' : ''}" data-action="_artisanOperationFragment" data-frag="${_esc(name)}"><span>◆ ${_esc(name)}</span><b>×${qty}</b></button>`).join('') || '<p>Aucun fragment compatible.</p>'}</div>
      ${replace ? `<p class="art-op-warning">« ${_esc(op.oldTrait)} » sera perdu : il ne revient pas dans ton sac.</p>` : ''}
      <footer><span>${STORE.mjFreeMode ? 'Gratuit (MJ) · solde non débité' : `${replace ? s.trait.overwriteTrait : s.trait.addTraitFromFragment} or · consomme 1 fragment`}</span><button type="button" class="art-op-confirm${replace ? ' is-replace' : ''}" data-action="_artisanConfirmOperation" ${op.fragment ? '' : 'disabled'}>${replace ? 'Remplacer définitivement' : op.fragment ? `Poser « ${_esc(op.fragment)} »` : 'Choisis un fragment'}</button></footer>
    </section>`;
  }
  if (op.type === 'stat') {
    const meta = ITEM_STAT_BY_FULL[op.stat];
    return `<section class="art-op-panel"><header><span><small>Amélioration de statistique</small><strong>Ajouter +1 ${_esc(meta?.label || op.stat || 'Effet')}</strong></span>${close}</header>
      <p class="art-op-copy">La modification est appliquée à cette pièce et immédiatement synchronisée si elle est équipée.</p>
      <footer><span>${STORE.mjFreeMode ? 'Gratuit · mode MJ' : `${op.cost || 0} PO`}</span><button type="button" class="art-op-confirm" data-action="_artisanConfirmOperation">Confirmer</button></footer></section>`;
  }
  if (op.type === 'dismantle') {
    const preview = dismantlePreview(item, s, getCraftSettings());
    const extractAll = s.trait.extractAllTraits;
    const selectable = preview.recoveredTraits;
    return `<section class="art-op-panel is-danger"><header><span><small>Démontage définitif</small><strong>${_esc(item.nom || 'Objet')}</strong></span>${close}</header>
      <div class="art-dis-preview"><div><b>Récupéré</b>${preview.materials.map(req => `<span>⬡ ${req.quantite}× ${_esc(STORE.shopItems.find(x => x.id === req.itemId)?.nom || 'matériau')}</span>`).join('') || '<span>Aucun matériau</span>'}${selectable.map(name => `<label><input type="radio" name="art-dis-trait" data-change="_artisanDismantleTrait" value="${_esc(name)}" ${extractAll || op.trait === name ? 'checked' : ''} ${extractAll ? 'disabled' : ''}>◆ ${_esc(name)}</label>`).join('')}</div>
      <div><b>Perdu</b>${preview.lostTraits.map(name => `<span>🔒 ${_esc(name)}</span>`).join('') || '<span>Rien de verrouillé</span>'}<span>L’objet d’origine</span></div></div>
      <footer><span>${STORE.mjFreeMode ? 'Gratuit · mode MJ' : `${preview.cost} PO`} · irréversible</span><button type="button" class="art-op-confirm is-danger" data-action="_artisanConfirmOperation" ${(selectable.length > 1 && !extractAll && !op.trait) ? 'disabled' : ''}>Démonter</button></footer></section>`;
  }
  return '';
}

// ── Toggle MJ gratuit (admins seulement) ────────────────────────────
function _artisanToggleMjFree(on) {
  if (!STATE.isAdmin) { STORE.mjFreeMode = false; return; }
  STORE.mjFreeMode = !!on;
  _renderArtisanModal();
}

// ── Historique des améliorations d'un item ─────────────────────────
function _artisanOpenHistory(invIndex) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = (c.inventaire || [])[invIndex];
  if (!item) return;
  const hist = Array.isArray(item.upgrades?.history) ? item.upgrades.history : [];

  const fmt = (e, idx) => {
    const d = new Date(e.at || 0);
    const date = isNaN(d) ? '?' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    const op = e.op || 'upgrade';
    const detail = _upgradeEntryLabel(e);
    const cost = parseInt(e.cost) || 0;
    const mj = e.mjOverride ? '<span class="art-history-mj">MJ</span>' : '';
    const action = STATE.isAdmin
      ? op === 'reforge'
        ? '<small class="art-history-locked">non annulable</small>'
        : `<button type="button" class="art-history-undo" data-action="_artisanRevertUpgrade" data-i="${invIndex}" data-h="${idx}" title="Retirer l’effet et rembourser">↶ Annuler</button>`
      : '';
    return `<div class="art-history-line"><span><b>${_esc(detail || op)}${mj}</b><small>${date}</small></span><strong>${cost ? `${cost} or` : 'Gratuit'}</strong>${action}</div>`;
  };

  const totalCost = hist.reduce((s, e) => s + (parseInt(e.cost) || 0), 0);
  const body = hist.length
    ? `<div class="art-history-list">${hist.map(fmt).reverse().join('')}</div><div class="art-history-total"><span>Total investi</span><strong>${totalCost} or</strong></div>`
    : '<div class="art-history-empty">Aucune amélioration pour cette pièce.</div>';

  pushModal(`Historique — ${_esc(item.nom || 'objet')}`, `<div class="art-history">${body}${STATE.isAdmin ? '<p>Annuler retire l’effet, rembourse l’or et rend le fragment consommé.</p>' : ''}<footer><button type="button" class="btn btn-outline btn-sm" data-action="_artisanCloseModal">Fermer</button></footer></div>`);
};

// ══════════════════════════════════════════════
// HELPERS DE PERSISTANCE & SYNCHRONISATION
// ══════════════════════════════════════════════

// Regénère tous les slots équipés à partir de l'inventaire courant.
// Utile après mutation d'un item d'inventaire pour propager les nouveaux traits/stats.
function _rebuildAllEquipment(c) {
  const inv = Array.isArray(c.inventaire) ? c.inventaire : [];
  const equip = c.equipement || {};
  const next = {};

  Object.entries(equip).forEach(([slot, eq]) => {
    const idx = Number.isInteger(eq?.sourceInvIndex) ? eq.sourceInvIndex : parseInt(eq?.sourceInvIndex, 10);
    if (Number.isInteger(idx) && inv[idx]) {
      const rebuilt = buildEquippedItemFromInventory(slot, inv[idx], idx);
      if (rebuilt) next[slot] = rebuilt;
    } else if (eq) {
      // Slot équipé sans lien d'inventaire (saisi manuellement) : on garde tel quel
      next[slot] = eq;
    }
  });

  return next;
}

// Ajoute une dépense au ledger du personnage.
// En mode MJ gratuit, on ne débite pas le ledger.
function _logExpense(c, label, amount) {
  if (STORE.mjFreeMode || amount <= 0) return;
  const compte = c.compte || { recettes: [], depenses: [] };
  const depenses = Array.isArray(compte.depenses) ? [...compte.depenses] : [];
  depenses.push({
    date: new Date().toISOString().slice(0, 10),
    libelle: label,
    montant: amount,
  });
  c.compte = { ...compte, depenses };
}

// Ajoute une entrée à l'historique d'amélioration de l'item.
// En mode MJ gratuit, le coût est forcé à 0 et l'override est tracé.
function _logUpgradeHistory(item, entry) {
  const up = item.upgrades || {};
  const history = Array.isArray(up.history) ? [...up.history] : [];
  history.push({
    at: Date.now(),
    by: STATE.user?.uid || null,
    ...entry,
    cost: STORE.mjFreeMode ? 0 : (parseInt(entry.cost) || 0),
    mjOverride: !!STORE.mjFreeMode,
  });
  item.upgrades = { ...up, history };
}

// Recrédite l'or dépensé pour une amélioration annulée. Symétrique de
// `_logExpense` : on ajoute une recette au compte (calcOr = recettes − dépenses).
// Repli sur l'ancien champ `or` direct si le perso n'a pas de ledger.
function _refundGold(c, amount, label) {
  const gain = parseInt(amount) || 0;
  if (gain <= 0) return;
  const compte = c.compte || { recettes: [], depenses: [] };
  const hasLedger = (compte.recettes?.length || compte.depenses?.length);
  if (hasLedger) {
    const recettes = Array.isArray(compte.recettes) ? [...compte.recettes] : [];
    recettes.push({ date: new Date().toISOString().slice(0, 10), libelle: label, montant: gain });
    c.compte = { ...compte, recettes };
  } else {
    c.or = (parseInt(c.or) || 0) + gain;
  }
}

// Libellé lisible d'une entrée d'historique (pour la confirmation de suppression).
const _UPGRADE_OP_LABEL = {
  ring_upgrade_stat:   'Anneau — stat',
  amulet_add_stat:     'Amulette — stat',
  weapon_add_point:    'Arme — point',
  armor_add_point:     'Armure — point',
  ring_upgrade_effect: "Anneau — effet",
  add_trait:           'Trait ajouté',
  overwrite_trait:     'Trait remplacé',
};
function _upgradeEntryLabel(e = {}) {
  const meta = e.stat ? ITEM_STAT_BY_FULL[e.stat] : null;
  const bits = [_UPGRADE_OP_LABEL[e.op] || e.op || 'amélioration'];
  if (meta) bits.push(`${meta.short}${e.level ? ` (palier ${e.level})` : ''}`);
  if (e.op === 'ring_upgrade_effect' && e.level) bits.push(`palier ${e.level}`);
  if (e.op === 'add_trait' && e.value) bits.push(`« ${e.value} »`);
  if (e.op === 'overwrite_trait') bits.push(`${e.from || '?'} → ${e.to || '?'}`);
  return bits.join(' · ');
}

// MJ : supprime UNE amélioration de l'historique et annule son effet sur l'objet
// (stat/effet/trait), recrédite l'or dépensé et restitue le fragment consommé
// pour les opérations de traits. Réservé aux admins. Le recyclage (destruction
// de l'objet) n'est pas concerné : l'objet n'existe plus, il n'a plus d'historique.
async function _artisanRevertUpgrade(invIndex, histIndex) {
  if (!STATE.isAdmin) { showNotif('Réservé au MJ.', 'error'); return; }
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = (c.inventaire || [])[invIndex];
  if (!item) return;
  const hist = Array.isArray(item.upgrades?.history) ? item.upgrades.history : [];
  const entry = hist[histIndex];
  if (!entry) return;

  const cat = getItemFragmentCategory(item);
  const label = _upgradeEntryLabel(entry);
  const refund = parseInt(entry.cost) || 0;
  const fragOps = entry.op === 'add_trait' || entry.op === 'overwrite_trait';
  const fragName = entry.op === 'add_trait' ? entry.value : (entry.op === 'overwrite_trait' ? entry.to : null);

  const notes = [
    "L'objet perd cet effet.",
    refund > 0 ? `<span style="color:var(--gold)">${refund} PO</span> recrédités.` : null,
    (fragOps && fragName && cat) ? `Fragment « ${_esc(fragName)} » restitué.` : null,
  ].filter(Boolean).join(' ');

  if (!await confirmModal(
    `Supprimer cette amélioration ?<br><b>${_esc(label)}</b><br><span style="opacity:.8;font-size:.9em">${notes}</span>`,
    { title: '🗑 Corriger — supprimer l\'amélioration', confirmLabel: 'Supprimer', danger: true, icon: '🗑' })) return;

  const inv = [...(c.inventaire || [])];
  const newItem = { ...item };
  const up = { ...(newItem.upgrades || {}) };
  const sb = { ...(up.statBonus || {}) };
  const decStat = (fullKey) => {
    const meta = ITEM_STAT_BY_FULL[fullKey];
    if (!meta) return;
    const v = (parseInt(sb[meta.store]) || 0) - 1;
    if (v > 0) sb[meta.store] = v; else delete sb[meta.store];
  };
  const fragmentsToRestore = [];

  switch (entry.op) {
    case 'ring_upgrade_stat':
    case 'amulet_add_stat':
    case 'weapon_add_point':
    case 'armor_add_point':
      decStat(entry.stat);
      break;
    case 'ring_upgrade_effect': {
      const v = (parseInt(up.effectBonus) || 0) - 1;
      up.effectBonus = v > 0 ? v : 0;
      break;
    }
    case 'add_trait': {
      const added = Array.isArray(up.addedTraits) ? [...up.addedTraits] : [];
      const idx = added.indexOf(entry.value);
      if (idx >= 0) added.splice(idx, 1);
      up.addedTraits = added;
      if (cat && entry.value) fragmentsToRestore.push(entry.value);
      break;
    }
    case 'overwrite_trait': {
      const added = Array.isArray(up.addedTraits) ? [...up.addedTraits] : [];
      const removedBase = Array.isArray(up.removedBaseTraits) ? [...up.removedBaseTraits] : [];
      const ti = added.indexOf(entry.to);            // retire le trait posé
      if (ti >= 0) added.splice(ti, 1);
      const rb = removedBase.indexOf(entry.from);
      if (rb >= 0) removedBase.splice(rb, 1);          // l'ancien était un trait de base masqué → on le ré-affiche
      else if (entry.from) added.push(entry.from);     // sinon c'était un trait ajouté → on le remet
      up.addedTraits = added;
      up.removedBaseTraits = removedBase;
      if (cat && entry.to) fragmentsToRestore.push(entry.to);
      break;
    }
    default: break; // op inconnu → on retire seulement la ligne d'historique
  }

  up.statBonus = sb;
  up.history = [...hist.slice(0, histIndex), ...hist.slice(histIndex + 1)];
  newItem.upgrades = up;
  inv[invIndex] = newItem;
  c.inventaire = inv;

  if (fragmentsToRestore.length && cat) {
    let frags = c.traitFragments || {};
    fragmentsToRestore.forEach(name => { frags = _addFragment(frags, cat, name, +1); });
    c.traitFragments = frags;
  }
  _refundGold(c, refund, `Artisan : correction — ${label}`);

  await _persistChar(c);
  showNotif('Amélioration supprimée.', 'success');
}

// Persiste le perso (inventaire + traitFragments + compte + equipement + statsBonus)
// puis re-render la modale principale.
async function _persistChar(c) {
  c.equipement = _rebuildAllEquipment(c);
  c.statsBonus = computeEquipStatsBonus(c.equipement);
  patchBuildLocally(c, { equipement: c.equipement, statsBonus: c.statsBonus });
  await trySave('characters', c.id, {
    inventaire:     c.inventaire     || [],
    traitFragments: c.traitFragments || {},
    compte:         c.compte         || { recettes: [], depenses: [] },
    equipement:     c.equipement,
    statsBonus:     c.statsBonus,
    builds:         characterBuildsForStorage(c),
    activeBuildId:  c.activeBuildId,
    ...(Array.isArray(c.inventoryHistory) ? { inventoryHistory: c.inventoryHistory } : {}),
  });
  STORE.operation = null;
  STORE.flash = STORE.activeItemIndex;
  closeModalDirect();
  _renderArtisanModal();
  setTimeout(() => { STORE.flash = null; STORE.resourceFlash = false; }, 1400);
}

// ══════════════════════════════════════════════
// ÉTABLI — SECTION REFORGE (monter la rareté, gatée Bastion — Option A)
// ══════════════════════════════════════════════

const _ROOM_LABEL_DEFAULT = {
  forge: '🔨 Forge',
  atelier_confection: '🧵 Atelier de confection',
  atelier_orfevre: '💎 Atelier d\'orfèvre',
};
// Libellé lisible d'une salle : catalogue de l'aventure si dispo, sinon défaut.
function _roomLabel(slug) {
  const cat = STORE.bastion?.roomCatalog;
  const found = Array.isArray(cat) ? cat.find(r => r?.slug === slug) : null;
  if (found) return `${found.emoji || ''} ${found.nom || slug}`.trim();
  return _ROOM_LABEL_DEFAULT[slug] || slug;
}

// Retire N unités de chaque matériau (1 entrée d'inventaire = 1 unité).
function _consumeMaterials(inv, requirements) {
  let out = [...inv];
  for (const req of (requirements || [])) {
    let need = parseInt(req.quantite) || 0;
    if (need <= 0) continue;
    out = out.filter(it => {
      if (need > 0 && it && it.itemId === req.itemId) { need--; return false; }
      return true;
    });
  }
  return out;
}

// Résout tout le contexte de reforge d'un objet (catégorie, discipline, salle,
// matériaux, évaluation pure). Réutilise le mapping craft (par aventure).
function _reforgeContext(item, c) {
  const upg = getUpgradeSettings();
  const craftCfg = getCraftSettings();
  const category = craftCategoryForItem(item);
  const discipline = category ? craftDiscipline(category, craftCfg) : null;
  const rarities = getRarities();
  const maxRarete = rarities.length ? Math.max(...rarities.map(r => r.value)) : 5;
  const cur = Math.max(1, parseInt(item.rarete) || 1);
  const tier = Math.min(cur + 1, 3);  // recettes de craft : paliers 1..3
  const cfg = upg.reforge;
  // Reforge = fraction de la recette de craft (materialPercent, dial indépendant).
  const materialReq = category
    ? scaleMaterials(craftRecipeMaterials(category, tier, craftCfg), cfg?.materialPercent)
    : [];
  const roomSlug = discipline ? (cfg?.disciplineRoom?.[discipline] || null) : null;
  const roomLevel = roomSlug ? (STORE.bastion?.salles?.[roomSlug]?.niveau || 0) : 0;
  const ev = evaluateReforge({
    rarete: cur, maxRarete, discipline, roomLevel,
    materialReq, inventory: c.inventaire || [], gold: calcOr(c), cfg,
  });
  return { ev, category, discipline, roomSlug, roomLevel, materialReq, cur };
}

function _renderReforgeSection(item, invIndex, c) {
  const { ev, discipline, roomSlug, roomLevel, materialReq } = _reforgeContext(item, c);
  if (!discipline) return `<section class="art-panel art-operation"><header class="art-operation-head"><span class="art-operation-icon is-reforge">★</span><span><h3>Reforge</h3><p>Augmente la rareté pour débloquer de nouveaux emplacements.</p></span><em class="art-section-state is-muted">Non disponible</em></header><div class="art-operation-body"><p class="art-section-empty">Cette famille d’objet ne possède pas de recette de reforge.</p></div></section>`;
  if (!ev.target) {
    return `<section class="art-panel art-operation"><header class="art-operation-head"><span class="art-operation-icon is-reforge">★</span><span><h3>Reforge</h3><p>Augmente la rareté pour débloquer de nouveaux emplacements.</p></span><em class="art-section-state is-complete">Rareté maximale</em></header><div class="art-operation-body"><p class="art-section-empty">Cette pièce a atteint la rareté maximale.</p></div></section>`;
  }
  const free = STORE.mjFreeMode;
  const targetName = RARETE_NAMES[ev.target] || `Rareté ${ev.target}`;
  const targetColor = _rareteColor(RARETE_NAMES[ev.target]) || 'var(--text)';
  const requirement = (ok, label, detail, action = '') => `<div class="art-requirement ${ok ? 'is-ok' : 'is-missing'}${free && !ok ? ' is-ignored' : ''}"><span>${ok || free ? '✓' : '×'}</span><b>${label}</b><small>${free && !ok ? 'Ignoré (MJ)' : detail}</small>${!ok && !free ? action : ''}</div>`;
  const roomLine = requirement(ev.roomOk, `${_esc(_roomLabel(roomSlug))} niv. ${ev.requiredLevel}`, roomLevel ? `la tienne : niv. ${roomLevel}` : 'pas encore construite', '<a href="#/bastion">Voir le Bastion</a>');
  let missing = ev.roomOk ? 0 : 1;
  const matLines = materialReq.length ? materialReq.map(req => {
    const owned = countInventoryItem(c.inventaire || [], req.itemId);
    const shopItem = STORE.shopItems.find(entry => entry.id === req.itemId);
    const name = shopItem?.nom || (c.inventaire || []).find(it => it?.itemId === req.itemId)?.nom || 'Matériau requis';
    const ok = owned >= req.quantite;
    if (!ok) missing++;
    return requirement(ok, `${req.quantite} × ${_esc(name)}`, `tu en as ${owned}`, shopItem ? `<button type="button" data-sh-action="cartInc" data-id="${_esc(req.itemId)}">Ajouter ${Math.max(1, req.quantite - owned)} au panier</button>` : '');
  }).join('') : requirement(false, 'Recette de matériaux', 'aucune recette configurée');
  if (!materialReq.length) missing++;
  if (!ev.goldOk) missing++;
  const goldLine = requirement(ev.goldOk, `${ev.goldCost} or`, `solde : ${Math.floor(calcOr(c))} or`);
  const allow = free || ev.ok;
  const gainRarity = firstGainRarity(item, getUpgradeSettings());
  const useful = gainRarity === ev.target;
  const current = Math.max(1, parseInt(item.rarete, 10) || 1);
  const currentTraits = traitCapAt(item, current, getUpgradeSettings());
  const nextTraits = traitCapAt(item, ev.target, getUpgradeSettings());
  const currentStats = statCapAt(item, current, getUpgradeSettings());
  const nextStats = statCapAt(item, ev.target, getUpgradeSettings());
  const gains = [nextTraits > currentTraits ? `+${nextTraits - currentTraits} emplacement${nextTraits - currentTraits > 1 ? 's' : ''} de trait` : '', nextStats > currentStats ? `+${nextStats - currentStats} point${nextStats - currentStats > 1 ? 's' : ''} de stats` : ''].filter(Boolean);
  const ladder = getRarities().map(rarity => {
    const traits = getItemTraitsSlotCountPure({ ...item, rarete: rarity.value }, getUpgradeSettings());
    const stats = statCapAt(item, rarity.value, getUpgradeSettings());
    const state = rarity.value < current ? ' is-past' : rarity.value === current ? ' is-current' : rarity.value === ev.target ? ' is-next' : '';
    const traitGain = state.includes('is-next') ? traits - currentTraits : 0;
    const statGain = state.includes('is-next') ? stats - currentStats : 0;
    return `<span class="art-reforge-step${state}" style="--rarity:${_rareteColor(rarity.name) || '#8294ad'}">${state.includes('is-current') ? '<em>Actuelle</em>' : state.includes('is-next') ? '<em>Prochaine</em>' : ''}<i>${'★'.repeat(Math.min(5, rarity.value))}</i><b>${_esc(rarity.name)}</b><small><span>◆ ${traits}${traitGain > 0 ? `<u>+${traitGain}</u>` : ''}</span>${stats ? `<span>● ${stats}${statGain > 0 ? `<u>+${statGain}</u>` : ''}</span>` : ''}</small></span>`;
  }).join('');
  const gainText = gains.length
    ? `<p class="art-reforge-gain"><span>→</span>En ${_esc(targetName)} : <b>${gains.join(' et ')}</b>. Tes améliorations sont conservées.</p>`
    : `<p class="art-section-hint"><span>i</span>${gainRarity ? `Rien de plus en ${_esc(targetName)} : le prochain gain arrive en ${_esc(RARETE_NAMES[gainRarity] || gainRarity)}.` : 'Rien à débloquer : cette pièce a atteint les limites de sa famille. La reforge ne changerait que la rareté.'}</p>`;
  return `<section class="art-panel art-operation"><header class="art-operation-head"><span class="art-operation-icon is-reforge">★</span><span><h3>Reforge</h3><p>Monte la rareté de la pièce. Cette opération est définitive.</p></span><em class="art-section-state is-reforge" style="--rarity:${targetColor}">${_esc(targetName)}</em></header><div class="art-operation-body"><div class="art-reforge-ladder">${ladder}</div>${gainText}<div class="art-requirements"><b>Pour passer en ${_esc(targetName)}</b>${roomLine}${matLines}${goldLine}</div><div class="art-operation-actions"><small>Définitif.</small><button type="button" class="${useful ? 'is-primary' : 'is-secondary'}" data-action="_artisanReforge" data-i="${invIndex}"${allow ? '' : ' disabled'}>${allow ? `Reforger en ${_esc(targetName)}${free ? ' · Gratuit (MJ)' : ev.goldCost ? ` · ${ev.goldCost} or` : ''}` : `Il manque ${missing} condition${missing > 1 ? 's' : ''}`}</button></div></div></section>`;
}

async function _artisanReforge(invIndex) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = (c.inventaire || [])[invIndex];
  if (!item) return;

  const { ev, materialReq, cur } = _reforgeContext(item, c);
  const free = STORE.mjFreeMode;
  if (!ev.target) { showNotif('Rareté maximale atteinte.', 'error'); return; }
  if (!free && !ev.ok) {
    const msg = {
      no_room_mapping: 'Aucune salle du Bastion liée à cette discipline.',
      room:            `Salle requise non construite au niveau ${ev.requiredLevel}.`,
      no_recipe:       'Aucune recette de matériaux définie pour cette catégorie.',
      materials:       'Matériaux insuffisants.',
      gold:            `Or insuffisant (${ev.goldCost} PO requis).`,
    }[ev.reason] || 'Reforge impossible.';
    showNotif(msg, 'error'); return;
  }

  const fromName = RARETE_NAMES[cur] || `rareté ${cur}`;
  const toName   = RARETE_NAMES[ev.target] || `rareté ${ev.target}`;
  const matTxt = (!free && materialReq.length)
    ? '<br>Consomme : ' + materialReq.map(r => {
        const name = (c.inventaire || []).find(it => it && it.itemId === r.itemId)?.nom || 'matériau';
        return `${r.quantite}× ${_esc(name)}`;
      }).join(', ')
    : '';
  const inv = [...c.inventaire];
  const newItem = { ...item, rarete: ev.target };
  _logUpgradeHistory(newItem, { op: 'reforge', from: fromName, to: toName, cost: ev.goldCost });
  inv[invIndex] = newItem;
  const consumed = free ? inv : _consumeMaterials(inv, materialReq);
  c.inventaire = consumed;
  const newIdx = consumed.indexOf(newItem);
  if (newIdx >= 0) STORE.activeItemIndex = newIdx;

  if (!free) _logExpense(c, `Artisan : reforge ${item.nom || ''} → ${toName}`, ev.goldCost);

  await _persistChar(c);
  STORE.flash = STORE.activeItemIndex;
  showNotif(`Reforge réussie : « ${item.nom || 'Objet'} » devient ${toName}.`, 'success');
}

// ══════════════════════════════════════════════
// ÉTABLI — SECTION TRAITS (inline)
// ══════════════════════════════════════════════

function _renderTraitsSection(item, invIndex, c, cat) {
  const catMeta    = FRAGMENT_CAT_BY_ID[cat];
  const baseTraits = _getBaseTraits(item);
  const allTraits  = [..._getTraits(item)];
  const slotCount  = getItemTraitsSlotCount(item);
  const totalUsed  = allTraits.length;
  const s          = getUpgradeSettings();
  const fragments  = c.traitFragments?.[cat] || {};
  const fragNames  = Object.entries(fragments).filter(([, n]) => (parseInt(n) || 0) > 0).map(([name, n]) => ({ name, n }));
  const maxRarity = Math.max(5, ...getRarities().map(rarity => Number(rarity.value) || 0));
  const familyCap = Math.max(slotCount, totalUsed, traitCapAt(item, maxRarity, s));
  const added = new Set(_getAddedTraits(item));
  const price = STORE.mjFreeMode ? 'Gratuit (MJ)' : `${s.trait.addTraitFromFragment} or`;
  const sockets = familyCap > 0 ? Array.from({ length: familyCap }, (_, index) => {
    const trait = allTraits[index];
    if (trait) {
      const signature = !isTraitRecyclable(item, trait);
      const replacing = STORE.operation?.type === 'trait' && STORE.operation?.invIndex === invIndex && STORE.operation?.oldTrait === trait;
      return `<div class="art-trait-slot is-filled${signature ? ' is-signature' : ''}${replacing ? ' is-active' : ''}"><span class="art-slot-mark"></span><span class="art-slot-copy"><b>${_esc(trait)}</b><small>${signature ? 'Trait signature · ni remplaçable, ni récupérable' : added.has(trait) ? 'Ajouté à l’artisan' : 'D’origine'}</small></span>${signature ? '<span class="art-slot-lock" title="Trait verrouillé">▣</span>' : fragNames.length ? `<button type="button" class="art-slot-link" data-action="_artisanTraitPanel" data-i="${invIndex}" data-trait="${_esc(trait)}">${replacing ? 'En cours…' : 'Remplacer'}</button>` : ''}</div>`;
    }
    if (index < slotCount) {
      const selected = STORE.operation?.type === 'trait' && STORE.operation?.invIndex === invIndex && !STORE.operation?.oldTrait;
      return fragNames.length
        ? `<button type="button" class="art-trait-slot is-free${selected ? ' is-active' : ''}" data-action="_artisanTraitPanel" data-i="${invIndex}"><span class="art-slot-mark"></span><span class="art-slot-copy"><b>${selected && STORE.operation?.fragment ? _esc(STORE.operation.fragment) : 'Emplacement libre'}</b><small>${selected && STORE.operation?.fragment ? 'Aperçu · pas encore posé' : `Poser un fragment · ${price}`}</small></span><span class="art-slot-plus">＋</span></button>`
        : `<div class="art-trait-slot is-free is-disabled"><span class="art-slot-mark"></span><span class="art-slot-copy"><b>Emplacement libre</b><small>Aucun fragment ${_esc(catMeta?.label || cat).toLowerCase()} dans ton sac</small></span></div>`;
    }
    const unlock = unlockRarity(item, 'traits', index + 1, s);
    return `<div class="art-trait-slot is-locked"><span class="art-slot-lock">▣</span><span class="art-slot-copy"><b>Emplacement verrouillé</b><small>${unlock ? `Se débloque en <em>${_esc(RARETE_NAMES[unlock] || `rareté ${unlock}`)}</em> · <button type="button" data-action="_artisanScrollSection" data-target="art-section-reforge">voir la reforge</button>` : 'Non disponible sur cette pièce'}</small></span></div>`;
  }).join('') : '<p class="art-section-empty">Cette pièce ne possède aucun emplacement de trait.</p>';
  const freeSlots = Math.max(0, slotCount - totalUsed);
  const state = freeSlots > 0
    ? [`${freeSlots} libre${freeSlots > 1 ? 's' : ''}`, 'is-open']
    : totalUsed >= slotCount && !unlockRarity(item, 'traits', slotCount + 1, s)
      ? ['Complet', 'is-complete']
      : ['Reforge possible', ''];
  const hint = !fragNames.length && allTraits.some(trait => isTraitRecyclable(item, trait))
    ? `<p class="art-section-hint"><span>i</span>Aucun fragment compatible dans ton sac. Pour en obtenir, démonte une pièce qui porte un trait.</p>` : '';
  return `<section class="art-panel art-operation" id="art-traits-card"><header class="art-operation-head"><span class="art-operation-icon is-trait">◆</span><span><h3>Traits</h3><p>Pose un fragment dans un emplacement libre, ou remplace un trait existant.</p></span><em class="art-section-state ${state[1]}">${state[0]}</em></header><div class="art-operation-body"><div class="art-trait-slots">${sockets}</div>${hint}${_renderOperationPanel(item, invIndex, c, cat, 'trait')}</div></section>`;
}

// Section « Recycler » (ex-destruction) — récupère les traits en fragments.
function _renderRecycleSection(item, invIndex, cat, c) {
  const s = getUpgradeSettings();
  const allTraits = _getTraits(item);
  const preview = dismantlePreview(item, s, getCraftSettings());
  const recoveredTraits = preview.recoveredTraits;
  const chosenTrait = !s.trait.extractAllTraits && recoveredTraits.length > 1;
  const recovered = [
    chosenTrait ? `<p class="art-dismantle-note">Un seul trait revient en fragment : tu le choisiras à la confirmation.</p>` : '',
    ...recoveredTraits.map(trait => `<span><i class="is-fragment">◆</i>Fragment « ${_esc(trait)} »</span>`),
    ...preview.materials.map(req => {
      const catalog = STORE.shopItems.find(entry => entry.id === req.itemId);
      const name = catalog?.nom || c?.inventaire?.find(entry => entry?.itemId === req.itemId)?.nom || 'Matériau';
      return `<span><i class="is-material">⬡</i>${req.quantite} × ${_esc(name)}</span>`;
    }),
  ].join('') || '<p>Rien à récupérer.</p>';
  const invested = (item.upgrades?.history || []).reduce((sum, entry) => sum + (parseInt(entry.cost, 10) || 0), 0);
  const lost = [
    `<span><i>×</i>La pièce « ${_esc(item.nom || 'Objet')} »</span>`,
    allTraits.length ? `<span><i>×</i>Ses améliorations et traits non récupérés</span>` : '',
    ...preview.lostTraits.map(trait => `<span><i>×</i>Trait signature « ${_esc(trait)} »</span>`),
    invested ? `<span><i>×</i>${invested} or investis</span>` : '',
    '<span><i>×</i>Son emplacement d’inventaire est libéré</span>',
  ].filter(Boolean).join('');
  return `<section class="art-panel art-operation is-danger"><header class="art-operation-head"><span class="art-operation-icon is-danger">□</span><span><h3>Démonter</h3><p>Détruis la pièce pour récupérer ses traits et une partie de ses matériaux.</p></span><em class="art-section-state is-danger">Définitif</em></header><div class="art-operation-body"><div class="art-dismantle-grid"><div><b>Tu récupères</b>${recovered}</div><div><b>Tu perds</b>${lost}</div></div><div class="art-operation-actions"><small>Coût : ${STORE.mjFreeMode ? 'Gratuit (MJ)' : `${preview.cost} or`}</small><button type="button" class="is-danger" data-action="_artisanDismantlePanel" data-i="${invIndex}">Démonter…</button></div>${_renderOperationPanel(item, invIndex, c, cat, 'dismantle')}</div></section>`;
}

// ── Détruire : si plusieurs traits et !extractAllTraits, demander lequel ──
async function _artisanDestroyStart(invIndex) {
  STORE.operation = { type: 'dismantle', invIndex, trait: null };
  _renderArtisanModal();
};

function _artisanDestroyConfirm(invIndex, traitName) {
  _artisanDoDestroy(invIndex, [traitName]);
}

async function _artisanDoDestroy(invIndex, traitsToExtract) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = (c.inventaire || [])[invIndex];
  if (!item) return;

  const cat = getItemFragmentCategory(item);
  if (!cat) { showNotif('Cet item n\'est pas catégorisable.', 'error'); return; }

  const s    = getUpgradeSettings();
  const cost = s.trait.deconstructCost || 0;
  if (!_canAfford(c, cost)) { showNotif(`Or insuffisant (${cost} PO requis).`, 'error'); return; }
  // Sécurité : un appel direct ne peut jamais extraire un trait verrouillé.
  traitsToExtract = recyclableTraits(item, traitsToExtract);

  // 1) Matériaux rendus : même règle que le démontage depuis le VTT.
  const craftCfg = getCraftSettings();
  const craftCat = craftCategoryForItem(item);
  const tier = Math.max(1, Math.min(3, parseInt(item.rarete, 10) || 1));
  const returned = [];
  const returnedLog = [];
  if (craftCat) {
    const shop = await loadCollection('shop').catch(() => []);
    const catalog = new Map((shop || []).map(entry => [entry.id, entry]));
    for (const requirement of craftRecipeMaterials(craftCat, tier, craftCfg)) {
      const qty = craftRecycleQty(requirement.quantite, craftCfg);
      const shopItem = catalog.get(requirement.itemId);
      if (!shopItem || qty <= 0) continue;
      for (let index = 0; index < qty; index++) returned.push(shopItemToInvEntry(shopItem, { source: 'recyclage' }));
      returnedLog.push({ shopItem, qty });
    }
  }

  // 2) Supprimer l'item de l'inventaire puis ajouter les matériaux récupérés.
  const inv = [...(c.inventaire || [])];
  inv.splice(invIndex, 1);
  c.inventaire = inv.concat(returned);
  STORE.activeItemIndex = Math.min(invIndex, inv.length - 1);
  STORE.operation = null;

  // 3) Sync équipement (décale les sourceInvIndex)
  const sync = syncEquipmentAfterInventoryMutation(c, [invIndex]);
  c.equipement = sync.equipement;
  c.statsBonus = sync.statsBonus;

  // 4) Ajouter les fragments
  let frags = c.traitFragments || {};
  traitsToExtract.forEach(t => { frags = _addFragment(frags, cat, t, +1); });
  c.traitFragments = frags;
  STORE.resourceFlash = true;
  const historyEntries = [makeInventoryHistoryEntry('delete', item, 1, {
    actorUid: STATE.user?.uid || '',
    actorName: STATE.user?.pseudo || STATE.user?.displayName || STATE.user?.email || '',
    source: 'Artisan',
    note: traitsToExtract.join(', '),
  })];
  returnedLog.forEach(({ shopItem, qty }) => historyEntries.push(makeInventoryHistoryEntry('add', shopItemToInvEntry(shopItem), qty, {
    actorUid: STATE.user?.uid || '',
    actorName: STATE.user?.pseudo || STATE.user?.displayName || STATE.user?.email || '',
    source: 'Artisan · démontage',
  })));
  c.inventoryHistory = inventoryHistoryPayload(c, historyEntries).inventoryHistory;

  // 5) Débit or si applicable
  if (cost > 0) _logExpense(c, `Artisan : destruction de ${item.nom}`, cost);

  await _persistChar(c);
  const materialText = returnedLog.length ? ` · ${returnedLog.map(entry => `${entry.qty}× ${entry.shopItem.nom}`).join(', ')}` : '';
  showNotif(`Démontage de « ${item.nom || 'Objet'} » terminé${materialText}.`, 'success');
}

// ── Ajouter un trait (slot libre) ──
async function _artisanAddTrait(invIndex, fragmentName) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = (c.inventaire || [])[invIndex];
  if (!item) return;

  const cat = getItemFragmentCategory(item);
  if (!cat) return;

  const slotCount = getItemTraitsSlotCount(item);
  const totalTraits = _getTraits(item).length;
  if (totalTraits >= slotCount) { showNotif('Aucun slot libre.', 'error'); return; }

  const fragCount = getFragmentCount(c, cat, fragmentName);
  if (fragCount <= 0) { showNotif('Fragment indisponible.', 'error'); return; }

  const s = getUpgradeSettings();
  const cost = s.trait.addTraitFromFragment || 0;
  if (!_canAfford(c, cost)) { showNotif(`Or insuffisant (${cost} PO requis).`, 'error'); return; }

  // Mutation
  const inv = [...(c.inventaire || [])];
  const newItem = { ...item };
  const up = newItem.upgrades || {};
  newItem.upgrades = {
    ...up,
    addedTraits: [...(up.addedTraits || []), fragmentName],
  };
  _logUpgradeHistory(newItem, { op: 'add_trait', value: fragmentName, cost });
  inv[invIndex] = newItem;
  c.inventaire = inv;

  c.traitFragments = _addFragment(c.traitFragments || {}, cat, fragmentName, -1);
  if (cost > 0) _logExpense(c, `Artisan : ajout du trait ${fragmentName} sur ${item.nom}`, cost);

  await _persistChar(c);
  STORE.flash = invIndex;
  showNotif(`Trait « ${fragmentName} » ajouté.`, 'success');
};

// ── Écraser un trait existant ──
function _artisanOverwriteStart(invIndex, oldTraitName) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = (c.inventaire || [])[invIndex];
  if (!item) return;
  if (!isTraitRecyclable(item, oldTraitName)) {
    showNotif(`Le trait « ${oldTraitName} » est verrouillé et ne peut pas être remplacé.`, 'warning');
    return;
  }

  const cat = getItemFragmentCategory(item);
  const fragments = c.traitFragments?.[cat] || {};
  if (!Object.values(fragments).some(n => (parseInt(n, 10) || 0) > 0)) {
    showNotif('Aucun fragment compatible dans le sac.', 'error');
    return;
  }
  STORE.operation = { type: 'trait', invIndex, oldTrait: oldTraitName, fragment: null };
  _renderArtisanModal();
};

async function _artisanOverwriteConfirm(invIndex, oldTraitName, newFragmentName) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = (c.inventaire || [])[invIndex];
  if (!item) return;
  // Garde-fou métier : même un appel direct ou une ancienne modale ouverte ne
  // peut écraser un trait marqué non recyclable.
  if (!isTraitRecyclable(item, oldTraitName)) {
    showNotif(`Le trait « ${oldTraitName} » est verrouillé et ne peut pas être remplacé.`, 'warning');
    return;
  }

  const cat = getItemFragmentCategory(item);
  if (!cat) return;

  if (getFragmentCount(c, cat, newFragmentName) <= 0) { showNotif('Fragment indisponible.', 'error'); return; }

  const s = getUpgradeSettings();
  const cost = s.trait.overwriteTrait || 0;
  if (!_canAfford(c, cost)) { showNotif(`Or insuffisant (${cost} PO requis).`, 'error'); return; }

  // Le sélecteur de fragment EST la confirmation (il annonce clairement la perte
  // et le coût) → on applique directement, sans 2ᵉ modale.
  // Mutation
  const inv = [...(c.inventaire || [])];
  const newItem = { ...item };
  const up = newItem.upgrades || {};
  const baseTraits  = _getBaseTraits(item);     // base après éventuels removed
  const addedTraits = _getAddedTraits(item);

  const isBaseTrait  = baseTraits.includes(oldTraitName);
  const isAddedTrait = addedTraits.includes(oldTraitName);

  let nextRemovedBase = up.removedBaseTraits || [];
  let nextAddedTraits = up.addedTraits || [];

  if (isAddedTrait) {
    // Retire le trait ajouté (premier match suffit)
    const idx = nextAddedTraits.indexOf(oldTraitName);
    nextAddedTraits = [...nextAddedTraits.slice(0, idx), ...nextAddedTraits.slice(idx + 1)];
  } else if (isBaseTrait) {
    // Marque le trait base comme supprimé
    nextRemovedBase = [...nextRemovedBase, oldTraitName];
  }

  // Ajoute le nouveau trait
  nextAddedTraits = [...nextAddedTraits, newFragmentName];

  newItem.upgrades = {
    ...up,
    removedBaseTraits: nextRemovedBase,
    addedTraits: nextAddedTraits,
  };
  _logUpgradeHistory(newItem, { op: 'overwrite_trait', from: oldTraitName, to: newFragmentName, cost });
  inv[invIndex] = newItem;
  c.inventaire = inv;

  // Décrémente le fragment, débit or
  c.traitFragments = _addFragment(c.traitFragments || {}, cat, newFragmentName, -1);
  if (cost > 0) _logExpense(c, `Artisan : écrasement ${oldTraitName} → ${newFragmentName} sur ${item.nom}`, cost);

  await _persistChar(c);
  STORE.flash = invIndex;
  showNotif(`Trait « ${oldTraitName} » remplacé par « ${newFragmentName} ».`, 'success');
}

// ══════════════════════════════════════════════
// ACTIONS — STATS
// Dispatch selon catégorie : anneau / amulette / arme.
// (Armures Tête/Torse/Pieds et Objet magique : pas d'amélioration stats.)
// ══════════════════════════════════════════════

function _artisanSelectChar(id) {
  STORE.activeCharId = id;
  STORE.activeItemIndex = null;   // repart sans objet sélectionné
  STORE.itemSearch = '';
  STORE.itemCategory = 'all';
  STORE.operation = null;
  _renderArtisanModal();
};

// Sélection d'un objet dans la colonne gauche → affiche/masque son établi.
function _artisanSelectItem(invIndex) {
  STORE.activeItemIndex = (STORE.activeItemIndex === invIndex) ? null : invIndex;
  STORE.operation = null;
  _renderArtisanModal();
}

function _refreshInlineItemList() {
  const list = document.getElementById('art-inline-item-list');
  if (!list) return;
  list.innerHTML = _renderItemList(_getActiveArtisanChar());
}

function _artisanFilterItems(value) {
  STORE.itemSearch = value || '';
  _refreshInlineItemList();
}

function _artisanFilterCategory(category) {
  STORE.itemCategory = ARTISAN_FAMILIES.some(family => family.id === category) ? category : 'all';
  document.querySelectorAll('.art-item-category').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.category === STORE.itemCategory);
  });
  _refreshInlineItemList();
}

function _artisanToggleHideEmpty() {
  STORE.hideEmpty = !STORE.hideEmpty;
  _renderArtisanModal();
}

function _artisanSelectCompatible(category) {
  const c = _getActiveArtisanChar();
  const candidates = _getEligibleItems(c).filter(entry => entry.cat === category);
  const compatible = candidates.find(entry => _getTraits(entry.it).length < getItemTraitsSlotCount(entry.it)) || candidates[0];
  if (!compatible) { showNotif('Aucune pièce compatible dans cet inventaire.', 'info'); return; }
  STORE.activeItemIndex = compatible.idx;
  STORE.itemCategory = _artisanFamily(category, compatible.it);
  STORE.operation = null;
  _renderArtisanModal();
}

function _artisanTraitPanel(invIndex, oldTrait = '', fragment = '') {
  const c = _getActiveArtisanChar();
  const item = c?.inventaire?.[invIndex];
  if (!item) return;
  if (oldTrait && !isTraitRecyclable(item, oldTrait)) {
    showNotif(`Le trait « ${oldTrait} » est verrouillé et ne peut pas être remplacé.`, 'warning');
    return;
  }
  STORE.activeItemIndex = invIndex;
  STORE.operation = { type: 'trait', invIndex, oldTrait: oldTrait || null, fragment: fragment || null };
  _renderArtisanModal();
}

function _artisanStatPanel(invIndex, kind, stat, cost) {
  STORE.activeItemIndex = invIndex;
  STORE.operation = { type: 'stat', invIndex, kind, stat, cost: parseInt(cost, 10) || 0 };
  _renderArtisanModal();
}

function _artisanDismantlePanel(invIndex) {
  STORE.activeItemIndex = invIndex;
  STORE.operation = { type: 'dismantle', invIndex, trait: null };
  _renderArtisanModal();
}

function _artisanOperationFragment(name) {
  if (!STORE.operation || STORE.operation.type !== 'trait') return;
  STORE.operation = { ...STORE.operation, fragment: name };
  _renderArtisanModal();
}

function _artisanDismantleTrait(value) {
  if (!STORE.operation || STORE.operation.type !== 'dismantle') return;
  STORE.operation = { ...STORE.operation, trait: value };
  _renderArtisanModal();
}

function _artisanCloseOperation() {
  STORE.operation = null;
  _renderArtisanModal();
}

async function _artisanConfirmOperation() {
  const op = STORE.operation;
  if (!op) return;
  if (op.type === 'trait') {
    if (!op.fragment) return;
    if (op.oldTrait) await _artisanOverwriteConfirm(op.invIndex, op.oldTrait, op.fragment);
    else await _artisanAddTrait(op.invIndex, op.fragment);
    return;
  }
  if (op.type === 'stat') {
    if (op.kind === 'ring') await _artisanRingAddPoint(op.invIndex, op.stat);
    else if (op.kind === 'armor') await _artisanArmorAddPoint(op.invIndex, op.stat);
    else if (op.kind === 'amulet') await _artisanAmuletAddStat(op.invIndex, op.stat);
    else if (op.kind === 'weapon') await _artisanWeaponAddPoint(op.invIndex, op.stat);
    return;
  }
  if (op.type === 'dismantle') {
    const c = _getActiveArtisanChar();
    const item = c?.inventaire?.[op.invIndex];
    if (!item) return;
    const allTraits = _getTraits(item);
    const transferable = recyclableTraits(item, allTraits);
    const selected = getUpgradeSettings().trait.extractAllTraits
      ? transferable
      : transferable.length <= 1 ? transferable : (op.trait ? [op.trait] : []);
    if (transferable.length > 1 && !getUpgradeSettings().trait.extractAllTraits && !selected.length) return;
    await _artisanDoDestroy(op.invIndex, selected);
  }
}

function _artisanScrollSection(id) {
  document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

// Section « Stats » de l'établi — dispatch inline selon la catégorie.
// Anneau = profondeur ; tout autre accessoire = moteur amulette (stats distinctes).
// Ordre : arme avant armure (un bouclier porteur de CA reste une arme).
function _renderStatsSection(item, invIndex, c, cat) {
  if (cat === 'Anneau')   return _renderRingStats(item, invIndex, c);
  if (cat === 'arme')     return _renderWeaponStats(item, invIndex, c);
  if (_isArmorItem(item)) return _renderArmorStats(item, invIndex, c);
  if (isJewelItem(item))  return _renderAmuletStats(item, invIndex, c);
  return `<section class="art-panel art-operation"><header class="art-operation-head"><span class="art-operation-icon is-stat">●</span><span><h3>Points de stats</h3><p>Les améliorations chiffrées disponibles pour cette pièce.</p></span><em class="art-section-state is-muted">Non applicable</em></header><div class="art-operation-body"><p class="art-section-empty">Cette pièce s’améliore uniquement par ses traits.</p></div></section>`;
}

// « Est-ce une armure ? » — classificateur canonique (item-facts), robuste aux
// slots personnalisés et à `ca`/`typeArmure`. On exclut les bijoux (un accessoire
// porteur de CA reste un bijou). Aligné sur artisan-logic.isArmor.
function _isArmorItem(item = {}) {
  return isArmorItem(item) && !item.slotBijou && (item.template || '').toLowerCase() !== 'bijou';
}

// ── Helpers communs ──────────────────────────────────────────────────

// Stats réellement proposées par l'objet. Un anneau peut en porter plusieurs :
// chacune garde son propre palier d'amélioration.
function _getBaseStatEntries(item) {
  return ITEM_STAT_META
    .map(meta => ({ meta, base: getItemBaseStatBonus(item, meta.full) }))
    .filter(({ base }) => base !== 0);
}

// Liste des stats déjà améliorées avec leur valeur.
function _getUpgradedStatEntries(item) {
  const sb = item?.upgrades?.statBonus || {};
  return ITEM_STAT_META
    .map(m => ({ meta: m, val: parseInt(sb[m.store]) || 0 }))
    .filter(({ val }) => val > 0);
}

// Ordre d'occupation du potentiel : les points natifs sont placés avant ceux
// ajoutés à l'Artisan afin que la piste explique correctement le plafond.
function _statPointSequence(item) {
  const base = ITEM_STAT_META.flatMap(meta => Array.from(
    { length: Math.max(0, getItemBaseStatBonus(item, meta.full)) },
    () => ({ meta, origin: true }),
  ));
  const upgraded = _getUpgradedStatEntries(item).flatMap(entry => Array.from(
    { length: entry.val },
    () => ({ meta: entry.meta, origin: false }),
  ));
  return [...base, ...upgraded];
}

function _renderStatTrack(item, used, cap, familyCap, tariff = {}) {
  const sequence = _statPointSequence(item);
  return `<div class="art-stat-track" style="--steps:${Math.max(1, familyCap)}">${Array.from({ length: Math.max(1, familyCap) }, (_, index) => {
    const ordinal = index === 0 ? '1er point' : `${index + 1}e point`;
    if (index < used) {
      const point = sequence[index];
      return `<div class="art-stat-step is-done"><span>${ordinal}</span><b style="--stat:${ARTISAN_STAT_COLORS[point?.meta?.full] || '#22c38e'}">+1 ${point?.meta?.short || 'Stat'}</b><small>${point?.origin ? 'D’origine' : 'Placé'}</small></div>`;
    }
    if (index < cap) return `<div class="art-stat-step${index === used ? ' is-next' : ''}"><span>${ordinal}</span><b>${STORE.mjFreeMode ? 'Gratuit (MJ)' : `${tariff[index + 1] || 0} or`}</b><small>${index === used ? 'Prochain' : 'Ensuite'}</small></div>`;
    const unlock = unlockRarity(item, 'stats', index + 1, getUpgradeSettings());
    return `<div class="art-stat-step is-locked"><span>${ordinal}</span><b>▣ ${unlock ? _esc(RARETE_NAMES[unlock] || `Rareté ${unlock}`) : '—'}</b><small>${unlock ? 'après reforge' : 'non disponible'}</small></div>`;
  }).join('')}</div>`;
}

function _statChoice(meta, item, invIndex, kind, cost, disabled = false) {
  const current = getItemBaseStatBonus(item, meta.full) + getItemUpgradeStatBonus(item, meta.full);
  return `<button type="button" class="art-stat-choice" style="--stat:${ARTISAN_STAT_COLORS[meta.full] || '#8294ad'}" data-action="_artisanStatPanel" data-i="${invIndex}" data-kind="${kind}" data-stat="${_esc(meta.full)}" data-cost="${cost}"${disabled ? ' disabled' : ''}><span>${meta.short}</span><small>${_esc(meta.label)}</small><b>${disabled ? 'Déjà fait' : `${current >= 0 ? '+' : ''}${current} → ${current + 1 >= 0 ? '+' : ''}${current + 1}`}</b></button>`;
}

// ══════════════════════════════════════════════
// ANNEAU — budget de points par rareté, APPROFONDIT ses stats natives
//   • Seules les stats déjà portées sont améliorables (profondeur).
//   • Budget partagé (statCapAt), plafonné par la rareté (rarityCaps.ring.stats).
//   • L'effet éventuel reste figé (identité) — plus d'amélioration d'effet.
// Tarif `s.ring[pointN]`.
// ══════════════════════════════════════════════
function _renderRingStats(item, invIndex, c) {
  const s = getUpgradeSettings();
  const cap = statCapAt(item, item.rarete, s);
  const total = statPointUse(item);
  const cost = total < cap ? (s.ring?.[total + 1] || 0) : 0;
  const native = _getBaseStatEntries(item).map(entry => entry.meta);
  // Anti-dump : profondeur max ajoutée sur UNE même stat native (comme l'armure).
  const perStatMax = Math.max(1, parseInt(s.caps?.ringStatMax) || 3);
  const anyRoom = native.some(meta => getItemUpgradeStatBonus(item, meta.full) < perStatMax);
  const canAdd = total < cap && native.length > 0 && anyRoom;

  const familyCap = statCapAt(item, 5, s);
  const choices = native.map(meta => _statChoice(meta, item, invIndex, 'ring', cost, getItemUpgradeStatBonus(item, meta.full) >= perStatMax)).join('');
  const nextUnlock = unlockRarity(item, 'stats', cap + 1, s);
  const available = Math.max(0, cap - total);
  const empty = native.length === 0
    ? '<p class="art-section-empty">Cet anneau ne porte aucune statistique à approfondir — il s’améliore par son trait.</p>'
    : `<p class="art-section-hint"><span>i</span>Les ${cap} point${cap > 1 ? 's' : ''} autorisé${cap > 1 ? 's' : ''} en ${_esc(RARETE_NAMES[item.rarete] || 'cette rareté')} sont placés.${nextUnlock ? ` Reforge en ${_esc(RARETE_NAMES[nextUnlock] || nextUnlock)} pour un point supplémentaire.` : ''}</p>`;
  return `<section class="art-panel art-operation"><header class="art-operation-head"><span class="art-operation-icon is-stat">●</span><span><h3>Points de stats</h3><p>L’anneau approfondit uniquement les caractéristiques qu’il porte déjà.</p></span><em class="art-section-state ${canAdd ? 'is-open' : 'is-complete'}">${canAdd ? `${available} disponible${available > 1 ? 's' : ''}` : 'Complet'}</em></header><div class="art-operation-body">${_renderStatTrack(item, total, cap, familyCap, s.ring || {})}${canAdd ? `<div class="art-choice-block"><b>Sur quelle caractéristique ?</b><small>Cumul possible, mais ${perStatMax} point${perStatMax > 1 ? 's' : ''} max sur une même caractéristique de l’anneau.</small><div class="art-stat-choices">${choices}</div></div>` : empty}${_renderRemovableStats(item, invIndex)}${_renderOperationPanel(item, invIndex, c, 'Anneau', 'stat')}</div></section>`;
}

function _renderAmuletStats(item, invIndex, c) {
  const s = getUpgradeSettings();
  const cap = Math.min(s.caps?.amulet ?? 3, rarityCapFor('stats', item.rarete, s));
  const used = _getUpgradedStatEntries(item);
  const usedSet = new Set([
    ..._getBaseStatEntries(item).filter(entry => entry.base > 0).map(entry => entry.meta.full),
    ...used.map(entry => entry.meta.full),
  ]);
  const usedPoints = statPointUse(item);
  const slotN = usedPoints + 1;
  const cost = slotN <= cap ? (s.amulet?.[slotN] || 0) : 0;
  const remaining = ITEM_STAT_META.filter(m => !usedSet.has(m.full));
  const canAdd = usedPoints < cap && remaining.length > 0;

  const familyCap = statCapAt(item, 5, s);
  const choices = ITEM_STAT_META.map(meta => _statChoice(meta, item, invIndex, 'amulet', cost, usedSet.has(meta.full))).join('');
  const available = Math.max(0, cap - usedPoints);
  return `<section class="art-panel art-operation"><header class="art-operation-head"><span class="art-operation-icon is-stat">●</span><span><h3>Points de stats</h3><p>Une caractéristique différente à chaque amélioration.</p></span><em class="art-section-state ${canAdd ? 'is-open' : 'is-complete'}">${canAdd ? `${available} disponible${available > 1 ? 's' : ''}` : 'Complet'}</em></header><div class="art-operation-body">${_renderStatTrack(item, usedPoints, cap, familyCap, s.amulet || {})}${canAdd ? `<div class="art-choice-block"><b>Sur quelle caractéristique ?</b><small>Les caractéristiques déjà présentes ou améliorées sont indisponibles.</small><div class="art-stat-choices">${choices}</div></div>` : `<p class="art-section-hint"><span>i</span>${usedPoints >= cap ? `Les ${cap} points autorisés à cette rareté sont déjà présents sur l’objet.` : 'Toutes les caractéristiques ont déjà été améliorées.'}</p>`}${_renderRemovableStats(item, invIndex)}${_renderOperationPanel(item, invIndex, c, getItemFragmentCategory(item), 'stat')}</div></section>`;
}

function _renderWeaponStats(item, invIndex, c) {
  const s = getUpgradeSettings();
  const is2H = weaponHands(item) === 2;
  const cap = Math.min(is2H ? (s.caps?.weapon2H ?? 4) : (s.caps?.weapon1H ?? 2), rarityCapFor('stats', item.rarete, s));
  const tariff = is2H ? (s.weapon?.['2H'] || {}) : (s.weapon?.['1H'] || {});
  const total = statPointUse(item);
  const slotN = total + 1;
  const cost = total < cap ? (tariff[slotN] || 0) : 0;
  const canAdd = total < cap;

  const familyCap = statCapAt(item, 5, s);
  const choices = ITEM_STAT_META.map(meta => _statChoice(meta, item, invIndex, 'weapon', cost)).join('');
  const nextUnlock = unlockRarity(item, 'stats', cap + 1, s);
  const available = Math.max(0, cap - total);
  return `<section class="art-panel art-operation"><header class="art-operation-head"><span class="art-operation-icon is-stat">●</span><span><h3>Points de stats</h3><p>Choisis où placer chaque point accordé à cette arme.</p></span><em class="art-section-state ${canAdd ? 'is-open' : 'is-complete'}">${canAdd ? `${available} disponible${available > 1 ? 's' : ''}` : 'Complet'}</em></header><div class="art-operation-body">${_renderStatTrack(item, total, cap, familyCap, tariff)}${canAdd ? `<div class="art-choice-block"><b>Sur quelle caractéristique ?</b><small>Tu peux cumuler plusieurs points sur la même caractéristique.</small><div class="art-stat-choices">${choices}</div></div>` : `<p class="art-section-hint"><span>i</span>Les ${cap} points autorisés en ${_esc(RARETE_NAMES[item.rarete] || 'cette rareté')} sont placés.${nextUnlock ? ` Reforge en ${_esc(RARETE_NAMES[nextUnlock] || nextUnlock)} pour un point supplémentaire.` : ''}</p>`}${_renderRemovableStats(item, invIndex)}${_renderOperationPanel(item, invIndex, c, 'arme', 'stat')}</div></section>`;
}

// ══════════════════════════════════════════════
// ARMURE — points distribuables (une seule table par rareté, aucun slot en dur)
// Même moteur que l'arme : budget partagé, répartissable sur n'importe quelle stat.
// ══════════════════════════════════════════════
function _renderArmorStats(item, invIndex, c) {
  const s = getUpgradeSettings();
  const cap = statCapAt(item, item.rarete, s);
  const tariff = s.armor || {};
  const total = statPointUse(item);
  const slotN = total + 1;
  const cost = total < cap ? (tariff[slotN] || 0) : 0;
  const canAdd = total < cap;

  const familyCap = statCapAt(item, 5, s);
  // Anti-dump : pas plus de `armorStatMax` points d'Artisan sur une même stat.
  const perStatMax = Math.max(1, parseInt(s.caps?.armorStatMax) || 3);
  const choices = ITEM_STAT_META.map(meta => _statChoice(meta, item, invIndex, 'armor', cost, getItemUpgradeStatBonus(item, meta.full) >= perStatMax)).join('');
  const nextUnlock = unlockRarity(item, 'stats', cap + 1, s);
  const available = Math.max(0, cap - total);
  return `<section class="art-panel art-operation"><header class="art-operation-head"><span class="art-operation-icon is-stat">●</span><span><h3>Points de stats</h3><p>Choisis où placer chaque point accordé à cette armure.</p></span><em class="art-section-state ${canAdd ? 'is-open' : 'is-complete'}">${canAdd ? `${available} disponible${available > 1 ? 's' : ''}` : 'Complet'}</em></header><div class="art-operation-body">${_renderStatTrack(item, total, cap, familyCap, tariff)}${canAdd ? `<div class="art-choice-block"><b>Sur quelle caractéristique ?</b><small>Cumul possible, mais ${perStatMax} point${perStatMax > 1 ? 's' : ''} max sur une même caractéristique.</small><div class="art-stat-choices">${choices}</div></div>` : `<p class="art-section-hint"><span>i</span>Les ${cap} point${cap > 1 ? 's' : ''} autorisé${cap > 1 ? 's' : ''} en ${_esc(RARETE_NAMES[item.rarete] || 'cette rareté')} sont placés.${nextUnlock ? ` Reforge en ${_esc(RARETE_NAMES[nextUnlock] || nextUnlock)} pour un point supplémentaire.` : ''}</p>`}${_renderRemovableStats(item, invIndex)}${_renderOperationPanel(item, invIndex, c, getItemFragmentCategory(item), 'stat')}</div></section>`;
}

// Liste des points de stats AJOUTÉS à l'Artisan, chacun retirable (jamais les
// stats d'origine de l'objet : elles ne sont pas dans upgrades.statBonus).
function _renderRemovableStats(item, invIndex) {
  const added = _getUpgradedStatEntries(item);
  if (!added.length) return '';
  return `<div class="art-removable" style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--border-md)">
    <small class="art-muted" style="display:block;margin-bottom:6px">Points placés à l'Artisan — retirables (l'or dépensé n'est pas rendu ; les stats d'origine restent) :</small>
    <div style="display:flex;flex-wrap:wrap;gap:6px">${added.map(e =>
      `<button type="button" class="btn btn-outline btn-sm" data-action="_artisanRemoveStatPoint" data-i="${invIndex}" data-stat="${_esc(e.meta.full)}" title="Retirer 1 point de ${_esc(e.meta.label)}">↩ ${_esc(e.meta.short)} −1 <span class="art-muted">(${e.val})</span></button>`).join('')}</div>
  </div>`;
}

// — Action : retirer un point de stat PLACÉ (jamais les natives). L'or dépensé
// n'est PAS rendu (sinon le joueur ajuste ses stats sans conséquence).
async function _artisanRemoveStatPoint(invIndex, statFullKey) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = (c.inventaire || [])[invIndex];
  if (!item) return;
  const meta = ITEM_STAT_BY_FULL[statFullKey];
  if (!meta) return;
  if (getItemUpgradeStatBonus(item, meta.full) <= 0) { showNotif('Aucun point placé à retirer sur cette stat.', 'error'); return; }

  // Dernière amélioration de stat de l'historique pour cette stat → cohérence de l'historique.
  const hist = Array.isArray(item.upgrades?.history) ? [...item.upgrades.history] : [];
  const STAT_OPS = new Set(['weapon_add_point', 'armor_add_point', 'ring_upgrade_stat', 'amulet_add_stat']);
  let histIdx = -1;
  for (let i = hist.length - 1; i >= 0; i--) {
    if (STAT_OPS.has(hist[i]?.op) && hist[i]?.stat === meta.full) { histIdx = i; break; }
  }

  if (!await confirmModal(
    `Retirer 1 point de « ${_esc(meta.label)} » placé à l'Artisan ?<br><span style="color:var(--text-dim)">L'or dépensé n'est pas rendu.</span><br><small style="color:var(--text-dim)">Les stats d'origine de l'objet ne sont pas touchées.</small>`,
    { title: '↩ Retirer un point', confirmLabel: 'Retirer', danger: false, icon: '↩' })) return;

  const inv = [...c.inventaire];
  const newItem = { ...item };
  const up = { ...(newItem.upgrades || {}) };
  const sb = { ...(up.statBonus || {}) };
  const v = (parseInt(sb[meta.store]) || 0) - 1;
  if (v > 0) sb[meta.store] = v; else delete sb[meta.store];
  up.statBonus = sb;
  if (histIdx >= 0) { hist.splice(histIdx, 1); up.history = hist; }
  newItem.upgrades = up;
  inv[invIndex] = newItem;
  c.inventaire = inv;

  await _persistChar(c);
  STORE.flash = invIndex;
  showNotif(`Point de ${meta.label} retiré.`, 'success');
}

// — Action : améliorer une seule des stats proposées par l'anneau
// ══════════════════════════════════════════════
// ANNEAU — approfondit UNE de ses stats natives (budget par rareté, cumulable)
// Même moteur que l'arme, mais limité aux stats déjà portées. L'effet reste figé.
// ══════════════════════════════════════════════
async function _artisanRingAddPoint(invIndex, statFullKey) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = c.inventaire[invIndex];
  if (!item) return;

  const meta = ITEM_STAT_BY_FULL[statFullKey];
  const isOffered = meta && getItemBaseStatBonus(item, meta.full) !== 0;
  if (!isOffered) { showNotif('Cette stat n’est pas proposée par cet anneau.', 'error'); return; }

  const s = getUpgradeSettings();
  const cap = statCapAt(item, item.rarete, s);
  const total = statPointUse(item);
  if (total >= cap) { showNotif(`Plafond atteint (${cap} point${cap > 1 ? 's' : ''}).`, 'error'); return; }

  // Anti-dump : profondeur max ajoutée sur cette stat native (comme l'armure).
  const perStatMax = Math.max(1, parseInt(s.caps?.ringStatMax) || 3);
  const curStat = parseInt(item.upgrades?.statBonus?.[meta.store]) || 0;
  if (curStat >= perStatMax) { showNotif(`${perStatMax} point${perStatMax > 1 ? 's' : ''} max sur une même stat.`, 'error'); return; }

  const slotN = total + 1;
  const cost = s.ring?.[slotN] || 0;
  if (!_canAfford(c, cost)) { showNotif(`Or insuffisant (${cost} PO requis).`, 'error'); return; }

  const inv = [...c.inventaire];
  const newItem = { ...item };
  const up = newItem.upgrades || {};
  newItem.upgrades = {
    ...up,
    statBonus: { ...(up.statBonus || {}), [meta.store]: curStat + 1 },
  };
  // op `ring_upgrade_stat` conservé : le revert MJ le gère déjà comme un point de stat.
  _logUpgradeHistory(newItem, { op: 'ring_upgrade_stat', stat: meta.full, slot: slotN, cost });
  inv[invIndex] = newItem;
  c.inventaire = inv;

  if (cost > 0) _logExpense(c, `Artisan : anneau ${item.nom || ''} +1 ${meta.short}`, cost);

  await _persistChar(c);
  STORE.flash = invIndex;
  showNotif(`+1 ${meta.label} ajouté à l'anneau.`, 'success');
}

// ══════════════════════════════════════════════
// AMULETTE — jusqu'à N stats DISTINCTES, +1 chacune
// ══════════════════════════════════════════════
async function _artisanAmuletAddStat(invIndex, statFullKey) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = c.inventaire[invIndex];
  if (!item) return;

  const meta = ITEM_STAT_BY_FULL[statFullKey];
  if (!meta) return;

  const s = getUpgradeSettings();
  const cap = Math.min(s.caps?.amulet ?? 3, rarityCapFor('stats', item.rarete, s));

  const used = _getUpgradedStatEntries(item);
  const usedPoints = statPointUse(item);
  const usedSet = new Set([
    ..._getBaseStatEntries(item).filter(entry => entry.base > 0).map(entry => entry.meta.full),
    ...used.map(entry => entry.meta.full),
  ]);
  if (usedPoints >= cap) { showNotif(`Plafond de stats atteint (${cap}).`, 'error'); return; }
  if (usedSet.has(meta.full)) {
    showNotif(`Stat ${meta.label} déjà présente sur l’objet.`, 'error'); return;
  }

  const slotN = usedPoints + 1;
  const cost = s.amulet?.[slotN] || 0;
  if (!_canAfford(c, cost)) { showNotif(`Or insuffisant (${cost} PO requis).`, 'error'); return; }

  const inv = [...c.inventaire];
  const newItem = { ...item };
  const up = newItem.upgrades || {};
  newItem.upgrades = {
    ...up,
    statBonus: { ...(up.statBonus || {}), [meta.store]: 1 },
  };
  _logUpgradeHistory(newItem, { op: 'amulet_add_stat', stat: meta.full, slot: slotN, cost });
  inv[invIndex] = newItem;
  c.inventaire = inv;

  if (cost > 0) _logExpense(c, `Artisan : ${item.nom || 'accessoire'} +1 ${meta.short}`, cost);

  await _persistChar(c);
  STORE.flash = invIndex;
  showNotif(`+1 ${meta.label} ajouté à « ${item.nom || 'accessoire'} ».`, 'success');
}

// ══════════════════════════════════════════════
// ARME — points distribuables (cap 1H ou 2H)
// Le joueur peut cumuler plusieurs points sur la même stat ou répartir.
// ══════════════════════════════════════════════
async function _artisanWeaponAddPoint(invIndex, statFullKey) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = c.inventaire[invIndex];
  if (!item) return;

  const meta = ITEM_STAT_BY_FULL[statFullKey];
  if (!meta) return;

  const s = getUpgradeSettings();
  const is2H = weaponHands(item) === 2;
  const cap = Math.min(is2H ? (s.caps?.weapon2H ?? 4) : (s.caps?.weapon1H ?? 2), rarityCapFor('stats', item.rarete, s));
  const tariffTable = is2H ? (s.weapon?.['2H'] || {}) : (s.weapon?.['1H'] || {});

  const total = statPointUse(item);
  if (total >= cap) { showNotif(`Plafond atteint (${cap} points).`, 'error'); return; }

  const slotN = total + 1;
  const cost = tariffTable[slotN] || 0;
  if (!_canAfford(c, cost)) { showNotif(`Or insuffisant (${cost} PO requis).`, 'error'); return; }

  const inv = [...c.inventaire];
  const newItem = { ...item };
  const up = newItem.upgrades || {};
  const curStat = parseInt(up.statBonus?.[meta.store]) || 0;
  newItem.upgrades = {
    ...up,
    statBonus: { ...(up.statBonus || {}), [meta.store]: curStat + 1 },
  };
  _logUpgradeHistory(newItem, { op: 'weapon_add_point', stat: meta.full, slot: slotN, cost });
  inv[invIndex] = newItem;
  c.inventaire = inv;

  if (cost > 0) _logExpense(c, `Artisan : arme ${item.nom || ''} +1 ${meta.short}`, cost);

  await _persistChar(c);
  STORE.flash = invIndex;
  showNotif(`+1 ${meta.label} ajouté à l'arme.`, 'success');
};

// ══════════════════════════════════════════════
// ARMURE — points distribuables (une seule table par rareté). Même moteur que l'arme.
// ══════════════════════════════════════════════
async function _artisanArmorAddPoint(invIndex, statFullKey) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = c.inventaire[invIndex];
  if (!item) return;

  const meta = ITEM_STAT_BY_FULL[statFullKey];
  if (!meta) return;

  const s = getUpgradeSettings();
  const cap = statCapAt(item, item.rarete, s);
  const total = statPointUse(item);
  if (total >= cap) { showNotif(`Plafond atteint (${cap} point${cap > 1 ? 's' : ''}).`, 'error'); return; }

  const perStatMax = Math.max(1, parseInt(s.caps?.armorStatMax) || 3);
  const curStat = getItemUpgradeStatBonus(item, meta.full);
  if (curStat >= perStatMax) { showNotif(`${perStatMax} point${perStatMax > 1 ? 's' : ''} max sur ${meta.label} pour une armure.`, 'error'); return; }

  const slotN = total + 1;
  const cost = s.armor?.[slotN] || 0;
  if (!_canAfford(c, cost)) { showNotif(`Or insuffisant (${cost} PO requis).`, 'error'); return; }

  const inv = [...c.inventaire];
  const newItem = { ...item };
  const up = newItem.upgrades || {};
  newItem.upgrades = {
    ...up,
    statBonus: { ...(up.statBonus || {}), [meta.store]: curStat + 1 },
  };
  _logUpgradeHistory(newItem, { op: 'armor_add_point', stat: meta.full, slot: slotN, cost });
  inv[invIndex] = newItem;
  c.inventaire = inv;

  if (cost > 0) _logExpense(c, `Artisan : armure ${item.nom || ''} +1 ${meta.short}`, cost);

  await _persistChar(c);
  STORE.flash = invIndex;
  showNotif(`+1 ${meta.label} ajouté à l'armure.`, 'success');
}


registerActions({
  _artisanSelectChar: (el) => _artisanSelectChar(el.dataset.id),
  _artisanSelectItem: (btn) => _artisanSelectItem(Number(btn.dataset.i)),
  _artisanFilterItems: (el) => _artisanFilterItems(el.value),
  _artisanFilterCategory: (btn) => _artisanFilterCategory(btn.dataset.category),
  _artisanToggleHideEmpty: () => _artisanToggleHideEmpty(),
  _artisanSelectCompatible: (btn) => _artisanSelectCompatible(btn.dataset.category),
  _artisanTraitPanel: (btn) => _artisanTraitPanel(Number(btn.dataset.i), btn.dataset.trait, btn.dataset.frag),
  _artisanStatPanel: (btn) => _artisanStatPanel(Number(btn.dataset.i), btn.dataset.kind, btn.dataset.stat, btn.dataset.cost),
  _artisanDismantlePanel: (btn) => _artisanDismantlePanel(Number(btn.dataset.i)),
  _artisanOperationFragment: (btn) => _artisanOperationFragment(btn.dataset.frag),
  _artisanDismantleTrait: (el) => _artisanDismantleTrait(el.value),
  _artisanCloseOperation: () => _artisanCloseOperation(),
  _artisanConfirmOperation: () => _artisanConfirmOperation(),
  _artisanScrollSection: (btn) => _artisanScrollSection(btn.dataset.target),
  _artisanToggleMjFree: (el) => _artisanToggleMjFree(el.checked),
  _artisanOpenHistory: (btn) => _artisanOpenHistory(Number(btn.dataset.i)),
  _artisanRevertUpgrade: (btn) => _artisanRevertUpgrade(Number(btn.dataset.i), Number(btn.dataset.h)),
  _artisanDestroyStart: (btn) => _artisanDestroyStart(Number(btn.dataset.i)),
  _artisanDestroyConfirm: (btn) => _artisanDestroyConfirm(Number(btn.dataset.i), btn.dataset.trait),
  _artisanAddTrait: (btn) => _artisanAddTrait(Number(btn.dataset.i), btn.dataset.frag),
  _artisanOverwriteStart: (btn) => _artisanOverwriteStart(Number(btn.dataset.i), btn.dataset.trait),
  _artisanOverwriteConfirm: (btn) => _artisanOverwriteConfirm(Number(btn.dataset.i), btn.dataset.old, btn.dataset.frag),
  _artisanAmuletAddStat: (btn) => _artisanAmuletAddStat(Number(btn.dataset.i), btn.dataset.stat),
  _artisanRemoveStatPoint: (btn) => _artisanRemoveStatPoint(Number(btn.dataset.i), btn.dataset.stat),
  _artisanWeaponAddPoint: (btn) => _artisanWeaponAddPoint(Number(btn.dataset.i), btn.dataset.stat),
  _artisanReforge: (btn) => _artisanReforge(Number(btn.dataset.i)),
  _artisanCloseModal: () => closeModalDirect(),
  _artisanBack: () => closeModalDirect(),
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !STORE.operation) return;
  event.preventDefault();
  _artisanCloseOperation();
});
