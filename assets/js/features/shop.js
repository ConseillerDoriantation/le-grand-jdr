import { STATE } from '../core/state.js';
import { loadCollection, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { openModal, closeModalDirect } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { RARETE_NAMES, _rareteColor, _rareteStars, buildRaretePicker, pickRarete } from '../shared/rarity.js';
import { _esc, _norm } from '../shared/html.js';
import { calcOr } from '../shared/char-stats.js';
import { loadWeaponFormats } from '../shared/weapon-formats.js';

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATES DE CHAMPS PAR TYPE DE BOUTIQUE
// ══════════════════════════════════════════════════════════════════════════════
const TEMPLATES = {
  arme: {
    label: '⚔️ Arme',
    fields: [
      { id:'format',      label:'Format',        type:'format_select' },
      { id:'sousType',    label:'Type d\'arme',  type:'text',   placeholder:'Épée, Lance, Dague, Arc, Bâton...' },
      { id:'rarete',      label:'Rareté',        type:'rarete' },
      { id:'degats',      label:'Dégâts',        type:'damage_with_stat', placeholder:'1D10, 2D6...' },
      { id:'toucherStat', label:'Toucher',       type:'stat_select' },
      { id:'portee',      label:'Portée',        type:'text',   placeholder:'Contact, 1m50, 9m / 27m...' },
      { id:'statBonuses', label:'Bonus de stats',type:'stat_bonus_grid' },
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
      { id:'traits',      label:'Traits',        type:'trait_list', placeholder:'Ajouter un trait...' },
      { id:'prix',        label:'Prix 🪙',       type:'number', placeholder:'0' },
      { id:'dispo',       label:'Dispo',         type:'dispo' },
    ],
  },
  classique: {
    label: '🧪 Classique',
    fields: [
      { id:'type',        label:'Type',          type:'text',     placeholder:'Consommable, Matériau, Accessoire...' },
      { id:'effet',       label:'Effet',         type:'textarea', placeholder:'(Action) Rend 10 PV...' },
      { id:'description', label:'Description',   type:'textarea', placeholder:'Détails...' },
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
  { key:'force',       short:'Fo',  store:'fo',  label:'Force' },
  { key:'dexterite',   short:'Dex', store:'dex', label:'Dextérité' },
  { key:'intelligence',short:'Int', store:'in',  label:'Intelligence' },
  { key:'sagesse',     short:'Sag', store:'sa',  label:'Sagesse' },
  { key:'constitution',short:'Con', store:'co',  label:'Constitution' },
  { key:'charisme',    short:'Cha', store:'ch',  label:'Charisme' },
];
const ITEM_STAT_BY_STORE = Object.fromEntries(ITEM_STATS.map(s => [s.store, s]));
const ITEM_STAT_BY_KEY = Object.fromEntries(ITEM_STATS.map(s => [s.key, s]));

function _statShort(key) {
  return ITEM_STAT_BY_KEY[key]?.short || '';
}

function _normalizeStatKey(val) {
  const raw = String(val || '').trim().toLowerCase().replace(/^\+/, '');
  if (!raw) return '';
  const map = {
    fo:'force', force:'force', str:'force',
    dex:'dexterite', dextérité:'dexterite', dexterite:'dexterite', agilite:'dexterite', agilité:'dexterite',
    int:'intelligence', intelligence:'intelligence', in:'intelligence',
    sag:'sagesse', sagesse:'sagesse', sa:'sagesse', wis:'sagesse',
    con:'constitution', constitution:'constitution', co:'constitution',
    cha:'charisme', charisme:'charisme', ch:'charisme',
  };
  return map[raw] || '';
}

function _parseLegacyStats(item = {}) {
  const out = { fo:0, dex:0, in:0, sa:0, co:0, ch:0 };
  ['fo','dex','in','sa','co','ch'].forEach(k => {
    const val = parseInt(item?.[k]);
    if (!Number.isNaN(val)) out[k] = val;
  });
  const txt = String(item?.stats || '');
  const aliases = {
    fo:['fo','force'], dex:['dex','dextérité','dexterite'], in:['in','int','intelligence'],
    sa:['sa','sag','sagesse'], co:['co','con','constitution'], ch:['ch','cha','charisme'],
  };
  Object.entries(aliases).forEach(([store, list]) => {
    if (out[store]) return;
    for (const token of list) {
      const re = new RegExp(`(?:^|[^a-z])${token}\s*([+-]\d+)|([+-]\d+)\s*${token}(?:[^a-z]|$)`, 'i');
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

function _legacyToucherTextFromData(data = {}) {
  const short = _statShort(data.toucherStat);
  return short ? `+${short}` : '';
}

function _buildCombatMeta(item = {}) {
  const parts = [];
  if (item.degats) {
    const stat = _statShort(item.degatsStat);
    parts.push(`⚔️ ${item.degats}${stat ? ` + ${stat}` : ''}`);
  }
  if (item.toucherStat) parts.push(`🎯 ${_statShort(item.toucherStat)}`);
  return parts;
}


// ══════════════════════════════════════════════════════════════════════════════
// ÉTAT
// ══════════════════════════════════════════════════════════════════════════════
let _cats  = [];
let _items = [];
let _weaponFormats = [];
let _view  = 'home';   // 'home' | 'items'
let _activeCat = null;
let _page = 1;
const PAGE_SIZE = 20;

// Filtres actifs (multi-sélection)
let _filterSearch = '';
let _filterTags   = new Set(); // valeurs de tags actifs

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
  // Exposer les sousTypes distincts pour que characters.js puisse les lire
  window._shopSousTypes = [...new Set(_items.filter(i=>i.sousType).map(i=>i.sousType))].sort();
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
  if (n.includes('bijou') || n.includes('anneau') || n.includes('amulette')) return '💍';
  if (n.includes('potion'))                        return '🧪';
  if (n.includes('magie') || n.includes('rune'))   return '✨';
  if (n.includes('épicerie') || n.includes('cuisine')) return '🍖';
  if (n.includes('outil'))                         return '🔧';
  return '📦';
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
  <style>
    .sh-item-traits { display:flex;flex-wrap:wrap;gap:.25rem;margin-top:.3rem; }
    .sh-trait-pill { display:inline-flex;align-items:center;padding:1px 7px;font-size:.66rem;
      background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
      border-radius:999px;color:var(--text-dim);font-style:italic; }
    .sh-tag-fmt { background:rgba(79,140,255,.1);border-color:rgba(79,140,255,.2);color:#7fb0ff; }
    .sh-tag-ca  { background:rgba(34,195,142,.1);border-color:rgba(34,195,142,.2);color:#22c38e; }
    .sh-item-epuise { opacity:.6; }
    .sh-epuise-badge { position:absolute;top:8px;left:8px;background:rgba(255,107,107,.85);
      color:#fff;font-size:.62rem;font-weight:700;padding:2px 8px;border-radius:6px;letter-spacing:.5px; }
    .sh-item-footer { display:flex;align-items:center;justify-content:space-between;
      gap:.4rem;margin-top:auto;padding-top:.4rem;border-top:1px solid var(--border); }
    .sh-item-card { cursor:pointer; }
    [data-theme="light"] .sh-trait-pill { background:rgba(0,0,0,.04);border-color:rgba(0,0,0,.09);color:var(--text-dim); }
    [data-theme="light"] .sh-tag-fmt { background:rgba(37,99,235,.08);border-color:rgba(37,99,235,.18);color:#2563eb; }
    [data-theme="light"] .sh-tag-ca  { background:rgba(5,150,105,.08);border-color:rgba(5,150,105,.18);color:#059669; }
  </style>
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
        <button class="btn btn-outline btn-sm" onclick="window.openWeaponFormatsAdmin?.()">⚙️ Formats d'armes</button>
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
  if (_view === 'home')  html += _renderHome();
  else if (_view === 'items') html += _renderItemsView();
  html += `</div>`;
  content.innerHTML = html;
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────
function _renderBreadcrumb() {
  if (_view === 'home') return '';
  const cat = _cats.find(c => c.id === _activeCat);
  return `
  <nav class="sh-breadcrumb" style="display:flex;align-items:center;gap:.4rem;margin-bottom:1rem;
    padding:.55rem .8rem;background:var(--bg-elevated);border-radius:10px;border:1px solid var(--border)">
    <button class="sh-crumb sh-crumb-link" onclick="shopGoHome()"
      style="display:flex;align-items:center;gap:.35rem;font-size:.82rem;color:var(--text-dim);
      background:none;border:none;cursor:pointer;padding:2px 6px;border-radius:6px;transition:color .15s"
      onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--text-dim)'">
      🛒 Boutique
    </button>
    <span style="color:var(--border-strong);font-size:.9rem">›</span>
    <span class="sh-crumb sh-crumb-active"
      style="font-size:.82rem;color:var(--text);font-weight:600">${cat?.nom||'Catégorie'}</span>
    <span style="margin-left:auto;font-size:.72rem;color:var(--text-dim)">
      ${_items.filter(i=>i.categorieId===_activeCat).length} articles
    </span>
  </nav>`;
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
    const count = _items.filter(i => i.categorieId === cat.id).length;
    const tpl   = TEMPLATES[cat.template||'classique'];
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
        <div class="sh-cat-meta">${count} article${count!==1?'s':''}</div>
      </div>
    </div>`;
  });
  html += `</div>`;
  return html;
}

// ══════════════════════════════════════════════════════════════════════════════
// VUE ARTICLES — filtres dynamiques multi-tags + recherche temps réel
// ══════════════════════════════════════════════════════════════════════════════
function _renderItemsView() {
  const cat = _cats.find(c => c.id === _activeCat);
  if (!cat) return '';

  // Appliquer filtres
  let items = _items.filter(i => i.categorieId === _activeCat);
  const search = (_filterSearch||'').toLowerCase().trim();
  if (search) items = items.filter(i =>
    (i.nom||'').toLowerCase().includes(search) ||
    (i.type||'').toLowerCase().includes(search) ||
    (i.description||'').toLowerCase().includes(search) ||
    (i.effet||'').toLowerCase().includes(search)
  );
  // ── Logique tags : OU au sein d'un groupe, ET entre groupes différents ──────
  // Ex: rareté "Commun" OU "Rare" ET emplacement "Tête" → items qui sont (Commun OU Rare) ET Tête
  if (_filterTags.size > 0) {
    // Reconstituer les groupes actifs
    const allItems0 = _items.filter(i => i.categorieId === _activeCat);
    const tagGroups0 = _buildTagGroups(allItems0);
    // Map groupLabel → Set de valeurs actives dans ce groupe
    const activeByGroup = new Map();
    for (const group of tagGroups0) {
      const activeInGroup = group.tags.filter(t => _filterTags.has(t.value)).map(t => t.value);
      if (activeInGroup.length > 0) activeByGroup.set(group.label, new Set(activeInGroup));
    }
    items = items.filter(i => {
      const iTags = _getItemTags(i);
      // L'item doit satisfaire TOUS les groupes actifs (ET entre groupes)
      for (const [, groupVals] of activeByGroup) {
        // Mais au sein d'un groupe c'est OU : suffit qu'un tag du groupe matche
        const matchesGroup = [...groupVals].some(v => iTags.has(v));
        if (!matchesGroup) return false;
      }
      return true;
    });
  }

  const total = items.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  const p     = Math.max(1, Math.min(_page, pages));
  const slice = items.slice((p-1)*PAGE_SIZE, p*PAGE_SIZE);
  const allItems  = _items.filter(i => i.categorieId === _activeCat);
  const tagGroups = _buildTagGroups(allItems);
  const hasFilters = search || _filterTags.size > 0;

  let html = `
  <div style="display:flex;flex-direction:column;gap:.75rem;margin-bottom:1rem">
    <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
      <div style="flex:1;min-width:200px;position:relative">
        <input type="text" id="sh-search" class="input-field"
          placeholder="🔍 Rechercher..."
          value="${_filterSearch||''}"
          oninput="shopFilterSearch(this.value)"
          autocomplete="off"
          style="width:100%;padding-right:2.2rem">
        ${_filterSearch ? `<button onclick="shopFilterSearch('')"
          style="position:absolute;right:.6rem;top:50%;transform:translateY(-50%);
          background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:.9rem">✕</button>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:.5rem;flex-shrink:0">
        <span id="sh-count" style="font-size:.78rem;color:var(--text-dim)">${total} article${total!==1?'s':''}</span>
        <button id="sh-clear-btn" onclick="shopFilterReset()"
          style="font-size:.72rem;background:rgba(255,107,107,.08);border:1px solid rgba(255,107,107,.25);
          border-radius:8px;padding:3px 10px;cursor:pointer;color:#ff6b6b;
          display:${hasFilters?'':'none'}">✕ Tout effacer</button>
        ${STATE.isAdmin?`<button class="btn btn-gold btn-sm" onclick="openItemModal()">+ Article</button>`:''}
      </div>
    </div>
    ${tagGroups.length > 0 ? `
    <div style="display:flex;flex-direction:column;gap:.4rem">
      ${tagGroups.map(group => `
      <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
        <span style="font-size:.65rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.8px;flex-shrink:0;min-width:70px">${group.label}</span>
        ${group.tags.map(tag => {
          const active = _filterTags.has(tag.value);
          const sv = tag.value.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
          return `<button
            data-tag-value="${tag.value.replace(/"/g,'&quot;')}"
            data-tag-color="${tag.color}"
            onclick="shopToggleTag('${sv}')"
            style="font-size:.72rem;border-radius:999px;padding:3px 10px;cursor:pointer;
            border:1px solid ${active ? tag.color : 'var(--border)'};
            background:${active ? tag.color+'22' : 'var(--bg-elevated)'};
            color:${active ? tag.color : 'var(--text-dim)'};
            transition:all .15s;font-weight:${active?'600':'400'}">${tag.label}</button>`;
        }).join('')}
      </div>`).join('')}
    </div>` : ''}
  </div>
  <div id="sh-items-results">`; 

  if (slice.length === 0) {
    html += `<div class="empty-state"><div class="icon">📦</div>
      <p>${hasFilters ? 'Aucun résultat pour ces filtres.' : 'Aucun article dans cette catégorie.'}</p>
      ${!hasFilters&&STATE.isAdmin?`<button class="btn btn-gold btn-sm" style="margin-top:.75rem" onclick="openItemModal()">+ Ajouter</button>`:''}</div>`;
  } else {
    html += _renderItemGrid(cat, slice);
  }

  if (pages > 1) {
    html += `<div class="sh-pagination">`;
    if (p>1) html += `<button class="sh-page-btn" onclick="shopPage(${p-1})">← Précédent</button>`;
    const start=Math.max(1,p-2), end=Math.min(pages,p+2);
    if(start>1) html+=`<button class="sh-page-btn" onclick="shopPage(1)">1</button>${start>2?'<span style="padding:0 4px;color:var(--text-dim)">…</span>':''}`;
    for(let i=start;i<=end;i++) html+=`<button class="sh-page-btn ${i===p?'active':''}" onclick="shopPage(${i})">${i}</button>`;
    if(end<pages) html+=`${end<pages-1?'<span style="padding:0 4px;color:var(--text-dim)">…</span>':''}<button class="sh-page-btn" onclick="shopPage(${pages})">${pages}</button>`;
    if(p<pages) html+=`<button class="sh-page-btn" onclick="shopPage(${p+1})">Suivant →</button>`;
    html += `</div>`;
  }
  html += `</div>`; // ferme #sh-items-results
  return html;
}

function _getItemTags(item) {
  const tags = new Set();
  if (item.format)     tags.add(item.format);
  if (item.sousType)   tags.add(item.sousType);   // type d'arme libre (Épée, Lance...)
  if (item.slotArmure) tags.add(item.slotArmure);
  if (item.typeArmure) tags.add(item.typeArmure);
  if (item.slotBijou)  tags.add(item.slotBijou);
  if (item.type)       tags.add(item.type);
  if (item.rarete) {
    const labels = {1:'Commun',2:'Peu commun',3:'Rare',4:'Très rare'};
    const l = labels[parseInt(item.rarete)];
    if (l) tags.add(l);
  }
  const dispo = item.dispo !== undefined && item.dispo !== '' ? parseInt(item.dispo) : null;
  if (dispo !== null && dispo > 0) tags.add('En stock');
  if (dispo === null || dispo < 0) tags.add('Illimité');
  return tags;
}

function _buildTagGroups(items) {
  const groups = [];
  const add = (label, vals, colorFn) => {
    if (vals.length) groups.push({ label, tags: vals.map(v => ({ value:v, label:v, color: colorFn(v) })) });
  };
  const formats = [...new Set(items.filter(i=>i.format).map(i=>i.format))].sort();
  if (formats.length) groups.push({ label:'Format', tags: formats.map(v=>({value:v,label:v,color:'#e8b84b'})) });
  const sousTypes = [...new Set(items.filter(i=>i.sousType).map(i=>i.sousType))].sort();
  if (sousTypes.length) groups.push({ label:'Type arme', tags: sousTypes.map(v=>({value:v,label:v,color:'#e8b84b'})) });
  const slotA = [...new Set(items.filter(i=>i.slotArmure).map(i=>i.slotArmure))].sort();
  if (slotA.length) groups.push({ label:'Emplacement', tags: slotA.map(v=>({value:v,label:v,color:'#4f8cff'})) });
  const typeA = [...new Set(items.filter(i=>i.typeArmure).map(i=>i.typeArmure))].sort();
  if (typeA.length) groups.push({ label:'Type armure', tags: typeA.map(v=>({value:v,label:v,color:'#4f8cff'})) });
  const bijou = [...new Set(items.filter(i=>i.slotBijou).map(i=>i.slotBijou))].sort();
  if (bijou.length) groups.push({ label:'Bijou', tags: bijou.map(v=>({value:v,label:v,color:'#c084fc'})) });
  const typeL = [...new Set(items.filter(i=>i.type&&!i.format&&!i.slotArmure&&!i.slotBijou).map(i=>i.type))].sort();
  if (typeL.length) groups.push({ label:'Type', tags: typeL.map(v=>({value:v,label:v,color:'var(--text-muted)'})) });
  const raretes = [...new Set(items.filter(i=>i.rarete).map(i=>parseInt(i.rarete)).filter(Boolean))].sort();
  if (raretes.length) groups.push({ label:'Rareté', tags: raretes.map(r=>({
    value: RARETE_NAMES[r]||String(r),
    label: '★'.repeat(r)+' '+(RARETE_NAMES[r]||''),
    color: _rareteColor(RARETE_NAMES[r]),
  })) });
  const hasStock = items.some(i=>{ const d=i.dispo!=null&&i.dispo!==''?parseInt(i.dispo):null; return d===null||d>0; });
  if (hasStock) groups.push({ label:'Dispo', tags:[
    {value:'En stock',label:'En stock',color:'#22c38e'},
    {value:'Illimité',label:'∞ Illimité',color:'#22c38e'},
  ] });
  return groups;
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

  // Normaliser traits : array ou string legacy
  const traitsArr = Array.isArray(item.traits) ? item.traits
    : (item.trait ? item.trait.split(',').map(t=>t.trim()).filter(Boolean) : []);

  // ── Bloc infos selon template ──────────────────────────────────────────────
  let infoHtml = '';
  const statBonuses = _formatStatBonuses(item);
  const combatMeta = _buildCombatMeta(item);
  if (tplKey === 'arme') {
    infoHtml = `
      <div class="sh-item-tags">
        ${item.format  ? `<span class="sh-tag sh-tag-fmt">${item.format.replace('Arme ','').replace(' Phy.','').replace(' Mag.',' ✨')}</span>` : ''}
        ${item.sousType ? `<span class="sh-tag">${item.sousType}</span>` : ''}
        ${item.rarete  ? _rareteStars(item.rarete) : ''}
        ${dispo !== null ? _dispoDisplay(item.dispo) : ''}
      </div>
      <div class="sh-item-combat">
        ${item.degats      ? `<span class="sh-combat-chip"><span class="sh-cc-label">⚔️</span><span class="sh-cc-val red">${item.degats}${item.degatsStat?`+${_statShort(item.degatsStat)}`:''}</span></span>` : ''}
        ${item.toucherStat ? `<span class="sh-combat-chip"><span class="sh-cc-label">🎯</span><span class="sh-cc-val gold">${_statShort(item.toucherStat)}</span></span>` : ''}
        ${item.portee      ? `<span class="sh-combat-chip"><span class="sh-cc-label">📏</span><span class="sh-cc-val">${item.portee}</span></span>` : ''}
      </div>
      ${statBonuses.length ? `<div class="sh-item-stats">${statBonuses.join(' · ')}</div>` : ''}
      ${traitsArr.length ? `<div class="sh-item-traits">${traitsArr.map(t=>`<span class="sh-trait-pill">${t}</span>`).join('')}</div>` : ''}`;
  } else if (tplKey === 'armure') {
    infoHtml = `
      <div class="sh-item-tags">
        ${item.slotArmure  ? `<span class="sh-tag">${item.slotArmure}</span>` : ''}
        ${item.typeArmure  ? `<span class="sh-tag sh-tag-fmt">${item.typeArmure}</span>` : ''}
        ${item.rarete ? _rareteStars(item.rarete) : ''}
        ${(item.ca||0) > 0 ? `<span class="sh-tag sh-tag-ca">🛡️ +${parseInt(item.ca)||0} CA</span>` : ''}
        ${dispo !== null ? _dispoDisplay(item.dispo) : ''}
      </div>
      ${statBonuses.length ? `<div class="sh-item-stats">${statBonuses.join(' · ')}</div>` : ''}
      ${traitsArr.length ? `<div class="sh-item-traits">${traitsArr.map(t=>`<span class="sh-trait-pill">${t}</span>`).join('')}</div>` : ''}`;
  } else if (tplKey === 'bijou') {
    infoHtml = `
      <div class="sh-item-tags">
        ${item.slotBijou ? `<span class="sh-tag">${item.slotBijou}</span>` : ''}
        ${item.rarete ? _rareteStars(item.rarete) : ''}
        ${dispo !== null ? _dispoDisplay(item.dispo) : ''}
      </div>
      ${statBonuses.length ? `<div class="sh-item-stats">${statBonuses.join(' · ')}</div>` : ''}
      ${traitsArr.length ? `<div class="sh-item-traits">${traitsArr.map(t=>`<span class="sh-trait-pill">${t}</span>`).join('')}</div>` : ''}`;
  } else {
    infoHtml = `
      ${item.type   ? `<div class="sh-item-type">${item.type}</div>` : ''}
      ${item.effet  ? `<div class="sh-item-effet">${item.effet}</div>` : ''}
      ${item.description ? `<div class="sh-item-desc-tooltip" title="${item.description.replace(/"/g,'&quot;')}">ℹ️ ${item.description.length>60?item.description.slice(0,60)+'…':item.description}</div>` : ''}
      ${dispo !== null ? `<div class="sh-item-tags">${_dispoDisplay(item.dispo)}</div>` : ''}`;
  }

  const hasChar = !!window._shopCharId;

  return `<div class="sh-item-card ${epuise?'sh-item-epuise':''} ${STATE.isAdmin?'sh-dnd-handle':''}"
    ${STATE.isAdmin&&itemIdx!==''?`draggable="true" ondragstart="shopItemDragStart(event,'${item.id}')" ondragover="shopItemDragOver(event)" ondrop="shopItemDrop(event,'${item.id}')" ondragend="shopItemDragEnd(event)"`:''}>
    <div class="sh-item-img" style="${item.image?`background-image:url('${item.image}')`:_catGradient(item.nom||'')}">
      <div class="sh-item-img-overlay"></div>
      ${epuise ? `<div class="sh-epuise-badge">Épuisé</div>` : ''}
    </div>
    <div class="sh-item-body" onclick="openShopItemDetail('${item.id}')">
      <div class="sh-item-name">${item.nom||'?'}</div>
      ${infoHtml}
      <div class="sh-item-footer">
        <div class="sh-item-prix-row">
          <span class="sh-item-prix-achat">💰 ${prix} or</span>
          <span class="sh-item-prix-vente" title="Revente (60%)">↩ ${prixVente}</span>
        </div>
        ${hasChar ? (
          epuise
            ? `<button class="btn sh-buy-btn" disabled style="opacity:.4;cursor:not-allowed">Épuisé</button>`
            : `<button class="btn sh-buy-btn" onclick="event.stopPropagation();buyItem('${item.id}')">🛒 Acheter</button>`
        ) : ''}
      </div>
    </div>
    ${STATE.isAdmin?`<div class="sh-item-actions" onclick="event.stopPropagation()">
      <button class="btn-icon" onclick="openItemModal('${item.id}')">✏️</button>
      <button class="btn-icon" onclick="deleteShopItem('${item.id}')">🗑️</button>
    </div>`:''}
  </div>`;
}

function openShopItemDetail(itemId) {
  const item = _items.find(i => i.id === itemId);
  if (!item) return;
  const cat    = _cats.find(c => c.id === item.categorieId);
  const tplKey = cat?.template || 'classique';
  const prix   = parseFloat(item.prix) || 0;
  const prixV  = Math.round(prix * PRIX_VENTE_RATIO);
  const dispo  = item.dispo !== undefined && item.dispo !== '' ? parseInt(item.dispo) : null;
  const epuise = dispo !== null && dispo === 0;
  const traitsArr = Array.isArray(item.traits) ? item.traits
    : (item.trait ? item.trait.split(',').map(t=>t.trim()).filter(Boolean) : []);
  const statBonuses = _formatStatBonuses(item);
  const hasChar = !!window._shopCharId;

  const rows = [];
  if (item.format)      rows.push(['Format', item.format]);
  if (item.sousType)    rows.push(['Type', item.sousType]);
  if (item.degats)      rows.push(['Dégâts', `${item.degats}${item.degatsStat?' + '+_statShort(item.degatsStat):''}`]);
  if (item.toucherStat) rows.push(['Toucher', _statShort(item.toucherStat)]);
  if (item.portee)      rows.push(['Portée', item.portee]);
  if (item.slotArmure)  rows.push(['Emplacement', item.slotArmure]);
  if (item.typeArmure)  rows.push(['Type armure', item.typeArmure]);
  if (item.ca > 0)      rows.push(['CA bonus', `+${item.ca}`]);
  if (item.slotBijou)   rows.push(['Emplacement', item.slotBijou]);
  if (item.type)        rows.push(['Type', item.type]);
  if (item.effet)       rows.push(['Effet', item.effet]);
  if (statBonuses.length) rows.push(['Bonus stats', statBonuses.join(', ')]);

  openModal(_esc(item.nom), `
    ${item.image ? `<div style="margin:-1.5rem -1.5rem .75rem;"><img src="${item.image}" style="width:100%;height:180px;object-fit:cover;border-radius:22px 22px 0 0;display:block"></div>` : ''}
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:.75rem">
      <div>
        <div style="font-family:'Cinzel',serif;font-size:1.15rem;font-weight:700;color:var(--text)">${_esc(item.nom)}</div>
        <div style="font-size:.75rem;color:var(--text-dim)">${cat?.nom||''} ${item.rarete?'· '+_rareteStars(item.rarete):''}</div>
      </div>
      <div style="text-align:right">
        <div style="font-family:'Cinzel',serif;font-size:1.1rem;font-weight:700;color:var(--gold)">💰 ${prix} or</div>
        <div style="font-size:.7rem;color:var(--text-dim)">Revente : ${prixV} or</div>
      </div>
    </div>

    ${rows.length ? `<div style="background:var(--bg-elevated);border-radius:10px;overflow:hidden;margin-bottom:.75rem">
      ${rows.map(([l,v],i)=>`<div style="display:flex;justify-content:space-between;padding:.45rem .75rem;${i?'border-top:1px solid var(--border)':''}">
        <span style="font-size:.78rem;color:var(--text-dim)">${l}</span>
        <span style="font-size:.78rem;color:var(--text);font-weight:600">${v}</span>
      </div>`).join('')}
    </div>` : ''}

    ${traitsArr.length ? `<div style="margin-bottom:.75rem">
      <div style="font-size:.68rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:.35rem">Traits</div>
      <div style="display:flex;flex-wrap:wrap;gap:.35rem">
        ${traitsArr.map(t=>`<span class="sh-trait-pill">${t}</span>`).join('')}
      </div>
    </div>` : ''}

    ${item.description ? `<div style="font-size:.82rem;color:var(--text-muted);line-height:1.7;margin-bottom:.75rem;padding:.6rem .75rem;background:rgba(255,255,255,.02);border-radius:8px;border-left:2px solid var(--border-strong)">${item.description}</div>` : ''}

    <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap;padding-top:.5rem;border-top:1px solid var(--border)">
      <div style="font-size:.75rem;color:${dispo===null?'var(--text-dim)':dispo===0?'#ff6b6b':'#22c38e'}">
        ${dispo===null?'∞ Stock illimité':dispo===0?'Épuisé':`${dispo} en stock`}
      </div>
      <div style="display:flex;gap:.5rem">
        ${STATE.isAdmin ? `<button class="btn btn-outline btn-sm" onclick="closeModalDirect();openItemModal('${item.id}')">✏️ Modifier</button>` : ''}
        ${hasChar && !epuise ? `<button class="btn btn-gold btn-sm" onclick="closeModalDirect();buyItem('${item.id}')">🛒 Acheter</button>` : ''}
        ${epuise ? `<span style="font-size:.78rem;color:#ff6b6b;padding:.4rem .75rem;background:rgba(255,107,107,.1);border-radius:8px">Épuisé</span>` : ''}
      </div>
    </div>
  `);
}

// _esc → importé depuis shared/html.js

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
  try {
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
      degats:item.degats||'', degatsStat:item.degatsStat||'',
      toucher:item.toucher||'', toucherStat:item.toucherStat||'',
      ca:item.ca||'', stats:item.stats||'',
      fo:parseInt(item.fo)||0, dex:parseInt(item.dex)||0, in:parseInt(item.in)||0,
      sa:parseInt(item.sa)||0, co:parseInt(item.co)||0, ch:parseInt(item.ch)||0,
      effet:item.effet||'', description:item.description||'',
      slotArmure:item.slotArmure||'', typeArmure:item.typeArmure||'',
      slotBijou:item.slotBijou||'',
      sousType:item.sousType||'',
      portee:item.portee||'',
      traits:Array.isArray(item.traits)?[...item.traits]:[],
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
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
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
  try {
    const c = STATE.characters?.find(x => x.id === charId);
    if (!c) return;

    const inv  = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
    const item = inv[invIndex];
    if (!item) return;

    const prixVente = parseFloat(item.prixVente) || 0;
    const itemNom   = item.nom || 'cet objet';

    if (!await confirmModal(`Vendre "${itemNom}" pour ${prixVente} or ?`)) return;

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
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// Exposer pour characters.js
window.sellInvItemFromShop = sellInvItemFromShop;

// ══════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════════
function shopGoHome()     { _view='home';  _activeCat=null; _page=1; _filterSearch=''; _filterTags.clear(); renderShop(); }
function shopGoCat(catId) { _view='items'; _activeCat=catId; _page=1; _filterSearch=''; _filterTags.clear(); renderShop(); }
function shopPage(p)      { _page=p; renderShop(); }

// ── Fonctions de filtre ───────────────────────────────────────────────────────
function shopFilterSearch(val) {
  _filterSearch = val;
  _page = 1;
  if (_view === 'items') _updateItemsOnly();
  else renderShop();
}

function shopToggleTag(val) {
  if (_filterTags.has(val)) _filterTags.delete(val);
  else _filterTags.add(val);
  _page = 1;
  if (_view === 'items') _updateItemsOnly();
  else renderShop();
}

function shopFilterReset() {
  _filterSearch = ''; _filterTags.clear(); _page = 1;
  const inp = document.getElementById('sh-search');
  if (inp) inp.value = '';
  if (_view === 'items') _updateItemsOnly();
  else renderShop();
}

// ── Mise à jour partielle : grille + compteur + tags, sans toucher le champ texte ──
function _updateItemsOnly() {
  const cat = _cats.find(c => c.id === _activeCat);
  if (!cat) { renderShop(); return; }

  // ── Recalculer items filtrés ────────────────────────────────────────────
  let items = _items.filter(i => i.categorieId === _activeCat);
  const search = (_filterSearch||'').toLowerCase().trim();
  if (search) items = items.filter(i =>
    (i.nom||'').toLowerCase().includes(search) ||
    (i.type||'').toLowerCase().includes(search) ||
    (i.sousType||'').toLowerCase().includes(search) ||
    (i.description||'').toLowerCase().includes(search) ||
    (i.effet||'').toLowerCase().includes(search)
  );
  if (_filterTags.size > 0) {
    const tagGroups0 = _buildTagGroups(_items.filter(i => i.categorieId === _activeCat));
    const activeByGroup = new Map();
    for (const group of tagGroups0) {
      const active = group.tags.filter(t => _filterTags.has(t.value)).map(t => t.value);
      if (active.length > 0) activeByGroup.set(group.label, new Set(active));
    }
    items = items.filter(i => {
      const iTags = _getItemTags(i);
      for (const [, gVals] of activeByGroup) {
        if (![...gVals].some(v => iTags.has(v))) return false;
      }
      return true;
    });
  }

  const total  = items.length;
  const pages  = Math.ceil(total / PAGE_SIZE);
  const p      = Math.max(1, Math.min(_page, pages));
  const slice  = items.slice((p-1)*PAGE_SIZE, p*PAGE_SIZE);
  const hasF   = search || _filterTags.size > 0;

  // ── Mettre à jour le compteur ───────────────────────────────────────────
  const counter = document.getElementById('sh-count');
  if (counter) counter.textContent = `${total} article${total!==1?'s':''}`;

  // ── Mettre à jour le bouton "Tout effacer" ──────────────────────────────
  const clearBtn = document.getElementById('sh-clear-btn');
  if (clearBtn) clearBtn.style.display = hasF ? '' : 'none';

  // ── Mettre à jour l'état visuel des boutons tags (sans recréer le DOM) ──
  document.querySelectorAll('[data-tag-value]').forEach(btn => {
    const v     = btn.dataset.tagValue;
    const color = btn.dataset.tagColor || 'var(--text-dim)';
    const active = _filterTags.has(v);
    btn.style.borderColor = active ? color : 'var(--border)';
    btn.style.background  = active ? color+'22' : 'var(--bg-elevated)';
    btn.style.color       = active ? color : 'var(--text-dim)';
    btn.style.fontWeight  = active ? '600' : '400';
  });

  // ── Mettre à jour la grille + pagination ────────────────────────────────
  const grid = document.getElementById('sh-items-results');
  if (!grid) { renderShop(); return; }

  let html = '';
  if (slice.length === 0) {
    html = `<div class="empty-state"><div class="icon">📦</div>
      <p>${hasF ? 'Aucun résultat pour ces filtres.' : 'Aucun article dans cette catégorie.'}</p>
      ${!hasF&&STATE.isAdmin?`<button class="btn btn-gold btn-sm" style="margin-top:.75rem" onclick="openItemModal()">+ Ajouter</button>`:''}</div>`;
  } else {
    html = _renderItemGrid(cat, slice);
  }
  if (pages > 1) {
    html += `<div class="sh-pagination">`;
    if (p>1) html += `<button class="sh-page-btn" onclick="shopPage(${p-1})">← Précédent</button>`;
    const st=Math.max(1,p-2), en=Math.min(pages,p+2);
    if(st>1) html+=`<button class="sh-page-btn" onclick="shopPage(1)">1</button>${st>2?'<span style="padding:0 4px;color:var(--text-dim)">…</span>':''}`;
    for(let i=st;i<=en;i++) html+=`<button class="sh-page-btn ${i===p?'active':''}" onclick="shopPage(${i})">${i}</button>`;
    if(en<pages) html+=`${en<pages-1?'<span style="padding:0 4px;color:var(--text-dim)">…</span>':''}<button class="sh-page-btn" onclick="shopPage(${pages})">${pages}</button>`;
    if(p<pages) html+=`<button class="sh-page-btn" onclick="shopPage(${p+1})">Suivant →</button>`;
    html += `</div>`;
  }
  grid.innerHTML = html;
}

// Compat
function shopGoSubCat() {}
function shopFilterBy()  {}
window._shopSearch = '';
window._shopFilterRarete = '';
window._shopFilterDispo  = '';

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
  try {
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
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
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
  try {
    const nom=document.getElementById('cat-nom')?.value.trim();
    if(!nom){showNotif('Nom requis.','error');return;}
    const data={ nom, template:document.getElementById('cat-template')?.value||'classique', emoji:document.getElementById('cat-emoji')?.value.trim()||'', image:document.getElementById('cat-img-b64')?.value||'' };
    if(catId) await updateInCol('shopCategories',catId,data);
    else await addToCol('shopCategories',{...data,ordre:_cats.length,sousCats:[]});
    closeModalDirect(); showNotif(catId?'Catégorie mise à jour.':'Catégorie créée !','success'); renderShop();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

async function deleteCat(catId) {
  try {
    const n=_items.filter(i=>i.categorieId===catId).length;
    if (!await confirmModal(n>0?`Cette catégorie contient ${n} article(s). Supprimer quand même ?`:'Supprimer cette catégorie ?')) return;
    const toDelete=_items.filter(i=>i.categorieId===catId);
    await Promise.all(toDelete.map(i=>deleteFromCol('shop',i.id)));
    await deleteFromCol('shopCategories',catId);
    if(_activeCat===catId){_view='home';_activeCat=null;}
    showNotif(`Catégorie et ${toDelete.length} article(s) supprimés.`,'success'); renderShop();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
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
  try {
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
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

async function deleteSubCat(catId,scId) {
  try {
    if (!await confirmModal('Supprimer cette sous-catégorie ?')) return;
    const cat=_cats.find(c=>c.id===catId); if(!cat) return;
    const sousCats=(cat.sousCats||[]).filter(s=>s.id!==scId);
    await updateInCol('shopCategories',catId,{sousCats});
    if(_activeSubCat===scId){_view='cat';_activeSubCat=null;}
    showNotif('Sous-catégorie supprimée.','success'); renderShop();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL ARTICLE — champs dynamiques selon template
// ══════════════════════════════════════════════════════════════════════════════
function openItemModal(itemId) {
  const item       = itemId ? _items.find(i=>i.id===itemId) : null;
  const defCatId   = item?.categorieId || _activeCat || '';
  const cat        = _cats.find(c=>c.id===defCatId);
  const tplKey     = cat?.template || 'classique';
  const tpl        = TEMPLATES[tplKey] || TEMPLATES.classique;
  const catOptions = _cats.map(c=>`<option value="${c.id}" ${defCatId===c.id?'selected':''}>${c.nom} (${TEMPLATES[c.template||'classique']?.label||''})</option>`).join('');
  const fieldsHtml = _buildFieldsHtml(tpl, item);
  const recipeCheckboxChecked = item ? !(item?.recipeMeta?.hidden) : ['arme','armure','bijou'].includes(tplKey);
  openModal(item?'✏️ Modifier l\'article':'🛒 Nouvel article',`
    <div class="form-group"><label>Catégorie</label>
      <select class="input-field sh-modal-select" id="si-cat" onchange="refreshItemFields(this.value)">
        <option value="">— Aucune —</option>${catOptions}
      </select>
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
    <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.75rem;border-radius:8px;border:1px solid var(--border);">
      <span style="font-size:.90rem;color:var(--text-dim);white-space:nowrap;">Activer la recette pour cet item</span>
      <input type="checkbox" id="si-has-recipe" ${recipeCheckboxChecked ? 'checked' : ''} style="margin:0;flex-shrink:0;cursor:pointer;">
    </div>
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
      html+=`<div class="form-group"><label>${f.label}</label>${buildRaretePicker('si', val)}</div>`;
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
    } else if(f.type==='format_select'){
      html+=`<div class="form-group"><label>${f.label}</label>
        <select class="input-field sh-modal-select" id="si-${f.id}">
          <option value="">— Choisir —</option>
          ${_weaponFormats.map(o=>`<option value="${o.label}" ${val===o.label?'selected':''}>${o.label}</option>`).join('')}
        </select></div>`;
    } else if(f.type==='damage_with_stat'){
      const degatsStat = item?.degatsStat || item?.statAttaque || '';
      html+=`<div class="form-group sh-field-full"><label>${f.label}</label>
        <div class="sh-modal-selects">
          <input class="input-field" id="si-degats" value="${item?.degats||''}" placeholder="${f.placeholder||''}">
          <select class="input-field sh-modal-select" id="si-degatsStat">
            <option value="">Mod. dégâts</option>
            ${ITEM_STATS.map(stat=>`<option value="${stat.key}" ${_normalizeStatKey(degatsStat)===stat.key?'selected':''}>${stat.label}</option>`).join('')}
          </select>
        </div></div>`;
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
        <div class="grid-3" style="gap:0.7rem">
          ${ITEM_STATS.map(stat=>`<div class="form-group" style="margin:0">
            <label style="font-size:0.78rem;color:var(--text-dim)">${stat.short}</label>
            <input type="number" class="input-field" id="si-${stat.store}" value="${parsed[stat.store]||''}" placeholder="0">
          </div>`).join('')}
        </div>
        <div style="font-size:0.72rem;color:var(--text-dim);margin-top:0.35rem">Laisse vide ou 0 si l'objet ne donne pas de bonus.</div>
      </div>`;
    } else if(f.type==='textarea'){
      html+=`<div class="form-group sh-field-full"><label>${f.label}</label>
        <textarea class="input-field" id="si-${f.id}" rows="2">${val}</textarea></div>`;
    } else if(f.type==='trait_list'){
      // traits est un array, ou une string legacy (ancien champ 'trait')
      const traitsArr = Array.isArray(item?.traits) ? item.traits
        : (item?.trait ? [item.trait] : []);
      const traitsJson = JSON.stringify(traitsArr).replace(/"/g,'&quot;');
      html+=`<div class="form-group sh-field-full">
        <label>${f.label}</label>
        <input type="hidden" id="si-traits-data" value="${traitsJson}">
        <div id="si-traits-list" style="display:flex;flex-direction:column;gap:.35rem;margin-bottom:.4rem">
          ${traitsArr.map((t,i)=>`
          <div style="display:flex;gap:.4rem;align-items:center" data-trait-idx="${i}">
            <input class="input-field" style="flex:1;font-size:.83rem" value="${t.replace(/"/g,'&quot;')}"
              oninput="window._shopTraitUpdate(${i},this.value)" placeholder="Trait...">
            <button type="button" onclick="window._shopTraitRemove(${i})"
              style="background:none;border:none;cursor:pointer;color:#ff6b6b;font-size:.9rem;padding:2px 6px">✕</button>
          </div>`).join('')}
        </div>
        <button type="button" onclick="window._shopTraitAdd()"
          style="font-size:.75rem;padding:4px 12px;border-radius:8px;cursor:pointer;
          border:1px dashed var(--border);background:transparent;color:var(--text-dim);
          transition:all .12s;width:100%"
          onmouseover="this.style.borderColor='var(--gold)';this.style.color='var(--gold)'"
          onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-dim)'">
          + Ajouter un trait
        </button>
      </div>`;
      } else {
      const inputType = f.type === 'number' ? 'number' : 'text';
      html+=`<div class="form-group"><label>${f.label}</label>
        <input type="${inputType}" class="input-field" id="si-${f.id}" value="${val}" placeholder="${f.placeholder||''}"></div>`;
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
        oninput="window._shopTraitUpdate(${i},this.value)" placeholder="Trait...">
      <button type="button" onclick="window._shopTraitRemove(${i})"
        style="background:none;border:none;cursor:pointer;color:#ff6b6b;font-size:.9rem;padding:2px 6px">✕</button>
    </div>`).join('');
}
window._shopTraitAdd = () => {
  const arr = _shopTraitsGet(); arr.push(''); _shopTraitsSet(arr); _shopTraitsRender(arr);
  // Focus le dernier input
  const list = document.getElementById('si-traits-list');
  const inputs = list?.querySelectorAll('input');
  inputs?.[inputs.length-1]?.focus();
};
window._shopTraitUpdate = (i, val) => {
  const arr = _shopTraitsGet(); arr[i] = val; _shopTraitsSet(arr);
};
window._shopTraitRemove = (i) => {
  const arr = _shopTraitsGet(); arr.splice(i,1); _shopTraitsSet(arr); _shopTraitsRender(arr);
};


function toggleDispoInfini(cb){
  const input=document.getElementById('si-dispo'); if(!input) return;
  if(cb.checked){ input.value=''; input.disabled=true; input.style.opacity='0.4'; input.style.pointerEvents='none'; }
  else { input.disabled=false; input.style.opacity=''; input.style.pointerEvents=''; input.value='5'; input.focus(); }
}
function updatePrixVente(val){ const pv=Math.round((parseFloat(val)||0)*PRIX_VENTE_RATIO); const el=document.getElementById('si-pv-val'); if(el) el.textContent=pv; }

function refreshItemFields(catId) {
  const cat=_cats.find(c=>c.id===catId);
  const tpl=TEMPLATES[cat?.template||'classique']||TEMPLATES.classique;
  const dyn=document.getElementById('si-dynamic-fields');
  if(dyn){ dyn.innerHTML=_buildFieldsHtml(tpl,null); _bindPrixListener(); }
}
function refreshSubCatSelect(catId){ refreshItemFields(catId); }

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
  try {
    const item = itemId ? _items.find(i=>i.id===itemId) : null;
    const catId=document.getElementById('si-cat')?.value||'';
    const cat=_cats.find(c=>c.id===catId);
    const tplKey=cat?.template||'classique';
    const tpl=TEMPLATES[tplKey]||TEMPLATES.classique;
    const nom=document.getElementById('si-nom')?.value.trim();
    if(!nom){showNotif('Nom requis.','error');return;}

    const data={ nom, categorieId:catId, image:document.getElementById('si-img-b64')?.value||'' };

    tpl.fields.forEach(f=>{
      if(f.type==='dispo'){
        const infini=document.getElementById('si-dispo-infini')?.checked;
        data[f.id]=infini?-1:(parseInt(document.getElementById('si-dispo')?.value)||0);
      } else if (f.type === 'damage_with_stat') {
        data.degats = document.getElementById('si-degats')?.value.trim() || '';
        data.degatsStat = document.getElementById('si-degatsStat')?.value || '';
      } else if (f.type === 'stat_select') {
        data[f.id] = document.getElementById(`si-${f.id}`)?.value || '';
      } else if (f.type === 'stat_bonus_grid') {
        ITEM_STATS.forEach(stat => {
          data[stat.store] = parseInt(document.getElementById(`si-${stat.store}`)?.value) || 0;
        });
      } else if (f.type === 'trait_list') {
        // Lire depuis le champ caché + mettre à jour les inputs
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

    // Handle recipe checkbox
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

    // ── Synchroniser inventaires et équipements des personnages ─────────────
    if (itemId) await _syncCharactersAfterItemUpdate(itemId, data);

    closeModalDirect(); showNotif('Article enregistré !','success'); renderShop();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

/**
 * Après modification d'un article boutique :
 * - Met à jour les copies dans les inventaires des personnages (source:'boutique', itemId = itemId)
 * - Met à jour les slots d'équipement qui référencent cet itemId
 */
async function _syncCharactersAfterItemUpdate(itemId, newData) {
  const chars = STATE.characters || [];
  if (!chars.length) return;

  const SYNC_FIELDS = [
    'nom','format','rarete','degats','degatsStat','toucher','toucherStat','ca','stats',
    'fo','dex','in','sa','co','ch','traits','portee','type','effet','description',
    'slotArmure','typeArmure','slotBijou','prixVente','sousType',
  ];

  const updates = [];

  chars.forEach(c => {
    let changed = false;
    const inv   = Array.isArray(c.inventaire) ? [...c.inventaire] : [];
    const equip = { ...(c.equipement||{}) };

    // Mettre à jour les items dans l'inventaire
    inv.forEach((item, i) => {
      if (item.source === 'boutique' && item.itemId === itemId) {
        SYNC_FIELDS.forEach(f => {
          if (newData[f] !== undefined) inv[i] = { ...inv[i], [f]: newData[f] };
        });
        // Mettre à jour prixAchat si le prix change
        if (newData.prix !== undefined) inv[i].prixAchat = parseFloat(newData.prix)||0;
        changed = true;
      }
    });

    // Mettre à jour les slots d'équipement qui ont sourceInvIndex ou itemId
    Object.entries(equip).forEach(([slot, equipped]) => {
      if (equipped?.itemId === itemId) {
        const syncEquip = {};
        SYNC_FIELDS.forEach(f => { if (newData[f] !== undefined) syncEquip[f] = newData[f]; });
        if (newData.nom !== undefined) syncEquip.nom = newData.nom;
        equip[slot] = { ...equipped, ...syncEquip };
        changed = true;
      }
      // Fallback : sync via sourceInvIndex
      else if (equipped?.sourceInvIndex !== undefined) {
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
      c.inventaire = inv;
      c.equipement = equip;
      updates.push(updateInCol('characters', c.id, { inventaire: inv, equipement: equip }));
    }
  });

  if (updates.length > 0) {
    await Promise.all(updates);
    showNotif(`🔄 ${updates.length} personnage${updates.length>1?'s':''} mis à jour.`, 'success');
  }
}

async function deleteShopItem(itemId) {
  try {
    if (!await confirmModal('Supprimer cet article ?')) return;
    await deleteFromCol('shop',itemId);
    showNotif('Article supprimé.','success'); renderShop();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
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
  openShopItemModal, openShopItemDetail, editShopItem, filterShop,
  shopCatDragStart, shopCatDragOver, shopCatDragEnd, shopCatDrop,
  shopScDragStart, shopScDragOver, shopScDragEnd, shopScDrop,
  shopItemDragStart, shopItemDragOver, shopItemDragEnd, shopItemDrop,
  shopFilterSearch, shopFilterBy, shopFilterReset, shopToggleTag,
});