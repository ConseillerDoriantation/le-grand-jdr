// ══════════════════════════════════════════════════════════════════════════════
// RECIPES.JS — Recettes & Potions & Craft
// ✓ Admin : CRUD, ingrédients dynamiques, accès par joueur
// ✓ Joueur : voir uniquement ses recettes, envoyer à un autre (perd son accès)
// Firestore : collection 'recipes'
//   { type, nom, duree, effet, description, ingredients:[{nom,quantite}], acces:[uid,...], shopItemId? }
//   type : 'cuisine' | 'potion' | 'arme' | 'armure' | 'bijou'
// ══════════════════════════════════════════════════════════════════════════════
import { loadCollection, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { confirmDelete, trySave } from '../shared/crud.js';
import { openModal, closeModal, closeModalDirect, pushModal, confirmModal } from "../shared/modal.js";
import { registerActions } from '../core/actions.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import PAGES from './pages.js';
import { _rareteTag } from '../shared/rarity.js';
import { _esc, _norm, _searchIncludes, _trunc } from "../shared/html.js";
import { formatWeaponDamageText, isWeaponLikeItem } from '../shared/equipment-utils.js';
import { canControlCharacter } from '../shared/character-state.js';
import { loadWeaponFormats } from '../shared/weapon-formats.js';
import { normalizeWeaponFamilyKey, resolveWeaponFamily } from '../shared/weapon-family.js';
import { getRouteSub, setRouteSub } from '../shared/route.js';

// ── État local ─────────────────────────────────────────────────────────────────

// ── Config des onglets ────────────────────────────────────────────────────────
const TABS = [
  { id:'all',        emoji:'📚', label:'Tout' },
  { id:'cuisine',    emoji:'🍳', label:'Cuisine' },
  { id:'potion',     emoji:'🧪', label:'Potions' },
  { id:'forge',      emoji:'⚒️', label:'Forge' },
  { id:'orfevre',    emoji:'💎', label:'Orfèvre' },
  { id:'confection', emoji:'🧵', label:'Confection' },
  { id:'arme',       emoji:'⚔️', label:'Armes' },
  { id:'armure',     emoji:'🛡️', label:'Armures' },
  { id:'bijou',      emoji:'💍', label:'Bijoux' },
];
// Types « craft » liés à un objet boutique : créés depuis la Boutique, pas
// directement (l'objet produit existe déjà comme article).
const CRAFT_TYPES = ['arme', 'armure', 'bijou'];
// Onglets qui proposent une création directe (tout sauf "Tout" et les crafts).
const CREATE_RECIPES = TABS.filter(t => t.id !== 'all' && !CRAFT_TYPES.includes(t.id));
// Sous-titre du sélecteur de type dans le picker de création MJ.
const CREATE_DESC = {
  cuisine:    'Préparation, durée, ingrédients et effet de groupe.',
  potion:     'Ingrédients, préparation et effet individuel.',
  forge:      'Matériaux, préparation et objet forgé.',
  orfevre:    'Matériaux précieux, préparation et bijou ouvragé.',
  confection: 'Étoffes, préparation et pièce confectionnée.',
};

const MATERIALS = {
  'matMyst': 'Matériaux mystiques',
  'matSoup': 'Matériaux souples',
  'matBest': 'Matériaux bestiaux',
  'matResi': 'Matériaux résistants',
  'matLeger': 'Matériaux légers',
  'matTann': 'Matériaux tannés',
};

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

const STORE = {
  all: [],
  shopItems: [], // items boutique (arme/armure/bijou)
  shopCats: [],
  tab: 'cuisine', // 'cuisine'|'potion'|'arme'|'armure'|'bijou'
  filterTxt: '',
  adventureId: '',
  loaded: false,
};

let _recipeReturnCharacterId = '';

document.addEventListener('app:route-sub-changed', event => {
  if (event.detail?.page !== 'recettes' || !TABS.some(tab => tab.id === event.detail.sub)) return;
  event.preventDefault();
  STORE.tab = event.detail.sub;
  STORE.filterTxt = '';
  _render();
});

async function _ensureRecipeData() {
  const adventureId = STATE.adventure?.id || '';
  if (STORE.loaded && STORE.adventureId === adventureId) return;
  [STORE.all, STORE.shopItems, STORE.shopCats, STORE.weaponFormats] = await Promise.all([
    loadCollection('recipes'),
    loadCollection('shop'),
    loadCollection('shopCategories').catch(() => []),
    loadWeaponFormats().catch(() => []),
  ]);
  STORE.all.sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }));
  STORE.shopItems.sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }));
  STORE.adventureId = adventureId;
  STORE.loaded = true;
}

function _myUid()   { return STATE.user?.uid || ''; }
function _isAdmin() { return !!STATE.isAdmin; }

function _getJoueurs() {
  const seen = new Set();
  return (STATE.characters || []).filter(c => {
    if (!c.uid || seen.has(c.uid)) return false;
    seen.add(c.uid);
    return true;
  }).map(c => ({ uid: c.uid, pseudo: c.ownerPseudo || c.nom || c.uid }));
}

function _visible() {
  const uid        = _myUid();
  const regular    = _isAdmin() ? STORE.all : STORE.all.filter(r => (r.acces || []).includes(uid));
  const converted  = STORE.shopItems.map(_shopToRecipe).filter(Boolean);
  const shopVis    = _isAdmin() ? converted : converted.filter(r => (r.acces || []).includes(uid));
  return [...regular, ...shopVis];
}

// Retourne l'item brut (recipes ou shop) par id
function _findRaw(id) {
  return STORE.all.find(x => x.id === id) || STORE.shopItems.find(i => i.id === id) || null;
}
function _isShopItem(id) { return STORE.shopItems.some(i => i.id === id); }
function _findShopItem(id) { return STORE.shopItems.find(i => i.id === id) || null; }
function _findShopCat(id) { return STORE.shopCats.find(c => c.id === id) || null; }

const SHOP_TEMPLATE_LABELS = {
  arme: "Arme",
  armure: "Armure",
  bijou: "Bijou",
  classique: "Classique",
  libre: "Libre",
};

function _shopItemKind(item = {}) {
  const cat = _findShopCat(item.categorieId);
  return cat?.nom || SHOP_TEMPLATE_LABELS[item.template] || item.type || item.sousType || "Boutique";
}

function _linkedShopItem(recipe = {}) {
  return recipe.shopItemId ? _findShopItem(recipe.shopItemId) : null;
}

function _linkedShopSummary(item = {}) {
  return [
    item.nom,
    _shopItemKind(item),
    item.template,
    item.type,
    item.sousType,
    item.format,
    item.description,
    item.effet,
  ].filter(Boolean).join(" ");
}


function _recipeSearchText(r = {}) {
  const linked = _linkedShopItem(r);
  const ingredientText = Array.isArray(r.ingredients)
    ? r.ingredients.map(ig => [ig.nom, ig.quantite].filter(Boolean).join(' ')).join(' ')
    : '';
  const tabLabel = TABS.find(t => t.id === r.type)?.label || '';
  return _norm([
    r.nom,
    r.type,
    tabLabel,
    r.famille,
    r.duree,
    r.description,
    r.effet,
    r.format,
    r.typeObjet,
    r.typeArmure,
    r.atelierReq,
    r.ingredients_texte,
    ingredientText,
    linked ? _linkedShopSummary(linked) : "",
  ].filter(Boolean).join(' '));
}

function _filterRecipesBySearch(recipes) {
  // La recherche est bornée à l'onglet actif ; "Tout" couvre tous les types.
  const inTab = STORE.tab === 'all' ? recipes : recipes.filter(r => r.type === STORE.tab);
  const q = _norm(STORE.filterTxt);
  if (!q) return inTab;
  return inTab.filter(r => _searchIncludes(_recipeSearchText(r), STORE.filterTxt));
}

// ── Conversion item boutique → recette ───────────────────────────────────────
// Nature d'une arme pour l'artisanat : anciens libellés de format (« Arme 2M Dist
// Mag. ») ou type d'arme actuel (magique ?) + portée (au-delà du contact = distance).
function _weaponCraftKind(item = {}) {
  const fmt = String(item.format || '');
  if (fmt.includes('Mag')) return 'magic';
  if (fmt.includes('Dist')) return 'ranged';
  if (fmt.includes('CaC')) return 'melee';
  if (fmt.includes('Bouclier')) return 'shield';
  const family = resolveWeaponFamily(STORE.weaponFormats || [], item);
  if (!family && !isWeaponLikeItem(item)) return null;
  if (family?.isMagic) return 'magic';
  if (normalizeWeaponFamilyKey(family?.label || item.sousType) === 'bouclier') return 'shield';
  const reach = String(item.portee || '').replace(',', '.').match(/(\d+(?:\.\d+)?)\s*m/i);
  return reach && parseFloat(reach[1]) > 1.5 ? 'ranged' : 'melee';
}

function _shopItemAtelierReq(item, type) {
  const kind = type === 'arme' ? _weaponCraftKind(item) : null;
  if (type === 'bijou')                   return "Atelier d'orfèvre";
  if (kind === 'magic')                   return "Atelier d'orfèvre";
  if (kind === 'ranged')                  return 'Atelier de confection';
  if (item.slotArmure) {
    return item.typeArmure === 'Lourde' ? 'Forge' : 'Atelier de confection';
  }
  return 'Forge';
}

function _shopItemIngredients(item) {
  const quantity = Math.max(1, Math.round((parseFloat(item.prix) || 0) / 10));
  const kind = item.slotArmure ? null : _weaponCraftKind(item);
  let materiau;
  if      (kind === 'magic')  materiau = MATERIALS.matMyst;
  else if (kind === 'ranged') materiau = MATERIALS.matSoup;
  else if (kind === 'melee')  materiau = MATERIALS.matBest;
  else if (kind === 'shield') materiau = MATERIALS.matResi;
  else if (item.slotArmure) {
    if      (item.typeArmure === 'Légère')        materiau = MATERIALS.matLeger;
    else if (item.typeArmure === 'Intermédiaire') materiau = MATERIALS.matTann;
    else if (item.typeArmure === 'Lourde')        materiau = MATERIALS.matResi;
  }
  return materiau ? [{ nom: materiau, quantite: String(quantity) }] : [];
}

function _shopToRecipe(item) {
  const itemFormat  = item.format || '';
  const type = isWeaponLikeItem(item) ? 'arme'
             : item.slotArmure ? 'armure'
             : (item.slotBijou && item.slotBijou !== 'Objet magique') ? 'bijou'
             : null;
  if (!type) return null;

  const meta = item.recipeMeta || {};
  if (meta.hidden) return null;

  const traits       = Array.isArray(item.traits) ? item.traits : [];
  const autoIngrs    = (type === 'arme' || type === 'armure' || type === 'bijou') ? _shopItemIngredients(item) : [];
  const defaultEffet = [item.effet, ...traits].filter(Boolean).join(' · ') || '';

  return {
    id:          item.id,
    _fromShop:   true,
    shopItemId:  item.id,
    type,
    nom:         item.nom || '?',
    rarete:      item.rarete || 0,
    format:      itemFormat,
    typeObjet:   item.sousType || item.slotArmure || item.slotBijou || '',
    degats:      formatWeaponDamageText(item),
    caBonus:     parseInt(item.ca) || 0,
    typeArmure:  item.typeArmure || '',
    atelierReq:  meta.atelierReq  ?? _shopItemAtelierReq(item, type),
    tempsCraft:  meta.tempsCraft  ?? '',
    ingredients: meta.ingredients !== undefined ? meta.ingredients : autoIngrs,
    acces:       item.acces || [],
    effet:       meta.effet       !== undefined ? meta.effet       : defaultEffet,
    description: meta.description !== undefined ? meta.description : (item.description || ''),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDU PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
async function renderRecipes() {
  const content = document.getElementById('main-content');
  content.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-dim)"><div style="font-size:2rem">⏳</div></div>`;
  await _ensureRecipeData();
  const routeTab = getRouteSub('recettes');
  STORE.tab = TABS.some(tab => tab.id === routeTab) ? routeTab : (STORE.tab || 'cuisine');
  if (!TABS.some(tab => tab.id === routeTab)) setRouteSub('recettes', STORE.tab, { replace: true });
  _render();
}

function _render() {
  const content = document.getElementById('main-content');
  const visible  = _visible();
  const tabInfo  = TABS.find(t => t.id === STORE.tab) || TABS[0];

  const filtered = _filterRecipesBySearch(visible);

  // Compteurs par onglet ("Tout" = total visible)
  const counts = {};
  TABS.forEach(t => { counts[t.id] = t.id === 'all' ? visible.length : visible.filter(r => r.type === t.id).length; });

  // Couleur de bordure selon le type
  const borderColor = {
    cuisine:'#e8b84b', potion:'#22c38e', arme:'#ff6b6b', armure:'#4f8cff', bijou:'#c084fc'
  };

  content.innerHTML = `
  <div class="rec-page">
    <header class="rec-head">
      <div class="rec-head-titles">
        <span class="rec-eyebrow">Encyclopédie</span>
        <h1 class="rec-title">Recettes</h1>
      </div>
      ${_isAdmin() ? `
      <div class="rec-head-actions">
        ${CREATE_RECIPES.map(t => `<button class="btn btn-outline btn-sm" data-action="_recOpenModal" data-type="${t.id}">${t.emoji} + ${t.label}</button>`).join('')}
      </div>` : ''}
    </header>

    <div class="rec-legend">
      <span class="rec-legend-item"><strong style="color:var(--gold)">🍳</strong> Cuisine — avant mission, bénéficie au groupe (max 2 actifs)</span>
      <span class="rec-legend-item"><strong style="color:#22c38e">🧪</strong> Potions — effets individuels</span>
      <span class="rec-legend-item"><strong style="color:#ff6b6b">⚔️🛡️💍</strong> Craft — matériaux + atelier requis</span>
    </div>

    <div class="rec-toolbar">
      <div class="rec-tabs">
        ${TABS.map(t => `
          <button class="rec-tab ${STORE.tab===t.id?'active':''}" data-action="recSetTab" data-id="${t.id}" data-nav-page="recettes" data-nav-sub="${t.id}">
            <span class="rec-tab-emoji">${t.emoji}</span>
            <span class="rec-tab-label">${t.label}</span>
            <span class="rec-tab-count">${counts[t.id]}</span>
          </button>`).join('')}
      </div>
      <div class="rec-search">
        <span class="rec-search-ic">🔍</span>
        <input type="text" class="rec-search-input" data-input="recSearch"
          placeholder="Rechercher ${STORE.tab==='all'?'une recette':'dans '+tabInfo.label}…"
          value="${_esc(STORE.filterTxt)}">
      </div>
    </div>

    <div id="rec-grid-wrap">${_gridHtml(filtered, tabInfo, visible, borderColor)}</div>
  </div>
  `;
}

function _gridHtml(filtered, tabInfo, visible, borderColor) {
  if (filtered.length === 0) {
    const isAll    = STORE.tab === 'all';
    const tabCount = isAll ? visible.length : visible.filter(r => r.type === STORE.tab).length;
    const emptyTxt = tabCount > 0
      ? 'Aucun résultat pour cette recherche.'
      : isAll
        ? (_isAdmin() ? 'Aucune recette pour le moment.' : 'Aucune recette partagée avec vous.')
        : (_isAdmin() ? `Aucune recette de type "${tabInfo.label}" — créez-en une !` : `Aucune recette partagée avec vous dans cette catégorie.`);
    const canCreate = _isAdmin() && tabCount === 0 && CREATE_RECIPES.some(t => t.id === STORE.tab);
    return `
    <div class="rec-empty">
      <div style="font-size:2.5rem;margin-bottom:.75rem;opacity:.25">${tabInfo.emoji}</div>
      <p style="font-style:italic">${emptyTxt}</p>
      ${canCreate
        ? `<button class="btn btn-gold btn-sm" style="margin-top:.5rem" data-action="_recOpenModal" data-type="${STORE.tab}">＋ Nouvelle recette</button>` : ''}
    </div>`;
  }
  return `<div class="rec-grid">
    ${filtered.map(r => _renderCard(r, borderColor[r.type]||'#e8b84b')).join('')}
  </div>`;
}

function _renderGrid() {
  const wrap = document.getElementById('rec-grid-wrap');
  if (!wrap) { _render(); return; }
  const visible = _visible();
  const tabInfo = TABS.find(t => t.id === STORE.tab) || TABS[0];
  const borderColor = { cuisine:'#e8b84b', potion:'#22c38e', arme:'#ff6b6b', armure:'#4f8cff', bijou:'#c084fc' };
  const filtered = _filterRecipesBySearch(visible);
  wrap.innerHTML = _gridHtml(filtered, tabInfo, visible, borderColor);
}

// ── Card recette ──────────────────────────────────────────────────────────────
function _renderCard(r, accent) {
  const uid         = _myUid();
  const isAdmin     = _isAdmin();
  const joueurs     = _getJoueurs();
  const accesUids   = r.acces || [];
  const nbAcces     = accesUids.length;
  const isCraftType = CRAFT_TYPES.includes(r.type);
  const linkedItem  = !r._fromShop ? _linkedShopItem(r) : null;
  const hasMissingLinkedItem = !r._fromShop && r.shopItemId && !linkedItem;
  const hasDetail   = isCraftType || !!linkedItem;

  const ingrs = Array.isArray(r.ingredients) ? r.ingredients : [];
  const ingrHtml = ingrs.length
    ? `<div class="rec-ingr-list">
        ${ingrs.map(ig => `
          <div class="rec-ingr-row">
            <span class="rec-ingr-qty">${ig.quantite||''}</span>
            <span>${ig.nom||''}</span>
          </div>`).join('')}
       </div>`
    : (r.ingredients_texte ? `<div style="font-size:.78rem;color:var(--text-muted);margin:.25rem 0">🌿 ${r.ingredients_texte}</div>` : '');

  const atelierReq = r.atelierReq || { cuisine: 'Marmite', potion: 'Alambic' }[r.type] || '';
  const statsHtml = (isCraftType || atelierReq) ? `
    <div class="rec-stat-row">
      ${isCraftType && r.rarete     ? _rareteTag(r.rarete, 'rec-stat') : ''}
      ${isCraftType && r.tempsCraft ? `<span class="rec-stat">⏱️ ${r.tempsCraft}</span>` : ''}
      ${atelierReq                  ? `<span class="rec-stat">${atelierReq}</span>` : ''}
    </div>` : '';

  const autresJoueurs = joueurs.filter(j => j.uid !== uid && !accesUids.includes(j.uid));
  const canSend = !isAdmin && accesUids.includes(uid) && autresJoueurs.length > 0;

  return `<div class="rec-card${hasDetail ? " rec-card-clickable" : ""}"
    style="border-left:3px solid ${accent}"
    ${hasDetail ? `data-action="openItemDetailModal" data-id="${r.id}"` : ""}>
    <div class="rec-card-header">
      <div>
        <div class="rec-card-name">${r.nom||'?'}</div>
        <div style="display:flex;align-items:center;gap:.4rem;margin-top:.3rem;flex-wrap:wrap">
          ${r.duree && !isCraftType ? `<span class="rec-tag">⏱️ ${r.duree}</span>` : ''}
          ${r.famille ? `<span class="rec-tag">${r.famille}</span>` : ''}
          ${linkedItem ? `<span class="rec-tag rec-tag-shop" title="Objet boutique associé">🛒 ${_esc(linkedItem.nom || "Objet boutique")}</span>` : ""}
          ${hasMissingLinkedItem ? `<span class="rec-tag rec-tag-missing" title="Objet boutique lié introuvable">Objet boutique manquant</span>` : ""}
          ${isAdmin ? `<span class="rec-tag" style="color:${nbAcces>0?'#22c38e':'var(--text-dim)'}">
            ${nbAcces>0 ? `✓ ${nbAcces} joueur${nbAcces>1?'s':''}` : '⚠ Non partagé'}
          </span>` : ''}
        </div>
      </div>
      ${isAdmin ? `
      <div style="display:flex;gap:.25rem;flex-shrink:0">
        <button class="btn-icon" data-action="${r._fromShop ? '_recEditShop' : '_recEdit'}" data-id="${r.id}" data-type="${r.type}" data-stop-propagation>✏️</button>
        <button class="btn-icon" style="color:#ff6b6b" data-action="${r._fromShop ? '_recDeleteShop' : '_recDelete'}" data-id="${r.id}" data-stop-propagation>🗑️</button>
      </div>` : ''}
    </div>
    <div class="rec-card-body">
      ${statsHtml}
      ${ingrHtml}
      ${!isCraftType && (ingrs.length||r.ingredients_texte) && (r.effet||r.description) ? '<div class="rec-divider"></div>' : ''}
      ${!isCraftType && r.description ? `<div style="margin-bottom:.3rem;color:var(--text-dim);font-size:.78rem">${r.description}</div>` : ''}
      ${!isCraftType && r.effet ? `<div class="rec-effet">✨ ${r.effet}</div>` : ''}
    </div>
    <div class="rec-footer">
      <div style="font-size:.7rem;color:var(--text-dim)">
        ${TABS.find(t=>t.id===r.type)?.emoji||''} ${TABS.find(t=>t.id===r.type)?.label||r.type}
      </div>
      <div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap">
        ${isAdmin && !r._fromShop ? `<button class="rec-btn rec-btn-output ${linkedItem ? 'is-linked' : ''}" data-action="_recOpenOutputPicker" data-id="${r.id}" data-type="${r.type}" data-stop-propagation>${linkedItem ? '📦 Changer l’objet produit' : '＋ Lier l’objet produit'}</button>` : ''}
        ${isAdmin ? `<button class="rec-btn rec-btn-acces" data-action="openAccesModal" data-id="${r.id}">👥 Accès</button>` : ''}
        ${canSend ? `<button class="rec-btn rec-btn-send" data-action="openSendRecipeModal" data-id="${r.id}">↗ Transmettre</button>` : ''}
      </div>
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
function _shopItemOptionLabel(item = {}) {
  const bits = [_shopItemKind(item)];
  if (item.prix !== undefined && item.prix !== "") bits.push(`${item.prix} or`);
  return `${item.nom || "Objet sans nom"} — ${bits.filter(Boolean).join(" · ")}`;
}

function _shopItemOptionsHtml(selectedId = "", query = "") {
  const q = (query || "").trim();
  const items = STORE.shopItems.filter(item => !q || _searchIncludes(`${item.nom || ""} ${_shopItemKind(item)}`, q));
  if (!items.length) return `<div class="rec-shop-picker-empty">Aucun objet ne correspond à cette recherche.</div>`;
  return items.map(item => `<button type="button" class="rec-shop-picker-option ${item.id === selectedId ? 'is-selected' : ''}"
      data-action="_recSelectLinkedShop" data-id="${_esc(item.id)}">
      ${item.image ? `<img src="${_esc(item.image)}" alt="">` : `<span class="rec-shop-picker-fallback">📦</span>`}
      <span><strong>${_esc(item.nom || 'Objet sans nom')}</strong><small>${_esc(_shopItemKind(item))}${item.prix !== undefined && item.prix !== '' ? ` · ${_esc(item.prix)} or` : ''}</small></span>
      <i aria-hidden="true">${item.id === selectedId ? '✓' : ''}</i>
    </button>`).join('');
}

function _recFilterShopOptions(query) {
  const list = document.getElementById('rec-shop-options');
  const current = document.getElementById('rec-shopItemId')?.value || '';
  if (list) list.innerHTML = _shopItemOptionsHtml(current, query);
}

function selectLinkedShopItem(itemId) {
  const input = document.getElementById('rec-shopItemId');
  if (!input || !_findShopItem(itemId)) return;
  input.value = itemId;
  refreshLinkedShopPreview(itemId);
  _recFilterShopOptions(document.getElementById('rec-shop-filter')?.value || '');
}

function _linkedShopPreviewHtml(itemId = "") {
  if (!itemId) {
    return `<div class="rec-linked-empty">Aucun objet boutique associé.</div>`;
  }
  const item = _findShopItem(itemId);
  if (!item) {
    return `<div class="rec-linked-missing">Objet boutique introuvable. Le lien sera conservé tant que celui-ci ne sera pas remplacé.</div>`;
  }
  const meta = [_shopItemKind(item), item.prix !== undefined && item.prix !== "" ? `${item.prix} or` : ""]
    .filter(Boolean).join(" · " );
  const desc = item.effet || item.description || "";
  return `<div class="rec-linked-preview">
    ${item.image ? `<img class="rec-linked-img" src="${item.image}" alt="">` : `<div class="rec-linked-img rec-linked-img-empty">🛒</div>`}
    <div class="rec-linked-main">
      <div class="rec-linked-name">${_esc(item.nom || "Objet boutique")}</div>
      ${meta ? `<div class="rec-linked-meta">${_esc(meta)}</div>` : ""}
      ${desc ? `<div class="rec-linked-desc">${_esc(_trunc(desc, 120))}</div>` : ""}
    </div>
  </div>`;
}

function refreshLinkedShopPreview(itemId = "") {
  const preview = document.getElementById("rec-linked-preview");
  if (preview) preview.innerHTML = _linkedShopPreviewHtml(itemId);
  const clearBtn = document.querySelector("[data-action=\"_recClearLinkedShop\"]");
  if (clearBtn) clearBtn.disabled = !itemId;
  const status = document.querySelector('.rec-output-status');
  if (status) {
    status.textContent = itemId ? 'Objet lié' : 'À définir';
    status.classList.toggle('is-linked', !!itemId);
  }
}

function clearLinkedShopItem() {
  const input = document.getElementById("rec-shopItemId");
  if (input) input.value = "";
  refreshLinkedShopPreview("");
  _recFilterShopOptions(document.getElementById('rec-shop-filter')?.value || '');
}

// MODAL DÉTAIL ITEM (arme / armure / bijou)
// ══════════════════════════════════════════════════════════════════════════════
export function openItemDetailModal(id) {
  openRecipesModal({ sel: id });
  return;
  // eslint-disable-next-line no-unreachable -- ancien détail, retiré en nettoyage
  const r = _visible().find(x => x.id === id);
  if (!r) return;
  const tab = TABS.find(t => t.id === r.type) || TABS[0];
  const linkedItem = !r._fromShop ? _linkedShopItem(r) : null;

  // Pour les items boutique, utiliser l'item brut pour avoir tous les champs
  const item = r._fromShop ? (_findRaw(id) || r) : (linkedItem || r);

  const traitsArr = Array.isArray(item.traits) ? item.traits
    : (item.trait ? item.trait.split(',').map(t => t.trim()).filter(Boolean) : []);

  const rows = [];
  if (item.format)                        rows.push(['Format',    item.format]);
  if (item.sousType)                      rows.push(['Type',      item.sousType]);
  if (item.typeObjet && !item.sousType)   rows.push(['Type',      item.typeObjet]);
  if (item.degats && item.degats !== '—') rows.push(['Dégâts',    item.degats]);
  if (item.portee)                        rows.push(['Portée',    item.portee]);
  if (item.slotArmure)                      rows.push(['Emplacement',  item.slotArmure]);
  if (item.typeArmure)                      rows.push(['Type armure',  item.typeArmure]);
  if ((item.ca || item.caBonus) > 0)        rows.push(['CA bonus',     `+${item.ca || item.caBonus}`]);
  if (item.slotBijou)                       rows.push(['Emplacement',  item.slotBijou]);
  if (item.atelierReq || r.atelierReq)      rows.push(['Atelier',      item.atelierReq || r.atelierReq]);
  if (item.tempsCraft || r.tempsCraft)      rows.push(['Temps de craft', item.tempsCraft || r.tempsCraft]);

  const prix    = parseFloat(item.prix) || 0;
  const rarete  = item.rarete || r.rarete;
  const image   = item.image || '';
  const desc    = item.description || r.description || '';
  const effet   = item.effet || r.effet || '';

  openModal(linkedItem ? r.nom : (item.nom || r.nom), `
    ${image ? `<div style="margin:-1.5rem -1.5rem .75rem"><img src="${image}" alt="${_esc(r.nom || item.nom || '')}" style="width:100%;height:180px;object-fit:cover;border-radius:22px 22px 0 0;display:block"></div>` : ''}
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:.75rem">
      <div>
        <div style="font-family:'Cinzel',serif;font-size:1.15rem;font-weight:700;color:var(--text)">${item.nom || r.nom || '?'}</div>
        <div style="font-size:.75rem;color:var(--text-dim)">${tab.label}${rarete ? ' · ' + _rareteTag(rarete, 'rec-stat') : ''}</div>
      </div>
      ${prix ? `<div style="text-align:right">
        <div style="font-family:'Cinzel',serif;font-size:1.1rem;font-weight:700;color:var(--gold)">💰 ${prix} or</div>
      </div>` : ''}
    </div>

    ${rows.length ? `<div style="background:var(--bg-elevated);border-radius:10px;overflow:hidden;margin-bottom:.75rem">
      ${rows.map(([l,v],i) => `<div style="display:flex;justify-content:space-between;padding:.45rem .75rem;${i ? 'border-top:1px solid var(--border)' : ''}">
        <span style="font-size:.78rem;color:var(--text-dim)">${l}</span>
        <span style="font-size:.78rem;color:var(--text);font-weight:600">${v}</span>
      </div>`).join('')}
    </div>` : ''}

    ${traitsArr.length ? `<div style="margin-bottom:.75rem">
      <div style="font-size:.68rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:.35rem">Traits</div>
      <div style="display:flex;flex-wrap:wrap;gap:.35rem">
        ${traitsArr.map(t => `<span class="sh-trait-pill">${t}</span>`).join('')}
      </div>
    </div>` : ''}

    ${desc ? `<div style="font-size:.82rem;color:var(--text-muted);line-height:1.7;margin-bottom:.75rem;padding:.6rem .75rem;background:rgba(255,255,255,.02);border-radius:8px;border-left:2px solid var(--border-strong)">${desc}</div>` : ''}
    ${effet ? `<div class="rec-effet">✨ ${effet}</div>` : ''}
  `);
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL ADMIN — Créer / Modifier une recette
// ══════════════════════════════════════════════════════════════════════════════
function openRecipeModal(type, id = '') {
  const r      = id ? STORE.all.find(x => x.id === id) : null;
  const rType  = r?.type || type;
  const tab    = TABS.find(t => t.id === rType) || TABS[0];
  const ingrs  = Array.isArray(r?.ingredients) && r.ingredients.length
    ? r.ingredients
    : [{ nom:'', quantite:'' }, { nom:'', quantite:'' }];

  const isCraft = CRAFT_TYPES.includes(rType);
  const linkedItemId = r?.shopItemId || "";
  if (isCraft && !id) return;

  // Champs spécifiques au type de craft
  const craftFields = isCraft ? `
    <div class="form-group"><label>Atelier requis</label>
      <input class="input-field" id="rec-atelierReq" value="${r?.atelierReq||''}" placeholder="${rType === 'bijou' ? "Atelier d'orfèvre..." : 'Forge, Atelier de confection...'}"></div>
    <div class="form-group"><label>Temps de craft</label>
      <input class="input-field" id="rec-tempsCraft" value="${r?.tempsCraft||''}" placeholder="1 journée, 3 heures..."></div>` : '';

  openModal(`${tab.emoji} ${r ? 'Modifier' : 'Nouvelle'} recette — ${tab.label}`, `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
      <div class="form-group" style="grid-column:1/-1">
        <label>Nom</label>
        <input class="input-field" id="rec-nom" value="${r?.nom||''}" placeholder="Nom de la recette...">
      </div>
      ${!isCraft ? `
      <div class="form-group">
        <label>Type de recette</label>
        <select class="input-field" id="rec-type">
          ${CREATE_RECIPES.map(t => `<option value="${t.id}" ${t.id === rType ? 'selected' : ''}>${t.emoji} ${t.label}</option>`).join('')}
        </select>
      </div>` : ''}
      ${!isCraft ? `
      <div class="form-group">
        <label>Famille</label>
        <input class="input-field" id="rec-famille" value="${r?.famille||''}" placeholder="${rType === 'cuisine' ? 'Soupe, Rôti, Pâtisserie...' : rType === 'potion' ? 'Soin, Élixir, Alchimie...' : 'Famille, catégorie...'}">
      </div>` : ''}
      ${!isCraft ? `
      <div class="form-group">
        <label>Durée / Préparation</label>
        <input class="input-field" id="rec-duree" value="${r?.duree||''}" placeholder="1 heure, 10 min...">
      </div>` : ''}
      ${craftFields}
    </div>

    <div class="form-group rec-linked-control" id="rec-output-picker">
      <div class="rec-output-heading">
        <span class="rec-output-heading-icon">📦</span>
        <div><strong>Objet produit en cas de réussite</strong><small>Choisis l’objet existant qui sera ajouté à l’inventaire lors du craft dans le VTT.</small></div>
        <span class="rec-output-status ${linkedItemId ? 'is-linked' : ''}">${linkedItemId ? 'Objet lié' : 'À définir'}</span>
      </div>
      <input type="hidden" id="rec-shopItemId" value="${_esc(linkedItemId)}">
      <input type="text" class="input-field" id="rec-shop-filter" placeholder="🔍 Rechercher l’objet produit…"
        data-input="_recShopFilter" style="margin-bottom:.4rem" autocomplete="off">
      <div class="rec-shop-picker" id="rec-shop-options">${_shopItemOptionsHtml(linkedItemId)}</div>
      <div class="rec-linked-select-row"><span>${STORE.shopItems.length} objet${STORE.shopItems.length !== 1 ? 's' : ''} disponible${STORE.shopItems.length !== 1 ? 's' : ''}</span><button type="button" class="btn btn-outline btn-sm" data-action="_recClearLinkedShop" ${linkedItemId ? "" : "disabled"}>Retirer le lien</button></div>
      <div id="rec-linked-preview">${_linkedShopPreviewHtml(linkedItemId)}</div>
    </div>

    <!-- Ingrédients / Matériaux -->
    <div class="form-group">
      <label style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem">
        ${isCraft ? '🔩 Matériaux requis' : '🌿 Ingrédients'}
        <button type="button" data-action="_recAddIngr"
          style="font-size:.72rem;background:rgba(34,195,142,.08);border:1px solid rgba(34,195,142,.3);
          border-radius:6px;padding:2px 10px;cursor:pointer;color:#22c38e;font-weight:500">
          + Ajouter
        </button>
      </label>
      <div id="rec-ingr-list" style="display:flex;flex-direction:column;gap:.35rem">
        ${ingrs.map((ig, i) => _ingrRow(ig, i)).join('')}
      </div>
    </div>

    <div class="form-group">
      <label>✨ Effet / Résultat</label>
      <textarea class="input-field" id="rec-effet" rows="2"
        placeholder="${isCraft ? 'Stats de l\'objet crafté, propriétés spéciales...' : 'Rend 3D6 PV...'}"
      >${r?.effet||''}</textarea>
    </div>
    <div class="form-group">
      <label>Description / Notes <span style="color:var(--text-dim);font-weight:400">(opt.)</span></label>
      <textarea class="input-field" id="rec-desc" rows="2"
        placeholder="Contexte, conditions, notes..."
      >${r?.description||''}</textarea>
    </div>

    <button class="btn btn-gold" style="width:100%;margin-top:.25rem" data-action="_recSave" data-id="${id}" data-type="${rType}">
      ${r ? 'Enregistrer' : 'Créer la recette'}
    </button>
  `);
}

function openRecipeOutputPicker(type, id) {
  openRecipeModal(type, id);
  requestAnimationFrame(() => {
    const section = document.getElementById('rec-output-picker');
    const search = document.getElementById('rec-shop-filter');
    section?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    section?.classList.add('is-guided');
    setTimeout(() => section?.classList.remove('is-guided'), 1400);
    search?.focus({ preventScroll: true });
  });
}

function openCharacterRecipeCreatePicker(characterId) {
  return openRecipesModal({ charId: characterId, access: true, create: true });
  // eslint-disable-next-line no-unreachable -- ancien sélecteur, retiré en nettoyage
  if (!_isAdmin()) return;
  const character = (STATE.characters || []).find(item => item.id === characterId);
  openModal('Nouvelle recette', `
    <div class="rec-create-picker">
      <header>
        <span>Création MJ</span>
        <strong>Quel type de recette voulez-vous ajouter ?</strong>
        <p>La recette sera ajoutée au catalogue${character?.nom ? ` et connue automatiquement par ${_esc(character.nom)}` : ''}.</p>
      </header>
      <div class="rec-create-options">
        ${CREATE_RECIPES.map(t => `
        <button type="button" data-action="createCharacterRecipe" data-type="${t.id}" data-id="${_esc(characterId)}">
          <span aria-hidden="true">${t.emoji}</span><strong>${_esc(t.label)}</strong>
          <small>${_esc(CREATE_DESC[t.id] || 'Ingrédients, préparation et effet.')}</small>
        </button>`).join('')}
      </div>
      <p class="rec-create-hint">Les recettes d'armes, d'armures et de bijoux sont créées depuis les objets correspondants de la Boutique.</p>
    </div>`, { icon: '＋', subtitle: 'Ajouter une recette au catalogue', accent: '#e8b84b' });
}

function _ingrRow(ig = {}, i) {
  const linked = !!((ig.shopItemId && _findShopItem(ig.shopItemId))
    || (ig.nom && STORE.shopItems.some(it => _norm(it.nom) === _norm(ig.nom))));
  return `<div class="rec-ingr-dyn" id="rec-ig-${i}" data-shop-id="${_esc(ig.shopItemId||'')}"
    style="display:flex;align-items:center;gap:.4rem;background:var(--bg-elevated);
    border-radius:8px;padding:.4rem .6rem;border:1px solid var(--border)">
    <input class="input-field" id="rec-ig-qty-${i}" value="${_esc(ig.quantite||'')}"
      placeholder="Qté" style="width:70px;flex-shrink:0;font-size:.78rem;padding:4px 6px">
    <input class="input-field" id="rec-ig-nom-${i}" value="${_esc(ig.nom||'')}"
      placeholder="Nom de l’ingrédient…"
      data-input="_recIngrCheckLink" data-idx="${i}" style="flex:1;font-size:.78rem;padding:4px 6px">
    <button type="button" class="rec-ig-pick" data-action="_recIngrPick" data-idx="${i}"
      title="Choisir un objet de la boutique">🔍</button>
    <span class="rec-ig-link ${linked ? 'is-on' : ''}" id="rec-ig-link-${i}"
      title="Objet boutique reconnu — le « fabricable » se basera dessus">🔗</span>
    <button type="button" data-action="_recRemIngr" data-idx="${i}"
      style="color:#ff6b6b;background:none;border:none;cursor:pointer;font-size:.9rem;padding:0 4px;flex-shrink:0">✕</button>
  </div>`;
}

// Édition manuelle du nom → on repart de la correspondance par nom (on efface le
// lien explicite éventuel pour éviter un id périmé qui ne collerait plus au texte).
function _recIngrCheckLink(el) {
  const idx = el.dataset.idx;
  document.getElementById(`rec-ig-${idx}`)?.removeAttribute('data-shop-id');
  const linked = !!STORE.shopItems.find(it => _norm(it.nom) === _norm(el.value || ''));
  document.getElementById(`rec-ig-link-${idx}`)?.classList.toggle('is-on', linked);
}

// ── Sélecteur d'ingrédient (objet boutique) — recherche, scale à 200+ objets ──
let _ingrPickIdx = null;   // ligne ciblée pendant que le picker est ouvert
let _ingrPick    = null;   // { idx, itemId } choisi, appliqué après restauration

function _ingrPickOptionsHtml(query = '') {
  const q = (query || '').trim();
  const items = STORE.shopItems.filter(it => !q || _searchIncludes(`${it.nom || ''} ${_shopItemKind(it)}`, q));
  if (!items.length) return `<div class="rec-shop-picker-empty">Aucun objet ne correspond à cette recherche.</div>`;
  return items.map(it => `<button type="button" class="rec-shop-picker-option"
      data-action="_recIngrPickChoose" data-id="${_esc(it.id)}">
      ${it.image ? `<img src="${_esc(it.image)}" alt="">` : `<span class="rec-shop-picker-fallback">📦</span>`}
      <span><strong>${_esc(it.nom || 'Objet sans nom')}</strong><small>${_esc(_shopItemKind(it))}</small></span>
    </button>`).join('');
}

function openIngredientPicker(idx) {
  _ingrPickIdx = idx;
  _ingrPick = null;
  // Empilé au-dessus de l'éditeur : à la fermeture, popModal restaure le
  // formulaire de fond puis appelle notre callback qui applique le choix.
  pushModal('Choisir un ingrédient', `
    <div class="rec-ingr-picker">
      <input type="text" class="input-field" id="rec-ingr-pick-filter" autocomplete="off"
        placeholder="🔍 Rechercher un objet de la boutique…" data-input="_recIngrPickFilter">
      <div class="rec-shop-picker rec-shop-picker--modal" id="rec-ingr-pick-options">${_ingrPickOptionsHtml('')}</div>
    </div>`, () => _applyPendingIngredientPick(),
    { icon: '🌿', subtitle: 'Lie l’ingrédient à un objet de la boutique', accent: '#22c38e' });
  requestAnimationFrame(() => document.getElementById('rec-ingr-pick-filter')?.focus({ preventScroll: true }));
}

function _recIngrPickFilter(query) {
  const list = document.getElementById('rec-ingr-pick-options');
  if (list) list.innerHTML = _ingrPickOptionsHtml(query);
}

function chooseIngredientFromPicker(itemId) {
  if (_findShopItem(itemId) && _ingrPickIdx != null) _ingrPick = { idx: _ingrPickIdx, itemId };
  _ingrPickIdx = null;
  closeModalDirect(); // ferme le picker → restaure l'éditeur → _applyPendingIngredientPick
}

function _applyPendingIngredientPick() {
  const pick = _ingrPick; _ingrPick = null;
  if (!pick) return; // annulation (Escape/✕) : rien à appliquer
  const item = _findShopItem(pick.itemId);
  const row  = document.getElementById(`rec-ig-${pick.idx}`);
  if (!item || !row) return;
  row.dataset.shopId = pick.itemId;
  const nom = row.querySelector('input[id^="rec-ig-nom-"]');
  if (nom) nom.value = item.nom || '';
  const qty = row.querySelector('input[id^="rec-ig-qty-"]');
  if (qty && !qty.value.trim()) qty.value = '1';
  row.querySelector('.rec-ig-link')?.classList.add('is-on');
}

function addIngredientRow() {
  const list = document.getElementById('rec-ingr-list');
  if (!list) return;
  const i = list.querySelectorAll('.rec-ingr-dyn').length;
  const div = document.createElement('div');
  div.innerHTML = _ingrRow({}, i);
  list.appendChild(div.firstElementChild);
}

function removeIngredientRow(i) { document.getElementById(`rec-ig-${i}`)?.remove(); }

function _readIngrs() {
  // Lecture par LIGNE (pas par index global) → robuste après suppression d'une
  // ligne. Résout un lien explicite vers l'objet boutique (shopItemId) quand le
  // nom correspond à un article : le « fabricable » se base alors sur l'id exact
  // de l'objet en inventaire, plus sur une simple comparaison de texte.
  return [...document.querySelectorAll('#rec-ingr-list .rec-ingr-dyn')].map(row => {
    const nom = row.querySelector('input[id^="rec-ig-nom-"]')?.value?.trim() || '';
    const qty = row.querySelector('input[id^="rec-ig-qty-"]')?.value?.trim() || '';
    // Lien explicite (choisi via le sélecteur) prioritaire ; sinon repli sur la
    // correspondance par nom pour les anciennes recettes / saisies libres.
    const explicit = row.dataset.shopId || '';
    const match = explicit
      ? _findShopItem(explicit)
      : (nom ? STORE.shopItems.find(it => _norm(it.nom) === _norm(nom)) : null);
    return { quantite: qty, nom, shopItemId: match?.id || '' };
  }).filter(ig => ig.nom);
}

// ══════════════════════════════════════════════════════════════════════════════
// SAUVEGARDER / SUPPRIMER
// ══════════════════════════════════════════════════════════════════════════════
async function saveRecipe(id, fallbackType) {
  try {
    const nom = document.getElementById('rec-nom')?.value?.trim();
    if (!nom) { showNotif('Le nom est requis.', 'error'); return; }

    const existing = id ? STORE.all.find(r => r.id === id) : null;
    // Type éditable pour les recettes non-craft (cuisine ↔ potion) via le sélecteur.
    const pickedType = document.getElementById('rec-type')?.value;
    const type = (pickedType && CREATE_RECIPES.some(t => t.id === pickedType))
      ? pickedType
      : (existing?.type || fallbackType || 'cuisine');

    const returnCharacter = _recipeReturnCharacterId
      ? (STATE.characters || []).find(character => character.id === _recipeReturnCharacterId)
      : null;
    const data = {
      type, nom,
      famille:     document.getElementById('rec-famille')?.value?.trim()   || '',
      duree:       document.getElementById('rec-duree')?.value?.trim()     || '',
      effet:       document.getElementById('rec-effet')?.value?.trim()     || '',
      description: document.getElementById('rec-desc')?.value?.trim()     || '',
      ingredients: _readIngrs(),
      acces:       existing?.acces || (returnCharacter?.uid ? [returnCharacter.uid] : []),
      atelierReq:  document.getElementById('rec-atelierReq')?.value?.trim()|| '',
      tempsCraft:  document.getElementById('rec-tempsCraft')?.value?.trim()|| '',
      shopItemId:  document.getElementById("rec-shopItemId")?.value || "",
    };

    if (id) {
      await updateInCol('recipes', id, data);
      const idx = STORE.all.findIndex(r => r.id === id);
      if (idx >= 0) STORE.all[idx] = { ...data, id };
    } else {
      const newId = await addToCol('recipes', data);
      if (typeof newId === 'string') STORE.all.push({ ...data, id: newId });
      else STORE.all = await loadCollection('recipes');
      STORE.all.sort((a, b) => (a.nom||'').localeCompare(b.nom||''));
    }

    const returnCharacterId = _recipeReturnCharacterId;
    _recipeReturnCharacterId = '';
    closeModal();
    showNotif(id ? `"${nom}" mis à jour !` : `"${nom}" créé !`, 'success');
    STORE.tab = data.type;
    if (returnCharacterId) await openCharacterRecipeAccess(returnCharacterId);
    else _render();
  } catch (e) { notifySaveError(e); }
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL SHOP — Modifier / Supprimer une recette issue de la boutique
// ══════════════════════════════════════════════════════════════════════════════
function openShopRecipeModal(id) {
  const item = STORE.shopItems.find(i => i.id === id);
  if (!item) return;
  const r    = _shopToRecipe(item);
  if (!r)    return;
  const tab  = TABS.find(t => t.id === r.type) || TABS[0];
  const ingrs = r.ingredients.length
    ? r.ingredients
    : [{ nom:'', quantite:'' }, { nom:'', quantite:'' }];

  openModal(`${tab.emoji} Modifier recette — ${r.nom}`, `
    <!-- Infos boutique (lecture seule) -->
    <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;
      padding:.6rem .85rem;margin-bottom:.85rem">
      <div style="font-size:.68rem;color:var(--text-dim);margin-bottom:.4rem;letter-spacing:1px;text-transform:uppercase">🏪 Depuis la boutique</div>
      <div style="display:flex;flex-wrap:wrap;gap:.3rem">
        ${r.typeObjet ? `<span class="rec-stat">📦 ${r.typeObjet}</span>` : ''}
        ${r.format    ? `<span class="rec-stat">${r.format.replace('Arme ','').replace(' Phy.','').replace(' Mag.',' ✨')}</span>` : ''}
        ${r.rarete    ? _rareteTag(r.rarete, 'rec-stat') : ''}
        ${r.degats    ? `<span class="rec-stat">⚔️ ${r.degats}</span>` : ''}
        ${r.caBonus   ? `<span class="rec-stat rec-stat-ca">🛡️ +${r.caBonus} CA</span>` : ''}
      </div>
    </div>

    <!-- Champs craft éditables -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:.75rem">
      <div class="form-group">
        <label>Atelier requis</label>
        <input class="input-field" id="srec-atelierReq" value="${r.atelierReq||''}" placeholder="Forge...">
      </div>
      <div class="form-group">
        <label>Temps de craft</label>
        <input class="input-field" id="srec-tempsCraft" value="${r.tempsCraft||''}" placeholder="3 jours...">
      </div>
    </div>

    <div class="form-group">
      <label style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem">
        🔩 Matériaux requis
        <button type="button" data-action="_recAddIngr"
          style="font-size:.72rem;background:rgba(34,195,142,.08);border:1px solid rgba(34,195,142,.3);
          border-radius:6px;padding:2px 10px;cursor:pointer;color:#22c38e;font-weight:500">+ Ajouter</button>
      </label>
      <div id="rec-ingr-list" style="display:flex;flex-direction:column;gap:.35rem">
        ${ingrs.map((ig, i) => _ingrRow(ig, i)).join('')}
      </div>
    </div>

    <div class="form-group">
      <label>✨ Effet / Notes</label>
      <textarea class="input-field" id="srec-effet" rows="2"
        placeholder="Propriétés spéciales, conditions...">${r.effet||''}</textarea>
    </div>
    <div class="form-group">
      <label>Description <span style="color:var(--text-dim);font-weight:400">(opt.)</span></label>
      <textarea class="input-field" id="srec-desc" rows="2"
        placeholder="Contexte, notes...">${r.description||''}</textarea>
    </div>

    <button class="btn btn-gold" style="width:100%;margin-top:.25rem" data-action="saveShopRecipe" data-id="${id}">
      Enregistrer
    </button>
  `);
}

async function saveShopRecipe(id) {
  const recipeMeta = {
    atelierReq:  document.getElementById('srec-atelierReq')?.value?.trim() || '',
    tempsCraft:  document.getElementById('srec-tempsCraft')?.value?.trim() || '',
    ingredients: _readIngrs(),
    effet:       document.getElementById('srec-effet')?.value?.trim()      || '',
    description: document.getElementById('srec-desc')?.value?.trim()       || '',
  };

  const returnCharacterId = _recipeReturnCharacterId;
  _recipeReturnCharacterId = '';
  if (await trySave('shop', id, { recipeMeta })) {
    const idx = STORE.shopItems.findIndex(i => i.id === id);
    if (idx >= 0) STORE.shopItems[idx].recipeMeta = recipeMeta;
    closeModal();
    showNotif('Recette mise à jour !', 'success');
    if (returnCharacterId) { await openCharacterRecipeAccess(returnCharacterId); return; }
  }
  _render();
}

async function deleteShopRecipe(id) {
  const item = STORE.shopItems.find(i => i.id === id);
  if (!await confirmModal(`Retirer "${item?.nom||'cet objet'}" des recettes ? L'objet restera dans la boutique.`)) return;

  const recipeMeta = { ...(item?.recipeMeta || {}), hidden: true };
  if (await trySave('shop', id, { recipeMeta, acces: [] })) {
    const idx = STORE.shopItems.findIndex(i => i.id === id);
    if (idx >= 0) {
      STORE.shopItems[idx].recipeMeta = recipeMeta;
      STORE.shopItems[idx].acces = [];
    }
    showNotif('Recette retirée.', 'success');
  }
  _render();
}

async function deleteRecipe(id) {
  try {
    const r = STORE.all.find(x => x.id === id);
    if (!await confirmDelete('recipes', id, `Supprimer "${r?.nom||'cette recette'}" ?`, {
      snapshot: r,
      successMessage: 'Recette supprimée.',
      onRestore: (restored) => { STORE.all.push(restored); _render(); },
    })) return;
    STORE.all = STORE.all.filter(x => x.id !== id);
    _render();
  } catch (e) { notifySaveError(e); }
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL ACCÈS — Admin donne accès aux joueurs
// ══════════════════════════════════════════════════════════════════════════════
function openAccesModal(id) {
  const r = _findRaw(id);
  if (!r) return;
  const joueurs   = _getJoueurs();
  const accesUids = r.acces || [];

  if (!joueurs.length) { showNotif('Aucun joueur trouvé.', 'error'); return; }

  openModal(`👥 Accès — ${r.nom}`, `
    <div style="font-size:.8rem;color:var(--text-dim);margin-bottom:.85rem">
      Coche les joueurs qui ont accès à cette recette.
    </div>
    <div style="display:flex;flex-direction:column;gap:.4rem" id="acces-list">
      ${joueurs.map(j => `
        <label style="display:flex;align-items:center;gap:.75rem;padding:.6rem .85rem;
          border-radius:10px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer"
          data-hov-border="#22c38e" data-hov-bg="rgba(34,195,142,.06)">
          <input type="checkbox" value="${j.uid}" ${accesUids.includes(j.uid)?'checked':''}
            style="accent-color:#22c38e;width:16px;height:16px">
          <span style="font-size:.84rem;color:var(--text)">${j.pseudo}</span>
          ${accesUids.includes(j.uid) ? `<span style="margin-left:auto;font-size:.65rem;color:#22c38e">✓ Actif</span>` : ''}
        </label>`).join('')}
    </div>
    <div style="display:flex;gap:.5rem;margin-top:.85rem">
      <button class="btn btn-gold" style="flex:1" data-action="saveAcces" data-id="${id}">✓ Enregistrer</button>
      <button class="btn btn-outline btn-sm" data-action="_recClose">Annuler</button>
    </div>
  `);
}

async function saveAcces(id) {
  const checks    = [...document.querySelectorAll('#acces-list input[type="checkbox"]')];
  const newAcces  = checks.filter(c => c.checked).map(c => c.value);
  const isShop    = _isShopItem(id);
  if (await trySave(isShop ? 'shop' : 'recipes', id, { acces: newAcces })) {
    const list      = isShop ? STORE.shopItems : STORE.all;
    const idx       = list.findIndex(x => x.id === id);
    if (idx >= 0) list[idx].acces = newAcces;
    closeModal();
    showNotif(`Accès mis à jour — ${newAcces.length} joueur${newAcces.length>1?'s':''}.`, 'success');
  }
  _render();
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL ENVOI — Joueur transmet une recette (perd son accès)
// ══════════════════════════════════════════════════════════════════════════════
function openSendRecipeModal(id) {
  const r = _findRaw(id);
  if (!r) return;
  const uid       = _myUid();
  const joueurs   = _getJoueurs();
  const accesUids = r.acces || [];
  const type      = TABS.find(tab => tab.id === r.type) || TABS[0];

  // Destinataires : joueurs qui n'ont PAS encore la recette (sauf l'envoyeur)
  const cibles = joueurs.filter(j => j.uid !== uid && !accesUids.includes(j.uid));
  if (!cibles.length) { showNotif('Tous les joueurs ont déjà cette recette.', 'success'); return; }

  openModal(`↗ Transmettre — ${r.nom}`, `
    <div class="rec-send-recipe">
      <span class="rec-book-icon">${type.emoji}</span>
      <div><small>Recette transmise</small><strong>${_esc(r.nom || 'Recette')}</strong><span>${_esc(type.label || r.type || 'Recette')}</span></div>
    </div>
    <div style="background:rgba(255,107,107,.06);border:1px solid rgba(255,107,107,.2);border-radius:10px;
      padding:.6rem .85rem;margin-bottom:.85rem;font-size:.8rem;color:var(--text-muted)">
      ⚠️ En transmettant cette recette, <strong style="color:#ff6b6b">tu n'y auras plus accès</strong>. Elle appartient désormais à l'autre joueur.
    </div>
    <div style="font-size:.8rem;color:var(--text-dim);margin-bottom:.6rem">Choisir le destinataire :</div>
    <div style="display:flex;flex-direction:column;gap:.4rem">
      ${cibles.map(j => `
        <label style="display:flex;align-items:center;gap:.75rem;padding:.65rem .9rem;
          border-radius:10px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer"
          data-hov-border="#4f8cff" data-hov-bg="rgba(79,140,255,.06)">
          <input type="radio" name="send-rec-target" value="${j.uid}" style="accent-color:#4f8cff">
          <span style="font-size:.84rem;color:var(--text)">${j.pseudo}</span>
        </label>`).join('')}
    </div>
    <div style="display:flex;gap:.5rem;margin-top:.85rem">
      <button class="btn btn-gold" style="flex:1" data-action="sendRecipe" data-id="${id}">↗ Transmettre définitivement</button>
      <button class="btn btn-outline btn-sm" data-action="_recClose">Annuler</button>
    </div>
  `);
}

async function sendRecipe(id) {
  const targetUid = document.querySelector('input[name="send-rec-target"]:checked')?.value;
  if (!targetUid) { showNotif('Sélectionne un joueur.', 'error'); return; }

  const r = _findRaw(id);
  if (!r) return;

  const uid = _myUid();

  // Retirer l'envoyeur, ajouter le destinataire
  const newAcces = [...new Set([
    ...(r.acces || []).filter(u => u !== uid),
    targetUid,
  ])];

  if (await trySave(_isShopItem(id) ? 'shop' : 'recipes', id, { acces: newAcces })) {
    r.acces = newAcces;
    const targetName = _getJoueurs().find(j => j.uid === targetUid)?.pseudo || 'ce joueur';
    closeModal();
    showNotif(`"${r.nom}" transmise à ${targetName}. Tu n'y as plus accès.`, 'success');
  }
  _render();
}

// ══════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════════
function _allRecipeEntries() {
  return [
    ...STORE.all.map(r => ({ ...r, _source: 'recipes' })),
    ...STORE.shopItems.map(_shopToRecipe).filter(Boolean).map(r => ({ ...r, _source: 'shop' })),
  ].sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }));
}

function _inventoryCounts(character) {
  // Deux index : par nom normalisé (compat) ET par id d'objet boutique
  // (les objets d'inventaire issus de la boutique portent `itemId`).
  const byName = new Map();
  const byId = new Map();
  (character?.inventaire || []).forEach(item => {
    const q = Math.max(1, parseInt(item.quantite || item.qte || 1) || 1);
    const key = _norm(item?.nom || '');
    if (key) byName.set(key, (byName.get(key) || 0) + q);
    const iid = item?.itemId || '';
    if (iid) byId.set(iid, (byId.get(iid) || 0) + q);
  });
  return { byName, byId };
}

function _ingredientState(recipe, counts) {
  return (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).map(ingredient => {
    const required = Math.max(1, parseInt(ingredient.quantite) || 1);
    // Lien explicite d'abord (id exact), sinon repli sur le nom (anciennes recettes).
    const owned = ingredient.shopItemId
      ? (counts.byId.get(ingredient.shopItemId) || 0)
      : (counts.byName.get(_norm(ingredient.nom || '')) || 0);
    return { ...ingredient, required, owned, ready: owned >= required };
  });
}

function _recipeBookCard(recipe, character, canTransfer) {
  const type = TABS.find(tab => tab.id === recipe.type) || TABS[0];
  const ingredients = _ingredientState(recipe, _inventoryCounts(character));
  const ready = ingredients.length > 0 && ingredients.every(item => item.ready);
  const availability = ingredients.length ? (ready ? 'ready' : 'missing') : 'neutral';
  const output = _linkedShopItem(recipe);
  return `<article class="rec-book-card" data-rec-book-row data-type="${_esc(recipe.type || '')}" data-ready="${availability}" data-search="${_esc(_recipeSearchText(recipe))}">
    <header><span class="rec-book-icon">${type.emoji}</span><div class="rec-book-identity"><strong class="rec-book-name">${_esc(recipe.nom || 'Recette')}</strong><small>${_esc(type.label || recipe.type || 'Recette')}</small></div>
      ${ingredients.length ? `<span class="rec-book-ready ${ready ? 'is-ready' : ''}">${ready ? 'Prête' : 'Ingrédients manquants'}</span>` : ''}</header>
    ${recipe.effet ? `<p class="rec-book-effect">${_esc(recipe.effet)}</p>` : ''}
    ${output ? `<div class="rec-book-output"><span>Objet produit</span><strong>${_esc(output.nom || recipe.nom || 'Objet')}</strong></div>` : `<div class="rec-book-output is-missing"><span>Résultat</span><strong>Objet non lié</strong></div>`}
    ${ingredients.length ? `<div class="rec-book-ingredients">${ingredients.map(item => `<span class="${item.ready ? 'is-ready' : 'is-missing'}"><b>${item.owned}/${item.required}</b> ${_esc(item.nom || 'Ingrédient')}</span>`).join('')}</div>` : '<p class="rec-book-empty-note">Aucun ingrédient renseigné.</p>'}
    <footer><span>${_esc(recipe.atelierReq || '')}</span><div class="rec-book-actions">${canTransfer ? `<button class="btn btn-outline btn-sm" data-action="openSendRecipeModal" data-id="${_esc(recipe.id)}">Transmettre</button>` : ''}</div></footer>
  </article>`;
}

function _recipeTypeNav(recipes, scope) {
  const counts = recipes.reduce((map, recipe) => {
    map[recipe.type] = (map[recipe.type] || 0) + 1;
    return map;
  }, {});
  return `<nav class="rec-context-nav" aria-label="Catégories de recettes">
    <button class="is-active" data-action="setCharacterRecipeType" data-scope="${scope}" data-type="all" aria-pressed="true"><span>📚</span><b>Toutes</b><em>${recipes.length}</em></button>
    ${TABS.filter(tab => tab.id !== 'all' && counts[tab.id]).map(tab => `<button data-action="setCharacterRecipeType" data-scope="${scope}" data-type="${tab.id}" aria-pressed="false"><span>${tab.emoji}</span><b>${_esc(tab.label)}</b><em>${counts[tab.id]}</em></button>`).join('')}
  </nav>`;
}

export function recipeBookButton(character) {
  return `<button class="inv-recipe-trigger" data-action="openCharacterRecipeBook" data-id="${_esc(character?.id || '')}" title="Voir les recettes connues"><span aria-hidden="true">📖</span><b>Recettes</b></button>`;
}

export async function openCharacterRecipeBook(characterId) {
  return openRecipesModal({ charId: characterId });
  // eslint-disable-next-line no-unreachable -- ancien livre, retiré en nettoyage
  await _ensureRecipeData();
  const character = (STATE.characters || []).find(c => c.id === characterId);
  if (!character) return;
  const uid = character.uid || (character.id === STATE.activeChar?.id ? _myUid() : '');
  const recipes = _allRecipeEntries().filter(recipe => uid && (recipe.acces || []).includes(uid));
  const canTransfer = !_isAdmin() && canControlCharacter(character);
  openModal(`Recettes de ${character.nom || 'ce personnage'}`, `
    <div class="rec-book-shell">
      <header class="rec-book-head"><div><span>Livre de recettes</span><strong>${recipes.length} recette${recipes.length !== 1 ? 's' : ''} connue${recipes.length !== 1 ? 's' : ''}</strong></div>
        ${_isAdmin() ? `<button class="btn btn-gold btn-sm" data-action="openCharacterRecipeAccess" data-id="${_esc(character.id)}">Gérer les recettes connues</button>` : ''}</header>
      <div class="rec-book-controls">
        <label class="rec-book-search"><span aria-hidden="true">⌕</span><input type="search" data-input="filterCharacterRecipeBook" aria-label="Rechercher une recette ou un ingrédient" placeholder="Rechercher une recette ou un ingrédient…"></label>
        <div class="rec-ready-filter" role="group" aria-label="Disponibilité des ingrédients">
          <button class="is-active" data-action="setCharacterRecipeStatus" data-scope="book" data-status="all" aria-pressed="true">Toutes</button>
          <button data-action="setCharacterRecipeStatus" data-scope="book" data-status="ready" aria-pressed="false">Fabricables</button>
          <button data-action="setCharacterRecipeStatus" data-scope="book" data-status="missing" aria-pressed="false">À compléter</button>
        </div>
      </div>
      <div class="rec-context-layout">${_recipeTypeNav(recipes, 'book')}<div class="rec-book-grid">${recipes.length ? recipes.map(recipe => _recipeBookCard(recipe, character, canTransfer)).join('') : '<div class="rec-book-empty">Aucune recette connue pour le moment.</div>'}<div class="rec-context-empty" hidden>Aucune recette ne correspond à ces filtres.</div></div></div>
    </div>`, { icon: '📖', subtitle: 'Recettes connues et ingrédients disponibles', accent: '#e8b84b' });
}

export async function openCharacterRecipeAccess(characterId) {
  return openRecipesModal({ charId: characterId, access: true });
  // eslint-disable-next-line no-unreachable -- ancien panneau d'accès, retiré en nettoyage
  await _ensureRecipeData();
  if (!_isAdmin()) return;
  const character = (STATE.characters || []).find(c => c.id === characterId);
  if (!character?.uid) { showNotif('Ce personnage doit être lié à un compte pour recevoir des recettes.', 'error'); return; }
  const recipes = _allRecipeEntries();
  const knownCount = recipes.filter(recipe => (recipe.acces || []).includes(character.uid)).length;
  openModal(`Recettes connues · ${character.nom || 'Personnage'}`, `
    <div class="rec-access-shell">
      <header><div><span>Attribution MJ</span><strong>Cochez les recettes accessibles à ce compte.</strong></div><div class="rec-access-head-actions"><small id="rec-access-count">${knownCount}/${recipes.length} connues</small><button class="btn btn-gold btn-sm" data-action="openCharacterRecipeCreatePicker" data-id="${_esc(character.id)}">＋ Nouvelle recette</button></div></header>
      <label class="rec-book-search"><span aria-hidden="true">⌕</span><input data-input="filterCharacterRecipeAccess" placeholder="Filtrer le catalogue…"></label>
      <div class="rec-context-layout">${_recipeTypeNav(recipes, 'access')}<div class="rec-access-list">${recipes.map(recipe => {
        const type = TABS.find(tab => tab.id === recipe.type) || TABS[0];
        const output = _linkedShopItem(recipe);
        return `<div class="rec-access-row" data-rec-access-row data-type="${_esc(recipe.type || '')}" data-search="${_esc(_recipeSearchText(recipe))}">
          <label class="rec-access-toggle"><input type="checkbox" data-change="updateCharacterRecipeAccessCount" data-recipe-id="${_esc(recipe.id)}" data-source="${recipe._source}" ${(recipe.acces || []).includes(character.uid) ? 'checked' : ''}><span class="rec-access-check"></span><span class="rec-book-icon">${type.emoji}</span><span class="rec-access-name"><strong title="${_esc(recipe.nom || 'Recette')}">${_esc(recipe.nom || 'Recette')}</strong><small>${_esc(type.label || recipe.type || '')}</small></span></label>
          ${recipe._source === 'recipes' ? `<button type="button" class="rec-access-output ${output ? 'is-linked' : ''}" data-action="openCharacterRecipeOutput" data-character-id="${_esc(character.id)}" data-recipe-id="${_esc(recipe.id)}"><span>${output ? 'Objet produit' : 'Résultat du craft'}</span><strong>${_esc(output?.nom || 'Lier un objet')}</strong><i aria-hidden="true">›</i></button>` : `<span class="rec-access-output is-native"><span>Objet produit</span><strong>${_esc(recipe.nom || 'Objet boutique')}</strong></span>`}
          ${recipe._source === 'recipes' ? `<button type="button" class="rec-access-edit" data-action="editRecipeFromAccess" data-character-id="${_esc(character.id)}" data-recipe-id="${_esc(recipe.id)}" title="Modifier cette recette">✏️</button>` : `<button type="button" class="rec-access-edit" data-action="editShopRecipeFromAccess" data-character-id="${_esc(character.id)}" data-recipe-id="${_esc(recipe.id)}" title="Modifier cette recette">✏️</button>`}
        </div>`;
      }).join('') || '<div class="rec-book-empty">Le catalogue est vide.</div>'}<div class="rec-context-empty" hidden>Aucune recette ne correspond à ces filtres.</div></div></div>
      <footer><button class="btn btn-outline" data-action="close-modal">Annuler</button><button class="btn btn-primary" data-action="saveCharacterRecipeAccess" data-id="${_esc(character.id)}">Enregistrer</button></footer>
    </div>`, { icon: '📚', subtitle: 'Accès du compte lié au personnage', accent: '#e8b84b' });
}

async function openCharacterRecipeOutput(characterId, recipeId) {
  await _ensureRecipeData();
  if (!_isAdmin()) return;
  const recipe = STORE.all.find(item => item.id === recipeId);
  const character = (STATE.characters || []).find(item => item.id === characterId);
  if (!recipe || !character) return;
  const linkedItemId = recipe.shopItemId || '';
  openModal(`Objet produit · ${recipe.nom || 'Recette'}`, `
    <div class="rec-output-modal">
      <header><span>Résultat du craft</span><strong>Quel objet doit recevoir ${_esc(character.nom || 'le personnage')} en cas de réussite ?</strong><p>Recherche un objet existant, puis clique sur sa ligne pour le sélectionner.</p></header>
      <input type="hidden" id="rec-shopItemId" value="${_esc(linkedItemId)}">
      <input type="text" class="input-field" id="rec-shop-filter" placeholder="🔍 Rechercher par nom ou type…" data-input="_recShopFilter" autocomplete="off">
      <div class="rec-shop-picker rec-shop-picker--modal" id="rec-shop-options">${_shopItemOptionsHtml(linkedItemId)}</div>
      <div id="rec-linked-preview">${_linkedShopPreviewHtml(linkedItemId)}</div>
      <footer><button type="button" class="btn btn-outline" data-action="close-modal">Annuler</button><button type="button" class="btn btn-primary" data-action="saveCharacterRecipeOutput" data-character-id="${_esc(characterId)}" data-recipe-id="${_esc(recipeId)}">Enregistrer l’objet produit</button></footer>
    </div>`, { icon: '📦', subtitle: 'Objet ajouté à l’inventaire après un craft réussi', accent: '#e8b84b' });
}

async function saveCharacterRecipeOutput(characterId, recipeId) {
  if (!_isAdmin()) return;
  const recipe = STORE.all.find(item => item.id === recipeId);
  const shopItemId = document.getElementById('rec-shopItemId')?.value || '';
  if (!recipe || !shopItemId || !_findShopItem(shopItemId)) {
    showNotif('Sélectionne l’objet produit avant d’enregistrer.', 'error');
    return;
  }
  try {
    await updateInCol('recipes', recipeId, { shopItemId });
    recipe.shopItemId = shopItemId;
    closeModal();
    showNotif(`Objet produit lié à « ${recipe.nom || 'la recette'} ».`, 'success');
    const restored = document.querySelector('.rec-access-shell');
    if (!restored) openCharacterRecipeAccess(characterId);
    else {
      const row = restored.querySelector(`[data-recipe-id="${CSS.escape(recipeId)}"]`)?.closest('.rec-access-row');
      const output = row?.querySelector('.rec-access-output');
      if (output) {
        output.classList.add('is-linked');
        output.querySelector('span').textContent = 'Objet produit';
        output.querySelector('strong').textContent = _findShopItem(shopItemId)?.nom || 'Objet lié';
      }
    }
  } catch (error) { notifySaveError(error); }
}

function _applyRecipeContextFilters(scope) {
  const shell = document.querySelector(scope === 'access' ? '.rec-access-shell' : '.rec-book-shell');
  if (!shell) return;
  const query = _norm(shell.querySelector('.rec-book-search input')?.value || '');
  const type = shell.querySelector('.rec-context-nav .is-active')?.dataset.type || 'all';
  const status = shell.querySelector('.rec-ready-filter .is-active')?.dataset.status || 'all';
  const rows = shell.querySelectorAll(scope === 'access' ? '[data-rec-access-row]' : '[data-rec-book-row]');
  rows.forEach(row => {
    const matchesText = !query || (row.dataset.search || '').includes(query);
    const matchesType = type === 'all' || row.dataset.type === type;
    const matchesStatus = status === 'all' || row.dataset.ready === status;
    row.hidden = !(matchesText && matchesType && matchesStatus);
  });
  const empty = shell.querySelector('.rec-context-empty');
  if (empty) empty.hidden = !rows.length || [...rows].some(row => !row.hidden);
}

function _setRecipeContextFilter(button, kind) {
  const shell = button.closest('.rec-book-shell, .rec-access-shell');
  if (!shell) return;
  const selector = kind === 'status' ? '.rec-ready-filter button' : '.rec-context-nav button';
  shell.querySelectorAll(selector).forEach((item) => {
    const active = item === button;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  _applyRecipeContextFilters(button.dataset.scope || (shell.classList.contains('rec-access-shell') ? 'access' : 'book'));
}

function _updateCharacterRecipeAccessCount() {
  const checks = [...document.querySelectorAll('.rec-access-row input[type="checkbox"]')];
  const count = checks.filter(check => check.checked).length;
  const target = document.getElementById('rec-access-count');
  if (target) target.textContent = `${count}/${checks.length} connues`;
}

async function saveCharacterRecipeAccess(characterId) {
  const character = (STATE.characters || []).find(c => c.id === characterId);
  if (!_isAdmin() || !character?.uid) return;
  const changes = [];
  document.querySelectorAll('.rec-access-row input[type="checkbox"]').forEach(check => {
    const list = check.dataset.source === 'shop' ? STORE.shopItems : STORE.all;
    const raw = list.find(item => item.id === check.dataset.recipeId);
    if (!raw) return;
    const current = Array.isArray(raw.acces) ? raw.acces : [];
    if (current.includes(character.uid) === check.checked) return;
    const acces = check.checked ? [...new Set([...current, character.uid])] : current.filter(uid => uid !== character.uid);
    changes.push({ source: check.dataset.source, raw, acces });
  });
  try {
    await Promise.all(changes.map(change => updateInCol(change.source, change.raw.id, { acces: change.acces })));
    changes.forEach(change => { change.raw.acces = change.acces; });
    showNotif(`${changes.length} accès mis à jour.`, 'success');
    openCharacterRecipeBook(characterId);
  } catch (error) { notifySaveError(error); }
}

function setRecipeTab(t) {
  if (!TABS.some(tab => tab.id === t)) return;
  STORE.tab = t;
  STORE.filterTxt = '';
  setRouteSub('recettes', t);
  _render();
}
function searchRecipes(v) { STORE.filterTxt = v; _renderGrid(); }

// ══════════════════════════════════════════════════════════════════════════════
// OVERRIDE + EXPORTS
// ══════════════════════════════════════════════════════════════════════════════
PAGES.recettes = renderRecipes;

registerActions({
  recSetTab: (btn) => setRecipeTab(btn.dataset.id),
  recSearch: (el) => searchRecipes(el.value),
  _recOpenModal: (btn) => { _recipeReturnCharacterId = ''; openRecipeModal(btn.dataset.type); },
  _recEdit: (btn) => openRecipeModal(btn.dataset.type, btn.dataset.id),
  _recEditShop: (btn) => openShopRecipeModal(btn.dataset.id),
  _recOpenOutputPicker: (btn) => openRecipeOutputPicker(btn.dataset.type, btn.dataset.id),
  _recDelete: (btn) => deleteRecipe(btn.dataset.id),
  _recDeleteShop: (btn) => deleteShopRecipe(btn.dataset.id),
  _recSave: (btn) => saveRecipe(btn.dataset.id, btn.dataset.type),
  _recAddIngr: () => addIngredientRow(),
  _recIngrCheckLink: (el) => _recIngrCheckLink(el),
  _recIngrPick: (btn) => openIngredientPicker(Number(btn.dataset.idx)),
  _recIngrPickFilter: (el) => _recIngrPickFilter(el.value),
  _recIngrPickChoose: (btn) => chooseIngredientFromPicker(btn.dataset.id),
  _recRemIngr: (btn) => removeIngredientRow(Number(btn.dataset.idx)),
  _recSelectLinkedShop: (btn) => selectLinkedShopItem(btn.dataset.id),
  _recShopFilter: (el) => _recFilterShopOptions(el.value),
  _recClearLinkedShop: () => clearLinkedShopItem(),
  saveShopRecipe: (btn) => saveShopRecipe(btn.dataset.id),
  openItemDetailModal: (btn) => openItemDetailModal(btn.dataset.id),
  openAccesModal: (btn) => openAccesModal(btn.dataset.id),
  saveAcces: (btn) => saveAcces(btn.dataset.id),
  openSendRecipeModal: (btn) => openSendRecipeModal(btn.dataset.id),
  sendRecipe: (btn) => sendRecipe(btn.dataset.id),
  openCharacterRecipeAccess: (btn) => openCharacterRecipeAccess(btn.dataset.id),
  openCharacterRecipeOutput: (btn) => openCharacterRecipeOutput(btn.dataset.characterId, btn.dataset.recipeId),
  editRecipeFromAccess: (btn) => {
    const rec = STORE.all.find(x => x.id === btn.dataset.recipeId);
    _recipeReturnCharacterId = btn.dataset.characterId || '';
    openRecipeModal(rec?.type || 'cuisine', btn.dataset.recipeId);
  },
  editShopRecipeFromAccess: (btn) => {
    _recipeReturnCharacterId = btn.dataset.characterId || '';
    openShopRecipeModal(btn.dataset.recipeId);
  },
  saveCharacterRecipeOutput: (btn) => saveCharacterRecipeOutput(btn.dataset.characterId, btn.dataset.recipeId),
  openCharacterRecipeCreatePicker: (btn) => openCharacterRecipeCreatePicker(btn.dataset.id),
  createCharacterRecipe: (btn) => { _recipeReturnCharacterId = btn.dataset.id || ''; openRecipeModal(btn.dataset.type); },
  saveCharacterRecipeAccess: (btn) => saveCharacterRecipeAccess(btn.dataset.id),
  filterCharacterRecipeBook: () => _applyRecipeContextFilters('book'),
  filterCharacterRecipeAccess: () => _applyRecipeContextFilters('access'),
  setCharacterRecipeType: (btn) => _setRecipeContextFilter(btn, 'type'),
  setCharacterRecipeStatus: (btn) => _setRecipeContextFilter(btn, 'status'),
  updateCharacterRecipeAccessCount: () => _updateCharacterRecipeAccessCount(),
  _recClose: () => closeModal(),
});

// ══════════════════════════════════════════════════════════════════════════
// Recettes v2 — modale unique à deux volets (liste + fiche).
// MJ : édition directe, enregistrement auto. Joueur : livre + transmission.
// Remplace openCharacterRecipeBook/Access/CreatePicker et les 6 sous-modales.
// Deux sources conservées (décision B) : recettes `recipes` + recettes
// virtuelles de la boutique (`_shopToRecipe`, écrites dans `shop.recipeMeta`).
// ══════════════════════════════════════════════════════════════════════════
const RC_EDIT_TYPES = TABS.filter(t => ['cuisine', 'potion', 'forge', 'orfevre', 'confection'].includes(t.id));
const RC_TYPE_HINT = {
  cuisine: 'Avant mission, bénéficie au groupe.', potion: 'Effets individuels à boire.',
  forge: 'Armes et pièces de métal.', orfevre: 'Bijoux et objets précieux.', confection: 'Vêtements et armures souples.',
};
const RC_ATELIER = {
  cuisine: 'Feu de camp / cuisine', potion: 'Table d’alchimie', forge: 'Forge',
  orfevre: 'Atelier d’orfèvre', confection: 'Atelier de couture',
};
const RC = { view: 'mj', meUid: '', sel: '', q: '', type: 'all', forUid: '', readyOnly: false, pane: 'list',
  cb: null, cbQ: '', cbI: 0, send: false, sendTo: null, saveTimers: new Map() };

const _rcColor = uid => { let h = 0; const s = String(uid || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return `hsl(${h % 360} 52% 56%)`; };
function _rcPlayers() {
  const seen = new Map();
  (STATE.characters || []).forEach(c => { if (c?.uid && !seen.has(c.uid)) seen.set(c.uid, c); });
  return [...seen.values()].map(c => ({ uid: c.uid, perso: c.nom || '?', pseudo: c.ownerPseudo || c.nom || c.uid, color: _rcColor(c.uid), char: c }));
}
const _rcP = uid => _rcPlayers().find(p => p.uid === uid) || null;
const _rcCharForUid = uid => (STATE.characters || []).find(c => c.uid === uid) || null;
const _rcAv = (p, sz = '') => `<i class="rc-av ${sz}" style="--c:${p.color}" title="${_esc(p.perso)} · ${_esc(p.pseudo)}">${_esc((p.perso[0] || '?').toUpperCase())}</i>`;
const _rcIsMJ = () => RC.view === 'mj' && _isAdmin();
const _rcT = id => TABS.find(t => t.id === id) || TABS[1];
const _rcShopCatLabel = item => _findShopCat(item?.categorieId)?.nom || item?.categorie || item?.sousType || item?.template || 'Objet';
const _rcIngredientish = item => /composant|ingredient|ingrédient|materiau|matériau|ressource|herbe|plante|minerai|tissu|cuir|essence|poudre|gemme/.test(_norm(`${_rcShopCatLabel(item)} ${item?.template || ''} ${item?.sousType || ''}`));

function _rcAll() {
  const conv = STORE.shopItems.map(_shopToRecipe).filter(Boolean);
  return [...STORE.all, ...conv];
}
function _rcRec() { return _rcAll().find(r => r.id === RC.sel) || null; }
function _rcState(r, uid) {
  const char = _rcCharForUid(uid);
  const ing = _ingredientState(r, _inventoryCounts(char || {}));
  const miss = ing.filter(g => !g.ready);
  return { ing, miss, ready: ing.length > 0 && !miss.length };
}
const _rcIncomplete = r => !String(r.nom || '').trim() ? 'Sans nom'
  : !(r.ingredients || []).length ? 'Aucun ingrédient'
  : (!r.shopItemId && !String(r.effet || '').trim()) ? 'Aucun résultat' : '';
function _rcResultLabel(r) {
  if (r.shopItemId) { const o = _findShopItem(r.shopItemId); return `→ ${_esc(o?.nom || r.nom || '?')}${(r.quantiteProduite || 1) > 1 ? ' ×' + r.quantiteProduite : ''}`; }
  return String(r.effet || '').trim() ? '→ Effet en jeu' : '→ résultat à définir';
}

// ── Persistance (auto-save) ────────────────────────────────────────────────
async function _rcPersist(r, patch, immediate) {
  if (r._fromShop) {
    const item = _findShopItem(r.id); if (!item) return;
    const META = new Set(['ingredients', 'atelierReq', 'tempsCraft', 'effet', 'description', 'duree', 'quantiteProduite']);
    const meta = { ...(item.recipeMeta || {}) }; let acc;
    Object.entries(patch).forEach(([k, v]) => { if (k === 'acces') acc = v; else if (META.has(k)) meta[k] = v; });
    item.recipeMeta = meta; if (acc) item.acces = acc;
    const data = { recipeMeta: meta }; if (acc) data.acces = acc;
    _rcQueue(r.id, 'shop', data, immediate);
    return;
  }
  Object.assign(r, patch);
  if (r._new) {
    r._new = false;
    const store = STORE.all.find(x => x.id === r.id) || r;
    const { _new, _mode, ...data } = store;
    try {
      const newId = await addToCol('recipes', data);
      if (newId) { store.id = newId; if (RC.sel === r.id) RC.sel = newId; r.id = newId; }
    } catch (e) { notifySaveError(e); }
    return;
  }
  _rcQueue(r.id, 'recipes', patch, immediate);
}
function _rcQueue(id, col, patch, immediate) {
  const run = async () => {
    RC.saveTimers.delete(id);
    try { await updateInCol(col, id, patch); _rcSetSaved('ok'); }
    catch (e) { notifySaveError(e); _rcSetSaved('err'); }
  };
  clearTimeout(RC.saveTimers.get(id));
  _rcSetSaved('busy');
  if (immediate) run(); else RC.saveTimers.set(id, setTimeout(run, 500));
}
function _rcSetSaved(mode) {
  const el = document.getElementById('rcSaved'); if (!el) return;
  el.textContent = mode === 'busy' ? 'Enregistrement…' : mode === 'err' ? 'Erreur' : '✓ Enregistré';
  el.classList.toggle('busy', mode === 'busy'); el.classList.toggle('err', mode === 'err');
}
function _rcUndoToast(msg, onUndo) {
  showNotif(msg, 'success', { duration: 5000, action: { label: '↶ Annuler', onClick: onUndo } });
}

// ── Liste ──────────────────────────────────────────────────────────────────
function _rcVisible() {
  const mj = _rcIsMJ();
  let L = mj ? _rcAll() : _rcAll().filter(r => (r.acces || []).includes(RC.meUid));
  if (RC.type !== 'all') L = L.filter(r => r.type === RC.type);
  if (RC.q) { const q = _norm(RC.q); L = L.filter(r => _norm([r.nom, r.effet, _rcT(r.type).label, _findShopItem(r.shopItemId)?.nom, ...(r.ingredients || []).map(g => g.nom)].join(' ')).includes(q)); }
  if (!mj && RC.readyOnly) L = L.filter(r => _rcState(r, RC.meUid).ready);
  return [...L].sort((a, b) => String(a.nom || '~').localeCompare(String(b.nom || '~'), 'fr'));
}
function _rcListHtml() {
  const mj = _rcIsMJ();
  const base = mj ? _rcAll() : _rcAll().filter(r => (r.acces || []).includes(RC.meUid));
  const L = _rcVisible();
  const types = TABS.filter(t => t.id !== 'all' && base.some(r => r.type === t.id));
  const fp = RC.forUid && _rcP(RC.forUid);
  const rows = L.map(r => {
    const t = _rcT(r.type), inc = mj && _rcIncomplete(r);
    let right = '';
    if (mj) {
      if (fp) { const on = (r.acces || []).includes(fp.uid); right = `<button class="rc-grant${on ? ' on' : ''}" data-a="grant" data-id="${_esc(r.id)}" title="${on ? 'Connue · retirer' : 'Faire connaître à ' + _esc(fp.perso)}" aria-pressed="${on}">${on ? '✓' : ''}</button>`; }
      else { const ps = (r.acces || []).map(_rcP).filter(Boolean); right = ps.length ? `<span class="rc-avs">${ps.slice(0, 3).map(p => _rcAv(p, 'sm')).join('')}${ps.length > 3 ? `<em>+${ps.length - 3}</em>` : ''}</span>` : '<span class="rc-nobody">Personne</span>'; }
    } else { const st = _rcState(r, RC.meUid); right = st.ready ? '<span class="rc-ready">Fabricable</span>' : `<span class="rc-miss">Il manque ${st.miss.length}</span>`; }
    return `<div class="rc-row${r.id === RC.sel ? ' sel' : ''}" role="button" tabindex="0" data-a="sel" data-id="${_esc(r.id)}">
      <span class="rc-ico" title="${_esc(t.label)}">${t.emoji}</span>
      <span class="rc-rn"><b>${r.nom ? _esc(r.nom) : '<span class="rc-dimtxt">Sans nom</span>'}</b><small>${inc ? `<span class="rc-warn">● ${inc}</span>` : _rcResultLabel(r)}</small></span>${right}</div>`;
  }).join('');
  return `<div class="rc-lh">
    <label class="rc-search"><span aria-hidden="true">🔍</span><input id="rcQ" type="search" placeholder="${mj ? 'Recette, ingrédient, objet…' : 'Chercher une recette…'}" value="${_esc(RC.q)}" autocomplete="off"></label>
    ${mj ? `<button class="rc-btn pri" data-a="new" title="Nouvelle recette (N)">+ Nouvelle</button>` : ''}
  </div>
  <div class="rc-filters">
    <div class="rc-tf" role="group" aria-label="Type"><button class="${RC.type === 'all' ? 'on' : ''}" data-a="type" data-t="all">Toutes</button>${types.map(t => `<button class="${RC.type === t.id ? 'on' : ''}" data-a="type" data-t="${t.id}" title="${_esc(t.label)}">${t.emoji}</button>`).join('')}</div>
    ${mj ? `<label class="rc-for" title="Cocher directement les recettes connues d’un joueur"><span>Pour</span><select id="rcFor"><option value="">tous</option>${_rcPlayers().map(p => `<option value="${_esc(p.uid)}"${RC.forUid === p.uid ? ' selected' : ''}>${_esc(p.perso)} (${_esc(p.pseudo)})</option>`).join('')}</select></label>`
      : `<button class="rc-tog${RC.readyOnly ? ' on' : ''}" data-a="ready" aria-pressed="${RC.readyOnly}">Fabricables</button>`}
  </div>
  ${fp ? `<div class="rc-forhint">${_rcAv(fp, 'sm')} Cochez les recettes que <b>${_esc(fp.perso)}</b> connaît · ${_rcAll().filter(r => (r.acces || []).includes(fp.uid)).length} connue(s)</div>` : ''}
  <div class="rc-rows">${rows || `<div class="rc-empty">${RC.q || RC.type !== 'all' || RC.readyOnly ? 'Aucune recette ne correspond.' : mj ? 'Aucune recette pour l’instant.' : 'Vous ne connaissez encore aucune recette.'}</div>`}</div>`;
}

// ── Combobox ───────────────────────────────────────────────────────────────
function _rcCbOptions(kind) {
  const r = _rcRec(); if (!r) return [];
  const q = _norm(RC.cbQ);
  const used = new Set(kind === 'ing' ? (r.ingredients || []).map(g => g.shopItemId).filter(Boolean) : []);
  let L = STORE.shopItems.filter(s => !used.has(s.id) && (!q || _norm(`${s.nom} ${_rcShopCatLabel(s)}`).includes(q)));
  const pri = s => { const comp = _rcIngredientish(s) ? 0 : 1; return kind === 'ing' ? comp : 1 - comp; };
  L.sort((a, b) => pri(a) - pri(b) || String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'));
  const opts = L.slice(0, 8).map(s => ({ id: s.id, label: s.nom, sub: `${_rcShopCatLabel(s)} · ${s.prix || 0} or` }));
  if (kind === 'ing' && RC.cbQ.trim() && !STORE.shopItems.some(s => _norm(s.nom) === q)) opts.push({ free: RC.cbQ.trim(), label: `Ajouter « ${RC.cbQ.trim()} » sans lien boutique`, sub: 'Ingrédient libre · non vérifiable dans les inventaires' });
  return opts;
}
function _rcCbHtml(kind, ph) {
  const open = RC.cb === kind, opts = open ? _rcCbOptions(kind) : [];
  if (RC.cbI >= opts.length) RC.cbI = Math.max(0, opts.length - 1);
  return `<div class="rc-cb${open ? ' open' : ''}" data-cb="${kind}">
    <input class="rc-cb-in" data-cbi="${kind}" placeholder="${_esc(ph)}" value="${open ? _esc(RC.cbQ) : ''}" autocomplete="off" role="combobox" aria-expanded="${open}">
    ${open ? `<div class="rc-dd" role="listbox">${opts.length ? opts.map((o, i) => `<div class="rc-opt${i === RC.cbI ? ' act' : ''}${o.free ? ' free' : ''}" role="option" data-a="pick" data-k="${kind}" data-i="${i}"><b>${_esc(o.label)}</b><small>${_esc(o.sub)}</small></div>`).join('') : '<div class="rc-opt none">Rien dans la boutique. Tapez un nom pour un ingrédient libre.</div>'}</div>` : ''}
  </div>`;
}

// ── Fiche MJ ───────────────────────────────────────────────────────────────
function _rcDetailMJ(r) {
  const t = _rcT(r.type), o = _findShopItem(r.shopItemId);
  const mode = r._mode || (r.shopItemId ? 'obj' : r.effet ? 'eff' : 'obj');
  const know = (r.acces || []).length, players = _rcPlayers();
  const lockShop = !!r._fromShop;
  return `<div class="rc-dh">
    <button class="rc-back" data-a="back">← Recettes</button>
    <input class="rc-name" data-f="nom" value="${_esc(r.nom)}" placeholder="Nom de la recette" maxlength="70" aria-label="Nom de la recette"${lockShop ? ' disabled' : ''}>
    <div class="rc-dh-r"><span class="rc-saved" id="rcSaved">✓ Enregistré</span>
      ${lockShop ? '' : '<button class="rc-ib" data-a="dup" title="Dupliquer">⧉</button><button class="rc-ib danger" data-a="del" title="Supprimer">🗑</button>'}</div>
  </div>
  ${lockShop ? `<div class="rc-shopnote">Recette d’objet de boutique (${_esc(t.label)}). Nom, type et résultat suivent l’objet ; ingrédients, atelier et accès restent modifiables.</div>`
    : `<div class="rc-types" role="radiogroup" aria-label="Type de recette">${RC_EDIT_TYPES.map(x => `<button role="radio" aria-checked="${x.id === r.type}" class="${x.id === r.type ? 'on' : ''}" data-a="settype" data-t="${x.id}" title="${_esc(RC_TYPE_HINT[x.id] || '')}">${x.emoji} ${_esc(x.label)}</button>`).join('')}</div>`}
  <div class="rc-eq">
    <section class="rc-col">
      <h4>Ingrédients <span>${(r.ingredients || []).length}</span></h4>
      <div class="rc-ings">${(r.ingredients || []).map((g, i) => { const s = _findShopItem(g.shopItemId); return `<div class="rc-ing">
        <span class="rc-step"><button data-a="qty" data-i="${i}" data-d="-1" ${g.quantite <= 1 ? 'disabled' : ''} aria-label="Moins">−</button><b>${g.quantite}</b><button data-a="qty" data-i="${i}" data-d="1" aria-label="Plus">+</button></span>
        <span class="rc-ing-n"><b>${_esc(g.nom)}</b><small>${s ? `${_esc(_rcShopCatLabel(s))} · ${s.prix || 0} or` : '<span class="rc-warn">Libre · non lié à la boutique</span>'}</small></span>
        <button class="rc-x" data-a="rmIng" data-i="${i}" title="Retirer">×</button></div>`; }).join('') || '<div class="rc-ph">Ajoutez les composants de la boutique nécessaires.</div>'}</div>
      ${_rcCbHtml('ing', '+ Ajouter un ingrédient…')}
    </section>
    <div class="rc-arrow" aria-hidden="true">→</div>
    <section class="rc-col">
      <h4>Résultat</h4>
      ${lockShop ? `<div class="rc-obj"><span class="rc-obj-i">${_esc((o?.nom || '?')[0])}</span><span class="rc-obj-n"><b>${_esc(o?.nom || r.nom)}</b><small>Objet de la boutique</small></span></div>`
      : `<div class="rc-seg" role="radiogroup"><button role="radio" aria-checked="${mode === 'obj'}" class="${mode === 'obj' ? 'on' : ''}" data-a="mode" data-m="obj">Un objet</button><button role="radio" aria-checked="${mode === 'eff'}" class="${mode === 'eff' ? 'on' : ''}" data-a="mode" data-m="eff">Un effet en jeu</button></div>
      ${mode === 'obj' ? (o && RC.cb !== 'res' ? `<div class="rc-obj"><span class="rc-obj-i">${_esc((o.nom || '?')[0])}</span><span class="rc-obj-n"><b>${_esc(o.nom)}</b><small>${_esc(_rcShopCatLabel(o))} · ${o.prix || 0} or · ajouté à l’inventaire</small></span>
          <span class="rc-step"><button data-a="pqty" data-d="-1" ${(r.quantiteProduite || 1) <= 1 ? 'disabled' : ''}>−</button><b>×${r.quantiteProduite || 1}</b><button data-a="pqty" data-d="1">+</button></span>
          <button class="rc-btn ghost sm" data-a="chres">Changer</button></div>` : _rcCbHtml('res', 'Chercher l’objet produit…'))
        : `<textarea class="rc-ta" data-f="effet" rows="4" placeholder="Ce qui se passe en jeu quand la recette réussit.">${_esc(r.effet)}</textarea>`}`}
    </section>
  </div>
  <div class="rc-cond">
    <label>Atelier<input class="rc-in" data-f="atelierReq" value="${_esc(r.atelierReq)}" placeholder="${_esc(RC_ATELIER[r.type] || '')}" list="rcAteliers"></label>
    <label>Durée<input class="rc-in" data-f="duree" value="${_esc(r.duree)}" placeholder="1 heure, 2 jours…"></label>
    <datalist id="rcAteliers">${Object.values(RC_ATELIER).map(a => `<option>${_esc(a)}</option>`).join('')}</datalist>
  </div>
  <section class="rc-know">
    <h4>Connue par <span>${know} / ${players.length}</span><button class="rc-link" data-a="all">${know === players.length && players.length ? 'Retirer à tous' : 'Donner à tous'}</button></h4>
    <div class="rc-pls">${players.map(p => { const on = (r.acces || []).includes(p.uid), st = _rcState(r, p.uid); return `<button class="rc-pl${on ? ' on' : ''}" style="--c:${p.color}" data-a="acc" data-u="${_esc(p.uid)}" aria-pressed="${on}">${_rcAv(p)}<span><b>${_esc(p.perso)}</b><small>${_esc(p.pseudo)}${on ? (st.ready ? ' · peut la faire' : ` · manque ${st.miss.length}`) : ''}</small></span></button>`; }).join('') || '<p class="rc-ph">Aucun personnage dans l’aventure.</p>'}</div>
  </section>
  <section class="rc-desc"><label>Description <small>visible par les joueurs</small><textarea class="rc-ta" data-f="description" rows="2" placeholder="Origine, anecdote, conditions…">${_esc(r.description)}</textarea></label></section>`;
}

// ── Fiche joueur ─────────────────────────────────────────────────────────────
function _rcDetailPlayer(r) {
  const t = _rcT(r.type), o = _findShopItem(r.shopItemId), st = _rcState(r, RC.meUid);
  const others = (r.acces || []).filter(u => u !== RC.meUid).map(_rcP).filter(Boolean);
  const targets = _rcPlayers().filter(p => p.uid !== RC.meUid && !(r.acces || []).includes(p.uid));
  const canXfer = canControlCharacter(_rcCharForUid(RC.meUid) || {});
  const missTxt = st.miss.map(g => g.owned == null ? `${g.required} ${g.nom} (à voir avec le MJ)` : `${g.required - g.owned} ${g.nom}`).join(', ');
  return `<div class="rc-dh">
    <button class="rc-back" data-a="back">← Recettes</button>
    <div class="rc-pt"><h2>${_esc(r.nom)}</h2><small>${t.emoji} ${_esc(t.label)} · ${_esc(r.atelierReq || RC_ATELIER[r.type] || '')}${r.duree ? ' · ' + _esc(r.duree) : ''}</small></div>
  </div>
  <div class="rc-status ${st.ready ? 'ok' : 'ko'}">${st.ready ? 'Vous avez tout le nécessaire.' : `Il vous manque : ${_esc(missTxt)}.`}</div>
  <div class="rc-eq">
    <section class="rc-col"><h4>Ingrédients</h4>
      <div class="rc-ings">${st.ing.map(g => `<div class="rc-ing ro"><b class="rc-have ${g.ready ? 'ok' : 'ko'}">${g.owned == null ? '?' : g.owned}<i>/${g.required}</i></b><span class="rc-ing-n"><b>${_esc(g.nom)}</b><small>${g.owned == null ? 'Ingrédient rare, à voir avec le MJ' : g.ready ? 'En inventaire' : `Il en manque ${g.required - g.owned}`}</small></span></div>`).join('') || '<div class="rc-ph">Aucun ingrédient renseigné.</div>'}</div>
    </section>
    <div class="rc-arrow" aria-hidden="true">→</div>
    <section class="rc-col"><h4>Résultat</h4>
      ${o ? `<div class="rc-obj"><span class="rc-obj-i">${_esc((o.nom || '?')[0])}</span><span class="rc-obj-n"><b>${_esc(o.nom)}${(r.quantiteProduite || 1) > 1 ? ' ×' + r.quantiteProduite : ''}</b><small>${_esc(_rcShopCatLabel(o))} · ajouté à votre inventaire</small></span></div>` : ''}
      ${r.effet ? `<p class="rc-eff">${_esc(r.effet)}</p>` : ''}
    </section>
  </div>
  ${r.description ? `<p class="rc-lore">${_esc(r.description)}</p>` : ''}
  <div class="rc-pfoot">
    <span class="rc-also">${others.length ? `Aussi connue par ${others.map(p => _rcAv(p, 'sm')).join('')}` : 'Vous êtes seul·e à la connaître.'}</span>
    ${canXfer && targets.length ? `<button class="rc-btn${RC.send ? ' on' : ''}" data-a="send">↗ Transmettre</button>` : ''}
  </div>
  ${RC.send && canXfer ? `<div class="rc-send">
    <b>À qui transmettre « ${_esc(r.nom)} » ?</b>
    <div class="rc-pls">${targets.map(p => `<button class="rc-pl${RC.sendTo === p.uid ? ' on' : ''}" style="--c:${p.color}" data-a="sendTo" data-u="${_esc(p.uid)}" aria-pressed="${RC.sendTo === p.uid}">${_rcAv(p)}<span><b>${_esc(p.perso)}</b><small>${_esc(p.pseudo)}</small></span></button>`).join('')}</div>
    <p class="rc-warnbox">Vous l’oublierez : elle disparaîtra de votre livre.</p>
    <div class="rc-sendacts"><button class="rc-btn ghost" data-a="sendCancel">Annuler</button><button class="rc-btn pri" data-a="sendGo" ${RC.sendTo ? '' : 'disabled'}>Transmettre${RC.sendTo ? ' à ' + _esc(_rcP(RC.sendTo).perso) : ''}</button></div>
  </div>` : ''}`;
}
function _rcDetailHtml() {
  const r = _rcRec();
  if (!r || (!_rcIsMJ() && !(r.acces || []).includes(RC.meUid))) return `<div class="rc-empty big">${_rcIsMJ() ? 'Sélectionnez une recette ou créez-en une.' : 'Sélectionnez une recette.'}</div>`;
  return _rcIsMJ() ? _rcDetailMJ(r) : _rcDetailPlayer(r);
}

// ── Rendu + événements ──────────────────────────────────────────────────────
function _rcRender(focus) {
  const m = document.getElementById('rcModal'); if (!m) return;
  const canToggle = _isAdmin();
  const title = document.getElementById('rcTitle'), sub = document.getElementById('rcSub');
  if (title) title.textContent = _rcIsMJ() ? 'Recettes de l’aventure' : 'Livre de recettes';
  if (sub) sub.textContent = _rcIsMJ() ? `${_rcAll().length} recettes` : `${_rcAll().filter(r => (r.acces || []).includes(RC.meUid)).length} recettes connues`;
  m.dataset.pane = RC.pane;
  const list = document.getElementById('rcList'), det = document.getElementById('rcDetail');
  const ls = list?.querySelector('.rc-rows')?.scrollTop || 0, ds = det?.scrollTop || 0;
  if (list) list.innerHTML = _rcListHtml();
  if (det) det.innerHTML = _rcDetailHtml();
  const rr = list?.querySelector('.rc-rows'); if (rr) rr.scrollTop = ls; if (det) det.scrollTop = ds;
  m.querySelectorAll('[data-view]').forEach(b => { b.classList.toggle('on', b.dataset.view === RC.view); b.hidden = !canToggle; });
  if (focus) { const el = m.querySelector(focus); if (el) { el.focus(); if (el.setSelectionRange && el.value != null) try { el.setSelectionRange(el.value.length, el.value.length); } catch {} } }
}
function _rcRenderCb() {
  const k = RC.cb, box = document.querySelector(`[data-cb="${k}"]`); if (!box) return;
  const tmp = document.createElement('div'); tmp.innerHTML = _rcCbHtml(k, box.querySelector('input')?.placeholder || '');
  const dd = tmp.querySelector('.rc-dd'); box.querySelector('.rc-dd')?.remove(); if (dd) box.appendChild(dd); box.classList.toggle('open', !!dd);
}
function _rcPick(kind, i) {
  const r = _rcRec(), o = _rcCbOptions(kind)[i]; if (!r || !o) return;
  if (kind === 'ing') {
    const ing = [...(r.ingredients || []), o.free ? { nom: o.free, quantite: 1, shopItemId: '' } : { nom: _findShopItem(o.id).nom, quantite: 1, shopItemId: o.id }];
    _rcPersist(r, { ingredients: ing }, true); RC.cbQ = ''; RC.cbI = 0; _rcRender('[data-cbi="ing"]'); RC.cb = 'ing'; _rcRenderCb();
  } else {
    const patch = { shopItemId: o.id, quantiteProduite: r.quantiteProduite || 1 };
    if (!String(r.nom || '').trim()) patch.nom = _findShopItem(o.id).nom;
    r._mode = 'obj'; RC.cb = null; RC.cbQ = ''; _rcPersist(r, patch, true); _rcRender();
  }
}
function _rcBind(m) {
  m.addEventListener('click', e => {
    const t = e.target.closest('[data-a]');
    if (RC.cb && !e.target.closest('.rc-cb')) { RC.cb = null; RC.cbQ = ''; if (!t) { _rcRender(); return; } }
    if (!t) return;
    const a = t.dataset.a, r = _rcRec(), i = +t.dataset.i;
    if (a === 'sel') { RC.sel = t.dataset.id; RC.pane = 'detail'; RC.send = false; RC.sendTo = null; }
    else if (a === 'back') RC.pane = 'list';
    else if (a === 'type') RC.type = t.dataset.t;
    else if (a === 'ready') RC.readyOnly = !RC.readyOnly;
    else if (a === 'grant') { e.stopPropagation(); const x = _rcAll().find(z => z.id === t.dataset.id), u = RC.forUid; if (x) { const acc = (x.acces || []).includes(u) ? x.acces.filter(z => z !== u) : [...(x.acces || []), u]; _rcPersist(x, { acces: acc }, true); _rcUndoToast(`${x.nom || 'Recette'} · ${acc.includes(u) ? 'connue par' : 'oubliée par'} ${_rcP(u).perso}`, () => { _rcPersist(x, { acces: x.acces.includes(u) ? x.acces.filter(z => z !== u) : [...x.acces, u] }, true); _rcRender(); }); } }
    else if (a === 'new') { const n = { id: 'rc-new-' + Date.now(), _new: true, type: RC.type !== 'all' && RC_EDIT_TYPES.some(x => x.id === RC.type) ? RC.type : 'potion', nom: '', ingredients: [], shopItemId: '', quantiteProduite: 1, effet: '', duree: '', atelierReq: '', description: '', acces: RC.forUid ? [RC.forUid] : [] }; STORE.all.push(n); RC.sel = n.id; RC.pane = 'detail'; RC.q = ''; _rcRender('.rc-name'); return; }
    else if (a === 'dup') { const n = { ...JSON.parse(JSON.stringify(r)), id: 'rc-new-' + Date.now(), _new: true, nom: (r.nom || '') + ' (copie)', acces: [] }; delete n._mode; delete n._fromShop; STORE.all.push(n); RC.sel = n.id; _rcRender('.rc-name'); return; }
    else if (a === 'del') { const snap = JSON.parse(JSON.stringify(r)); const wasNew = r._new; STORE.all = STORE.all.filter(x => x.id !== r.id); RC.sel = _rcVisible()[0]?.id || ''; RC.pane = 'list'; if (!wasNew) confirmDelete('recipes', snap.id, '', { confirmed: true, snapshot: snap, successMessage: `« ${snap.nom || 'Sans nom'} » supprimée`, onRestore: async () => { await _ensureRecipeData(); } }); else _rcUndoToast(`« ${snap.nom || 'Sans nom'} » supprimée`, () => { snap._new = true; STORE.all.push(snap); RC.sel = snap.id; _rcRender(); }); }
    else if (a === 'settype') { _rcPersist(r, { type: t.dataset.t }, true); }
    else if (a === 'qty') { const ing = (r.ingredients || []).map((g, k) => k === i ? { ...g, quantite: Math.max(1, (g.quantite || 1) + +t.dataset.d) } : g); _rcPersist(r, { ingredients: ing }, true); }
    else if (a === 'pqty') { _rcPersist(r, { quantiteProduite: Math.max(1, (r.quantiteProduite || 1) + +t.dataset.d) }, true); }
    else if (a === 'rmIng') { const g = (r.ingredients || [])[i]; const ing = (r.ingredients || []).filter((_, k) => k !== i); _rcPersist(r, { ingredients: ing }, true); _rcUndoToast(`${g?.nom || 'Ingrédient'} retiré`, () => { const back = [...(r.ingredients || [])]; back.splice(i, 0, g); _rcPersist(r, { ingredients: back }, true); _rcRender(); }); }
    else if (a === 'mode') { r._mode = t.dataset.m; if (t.dataset.m === 'obj' && !r.shopItemId) { RC.cb = 'res'; RC.cbQ = ''; RC.cbI = 0; _rcRender('[data-cbi="res"]'); _rcRenderCb(); return; } if (t.dataset.m === 'eff' && r.shopItemId) { _rcPersist(r, { shopItemId: '' }, true); } }
    else if (a === 'chres') { RC.cb = 'res'; RC.cbQ = ''; RC.cbI = 0; _rcRender('[data-cbi="res"]'); _rcRenderCb(); return; }
    else if (a === 'pick') { _rcPick(t.dataset.k, i); return; }
    else if (a === 'acc') { const u = t.dataset.u; const acc = (r.acces || []).includes(u) ? r.acces.filter(z => z !== u) : [...(r.acces || []), u]; _rcPersist(r, { acces: acc }, true); }
    else if (a === 'all') { const players = _rcPlayers(); const acc = (r.acces || []).length === players.length ? [] : players.map(p => p.uid); _rcPersist(r, { acces: acc }, true); }
    else if (a === 'send') { RC.send = !RC.send; RC.sendTo = null; }
    else if (a === 'sendTo') RC.sendTo = t.dataset.u;
    else if (a === 'sendCancel') { RC.send = false; RC.sendTo = null; }
    else if (a === 'sendGo') { const to = _rcP(RC.sendTo); if (to && r) { const acc = [...(r.acces || []).filter(u => u !== RC.meUid), to.uid]; _rcPersist(r, { acces: acc }, true); RC.send = false; RC.sendTo = null; RC.sel = _rcVisible()[0]?.id || ''; RC.pane = 'list'; showNotif(`« ${r.nom} » transmise à ${to.perso}`, 'success'); } }
    else return;
    _rcRender();
  });
  m.addEventListener('focusin', e => { const k = e.target.dataset?.cbi; if (k && RC.cb !== k) { RC.cb = k; RC.cbQ = e.target.value; RC.cbI = 0; _rcRenderCb(); } });
  m.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'rcQ') { RC.q = el.value; const list = document.getElementById('rcList'); const tmp = document.createElement('div'); tmp.innerHTML = _rcListHtml(); list.querySelector('.rc-rows').replaceWith(tmp.querySelector('.rc-rows')); return; }
    if (el.dataset.cbi) { RC.cb = el.dataset.cbi; RC.cbQ = el.value; RC.cbI = 0; _rcRenderCb(); return; }
    if (el.dataset.f) { const r = _rcRec(); if (r) { _rcPersist(r, { [el.dataset.f]: el.value }, false); _rcRefreshRow(); } }
  });
  m.addEventListener('change', e => { if (e.target.id === 'rcFor') { RC.forUid = e.target.value; _rcRender(); } });
  m.addEventListener('keydown', e => {
    const el = e.target;
    if (el.dataset?.cbi) { const n = _rcCbOptions(el.dataset.cbi).length;
      if (e.key === 'ArrowDown') { e.preventDefault(); RC.cbI = Math.min(n - 1, RC.cbI + 1); _rcRenderCb(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); RC.cbI = Math.max(0, RC.cbI - 1); _rcRenderCb(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (n) _rcPick(el.dataset.cbi, RC.cbI); }
      else if (e.key === 'Escape') { e.stopPropagation(); RC.cb = null; RC.cbQ = ''; el.value = ''; el.blur(); _rcRender(); }
      return; }
    if (el.classList?.contains('rc-row') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); el.click(); }
    if (el.classList?.contains('rc-name') && e.key === 'Enter') { e.preventDefault(); m.querySelector('[data-cbi="ing"]')?.focus(); }
  });
  m.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { if (!_isAdmin()) return; RC.view = b.dataset.view; RC.type = 'all'; RC.q = ''; RC.forUid = ''; RC.send = false; RC.pane = 'list'; if (!_rcIsMJ() && !(_rcRec()?.acces || []).includes(RC.meUid)) RC.sel = _rcVisible()[0]?.id || ''; _rcRender(); }));
}
function _rcRefreshRow() {
  const r = _rcRec(); if (!r) return;
  const row = document.querySelector(`.rc-row[data-id="${CSS.escape(r.id)}"]`); if (!row) return;
  row.querySelector('.rc-rn b').innerHTML = r.nom ? _esc(r.nom) : '<span class="rc-dimtxt">Sans nom</span>';
  const inc = _rcIsMJ() && _rcIncomplete(r);
  row.querySelector('.rc-rn small').innerHTML = inc ? `<span class="rc-warn">● ${inc}</span>` : _rcResultLabel(r);
}

export async function openRecipesModal({ view, charId = '', forUid = '', access = false, sel = '', create = false } = {}) {
  await _ensureRecipeData();
  const admin = _isAdmin();
  RC.view = admin ? (view || 'mj') : 'player';
  RC.meUid = _myUid();
  if (!admin && charId) { const c = (STATE.characters || []).find(x => x.id === charId); if (c?.uid) RC.meUid = c.uid; }
  RC.forUid = ''; RC.q = ''; RC.type = 'all'; RC.readyOnly = false; RC.send = false; RC.sendTo = null; RC.cb = null; RC.cbQ = '';
  if (admin && (forUid || access)) { const c = charId ? (STATE.characters || []).find(x => x.id === charId) : null; RC.forUid = forUid || (access ? (c?.uid || '') : ''); }
  RC.sel = sel || _rcVisible()[0]?.id || '';
  RC.pane = sel ? 'detail' : 'list';
  openModal('', `<div class="rc-modal" id="rcModal" data-pane="list">
    <header class="rc-top">
      <div class="rc-top-id"><h2 id="rcTitle">Recettes</h2><small id="rcSub"></small></div>
      <div class="rc-viewtog" role="group" aria-label="Vue">
        <button data-view="mj" class="on">MJ</button><button data-view="player">Joueur</button>
      </div>
      <button class="rc-close" data-action="closeModal" aria-label="Fermer">×</button>
    </header>
    <div class="rc-body"><div class="rc-list" id="rcList"></div><div class="rc-detail" id="rcDetail"></div></div>
  </div>`);
  const m = document.getElementById('rcModal');
  if (m) { _rcBind(m); _rcRender(); if (admin && create) { m.querySelector('[data-a="new"]')?.click(); } }
}
