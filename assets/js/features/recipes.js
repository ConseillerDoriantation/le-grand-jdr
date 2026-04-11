// ══════════════════════════════════════════════════════════════════════════════
// RECIPES.JS — Recettes & Potions & Craft
// ✓ Admin : CRUD, ingrédients dynamiques, accès par joueur
// ✓ Joueur : voir uniquement ses recettes, envoyer à un autre (perd son accès)
// Firestore : collection 'recipes'
//   { type, nom, duree, effet, description, ingredients:[{nom,quantite}], acces:[uid,...] }
//   type : 'cuisine' | 'potion' | 'arme' | 'armure' | 'bijou'
// ══════════════════════════════════════════════════════════════════════════════
import { loadCollection, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import PAGES from './pages.js';
import { _rareteTag } from '../shared/rarity.js';
import { _esc, _norm } from '../shared/html.js';

// ── État local ─────────────────────────────────────────────────────────────────
let _all        = [];
let _shopItems  = []; // items de la boutique (arme/armure/bijou)
let _tab        = 'cuisine'; // 'cuisine' | 'potion' | 'arme' | 'armure' | 'bijou'
let _filterTxt  = '';

// ── Config des onglets ────────────────────────────────────────────────────────
const TABS = [
  { id:'cuisine', emoji:'🍳', label:'Cuisine' },
  { id:'potion',  emoji:'🧪', label:'Potions' },
  { id:'arme',    emoji:'⚔️', label:'Armes' },
  { id:'armure',  emoji:'🛡️', label:'Armures' },
  { id:'bijou',   emoji:'💍', label:'Bijoux' },
];
const CREATE_RECIPES = [
  TABS[0],
  TABS[1],
];

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
  const regular    = _isAdmin() ? _all : _all.filter(r => (r.acces || []).includes(uid));
  const converted  = _shopItems.map(_shopToRecipe).filter(Boolean);
  const shopVis    = _isAdmin() ? converted : converted.filter(r => (r.acces || []).includes(uid));
  return [...regular, ...shopVis];
}

// Retourne l'item brut (recipes ou shop) par id
function _findRaw(id) {
  return _all.find(x => x.id === id) || _shopItems.find(i => i.id === id) || null;
}
function _isShopItem(id) { return _shopItems.some(i => i.id === id); }

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
  const type = (itemFormat.startsWith('Arme') || item.degats) ? 'arme'
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
    type,
    nom:         item.nom || '?',
    rarete:      item.rarete || 0,
    format:      itemFormat,
    typeObjet:   item.sousType || item.slotArmure || item.slotBijou || '',
    degats:      item.degats ? `${item.degats}${item.degatsStat ? ' +' + item.degatsStat : ''}` : '',
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
  [_all, _shopItems] = await Promise.all([
    loadCollection('recipes'),
    loadCollection('shop'),
  ]);
  _all.sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
  _tab = _tab || 'cuisine';
  _render();
}

function _render() {
  const content = document.getElementById('main-content');
  const visible  = _visible();
  const tabInfo  = TABS.find(t => t.id === _tab) || TABS[0];

  const filtered = visible.filter(r => {
    if (r.type !== _tab) return false;
    if (!_filterTxt) return true;
    const s = _filterTxt.toLowerCase();
    return (r.nom||'').toLowerCase().includes(s)
        || (r.description||'').toLowerCase().includes(s)
        || (r.effet||'').toLowerCase().includes(s);
  });

  // Compteurs par onglet
  const counts = {};
  TABS.forEach(t => { counts[t.id] = visible.filter(r => r.type === t.id).length; });

  // Couleur de bordure selon le type
  const borderColor = {
    cuisine:'#e8b84b', potion:'#22c38e', arme:'#ff6b6b', armure:'#4f8cff', bijou:'#c084fc'
  };

  content.innerHTML = `
  <style>
    .rec-card { background:var(--bg-card);border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:box-shadow .15s;display:flex;flex-direction:column; }
    .rec-card:hover { box-shadow:0 4px 16px rgba(0,0,0,.3); }
    .rec-card-header { padding:.8rem 1rem .5rem;display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem; }
    .rec-card-name { font-family:'Cinzel',serif;font-size:.92rem;font-weight:700;color:var(--text); }
    .rec-card-body { padding:0 1rem .8rem;font-size:.82rem;color:var(--text-muted);line-height:1.6;flex:1; }
    .rec-tag { display:inline-flex;align-items:center;gap:.2rem;background:var(--bg-elevated);border:1px solid var(--border);border-radius:999px;padding:2px 8px;font-size:.68rem;color:var(--text-dim); }
    .rec-ingr-list { margin:.6rem 0 .4rem;display:flex;flex-direction:column;gap:.15rem; }
    .rec-ingr-row { display:flex;align-items:baseline;gap:.4rem;font-size:.82rem;color:var(--text);font-weight:500; }
    .rec-ingr-qty { color:var(--gold);font-weight:700;font-size:.78rem;min-width:40px; }
    .rec-divider { height:1px;background:var(--border);margin:.5rem 0; }
    .rec-effet { font-style:italic;color:var(--text-muted);font-size:.82rem;line-height:1.6; }
    .rec-footer { padding:.5rem 1rem .65rem;border-top:1px solid var(--border);background:rgba(0,0,0,.12);display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap; }
    .rec-btn { display:inline-flex;align-items:center;gap:.25rem;border-radius:8px;padding:3px 10px;font-size:.72rem;font-weight:500;border:1px solid;cursor:pointer;transition:all .15s; }
    .rec-btn-send { background:rgba(79,140,255,.08);border-color:rgba(79,140,255,.3);color:#4f8cff; }
    .rec-btn-send:hover { background:rgba(79,140,255,.18); }
    .rec-btn-acces { background:rgba(34,195,142,.08);border-color:rgba(34,195,142,.3);color:#22c38e; }
    .rec-btn-acces:hover { background:rgba(34,195,142,.18); }
    .rec-tabs { display:flex;gap:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;flex-wrap:wrap; }
    .rec-tab { flex:1;min-width:80px;padding:.5rem .6rem;font-size:.78rem;cursor:pointer;border:none;background:var(--bg-elevated);color:var(--text-dim);transition:all .15s;display:flex;align-items:center;justify-content:center;gap:.3rem;white-space:nowrap; }
    .rec-tab.active { background:var(--gold);color:#0b1118;font-weight:700; }
    .rec-tab:not(.active):hover { background:var(--bg-card);color:var(--text); }
    .rec-empty { text-align:center;padding:3rem 1rem;color:var(--text-dim); }
    .rec-stat-row { display:flex;gap:.4rem;flex-wrap:wrap;margin:.3rem 0; }
    .rec-stat { background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;padding:3px 9px;font-size:.72rem;color:var(--text-dim); }
    .rec-card-clickable { cursor:pointer; }
    .rec-card-clickable:hover { background:var(--bg-elevated); }
    .rec-stat-fmt { background:rgba(79,140,255,.1);border-color:rgba(79,140,255,.2);color:#7fb0ff; }
    .rec-stat-ca  { background:rgba(34,195,142,.1);border-color:rgba(34,195,142,.2);color:#22c38e; }
    [data-theme="light"] .rec-stat-fmt { background:rgba(37,99,235,.08);border-color:rgba(37,99,235,.18);color:#2563eb; }
    [data-theme="light"] .rec-stat-ca  { background:rgba(5,150,105,.08);border-color:rgba(5,150,105,.18);color:#059669; }
  </style>

  <!-- HEADER -->
  <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:1.25rem">
    <div>
      <div style="font-size:.7rem;color:var(--text-dim);letter-spacing:3px;text-transform:uppercase;margin-bottom:.2rem">Encyclopédie</div>
      <h1 style="font-family:'Cinzel',serif;font-size:1.8rem;color:var(--gold);letter-spacing:2px;margin:0">Recettes</h1>
    </div>
    ${_isAdmin() ? `
    <div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap">
      ${CREATE_RECIPES.map(t => `<button class="btn btn-outline btn-sm" onclick="openRecipeModal('${t.id}')">${t.emoji} + ${t.label}</button>`).join('')}
    </div>` : ''}
  </div>

  <!-- Info règles -->
  <div style="background:rgba(226,185,111,.05);border:1px solid rgba(226,185,111,.15);border-radius:10px;
    padding:.75rem 1rem;margin-bottom:1.25rem;font-size:.78rem;color:var(--text-muted);display:flex;flex-wrap:wrap;gap:.4rem .75rem">
    <span><strong style="color:var(--gold)">🍳</strong> Cuisine — Avant mission, bénéficie au groupe. Max 2 actifs.</span>
    <span>·</span>
    <span><strong style="color:#22c38e">🧪</strong> Potions — Effets individuels.</span>
    <span>·</span>
    <span><strong style="color:#ff6b6b">⚔️🛡️💍</strong> Craft — Nécessite les matériaux et un atelier.</span>
  </div>

  <!-- TABS + SEARCH -->
  <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.25rem;flex-wrap:wrap">
    <div class="rec-tabs" style="flex-shrink:0">
      ${TABS.map(t => `
        <button class="rec-tab ${_tab===t.id?'active':''}" onclick="recSetTab('${t.id}')">
          <span>${t.emoji}</span><span>${t.label}</span>
          <span style="font-size:.65rem;opacity:.7">(${counts[t.id]})</span>
        </button>`).join('')}
    </div>
    <input type="text" class="input-field" placeholder="🔍 Rechercher..."
      value="${_filterTxt}" oninput="recSearch(this.value)"
      style="max-width:240px;font-size:.82rem">
  </div>

  <div id="rec-grid-wrap">${_gridHtml(filtered, tabInfo, visible, borderColor)}</div>
  `;
}

function _gridHtml(filtered, tabInfo, visible, borderColor) {
  if (filtered.length === 0) return `
    <div class="rec-empty">
      <div style="font-size:2.5rem;margin-bottom:.75rem;opacity:.25">${tabInfo.emoji}</div>
      <p style="font-style:italic">
        ${visible.filter(r=>r.type===_tab).length === 0
          ? (_isAdmin() ? `Aucune recette de type "${tabInfo.label}" — créez-en une !` : `Aucune recette partagée avec vous dans cette catégorie.`)
          : 'Aucun résultat pour cette recherche.'}
      </p>
    </div>`;
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1rem">
    ${filtered.map(r => _renderCard(r, borderColor[r.type]||'#e8b84b')).join('')}
  </div>`;
}

function _renderGrid() {
  const wrap = document.getElementById('rec-grid-wrap');
  if (!wrap) { _render(); return; }
  const visible = _visible();
  const tabInfo = TABS.find(t => t.id === _tab) || TABS[0];
  const borderColor = { cuisine:'#e8b84b', potion:'#22c38e', arme:'#ff6b6b', armure:'#4f8cff', bijou:'#c084fc' };
  const filtered = visible.filter(r => {
    if (r.type !== _tab) return false;
    if (!_filterTxt) return true;
    const s = _filterTxt.toLowerCase();
    return (r.nom||'').toLowerCase().includes(s)
        || (r.description||'').toLowerCase().includes(s)
        || (r.effet||'').toLowerCase().includes(s);
  });
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

  return `<div class="rec-card${isCraftType ? ' rec-card-clickable' : ''}"
    style="border-left:3px solid ${accent}"
    ${isCraftType ? `onclick="openItemDetailModal('${r.id}')"` : ''}>
    <div class="rec-card-header">
      <div>
        <div class="rec-card-name">${r.nom||'?'}</div>
        <div style="display:flex;align-items:center;gap:.4rem;margin-top:.3rem;flex-wrap:wrap">
          ${r.duree && !isCraftType ? `<span class="rec-tag">⏱️ ${r.duree}</span>` : ''}
          ${r.famille ? `<span class="rec-tag">${r.famille}</span>` : ''}
          ${isAdmin ? `<span class="rec-tag" style="color:${nbAcces>0?'#22c38e':'var(--text-dim)'}">
            ${nbAcces>0 ? `✓ ${nbAcces} joueur${nbAcces>1?'s':''}` : '⚠ Non partagé'}
          </span>` : ''}
        </div>
      </div>
      ${isAdmin ? `
      <div style="display:flex;gap:.25rem;flex-shrink:0" onclick="event.stopPropagation()">
        <button class="btn-icon" onclick="${r._fromShop ? `openShopRecipeModal('${r.id}')` : `openRecipeModal('${r.type}','${r.id}')`}">✏️</button>
        <button class="btn-icon" style="color:#ff6b6b" onclick="${r._fromShop ? `deleteShopRecipe('${r.id}')` : `deleteRecipe('${r.id}')`}">🗑️</button>
      </div>` : ''}
    </div>
    <div class="rec-card-body">
      ${statsHtml}
      ${ingrHtml}
      ${!isCraftType && (ingrs.length||r.ingredients_texte) && (r.effet||r.description) ? '<div class="rec-divider"></div>' : ''}
      ${!isCraftType && r.description ? `<div style="margin-bottom:.3rem;color:var(--text-dim);font-size:.78rem">${r.description}</div>` : ''}
      ${!isCraftType && r.effet ? `<div class="rec-effet">✨ ${r.effet}</div>` : ''}
    </div>
    <div class="rec-footer" onclick="event.stopPropagation()">
      <div style="font-size:.7rem;color:var(--text-dim)">
        ${TABS.find(t=>t.id===r.type)?.emoji||''} ${TABS.find(t=>t.id===r.type)?.label||r.type}
      </div>
      <div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap">
        ${isAdmin ? `<button class="rec-btn rec-btn-acces" onclick="openAccesModal('${r.id}')">👥 Accès</button>` : ''}
        ${canSend ? `<button class="rec-btn rec-btn-send" onclick="openSendRecipeModal('${r.id}')">↗ Transmettre</button>` : ''}
      </div>
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL DÉTAIL ITEM (arme / armure / bijou)
// ══════════════════════════════════════════════════════════════════════════════
window.openItemDetailModal = function(id) {
  const r = _visible().find(x => x.id === id);
  if (!r) return;
  const tab = TABS.find(t => t.id === r.type) || TABS[0];

  // Pour les items boutique, utiliser l'item brut pour avoir tous les champs
  const item = r._fromShop ? (_findRaw(id) || r) : r;

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

  openModal(item.nom || r.nom, `
    ${image ? `<div style="margin:-1.5rem -1.5rem .75rem"><img src="${image}" style="width:100%;height:180px;object-fit:cover;border-radius:22px 22px 0 0;display:block"></div>` : ''}
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
};

// ══════════════════════════════════════════════════════════════════════════════
// MODAL ADMIN — Créer / Modifier une recette
// ══════════════════════════════════════════════════════════════════════════════
function openRecipeModal(type, id = '') {
  const r      = id ? _all.find(x => x.id === id) : null;
  const rType  = r?.type || type;
  const tab    = TABS.find(t => t.id === rType) || TABS[0];
  const ingrs  = Array.isArray(r?.ingredients) && r.ingredients.length
    ? r.ingredients
    : [{ nom:'', quantite:'' }, { nom:'', quantite:'' }];

  const isCraft = ['arme','armure','bijou'].includes(rType);
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

    <!-- Ingrédients / Matériaux -->
    <div class="form-group">
      <label style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem">
        ${isCraft ? '🔩 Matériaux requis' : '🌿 Ingrédients'}
        <button type="button" onclick="window._recAddIngr()"
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

    <button class="btn btn-gold" style="width:100%;margin-top:.25rem" onclick="saveRecipe('${id}','${rType}')">
      ${r ? 'Enregistrer' : 'Créer la recette'}
    </button>
  `);
}

function _ingrRow(ig = {}, i) {
  return `<div class="rec-ingr-dyn" id="rec-ig-${i}"
    style="display:flex;align-items:center;gap:.4rem;background:var(--bg-elevated);
    border-radius:8px;padding:.4rem .6rem;border:1px solid var(--border)">
    <input class="input-field" id="rec-ig-qty-${i}" value="${ig.quantite||''}"
      placeholder="Qté" style="width:70px;flex-shrink:0;font-size:.78rem;padding:4px 6px">
    <input class="input-field" id="rec-ig-nom-${i}" value="${ig.nom||''}"
      placeholder="Nom..." style="flex:1;font-size:.78rem;padding:4px 6px">
    <button type="button" onclick="window._recRemIngr(${i})"
      style="color:#ff6b6b;background:none;border:none;cursor:pointer;font-size:.9rem;padding:0 4px;flex-shrink:0">✕</button>
  </div>`;
}

window._recAddIngr = () => {
  const list = document.getElementById('rec-ingr-list');
  if (!list) return;
  const i = list.querySelectorAll('.rec-ingr-dyn').length;
  const div = document.createElement('div');
  div.innerHTML = _ingrRow({}, i);
  list.appendChild(div.firstElementChild);
};

window._recRemIngr = (i) => { document.getElementById(`rec-ig-${i}`)?.remove(); };

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

    const existing = id ? _all.find(r => r.id === id) : null;
    const type     = existing?.type || fallbackType || 'cuisine';

    const data = {
      type, nom,
      famille:     document.getElementById('rec-famille')?.value?.trim()   || '',
      duree:       document.getElementById('rec-duree')?.value?.trim()     || '',
      effet:       document.getElementById('rec-effet')?.value?.trim()     || '',
      description: document.getElementById('rec-desc')?.value?.trim()     || '',
      ingredients: _readIngrs(),
      acces:       existing?.acces || [],
      atelierReq:  document.getElementById('rec-atelierReq')?.value?.trim()|| '',
      tempsCraft:  document.getElementById('rec-tempsCraft')?.value?.trim()|| '',
    };

    if (id) {
      await updateInCol('recipes', id, data);
      const idx = _all.findIndex(r => r.id === id);
      if (idx >= 0) _all[idx] = { ...data, id };
    } else {
      const newId = await addToCol('recipes', data);
      if (typeof newId === 'string') _all.push({ ...data, id: newId });
      else _all = await loadCollection('recipes');
      _all.sort((a, b) => (a.nom||'').localeCompare(b.nom||''));
    }

    closeModal();
    showNotif(id ? `"${nom}" mis à jour !` : `"${nom}" créé !`, 'success');
    _tab = data.type;
    _render();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL SHOP — Modifier / Supprimer une recette issue de la boutique
// ══════════════════════════════════════════════════════════════════════════════
function openShopRecipeModal(id) {
  const item = _shopItems.find(i => i.id === id);
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
        <button type="button" onclick="window._recAddIngr()"
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

    <button class="btn btn-gold" style="width:100%;margin-top:.25rem" onclick="saveShopRecipe('${id}')">
      Enregistrer
    </button>
  `);
}

async function saveShopRecipe(id) {
  try {
    const recipeMeta = {
      atelierReq:  document.getElementById('srec-atelierReq')?.value?.trim() || '',
      tempsCraft:  document.getElementById('srec-tempsCraft')?.value?.trim() || '',
      ingredients: _readIngrs(),
      effet:       document.getElementById('srec-effet')?.value?.trim()      || '',
      description: document.getElementById('srec-desc')?.value?.trim()       || '',
    };

    await updateInCol('shop', id, { recipeMeta });
    const idx = _shopItems.findIndex(i => i.id === id);
    if (idx >= 0) _shopItems[idx].recipeMeta = recipeMeta;

    closeModal();
    showNotif('Recette mise à jour !', 'success');
    _render();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

async function deleteShopRecipe(id) {
  try {
    const item = _shopItems.find(i => i.id === id);
    if (!await confirmModal(`Retirer "${item?.nom||'cet objet'}" des recettes ? L'objet restera dans la boutique.`)) return;

    const recipeMeta = { ...(item?.recipeMeta || {}), hidden: true };
    await updateInCol('shop', id, { recipeMeta, acces: [] });
    const idx = _shopItems.findIndex(i => i.id === id);
    if (idx >= 0) {
      _shopItems[idx].recipeMeta = recipeMeta;
      _shopItems[idx].acces = [];
    }

    showNotif('Recette retirée.', 'success');
    _render();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

async function deleteRecipe(id) {
  try {
    const r = _all.find(x => x.id === id);
    if (!await confirmModal(`Supprimer "${r?.nom||'cette recette'}" ?`)) return;
    await deleteFromCol('recipes', id);
    _all = _all.filter(x => x.id !== id);
    showNotif('Recette supprimée.', 'success');
    _render();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
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
          onmouseover="this.style.borderColor='#22c38e';this.style.background='rgba(34,195,142,.06)'"
          onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--bg-elevated)'">
          <input type="checkbox" value="${j.uid}" ${accesUids.includes(j.uid)?'checked':''}
            style="accent-color:#22c38e;width:16px;height:16px">
          <span style="font-size:.84rem;color:var(--text)">${j.pseudo}</span>
          ${accesUids.includes(j.uid) ? `<span style="margin-left:auto;font-size:.65rem;color:#22c38e">✓ Actif</span>` : ''}
        </label>`).join('')}
    </div>
    <div style="display:flex;gap:.5rem;margin-top:.85rem">
      <button class="btn btn-gold" style="flex:1" onclick="saveAcces('${id}')">✓ Enregistrer</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);
}

async function saveAcces(id) {
  try {
    const checks    = [...document.querySelectorAll('#acces-list input[type="checkbox"]')];
    const newAcces  = checks.filter(c => c.checked).map(c => c.value);
    const isShop    = _isShopItem(id);
    await updateInCol(isShop ? 'shop' : 'recipes', id, { acces: newAcces });
    const list      = isShop ? _shopItems : _all;
    const idx       = list.findIndex(x => x.id === id);
    if (idx >= 0) list[idx].acces = newAcces;
    closeModal();
    showNotif(`Accès mis à jour — ${newAcces.length} joueur${newAcces.length>1?'s':''}.`, 'success');
    _render();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
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

  // Destinataires : joueurs qui n'ont PAS encore la recette (sauf l'envoyeur)
  const cibles = joueurs.filter(j => j.uid !== uid && !accesUids.includes(j.uid));
  if (!cibles.length) { showNotif('Tous les joueurs ont déjà cette recette.', 'success'); return; }

  openModal(`↗ Transmettre — ${r.nom}`, `
    <div style="background:rgba(255,107,107,.06);border:1px solid rgba(255,107,107,.2);border-radius:10px;
      padding:.6rem .85rem;margin-bottom:.85rem;font-size:.8rem;color:var(--text-muted)">
      ⚠️ En transmettant cette recette, <strong style="color:#ff6b6b">tu n'y auras plus accès</strong>. Elle appartient désormais à l'autre joueur.
    </div>
    <div style="font-size:.8rem;color:var(--text-dim);margin-bottom:.6rem">Choisir le destinataire :</div>
    <div style="display:flex;flex-direction:column;gap:.4rem">
      ${cibles.map(j => `
        <label style="display:flex;align-items:center;gap:.75rem;padding:.65rem .9rem;
          border-radius:10px;border:1px solid var(--border);background:var(--bg-elevated);cursor:pointer"
          onmouseover="this.style.borderColor='#4f8cff';this.style.background='rgba(79,140,255,.06)'"
          onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--bg-elevated)'">
          <input type="radio" name="send-rec-target" value="${j.uid}" style="accent-color:#4f8cff">
          <span style="font-size:.84rem;color:var(--text)">${j.pseudo}</span>
        </label>`).join('')}
    </div>
    <div style="display:flex;gap:.5rem;margin-top:.85rem">
      <button class="btn btn-gold" style="flex:1" onclick="sendRecipe('${id}')">↗ Transmettre définitivement</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);
}

async function sendRecipe(id) {
  try {
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

    await updateInCol(_isShopItem(id) ? 'shop' : 'recipes', id, { acces: newAcces });
    r.acces = newAcces;

    const targetName = _getJoueurs().find(j => j.uid === targetUid)?.pseudo || 'ce joueur';
    closeModal();
    showNotif(`"${r.nom}" transmise à ${targetName}. Tu n'y as plus accès.`, 'success');
    _render();
  } catch (e) {
    console.error('[save]', e);
    if (window.showNotif) window.showNotif('Erreur de sauvegarde. Réessaie.', 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════════
window.recSetTab = (t) => { _tab = t; _filterTxt = ''; _render(); };
window.recSearch = (v) => { _filterTxt = v; _renderGrid(); };

// ══════════════════════════════════════════════════════════════════════════════
// OVERRIDE + EXPORTS
// ══════════════════════════════════════════════════════════════════════════════
PAGES.recettes = renderRecipes;

Object.assign(window, {
  renderRecipes,
  openRecipeModal,
  saveRecipe,
  deleteRecipe,
  openShopRecipeModal,
  saveShopRecipe,
  deleteShopRecipe,
  openAccesModal,
  saveAcces,
  openSendRecipeModal,
  sendRecipe,
});