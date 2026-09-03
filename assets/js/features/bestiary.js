// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// BESTIARY.JS â€” Le Bestiaire
// âœ“ Admin : CRUD crÃ©atures, image+crop, attaques/traits/butins dynamiques
// âœ“ Joueur : galerie + suivi personnel (PV/PM live, notes)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
import { loadCollection, getCachedCollection, loadChars, addToCol, updateInCol, getDocData, saveDoc } from '../data/firestore.js';
import { trySave, confirmDelete, tryDoc } from '../shared/crud.js';
import { watchPageCollection, watchPageDoc } from '../shared/realtime.js';
import { openModal, closeModal, pushModal, popModal, confirmModal, promptModal } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import { _ensureFeatureCss } from '../core/navigation.js';
import PAGES from './pages.js';
import { _esc, _norm, _searchIncludes } from '../shared/html.js';
import { consumeTargetEntity } from '../shared/entity-navigation.js';
import { loadDamageTypes } from '../shared/damage-types.js';
import { sortCharactersForDisplay, modStr } from '../shared/char-stats.js';
import { panZoomCropHTML, attachPanZoomCrop } from '../shared/image-crop.js';
import { pickImageFile } from '../shared/image-upload.js';
import { openShopPicker, getRareteColor } from '../shared/shop-picker.js';
import { bindScopedActions } from '../shared/scoped-actions.js';
import { registerActions } from '../core/actions.js';
import { makeSortable } from '../shared/sortable-helper.js';
import { spellActionCardHtml } from '../shared/spell-action-card.js';
import { DAMAGE_RELATIONS } from '../shared/damage-profile.js';
import { naturalWeaponDamageFormula } from '../shared/bestiary-combat.js';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DÃ‰LÃ‰GATION D'Ã‰VÃ‰NEMENTS â€” remplace les onclick/oninput/onchange inline
// Pattern : <button data-bst-action="open" data-id="â€¦">â€¦</button>
// + bstHandlers.open = (el) => _bstOpen(el.dataset.id)
// Un seul listener par type d'Ã©vÃ©nement, idempotent, scope module.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const bstHandlers = {};
bindScopedActions('bst', bstHandlers);

// â”€â”€ Ã‰tat local â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let _bstCropper = null;
const STORE = {
  creatures:     [],      // liste des crÃ©atures du bestiaire actif
  tracker:       {},      // { [creatureId]: { pvActuel, pmActuel, notes, deductions } }
  damageTypes:   null,    // types de dÃ©gÃ¢ts (chargÃ©s au premier affichage)
  searchVal:     '',
  filterType:    '',      // filtre par type de crÃ©ature
  filterRang:    '',      // filtre par rang (classique, elite, boss)
  filterPrep:    '',      // filtre de preparation MJ (pret, incomplet, cache, etc.)
  activeId:      null,    // crÃ©ature ouverte dans le panneau
  bestiaireId:   'main',  // id du bestiaire actif
  currentCol:    'bestiary',
  bestiaireList: [{ id: 'main', label: 'Bestiaire principal' }],
  viewAsUid:     null,    // admin : voir le bestiaire d'un joueur
  role:          'mj',    // admin : 'mj' | 'player' (aperçu fiche à trous)
  _authUid:      null,    // uid de la session courante â€” dÃ©tecte un changement de compte
  playersList:   [],      // [{ uid, pseudo }] peuplÃ© cÃ´tÃ© admin
};


let _bstSortable = null;
let _bstDragBlockClick = false;
let _bstClickGuardInstalled = false;
let _bstReordering = false;
let _pendingTargetBeastId = null;

// Vue "MJ" effective : admin ET pas en train de consulter un joueur.
// Quand l'admin bascule sur un joueur, on rend exactement comme cÃ´tÃ© joueur
// pour pouvoir voir/modifier ses estimations.
// Vue joueur d'un AUTRE joueur (bannière + cible de sauvegarde) : admin en rôle
// joueur ayant sélectionné le carnet d'un tiers.
function _isViewingPlayer() {
  return STATE.isAdmin && STORE.role === 'player' && STORE.viewAsUid && STORE.viewAsUid !== STATE.user?.uid;
}
// Vue MJ effective = admin ET rôle 'mj'. Sinon (non-admin, ou admin en aperçu
// joueur) on rend la fiche à trous.
function _isAdminView() {
  return STATE.isAdmin && STORE.role !== 'player';
}

// L'ordre manuel ne concerne que le recueil principal complet. Désactiver le
// drag pendant une recherche/filtration évite d'enregistrer un ordre partiel
// difficile à comprendre (et de déplacer involontairement les fiches masquées).
function _canReorderBestiary() {
  return _isAdminView()
    && STORE.bestiaireId === 'main'
    && STORE.currentCol === 'bestiary'
    && !STORE.searchVal
    && !STORE.filterType
    && !STORE.filterRang
    && !STORE.filterPrep;
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

const DEFAULT_BESTIARY_RANKS = [
  { id:'classique', label:'Classique', plural:'Classiques', color:'#94a3b8', glow:'rgba(148,163,184,0.18)', border:'rgba(148,163,184,0.40)', bg:'rgba(148,163,184,0.10)', enabled:true },
  { id:'elite',     label:'Elite',     plural:'Elites',     color:'#e8b84b', glow:'rgba(232,184,75,0.22)',  border:'rgba(232,184,75,0.40)',  bg:'rgba(232,184,75,0.12)',  enabled:true },
  { id:'boss',      label:'Boss',      plural:'Boss',       color:'#ff5a7e', glow:'rgba(255,90,126,0.24)',  border:'rgba(255,90,126,0.40)',  bg:'rgba(255,90,126,0.12)',  enabled:true },
];
const BESTIARY_RANK_PALETTE = ['#94a3b8', '#e8b84b', '#ff5a7e', '#4f8cff', '#22c38e', '#b47fff', '#f97316', '#f8fafc'];
let BESTIARY_RANKS = DEFAULT_BESTIARY_RANKS.map(r => ({ ...r }));
let RANG_STYLE = Object.fromEntries(BESTIARY_RANKS.map(r => [r.id, r]));

function _rankId(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || `rang_${Date.now()}`;
}

function _normalizeBestiaryRank(raw = {}, index = 0) {
  const base = DEFAULT_BESTIARY_RANKS[index] || DEFAULT_BESTIARY_RANKS[0];
  const label = String(raw.label || raw.nom || base.label || 'Rang').trim();
  const color = String(raw.color || base.color || '#94a3b8').trim();
  return {
    id: _rankId(raw.id || label),
    label,
    plural: String(raw.plural || raw.labelPlural || `${label}s`).trim(),
    color,
    glow: raw.glow || `${color}2e`,
    border: raw.border || `${color}66`,
    bg: raw.bg || `${color}1a`,
    enabled: raw.enabled !== false,
  };
}

function _setBestiaryRanks(ranks = DEFAULT_BESTIARY_RANKS) {
  const normalized = (Array.isArray(ranks) && ranks.length ? ranks : DEFAULT_BESTIARY_RANKS)
    .map(_normalizeBestiaryRank)
    .filter(r => r.enabled !== false);
  BESTIARY_RANKS = normalized.length ? normalized : DEFAULT_BESTIARY_RANKS.map(r => ({ ...r }));
  RANG_STYLE = Object.fromEntries(BESTIARY_RANKS.map(r => [r.id, r]));
  if (STORE.filterRang && !RANG_STYLE[STORE.filterRang]) STORE.filterRang = '';
}

function _defaultRankId() {
  return BESTIARY_RANKS[0]?.id || DEFAULT_BESTIARY_RANKS[0].id;
}

function _rankStyle(id) {
  return RANG_STYLE[id] || RANG_STYLE[_defaultRankId()] || DEFAULT_BESTIARY_RANKS[0];
}

async function _loadBestiaryRanks() {
  const doc = await getDocData('bestiary_meta', 'ranks').catch(() => null);
  _setBestiaryRanks(Array.isArray(doc?.ranks) && doc.ranks.length ? doc.ranks : DEFAULT_BESTIARY_RANKS);
  return BESTIARY_RANKS;
}

async function _saveBestiaryRanks(ranks) {
  const normalized = (ranks || []).map(_normalizeBestiaryRank).filter(r => r.enabled !== false);
  await saveDoc('bestiary_meta', 'ranks', { ranks: normalized });
  _setBestiaryRanks(normalized);
  return BESTIARY_RANKS;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ARMES NATURELLES + ACTIONS â€” mÃ©tadonnÃ©es partagÃ©es avec la modal de sorts.
// Les actions de crÃ©ature utilisent EXACTEMENT le mÃªme schÃ©ma que les sorts de
// personnage et les actions d'objet (boutique). On dÃ©lÃ¨gue Ã  `editItemSpell`.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const _BST_STAT_OPTIONS = [
  { key:'none',         short:'-',   label:'Aucun' },
  { key:'force',        short:'For', label:'Force' },
  { key:'dexterite',    short:'Dex', label:'Dexterite' },
  { key:'intelligence', short:'Int', label:'Intelligence' },
  { key:'sagesse',      short:'Sag', label:'Sagesse' },
  { key:'constitution', short:'Con', label:'Constitution' },
  { key:'charisme',     short:'Cha', label:'Charisme' },
];

function _bstUuid() { return 'a_' + Math.random().toString(36).slice(2, 9); }

// â”€â”€ Cache des objets boutique (pour le picker de butins) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

/** Re-render des selects de butins (aprÃ¨s chargement async des items). */
function _bstRefreshButinSelects(cid) {
  const host = document.getElementById(`bst-p-butins-${cid}`);
  if (!host) return;
  const c = STORE.creatures.find(x => x.id === cid);
  const butins = Array.isArray(c?.butins) ? c.butins : [];
  host.innerHTML = butins.map((b,i) => _panelButinRow(b, cid, i)).join('');
}

/** Convertit une crÃ©ature en "char-like" object utilisable par la modal de sort.
 *  L'arme naturelle choisie est placÃ©e sur l'emplacement "Main principale". */
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
    equipement['Main principale'] = {
      nom:         arme.nom || 'Arme naturelle',
      degats:      naturalWeaponDamageFormula(arme),
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
    nom:       c?.nom || 'Creature',
    photoURL:  c?.imageUrl || '',
    stats,
    statsBonus: {},
    equipement,
    deck_sorts: Array.isArray(c?.actions) ? c.actions : [],
  };
}

// Cache local des actions de la crÃ©ature en cours d'Ã©dition (admin)
let _bstActionsCache = [];
let _bstActionsCreatureId = null;
let _bstActionsArmeIdCtx  = null; // arme naturelle utilisÃ©e pour le calcul

function _bstActionsCacheLoad(creatureId, actions) {
  _bstActionsCreatureId = creatureId || null;
  _bstActionsCache = Array.isArray(actions) ? actions.map(a => ({ ...a })) : [];
}

async function _bstEnsureSpellsModule() {
  // L'Ã©diteur de sorts est stylÃ© par characters.css (+ shop.css pour le sous-modal
  // matrices) â€” chargÃ©s en lazy uniquement sur la page Perso. Ouvert depuis le
  // bestiaire sans y Ãªtre passÃ© â†’ CSS absente = modale non stylÃ©e. On la charge ici.
  const [mod] = await Promise.all([
    import('./characters/spells.js'),
    _ensureFeatureCss('characters'),
  ]);
  return mod;
}

async function _bstActionsPersist() {
  if (!_bstActionsCreatureId) return;
  const creatureId = _bstActionsCreatureId;
  const patch = { actions: _bstActionsCache.map(a => ({ ...a })), attaques: [] };
  const c = STORE.creatures.find(x => x.id === _bstActionsCreatureId);
  if (c) Object.assign(c, patch);
  const count = document.querySelector(`[data-bst-count="${_bstActionsCreatureId}-actions"]`);
  if (count) count.textContent = _bstActionsCache.length;

  // Une action est un enregistrement explicite depuis une modale : elle doit être
  // disponible immédiatement dans le VTT. Le debounce des champs inline créait
  // une course : le VTT pouvait recharger l'ancienne formule avant l'écriture,
  // puis la conserver jusqu'à la prochaine ouverture de la table.
  document.dispatchEvent(new CustomEvent('bestiary:creature-updated', {
    detail: { id: creatureId, patch },
  }));
  await updateInCol(STORE.currentCol || 'bestiary', creatureId, patch);
  // Si le module VTT a été chargé pendant l'écriture, ce second signal lui donne
  // aussi la valeur confirmée sans ajouter de listener Firestore permanent.
  document.dispatchEvent(new CustomEvent('bestiary:creature-updated', {
    detail: { id: creatureId, patch },
  }));
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
    return `<div class="bst-actions-empty">Aucune action - clique sur + Ajouter pour ouvrir l'editeur de sort.</div>`;
  }
  return _bstActionsCache.map((a,i) => _bstRenderActionCard(a,i)).join('');
}

async function _bstAddAction() {
  const mod = await _bstEnsureSpellsModule();
  if (typeof mod.addItemSpell !== 'function') { showNotif('Module sorts indisponible', 'error'); return; }
  const c = STORE.creatures.find(x => x.id === _bstActionsCreatureId);
  if (!c) return;
  const charForCalc = _bstCreatureToChar(c, _bstActionsArmeIdCtx);
  const fakeItem = { actions: _bstActionsCache, nom: c.nom || 'Creature' };
  mod.addItemSpell(fakeItem, async (updatedItem) => {
    _bstActionsCache = Array.isArray(updatedItem?.actions) ? updatedItem.actions.map(a => ({...a})) : [];
    await _bstActionsPersist();
    _bstRefreshActionsHost();
  }, charForCalc);
}

async function _bstEditAction(idx) {
  const mod = await _bstEnsureSpellsModule();
  if (typeof mod.editItemSpell !== 'function') { showNotif('Module sorts indisponible', 'error'); return; }
  const c = STORE.creatures.find(x => x.id === _bstActionsCreatureId);
  if (!c) return;
  const charForCalc = _bstCreatureToChar(c, _bstActionsArmeIdCtx);
  const fakeItem = { actions: _bstActionsCache, nom: c.nom || 'Creature' };
  mod.editItemSpell(fakeItem, idx, async (updatedItem) => {
    _bstActionsCache = Array.isArray(updatedItem?.actions) ? updatedItem.actions.map(a => ({...a})) : [];
    await _bstActionsPersist();
    _bstRefreshActionsHost();
  }, charForCalc);
}

async function _bstRemoveAction(idx) {
  if (!Number.isFinite(idx) || !_bstActionsCache[idx]) return;
  if (!await confirmModal('Supprimer cette action ?', { title: 'Action', confirmLabel: 'Supprimer' })) return;
  _bstActionsCache.splice(idx, 1);
  await _bstActionsPersist();
  _bstRefreshActionsHost();
}

// â”€â”€ Armes naturelles : Ã©dition inline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function _bstRenderArmeRow(a = {}, cid, idx) {
  const optsHTML = (sel) => _BST_STAT_OPTIONS.map(s =>
    `<option value="${s.key}"${sel===s.key?' selected':''}>${s.short}</option>`).join('');
  const inputAttrs  = `data-bst-action="saveArmes" data-bst-on="input"  data-id="${cid}"`;
  const selectAttrs = `data-bst-action="saveArmes" data-bst-on="change" data-id="${cid}"`;
  return `<div class="bst-p-row bst-arme-card" data-arme-id="${a.id || ''}">
    <div class="bst-arme-head">
      <input class="bst-p-input bst-arme-nom" data-f="nom" placeholder="Nom (Griffes, Morsure...)"
        value="${_esc(a.nom||'')}" ${inputAttrs}>
      <input class="bst-p-input bst-arme-dice" data-f="degats" placeholder="1d8+2"
        value="${_esc(a.degats||'')}" ${inputAttrs}>
      <button class="bst-p-row-remove" data-bst-action="removeArme" data-id="${cid}" title="Retirer">x</button>
    </div>

    <div class="bst-arme-duo">
      <div class="bst-arme-grp">
        <div class="bst-arme-grp-hd">Degats</div>
        <div class="bst-arme-grp-fields">
          <select class="bst-p-input" data-f="degatsStat" title="Statistique de degats" ${selectAttrs}>${optsHTML(a.degatsStat || 'force')}</select>
          <input class="bst-p-input" data-f="degatsFlat" type="number" placeholder="+0"
            title="Bonus fixe aux degats" value="${a.degatsFlat ?? ''}" ${inputAttrs}>
        </div>
      </div>
      <div class="bst-arme-grp">
        <div class="bst-arme-grp-hd">Toucher</div>
        <div class="bst-arme-grp-fields">
          <select class="bst-p-input" data-f="toucherStat" title="Statistique de toucher" ${selectAttrs} ${a.toucherAuto ? 'disabled' : ''}>${optsHTML(a.toucherStat || a.degatsStat || 'force')}</select>
          <input class="bst-p-input" data-f="toucherFlat" type="number" placeholder="+0"
            title="Bonus fixe au toucher" value="${a.toucherFlat ?? ''}" ${inputAttrs} ${a.toucherAuto ? 'disabled' : ''}>
        </div>
      </div>
    </div>

    <label class="bst-arme-auto${a.toucherAuto ? ' is-on' : ''}" title="L'attaque touche automatiquement. Les degats restent normaux.">
      <input type="checkbox" data-f="toucherAuto" ${a.toucherAuto ? 'checked' : ''} ${selectAttrs}>
      <span>Toucher automatique</span>
      <span class="bst-arme-auto-hint">- touche toujours, degats normaux</span>
    </label>

    <div class="bst-arme-trio">
      <label class="bst-p-mini">Portee
        <input class="bst-p-input" data-f="portee" placeholder="Contact, 9m"
          value="${_esc(a.portee||'')}" ${inputAttrs}>
      </label>
      <label class="bst-p-mini">Format
        <select class="bst-p-input" data-f="format" ${selectAttrs}>
          <option value="physique"${(a.format||'physique')==='physique'?' selected':''}>Physique</option>
          <option value="magique"${a.format==='magique'?' selected':''}>Magique</option>
        </select>
      </label>
      <label class="bst-p-mini" title="Type de degats defini dans la console MJ.">Type de degats
        <select class="bst-p-input" data-f="damageTypeId" ${selectAttrs}>
          ${(STORE.damageTypes || []).map(t =>
            `<option value="${t.id}"${(a.damageTypeId||'physique')===t.id?' selected':''}>${_esc(t.label)}</option>`).join('')}
        </select>
      </label>
    </div>

    <input class="bst-p-input bst-arme-info" data-f="info"
      placeholder="Effet complementaire - ex : Si touche, applique Poison"
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
  // Si l'arme contextuelle a disparu, on prend la premiÃ¨re dispo
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

function _beastAlerts(c) {
  const alerts = [];
  const hasActions = Array.isArray(c.actions) && c.actions.length > 0;
  const hasLoot = Array.isArray(c.butins) && c.butins.length > 0;
  if (!String(c.nom || '').trim() || /^nouvelle cr/i.test(String(c.nom || ''))) alerts.push({ key:'name', label:'nom', level:'hard' });
  if (!(parseInt(c.pvMax) > 0)) alerts.push({ key:'pv', label:'PV', level:'hard' });
  if (!(parseInt(c.ca) > 0)) alerts.push({ key:'ca', label:'CA', level:'hard' });
  if (!hasActions) alerts.push({ key:'actions', label:'action', level:'hard' });
  if (!c.imageUrl) alerts.push({ key:'image', label:'image', level:'soft' });
  if (!hasLoot) alerts.push({ key:'loot', label:'butin', level:'soft' });
  return alerts;
}

function _beastHardAlerts(c) {
  return _beastAlerts(c).filter(a => a.level === 'hard');
}

function _beastIsReady(c) {
  return _beastHardAlerts(c).length === 0;
}

function _beastMatchesPrep(c, prep = STORE.filterPrep) {
  switch (prep) {
    case 'ready': return _beastIsReady(c);
    case 'todo': return _beastHardAlerts(c).length > 0;   // injouable (blocage dur)
    case 'incomplete': return _beastAlerts(c).length > 0;
    case 'hidden': return !!c.hidden;
    case 'visible': return !c.hidden;
    case 'loot': return Array.isArray(c.butins) && c.butins.length > 0;
    case 'noAction': return !(Array.isArray(c.actions) && c.actions.length > 0);
    default: return true;
  }
}

function _beastMatchesFilters(c, { search = STORE.searchVal, type = STORE.filterType, rang = STORE.filterRang, prep = STORE.filterPrep } = {}) {
  const q = _norm(search);
  const fType = _norm(type);
  const fRang = _norm(rang);
  const matchSearch = !q || _searchIncludes(_beastSearchText(c), search);
  const matchType = !fType || _norm(c.type) === fType;
  const matchRang = !fRang || _norm(c.rang || _defaultRankId()) === fRang;
  return matchSearch && matchType && matchRang && _beastMatchesPrep(c, prep);
}

// ── Carnet joueur : complétion (calcul pur, aucune écriture) ────────────────
// Le total de trous est dérivé de la créature réelle. Les clés = exactement
// celles écrites par la fiche à trous (mêmes que le modèle actuel).
const BST_STAT_CARNET = ['pvActuel', 'pmActuel', 'caEstimee', 'vitEstimee', 'xpEstimee'];
// Une estimation de stat n'existe que si le MJ a renseigné la valeur réelle
// (>0). PM vide / « - » → pas de trou, pas comptée. (Idem relations : seulement
// celles que la créature possède réellement.)
const BST_STAT_FIELD = { pvActuel: 'pvMax', pmActuel: 'pmMax', caEstimee: 'ca', vitEstimee: 'vitesse', xpEstimee: 'dangerositeXp' };
function _bstStatDefined(c, statKey) { return parseInt(c[BST_STAT_FIELD[statKey]]) > 0; }
function _bstRelDefined(c, r) { return Array.isArray(c[r.key]) && c[r.key].length > 0; }
function _bstGetSlot(cid, key, scope) {
  const t = STORE.tracker[cid];
  if (!t) return '';
  if (scope === 'stat') return t[key] ?? '';
  return t.deductions?.[key] ?? '';
}
function _bstCarnetKeys(c) {
  const ks = BST_STAT_CARNET.filter(k => _bstStatDefined(c, k)).map(k => ({ key: k, scope: 'stat' }));
  (c.armesNaturelles || []).forEach((a, i) => ['nom', 'toucher', 'degats', 'portee', 'effet']
    .forEach(f => ks.push({ key: `arme_${f}_${a.id || `idx_${i}`}`, scope: 'ded' })));
  (c.actions || []).forEach((a, i) => ['nom', 'toucher', 'degats', 'portee', 'effet']
    .forEach(f => ks.push({ key: `act_${f}_${a.id || `idx_${i}`}`, scope: 'ded' })));
  (c.traits || []).forEach((_, i) => ['nom', 'desc'].forEach(f => ks.push({ key: `tr_${f}_${i}`, scope: 'ded' })));
  (c.butins || []).forEach((_, i) => ['nom', 'qte'].forEach(f => ks.push({ key: `but_${f}_${i}`, scope: 'ded' })));
  if (String(c.or || '').trim()) ['nom', 'qte'].forEach(f => ks.push({ key: `but_${f}_or`, scope: 'ded' }));
  DAMAGE_RELATIONS.filter(r => _bstRelDefined(c, r)).forEach(r => ks.push({ key: `rel_${r.key}`, scope: 'ded' }));
  return ks;
}
function _bstCarnetPct(c) {
  const ks = _bstCarnetKeys(c);
  const filled = ks.filter(k => String(_bstGetSlot(c.id, k.key, k.scope)).trim()).length;
  return { pct: ks.length ? Math.round(filled / ks.length * 100) : 0, filled, total: ks.length };
}
function _bstCarnetColor(p) {
  return p >= 80 ? 'var(--emerald)' : p >= 35 ? 'var(--amber)' : p > 0 ? 'var(--ember)' : 'var(--text-dim)';
}
function _bstRing(pct, size = 30, sw = 3) {
  const r = (size - sw) / 2, C = 2 * Math.PI * r;
  return `<span class="bst-ring" style="--kc:${_bstCarnetColor(pct)};width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}"><circle class="bg" cx="${size / 2}" cy="${size / 2}" r="${r}"/>
    <circle class="fg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}"/></svg>
    <b>${pct}</b></span>`;
}
function _bstHighlight(nom) {
  const q = _norm(STORE.searchVal).trim();
  const safe = _esc(nom || '');
  if (!q) return safe;
  const i = _norm(nom).indexOf(q);
  if (i < 0) return safe;
  return _esc(nom.slice(0, i)) + '<mark>' + _esc(nom.slice(i, i + q.length)) + '</mark>' + _esc(nom.slice(i + q.length));
}
// Portrait d'un joueur (perso favori) pour le picker de carnet. p=null → moi.
function _bstPlayerAvatar(p, size = 22) {
  const s = `width:${size}px;height:${size}px`;
  if (p && p.portraitUrl) return `<span class="bst-asp-av" style="${s};background-image:url('${_esc(p.portraitUrl)}')"></span>`;
  if (p) return `<span class="bst-asp-av is-i" style="${s}">${_esc(p.initial || '?')}</span>`;
  const meP = STATE.profile?.photoURL || STATE.profile?.photo || '';
  if (meP) return `<span class="bst-asp-av" style="${s};background-image:url('${_esc(meP)}')"></span>`;
  return `<span class="bst-asp-av is-i" style="${s}">${_esc((STATE.profile?.pseudo || 'M').charAt(0).toUpperCase())}</span>`;
}

function _damageTypeBadge(typeId, types, color) {
  const type = (types || []).find(t => t.id === typeId);
  const label = type ? `${_esc(type.label)}` : _esc(typeId);
  return `<span style="font-size:.72rem;padding:.18rem .5rem;border-radius:999px;border:1px solid ${color};color:${color};background:${color}1a">${label}</span>`;
}

function _renderRelationCard(rel, ids, types) {
  if (!Array.isArray(ids) || ids.length === 0) return '';
  return `<div style="display:flex;flex-direction:column;gap:.35rem;padding:.5rem .6rem;
    border:1px solid ${rel.color}33;background:${rel.color}10;border-radius:10px;border-left:3px solid ${rel.color}">
    <div style="display:flex;align-items:center;gap:.4rem">
      <span style="font-size:.9rem">${_esc(rel.shortLabel || '')}</span>
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
      const label = type ? `${_esc(type.label)}` : _esc(id);
      return `<span class="bst-dmg-tag" style="border-color:${rel.color}55;color:${rel.color}">${label}</span>`;
    }).join('');
    return `<div class="bst-dmg-card" style="border-color:${rel.color}33;border-left-color:${rel.color}">
      <div class="bst-dmg-head">
        <span class="bst-dmg-name" style="color:${rel.color}">${rel.label}</span>
        <span class="bst-dmg-rule">${rel.shortLabel}</span>
      </div>
      <div class="bst-dmg-tags">${tags}</div>
    </div>`;
  }).filter(Boolean);
  if (!cards.length) return '';
  return `<div class="bst-section">
    <div class="bst-section-title">Relations aux degats</div>
    <div class="bst-dmg-grid">${cards.join('')}</div>
  </div>`;
}

/** Mini-rÃ©cap pictogrammes pour la card admin (compact). */
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Ã‰DITION INLINE â€” Panneau admin (auto-save Firestore)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const _bstPending = {};
let _bstSaveTimer = null;

function _bstOptimisticPatch(id, patch = {}) {
  const idx = STORE.creatures.findIndex(c => c.id === id);
  if (idx >= 0) Object.assign(STORE.creatures[idx], patch);
  _bstRenderSig = _bstSig();
}

// Re-render d'UNE seule vignette en place (nom, rang, niveau, drapeaux, cachée)
// sans _render global → pas de saut de scroll ni de perte de focus panneau.
function _bstReplaceCard(id) {
  const c = STORE.creatures.find(x => x.id === id);
  const el = document.querySelector(`.bst-bc[data-beast-id="${id}"]`);
  if (c && el) el.outerHTML = _renderCard(c);
}

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
  _bstOptimisticPatch(id, patch);
  _bstPending[id] = { ...(_bstPending[id] || {}), ...patch };
  clearTimeout(_bstSaveTimer);
  _bstSaveTimer = setTimeout(_bstFlushSaves, 1200);
}

// Auto-save generique (texte / select)
function _bstUpdate(id, field, val) {
  _bstQueueSave(id, { [field]: val });
  _bstPatchCardBasics(id);
}
function _bstUpdateNum(id, field, val) {
  _bstQueueSave(id, { [field]: parseInt(val) || 0 });
  _bstPatchCardBasics(id);
}
function _bstToggleHidden(id) {
  const c = STORE.creatures.find(x => x.id === id);
  if (!c) return;
  const next = !c.hidden;
  c.hidden = next;
  _bstQueueSave(id, { hidden: next });
  _bstPatchHiddenUi(id, next);
}

function _bstPatchHiddenUi(id) {
  _bstReplaceCard(id);
  if (STORE.activeId === id) _syncActivePanel();   // chip du héros + '· cachée'
}

// Nom : sync visuel des cartes et du hero
function _bstUpdateNom(id, val) {
  _bstQueueSave(id, { nom: val });
  _bstReplaceCard(id);
}

function _bstPatchCardBasics(id) {
  _bstReplaceCard(id);
}

// Caracs : sauve + recalcule le modificateur affichÃ©
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

// Changement de rang : sauve + met Ã  jour cartes + panneau (couleurs + label)
function _bstSelectRangPanel(id, rang) {
  _bstQueueSave(id, { rang });
  _bstReplaceCard(id);
  if (STORE.activeId === id) _syncActivePanel();
}

// Toggle relation aux dÃ©gÃ¢ts
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
// Les attaques sont gÃ©rÃ©es via `actions` + `armesNaturelles` ailleurs.
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
    // butins : objets boutique. PrÃ©serve la dÃ©norm (nom/image) existante du
    // butin pour ne pas la perdre quand l'utilisateur modifie juste qte/chance
    // avant que le cache boutique soit chargÃ©.
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
  // Met Ã  jour le compteur en titre
  const countEl = document.querySelector(`[data-bst-count="${id}-${type}"]`);
  if (countEl) countEl.textContent = arr.length;
}

function _bstAddPanelRow(id, type) {
  const container = document.getElementById(`bst-p-${type}-${id}`);
  if (!container) return;
  // Seules les sections "traits" passent ici. Les butins ont leur propre picker,
  // les armes naturelles et actions ont leurs handlers dÃ©diÃ©s.
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
      <button class="bst-p-row-remove" data-bst-action="removeRow" data-id="${id}" data-type="traits" title="Retirer">x</button>
    </div>
    <input class="bst-p-input" data-f="desc" placeholder="Description..." value="${_esc(t.description||'')}" ${inputAttrs}>
  </div>`;
}

function _panelButinRow(b = {}, id, i) {
  // Carte compacte : pas de sÃ©lecteur â€” l'objet est piquÃ© via la modal picker.
  // Si l'item n'existe plus en boutique, on tombe sur les valeurs dÃ©normalisÃ©es.
  const items = _bstShopItemsCache || [];
  const ref   = b.itemId ? items.find(x => x.id === b.itemId) : null;
  const nom   = ref?.nom   || b.nom   || 'Objet supprime';
  const image = ref?.image || b.image || '';
  const rar   = ref?.rarete || '';
  const rarColor = _bstRarColor(rar);
  const orphan = b.itemId && !ref ? true : false;
  return `<div class="bst-p-row bst-butin-card${orphan?' is-orphan':''}" data-butin-id="${b.itemId || ''}" title="${_esc(nom)}${orphan?' (supprime de la boutique)':''}">
    <span class="bst-butin-dot" style="background:${rarColor}"></span>
    ${image
      ? `<img class="bst-butin-img" src="${_esc(image)}" alt="">`
      : `<span class="bst-butin-img bst-butin-img--empty">?</span>`}
    <span class="bst-butin-name">${_esc(nom)}${orphan?` <span class="bst-butin-orphan-tag">!</span>`:''}</span>
    <input class="bst-p-input bst-butin-mini" data-f="qte" type="text" placeholder="1" title="Quantite"
      value="${_esc(b.quantite||'')}"
      data-bst-action="saveArr" data-bst-on="input" data-id="${id}" data-type="butins">
    <input class="bst-p-input bst-butin-mini" data-f="chance" type="text" placeholder="100%" title="Chance"
      value="${_esc(b.chance||'')}"
      data-bst-action="saveArr" data-bst-on="input" data-id="${id}" data-type="butins">
    <input type="hidden" data-f="itemId" value="${_esc(b.itemId||'')}">
    <button class="bst-p-row-remove" data-bst-action="removeRow" data-id="${id}" data-type="butins" title="Retirer">x</button>
  </div>`;
}

// Couleur par raretÃ© â€” dÃ©lÃ¨gue au composant partagÃ©.
const _bstRarColor = getRareteColor;

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PICKER OBJET BOUTIQUE â€” utilise le composant partagÃ© shared/shop-picker.js
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function _bstButinPickerOpen(creatureId) {
  if (!creatureId) return;
  const c = STORE.creatures.find(x => x.id === creatureId);
  if (!c) return;
  await openShopPicker({
    title: 'Ajouter un butin',
    modalMode: 'push',
    hint: 'Tu peux enchainer les ajouts sans fermer cette fenetre.',
    ownedBadgeTitle: 'Deja dans le butin',
    alreadyPicked: () => new Set((c.butins || []).map(b => b.itemId).filter(Boolean)),
    onPick: (item) => {
      const butins = Array.isArray(c.butins) ? [...c.butins] : [];
      if (butins.find(b => b.itemId === item.id)) {
        showNotif('Deja dans le butin de cette creature', 'warning');
        return false; // empÃªche l'ajout
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

// Or lÃ¢chÃ© par la crÃ©ature : nombre brut ("20") ou formule de dÃ©s ("5d4").
// Le jet n'est pas fait ici â€” il l'est dans le VTT Ã  l'envoi vers la rÃ©serve MJ.
function _bstSaveOr(id, val) {
  const c = STORE.creatures.find(x => x.id === id);
  if (!c) return;
  c.or = String(val || '').trim();
  _bstQueueSave(id, { or: c.or });
}

// Matrice de relations aux dÃ©gÃ¢ts (panneau, version chips compacte)
function _renderDamageMatrixPanel(c, types) {
  return `<div class="bst-section">
    <div class="bst-section-title">Relations aux degats</div>
    <div class="bst-dmg-edit">
      ${DAMAGE_RELATIONS.map(rel => {
        const active = Array.isArray(c[rel.key]) ? c[rel.key] : [];
        return `<div class="bst-dmg-edit-row" style="border-left:3px solid ${rel.color};background:${rel.color}08">
          <div class="bst-dmg-edit-head">
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
                ${_esc(t.label)}
              </button>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

/**
 * Matrice unique : lignes = types de dÃ©gÃ¢ts, colonnes = catÃ©gories.
 * Vue compacte qui rend les conflits (un type cochÃ© dans 2 catÃ©gories)
 * immÃ©diatement visibles sur une mÃªme ligne.
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
          title="Ce type est selectionne dans plusieurs categories">!</span>
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

/** Met en Ã©vidence les types de dÃ©gÃ¢ts cochÃ©s dans plusieurs catÃ©gories (matrice). */
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// BANDEAU AVATARS â€” sÃ©lecteur de vue (MJ â†” joueur)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
export async function renderBestiary() {
  const content = document.getElementById('main-content');
  content.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-dim)"><div style="font-size:2rem">...</div></div>`;
  const target = consumeTargetEntity('bestiary');
  _pendingTargetBeastId = target?.id || _pendingTargetBeastId;

  // SÃ‰CURITÃ‰ : la vue "bestiaire d'un joueur" (viewAsUid) ne doit JAMAIS persister
  // hors d'une session admin ni Ã  travers un changement de compte. L'app est une
  // SPA (pas de reload au login) â†’ sans ce reset, l'uid d'un joueur prÃ©cÃ©demment
  // consultÃ© en MJ resterait collÃ© et ses estimations seraient Ã©crasÃ©es par le
  // compte suivant.
  if (!STATE.isAdmin || STORE._authUid !== STATE.user?.uid) STORE.viewAsUid = null;
  STORE._authUid = STATE.user?.uid || null;

  await _loadBestiaryRanks();

  // Admin : charger la liste des bestiaires disponibles
  if (STATE.isAdmin) {
    const meta = await getDocData('bestiary_meta', 'list');
    const list = meta?.list || [];
    if (!list.find(b => b.id === 'main')) list.unshift({ id:'main', label:'Bestiaire principal' });
    STORE.bestiaireList = list;

    // Liste des joueurs (uid + pseudo) pour la vue "bestiaire d'un joueur".
    // Source primaire : STATE.characters (dÃ©jÃ  chargÃ© via la page d'accueil).
    // Fallback : loadChars(null) si on arrive direct au bestiaire.
    let chars = STATE.characters;
    if (!chars || !chars.length) {
      try { chars = await loadChars(null); } catch { chars = []; }
    }
    // Portrait du PJ : mÃªme ordre de fallback que le VTT pour la cohÃ©rence.
    // Tout est dÃ©jÃ  en mÃ©moire (STATE.characters), aucune lecture Firestore en plus.
    const seen = new Map();
    // ItÃ¨re sur la liste triÃ©e â†’ le perso â˜… par dÃ©faut est rencontrÃ© en premier
    // pour chaque uid, et devient donc le "visage" du joueur.
    sortCharactersForDisplay(chars || []).forEach(c => {
      if (!c?.uid || c.uid === STATE.user?.uid) return;
      const pseudo = c.ownerPseudo || c.nom || c.uid;
      const photo  = c.photoURL || c.photo || c.avatar || c.portraitUrl || c.imageUrl || '';
      const existing = seen.get(c.uid);
      // Le premier rencontrÃ© (â˜… par dÃ©faut) gagne, sauf si lui n'a pas de photo
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

  // Bestiaire actif â€” hydratÃ© depuis le cache TTL (instant si chaud) puis
  // tenu Ã  jour par le watch ci-dessous.
  const col = STORE.bestiaireId === 'main' ? 'bestiary' : `bestiary_${STORE.bestiaireId}`;
  STORE.tracker = {};
  STORE.currentCol = col;

  if (!STORE.damageTypes) STORE.damageTypes = await loadDamageTypes();

  const cachedCreatures = getCachedCollection(col);
  _bstApplyData(cachedCreatures || []);
  _render();

  const trackerUid = (STATE.isAdmin && STORE.viewAsUid) || STATE.user?.uid;

  // â”€â”€ Abonnements temps rÃ©el â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Les noms 'bst-creatures'/'bst-tracker' sont rÃ©utilisÃ©s : si l'admin
  // switche de bestiaire/viewAs, watch() kill l'ancien listener et crÃ©e
  // le nouveau sur la bonne collection / doc.
  watchPageCollection('bst-creatures', col, 'bestiaire', data => {
    if (_bstShouldSkipLiveRender()) return;
    _bstApplyData(data);
    if (_bstSig() === _bstRenderSig) return;
    _render();
  });

  watchPageDoc('bst-ranks', 'bestiary_meta', 'ranks', 'bestiaire', doc => {
    _setBestiaryRanks(doc?.ranks);
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

// Applique une liste fraÃ®che Ã  STORE.creatures : filtre les `hidden` pour les
// joueurs et trie par ordre manuel puis par nom. Source unique utilisÃ©e par le watch et l'hydratation
// â€” toute logique de mise Ã  jour de la liste doit passer par ici.
function _bstApplyData(all) {
  const arr = all || [];
  STORE.creatures = (STATE.isAdmin ? [...arr] : arr.filter(c => !c.hidden))
    .sort(_bstCompareCreatures);
  if (_pendingTargetBeastId && STORE.creatures.some(c => c.id === _pendingTargetBeastId)) {
    STORE.activeId = _pendingTargetBeastId;
    STORE.searchVal = '';
    STORE.filterType = '';
    STORE.filterRang = '';
    _pendingTargetBeastId = null;
  }
}

// Re-charge STORE.creatures depuis loadCollection (cache TTL en mÃ©moire patchÃ© par
// addToCol/updateInCol/deleteFromCol, sinon IndexedDB Firestore). Sert Ã 
// rester cohÃ©rent juste aprÃ¨s une opÃ©ration CRUD, sans dÃ©pendre du timing du
// watch (qui peut Ãªtre skippÃ© si un input du panneau prÃ©cÃ©dent a le focus).
async function _bstHydrate() {
  const col = STORE.currentCol || 'bestiary';
  _bstApplyData(await loadCollection(col));
}

// â”€â”€ Drag & drop : ordre manuel partagÃ© â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  return [...(grid || document).querySelectorAll('.bst-bc[data-beast-id]')]
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
  if (!_canReorderBestiary() || visibleOrder.length !== STORE.creatures.length) return false;
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
  if (!_canReorderBestiary()) return;

  const grid = document.querySelector('.bst-grid.bst-sortable');
  if (!grid) return;

  _installBestiaryClickGuard();
  _bstSortable = makeSortable(grid, {
    prefix: 'bst',
    animation: 120,
    draggable: '.bst-sortable-item',
    handle: '.bst-bc-drag',
    // Le filtre partagé contient `button`. Or une carte du bestiaire est elle-même
    // un bouton : Sortable remontait jusqu'à sa racine et annulait tout drag.
    filter: 'a, input, select, textarea, .btn, .btn-icon, [data-no-drag]',
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
        if (changed) showNotif('Ordre du bestiaire sauvegarde.', 'success');
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

// Signature des donnÃ©es qui pilotent le rendu de la page (cartes + panneau
// joueur). Mise Ã  jour par _render Ã  la fin, comparÃ©e par les watchers
// onSnapshot avant de re-rendre : un fire qui n'apporte aucun changement
// (cache â†’ serveur, hydratation â†’ 1er fire) ne reconstruit pas le DOM et
// les cartes ne clignotent pas.
let _bstRenderSig = '';
// SÃ©rialisation stable (clÃ©s triÃ©es rÃ©cursivement) : Firestore renvoie les clÃ©s
// de map triÃ©es alphabÃ©tiquement alors que l'objet local est en ordre d'insertion.
// Sans Ã§a, l'Ã©cho d'une Ã©criture crÃ©ant de nouvelles clÃ©s (1re estimation saisie)
// produirait une signature diffÃ©rente â†’ _render() inutile â†’ scroll qui remonte.
function _stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(_stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + _stableStringify(v[k])).join(',') + '}';
}
function _bstSig() { return JSON.stringify(STORE.creatures) + '|' + _stableStringify(STORE.tracker); }

// Ã‰vite d'Ã©craser une Ã©dition admin en cours : la fiche du panneau a des
// inputs/textarea avec auto-save debouncÃ© (_bstQueueSave 400ms). Si on
// re-render alors qu'un champ est focus, le curseur saute. On prÃ©fÃ¨re
// attendre le prochain snapshot (qui arrivera aprÃ¨s la sauvegarde).
function _bstShouldSkipLiveRender() {
  if (_bstReordering || document.body.classList.contains('bst-dragging')) return true;
  if (Object.keys(_bstPending).length) return true;
  const ae = document.activeElement;
  if (!ae) return false;
  const tag = ae.tagName;
  if (
    tag !== 'INPUT' &&
    tag !== 'TEXTAREA' &&
    tag !== 'SELECT' &&
    tag !== 'BUTTON' &&
    !ae.isContentEditable
  ) return false;
  const main = document.getElementById('main-content');
  return !!(main && main.contains(ae));
}

// â”€â”€ CrÃ©ation rapide d'une crÃ©ature sans modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function _bstCreateDraft() {
  if (!STATE.isAdmin) return;
  const col = STORE.currentCol || 'bestiary';
  const data = {
    nom: 'Nouvelle creature', emoji: '?', rang: _defaultRankId(),
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

// ══════════════════════════════════════════════════════════════════════════
// INTERACTION REFONTE — fiche à trous, menu contextuel, clavier, scroll-spy
// ══════════════════════════════════════════════════════════════════════════
let _bstInputBound = false;
let _bstEditingSlot = null;
let _bstFocusIdx = -1;
let _bstToastT = null;

function _bstToast(msg) {
  const t = document.getElementById('bst-toast'); if (!t) return;
  t.textContent = msg; t.classList.add('on');
  clearTimeout(_bstToastT); _bstToastT = setTimeout(() => t.classList.remove('on'), 2100);
}

// Un trou du carnet : imprimé si rempli, pointillé cliquable sinon.
function _bstSlot(cid, key, scope, opts = {}) {
  const v = _bstGetSlot(cid, key, scope);
  const cls = ['bst-slot', v ? 'full' : '', opts.wide ? 'wide' : '', opts.strong ? 'strong' : ''].filter(Boolean).join(' ');
  return `<span class="${cls}" role="button" tabindex="0" data-slot-key="${_esc(key)}" data-scope="${scope}" data-cid="${_esc(cid)}" data-val="${_esc(v)}" data-ph="${_esc(opts.ph || '')}">${v ? _esc(v) : _esc(opts.hole || '?')}</span>`;
}
// Transforme un trou en input, valide/annule, saute au suivant.
function _bstSlotOpen(el) {
  if (_bstEditingSlot || !el) return;
  const { cid, slotKey, scope, val, ph } = el.dataset;
  _bstEditingSlot = el;
  el.innerHTML = `<input class="bst-slotin" value="${_esc(val || '')}" placeholder="${_esc(ph || '')}">`;
  const inp = el.firstElementChild; inp.focus(); inp.select();
  let done = false;
  const panelSlot = () => document.querySelector('.bst-panel-slot');
  // Préserve le scroll du corps du panneau : _syncActivePanel réécrit l'innerHTML
  // et remettrait la fiche en haut à chaque validation.
  const scrollTop = () => document.querySelector('.bst-pn-b')?.scrollTop || 0;
  const restoreScroll = (top) => { const b = document.querySelector('.bst-pn-b'); if (b) b.scrollTop = top; };
  const finish = (next) => {
    if (done) return; done = true; _bstEditingSlot = null;
    const v = inp.value;
    const top = scrollTop();
    if (scope === 'stat') _bstSetStat(cid, slotKey, v);
    else _bstSetDeduction(cid, slotKey, v);
    const slots = panelSlot() ? [...panelSlot().querySelectorAll('.bst-slot')] : [];
    const idx = slots.indexOf(el);
    _syncActivePanel();          // reflète valeur + ligne .done + anneau + compteur
    _bstReplaceCard(cid);        // anneau de carnet sur la vignette
    restoreScroll(top);
    if (next) {
      const l2 = panelSlot() ? [...panelSlot().querySelectorAll('.bst-slot')] : [];
      const nx = l2[idx + 1] || l2[0];
      if (nx) _bstSlotOpen(nx);
    }
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); const top = scrollTop(); done = true; _bstEditingSlot = null; _syncActivePanel(); restoreScroll(top); }
  });
  inp.addEventListener('blur', () => setTimeout(() => finish(false), 0));
}

// ── Menu contextuel ─────────────────────────────────────────────────────────
function _bstOpenCtx(x, y, c) {
  const m = document.getElementById('bst-ctx'); if (!m) return;
  const admin = _isAdminView();
  m.innerHTML = `<div class="bst-ctx-h"><b>${_esc(c.nom || '?')}</b>${_esc(_rankStyle(c.rang || _defaultRankId()).label)}</div>
    <button data-bst-action="open" data-id="${_esc(c.id)}"><i>›</i>Ouvrir la fiche</button>
    ${admin ? `
      <button data-bst-action="openImage" data-id="${_esc(c.id)}"><i>▣</i>${c.imageUrl ? 'Changer' : 'Ajouter'} l'illustration</button>
      ${c.imageUrl ? `<button data-bst-action="removeImage" data-id="${_esc(c.id)}"><i>▢</i>Retirer l'illustration</button>` : ''}
      <button data-bst-action="duplicateBeast" data-id="${_esc(c.id)}"><i>⧉</i>Dupliquer</button>
      <button data-bst-action="quickToggleHidden" data-id="${_esc(c.id)}"><i>${c.hidden ? '◉' : '◒'}</i>${c.hidden ? 'Rendre visible' : 'Cacher aux joueurs'}</button>
      <hr><button class="dngr" data-bst-action="deleteBeast" data-id="${_esc(c.id)}"><i>⌫</i>Supprimer</button>`
    : `<button data-bst-action="clearCarnet" data-id="${_esc(c.id)}"><i>⌫</i>Effacer mes notes</button>`}`;
  m.classList.add('on');
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, window.innerWidth - r.width - 10) + 'px';
  m.style.top = Math.min(y, window.innerHeight - r.height - 10) + 'px';
}
function _bstCloseCtx() { document.getElementById('bst-ctx')?.classList.remove('on'); }
function _bstClearCarnet(id) {
  delete STORE.tracker[id];
  _saveTracker();
  _bstToast('Notes effacées');
  _syncActivePanel(); _bstReplaceCard(id);
}

// ── Sommaire collant (scroll-spy) ────────────────────────────────────────────
function _bstSpy() {
  const body = document.querySelector('.bst-pn-b'); if (!body) return;
  const secs = [...body.querySelectorAll('.bst-sc')];
  let cur = secs[0];
  secs.forEach(s => { if (s.offsetTop - body.scrollTop <= 56) cur = s; });
  document.querySelectorAll('.bst-pnav button').forEach(b => b.classList.toggle('on', b.dataset.bstSec === cur?.id));
}
function _bstBindPanelSpy() {
  const body = document.querySelector('.bst-pn-b');
  if (!body || body._spyBound) return;
  body._spyBound = true;
  body.addEventListener('scroll', _bstSpy, { passive: true });
  _bstSpy();
}
function _bstScrollToSection(id) {
  const t = document.getElementById(id), body = document.querySelector('.bst-pn-b');
  if (t && body) body.scrollTo({ top: t.offsetTop - 6, behavior: 'smooth' });
}

// ── Listeners globaux (installés une fois) ───────────────────────────────────
function _bstInstallInput() {
  if (_bstInputBound) return;
  _bstInputBound = true;
  const inPage = () => !!document.getElementById('bst-root');

  document.addEventListener('click', (e) => {
    if (!inPage()) return;
    const ctx = document.getElementById('bst-ctx');
    if (ctx?.classList.contains('on')) {
      if (!e.target.closest('#bst-ctx')) _bstCloseCtx();
      else setTimeout(_bstCloseCtx, 0);   // laisse l'action data-bst-action s'exécuter
    }
    document.querySelectorAll('.bst-asp[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; });
    const slot = e.target.closest?.('.bst-slot');
    if (slot && !_isAdminView()) { _bstSlotOpen(slot); return; }
    const sec = e.target.closest?.('[data-bst-sec]');
    if (sec) { _bstScrollToSection(sec.dataset.bstSec); return; }
    const bc = e.target.closest?.('.bst-bc');
    if (bc) { _bstFocusIdx = [...document.querySelectorAll('.bst-bc')].indexOf(bc); }
  });

  document.addEventListener('contextmenu', (e) => {
    if (!inPage()) return;
    const bc = e.target.closest?.('.bst-bc'); if (!bc) return;
    e.preventDefault();
    const c = STORE.creatures.find(x => x.id === bc.dataset.id);
    if (c) _bstOpenCtx(e.clientX, e.clientY, c);
  });

  document.addEventListener('keydown', (e) => {
    if (!inPage() || _bstEditingSlot) return;
    const slot = e.target.closest?.('.bst-slot');
    if (slot && !_isAdminView()) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _bstSlotOpen(slot); }
      else if (e.key === 'Escape') slot.blur();
      return;
    }
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    const search = document.getElementById('bst-search');
    if (e.key === '/' && !inField) { e.preventDefault(); search?.focus(); search?.select(); return; }
    if (e.key === 'Escape') {
      if (inField) { e.target.blur(); return; }
      if (document.getElementById('bst-ctx')?.classList.contains('on')) { _bstCloseCtx(); return; }
      if (STORE.activeId) _bstClose();
      return;
    }
    if (inField && e.target.id !== 'bst-search') return;
    const cards = [...document.querySelectorAll('.bst-bc')];
    if (!cards.length) return;
    if (_bstFocusIdx < 0) _bstFocusIdx = Math.max(0, cards.findIndex(x => x.dataset.id === STORE.activeId));
    const grid = document.querySelector('.bst-grid');
    const cols = grid ? Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length) : 1;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (step) {
      e.preventDefault();
      _bstFocusIdx = Math.max(0, Math.min(cards.length - 1, _bstFocusIdx + step));
      const t = cards[_bstFocusIdx];
      STORE.activeId = t.dataset.id; _syncActivePanel();
      document.querySelectorAll('.bst-bc')[_bstFocusIdx]?.focus({ preventScroll: false });
      return;
    }
    if (e.key === 'Enter' && _bstFocusIdx >= 0 && !inField) {
      e.preventDefault();
      STORE.activeId = cards[_bstFocusIdx].dataset.id; _syncActivePanel();
    }
  });
}

function _render() {
  const content = document.getElementById('main-content');

  const sameActive = STORE.activeId && STORE.activeId === _bstRenderedActiveId;
  const prevSlotTop = sameActive ? (content.querySelector('.bst-pn-b')?.scrollTop || 0) : 0;
  const prevContentTop = sameActive ? (content.scrollTop || 0) : 0;
  const prevWinTop = sameActive ? (window.scrollY || 0) : 0;
  const focusState = _bstCaptureFocusState(content);

  const admin = _isAdminView();
  const pool = STORE.creatures.filter(c => admin || !c.hidden);
  const allTypes = [...new Set(pool.map(c => c.type || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const filtered = STORE.creatures.filter(c => _beastMatchesFilters(c));
  const hasFilters = Boolean(STORE.searchVal || STORE.filterType || STORE.filterRang || STORE.filterPrep);
  const canReorder = _canReorderBestiary();
  const byRang = Object.fromEntries(BESTIARY_RANKS.map(r => [r.id, 0]));
  pool.forEach(c => { const r = RANG_STYLE[c.rang] ? c.rang : _defaultRankId(); byRang[r] = (byRang[r] || 0) + 1; });

  const kicker = admin ? 'Cartulaire des bêtes' : 'Mon carnet de terrain';
  const scopeSel = STATE.isAdmin ? `<div class="bst-scope"><small>Recueil</small>
    <select data-bst-action="selectBest" data-bst-on="change" aria-label="Recueil">
      ${(STORE.bestiaireList || [{ id: 'main', label: 'Bestiaire principal' }]).map(b => `<option value="${_esc(b.id)}"${b.id === STORE.bestiaireId ? ' selected' : ''}>${_esc(b.label)}</option>`).join('')}
      <option value="__new__">+ Nouveau recueil…</option>
    </select></div>` : '';
  const roleSeg = STATE.isAdmin ? `<div class="bst-segm">
    <button data-bst-action="setRole" data-role="mj" class="${STORE.role !== 'player' ? 'on' : ''}">Vue MJ</button>
    <button data-bst-action="setRole" data-role="player" class="${STORE.role === 'player' ? 'on' : ''}">Vue joueur</button>
  </div>` : '';
  const cur = STORE.playersList.find(p => p.uid === STORE.viewAsUid) || null;
  const asPlayerSel = (STATE.isAdmin && STORE.role === 'player' && STORE.playersList.length) ? `
    <details class="bst-asp">
      <summary class="bst-asp-btn">${_bstPlayerAvatar(cur)}<span>${cur ? `Carnet de ${_esc(cur.pseudo)}` : 'Mon propre carnet'}</span><i>▾</i></summary>
      <div class="bst-asp-pop">
        <button data-bst-action="pickPlayer" data-uid=""${!cur ? ' class="on"' : ''}>${_bstPlayerAvatar(null)}<span>Mon propre carnet</span></button>
        ${STORE.playersList.map(p => `<button data-bst-action="pickPlayer" data-uid="${_esc(p.uid)}"${p.uid === STORE.viewAsUid ? ' class="on"' : ''}>${_bstPlayerAvatar(p)}<span>Carnet de ${_esc(p.pseudo)}</span></button>`).join('')}
      </div>
    </details>` : '';
  const headActs = admin ? `
    <button class="bst-pill" data-action="openBestiaryRanksAdmin">Rangs</button>
    <button class="bst-pill" data-bst-action="exportBeasts">Exporter</button>
    <button class="bst-pill go" data-bst-action="createDraft">+ Créature</button>` : '';

  const rangSeg = `<div class="bst-fseg">
    <button data-bst-action="setRang" data-rang="" class="${STORE.filterRang === '' ? 'on' : ''}">Tous rangs <em>${pool.length}</em></button>
    ${BESTIARY_RANKS.map(r => `<button data-bst-action="setRang" data-rang="${_esc(r.id)}" class="${STORE.filterRang === r.id ? 'on' : ''}" style="--tone:${r.color}"><i></i>${_esc(r.plural || r.label)} <em>${byRang[r.id] || 0}</em></button>`).join('')}
  </div>`;
  const typeSel = `<select class="bst-fsel${STORE.filterType ? ' on' : ''}" data-bst-action="setType" data-bst-on="change" aria-label="Type">
    <option value="">Tous les types</option>
    ${allTypes.map(t => `<option value="${_esc(t)}"${_norm(t) === _norm(STORE.filterType) ? ' selected' : ''}>${_esc(t)}</option>`).join('')}
  </select>`;

  let counterBar;
  if (admin) {
    const nReady = pool.filter(c => _beastMatchesPrep(c, 'ready')).length;
    const nTodo = pool.filter(c => _beastMatchesPrep(c, 'todo')).length;
    const nHidden = pool.filter(c => _beastMatchesPrep(c, 'hidden')).length;
    counterBar = `<div class="bst-prep">
      <button data-bst-action="setPrep" data-prep="" class="${STORE.filterPrep === '' ? 'on' : ''}" style="--pc:var(--text-soft)"><b>${pool.length}</b> fiches</button>
      <button data-bst-action="setPrep" data-prep="ready" class="${STORE.filterPrep === 'ready' ? 'on' : ''}" style="--pc:var(--emerald)"><i></i><b>${nReady}</b> prêtes</button>
      <button data-bst-action="setPrep" data-prep="todo" class="${STORE.filterPrep === 'todo' ? 'on' : ''}" style="--pc:var(--crimson)"><i></i><b>${nTodo}</b> injouables</button>
      <button data-bst-action="setPrep" data-prep="hidden" class="${STORE.filterPrep === 'hidden' ? 'on' : ''}" style="--pc:var(--arcane)"><i></i><b>${nHidden}</b> cachées</button>
    </div>`;
  } else {
    const tot = pool.reduce((a, c) => { const k = _bstCarnetPct(c); return { f: a.f + k.filled, t: a.t + k.total }; }, { f: 0, t: 0 });
    const p = tot.t ? Math.round(tot.f / tot.t * 100) : 0;
    const seen = pool.filter(c => _bstCarnetPct(c).filled > 0).length;
    counterBar = `<div class="bst-prep">
      <button class="on" style="--pc:var(--text-soft)"><b>${pool.length}</b> créatures</button>
      <button style="--pc:${_bstCarnetColor(p)}"><i></i><b>${seen}</b> rencontrées</button>
      <button style="--pc:${_bstCarnetColor(p)}"><b>${p}%</b> de carnet</button>
    </div>`;
  }

  const searchField = `<div class="bst-srch">
    <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.3-4.3"/></svg>
    <input type="text" id="bst-search" placeholder="Nom, type, environnement, trait, butin…" value="${_esc(STORE.searchVal)}" autocomplete="off" data-bst-action="search" data-bst-on="input">
    ${STORE.searchVal ? `<button class="clr" data-bst-action="clearSearch" title="Effacer">×</button>` : `<kbd>/</kbd>`}
  </div>`;

  const reorderHint = canReorder
    ? ` · <span class="bst-drag-key">⠿</span> <b>glisser pour réordonner</b>`
    : (admin && STORE.bestiaireId === 'main' && hasFilters
      ? ` · <b>réinitialiser les filtres pour réordonner</b>`
      : '');
  const gridnote = admin
    ? `<span class="kb">/</span> chercher · <span class="kb">↑↓←→</span> parcourir · <span class="kb">↵</span> ouvrir${reorderHint} · <b>clic droit</b> pour gérer une fiche`
    : `<span class="kb">/</span> chercher · <span class="kb">↵</span> ouvrir · dans la fiche, <b>chaque « ? » se remplit au clic</b> et <span class="kb">↵</span> saute au trou suivant`;

  content.innerHTML = `
  <div class="bst-root" id="bst-root">
    <div class="bst-top">
      <div class="bst-top-in">
        <div class="bst-top-row">
          <div class="bst-brand"><h1>Bestiaire</h1><small>${kicker}</small></div>
          <span class="bst-spacer"></span>
          ${scopeSel}${roleSeg}${asPlayerSel}
          <div class="bst-headacts">${headActs}</div>
        </div>
        <div class="bst-fbar">
          ${searchField}${rangSeg}${typeSel}${counterBar}
          <span class="bst-fcnt"><b>${filtered.length}</b> affichée${filtered.length > 1 ? 's' : ''}</span>
          ${hasFilters ? `<button class="bst-freset" data-bst-action="resetFilters">Tout réinitialiser</button>` : ''}
        </div>
      </div>
    </div>
    <div class="bst-wrap">
      ${_isViewingPlayer() ? `<div class="bst-view-banner"><span>Vue joueur</span><b>${_esc(STORE.playersList.find(p => p.uid === STORE.viewAsUid)?.pseudo || 'joueur')}</b><button data-bst-action="viewAs" data-uid="">Revenir à mon carnet</button></div>` : ''}
      <div class="bst-gridnote">${gridnote}</div>
      <div class="bst-main ${STORE.activeId ? '' : 'solo'}" id="bst-main">
        <section>
          <div class="bst-grid${canReorder ? ' bst-sortable' : ''}">
            ${filtered.length ? filtered.map(c => _renderCard(c, canReorder)).join('') : `<div class="bst-emptyg"><b>${STORE.creatures.length ? 'Aucun résultat' : 'Recueil vide'}</b>${STORE.searchVal ? `Rien ne correspond à « ${_esc(STORE.searchVal)} ».` : (admin ? 'Ajoute une créature pour commencer.' : 'Reviens quand tu auras rencontré des créatures.')}</div>`}
          </div>
        </section>
        <aside class="bst-panel-slot" id="bst-panel-slot">${STORE.activeId ? _renderPanel(STORE.creatures.find(c => c.id === STORE.activeId)) : ''}</aside>
      </div>
    </div>
    <div class="bst-ctx" id="bst-ctx"></div>
    <div class="bst-toast" id="bst-toast"></div>
  </div>`;

  _mountBestiarySortable();
  _bstInstallInput();
  _bstBindPanelSpy();

  if (sameActive) {
    const slot = content.querySelector('.bst-pn-b');
    if (slot && prevSlotTop) slot.scrollTop = prevSlotTop;
    if (prevContentTop) content.scrollTop = prevContentTop;
    if (prevWinTop) window.scrollTo(0, prevWinTop);
  }
  _bstRestoreFocusState(content, focusState);
  _bstRenderedActiveId = STORE.activeId;
  _bstRenderSig = _bstSig();
}

function _bstCaptureFocusState(root) {
  const el = document.activeElement;
  if (!root || !el || !root.contains(el)) return null;
  if (!el.matches?.('input, textarea, select, [contenteditable="true"]')) return null;
  const esc = (value) => globalThis.CSS?.escape
    ? globalThis.CSS.escape(String(value))
    : String(value).replace(/["\\]/g, '\\$&');
  const selector = [
    el.dataset?.bstAction ? `[data-bst-action="${esc(el.dataset.bstAction)}"]` : '',
    el.dataset?.id ? `[data-id="${esc(el.dataset.id)}"]` : '',
    el.dataset?.field ? `[data-field="${esc(el.dataset.field)}"]` : '',
    el.dataset?.key ? `[data-key="${esc(el.dataset.key)}"]` : '',
    el.dataset?.type ? `[data-type="${esc(el.dataset.type)}"]` : '',
    el.dataset?.f ? `[data-f="${esc(el.dataset.f)}"]` : '',
    el.id ? `#${esc(el.id)}` : '',
  ].filter(Boolean).join('');
  const matches = selector ? [...root.querySelectorAll(selector)] : [];
  return {
    selector,
    index: Math.max(0, matches.indexOf(el)),
    value: 'value' in el ? el.value : '',
    start: Number.isFinite(el.selectionStart) ? el.selectionStart : null,
    end: Number.isFinite(el.selectionEnd) ? el.selectionEnd : null,
  };
}

function _bstRestoreFocusState(root, state) {
  if (!root || !state?.selector) return;
  const matches = [...root.querySelectorAll(state.selector)];
  const el = matches[state.index] || matches[0];
  if (!el) return;
  if ('value' in el && state.value !== undefined) el.value = state.value;
  el.focus?.({ preventScroll: true });
  if (state.start !== null && typeof el.setSelectionRange === 'function') {
    try { el.setSelectionRange(state.start, state.end ?? state.start); } catch {}
  }
}

// â”€â”€ Card crÃ©ature â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function _renderCard(c, sortable = _canReorderBestiary()) {
  const rs = _rankStyle(c.rang || _defaultRankId());
  const admin = _isAdminView();
  const hard = admin ? _beastHardAlerts(c) : [];
  const pct = admin ? 0 : _bstCarnetPct(c).pct;
  const sub = [c.type, c.environnement].filter(Boolean).join(' · ') || 'Sans classification';
  const isActive = c.id === STORE.activeId;
  return `<button class="bst-bc${isActive ? ' on' : ''}${c.hidden && admin ? ' hid' : ''}${sortable ? ' bst-sortable-item' : ''}"
    style="--rc:${rs.color}" data-beast-id="${_esc(c.id)}" data-bst-action="open" data-id="${_esc(c.id)}">
    <span class="bst-bc-r"></span>
    <span class="bst-bc-m">
      ${c.imageUrl ? `<img src="${_esc(c.imageUrl)}" alt="" loading="lazy">` : `<span class="bst-bc-e">${_esc(c.emoji || '❓')}</span>`}
      <span class="bst-bc-flags">
        ${hard.length ? `<span class="bst-bc-flag warn" title="${_esc(hard.map(a => a.label).join(' · '))}">!</span>` : ''}
        ${c.hidden && admin ? `<span class="bst-bc-flag eye" title="Cachée aux joueurs">◒</span>` : ''}
      </span>
      ${c.niveau ? `<span class="bst-bc-lv">Niv. ${_esc(c.niveau)}</span>` : ''}
      ${!admin ? _bstRing(pct) : ''}
    </span>
    <span class="bst-bc-b">
      <span class="bst-bc-n"><i></i><span class="bst-bc-name">${_bstHighlight(c.nom || '?')}</span>${sortable ? `<span class="bst-bc-drag" title="Glisser pour déplacer" aria-hidden="true">⠿</span>` : ''}</span>
      <span class="bst-bc-t">${_esc(sub)}</span>
    </span>
  </button>`;
}
function _bstPanelShell(c, rs, SEC, bodyHtml, isMJ) {
  return `<div class="bst-pn" style="--rc:${rs.color}">
    <div class="bst-pn-hero">
      ${c.imageUrl ? `<img src="${_esc(c.imageUrl)}" alt="">` : `<span class="bst-pn-e">${_esc(c.emoji || '❓')}</span>`}
      ${isMJ ? `<span class="bst-pn-badge">MJ</span>` : ''}
      <button class="bst-pn-x" data-bst-action="close" title="Fermer">×</button>
      <div class="bst-pn-id">
        <span class="bst-pn-rk"><i></i>${_esc(rs.label)}${c.hidden && isMJ ? ' · cachée' : ''}</span>
        <span class="bst-pn-nm">${_esc(c.nom || '?')}</span>
        <span class="bst-pn-mt">${_esc([c.type, c.environnement].filter(Boolean).join(' · ') || 'Sans classification')}${c.niveau ? ` · niveau ${_esc(c.niveau)}` : ''}</span>
      </div>
    </div>
    <nav class="bst-pnav">${SEC.map(([id, lbl]) => `<button data-bst-sec="${id}">${_esc(lbl)}</button>`).join('')}</nav>
    <div class="bst-pn-b">${bodyHtml}</div>
  </div>`;
}

function _renderPanel(c) {
  if (!c) return '';
  const rs = _rankStyle(c.rang || _defaultRankId());

  // MJ : panneau entièrement éditable (auto-save Firestore)
  if (_isAdminView()) return _renderPanelAdmin(c, rs);

  // ── Vue joueur : fiche à trous ──────────────────────────────────────────
  const cid = c.id;
  const k = _bstCarnetPct(c);
  const kc = _bstCarnetColor(k.pct);
  const C = 2 * Math.PI * 17.25;
  const armes = Array.isArray(c.armesNaturelles) ? c.armesNaturelles : [];
  const acts = Array.isArray(c.actions) ? c.actions : [];
  const traits = Array.isArray(c.traits) ? c.traits : [];
  const butins = Array.isArray(c.butins) ? c.butins : [];
  const hasOr = String(c.or || '').trim().length > 0;
  const STAT = [['pv', 'PV', 'pvActuel'], ['pm', 'PM', 'pmActuel'], ['ca', 'CA', 'caEstimee'], ['vt', 'Vit.', 'vitEstimee'], ['xp', 'XP', 'xpEstimee']];
  const statDefs = STAT.filter(([, , key]) => _bstStatDefined(c, key));   // seules les stats réellement renseignées par le MJ
  const statFilled = statDefs.filter(([, , key]) => _bstGetSlot(cid, key, 'stat')).length;
  const relDefs = DAMAGE_RELATIONS.filter(r => _bstRelDefined(c, r));

  const obsRow = (prefix, key, i, label) => {
    const ks = ['nom', 'toucher', 'degats', 'portee', 'effet'].map(f => `${prefix}_${f}_${key}`);
    const done = ks.every(kk => _bstGetSlot(cid, kk, 'ded'));
    return `<div class="bst-jrow${done ? ' done' : ''}">
      <div class="bst-jrow-t"><span class="ix">${label} ${i + 1}</span>${_bstSlot(cid, ks[0], 'ded', { wide: true, strong: true, ph: 'Nom observé', hole: 'nom inconnu' })}</div>
      <div class="bst-jg3">
        <label><em>Toucher</em>${_bstSlot(cid, ks[1], 'ded', { wide: true, ph: '+5' })}</label>
        <label><em>Dégâts</em>${_bstSlot(cid, ks[2], 'ded', { wide: true, ph: '2d6' })}</label>
        <label><em>Portée</em>${_bstSlot(cid, ks[3], 'ded', { wide: true, ph: 'contact' })}</label>
      </div>
      <div class="bst-jrow-e"><em>Effet observé</em>${_bstSlot(cid, ks[4], 'ded', { wide: true, ph: 'ce que ça fait…', hole: 'rien noté' })}</div>
    </div>`;
  };

  const SEC = [['s-stats', 'Estimations'], ['s-desc', 'Apparence'], ['s-atk', 'Attaques'], ['s-traits', 'Traits'], ['s-loot', 'Butin'], ['s-dmg', 'Dégâts']];

  const body = `
    <div class="bst-carnet" style="--kc:${kc}">
      <span class="cring"><svg width="38" height="38"><circle class="bg" cx="19" cy="19" r="17.25"/>
        <circle class="fg" cx="19" cy="19" r="17.25" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - k.pct / 100)}"/></svg><b>${k.pct}</b></span>
      <span class="txt"><b>${k.filled} / ${k.total} informations notées</b>
        <small>Ce qui est en pointillés est un trou de ton carnet. Clique pour le remplir, <kbd>↵</kbd> saute au suivant.</small></span>
    </div>
    <section class="bst-sc" id="s-stats"><div class="bst-sc-h"><b>Ce que tu estimes</b><em>${statFilled}/${statDefs.length}</em></div>
      <div class="bst-hint">Ces chiffres sont les tiens : ils apparaissent aussi sur le token, au VTT, à la place des « ? ». Une case « — » ne s'applique pas à cette créature.</div>
      <div class="bst-stats5">${STAT.map(([cls, lbl, key]) => {
        if (!_bstStatDefined(c, key)) return `<div class="bst-st ${cls} na" title="Non applicable à cette créature"><small>${lbl}</small><span class="bst-na">—</span></div>`;
        const v = _bstGetSlot(cid, key, 'stat');
        return `<div class="bst-st ${cls}${v ? '' : ' void'}"><small>${lbl}</small>${_bstSlot(cid, key, 'stat', { wide: true, strong: true, ph: '?' })}</div>`;
      }).join('')}</div>
    </section>
    <section class="bst-sc" id="s-desc"><div class="bst-sc-h"><b>Ce que tu vois</b></div>
      ${c.description ? `<div class="bst-pn-desc">${_esc(c.description).replace(/\n/g, '<br>')}</div>` : `<div class="bst-blind">Rien de notable dans son apparence.</div>`}
    </section>
    <section class="bst-sc" id="s-atk"><div class="bst-sc-h"><b>Attaques observées</b><em>${armes.length + acts.length} en combat</em></div>
      <div class="bst-hint">Le MJ te dit combien d'attaques la créature possède ; à toi de noter lesquelles.</div>
      ${armes.map((a, i) => obsRow('arme', a.id || `idx_${i}`, i, 'Arme')).join('')}
      ${acts.map((a, i) => obsRow('act', a.id || `idx_${i}`, i, 'Action')).join('')}
      ${!armes.length && !acts.length ? `<div class="bst-blind">Elle n'a jamais attaqué devant toi.</div>` : ''}
    </section>
    <section class="bst-sc" id="s-traits"><div class="bst-sc-h"><b>Traits devinés</b><em>${traits.length} soupçonné${traits.length > 1 ? 's' : ''}</em></div>
      ${traits.length ? traits.map((_, i) => { const done = _bstGetSlot(cid, `tr_nom_${i}`, 'ded') && _bstGetSlot(cid, `tr_desc_${i}`, 'ded'); return `<div class="bst-jrow${done ? ' done' : ''}"><div class="bst-jrow-t"><span class="ix">Trait ${i + 1}</span>${_bstSlot(cid, `tr_nom_${i}`, 'ded', { wide: true, strong: true, ph: 'Nom du trait', hole: 'non identifié' })}</div><div class="bst-jrow-e"><em>Ce que ça fait</em>${_bstSlot(cid, `tr_desc_${i}`, 'ded', { wide: true, ph: 'description…', hole: 'rien noté' })}</div></div>`; }).join('') : `<div class="bst-blind">Aucun trait particulier remarqué.</div>`}
    </section>
    <section class="bst-sc" id="s-loot"><div class="bst-sc-h"><b>Butin supposé</b><em>${butins.length}${hasOr ? ' + or' : ''} à deviner</em></div>
      ${butins.map((_, i) => { const done = _bstGetSlot(cid, `but_nom_${i}`, 'ded'); return `<div class="bst-jrow${done ? ' done' : ''}"><div class="bst-jrow-t"><span class="ix">Objet ${i + 1}</span>${_bstSlot(cid, `but_nom_${i}`, 'ded', { wide: true, strong: true, ph: 'Objet supposé', hole: 'inconnu' })}</div><div class="bst-jrow-e"><em>Quantité</em>${_bstSlot(cid, `but_qte_${i}`, 'ded', { wide: true, ph: '1' })}</div></div>`; }).join('')}
      ${hasOr ? `<div class="bst-jrow${_bstGetSlot(cid, 'but_nom_or', 'ded') ? ' done' : ''}"><div class="bst-jrow-t"><span class="ix">Or</span>${_bstSlot(cid, 'but_nom_or', 'ded', { wide: true, strong: true, ph: 'Bourse, gemmes…', hole: 'inconnu' })}</div><div class="bst-jrow-e"><em>Montant estimé</em>${_bstSlot(cid, 'but_qte_or', 'ded', { wide: true, ph: '~20 po' })}</div></div>` : ''}
      ${!butins.length && !hasOr ? `<div class="bst-blind">Elle ne porte rien qui vaille la peine.</div>` : ''}
    </section>
    <section class="bst-sc" id="s-dmg"><div class="bst-sc-h"><b>Relations aux dégâts</b>${relDefs.length ? '<em>supposées</em>' : ''}</div>
      ${relDefs.length
        ? relDefs.map(r => `<div class="bst-jrel" style="--relc:${r.color}"><span>${_esc(r.label)}</span>${_bstSlot(cid, `rel_${r.key}`, 'ded', { wide: true, ph: 'types de dégâts…', hole: 'rien observé' })}</div>`).join('')
        : `<div class="bst-blind">Rien de particulier observé dans ses réactions aux dégâts.</div>`}
    </section>`;

  return _bstPanelShell(c, rs, SEC, body, false);
}

function _renderPanelAdmin(c, rs) {
  const types = STORE.damageTypes || [];
  const traits = Array.isArray(c.traits) ? c.traits : [];
  const butins = Array.isArray(c.butins) ? c.butins : [];
  const armes = Array.isArray(c.armesNaturelles) ? c.armesNaturelles : [];
  const acts = Array.isArray(c.actions) ? c.actions : [];
  const al = _beastAlerts(c);
  const modOf = (val) => {
    const n = parseInt(val);
    if (!val || isNaN(n)) return { txt: '', cls: 'zero' };
    const m = Math.floor((n - 10) / 2);
    return { txt: modStr(m), cls: m > 0 ? 'pos' : m < 0 ? 'neg' : 'zero' };
  };
  // Cache actions + contexte arme, et lazy-load boutique (butins) — inchangés.
  _bstActionsCacheLoad(c.id, acts);
  _bstActionsArmeIdCtx = armes[0]?.id || null;
  if (!_bstShopItemsCache) _bstEnsureShopItems().then(() => _bstRefreshButinSelects(c.id));

  // ── Héros MJ éditable ─────────────────────────────────────────────────────
  const heroHtml = `
    <div class="bst-pn-hero">
      ${c.imageUrl
        ? `<img src="${_esc(c.imageUrl)}" alt="" style="cursor:pointer" data-bst-action="openImage" data-id="${c.id}">`
        : `<span class="bst-pn-e" style="cursor:pointer" data-bst-action="openImage" data-id="${c.id}">${_esc(c.emoji || '❓')}</span>`}
      <span class="bst-pn-badge">MJ</span>
      <button class="bst-pn-imgedit" data-bst-action="openImage" data-id="${c.id}" title="Changer l'illustration">▣ Illustration</button>
      <button class="bst-pn-x" data-bst-action="close" title="Fermer">×</button>
      <div class="bst-pn-id">
        <div class="bst-pn-rangrow">
          ${BESTIARY_RANKS.map(rst => { const active = (c.rang || _defaultRankId()) === rst.id;
            return `<button type="button" data-bst-rang-btn="${rst.id}" class="bst-rangchip${active ? ' on' : ''}" style="--rc:${rst.color}" data-bst-action="selectRang" data-id="${c.id}" data-rang="${rst.id}">${_esc(rst.label)}</button>`; }).join('')}
          <button type="button" class="bst-rangchip bst-hidden-toggle${c.hidden ? ' on' : ''}" style="--rc:var(--arcane)" data-bst-action="toggleHidden" data-id="${c.id}" title="${c.hidden ? 'Cachée aux joueurs — clic pour afficher' : 'Cacher aux joueurs'}">${c.hidden ? '◒ Cachée' : '◉ Visible'}</button>
        </div>
        <input class="bst-pn-nm-input" value="${_esc(c.nom || '')}" placeholder="Nom de la créature…" data-bst-action="updateNom" data-bst-on="input" data-id="${c.id}">
        <div class="bst-pn-meta-input">
          <input placeholder="Type" value="${_esc(c.type || '')}" data-bst-action="update" data-bst-on="input" data-id="${c.id}" data-field="type">
          <span>·</span>
          <input placeholder="Environnement" value="${_esc(c.environnement || '')}" data-bst-action="update" data-bst-on="input" data-id="${c.id}" data-field="environnement">
        </div>
      </div>
    </div>`;

  const statField = (cls, lbl, field, val) => `<div class="bst-st ${cls}${val ? '' : ' void'}"><small>${lbl}</small><input type="number" min="0" value="${val || ''}" placeholder="0" data-bst-action="updateNum" data-bst-on="input" data-id="${c.id}" data-field="${field}"></div>`;
  const caracField = (lbl, key) => { const { txt, cls } = modOf(c[key]); return `<div class="bst-ca6"><input type="number" min="0" value="${c[key] || ''}" placeholder="–" data-bst-action="updateCarac" data-bst-on="input" data-id="${c.id}" data-key="${key}"><em class="${cls}" data-bst-mod="${c.id}-${key}">${txt}</em><small>${lbl}</small></div>`; };

  // ── Sections (ordre MJ) ──────────────────────────────────────────────────
  const statsSec = `
    <section class="bst-sc" id="s-stats"><div class="bst-sc-h"><b>Fiche technique</b><em>utilisée par le VTT</em></div>
      <div class="bst-stats5">${statField('pv', 'PV', 'pvMax', c.pvMax)}${statField('pm', 'PM', 'pmMax', c.pmMax)}${statField('ca', 'CA', 'ca', c.ca)}${statField('vt', 'Vit.', 'vitesse', c.vitesse)}${statField('xp', 'XP', 'dangerositeXp', c.dangerositeXp)}</div>
      <div class="bst-mini2">
        <span>Niveau / FP</span><input type="number" value="${c.niveau || ''}" placeholder="–" data-bst-action="updateNum" data-bst-on="input" data-id="${c.id}" data-field="niveau">
        <span>Init.</span><input type="number" value="${c.initiative || ''}" placeholder="–" data-bst-action="updateNum" data-bst-on="input" data-id="${c.id}" data-field="initiative">
        <span>Emoji</span><input value="${_esc(c.emoji || '❓')}" style="width:44px" data-bst-action="update" data-bst-on="input" data-id="${c.id}" data-field="emoji">
        <span>Token</span><select data-bst-action="updateNum" data-bst-on="change" data-id="${c.id}" data-field="tokenW">${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${(c.tokenW || c.tokenSize || 1) === n ? ' selected' : ''}>${n}</option>`).join('')}</select>
        <span>×</span><select data-bst-action="updateNum" data-bst-on="change" data-id="${c.id}" data-field="tokenH">${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${(c.tokenH || c.tokenSize || 1) === n ? ' selected' : ''}>${n}</option>`).join('')}</select>
      </div>
      <div class="bst-ca6row">${caracField('FOR', 'force')}${caracField('DEX', 'dexterite')}${caracField('CON', 'constitution')}${caracField('INT', 'intelligence')}${caracField('SAG', 'sagesse')}${caracField('CHA', 'charisme')}</div>
      ${al.length ? `<div class="bst-sc-h" style="margin-top:13px"><b>À vérifier</b><em>${al.length}</em></div><div class="bst-warns">${al.map(a => `<span class="${a.level === 'hard' ? 'hard' : ''}">${_esc(a.label)}</span>`).join('')}</div>` : ''}
    </section>`;

  const descSec = `
    <section class="bst-sc" id="s-desc"><div class="bst-sc-h"><b>Description</b></div>
      <textarea class="bst-panel-textarea" placeholder="Apparence, comportement, lore…" rows="3" data-bst-action="update" data-bst-on="input" data-id="${c.id}" data-field="description">${_esc(c.description || '')}</textarea>
    </section>`;

  const dmgSec = `
    <section class="bst-sc" id="s-dmg"><div class="bst-sc-h"><b>Relations aux dégâts</b></div>
      ${_renderDamageMatrixPanel(c, types)}
    </section>`;

  const atkSec = `
    <section class="bst-sc" id="s-atk"><div class="bst-sc-h"><b>Armes naturelles</b><em>${armes.length}</em><button class="add" data-bst-action="addArme" data-id="${c.id}">+ Ajouter</button></div>
      <div id="bst-p-armes-${c.id}" class="bst-p-rows">${armes.map((a, i) => _bstRenderArmeRow(a, c.id, i)).join('')}</div>
      <div class="bst-sc-h" style="margin-top:13px"><b>Actions</b><em>${acts.length}</em><button class="add" data-bst-action="addAction">+ Ajouter</button></div>
      <div id="bst-p-actions-${c.id}" class="bst-p-rows bst-actions-host">${_bstRenderActionsList()}</div>
    </section>`;

  const traitsSec = `
    <section class="bst-sc" id="s-traits"><div class="bst-sc-h"><b>Traits &amp; capacités</b><em>${traits.length}</em><button class="add" data-bst-action="addRow" data-id="${c.id}" data-type="traits">+ Ajouter</button></div>
      <div id="bst-p-traits-${c.id}" class="bst-p-rows">${traits.map((t, i) => _panelTraitRow(t, c.id, i)).join('')}</div>
    </section>`;

  const lootSec = `
    <section class="bst-sc" id="s-loot"><div class="bst-sc-h"><b>Butin</b><em>${butins.length}</em><button class="add" data-bst-action="pickerOpen" data-id="${c.id}">+ Ajouter</button></div>
      <div class="bst-butin-or-row">
        <span class="bst-butin-or-ic">Or</span>
        <input class="bst-p-input bst-butin-or-input" type="text" placeholder="Or lâché — ex : 5d4 ou 20" value="${_esc(c.or || '')}" title="Or lâché à la mort : nombre brut (20) ou formule (5d4). Le jet est fait dans le VTT." data-bst-action="saveOr" data-bst-on="input" data-id="${c.id}">
        <span class="bst-butin-or-hint">brut ou XdY</span>
      </div>
      <div id="bst-p-butins-${c.id}" class="bst-p-rows">${butins.map((b, i) => _panelButinRow(b, c.id, i)).join('')}</div>
      <div class="bst-admin-actions"><button class="bst-btn-delete" style="flex:1" data-bst-action="deleteBeast" data-id="${c.id}">Supprimer cette créature</button></div>
    </section>`;

  return `<div class="bst-pn" style="--rc:${rs.color}">
    ${heroHtml}
    <nav class="bst-pnav">
      <button data-bst-sec="s-stats">Stats</button>
      <button data-bst-sec="s-desc">Description</button>
      <button data-bst-sec="s-dmg">Dégâts</button>
      <button data-bst-sec="s-atk">Attaques</button>
      <button data-bst-sec="s-traits">Traits</button>
      <button data-bst-sec="s-loot">Butin</button>
    </nav>
    <div class="bst-pn-b">
      ${statsSec}${descSec}${dmgSec}${atkSec}${traitsSec}${lootSec}
    </div>
  </div>`;
}

export async function deleteBeast(id) {
  const col = STORE.currentCol || 'bestiary';
  const c = STORE.creatures.find(x=>x.id===id);
  if (!await confirmDelete(col, id, `Supprimer "${c?.nom||'cette creature'}" ?`, {
    title: 'Supprimer la creature',
    snapshot: c,
    successMessage: 'Creature supprimee.',
    onRestore: async () => { await _bstHydrate(); _render(); },
  })) return;
  if (STORE.activeId === id) STORE.activeId = null;
  await _bstHydrate();
  _render();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SUIVI JOUEUR
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function _saveTracker() {
  // Le tracker vient d'Ãªtre mutÃ© localement et le DOM reflÃ¨te dÃ©jÃ  la saisie
  // (input.value, barres PV/PM patchÃ©es par _bstAdjust). On aligne la signature
  // de rendu sur cet Ã©tat AVANT l'Ã©criture : quand l'Ã©cho du watch reviendra avec
  // exactement la mÃªme donnÃ©e, `_bstSig() === _bstRenderSig` â†’ pas de _render(),
  // donc pas de rebuild innerHTML qui remettrait le scroll du panneau en haut.
  _bstRenderSig = _bstSig();
  // viewAsUid n'est respectÃ© QUE pour un admin â€” sinon un joueur Ã©crirait dans le
  // doc d'un autre joueur (uid pÃ©rimÃ© d'une session MJ prÃ©cÃ©dente).
  const uid = (STATE.isAdmin && STORE.viewAsUid) || STATE.user?.uid; if (!uid) return;
  await tryDoc('bestiary_tracker', uid, { data: STORE.tracker });
}

function _syncActivePanel() {
  const main = document.querySelector('.bst-main');
  const panelSlot = document.querySelector('.bst-panel-slot');
  const activeCreature = STORE.creatures.find(c => c.id === STORE.activeId);

  main?.classList.toggle('solo', !activeCreature);

  document.querySelectorAll('.bst-bc').forEach(card => {
    card.classList.toggle('on', card.dataset.beastId === STORE.activeId);
  });

  if (panelSlot) {
    try {
      panelSlot.innerHTML = activeCreature ? _renderPanel(activeCreature) : '';
    } catch (err) {
      console.error('[bestiary] render panel failed:', err, activeCreature);
      panelSlot.innerHTML = activeCreature ? `
        <div class="bst-pn"><div class="bst-pn-b"><div class="bst-sc">
          <div class="bst-sc-h"><b>Fiche créature</b></div>
          <div class="bst-pn-nm">${_esc(activeCreature.nom || 'Créature')}</div>
          <div class="bst-hint">Impossible d'afficher toutes les informations de cette créature.</div>
        </div></div></div>` : '';
    }
    _bstBindPanelSpy();
  }
  _bstRenderedActiveId = STORE.activeId;
  _bstRenderSig = _bstSig();
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

let _bstRankDraft = [];

function _renderBestiaryRanksAdmin() {
  const rows = _bstRankDraft.map((rank, index) => `
    <article class="bst-rank-admin-card" style="--rank-color:${_esc(rank.color || '#94a3b8')};--rank-glow:${_esc(rank.glow || 'rgba(148,163,184,.18)')}" data-index="${index}">
      <div class="bst-rank-admin-preview">
        <span class="bst-rank-admin-badge">${_esc(rank.label || 'Rang')}</span>
        <div class="bst-rank-admin-name">
          <strong>${_esc(rank.label || 'Rang')}</strong>
          <small>Apparaît sur les cartes et la fiche créature</small>
        </div>
      </div>

      <label class="bst-rank-admin-field">
        <span>Nom du rang</span>
        <input class="input-field" value="${_esc(rank.label || '')}" data-input="_bstRankField" data-index="${index}" data-field="label" placeholder="Ex. Elite">
      </label>

      <label class="bst-rank-admin-field">
        <span>Libellé des filtres</span>
        <input class="input-field" value="${_esc(rank.plural || '')}" data-input="_bstRankField" data-index="${index}" data-field="plural" placeholder="Ex. Elites">
      </label>

      <div class="bst-rank-admin-color">
        <label class="bst-rank-color-picker">
          <span>Couleur</span>
          <input type="color" value="${_esc(rank.color || '#94a3b8')}" data-change="_bstRankField" data-index="${index}" data-field="color">
        </label>
        <div class="bst-rank-swatches" aria-label="Couleurs rapides">
          ${BESTIARY_RANK_PALETTE.map(color => `
            <button type="button" class="bst-rank-swatch${(rank.color || '').toLowerCase() === color.toLowerCase() ? ' is-active' : ''}"
              style="--sw:${color}" data-action="_bstRankColor" data-index="${index}" data-color="${color}" aria-label="Couleur ${color}"></button>`).join('')}
        </div>
      </div>

      <div class="bst-rank-admin-actions">
        <button type="button" class="btn btn-outline btn-sm" data-action="_bstRankMove" data-index="${index}" data-dir="-1" title="Monter" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="btn btn-outline btn-sm" data-action="_bstRankMove" data-index="${index}" data-dir="1" title="Descendre" ${index === _bstRankDraft.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="btn btn-outline btn-sm is-danger" data-action="_bstRankDelete" data-index="${index}" title="Supprimer">×</button>
      </div>
    </article>`).join('');

  openModal('', `
    <div class="sh-admin-modal is-bestiary-ranks">
      <div class="sh-admin-head">
        <div class="sh-admin-head-ico">👹</div>
        <div class="sh-admin-head-title">
          <h2>Rangs du bestiaire</h2>
          <small>Ces rangs alimentent les filtres, les cartes, la fiche des créatures et les exports de cette aventure.</small>
        </div>
        <button class="sh-admin-close" data-action="_bstRankClose" aria-label="Fermer">×</button>
      </div>
      <div class="sh-admin-body bst-rank-admin-body">
        <div class="bst-rank-admin-guide">
          <div><b>Rang tactique</b><small>Le nom est affiché sur chaque créature et dans les exports.</small></div>
          <div><b>Filtre de galerie</b><small>Le libellé pluriel sert aux boutons de filtre du bestiaire.</small></div>
        </div>
        <div class="bst-rank-admin-list">
        ${rows || '<div class="eqs-admin-empty">Aucun rang. Ajoute au moins un rang pour classer les créatures.</div>'}
        </div>
        <button class="bst-rank-admin-add" data-action="_bstRankAdd">+ Ajouter un rang</button>
      </div>
      <div class="sh-admin-footer">
        <button class="btn btn-outline btn-sm" data-action="_bstRankClose">Annuler</button>
        <button class="btn btn-gold btn-sm" data-action="_bstRankSave">Enregistrer</button>
      </div>
    </div>`);
}

export async function openBestiaryRanksAdmin() {
  if (!STATE.isAdmin) return;
  await _ensureFeatureCss('shop');
  await _ensureFeatureCss('bestiaire');
  await _loadBestiaryRanks();
  _bstRankDraft = BESTIARY_RANKS.map(r => ({ ...r }));
  _renderBestiaryRanksAdmin();
}

function _bstSetRang(rang) { STORE.filterRang = rang; _render(); }
function _bstSelectRang(rang) {
  const sel = document.getElementById('bst-rang-selector');
  if (!sel) return;
  sel.dataset.rang = rang;
  sel.querySelectorAll('[data-rang-btn]').forEach(btn => {
    const r = btn.dataset.rangBtn;
    const active = r === rang;
    const rst = _rankStyle(r);
    btn.style.fontWeight = active ? '700' : '400';
    btn.style.border     = `1px solid ${active ? rst.border : 'var(--border)'}`;
    btn.style.background = active ? rst.bg  : 'var(--bg-elevated)';
    btn.style.color      = active ? rst.color : 'var(--text-dim)';
  });
}
// Recherche : met Ã  jour la valeur et filtre la grille SANS rerender complet
function _bstSearchInput(val) {
  STORE.searchVal = val;
  let visible = 0;
  // Filtrer en live sans reconstruire toute la page
  document.querySelectorAll('.bst-card').forEach(card => {
    const id = card.dataset.beastId;
    const c  = STORE.creatures.find(x => x.id === id);
    if (!c) return;
    const match = _beastMatchesFilters(c, { search: val });
    card.style.display = match ? '' : 'none';
    if (match) visible++;
  });
  document.querySelectorAll('[data-bst-visible-count], [data-bst-list-count]').forEach(el => {
    el.textContent = String(visible);
  });
  const plural = document.querySelector('[data-bst-list-plural]');
  if (plural) plural.textContent = visible > 1 ? 's' : '';
  const empty = document.querySelector('[data-bst-filter-empty]');
  const grid = document.querySelector('.bst-grid');
  if (empty) empty.hidden = visible > 0;
  if (grid) grid.hidden = visible === 0;
  const reset = document.querySelector('[data-bst-reset-filters]');
  if (reset) reset.hidden = !(_norm(val) || STORE.filterType || STORE.filterRang || STORE.filterPrep);
}

function _bstSearch(val) { STORE.searchVal = val; _render(); } // legacy
function _bstSetType(type) { STORE.filterType = type || ''; _render(); }
function _bstSetPrep(prep) { STORE.filterPrep = prep || ''; _render(); }
// Segmenté Vue MJ / Vue joueur (admin). MJ → carnet propre, reset du filtre prépa.
function _bstSetRole(role) {
  STORE.role = role === 'player' ? 'player' : 'mj';
  if (STORE.role === 'mj') STORE.viewAsUid = null;
  STORE.filterPrep = '';
  STORE.activeId = null;
  _render();
}
function _bstResetFilters() {
  STORE.searchVal = '';
  STORE.filterType = '';
  STORE.filterRang = '';
  STORE.filterPrep = '';
  _render();
}
async function _bstDuplicateBeast(id) {
  if (!STATE.isAdmin || !id) return;
  const source = STORE.creatures.find(c => c.id === id);
  if (!source) return;
  const col = STORE.currentCol || 'bestiary';
  const copy = JSON.parse(JSON.stringify(source));
  delete copy.id;
  copy.nom = `${source.nom || 'Creature'} (copie)`;
  copy.hidden = true;
  copy.ordre = _bstNextOrderIndex();
  try {
    const newId = await addToCol(col, copy);
    await _bstHydrate();
    STORE.activeId = newId;
    _render();
    showNotif('Creature dupliquee et cachee aux joueurs.', 'success');
  } catch (e) {
    notifySaveError(e);
  }
}

// Switch de bestiaire (admin uniquement)
async function _bstSwitchBestiaire(id) {
  STORE.bestiaireId = id;
  STORE.activeId    = null;
  STORE.searchVal   = '';
  STORE.filterType  = '';
  STORE.filterRang  = '';
  STORE.filterPrep  = '';
  await renderBestiary();
}

// Vue admin â†’ joueur : voir/modifier les estimations d'un joueur.
// uid vide ou Ã©gal Ã  l'UID admin â†’ retour Ã  la vue MJ.
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
  STORE.filterPrep  = '';
  await renderBestiary();
}

// Affiche/retire la croix d'une ligne de butin selon qu'elle est remplie, en DOM
// pur (pas de _render â†’ pas de saut de scroll). La dÃ©lÃ©gation scopÃ©e capte les
// boutons ajoutÃ©s dynamiquement.
function _bstLootRefreshDel(id, idx) {
  const row = document.querySelector(`.bst-loot-est[data-loot-cid="${id}"][data-loot-idx="${idx}"]`);
  if (!row) return;
  const ded    = STORE.tracker[id]?.deductions || {};
  const filled = !!(ded[`but_nom_${idx}`] || ded[`but_qte_${idx}`]);
  if (filled === !!row.querySelector('.bst-loot-del')) return;  // dÃ©jÃ  dans le bon Ã©tat
  row.querySelector('.bst-loot-del, .bst-loot-del-spacer')?.remove();
  if (filled) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bst-loot-del';
    btn.dataset.bstAction = 'clearLoot';
    btn.dataset.id = id;
    btn.dataset.idx = idx;
    btn.title = 'Effacer cette ligne';
    btn.textContent = 'x';
    row.appendChild(btn);
  } else {
    const sp = document.createElement('span');
    sp.className = 'bst-loot-del-spacer';
    row.appendChild(sp);
  }
}

// Saisie d'un input de butin : sauvegarde + bascule la croix immÃ©diatement.
function _bstSetLoot(el) {
  _bstSetDeduction(el.dataset.id, el.dataset.key, el.value);
  _bstLootRefreshDel(el.dataset.id, el.dataset.idx);
}

// Efface une ligne de butin estimÃ© en un clic : retire les clÃ©s, vide les inputs
// et la croix dans le DOM (pas de _render â†’ pas de saut de scroll, cf. _saveTracker).
function _bstClearLoot(id, idx) {
  const d = STORE.tracker[id]?.deductions;
  if (d) { delete d[`but_nom_${idx}`]; delete d[`but_qte_${idx}`]; }
  const row = document.querySelector(`.bst-loot-est[data-loot-cid="${id}"][data-loot-idx="${idx}"]`);
  if (row) row.querySelectorAll('.bst-deduct-input').forEach(inp => { inp.value = ''; });
  _bstLootRefreshDel(id, idx);  // ligne vide â†’ remplace la croix par le spacer
  _saveTracker();
}

// DÃ©ductions joueur
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
  // Vue MJ : connaÃ®t le max et le respecte. Vue joueur (ou MJ consultant un joueur) : pas de borne max.
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
  // Vue MJ : remet les vraies valeurs. Vue joueur (ou MJ consultant un joueur) : remet les estimations Ã  zÃ©ro.
  STORE.tracker[id] = _isAdminView()
    ? { pvActuel: parseInt(c.pvMax)||0, pmActuel: parseInt(c.pmMax)||0, notes:'' }
    : { pvActuel: 0, pmActuel: 0, caEstimee: 0, vitEstimee: 0, xpEstimee: 0, pvCombat: 0, notes:'', deductions:{} };
  _saveTracker();
  _render();
}

// â”€â”€ Override PAGES.bestiaire + exports â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
PAGES.bestiaire = renderBestiary;

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// MODAL IMAGE â€” Ã©diteur d'image dÃ©diÃ© de la crÃ©ature (depuis le panneau)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Même expérience que les portraits de personnages (character-photo.js) :
// choix du fichier → recadrage pan/zoom (shared/image-crop.js) → base64.
export function openBeastImageModal(id) {
  const c = STORE.creatures.find(x => x.id === id);
  if (!c) return;
  pickImageFile({ onImage: ({ dataUrl }) => _bstShowCropModal(dataUrl, id) });
}

function _bstShowCropModal(dataUrl, id) {
  _bstCropper?.destroy?.(); _bstCropper = null;
  openModal('🖼 Cadrer l’illustration', `
    ${panZoomCropHTML({ idPrefix: 'bst-crop', viewW: 320, viewH: 240 })}
    <div style="display:flex;gap:.6rem;justify-content:flex-end;width:320px;max-width:100%;margin:.8rem auto 0">
      <button class="btn btn-outline" id="bst-crop-cancel">Annuler</button>
      <button class="btn btn-gold" id="bst-crop-save">✅ Enregistrer</button>
    </div>
  `, { subtitle: 'Zoome et déplace pour cadrer (ratio 4:3)', accent: '#4f8cff' });
  requestAnimationFrame(() => {
    _bstCropper?.destroy?.(); _bstCropper = null;
    _bstCropper = attachPanZoomCrop({ idPrefix: 'bst-crop', dataUrl, viewW: 320, viewH: 240, outputW: 800, outputH: 600 });
    document.getElementById('bst-crop-cancel')?.addEventListener('click', () => { _bstCropper?.destroy?.(); _bstCropper = null; closeModal(); }, { once: true });
    document.getElementById('bst-crop-save')?.addEventListener('click', () => _bstSaveImage(id));
  });
}

async function _bstSaveImage(id) {
  const cropResult = _bstCropper?.getBase64?.();
  const current = STORE.creatures.find(c => c.id === id)?.imageUrl || '';
  const imageUrl = typeof cropResult === 'string' && cropResult ? cropResult : current;
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
    _bstReplaceCard(id);
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
    _bstReplaceCard(id);
    showNotif('Image retirée.', 'success');
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// HANDLERS DE DÃ‰LÃ‰GATION â€” chaque entrÃ©e lit ses paramÃ¨tres dans `el.dataset`
// et appelle la fonction existante. Les fonctions restent sur `window` tant que
// d'autres features (legacy) peuvent encore les invoquer.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â”€â”€ Export : document HTML imprimable de toutes les crÃ©atures (MJ) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GÃ©nÃ¨re un fichier .html autonome (lisible + imprimable en PDF depuis le
// navigateur) listant chaque crÃ©ature et ses infos. TÃ©lÃ©chargement direct.
async function _bstExportDocument() {
  if (!STATE.isAdmin) return;
  const list = (STORE.creatures || []).slice()
    .sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }));
  if (!list.length) { showNotif('Aucune creature a exporter', 'info'); return; }
  // Types de dÃ©gÃ¢ts (pour rÃ©soudre id â†’ libellÃ© des rÃ©sistances/immunitÃ©sâ€¦).
  if (!STORE.damageTypes) { try { STORE.damageTypes = await loadDamageTypes(); } catch { STORE.damageTypes = []; } }
  try {
    const blob = new Blob([_bstBuildExportHtml(list)], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bestiaire-${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showNotif(`Bestiaire exporte (${list.length} creature${list.length > 1 ? 's' : ''}).`, 'success');
  } catch (e) {
    console.error('[bestiaire] export', e);
    showNotif("Echec de l'export", 'error');
  }
}

// id (ou objet) de type de dÃ©gÃ¢t â†’ libellÃ© lisible (via STORE.damageTypes).
function _bstDmgLabel(v) {
  const id = (v && typeof v === 'object') ? (v.id || v.type || v.damageTypeId || '') : v;
  const dt = (STORE.damageTypes || []).find(t => t.id === id);
  return dt ? `${dt.icon || ''} ${dt.label}`.trim() : String(id || '');
}
function _bstDmgList(arr) {
  return (Array.isArray(arr) ? arr : []).map(_bstDmgLabel).filter(Boolean);
}

function _bstBuildExportHtml(list) {
  const e = _esc;
  const txt = v => e(v && typeof v === 'object' ? (v.nom || v.label || v.description || '') : String(v ?? ''));
  const statsHtml = (c) => [['FOR', 'force'], ['DEX', 'dexterite'], ['CON', 'constitution'], ['INT', 'intelligence'], ['SAG', 'sagesse'], ['CHA', 'charisme']]
    .map(([l, k]) => (c[k] != null && c[k] !== '') ? `<span><b>${l}</b> ${e(String(c[k]))}</span>` : '')
    .filter(Boolean).join('');
  // Trait : nom + effet (description).
  const traitLine = (t) => {
    if (!t || typeof t !== 'object') return `<li>${txt(t)}</li>`;
    return `<li><b>${e(t.nom || 'Trait')}</b>${t.description ? ` - ${e(t.description)}` : ''}</li>`;
  };
  // Arme naturelle : dÃ©gÃ¢ts (+ bonus, type), portÃ©e, toucher, info.
  const armeLine = (a) => {
    const parts = [];
    if (a.degats) parts.push(`${e(a.degats)}${a.degatsFlat ? '+' + e(String(a.degatsFlat)) : ''}`);
    const dt = a.damageTypeId ? _bstDmgLabel(a.damageTypeId) : '';
    if (dt) parts.push(dt);
    if (a.portee) parts.push(`portee ${e(a.portee)}`);
    const toucher = a.toucherAuto ? 'toucher auto'
      : (a.toucherFlat ? `toucher +${e(String(a.toucherFlat))}` : '');
    if (toucher) parts.push(toucher);
    const meta = parts.length ? ` - ${parts.join(' - ')}` : '';
    const info = a.info ? ` <i>${e(a.info)}</i>` : '';
    return `<li><b>${e(a.nom || 'Arme')}</b>${meta}${info}</li>`;
  };
  // Action (sort de crÃ©ature) : PM, dÃ©gÃ¢ts, portÃ©e, types, runes, effet.
  const actLine = (a) => {
    const parts = [];
    const pm = a.pmOverride ?? a.pm;
    if (pm != null && pm !== '') parts.push(`${e(String(pm))} PM`);
    if (a.degats) parts.push(`${e(a.degats)}${a.degatsFlat ? '+' + e(String(a.degatsFlat)) : ''}`);
    if (a.portee) parts.push(`portee ${e(a.portee)}`);
    if (Array.isArray(a.types) && a.types.length) parts.push(a.types.map(e).join('/'));
    if (Array.isArray(a.runes) && a.runes.length) parts.push(`runes : ${a.runes.map(e).join(', ')}`);
    const meta = parts.length ? ` - ${parts.join(' - ')}` : '';
    const info = a.info ? ` <i>${e(a.info)}</i>` : '';
    return `<li><b>${a.icon ? e(a.icon) + ' ' : ''}${e(a.nom || 'Action')}</b>${meta}${info}</li>`;
  };
  // Butin : objet (quantitÃ© Â· chance). L'or Ã©ventuel est ajoutÃ© Ã  part.
  const butinLine = (b) => {
    if (!b || typeof b !== 'object') return `<li>${txt(b)}</li>`;
    const meta = [b.quantite && `x${e(String(b.quantite))}`, b.chance && e(String(b.chance))].filter(Boolean).join(' - ');
    return `<li><b>${e(b.nom || 'Objet')}</b>${meta ? ` - ${meta}` : ''}</li>`;
  };
  const butinsSection = (c) => {
    const items = (Array.isArray(c.butins) ? c.butins : []).map(butinLine).join('');
    const or = c.or ? `<li><b>Or :</b> ${e(String(c.or))}</li>` : '';
    return (items || or) ? `<h3>Butins</h3><ul>${items}${or}</ul>` : '';
  };
  const ul = (arr, fn) => (Array.isArray(arr) && arr.length) ? `<ul>${arr.map(fn).join('')}</ul>` : '';
  const section = (label, html) => html ? `<h3>${label}</h3>${html}` : '';
  const relHtml = (c) => {
    const rows = [
      ['Resistances (1/2 degats)', _bstDmgList(c.resistances)],
      ['Immunites (0 degat)',    _bstDmgList(c.immunites)],
      ['Absorptions (soigne)',   _bstDmgList(c.absorptions)],
      ['Faiblesses (x2 degats)', _bstDmgList(c.faiblesses)],
    ].filter(([, v]) => v.length);
    return rows.length ? `<ul>${rows.map(([l, v]) => `<li><b>${l} :</b> ${v.map(e).join(', ')}</li>`).join('')}</ul>` : '';
  };
  const card = (c) => {
    const rs = _rankStyle(c.rang);
    const meta = [rs.label, c.type, c.environnement].filter(Boolean).map(e).join(' - ');
    const vit = [c.pvMax && `${e(String(c.pvMax))} PV`, c.pmMax && `${e(String(c.pmMax))} PM`,
      c.ca && `CA ${e(String(c.ca))}`, c.vitesse && `${e(String(c.vitesse))} m`,
      c.initiative && `Init ${e(String(c.initiative))}`,
      c.dangerositeXp && `${e(String(c.dangerositeXp))} XP`,
      ((+c.tokenW > 1) || (+c.tokenH > 1)) && `${e(String(c.tokenW || 1))}x${e(String(c.tokenH || 1))} cases`].filter(Boolean).join(' - ');
    const st = statsHtml(c);
    return `<article class="card">
      <h2>${e(c.emoji || '?')} ${e(c.nom || '?')}${c.niveau ? ` <span class="lvl">Niv. ${e(String(c.niveau))}</span>` : ''}${c.hidden ? ` <span class="hid">cache aux joueurs</span>` : ''}</h2>
      ${meta ? `<div class="meta">${meta}</div>` : ''}
      ${vit ? `<div class="vit">${vit}</div>` : ''}
      ${st ? `<div class="stats">${st}</div>` : ''}
      ${section('Relations aux degats', relHtml(c))}
      ${section('Traits', ul(c.traits, traitLine))}
      ${section('Armes naturelles', ul(c.armesNaturelles, armeLine))}
      ${section('Actions', ul(c.actions, actLine))}
      ${butinsSection(c)}
      ${c.description ? `<div class="desc">${e(c.description)}</div>` : ''}
    </article>`;
  };
  // DonnÃ©es structurÃ©es (pour analyse automatique : id de dÃ©gÃ¢t â†’ libellÃ© rÃ©solu).
  const data = list.map(c => ({
    nom: c.nom || '', rang: c.rang || _defaultRankId(), type: c.type || '', environnement: c.environnement || '',
    niveau: c.niveau ?? null, xp: c.dangerositeXp ?? null,
    pvMax: c.pvMax ?? null, pmMax: c.pmMax ?? null, ca: c.ca ?? null, vitesse: c.vitesse ?? null, initiative: c.initiative ?? null,
    tokenW: c.tokenW ?? 1, tokenH: c.tokenH ?? 1,
    stats: { force: c.force ?? null, dexterite: c.dexterite ?? null, constitution: c.constitution ?? null,
             intelligence: c.intelligence ?? null, sagesse: c.sagesse ?? null, charisme: c.charisme ?? null },
    resistances: _bstDmgList(c.resistances), immunites: _bstDmgList(c.immunites),
    absorptions: _bstDmgList(c.absorptions), faiblesses: _bstDmgList(c.faiblesses),
    traits: (c.traits || []).map(t => (t && typeof t === 'object') ? { nom: t.nom || '', effet: t.description || '' } : { nom: t, effet: '' }),
    armesNaturelles: (c.armesNaturelles || []).map(a => ({
      nom: a.nom || '', degats: a.degats || '', degatsFlat: a.degatsFlat ?? null, degatsStat: a.degatsStat || '',
      toucherStat: a.toucherStat || '', toucherFlat: a.toucherFlat ?? null, toucherAuto: !!a.toucherAuto,
      portee: a.portee || '', typeDegats: _bstDmgLabel(a.damageTypeId || ''), info: a.info || '',
    })),
    actions: (c.actions || []).map(a => ({
      nom: a.nom || '', pm: a.pmOverride ?? a.pm ?? null,
      degats: a.degats || '', degatsFlat: a.degatsFlat ?? null, degatsStat: a.degatsStat || '',
      portee: a.portee || '', types: Array.isArray(a.types) ? a.types : [], runes: Array.isArray(a.runes) ? a.runes : [],
      noyau: a.noyau || '', effet: a.info || '',
    })),
    butins: (c.butins || []).map(b => (b && typeof b === 'object') ? { nom: b.nom || '', quantite: b.quantite || '', chance: b.chance || '' } : { nom: b, quantite: '', chance: '' }),
    or: c.or || '',
    description: c.description || '', cacheJoueurs: !!c.hidden,
  }));
  const jsonEmbed = JSON.stringify(data, null, 1).replace(/</g, '\\u003c');
  const css = `*{box-sizing:border-box}body{font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;background:#fff;margin:0;padding:24px;line-height:1.45}`
    + `h1{font-size:1.6rem;margin:0 0 .2rem}header p{color:#64748b;margin:0 0 1.2rem;font-size:.9rem}`
    + `.card{border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin:0 0 14px;page-break-inside:avoid;break-inside:avoid}`
    + `.card h2{font-size:1.1rem;margin:0 0 4px}.lvl{font-size:.8rem;color:#64748b;font-weight:400}.hid{font-size:.72rem;color:#ef4444;font-weight:400}`
    + `.meta{color:#64748b;font-size:.85rem;margin-bottom:6px}.vit{font-size:.9rem;margin-bottom:6px}`
    + `.stats{display:flex;flex-wrap:wrap;gap:10px;font-size:.85rem;color:#334155;margin-bottom:6px}`
    + `.card h3{font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;color:#475569;margin:10px 0 3px}`
    + `.card ul{margin:0;padding-left:18px;font-size:.88rem}.card li{margin:2px 0}`
    + `.desc{font-size:.88rem;color:#334155;margin-top:8px;white-space:pre-wrap}`
    + `.data{margin-top:28px;font-size:.78rem;color:#64748b;border-top:1px solid #e2e8f0;padding-top:12px}`
    + `.data pre{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:.72rem;color:#334155}`
    + `@media print{body{padding:0}.card{border-color:#cbd5e1}.data{display:none}}`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>Bestiaire (${list.length})</title><style>${css}</style></head>`
    + `<body><header><h1>Bestiaire</h1><p>${list.length} creature${list.length > 1 ? 's' : ''} - exporte le ${e(new Date().toLocaleDateString('fr-FR'))}</p></header>`
    + `${list.map(card).join('')}`
    + `<details class="data"><summary>Donnees structurees (JSON) - pour analyse automatique</summary><pre>${jsonEmbed}</pre></details>`
    + `<script type="application/json" id="bestiaire-data">${jsonEmbed}</script>`
    + `</body></html>`;
}

Object.assign(bstHandlers, {
  // Galerie / navigation
  open:           (el) => _bstOpen(el.dataset.id),
  exportBeasts:   ()   => _bstExportDocument(),
  close:          ()   => _bstClose(),
  createDraft:    ()   => _bstCreateDraft(),
  switchBest:     (el) => _bstSwitchBestiaire(el.dataset.id),
  selectBest:     (el) => { if (el.value === '__new__') _bstCreateBestiaire(); else _bstSwitchBestiaire(el.value); },
  createBest:     ()   => _bstCreateBestiaire(),
  setRole:        (el) => _bstSetRole(el.dataset.role),
  setRang:        (el) => _bstSetRang(el.dataset.rang),
  setType:        (el) => _bstSetType(el.dataset.type ?? el.value),
  setPrep:        (el) => _bstSetPrep(el.dataset.prep),
  resetFilters:   ()   => _bstResetFilters(),
  search:         (el) => _bstSearchInput(el.value),
  clearSearch:    ()   => { STORE.searchVal = ''; _render(); document.getElementById('bst-search')?.focus(); },
  viewAs:         (el) => _bstViewAs(el.dataset.uid !== undefined ? el.dataset.uid : (el.value || '')),
  pickPlayer:     (el) => _bstViewAs(el.dataset.uid || ''),
  clearCarnet:    (el) => _bstClearCarnet(el.dataset.id),
  quickToggleHidden: (el, ev) => { ev?.stopPropagation?.(); _bstToggleHidden(el.dataset.id); },
  duplicateBeast: (el, ev) => { ev?.stopPropagation?.(); _bstDuplicateBeast(el.dataset.id); },

  // Panneau admin : Ã©dition inline
  updateNom:      (el) => _bstUpdateNom(el.dataset.id, el.value),
  update:         (el) => _bstUpdate(el.dataset.id, el.dataset.field, el.value),
  updateNum:      (el) => _bstUpdateNum(el.dataset.id, el.dataset.field, el.value),
  updateCarac:    (el) => _bstUpdateCarac(el.dataset.id, el.dataset.key, el.value),
  selectRang:     (el) => _bstSelectRangPanel(el.dataset.id, el.dataset.rang),
  toggleHidden:   (el) => _bstToggleHidden(el.dataset.id),
  toggleDmg:      (el) => _bstToggleDmg(el.dataset.id, el.dataset.key, el.dataset.tid),
  syncDmgConfl:   ()   => _bstSyncDmgConflicts(),
  focusInput:     (el) => el.querySelector('input')?.focus(),

  // Vue joueur : estimations / dÃ©ductions
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
  saveOr:         (el) => _bstSaveOr(el.dataset.id, el.value),
  removeRow:      (el) => _bstRemovePanelRow(el.dataset.id, el.dataset.type, el),

  // Picker de butin (dÃ©lÃ©gation au composant partagÃ© shop-picker.js â€” pas de handlers locaux)
  pickerOpen:     (el) => _bstButinPickerOpen(el.dataset.id),

  // Image
  openImage:      (el) => openBeastImageModal(el.dataset.id),
  saveImage:      (el) => _bstSaveImage(el.dataset.id),
  removeImage:    (el) => _bstRemoveImage(el.dataset.id),

  // Suppression crÃ©ature
  deleteBeast:    (el, ev) => { ev?.stopPropagation?.(); deleteBeast(el.dataset.id); },
});

registerActions({
  openBestiaryRanksAdmin: () => openBestiaryRanksAdmin(),
  _bstRankClose: () => closeModal(),
  _bstRankField: el => {
    const rank = _bstRankDraft[Number(el.dataset.index)];
    if (!rank) return;
    rank[el.dataset.field] = el.value;
    if (el.dataset.field === 'label' && !rank.plural) rank.plural = `${el.value}s`;
    if (el.dataset.field === 'color') {
      rank.glow = `${el.value}2e`;
      rank.border = `${el.value}66`;
      rank.bg = `${el.value}1a`;
    }
  },
  _bstRankColor: btn => {
    const rank = _bstRankDraft[Number(btn.dataset.index)];
    if (!rank) return;
    rank.color = btn.dataset.color || rank.color;
    rank.glow = `${rank.color}2e`;
    rank.border = `${rank.color}66`;
    rank.bg = `${rank.color}1a`;
    _renderBestiaryRanksAdmin();
  },
  _bstRankMove: btn => {
    const from = Number(btn.dataset.index);
    const to = from + Number(btn.dataset.dir);
    if (!_bstRankDraft[from] || to < 0 || to >= _bstRankDraft.length) return;
    [_bstRankDraft[from], _bstRankDraft[to]] = [_bstRankDraft[to], _bstRankDraft[from]];
    _renderBestiaryRanksAdmin();
  },
  _bstRankDelete: btn => {
    const index = Number(btn.dataset.index);
    if (!_bstRankDraft[index]) return;
    _bstRankDraft.splice(index, 1);
    _renderBestiaryRanksAdmin();
  },
  _bstRankAdd: () => {
    _bstRankDraft.push(_normalizeBestiaryRank({ id: `rang_${Date.now()}`, label: 'Nouveau rang', plural: 'Nouveaux rangs', color: '#94a3b8' }, _bstRankDraft.length));
    _renderBestiaryRanksAdmin();
  },
  _bstRankSave: async () => {
    if (!_bstRankDraft.some(r => String(r.label || '').trim())) {
      showNotif('Ajoute au moins un rang.', 'error');
      return;
    }
    try {
      await _saveBestiaryRanks(_bstRankDraft);
      showNotif('Rangs du bestiaire enregistrés.', 'success');
      closeModal();
      _render();
    } catch (error) {
      notifySaveError(error);
    }
  },
});
