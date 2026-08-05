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
import { openModal, closeModal, confirmModal } from "../shared/modal.js";
import { registerActions } from '../core/actions.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import PAGES from './pages.js';
import { _rareteTag } from '../shared/rarity.js';
import { _esc, _norm, _searchIncludes, _trunc } from "../shared/html.js";
import { formatWeaponDamageText, isWeaponLikeItem } from '../shared/equipment-utils.js';

// ── État local ─────────────────────────────────────────────────────────────────

// ── Config des onglets ────────────────────────────────────────────────────────
const TABS = [
  { id:'all',     emoji:'📚', label:'Tout' },
  { id:'cuisine', emoji:'🍳', label:'Cuisine' },
  { id:'potion',  emoji:'🧪', label:'Potions' },
  { id:'arme',    emoji:'⚔️', label:'Armes' },
  { id:'armure',  emoji:'🛡️', label:'Armures' },
  { id:'bijou',   emoji:'💍', label:'Bijoux' },
];
// Onglets qui proposent une création directe (les crafts arme/armure/bijou se
// créent depuis la boutique, et "Tout" n'est pas un type).
const CREATE_RECIPES = TABS.filter(t => t.id === 'cuisine' || t.id === 'potion');

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

async function _ensureRecipeData() {
  const adventureId = STATE.adventure?.id || '';
  if (STORE.loaded && STORE.adventureId === adventureId) return;
  [STORE.all, STORE.shopItems, STORE.shopCats] = await Promise.all([
    loadCollection('recipes'),
    loadCollection('shop'),
    loadCollection('shopCategories').catch(() => []),
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
function _shopItemAtelierReq(item, type) {
  const fmt = item.format || '';
  if (type === 'bijou')                   return "Atelier d'orfèvre";
  if (fmt.includes('Mag'))                return "Atelier d'orfèvre";
  if (fmt.includes('Dist'))               return 'Atelier de confection';
  if (item.slotArmure) {
    return item.typeArmure === 'Lourde' ? 'Forge' : 'Atelier de confection';
  }
  return 'Forge';
}

function _shopItemIngredients(item) {
  const quantity = Math.max(1, Math.round((parseFloat(item.prix) || 0) / 10));
  const itemFormat = item.format || '';
  let materiau;
  if      (itemFormat.includes('Mag'))                           materiau = MATERIALS.matMyst;
  else if (itemFormat.includes('Dist') && itemFormat.includes('Phy'))   materiau = MATERIALS.matSoup;
  else if (itemFormat.includes('CaC')  && itemFormat.includes('Phy'))   materiau = MATERIALS.matBest;
  else if (itemFormat.includes('Bouclier'))                      materiau = MATERIALS.matResi;
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
  STORE.tab = STORE.tab || 'cuisine';
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
          <button class="rec-tab ${STORE.tab===t.id?'active':''}" data-action="recSetTab" data-id="${t.id}">
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
  const isCraftType = r.type === 'arme' || r.type === 'armure' || r.type === 'bijou';
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

  const isCraft = ['arme','armure','bijou'].includes(rType);
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
      ${(rType === 'potion' || rType === 'cuisine') ? `
      <div class="form-group">
        <label>Famille</label>
        <input class="input-field" id="rec-famille" value="${r?.famille||''}" placeholder="${rType === 'cuisine' ? 'Soupe, Rôti, Pâtisserie...' : 'Soin, Élixir, Alchimie...'}">
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
        <button type="button" data-action="createCharacterRecipe" data-type="cuisine" data-id="${_esc(characterId)}">
          <span aria-hidden="true">🍳</span><strong>Recette de cuisine</strong>
          <small>Préparation, durée, ingrédients et effet de groupe.</small>
        </button>
        <button type="button" data-action="createCharacterRecipe" data-type="potion" data-id="${_esc(characterId)}">
          <span aria-hidden="true">🧪</span><strong>Potion</strong>
          <small>Ingrédients, préparation et effet individuel.</small>
        </button>
      </div>
      <p class="rec-create-hint">Les recettes d'armes, d'armures et de bijoux sont créées depuis les objets correspondants de la Boutique.</p>
    </div>`, { icon: '＋', subtitle: 'Ajouter une recette au catalogue', accent: '#e8b84b' });
}

function _ingrRow(ig = {}, i) {
  return `<div class="rec-ingr-dyn" id="rec-ig-${i}"
    style="display:flex;align-items:center;gap:.4rem;background:var(--bg-elevated);
    border-radius:8px;padding:.4rem .6rem;border:1px solid var(--border)">
    <input class="input-field" id="rec-ig-qty-${i}" value="${ig.quantite||''}"
      placeholder="Qté" style="width:70px;flex-shrink:0;font-size:.78rem;padding:4px 6px">
    <input class="input-field" id="rec-ig-nom-${i}" value="${ig.nom||''}"
      placeholder="Nom..." style="flex:1;font-size:.78rem;padding:4px 6px">
    <button type="button" data-action="_recRemIngr" data-idx="${i}"
      style="color:#ff6b6b;background:none;border:none;cursor:pointer;font-size:.9rem;padding:0 4px;flex-shrink:0">✕</button>
  </div>`;
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
  return [...document.querySelectorAll('#rec-ingr-list .rec-ingr-dyn')].map((_, i) => ({
    quantite: document.getElementById(`rec-ig-qty-${i}`)?.value?.trim() || '',
    nom:      document.getElementById(`rec-ig-nom-${i}`)?.value?.trim() || '',
  })).filter(ig => ig.nom);
}

// ══════════════════════════════════════════════════════════════════════════════
// SAUVEGARDER / SUPPRIMER
// ══════════════════════════════════════════════════════════════════════════════
async function saveRecipe(id, fallbackType) {
  try {
    const nom = document.getElementById('rec-nom')?.value?.trim();
    if (!nom) { showNotif('Le nom est requis.', 'error'); return; }

    const existing = id ? STORE.all.find(r => r.id === id) : null;
    const type     = existing?.type || fallbackType || 'cuisine';

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

  if (await trySave('shop', id, { recipeMeta })) {
    const idx = STORE.shopItems.findIndex(i => i.id === id);
    if (idx >= 0) STORE.shopItems[idx].recipeMeta = recipeMeta;
    closeModal();
    showNotif('Recette mise à jour !', 'success');
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
    if (!await confirmDelete('recipes', id, `Supprimer "${r?.nom||'cette recette'}" ?`)) return;
    STORE.all = STORE.all.filter(x => x.id !== id);
    showNotif('Recette supprimée.', 'success');
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
  const counts = new Map();
  (character?.inventaire || []).forEach(item => {
    const key = _norm(item?.nom || '');
    if (key) counts.set(key, (counts.get(key) || 0) + Math.max(1, parseInt(item.quantite || item.qte || 1) || 1));
  });
  return counts;
}

function _ingredientState(recipe, counts) {
  return (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).map(ingredient => {
    const required = Math.max(1, parseInt(ingredient.quantite) || 1);
    const owned = counts.get(_norm(ingredient.nom || '')) || 0;
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
    <button class="is-active" data-action="setCharacterRecipeType" data-scope="${scope}" data-type="all"><span>📚</span><b>Toutes</b><em>${recipes.length}</em></button>
    ${TABS.filter(tab => tab.id !== 'all' && counts[tab.id]).map(tab => `<button data-action="setCharacterRecipeType" data-scope="${scope}" data-type="${tab.id}"><span>${tab.emoji}</span><b>${_esc(tab.label)}</b><em>${counts[tab.id]}</em></button>`).join('')}
  </nav>`;
}

export function recipeBookButton(character) {
  return `<button class="inv-recipe-trigger" data-action="openCharacterRecipeBook" data-id="${_esc(character?.id || '')}" title="Voir les recettes connues"><span aria-hidden="true">📖</span><b>Recettes</b></button>`;
}

export async function openCharacterRecipeBook(characterId) {
  await _ensureRecipeData();
  const character = (STATE.characters || []).find(c => c.id === characterId);
  if (!character) return;
  const uid = character.uid || (character.id === STATE.activeChar?.id ? _myUid() : '');
  const recipes = _allRecipeEntries().filter(recipe => uid && (recipe.acces || []).includes(uid));
  const canTransfer = !_isAdmin() && uid === _myUid();
  openModal(`Recettes de ${character.nom || 'ce personnage'}`, `
    <div class="rec-book-shell">
      <header class="rec-book-head"><div><span>Livre de recettes</span><strong>${recipes.length} recette${recipes.length !== 1 ? 's' : ''} connue${recipes.length !== 1 ? 's' : ''}</strong></div>
        ${_isAdmin() ? `<button class="btn btn-gold btn-sm" data-action="openCharacterRecipeAccess" data-id="${_esc(character.id)}">Gérer les recettes connues</button>` : ''}</header>
      <div class="rec-book-controls">
        <label class="rec-book-search"><span aria-hidden="true">⌕</span><input data-input="filterCharacterRecipeBook" placeholder="Rechercher une recette ou un ingrédient…"></label>
        <div class="rec-ready-filter" role="group" aria-label="Disponibilité des ingrédients">
          <button class="is-active" data-action="setCharacterRecipeStatus" data-scope="book" data-status="all">Toutes</button>
          <button data-action="setCharacterRecipeStatus" data-scope="book" data-status="ready">Fabricables</button>
          <button data-action="setCharacterRecipeStatus" data-scope="book" data-status="missing">À compléter</button>
        </div>
      </div>
      <div class="rec-context-layout">${_recipeTypeNav(recipes, 'book')}<div class="rec-book-grid">${recipes.length ? recipes.map(recipe => _recipeBookCard(recipe, character, canTransfer)).join('') : '<div class="rec-book-empty">Aucune recette connue pour le moment.</div>'}<div class="rec-context-empty" hidden>Aucune recette ne correspond à ces filtres.</div></div></div>
    </div>`, { icon: '📖', subtitle: 'Recettes connues et ingrédients disponibles', accent: '#e8b84b' });
}

export async function openCharacterRecipeAccess(characterId) {
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
  shell.querySelectorAll(selector).forEach(item => item.classList.toggle('is-active', item === button));
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

function setRecipeTab(t) { STORE.tab = t; STORE.filterTxt = ""; _render(); }
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
