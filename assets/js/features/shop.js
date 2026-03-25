import { STATE }                                         from '../core/state.js';
import { loadCollection, addToCol, updateInCol,
         deleteFromCol }                                 from '../data/firestore.js';
import { openModal, closeModalDirect }                   from '../shared/modal.js';
import { showNotif }                                     from '../shared/notifications.js';
import PAGES                                             from './pages.js';

// ══════════════════════════════════════════════
// ÉTAT LOCAL
// ══════════════════════════════════════════════
let _cats  = [];   // [{id, nom, ordre, sousCats:[{id,nom}]}]
let _items = [];   // [{id, categorieId, sousCategorieId, nom, description, prix, ...}]
let _filterCat    = null;   // id catégorie active
let _filterSubCat = null;   // id sous-cat active

// ══════════════════════════════════════════════
// CHARGEMENT
// ══════════════════════════════════════════════
async function loadShopData() {
  [_cats, _items] = await Promise.all([
    loadCollection('shopCategories'),
    loadCollection('shop'),
  ]);
  _cats.sort((a,b) => (a.ordre||0) - (b.ordre||0));
}

// ══════════════════════════════════════════════
// RENDER PRINCIPAL
// ══════════════════════════════════════════════
async function renderShop() {
  await loadShopData();
  const content = document.getElementById('main-content');
  if (!content) return;

  let html = `
  <div class="page-header">
    <div class="page-title"><span class="page-title-accent">🛒</span> Boutique</div>
    <div class="page-subtitle">Équipements, consommables et merveilles</div>
  </div>`;

  if (STATE.isAdmin) {
    html += `
    <div class="admin-section">
      <div class="admin-label">Gestion Admin</div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
        <button class="btn btn-gold btn-sm" onclick="openCatModal()">📁 Nouvelle catégorie</button>
        <button class="btn btn-outline btn-sm" onclick="openItemModal()">+ Ajouter un article</button>
      </div>
    </div>`;
  }

  if (_cats.length === 0 && _items.length === 0) {
    html += `<div class="empty-state"><div class="icon">🛒</div><p>La boutique est vide pour l'instant.</p></div>`;
    content.innerHTML = html;
    return;
  }

  // ── Layout : sidebar catégories + contenu ──
  html += `<div class="shop-layout">`;

  // Sidebar catégories
  html += `<div class="shop-sidebar" id="shop-sidebar">
    <div class="shop-sidebar-title">Catégories</div>
    <button class="shop-cat-btn ${!_filterCat?'active':''}" onclick="shopFilterCat(null)">
      🛒 Tout afficher
      <span class="shop-cat-count">${_items.length}</span>
    </button>`;

  _cats.forEach(cat => {
    const catItems = _items.filter(i => i.categorieId === cat.id);
    const isOpen   = _filterCat === cat.id;
    html += `
    <div class="shop-cat-group">
      <button class="shop-cat-btn ${isOpen?'active':''}"
              onclick="shopFilterCat('${cat.id}')">
        <span class="shop-cat-name">📁 ${cat.nom}</span>
        <span class="shop-cat-count">${catItems.length}</span>
        ${STATE.isAdmin?`<span class="shop-cat-actions" onclick="event.stopPropagation()">
          <button class="btn-icon" onclick="openCatModal('${cat.id}')" title="Renommer">✏️</button>
          <button class="btn-icon" onclick="deleteCat('${cat.id}')" title="Supprimer">🗑️</button>
        </span>`:''}
      </button>`;

    // Sous-catégories
    const subCats = cat.sousCats||[];
    if (isOpen && subCats.length > 0) {
      html += `<div class="shop-subcats">
        <button class="shop-subcat-btn ${!_filterSubCat?'active':''}" onclick="shopFilterSubCat(null)">
          Tout (${catItems.length})
        </button>`;
      subCats.forEach(sc => {
        const scItems = catItems.filter(i => i.sousCategorieId === sc.id);
        html += `<button class="shop-subcat-btn ${_filterSubCat===sc.id?'active':''}"
                         onclick="shopFilterSubCat('${sc.id}')">
          ${sc.nom}
          <span class="shop-cat-count">${scItems.length}</span>
          ${STATE.isAdmin?`<button class="btn-icon" style="font-size:0.6rem;padding:0 0.2rem" onclick="event.stopPropagation();deleteSubCat('${cat.id}','${sc.id}')">✕</button>`:''}
        </button>`;
      });
      html += `</div>`;
    }

    if (isOpen && STATE.isAdmin) {
      html += `<button class="shop-add-subcat" onclick="openSubCatModal('${cat.id}')">+ sous-catégorie</button>`;
    }

    html += `</div>`;
  });

  html += `</div>`;

  // ── Zone articles ──
  html += `<div class="shop-content" id="shop-content">`;

  let displayItems = [..._items];
  if (_filterCat)    displayItems = displayItems.filter(i => i.categorieId === _filterCat);
  if (_filterSubCat) displayItems = displayItems.filter(i => i.sousCategorieId === _filterSubCat);

  if (displayItems.length === 0) {
    html += `<div class="empty-state"><div class="icon">📦</div><p>Aucun article dans cette catégorie.</p></div>`;
  } else {
    // Grouper par catégorie > sous-cat pour l'affichage "Tout"
    if (!_filterCat) {
      _cats.forEach(cat => {
        const catItems = displayItems.filter(i => i.categorieId === cat.id);
        if (catItems.length === 0) return;
        html += `<div class="shop-group-header">📁 ${cat.nom}</div>`;
        html += _renderItemsGrouped(cat, catItems);
      });
      // Items sans catégorie
      const orphans = displayItems.filter(i => !i.categorieId);
      if (orphans.length > 0) {
        html += `<div class="shop-group-header">📦 Divers</div>`;
        html += _renderItemsList(orphans);
      }
    } else {
      const cat = _cats.find(c => c.id === _filterCat);
      html += _renderItemsGrouped(cat, displayItems);
    }
  }

  html += `</div></div>`;
  content.innerHTML = html;
}

function _renderItemsGrouped(cat, items) {
  if (!cat) return _renderItemsList(items);
  const subCats = cat.sousCats||[];
  if (subCats.length === 0 || _filterSubCat) return _renderItemsList(items);

  let html = '';
  subCats.forEach(sc => {
    const scItems = items.filter(i => i.sousCategorieId === sc.id);
    if (scItems.length === 0) return;
    html += `<div class="shop-subgroup-header">└ ${sc.nom}</div>`;
    html += _renderItemsList(scItems);
  });
  // Items de la catégorie sans sous-cat
  const direct = items.filter(i => !i.sousCategorieId);
  if (direct.length > 0) {
    if (subCats.length > 0) html += `<div class="shop-subgroup-header">└ Général</div>`;
    html += _renderItemsList(direct);
  }
  return html;
}

function _renderItemsList(items) {
  return `<div class="shop-grid">` +
    items.map(item => `
    <div class="shop-item-card">
      <div class="shop-item-header">
        <div class="shop-item-name">${item.nom||'?'}</div>
        <div class="shop-item-price">💰 ${item.prix||0} or</div>
      </div>
      ${item.description?`<div class="shop-item-desc">${item.description}</div>`:''}
      ${item.proprietes?`<div class="shop-item-props">${item.proprietes}</div>`:''}
      ${STATE.isAdmin?`<div class="shop-item-actions">
        <button class="btn-icon" onclick="openItemModal('${item.id}')">✏️</button>
        <button class="btn-icon" onclick="deleteShopItem('${item.id}')">🗑️</button>
      </div>`:''}
    </div>`).join('') +
  `</div>`;
}

// ══════════════════════════════════════════════
// FILTRES
// ══════════════════════════════════════════════
function shopFilterCat(catId) {
  _filterCat    = catId;
  _filterSubCat = null;
  renderShop();
}
function shopFilterSubCat(subCatId) {
  _filterSubCat = subCatId;
  renderShop();
}

// ══════════════════════════════════════════════
// CATÉGORIES — CRUD
// ══════════════════════════════════════════════
function openCatModal(catId) {
  const cat = catId ? _cats.find(c => c.id === catId) : null;
  openModal(cat ? '✏️ Renommer la catégorie' : '📁 Nouvelle catégorie', `
    <div class="form-group">
      <label>Nom de la catégorie</label>
      <input class="input-field" id="cat-nom" value="${cat?.nom||''}" placeholder="Armes Physiques, Épicerie, Potions..." autofocus>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveCat('${catId||''}')">
      ${cat ? 'Renommer' : 'Créer la catégorie'}
    </button>
  `);
  setTimeout(() => document.getElementById('cat-nom')?.focus(), 50);
}

async function saveCat(catId) {
  const nom = document.getElementById('cat-nom')?.value.trim();
  if (!nom) return;
  if (catId) {
    await updateInCol('shopCategories', catId, { nom });
    showNotif('Catégorie renommée.', 'success');
  } else {
    await addToCol('shopCategories', { nom, ordre: _cats.length, sousCats: [] });
    showNotif('Catégorie créée !', 'success');
  }
  closeModalDirect();
  renderShop();
}

async function deleteCat(catId) {
  const catItems = _items.filter(i => i.categorieId === catId);
  if (catItems.length > 0) {
    if (!confirm(`Cette catégorie contient ${catItems.length} article(s). Supprimer quand même ? Les articles seront orphelins.`)) return;
  } else {
    if (!confirm('Supprimer cette catégorie ?')) return;
  }
  await deleteFromCol('shopCategories', catId);
  showNotif('Catégorie supprimée.', 'success');
  if (_filterCat === catId) _filterCat = null;
  renderShop();
}

// ══════════════════════════════════════════════
// SOUS-CATÉGORIES — CRUD (stockées dans la cat)
// ══════════════════════════════════════════════
function openSubCatModal(catId) {
  openModal('📂 Nouvelle sous-catégorie', `
    <div class="form-group">
      <label>Nom de la sous-catégorie</label>
      <input class="input-field" id="subcat-nom" placeholder="Épée, Lance, Arme secondaire..." autofocus>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveSubCat('${catId}')">
      Créer la sous-catégorie
    </button>
  `);
  setTimeout(() => document.getElementById('subcat-nom')?.focus(), 50);
}

async function saveSubCat(catId) {
  const nom = document.getElementById('subcat-nom')?.value.trim();
  if (!nom) return;
  const cat = _cats.find(c => c.id === catId);
  if (!cat) return;
  const sousCats = cat.sousCats||[];
  const newSc = { id: 'sc_' + Date.now(), nom };
  sousCats.push(newSc);
  await updateInCol('shopCategories', catId, { sousCats });
  showNotif('Sous-catégorie créée !', 'success');
  closeModalDirect();
  renderShop();
}

async function deleteSubCat(catId, scId) {
  const cat = _cats.find(c => c.id === catId);
  if (!cat) return;
  if (!confirm('Supprimer cette sous-catégorie ?')) return;
  const sousCats = (cat.sousCats||[]).filter(sc => sc.id !== scId);
  await updateInCol('shopCategories', catId, { sousCats });
  showNotif('Sous-catégorie supprimée.', 'success');
  if (_filterSubCat === scId) _filterSubCat = null;
  renderShop();
}

// ══════════════════════════════════════════════
// ARTICLES — CRUD
// ══════════════════════════════════════════════
function openItemModal(itemId) {
  const item = itemId ? _items.find(i => i.id === itemId) : null;

  // Construire les options catégorie + sous-cat
  const catOptions = _cats.map(c =>
    `<option value="${c.id}" ${item?.categorieId===c.id?'selected':''}>${c.nom}</option>`
  ).join('');

  // Sous-cats de la catégorie sélectionnée
  const selCat = item ? _cats.find(c => c.id === item.categorieId) : _cats[0];
  const subOptions = (selCat?.sousCats||[]).map(sc =>
    `<option value="${sc.id}" ${item?.sousCategorieId===sc.id?'selected':''}>${sc.nom}</option>`
  ).join('');

  openModal(item ? '✏️ Modifier l\'article' : '🛒 Nouvel article', `
    <div class="form-group">
      <label>Nom de l'article</label>
      <input class="input-field" id="si-nom" value="${item?.nom||''}" placeholder="Épée longue, Potion de soin...">
    </div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group">
        <label>Catégorie</label>
        <select class="input-field" id="si-cat" onchange="refreshSubCatSelect(this.value,'${item?.sousCategorieId||''}')">
          <option value="">— Aucune —</option>
          ${catOptions}
        </select>
      </div>
      <div class="form-group">
        <label>Sous-catégorie <span style="color:var(--text-dim);font-weight:400">(optionnel)</span></label>
        <select class="input-field" id="si-subcat">
          <option value="">— Aucune —</option>
          ${subOptions}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Prix (or)</label>
      <input type="number" class="input-field" id="si-prix" value="${item?.prix||0}" min="0" style="max-width:120px">
    </div>
    <div class="form-group">
      <label>Description / Effet</label>
      <textarea class="input-field" id="si-desc" rows="3" placeholder="Détails, effet passif, condition...">${item?.description||''}</textarea>
    </div>
    <div class="form-group">
      <label>Propriétés <span style="color:var(--text-dim);font-weight:400">(stats, traits)</span></label>
      <input class="input-field" id="si-props" value="${item?.proprietes||''}" placeholder="Lourd, +2 CA, 1M, Finesse...">
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveShopItem('${itemId||''}')">
      ${item ? 'Enregistrer les modifications' : 'Ajouter à la boutique'}
    </button>
  `);
}

// Met à jour les sous-cats quand on change de catégorie dans le modal
function refreshSubCatSelect(catId, currentScId) {
  const cat = _cats.find(c => c.id === catId);
  const sel = document.getElementById('si-subcat');
  if (!sel) return;
  const subOptions = (cat?.sousCats||[]).map(sc =>
    `<option value="${sc.id}" ${currentScId===sc.id?'selected':''}>${sc.nom}</option>`
  ).join('');
  sel.innerHTML = `<option value="">— Aucune —</option>${subOptions}`;
}

async function saveShopItem(itemId) {
  const data = {
    nom:             document.getElementById('si-nom')?.value.trim()||'?',
    categorieId:     document.getElementById('si-cat')?.value||'',
    sousCategorieId: document.getElementById('si-subcat')?.value||'',
    prix:            parseFloat(document.getElementById('si-prix')?.value)||0,
    description:     document.getElementById('si-desc')?.value.trim()||'',
    proprietes:      document.getElementById('si-props')?.value.trim()||'',
  };
  if (itemId) await updateInCol('shop', itemId, data);
  else        await addToCol('shop', data);
  closeModalDirect();
  showNotif('Article enregistré !', 'success');
  renderShop();
}

async function deleteShopItem(itemId) {
  if (!confirm('Supprimer cet article ?')) return;
  await deleteFromCol('shop', itemId);
  showNotif('Article supprimé.', 'success');
  renderShop();
}

// ── Compat legacy (ancienne boutique sans catégories) ──
function openShopItemModal(item) { openItemModal(item?.id); }
async function editShopItem(id)  { openItemModal(id); }

Object.assign(window, {
  renderShop,
  shopFilterCat, shopFilterSubCat,
  openCatModal, saveCat, deleteCat,
  openSubCatModal, saveSubCat, deleteSubCat,
  openItemModal, refreshSubCatSelect, saveShopItem,
  deleteShopItem,
  // legacy
  openShopItemModal, editShopItem,
});
