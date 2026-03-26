import { STATE }                                         from '../core/state.js';
import { loadCollection, addToCol, updateInCol,
         deleteFromCol }                                 from '../data/firestore.js';
import { openModal, closeModalDirect }                   from '../shared/modal.js';
import { showNotif }                                     from '../shared/notifications.js';

// ══════════════════════════════════════════════
// TEMPLATES DE CHAMPS PAR TYPE DE BOUTIQUE
// Chaque catégorie porte un template, tous les
// articles de cette catégorie utilisent ces champs.
// ══════════════════════════════════════════════
const TEMPLATES = {
  arme: {
    label: '⚔️ Arme',
    fields: [
      { id:'format',    label:'Format',    type:'text',   placeholder:'Épée 1M, Lance 2M, Arc...' },
      { id:'rarete',    label:'Rareté',    type:'rarete' },
      { id:'degats',    label:'Dégâts',    type:'text',   placeholder:'1D10, 2D6...' },
      { id:'toucher',   label:'Toucher',   type:'text',   placeholder:'+Fo, +Dex...' },
      { id:'stats',     label:'Stats',     type:'text',   placeholder:'+2 Fo, +1 Dex...' },
      { id:'trait',     label:'Trait',     type:'text',   placeholder:'Lourd, Finesse, Polyvalent...' },
      { id:'prix',      label:'Prix 🪙',   type:'number', placeholder:'0' },
      { id:'dispo',     label:'Dispo',     type:'dispo' },
    ],
  },
  armure: {
    label: '🛡️ Armure',
    fields: [
      { id:'rarete',    label:'Rareté',    type:'rarete' },
      { id:'ca',        label:'CA',        type:'text',   placeholder:'10, 12, 14...' },
      { id:'stats',     label:'Stats',     type:'text',   placeholder:'+2 Co, +1 Fo...' },
      { id:'trait',     label:'Trait',     type:'text',   placeholder:'Lourd, Magique...' },
      { id:'prix',      label:'Prix 🪙',   type:'number', placeholder:'0' },
      { id:'dispo',     label:'Dispo',     type:'dispo' },
    ],
  },
  classique: {
    label: '🧪 Classique',
    fields: [
      { id:'type',      label:'Type',      type:'text',   placeholder:'Consommable, Matériau, Accessoire...' },
      { id:'effet',     label:'Effet',     type:'textarea',placeholder:'(Action) Rend 10 PV...' },
      { id:'description',label:'Description',type:'textarea',placeholder:'Détails...' },
      { id:'prix',      label:'Prix 🪙',   type:'number', placeholder:'0' },
      { id:'dispo',     label:'Dispo',     type:'dispo' },
    ],
  },
  libre: {
    label: '📦 Libre',
    fields: [
      { id:'type',      label:'Type',      type:'text',   placeholder:'Type...' },
      { id:'description',label:'Description',type:'textarea',placeholder:'...' },
      { id:'prix',      label:'Prix 🪙',   type:'number', placeholder:'0' },
      { id:'dispo',     label:'Dispo',     type:'dispo' },
    ],
  },
};

const PRIX_VENTE_RATIO = 0.6; // 60%

// ══════════════════════════════════════════════
// ÉTAT
// ══════════════════════════════════════════════
let _cats  = [];
let _items = [];
let _view  = 'home';
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
// HELPERS
// ══════════════════════════════════════════════
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
  if (n.includes('arme'))   return '⚔️';
  if (n.includes('armure') || n.includes('armor')) return '🛡️';
  if (n.includes('potion')) return '🧪';
  if (n.includes('magie') || n.includes('rune'))   return '✨';
  if (n.includes('épicerie') || n.includes('cuisine')) return '🍖';
  if (n.includes('outil'))  return '🔧';
  return '📦';
}

function _rareteColor(r) {
  const map = { 'Commun':'#9ca3af','Peu commun':'#4ade80','Rare':'#60a5fa','Très rare':'#c084fc','Légendaire':'#fbbf24' };
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
function _dispoColor(d) {
  return d==='En stock' ? 'var(--green)' : d==='Épuisé' ? 'var(--crimson-light)' : 'var(--gold)';
}

// ══════════════════════════════════════════════
// RENDER PRINCIPAL
// ══════════════════════════════════════════════
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

  // Sélecteur personnage actif (pour tous les utilisateurs)
  if (STATE.characters && STATE.characters.length > 0) {
    const chars = STATE.isAdmin
      ? STATE.characters
      : STATE.characters.filter(c => c.uid === STATE.user?.uid);
    const activeId = window._shopCharId || chars[0]?.id || '';
    html += `<div class="sh-char-selector">
      <span class="sh-char-selector-label">🧙 Acheter en tant que</span>
      <select class="input-field sh-modal-select sh-char-select" id="sh-char-sel"
              onchange="shopSetChar(this.value)">
        ${chars.map(c=>`<option value="${c.id}" ${activeId===c.id?'selected':''}>${c.nom||'?'}</option>`).join('')}
      </select>
    </div>`;
    if (!window._shopCharId) window._shopCharId = activeId;
  }

  html += _renderBreadcrumb();

  if (_view === 'home')   html += _renderHome();
  else if (_view === 'cat')    html += _renderCatView();
  else if (_view === 'subcat') html += _renderItemsView();

  html += `</div>`;
  content.innerHTML = html;
}

// ── Breadcrumb ────────────────────────────────
function _renderBreadcrumb() {
  if (_view === 'home') return '';
  const cat = _cats.find(c => c.id === _activeCat);
  const sc  = cat && _activeSubCat ? (cat.sousCats||[]).find(s => s.id === _activeSubCat) : null;
  let crumbs = [`<button class="sh-crumb sh-crumb-link" onclick="shopGoHome()">🛒 Boutique</button>`];
  if (cat) {
    if (_view === 'cat') crumbs.push(`<span class="sh-crumb-sep">›</span><span class="sh-crumb sh-crumb-active">${cat.nom}</span>`);
    else crumbs.push(`<span class="sh-crumb-sep">›</span><button class="sh-crumb sh-crumb-link" onclick="shopGoCat('${cat.id}')">${cat.nom}</button>`);
  }
  if (sc) crumbs.push(`<span class="sh-crumb-sep">›</span><span class="sh-crumb sh-crumb-active">${sc.nom}</span>`);
  return `<nav class="sh-breadcrumb">${crumbs.join('')}</nav>`;
}

// ══════════════════════════════════════════════
// VUE HOME
// ══════════════════════════════════════════════
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
    html += `<div class="sh-cat-card" onclick="shopGoCat('${cat.id}')">
      <div class="sh-cat-img" style="${cat.image?`background-image:url('${cat.image}')`:_catGradient(cat.nom)}">
        <div class="sh-cat-img-overlay"></div>
        <div class="sh-cat-img-emoji">${cat.emoji||_catEmoji(cat.nom)}</div>
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

// ══════════════════════════════════════════════
// VUE CATÉGORIE
// ══════════════════════════════════════════════
function _renderCatView() {
  const cat     = _cats.find(c => c.id === _activeCat);
  if (!cat) return '';
  const subCats = cat.sousCats||[];
  if (subCats.length === 0) { _view = 'subcat'; return _renderItemsView(); }

  const total = _items.filter(i => i.categorieId === _activeCat).length;
  let html = `<div class="sh-subcat-grid">
    <div class="sh-subcat-card sh-subcat-all" onclick="shopGoSubCat(null)">
      <div class="sh-subcat-icon">📦</div>
      <div class="sh-subcat-name">Tout afficher</div>
      <div class="sh-subcat-count">${total} article${total!==1?'s':''}</div>
    </div>`;

  subCats.forEach(sc => {
    const cnt = _items.filter(i => i.categorieId === _activeCat && i.sousCategorieId === sc.id).length;
    html += `<div class="sh-subcat-card" onclick="shopGoSubCat('${sc.id}')">
      <div class="sh-subcat-icon">${sc.emoji||'📂'}</div>
      <div class="sh-subcat-name">${sc.nom}</div>
      <div class="sh-subcat-count">${cnt} article${cnt!==1?'s':''}</div>
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

  const direct = _items.filter(i => i.categorieId === _activeCat && !i.sousCategorieId);
  if (direct.length > 0) {
    html += `<div class="sh-section-title" style="margin-top:1.5rem">Articles généraux</div>`;
    html += _renderItemGrid(cat, direct);
  }
  return html;
}

// ══════════════════════════════════════════════
// VUE ARTICLES
// ══════════════════════════════════════════════
function _renderItemsView() {
  let items = _items.filter(i => i.categorieId === _activeCat);
  if (_activeSubCat) items = items.filter(i => i.sousCategorieId === _activeSubCat);
  const cat = _cats.find(c => c.id === _activeCat);

  if (items.length === 0) {
    return `<div class="empty-state"><div class="icon">📦</div>
      <p>Aucun article ici.</p>
      ${STATE.isAdmin?`<button class="btn btn-gold btn-sm" style="margin-top:0.8rem" onclick="openItemModal()">＋ Ajouter</button>`:''}</div>`;
  }

  const total = items.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  const p     = Math.max(1, Math.min(_page, pages));
  const slice = items.slice((p-1)*PAGE_SIZE, p*PAGE_SIZE);

  let html = `<div class="sh-items-header">
    <span class="sh-items-count">${total} article${total!==1?'s':''}</span>
    ${STATE.isAdmin?`<button class="btn btn-gold btn-sm" onclick="openItemModal()">＋ Article</button>`:''}
  </div>`;

  html += _renderItemGrid(cat, slice);

  if (pages > 1) {
    html += `<div class="sh-pagination">`;
    if (p > 1) html += `<button class="sh-page-btn" onclick="shopPage(${p-1})">← Précédent</button>`;
    for (let i=1; i<=pages; i++) html += `<button class="sh-page-btn ${i===p?'active':''}" onclick="shopPage(${i})">${i}</button>`;
    if (p < pages) html += `<button class="sh-page-btn" onclick="shopPage(${p+1})">Suivant →</button>`;
    html += `</div>`;
  }
  return html;
}

// ── Rendu des cards articles selon template ───
function _renderItemGrid(cat, items) {
  const tplKey = cat?.template || 'classique';
  return `<div class="sh-item-grid">` +
    items.map(item => _renderItemCard(item, tplKey)).join('') +
  `</div>`;
}

function _renderItemCard(item, tplKey) {
  const prix      = parseFloat(item.prix)||0;
  const prixVente = Math.round(prix * PRIX_VENTE_RATIO);

  // Bloc d'infos selon template
  let infoHtml = '';
  if (tplKey === 'arme') {
    infoHtml = `
      <div class="sh-item-tags">
        ${item.format?`<span class="sh-tag">${item.format}</span>`:''}
        ${item.rarete?_rareteStars(item.rarete):''}
        ${item.dispo!==undefined&&item.dispo!==''?_dispoDisplay(item.dispo):''}
      </div>
      ${item.degats||item.toucher?`<div class="sh-item-combat">
        ${item.degats?`<span class="sh-combat-chip"><span class="sh-cc-label">Dégâts</span><span class="sh-cc-val red">${item.degats}</span></span>`:''}
        ${item.toucher?`<span class="sh-combat-chip"><span class="sh-cc-label">Toucher</span><span class="sh-cc-val gold">${item.toucher}</span></span>`:''}
      </div>`:''}
      ${item.stats?`<div class="sh-item-stats">${item.stats}</div>`:''}
      ${item.trait?`<div class="sh-item-trait"><em>${item.trait}</em></div>`:''}`;
  } else if (tplKey === 'armure') {
    infoHtml = `
      <div class="sh-item-tags">
        ${item.rarete?_rareteStars(item.rarete):''}
        ${item.ca?`<span class="sh-tag">🛡️ CA ${item.ca}</span>`:''}
        ${item.dispo!==undefined&&item.dispo!==''?_dispoDisplay(item.dispo):''}
      </div>
      ${item.stats?`<div class="sh-item-stats">${item.stats}</div>`:''}
      ${item.trait?`<div class="sh-item-trait"><em>${item.trait}</em></div>`:''}`;
  } else {
    infoHtml = `
      ${item.type?`<div class="sh-item-type">${item.type}</div>`:''}
      ${item.effet?`<div class="sh-item-effet">${item.effet}</div>`:''}
      ${item.description?`<div class="sh-item-desc">${item.description}</div>`:''}
      ${item.dispo!==undefined&&item.dispo!==''?`<div class="sh-item-tags">${_dispoDisplay(item.dispo)}</div>`:''}`;
  }

  return `<div class="sh-item-card">
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
      ${!STATE.isAdmin && window._shopCharId
        ? (item.dispo === 0
            ? `<button class="btn sh-buy-btn" disabled style="opacity:0.4;cursor:not-allowed">Épuisé</button>`
            : `<button class="btn sh-buy-btn" onclick="buyItem('${item.id}')">🛒 Acheter</button>`)
        : ''}
    </div>
    ${STATE.isAdmin?`<div class="sh-item-actions">
      <button class="btn-icon" onclick="openItemModal('${item.id}')">✏️</button>
      <button class="btn-icon" onclick="deleteShopItem('${item.id}')">🗑️</button>
    </div>`:''}
  </div>`;
}


// ══════════════════════════════════════════════
// ACHAT
// ══════════════════════════════════════════════
function shopSetChar(charId) {
  window._shopCharId = charId;
}

async function buyItem(itemId) {
  const charId = window._shopCharId;
  if (!charId) { showNotif('Sélectionne un personnage d\'abord.','error'); return; }

  const item = _items.find(i => i.id === itemId);
  if (!item) return;

  // Vérifier stock
  const dispo = item.dispo !== undefined && item.dispo !== '' ? parseInt(item.dispo) : null;
  if (dispo !== null && dispo === 0) { showNotif('Article épuisé.','error'); return; }

  const prix = parseFloat(item.prix)||0;

  // Charger le personnage depuis STATE
  const c = STATE.characters?.find(x => x.id === charId);
  if (!c) { showNotif('Personnage introuvable.','error'); return; }

  // Vérifier l'or (solde du livret de compte)
  const { loadCollection, updateInCol } = await import('../data/firestore.js');
  const compte   = c.compte||{recettes:[],depenses:[]};
  const totalR   = (compte.recettes||[]).reduce((s,r)=>s+(parseFloat(r.montant)||0),0);
  const totalD   = (compte.depenses||[]).reduce((s,d)=>s+(parseFloat(d.montant)||0),0);
  const solde    = totalR - totalD;

  if (solde < prix) {
    showNotif(`Pas assez d'or. Solde : ${solde} or, prix : ${prix} or.`,'error');
    return;
  }

  if (!confirm(`Acheter "${item.nom}" pour ${prix} or ?`)) return;

  // 1. Décrémenter le stock (sauf si infini = -1)
  const updates = {};
  if (dispo !== null && dispo >= 0) {
    updates.dispo = Math.max(0, dispo - 1);
    await updateInCol('shop', itemId, updates);
    item.dispo = updates.dispo;
  }

  // 2. Ajouter dans l'inventaire du personnage
  const inv = c.inventaire||[];
  inv.push({
    nom:         item.nom,
    type:        item.format || item.type || _getTemplate(item.categorieId)?.label || 'Boutique',
    qte:         '1',
    description: [item.trait, item.effet, item.description].filter(Boolean).join(' — '),
    source:      'boutique',
    itemId:      item.id,
    prixAchat:   prix,
    prixVente:   Math.round(prix * 0.6),
  });

  // 3. Débiter l'or via le livret de compte
  const depenses = compte.depenses||[];
  depenses.push({
    date:    new Date().toLocaleDateString('fr-FR'),
    libelle: `Achat : ${item.nom}`,
    montant: prix,
  });
  c.inventaire = inv;
  c.compte     = { ...compte, depenses };
  await updateInCol('characters', charId, { inventaire: inv, compte: c.compte });

  showNotif(`✅ "${item.nom}" acheté pour ${prix} or !`, 'success');
  renderShop();
}

// ══════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════
function shopGoHome()           { _view='home';   _activeCat=null; _activeSubCat=null; _page=1; renderShop(); }
function shopGoCat(catId)       { _view='cat';    _activeCat=catId; _activeSubCat=null; _page=1; renderShop(); }
function shopGoSubCat(subCatId) { _view='subcat'; _activeSubCat=subCatId; _page=1; renderShop(); }
function shopPage(p)            { _page=p; renderShop(); }

// ══════════════════════════════════════════════
// MODAL CATÉGORIE
// ══════════════════════════════════════════════
function openCatModal(catId) {
  const cat = catId ? _cats.find(c => c.id === catId) : null;
  const tplOptions = Object.entries(TEMPLATES).map(([k,v]) =>
    `<option value="${k}" ${(cat?.template||'classique')===k?'selected':''}>${v.label}</option>`
  ).join('');

  openModal(cat ? '✏️ Modifier la catégorie' : '📁 Nouvelle catégorie', `
    <div class="form-group">
      <label>Nom</label>
      <input class="input-field" id="cat-nom" value="${cat?.nom||''}" placeholder="Armes Physiques, Épicerie...">
    </div>
    <div class="form-group">
      <label>Type de boutique</label>
      <select class="input-field" id="cat-template">${tplOptions}</select>
      <div id="cat-tpl-preview" class="sh-tpl-preview"></div>
    </div>
    <div class="grid-2" style="gap:0.8rem">
      <div class="form-group">
        <label>Emoji <span style="color:var(--text-dim);font-weight:400">(opt.)</span></label>
        <input class="input-field" id="cat-emoji" value="${cat?.emoji||''}" placeholder="⚔️ 🛡️ 🧪" style="max-width:90px">
      </div>
    </div>
    <div class="form-group">
      <label>Image <span style="color:var(--text-dim);font-weight:400">(opt.)</span></label>
      <div class="sh-upload-zone" id="cat-img-zone">
        ${cat?.image?`<img src="${cat.image}" style="max-height:80px;border-radius:8px;margin-bottom:0.4rem">`:
          `<span style="font-size:1.4rem">🖼️</span>`}
        <span class="sh-upload-label">Cliquer ou glisser une image</span>
        <input type="file" id="cat-img-file" accept="image/*" style="display:none" onchange="previewUpload('cat-img-file','cat-img-preview','cat-img-b64')">
      </div>
      <div id="cat-img-preview"></div>
      <input type="hidden" id="cat-img-b64" value="${cat?.image||''}">
    </div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveCat('${catId||''}')">
      ${cat?'Enregistrer':'Créer'}
    </button>
  `);
  setTimeout(() => {
    document.getElementById('cat-img-zone')?.addEventListener('click', () => document.getElementById('cat-img-file')?.click());
    document.getElementById('cat-nom')?.focus();
    _updateTplPreview();
    document.getElementById('cat-template')?.addEventListener('change', _updateTplPreview);
  }, 60);
}

function _updateTplPreview() {
  const sel  = document.getElementById('cat-template')?.value;
  const prev = document.getElementById('cat-tpl-preview');
  if (!sel || !prev) return;
  const tpl = TEMPLATES[sel];
  if (!tpl) return;
  prev.innerHTML = `<div class="sh-tpl-fields">${tpl.fields.map(f=>`<span class="sh-tpl-field-tag">${f.label}</span>`).join('')}</div>`;
}

async function saveCat(catId) {
  const nom   = document.getElementById('cat-nom')?.value.trim();
  if (!nom) { showNotif('Nom requis.','error'); return; }
  const data = {
    nom,
    template: document.getElementById('cat-template')?.value||'classique',
    emoji:    document.getElementById('cat-emoji')?.value.trim()||'',
    image:    document.getElementById('cat-img-b64')?.value||'',
  };
  if (catId) await updateInCol('shopCategories', catId, data);
  else       await addToCol('shopCategories', { ...data, ordre: _cats.length, sousCats: [] });
  closeModalDirect();
  showNotif(catId?'Catégorie mise à jour.':'Catégorie créée !', 'success');
  renderShop();
}

async function deleteCat(catId) {
  const n = _items.filter(i => i.categorieId === catId).length;
  if (!confirm(n>0?`Cette catégorie contient ${n} article(s). Supprimer quand même ?`:'Supprimer cette catégorie ?')) return;
  // Supprimer tous les articles de cette catégorie
  const { deleteFromCol: _del } = await import('../data/firestore.js');
  const toDelete = _items.filter(i => i.categorieId === catId);
  await Promise.all(toDelete.map(i => deleteFromCol('shop', i.id)));
  await deleteFromCol('shopCategories', catId);
  if (_activeCat === catId) { _view='home'; _activeCat=null; }
  showNotif(`Catégorie et ${toDelete.length} article(s) supprimés.`, 'success');
  renderShop();
}

// ══════════════════════════════════════════════
// MODAL SOUS-CATÉGORIE
// ══════════════════════════════════════════════
function openSubCatModal(catId, scId) {
  const cat = _cats.find(c => c.id === catId);
  const sc  = scId ? (cat?.sousCats||[]).find(s => s.id === scId) : null;
  openModal(sc ? '✏️ Modifier' : '📂 Nouvelle sous-catégorie', `
    <div class="form-group">
      <label>Nom</label>
      <input class="input-field" id="sc-nom" value="${sc?.nom||''}" placeholder="Épée, Bouclier, Lance...">
    </div>
    <div class="form-group">
      <label>Emoji <span style="color:var(--text-dim);font-weight:400">(opt.)</span></label>
      <input class="input-field" id="sc-emoji" value="${sc?.emoji||''}" placeholder="⚔️ 🛡️" style="max-width:90px">
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
  const cat     = _cats.find(c => c.id === catId);
  if (!cat) return;
  const sousCats = [...(cat.sousCats||[])];
  if (scId) {
    const idx = sousCats.findIndex(s => s.id === scId);
    if (idx >= 0) sousCats[idx] = { ...sousCats[idx], nom, emoji };
  } else {
    sousCats.push({ id: 'sc_' + Date.now(), nom, emoji });
  }
  await updateInCol('shopCategories', catId, { sousCats });
  closeModalDirect();
  showNotif(scId?'Sous-catégorie mise à jour.':'Sous-catégorie créée !','success');
  renderShop();
}

async function deleteSubCat(catId, scId) {
  if (!confirm('Supprimer cette sous-catégorie ?')) return;
  const cat = _cats.find(c => c.id === catId);
  if (!cat) return;
  const sousCats = (cat.sousCats||[]).filter(s => s.id !== scId);
  await updateInCol('shopCategories', catId, { sousCats });
  if (_activeSubCat === scId) { _view='cat'; _activeSubCat=null; }
  showNotif('Sous-catégorie supprimée.','success');
  renderShop();
}

// ══════════════════════════════════════════════
// MODAL ARTICLE — champs dynamiques selon template
// ══════════════════════════════════════════════
function openItemModal(itemId) {
  const item    = itemId ? _items.find(i => i.id === itemId) : null;
  // Catégorie active par défaut
  const defCatId = item?.categorieId || _activeCat || '';
  const defScId  = item?.sousCategorieId || _activeSubCat || '';
  const cat      = _cats.find(c => c.id === defCatId);
  const tplKey   = cat?.template || 'classique';
  const tpl      = TEMPLATES[tplKey] || TEMPLATES.classique;

  // Options select
  const catOptions = _cats.map(c =>
    `<option value="${c.id}" ${defCatId===c.id?'selected':''}>${c.nom} (${TEMPLATES[c.template||'classique']?.label||''})</option>`
  ).join('');
  const scOptions = (cat?.sousCats||[]).map(sc =>
    `<option value="${sc.id}" ${defScId===sc.id?'selected':''}>${sc.nom}</option>`
  ).join('');

  // Champs dynamiques
  const fieldsHtml = _buildFieldsHtml(tpl, item);

  openModal(item ? '✏️ Modifier l\'article' : '🛒 Nouvel article', `
    <div class="sh-modal-selects">
      <div class="form-group">
        <label>Catégorie</label>
        <select class="input-field sh-modal-select" id="si-cat"
                onchange="refreshItemFields(this.value, '')">
          <option value="">— Aucune —</option>
          ${catOptions}
        </select>
      </div>
      <div class="form-group">
        <label>Sous-catégorie <span style="color:var(--text-dim);font-weight:400">(opt.)</span></label>
        <select class="input-field sh-modal-select" id="si-subcat">
          <option value="">— Aucune —</option>
          ${scOptions}
        </select>
      </div>
    </div>

    <div class="form-group">
      <label>Nom de l'article</label>
      <input class="input-field" id="si-nom" value="${item?.nom||''}" placeholder="Nom...">
    </div>

    <!-- Image upload -->
    <div class="form-group">
      <label>Image</label>
      <div class="sh-upload-zone" id="si-img-zone">
        ${item?.image
          ? `<img src="${item.image}" style="max-height:80px;border-radius:8px;margin-bottom:0.4rem">`
          : `<span style="font-size:1.4rem">🖼️</span>`}
        <span class="sh-upload-label">Cliquer ou glisser une image</span>
        <input type="file" id="si-img-file" accept="image/*" style="display:none"
               onchange="previewUpload('si-img-file','si-img-preview','si-img-b64')">
      </div>
      <div id="si-img-preview"></div>
      <input type="hidden" id="si-img-b64" value="${item?.image||''}">
    </div>

    <!-- Champs dynamiques -->
    <div id="si-dynamic-fields">${fieldsHtml}</div>

    <button class="btn btn-gold" style="width:100%;margin-top:1.2rem" onclick="saveShopItem('${itemId||''}')">
      ${item?'Enregistrer':'Ajouter à la boutique'}
    </button>
  `);

  setTimeout(() => {
    document.getElementById('si-img-zone')?.addEventListener('click', () => document.getElementById('si-img-file')?.click());
    document.getElementById('si-nom')?.focus();
    // Mise à jour du prix vente en temps réel
    _bindPrixListener();
  }, 60);
}

function _buildFieldsHtml(tpl, item) {
  if (!tpl?.fields) return '';
  let html = `<div class="sh-fields-grid">`;
  tpl.fields.forEach(f => {
    const val = item?.[f.id] ?? '';
    if (f.id === 'prix') {
      const pv = Math.round((parseFloat(val)||0) * PRIX_VENTE_RATIO);
      html += `<div class="form-group sh-field-prix">
        <label>${f.label}</label>
        <div class="sh-prix-wrap">
          <input type="number" class="input-field" id="si-${f.id}" value="${val}" min="0"
                 oninput="updatePrixVente(this.value)" style="max-width:110px">
          <span class="sh-prix-vente-display" id="si-prix-vente">
            🔄 <strong id="si-pv-val">${pv}</strong> or <span style="color:var(--text-dim);font-size:0.7rem">(60%)</span>
          </span>
        </div>
      </div>`;
    } else if (f.type === 'rarete') {
      const cur = parseInt(val)||0;
      html += `<div class="form-group">
        <label>${f.label}</label>
        <div class="sh-rarete-picker" id="si-rarete-wrap">
          ${[1,2,3,4].map(n=>`<button type="button" class="sh-rarete-star-btn ${cur>=n?'active':''}"
            data-val="${n}" onclick="pickRarete(${n})"
            style="${cur>=n?'color:#c084fc':'color:var(--text-dim)'}">★</button>`).join('')}
          <input type="hidden" id="si-rarete" value="${val}">
          <span class="sh-rarete-label" id="si-rarete-lbl">${_rareteLabel(val)}</span>
        </div>
      </div>`;
    } else if (f.type === 'dispo') {
      const isInfini = val !== undefined && val !== '' && parseInt(val) < 0;
      const dispoVal = isInfini ? '' : (val===''?'':parseInt(val)||'');
      html += `<div class="form-group">
        <label>${f.label}</label>
        <div class="sh-dispo-wrap">
          <input type="number" class="input-field" id="si-dispo" value="${dispoVal}"
                 min="0" placeholder="Ex: 3" style="max-width:90px;${isInfini?'opacity:0.4;pointer-events:none;':''}"
                 ${isInfini?'disabled':''}>
          <label class="sh-dispo-infini-label">
            <input type="checkbox" id="si-dispo-infini" ${isInfini?'checked':''}
                   onchange="toggleDispoInfini(this)">
            <span>∞ Illimité</span>
          </label>
        </div>
      </div>`;
    } else if (f.type === 'select') {
      html += `<div class="form-group">
        <label>${f.label}</label>
        <select class="input-field sh-modal-select" id="si-${f.id}">
          <option value="">— Choisir —</option>
          ${(f.options||[]).map(o=>`<option value="${o}" ${val===o?'selected':''}>${o}</option>`).join('')}
        </select>
      </div>`;
    } else if (f.type === 'textarea') {
      html += `<div class="form-group sh-field-full">
        <label>${f.label}</label>
        <textarea class="input-field" id="si-${f.id}" rows="2">${val}</textarea>
      </div>`;
    } else {
      html += `<div class="form-group">
        <label>${f.label}</label>
        <input class="input-field" id="si-${f.id}" value="${val}" placeholder="${f.placeholder||''}">
      </div>`;
    }
  });
  html += `</div>`;
  return html;
}

function _bindPrixListener() {
  const input = document.getElementById('si-prix');
  if (input) input.addEventListener('input', () => updatePrixVente(input.value));
}


const _RARETE_LABELS = ['','★ Commun','★★ Peu commun','★★★ Rare','★★★★ Très rare'];
function _rareteLabel(val) { return _RARETE_LABELS[parseInt(val)||0]||''; }

function pickRarete(n) {
  const hidden = document.getElementById('si-rarete');
  const lbl    = document.getElementById('si-rarete-lbl');
  if (hidden) hidden.value = n;
  if (lbl)    lbl.textContent = _RARETE_LABELS[n]||'';
  document.querySelectorAll('.sh-rarete-star-btn').forEach(btn => {
    const v = parseInt(btn.dataset.val);
    btn.classList.toggle('active', v <= n);
    btn.style.color = v <= n ? '#c084fc' : 'var(--text-dim)';
  });
}


function toggleDispoInfini(cb) {
  const input = document.getElementById('si-dispo');
  if (!input) return;
  if (cb.checked) {
    input.value = '';
    input.disabled = true;
    input.style.opacity = '0.4';
    input.style.pointerEvents = 'none';
  } else {
    input.disabled = false;
    input.style.opacity = '';
    input.style.pointerEvents = '';
    input.value = '5';
    input.focus();
  }
}

function updatePrixVente(val) {
  const pv = Math.round((parseFloat(val)||0) * PRIX_VENTE_RATIO);
  const el = document.getElementById('si-pv-val');
  if (el) el.textContent = pv;
}

// Quand on change de catégorie dans le modal → reconstruire les champs
function refreshItemFields(catId, scId) {
  const cat  = _cats.find(c => c.id === catId);
  const tpl  = TEMPLATES[cat?.template||'classique']||TEMPLATES.classique;
  const sel  = document.getElementById('si-subcat');
  if (sel) {
    sel.innerHTML = `<option value="">— Aucune —</option>` +
      (cat?.sousCats||[]).map(sc => `<option value="${sc.id}" ${scId===sc.id?'selected':''}>${sc.nom}</option>`).join('');
  }
  const dyn = document.getElementById('si-dynamic-fields');
  if (dyn) {
    dyn.innerHTML = _buildFieldsHtml(tpl, null);
    _bindPrixListener();
  }
}
// Alias pour compatibilité
function refreshSubCatSelect(catId, scId) { refreshItemFields(catId, scId); }

// ── Upload image → base64 ─────────────────────
function previewUpload(fileInputId, previewId, hiddenId) {
  const file = document.getElementById(fileInputId)?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const b64 = e.target.result;
    const hidden  = document.getElementById(hiddenId);
    if (hidden) hidden.value = b64;
    const preview = document.getElementById(previewId);
    if (preview) preview.innerHTML = `<img src="${b64}" style="max-height:80px;border-radius:8px;margin-top:0.4rem;display:block">`;
    // Mettre à jour la zone upload
    const zone = document.getElementById(fileInputId.replace('-file','-zone'));
    if (zone) {
      const lbl = zone.querySelector('.sh-upload-label');
      if (lbl) lbl.textContent = file.name;
    }
  };
  reader.readAsDataURL(file);
}

async function saveShopItem(itemId) {
  const catId  = document.getElementById('si-cat')?.value||'';
  const cat    = _cats.find(c => c.id === catId);
  const tplKey = cat?.template||'classique';
  const tpl    = TEMPLATES[tplKey]||TEMPLATES.classique;

  const nom = document.getElementById('si-nom')?.value.trim();
  if (!nom) { showNotif('Nom requis.', 'error'); return; }

  const data = {
    nom,
    categorieId:     catId,
    sousCategorieId: document.getElementById('si-subcat')?.value||'',
    image:           document.getElementById('si-img-b64')?.value||'',
  };

  // Récupérer tous les champs du template
  tpl.fields.forEach(f => {
    if (f.type === 'dispo') {
      const infini = document.getElementById('si-dispo-infini')?.checked;
      data[f.id] = infini ? -1 : (parseInt(document.getElementById('si-dispo')?.value)||0);
    } else {
      const el = document.getElementById(`si-${f.id}`);
      if (el) data[f.id] = f.type==='number' ? (parseFloat(el.value)||0) : el.value.trim();
    }
  });

  // Prix vente calculé
  data.prixVente = Math.round((parseFloat(data.prix)||0) * PRIX_VENTE_RATIO);

  if (itemId) await updateInCol('shop', itemId, data);
  else        await addToCol('shop', data);
  closeModalDirect();
  showNotif('Article enregistré !', 'success');
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
  openItemModal, refreshItemFields, refreshSubCatSelect,
  previewUpload, updatePrixVente, pickRarete,
  shopSetChar, buyItem,
  toggleDispoInfini,
  saveShopItem, deleteShopItem,
  openShopItemModal, editShopItem, filterShop,
});
