// ══════════════════════════════════════════════════════════════════════════════
// BESTIARY.JS — Le Bestiaire
// ✓ Admin : CRUD créatures, image+crop, attaques/traits/butins dynamiques
// ✓ Joueur : galerie + suivi personnel (PV/PM live, notes)
// ══════════════════════════════════════════════════════════════════════════════
import { loadCollection, loadChars, addToCol, updateInCol, deleteFromCol, getDocData, saveDoc } from '../data/firestore.js';
import { watch, watchDoc } from '../shared/realtime.js';
import { openModal, closeModal, pushModal, popModal } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import PAGES from './pages.js';
import { _esc, _norm, _searchIncludes } from '../shared/html.js';
import { loadDamageTypes } from '../shared/damage-types.js';
import { attachDropAndCrop } from '../shared/image-crop.js';
import { openShopPicker, getRareteColor } from '../shared/shop-picker.js';

// ══════════════════════════════════════════════════════════════════════════════
// DÉLÉGATION D'ÉVÉNEMENTS — remplace les onclick/oninput/onchange inline
// Pattern : <button data-bst-action="open" data-id="…">…</button>
// + bstHandlers.open = (el) => _bstOpen(el.dataset.id)
// Un seul listener par type d'événement, idempotent, scope module.
// ══════════════════════════════════════════════════════════════════════════════
const bstHandlers = {};
function _bstBindDispatch() {
  if (_bstBindDispatch._bound) return;
  _bstBindDispatch._bound = true;
  const dispatch = (e) => {
    const el = e.target.closest('[data-bst-action]');
    if (!el) return;
    const fn = bstHandlers[el.dataset.bstAction];
    if (typeof fn !== 'function') return;
    // Filtre par type d'événement si data-bst-on est précisé (ex: "input")
    if (el.dataset.bstOn && el.dataset.bstOn !== e.type) return;
    fn(el, e);
  };
  document.addEventListener('click',  dispatch, true);
  document.addEventListener('input',  dispatch, true);
  document.addEventListener('change', dispatch, true);
}
_bstBindDispatch();

// ── État local ────────────────────────────────────────────────────────────────
let _bstCropper = null;
let _creatures  = [];
let _tracker    = {}; // { [creatureId]: { pvActuel, pmActuel, notes, deductions:{pv,pm,ca,for,...} } }
let _damageTypes = null;
let _searchVal  = '';
let _filterType = ''; // filtre par type de créature
let _filterRang  = ''; // filtre par rang (classique, elite, boss)
let _activeId   = null; // créature ouverte dans le panneau
let _bestiaireId = 'main'; // id du bestiaire actif (admin peut switcher)
let _viewAsUid   = null; // admin : voir le bestiaire d'un joueur (null = vue MJ)
let _playersList = []; // [{ uid, pseudo }] — peuplé côté admin

// Vue "MJ" effective : admin ET pas en train de consulter un joueur.
// Quand l'admin bascule sur un joueur, on rend exactement comme côté joueur
// pour pouvoir voir/modifier ses estimations.
function _isViewingPlayer() {
  return STATE.isAdmin && _viewAsUid && _viewAsUid !== STATE.user?.uid;
}
function _isAdminView() {
  return STATE.isAdmin && !_isViewingPlayer();
}

const RANG_STYLE = {
  classique: { label:'Classique', color:'#94a3b8', glow:'rgba(148,163,184,0.18)', border:'rgba(148,163,184,0.40)', bg:'rgba(148,163,184,0.10)' },
  elite:     { label:'Élite',     color:'#e8b84b', glow:'rgba(232,184,75,0.22)',  border:'rgba(232,184,75,0.40)',  bg:'rgba(232,184,75,0.12)'  },
  boss:      { label:'Boss',      color:'#ff5a7e', glow:'rgba(255,90,126,0.24)',  border:'rgba(255,90,126,0.40)',  bg:'rgba(255,90,126,0.12)'  },
};

// ──────────────────────────────────────────────────────────────────────────────
// ARMES NATURELLES + ACTIONS — métadonnées partagées avec la modal de sorts.
// Les actions de créature utilisent EXACTEMENT le même schéma que les sorts de
// personnage et les actions d'objet (boutique). On délègue à `editItemSpell`.
// ──────────────────────────────────────────────────────────────────────────────

const _BST_STAT_OPTIONS = [
  { key:'none',         short:'—',   label:'Aucun' },
  { key:'force',        short:'For', label:'Force' },
  { key:'dexterite',    short:'Dex', label:'Dextérité' },
  { key:'intelligence', short:'Int', label:'Intelligence' },
  { key:'sagesse',      short:'Sag', label:'Sagesse' },
  { key:'constitution', short:'Con', label:'Constitution' },
  { key:'charisme',     short:'Cha', label:'Charisme' },
];

function _bstUuid() { return 'a_' + Math.random().toString(36).slice(2, 9); }

// ── Cache des objets boutique (pour le picker de butins) ─────────────────────
let _bstShopItemsCache = null;
let _bstShopItemsLoading = null;
async function _bstEnsureShopItems() {
  if (_bstShopItemsCache) return _bstShopItemsCache;
  if (_bstShopItemsLoading) return _bstShopItemsLoading;
  _bstShopItemsLoading = loadCollection('shop')
    .then(items => {
      _bstShopItemsCache = (items || [])
        .sort((a,b) => (a.nom||'').localeCompare(b.nom||'', 'fr', {sensitivity:'base'}));
      return _bstShopItemsCache;
    })
    .catch(() => { _bstShopItemsCache = []; return _bstShopItemsCache; })
    .finally(() => { _bstShopItemsLoading = null; });
  return _bstShopItemsLoading;
}

/** Re-render des selects de butins (après chargement async des items). */
function _bstRefreshButinSelects(cid) {
  const host = document.getElementById(`bst-p-butins-${cid}`);
  if (!host) return;
  const c = _creatures.find(x => x.id === cid);
  const butins = Array.isArray(c?.butins) ? c.butins : [];
  host.innerHTML = butins.map((b,i) => _panelButinRow(b, cid, i)).join('');
}

/** Convertit une créature en "char-like" object utilisable par la modal de sort.
 *  L'arme naturelle choisie est placée sur l'emplacement "Main principale". */
function _bstCreatureToChar(c, armeId) {
  const armes = Array.isArray(c?.armesNaturelles) ? c.armesNaturelles : [];
  const arme  = armes.find(a => a.id === armeId) || armes[0] || null;
  const stats = {
    force:        parseInt(c?.force)        || 10,
    dexterite:    parseInt(c?.dexterite)    || 10,
    intelligence: parseInt(c?.intelligence) || 10,
    sagesse:      parseInt(c?.sagesse)      || 10,
    constitution: parseInt(c?.constitution) || 10,
    charisme:     parseInt(c?.charisme)     || 10,
  };
  const equipement = {};
  if (arme) {
    // Bonus fixes : on les place dans la formule de dégâts s'ils existent et
    // qu'aucun bonus n'est déjà collé à la fin de la formule. Ça permet à
    // _calcSortDegats de les "ramasser" comme un bonus de maîtrise.
    let degats = arme.degats || '';
    const flatD = parseInt(arme.degatsFlat) || 0;
    if (flatD && !/[+\-]\s*\d+\s*$/.test(degats)) {
      degats = `${degats}${flatD > 0 ? ' +' : ' '}${flatD}`.trim();
    }
    equipement['Main principale'] = {
      nom:         arme.nom || 'Arme naturelle',
      degats,
      degatsStat:  arme.degatsStat  || 'force',
      degatsStats: [arme.degatsStat || 'force'],
      toucherStat: arme.toucherStat || arme.degatsStat || 'force',
      statAttaque: arme.toucherStat || arme.degatsStat || 'force',
      toucherFlat: parseInt(arme.toucherFlat) || 0,
      portee:      arme.portee || '',
      typeArme:    'CaC',
      format:      'Arme naturelle',
      sousType:    arme.nom || '',
      traits:      [],
    };
  }
  return {
    id:        c?.id || '',
    nom:       c?.nom || 'Créature',
    photoURL:  c?.imageUrl || '',
    stats,
    statsBonus: {},
    equipement,
    deck_sorts: Array.isArray(c?.actions) ? c.actions : [],
  };
}

// Cache local des actions de la créature en cours d'édition (admin)
let _bstActionsCache = [];
let _bstActionsCreatureId = null;
let _bstActionsArmeIdCtx  = null; // arme naturelle utilisée pour le calcul

function _bstActionsCacheLoad(creatureId, actions) {
  _bstActionsCreatureId = creatureId || null;
  _bstActionsCache = Array.isArray(actions) ? actions.map(a => ({ ...a })) : [];
}

async function _bstEnsureSpellsModule() {
  const mod = await import('./characters/spells.js');
  const keys = [
    'addSort','editSort','openSortModal','saveSort',
    'addItemSpell','editItemSpell',
    'runeIncrement','runeDecrement','selectNoyau',
    'updateSortPM','toggleSortDetail',
    'openSortCatEditor',
    'sortDragStart','sortDragOver','sortDrop','sortDragEnd',
  ];
  keys.forEach(k => {
    if (typeof mod[k] === 'function' && typeof window[k] !== 'function') window[k] = mod[k];
  });
  return mod;
}

function _bstActionsPersist() {
  if (!_bstActionsCreatureId) return;
  _bstQueueSave(_bstActionsCreatureId, { actions: _bstActionsCache, attaques: [] });
  const c = _creatures.find(x => x.id === _bstActionsCreatureId);
  if (c) { c.actions = _bstActionsCache.map(a => ({...a})); c.attaques = []; }
  const count = document.querySelector(`[data-bst-count="${_bstActionsCreatureId}-actions"]`);
  if (count) count.textContent = _bstActionsCache.length;
}

function _bstRefreshActionsHost() {
  if (!_bstActionsCreatureId) return;
  const host = document.getElementById(`bst-p-actions-${_bstActionsCreatureId}`);
  if (host) host.innerHTML = _bstRenderActionsList();
}

function _bstRenderActionCard(act, idx) {
  const a = act || {};
  const runes = a.runes || [];
  const types = a.types || [];
  const typeBadges = types.map(t => {
    const col = t==='offensif' ? '#ff6b6b' : t==='defensif' ? '#22c38e' : '#b47fff';
    return `<span style="font-size:.6rem;font-weight:700;padding:.1rem .4rem;border-radius:999px;color:${col};background:${col}1a;border:1px solid ${col}55">${t}</span>`;
  }).join(' ');
  const runeCounts = {};
  runes.forEach(r => { runeCounts[r] = (runeCounts[r] || 0) + 1; });
  const runeBadges = Object.entries(runeCounts).map(([r,n]) =>
    `<span style="font-size:.62rem;font-weight:600;padding:.1rem .4rem;border-radius:5px;background:rgba(168,127,255,.12);color:#c4b5fd;border:1px solid rgba(168,127,255,.3)">${r}${n>1?`×${n}`:''}</span>`).join(' ');
  return `
    <div class="bst-action-card">
      <span style="font-size:1.3rem;flex-shrink:0">${_esc(a.icon||'🔮')}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:.85rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(a.nom || 'Sans nom')}</div>
        <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.2rem">
          ${typeBadges}${runeBadges}
          ${a.noyau ? `<span style="font-size:.62rem;color:var(--text-dim)">⚛ ${_esc(a.noyau)}</span>` : ''}
          <span style="font-size:.62rem;color:#b47fff">${a.pmOverride ?? a.pm ?? '?'} PM</span>
        </div>
      </div>
      <button type="button" class="btn btn-outline btn-sm" data-bst-action="editAction" data-idx="${idx}" title="Modifier">✏️</button>
      <button type="button" class="btn-icon" data-bst-action="removeAction" data-idx="${idx}" title="Supprimer" style="color:#ef4444">🗑</button>
    </div>`;
}

function _bstRenderActionsList() {
  if (!_bstActionsCache.length) {
    return `<div class="bst-actions-empty">Aucune action — clique sur ＋ Ajouter pour ouvrir l'éditeur de sort.</div>`;
  }
  return _bstActionsCache.map((a,i) => _bstRenderActionCard(a,i)).join('');
}

window._bstAddAction = async () => {
  const mod = await _bstEnsureSpellsModule();
  if (typeof mod.addItemSpell !== 'function') { showNotif('Module sorts indisponible', 'error'); return; }
  const c = _creatures.find(x => x.id === _bstActionsCreatureId);
  if (!c) return;
  const charForCalc = _bstCreatureToChar(c, _bstActionsArmeIdCtx);
  const fakeItem = { actions: _bstActionsCache, nom: c.nom || 'Créature' };
  mod.addItemSpell(fakeItem, async (updatedItem) => {
    _bstActionsCache = Array.isArray(updatedItem?.actions) ? updatedItem.actions.map(a => ({...a})) : [];
    _bstActionsPersist();
    _bstRefreshActionsHost();
  }, charForCalc);
};

window._bstEditAction = async (idx) => {
  const mod = await _bstEnsureSpellsModule();
  if (typeof mod.editItemSpell !== 'function') { showNotif('Module sorts indisponible', 'error'); return; }
  const c = _creatures.find(x => x.id === _bstActionsCreatureId);
  if (!c) return;
  const charForCalc = _bstCreatureToChar(c, _bstActionsArmeIdCtx);
  const fakeItem = { actions: _bstActionsCache, nom: c.nom || 'Créature' };
  mod.editItemSpell(fakeItem, idx, async (updatedItem) => {
    _bstActionsCache = Array.isArray(updatedItem?.actions) ? updatedItem.actions.map(a => ({...a})) : [];
    _bstActionsPersist();
    _bstRefreshActionsHost();
  }, charForCalc);
};

window._bstRemoveAction = (idx) => {
  if (!Number.isFinite(idx) || !_bstActionsCache[idx]) return;
  if (!confirm('Supprimer cette action ?')) return;
  _bstActionsCache.splice(idx, 1);
  _bstActionsPersist();
  _bstRefreshActionsHost();
};

// ── Armes naturelles : édition inline ─────────────────────────────────────────
function _bstRenderArmeRow(a = {}, cid, idx) {
  const optsHTML = (sel) => _BST_STAT_OPTIONS.map(s =>
    `<option value="${s.key}"${sel===s.key?' selected':''}>${s.short}</option>`).join('');
  // Note : tous les inputs/selects sauvent via la délégation `saveArmes`. L'attribut
  // `data-bst-on` filtre l'event (sinon le click de focus déclencherait aussi).
  const inputAttrs  = `data-bst-action="saveArmes" data-bst-on="input"  data-id="${cid}"`;
  const selectAttrs = `data-bst-action="saveArmes" data-bst-on="change" data-id="${cid}"`;
  return `<div class="bst-p-row" data-arme-id="${a.id || ''}">
    <div class="bst-p-row-grid" style="grid-template-columns:1fr 130px auto">
      <input class="bst-p-input" data-f="nom" placeholder="Nom (Griffes, Morsure…)"
        value="${_esc(a.nom||'')}" ${inputAttrs}>
      <input class="bst-p-input" data-f="degats" placeholder="⚔️ 1d8+2"
        value="${_esc(a.degats||'')}" ${inputAttrs}>
      <button class="bst-p-row-remove" data-bst-action="removeArme" data-id="${cid}" title="Retirer">✕</button>
    </div>
    <div class="bst-p-row-grid" style="grid-template-columns:1fr 90px 1fr 90px 1fr">
      <label class="bst-p-mini">Stat dégâts
        <select class="bst-p-input" data-f="degatsStat" ${selectAttrs}>
          ${optsHTML(a.degatsStat || 'force')}
        </select>
      </label>
      <label class="bst-p-mini" title="Bonus fixe ajouté aux dégâts (en plus / à la place de la stat)">+ Bonus
        <input class="bst-p-input" data-f="degatsFlat" type="number"
          value="${a.degatsFlat ?? ''}" placeholder="0" ${inputAttrs}>
      </label>
      <label class="bst-p-mini">Stat toucher
        <select class="bst-p-input" data-f="toucherStat" ${selectAttrs}>
          ${optsHTML(a.toucherStat || a.degatsStat || 'force')}
        </select>
      </label>
      <label class="bst-p-mini" title="Bonus fixe ajouté au toucher (en plus / à la place de la stat)">+ Bonus
        <input class="bst-p-input" data-f="toucherFlat" type="number"
          value="${a.toucherFlat ?? ''}" placeholder="0" ${inputAttrs}>
      </label>
      <label class="bst-p-mini">Portée
        <input class="bst-p-input" data-f="portee" placeholder="Contact, 9m"
          value="${_esc(a.portee||'')}" ${inputAttrs}>
      </label>
    </div>
  </div>`;
}

window._bstAddArme = (cid) => {
  const host = document.getElementById(`bst-p-armes-${cid}`);
  if (!host) return;
  const c = _creatures.find(x => x.id === cid);
  const armes = Array.isArray(c?.armesNaturelles) ? [...c.armesNaturelles] : [];
  armes.push({ id: _bstUuid(), nom:'', degats:'', degatsStat:'force', toucherStat:'force', portee:'' });
  if (c) c.armesNaturelles = armes;
  host.innerHTML = armes.map((a,i) => _bstRenderArmeRow(a, cid, i)).join('');
  _bstQueueSave(cid, { armesNaturelles: armes });
};

window._bstRemoveArme = (cid, btn) => {
  const row = btn?.closest?.('.bst-p-row'); if (!row) return;
  row.remove();
  window._bstSaveArmes(cid);
};

window._bstSaveArmes = (cid) => {
  const host = document.getElementById(`bst-p-armes-${cid}`);
  if (!host) return;
  const rows = [...host.querySelectorAll('.bst-p-row')];
  const armes = rows.map(r => {
    const flatD = parseInt(r.querySelector('[data-f=degatsFlat]')?.value);
    const flatT = parseInt(r.querySelector('[data-f=toucherFlat]')?.value);
    return {
      id:          r.dataset.armeId || _bstUuid(),
      nom:         r.querySelector('[data-f=nom]')?.value?.trim() || '',
      degats:      r.querySelector('[data-f=degats]')?.value?.trim() || '',
      degatsStat:  r.querySelector('[data-f=degatsStat]')?.value || 'force',
      degatsFlat:  Number.isFinite(flatD) ? flatD : 0,
      toucherStat: r.querySelector('[data-f=toucherStat]')?.value || 'force',
      toucherFlat: Number.isFinite(flatT) ? flatT : 0,
      portee:      r.querySelector('[data-f=portee]')?.value?.trim() || '',
    };
  }).filter(a => a.nom || a.degats);
  const c = _creatures.find(x => x.id === cid);
  if (c) c.armesNaturelles = armes;
  _bstQueueSave(cid, { armesNaturelles: armes });
  // Si l'arme contextuelle a disparu, on prend la première dispo
  if (cid === _bstActionsCreatureId && !armes.find(a => a.id === _bstActionsArmeIdCtx)) {
    _bstActionsArmeIdCtx = armes[0]?.id || null;
  }
};

function _beastSearchText(c = {}) {
  const armes = Array.isArray(c.armesNaturelles)
    ? c.armesNaturelles.map(a => [a.nom, a.degats, a.portee].filter(Boolean).join(' ')).join(' ')
    : '';
  const actions = Array.isArray(c.actions)
    ? c.actions.map(a => [a.nom, a.noyau].filter(Boolean).join(' ')).join(' ')
    : '';
  const traits = Array.isArray(c.traits)
    ? c.traits.map(t => [t.nom, t.description].filter(Boolean).join(' ')).join(' ')
    : '';
  const butins = Array.isArray(c.butins)
    ? c.butins.map(b => [b.nom, b.quantite, b.chance].filter(Boolean).join(' ')).join(' ')
    : '';

  return _norm([
    c.nom,
    c.type,
    c.environnement,
    c.description,
    c.emoji,
    c.rang,
    c.niveau,
    c.dangerositeXp,
    armes,
    actions,
    traits,
    butins,
  ].filter(v => v !== undefined && v !== null && v !== '').join(' '));
}

function _beastMatchesFilters(c, { search = _searchVal, type = _filterType, rang = _filterRang } = {}) {
  const q = _norm(search);
  const fType = _norm(type);
  const fRang = _norm(rang);
  const matchSearch = !q || _searchIncludes(_beastSearchText(c), search);
  const matchType = !fType || _norm(c.type) === fType;
  const matchRang = !fRang || _norm(c.rang || 'classique') === fRang;
  return matchSearch && matchType && matchRang;
}

// Métadonnées visuelles communes aux 4 catégories de relation aux dégâts.
// Palette neutre alignée avec DMG_INTERACTIONS du VTT : aucune teinte ne
// suggère "bon / mauvais" pour le joueur attaquant.
const DMG_RELATIONS = [
  { key: 'absorptions', label: 'Absorptions', short: 'Soin',       icon: '💚', color: '#b47fff' },
  { key: 'immunites',   label: 'Immunités',   short: 'Aucun dégât', icon: '🚫', color: '#94a3b8' },
  { key: 'resistances', label: 'Résistances', short: '½ dégâts',  icon: '🛡️', color: '#4f8cff' },
  { key: 'faiblesses',  label: 'Faiblesses',  short: '×2 dégâts',  icon: '💢', color: '#f59e0b' },
];

function _damageTypeBadge(typeId, types, color) {
  const type = (types || []).find(t => t.id === typeId);
  const label = type ? `${type.icon||''} ${_esc(type.label)}` : _esc(typeId);
  return `<span style="font-size:.72rem;padding:.18rem .5rem;border-radius:999px;border:1px solid ${color};color:${color};background:${color}1a">${label}</span>`;
}

function _renderRelationCard(rel, ids, types) {
  if (!Array.isArray(ids) || ids.length === 0) return '';
  return `<div style="display:flex;flex-direction:column;gap:.35rem;padding:.5rem .6rem;
    border:1px solid ${rel.color}33;background:${rel.color}10;border-radius:10px;border-left:3px solid ${rel.color}">
    <div style="display:flex;align-items:center;gap:.4rem">
      <span style="font-size:.9rem">${rel.icon}</span>
      <span style="font-size:.74rem;font-weight:700;color:${rel.color};letter-spacing:.02em">${rel.label}</span>
      <span style="font-size:.62rem;color:var(--text-dim);margin-left:auto">${rel.short}</span>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:.3rem">
      ${ids.map(id => _damageTypeBadge(id, types, rel.color)).join('')}
    </div>
  </div>`;
}

function _renderDamageProfile(beast, types) {
  if (!beast) return '';
  const cards = DMG_RELATIONS.map(rel => {
    const ids = Array.isArray(beast[rel.key]) ? beast[rel.key] : [];
    if (!ids.length) return null;
    const tags = ids.map(id => {
      const type = (types||[]).find(t => t.id === id);
      const label = type ? `${type.icon||''} ${_esc(type.label)}` : _esc(id);
      return `<span class="bst-dmg-tag" style="border-color:${rel.color}55;color:${rel.color}">${label}</span>`;
    }).join('');
    return `<div class="bst-dmg-card" style="border-color:${rel.color}33;border-left-color:${rel.color}">
      <div class="bst-dmg-head">
        <span class="bst-dmg-icon">${rel.icon}</span>
        <span class="bst-dmg-name" style="color:${rel.color}">${rel.label}</span>
        <span class="bst-dmg-rule">${rel.short}</span>
      </div>
      <div class="bst-dmg-tags">${tags}</div>
    </div>`;
  }).filter(Boolean);
  if (!cards.length) return '';
  return `<div class="bst-section">
    <div class="bst-section-title">🛡️ Relations aux dégâts</div>
    <div class="bst-dmg-grid">${cards.join('')}</div>
  </div>`;
}

/** Mini-récap pictogrammes pour la card admin (compact). */
function _renderDamageProfileMini(beast) {
  if (!beast) return '';
  const parts = DMG_RELATIONS
    .map(rel => {
      const n = (beast[rel.key] || []).length;
      if (!n) return null;
      return `<span title="${rel.label} (${n})" style="display:inline-flex;align-items:center;gap:1px;font-size:.6rem;color:${rel.color};background:${rel.color}1a;border:1px solid ${rel.color}55;padding:0 4px;border-radius:6px">${rel.icon}<strong style="font-size:.55rem">${n}</strong></span>`;
    })
    .filter(Boolean);
  if (!parts.length) return '';
  return `<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:.3rem">${parts.join('')}</div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// ÉDITION INLINE — Panneau admin (auto-save Firestore)
// ══════════════════════════════════════════════════════════════════════════════
const _bstPending = {};
let _bstSaveTimer = null;

function _bstFlushSaves() {
  const col = window._bstCurrentCol || 'bestiary';
  const ids = Object.keys(_bstPending);
  if (!ids.length) return;
  ids.forEach(id => {
    const patch = _bstPending[id];
    delete _bstPending[id];
    updateInCol(col, id, patch)
      .then(() => {
        const idx = _creatures.findIndex(c => c.id === id);
        if (idx >= 0) Object.assign(_creatures[idx], patch);
      })
      .catch(notifySaveError);
  });
}

function _bstQueueSave(id, patch) {
  _bstPending[id] = { ...(_bstPending[id] || {}), ...patch };
  clearTimeout(_bstSaveTimer);
  _bstSaveTimer = setTimeout(_bstFlushSaves, 400);
}

// Auto-save générique (texte / select)
window._bstUpdate = (id, field, val) => _bstQueueSave(id, { [field]: val });
window._bstUpdateNum = (id, field, val) => _bstQueueSave(id, { [field]: parseInt(val) || 0 });
window._bstToggleHidden = (id) => {
  const c = _creatures.find(x => x.id === id);
  if (!c) return;
  const next = !c.hidden;
  c.hidden = next;
  _bstQueueSave(id, { hidden: next });
  // Re-render panel + cartes pour refléter le badge
  if (typeof _syncActivePanel === 'function') _syncActivePanel();
  if (typeof _render === 'function') _render();
};

// Nom : sync visuel des cartes et du hero
window._bstUpdateNom = (id, val) => {
  _bstQueueSave(id, { nom: val });
  document.querySelectorAll(`.bst-card[data-beast-id="${id}"] .bst-card-name`)
    .forEach(el => el.textContent = val || '?');
};

// Caracs : sauve + recalcule le modificateur affiché
window._bstUpdateCarac = (id, key, val) => {
  _bstQueueSave(id, { [key]: parseInt(val) || 0 });
  const n = parseInt(val);
  let txt = '', cls = 'zero';
  if (!isNaN(n)) {
    const m = Math.floor((n - 10) / 2);
    txt = m >= 0 ? `+${m}` : `${m}`;
    cls = m > 0 ? 'pos' : m < 0 ? 'neg' : 'zero';
  }
  const modEl = document.querySelector(`[data-bst-mod="${id}-${key}"]`);
  if (modEl) { modEl.textContent = txt; modEl.className = `bst-carac-mod ${cls}`; }
};

// Changement de rang : sauve + met à jour cartes + panneau (couleurs + label)
window._bstSelectRangPanel = (id, rang) => {
  _bstQueueSave(id, { rang });
  const rs = RANG_STYLE[rang] || RANG_STYLE.classique;
  document.querySelectorAll(`.bst-card[data-beast-id="${id}"]`).forEach(card => {
    card.style.setProperty('--rang-c', rs.color);
    card.style.setProperty('--rang-glow', rs.glow);
    const rangEl = card.querySelector('.bst-card-rang');
    if (rangEl) rangEl.textContent = rs.label;
  });
  const panel = document.querySelector('.bst-panel');
  if (panel) {
    panel.style.setProperty('--rang-c', rs.color);
    panel.style.setProperty('--rang-glow', rs.glow);
  }
  document.querySelectorAll('[data-bst-rang-btn]').forEach(btn => {
    const r = btn.dataset.bstRangBtn;
    const rst = RANG_STYLE[r] || RANG_STYLE.classique;
    const active = r === rang;
    btn.classList.toggle('active', active);
    btn.style.color       = active ? rst.color : '';
    btn.style.borderColor = active ? rst.color : '';
    btn.style.background  = active ? `${rst.color}1a` : '';
  });
};

// Toggle relation aux dégâts
window._bstToggleDmg = (id, rel, typeId) => {
  const c = _creatures.find(x => x.id === id);
  if (!c) return;
  const set = new Set(Array.isArray(c[rel]) ? c[rel] : []);
  if (set.has(typeId)) set.delete(typeId); else set.add(typeId);
  c[rel] = [...set];
  _bstQueueSave(id, { [rel]: c[rel] });
  const chip = document.querySelector(`[data-dmg-chip="${id}-${rel}-${typeId}"]`);
  if (chip) {
    const active = set.has(typeId);
    const meta = DMG_RELATIONS.find(r => r.key === rel);
    chip.classList.toggle('active', active);
    chip.style.color       = active ? meta.color : '';
    chip.style.borderColor = active ? meta.color : '';
    chip.style.background  = active ? `${meta.color}1a` : '';
  }
};

// Lecture + save d'un tableau dynamique (traits / butins) depuis le panneau.
// Les attaques sont gérées via `actions` + `armesNaturelles` ailleurs.
window._bstSaveArr = (id, type) => {
  const container = document.getElementById(`bst-p-${type}-${id}`);
  if (!container) return;
  const rows = [...container.querySelectorAll('.bst-p-row')];
  let arr;
  if (type === 'traits') {
    arr = rows.map(row => ({
      nom:         row.querySelector('[data-f=nom]')?.value?.trim()  || '',
      description: row.querySelector('[data-f=desc]')?.value?.trim() || '',
    })).filter(t => t.nom || t.description);
  } else {
    // butins : objets boutique. Préserve la dénorm (nom/image) existante du
    // butin pour ne pas la perdre quand l'utilisateur modifie juste qte/chance
    // avant que le cache boutique soit chargé.
    const items   = _bstShopItemsCache || [];
    const creature = _creatures.find(x => x.id === id);
    const prev    = Array.isArray(creature?.butins) ? creature.butins : [];
    const prevById = Object.fromEntries(prev.filter(b => b.itemId).map(b => [b.itemId, b]));
    arr = rows.map(row => {
      const itemId = row.querySelector('[data-f=itemId]')?.value || '';
      const ref    = itemId ? items.find(x => x.id === itemId) : null;
      const prevB  = itemId ? prevById[itemId] : null;
      return {
        itemId,
        nom:      ref?.nom   || prevB?.nom   || '',
        image:    ref?.image || prevB?.image || '',
        quantite: row.querySelector('[data-f=qte]')?.value?.trim()    || '',
        chance:   row.querySelector('[data-f=chance]')?.value?.trim() || '',
      };
    }).filter(b => b.itemId);
  }
  _bstQueueSave(id, { [type]: arr });
  // Met à jour le compteur en titre
  const countEl = document.querySelector(`[data-bst-count="${id}-${type}"]`);
  if (countEl) countEl.textContent = arr.length;
};

window._bstAddPanelRow = (id, type) => {
  const container = document.getElementById(`bst-p-${type}-${id}`);
  if (!container) return;
  // Seules les sections "traits" passent ici. Les butins ont leur propre picker,
  // les armes naturelles et actions ont leurs handlers dédiés.
  if (type !== 'traits') return;
  const i = container.querySelectorAll('.bst-p-row').length;
  const tpl = document.createElement('div');
  tpl.innerHTML = _panelTraitRow({}, id, i).trim();
  container.appendChild(tpl.firstElementChild);
};

window._bstRemovePanelRow = (id, type, btn) => {
  const row = btn?.closest?.('.bst-p-row');
  if (!row) return;
  row.remove();
  window._bstSaveArr(id, type);
};

// Row renderers (panneau)
function _panelTraitRow(t = {}, id, i) {
  const inputAttrs = `data-bst-action="saveArr" data-bst-on="input" data-id="${id}" data-type="traits"`;
  return `<div class="bst-p-row">
    <div class="bst-p-row-grid" style="grid-template-columns:1fr auto">
      <input class="bst-p-input" data-f="nom" placeholder="Nom du trait" value="${_esc(t.nom||'')}" ${inputAttrs}>
      <button class="bst-p-row-remove" data-bst-action="removeRow" data-id="${id}" data-type="traits" title="Retirer">✕</button>
    </div>
    <input class="bst-p-input" data-f="desc" placeholder="Description…" value="${_esc(t.description||'')}" ${inputAttrs}>
  </div>`;
}

function _panelButinRow(b = {}, id, i) {
  // Carte compacte : pas de sélecteur — l'objet est piqué via la modal picker.
  // Si l'item n'existe plus en boutique, on tombe sur les valeurs dénormalisées.
  const items = _bstShopItemsCache || [];
  const ref   = b.itemId ? items.find(x => x.id === b.itemId) : null;
  const nom   = ref?.nom   || b.nom   || '? Objet supprimé';
  const image = ref?.image || b.image || '';
  const rar   = ref?.rarete || '';
  const rarColor = _bstRarColor(rar);
  const orphan = b.itemId && !ref ? true : false;
  return `<div class="bst-p-row bst-butin-card${orphan?' is-orphan':''}" data-butin-id="${b.itemId || ''}" title="${_esc(nom)}${orphan?' (supprimé de la boutique)':''}">
    <span class="bst-butin-dot" style="background:${rarColor}"></span>
    ${image
      ? `<img class="bst-butin-img" src="${_esc(image)}" alt="">`
      : `<span class="bst-butin-img bst-butin-img--empty">📦</span>`}
    <span class="bst-butin-name">${_esc(nom)}${orphan?` <span class="bst-butin-orphan-tag">⚠</span>`:''}</span>
    <input class="bst-p-input bst-butin-mini" data-f="qte" type="text" placeholder="1" title="Quantité"
      value="${_esc(b.quantite||'')}"
      data-bst-action="saveArr" data-bst-on="input" data-id="${id}" data-type="butins">
    <input class="bst-p-input bst-butin-mini" data-f="chance" type="text" placeholder="100%" title="Chance"
      value="${_esc(b.chance||'')}"
      data-bst-action="saveArr" data-bst-on="input" data-id="${id}" data-type="butins">
    <input type="hidden" data-f="itemId" value="${_esc(b.itemId||'')}">
    <button class="bst-p-row-remove" data-bst-action="removeRow" data-id="${id}" data-type="butins" title="Retirer">✕</button>
  </div>`;
}

// Couleur par rareté — délègue au composant partagé.
const _bstRarColor = getRareteColor;

// ─────────────────────────────────────────────────────────────────────────────
// PICKER OBJET BOUTIQUE — utilise le composant partagé shared/shop-picker.js
// ─────────────────────────────────────────────────────────────────────────────
window._bstButinPickerOpen = async (creatureId) => {
  if (!creatureId) return;
  const c = _creatures.find(x => x.id === creatureId);
  if (!c) return;
  await openShopPicker({
    title: '🎒 Ajouter un butin',
    modalMode: 'push',
    hint: 'Tu peux enchaîner les ajouts sans fermer cette fenêtre.',
    ownedBadgeTitle: 'Déjà dans le butin',
    alreadyPicked: () => new Set((c.butins || []).map(b => b.itemId).filter(Boolean)),
    onPick: (item) => {
      const butins = Array.isArray(c.butins) ? [...c.butins] : [];
      if (butins.find(b => b.itemId === item.id)) {
        showNotif('Déjà dans le butin de cette créature', 'warning');
        return false; // empêche l'ajout
      }
      butins.push({
        itemId:   item.id,
        nom:      item.nom   || '',
        image:    item.image || '',
        quantite: '1',
        chance:   '100%',
      });
      c.butins = butins;
      _bstQueueSave(creatureId, { butins });
      _bstRefreshButinSelects(creatureId);
      const countEl = document.querySelector(`[data-bst-count="${creatureId}-butins"]`);
      if (countEl) countEl.textContent = butins.length;
    },
  });
};

// Matrice de relations aux dégâts (panneau, version chips compacte)
function _renderDamageMatrixPanel(c, types) {
  return `<div class="bst-section">
    <div class="bst-section-title">🛡️ Relations aux dégâts</div>
    <div class="bst-dmg-edit">
      ${DMG_RELATIONS.map(rel => {
        const active = Array.isArray(c[rel.key]) ? c[rel.key] : [];
        return `<div class="bst-dmg-edit-row" style="border-left:3px solid ${rel.color};background:${rel.color}08">
          <div class="bst-dmg-edit-head">
            <span class="bst-dmg-icon">${rel.icon}</span>
            <span class="bst-dmg-name" style="color:${rel.color}">${rel.label}</span>
            <span class="bst-dmg-rule">${rel.short}</span>
          </div>
          <div class="bst-dmg-edit-chips">
            ${(types || []).map(t => {
              const isActive = active.includes(t.id);
              return `<button type="button" data-dmg-chip="${c.id}-${rel.key}-${t.id}"
                class="bst-dmg-chip${isActive?' active':''}"
                style="${isActive?`color:${rel.color};border-color:${rel.color};background:${rel.color}1a`:''}"
                data-bst-action="toggleDmg" data-id="${c.id}" data-key="${rel.key}" data-tid="${t.id}">
                ${t.icon||''} ${_esc(t.label)}
              </button>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

/**
 * Matrice unique : lignes = types de dégâts, colonnes = catégories.
 * Vue compacte qui rend les conflits (un type coché dans 2 catégories)
 * immédiatement visibles sur une même ligne.
 */
function _renderDamageTypeMatrix(beast, types) {
  const rels = DMG_RELATIONS;

  const headerCells = rels.map(rel =>
    `<div style="text-align:center;padding:.5rem .25rem;font-size:.66rem;font-weight:700;color:${rel.color};
      border-left:1px solid var(--border);background:${rel.color}10">
      <div style="font-size:1rem;line-height:1">${rel.icon}</div>
      <div style="margin-top:.2rem;letter-spacing:.02em">${_esc(rel.label.replace(/s$/, '.'))}</div>
      <div style="font-size:.55rem;font-weight:400;color:var(--text-dim);margin-top:.05rem">${rel.short}</div>
    </div>`
  ).join('');

  const bodyCells = types.map(t => {
    const cells = rels.map(rel => {
      const arr = Array.isArray(beast?.[rel.key]) ? beast[rel.key] : [];
      const checked = arr.includes(t.id);
      return `<label data-bst-cell="${t.id}" data-bst-rel="${rel.key}"
        style="display:flex;align-items:center;justify-content:center;cursor:pointer;
               border-top:1px solid var(--border);border-left:1px solid var(--border);
               background:${checked ? `${rel.color}22` : 'transparent'};transition:background .12s;padding:.4rem .25rem">
        <input type="checkbox" name="bst-${rel.key}" value="${t.id}" ${checked?'checked':''}
          style="accent-color:${rel.color};margin:0;width:15px;height:15px;cursor:pointer"
          data-bst-action="syncDmgConfl" data-bst-on="change">
      </label>`;
    }).join('');
    return `<div data-bst-row="${t.id}"
        style="display:flex;align-items:center;gap:.45rem;padding:.4rem .65rem;font-size:.78rem;color:var(--text);
               border-top:1px solid var(--border);min-width:0">
        <span style="font-size:.95rem;flex-shrink:0">${t.icon||''}</span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(t.label)}</span>
        <span data-bst-row-warn="${t.id}" style="display:none;margin-left:auto;font-size:.62rem;color:#f59e0b;font-weight:700"
          title="Ce type est sélectionné dans plusieurs catégories">⚠</span>
      </div>${cells}`;
  }).join('');

  return `<div data-bst-matrix style="border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--bg-elevated)">
    <div style="display:grid;grid-template-columns:minmax(140px,1.6fr) repeat(${rels.length}, minmax(56px,1fr));align-items:stretch">
      <div style="padding:.5rem .65rem;font-size:.62rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-dim)">Type</div>
      ${headerCells}
      ${bodyCells}
    </div>
  </div>`;
}

/** Met en évidence les types de dégâts cochés dans plusieurs catégories (matrice). */
window._bstSyncDmgConflicts = () => {
  const matrix = document.querySelector('[data-bst-matrix]');
  if (!matrix) return;
  const counts = new Map();
  matrix.querySelectorAll('input[type=checkbox]:checked').forEach(cb => {
    counts.set(cb.value, (counts.get(cb.value) || 0) + 1);
  });
  matrix.querySelectorAll('[data-bst-cell]').forEach(cell => {
    const cb = cell.querySelector('input[type=checkbox]');
    const checked = !!cb?.checked;
    const rel = DMG_RELATIONS.find(r => r.key === cell.dataset.bstRel);
    const isConflict = checked && (counts.get(cell.dataset.bstCell) || 0) > 1;
    cell.style.background = isConflict ? 'rgba(245,158,11,.22)'
                          : checked    ? `${rel?.color || 'var(--gold)'}22`
                                       : 'transparent';
    cell.style.boxShadow = isConflict ? '0 0 0 1px #f59e0b inset' : 'none';
  });
  matrix.querySelectorAll('[data-bst-row-warn]').forEach(warn => {
    const tid = warn.dataset.bstRowWarn;
    warn.style.display = (counts.get(tid) || 0) > 1 ? 'inline' : 'none';
  });
};

function _readDamageTypeSelections(name) {
  return [...document.querySelectorAll(`input[name=bst-${name}]:checked`)].map(el => el.value).filter(Boolean);
}

// ══════════════════════════════════════════════════════════════════════════════
// BANDEAU AVATARS — sélecteur de vue (MJ ↔ joueur)
// ══════════════════════════════════════════════════════════════════════════════
function _avatarTile({ active, ringColor, uid, imageUrl, fallback, pseudo, charNom }) {
  const ring = active ? ringColor : 'var(--border)';
  const shadow = active ? `0 0 0 2px ${ringColor}33` : 'none';
  const labelColor = active ? ringColor : 'var(--text-dim)';
  return `<button data-bst-action="viewAs" data-uid="${uid || ''}" title="${_esc(pseudo)}${charNom?` — ${_esc(charNom)}`:''}"
    style="display:flex;flex-direction:column;align-items:center;gap:.25rem;padding:.25rem;
    border:none;background:none;cursor:pointer;border-radius:8px;min-width:54px;
    transition:background .12s"
    onmouseover="this.style.background='rgba(255,255,255,.04)'"
    onmouseout="this.style.background='none'">
    <div style="width:44px;height:44px;border-radius:50%;overflow:hidden;
      border:2px solid ${ring};box-shadow:${shadow};
      background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;
      font-weight:700;color:var(--text);font-size:1rem;flex-shrink:0">
      ${imageUrl
        ? `<img src="${imageUrl}" alt="" style="width:100%;height:100%;object-fit:cover">`
        : _esc(fallback)}
    </div>
    <div style="font-size:.62rem;color:${labelColor};max-width:72px;white-space:nowrap;
      overflow:hidden;text-overflow:ellipsis;font-weight:${active?'700':'400'}">${_esc(pseudo)}</div>
  </button>`;
}

function _renderPlayerAvatars() {
  return `<div style="display:flex;gap:.3rem;flex-wrap:wrap;align-items:flex-start;margin-top:.5rem;
    padding:.4rem .5rem;background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px">
    ${_avatarTile({
      active:    !_viewAsUid,
      ringColor: 'var(--gold)',
      uid:       '',
      imageUrl:  '',
      fallback:  '👑',
      pseudo:    'MJ',
      charNom:   '',
    })}
    <div style="width:1px;align-self:stretch;background:var(--border);margin:0 .15rem"></div>
    ${_playersList.map(p => _avatarTile({
      active:    _viewAsUid === p.uid,
      ringColor: '#4f8cff',
      uid:       p.uid,
      imageUrl:  p.portraitUrl,
      fallback:  p.initial,
      pseudo:    p.pseudo,
      charNom:   p.charNom,
    })).join('')}
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDU PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
async function renderBestiary() {
  const content = document.getElementById('main-content');
  content.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-dim)"><div style="font-size:2rem">⏳</div></div>`;

  // Admin : charger la liste des bestiaires disponibles
  if (STATE.isAdmin) {
    const meta = await getDocData('bestiary_meta', 'list');
    const list = meta?.list || [];
    if (!list.find(b => b.id === 'main')) list.unshift({ id:'main', label:'Bestiaire principal' });
    window._bstBestiaireList = list;

    // Liste des joueurs (uid + pseudo) pour la vue "bestiaire d'un joueur".
    // Source primaire : STATE.characters (déjà chargé via la page d'accueil).
    // Fallback : loadChars(null) si on arrive direct au bestiaire.
    let chars = STATE.characters;
    if (!chars || !chars.length) {
      try { chars = await loadChars(null); } catch { chars = []; }
    }
    // Portrait du PJ : même ordre de fallback que le VTT pour la cohérence.
    // Tout est déjà en mémoire (STATE.characters), aucune lecture Firestore en plus.
    const seen = new Map();
    (chars || []).forEach(c => {
      if (!c?.uid || c.uid === STATE.user?.uid) return;
      const pseudo = c.ownerPseudo || c.nom || c.uid;
      const photo  = c.photoURL || c.photo || c.avatar || c.portraitUrl || c.imageUrl || '';
      const existing = seen.get(c.uid);
      // Préférer un PJ qui a une photo, sinon le premier rencontré.
      if (!existing || (!existing.portraitUrl && photo)) {
        seen.set(c.uid, {
          uid:         c.uid,
          pseudo,
          charNom:     c.nom || '',
          portraitUrl: photo,
          initial:     (pseudo || '?').charAt(0).toUpperCase(),
        });
      }
    });
    _playersList = [...seen.values()]
      .sort((a,b) => a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity:'base' }));
  }

  // Charger les créatures du bestiaire actif
  const col = _bestiaireId === 'main' ? 'bestiary' : `bestiary_${_bestiaireId}`;
  const allCreatures = await loadCollection(col);
  // Les créatures marquées hidden ne sont visibles que pour le MJ
  _creatures = STATE.isAdmin ? allCreatures : allCreatures.filter(c => !c.hidden);
  _creatures.sort((a,b) => (a.nom||'').localeCompare(b.nom||''));
  window._bstCurrentCol = col;

  if (!_damageTypes) _damageTypes = await loadDamageTypes();

  // Tracker : MJ peut consulter celui d'un joueur via _viewAsUid
  const trackerUid = _viewAsUid || STATE.user?.uid;
  if (trackerUid) {
    const trackerDoc = await getDocData('bestiary_tracker', trackerUid);
    _tracker = trackerDoc?.data || {};
  } else {
    _tracker = {};
  }

  _render();

  // ── Abonnements temps réel ─────────────────────────────────────────────
  // Premier fire (snapshot initial) ignoré : déjà rendu par _render() au-dessus.
  // Les noms 'bst-creatures' / 'bst-tracker' sont réutilisés : si l'admin
  // switche de bestiaire ou de "viewAs", watch() kill l'ancien listener et
  // crée le nouveau sur la bonne collection / le bon doc.
  let _firstCreatures = true, _firstTracker = true;

  watch('bst-creatures', col, data => {
    if (_firstCreatures) { _firstCreatures = false; return; }
    if (STATE.currentPage !== 'bestiary') return;
    if (_bstShouldSkipLiveRender()) return;
    const all = data || [];
    _creatures = STATE.isAdmin ? all : all.filter(c => !c.hidden);
    _creatures.sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
    _render();
  });

  if (trackerUid) {
    watchDoc('bst-tracker', 'bestiary_tracker', trackerUid, doc => {
      if (_firstTracker) { _firstTracker = false; return; }
      if (STATE.currentPage !== 'bestiary') return;
      if (_bstShouldSkipLiveRender()) return;
      _tracker = doc?.data || {};
      _render();
    });
  }
}

// Évite d'écraser une édition admin en cours : la fiche du panneau a des
// inputs/textarea avec auto-save debouncé (_bstQueueSave 400ms). Si on
// re-render alors qu'un champ est focus, le curseur saute. On préfère
// attendre le prochain snapshot (qui arrivera après la sauvegarde).
function _bstShouldSkipLiveRender() {
  const ae = document.activeElement;
  if (!ae) return false;
  const tag = ae.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !ae.isContentEditable) return false;
  const main = document.getElementById('main-content');
  return !!(main && main.contains(ae));
}

// ── Création rapide d'une créature sans modal ──────────────────────────────────
window._bstCreateDraft = async function () {
  if (!STATE.isAdmin) return;
  const col = 'bestiary';
  const data = {
    nom: 'Nouvelle créature', emoji: '🐲', rang: 'classique',
    type: '', environnement: '', niveau: 0, dangerositeXp: 0,
    pvMax: 0, pmMax: 0, ca: 0, vitesse: 0, initiative: 0,
    force: 0, dexterite: 0, constitution: 0, intelligence: 0, sagesse: 0, charisme: 0,
    tokenW: 1, tokenH: 1, imageUrl: '', description: '',
    resistances: [], immunites: [], absorptions: [], faiblesses: [],
    armesNaturelles: [], actions: [], traits: [], butins: [],
  };
  try {
    const newId = await addToCol(col, data);
    if (typeof newId === 'string') {
      _creatures.push({ ...data, id: newId });
    } else {
      _creatures = await loadCollection(col);
    }
    _creatures.sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
    _activeId = typeof newId === 'string' ? newId : (_creatures[_creatures.length - 1]?.id ?? null);
    _render();
    setTimeout(() => {
      const nameInput = document.querySelector('.bst-panel-name-input');
      nameInput?.focus();
      nameInput?.select();
    }, 50);
  } catch (e) { notifySaveError(e); }
};

function _render() {
  const content = document.getElementById('main-content');

  const allTypes = [...new Set(_creatures.map(c => c.type||'').filter(Boolean))].sort();
  const filtered = _creatures.filter(c => _beastMatchesFilters(c));

  // Comptes par rang (total, sans filtre rang)
  const byRang = { classique:0, elite:0, boss:0 };
  _creatures.forEach(c => { const r = c.rang||'classique'; if (byRang[r]!==undefined) byRang[r]++; });

  const ribbonData = [
    { label:'Total',    icon:'🐾', count:_creatures.length, c:'#7eb0ff',              filter:'' },
    { label:'Classique',icon:'◆',  count:byRang.classique,  c:RANG_STYLE.classique.color, filter:'classique' },
    { label:'Élite',    icon:'★',  count:byRang.elite,      c:RANG_STYLE.elite.color,     filter:'elite'     },
    { label:'Boss',     icon:'☠',  count:byRang.boss,       c:RANG_STYLE.boss.color,      filter:'boss'      },
  ];

  const bstList = window._bstBestiaireList || [{ id:'main', label:'Bestiaire principal' }];
  const tabsHtml = STATE.isAdmin ? `
    <div class="bst-tabs">
      ${bstList.map(b => `
        <button class="bst-tab${b.id===_bestiaireId?' active':''}" data-bst-action="switchBest" data-id="${b.id}">
          📜 ${_esc(b.label)}
        </button>`).join('')}
      <button class="bst-tab add" data-bst-action="createBest">+ Nouveau</button>
    </div>` : '';

  content.innerHTML = `
  <div class="bst-page ${_activeId ? 'has-panel' : 'no-panel'}">

  <!-- ═ HERO ═══════════════════════════════════════════════════════════════ -->
  <div class="bst-hero">
    <div class="bst-hero-row">
      <div class="bst-hero-title-block">
        <div class="bst-eyebrow">Encyclopédie des Créatures</div>
        <h1 class="bst-title">✦ Cartulaire des Bêtes ✦</h1>
      </div>
      ${tabsHtml ? `<div>${tabsHtml}</div>` : ''}
    </div>

    <div class="bst-ribbon">
      ${ribbonData.map(r => `
        <div class="bst-ribbon-item${(!r.filter && !_filterRang)||(r.filter && _filterRang===r.filter)?' active':''}"
          style="--c:${r.c}"
          data-bst-action="setRang" data-rang="${r.filter}">
          <div class="bst-ribbon-icon">${r.icon}</div>
          <div>
            <div class="bst-ribbon-num">${r.count}</div>
            <div class="bst-ribbon-lbl">${r.label}</div>
          </div>
        </div>`).join('')}
    </div>

    ${STATE.isAdmin && _playersList.length ? _renderPlayerAvatars() : ''}
  </div>

  ${_isViewingPlayer() ? `
  <div style="display:flex;align-items:center;gap:.6rem;padding:.6rem 2rem;
    border-bottom:1px solid rgba(79,140,255,.2);background:rgba(79,140,255,.06)">
    <span>👁</span>
    <span style="font-size:.78rem;color:var(--text)">
      Vue du bestiaire de <strong style="color:#4f8cff">${_esc(_playersList.find(p=>p.uid===_viewAsUid)?.pseudo||'?')}</strong>
      — tes modifications sont enregistrées chez ce joueur.
    </span>
    <button data-bst-action="viewAs" data-uid="" style="margin-left:auto;font-size:.7rem;padding:3px 10px;
      border-radius:999px;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text-dim);cursor:pointer">
      Revenir à la vue MJ
    </button>
  </div>` : ''}

  <!-- ═ CONTROLS ════════════════════════════════════════════════════════════ -->
  <div class="bst-controls-bar">
    <div class="bst-search-wrap">
      <span style="color:var(--text-dim);font-size:.9rem;flex-shrink:0">🔍</span>
      <input type="text" id="bst-search" placeholder="Rechercher…"
        value="${_esc(_searchVal)}"
        data-bst-action="search" data-bst-on="input"
        style="background:none;border:none;outline:none;color:var(--text);font-size:.8rem;flex:1;min-width:0">
    </div>
    <div class="chip-row">
      <button class="chip${!_filterType?' active':''}" data-bst-action="setType" data-type="">Tous</button>
      ${allTypes.map(t => `
        <button class="chip${_norm(_filterType)===_norm(t)?' active':''}"
          data-bst-action="setType" data-type="${_esc(t)}">
          ${_esc(t)}
        </button>`).join('')}
    </div>
    ${STATE.isAdmin ? `<button class="btn btn-gold btn-sm" style="white-space:nowrap;flex-shrink:0" data-bst-action="createDraft">+ Créature</button>` : ''}
  </div>

  <!-- ═ LAYOUT ═══════════════════════════════════════════════════════════════ -->
  <div class="bst-layout ${_activeId ? 'has-panel' : 'no-panel'}">
    <div class="bst-grid-wrap">
      ${filtered.length === 0 ? `
        <div class="bst-empty">
          <div class="bst-empty-icon">🐉</div>
          <div class="bst-empty-title">${_creatures.length===0 ? 'Aucune créature dans le bestiaire' : 'Aucun résultat'}</div>
          <div class="bst-empty-sub">${_creatures.length===0 ? 'Ajoutez la première créature pour commencer.' : 'Essayez un filtre différent.'}</div>
          ${STATE.isAdmin && _creatures.length===0 ? `<button class="btn btn-outline btn-sm" style="margin-top:1rem" data-bst-action="createDraft">+ Ajouter la première créature</button>` : ''}
        </div>` : `
        <div class="bst-grid">
          ${filtered.map(c => _renderCard(c)).join('')}
        </div>`}
    </div>

    <div class="bst-panel-slot">
      ${_activeId ? _renderPanel(_creatures.find(c => c.id === _activeId)) : ''}
    </div>
  </div>
  </div>`;
}

// ── Card créature ─────────────────────────────────────────────────────────────
function _renderCard(c) {
  const isActive = c.id === _activeId;
  const rang     = c.rang || 'classique';
  const rs       = RANG_STYLE[rang] || RANG_STYLE.classique;
  const track    = _tracker[c.id] || {};

  const pvMax    = _isAdminView() ? (parseInt(c.pvMax)||0) : 0;
  const pvActuel = track.pvActuel !== undefined ? parseInt(track.pvActuel) : pvMax;
  const pvPct    = pvMax > 0 ? Math.max(0, Math.min(100, Math.round(pvActuel/pvMax*100))) : 0;

  return `<div class="bst-card${isActive?' active':''}"
    style="--rang-c:${rs.color};--rang-glow:${rs.glow}"
    data-beast-id="${_esc(c.id)}"
    data-bst-action="open" data-id="${c.id}">

    ${c.imageUrl
      ? `<img class="bst-card-img" src="${_esc(c.imageUrl)}" alt="${_esc(c.nom||'')}" loading="lazy">`
      : `<div class="bst-card-empty">${c.emoji||'🐲'}</div>`}

    <div class="bst-card-rang">${_esc(rs.label)}</div>
    ${c.niveau ? `<div class="bst-card-niveau">${c.niveau}</div>` : ''}
    ${STATE.isAdmin && c.hidden ? `<div class="bst-card-hidden" title="Caché aux joueurs">🔒</div>` : ''}

    <div class="bst-card-body">
      <div class="bst-card-name">${_esc(c.nom||'?')}</div>
      ${c.type||c.environnement
        ? `<div class="bst-card-meta">${_esc([c.type,c.environnement].filter(Boolean).join(' · '))}</div>`
        : ''}

      ${_isAdminView() && (c.pvMax||c.ca||c.vitesse) ? `
      <div class="bst-card-stats">
        ${c.pvMax   ? `<span class="bst-card-stat">❤️ ${c.pvMax}</span>`   : ''}
        ${c.ca      ? `<span class="bst-card-stat">🛡️ ${c.ca}</span>`      : ''}
        ${c.vitesse ? `<span class="bst-card-stat">💨 ${c.vitesse}m</span>` : ''}
      </div>` : ''}

      ${_isAdminView() && pvMax > 0 ? `
      <div class="bst-card-pv">
        <div class="bst-card-pv-fill" style="width:${pvPct}%"></div>
      </div>
      <div class="bst-card-pv-lbl"><span>${pvActuel} PV</span><span>/ ${pvMax}</span></div>` : ''}
    </div>

    ${STATE.isAdmin ? `
    <div style="display:flex;gap:3px;padding:.35rem .6rem;border-top:1px solid var(--border);justify-content:flex-end">
      <button class="btn-icon" style="font-size:.7rem;color:#ff5a7e" data-bst-action="deleteBeast" data-id="${c.id}" title="Supprimer">🗑️</button>
    </div>` : ''}
  </div>`;
}

// ── Panneau détail ────────────────────────────────────────────────────────────
function _renderPanel(c) {
  if (!c) return '';
  const rang  = c.rang || 'classique';
  const rs    = RANG_STYLE[rang] || RANG_STYLE.classique;

  // MJ : panneau entièrement éditable (auto-save Firestore)
  if (_isAdminView()) return _renderPanelAdmin(c, rs);

  const track = _tracker[c.id] || {};
  const ded   = track.deductions || {};

  const pvMax     = parseInt(c.pvMax)    || 0;
  const pmMax     = parseInt(c.pmMax)    || 0;
  const pvActuel  = track.pvActuel  !== undefined ? parseInt(track.pvActuel)  : null;
  const pmActuel  = track.pmActuel  !== undefined ? parseInt(track.pmActuel)  : null;
  const caEstimee = track.caEstimee !== undefined ? parseInt(track.caEstimee) : null;
  const vitEstimee= track.vitEstimee!== undefined ? parseInt(track.vitEstimee): null;
  const pvPct     = pvMax > 0 && pvActuel !== null ? Math.round(pvActuel / pvMax * 100) : 0;
  const pmPct     = pmMax > 0 && pmActuel !== null ? Math.round(pmActuel / pmMax * 100) : 0;

  const traits    = Array.isArray(c.traits) ? c.traits : [];
  const description = c.description == null ? '' : String(c.description);

  // Calcul modificateur D&D : floor((stat - 10) / 2)
  const mod = (val) => {
    const n = parseInt(val);
    if (!val || isNaN(n)) return null;
    const m = Math.floor((n - 10) / 2);
    return m >= 0 ? `+${m}` : `${m}`;
  };

  // ── Hero du panneau ──────────────────────────────────────────────────────
  const heroHtml = `
    <div class="bst-panel-hero">
      ${c.imageUrl
        ? `<img class="bst-panel-img" src="${_esc(c.imageUrl)}" alt="${_esc(c.nom||'')}">`
        : `<div class="bst-panel-empty">${c.emoji||'🐲'}</div>`}
      ${_isAdminView() ? `<div class="bst-panel-mj-badge">MJ</div>` : ''}
      <button class="bst-panel-close" data-bst-action="close">✕</button>
      <div class="bst-panel-hero-info">
        <div class="bst-panel-rang">${_esc(rs.label)}</div>
        <div class="bst-panel-name">${_esc(c.nom||'?')}</div>
        ${c.type||c.environnement
          ? `<div class="bst-panel-meta">${_esc([c.type,c.environnement].filter(Boolean).join(' · '))}</div>`
          : ''}
      </div>
    </div>`;

  // ── Vitaux (5) ───────────────────────────────────────────────────────────
  // MJ : valeurs réelles (lecture seule, depuis c.pvMax / c.pmMax / c.ca / …)
  // Joueur : estimations modifiables (track.pvActuel, etc.) — synchronisées
  //          avec le VTT en temps réel (saisie ici → "?" disparaît côté VTT).
  const _estCell = (cls, lbl, trackKey, trackVal) => `
    <div class="bst-stat-cell ${cls}" data-bst-action="focusInput">
      <input type="number" id="bst-${cls}-${c.id}"
        value="${trackVal || ''}" placeholder="?" min="0"
        class="bst-stat-track-input"
        data-bst-action="setStat" data-bst-on="change" data-id="${c.id}" data-key="${trackKey}">
      <div class="bst-stat-lbl">${lbl}</div>
    </div>`;

  const _staticCell = (cls, lbl, val) => `
    <div class="bst-stat-cell ${cls}">
      <div class="bst-stat-val">${val || '—'}</div>
      <div class="bst-stat-lbl">${lbl}</div>
    </div>`;

  const vitalsHtml = `
    <div class="bst-section">
      <div class="bst-section-title">Statistiques</div>
      <div class="bst-stats-base">
        ${_estCell('pv',  'PV',   'pvActuel',   pvActuel)}
        ${_estCell('pm',  'PM',   'pmActuel',   pmActuel)}
        ${_estCell('ca',  'CA',   'caEstimee',  caEstimee)}
        ${_estCell('vit', 'Vit.', 'vitEstimee', vitEstimee)}
        ${_staticCell('init','XP', '')}
      </div>
    </div>`;

  // ── Caracs (6) : MJ seulement ────────────────────────────────────────────
  const caracsHtml = _isAdminView() ? `
    <div class="bst-section">
      <div class="bst-section-title">Caractéristiques</div>
      <div class="bst-caracs">
        ${[
          ['FOR', c.force],['DEX', c.dexterite],['CON', c.constitution],
          ['INT', c.intelligence],['SAG', c.sagesse],['CHA', c.charisme],
        ].map(([lbl, val]) => {
          const m = mod(val);
          const posNeg = !m ? 'zero' : parseInt(m) > 0 ? 'pos' : 'neg';
          return `<div class="bst-carac">
            <div class="bst-carac-val">${val||'—'}</div>
            ${m ? `<div class="bst-carac-mod ${posNeg}">${m}</div>` : ''}
            <div class="bst-carac-lbl">${lbl}</div>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  // ── Description ──────────────────────────────────────────────────────────
  const descHtml = description ? `
    <div class="bst-section">
      <div class="bst-section-title">Description</div>
      <div class="bst-desc">${_esc(description).replace(/\n/g,'<br>')}</div>
    </div>` : '';

  // ── Relations aux dégâts : MJ SEULEMENT ─────────────────────────────────
  const dmgHtml = _isAdminView() ? _renderDamageProfile(c, _damageTypes) : '';


  // ── Actions Joueur : estimation par action (nom + dégâts + portée) ────────
  // Indexée par action.id (stable même si l'ordre change). Fallback sur idx
  // pour la rétro-compat avec les anciennes clés `att_*`.
  const actsJ = Array.isArray(c.actions) ? c.actions : [];
  const attaquesJoueurHtml = !_isAdminView() && actsJ.length ? `
    <div class="bst-section">
      <div class="bst-section-title">⚔️ Actions
        <span class="bst-section-count">${actsJ.length} observée${actsJ.length>1?'s':''}</span>
      </div>
      ${actsJ.map((act, i) => {
        const k = act.id || `idx_${i}`;
        const dedAttr = (suffix) => `data-bst-action="setDeduction" data-bst-on="change" data-id="${c.id}" data-key="act_${suffix}_${k}"`;
        return `<div class="bst-atk">
          <input class="bst-deduct-input" style="margin-bottom:6px;font-weight:600"
            placeholder="Nom de l'action…"
            value="${_esc(ded['act_nom_'+k]||'')}" ${dedAttr('nom')}>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px">
            <input class="bst-deduct-input" placeholder="🎯 Toucher"
              value="${_esc(ded['act_toucher_'+k]||'')}" ${dedAttr('toucher')}>
            <input class="bst-deduct-input" placeholder="⚔️ Dégâts"
              value="${_esc(ded['act_degats_'+k]||'')}" ${dedAttr('degats')}>
            <input class="bst-deduct-input" placeholder="📏 Portée"
              value="${_esc(ded['act_portee_'+k]||'')}" ${dedAttr('portee')}>
          </div>
        </div>`;
      }).join('')}
    </div>` : '';

  // ── Traits Joueur : lignes vides à compléter ──────────────────────────────
  const traitsJoueurHtml = !_isAdminView() && traits.length ? `
    <div class="bst-section">
      <div class="bst-section-title">✨ Traits & Capacités
        <span class="bst-section-count">${traits.length} trait${traits.length>1?'s':''}</span>
      </div>
      ${traits.map((_, i) => {
        const dedAttr = (suffix) => `data-bst-action="setDeduction" data-bst-on="change" data-id="${c.id}" data-key="tr_${suffix}_${i}"`;
        return `<div class="bst-trait">
          <input class="bst-deduct-input" style="margin-bottom:5px;font-weight:600"
            placeholder="Nom du trait…"
            value="${_esc(ded['tr_nom_'+i]||'')}" ${dedAttr('nom')}>
          <input class="bst-deduct-input"
            placeholder="Description…"
            value="${_esc(ded['tr_desc_'+i]||'')}" ${dedAttr('desc')}>
        </div>`;
      }).join('')}
    </div>` : '';

  return `
  <div class="bst-panel" style="--rang-c:${rs.color};--rang-glow:${rs.glow}">
    ${heroHtml}
    <div class="bst-panel-body">
      ${vitalsHtml}
      ${descHtml}
      ${attaquesJoueurHtml}
      ${traitsJoueurHtml}
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// PANNEAU MJ — entièrement éditable, auto-save
// ══════════════════════════════════════════════════════════════════════════════
function _renderPanelAdmin(c, rs) {
  const types     = _damageTypes || window._bstDamageTypes || [];
  const traits    = Array.isArray(c.traits) ? c.traits : [];
  const butins    = Array.isArray(c.butins) ? c.butins : [];

  const modOf = (val) => {
    const n = parseInt(val);
    if (!val || isNaN(n)) return { txt:'', cls:'zero' };
    const m = Math.floor((n - 10) / 2);
    return { txt: m >= 0 ? `+${m}` : `${m}`, cls: m > 0 ? 'pos' : m < 0 ? 'neg' : 'zero' };
  };

  // ── Hero éditable : image cliquable, rang selector, nom, type, env ──────
  const heroHtml = `
    <div class="bst-panel-hero">
      ${c.imageUrl
        ? `<img class="bst-panel-img" src="${_esc(c.imageUrl)}" alt="${_esc(c.nom||'')}"
             style="cursor:pointer" data-bst-action="openImage" data-id="${c.id}">`
        : `<div class="bst-panel-empty" style="cursor:pointer" data-bst-action="openImage" data-id="${c.id}">${c.emoji||'🐲'}</div>`}
      <button class="bst-panel-img-edit" data-bst-action="openImage" data-id="${c.id}" title="Changer l'image">📷</button>
      <div class="bst-panel-mj-badge">MJ</div>
      <button class="bst-panel-close" data-bst-action="close">✕</button>
      <div class="bst-panel-hero-info">
        <div class="bst-panel-rang-selector">
          ${Object.entries(RANG_STYLE).map(([r, rst]) => {
            const active = (c.rang||'classique') === r;
            return `<button type="button" data-bst-rang-btn="${r}"
              class="bst-rang-btn${active?' active':''}"
              style="${active?`color:${rst.color};border-color:${rst.color};background:${rst.color}1a`:''}"
              data-bst-action="selectRang" data-id="${c.id}" data-rang="${r}">${rst.label}</button>`;
          }).join('')}
          <button type="button" class="bst-rang-btn bst-hidden-toggle${c.hidden?' active':''}"
            data-bst-action="toggleHidden" data-id="${c.id}"
            title="${c.hidden ? 'Visible : actuellement cachée aux joueurs — clic pour afficher' : 'Cacher cette créature aux joueurs (boss spoiler, contenu surprise)'}"
            style="${c.hidden ? 'color:#b47fff;border-color:#b47fff;background:rgba(180,127,255,0.10)' : ''}">
            ${c.hidden ? '🔒 Cachée' : '👁 Visible'}
          </button>
        </div>
        <input class="bst-panel-name-input" value="${_esc(c.nom||'')}" placeholder="Nom de la créature…"
          data-bst-action="updateNom" data-bst-on="input" data-id="${c.id}">
        <div class="bst-panel-meta-edit">
          <input class="bst-panel-edit-inline" placeholder="Type" value="${_esc(c.type||'')}"
            data-bst-action="update" data-bst-on="input" data-id="${c.id}" data-field="type">
          <span class="bst-panel-meta-dot">·</span>
          <input class="bst-panel-edit-inline" placeholder="Environnement" value="${_esc(c.environnement||'')}"
            data-bst-action="update" data-bst-on="input" data-id="${c.id}" data-field="environnement">
        </div>
      </div>
    </div>`;

  // ── Statistiques (5 cellules : PV PM CA Vit XP) + niveau + initiative ───
  const vitalsHtml = `
    <div class="bst-section">
      <div class="bst-section-title">Statistiques</div>
      <div class="bst-stats-base">
        ${[
          ['pv',  'PV',     'pvMax',         c.pvMax],
          ['pm',  'PM',     'pmMax',         c.pmMax],
          ['ca',  'CA',     'ca',            c.ca],
          ['vit', 'Vit. (m)','vitesse',      c.vitesse],
          ['init','XP',     'dangerositeXp', c.dangerositeXp],
        ].map(([cls, lbl, field, val]) => `
          <div class="bst-stat-cell ${cls}" data-bst-action="focusInput">
            <input type="number" min="0" value="${val||''}" placeholder="0" class="bst-stat-track-input"
              data-bst-action="updateNum" data-bst-on="input" data-id="${c.id}" data-field="${field}">
            <div class="bst-stat-lbl">${lbl}</div>
          </div>`).join('')}
      </div>
      <div class="bst-niv-row">
        <span class="bst-niv-lbl">Niveau / FP</span>
        <input type="number" min="0" value="${c.niveau||''}" placeholder="—"
          class="bst-p-input bst-p-input-sm"
          data-bst-action="updateNum" data-bst-on="input" data-id="${c.id}" data-field="niveau">
        <span class="bst-niv-lbl">Initiative</span>
        <input type="number" value="${c.initiative||''}" placeholder="—"
          class="bst-p-input bst-p-input-sm"
          data-bst-action="updateNum" data-bst-on="input" data-id="${c.id}" data-field="initiative">
        <span class="bst-niv-lbl">Emoji</span>
        <input value="${_esc(c.emoji||'🐲')}" placeholder="🐲"
          class="bst-p-input bst-p-input-sm" style="width:40px"
          data-bst-action="update" data-bst-on="input" data-id="${c.id}" data-field="emoji">
      </div>
    </div>`;

  // ── Caracs (6, avec auto-modificateur) ─────────────────────────────────
  const caracsHtml = `
    <div class="bst-section">
      <div class="bst-section-title">Caractéristiques</div>
      <div class="bst-caracs">
        ${[
          ['FOR','force'],['DEX','dexterite'],['CON','constitution'],
          ['INT','intelligence'],['SAG','sagesse'],['CHA','charisme'],
        ].map(([lbl, key]) => {
          const { txt, cls } = modOf(c[key]);
          return `<div class="bst-carac">
            <input type="number" min="0" value="${c[key]||''}" placeholder="—"
              class="bst-carac-input"
              data-bst-action="updateCarac" data-bst-on="input" data-id="${c.id}" data-key="${key}">
            <div class="bst-carac-mod ${cls}" data-bst-mod="${c.id}-${key}">${txt}</div>
            <div class="bst-carac-lbl">${lbl}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;

  // ── Token VTT (taille en cases) ────────────────────────────────────────
  const tokenHtml = `
    <div class="bst-section">
      <div class="bst-section-title">Token VTT (cases)</div>
      <div class="bst-token-row">
        <span class="bst-niv-lbl">Largeur</span>
        <select class="bst-p-input bst-p-input-sm" data-bst-action="updateNum" data-bst-on="change" data-id="${c.id}" data-field="tokenW">
          ${[1,2,3,4,5].map(n => `<option value="${n}"${(c.tokenW||c.tokenSize||1)===n?' selected':''}>${n}</option>`).join('')}
        </select>
        <span class="bst-niv-lbl">×</span>
        <span class="bst-niv-lbl">Hauteur</span>
        <select class="bst-p-input bst-p-input-sm" data-bst-action="updateNum" data-bst-on="change" data-id="${c.id}" data-field="tokenH">
          ${[1,2,3,4,5].map(n => `<option value="${n}"${(c.tokenH||c.tokenSize||1)===n?' selected':''}>${n}</option>`).join('')}
        </select>
      </div>
    </div>`;

  // ── Description (textarea) ─────────────────────────────────────────────
  const descHtml = `
    <div class="bst-section">
      <div class="bst-section-title">Description</div>
      <textarea class="bst-panel-textarea" placeholder="Apparence, comportement, lore…" rows="3"
        data-bst-action="update" data-bst-on="input" data-id="${c.id}" data-field="description">${_esc(c.description||'')}</textarea>
    </div>`;

  // ── Relations aux dégâts (matrice chips compacte) ─────────────────────
  const dmgHtml = _renderDamageMatrixPanel(c, types);

  // ── Armes naturelles + Actions (sortilèges-style) ─────────────────────
  // 1) Armes naturelles : sources de dégâts de base (comme une arme équipée).
  //    Chaque action peut s'y référer via la modal de sort (preview = dégâts arme).
  // 2) Actions : sorts au format unifié, éditées via la même modal que les
  //    sorts de personnage et les actions d'objet.
  const armes = Array.isArray(c.armesNaturelles) ? c.armesNaturelles : [];
  const acts  = Array.isArray(c.actions)         ? c.actions         : [];

  // Charge le cache d'actions de CETTE créature pour les handlers _bstAddAction/_bstEditAction
  _bstActionsCacheLoad(c.id, acts);
  _bstActionsArmeIdCtx = armes[0]?.id || null;

  const armesHtml = `
    <div class="bst-section">
      <div class="bst-section-title">
        🦷 Armes naturelles
        <span class="bst-section-count" data-bst-count="${c.id}-armes">${armes.length}</span>
        <button class="bst-add-row-btn" data-bst-action="addArme" data-id="${c.id}">+ Ajouter</button>
      </div>
      <div class="bst-section-hint">Comme une arme équipée pour les sorts dérivés. La 1ʳᵉ sert de référence par défaut aux actions.</div>
      <div id="bst-p-armes-${c.id}" class="bst-p-rows">
        ${armes.map((a, i) => _bstRenderArmeRow(a, c.id, i)).join('')}
      </div>
    </div>`;

  const actionsHtml = `
    <div class="bst-section">
      <div class="bst-section-title">
        ⚔️ Actions
        <span class="bst-section-count" data-bst-count="${c.id}-actions">${acts.length}</span>
        <button class="bst-add-row-btn" data-bst-action="addAction">+ Ajouter</button>
      </div>
      <div class="bst-section-hint">Sorts unifiés — même éditeur que les sorts de personnage et les actions d'objet.</div>
      <div id="bst-p-actions-${c.id}" class="bst-p-rows bst-actions-host">
        ${_bstRenderActionsList()}
      </div>
    </div>`;

  const attaquesHtml = armesHtml + actionsHtml;

  // Lazy-load des objets boutique pour peupler les selects de butins
  if (!_bstShopItemsCache) {
    _bstEnsureShopItems().then(() => _bstRefreshButinSelects(c.id));
  }

  const traitsHtml = `
    <div class="bst-section">
      <div class="bst-section-title">
        ✨ Traits & Capacités
        <span class="bst-section-count" data-bst-count="${c.id}-traits">${traits.length}</span>
        <button class="bst-add-row-btn" data-bst-action="addRow" data-id="${c.id}" data-type="traits">+ Ajouter</button>
      </div>
      <div id="bst-p-traits-${c.id}" class="bst-p-rows">
        ${traits.map((t, i) => _panelTraitRow(t, c.id, i)).join('')}
      </div>
    </div>`;

  const butinsHtml = `
    <div class="bst-section">
      <div class="bst-section-title">
        💰 Butins
        <span class="bst-section-count" data-bst-count="${c.id}-butins">${butins.length}</span>
        <button class="bst-add-row-btn" data-bst-action="pickerOpen" data-id="${c.id}">+ Ajouter</button>
      </div>
      <div id="bst-p-butins-${c.id}" class="bst-p-rows">
        ${butins.map((b, i) => _panelButinRow(b, c.id, i)).join('')}
      </div>
    </div>`;

  return `
  <div class="bst-panel" style="--rang-c:${rs.color};--rang-glow:${rs.glow}">
    ${heroHtml}
    <div class="bst-panel-body">
      ${vitalsHtml}
      ${caracsHtml}
      ${tokenHtml}
      ${descHtml}
      ${dmgHtml}
      ${attaquesHtml}
      ${traitsHtml}
      ${butinsHtml}
      <div class="bst-admin-actions">
        <button class="bst-btn-delete" style="flex:1" data-bst-action="deleteBeast" data-id="${c.id}">🗑️ Supprimer cette créature</button>
      </div>
    </div>
  </div>`;
}

async function deleteBeast(id) {
  try {
    const col = window._bstCurrentCol || 'bestiary';
    const c = _creatures.find(x=>x.id===id);
    if (!await confirmModal(`Supprimer "${c?.nom||'cette créature'}" ?`, {title: 'Supprimer la créature'})) return;
    await deleteFromCol(col, id);
    _creatures = _creatures.filter(x=>x.id!==id);
    if (_activeId === id) _activeId = null;
    _render();
    showNotif('Créature supprimée.','success');
  } catch (e) { notifySaveError(e); }
}

// ══════════════════════════════════════════════════════════════════════════════
// SUIVI JOUEUR
// ══════════════════════════════════════════════════════════════════════════════
async function _saveTracker() {
  try {
    const uid = _viewAsUid || STATE.user?.uid; if (!uid) return;
    await saveDoc('bestiary_tracker', uid, { data: _tracker });
  } catch (e) { notifySaveError(e); }
}

function _syncActivePanel() {
  const page = document.querySelector('.bst-page');
  const layout = document.querySelector('.bst-layout');
  const panelSlot = document.querySelector('.bst-panel-slot');
  const activeCreature = _creatures.find(c => c.id === _activeId);

  page?.classList.toggle('has-panel', !!activeCreature);
  page?.classList.toggle('no-panel', !activeCreature);
  layout?.classList.toggle('has-panel', !!activeCreature);
  layout?.classList.toggle('no-panel', !activeCreature);

  document.querySelectorAll('.bst-card').forEach(card => {
    card.classList.toggle('active', card.dataset.beastId === _activeId);
  });

  if (panelSlot) {
    try {
      panelSlot.innerHTML = activeCreature ? _renderPanel(activeCreature) : '';
    } catch (err) {
      console.error('[bestiary] render panel failed:', err, activeCreature);
      panelSlot.innerHTML = activeCreature ? `
        <div class="bst-panel">
          <div class="bst-section">
            <div class="bst-section-title">Fiche creature</div>
            <div style="font-family:'Cinzel',serif;font-size:1.1rem;color:var(--text);font-weight:700">${_esc(activeCreature.nom || 'Creature')}</div>
            <div style="font-size:.78rem;color:var(--text-dim);margin-top:.35rem">Impossible d'afficher toutes les informations de cette creature.</div>
          </div>
        </div>` : '';
    }
  }
}

window._bstOpen = (id) => {
  _activeId = _activeId === id ? null : id;
  _syncActivePanel();
};
window._bstClose = () => {
  _activeId = null;
  _syncActivePanel();
};
window._bstSetRang = (rang) => { _filterRang = rang; _render(); };
window._bstSelectRang = (rang) => {
  const sel = document.getElementById('bst-rang-selector');
  if (!sel) return;
  sel.dataset.rang = rang;
  sel.querySelectorAll('[data-rang-btn]').forEach(btn => {
    const r = btn.dataset.rangBtn;
    const active = r === rang;
    const rst = RANG_STYLE[r] || RANG_STYLE.classique;
    btn.style.fontWeight = active ? '700' : '400';
    btn.style.border     = `1px solid ${active ? rst.border : 'var(--border)'}`;
    btn.style.background = active ? rst.bg  : 'var(--bg-elevated)';
    btn.style.color      = active ? rst.color : 'var(--text-dim)';
  });
};
// Recherche : met à jour la valeur et filtre la grille SANS rerender complet
window._bstSearchInput = (val) => {
  _searchVal = val;
  // Filtrer en live sans reconstruire toute la page
  document.querySelectorAll('.bst-card').forEach(card => {
    const id = card.dataset.beastId;
    const c  = _creatures.find(x => x.id === id);
    if (!c) return;
    card.style.display = _beastMatchesFilters(c, { search: val }) ? '' : 'none';
  });
};

window._bstSearch = (val) => { _searchVal = val; _render(); }; // legacy
window._bstSetType = (type) => { _filterType = type; _render(); };

// Switch de bestiaire (admin uniquement)
window._bstSwitchBestiaire = async (id) => {
  _bestiaireId = id;
  _activeId    = null;
  _searchVal   = '';
  _filterType  = '';
  _filterRang  = '';
  await renderBestiary();
};

// Vue admin → joueur : voir/modifier les estimations d'un joueur.
// uid vide ou égal à l'UID admin → retour à la vue MJ.
window._bstViewAs = async (uid) => {
  if (!STATE.isAdmin) return;
  _viewAsUid = (uid && uid !== STATE.user?.uid) ? uid : null;
  _activeId  = null;
  await renderBestiary();
};

window._bstCreateBestiaire = async () => {
  const label = prompt('Nom du nouveau bestiaire :');
  if (!label?.trim()) return;
  const id    = 'bst_' + Date.now();
  const list  = window._bstBestiaireList || [{ id:'main', label:'Bestiaire principal' }];
  list.push({ id, label: label.trim() });
  await saveDoc('bestiary_meta', 'list', { list });
  window._bstBestiaireList = list;
  _bestiaireId = id;
  _activeId    = null;
  _filterRang  = '';
  await renderBestiary();
};

// Déductions joueur
window._bstSetDeduction = (id, key, val) => {
  if (!_tracker[id]) _tracker[id] = {};
  if (!_tracker[id].deductions) _tracker[id].deductions = {};
  if (val === '' || val === null || val === undefined) {
    delete _tracker[id].deductions[key];
  } else {
    _tracker[id].deductions[key] = val;
  }
  _saveTracker();
};

window._bstAdjust = (id, type, delta) => {
  const c = _creatures.find(x=>x.id===id); if (!c) return;
  if (!_tracker[id]) _tracker[id] = {};
  const curKey = type==='pv'?'pvActuel':'pmActuel';
  // Vue MJ : connaît le max et le respecte. Vue joueur (ou MJ consultant un joueur) : pas de borne max.
  const max    = _isAdminView() ? (parseInt(c[type==='pv'?'pvMax':'pmMax'])||0) : null;
  const cur    = _tracker[id][curKey] !== undefined ? parseInt(_tracker[id][curKey]) : (max ?? 0);
  const newVal = max !== null ? Math.max(0, Math.min(max, cur + delta)) : Math.max(0, cur + delta);
  _tracker[id][curKey] = newVal;

  const input = document.getElementById(`bst-${type}-${id}`);
  const bar   = document.getElementById(`bst-${type}bar-${id}`);
  if (input) input.value = newVal;
  if (bar && max) {
    const pct = Math.round(newVal/max*100);
    bar.style.width = pct+'%';
  }
  if (_isAdminView() && max && type === 'pv') {
    const cardBar = [...document.querySelectorAll('.bst-card')]
      .find(card => card.dataset.beastId === id)
      ?.querySelector('.bst-card-pv-fill');
    if (cardBar) { cardBar.style.width = Math.round(newVal/max*100)+'%'; }
  }
  _saveTracker();
};

window._bstSetStat = (id, key, val) => {
  if (!_tracker[id]) _tracker[id] = {};
  _tracker[id][key] = parseInt(val)||0;
  _saveTracker();
};

window._bstSetNotes = (id, val) => {
  if (!_tracker[id]) _tracker[id] = {};
  _tracker[id].notes = val;
  _saveTracker();
};

window._bstReset = (id) => {
  const c = _creatures.find(x=>x.id===id); if (!c) return;
  // Vue MJ : remet les vraies valeurs. Vue joueur (ou MJ consultant un joueur) : remet les estimations à zéro.
  _tracker[id] = _isAdminView()
    ? { pvActuel: parseInt(c.pvMax)||0, pmActuel: parseInt(c.pmMax)||0, notes:'' }
    : { pvActuel: 0, pmActuel: 0, caEstimee: 0, vitEstimee: 0, pvCombat: 0, notes:'', deductions:{} };
  _saveTracker();
  _render();
};

// ── Override PAGES.bestiaire + exports ───────────────────────────────────────
PAGES.bestiaire = renderBestiary;

// ──────────────────────────────────────────────────────────────────────────────
// MODAL IMAGE — éditeur d'image dédié de la créature (depuis le panneau)
// ──────────────────────────────────────────────────────────────────────────────
async function openBeastImageModal(id) {
  const c = _creatures.find(x => x.id === id);
  if (!c) return;
  _bstCropper?.destroy(); _bstCropper = null;

  openModal(`📷 Image — ${_esc(c.nom || 'Créature')}`, `
    <div class="form-group">
      <label>Image (ratio 4:3)</label>
      <div id="bst-img-drop" style="border:2px dashed var(--border-strong);border-radius:12px;
        padding:1rem;text-align:center;cursor:pointer;background:var(--bg-elevated)">
        <div id="bst-img-preview"></div>
      </div>
      <div id="bst-img-crop-wrap" style="display:none;margin-top:.75rem">
        <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:.4rem">Recadrez l'image</div>
        <canvas id="bst-img-canvas" style="display:block;width:100%;border-radius:8px;cursor:crosshair;touch-action:none"></canvas>
        <button type="button" class="btn btn-gold btn-sm" id="bst-img-confirm" style="margin-top:.5rem;width:100%">✂️ Confirmer le recadrage</button>
        <div id="bst-img-ok" style="display:none;font-size:.75rem;text-align:center;margin-top:4px"></div>
      </div>
    </div>
    <div style="display:flex;gap:.5rem;margin-top:.75rem">
      <button class="btn btn-gold" style="flex:1" data-bst-action="saveImage" data-id="${id}">💾 Enregistrer</button>
      ${c.imageUrl ? `<button class="btn btn-outline" data-bst-action="removeImage" data-id="${id}">🗑 Retirer</button>` : ''}
    </div>
  `);

  _bstCropper = attachDropAndCrop({
    dropEl:        document.getElementById('bst-img-drop'),
    previewEl:     document.getElementById('bst-img-preview'),
    cropWrapEl:    document.getElementById('bst-img-crop-wrap'),
    canvasId:      'bst-img-canvas',
    statusEl:      document.getElementById('bst-img-ok'),
    confirmBtnEl:  document.getElementById('bst-img-confirm'),
    initialUrl:    c?.imageUrl || '',
    ratio:         { w: 4, h: 3 },
    output:        { maxW: 1800, target: 700_000 },
  });
}

window._bstSaveImage = async (id) => {
  try {
    const cropResult = _bstCropper?.getResult();
    const current = _creatures.find(c => c.id === id)?.imageUrl || '';
    const imageUrl = typeof cropResult === 'string' ? cropResult : current;
    if (imageUrl && imageUrl.length > 900_000) {
      showNotif('Image trop grande, recadrez plus petit.', 'error');
      return;
    }
    const col = window._bstCurrentCol || 'bestiary';
    await updateInCol(col, id, { imageUrl });
    const idx = _creatures.findIndex(c => c.id === id);
    if (idx >= 0) _creatures[idx].imageUrl = imageUrl;
    _bstCropper?.destroy(); _bstCropper = null;
    closeModal();
    _syncActivePanel();
    const card = document.querySelector(`.bst-card[data-beast-id="${id}"]`);
    if (card && imageUrl) {
      let img = card.querySelector('.bst-card-img');
      if (!img) {
        const empty = card.querySelector('.bst-card-empty');
        if (empty) {
          img = document.createElement('img');
          img.className = 'bst-card-img';
          img.loading = 'lazy';
          empty.replaceWith(img);
        }
      }
      if (img) img.src = imageUrl;
    }
    showNotif('Image mise à jour.', 'success');
  } catch (e) { notifySaveError(e); }
};

window._bstRemoveImage = async (id) => {
  try {
    const col = window._bstCurrentCol || 'bestiary';
    await updateInCol(col, id, { imageUrl: '' });
    const idx = _creatures.findIndex(c => c.id === id);
    if (idx >= 0) _creatures[idx].imageUrl = '';
    _bstCropper?.destroy(); _bstCropper = null;
    closeModal();
    _syncActivePanel();
    showNotif('Image retirée.', 'success');
  } catch (e) { notifySaveError(e); }
};

// ──────────────────────────────────────────────────────────────────────────────
// HANDLERS DE DÉLÉGATION — chaque entrée lit ses paramètres dans `el.dataset`
// et appelle la fonction existante. Les fonctions restent sur `window` tant que
// d'autres features (legacy) peuvent encore les invoquer.
// ──────────────────────────────────────────────────────────────────────────────
Object.assign(bstHandlers, {
  // Galerie / navigation
  open:           (el) => window._bstOpen(el.dataset.id),
  close:          ()   => window._bstClose(),
  createDraft:    ()   => window._bstCreateDraft(),
  switchBest:     (el) => window._bstSwitchBestiaire(el.dataset.id),
  createBest:     ()   => window._bstCreateBestiaire(),
  setRang:        (el) => window._bstSetRang(el.dataset.rang),
  setType:        (el) => window._bstSetType(el.dataset.type),
  search:         (el) => window._bstSearchInput(el.value),
  viewAs:         (el) => window._bstViewAs(el.dataset.uid || ''),

  // Panneau admin : édition inline
  updateNom:      (el) => window._bstUpdateNom(el.dataset.id, el.value),
  update:         (el) => window._bstUpdate(el.dataset.id, el.dataset.field, el.value),
  updateNum:      (el) => window._bstUpdateNum(el.dataset.id, el.dataset.field, el.value),
  updateCarac:    (el) => window._bstUpdateCarac(el.dataset.id, el.dataset.key, el.value),
  selectRang:     (el) => window._bstSelectRangPanel(el.dataset.id, el.dataset.rang),
  toggleHidden:   (el) => window._bstToggleHidden(el.dataset.id),
  toggleDmg:      (el) => window._bstToggleDmg(el.dataset.id, el.dataset.key, el.dataset.tid),
  syncDmgConfl:   ()   => window._bstSyncDmgConflicts(),
  focusInput:     (el) => el.querySelector('input')?.focus(),

  // Vue joueur : estimations / déductions
  setStat:        (el) => window._bstSetStat(el.dataset.id, el.dataset.key, el.value),
  setDeduction:   (el) => window._bstSetDeduction(el.dataset.id, el.dataset.key, el.value),

  // Sections dynamiques (armes / actions / traits / butins)
  addArme:        (el) => window._bstAddArme(el.dataset.id),
  saveArmes:      (el) => window._bstSaveArmes(el.dataset.id),
  removeArme:     (el) => window._bstRemoveArme(el.dataset.id, el),
  addAction:      ()   => window._bstAddAction(),
  editAction:     (el) => window._bstEditAction(parseInt(el.dataset.idx)),
  removeAction:   (el) => window._bstRemoveAction(parseInt(el.dataset.idx)),
  addRow:         (el) => window._bstAddPanelRow(el.dataset.id, el.dataset.type),
  saveArr:        (el) => window._bstSaveArr(el.dataset.id, el.dataset.type),
  removeRow:      (el) => window._bstRemovePanelRow(el.dataset.id, el.dataset.type, el),

  // Picker de butin (délégation au composant partagé shop-picker.js — pas de handlers locaux)
  pickerOpen:     (el) => window._bstButinPickerOpen(el.dataset.id),

  // Image
  openImage:      (el) => window.openBeastImageModal(el.dataset.id),
  saveImage:      (el) => window._bstSaveImage(el.dataset.id),
  removeImage:    (el) => window._bstRemoveImage(el.dataset.id),

  // Suppression créature
  deleteBeast:    (el, ev) => { ev?.stopPropagation?.(); deleteBeast(el.dataset.id); },
});

Object.assign(window, {
  renderBestiary,
  openBeastImageModal,
  deleteBeast,
});
