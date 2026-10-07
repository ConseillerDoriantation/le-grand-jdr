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
import { MVP_AXIS_GUIDE, MVP_SCORING_GUIDE, scoreMvpView } from '../shared/stats-mvp.js';
import { showNotif } from '../shared/notifications.js';
import { copyText } from '../shared/clipboard.js';
import { confirmModal, openModal, promptModal, closeModalDirect } from '../shared/modal.js';
import { watch, watchDoc } from '../shared/realtime.js';
import { setDashboardPartyChars, setDashboardQuests } from '../shared/dashboard-session.js';
import { setTargetCharacter, consumeTargetCharacter } from '../shared/character-navigation.js';
import { getRouteSub } from '../shared/route.js';
import { characterAvatarHtml, characterPortraitContent } from '../shared/portraits.js';
import { canControlCharacter, getControlledCharacters } from '../shared/character-state.js';
import { dedupeQuestParticipants, questParticipantFromChar } from '../shared/participants.js';
import { BASTION_WALL_TYPES, bastionWallReactionCounts, bastionWallSeenKey } from '../shared/bastion-wall.js';
import { createDashboardWallFeed, dashboardWallView } from '../shared/dashboard-wall-feed.js';

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
let _statsVisualSummary = null;        // données du dernier rendu pour export image
let _statsVisualSummaryEnricher = null;// compléments lourds calculés uniquement lors de l'export
let _statsCmpMetric = 'dmgDealt';      // métrique du graphique comparatif (par perso)
let _statsCmpType   = 'bars';          // type du comparatif : 'bars' | 'pie'
let _statsEvoMetric = 'dmgDealt';      // métrique du comparatif missions/groupes
let _statsAnalysisMode = 'overview';   // 'overview' | 'compare'
let _statsTab = 'overview';            // onglet actif : overview|ranking|players|rolls|audit
let _statsPopOpen = false;             // popover « joueurs ciblés » ouvert (persisté entre rendus)
let _statsMissionPopOpen = false;      // popover « Mission » (avec images) ouvert
let _statsRankSort = { key: 'dmg', dir: -1 }; // tri du tableau de classement (dir : -1 desc, 1 asc)
let _statsRollSort = { table: 'skills', key: 'count', dir: -1 }; // tri des tableaux Jets & moyennes
let _statsRythmeView = 'timeline';     // vue du rythme : 'timeline' (barres) | 'pie' (camembert répartition)
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

const _statsAvatar = (id, name, size = 18) =>
  characterAvatarHtml(STATE.characters?.find(x => x.id === id) || { nom: name }, { size, className: 'stats-av-xs', title: name });

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
  ['fumble', 'Le plus malchanceux'],
];

const _statsNum = (v) => Number(v) || 0;
function _statsEmoteHtml(name, cls = 'stats-emote') {
  if (!name) return '—';
  const url = _statsEmoteUrl.get(name);
  return url ? `<img class="${cls}" src="${url}" alt="${_esc(name)}" title="${_esc(name)}">` : _esc(name);
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
    group('😄', 'Émotes favorites', emoteTop, n => _statsEmoteUrl.has(n)
      ? `<span class="stats-favorite-emote">${_statsEmoteHtml(n, 'stats-emote-sm')}<span>${_esc(n)}</span></span>`
      : _esc(n)),
  ].filter(Boolean).join('');
  return content ? `<div class="stats-favorite-groups">${content}</div>` : '';
}
function _statsLoadAwardPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(_STATS_AWARD_PREF_KEY) || '[]');
    _statsHiddenAwards = new Set(Array.isArray(raw) ? raw : []);
  } catch { _statsHiddenAwards = new Set(); }
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
    idxs.forEach(i => { if (sorts[i]) { sorts[i].mjValidation = 'ok'; sorts[i].mjValidated = true; total++; } });
    try { await saveDoc('characters', c.id, { deck_sorts: sorts }); c.deck_sorts = sorts; }
    catch (e) { notifySaveError(e); }
  }
  if (total) showNotif(`${total} sort${total > 1 ? 's validés' : ' validé'}.`, 'success');
  await PAGES.admin();
}

// ── Rendu ──
function _cmjOpen(vm) {
  _cmjState.vm = vm;
  if (!_cmjState.tab) {
    const stored = (() => { try { return localStorage.getItem(_CMJ_TAB_KEY) || ''; } catch { return ''; } })();
    _cmjState.tab = ['todo', 'players', 'settings'].includes(stored) ? stored : (vm.items.length ? 'todo' : 'settings');
  }
  if (_cmjState.tab === 'todo' && !vm.items.length) _cmjState.tab = 'settings';
  if (_cmjState.cur >= _cmjVisible().length) _cmjState.cur = Math.max(0, _cmjVisible().length - 1);
  _cmjRender();
  _cmjMount();
}
function _cmjSetTab(id) {
  _cmjState.tab = id; try { localStorage.setItem(_CMJ_TAB_KEY, id); } catch {}
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
  const tabsHtml = tabs.map((t, i) => `<button type="button" role="tab" class="cmj-tab${_cmjState.tab === t.id ? ' on' : ''}" data-cmj-tab="${t.id}" aria-selected="${_cmjState.tab === t.id}" title="${t.l} (${i + 1})">${_esc(t.l)}${t.badge != null ? `<span class="cmj-n${t.hot ? ' hot' : ''}">${t.badge}</span>` : ''}</button>`).join('');
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
      <div class="cmj-ra">${sp ? `<button type="button" class="cmj-btn gh" ${i.secondary || ''}>Ouvrir la fiche</button>` : ''}<button type="button" class="${pri}" ${i.attrs || ''}>${i.act === 'Valider' ? _cmjIc('check') : ''}${_esc(i.act)}</button>${sp ? `<button type="button" class="cmj-exp" data-cmj-exp="${_esc(i.id)}" aria-label="Détail du sort" aria-expanded="${_cmjState.open.has(i.id)}">${_cmjIc('chev')}</button>` : ''}</div>
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
    return `<div class="cmj-pr"><div class="cmj-pl"><span class="cmj-av" style="--c:${p.color}">${_esc((p.pseudo[0] || '?').toUpperCase())}</span><div><b>${_esc(p.pseudo)}</b><small>${_esc(p.email || '')}</small></div></div>
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
    if (t.dataset.cmjTab) return _cmjSetTab(t.dataset.cmjTab);
    if (t.dataset.cmjSec) { _cmjState.sec = t.dataset.cmjSec; _cmjState.cur = 0; return _cmjRender(); }
    if (t.dataset.cmjExp) return _cmjToggle(t.dataset.cmjExp);
    if (t.dataset.cmjBulk) { const s = t.dataset.cmjBulk; return s === 'sorts' ? _adminValidateAllSpells() : s === 'quetes' ? _adminRepairQuestParticipants() : _adminRepairVttData(); }
    if (t.hasAttribute('data-cmj-autoall')) { return _cmjRepairAll(); }
    if (t.dataset.cmjPf) { _cmjState.pf = t.dataset.cmjPf; return _cmjRender(); }
    if (t.dataset.cmjPsort) { _cmjState.psort = t.dataset.cmjPsort; return _cmjRender(); }
    if (t.dataset.cmjGoto) { _cmjState.sec = 'all'; _cmjState.tab = 'todo'; try { localStorage.setItem(_CMJ_TAB_KEY, 'todo'); } catch {} _cmjState.cur = _cmjVisible().findIndex(i => i.id === t.dataset.cmjGoto); _cmjRender(); const r = document.querySelector(`.cmj-row[data-id="${CSS.escape(t.dataset.cmjGoto)}"]`); if (r) { r.classList.add('flash'); r.querySelector('.cmj-rw')?.focus({ preventScroll: false }); } return; }
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

// Sparkline SVG inline (série d'une métrique sur les séances du scope). Aucune
// dépendance graphique : polyline étirée + point terminal.
function _statsSpark(vals, color) {
  if (!Array.isArray(vals) || vals.length < 2) return '<div class="stats-spark"></div>';
  const max = Math.max(...vals, 1), min = Math.min(...vals);
  const w = 100, h = 26, span = Math.max(1, max - min);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(1)},${(h - 3 - (v - min) / span * (h - 7)).toFixed(1)}`);
  const [lx, ly] = pts[pts.length - 1].split(',');
  return `<svg class="stats-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke" opacity=".8"/>
    <circle cx="${lx}" cy="${ly}" r="2" fill="${color}"/></svg>`;
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
function _statsRowsFor(dateKeys) {
  const num = _statsNum;
  const detailKey = dateKeys ? [...dateKeys].sort().join('|') : '*';
  if (_statsRowsCache.has(detailKey)) return _statsRowsCache.get(detailKey);
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
    for (const [charId, char] of Object.entries(_statsData?.chars || {})) {
      const key = _norm(char?.name || '');
      if (!key) continue;
      names.set(key, names.has(key) ? '' : charId);
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
    };
    const combatActionCount = hasCompleteVttDetails ? num(loggedCombat.canonicalActions) : null;
    const actionAverages = aggregateActionAverages(skillAverages, actionCombat, actionExtras);
    return {
      id, name: c.name || '?',
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
  return rows;
}

const STATS_ROLLUP_VERSION = 2;
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

  _statsRowsFor(null);
  for (const key of _statsAllSessionKeys()) _statsRowsFor([key]);

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

  root.querySelectorAll('.stats-char').forEach(charDetails => {
    if (charDetails.dataset.statsToggleBound === 'true') return;
    charDetails.dataset.statsToggleBound = 'true';
    charDetails.addEventListener('toggle', () => {
      if (charDetails.dataset.drawerKey) _statsDrawerState.set(charDetails.dataset.drawerKey, !!charDetails.open);
    });
  });
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
  const scopeDates = isAct ? selectedActDates : (isMission ? filteredMissionDates : (dateKey ? [dateKey] : null));

  const allRows = _statsRowsFor(scopeDates);   // participants du scope courant
  // Filtre « joueurs ciblés » : recalcule toute la page sur le sous-ensemble choisi.
  const sel = _statsPlayerSel;
  const rows = (sel && sel.size) ? allRows.filter(r => sel.has(r.id)) : allRows;
  const renderOverview = _statsTab === 'overview';
  const renderRanking = _statsTab === 'ranking';
  const renderPlayers = _statsTab === 'players';
  const renderRolls = _statsTab === 'rolls';
  const renderAudit = _statsTab === 'audit';
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

  const exportBtn = rows.length ? `<button class="stats-tool-btn" data-action="_statsExport" title="Copier un récapitulatif texte pour Discord" aria-label="Copier le récapitulatif"><span class="stats-tool-icon" aria-hidden="true">📋</span><span class="stats-tool-label">Copier</span></button>` : '';
  const visualBtn = rows.length ? `<button class="stats-tool-btn" data-action="_statsExportImage" title="Télécharger le récapitulatif visuel en PNG" aria-label="Télécharger le récapitulatif visuel"><span class="stats-tool-icon" aria-hidden="true">🖼️</span><span class="stats-tool-label">Visuel</span></button>` : '';
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
  const manageBtn = STATE.isAdmin ? `<button class="stats-tool-btn stats-tool-btn--manage${manageStateClass}" data-action="_statsManage" title="${manageTitle}" aria-label="Données statistiques : ${manageTitle}"><span class="stats-tool-icon" aria-hidden="true">⚙</span><span class="stats-tool-label">Données</span>${manageStatus}</button>` : '';
  const toolsBar = exportBtn || visualBtn || manageBtn ? `<div class="stats-tools" role="group" aria-label="Actions sur les statistiques">
    ${rows.length ? '<span class="stats-tools-caption">Exporter</span>' : ''}${exportBtn}${visualBtn}${manageBtn}
  </div>` : '';
  // ── Barre sticky (refonte) : périmètre 3 selects + popover joueurs + onglets ──
  const scopeKicker = dateKey ? `Séance du ${_statsSessionLabel(dateKey)}`
    : isMission ? (selectedMission?.name || 'Mission')
    : isAct ? (selectedAct?.label || 'Acte')
    : 'Toute la campagne';
  const _scOpt = (v, l, cur) => `<option value="${_esc(v)}"${v === cur ? ' selected' : ''}>${_esc(l)}</option>`;
  const missionOpts = (isAct && selectedAct ? selectedAct.missions : missions);
  const sessionOpts = selectedMissionId ? selectedMissionDates
    : (isAct && selectedAct ? selectedActDates : allDates);
  const scopeBar = `<div class="stats-scope">
    <label class="stats-sc${isAct ? ' on' : ''}"><small>Acte</small>
      <select data-change="_statsSetScopeSel" data-level="act">
        ${_scOpt('', 'Toute la campagne', isAct ? actKey : '')}
        ${acts.map(a => _scOpt(a.key, a.label, isAct ? actKey : '')).join('')}
      </select></label>
    <div class="stats-pop stats-msn${_statsMissionPopOpen ? ' open' : ''}">
      <button type="button" class="stats-sc stats-sc--btn${selectedMissionId ? ' on' : ''}" data-action="_statsMissionPop">
        <small>Mission</small>
        <span class="stats-msn-cur">${selectedMission ? `${_statsMissionArtHtml(selectedMission, 22)}<span>${_esc(selectedMission.name)}</span>` : `<span>${missionOpts.length} mission${missionOpts.length > 1 ? 's' : ''}</span>`}<i class="stats-msn-caret">▾</i></span>
      </button>
      <div class="stats-pop-menu stats-msn-menu">
        <button type="button" class="stats-msn-item${!selectedMissionId ? ' on' : ''}" data-action="_statsScopeMission" data-id=""><span class="stats-msn-item-ic">🌍</span><span>Toutes les missions</span></button>
        ${acts.map(a => `<div class="stats-msn-act">${_esc(a.label)}</div>${a.missions.map(m => `<button type="button" class="stats-msn-item${m.id === selectedMissionId ? ' on' : ''}" data-action="_statsScopeMission" data-id="${_esc(m.id)}">${_statsMissionArtHtml(m, 30)}<span>${_esc(m.name)}</span></button>`).join('')}`).join('')}
      </div>
    </div>
    <label class="stats-sc${dateKey ? ' on' : ''}"><small>Séance</small>
      <select data-change="_statsSetScopeSel" data-level="session" data-mission="${_esc(selectedMissionId || '')}" data-act="${isAct ? _esc(actKey) : ''}">
        ${_scOpt('', `${sessionOpts.length} séance${sessionOpts.length > 1 ? 's' : ''}`, dateKey || '')}
        ${sessionOpts.map(d => _scOpt(d, `${_statsSessionLabel(d, { short: true })}${_statsGroupOf(d) ? ' · ' + _statsGroupOf(d) : ''}`, dateKey || '')).join('')}
      </select></label>
  </div>`;
  const popRows = allRows;
  const playersPop = popRows.length ? `<div class="stats-pop${_statsPopOpen ? ' open' : ''}">
    <button class="stats-pill${sel && sel.size ? ' on' : ''}" data-action="_statsPlayersPop">
      <span class="stats-avstack">${popRows.slice(0, 4).map(r => _statsAvatar(r.id, r.name, 20)).join('')}</span>
      ${sel && sel.size ? `${rows.length} joueur${rows.length > 1 ? 's' : ''} ciblé${rows.length > 1 ? 's' : ''}` : `Tous les joueurs · ${popRows.length}`} ▾
    </button>
    <div class="stats-pop-menu">
      <div class="stats-pop-hd"><span>Joueurs ciblés</span><button data-action="_statsTogglePlayer" data-id="__all">Tout sélectionner</button></div>
      <div class="stats-pop-list">${popRows.map(r => `<button class="stats-pop-item${sel && sel.has(r.id) ? ' on' : ''}" data-action="_statsTogglePlayer" data-id="${r.id}">${_statsAvatar(r.id, r.name, 20)}<span>${_esc(r.name)}</span></button>`).join('')}</div>
    </div>
  </div>` : '';
  const tabDefs = [['overview', 'Vue d’ensemble'], ['ranking', 'Classement'], ['players', 'Joueurs'], ['rolls', 'Jets & moyennes'], ['audit', 'Audit']];
  const tabCounts = { ranking: rows.length, players: rows.length };
  const tabsBar = `<div class="stats-tabs">${tabDefs.map(([k, l]) => `<button class="stats-tab${_statsTab === k ? ' on' : ''}" data-action="_statsSetTab" data-tab="${k}">${l}${tabCounts[k] ? `<span class="stats-tab-cnt">${tabCounts[k]}</span>` : ''}</button>`).join('')}</div>`;
  const controls = `<div class="stats-topbar"><div class="stats-topbar-in">
    <div class="stats-topbar-row">
      <div class="stats-brand"><h1>Statistiques</h1><small>${_esc(scopeKicker)}</small></div>
      <div class="stats-spacer"></div>
      ${toolsBar}
    </div>
    <div class="stats-topbar-scope">
      <span class="stats-scope-art" title="${_esc(selectedMission?.name || scopeKicker)}">${selectedMission ? _statsMissionArtHtml(selectedMission, 56) : `<span class="stats-scope-art-ph">${isAct ? '📖' : '🌍'}</span>`}</span>
      ${scopeBar}
    </div>
    ${playersPop ? `<div class="stats-topbar-players"><span class="stats-scope-art stats-scope-art--ghost" aria-hidden="true"></span>${playersPop}</div>` : ''}
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
  const mvpScores = needsImpact ? scoreMvpView({
    rows: allRows,
    sessionRows: mvpUnitRows.length > 1 ? mvpUnitRows : [],
    visibleIds: sel,
    autoCalibrate: true,
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
  const eligibleImpactRows = impactRows.filter(row => row.impactEligible !== false);
  const mvpPool = eligibleImpactRows.length ? eligibleImpactRows : impactRows;
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
    award('dmg', '🗡️', 'Dégâts totaux', dmgLeaders.winners, `${dmgLeaders.value} dmg`, '#f4c430'),
    award('bigHit', '💥', 'Plus gros coup', bigHitLeaders.winners, `${bigHitLeaders.value} dmg`, '#ff8b6b'),
    award('hitRate', '🎯', 'Meilleur taux de touche', hitLeaders.winners, `${hitLeaders.value} %`, '#22c38e'),
    award('ko', '☠️', 'Mises à terre', koLeaders.winners, `${koLeaders.value} KO`, '#ef4444'),
    award('heal', '💚', 'Soin prodigué', healLeaders.winners, `${healLeaders.value} PV`, '#4fd3a6'),
    award('mage', '🧙', 'Sorts lancés', mageLeaders.winners, `${mageLeaders.value} sorts`, '#bca0ff'),
    award('tank', '🪨', 'Dégâts encaissés', tankLeaders.winners, `${tankLeaders.value} dmg`, '#9aa0aa'),
    award('parry', '🛡️', 'Coups parés ou esquivés', parryLeaders.winners, `${parryLeaders.value} coup${parryLeaders.value > 1 ? 's' : ''}`, '#76a9ff'),
    award('emotes', '💬', 'Émotes envoyées', emoteLeaders.winners, `${emoteLeaders.value} émotes`, '#4f8cff'),
    award('rolls', '🎲', 'Jets de dés', rollLeaders.winners, `${rollLeaders.value} jets`, '#7fb0ff'),
    award('crit', '🌟', 'Réussites critiques', critLeaders.winners, `${critLeaders.value} critique${critLeaders.value > 1 ? 's' : ''}`, '#f4c430'),
    award('fumble', '🤡', 'Échecs critiques', fumbleLeaders.winners, `${fumbleLeaders.value} échec${fumbleLeaders.value > 1 ? 's' : ''}`, '#ff6b6b'),
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
    const campaignMvp = mvps.some(leader => leader.impactDetails?.mode === 'campaign');
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
      return `<div class="stats-axe stats-axe--${_esc(a.key)}" title="${_esc(contrib)}">
      <i>${a.icon || '•'}</i><span class="stats-axe-copy"><b>${_esc(a.label)}</b><small>${_esc(formula)}</small></span>
      <span class="stats-axe-bar"><i style="width:${Math.round(perf / axesMax * 100)}%"></i></span>
      <span class="stats-axe-pts"><b>${fmtMvpNum(perf)}</b><small>indice</small></span>
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
    return `<div class="stats-mvp">
      <div class="stats-mvp-top">
        ${_statsAvatar(lead.id, lead.name, 52)}
        <div class="stats-mvp-name"><span class="stats-mvp-k">MVP d'impact${isTopLead ? '' : ' · candidat'}</span><b>${_esc(lead.name)}</b></div>
        <div class="stats-mvp-sc"><b>${leadDetails.score ?? lead.impact}</b><small>${campaignMvp ? 'médiane' : 'score'}</small></div>
      </div>
      <div class="stats-axes">${axesHtml || '<div class="stats-empty-inline">Aucun axe positif sur ce périmètre.</div>'}</div>
      ${mvpExplanationHtml}
      ${runnersHtml}
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
  const _avgNote = (!actionMean.trackedRolls || actionMean.coverage < 100 || actionMean.resultCoverage < 100 || combatMean.damageAverageEstimated)
    ? `<div class="stats-note"><span>ℹ️</span><span>Le journal VTT complet de l’aventure est pris en compte, sans limite de 500 entrées. Un tiret signifie que certaines actions très anciennes ne contenaient pas encore la valeur détaillée du d20 ou de ses bonus ; leur nombre et leurs critiques restent comptés.</span></div>` : '';
  const averagesHtml = renderRolls ? `<section class="stats-surface" id="moyennes">
    <div class="stats-surface-head"><div><span>Compétences, combat et ensemble</span><h3>Moyennes des jets</h3></div><small>Historique complet de l’aventure</small></div>
    <div class="stats-roll-groups">
      ${_rollGroup('🎲', 'Compétences', 'Jets de compétence uniquement', [
        _rollMetric('Nombre', GS.rolls, 'jets enregistrés', '#7fb0ff'),
        _rollMetric('Chance au dé', GS.naturalAvg == null ? '—' : `${statsAvg(GS.naturalAvg)}/20`, 'd20 naturel, sans bonus', '#4fd3a6'),
        _rollMetric('Résultat moyen', statsAvg(GS.resultAvg), 'd20 + modificateurs', '#7fb0ff'),
        _rollMetric('Crit. / échecs', `${GS.crits} / ${GS.fumbles}`, '20 naturels / 1 naturels', '#f4c430'),
      ], '#7fb0ff')}
      ${_rollGroup('⚔️', 'Combat', 'Attaques et sorts réellement lancés', [
        _rollMetric('Nombre', aggregate.combatActionCount ?? '…', '1 par attaque ou sort réellement lancé', '#ff9d7a'),
        _rollMetric('Chance au dé', combatActionMean.naturalAvg == null ? '—' : `${statsAvg(combatActionMean.naturalAvg)}/20`, 'd20 naturel, sans bonus', '#4fd3a6'),
        _rollMetric('Résultat moyen', statsAvg(combatActionMean.resultAvg), 'd20 + modificateurs', '#7fb0ff'),
        _rollMetric('Crit. / échecs', `${combatActionMean.crits} / ${combatActionMean.fumbles}`, 'toutes actions de combat', '#f4c430'),
        _rollMetric('Dégâts moyens', statsAvg(combatMean.damageAverage), combatMean.damageAverageEstimated ? 'par touche' : 'par impact suivi', '#c9b6ff'),
      ], '#ff9d7a')}
      ${_rollGroup('∑', 'Tous les jets', 'Compétences + combat', [
        _rollMetric('Nombre', actionMean.rolls, actionBreakdown, '#ff9d7a'),
        _rollMetric('Chance au dé', actionMean.naturalAvg == null ? '—' : `${statsAvg(actionMean.naturalAvg)}/20`, 'd20 naturel, sans bonus', '#4fd3a6'),
        _rollMetric('Résultat moyen', statsAvg(actionMean.resultAvg), 'd20 + tous les modificateurs', '#7fb0ff'),
        _rollMetric('Crit. / échecs', `${actionMean.crits} / ${actionMean.fumbles}`, 'toutes actions au d20', '#f4c430'),
      ], '#bca0ff')}
    </div>
    <div class="stats-legend">
      <span><b>Chance au dé</b> = moyenne du d20 naturel, sans aucun bonus (10,5 est la moyenne théorique).</span>
      <span><b>Résultat moyen</b> = moyenne réellement obtenue après les bonus et malus.</span>
      <span><b>Dégâts</b> = total infligé ÷ impacts</span>
      <span><b>Nombre (combat)</b> = une action par attaque ou sort lancé, quel que soit le nombre de cibles.</span>
    </div>
    ${_avgNote}
    <div class="stats-surface-head stats-surface-head--sub"><div><span>Détail des compétences</span><h3>Par compétence</h3></div><small>Cliquer sur un libellé pour trier</small></div>
    <div class="stats-tbl-wrap"><table class="stats-tbl">
      <thead><tr>${_rollTh('skills', 'name', 'Compétence', 'stats-th-who')}${_rollTh('skills', 'count', 'Nombre')}${_rollTh('skills', 'natural', 'Chance au dé')}${_rollTh('skills', 'result', 'Résultat moyen')}${_rollTh('skills', 'crits', 'Crit. / échecs')}</tr></thead>
      <tbody>${averageSkillRows || '<tr><td colspan="5" class="stats-tbl-z" style="text-align:center;padding:16px">Aucun jet de compétence sur ce périmètre.</td></tr>'}</tbody>
    </table></div>
    <div class="stats-surface-head stats-surface-head--sub"><div><span>Détail des actions de combat</span><h3>Combat par personnage</h3></div><small>Une attaque ou un sort = une action</small></div>
    <div class="stats-tbl-wrap"><table class="stats-tbl">
      <thead><tr>${_rollTh('combat', 'name', 'Personnage', 'stats-th-who')}${_rollTh('combat', 'count', 'Nombre')}${_rollTh('combat', 'natural', 'Chance au dé')}${_rollTh('combat', 'result', 'Résultat moyen')}${_rollTh('combat', 'crits', 'Crit. / échecs')}</tr></thead>
      <tbody>${averageCombatRows || '<tr><td colspan="5" class="stats-tbl-z" style="text-align:center;padding:16px">Aucune action de combat au d20 sur ce périmètre.</td></tr>'}</tbody>
    </table></div>
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
    })) : [];
  const kpiSeries = chronoSessions.map(s => s.agg);
  const _statsSessMetric = (agg, key) => key === 'rolls' ? (agg?.skills?.rolls || 0) : (agg?.combat?.[key] || 0);
  const _kpiNum = (v) => Number(v || 0).toLocaleString('fr-FR');
  const KPI_DEFS = [
    ['DMG', GC.dmgDealt, '🗡️', 'D&eacute;g&acirc;ts inflig&eacute;s', '#c9b6ff', a => a.combat.dmgDealt],
    ['PV', GC.heal, '💚', 'Soin produit', '#4fd3a6', a => a.combat.heal],
    ['MAG', GC.spellsCast, '🔮', 'Sorts lanc&eacute;s', '#bca0ff', a => a.combat.spellsCast],
    ['D20', GS.rolls, '🎲', 'Jets de d&eacute;s', '#7fb0ff', a => a.skills.rolls],
    ['KO', GC.kosDealt, '☠️', 'KO inflig&eacute;s', '#ef4444', a => a.combat.kosDealt],
  ];
  const _statsKpi = (short, value, icon, label, color, pick) => {
    const vals = kpiSeries.map(pick);
    const n = vals.length;
    const d = n > 1 ? vals[n - 1] - vals[n - 2] : null;
    const prev = n > 1 ? vals[n - 2] : 0;
    const pct = (d != null && prev) ? Math.round(d / prev * 100) : null;
    const hasDelta = d != null && d !== 0;
    return `<div class="stats-kpi">
      <div class="stats-kpi-t"><span>${short}</span>${hasDelta ? `<span class="stats-kpi-d ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${pct != null ? Math.abs(pct) + '%' : Math.abs(d)}</span>` : ''}</div>
      <div class="stats-kpi-v" style="color:${color}">${_kpiNum(value)}</div>
      <div class="stats-kpi-l">${icon} ${label}</div>
      ${_statsSpark(vals, color)}
      ${hasDelta ? '<div class="stats-kpi-l stats-kpi-sub">vs s&eacute;ance pr&eacute;c&eacute;dente</div>' : ''}
    </div>`;
  };
  const heroSec = renderOverview ? `<section class="stats-board">
    <div class="stats-bd-id">
      ${_statsGauge(hitRate, '#22c38e', 104, 10, 'r&eacute;ussite')}
      <div class="stats-bd-copy">
        <span class="stats-bd-k">P&eacute;rim&egrave;tre analys&eacute;</span>
        <h2>${_esc(scopeLabel)}</h2>
        <p>${rows.length} personnage${rows.length > 1 ? 's' : ''} &middot; ${scopeDateCount} s&eacute;ance${scopeDateCount > 1 ? 's' : ''} &middot; ${_kpiNum(GC.attacks)} attaque${GC.attacks > 1 ? 's' : ''}</p>
      </div>
    </div>
    <div class="stats-kpis">${KPI_DEFS.map(d => _statsKpi(...d)).join('')}</div>
  </section>` : '';

  // ── Rythme de campagne (refonte, étape 6) : évolution par séance + missions ──
  const evoKey = _STATS_METRICS[_statsEvoMetric] ? _statsEvoMetric : 'dmgDealt';
  const evoM = _STATS_METRICS[evoKey];
  const evoVals = chronoSessions.map(s => _statsSessMetric(s.agg, evoKey));
  const evoMax = Math.max(...evoVals, 1);
  const evoAvg = evoVals.length ? Math.round(evoVals.reduce((a, b) => a + b, 0) / evoVals.length) : 0;
  const evoStep = chronoSessions.length > 12 ? 2 : 1;
  const _canTimeline = chronoSessions.length > 1;
  const _rythmeView = (_statsRythmeView === 'pie' || !_canTimeline) ? 'pie' : 'timeline';
  const rythmeToggle = `<div class="stats-segm">
    <button class="${_rythmeView === 'timeline' ? 'on' : ''}"${_canTimeline ? '' : ' disabled'} data-action="_statsRythmeView" data-view="timeline">📈 Évolution</button>
    <button class="${_rythmeView === 'pie' ? 'on' : ''}" data-action="_statsRythmeView" data-view="pie">◔ Répartition</button>
  </div>`;
  const rythmeBody = _rythmeView === 'pie'
    ? _statsPieChart(rows, evoKey)
    : `<div class="stats-tl">${chronoSessions.map((s, i) => `<button type="button" class="stats-tl-col${s.date === dateKey ? ' on' : ''}" data-action="_statsSetScope" data-scope="${s.date === dateKey ? '' : s.date}" style="--mc:${evoM.color}">
        <span class="stats-tl-tip">${_statsSessionLabel(s.date)} · <b>${_kpiNum(evoVals[i])}</b> ${evoM.lbl.toLowerCase()}${s.mission ? `<br><span class="stats-dim">${_esc(s.mission)}</span>` : ''}</span>
        <span class="stats-tl-bar" style="height:${Math.max(3, Math.round(evoVals[i] / evoMax * 100))}%"></span>
        <span class="stats-tl-x">${i % evoStep === 0 ? (_statsSessionTime(s.date) || _statsFmtDate(s.date).slice(0, 5)) : ''}</span></button>`).join('')}</div>
      <div class="stats-tl-legend"><span>Pic : ${_kpiNum(evoMax)} · moyenne : ${_kpiNum(evoAvg)} / séance</span><span>${evoM.lbl}</span></div>`;
  const timelineSec = renderOverview && (_canTimeline || rows.length) ? `<div class="stats-surface stats-chart">
    <div class="stats-chart-hd"><div><b>${_rythmeView === 'pie' ? 'Répartition par personnage' : 'Évolution par séance'}</b><small>${_rythmeView === 'pie' ? `Part de chaque personnage · ${evoM.lbl.toLowerCase()}` : chronoSessions.length + ' séances · cliquer pour cadrer la vue'}</small></div><div class="stats-chart-ctrl">${rythmeToggle}${_statsMetricSelect(evoKey, '_statsEvoMetric')}</div></div>
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
  const rythmeSec = renderOverview && (timelineSec || missionsSec) ? `<section class="stats-sec stats-rythme">
    <div class="stats-surface-head"><div><span>Tendance</span><h3>Rythme de campagne</h3></div></div>
    <div class="stats-rythme-grid${missionsSec && timelineSec ? '' : ' stats-rythme-grid--solo'}">${timelineSec}${missionsSec}</div>
  </section>` : '';

  const spotlightHtml = renderOverview ? `<section class="stats-surface" id="temps-forts">
    <div class="stats-surface-head">
      <div><span>R&eacute;sum&eacute; de performance</span><h3>Temps forts</h3></div>
      ${awardTotal ? `<button class="stats-sec-tool" data-action="_statsAwardsConfig" title="Choisir les distinctions affich&eacute;es">&#9881;</button>` : ''}
    </div>
    <div class="stats-spotlight-grid">
      <div class="stats-mvp-stack">
        ${mvpSec || '<div class="stats-empty-inline">Aucun MVP calculable pour cette vue.</div>'}
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
  const RANK_COLS = [
    ['attacks', 'Att.', '#ff9d7a', r => r.combat.attacks],
    ['hitRate', 'Touche', '#22c38e', r => (r.combat.attacks ? Math.round(r.combat.hits / r.combat.attacks * 100) : null)],
    ['dmg', 'Dégâts', '#c9b6ff', r => r.combat.dmgDealt],
    ['heal', 'Soin', '#4fd3a6', r => r.combat.heal],
    ['spells', 'Sorts', '#bca0ff', r => r.combat.spellsCast],
    ['rolls', 'Jets', '#7fb0ff', r => r.sRolls],
    ['taken', 'Subis', '#a7b4c4', r => r.combat.dmgTaken],
    ['ko', 'KO', '#ef4444', r => r.combat.kosDealt],
    ['impact', 'Impact', '#f4c430', r => r.impact],
  ];
  const rankGet = Object.fromEntries(RANK_COLS.map(([k, , , get]) => [k, get]));
  const rankColor = Object.fromEntries(RANK_COLS.map(([k, , col]) => [k, col]));
  const rankSortKey = rankGet[_statsRankSort.key] ? _statsRankSort.key : 'dmg';
  const rankDir = _statsRankSort.dir === 1 ? 1 : -1;
  const rankRows = renderRanking
    ? [...impactRows].sort((a, b) => (((rankGet[rankSortKey](b) || 0) - (rankGet[rankSortKey](a) || 0)) * (rankDir === -1 ? 1 : -1)))
    : [];
  const rankMax = renderRanking ? Math.max(...impactRows.map(r => rankGet[rankSortKey](r) || 0), 1) : 1;
  const rankNum = (v) => Number(v || 0).toLocaleString('fr-FR');
  const rankCell = (r, key) => {
    const v = rankGet[key](r);
    if (key === 'hitRate') return v == null
      ? '<td><span class="stats-tbl-z">—</span></td>'
      : `<td><span class="stats-hr-pill" style="color:${v >= 65 ? 'var(--emerald)' : v >= 45 ? 'var(--text)' : 'var(--crimson)'}">${v}%</span></td>`;
    if (key === rankSortKey) return `<td class="on"><span class="stats-cellbar" style="--mc:${rankColor[key]}"><i style="width:${Math.max(2, (v || 0) / rankMax * 100)}%"></i><b>${rankNum(v)}</b></span></td>`;
    return v ? `<td>${rankNum(v)}</td>` : '<td class="stats-tbl-z">—</td>';
  };
  const rankTh = (key, label) => `<th class="stats-th-sort${key === rankSortKey ? ' on' : ''}" data-action="_statsSortRank" data-key="${key}">${label}${key === rankSortKey ? `<span class="stats-th-arw">${rankDir === -1 ? '▼' : '▲'}</span>` : ''}</th>`;
  const rankingSec = renderRanking ? `<section class="stats-surface" id="classement">
    <div class="stats-surface-head"><div><span>Qui a fait quoi</span><h3>Classement</h3></div><small>Clique une colonne pour trier · ${rankRows.length} personnage${rankRows.length > 1 ? 's' : ''}</small></div>
    <div class="stats-tbl-wrap"><table class="stats-tbl">
      <thead><tr><th class="stats-th-rk"></th><th class="stats-th-who">Personnage</th>${RANK_COLS.map(([k, l]) => rankTh(k, l)).join('')}</tr></thead>
      <tbody>${rankRows.map((r, i) => `<tr>
        <td class="stats-td-rk${i === 0 ? ' stats-rk1' : ''}">${i + 1}</td>
        <td class="stats-td-who"><span class="stats-who-in">${_statsAvatar(r.id, r.name, 26)}<b>${_esc(r.name)}</b></span></td>
        ${RANK_COLS.map(([k]) => rankCell(r, k)).join('')}
      </tr>`).join('')}</tbody>
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

  const activeTabHtml = {
    overview: `${heroSec}${spotlightHtml}${rythmeSec}${contextSec}`,
    ranking: `${rankingSec}${duelSec}${groupsHtml}<div class="stats-content-grid stats-content-grid--solo">${palmaresHtml}</div>`,
    players: rosterHtml,
    rolls: averagesHtml,
    audit: detailsHtml,
  }[_statsTab] || `${heroSec}${spotlightHtml}${rythmeSec}${contextSec}`;

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

  // ─── DASHBOARD V3 ───────────────────────────────────────────────────────────
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
    let pickGroupId = '';
    let paintQueued = false;
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
    };
    const icon = (id, size = 13) => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[id] || ''}</svg>`;
    const wallSeenAt = () => {
      let local = 0;
      try { local = Number(localStorage.getItem(bastionWallSeenKey(STATE.adventure?.id, STATE.user?.uid))) || 0; } catch { /* stockage privé */ }
      return Math.max(local, Number(wallRead?.seenAt) || 0);
    };
    const schedulePaint = () => {
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
    const timeAgo = raw => {
      const ts = typeof raw === 'number' ? raw : (raw?.toMillis?.() ?? Date.parse(raw || '') ?? 0);
      const mins = Math.max(0, Math.floor((Date.now() - ts) / 60_000));
      if (mins < 1) return "à l’instant";
      if (mins < 60) return `${mins} min`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours} h`;
      const days = Math.floor(hours / 24);
      return `${days} j`;
    };
    const controlledChars = () => STATE.isAdmin
      ? allChars
      : getControlledCharacters(allChars, STATE.user?.uid);
    const liveUids = () => {
      const now = Date.now();
      return new Set((presence || [])
        .filter(item => item?.uid && item.uid !== STATE.user?.uid)
        .filter(item => {
          const ts = item.lastSeen?.toMillis?.() ?? 0;
          return ts > 0 && now - ts < PRESENCE_TTL_MS;
        })
        .map(item => item.uid));
    };
    const groups = () => {
      const base = STATE.isAdmin
        ? activeGroupsFromSources(story, quests)
        : (isUsableSummary(summary) ? summary.groups : []);
      return base.map(group => ({
        ...group,
        participants: groupOverrides.get(group.id) || group.participants || [],
      }));
    };
    const sessions = () => {
      const base = STATE.isAdmin
        ? compactDashboardSessions(agenda, quests)
        : (isUsableSummary(summary) ? summary.sessions : []);
      const order = { m: 0, a: 1, s: 2 };
      return base
        .filter(session => isAgendaSessionUpcoming(session, todayIso()))
        .filter(session => STATE.isAdmin
          || !session.participantUids?.length
          || session.participantUids.some(uid => aliasSet.has(uid)))
        .sort((a, b) => String(a.date).localeCompare(String(b.date))
          || (order[a.slot] ?? 9) - (order[b.slot] ?? 9));
    };
    const charForParticipant = participant => allChars.find(char => char.id === participant?.charId)
      || allChars.find(char => char.uid === participant?.uid)
      || { nom: participant?.nom || 'Personnage', uid: participant?.uid || '' };
    const avatar = (entity, className = '', live = false) => {
      const sizes = { sm: 24, lg: 46, xl: 56 };
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

    const sessionSection = (list, groupList) => {
      if (!list.length) return `<section class="db-ses"><div class="db-none">
        <div><b>Aucune séance prévue${STATE.isAdmin ? '' : ' pour tes groupes'}</b><p>${STATE.isAdmin ? 'Planifie une date pour un groupe de la Trame.' : 'Rejoins un groupe ci-dessous ou indique tes disponibilités au MJ.'}</p></div>
        <button type="button" class="db-btn" data-navigate="agenda">${icon('calendar')} ${STATE.isAdmin ? 'Planifier une séance' : 'Mes disponibilités'}</button>
        <button type="button" class="db-go" data-navigate="vtt">${icon('play', 15)} Entrer dans la table</button>
      </div></section>`;
      const first = list[0];
      const group = groupList.find(item => item.id === first.questId) || {};
      const date = dateInfo(first.date);
      const slot = slotMeta(first.slot);
      const participants = (group.participants || []).map(charForParticipant);
      return `<section class="db-ses"><div class="db-ses-in">
        <div class="db-cal"><span>${_esc(date.month)}</span><b>${date.day}</b><small>${_esc(date.weekday)}</small></div>
        <div class="db-ses-t"><span class="db-ses-k">Prochaine séance${date.when ? ` <em>${_esc(date.when)}</em>` : ''}</span>
          <h1>${_esc(group.missionTitle || 'Séance de l’aventure')}</h1>
          <div class="db-ses-m"><span>${icon('clock')}${_esc(slot.label)} · ${_esc(slot.hours)}</span>${group.location ? `<span>${icon('map-pin')}${_esc(group.location)}</span>` : ''}${group.title ? `<span>${icon('flag')}${_esc(group.title)}${group.act ? ` · ${_esc(group.act)}` : ''}</span>` : ''}</div>
          <div class="db-ses-p">${participants.length ? `<span class="db-stack">${participants.slice(0, 6).map(char => avatar(char, 'sm', liveUids().has(char.uid))).join('')}</span>` : ''}${participants.length} personnage${participants.length > 1 ? 's' : ''}</div>
        </div>
        <div class="db-ses-a"><button type="button" class="db-go" data-navigate="vtt">${icon('play', 15)} Entrer dans la table</button><button type="button" class="db-link" data-navigate="story">Voir la mission ${icon('arrow-right')}</button></div>
      </div>${list.length > 1 ? `<div class="db-more">${list.slice(1).map(item => {
        const itemGroup = groupList.find(groupItem => groupItem.id === item.questId) || {};
        const itemDate = dateInfo(item.date);
        const itemChars = (itemGroup.participants || []).map(charForParticipant);
        return `<button type="button" class="db-mr" data-navigate="agenda"><b>${_esc(itemDate.short)}</b><span>${_esc(itemGroup.title || 'Groupe')} <em>· ${_esc(itemGroup.missionTitle || 'Mission')}</em></span>${itemChars.length ? `<span class="db-stack">${itemChars.slice(0, 5).map(char => avatar(char, 'sm', liveUids().has(char.uid))).join('')}</span>` : ''}</button>`;
      }).join('')}</div>` : ''}</section>`;
    };

    const playerCharactersSection = groupList => {
      const chars = controlledChars();
      const card = char => {
        const pvMax = calcPVMax(char) || char.pvBase || 10;
        const low = pvMax > 0 && (char.hp ?? char.pvActuel ?? pvMax) / pvMax < .3;
        const group = groupForChar(char, groupList);
        return `<button type="button" class="db-ch" data-action="_dashQuickChar" data-id="${_esc(char.id)}"><span class="db-ch-h">${avatar(char, 'lg')}<span><b>${_esc(char.nom || '?')}</b><small>${_esc([char.classe, char.race].filter(Boolean).join(' · '))}</small></span><span class="db-lv">Niv. ${char.niveau || 1}</span></span>${bars(char)}<span class="db-ch-f"><span class="db-chip">${icon('shield')} CA <b>${calcCA(char) || 10}</b></span><span class="db-chip">${icon('coin')} <b>${calcOr(char) || 0}</b> or</span>${group ? `<span class="db-chip grp">${icon('flag')}${_esc(group.title)}</span>` : ''}${low ? '<span class="db-chip warn">PV bas</span>' : ''}</span></button>`;
      };
      return `<section class="db-sec"><div class="db-sh"><h2>${chars.length > 1 ? 'Mes personnages' : 'Mon personnage'}</h2>${chars.length > 1 ? `<span class="n">${chars.length}</span>` : ''}</div><div class="db-chars">${chars.length ? chars.map(card).join('') : `<button type="button" class="db-new" data-navigate="characters">${icon('plus')} Créer mon personnage</button>`}</div></section>`;
    };

    const gmCharactersSection = groupList => {
      const online = liveUids();
      return `<section class="db-sec"><div class="db-sh"><h2>Personnages</h2><span class="n">${allChars.length}</span><span class="sp"></span><button type="button" class="db-link" data-navigate="characters">Toutes les fiches ${icon('arrow-right')}</button></div><div class="db-card">${allChars.length ? allChars.map(char => {
        const group = groupForChar(char, groupList);
        const connected = online.has(char.uid);
        const owner = char.ownerPseudo || char.joueur || char.playerName || 'Joueur';
        return `<button type="button" class="db-tr" data-action="_dashQuickChar" data-id="${_esc(char.id)}"><span class="db-who">${avatar(char, '', connected)}<span><b>${_esc(char.nom || '?')}</b><small>${connected ? '<em>Connecté</em> · ' : ''}${_esc(owner)}${char.classe ? ` · ${_esc(char.classe)} niv. ${char.niveau || 1}` : ''}</small></span></span>${bars(char)}${group ? `<span class="db-chip grp">${_esc(group.title)}</span>` : '<span class="db-chip">Sans groupe</span>'}</button>`;
      }).join('') : '<div class="db-empty"><b>Aucun personnage</b>Les fiches de l’aventure apparaîtront ici.</div>'}</div></section>`;
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
              : `<button type="button" class="db-btn" disabled>Aucun personnage libre</button>`;
        return `<article class="db-g${joined ? ' in' : ''}"><div class="db-g-k"><span>${_esc([group.act, group.missionTitle].filter(Boolean).join(' · ') || 'Mission')}</span><em>${joined ? 'Rejoint' : STATE.isAdmin ? `${members.length} membre${members.length > 1 ? 's' : ''}` : 'Ouvert'}</em></div><h3>${_esc(group.title || 'Groupe')}</h3><p>${icon('calendar')}${session ? `Séance ${_esc(dateInfo(session.date).short.toLowerCase())}` : 'Pas encore de date'}</p>${picker}<div class="db-g-f">${members.length ? `<span class="db-stack">${members.slice(0, 5).map(char => avatar(char, 'sm', liveUids().has(char.uid))).join('')}</span>` : ''}<small>${members.length ? `${members.length} membre${members.length > 1 ? 's' : ''}` : 'Aucun membre'}</small>${action}</div></article>`;
      };
      return `<section class="db-sec"><div class="db-sh"><h2>${STATE.isAdmin ? 'Groupes actifs' : 'Groupes ouverts'}</h2><span class="n">${STATE.isAdmin ? groupList.length : openCount}</span><span class="sp"></span><button type="button" class="db-link" data-navigate="story">Trame ${icon('arrow-right')}</button></div><div class="db-groups">${sorted.length ? sorted.map(card).join('') : '<div class="db-card db-empty"><b>Aucun groupe actif</b>Les groupes ouverts de la Trame apparaîtront ici.</div>'}</div></section>`;
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
        return `<button type="button" class="db-w${isUnread ? ' unread' : ''}" data-navigate="bastion" data-nav-sub="post:${_esc(post.id)}">${avatar(char)}<span class="db-w-b"><span class="db-w-h"><b>${_esc(post.charName || post.author || char.nom || 'Personnage')}</b><span class="db-ty" style="--t:${_esc(type.color)}">${_esc(type.label)}</span>${post.pinned ? '<span class="db-pin">Épinglé</span>' : ''}<span>· ${timeAgo(post.ts)}</span></span><p>${_esc(post.text || 'Nouvelle publication')}</p><span class="db-w-s">${reactions} réaction${reactions > 1 ? 's' : ''} · ${replies} réponse${replies > 1 ? 's' : ''}</span></span></button>`;
      };
      return `<section class="db-sec db-wall"><div class="db-sh"><h2>Mur du Bastion</h2>${unread ? `<span class="new">${unread} nouveau${unread > 1 ? 'x' : ''}</span>` : ''}<span class="sp"></span><button type="button" class="db-link" data-navigate="bastion">Ouvrir ${icon('arrow-right')}</button></div><div class="db-card">${shown.length ? shown.map(card).join('') : '<div class="db-empty"><b>Le mur est prêt</b>Publiez la première nouvelle du Bastion.</div>'}<div class="db-wf"><button type="button" class="db-btn" data-navigate="bastion">${icon('edit')} Publier</button>${unread ? '<button type="button" class="db-btn ghost" data-action="_dashMarkWallRead">Tout marquer lu</button>' : ''}</div></div></section>`;
    };

    function paint() {
      paintQueued = false;
      const root = document.getElementById('dash-root');
      if (!root || STATE.currentPage !== 'dashboard') return;
      STATE.characters = allChars;
      setDashboardPartyChars(allChars);
      setDashboardQuests(quests);
      const groupList = groups();
      const sessionList = sessions();
      const hasJoinedGroup = groupList.some(groupJoined);
      const characterSection = STATE.isAdmin ? gmCharactersSection(groupList) : playerCharactersSection(groupList);
      const groupSection = groupsSection(groupList);
      // La séance occupe toute la largeur en tête ; les autres sections se
      // répartissent dans la grille 2 colonnes dessous (évite le couloir étroit).
      const sessionBanner = sessionSection(sessionList, groupList);
      const main = STATE.isAdmin || hasJoinedGroup
        ? [characterSection, groupSection]
        : [groupSection, characterSection];
      const pseudo = STATE.profile?.pseudo || STATE.profile?.displayName || STATE.user?.displayName || String(STATE.user?.email || '').split('@')[0] || 'aventurier';
      const adventure = STATE.adventure?.nom || 'Aventure';
      const initials = adventure.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'A';
      const online = liveUids().size;
      const wall = isFeatureEnabled('bastion') ? wallSection() : '';
      root.innerHTML = `<div class="db-top"><button type="button" class="db-adv" data-action="openAdventureSwitcher"><span class="sig">${_esc(initials)}</span><b>${_esc(adventure)}</b><small>${icon('refresh-cw')}Changer</small></button><span class="db-hello">${STATE.isAdmin ? `<span class="db-on"><i></i>${online} joueur${online > 1 ? 's' : ''} connecté${online > 1 ? 's' : ''}</span>` : ''}<span>Bonsoir, <b>${_esc(pseudo)}</b>${STATE.isAdmin ? ' · Maître de jeu' : ''}</span></span></div>${sessionBanner}<div class="db-grid${wall ? '' : ' solo'}"><div class="db-col">${main.join('')}</div>${wall ? `<div class="db-col">${wall}</div>` : ''}</div>`;
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

    content.innerHTML = `<div class="hall-root">
    <section class="hall-command" aria-label="Navigation des hauts-faits">
      <div class="hall-command-in">
        <div class="hall-command-head">
          <div class="hall-command-title">
            <h1>Hauts-Faits</h1>
            <small>Galerie de campagne · ${total} ${total > 1 ? 'souvenirs' : 'souvenir'}</small>
          </div>
          <span class="hall-command-spacer"></span>
          ${STATE.isAdmin ? `<div class="hall-command-tools">
            <button class="hall-tool-btn" data-action="openAchievementCategoriesAdmin" title="Gérer les catégories" aria-label="Gérer les catégories de hauts-faits">
              <svg aria-hidden="true"><use href="./assets/img/icons.svg#icon-cog"/></svg>
              <span>Catégories</span>
            </button>
            <button class="hall-tool-btn hall-tool-btn--primary" data-action="openAchievementModal" title="Ajouter un haut-fait" aria-label="Ajouter un haut-fait">
              <span class="hall-tool-plus" aria-hidden="true">+</span>
              <span>Nouveau</span>
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
          <div class="hall-command-search">
            <label class="search-wrap" for="ach-search-input">
              <svg aria-hidden="true"><use href="./assets/img/icons.svg#icon-search"/></svg>
              <input type="search" placeholder="Rechercher un souvenir…" id="ach-search-input" aria-label="Rechercher dans les hauts-faits"
                value="${_esc(achState.search || '')}"
                data-input="_achSetSearch">
            </label>
          </div>
        </div>
        <div class="view-toggle" role="tablist" aria-label="Mode d'affichage des hauts-faits">
          <button class="view-tab${activeView === 'galerie' ? ' active' : ''}" data-action="_achSetView" data-val="galerie" role="tab" aria-selected="${activeView === 'galerie'}">▦ Galerie</button>
          <button class="view-tab${activeView === 'timeline' ? ' active' : ''}" data-action="_achSetView" data-val="timeline" role="tab" aria-selected="${activeView === 'timeline'}">⋮ Chronologie</button>
          <button class="view-tab${activeView === 'missions' ? ' active' : ''}" data-action="_achSetView" data-val="missions" role="tab" aria-selected="${activeView === 'missions'}">🎯 Missions</button>
        </div>
      </div>
    </section>
    <div class="hall-content">
      <div id="ach-content">${appSplashHtml('')}</div>
    </div>
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
        secondary: `data-action="_goToChar" data-id="${_esc(c.id)}" data-tab="sorts"`,
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
        since: u.createdAt || '',
        sinceLabel: u.createdAt ? new Date(u.createdAt).toLocaleDateString('fr', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
        chars: charNamesByUid.get(uid) || [],
        color: _CMJ_PALETTE[n % _CMJ_PALETTE.length],
        issue, issueItem, issueLabel, issueTone, issueAct, issueAttrs,
      };
    });

    // ── Réglages (13 modales, 5 groupes) ──
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
      { id: 'table', label: 'Table & VTT', items: [
        { t: 'Compétences de dés', s: 'Jets proposés aux joueurs', ic: 'dice', a: '#4f8cff', fn: '_ouvrirGestionDes', mod: 'histoire' },
        { t: 'États & conditions', s: 'Effets appliqués aux tokens', ic: 'drop', a: '#f97316', fn: '_vttConditionConfig', mod: 'vtt/vtt' },
        { t: 'Émotes VTT', s: 'Réactions sur la table', ic: 'smile', a: '#22c38e', fn: '_ouvrirGestionEmotes', mod: 'vtt/vtt' },
      ] },
      { id: 'cat', label: 'Catalogues', items: [
        { t: 'Catégories de hauts-faits', s: 'Galerie, filtres et couleurs', ic: 'trophy', a: '#e8b84b', fn: 'openAchievementCategoriesAdmin', mod: 'achievements', requires: 'achievements' },
        { t: 'Rangs du bestiaire', s: 'Menaces, filtres et couleurs', ic: 'skull', a: '#ff5a7e', fn: 'openBestiaryRanksAdmin', mod: 'bestiary', requires: 'bestiaire' },
      ] },
    ].map(g => ({ ...g, items: g.items.filter(x => !x.requires || isFeatureEnabled(x.requires)) })).filter(g => g.items.length);

    _cmjOpen({ adventure: adv.nom || 'Aventure', items, players: vmPlayers, settings: settingsGroups });
  },

  // ─── STATISTIQUES ─────────────────────────────────────────────────────────────
  async statistiques() {
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

    const data = await loadStats();
    if (revision !== _statsLoadRevision || !document.getElementById('stats-root')) return;
    _statsData = data || {};
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
      _statsEmoteUrl = new Map((emoteDoc?.emotes || []).filter(e => e?.name && e?.url).map(e => [e.name, e.url]));
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
    const name = btn.dataset.name || btn.closest('.stats-char')?.querySelector('.stats-char-name')?.textContent || _statsData?.chars?.[id]?.name || 'ce personnage';
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
            <button type="button" class="stats-date-delete" data-action="_statsDelChar" data-id="${_esc(id)}" data-date="${_esc(d)}" data-name="${_esc(c.name || 'Personnage')}" data-origin="dates-modal" title="Supprimer uniquement cette séance pour ce personnage">🗑 Supprimer cette séance</button>
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
    openModal(`📅 ${_esc(c.name || 'Personnage')}`, `<div class="stats-dates">${body}</div>`, {
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
    openModal(`🧾 Corriger ${_esc(c.name || 'Personnage')}`, `
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
  // Frise de séances : clic sur une chip → change la vue (sans relecture réseau).
  _statsSetScope: (btn) => { _statsRender(btn.dataset.scope || null); },
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
    const tab = btn.dataset.tab;
    if (!tab || tab === _statsTab) return;
    _statsTab = tab;
    _statsRender(_statsScope);
    document.getElementById('stats-root')?.scrollIntoView({ block: 'start' });
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
    const cssPage = { 'characters': 'characters', 'histoire': 'histoire', 'vtt/vtt': 'vtt' }[mod];
    if (cssPage) {
      try { const { _ensureFeatureCss } = await import('../core/navigation.js'); await _ensureFeatureCss(cssPage); } catch {}
    }
    if (window[fn]) { window[fn](); return; }
    await import(`./${mod}.js`);
    if (window[fn]) { window[fn](); return; }
    const proxy = document.createElement('button');
    proxy.dataset.action = fn;
    dispatchAction(proxy, new Event('click'));
  },
  _adminRelinkPlayer: (btn) => _adminRelinkPlayer(btn.dataset.oldUid, btn.dataset.newUid, btn.dataset.name),
  _adminMergeDuplicate: (btn) => _adminMergeDuplicate(btn.dataset.uids, btn.dataset.email),
  _adminMergeDuplicateConfirm: () => _adminMergeDuplicateConfirm(),
  _adminMergeDuplicateCancel: () => closeModalDirect(),
});

export default PAGES;
