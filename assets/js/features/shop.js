import { STATE } from '../core/state.js';
import { loadCollection, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { trySave } from '../shared/crud.js';
import { openModal, closeModalDirect, confirmModal, promptModal } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { RARETE_NAMES, _rareteColor, _rareteStars, buildRaretePicker, pickRarete } from '../shared/rarity.js';
import { _esc, _norm, _searchIncludes } from '../shared/html.js';
import { lsJson } from '../shared/local-storage.js';
import { emptyStateHtml } from '../shared/list-renderer.js';
import { calcOr, computeEquipStatsBonus, getItemStatBonus, calcCA, calcPVMax, calcPMMax, calcVitesse, ITEM_STAT_META, statShort as _statShort, getDefaultCharForUser } from '../shared/char-stats.js';
import { useGold } from '../shared/economy.js';
import { loadWeaponFormats } from '../shared/weapon-formats.js';
import { loadDamageTypes } from '../shared/damage-types.js';
import { DAMAGE_RELATIONS } from '../shared/damage-profile.js';
import { shopItemToInvEntry } from '../shared/inventory-utils.js';
import { openUpgradeSettingsAdmin } from '../shared/upgrade-settings.js';
import { openArtisanModal } from './artisan.js';
import {
  openShopExport, switchShopExportTab, selectAllShopExport,
  doShopExport, previewShopImport, doShopImport,
} from './shop-export.js';
import { openWeaponFormatsAdmin } from './characters/data.js';
import { syncEquipmentAfterInventoryMutation, normalizeStatKey as _normalizeStatKey, getWeaponDamageStatKeys as _getDegatsStats, formatWeaponDamageStatsText } from '../shared/equipment-utils.js';
import { autocompleteHTML, initAutocomplete } from '../shared/autocomplete.js';
import { bindScopedActions } from '../shared/scoped-actions.js';
import { getShopCharId, setShopCharId } from '../shared/shop-session.js';
import { characterPortraitContent } from '../shared/portraits.js';
import { loadConditionLibrary } from '../shared/conditions.js';
import Sortable from '../vendor/sortable.esm.js';
import { makeSortable } from '../shared/sortable-helper.js';
import { spellActionCardHtml } from '../shared/spell-action-card.js';
import { getVisibleCharacters } from '../shared/character-state.js';

// ══════════════════════════════════════════════════════════════════════════════
// DÉLÉGATION D'ÉVÉNEMENTS — remplace les onclick/oninput/onchange inline
// Pattern : <button data-sh-action="open" data-id="…">…</button>
// + shHandlers.open = (el) => openItemModal(el.dataset.id)
// ══════════════════════════════════════════════════════════════════════════════
const shHandlers = {};
bindScopedActions('sh', shHandlers);

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATES DE CHAMPS PAR TYPE DE BOUTIQUE
// ══════════════════════════════════════════════════════════════════════════════
const TEMPLATES = {
  arme: {
    label: '⚔️ Arme',
    fields: [
      { id:'format',      label:'Format',        type:'format_select' },
      { id:'sousType',    label:'Type d\'arme',  type:'autocomplete', placeholder:'Épée, Lance, Dague, Arc, Bâton...' },
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
        options:['Légère','Intermédiaire','Lourde'] },
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
const ITEM_STATS = [
  { key:'force',       short:'For', store:'for',  label:'Force' },
  { key:'dexterite',   short:'Dex', store:'dex', label:'Dextérité' },
  { key:'intelligence',short:'Int', store:'in',  label:'Intelligence' },
  { key:'sagesse',     short:'Sag', store:'sa',  label:'Sagesse' },
  { key:'constitution',short:'Con', store:'co',  label:'Constitution' },
  { key:'charisme',    short:'Cha', store:'ch',  label:'Charisme' },
];
// Map clé → entrée ITEM_STATS (restauré : utilisé par _buildTagGroups pour les
// filtres « Stats ». Sa suppression cassait l'accès aux catégories arme/armure/bijou.)
const ITEM_STAT_BY_KEY = Object.fromEntries(ITEM_STATS.map(s => [s.key, s]));
function _parseLegacyStats(item = {}) {
  const out = { for:0, dex:0, in:0, sa:0, co:0, ch:0 };
  ['for','dex','in','sa','co','ch'].forEach(k => {
    const val = parseInt(item?.[k]);
    if (!Number.isNaN(val)) out[k] = val;
  });
  const txt = String(item?.stats || '');
  const aliases = {
    for:['for','force'], dex:['dex','dextérité','dexterite'], in:['in','int','intelligence'],
    sa:['sa','sag','sagesse'], co:['co','con','constitution'], ch:['ch','cha','charisme'],
  };
  Object.entries(aliases).forEach(([store, list]) => {
    if (out[store]) return;
    for (const token of list) {
      const re = new RegExp(`(?:^|[^a-z])${token}\\s*([+-]\\d+)|([+-]\\d+)\\s*${token}(?:[^a-z]|$)`, 'i');
      const m = txt.match(re);
      const picked = m?.[1] || m?.[2];
      if (picked) {
        out[store] = parseInt(picked) || 0;
        break;
      }
    }
  });
  return out;
}

function _formatStatBonuses(item = {}) {
  const parsed = _parseLegacyStats(item);
  return ITEM_STATS
    .map(stat => ({ short: stat.short, val: parseInt(parsed[stat.store]) || 0 }))
    .filter(x => x.val)
    .map(x => `${x.short} ${x.val > 0 ? '+' : ''}${x.val}`);
}

function _legacyStatsTextFromData(data = {}) {
  return _formatStatBonuses(data).join(' · ');
}

function _formatDegatsStatsText(keys) {
  return formatWeaponDamageStatsText(keys, { statLabel: _statShort });
}


function _legacyToucherTextFromData(data = {}) {
  const short = _statShort(data.toucherStat);
  return short ? `+${short}` : '';
}

function _getRareteNum(value) {
  const direct = parseInt(value);
  if (direct > 0) return direct;

  const normalized = _norm(String(value || '').replace(/★/g, '').trim());
  const byName = RARETE_NAMES.findIndex(name => _norm(name) === normalized);
  if (byName > 0) return byName;

  const stars = String(value || '').match(/★/g)?.length || 0;
  return stars > 0 ? stars : 0;
}

function _getItemStatFilterKeys(item = {}) {
  const keys = new Set();
  const parsed = _parseLegacyStats(item);

  ITEM_STATS.forEach(stat => {
    if (parseInt(parsed[stat.store]) || 0) keys.add(stat.key);
  });

  _getDegatsStats(item).forEach(key => keys.add(key));

  const toucherStat = _normalizeStatKey(item.toucherStat || item.toucher || item.statAttaque || '');
  if (toucherStat) keys.add(toucherStat);

  return [...keys];
}


// ══════════════════════════════════════════════════════════════════════════════
// ÉTAT
// ══════════════════════════════════════════════════════════════════════════════
let _cats  = [];
let _items = [];
let _shopSousTypes = [];
function _setShopCharId(id = '') {
  setShopCharId(id);
}
let _weaponFormats = [];
let _view  = 'home';   // 'home' | 'items'
let _activeCat = null;
let _page = 1;
const PAGE_SIZE = 20;

// Filtres actifs (multi-sélection)
let _filterSearch = '';
let _filterTags   = new Set(); // valeurs de tags actifs
let _filterSort   = localStorage.getItem('shop_sort') || 'ordre'; // ordre | nom | prix_asc | prix_desc | rarete
// ── Smart filters (refonte boutique — lot 3) ────────────────────────────────
// Ensemble de chips actives parmi : payable | boost | upgrade | stock | new.
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
  // Si l'Atelier est ouvert (modale), on le rafraîchit ; sinon on re-render la boutique.
  if (document.getElementById('atelier-items-col')) _renderAtelier();
  else renderShop();
}
const SMART_KINDS = ['fav', 'payable', 'boost', 'upgrade', 'stock', 'new'];

// ── Tweaks utilisateur (lot 7) : préférences d'affichage persistées en LS ──
// Layout : 'sidebar' (catégories à gauche) | 'tabs' (catégories en pastilles
// horizontales sous le header) — utile sur petits écrans ou par préférence.
// Densité : 'confort' (défaut) | 'compact' (padding réduit, plus d'items vus).
// Card    : 'horizontal' (défaut) | 'showcase' (vertical, image dominante).
const _TWEAKS_DEFAULTS = { layout: 'sidebar', density: 'confort', card: 'horizontal', columns: 'auto' };
const _TWEAKS_LS_KEY = 'shop_tweaks';
let _shopTweaks = (() => {
  try { return { ..._TWEAKS_DEFAULTS, ...(JSON.parse(localStorage.getItem(_TWEAKS_LS_KEY) || '{}')) }; }
  catch { return { ..._TWEAKS_DEFAULTS }; }
})();
function _shopTweaksApply() {
  const b = document.body;
  if (!b) return;
  b.classList.toggle('shop-layout-tabs',     _shopTweaks.layout  === 'tabs');
  b.classList.toggle('shop-density-compact', _shopTweaks.density === 'compact');
  b.classList.toggle('shop-card-showcase',   _shopTweaks.card    === 'showcase');
  b.classList.toggle('shop-card-list',       _shopTweaks.card    === 'liste');
  ['1', '2', '3', '4', '5'].forEach(n => b.classList.toggle(`shop-cols-${n}`, _shopTweaks.columns === n));
}
function _shopTweaksSave() {
  try { localStorage.setItem(_TWEAKS_LS_KEY, JSON.stringify(_shopTweaks)); } catch {}
  _shopTweaksApply();
}

// ══════════════════════════════════════════════════════════════════════════════
// CHARGEMENT
// ══════════════════════════════════════════════════════════════════════════════
async function loadShopData() {
  [_cats, _items, _weaponFormats] = await Promise.all([
    loadCollection('shopCategories'),
    loadCollection('shop'),
    loadWeaponFormats(),
  ]);
  _cats.sort((a,b) => (a.ordre||0)-(b.ordre||0));
  _items.sort((a,b) => (a.ordre??999)-(b.ordre??999));
  _shopSousTypes = [...new Set(_items.filter(i=>i.sousType).map(i=>i.sousType))].sort();
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function _catGradient(nom) {
  const g = [
    'background:linear-gradient(135deg,#1a1f3a,#2d3561)',
    'background:linear-gradient(135deg,#1a2f1a,#2d5230)',
    'background:linear-gradient(135deg,#2f1a1a,#523030)',
    'background:linear-gradient(135deg,#1a2a2f,#1d4a52)',
    'background:linear-gradient(135deg,#2a1a2f,#4a2052)',
    'background:linear-gradient(135deg,#2f2a1a,#524a20)',
  ];
  return g[(nom||'').charCodeAt(0) % g.length];
}

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
  return _items.filter(i => !hidden.has(i.categorieId));
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
export async function renderShop() {
  await loadShopData();
  // Un joueur ne peut pas rester sur une catégorie devenue masquée.
  if (_view === 'items' && !STATE.isAdmin && _cats.find(c => c.id === _activeCat)?.masquee) {
    _view = 'home'; _activeCat = null;
  }
  const content = document.getElementById('main-content');
  if (!content) return;

  let html = `<div class="sh-page sh-page--v2">`;

  // ── Char-strip riche (avatar + select + or proéminent) ──
  const activeChar = _getActiveShopChar();
  const chars      = _getShopChars();
  const charStripHtml = chars.length ? (() => {
    const col = _shopCharAvatarColor(activeChar);
    const init = (activeChar?.nom || '?')[0].toUpperCase();
    const or = calcOr(activeChar);
    const photo = activeChar?.photo
      ? `<img src="${activeChar.photo}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`
      : init;
    return `
      <div class="sh-char-strip" title="Personnage actif">
        <span class="sh-char-strip-av" style="--av-c:${col}">${photo}</span>
        <select class="sh-char-strip-sel" id="sh-char-sel"
          data-sh-action="setChar" data-sh-on="change" aria-label="Personnage actif">
          ${chars.map(c => `<option value="${c.id}" ${activeChar?.id===c.id?'selected':''}>${_esc(c.nom||'?')}${c.niveau?` · Niv.${c.niveau}`:''}${c.classe?` ${_esc(c.classe)}`:''}</option>`).join('')}
        </select>
        <span class="sh-char-strip-or" title="Solde du personnage">
          <span class="sh-char-strip-or-val">${or}</span>
          <small>or</small>
        </span>
      </div>`;
  })() : '';

  html += `
    <div class="sh-topbar sh-topbar--v2">
      <div class="sh-topbar-title-wrap">
        <div class="sh-topbar-title-row">
          <span class="sh-topbar-icon">🛒</span>
          <div>
            <div class="sh-topbar-title">Boutique</div>
            <div class="sh-topbar-subtitle">Équipements, consommables et merveilles</div>
          </div>
        </div>
      </div>

      <div class="sh-topbar-tools">
        ${charStripHtml}
        <button class="btn btn-arcane btn-sm" data-sh-action="openAtelier" title="Essayer / construire un équipement">🪄 Atelier</button>
        <button class="btn btn-gold btn-sm" data-sh-action="openArtisan" title="Améliorer ton équipement">🔨 Artisan</button>
        <button class="btn btn-outline btn-sm sh-tweaks-btn" data-sh-action="openTweaks" title="Affichage : layout, densité, colonnes">⚙️</button>`;

  if (STATE.isAdmin) {
    html += `
      <span class="sh-topbar-admin">
        <button class="btn btn-outline btn-sm" data-sh-action="openCatModal" title="Créer une catégorie">📁 Catégorie</button>
        <button class="btn btn-outline btn-sm" data-sh-action="openItemModal" title="Créer un article">＋ Article</button>
        <button class="btn btn-outline btn-sm" data-sh-action="openWeaponFmts" title="Gérer les formats d'armes">⚙️ Formats</button>
        <button class="btn btn-outline btn-sm" data-sh-action="openUpgradeStg" title="Tarifs et plafonds des améliorations">⚙️ Améliorations</button>
        <button class="btn btn-outline btn-sm" data-sh-action="openExport" title="Exporter / Importer la boutique">⬆️ Export</button>
      </span>`;
  }

  html += `
      </div>
    </div>

    ${_shopTweaks.layout === 'tabs' ? _renderCatTabsBar() : ''}

    <div class="sh-layout">
      <div class="sh-sidebar-col">
        ${_renderSidebarTop()}
        ${_renderSidebar()}
      </div>

      <div class="sh-main">
        ${_renderNoCharBanner()}
        ${_view === 'home' ? _renderHome() : _renderItemsView()}
      </div>
    </div>
  </div>`;

  content.innerHTML = html;
  _shopTweaksApply();
  _mountSortables();
}

/** Popup Tweaks d'affichage — segmented controls × 3. */
function openTweaksPopup() {
  const seg = (key, options) => `<div class="sh-tw-seg" data-tw-key="${key}">
    ${options.map(o => `<button type="button" class="sh-tw-seg-btn ${_shopTweaks[key]===o.v?'on':''}"
      data-sh-action="setTweak" data-tw-key="${key}" data-tw-val="${o.v}">${o.lbl}</button>`).join('')}
  </div>`;
  openModal('', `
  <div class="sh-admin-modal is-cat">
    <div class="sh-admin-head">
      <div class="sh-admin-head-ico">⚙️</div>
      <div class="sh-admin-head-title">
        <h2>Affichage de la boutique</h2>
        <small>Préférences locales (sauvegardées sur ce navigateur).</small>
      </div>
      <button class="sh-admin-close" data-sh-action="closeModal" title="Fermer">✕</button>
    </div>

    <div class="sh-admin-body">
      <div class="sh-admin-section">
        <div class="sh-admin-section-title">📐 Layout</div>
        ${seg('layout', [
          { v:'sidebar', lbl:'Sidebar' },
          { v:'tabs',    lbl:'Tabs' },
        ])}
        <p class="sh-admin-section-hint" style="margin-top:8px">Catégories à gauche (sidebar) ou en pastilles horizontales (tabs).</p>
      </div>

      <div class="sh-admin-section">
        <div class="sh-admin-section-title">📏 Densité</div>
        ${seg('density', [
          { v:'confort', lbl:'Confort' },
          { v:'compact', lbl:'Compact' },
        ])}
        <p class="sh-admin-section-hint" style="margin-top:8px">Compact : moins d'espacement, plus d'articles à l'écran.</p>
      </div>

      <div class="sh-admin-section">
        <div class="sh-admin-section-title">🎴 Carte article</div>
        ${seg('card', [
          { v:'horizontal', lbl:'Horizontale' },
          { v:'showcase',   lbl:'Vitrine' },
          { v:'liste',      lbl:'Liste' },
        ])}
        <p class="sh-admin-section-hint" style="margin-top:8px">Horizontale : image à gauche · Vitrine : image en haut · Liste : tableau dense facon tableur (ignore « articles par ligne »).</p>
      </div>

      <div class="sh-admin-section">
        <div class="sh-admin-section-title">▦ Articles par ligne</div>
        ${seg('columns', [
          { v:'auto', lbl:'Auto' },
          { v:'1',    lbl:'1' },
          { v:'2',    lbl:'2' },
          { v:'3',    lbl:'3' },
          { v:'4',    lbl:'4' },
          { v:'5',    lbl:'5' },
        ])}
        <p class="sh-admin-section-hint" style="margin-top:8px">Auto conserve le comportement responsive. Un nombre fixe force la grille sur desktop et tablette.</p>
      </div>
    </div>

    <div class="sh-admin-footer">
      <button class="btn btn-outline btn-sm" data-sh-action="resetTweaks">↺ Réinitialiser</button>
      <div class="sh-admin-footer-spacer"></div>
      <button class="btn btn-gold btn-sm" data-sh-action="closeModal">Fermer</button>
    </div>
  </div>
  `);
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

function _renderSidebarTop() {
  // Le sélecteur de personnage est désormais dans la topbar (sh-char-strip).
  // On garde la fonction pour compat mais elle ne rend plus rien.
  return '';
}

/** Layout `tabs` : barre horizontale des catégories sous le header.
 *  Remplace visuellement la sidebar (qui sera cachée en CSS). */
function _renderCatTabsBar() {
  const cats = _visibleCats();
  const totalItems = _visibleItems().length;
  const orphaned = _items.filter(i => !_cats.find(c => c.id === i.categorieId));
  return `<div class="sh-cat-tabs-bar">
    <button class="sh-cat-tab ${_view==='home'?'active':''}" data-sh-action="goHome">
      🏠 <span class="sh-cat-tab-name">Toutes</span>
      <span class="sh-cat-tab-count">${totalItems}</span>
    </button>
    ${cats.map(cat => {
      const count = _items.filter(i => i.categorieId === cat.id).length;
      const active = _view === 'items' && _activeCat === cat.id;
      return `<button class="sh-cat-tab ${active?'active':''}" data-sh-action="goCat" data-id="${cat.id}"
        ${cat.masquee ? 'style="opacity:.6"' : ''}>
        ${cat.emoji || _catEmoji(cat.nom)} <span class="sh-cat-tab-name">${_esc(cat.nom)}</span>
        <span class="sh-cat-tab-count">${count}</span>
      </button>`;
    }).join('')}
    ${orphaned.length ? `<button class="sh-cat-tab ${_view==='items' && _activeCat==='__uncategorized__'?'active':''}"
      data-sh-action="goCat" data-id="__uncategorized__">
      📦 <span class="sh-cat-tab-name">Non classé</span>
      <span class="sh-cat-tab-count">${orphaned.length}</span>
    </button>` : ''}
  </div>`;
}

// ── Hero : Smart filters ───────────────────────────────────────────────────
// Rangée de chips contextuelles (payable / boost / upgrade / stock / new),
// avec compteurs live. S'insère au-dessus de la grille d'articles.
function _renderSmartBar() {
  const base = _visibleItems();
  const SMART_META = [
    { k:'fav',     ico:'⭐', lbl:'Mes favoris',                cls:'fav'     },
    { k:'payable', ico:'💰', lbl:'Je peux me payer',         cls:'payable' },
    { k:'boost',   ico:'⚡', lbl:'Booste ma stat principale', cls:'boost'   },
    { k:'upgrade', ico:'⬆️', lbl:'Mieux que mon équipement',  cls:'upgrade' },
    { k:'stock',   ico:'📦', lbl:'En stock',                   cls:'stock'   },
    { k:'new',     ico:'✨', lbl:'Nouveautés',                 cls:'new'     },
  ];
  const chips = SMART_META.map(m => {
    const on = _smartFilters.has(m.k);
    const n  = _shopSmartCount(m.k, base);
    return `<button class="sh-smart-chip ${m.cls} ${on?'on':''}"
      data-sh-action="toggleSmart" data-smart="${m.k}"
      title="${_esc(m.lbl)}">
      <span class="sh-smart-ico">${m.ico}</span>
      <span class="sh-smart-lbl">${_esc(m.lbl)}</span>
      <span class="sh-smart-count">${n}</span>
    </button>`;
  }).join('');
  return `<div class="sh-smart-bar">
    <span class="sh-smart-bar-lbl">Trouver :</span>
    ${chips}
    ${_smartFilters.size ? `<button class="sh-smart-reset" data-sh-action="resetSmart" title="Retirer tous les filtres rapides">✕ Reset</button>` : ''}
  </div>`;
}

function _renderSidebar() {
  const cats       = _visibleCats();
  const totalItems = _visibleItems().length;
  const orphaned   = _items.filter(i => !_cats.find(c => c.id === i.categorieId));

  return `
    <aside class="sh-sidebar">
      <div class="sh-sidebar-section">
        <button class="sh-side-link ${_view === 'home' ? 'active' : ''}" data-sh-action="goHome">
          <span class="sh-side-link-icon">🏠</span>
          <span class="sh-side-link-text">
            <strong>Toutes les catégories</strong>
            <small>${cats.length} catégorie${cats.length!==1?'s':''} • ${totalItems} article${totalItems!==1?'s':''}</small>
          </span>
        </button>
      </div>

      <div class="sh-sidebar-section">
        <div class="sh-sidebar-label">Catégories</div>
        <div class="sh-side-list">
          ${cats.map(cat => {
            const count = _items.filter(i => i.categorieId === cat.id).length;
            const active = _view === 'items' && _activeCat === cat.id;
            const tpl = TEMPLATES[cat.template || 'classique'];
            // Gradient coloré pour la pastille emoji (style maquette)
            const catBg = _catGradient(cat.nom).replace(/^background:/, '');
            return `
              <button class="sh-side-link ${active ? 'active' : ''}" data-sh-action="goCat" data-id="${cat.id}"${cat.masquee ? ' style="opacity:.6"' : ''}>
                <span class="sh-side-link-icon" style="--cat-bg:${catBg}">${cat.emoji || _catEmoji(cat.nom)}</span>
                <span class="sh-side-link-text">
                  <strong>${cat.nom}${cat.masquee ? ' <span title="Masquée aux joueurs">🙈</span>' : ''}</strong>
                  <small>${tpl?.label || 'Type'} • ${count} article${count > 1 ? 's' : ''}</small>
                </span>
              </button>
            `;
          }).join('')}
          ${orphaned.length > 0 ? `
            <button class="sh-side-link ${_view === 'items' && _activeCat === '__uncategorized__' ? 'active' : ''}"
              data-sh-action="goCat" data-id="__uncategorized__" style="opacity:.8">
              <span class="sh-side-link-icon">📦</span>
              <span class="sh-side-link-text">
                <strong>Non classé</strong>
                <small>${orphaned.length} article${orphaned.length > 1 ? 's' : ''} sans catégorie</small>
              </span>
            </button>
          ` : ''}
        </div>
      </div>
    </aside>
  `;
}

// ══════════════════════════════════════════════════════════════════════════════
// VUE HOME
// ══════════════════════════════════════════════════════════════════════════════
function _renderHome() {
  // Hero search global (full-width) + smart filters chips
  const searchBar = `
    <div class="sh-hero">
      <div class="sh-hero-row">
        <div class="sh-hero-search">
          <span class="sh-hero-search-ico">🔍</span>
          <input type="text" id="sh-home-search" class="sh-hero-search-input"
            placeholder="Rechercher une arme, une potion, un effet…"
            value="${_filterSearch||''}"
            data-sh-action="search" data-sh-on="input"
            autocomplete="off">
          ${_filterSearch ? `<button class="sh-hero-search-clear" data-sh-action="clearSearch" aria-label="Effacer la recherche">✕</button>` : ''}
        </div>
      </div>
      ${_renderSmartBar()}
    </div>
    <div id="sh-home-results">`;

  return searchBar + _renderHomeResults() + `</div>`;
}

function _renderHomeResults() {
  if (_norm(_filterSearch)) return _renderHomeSearchResults();

  const cats     = _visibleCats();
  const orphaned = _items.filter(i => !_cats.find(c => c.id === i.categorieId));

  if (cats.length === 0 && orphaned.length === 0) {
    return `<div class="empty-state"><div class="icon">🛒</div>
      <p>La boutique est vide.</p>
      ${STATE.isAdmin?'<p style="font-size:0.82rem;margin-top:0.5rem;color:var(--text-dim)">Crée une catégorie pour commencer.</p>':''}</div>`;
  }
  let html = `<div class="sh-cat-grid ${STATE.isAdmin?'sh-sortable':''}">`;
  const edit = STATE.isAdmin;
  cats.forEach(cat => {
    const count = _items.filter(i => i.categorieId === cat.id).length;
    const tpl   = TEMPLATES[cat.template||'classique'];
    html += `<div class="sh-cat-card ${edit?'sh-sortable-item':''}" data-cat-id="${cat.id}" data-sh-action="goCat" data-id="${cat.id}"${cat.masquee?' style="opacity:.6"':''}>
      <div class="sh-cat-img" style="${cat.image?`background-image:url('${cat.image}')`:_catGradient(cat.nom)}">
        <div class="sh-cat-img-overlay"></div>
        ${!cat.image?`<div class="sh-cat-img-emoji">${cat.emoji||_catEmoji(cat.nom)}</div>`:''}
        ${tpl?`<span class="sh-cat-tpl-badge">${tpl.label}</span>`:''}
      </div>
      <div class="sh-cat-body">
        <div class="sh-cat-name-row">
          <div class="sh-cat-name">${cat.nom}${cat.masquee?' <span title="Masquée aux joueurs" style="font-size:.85em">🙈</span>':''}</div>
          ${edit?`<div class="sh-card-admin-inline" data-sh-action="stop">
            <button class="btn-icon" title="Modifier la catégorie" aria-label="Modifier la catégorie" data-sh-action="openCatModal" data-id="${cat.id}">✏️</button>
            <button class="btn-icon" title="Supprimer la catégorie" aria-label="Supprimer la catégorie" data-sh-action="deleteCat" data-id="${cat.id}">🗑️</button>
          </div>`:''}
        </div>
        <div class="sh-cat-meta">${count} article${count!==1?'s':''}</div>
      </div>
    </div>`;
  });

  // Carte virtuelle "Non classé" pour les articles sans catégorie valide
  if (orphaned.length > 0) {
    const n = orphaned.length;
    html += `<div class="sh-cat-card" data-sh-action="goCat" data-id="__uncategorized__" style="opacity:.85">
      <div class="sh-cat-img" style="background:linear-gradient(135deg,#2a2a3e,#1a1a2a)">
        <div class="sh-cat-img-overlay"></div>
        <div class="sh-cat-img-emoji">📦</div>
        <span class="sh-cat-tpl-badge" style="background:rgba(255,165,0,.25);color:#ffb347">Non classé</span>
      </div>
      <div class="sh-cat-body">
        <div class="sh-cat-name-row">
          <div class="sh-cat-name">Non classé</div>
        </div>
        <div class="sh-cat-meta">${n} article${n!==1?'s':''} sans catégorie</div>
      </div>
    </div>`;
  }

  html += `</div>`;
  return html;
}

function _renderHomeSearchResults() {
  const search = _norm(_filterSearch);
  let matched = _visibleItems()
    .filter(i => _searchIncludes(_itemSearchText(i), search));
  // Smart filters s'appliquent aussi à la recherche home transverse
  matched = _shopApplySmart(matched);
  matched.sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity:'base' }));

  if (matched.length === 0) {
    return emptyStateHtml('🔍', `Aucun résultat pour « ${_esc(_filterSearch)} ».`);
  }

  const total = matched.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  const p     = Math.max(1, Math.min(_page, pages));
  const slice = matched.slice((p-1)*PAGE_SIZE, p*PAGE_SIZE);

  let html = `<div style="margin-bottom:.75rem;color:var(--text-dim);font-size:.85rem">
    ${total} résultat${total>1?'s':''} dans toutes les catégories
  </div>`;
  html += _renderMixedItemGrid(slice);

  if (pages > 1) {
    html += `<div class="sh-pagination">`;
    if (p>1) html += `<button class="sh-page-btn" data-sh-action="page" data-page="${p-1}">← Précédent</button>`;
    const st=Math.max(1,p-2), en=Math.min(pages,p+2);
    if(st>1) html+=`<button class="sh-page-btn" data-sh-action="page" data-page="1">1</button>${st>2?'<span class="sh-dim-pill">…</span>':''}`;
    for(let i=st;i<=en;i++) html+=`<button class="sh-page-btn ${i===p?'active':''}" data-sh-action="page" data-page="${i}">${i}</button>`;
    if(en<pages) html+=`${en<pages-1?'<span class="sh-dim-pill">…</span>':''}<button class="sh-page-btn" data-sh-action="page" data-page="${pages}">${pages}</button>`;
    if(p<pages) html+=`<button class="sh-page-btn" data-sh-action="page" data-page="${p+1}">Suivant →</button>`;
    html += `</div>`;
  }
  return html;
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
function _renderMixedItemGrid(items) {
  if (_shopTweaks.card === 'liste') return _renderItemList(items);
  return `<div class="sh-item-grid">` +
    items.map((item, i) => _renderItemCard(item, _resolveItemTemplate(item), i)).join('') +
    `</div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// VUE ARTICLES — filtres dynamiques multi-tags + recherche temps réel
// ══════════════════════════════════════════════════════════════════════════════
function _getBaseItems(catId) {
  const items = _visibleItems();
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

function _getFilteredItems(catId) {
  let items = _getBaseItems(catId);

  // 🔎 Recherche
  const search = _norm(_filterSearch);
  if (search) {
    items = items.filter(i => _searchIncludes(_itemSearchText(i), search));
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
  if (_filterSort && _filterSort !== 'ordre') {
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

function _renderItemsView() {
  const isUncategorized = _activeCat === '__uncategorized__';
  const cat = isUncategorized
    ? { id: '__uncategorized__', nom: 'Non classé', emoji: '📦', template: 'classique' }
    : _cats.find(c => c.id === _activeCat);
  if (!cat) return '';
  const tplCat = TEMPLATES[cat.template || 'classique'];

  let items = _getFilteredItems(_activeCat);
  const search = _norm(_filterSearch);

  const total = items.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  const p     = Math.max(1, Math.min(_page, pages));
  const slice = items.slice((p-1)*PAGE_SIZE, p*PAGE_SIZE);
  const allItems  = _getBaseItems(_activeCat);
  const tagGroups = _buildTagGroups(allItems);
  const hasFilters = search || _filterTags.size > 0;

  const totalCat = allItems.length;
  let html = `
  <div class="sh-hero">
    <div class="sh-hero-row">
      <div class="sh-hero-search">
        <span class="sh-hero-search-ico">🔍</span>
        <input type="text" id="sh-search" class="sh-hero-search-input"
          placeholder="Rechercher dans cette catégorie…"
          value="${_filterSearch||''}"
          data-sh-action="search" data-sh-on="input"
          autocomplete="off">
        ${_filterSearch ? `<button class="sh-hero-search-clear" data-sh-action="clearSearch" aria-label="Effacer la recherche">✕</button>` : ''}
      </div>
    </div>
    ${_renderSmartBar()}
  </div>
  <div class="sh-main-head sh-main-head--category">
    <div class="sh-main-head-body">
      <div class="sh-main-head-icon">${cat.emoji || _catEmoji(cat.nom)}</div>
      <div style="min-width:0;flex:1">
        <div class="sh-main-kicker">${tplCat?.label || 'Catégorie'}</div>
        <div class="sh-main-title">${_esc(cat.nom)}</div>
        <div class="sh-main-meta">${totalCat} article${totalCat!==1?'s':''}${hasFilters && total !== totalCat ? ` · ${total} filtré${total!==1?'s':''}` : ''}${cat.masquee ? ' · 🙈 Masquée aux joueurs' : ''}</div>
      </div>
    </div>
  </div>
  <div class="sh-filter-panel">
    <div class="sh-filter-toolbar">
      <select class="input-field sh-sort-select" data-sh-action="setSort" data-sh-on="change" aria-label="Trier par" title="Trier les articles">
        <option value="ordre"      ${_filterSort==='ordre'?'selected':''}>Ordre manuel</option>
        <option value="recommande" ${_filterSort==='recommande'?'selected':''}>⭐ Recommandé pour moi</option>
        <option value="nom"        ${_filterSort==='nom'?'selected':''}>Nom (A→Z)</option>
        <option value="prix_asc"   ${_filterSort==='prix_asc'?'selected':''}>Prix ↑</option>
        <option value="prix_desc"  ${_filterSort==='prix_desc'?'selected':''}>Prix ↓</option>
        <option value="rarete"     ${_filterSort==='rarete'?'selected':''}>Rareté</option>
      </select>
      <div class="sh-filter-actions">
        <span id="sh-count" style="font-size:.78rem;color:var(--text-dim)">${total} article${total!==1?'s':''}</span>
        <button id="sh-clear-btn" data-sh-action="resetFilters"
          style="font-size:.72rem;background:rgba(255,107,107,.08);border:1px solid rgba(255,107,107,.25);
          border-radius:8px;padding:3px 10px;cursor:pointer;color:#ff6b6b;
          display:${hasFilters?'':'none'}">✕ Tout effacer</button>
        ${STATE.isAdmin ? `<button class="btn btn-gold btn-sm" data-sh-action="openItemModal">+ Article</button>` : ''}
      </div>
    </div>
    ${tagGroups.length > 0 ? `
    <div class="sh-filter-groups">
      ${tagGroups.map(group => `
      <div class="sh-filter-group sh-filter-group--${group.key}">
        <span class="sh-filter-label">${group.label}</span>
        <div class="sh-filter-tags">
        ${group.tags.map(tag => {
          const active = _filterTags.has(tag.value);
          const sv = tag.value.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
          return `<button class="sh-filter-chip"
            data-tag-value="${tag.value.replace(/"/g,'&quot;')}"
            data-tag-color="${tag.color}"
            data-sh-action="toggleTag" data-tag="${tag.value.replace(/"/g,'&quot;')}"
            style="border:1px solid ${active ? tag.color : 'var(--border)'};
            background:${active ? tag.color+'22' : 'var(--bg-elevated)'};
            color:${active ? tag.color : 'var(--text-dim)'};
            transition:all .15s;font-weight:${active?'600':'400'}">${tag.label}</button>`;
        }).join('')}
        </div>
      </div>`).join('')}
    </div>` : ''}
  </div>
  <div id="sh-items-results">`;

  if (slice.length === 0) {
    html += `<div class="empty-state"><div class="icon">📦</div>
      <p>${hasFilters ? 'Aucun résultat pour ces filtres.' : 'Aucun article dans cette catégorie.'}</p>
      ${!hasFilters && STATE.isAdmin ? `<button class="btn btn-gold btn-sm" style="margin-top:.75rem" data-sh-action="openItemModal">+ Ajouter</button>` : ''}</div>`;
  } else {
    html += _renderItemGrid(cat, slice);
  }

  if (pages > 1) {
    html += `<div class="sh-pagination">`;
    if (p>1) html += `<button class="sh-page-btn" data-sh-action="page" data-page="${p-1}">← Précédent</button>`;
    const start=Math.max(1,p-2), end=Math.min(pages,p+2);
    if(start>1) html+=`<button class="sh-page-btn" data-sh-action="page" data-page="1">1</button>${start>2?'<span class="sh-dim-pill">…</span>':''}`;
    for(let i=start;i<=end;i++) html+=`<button class="sh-page-btn ${i===p?'active':''}" data-sh-action="page" data-page="${i}">${i}</button>`;
    if(end<pages) html+=`${end<pages-1?'<span class="sh-dim-pill">…</span>':''}<button class="sh-page-btn" data-sh-action="page" data-page="${pages}">${pages}</button>`;
    if(p<pages) html+=`<button class="sh-page-btn" data-sh-action="page" data-page="${p+1}">Suivant →</button>`;
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

function _getItemTags(item) {
  const tags = new Set();

  if (item.format)     tags.add(`format:${item.format}`);
  if (item.sousType)   tags.add(`sousType:${item.sousType}`);
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
  // Ordre forcé pour certains groupes (sinon alpha). Type armure : du plus lourd au plus léger.
  const TYPE_ARMURE_ORDER = ['Lourde', 'Intermédiaire', 'Légère'];
  const orderBy = (arr, ref) => [...new Set(arr)].sort((a, b) => {
    const ia = ref.indexOf(a), ib = ref.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b, 'fr');
  });
  const mk = (label, key, values, color) =>
    values.length ? { label, key, tags: values.map(v => ({ value: `${key}:${v}`, label: v, color })) } : null;

  const groups = [
    mk('Format',      'format',     uniq(items.filter(i => i.format).map(i => i.format)), '#e8b84b'),
    mk('Type arme',   'sousType',   uniq(items.filter(i => i.sousType).map(i => i.sousType)), '#e8b84b'),
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
  const active = [..._smartFilters];
  return items.filter(it => active.every(k => _shopItemMatchesSmart(it, k, ctx)));
}

function _shopSmartCount(kind, baseItems) {
  const ctx = _shopSmartCtx();
  return baseItems.filter(it => _shopItemMatchesSmart(it, kind, ctx)).length;
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
// CARDS ARTICLES
// ══════════════════════════════════════════════════════════════════════════════
function _renderItemGrid(cat, items) {
  if (_shopTweaks.card === 'liste') return _renderItemList(items);
  // Chaque item utilise SON template (item.template), pas celui de la catégorie.
  return `<div class="sh-item-grid ${STATE.isAdmin?'sh-sortable':''}" id="sh-items-grid">` +
    items.map((item,i) => _renderItemCard(item, _resolveItemTemplate(item), i)).join('') +
    `</div>`;
}

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

function _getItemTypeLabel(item, tplKey) {
  if (tplKey === 'arme') return item.sousType || 'Arme';
  if (tplKey === 'armure') {
    const parts = [item.slotArmure, item.typeArmure].filter(Boolean);
    return parts.join(' · ') || 'Armure';
  }
  if (tplKey === 'bijou') return item.slotBijou || 'Bijou';
  return item.type || 'Objet';
}

function _getItemFormatLabel(item, tplKey, cat) {
  if (tplKey === 'arme') return item.format || cat?.nom || 'Arme';
  if (tplKey === 'armure') return cat?.nom || 'Armure';
  if (tplKey === 'bijou') return cat?.nom || 'Bijou';
  return cat?.nom || 'Objet';
}

function _renderFactRow(label, value) {
  if (!value) return '';
  return `
    <div class="sh-item-fact">
      <span class="sh-item-fact-label">${_esc(label)}</span>
      <span class="sh-item-fact-value">${_esc(value)}</span>
    </div>
  `;
}

function _renderFactRowColored(label, value, color) {
  if (!value) return '';
  return `
    <div class="sh-item-fact">
      <span class="sh-item-fact-label">${_esc(label)}</span>
      <span class="sh-item-fact-value" style="color:${color}">${_esc(value)}</span>
    </div>
  `;
}

// Bouton « Acheter » (et ses états) — partagé carte ↔ liste.
function _buyBtnHtml(item, hasChar, epuise, tropCher, manque) {
  if (!hasChar) return `<button class="btn sh-buy-btn sh-buy-btn--disabled" disabled title="Sélectionne un personnage">Choisir un personnage</button>`;
  if (epuise)   return `<button class="btn sh-buy-btn sh-buy-btn--disabled" disabled title="Cet article est épuisé">Épuisé</button>`;
  if (tropCher) return `<button class="btn sh-buy-btn sh-buy-btn--poor" disabled title="Il te manque ${manque} or">Pas assez d'or</button>`;
  return `<button class="btn sh-buy-btn" data-sh-action="buyItem" data-id="${item.id}">🛒 Acheter</button>`;
}

function _renderItemCard(item, tplKey, itemIdx) {
  const prix = parseFloat(item.prix) || 0;
  const prixVente = Math.round(prix * PRIX_VENTE_RATIO);
  const _dispoRaw = item.dispo !== undefined && item.dispo !== '' ? parseInt(item.dispo) : null;
  const dispo = (_dispoRaw != null && _dispoRaw < 0) ? null : _dispoRaw; // <0 = illimité → null
  const epuise = dispo !== null && dispo === 0;

  const cat = _cats.find(c => c.id === item.categorieId);
  const edit = STATE.isAdmin;

  const rareteNum = _getRareteNum(item.rarete);
  const rareteStarsHtml = rareteNum ? _rareteStars(rareteNum) : '';
  const rareteName = rareteNum ? (RARETE_NAMES[rareteNum] || '') : '';
  const rareteColor = rareteNum > 0 ? _rareteColor(RARETE_NAMES[rareteNum]) : '';

  const activeChar = _getActiveShopChar();
  const hasChar = !!activeChar;
  const solde = calcOr(activeChar);
  const tropCher = hasChar && prix > solde;
  const manque = tropCher ? Math.ceil(prix - solde) : 0;

  const statBonuses = _getStatBonusEntries(item);
  // ── Deltas vs équipement actuel sur le slot équivalent ─────────────────
  // Affiché uniquement si un perso est actif ET qu'un slot a été résolu.
  let deltaHtml = '';
  if (hasChar) {
    const slot = _resolveSlotForItem(item);
    if (slot) {
      const cur = (activeChar.equipement || {})[slot] || null;
      const diffs = [];
      ITEM_STAT_META.forEach(m => {
        let cb = 0, nb = 0;
        try { cb = cur ? getItemStatBonus(cur, m.full) : 0; } catch {}
        try { nb = getItemStatBonus(item, m.full); } catch {}
        const d = nb - cb;
        if (d !== 0) diffs.push(`<span class="sh-delta ${d>0?'pos':'neg'}">${m.short} ${d>0?'+':''}${d}</span>`);
      });
      const curCa  = (parseInt(cur?.ca) || 0) + (parseInt(cur?.caBonus) || 0);
      const itemCa = (parseInt(item.ca) || 0) + (parseInt(item.caBonus) || 0);
      if (itemCa || curCa) {
        const d = itemCa - curCa;
        if (d !== 0) diffs.push(`<span class="sh-delta ${d>0?'pos':'neg'}">CA ${d>0?'+':''}${d}</span>`);
      }
      if (diffs.length) {
        // Format compact « INT ↑1 · CA ↓2 » sur une seule ligne
        const compact = diffs.map(d => d.replace(/sh-delta pos">(\w+) \+(\d+)/, 'sh-delta pos">$1 ↑$2').replace(/sh-delta neg">(\w+) -(\d+)/, 'sh-delta neg">$1 ↓$2')).join('');
        deltaHtml = `<div class="sh-item-deltas" title="Comparé à ton équipement actuel sur le slot ${_esc(slot)}">
          <span class="sh-item-deltas-lbl">vs équipé</span>
          ${compact}
        </div>`;
      }
    }
  }
  const traits = _getItemTraits(item);
  const traitsPreview = traits.slice(0, 2);
  const hiddenTraitsCount = Math.max(0, traits.length - traitsPreview.length);

  const typeLabel = _getItemTypeLabel(item, tplKey);
  const formatLabel = _getItemFormatLabel(item, tplKey, cat);

  const factRows = [];

  if (tplKey === 'arme') {
    const degatsStatsArr = _getDegatsStats(item);
    const degatsTxt = item.degats
      ? `${item.degats}${degatsStatsArr.length ? ` + ${_formatDegatsStatsText(degatsStatsArr)}` : ''}`
      : '';
    const toucherTxt = item.toucherStat ? _statShort(item.toucherStat) : '';
    const toucherColor = item.toucherStat ? _statVisual(item.toucherStat).color : 'var(--text)';
    // « Type » d'arme déjà visible dans le sous-titre (format · sousType)
    factRows.push(_renderFactRow('Dégâts', degatsTxt));
    factRows.push(_renderFactRowColored('Toucher', toucherTxt, toucherColor));
    factRows.push(_renderFactRow('Portée', item.portee || ''));
  }

  if (tplKey === 'armure') {
    // « Emplacement » et « Type » déjà visibles dans le sous-titre, on ne garde
    // que la CA (info utile non dupliquée).
    factRows.push(_renderFactRow('CA', item.ca ? `+${parseInt(item.ca) || 0}` : ''));
  }

  if (tplKey === 'bijou') {
    // « Slot bijou » déjà visible dans le sous-titre — pas de fact row redondante.
  }

  // Note : pour classique/libre, la description est rendue dans son
  // propre bloc `.sh-item-desc` plus bas (pas dans factRows) pour avoir
  // un styling discret (italique léger, pas en gras) qui prend moins
  // de place visuelle sur la carte.

  const buyBtnHtml = _buyBtnHtml(item, hasChar, epuise, tropCher, manque);

  // ── Données enrichies style maquette ─────────────────────────────────
  // Sous-titre type : Format · Type d'arme · Slot armure/bijou
  const typeChips = [];
  if (item.format)     typeChips.push(item.format);
  if (item.sousType)   typeChips.push(item.sousType);
  if (item.slotArmure) typeChips.push(item.slotArmure);
  if (item.typeArmure) typeChips.push(item.typeArmure);
  if (item.slotBijou)  typeChips.push(item.slotBijou);
  if (item.type && !typeChips.length) typeChips.push(item.type);
  const typeLine = typeChips.length
    ? typeChips.map(_esc).join(' <span class="sh-item-type-sep">·</span> ')
    : _esc(cat?.nom || '');

  // Stock badge sur l'image
  const stockTxt = dispo == null ? '∞ Illimité' : dispo === 0 ? 'Épuisé' : `${dispo} dispo`;
  const stockCls = dispo === 0 ? 'empty' : (dispo != null && dispo < 3) ? 'limited' : '';

  // « Déjà possédé » : check si le perso actif a cet article dans son inventaire
  // (match par itemId quand disponible — précis pour les items boutique).
  const ownedCount = hasChar && Array.isArray(activeChar.inventaire)
    ? activeChar.inventaire.filter(inv => inv?.itemId && inv.itemId === item.id).length
    : 0;
  const ownedBadge = ownedCount > 0
    ? `<span class="sh-item-owned-badge" title="Tu possèdes déjà ×${ownedCount} de cet article">✓ ${ownedCount > 1 ? '×'+ownedCount : 'Possédé'}</span>`
    : '';

  // Image gradient depuis la couleur de la catégorie (sinon fallback hash)
  const imgBg = item.image
    ? `background-image:url('${item.image}');background-size:cover;background-position:center`
    : (cat?.couleur
        ? `background:linear-gradient(135deg, ${cat.couleur}33, ${cat.couleur}11)`
        : _catGradient(item.nom || ''));

  return `
    <article class="sh-item-card sh-item-card--detailed ${epuise ? 'sh-item-epuise' : ''} ${edit ? 'sh-sortable-item' : ''}"
      data-item-id="${item.id}"
      ${rareteColor ? `style="--item-accent:${rareteColor}"` : ''}
    >
      <div class="sh-item-img" style="${imgBg}">
        <div class="sh-item-img-overlay"></div>
        ${rareteNum ? `<span class="sh-item-img-rarity" title="${_esc(rareteName)}">${'★'.repeat(rareteNum)}</span>` : ''}
        <span class="sh-item-img-stock ${stockCls}">${_esc(stockTxt)}</span>
        ${ownedBadge}
        <button class="sh-item-fav ${_isFav(item.id)?'is-fav':''}" data-sh-action="toggleFav" data-id="${item.id}"
          title="${_isFav(item.id)?'Retirer des favoris':'Ajouter aux favoris'}" aria-label="Favori">${_isFav(item.id)?'★':'☆'}</button>
      </div>

      <div class="sh-item-body" data-sh-action="openDetail" data-id="${item.id}">
        <div class="sh-item-row1">
          <div class="sh-item-name-wrap">
            <span class="sh-item-name">${_esc(item.nom || '?')}</span>
            <span class="sh-item-type">${typeLine}</span>
          </div>
          ${rareteNum ? `<span class="sh-item-rare-pill" style="color:${rareteColor};border-color:${rareteColor};background:${rareteColor}1a">${_esc(rareteName)}</span>` : ''}
        </div>

        ${factRows.filter(Boolean).length ? `
          <div class="sh-item-facts">
            ${factRows.join('')}
          </div>
        ` : ''}

        ${statBonuses.length ? `
          <div class="sh-item-bonus-row">
            ${statBonuses.map(stat => `
              <span class="sh-item-bonus-chip"
                style="border-color:${stat.color}55;background:${stat.color}18;color:${stat.color}">
                ${_esc(`${stat.short} ${stat.val > 0 ? '+' : ''}${stat.val}`)}
              </span>
            `).join('')}
          </div>
        ` : ''}

        ${traitsPreview.length ? `
          <ul class="sh-item-traits-list sh-item-traits-list--compact">
            ${traitsPreview.map(t => `<li class="sh-item-trait-line">${_esc(t)}</li>`).join('')}
            ${hiddenTraitsCount ? `<li class="sh-item-traits-more">+${hiddenTraitsCount}</li>` : ''}
          </ul>
        ` : ''}

        ${(tplKey === 'classique' || tplKey === 'libre') && (item.effet || item.description)
          ? `<div class="sh-item-desc">${_esc(item.effet || item.description || '')}</div>`
          : ''}

        ${deltaHtml}

        <div class="sh-item-footer">
          <div class="sh-item-pricing">
            <div class="sh-item-price-main">🪙 ${prix} or</div>
            <div class="sh-item-price-sub">Revente ${prixVente} or</div>
            ${tropCher && !epuise ? `<div class="sh-item-missing-line">Il te manque ${manque} or</div>` : ''}
          </div>

          <div class="sh-item-actions-inline" data-sh-action="stop">
            ${hasChar ? `<button class="sh-try-cta" data-sh-action="openAtelier" data-id="${item.id}" title="Essayer dans l'Atelier" aria-label="Essayer dans l'Atelier">🪄 Essayer</button>` : ''}
            ${buyBtnHtml}
          </div>
        </div>
      </div>

      ${edit ? `
        <div class="sh-item-actions" data-sh-action="stop">
          ${epuise ? `<button class="btn-icon sh-restock-btn" title="Restocker +1 (MJ)" aria-label="Restocker"
            data-sh-action="restockItem" data-id="${item.id}">📦</button>` : ''}
          <button class="btn-icon" title="Modifier l'article" aria-label="Modifier l'article" data-sh-action="openItemModal" data-id="${item.id}">✏️</button>
          <button class="btn-icon" title="Supprimer l'article" aria-label="Supprimer l'article" data-sh-action="deleteItem" data-id="${item.id}">🗑️</button>
        </div>
      ` : ''}
    </article>
  `;
}

// ══════════════════════════════════════════════════════════════════════════════
// VUE LISTE — affichage « tableur » : 1 ligne par article, colonnes alignées.
// Activée par le tweak card='liste'. Réutilise les mêmes helpers que la carte.
// Le header est HORS du conteneur sortable (#sh-items-grid) pour ne pas
// décaler les index de drag.
// ══════════════════════════════════════════════════════════════════════════════
function _renderItemList(items) {
  const edit = STATE.isAdmin;
  const head = `<div class="sh-list-head" aria-hidden="true">
    <span></span><span></span>
    <span>Article</span>
    <span>Détails</span>
    <span>Rareté</span>
    <span>Dispo</span>
    <span>Prix</span>
    <span class="sh-lh-actions">Actions</span>
  </div>`;
  return `<div class="sh-list-wrap">
    ${head}
    <div class="sh-item-list ${edit ? 'sh-sortable' : ''}" id="sh-items-grid">
      ${items.map((item, i) => _renderItemRow(item, _resolveItemTemplate(item), i)).join('')}
    </div>
  </div>`;
}

function _renderItemRow(item, tplKey, itemIdx) {
  const prix = parseFloat(item.prix) || 0;
  const prixVente = Math.round(prix * PRIX_VENTE_RATIO);
  const _dispoRaw = item.dispo !== undefined && item.dispo !== '' ? parseInt(item.dispo) : null;
  const dispo = (_dispoRaw != null && _dispoRaw < 0) ? null : _dispoRaw;
  const epuise = dispo !== null && dispo === 0;

  const cat  = _cats.find(c => c.id === item.categorieId);
  const edit = STATE.isAdmin;

  const rareteNum   = _getRareteNum(item.rarete);
  const rareteName  = rareteNum ? (RARETE_NAMES[rareteNum] || '') : '';
  const rareteColor = rareteNum > 0 ? _rareteColor(RARETE_NAMES[rareteNum]) : '';

  const activeChar = _getActiveShopChar();
  const hasChar    = !!activeChar;
  const solde      = calcOr(activeChar);
  const tropCher   = hasChar && prix > solde;
  const manque     = tropCher ? Math.ceil(prix - solde) : 0;
  const buyBtnHtml = _buyBtnHtml(item, hasChar, epuise, tropCher, manque);

  // Sous-titre type (format · sousType · slot…)
  const typeChips = [];
  if (item.format)     typeChips.push(item.format);
  if (item.sousType)   typeChips.push(item.sousType);
  if (item.slotArmure) typeChips.push(item.slotArmure);
  if (item.typeArmure) typeChips.push(item.typeArmure);
  if (item.slotBijou)  typeChips.push(item.slotBijou);
  if (item.type && !typeChips.length) typeChips.push(item.type);
  const typeLine = typeChips.length
    ? typeChips.map(_esc).join(' · ')
    : _esc(cat?.nom || '');

  // Colonne « Détails » : dégâts / CA + bonus de stats + effet (classique/libre)
  const infoBits = [];
  if (tplKey === 'arme' && item.degats) {
    const dStats = _getDegatsStats(item);
    infoBits.push(`<span class="sh-lr-key">⚔ ${_esc(item.degats)}${dStats.length ? ` +${_esc(_formatDegatsStatsText(dStats))}` : ''}</span>`);
  }
  if (tplKey === 'armure' && item.ca) infoBits.push(`<span class="sh-lr-key">🛡 +${parseInt(item.ca) || 0}</span>`);
  _getStatBonusEntries(item).slice(0, 4).forEach(s =>
    infoBits.push(`<span class="sh-item-bonus-chip" style="border-color:${s.color}55;background:${s.color}18;color:${s.color}">${s.short} ${s.val > 0 ? '+' : ''}${s.val}</span>`));
  if ((tplKey === 'classique' || tplKey === 'libre') && (item.effet || item.description))
    infoBits.push(`<span class="sh-lr-desc">${_esc(item.effet || item.description || '')}</span>`);

  const stockTxt = dispo == null ? '∞' : dispo === 0 ? 'Épuisé' : `${dispo}`;
  const stockCls = dispo === 0 ? 'empty' : (dispo != null && dispo < 3) ? 'limited' : '';

  const imgBg = item.image
    ? `background-image:url('${item.image}');background-size:cover;background-position:center`
    : (cat?.couleur
        ? `background:linear-gradient(135deg, ${cat.couleur}33, ${cat.couleur}11)`
        : _catGradient(item.nom || ''));

  return `
    <div class="sh-list-row ${epuise ? 'sh-item-epuise' : ''} ${edit ? 'sh-sortable-item' : ''}"
      data-item-id="${item.id}" data-sh-action="openDetail" data-id="${item.id}"
      ${rareteColor ? `style="--item-accent:${rareteColor}"` : ''}>
      <button class="sh-list-fav ${_isFav(item.id) ? 'is-fav' : ''}" data-sh-action="toggleFav" data-id="${item.id}"
        title="${_isFav(item.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}" aria-label="Favori">${_isFav(item.id) ? '★' : '☆'}</button>
      <span class="sh-list-thumb" style="${imgBg}">${item.image ? '' : (cat?.emoji || _catEmoji(cat?.nom || item.type || ''))}</span>
      <div class="sh-list-name">
        <span class="sh-list-name-txt">${_esc(item.nom || '?')}</span>
        <span class="sh-list-type">${typeLine}</span>
      </div>
      <div class="sh-list-info">${infoBits.join('')}</div>
      <div class="sh-list-rare">${rareteNum
        ? `<span class="sh-item-rare-pill" style="color:${rareteColor};border-color:${rareteColor};background:${rareteColor}1a">${_esc(rareteName)}</span>`
        : '<span class="sh-list-dash">—</span>'}</div>
      <div class="sh-list-dispo"><span class="sh-list-stock ${stockCls}">${_esc(stockTxt)}</span></div>
      <div class="sh-list-price">
        <span class="sh-list-price-main">🪙 ${prix}</span>
        <span class="sh-list-price-sub">rev. ${prixVente}</span>
      </div>
      <div class="sh-list-actions" data-sh-action="stop">
        ${hasChar ? `<button class="sh-try-cta sh-try-cta--icon" data-sh-action="openAtelier" data-id="${item.id}" title="Essayer dans l'Atelier" aria-label="Essayer dans l'Atelier">🪄</button>` : ''}
        ${buyBtnHtml}
        ${edit ? `
          <button class="btn-icon" title="Modifier l'article" aria-label="Modifier l'article" data-sh-action="openItemModal" data-id="${item.id}">✏️</button>
          <button class="btn-icon" title="Supprimer l'article" aria-label="Supprimer l'article" data-sh-action="deleteItem" data-id="${item.id}">🗑️</button>
        ` : ''}
      </div>
    </div>`;
}

// ── Comparaison d'équipement (boutique → fiche perso) ─────────────────────────
// Résout le slot d'équipement ciblé par un item boutique.
// Armes → 'Main principale' par défaut. Armures/bijoux → leur slot dédié.
function _resolveSlotForItem(item) {
  if (item.degats || item.toucherStat || item.degatsStat) return 'Main principale';
  if (item.slotArmure) {
    return item.slotArmure === 'Pieds' ? 'Bottes' : item.slotArmure;
  }
  if (item.slotBijou) return item.slotBijou;
  return null;
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
    return { ...base, degats: shopItem.degats || '', sousType: shopItem.sousType || '', toucherStat: shopItem.toucherStat || '' };
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
  const prix   = parseFloat(item.prix) || 0;
  const prixV  = Math.round(prix * PRIX_VENTE_RATIO);
  const dispo  = item.dispo !== undefined && item.dispo !== '' ? parseInt(item.dispo) : null;
  const epuise = dispo !== null && dispo === 0;
  const traitsArr = Array.isArray(item.traits) ? item.traits
    : (item.trait ? item.trait.split(',').map(t=>t.trim()).filter(Boolean) : []);
  const statBonuses = _formatStatBonuses(item);
  const activeChar = _getActiveShopChar();
  const hasChar = !!activeChar;
  const solde = calcOr(activeChar);
  const tropCher = hasChar && prix > solde;
  const manque = tropCher ? Math.ceil(prix - solde) : 0;

  const rows = [];
  if (item.format)      rows.push(['Format', item.format]);
  if (item.sousType)    rows.push(['Type', item.sousType]);
  if (item.degats) {
    const arr = _getDegatsStats(item);
    rows.push(['Dégâts', `${item.degats}${arr.length ? ' + ' + _formatDegatsStatsText(arr) : ''}`]);
  }
  if (item.toucherStat) rows.push(['Toucher', _statShort(item.toucherStat)]);
  if (item.portee)      rows.push(['Portée', item.portee]);
  if (item.slotArmure)  rows.push(['Emplacement', item.slotArmure]);
  if (item.typeArmure)  rows.push(['Type armure', item.typeArmure]);
  if (item.ca > 0)      rows.push(['CA bonus', `+${item.ca}`]);
  if (item.slotBijou)   rows.push(['Emplacement', item.slotBijou]);
  if (item.type)        rows.push(['Type', item.type]);
  if (item.effet)       rows.push(['Effet', item.effet]);
  if (statBonuses.length) rows.push(['Bonus stats', statBonuses.join(', ')]);

  const compareSlot   = hasChar ? _resolveSlotForItem(item) : null;
  const comparePanel  = compareSlot ? _renderComparePanel(activeChar, item, compareSlot) : '';
  const equippedHere  = compareSlot ? (activeChar.equipement || {})[compareSlot] : null;
  const sellPrice     = equippedHere && Number.isInteger(equippedHere.sourceInvIndex)
    ? (parseFloat(activeChar.inventaire?.[equippedHere.sourceInvIndex]?.prixVente) || 0)
    : 0;
  const canSellCurrent = !!equippedHere && Number.isInteger(equippedHere.sourceInvIndex) && equippedHere.sourceInvIndex >= 0;
  const equippedItemName = equippedHere?.nom || activeChar.inventaire?.[equippedHere?.sourceInvIndex]?.nom || '';

  const rareNum = _getRareteNum(item.rarete);
  const rareCol = rareNum > 0 ? _rareteColor(RARETE_NAMES[rareNum]) : '';
  const rareName = rareNum > 0 ? (RARETE_NAMES[rareNum] || '') : '';
  const tplKey = _resolveItemTemplate(item);
  const tplLabel = TEMPLATES[tplKey]?.label || '';

  // Sous-titre type (format · sousType · slot…)
  const typeChips = [];
  if (item.format)     typeChips.push(item.format);
  if (item.sousType)   typeChips.push(item.sousType);
  if (item.slotArmure) typeChips.push(item.slotArmure);
  if (item.typeArmure) typeChips.push(item.typeArmure);
  if (item.slotBijou)  typeChips.push(item.slotBijou);
  if (item.type && !typeChips.length) typeChips.push(item.type);
  const typeLine = typeChips.length ? typeChips.map(_esc).join(' · ') : _esc(cat?.nom || '');

  // Facts (kv)
  const facts = [];
  if (item.degats) {
    const arr = _getDegatsStats(item);
    facts.push(['Dégâts', `${item.degats}${arr.length ? ' + ' + _formatDegatsStatsText(arr) : ''}`, 'dmg']);
  }
  if (item.toucherStat) facts.push(['Toucher', _statShort(item.toucherStat)]);
  if (item.portee)      facts.push(['Portée', item.portee]);
  if (item.ca > 0)      facts.push(['CA', `+${item.ca}`, 'ca']);

  // Bonus chips
  const bonusEntries = _getStatBonusEntries(item);
  const descTxt = item.effet || item.description || '';

  // Background image
  const imgBg = item.image
    ? `background-image:url('${item.image}');background-size:cover;background-position:center`
    : (cat?.couleur
        ? `background:linear-gradient(135deg, ${cat.couleur}33, ${cat.couleur}11)`
        : _catGradient(item.nom || ''));

  // Footer buttons
  let actionBtn;
  if (!hasChar) {
    actionBtn = `<button class="btn btn-outline btn-sm" disabled title="Sélectionne un personnage">Choisis un personnage</button>`;
  } else if (epuise) {
    actionBtn = `<button class="btn btn-outline btn-sm" disabled title="Cet article est épuisé">Épuisé</button>`;
  } else if (tropCher) {
    actionBtn = `<button class="btn btn-outline btn-sm sh-buy-btn--poor" disabled title="Il te manque ${manque} or">Pas assez d'or</button>`;
  } else {
    actionBtn = `<button class="btn btn-gold btn-sm" data-sh-action="buyFromDetail" data-id="${item.id}">🛒 Acheter pour ${prix} or</button>`;
  }

  openModal('', `
  <div class="sh-detail">
    <!-- HERO image avec étoiles + stock -->
    <div class="sh-detail-hero" style="${imgBg}">
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
          <div class="sh-detail-price-main">🪙 ${prix} or</div>
          <div class="sh-detail-price-sub">Revente ${prixV} or</div>
          ${tropCher && !epuise ? `<div class="sh-detail-price-warn">Il te manque ${manque} or</div>` : ''}
        </div>
      </div>

      ${facts.length ? `<div class="sh-detail-facts">
        ${facts.map(([l,v,c])=>`<div class="sh-detail-fact ${c||''}">
          <span class="sh-detail-fact-lbl">${_esc(l)}</span>
          <span class="sh-detail-fact-val">${_esc(v)}</span>
        </div>`).join('')}
      </div>` : ''}

      ${bonusEntries.length ? `<div class="sh-detail-bonus">
        ${bonusEntries.map(b=>`<span class="sh-item-bonus-chip" style="border-color:${b.color}55;background:${b.color}18;color:${b.color}">${b.short} ${b.val>0?'+':''}${b.val}</span>`).join('')}
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
          💰 Vendre équipé${sellPrice ? ` (+${sellPrice} or)` : ''}
        </button>` : ''}
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

    const libelle = qty > 1 ? `Achat ×${qty} : ${item.nom}` : `Achat : ${item.nom}`;
    const res = await useGold(charId, -total, libelle, {
      charObj: c,
      extraPayload: { inventaire: inv },
    });
    if (!res.ok) { showNotif(res.error || 'Erreur achat', 'error'); return; }

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

export async function restockShopItem(itemId) {
  const shopItem = _items.find(i => i.id === itemId);
  if (!shopItem) return;
  const cur = shopItem.dispo !== undefined && shopItem.dispo !== '' ? parseInt(shopItem.dispo) : null;
  if (cur !== null && cur >= 0) {
    await updateInCol('shop', itemId, { dispo: cur + 1 });
    shopItem.dispo = cur + 1;
  }
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
    const extraPayload = { inventaire: inv };
    if (equipSync.changed) {
      extraPayload.equipement = equipSync.equipement;
      extraPayload.statsBonus = equipSync.statsBonus;
    }

    const res = await useGold(charId, +prixVente, `Vente : ${itemNom}`, {
      charObj: c,
      extraPayload,
    });
    if (!res.ok) { showNotif(res.error || 'Erreur vente', 'error'); return; }

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
function shopPage(p)      { _page=p; renderShop(); }

// ── Fonctions de filtre ───────────────────────────────────────────────────────
function shopSetSort(val) {
  _filterSort = val;
  localStorage.setItem('shop_sort', val);
  _page = 1;
  if (_view === 'items') _updateItemsOnly();
  else renderShop();
}

export function shopFilterSearch(val) {
  _filterSearch = val;
  _page = 1;
  if (_view === 'items') _updateItemsOnly();
  else _updateHomeOnly();
}

function shopToggleTag(val) {
  if (_filterTags.has(val)) _filterTags.delete(val);
  else _filterTags.add(val);
  _page = 1;
  if (_view === 'items') _updateItemsOnly();
  else renderShop();
}

function shopFilterReset() {
  _filterSearch = '';
  _filterTags.clear();
  _page = 1;
  const inp = document.getElementById('sh-search');
  if (inp) inp.value = '';
  if (_view === 'items') _updateItemsOnly();
  else renderShop();
}

// ── Mise à jour partielle : grille + compteur + tags, sans toucher le champ texte ──
function _updateItemsOnly() {
  const isUncategorized = _activeCat === '__uncategorized__';
  const cat = isUncategorized
    ? { id: '__uncategorized__', nom: 'Non classé', template: 'classique' }
    : _cats.find(c => c.id === _activeCat);
  if (!cat) { renderShop(); return; }

  let items = _getFilteredItems(_activeCat);
  const search = _norm(_filterSearch);

  const total  = items.length;
  const pages  = Math.ceil(total / PAGE_SIZE);
  const p      = Math.max(1, Math.min(_page, pages));
  const slice  = items.slice((p-1)*PAGE_SIZE, p*PAGE_SIZE);
  const hasF   = search || _filterTags.size > 0;

  const counter = document.getElementById('sh-count');
  if (counter) counter.textContent = `${total} article${total!==1?'s':''}`;

  const clearBtn = document.getElementById('sh-clear-btn');
  if (clearBtn) clearBtn.style.display = hasF ? '' : 'none';

  document.querySelectorAll('[data-tag-value]').forEach(btn => {
    const v     = btn.dataset.tagValue;
    const color = btn.dataset.tagColor || 'var(--text-dim)';
    const active = _filterTags.has(v);
    btn.style.borderColor = active ? color : 'var(--border)';
    btn.style.background  = active ? color+'22' : 'var(--bg-elevated)';
    btn.style.color       = active ? color : 'var(--text-dim)';
    btn.style.fontWeight  = active ? '600' : '400';
  });

  const grid = document.getElementById('sh-items-results');
  if (!grid) { renderShop(); return; }

  let html = '';
  if (slice.length === 0) {
    html = `<div class="empty-state"><div class="icon">📦</div>
      <p>${hasF ? 'Aucun résultat pour ces filtres.' : 'Aucun article dans cette catégorie.'}</p>
      ${!hasF && STATE.isAdmin ? `<button class="btn btn-gold btn-sm" style="margin-top:.75rem" data-sh-action="openItemModal">+ Ajouter</button>` : ''}</div>`;
  } else {
    html = _renderItemGrid(cat, slice);
  }

  if (pages > 1) {
    html += `<div class="sh-pagination">`;
    if (p>1) html += `<button class="sh-page-btn" data-sh-action="page" data-page="${p-1}">← Précédent</button>`;
    const st=Math.max(1,p-2), en=Math.min(pages,p+2);
    if(st>1) html+=`<button class="sh-page-btn" data-sh-action="page" data-page="1">1</button>${st>2?'<span class="sh-dim-pill">…</span>':''}`;
    for(let i=st;i<=en;i++) html+=`<button class="sh-page-btn ${i===p?'active':''}" data-sh-action="page" data-page="${i}">${i}</button>`;
    if(en<pages) html+=`${en<pages-1?'<span class="sh-dim-pill">…</span>':''}<button class="sh-page-btn" data-sh-action="page" data-page="${pages}">${pages}</button>`;
    if(p<pages) html+=`<button class="sh-page-btn" data-sh-action="page" data-page="${p+1}">Suivant →</button>`;
    html += `</div>`;
  }
  grid.innerHTML = html;
}

// ── Mise à jour partielle vue home — résultats sans toucher le champ texte ──
function _updateHomeOnly() {
  const results = document.getElementById('sh-home-results');
  if (!results) { renderShop(); return; }
  results.innerHTML = _renderHomeResults();
  _mountSortables();
}

// ══════════════════════════════════════════════════════════════════════════════
// DRAG & DROP (SortableJS) — Catégories & Articles
// ══════════════════════════════════════════════════════════════════════════════
let _sortCats = null, _sortItems = null, _dragBlockClick = false, _clickGuardInstalled = false;

function _installClickGuard() {
  if (_clickGuardInstalled) return;
  _clickGuardInstalled = true;
  document.addEventListener('click', (e) => {
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
    filter: 'button, a, input, select, textarea, .btn-icon, .sh-card-admin-inline, .sh-item-actions, .sh-list-actions',
    onStart: () => { document.body.classList.add('sh-dragging'); _dragBlockClick = true; },
  };
  const finishDrag = () => {
    document.body.classList.remove('sh-dragging');
    setTimeout(() => { _dragBlockClick = false; }, 350);
  };

  const catGrid = document.querySelector('.sh-cat-grid.sh-sortable');
  if (catGrid) {
    _sortCats = makeSortable(catGrid, {
      ...shOpts,
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
        const visible = _activeCat === '__uncategorized__'
          ? _items.filter(i => !_cats.find(c => c.id === i.categorieId))
          : _items.filter(i => i.categorieId === _activeCat);
        const [moved] = visible.splice(evt.oldIndex, 1);
        visible.splice(evt.newIndex, 0, moved);
        try {
          // Idem : seuls les items réellement décalés sont réécrits.
          const writes = [];
          visible.forEach((item, i) => { if (Number(item.ordre) !== i) writes.push(updateInCol('shop', item.id, { ordre: i })); });
          await Promise.all(writes);
          visible.forEach((item, i) => { item.ordre = i; });
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
    const n=_items.filter(i=>i.categorieId===catId).length;
    if (!await confirmModal(n>0?`Cette catégorie contient ${n} article(s). Supprimer quand même ?`:'Supprimer cette catégorie ?', { title: 'Confirmation de suppression' })) return;
    const toDelete=_items.filter(i=>i.categorieId===catId);
    await Promise.all(toDelete.map(i=>deleteFromCol('shop',i.id)));
    await deleteFromCol('shopCategories',catId);
    if(_activeCat===catId){_view='home';_activeCat=null;}
    showNotif(`Catégorie et ${toDelete.length} article(s) supprimés.`,'success'); renderShop();
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
const _DMG_PROFILE_KEYS = ['resistances', 'immunites', 'absorptions', 'faiblesses'];

function _shopRenderDamageProfileSection(item) {
  const prof  = item?.damageProfile || {};
  const types = _shopDamageTypes;
  const rows = !types
    ? `<div style="color:var(--text-dim);font-size:.78rem;padding:.4rem 0">Chargement des types de dégâts…</div>`
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

const _ACT_TYPE_LABEL = { action: '🎯 Action', bonus: '💫 Action bonus', reaction: '⚡ Réaction' };
const _ACT_STATS      = [
  { v:'',           lbl:'Aucune' },
  { v:'force',      lbl:'Force' },
  { v:'dexterite',  lbl:'Dextérité' },
  { v:'intelligence', lbl:'Intelligence' },
  { v:'sagesse',    lbl:'Sagesse' },
  { v:'constitution', lbl:'Constitution' },
  { v:'charisme',   lbl:'Charisme' },
];


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
  arme:      ['essentiel', 'bonus', 'traits', 'actions', 'meta'],
  armure:    ['essentiel', 'bonus', 'traits', 'actions', 'meta'],
  bijou:     ['essentiel', 'bonus', 'traits', 'actions', 'meta'],
  classique: ['essentiel', 'actions', 'meta'],
  libre:     ['essentiel', 'meta'],
};

const _SI_TAB_DEF = {
  essentiel: { label: 'Essentiel', icon: '⚙️' },
  bonus:     { label: 'Bonus',     icon: '✨' },
  traits:    { label: 'Traits',    icon: '🏷️' },
  actions:   { label: 'Actions',   icon: '⚡' },
  meta:      { label: 'Méta',      icon: '🔧' },
};

// Champs de chaque onglet, par template. L'onglet "essentiel" regroupe TOUT
// ce qu'on touche 95% du temps : caractéristiques + prix/dispo/rareté.
const _SI_TAB_FIELDS = {
  arme: {
    essentiel: ['format','sousType','rarete','degats','toucherStat','portee','prix','dispo'],
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
function openItemModal(itemId) {
  const item   = itemId ? _items.find(i=>i.id===itemId) : null;
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
    ? `<img src="${item.image}" alt="">`
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
    const val=item?.[f.id]??'';
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
      html+=`<div class="form-group"><label>${f.label}</label>
        <select class="input-field sh-modal-select" id="si-${f.id}">
          <option value="">— Choisir —</option>
          ${(f.options||[]).map(o=>`<option value="${o}" ${val===o?'selected':''}>${o}</option>`).join('')}
        </select></div>`;
    } else if(f.type==='format_select'){
      html+=`<div class="form-group"><label>${f.label}</label>
        <select class="input-field sh-modal-select" id="si-${f.id}">
          <option value="">— Choisir —</option>
          ${_weaponFormats.map(o=>`<option value="${o.label}" ${val===o.label?'selected':''}>${o.label}</option>`).join('')}
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
        <textarea class="input-field" id="si-${f.id}" rows="2">${val}</textarea></div>`;
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

    const data={ nom, categorieId:catId, template:tplKey, image:document.getElementById('si-img-b64')?.value||'' };

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

    if (tplKey === 'arme') {
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

    if(itemId) await updateInCol('shop',itemId,data);
    else await addToCol('shop',data);

    if (itemId) await _syncCharactersAfterItemUpdate(itemId, data);

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
    if (!await confirmModal('Supprimer cet article ?', { title: 'Confirmation de suppression' })) return;
    await deleteFromCol('shop',itemId);
    showNotif('Article supprimé.','success'); renderShop();
  } catch (e) { notifySaveError(e); }
}

// ══════════════════════════════════════════════════════════════════════════════
// ATELIER D'ESSAYAGE — version simplifiée
// Modale plein écran à 3 colonnes :
//   • Doll : silhouette du perso avec 8 slots cliquables (Tête/Amulette/Torse/
//     Anneau/Main principale/Main secondaire/Bottes/Objet magique).
//   • Stats : 6 caracs + 4 dérivés (CA, PV max, PM max, Vitesse) avec
//     cur → next + delta coloré live.
//   • Items : liste des articles compatibles avec le slot actif, clic = toggle
//     l'essai. Reset bouton pour vider tous les essais.
// État local (réinitialisé à chaque ouverture) :
//   _atelier = { activeSlot, simulated: { slot → shopItem } }
// ══════════════════════════════════════════════════════════════════════════════
const _ATELIER_SLOTS = [
  { name: 'Tête',            ico: '🪖', kind: 'armure' },
  { name: 'Amulette',        ico: '📿', kind: 'bijou'  },
  { name: 'Torse',           ico: '🛡️', kind: 'armure' },
  { name: 'Anneau',          ico: '💍', kind: 'bijou'  },
  { name: 'Main principale', ico: '⚔️', kind: 'arme'   },
  { name: 'Main secondaire', ico: '🗡️', kind: 'arme'   },
  { name: 'Bottes',          ico: '👢', kind: 'armure' },
  { name: 'Objet magique',   ico: '🔮', kind: 'bijou'  },
];
let _atelier = { activeSlot: null, simulated: {}, itemSearch: '', sort: 'rarity' };

/** Filtre les items boutique compatibles avec un slot d'équipement donné. */
function _atelierItemsForSlot(slotName) {
  if (!slotName) return [];
  const slotMeta = _ATELIER_SLOTS.find(s => s.name === slotName);
  if (!slotMeta) return [];
  return _visibleItems().filter(it => {
    if (!it.nom) return false;
    if (slotMeta.kind === 'arme') {
      const tpl = it.template || '';
      if (tpl === 'arme') return true;
      // Idem que editEquipSlot : marqueurs d'arme suffisants
      return !!(it.degats || it.toucher || it.sousType ||
                (it.format && ['Arme 1M CaC Phy.','Arme 2M CaC Phy.','Arme 2M Dist Phy.',
                              'Arme 2M CaC Mag.','Arme 2M Dist Mag.',
                              'Arme Secondaire (Bouclier, Torche...)'].includes(it.format)));
    }
    if (slotMeta.kind === 'armure') {
      const wantSlot = slotName === 'Bottes' ? 'Pieds' : slotName;
      return it.slotArmure === wantSlot;
    }
    if (slotMeta.kind === 'bijou') {
      return it.slotBijou === slotName;
    }
    return false;
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

  const slotsHtml = _ATELIER_SLOTS.map(s => {
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
      title="${_esc(s.name)}${itemName?` — ${_esc(itemName)}`:''}">
      <span class="atelier-slot-ico">${s.ico}</span>
      <span class="atelier-slot-name">${_esc(s.name)}</span>
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
  return _ATELIER_SLOTS.map(s => {
    const active = _atelier.activeSlot === s.name;
    const count  = _atelierItemsForSlot(s.name).length;
    const sim    = !!_atelier.simulated[s.name];
    return `<button class="atelier-slot-tab${active?' is-active':''}${sim?' is-simulated':''}${count?'':' is-empty'}"
      data-sh-action="atelierGoSlot" data-slot="${_esc(s.name)}"
      title="${_esc(s.name)} — ${count} article${count>1?'s':''} compatible${count>1?'s':''}">
      <span class="atelier-slot-tab-ico">${s.ico}</span>
      <span class="atelier-slot-tab-name">${_esc(s.name)}</span>
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
  // armure → typeArmure (Légère/Intermédiaire/Lourde), sinon slotBijou / type libre.
  // Renvoie [rang, libellé] : rang défini d'abord, puis alpha pour le reste.
  const ARMURE_ORDER = TEMPLATES.armure.fields.find(f => f.id === 'typeArmure')?.options || [];
  const typeRank = (it) => {
    if (it.format)     { const i = _weaponFormats.findIndex(f => f.label === it.format); return [i < 0 ? 999 : i, it.format]; }
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
      <div class="atelier-items-empty-hint">Aucun article boutique ne correspond au slot « ${_esc(slot)} ».</div>
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
  if (slotLbl) slotLbl.textContent = _atelier.activeSlot || '—';

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
  _atelier = { activeSlot: null, simulated: {}, itemSearch: '' };
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

/** Ouvre la modale Atelier ; si `prefillItemId` fourni → essai pré-rempli. */
function openAtelierModal(prefillItemId) {
  const char = _getActiveShopChar();
  if (!char) { showNotif('Sélectionne d\'abord un personnage.', 'error'); return; }
  // Reset état
  _atelier = { activeSlot: null, simulated: {}, itemSearch: '', sort: 'rarity' };
  if (prefillItemId) {
    const item = _items.find(i => i.id === prefillItemId);
    const slot = item ? _resolveSlotForItem(item) : null;
    if (item && slot) {
      _atelier.activeSlot = slot;
      _atelier.simulated[slot] = item;
    }
  }
  openModal('', `
    <div class="atelier-shell">
      <div class="atelier-head">
        <div class="atelier-head-ico">🪄</div>
        <div class="atelier-head-title">
          <h2>Atelier d'essayage</h2>
          <small>Construis et compare des configurations avant d'acheter</small>
        </div>
        <button class="atelier-close" data-sh-action="closeModal" title="Fermer">✕</button>
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
    </div>`);
  _renderAtelier();
}

// ──────────────────────────────────────────────────────────────────────────────
// HANDLERS DE DÉLÉGATION (data-sh-action="…")
// ──────────────────────────────────────────────────────────────────────────────
Object.assign(shHandlers, {
  // Header / navigation principale
  openArtisan:    () => openArtisanModal(),
  openAtelier:    (el) => openAtelierModal(el?.dataset?.id || ''),
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
    _atelier = { activeSlot: null, simulated: {}, itemSearch: '' };
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
  // Tweaks d'affichage (lot 7)
  openTweaks:     () => openTweaksPopup(),
  setTweak:       (el) => {
    const k = el.dataset.twKey, v = el.dataset.twVal;
    if (!k || _shopTweaks[k] === v) return;
    _shopTweaks[k] = v;
    _shopTweaksSave();
    // Refresh visuel des segmented dans la modale ouverte
    document.querySelectorAll(`[data-tw-key="${k}"] .sh-tw-seg-btn`).forEach(b => {
      b.classList.toggle('on', b.dataset.twVal === v);
    });
    // Re-render du shop pour appliquer : layout (tabs/sidebar) et card=liste
    // changent le MARKUP (pas juste du CSS) → re-render obligatoire.
    if (k === 'layout' || k === 'card') renderShop();
  },
  resetTweaks:    () => {
    _shopTweaks = { ..._TWEAKS_DEFAULTS };
    _shopTweaksSave();
    closeModalDirect();
    renderShop();
    setTimeout(openTweaksPopup, 50);
  },
  openCatModal:   (el) => openCatModal(el.dataset.id || ''),
  openItemModal:  (el) => openItemModal(el.dataset.id || ''),
  openWeaponFmts: () => openWeaponFormatsAdmin(),
  openUpgradeStg: () => openUpgradeSettingsAdmin(),
  openExport:     () => openShopExport({
    getCats: () => _cats,
    getItems: () => _items,
    formatStatBonuses: _formatStatBonuses,
    onImported: () => renderShop(),
  }),
  closeModal:     () => closeModalDirect(),
  // Smart filters (lot 3)
  toggleSmart:    (el) => {
    const k = el.dataset.smart;
    if (!k || !SMART_KINDS.includes(k)) return;
    if (_smartFilters.has(k)) _smartFilters.delete(k); else _smartFilters.add(k);
    _page = 1;
    renderShop();
  },
  resetSmart:     () => { _smartFilters.clear(); _page = 1; renderShop(); },
  toggleFav:      (el) => toggleFav(el?.dataset?.id || ''),
  // Sidebar / catégories
  goHome:         () => shopGoHome(),
  goCat:          (el) => shopGoCat(el.dataset.id),
  setChar:        (el) => shopSetChar(el.value),
  search:         (el) => shopFilterSearch(el.value),
  clearSearch:    () => shopFilterSearch(''),
  setSort:        (el) => shopSetSort(el.value),
  resetFilters:   () => shopFilterReset(),
  toggleTag:      (el) => shopToggleTag(el.dataset.tag),
  page:           (el) => shopPage(parseInt(el.dataset.page)),
  deleteCat:      (el) => deleteCat(el.dataset.id),
  // Items
  buyItem:        (el, ev) => { ev?.stopPropagation?.(); buyItem(el.dataset.id); },
  confirmBuy:     (el) => confirmBuyItem(el.dataset.id),
  openDetail:     (el) => openShopItemDetail(el.dataset.id),
  deleteItem:     (el) => deleteShopItem(el.dataset.id),
  editFromDetail: (el) => { closeModalDirect(); openItemModal(el.dataset.id); },
  buyFromDetail:  (el) => { closeModalDirect(); buyItem(el.dataset.id); },
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
