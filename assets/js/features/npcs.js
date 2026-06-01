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
import { watch } from '../shared/realtime.js';
import { openModal, closeModal, pushModal, updateModalContent, confirmModal } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import PAGES from './pages.js';
import { _esc, _norm, _searchIncludes } from '../shared/html.js';
import { getItemStatBonus, sortCharactersForDisplay } from '../shared/char-stats.js';
import { _getTraits } from './characters/data.js';
import { listPlaces } from './map/data/places.repo.js';
import { listOrganizations } from './map/data/organizations.repo.js';
import { getModFromScore } from '../shared/char-stats.js';
import { pickImageFile, uploadJpeg } from '../shared/image-upload.js';

// ── Stats PNJ (admin) ────────────────────────────────────────────────────────
// Schéma volontairement simple pour les PNJ : pas de formule équipement comme
// pour les persos joueurs — chaque vitale est saisie directement.
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
let _shopWeapons   = [];   // armes issues de la boutique pour l'espace combat PNJ
let _activeId      = null;
let _filterSearch  = '';
let _activeOrgFilter = null;
let _histEditDelta = 0;
let _aftFormState = { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
let _selectedAfpTypeId = '';
let _currentAffinitePersoContext = {};

// ── Chargement ────────────────────────────────────────────────────────────────
// `npcs` et `shop` sont session-live → 0 lecture facturée. `npc_affinites` est
// piloté entièrement par le watch plus bas (collection unique avec docs spéciaux
// types/seuils + relations PJ↔PNJ). `places` et `organizations` restent un fetch
// page-scoped (1 lecture initiale, servi du cache IndexedDB sur cache chaud).
async function _load() {
  const [npcs, places, orgs, shopItems] = await Promise.all([
    loadCollection('npcs'),
    listPlaces().catch(() => []),
    listOrganizations().catch(() => []),
    loadCollection('shop').catch(() => []),
  ]);
  _npcs           = npcs || [];
  _places        = (places || []).filter(p => p?.name).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  _organisations = (orgs   || []).filter(o => o?.name).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  _shopWeapons   = (shopItems || []).filter(_isShopWeapon).sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr'));
}

// ── Helpers types ─────────────────────────────────────────────────────────────
const _getAffiniteType      = (id) => _affiniteTypes.find(t => t.id === id) || null;
const _getAffiniteTypeLabel = (id, fb = '') => _getAffiniteType(id)?.label   || fb || '';
const _getAffiniteTypeColor = (id) => _getAffiniteType(id)?.couleur || TYPE_COLORS[0];
const _getAffiniteTypeEmoji = (id) => _getAffiniteType(id)?.emoji   || '✨';
// Vue résumée pour les chips d'affinité spécifique (label déjà échappé).
const _typeView = (a) => ({
  emoji: _getAffiniteTypeEmoji(a.typeId),
  color: _getAffiniteTypeColor(a.typeId),
  label: _esc(_getAffiniteTypeLabel(a.typeId, a.typeLabel)) || '—',
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
  await updateInCol('npcs', npcId, { affinite });
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
  content.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-dim)">
    <div style="font-size:1.5rem">⏳</div><p>Chargement…</p></div>`;

  await _load();
  if (!_activeId && _npcs.length) _activeId = _npcs[0].id;
  _renderPage(content);

  // ── Abonnements temps réel ─────────────────────────────────────────────
  // Pour `npcs` (session-live) le watch ne refait aucune lecture facturée.
  // Pour `npc_affinites` (page-scoped), le watch sert aussi de fetch initial
  // → pas de double-read.
  watch('npcs-list', 'npcs', data => {
    if (STATE.currentPage !== 'npcs') return;
    _npcs = data || [];
    _refreshList({ keepScroll: true });
    _refreshActivePanel();
  });

  // Une seule subscription pour la collection npc_affinites : on y range
  // les relations PNJ↔joueur + les 2 docs spéciaux (types, seuils).
  watch('npcs-affi', 'npc_affinites', data => {
    if (STATE.currentPage !== 'npcs') return;
    const arr = data || [];
    _affiPerso = arr.filter(a => a.id !== AFFINITE_TYPES_DOC_ID && a.id !== AFFINITE_SEUILS_DOC_ID);
    const typesDoc  = arr.find(a => a.id === AFFINITE_TYPES_DOC_ID);
    const seuilsDoc = arr.find(a => a.id === AFFINITE_SEUILS_DOC_ID);
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

// ── Nav item ──────────────────────────────────────────────────────────────────
function _renderNavItem(n) {
  const isActive = n.id === _activeId;
  const niv      = _affiniteNiveau(n);
  const af       = afx(niv);
  return `
  <div class="npc-nav-item ${isActive ? 'is-active' : ''}" style="${_afVars(af)}"
    data-action="selectNpc" data-id="${n.id}" data-npc-id="${n.id}">

    <div class="npc-nav-avatar">
      ${n.imageUrl
        ? `<img src="${n.imageUrl}" alt="">`
        : `<span>${(n.nom || '?')[0].toUpperCase()}</span>`}
    </div>

    <div class="npc-nav-body">
      <div class="npc-nav-name">${_esc(n.nom || '?')}</div>
      <div class="npc-nav-affi">
        <div class="npc-nav-dots">
          ${AFFINITE.map((a, i) => `<div class="npc-nav-dot" ${i <= niv ? `style="background:${a.couleur}"` : ''}></div>`).join('')}
        </div>
        <span class="npc-nav-affi-lbl">${af.label}</span>
      </div>
    </div>

  </div>`;
}

// ══ Fiche PNJ — composants ════════════════════════════════════════════════════

// Portrait + identité (portrait reconnaissable, pas de bannière dans le corps)
function _renderFicheHeader(n) {
  const af  = afx(_affiniteNiveau(n));
  const adm = STATE.isAdmin;
  const initial = (n.nom || '?')[0].toUpperCase();
  const portInner = n.imageUrl ? `<img src="${n.imageUrl}" alt="">` : `<span>${initial}</span>`;

  const portrait = adm
    ? `<button class="npc-hero-portrait npc-portrait-btn ${n.imageUrl ? '' : 'is-empty'}"
         data-action="npcSetPhoto" data-id="${n.id}" title="Cliquer pour changer le portrait">
         ${portInner}<span class="npc-portrait-cam">📷</span></button>`
    : (n.imageUrl
        ? `<img class="npc-hero-portrait" src="${n.imageUrl}" alt="">`
        : `<div class="npc-hero-portrait npc-hero-portrait--ph">${initial}</div>`);

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
    </div>
    ${adm ? `
    <div class="npc-hero-actions">
      <button class="npc-mini-btn npc-mini-btn--danger" data-action="deleteNpc" data-id="${n.id}" title="Supprimer ce PNJ">🗑️ Supprimer</button>
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
  const embauchable = n.embauchable !== false;

  // ── Vue MJ : tout éditable inline ──
  if (adm) {
    return `
    <div class="npc-card">
      <div class="npc-card-hd">
        <div class="npc-card-title">🏰 Recrutable au Bastion${mjBadge}</div>
        <button class="npc-card-act ${embauchable ? '' : 'npc-card-act--off'}" data-action="npcToggleEmbauchable" data-id="${n.id}"
          title="Visibilité côté joueurs">${embauchable ? '👁️ Visible joueurs' : '🚫 Caché joueurs'}</button>
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
  const { emoji, color, label } = _typeView(a);
  const vars = `--rc:${color};--rc-bg:${color}12;--rc-bd:${color}30`;
  return `
  <div class="npc-rel-chip" style="${vars}">
    <span class="npc-rel-emoji">${emoji}</span>
    <div class="npc-rel-body">
      <div class="npc-rel-label">${label}</div>
      <div class="npc-rel-target">→ ${_esc(a.charNom || '?')}</div>
      ${a.notePublique ? `<div class="npc-rel-note">🌐 ${_esc(a.notePublique)}</div>` : ''}
      ${a.note ? `<div class="npc-rel-note">🔒 ${_esc(a.note)}</div>` : ''}
    </div>
    <div class="npc-rel-actions">
      <button class="npc-icon-btn" data-action="openAffinitePersoModal" data-npc-id="${npcId}" data-aff-id="${a.id}">✏️</button>
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
      <div class="npc-rel-label">${label}</div>
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
      <div class="npc-rel-label">${label} <span style="color:var(--text-dim);font-weight:400">→ ${_esc(a.charNom || '?')}</span></div>
      ${(a.notePublique || '').trim() ? `<div class="npc-rel-note">🌐 ${_esc(a.notePublique)}</div>` : ''}
    </div>
  </div>`;
}

// Panneau des relations (colonne droite)
function _renderRelationsPanel(n) {
  const persoList = _affiPerso.filter(a => a.npcId === n.id);
  const myChars   = sortCharactersForDisplay((STATE.characters || []).filter(c => c.uid === STATE.user?.uid));
  const myAffi    = persoList.filter(a => myChars.some(c => c.id === a.charId));

  if (STATE.isAdmin) {
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
      <button class="npc-rel-add" style="margin-top:.5rem" data-action="openAffinitePersoModal" data-npc-id="${n.id}">
        ➕ Ajouter une affinité
      </button>
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
function _renderFiche(n) {
  const desc = STATE.isAdmin
    ? `<div class="npc-edit-block">
        <span class="npc-edit-lbl">Description</span>
        <textarea class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="description"
          rows="3" placeholder="Apparence, personnalité, secrets…">${_esc(n.description || '')}</textarea>
      </div>`
    : (n.description ? `<div class="npc-desc">${_esc(n.description)}</div>` : '');
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
      ${desc}
      ${body}
    </div>
  </div>`;
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
  return _npcs.filter(n => _npcMatchesSearch(n, _filterSearch));
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
  return groups;
}

function _orgLabel(orgName) {
  return orgName === NO_ORG_KEY ? 'Sans organisation' : orgName;
}

function _orgIcon(orgName) {
  return orgName === NO_ORG_KEY ? '👤' : '🏛️';
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
      <span class="npc-org-icon">${isNoOrg ? '👤' : '🏛️'}</span>
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
  if (filtered.length === 0) {
    return `<div style="padding:1.5rem;text-align:center;color:var(--text-dim);
        font-size:.8rem;font-style:italic">Aucun PNJ trouvé</div>`;
  }
  const groups = _groupNpcsByOrg(filtered);
  const entries = _visibleOrgEntries(groups);
  if (_filterSearch.trim()) return _renderSearchResults(entries, filtered.length);

  if (_activeOrgFilter) {
    const selected = groups.get(_activeOrgFilter) || [];
    if (selected.length) return _renderOrgDrilldown(_activeOrgFilter, selected);
    _activeOrgFilter = null;
  }

  return _renderOrgIndex(entries);
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

function _renderStatsPanel(n) {
  if (!STATE.isAdmin) return ''; // bloc réservé MJ
  const stats = n?.stats || {};
  const combat = _npcCombat(n);
  const weapon = combat.weapon || null;

  // Cellules éditables inline (admin) — vitaux + caractéristiques.
  const vitals = NPC_VITALS.map(v => `
    <div class="npc-stat-cell">
      <div class="npc-stat-k">${v.icon} ${v.label}</div>
      <input type="number" class="npc-inline" data-change="npcInlineSave"
        data-npc-id="${n.id}" data-field="${v.key}" value="${n?.[v.key] ?? ''}" placeholder="—">
    </div>`).join('');
  const statCells = NPC_STATS.map(s => {
    const score = stats[s.key];
    return `
    <div class="npc-stat-cell">
      <div class="npc-stat-k">${s.short}</div>
      <input type="number" class="npc-inline" data-change="npcInlineSave"
        data-npc-id="${n.id}" data-field="stat:${s.key}" value="${score ?? ''}" placeholder="—">
      <div class="npc-stat-mod">${score != null ? _modStr(score) : '&nbsp;'}</div>
    </div>`;
  }).join('');

  const dmg   = weapon?.degats || combat.damage || '—';
  const range = combat.range ?? weapon?.portee ?? '—';

  return `
    <div class="npc-card npc-stats-card">
      <div class="npc-card-hd">
        <div class="npc-card-title">🛡️ Combat &amp; stats <span style="font-weight:400;color:var(--text-dim)">(MJ)</span></div>
      </div>
      <div class="npc-weapon">
        <span class="npc-edit-lbl">Arme</span>
        <div class="npc-weapon-row">
          ${_shopWeapons.length
            ? `<select class="npc-select" data-change="npcSetWeapon" data-npc-id="${n.id}">
                <option value="">— Aucune arme —</option>
                ${_shopWeapons.map(w => `<option value="${w.id}" ${weapon?.itemId === w.id ? 'selected' : ''}>${_esc(_weaponLabel(w))}</option>`).join('')}
              </select>`
            : `<span class="npc-hint">Aucune arme en boutique.</span>`}
          <span class="npc-weapon-stat">🗡️ ${_esc(dmg)}</span>
          <span class="npc-weapon-stat">⌖ ${_esc(range)}</span>
        </div>
      </div>
      <div class="npc-stat-grid">${vitals}</div>
      <div class="npc-stat-grid npc-stat-grid--6">${statCells}</div>
    </div>`;
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
      onmouseover="this.style.background='rgba(255,255,255,.02)'"
      onmouseout="this.style.background='transparent'">
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
  `);
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
          <span style="flex:1;font-size:.85rem;font-weight:700;color:${col}">${_esc(t.label)}</span>
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
        ${isEdit ? `✏️ Modifier — ${_esc(_affiniteTypes.find(t => t.id === s.editingId)?.label || '')}` : '➕ Ajouter un type'}</div>

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
  const ctx = _currentAffinitePersoContext || {};
  pushModal('🎭 Affinités spécifiques', _getAffiniteTypesManagerHtml(), () => {
    // Toujours rafraîchir la fiche principale (le contexte perso peut être périmé)
    if (_activeId) {
      _refreshActivePanel();
    }
    // Rafraîchir aussi la modal perso si elle était ouverte au-dessus
    if (ctx.npcId) {
      _refreshAffinitePersoModal(ctx.npcId, ctx.existingId);
    }
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

function _getAffinitePersoModalArgs(npcId, existingId = null) {
  const n       = _npcs.find(x => x.id === npcId);
  if (!n) return null;
  const existing       = existingId ? _affiPerso.find(a => a.id === existingId) : null;
  const chars          = sortCharactersForDisplay(STATE.characters || []);
  const existingTypeId = existing?.typeId || '';

  _selectedAfpTypeId = existingTypeId;

  const typeBtns = _affiniteTypes.map(t => {
    const col = t.couleur || TYPE_COLORS[0];
    const sel = existingTypeId === t.id;
    return `<button type="button" id="afp-type-btn-${t.id}"
      data-action="_selectAfpType" data-id="${t.id}"
      style="display:flex;align-items:center;gap:.3rem;padding:4px 10px;border-radius:999px;
      cursor:pointer;font-size:.72rem;font-weight:${sel ? '700' : '500'};transition:all .15s;
      border:1px solid ${sel ? col : col + '55'};background:${sel ? col + '33' : col + '11'};color:${col}">
      <span>${t.emoji || '✨'}</span><span>${_esc(t.label)}</span></button>`;
  }).join('');

  const title = `${existing ? '✏️ Modifier' : '➕ Ajouter'} une affinité — ${_esc(n.nom)}`;
  const body  = `
    <input type="hidden" id="afp-type" value="${existingTypeId}">

    <div class="form-group">
      <label>Personnage concerné</label>
      <select class="input-field" id="afp-char">
        <option value="">— Choisir —</option>
        ${chars.map(c => `<option value="${c.id}|${_esc(c.nom || '?')}"
          ${existing?.charId === c.id ? 'selected' : ''}>${_esc(c.nom || '?')} (${_esc(c.ownerPseudo || '?')})</option>`).join('')}
      </select>
    </div>

    <div class="form-group">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.4rem">
        <label style="margin:0">Affinité spécifique</label>
        <button type="button" data-action="openAffiniteTypesManager"
          class="btn btn-outline btn-sm" style="font-size:.7rem">⚙️ Gérer</button>
      </div>
      ${_affiniteTypes.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:.35rem">${typeBtns}</div>`
        : `<div style="font-size:.78rem;color:var(--text-dim);font-style:italic">
            Aucun type — ouvre le gestionnaire pour en créer.</div>`}
    </div>

    <div class="form-group">
      <label>🌐 Note publique <span style="color:var(--text-dim);font-weight:400">(visible par tous)</span></label>
      <textarea class="input-field" id="afp-note-publique" rows="2"
        placeholder="Ex: Sœur de, Ami d'enfance…">${_esc(existing?.notePublique || '')}</textarea>
    </div>

    <div class="form-group">
      <label>🔒 Note privée <span style="color:var(--text-dim);font-weight:400">(visible par ce joueur seulement)</span></label>
      <textarea class="input-field" id="afp-note" rows="3"
        placeholder="Ex: A rendu un service personnel…">${_esc(existing?.note || '')}</textarea>
    </div>

    <div style="display:flex;gap:.5rem;margin-top:.75rem">
      <button class="btn btn-gold" style="flex:1"
        data-action="saveAffinitePerso" data-npc-id="${npcId}" data-aff-id="${existingId || ''}">Enregistrer</button>
      <button class="btn btn-outline btn-sm" data-action="close-modal">Annuler</button>
    </div>`;

  return { title, body, selectedTypeId: existingTypeId };
}

function _refreshAffinitePersoModal(npcId, existingId = null) {
  const args = _getAffinitePersoModalArgs(npcId, existingId);
  if (!args) return;
  _currentAffinitePersoContext = { npcId, existingId };
  updateModalContent(args.title, args.body);
  _selectedAfpTypeId = args.selectedTypeId;
}

export function openAffinitePersoModal(npcId, existingId = null) {
  _currentAffinitePersoContext = { npcId, existingId };
  const args = _getAffinitePersoModalArgs(npcId, existingId);
  if (!args) return;
  openModal(args.title, args.body);
  _selectedAfpTypeId = args.selectedTypeId;
}

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

  try { await updateInCol('npcs', id, patch); }
  catch (e) { notifySaveError(e); }
}

// Clic sur le portrait → choisir une image, compresser, enregistrer (base64).
function _npcSetPhoto(btn) {
  if (!STATE.isAdmin) return;
  const id = btn.dataset.id;
  pickImageFile({ onImage: async ({ file }) => {
    try {
      const b64 = await uploadJpeg(file, { max: 420, quality: 0.78 });
      const n = _npcs.find(x => x.id === id); if (n) n.imageUrl = b64;
      await updateInCol('npcs', id, { imageUrl: b64 });
      _refreshActivePanel(); _refreshList();
    } catch (e) { notifySaveError(e); }
  }});
}

// Organisations en texte libre séparé par des virgules → tableau.
async function _npcSaveOrgs(el) {
  if (!STATE.isAdmin) return;
  const n = _npcs.find(x => x.id === el.dataset.npcId); if (!n) return;
  const orgs = (el.value || '').split(',').map(s => s.trim()).filter(Boolean);
  n.organisations = orgs;
  try { await updateInCol('npcs', el.dataset.npcId, { organisations: orgs }); }
  catch (e) { notifySaveError(e); }
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
  try { await updateInCol('npcs', id, { activites }); } catch (e) { notifySaveError(e); }
}

// Toggle visibilité joueurs du profil bastion.
async function _npcToggleEmbauchable(btn) {
  if (!STATE.isAdmin) return;
  const id = btn.dataset.id;
  const n = _npcs.find(x => x.id === id); if (!n) return;
  const current = n.embauchable !== false;   // défaut = visible (true)
  n.embauchable = !current;
  try { await updateInCol('npcs', id, { embauchable: n.embauchable }); _refreshActivePanel(); }
  catch (e) { notifySaveError(e); }
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
  try { await updateInCol('npcs', id, { combat }); _refreshActivePanel(); }
  catch (e) { notifySaveError(e); }
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

function _selectAfpType(typeId) {
  _selectedAfpTypeId = typeId;
  const inp = document.getElementById('afp-type');
  if (inp) inp.value = typeId;
  _affiniteTypes.forEach(t => {
    const btn = document.getElementById(`afp-type-btn-${t.id}`);
    if (!btn) return;
    const col = t.couleur || TYPE_COLORS[0];
    const sel = t.id === typeId;
    btn.style.fontWeight  = sel ? '700' : '500';
    btn.style.background  = sel ? col + '33' : col + '11';
    btn.style.borderColor = sel ? col : col + '55';
  });
}

// ── Sauvegarde / suppression affinité individuelle ────────────────────────────
export async function saveAffinitePerso(npcId, existingId) {
  const charSel = document.getElementById('afp-char')?.value;
  if (!charSel) { showNotif('Choisis un personnage.', 'error'); return; }
  const typeId = document.getElementById('afp-type')?.value || '';
  if (!typeId) { showNotif('Choisis une affinité spécifique.', 'error'); return; }

  const [charId, charNom] = charSel.split('|');
  const type  = _getAffiniteType(typeId);
  const note          = document.getElementById('afp-note')?.value?.trim() || '';
  const notePublique  = document.getElementById('afp-note-publique')?.value?.trim() || '';
  const data  = { npcId, charId, charNom, typeId, typeLabel: type?.label || '', note, notePublique };

  if (existingId) {
    await updateInCol('npc_affinites', existingId, data);
    const idx = _affiPerso.findIndex(a => a.id === existingId);
    if (idx >= 0) _affiPerso[idx] = { ..._affiPerso[idx], ...data };
  } else {
    const newId = await addToCol('npc_affinites', data);
    // Dédupe : le watch onSnapshot peut avoir déjà inséré l'entrée via
    // latency-compensation pendant l'await — sinon on duplique l'id.
    const entry = { id: newId || `afp_${Date.now()}`, ...data };
    const idx = _affiPerso.findIndex(a => a.id === entry.id);
    if (idx >= 0) _affiPerso[idx] = entry;
    else _affiPerso.push(entry);
  }

  closeModal();
  showNotif('Affinité enregistrée !', 'success');
  _refreshActivePanel();
}

export async function deleteAffinitePerso(id) {
  if (!await confirmModal('Supprimer cette affinité ?', {title: 'Confirmation de suppression'})) return;
  await deleteFromCol('npc_affinites', id);
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
  npcSetPhoto:               (btn) => _npcSetPhoto(btn),
  npcToggleActivite:         (btn) => _npcToggleActivite(btn),
  npcToggleEmbauchable:      (btn) => _npcToggleEmbauchable(btn),
  npcAddEvent:               (btn) => _npcAddEvent(btn),
  npcCreate:                 () => _npcCreate(),
  _mjStatsFilter:            (el) => _mjStatsFilter(el.value),
  _setHistEditDeltaFromInput:(el) => _setHistEditDeltaFromInput(el.value),
  deleteNpc:               (btn) => deleteNpc(btn.dataset.id),
  _deleteNpcThenClose:     (btn) => deleteNpc(btn.dataset.id).then(ok => { if (ok) closeModal(); }),
  selectNpc:               (btn) => selectNpc(btn.dataset.id),
  openAffinitePersoModal:  (btn) => openAffinitePersoModal(btn.dataset.npcId, btn.dataset.affId || undefined),
  deleteAffinitePerso:     (btn) => deleteAffinitePerso(btn.dataset.id),
  openAffiniteTypesManager:()   => openAffiniteTypesManager(),
  saveAffiniteSeuils:      ()   => saveAffiniteSeuils(),
  resetAffiniteSeuils:     ()   => resetAffiniteSeuils(),
  openAffiniteSeuilsModal: ()   => openAffiniteSeuilsModal(),
  saveAffinitePerso:       (btn) => saveAffinitePerso(btn.dataset.npcId, btn.dataset.affId || ''),
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
  _selectAfpType:          (btn) => _selectAfpType(btn.dataset.id),
  _openMjStatsView:        ()   => _openMjStatsView(),
  _npcSelectOrg:           (btn) => _npcSelectOrg(btn),
  _npcBackToOrgs:          ()   => _npcBackToOrgs(),
  _mjEditField:            (btn) => _mjEditField(btn.dataset.npcId, btn.dataset.field),
  _mjOpenNpc:              (btn) => _mjOpenNpc(btn.dataset.id),
});
