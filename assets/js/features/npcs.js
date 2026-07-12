// ══════════════════════════════════════════════════════════════════════════════
// NPCS.JS — PNJ & Affinités
// ✓ Fiches PNJ : nom, rôle, lieu, description, portrait reconnaissable
// ✓ Affinité groupe   : jauge (lecture) + modal événement (delta cumulé)
// ✓ Affinités spécifiques : emoji + couleur + label, créées par l'admin
//     → quick add inline dans la fiche
//     → gestionnaire intégré (ajout / modif dans la même modal)
// ✓ Firestore :
//     npcs/{id}                          → fiche PNJ + affinité groupe
//     npc_affinites/{id}                 → relation individuelle PNJ ↔ joueur
//     npc_affinites/npc_affinite_types   → types d'affinités {id,label,emoji,couleur}
//     npc_affinites/npc_affinite_seuils  → seuils valeur→niveau
// ══════════════════════════════════════════════════════════════════════════════
import { loadCollection, addToCol, updateInCol, deleteFromCol, saveDoc } from '../data/firestore.js';
import { watchPageCollection } from '../shared/realtime.js';
import { openModal, closeModal, pushModal, updateModalContent, confirmModal } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import PAGES from './pages.js';
import { _esc, _norm, _searchIncludes } from '../shared/html.js';
import { consumeTargetEntity } from '../shared/entity-navigation.js';
import { getItemStatBonus, sortCharactersForDisplay, getMyCharacters, getModFromScore,
  computeEquipStatsBonus, computeEquipDerivedBonus, formatItemBonusText } from '../shared/char-stats.js';
import { buildEquippedItemFromInventory } from '../shared/equipment-utils.js';
import { _getTraits } from './characters/data.js';
import { listPlaces } from './map/data/places.repo.js';
import { listOrganizations } from './map/data/organizations.repo.js';
import { pickImageFile, compressDataUrl } from '../shared/image-upload.js';
import { panZoomCropHTML, attachPanZoomCrop } from '../shared/image-crop.js';
import { confirmDelete, trySave } from '../shared/crud.js';

// ── Stats PNJ (admin) ────────────────────────────────────────────────────────
// Les vitales/caractéristiques saisies sont les valeurs DE BASE. Les objets
// équipés (n.equipement, même forme que les persos joueurs) ajoutent leurs
// bonus par-dessus, calculés via les helpers purs de char-stats.js. Un PNJ sans
// équipement affiche donc exactement ses valeurs de base (rétro-compat).
const NPC_VITALS = [
  { key: 'pv',      label: 'PV',      icon: '❤️' },
  { key: 'pm',      label: 'PM',      icon: '✨' },
  { key: 'ca',      label: 'CA',      icon: '🛡️' },
  { key: 'vitesse', label: 'Vit.',    icon: '👟' },
];
const NPC_STATS = [
  { key: 'force',        short: 'FOR' },
  { key: 'dexterite',    short: 'DEX' },
  { key: 'constitution', short: 'CON' },
  { key: 'intelligence', short: 'INT' },
  { key: 'sagesse',      short: 'SAG' },
  { key: 'charisme',     short: 'CHA' },
];
const NPC_COMBAT_DEFAULT = { weaponName: '', damage: '', range: null };
// Emplacements d'équipement PNJ — identiques aux persos joueurs. `kind` pilote
// le filtrage des objets boutique éligibles au slot.
const NPC_EQUIP_SLOTS = [
  { slot: 'Main principale', icon: '⚔️', kind: 'weapon' },
  { slot: 'Main secondaire', icon: '🗡️', kind: 'weapon' },
  { slot: 'Tête',            icon: '🪖', kind: 'armor', armVal: 'Tête' },
  { slot: 'Torse',           icon: '🛡️', kind: 'armor', armVal: 'Torse' },
  { slot: 'Bottes',          icon: '🥾', kind: 'armor', armVal: 'Pieds' },
  { slot: 'Amulette',        icon: '📿', kind: 'bijou' },
  { slot: 'Anneau',          icon: '💍', kind: 'bijou' },
  { slot: 'Objet magique',   icon: '🔮', kind: 'bijou' },
];
const NPC_ACTIVITES = [
  ['forge', '🔨 Forge'], ['atelier_confection', '🧵 Atelier de confection'],
  ['atelier_orfevre', '💎 Orfèvre'], ['herboristerie', '🌿 Herboristerie'],
  ['taverne', '🍻 Taverne'], ['comptoir', '💰 Comptoir'],
  ['bibliotheque', '📜 Bibliothèque'], ['sanctuaire', '✨ Sanctuaire'],
  ['voliere', '🦅 Volière'],
];
const _actLabel = (slug) => (NPC_ACTIVITES.find(([s]) => s === slug) || [, slug])[1];

const _modStr = (v) => { const m = getModFromScore(Number(v) || 8); return m >= 0 ? `+${m}` : String(m); };
const _readNumberOrNull = (id) => {
  const raw = document.getElementById(id)?.value?.trim();
  if (!raw) return null;
  const v = parseInt(raw, 10);
  return Number.isFinite(v) ? v : null;
};
const _readText = (id) => document.getElementById(id)?.value?.trim() || '';
const _npcCombat = (npc) => ({ ...NPC_COMBAT_DEFAULT, ...(npc?.combat || {}) });
const _isShopWeapon = (item = {}) => item.template === 'arme' || item.degats;
const _weaponLabel = (item = {}) => [item.nom, item.sousType || item.typeArme].filter(Boolean).join(' · ');
const _weaponByLabel = (label) => _shopWeapons.find(w => _weaponLabel(w) === label) || null;
const _searchPart = (value) => {
  if (Array.isArray(value)) return value.map(_searchPart).join(' ');
  if (value && typeof value === 'object') return Object.values(value).map(_searchPart).join(' ');
  return value === null || value === undefined ? '' : String(value);
};
const _npcSearchText = (n = {}) => _norm([
  n.nom,
  n.role,
  n.lieu,
  n.organisations,
  n.description,
  n.combat?.weaponName,
  n.combat?.weapon,
  n.combat?.damage,
].map(_searchPart).join(' '));
const _npcMatchesSearch = (n, query) => _searchIncludes(_npcSearchText(n), query);
const _serializeShopWeapon = (item = {}) => ({
  itemId: item.id || item.itemId || '',
  nom: item.nom || '',
  degats: item.degats || '',
  degatsStat: item.degatsStat || item.statAttaque || '',
  degatsStats: Array.isArray(item.degatsStats) ? [...item.degatsStats] : (item.degatsStat ? [item.degatsStat] : []),
  toucherStat: item.toucherStat || item.statAttaque || '',
  statAttaque: item.statAttaque || item.toucherStat || '',
  typeArme: item.typeArme || item.sousType || '',
  sousType: item.sousType || '',
  portee: item.portee || '',
  traits: _getTraits(item),
  format: item.format || '',
  toucher: item.toucher || '',
  particularite: item.particularite || item.effet || '',
  stats: item.stats || '',
  fo: getItemStatBonus(item, 'force'),
  dex: getItemStatBonus(item, 'dexterite'),
  in: getItemStatBonus(item, 'intelligence'),
  sa: getItemStatBonus(item, 'sagesse'),
  co: getItemStatBonus(item, 'constitution'),
  ch: getItemStatBonus(item, 'charisme'),
});

// ── Affinité groupe — 5 niveaux fixes ────────────────────────────────────────
const AFFINITE = [
  { niveau: 0, label: "Hostile",  couleur: '#ff4757', bg: 'rgba(255,71,87,.12)',   border: 'rgba(255,71,87,.3)',   icon: '💢', desc: 'Cherche activement à nuire au groupe' },
  { niveau: 1, label: 'Méfiant',  couleur: '#ff9f43', bg: 'rgba(255,159,67,.1)',   border: 'rgba(255,159,67,.28)', icon: '👁️', desc: 'Prudent, peu coopératif' },
  { niveau: 2, label: 'Neutre',   couleur: '#a0aec0', bg: 'rgba(160,174,192,.08)', border: 'rgba(160,174,192,.22)',icon: '😐', desc: 'Ni ami ni ennemi' },
  { niveau: 3, label: 'Amical',   couleur: '#4f8cff', bg: 'rgba(79,140,255,.1)',   border: 'rgba(79,140,255,.28)', icon: '🤝', desc: 'Bienveillant, prêt à aider' },
  { niveau: 4, label: 'Allié',    couleur: '#22c38e', bg: 'rgba(34,195,142,.1)',   border: 'rgba(34,195,142,.28)', icon: '⚔️', desc: 'Loyal, combattra aux côtés du groupe' },
];

// ── Émojis et couleurs pour les affinités spécifiques ────────────────────────
const EMOJI_PRESET = [
  '🤝','❤️','🖤','💔','🫂',
  '⚔️','🗡️','🛡️','☠️','🩸','👹',
  '😈','👑','🏆','🎖️','🪖','⚖️',
  '🔮','🧙','🧛','🧝','🧟','🪄','📜',
  '👁️','🧠','🤫','🗝️','🎪',
  '🌿','🌲','🌙','⛈️','❄️',
  '🐉','🦅','🐺','🐍',
  '🎭','🎲','📖','🧭','⛓️',
  '💎','🔥','⚡'
];

const TYPE_COLORS = ['#d63031','#e74c3c','#ff6b6b','#ff7675','#ff4757','#e84393','#fd79a8','#ff6f91','#ff9ff3',
  '#e17055','#ff9f43','#ffb142','#e8b84b','#fdcb6e','#ffeaa7','#f6e58d','#6ab04c','#2ecc71','#22c38e','#00b894',
  '#55efc4','#7bed9f','#00cec9','#0abde3','#81ecec','#48dbfb','#00a8ff','#4f8cff','#0984e3','#3742fa','#6c5ce7',
  '#9c88ff','#a29bfe','#b47fff','#8e44ad','#636e72','#2d3436'
];

const afx = (n) => AFFINITE[Math.max(0, Math.min(4, n ?? 2))];
// Variables CSS inline pour les couleurs dynamiques d'affinité (consommées par npcs.css).
const _afVars = (af) => `--af:${af.couleur};--af-bg:${af.bg};--af-bd:${af.border}`;
const AFFINITE_TYPES_DOC_ID  = 'npc_affinite_types';
const AFFINITE_SEUILS_DOC_ID = 'npc_affinite_seuils';
const ORG_ICONS_DOC_ID       = 'npc_org_icons'; // { icons: { [orgName]: emoji } }

// Seuils par défaut (mode valeur) — chaque seuil = borne basse incluse du palier
const SEUILS_DEFAULT = { hostile: -50, mefiant: -10, neutre: 0, amical: 30, allie: 100 };
const SEUILS_KEYS    = ['hostile', 'mefiant', 'neutre', 'amical', 'allie'];

// ── État local ────────────────────────────────────────────────────────────────
let _npcs           = [];
let _affiPerso      = [];   // [{id, npcId, charId, charNom, typeId, typeLabel, note, notePublique}]
let _affiniteTypes  = [];   // [{id, label, emoji, couleur}]
let _affiniteSeuils = { ...SEUILS_DEFAULT };
let _places        = [];   // [{ id, name }] — alimente l'autocomplete Lieu
let _organisations = [];   // [{ id, name }] — alimente la sélection Organisations
let _orgIcons      = {};   // { [orgName]: emoji } — émoji personnalisé par catégorie (MJ)
let _shopWeapons   = [];   // armes issues de la boutique pour l'espace combat PNJ
let _shopItems     = [];   // tous les objets boutique (armes/armures/bijoux) — équipement PNJ
let _relationCharacters = []; // cache characters pour retrouver les portraits côté joueur
let _playerProfiles = [];  // profils publics de la page Joueurs, utiles pour les portraits visibles côté joueur
let _activeId      = null;
let _pendingTargetNpcId = null;
let _filterSearch  = '';
let _activeOrgFilter = null;
let _listView      = 'cat';  // 'cat' (par catégorie) | 'az' (liste à plat A→Z)
let _filterStatus  = '';     // ''=tous | 'mort' | 'disparu' | 'alive' (ni mort ni disparu)
let _filterHidden  = false;  // MJ : n'afficher que les PNJ cachés
let _histEditDelta = 0;
let _aftFormState = { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
let _equipPickerState = { npcId: '', slot: '', q: '' };

// ── Chargement ────────────────────────────────────────────────────────────────
// `npcs` et `shop` sont session-live → 0 lecture facturée. `npc_affinites` est
// piloté entièrement par le watch plus bas (collection unique avec docs spéciaux
// types/seuils + relations PJ↔PNJ). `places` et `organizations` restent un fetch
// page-scoped (1 lecture initiale, servi du cache IndexedDB sur cache chaud).
async function _load() {
  const [npcs, places, orgs, shopItems, relationCharacters, playerProfiles] = await Promise.all([
    loadCollection('npcs'),
    listPlaces().catch(() => []),
    listOrganizations().catch(() => []),
    loadCollection('shop').catch(() => []),
    loadCollection('characters').catch(() => []),
    loadCollection('players').catch(() => []),
  ]);
  _npcs           = npcs || [];
  _places        = (places || []).filter(p => p?.name).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  _organisations = (orgs   || []).filter(o => o?.name).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  _shopItems     = (shopItems || []).slice().sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr'));
  _shopWeapons   = _shopItems.filter(_isShopWeapon);
  _relationCharacters = relationCharacters || [];
  _playerProfiles = playerProfiles || [];
}

// ── Helpers types ─────────────────────────────────────────────────────────────
const _getAffiniteType      = (id) => _affiniteTypes.find(t => t.id === id) || null;
const _getAffiniteTypeLabel = (id, fb = '') => _getAffiniteType(id)?.label   || fb || '';
const _getAffiniteTypeColor = (id) => _getAffiniteType(id)?.couleur || TYPE_COLORS[0];
const _getAffiniteTypeEmoji = (id) => _getAffiniteType(id)?.emoji   || '✨';
const _decodeHtmlEntities = (v = '') => String(v)
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n) || 0))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16) || 0))
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');
const _displayText = (v = '') => _decodeHtmlEntities(v).trim();
// Vue résumée pour les chips d'affinité spécifique. Le label reste brut ici :
// l'échappement HTML se fait uniquement au rendu final pour éviter les doubles entités.
const _typeView = (a) => ({
  emoji: _getAffiniteTypeEmoji(a.typeId),
  color: _getAffiniteTypeColor(a.typeId),
  label: _displayText(_getAffiniteTypeLabel(a.typeId, a.typeLabel)) || '—',
});

// ── Helpers affinité (mode groupe vs valeur) ─────────────────────────────────
// En mode "valeur", le niveau est dérivé de la valeur cumulée et des seuils.
const _niveauFromValeur = (v, s = _affiniteSeuils) => {
  const x = Number(v) || 0;
  if (x >= (s.allie   ?? SEUILS_DEFAULT.allie))   return 4;
  if (x >= (s.amical  ?? SEUILS_DEFAULT.amical))  return 3;
  if (x >= (s.neutre  ?? SEUILS_DEFAULT.neutre))  return 2;
  if (x >= (s.mefiant ?? SEUILS_DEFAULT.mefiant)) return 1;
  return 0;
};
const _affiniteNiveau = (n) => {
  const a = n?.affinite || {};
  return a.mode === 'valeur' ? _niveauFromValeur(a.valeur) : (a.niveau ?? 2);
};
const _affiniteMode = (n) => n?.affinite?.mode === 'valeur' ? 'valeur' : 'groupe';

// ── Delta picker (partagé entre modal événement et édition d'historique) ─────
const _DELTA_PRESETS = [-2, -1, 0, 1, 2];
const _deltaActiveBg = (v) => v < 0 ? 'rgba(255,107,107,.18)' : v > 0 ? 'rgba(34,195,142,.18)' : 'rgba(255,255,255,.1)';
const _deltaBorderColor = (v) => v < 0 ? 'rgba(255,107,107,.3)' : v > 0 ? 'rgba(34,195,142,.3)' : 'var(--border)';
const _deltaTextColor = (v) => v < 0 ? '#ff6b6b' : v > 0 ? '#22c38e' : 'var(--text-dim)';

// Rend les boutons -2/-1/0/+1/+2. `current` = preset déjà actif (ou null).
// `actionName` = nom de l'action data-action à déclencher avec data-val="${v}".
function _deltaPresetsHtml(idPrefix, current, actionName, { size = 32 } = {}) {
  return _DELTA_PRESETS.map(v => {
    const active = v === current;
    return `<button type="button" id="${idPrefix}-${v}"
      data-action="${actionName}" data-val="${v}"
      style="width:${size}px;height:${size}px;border-radius:8px;cursor:pointer;font-size:.8rem;
      font-weight:700;transition:all .12s;
      border:${active ? '2px' : '1px'} solid ${_deltaBorderColor(v)};
      background:${active ? _deltaActiveBg(v) : 'var(--bg-elevated)'};
      color:${_deltaTextColor(v)}">${v > 0 ? '+' + v : v}</button>`;
  }).join('');
}

// Met à jour visuellement le preset actif après changement.
function _highlightDeltaPreset(idPrefix, v) {
  _DELTA_PRESETS.forEach(d => {
    const btn = document.getElementById(`${idPrefix}-${d}`);
    if (!btn) return;
    const active = d === v;
    btn.style.background  = active ? _deltaActiveBg(d) : 'var(--bg-elevated)';
    btn.style.borderWidth = active ? '2px' : '1px';
  });
}

// Persiste { affinite } sur un PNJ + met à jour le cache local + UI.
async function _persistAffinite(npcId, affinite, msg, { close = true } = {}) {
  if (!await trySave('npcs', npcId, { affinite })) return;
  const idx = _npcs.findIndex(x => x.id === npcId);
  if (idx >= 0) _npcs[idx] = { ..._npcs[idx], affinite };
  if (close) closeModal();
  showNotif(msg, 'success');
  _refreshActivePanel();
  _refreshList();
}

// En mode 'valeur', applique un changement de valeur cumulée et recalcule le niveau.
// `deltaChange` = différence à appliquer (suppression: -delta, édition: nouv-anc).
function _withValeurDelta(n, baseAffinite, deltaChange) {
  if (_affiniteMode(n) !== 'valeur' || !deltaChange) return baseAffinite;
  const valeur = (Number(n.affinite?.valeur) || 0) + deltaChange;
  return { ...baseAffinite, valeur, niveau: _niveauFromValeur(valeur) };
}

// ── Rendu principal ───────────────────────────────────────────────────────────
export async function renderNpcs() {
  const content = document.getElementById('main-content');
  // Pas de loader propre ici : la navigation affiche déjà le splash pleine page
  // (cf. _renderLoading dans navigation.js). En ajouter un second = flash splash→
  // spinner disgracieux. Le splash reste visible pendant _load, puis _renderPage.
  await _load();
  const target = consumeTargetEntity('npc');
  _pendingTargetNpcId = target?.id || _pendingTargetNpcId;
  if (_pendingTargetNpcId && _npcs.some(n => n.id === _pendingTargetNpcId)) {
    _activeId = _pendingTargetNpcId;
    _filterSearch = '';
    _filterStatus = '';
    _filterHidden = false;
    _activeOrgFilter = null;
    _pendingTargetNpcId = null;
  }
  if (!_activeId && _npcs.length) _activeId = _npcs[0].id;
  _renderPage(content);
  _bindCharPickOutside();

  // ── Abonnements temps réel ─────────────────────────────────────────────
  // Pour `npcs` (session-live) le watch ne refait aucune lecture facturée.
  // Pour `npc_affinites` (page-scoped), le watch sert aussi de fetch initial
  // → pas de double-read.
  watchPageCollection('npcs-list', 'npcs', 'npcs', data => {
    _npcs = data;
    if (_pendingTargetNpcId && _npcs.some(n => n.id === _pendingTargetNpcId)) {
      _activeId = _pendingTargetNpcId;
      _filterSearch = '';
      _filterStatus = '';
      _filterHidden = false;
      _activeOrgFilter = null;
      _pendingTargetNpcId = null;
    }
    _refreshList({ keepScroll: true });
    _refreshActivePanel();
  });

  // Une seule subscription pour la collection npc_affinites : on y range
  // les relations PNJ↔joueur + les 2 docs spéciaux (types, seuils).
  watchPageCollection('npcs-affi', 'npc_affinites', 'npcs', data => {
    _affiPerso = data.filter(a => a.id !== AFFINITE_TYPES_DOC_ID && a.id !== AFFINITE_SEUILS_DOC_ID && a.id !== ORG_ICONS_DOC_ID);
    const typesDoc  = data.find(a => a.id === AFFINITE_TYPES_DOC_ID);
    const seuilsDoc = data.find(a => a.id === AFFINITE_SEUILS_DOC_ID);
    _orgIcons = data.find(a => a.id === ORG_ICONS_DOC_ID)?.icons || {};
    _affiniteTypes = Array.isArray(typesDoc?.types) ? [...typesDoc.types] : [];
    _affiniteTypes.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
    _affiniteSeuils = { ...SEUILS_DEFAULT, ...(seuilsDoc || {}) };
    _refreshList({ keepScroll: true });
    _refreshActivePanel();
  });
}

function _renderPage(content) {
  const filtered = _getFiltered();
  const active   = _npcs.find(n => n.id === _activeId) || filtered[0] || null;

  content.innerHTML = _renderNpcsShell(filtered, active);
  _bindNpcListScroll();
  _scheduleNpcListScrollHint();
  return;

  content.innerHTML = `
  <div class="npc-page">

    <!-- ═══ SIDEBAR ═════════════════════════════════════════════════════ -->
    <aside class="npc-sidebar">
      <div class="npc-side-card">
        <div class="npc-side-head">
          <div>
            <div class="npc-side-title">👥 PNJ</div>
            <div class="npc-side-sub">${_npcs.length} personnage${_npcs.length > 1 ? 's' : ''}</div>
          </div>
          ${STATE.isAdmin ? `<button class="npc-btn-icon" data-action="npcCreate" title="Nouveau PNJ">+</button>` : ''}
        </div>

        <input id="npc-search" class="input-field" placeholder="🔍 Rechercher…"
          value="${_filterSearch}" data-input="_npcSearch" style="font-size:.8rem;padding:.4rem .6rem">

        ${STATE.isAdmin ? `
        <button class="npc-mj-btn" data-action="_openMjStatsView"
          title="Toutes les stats des PNJ en un coup d'œil — PV/PM ajustables">
          📊 Stats en un coup d'œil
        </button>` : ''}
      </div>

      <div id="npc-list-shell" class="npc-list-shell">
        <div id="npc-list-items" class="npc-list-items">
          ${_buildListHtml(filtered)}
        </div>
      </div>
    </aside>

    <!-- ═══ FICHE PRINCIPALE ═════════════════════════════════════════════ -->
    <div id="npc-detail-panel">
      ${active ? _renderFiche(active) : _renderEmpty()}
    </div>
  </div>`;
  _bindNpcListScroll();
  _scheduleNpcListScrollHint();
}

function _renderNpcsShell(filtered, active) {
  return `
  <div class="npc-page npc-page-v2 npc-page-v3">
    <aside class="npc-sidebar npc-roster-panel npc-command-panel">
      <div class="npc-command-head">
        <div>
          <span class="npc-dashboard-kicker">Registre</span>
          <h1>PNJ</h1>
        </div>
        ${STATE.isAdmin ? `<button class="npc-btn-icon npc-btn-icon--gold" data-action="npcCreate" title="Nouveau PNJ">+</button>` : ''}
      </div>

      <label class="npc-searchbox npc-command-search">
        <span>Recherche</span>
        <input id="npc-search" class="input-field" placeholder="Nom, rôle, lieu, organisation..."
          value="${_filterSearch}" data-input="_npcSearch">
      </label>

      ${_renderRosterMetrics(filtered)}

      ${STATE.isAdmin ? `
      <div class="npc-command-actions">
        <button class="npc-primary-btn" data-action="npcCreate">+ Nouveau PNJ</button>
        <button class="npc-secondary-btn" data-action="_openMjStatsView">Stats rapides</button>
      </div>` : ''}

      <div id="npc-list-shell" class="npc-list-shell">
        <div id="npc-list-items" class="npc-list-items">
          ${_buildListHtml(filtered)}
        </div>
      </div>
    </aside>

    <main id="npc-detail-panel" class="npc-detail-panel">
      ${active ? _renderFiche(active) : _renderEmpty()}
    </main>
  </div>`;
}

function _renderPageKpis(filtered) {
  const total = _npcs.length;
  const visible = STATE.isAdmin ? _npcs.filter(n => n.embauchable !== false).length : filtered.length;
  const allies = filtered.filter(n => _affiniteNiveau(n) >= 4).length;
  const bastion = filtered.filter(n => (n.activites || []).length || n.passif || n.salaireSuggere).length;
  const vttReady = filtered.filter(n =>
    n.pv || n.pm || n.ca || n.vitesse || Object.keys(n.stats || {}).length || Object.keys(n.equipement || {}).length
  ).length;
  const cells = [
    ['Total', total],
    ['Visibles', visible],
    ['Alliés', allies],
    ['VTT', vttReady],
    ['Bastion', bastion],
  ];
  if (STATE.isAdmin) cells.push(['Cachés', _npcs.filter(n => n.embauchable === false).length]);
  return cells.map(([label, value]) => `
    <div class="npc-dashboard-stat">
      <strong>${value}</strong>
      <span>${label}</span>
    </div>`).join('');
}

// ── Nav item ──────────────────────────────────────────────────────────────────
function _renderDashboardFocus(n) {
  const af = afx(_affiniteNiveau(n));
  const orgs = Array.isArray(n.organisations) ? n.organisations.filter(Boolean) : [];
  const status = NPC_STATUTS[n.statut]?.lbl || 'Vivant';
  const hasVtt = n.pv || n.pm || n.ca || n.vitesse || Object.keys(n.stats || {}).length || Object.keys(n.equipement || {}).length;
  return `
    <div class="npc-dashboard-focus" style="${_afVars(af)}">
      <div class="npc-dashboard-focus-avatar">
        ${n.imageUrl ? `<img src="${n.imageUrl}" alt="">` : `<span>${_esc((n.nom || '?')[0].toUpperCase())}</span>`}
      </div>
      <div class="npc-dashboard-focus-main">
        <span>Sélection</span>
        <strong>${_esc(n.nom || 'PNJ sans nom')}</strong>
        <small>${_esc([n.role, n.lieu].filter(Boolean).join(' - ') || 'Dossier à compléter')}</small>
      </div>
      <div class="npc-dashboard-focus-tags">
        <em>${af.icon} ${af.label}</em>
        <em>${_esc(status)}</em>
        ${hasVtt ? '<em>VTT</em>' : ''}
        ${orgs[0] ? `<em>${_esc(orgs[0])}</em>` : ''}
      </div>
    </div>`;
}

function _renderRosterMetrics(filtered) {
  const visible = filtered.length;
  const allies = filtered.filter(n => _affiniteNiveau(n) >= 4).length;
  const hidden = STATE.isAdmin ? filtered.filter(n => n.embauchable === false).length : 0;
  const ready = filtered.filter(n => n.pv || n.pm || n.ca || n.vitesse || Object.keys(n.stats || {}).length || Object.keys(n.equipement || {}).length).length;
  return `
    <div class="npc-roster-metrics">
      <span><b>${visible}</b> affichés</span>
      <span><b>${allies}</b> alliés</span>
      <span><b>${ready}</b> VTT</span>
      ${STATE.isAdmin ? `<span><b>${hidden}</b> cachés</span>` : ''}
    </div>`;
}

function _renderNavItem(n) {
  const isActive = n.id === _activeId;
  const niv      = _affiniteNiveau(n);
  const af       = afx(niv);
  const orgs = Array.isArray(n.organisations) ? n.organisations.filter(Boolean) : [];
  const place = n.lieu || orgs[0] || '';
  const hasVtt = n.pv || n.pm || n.ca || n.vitesse || Object.keys(n.stats || {}).length || Object.keys(n.equipement || {}).length;
  return `
  <div class="npc-nav-item ${isActive ? 'is-active' : ''} ${n.statut === 'mort' ? 'npc-nav-item--dead' : ''}" style="${_afVars(af)}"
    data-action="selectNpc" data-id="${n.id}" data-npc-id="${n.id}">

    <div class="npc-nav-avatar">
      ${n.imageUrl
        ? `<img src="${n.imageUrl}" alt="">`
        : `<span>${(n.nom || '?')[0].toUpperCase()}</span>`}
    </div>

    <div class="npc-nav-body">
      <div class="npc-nav-name">${_esc(n.nom || '?')}${NPC_STATUTS[n.statut] ? ` <span class="npc-status-tag" title="${NPC_STATUTS[n.statut].lbl}">${NPC_STATUTS[n.statut].ico}</span>` : ''}${STATE.isAdmin && n.embauchable === false ? ` <span class="npc-hidden-tag" title="Caché aux joueurs">🚫</span>` : ''}</div>
      <div class="npc-nav-sub">${_esc([n.role, place].filter(Boolean).join(' - ') || 'Profil à compléter')}</div>
      <div class="npc-nav-affi">
        <div class="npc-nav-dots">
          ${AFFINITE.map((a, i) => `<div class="npc-nav-dot" ${i <= niv ? `style="background:${a.couleur}"` : ''}></div>`).join('')}
        </div>
        <span class="npc-nav-affi-lbl">${af.label}</span>
        ${STATE.isAdmin && hasVtt ? `<span class="npc-nav-vtt">VTT</span>` : ''}
      </div>
    </div>

  </div>`;
}

// ══ Fiche PNJ — composants ════════════════════════════════════════════════════

// Portrait + identité (portrait reconnaissable, pas de bannière dans le corps)
function _renderNpcVttSnapshot(n) {
  if (!STATE.isAdmin) return '';
  const { equip, dBonus, caEquip } = _npcEquipEffect(n);
  const mainW = equip['Main principale'];
  const combat = _npcCombat(n);
  const vitalEquip = {
    pv: dBonus.pvMaxBonus,
    pm: dBonus.pmMaxBonus,
    ca: caEquip + dBonus.caBonus,
    vitesse: dBonus.vitesseBonus,
  };
  const total = (key) => (Number(n?.[key]) || 0) + (vitalEquip[key] || 0);
  const dmg = mainW?.degats || combat.weapon?.degats || combat.damage || '-';
  const range = mainW?.portee || combat.range || combat.weapon?.portee || '-';
  const weapon = mainW?.nom || combat.weaponName || combat.weapon?.nom || 'Aucune arme';
  return `
    <div class="npc-vtt-strip">
      <span><b>${total('pv') || '-'}</b> PV</span>
      <span><b>${total('pm') || '-'}</b> PM</span>
      <span><b>${total('ca') || '-'}</b> CA</span>
      <span><b>${total('vitesse') || '-'}</b> m</span>
      <span class="npc-vtt-strip-wide"><b>${_esc(dmg)}</b> ${_esc(weapon)}</span>
      <span><b>${_esc(range)}</b> portée</span>
    </div>`;
}

function _renderFicheHeader(n) {
  const af  = afx(_affiniteNiveau(n));
  const adm = STATE.isAdmin;
  const initial = (n.nom || '?')[0].toUpperCase();
  const portInner = n.imageUrl ? `<img src="${n.imageUrl}" alt="">` : `<span>${initial}</span>`;

  const portraitEl = n.imageUrl
    ? `<button class="npc-hero-portrait npc-portrait-btn npc-portrait-btn--view"
         data-action="npcViewPhoto" data-id="${n.id}" title="Voir l'image complète">
         ${portInner}</button>`
    : (adm
        ? `<button class="npc-hero-portrait npc-portrait-btn is-empty"
           data-action="npcSetPhoto" data-id="${n.id}" title="Ajouter un portrait">${portInner}</button>`
        : `<div class="npc-hero-portrait npc-hero-portrait--ph">${initial}</div>`);
  const editBadge = adm
    ? `<button class="npc-portrait-edit" data-action="npcSetPhoto" data-id="${n.id}" title="${n.imageUrl ? 'Changer le portrait' : 'Ajouter un portrait'}">📷</button>`
    : '';
  const portrait = `<div class="npc-portrait-box">${portraitEl}${editBadge}</div>`;

  const nameEl = adm
    ? `<input class="npc-inline npc-inline-name" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="nom" value="${_esc(n.nom || '')}" placeholder="Nom du PNJ">`
    : `<h2 class="npc-hero-name">${_esc(n.nom || '?')}</h2>`;
  const roleEl = adm
    ? `<input class="npc-inline npc-inline-role" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="role" value="${_esc(n.role || '')}" placeholder="Rôle (Forgeron, Garde…)">`
    : (n.role ? `<div class="npc-hero-role">${_esc(n.role)}</div>` : '');
  const lieuEl = adm
    ? `<input class="npc-inline npc-inline-lieu" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="lieu" value="${_esc(n.lieu || '')}" placeholder="📍 Lieu…">`
    : (n.lieu ? `<span class="npc-chip">📍 ${_esc(n.lieu)}</span>` : '');
  const orgsEl = adm
    ? `<input class="npc-inline npc-inline-lieu" style="max-width:240px" data-change="npcSaveOrgs" data-npc-id="${n.id}" value="${_esc((n.organisations || []).join(', '))}" placeholder="🏛️ Organisations (séparées par virgules)">`
    : (Array.isArray(n.organisations) && n.organisations.length ? `<span class="npc-chip">🏛️ ${n.organisations.map(_esc).join(', ')}</span>` : '');

  return `
  <div class="npc-hero" style="${_afVars(af)}">
    ${portrait}
    <div class="npc-hero-id">
      ${nameEl}
      ${roleEl}
      <div class="npc-hero-meta">
        <span class="npc-chip npc-chip--af">${af.icon} ${af.label}</span>
        ${lieuEl}
        ${orgsEl}
      </div>
      ${_renderNpcVttSnapshot(n)}
    </div>
    ${adm ? `
    <div class="npc-hero-actions">
      <button class="npc-mini-btn npc-mini-btn--danger" data-action="deleteNpc" data-id="${n.id}" title="Supprimer ce PNJ">🗑️ Supprimer</button>
      <button class="npc-mini-btn ${n.embauchable === false ? 'npc-mini-btn--off' : ''}" data-action="npcToggleEmbauchable" data-id="${n.id}" title="Visibilité côté joueurs (les PNJ cachés n'apparaissent pas dans leur liste)">${n.embauchable !== false ? '👁️ Visible joueurs' : '🚫 Caché joueurs'}</button>
    </div>` : ''}
  </div>`;
}

// Bloc "Profil bastion" : visible MJ toujours, joueur seulement si disposition = Allié
function _renderBastionProfil(n) {
  const adm = STATE.isAdmin;
  // Côté joueur : visible dès Amical (≥3), recrutable seulement une fois Allié (≥4).
  const niv = _affiniteNiveau(n);
  const canSee     = niv >= 3;
  const canRecruit = niv >= 4;
  if (!adm && !canSee) return '';

  const hasInfo = (n.activites && n.activites.length) || n.passif || n.salaireSuggere;
  if (!adm && !hasInfo) return ''; // joueur : rien à montrer

  const actSet = new Set(n.activites || []);
  const mjBadge = !canSee ? `<span class="npc-badge-mj">MJ</span>` : '';

  // ── Vue MJ : tout éditable inline ──
  if (adm) {
    return `
    <div class="npc-card">
      <div class="npc-card-hd">
        <div class="npc-card-title">🏰 Recrutable au Bastion${mjBadge}</div>
      </div>
      <div class="npc-edit-block" style="margin-bottom:.45rem">
        <span class="npc-edit-lbl">Activités / spécialités</span>
        <div class="npc-bastion-pills">
          ${NPC_ACTIVITES.map(([slug, label]) => `
            <button class="npc-act-toggle ${actSet.has(slug) ? 'is-on' : ''}" data-action="npcToggleActivite"
              data-id="${n.id}" data-slug="${slug}">${label}</button>`).join('')}
        </div>
      </div>
      <div class="npc-edit-block" style="margin-bottom:.45rem">
        <span class="npc-edit-lbl">Passif / bonus employé</span>
        <textarea class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="passif"
          rows="2" placeholder="+20% production Forge · −10% achats…">${_esc(n.passif || '')}</textarea>
      </div>
      <div class="npc-edit-block" style="max-width:200px">
        <span class="npc-edit-lbl">Salaire (or/sem.)</span>
        <input type="number" min="0" class="npc-inline" data-change="npcInlineSave"
          data-npc-id="${n.id}" data-field="salaireSuggere" value="${parseInt(n.salaireSuggere) || ''}" placeholder="0">
      </div>
    </div>`;
  }

  // ── Vue joueur (lecture seule) ──
  const activites = [...actSet].map(_actLabel);
  return `
  <div class="npc-card">
    <div class="npc-card-hd">
      <div class="npc-card-title">🏰 ${canRecruit ? 'Recrutable au Bastion' : 'Profil bastion'}</div>
    </div>
    ${activites.length ? `<div class="npc-bastion-pills">
      ${activites.map(a => `<span class="npc-bastion-pill">${_esc(a)}</span>`).join('')}
    </div>` : ''}
    ${n.passif ? `<div class="npc-bastion-passif">🎁 ${_esc(n.passif)}</div>` : ''}
    ${n.salaireSuggere ? `<div class="npc-bastion-sal">💰 ${n.salaireSuggere} or / sem.</div>` : ''}
    ${canRecruit
      ? `<div class="npc-bastion-recruit ok">✅ Recrutable — votre affinité est suffisante (Allié).</div>`
      : `<div class="npc-bastion-recruit lock">🔒 Recrutable une fois l'affinité du groupe au niveau <b>Allié</b>.</div>`}
  </div>`;
}

// Jauge d'affinité groupe (lecture seule — la modification passe par les événements)
function _renderAffiniteGroupe(n) {
  const niv = _affiniteNiveau(n);
  const af  = afx(niv);

  const segments = AFFINITE.map((a, i) => {
    const cls = i === niv ? 'is-current' : i < niv ? 'is-filled' : '';
    const vars = `--seg:${a.couleur};--seg-fill:${a.couleur}88;--seg-bd:${a.couleur}44`;
    return `<div class="npc-af-seg ${cls}" style="${vars}">
      <div class="npc-af-seg-bar"></div>
      <div class="npc-af-seg-lbl">${a.label}</div>
    </div>`;
  }).join('');

  const valeur = Number(n.affinite?.valeur) || 0;

  return `
  <div class="npc-card" style="${_afVars(af)}">
    <div class="npc-card-hd">
      <div class="npc-card-title">Affinité du groupe &amp; événements</div>
      ${STATE.isAdmin ? `
      <button class="npc-card-act npc-card-act--ghost" data-action="openAffiniteSeuilsModal" title="Configurer les seuils valeur → niveau">⚙️ Seuils</button>` : ''}
    </div>

    <div class="npc-af-gauge">${segments}</div>

    <div class="npc-af-state">
      <span class="npc-af-state-ico">${af.icon}</span>
      <div style="flex:1">
        <span class="npc-af-state-name">${af.label}</span>
        <span class="npc-af-state-desc"> — ${af.desc}</span>
      </div>
      ${STATE.isAdmin ? `<span class="npc-af-val" title="Valeur cumulée">${valeur > 0 ? '+' + valeur : valeur}</span>` : ''}
    </div>

    ${STATE.isAdmin
      ? `<div class="npc-edit-block" style="margin-top:.5rem">
          <span class="npc-edit-lbl">Note d'affinité</span>
          <textarea class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="affinite.note"
            rows="2" placeholder="Contexte de la relation au groupe…">${_esc(n.affinite?.note || '')}</textarea>
        </div>
        <div class="npc-edit-block" style="margin-top:.5rem">
          <span class="npc-edit-lbl">Ajouter un événement</span>
          <div class="npc-event-row">
            <input type="number" class="npc-inline npc-event-delta" id="afg-d-${n.id}" placeholder="±N" title="Variation d'affinité (ex : +2, -1)">
            <input type="text" class="npc-inline npc-event-text" id="afg-e-${n.id}" placeholder="Ex : A aidé lors de la défense de la ville…">
            <button class="npc-event-btn" data-action="npcAddEvent" data-id="${n.id}">＋ Ajouter</button>
          </div>
        </div>`
      : (n.affinite?.note ? `<div class="npc-af-note">« ${_esc(n.affinite.note)} »</div>` : '')}

    ${_renderHistorique(n)}
  </div>`;
}

// Historique des événements — bloc interne (intégré à la carte affinité)
function _renderHistorique(n) {
  const histo = n.affinite?.historique || [];
  if (!histo.length) return '';

  return `
  <div class="npc-histo">
    <div class="npc-card-hd" style="margin-top:.65rem;margin-bottom:.4rem">
      <div class="npc-card-title">Historique des événements</div>
      <span style="font-size:.64rem;color:var(--text-dim)">${histo.length} év.</span>
    </div>

    <div class="npc-histo-list">
      ${histo.slice().reverse().map((h, reversedIndex) => {
        const realIndex = histo.length - 1 - reversedIndex;
        const d = h.delta || 0;
        const col = d > 0 ? '#22c38e' : d < 0 ? '#ff6b6b' : '#a0aec0';
        const bg  = d > 0 ? 'rgba(34,195,142,.1)' : d < 0 ? 'rgba(255,107,107,.1)' : 'rgba(255,255,255,.04)';
        const vars = `--h-bg:${bg};--h-c:${col};--h-c-bg:${col}20;--h-c-bd:${col}44`;

        return `<div class="npc-histo-row" style="${vars}">
          <span class="npc-histo-delta">${d > 0 ? '+' + d : d < 0 ? d : '~'}</span>
          <span class="npc-histo-text">${h.texte ? _esc(h.texte) : '<em style="color:var(--text-dim)">(sans titre)</em>'}</span>
          ${h.date ? `<span class="npc-histo-date">${h.date}</span>` : ''}
          ${STATE.isAdmin ? `
          <div class="npc-rel-actions" style="margin-left:.2rem">
            <button class="npc-icon-btn" data-action="editHistoriqueEntry" data-npc-id="${n.id}" data-idx="${realIndex}">✏️</button>
            <button class="npc-icon-btn npc-icon-btn--danger" data-action="deleteHistoriqueEntry" data-npc-id="${n.id}" data-idx="${realIndex}">🗑️</button>
          </div>` : ''}
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

// Chip affinité spécifique — vue admin
function _renderRelationChip(a, npcId) {
  const { emoji, color } = _typeView(a);
  const vars = `--rc:${color};--rc-bg:${color}12;--rc-bd:${color}30`;
  const typeOpts = _affiniteTypes.map(t =>
    `<option value="${t.id}" ${t.id === a.typeId ? 'selected' : ''}>${t.emoji || '✨'} ${_esc(_displayText(t.label))}</option>`).join('');
  return `
  <div class="npc-rel-chip npc-rel-chip--edit" style="${vars}">
    <span class="npc-rel-emoji">${emoji}</span>
    <div class="npc-rel-body">
      <div class="npc-rel-editrow">
        <select class="npc-select npc-rel-typesel" data-change="npcAffiField" data-aff-id="${a.id}" data-field="typeId">${typeOpts}</select>
        <span class="npc-rel-target">${_affiTargetAvatar(a)}${_esc(a.charNom || '?')}</span>
      </div>
      <input class="npc-inline" data-change="npcAffiField" data-aff-id="${a.id}" data-field="notePublique"
        value="${_esc(a.notePublique || '')}" placeholder="🌐 Note publique…">
      <input class="npc-inline" data-change="npcAffiField" data-aff-id="${a.id}" data-field="note"
        value="${_esc(a.note || '')}" placeholder="🔒 Note privée…">
    </div>
    <div class="npc-rel-actions">
      <button class="npc-icon-btn npc-icon-btn--danger" data-action="deleteAffinitePerso" data-id="${a.id}">🗑️</button>
    </div>
  </div>`;
}

// Chip affinité spécifique — vue joueur (sa propre relation)
function _renderRelationChipPlayer(a) {
  const { emoji, color, label } = _typeView(a);
  const vars = `--rc:${color};--rc-bg:${color}12;--rc-bd:${color}30`;
  return `
  <div class="npc-rel-chip" style="${vars}">
    <span class="npc-rel-emoji">${emoji}</span>
    <div class="npc-rel-body">
      <div class="npc-rel-label">${_esc(label)}</div>
      <div class="npc-rel-target">${_affiTargetAvatar(a)}${_esc(a.charNom || '?')}</div>
      ${a.notePublique ? `<div class="npc-rel-note">🌐 ${_esc(a.notePublique)}</div>` : ''}
      ${a.note ? `<div class="npc-rel-note">🔒 ${_esc(a.note)}</div>` : ''}
    </div>
  </div>`;
}

// Chip affinité spécifique — vue joueur (lien d'un autre PJ, note publique uniquement)
function _renderRelationChipPublic(a) {
  const { emoji, color, label } = _typeView(a);
  const vars = `--rc:${color};--rc-bg:${color}10;--rc-bd:${color}28`;
  return `
  <div class="npc-rel-chip" style="${vars}">
    <span class="npc-rel-emoji" style="opacity:.85">${emoji}</span>
    <div class="npc-rel-body">
      <div class="npc-rel-label">${_esc(label)}</div>
      <div class="npc-rel-target">${_affiTargetAvatar(a)}${_esc(a.charNom || '?')}</div>
      ${(a.notePublique || '').trim() ? `<div class="npc-rel-note">🌐 ${_esc(a.notePublique)}</div>` : ''}
    </div>
  </div>`;
}

// Panneau des relations (colonne droite)
function _renderRelationsPanel(n) {
  const persoList = _affiPerso.filter(a => a.npcId === n.id);
  const myChars   = getMyCharacters(STATE.characters, STATE.user?.uid);
  const myAffi    = persoList.filter(a => myChars.some(c => c.id === a.charId));

  if (STATE.isAdmin) {
    const chars = sortCharactersForDisplay(STATE.characters || []);
    return `
    <div class="npc-card">
      <div class="npc-card-hd">
        <div class="npc-card-title">Affinités spécifiques</div>
        <button class="npc-card-act npc-card-act--ghost" data-action="openAffiniteTypesManager">⚙️ Types</button>
      </div>
      <div class="npc-rel-list npc-rel-scroll">
        ${persoList.length
          ? persoList.map(a => _renderRelationChip(a, n.id)).join('')
          : `<div class="npc-empty-line">Aucune affinité spécifique</div>`}
      </div>
      <div class="npc-edit-block" style="margin-top:.55rem">
        <span class="npc-edit-lbl">Ajouter une affinité</span>
        <div class="npc-affi-add">
          <div class="npc-charpick">
            <input type="hidden" id="afp-char-${n.id}" value="">
            <button type="button" class="npc-charpick-trigger" data-action="npcCharPickToggle" data-npc-id="${n.id}">
              <span class="npc-charpick-current"><span class="npc-charpick-ph">Choisir un personnage…</span></span>
              <span class="npc-charpick-caret">▾</span>
            </button>
            <div class="npc-charpick-panel">
              ${chars.length ? chars.map(c => `
                <button type="button" class="npc-charpick-opt" data-action="npcCharPickSelect"
                  data-npc-id="${n.id}" data-char-id="${c.id}" data-char-nom="${_esc(c.nom || '?')}">
                  ${_charAvatar(c)}
                  <span class="npc-charpick-opt-txt"><b>${_esc(c.nom || '?')}</b><small>${_esc(c.ownerPseudo || '?')}</small></span>
                </button>`).join('')
                : `<div class="npc-empty-line">Aucun personnage</div>`}
            </div>
          </div>
          <select class="npc-select" id="afp-type-${n.id}">
            <option value="">— Type —</option>
            ${_affiniteTypes.map(t => `<option value="${t.id}">${t.emoji || '✨'} ${_esc(_displayText(t.label))}</option>`).join('')}
          </select>
          <button class="npc-event-btn" data-action="npcAddAffiPerso" data-npc-id="${n.id}">＋ Ajouter</button>
        </div>
      </div>
    </div>`;
  }

  // Côté joueur : on montre toutes les affinités spécifiques du PNJ.
  // Ses propres personnages d'abord (avec note perso), puis les liens avec les
  // autres PJ (type + cible + note publique seulement, jamais la note privée MJ).
  const others = persoList.filter(a => !myChars.some(c => c.id === a.charId));
  if (!persoList.length) return '';

  const ownPanel = myAffi.length ? `
  <div class="npc-card" style="background:rgba(79,140,255,.06);border-color:rgba(79,140,255,.2)">
    <div class="npc-card-hd"><div class="npc-card-title" style="color:var(--gold)">✨ Ta relation avec ce PNJ</div></div>
    <div class="npc-rel-list">${myAffi.map(a => _renderRelationChipPlayer(a)).join('')}</div>
  </div>` : '';

  const othersPanel = others.length ? `
  <div class="npc-card">
    <div class="npc-card-hd"><div class="npc-card-title">Affinités spécifiques</div></div>
    <div class="npc-rel-list">${others.map(a => _renderRelationChipPublic(a)).join('')}</div>
  </div>` : '';

  return ownPanel + othersPanel;
}

// Fiche principale assemblée
function _renderFicheLegacy(n) {
  const desc = STATE.isAdmin
    ? `<div class="npc-edit-block">
        <span class="npc-edit-lbl">Description</span>
        <textarea class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="description"
          rows="3" placeholder="Apparence, personnalité, secrets…">${_esc(n.description || '')}</textarea>
      </div>`
    : (n.description ? `<div class="npc-desc">${_esc(n.description)}</div>` : '');
  // Statut narratif (MJ) — segmenté Vivant / Mort / Disparu.
  const statutSel = STATE.isAdmin ? `
    <div class="npc-statut-bar">
      <span class="npc-edit-lbl">Statut</span>
      <div class="npc-statut-seg">
        ${[['', '💚 Vivant'], ['mort', '☠️ Mort'], ['disparu', '❓ Disparu']].map(([v, lbl]) =>
          `<button type="button" class="npc-statut-btn ${(n.statut || '') === v ? 'is-on' : ''}" data-action="npcSetStatut" data-id="${n.id}" data-statut="${v}">${lbl}</button>`).join('')}
      </div>
    </div>` : '';
  // Notes MJ — jamais rendues côté joueur (réservées à l'admin).
  const noteMJ = STATE.isAdmin ? `
    <div class="npc-edit-block npc-note-mj">
      <span class="npc-edit-lbl">🔒 Notes MJ <span class="npc-note-mj-hint">(jamais visible des joueurs)</span></span>
      <textarea class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="noteMJ"
        rows="3" placeholder="Intrigue, vraie identité, twist, objectif secret…">${_esc(n.noteMJ || '')}</textarea>
    </div>` : '';
  // Colonne principale (affinité + événements, puis stats) et colonne latérale
  // (affinités spécifiques, bastion). L'historique est intégré à la carte affinité.
  const main = [_renderAffiniteGroupe(n), _renderStatsPanel(n)].filter(Boolean).join('');
  const side = [_renderRelationsPanel(n), _renderBastionProfil(n)].filter(Boolean).join('');

  const body = side
    ? `<div class="npc-cols">
         <div class="npc-col">${main}</div>
         <div class="npc-col">${side}</div>
       </div>`
    : main;

  return `
  <div class="npc-fiche">
    ${_renderFicheHeader(n)}
    <div class="npc-body">
      ${statutSel}
      ${noteMJ ? `<div class="npc-topgrid">${desc}${noteMJ}</div>` : desc}
      ${body}
    </div>
  </div>`;
}

function _renderFicheV3(n) {
  const desc = STATE.isAdmin
    ? `<textarea class="npc-inline npc-field-textarea" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="description"
          rows="4" placeholder="Apparence, personnalite, secrets...">${_esc(n.description || '')}</textarea>`
    : (n.description ? `<div class="npc-desc">${_esc(n.description)}</div>` : '<div class="npc-empty-line">Aucune description publique.</div>');

  const statutSel = STATE.isAdmin ? `
    <div class="npc-statut-bar npc-statut-bar--panel">
      <span class="npc-edit-lbl">Statut narratif</span>
      <div class="npc-statut-seg">
        ${[['', 'Vivant'], ['mort', 'Mort'], ['disparu', 'Disparu']].map(([v, lbl]) =>
          `<button type="button" class="npc-statut-btn ${(n.statut || '') === v ? 'is-on' : ''}" data-action="npcSetStatut" data-id="${n.id}" data-statut="${v}">${lbl}</button>`).join('')}
      </div>
    </div>` : '';

  const noteMJ = STATE.isAdmin ? `
    <textarea class="npc-inline npc-field-textarea npc-note-mj-field" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="noteMJ"
      rows="4" placeholder="Intrigue, vraie identite, objectif secret...">${_esc(n.noteMJ || '')}</textarea>` : '';

  const dossier = `
    <div class="npc-dossier-grid">
      <section class="npc-dossier-card npc-dossier-card--story">
        <div class="npc-dossier-title">
          <span>Dossier public</span>
          ${STATE.isAdmin ? '<small>Visible par les joueurs</small>' : ''}
        </div>
        ${desc}
      </section>
      ${STATE.isAdmin ? `
      <section class="npc-dossier-card npc-dossier-card--gm">
        <div class="npc-dossier-title">
          <span>Pilotage MJ</span>
          <small>Privé</small>
        </div>
        ${statutSel}
        <div class="npc-edit-block npc-note-mj">
          <span class="npc-edit-lbl">Notes MJ</span>
          ${noteMJ}
        </div>
      </section>` : ''}
    </div>`;

  const main = [_renderAffiniteGroupe(n), _renderStatsPanel(n)].filter(Boolean).join('');
  const side = [_renderRelationsPanel(n), _renderBastionProfil(n)].filter(Boolean).join('');

  const body = side
    ? `<div class="npc-cols">
         <div class="npc-col npc-col--main">${main}</div>
         <div class="npc-col npc-col--side">${side}</div>
       </div>`
    : main;

  return `
  <div class="npc-fiche">
    ${_renderFicheHeader(n)}
    <div class="npc-body">
      ${dossier}
      ${body}
    </div>
  </div>`;
}

function _renderFiche(n) {
  const af = afx(_affiniteNiveau(n));
  return `
  <article class="npc-workfile" style="${_afVars(af)}">
    ${_renderNpcWorkHeader(n, af)}
    <div class="npc-workfile-grid">
      <section class="npc-workfile-main">
        ${_renderNpcRelationDesk(n, af)}
        ${_renderNpcStoryDesk(n)}
        ${_renderNpcTimelineDesk(n)}
      </section>
      <aside class="npc-workfile-side">
        ${_renderNpcTacticalDesk(n)}
        ${_renderNpcPeopleDesk(n)}
      </aside>
    </div>
  </article>`;
}

function _renderNpcWorkHeader(n, af) {
  const adm = STATE.isAdmin;
  const initial = (n.nom || '?')[0].toUpperCase();
  const portraitInner = n.imageUrl ? `<img src="${n.imageUrl}" alt="">` : `<span>${initial}</span>`;
  const portraitMain = n.imageUrl
    ? `<button class="npc-work-portrait npc-work-portrait--btn" data-action="npcViewPhoto" data-id="${n.id}" title="Voir l'image complète">${portraitInner}</button>`
    : (adm
        ? `<button class="npc-work-portrait npc-work-portrait--btn" data-action="npcSetPhoto" data-id="${n.id}" title="Ajouter un portrait">${portraitInner}</button>`
        : `<div class="npc-work-portrait">${portraitInner}</div>`);
  const portrait = `<div class="npc-work-portrait-box">${portraitMain}${adm ? `<button class="npc-portrait-edit" data-action="npcSetPhoto" data-id="${n.id}" title="${n.imageUrl ? 'Changer le portrait' : 'Ajouter un portrait'}">📷</button>` : ''}</div>`;
  const orgs = Array.isArray(n.organisations) ? n.organisations.filter(Boolean) : [];
  const status = NPC_STATUTS[n.statut]?.lbl || 'Vivant';
  return `
    <header class="npc-work-head">
      ${portrait}
      <div class="npc-work-id">
        ${adm
          ? `<input class="npc-inline npc-work-name" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="nom" value="${_esc(n.nom || '')}" placeholder="Nom du PNJ">`
          : `<h2 class="npc-work-name">${_esc(n.nom || '?')}</h2>`}
        <div class="npc-work-fields">
          ${adm
            ? `<input class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="role" value="${_esc(n.role || '')}" placeholder="Rôle">
               <input class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="lieu" value="${_esc(n.lieu || '')}" placeholder="Lieu">
               <input class="npc-inline" data-change="npcSaveOrgs" data-npc-id="${n.id}" value="${_esc(orgs.join(', '))}" placeholder="Organisations">`
            : `<span>${_esc(n.role || 'Rôle inconnu')}</span><span>${_esc(n.lieu || 'Lieu inconnu')}</span>${orgs.length ? `<span>${orgs.map(_esc).join(', ')}</span>` : ''}`}
        </div>
        <div class="npc-work-tags">
          <span>${af.icon} ${af.label}</span>
          <span>${_esc(status)}</span>
          ${orgs.slice(0, 2).map(o => `<span>${_esc(o)}</span>`).join('')}
          ${n.embauchable === false && adm ? '<span>Caché joueurs</span>' : ''}
        </div>
      </div>
      ${adm ? `
      <div class="npc-work-actions">
        <button class="npc-mini-btn ${n.embauchable === false ? 'npc-mini-btn--off' : ''}" data-action="npcToggleEmbauchable" data-id="${n.id}">${n.embauchable !== false ? 'Visible joueurs' : 'Caché joueurs'}</button>
        <button class="npc-mini-btn npc-mini-btn--danger" data-action="deleteNpc" data-id="${n.id}">Supprimer</button>
      </div>` : ''}
    </header>`;
}

function _renderNpcRelationDesk(n, af) {
  const valeur = Number(n.affinite?.valeur) || 0;
  const segments = AFFINITE.map((a, i) => `<span class="${i <= _affiniteNiveau(n) ? 'is-on' : ''}" style="--seg:${a.couleur}">${a.label}</span>`).join('');
  return `
    <section class="npc-work-card npc-work-card--relation">
      <div class="npc-work-card-head">
        <div><small>Relation groupe</small><strong>${af.icon} ${af.label}</strong></div>
        ${STATE.isAdmin ? `<button class="npc-card-act npc-card-act--ghost" data-action="openAffiniteSeuilsModal">Seuils</button>` : ''}
      </div>
      <div class="npc-relation-scale">${segments}</div>
      <div class="npc-relation-state">
        <p>${_esc(af.desc || '')}</p>
        ${STATE.isAdmin ? `<b>${valeur > 0 ? '+' + valeur : valeur}</b>` : ''}
      </div>
      ${STATE.isAdmin ? `
      <div class="npc-relation-edit">
        <textarea class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="affinite.note"
          rows="2" placeholder="Note de relation...">${_esc(n.affinite?.note || '')}</textarea>
      </div>` : (n.affinite?.note ? `<div class="npc-af-note">${_esc(n.affinite.note)}</div>` : '')}
    </section>`;
}

function _renderNpcStoryDesk(n) {
  if (STATE.isAdmin) {
    return `
      <section class="npc-work-card npc-work-card--story">
        <div class="npc-work-card-head"><div><small>Carnet</small><strong>Public et privé</strong></div></div>
        <div class="npc-story-split">
          <label><span>Description publique</span><textarea class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="description" rows="6" placeholder="Ce que les joueurs peuvent savoir...">${_esc(n.description || '')}</textarea></label>
          <label><span>Notes MJ</span><textarea class="npc-inline npc-note-mj-field" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="noteMJ" rows="6" placeholder="Secrets, objectifs, révélations...">${_esc(n.noteMJ || '')}</textarea></label>
        </div>
        <div class="npc-statut-bar npc-statut-bar--panel">
          <span class="npc-edit-lbl">Statut</span>
          <div class="npc-statut-seg">
            ${[['', 'Vivant'], ['mort', 'Mort'], ['disparu', 'Disparu']].map(([v, lbl]) =>
              `<button type="button" class="npc-statut-btn ${(n.statut || '') === v ? 'is-on' : ''}" data-action="npcSetStatut" data-id="${n.id}" data-statut="${v}">${lbl}</button>`).join('')}
          </div>
        </div>
      </section>`;
  }
  return n.description ? `<section class="npc-work-card npc-work-card--story"><div class="npc-desc">${_esc(n.description)}</div></section>` : '';
}

function _renderNpcTimelineDesk(n) {
  const histo = n.affinite?.historique || [];
  return `
    <section class="npc-work-card npc-work-card--timeline">
      <div class="npc-work-card-head"><div><small>Chronologie</small><strong>${histo.length ? `${histo.length} événements` : 'Aucun événement'}</strong></div></div>
      ${STATE.isAdmin ? `
      <div class="npc-timeline-compose">
        <input type="number" class="npc-inline npc-event-delta" id="afg-d-${n.id}" placeholder="+/-" title="Variation d'affinité">
        <input type="text" class="npc-inline npc-event-text" id="afg-e-${n.id}" placeholder="Ce qui vient de se passer dans l'histoire...">
        <button class="npc-event-btn" data-action="npcAddEvent" data-id="${n.id}">Ajouter à la chronologie</button>
      </div>` : ''}
      <div class="npc-work-timeline">
        ${histo.length ? histo.slice().reverse().slice(0, 8).map((h, reversedIndex) => {
          const realIndex = histo.length - 1 - reversedIndex;
          const d = Number(h.delta) || 0;
          return `<div class="npc-work-timeline-row">
            <b class="${d > 0 ? 'is-good' : d < 0 ? 'is-bad' : ''}">${d > 0 ? '+' + d : d || '~'}</b>
            <span>${h.texte ? _esc(h.texte) : 'Événement sans titre'}</span>
            ${h.date ? `<small>${_esc(h.date)}</small>` : ''}
            ${STATE.isAdmin ? `<button class="npc-icon-btn" data-action="editHistoriqueEntry" data-npc-id="${n.id}" data-idx="${realIndex}">Edit</button>` : ''}
          </div>`;
        }).join('') : '<div class="npc-work-timeline-empty">Aucun événement pour le moment. Ajoute le premier directement ici.</div>'}
      </div>
    </section>`;
}

function _renderNpcTacticalDesk(n) {
  if (!STATE.isAdmin) return '';
  const stats = n?.stats || {};
  const { equip, sBonus, dBonus, caEquip } = _npcEquipEffect(n);
  const mainW = equip['Main principale'];
  const combat = _npcCombat(n);
  const dmg = mainW?.degats || combat.weapon?.degats || combat.damage || '-';
  const range = mainW?.portee || combat.range || combat.weapon?.portee || '-';
  const vitalEquip = { pv: dBonus.pvMaxBonus, pm: dBonus.pmMaxBonus, ca: caEquip + dBonus.caBonus, vitesse: dBonus.vitesseBonus };
  const vitals = NPC_VITALS.map(v => {
    const base = n?.[v.key];
    const bonus = vitalEquip[v.key] || 0;
    return `<label class="npc-tactic-cell"><span>${v.label}</span><input type="number" class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="${v.key}" value="${base ?? ''}" placeholder="-">${bonus ? `<em>${bonus > 0 ? '+' : ''}${bonus}</em>` : ''}</label>`;
  }).join('');
  const statCells = NPC_STATS.map(s => {
    const score = stats[s.key];
    const bonus = sBonus[s.key] || 0;
    const effScore = score != null ? (Number(score) || 0) + bonus : null;
    return `<label class="npc-tactic-cell npc-tactic-cell--stat"><span>${s.short}</span><input type="number" class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="stat:${s.key}" value="${score ?? ''}" placeholder="-"><small>${effScore != null ? _modStr(effScore) : ''}</small></label>`;
  }).join('');
  return `
    <section class="npc-work-card npc-work-card--tactic">
      <div class="npc-work-card-head"><div><small>VTT</small><strong>Fiche tactique</strong></div><span>${_esc(dmg)} / ${_esc(range)}</span></div>
      <div class="npc-tactic-grid">${vitals}</div>
      <div class="npc-tactic-grid npc-tactic-grid--stats">${statCells}</div>
      ${_renderNpcEquip(n, equip, { dmg, range })}
    </section>`;
}

function _renderNpcPeopleDesk(n) {
  const blocks = [_renderNpcSpecificRelationsDesk(n), _renderBastionProfil(n)].filter(Boolean).join('');
  return blocks ? `<div class="npc-people-stack">${blocks}</div>` : '';
}

function _renderNpcSpecificRelationsDesk(n) {
  const persoList = _affiPerso.filter(a => a.npcId === n.id);
  const myChars = getMyCharacters(STATE.characters, STATE.user?.uid);
  const myAffi = persoList.filter(a => myChars.some(c => c.id === a.charId));

  if (STATE.isAdmin) {
    const chars = sortCharactersForDisplay(STATE.characters || []);
    return `
      <section class="npc-work-card npc-work-card--links">
        <div class="npc-work-card-head">
          <div><small>Liens personnels</small><strong>${persoList.length ? `${persoList.length} relations` : 'Aucune relation'}</strong></div>
          <button class="npc-card-act npc-card-act--ghost" data-action="openAffiniteTypesManager">Types</button>
        </div>
        <div class="npc-link-board">
          ${persoList.length ? persoList.map(a => _renderNpcRelationCard(a)).join('') : '<div class="npc-link-empty">Aucun lien spécifique. Ajoute une relation avec un personnage pour donner du relief au PNJ.</div>'}
        </div>
        <div class="npc-link-composer">
          <div class="npc-charpick">
            <input type="hidden" id="afp-char-${n.id}" value="">
            <button type="button" class="npc-charpick-trigger" data-action="npcCharPickToggle" data-npc-id="${n.id}">
              <span class="npc-charpick-current"><span class="npc-charpick-ph">Choisir un personnage...</span></span>
              <span class="npc-charpick-caret">▾</span>
            </button>
            <div class="npc-charpick-panel">
              ${chars.length ? chars.map(c => `
                <button type="button" class="npc-charpick-opt" data-action="npcCharPickSelect"
                  data-npc-id="${n.id}" data-char-id="${c.id}" data-char-nom="${_esc(c.nom || '?')}">
                  ${_charAvatar(c)}
                  <span class="npc-charpick-opt-txt"><b>${_esc(c.nom || '?')}</b><small>${_esc(c.ownerPseudo || '?')}</small></span>
                </button>`).join('') : '<div class="npc-empty-line">Aucun personnage</div>'}
            </div>
          </div>
          <select class="npc-select" id="afp-type-${n.id}">
            <option value="">Type de relation</option>
            ${_affiniteTypes.map(t => `<option value="${t.id}">${t.emoji || '*'} ${_esc(_displayText(t.label))}</option>`).join('')}
          </select>
          <button class="npc-event-btn" data-action="npcAddAffiPerso" data-npc-id="${n.id}">Lier</button>
        </div>
      </section>`;
  }

  const others = persoList.filter(a => !myChars.some(c => c.id === a.charId));
  if (!persoList.length) return '';
  return `
    <section class="npc-work-card npc-work-card--links">
      <div class="npc-work-card-head"><div><small>Liens personnels</small><strong>Relations connues</strong></div></div>
      ${myAffi.length ? `<div class="npc-link-board npc-link-board--own">${myAffi.map(a => _renderNpcRelationCard(a, { playerView: true })).join('')}</div>` : ''}
      ${others.length ? `<div class="npc-link-board">${others.map(a => _renderNpcRelationCard(a, { publicOnly: true })).join('')}</div>` : ''}
    </section>`;
}

function _renderNpcRelationCard(a, { publicOnly = false, playerView = false } = {}) {
  const { emoji, color, label } = _typeView(a);
  const vars = `--rc:${color};--rc-bg:${color}12;--rc-bd:${color}34`;
  const typeOpts = _affiniteTypes.map(t =>
    `<option value="${t.id}" ${t.id === a.typeId ? 'selected' : ''}>${t.emoji || '*'} ${_esc(_displayText(t.label))}</option>`).join('');
  const publicNote = (a.notePublique || '').trim();
  const privateNote = (a.note || '').trim();
  return `
    <article class="npc-link-card${playerView ? ' is-own' : ''}" style="${vars}">
      <div class="npc-link-avatar">${_affiTargetAvatar(a)}</div>
      <div class="npc-link-content">
        <div class="npc-link-top">
          <strong>${_esc(a.charNom || '?')}</strong>
          <span>${emoji} ${_esc(label || 'Relation')}</span>
        </div>
        ${STATE.isAdmin && !publicOnly ? `
          <select class="npc-select npc-link-type" data-change="npcAffiField" data-aff-id="${a.id}" data-field="typeId">${typeOpts}</select>
          <input class="npc-inline" data-change="npcAffiField" data-aff-id="${a.id}" data-field="notePublique" value="${_esc(a.notePublique || '')}" placeholder="Note publique">
          <input class="npc-inline npc-link-secret" data-change="npcAffiField" data-aff-id="${a.id}" data-field="note" value="${_esc(a.note || '')}" placeholder="Note privée MJ">`
          : `
          ${publicNote ? `<p>${_esc(publicNote)}</p>` : ''}
          ${playerView && privateNote ? `<p class="npc-link-secret-text">${_esc(privateNote)}</p>` : ''}`}
      </div>
      ${STATE.isAdmin && !publicOnly ? `<button class="npc-icon-btn npc-icon-btn--danger npc-link-delete" data-action="deleteAffinitePerso" data-id="${a.id}">X</button>` : ''}
    </article>`;
}

function _renderEmpty() {
  return `
  <div class="npc-fiche-empty">
    <div class="npc-fiche-empty-ico">👥</div>
    <p style="color:var(--text-dim);font-style:italic">
      ${STATE.isAdmin ? 'Aucun PNJ. Cliquez sur + pour en créer un.' : 'Aucun PNJ disponible.'}</p>
    ${STATE.isAdmin ? `<button data-action="npcCreate" class="btn btn-gold btn-sm"
      style="margin-top:1rem">+ Créer le premier PNJ</button>` : ''}
  </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _getFiltered() {
  // Visibilité joueurs : un PNJ avec embauchable === false est caché (toggle
  // « 🚫 Caché joueurs » de la fiche). Le MJ voit tout. (Filtrage UI ; la vraie
  // confidentialité passerait par les règles Firestore — cf. note.)
  let base = STATE.isAdmin ? _npcs : _npcs.filter(n => n.embauchable !== false);
  if (STATE.isAdmin && _filterHidden) base = base.filter(n => n.embauchable === false);
  if (_filterStatus === 'mort')         base = base.filter(n => n.statut === 'mort');
  else if (_filterStatus === 'disparu') base = base.filter(n => n.statut === 'disparu');
  else if (_filterStatus === 'alive')   base = base.filter(n => n.statut !== 'mort' && n.statut !== 'disparu');
  return base.filter(n => _npcMatchesSearch(n, _filterSearch));
}

// Barre de contrôles : bascule de vue (Catégories / A→Z) + filtres rapides.
function _renderListControls() {
  const viewBtn = (v, lbl) => `<button type="button" class="npc-lc-btn ${_listView === v ? 'is-on' : ''}" data-action="npcSetListView" data-view="${v}">${lbl}</button>`;
  const statBtn = (v, lbl, title) => `<button type="button" class="npc-lc-chip ${_filterStatus === v ? 'is-on' : ''}" data-action="npcSetStatusFilter" data-status="${v}" title="${title}">${lbl}</button>`;
  return `<div class="npc-list-controls">
    <div class="npc-lc-seg">${viewBtn('cat', '📁 Catégories')}${viewBtn('az', '🔤 A→Z')}</div>
    <div class="npc-lc-filters">
      ${statBtn('', 'Tous', 'Tous les statuts')}
      ${statBtn('mort', '☠️', 'Morts seulement')}
      ${statBtn('disparu', '❓', 'Disparus seulement')}
      ${STATE.isAdmin ? `<button type="button" class="npc-lc-chip ${_filterHidden ? 'is-on' : ''}" data-action="npcToggleHiddenFilter" title="N'afficher que les PNJ cachés">🚫</button>` : ''}
    </div>
  </div>`;
}

function _renderFlatList(filtered) {
  const sorted = [...filtered].sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }));
  return `<div class="npc-list-modebar"><span>A→Z</span><span>${sorted.length} PNJ</span></div>
    <div class="npc-flat-list">${sorted.map(_renderNavItem).join('')}</div>`;
}

// ── Sélection & filtres ───────────────────────────────────────────────────────
export function selectNpc(id) {
  _activeId = id;

  _refreshList();
  _refreshActivePanel();
}

function _npcSearch(val) {
  _filterSearch = val;
  _refreshList({ keepScroll: false });
}

function _refreshList({ keepScroll = true } = {}) {
  const list = document.getElementById('npc-list-items');
  if (!list) { renderNpcs(); return; }
  const scrollTop = keepScroll ? list.scrollTop : 0;
  list.innerHTML = _buildListHtml();
  list.scrollTop = scrollTop;
  _scheduleNpcListScrollHint();
}

function _bindNpcListScroll() {
  const list = document.getElementById('npc-list-items');
  if (list) list.onscroll = () => _updateNpcListScrollHint(list);
}

function _scheduleNpcListScrollHint() {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => _updateNpcListScrollHint());
    return;
  }
  _updateNpcListScrollHint();
}

function _updateNpcListScrollHint(list = document.getElementById('npc-list-items')) {
  const shell = document.getElementById('npc-list-shell');
  if (!shell || !list) return;

  const maxScroll = list.scrollHeight - list.clientHeight;
  const canScroll = maxScroll > 4;
  const atTop = list.scrollTop <= 2;
  const atBottom = list.scrollTop >= maxScroll - 2;

  shell.classList.toggle('is-scrollable', canScroll);
  shell.classList.toggle('can-scroll-up', canScroll && !atTop);
  shell.classList.toggle('can-scroll-down', canScroll && !atBottom);
}


// ── Groupement par organisation (navigation par catégories) ──────────────────
// Statut narratif d'un PNJ (défaut = vivant : aucune valeur stockée).
const NPC_STATUTS = {
  mort:    { lbl: 'Mort',    ico: '☠️' },
  disparu: { lbl: 'Disparu', ico: '❓' },
};

const NO_ORG_KEY = '__no_org__';

function _groupNpcsByOrg(npcs) {
  // Map<orgName, npc[]> — préserve l'ordre des _organisations connues, "Sans
  // organisation" en dernier. Les NPCs avec plusieurs orgs apparaissent dans
  // chaque groupe correspondant.
  const groups = new Map();
  _organisations.forEach(o => groups.set(o.name, []));
  npcs.forEach(n => {
    const orgs = (Array.isArray(n.organisations) ? n.organisations : []).filter(Boolean);
    if (!orgs.length) return; // traité ci-dessous
    orgs.forEach(orgName => {
      if (!groups.has(orgName)) groups.set(orgName, []); // org orpheline (renommée/supprimée)
      groups.get(orgName).push(n);
    });
  });
  // "Sans organisation" toujours en dernier.
  groups.set(NO_ORG_KEY, npcs.filter(n =>
    !Array.isArray(n.organisations) || !n.organisations.filter(Boolean).length
  ));
  // Tri alphabétique des PNJ à l'intérieur de chaque groupe (nom, insensible à la casse/accents)
  for (const arr of groups.values()) {
    arr.sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }));
  }
  return groups;
}

function _orgLabel(orgName) {
  return orgName === NO_ORG_KEY ? 'Sans organisation' : orgName;
}

function _orgIcon(orgName) {
  if (orgName === NO_ORG_KEY) return '👤';
  return _orgIcons[orgName] || '🏛️';
}

function _visibleOrgEntries(groups) {
  return [...groups.entries()].filter(([, items]) => items.length > 0);
}

function _renderOrgIndex(entries) {
  const groupCount = entries.length;
  const totalCount = entries.reduce((sum, [, items]) => sum + items.length, 0);
  return `
    <div class="npc-list-modebar">
      <span>Catégories</span>
      <span>${groupCount} groupe${groupCount > 1 ? 's' : ''} · ${totalCount} PNJ</span>
    </div>
    <div class="npc-org-index">
      ${entries.map(([orgName, items]) => _renderOrgIndexItem(orgName, items)).join('')}
    </div>`;
}

function _renderOrgIndexItem(orgName, npcs) {
  const isNoOrg   = orgName === NO_ORG_KEY;
  const label     = _orgLabel(orgName);
  const safeKey   = _esc(orgName);
  const hasActiveNpc = _activeId && npcs.some(n => n.id === _activeId);

  return `<button type="button" data-org-key="${safeKey}" title="${_esc(label)}"
    class="npc-org-card ${hasActiveNpc ? 'is-active' : ''}"
    data-action="_npcSelectOrg">
    <span class="npc-org-card-main">
      <span class="npc-org-icon">${_orgIcon(orgName)}</span>
      <span class="npc-org-card-text">
        <strong>${_esc(label)}</strong>
      </span>
    </span>
    <span class="npc-org-count">${npcs.length}</span>
  </button>`;
}

function _renderOrgDrilldown(orgName, npcs) {
  const label = _orgLabel(orgName);
  const count = npcs.length;
  return `
    <div class="npc-drill-head">
      <button type="button" class="npc-drill-back" data-action="_npcBackToOrgs">‹</button>
      <span class="npc-drill-title">
        <strong>${_orgIcon(orgName)} ${_esc(label)}</strong>
        <small>${count} PNJ</small>
      </span>
      ${STATE.isAdmin && orgName !== NO_ORG_KEY
        ? `<button type="button" class="npc-org-emoji-btn" data-action="npcEditOrgIcon" data-org="${_esc(orgName)}" title="Changer l'emoji de la catégorie">${_orgIcon(orgName)} ✎</button>`
        : ''}
    </div>
    <div class="npc-drill-list">
      ${npcs.map(n => _renderNavItem(n)).join('')}
    </div>`;
}

function _renderSearchResults(entries, total) {
  return `
    <div class="npc-list-modebar">
      <span>Résultats</span>
      <span>${total} PNJ</span>
    </div>
    ${entries.map(([orgName, items]) => `
      <div class="npc-search-group">
        <div class="npc-search-group-title">
          <span>${_orgIcon(orgName)} ${_esc(_orgLabel(orgName))}</span>
          <span>${items.length}</span>
        </div>
        ${items.map(n => _renderNavItem(n)).join('')}
      </div>
    `).join('')}`;
}

function _buildListHtml(filtered = _getFiltered()) {
  // Drilldown d'une catégorie (vue Catégories, hors recherche) : sous-vue propre.
  if (_activeOrgFilter && _listView === 'cat' && !_filterSearch.trim()) {
    const selected = _groupNpcsByOrg(filtered).get(_activeOrgFilter) || [];
    if (selected.length) return _renderOrgDrilldown(_activeOrgFilter, selected);
    _activeOrgFilter = null;
  }
  const controls = _renderListControls();
  if (filtered.length === 0) {
    const why = _filterSearch.trim() ? ' trouvé' : (_filterStatus || _filterHidden) ? ' (filtre actif)' : '';
    return controls + `<div style="padding:1.5rem;text-align:center;color:var(--text-dim);
        font-size:.8rem;font-style:italic">Aucun PNJ${why}</div>`;
  }
  if (_filterSearch.trim()) {
    const entries = _visibleOrgEntries(_groupNpcsByOrg(filtered));
    return controls + _renderSearchResults(entries, filtered.length);
  }
  if (_listView === 'az') return controls + _renderFlatList(filtered);
  const entries = _visibleOrgEntries(_groupNpcsByOrg(filtered));
  return controls + _renderOrgIndex(entries);
}

function _npcSelectOrg(btn) {
  const key = btn?.dataset?.orgKey;
  if (key == null) return;
  _activeOrgFilter = key;
  _refreshList({ keepScroll: false });
}

function _npcBackToOrgs() {
  _activeOrgFilter = null;
  _refreshList({ keepScroll: false });
}

function _npcSetListView(btn) {
  _listView = btn.dataset.view === 'az' ? 'az' : 'cat';
  _activeOrgFilter = null;
  _refreshList({ keepScroll: false });
}
function _npcSetStatusFilter(btn) {
  _filterStatus = btn.dataset.status || '';
  _refreshList({ keepScroll: false });
}
function _npcToggleHiddenFilter() {
  _filterHidden = !_filterHidden;
  _refreshList({ keepScroll: false });
}

async function _npcSetStatut(btn) {
  if (!STATE.isAdmin) return;
  const id = btn.dataset.id; const statut = btn.dataset.statut || '';
  const n = _npcs.find(x => x.id === id); if (!n) return;
  n.statut = statut;
  await trySave('npcs', id, { statut });
  _refreshActivePanel();
  _refreshList({ keepScroll: true });
}

// ── Émoji personnalisé par catégorie (organisation) ───────────────────────────
const ORG_ICON_PALETTE = ['🏛️','⚔️','🛡️','👑','💰','🏰','⛪','🗡️','🏴‍☠️','🐉','🌲','⚜️','🔮','🧙','🐺','🦅','🌟','🔥','❄️','💀','🎭','📜','⚖️','🍺','⚒️','🏹','🌹','🕯️','👁️','🦁','🌊','🪙'];

function _npcEditOrgIcon(btn) {
  if (!STATE.isAdmin) return;
  const org = btn.dataset.org; if (!org) return;
  const cur = _orgIcons[org] || '';
  openModal(`🎨 Emoji de « ${_esc(org)} »`, `
    <div class="npc-emoji-pick">
      <div class="npc-emoji-grid">
        ${ORG_ICON_PALETTE.map(e => `<button type="button" class="npc-emoji-opt ${e === cur ? 'is-on' : ''}" data-action="npcPickOrgIcon" data-org="${_esc(org)}" data-emoji="${e}">${e}</button>`).join('')}
      </div>
      <div class="npc-emoji-free">
        <input type="text" class="input-field" id="npc-emoji-input" maxlength="8" value="${_esc(cur)}" placeholder="…ou colle ton propre emoji" autocomplete="off">
        <button class="btn btn-gold btn-sm" data-action="npcApplyOrgIconInput" data-org="${_esc(org)}">OK</button>
      </div>
      <div class="npc-emoji-foot">
        <button class="btn btn-outline btn-sm" data-action="npcResetOrgIcon" data-org="${_esc(org)}">↺ Émoji par défaut (🏛️)</button>
      </div>
    </div>`);
}

async function _saveOrgIcon(org, emoji) {
  if (!STATE.isAdmin || !org) return;
  // On stocke '' (= défaut) plutôt que de supprimer la clé : compatible avec un
  // saveDoc en merge, et _orgIcon retombe sur 🏛️ pour une valeur vide.
  _orgIcons = { ..._orgIcons, [org]: (emoji || '').trim() };
  try {
    await saveDoc('npc_affinites', ORG_ICONS_DOC_ID, { icons: _orgIcons });
    closeModal();
    _refreshList({ keepScroll: true });
  } catch (e) { console.error('[org icon]', e); showNotif("Échec de l'enregistrement de l'emoji.", 'error'); }
}

function _npcPickOrgIcon(btn)       { _saveOrgIcon(btn.dataset.org, btn.dataset.emoji); }
function _npcResetOrgIcon(btn)      { _saveOrgIcon(btn.dataset.org, ''); }
function _npcApplyOrgIconInput(btn) { _saveOrgIcon(btn.dataset.org, document.getElementById('npc-emoji-input')?.value || ''); }

// ── Équipement PNJ ────────────────────────────────────────────────────────────
const _isShield = (i = {}) => (i.sousType || i.nom || '').toLowerCase().includes('bouclier');

// Objets boutique éligibles à un slot donné.
function _shopItemsForSlot(def) {
  if (def.kind === 'weapon') return _shopItems.filter(i => _isShopWeapon(i) || _isShield(i));
  if (def.kind === 'armor')  return _shopItems.filter(i => i.slotArmure === def.armVal);
  return _shopItems.filter(i => i.slotBijou === def.slot);
}

// Contribution agrégée de l'équipement (bonus de stats + bonus dérivés + CA).
function _npcEquipEffect(n) {
  const equip   = n?.equipement || {};
  const sBonus  = computeEquipStatsBonus(equip);
  const dBonus  = computeEquipDerivedBonus(equip);
  const caEquip = Object.values(equip).reduce((s, it) => s + (parseInt(it?.ca) || 0), 0);
  return { equip, sBonus, dBonus, caEquip };
}

// Petits badges de bonus pour l'objet équipé dans un slot.
function _npcEquipBadges(eq, def) {
  const parts = [];
  if (def.kind === 'weapon' && eq.degats) parts.push(`🗡️ ${eq.degats}`);
  const bonusText = formatItemBonusText(eq);
  if (bonusText) parts.push(bonusText);
  const ca = (parseInt(eq.ca) || 0) + (parseInt(eq.caBonus) || 0);
  if (ca) parts.push(`CA ${ca > 0 ? '+' : ''}${ca}`);
  [['pvMaxBonus', 'PV'], ['pmMaxBonus', 'PM'], ['vitesseBonus', 'Vit']].forEach(([k, lbl]) => {
    const v = parseInt(eq[k]) || 0;
    if (v) parts.push(`${lbl} ${v > 0 ? '+' : ''}${v}`);
  });
  return parts.map(p => `<span class="npc-eq-badge">${_esc(p)}</span>`).join('');
}

function _npcEquipSearchText(item = {}) {
  return _norm([
    item.nom,
    item.type,
    item.template,
    item.sousType,
    item.typeArme,
    item.slotArmure,
    item.slotBijou,
    item.rarete,
    item.degats,
    item.effet,
    item.particularite,
    item.description,
    formatItemBonusText(item),
  ].map(_searchPart).join(' '));
}

function _npcEquipPreviewBadges(item, def) {
  const built = buildEquippedItemFromInventory(def.slot, item, null) || { ...item };
  built.itemId = item.id || item.itemId || '';
  built.nom = built.nom || item.nom || '';
  return _npcEquipBadges(built, def);
}

function _npcEquipPickerTitle() {
  const def = NPC_EQUIP_SLOTS.find(s => s.slot === _equipPickerState.slot);
  return `Équiper ${def?.slot || 'PNJ'}`;
}

function _renderEquipPickerHtml() {
  const { npcId, slot, q } = _equipPickerState;
  const n = _npcs.find(x => x.id === npcId);
  const def = NPC_EQUIP_SLOTS.find(s => s.slot === slot);
  if (!n || !def) return '<div class="npc-equip-picker-empty">Emplacement introuvable.</div>';

  const equip = n.equipement || {};
  const current = equip[slot] || null;
  const all = _shopItemsForSlot(def);
  const query = _norm(q || '');
  const filtered = query ? all.filter(i => _searchIncludes(_npcEquipSearchText(i), query)) : all;
  const shown = filtered.slice(0, 80);
  const more = Math.max(0, filtered.length - shown.length);

  return `
    <div class="npc-equip-picker">
      <div class="npc-equip-picker-head">
        <div>
          <div class="npc-equip-picker-slot">${def.icon} ${_esc(def.slot)}</div>
          <div class="npc-equip-picker-current">${current ? `Actuel : <b>${_esc(current.nom || 'Objet équipé')}</b>` : 'Aucun objet équipé'}</div>
        </div>
        ${current ? `
          <button class="btn btn-outline btn-sm" data-action="npcClearEquipSlot"
            data-npc-id="${_esc(npcId)}" data-slot="${_esc(slot)}">
            Retirer
          </button>` : ''}
      </div>

      <input class="input-field npc-equip-search" data-input="npcEquipPickerSearch"
        value="${_esc(q || '')}" placeholder="Rechercher par nom, type, dégâts, bonus..." autocomplete="off">
      <div class="npc-equip-picker-meta">
        ${filtered.length} / ${all.length} objets compatibles
        ${more ? `<span>${more} autres disponibles en affinant la recherche</span>` : ''}
      </div>

      <div class="npc-equip-results">
        ${shown.length ? shown.map(item => {
          const badges = _npcEquipPreviewBadges(item, def);
          const selected = current?.itemId === item.id;
          const sub = [item.sousType || item.typeArme || item.type, item.slotArmure || item.slotBijou, item.rarete].filter(Boolean).join(' - ');
          return `
            <button type="button" class="npc-equip-result${selected ? ' is-selected' : ''}"
              data-action="npcPickEquipItem" data-npc-id="${_esc(npcId)}" data-slot="${_esc(slot)}" data-item-id="${_esc(item.id)}">
              <span class="npc-equip-result-main">
                <strong>${_esc(item.nom || 'Objet sans nom')}</strong>
                ${sub ? `<small>${_esc(sub)}</small>` : ''}
              </span>
              ${badges ? `<span class="npc-eq-badges">${badges}</span>` : '<span class="npc-equip-no-bonus">Aucun bonus direct</span>'}
            </button>`;
        }).join('') : '<div class="npc-equip-picker-empty">Aucun objet compatible avec cette recherche.</div>'}
      </div>
    </div>`;
}

function _npcOpenEquipPicker(btn) {
  if (!STATE.isAdmin || !btn) return;
  _equipPickerState = { npcId: btn.dataset.npcId || '', slot: btn.dataset.slot || '', q: '' };
  openModal(_npcEquipPickerTitle(), _renderEquipPickerHtml(), { subtitle: 'Objets compatibles de la boutique' });
  requestAnimationFrame(() => document.querySelector('.npc-equip-search')?.focus());
}

function _npcEquipPickerSearch(el) {
  if (!el) return;
  const caret = el.selectionStart || 0;
  _equipPickerState.q = el.value || '';
  updateModalContent(_npcEquipPickerTitle(), _renderEquipPickerHtml(), { subtitle: 'Objets compatibles de la boutique' });
  requestAnimationFrame(() => {
    const next = document.querySelector('.npc-equip-search');
    if (!next) return;
    next.focus();
    try { next.setSelectionRange(caret, caret); } catch {}
  });
}

function _renderNpcEquip(n, equip, summary) {
  const modernSlotCard = (def) => {
    const eq = equip[def.slot] || null;
    const opts = _shopItemsForSlot(def);
    const badges = eq ? _npcEquipBadges(eq, def) : '';
    const itemSub = eq ? [eq.sousType || eq.typeArme || eq.type, eq.slotArmure || eq.slotBijou].filter(Boolean).join(' - ') : '';
    return `
      <div class="npc-eq-cell${eq ? ' is-on' : ''}">
        <div class="npc-eq-slot">
          <span>${def.icon} ${_esc(def.slot)}</span>
          <small>${opts.length} choix</small>
        </div>
        <div class="npc-eq-current${eq ? '' : ' is-empty'}">
          <strong>${eq ? _esc(eq.nom || 'Objet équipé') : 'Vide'}</strong>
          <span>${eq ? _esc(itemSub || 'Objet boutique') : 'Aucun objet équipé'}</span>
        </div>
        ${badges ? `<div class="npc-eq-badges">${badges}</div>` : ''}
        <div class="npc-eq-actions">
          <button class="npc-eq-pick-btn" type="button" data-action="npcOpenEquipPicker"
            data-npc-id="${_esc(n.id)}" data-slot="${_esc(def.slot)}">
            Choisir
          </button>
          ${eq ? `
            <button class="npc-eq-clear-btn" type="button" title="Vider l'emplacement" data-action="npcClearEquipSlot"
              data-npc-id="${_esc(n.id)}" data-slot="${_esc(def.slot)}">
              X
            </button>` : ''}
        </div>
      </div>`;
  };
  return `
    <div class="npc-eq-block">
      <div class="npc-eq-hd">
        <span class="npc-edit-lbl">Équipement</span>
        <span class="npc-eq-combat">${_esc(summary.dmg)} - portée ${_esc(summary.range)}</span>
      </div>
      <div class="npc-eq-grid">${NPC_EQUIP_SLOTS.map(modernSlotCard).join('')}</div>
    </div>`;

  const slotCard = (def) => {
    const eq   = equip[def.slot] || null;
    const opts = _shopItemsForSlot(def);
    const options = ['<option value="">— Vide —</option>']
      .concat(opts.map(i => `<option value="${i.id}" ${eq?.itemId === i.id ? 'selected' : ''}>${_esc(i.nom || '?')}</option>`))
      .join('');
    const badges = eq ? _npcEquipBadges(eq, def) : '';
    return `
      <div class="npc-eq-cell${eq ? ' is-on' : ''}">
        <div class="npc-eq-slot">${def.icon} ${def.slot}</div>
        <select class="npc-select npc-eq-sel" data-change="npcEquipSlot" data-npc-id="${n.id}" data-slot="${_esc(def.slot)}">
          ${options}
        </select>
        ${badges ? `<div class="npc-eq-badges">${badges}</div>` : ''}
      </div>`;
  };
  return `
    <div class="npc-eq-block">
      <div class="npc-eq-hd">
        <span class="npc-edit-lbl">🎒 Équipement</span>
        <span class="npc-eq-combat">🗡️ ${_esc(summary.dmg)} · ⌖ ${_esc(summary.range)}</span>
      </div>
      <div class="npc-eq-grid">${NPC_EQUIP_SLOTS.map(slotCard).join('')}</div>
    </div>`;
}

function _renderStatsPanel(n) {
  if (!STATE.isAdmin) return ''; // bloc réservé MJ
  const stats = n?.stats || {};
  const { equip, sBonus, dBonus, caEquip } = _npcEquipEffect(n);

  // Résumé combat : arme équipée en Main principale, sinon arme legacy (combat).
  const mainW  = equip['Main principale'];
  const combat = _npcCombat(n);
  const dmg    = mainW?.degats || combat.weapon?.degats || combat.damage || '—';
  const range  = mainW?.portee || combat.range || combat.weapon?.portee || '—';

  // Vitaux : base saisie + contribution équipement = total.
  const vitalEquip = {
    pv:      dBonus.pvMaxBonus,
    pm:      dBonus.pmMaxBonus,
    ca:      caEquip + dBonus.caBonus,
    vitesse: dBonus.vitesseBonus,
  };
  const vitals = NPC_VITALS.map(v => {
    const base  = n?.[v.key];
    const bonus = vitalEquip[v.key] || 0;
    const total = (Number(base) || 0) + bonus;
    return `
    <div class="npc-stat-cell">
      <div class="npc-stat-k">${v.icon} ${v.label}</div>
      <input type="number" class="npc-inline" data-change="npcInlineSave"
        data-npc-id="${n.id}" data-field="${v.key}" value="${base ?? ''}" placeholder="—"
        title="Valeur de base (hors équipement)">
      ${bonus ? `<div class="npc-stat-mod" title="Base ${Number(base) || 0} + équipement ${bonus > 0 ? '+' : ''}${bonus}">= ${total} <span class="npc-eq-plus">(${bonus > 0 ? '+' : ''}${bonus})</span></div>` : ''}
    </div>`;
  }).join('');

  const statCells = NPC_STATS.map(s => {
    const score = stats[s.key];
    const bonus = sBonus[s.key] || 0;
    const effScore = score != null ? (Number(score) || 0) + bonus : null;
    return `
    <div class="npc-stat-cell">
      <div class="npc-stat-k">${s.short}</div>
      <input type="number" class="npc-inline" data-change="npcInlineSave"
        data-npc-id="${n.id}" data-field="stat:${s.key}" value="${score ?? ''}" placeholder="—"
        title="Score de base (hors équipement)">
      <div class="npc-stat-mod">${effScore != null ? `${_modStr(effScore)}${bonus ? ` <span class="npc-eq-plus">(${bonus > 0 ? '+' : ''}${bonus})</span>` : ''}` : '&nbsp;'}</div>
    </div>`;
  }).join('');

  return `
    <div class="npc-card npc-stats-card">
      <div class="npc-card-hd">
        <div class="npc-card-title">🛡️ Combat &amp; stats <span style="font-weight:400;color:var(--text-dim)">(MJ)</span></div>
      </div>
      <div class="npc-stat-grid">${vitals}</div>
      <div class="npc-stat-grid npc-stat-grid--6">${statCells}</div>
      ${_renderNpcEquip(n, equip, { dmg, range })}
    </div>`;
}

// Équipe / retire un objet boutique sur un slot PNJ, recalcule le bonus de stats.
async function _npcEquipSlot(el) {
  if (!STATE.isAdmin || !el) return;
  await _npcApplyEquipSlot(el.dataset.npcId, el.dataset.slot, el.value);
}

async function _npcPickEquipItem(btn) {
  if (!STATE.isAdmin || !btn) return;
  await _npcApplyEquipSlot(btn.dataset.npcId, btn.dataset.slot, btn.dataset.itemId, { closePicker: true });
}

async function _npcClearEquipSlot(btn) {
  if (!STATE.isAdmin || !btn) return;
  await _npcApplyEquipSlot(btn.dataset.npcId, btn.dataset.slot, '', { closePicker: !!btn.closest('.npc-equip-picker') });
}

async function _npcApplyEquipSlot(id, slot, itemId, { closePicker = false } = {}) {
  if (!STATE.isAdmin) return;
  const n = _npcs.find(x => x.id === id); if (!n || !slot) return;
  const equip = { ...(n.equipement || {}) };
  if (!itemId) {
    delete equip[slot];
  } else {
    const item = _shopItems.find(i => i.id === itemId);
    if (!item) return;
    const built = buildEquippedItemFromInventory(slot, item, null);
    if (!built) return;
    built.itemId = item.id; // identité boutique (buildEquipped… lit item.itemId, absent ici)
    equip[slot] = built;
  }
  const statsBonus = computeEquipStatsBonus(equip);
  n.equipement = equip; n.statsBonus = statsBonus;
  if (await trySave('npcs', id, { equipement: equip, statsBonus })) {
    showNotif(itemId ? 'Équipement mis à jour.' : 'Emplacement vidé.', 'success');
  }
  if (closePicker) closeModal();
  _refreshActivePanel();
}

// ── Vue MJ : tableau condensé de tous les PNJ avec stats ────────────────────
const _mjVitalCellInner = (v) => v == null ? '—' : String(v);
const _mjStatCellInner  = (s) => s == null ? '—'
  : `${s}<br><span style="font-size:.6rem;color:var(--text-muted)">${_modStr(s)}</span>`;

function _renderMjStatsRow(n) {
  const af    = afx(_affiniteNiveau(n));
  const stats = n.stats || {};

  const vitalCells = NPC_VITALS.map(v => `
    <td data-mj-cell="${n.id}-${v.key}"
      data-action="_mjEditField" data-npc-id="${n.id}" data-field="${v.key}"
      title="Cliquer pour modifier ${v.label}"
      style="cursor:pointer;text-align:center;padding:.4rem .25rem;font-weight:700;
      color:${n[v.key] == null ? 'var(--text-dim)' : 'var(--text)'};
      background:rgba(232,184,75,.05)">${_mjVitalCellInner(n[v.key])}</td>`).join('');

  const statCells = NPC_STATS.map(s => `
    <td data-mj-cell="${n.id}-stats.${s.key}"
      data-action="_mjEditField" data-npc-id="${n.id}" data-field="stats.${s.key}"
      title="Cliquer pour modifier ${s.short}"
      style="cursor:pointer;text-align:center;padding:.4rem .2rem;line-height:1.1;
      color:${stats[s.key] == null ? 'var(--text-dim)' : 'var(--text)'};
      background:rgba(232,184,75,.05)">${_mjStatCellInner(stats[s.key])}</td>`).join('');

  return `
    <tr style="border-bottom:1px solid rgba(255,255,255,.04)"
      data-hov-bg="rgba(255,255,255,.02)">
      <td style="padding:.35rem;text-align:left;cursor:pointer;color:var(--text);
        max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
        data-action="_mjOpenNpc" data-id="${n.id}" title="Ouvrir la fiche">
        <span style="display:inline-block;width:6px;height:6px;border-radius:50%;
          background:${af.couleur};margin-right:.4rem;vertical-align:middle"></span>
        <strong>${_esc(n.nom || '?')}</strong>
      </td>
      ${vitalCells}
      ${statCells}
    </tr>`;
}

let _mjFilter = '';

function _mjFilteredNpcs() {
  return _npcs.filter(n => _npcMatchesSearch(n, _mjFilter));
}

function _renderMjStatsTbody() {
  const list = _mjFilteredNpcs();
  if (!list.length) {
    return `<tr><td colspan="${1 + NPC_VITALS.length + NPC_STATS.length}"
      style="text-align:center;padding:2rem;color:var(--text-dim);font-style:italic">
      ${_npcs.length ? `Aucun PNJ pour « ${_esc(_mjFilter)} »` : 'Aucun PNJ'}</td></tr>`;
  }
  return list.map(_renderMjStatsRow).join('');
}

function _mjStatsFilter(val) {
  _mjFilter = val || '';
  const tbody = document.querySelector('#mj-stats-table tbody');
  if (tbody) tbody.innerHTML = _renderMjStatsTbody();
}

function _openMjStatsView() {
  if (!STATE.isAdmin) return;
  _mjFilter = '';

  openModal('📊 Stats des PNJ', `
    <input id="mj-stats-search" class="input-field"
      placeholder="🔍 Rechercher par nom ou organisation…"
      data-input="_mjStatsFilter"
      style="font-size:.85rem;padding:.45rem .7rem;margin-bottom:.65rem">
    <div style="overflow-x:auto;margin:0 -.5rem">
      <table id="mj-stats-table" style="width:100%;border-collapse:collapse;font-size:.78rem">
        <thead>
          <tr style="border-bottom:1px solid var(--border);color:var(--text-muted)">
            <th style="text-align:left;padding:.4rem .35rem;font-weight:600">PNJ</th>
            ${NPC_VITALS.map(v =>
              `<th style="text-align:center;padding:.4rem .25rem;font-weight:600;width:42px"
                title="${v.label}">${v.icon}</th>`).join('')}
            ${NPC_STATS.map(s =>
              `<th style="text-align:center;padding:.4rem .2rem;font-weight:700;width:34px;
                font-size:.68rem;letter-spacing:.04em">${s.short}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${_renderMjStatsTbody()}</tbody>
      </table>
    </div>
    <div style="margin-top:.65rem;font-size:.7rem;color:var(--text-dim);font-style:italic;text-align:center">
      Clic sur n'importe quelle valeur pour la modifier (Entrée = valider, Échap = annuler) <br> • Clic sur le nom d'un PNJ pour ouvrir sa fiche
    </div>
  `, { subtitle: 'Édition rapide des caractéristiques', accent: '#4f8cff' });
}

function _restoreMjStatsModal() {
  const search = document.getElementById('mj-stats-search');
  if (search) search.value = _mjFilter;
  const tbody = document.querySelector('#mj-stats-table tbody');
  if (tbody) tbody.innerHTML = _renderMjStatsTbody();
}


function _mjOpenNpc(id) {
  closeModal();
  selectNpc(id);
}

function _mjEditField(id, field) {
  const cell = document.querySelector(`[data-mj-cell="${id}-${field}"]`);
  if (!cell) return;

  const isStat   = field.startsWith('stats.');
  const statKey  = isStat ? field.slice(6) : null;
  const renderInner = isStat ? _mjStatCellInner : _mjVitalCellInner;
  const prevHtml = cell.innerHTML;

  const npc  = _npcs.find(n => n.id === id);
  const prev = isStat ? (npc?.stats || {})[statKey] : npc?.[field];

  const input = document.createElement('input');
  input.type  = 'number';
  input.value = prev ?? '';
  input.style.cssText = 'width:42px;text-align:center;background:var(--bg-elevated);'
    + 'border:1px solid var(--gold);color:var(--text);border-radius:4px;'
    + 'padding:1px 3px;font-size:.85rem;outline:none';
  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();
  input.select();

  const setCellContent = (val) => {
    cell.innerHTML = renderInner(val);
    cell.style.color = val == null ? 'var(--text-dim)' : 'var(--text)';
  };

  let cancelled = false;
  const save = async () => {
    if (cancelled) return;
    cancelled = true;
    const raw = input.value.trim();
    const v   = raw === '' ? null : parseInt(raw, 10);
    const newVal = (raw === '' || !Number.isFinite(v)) ? null : v;
    try {
      await updateInCol('npcs', id, { [field]: newVal });
      const idx = _npcs.findIndex(n => n.id === id);
      if (idx >= 0) {
        if (isStat) {
          _npcs[idx] = {
            ..._npcs[idx],
            stats: { ...(_npcs[idx].stats || {}), [statKey]: newVal },
          };
        } else {
          _npcs[idx] = { ..._npcs[idx], [field]: newVal };
        }
      }
      setCellContent(newVal);
      if (_activeId === id) _refreshActivePanel();
    } catch (e) {
      console.error('[mj edit]', e);
      showNotif('Erreur de sauvegarde.', 'error');
      cell.innerHTML = prevHtml;
    }
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { cancelled = true; cell.innerHTML = prevHtml; input.blur(); }
  });
}

export async function deleteNpc(id) {
  try {
    if (!await confirmModal('Supprimer ce PNJ et toutes ses affinités ?', { title: 'Confirmation de suppression' })) return false;
    await deleteFromCol('npcs', id);
    const toDelete = _affiPerso.filter(a => a.npcId === id);
    await Promise.all(toDelete.map(a => deleteFromCol('npc_affinites', a.id)));
    _npcs      = _npcs.filter(n => n.id !== id);
    _affiPerso = _affiPerso.filter(a => a.npcId !== id);
    if (_activeId === id) _activeId = _npcs[0]?.id || null;
    showNotif('PNJ supprimé.', 'success');
    _renderPage(document.getElementById('main-content'));
    return true;
  } catch (e) { notifySaveError(e); return false; }
}


// ── Modal de configuration des seuils (mode valeur) ──────────────────────────
export function openAffiniteSeuilsModal() {
  if (!STATE.isAdmin) return;
  const s = _affiniteSeuils;
  const rows = SEUILS_KEYS.map((key, i) => {
    const a = AFFINITE[i];
    return `
      <div style="display:flex;align-items:center;gap:.6rem;padding:.4rem .55rem;
        background:${a.bg};border:1px solid ${a.border};border-radius:8px;margin-bottom:.4rem">
        <span style="font-size:1rem">${a.icon}</span>
        <span style="flex:1;font-size:.82rem;font-weight:600;color:${a.couleur}">${a.label}</span>
        <span style="font-size:.7rem;color:var(--text-dim)">à partir de</span>
        <input type="number" id="afs-${key}" class="input-field" value="${s[key] ?? SEUILS_DEFAULT[key]}"
          style="width:90px;text-align:center;font-weight:700">
      </div>`;
  }).join('');

  pushModal('⚙️ Seuils d\'affinité (mode valeur)', `
    <div style="font-size:.74rem;color:var(--text-dim);margin-bottom:.7rem;line-height:1.5">
      Chaque seuil = valeur minimale (incluse) pour atteindre ce niveau.<br>
      Les seuils s'appliquent à tous les PNJ en mode valeur.
    </div>
    ${rows}
    <div style="display:flex;gap:.5rem;margin-top:.85rem">
      <button class="btn btn-gold" style="flex:1" data-action="saveAffiniteSeuils">Enregistrer</button>
      <button class="btn btn-outline btn-sm" data-action="resetAffiniteSeuils">Valeurs par défaut</button>
      <button class="btn btn-outline btn-sm" data-action="close-modal">Annuler</button>
    </div>
  `);
}

export function resetAffiniteSeuils() {
  SEUILS_KEYS.forEach(k => {
    const el = document.getElementById(`afs-${k}`);
    if (el) el.value = SEUILS_DEFAULT[k];
  });
}

export async function saveAffiniteSeuils() {
  if (!STATE.isAdmin) return;
  const next = {};
  for (const k of SEUILS_KEYS) {
    const raw = document.getElementById(`afs-${k}`)?.value;
    const v   = parseInt(raw, 10);
    next[k] = Number.isFinite(v) ? v : SEUILS_DEFAULT[k];
  }
  // Cohérence : ordre croissant strict — sinon le mapping valeur→niveau devient ambigu.
  for (let i = 1; i < SEUILS_KEYS.length; i++) {
    if (next[SEUILS_KEYS[i]] <= next[SEUILS_KEYS[i - 1]]) {
      showNotif('Les seuils doivent être strictement croissants.', 'error');
      return;
    }
  }
  await saveDoc('npc_affinites', AFFINITE_SEUILS_DOC_ID, next);
  _affiniteSeuils = next;
  closeModal();
  showNotif('Seuils enregistrés !', 'success');
  _refreshActivePanel();
  _refreshList();
}

// ══ Gestionnaire des affinités spécifiques ════════════════════════════════════
// Formulaire inline — pas de push modal enfant

function _aftEmojiGrid(selectedEmoji) {
  return EMOJI_PRESET.map(e => `
    <button type="button" data-emoji="${e}" data-action="_aftSelectEmoji" data-val="${e}"
      style="width:34px;height:34px;border-radius:8px;cursor:pointer;font-size:1.15rem;
      transition:all .12s;background:${e === selectedEmoji ? 'rgba(255,255,255,.15)' : 'transparent'};
      border:1px solid ${e === selectedEmoji ? 'var(--gold)' : 'transparent'};
      transform:${e === selectedEmoji ? 'scale(1.15)' : 'scale(1)'}">${e}</button>`
  ).join('');
}

function _aftColorGrid(selectedColor) {
  return TYPE_COLORS.map(hex => `
    <button type="button" data-color="${hex}" data-action="_aftSelectColor" data-val="${hex}"
      style="width:26px;height:26px;border-radius:7px;cursor:pointer;background:${hex};
      transition:all .12s;
      border:3px solid ${hex === selectedColor ? 'white' : 'transparent'};
      box-shadow:${hex === selectedColor ? `0 0 0 2px ${hex}` : 'none'}"></button>`
  ).join('');
}

function _getAffiniteTypesManagerHtml() {
  const s     = _aftFormState || { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
  const isEdit = !!s.editingId;

  const typesList = _affiniteTypes.length
    ? _affiniteTypes.map(t => {
        const col = t.couleur || TYPE_COLORS[0];
        const isEditing = s.editingId === t.id;
        return `
        <div style="display:flex;align-items:center;gap:.55rem;padding:.5rem .7rem;
          background:${isEditing ? col + '22' : col + '11'};
          border:1px solid ${isEditing ? col + '66' : col + '28'};border-radius:9px;
          transition:all .15s">
          <span style="font-size:1.2rem;flex-shrink:0">${t.emoji || '✨'}</span>
          <span style="flex:1;font-size:.85rem;font-weight:700;color:${col}">${_esc(_displayText(t.label))}</span>
          <div style="display:flex;gap:.25rem">
            <button type="button" data-action="_aftEditType" data-id="${t.id}"
              style="background:${isEditing ? col + '33' : 'none'};border:1px solid ${isEditing ? col : 'var(--border)'};
              border-radius:7px;padding:.3rem .5rem;cursor:pointer;
              color:${isEditing ? col : 'var(--text-dim)'};font-size:.72rem">✏️</button>
            <button type="button" data-action="deleteAffiniteType" data-id="${t.id}"
              style="background:none;border:1px solid rgba(255,107,107,.35);border-radius:7px;
              padding:.3rem .5rem;cursor:pointer;color:#ff6b6b;font-size:.72rem">🗑️</button>
          </div>
        </div>`;
      }).join('')
    : `<div style="padding:.75rem;color:var(--text-dim);font-size:.84rem;text-align:center;
        font-style:italic">Aucune affinité spécifique définie.</div>`;

  return `
  <div style="display:flex;flex-direction:column;gap:.85rem">

    <!-- Liste existants -->
    ${_affiniteTypes.length ? `
    <div style="display:flex;flex-direction:column;gap:.35rem;
      max-height:200px;overflow-y:auto;overflow-x:hidden;padding-right:.25rem">
      ${typesList}
    </div>
    <div style="border-top:1px solid var(--border)"></div>` : typesList}

    <!-- Formulaire inline -->
    <div>
      <div style="font-size:.72rem;font-weight:700;color:${isEdit ? 'var(--gold)' : 'var(--text-dim)'};
        text-transform:uppercase;letter-spacing:1px;margin-bottom:.65rem">
        ${isEdit ? `✏️ Modifier — ${_esc(_displayText(_affiniteTypes.find(t => t.id === s.editingId)?.label || ''))}` : '➕ Ajouter un type'}</div>

      <!-- Emoji -->
      <div style="margin-bottom:.55rem">
        <div style="font-size:.64rem;color:var(--text-dim);text-transform:uppercase;
          letter-spacing:.8px;margin-bottom:.3rem">Emoji</div>
          <div id="aft-emoji-grid" style="display:flex;flex-wrap:wrap;gap:.25rem;
            background:var(--bg-card);border:1px solid var(--border);
            border-radius:10px;padding:.5rem;
            max-height:132px;overflow-y:auto;overflow-x:hidden">
            ${_aftEmojiGrid(s.emoji)}
          </div>
        <input type="hidden" id="aft-emoji-val" value="${s.emoji}">
      </div>

      <!-- Nom -->
      <div style="margin-bottom:.55rem">
        <div style="font-size:.64rem;color:var(--text-dim);text-transform:uppercase;
          letter-spacing:.8px;margin-bottom:.3rem">Nom</div>
        <input class="input-field" id="aft-label" value="${_esc(s.label)}"
          placeholder="Ex: Confident, Rival, Chouchou…"
          style="font-size:.85rem">
      </div>

      <!-- Couleur -->
      <div style="margin-bottom:.7rem">
        <div style="font-size:.64rem;color:var(--text-dim);text-transform:uppercase;
          letter-spacing:.8px;margin-bottom:.3rem">Couleur</div>
        <div id="aft-color-grid" style="display:flex;gap:.4rem;flex-wrap:wrap">
          ${_aftColorGrid(s.couleur)}
        </div>
        <input type="hidden" id="aft-color"      value="${s.couleur}">
        <input type="hidden" id="aft-editing-id" value="${s.editingId}">
      </div>

      <!-- Boutons -->
      <div style="display:flex;gap:.4rem">
        <button data-action="saveAffiniteType" class="btn btn-gold"
          style="flex:1;font-size:.8rem">
          ${isEdit ? '💾 Enregistrer' : '➕ Créer'}</button>
        ${isEdit ? `
        <button data-action="_aftCancelEdit"
          class="btn btn-outline btn-sm" style="font-size:.78rem">Annuler</button>` : ''}
      </div>
    </div>
  </div>`;
}

export async function deleteHistoriqueEntry(npcId, index) {
  const n = _npcs.find(x => x.id === npcId);
  if (!n || !STATE.isAdmin) return;

  if (!await confirmModal('Supprimer cet événement de l\'historique ?', {title: 'Confirmation de suppression' })) return;

  const historique = [...(n.affinite?.historique || [])];
  const removed = historique[index];
  historique.splice(index, 1);

  // En mode valeur, on annule l'impact du delta supprimé sur la valeur cumulée.
  const affinite = _withValeurDelta(n, { ...(n.affinite || {}), historique }, -(removed?.delta || 0));
  await _persistAffinite(npcId, affinite, 'Événement supprimé.', { close: false });
}

// Modifier / Supprimer les entrées des historiques des NPCS
export function editHistoriqueEntry(npcId, index) {
  const n = _npcs.find(x => x.id === npcId);
  if (!n || !STATE.isAdmin) return;

  const historique = n.affinite?.historique || [];
  const entry = historique[index];
  if (!entry) return;

  openModal(`✏️ Modifier l'événement — ${_esc(n.nom)}`, `
    <div class="form-group">
      <label>Texte</label>
      <textarea class="input-field" id="hist-edit-text" rows="3"
        placeholder="Décris l’événement...">${_esc(entry.texte || '')}</textarea>
    </div>

    <div class="form-group">
      <label>Impact</label>
      <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
        <div style="display:flex;gap:.35rem">
          ${_deltaPresetsHtml('hist-edit-delta', entry.delta || 0, '_selectHistEditDelta', { size: 36 })}
        </div>
        <input type="number" id="hist-edit-delta-custom"
          value="${_DELTA_PRESETS.includes(entry.delta || 0) ? '' : (entry.delta || 0)}"
          placeholder="±N"
          data-input="_setHistEditDeltaFromInput"
          style="width:64px;text-align:center;font-weight:700;padding:.4rem;
          background:var(--bg-elevated);border:1px solid var(--border);
          border-radius:8px;color:var(--text);font-size:.8rem">
      </div>
    </div>

    <div style="display:flex;gap:.5rem;margin-top:.75rem">
      <button class="btn btn-gold" style="flex:1"
        data-action="saveHistoriqueEntry" data-npc-id="${npcId}" data-idx="${index}">Enregistrer</button>
      <button class="btn btn-outline btn-sm" data-action="close-modal">Annuler</button>
    </div>
  `);

  _histEditDelta = entry.delta || 0;
}

function _selectHistEditDelta(v) {
  _histEditDelta = v;
  _highlightDeltaPreset('hist-edit-delta', v);
  const inp = document.getElementById('hist-edit-delta-custom');
  if (inp) inp.value = '';
}

function _setHistEditDeltaFromInput(raw) {
  const v = parseInt(raw, 10);
  _histEditDelta = Number.isFinite(v) ? v : 0;
  _highlightDeltaPreset('hist-edit-delta', _histEditDelta);
}

export async function saveHistoriqueEntry(npcId, index) {
  const n = _npcs.find(x => x.id === npcId);
  if (!n || !STATE.isAdmin) return;

  const texte = document.getElementById('hist-edit-text')?.value?.trim() || '';
  if (!texte) {
    showNotif('Le texte de l’événement est requis.', 'error');
    return;
  }

  const historique = [...(n.affinite?.historique || [])];
  if (!historique[index]) return;

  const oldDelta = historique[index].delta || 0;
  const newDelta = _histEditDelta || 0;

  historique[index] = {
    ...historique[index],
    texte,
    delta: newDelta,
  };

  // En mode valeur, on rejoue la différence de delta sur la valeur cumulée.
  const affinite = _withValeurDelta(n, { ...(n.affinite || {}), historique }, newDelta - oldDelta);
  await _persistAffinite(npcId, affinite, 'Événement modifié.');
}

// Affinités spéciales
export function openAffiniteTypesManager() {
  // Initialise le formulaire à l'état "ajout"
  _aftFormState = { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
  pushModal('🎭 Affinités spécifiques', _getAffiniteTypesManagerHtml(), () => {
    // À la fermeture, rafraîchir la fiche (les types/affinités ont pu changer).
    if (_activeId) _refreshActivePanel();
  });
}

function _refreshAffiniteTypesManager() {
  updateModalContent('🎭 Affinités spécifiques', _getAffiniteTypesManagerHtml());
}

function _aftSelectEmoji(emoji) {
  const inp = document.getElementById('aft-emoji-val');
  if (inp) inp.value = emoji;
  if (_aftFormState) _aftFormState.emoji = emoji;
  document.querySelectorAll('#aft-emoji-grid button').forEach(btn => {
    const sel = btn.dataset.emoji === emoji;
    btn.style.background  = sel ? 'rgba(255,255,255,.15)' : 'transparent';
    btn.style.borderColor = sel ? 'var(--gold)' : 'transparent';
    btn.style.transform   = sel ? 'scale(1.15)' : 'scale(1)';
  });
}

function _aftSelectColor(hex) {
  const inp = document.getElementById('aft-color');
  if (inp) inp.value = hex;
  if (_aftFormState) _aftFormState.couleur = hex;
  document.querySelectorAll('#aft-color-grid button').forEach(btn => {
    const sel = btn.dataset.color === hex;
    btn.style.borderColor = sel ? 'white' : 'transparent';
    btn.style.boxShadow   = sel ? `0 0 0 2px ${hex}` : 'none';
  });
}

function _aftEditType(typeId) {
  const t = _affiniteTypes.find(x => x.id === typeId);
  if (!t) return;
  _aftFormState = {
    editingId: typeId,
    emoji:     t.emoji   || EMOJI_PRESET[0],
    couleur:   t.couleur || TYPE_COLORS[0],
    label:     t.label   || '',
  };
  _refreshAffiniteTypesManager();
}

function _aftCancelEdit() {
  _aftFormState = { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
  _refreshAffiniteTypesManager();
}

export async function saveAffiniteType() {
  const label     = document.getElementById('aft-label')?.value?.trim();
  const emoji     = document.getElementById('aft-emoji-val')?.value || EMOJI_PRESET[0];
  const couleur   = document.getElementById('aft-color')?.value     || TYPE_COLORS[0];
  const editingId = document.getElementById('aft-editing-id')?.value || '';

  if (!label) { showNotif('Donne un nom au type.', 'error'); return; }

  if (editingId) {
    const idx = _affiniteTypes.findIndex(t => t.id === editingId);
    if (idx >= 0) _affiniteTypes[idx] = { ..._affiniteTypes[idx], label, emoji, couleur };
  } else {
    const id = `aft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    _affiniteTypes.push({ id, label, emoji, couleur });
    _affiniteTypes.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
  }

  await saveDoc('npc_affinites', AFFINITE_TYPES_DOC_ID, { types: _affiniteTypes });
  _aftFormState = { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
  showNotif(editingId ? 'Type modifié !' : 'Type créé !', 'success');
  _refreshAffiniteTypesManager();
}

export async function deleteAffiniteType(typeId) {
  if (!await confirmModal('Supprimer ce type d\'affinité ?', {title: 'Confirmation de suppression'})) return;
  _affiniteTypes = _affiniteTypes.filter(t => t.id !== typeId);
  await saveDoc('npc_affinites', AFFINITE_TYPES_DOC_ID, { types: _affiniteTypes });
  if (_aftFormState?.editingId === typeId) {
    _aftFormState = { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
  }
  showNotif('Type supprimé.', 'success');
  _refreshAffiniteTypesManager();
}

// ══ Modal affinité individuelle (édition) ════════════════════════════════════




// ── Édition inline depuis la fiche (admin) ───────────────────────────────────
// Sauvegarde directe Firestore champ par champ (déclenchée par l'event `change`,
// càd au blur / Entrée). Gère les champs simples, numériques, stats imbriquées.
async function _npcInlineSave(el) {
  if (!STATE.isAdmin || !el) return;
  const id = el.dataset.npcId, field = el.dataset.field;
  const n = _npcs.find(x => x.id === id);
  if (!n || !field) return;

  const NUM_FIELDS = ['pv', 'pm', 'ca', 'vitesse', 'salaireSuggere'];
  const toNum = (raw) => {
    const t = (raw ?? '').toString().trim();
    if (t === '') return null;
    const v = parseInt(t, 10);
    return Number.isFinite(v) ? v : null;
  };

  let patch;
  if (field.startsWith('stat:')) {
    const key = field.slice(5);
    const stats = { ...(n.stats || {}) };
    const v = toNum(el.value);
    if (v == null) delete stats[key]; else stats[key] = v;
    n.stats = stats; patch = { stats };
  } else if (field === 'affinite.note') {
    const affinite = { ...(n.affinite || {}), note: (el.value || '').trim() };
    n.affinite = affinite; patch = { affinite };
  } else if (NUM_FIELDS.includes(field)) {
    const v = toNum(el.value);
    n[field] = v; patch = { [field]: v };
  } else {
    const v = (el.value || '').trim();
    n[field] = v; patch = { [field]: v };
  }

  await trySave('npcs', id, patch);
}

// Clic sur le portrait → choisir une image, compresser, enregistrer (base64).
// Portrait PNJ : on passe par le cropper pan/zoom (comme les persos) pour
// pouvoir cadrer l'image au lieu de la stocker brute.
let _npcPhotoCrop = null;
let _npcPhotoSrc = null; // image originale (avant cadrage) → stockée en imageFull
function _npcSetPhoto(btn) {
  if (!STATE.isAdmin) return;
  const id = btn.dataset.id;
  pickImageFile({ onImage: ({ dataUrl }) => _npcShowCropModal(dataUrl, id) });
}

function _npcShowCropModal(dataUrl, id) {
  _npcPhotoSrc = dataUrl;
  openModal('📷 Cadrer le portrait', `
    ${panZoomCropHTML({ idPrefix: 'npc-crop', viewSize: 300 })}
    <div style="display:flex;gap:.6rem;justify-content:flex-end;width:300px;margin:.8rem auto 0">
      <button class="btn btn-outline" id="npc-photo-cancel">Annuler</button>
      <button class="btn btn-gold" id="npc-photo-save">✅ Enregistrer</button>
    </div>`);
  requestAnimationFrame(() => {
    _npcPhotoCrop?.destroy?.();
    _npcPhotoCrop = attachPanZoomCrop({ idPrefix: 'npc-crop', dataUrl, viewSize: 300, outputSize: 300 });
    document.getElementById('npc-photo-cancel')?.addEventListener('click', () => {
      _npcPhotoCrop?.destroy?.(); _npcPhotoCrop = null; closeModal();
    }, { once: true });
    document.getElementById('npc-photo-save')?.addEventListener('click', () => _npcSaveCroppedPhoto(id));
  });
}

async function _npcSaveCroppedPhoto(id) {
  const dataUrl = _npcPhotoCrop?.getBase64();
  if (!dataUrl) { showNotif('Erreur : cadrage non initialisé.', 'error'); return; }
  // Image pleine (non cadrée) bornée → visible par les joueurs via le portrait.
  const imageFull = _npcPhotoSrc ? await compressDataUrl(_npcPhotoSrc, { max: 1280, quality: 0.8 }) : '';
  const n = _npcs.find(x => x.id === id); if (n) { n.imageUrl = dataUrl; n.imageFull = imageFull; }
  if (await trySave('npcs', id, { imageUrl: dataUrl, imageFull })) {
    _npcPhotoCrop?.destroy?.(); _npcPhotoCrop = null; _npcPhotoSrc = null;
    closeModal();
    showNotif('Portrait enregistré !', 'success');
    _refreshActivePanel(); _refreshList();
  }
}

// Lightbox : affiche l'image pleine (non cadrée) du PNJ — accessible à TOUS
// (joueurs compris). Fallback sur le portrait cadré pour les anciens PNJ sans
// imageFull. Clic n'importe où ou Échap pour fermer.
function _npcViewPhoto(btn) {
  const n = _npcs.find(x => x.id === btn.dataset.id); if (!n) return;
  const src = n.imageFull || n.imageUrl; if (!src) return;
  document.getElementById('npc-img-lightbox')?.remove();
  const ov = document.createElement('div');
  ov.id = 'npc-img-lightbox';
  ov.className = 'npc-img-lightbox';
  ov.innerHTML = `<img src="${src}" alt="${_esc(n.nom || '')}"><button class="npc-img-lightbox-close" title="Fermer (Échap)">✕</button>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
}

// Organisations en texte libre séparé par des virgules → tableau.
async function _npcSaveOrgs(el) {
  if (!STATE.isAdmin) return;
  const n = _npcs.find(x => x.id === el.dataset.npcId); if (!n) return;
  const orgs = (el.value || '').split(',').map(s => s.trim()).filter(Boolean);
  n.organisations = orgs;
  await trySave('npcs', el.dataset.npcId, { organisations: orgs });
}

// Toggle d'une activité bastion (pastille cliquable).
async function _npcToggleActivite(btn) {
  if (!STATE.isAdmin) return;
  const id = btn.dataset.id, slug = btn.dataset.slug;
  const n = _npcs.find(x => x.id === id); if (!n) return;
  const set = new Set(n.activites || []);
  set.has(slug) ? set.delete(slug) : set.add(slug);
  const activites = [...set];
  n.activites = activites;
  btn.classList.toggle('is-on');
  await trySave('npcs', id, { activites });
}

// Toggle visibilité joueurs du profil bastion.
async function _npcToggleEmbauchable(btn) {
  if (!STATE.isAdmin) return;
  const id = btn.dataset.id;
  const n = _npcs.find(x => x.id === id); if (!n) return;
  const current = n.embauchable !== false;   // défaut = visible (true)
  n.embauchable = !current;
  await trySave('npcs', id, { embauchable: n.embauchable });
  _refreshActivePanel();
}

// Sélection d'arme (boutique) en inline.
async function _npcSetWeapon(el) {
  if (!STATE.isAdmin) return;
  const id = el.dataset.npcId;
  const n = _npcs.find(x => x.id === id); if (!n) return;
  const w = el.value ? _shopWeapons.find(x => x.id === el.value) : null;
  const weapon = w ? _serializeShopWeapon(w) : null;
  const combat = weapon ? { weapon, weaponName: weapon.nom || '', damage: weapon.degats || '', range: null } : null;
  n.combat = combat;
  await trySave('npcs', id, { combat });
  _refreshActivePanel();
}

// Ajout d'un événement d'affinité directement depuis la fiche (sans modal).
// Réplique la logique de l'ancien saveAffiniteGroupe : cumul en mode 'valeur',
// niveau dérivé des seuils, entrée datée dans l'historique.
async function _npcAddEvent(btn) {
  if (!STATE.isAdmin) return;
  const id = btn.dataset.id;
  const n = _npcs.find(x => x.id === id); if (!n) return;
  const dEl = document.getElementById(`afg-d-${id}`);
  const eEl = document.getElementById(`afg-e-${id}`);
  const delta = parseInt(dEl?.value, 10) || 0;
  const texte = (eEl?.value || '').trim();
  if (delta === 0 && !texte) { showNotif('Indique une variation et/ou un intitulé.', 'error'); return; }
  if (delta !== 0 && !texte) { showNotif('Ajoute un intitulé pour conserver la variation.', 'error'); return; }

  const curHisto = n.affinite?.historique || [];
  const newHisto = [...curHisto, { date: new Date().toLocaleDateString('fr-FR'), texte, delta }];
  let affinite;
  if (delta !== 0 || _affiniteMode(n) === 'valeur') {
    const valeur = (Number(n.affinite?.valeur) || 0) + delta;
    affinite = { ...(n.affinite || {}), mode: 'valeur', valeur, niveau: _niveauFromValeur(valeur), historique: newHisto };
  } else {
    affinite = { ...(n.affinite || {}), historique: newHisto };
  }
  n.affinite = affinite;
  await _persistAffinite(id, affinite, 'Événement ajouté !', { close: false });
}

// Édition inline d'une affinité spécifique existante (type / notes).
async function _npcAffiField(el) {
  if (!STATE.isAdmin) return;
  const a = _affiPerso.find(x => x.id === el.dataset.affId); if (!a) return;
  const field = el.dataset.field;
  const patch = {};
  if (field === 'typeId') {
    const type = _getAffiniteType(el.value);
    patch.typeId = el.value; patch.typeLabel = type?.label || '';
  } else {
    patch[field] = (el.value || '').trim();
  }
  Object.assign(a, patch);
  await trySave('npc_affinites', a.id, patch);
}

// Ajout inline d'une affinité spécifique (personnage + type) — sans modal.
async function _npcAddAffiPerso(btn) {
  if (!STATE.isAdmin) return;
  const npcId = btn.dataset.npcId;
  const charSel = document.getElementById(`afp-char-${npcId}`)?.value;
  const typeId  = document.getElementById(`afp-type-${npcId}`)?.value;
  if (!charSel) { showNotif('Choisis un personnage.', 'error'); return; }
  if (!typeId)  { showNotif('Choisis un type d\'affinité.', 'error'); return; }
  const [charId, charNom] = charSel.split('|');
  const char = (STATE.characters || []).find(c => c.id === charId);
  const type = _getAffiniteType(typeId);
  const data = {
    npcId,
    charId,
    charNom,
    charPhoto: _charPortraitSrc(char),
    typeId,
    typeLabel: type?.label || '',
    note: '',
    notePublique: '',
  };
  try {
    const newId = await addToCol('npc_affinites', data);
    const entry = { id: newId || `afp_${Date.now()}`, ...data };
    if (!_affiPerso.find(x => x.id === entry.id)) _affiPerso.push(entry);
    _refreshActivePanel();
  } catch (e) { notifySaveError(e); }
}

// ── Sélecteur de personnage avec portraits (pour l'ajout d'affinité) ─────────
const _profilePortraitSrc = (p = {}) => p.portraitUrl || p.photo || p.avatar || p.avatarUrl || '';
const _playerProfileForChar = (charId = '', charNom = '') => {
  const byId = charId ? _playerProfiles.find(p =>
    p.charId === charId || p.characterId === charId || p.persoId === charId || p.linkedCharId === charId
  ) : null;
  if (byId) return byId;
  const targetName = _norm(charNom || '');
  return targetName ? _playerProfiles.find(p => _norm(p.nom || p.name || '') === targetName) || null : null;
};
const _charPortraitSrc = (c = {}, profile = null) =>
  c.photo || c.portraitUrl || c.avatar || c.avatarUrl || _profilePortraitSrc(profile) || '';
const _relationCharacterFor = (a = {}) => {
  const chars = [...(STATE.characters || []), ..._relationCharacters];
  const byId = a.charId ? chars.find(x => x.id === a.charId) : null;
  if (byId) return byId;
  const targetName = _norm(a.charNom || '');
  return targetName ? chars.find(x => _norm(x.nom || x.name || '') === targetName) || null : null;
};
const _charAvatar = (c) => _charPortraitSrc(c)
  ? `<img class="npc-charpick-av" src="${_esc(_charPortraitSrc(c))}" alt="">`
  : `<span class="npc-charpick-av npc-charpick-av--ph">${_esc((c.nom || '?')[0].toUpperCase())}</span>`;

const _storedRelationPortraitSrc = (a = {}, profile = null) => {
  const stored = a.charPhoto || a.photo || a.portraitUrl || a.avatar || a.avatarUrl || '';
  if (!stored) return '';
  return stored === profile?.imageUrl ? '' : stored;
};

const _profileCroppedAvatar = (profile = {}) => {
  const src = profile.imageUrl || '';
  if (!src) return '';
  const cc = profile.cardCrop;
  const imgStyle = cc
    ? `position:absolute;left:${(cc.offX * 100).toFixed(2)}%;top:${(cc.offY * 100).toFixed(2)}%;width:${(cc.imgW * 100).toFixed(2)}%;height:auto;max-width:none`
    : 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center top';
  return `<span class="npc-rel-av npc-rel-av--crop"><img src="${_esc(src)}" alt="" loading="lazy" decoding="async" style="${imgStyle}"></span>`;
};

// Avatar du personnage cible d'une affinité spécifique (retrouvé via charId).
const _affiTargetAvatar = (a) => {
  const c = _relationCharacterFor(a);
  const profile = _playerProfileForChar(a.charId, a.charNom);
  const src = _charPortraitSrc(c, profile) || _storedRelationPortraitSrc(a, profile);
  return src
    ? `<img class="npc-rel-av" src="${_esc(src)}" alt="" loading="lazy" decoding="async">`
    : _profileCroppedAvatar(profile) || `<span class="npc-rel-av npc-rel-av--ph">${_esc((a.charNom || '?')[0].toUpperCase())}</span>`;
};

function _npcCharPickToggle(btn) {
  const pick = btn.closest('.npc-charpick'); if (!pick) return;
  const willOpen = !pick.classList.contains('is-open');
  document.querySelectorAll('.npc-charpick.is-open').forEach(p => p.classList.remove('is-open'));
  if (willOpen) pick.classList.add('is-open');
}

function _npcCharPickSelect(btn) {
  const npcId = btn.dataset.npcId;
  const pick = btn.closest('.npc-charpick'); if (!pick) return;
  const hidden = document.getElementById(`afp-char-${npcId}`);
  if (hidden) hidden.value = `${btn.dataset.charId}|${btn.dataset.charNom}`;
  const cur = pick.querySelector('.npc-charpick-current');
  if (cur) {
    const av = btn.querySelector('.npc-charpick-av')?.outerHTML || '';
    cur.innerHTML = `${av}<span class="npc-charpick-selname">${_esc(btn.dataset.charNom || '?')}</span>`;
  }
  pick.classList.remove('is-open');
}

// Ferme les sélecteurs ouverts sur clic extérieur (lié une seule fois).
let _charPickBound = false;
function _bindCharPickOutside() {
  if (_charPickBound) return;
  _charPickBound = true;
  document.addEventListener('click', (e) => {
    if (e.target.closest('.npc-charpick')) return;
    document.querySelectorAll('.npc-charpick.is-open').forEach(p => p.classList.remove('is-open'));
  });
}

// Création inline : crée un PNJ vierge et le sélectionne (plus besoin de modal).
async function _npcCreate() {
  if (!STATE.isAdmin) return;
  try {
    const data = { nom: 'Nouveau PNJ', role: '', lieu: '', organisations: [], description: '', imageUrl: '', embauchable: true, activites: [] };
    const newId = await addToCol('npcs', data);
    const entry = { id: newId || `npc_${Date.now()}`, ...data };
    if (!_npcs.find(n => n.id === entry.id)) _npcs.push(entry);
    _activeId = entry.id;
    _renderPage(document.getElementById('main-content'));
    showNotif('PNJ créé — modifie-le directement dans la fiche.', 'success');
  } catch (e) { notifySaveError(e); }
}

function _refreshActivePanel() {
  const panel = document.getElementById('npc-detail-panel');
  if (!panel) return;

  // Ne pas casser une édition inline en cours : le watch temps réel se déclenche
  // sur nos propres écritures. Si un champ inline du panneau a le focus, on diffère
  // le re-render (il se fera au prochain refresh une fois l'édition terminée).
  const ae = document.activeElement;
  if (ae && panel.contains(ae) && ae.classList?.contains('npc-inline')) return;

  const filtered = _getFiltered();
  const active = _npcs.find(x => x.id === _activeId) || filtered[0] || null;

  if (!_npcs.find(x => x.id === _activeId)) {
    _activeId = active?.id || null;
  }

  panel.innerHTML = active ? _renderFiche(active) : _renderEmpty();
}



export async function deleteAffinitePerso(id) {
  if (!await confirmDelete('npc_affinites', id, 'Supprimer cette affinité ?', { title: 'Confirmation de suppression' })) return;
  _affiPerso = _affiPerso.filter(a => a.id !== id);
  showNotif('Affinité supprimée.', 'success');
  _refreshActivePanel();
}

// ── Override PAGES.npcs ───────────────────────────────────────────────────────
PAGES.npcs = renderNpcs;


registerActions({
  _npcSearch:                (el) => _npcSearch(el.value),
  npcInlineSave:             (el) => _npcInlineSave(el),
  npcSaveOrgs:               (el) => _npcSaveOrgs(el),
  npcSetWeapon:              (el) => _npcSetWeapon(el),
  npcEquipSlot:              (el) => _npcEquipSlot(el),
  npcOpenEquipPicker:        (btn) => _npcOpenEquipPicker(btn),
  npcEquipPickerSearch:      (el) => _npcEquipPickerSearch(el),
  npcPickEquipItem:          (btn) => _npcPickEquipItem(btn),
  npcClearEquipSlot:         (btn) => _npcClearEquipSlot(btn),
  npcSetPhoto:               (btn) => _npcSetPhoto(btn),
  npcViewPhoto:              (btn) => _npcViewPhoto(btn),
  npcSetStatut:              (btn) => _npcSetStatut(btn),
  npcSetListView:            (btn) => _npcSetListView(btn),
  npcSetStatusFilter:        (btn) => _npcSetStatusFilter(btn),
  npcToggleHiddenFilter:     ()    => _npcToggleHiddenFilter(),
  npcEditOrgIcon:            (btn) => _npcEditOrgIcon(btn),
  npcPickOrgIcon:            (btn) => _npcPickOrgIcon(btn),
  npcResetOrgIcon:           (btn) => _npcResetOrgIcon(btn),
  npcApplyOrgIconInput:      (btn) => _npcApplyOrgIconInput(btn),
  npcToggleActivite:         (btn) => _npcToggleActivite(btn),
  npcToggleEmbauchable:      (btn) => _npcToggleEmbauchable(btn),
  npcAddEvent:               (btn) => _npcAddEvent(btn),
  npcAffiField:              (el) => _npcAffiField(el),
  npcAddAffiPerso:           (btn) => _npcAddAffiPerso(btn),
  npcCharPickToggle:         (btn) => _npcCharPickToggle(btn),
  npcCharPickSelect:         (btn) => _npcCharPickSelect(btn),
  npcCreate:                 () => _npcCreate(),
  _mjStatsFilter:            (el) => _mjStatsFilter(el.value),
  _setHistEditDeltaFromInput:(el) => _setHistEditDeltaFromInput(el.value),
  deleteNpc:               (btn) => deleteNpc(btn.dataset.id),
  _deleteNpcThenClose:     (btn) => deleteNpc(btn.dataset.id).then(ok => { if (ok) closeModal(); }),
  selectNpc:               (btn) => selectNpc(btn.dataset.id),
  deleteAffinitePerso:     (btn) => deleteAffinitePerso(btn.dataset.id),
  openAffiniteTypesManager:()   => openAffiniteTypesManager(),
  saveAffiniteSeuils:      ()   => saveAffiniteSeuils(),
  resetAffiniteSeuils:     ()   => resetAffiniteSeuils(),
  openAffiniteSeuilsModal: ()   => openAffiniteSeuilsModal(),
  editHistoriqueEntry:     (btn) => editHistoriqueEntry(btn.dataset.npcId, Number(btn.dataset.idx)),
  deleteHistoriqueEntry:   (btn) => deleteHistoriqueEntry(btn.dataset.npcId, Number(btn.dataset.idx)),
  saveHistoriqueEntry:     (btn) => saveHistoriqueEntry(btn.dataset.npcId, Number(btn.dataset.idx)),
  deleteAffiniteType:      (btn) => deleteAffiniteType(btn.dataset.id),
  saveAffiniteType:        ()   => saveAffiniteType(),
  _aftCancelEdit:          ()   => _aftCancelEdit(),
  _aftEditType:            (btn) => _aftEditType(btn.dataset.id),
  _aftSelectEmoji:         (btn) => _aftSelectEmoji(btn.dataset.val),
  _aftSelectColor:         (btn) => _aftSelectColor(btn.dataset.val),
  _selectHistEditDelta:    (btn) => _selectHistEditDelta(Number(btn.dataset.val)),
  _openMjStatsView:        ()   => _openMjStatsView(),
  _npcSelectOrg:           (btn) => _npcSelectOrg(btn),
  _npcBackToOrgs:          ()   => _npcBackToOrgs(),
  _mjEditField:            (btn) => _mjEditField(btn.dataset.npcId, btn.dataset.field),
  _mjOpenNpc:              (btn) => _mjOpenNpc(btn.dataset.id),
});
