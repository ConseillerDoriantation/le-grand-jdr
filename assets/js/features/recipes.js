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

// ── État local ─────────────────────────────────────────────────────────────────
let _all       = [];
let _tab       = 'cuisine'; // 'cuisine' | 'potion' | 'arme' | 'armure' | 'bijou'
let _filterTxt = '';

// ── Config des onglets ────────────────────────────────────────────────────────
const TABS = [
  { id:'cuisine', emoji:'🍳', label:'Cuisine' },
  { id:'potion',  emoji:'🧪', label:'Potions' },
  { id:'arme',    emoji:'⚔️', label:'Armes' },
  { id:'armure',  emoji:'🛡️', label:'Armures' },
  { id:'bijou',   emoji:'💍', label:'Bijoux' },
];

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
  const uid = _myUid();
  if (_isAdmin()) return _all;
  return _all.filter(r => (r.acces || []).includes(uid));
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDU PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
async function renderRecipes() {
  const content = document.getElementById('main-content');
  content.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-dim)"><div style="font-size:2rem">⏳</div></div>`;
  _all = await loadCollection('recipes');
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
    .rec-card { background:var(--bg-card);border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:box-shadow .15s; }
    .rec-card:hover { box-shadow:0 4px 16px rgba(0,0,0,.3); }
    .rec-card-header { padding:.8rem 1rem .5rem;display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem; }
    .rec-card-name { font-family:'Cinzel',serif;font-size:.92rem;font-weight:700;color:var(--text); }
    .rec-card-body { padding:0 1rem .8rem;font-size:.82rem;color:var(--text-muted);line-height:1.6; }
    .rec-tag { display:inline-flex;align-items:center;gap:.2rem;background:var(--bg-elevated);border:1px solid var(--border);border-radius:999px;padding:2px 8px;font-size:.68rem;color:var(--text-dim); }
    .rec-ingr-list { margin:.4rem 0;display:flex;flex-direction:column;gap:.15rem; }
    .rec-ingr-row { display:flex;align-items:baseline;gap:.4rem;font-size:.78rem;color:var(--text-muted); }
    .rec-ingr-qty { color:var(--gold);font-weight:600;font-size:.72rem;min-width:40px; }
    .rec-divider { height:1px;background:var(--border);margin:.5rem 0; }
    .rec-effet { font-style:italic;color:var(--text-muted);font-size:.82rem;line-height:1.6; }
    .rec-footer { padding:.5rem 1rem .65rem;border-top:1px solid var(--border);background:rgba(0,0,0,.12);display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap; }
    .rec-btn { display:inline-flex;align-items:center;gap:.25rem;border-radius:8px;padding:3px 10px;font-size:.72rem;font-weight:500;border:1px solid;cursor:pointer;transition:all .15s; }
    .rec-btn-send { background:rgba(79,140,255,.08);border-color:rgba(79,140,255,.3);color:#4f8cff; }
    .rec-btn-send:hover { background:rgba(79,140,255,.18); }
    .rec-btn-acces { background:rgba(34,195,142,.08);border-color:rgba(34,195,142,.3);color:#22c38e; }
    .rec-btn-acces:hover { background:rgba(34,195,142,.18); }
    .rec-tabs { display:flex;gap:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;flex-wrap:wrap; }
    .rec-tab { flex:1;min-width:80px;padding:.5rem .6rem;font-size:.78rem;cursor:pointer;border:none;background:var(--bg-elevated);color:var(--text-dim);transition:all .15s;display:flex;align-items:center;justify-content:center;gap:.3rem; }
    .rec-tab.active { background:var(--gold);color:#0b1118;font-weight:700; }
    .rec-tab:not(.active):hover { background:var(--bg-card);color:var(--text); }
    .rec-empty { text-align:center;padding:3rem 1rem;color:var(--text-dim); }
    .rec-stat-row { display:flex;gap:.4rem;flex-wrap:wrap;margin:.3rem 0; }
    .rec-stat { background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;padding:3px 9px;font-size:.72rem;color:var(--text-dim); }
  </style>

  <!-- HEADER -->
  <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:1.25rem">
    <div>
      <div style="font-size:.7rem;color:var(--text-dim);letter-spacing:3px;text-transform:uppercase;margin-bottom:.2rem">Encyclopédie</div>
      <h1 style="font-family:'Cinzel',serif;font-size:1.8rem;color:var(--gold);letter-spacing:2px;margin:0">Recettes</h1>
    </div>
    ${_isAdmin() ? `
    <div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap">
      ${TABS.map(t => `<button class="btn btn-outline btn-sm" onclick="openRecipeModal('${t.id}')">${t.emoji} + ${t.label}</button>`).join('')}
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
          ${t.emoji} ${t.label}
          <span style="font-size:.65rem;opacity:.7">(${counts[t.id]})</span>
        </button>`).join('')}
    </div>
    <input type="text" class="input-field" placeholder="🔍 Rechercher..."
      value="${_filterTxt}" oninput="recSearch(this.value)"
      style="max-width:240px;font-size:.82rem">
  </div>

  <!-- LISTE -->
  ${filtered.length === 0 ? `
    <div class="rec-empty">
      <div style="font-size:2.5rem;margin-bottom:.75rem;opacity:.25">${tabInfo.emoji}</div>
      <p style="font-style:italic">
        ${_all.filter(r=>r.type===_tab).length === 0
          ? (_isAdmin() ? `Aucune recette de type "${tabInfo.label}" — créez-en une !` : `Aucune recette partagée avec vous dans cette catégorie.`)
          : 'Aucun résultat pour cette recherche.'}
      </p>
    </div>
  ` : `
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1rem">
    ${filtered.map(r => _renderCard(r, borderColor[r.type]||'#e8b84b')).join('')}
  </div>
  `}
  `;
}

// ── Card recette ──────────────────────────────────────────────────────────────
function _renderCard(r, accent) {
  const uid       = _myUid();
  const isAdmin   = _isAdmin();
  const joueurs   = _getJoueurs();
  const accesUids = r.acces || [];
  const nbAcces   = accesUids.length;

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

  // Stats spécifiques craft
  const statsHtml = (r.type === 'arme' || r.type === 'armure' || r.type === 'bijou') ? `
    <div class="rec-stat-row">
      ${r.typeObjet    ? `<span class="rec-stat">📦 ${r.typeObjet}</span>` : ''}
      ${r.rarete       ? `<span class="rec-stat">⭐ ${r.rarete}</span>` : ''}
      ${r.tempsCraft   ? `<span class="rec-stat">⏱️ ${r.tempsCraft}</span>` : ''}
      ${r.atelierReq   ? `<span class="rec-stat">🔧 ${r.atelierReq}</span>` : ''}
      ${r.degats       ? `<span class="rec-stat">⚔️ ${r.degats}</span>` : ''}
      ${r.caBonus      ? `<span class="rec-stat">🛡️ +${r.caBonus} CA</span>` : ''}
    </div>` : '';

  // Envoi : joueur perd son accès, le destinataire gagne
  const autresJoueurs = joueurs.filter(j => j.uid !== uid && !accesUids.includes(j.uid));
  const canSend = !isAdmin && accesUids.includes(uid) && autresJoueurs.length > 0;

  return `<div class="rec-card" style="border-left:3px solid ${accent}">
    <div class="rec-card-header">
      <div>
        <div class="rec-card-name">${r.nom||'?'}</div>
        <div style="display:flex;align-items:center;gap:.4rem;margin-top:.3rem;flex-wrap:wrap">
          ${r.duree ? `<span class="rec-tag">⏱️ ${r.duree}</span>` : ''}
          ${r.famille ? `<span class="rec-tag">${r.famille}</span>` : ''}
          ${isAdmin ? `<span class="rec-tag" style="color:${nbAcces>0?'#22c38e':'var(--text-dim)'}">
            ${nbAcces>0?`✓ ${nbAcces} joueur${nbAcces>1?'s':''}` : '⚠ Non partagé'}
          </span>` : ''}
        </div>
      </div>
      ${isAdmin ? `
      <div style="display:flex;gap:.25rem;flex-shrink:0">
        <button class="btn-icon" onclick="openRecipeModal('${r.type}','${r.id}')">✏️</button>
        <button class="btn-icon" style="color:#ff6b6b" onclick="deleteRecipe('${r.id}')">🗑️</button>
      </div>` : ''}
    </div>

    <div class="rec-card-body">
      ${statsHtml}
      ${ingrHtml}
      ${(statsHtml||ingrs.length||r.ingredients_texte) && (r.effet||r.description) ? '<div class="rec-divider"></div>' : ''}
      ${r.description ? `<div style="margin-bottom:.3rem;color:var(--text-dim);font-size:.78rem">${r.description}</div>` : ''}
      ${r.effet ? `<div class="rec-effet">✨ ${r.effet}</div>` : ''}
    </div>

    <div class="rec-footer">
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

  // Champs spécifiques au type de craft
  let craftFields = '';
  if (rType === 'arme') {
    craftFields = `
    <div class="form-group"><label>Type d'arme</label>
      <input class="input-field" id="rec-typeObjet" value="${r?.typeObjet||''}" placeholder="Épée, Dague, Arc, Bâton..."></div>
    <div class="form-group"><label>Dégâts</label>
      <input class="input-field" id="rec-degats" value="${r?.degats||''}" placeholder="1D8+FOR, 2D6..."></div>
    <div class="form-group"><label>Rareté</label>
      <input class="input-field" id="rec-rarete" value="${r?.rarete||''}" placeholder="Commun, Rare, Épique..."></div>
    <div class="form-group"><label>Atelier requis</label>
      <input class="input-field" id="rec-atelierReq" value="${r?.atelierReq||''}" placeholder="Forge, Atelier de confection..."></div>
    <div class="form-group"><label>Temps de craft</label>
      <input class="input-field" id="rec-tempsCraft" value="${r?.tempsCraft||''}" placeholder="1 journée, 3 heures..."></div>`;
  } else if (rType === 'armure') {
    craftFields = `
    <div class="form-group"><label>Type d'armure</label>
      <input class="input-field" id="rec-typeObjet" value="${r?.typeObjet||''}" placeholder="Légère, Intermédiaire, Lourde..."></div>
    <div class="form-group"><label>Bonus CA</label>
      <input type="number" class="input-field" id="rec-caBonus" value="${r?.caBonus||''}" placeholder="0"></div>
    <div class="form-group"><label>Emplacement</label>
      <input class="input-field" id="rec-atelierReq" value="${r?.atelierReq||''}" placeholder="Forge, Atelier de confection..."></div>
    <div class="form-group"><label>Temps de craft</label>
      <input class="input-field" id="rec-tempsCraft" value="${r?.tempsCraft||''}" placeholder="1 journée, 3 heures..."></div>`;
  } else if (rType === 'bijou') {
    craftFields = `
    <div class="form-group"><label>Type de bijou</label>
      <input class="input-field" id="rec-typeObjet" value="${r?.typeObjet||''}" placeholder="Amulette, Anneau, Objet magique..."></div>
    <div class="form-group"><label>Rareté</label>
      <input class="input-field" id="rec-rarete" value="${r?.rarete||''}" placeholder="Commun, Rare, Épique..."></div>
    <div class="form-group"><label>Atelier requis</label>
      <input class="input-field" id="rec-atelierReq" value="${r?.atelierReq||''}" placeholder="Atelier d'orfèvre..."></div>
    <div class="form-group"><label>Temps de craft</label>
      <input class="input-field" id="rec-tempsCraft" value="${r?.tempsCraft||''}" placeholder="1 journée, 3 heures..."></div>`;
  }

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
  const nom = document.getElementById('rec-nom')?.value?.trim();
  if (!nom) { showNotif('Le nom est requis.', 'error'); return; }

  const existing = id ? _all.find(r => r.id === id) : null;
  const type     = existing?.type || fallbackType || 'cuisine';
  const isCraft  = ['arme','armure','bijou'].includes(type);

  const data = {
    type, nom,
    famille:     document.getElementById('rec-famille')?.value?.trim()   || '',
    duree:       document.getElementById('rec-duree')?.value?.trim()     || '',
    effet:       document.getElementById('rec-effet')?.value?.trim()     || '',
    description: document.getElementById('rec-desc')?.value?.trim()     || '',
    ingredients: _readIngrs(),
    acces:       existing?.acces || [],
    // Champs craft
    typeObjet:   document.getElementById('rec-typeObjet')?.value?.trim() || '',
    degats:      document.getElementById('rec-degats')?.value?.trim()    || '',
    caBonus:     parseInt(document.getElementById('rec-caBonus')?.value) || 0,
    rarete:      document.getElementById('rec-rarete')?.value?.trim()    || '',
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
}

async function deleteRecipe(id) {
  const r = _all.find(x => x.id === id);
  if (!confirm(`Supprimer "${r?.nom||'cette recette'}" ?`)) return;
  await deleteFromCol('recipes', id);
  _all = _all.filter(x => x.id !== id);
  showNotif('Recette supprimée.', 'success');
  _render();
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL ACCÈS — Admin donne accès aux joueurs
// ══════════════════════════════════════════════════════════════════════════════
function openAccesModal(id) {
  const r = _all.find(x => x.id === id);
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
  const checks   = [...document.querySelectorAll('#acces-list input[type="checkbox"]')];
  const newAcces = checks.filter(c => c.checked).map(c => c.value);
  await updateInCol('recipes', id, { acces: newAcces });
  const idx = _all.findIndex(r => r.id === id);
  if (idx >= 0) _all[idx].acces = newAcces;
  closeModal();
  showNotif(`Accès mis à jour — ${newAcces.length} joueur${newAcces.length>1?'s':''}.`, 'success');
  _render();
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL ENVOI — Joueur transmet une recette (perd son accès)
// ══════════════════════════════════════════════════════════════════════════════
function openSendRecipeModal(id) {
  const r = _all.find(x => x.id === id);
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
  const targetUid = document.querySelector('input[name="send-rec-target"]:checked')?.value;
  if (!targetUid) { showNotif('Sélectionne un joueur.', 'error'); return; }

  const r = _all.find(x => x.id === id);
  if (!r) return;

  const uid = _myUid();

  // Retirer l'envoyeur, ajouter le destinataire
  const newAcces = [...new Set([
    ...(r.acces || []).filter(u => u !== uid),
    targetUid,
  ])];

  await updateInCol('recipes', id, { acces: newAcces });
  r.acces = newAcces;

  const targetName = _getJoueurs().find(j => j.uid === targetUid)?.pseudo || 'ce joueur';
  closeModal();
  showNotif(`"${r.nom}" transmise à ${targetName}. Tu n'y as plus accès.`, 'success');
  _render();
}

// ══════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════════
window.recSetTab = (t) => { _tab = t; _filterTxt = ''; _render(); };
window.recSearch = (v) => { _filterTxt = v; _render(); };

// ══════════════════════════════════════════════════════════════════════════════
// OVERRIDE + EXPORTS
// ══════════════════════════════════════════════════════════════════════════════
PAGES.recettes = renderRecipes;

Object.assign(window, {
  renderRecipes,
  openRecipeModal,
  saveRecipe,
  deleteRecipe,
  openAccesModal,
  saveAcces,
  openSendRecipeModal,
  sendRecipe,
});
