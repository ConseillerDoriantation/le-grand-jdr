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
import { characterPortraitContent } from '../shared/portraits.js';
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
// ── Helpers de donnees conserves par la modale v2 ──────────────────
function _inventoryCounts(character) {
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
    const owned = ingredient.shopItemId
      ? (counts.byId.get(ingredient.shopItemId) || 0)
      : (counts.byName.get(_norm(ingredient.nom || '')) || 0);
    return { ...ingredient, required, owned, ready: owned >= required };
  });
}
export function recipeBookButton(character) {
  return '<button class="inv-recipe-trigger" data-action="openCharacterRecipeBook" data-id="' + _esc(character?.id || '') + '" title="Voir les recettes connues"><span aria-hidden="true">📖</span><b>Recettes</b></button>';
}
// Points d'entree : ouvrent la modale v2 avec le bon etat initial.
export function openItemDetailModal(id) { return openRecipesModal({ sel: id }); }
export async function openCharacterRecipeBook(characterId) { return openRecipesModal({ charId: characterId }); }
export async function openCharacterRecipeAccess(characterId) { return openRecipesModal({ charId: characterId, access: true }); }
function openCharacterRecipeCreatePicker(characterId) { return openRecipesModal({ charId: characterId, access: true, create: true }); }
// Decision #3 : plus de page plein ecran — la route Recettes ouvre la modale.
PAGES.recettes = () => openRecipesModal({});

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
  // Un représentant par compte : on privilégie le personnage favori (isDefault),
  // sinon le premier rencontré — son portrait sert d'avatar du joueur.
  const byUid = new Map();
  (STATE.characters || []).forEach(c => {
    if (!c?.uid) return;
    const cur = byUid.get(c.uid);
    if (!cur || (c.isDefault && !cur.isDefault)) byUid.set(c.uid, c);
  });
  return [...byUid.values()].map(c => ({ uid: c.uid, perso: c.nom || '?', pseudo: c.ownerPseudo || c.nom || c.uid, color: _rcColor(c.uid), char: c }));
}
const _rcP = uid => _rcPlayers().find(p => p.uid === uid) || null;
const _rcCharForUid = uid => (STATE.characters || []).find(c => c.uid === uid) || null;
const _rcAv = (p, sz = '') => `<i class="rc-av ${sz}" style="--c:${p.color}" title="${_esc(p.perso)} · ${_esc(p.pseudo)}">${characterPortraitContent(p.char || {}, { fallbackTag: 'span', fallbackText: (p.perso[0] || '?').toUpperCase() })}</i>`;
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
