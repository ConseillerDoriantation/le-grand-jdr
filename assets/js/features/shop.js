import { STATE } from '../core/state.js';
import { loadCollection, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { openModal, closeModalDirect } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATES DE CHAMPS PAR TYPE DE BOUTIQUE
// ══════════════════════════════════════════════════════════════════════════════
const TEMPLATES = {
  arme: {
    label: '⚔️ Arme',
    fields: [
      { id:'format',   label:'Format',   type:'text',   placeholder:'Épée 1M, Lance 2M, Arc...' },
      { id:'rarete',   label:'Rareté',   type:'rarete' },
      { id:'degats',   label:'Dégâts',   type:'text',   placeholder:'1D10, 2D6...' },
      { id:'toucher',  label:'Toucher',  type:'text',   placeholder:'+Fo, +Dex...' },
      { id:'stats',    label:'Stats',    type:'text',   placeholder:'+2 Fo, +1 Dex...' },
      { id:'trait',    label:'Trait',    type:'text',   placeholder:'Lourd, Finesse, Polyvalent...' },
      { id:'prix',     label:'Prix 🪙',  type:'number', placeholder:'0' },
      { id:'dispo',    label:'Dispo',    type:'dispo' },
    ],
  },
  armure: {
    label: '🛡️ Armure',
    fields: [
      { id:'rarete',   label:'Rareté',   type:'rarete' },
      { id:'ca',       label:'CA',       type:'text',   placeholder:'10, 12, 14...' },
      { id:'stats',    label:'Stats',    type:'text',   placeholder:'+2 Co, +1 Fo...' },
      { id:'trait',    label:'Trait',    type:'text',   placeholder:'Lourd, Magique...' },
      { id:'prix',     label:'Prix 🪙',  type:'number', placeholder:'0' },
      { id:'dispo',    label:'Dispo',    type:'dispo' },
    ],
  },
  classique: {
    label: '🧪 Classique',
    fields: [
      { id:'type',        label:'Type',        type:'text',     placeholder:'Consommable, Matériau, Accessoire...' },
      { id:'effet',       label:'Effet',       type:'textarea', placeholder:'(Action) Rend 10 PV...' },
      { id:'description', label:'Description', type:'textarea', placeholder:'Détails...' },
      { id:'prix',        label:'Prix 🪙',     type:'number',   placeholder:'0' },
      { id:'dispo',       label:'Dispo',       type:'dispo' },
    ],
  },
  libre: {
    label: '📦 Libre',
    fields: [
      { id:'type',        label:'Type',        type:'text',     placeholder:'Type...' },
      { id:'description', label:'Description', type:'textarea', placeholder:'...' },
      { id:'prix',        label:'Prix 🪙',     type:'number',   placeholder:'0' },
      { id:'dispo',       label:'Dispo',       type:'dispo' },
    ],
  },
};

const PRIX_VENTE_RATIO = 0.6; // 60%

// ══════════════════════════════════════════════════════════════════════════════
// ÉTAT
// ══════════════════════════════════════════════════════════════════════════════
let _cats  = [];
let _items = [];
let _view  = 'home';
let _activeCat    = null;
let _activeSubCat = null;
let _page = 1;
const PAGE_SIZE = 12;

// ══════════════════════════════════════════════════════════════════════════════
// CHARGEMENT
// ══════════════════════════════════════════════════════════════════════════════
async function loadShopData() {
  [_cats, _items] = await Promise.all([
    loadCollection('shopCategories'),
    loadCollection('shop'),
  ]);
  _cats.sort((a,b) => (a.ordre||0)-(b.ordre||0));
  _items.sort((a,b) => (a.ordre??999)-(b.ordre??999));
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function _getTemplate(catId) {
  const cat = _cats.find(c => c.id === catId);
  return TEMPLATES[cat?.template || 'classique'] || TEMPLATES.classique;
}

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
  if (n.includes('potion'))                        return '🧪';
  if (n.includes('magie') || n.includes('rune'))   return '✨';
  if (n.includes('épicerie') || n.includes('cuisine')) return '🍖';
  if (n.includes('outil'))                         return '🔧';
  return '📦';
}

function _rareteColor(r) {
  const map = {
    'Commun':'#9ca3af','Peu commun':'#4ade80','Rare':'#60a5fa',
    'Très rare':'#c084fc','Légendaire':'#fbbf24',
  };
  return map[r] || 'var(--text-dim)';
}

function _rareteStars(val) {
  const n = parseInt(val)||0;
  if (n <= 0) return '';
  const colors = ['','#9ca3af','#4ade80','#60a5fa','#c084fc'];
  const labels = ['','Commun','Peu commun','Rare','Très rare'];
  const stars = '★'.repeat(n) + '☆'.repeat(4-n);
  const color = colors[n]||'var(--text-dim)';
  return `<span class="sh-rarete-stars" style="color:${color}" title="${labels[n]||''}">${stars}</span>`;
}

function _dispoDisplay(val) {
  if (val === '' || val === null || val === undefined) return '';
  const n = parseInt(val);
  if (isNaN(n) || n < 0) return `<span style="color:var(--green);font-weight:600">∞ Illimité</span>`;
  if (n === 0) return `<span style="color:var(--crimson-light);font-weight:700">Épuisé</span>`;
  return `<span style="color:var(--green);font-weight:700">${n} dispo.</span>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// OR D'UN PERSONNAGE (solde du compte)
// ══════════════════════════════════════════════════════════════════════════════
function _getOr(c) {
  if (!c) return 0;
  const compte = c.compte||{recettes:[],depenses:[]};
  const r = (compte.recettes||[]).reduce((s,x)=>s+(parseFloat(x.montant)||0),0);
  const d = (compte.depenses||[]).reduce((s,x)=>s+(parseFloat(x.montant)||0),0);
  return Math.round((r - d) * 100) / 100;
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDER PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
async function renderShop() {
  await loadShopData();
  const content = document.getElementById('main-content');
  if (!content) return;

  let html = `<div class="sh-page">
  <div class="page-header">
    <div class="page-title"><span class="page-title-accent">🛒</span> Boutique</div>
    <div class="page-subtitle">Équipements, consommables et merveilles</div>
  </div>`;

  if (STATE.isAdmin) {
    html += `<div class="admin-section">
      <div class="admin-label">Gestion Admin</div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
        <button class="btn btn-gold btn-sm" onclick="openCatModal()">📁 Nouvelle catégorie</button>
        <button class="btn btn-outline btn-sm" onclick="openItemModal()">＋ Article</button>
      </div>
    </div>`;
  }

  // Sélecteur personnage + or
  if (STATE.characters && STATE.characters.length > 0) {
    const chars    = STATE.isAdmin ? STATE.characters : STATE.characters.filter(c => c.uid === STATE.user?.uid);
    const activeId = window._shopCharId || chars[0]?.id || '';
    if (!window._shopCharId) window._shopCharId = activeId;
    const activeChar = chars.find(c => c.id === activeId);
    const or = _getOr(activeChar);
    html += `<div class="sh-char-selector">
      <span class="sh-char-selector-label">🧙 Acheter en tant que</span>
      <select class="input-field sh-modal-select sh-char-select" id="sh-char-sel" onchange="shopSetChar(this.value)">
        ${chars.map(c=>`<option value="${c.id}" ${activeId===c.id?'selected':''}>${c.nom||'?'}</option>`).join('')}
      </select>
      <span class="sh-char-or" id="sh-char-or-display">💰 ${or} or</span>
    </div>`;
  }

  html += _renderBreadcrumb();
  if      (_view === 'home')   html += _renderHome();
  else if (_view === 'cat')    html += _renderCatView();
  else if (_view === 'subcat') html += _renderItemsView();
  html += `</div>`;
  content.innerHTML = html;
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────
function _renderBreadcrumb() {
  if (_view === 'home') return '';
  const cat = _cats.find(c => c.id === _activeCat);
  const sc  = cat && _activeSubCat ? (cat.sousCats||[]).find(s => s.id === _activeSubCat) : null;
  let crumbs = [`<button class="sh-crumb sh-crumb-link" onclick="shopGoHome()">🛒 Boutique</button>`];
  if (cat) {
    if (_view === 'cat')
      crumbs.push(`<span class="sh-crumb-sep">›</span><span class="sh-crumb sh-crumb-active">${cat.nom}</span>`);
    else
      crumbs.push(`<span class="sh-crumb-sep">›</span><button class="sh-crumb sh-crumb-link" onclick="shopGoCat('${cat.id}')">${cat.nom}</button>`);
  }
  if (sc)
    crumbs.push(`<span class="sh-crumb-sep">›</span><span class="sh-crumb sh-crumb-active">${sc.nom}</span>`);
  return `<nav class="sh-breadcrumb">${crumbs.join('')}</nav>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// VUE HOME
// ══════════════════════════════════════════════════════════════════════════════
function _renderHome() {
  if (_cats.length === 0) {
    return `<div class="empty-state"><div class="icon">🛒</div>
      <p>La boutique est vide.</p>
      ${STATE.isAdmin?'<p style="font-size:0.82rem;margin-top:0.5rem;color:var(--text-dim)">Crée une catégorie pour commencer.</p>':''}</div>`;
  }
  let html = `<div class="sh-cat-grid">`;
  _cats.forEach(cat => {
    const count   = _items.filter(i => i.categorieId === cat.id).length;
    const subCats = cat.sousCats||[];
    const tpl     = TEMPLATES[cat.template||'classique'];
    html += `<div class="sh-cat-card ${STATE.isAdmin?'sh-cat-draggable':''}"
      draggable="${STATE.isAdmin?'true':'false'}" data-cat-id="${cat.id}"
      ondragstart="${STATE.isAdmin?`shopCatDragStart(event,'${cat.id}')`:''}"
      ondragover="${STATE.isAdmin?'shopCatDragOver(event)':''}"
      ondrop="${STATE.isAdmin?`shopCatDrop(event,'${cat.id}')`:''}"
      ondragend="${STATE.isAdmin?'shopCatDragEnd(event)':''}"
      onclick="shopGoCat('${cat.id}')">
      <div class="sh-cat-img" style="${cat.image?`background-image:url('${cat.image}')`:_catGradient(cat.nom)}">
        <div class="sh-cat-img-overlay"></div>
        ${!cat.image?`<div class="sh-cat-img-emoji">${cat.emoji||_catEmoji(cat.nom)}</div>`:''}
        ${tpl?`<span class="sh-cat-tpl-badge">${tpl.label}</span>`:''}
      </div>
      <div class="sh-cat-body">
        <div class="sh-cat-name-row">
          <div class="sh-cat-name">${cat.nom}</div>
          ${STATE.isAdmin?`<div class="sh-card-admin-inline" onclick="event.stopPropagation()">
            <button class="btn-icon" onclick="openCatModal('${cat.id}')">✏️</button>
            <button class="btn-icon" onclick="deleteCat('${cat.id}')">🗑️</button>
          </div>`:''}
        </div>
        <div class="sh-cat-meta">${subCats.length>0?`${subCats.length} sous-cat. · `:''}${count} article${count!==1?'s':''}</div>
        ${subCats.length>0?`<div class="sh-cat-subcats">
          ${subCats.slice(0,4).map(sc=>`<span class="sh-cat-subcat-tag">${sc.nom}</span>`).join('')}
          ${subCats.length>4?`<span class="sh-cat-subcat-tag">+${subCats.length-4}</span>`:''}
        </div>`:''}
      </div>
    </div>`;
  });
  html += `</div>`;
  return html;
}

// ══════════════════════════════════════════════════════════════════════════════
// VUE CATÉGORIE
// ══════════════════════════════════════════════════════════════════════════════
function _renderCatView() {
  const cat     = _cats.find(c => c.id === _activeCat);
  if (!cat) return '';
  const subCats = cat.sousCats||[];
  if (subCats.length === 0 && !STATE.isAdmin) { _view='subcat'; return _renderItemsView(); }
  const total   = _items.filter(i => i.categorieId === _activeCat).length;
  let html = `<div class="sh-subcat-grid">
    <div class="sh-subcat-card sh-subcat-all" onclick="shopGoSubCat(null)">
      <div class="sh-subcat-icon">📦</div>
      <div class="sh-subcat-name">Tout afficher</div>
      <div class="sh-subcat-count">${total} article${total!==1?'s':''}</div>
    </div>`;
  subCats.forEach(sc => {
    const cnt = _items.filter(i => i.categorieId===_activeCat && i.sousCategorieId===sc.id).length;
    html += `<div class="sh-subcat-card ${STATE.isAdmin?'sh-dnd-handle':''}"
      ${STATE.isAdmin?`draggable="true" ondragstart="shopScDragStart(event,'${sc.id}')" ondragover="shopScDragOver(event)" ondrop="shopScDrop(event,'${sc.id}')" ondragend="shopScDragEnd(event)"`:''}> 
      <div class="sh-subcat-click-area" onclick="shopGoSubCat('${sc.id}')">
        <div class="sh-subcat-icon">${sc.image?`<img src="${sc.image}" style="width:2rem;height:2rem;object-fit:cover;border-radius:6px">`:sc.emoji||'📂'}</div>
        <div class="sh-subcat-name">${sc.nom}</div>
        <div class="sh-subcat-count">${cnt} article${cnt!==1?'s':''}</div>
      </div>
      ${STATE.isAdmin?`<div class="sh-card-admin-subcat" onclick="event.stopPropagation()">
        <button class="btn-icon" onclick="openSubCatModal('${_activeCat}','${sc.id}')">✏️</button>
        <button class="btn-icon" onclick="deleteSubCat('${_activeCat}','${sc.id}')">🗑️</button>
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
  const allItems = _items.filter(i => i.categorieId === _activeCat);
  if (allItems.length > 0) html += `<div style="margin-top:1.5rem">${_renderItemsView()}</div>`;
  return html;
}

// ══════════════════════════════════════════════════════════════════════════════
// VUE ARTICLES
// ══════════════════════════════════════════════════════════════════════════════
function _renderItemsView() {
  let items = _items.filter(i => i.categorieId === _activeCat);
  if (_activeSubCat) items = items.filter(i => i.sousCategorieId === _activeSubCat);
  const cat   = _cats.find(c => c.id === _activeCat);
  if (items.length === 0) {
    return `<div class="empty-state"><div class="icon">📦</div>
      <p>Aucun article ici.</p>
      ${STATE.isAdmin?`<button class="btn btn-gold btn-sm" style="margin-top:0.8rem" onclick="openItemModal()">＋ Ajouter</button>`:''}</div>`;
  }
  const total = items.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  const p     = Math.max(1, Math.min(_page, pages));
  const slice = items.slice((p-1)*PAGE_SIZE, p*PAGE_SIZE);
  const allRaretes  = [...new Set(_items.filter(i=>i.categorieId===_activeCat&&i.rarete).map(i=>i.rarete))];
  const RARETE_LABELS = {1:'★ Commun',2:'★★ Peu commun',3:'★★★ Rare',4:'★★★★ Très rare'};
  const activeRarete = window._shopFilterRarete||'';
  const activeDispo  = window._shopFilterDispo||'';

  let html = `<div class="sh-filter-bar">
    <div class="sh-search-wrap">
      <input type="text" class="sh-search-input" id="sh-search" placeholder="🔍 Rechercher..."
        oninput="shopFilterSearch(this.value)" value="${window._shopSearch||''}">
    </div>
    <div class="sh-filter-chips">
      ${allRaretes.length>0?allRaretes.sort().map(r=>`
        <button class="sh-filter-chip ${activeRarete===r?'active':''}" onclick="shopFilterBy('rarete','${r}')">
          ${RARETE_LABELS[r]||('★'.repeat(r))}
        </button>`).join(''):''}
      <button class="sh-filter-chip ${activeDispo==='dispo'?'active':''}" onclick="shopFilterBy('dispo','dispo')">En stock</button>
      ${activeRarete||activeDispo||window._shopSearch?`
        <button class="sh-filter-chip sh-filter-reset" onclick="shopFilterReset()">✕ Effacer</button>`:''
      }
    </div>
    <div style="display:flex;gap:0.5rem;align-items:center;flex-shrink:0">
      <span class="sh-items-count">${total} article${total!==1?'s':''}</span>
      ${STATE.isAdmin?`<button class="btn btn-outline btn-sm" onclick="shopGoCat('${_activeCat}')">📂 Sous-cat.</button>`:''}
      ${STATE.isAdmin?`<button class="btn btn-gold btn-sm" onclick="openItemModal()">＋ Article</button>`:''}
    </div>
  </div>`;

  html += _renderItemGrid(cat, slice);

  if (pages > 1) {
    html += `<div class="sh-pagination">`;
    if (p>1)   html += `<button class="sh-page-btn" onclick="shopPage(${p-1})">← Précédent</button>`;
    for (let i=1;i<=pages;i++) html += `<button class="sh-page-btn ${i===p?'active':''}" onclick="shopPage(${i})">${i}</button>`;
    if (p<pages) html += `<button class="sh-page-btn" onclick="shopPage(${p+1})">Suivant →</button>`;
    html += `</div>`;
  }
  return html;
}

// ══════════════════════════════════════════════════════════════════════════════
// CARDS ARTICLES
// ══════════════════════════════════════════════════════════════════════════════
function _renderItemGrid(cat, items) {
  const tplKey = cat?.template || 'classique';
  return `<div class="sh-item-grid" id="sh-items-grid">` +
    items.map((item,i) => _renderItemCard(item, tplKey, i)).join('') +
    `</div>`;
}

function _renderItemCard(item, tplKey, itemIdx) {
  const prix      = parseFloat(item.prix)||0;
  const prixVente = Math.round(prix * PRIX_VENTE_RATIO);
  const dispo     = item.dispo !== undefined && item.dispo !== '' ? parseInt(item.dispo) : null;
  const epuise    = dispo !== null && dispo === 0;
  const illimite  = dispo === null || dispo < 0;

  // ── Bloc infos selon template ──────────────────────────────────────────────
  let infoHtml = '';
  if (tplKey === 'arme') {
    infoHtml = `
      <div class="sh-item-tags">
        ${item.format  ? `<span class="sh-tag">${item.format}</span>` : ''}
        ${item.rarete  ? _rareteStars(item.rarete) : ''}
        ${dispo !== undefined && dispo !== '' ? _dispoDisplay(item.dispo) : ''}
      </div>
      ${item.degats || item.toucher ? `<div class="sh-item-combat">
        ${item.degats  ? `<span class="sh-combat-chip"><span class="sh-cc-label">Dégâts</span><span class="sh-cc-val red">${item.degats}</span></span>` : ''}
        ${item.toucher ? `<span class="sh-combat-chip"><span class="sh-cc-label">Toucher</span><span class="sh-cc-val gold">${item.toucher}</span></span>` : ''}
      </div>` : ''}
      ${item.stats ? `<div class="sh-item-stats">${item.stats}</div>` : ''}
      ${item.trait ? `<div class="sh-item-trait"><em>${item.trait}</em></div>` : ''}`;
  } else if (tplKey === 'armure') {
    infoHtml = `
      <div class="sh-item-tags">
        ${item.rarete ? _rareteStars(item.rarete) : ''}
        ${item.ca     ? `<span class="sh-tag">🛡️ CA ${item.ca}</span>` : ''}
        ${dispo !== undefined && dispo !== '' ? _dispoDisplay(item.dispo) : ''}
      </div>
      ${item.stats ? `<div class="sh-item-stats">${item.stats}</div>` : ''}
      ${item.trait ? `<div class="sh-item-trait"><em>${item.trait}</em></div>` : ''}`;
  } else {
    infoHtml = `
      ${item.type   ? `<div class="sh-item-type">${item.type}</div>` : ''}
      ${item.effet  ? `<div class="sh-item-effet">${item.effet}</div>` : ''}
      ${item.description ? `<div class="sh-item-desc-tooltip" title="${item.description.replace(/"/g,'&quot;')}">ℹ️ <span>${item.description.length>60?item.description.slice(0,60)+'…':item.description}</span></div>` : ''}
      ${dispo !== undefined && dispo !== '' ? `<div class="sh-item-tags">${_dispoDisplay(item.dispo)}</div>` : ''}`;
  }

  const hasChar = !!window._shopCharId;

  return `<div class="sh-item-card ${STATE.isAdmin?'sh-dnd-handle':''}"
    ${STATE.isAdmin&&itemIdx!==''?`draggable="true" ondragstart="shopItemDragStart(event,'${item.id}')" ondragover="shopItemDragOver(event)" ondrop="shopItemDrop(event,'${item.id}')" ondragend="shopItemDragEnd(event)"`:''}>
    <div class="sh-item-img" style="${item.image?`background-image:url('${item.image}')`:_catGradient(item.nom||'')}">
      <div class="sh-item-img-overlay"></div>
    </div>
    <div class="sh-item-body">
      <div class="sh-item-name">${item.nom||'?'}</div>
      ${infoHtml}
      <div class="sh-item-prix-row">
        <div class="sh-item-prix-achat">💰 ${prix} or</div>
        <div class="sh-item-prix-vente" title="Prix de revente (60%)">🔄 ${prixVente} or</div>
      </div>
      ${hasChar ? (
        epuise
          ? `<button class="btn sh-buy-btn" disabled style="opacity:0.4;cursor:not-allowed">Épuisé</button>`
          : `<button class="btn sh-buy-btn" onclick="buyItem('${item.id}')">🛒 Acheter</button>`
      ) : ''}
    </div>
    ${STATE.isAdmin?`<div class="sh-item-actions">
      <button class="btn-icon" onclick="openItemModal('${item.id}')">✏️</button>
      <button class="btn-icon" onclick="deleteShopItem('${item.id}')">🗑️</button>
    </div>`:''}
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// SÉLECTEUR PERSONNAGE
// ══════════════════════════════════════════════════════════════════════════════
function shopSetChar(charId) {
  window._shopCharId = charId;
  const c  = STATE.characters?.find(x => x.id === charId);
  const or = _getOr(c);
  const el = document.getElementById('sh-char-or-display');
  if (el) el.textContent = `💰 ${or} or`;
}

// ══════════════════════════════════════════════════════════════════════════════
// ACHAT — modal avec sélection de quantité
// ══════════════════════════════════════════════════════════════════════════════
async function buyItem(itemId) {
  const charId = window._shopCharId;
  if (!charId) { showNotif("Sélectionne un personnage d\'abord.", 'error'); return; }
  const item = _items.find(i => i.id === itemId);
  if (!item) return;
  const dispo    = (item.dispo !== undefined && item.dispo !== '') ? parseInt(item.dispo) : null;
  const illimite = dispo === null || dispo < 0;
  if (!illimite && dispo === 0) { showNotif('Article épuisé.', 'error'); return; }
  const prix  = parseFloat(item.prix) || 0;
  const c     = STATE.characters?.find(x => x.id === charId);
  if (!c) { showNotif('Personnage introuvable.', 'error'); return; }
  const solde = _getOr(c);
  const maxAffordable = prix > 0 ? Math.floor(solde / prix) : 99;
  const maxStock      = illimite ? 99 : dispo;
  const maxQte        = Math.min(maxAffordable, maxStock, 99);
  if (maxQte < 1) { showNotif(`Fonds insuffisants — Solde : ${solde} or / Prix : ${prix} or.`, 'error'); return; }

  openModal(`🛒 Acheter — ${item.nom}`, `
    <div style="margin-bottom:.75rem">
      <div style="font-family:\'Cinzel\',serif;font-size:.95rem;color:var(--text);margin-bottom:.2rem">${item.nom}</div>
      <div style="font-size:.8rem;color:var(--text-dim)">
        💰 ${prix} or/u · Solde : <strong style="color:var(--gold)">${solde} or</strong>
        ${!illimite ? ` · Stock : ${dispo}` : ''}
      </div>
    </div>
    <div class="form-group" style="display:flex;align-items:center;gap:.75rem">
      <label style="flex-shrink:0">Quantité</label>
      <div style="display:flex;align-items:center;gap:.4rem">
        <button type="button"
          onclick="this.nextElementSibling.stepDown();this.nextElementSibling.dispatchEvent(new Event(\'input\'))"
          style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;font-size:1rem;color:var(--text)">−</button>
        <input type="number" id="buy-qty" min="1" max="${maxQte}" value="1"
          style="width:60px;text-align:center" class="input-field"
          oninput="
            const v=Math.min(Math.max(1,parseInt(this.value)||1),${maxQte});
            this.value=v;
            document.getElementById(\'buy-total\').textContent=(v*${prix})+\' or\';
            document.getElementById(\'buy-confirm\').textContent=\'🛒 Acheter ×\'+v+\' — \'+(v*${prix})+\' or\';
          ">
        <button type="button"
          onclick="this.previousElementSibling.stepUp();this.previousElementSibling.dispatchEvent(new Event(\'input\'))"
          style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer;font-size:1rem;color:var(--text)">+</button>
      </div>
      <span style="font-size:.8rem;color:var(--text-dim)">→ <strong id="buy-total" style="color:var(--gold)">${prix} or</strong></span>
    </div>
    <div style="display:flex;gap:.5rem;margin-top:1rem">
      <button id="buy-confirm" class="btn btn-gold" style="flex:1"
        onclick="confirmBuyItem(\'${itemId}\')">
        🛒 Acheter ×1 — ${prix} or
      </button>
      <button class="btn btn-outline btn-sm" onclick="closeModalDirect()">Annuler</button>
    </div>
  `);
}

async function confirmBuyItem(itemId) {
  const charId   = window._shopCharId;
  const item     = _items.find(i => i.id === itemId);
  if (!item || !charId) return;
  const qty      = Math.max(1, parseInt(document.getElementById('buy-qty')?.value)||1);
  const dispo    = (item.dispo !== undefined && item.dispo !== '') ? parseInt(item.dispo) : null;
  const illimite = dispo === null || dispo < 0;
  const prix     = parseFloat(item.prix) || 0;
  const c        = STATE.characters?.find(x => x.id === charId);
  if (!c) return;
  const solde    = _getOr(c);
  const total    = prix * qty;
  if (solde < total) { showNotif(`Fonds insuffisants — ${solde} or disponibles.`, 'error'); return; }
  if (!illimite && dispo < qty) { showNotif(`Stock insuffisant — ${dispo} dispo.`, 'error'); return; }

  if (!illimite) {
    await updateInCol('shop', itemId, { dispo: dispo - qty });
    item.dispo = dispo - qty;
  }

  const prixVente = Math.round(prix * PRIX_VENTE_RATIO);
  const cat       = _cats.find(cc => cc.id === item.categorieId);
  const tplKey    = cat?.template || 'classique';
  const invItem   = {
    nom:item.nom||'?', source:'boutique', itemId:item.id,
    categorieId:item.categorieId||'', template:tplKey, qte:'1',
    prixAchat:prix, prixVente,
    format:item.format||'', rarete:item.rarete||'',
    degats:item.degats||'', toucher:item.toucher||'',
    ca:item.ca||'', stats:item.stats||'',
    trait:item.trait||'', type:item.type||'',
    effet:item.effet||'', description:item.description||'',
  };

  const inv      = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
  for (let i = 0; i < qty; i++) inv.push({...invItem});

  const compte   = c.compte || { recettes:[], depenses:[] };
  const depenses = [...(compte.depenses||[])];
  depenses.push({
    date:    new Date().toLocaleDateString('fr-FR'),
    libelle: qty > 1 ? `Achat ×${qty} : ${item.nom}` : `Achat : ${item.nom}`,
    montant: total,
  });

  await updateInCol('characters', charId, {
    inventaire: inv,
    compte: { ...compte, depenses },
  });
  c.inventaire = inv;
  c.compte     = { ...compte, depenses };

  const orEl = document.getElementById('sh-char-or-display');
  if (orEl) orEl.textContent = `💰 ${_getOr(c)} or`;

  closeModalDirect();
  showNotif(`✅ ×${qty} "${item.nom}" acheté${qty>1?'s':''} pour ${total} or !`, 'success');
  renderShop();
}

// Exposer pour characters.js — réincrémenter 1 unité du stock boutique
window._restockShopItem = async (itemId) => {
  const shopItem = _items.find(i => i.id === itemId);
  if (!shopItem) return;
  const cur = shopItem.dispo !== undefined && shopItem.dispo !== '' ? parseInt(shopItem.dispo) : null;
  if (cur !== null && cur >= 0) {
    await updateInCol('shop', itemId, { dispo: cur + 1 });
    shopItem.dispo = cur + 1;
  }
};


// ══════════════════════════════════════════════════════════════════════════════
// VENDRE un item de l'inventaire (appelé depuis characters.js)
// ══════════════════════════════════════════════════════════════════════════════
async function sellInvItemFromShop(charId, invIndex) {
  const c = STATE.characters?.find(x => x.id === charId);
  if (!c) return;

  const inv  = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
  const item = inv[invIndex];
  if (!item) return;

  const prixVente = parseFloat(item.prixVente) || 0;
  const itemNom   = item.nom || 'cet objet';

  if (!confirm(`Vendre "${itemNom}" pour ${prixVente} or ?`)) return;

  // 1. Réincrémenter le stock dans la boutique (si l'article existe encore)
  if (item.itemId) {
    const shopItem = await import('../data/firestore.js').then(m => m.getDocData('shop', item.itemId)).catch(()=>null);
    if (shopItem) {
      const curDispo = shopItem.dispo !== undefined && shopItem.dispo !== '' ? parseInt(shopItem.dispo) : null;
      if (curDispo !== null && curDispo >= 0) {
        await updateInCol('shop', item.itemId, { dispo: curDispo + 1 });
        // Mettre à jour _items local si la boutique est chargée
        const si = _items.find(i => i.id === item.itemId);
        if (si) si.dispo = curDispo + 1;
      }
    }
  }

  // 2. Créditer l'or via le compte
  const compte   = c.compte || { recettes:[], depenses:[] };
  const recettes = [...(compte.recettes||[])];
  recettes.push({
    date:    new Date().toLocaleDateString('fr-FR'),
    libelle: `Vente : ${itemNom}`,
    montant: prixVente,
  });

  // 3. Retirer l'item de l'inventaire
  inv.splice(invIndex, 1);

  // 4. Sauvegarder
  await updateInCol('characters', charId, {
    inventaire: inv,
    compte:     { ...compte, recettes },
  });
  c.inventaire = inv;
  c.compte     = { ...compte, recettes };

  showNotif(`💰 "${itemNom}" vendu pour ${prixVente} or !`, 'success');
}

// Exposer pour characters.js
window.sellInvItemFromShop = sellInvItemFromShop;

// ══════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════════
function shopGoHome()          { _view='home';   _activeCat=null; _activeSubCat=null; _page=1; renderShop(); }
function shopGoCat(catId)      { _view='cat';    _activeCat=catId; _activeSubCat=null; _page=1; renderShop(); }
function shopGoSubCat(subCatId){ _view='subcat'; _activeSubCat=subCatId; _page=1; window._shopSearch=''; window._shopFilterRarete=''; window._shopFilterDispo=''; renderShop(); }
function shopPage(p)           { _page=p; renderShop(); }

// ══════════════════════════════════════════════════════════════════════════════
// FILTRES
// ══════════════════════════════════════════════════════════════════════════════
function shopFilterBy(type, val) {
  if (type==='rarete') window._shopFilterRarete = window._shopFilterRarete===val?'':val;
  else if (type==='dispo') window._shopFilterDispo = window._shopFilterDispo===val?'':val;
  _page=1; renderShop();
}
function shopFilterReset() { window._shopSearch=''; window._shopFilterRarete=''; window._shopFilterDispo=''; _page=1; renderShop(); }
function shopFilterSearch(val) { window._shopSearch=val; _page=1; renderShop(); }

// ══════════════════════════════════════════════════════════════════════════════
// DRAG & DROP — Catégories
// ══════════════════════════════════════════════════════════════════════════════
let _dragCatId = null;
function shopCatDragStart(e,catId){ _dragCatId=catId; e.currentTarget.style.opacity='0.5'; e.dataTransfer.effectAllowed='move'; }
function shopCatDragOver(e){ e.preventDefault(); e.dataTransfer.dropEffect='move'; document.querySelectorAll('.sh-cat-card').forEach(c=>c.classList.remove('sh-cat-drop-target')); e.currentTarget.classList.add('sh-cat-drop-target'); }
function shopCatDragEnd(e){ e.currentTarget.style.opacity=''; document.querySelectorAll('.sh-cat-card').forEach(c=>c.classList.remove('sh-cat-drop-target')); }
async function shopCatDrop(e,toCatId){
  e.preventDefault(); document.querySelectorAll('.sh-cat-card').forEach(c=>c.classList.remove('sh-cat-drop-target'));
  const fromId=_dragCatId; _dragCatId=null;
  if(!fromId||fromId===toCatId) return;
  const fromIdx=_cats.findIndex(c=>c.id===fromId), toIdx=_cats.findIndex(c=>c.id===toCatId);
  if(fromIdx<0||toIdx<0) return;
  const [moved]=_cats.splice(fromIdx,1); _cats.splice(toIdx,0,moved);
  await Promise.all(_cats.map((cat,i)=>updateInCol('shopCategories',cat.id,{ordre:i})));
  showNotif('Ordre mis à jour.','success'); renderShop();
}

// ── Drag & Drop Sous-catégories ───────────────────────────────────────────────
let _dragScId=null;
function shopScDragStart(e,scId){ _dragScId=scId; e.currentTarget.style.opacity='0.5'; e.dataTransfer.effectAllowed='move'; }
function shopScDragOver(e){ e.preventDefault(); e.dataTransfer.dropEffect='move'; document.querySelectorAll('.sh-subcat-card').forEach(c=>c.classList.remove('sh-dnd-before','sh-dnd-after')); const rect=e.currentTarget.getBoundingClientRect(); e.clientY<rect.top+rect.height/2?e.currentTarget.classList.add('sh-dnd-before'):e.currentTarget.classList.add('sh-dnd-after'); }
function shopScDragEnd(e){ e.currentTarget.style.opacity=''; document.querySelectorAll('.sh-subcat-card').forEach(c=>c.classList.remove('sh-dnd-before','sh-dnd-after')); }
async function shopScDrop(e,toScId){
  e.preventDefault(); document.querySelectorAll('.sh-subcat-card').forEach(c=>c.classList.remove('sh-dnd-before','sh-dnd-after'));
  const fromId=_dragScId; _dragScId=null;
  if(!fromId||fromId===toScId) return;
  const cat=_cats.find(c=>c.id===_activeCat); if(!cat) return;
  const scs=[...(cat.sousCats||[])];
  const fromIdx=scs.findIndex(s=>s.id===fromId), toIdx=scs.findIndex(s=>s.id===toScId);
  if(fromIdx<0||toIdx<0) return;
  const rect=e.currentTarget.getBoundingClientRect(), insertAfter=e.clientY>=rect.top+rect.height/2;
  const [moved]=scs.splice(fromIdx,1);
  const insertAt=insertAfter?(toIdx>fromIdx?toIdx:toIdx+1):(toIdx>fromIdx?toIdx-1:toIdx);
  scs.splice(Math.max(0,insertAt),0,moved); cat.sousCats=scs;
  await updateInCol('shopCategories',_activeCat,{sousCats:scs});
  showNotif('Ordre mis à jour.','success'); renderShop();
}

// ── Drag & Drop Articles ──────────────────────────────────────────────────────
let _dragItemId=null;
function shopItemDragStart(e,itemId){ _dragItemId=itemId; e.currentTarget.style.opacity='0.5'; e.dataTransfer.effectAllowed='move'; }
function shopItemDragOver(e){ e.preventDefault(); e.dataTransfer.dropEffect='move'; document.querySelectorAll('.sh-item-card').forEach(c=>c.classList.remove('sh-dnd-before','sh-dnd-after')); const rect=e.currentTarget.getBoundingClientRect(); e.clientY<rect.top+rect.height/2?e.currentTarget.classList.add('sh-dnd-before'):e.currentTarget.classList.add('sh-dnd-after'); }
function shopItemDragEnd(e){ e.currentTarget.style.opacity=''; document.querySelectorAll('.sh-item-card').forEach(c=>c.classList.remove('sh-dnd-before','sh-dnd-after')); }
async function shopItemDrop(e,toItemId){
  e.preventDefault(); document.querySelectorAll('.sh-item-card').forEach(c=>c.classList.remove('sh-dnd-before','sh-dnd-after'));
  const fromId=_dragItemId; _dragItemId=null;
  if(!fromId||fromId===toItemId) return;
  let items=_items.filter(i=>i.categorieId===_activeCat);
  if(_activeSubCat) items=items.filter(i=>i.sousCategorieId===_activeSubCat);
  const fromIdx=items.findIndex(i=>i.id===fromId), toIdx=items.findIndex(i=>i.id===toItemId);
  if(fromIdx<0||toIdx<0) return;
  const rect=e.currentTarget.getBoundingClientRect(), insertAfter=e.clientY>=rect.top+rect.height/2;
  const [moved]=items.splice(fromIdx,1);
  const insertAt=insertAfter?(toIdx>fromIdx?toIdx:toIdx+1):(toIdx>fromIdx?toIdx-1:toIdx);
  items.splice(Math.max(0,insertAt),0,moved);
  await Promise.all(items.map((item,i)=>updateInCol('shop',item.id,{ordre:i})));
  items.forEach((item,i)=>{ item.ordre=i; });
  showNotif('Ordre mis à jour.','success'); renderShop();
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL CATÉGORIE
// ══════════════════════════════════════════════════════════════════════════════
function openCatModal(catId) {
  const cat        = catId ? _cats.find(c=>c.id===catId) : null;
  const tplOptions = Object.entries(TEMPLATES).map(([k,v])=>`<option value="${k}" ${(cat?.template||'classique')===k?'selected':''}>${v.label}</option>`).join('');
  openModal(cat?'✏️ Modifier la catégorie':'📁 Nouvelle catégorie',`
    <div class="form-group"><label>Nom</label>
      <input class="input-field" id="cat-nom" value="${cat?.nom||''}" placeholder="Armes Physiques, Épicerie...">
    </div>
    <div class="form-group"><label>Type de boutique</label>
      <select class="input-field" id="cat-template">${tplOptions}</select>
      <div id="cat-tpl-preview" class="sh-tpl-preview"></div>
    </div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Emoji <span style="color:var(--text-dim);font-weight:400">(opt.)</span></label>
        <input class="input-field" id="cat-emoji" value="${cat?.emoji||''}" placeholder="⚔️ 🛡️ 🧪" style="max-width:90px">
      </div>
    </div>
    <div class="form-group"><label>Image <span style="color:var(--text-dim);font-weight:400">(opt.)</span></label>
      <div class="sh-upload-simple">
        <input type="file" id="cat-img-file" accept="image/*" onchange="previewUpload('cat-img-file','cat-img-preview','cat-img-b64')" style="font-size:0.8rem;color:var(--text-muted)">
        <input type="hidden" id="cat-img-b64" value="${cat?.image||''}">
      </div>
      <div id="cat-img-preview">${cat?.image?`<img src="${cat.image}" style="max-height:80px;border-radius:8px;margin-top:0.4rem;display:block">`:''}</div>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveCat('${catId||''}')">
      ${cat?'Enregistrer':'Créer'}
    </button>`);
  setTimeout(()=>{ document.getElementById('cat-nom')?.focus(); _updateTplPreview(); document.getElementById('cat-template')?.addEventListener('change',_updateTplPreview); },60);
}

function _updateTplPreview() {
  const sel=document.getElementById('cat-template')?.value;
  const prev=document.getElementById('cat-tpl-preview');
  if(!sel||!prev) return;
  const tpl=TEMPLATES[sel]; if(!tpl) return;
  prev.innerHTML=`<div class="sh-tpl-fields">${tpl.fields.map(f=>`<span class="sh-tpl-field-tag">${f.label}</span>`).join('')}</div>`;
}

async function saveCat(catId) {
  const nom=document.getElementById('cat-nom')?.value.trim();
  if(!nom){showNotif('Nom requis.','error');return;}
  const data={ nom, template:document.getElementById('cat-template')?.value||'classique', emoji:document.getElementById('cat-emoji')?.value.trim()||'', image:document.getElementById('cat-img-b64')?.value||'' };
  if(catId) await updateInCol('shopCategories',catId,data);
  else await addToCol('shopCategories',{...data,ordre:_cats.length,sousCats:[]});
  closeModalDirect(); showNotif(catId?'Catégorie mise à jour.':'Catégorie créée !','success'); renderShop();
}

async function deleteCat(catId) {
  const n=_items.filter(i=>i.categorieId===catId).length;
  if(!confirm(n>0?`Cette catégorie contient ${n} article(s). Supprimer quand même ?`:'Supprimer cette catégorie ?')) return;
  const toDelete=_items.filter(i=>i.categorieId===catId);
  await Promise.all(toDelete.map(i=>deleteFromCol('shop',i.id)));
  await deleteFromCol('shopCategories',catId);
  if(_activeCat===catId){_view='home';_activeCat=null;}
  showNotif(`Catégorie et ${toDelete.length} article(s) supprimés.`,'success'); renderShop();
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL SOUS-CATÉGORIE
// ══════════════════════════════════════════════════════════════════════════════
function openSubCatModal(catId,scId) {
  const cat=_cats.find(c=>c.id===catId);
  const sc=scId?(cat?.sousCats||[]).find(s=>s.id===scId):null;
  openModal(sc?'✏️ Modifier':'📂 Nouvelle sous-catégorie',`
    <div class="form-group"><label>Nom</label>
      <input class="input-field" id="sc-nom" value="${sc?.nom||''}" placeholder="Épée, Bouclier, Lance...">
    </div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group"><label>Emoji <span style="color:var(--text-dim);font-weight:400">(opt.)</span></label>
        <input class="input-field" id="sc-emoji" value="${sc?.emoji||''}" placeholder="⚔️ 🛡️" style="max-width:90px">
      </div>
    </div>
    <div class="form-group"><label>Image <span style="color:var(--text-dim);font-weight:400">(opt.)</span></label>
      <div class="sh-upload-simple">
        <input type="file" id="sc-img-file" accept="image/*" onchange="previewUpload('sc-img-file','sc-img-preview','sc-img-b64')" style="font-size:0.8rem;color:var(--text-muted)">
        <input type="hidden" id="sc-img-b64" value="${sc?.image||''}">
      </div>
      <div id="sc-img-preview">${sc?.image?`<img src="${sc.image}" style="max-height:80px;border-radius:8px;margin-top:0.4rem;display:block">`:''}</div>
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveSubCat('${catId}','${scId||''}')">
      ${sc?'Enregistrer':'Créer'}
    </button>`);
  setTimeout(()=>document.getElementById('sc-nom')?.focus(),50);
}

async function saveSubCat(catId,scId) {
  const nom=document.getElementById('sc-nom')?.value.trim();
  const emoji=document.getElementById('sc-emoji')?.value.trim();
  const image=document.getElementById('sc-img-b64')?.value||'';
  if(!nom){showNotif('Nom requis.','error');return;}
  const cat=_cats.find(c=>c.id===catId); if(!cat) return;
  const sousCats=[...(cat.sousCats||[])];
  if(scId){ const idx=sousCats.findIndex(s=>s.id===scId); if(idx>=0) sousCats[idx]={...sousCats[idx],nom,emoji,image}; }
  else sousCats.push({id:'sc_'+Date.now(),nom,emoji,image});
  await updateInCol('shopCategories',catId,{sousCats});
  closeModalDirect(); showNotif(scId?'Sous-catégorie mise à jour.':'Sous-catégorie créée !','success'); renderShop();
}

async function deleteSubCat(catId,scId) {
  if(!confirm('Supprimer cette sous-catégorie ?')) return;
  const cat=_cats.find(c=>c.id===catId); if(!cat) return;
  const sousCats=(cat.sousCats||[]).filter(s=>s.id!==scId);
  await updateInCol('shopCategories',catId,{sousCats});
  if(_activeSubCat===scId){_view='cat';_activeSubCat=null;}
  showNotif('Sous-catégorie supprimée.','success'); renderShop();
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL ARTICLE — champs dynamiques selon template
// ══════════════════════════════════════════════════════════════════════════════
function openItemModal(itemId) {
  const item       = itemId ? _items.find(i=>i.id===itemId) : null;
  const defCatId   = item?.categorieId || _activeCat || '';
  const defScId    = item?.sousCategorieId || _activeSubCat || '';
  const cat        = _cats.find(c=>c.id===defCatId);
  const tplKey     = cat?.template || 'classique';
  const tpl        = TEMPLATES[tplKey] || TEMPLATES.classique;
  const catOptions = _cats.map(c=>`<option value="${c.id}" ${defCatId===c.id?'selected':''}>${c.nom} (${TEMPLATES[c.template||'classique']?.label||''})</option>`).join('');
  const scOptions  = (cat?.sousCats||[]).map(sc=>`<option value="${sc.id}" ${defScId===sc.id?'selected':''}>${sc.nom}</option>`).join('');
  const fieldsHtml = _buildFieldsHtml(tpl, item);
  openModal(item?'✏️ Modifier l\'article':'🛒 Nouvel article',`
    <div class="sh-modal-selects">
      <div class="form-group"><label>Catégorie</label>
        <select class="input-field sh-modal-select" id="si-cat" onchange="refreshItemFields(this.value,'')">
          <option value="">— Aucune —</option>${catOptions}
        </select>
      </div>
      <div class="form-group"><label>Sous-catégorie <span style="color:var(--text-dim);font-weight:400">(opt.)</span></label>
        <select class="input-field sh-modal-select" id="si-subcat">
          <option value="">— Aucune —</option>${scOptions}
        </select>
      </div>
    </div>
    <div class="form-group"><label>Nom de l'article</label>
      <input class="input-field" id="si-nom" value="${item?.nom||''}" placeholder="Nom...">
    </div>
    <div class="form-group"><label>Image</label>
      <div class="sh-upload-simple">
        <input type="file" id="si-img-file" accept="image/*" onchange="previewUpload('si-img-file','si-img-preview','si-img-b64')" style="font-size:0.8rem;color:var(--text-muted)">
        <input type="hidden" id="si-img-b64" value="${item?.image||''}">
      </div>
      <div id="si-img-preview">${item?.image?`<img src="${item.image}" style="max-height:80px;border-radius:8px;margin-top:0.4rem;display:block">`:''}</div>
    </div>
    <div id="si-dynamic-fields">${fieldsHtml}</div>
    <button class="btn btn-gold" style="width:100%;margin-top:1.2rem" onclick="saveShopItem('${itemId||''}')">
      ${item?'Enregistrer':'Ajouter à la boutique'}
    </button>`);
  setTimeout(()=>{ document.getElementById('si-nom')?.focus(); _bindPrixListener(); },60);
}

function _buildFieldsHtml(tpl,item) {
  if(!tpl?.fields) return '';
  let html=`<div class="sh-fields-grid">`;
  tpl.fields.forEach(f=>{
    const val=item?.[f.id]??'';
    if(f.id==='prix'){
      const pv=Math.round((parseFloat(val)||0)*PRIX_VENTE_RATIO);
      html+=`<div class="form-group sh-field-prix"><label>${f.label}</label>
        <div class="sh-prix-wrap">
          <input type="number" class="input-field" id="si-${f.id}" value="${val}" min="0" oninput="updatePrixVente(this.value)" style="max-width:110px">
          <span class="sh-prix-vente-display" id="si-prix-vente">🔄 <strong id="si-pv-val">${pv}</strong> or <span style="color:var(--text-dim);font-size:0.7rem">(60%)</span></span>
        </div></div>`;
    } else if(f.type==='rarete'){
      const cur=parseInt(val)||0;
      html+=`<div class="form-group"><label>${f.label}</label>
        <div class="sh-rarete-picker" id="si-rarete-wrap">
          ${[1,2,3,4].map(n=>`<button type="button" class="sh-rarete-star-btn ${cur>=n?'active':''}" data-val="${n}" onclick="pickRarete(${n})" style="${cur>=n?'color:#c084fc':'color:var(--text-dim)'}">★</button>`).join('')}
          <input type="hidden" id="si-rarete" value="${val}">
          <span class="sh-rarete-label" id="si-rarete-lbl">${_rareteLabel(val)}</span>
        </div></div>`;
    } else if(f.type==='dispo'){
      const isInfini=val!==undefined&&val!==''&&parseInt(val)<0;
      const dispoVal=isInfini?'':(val===''?'':parseInt(val)||'');
      html+=`<div class="form-group"><label>${f.label}</label>
        <div class="sh-dispo-wrap">
          <input type="number" class="input-field" id="si-dispo" value="${dispoVal}" min="0" placeholder="Ex: 3" style="max-width:90px;${isInfini?'opacity:0.4;pointer-events:none;':''}" ${isInfini?'disabled':''}>
          <label class="sh-dispo-infini-label">
            <input type="checkbox" id="si-dispo-infini" ${isInfini?'checked':''} onchange="toggleDispoInfini(this)">
            <span>∞ Illimité</span>
          </label>
        </div></div>`;
    } else if(f.type==='select'){
      html+=`<div class="form-group"><label>${f.label}</label>
        <select class="input-field sh-modal-select" id="si-${f.id}">
          <option value="">— Choisir —</option>
          ${(f.options||[]).map(o=>`<option value="${o}" ${val===o?'selected':''}>${o}</option>`).join('')}
        </select></div>`;
    } else if(f.type==='textarea'){
      html+=`<div class="form-group sh-field-full"><label>${f.label}</label>
        <textarea class="input-field" id="si-${f.id}" rows="2">${val}</textarea></div>`;
    } else {
      html+=`<div class="form-group"><label>${f.label}</label>
        <input class="input-field" id="si-${f.id}" value="${val}" placeholder="${f.placeholder||''}"></div>`;
    }
  });
  html+=`</div>`;
  return html;
}

function _bindPrixListener() {
  const input=document.getElementById('si-prix');
  if(input) input.addEventListener('input',()=>updatePrixVente(input.value));
}

const _RARETE_LABELS=['','★ Commun','★★ Peu commun','★★★ Rare','★★★★ Très rare'];
function _rareteLabel(val){ return _RARETE_LABELS[parseInt(val)||0]||''; }
function pickRarete(n){
  const h=document.getElementById('si-rarete'), l=document.getElementById('si-rarete-lbl');
  if(h) h.value=n; if(l) l.textContent=_RARETE_LABELS[n]||'';
  document.querySelectorAll('.sh-rarete-star-btn').forEach(btn=>{
    const v=parseInt(btn.dataset.val);
    btn.classList.toggle('active',v<=n); btn.style.color=v<=n?'#c084fc':'var(--text-dim)';
  });
}
function toggleDispoInfini(cb){
  const input=document.getElementById('si-dispo'); if(!input) return;
  if(cb.checked){ input.value=''; input.disabled=true; input.style.opacity='0.4'; input.style.pointerEvents='none'; }
  else { input.disabled=false; input.style.opacity=''; input.style.pointerEvents=''; input.value='5'; input.focus(); }
}
function updatePrixVente(val){ const pv=Math.round((parseFloat(val)||0)*PRIX_VENTE_RATIO); const el=document.getElementById('si-pv-val'); if(el) el.textContent=pv; }

function refreshItemFields(catId,scId) {
  const cat=_cats.find(c=>c.id===catId);
  const tpl=TEMPLATES[cat?.template||'classique']||TEMPLATES.classique;
  const sel=document.getElementById('si-subcat');
  if(sel){ sel.innerHTML=`<option value="">— Aucune —</option>`+(cat?.sousCats||[]).map(sc=>`<option value="${sc.id}" ${scId===sc.id?'selected':''}>${sc.nom}</option>`).join(''); }
  const dyn=document.getElementById('si-dynamic-fields');
  if(dyn){ dyn.innerHTML=_buildFieldsHtml(tpl,null); _bindPrixListener(); }
}
function refreshSubCatSelect(catId,scId){ refreshItemFields(catId,scId); }

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
      const preview=document.getElementById(previewId); if(preview) preview.innerHTML=`<img src="${b64}" style="max-height:80px;border-radius:8px;margin-top:0.4rem;display:block">`;
      const kb=Math.round(b64.length*3/4/1024);
      if(kb>700) showNotif(`⚠️ Image encore lourde (${kb}KB).`,'error');
      else showNotif(`✅ Image prête (${kb}KB)`,'success');
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}

async function saveShopItem(itemId) {
  const catId=document.getElementById('si-cat')?.value||'';
  const cat=_cats.find(c=>c.id===catId);
  const tplKey=cat?.template||'classique';
  const tpl=TEMPLATES[tplKey]||TEMPLATES.classique;
  const nom=document.getElementById('si-nom')?.value.trim();
  if(!nom){showNotif('Nom requis.','error');return;}
  const data={ nom, categorieId:catId, sousCategorieId:document.getElementById('si-subcat')?.value||'', image:document.getElementById('si-img-b64')?.value||'' };
  tpl.fields.forEach(f=>{
    if(f.type==='dispo'){ const infini=document.getElementById('si-dispo-infini')?.checked; data[f.id]=infini?-1:(parseInt(document.getElementById('si-dispo')?.value)||0); }
    else { const el=document.getElementById(`si-${f.id}`); if(el) data[f.id]=f.type==='number'?(parseFloat(el.value)||0):el.value.trim(); }
  });
  data.prixVente=Math.round((parseFloat(data.prix)||0)*PRIX_VENTE_RATIO);
  if(itemId) await updateInCol('shop',itemId,data);
  else await addToCol('shop',data);
  closeModalDirect(); showNotif('Article enregistré !','success'); renderShop();
}

async function deleteShopItem(itemId) {
  if(!confirm('Supprimer cet article ?')) return;
  await deleteFromCol('shop',itemId);
  showNotif('Article supprimé.','success'); renderShop();
}

function openShopItemModal(item){ openItemModal(item?.id); }
async function editShopItem(id){ openItemModal(id); }
function filterShop(){}

Object.assign(window,{
  renderShop, shopGoHome, shopGoCat, shopGoSubCat, shopPage,
  openCatModal, saveCat, deleteCat,
  openSubCatModal, saveSubCat, deleteSubCat,
  openItemModal, refreshItemFields, refreshSubCatSelect,
  previewUpload, updatePrixVente, pickRarete,
  shopSetChar, buyItem, confirmBuyItem, sellInvItemFromShop,
  toggleDispoInfini, saveShopItem, deleteShopItem,
  openShopItemModal, editShopItem, filterShop,
  shopCatDragStart, shopCatDragOver, shopCatDragEnd, shopCatDrop,
  shopScDragStart, shopScDragOver, shopScDragEnd, shopScDrop,
  shopItemDragStart, shopItemDragOver, shopItemDragEnd, shopItemDrop,
  shopFilterSearch, shopFilterBy, shopFilterReset,
});
