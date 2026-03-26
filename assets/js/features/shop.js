import { STATE }                                         from '../core/state.js';
import { loadCollection, addToCol, updateInCol,
         deleteFromCol }                                 from '../data/firestore.js';
import { openModal, closeModalDirect }                   from '../shared/modal.js';
import { showNotif }                                     from '../shared/notifications.js';
import PAGES                                             from './pages.js';

// ══════════════════════════════════════════════
// ÉTAT
// ══════════════════════════════════════════════
let _cats  = [];
let _items = [];
let _view  = 'home';   // 'home' | 'cat' | 'subcat'
let _activeCat    = null;
let _activeSubCat = null;
let _page  = 1;
const PAGE_SIZE = 12;

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
// RENDU PRINCIPAL — dispatch selon la vue
// ══════════════════════════════════════════════
async function renderShop() {
  await loadShopData();
  const content = document.getElementById('main-content');
  if (!content) return;

  let html = `<div class="sh-page">`;

  // Header page
  html += `<div class="page-header">
    <div class="page-title"><span class="page-title-accent">🛒</span> Boutique</div>
    <div class="page-subtitle">Équipements, consommables et merveilles</div>
  </div>`;

  // Admin toolbar
  if (STATE.isAdmin) {
    html += `<div class="admin-section">
      <div class="admin-label">Gestion Admin</div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
        <button class="btn btn-gold btn-sm" onclick="openCatModal()">📁 Nouvelle catégorie</button>
        <button class="btn btn-outline btn-sm" onclick="openItemModal()">＋ Article</button>
      </div>
    </div>`;
  }

  // Breadcrumb
  html += _renderBreadcrumb();

  // Contenu selon vue
  if (_view === 'home') {
    html += _renderHome();
  } else if (_view === 'cat') {
    html += _renderCatView();
  } else if (_view === 'subcat') {
    html += _renderItemsView();
  }

  html += `</div>`;
  content.innerHTML = html;
}

// ── Breadcrumb ────────────────────────────────
function _renderBreadcrumb() {
  if (_view === 'home') return '';
  let crumbs = [`<button class="sh-crumb sh-crumb-link" onclick="shopGoHome()">🛒 Boutique</button>`];
  if (_activeCat) {
    const cat = _cats.find(c => c.id === _activeCat);
    if (_view === 'cat') {
      crumbs.push(`<span class="sh-crumb-sep">›</span><span class="sh-crumb sh-crumb-active">${cat?.nom||''}</span>`);
    } else {
      crumbs.push(`<span class="sh-crumb-sep">›</span><button class="sh-crumb sh-crumb-link" onclick="shopGoCat('${_activeCat}')">${cat?.nom||''}</button>`);
    }
  }
  if (_activeSubCat && _activeCat) {
    const cat = _cats.find(c => c.id === _activeCat);
    const sc  = (cat?.sousCats||[]).find(s => s.id === _activeSubCat);
    crumbs.push(`<span class="sh-crumb-sep">›</span><span class="sh-crumb sh-crumb-active">${sc?.nom||''}</span>`);
  }
  return `<nav class="sh-breadcrumb">${crumbs.join('')}</nav>`;
}

// ══════════════════════════════════════════════
// VUE HOME — grille de catégories
// ══════════════════════════════════════════════
function _renderHome() {
  if (_cats.length === 0) {
    return `<div class="empty-state"><div class="icon">🛒</div>
      <p>La boutique est vide pour l'instant.</p>
      ${STATE.isAdmin?'<p style="font-size:0.82rem;margin-top:0.5rem;color:var(--text-dim)">Commence par créer une catégorie.</p>':''}</div>`;
  }

  let html = `<div class="sh-cat-grid">`;
  _cats.forEach(cat => {
    const count = _items.filter(i => i.categorieId === cat.id).length;
    const subCats = cat.sousCats||[];
    html += `<div class="sh-cat-card" onclick="shopGoCat('${cat.id}')">
      <div class="sh-cat-img" style="${cat.image?`background-image:url('${cat.image}')`:_catGradient(cat.nom)}">
        <div class="sh-cat-img-overlay"></div>
        <div class="sh-cat-img-emoji">${cat.emoji||_catEmoji(cat.nom)}</div>
      </div>
      <div class="sh-cat-body">
        <div class="sh-cat-name">${cat.nom}</div>
        <div class="sh-cat-meta">
          ${subCats.length>0
            ? `${subCats.length} sous-catégorie${subCats.length>1?'s':''} · `
            : ''}${count} article${count!==1?'s':''}
        </div>
        ${subCats.length>0?`<div class="sh-cat-subcats">
          ${subCats.slice(0,4).map(sc=>`<span class="sh-cat-subcat-tag">${sc.nom}</span>`).join('')}
          ${subCats.length>4?`<span class="sh-cat-subcat-tag sh-more">+${subCats.length-4}</span>`:''}
        </div>`:''}
      </div>
      ${STATE.isAdmin?`<div class="sh-card-admin" onclick="event.stopPropagation()">
        <button class="btn-icon" onclick="openCatModal('${cat.id}')" title="Modifier">✏️</button>
        <button class="btn-icon" onclick="deleteCat('${cat.id}')" title="Supprimer">🗑️</button>
      </div>`:''}
    </div>`;
  });
  html += `</div>`;
  return html;
}

// ══════════════════════════════════════════════
// VUE CAT — sous-catégories ou articles directs
// ══════════════════════════════════════════════
function _renderCatView() {
  const cat     = _cats.find(c => c.id === _activeCat);
  if (!cat) return '';
  const subCats = cat.sousCats||[];
  const direct  = _items.filter(i => i.categorieId === _activeCat && !i.sousCategorieId);

  // Si pas de sous-cats → afficher les articles directement
  if (subCats.length === 0) {
    _view = 'subcat';
    return _renderItemsView();
  }

  let html = `<div class="sh-subcat-grid">`;

  // Card "Tout" si articles directs ou pour tout voir
  const total = _items.filter(i => i.categorieId === _activeCat).length;
  html += `<div class="sh-subcat-card sh-subcat-all" onclick="shopGoSubCat(null)">
    <div class="sh-subcat-icon">📦</div>
    <div class="sh-subcat-name">Tout afficher</div>
    <div class="sh-subcat-count">${total} article${total!==1?'s':''}</div>
  </div>`;

  subCats.forEach(sc => {
    const count = _items.filter(i => i.categorieId === _activeCat && i.sousCategorieId === sc.id).length;
    html += `<div class="sh-subcat-card" onclick="shopGoSubCat('${sc.id}')">
      <div class="sh-subcat-icon">${sc.emoji||'📂'}</div>
      <div class="sh-subcat-name">${sc.nom}</div>
      <div class="sh-subcat-count">${count} article${count!==1?'s':''}</div>
      ${STATE.isAdmin?`<div class="sh-card-admin" onclick="event.stopPropagation()">
        <button class="btn-icon" onclick="openSubCatModal('${_activeCat}','${sc.id}')" title="Modifier">✏️</button>
        <button class="btn-icon" onclick="deleteSubCat('${_activeCat}','${sc.id}')" title="Supprimer">🗑️</button>
      </div>`:''}
    </div>`;
  });

  if (STATE.isAdmin) {
    html += `<div class="sh-subcat-card sh-subcat-add" onclick="openSubCatModal('${_activeCat}')">
      <div class="sh-subcat-icon">＋</div>
      <div class="sh-subcat-name">Nouvelle sous-cat.</div>
    </div>`;
  }

  html += `</div>`;

  // Articles directs (sans sous-cat) si il y en a
  if (direct.length > 0) {
    html += `<div class="sh-section-title" style="margin-top:1.5rem">Articles généraux</div>`;
    html += _renderItemGrid(direct);
  }

  return html;
}

// ══════════════════════════════════════════════
// VUE ARTICLES — grille paginée
// ══════════════════════════════════════════════
function _renderItemsView() {
  let items = _items.filter(i => i.categorieId === _activeCat);
  if (_activeSubCat) items = items.filter(i => i.sousCategorieId === _activeSubCat);

  if (items.length === 0) {
    return `<div class="empty-state"><div class="icon">📦</div>
      <p>Aucun article ici pour l'instant.</p>
      ${STATE.isAdmin?`<button class="btn btn-gold btn-sm" style="margin-top:0.8rem" onclick="openItemModal()">＋ Ajouter un article</button>`:''}</div>`;
  }

  // Pagination
  const total   = items.length;
  const pages   = Math.ceil(total / PAGE_SIZE);
  const p       = Math.max(1, Math.min(_page, pages));
  const slice   = items.slice((p-1)*PAGE_SIZE, p*PAGE_SIZE);

  let html = `<div class="sh-items-header">
    <span class="sh-items-count">${total} article${total!==1?'s':''}</span>
    ${STATE.isAdmin?`<button class="btn btn-gold btn-sm" onclick="openItemModal()">＋ Article</button>`:''}
  </div>`;

  html += _renderItemGrid(slice);

  // Pagination
  if (pages > 1) {
    html += `<div class="sh-pagination">`;
    if (p > 1) html += `<button class="sh-page-btn" onclick="shopPage(${p-1})">← Précédent</button>`;
    for (let i=1; i<=pages; i++) {
      html += `<button class="sh-page-btn ${i===p?'active':''}" onclick="shopPage(${i})">${i}</button>`;
    }
    if (p < pages) html += `<button class="sh-page-btn" onclick="shopPage(${p+1})">Suivant →</button>`;
    html += `</div>`;
  }

  return html;
}

function _renderItemGrid(items) {
  return `<div class="sh-item-grid">` +
    items.map(item => `
    <div class="sh-item-card">
      <div class="sh-item-img" style="${item.image?`background-image:url('${item.image}')`:_itemPlaceholder(item.nom)}">
        <div class="sh-item-img-overlay"></div>
        ${item.prix!=null?`<div class="sh-item-price-badge">💰 ${item.prix} or</div>`:''}
      </div>
      <div class="sh-item-body">
        <div class="sh-item-name">${item.nom||'?'}</div>
        ${item.proprietes?`<div class="sh-item-props">${item.proprietes}</div>`:''}
        ${item.description?`<div class="sh-item-desc">${item.description}</div>`:''}
      </div>
      ${STATE.isAdmin?`<div class="sh-item-actions">
        <button class="btn-icon" onclick="openItemModal('${item.id}')">✏️</button>
        <button class="btn-icon" onclick="deleteShopItem('${item.id}')">🗑️</button>
      </div>`:''}
    </div>`).join('') +
  `</div>`;
}

// ══════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════
function shopGoHome() {
  _view = 'home'; _activeCat = null; _activeSubCat = null; _page = 1;
  renderShop();
}
function shopGoCat(catId) {
  _view = 'cat'; _activeCat = catId; _activeSubCat = null; _page = 1;
  renderShop();
}
function shopGoSubCat(subCatId) {
  _view = 'subcat'; _activeSubCat = subCatId; _page = 1;
  renderShop();
}
function shopPage(p) { _page = p; renderShop(); }

// ══════════════════════════════════════════════
// HELPERS VISUELS
// ══════════════════════════════════════════════
function _catGradient(nom) {
  const gradients = [
    'linear-gradient(135deg,#1a1f3a,#2d3561)',
    'linear-gradient(135deg,#1a2f1a,#2d5230)',
    'linear-gradient(135deg,#2f1a1a,#523030)',
    'linear-gradient(135deg,#1a2a2f,#1d4a52)',
    'linear-gradient(135deg,#2a1a2f,#4a2052)',
    'linear-gradient(135deg,#2f2a1a,#524a20)',
  ];
  const i = nom.charCodeAt(0) % gradients.length;
  return `background:${gradients[i]}`;
}
function _catEmoji(nom) {
  const n = nom.toLowerCase();
  if (n.includes('arme'))    return '⚔️';
  if (n.includes('armor') || n.includes('armure')) return '🛡️';
  if (n.includes('potion'))  return '🧪';
  if (n.includes('magie') || n.includes('rune')) return '✨';
  if (n.includes('épicerie') || n.includes('food') || n.includes('cuisine')) return '🍖';
  if (n.includes('monture'))  return '🐴';
  if (n.includes('outil'))   return '🔧';
  return '📦';
}
function _itemPlaceholder(nom) {
  const g = _catGradient(nom||'?');
  return g;
}

// ══════════════════════════════════════════════
// MODALS — CATÉGORIES
// ══════════════════════════════════════════════
function openCatModal(catId) {
  const cat = catId ? _cats.find(c => c.id === catId) : null;
  openModal(cat ? '✏️ Modifier la catégorie' : '📁 Nouvelle catégorie', `
    <div class="form-group">
      <label>Nom</label>
      <input class="input-field" id="cat-nom" value="${cat?.nom||''}" placeholder="Armes Physiques, Épicerie...">
    </div>
    <div class="form-group">
      <label>Emoji <span style="color:var(--text-dim);font-weight:400">(optionnel)</span></label>
      <input class="input-field" id="cat-emoji" value="${cat?.emoji||''}" placeholder="⚔️ 🛡️ 🧪 ..." style="max-width:100px">
    </div>
    <div class="form-group">
      <label>Image <span style="color:var(--text-dim);font-weight:400">(URL, optionnel)</span></label>
      <input class="input-field" id="cat-image" value="${cat?.image||''}" placeholder="https://...">
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveCat('${catId||''}')">
      ${cat?'Enregistrer':'Créer'}
    </button>
  `);
  setTimeout(() => document.getElementById('cat-nom')?.focus(), 50);
}

async function saveCat(catId) {
  const nom   = document.getElementById('cat-nom')?.value.trim();
  const emoji = document.getElementById('cat-emoji')?.value.trim();
  const image = document.getElementById('cat-image')?.value.trim();
  if (!nom) { showNotif('Nom requis.','error'); return; }
  if (catId) {
    await updateInCol('shopCategories', catId, { nom, emoji, image });
    showNotif('Catégorie mise à jour.','success');
  } else {
    await addToCol('shopCategories', { nom, emoji, image, ordre: _cats.length, sousCats: [] });
    showNotif('Catégorie créée !','success');
  }
  closeModalDirect();
  renderShop();
}

async function deleteCat(catId) {
  const n = _items.filter(i => i.categorieId === catId).length;
  const msg = n > 0
    ? `Cette catégorie contient ${n} article(s). Supprimer quand même ?`
    : 'Supprimer cette catégorie ?';
  if (!confirm(msg)) return;
  await deleteFromCol('shopCategories', catId);
  showNotif('Catégorie supprimée.','success');
  if (_activeCat === catId) { _view='home'; _activeCat=null; }
  renderShop();
}

// ══════════════════════════════════════════════
// MODALS — SOUS-CATÉGORIES
// ══════════════════════════════════════════════
function openSubCatModal(catId, scId) {
  const cat = _cats.find(c => c.id === catId);
  const sc  = scId ? (cat?.sousCats||[]).find(s => s.id === scId) : null;
  openModal(sc ? '✏️ Modifier la sous-catégorie' : '📂 Nouvelle sous-catégorie', `
    <div class="form-group">
      <label>Nom</label>
      <input class="input-field" id="sc-nom" value="${sc?.nom||''}" placeholder="Épée, Lance, Arme secondaire...">
    </div>
    <div class="form-group">
      <label>Emoji <span style="color:var(--text-dim);font-weight:400">(optionnel)</span></label>
      <input class="input-field" id="sc-emoji" value="${sc?.emoji||''}" placeholder="⚔️ 📂 ..." style="max-width:100px">
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveSubCat('${catId}','${scId||''}')">
      ${sc?'Enregistrer':'Créer'}
    </button>
  `);
  setTimeout(() => document.getElementById('sc-nom')?.focus(), 50);
}

async function saveSubCat(catId, scId) {
  const nom   = document.getElementById('sc-nom')?.value.trim();
  const emoji = document.getElementById('sc-emoji')?.value.trim();
  if (!nom) { showNotif('Nom requis.','error'); return; }
  const cat = _cats.find(c => c.id === catId);
  if (!cat) return;
  const sousCats = cat.sousCats||[];
  if (scId) {
    const idx = sousCats.findIndex(s => s.id === scId);
    if (idx >= 0) sousCats[idx] = { ...sousCats[idx], nom, emoji };
  } else {
    sousCats.push({ id: 'sc_' + Date.now(), nom, emoji });
  }
  await updateInCol('shopCategories', catId, { sousCats });
  showNotif(scId ? 'Sous-catégorie mise à jour.' : 'Sous-catégorie créée !','success');
  closeModalDirect();
  renderShop();
}

async function deleteSubCat(catId, scId) {
  if (!confirm('Supprimer cette sous-catégorie ?')) return;
  const cat = _cats.find(c => c.id === catId);
  if (!cat) return;
  const sousCats = (cat.sousCats||[]).filter(s => s.id !== scId);
  await updateInCol('shopCategories', catId, { sousCats });
  showNotif('Sous-catégorie supprimée.','success');
  if (_activeSubCat === scId) { _view='cat'; _activeSubCat=null; }
  renderShop();
}

// ══════════════════════════════════════════════
// MODALS — ARTICLES
// ══════════════════════════════════════════════
function openItemModal(itemId) {
  const item = itemId ? _items.find(i => i.id === itemId) : null;

  const catOptions = _cats.map(c =>
    `<option value="${c.id}" ${item?.categorieId===c.id?'selected':''}>${c.nom}</option>`
  ).join('');

  const selCat  = item ? _cats.find(c => c.id === item.categorieId) : (_activeCat ? _cats.find(c=>c.id===_activeCat) : _cats[0]);
  const subOpts = (selCat?.sousCats||[]).map(sc =>
    `<option value="${sc.id}" ${item?.sousCategorieId===sc.id?'selected':''}>${sc.nom}</option>`
  ).join('');

  openModal(item ? '✏️ Modifier l\'article' : '🛒 Nouvel article', `
    <div class="form-group">
      <label>Nom</label>
      <input class="input-field" id="si-nom" value="${item?.nom||''}" placeholder="Épée longue, Potion de soin...">
    </div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group">
        <label>Catégorie</label>
        <select class="input-field" id="si-cat" onchange="refreshSubCatSelect(this.value,'')">
          <option value="">— Aucune —</option>
          ${catOptions}
        </select>
      </div>
      <div class="form-group">
        <label>Sous-catégorie <span style="font-weight:400;color:var(--text-dim)">(opt.)</span></label>
        <select class="input-field" id="si-subcat">
          <option value="">— Aucune —</option>
          ${subOpts}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Prix (or)</label>
      <input type="number" class="input-field" id="si-prix" value="${item?.prix??0}" min="0" style="max-width:120px">
    </div>
    <div class="form-group">
      <label>Image <span style="font-weight:400;color:var(--text-dim)">(URL)</span></label>
      <input class="input-field" id="si-image" value="${item?.image||''}" placeholder="https://...">
    </div>
    <div class="form-group">
      <label>Propriétés <span style="font-weight:400;color:var(--text-dim)">(stats, traits)</span></label>
      <input class="input-field" id="si-props" value="${item?.proprietes||''}" placeholder="Lourd, +2 CA, Finesse...">
    </div>
    <div class="form-group">
      <label>Description</label>
      <textarea class="input-field" id="si-desc" rows="3">${item?.description||''}</textarea>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveShopItem('${itemId||''}')">
      ${item?'Enregistrer':'Ajouter'}
    </button>
  `);
}

function refreshSubCatSelect(catId, currentScId) {
  const cat = _cats.find(c => c.id === catId);
  const sel = document.getElementById('si-subcat');
  if (!sel) return;
  sel.innerHTML = `<option value="">— Aucune —</option>` +
    (cat?.sousCats||[]).map(sc =>
      `<option value="${sc.id}" ${currentScId===sc.id?'selected':''}>${sc.nom}</option>`
    ).join('');
}

async function saveShopItem(itemId) {
  const nom = document.getElementById('si-nom')?.value.trim();
  if (!nom) { showNotif('Nom requis.','error'); return; }
  const data = {
    nom,
    categorieId:     document.getElementById('si-cat')?.value||'',
    sousCategorieId: document.getElementById('si-subcat')?.value||'',
    prix:            parseFloat(document.getElementById('si-prix')?.value)||0,
    image:           document.getElementById('si-image')?.value.trim()||'',
    proprietes:      document.getElementById('si-props')?.value.trim()||'',
    description:     document.getElementById('si-desc')?.value.trim()||'',
  };
  if (itemId) await updateInCol('shop', itemId, data);
  else        await addToCol('shop', data);
  closeModalDirect();
  showNotif('Article enregistré !','success');
  renderShop();
}

async function deleteShopItem(itemId) {
  if (!confirm('Supprimer cet article ?')) return;
  await deleteFromCol('shop', itemId);
  showNotif('Article supprimé.','success');
  renderShop();
}

// ── Legacy compat ──
function openShopItemModal(item) { openItemModal(item?.id); }
async function editShopItem(id)  { openItemModal(id); }
function filterShop() {}

Object.assign(window, {
  renderShop,
  shopGoHome, shopGoCat, shopGoSubCat, shopPage,
  openCatModal, saveCat, deleteCat,
  openSubCatModal, saveSubCat, deleteSubCat,
  openItemModal, refreshSubCatSelect, saveShopItem, deleteShopItem,
  openShopItemModal, editShopItem, filterShop,
});
