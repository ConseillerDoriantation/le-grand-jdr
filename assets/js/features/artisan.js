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
import { weaponHands } from '../shared/weapon-family.js';
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
import { craftCategoryForItem, craftDiscipline, craftRecycleQty } from '../shared/craft-engine.js';
import { craftRecipeMaterials, loadCraftSettings, getCraftSettings } from '../shared/craft-settings.js';
import { evaluateReforge, scaleMaterials } from '../shared/reforge.js';
import { getRarities, loadRarities, RARETE_NAMES, _rareteColor } from '../shared/rarity.js';
import { getDocData, loadCollection } from '../data/firestore.js';
import { shopItemToInvEntry } from '../shared/inventory-utils.js';
import { isTraitRecyclable, recyclableTraits, nonRecyclableTraitNames } from '../shared/trait-recycling.js';
import {
  getItemTraitsSlotCount as getItemTraitsSlotCountPure, statCapAt, firstGainRarity,
  ringTracks, possibleActions, isMaxed, dismantlePreview,
} from '../shared/artisan-logic.js';

export { FRAGMENT_CATEGORIES, getItemFragmentCategory };

const FRAGMENT_CAT_BY_ID = Object.fromEntries(FRAGMENT_CATEGORIES.map(c => [c.id, c]));

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
    openModal('🔨 Artisan', `
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

  const inlineBody = `${toolbar}
    <div class="art-page-grid">
      <section class="art-page-pane art-equipment-pane">
        <div class="art-pane-head">
          <span><small>Inventaire</small><strong>Équipement améliorable</strong></span>
          <span class="art-pane-count">${_getEligibleItems(c).length}</span>
        </div>
        ${_renderItemFilters(c)}
        <div id="art-inline-item-list">${_renderItemList(c)}</div>
      </section>
      <main class="art-page-pane art-workbench-pane">
        <div class="art-pane-head art-pane-head--workbench">
          <span><small>Objet sélectionné</small><strong>Établi</strong></span>
        </div>
        <div id="art-inline-workbench">${_renderWorkbench(c)}</div>
      </main>
      <aside class="art-page-pane art-resources-pane">
        ${_renderFragmentBag(c, { page: true })}
      </aside>
    </div>`;

  if (inlineRoot) {
    inlineRoot.innerHTML = `
      <div class="sh-tool-heading sh-tool-heading--artisan">
        <span class="sh-tool-heading-icon" aria-hidden="true">🔨</span>
        <span>
          <strong>Établi d'amélioration</strong>
          <small>Choisis un objet pour le renforcer, le sertir ou le recycler.</small>
        </span>
      </div>
      ${inlineBody}`;
    return;
  }

  openModal('🔨 Artisan — Améliorations d\'équipement', modalBody,
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
  const counts = eligible.reduce((acc, { cat }) => {
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {});
  const categories = FRAGMENT_CATEGORIES.filter(cat => counts[cat.id]);
  return `<div class="art-item-tools">
    <div class="art-item-search">
      <span aria-hidden="true">🔎</span>
      <input type="search" value="${_esc(STORE.itemSearch)}" placeholder="Rechercher un équipement…"
        data-input="_artisanFilterItems" aria-label="Rechercher un équipement améliorable">
    </div>
    <div class="art-item-categories" aria-label="Filtrer par type d'équipement">
      <button type="button" class="art-item-category${STORE.itemCategory === 'all' ? ' is-active' : ''}"
        data-action="_artisanFilterCategory" data-category="all">Tous <span>${eligible.length}</span></button>
      ${categories.map(cat => `<button type="button" class="art-item-category${STORE.itemCategory === cat.id ? ' is-active' : ''}"
        data-action="_artisanFilterCategory" data-category="${_esc(cat.id)}">${cat.icon} ${_esc(cat.label)} <span>${counts[cat.id]}</span></button>`).join('')}
      <button type="button" class="art-item-category art-hide-empty${STORE.hideEmpty ? ' is-active' : ''}"
        data-action="_artisanToggleHideEmpty" aria-pressed="${STORE.hideEmpty}">Masquer au max</button>
    </div>
  </div>`;
}

function _renderFragmentBag(c, { page = false } = {}) {
  const bag = getCharacterFragments(c);
  const selected = (c?.inventaire || [])[STORE.activeItemIndex];
  const selectedCategory = selected ? getItemFragmentCategory(selected) : null;
  const totalCount = Object.values(bag).reduce(
    (s, frags) => s + Object.values(frags || {}).reduce((s2, n) => s2 + (parseInt(n) || 0), 0),
    0,
  );

  const selectedIndex = STORE.activeItemIndex;
  const renderFragmentCategory = cat => {
    const frags = bag[cat.id] || {};
    const entries = Object.entries(frags).filter(([, n]) => (parseInt(n) || 0) > 0);
    if (!entries.length) return '';
    const categoryCount = entries.reduce((sum, [, n]) => sum + (parseInt(n) || 0), 0);
    const rows = entries.map(([name, n]) =>
      `<div class="art-frag-entry" title="Compatible avec : ${_esc(cat.label)}">
        <span class="art-frag-mark" aria-hidden="true">◆</span><span class="art-frag-entry-name">${_esc(name)}</span>
        <span class="art-frag-chip-n">×${n}</span>
        ${selectedCategory === cat.id
          ? `<button type="button" class="art-frag-use" data-action="_artisanTraitPanel" data-i="${selectedIndex}" data-frag="${_esc(name)}">Poser</button>`
          : `<button type="button" class="art-frag-use" data-action="_artisanSelectCompatible" data-category="${_esc(cat.id)}">Voir</button>`}
      </div>`
    ).join('');
    return `<details class="art-frag-cat" ${!page || selectedCategory === cat.id ? 'open' : ''}>
      <summary class="art-frag-cat-hd">
        <span>${cat.icon} ${_esc(cat.label)}</span>
        <span class="art-frag-cat-count">${categoryCount}</span>
      </summary>
      <div class="art-frag-cat-list">${rows}</div>
    </details>`;
  };
  const selectedMeta = FRAGMENT_CATEGORIES.find(cat => cat.id === selectedCategory);
  const selectedSection = selectedMeta ? renderFragmentCategory(selectedMeta) : '';
  const otherSections = FRAGMENT_CATEGORIES
    .filter(cat => cat.id !== selectedCategory)
    .map(renderFragmentCategory).filter(Boolean).join('');
  const hasFragments = !!(selectedSection || otherSections);

  const materialReq = selected ? (_reforgeContext(selected, c).materialReq || []) : [];
  const materialRows = materialReq.map(req => {
    const owned = (c?.inventaire || []).filter(entry => entry?.itemId === req.itemId).length;
    const shopItem = STORE.shopItems.find(entry => entry.id === req.itemId);
    const name = shopItem?.nom || (c?.inventaire || []).find(entry => entry?.itemId === req.itemId)?.nom || 'Matériau requis';
    return `<div class="art-material-row${owned >= req.quantite ? ' is-ready' : ''}">
      <span><i aria-hidden="true">⬡</i><b>${_esc(name)}</b><small>${owned}/${req.quantite}</small></span>
      ${shopItem ? `<button type="button" data-sh-action="cartInc" data-id="${_esc(req.itemId)}">Panier +</button>` : ''}
    </div>`;
  }).join('');

  return `
    <div class="art-frag-bag${page ? ' art-frag-bag--page' : ''}${STORE.resourceFlash ? ' is-flash' : ''}">
      <div class="art-frag-bag-hd">
        <span class="art-frag-bag-title">🎒 Sac de fragments</span>
        <span class="art-frag-total">${totalCount}</span>
      </div>
      <div class="art-frag-hint">Les fragments gardent la famille de la pièce démontée.</div>
      ${selectedCategory ? '<div class="art-bag-section-title">Pour cette pièce</div>' : ''}
      ${selectedSection || (selectedCategory ? '<div class="art-frag-empty">Aucun fragment compatible.</div>' : '')}
      ${otherSections ? '<div class="art-bag-section-title">Pour d’autres pièces</div>' + otherSections : ''}
      ${hasFragments ? '' : `<div class="art-frag-empty">Aucun fragment — recycle un équipement à trait pour en obtenir.</div>`}
      <div class="art-bag-section-title">Matériaux de reforge</div>
      ${materialRows || '<div class="art-frag-empty">Sélectionne une pièce pour voir les matériaux requis.</div>'}
      <div class="art-cycle"><strong>Le cycle de l’Artisan</strong><span>Démonte une pièce → récupère fragments et matériaux → améliore ou reforge ton équipement.</span></div>
    </div>`;
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

// ── Liste des objets améliorables (colonne gauche, sélectionnable) ──────
function _renderItemList(c) {
  if (!c) return `<div class="art-empty">Sélectionne un personnage.</div>`;
  const allEligible = _getEligibleItems(c);
  const q = _norm(STORE.itemSearch);
  const eligible = allEligible.filter(({ it, cat }) => {
    if (STORE.itemCategory !== 'all' && cat !== STORE.itemCategory) return false;
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
  const row = ({ it, idx, cat }) => {
      const meta = FRAGMENT_CAT_BY_ID[cat];
      const active = idx === STORE.activeItemIndex;
      const summary = _itemSummary(it);
      const traits = _getTraits(it).length, traitCap = getItemTraitsSlotCount(it);
      const stats = _sumUpgradeStatPoints(it), statCap = statCapAt(it, it.rarete, getUpgradeSettings());
      const reforge = _reforgeContext(it, c).ev;
      const actions = possibleActions(c, it, { upgrade: getUpgradeSettings(), gold: calcOr(c), freeMode: STORE.mjFreeMode, reforgeEval: reforge });
      const count = ['addTrait', 'replaceTrait', 'stat', 'reforge'].filter(key => actions[key]).length;
      const rarete = Math.max(1, parseInt(it.rarete, 10) || 1);
      const meter = (used, cap, tone) => `<span class="art-mini-meter is-${tone}">${Array.from({ length: Math.max(1, cap) }, (_, k) => `<i class="${k < used ? 'is-on' : ''}"></i>`).join('')}</span>`;
      return `<button class="art-item-card${active ? ' is-active' : ''}${STORE.flash === idx ? ' is-flash' : ''}" data-action="_artisanSelectItem" data-i="${idx}">
        <span class="art-item-cat" title="${_esc(meta?.label || '')}">${'◆'.repeat(Math.min(5, rarete))}</span>
        <span class="art-item-card-body">
          <span class="art-item-name">${_esc(it.nom || 'Sans nom')}</span><span class="art-item-rarity">${_esc(RARETE_NAMES[rarete] || '')} · ${_esc(meta?.label || cat)}</span>
          <span class="art-item-meters">${meter(traits, traitCap, 'trait')}${statCap ? meter(stats, statCap, 'stat') : ''}</span>
          <span class="art-item-sum">${count ? `${count} possible${count > 1 ? 's' : ''}` : (summary || 'Au maximum')}</span>
        </span>
        <span class="art-item-chev">${active ? '▾' : '›'}</span>
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
    return `<div class="art-wb-empty">
      <div class="art-wb-empty-ic">🔨</div>
      <div>Choisis un objet à gauche pour voir ce que tu peux améliorer.</div>
    </div>`;
  }
  const item = (c.inventaire || [])[STORE.activeItemIndex];
  const cat = item ? getItemFragmentCategory(item) : null;
  if (!item || !cat) { STORE.activeItemIndex = null; return _renderWorkbench(c); }
  const meta = FRAGMENT_CAT_BY_ID[cat];
  const i = STORE.activeItemIndex;

  // État actuel (bonus de stats + traits)
  const upBonus = ITEM_STAT_META
    .map(m => [m.short, getItemUpgradeStatBonus(item, m.full)])
    .filter(([, v]) => v > 0)
    .map(([s, v]) => `<span class="art-up-chip">+${v} ${s}</span>`).join('');
  const allTraits = _getTraits(item);
  const traitState = allTraits.length
    ? allTraits.map(t => `<span class="art-trait-chip">${_esc(t)}</span>`).join('')
    : '<span class="art-muted" style="font-size:.72rem">aucun trait</span>';

  const histBtn = Array.isArray(item?.upgrades?.history) && item.upgrades.history.length
    ? `<button class="art-wb-hist" data-action="_artisanOpenHistory" data-i="${i}" title="Historique des améliorations">📜 ${item.upgrades.history.length}</button>`
    : '';

  const rarity = Math.max(1, parseInt(item.rarete, 10) || 1);
  const traitCap = getItemTraitsSlotCount(item);
  const statCap = statCapAt(item, rarity, getUpgradeSettings());
  const statUsed = _sumUpgradeStatPoints(item);
  const nextGain = firstGainRarity(item, getUpgradeSettings());
  const equipped = Object.entries(c.equipement || {}).find(([, eq]) => Number(eq?.sourceInvIndex) === i)?.[0] || '';
  const propertyBits = [item.format, item.typeArmure, item.nature, item.portee].filter(Boolean);
  const capacity = (label, used, cap, tone, target) => `<button type="button" class="art-capacity is-${tone}" data-action="_artisanScrollSection" data-target="${target}">
    <span>${label}</span><strong>${used}/${cap || '—'}</strong><i>${cap ? `${Math.max(0, cap - used)} libre${cap - used > 1 ? 's' : ''}` : 'non applicable'}</i>
  </button>`;

  return `<div class="art-wb">
    <div class="art-wb-hero">
      <span class="art-wb-ico">${meta?.icon || '◇'}</span>
      <span class="art-wb-identity"><small style="color:${_rareteColor(RARETE_NAMES[rarity]) || 'var(--text-dim)'}">${'◆'.repeat(Math.min(5, rarity))} ${_esc(RARETE_NAMES[rarity] || '')}</small><strong>${_esc(item.nom || 'Sans nom')}</strong><em>${_esc(meta?.label || cat)}${propertyBits.length ? ` · ${_esc(propertyBits.join(' · '))}` : ''}</em></span>
      ${equipped ? `<span class="art-equipped-badge">Équipé · ${_esc(equipped)}</span>` : ''}${histBtn}
      <div class="art-wb-state">${upBonus}${traitState}</div>
    </div>
    <div class="art-capacities">
      ${capacity('Traits', allTraits.length, traitCap, 'trait', 'art-section-traits')}
      ${capacity('Stats', statUsed, statCap, 'stat', 'art-section-stats')}
      ${capacity('Prochain gain', nextGain ? rarity : rarity, nextGain || rarity, 'rarity', 'art-section-reforge')}
    </div>
    ${_renderOperationPanel(item, i, c, cat)}
    <div id="art-section-traits">${_renderTraitsSection(item, i, c, cat)}</div>
    <div id="art-section-stats">${_renderStatsSection(item, i, c, cat)}</div>
    <div id="art-section-reforge">${_renderReforgeSection(item, i, c)}</div>
    ${_renderRecycleSection(item, i, cat)}
  </div>`;
}

function _renderOperationPanel(item, invIndex, c, cat) {
  const op = STORE.operation;
  if (!op || op.invIndex !== invIndex) return '';
  const close = '<button type="button" class="art-op-close" data-action="_artisanCloseOperation" aria-label="Fermer">×</button>';
  const s = getUpgradeSettings();
  const fragments = Object.entries(c.traitFragments?.[cat] || {}).filter(([, qty]) => (parseInt(qty, 10) || 0) > 0);
  if (op.type === 'trait') {
    const replace = !!op.oldTrait;
    return `<section class="art-op-panel"><header><span><small>${replace ? 'Remplacer un trait' : 'Ajouter un trait'}</small><strong>${replace ? `« ${_esc(op.oldTrait)} » sera perdu` : 'Choisis un fragment compatible'}</strong></span>${close}</header>
      <div class="art-op-options">${fragments.map(([name, qty]) => `<button type="button" class="${op.fragment === name ? 'is-selected' : ''}" data-action="_artisanOperationFragment" data-frag="${_esc(name)}"><span>◆ ${_esc(name)}</span><b>×${qty}</b></button>`).join('') || '<p>Aucun fragment compatible.</p>'}</div>
      <footer><span>${STORE.mjFreeMode ? 'Gratuit · mode MJ' : `${replace ? s.trait.overwriteTrait : s.trait.addTraitFromFragment} PO`} · 1 fragment</span><button type="button" class="art-op-confirm" data-action="_artisanConfirmOperation" ${op.fragment ? '' : 'disabled'}>Confirmer</button></footer>
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
    const detail = [
      e.stat   ? `stat ${e.stat}` : null,
      e.level  ? `palier ${e.level}` : null,
      e.trait  ? `trait « ${e.trait} »` : null,
      e.value  ? `trait « ${e.value} »` : null,
      (e.from || e.to) ? `${e.from || '?'} → ${e.to || '?'}` : null,
    ].filter(Boolean).join(' · ');
    const cost = parseInt(e.cost) || 0;
    const mj   = e.mjOverride ? ' <span style="color:#ff6b6b;font-weight:700">MJ</span>' : '';
    // MJ : bouton de suppression/correction par entrée (annule l'effet + rembourse).
    const del = STATE.isAdmin
      ? `<button class="btn btn-outline btn-sm" style="padding:.15rem .4rem;font-size:.72rem;border-color:var(--danger,#e5484d);color:var(--danger,#e5484d)"
          data-action="_artisanRevertUpgrade" data-i="${invIndex}" data-h="${idx}"
          title="Supprimer cette amélioration (annule l'effet et rembourse l'or)">🗑 Supprimer</button>`
      : '';
    return `<div style="display:flex;justify-content:space-between;gap:.5rem;align-items:center;
      padding:.4rem .55rem;border-radius:6px;background:var(--bg-elevated);
      border:1px solid var(--border);font-size:.78rem">
      <div style="min-width:0">
        <div style="font-weight:600;color:var(--text)">${_esc(op)}${mj}</div>
        <div style="color:var(--text-dim);font-size:.72rem">${_esc(detail || '—')}</div>
      </div>
      <div style="display:flex;align-items:center;gap:.5rem;white-space:nowrap">
        <div style="text-align:right">
          <div style="color:var(--gold);font-weight:700">${cost} PO</div>
          <div style="color:var(--text-dim);font-size:.7rem">${date}</div>
        </div>
        ${del}
      </div>
    </div>`;
  };

  const totalCost = hist.reduce((s, e) => s + (parseInt(e.cost) || 0), 0);
  const body = hist.length
    ? `<div style="display:flex;flex-direction:column;gap:.4rem;max-height:50vh;overflow-y:auto">${hist.map(fmt).join('')}</div>
       <div style="margin-top:.75rem;padding-top:.5rem;border-top:1px solid var(--border);
         font-size:.8rem;color:var(--text-muted);display:flex;justify-content:space-between">
         <span>Total investi</span><strong style="color:var(--gold)">${totalCost} PO</strong>
       </div>`
    : `<div style="padding:1rem;text-align:center;color:var(--text-dim);font-size:.85rem">
         Aucun historique pour cet item.
       </div>`;

  pushModal(`📜 Historique — ${_esc(item.nom || 'objet')}`, `${body}
    <div style="margin-top:.85rem;text-align:right">
      <button class="btn btn-outline btn-sm" data-action="_artisanCloseModal">Fermer</button>
    </div>`);
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
  if (!discipline) return '';  // objet non reforgeable (pas de discipline de craft)
  if (!ev.target) {
    return `<div class="art-wb-sec"><div class="art-wb-sec-hd">⭐ Reforge</div><div class="art-muted" style="font-size:.72rem">Rareté maximale atteinte.</div></div>`;
  }
  const free = STORE.mjFreeMode;
  const targetName = RARETE_NAMES[ev.target] || `Rareté ${ev.target}`;
  const targetColor = _rareteColor(RARETE_NAMES[ev.target]) || 'var(--text)';

  const line = (ok, html) => `<div style="display:flex;gap:7px;align-items:baseline;font-size:.74rem;color:${ok ? 'var(--text-soft)' : 'var(--text-dim)'}"><span style="color:${ok ? 'var(--emerald)' : 'var(--text-dim)'}">${ok ? '✓' : '○'}</span><span>${html}</span></div>`;

  const roomLine = line(free || ev.roomOk,
    `Salle <b>${_esc(_roomLabel(roomSlug))}</b> niv. ${ev.requiredLevel} <span class="art-muted">(construite : niv. ${roomLevel})</span>`);
  const matLines = materialReq.length
    ? materialReq.map(req => {
        const owned = (c.inventaire || []).filter(it => it && it.itemId === req.itemId).length;
        const name = (c.inventaire || []).find(it => it && it.itemId === req.itemId)?.nom || 'Matériau requis';
        return line(free || owned >= req.quantite, `${_esc(name)} <span class="art-muted">${owned}/${req.quantite}</span>`);
      }).join('')
    : line(false, '<span class="art-muted">Aucune recette de matériaux pour cette catégorie (console MJ → Craft).</span>');
  const goldLine = line(free || ev.goldOk, `${ev.goldCost} PO`);

  const allow = free || ev.ok;
  const gainRarity = firstGainRarity(item, getUpgradeSettings());
  const useful = gainRarity === ev.target;
  const btn = `<button class="art-act art-act--gold" data-action="_artisanReforge" data-i="${invIndex}" ${allow ? '' : 'disabled'}>${useful ? 'Reforger' : 'Reforge intermédiaire'} → <b style="color:${targetColor}">${_esc(targetName)}</b>${free ? ' <span class="art-act-cost">Gratuit (MJ)</span>' : ''}</button>`;
  const ladder = getRarities().map(rarity => {
    const traits = getItemTraitsSlotCountPure({ ...item, rarete: rarity.value }, getUpgradeSettings());
    const stats = statCapAt(item, rarity.value, getUpgradeSettings());
    const state = rarity.value < (parseInt(item.rarete, 10) || 1) ? ' is-past' : rarity.value === (parseInt(item.rarete, 10) || 1) ? ' is-current' : rarity.value === ev.target ? ' is-next' : '';
    return `<span class="art-reforge-step${state}" style="--rarity:${_rareteColor(rarity.name) || '#8294ad'}"><i>◆</i><b>${_esc(rarity.name)}</b><small>${traits} trait${traits > 1 ? 's' : ''}${stats ? ` · ${stats} stat${stats > 1 ? 's' : ''}` : ''}</small></span>`;
  }).join('');

  return `<div class="art-wb-sec">
    <div class="art-wb-sec-hd">⭐ Reforge <span class="art-wb-sec-sub">monter la rareté (définitif)</span></div>
    <div class="art-reforge-ladder">${ladder}</div>
    ${!useful && gainRarity ? `<div class="art-muted" style="font-size:.7rem;margin-bottom:6px">Cette étape prépare la pièce ; le prochain budget se débloque en ${_esc(RARETE_NAMES[gainRarity] || `rareté ${gainRarity}`)}.</div>` : ''}
    <div style="display:flex;flex-direction:column;gap:3px;margin:2px 0 8px">${roomLine}${matLines}${goldLine}</div>
    <div class="art-act-row">${btn}</div>
  </div>`;
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
  const slotsLibres= Math.max(0, slotCount - totalUsed);
  const s          = getUpgradeSettings();
  const fragments  = c.traitFragments?.[cat] || {};
  const fragNames  = Object.entries(fragments).filter(([, n]) => (parseInt(n) || 0) > 0).map(([name, n]) => ({ name, n }));
  const replaceableTraits = allTraits.filter(trait => isTraitRecyclable(item, trait));

  if (slotCount <= 0) return '';

  // Pastilles d'emplacements (pleins / libres)
  const pips = Array.from({ length: slotCount }, (_, k) =>
    `<span class="art-pip${k < totalUsed ? ' is-on' : ''}"></span>`).join('');

  // Chips des traits actuels (base + ajoutés★) — lecture seule (le remplacement
  // a maintenant sa propre rangée d'actions, aussi visible que l'ajout).
  const traitRows = allTraits.length
    ? allTraits.map((t, k) => {
        const locked = !isTraitRecyclable(item, t);
        return `<span class="art-trait-chip${k >= baseTraits.length ? ' art-trait-chip--added' : ''}${locked ? ' art-trait-chip--locked' : ''}"${locked ? ' title="Trait non recyclable et non remplaçable"' : ''}>${locked ? '<span aria-hidden="true">🔒</span> ' : ''}${_esc(t)}${k >= baseTraits.length ? ' ★' : ''}</span>`;
      }).join('')
    : '<span class="art-muted" style="font-size:.72rem">Aucun trait posé.</span>';

  // ── Ajouter (slot libre) ──
  let addHtml = '';
  if (slotsLibres > 0) {
    addHtml = fragNames.length
      ? `<div class="art-sub"><span class="art-sub-lbl art-sub-lbl--add">Emplacement libre</span>
          <div class="art-act-row"><button class="art-act art-act--gold" data-action="_artisanTraitPanel" data-i="${invIndex}">＋ Choisir un fragment <span class="art-act-cost">${s.trait.addTraitFromFragment} PO</span></button></div>
        </div>`
      : `<div class="art-muted" style="font-size:.72rem">Aucun fragment « ${_esc(catMeta?.label || cat)} » dans ton sac. Recycle un objet pour en obtenir.</div>`;
  }

  // ── Remplacer (même poids visuel que l'ajout) ──
  let owHtml = '';
  if (replaceableTraits.length && fragNames.length) {
    owHtml = `<div class="art-sub"><span class="art-sub-lbl art-sub-lbl--replace">↻ Remplacer un trait</span>
      <div class="art-act-row">${replaceableTraits.map(t => `<button class="art-act art-act--replace" data-action="_artisanTraitPanel" data-i="${invIndex}" data-trait="${_esc(t)}" title="Remplacer « ${_esc(t)} » par un fragment (${s.trait.overwriteTrait} PO)">
        <span class="art-act-lbl">${_esc(t)}</span><span class="art-act-cost">${s.trait.overwriteTrait} PO</span></button>`).join('')}</div>
    </div>`;
  }

  return `<div class="art-wb-sec">
    <div class="art-wb-sec-hd">🔖 Traits <span class="art-wb-sec-sub">${totalUsed}/${slotCount} emplacement${slotCount > 1 ? 's' : ''}</span><span class="art-pips">${pips}</span></div>
    <div class="art-trait-current">${traitRows}</div>
    ${addHtml}${owHtml}
    ${(slotsLibres <= 0 && !allTraits.length) ? '' : ''}
  </div>`;
}

// Section « Recycler » (ex-destruction) — récupère les traits en fragments.
function _renderRecycleSection(item, invIndex, cat) {
  const s = getUpgradeSettings();
  const allTraits = _getTraits(item);
  if (!allTraits.length && !craftCategoryForItem(item)) return '';
  const extractInfo = !allTraits.length
    ? 'Aucun fragment, mais la part configurée de la recette est rendue.'
    : s.trait.extractAllTraits
    ? `Tu récupères ${allTraits.length} fragment${allTraits.length > 1 ? 's' : ''}.`
    : (allTraits.length > 1 ? 'Tu choisiras le trait à récupérer (les autres sont perdus).' : 'Tu récupères son trait en fragment.');
  return `<div class="art-wb-sec art-wb-sec--danger">
    <div class="art-wb-sec-hd">♻️ Démonter</div>
    <div class="art-recycle">
      <button class="art-act art-act--danger" data-action="_artisanDismantlePanel" data-i="${invIndex}">♻️ Démonter <span class="art-act-cost">${s.trait.deconstructCost} PO</span></button>
      <span class="art-muted" style="font-size:.72rem">Détruit l'objet. ${extractInfo}</span>
    </div>
  </div>`;
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
  STORE.itemCategory = FRAGMENT_CAT_BY_ID[category] ? category : 'all';
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
  const compatible = _getEligibleItems(c).find(entry => entry.cat === category);
  if (!compatible) { showNotif('Aucune pièce compatible dans cet inventaire.', 'info'); return; }
  STORE.activeItemIndex = compatible.idx;
  STORE.itemCategory = category;
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
    if (op.kind === 'ring-stat') await _artisanRingUpgradeStat(op.invIndex, op.stat);
    else if (op.kind === 'ring-effect') await _artisanRingUpgradeEffect(op.invIndex);
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
function _renderStatsSection(item, invIndex, c, cat) {
  if (cat === 'Anneau')   return _renderRingStats(item, invIndex, c);
  if (cat === 'Amulette') return _renderAmuletStats(item, invIndex, c);
  if (cat === 'arme')     return _renderWeaponStats(item, invIndex, c);
  return `<div class="art-wb-sec">
    <div class="art-wb-sec-hd">📈 Stats</div>
    <div class="art-muted" style="font-size:.72rem">Cet objet s'améliore uniquement par ses <strong>traits</strong> (pas de bonus de stats).</div>
  </div>`;
}

// ── Helpers communs ──────────────────────────────────────────────────

// Stats réellement proposées par l'objet. Un anneau peut en porter plusieurs :
// chacune garde son propre palier d'amélioration.
function _getBaseStatEntries(item) {
  return ITEM_STAT_META
    .map(meta => ({ meta, base: getItemBaseStatBonus(item, meta.full) }))
    .filter(({ base }) => base !== 0);
}

// Somme totale des points de stats déjà ajoutés via upgrades.
function _sumUpgradeStatPoints(item) {
  const sb = item?.upgrades?.statBonus || {};
  return Object.values(sb).reduce((s, v) => s + (parseInt(v) || 0), 0);
}

// Liste des stats déjà améliorées avec leur valeur.
function _getUpgradedStatEntries(item) {
  const sb = item?.upgrades?.statBonus || {};
  return ITEM_STAT_META
    .map(m => ({ meta: m, val: parseInt(sb[m.store]) || 0 }))
    .filter(({ val }) => val > 0);
}

// ══════════════════════════════════════════════
// ANNEAU — TRACKS INDÉPENDANTS
//   • Chaque stat proposée par l'objet — paliers 1..cap
//   • Effet flat (effectBonus)     — paliers 1..cap
// Tarif `s.ring[N]` partagé par tous les tracks.
// ══════════════════════════════════════════════
function _renderRingStats(item, invIndex, c) {
  const s = getUpgradeSettings();
  const cap = s.caps?.ring ?? 1;
  const stats = _getBaseStatEntries(item).map(entry => ({
    ...entry,
    level: getItemUpgradeStatBonus(item, entry.meta.full),
  }));
  const effectLevel = parseInt(item.upgrades?.effectBonus) || 0;

  const statActs = stats.flatMap(({ meta, level }) => {
    const nextLevel = level + 1;
    if (nextLevel > cap) return [];
    const cost = s.ring?.[nextLevel] || 0;
    return [`<button class="art-act art-act--emerald" data-action="_artisanStatPanel" data-i="${invIndex}" data-kind="ring-stat" data-stat="${_esc(meta.full)}" data-cost="${cost}">📈 +1 ${meta.short} <span class="art-act-cost">${cost} PO</span></button>`];
  });
  const acts = [...statActs];
  const nextEff = effectLevel + 1;
  if (nextEff <= cap) {
    const cost = s.ring?.[nextEff] || 0;
    // L'effet n'existe que si l'anneau propose réellement un bonus dérivé.
    if (ringTracks(item, s).some(track => track.kind === 'effect')) acts.push(`<button class="art-act art-act--gold" data-action="_artisanStatPanel" data-i="${invIndex}" data-kind="ring-effect" data-stat="effect" data-cost="${cost}">✨ Renforcer l'effet <span class="art-act-cost">${cost} PO</span></button>`);
  }

  const cur = stats.map(({ meta, base, level }) => {
    const total = base + level;
    return `<span class="art-up-chip stat-tone stat-${meta.full}" title="${_esc(meta.label)} : ${base > 0 ? '+' : ''}${base} de base${level ? `, +${level} par l'Artisan` : ''}">${total > 0 ? '+' : ''}${total} ${meta.short}</span>`;
  });
  if (ringTracks(item, s).some(track => track.kind === 'effect')) cur.push(`<span class="art-up-chip">Effet +${effectLevel}</span>`);
  const maxedStats = stats.filter(({ level }) => level >= cap).length;
  const statProgress = stats.length ? `${maxedStats}/${stats.length} stats au maximum` : 'aucune stat proposée';
  const baseEffect = item.effet ? `<div class="art-muted" style="font-size:.7rem;margin-top:.35rem">Effet : <em>${_esc(item.effet)}</em></div>` : '';

  return `<div class="art-wb-sec">
    <div class="art-wb-sec-hd">📈 Stats d'anneau <span class="art-wb-sec-sub">${statProgress} · effet ${effectLevel}/${cap}</span></div>
    <div class="art-trait-current">${cur.join('')}</div>
    ${acts.length ? `<div class="art-act-row">${acts.join('')}</div>` : `<div class="art-muted" style="font-size:.72rem">Tout est au palier maximum.</div>`}
    ${baseEffect}
  </div>`;
}

function _renderAmuletStats(item, invIndex, c) {
  const s = getUpgradeSettings();
  const cap = Math.min(s.caps?.amulet ?? 3, rarityCapFor('stats', item.rarete, s));
  const used = _getUpgradedStatEntries(item);
  const usedSet = new Set(used.map(e => e.meta.full));
  const slotN = used.length + 1;
  const cost = slotN <= cap ? (s.amulet?.[slotN] || 0) : 0;
  const remaining = ITEM_STAT_META.filter(m => !usedSet.has(m.full));
  const canAdd = used.length < cap && remaining.length > 0;

  const cur = used.length ? used.map(e => `<span class="art-up-chip">+${e.val} ${e.meta.short}</span>`).join('') : '<span class="art-muted" style="font-size:.72rem">aucune stat améliorée</span>';
  const add = canAdd
    ? `<div class="art-act-row">${remaining.map(m => `<button class="art-act art-act--emerald" data-action="_artisanStatPanel" data-i="${invIndex}" data-kind="amulet" data-stat="${_esc(m.full)}" data-cost="${cost}">+1 ${m.short} <span class="art-act-cost">${cost} PO</span></button>`).join('')}</div>`
    : `<div class="art-muted" style="font-size:.72rem">${used.length >= cap ? `Plafond atteint (${cap} stats).` : 'Toutes les stats sont déjà améliorées.'}</div>`;

  return `<div class="art-wb-sec">
    <div class="art-wb-sec-hd">📈 Stats d'amulette <span class="art-wb-sec-sub">${used.length}/${cap} stats</span></div>
    <div class="art-trait-current">${cur}</div>
    ${add}
  </div>`;
}

function _renderWeaponStats(item, invIndex, c) {
  const s = getUpgradeSettings();
  const is2H = weaponHands(item) === 2;
  const cap = Math.min(is2H ? (s.caps?.weapon2H ?? 4) : (s.caps?.weapon1H ?? 2), rarityCapFor('stats', item.rarete, s));
  const tariff = is2H ? (s.weapon?.['2H'] || {}) : (s.weapon?.['1H'] || {});
  const used = _getUpgradedStatEntries(item);
  const total = used.reduce((a, e) => a + e.val, 0);
  const slotN = total + 1;
  const cost = total < cap ? (tariff[slotN] || 0) : 0;
  const canAdd = total < cap;

  const cur = used.length ? used.map(e => `<span class="art-up-chip">+${e.val} ${e.meta.short}</span>`).join('') : '<span class="art-muted" style="font-size:.72rem">aucun point placé</span>';
  const bar = `<span class="art-bar"><span style="width:${Math.round(total / cap * 100)}%"></span></span>`;
  const add = canAdd
    ? `<div class="art-act-row">${ITEM_STAT_META.map(m => `<button class="art-act art-act--emerald" data-action="_artisanStatPanel" data-i="${invIndex}" data-kind="weapon" data-stat="${_esc(m.full)}" data-cost="${cost}">+1 ${m.short} <span class="art-act-cost">${cost} PO</span></button>`).join('')}</div>`
    : `<div class="art-muted" style="font-size:.72rem">Plafond atteint (${total}/${cap} points).</div>`;

  return `<div class="art-wb-sec">
    <div class="art-wb-sec-hd">📈 Stats d'arme <span class="art-wb-sec-sub">${total}/${cap} points</span>${bar}</div>
    <div class="art-trait-current">${cur}</div>
    ${add}
  </div>`;
}

// — Action : améliorer une seule des stats proposées par l'anneau
async function _artisanRingUpgradeStat(invIndex, statFullKey) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = c.inventaire[invIndex];
  if (!item) return;

  const meta = ITEM_STAT_BY_FULL[statFullKey];
  const isOffered = meta && getItemBaseStatBonus(item, meta.full) !== 0;
  if (!isOffered) { showNotif('Cette stat n’est pas proposée par cet anneau.', 'error'); return; }

  const s = getUpgradeSettings();
  const cap = s.caps?.ring ?? 1;
  const level = getItemUpgradeStatBonus(item, meta.full);
  const nextLevel = level + 1;
  if (nextLevel > cap) { showNotif(`Stat au palier max (${cap}).`, 'error'); return; }

  const cost = s.ring?.[nextLevel] || 0;
  if (!_canAfford(c, cost)) { showNotif(`Or insuffisant (${cost} PO requis).`, 'error'); return; }

  const inv = [...c.inventaire];
  const newItem = { ...item };
  const up = newItem.upgrades || {};
  newItem.upgrades = {
    ...up,
    statBonus: { ...(up.statBonus || {}), [meta.store]: nextLevel },
  };
  _logUpgradeHistory(newItem, { op: 'ring_upgrade_stat', level: nextLevel, stat: meta.full, cost });
  inv[invIndex] = newItem;
  c.inventaire = inv;

  if (cost > 0) _logExpense(c, `Artisan : anneau ${item.nom || ''} stat ${meta.short} +${nextLevel}`, cost);

  await _persistChar(c);
  STORE.flash = invIndex;
  showNotif(`Stat ${meta.label} améliorée au palier ${nextLevel}.`, 'success');
}

// — Action : améliorer l'effet de l'anneau seul
async function _artisanRingUpgradeEffect(invIndex) {
  const c = _getActiveArtisanChar();
  if (!c) return;
  const item = c.inventaire[invIndex];
  if (!item) return;

  const s = getUpgradeSettings();
  const cap = s.caps?.ring ?? 1;
  const level = parseInt(item.upgrades?.effectBonus) || 0;
  const nextLevel = level + 1;
  if (nextLevel > cap) { showNotif(`Effet au palier max (${cap}).`, 'error'); return; }

  const cost = s.ring?.[nextLevel] || 0;
  if (!_canAfford(c, cost)) { showNotif(`Or insuffisant (${cost} PO requis).`, 'error'); return; }

  const inv = [...c.inventaire];
  const newItem = { ...item };
  const up = newItem.upgrades || {};
  newItem.upgrades = { ...up, effectBonus: nextLevel };
  _logUpgradeHistory(newItem, { op: 'ring_upgrade_effect', level: nextLevel, cost });
  inv[invIndex] = newItem;
  c.inventaire = inv;

  if (cost > 0) _logExpense(c, `Artisan : anneau ${item.nom || ''} effet +${nextLevel}`, cost);

  await _persistChar(c);
  STORE.flash = invIndex;
  showNotif(`Effet renforcé au palier ${nextLevel}.`, 'success');
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
  if (used.length >= cap) { showNotif(`Plafond amulette atteint (${cap}).`, 'error'); return; }
  if (used.some(e => e.meta.full === meta.full)) {
    showNotif(`Stat ${meta.label} déjà améliorée.`, 'error'); return;
  }

  const slotN = used.length + 1;
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

  if (cost > 0) _logExpense(c, `Artisan : amulette ${item.nom || ''} +1 ${meta.short}`, cost);

  await _persistChar(c);
  STORE.flash = invIndex;
  showNotif(`+1 ${meta.label} ajouté à l'amulette.`, 'success');
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

  const sb = item.upgrades?.statBonus || {};
  const total = Object.values(sb).reduce((s2, v) => s2 + (parseInt(v) || 0), 0);
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
  _artisanRingUpgradeStat: (btn) => _artisanRingUpgradeStat(Number(btn.dataset.i), btn.dataset.stat),
  _artisanRingUpgradeEffect: (btn) => _artisanRingUpgradeEffect(Number(btn.dataset.i)),
  _artisanAmuletAddStat: (btn) => _artisanAmuletAddStat(Number(btn.dataset.i), btn.dataset.stat),
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
