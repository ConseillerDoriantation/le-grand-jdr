// ══════════════════════════════════════════════
// PAGES
// ══════════════════════════════════════════════
import { STATE } from '../core/state.js';
import { PRESENCE_TTL_MS } from '../shared/presence-ttl.js';
import { registerActions, dispatchAction } from '../core/actions.js';
import { loadChars, loadCollection, loadCollectionAfter, loadCollectionWhere, getCachedCollection, getDocData, getDocDataSilent, replaceDoc, saveDoc, updateInCol, deleteFromCol, claimDocumentLease, clearDocumentLease, subscribeRecentCollection } from '../data/firestore.js';
import { subscribeRecentWhere } from '../data/firestore-queries.js';
import { _esc, _norm, appSplashHtml, pageHeaderHtml, loadingHtml} from '../shared/html.js';
import { emptyStateHtml } from '../shared/list-renderer.js';
import { isFeatureEnabled } from '../shared/features.js';
import { activeGroupsFromSources, compactDashboardSessions, isUsableSummary } from '../shared/dashboard-summary.js';
import { isAgendaSessionUpcoming } from '../shared/agenda-sessions.js';
import { calcPalier, calcPVMax, calcPMMax, calcCA, calcOr, getDefaultCharForUser, sortCharactersForDisplay } from '../shared/char-stats.js';
import { loadStats, peekStats, applyStatsLegacyRollup, resetStats, deleteCharStats, deleteCharDateStats, deleteDateStats, deleteMissionStats, correctDateCombatStats, setSessionMission } from '../shared/stats.js';
import { aggregateActionAverages, aggregateSkillAverages, aggregateVttRollDetails, combatAverages, mergeTrackedCombatStats, mergeTrackedSkillStats, mergeVttRollDetails, normalizeSkillStats, topStatTies, vttLogTimeMs } from '../shared/stats-analysis.js';
import { MVP_AXIS_GUIDE, MVP_SCORING_GUIDE, mvpCalibrationRows, scoreMvpView } from '../shared/stats-mvp.js';
import { statsBalance, statsInsights, statsRecords, statsSessionTotal, statsSpotlight, suggestStatsSessionLink } from '../shared/stats-insights.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { copyText } from '../shared/clipboard.js';
import { confirmModal, openModal, promptModal, closeModalDirect } from '../shared/modal.js';
import { watch, watchDoc } from '../shared/realtime.js';
import { setDashboardPartyChars, setDashboardQuests } from '../shared/dashboard-session.js';
import { setTargetCharacter, consumeTargetCharacter } from '../shared/character-navigation.js';
import { getRouteSub, setRouteSub } from '../shared/route.js';
import { characterAvatarHtml, characterColor, characterPortraitContent } from '../shared/portraits.js';
import { resolveAvatarUrl } from '../shared/avatar.js';
import { canControlCharacter, getControlledCharacters } from '../shared/character-state.js';
import { dedupeQuestParticipants, questParticipantFromChar } from '../shared/participants.js';
import { BASTION_WALL_TYPES, bastionWallReactionCounts, bastionWallSeenKey } from '../shared/bastion-wall.js';
import { createDashboardWallFeed, dashboardWallView } from '../shared/dashboard-wall-feed.js';
import { bastionRoomProjects, roomInvestmentContributors } from '../shared/bastion-investments.js';
import { bastionSignalSnapshot } from '../shared/bastion-signal.js';
import { timeAgo } from '../shared/relative-time.js';
import { createEmoteLookup, normalizeEmoteCatalog, sanitizeEmoteName } from '../shared/emote-admin.js';

import { charSession } from '../shared/char-session.js';
import { openAdventureSwitcher } from '../core/layout.js';
import { loadAllUsers, relinkPlayerAccount } from '../core/adventure.js';
const renderCharSheet   = (...args) => charSession.renderSheet(...args);

// ── Statistiques : état léger pour la vue « par séance » (évite une relecture) ──
let _statsData = null;                 // dernier doc stats chargé (pour la modale par date)
let _statsVttLogs = [];                // journal complet : détails absents des anciens compteurs
let _statsVttLogsLoaded = false;       // évite de présenter un ancien compteur gonflé comme canonique
let _statsLegacyRollups = null;        // détails historiques persistés par scope (plus de scan complet répété)
let _statsVttDetailCache = new Map();  // scope de dates → agrégat du journal
let _statsRowsCache = new Map();       // scope de dates → lignes calculées (réutilisées entre onglets)
let _statsEmoteUrl = new Map();        // name → url (affichage de l'émote réelle)
let _statsScope = null;                // null = toute la campagne ; sinon clé date YYYY-MM-DD
let _statsLastSummary = '';            // récap texte du scope courant (export Discord)
let _statsPlayerSel = null;            // Set d'ids ciblés (null = tous les joueurs)
let _statsGroupSel = null;             // Set de groupes ciblés pour une mission (null = tous)
let _statsGroupMissionId = '';         // mission associée au filtre groupes
let _statsHiddenAwards = new Set();    // distinctions masquées localement par l'utilisateur
let _statsMvpOverrides = {};           // { scopeKey: charId } — MVP désigné à la main par le MJ (settings/mvpOverrides)
let _statsScopeRows = [];              // participants de la vue courante (pour le sélecteur de MVP manuel)
let _statsHiddenChars = new Set();     // charIds masqués des stats par le MJ (settings/statsHidden)

function _statsNormalizeHiddenIds(doc) {
  const raw = doc && typeof doc === 'object' ? doc.ids : null;
  return new Set(Array.isArray(raw) ? raw.filter(id => typeof id === 'string' && id) : []);
}
const _STATS_DEAD_STATUSES = new Set(['dead', 'mort', 'morte', 'decede', 'decedee']);
const _statsIsDeadChar = (id) => _STATS_DEAD_STATUSES.has(_norm((STATE.characters?.find(x => x.id === id)?.lifeStatus) || ''));
// Retire les personnages masqués par le MJ. `includeHidden` sert aux rollups
// (qui doivent toujours agréger TOUT le monde, sinon un perso ré-affiché perdrait
// son historique compact).
const _statsFilterHidden = (rows, includeHidden) =>
  (includeHidden || !_statsHiddenChars.size) ? rows : rows.filter(r => !_statsHiddenChars.has(r.id));

// Clé d'override du MVP = le scope courant (séance/mission/acte) ou '__campaign__'.
const _statsMvpScopeKey = (scope = _statsScope) => scope || '__campaign__';
function _statsNormalizeMvpOverrides(doc) {
  const raw = doc && typeof doc === 'object' ? doc.overrides : null;
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' && value) out[key] = value;
  }
  return out;
}

function _statsOpenMvpOverrideModal() {
  if (!STATE.isAdmin) return;
  const rows = _statsScopeRows || [];
  const current = _statsMvpOverrides[_statsMvpScopeKey()] || '';
  const list = rows.length
    ? rows.map(r => `<button type="button" class="stats-mvp-pick${r.id === current ? ' is-current' : ''}" data-action="_statsMvpSetOverride" data-id="${_esc(r.id)}">${_statsAvatar(r.id, r.name, 28)}<span>${_esc(r.name)}</span>${r.id === current ? '<em>Actuel</em>' : ''}</button>`).join('')
    : '<p class="stats-empty-inline">Aucun personnage dans cette vue.</p>';
  openModal('🏆 Désigner le MVP', `<div class="stats-mvp-pick-list">${list}</div>${current ? '<button type="button" class="stats-mvp-pick-clear" data-action="_statsMvpClearOverride">↩ Rétablir le calcul automatique</button>' : ''}`,
    { subtitle: 'Ton choix remplace le calcul pour cette vue. Les joueurs le voient.' });
}

async function _statsSaveMvpOverrides(next) {
  try {
    await saveDoc('settings', 'mvpOverrides', { overrides: next, updatedAt: Date.now() });
    _statsMvpOverrides = next;
    closeModalDirect();
    _statsRender(_statsScope);
    return true;
  } catch (error) {
    notifySaveError(error);
    return false;
  }
}

function _statsSetMvpOverride(charId) {
  if (!STATE.isAdmin || !charId) return;
  _statsSaveMvpOverrides({ ..._statsMvpOverrides, [_statsMvpScopeKey()]: charId });
}

function _statsClearMvpOverride() {
  if (!STATE.isAdmin) return;
  const key = _statsMvpScopeKey();
  if (!(key in _statsMvpOverrides)) { closeModalDirect(); return; }
  const next = { ..._statsMvpOverrides };
  delete next[key];
  _statsSaveMvpOverrides(next);
}

// Personnages masqués des stats (morts, PNJ, abandons…). Filtre toutes les vues,
// sans supprimer de données. Réversible. Stocké dans settings/statsHidden (MJ).
async function _statsSaveHiddenChars() {
  try {
    await saveDoc('settings', 'statsHidden', { ids: [..._statsHiddenChars], updatedAt: Date.now() });
    if (_statsManageIsOpen()) _statsOpenManageModal();
    const y = window.scrollY;
    _statsRender(_statsScope);
    if (Math.abs(window.scrollY - y) > 1) window.scrollTo({ top: y, behavior: 'auto' });
  } catch (error) { notifySaveError(error); }
}
function _statsToggleHideChar(id) {
  if (!STATE.isAdmin || !id) return;
  _statsHiddenChars.has(id) ? _statsHiddenChars.delete(id) : _statsHiddenChars.add(id);
  _statsSaveHiddenChars();
}
function _statsHideDead() {
  if (!STATE.isAdmin) return;
  for (const id of Object.keys(_statsData?.chars || {})) if (_statsIsDeadChar(id)) _statsHiddenChars.add(id);
  _statsSaveHiddenChars();
}
function _statsShowAllChars() {
  if (!STATE.isAdmin) return;
  _statsHiddenChars = new Set();
  _statsSaveHiddenChars();
}
let _statsVisualSummary = null;        // données du dernier rendu pour export image
let _statsVisualSummaryEnricher = null;// compléments lourds calculés uniquement lors de l'export
let _statsCmpMetric = 'dmgDealt';      // métrique du graphique comparatif (par perso)
let _statsCmpType   = 'bars';          // type du comparatif : 'bars' | 'pie'
let _statsEvoMetric = 'dmgDealt';      // métrique du comparatif missions/groupes
let _statsAnalysisMode = 'overview';   // 'overview' | 'compare'
let _statsTab = 'summary';             // summary|sessions|characters|dice|data
const _STATS_TABS = ['summary', 'sessions', 'characters', 'dice', 'data'];
const _STATS_TAB_ALIASES = { overview: 'summary', ranking: 'characters', players: 'characters', rolls: 'dice', audit: 'data' };
let _statsPopOpen = false;             // popover « joueurs ciblés » ouvert (persisté entre rendus)
let _statsMissionPopOpen = false;      // popover « Mission » (avec images) ouvert
let _statsRankSort = { key: 'dmg', dir: -1 }; // tri du tableau de classement (dir : -1 desc, 1 asc)
let _statsRankMode = 'total';          // total | session
let _statsSessionsMode = 'mission';    // mission | chrono
let _statsSessionsPendingOnly = false; // filtre MJ des séances à relier
let _statsDrawerId = '';
let _statsDrawerTab = 'profile';       // profile | sessions | dice | compare
let _statsDiceKind = 'all';            // all | skills | attacks
let _statsDrawerKeyboardBound = false;
let _statsRollSort = { table: 'skills', key: 'count', dir: -1 }; // tri des tableaux Jets & moyennes
let _statsRythmeView = 'timeline';     // vue du rythme : 'timeline' (barres) | 'pie' (camembert répartition)
let _statsEvolutionMode = 'total';     // total | participant (graphique du résumé)
let _statsCompareKind = 'players';     // 'players' | 'groups'
const _statsCompareSelection = { players: [], groups: [] };
let _statsMissionPickerSearch = '';
let _statsQuests    = [];              // groupes de mission (collection quests) pour libellés/portraits
let _statsStory     = [];              // missions de la Trame pour ordre/titres du sélecteur stats
let _statsDrawerState = new Map();     // key → état ouvert/fermé des onglets stats durant la session
let _statsRequestedScope = null;       // navigation ciblée depuis le Centre de session

let _statsPopCloserBound = false;      // listener global de fermeture du popover joueurs (une fois)
let _statsMvpDetailId = '';            // candidat actuellement affiche dans le detail MVP
let _statsMvpOutsideClose = null;      // listeners temporaires du panneau detail MVP
let _statsNavSpyCleanup = null;        // nettoyage du suivi de section active
let _statsLoadRevision = 0;            // ignore les compléments async d'une ancienne ouverture
let _statsAdventureId = '';            // évite de réutiliser le journal d'une autre aventure

export function requestStatsScope(scope = null) {
  _statsRequestedScope = scope || null;
}

// Avatar (rond) d'un perso par id — devant son nom dans les chips/graphiques.
function _statsUnbindMvpOutsideClose() {
  if (!_statsMvpOutsideClose) return;
  document.removeEventListener('pointerdown', _statsMvpOutsideClose.pointer, true);
  document.removeEventListener('keydown', _statsMvpOutsideClose.key, true);
  _statsMvpOutsideClose = null;
}
function _statsCloseMvpDetail(root) {
  const drawer = root?.querySelector('.stats-mvp-stack > .stats-drawer[open]');
  if (!drawer) return false;
  drawer.open = false;
  _statsDrawerState.set(drawer.dataset.drawerKey || 'mvp-detail', false);
  return true;
}
function _statsBindMvpOutsideClose(root) {
  _statsUnbindMvpOutsideClose();
  if (!root) return;
  const cleanupIfDetached = () => {
    if (root.isConnected) return false;
    _statsUnbindMvpOutsideClose();
    return true;
  };
  const pointer = (event) => {
    if (cleanupIfDetached()) return;
    const drawer = root.querySelector('.stats-mvp-stack > .stats-drawer[open]');
    if (!drawer || drawer.contains(event.target)) return;
    _statsCloseMvpDetail(root);
  };
  const key = (event) => {
    if (cleanupIfDetached() || event.key !== 'Escape') return;
    if (_statsCloseMvpDetail(root)) event.preventDefault();
  };
  document.addEventListener('pointerdown', pointer, true);
  document.addEventListener('keydown', key, true);
  _statsMvpOutsideClose = { pointer, key };
}

function _statsUnbindNavSpy() {
  if (!_statsNavSpyCleanup) return;
  _statsNavSpyCleanup();
  _statsNavSpyCleanup = null;
}

// Ferme le popover « joueurs ciblés » sur un clic hors du popover (installé une fois).
function _statsBindPopCloser() {
  if (_statsPopCloserBound) return;
  _statsPopCloserBound = true;
  document.addEventListener('click', (e) => {
    const root = document.getElementById('stats-root');
    if (!root?.querySelector('.stats-pop.open')) return;
    if (!e.target.closest('.stats-pop')) {
      root.querySelectorAll('.stats-pop.open').forEach(p => p.classList.remove('open'));
      _statsPopOpen = false; _statsMissionPopOpen = false;
    }
  }, true);
}

function _statsBindNavSpy(root) {
  _statsUnbindNavSpy();
  const nav = root?.querySelector('.stats-section-nav');
  if (!root || !nav) return;
  const buttons = [...nav.querySelectorAll('[data-target]')];
  const sections = buttons
    .map(btn => ({ btn, section: document.getElementById(btn.dataset.target || '') }))
    .filter(x => x.section && root.contains(x.section));
  if (!sections.length) return;

  const setActive = (id) => {
    buttons.forEach(btn => btn.classList.toggle('active', btn.dataset.target === id));
  };
  setActive(sections[0].section.id);

  if ('IntersectionObserver' in window) {
    const visible = new Map();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => visible.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0));
      const best = sections
        .map(x => ({
          id: x.section.id,
          ratio: visible.get(x.section.id) || 0,
          top: Math.abs(x.section.getBoundingClientRect().top),
        }))
        .sort((a, b) => (b.ratio - a.ratio) || (a.top - b.top))[0];
      if (best?.id) setActive(best.id);
    }, { rootMargin: '-18% 0px -62% 0px', threshold: [0, .1, .25, .5, .75, 1] });
    sections.forEach(x => observer.observe(x.section));
    _statsNavSpyCleanup = () => observer.disconnect();
    return;
  }

  const onScroll = () => {
    const best = sections
      .map(x => ({ id: x.section.id, top: Math.abs(x.section.getBoundingClientRect().top - 120) }))
      .sort((a, b) => a.top - b.top)[0];
    if (best?.id) setActive(best.id);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  _statsNavSpyCleanup = () => window.removeEventListener('scroll', onScroll);
  onScroll();
}

const _statsCharacterById = id => (STATE.characters || []).find(char => char?.id === id);

function _statsCharacterName(id, fallback = '') {
  const live = _statsCharacterById(id);
  return String(live?.nom || live?.name || fallback || 'Personnage').trim() || 'Personnage';
}

const _statsAvatar = (id, name, size = 18) => {
  const currentName = _statsCharacterName(id, name);
  return characterAvatarHtml(_statsCharacterById(id) || { nom: currentName }, { size, className: 'stats-av-xs', title: currentName });
};

function _statsCaptureDrawerState(root = document.getElementById('stats-root')) {
  if (!root) return;
  root.querySelectorAll('details[data-drawer-key]').forEach(d => {
    if (d.dataset.drawerKey) _statsDrawerState.set(d.dataset.drawerKey, !!d.open);
  });
}
function _statsSessionEntry(sessionKey) {
  return sessionKey ? (_statsData?.sessions?.[sessionKey] || {}) : {};
}
function _statsDateOf(sessionKey) {
  const stored = _statsSessionEntry(sessionKey).date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(stored || ''))) return stored;
  const prefix = String(sessionKey || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(prefix) ? prefix : '';
}
function _statsSessionBucket(char, sessionKey) {
  return char?.bySession?.[sessionKey] || char?.byDate?.[sessionKey] || null;
}
function _statsAllSessionKeys() {
  const keys = new Set();
  Object.values(_statsData?.chars || {}).forEach(char => {
    Object.keys(char?.byDate || {}).forEach(key => keys.add(key));
    Object.keys(char?.bySession || {}).forEach(key => keys.add(key));
  });
  return [...keys].sort((a, b) => {
    const dateCmp = _statsDateOf(b).localeCompare(_statsDateOf(a));
    if (dateCmp) return dateCmp;
    return Number(_statsSessionEntry(b).startedAt || 0) - Number(_statsSessionEntry(a).startedAt || 0)
      || b.localeCompare(a);
  });
}
function _statsSessionTime(sessionKey) {
  const startedAt = Number(_statsSessionEntry(sessionKey).startedAt) || 0;
  if (!startedAt) return '';
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(startedAt));
}
function _statsSessionLabel(sessionKey, { short = false } = {}) {
  const date = _statsFmtDate(sessionKey);
  const time = _statsSessionTime(sessionKey);
  return [short ? date.slice(0, 5) : date, time].filter(Boolean).join(' · ');
}
function _statsSessionDateParts(sessionKey) {
  const raw = _statsDateOf(sessionKey);
  if (!raw) return { weekday: '', date: 'Date inconnue', long: 'Date inconnue' };
  const date = new Date(`${raw}T12:00:00`);
  const weekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(date).replace('.', '').toUpperCase();
  const short = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(date);
  const long = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  return { weekday, date: short, long };
}

// Mission d'une séance (libellé MJ), ou '' si non renseignée.
const _statsMissionOf = (sessionKey) => (sessionKey && _statsData?.sessions?.[sessionKey]?.mission) || '';
const _statsSessionIsLinked = (sessionKey) => !!(sessionKey && _statsData?.sessions?.[sessionKey]?.missionId);
const _statsUnlinkedDates = (sessions = []) => sessions.filter(sessionKey => !_statsSessionIsLinked(sessionKey));
const _statsGroupOf   = (sessionKey) => {
  const session = sessionKey ? _statsData?.sessions?.[sessionKey] : null;
  if (!session) return '';
  const current = session.groupId ? (_statsQuests || []).find(q => q.id === session.groupId) : null;
  if (current) return _statsGroupName(current);
  const group = session.group || '';
  return (group && group !== 'Groupe') ? group : '';
};
// Séances liées à une mission. Les anciennes clés sont des dates ; les nouvelles
// sont des identifiants uniques portant leur date dans `sessions.{id}.date`.
const _statsMissionDates = (mid) => Object.entries(_statsData?.sessions || {}).filter(([, s]) => s?.missionId === mid).map(([dk]) => dk);
const _statsGroupKeyOf = (sessionKey) => {
  const session = sessionKey ? _statsData?.sessions?.[sessionKey] : null;
  if (!session) return '__nogroup';
  if (session.groupId) return `id:${session.groupId}`;
  const group = _statsGroupOf(sessionKey);
  return group ? `name:${_norm(group)}` : '__nogroup';
};
// Missions distinctes ayant ≥1 séance liée (pour la frise).
function _statsStoryOrderCompare(a = {}, b = {}) {
  const ao = Number.isFinite(Number(a.ordre)) ? Number(a.ordre) : Number.MAX_SAFE_INTEGER;
  const bo = Number.isFinite(Number(b.ordre)) ? Number(b.ordre) : Number.MAX_SAFE_INTEGER;
  return (a.acte || '').localeCompare(b.acte || '', 'fr')
    || ao - bo
    || (a.date || '').localeCompare(b.date || '', 'fr')
    || (a.titre || a.name || '').localeCompare(b.titre || b.name || '', 'fr');
}
function _statsActLabel(story = {}) {
  const raw = story?.acte || story?.act || story?.arc || '';
  return String(raw || 'Acte I').trim() || 'Acte I';
}
function _statsActKey(label = '') {
  return _norm(label || 'Acte I').replace(/[^a-z0-9]+/g, '-') || 'acte-i';
}
function _statsMissionList() {
  const sessionNames = new Map();
  for (const s of Object.values(_statsData?.sessions || {})) {
    if (s?.missionId && !sessionNames.has(s.missionId)) sessionNames.set(s.missionId, s.mission || 'Mission');
  }
  const storyById = new Map((_statsStory || []).map(m => [m.id, m]));
  return [...sessionNames.entries()]
    .map(([id, name]) => {
      const story = storyById.get(id);
      return { id, name: story?.titre || name, story };
    })
    .sort((a, b) => {
      if (a.story && b.story) return _statsStoryOrderCompare(a.story, b.story);
      if (a.story) return -1;
      if (b.story) return 1;
      return a.name.localeCompare(b.name, 'fr');
    });
}
function _statsActList(missions = _statsMissionList()) {
  const map = new Map();
  missions.forEach(m => {
    const label = _statsActLabel(m.story);
    const key = _statsActKey(label);
    const entry = map.get(key) || { key, label, missions: [], dates: [] };
    entry.missions.push(m);
    entry.dates.push(..._statsMissionDates(m.id));
    map.set(key, entry);
  });
  const storyOrder = (entry) => Math.min(...entry.missions.map(m => {
    const v = Number(m.story?.ordre);
    return Number.isFinite(v) ? v : Number.MAX_SAFE_INTEGER;
  }));
  return [...map.values()]
    .map(entry => ({ ...entry, dates: [...new Set(entry.dates)].sort().reverse() }))
    .sort((a, b) => storyOrder(a) - storyOrder(b) || a.label.localeCompare(b.label, 'fr'));
}
function _statsMissionKind(story = {}) {
  return story?.type === 'event' ? 'Événement' : 'Mission';
}
function _statsMissionIcon(story = {}) {
  return story?.type === 'event' ? '📖' : '🎯';
}
function _statsMissionMeta(m = {}) {
  const story = m.story || {};
  const sessions = _statsMissionDates(m.id).length;
  const bits = [
    _statsMissionKind(story),
    _statsActLabel(story),
    Number.isFinite(Number(story.ordre)) ? String(story.ordre) : '',
  ].filter(Boolean);
  return `${bits.join(' · ')}${sessions ? ` · ${sessions} séance${sessions > 1 ? 's' : ''}` : ''}`;
}
function _statsMissionArtHtml(m = {}, size = 34) {
  const story = m.story || {};
  const img = story.imageUrl || story.image || story.coverUrl || '';
  return img
    ? `<span class="stats-mission-art" style="--s:${size}px"><img src="${_esc(img)}" alt=""></span>`
    : `<span class="stats-mission-art stats-mission-art--ph" style="--s:${size}px">${_statsMissionIcon(story)}</span>`;
}
function _statsMissionPickOptionHtml(m = {}, selectedMissionId = '') {
  const title = m.name || m.story?.titre || 'Mission';
  const search = _norm([title, m.story?.acte, m.story?.date, _statsMissionKind(m.story)].filter(Boolean).join(' '));
  return `<button type="button" class="stats-mission-option${m.id === selectedMissionId ? ' is-active' : ''}"
    data-action="_statsMissionPickerPick" data-scope="mission:${_esc(m.id)}" data-search="${_esc(search)}">
    ${_statsMissionArtHtml(m, 34)}
    <span class="stats-mission-option-copy">
      <b>${_esc(title)}</b>
      <small>${_statsMissionIcon(m.story)} ${_esc(_statsMissionMeta(m))}</small>
    </span>
    ${m.id === selectedMissionId ? '<span class="stats-mission-check">✓</span>' : ''}
  </button>`;
}
function _statsMissionPickerHtml(missions = [], selectedMissionId = '', selectedMission = null, scope = null, acts = [], selectedAct = null) {
  const isAll = !selectedMissionId && !scope;
  const isAct = !!selectedAct && typeof scope === 'string' && scope.startsWith('act:');
  const current = selectedMission
    ? `${_statsMissionArtHtml(selectedMission, 36)}
      <span class="stats-mission-current-copy">
        <b>${_esc(selectedMission.name || 'Mission')}</b>
        <small>${_statsMissionIcon(selectedMission.story)} ${_esc(_statsMissionMeta(selectedMission))}</small>
      </span>`
    : isAct
    ? `<span class="stats-mission-art stats-mission-art--all" style="--s:36px">ACT</span>
      <span class="stats-mission-current-copy">
        <b>${_esc(selectedAct.label)}</b>
        <small>${selectedAct.missions.length} mission${selectedAct.missions.length > 1 ? 's' : ''} suivie${selectedAct.missions.length > 1 ? 's' : ''} &middot; ${selectedAct.dates.length} s&eacute;ance${selectedAct.dates.length > 1 ? 's' : ''}</small>
      </span>`
    : `<span class="stats-mission-art stats-mission-art--all" style="--s:36px">&#9673;</span>
      <span class="stats-mission-current-copy">
        <b>${scope ? 'S&eacute;ance isol&eacute;e' : 'Toute la campagne'}</b>
        <small>${scope ? 'Filtre par s&eacute;ance' : `${missions.length} mission${missions.length > 1 ? 's' : ''} suivie${missions.length > 1 ? 's' : ''}`}</small>
      </span>`;
  return `<div class="stats-mission-picker" data-picker="stats-mission">
    <span class="stats-chips-lbl">Mission</span>
    <div class="stats-mission-picker-shell">
      <button type="button" class="stats-mission-current${isAll ? ' is-all' : ''}" data-action="_statsMissionPickerToggle" aria-expanded="false">
        ${current}
        <span class="stats-mission-caret">&#9662;</span>
      </button>
      <div class="stats-mission-menu" hidden>
        <input type="text" class="stats-mission-search" value="${_esc(_statsMissionPickerSearch)}"
          placeholder="Rechercher une mission / un &eacute;v&eacute;nement..." data-input="_statsMissionPickerSearch" autocomplete="off">
        <div class="stats-mission-list">
          <button type="button" class="stats-mission-option stats-mission-option--all${isAll ? ' is-active' : ''}"
            data-action="_statsMissionPickerPick" data-scope="">
            <span class="stats-mission-art stats-mission-art--all" style="--s:34px">&#9673;</span>
            <span class="stats-mission-option-copy">
              <b>Toute la campagne</b>
              <small>Vue globale de toutes les s&eacute;ances</small>
            </span>
            ${isAll ? '<span class="stats-mission-check">&#10003;</span>' : ''}
          </button>
          ${acts.length ? `<div class="stats-mission-section-label">Par acte</div>` : ''}
          ${acts.map(a => `<button type="button" class="stats-mission-option stats-mission-option--act${isAct && a.key === selectedAct.key ? ' is-active' : ''}"
            data-action="_statsMissionPickerPick" data-scope="act:${_esc(a.key)}"
            data-search="${_esc(_norm([a.label, ...a.missions.map(m => m.name)].join(' ')))}">
            <span class="stats-mission-art stats-mission-art--all" style="--s:34px">ACT</span>
            <span class="stats-mission-option-copy">
              <b>${_esc(a.label)}</b>
              <small>${a.missions.length} mission${a.missions.length > 1 ? 's' : ''} &middot; ${a.dates.length} s&eacute;ance${a.dates.length > 1 ? 's' : ''}</small>
            </span>
            ${isAct && a.key === selectedAct.key ? '<span class="stats-mission-check">&#10003;</span>' : ''}
          </button>`).join('')}
          ${missions.length ? '<div class="stats-mission-section-label">Par mission</div>' : ''}
          ${missions.map(m => _statsMissionPickOptionHtml(m, selectedMissionId)).join('')}
          ${missions.length ? '' : '<div class="stats-mission-empty">Aucune mission reli&eacute;e aux statistiques.</div>'}
        </div>
      </div>
    </div>
  </div>`;
}

function _statsGroupName(g = {}, idx = 0) {
  return (g.titre || g.nom || g.name || '').trim() || `Groupe ${idx + 1}`;
}
function _statsGroupsForMission(story = [], quests = [], missionId = '') {
  const linked = (quests || [])
    .filter(q => q?.missionId === missionId)
    .sort((a, b) => (_statsGroupName(a)).localeCompare(_statsGroupName(b), 'fr'));
  if (linked.length) return linked;
  const legacyGroups = (story || []).find(x => x.id === missionId)?.groupes || [];
  return Array.isArray(legacyGroups) ? legacyGroups : [];
}
function _statsGroupMembersHtml(g = {}) {
  const charById = new Map((STATE.characters || []).map(c => [c.id, c]));
  const parts = dedupeQuestParticipants(g.participants || []);
  if (!parts.length) return `<span class="stats-mp-empty-members">Aucun membre</span>`;
  return parts.map(p => {
    const char = p.charId ? charById.get(p.charId) : null;
    const avatarData = char || p;
    return characterAvatarHtml(avatarData, {
      size: 24,
      className: 'stats-mp-avatar',
      title: avatarData.nom || p.nom || '?',
      border: '1px solid rgba(255,255,255,.12)',
      background: 'rgba(79,140,255,.16)',
    });
  }).join('');
}
function _statsGroupMembersMiniHtml(g = {}) {
  const charById = new Map((STATE.characters || []).map(c => [c.id, c]));
  const parts = dedupeQuestParticipants(g.participants || []);
  return parts.slice(0, 5).map(p => {
    const char = p.charId ? charById.get(p.charId) : null;
    const avatarData = char || p;
    return characterAvatarHtml(avatarData, {
      size: 18,
      className: 'stats-chip-group-avatar',
      title: avatarData.nom || p.nom || '?',
      border: '1px solid rgba(255,255,255,.16)',
      background: 'rgba(79,140,255,.16)',
    });
  }).join('');
}
function _statsGroupOptionsForDates(dates = []) {
  const map = new Map();
  dates.forEach(d => {
    const session = _statsData?.sessions?.[d] || {};
    const key = _statsGroupKeyOf(d);
    const label = _statsGroupOf(d) || 'Sans groupe';
    const current = map.get(key) || { key, label, groupId: session.groupId || '', count: 0, dates: [] };
    current.count += 1;
    current.dates.push(d);
    if (!current.groupId && session.groupId) current.groupId = session.groupId;
    map.set(key, current);
  });
  return [...map.values()].map(g => ({
    ...g,
    quest: g.groupId ? (_statsQuests || []).find(q => q.id === g.groupId) : null,
  })).sort((a, b) => {
    if (a.key === '__nogroup') return 1;
    if (b.key === '__nogroup') return -1;
    return a.label.localeCompare(b.label, 'fr');
  });
}
// Étape 2 du sélecteur : choisir le GROUPE de la mission ayant joué la séance.
function _statsGroupStep(dk, mid, mission, groupes) {
  const curG = _statsData?.sessions?.[dk]?.groupId || '';
  const opt = (g, idx, active) => {
    const gid = g.id || '';
    const name = _statsGroupName(g, idx);
    return (
    `<button type="button" class="stats-mp-opt${active ? ' active' : ''}"
      data-action="_statsPickGroup" data-scope="${dk}" data-mission-id="${_esc(mid)}" data-mission="${_esc(mission)}" data-group-id="${_esc(gid)}" data-group="${_esc(name)}">
      <span class="stats-mp-ico">👥</span>
      <span class="stats-mp-body">
        <span class="stats-mp-tt">${_esc(name)}</span>
        <span class="stats-mp-members">${_statsGroupMembersHtml(g)}</span>
      </span>
      ${active ? '<span class="stats-mp-check">✓</span>' : ''}</button>`
    );
  };
  openModal(`🎯 ${_esc(mission)}`, `
    <div class="stats-mp">
      <div class="stats-mp-hint">Quel groupe a joué cette séance ?</div>
      <div class="stats-mp-list">
        <button type="button" class="stats-mp-opt stats-mp-none${!curG ? ' active' : ''}" data-action="_statsPickGroup" data-scope="${dk}" data-mission-id="${_esc(mid)}" data-mission="${_esc(mission)}" data-group-id="" data-group=""><span class="stats-mp-ico">—</span><span class="stats-mp-tt">Sans groupe précis</span></button>
        ${groupes.map((g, idx) => opt(g, idx, g.id === curG)).join('')}
      </div>
    </div>`, { subtitle: 'Groupe de la mission', accent: '#4f8cff' });
}

// Métriques graphables : clé → { libellé, couleur }. La valeur se lit sur la
// ligne (combat, ou sRolls pour les jets de compétence).
const _STATS_METRICS = {
  dmgDealt:   { lbl: 'Dégâts infligés',     color: '#c9b6ff' },
  attacks:    { lbl: 'Attaques',            color: '#ff9d7a' },
  heal:       { lbl: 'Soin prodigué',       color: '#4fd3a6' },
  spellsCast: { lbl: 'Sorts lancés',        color: '#bca0ff' },
  tacticalSpells: { lbl: 'Sorts tactiques', color: '#d8c7ff' },
  supportSpells: { lbl: 'Soutien',          color: '#4fd3a6' },
  afflictionSpells: { lbl: 'Afflictions',   color: '#c084fc' },
  controlSpells: { lbl: 'Contrôles',        color: '#7fb0ff' },
  kosDealt:   { lbl: 'KO infligés',         color: '#ef4444' },
  dmgTaken:   { lbl: 'Dégâts subis',        color: '#9aa0aa' },
  attacksTaken: { lbl: 'Attaques subies',   color: '#a7b4c4' },
  attacksAvoided: { lbl: 'Attaques évitées', color: '#7fb0ff' },
  rolls:      { lbl: 'Jets de compétence',  color: '#7fb0ff' },
};
const _statsMetricVal = (r, key) => key === 'rolls' ? r.sRolls : (r.combat[key] || 0);
const _STATS_AWARD_PREF_KEY = 'lgj.stats.hiddenAwards';
const _STATS_AWARD_CATALOG = [
  ['dmg', 'Plus gros frappeur'],
  ['bigHit', 'Plus gros coup'],
  ['hitRate', 'Meilleur taux'],
  ['ko', 'Bourreau'],
  ['heal', 'Plus grand soigneur'],
  ['mage', 'Lanceur le + actif'],
  ['tank', "L'Increvable"],
  ['parry', 'Le Rempart'],
  ['emotes', 'Le Bavard'],
  ['rolls', 'Le Joueur'],
  ['crit', 'Le plus critique'],
  ['luck', 'Insolente chance'],
  ['fumble', 'Le plus malchanceux'],
];

const _statsNum = (v) => Number(v) || 0;
const _statsEmoteSignature = (name) => sanitizeEmoteName(name).split('_').filter(Boolean).sort().join('_');
function _statsEmoteSources(url = '') {
  const remote = String(url || '');
  try {
    const path = new URL(remote, document.baseURI).pathname;
    const match = path.match(/\/(images\/emotes\/[^?#]+)$/i);
    if (!match) return { src: remote, fallback: '' };
    const local = new URL(match[1], document.baseURI).href;
    return local === remote ? { src: remote, fallback: '' } : { src: local, fallback: remote };
  } catch { return { src: remote, fallback: '' }; }
}
function _statsEmoteHtml(name, cls = 'stats-emote') {
  if (!name) return '—';
  const key = sanitizeEmoteName(name);
  const url = _statsEmoteUrl.get(key) || _statsEmoteUrl.get(`~${_statsEmoteSignature(key)}`);
  if (!url) return _esc(name);
  const source = _statsEmoteSources(url);
  return `<img class="${cls}" src="${_esc(source.src)}"${source.fallback ? ` data-stats-emote-fallback="${_esc(source.fallback)}"` : ''} alt="${_esc(name)}" title="${_esc(name)}">`;
}
function _statsFavoritesHtml(spells = [], emotes = []) {
  const normalize = (items) => (Array.isArray(items)
    ? items
    : Object.entries(items || {}).map(([n, c]) => ({ n, c: _statsNum(c) })))
    .filter(x => x?.n && _statsNum(x.c) > 0)
    .sort((a, b) => _statsNum(b.c) - _statsNum(a.c))
    .slice(0, 3);
  const spellTop = normalize(spells);
  const emoteTop = normalize(emotes);
  const group = (icon, title, items, render) => items.length ? `<section class="stats-favorite-group">
    <h4>${icon} ${title}</h4>
    <div class="stats-favorite-list">${items.map((item, i) => `<div class="stats-favorite-row">
      <span class="stats-favorite-rank">${i + 1}</span>
      <span class="stats-favorite-name">${render(item.n)}</span>
      <b>×${_statsNum(item.c)}</b>
    </div>`).join('')}</div>
  </section>` : '';
  const content = [
    group('⭐', 'Sorts favoris', spellTop, n => _esc(n)),
    group('😄', 'Émotes favorites', emoteTop, n => `<span class="stats-favorite-emote">${_statsEmoteHtml(n, 'stats-emote-sm')}<span>${_esc(n)}</span></span>`),
  ].filter(Boolean).join('');
  return content ? `<div class="stats-favorite-groups">${content}</div>` : '';
}
function _statsLoadAwardPrefs() {
  try {
    const saved = localStorage.getItem(_STATS_AWARD_PREF_KEY);
    const raw = saved == null ? ['mage', 'emotes', 'rolls'] : JSON.parse(saved);
    _statsHiddenAwards = new Set(Array.isArray(raw) ? raw : []);
  } catch { _statsHiddenAwards = new Set(['mage', 'emotes', 'rolls']); }
}
function _statsSaveAwardPrefs() {
  try { localStorage.setItem(_STATS_AWARD_PREF_KEY, JSON.stringify([..._statsHiddenAwards])); } catch {}
}

async function _adminRelinkPlayer(oldUid, newUid, name = '') {
  if (!STATE.adventure?.id || !oldUid || !newUid || oldUid === newUid) {
    showNotif('Aventure ou joueur introuvable.', 'error');
    return;
  }
  const ok = await confirmModal(
    `Réassocier automatiquement <b>${_esc(name || newUid)}</b> ?<br><br><span style="opacity:.8;font-size:.88em">Cette action transfère l'accès à l'aventure et les personnages de l'ancien compte détecté vers ce compte.</span>`,
    { title: 'Réassocier le joueur', confirmLabel: 'Réassocier', danger: false, icon: '🔗' }
  );
  if (!ok) return;
  try {
    const { migrated } = await relinkPlayerAccount(STATE.adventure.id, oldUid, newUid);
    showNotif(`Compte réassocié — ${migrated} personnage(s) transféré(s).`, 'success');
    await PAGES.admin();
  } catch (e) {
    showNotif(e.message || 'Échec de la réassociation.', 'error');
  }
}

// ── Fusion des comptes en double (MJ) ────────────────────────────────────────
// Le MJ choisit le compte à GARDER ; les autres UID (même email) sont fusionnés
// dedans : personnages transférés + retrait de l'aventure (relinkPlayerAccount)
// puis suppression de leur doc `users`. accountRelinks est posé → le fantôme ne
// peut plus se ré-inscrire (cf. auto-rattachement dans core/adventure.js).
let _mergeDupUids = [];
async function _adminMergeDuplicate(uidsCsv, email = '') {
  if (!STATE.adventure?.id) return;
  const uids = String(uidsCsv || '').split(',').map(s => s.trim()).filter(Boolean);
  if (uids.length < 2) { showNotif('Rien à fusionner.', 'info'); return; }
  _mergeDupUids = uids;

  const users = await loadAllUsers();
  const byId  = new Map(users.map(u => [u.id, u]));
  const chars = STATE.characters || [];
  const cc    = (uid) => chars.filter(c => c.uid === uid).length;
  const adv   = STATE.adventure;
  const memberUids = new Set([...(adv.admins || []), ...(adv.players || []), ...(adv.accessList || [])]);
  const label = (uid) => byId.get(uid)?.pseudo || byId.get(uid)?.email || `UID ${uid.slice(0, 6)}…`;
  // Survivant suggéré : le plus de personnages, puis un membre.
  const suggested = [...uids].sort((a, b) =>
    (cc(b) - cc(a)) || ((memberUids.has(b) ? 1 : 0) - (memberUids.has(a) ? 1 : 0)))[0];

  const rows = uids.map(uid => `
    <label style="display:flex;align-items:center;gap:.6rem;padding:.55rem .7rem;border:1px solid var(--border);border-radius:9px;margin-bottom:.4rem;cursor:pointer">
      <input type="radio" name="merge-survivor" value="${_esc(uid)}" ${uid === suggested ? 'checked' : ''}>
      <span style="flex:1;min-width:0">
        <b>${_esc(label(uid))}</b>
        <span style="font-size:.74rem;color:var(--text-dim)"> · ${cc(uid)} perso${cc(uid) > 1 ? 's' : ''}${memberUids.has(uid) ? ' · membre' : ''}${byId.has(uid) ? '' : ' · doc absent'}</span>
        <br><span style="font-size:.64rem;color:var(--text-dim);font-family:monospace">${_esc(uid)}</span>
      </span>
    </label>`).join('');

  openModal('🪪 Fusionner les comptes en double', `
    <p style="font-size:.84rem;line-height:1.5;margin-bottom:.7rem">
      Même email <b>${_esc(email)}</b>. Choisis le compte à <b>garder</b> — les autres sont fusionnés
      dedans : personnages transférés, comptes retirés de l'aventure puis supprimés. Irréversible.
    </p>
    ${rows}
    <div style="display:flex;gap:.5rem;margin-top:.9rem">
      <button class="btn btn-gold" style="flex:1" data-action="_adminMergeDuplicateConfirm">Fusionner</button>
      <button class="btn btn-outline btn-sm" data-action="_adminMergeDuplicateCancel">Annuler</button>
    </div>
  `, { subtitle: 'Nettoyage des comptes fantômes', accent: '#e8b84b' });
}

async function _adminMergeDuplicateConfirm() {
  const survivor = document.querySelector('input[name="merge-survivor"]:checked')?.value;
  if (!survivor || _mergeDupUids.length < 2) return;
  const ghosts = _mergeDupUids.filter(u => u !== survivor);
  closeModalDirect();
  try {
    let migrated = 0;
    for (const g of ghosts) {
      const r = await relinkPlayerAccount(STATE.adventure.id, g, survivor);
      migrated += r?.migrated || 0;
      try { await deleteFromCol('users', g); } catch (_) { /* doc déjà absent */ }
    }
    _mergeDupUids = [];
    showNotif(`Fusion effectuée — ${ghosts.length} compte(s) absorbé(s), ${migrated} perso(s) transféré(s).`, 'success');
    await PAGES.admin();
  } catch (e) {
    showNotif(e.message || 'Échec de la fusion.', 'error');
  }
}

async function _adminRepairQuestParticipants() {
  if (!STATE.isAdmin) return;
  const ok = await confirmModal(
    `Réparer les participants de quête quand c'est sûr ?<br><br><span style="opacity:.8;font-size:.88em">Remplace les anciens UID relinkés, recale les participants sur l'UID de leur personnage, retire les entrées sans compte/personnage exploitable et dédoublonne.</span>`,
    { title: 'Réparer les quêtes', confirmLabel: 'Réparer', danger: false, icon: '📌' }
  ).catch(() => false);
  if (!ok) return;

  const adv = STATE.adventure || {};
  const memberUids = new Set([...(adv.accessList || []), ...(adv.players || []), ...(adv.admins || [])]);
  const accountRelinks = adv.accountRelinks || {};
  const absorbedUids = new Set(Object.keys(accountRelinks));
  const charById = new Map((STATE.characters || []).map(c => [c.id, c]));
  const quests = getCachedCollection('quests') || await loadCollection('quests').catch(() => []);
  let fixed = 0;

  for (const q of quests || []) {
    const before = Array.isArray(q?.participants) ? q.participants : [];
    if (!q?.id || !before.length) continue;
    const normalized = [];
    for (const raw of before) {
      const p = raw || {};
      const char = p.charId ? charById.get(p.charId) : null;
      let uid = accountRelinks[p.uid] || p.uid || '';
      if (char?.uid) uid = char.uid;
      if (!uid || absorbedUids.has(uid) || !memberUids.has(uid)) continue;
      if (p.charId && !char) continue;
      normalized.push(char
        ? questParticipantFromChar(char, uid)
        : { ...p, uid, nom: p.nom || '?' });
    }
    const after = dedupeQuestParticipants(normalized);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    await saveDoc('quests', q.id, { participants: after });
    fixed++;
  }

  showNotif(fixed ? `${fixed} groupe(s) de quête réparé(s).` : 'Aucune quête à réparer.', fixed ? 'success' : 'info');
  await PAGES.admin();
}

async function _adminRepairVttData() {
  if (!STATE.isAdmin) return;
  const ok = await confirmModal(
    `Réparer les données VTT sûres ?<br><br><span style="opacity:.8;font-size:.88em">Resynchronise les propriétaires de tokens avec les personnages, retire les délégations vers des comptes invalides et supprime les doublons de tokens en réserve.</span>`,
    { title: 'Réparer le VTT', confirmLabel: 'Réparer', danger: false, icon: '🎲' }
  ).catch(() => false);
  if (!ok) return;

  const adv = STATE.adventure || {};
  const memberUids = new Set([...(adv.accessList || []), ...(adv.players || []), ...(adv.admins || [])]);
  const absorbedUids = new Set(Object.keys(adv.accountRelinks || {}));
  const charById = new Map((STATE.characters || []).map(c => [c.id, c]));
  const tokens = await loadCollection('vttTokens').catch(() => []);
  const reserveSeen = new Map();
  const toDelete = [];
  const updates = [];

  for (const t of tokens || []) {
    if (!t?.id) continue;
    const patch = {};
    if (t.characterId) {
      const char = charById.get(t.characterId);
      if (char && (t.ownerId || null) !== (char.uid || null)) patch.ownerId = char.uid || null;
    }
    if (Array.isArray(t.controlDelegates)) {
      const next = [...new Set(t.controlDelegates.filter(uid => uid && memberUids.has(uid) && !absorbedUids.has(uid)))];
      if (JSON.stringify(next) !== JSON.stringify(t.controlDelegates)) patch.controlDelegates = next;
    }
    const reserveKey = t.characterId ? `c:${t.characterId}` : t.npcId ? `n:${t.npcId}` : '';
    if (reserveKey && !t.pageId) {
      if (reserveSeen.has(reserveKey)) toDelete.push(t.id);
      else reserveSeen.set(reserveKey, t.id);
    }
    if (Object.keys(patch).length) updates.push({ id: t.id, patch });
  }

  await Promise.all([
    ...updates.map(x => updateInCol('vttTokens', x.id, x.patch)),
    ...toDelete.map(id => deleteFromCol('vttTokens', id)),
  ]);
  const total = updates.length + toDelete.length;
  showNotif(total ? `${total} correction(s) VTT appliquée(s).` : 'Aucune donnée VTT à réparer.', total ? 'success' : 'info');
  await PAGES.admin();
}

// ══════════════════════════════════════════════════════════════════════════════
// CONSOLE MJ v2 — contrôleur (3 onglets : À traiter · Joueurs · Réglages)
// Rendu + interactions séparés du calcul des données (admin() fournit le vm) :
// les changements d'UI (onglet, filtre, recherche, tri, dépli) re-rendent SANS
// relire Firestore ; seules les actions correctives relancent PAGES.admin().
// ══════════════════════════════════════════════════════════════════════════════
const _CMJ_TAB_KEY = 'admin-tab';
const _CMJ_SECTIONS = [
  { id: 'comptes', label: 'Comptes',            ic: 'users'   },
  { id: 'persos',  label: 'Personnages',        ic: 'user-x'  },
  { id: 'sorts',   label: 'Sorts à valider',    ic: 'sparkle', bulk: 'Tout valider' },
  { id: 'quetes',  label: 'Groupes de mission', ic: 'flag',    bulk: 'Réparer', auto: true },
  { id: 'vtt',     label: 'Table VTT',          ic: 'hex',     bulk: 'Réparer', auto: true },
];
const _cmjState = { tab: '', sec: 'all', cur: 0, open: new Set(), pq: '', pf: 'all', psort: 'pseudo', sq: '', refocus: null, vm: null };
let _cmjMounted = false;
const _CMJ_PALETTE = ['#e8b84b', '#4f8cff', '#f4c430', '#22c38e', '#9d6fff', '#ff9544', '#5bc0eb', '#ff5a7e'];

// Sprite d'icônes (traits 1,8) — ids préfixés cmj- pour éviter toute collision.
const _CMJ_SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
<symbol id="cmj-users" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></symbol>
<symbol id="cmj-user-x" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M17 8l5 5M22 8l-5 5"/></symbol>
<symbol id="cmj-sparkle" viewBox="0 0 24 24"><path d="M12 3l1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></symbol>
<symbol id="cmj-flag" viewBox="0 0 24 24"><path d="M4 22V4M4 4h12l-2 4 2 4H4"/></symbol>
<symbol id="cmj-hex" viewBox="0 0 24 24"><path d="M12 2l8.66 5v10L12 22l-8.66-5V7z"/><circle cx="12" cy="12" r="3"/></symbol>
<symbol id="cmj-inbox" viewBox="0 0 24 24"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></symbol>
<symbol id="cmj-check" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></symbol>
<symbol id="cmj-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></symbol>
<symbol id="cmj-right" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></symbol>
<symbol id="cmj-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></symbol>
<symbol id="cmj-wrench" viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></symbol>
<symbol id="cmj-sigma" viewBox="0 0 24 24"><path d="M18 7V4H6l6 8-6 8h12v-3"/></symbol>
<symbol id="cmj-bag" viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/></symbol>
<symbol id="cmj-shield" viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z"/></symbol>
<symbol id="cmj-sword" viewBox="0 0 24 24"><path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/></symbol>
<symbol id="cmj-swords" viewBox="0 0 24 24"><path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M9.5 17.5L21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4"/></symbol>
<symbol id="cmj-zap" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></symbol>
<symbol id="cmj-star" viewBox="0 0 24 24"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.7l5.8-.8z"/></symbol>
<symbol id="cmj-layers" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></symbol>
<symbol id="cmj-dice" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="16" cy="8" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><circle cx="8" cy="16" r=".9" fill="currentColor"/><circle cx="16" cy="16" r=".9" fill="currentColor"/></symbol>
<symbol id="cmj-drop" viewBox="0 0 24 24"><path d="M12 2.7l5.66 5.66a8 8 0 1 1-11.31 0z"/></symbol>
<symbol id="cmj-smile" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></symbol>
<symbol id="cmj-trophy" viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 5H4a2 2 0 0 0 0 4h3M17 5h3a2 2 0 0 1 0 4h-3"/></symbol>
<symbol id="cmj-skull" viewBox="0 0 24 24"><path d="M12 3a8 8 0 0 0-8 8c0 2.6 1.2 4.4 3 5.5V20h10v-3.5c1.8-1.1 3-2.9 3-5.5a8 8 0 0 0-8-8z"/><circle cx="9" cy="11" r="1.5"/><circle cx="15" cy="11" r="1.5"/><path d="M10 20v-2M14 20v-2"/></symbol>
</defs></svg>`;

const _cmjIc = (id, cls = '') => `<svg class="cmj-ic ${cls}" aria-hidden="true"><use href="#cmj-${id}"></use></svg>`;
const _cmjVisible = () => (_cmjState.vm?.items || []).filter(i => _cmjState.sec === 'all' || i.sec === _cmjState.sec);

// ── Validation de sort depuis la console (même logique que spells.js) ──
async function _adminValidateSpell(charId, idx) {
  if (!STATE.isAdmin) return;
  const c = (STATE.characters || []).find(x => x.id === charId); if (!c) return;
  const i = parseInt(idx); const sorts = (c.deck_sorts || []).map(s => ({ ...s }));
  if (!sorts[i]) return;
  sorts[i].mjValidation = 'ok'; sorts[i].mjValidated = true;
  delete sorts[i].mjReviewed;   // le MJ a tranché : plus de diff à montrer
  try {
    await saveDoc('characters', c.id, { deck_sorts: sorts });
    c.deck_sorts = sorts;
    showNotif(`« ${sorts[i].nom || 'Sort'} » validé.`, 'success');
  } catch (e) { notifySaveError(e); return; }
  await PAGES.admin();
}
async function _adminValidateAllSpells() {
  if (!STATE.isAdmin) return;
  const pending = (_cmjState.vm?.items || []).filter(i => i.sec === 'sorts');
  if (!pending.length) return;
  const byChar = new Map();
  pending.forEach(it => {
    const [, cid, idx] = it.id.split(':');
    if (!byChar.has(cid)) byChar.set(cid, new Set());
    byChar.get(cid).add(parseInt(idx));
  });
  let total = 0;
  for (const [cid, idxs] of byChar) {
    const c = (STATE.characters || []).find(x => x.id === cid); if (!c) continue;
    const sorts = (c.deck_sorts || []).map(s => ({ ...s }));
    idxs.forEach(i => { if (sorts[i]) { sorts[i].mjValidation = 'ok'; sorts[i].mjValidated = true; delete sorts[i].mjReviewed; total++; } });
    try { await saveDoc('characters', c.id, { deck_sorts: sorts }); c.deck_sorts = sorts; }
    catch (e) { notifySaveError(e); }
  }
  if (total) showNotif(`${total} sort${total > 1 ? 's validés' : ' validé'}.`, 'success');
  await PAGES.admin();
}

// ── Rendu ──
function _cmjOpen(vm) {
  _cmjState.vm = vm;
  const routeTab = getRouteSub('admin');
  if (['todo', 'players', 'settings'].includes(routeTab)) {
    _cmjState.tab = routeTab;
  } else if (!_cmjState.tab) {
    const stored = (() => { try { return localStorage.getItem(_CMJ_TAB_KEY) || ''; } catch { return ''; } })();
    _cmjState.tab = ['todo', 'players', 'settings'].includes(stored) ? stored : (vm.items.length ? 'todo' : 'settings');
  }
  if (_cmjState.tab === 'todo' && !vm.items.length) _cmjState.tab = 'settings';
  if (routeTab !== _cmjState.tab) setRouteSub('admin', _cmjState.tab, { replace: true });
  if (_cmjState.cur >= _cmjVisible().length) _cmjState.cur = Math.max(0, _cmjVisible().length - 1);
  _cmjRender();
  _cmjMount();
}
function _cmjSetTab(id, { syncRoute = true } = {}) {
  if (!['todo', 'players', 'settings'].includes(id)) return;
  _cmjState.tab = id; try { localStorage.setItem(_CMJ_TAB_KEY, id); } catch {}
  if (syncRoute) setRouteSub('admin', id);
  _cmjState.refocus = null; _cmjRender(); window.scrollTo(0, 0);
}
function _cmjRender() {
  const root = document.getElementById('main-content'); if (!root) return;
  const vm = _cmjState.vm || { items: [], players: [], settings: [] };
  const n = vm.items.length;
  const tabs = [
    { id: 'todo', l: 'À traiter', badge: n, hot: n > 0 },
    { id: 'players', l: 'Joueurs', badge: vm.players.length },
    { id: 'settings', l: 'Réglages' },
  ];
  const tabsHtml = tabs.map((t, i) => `<button type="button" role="tab" class="cmj-tab${_cmjState.tab === t.id ? ' on' : ''}" data-cmj-tab="${t.id}" data-nav-page="admin" data-nav-sub="${t.id}" aria-selected="${_cmjState.tab === t.id}" title="${t.l} (${i + 1})">${_esc(t.l)}${t.badge != null ? `<span class="cmj-n${t.hot ? ' hot' : ''}">${t.badge}</span>` : ''}</button>`).join('');
  const view = _cmjState.tab === 'players' ? _cmjRenderPlayers() : _cmjState.tab === 'settings' ? _cmjRenderSettings() : _cmjRenderTodo();
  root.innerHTML = `<div class="cmj">${_CMJ_SPRITE}
    <div class="cmj-head">
      <div class="cmj-brand"><h1>Console MJ</h1><small>${_esc(vm.adventure || 'Aventure')} · ${vm.players.length} membre${vm.players.length > 1 ? 's' : ''}</small></div>
      <div class="cmj-tabs" role="tablist">${tabsHtml}</div>
    </div>
    <div class="cmj-body">${view}</div>
  </div>`;
  _cmjAfterRender();
}
function _cmjRow(i) {
  const idx = _cmjVisible().indexOf(i);
  const sp = i.spell;
  const tag = i.tone === 'danger' ? '<span class="cmj-pill red">Bloquant</span>' : '';
  const pri = i.act === 'Valider' ? 'cmj-btn ok' : (i.auto || /Ouvrir|Créer/.test(i.act)) ? 'cmj-btn gh' : 'cmj-btn pri';
  return `<div class="cmj-row${_cmjState.open.has(i.id) ? ' open' : ''}${idx === _cmjState.cur ? ' cur' : ''}" data-id="${_esc(i.id)}">
    <div class="cmj-rw" tabindex="-1" data-cmj-idx="${idx}"><span class="cmj-mk ${i.tone}" aria-hidden="true"></span>
      <div class="cmj-rt"><b>${_esc(i.title)}${i.who ? `<span class="cmj-who">${_esc(i.who)}</span>` : ''}${tag}</b><small>${sp ? `${_esc(sp.cout)} · ${_esc(sp.portee)}` : _esc(i.detail || '')}</small></div>
      <div class="cmj-ra">${sp ? `<button type="button" class="cmj-btn gh" ${i.secondary || ''}>${_esc(i.secondaryLabel || 'Ouvrir la fiche')}</button>` : ''}<button type="button" class="${pri}" ${i.attrs || ''}>${i.act === 'Valider' ? _cmjIc('check') : ''}${_esc(i.act)}</button>${sp ? `<button type="button" class="cmj-exp" data-cmj-exp="${_esc(i.id)}" aria-label="Détail du sort" aria-expanded="${_cmjState.open.has(i.id)}">${_cmjIc('chev')}</button>` : ''}</div>
    </div>
    ${sp ? `<div class="cmj-spell"><div><div class="cmj-facts"><span>Coût <b>${_esc(sp.cout)}</b></span><span>Portée <b>${_esc(sp.portee)}</b></span></div>${sp.effet ? `<p>${_esc(sp.effet)}</p>` : '<p class="cmj-dim">Pas de description.</p>'}${sp.runes.length ? `<div class="cmj-runes">${sp.runes.map(r => `<span>${_esc(r)}</span>`).join('')}</div>` : ''}</div></div>` : ''}
  </div>`;
}
function _cmjRenderTodo() {
  const vm = _cmjState.vm;
  if (!vm.items.length) return `<div class="cmj-empty"><span class="cmj-ok">${_cmjIc('check')}</span><h3>Rien à traiter</h3><p>Comptes, personnages, sorts, groupes et tokens sont alignés. Les nouveaux points apparaîtront ici.</p></div>`;
  const count = s => vm.items.filter(i => i.sec === s).length;
  const autos = vm.items.filter(i => i.auto);
  const autoOps = new Set(autos.map(i => i.attrs)).size;
  const nav = [{ id: 'all', label: 'Tout', ic: 'inbox' }, ..._CMJ_SECTIONS].map(s => {
    const c = s.id === 'all' ? vm.items.length : count(s.id);
    return `<button type="button" class="cmj-nv${_cmjState.sec === s.id ? ' on' : ''}${c ? '' : ' zero'}" data-cmj-sec="${s.id}">${_cmjIc(s.ic)}<span>${_esc(s.label)}</span><b>${c}</b></button>`;
  }).join('');
  const vis = _cmjVisible();
  if (_cmjState.cur >= vis.length) _cmjState.cur = Math.max(0, vis.length - 1);
  const secs = _CMJ_SECTIONS.filter(s => _cmjState.sec === 'all' || _cmjState.sec === s.id).map(s => {
    const rows = vis.filter(i => i.sec === s.id);
    if (!rows.length) return '';
    const bulk = s.bulk && rows.length > 1 ? `<button type="button" class="cmj-btn gh" data-cmj-bulk="${s.id}">${_cmjIc(s.id === 'sorts' ? 'check' : 'wrench')}${_esc(s.bulk)} (${rows.length})</button>` : '';
    return `<section class="cmj-sec"><div class="cmj-sh">${_cmjIc(s.ic)}<h3>${_esc(s.label)}</h3><span class="cmj-c">${rows.length}</span><span class="cmj-sp"></span>${s.auto ? '<span class="cmj-tagauto">Réparable automatiquement</span>' : ''}${bulk}</div><div class="cmj-rows">${rows.map(_cmjRow).join('')}</div></section>`;
  }).join('');
  return `<div class="cmj-inbox">
    <aside class="cmj-side"><nav class="cmj-nav" aria-label="Filtrer par sujet">${nav}</nav>
      ${autos.length ? `<div class="cmj-auto"><span class="cmj-lbl">Correction automatique</span><p><b>${autos.length} point${autos.length > 1 ? 's' : ''}</b> se corrigent sans décision de ta part : participants de groupes et tokens VTT.</p><button type="button" class="cmj-btn pri" data-cmj-autoall>${_cmjIc('wrench')}Tout réparer</button></div>` : ''}
      <div class="cmj-keys"><span><kbd>↑</kbd><kbd>↓</kbd> naviguer</span><span><kbd>Entrée</kbd> action</span><span><kbd>Espace</kbd> détail du sort</span></div>
    </aside>
    <div><div class="cmj-ihead"><h2>${vm.items.length} point${vm.items.length > 1 ? 's' : ''} à traiter</h2><small>${autos.length ? `dont ${autos.length} réparable${autos.length > 1 ? 's' : ''} en ${autoOps} opération${autoOps > 1 ? 's' : ''}` : 'chacun demande une décision'}</small></div>${secs}</div>
  </div>`;
}
function _cmjRenderPlayers() {
  const vm = _cmjState.vm;
  const issues = vm.players.filter(p => p.issue).length;
  const q = _cmjState.pq.trim().toLowerCase();
  let list = vm.players.filter(p => (_cmjState.pf === 'all' || p.issue) && (!q || [p.pseudo, p.email, ...p.chars].join(' ').toLowerCase().includes(q)));
  const k = _cmjState.psort;
  list = list.slice().sort((a, b) => k === 'since' ? String(b.since).localeCompare(String(a.since)) : k === 'role' ? (a.role === 'mj' ? -1 : b.role === 'mj' ? 1 : a.pseudo.localeCompare(b.pseudo, 'fr')) : a.pseudo.localeCompare(b.pseudo, 'fr'));
  const hb = (id, l) => `<button type="button" data-cmj-psort="${id}" class="${k === id ? 'on' : ''}">${_esc(l)}${k === id ? ' ↓' : ''}</button>`;
  const prow = p => {
    const live = p.issue && vm.items.some(i => i.id === p.issueItem);
    const avatar = p.avatar
      ? `<img src="${_esc(p.avatar)}" alt="" loading="lazy" decoding="async">`
      : _esc((p.pseudo[0] || '?').toUpperCase());
    return `<div class="cmj-pr"><div class="cmj-pl"><span class="cmj-av" style="--c:${p.color}">${avatar}</span><div><b>${_esc(p.pseudo)}</b><small>${_esc(p.email || '')}</small></div></div>
      <span class="cmj-rl">${p.role === 'mj' ? '<span class="cmj-pill blu">MJ</span>' : '<span class="cmj-dt">Joueur</span>'}</span>
      <div class="cmj-chars">${p.chars.length ? p.chars.map(c => `<span>${_esc(c)}</span>`).join('') : `<em>${p.role === 'mj' ? '—' : 'Aucun'}</em>`}</div>
      <span class="cmj-dt">${_esc(p.sinceLabel || '—')}</span>
      <span class="cmj-st">${p.issue ? (live ? `<button type="button" class="cmj-pill ${p.issueTone}" data-cmj-goto="${p.issueItem}" title="Voir dans À traiter">${_esc(p.issueLabel)} →</button>` : `<span class="cmj-pill ${p.issueTone}">${_esc(p.issueLabel)}</span>`) : ''}</span>
      <div class="cmj-pa">${p.issue && p.issueAct && live ? `<button type="button" class="cmj-btn gh" ${p.issueAttrs}>${_esc(p.issueAct)}</button>` : ''}</div></div>`;
  };
  return `<div class="cmj-tool"><label class="cmj-search">${_cmjIc('search')}<input type="search" id="cmj-pq" placeholder="Pseudo, e-mail ou personnage…" value="${_esc(_cmjState.pq)}" aria-label="Rechercher un joueur"><kbd>/</kbd></label><span class="cmj-sp"></span>
    <div class="cmj-seg" role="group" aria-label="Filtre"><button type="button" data-cmj-pf="all" class="${_cmjState.pf === 'all' ? 'on' : ''}">Tous <em>${vm.players.length}</em></button><button type="button" data-cmj-pf="issue" class="${_cmjState.pf === 'issue' ? 'on' : ''}">À vérifier <em>${issues}</em></button></div></div>
    <div class="cmj-ptab"><div class="cmj-pr hd">${hb('pseudo', 'Joueur')}${hb('role', 'Rôle')}<span>Personnages</span>${hb('since', 'Inscription')}<span>État</span><span></span></div>
    ${list.length ? list.map(prow).join('') : `<div class="cmj-nores">Aucun joueur ne correspond.</div>`}</div>`;
}
function _cmjRenderSettings() {
  const vm = _cmjState.vm;
  const q = _cmjState.sq.trim().toLowerCase();
  const hl = s => { const e = _esc(s); if (!q) return e; const i = s.toLowerCase().indexOf(q); return i < 0 ? e : _esc(s.slice(0, i)) + '<mark>' + _esc(s.slice(i, i + q.length)) + '</mark>' + _esc(s.slice(i + q.length)); };
  const groups = vm.settings.map(g => ({ ...g, items: g.items.filter(x => !q || (x.t + ' ' + x.s + ' ' + g.label).toLowerCase().includes(q)) })).filter(g => g.items.length);
  return `<div class="cmj-tool"><label class="cmj-search">${_cmjIc('search')}<input type="search" id="cmj-sq" placeholder="Rechercher un réglage…" value="${_esc(_cmjState.sq)}" aria-label="Rechercher un réglage"><kbd>/</kbd></label></div>
    ${groups.length ? `<div class="cmj-sgrid">${groups.map(g => `<section class="cmj-grp"><h3 class="cmj-lbl">${_esc(g.label)}</h3><div class="cmj-list">${g.items.map(x => `<button type="button" class="cmj-strow" data-action="_adminLazyOpen" data-fn="${_esc(x.fn)}" data-module="${_esc(x.mod)}"><span class="cmj-sic" style="--a:${x.a}">${_cmjIc(x.ic)}</span><span class="cmj-strow-txt"><b>${hl(x.t)}</b><small>${hl(x.s)}</small></span>${_cmjIc('right', 'go')}</button>`).join('')}</div></section>`).join('')}</div>`
      : `<div class="cmj-empty"><h3>Aucun réglage trouvé</h3><p>Essaie « dégâts », « runes » ou « émotes ».</p></div>`}`;
}
function _cmjAfterRender() {
  if (_cmjState.refocus) {
    const el = document.getElementById(_cmjState.refocus);
    if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch {} }
    _cmjState.refocus = null;
  }
}
function _cmjMoveCur(d) {
  const vis = _cmjVisible(); if (!vis.length) return;
  _cmjState.cur = Math.max(0, Math.min(vis.length - 1, _cmjState.cur + d));
  document.querySelectorAll('.cmj-row.cur').forEach(r => r.classList.remove('cur'));
  const el = document.querySelector(`.cmj-rw[data-cmj-idx="${_cmjState.cur}"]`);
  if (el) { el.parentElement.classList.add('cur'); el.focus(); const r = el.getBoundingClientRect(); if (r.top < 100 || r.bottom > innerHeight - 20) window.scrollBy({ top: r.top - innerHeight / 2, behavior: 'smooth' }); }
}
function _cmjToggle(id) {
  _cmjState.open.has(id) ? _cmjState.open.delete(id) : _cmjState.open.add(id);
  const r = document.querySelector(`.cmj-row[data-id="${CSS.escape(id)}"]`);
  if (r) { r.classList.toggle('open', _cmjState.open.has(id)); r.querySelector('.cmj-exp')?.setAttribute('aria-expanded', _cmjState.open.has(id)); }
}
// Déclenche l'action principale de la ligne courante (dernier bouton d'action,
// hors chevron) — réutilise le câblage du bouton (registre data-action ou nav).
function _cmjActivateCur() {
  const cur = _cmjVisible()[_cmjState.cur]; if (!cur) return;
  const row = document.querySelector(`.cmj-row[data-id="${CSS.escape(cur.id)}"]`); if (!row) return;
  const btns = row.querySelectorAll('.cmj-ra .cmj-btn');
  btns[btns.length - 1]?.click();
}
async function _cmjRepairAll() {
  try { await _adminRepairQuestParticipants(); } catch (e) { console.error('[cmj] repair quests', e); }
  try { await _adminRepairVttData(); } catch (e) { console.error('[cmj] repair vtt', e); }
}
function _cmjMount() {
  if (_cmjMounted) return; _cmjMounted = true;
  document.addEventListener('click', e => {
    if (!document.querySelector('.cmj')) return;
    const t = e.target.closest('[data-cmj-tab],[data-cmj-sec],[data-cmj-exp],[data-cmj-bulk],[data-cmj-autoall],[data-cmj-pf],[data-cmj-psort],[data-cmj-goto],.cmj-rw');
    if (!t) return;
    if ((e.ctrlKey || e.metaKey) && t.matches('[data-nav-sub]')) return;
    if (t.dataset.cmjTab) return _cmjSetTab(t.dataset.cmjTab);
    if (t.dataset.cmjSec) { _cmjState.sec = t.dataset.cmjSec; _cmjState.cur = 0; return _cmjRender(); }
    if (t.dataset.cmjExp) return _cmjToggle(t.dataset.cmjExp);
    if (t.dataset.cmjBulk) { const s = t.dataset.cmjBulk; return s === 'sorts' ? _adminValidateAllSpells() : s === 'quetes' ? _adminRepairQuestParticipants() : _adminRepairVttData(); }
    if (t.hasAttribute('data-cmj-autoall')) { return _cmjRepairAll(); }
    if (t.dataset.cmjPf) { _cmjState.pf = t.dataset.cmjPf; return _cmjRender(); }
    if (t.dataset.cmjPsort) { _cmjState.psort = t.dataset.cmjPsort; return _cmjRender(); }
    if (t.dataset.cmjGoto) { _cmjState.sec = 'all'; _cmjState.tab = 'todo'; try { localStorage.setItem(_CMJ_TAB_KEY, 'todo'); } catch {} setRouteSub('admin', 'todo'); _cmjState.cur = _cmjVisible().findIndex(i => i.id === t.dataset.cmjGoto); _cmjRender(); const r = document.querySelector(`.cmj-row[data-id="${CSS.escape(t.dataset.cmjGoto)}"]`); if (r) { r.classList.add('flash'); r.querySelector('.cmj-rw')?.focus({ preventScroll: false }); } return; }
    if (t.classList.contains('cmj-rw') && !e.target.closest('button')) { _cmjState.cur = +t.dataset.cmjIdx; _cmjMoveCur(0); const id = t.parentElement.dataset.id; if (_cmjVisible().find(i => i.id === id)?.spell) _cmjToggle(id); }
  });
  document.addEventListener('input', e => {
    if (!document.querySelector('.cmj')) return;
    if (e.target.id === 'cmj-pq') { _cmjState.pq = e.target.value; _cmjState.refocus = 'cmj-pq'; _cmjRender(); }
    if (e.target.id === 'cmj-sq') { _cmjState.sq = e.target.value; _cmjState.refocus = 'cmj-sq'; _cmjRender(); }
  });
  document.addEventListener('keydown', e => {
    if (!document.querySelector('.cmj')) return;
    const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
    if (typing) { if (e.key === 'Escape') document.activeElement.blur(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (['1', '2', '3'].includes(e.key)) return _cmjSetTab(['todo', 'players', 'settings'][+e.key - 1]);
    if (e.key === '/') { const i = document.getElementById('cmj-pq') || document.getElementById('cmj-sq'); if (_cmjState.tab !== 'todo' && i) { e.preventDefault(); i.focus(); } return; }
    if (_cmjState.tab !== 'todo') return;
    const vis = _cmjVisible(); const cur = vis[_cmjState.cur];
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); _cmjMoveCur(1); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); _cmjMoveCur(-1); }
    else if (e.key === 'Enter' && cur && !e.target.closest('button')) { e.preventDefault(); _cmjActivateCur(); }
    else if (e.key === ' ' && cur?.spell && !e.target.closest('button')) { e.preventDefault(); _cmjToggle(cur.id); }
  });
}

function _statsNormCombat(cm = {}) {
  const n = _statsNum;
  return {
    attacks: n(cm.attacks), hits: n(cm.hits), crits: n(cm.crits), fumbles: n(cm.fumbles),
    attackRolls: n(cm.attackRolls), attackRollTotal: n(cm.attackRollTotal),
    attackResultRolls: n(cm.attackResultRolls), attackResultTotal: n(cm.attackResultTotal),
    dmgDealt: n(cm.dmgDealt), dmgTaken: n(cm.dmgTaken), kosDealt: n(cm.kosDealt), kosTaken: n(cm.kosTaken),
    damageEvents: n(cm.damageEvents), damageTotal: n(cm.damageTotal),
    damageTakenEvents: n(cm.damageTakenEvents), damageTakenTotal: n(cm.damageTakenTotal),
    damageTakenCorrection: n(cm.damageTakenCorrection), damageDealtCorrection: n(cm.damageDealtCorrection),
    attacksTaken: n(cm.attacksTaken), attacksAvoided: n(cm.attacksAvoided),
    spellsCast: n(cm.spellsCast), tacticalSpells: n(cm.tacticalSpells), supportSpells: n(cm.supportSpells), afflictionSpells: n(cm.afflictionSpells), controlSpells: n(cm.controlSpells),
    pmSpent: n(cm.pmSpent), heal: n(cm.heal), manaHealed: n(cm.manaHealed),
    supplementalRolls: n(cm.supplementalRolls), supplementalNaturalTotal: n(cm.supplementalNaturalTotal),
    supplementalResultRolls: n(cm.supplementalResultRolls), supplementalResultTotal: n(cm.supplementalResultTotal),
    supplementalCrits: n(cm.supplementalCrits), supplementalFumbles: n(cm.supplementalFumbles),
    biggestHit: n(cm.biggestHit), biggestTaken: n(cm.biggestTaken),
  };
}
const _statsFmtDate = (sessionKey) => {
  const date = _statsDateOf(sessionKey);
  if (!date) return 'Date inconnue';
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
};

// Jauge circulaire (donut) — pct 0-100 + couleur d'accent. Optionnellement un
// sous-label. Utilisée pour le taux de réussite (héro + carte perso).
function _statsGauge(pct, color = '#22c38e', size = 92, stroke = 9, sub = '') {
  const r = size / 2 - stroke, cx = size / 2;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - Math.max(0, Math.min(100, _statsNum(pct))) / 100);
  const big = Math.round(size * 0.24);
  return `<svg class="stats-gauge" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${stroke}"/>
    <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${cx} ${cx})"/>
    <text x="${cx}" y="${sub ? cx - big * 0.28 : cx}" text-anchor="middle" dominant-baseline="central"
      class="stats-gauge-val" style="font-size:${big}px">${_statsNum(pct)}%</text>
    ${sub ? `<text x="${cx}" y="${cx + big * 0.62}" text-anchor="middle" dominant-baseline="central" class="stats-gauge-sub" style="font-size:${Math.round(size * 0.1)}px">${sub}</text>` : ''}
  </svg>`;
}

// Mini-histogramme du handoff : une barre par séance, sans dépendance graphique.
function _statsMiniBars(vals) {
  if (!Array.isArray(vals) || vals.length < 2) return '<span class="stats-kpi-mini" aria-hidden="true"></span>';
  const max = Math.max(...vals, 1);
  return `<span class="stats-kpi-mini" aria-hidden="true">${vals.map(value => `<i style="height:${Math.max(6, Number(value || 0) / max * 100)}%"></i>`).join('')}</span>`;
}

// Sélecteur de métrique (comparatif / évolution) — data-change → re-render.
function _statsMetricSelect(cur, action) {
  return `<select class="stats-chart-sel" data-change="${action}">
    ${Object.entries(_STATS_METRICS).map(([k, m]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${m.lbl}</option>`).join('')}</select>`;
}

// Graphique en barres horizontales : compare les personnages (portrait + nom).
function _statsBarChart(rows, key) {
  const m = _STATS_METRICS[key] || _STATS_METRICS.dmgDealt;
  const data = rows.map(r => ({ id: r.id, name: r.name, v: _statsMetricVal(r, key) }))
    .filter(d => d.v > 0).sort((a, b) => b.v - a.v).slice(0, 12);
  if (!data.length) return `<div class="stats-chart-empty">Aucune donnée pour « ${m.lbl} ».</div>`;
  const max = Math.max(...data.map(d => d.v));
  return `<div class="stats-bars">${data.map(d => `
    <div class="stats-bar-row">
      <span class="stats-bar-name" title="${_esc(d.name)}">${_statsAvatar(d.id, d.name, 18)}<span>${_esc(d.name)}</span></span>
      <span class="stats-bar-track"><span style="width:${Math.max(3, Math.round(d.v / max * 100))}%;background:${m.color}"></span></span>
      <span class="stats-bar-val" style="color:${m.color}">${d.v}</span>
    </div>`).join('')}</div>`;
}
function _statsGroupMetricChart(groups, key) {
  const m = _STATS_METRICS[key] || _STATS_METRICS.dmgDealt;
  const val = (g) => key === 'rolls' ? g.skills.rolls : (g.combat[key] || 0);
  const data = groups.map(g => ({
    name: g.label,
    total: val(g),
    v: Math.round(val(g) / Math.max(1, g.count)),
    count: g.count,
    totalSessions: g.totalSessions || g.count,
  })).filter(d => d.total > 0).sort((a, b) => b.v - a.v);
  if (!data.length) return `<div class="stats-chart-empty">Aucune donnée comparable pour « ${m.lbl} ».</div>`;
  const max = Math.max(...data.map(d => d.v));
  return `<div class="stats-bars stats-bars-groups">${data.map(d => `
    <div class="stats-bar-row stats-bar-row-group">
      <span class="stats-bar-name stats-bar-name-group" title="${_esc(d.name)} · ${d.total} au total"><span>${_esc(d.name)}</span><small>${d.count} séance${d.count > 1 ? 's' : ''} suivie${d.count > 1 ? 's' : ''}${d.totalSessions > d.count ? ` sur ${d.totalSessions}` : ''}</small></span>
      <span class="stats-bar-track"><span style="width:${Math.max(3, Math.round(d.v / max * 100))}%;background:${m.color}"></span></span>
      <span class="stats-bar-val stats-bar-val-avg" style="color:${m.color}" title="${d.total} au total">${d.v}<small>/ séance</small></span>
    </div>`).join('')}</div>`;
}

// Camembert (donut SVG + légende) : répartition d'une métrique entre persos.
// Anneau à segments arrondis espacés (padAngle), total au centre, ombre douce.
function _statsPieChart(rows, key) {
  const m = _STATS_METRICS[key] || _STATS_METRICS.dmgDealt;
  let data = rows.map(r => ({ id: r.id, name: r.name, v: _statsMetricVal(r, key) }))
    .filter(d => d.v > 0).sort((a, b) => b.v - a.v);
  if (!data.length) return `<div class="stats-chart-empty">Aucune donnée pour « ${m.lbl} ».</div>`;
  const total = data.reduce((s, d) => s + d.v, 0);
  if (data.length > 7) { const rest = data.slice(6); data = data.slice(0, 6).concat([{ name: 'Autres', v: rest.reduce((s, d) => s + d.v, 0) }]); }
  const palette = ['#a78bfa', '#ff9d7a', '#22c38e', '#4f8cff', '#f4c430', '#ef4444', '#5fd0c8'];
  const cx = 60, cy = 60, R = 46, TW = 16, GAP = 0.09;   // ring radius / épaisseur / espace
  let ang = -Math.PI / 2;
  const arcs = data.map((s, i) => {
    const frac = s.v / total, sweep = frac * 2 * Math.PI;
    const a1 = ang, a2 = ang + sweep; ang = a2;
    const g = Math.min(GAP, sweep * 0.5);
    const b1 = a1 + g / 2, b2 = a2 - g / 2;
    const x1 = cx + R * Math.cos(b1), y1 = cy + R * Math.sin(b1), x2 = cx + R * Math.cos(b2), y2 = cy + R * Math.sin(b2);
    const large = (b2 - b1) > Math.PI ? 1 : 0;
    const col = palette[i % palette.length];
    const seg = frac >= 0.999
      ? `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${col}" stroke-width="${TW}"/>`
      : `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${R} ${R} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${TW}" stroke-linecap="round"/>`;
    return { seg, col, s, pct: Math.round(frac * 100) };
  });
  const firstWord = (m.lbl || '').split(' ')[0];
  const svg = `<svg viewBox="0 0 120 120" class="stats-pie-svg" role="img">
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--bg-dark)" stroke-width="${TW}"/>
    ${arcs.map(a => `<g class="stats-pie-seg"><title>${_esc(a.s.name)} · ${a.s.v} (${a.pct}%)</title>${a.seg}</g>`).join('')}
    <text x="${cx}" y="${cy - 5}" text-anchor="middle" dominant-baseline="central" class="stats-pie-total">${total}</text>
    <text x="${cx}" y="${cy + 11}" text-anchor="middle" dominant-baseline="central" class="stats-pie-sub">${_esc(firstWord)}</text>
  </svg>`;
  const legend = `<div class="stats-pie-legend">${arcs.map(a => `<div class="stats-pie-li"><span class="stats-pie-dot" style="background:${a.col}"></span>${a.s.id ? _statsAvatar(a.s.id, a.s.name, 18) : '<span class="stats-pie-avatar-fallback">+</span>'}<span class="stats-pie-nm" title="${_esc(a.s.name)}">${_esc(a.s.name)}</span><span class="stats-pie-vl">${a.pct}%</span></div>`).join('')}</div>`;
  return `<div class="stats-pie">${svg}${legend}</div>`;
}

// Somme les miroirs byDate d'un perso sur un ensemble de dates → même forme
// que le total campagne (combat/skills/spells/emotes).
function _statsSumByDates(c, dates) {
  const acc = {};
  for (const dk of dates) {
    const bd = _statsSessionBucket(c, dk); if (!bd) continue;
    for (const [grp, obj] of Object.entries(bd)) {
      if (!obj || typeof obj !== 'object') continue;
      const a = (acc[grp] ??= {});
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'number') {
          a[k] = grp === 'combat' && (k === 'biggestHit' || k === 'biggestTaken')
            ? Math.max(a[k] || 0, v)
            : (a[k] || 0) + v;
        }
        else if (v && typeof v === 'object') {
          const a2 = (a[k] ??= {});
          for (const [k2, v2] of Object.entries(v)) if (typeof v2 === 'number') {
            a2[k2] = grp === 'combat' && (k2 === 'biggestHit' || k2 === 'biggestTaken')
              ? Math.max(a2[k2] || 0, v2)
              : (a2[k2] || 0) + v2;
          }
        }
      }
    }
  }
  return acc;
}

// Construit les lignes/cartes de stats pour un scope. `dateKeys` : null = campagne
// (totaux) ; sinon tableau de dates → somme des séances (une ou une mission entière).
function _statsRowsFor(dateKeys, { includeHidden = false } = {}) {
  const num = _statsNum;
  const detailKey = dateKeys ? [...dateKeys].sort().join('|') : '*';
  if (_statsRowsCache.has(detailKey)) return _statsFilterHidden(_statsRowsCache.get(detailKey), includeHidden);
  let vttDetails = _statsVttDetailCache.get(detailKey);
  if (!vttDetails && _statsLegacyRollups) {
    const sources = dateKeys
      ? dateKeys.map(key => _statsLegacyRollups[key]).filter(Boolean)
      : [_statsLegacyRollups['*']].filter(Boolean);
    vttDetails = sources.length ? mergeVttRollDetails(sources) : { byCharacter: {}, relevantLogs: 0 };
    _statsVttDetailCache.set(detailKey, vttDetails);
  }
  if (!vttDetails) {
    const names = new Map();
    const addName = (name, charId) => {
      const key = _norm(name || '');
      if (!key) return;
      names.set(key, names.has(key) ? '' : charId);
    };
    for (const [charId, char] of Object.entries(_statsData?.chars || {})) {
      addName(char?.name, charId);
      const live = _statsCharacterById(charId);
      addName(live?.nom || live?.name, charId);
    }
    const resolveCharacterId = (log, kind) => {
      const direct = kind === 'attack' ? log?.sourceCharacterId : log?.characterId;
      if (direct && _statsData?.chars?.[direct]) return direct;
      const deltaIds = Object.keys(log?.statsDelta?.chars || {}).filter(charId => _statsData?.chars?.[charId]);
      if (deltaIds.length === 1) return deltaIds[0];
      // Un PNJ ou une créature homonyme ne doit jamais donner ses actions à un
      // personnage. Les invocations restent attribuables via statsDelta ci-dessus.
      if (kind === 'attack' && (log?.sourceNpcId || log?.sourceBeastId)) return '';
      const name = kind === 'attack'
        ? (log?.attackerName || log?.casterName || log?.characterName)
        : (log?.characterName || log?.charName);
      return names.get(_norm(name || '')) || '';
    };
    const hasManualCombatCorrection = (charId, date, kind) => {
      const combat = _statsSessionBucket(_statsData?.chars?.[charId], date)?.combat || {};
      return _statsNum(kind === 'taken' ? combat.manualDamageTaken : combat.manualDamageDealt) > 0;
    };
    const isCharacterLogExcluded = (charId, date, log) => {
      const charStats = _statsData?.chars?.[charId] || {};
      const recordedDates = [...Object.keys(charStats.byDate || {}), ...Object.keys(charStats.bySession || {})];
      // En vue campagne, ne jamais ressusciter depuis le journal des essais VTT,
      // séances supprimées ou anciennes données absentes des stats du personnage.
      // Les personnages vraiment legacy (aucun byDate) gardent le repli complet.
      if (!dateKeys && recordedDates.length && !_statsSessionBucket(charStats, date)) return true;
      const cutoff = _statsNum(charStats.vttLogCutoffs?.[date]);
      const logTime = vttLogTimeMs(log?.createdAt);
      return cutoff > 0 && logTime != null && logTime <= cutoff;
    };
    vttDetails = aggregateVttRollDetails(_statsVttLogs, {
      dateKeys,
      resolveCharacterId,
      hasManualCombatCorrection,
      isCharacterLogExcluded,
    });
    _statsVttDetailCache.set(detailKey, vttDetails);
  }
  const rows = Object.entries(_statsData?.chars || {}).map(([id, c]) => {
    const src = dateKeys ? _statsSumByDates(c, dateKeys) : c;   // même forme : combat/skills/spells/emotes
    const skills = src.skills || {};
    const logDetails = vttDetails.byCharacter[id] || {};
    const skillNames = new Set([...Object.keys(skills), ...Object.keys(logDetails.skills || {})]);
    const perSkill = [...skillNames].map(sk => {
      const v = mergeTrackedSkillStats(skills[sk] || {}, logDetails.skills?.[sk] || {});
      return normalizeSkillStats(sk, v);
    }).sort((a, b) => b.rolls - a.rolls);
    const combat = _statsNormCombat(mergeTrackedCombatStats(src.combat || {}, logDetails.combat || {}));
    const loggedCombat = logDetails.combat || {};
    const spells = Object.entries(src.spells || {}).map(([n, v]) => ({ n, c: num(v) })).sort((a, b) => b.c - a.c);
    const emotes = Object.entries(src.emotes || {}).map(([n, v]) => ({ n, c: num(v) })).sort((a, b) => b.c - a.c);
    const emoteTotal = emotes.reduce((s, e) => s + e.c, 0);
    const hasDates = Object.keys(c.byDate || {}).length > 0 || Object.keys(c.bySession || {}).length > 0;
    const skillAverages = aggregateSkillAverages([{ perSkill }]);
    // Pour « Jets & moyennes », le journal complet est la source canonique des
    // actions : une attaque ou un sort lancé vaut exactement 1, même en zone.
    // Les compteurs persistés restent utilisés ailleurs pour leurs totaux métier.
    const hasCompleteVttDetails = _statsVttLogsLoaded || !!_statsLegacyRollups;
    const actionCombat = hasCompleteVttDetails ? {
      attacks: num(loggedCombat.attackActions),
      attackRolls: num(loggedCombat.attackRolls),
      attackRollTotal: num(loggedCombat.attackRollTotal),
      attackResultRolls: num(loggedCombat.attackResultRolls),
      attackResultTotal: num(loggedCombat.attackResultTotal),
      crits: num(loggedCombat.crits),
      fumbles: num(loggedCombat.fumbles),
      attackHist: Array.isArray(loggedCombat.attackHist) ? loggedCombat.attackHist : [],
    } : combat;
    const actionExtrasSource = hasCompleteVttDetails ? loggedCombat : combat;
    const actionExtras = {
      rolls: num(actionExtrasSource.supplementalRolls),
      trackedRolls: num(actionExtrasSource.supplementalRolls),
      naturalTotal: num(actionExtrasSource.supplementalNaturalTotal),
      resultRolls: num(actionExtrasSource.supplementalResultRolls),
      resultTotal: num(actionExtrasSource.supplementalResultTotal),
      crits: num(actionExtrasSource.supplementalCrits),
      fumbles: num(actionExtrasSource.supplementalFumbles),
      hist: Array.isArray(actionExtrasSource.supplementalHist) ? actionExtrasSource.supplementalHist : [],
    };
    const combatActionCount = hasCompleteVttDetails ? num(loggedCombat.canonicalActions) : null;
    const actionAverages = aggregateActionAverages(skillAverages, actionCombat, actionExtras);
    return {
      id, name: _statsCharacterName(id, c.name),
      // Une seule source pour les totaux de compétences : le même agrégat que
      // celui des cartes de moyenne et du calcul MVP.
      sRolls: skillAverages.rolls,
      sCrits: skillAverages.crits,
      sFumbles: skillAverages.fumbles,
      perSkill, skillAverages, actionAverages, actionCombat, actionExtras, combatActionCount,
      combat, spells, emotes, emoteTotal, hasDates,
    };
  }).filter(r => r.sRolls > 0 || r.combat.attacks > 0 || r.combat.attacksTaken > 0 || r.combat.dmgTaken > 0 || r.combat.heal > 0 || r.combat.spellsCast > 0 || r.emotes.length);
  _statsRowsCache.set(detailKey, rows);
  return _statsFilterHidden(rows, includeHidden);
}

const STATS_ROLLUP_VERSION = 3;
const STATS_ROLLUP_LEASE_MS = 5 * 60_000;

function _statsRollupReady(rollup) {
  return rollup?.version === STATS_ROLLUP_VERSION && !!rollup?.scopes;
}

function _statsRollupLeaseOwner() {
  const uid = STATE.user?.uid || 'anonymous';
  try { return `${uid}:${crypto.randomUUID()}`; }
  catch { return `${uid}:${Date.now()}:${Math.random().toString(36).slice(2)}`; }
}

async function _statsClaimRollupLease() {
  const owner = _statsRollupLeaseOwner();
  const claim = await claimDocumentLease('statsRollups', 'main', {
    owner,
    leaseMs: STATS_ROLLUP_LEASE_MS,
    prefix: 'historyBuild',
    isReady: _statsRollupReady,
  });
  return { owner, ...claim };
}

function _statsCompactRollupValue(value) {
  if (typeof value === 'number') return value === 0 ? undefined : value;
  if (typeof value === 'boolean') return value ? true : undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const compact = {};
  for (const [key, child] of Object.entries(value)) {
    const next = _statsCompactRollupValue(child);
    if (next !== undefined && (typeof next !== 'object' || Object.keys(next).length)) compact[key] = next;
  }
  return Object.keys(compact).length ? compact : undefined;
}

function _statsBuildLegacyRollups(logs) {
  _statsLegacyRollups = null;
  _statsVttLogs = Array.isArray(logs) ? logs : [];
  _statsVttLogsLoaded = true;
  _statsVttDetailCache = new Map();
  _statsRowsCache = new Map();

  _statsRowsFor(null, { includeHidden: true });
  for (const key of _statsAllSessionKeys()) _statsRowsFor([key], { includeHidden: true });

  const scopes = {};
  for (const [key, detail] of _statsVttDetailCache) {
    // Les combinaisons mission sont recalculables par fusion des séances ; on ne
    // persiste que campagne (*) et scopes unitaires.
    if (key === '*' || !key.includes('|')) {
      const compact = _statsCompactRollupValue(detail);
      if (compact) scopes[key] = compact;
    }
  }
  return scopes;
}

function _statsMergeLegacyScopes(baseScopes = {}, nextScopes = {}) {
  const merged = { ...baseScopes };
  for (const [key, detail] of Object.entries(nextScopes || {})) {
    merged[key] = mergeVttRollDetails([baseScopes?.[key], detail].filter(Boolean));
  }
  return merged;
}

function _statsLogTime(log) {
  return vttLogTimeMs(log?.createdAt) ?? 0;
}

async function _statsPersistLegacyRollups(logs, {
  baseScopes = {}, sourceThroughMs = 0, sourceBoundaryIds = [], sourceLogCount = 0,
  applyCorrections = true,
} = {}) {
  const nextScopes = _statsBuildLegacyRollups(logs);
  const scopes = _statsMergeLegacyScopes(baseScopes, nextScopes);
  const maxLogTime = Math.max(sourceThroughMs, ...logs.map(_statsLogTime));
  const boundaryIds = new Set(maxLogTime === sourceThroughMs ? sourceBoundaryIds : []);
  logs.forEach(log => { if (_statsLogTime(log) === maxLogTime && log?.id) boundaryIds.add(log.id); });
  await replaceDoc('statsRollups', 'main', {
    version: STATS_ROLLUP_VERSION,
    generatedAt: Date.now(),
    sourceLogCount: Math.max(0, Number(sourceLogCount) || 0) + logs.length,
    sourceThroughMs: maxLogTime,
    sourceBoundaryIds: [...boundaryIds],
    scopes,
  });
  if (applyCorrections) {
    const corrected = await applyStatsLegacyRollup(scopes, STATS_ROLLUP_VERSION);
    if (!corrected) throw new Error('Correction du rollup refusée');
  }
  _statsLegacyRollups = scopes;
  _statsVttLogs = [];
  _statsVttLogsLoaded = false;
  _statsVttDetailCache = new Map();
  _statsRowsCache = new Map();
  return scopes;
}

function _statsNeedsVttBackfill(data) {
  return Object.values(data?.chars || {}).some(char => {
    const missingSkillDetail = Object.values(char?.skills || {})
      .some(skill => _statsNum(skill?.trackedRolls) < _statsNum(skill?.rolls));
    const combat = char?.combat || {};
    // Le journal est nécessaire même si les compteurs détaillés semblent complets :
    // les anciennes actions multicibles pouvaient remplir ces compteurs par cible.
    const needsCanonicalCombatActions = _statsNum(combat.attacks) > 0;
    const missingAttackDetail = _statsNum(combat.attackRolls) < _statsNum(combat.attacks)
      || _statsNum(combat.attackResultRolls) < _statsNum(combat.attacks);
    const damageEvents = _statsNum(combat.damageEvents);
    const missingDamageDetail = damageEvents < _statsNum(combat.hits)
      || (!damageEvents && _statsNum(combat.dmgDealt) > 0);
    // Le journal permet également de retirer l'overkill des anciens compteurs
    // de dégâts subis (valeur du jet au lieu des PV réellement perdus).
    const needsDamageTakenReconciliation = _statsNum(combat.dmgTaken) > 0;
    // Les anciens soins et sorts de soutien n'enregistraient leur d20 que dans
    // le journal VTT. On le recharge donc dès qu'un personnage en a lancé afin
    // que leurs réussites/échecs critiques rejoignent les temps forts.
    const needsSupplementalActionDetail = _statsNum(combat.spellsCast) > 0
      || _statsNum(combat.heal) > 0
      || _statsNum(combat.supportSpells) > 0
      || _statsNum(combat.tacticalSpells) > 0;
    return missingSkillDetail
      || needsCanonicalCombatActions
      || missingAttackDetail
      || missingDamageDetail
      || needsDamageTakenReconciliation
      || needsSupplementalActionDetail;
  });
}

function _statsAggregateRows(rows = []) {
  const combat = rows.reduce((g, r) => {
    for (const k in g) g[k] += (r.combat[k] || 0);
    return g;
  }, {
    attacks: 0, hits: 0, crits: 0, fumbles: 0,
    attackRolls: 0, attackRollTotal: 0, attackResultRolls: 0, attackResultTotal: 0,
    dmgDealt: 0, dmgTaken: 0, kosDealt: 0, kosTaken: 0,
    damageEvents: 0, damageTotal: 0, damageTakenEvents: 0, damageTakenTotal: 0,
    damageTakenCorrection: 0, damageDealtCorrection: 0,
    attacksTaken: 0, attacksAvoided: 0,
    spellsCast: 0, tacticalSpells: 0, supportSpells: 0, afflictionSpells: 0, controlSpells: 0,
    pmSpent: 0, heal: 0, biggestHit: 0, biggestTaken: 0
  });
  combat.biggestHit = Math.max(0, ...rows.map(r => r.combat.biggestHit || 0));
  combat.biggestTaken = Math.max(0, ...rows.map(r => r.combat.biggestTaken || 0));
  const actionCombat = rows.reduce((total, row) => {
    for (const key of ['attacks', 'crits', 'fumbles', 'attackRolls', 'attackRollTotal', 'attackResultRolls', 'attackResultTotal']) {
      total[key] += _statsNum(row.actionCombat?.[key]);
    }
    return total;
  }, { attacks: 0, crits: 0, fumbles: 0, attackRolls: 0, attackRollTotal: 0, attackResultRolls: 0, attackResultTotal: 0 });
  const combatActionCount = (_statsVttLogsLoaded || !!_statsLegacyRollups)
    ? rows.reduce((total, row) => total + _statsNum(row.combatActionCount), 0)
    : null;
  const skills = aggregateSkillAverages(rows);
  const actionExtras = rows.reduce((total, row) => {
    for (const key of ['rolls', 'trackedRolls', 'naturalTotal', 'resultRolls', 'resultTotal', 'crits', 'fumbles']) {
      total[key] += _statsNum(row.actionExtras?.[key]);
    }
    return total;
  }, { rolls: 0, trackedRolls: 0, naturalTotal: 0, resultRolls: 0, resultTotal: 0, crits: 0, fumbles: 0 });
  const hitRate = combat.attacks ? Math.round(combat.hits / combat.attacks * 100) : 0;
  return { combat, skills, actionCombat, actionExtras, combatActionCount, hitRate };
}

// Classement top 5 homogène (sorts / compétences / émotes).
function _statsPodium(title, entries, render, opts = {}) {
  const rdr = render || ((l) => _esc(l));
  const labelOf = (e) => Array.isArray(e) ? e[0] : e?.n;
  const countOf = (e) => Array.isArray(e) ? e[1] : e?.c;
  const body = entries.length
    ? entries.slice(0, 5).map((e, i) => {
      const label = labelOf(e);
      const meta = opts.meta ? opts.meta(e, i) : '';
      return `<div class="stats-pod-row${i === 0 ? ' is-first' : ''}">
        <span class="stats-pod-rank">${i + 1}</span>
        <span class="stats-pod-main"><span class="stats-pod-name">${rdr(label)}</span>${meta}</span>
        <span class="stats-pod-n"><b>${countOf(e) || 0}</b><small>fois</small></span>
      </div>`;
    }).join('')
    : '<div class="stats-pod-empty">Aucune donnée</div>';
  return `<section class="stats-pod" style="--pod-accent:${opts.accent || '#7fb0ff'}">
    <div class="stats-pod-head">
      <span class="stats-pod-icon">${opts.icon || '🏅'}</span>
      <span class="stats-pod-title">${title}<small>Top 5</small></span>
    </div>
    <div class="stats-pod-list">${body}</div>
  </section>`;
}

function _statsBindRenderedInteractions(root) {
  _statsUnbindMvpOutsideClose();
  _statsUnbindNavSpy();
  _statsBindMvpOutsideClose(root);
  _statsBindNavSpy(root);
  _statsBindPopCloser();

  root.querySelectorAll('img[data-stats-emote-fallback]').forEach(image => {
    if (image.dataset.statsEmoteBound === 'true') return;
    image.dataset.statsEmoteBound = 'true';
    image.addEventListener('error', () => {
      const fallback = image.dataset.statsEmoteFallback;
      if (!fallback || image.src === fallback) return;
      image.removeAttribute('data-stats-emote-fallback');
      image.src = fallback;
    }, { once: true });
  });

  root.querySelectorAll('.stats-char').forEach(charDetails => {
    if (charDetails.dataset.statsToggleBound === 'true') return;
    charDetails.dataset.statsToggleBound = 'true';
    charDetails.addEventListener('toggle', () => {
      if (charDetails.dataset.drawerKey) _statsDrawerState.set(charDetails.dataset.drawerKey, !!charDetails.open);
    });
  });

  if (!_statsDrawerKeyboardBound) {
    _statsDrawerKeyboardBound = true;
    document.addEventListener('keydown', event => {
      if (!_statsDrawerId || !document.querySelector('#stats-root .stats-v2-drawer')) return;
      if (/INPUT|TEXTAREA|SELECT/.test(event.target?.tagName) || event.target?.isContentEditable) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        _statsDrawerId = '';
        _statsRender(_statsScope);
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const ids = [...document.querySelectorAll('#stats-root [data-action="_statsDrawerOpen"]')].map(button => button.dataset.id).filter(Boolean);
      const current = ids.indexOf(_statsDrawerId);
      if (current < 0 || ids.length < 2) return;
      _statsDrawerId = ids[(current + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length];
      _statsRender(_statsScope);
    });
  }
}

function _statsSessionModels(sessionKeys = [], selectedIds = null) {
  return sessionKeys.map(key => {
    const rows = _statsRowsFor([key]).filter(row => !selectedIds?.size || selectedIds.has(row.id));
    const stored = _statsSessionEntry(key);
    return {
      key, rows, ...stored,
      dateLabel: _statsSessionLabel(key),
      missionLabel: _statsMissionOf(key) || 'Séance non reliée',
      groupLabel: _statsGroupOf(key),
      total: statsSessionTotal(rows),
    };
  }).filter(session => session.rows.length);
}

function _statsHistogramHtml(hist = [], { tone = 'all' } = {}) {
  const values = Array.from({ length: 20 }, (_, index) => Number(hist?.[index]) || 0);
  const max = Math.max(1, ...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  return `<div class="stats-v2-hist is-${tone}" aria-label="Histogramme des faces du d20">
    ${values.map((value, index) => `<div class="stats-v2-face${index === 0 ? ' is-fumble' : index === 19 ? ' is-crit' : ''}" title="Face ${index + 1} : ${value}"><span>${value || ''}</span><i style="height:${Math.max(value ? 5 : 0, Math.round(value / max * 100))}%"></i><b>${index + 1}</b></div>`).join('')}
  </div><p class="stats-v2-coverage">${total.toLocaleString('fr-FR')} résultat${total > 1 ? 's' : ''} naturel${total > 1 ? 's' : ''} détaillé${total > 1 ? 's' : ''}</p>`;
}

function _statsSessionsV2Html(sessionKeys, selectedIds = null) {
  const sessions = _statsSessionModels(sessionKeys, selectedIds)
    .sort((a, b) => _statsDateOf(b.key).localeCompare(_statsDateOf(a.key)) || b.key.localeCompare(a.key));
  const pending = sessions.filter(session => !session.missionId);
  const linked = sessions.filter(session => session.missionId);
  const missionOptions = _statsMissionList();
  const row = session => {
    const mvp = scoreMvpView({ rows: session.rows, autoCalibrate: true })
      .find(result => result.eligible !== false && result.details?.confidence?.level !== 'low');
    const visibleParticipants = session.rows.slice(0, 6);
    const participants = visibleParticipants.map(item => _statsAvatar(item.id, item.name, 28)).join('');
    const extraParticipants = Math.max(0, session.rows.length - visibleParticipants.length);
    const date = _statsSessionDateParts(session.key);
    const time = _statsSessionTime(session.key);
    const suggestion = suggestStatsSessionLink(session, _statsQuests, sessions);
    const inlineLink = STATE.isAdmin ? `<div class="stats-v2-linker">
      <select data-stats-link-mission aria-label="Mission">${missionOptions.map(mission => `<option value="${_esc(mission.id)}"${(session.missionId || suggestion.missionId) === mission.id ? ' selected' : ''}>${_esc(mission.name)}</option>`).join('')}</select>
      <button type="button" data-action="_statsLinkInline" data-session="${_esc(session.key)}" data-group="${_esc(session.groupId || suggestion.groupId)}">${session.missionId ? 'Modifier' : 'Relier'}</button>
    </div>` : '';
    return `<article class="stats-v2-session${session.missionId ? '' : ' is-pending'}">
      <button type="button" class="stats-v2-session-main" data-action="_statsOpenSessionSummary" data-scope="${_esc(session.key)}">
        <time><small>${_esc(date.weekday)}.</small><b>${_esc(date.date)}</b></time>
        <span class="stats-v2-session-copy"><b>${_esc(session.missionId ? (session.groupLabel || 'Groupe non renseigné') : 'Groupe à préciser')}</b><small>${time ? `${_esc(time.replace(':', ' h '))} · ` : ''}${session.rows.length} joueur${session.rows.length > 1 ? 's' : ''}${!session.missionId ? ' · À relier' : ''}</small></span>
        <span class="stats-v2-participants">${participants}${extraParticipants ? `<i>+${extraParticipants}</i>` : ''}</span>
        <span class="stats-v2-session-metric is-dmg"><b>${session.total.dmg || '—'}</b><small>Dégâts</small></span>
        <span class="stats-v2-session-metric is-ko"><b>${session.total.ko || '—'}</b><small>KO</small></span>
        <span class="stats-v2-session-metric is-heal"><b>${session.total.heal || '—'}</b><small>Soin</small></span>
        <span class="stats-v2-session-metric is-taken"><b>${session.total.taken || '—'}</b><small>Encaissé</small></span>
        <span class="stats-v2-session-mvp">${mvp ? `${_statsAvatar(mvp.id, mvp.name, 28)}<span><small>MVP</small><b>${_esc(mvp.name)}</b></span>` : '<span><small>MVP</small><b>—</b></span>'}</span>
        <span class="stats-v2-session-chevron">›</span>
      </button>${!session.missionId ? inlineLink : ''}
    </article>`;
  };
  const grouped = new Map();
  linked.forEach(session => {
    const mission = missionOptions.find(item => item.id === session.missionId);
    const actLabel = _statsActLabel(mission?.story);
    const act = grouped.get(actLabel) || new Map();
    const entry = act.get(session.missionId) || { mission, name: session.missionLabel, sessions: [] };
    entry.sessions.push(session);
    act.set(session.missionId, entry);
    grouped.set(actLabel, act);
  });
  const missionSection = ({ mission, name, sessions: list }) => {
    const total = statsSessionTotal(list.flatMap(item => item.rows));
    const groups = [...new Set(list.map(item => item.groupLabel).filter(Boolean))];
    return `<section class="stats-v2-mission-session">
      <header class="stats-v2-mission-session-head">
        ${_statsMissionArtHtml(mission || { name }, 38)}
        <span class="stats-v2-mission-session-copy"><b>${_esc(name)}</b><small>${list.length} séance${list.length > 1 ? 's' : ''} · ${total.dmg.toLocaleString('fr-FR')} dégâts · ${total.ko.toLocaleString('fr-FR')} KO · ${total.down.toLocaleString('fr-FR')} PJ à terre</small></span>
        <span class="stats-v2-mission-groups">${groups.map((group, index) => `<i style="--gc:${['#5795ff','#ff9544','#b985ff'][index % 3]}">${_esc(group)}</i>`).join('')}</span>
        <button type="button" data-action="_statsSetScope" data-scope="mission:${_esc(mission?.id || list[0]?.missionId || '')}">Bilan <span>›</span></button>
      </header>${list.map(row).join('')}
    </section>`;
  };
  const missionBody = [...grouped.entries()].map(([act, missions]) => `<div class="stats-v2-act-group"><h3>${_esc(act)}</h3>${[...missions.values()].map(missionSection).join('')}</div>`).join('');
  const chronoBody = sessions.length ? `<section class="stats-v2-mission-session stats-v2-session-chrono">${sessions.map(row).join('')}</section>` : '';
  const showPending = STATE.isAdmin && pending.length && _statsSessionsMode === 'mission';
  const body = _statsSessionsPendingOnly
    ? (pending.length ? `<div class="stats-v2-pending stats-v2-pending--only">${pending.map(row).join('')}</div>` : '<p class="stats-empty-inline">Toutes les séances sont reliées.</p>')
    : (_statsSessionsMode === 'chrono' ? chronoBody : missionBody);
  return `<section class="stats-v2-section">
    <header class="stats-v2-title"><div><h2>Journal des séances</h2><small>${sessions.length} séance${sessions.length > 1 ? 's' : ''}</small></div><nav>
      ${STATE.isAdmin && pending.length ? `<button type="button" class="stats-v2-pending-filter${_statsSessionsPendingOnly ? ' on' : ''}" data-action="_statsSessionsPending">△ À relier · ${pending.length}</button>` : ''}
      <span class="stats-v2-session-modes"><button type="button" class="${_statsSessionsMode === 'mission' ? 'on' : ''}" data-action="_statsSessionsMode" data-mode="mission">Par mission</button><button type="button" class="${_statsSessionsMode === 'chrono' ? 'on' : ''}" data-action="_statsSessionsMode" data-mode="chrono">Chronologique</button></span>
    </nav></header>
    ${showPending && !_statsSessionsPendingOnly ? `<div class="stats-v2-pending"><header><span class="stats-v2-pending-icon">△</span><span><b>Séances à relier</b><small>Elles comptent dans la campagne mais dans aucune mission, aucun acte ni aucun MVP de mission.</small></span><em>${pending.length} séance${pending.length > 1 ? 's' : ''}</em></header>${pending.map(row).join('')}</div>` : ''}
    <div class="stats-v2-session-groups">${body || '<p class="stats-empty-inline">Aucune séance sur ce périmètre.</p>'}</div>
  </section>`;
}

function _statsDataV2Html(sessionKeys) {
  if (!STATE.isAdmin) return '';
  const pending = _statsUnlinkedDates(sessionKeys);
  const tracked = Object.entries(_statsData?.chars || {});
  const rosterIds = new Set((STATE.characters || []).map(char => char.id));
  const outsideRoster = tracked.filter(([id]) => !rosterIds.has(id));
  const detailed = _statsLegacyRollups?.['*']?.relevantLogs || 0;
  const totalRolls = _statsRowsFor(null).reduce((sum, row) => sum + Number(row.actionAverages?.rolls || 0), 0);
  const coverage = totalRolls ? Math.min(100, Math.round(detailed / totalRolls * 100)) : 0;
  const sessionModels = _statsSessionModels(sessionKeys).sort((a, b) => b.key.localeCompare(a.key));
  const aggregate = _statsAggregateRows(_statsRowsFor(sessionKeys));
  const sessionRow = session => {
    const source = _statsData?.sessions?.[session.key] || {};
    const participants = session.rows.slice(0, 7).map(row => _statsAvatar(row.id, row.name, 22)).join('');
    const extra = Math.max(0, session.rows.length - 7);
    const date = _statsSessionDateParts(session.key);
    return `<tr>
      <td class="stats-data-session"><b>${_esc(date.long)}</b><small>${_esc(_statsSessionTime(session.key)?.replace(':', ' h ') || '')}</small></td>
      <td class="stats-data-mission">${session.missionId ? `<b>${_esc(session.missionLabel || 'Mission')}</b><small>${_esc(session.groupLabel || 'Groupe non renseigné')}</small>` : '<span class="stats-data-state is-warn">Non reliée</span>'}</td>
      <td><span class="stats-data-avatars">${participants}${extra ? `<i>+${extra}</i>` : ''}</span></td>
      <td>${source.manual || source.corrected ? '<span class="stats-data-state">Corrigée</span>' : '<span class="stats-tbl-z">—</span>'}</td>
      <td class="stats-data-actions"><button type="button" class="${session.missionId ? '' : 'is-warn'}" data-action="_statsEditMission" data-scope="${_esc(session.key)}">⌁ ${session.missionId ? 'Modifier' : 'Relier'}</button><button type="button" class="is-icon is-danger" data-action="_statsDelDate" data-scope="${_esc(session.key)}" title="Supprimer les statistiques de cette séance" aria-label="Supprimer les statistiques de cette séance">⌫</button></td>
    </tr>`;
  };
  const charRow = ([id, statsChar]) => {
    const name = _statsCharacterName(id, statsChar.name);
    const char = _statsCharacterById(id) || { id, nom: name };
    const played = sessionKeys.filter(key => _statsSessionBucket(statsChar, key));
    const last = [...played].sort().at(-1);
    const player = char.ownerPseudo || char.joueur || char.player || statsChar.player || '—';
    return `<tr>
      <td class="stats-data-character">${characterAvatarHtml(char, { size: 24 })}<b>${_esc(name)}</b></td>
      <td>${_esc(player)}</td><td>${played.length}</td><td>${last ? _esc(_statsSessionDateParts(last).long) : '—'}</td>
      <td>${rosterIds.has(id) ? '<span class="stats-data-state is-ok">Actif</span>' : '<span class="stats-data-state is-warn">Hors roster</span>'}</td>
      <td class="stats-data-actions"><button type="button" data-action="_statsCharDates" data-id="${_esc(id)}">Séances</button><button type="button" class="is-icon is-danger" data-action="_statsDelChar" data-id="${_esc(id)}" data-name="${_esc(name)}" title="Supprimer ses statistiques" aria-label="Supprimer ses statistiques">⌫</button></td>
    </tr>`;
  };
  const rawGroup = (title, entries) => `<section><h4>${title}</h4>${entries.map(([label, value]) => `<p><span>${label}</span><b>${Number(value || 0).toLocaleString('fr-FR')}</b></p>`).join('')}</section>`;
  return `<section class="stats-v2-section stats-v2-data">
    <header class="stats-v2-page-head"><div><h2>Données</h2><span>MJ uniquement</span></div><p>Les filtres de la page ne suppriment jamais rien. Chaque suppression annonce son périmètre avant confirmation.</p></header>
    <div class="stats-v2-health">
      <button type="button" data-action="_statsSetTab" data-tab="sessions" class="${pending.length ? 'is-warn' : 'is-ok'}"><i>⌁</i><span><b>${pending.length ? `${pending.length} séance${pending.length > 1 ? 's' : ''} à relier` : 'Associations à jour'}</b><small>${pending.length ? 'Sans mission, elles ne comptent dans aucun bilan d’acte ou de mission.' : 'Toutes les séances sont reliées à une mission.'}</small></span></button>
      <div class="${coverage < 70 ? 'is-warn' : 'is-ok'}"><i>▦</i><span><b>${coverage}% des jets détaillés</b><small>${Number(detailed).toLocaleString('fr-FR')} jets ont leur d20 enregistré. Les moyennes ignorent les autres, sans rien inventer.</small></span></div>
      <div class="${outsideRoster.length ? 'is-warn' : 'is-ok'}"><i>${outsideRoster.length ? '!' : '✓'}</i><span><b>${outsideRoster.length ? `${outsideRoster.length} personnage${outsideRoster.length > 1 ? 's' : ''} hors roster` : 'Roster cohérent'}</b><small>${outsideRoster.length ? outsideRoster.map(([, char]) => char.name).filter(Boolean).join(', ') : 'Aucun personnage inconnu dans les statistiques.'}</small></span></div>
    </div>
    <section class="stats-v2-data-card"><header><div><span>Séances</span><h3>Séances enregistrées</h3></div><small>${sessionKeys.length} séance${sessionKeys.length > 1 ? 's' : ''} · même date = heure affichée</small></header><div class="stats-tbl-wrap"><table class="stats-tbl stats-data-table"><thead><tr><th>Séance</th><th>Mission · groupe</th><th>Participants</th><th>Correction</th><th>Actions</th></tr></thead><tbody>${sessionModels.map(sessionRow).join('') || '<tr><td colspan="5" class="stats-tbl-z">Aucune séance enregistrée.</td></tr>'}</tbody></table></div></section>
    <section class="stats-v2-data-card"><header><div><span>Personnages</span><h3>Personnages suivis</h3></div><small>Supprimer ici efface ses statistiques, jamais le personnage.</small></header><div class="stats-tbl-wrap"><table class="stats-tbl stats-data-table"><thead><tr><th>Personnage</th><th>Joueur·se</th><th>Séances</th><th>Dernière séance</th><th>État</th><th></th></tr></thead><tbody>${tracked.map(charRow).join('') || '<tr><td colspan="6" class="stats-tbl-z">Aucun personnage suivi.</td></tr>'}</tbody></table></div></section>
    <details class="stats-v2-raw"><summary><span>⌄</span><b>Compteurs bruts</b><small>· toute la campagne — ancien onglet « Audit »</small></summary><div class="stats-v2-raw-grid">${rawGroup('Combat', [['Attaques', aggregate.combat.attacks], ['Touches', aggregate.combat.hits], ['Dégâts infligés', aggregate.combat.dmgDealt], ['KO infligés', aggregate.combat.kosDealt], ['Dégâts subis', aggregate.combat.dmgTaken], ['Fois mis KO', aggregate.combat.kosTaken]])}${rawGroup('Magie & soutien', [['Sorts lancés', aggregate.combat.spellsCast], ['Soutiens', aggregate.combat.supportSpells], ['Contrôles', aggregate.combat.controlSpells], ['PM dépensés', aggregate.combat.pmSpent], ['Soin prodigué', aggregate.combat.heal]])}${rawGroup('Compétences & RP', [['Jets de compétence', aggregate.skills.rolls], ['Critiques', aggregate.skills.crits], ['Échecs critiques', aggregate.skills.fumbles], ['Journal détaillé', detailed], ['Personnages', tracked.length], ['Séances', sessionKeys.length]])}</div></details>
    <section class="stats-v2-danger"><div><span>Zone de danger</span><h3>Effacer toutes les statistiques</h3><p>Efface les statistiques de <b>${tracked.length} personnage${tracked.length > 1 ? 's' : ''}</b> sur <b>${sessionKeys.length} séance${sessionKeys.length > 1 ? 's' : ''}</b>. Les personnages, missions, groupes et scènes VTT sont conservés.</p></div><button type="button" data-action="_statsResetAsk">⌫ Tout effacer…</button></section>
  </section>`;
}

function _statsDrawerV2Html(rows, sessionKeys) {
  const row = rows.find(item => item.id === _statsDrawerId);
  if (!row) return '';
  const char = STATE.characters?.find(item => item.id === row.id) || { id: row.id, nom: row.name };
  const playedKeys = sessionKeys.filter(key => _statsSessionBucket(_statsData?.chars?.[row.id], key));
  const total = row.combat;
  const profile = `<div class="stats-v2-drawer-kpis"><span><b>${row.impact || 0}</b>Impact</span><span><b>${total.dmgDealt || 0}</b>Dégâts</span><span><b>${total.kosDealt || 0}</b>KO</span><span><b>${total.heal || 0}</b>Soin</span><span><b>${total.dmgTaken || 0}</b>Encaissé</span><span><b>${total.attacksAvoided || 0}</b>Évitées</span></div>`;
  const sessions = `<div class="stats-v2-drawer-list">${playedKeys.map(key => { const one = _statsRowsFor([key]).find(item => item.id === row.id); return `<button type="button" data-action="_statsSetScope" data-scope="${_esc(key)}"><time>${_esc(_statsSessionLabel(key))}</time><span>${_esc(_statsMissionOf(key) || 'Séance non reliée')}</span><b>${one?.combat?.dmgDealt || 0} dmg</b></button>`; }).join('') || '<p>Aucune séance détaillée.</p>'}</div>`;
  const dice = `${_statsHistogramHtml(row.actionAverages?.hist || [])}<div class="stats-v2-drawer-kpis"><span><b>${row.actionAverages?.naturalAvg ?? '—'}</b>d20 moyen</span><span><b>${row.actionAverages?.crits || 0}</b>Critiques</span><span><b>${row.actionAverages?.fumbles || 0}</b>Échecs</span></div>`;
  const compareRows = rows.filter(item => item.id !== row.id);
  const compareId = _statsCompareSelection.players?.find(id => id && id !== row.id) || compareRows[0]?.id;
  const other = compareRows.find(item => item.id === compareId) || compareRows[0];
  const compare = other ? `<label class="stats-v2-compare-pick">Comparer avec<select data-change="_statsDrawerCompare">${compareRows.map(item => `<option value="${_esc(item.id)}"${item.id === other.id ? ' selected' : ''}>${_esc(item.name)}</option>`).join('')}</select></label><div class="stats-v2-compare">${[['Dégâts','dmgDealt'],['KO','kosDealt'],['Soin','heal'],['Encaissé','dmgTaken'],['Évitées','attacksAvoided']].map(([label,key]) => `<div><b>${row.combat[key] || 0}</b><span>${label}</span><b>${other.combat[key] || 0}</b></div>`).join('')}</div>` : '<p>Aucun autre personnage à comparer.</p>';
  const panes = { profile, sessions, dice, compare };
  return `<aside class="stats-v2-drawer" aria-label="Fiche statistique de ${_esc(row.name)}"><header>${characterAvatarHtml(char, { size: 48, className: 'stats-v2-drawer-avatar' })}<span><small>Fiche statistique</small><h2>${_esc(row.name)}</h2><em>${playedKeys.length} séance${playedKeys.length > 1 ? 's' : ''} jouée${playedKeys.length > 1 ? 's' : ''}</em></span><div class="stats-v2-drawer-nav"><button type="button" data-action="_statsDrawerStep" data-step="-1" aria-label="Personnage précédent">‹</button><button type="button" data-action="_statsDrawerStep" data-step="1" aria-label="Personnage suivant">›</button><button type="button" data-action="_statsDrawerClose" aria-label="Fermer">×</button></div></header><nav>${[['profile','Profil'],['sessions','Séances'],['dice','Dés'],['compare','Comparer']].map(([id,label]) => `<button type="button" class="${_statsDrawerTab === id ? 'on' : ''}" data-action="_statsDrawerTab" data-tab="${id}">${label}</button>`).join('')}</nav><div class="stats-v2-drawer-body">${panes[_statsDrawerTab] || profile}</div></aside><button type="button" class="stats-v2-drawer-scrim" data-action="_statsDrawerClose" aria-label="Fermer la fiche"></button>`;
}

// Rendu complet de la page pour un scope (réutilisé au changement de séance).
function _statsRender(scope, { root = document.getElementById('stats-root'), bind = true } = {}) {
  _statsScope = scope || null;
  if (!root) return;
  if (bind) _statsCaptureDrawerState(root);
  // Scope : null (campagne) · 'YYYY-MM-DD' (une séance) · 'mission:{id}' (mission entière).
  const isAct = typeof scope === 'string' && scope.startsWith('act:');
  const isMission = typeof scope === 'string' && scope.startsWith('mission:');
  const actKey = isAct ? scope.slice(4) : '';
  const missionId = isMission ? scope.slice(8) : '';
  const dateKey   = (scope && !isMission && !isAct) ? scope : null;
  const missions  = _statsMissionList();
  const acts = _statsActList(missions);
  const allDates = _statsAllSessionKeys();

  // Sélecteur hiérarchique : campagne/mission d'abord, séances ensuite.
  const currentSession = dateKey ? (_statsData?.sessions?.[dateKey] || {}) : null;
  const selectedAct = isAct ? acts.find(a => a.key === actKey) : null;
  const selectedMissionId = isMission ? missionId : (currentSession?.missionId || '');
  const selectedMission = selectedMissionId ? missions.find(m => m.id === selectedMissionId) : null;
  const missionName = isMission ? (selectedMission?.name || 'Mission') : '';
  const selectedMissionDates = selectedMissionId ? _statsMissionDates(selectedMissionId).sort().reverse() : [];
  const selectedActDates = selectedAct ? selectedAct.dates : [];
  const groupOptions = selectedMissionId ? _statsGroupOptionsForDates(dateKey ? [dateKey] : selectedMissionDates) : [];
  if (_statsGroupMissionId !== selectedMissionId) {
    _statsGroupMissionId = selectedMissionId;
    _statsGroupSel = null;
  }
  if (_statsGroupSel && groupOptions.length) {
    const validGroups = new Set(groupOptions.map(g => g.key));
    _statsGroupSel = new Set([..._statsGroupSel].filter(k => validGroups.has(k)));
    if (!_statsGroupSel.size) _statsGroupSel = null;
  }
  if (!selectedMissionId || !groupOptions.length) _statsGroupSel = null;
  const filteredMissionDates = (_statsGroupSel && _statsGroupSel.size)
    ? selectedMissionDates.filter(d => _statsGroupSel.has(_statsGroupKeyOf(d)))
    : selectedMissionDates;
  const sel = _statsPlayerSel;
  const baseScopeDates = isAct ? selectedActDates : (isMission ? filteredMissionDates : (dateKey ? [dateKey] : null));
  const baseAllRows = _statsRowsFor(baseScopeDates);
  // Un filtre personnage retire aussi les séances auxquelles aucun des
  // personnages choisis n'a participé : les moyennes « par séance » ne sont
  // ainsi jamais diluées par les autres groupes.
  const scopeDates = sel?.size ? (baseScopeDates || allDates).filter(key =>
    [...sel].some(id => !!_statsSessionBucket(_statsData?.chars?.[id], key))) : baseScopeDates;
  const allRows = _statsRowsFor(scopeDates);   // participants du scope courant
  // Filtre « joueurs ciblés » : recalcule toute la page sur le sous-ensemble choisi.
  const rows = (sel && sel.size) ? allRows.filter(r => sel.has(r.id)) : allRows;
  _statsScopeRows = rows; // mémorisé pour le sélecteur de MVP manuel (hors rendu)
  const renderOverview = _statsTab === 'summary';
  const renderSessions = _statsTab === 'sessions';
  const renderRanking = _statsTab === 'characters';
  const renderPlayers = false;
  const renderRolls = _statsTab === 'dice';
  const renderAudit = _statsTab === 'data' && STATE.isAdmin;
  const comparableAggregate = (entry) => {
    const trackedDates = entry.dates.filter(d => {
      const dateRows = _statsRowsFor([d]);
      const filteredRows = (sel && sel.size) ? dateRows.filter(r => sel.has(r.id)) : dateRows;
      return filteredRows.length > 0;
    });
    const rawRows = _statsRowsFor(trackedDates);
    const comparedRows = (sel && sel.size) ? rawRows.filter(r => sel.has(r.id)) : rawRows;
    return {
      ...entry,
      count: trackedDates.length,
      totalSessions: entry.dates.length,
      trackedDates,
      rows: comparedRows,
      ..._statsAggregateRows(comparedRows),
      active: trackedDates.length > 0,
    };
  };
  const missionGroupOptions = isMission && selectedMissionId ? _statsGroupOptionsForDates(selectedMissionDates) : [];
  const groupCompareOptions = isMission && missionGroupOptions.length > 1
    ? missionGroupOptions.filter(g => !_statsGroupSel || !_statsGroupSel.size || _statsGroupSel.has(g.key))
    : [];
  const groupCompare = (renderOverview || renderRanking)
    ? groupCompareOptions.map(comparableAggregate).filter(g => g.active)
    : [];
  const missionCompareSource = isAct && selectedAct ? selectedAct.missions : missions;
  const missionCompare = renderOverview && !selectedMissionId && !dateKey
    ? missionCompareSource.map(m => comparableAggregate({
        key: m.id,
        label: m.name,
        dates: _statsMissionDates(m.id),
      })).filter(m => m.active)
    : [];

  const unlinkedDates = _statsUnlinkedDates(allDates);
  const groupsBar = selectedMissionId && groupOptions.length && (dateKey || groupOptions.length > 1) ? `<div class="stats-chips stats-groups">
    <span class="stats-chips-lbl">Groupes</span>
    ${!dateKey && groupOptions.length > 1 ? `<button class="stats-chip${!_statsGroupSel || !_statsGroupSel.size ? ' active' : ''}" data-action="_statsToggleGroup" data-group-key="__all">Tous</button>` : ''}
    ${groupOptions.map(g => `<button class="stats-chip stats-chip-group${dateKey || _statsGroupSel?.has(g.key) ? ' active' : ''}" data-action="_statsToggleGroup" data-group-key="${_esc(g.key)}" title="${_esc(g.label)} · ${g.count} séance${g.count > 1 ? 's' : ''}">
      <span class="stats-chip-group-main"><span>${_esc(g.label)}</span><small>${g.count}</small></span>
      ${g.quest ? `<span class="stats-chip-group-members">${_statsGroupMembersMiniHtml(g.quest)}</span>` : ''}
    </button>`).join('')}
  </div>` : '';
  const activeGroupNames = (_statsGroupSel && _statsGroupSel.size)
    ? groupOptions.filter(g => _statsGroupSel.has(g.key)).map(g => g.label)
    : [];
  const groupScopeText = activeGroupNames.length ? activeGroupNames.join(', ') : '';

  const shareBtn = rows.length ? `<button class="stats-share-btn" data-action="_statsShare" title="Préparer un récapitulatif à partager"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13"/></svg><span>Partager</span></button>` : '';
  const manageStatus = unlinkedDates.length
    ? `<span class="stats-tool-state is-pending" aria-hidden="true">${unlinkedDates.length}</span>`
    : allDates.length
      ? '<span class="stats-tool-state is-ok" aria-hidden="true">✓</span>'
      : '<span class="stats-tool-state is-empty" aria-hidden="true">0</span>';
  const manageTitle = unlinkedDates.length
    ? `${unlinkedDates.length} séance${unlinkedDates.length > 1 ? 's' : ''} à relier à une mission`
    : allDates.length
      ? 'Toutes les séances datées sont reliées à une mission'
      : 'Aucune séance datée à relier pour le moment';
  const manageStateClass = unlinkedDates.length ? ' has-pending' : (allDates.length ? ' is-complete' : ' is-empty');
  const toolsBar = shareBtn ? `<div class="stats-tools" role="group" aria-label="Actions sur les statistiques">${shareBtn}</div>` : '';
  // ── Barre sticky (refonte) : périmètre 3 selects + popover joueurs + onglets ──
  const scopeKicker = dateKey ? `Séance du ${_statsSessionLabel(dateKey)}`
    : isMission ? (selectedMission?.name || 'Mission')
    : isAct ? (selectedAct?.label || 'Acte')
    : 'Toute la campagne';
  const _scOpt = (v, l, cur) => `<option value="${_esc(v)}"${v === cur ? ' selected' : ''}>${_esc(l)}</option>`;
  const missionOpts = (isAct && selectedAct ? selectedAct.missions : missions);
  const sessionOpts = selectedMissionId ? selectedMissionDates
    : (isAct && selectedAct ? selectedActDates : allDates);
  const scopeBar = `<nav class="stats-scope stats-breadcrumb" aria-label="Périmètre statistique">
    <button type="button" class="stats-crumb-home${!scope ? ' on' : ''}" data-action="_statsSetScope" data-scope="">⌂ <span>Campagne</span></button><i>›</i>
    <label class="stats-sc${isAct ? ' on' : ''}"><small>Acte</small>
      <select data-change="_statsSetScopeSel" data-level="act">
        ${_scOpt('', 'Tous les actes', isAct ? actKey : '')}
        ${acts.map(a => _scOpt(a.key, a.label, isAct ? actKey : '')).join('')}
      </select></label><i>›</i>
    <div class="stats-pop stats-msn${_statsMissionPopOpen ? ' open' : ''}">
      <button type="button" class="stats-sc stats-sc--btn${selectedMissionId ? ' on' : ''}" data-action="_statsMissionPop">
        <small>Mission</small>
        <span class="stats-msn-cur">${selectedMission ? `${_statsMissionArtHtml(selectedMission, 22)}<span>${_esc(selectedMission.name)}</span>` : '<span>Toutes les missions</span>'}<i class="stats-msn-caret">▾</i></span>
      </button>
      <div class="stats-pop-menu stats-msn-menu">
        <button type="button" class="stats-msn-item${!selectedMissionId ? ' on' : ''}" data-action="_statsScopeMission" data-id=""><span class="stats-msn-item-ic">🌍</span><span>Toutes les missions</span></button>
        ${acts.map(a => `<div class="stats-msn-act">${_esc(a.label)}</div>${a.missions.map(m => `<button type="button" class="stats-msn-item${m.id === selectedMissionId ? ' on' : ''}" data-action="_statsScopeMission" data-id="${_esc(m.id)}">${_statsMissionArtHtml(m, 30)}<span>${_esc(m.name)}</span></button>`).join('')}`).join('')}
      </div>
    </div><i>›</i>
    <label class="stats-sc${dateKey ? ' on' : ''}"><small>Séance</small>
      <select data-change="_statsSetScopeSel" data-level="session" data-mission="${_esc(selectedMissionId || '')}" data-act="${isAct ? _esc(actKey) : ''}">
        ${_scOpt('', 'Toutes les séances', dateKey || '')}
        ${sessionOpts.map(d => _scOpt(d, `${_statsSessionLabel(d, { short: true })}${_statsGroupOf(d) ? ' · ' + _statsGroupOf(d) : ''}`, dateKey || '')).join('')}
      </select></label>
  </nav>`;
  const popRows = baseAllRows;
  const shortcutDates = Array.isArray(scopeDates) ? scopeDates : allDates;
  const shortcutGroupMap = new Map();
  _statsGroupOptionsForDates(shortcutDates).filter(group => group.key !== '__nogroup').forEach(group => {
    const labelKey = String(group.label || '').trim().toLocaleLowerCase('fr');
    const current = shortcutGroupMap.get(labelKey);
    if (current) current.dates = [...new Set([...current.dates, ...group.dates])];
    else shortcutGroupMap.set(labelKey, { ...group, dates: [...group.dates] });
  });
  const shortcutGroups = [...shortcutGroupMap.values()].map((group, index) => {
    const ids = new Set(group.dates.flatMap(date => _statsRowsFor([date]).map(row => row.id)));
    return { ...group, ids: [...ids].filter(id => popRows.some(row => row.id === id)), color: group.quest?.couleur || group.quest?.color || ['#5795ff','#31d2a0','#b985ff','#ff9544','#e8b84b'][index % 5] };
  }).filter(group => group.ids.length);
  const mineIds = STATE.isAdmin ? [] : getControlledCharacters(STATE.characters || [], STATE.user?.uid).map(char => char.id).filter(id => popRows.some(row => row.id === id));
  const selectionMatches = ids => !!sel?.size && ids.length === sel.size && ids.every(id => sel.has(id));
  const activeShortcut = shortcutGroups.find(group => selectionMatches(group.ids));
  const mineShortcutActive = selectionMatches(mineIds);
  const selectedRows = sel?.size ? popRows.filter(row => sel.has(row.id)) : popRows;
  const playerFilterLabel = !sel?.size ? 'Tous' : mineShortcutActive ? 'Mes personnages' : activeShortcut?.label || `${sel.size} personnage${sel.size > 1 ? 's' : ''}`;
  const playersPop = popRows.length ? `<div class="stats-pop${_statsPopOpen ? ' open' : ''}">
    <button class="stats-pill${sel && sel.size ? ' on' : ''}" data-action="_statsPlayersPop">
      <span class="stats-avstack">${selectedRows.slice(0, 3).map(r => _statsAvatar(r.id, r.name, 20)).join('')}</span>
      <span>${_esc(playerFilterLabel)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    <div class="stats-pop-menu stats-players-menu">
      <div class="stats-pop-section-title">Raccourcis</div>
      <div class="stats-player-shortcuts">
        <button class="${!sel?.size ? 'on' : ''}" data-action="_statsPlayerShortcut" data-kind="all">Tous</button>
        ${mineIds.length ? `<button class="${mineShortcutActive ? 'on' : ''}" data-action="_statsPlayerShortcut" data-kind="mine" data-ids="${_esc(mineIds.join(','))}">Mes personnages</button>` : ''}
        ${shortcutGroups.map(group => `<button class="${selectionMatches(group.ids) ? 'on' : ''}" data-action="_statsPlayerShortcut" data-kind="group" data-ids="${_esc(group.ids.join(','))}"><i style="--gc:${group.color}"></i>${_esc(group.label)}</button>`).join('')}
      </div>
      <div class="stats-pop-section-title stats-pop-section-title--list"><span>Personnages du périmètre</span><b>${popRows.length}</b></div>
      <div class="stats-pop-list">${popRows.map(r => `<button class="stats-pop-item${sel && sel.has(r.id) ? ' on' : ''}" data-action="_statsTogglePlayer" data-id="${r.id}">${_statsAvatar(r.id, r.name, 20)}<span>${_esc(r.name)}</span><i class="stats-player-check"></i></button>`).join('')}</div>
    </div>
  </div>` : '';
  const tabDefs = [['summary', 'Résumé'], ['sessions', 'Séances'], ['characters', 'Personnages'], ['dice', 'Dés'], ...(STATE.isAdmin ? [['data', 'Données']] : [])];
  const tabCounts = { sessions: allDates.length, characters: rows.length, data: unlinkedDates.length };
  const tabsBar = `<div class="stats-tabs">${tabDefs.map(([k, l]) => `<button class="stats-tab${_statsTab === k ? ' on' : ''}" data-action="_statsSetTab" data-tab="${k}" data-nav-page="statistiques" data-nav-sub="${k}">${l}${tabCounts[k] ? `<span class="stats-tab-cnt">${tabCounts[k]}</span>` : ''}</button>`).join('')}</div>`;
  const controls = `<div class="stats-topbar stats-topbar-v2"><div class="stats-topbar-in">
    <div class="stats-topbar-row">
      <div class="stats-brand"><h1>Statistiques</h1></div>
      ${scopeBar}
      <div class="stats-spacer"></div>
      ${playersPop}
      ${toolsBar}
    </div>
    ${tabsBar}
  </div></div>`;

  // Bannière : séance (mission + groupe, éditable MJ) OU mission (agrégée).
  const partsHtml = allRows.map(r => `<span class="stats-sb-part" title="${_esc(r.name)}">${_statsAvatar(r.id, r.name, 30)}</span>`).join('');
  const sessionBanner = dateKey ? (() => {
    const mission = _statsMissionOf(dateKey), group = _statsGroupOf(dateKey);
    // Lien mission/groupe : bouton EXPLICITE (le ✎ discret n'était pas trouvé).
    const linkBtn = STATE.isAdmin
      ? (mission
          ? `<button class="stats-sb-edit" data-action="_statsEditMission" data-scope="${dateKey}" title="Modifier le lien mission / groupe">✎ Modifier</button>`
          : `<button class="stats-sb-link" data-action="_statsEditMission" data-scope="${dateKey}">🔗 Relier à une mission / un groupe</button>`)
      : '';
    const missLine = mission
      ? `🎯 ${_esc(mission)}${group ? ` <span class="stats-sb-group">· 👥 ${_esc(group)}</span>` : ''} ${linkBtn}`
      : (linkBtn || '<span class="stats-sb-none">Mission non renseignée</span>');
    return `<div class="stats-session-banner">
      <div class="stats-sb-info">
        <div class="stats-sb-date">📅 Séance du ${_statsSessionLabel(dateKey)}</div>
        <div class="stats-sb-mission">${missLine}</div>
      </div>
      ${partsHtml ? `<div class="stats-sb-parts" title="Participants">${partsHtml}</div>` : ''}
    </div>`;
  })() : isAct && selectedAct ? `<div class="stats-session-banner">
      <div class="stats-sb-info">
        <div class="stats-sb-date">📖 Acte — ${scopeDates.length} séance${scopeDates.length > 1 ? 's' : ''} agrégée${scopeDates.length > 1 ? 's' : ''}</div>
        <div class="stats-sb-mission">${_esc(selectedAct.label)} <span class="stats-sb-group">· ${selectedAct.missions.length} mission${selectedAct.missions.length > 1 ? 's' : ''}</span></div>
      </div>
      ${partsHtml ? `<div class="stats-sb-parts" title="Participants">${partsHtml}</div>` : ''}
    </div>` : isMission ? `<div class="stats-session-banner">
      <div class="stats-sb-info">
        <div class="stats-sb-date">🎯 Mission — ${scopeDates.length} séance${scopeDates.length > 1 ? 's' : ''} agrégée${scopeDates.length > 1 ? 's' : ''}</div>
        <div class="stats-sb-mission">${_esc(missionName)}${groupScopeText ? ` <span class="stats-sb-group">· 👥 ${_esc(groupScopeText)}</span>` : ''}</div>
      </div>
      ${partsHtml ? `<div class="stats-sb-parts" title="Participants">${partsHtml}</div>` : ''}
    </div>` : '';

  if (!rows.length) {
    _statsLastSummary = '';
    _statsVisualSummary = null;
    _statsVisualSummaryEnricher = null;
    const why = (sel && sel.size) ? 'les joueurs ciblés'
      : dateKey ? `la séance du ${_statsSessionLabel(dateKey)}`
      : isMission ? `la mission « ${missionName} »` : 'le moment';
    root.innerHTML = `${controls}<div class="stats-empty">Aucune statistique pour ${why}.<br>
      <span>Ajuste la vue ou les joueurs ciblés ci-dessus.</span></div>`;
    if (bind) _statsBindRenderedInteractions(root);
    return;
  }

  // Agrégats du scope
  const aggregate = _statsAggregateRows(rows);
  const GC = aggregate.combat;
  const GS = aggregate.skills;
  const hitRate = aggregate.hitRate;
  const combatMean = combatAverages(GC);
  const actionMean = aggregateActionAverages(GS, aggregate.actionCombat, aggregate.actionExtras);
  const statsAvg = (value) => value == null
    ? '—'
    : Number(value).toLocaleString('fr-FR', { minimumFractionDigits: Number.isInteger(value) ? 0 : 1, maximumFractionDigits: 1 });
  const tallyWithContributors = (itemsOf) => {
    const map = new Map();
    rows.forEach(r => itemsOf(r).forEach(item => {
      if (!item?.n || !item.c) return;
      const cur = map.get(item.n) || { n: item.n, c: 0, byPlayer: new Map() };
      cur.c += item.c;
      cur.byPlayer.set(r.id, (cur.byPlayer.get(r.id) || 0) + item.c);
      map.set(item.n, cur);
    }));
    return [...map.values()].sort((a, b) => b.c - a.c).map(item => {
      const contributors = [...item.byPlayer.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => {
        const row = rows.find(r => r.id === id);
        return row ? { id: row.id, name: row.name, count } : null;
      }).filter(Boolean);
      return { n: item.n, c: item.c, contributors, contributor: contributors[0] || null };
    });
  };
  const spellTally = tallyWithContributors(r => r.spells);
  const skillTally = tallyWithContributors(r => r.perSkill.map(s => ({ n: s.sk, c: s.rolls })));
  const emoteTally = tallyWithContributors(r => r.emotes);
  const topSkill = skillTally[0];

  const metricLeaders = key => topStatTies(rows, row => row.combat[key]);
  const dmgLeaders = metricLeaders('dmgDealt');
  const koLeaders = metricLeaders('kosDealt');
  const healLeaders = metricLeaders('heal');
  const bigHitLeaders = metricLeaders('biggestHit');
  const tankLeaders = metricLeaders('dmgTaken');
  const parryLeaders = metricLeaders('attacksAvoided');
  const mageLeaders = metricLeaders('spellsCast');
  const hitLeaders = topStatTies(
    rows.filter(row => row.combat.attacks >= 3).map(row => ({ ...row, hr: Math.round(row.combat.hits / row.combat.attacks * 100) })),
    row => row.hr,
  );
  const critLeaders = topStatTies(rows, row => row.actionAverages?.crits || 0);
  const fumbleLeaders = topStatTies(rows, row => row.actionAverages?.fumbles || 0);
  const luckLeaders = topStatTies(rows
    .filter(row => (row.actionAverages?.trackedRolls || 0) >= (dateKey ? 6 : 25))
    .map(row => ({ ...row, luckAverage: row.actionAverages?.naturalAvg || 0 })), row => row.luckAverage);
  const emoteLeaders = topStatTies(rows, row => row.emoteTotal);
  const rollLeaders = topStatTies(rows, row => row.sRolls);
  // Le panneau d'audit historique attend encore un personnage unique ; la carte
  // Temps forts, elle, affiche bien tous les ex æquo.
  const topMage = mageLeaders.winners[0];
  // MVP V2 : chaque personnage est mesuré sur des repères absolus. Le filtre
  // « joueurs » intervient seulement après le calcul et la composition des
  // groupes n'a aucune influence sur les scores individuels.
  const needsImpact = renderOverview || renderRanking;
  const mvpDates = needsImpact && !dateKey ? [...new Set(scopeDates || allDates)] : [];
  // Séries par DATE : servent au chronogramme des temps forts (ordre temporel).
  const mvpSessionRows = mvpDates.map(date => {
    const dateRows = _statsRowsFor([date]);
    return {
      date,
      rows: dateRows,
    };
  }).filter(session => session.rows.length > 0);
  // Unité comparable du MVP = une MISSION (pas une date) : une mission jouée en
  // 1 ou plusieurs séances compte pour UNE seule unité, donc son nombre de
  // séances ne gonfle ni ne pénalise le classement (les dates non liées à une
  // mission forment chacune leur propre unité). Avec une seule unité (mission ou
  // date isolée), on reste en mode « séance » — aucune barrière de nb de séances.
  const mvpUnitsMap = new Map();
  for (const { date } of mvpSessionRows) {
    const unitKey = _statsData?.sessions?.[date]?.missionId || `date:${date}`;
    const bucket = mvpUnitsMap.get(unitKey);
    if (bucket) bucket.push(date); else mvpUnitsMap.set(unitKey, [date]);
  }
  const mvpUnitRows = [...mvpUnitsMap.values()]
    .map(dates => ({ date: dates.slice().sort()[0] || '', rows: _statsRowsFor(dates) }))
    .filter(unit => unit.rows.length > 0);
  // Périmètre de calibrage STABLE et GLOBAL : TOUTE la campagne, quelle que soit la
  // vue (séance / mission / acte / groupe). On agrège par unité-mission sur l'ensemble
  // des dates (allDates), pas sur le scope courant → le repère devient une constante
  // et le score d'un même perso ne change plus selon la vue (fini « 105 en séance vs
  // 135 en mission »). `mvpCalibrationRows` reste la fonction d'agrégation importée.
  const calibrationUnitsMap = new Map();
  for (const date of (allDates || [])) {
    const unitKey = _statsData?.sessions?.[date]?.missionId || `date:${date}`;
    const bucket = calibrationUnitsMap.get(unitKey);
    if (bucket) bucket.push(date); else calibrationUnitsMap.set(unitKey, [date]);
  }
  const calibrationUnits = [...calibrationUnitsMap.values()].map(dates => ({ rows: _statsRowsFor(dates) }));
  const calibrationRowsForMvp = needsImpact
    ? (calibrationUnits.length ? mvpCalibrationRows(calibrationUnits) : allRows)
    : [];
  const mvpScores = needsImpact ? scoreMvpView({
    rows: allRows,
    sessionRows: mvpUnitRows.length > 1 ? mvpUnitRows : [],
    visibleIds: sel,
    autoCalibrate: true,
    calibrationRows: calibrationRowsForMvp,
  }) : [];
  const rowsById = new Map(rows.map(row => [row.id, row]));
  const impactRows = mvpScores.map(result => {
    const source = rowsById.get(result.id);
    return source ? {
      ...source,
      impact: result.score,
      impactEligible: result.eligible,
      impactDetails: result.details,
    } : null;
  }).filter(Boolean);
  // Un MVP n'est décerné que si les données le justifient : on exclut les profils
  // en confiance « Fragile » (activité insuffisante) et on ne retombe PLUS sur
  // l'ensemble des profils quand aucun n'est solide → pas de MVP couronné sur du
  // bruit (ex. une séance sans combat, quelques jets).
  const eligibleImpactRows = impactRows.filter(row =>
    row.impactEligible !== false && (row.impactDetails?.confidence?.level || 'low') !== 'low');
  const mvpPool = eligibleImpactRows;
  const topImpact = mvpPool[0]?.impact || 0;
  const mvps = topImpact > 0 ? mvpPool.filter(row => row.impact === topImpact) : [];
  // Award : renvoie { html, txt } pour mutualiser affichage et export.
  const awards = [];
  let awardTotal = 0;
  // Carte-trophée : tous les premiers ex æquo partagent la distinction.
  const award = (id, ic, lbl, winnerRows, val, col) => {
    const winners = (Array.isArray(winnerRows) ? winnerRows : [winnerRows]).filter(row => row?.name);
    if (!winners.length) return '';
    awardTotal += 1;
    if (_statsHiddenAwards.has(id)) return '';
    awards.push(`${ic} ${lbl} : ${winners.map(row => row.name).join(' & ')} (${val})`);
    // Valeur = nombre mis en avant + unité discrète (ex. « 23 dmg »).
    const vm = String(val ?? '').trim().match(/^([\d.,]+\s*%?)\s*(.*)$/);
    const vNum = vm ? vm[1] : String(val ?? '');
    const vUnit = vm ? vm[2] : '';
    return `<div class="stats-trophy" style="--tc:${col}">
      <span class="stats-trophy-medal">${ic}</span>
      <div class="stats-trophy-body">
        <span class="stats-trophy-lbl">${lbl}</span>
        <span class="stats-trophy-who${winners.length > 1 ? ' is-tie' : ''}">${winners.map(row => {
          const char = STATE.characters?.find(x => x.id === row.id) || { nom: row.name };
          return `<span class="stats-trophy-person">${characterAvatarHtml(char, { size: 22, className: 'stats-trophy-av', title: row.name, border: '1px solid rgba(255,255,255,.14)', background: `${col}22`, color: col })}<span>${_esc(row.name)}</span></span>`;
        }).join('')}</span>
      </div>
      <span class="stats-trophy-val"><b>${_esc(vNum)}</b>${vUnit ? `<small>${_esc(vUnit)}</small>` : ''}</span>
    </div>`;
  };

  const charBlock = (r) => {
    const cm = r.combat;
    const combatMean = combatAverages(cm);
    const skillMean = r.skillAverages || aggregateSkillAverages([r]);
    const combatActions = aggregateActionAverages({}, r.actionCombat, r.actionExtras);
    const allActions = r.actionAverages || aggregateActionAverages(skillMean, r.actionCombat, r.actionExtras);
    const rhr = cm.attacks ? Math.round(cm.hits / cm.attacks * 100) : null;
    const avoidRate = cm.attacksTaken ? Math.round(cm.attacksAvoided / cm.attacksTaken * 100) : null;
    const quickMetric = (icon, value, label, color) => `<span class="stats-char-kpi">
      <b${color ? ` style="color:${color}"` : ''}>${Number(value || 0).toLocaleString('fr-FR')}</b><small>${icon} ${label}</small>
    </span>`;
    const fact = (label, value, color = '') => `<span class="stats-char-fact">
      <small>${label}</small><b${color ? ` style="color:${color}"` : ''}>${value}</b>
    </span>`;
    const skillHtml = r.perSkill.length ? `
      <div class="stats-skills">
        ${r.perSkill.slice(0, 6).map(s => `
          <div class="stats-skill-row">
            <span class="stats-skill-name">${_esc(s.sk)}</span>
            <span class="stats-skill-bar"><span style="width:${r.sRolls ? Math.round((s.rolls / r.sRolls) * 100) : 0}%"></span></span>
            <span class="stats-skill-n" title="${s.trackedRolls ? `${s.trackedRolls} jet(s) détaillé(s) sur ${s.rolls}` : 'Moyenne disponible à partir des prochains jets'}">
              ${s.resultAvg != null ? `<b>${statsAvg(s.resultAvg)}</b> moy.` : '— moy.'} · ${s.rolls} jet${s.rolls > 1 ? 's' : ''}${s.crits ? ` · 💥${s.crits}` : ''}${s.fumbles ? ` · 💔${s.fumbles}` : ''}
            </span>
          </div>`).join('')}
      </div>` : '';
    const favsHtml = _statsFavoritesHtml(r.spells, r.emotes);
    const dateBtn = r.hasDates
      ? `<button class="stats-char-btn" data-action="_statsCharDates" data-id="${r.id}" title="Voir les statistiques séance par séance">📅 Séances</button>`
      : '';
    const delBtn = STATE.isAdmin
      ? (dateKey
          ? `<button class="stats-char-btn stats-char-del" data-action="_statsDelChar" data-id="${r.id}" data-date="${_esc(dateKey)}" data-name="${_esc(r.name)}" title="Supprimer uniquement les statistiques de ce personnage pour la séance du ${_statsSessionLabel(dateKey)}">🗑 Cette séance</button>`
          : `<button class="stats-char-btn stats-char-del" data-action="_statsDelChar" data-id="${r.id}" data-name="${_esc(r.name)}" title="Supprimer toutes les statistiques de ce personnage, sur toute la campagne">🗑 Toutes ses stats</button>`)
      : '';
    const char = STATE.characters?.find(x => x.id === r.id) || { nom: r.name };
    const avatar = characterAvatarHtml(char, { size: 38, className: 'stats-char-av', title: r.name });
    const ring = rhr != null
      ? `<span class="stats-char-ring" title="${cm.hits} attaque${cm.hits > 1 ? 's' : ''} réussie${cm.hits > 1 ? 's' : ''} sur ${cm.attacks}">${_statsGauge(rhr, '#22c38e', 42, 5)}<span class="stats-char-rate-txt">${cm.hits}/${cm.attacks}<br>touches</span></span>`
      : `<span class="stats-char-ring stats-char-no-rate">—<small>aucune<br>attaque</small></span>`;
    const charKey = `character:${r.id}`;
    const isOpen = _statsDrawerState.get(charKey) || false;
    return `<details class="stats-char" data-drawer-key="${_esc(charKey)}"${isOpen ? ' open' : ''}>
      <summary class="stats-char-summary">
        <span class="stats-char-id">${avatar}<span><b class="stats-char-name">${_esc(r.name)}</b><small>${cm.attacks} attaque${cm.attacks > 1 ? 's' : ''} · ${r.sRolls} jet${r.sRolls > 1 ? 's' : ''}</small></span></span>
        <span class="stats-char-kpis">
          ${quickMetric('🗡️', cm.dmgDealt, 'Dégâts', '#c9b6ff')}
          ${quickMetric('💚', cm.heal, 'Soin', '#4fd3a6')}
          ${quickMetric('🔮', cm.spellsCast, 'Sorts', '#bca0ff')}
          ${quickMetric('🎲', r.sRolls, 'Jets', '#7fb0ff')}
          ${quickMetric('🛡️', cm.dmgTaken, 'Subis', '#a7b4c4')}
        </span>
        ${ring}
        <span class="stats-char-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="stats-char-body">
        <div class="stats-char-detail-grid">
          <section class="stats-char-detail">
            <h4>⚔️ Combat</h4>
            <div class="stats-char-facts">
              ${fact('Attaques tentées', cm.attacks)}
              ${fact('Attaques réussies', `${cm.hits}/${cm.attacks}`, '#22c38e')}
              ${fact('Taux de touche', rhr == null ? '—' : `${rhr}%`, '#22c38e')}
              ${fact('Dégâts infligés', cm.dmgDealt, '#c9b6ff')}
              ${fact(combatMean.damageAverageEstimated ? 'Dégâts / touche' : 'Dégâts moyens', statsAvg(combatMean.damageAverage), '#c9b6ff')}
              ${fact('Plus gros coup', cm.biggestHit, '#ff8b6b')}
              ${fact('KO infligés', cm.kosDealt, '#ef4444')}
            </div>
          </section>
          <section class="stats-char-detail">
            <h4>🛡️ Protection</h4>
            <div class="stats-char-facts">
              ${fact('Attaques subies', cm.attacksTaken)}
              ${fact('Coups parés / esquivés', cm.attacksAvoided, '#76a9ff')}
              ${fact('Taux d’évitement', avoidRate == null ? '—' : `${avoidRate}%`, '#76a9ff')}
              ${fact('Dégâts encaissés', cm.dmgTaken)}
              ${fact('Plus gros coup subi', cm.biggestTaken)}
              ${fact('Fois mis KO', cm.kosTaken)}
            </div>
          </section>
          <section class="stats-char-detail">
            <h4>🔮 Magie &amp; soutien</h4>
            <div class="stats-char-facts">
              ${fact('Sorts lancés', cm.spellsCast, '#bca0ff')}
              ${fact('Sorts tactiques', cm.tacticalSpells)}
              ${fact('Soutien', cm.supportSpells, '#4fd3a6')}
              ${fact('Contrôle', cm.controlSpells)}
              ${fact('PM dépensés', cm.pmSpent)}
              ${fact('Soin produit', cm.heal, '#4fd3a6')}
              ${fact('Mana rendu', cm.manaHealed, '#76a9ff')}
              ${fact('Émotes', r.emoteTotal)}
            </div>
          </section>
          <section class="stats-char-detail">
            <h4>🎲 Jets &amp; critiques</h4>
            <div class="stats-char-facts">
              ${fact('Jets de compétence', skillMean.rolls, '#7fb0ff')}
              ${fact('Actions de combat', r.combatActionCount ?? '…', '#ff9d7a')}
              ${fact('Tous les jets', allActions.rolls)}
              ${fact('Chance au dé', allActions.naturalAvg == null ? '—' : `${statsAvg(allActions.naturalAvg)}/20`, '#4fd3a6')}
              ${fact('Résultat moyen', statsAvg(allActions.resultAvg), '#7fb0ff')}
              ${fact('Réussites critiques', allActions.crits, '#f4c430')}
              ${fact('Échecs critiques', allActions.fumbles, '#ff6b6b')}
            </div>
          </section>
          ${skillHtml ? `<section class="stats-char-detail stats-char-detail--skills"><h4>🎲 Compétences</h4>${skillHtml}</section>` : ''}
        </div>
        ${(dateBtn || delBtn) ? `<div class="stats-char-actions">${dateBtn}${delBtn}</div>` : ''}
      </div>
    </details>`;
  };

  const combatTitle = dateKey ? `⚔️ Combat — séance du ${_statsSessionLabel(dateKey)}`
    : isMission ? `⚔️ Combat — ${_esc(missionName)}` : '⚔️ Combat (table)';
  const awardCards = [
    award('dmg', '🗡️', 'Plus gros frappeur', dmgLeaders.winners, `${dmgLeaders.value} dmg`, '#f4c430'),
    award('bigHit', '💥', 'Plus gros coup', bigHitLeaders.winners, `${bigHitLeaders.value} dmg`, '#ff8b6b'),
    award('hitRate', '🎯', 'Main sûre', hitLeaders.winners, `${hitLeaders.value} %`, '#22c38e'),
    award('ko', '☠️', 'Bourreau', koLeaders.winners, `${koLeaders.value} KO`, '#ef4444'),
    award('heal', '💚', 'Ange gardien', healLeaders.winners, `${healLeaders.value} PV`, '#4fd3a6'),
    award('mage', '🧙', 'Sorts lancés', mageLeaders.winners, `${mageLeaders.value} sorts`, '#bca0ff'),
    award('tank', '🪨', 'L’Increvable', tankLeaders.winners, `${tankLeaders.value} dmg`, '#9aa0aa'),
    award('parry', '🛡️', 'Le Rempart', parryLeaders.winners, `${parryLeaders.value} évitée${parryLeaders.value > 1 ? 's' : ''}`, '#76a9ff'),
    award('emotes', '💬', 'Émotes envoyées', emoteLeaders.winners, `${emoteLeaders.value} émotes`, '#4f8cff'),
    award('rolls', '🎲', 'Jets de dés', rollLeaders.winners, `${rollLeaders.value} jets`, '#7fb0ff'),
    award('crit', '🌟', 'Béni des dés', critLeaders.winners, `${critLeaders.value} critique${critLeaders.value > 1 ? 's' : ''}`, '#f4c430'),
    award('luck', '🍀', 'Insolente chance', luckLeaders.winners, luckLeaders.value ? `${Number(luckLeaders.value).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} moy. d20` : '', '#31d2a0'),
    award('fumble', '🤡', 'Maudit', fumbleLeaders.winners, `${fumbleLeaders.value} échec${fumbleLeaders.value > 1 ? 's' : ''}`, '#ff6b6b'),
  ].filter(Boolean);
  const awardsHtml = awardCards.join('');

  // Récap texte (export) — construit à partir du scope courant.
  const scopeLabel = dateKey ? `séance du ${_statsSessionLabel(dateKey)}`
    : isAct && selectedAct ? `acte « ${selectedAct.label} »`
    : isMission ? `mission « ${missionName} »${groupScopeText ? ` · groupes ${groupScopeText}` : ''}` : 'toute la campagne';
  const sumLines = [
    `📊 Stats — ${scopeLabel}`,
    `⚔️ ${GC.attacks} attaques (${hitRate}%) · 🗡️ ${GC.dmgDealt} dmg · ☠️ ${GC.kosDealt} KO · 💚 ${GC.heal} PV soignés · 🔮 ${GC.spellsCast} sorts`,
    `📐 Moyennes · 🗡️ ${statsAvg(combatMean.damageAverage)} dégâts/${combatMean.damageAverageEstimated ? 'touche' : 'impact'} · 🎲 action finale ${statsAvg(actionMean.resultAvg)} (d20 ${statsAvg(actionMean.naturalAvg)})`,
    `🎲 ${actionMean.rolls} jets au d20 (${GS.rolls} compétences + ${aggregate.actionCombat.attacks} attaques${actionMean.supplementalRolls ? ` + ${actionMean.supplementalRolls} soins/soutiens` : ''} · 💥 ${actionMean.crits} · 💔 ${actionMean.fumbles})`,
  ];
  if (awards.length) { sumLines.push('', '— Récompenses —', ...awards); }
  sumLines.push('', '— Par personnage —');
  rows.forEach(r => {
    const p = [];
    const rhr = r.combat.attacks ? Math.round(r.combat.hits / r.combat.attacks * 100) : 0;
    if (r.combat.attacks) p.push(`⚔️${r.combat.attacks}·${rhr}%`);
    if (r.combat.dmgDealt) p.push(`🗡️${r.combat.dmgDealt}`);
    if (r.combat.biggestHit) p.push(`💢${r.combat.biggestHit}`);
    if (r.combat.spellsCast) p.push(`🔮${r.combat.spellsCast}`);
    if (r.combat.heal) p.push(`💚${r.combat.heal}`);
    const rCombatMean = combatAverages(r.combat);
    if (rCombatMean.damageAverage != null) p.push(`📐dmg ${statsAvg(rCombatMean.damageAverage)}`);
    if (r.sRolls) p.push(`🎲${r.sRolls}${r.skillAverages?.resultAvg != null ? ` · moy.${statsAvg(r.skillAverages.resultAvg)}` : ''}`);
    sumLines.push(`• ${r.name} : ${p.join(' · ') || '—'}`);
  });
  _statsLastSummary = sumLines.join('\n');

  const heroMetric = (v, l, c) => `<div class="stats-hm"><span class="stats-hm-v" style="color:${c}">${v}</span><span class="stats-hm-l">${l}</span></div>`;
  const drawer = (title, body, { open = false, count = '', key = title, className = '' } = {}) => {
    if (!body) return '';
    const drawerKey = String(key || title);
    const shouldOpen = _statsDrawerState.has(drawerKey) ? _statsDrawerState.get(drawerKey) : open;
    const extraClass = className ? ` ${_esc(className)}` : '';
    return `
    <details class="stats-drawer${extraClass}" data-drawer-key="${_esc(drawerKey)}"${shouldOpen ? ' open' : ''}>
      <summary><span>${title}</span>${count ? `<small>${count}</small>` : ''}</summary>
      <div class="stats-drawer-body">${body}</div>
    </details>`;
  };
  const contextItems = [];
  if (mvpUnitRows.length > 1) contextItems.push(`MVP V2 : médiane de ${mvpUnitRows.length} mission${mvpUnitRows.length > 1 ? 's' : ''} (le nombre de séances d'une mission n'influe pas), repères calibrés et rendements décroissants sans plafond dur.`);
  else contextItems.push('MVP V2 : mission scorée comme une unité (indépendante du nombre de séances), repères calibrés et rendements décroissants sans plafond dur.');
  if (groupCompare.length > 1) contextItems.push('Comparaison des groupes normalisée par séance.');
  if (isAct && selectedAct) contextItems.push(`${selectedAct.missions.length} mission${selectedAct.missions.length > 1 ? 's' : ''} agrégée${selectedAct.missions.length > 1 ? 's' : ''} dans cet acte.`);
  if (!selectedMissionId && !isAct && unlinkedDates.length) contextItems.push(`${unlinkedDates.length} séance${unlinkedDates.length > 1 ? 's' : ''} non reliée${unlinkedDates.length > 1 ? 's' : ''} à une mission.`);
  if (selectedMissionId && selectedMissionDates.length) contextItems.push(`${selectedMissionDates.length} séance${selectedMissionDates.length > 1 ? 's' : ''} liée${selectedMissionDates.length > 1 ? 's' : ''} à cette mission.`);
  if ((GC.attacksTaken || 0) === 0 && (GC.attacksAvoided || 0) === 0) contextItems.push('Attaques subies/évitées : nouvelles stats, non rétroactives.');
  if (actionMean.rolls && (actionMean.coverage < 100 || actionMean.resultCoverage < 100)) {
    contextItems.push(`Moyennes : ${actionMean.resultTrackedRolls}/${actionMean.rolls} jets disposent de leur résultat final détaillé.`);
  }
  const contextSec = renderOverview && contextItems.length ? `
    <section class="stats-context">
      ${contextItems.slice(0, 4).map(x => `<span>${_esc(x)}</span>`).join('')}
    </section>` : '';
  // MVP désigné à la main par le MJ pour la vue courante (override du calcul).
  const _mvpOverrideId = _statsMvpOverrides[_statsMvpScopeKey(_statsScope)] || '';
  const _mvpOverrideRow = _mvpOverrideId
    ? (rowsById.get(_mvpOverrideId) || rows.find(r => r.id === _mvpOverrideId) || null)
    : null;
  const _mvpScopeNoun = _statsScope
    ? (_statsScope.startsWith('mission:') ? 'la mission' : _statsScope.startsWith('act:') ? "l'acte" : 'la séance')
    : 'la campagne';
  // Bouton MJ dans l'EN-TÊTE de la section (pas de carte dans la carte), et bandeau
  // sobre (sans bordure) quand un MVP est choisi à la main.
  const mvpMjBtn = (renderOverview && STATE.isAdmin && rows.length)
    ? `<button class="stats-sec-tool" data-action="_statsMvpOverridePick" title="Désigner le MVP de ${_mvpScopeNoun} à la main">🏆 MVP</button>`
    : '';
  const mvpChosenSec = (renderOverview && _mvpOverrideRow)
    ? `<div class="stats-mvp-chosen">
        <span class="stats-mvp-chosen-tag">🏆 MVP de ${_mvpScopeNoun} · choisi par le MJ</span>
        <span class="stats-mvp-chosen-who">${_statsAvatar(_mvpOverrideRow.id, _mvpOverrideRow.name, 34)}<b>${_esc(_mvpOverrideRow.name)}</b></span>
        ${STATE.isAdmin ? '<button class="stats-mvp-chosen-reset" data-action="_statsMvpClearOverride">↩ Calcul auto</button>' : ''}
      </div>`
    : '';
  let mvpDetailSec = '';
  const mvpSec = renderOverview && mvps.length ? (() => {
    const mvpParts = (leader) => {
      const details = leader.impactDetails || {};
      const parts = [`📊 ${details.confidence?.label || 'Calcul provisoire'}`];
      if (leader.combat.dmgDealt) parts.push(`🗡️ ${leader.combat.dmgDealt} dégâts`);
      if (leader.combat.heal) parts.push(`💚 ${leader.combat.heal} soin`);
      if (leader.combat.spellsCast) parts.push(`🔮 ${leader.combat.spellsCast} sorts`);
      if (leader.combat.tacticalSpells) parts.push(`✨ ${leader.combat.tacticalSpells} tactique`);
      if (leader.combat.supportSpells) parts.push(`🛡️ ${leader.combat.supportSpells} soutien`);
      if (leader.combat.afflictionSpells) parts.push(`💀 ${leader.combat.afflictionSpells} affliction`);
      if (leader.combat.controlSpells) parts.push(`🌀 ${leader.combat.controlSpells} contrôle`);
      if (leader.combat.attacksTaken) parts.push(`🧱 ${leader.combat.attacksTaken} ciblages`);
      if (leader.combat.attacksAvoided) parts.push(`🛡️ ${leader.combat.attacksAvoided} évitées`);
      if (leader.combat.dmgTaken) parts.push(`🩸 ${leader.combat.dmgTaken} subis`);
      if (leader.sRolls) parts.push(`🎲 ${leader.sRolls} jets`);
      if (leader.combat.kosDealt) parts.push(`☠️ ${leader.combat.kosDealt} KO`);
      if (leader.combat.kosTaken) parts.push(`💀 ${leader.combat.kosTaken} à terre`);
      return parts;
    };
    const parts = [];
    if (mvps.length === 1) parts.push(...mvpParts(mvps[0]));
    else mvps.forEach(leader => parts.push(`${_esc(leader.name)} · ${mvpParts(leader).slice(0, 3).join(' · ') || 'impact équilibré'}`));
    const title = mvps.length > 1 ? "MVP d'impact V2 ex æquo" : "MVP d'impact V2";
    const leadersHtml = mvps.map(leader => `<div class="stats-mvp-leader">
      ${_statsAvatar(leader.id, leader.name, 42)}
      <div><span class="stats-mvp-eyebrow">${title}</span><b>${_esc(leader.name)}</b></div>
    </div>`).join('');
    const fmtPts = (v) => {
      const abs = Math.abs(v);
      const txt = Number.isInteger(abs) ? String(abs) : abs.toFixed(1).replace(/\.0$/, '');
      return `${v >= 0 ? '+' : '-'}${txt}`;
    };
    const detailLeaders = impactRows.slice(0, Math.max(4, mvps.length));
    if (!_statsMvpDetailId || !detailLeaders.some(leader => leader.id === _statsMvpDetailId)) {
      _statsMvpDetailId = detailLeaders[0]?.id || '';
    }
    const activeDetailLeader = detailLeaders.find(leader => leader.id === _statsMvpDetailId) || detailLeaders[0];
    const detailTabsHtml = detailLeaders.length > 1 ? `<div class="stats-mvp-tabs">
      ${detailLeaders.map((leader, index) => {
        const details = leader.impactDetails || { score: leader.impact || 0 };
        return `<button type="button" class="${leader.id === activeDetailLeader?.id ? 'active' : ''}" data-action="_statsMvpDetailPick" data-id="${_esc(leader.id)}">
          ${_statsAvatar(leader.id, leader.name, 22)}
          <span>${_esc(leader.name)}<small>${leader.impactEligible === false ? 'Provisoire' : index === 0 ? 'MVP' : `#${index + 1}`}</small></span>
          <b>${details.score}</b>
        </button>`;
      }).join('')}
    </div>` : '';
    const calcHtml = activeDetailLeader ? (() => {
      const leader = activeDetailLeader;
      const index = Math.max(0, detailLeaders.findIndex(x => x.id === leader.id));
      const details = leader.impactDetails || { entries: [], gained: 0, lost: 0, score: leader.impact || 0 };
      const fmtNum = (v) => Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
      const calcRow = (e) => {
        const unit = Math.abs(e.points / Math.max(1, e.count));
        const formula = e.count === 1 ? fmtPts(e.points) : `${e.points < 0 ? '-' : '+'}${e.count} × ${fmtNum(unit)}`;
        const axisMeta = Number.isFinite(Number(e.normalized))
          ? `<span class="stats-mvp-axis-meta">
              <small>${details.mode === 'campaign' ? 'Indice médian' : 'Indice après rendements'} <b>${fmtNum(e.normalized)}</b></small>
              ${details.mode === 'campaign'
                ? `<small>Niveau médian <b>${fmtNum(e.baseNormalized)}%</b></small><small>Historique <b>${details.sessionCount || 1} séance${(details.sessionCount || 1) > 1 ? 's' : ''}</b></small>`
                : `<small>Niveau du repère <b>${fmtNum(e.baseNormalized)}%</b></small><small>Repère fixe <b>${fmtNum(e.reference)}</b></small>`}
              <small>Axe #${e.axisRank || 1} <b>${Math.round((e.dampener ?? 1) * 100)}%</b></small>
            </span>`
          : `<span class="stats-mvp-calc-formula">${e.formula || formula}</span>`;
        const subRows = Array.isArray(e.children) && e.children.length
          ? `<div class="stats-mvp-calc-subrows">${e.children.map(part => {
              const sign = part.points >= 0 ? '+' : '-';
              return `<span><i>${part.icon || ''}</i><b>${_esc(part.label)}</b><em>${fmtNum(part.count)} × ${fmtNum(Math.abs(part.coef || 0))}</em><strong>${sign}${fmtNum(Math.abs(part.points || 0))}</strong></span>`;
            }).join('')}</div>`
          : '';
        return `<div class="stats-mvp-calc-row">
          <span class="stats-mvp-calc-main"><b>${e.icon}</b><span>${_esc(e.label)}</span></span>
          ${axisMeta}
          <strong>${fmtPts(e.points)}</strong>
          ${subRows}
        </div>`;
      };
      const calcGroup = (title, entries, cls) => `<div class="stats-mvp-calc-group ${cls}">
        <div class="stats-mvp-calc-group-title">${title}</div>
        <div class="stats-mvp-calc-rows">${entries.length ? entries.map(calcRow).join('') : '<div class="stats-mvp-calc-empty">Aucun</div>'}</div>
      </div>`;
      const gainedEntries = details.entries.filter(e => e.points > 0);
      const confidence = details.confidence || { label: 'Provisoire', reason: 'couverture inconnue' };
      return `<div class="stats-mvp-calc">
        <div class="stats-mvp-calc-head">
          <div class="stats-mvp-calc-name">${_esc(leader.name)}${index === 0 ? ' · MVP' : ` · candidat #${index + 1}`}</div>
          <div class="stats-mvp-calc-net">${details.score}<span>impact</span></div>
        </div>
        <div class="stats-mvp-calc-total">
          <span>Confiance <b>${_esc(confidence.label)}</b> · ${_esc(confidence.reason || '')}</span>
        </div>
        ${calcGroup('Axes d\'impact', gainedEntries, 'is-gain')}
      </div>`;
    })() : '';
    // Refonte (étape 5) : le drawer verbeux est remplacé par les axes affichés
    // directement dans la carte + le bandeau des candidats (bascule la fiche).
    mvpDetailSec = '';
    const lead = activeDetailLeader || mvps[0];
    const leadDetails = lead?.impactDetails || { entries: [], score: lead?.impact || 0 };
    const isTopLead = detailLeaders[0]?.id === lead?.id;
    const fmtMvpNum = (value) => {
      const number = Number(value) || 0;
      return Number.isInteger(number)
        ? number.toLocaleString('fr-FR')
        : number.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
    };
    const axisFormula = (key) => (MVP_AXIS_GUIDE[key]?.contributions || [])
      .map(item => `${item.label} × ${fmtMvpNum(item.coef)}`)
      .join(' + ');
    // On affiche l'INDICE de performance par axe (repère = 100), pas les points
    // pondérés par le rang : sinon l'axe signature d'un perso (l'offense d'un DPS
    // classé 2e/3e) apparaît écrasé à ~5 % de sa valeur et devient illisible.
    const axisPerf = e => Number.isFinite(Number(e.normalized)) ? Number(e.normalized) : (e.points || 0);
    // Les quatre axes restent visibles, même à zéro : leur absence était une
    // des raisons pour lesquelles les joueurs ne comprenaient pas le calcul.
    const axes = [...(leadDetails.entries || [])].sort((a, b) => (a.axisRank || 9) - (b.axisRank || 9));
    const axesMax = Math.max(...axes.map(axisPerf), 1);
    const axesHtml = axes.map(a => {
      const perf = axisPerf(a);
      const guide = MVP_AXIS_GUIDE[a.key] || {};
      const formula = axisFormula(a.key);
      const contrib = `${guide.summary || a.label} ${formula ? `Calcul brut : ${formula}. ` : ''}Indice ${fmtMvpNum(perf)} (repère 100), puis ${Math.round((a.dampener ?? 1) * 100)} % au rang #${a.axisRank || 1}.`;
      const scaleWidth = Math.round(Math.min(250, Math.max(0, perf)) / 250 * 100);
      return `<div class="stats-axe stats-axe--${_esc(a.key)}" title="${_esc(contrib)}">
      <span class="stats-axe-label"><i></i><b>${_esc(a.label)}</b></span>
      <span class="stats-axe-bar"><i style="width:${scaleWidth}%"></i></span>
      <span class="stats-axe-pts"><b>${fmtMvpNum(perf)}</b><small>%</small></span>
      <span class="stats-axe-weight">${Number(a.points || 0) >= .5 ? `+${fmtMvpNum(a.points)}` : '—'}</span>
    </div>`;
    }).join('');
    const detailedAxesHtml = axes.map(axis => {
      const guide = MVP_AXIS_GUIDE[axis.key] || {};
      const currentParts = leadDetails.mode === 'campaign'
        ? ''
        : (axis.children || []).map(part => `<span>
            <i>${part.icon || '•'}</i>
            <b>${_esc(part.label)}</b>
            <em>${fmtMvpNum(part.count)} × ${fmtMvpNum(part.coef)}</em>
            <strong>${fmtMvpNum(part.points)} pts bruts</strong>
          </span>`).join('');
      const weightPct = Math.round((axis.dampener ?? 0) * 100);
      return `<article class="stats-mvp-rule-axis stats-mvp-rule-axis--${_esc(axis.key)}">
        <header><span>${axis.icon || '•'}</span><div><b>${_esc(axis.label)}</b><small>${_esc(guide.summary || '')}</small></div></header>
        <div class="stats-mvp-rule-formula">${_esc(axisFormula(axis.key))}</div>
        ${guide.note ? `<p>${_esc(guide.note)}</p>` : ''}
        ${currentParts ? `<div class="stats-mvp-rule-parts">${currentParts}</div>` : ''}
        <div class="stats-mvp-rule-chain">
          <span><small>${leadDetails.mode === 'campaign' ? 'Contribution médiane' : 'Contribution brute'}</small><b>${fmtMvpNum(axis.raw)}</b></span>
          <i>→</i><span><small>Repère de la vue</small><b>${fmtMvpNum(axis.reference)}</b></span>
          <i>→</i><span><small>Niveau du repère</small><b>${fmtMvpNum(axis.baseNormalized)}%</b></span>
          <i>→</i><span><small>Après rendements</small><b>${fmtMvpNum(axis.normalized)}</b></span>
          <i>→</i><span><small>Axe #${axis.axisRank || 1} · poids ${weightPct}%</small><b>${fmtPts(axis.points)}</b></span>
        </div>
      </article>`;
    }).join('');
    const weightsLabel = MVP_SCORING_GUIDE.axisWeights.map((weight, index) => `axe #${index + 1} : ${Math.round(weight * 100)} %`).join(' · ');
    const capsLabel = MVP_SCORING_GUIDE.softCaps.map((tier, index, tiers) => {
      const start = index ? tiers[index - 1].upTo : 0;
      return Number.isFinite(tier.upTo)
        ? `${start}–${tier.upTo} à ${Math.round(tier.multiplier * 100)} %`
        : `au-delà de ${start} à ${Math.round(tier.multiplier * 100)} %`;
    }).join(' · ');
    const mvpExplanationHtml = `<details class="stats-mvp-rules">
      <summary><span><b>Comment ce score est-il calculé ?</b><small>Formules, repères et poids des quatre axes</small></span><i>⌄</i></summary>
      <div class="stats-mvp-rules-body">
        <div class="stats-mvp-rule-intro">
          <p><b>1.</b> Les actions produisent des points bruts dans un seul axe. <b>2.</b> Ce total est comparé au repère de la vue : atteindre le repère donne un indice 100. <b>3.</b> Les rendements deviennent progressivement plus faibles au-dessus de 100. <b>4.</b> Les axes du personnage sont classés, puis pondérés avant addition.</p>
          <span><b>Poids :</b> ${_esc(weightsLabel)}</span>
          <span><b>Rendements :</b> ${_esc(capsLabel)}</span>
          <span><b>Repères :</b> médiane des contributions positives quand au moins ${MVP_SCORING_GUIDE.minimumCalibrationSamples} profils sont disponibles ; sinon valeurs stables par défaut.</span>
          ${leadDetails.mode === 'campaign' ? `<span><b>Vue actuelle :</b> chaque mission compte comme une unité ; le score affiché utilise la médiane de ${leadDetails.sessionCount || 1} mission${(leadDetails.sessionCount || 1) > 1 ? 's' : ''}, pas leur cumul.</span>` : '<span><b>Vue actuelle :</b> les valeurs ci-dessous correspondent directement à la mission ou séance affichée.</span>'}
        </div>
        <div class="stats-mvp-rule-grid">${detailedAxesHtml}</div>
      </div>
    </details>`;
    const runnersHtml = detailLeaders.length > 1 ? `<div class="stats-mvp-runners">
      ${detailLeaders.slice(0, 4).map((p, i) => `<button type="button" class="stats-runner${p.id === lead?.id ? ' on' : ''}" data-action="_statsMvpDetailPick" data-id="${_esc(p.id)}">
        ${_statsAvatar(p.id, p.name, 24)}<span>${_esc(p.name)}<em>${i === 0 ? 'MVP' : '#' + (i + 1)}</em></span><b>${p.impactDetails?.score ?? p.impact}</b>
      </button>`).join('')}</div>` : '';
    const mvpMode = leadDetails.mode === 'campaign'
      ? `médiane de ${leadDetails.sessionCount || mvpUnitRows.length || 1} mission${(leadDetails.sessionCount || mvpUnitRows.length || 1) > 1 ? 's' : ''}`
      : 'sur cette séance';
    const confidence = leadDetails.confidence || { level: 'low', label: 'Provisoire' };
    return `<div class="stats-mvp">
      <div class="stats-mvp-top">
        ${_statsAvatar(lead.id, lead.name, 58)}
        <div class="stats-mvp-name"><span class="stats-mvp-k">${isTopLead ? 'Meilleur impact' : 'Candidat au MVP'}</span><b>${_esc(lead.name)}</b><small>${_esc(mvpMode)} · <span class="stats-mvp-confidence is-${_esc(confidence.level || 'low')}">${_esc(confidence.label || 'Provisoire')}</span></small></div>
        <div class="stats-mvp-sc"><b>${leadDetails.score ?? lead.impact}</b><small>points</small></div>
      </div>
      <div class="stats-axes">${axesHtml || '<div class="stats-empty-inline">Aucun axe positif sur ce périmètre.</div>'}</div>
      <p class="stats-v2-mvp-note">Barre = performance par rapport au <b>repère</b> du périmètre (trait = 100 %, la performance médiane). L’axe dominant compte en entier, le 2ᵉ à 20 %, le 3ᵉ à 5 %.</p>
      <div class="stats-mvp-footer">${runnersHtml}<button type="button" data-action="_statsMvpExplain"><span aria-hidden="true">ⓘ</span> Comment c’est calculé ?</button></div>
    </div>`;
  })() : '';
  const groupMax = {
    dmg: Math.max(1, ...groupCompare.map(g => (g.combat.dmgDealt || 0) / Math.max(1, g.count))),
    heal: Math.max(1, ...groupCompare.map(g => (g.combat.heal || 0) / Math.max(1, g.count))),
    spells: Math.max(1, ...groupCompare.map(g => (g.combat.spellsCast || 0) / Math.max(1, g.count))),
    rolls: Math.max(1, ...groupCompare.map(g => (g.skills.rolls || 0) / Math.max(1, g.count))),
    hit: Math.max(1, ...groupCompare.map(g => g.hitRate || 0)),
  };
  const groupMetricLine = (ic, lbl, val, max, col, suffix = '', sessions = 1, normalize = true) => {
    const base = normalize ? (_statsNum(val) / Math.max(1, sessions)) : _statsNum(val);
    const avg = normalize && sessions > 1 ? `<small>${Number.isInteger(base) ? base : base.toFixed(1)}/séance</small>` : '';
    return `<div class="stats-group-metric" style="--gm:${col}">
    <span class="stats-group-metric-lbl"><span>${ic}</span>${lbl}</span>
    <span class="stats-group-metric-bar"><span style="width:${Math.max(3, Math.round((base / max) * 100))}%"></span></span>
    <b>${val}${suffix}${avg}</b>
  </div>`;
  };
  const groupSessionItem = (x) => `<div class="stats-group-session">
    <div class="stats-group-session-main">
      <span class="stats-time-date">📅 ${_statsSessionLabel(x.d)}</span>
      <span class="stats-time-avatars">${x.rows.slice(0, 6).map(r => _statsAvatar(r.id, r.name, 18)).join('')}</span>
    </div>
    <div class="stats-time-metrics">
      <span>🗡️ ${x.combat.dmgDealt}</span>
      <span>💚 ${x.combat.heal}</span>
      <span>🔮 ${x.combat.spellsCast}</span>
      <span>🎲 ${x.skills.rolls}</span>
    </div>
  </div>`;
  const missionGroupsSec = renderRanking && groupCompare.length ? `
    <section class="stats-sec">
      <div class="stats-sec-hd">👥 Groupes & séances</div>
      <div class="stats-mission-groups">
        ${groupCompare.map(g => {
          const sessions = [...g.dates].sort().map(d => {
            const dateRowsRaw = _statsRowsFor([d]);
            const dateRows = (sel && sel.size) ? dateRowsRaw.filter(r => sel.has(r.id)) : dateRowsRaw;
            const agg = _statsAggregateRows(dateRows);
            return { d, rows: dateRows, ...agg };
          }).filter(x => x.rows.length || x.combat.attacks || x.skills.rolls);
          return `<div class="stats-group-card stats-group-card--merged">
            <div class="stats-group-hd">
              <div class="stats-group-title" title="${_esc(g.label)}">👥 ${_esc(g.label)}</div>
              <span class="stats-group-count">📅 ${g.count}</span>
            </div>
            <div class="stats-group-roster">
              <span class="stats-group-roster-lbl">Participants</span>
              <span class="stats-group-members">${g.quest ? _statsGroupMembersMiniHtml(g.quest) : g.rows.slice(0, 5).map(r => _statsAvatar(r.id, r.name, 18)).join('')}</span>
            </div>
            <div class="stats-group-metrics">
              ${groupMetricLine('🗡️', 'Dégâts', g.combat.dmgDealt, groupMax.dmg, '#c9b6ff', '', g.count)}
              ${groupMetricLine('💚', 'Soin', g.combat.heal, groupMax.heal, '#4fd3a6', '', g.count)}
              ${groupMetricLine('🔮', 'Sorts', g.combat.spellsCast, groupMax.spells, '#bca0ff', '', g.count)}
              ${groupMetricLine('🎲', 'Jets', g.skills.rolls, groupMax.rolls, '#7fb0ff', '', g.count)}
              ${groupMetricLine('🎯', 'Touche', g.hitRate, groupMax.hit, '#22c38e', '%', 1, false)}
            </div>
            ${sessions.length ? drawer('Séances jouées', `<div class="stats-group-sessions">${sessions.map(groupSessionItem).join('')}</div>`, { key: `group-sessions:${g.key}`, count: `${sessions.length}` }) : ''}
          </div>`;
        }).join('')}
      </div>
    </section>` : '';
  _statsVisualSummary = {
    scopeLabel,
    hitRate,
    metrics: [
      ['Attaques', GC.attacks, '#ff9d7a'],
      ['Dégâts', GC.dmgDealt, '#c9b6ff'],
      ['Sorts', GC.spellsCast, '#bca0ff'],
      ['Soin', GC.heal, '#4fd3a6'],
      ['Jets', GS.rolls, '#7fb0ff'],
    ],
    awards: awards.slice(0, 6),
    mvp: mvps.length ? { name: mvps.map(x => x.name).join(' & '), score: topImpact } : null,
    groups: groupCompare.slice(0, 4).map(g => ({
      label: g.label,
      dmg: g.combat.dmgDealt,
      heal: g.combat.heal,
      rolls: g.skills.rolls,
      sessions: g.count,
      dmgAvg: Math.round((g.combat.dmgDealt || 0) / Math.max(1, g.count)),
    })),
  };
  _statsVisualSummaryEnricher = needsImpact ? null : () => {
    const exportDates = dateKey ? [] : [...new Set(scopeDates || allDates)];
    const exportSessions = exportDates
      .map(date => ({ date, rows: _statsRowsFor([date]) }))
      .filter(session => session.rows.length > 0);
    const exportScores = scoreMvpView({ rows: allRows, sessionRows: exportSessions, visibleIds: sel, autoCalibrate: true });
    const exportRowsById = new Map(rows.map(row => [row.id, row]));
    const exportImpactRows = exportScores.map(result => {
      const source = exportRowsById.get(result.id);
      return source ? { ...source, impact: result.score, impactEligible: result.eligible } : null;
    }).filter(Boolean);
    const eligibleRows = exportImpactRows.filter(row => row.impactEligible !== false);
    const exportPool = eligibleRows.length ? eligibleRows : exportImpactRows;
    const exportTop = exportPool[0]?.impact || 0;
    const exportMvps = exportTop > 0 ? exportPool.filter(row => row.impact === exportTop) : [];
    const exportGroups = groupCompareOptions.map(comparableAggregate).filter(g => g.active);
    return {
      mvp: exportMvps.length ? { name: exportMvps.map(x => x.name).join(' & '), score: exportTop } : null,
      groups: exportGroups.slice(0, 4).map(g => ({
        label: g.label,
        dmg: g.combat.dmgDealt,
        heal: g.combat.heal,
        rolls: g.skills.rolls,
        sessions: g.count,
        dmgAvg: Math.round((g.combat.dmgDealt || 0) / Math.max(1, g.count)),
      })),
    };
  };

  // ── Sections (recomposées en colonnes plus bas) ──
  const emoteTotal = rows.reduce((s, r) => s + r.emoteTotal, 0);
  const detailRow = (ic, lbl, val, hint = '') => `<div class="stats-detail-row">
    <span>${ic} ${lbl}${hint ? `<small>${hint}</small>` : ''}</span><b>${val}</b>
  </div>`;
  const detailPanel = (title, rowsHtml) => `<section class="stats-detail-panel">
    <div class="stats-detail-title">${title}</div>
    <div class="stats-detail-rows">${rowsHtml}</div>
  </section>`;
  const combatSec = renderAudit ? detailPanel(combatTitle, [
    detailRow('⚔️', 'Attaques', GC.attacks),
    detailRow('🎯', 'Taux de réussite', `${hitRate}%`),
    detailRow('D20', 'Jet naturel moyen', statsAvg(combatMean.attackNaturalAverage)),
    detailRow('∑', 'Jet final moyen', statsAvg(combatMean.attackResultAverage)),
    detailRow('🗡️', 'Dégâts infligés', GC.dmgDealt),
    detailRow('💥', 'Réussites critiques', GC.crits),
    detailRow('💔', 'Échecs critiques', GC.fumbles),
    detailRow('🛡️', 'Dégâts subis', GC.dmgTaken),
    detailRow('🧾', 'Surplus ignoré', GC.damageTakenCorrection, 'dégâts théoriques au-delà des PV réellement perdus'),
    detailRow('🧱', 'Attaques subies', GC.attacksTaken, 'nouvelles stats'),
    detailRow('🛡️', 'Attaques évitées', GC.attacksAvoided, 'nouvelles stats'),
    detailRow('☠️', 'KO infligés', GC.kosDealt),
    detailRow('💀', 'Fois mis KO', GC.kosTaken),
  ].join('')) : '';
  const magicSec = renderAudit ? detailPanel('🔮 Magie & soutien', [
    detailRow('🔮', 'Sorts lancés', GC.spellsCast),
    detailRow('✨', 'Sorts tactiques', GC.tacticalSpells),
    detailRow('🛡️', 'Soutien appliqué', GC.supportSpells),
    detailRow('💀', 'Afflictions appliquées', GC.afflictionSpells),
    detailRow('🌀', 'Contrôles appliqués', GC.controlSpells, 'nouvelle statistique'),
    detailRow('🔋', 'PM dépensés', GC.pmSpent),
    detailRow('💚', 'Soin prodigué', GC.heal),
    detailRow('🧙', 'Lanceur le + actif', topMage ? _esc(topMage.name) : '—'),
  ].join('')) : '';
  const competencesSec = renderAudit ? detailPanel('🎲 Compétences & RP', [
    detailRow('🎲', 'Jets de compétence', GS.rolls),
    detailRow('💥', 'Réussites critiques', GS.crits),
    detailRow('💔', 'Échecs critiques', GS.fumbles),
    detailRow('💬', 'Émotes utilisées', emoteTotal),
    detailRow('🏅', 'Compétence la + jouée', topSkill ? _esc(topSkill.n) : '—'),
  ].join('')) : '';
  const podiumMeta = (e) => e.contributor ? `<span class="stats-pod-caster" title="${_esc((e.contributors || []).map(c => `${c.name} ×${c.count}`).join(' · '))}">
    <span class="stats-pod-caster-avatars">${(e.contributors || []).slice(0, 4).map(c => _statsAvatar(c.id, c.name, 18)).join('')}${(e.contributors || []).length > 4 ? `<span class="stats-pod-more">+${(e.contributors || []).length - 4}</span>` : ''}</span>
    <span>${_esc(e.contributor.name)}${(e.contributors || []).length > 1 ? ` +${(e.contributors || []).length - 1}` : ''}</span>${e.contributor.count !== e.c ? `<small>×${e.contributor.count}</small>` : ''}
  </span>` : '';
  const palmaresSec = _statsTab === 'ranking' && (spellTally.length || emoteTally.length || skillTally.length) ? `
    <section class="stats-sec">
      <div class="stats-podiums">
        ${_statsPodium('Sorts lancés', spellTally, null, { icon: '🔮', accent: '#bca0ff', meta: podiumMeta })}
        ${_statsPodium('Compétences jouées', skillTally, null, { icon: '🎲', accent: '#7fb0ff', meta: podiumMeta })}
        ${_statsPodium('Émotes utilisées', emoteTally, (l) => _statsEmoteHtml(l, 'stats-emote-sm'), { icon: '😄', accent: '#4fd3a6', meta: podiumMeta })}
      </div>
    </section>` : '';

  const detailedKpisHtml = renderAudit
    ? `<div class="stats-detail-grid">${combatSec}${magicSec}${competencesSec}</div>`
    : '';
  const sortedRows = renderPlayers
    ? [...rows].sort((a, b) => (b.combat.attacks + b.sRolls) - (a.combat.attacks + a.sRolls))
    : [];
  const charsHtml = renderPlayers ? `<section class="stats-sec stats-roster-sec">
    <div class="stats-chars">${sortedRows.map(charBlock).join('')}</div>
  </section>` : '';
  const statChip = (ic, value, label, color) => `<div class="stats-score-chip" style="--sc:${color}">
    <span>${ic}</span><b>${value}</b><small>${label}</small>
  </div>`;
  const scopeDateCount = Array.isArray(scopeDates) ? scopeDates.length : allDates.length;
  const averageCard = (icon, value, label, sample, color, suffix = '') => `<article class="stats-average-card" style="--avg:${color}">
    <span class="stats-average-icon">${icon}</span>
    <span class="stats-average-copy"><small>${label}</small><b>${statsAvg(value)}${value == null ? '' : suffix}</b><em>${sample}</em></span>
  </article>`;
  const actionBreakdown = [
    GS.rolls ? `${GS.rolls} compétence${GS.rolls > 1 ? 's' : ''}` : '',
    aggregate.actionCombat.attacks ? `${aggregate.actionCombat.attacks} attaque${aggregate.actionCombat.attacks > 1 ? 's' : ''}` : '',
    actionMean.supplementalRolls ? `${actionMean.supplementalRolls} soin${actionMean.supplementalRolls > 1 ? 's' : ''}/soutien` : '',
  ].filter(Boolean).join(' + ') || 'Aucune action au d20';
  // ── Jets & moyennes : compétences, combat, puis vue réellement globale. ──
  const _luckInline = (v) => { const n = Number(v); if (!Number.isFinite(n)) return '<span class="stats-tbl-z">—</span>'; const cls = n > 10.5 ? 'is-lucky' : n < 10.5 ? 'is-unlucky' : 'is-even'; return `<span class="stats-luck ${cls}">${statsAvg(n)}<small>/20</small></span>`; };
  const combatActionMean = aggregateActionAverages({}, aggregate.actionCombat, aggregate.actionExtras);
  const _rollMetric = (label, value, hint, color) => `<span class="stats-roll-metric" style="--rm:${color}"><small>${label}</small><b>${value}</b><em>${hint}</em></span>`;
  const _rollGroup = (icon, title, subtitle, values, color) => `<article class="stats-roll-group" style="--rg:${color}">
    <header><span>${icon}</span><div><b>${title}</b><small>${subtitle}</small></div></header>
    <div>${values.join('')}</div>
  </article>`;
  const _sortRollRows = (items, table, getters) => {
    const active = _statsRollSort.table === table;
    const key = active && getters[_statsRollSort.key] ? _statsRollSort.key : 'count';
    const dir = active ? _statsRollSort.dir : -1;
    return [...items].sort((a, b) => {
      const av = getters[key](a), bv = getters[key](b);
      if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv), 'fr') * dir;
      return ((_statsNum(av) - _statsNum(bv)) || String(a.name || a.sk || '').localeCompare(String(b.name || b.sk || ''), 'fr')) * dir;
    });
  };
  const _rollTh = (table, key, label, className = '') => {
    const active = _statsRollSort.table === table && _statsRollSort.key === key;
    return `<th class="${className}${className ? ' ' : ''}stats-th-sort${active ? ' on' : ''}" data-action="_statsSortRolls" data-table="${table}" data-key="${key}">${label}${active ? `<span class="stats-th-arw">${_statsRollSort.dir === -1 ? '▼' : '▲'}</span>` : ''}</th>`;
  };
  const skillGetters = {
    name: s => s.sk, count: s => s.rolls, natural: s => s.naturalAvg ?? -1,
    result: s => s.resultAvg ?? -1, crits: s => s.crits + s.fumbles,
  };
  const _skillsSorted = _sortRollRows(GS.perSkill || [], 'skills', skillGetters);
  const _skMax = Math.max(..._skillsSorted.map(s => s.rolls), 1);
  const averageSkillRows = renderRolls ? _skillsSorted.map(s => `<tr>
    <td class="stats-td-who"><span class="stats-who-in"><b>${_esc(s.sk)}</b></span></td>
    <td><span class="stats-cellbar" style="--mc:#7fb0ff"><i style="width:${Math.round(s.rolls / _skMax * 100)}%"></i><b>${s.rolls}</b></span></td>
    <td>${_luckInline(s.naturalAvg)}</td>
    <td class="on">${statsAvg(s.resultAvg)}</td>
    <td><span style="color:var(--amber)">💥 ${s.crits}</span> <span class="stats-dim">${s.critRate || 0}%</span> &nbsp; <span style="color:var(--crimson)">💔 ${s.fumbles}</span> <span class="stats-dim">${s.fumbleRate || 0}%</span></td>
  </tr>`).join('') : '';
  const combatRowsRaw = rows.map(row => ({
    ...row,
    combatActions: aggregateActionAverages({}, row.actionCombat, row.actionExtras),
    actionCount: row.combatActionCount,
  })).filter(row => (row.actionCount ?? row.combatActions.rolls) > 0);
  const combatGetters = {
    name: r => r.name, count: r => r.actionCount ?? r.combatActions.rolls, natural: r => r.combatActions.naturalAvg ?? -1,
    result: r => r.combatActions.resultAvg ?? -1, crits: r => r.combatActions.crits + r.combatActions.fumbles,
  };
  const combatRows = _sortRollRows(combatRowsRaw, 'combat', combatGetters);
  const _combatMax = Math.max(...combatRows.map(r => r.actionCount ?? r.combatActions.rolls), 1);
  const averageCombatRows = renderRolls ? combatRows.map(r => {
    const a = r.combatActions;
    const actionCount = r.actionCount ?? a.rolls;
    return `<tr>
      <td class="stats-td-who"><span class="stats-who-in">${_statsAvatar(r.id, r.name, 22)}<b>${_esc(r.name)}</b></span></td>
      <td><span class="stats-cellbar" style="--mc:#ff9d7a"><i style="width:${Math.round(actionCount / _combatMax * 100)}%"></i><b>${actionCount}</b></span></td>
      <td>${_luckInline(a.naturalAvg)}</td>
      <td class="on">${statsAvg(a.resultAvg)}</td>
      <td><span style="color:var(--amber)">💥 ${a.crits}</span> <span class="stats-dim">${a.critRate || 0}%</span> &nbsp; <span style="color:var(--crimson)">💔 ${a.fumbles}</span> <span class="stats-dim">${a.fumbleRate || 0}%</span></td>
    </tr>`;
  }).join('') : '';
  const skillHist = Array.isArray(GS.hist) ? GS.hist : Array(20).fill(0);
  const attackHist = Array.from({ length: 20 }, (_, index) => rows.reduce((sum, row) =>
    sum + Number(row.actionCombat?.attackHist?.[index] || 0) + Number(row.actionExtras?.hist?.[index] || 0), 0));
  const diceHist = _statsDiceKind === 'skills' ? skillHist : _statsDiceKind === 'attacks' ? attackHist
    : skillHist.map((value, index) => value + attackHist[index]);
  const diceTracked = diceHist.reduce((sum, value) => sum + value, 0);
  const diceAverage = diceTracked ? diceHist.reduce((sum, value, index) => sum + value * (index + 1), 0) / diceTracked : null;
  const dicePeople = rows.map(row => {
    const skill = Array.isArray(row.skillAverages?.hist) ? row.skillAverages.hist : Array(20).fill(0);
    const attacks = Array.from({ length: 20 }, (_, index) => Number(row.actionCombat?.attackHist?.[index] || 0) + Number(row.actionExtras?.hist?.[index] || 0));
    const hist = _statsDiceKind === 'skills' ? skill : _statsDiceKind === 'attacks' ? attacks : skill.map((value, index) => value + attacks[index]);
    const count = hist.reduce((sum, value) => sum + value, 0);
    const average = count ? hist.reduce((sum, value, index) => sum + value * (index + 1), 0) / count : null;
    return { id: row.id, name: row.name, count, average, crits: hist[19] || 0, fumbles: hist[0] || 0 };
  }).filter(row => row.count).sort((a, b) => b.average - a.average);
  const dicePeopleHtml = dicePeople.length ? `<section class="stats-v2-dice-people stats-v2-dice-card"><header><div><span>Qui a la main chaude ?</span><h3>Chance par personnage</h3></div></header><div>${dicePeople.map(person => {
    const offset = Math.max(-1, Math.min(1, (person.average - 10.5) / 3));
    return `<article class="${person.count < 20 ? 'is-provisional' : ''}" title="${person.count < 20 ? 'Échantillon faible : moins de 20 jets détaillés' : ''}">${_statsAvatar(person.id, person.name, 24)}<b>${_esc(person.name)}</b><span class="stats-v2-luck-track"><i style="--luck:${offset}"></i></span><strong class="${person.average >= 10.8 ? 'is-lucky' : person.average <= 10.2 ? 'is-unlucky' : ''}">${person.average.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong><small>${person.count} jets · ${person.crits}★ ${person.fumbles}✕</small></article>`;
  }).join('')}</div><p>Barre centrée sur 10,5 (vert = au-dessus, rouge = en dessous, pleine à ±3). Grisé = moins de 20 jets : trop peu pour conclure.</p></section>` : '';
  const _avgNote = (!actionMean.trackedRolls || actionMean.coverage < 100 || actionMean.resultCoverage < 100 || combatMean.damageAverageEstimated)
    ? `<div class="stats-note"><span>ℹ️</span><span>Le journal VTT complet de l’aventure est pris en compte, sans limite de 500 entrées. Un tiret signifie que certaines actions très anciennes ne contenaient pas encore la valeur détaillée du d20 ou de ses bonus ; leur nombre et leurs critiques restent comptés.</span></div>` : '';
  const averagesHtml = renderRolls ? `<section class="stats-v2-section stats-v2-dice" id="moyennes">
    <header class="stats-v2-page-head"><div><h2>Dés & chance</h2></div><nav class="stats-segm"><button type="button" class="${_statsDiceKind === 'all' ? 'on' : ''}" data-action="_statsDiceKind" data-kind="all">Tous les jets</button><button type="button" class="${_statsDiceKind === 'skills' ? 'on' : ''}" data-action="_statsDiceKind" data-kind="skills">Compétences</button><button type="button" class="${_statsDiceKind === 'attacks' ? 'on' : ''}" data-action="_statsDiceKind" data-kind="attacks">Attaques</button></nav></header>
    <div class="stats-v2-dice-overview">
      <section class="stats-v2-dice-card stats-v2-dice-summary"><header><div><span>Synthèse</span><h3>Chance au dé</h3></div></header><div class="stats-v2-dice-average"><small>Moyenne naturelle</small><b>${diceAverage == null ? '—' : diceAverage.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</b><span>/ 20 · théorie 10,5</span><i style="--avg:${diceAverage == null ? 50 : Math.max(0, Math.min(100, diceAverage / 20 * 100))}%"><u></u></i><em><span>1</span><span>10,5</span><span>20</span></em></div><div class="stats-v2-luck"><div><small>Jets détaillés</small><b>${diceTracked.toLocaleString('fr-FR')}</b></div><div><small>Réussites critiques</small><b>${diceHist[19] || 0} <i>${diceTracked ? ((diceHist[19] || 0) / diceTracked * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : 0}%</i></b><span>attendu 5 %</span></div><div><small>Échecs critiques</small><b>${diceHist[0] || 0} <i>${diceTracked ? ((diceHist[0] || 0) / diceTracked * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : 0}%</i></b><span>attendu 5 %</span></div></div><p>${diceTracked.toLocaleString('fr-FR')} jets au d20 détaillés. Les plus anciens peuvent n’enregistrer que leur nombre et leurs critiques.</p></section>
      <section class="stats-v2-dice-card stats-v2-dice-hist"><header><div><span>Distribution</span><h3>Faces obtenues <em>Nouveau</em></h3></div></header>${_statsHistogramHtml(diceHist, { tone: _statsDiceKind })}<p>Chaque face devrait sortir environ 5 %. Un écart isolé est normal : regarde la tendance, pas une barre.</p></section>
    </div>
    ${dicePeopleHtml}
    ${_avgNote}
    <section class="stats-v2-dice-card stats-v2-skills"><header><div><span>Compétences</span><h3>Par compétence</h3></div><small>${_skillsSorted.length} compétence${_skillsSorted.length > 1 ? 's' : ''} jouée${_skillsSorted.length > 1 ? 's' : ''}</small></header><div class="stats-tbl-wrap"><table class="stats-tbl">
      <thead><tr>${_rollTh('skills', 'name', 'Compétence', 'stats-th-who')}${_rollTh('skills', 'count', 'Nombre')}${_rollTh('skills', 'natural', 'Chance au dé')}${_rollTh('skills', 'result', 'Résultat moyen')}${_rollTh('skills', 'crits', 'Crit. / échecs')}</tr></thead>
      <tbody>${averageSkillRows || '<tr><td colspan="5" class="stats-tbl-z" style="text-align:center;padding:16px">Aucun jet de compétence sur ce périmètre.</td></tr>'}</tbody>
    </table></div></section>
  </section>` : '';
  // Scoreboard (refonte) : jauge + périmètre, puis 5 KPI avec delta vs séance
  // précédente + sparkline. Les séries réutilisent les rows par séance déjà
  // calculées pour le MVP (aucune lecture Firestore supplémentaire) ; on les
  // remet en ordre chronologique et on applique le filtre « joueurs ».
  const chronoSessions = renderOverview ? [...mvpSessionRows]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(s => ({
      date: s.date,
      agg: _statsAggregateRows((sel && sel.size) ? s.rows.filter(r => sel.has(r.id)) : s.rows),
      mission: _statsMissionOf(s.date),
      group: _statsGroupOf(s.date),
      participants: ((sel && sel.size) ? s.rows.filter(r => sel.has(r.id)) : s.rows).length,
    })) : [];
  const kpiSeries = chronoSessions.map(s => s.agg);
  const _statsSessMetric = (agg, key) => key === 'rolls' ? (agg?.skills?.rolls || 0) : (agg?.combat?.[key] || 0);
  const _kpiNum = (v) => Number(v || 0).toLocaleString('fr-FR');
  const KPI_DEFS = [
    ['DMG', GC.dmgDealt, 'D&eacute;g&acirc;ts inflig&eacute;s', '#ff8b6b', a => a.combat.dmgDealt, 'dmgDealt'],
    ['KO', GC.kosDealt, 'Ennemis mis KO', '#ff7a59', a => a.combat.kosDealt, 'kosDealt'],
    ['PV', GC.heal, 'Soin prodigu&eacute;', '#31d2a0', a => a.combat.heal, 'heal'],
    ['SUB', GC.dmgTaken, 'D&eacute;g&acirc;ts encaiss&eacute;s', '#8fb7e8', a => a.combat.dmgTaken, 'dmgTaken'],
    ['DOWN', GC.kosTaken, 'PJ mis &agrave; terre', '#ff5a7e', a => a.combat.kosTaken, 'kosTaken'],
  ];
  const _statsKpi = (short, value, label, color, pick, metricKey) => {
    const vals = kpiSeries.map(pick);
    const n = vals.length;
    const referenceValues = dateKey ? allDates.filter(key => key !== dateKey).map(key => {
      const dateRows = _statsRowsFor([key]);
      return pick(_statsAggregateRows((sel && sel.size) ? dateRows.filter(row => sel.has(row.id)) : dateRows));
    }) : [];
    const reference = referenceValues.length ? referenceValues.reduce((sum, item) => sum + item, 0) / referenceValues.length : null;
    const d = dateKey && reference != null ? value - reference : null;
    const prev = dateKey ? reference : 0;
    const pct = (d != null && prev) ? Math.round(d / prev * 100) : null;
    const hasDelta = d != null && Math.abs(pct || 0) >= 8;
    const drillKey = ({ DMG: 'dmg', KO: 'ko', PV: 'heal', SUB: 'taken', DOWN: 'taken' })[short] || 'impact';
    return `<button type="button" class="stats-kpi${_statsEvoMetric === metricKey ? ' on' : ''}" style="--mc:${color}" data-action="_statsKpiDrill" data-key="${drillKey}">
      <div class="stats-kpi-t"><span class="stats-kpi-label"><i></i><span>${label}</span></span>${hasDelta ? `<span class="stats-kpi-d ${d >= 0 ? 'up' : 'down'}${(short === 'SUB' || short === 'DOWN') ? ' is-inverse' : ''}">${d >= 0 ? '▲' : '▼'} ${pct != null ? Math.abs(pct) + '%' : Math.abs(d)}</span>` : (dateKey && reference != null ? '<span class="stats-kpi-d is-even">≈</span>' : '')}</div>
      <div class="stats-kpi-v">${_kpiNum(value)}</div>
      <div class="stats-kpi-sub">${scopeDateCount > 1 ? `≈ ${statsAvg(value / Math.max(1, scopeDateCount))} par séance` : hasDelta ? 'vs moyenne des séances' : 'séance sélectionnée'}</div>
      ${_statsMiniBars(vals)}
    </button>`;
  };
  const heroSec = renderOverview ? `<section class="stats-board">
    <div class="stats-bd-id">
      <div class="stats-bd-copy">
        <span class="stats-bd-k">${dateKey ? 'Récap de séance' : 'Bilan'}</span>
        <h2>${_esc(scopeLabel)}</h2>
        <p>${scopeDateCount} s&eacute;ance${scopeDateCount > 1 ? 's' : ''} &middot; ${rows.length} personnage${rows.length > 1 ? 's' : ''}${dateKey ? ` · ${_esc(_statsMissionOf(dateKey) || 'Mission non renseignée')}` : ''}</p>
      </div>
    </div>
    <div class="stats-kpis">${KPI_DEFS.map(d => _statsKpi(...d)).join('')}</div>
  </section>` : '';

  // ── Rythme de campagne (refonte, étape 6) : évolution par séance + missions ──
  const evoKey = _STATS_METRICS[_statsEvoMetric] ? _statsEvoMetric : 'dmgDealt';
  const evoM = _STATS_METRICS[evoKey];
  const evoVals = chronoSessions.map(s => {
    const total = _statsSessMetric(s.agg, evoKey);
    return _statsEvolutionMode === 'participant' ? total / Math.max(1, s.participants) : total;
  });
  const evoMax = Math.max(...evoVals, 1);
  const evoAvg = evoVals.length ? Math.round(evoVals.reduce((a, b) => a + b, 0) / evoVals.length) : 0;
  const evoStep = chronoSessions.length > 12 ? 2 : 1;
  const _canTimeline = chronoSessions.length > 1;
  const rythmeToggle = `<div class="stats-segm">
    <button class="${_statsEvolutionMode === 'total' ? 'on' : ''}" data-action="_statsEvolutionMode" data-mode="total">Total</button>
    <button class="${_statsEvolutionMode === 'participant' ? 'on' : ''}" data-action="_statsEvolutionMode" data-mode="participant">Par participant</button>
  </div>`;
  const missionBands = [];
  chronoSessions.forEach((session, index) => {
    const key = `${session.mission || 'Sans mission'}\u0000${session.group || ''}`;
    const previous = missionBands.at(-1);
    if (previous?.key === key) previous.count += 1;
    else missionBands.push({ key, label: session.mission || 'Sans mission', group: session.group, start: index, count: 1 });
  });
  const groupColors = new Map();
  const missionBandHtml = missionBands.length ? `<div class="stats-v2-mission-bands" style="grid-template-columns:repeat(${Math.max(1, chronoSessions.length)},minmax(0,1fr))">${missionBands.map(band => {
    if (!groupColors.has(band.group || band.label)) groupColors.set(band.group || band.label, ['#5795ff','#31d2a0','#b985ff','#ff9544','#e8b84b'][groupColors.size % 5]);
    const color = band.label === 'Sans mission' ? 'var(--border-md)' : groupColors.get(band.group || band.label);
    return `<button type="button" data-action="_statsSetScope" data-scope="${_esc(chronoSessions[band.start]?.date || '')}" style="--bc:${color};grid-column:${band.start + 1}/span ${band.count}" title="${_esc([band.label, band.group].filter(Boolean).join(' · '))}"><i></i><span>${_esc(band.label)}</span></button>`;
  }).join('')}</div>` : '';
  const rythmeBody = `<div class="stats-tl"><span class="stats-v2-evo-average" style="bottom:${Math.max(0, Math.min(100, evoAvg / evoMax * 100))}%"><small>moy. ${_kpiNum(evoAvg)}</small></span>${chronoSessions.map((s, i) => `<button type="button" class="stats-tl-col${s.date === dateKey ? ' on' : ''}" data-action="_statsSetScope" data-scope="${s.date === dateKey ? '' : s.date}" style="--mc:${evoM.color}">
        <span class="stats-tl-tip">${_statsSessionLabel(s.date)} · <b>${_kpiNum(evoVals[i])}</b> ${evoM.lbl.toLowerCase()}${s.mission ? `<br><span class="stats-dim">${_esc(s.mission)}</span>` : ''}</span>
        <span class="stats-tl-v">${_kpiNum(evoVals[i])}</span>
        <span class="stats-tl-bar" style="height:${Math.max(3, Math.round(evoVals[i] / evoMax * 100))}%"></span>
        <span class="stats-tl-x">${i % evoStep === 0 ? (_statsSessionTime(s.date) || _statsFmtDate(s.date).slice(0, 5)) : ''}</span></button>`).join('')}</div>
      ${missionBandHtml}
      <div class="stats-tl-legend"><span>Pic : ${_kpiNum(evoMax)} · moyenne : ${_kpiNum(evoAvg)} ${_statsEvolutionMode === 'participant' ? 'par participant' : 'par séance'} · clic sur une barre = récap</span><span>${evoM.lbl}</span></div>`;
  const timelineSec = renderOverview && (_canTimeline || rows.length) ? `<div class="stats-surface stats-chart">
    <div class="stats-chart-hd"><div><b>Évolution par séance</b><small>${chronoSessions.length} séances · cliquer pour ouvrir le récap</small></div><div class="stats-chart-ctrl">${rythmeToggle}${_statsMetricSelect(evoKey, '_statsEvoMetric')}</div></div>
    ${rythmeBody}
  </div>` : '';
  const missionRythme = renderOverview ? missionCompare
    .map(m => ({ label: m.label, key: m.key, n: m.count, avg: m.count ? Math.round(_statsSessMetric(m, evoKey) / m.count) : 0 }))
    .filter(m => m.n).sort((a, b) => b.avg - a.avg) : [];
  const mRythmeMax = Math.max(...missionRythme.map(m => m.avg), 1);
  const missionsSec = missionRythme.length ? `<div class="stats-surface stats-chart">
    <div class="stats-chart-hd"><div><b>Rendement par mission</b><small>Moyenne par séance suivie</small></div></div>
    <div class="stats-mbars">${missionRythme.map(m => `<button type="button" class="stats-mbar" data-action="_statsSetScope" data-scope="mission:${_esc(m.key)}" style="--mc:${evoM.color}">
      <div class="stats-mb-l"><b>${_esc(m.label)}</b><small>${m.n} séance${m.n > 1 ? 's' : ''}</small><span class="stats-mb-track"><i style="width:${Math.round(m.avg / mRythmeMax * 100)}%"></i></span></div>
      <div class="stats-mb-v"><b>${_kpiNum(m.avg)}</b><small>/ séance</small></div></button>`).join('')}</div>
  </div>` : '';
  const rythmeSec = renderOverview && timelineSec ? `<section class="stats-v2-evolution">
    <div class="stats-v2-block-title"><div><span>Tendance</span><h3>Évolution par séance · ${_esc(evoM.lbl)}</h3></div></div>
    ${timelineSec}
  </section>` : '';

  const spotlightHtml = renderOverview ? `<section class="stats-surface" id="temps-forts">
    <div class="stats-surface-head">
      <div><span>R&eacute;sum&eacute; de performance</span><h3>Temps forts</h3></div>
      <div class="stats-sec-tools">${mvpMjBtn}${awardTotal ? `<button class="stats-sec-tool" data-action="_statsAwardsConfig" title="Choisir les distinctions affich&eacute;es">&#9881;</button>` : ''}</div>
    </div>
    <div class="stats-spotlight-grid">
      <div class="stats-mvp-stack">
        ${mvpChosenSec}
        ${_mvpOverrideRow ? '<p class="stats-mvp-auto-note">Classement automatique (indicatif) :</p>' : ''}
        ${mvpSec || '<div class="stats-empty-inline">Pas de MVP marquant pour cette vue — activité trop faible pour départager équitablement.</div>'}
        ${mvpDetailSec || ''}
      </div>
      <div class="stats-spotlight-awards">
        ${awardsHtml ? `<div class="stats-trophies stats-trophies--all">${awardsHtml}</div>` : '<div class="stats-empty-inline">Aucune distinction visible pour cette vue.</div>'}
      </div>
    </div>
  </section>` : '';
  const palmaresHtml = palmaresSec ? `<section class="stats-surface stats-surface--compact">
    <div class="stats-surface-head"><div><span>Classements</span><h3>Palmar&egrave;s</h3></div></div>
    ${palmaresSec}
  </section>` : '';
  const rosterHtml = renderPlayers ? `<section class="stats-surface" id="personnages">
    <div class="stats-surface-head"><div><span>D&eacute;tail des contributions</span><h3>Joueurs</h3></div><small>${rows.length} fiche${rows.length > 1 ? 's' : ''}</small></div>
    ${charsHtml}
  </section>` : '';
  const detailsHtml = renderAudit ? `<section class="stats-sec" id="donnees">
    <div class="stats-surface-head"><div><span>Donn&eacute;es source</span><h3>Audit des compteurs</h3></div><small>${_esc(scopeLabel)}</small></div>
    ${detailedKpisHtml}
  </section>` : '';
  const groupsHtml = missionGroupsSec ? `<div id="groupes">${missionGroupsSec}</div>` : '';

  // ── Tableau de classement triable (refonte, étape 3) ──
  // Colonnes : accès à la donnée + couleur de métrique. La colonne triée reçoit
  // une barre-dans-cellule proportionnelle au max de la colonne.
  const rankDates = Array.isArray(scopeDates) ? scopeDates : allDates;
  const sessionsPlayed = r => rankDates.filter(key => _statsSessionBucket(_statsData?.chars?.[r.id], key)).length;
  const RANK_COLS = [
    ['sessions', 'Séances', '#8294ad', r => sessionsPlayed(r), false],
    ['impact', 'Impact', '#f4c430', r => r.impact, true],
    ['dmg', 'Dégâts', '#ff8b6b', r => r.combat.dmgDealt, true],
    ['ko', 'KO', '#ff7a59', r => r.combat.kosDealt, true],
    ['heal', 'Soin', '#31d2a0', r => r.combat.heal, true],
    ['taken', 'Encaissé', '#8fb7e8', r => r.combat.dmgTaken, true],
    ['avoided', 'Évitées', '#8fb7e8', r => r.combat.attacksAvoided, true],
    ['hitRate', 'Touche', '#22c38e', r => (r.combat.attacks ? Math.round(r.combat.hits / r.combat.attacks * 100) : null), false],
    ['rolls', 'Jets', '#e8b84b', r => r.actionAverages?.rolls || r.sRolls, true],
    ['d20', 'd20 moy.', '#bca0ff', r => r.actionAverages?.naturalAvg, false],
  ];
  const rankGet = Object.fromEntries(RANK_COLS.map(([k, , , get, normalize]) => [k, r => {
    const value = get(r);
    return _statsRankMode === 'session' && normalize ? (sessionsPlayed(r) ? value / sessionsPlayed(r) : 0) : value;
  }]));
  const rankColor = Object.fromEntries(RANK_COLS.map(([k, , col]) => [k, col]));
  const rankSortKey = rankGet[_statsRankSort.key] ? _statsRankSort.key : 'dmg';
  const rankDir = _statsRankSort.dir === 1 ? 1 : -1;
  const rankRows = renderRanking
    ? [...impactRows].sort((a, b) => (((rankGet[rankSortKey](b) || 0) - (rankGet[rankSortKey](a) || 0)) * (rankDir === -1 ? 1 : -1)))
    : [];
  const rankMax = renderRanking ? Math.max(...impactRows.map(r => rankGet[rankSortKey](r) || 0), 1) : 1;
  const rankNum = (v) => Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: _statsRankMode === 'session' ? 1 : 0 });
  const rankCell = (r, key) => {
    const v = rankGet[key](r);
    if (key === 'hitRate') return v == null
      ? '<td><span class="stats-tbl-z">—</span></td>'
      : `<td><span class="stats-hr-pill" style="color:${v >= 65 ? 'var(--emerald)' : v >= 45 ? 'var(--text)' : 'var(--crimson)'}">${v}%</span></td>`;
    if (key === 'd20') return v == null ? '<td class="stats-tbl-z">—</td>' : `<td>${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>`;
    if (key === rankSortKey) return `<td class="on"><span class="stats-cellbar" style="--mc:${rankColor[key]}"><i style="width:${Math.max(2, (v || 0) / rankMax * 100)}%"></i><b>${rankNum(v)}</b></span></td>`;
    return v ? `<td>${rankNum(v)}</td>` : '<td class="stats-tbl-z">—</td>';
  };
  const rankTh = (key, label) => `<th class="stats-th-sort${key === rankSortKey ? ' on' : ''}" data-action="_statsSortRank" data-key="${key}">${label}${key === rankSortKey ? `<span class="stats-th-arw">${rankDir === -1 ? '▼' : '▲'}</span>` : ''}</th>`;
  const rankingSec = renderRanking ? `<section class="stats-v2-section stats-v2-characters" id="classement">
    <header class="stats-v2-page-head"><div><h2>Personnages</h2><span>${rankRows.length}</span></div><nav class="stats-v2-rank-tools"><label><i>⌕</i><input type="search" placeholder="Rechercher un personnage…" aria-label="Rechercher un personnage" data-input="_statsCharacterSearch"></label><span class="stats-segm"><button type="button" class="${_statsRankMode === 'total' ? 'on' : ''}" data-action="_statsRankMode" data-mode="total">Totaux</button><button type="button" class="${_statsRankMode === 'session' ? 'on' : ''}" data-action="_statsRankMode" data-mode="session">Par séance jouée</button></span></nav></header>
    <div class="stats-tbl-wrap"><table class="stats-tbl">
      <thead><tr><th class="stats-th-rk"></th><th class="stats-th-who">Personnage</th>${RANK_COLS.map(([k, l]) => rankTh(k, l)).join('')}</tr></thead>
      <tbody>${rankRows.map((r, i) => { const char = STATE.characters?.find(item => item.id === r.id); const mine = !STATE.isAdmin && canControlCharacter(char, STATE.user?.uid); const player = char?.ownerPseudo || char?.joueur || char?.player || ''; const charGroups = [...new Set(rankDates.filter(key => _statsSessionBucket(_statsData?.chars?.[r.id], key)).map(key => _statsGroupOf(key)).filter(Boolean))]; const meta = [player, charGroups.length ? `${charGroups[0]}${charGroups.length > 1 ? ` +${charGroups.length - 1}` : ''}` : ''].filter(Boolean).join(' · '); return `<tr class="stats-v2-character-row${mine ? ' is-me' : ''}" data-stats-character="${_esc(_norm(`${r.name} ${player}`))}">
        <td class="stats-td-rk${i === 0 ? ' stats-rk1' : ''}">${i + 1}</td>
        <td class="stats-td-who"><button type="button" class="stats-who-in" data-action="_statsDrawerOpen" data-id="${_esc(r.id)}">${_statsAvatar(r.id, r.name, 30)}<span><b>${_esc(r.name)}</b>${meta ? `<small>${_esc(meta)}</small>` : ''}</span>${mine ? '<em>Vous</em>' : ''}</button></td>
        ${RANK_COLS.map(([k]) => rankCell(r, k)).join('')}
      </tr>`; }).join('')}</tbody>
    </table></div>
  </section>` : '';

  // ── Face-à-face : 2 personnages, 9 métriques en barres miroir (étape 8) ──
  const DUEL_ICONS = { attacks: '⚔️', hitRate: '🎯', dmg: '🗡️', heal: '💚', spells: '🔮', rolls: '🎲', taken: '🛡️', ko: '☠️', impact: '⭐' };
  let duelSec = '';
  if (renderRanking && impactRows.length >= 2) {
    let pair = (_statsCompareSelection.players || []).filter(id => impactRows.some(r => r.id === id));
    if (pair.length < 2 || pair[0] === pair[1]) pair = rankRows.slice(0, 2).map(r => r.id);
    const A = impactRows.find(r => r.id === pair[0]) || rankRows[0];
    const B = impactRows.find(r => r.id === pair[1] && r.id !== A.id) || rankRows.find(r => r.id !== A.id) || rankRows[1];
    const duelOpts = (cur, other) => impactRows.map(r => `<option value="${_esc(r.id)}"${r.id === cur ? ' selected' : ''}${r.id === other ? ' disabled' : ''}>${_esc(r.name)}</option>`).join('');
    const duelRows = RANK_COLS.map(([k, l, col]) => {
      const a = rankGet[k](A) || 0, b = rankGet[k](B) || 0, mx = Math.max(a, b, 1), sfx = k === 'hitRate' ? '%' : '';
      return `<div class="stats-duel-row" style="--dc:${col}">
        <span class="stats-duel-v stats-duel-v--l${a > b ? ' win' : ''}"><b>${rankNum(a)}${sfx}</b><span class="stats-duel-tk"><i style="width:${Math.round(a / mx * 100)}%"></i></span></span>
        <span class="stats-duel-m">${DUEL_ICONS[k] || '•'} ${l}</span>
        <span class="stats-duel-v${b > a ? ' win' : ''}"><span class="stats-duel-tk"><i style="width:${Math.round(b / mx * 100)}%"></i></span><b>${rankNum(b)}${sfx}</b></span>
      </div>`;
    }).join('');
    duelSec = `<section class="stats-surface stats-duel-sec">
      <div class="stats-surface-head"><div><span>Face-à-face</span><h3>Comparer deux personnages</h3></div></div>
      <div class="stats-duel">
        <div class="stats-duel-hd">
          <div class="stats-duel-p">${_statsAvatar(A.id, A.name, 36)}<select class="stats-duel-sel" data-change="_statsDuelPick" data-slot="0">${duelOpts(A.id, B.id)}</select></div>
          <span class="stats-duel-vs">VS</span>
          <div class="stats-duel-p stats-duel-p--r"><select class="stats-duel-sel" data-change="_statsDuelPick" data-slot="1">${duelOpts(B.id, A.id)}</select>${_statsAvatar(B.id, B.name, 36)}</div>
        </div>
        ${duelRows}
      </div>
    </section>`;
  }

  const sessionModels = _statsSessionModels(Array.isArray(scopeDates) ? scopeDates : allDates, sel);
  const insights = statsInsights(sessionModels);
  const records = statsRecords(sessionModels);
  const insightsHtml = insights.length ? `<section class="stats-v2-insights"><span>Faits marquants</span>${insights.map(item => `<p class="is-${item.tone}"><i></i>${_esc(item.text)}</p>`).join('')}</section>` : '';
  const summaryCard = (kick, title, body, { className = '', tool = '' } = {}) => `<section class="stats-v2-summary-card ${className}">
    <header><div><span>${kick}</span><h3>${title}</h3></div>${tool}</header>
    <div class="stats-v2-summary-card-body">${body}</div>
  </section>`;
  const recordsCard = summaryCard('Hall of fame', 'Records', records.length ? `<div class="stats-v2-record-list">${records.map(record => `<button type="button" data-action="_statsSetScope" data-scope="${_esc(record.session.key)}" style="--rc:#e8b84b">
    <i>${record.icon}</i><span><small>${_esc(record.label)}</small><span class="stats-v2-record-meta"><b>${record.row ? `${_statsAvatar(record.row.id, record.row.name, 24)}${_esc(record.row.name)}` : _esc(record.session.groupLabel || record.session.missionLabel)}</b><i>·</i><em>${_esc(_statsSessionDateParts(record.session.key).long)}${_statsSessionTime(record.session.key) ? ` · ${_esc(_statsSessionTime(record.session.key).replace(':', ' h '))}` : ''}</em></span></span><strong>${record.value.toLocaleString('fr-FR')}</strong>
  </button>`).join('')}</div>` : '<div class="stats-empty-inline">Les records apparaîtront après les premières séances.</div>', { className: 'stats-v2-records-card' });
  const favoriteColumn = (title, items, { emote = false, color = '#b985ff' } = {}) => {
    const top = items.slice(0, 5);
    const max = Math.max(1, ...top.map(item => item.c));
    return `<section style="--fc:${color}"><h4>${title}</h4>${top.length ? top.map(item => `<div class="stats-v2-favorite-row">
      <span>${emote ? _statsEmoteHtml(item.n, 'stats-emote-sm') : _esc(item.n)}<small>${item.contributor ? `· ${_esc(item.contributor.name)}${item.contributors.length > 1 ? ` +${item.contributors.length - 1}` : ''}` : ''}</small></span><b>${item.c.toLocaleString('fr-FR')}</b><i><u style="width:${Math.round(item.c / max * 100)}%"></u></i>
    </div>`).join('') : '<p>—</p>'}</section>`;
  };
  const favoritesCard = summaryCard('Habitudes de la table', 'Coups de cœur', `<div class="stats-v2-favorites">
    ${favoriteColumn('Sorts les plus lancés', spellTally, { color: '#b985ff' })}
    ${favoriteColumn('Émotes favorites', emoteTally, { emote: true, color: '#e8b84b' })}
  </div>`, { className: 'stats-v2-favorites-card' });
  const highlightsRow = `<div class="stats-v2-summary-row stats-v2-summary-row--highlights">
    ${summaryCard(dateKey ? 'Temps fort de la séance' : 'Temps fort', 'MVP d’impact',
      `${mvpChosenSec}${_mvpOverrideRow ? '<p class="stats-mvp-auto-note">Classement automatique (indicatif) :</p>' : ''}${mvpSec || '<div class="stats-empty-inline">Pas de MVP pour cette vue : l’activité est trop faible pour départager équitablement.</div>'}`,
      { className: 'stats-v2-mvp-card', tool: mvpMjBtn })}
    ${summaryCard(dateKey ? 'Palmarès de la séance' : 'Palmarès', 'Distinctions', awardsHtml ? `<div class="stats-trophies stats-trophies--all">${awardsHtml}</div>` : '<div class="stats-empty-inline">Aucune distinction visible pour cette vue.</div>', { className: 'stats-v2-awards-card', tool: awardTotal ? '<button class="stats-sec-tool" data-action="_statsAwardsConfig" title="Choisir les distinctions affichées">⚙</button>' : '' })}
  </div>`;
  const campaignBottomRow = `<div class="stats-v2-summary-row stats-v2-summary-row--bottom">${recordsCard}${favoritesCard}</div>`;
  const recapExtra = dateKey && sessionModels[0] ? (() => {
    const balance = statsBalance(sessionModels[0], _statsSessionModels(allDates));
    const spotlight = statsSpotlight(sessionModels[0].rows);
    const equalShare = spotlight.length ? Math.round(100 / spotlight.length) : 0;
    const actionCard = summaryCard('Participation', 'Répartition de l’action', `<div class="stats-v2-action-list">${spotlight.map(item => `<div>${_statsAvatar(item.id, item.name, 22)}<b>${_esc(item.name)}</b><i><u style="width:${Math.round(item.share * 100)}%"></u><em style="left:${equalShare}%"></em></i><strong>${item.actions}<small>${Math.round(item.share * 100)} %</small></strong></div>`).join('')}</div><p>Le trait indique une part égale (${equalShare} %).</p>`, { className: 'stats-v2-action-card' });
    const balanceCard = summaryCard('Lecture du combat', 'Équilibre', `<div class="stats-v2-balance"><span><b>${balance.dealt.toLocaleString('fr-FR')}</b><i>Dégâts infligés</i></span><strong>${balance.ratio == null ? '—' : balance.ratio.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}×</strong><span><b>${balance.taken.toLocaleString('fr-FR')}</b><i>Dégâts encaissés</i></span></div><div class="stats-v2-balance-foot"><span>☠️ ${balance.ko} ennemis KO</span><span>⚰️ ${balance.down} PJ à terre</span></div>`, { className: 'stats-v2-balance-card' });
    return `<div class="stats-v2-summary-row stats-v2-summary-row--recap">${actionCard}${balanceCard}</div>`;
  })() : '';
  const sessionsHtml = renderSessions ? _statsSessionsV2Html(Array.isArray(scopeDates) ? scopeDates : allDates, sel) : '';
  const dataV2Html = renderAudit ? _statsDataV2Html(allDates) : '';
  const drawerHtml = renderRanking ? _statsDrawerV2Html(impactRows, rankDates) : '';
  const summaryGroups = [...new Set(sessionModels.map(session => session.groupLabel).filter(Boolean))];
  const summaryDates = sessionModels.map(session => _statsDateOf(session.key)).filter(Boolean).sort();
  const sessionOrder = [...allDates].sort();
  const sessionIndex = dateKey ? sessionOrder.indexOf(dateKey) : -1;
  const previousSession = sessionIndex > 0 ? sessionOrder[sessionIndex - 1] : '';
  const nextSession = sessionIndex >= 0 && sessionIndex < sessionOrder.length - 1 ? sessionOrder[sessionIndex + 1] : '';
  const sessionMission = dateKey ? _statsData?.sessions?.[dateKey]?.missionId : '';
  const summaryNav = dateKey ? `<div class="stats-v2-summary-nav">
    <button type="button" data-action="_statsSetScope" data-scope="${_esc(previousSession)}"${previousSession ? '' : ' disabled'}>← Séance précédente</button>
    <button type="button" data-action="_statsSetScope" data-scope="${_esc(nextSession)}"${nextSession ? '' : ' disabled'}>Séance suivante →</button>
    ${sessionMission ? `<button type="button" data-action="_statsSetScope" data-scope="mission:${_esc(sessionMission)}">Bilan de la mission</button>` : ''}
    ${STATE.isAdmin ? `<button type="button" data-action="_statsEditMission" data-scope="${_esc(dateKey)}">${sessionMission ? '✎ Modifier le lien' : '⌁ Relier à une mission'}</button>` : ''}
  </div>` : '';
  const summaryIntro = renderOverview ? `<section class="stats-v2-summary-intro">
    <div class="stats-v2-summary-copy">
      <span>${dateKey ? `Récap de séance · ${_esc(_statsSessionLabel(dateKey))}` : isMission ? 'Bilan de mission' : isAct ? 'Bilan d’acte' : 'Bilan de campagne'}</span>
      <h2>${_esc(dateKey ? (_statsMissionOf(dateKey) || 'Séance non reliée') : scopeLabel.replace(/^./, letter => letter.toUpperCase()))}</h2>
      <div class="stats-v2-summary-meta">${dateKey ? `${summaryGroups.map((group, index) => `<em style="--gc:${['#5795ff','#ff9544','#b985ff'][index % 3]}">${_esc(group)}</em>`).join('')}<i></i><span class="stats-v2-participants">${rows.slice(0, 7).map(row => _statsAvatar(row.id, row.name, 22)).join('')}</span><b>${rows.length} participant${rows.length > 1 ? 's' : ''}</b>` : `<b>${scopeDateCount} séance${scopeDateCount > 1 ? 's' : ''}</b><i></i><b>${rows.length} personnage${rows.length > 1 ? 's' : ''}</b>${summaryGroups.map((group, index) => `<em style="--gc:${['#5795ff','#ff9544','#b985ff'][index % 3]}">${_esc(group)}</em>`).join('')}${summaryDates.length ? `<i></i><small>${_esc(_statsFmtDate(summaryDates[0]))} → ${_esc(_statsFmtDate(summaryDates.at(-1)))}</small>` : ''}`}</div>
      ${summaryNav}
    </div>
    ${insightsHtml || '<section class="stats-v2-insights"><span>Faits marquants</span><p><i></i>Les faits marquants apparaîtront après les premières séances.</p></section>'}
  </section>
  <section class="stats-v2-kpi-strip">${KPI_DEFS.map(definition => _statsKpi(...definition)).join('')}</section>` : '';
  const activeTabHtml = {
    summary: `${summaryIntro}${dateKey ? '' : rythmeSec}${highlightsRow}${dateKey ? recapExtra : campaignBottomRow}`,
    sessions: sessionsHtml,
    characters: `${rankingSec}${drawerHtml}`,
    dice: averagesHtml,
    data: dataV2Html,
  }[_statsTab] || `${summaryIntro}${dateKey ? '' : rythmeSec}${highlightsRow}${dateKey ? recapExtra : campaignBottomRow}`;

  root.innerHTML = `
    ${controls}
    <div class="stats-wrap">
    ${sessionBanner}
    ${groupsBar}
    <div class="stats-views">
      <div class="stats-view on" data-view="${_esc(_statsTab)}">${activeTabHtml}</div>
    </div>
    </div>`;
  if (bind) _statsBindRenderedInteractions(root);
}

// Les journaux VTT et métadonnées arrivent après le premier rendu. On prépare
// leur HTML hors écran puis on ne remplace que les zones susceptibles d'avoir
// changé : le conteneur racine, le scroll et les autres onglets restent intacts.
function _statsRefreshEnrichedView(scope) {
  const root = document.getElementById('stats-root');
  if (!root) return;
  const renderedTab = _statsTab;
  const pageScroll = window.scrollY;
  const tabsScroll = root.querySelector('.stats-tabs')?.scrollLeft || 0;
  const focused = root.contains(document.activeElement) ? document.activeElement : null;
  const focusTag = focused?.tagName || '';
  const focusData = focused ? { ...focused.dataset } : null;

  const nextRoot = document.createElement('div');
  nextRoot.className = root.className;
  _statsRender(scope, { root: nextRoot, bind: false });
  if (!root.isConnected || renderedTab !== _statsTab) return;

  const currentTopbar = root.querySelector(':scope > .stats-topbar');
  const nextTopbar = nextRoot.querySelector(':scope > .stats-topbar');
  if (currentTopbar && nextTopbar && currentTopbar.innerHTML !== nextTopbar.innerHTML) {
    currentTopbar.replaceWith(nextTopbar);
  }

  const currentWrap = root.querySelector(':scope > .stats-wrap');
  const nextWrap = nextRoot.querySelector(':scope > .stats-wrap');
  if (!currentWrap || !nextWrap) {
    root.innerHTML = nextRoot.innerHTML;
  } else {
    const currentViews = currentWrap.querySelector(':scope > .stats-views');
    const syncOptionalRegion = (selector) => {
      const current = currentWrap.querySelector(`:scope > ${selector}`);
      const next = nextWrap.querySelector(`:scope > ${selector}`);
      if (current && next) {
        if (current.innerHTML !== next.innerHTML) current.replaceWith(next);
      } else if (current) {
        current.remove();
      } else if (next) {
        currentWrap.insertBefore(next, currentViews);
      }
    };
    syncOptionalRegion('.stats-session-banner');
    syncOptionalRegion('.stats-groups');

    const currentView = currentViews?.querySelector(':scope > .stats-view');
    const nextView = nextWrap.querySelector(':scope > .stats-views > .stats-view');
    if (currentView && nextView && currentView.innerHTML !== nextView.innerHTML) {
      currentView.replaceWith(nextView);
    }
  }

  _statsBindRenderedInteractions(root);
  const tabs = root.querySelector('.stats-tabs');
  if (tabs) tabs.scrollLeft = tabsScroll;
  if (focusData) {
    const focusTarget = [...root.querySelectorAll(focusTag.toLowerCase())].find(el =>
      Object.entries(focusData).every(([key, value]) => el.dataset[key] === value)
    );
    focusTarget?.focus({ preventScroll: true });
  }
  if (Math.abs(window.scrollY - pageScroll) > 1) window.scrollTo({ top: pageScroll, behavior: 'auto' });
}

// Après une mutation ciblée des stats (suppression, correction) : recharge le
// document (le cache mémoire a pu être invalidé) puis rafraîchit la vue EN PLACE
// via _statsRefreshEnrichedView — sans reconstruire toute la page, ni réinitialiser
// les filtres, le défilement ou les tiroirs ouverts. Les handlers ajustent
// `_statsScope` (séance/mission disparue) AVANT d'appeler cette fonction.
async function _statsReloadAfterMutation() {
  // Chemin rapide : si la mutation a laissé le miroir mémoire à jour (ex.
  // suppression de séance), on l'utilise directement — 0 relecture réseau. Sinon
  // (cache invalidé) on relit le document une fois.
  const cached = peekStats();
  _statsData = cached || (await loadStats()) || {};
  _statsVttLogs = [];
  _statsVttLogsLoaded = false;
  _statsVttDetailCache = new Map();
  _statsRowsCache = new Map();
  // Le résumé historique est corrigé sur place par la mutation (shared/stats.js) :
  // on le relit simplement (1 lecture) au lieu de relire tout le journal VTT,
  // qui coûtait des milliers de lectures à chaque suppression ou correction.
  const rollup = await getDocDataSilent('statsRollups', 'main').catch(() => null);
  _statsLegacyRollups = _statsRollupReady(rollup) ? rollup.scopes : null;
  // Si le scope courant (séance / mission) a disparu avec la suppression, on
  // retombe sur la campagne entière — sinon la vue resterait figée sur du vide.
  if (_statsScope) {
    const isMission = _statsScope.startsWith('mission:');
    const isAct = _statsScope.startsWith('act:');
    const stillExists = isAct
      ? _statsActList().some(a => `act:${a.key}` === _statsScope)
      : isMission
        ? _statsMissionList().some(m => `mission:${m.id}` === _statsScope)
        : _statsAllSessionKeys().includes(_statsScope);
    if (!stillExists) { _statsScope = null; _statsGroupSel = null; _statsGroupMissionId = ''; }
  }
  // Rendu direct du contenu dans #stats-root (comme le 1er rendu de la page) :
  // met à jour la vue de façon fiable, SANS reconstruire la page ni refetch.
  // On préserve le défilement pour ne pas « sauter » en haut.
  const y = window.scrollY;
  _statsRender(_statsScope);
  if (Math.abs(window.scrollY - y) > 1) window.scrollTo({ top: y, behavior: 'auto' });
}

// Vrai si la modale « Gérer les statistiques » est affichée (au premier plan).
const _statsManageIsOpen = () => !!document.querySelector('#modal-overlay.show #modal-body .stats-mng');

// Marque la ligne en cours de suppression (retour visuel pendant l'écriture).
function _statsManageMarkBusy(action, scope, busy) {
  const btn = [...document.querySelectorAll(`#modal-body [data-action="${action}"]`)]
    .find(b => b.dataset.scope === scope);
  btn?.closest('.stats-mng-row')?.classList.toggle('is-busy', busy);
  if (btn) btn.disabled = busy;
}

// Après une suppression lancée depuis la modale de gestion : la liste se met à
// jour EN PLACE (modale conservée, défilement préservé par openModal) dès que le
// miroir mémoire est à jour, puis la page se rafraîchit derrière. Si le
// rechargement modifie encore les données, la modale est redessinée une 2e fois.
async function _statsAfterManageDelete() {
  _statsData = peekStats() || (await loadStats()) || {};
  if (_statsManageIsOpen()) _statsOpenManageModal();
  await _statsReloadAfterMutation();
  if (_statsManageIsOpen()) _statsOpenManageModal();
}

// Construit / rouvre la modale « Gérer les statistiques ». Extrait de l'action
// `_statsManage` pour pouvoir la ROUVRIR après une suppression (rester dans la
// modale, liste à jour). openModal préserve le défilement interne quand la même
// modale est déjà affichée.
function _statsOpenManageModal() {
  if (!STATE.isAdmin) return;
  const dates = _statsAllSessionKeys();
  const pendingDates = _statsUnlinkedDates(dates);
  const linkedDates = dates.filter(d => _statsSessionIsLinked(d));
  const missions = _statsMissionList();
  const trackedChars = Object.keys(_statsData?.chars || {}).length;
  const linkedGroups = new Set(Object.values(_statsData?.sessions || {}).map(s => s?.groupId || s?.group).filter(Boolean)).size;
  const adventureName = _esc(STATE.adventure?.nom || 'Aventure courante');
  const missRow = (m) => `<div class="stats-mng-row"><span class="stats-mng-lbl">🎯 ${_esc(m.name)}</span><button class="stats-mng-del" data-action="_statsDelMission" data-scope="${m.id}" data-name="${_esc(m.name)}">🗑 Supprimer</button></div>`;
  const dateRow = (d) => {
    const mi = _statsMissionOf(d), gr = _statsGroupOf(d), linked = _statsSessionIsLinked(d);
    const label = linked
      ? `🎯 ${_esc(mi || 'Mission liée')}${gr ? ` · 👥 ${_esc(gr)}` : ''}`
      : (mi ? `<span class="stats-mng-incomplete">⚠ Ancien lien incomplet · ${_esc(mi)}</span>` : '<span class="stats-sb-none">Aucune mission associée</span>');
    return `<div class="stats-mng-row${linked ? ' is-linked' : ' is-pending'}">
      <span class="stats-mng-lbl">📅 ${_statsSessionLabel(d)} — ${label}</span>
      <span class="stats-mng-acts">
        <button class="stats-mng-link" data-action="_statsEditMission" data-scope="${d}">🔗 ${linked ? 'Modifier' : 'Relier'}</button>
        <button class="stats-mng-del" data-action="_statsDelDate" data-scope="${d}" title="Supprimer uniquement les statistiques de cette séance" aria-label="Supprimer les statistiques de la séance du ${_statsSessionLabel(d)}">🗑 Supprimer</button>
      </span>
    </div>`;
  };
  const healthHtml = pendingDates.length
    ? `<div class="stats-mng-health is-pending"><span class="stats-mng-health-icon">🔗</span><span><strong>${pendingDates.length} séance${pendingDates.length > 1 ? 's' : ''} à relier</strong><small>Ces statistiques existent, mais ne sont rattachées à aucune mission de la Trame.</small></span></div>`
    : dates.length
      ? `<div class="stats-mng-health is-ok"><span class="stats-mng-health-icon">✓</span><span><strong>Associations à jour</strong><small>Toutes les séances contenant des statistiques sont reliées à une mission.</small></span></div>`
      : `<div class="stats-mng-health is-empty"><span class="stats-mng-health-icon">0</span><span><strong>Aucune séance datée</strong><small>Les séances à relier apparaîtront ici dès que des statistiques auront été enregistrées.</small></span></div>`;
  const hideableChars = Object.entries(_statsData?.chars || {})
    .map(([id, c]) => ({ id, name: c?.name || (STATE.characters?.find(x => x.id === id)?.nom) || '?', dead: _statsIsDeadChar(id), hidden: _statsHiddenChars.has(id) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  const deadVisible = hideableChars.filter(c => c.dead && !c.hidden).length;
  const hideRow = (c) => `<div class="stats-mng-row${c.hidden ? ' is-hidden-char' : ''}">
    <span class="stats-mng-lbl">${c.dead ? '💀' : '👤'} ${_esc(c.name)}${c.hidden ? ' — <em>masqué</em>' : ''}</span>
    <button class="stats-mng-hide" data-action="_statsToggleHideChar" data-id="${_esc(c.id)}">${c.hidden ? '👁 Afficher' : '🚫 Masquer'}</button>
  </div>`;
  const hideSection = hideableChars.length ? `<div class="stats-mng-sec">
    <div class="stats-mng-hd"><span>Masquer des personnages des stats</span><b>${_statsHiddenChars.size}</b></div>
    <p class="stats-mng-hide-note">Un personnage masqué disparaît de toutes les vues (liste, MVP, classements) sans que ses données soient supprimées. Réversible quand tu veux.</p>
    ${(deadVisible || _statsHiddenChars.size) ? `<div class="stats-mng-hide-tools">
      ${deadVisible ? `<button class="stats-mng-link" data-action="_statsHideAllDead">💀 Masquer les ${deadVisible} mort${deadVisible > 1 ? 's' : ''}</button>` : ''}
      ${_statsHiddenChars.size ? `<button class="stats-mng-link" data-action="_statsShowAllChars">👁 Tout réafficher</button>` : ''}
    </div>` : ''}
    ${hideableChars.map(hideRow).join('')}
  </div>` : '';
  openModal('⚙ Gérer les statistiques', `
    <div class="stats-mng">
      ${healthHtml}
      <div class="stats-mng-info">
        <strong>Les filtres de la page ne suppriment jamais de données.</strong>
        <span>Ici, chaque suppression indique précisément son périmètre avant confirmation. Une même date peut contenir plusieurs séances : leur heure permet de les distinguer.</span>
      </div>
      ${pendingDates.length ? `<div class="stats-mng-sec stats-mng-sec--pending"><div class="stats-mng-hd"><span>À relier en priorité</span><b>${pendingDates.length}</b></div>${pendingDates.map(dateRow).join('')}</div>` : ''}
      ${linkedDates.length ? `<details class="stats-mng-linked"${pendingDates.length ? '' : ' open'}>
        <summary><span>Séances déjà reliées</span><b>${linkedDates.length}</b><span class="stats-mng-linked-caret">⌄</span></summary>
        <div class="stats-mng-sec">${linkedDates.map(dateRow).join('')}</div>
      </details>` : ''}
      ${missions.length ? `<div class="stats-mng-sec"><div class="stats-mng-hd">Supprimer toutes les stats d'une mission</div>${missions.map(missRow).join('')}</div>` : ''}
      ${(!missions.length && !dates.length) ? '<div class="stats-mng-sec" style="color:var(--text-dim);font-size:.85rem">Aucune donnée datée pour le moment.</div>' : ''}
      ${hideSection}
      <div class="stats-mng-danger">
        <div class="stats-mng-hd">⚠ Suppression globale</div>
        <strong class="stats-mng-danger-title">${adventureName}</strong>
        <p>Efface les statistiques de <b>${trackedChars} personnage${trackedChars > 1 ? 's' : ''}</b>, <b>${dates.length} séance${dates.length > 1 ? 's' : ''}</b>${missions.length ? ` et <b>${missions.length} mission${missions.length > 1 ? 's' : ''}</b>` : ''}${linkedGroups ? `, pour <b>${linkedGroups} groupe${linkedGroups > 1 ? 's' : ''}</b>` : ''}. Les personnages, missions, groupes, inventaires et scènes VTT sont conservés.</p>
        <button class="stats-mng-reset" data-action="_statsResetAsk">🗑 Effacer toutes les statistiques de l'aventure…</button>
      </div>
    </div>`, { subtitle: 'Relier les séances aux missions · supprimer des données ciblées', accent: '#4f8cff' });
}


// Flux du mur du tableau de bord en cours (un seul à la fois, cf. dashboard()).
let _dashWallFeed = null;
let _dashUi = null;

const PAGES = {

  // ─── DASHBOARD V4 ───────────────────────────────────────────────────────────
  async dashboard() {
    const content = document.getElementById('main-content');
    content.innerHTML = `<div class="db" id="dash-root">${appSplashHtml()}</div>`;

    let allChars = sortCharactersForDisplay(getCachedCollection('characters') || []);
    let story = STATE.isAdmin ? (getCachedCollection('story') || []) : [];
    let quests = STATE.isAdmin ? (getCachedCollection('quests') || []) : [];
    let agenda = null;
    let summary = null;
    let presence = [];
    let wallDocs = [];
    let wallRead = null;
    let { bastion, investments: bastionInvestments } = bastionSignalSnapshot();
    let pickGroupId = '';
    let paintQueued = false;
    let dashboardMounted = false;
    let dashboardAnimTimer = null;
    let rosterFilter = 'all';
    let rosterQuery = '';
    let rosterSort = { key: 'nom', dir: 1 };
    let rosterView = 'groups';
    let rosterFreeExpanded = false;
    try { rosterView = localStorage.getItem('dash-roster-view') === 'table' ? 'table' : 'groups'; } catch { /* stockage privé */ }
    const groupOverrides = new Map();
    const uidAliases = _uidAliasesForCurrentUser();
    const aliasSet = new Set(uidAliases);

    const iconPaths = {
      calendar: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>',
      clock: '<circle cx="8" cy="8" r="5.8"/><path d="M8 5v3.2l2 1.3"/>',
      'map-pin': '<path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 00-9 0C3.5 9.8 8 14 8 14z"/><circle cx="8" cy="6.5" r="1.6"/>',
      flag: '<path d="M3.5 14V2.5M3.5 3h8.5l-2 3 2 3H3.5"/>',
      play: '<path d="M5 3.2v9.6c0 .5.5.8 1 .5l7.3-4.8a.6.6 0 000-1L6 2.7c-.5-.3-1 0-1 .5z" fill="currentColor" stroke="none"/>',
      shield: '<path d="M8 1.8l5 2v4c0 3.2-2.2 5.3-5 6.4-2.8-1.1-5-3.2-5-6.4v-4z"/>',
      coin: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5.5v5"/>',
      plus: '<path d="M8 3v10M3 8h10"/>',
      edit: '<path d="M11 2.5l2.5 2.5L6 12.5H3.5V10z"/>',
      'arrow-right': '<path d="M3 8h10M9 4l4 4-4 4"/>',
      'refresh-cw': '<path d="M13 5V2l-2 2a5.5 5.5 0 10.8 7.3M3 11v3l2-2"/>',
      search: '<circle cx="7" cy="7" r="4.3"/><path d="M10.2 10.2L14 14"/>',
      columns: '<rect x="2" y="3" width="5" height="10" rx="1"/><rect x="9" y="3" width="5" height="10" rx="1"/>',
      rows: '<path d="M3 4h10M3 8h10M3 12h10"/>',
      external: '<path d="M8.5 3H13v4.5M13 3L7 9"/><path d="M11 9.5V13H3V5h3.5"/>',
      heart: '<path d="M8 13S2.5 10 2.5 5.8A2.8 2.8 0 018 4a2.8 2.8 0 015.5 1.8C13.5 10 8 13 8 13z"/>',
      message: '<path d="M2.5 3.5h11v8h-6L4 14v-2.5H2.5z"/>',
      alert: '<path d="M8 2l6 11H2z"/><path d="M8 6v3M8 11.3h.01"/>',
    };
    const icon = (id, size = 13) => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[id] || ''}</svg>`;
    const wallSeenAt = () => {
      let local = 0;
      try { local = Number(localStorage.getItem(bastionWallSeenKey(STATE.adventure?.id, STATE.user?.uid))) || 0; } catch { /* stockage privé */ }
      return Math.max(local, Number(wallRead?.seenAt) || 0);
    };
    const schedulePaint = () => {
      // Toute donnée a pu changer : on invalide les mémos par paint pour que les
      // handlers lus entre deux paints (toggleQuest…) recalculent sur l'état frais.
      _ctrlMemo = _liveMemo = _groupsMemo = _sessionsMemo = null;
      if (paintQueued) return;
      paintQueued = true;
      requestAnimationFrame(paint);
    };
    const todayIso = () => {
      const date = new Date();
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };
    const parseIso = value => {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
      return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
    };
    const dateInfo = value => {
      const date = parseIso(value);
      if (!date) return { day: '--', month: '', weekday: '', short: 'Date à définir', when: '' };
      const base = parseIso(todayIso());
      const days = Math.round((date - base) / 86_400_000);
      return {
        date,
        days,
        day: String(date.getDate()).padStart(2, '0'),
        month: new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(date).replace('.', ''),
        weekday: new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(date),
        short: new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).format(date).replace('.', ''),
        when: days === 0 ? "aujourd’hui" : days === 1 ? 'demain' : days > 1 ? `dans ${days} jours` : '',
      };
    };
    const slotMeta = slot => ({
      m: { label: 'Matin', hours: '9 h – 13 h' },
      a: { label: 'Après-midi', hours: '14 h – 18 h' },
      s: { label: 'Soir', hours: '19 h – 23 h' },
    }[slot] || { label: 'Créneau', hours: 'à préciser' });
    // Mémos par paint : controlledChars() et liveUids() sont appelés plusieurs
    // fois par rendu (par groupe, par avatar) alors que leur résultat est
    // constant pendant un paint. On calcule une fois et on réinitialise au début
    // de chaque paint → données fraîches à chaque rendu, aucune péremption, moins
    // d'allocations répétées dans le rendu le plus fréquent de l'app.
    let _ctrlMemo = null, _liveMemo = null, _groupsMemo = null, _sessionsMemo = null;
    const controlledChars = () => {
      if (_ctrlMemo) return _ctrlMemo;
      _ctrlMemo = STATE.isAdmin ? allChars : getControlledCharacters(allChars, STATE.user?.uid);
      return _ctrlMemo;
    };
    const liveUids = () => {
      if (_liveMemo) return _liveMemo;
      const now = Date.now();
      _liveMemo = new Set((presence || [])
        .filter(item => item?.uid && item.uid !== STATE.user?.uid)
        .filter(item => {
          const ts = item.lastSeen?.toMillis?.() ?? 0;
          return ts > 0 && now - ts < PRESENCE_TTL_MS;
        })
        .map(item => item.uid));
      return _liveMemo;
    };
    const groups = () => {
      if (_groupsMemo) return _groupsMemo;
      const base = STATE.isAdmin
        ? activeGroupsFromSources(story, quests)
        : (isUsableSummary(summary) ? summary.groups : []);
      _groupsMemo = base.map(group => ({
        ...group,
        participants: groupOverrides.get(group.id) || group.participants || [],
      }));
      return _groupsMemo;
    };
    const sessions = () => {
      if (_sessionsMemo) return _sessionsMemo;
      const base = STATE.isAdmin
        ? compactDashboardSessions(agenda, quests)
        : (isUsableSummary(summary) ? summary.sessions : []);
      const order = { m: 0, a: 1, s: 2 };
      _sessionsMemo = base
        .filter(session => isAgendaSessionUpcoming(session, todayIso()))
        .filter(session => {
          if (STATE.isAdmin) return true;
          if (session.participantUids?.some(uid => aliasSet.has(uid))) return true;
          // Les anciens résumés peuvent ne pas contenir participantUids. Dans
          // ce cas, on se rabat sur les participants du groupe au lieu de
          // montrer au joueur les séances de toute l'aventure.
          const group = groups().find(item => item.id === session.questId);
          return !!group && groupJoined(group);
        })
        .sort((a, b) => String(a.date).localeCompare(String(b.date))
          || (order[a.slot] ?? 9) - (order[b.slot] ?? 9));
      return _sessionsMemo;
    };
    // Utilisée par la séance, les séances suivantes et les cartes de groupe : la
    // retirer fait planter chaque paint dès qu'un groupe existe (tableau de bord
    // figé sur son premier rendu, mur du Bastion compris).
    const charForParticipant = participant => allChars.find(char => char.id === participant?.charId)
      || allChars.find(char => char.uid === participant?.uid)
      || { nom: participant?.nom || 'Personnage', uid: participant?.uid || '' };
    const avatar = (entity, className = '', live = false) => {
      const sizes = { sm: 24, md: 34, lg: 46, xl: 56 };
      const sizeClass = className.split(/\s+/).find(value => sizes[value]);
      return characterAvatarHtml(entity, {
        size: sizes[sizeClass] || 32,
        className: `db-av ${className}${live ? ' live' : ''}`.trim(),
        border: 'none',
        background: 'var(--surface-2)',
      });
    };
    const groupJoined = group => (group?.participants || []).some(participant =>
      aliasSet.has(participant?.uid)
      || controlledChars().some(char => char.id && char.id === participant?.charId));
    const groupForChar = (char, list = groups()) => list.find(group =>
      (group.participants || []).some(participant => participant?.charId === char.id
        || (!participant?.charId && participant?.uid === char.uid)));
    const freeChars = list => {
      const busy = new Set(list.flatMap(group => (group.participants || []).map(participant => participant?.charId).filter(Boolean)));
      return controlledChars().filter(char => !busy.has(char.id));
    };
    const bars = char => {
      const pvMax = calcPVMax(char) || char.pvBase || 10;
      const pmMax = calcPMMax(char) || char.pmBase || 10;
      const pv = char.hp ?? char.pvActuel ?? pvMax;
      const pm = char.pmActuel ?? pmMax;
      const pvPct = pvMax > 0 ? Math.max(0, Math.min(100, Math.round(pv / pvMax * 100))) : 0;
      const pmPct = pmMax > 0 ? Math.max(0, Math.min(100, Math.round(pm / pmMax * 100))) : 0;
      return `<span class="db-bars">
        <span class="db-bar${pvPct < 30 ? ' low' : ''}">PV<i><u style="width:${pvPct}%;--c:${pvPct < 30 ? 'var(--crimson)' : pvPct < 55 ? 'var(--amber)' : 'var(--emerald)'}"></u></i><b>${pv}/${pvMax}</b></span>
        <span class="db-bar">PM<i><u style="width:${pmPct}%;--c:var(--gold)"></u></i><b>${pm}/${pmMax}</b></span>
      </span>`;
    };

    const groupColor = id => {
      const palette = ['#ff9544', '#9d6fff', '#7dd3fc', '#f4c430', '#bca0ff', '#4f8cff'];
      let hash = 0;
      for (const ch of String(id || 'groupe')) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
      return palette[Math.abs(hash) % palette.length];
    };
    const charVitals = char => {
      const pvMax = calcPVMax(char) || Number(char.pvBase) || 10;
      const pmMax = calcPMMax(char) || Number(char.pmBase) || 10;
      const pv = Number(char.hp ?? char.pvActuel ?? pvMax);
      const pm = Number(char.pmActuel ?? pmMax);
      return {
        pv, pvMax, pm, pmMax,
        pvPct: pvMax > 0 ? Math.max(0, Math.min(100, Math.round(pv / pvMax * 100))) : 0,
        pmPct: pmMax > 0 ? Math.max(0, Math.min(100, Math.round(pm / pmMax * 100))) : 0,
      };
    };
    const hpColor = pct => pct < 30 ? 'var(--crimson)' : pct < 55 ? 'var(--amber)' : 'var(--emerald)';
    const missionImage = group => {
      const cachedStory = STATE.isAdmin ? story : (getCachedCollection('story') || []);
      const mission = cachedStory.find(item => String(item?.id || '') === String(group?.missionId || ''));
      if (mission?.imageUrl) return { url: mission.imageUrl, soft: false };
      return group?.missionThumb ? { url: group.missionThumb, soft: true } : { url: '', soft: false };
    };
    const cssUrl = value => String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const portraitCard = (char, index, total, { mine = false, gm = false, overflow = 0 } = {}) => {
      const middle = (total - 1) / 2;
      const delta = index - middle;
      const rotation = (delta * 3.2).toFixed(2);
      const drop = (Math.abs(delta) ** 2 * 2.4).toFixed(1);
      if (overflow) return `<span class="db-cast-card more" style="--k:${index};--r:${rotation}deg;--y:${drop}px">+${overflow}</span>`;
      const vitals = charVitals(char);
      const color = /^#[0-9a-f]{6}$/i.test(char.auraColor || '') ? char.auraColor : characterColor(char);
      const title = `${char.nom || 'Personnage'}${char.classe ? ` · ${char.classe}` : ''} · niv. ${char.niveau || 1}`;
      return `<button type="button" class="db-cast-card${mine ? ' me' : ''}" style="--k:${index};--r:${rotation}deg;--y:${drop}px;--ac:${color}" data-action="_dashQuickChar" data-id="${_esc(char.id)}" title="${_esc(title)}" aria-label="Ouvrir l’aperçu de ${_esc(char.nom || 'ce personnage')}">
        ${characterPortraitContent(char, { fallbackClass: 'ini' })}${mine ? '<span class="tag">Toi</span>' : ''}${gm && liveUids().has(char.uid) ? '<span class="live"></span>' : ''}
        ${gm && vitals.pvPct < 30 ? `<span class="hurt"><u style="width:${vitals.pvPct}%"></u></span>` : ''}<b>${_esc(char.nom || 'Personnage')}</b>
      </button>`;
    };
    const cast = (chars, { ownOnly = false } = {}) => {
      const mineIds = new Set(controlledChars().map(char => char.id));
      const visible = chars.length > 6 ? chars.slice(0, 5) : chars.slice(0, 6);
      const overflow = Math.max(0, chars.length - visible.length);
      const cards = [...visible.map((char, index) => portraitCard(char, index, visible.length + (overflow ? 1 : 0), {
        mine: !ownOnly && !STATE.isAdmin && mineIds.has(char.id) && chars.some(item => !mineIds.has(item.id)),
        gm: STATE.isAdmin,
      }))];
      if (overflow) cards.push(portraitCard({}, cards.length, cards.length + 1, { overflow }));
      const onlineCount = STATE.isAdmin ? chars.filter(char => liveUids().has(char.uid)).length : 0;
      return `<div class="db-cast"><div class="db-cast-k">${ownOnly ? (chars.length > 1 ? 'Tes personnages attendent' : 'Ton personnage attend') : `La compagnie · ${chars.length}`}${STATE.isAdmin && onlineCount ? `<em>${onlineCount} en ligne</em>` : ''}</div><div class="db-cast-row">${cards.join('')}</div></div>`;
    };

    const sessionSection = (list, groupList) => {
      const first = list[0];
      if (!first) {
        const own = controlledChars();
        const hasGroup = groupList.some(groupJoined);
        const copy = STATE.isAdmin
          ? 'Planifie une date pour un groupe de la Trame : elle apparaîtra ici pour toute la compagnie.'
          : hasGroup
            ? "Le MJ n'a pas encore fixé de date. Indique tes disponibilités pour l'aider à choisir."
            : 'Rejoins un groupe ci-dessous pour être convoqué à la prochaine séance.';
        return `<section class="db-hero empty noart${own.length ? '' : ' solo'} rise" style="--i:1;--gc:${groupColor(groupList[0]?.id)}"><div class="db-hero-art dots"></div><div class="db-hero-main"><div class="db-hero-info"><div class="db-hero-k">${STATE.isAdmin ? 'Agenda' : 'Prochaine séance'}</div><h1>Aucune séance prévue</h1><p class="db-hero-p">${_esc(copy)}</p><div class="db-hero-act">${STATE.isAdmin ? `<button type="button" class="db-go" data-navigate="agenda">${icon('calendar')}Planifier une séance</button>` : `<button type="button" class="db-go" data-navigate="vtt">${icon('play', 15)}Entrer dans la table</button>`}<button type="button" class="db-glass" data-navigate="${STATE.isAdmin ? 'vtt' : 'agenda'}">${STATE.isAdmin ? `${icon('play', 15)}Entrer dans la table` : `${icon('calendar')}Mes disponibilités`}</button></div></div>${own.length ? cast(own, { ownOnly: true }) : ''}</div></section>`;
      }
      const group = groupList.find(item => item.id === first.questId) || {};
      const color = groupColor(group.id);
      const date = dateInfo(first.date);
      const slot = slotMeta(first.slot);
      const participants = (group.participants || []).map(charForParticipant);
      const image = missionImage(group);
      const hour = slot.label === 'Soir' ? '19 h' : slot.label === 'Après-midi' ? '14 h' : '9 h';
      const when = date.days === 0 ? `${slot.label === 'Soir' ? 'Ce soir' : slot.label === 'Après-midi' ? 'Cet après-midi' : 'Ce matin'} · ${hour}` : date.days === 1 ? 'Demain' : date.days > 1 ? `Dans ${date.days} jours` : date.short;
      const hurt = STATE.isAdmin ? participants.filter(char => charVitals(char).pvPct < 30) : [];
      const facts = [
        [icon('calendar', 15), 'Date', date.days === 0 ? "Aujourd'hui" : new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(date.date)],
        [icon('clock', 15), 'Créneau', `${slot.label} · ${slot.hours}`],
        ...(group.location ? [[icon('map-pin', 15), 'Lieu', group.location]] : []),
      ];
      const next = list.slice(1, 4);
      return `<section class="db-hero${image.url ? '' : ' noart'}${date.days === 0 ? ' today' : ''} rise" style="--i:1;--gc:${color}">
        ${image.url ? `<div class="db-hero-art${image.soft ? ' soft' : ''}" style="background-image:url('${_esc(cssUrl(image.url))}')"></div>` : '<div class="db-hero-art dots"></div>'}
        <div class="db-hero-main"><div class="db-hero-info"><div class="db-hero-k"><span class="db-hero-when"><i></i>${_esc(when)}</span><span>${date.days === 0 ? 'Séance du jour' : 'Prochaine séance'}</span></div>
          <h1>${_esc(group.missionTitle || 'Séance de l’aventure')}</h1><div class="db-hero-sub">${icon('flag', 14)}<b>${_esc(group.title || 'Groupe')}</b>${group.act ? `<span>· ${_esc(group.act)}</span>` : ''}</div>
          <div class="db-facts">${facts.map(([pic, label, value]) => `<div class="db-fact">${pic}<span><small>${label}</small><b>${_esc(value)}</b></span></div>`).join('')}${hurt.length ? `<div class="db-fact alert">${icon('alert', 15)}<span><small>À soigner avant</small><b>${hurt.map(char => { const v = charVitals(char); return `${_esc(char.nom || '?')} ${v.pv}/${v.pvMax}`; }).join(' · ')}</b></span></div>` : ''}</div>
          <div class="db-hero-act"><button type="button" class="db-go" data-navigate="vtt">${icon('play', 15)}Entrer dans la table</button><button type="button" class="db-glass" data-navigate="story">Voir la mission ${icon('arrow-right')}</button></div></div>${cast(participants)}</div>
        ${next.length ? `<div class="db-hero-next"><span class="db-next-k">Ensuite</span>${next.map(item => { const itemGroup = groupList.find(g => g.id === item.questId) || {}; const itemDate = dateInfo(item.date); const itemChars = (itemGroup.participants || []).map(charForParticipant); return `<button type="button" class="db-next" style="--gc:${groupColor(itemGroup.id)}" data-navigate="agenda"><span class="db-next-date"><small>${_esc(new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(itemDate.date))}</small><b>${itemDate.date?.getDate() || '--'}</b><small>${_esc(itemDate.month)}</small></span><span class="db-next-title"><b>${_esc(itemGroup.title || 'Groupe')}</b><span>${_esc(itemGroup.missionTitle || 'Mission')} · ${_esc(slotMeta(item.slot).label.toLowerCase())}</span></span>${itemChars.length ? `<span class="db-stack">${itemChars.slice(0, 4).map(char => avatar(char, 'sm')).join('')}</span>` : ''}</button>`; }).join('')}</div>` : ''}
      </section>`;
    };

    const playerCharactersSection = groupList => {
      const chars = controlledChars();
      const card = char => {
        const vitals = charVitals(char);
        const group = groupForChar(char, groupList);
        const level = Number(char.niveau) || 1;
        const xp = Number(char.exp ?? char.xp) || 0;
        const threshold = calcPalier(level) || 1;
        const xpPct = Math.max(0, Math.min(100, Math.round(xp / threshold * 100)));
        const color = /^#[0-9a-f]{6}$/i.test(char.auraColor || '') ? char.auraColor : characterColor(char);
        return `<button type="button" class="db-hero-char rise" style="--ac:${color}" data-action="_dashQuickChar" data-id="${_esc(char.id)}"><span class="db-hero-char-in"><span class="db-hero-char-portrait">${characterPortraitContent(char, { fallbackClass: 'ini' })}<span class="db-hero-char-level">Niv. ${level}</span></span><span class="db-hero-char-body"><span class="db-hero-char-name"><b>${_esc(char.nom || '?')}</b><small>${_esc([char.classe, char.race].filter(Boolean).join(' · '))}</small></span>${bars(char)}<span class="db-xp"><span>Niveau ${level + 1} dans <b>${Math.max(0, threshold - xp).toLocaleString('fr-FR')} XP</b></span><i><u style="width:${xpPct}%"></u></i></span><span class="db-chips"><span class="db-chip">${icon('shield')}CA <b>${calcCA(char) || 10}</b></span><span class="db-chip">${icon('coin')}<b>${calcOr(char) || 0}</b> or</span>${group ? `<span class="db-chip grp" style="--gc:${groupColor(group.id)}">${icon('flag')}${_esc(group.title)}</span>` : '<span class="db-chip">Sans groupe</span>'}${vitals.pvPct < 30 ? '<span class="db-chip warn">PV bas</span>' : ''}</span></span></span></button>`;
      };
      return `<section class="db-sec rise" style="--i:2"><div class="db-sh"><h2>${chars.length > 1 ? 'Mes personnages' : 'Mon personnage'}</h2>${chars.length > 1 ? `<span class="n">${chars.length}</span>` : ''}<span class="rule"></span>${chars.length ? `<button type="button" class="db-link" data-navigate="characters">Fiches ${icon('arrow-right')}</button>` : ''}</div><div class="db-hero-chars">${chars.length ? chars.map(card).join('') : `<button type="button" class="db-hero-char-new" data-navigate="characters"><i>${icon('plus', 18)}</i><b>Ton héros t’attend</b><span>Crée ta fiche pour rejoindre un groupe et être convoqué aux séances.</span></button>`}</div></section>`;
    };

    const groupsSection = groupList => {
      const available = freeChars(groupList);
      const sorted = STATE.isAdmin ? groupList : [...groupList].sort((a, b) => Number(groupJoined(a)) - Number(groupJoined(b)));
      const openCount = groupList.filter(group => !groupJoined(group)).length;
      const card = group => {
        const joined = !STATE.isAdmin && groupJoined(group);
        const members = (group.participants || []).map(charForParticipant);
        const session = sessions().find(item => item.questId === group.id);
        const picker = pickGroupId === group.id ? `<div class="db-pick"><small>Avec quel personnage ?</small><div>${available.length ? available.map(char => `<button type="button" class="c" data-action="_dashPickQuestChar" data-id="${_esc(group.id)}" data-char="${_esc(char.id)}">${avatar(char, 'sm')}${_esc(char.nom || '?')}</button>`).join('') : '<small>Tous tes personnages sont déjà dans un groupe.</small>'}</div></div>` : '';
        const action = STATE.isAdmin
          ? `<button type="button" class="db-link" data-navigate="story">Gérer ${icon('arrow-right')}</button>`
          : joined
            ? `<button type="button" class="db-btn ghost" data-action="_dashToggleQuest" data-id="${_esc(group.id)}">Quitter</button>`
            : available.length
              ? `<button type="button" class="db-btn pri" data-action="_dashToggleQuest" data-id="${_esc(group.id)}">Rejoindre</button>`
              : controlledChars().length
                ? `<button type="button" class="db-btn" disabled>Aucun personnage libre</button>`
                : `<button type="button" class="db-btn" disabled>Crée d’abord une fiche</button>`;
        return `<article class="db-g${joined ? ' in' : ''}" style="--gc:${groupColor(group.id)}"><div class="db-g-k"><span>${_esc([group.act, group.missionTitle].filter(Boolean).join(' · ') || 'Mission')}</span><em>${joined ? 'Rejoint' : 'Ouvert'}</em></div><h3>${_esc(group.title || 'Groupe')}</h3><p>${icon('calendar')}${session ? `Séance ${_esc(dateInfo(session.date).short.toLowerCase())}` : 'Pas encore de date'}</p>${picker}<div class="db-g-f">${members.length ? `<span class="db-stack">${members.slice(0, 4).map(char => avatar(char, 'sm', liveUids().has(char.uid))).join('')}</span>` : ''}<small>${members.length ? `${members.length} membre${members.length > 1 ? 's' : ''}` : 'Aucun membre'}</small>${action}</div></article>`;
      };
      return `<section class="db-sec rise" style="--i:3"><div class="db-sh"><h2>Groupes ouverts</h2><span class="n">${openCount}</span><span class="rule"></span><button type="button" class="db-link" data-navigate="story">Trame ${icon('arrow-right')}</button></div><div class="db-groups">${sorted.length ? sorted.map(card).join('') : '<div class="db-card db-empty"><b>Aucun groupe actif</b>Les groupes ouverts de la Trame apparaîtront ici.</div>'}</div></section>`;
    };

    const rosterMatches = (char, groupList) => {
      const vitals = charVitals(char);
      if (rosterFilter === 'online' && !liveUids().has(char.uid)) return false;
      if (rosterFilter === 'low' && vitals.pvPct >= 30) return false;
      if (rosterFilter === 'free' && groupForChar(char, groupList)) return false;
      if (rosterQuery.trim()) {
        const query = _norm(rosterQuery.trim());
        const haystack = [char.nom, char.ownerPseudo, char.joueur, char.playerName, char.classe, char.race].map(_norm);
        if (!haystack.some(value => value.includes(query))) return false;
      }
      return true;
    };
    const rosterMember = char => {
      const vitals = charVitals(char);
      const owner = char.ownerPseudo || char.joueur || char.playerName || 'Joueur';
      const ko = vitals.pv <= 0;
      const title = `${char.nom || '?'} · ${[char.classe, char.race].filter(Boolean).join(' ')} · niv. ${char.niveau || 1} · PV ${vitals.pv}/${vitals.pvMax} · PM ${vitals.pm}/${vitals.pmMax} · CA ${calcCA(char) || 10} · ${calcOr(char) || 0} or`;
      return `<button type="button" class="db-roster-member${vitals.pvPct < 30 ? ' low' : ''}${ko ? ' ko' : ''}" data-action="_dashQuickChar" data-id="${_esc(char.id)}" title="${_esc(title)}">${avatar(char, 'md', liveUids().has(char.uid))}<span class="db-roster-member-name"><b>${_esc(char.nom || '?')}</b><small>${liveUids().has(char.uid) ? '<em>En ligne</em> · ' : ''}${_esc(owner)} · niv. ${char.niveau || 1}</small></span><span class="db-roster-vitals"><b>${ko ? 'K.O.' : `${vitals.pv}<span>/${vitals.pvMax}</span>`}</b><small>PM ${vitals.pm}/${vitals.pmMax}</small></span><span class="db-roster-hp"><u style="width:${vitals.pvPct}%;--c:${hpColor(vitals.pvPct)}"></u></span></button>`;
    };
    const rosterTable = (list, groupList) => {
      const getters = {
        nom: char => char.nom || '', owner: char => char.ownerPseudo || char.joueur || char.playerName || '', level: char => Number(char.niveau) || 1,
        pv: char => charVitals(char).pvPct, pm: char => charVitals(char).pmPct, ca: char => calcCA(char) || 10, gold: char => calcOr(char) || 0,
        group: char => groupForChar(char, groupList)?.title || '~',
      };
      const rows = [...list].sort((a, b) => { const av = getters[rosterSort.key](a); const bv = getters[rosterSort.key](b); const value = (typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv), 'fr')) * rosterSort.dir; return value || String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'); });
      const heads = [['nom', 'Personnage', ''], ['owner', 'Joueur', 'hide-760'], ['level', 'Niv.', 'num'], ['pv', 'PV', ''], ['pm', 'PM', 'hide-560'], ['ca', 'CA', 'num hide-560'], ['gold', 'Or', 'num hide-760'], ['group', 'Groupe', 'hide-560']];
      return `<div class="db-roster-table-wrap db-card"><table class="db-roster-table"><thead><tr>${heads.map(([key, label, cls]) => `<th class="${cls}${rosterSort.key === key ? ' active' : ''}" data-action="_dashRosterSort" data-sort="${key}" aria-sort="${rosterSort.key === key ? (rosterSort.dir > 0 ? 'ascending' : 'descending') : 'none'}">${label}${rosterSort.key === key ? (rosterSort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}</tr></thead><tbody>${rows.map(char => { const v = charVitals(char); const group = groupForChar(char, groupList); const owner = char.ownerPseudo || char.joueur || char.playerName || 'Joueur'; return `<tr class="${v.pvPct < 30 ? 'low' : ''}" data-action="_dashQuickChar" data-id="${_esc(char.id)}"><td><span class="db-table-who">${avatar(char, 'md')}<span><b>${_esc(char.nom || '?')}</b><small>${_esc([char.classe, char.race].filter(Boolean).join(' · '))}</small></span></span></td><td class="hide-760">${liveUids().has(char.uid) ? '<i class="db-online-dot"></i>' : ''}${_esc(owner)}</td><td class="num">${char.niveau || 1}</td><td><span class="db-table-pv"><i><u style="width:${v.pvPct}%;--c:${hpColor(v.pvPct)}"></u></i><b>${v.pv <= 0 ? 'K.O.' : `${v.pv}/${v.pvMax}`}</b></span></td><td class="hide-560 mono">${v.pm}/${v.pmMax}</td><td class="num hide-560">${calcCA(char) || 10}</td><td class="num hide-760">${calcOr(char) || 0}</td><td class="hide-560">${group ? `<span class="db-group-label" style="--gc:${groupColor(group.id)}"><i></i>${_esc(group.title)}</span>` : '<span class="db-dim">Sans groupe</span>'}</td></tr>`; }).join('')}</tbody></table></div>`;
    };
    const rosterBody = groupList => {
      const filtering = rosterFilter !== 'all' || rosterQuery.trim();
      const list = allChars.filter(char => rosterMatches(char, groupList));
      if (!list.length) return `<div class="db-roster-empty">Aucun personnage ne correspond.<button type="button" class="db-btn" data-action="_dashRosterClear">Tout afficher</button></div>`;
      if (rosterView === 'table') return rosterTable(list, groupList);
      const sessionList = sessions();
      const dateOf = group => sessionList.find(item => item.questId === group.id)?.date || '9999-99-99';
      const columns = [...groupList].sort((a, b) => dateOf(a).localeCompare(dateOf(b)) || String(a.title).localeCompare(String(b.title), 'fr')).map(group => ({ group, members: list.filter(char => groupForChar(char, groupList)?.id === group.id).sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr')) })).filter(column => !filtering || column.members.length);
      const free = list.filter(char => !groupForChar(char, groupList));
      if (free.length) columns.push({ group: null, members: free });
      return `<div class="db-roster-grid">${columns.map(({ group, members }) => {
        const session = group ? sessionList.find(item => item.questId === group.id) : null;
        const sessionDate = session ? dateInfo(session.date) : null;
        const dateLabel = sessionDate?.days === 0 ? `Aujourd’hui · ${slotMeta(session.slot).label.toLowerCase()}` : sessionDate?.short;
        const live = members.filter(char => liveUids().has(char.uid)).length;
        const total = group ? (group.participants || []).length : members.length;
        const compactFree = !group && members.length > 6;
        const shownMembers = compactFree && !rosterFreeExpanded ? members.slice(0, 6) : members;
        const remaining = Math.max(0, members.length - shownMembers.length);
        const more = compactFree
          ? `<button type="button" class="db-roster-more" data-action="_dashRosterFreeToggle" aria-expanded="${rosterFreeExpanded}">${rosterFreeExpanded ? 'Réduire la liste' : `Afficher les ${remaining} autres`}${icon(rosterFreeExpanded ? 'arrow-right' : 'plus', 12)}</button>`
          : '';
        return `<article class="db-roster-column${group ? '' : ' free'}" style="--gc:${group ? groupColor(group.id) : 'var(--text-dim)'}"><header><div class="db-roster-title"><b>${_esc(group?.title || 'Sans groupe')}</b><span>${total}</span>${group ? `<button type="button" data-navigate="story" title="Gérer dans la Trame" aria-label="Gérer ${_esc(group.title)} dans la Trame">${icon('external')}</button>` : ''}</div><p>${_esc(group ? [group.act, group.missionTitle].filter(Boolean).join(' · ') : 'Pas encore dans un groupe de la Trame')}</p>${group ? `<div class="db-roster-meta"><span class="${session ? '' : 'none'}">${icon('calendar')}${session ? _esc(dateLabel) : 'Sans date'}</span>${live ? `<em><i></i>${live} en ligne</em>` : ''}</div>` : ''}</header><div>${shownMembers.length ? shownMembers.map(rosterMember).join('') : '<div class="db-roster-column-empty">Aucun membre · ouvert aux joueurs</div>'}${more}</div></article>`;
      }).join('')}</div>`;
    };
    const gmRosterSection = groupList => {
      const counts = { all: allChars.length, online: allChars.filter(char => liveUids().has(char.uid)).length, low: allChars.filter(char => charVitals(char).pvPct < 30).length, free: allChars.filter(char => !groupForChar(char, groupList)).length };
      const filters = [['all', 'Tous', ''], ['online', 'En ligne', 'var(--emerald)'], ['low', 'PV bas', 'var(--crimson)'], ['free', 'Sans groupe', '']];
      return `<section class="db-sec rise" style="--i:2"><div class="db-sh"><h2>La compagnie</h2><span class="n">${allChars.length}</span><span class="rule"></span><button type="button" class="db-link" data-navigate="characters">Toutes les fiches ${icon('arrow-right')}</button></div><div class="db-roster-tools"><div class="db-roster-filters" role="group" aria-label="Filtrer la compagnie">${filters.map(([key, label, color]) => `<button type="button" class="${rosterFilter === key ? 'on' : ''}" data-action="_dashRosterFilter" data-filter="${key}" aria-pressed="${rosterFilter === key}">${color ? `<i style="--c:${color}"></i>` : ''}${label}<em>${counts[key]}</em></button>`).join('')}</div><label class="db-roster-search">${icon('search', 14)}<input id="db-roster-query" type="search" placeholder="Personnage, joueur, classe…" value="${_esc(rosterQuery)}" autocomplete="off" data-input="_dashRosterSearch" aria-label="Chercher dans la compagnie"></label><span class="sp"></span><div class="db-roster-view" role="group" aria-label="Affichage"><button type="button" class="${rosterView === 'groups' ? 'on' : ''}" data-action="_dashRosterView" data-view="groups" aria-pressed="${rosterView === 'groups'}">${icon('columns', 14)}Groupes</button><button type="button" class="${rosterView === 'table' ? 'on' : ''}" data-action="_dashRosterView" data-view="table" aria-pressed="${rosterView === 'table'}">${icon('rows', 14)}Tableau</button></div></div><div id="db-roster-body">${rosterBody(groupList)}</div></section>`;
    };

    const wallSection = () => {
      const seenAt = wallSeenAt();
      const { unread, shown } = dashboardWallView({ docs: wallDocs, seenAt, uid: STATE.user?.uid });
      const card = post => {
        const char = allChars.find(item => item.id === post.charId) || { nom: post.charName || post.author || 'Personnage', photo: post.charImage || '' };
        const type = BASTION_WALL_TYPES[post.type] || BASTION_WALL_TYPES.message;
        const reactions = Object.values(bastionWallReactionCounts(post)).reduce((sum, value) => sum + value, 0);
        const replies = Number(post.commentCount) || (post.comments || []).length;
        const isUnread = post.ts > seenAt && post.uid !== STATE.user?.uid;
        // Vente du Marché : l'objet et son prix, même sans message.
        const sale = post.type === 'offre' && Array.isArray(post.listing?.items) && post.listing.items.length
          ? { name: post.listing.name || 'Objet', price: Number(post.listing.bid?.amount || post.listing.price || 0) } : null;
        return `<button type="button" class="db-w${isUnread ? ' unread' : ''}" data-navigate="bastion" data-nav-sub="post:${_esc(post.id)}">${avatar(char, 'md')}<span class="db-w-b"><span class="db-w-h"><b>${_esc(post.charName || post.author || char.nom || 'Personnage')}</b><span class="db-ty" style="--t:${_esc(type.color)}">${_esc(type.label)}</span>${post.pinned ? '<span class="db-pin">Épinglé</span>' : ''}<span>· ${timeAgo(post.ts)}</span></span>${sale ? `<span class="db-wall-listing">${icon('coin')}<b>${_esc(sale.name)}</b><em>${sale.price.toLocaleString('fr-FR')} or</em></span>` : ''}<p>${_esc(post.text || (sale ? '' : 'Nouvelle publication'))}</p><span class="db-w-s"><span>${icon('heart', 12)}${reactions}</span><span>${icon('message', 12)}${replies}</span></span></span></button>`;
      };
      return `<section class="db-sec db-wall"><div class="db-sh"><h2>Mur du Bastion</h2>${unread ? `<span class="new">${unread} nouveau${unread > 1 ? 'x' : ''}</span>` : ''}<span class="sp"></span><button type="button" class="db-link" data-navigate="bastion">Ouvrir ${icon('arrow-right')}</button></div><div class="db-card">${shown.length ? shown.map(card).join('') : '<div class="db-empty"><b>Le mur est prêt</b>Publiez la première nouvelle du Bastion.</div>'}<div class="db-wf"><button type="button" class="db-btn" data-navigate="bastion">${icon('edit')} Publier</button>${unread ? '<button type="button" class="db-btn ghost" data-action="_dashMarkWallRead">Tout marquer lu</button>' : ''}</div></div></section>`;
    };

    const bastionSection = () => {
      const projects = bastionRoomProjects(bastion || {}, bastionInvestments);
      const catalog = Array.isArray(bastion?.roomCatalog) ? bastion.roomCatalog : [];
      const buildings = catalog.filter(room => Number(bastion?.salles?.[room.slug]?.weeksLeftToBuild) > 0);
      const contributorRows = slug => {
        return roomInvestmentContributors(bastion || {}, bastionInvestments, slug)
          .map(row => ({ ...row, name: row.charName }));
      };
      const projectRow = project => {
        const rows = contributorRows(project.slug);
        const segments = rows.map(row => {
          const char = allChars.find(item => item.id === row.charId) || { nom: row.name };
          const color = /^#[0-9a-f]{6}$/i.test(char.auraColor || '') ? char.auraColor : characterColor(char);
          return `<i style="--segment:${color};width:${project.cost ? Math.min(100, row.amount / project.cost * 100) : 0}%"></i>`;
        }).join('');
        const funded = Math.max(0, Number(project.cost || 0) - Number(project.remaining || 0));
        return `<div class="db-bs-project" style="--room:${_esc(project.def.color || '#7eb0ff')}"><span class="db-bs-icon">${_esc(project.def.emoji || '🏠')}</span><span><span class="db-bs-head"><b>${_esc(project.name)} ${project.def.unlimited ? project.target : ['','I','II','III'][project.target] || project.target}</b><small>${funded.toLocaleString('fr-FR')} / ${Number(project.cost || 0).toLocaleString('fr-FR')} or</small></span><span class="db-bs-bar">${segments}</span><span class="db-bs-meta"><span>Il manque <b>${Number(project.remaining || 0).toLocaleString('fr-FR')} or</b></span>${rows.length ? `<span class="db-stack">${rows.slice(0, 5).map(row => avatar(allChars.find(item => item.id === row.charId) || { nom: row.name }, 'sm')).join('')}</span>` : ''}</span></span></div>`;
      };
      const closest = projects[0];
      const note = closest?.next?.bonus ? String(closest.next.bonus) : '';
      return `<section class="db-sec db-bastion"><div class="db-sh"><h2>Bastion</h2><span class="rule"></span><button type="button" class="db-link" data-navigate="bastion" data-nav-sub="salles">Salles ${icon('arrow-right')}</button></div><div class="db-card db-bs-card">${projects.length ? projects.slice(0, 2).map(projectRow).join('') : '<div class="db-empty"><b>Aucun chantier ouvert</b>Une cotisation depuis les salles fera apparaître l’objectif commun ici.</div>'}${closest ? `<div class="db-bs-footer"><span>${_esc(note.length > 76 ? `${note.slice(0, 74)}…` : note)}</span>${closest.remaining > 0 ? `<button type="button" class="db-btn pri" data-navigate="bastion" data-nav-sub="room:${_esc(closest.slug)}">Cotiser ${Math.min(50, closest.remaining)} or</button>` : `<button type="button" class="db-btn pri" data-navigate="bastion" data-nav-sub="room:${_esc(closest.slug)}">Financé</button>`}</div>` : ''}${buildings.length ? `<div class="db-bs-building">${buildings.map(room => `<b>${_esc(room.emoji || '🏗')} ${_esc(room.nom)}</b> ouvre dans ${Number(bastion.salles[room.slug].weeksLeftToBuild)} période${Number(bastion.salles[room.slug].weeksLeftToBuild) > 1 ? 's' : ''}`).join(' · ')}</div>` : ''}</div></section>`;
    };

    function paint() {
      paintQueued = false;
      _ctrlMemo = null; _liveMemo = null; _groupsMemo = null; _sessionsMemo = null; // données fraîches pour ce paint
      const root = document.getElementById('dash-root');
      if (!root || STATE.currentPage !== 'dashboard') return;
      const activeSearch = document.activeElement?.id === 'db-roster-query';
      const searchCaret = activeSearch ? document.activeElement.selectionStart : null;
      STATE.characters = allChars;
      setDashboardPartyChars(allChars);
      setDashboardQuests(quests);
      const groupList = groups();
      const sessionList = sessions();
      const hasJoinedGroup = groupList.some(groupJoined);
      const sessionBanner = sessionSection(sessionList, groupList);
      const pseudo = STATE.profile?.pseudo || STATE.profile?.displayName || STATE.user?.displayName || String(STATE.user?.email || '').split('@')[0] || 'aventurier';
      const adventure = STATE.adventure?.nom || 'Aventure';
      const initials = adventure.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'A';
      const live = liveUids();
      const onlineChars = [...live].map(uid => allChars.find(char => char.uid === uid)).filter(Boolean);
      const wall = isFeatureEnabled('bastion') ? wallSection() : '';
      const bastionCard = isFeatureEnabled('bastion') ? bastionSection() : '';
      const hour = new Date().getHours();
      const greeting = hour >= 5 && hour < 18 ? 'Bonjour' : 'Bonsoir';
      const top = `<div class="db-top rise" style="--i:0"><button type="button" class="db-adv" data-action="openAdventureSwitcher"><span class="sig">${_esc(initials)}</span><span><b>${_esc(adventure)}</b><small>${icon('refresh-cw')}Changer</small></span></button><span class="db-me">${STATE.isAdmin ? `<span class="db-online-stack">${onlineChars.slice(0, 5).map(char => avatar(char, 'sm', true)).join('')}</span><span class="db-online"><i></i>${live.size} en ligne</span>` : ''}<span>${greeting}, <b>${_esc(pseudo)}</b></span>${STATE.isAdmin ? '<span class="db-role">Maître de jeu</span>' : ''}</span></div>`;
      let body = '';
      if (STATE.isAdmin) {
        body = `${top}${sessionBanner}${gmRosterSection(groupList)}${wall || bastionCard ? `<div class="db-grid two">${wall}${bastionCard}</div>` : ''}`;
      } else {
        const characterSection = playerCharactersSection(groupList);
        const groupSection = groupsSection(groupList);
        const main = hasJoinedGroup ? [characterSection, groupSection] : [groupSection, characterSection];
        body = `${top}${sessionBanner}<div class="db-grid${wall || bastionCard ? '' : ' solo'}"><div class="db-col">${main.join('')}</div>${wall || bastionCard ? `<div class="db-col">${wall}${bastionCard}</div>` : ''}</div>`;
      }
      root.innerHTML = body;
      if (!dashboardMounted) {
        dashboardMounted = true;
        root.classList.add('anim');
        clearTimeout(dashboardAnimTimer);
        dashboardAnimTimer = setTimeout(() => root.classList.remove('anim'), 1800);
      }
      if (activeSearch) {
        const search = root.querySelector('#db-roster-query');
        search?.focus({ preventScroll: true });
        if (search && searchCaret !== null) search.setSelectionRange(searchCaret, searchCaret);
      }
    }

    const replaceParticipants = (groupId, participants) => {
      groupOverrides.set(groupId, participants);
      if (STATE.isAdmin) quests = quests.map(quest => quest.id === groupId ? { ...quest, participants } : quest);
      schedulePaint();
    };
    const persistParticipants = async (group, participants, leaving) => {
      const previous = group.participants || [];
      replaceParticipants(group.id, participants);
      const enriched = participants.map(participant => {
        const char = allChars.find(item => item.id === participant?.charId);
        return char ? questParticipantFromChar(char, participant.uid || char.uid) : participant;
      });
      const saved = await _dashSaveQuestParticipants(group.id, enriched, { leaving });
      if (!saved) replaceParticipants(group.id, previous);
      return saved;
    };
    _dashUi = {
      characterIds: () => (STATE.isAdmin ? allChars : controlledChars()).map(char => char.id),
      setRosterFilter(value) {
        rosterFilter = ['all', 'online', 'low', 'free'].includes(value) ? value : 'all';
        rosterFreeExpanded = false;
        schedulePaint();
      },
      setRosterView(value) {
        rosterView = value === 'table' ? 'table' : 'groups';
        try { localStorage.setItem('dash-roster-view', rosterView); } catch { /* stockage privé */ }
        schedulePaint();
      },
      searchRoster(input) {
        rosterQuery = input?.value || '';
        const body = document.getElementById('db-roster-body');
        if (body) body.innerHTML = rosterBody(groups());
      },
      sortRoster(key) {
        const allowed = ['nom', 'owner', 'level', 'pv', 'pm', 'ca', 'gold', 'group'];
        if (!allowed.includes(key)) return;
        rosterSort = rosterSort.key === key
          ? { key, dir: -rosterSort.dir }
          : { key, dir: ['level', 'ca', 'gold'].includes(key) ? -1 : 1 };
        const body = document.getElementById('db-roster-body');
        if (body) body.innerHTML = rosterBody(groups());
      },
      clearRoster() {
        rosterFilter = 'all';
        rosterQuery = '';
        rosterFreeExpanded = false;
        schedulePaint();
      },
      toggleFreeRoster() {
        rosterFreeExpanded = !rosterFreeExpanded;
        const body = document.getElementById('db-roster-body');
        if (body) body.innerHTML = rosterBody(groups());
      },
      async toggleQuest(groupId) {
        const groupList = groups();
        const group = groupList.find(item => item.id === groupId);
        if (!group) { showNotif('Groupe introuvable.', 'error'); return; }
        if (groupJoined(group)) {
          const next = (group.participants || []).filter(participant => !aliasSet.has(participant?.uid));
          await persistParticipants(group, next, true);
          pickGroupId = '';
          return;
        }
        const available = freeChars(groupList);
        if (!available.length) {
          if (!controlledChars().length) {
            showNotif('Crée d’abord un personnage pour rejoindre un groupe.', 'info');
            goToChar('');
          } else showNotif('Tous tes personnages sont déjà dans un groupe.', 'info');
          return;
        }
        if (available.length > 1) {
          pickGroupId = pickGroupId === groupId ? '' : groupId;
          schedulePaint();
          return;
        }
        await this.pickQuestChar(groupId, available[0].id);
      },
      async pickQuestChar(groupId, charId) {
        const group = groups().find(item => item.id === groupId);
        const char = controlledChars().find(item => item.id === charId);
        if (!group || !char) { showNotif('Groupe ou personnage introuvable.', 'error'); return; }
        const next = [
          ...(group.participants || []).filter(participant => !aliasSet.has(participant?.uid)),
          questParticipantFromChar(char, STATE.user?.uid || char.uid),
        ];
        pickGroupId = '';
        await persistParticipants(group, next, false);
      },
      async markWallRead() {
        const seenAt = Date.now();
        wallRead = { ...(wallRead || {}), seenAt, updatedAt: seenAt };
        try { localStorage.setItem(bastionWallSeenKey(STATE.adventure?.id, STATE.user?.uid), String(seenAt)); } catch { /* stockage privé */ }
        _dashWallFeed?.setSeenAt(seenAt);
        schedulePaint();
        if (STATE.user?.uid) await saveDoc('bastionWallReads', STATE.user.uid, { seenAt, updatedAt: seenAt }, { silent: true }).catch(() => {});
      },
    };
    const uiRef = _dashUi;

    const dashboardKeydown = event => {
      if (STATE.currentPage !== 'dashboard' || !STATE.isAdmin) return;
      const search = document.getElementById('db-roster-query');
      if (event.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) {
        event.preventDefault();
        search?.focus();
      } else if (event.key === 'Escape' && document.activeElement === search && rosterQuery) {
        rosterQuery = '';
        search.value = '';
        const body = document.getElementById('db-roster-body');
        if (body) body.innerHTML = rosterBody(groups());
      }
    };
    document.addEventListener('keydown', dashboardKeydown);
    document.addEventListener('app:page-changed', () => {
      document.removeEventListener('keydown', dashboardKeydown);
      clearTimeout(dashboardAnimTimer);
    }, { once: true });

    paint();
    watch('dash-characters', 'characters', data => { allChars = sortCharactersForDisplay(data || []); schedulePaint(); });
    if (STATE.isAdmin) {
      watch('dash-story', 'story', data => { story = data || []; schedulePaint(); });
      watch('dash-quests', 'quests', data => { quests = data || []; schedulePaint(); });
      watchDoc('dash-agenda', 'agenda_session', 'next', data => { agenda = data; schedulePaint(); });
      watch('dash-presence', 'presence', data => { presence = data || []; schedulePaint(); });
    } else {
      watchDoc('dash-summary', 'settings', 'dashboardSummary', data => { summary = isUsableSummary(data) ? data : null; schedulePaint(); }, { silent: true });
    }
    if (isFeatureEnabled('bastion')) {
      _dashWallFeed?.stop();
      const syncBastionCard = () => {
        ({ bastion, investments: bastionInvestments } = bastionSignalSnapshot());
        schedulePaint();
      };
      document.addEventListener('app:bastion-signal-changed', syncBastionCard);
      const wallFeed = createDashboardWallFeed(
        { subscribeRecent: subscribeRecentCollection, subscribeWhere: subscribeRecentWhere },
        docs => { wallDocs = docs || []; schedulePaint(); },
      );
      _dashWallFeed = wallFeed;
      wallFeed.start(wallSeenAt());
      if (STATE.user?.uid) watchDoc('dash-bastion-wall-read', 'bastionWallReads', STATE.user.uid, data => {
        wallRead = data;
        wallFeed.setSeenAt(wallSeenAt());
        schedulePaint();
      }, { silent: true });
      document.addEventListener('app:page-changed', () => {
        wallFeed.stop();
        document.removeEventListener('app:bastion-signal-changed', syncBastionCard);
        if (_dashWallFeed === wallFeed) _dashWallFeed = null;
        if (_dashUi === uiRef) _dashUi = null;
      }, { once: true });
    } else {
      document.addEventListener('app:page-changed', () => {
        if (_dashUi === uiRef) _dashUi = null;
      }, { once: true });
    }
  },

  // ─── CHARACTERS ─────────────────────────────────────────────────────────────
  async characters() {
    const uid      = STATE.user.uid;
    const allChars = sortCharactersForDisplay(await loadChars());
    STATE.characters = allChars;
    const chars = getControlledCharacters(allChars, uid);
    const content = document.getElementById('main-content');
    // V3 : le bandeau collant de la fiche (characters.js → .cs-top) porte le
    // titre, le sélecteur de personnage et le filtre par compte. Ici, quand des
    // persos existent, on ne pose que le conteneur ; l'en-tête plein n'apparaît
    // que sur l'état vide.
    let html = '';
    if (chars.length === 0) {
      html = `${pageHeaderHtml(STATE.isAdmin ? '📜 Tous les Personnages' : '📜 Mes Personnages', 'Gérez vos fiches de personnage')}`
        + emptyStateHtml('📜', 'Aucun personnage. Crée ton premier héros !')
        + `<div style="margin-bottom:1.5rem"><button class="char-pill-new" data-action="createNewChar">+ Nouveau personnage</button></div>`;
    } else {
      html = `<div id="char-sheet-area"></div>`;
    }
    content.innerHTML = html;
    if (chars.length > 0) {
      const target = consumeTargetCharacter();
      // Deep-link : #characters/<idPerso>/<onglet> (onglet ouvert au clic molette,
      // lien partagé). Formes tolérées : ".../<onglet>" seul, ou id seul.
      const [routeA, routeB] = getRouteSub('characters').split('/');
      const routeId  = routeB ? routeA : '';
      const routeTab = routeB || routeA || '';
      const targetId = (typeof target === 'string' ? target : target?.id) || routeId;
      const targetTab = (typeof target === 'object' ? target?.tab : null) || routeTab || null;
      // Sélection par défaut : la cible explicite (VTT…), sinon le perso favori
      // (★ par défaut) du joueur, sinon le premier.
      const charToShow = (targetId ? chars.find(c => c.id === targetId) : null)
        || getDefaultCharForUser(chars, STATE.user?.uid)
        || chars[0];
      STATE.activeChar = charToShow;
      renderCharSheet(charToShow, targetTab);
    }

    // La collection personnages est déjà session-live : cet abonnement ne
    // crée pas de lecture supplémentaire. Il permet notamment d’afficher sans
    // rechargement un objet envoyé depuis le VTT.
    let previousChars = chars;
    watch("characters-live", "characters", data => {
      if (STATE.currentPage !== "characters") return;
      const allNextChars = sortCharactersForDisplay(data || []);
      const nextChars = getControlledCharacters(allNextChars, STATE.user.uid);
      const activeId = charSession.getCurrentChar()?.id || STATE.activeChar?.id;
      const previousActive = previousChars.find(c => c.id === activeId);
      const nextActive = nextChars.find(c => c.id === activeId);
      STATE.characters = allNextChars;
      for (const c of nextChars) {
        const previousInv = previousChars.find(old => old.id === c.id)?.inventaire || [];
        const currentInv = c.inventaire || [];
        if (currentInv.length <= previousInv.length) continue;
        const labels = currentInv.slice(previousInv.length).map(item => item?.nom || "Objet").join(", ");
        showNotif("📦 Inventaire de " + (c.nom || "votre personnage") + " mis à jour : " + labels, "success");
      }
      previousChars = nextChars;
      if (!nextActive) {
        const fallback = getDefaultCharForUser(nextChars, STATE.user?.uid) || nextChars[0];
        if (fallback) {
          STATE.activeChar = fallback;
          renderCharSheet(fallback);
        } else {
          void PAGES.characters();
        }
        return;
      }
      STATE.activeChar = nextActive;
      // La fiche ouverte doit relire le même objet que le reste de l'app : chaque
      // snapshot fournit de nouveaux objets, et une édition (relations, notes…)
      // écrite sur la copie fraîche restait invisible jusqu'au rechargement.
      if (charSession.getCurrentChar()?.id === nextActive.id) {
        charSession.set(nextActive, charSession.getCanEditChar(), charSession.getCurrentCharTab());
      }
      const inventoryChanged = JSON.stringify(previousActive?.inventaire || []) !== JSON.stringify(nextActive.inventaire || []);
      if (inventoryChanged && charSession.getCurrentCharTab() === "inv") {
        renderCharSheet(nextActive, "inv");
      }
    });
  },

  // ─── SHOP ───────────────────────────────────────────────────────────────────
  async shop() {
    const { renderShop } = await import('./shop.js');
    await renderShop();
  },

  // ─── MAP ────────────────────────────────────────────────────────────────────
  async map() {
    const content = document.getElementById('main-content');

    // La page map prend toute la hauteur dispo ; navigation.js nettoie ces styles inline en quittant la page.
    content.style.padding = '0';
    content.style.height  = 'calc(100vh - var(--header-height))';

    content.innerHTML = `
    <div class="map-page-shell">
      <div id="map-container" class="map-page-container"></div>
    </div>`;

    // Import et init carte interactive
    const { initMap } = await import('./map.js');
    await initMap(document.getElementById('map-container'));
  },

// ─── BASTION ────────────────────────────────────────────────────────────────
  async bastion() {
    const { default: renderBastionPage } = await import('./bastion.js');
    await renderBastionPage();
  },

  // ─── ACHIEVEMENTS ───────────────────────────────────────────────────────────
  async achievements() {
    // Shell uniquement — le contenu est délégué à achievements.js (_achRenderContent)
    const achState = PAGES._achievementsShellState || { items: [], filter: 'all', view: 'galerie', search: '' };
    const allItems = achState.items.length ? achState.items : await loadCollection('achievements');
    // Les joueurs ne doivent rien voir des HF secrets, y compris dans les compteurs
    const items = STATE.isAdmin ? allItems : allItems.filter(a => !a.secret);
    const content = document.getElementById('main-content');

    const CATS = Array.isArray(achState.categories) && achState.categories.length
      ? achState.categories
      : [
        { id: 'epique',   label: 'Épique',   emoji: '⚔️',  color: '#4f8cff' },
        { id: 'comique',  label: 'Comique',  emoji: '🎭',  color: '#e8b84b' },
        { id: 'histoire', label: 'Histoire', emoji: '📖',  color: '#22c38e' },
      ];
    const defaultCat = CATS[0]?.id || 'epique';
    const byCat = Object.fromEntries(CATS.map(c => [c.id, 0]));
    items.forEach(a => { const c = a.categorie || defaultCat; if (c in byCat) byCat[c]++; });
    const total        = items.length;
    const activeFilter = achState.filter ?? 'all';
    const activeView   = achState.view   ?? 'galerie';
    const activeGroup  = ['mission', 'month'].includes(achState.group) ? achState.group : 'none';
    const activeDensity = ['s', 'l'].includes(achState.density) ? achState.density : 'm';
    const activeOrder = achState.galleryOrder === 'desc' ? 'desc' : 'asc';
    const dated = items.map(item => Date.parse(item.date || '')).filter(Number.isFinite).sort((a, b) => a - b);
    const monthSpan = dated.length ? Math.max(1, (new Date(dated.at(-1)).getFullYear() - new Date(dated[0]).getFullYear()) * 12 + new Date(dated.at(-1)).getMonth() - new Date(dated[0]).getMonth() + 1) : 0;

    content.innerHTML = `<div class="hall-root">
    <section class="hall-command" aria-label="Navigation des hauts-faits">
      <div class="hall-command-in">
        <div class="hall-command-head">
          <div class="hall-command-title">
            <h1>Hauts-Faits</h1>
            <small data-gallery-text="Galerie de campagne · ${total} ${total > 1 ? 'souvenirs' : 'souvenir'}${monthSpan ? ` · ${monthSpan} mois d'aventure` : ''}">Galerie de campagne · ${total} ${total > 1 ? 'souvenirs' : 'souvenir'}${monthSpan ? ` · ${monthSpan} mois d'aventure` : ''}</small>
          </div>
          <span class="hall-command-spacer"></span>
          ${STATE.isAdmin ? `<div class="hall-command-tools">
            <button class="hall-tool-btn" data-action="_achToggleBulkMode" title="Classer plusieurs hauts-faits" aria-label="Sélectionner plusieurs hauts-faits" aria-pressed="false">
              <span aria-hidden="true">☑</span>
              <span data-ach-bulk-label>Sélectionner</span>
            </button>
            <button class="hall-tool-btn" data-action="openAchievementCategoriesAdmin" title="Gérer les catégories" aria-label="Gérer les catégories de hauts-faits">
              <svg aria-hidden="true"><use href="./assets/img/icons.svg#icon-cog"/></svg>
            </button>
            <button class="hall-tool-btn hall-tool-btn--primary" data-action="openAchievementModal" title="Ajouter un haut-fait" aria-label="Ajouter un haut-fait">
              <span class="hall-tool-plus" aria-hidden="true">+</span>
              <span>Nouveau</span>
              <kbd>N</kbd>
            </button>
          </div>` : ''}
        </div>
        <div class="hall-command-controls">
          <div class="hall-filter-board" role="group" aria-label="Catégorie de hauts-faits">
        <button type="button" class="hall-filter-card${activeFilter === 'all' ? ' active' : ''}" style="--c:#7eb0ff" data-filter="all" data-action="_achSetFilter" data-val="all" aria-pressed="${activeFilter === 'all'}">
          <span class="hall-filter-icon">🏆</span>
          <span class="hall-filter-copy">
            <strong>Tous</strong>
            <small class="hall-filter-num">${total}</small>
          </span>
        </button>
        ${CATS.map(c => {
          const count = byCat[c.id] || 0;
          return `
        <button type="button" class="hall-filter-card${activeFilter === c.id ? ' active' : ''}" style="--c:${c.color}" data-filter="${c.id}" data-action="_achSetFilter" data-val="${c.id}" aria-pressed="${activeFilter === c.id}">
          <span class="hall-filter-icon">${c.emoji}</span>
          <span class="hall-filter-copy">
            <strong>${_esc(c.label)}</strong>
            <small class="hall-filter-num">${count}</small>
          </span>
        </button>`;
        }).join('')}
          </div>
          <div id="ach-controls-extra" class="ach-controls-extra" aria-label="Filtres avancés"></div>
          <span class="hall-command-controls-spacer" aria-hidden="true"></span>
          <div class="hall-command-search">
            <label class="search-wrap" for="ach-search-input">
              <svg aria-hidden="true"><use href="./assets/img/icons.svg#icon-search"/></svg>
              <input type="search" placeholder="Rechercher un souvenir…" id="ach-search-input" aria-label="Rechercher dans les hauts-faits"
                value="${_esc(achState.search || '')}"
                data-input="_achSetSearch">
              <kbd>/</kbd>
            </label>
          </div>
        </div>
        <div class="hall-command-foot">
          <div class="view-toggle" role="tablist" aria-label="Mode d'affichage des hauts-faits">
            <button class="view-tab${activeView === 'galerie' ? ' active' : ''}" data-action="_achSetView" data-val="galerie" data-nav-page="achievements" data-nav-sub="galerie" role="tab" aria-selected="${activeView === 'galerie'}">▦ Galerie</button>
            <button class="view-tab${activeView === 'timeline' ? ' active' : ''}" data-action="_achSetView" data-val="timeline" data-nav-page="achievements" data-nav-sub="timeline" role="tab" aria-selected="${activeView === 'timeline'}">⋮ Chronologie</button>
            <button class="view-tab${activeView === 'missions' ? ' active' : ''}" data-action="_achSetView" data-val="missions" data-nav-page="achievements" data-nav-sub="missions" role="tab" aria-selected="${activeView === 'missions'}">◎ Missions</button>
          </div>
          <div class="ach-view-options ach-gallery-options" aria-label="Options de la fresque">
            <div class="ach-option-group" role="group" aria-label="Chapitres">
              <span>Chapitres</span>
              <button class="${activeGroup === 'mission' ? 'active' : ''}" data-action="_achSetGroup" data-ach-group="mission">Missions</button>
              <button class="${activeGroup === 'month' ? 'active' : ''}" data-action="_achSetGroup" data-ach-group="month">Mois</button>
              <button class="${activeGroup === 'none' ? 'active' : ''}" data-action="_achSetGroup" data-ach-group="none">Aucun</button>
            </div>
            <div class="ach-option-group ach-density" role="group" aria-label="Taille des vignettes">
              <span>Taille</span>
              <button class="${activeDensity === 's' ? 'active' : ''}" data-action="_achSetDensity" data-ach-density="s" title="Vignettes compactes" aria-label="Vignettes compactes"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2h3v3H2zM6.5 2h3v3h-3zM11 2h3v3h-3zM2 6.5h3v3H2zM6.5 6.5h3v3h-3zM11 6.5h3v3h-3zM2 11h3v3H2zM6.5 11h3v3h-3zM11 11h3v3h-3z"/></svg></button>
              <button class="${activeDensity === 'm' ? 'active' : ''}" data-action="_achSetDensity" data-ach-density="m" title="Vignettes confort" aria-label="Vignettes confort"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z"/></svg></button>
              <button class="${activeDensity === 'l' ? 'active' : ''}" data-action="_achSetDensity" data-ach-density="l" title="Grandes vignettes" aria-label="Grandes vignettes"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/></svg></button>
            </div>
            <button class="ach-order-btn${activeOrder === 'desc' ? ' active' : ''}" data-action="_achSetGalleryOrder" data-ach-order="${activeOrder === 'desc' ? 'asc' : 'desc'}" aria-pressed="${activeOrder === 'desc'}" title="Inverser l'ordre">${activeOrder === 'desc' ? '↓ Plus récents d’abord' : '↑ Plus anciens d’abord'}</button>
          </div>
          <div class="ach-view-options ach-chronicle-options" aria-label="Options de la chronologie">
            <div class="ach-option-group" role="group" aria-label="Affichage">
              <span>Affichage</span>
              <button type="button" data-action="_achSetChronicleMode" data-ach-chronicle-mode="recit">Récit</button>
              <button type="button" data-action="_achSetChronicleMode" data-ach-chronicle-mode="sommaire">Sommaire</button>
            </div>
            <button type="button" class="ach-order-btn" data-action="_achToggleTimelineDir" title="Inverser l’ordre du récit">↑ Plus anciens d’abord</button>
          </div>
        </div>
      </div>
    </section>
    <div class="ach-mini" aria-hidden="true">
      <div class="ach-mini-in">
        <strong class="ach-mini-title">Hauts-Faits</strong>
        <button type="button" class="ach-mini-crumb" data-action="_achMiniCrumb" title="Revenir au début de cette section">
          <span class="ach-mini-art">✦</span>
          <span class="ach-mini-copy"><small class="ach-mini-kicker">Fresque</small><b class="ach-mini-label">Fresque de campagne</b></span>
          <span class="ach-mini-pos"></span>
        </button>
        <div class="ach-mini-filters" id="ach-mini-filters"></div>
        <label class="ach-mini-search" aria-label="Rechercher dans les hauts-faits">
          <svg aria-hidden="true"><use href="./assets/img/icons.svg#icon-search"/></svg>
          <input type="search" id="ach-mini-search-input" value="${_esc(achState.search || '')}" placeholder="Rechercher…" data-input="_achSetSearch">
          <kbd>/</kbd>
        </label>
        ${STATE.isAdmin ? '<button type="button" class="ach-mini-new" data-action="openAchievementModal"><span>+</span> Nouveau</button>' : ''}
        <button type="button" class="ach-mini-top" data-action="_achScrollTop" title="Revenir en haut" aria-label="Revenir en haut">↑</button>
      </div>
      <div class="ach-chronicle-compact"></div>
    </div>
    <div class="hall-content">
      <div id="ach-content">${appSplashHtml('')}</div>
    </div>
    <div id="ach-chronicle-drop" hidden></div>
    ${STATE.isAdmin ? '<button type="button" class="ach-mobile-fab" data-action="openAchievementModal" aria-label="Créer un haut-fait"><span>+</span></button>' : ''}
    </div>`;
  },

  // ─── COLLECTION ─────────────────────────────────────────────────────────────
  async collection() {
    const { renderCollectionPage } = await import('./collection.js');
    await renderCollectionPage();
  },

  // ─── ADMIN ──────────────────────────────────────────────────────────────────
  async admin() {
    if (!STATE.isAdmin) { const { navigate } = await import('../core/navigation.js'); navigate('dashboard'); return; }
    const [users, quests, vttTokens] = await Promise.all([
      loadAllUsers(STATE.adventure),
      Promise.resolve(getCachedCollection('quests') || loadCollection('quests')).catch(() => []),
      // Quota : le diagnostic ne concerne que les tokens liés à un perso/PNJ
      // (invocations comprises, typées 'npc') — pas les ennemis de toutes les
      // scènes. La réparation manuelle, elle, relit toute la collection.
      loadCollectionWhere('vttTokens', 'type', 'in', ['player', 'npc']).catch(() => []),
    ]);
    const content = document.getElementById('main-content');

    const adv = STATE.adventure || {};
    const memberUids = new Set([...(adv.accessList || []), ...(adv.players || []), ...(adv.admins || [])]);
    const profiles = adv.memberProfiles || {};
    const accountRelinks = adv.accountRelinks || {};
    const absorbedUids = new Set(Object.keys(adv.accountRelinks || {}));
    const charById = new Map((STATE.characters || []).map(c => [c.id, c]));
    const userEmailByUid = new Map();
    users.forEach(u => {
      const uid = u?.id || u?.uid || '';
      const email = String(u?.email || '').trim().toLowerCase();
      if (uid && email) userEmailByUid.set(uid, email);
    });
    const charCountByUid = new Map();
    const labelByUid = new Map();
    (STATE.characters || []).forEach(c => {
      if (!c?.uid) return;
      charCountByUid.set(c.uid, (charCountByUid.get(c.uid) || 0) + 1);
      if (c.ownerPseudo && !labelByUid.has(c.uid)) labelByUid.set(c.uid, c.ownerPseudo);
    });
    Object.entries(profiles).forEach(([uid, p]) => {
      const pseudo = typeof p === 'string' ? p : (p?.pseudo || p?.email || '');
      if (pseudo && !labelByUid.has(uid)) labelByUid.set(uid, pseudo);
    });

    const emailOfUid = (uid) => {
      const p = profiles[uid];
      return userEmailByUid.get(uid) || String(typeof p === 'string' ? '' : (p?.email || '')).trim().toLowerCase();
    };
    const pseudoOfUid = (uid) => _norm(labelByUid.get(uid) || '');
    const relinkSourceFor = (u) => {
      const newUid = u.id || u.uid || '';
      if (!newUid) return null;
      if (absorbedUids.has(newUid)) return null;
      const newCharCount = charCountByUid.get(newUid) || 0;
      if (memberUids.has(newUid) && newCharCount > 0) return null;
      if (!memberUids.has(newUid) && newCharCount === 0) {
        const curCreated = Date.parse(u.createdAt || '') || 0;
        const hasWorkingLinkedAccount = users.some(other => {
          const otherUid = other?.id || other?.uid || '';
          if (!otherUid || otherUid === newUid) return false;
          const otherCreated = Date.parse(other.createdAt || '') || 0;
          return memberUids.has(otherUid)
            && (charCountByUid.get(otherUid) || 0) > 0
            && String(other.email || '').trim().toLowerCase() === String(u.email || '').trim().toLowerCase()
            && otherCreated > curCreated;
        });
        if (hasWorkingLinkedAccount) return null;
      }

      const userEmail = String(u.email || '').trim().toLowerCase();
      const userPseudo = _norm(u.pseudo || '');
      const candidates = [...new Set([...memberUids, ...charCountByUid.keys(), ...userEmailByUid.keys()])]
        .filter(uid => uid && uid !== newUid && !absorbedUids.has(uid) && (charCountByUid.get(uid) || 0) > newCharCount);
      const byEmail = userEmail ? candidates.find(uid => emailOfUid(uid) === userEmail) : null;
      if (byEmail) return byEmail;
      const byPseudo = userPseudo ? candidates.find(uid => pseudoOfUid(uid) === userPseudo) : null;
      return byPseudo || null;
    };
    const userByUid = new Map(users.map(u => [u.id || u.uid || '', u]));
    const userLabel = (uid) => {
      const p = profiles[uid];
      const u = userByUid.get(uid);
      const denorm = typeof p === 'string' ? p : (p?.pseudo || p?.email || '');
      return denorm || u?.pseudo || u?.email || (uid ? `UID ${uid.slice(0, 6)}...` : 'Compte inconnu');
    };
    const spellValidationState = (s) => s?.mjValidation
      || (typeof s?.mjValidated === 'boolean' ? (s.mjValidated ? 'ok' : 'pending') : 'ok');

    const visibleUsers = users.filter(u => {
      const uid = u.id || u.uid || '';
      return uid && !absorbedUids.has(uid) && (memberUids.has(uid) || relinkSourceFor(u));
    });
    const sortedUsers = [...visibleUsers].sort((a, b) => (a.pseudo || '').localeCompare(b.pseudo || '', 'fr'));
    const relinkItems = visibleUsers
      .map(u => ({ user: u, uid: u.id || u.uid || '', oldUid: relinkSourceFor(u) }))
      .filter(x => x.uid && x.oldUid);
    const invalidOwnerChars = (STATE.characters || [])
      .filter(c => !c.uid || absorbedUids.has(c.uid) || !memberUids.has(c.uid));
    const playerUids = [...new Set([...(adv.players || []), ...(adv.accessList || [])])]
      .filter(uid => uid && !(adv.admins || []).includes(uid) && !absorbedUids.has(uid));
    const playersWithoutChar = playerUids
      .filter(uid => (charCountByUid.get(uid) || 0) === 0)
      .filter(uid => !relinkItems.some(x => x.uid === uid || x.oldUid === uid));
    const pendingSpells = [];
    (STATE.characters || []).forEach(c => {
      (c.deck_sorts || []).forEach((s, idx) => {
        if (spellValidationState(s) === 'pending') pendingSpells.push({ c, s, idx });
      });
    });
    const duplicateEmailGroups = [];
    const emailGroups = new Map();
    const adventureScopedUids = new Set([
      ...memberUids,
      ...Object.keys(profiles).filter(uid => memberUids.has(uid)),
      ...(STATE.characters || []).map(c => c?.uid).filter(Boolean),
    ]);
    [...adventureScopedUids]
      .filter(uid => uid && !absorbedUids.has(uid))
      .forEach(uid => {
        const email = emailOfUid(uid);
        if (!email) return;
        if (!emailGroups.has(email)) emailGroups.set(email, []);
        emailGroups.get(email).push(uid);
      });
    emailGroups.forEach((uids, email) => {
      const uniq = [...new Set(uids)];
      if (uniq.length > 1) duplicateEmailGroups.push({ email, uids: uniq });
    });
    const questParticipantIssues = [];
    (quests || []).forEach(q => {
      const parts = Array.isArray(q?.participants) ? q.participants : [];
      const deduped = dedupeQuestParticipants(parts);
      if (deduped.length < parts.length) {
        questParticipantIssues.push({
          q,
          title: 'Participants dupliqués',
          text: `${q.titre || 'Groupe'} · ${parts.length - deduped.length} doublon${parts.length - deduped.length > 1 ? 's' : ''}`,
        });
      }
      parts.forEach(p => {
        const uid = p?.uid || '';
        const char = p?.charId ? charById.get(p.charId) : null;
        if (!uid) {
          questParticipantIssues.push({ q, title: 'Participant sans compte', text: `${q.titre || 'Groupe'} · ${p?.nom || 'Inconnu'}` });
        } else if (absorbedUids.has(uid)) {
          questParticipantIssues.push({ q, title: 'Participant sur ancien compte', text: `${q.titre || 'Groupe'} · ${p?.nom || userLabel(uid)}` });
        } else if (!memberUids.has(uid)) {
          questParticipantIssues.push({ q, title: 'Participant hors aventure', text: `${q.titre || 'Groupe'} · ${p?.nom || userLabel(uid)}` });
        }
        if (p?.charId && !char) {
          questParticipantIssues.push({ q, title: 'Personnage de quête introuvable', text: `${q.titre || 'Groupe'} · ${p?.nom || p.charId}` });
        } else if (char?.uid && uid && accountRelinks[uid] !== char.uid && char.uid !== uid) {
          questParticipantIssues.push({ q, title: 'Compte/personnage incohérents', text: `${q.titre || 'Groupe'} · ${p?.nom || char.nom || userLabel(uid)}` });
        }
      });
    });
    const tokenIssues = [];
    const reserveTokenKeys = new Map();
    (vttTokens || []).forEach(t => {
      if (!t) return;
      const tokenName = t.name || t.nom || 'Token';
      if (t.characterId) {
        const c = charById.get(t.characterId);
        const owner = t.ownerId || '';
        if (!c) {
          tokenIssues.push({ t, title: 'Token sans personnage', text: `${tokenName} · personnage introuvable`, repairable: false });
        } else if ((owner || null) !== (c.uid || null)) {
          tokenIssues.push({ t, title: 'Token propriétaire désynchronisé', text: `${tokenName} · attendu ${userLabel(c.uid)}`, repairable: true });
        } else if (owner && (absorbedUids.has(owner) || !memberUids.has(owner))) {
          tokenIssues.push({ t, title: 'Token avec propriétaire invalide', text: `${tokenName} · ${userLabel(owner)}`, repairable: false, charId: c.id });
        }
      }
      (Array.isArray(t.controlDelegates) ? t.controlDelegates : []).forEach(uid => {
        if (!uid || absorbedUids.has(uid) || !memberUids.has(uid)) {
          tokenIssues.push({ t, title: 'Délégation VTT invalide', text: `${tokenName} · ${userLabel(uid)}`, repairable: true });
        }
      });
      const reserveKey = t.characterId ? `c:${t.characterId}` : t.npcId ? `n:${t.npcId}` : '';
      if (reserveKey && !t.pageId) {
        reserveTokenKeys.set(reserveKey, (reserveTokenKeys.get(reserveKey) || 0) + 1);
      }
    });
    reserveTokenKeys.forEach((count, key) => {
      if (count > 1) {
        const id = key.slice(2);
        const c = key.startsWith('c:') ? charById.get(id) : null;
        tokenIssues.push({
          title: 'Tokens en réserve dupliqués',
          text: `${c?.nom || id} · ${count} tokens hors map`,
          repairable: true,
        });
      }
    });
    // ── File unifiée « À traiter » (une entrée par source, zéro doublon) ──
    const items = [];
    relinkItems.forEach(({ user, uid, oldUid }) => items.push({
      id: `relink:${uid}`, sec: 'comptes', tone: 'warn', title: 'Compte à relier',
      detail: `${user.pseudo || user.email || uid} · ancien compte à réassocier`,
      act: 'Relier',
      attrs: `data-action="_adminRelinkPlayer" data-old-uid="${_esc(oldUid)}" data-new-uid="${_esc(uid)}" data-name="${_esc(user.pseudo || user.email || uid)}"`,
    }));
    duplicateEmailGroups.forEach(g => items.push({
      id: `dup:${g.email}`, sec: 'comptes', tone: 'warn', title: 'Comptes en double',
      detail: `${g.email} · ${g.uids.length} comptes actifs`,
      act: 'Fusionner',
      attrs: `data-action="_adminMergeDuplicate" data-uids="${_esc(g.uids.join(','))}" data-email="${_esc(g.email)}"`,
    }));
    playersWithoutChar.forEach(uid => items.push({
      id: `nochar:${uid}`, sec: 'comptes', tone: 'info', title: 'Joueur sans personnage',
      detail: `${userLabel(uid)} · aucun personnage créé`,
      act: 'Créer', attrs: 'data-navigate="characters"',
    }));
    invalidOwnerChars.forEach(c => items.push({
      id: `char:${c.id}`, sec: 'persos', tone: 'danger',
      title: `${c.nom || 'Personnage'} n’a pas de propriétaire actif`,
      detail: `Rattaché à ${c.ownerPseudo || userLabel(c.uid)} · invisible pour son joueur`,
      act: 'Ouvrir la fiche', attrs: `data-action="_goToChar" data-id="${_esc(c.id)}"`,
    }));
    pendingSpells.forEach(({ c, s, idx }) => {
      const pm = Number.isFinite(parseInt(s.pmOverride)) ? parseInt(s.pmOverride) : (parseInt(s.pm) || 0);
      const owner = c.ownerPseudo || userLabel(c.uid);
      items.push({
        id: `spell:${c.id}:${idx}`, sec: 'sorts', tone: 'info', title: s.nom || 'Sort sans nom',
        who: `${c.nom || 'Personnage'}${owner ? ` · ${owner}` : ''}`,
        act: 'Valider',
        attrs: `data-action="_adminValidateSpell" data-id="${_esc(c.id)}" data-idx="${idx}"`,
        // File de validation : diff avant → après, composition, note au joueur.
        secondary: `data-action="_openSpellReview" data-char-id="${_esc(c.id)}" data-spell-id="${_esc(s.id || '')}" data-idx="${idx}"`,
        secondaryLabel: 'Relire',
        spell: { cout: `${pm} PM`, portee: s.portee || '—', effet: s.effet || '', runes: (Array.isArray(s.runes) ? s.runes.filter(Boolean) : []) },
      });
    });
    questParticipantIssues.forEach((i, n) => items.push({
      id: `quest:${n}`, sec: 'quetes', tone: 'warn', title: i.title, detail: i.text,
      act: 'Réparer', auto: true, attrs: 'data-action="_adminRepairQuestParticipants"',
    }));
    tokenIssues.forEach((i, n) => {
      const danger = /sans personnage/i.test(i.title || '');
      items.push({
        id: `token:${n}`, sec: 'vtt', tone: danger ? 'danger' : 'warn', title: i.title, detail: i.text,
        act: i.repairable ? 'Réparer' : (i.charId ? 'Ouvrir la fiche' : 'Ouvrir la table'),
        auto: !!i.repairable,
        attrs: i.repairable ? 'data-action="_adminRepairVttData"' : (i.charId ? `data-action="_goToChar" data-id="${_esc(i.charId)}"` : 'data-navigate="vtt"'),
      });
    });

    // ── Tableau Joueurs ──
    const charNamesByUid = new Map();
    (STATE.characters || []).forEach(c => { if (c?.uid && c.nom) { if (!charNamesByUid.has(c.uid)) charNamesByUid.set(c.uid, []); charNamesByUid.get(c.uid).push(c.nom); } });
    const relinkByUid = new Map(relinkItems.map(x => [x.uid, x]));
    const dupByEmail = new Map(duplicateEmailGroups.map(g => [g.email, g]));
    const noCharSet = new Set(playersWithoutChar);
    const vmPlayers = sortedUsers.map((u, n) => {
      const uid = u.id || u.uid || '';
      const email = String(u.email || '').trim();
      const role = (adv.admins || []).includes(uid) ? 'mj' : 'joueur';
      const memberProfileRaw = profiles[uid];
      const memberProfile = typeof memberProfileRaw === 'string' ? {} : (memberProfileRaw || {});
      const avatarRaw = u.avatarIcon || memberProfile.avatarIcon
        || (uid === STATE.user?.uid ? STATE.profile?.avatarIcon : '')
        || u.photoURL || u.photo || u.avatar || memberProfile.photoURL || memberProfile.photo || memberProfile.avatar || '';
      let issue = null, issueItem = '', issueLabel = '', issueTone = 'mut', issueAct = '', issueAttrs = '';
      if (relinkByUid.has(uid)) {
        const r = relinkByUid.get(uid);
        issue = 'relink'; issueItem = `relink:${uid}`; issueLabel = 'Compte à relier'; issueTone = 'amb'; issueAct = 'Relier';
        issueAttrs = `data-action="_adminRelinkPlayer" data-old-uid="${_esc(r.oldUid)}" data-new-uid="${_esc(uid)}" data-name="${_esc(u.pseudo || email || uid)}"`;
      } else if (email && dupByEmail.has(email.toLowerCase())) {
        const g = dupByEmail.get(email.toLowerCase());
        issue = 'dup'; issueItem = `dup:${g.email}`; issueLabel = 'Compte en double'; issueTone = 'amb'; issueAct = 'Fusionner';
        issueAttrs = `data-action="_adminMergeDuplicate" data-uids="${_esc(g.uids.join(','))}" data-email="${_esc(g.email)}"`;
      } else if (noCharSet.has(uid)) {
        issue = 'nochar'; issueItem = `nochar:${uid}`; issueLabel = 'Sans personnage'; issueTone = 'mut';
      }
      return {
        uid, pseudo: u.pseudo || '—', email, role,
        avatar: avatarRaw ? resolveAvatarUrl(avatarRaw) : '',
        since: u.createdAt || '',
        sinceLabel: u.createdAt ? new Date(u.createdAt).toLocaleDateString('fr', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
        chars: charNamesByUid.get(uid) || [],
        color: _CMJ_PALETTE[n % _CMJ_PALETTE.length],
        issue, issueItem, issueLabel, issueTone, issueAct, issueAttrs,
      };
    });

    // ── Réglages (14 modales, 5 groupes) ──
    const settingsGroups = [
      { id: 'fiche', label: 'Fiche de personnage', items: [
        { t: 'Règles de personnage', s: 'Modificateurs, PV, PM, CA, deck', ic: 'sigma', a: '#5bc0eb', fn: 'openCharacterRulesAdmin', mod: 'characters' },
        { t: 'Slots d’équipement', s: 'Emplacements visibles sur les fiches', ic: 'bag', a: '#22c38e', fn: 'openEquipmentSlotsAdmin', mod: 'characters' },
        { t: 'Types d’armure', s: 'Types boutique et bonus de set', ic: 'shield', a: '#7eb0ff', fn: 'openArmorSetsAdmin', mod: 'characters' },
      ] },
      { id: 'combat', label: 'Combat', items: [
        { t: 'Formats d’arme', s: 'Physique ou magique selon le format', ic: 'sword', a: '#ff8b6b', fn: 'openWeaponFormatsAdmin', mod: 'characters' },
        { t: 'Types de dégâts', s: 'Éléments, résistances, couleurs', ic: 'zap', a: '#f4c430', fn: 'openDamageTypesAdmin', mod: 'characters' },
        { t: 'Styles de combat', s: 'Bonus selon l’arme équipée', ic: 'swords', a: '#9d8cff', fn: 'openCombatStylesAdmin', mod: 'characters' },
      ] },
      { id: 'magie', label: 'Magie', items: [
        { t: 'Système de sorts', s: 'Forge de runes ou création classique', ic: 'star', a: '#e8b84b', fn: 'openSpellSystemAdmin', mod: 'characters' },
        { t: 'Matrices de sorts', s: 'Runes, noyaux, combinaisons', ic: 'layers', a: '#bca0ff', fn: 'openSpellMatricesAdmin', mod: 'characters' },
      ] },
      { id: 'artisanat', label: 'Artisanat', items: [
        { t: 'Recettes d’artisanat', s: 'Matériaux, quantités et paliers de fabrication', ic: 'layers', a: '#31d2a0', fn: 'openArtisanRecipesAdmin', mod: '../shared/artisan-settings' },
      ] },
      { id: 'table', label: 'Table & VTT', items: [
        { t: 'Compétences de dés', s: 'Jets proposés aux joueurs', ic: 'dice', a: '#4f8cff', fn: '_ouvrirGestionDes', mod: 'histoire' },
        { t: 'États & conditions', s: 'Effets appliqués aux tokens', ic: 'drop', a: '#f97316', fn: '_vttConditionConfig', mod: 'vtt/vtt' },
        { t: 'Émotes VTT', s: 'Réactions sur la table', ic: 'smile', a: '#22c38e', fn: '_ouvrirGestionEmotes', mod: 'vtt/vtt' },
      ] },
      { id: 'cat', label: 'Catalogues', items: [
        { t: 'Raretés d’objets', s: 'Noms, ordre et couleurs', ic: 'star', a: '#c084fc', fn: 'openRaritiesAdmin', mod: '../shared/rarity' },
        { t: 'Catégories de hauts-faits', s: 'Galerie, filtres et couleurs', ic: 'trophy', a: '#e8b84b', fn: 'openAchievementCategoriesAdmin', mod: 'achievements', requires: 'achievements' },
        { t: 'Rangs du bestiaire', s: 'Menaces, filtres et couleurs', ic: 'skull', a: '#ff5a7e', fn: 'openBestiaryRanksAdmin', mod: 'bestiary', requires: 'bestiaire' },
      ] },
    ].map(g => ({ ...g, items: g.items.filter(x => !x.requires || isFeatureEnabled(x.requires)) })).filter(g => g.items.length);

    _cmjOpen({ adventure: adv.nom || 'Aventure', items, players: vmPlayers, settings: settingsGroups });
  },

  // ─── STATISTIQUES ─────────────────────────────────────────────────────────────
  async statistiques() {
    const routeTab = getRouteSub('statistiques');
    const resolvedTab = _STATS_TAB_ALIASES[routeTab] || routeTab;
    _statsTab = _STATS_TABS.includes(resolvedTab) && (resolvedTab !== 'data' || STATE.isAdmin)
      ? resolvedTab : 'summary';
    if (routeTab !== _statsTab) setRouteSub('statistiques', _statsTab, { replace: true });
    const content = document.getElementById('main-content');
    content.innerHTML = `<div id="stats-root" class="stats-root">${loadingHtml('Chargement des statistiques…')}</div>`;
    const revision = ++_statsLoadRevision;
    const adventureId = STATE.adventure?.id || '';
    if (_statsAdventureId !== adventureId) {
      _statsAdventureId = adventureId;
      _statsVttLogs = [];
      _statsVttLogsLoaded = false;
      _statsLegacyRollups = null;
      _statsVttDetailCache = new Map();
      _statsRowsCache = new Map();
      _statsEmoteUrl = new Map();
    }

    // Les données décoratives démarrent en parallèle mais ne bloquent plus le
    // premier écran. Les collections déjà session-live sont reprises du cache.
    const cachedChars = (Array.isArray(STATE.characters) && STATE.characters.length)
      ? STATE.characters
      : getCachedCollection('characters');
    const cachedQuests = getCachedCollection('quests');
    const cachedStory = getCachedCollection('story');
    const emotePromise = getDocData('world', 'vtt_emotes').catch(() => null);
    const charsPromise = cachedChars ? Promise.resolve(cachedChars) : loadChars().catch(() => []);
    const questsPromise = cachedQuests ? Promise.resolve(cachedQuests) : loadCollection('quests').catch(() => []);
    const storyPromise = cachedStory ? Promise.resolve(cachedStory) : loadCollection('story').catch(() => []);
    const rollupPromise = getDocDataSilent('statsRollups', 'main').catch(() => null);
    // MVP désignés à la main + personnages masqués des stats par le MJ (docs légers,
    // cachés, lecture membre).
    const mvpOverridePromise = getDocData('settings', 'mvpOverrides').catch(() => null);
    const hiddenCharsPromise = getDocData('settings', 'statsHidden').catch(() => null);

    const data = await loadStats();
    if (revision !== _statsLoadRevision || !document.getElementById('stats-root')) return;
    _statsData = data || {};
    _statsMvpOverrides = _statsNormalizeMvpOverrides(await mvpOverridePromise);
    _statsHiddenChars = _statsNormalizeHiddenIds(await hiddenCharsPromise);
    _statsQuests = Array.isArray(cachedQuests) ? cachedQuests : [];
    _statsStory = Array.isArray(cachedStory) ? cachedStory : [];
    _statsVttDetailCache = new Map();
    _statsRowsCache = new Map();
    _statsLoadAwardPrefs();
    const requestedScope = _statsRequestedScope;
    _statsRequestedScope = null;
    const availableDates = new Set(_statsAllSessionKeys());
    _statsScope = requestedScope && availableDates.has(requestedScope) ? requestedScope : null;
    _statsPlayerSel = null;
    _statsGroupSel = null;
    _statsGroupMissionId = '';
    // Premier rendu dès que l'unique document de stats est disponible. Le
    // journal historique et les illustrations affinent ensuite cette vue.
    _statsRender(_statsScope);

    const vttDetailsPromise = rollupPromise.then(async rollup => {
      if (rollup?.version === STATS_ROLLUP_VERSION && rollup?.scopes) {
        // Les joueurs consomment le résumé compact déjà disponible. Seul le MJ
        // vérifie et compacte la queue du journal : sinon chaque joueur ouvrant
        // Stats après une séance relirait les mêmes entrées vttLog.
        if (!STATE.isAdmin) return { rollups: rollup.scopes, logs: [], loaded: false };
        const cutoff = Math.max(0, Number(rollup.sourceThroughMs) || 0);
        if (cutoff) {
          const boundaryIds = new Set(rollup.sourceBoundaryIds || []);
          const tail = await loadCollectionAfter('vttLog', {
            field: 'createdAt',
            value: new Date(cutoff),
          });
          const fresh = tail.filter(log => {
            const time = _statsLogTime(log);
            return time > cutoff || (time === cutoff && !boundaryIds.has(log.id));
          });
          if (!fresh.length) return { rollups: rollup.scopes, logs: [], loaded: false };
          try {
            const scopes = await _statsPersistLegacyRollups(fresh, {
              baseScopes: rollup.scopes,
              sourceThroughMs: cutoff,
              sourceBoundaryIds: [...boundaryIds],
              sourceLogCount: rollup.sourceLogCount,
              applyCorrections: false,
            });
            return { rollups: scopes, logs: [], loaded: false };
          } catch (error) {
            console.warn('[stats] nouveaux journaux non compactés', error);
            return { rollups: rollup.scopes, logs: [], loaded: false };
          }
        }
        if (!_statsNeedsVttBackfill(_statsData)) {
          return { rollups: rollup.scopes, logs: [], loaded: false };
        }
      }
      if (!_statsNeedsVttBackfill(_statsData)) return { rollups: null, logs: [], loaded: false };
      // La toute première migration peut représenter des dizaines de milliers
      // de lectures. Elle est réservée au MJ ; les joueurs continuent d'utiliser
      // les statistiques incrémentales sans déclencher ce coût historique.
      if (!STATE.isAdmin) return { rollups: null, logs: [], loaded: false };

      // Migration historique potentiellement très lourde (plusieurs dizaines de
      // milliers de logs). Un verrou Firestore garantit qu'un seul navigateur la
      // lance : les autres utilisent le résumé dès qu'il existe au lieu de payer
      // exactement la même lecture intégrale en parallèle.
      let lease;
      try {
        lease = await _statsClaimRollupLease();
      } catch {
        return { rollups: null, logs: [], loaded: false };
      }
      if (lease.status === 'ready') {
        return { rollups: lease.data.scopes, logs: [], loaded: false };
      }
      if (lease.status === 'busy') {
        return { rollups: lease.data?.scopes || null, logs: [], loaded: false };
      }

      const logs = await loadCollection('vttLog').catch(() => null);
      if (!Array.isArray(logs)) {
        await clearDocumentLease('statsRollups', 'main', {
          owner: lease.owner,
          prefix: 'historyBuild',
        });
        return { rollups: null, logs: [], loaded: false };
      }

      // Une seule lecture historique : elle produit un résumé compact par séance,
      // réutilisé ensuite par tous les écrans et tous les appareils.
      try {
        const scopes = await _statsPersistLegacyRollups(logs);
        return { rollups: scopes, logs: [], loaded: false };
      } catch (error) {
        console.warn('[stats] rollup historique non enregistré, repli sur le journal courant', error);
        await clearDocumentLease('statsRollups', 'main', {
          owner: lease.owner,
          prefix: 'historyBuild',
        });
        return { rollups: null, logs, loaded: true };
      }
    });
    // Ne pas attendre ces compléments ici : `navigate()` maintient toute la
    // page en `pointer-events:none` tant que cette fonction n'est pas terminée.
    // Le premier rendu est complet et interactif ; l'enrichissement remplace
    // seulement les données secondaires lorsqu'elles arrivent.
    void Promise.all([
      emotePromise,
      charsPromise,
      questsPromise,
      storyPromise,
      vttDetailsPromise,
    ]).then(([emoteDoc, chars, quests, story, vttLogResult]) => {
      if (revision !== _statsLoadRevision || !document.getElementById('stats-root')) return;
      if (Array.isArray(chars) && chars.length) STATE.characters = chars;
      _statsQuests = Array.isArray(quests) ? quests : [];
      _statsStory = Array.isArray(story) ? story : [];
      _statsVttLogs = Array.isArray(vttLogResult?.logs) ? vttLogResult.logs : [];
      _statsVttLogsLoaded = vttLogResult?.loaded === true;
      _statsLegacyRollups = vttLogResult?.rollups || null;
      _statsVttDetailCache = new Map();
      _statsRowsCache = new Map();
      const emoteLookup = createEmoteLookup(normalizeEmoteCatalog(emoteDoc?.emotes));
      _statsEmoteUrl = new Map();
      emoteLookup.forEach((emote, key) => {
        _statsEmoteUrl.set(key, emote.url);
        const signature = _statsEmoteSignature(key);
        if (signature && !_statsEmoteUrl.has(`~${signature}`)) _statsEmoteUrl.set(`~${signature}`, emote.url);
      });
      _statsRefreshEnrichedView(_statsScope);
    }).catch(err => {
      console.warn('[stats] enrichissement secondaire indisponible', err);
    });
  },

};

async function goToChar(id, tab = null) {
  setTargetCharacter(id, tab);
  const { navigate } = await import('../core/navigation.js');
  navigate('characters');
}

async function _dashQuickChar(id) {
  if (!id) return;
  const { quickViewChar } = await import('./characters/quick-view.js');
  quickViewChar(id, { list: _dashUi?.characterIds?.() || [] });
}

function _uidAliasesForCurrentUser() {
  return [
    STATE.user?.uid,
    ...(Array.isArray(STATE.profile?.previousUids) ? STATE.profile.previousUids : []),
    ...(Array.isArray(STATE.profile?.uidAliases) ? STATE.profile.uidAliases : []),
  ].filter(Boolean);
}

async function _dashSaveQuestParticipants(questId, participants, { leaving = false } = {}) {
  try {
    await saveDoc('quests', questId, { participants });
    showNotif(leaving ? 'Tu as quitté ce groupe.' : 'Tu as rejoint ce groupe !', leaving ? 'info' : 'success');
    return true;
  } catch (e) {
    console.error('[dashboard] quest participants save failed', e);
    showNotif(e?.code === 'permission-denied' ? 'Action non autorisée sur ce groupe.' : 'Erreur de sauvegarde du groupe.', 'error');
    return false;
  }
}

async function _dashToggleQuest(btn) {
  const questId = btn?.dataset?.id;
  if (!questId || !_dashUi?.toggleQuest) return;
  if (btn) btn.disabled = true;
  try { await _dashUi.toggleQuest(questId); }
  finally { if (btn?.isConnected) btn.disabled = false; }
}

async function _dashPickQuestChar(btn) {
  const questId = btn?.dataset?.id;
  const charId = btn?.dataset?.char;
  if (!questId || !charId || !_dashUi?.pickQuestChar) return;
  if (btn) btn.disabled = true;
  try { await _dashUi.pickQuestChar(questId, charId); }
  finally { if (btn?.isConnected) btn.disabled = false; }
}

registerActions({
  // Dashboard
  _goToChar:             (btn) => goToChar(btn.dataset.id, btn.dataset.tab),
  _adminValidateSpell:   (btn) => _adminValidateSpell(btn.dataset.id, btn.dataset.idx),
  _dashQuickChar:        (btn) => _dashQuickChar(btn.dataset.id),
  _dashToggleQuest:      (btn) => _dashToggleQuest(btn),
  _dashPickQuestChar:    (btn) => _dashPickQuestChar(btn),
  _dashMarkWallRead:     ()    => _dashUi?.markWallRead?.(),
  _dashRosterFilter:     (btn) => _dashUi?.setRosterFilter?.(btn.dataset.filter),
  _dashRosterView:       (btn) => _dashUi?.setRosterView?.(btn.dataset.view),
  _dashRosterSearch:     (input) => _dashUi?.searchRoster?.(input),
  _dashRosterSort:       (btn) => _dashUi?.sortRoster?.(btn.dataset.sort),
  _dashRosterClear:      () => _dashUi?.clearRoster?.(),
  _dashRosterFreeToggle: () => _dashUi?.toggleFreeRoster?.(),
  openAdventureSwitcher: ()    => openAdventureSwitcher(),
  _adminRepairQuestParticipants: () => _adminRepairQuestParticipants(),
  _adminRepairVttData:           () => _adminRepairVttData(),

  // Statistiques : modale de gestion des données (MJ) — supprimer ciblé ou tout.
  _statsManage: () => _statsOpenManageModal(),
  // Supprime les stats d'une séance (date) — ajuste les totaux campagne.
  _statsDelDate: async (btn) => {
    if (!STATE.isAdmin) return;
    const d = btn.dataset.scope; if (!d) return;
    const ok = await confirmModal(`Supprimer toutes les stats de la séance du <b>${_statsSessionLabel(d)}</b> ?<br>Les totaux de campagne seront ajustés en conséquence.`, {
      title: '🗑 Supprimer une séance', confirmLabel: 'Supprimer', cancelLabel: 'Annuler', danger: true,
    }).catch(() => false);
    if (!ok) return;
    _statsManageMarkBusy('_statsDelDate', d, true);
    const done = await deleteDateStats(d);
    if (!done) {
      _statsManageMarkBusy('_statsDelDate', d, false);
      showNotif('La séance n’a pas pu être supprimée. La fenêtre reste ouverte pour éviter toute ambiguïté.', 'error');
      return;
    }
    showNotif('Séance supprimée.', 'success');
    if (_statsScope === d) _statsScope = null;
    _statsGroupSel = null;
    await _statsAfterManageDelete();
  },
  // Supprime les stats liées à une mission (toutes ses séances).
  _statsDelMission: async (btn) => {
    if (!STATE.isAdmin) return;
    const mid = btn.dataset.scope, name = btn.dataset.name || 'cette mission';
    const ok = await confirmModal(`Supprimer toutes les stats liées à <b>${_esc(name)}</b> (toutes ses séances) ?<br>Les totaux de campagne seront ajustés.`, {
      title: '🗑 Supprimer une mission', confirmLabel: 'Supprimer', cancelLabel: 'Annuler', danger: true,
    }).catch(() => false);
    if (!ok) return;
    _statsManageMarkBusy('_statsDelMission', mid, true);
    const done = await deleteMissionStats(mid);
    showNotif(done ? 'Stats de la mission supprimées.' : 'Échec de la suppression.', done ? 'success' : 'error');
    if (!done) { _statsManageMarkBusy('_statsDelMission', mid, false); return; }
    _statsScope = null; _statsGroupSel = null; _statsGroupMissionId = '';
    await _statsAfterManageDelete();
  },
  // Suppression TOTALE — confirmation explicite par saisie (« EFFACER »).
  _statsResetAsk: async () => {
    if (!STATE.isAdmin) return;
    const dates = _statsAllSessionKeys();
    const missions = _statsMissionList();
    const trackedChars = Object.keys(_statsData?.chars || {}).length;
    const adventureName = _esc(STATE.adventure?.nom || 'Aventure courante');
    const val = await promptModal(`
      <span class="stats-reset-warning">Cette action ignore les filtres actuellement affichés.</span>
      Elle effacera définitivement les compteurs de jets, combats, dégâts, soins, sorts, PM, émotes et les liens séance–mission de <strong>${adventureName}</strong>.
      <span class="stats-reset-scope">Périmètre : ${trackedChars} personnage${trackedChars > 1 ? 's' : ''} · ${dates.length} séance${dates.length > 1 ? 's' : ''} · ${missions.length} mission${missions.length > 1 ? 's' : ''}</span>
      <span class="stats-reset-kept">Les personnages, missions, groupes, inventaires et scènes VTT ne seront pas supprimés.</span>
      Tape <strong>EFFACER</strong> pour confirmer.`, {
      title: '🗑 Effacer toutes les statistiques', placeholder: 'EFFACER', confirmLabel: 'Effacer définitivement', required: true, danger: true,
    }).catch(() => null);
    if (val === null) return;
    if ((val || '').trim().toUpperCase() !== 'EFFACER') { showNotif('Tape exactement « EFFACER » — aucune donnée n’a été supprimée.', 'info'); return; }
    const done = await resetStats();
    showNotif(done ? `Toutes les statistiques de ${STATE.adventure?.nom || 'l’aventure'} ont été effacées.` : 'Échec de la suppression des statistiques.', done ? 'success' : 'error');
    closeModalDirect();
    if (done) { _statsScope = null; _statsPlayerSel = null; _statsGroupSel = null; _statsGroupMissionId = ''; await _statsReloadAfterMutation(); }
  },
  _statsDelChar: async (btn) => {
    if (!STATE.isAdmin) return;
    const id = btn.dataset.id; if (!id) return;
    const date = btn.dataset.date || '';
    const name = btn.dataset.name || btn.closest('.stats-char')?.querySelector('.stats-char-name')?.textContent || _statsCharacterName(id, _statsData?.chars?.[id]?.name || 'ce personnage');
    const singleSession = !!date;
    const message = singleSession
      ? `<span class="stats-delete-scope">Une seule séance</span>Supprimer uniquement les statistiques de <b>${_esc(name)}</b> pour le <b>${_statsSessionLabel(date)}</b> ?<br><small>Ses autres séances sont conservées. La séance, son lien mission/groupe et les données des autres personnages ne changent pas.</small>`
      : `<span class="stats-delete-scope stats-delete-scope--all">Toute la campagne</span>Supprimer toutes les statistiques de <b>${_esc(name)}</b>, pour toutes ses séances ?<br><small>Cette action ignore les filtres affichés. Les autres personnages ne changent pas.</small>`;
    const ok = await confirmModal(message, {
      title: singleSession ? '🗑 Supprimer cette séance du personnage' : '🗑 Supprimer toutes les stats du personnage',
      confirmLabel: singleSession ? 'Supprimer cette séance' : 'Tout supprimer', cancelLabel: 'Annuler', danger: true,
    }).catch(() => false);
    if (!ok) return;
    const done = singleSession ? await deleteCharDateStats(id, date) : await deleteCharStats(id);
    showNotif(done
      ? (singleSession ? `Séance du ${_statsSessionLabel(date)} supprimée pour ${name}.` : `Toutes les statistiques de ${name} ont été supprimées.`)
      : 'Échec de la suppression.', done ? 'success' : 'error');
    if (!done) return;
    if (btn.dataset.origin === 'dates-modal') closeModalDirect();
    // La séance existe toujours (on n'a retiré que ce personnage) → le scope reste valide.
    await _statsReloadAfterMutation();
  },
  // Stats d'un personnage séance par séance (date) — lit le doc déjà chargé.
  _statsCharDates: (btn) => {
    const id = btn.dataset.id; if (!id) return;
    const c = _statsData?.chars?.[id]; if (!c) return;
    const name = _statsCharacterName(id, c.name);
    const dates = [...new Set([...Object.keys(c.byDate || {}), ...Object.keys(c.bySession || {})])]
      .sort((a, b) => _statsDateOf(b).localeCompare(_statsDateOf(a)) || Number(_statsSessionEntry(b).startedAt || 0) - Number(_statsSessionEntry(a).startedAt || 0));
    const metric = (icon, value, label, color = '') => `<span class="stats-date-kpi">
      <span>${icon}</span><span><b${color ? ` style="color:${color}"` : ''}>${value}</b><small>${label}</small></span>
    </span>`;
    const fact = (label, value, color = '') => `<span class="stats-char-fact">
      <small>${label}</small><b${color ? ` style="color:${color}"` : ''}>${value}</b>
    </span>`;
    const body = dates.length ? dates.map((d) => {
      const e = _statsSessionBucket(c, d) || {};
      const mergedRow = _statsRowsFor([d]).find(row => row.id === id);
      const cm = mergedRow?.combat || _statsNormCombat(e.combat);
      const cmAverage = combatAverages(cm);
      const hitRate = cm.attacks ? Math.round(cm.hits / cm.attacks * 100) : 0;
      const skills = (mergedRow?.perSkill || Object.entries(e.skills || {}).map(([sk, v]) => normalizeSkillStats(sk, v)))
        .filter(s => s.rolls > 0).sort((a, b) => b.rolls - a.rolls);
      const skillTotal = skills.reduce((sum, s) => sum + s.rolls, 0);
      const skillAverage = aggregateSkillAverages([{ perSkill: skills }]);
      const skillHtml = skills.length ? `<div class="stats-skills">${skills.slice(0, 6).map(s => `
        <div class="stats-skill-row">
          <span class="stats-skill-name">${_esc(s.sk)}</span>
          <span class="stats-skill-bar"><span style="width:${skillTotal ? Math.round(s.rolls / skillTotal * 100) : 0}%"></span></span>
          <span class="stats-skill-n">${s.resultAvg != null ? `<b>${s.resultAvg.toLocaleString('fr-FR')} moy.</b> · ` : ''}${s.rolls}${s.crits ? ` · 💥${s.crits}` : ''}${s.fumbles ? ` · 💔${s.fumbles}` : ''}</span>
        </div>`).join('')}</div>` : '<div class="stats-date-empty">Aucun jet de compétence.</div>';
      const favorites = _statsFavoritesHtml(e.spells, e.emotes);
      const context = [_statsMissionOf(d), _statsGroupOf(d)].filter(Boolean).join(' · ') || 'Séance non reliée';
      return `<details class="stats-date">
        <summary class="stats-date-summary">
          <span class="stats-date-id"><b>📅 ${_statsSessionLabel(d)}</b><small>${_esc(context)}</small></span>
          <span class="stats-date-kpis">
            ${metric('🗡️', cm.dmgDealt, 'Dégâts', '#c9b6ff')}
            ${metric('💚', cm.heal, 'Soin', '#4fd3a6')}
            ${metric('🔮', cm.spellsCast, 'Sorts', '#bca0ff')}
            ${metric('🎲', skillTotal, 'Jets', '#7fb0ff')}
          </span>
          <span class="stats-date-rate"><b>${cm.attacks ? `${hitRate}%` : '—'}</b><small>réussite</small></span>
          <span class="stats-date-chevron">⌄</span>
        </summary>
        <div class="stats-date-body">
          ${STATE.isAdmin ? `<div class="stats-date-admin">
            <button type="button" data-action="_statsCorrectDateCombat" data-id="${_esc(id)}" data-date="${_esc(d)}">✎ Corriger les compteurs</button>
            <button type="button" class="stats-date-delete" data-action="_statsDelChar" data-id="${_esc(id)}" data-date="${_esc(d)}" data-name="${_esc(name)}" data-origin="dates-modal" title="Supprimer uniquement cette séance pour ce personnage">🗑 Supprimer cette séance</button>
          </div>` : ''}
          <div class="stats-date-detail-grid">
            <section class="stats-char-detail">
              <h4>⚔️ Combat</h4>
              <div class="stats-char-facts">
                ${fact('Attaques', cm.attacks)}
                ${fact('Réussies', cm.hits, '#22c38e')}
                ${fact(cmAverage.damageAverageEstimated ? 'Dégâts / touche (hist.)' : 'Dégâts moyens', cmAverage.damageAverage == null ? '—' : cmAverage.damageAverage.toLocaleString('fr-FR'), '#c9b6ff')}
                ${fact(cmAverage.damageTakenAverageEstimated ? 'Subis / touche (hist.)' : 'Dégâts moyens subis', cmAverage.damageTakenAverage == null ? '—' : cmAverage.damageTakenAverage.toLocaleString('fr-FR'), '#a7b4c4')}
                ${fact('D20 attaque moyen', cmAverage.attackNaturalAverage == null ? '—' : cmAverage.attackNaturalAverage.toLocaleString('fr-FR'), '#7fb0ff')}
                ${fact('Critiques', cm.crits)}
                ${fact('Échecs critiques', cm.fumbles)}
                ${fact('Plus gros coup', cm.biggestHit)}
                ${fact('Dégâts subis', cm.dmgTaken)}
                ${fact('Surplus reçu ignoré', cm.damageTakenCorrection)}
                ${fact('Surplus infligé ignoré', cm.damageDealtCorrection)}
                ${fact('KO infligés', cm.kosDealt)}
                ${fact('Fois mis KO', cm.kosTaken)}
              </div>
            </section>
            <section class="stats-char-detail">
              <h4>🔮 Magie & soutien</h4>
              <div class="stats-char-facts">
                ${fact('PM dépensés', cm.pmSpent)}
                ${fact('Sorts tactiques', cm.tacticalSpells)}
                ${fact('Soutiens', cm.supportSpells)}
                ${fact('Afflictions', cm.afflictionSpells)}
                ${fact('Contrôles', cm.controlSpells)}
                ${fact('Soin produit', cm.heal, '#4fd3a6')}
              ${fact('PM régénérés', cm.manaHealed, '#8b5cf6')}
                ${fact('Sorts lancés', cm.spellsCast, '#bca0ff')}
              </div>
            </section>
            <section class="stats-char-detail stats-char-detail--skills"><h4>🎲 Compétences · moyenne ${skillAverage.resultAvg == null ? '—' : skillAverage.resultAvg.toLocaleString('fr-FR')}</h4>${skillHtml}</section>
          </div>
          ${favorites}
        </div>
      </details>`;
    }).join('') : '<div class="stats-empty">Aucune séance enregistrée.</div>';
    openModal(`📅 ${_esc(name)}`, `<div class="stats-dates">${body}</div>`, {
      subtitle: `${dates.length} séance${dates.length > 1 ? 's' : ''} enregistrée${dates.length > 1 ? 's' : ''}`,
      accent: '#7fb0ff',
    });
  },
  _statsCorrectDateCombat: (btn) => {
    if (!STATE.isAdmin) return;
    const id = btn.dataset.id, date = btn.dataset.date;
    const c = _statsData?.chars?.[id];
    const combat = _statsSessionBucket(c, date)?.combat;
    if (!id || !date || !combat) { showNotif('Compteurs de séance introuvables.', 'error'); return; }
    const input = (field, label, hint = '') => `<label class="stats-correction-field">
      <span>${label}${hint ? `<small>${hint}</small>` : ''}</span>
      <input type="text" inputmode="numeric" pattern="[0-9]*" data-stats-field="${field}" value="${Math.max(0, Math.trunc(Number(combat[field]) || 0))}">
    </label>`;
    openModal(`🧾 Corriger ${_esc(_statsCharacterName(id, c.name))}`, `
      <div class="stats-correction">
        <div class="stats-correction-note"><b>Séance du ${_statsSessionLabel(date)}</b><span>Modifie les valeurs réellement observées. Les totaux de campagne seront ajustés automatiquement.</span></div>
        <section><h4>⚔️ Actions offensives</h4><div class="stats-correction-grid">
          ${input('attacks', 'Attaques')}${input('hits', 'Réussites')}${input('crits', 'Critiques')}${input('fumbles', 'Échecs critiques')}
          ${input('dmgDealt', 'Dégâts infligés', 'PV réellement retirés')}${input('damageEvents', 'Impacts avec dégâts')}${input('kosDealt', 'KO infligés')}
        </div></section>
        <section><h4>🛡️ Défense</h4><div class="stats-correction-grid">
          ${input('attacksTaken', 'Attaques subies')}${input('attacksAvoided', 'Attaques évitées')}
          ${input('dmgTaken', 'Dégâts subis', 'PV réellement perdus')}${input('damageTakenEvents', 'Impacts reçus')}${input('kosTaken', 'Fois mis KO')}
        </div></section>
        <section><h4>✨ Ressources</h4><div class="stats-correction-grid">
          ${input('heal', 'Soin produit')}${input('spellsCast', 'Sorts lancés')}${input('pmSpent', 'PM dépensés')}
        </div></section>
        <footer class="stats-correction-actions">
          <button type="button" class="btn btn-outline" data-action="close-modal">Annuler</button>
          <button type="button" class="btn btn-primary" data-action="_statsSaveDateCombat" data-id="${_esc(id)}" data-date="${_esc(date)}">Enregistrer les corrections</button>
        </footer>
      </div>`, {
        subtitle: 'Correction manuelle et cohérente de la séance',
        accent: '#f4c430',
      });
  },
  _statsSaveDateCombat: async (btn) => {
    if (!STATE.isAdmin) return;
    const id = btn.dataset.id, date = btn.dataset.date;
    const values = {};
    for (const input of document.querySelectorAll('#modal-body [data-stats-field]')) {
      const raw = String(input.value || '').trim();
      if (!/^\d+$/.test(raw)) {
        input.focus();
        showNotif('Chaque compteur doit être un entier positif ou nul.', 'error');
        return;
      }
      values[input.dataset.statsField] = Number(raw);
    }
    btn.disabled = true;
    const done = await correctDateCombatStats(id, date, values);
    btn.disabled = false;
    if (!done) { showNotif('Échec de la correction des statistiques.', 'error'); return; }
    showNotif('Statistiques de la séance corrigées.', 'success');
    closeModalDirect();
    closeModalDirect();
    await _statsReloadAfterMutation();
  },
  // Changement de scope (campagne entière ↔ une séance) — re-rend sans relecture.
  _statsScope: (el) => { _statsRender(el.value || null); },
  _statsMissionPickerToggle: (btn) => {
    const picker = btn.closest('.stats-mission-picker');
    const menu = picker?.querySelector('.stats-mission-menu');
    if (!picker || !menu) return;
    const nextOpen = menu.hidden;
    document.querySelectorAll('.stats-mission-picker').forEach(p => {
      if (p === picker) return;
      p.classList.remove('is-open');
      p.querySelector('.stats-mission-menu')?.setAttribute('hidden', '');
      p.querySelector('.stats-mission-current')?.setAttribute('aria-expanded', 'false');
    });
    menu.hidden = !nextOpen;
    picker.classList.toggle('is-open', nextOpen);
    btn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    if (nextOpen) {
      const input = picker.querySelector('.stats-mission-search');
      if (input) setTimeout(() => input.focus(), 0);
    }
  },
  _statsMissionPickerSearch: (el) => {
    _statsMissionPickerSearch = el.value || '';
    const q = _norm(_statsMissionPickerSearch);
    const picker = el.closest('.stats-mission-picker');
    picker?.querySelectorAll('.stats-mission-option').forEach(opt => {
      if (opt.classList.contains('stats-mission-option--all')) return;
      opt.style.display = (!q || (opt.dataset.search || '').includes(q)) ? '' : 'none';
    });
  },
  _statsMissionPickerPick: (btn) => {
    _statsMissionPickerSearch = '';
    _statsRender(btn.dataset.scope || null);
  },
  _statsJumpSection: (btn) => {
    const id = btn.dataset.target;
    if (!id) return;
    btn.closest('.stats-section-nav')?.querySelectorAll('button')
      .forEach(b => b.classList.toggle('active', b === btn));
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  _statsMvpDetailPick: (btn) => {
    _statsMvpDetailId = btn.dataset.id || '';
    _statsRender(_statsScope);
  },
  // MVP désigné à la main par le MJ (filet pour les séances que l'algo juge mal).
  _statsMvpOverridePick: () => _statsOpenMvpOverrideModal(),
  _statsMvpSetOverride: (btn) => _statsSetMvpOverride(btn.dataset.id),
  _statsMvpClearOverride: () => _statsClearMvpOverride(),
  _statsToggleHideChar: (btn) => _statsToggleHideChar(btn.dataset.id),
  _statsHideAllDead: () => _statsHideDead(),
  _statsShowAllChars: () => _statsShowAllChars(),
  // Frise de séances : clic sur une chip → change la vue (sans relecture réseau).
  _statsSetScope: (btn) => { _statsRender(btn.dataset.scope || null); },
  // Journal des séances : ouvre directement le récapitulatif de la séance.
  _statsOpenSessionSummary: (btn) => {
    const scope = btn.dataset.scope;
    if (!scope) return;
    _statsTab = 'summary';
    setRouteSub('statistiques', 'summary');
    _statsRender(scope);
    document.getElementById('stats-root')?.scrollIntoView({ block: 'start' });
  },
  // Barre de périmètre (3 selects) : Acte → Mission → Séance ; chaque niveau
  // réinitialise les niveaux inférieurs (retombe sur le parent quand on vide).
  _statsSetScopeSel: (el) => {
    const level = el.dataset.level, val = el.value;
    if (level === 'act') return _statsRender(val ? `act:${val}` : null);
    if (level === 'mission') return _statsRender(val ? `mission:${val}` : (el.dataset.act ? `act:${el.dataset.act}` : null));
    // séance
    if (val) return _statsRender(val);
    return _statsRender(el.dataset.mission ? `mission:${el.dataset.mission}` : (el.dataset.act ? `act:${el.dataset.act}` : null));
  },
  // Onglets : le contenu lourd est monté à la demande. Les données et agrégats
  // restent en mémoire, donc aucun nouvel accès réseau n'est déclenché.
  _statsSetTab: (btn) => {
    const tab = _STATS_TAB_ALIASES[btn.dataset.tab] || btn.dataset.tab;
    if (!_STATS_TABS.includes(tab) || tab === _statsTab || (tab === 'data' && !STATE.isAdmin)) return;
    _statsTab = tab;
    setRouteSub('statistiques', tab);
    _statsRender(_statsScope);
    document.getElementById('stats-root')?.scrollIntoView({ block: 'start' });
  },
  _statsSessionsMode: (btn) => {
    _statsSessionsMode = btn.dataset.mode === 'chrono' ? 'chrono' : 'mission';
    _statsSessionsPendingOnly = false;
    _statsRender(_statsScope);
  },
  _statsSessionsPending: () => {
    _statsSessionsPendingOnly = !_statsSessionsPendingOnly;
    _statsRender(_statsScope);
  },
  _statsRankMode: (btn) => {
    _statsRankMode = btn.dataset.mode === 'session' ? 'session' : 'total';
    _statsRender(_statsScope);
  },
  _statsCharacterSearch: (el) => {
    const query = _norm(el.value || '');
    document.querySelectorAll('.stats-v2-character-row').forEach(row => {
      row.hidden = !!query && !String(row.dataset.statsCharacter || '').includes(query);
    });
  },
  _statsDrawerOpen: (btn) => {
    _statsDrawerId = btn.dataset.id || '';
    _statsDrawerTab = 'profile';
    _statsRender(_statsScope);
  },
  _statsDrawerClose: () => {
    _statsDrawerId = '';
    _statsRender(_statsScope);
  },
  _statsDrawerStep: (btn) => {
    const ids = [...document.querySelectorAll('#stats-root [data-action="_statsDrawerOpen"]')].map(button => button.dataset.id).filter(Boolean);
    const current = ids.indexOf(_statsDrawerId);
    if (current < 0 || ids.length < 2) return;
    const step = Number(btn.dataset.step) < 0 ? -1 : 1;
    _statsDrawerId = ids[(current + step + ids.length) % ids.length];
    _statsRender(_statsScope);
  },
  _statsDrawerTab: (btn) => {
    const tab = btn.dataset.tab;
    if (!['profile', 'sessions', 'dice', 'compare'].includes(tab)) return;
    _statsDrawerTab = tab;
    _statsRender(_statsScope);
  },
  _statsDrawerCompare: (el) => {
    _statsCompareSelection.players = [_statsDrawerId, el.value || ''];
    _statsRender(_statsScope);
  },
  _statsDiceKind: (btn) => {
    _statsDiceKind = ['skills', 'attacks'].includes(btn.dataset.kind) ? btn.dataset.kind : 'all';
    _statsRender(_statsScope);
  },
  _statsKpiDrill: (btn) => {
    const key = btn.dataset.key || 'impact';
    _statsRankSort = { key, dir: -1 };
    _statsTab = 'characters';
    setRouteSub('statistiques', 'characters');
    _statsRender(_statsScope);
  },
  _statsMvpExplain: () => openModal('MVP d’impact', `
    <div class="stats-v2-mvp-help">
      <p>Le MVP mesure l’impact utile, pas seulement le volume d’actions.</p>
      <ol>
        <li><b>Quatre axes</b><span>Offense, soutien, protection et compétences.</span></li>
        <li><b>Un repère commun</b><span>100 % correspond à la performance de référence du périmètre.</span></li>
        <li><b>Des rendements décroissants</b><span>Dépasser le repère reste valorisé sans écraser les autres contributions.</span></li>
        <li><b>Des axes pondérés</b><span>L’axe dominant compte davantage que les axes secondaires.</span></li>
        <li><b>Une confiance minimale</b><span>Aucun MVP n’est décerné si les données sont trop faibles.</span></li>
      </ol>
    </div>`, { subtitle: 'Comprendre le score', accent: '#e8b84b' }),
  _statsLinkInline: async (btn) => {
    if (!STATE.isAdmin) return;
    const sessionKey = btn.dataset.session;
    const missionId = btn.closest('.stats-v2-linker')?.querySelector('[data-stats-link-mission]')?.value || '';
    const mission = _statsMissionList().find(item => item.id === missionId);
    const groupId = btn.dataset.group || '';
    const group = (_statsQuests || []).find(item => item.id === groupId);
    btn.disabled = true;
    const done = await setSessionMission(sessionKey, {
      missionId, mission: mission?.name || '', groupId, group: group ? _statsGroupName(group) : '',
    });
    btn.disabled = false;
    if (!done) { showNotif('Impossible de relier cette séance.', 'error'); return; }
    _statsData = peekStats() || _statsData;
    _statsRowsCache = new Map();
    showNotif('Séance reliée.', 'success');
    _statsRender(_statsScope);
  },
  _statsShare: () => {
    if (!_statsLastSummary) return;
    openModal('Partager les statistiques', `<div class="stats-v2-share"><span class="stats-v2-share-kicker">Aperçu Discord</span><pre>${_esc(_statsLastSummary)}</pre><div><button type="button" data-action="_statsExport">Copier le texte</button><button type="button" class="is-primary" data-action="_statsExportImage">Télécharger le visuel</button></div></div>`, { subtitle: 'Un seul récapitulatif, deux formats', accent: '#4f8cff' });
  },
  // Rythme : bascule barres d'évolution ↔ camembert de répartition.
  _statsRythmeView: (btn) => { _statsRythmeView = btn.dataset.view === 'pie' ? 'pie' : 'timeline'; _statsRender(_statsScope); },
  // Tri du tableau de classement : re-clic sur la même colonne inverse le sens.
  _statsSortRank: (btn) => {
    const key = btn.dataset.key;
    if (!key) return;
    _statsRankSort = { key, dir: _statsRankSort.key === key ? -_statsRankSort.dir : -1 };
    _statsRender(_statsScope);
  },
  _statsSortRolls: (btn) => {
    const table = btn.dataset.table;
    const key = btn.dataset.key;
    if (!table || !key) return;
    const same = _statsRollSort.table === table && _statsRollSort.key === key;
    _statsRollSort = {
      table,
      key,
      dir: same ? -_statsRollSort.dir : (key === 'name' ? 1 : -1),
    };
    _statsRender(_statsScope);
  },
  // Popover « joueurs ciblés » : ouverture/fermeture (état persisté entre rendus).
  _statsPlayersPop: (btn) => {
    _statsPopOpen = !_statsPopOpen;
    _statsMissionPopOpen = false;
    const root = btn.closest('.stats-root') || document.getElementById('stats-root');
    root?.querySelectorAll('.stats-pop.open').forEach(p => p.classList.remove('open'));
    if (_statsPopOpen) btn.closest('.stats-pop')?.classList.add('open');
  },
  _statsPlayerShortcut: (btn) => {
    const ids = String(btn.dataset.ids || '').split(',').filter(Boolean);
    _statsPlayerSel = btn.dataset.kind === 'all' || !ids.length ? null : new Set(ids);
    _statsRender(_statsScope);
  },
  // Popover « Mission » (avec images) : ouverture/fermeture.
  _statsMissionPop: (btn) => {
    _statsMissionPopOpen = !_statsMissionPopOpen;
    _statsPopOpen = false;
    const root = btn.closest('.stats-root') || document.getElementById('stats-root');
    root?.querySelectorAll('.stats-pop.open').forEach(p => p.classList.remove('open'));
    if (_statsMissionPopOpen) btn.closest('.stats-pop')?.classList.add('open');
  },
  // Sélection d'une mission depuis le popover imagé (vide = toutes les missions).
  _statsScopeMission: (btn) => {
    _statsMissionPopOpen = false;
    _statsRender(btn.dataset.id ? `mission:${btn.dataset.id}` : null);
  },
  _statsResetFilters: () => {
    _statsScope = null;
    _statsPlayerSel = null;
    _statsGroupSel = null;
    _statsGroupMissionId = '';
    _statsRender(null);
  },
  // Filtre « joueurs ciblés » : bascule un joueur (ou « Tous ») puis recalcule tout.
  _statsTogglePlayer: (btn) => {
    const id = btn.dataset.id;
    if (id === '__all') { _statsPlayerSel = null; }
    else {
      if (!_statsPlayerSel) _statsPlayerSel = new Set();
      _statsPlayerSel.has(id) ? _statsPlayerSel.delete(id) : _statsPlayerSel.add(id);
      if (!_statsPlayerSel.size) _statsPlayerSel = null;
    }
    _statsRender(_statsScope);
  },
  // Filtre « groupes ciblés » : bascule un ou plusieurs groupes de la mission courante.
  _statsToggleGroup: (btn) => {
    const key = btn.dataset.groupKey;
    if (!key) return;
    if (key === '__all') { _statsGroupSel = null; }
    else {
      if (!_statsGroupSel) _statsGroupSel = new Set();
      _statsGroupSel.has(key) ? _statsGroupSel.delete(key) : _statsGroupSel.add(key);
      if (!_statsGroupSel.size) _statsGroupSel = null;
    }
    const missionScope = _statsGroupMissionId ? `mission:${_statsGroupMissionId}` : _statsScope;
    _statsRender(missionScope);
  },
  // Métriques des graphiques (comparatif / évolution).
  _statsCmpMetric: (el) => { _statsCmpMetric = el.value; _statsRender(_statsScope); },
  _statsEvoMetric: (el) => { _statsEvoMetric = el.value; _statsRender(_statsScope); },
  _statsEvolutionMode: (btn) => {
    _statsEvolutionMode = btn.dataset.mode === 'participant' ? 'participant' : 'total';
    _statsRender(_statsScope);
  },
  // Type du graphique comparatif : barres ↔ camembert.
  _statsCmpType: (btn) => { _statsCmpType = btn.dataset.type === 'pie' ? 'pie' : 'bars'; _statsRender(_statsScope); },
  _statsAnalysisMode: (btn) => {
    _statsAnalysisMode = btn.dataset.mode === 'compare' ? 'compare' : 'overview';
    _statsRender(_statsScope);
  },
  _statsCompareKind: (btn) => {
    _statsCompareKind = btn.dataset.kind === 'groups' ? 'groups' : 'players';
    _statsRender(_statsScope);
  },
  // Face-à-face (refonte) : choix d'un des deux personnages comparés.
  _statsDuelPick: (el) => {
    const slot = Number(el.dataset.slot);
    if (slot !== 0 && slot !== 1) return;
    const pair = [...(_statsCompareSelection.players || [])];
    pair[slot] = el.value || '';
    _statsCompareSelection.players = pair;
    _statsRender(_statsScope);
  },
  _statsComparePick: (el) => {
    const slot = Number(el.dataset.slot);
    if (slot !== 0 && slot !== 1) return;
    const pair = [...(_statsCompareSelection[_statsCompareKind] || [])];
    pair[slot] = el.value || el.dataset.value || '';
    _statsCompareSelection[_statsCompareKind] = pair;
    _statsRender(_statsScope);
  },
  // MJ : relie la séance à une mission de la Trame (sélecteur recherchable).
  _statsEditMission: async (btn) => {
    if (!STATE.isAdmin) return;
    const dk = btn.dataset.scope; if (!dk) return;
    let story = getCachedCollection('story');
    if (!story || !story.length) story = await loadCollection('story').catch(() => []);
    _statsStory = Array.isArray(story) ? story : [];
    const missions = (story || [])
      .filter(m => m.type === 'mission' || m.type === 'event')
      .sort(_statsStoryOrderCompare);
    const curId = _statsData?.sessions?.[dk]?.missionId || '';
    const opt = (id, ico, title, active) =>
      `<button type="button" class="stats-mp-opt${active ? ' active' : ''}" data-name="${_esc(_norm(title))}"
        data-action="_statsPickMission" data-scope="${dk}" data-mission-id="${_esc(id)}" data-mission="${_esc(title)}">
        <span class="stats-mp-ico">${ico}</span><span class="stats-mp-tt">${_esc(title)}</span>${active ? '<span class="stats-mp-check">✓</span>' : ''}</button>`;
    openModal(`📅 Séance du ${_statsSessionLabel(dk)}`, `
      <div class="stats-mp">
        <input type="text" class="stats-mp-search" placeholder="🔍 Rechercher une mission / un événement…" data-input="_statsMissionSearch" autocomplete="off">
        <div class="stats-mp-list">
          <button type="button" class="stats-mp-opt stats-mp-none${!curId ? ' active' : ''}" data-action="_statsPickMission" data-scope="${dk}" data-mission-id="" data-mission="">
            <span class="stats-mp-ico">✖</span><span class="stats-mp-tt">Aucune mission</span></button>
          ${missions.map(m => opt(m.id, m.type === 'event' ? '📖' : '🎯', m.titre || 'Mission', m.id === curId)).join('')}
          ${missions.length ? '' : '<div class="stats-mp-empty">Aucune mission dans la Trame.<br><span style="font-size:.9em">Crée d\'abord une mission (et ses groupes) dans la page <b>Trame</b>.</span></div>'}
        </div>
      </div>`, { subtitle: 'Relier la séance à un élément de la Trame', accent: '#22c38e' });
  },
  // Choix d'une mission : passe à l'étape « groupe » si la mission en a, sinon enregistre.
  _statsPickMission: async (btn) => {
    if (!STATE.isAdmin) return;
    const dk = btn.dataset.scope; if (!dk) return;
    const mid = btn.dataset.missionId || '';
    const mission = btn.dataset.mission || '';
    if (!mid) { // « Aucune mission » → efface le lien
      closeModalDirect();
      await setSessionMission(dk, {});
      (_statsData.sessions ??= {})[dk] = { mission: '', missionId: '', groupId: '', group: '' };
      _statsRender(_statsScope);
      return;
    }
    const story = getCachedCollection('story') || [];
    let quests = _statsQuests?.length ? _statsQuests : getCachedCollection('quests');
    if (!quests || !quests.length) quests = await loadCollection('quests').catch(() => []);
    _statsQuests = Array.isArray(quests) ? quests : [];
    const groupes = _statsGroupsForMission(story, quests, mid);
    if (Array.isArray(groupes) && groupes.length) { _statsGroupStep(dk, mid, mission, groupes); return; }
    closeModalDirect();
    await setSessionMission(dk, { mission, missionId: mid });
    (_statsData.sessions ??= {})[dk] = { mission: mission.trim(), missionId: mid, groupId: '', group: '' };
    _statsRender(_statsScope);
  },
  // Choix du groupe (étape 2).
  _statsPickGroup: async (btn) => {
    if (!STATE.isAdmin) return;
    const dk = btn.dataset.scope; if (!dk) return;
    const mid = btn.dataset.missionId || '', mission = btn.dataset.mission || '';
    const gid = btn.dataset.groupId || '', group = btn.dataset.group || '';
    closeModalDirect();
    await setSessionMission(dk, { mission, missionId: mid, groupId: gid, group });
    (_statsData.sessions ??= {})[dk] = { mission: mission.trim(), missionId: mid, groupId: gid, group: group.trim() };
    _statsRender(_statsScope);
  },
  // Filtre live du sélecteur de missions (sans re-render).
  _statsMissionSearch: (el) => {
    const q = _norm(el.value || '');
    document.querySelectorAll('.stats-mp-list .stats-mp-opt:not(.stats-mp-none)').forEach(b => {
      b.style.display = (!q || (b.dataset.name || '').includes(q)) ? '' : 'none';
    });
  },
  _statsAwardsConfig: () => {
    const row = ([id, label]) => `<label class="stats-award-opt">
      <input type="checkbox" data-change="_statsToggleAward" data-award-id="${id}"${_statsHiddenAwards.has(id) ? '' : ' checked'}>
      <span>${_esc(label)}</span>
    </label>`;
    openModal('🏆 Distinctions', `
      <div class="stats-award-config">
        <div class="stats-mp-hint">Choisis les distinctions affichées sur la page et dans le récap copié.</div>
        <div class="stats-award-list">${_STATS_AWARD_CATALOG.map(row).join('')}</div>
        <button class="stats-mng-link stats-award-reset" data-action="_statsShowAllAwards">Tout réafficher</button>
      </div>`, { subtitle: 'Affichage local de cette page', accent: '#f4c430' });
  },
  _statsToggleAward: (el) => {
    const id = el.dataset.awardId;
    if (!id) return;
    el.checked ? _statsHiddenAwards.delete(id) : _statsHiddenAwards.add(id);
    _statsSaveAwardPrefs();
    _statsRender(_statsScope);
  },
  _statsShowAllAwards: () => {
    _statsHiddenAwards = new Set();
    _statsSaveAwardPrefs();
    closeModalDirect();
    _statsRender(_statsScope);
  },
  // Export : copie le récap texte du scope courant (collable dans Discord…).
  _statsExport: async () => {
    if (!_statsLastSummary) return;
    try {
      await copyText(_statsLastSummary);
      showNotif('Récap copié dans le presse-papier.', 'success');
    } catch {
      // Fallback si clipboard indisponible (contexte non sécurisé) → affiche dans une modale.
      openModal('📋 Récap des statistiques', `<textarea class="stats-export-ta" readonly>${_esc(_statsLastSummary)}</textarea>`);
    }
  },
  _statsExportImage: () => {
    const s = _statsVisualSummary;
    if (!s) { showNotif('Aucun récap visuel à exporter.', 'info'); return; }
    if (_statsVisualSummaryEnricher) {
      Object.assign(s, _statsVisualSummaryEnricher());
      _statsVisualSummaryEnricher = null;
    }
    const W = 1200, H = 760, dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const canvas = document.createElement('canvas');
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const round = (x, y, w, h, r = 18) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    };
    const text = (t, x, y, size = 24, color = '#e6edf7', weight = '700') => {
      ctx.fillStyle = color; ctx.font = `${weight} ${size}px Inter, Arial, sans-serif`; ctx.fillText(String(t), x, y);
    };
    const wrap = (t, x, y, max, lh = 28) => {
      ctx.font = '700 22px Inter, Arial, sans-serif';
      const words = String(t).split(/\s+/); let line = '';
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > max && line) { text(line, x, y, 22, '#d8e3f6', '700'); y += lh; line = word; }
        else line = next;
      }
      if (line) text(line, x, y, 22, '#d8e3f6', '700');
      return y + lh;
    };
    ctx.fillStyle = '#07101d'; ctx.fillRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, 'rgba(79,140,255,.22)'); grad.addColorStop(.55, 'rgba(188,160,255,.12)'); grad.addColorStop(1, 'rgba(34,195,142,.16)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    text('GRIMORIUM', 56, 64, 24, '#9cc3ff', '800');
    wrap(`Statistiques — ${s.scopeLabel}`, 56, 112, 760, 34);
    round(930, 46, 180, 180, 90); ctx.fillStyle = 'rgba(34,195,142,.18)'; ctx.fill();
    text(`${s.hitRate}%`, 974, 135, 44, '#22c38e', '900'); text('réussite', 978, 166, 19, '#9fb0c7', '700');
    let x = 56, y = 210;
    s.metrics.forEach(([label, value, color], i) => {
      const cx = x + (i % 5) * 214;
      round(cx, y, 190, 105, 16); ctx.fillStyle = 'rgba(9,18,32,.78)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.stroke();
      text(value, cx + 20, y + 44, 34, color, '900');
      text(label, cx + 20, y + 76, 18, '#9fb0c7', '700');
    });
    y = 360;
    if (s.mvp) {
      round(56, y, 500, 78, 18); ctx.fillStyle = 'rgba(244,196,48,.12)'; ctx.fill(); ctx.strokeStyle = 'rgba(244,196,48,.35)'; ctx.stroke();
      text('MVP d’impact', 78, y + 30, 18, '#f4c430', '900');
      text(`${s.mvp.name} · ${s.mvp.score} pts`, 78, y + 58, 24, '#e6edf7', '900');
      y += 112;
    }
    text('Distinctions', 56, y, 26, '#f4c430', '900'); y += 44;
    (s.awards.length ? s.awards : ['Aucune distinction affichée']).slice(0, 6).forEach(a => { y = wrap(a, 72, y, 500, 30); });
    if (s.groups.length) {
      let gy = 360;
      text('Groupes', 650, gy, 26, '#c9b6ff', '900'); gy += 34;
      s.groups.forEach(g => {
        round(650, gy, 410, 72, 14); ctx.fillStyle = 'rgba(9,18,32,.7)'; ctx.fill();
        text(g.label, 670, gy + 28, 21, '#e6edf7', '800');
        text(`${g.sessions} séances · ${g.dmgAvg}/séance · ${g.heal} soin · ${g.rolls} jets`, 670, gy + 54, 17, '#9fb0c7', '700');
        gy += 86;
      });
    }
    text(new Date().toLocaleDateString('fr-FR'), 56, H - 42, 18, '#708097', '700');
    canvas.toBlob(blob => {
      if (!blob) { showNotif('Export image impossible.', 'error'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `grimorium-stats-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      showNotif('Récap visuel téléchargé.', 'success');
    }, 'image/png');
  },

  // Admin lazy-load tools
  _adminLazyOpen:        async (btn) => {
    const fn  = btn.dataset.fn;
    const mod = btn.dataset.module;
    // Les modales admin empruntent les styles de leur feature d'origine → on
    // charge la feuille correspondante AVANT d'ouvrir (sinon modale sans style).
    const cssPage = { 'characters': 'characters', 'histoire': 'histoire', 'vtt/vtt': 'vtt', '../shared/rarity': 'shop', '../shared/artisan-settings': 'shop' }[mod];
    if (cssPage) {
      try { const { _ensureFeatureCss } = await import('../core/navigation.js'); await _ensureFeatureCss(cssPage); } catch {}
    }
    if (window[fn]) { window[fn](); return; }
    const loaded = await import(`./${mod}.js`);
    if (window[fn]) { window[fn](); return; }
    if (typeof loaded?.[fn] === 'function') { loaded[fn](); return; }
    const proxy = document.createElement('button');
    proxy.dataset.action = fn;
    dispatchAction(proxy, new Event('click'));
  },
  // File de validation des sorts (tous les persos) : styles de la fiche perso + module à la demande.
  _openSpellReview: async (btn) => {
    try { const { _ensureFeatureCss } = await import('../core/navigation.js'); await _ensureFeatureCss('characters'); } catch {}
    const { openSpellReview } = await import('./characters/spell-review.js');
    openSpellReview({ charId: btn.dataset.charId, spellId: btn.dataset.spellId, idx: Number(btn.dataset.idx) });
  },
  _adminRelinkPlayer: (btn) => _adminRelinkPlayer(btn.dataset.oldUid, btn.dataset.newUid, btn.dataset.name),
  _adminMergeDuplicate: (btn) => _adminMergeDuplicate(btn.dataset.uids, btn.dataset.email),
  _adminMergeDuplicateConfirm: () => _adminMergeDuplicateConfirm(),
  _adminMergeDuplicateCancel: () => closeModalDirect(),
});

// Retour/Avance entre les onglets lourds sans reconstruire la page ni relancer
// ses lectures. Le routeur considère la sous-route comme traitée quand
// preventDefault() est appelé.
document.addEventListener('app:route-sub-changed', (event) => {
  const { page, sub } = event.detail || {};
  if (page === 'admin' && _cmjState.vm && ['todo', 'players', 'settings'].includes(sub)) {
    event.preventDefault();
    _cmjSetTab(sub, { syncRoute: false });
    return;
  }
  const statsSub = _STATS_TAB_ALIASES[sub] || sub;
  if (page === 'statistiques' && document.getElementById('stats-root') && _STATS_TABS.includes(statsSub) && (statsSub !== 'data' || STATE.isAdmin)) {
    event.preventDefault();
    _statsTab = statsSub;
    _statsRender(_statsScope);
    document.getElementById('stats-root')?.scrollIntoView({ block: 'start' });
  }
});

export default PAGES;
