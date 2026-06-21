// ══════════════════════════════════════════════════════════════════════════════
// BESTIARY.JS — Le Bestiaire
// ✓ Admin : CRUD créatures, image+crop, attaques/traits/butins dynamiques
// ✓ Joueur : galerie + suivi personnel (PV/PM live, notes)
// ══════════════════════════════════════════════════════════════════════════════
import { loadCollection, getCachedCollection, loadChars, addToCol, updateInCol, getDocData, saveDoc } from '../data/firestore.js';
import { trySave, confirmDelete, tryDoc } from '../shared/crud.js';
import { watchPageCollection, watchPageDoc } from '../shared/realtime.js';
import { openModal, closeModal, pushModal, popModal, confirmModal, promptModal } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import PAGES from './pages.js';
import { _esc, _norm, _searchIncludes } from '../shared/html.js';
import { loadDamageTypes } from '../shared/damage-types.js';
import { sortCharactersForDisplay, modStr } from '../shared/char-stats.js';
import { attachDropAndCrop } from '../shared/image-crop.js';
import { openShopPicker, getRareteColor } from '../shared/shop-picker.js';
import { bindScopedActions } from '../shared/scoped-actions.js';
import Sortable from '../vendor/sortable.esm.js';
import { makeSortable } from '../shared/sortable-helper.js';
import { spellActionCardHtml } from '../shared/spell-action-card.js';
import { DAMAGE_RELATIONS } from '../shared/damage-profile.js';

// ══════════════════════════════════════════════════════════════════════════════
// DÉLÉGATION D'ÉVÉNEMENTS — remplace les onclick/oninput/onchange inline
// Pattern : <button data-bst-action="open" data-id="…">…</button>
// + bstHandlers.open = (el) => _bstOpen(el.dataset.id)
// Un seul listener par type d'événement, idempotent, scope module.
// ══════════════════════════════════════════════════════════════════════════════
const bstHandlers = {};
bindScopedActions('bst', bstHandlers);

// ── État local ────────────────────────────────────────────────────────────────
let _bstCropper = null;
const STORE = {
  creatures:     [],      // liste des créatures du bestiaire actif
  tracker:       {},      // { [creatureId]: { pvActuel, pmActuel, notes, deductions } }
  damageTypes:   null,    // types de dégâts (chargés au premier affichage)
  searchVal:     '',
  filterType:    '',      // filtre par type de créature
  filterRang:    '',      // filtre par rang (classique, elite, boss)
  activeId:      null,    // créature ouverte dans le panneau
  bestiaireId:   'main',  // id du bestiaire actif
  currentCol:    'bestiary',
  bestiaireList: [{ id: 'main', label: 'Bestiaire principal' }],
  viewAsUid:     null,    // admin : voir le bestiaire d'un joueur
  _authUid:      null,    // uid de la session courante — détecte un changement de compte
  playersList:   [],      // [{ uid, pseudo }] peuplé côté admin
};


let _bstSortable = null;
let _bstDragBlockClick = false;
let _bstClickGuardInstalled = false;
let _bstReordering = false;

// Vue "MJ" effective : admin ET pas en train de consulter un joueur.
// Quand l'admin bascule sur un joueur, on rend exactement comme côté joueur
// pour pouvoir voir/modifier ses estimations.
function _isViewingPlayer() {
  return STATE.isAdmin && STORE.viewAsUid && STORE.viewAsUid !== STATE.user?.uid;
}
function _isAdminView() {
  return STATE.isAdmin && !_isViewingPlayer();
}

function _bstOrderValue(c) {
  const n = Number(c?.ordre);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function _bstCompareCreatures(a, b) {
  const oa = _bstOrderValue(a);
  const ob = _bstOrderValue(b);
  if (oa !== ob) return oa - ob;
  return (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' });
}

function _bstNextOrderIndex() {
  const orders = STORE.creatures
    .map(c => Number(c?.ordre))
    .filter(Number.isFinite);
  return orders.length ? Math.max(...orders) + 1 : STORE.creatures.length;
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
  const c = STORE.creatures.find(x => x.id === cid);
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
  return mod;
}

function _bstActionsPersist() {
  if (!_bstActionsCreatureId) return;
  _bstQueueSave(_bstActionsCreatureId, { actions: _bstActionsCache, attaques: [] });
  const c = STORE.creatures.find(x => x.id === _bstActionsCreatureId);
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
  return spellActionCardHtml(act, idx, {
    className: 'bst-action-card',
    actionAttr: 'data-bst-action',
  });
}

function _bstRenderActionsList() {
  if (!_bstActionsCache.length) {
    return `<div class="bst-actions-empty">Aucune action — clique sur ＋ Ajouter pour ouvrir l'éditeur de sort.</div>`;
  }
  return _bstActionsCache.map((a,i) => _bstRenderActionCard(a,i)).join('');
}

async function _bstAddAction() {
  const mod = await _bstEnsureSpellsModule();
  if (typeof mod.addItemSpell !== 'function') { showNotif('Module sorts indisponible', 'error'); return; }
  const c = STORE.creatures.find(x => x.id === _bstActionsCreatureId);
  if (!c) return;
  const charForCalc = _bstCreatureToChar(c, _bstActionsArmeIdCtx);
  const fakeItem = { actions: _bstActionsCache, nom: c.nom || 'Créature' };
  mod.addItemSpell(fakeItem, async (updatedItem) => {
    _bstActionsCache = Array.isArray(updatedItem?.actions) ? updatedItem.actions.map(a => ({...a})) : [];
    _bstActionsPersist();
    _bstRefreshActionsHost();
  }, charForCalc);
}

async function _bstEditAction(idx) {
  const mod = await _bstEnsureSpellsModule();
  if (typeof mod.editItemSpell !== 'function') { showNotif('Module sorts indisponible', 'error'); return; }
  const c = STORE.creatures.find(x => x.id === _bstActionsCreatureId);
  if (!c) return;
  const charForCalc = _bstCreatureToChar(c, _bstActionsArmeIdCtx);
  const fakeItem = { actions: _bstActionsCache, nom: c.nom || 'Créature' };
  mod.editItemSpell(fakeItem, idx, async (updatedItem) => {
    _bstActionsCache = Array.isArray(updatedItem?.actions) ? updatedItem.actions.map(a => ({...a})) : [];
    _bstActionsPersist();
    _bstRefreshActionsHost();
  }, charForCalc);
}

async function _bstRemoveAction(idx) {
  if (!Number.isFinite(idx) || !_bstActionsCache[idx]) return;
  if (!await confirmModal('Supprimer cette action ?', { title: 'Action', confirmLabel: 'Supprimer' })) return;
  _bstActionsCache.splice(idx, 1);
  _bstActionsPersist();
  _bstRefreshActionsHost();
}

// ── Armes naturelles : édition inline ─────────────────────────────────────────
function _bstRenderArmeRow(a = {}, cid, idx) {
  const optsHTML = (sel) => _BST_STAT_OPTIONS.map(s =>
    `<option value="${s.key}"${sel===s.key?' selected':''}>${s.short}</option>`).join('');
  // Note : tous les inputs/selects sauvent via la délégation `saveArmes`. L'attribut
  // `data-bst-on` filtre l'event (sinon le click de focus déclencherait aussi).
  const inputAttrs  = `data-bst-action="saveArmes" data-bst-on="input"  data-id="${cid}"`;
  const selectAttrs = `data-bst-action="saveArmes" data-bst-on="change" data-id="${cid}"`;
  return `<div class="bst-p-row bst-arme-card" data-arme-id="${a.id || ''}">
    <!-- Ligne 1 : nom · formule de dés · supprimer -->
    <div class="bst-arme-head">
      <input class="bst-p-input bst-arme-nom" data-f="nom" placeholder="Nom (Griffes, Morsure…)"
        value="${_esc(a.nom||'')}" ${inputAttrs}>
      <input class="bst-p-input bst-arme-dice" data-f="degats" placeholder="⚔️ 1d8+2"
        value="${_esc(a.degats||'')}" ${inputAttrs}>
      <button class="bst-p-row-remove" data-bst-action="removeArme" data-id="${cid}" title="Retirer">✕</button>
    </div>

    <!-- Ligne 2 : groupes Dégâts / Toucher (stat + bonus côte à côte) -->
    <div class="bst-arme-duo">
      <div class="bst-arme-grp">
        <div class="bst-arme-grp-hd">⚔️ Dégâts</div>
        <div class="bst-arme-grp-fields">
          <select class="bst-p-input" data-f="degatsStat" title="Statistique de dégâts" ${selectAttrs}>${optsHTML(a.degatsStat || 'force')}</select>
          <input class="bst-p-input" data-f="degatsFlat" type="number" placeholder="+0"
            title="Bonus fixe aux dégâts" value="${a.degatsFlat ?? ''}" ${inputAttrs}>
        </div>
      </div>
      <div class="bst-arme-grp">
        <div class="bst-arme-grp-hd">🎯 Toucher</div>
        <div class="bst-arme-grp-fields">
          <select class="bst-p-input" data-f="toucherStat" title="Statistique de toucher" ${selectAttrs} ${a.toucherAuto ? 'disabled' : ''}>${optsHTML(a.toucherStat || a.degatsStat || 'force')}</select>
          <input class="bst-p-input" data-f="toucherFlat" type="number" placeholder="+0"
            title="Bonus fixe au toucher" value="${a.toucherFlat ?? ''}" ${inputAttrs} ${a.toucherAuto ? 'disabled' : ''}>
        </div>
      </div>
    </div>

    <!-- Toucher automatique : pleine largeur sous le duo Dégâts/Toucher -->
    <label class="bst-arme-auto${a.toucherAuto ? ' is-on' : ''}" title="L'attaque touche automatiquement (aucun jet de toucher). Les dégâts restent normaux.">
      <input type="checkbox" data-f="toucherAuto" ${a.toucherAuto ? 'checked' : ''} ${selectAttrs}>
      <span>🎯 Toucher automatique</span>
      <span class="bst-arme-auto-hint">— touche toujours, dégâts normaux</span>
    </label>

    <!-- Ligne 3 : portée · format · type de dégâts -->
    <div class="bst-arme-trio">
      <label class="bst-p-mini">Portée
        <input class="bst-p-input" data-f="portee" placeholder="Contact, 9m"
          value="${_esc(a.portee||'')}" ${inputAttrs}>
      </label>
      <label class="bst-p-mini">Format
        <select class="bst-p-input" data-f="format" ${selectAttrs}>
          <option value="physique"${(a.format||'physique')==='physique'?' selected':''}>⚔️ Physique</option>
          <option value="magique"${a.format==='magique'?' selected':''}>✨ Magique</option>
        </select>
      </label>
      <label class="bst-p-mini" title="Type de dégâts (défini dans la console MJ). Un type magique applique ses règles (ex : ½ dégâts) côté VTT.">Type de dégâts
        <select class="bst-p-input" data-f="damageTypeId" ${selectAttrs}>
          ${(STORE.damageTypes || []).map(t =>
            `<option value="${t.id}"${(a.damageTypeId||'physique')===t.id?' selected':''}>${t.icon||''} ${_esc(t.label)}</option>`).join('')}
        </select>
      </label>
    </div>

    <!-- Ligne 4 : effet complémentaire -->
    <input class="bst-p-input bst-arme-info" data-f="info"
      placeholder="ℹ️ Effet complémentaire — ex : « Si touche, applique Poison »"
      value="${_esc(a.info||'')}" ${inputAttrs}>
  </div>`;
}

function _bstAddArme(cid) {
  const host = document.getElementById(`bst-p-armes-${cid}`);
  if (!host) return;
  const c = STORE.creatures.find(x => x.id === cid);
  const armes = Array.isArray(c?.armesNaturelles) ? [...c.armesNaturelles] : [];
  armes.push({ id: _bstUuid(), nom:'', degats:'', degatsStat:'force', toucherStat:'force', toucherAuto:false, portee:'', format:'physique', damageTypeId:'physique', info:'' });
  if (c) c.armesNaturelles = armes;
  host.innerHTML = armes.map((a,i) => _bstRenderArmeRow(a, cid, i)).join('');
  _bstQueueSave(cid, { armesNaturelles: armes });
}

function _bstRemoveArme(cid, btn) {
  const row = btn?.closest?.('.bst-p-row'); if (!row) return;
  row.remove();
  _bstSaveArmes(cid);
}

function _bstSaveArmes(cid) {
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
      toucherAuto: r.querySelector('[data-f=toucherAuto]')?.checked || false,
      portee:      r.querySelector('[data-f=portee]')?.value?.trim() || '',
      format:      r.querySelector('[data-f=format]')?.value || 'physique',
      damageTypeId: r.querySelector('[data-f=damageTypeId]')?.value || 'physique',
      info:        r.querySelector('[data-f=info]')?.value?.trim() || '',
    };
  }).filter(a => a.nom || a.degats);
  const c = STORE.creatures.find(x => x.id === cid);
  if (c) c.armesNaturelles = armes;
  _bstQueueSave(cid, { armesNaturelles: armes });
  // Si l'arme contextuelle a disparu, on prend la première dispo
  if (cid === _bstActionsCreatureId && !armes.find(a => a.id === _bstActionsArmeIdCtx)) {
    _bstActionsArmeIdCtx = armes[0]?.id || null;
  }
}

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

function _beastMatchesFilters(c, { search = STORE.searchVal, type = STORE.filterType, rang = STORE.filterRang } = {}) {
  const q = _norm(search);
  const fType = _norm(type);
  const fRang = _norm(rang);
  const matchSearch = !q || _searchIncludes(_beastSearchText(c), search);
  const matchType = !fType || _norm(c.type) === fType;
  const matchRang = !fRang || _norm(c.rang || 'classique') === fRang;
  return matchSearch && matchType && matchRang;
}

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
      <span style="font-size:.62rem;color:var(--text-dim);margin-left:auto">${rel.shortLabel}</span>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:.3rem">
      ${ids.map(id => _damageTypeBadge(id, types, rel.color)).join('')}
    </div>
  </div>`;
}

function _renderDamageProfile(beast, types) {
  if (!beast) return '';
  const cards = DAMAGE_RELATIONS.map(rel => {
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
        <span class="bst-dmg-rule">${rel.shortLabel}</span>
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
  const parts = DAMAGE_RELATIONS
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
  const col = STORE.currentCol || 'bestiary';
  const ids = Object.keys(_bstPending);
  if (!ids.length) return;
  ids.forEach(id => {
    const patch = _bstPending[id];
    delete _bstPending[id];
    updateInCol(col, id, patch)
      .then(() => {
        const idx = STORE.creatures.findIndex(c => c.id === id);
        if (idx >= 0) Object.assign(STORE.creatures[idx], patch);
      })
      .catch(notifySaveError);
  });
}

function _bstQueueSave(id, patch) {
  _bstPending[id] = { ...(_bstPending[id] || {}), ...patch };
  clearTimeout(_bstSaveTimer);
  _bstSaveTimer = setTimeout(_bstFlushSaves, 1200);
}

// Auto-save générique (texte / select)
function _bstUpdate(id, field, val) { _bstQueueSave(id, { [field]: val }); }
function _bstUpdateNum(id, field, val) { _bstQueueSave(id, { [field]: parseInt(val) || 0 }); }
function _bstToggleHidden(id) {
  const c = STORE.creatures.find(x => x.id === id);
  if (!c) return;
  const next = !c.hidden;
  c.hidden = next;
  _bstQueueSave(id, { hidden: next });
  // Re-render panel + cartes pour refléter le badge
  if (typeof _syncActivePanel === 'function') _syncActivePanel();
  if (typeof _render === 'function') _render();
}

// Nom : sync visuel des cartes et du hero
function _bstUpdateNom(id, val) {
  _bstQueueSave(id, { nom: val });
  document.querySelectorAll(`.bst-card[data-beast-id="${id}"] .bst-card-name`)
    .forEach(el => el.textContent = val || '?');
}

// Caracs : sauve + recalcule le modificateur affiché
function _bstUpdateCarac(id, key, val) {
  _bstQueueSave(id, { [key]: parseInt(val) || 0 });
  const n = parseInt(val);
  let txt = '', cls = 'zero';
  if (!isNaN(n)) {
    const m = Math.floor((n - 10) / 2);
    txt = modStr(m);
    cls = m > 0 ? 'pos' : m < 0 ? 'neg' : 'zero';
  }
  const modEl = document.querySelector(`[data-bst-mod="${id}-${key}"]`);
  if (modEl) { modEl.textContent = txt; modEl.className = `bst-carac-mod ${cls}`; }
}

// Changement de rang : sauve + met à jour cartes + panneau (couleurs + label)
function _bstSelectRangPanel(id, rang) {
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
}

// Toggle relation aux dégâts
function _bstToggleDmg(id, rel, typeId) {
  const c = STORE.creatures.find(x => x.id === id);
  if (!c) return;
  const set = new Set(Array.isArray(c[rel]) ? c[rel] : []);
  if (set.has(typeId)) set.delete(typeId); else set.add(typeId);
  c[rel] = [...set];
  _bstQueueSave(id, { [rel]: c[rel] });
  const chip = document.querySelector(`[data-dmg-chip="${id}-${rel}-${typeId}"]`);
  if (chip) {
    const active = set.has(typeId);
    const meta = DAMAGE_RELATIONS.find(r => r.key === rel);
    chip.classList.toggle('active', active);
    chip.style.color       = active ? meta.color : '';
    chip.style.borderColor = active ? meta.color : '';
    chip.style.background  = active ? `${meta.color}1a` : '';
  }
}

// Lecture + save d'un tableau dynamique (traits / butins) depuis le panneau.
// Les attaques sont gérées via `actions` + `armesNaturelles` ailleurs.
function _bstSaveArr(id, type) {
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
    const creature = STORE.creatures.find(x => x.id === id);
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
}

function _bstAddPanelRow(id, type) {
  const container = document.getElementById(`bst-p-${type}-${id}`);
  if (!container) return;
  // Seules les sections "traits" passent ici. Les butins ont leur propre picker,
  // les armes naturelles et actions ont leurs handlers dédiés.
  if (type !== 'traits') return;
  const i = container.querySelectorAll('.bst-p-row').length;
  const tpl = document.createElement('div');
  tpl.innerHTML = _panelTraitRow({}, id, i).trim();
  container.appendChild(tpl.firstElementChild);
}

function _bstRemovePanelRow(id, type, btn) {
  const row = btn?.closest?.('.bst-p-row');
  if (!row) return;
  row.remove();
  _bstSaveArr(id, type);
}

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
async function _bstButinPickerOpen(creatureId) {
  if (!creatureId) return;
  const c = STORE.creatures.find(x => x.id === creatureId);
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
}

// Matrice de relations aux dégâts (panneau, version chips compacte)
function _renderDamageMatrixPanel(c, types) {
  return `<div class="bst-section">
    <div class="bst-section-title">🛡️ Relations aux dégâts</div>
    <div class="bst-dmg-edit">
      ${DAMAGE_RELATIONS.map(rel => {
        const active = Array.isArray(c[rel.key]) ? c[rel.key] : [];
        return `<div class="bst-dmg-edit-row" style="border-left:3px solid ${rel.color};background:${rel.color}08">
          <div class="bst-dmg-edit-head">
            <span class="bst-dmg-icon">${rel.icon}</span>
            <span class="bst-dmg-name" style="color:${rel.color}">${rel.label}</span>
            <span class="bst-dmg-rule">${rel.shortLabel}</span>
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
  const rels = DAMAGE_RELATIONS;

  const headerCells = rels.map(rel =>
    `<div style="text-align:center;padding:.5rem .25rem;font-size:.66rem;font-weight:700;color:${rel.color};
      border-left:1px solid var(--border);background:${rel.color}10">
      <div style="font-size:1rem;line-height:1">${rel.icon}</div>
      <div style="margin-top:.2rem;letter-spacing:.02em">${_esc(rel.label.replace(/s$/, '.'))}</div>
      <div style="font-size:.55rem;font-weight:400;color:var(--text-dim);margin-top:.05rem">${rel.shortLabel}</div>
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
function _bstSyncDmgConflicts() {
  const matrix = document.querySelector('[data-bst-matrix]');
  if (!matrix) return;
  const counts = new Map();
  matrix.querySelectorAll('input[type=checkbox]:checked').forEach(cb => {
    counts.set(cb.value, (counts.get(cb.value) || 0) + 1);
  });
  matrix.querySelectorAll('[data-bst-cell]').forEach(cell => {
    const cb = cell.querySelector('input[type=checkbox]');
    const checked = !!cb?.checked;
    const rel = DAMAGE_RELATIONS.find(r => r.key === cell.dataset.bstRel);
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
}

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
    data-hov-bg="rgba(255,255,255,.04)">
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
      active:    !STORE.viewAsUid,
      ringColor: 'var(--gold)',
      uid:       '',
      imageUrl:  '',
      fallback:  '👑',
      pseudo:    'MJ',
      charNom:   '',
    })}
    <div style="width:1px;align-self:stretch;background:var(--border);margin:0 .15rem"></div>
    ${STORE.playersList.map(p => _avatarTile({
      active:    STORE.viewAsUid === p.uid,
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
export async function renderBestiary() {
  const content = document.getElementById('main-content');
  content.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-dim)"><div style="font-size:2rem">⏳</div></div>`;

  // SÉCURITÉ : la vue "bestiaire d'un joueur" (viewAsUid) ne doit JAMAIS persister
  // hors d'une session admin ni à travers un changement de compte. L'app est une
  // SPA (pas de reload au login) → sans ce reset, l'uid d'un joueur précédemment
  // consulté en MJ resterait collé et ses estimations seraient écrasées par le
  // compte suivant.
  if (!STATE.isAdmin || STORE._authUid !== STATE.user?.uid) STORE.viewAsUid = null;
  STORE._authUid = STATE.user?.uid || null;

  // Admin : charger la liste des bestiaires disponibles
  if (STATE.isAdmin) {
    const meta = await getDocData('bestiary_meta', 'list');
    const list = meta?.list || [];
    if (!list.find(b => b.id === 'main')) list.unshift({ id:'main', label:'Bestiaire principal' });
    STORE.bestiaireList = list;

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
    // Itère sur la liste triée → le perso ★ par défaut est rencontré en premier
    // pour chaque uid, et devient donc le "visage" du joueur.
    sortCharactersForDisplay(chars || []).forEach(c => {
      if (!c?.uid || c.uid === STATE.user?.uid) return;
      const pseudo = c.ownerPseudo || c.nom || c.uid;
      const photo  = c.photoURL || c.photo || c.avatar || c.portraitUrl || c.imageUrl || '';
      const existing = seen.get(c.uid);
      // Le premier rencontré (★ par défaut) gagne, sauf si lui n'a pas de photo
      // et qu'un autre en a une.
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
    STORE.playersList = [...seen.values()]
      .sort((a,b) => a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity:'base' }));
  }

  // Bestiaire actif — hydraté depuis le cache TTL (instant si chaud) puis
  // tenu à jour par le watch ci-dessous.
  const col = STORE.bestiaireId === 'main' ? 'bestiary' : `bestiary_${STORE.bestiaireId}`;
  STORE.tracker = {};
  STORE.currentCol = col;

  if (!STORE.damageTypes) STORE.damageTypes = await loadDamageTypes();

  const cachedCreatures = getCachedCollection(col);
  _bstApplyData(cachedCreatures || []);
  _render();

  const trackerUid = (STATE.isAdmin && STORE.viewAsUid) || STATE.user?.uid;

  // ── Abonnements temps réel ─────────────────────────────────────────────
  // Les noms 'bst-creatures'/'bst-tracker' sont réutilisés : si l'admin
  // switche de bestiaire/viewAs, watch() kill l'ancien listener et crée
  // le nouveau sur la bonne collection / doc.
  watchPageCollection('bst-creatures', col, 'bestiaire', data => {
    if (_bstShouldSkipLiveRender()) return;
    _bstApplyData(data);
    if (_bstSig() === _bstRenderSig) return;
    _render();
  });

  if (trackerUid) {
    watchPageDoc('bst-tracker', 'bestiary_tracker', trackerUid, 'bestiaire', doc => {
      if (_bstShouldSkipLiveRender()) return;
      STORE.tracker = doc?.data || {};
      if (_bstSig() === _bstRenderSig) return;
      _render();
    });
  }
}

// Applique une liste fraîche à STORE.creatures : filtre les `hidden` pour les
// joueurs et trie par ordre manuel puis par nom. Source unique utilisée par le watch et l'hydratation
// — toute logique de mise à jour de la liste doit passer par ici.
function _bstApplyData(all) {
  const arr = all || [];
  STORE.creatures = (STATE.isAdmin ? [...arr] : arr.filter(c => !c.hidden))
    .sort(_bstCompareCreatures);
}

// Re-charge STORE.creatures depuis loadCollection (cache TTL en mémoire patché par
// addToCol/updateInCol/deleteFromCol, sinon IndexedDB Firestore). Sert à
// rester cohérent juste après une opération CRUD, sans dépendre du timing du
// watch (qui peut être skippé si un input du panneau précédent a le focus).
async function _bstHydrate() {
  const col = STORE.currentCol || 'bestiary';
  _bstApplyData(await loadCollection(col));
}

// ── Drag & drop : ordre manuel partagé ───────────────────────────────────────
function _installBestiaryClickGuard() {
  if (_bstClickGuardInstalled) return;
  _bstClickGuardInstalled = true;
  document.addEventListener('click', (e) => {
    if (!_bstDragBlockClick) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);
}

function _finishBestiaryDrag() {
  document.body.classList.remove('bst-dragging');
  setTimeout(() => { _bstDragBlockClick = false; }, 350);
}

function _destroyBestiarySortable() {
  _bstSortable?.destroy();
  _bstSortable = null;
}

function _visibleBestiaryCardIds(grid) {
  return [...(grid || document).querySelectorAll('.bst-card[data-beast-id]')]
    .filter(el => el.offsetParent !== null && el.style.display !== 'none')
    .map(el => el.dataset.beastId)
    .filter(Boolean);
}

function _mergeBestiaryVisibleOrder(visibleOrder) {
  const next = STORE.creatures.map(c => c.id);
  const visibleSet = new Set(visibleOrder);
  let i = 0;
  return next.map(id => visibleSet.has(id) ? visibleOrder[i++] : id);
}

async function _persistBestiaryManualOrder(visibleOrder) {
  if (!_isAdminView() || !visibleOrder.length) return false;
  const col = STORE.currentCol || 'bestiary';
  const fullOrder = _mergeBestiaryVisibleOrder(visibleOrder);
  const orderById = new Map(fullOrder.map((id, idx) => [id, idx]));
  const saves = [];

  STORE.creatures = STORE.creatures.map(c => {
    const ordre = orderById.get(c.id);
    if (ordre === undefined) return c;
    if (Number(c.ordre) !== ordre) saves.push(updateInCol(col, c.id, { ordre }));
    return { ...c, ordre };
  }).sort(_bstCompareCreatures);

  if (!saves.length) return false;
  await Promise.all(saves);
  return true;
}

function _mountBestiarySortable() {
  _destroyBestiarySortable();
  if (!_isAdminView()) return;

  const grid = document.querySelector('.bst-grid.bst-sortable');
  if (!grid) return;

  _installBestiaryClickGuard();
  _bstSortable = makeSortable(grid, {
    prefix: 'bst',
    animation: 120,
    draggable: '.bst-sortable-item',
    onStart: () => {
      document.body.classList.add('bst-dragging');
      _bstDragBlockClick = true;
    },
    onEnd: async (evt) => {
      if (evt.oldIndex === evt.newIndex && evt.from === evt.to) {
        _finishBestiaryDrag();
        return;
      }

      const visibleOrder = _visibleBestiaryCardIds(grid);
      _bstReordering = true;
      _finishBestiaryDrag();

      try {
        const changed = await _persistBestiaryManualOrder(visibleOrder);
        if (changed) showNotif('Ordre du bestiaire sauvegardé.', 'success');
        _render();
      } catch (err) {
        notifySaveError(err);
        await _bstHydrate();
        _render();
      } finally {
        _bstReordering = false;
      }
    },
  });
}

// Signature des données qui pilotent le rendu de la page (cartes + panneau
// joueur). Mise à jour par _render à la fin, comparée par les watchers
// onSnapshot avant de re-rendre : un fire qui n'apporte aucun changement
// (cache → serveur, hydratation → 1er fire) ne reconstruit pas le DOM et
// les cartes ne clignotent pas.
let _bstRenderSig = '';
// Sérialisation stable (clés triées récursivement) : Firestore renvoie les clés
// de map triées alphabétiquement alors que l'objet local est en ordre d'insertion.
// Sans ça, l'écho d'une écriture créant de nouvelles clés (1re estimation saisie)
// produirait une signature différente → _render() inutile → scroll qui remonte.
function _stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(_stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + _stableStringify(v[k])).join(',') + '}';
}
function _bstSig() { return JSON.stringify(STORE.creatures) + '|' + _stableStringify(STORE.tracker); }

// Évite d'écraser une édition admin en cours : la fiche du panneau a des
// inputs/textarea avec auto-save debouncé (_bstQueueSave 400ms). Si on
// re-render alors qu'un champ est focus, le curseur saute. On préfère
// attendre le prochain snapshot (qui arrivera après la sauvegarde).
function _bstShouldSkipLiveRender() {
  if (_bstReordering || document.body.classList.contains('bst-dragging')) return true;
  const ae = document.activeElement;
  if (!ae) return false;
  const tag = ae.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !ae.isContentEditable) return false;
  const main = document.getElementById('main-content');
  return !!(main && main.contains(ae));
}

// ── Création rapide d'une créature sans modal ──────────────────────────────────
async function _bstCreateDraft() {
  if (!STATE.isAdmin) return;
  const col = STORE.currentCol || 'bestiary';
  const data = {
    nom: 'Nouvelle créature', emoji: '🐲', rang: 'classique',
    type: '', environnement: '', niveau: 0, dangerositeXp: 0,
    pvMax: 0, pmMax: 0, ca: 0, vitesse: 0, initiative: 0,
    force: 0, dexterite: 0, constitution: 0, intelligence: 0, sagesse: 0, charisme: 0,
    tokenW: 1, tokenH: 1, imageUrl: '', description: '',
    resistances: [], immunites: [], absorptions: [], faiblesses: [],
    armesNaturelles: [], actions: [], traits: [], butins: [],
    ordre: _bstNextOrderIndex(),
  };
  try {
    const newId = await addToCol(col, data);
    await _bstHydrate();
    STORE.activeId = newId;
    _render();
    setTimeout(() => {
      const nameInput = document.querySelector('.bst-panel-name-input');
      nameInput?.focus();
      nameInput?.select();
    }, 50);
  } catch (e) { notifySaveError(e); }
};

let _bstRenderedActiveId = null;

function _render() {
  const content = document.getElementById('main-content');

  // Préserve le scroll quand on re-rend le MÊME panneau ouvert (ex. saisie d'une
  // estimation → write tracker → echo du watch → _render). Sans ça, le rebuild
  // innerHTML remet le panneau (et la page) tout en haut à chaque blur d'input.
  // main-content scrolle sur mobile (overflow auto), la fenêtre scrolle sur desktop :
  // on capture les deux, on restaure les deux (la valeur nulle est sans effet).
  const sameActive    = STORE.activeId && STORE.activeId === _bstRenderedActiveId;
  const prevSlotTop   = sameActive ? (content.querySelector('.bst-panel-slot')?.scrollTop || 0) : 0;
  const prevContentTop= sameActive ? (content.scrollTop || 0) : 0;
  const prevWinTop    = sameActive ? (window.scrollY || 0) : 0;

  const allTypes = [...new Set(STORE.creatures.map(c => c.type||'').filter(Boolean))].sort();
  const filtered = STORE.creatures.filter(c => _beastMatchesFilters(c));

  // Comptes par rang (total, sans filtre rang)
  const byRang = { classique:0, elite:0, boss:0 };
  STORE.creatures.forEach(c => { const r = c.rang||'classique'; if (byRang[r]!==undefined) byRang[r]++; });

  const ribbonData = [
    { label:'Total',    icon:'🐾', count:STORE.creatures.length, c:'#7eb0ff',              filter:'' },
    { label:'Classique',icon:'◆',  count:byRang.classique,  c:RANG_STYLE.classique.color, filter:'classique' },
    { label:'Élite',    icon:'★',  count:byRang.elite,      c:RANG_STYLE.elite.color,     filter:'elite'     },
    { label:'Boss',     icon:'☠',  count:byRang.boss,       c:RANG_STYLE.boss.color,      filter:'boss'      },
  ];

  const bstList = STORE.bestiaireList || [{ id:'main', label:'Bestiaire principal' }];
  const tabsHtml = STATE.isAdmin ? `
    <div class="bst-tabs">
      ${bstList.map(b => `
        <button class="bst-tab${b.id===STORE.bestiaireId?' active':''}" data-bst-action="switchBest" data-id="${b.id}">
          📜 ${_esc(b.label)}
        </button>`).join('')}
      <button class="bst-tab add" data-bst-action="createBest">+ Nouveau</button>
    </div>` : '';

  content.innerHTML = `
  <div class="bst-page ${STORE.activeId ? 'has-panel' : 'no-panel'}">

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
        <div class="bst-ribbon-item${(!r.filter && !STORE.filterRang)||(r.filter && STORE.filterRang===r.filter)?' active':''}"
          style="--c:${r.c}"
          data-bst-action="setRang" data-rang="${r.filter}">
          <div class="bst-ribbon-icon">${r.icon}</div>
          <div>
            <div class="bst-ribbon-num">${r.count}</div>
            <div class="bst-ribbon-lbl">${r.label}</div>
          </div>
        </div>`).join('')}
    </div>

    ${STATE.isAdmin && STORE.playersList.length ? _renderPlayerAvatars() : ''}
  </div>

  ${_isViewingPlayer() ? `
  <div style="display:flex;align-items:center;gap:.6rem;padding:.6rem 2rem;
    border-bottom:1px solid rgba(79,140,255,.2);background:rgba(79,140,255,.06)">
    <span>👁</span>
    <span style="font-size:.78rem;color:var(--text)">
      Vue du bestiaire de <strong style="color:#4f8cff">${_esc(STORE.playersList.find(p=>p.uid===STORE.viewAsUid)?.pseudo||'?')}</strong>
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
        value="${_esc(STORE.searchVal)}"
        data-bst-action="search" data-bst-on="input"
        style="background:none;border:none;outline:none;color:var(--text);font-size:.8rem;flex:1;min-width:0">
    </div>
    <div class="chip-row">
      <button class="chip${!STORE.filterType?' active':''}" data-bst-action="setType" data-type="">Tous</button>
      ${allTypes.map(t => `
        <button class="chip${_norm(STORE.filterType)===_norm(t)?' active':''}"
          data-bst-action="setType" data-type="${_esc(t)}">
          ${_esc(t)}
        </button>`).join('')}
    </div>
    ${STATE.isAdmin ? `<button class="btn btn-outline btn-sm" style="white-space:nowrap;flex-shrink:0" data-bst-action="exportBeasts" title="Exporter toutes les créatures en document (.html imprimable)">📄 Exporter</button>` : ''}
    ${STATE.isAdmin ? `<button class="btn btn-gold btn-sm" style="white-space:nowrap;flex-shrink:0" data-bst-action="createDraft">+ Créature</button>` : ''}
  </div>

  <!-- ═ LAYOUT ═══════════════════════════════════════════════════════════════ -->
  <div class="bst-layout ${STORE.activeId ? 'has-panel' : 'no-panel'}">
    <div class="bst-grid-wrap">
      ${filtered.length === 0 ? `
        <div class="bst-empty">
          <div class="bst-empty-icon">🐉</div>
          <div class="bst-empty-title">${STORE.creatures.length===0 ? 'Aucune créature dans le bestiaire' : 'Aucun résultat'}</div>
          <div class="bst-empty-sub">${STORE.creatures.length===0 ? 'Ajoutez la première créature pour commencer.' : 'Essayez un filtre différent.'}</div>
          ${STATE.isAdmin && STORE.creatures.length===0 ? `<button class="btn btn-outline btn-sm" style="margin-top:1rem" data-bst-action="createDraft">+ Ajouter la première créature</button>` : ''}
        </div>` : `
        <div class="bst-grid${_isAdminView() ? ' bst-sortable' : ''}">
          ${filtered.map(c => _renderCard(c)).join('')}
        </div>`}
    </div>

    <div class="bst-panel-slot">
      ${STORE.activeId ? _renderPanel(STORE.creatures.find(c => c.id === STORE.activeId)) : ''}
    </div>
  </div>
  </div>`;

  _mountBestiarySortable();

  // Restaure le scroll préservé (cf. plus haut).
  if (sameActive) {
    const slot = content.querySelector('.bst-panel-slot');
    if (slot && prevSlotTop) slot.scrollTop = prevSlotTop;
    if (prevContentTop) content.scrollTop = prevContentTop;
    if (prevWinTop) window.scrollTo(0, prevWinTop);
  }
  _bstRenderedActiveId = STORE.activeId;
  _bstRenderSig = _bstSig();
}

// ── Card créature ─────────────────────────────────────────────────────────────
function _renderCard(c) {
  const isActive = c.id === STORE.activeId;
  const rang     = c.rang || 'classique';
  const rs       = RANG_STYLE[rang] || RANG_STYLE.classique;
  const track    = STORE.tracker[c.id] || {};

  const pvMax    = _isAdminView() ? (parseInt(c.pvMax)||0) : 0;
  const pvActuel = track.pvActuel !== undefined ? parseInt(track.pvActuel) : pvMax;
  const pvPct    = pvMax > 0 ? Math.max(0, Math.min(100, Math.round(pvActuel/pvMax*100))) : 0;

  return `<div class="bst-card${isActive?' active':''}${_isAdminView()?' bst-sortable-item':''}"
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

// Champ texte libre d'estimation joueur : <textarea> auto-dimensionné
// (field-sizing:content) au lieu d'un <input> — le texte long passe à la ligne et
// reste entièrement visible. La valeur va entre les balises (échappée).
function _bstDeductArea(val, placeholder, attrs, style = '') {
  return `<textarea class="bst-deduct-input" rows="1"${style ? ` style="${style}"` : ''} placeholder="${_esc(placeholder)}" ${attrs}>${_esc(val || '')}</textarea>`;
}

// ── Panneau détail ────────────────────────────────────────────────────────────
function _renderPanel(c) {
  if (!c) return '';
  const rang  = c.rang || 'classique';
  const rs    = RANG_STYLE[rang] || RANG_STYLE.classique;

  // MJ : panneau entièrement éditable (auto-save Firestore)
  if (_isAdminView()) return _renderPanelAdmin(c, rs);

  const track = STORE.tracker[c.id] || {};
  const ded   = track.deductions || {};

  const pvMax     = parseInt(c.pvMax)    || 0;
  const pmMax     = parseInt(c.pmMax)    || 0;
  const pvActuel  = track.pvActuel  !== undefined ? parseInt(track.pvActuel)  : null;
  const pmActuel  = track.pmActuel  !== undefined ? parseInt(track.pmActuel)  : null;
  const caEstimee = track.caEstimee !== undefined ? parseInt(track.caEstimee) : null;
  const vitEstimee= track.vitEstimee!== undefined ? parseInt(track.vitEstimee): null;
  const xpEstimee = track.xpEstimee !== undefined ? parseInt(track.xpEstimee) : null;
  const pvPct     = pvMax > 0 && pvActuel !== null ? Math.round(pvActuel / pvMax * 100) : 0;
  const pmPct     = pmMax > 0 && pmActuel !== null ? Math.round(pmActuel / pmMax * 100) : 0;

  const traits    = Array.isArray(c.traits) ? c.traits : [];
  const description = c.description == null ? '' : String(c.description);

  const mod = (val) => {
    const n = parseInt(val);
    if (!val || isNaN(n)) return null;
    return modStr(Math.floor((n - 10) / 2));
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

  const vitalsHtml = `
    <div class="bst-section">
      <div class="bst-section-title">Statistiques</div>
      <div class="bst-stats-base">
        ${_estCell('pv',  'PV',   'pvActuel',   pvActuel)}
        ${_estCell('pm',  'PM',   'pmActuel',   pmActuel)}
        ${_estCell('ca',  'CA',   'caEstimee',  caEstimee)}
        ${_estCell('vit', 'Vit.', 'vitEstimee', vitEstimee)}
        ${_estCell('init','XP',  'xpEstimee',  xpEstimee)}
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
  const dmgHtml = _isAdminView() ? _renderDamageProfile(c, STORE.damageTypes) : '';


  // ── Attaques observées (Joueur) : armes naturelles + actions ──────────────
  // Le joueur note juste ce qu'il observe au VTT (nom, toucher, dégâts, portée,
  // effet) — aucun accès au gestionnaire de runes. Indexé par id stable (fallback
  // idx). Les clés `act_*` restent rétro-compatibles ; `*_effet_*` et `arme_*` sont
  // de nouvelles clés (sans impact sur les estimations existantes).
  const _obsRow = (prefix, k) => {
    const a = (suffix) => `data-bst-action="setDeduction" data-bst-on="change" data-id="${c.id}" data-key="${prefix}_${suffix}_${k}"`;
    return `<div class="bst-atk">
      ${_bstDeductArea(ded[`${prefix}_nom_${k}`], "Nom de l'attaque…", a('nom'), 'margin-bottom:6px;font-weight:600')}
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px">
        <input class="bst-deduct-input" placeholder="🎯 Toucher" value="${_esc(ded[`${prefix}_toucher_${k}`]||'')}" ${a('toucher')}>
        <input class="bst-deduct-input" placeholder="⚔️ Dégâts"  value="${_esc(ded[`${prefix}_degats_${k}`]||'')}"  ${a('degats')}>
        <input class="bst-deduct-input" placeholder="📏 Portée"  value="${_esc(ded[`${prefix}_portee_${k}`]||'')}"  ${a('portee')}>
      </div>
      ${_bstDeductArea(ded[`${prefix}_effet_${k}`], '✨ Effet observé…', a('effet'), 'margin-top:5px')}
    </div>`;
  };

  const armesJ = Array.isArray(c.armesNaturelles) ? c.armesNaturelles : [];
  const armesJoueurHtml = !_isAdminView() && armesJ.length ? `
    <div class="bst-section">
      <div class="bst-section-title">🐾 Armes naturelles
        <span class="bst-section-count">${armesJ.length} observée${armesJ.length>1?'s':''}</span>
      </div>
      ${armesJ.map((arme, i) => _obsRow('arme', arme.id || `idx_${i}`)).join('')}
    </div>` : '';

  const actsJ = Array.isArray(c.actions) ? c.actions : [];
  const attaquesJoueurHtml = !_isAdminView() && actsJ.length ? `
    <div class="bst-section">
      <div class="bst-section-title">⚔️ Actions
        <span class="bst-section-count">${actsJ.length} observée${actsJ.length>1?'s':''}</span>
      </div>
      ${actsJ.map((act, i) => _obsRow('act', act.id || `idx_${i}`)).join('')}
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
          ${_bstDeductArea(ded['tr_nom_'+i], 'Nom du trait…', dedAttr('nom'), 'margin-bottom:5px;font-weight:600')}
          ${_bstDeductArea(ded['tr_desc_'+i], 'Description…', dedAttr('desc'))}
        </div>`;
      }).join('')}
    </div>` : '';

  // ── Butin estimé (Joueur) : objets supposés + nombre ──────────────────────
  // Le joueur ne voit pas le CONTENU des butins réels (MJ uniquement), mais on lui
  // donne autant de lignes que la créature a de butins → il sait combien d'objets
  // estimer et remplit son hypothèse pour chacun. Estimations stockées dans SON
  // tracker perso : aucun effet sur le VTT (qui ne lit que la créature).
  const _lootRows = Array.isArray(c.butins) ? c.butins.length : 0;
  const butinJoueurHtml = !_isAdminView() && _lootRows ? `
    <div class="bst-section">
      <div class="bst-section-title">🎒 Butin estimé
        <span class="bst-section-count">${_lootRows} objet${_lootRows>1?'s':''} à deviner</span>
      </div>
      ${Array.from({ length: _lootRows }, (_, i) => {
        const a = (suffix) => `data-bst-action="setLoot" data-bst-on="change" data-id="${c.id}" data-idx="${i}" data-key="but_${suffix}_${i}"`;
        const filled = ded[`but_nom_${i}`] || ded[`but_qte_${i}`];
        return `<div class="bst-loot-est" data-loot-cid="${c.id}" data-loot-idx="${i}">
          ${_bstDeductArea(ded[`but_nom_${i}`], 'Objet supposé…', a('nom'))}
          <input class="bst-deduct-input bst-loot-qte" placeholder="Nb" value="${_esc(ded[`but_qte_${i}`]||'')}" ${a('qte')}>
          ${filled
            ? `<button type="button" class="bst-loot-del" data-bst-action="clearLoot" data-id="${c.id}" data-idx="${i}" title="Effacer cette ligne">✕</button>`
            : `<span class="bst-loot-del-spacer"></span>`}
        </div>`;
      }).join('')}
    </div>` : '';

  // ── Relations aux dégâts supposées (Joueur) ───────────────────────────────
  // Le joueur estime faiblesses / résistances / immunités / absorptions à partir
  // de ce qu'il observe en combat. Profil réel = MJ uniquement (dmgHtml plus haut).
  const relJoueurHtml = !_isAdminView() ? `
    <div class="bst-section">
      <div class="bst-section-title">🩸 Relations aux dégâts
        <span class="bst-section-count">supposées</span>
      </div>
      ${DAMAGE_RELATIONS.map(r => {
        const a = `data-bst-action="setDeduction" data-bst-on="change" data-id="${c.id}" data-key="rel_${r.key}"`;
        return `<div class="bst-rel-est" style="--rel-c:${r.color}">
          <span class="bst-rel-est-lbl">${r.icon} ${r.label}</span>
          ${_bstDeductArea(ded[`rel_${r.key}`], 'Types de dégâts supposés…', a)}
        </div>`;
      }).join('')}
    </div>` : '';

  return `
  <div class="bst-panel" style="--rang-c:${rs.color};--rang-glow:${rs.glow}">
    ${heroHtml}
    <div class="bst-panel-body">
      ${vitalsHtml}
      ${descHtml}
      ${armesJoueurHtml}
      ${attaquesJoueurHtml}
      ${traitsJoueurHtml}
      ${butinJoueurHtml}
      ${relJoueurHtml}
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// PANNEAU MJ — entièrement éditable, auto-save
// ══════════════════════════════════════════════════════════════════════════════
function _renderPanelAdmin(c, rs) {
  const types     = STORE.damageTypes || [];
  const traits    = Array.isArray(c.traits) ? c.traits : [];
  const butins    = Array.isArray(c.butins) ? c.butins : [];

  const modOf = (val) => {
    const n = parseInt(val);
    if (!val || isNaN(n)) return { txt: '', cls: 'zero' };
    const m = Math.floor((n - 10) / 2);
    return { txt: modStr(m), cls: m > 0 ? 'pos' : m < 0 ? 'neg' : 'zero' };
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

export async function deleteBeast(id) {
  const col = STORE.currentCol || 'bestiary';
  const c = STORE.creatures.find(x=>x.id===id);
  if (!await confirmDelete(col, id, `Supprimer "${c?.nom||'cette créature'}" ?`, {title: 'Supprimer la créature'})) return;
  if (STORE.activeId === id) STORE.activeId = null;
  await _bstHydrate();
  _render();
  showNotif('Créature supprimée.','success');
}

// ══════════════════════════════════════════════════════════════════════════════
// SUIVI JOUEUR
// ══════════════════════════════════════════════════════════════════════════════
async function _saveTracker() {
  // Le tracker vient d'être muté localement et le DOM reflète déjà la saisie
  // (input.value, barres PV/PM patchées par _bstAdjust). On aligne la signature
  // de rendu sur cet état AVANT l'écriture : quand l'écho du watch reviendra avec
  // exactement la même donnée, `_bstSig() === _bstRenderSig` → pas de _render(),
  // donc pas de rebuild innerHTML qui remettrait le scroll du panneau en haut.
  _bstRenderSig = _bstSig();
  // viewAsUid n'est respecté QUE pour un admin — sinon un joueur écrirait dans le
  // doc d'un autre joueur (uid périmé d'une session MJ précédente).
  const uid = (STATE.isAdmin && STORE.viewAsUid) || STATE.user?.uid; if (!uid) return;
  await tryDoc('bestiary_tracker', uid, { data: STORE.tracker });
}

function _syncActivePanel() {
  const page = document.querySelector('.bst-page');
  const layout = document.querySelector('.bst-layout');
  const panelSlot = document.querySelector('.bst-panel-slot');
  const activeCreature = STORE.creatures.find(c => c.id === STORE.activeId);

  page?.classList.toggle('has-panel', !!activeCreature);
  page?.classList.toggle('no-panel', !activeCreature);
  layout?.classList.toggle('has-panel', !!activeCreature);
  layout?.classList.toggle('no-panel', !activeCreature);

  document.querySelectorAll('.bst-card').forEach(card => {
    card.classList.toggle('active', card.dataset.beastId === STORE.activeId);
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

export function openBestiaryEntry(id) {
  _bstOpen(id);
}

function _bstOpen(id) {
  if (_bstDragBlockClick) return;
  STORE.activeId = STORE.activeId === id ? null : id;
  _syncActivePanel();
}
function _bstClose() {
  STORE.activeId = null;
  _syncActivePanel();
}
function _bstSetRang(rang) { STORE.filterRang = rang; _render(); }
function _bstSelectRang(rang) {
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
}
// Recherche : met à jour la valeur et filtre la grille SANS rerender complet
function _bstSearchInput(val) {
  STORE.searchVal = val;
  // Filtrer en live sans reconstruire toute la page
  document.querySelectorAll('.bst-card').forEach(card => {
    const id = card.dataset.beastId;
    const c  = STORE.creatures.find(x => x.id === id);
    if (!c) return;
    card.style.display = _beastMatchesFilters(c, { search: val }) ? '' : 'none';
  });
}

function _bstSearch(val) { STORE.searchVal = val; _render(); } // legacy
function _bstSetType(type) { STORE.filterType = type; _render(); }

// Switch de bestiaire (admin uniquement)
async function _bstSwitchBestiaire(id) {
  STORE.bestiaireId = id;
  STORE.activeId    = null;
  STORE.searchVal   = '';
  STORE.filterType  = '';
  STORE.filterRang  = '';
  await renderBestiary();
}

// Vue admin → joueur : voir/modifier les estimations d'un joueur.
// uid vide ou égal à l'UID admin → retour à la vue MJ.
async function _bstViewAs(uid) {
  if (!STATE.isAdmin) return;
  STORE.viewAsUid = (uid && uid !== STATE.user?.uid) ? uid : null;
  STORE.activeId  = null;
  await renderBestiary();
}

async function _bstCreateBestiaire() {
  const label = await promptModal('Nom du nouveau bestiaire :', { title: 'Nouveau bestiaire', required: true });
  if (!label?.trim()) return;
  const id    = 'bst_' + Date.now();
  const list  = STORE.bestiaireList || [{ id:'main', label:'Bestiaire principal' }];
  list.push({ id, label: label.trim() });
  await saveDoc('bestiary_meta', 'list', { list });
  STORE.bestiaireList = list;
  STORE.bestiaireId = id;
  STORE.activeId    = null;
  STORE.filterRang  = '';
  await renderBestiary();
}

// Affiche/retire la croix d'une ligne de butin selon qu'elle est remplie, en DOM
// pur (pas de _render → pas de saut de scroll). La délégation scopée capte les
// boutons ajoutés dynamiquement.
function _bstLootRefreshDel(id, idx) {
  const row = document.querySelector(`.bst-loot-est[data-loot-cid="${id}"][data-loot-idx="${idx}"]`);
  if (!row) return;
  const ded    = STORE.tracker[id]?.deductions || {};
  const filled = !!(ded[`but_nom_${idx}`] || ded[`but_qte_${idx}`]);
  if (filled === !!row.querySelector('.bst-loot-del')) return;  // déjà dans le bon état
  row.querySelector('.bst-loot-del, .bst-loot-del-spacer')?.remove();
  if (filled) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bst-loot-del';
    btn.dataset.bstAction = 'clearLoot';
    btn.dataset.id = id;
    btn.dataset.idx = idx;
    btn.title = 'Effacer cette ligne';
    btn.textContent = '✕';
    row.appendChild(btn);
  } else {
    const sp = document.createElement('span');
    sp.className = 'bst-loot-del-spacer';
    row.appendChild(sp);
  }
}

// Saisie d'un input de butin : sauvegarde + bascule la croix immédiatement.
function _bstSetLoot(el) {
  _bstSetDeduction(el.dataset.id, el.dataset.key, el.value);
  _bstLootRefreshDel(el.dataset.id, el.dataset.idx);
}

// Efface une ligne de butin estimé en un clic : retire les clés, vide les inputs
// et la croix dans le DOM (pas de _render → pas de saut de scroll, cf. _saveTracker).
function _bstClearLoot(id, idx) {
  const d = STORE.tracker[id]?.deductions;
  if (d) { delete d[`but_nom_${idx}`]; delete d[`but_qte_${idx}`]; }
  const row = document.querySelector(`.bst-loot-est[data-loot-cid="${id}"][data-loot-idx="${idx}"]`);
  if (row) row.querySelectorAll('.bst-deduct-input').forEach(inp => { inp.value = ''; });
  _bstLootRefreshDel(id, idx);  // ligne vide → remplace la croix par le spacer
  _saveTracker();
}

// Déductions joueur
function _bstSetDeduction(id, key, val) {
  if (!STORE.tracker[id]) STORE.tracker[id] = {};
  if (!STORE.tracker[id].deductions) STORE.tracker[id].deductions = {};
  if (val === '' || val === null || val === undefined) {
    delete STORE.tracker[id].deductions[key];
  } else {
    STORE.tracker[id].deductions[key] = val;
  }
  _saveTracker();
}

function _bstAdjust(id, type, delta) {
  const c = STORE.creatures.find(x=>x.id===id); if (!c) return;
  if (!STORE.tracker[id]) STORE.tracker[id] = {};
  const curKey = type==='pv'?'pvActuel':'pmActuel';
  // Vue MJ : connaît le max et le respecte. Vue joueur (ou MJ consultant un joueur) : pas de borne max.
  const max    = _isAdminView() ? (parseInt(c[type==='pv'?'pvMax':'pmMax'])||0) : null;
  const cur    = STORE.tracker[id][curKey] !== undefined ? parseInt(STORE.tracker[id][curKey]) : (max ?? 0);
  const newVal = max !== null ? Math.max(0, Math.min(max, cur + delta)) : Math.max(0, cur + delta);
  STORE.tracker[id][curKey] = newVal;

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
}

function _bstSetStat(id, key, val) {
  if (!STORE.tracker[id]) STORE.tracker[id] = {};
  STORE.tracker[id][key] = parseInt(val)||0;
  _saveTracker();
}

function _bstSetNotes(id, val) {
  if (!STORE.tracker[id]) STORE.tracker[id] = {};
  STORE.tracker[id].notes = val;
  _saveTracker();
}

function _bstReset(id) {
  const c = STORE.creatures.find(x=>x.id===id); if (!c) return;
  // Vue MJ : remet les vraies valeurs. Vue joueur (ou MJ consultant un joueur) : remet les estimations à zéro.
  STORE.tracker[id] = _isAdminView()
    ? { pvActuel: parseInt(c.pvMax)||0, pmActuel: parseInt(c.pmMax)||0, notes:'' }
    : { pvActuel: 0, pmActuel: 0, caEstimee: 0, vitEstimee: 0, xpEstimee: 0, pvCombat: 0, notes:'', deductions:{} };
  _saveTracker();
  _render();
}

// ── Override PAGES.bestiaire + exports ───────────────────────────────────────
PAGES.bestiaire = renderBestiary;

// ──────────────────────────────────────────────────────────────────────────────
// MODAL IMAGE — éditeur d'image dédié de la créature (depuis le panneau)
// ──────────────────────────────────────────────────────────────────────────────
export async function openBeastImageModal(id) {
  const c = STORE.creatures.find(x => x.id === id);
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

async function _bstSaveImage(id) {
  const cropResult = _bstCropper?.getResult();
  const current = STORE.creatures.find(c => c.id === id)?.imageUrl || '';
  const imageUrl = typeof cropResult === 'string' ? cropResult : current;
  if (imageUrl && imageUrl.length > 900_000) {
    showNotif('Image trop grande, recadrez plus petit.', 'error');
    return;
  }
  const col = STORE.currentCol || 'bestiary';
  if (await trySave(col, id, { imageUrl })) {
    const idx = STORE.creatures.findIndex(c => c.id === id);
    if (idx >= 0) STORE.creatures[idx].imageUrl = imageUrl;
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
  }
}

async function _bstRemoveImage(id) {
  const col = STORE.currentCol || 'bestiary';
  if (await trySave(col, id, { imageUrl: '' })) {
    const idx = STORE.creatures.findIndex(c => c.id === id);
    if (idx >= 0) STORE.creatures[idx].imageUrl = '';
    _bstCropper?.destroy(); _bstCropper = null;
    closeModal();
    _syncActivePanel();
    showNotif('Image retirée.', 'success');
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// HANDLERS DE DÉLÉGATION — chaque entrée lit ses paramètres dans `el.dataset`
// et appelle la fonction existante. Les fonctions restent sur `window` tant que
// d'autres features (legacy) peuvent encore les invoquer.
// ──────────────────────────────────────────────────────────────────────────────
// ── Export : document HTML imprimable de toutes les créatures (MJ) ────────────
// Génère un fichier .html autonome (lisible + imprimable en PDF depuis le
// navigateur) listant chaque créature et ses infos. Téléchargement direct.
function _bstExportDocument() {
  if (!STATE.isAdmin) return;
  const list = (STORE.creatures || []).slice()
    .sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }));
  if (!list.length) { showNotif('Aucune créature à exporter', 'info'); return; }
  try {
    const blob = new Blob([_bstBuildExportHtml(list)], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bestiaire-${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showNotif(`📄 Bestiaire exporté (${list.length} créature${list.length > 1 ? 's' : ''}).`, 'success');
  } catch (e) {
    console.error('[bestiaire] export', e);
    showNotif("Échec de l'export", 'error');
  }
}

function _bstBuildExportHtml(list) {
  const e = _esc;
  const txt = v => e(v && typeof v === 'object' ? (v.nom || v.label || v.description || '') : String(v ?? ''));
  const statsHtml = (c) => [['FOR', 'force'], ['DEX', 'dexterite'], ['CON', 'constitution'], ['INT', 'intelligence'], ['SAG', 'sagesse'], ['CHA', 'charisme']]
    .map(([l, k]) => (c[k] != null && c[k] !== '') ? `<span><b>${l}</b> ${e(String(c[k]))}</span>` : '')
    .filter(Boolean).join('');
  const actLine = (a) => {
    const dmg = a.degats ? ` — ${e(a.degats)}${a.degatsFlat ? '+' + e(String(a.degatsFlat)) : ''}` : '';
    const info = a.info ? ` <i>${e(a.info)}</i>` : '';
    return `<li><b>${e(a.nom || 'Action')}</b>${dmg}${info}</li>`;
  };
  const ul = (arr, fn) => (Array.isArray(arr) && arr.length) ? `<ul>${arr.map(fn).join('')}</ul>` : '';
  const section = (label, html) => html ? `<h3>${label}</h3>${html}` : '';
  const card = (c) => {
    const rs = RANG_STYLE[c.rang || 'classique'] || RANG_STYLE.classique;
    const meta = [rs.label, c.type, c.environnement].filter(Boolean).map(e).join(' · ');
    const vit = [c.pvMax && `❤️ ${e(String(c.pvMax))} PV`, c.pmMax && `✦ ${e(String(c.pmMax))} PM`,
      c.ca && `🛡️ CA ${e(String(c.ca))}`, c.vitesse && `💨 ${e(String(c.vitesse))} m`,
      c.initiative && `⚡ Init ${e(String(c.initiative))}`].filter(Boolean).join(' · ');
    const st = statsHtml(c);
    return `<article class="card">
      <h2>${e(c.emoji || '🐲')} ${e(c.nom || '?')}${c.niveau ? ` <span class="lvl">Niv. ${e(String(c.niveau))}</span>` : ''}${c.hidden ? ` <span class="hid">🔒 caché aux joueurs</span>` : ''}</h2>
      ${meta ? `<div class="meta">${meta}</div>` : ''}
      ${vit ? `<div class="vit">${vit}</div>` : ''}
      ${st ? `<div class="stats">${st}</div>` : ''}
      ${section('Traits', ul(c.traits, t => `<li>${txt(t)}</li>`))}
      ${section('Armes naturelles', ul(c.armesNaturelles, a => `<li><b>${e(a.nom || 'Arme')}</b>${a.degats ? ` — ${e(a.degats)}` : ''}</li>`))}
      ${section('Actions', ul(c.actions, actLine))}
      ${section('Butins', ul(c.butins, b => `<li>${txt(b)}</li>`))}
      ${c.description ? `<div class="desc">${e(c.description)}</div>` : ''}
    </article>`;
  };
  const css = `*{box-sizing:border-box}body{font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;background:#fff;margin:0;padding:24px;line-height:1.45}`
    + `h1{font-size:1.6rem;margin:0 0 .2rem}header p{color:#64748b;margin:0 0 1.2rem;font-size:.9rem}`
    + `.card{border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin:0 0 14px;page-break-inside:avoid;break-inside:avoid}`
    + `.card h2{font-size:1.1rem;margin:0 0 4px}.lvl{font-size:.8rem;color:#64748b;font-weight:400}.hid{font-size:.72rem;color:#ef4444;font-weight:400}`
    + `.meta{color:#64748b;font-size:.85rem;margin-bottom:6px}.vit{font-size:.9rem;margin-bottom:6px}`
    + `.stats{display:flex;flex-wrap:wrap;gap:10px;font-size:.85rem;color:#334155;margin-bottom:6px}`
    + `.card h3{font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;color:#475569;margin:10px 0 3px}`
    + `.card ul{margin:0;padding-left:18px;font-size:.88rem}.card li{margin:2px 0}`
    + `.desc{font-size:.88rem;color:#334155;margin-top:8px;white-space:pre-wrap}`
    + `@media print{body{padding:0}.card{border-color:#cbd5e1}}`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>Bestiaire (${list.length})</title><style>${css}</style></head>`
    + `<body><header><h1>📖 Bestiaire</h1><p>${list.length} créature${list.length > 1 ? 's' : ''} · exporté le ${e(new Date().toLocaleDateString('fr-FR'))}</p></header>`
    + `${list.map(card).join('')}</body></html>`;
}

Object.assign(bstHandlers, {
  // Galerie / navigation
  open:           (el) => _bstOpen(el.dataset.id),
  exportBeasts:   ()   => _bstExportDocument(),
  close:          ()   => _bstClose(),
  createDraft:    ()   => _bstCreateDraft(),
  switchBest:     (el) => _bstSwitchBestiaire(el.dataset.id),
  createBest:     ()   => _bstCreateBestiaire(),
  setRang:        (el) => _bstSetRang(el.dataset.rang),
  setType:        (el) => _bstSetType(el.dataset.type),
  search:         (el) => _bstSearchInput(el.value),
  viewAs:         (el) => _bstViewAs(el.dataset.uid || ''),

  // Panneau admin : édition inline
  updateNom:      (el) => _bstUpdateNom(el.dataset.id, el.value),
  update:         (el) => _bstUpdate(el.dataset.id, el.dataset.field, el.value),
  updateNum:      (el) => _bstUpdateNum(el.dataset.id, el.dataset.field, el.value),
  updateCarac:    (el) => _bstUpdateCarac(el.dataset.id, el.dataset.key, el.value),
  selectRang:     (el) => _bstSelectRangPanel(el.dataset.id, el.dataset.rang),
  toggleHidden:   (el) => _bstToggleHidden(el.dataset.id),
  toggleDmg:      (el) => _bstToggleDmg(el.dataset.id, el.dataset.key, el.dataset.tid),
  syncDmgConfl:   ()   => _bstSyncDmgConflicts(),
  focusInput:     (el) => el.querySelector('input')?.focus(),

  // Vue joueur : estimations / déductions
  setStat:        (el) => _bstSetStat(el.dataset.id, el.dataset.key, el.value),
  setDeduction:   (el) => _bstSetDeduction(el.dataset.id, el.dataset.key, el.value),
  setLoot:        (el) => _bstSetLoot(el),
  clearLoot:      (el) => _bstClearLoot(el.dataset.id, el.dataset.idx),

  // Sections dynamiques (armes / actions / traits / butins)
  addArme:        (el) => _bstAddArme(el.dataset.id),
  saveArmes:      (el) => _bstSaveArmes(el.dataset.id),
  removeArme:     (el) => _bstRemoveArme(el.dataset.id, el),
  addAction:      ()   => _bstAddAction(),
  editAction:     (el) => _bstEditAction(parseInt(el.dataset.idx)),
  removeAction:   (el) => _bstRemoveAction(parseInt(el.dataset.idx)),
  addRow:         (el) => _bstAddPanelRow(el.dataset.id, el.dataset.type),
  saveArr:        (el) => _bstSaveArr(el.dataset.id, el.dataset.type),
  removeRow:      (el) => _bstRemovePanelRow(el.dataset.id, el.dataset.type, el),

  // Picker de butin (délégation au composant partagé shop-picker.js — pas de handlers locaux)
  pickerOpen:     (el) => _bstButinPickerOpen(el.dataset.id),

  // Image
  openImage:      (el) => openBeastImageModal(el.dataset.id),
  saveImage:      (el) => _bstSaveImage(el.dataset.id),
  removeImage:    (el) => _bstRemoveImage(el.dataset.id),

  // Suppression créature
  deleteBeast:    (el, ev) => { ev?.stopPropagation?.(); deleteBeast(el.dataset.id); },
});
