import { STATE } from '../core/state.js';
import { navigate } from '../core/navigation.js';
import { registerActions } from '../core/actions.js';
import {
  loadChars, loadCollection, getCachedCollection, getDocData,
} from '../data/firestore.js';
import { loadStats } from '../shared/stats.js';
import { _esc, appSplashHtml } from '../shared/html.js';
import { characterAvatarHtml } from '../shared/portraits.js';
import { dedupeQuestParticipants } from '../shared/participants.js';
import { isFeatureEnabled } from '../shared/features.js';
import { lsJson } from '../shared/local-storage.js';
import PAGES, { requestStatsScope } from './pages.js';

const SLOT_META = {
  m: { label: 'Matin', hours: '9h-13h' },
  a: { label: 'Après-midi', hours: '14h-18h' },
  s: { label: 'Soir', hours: '19h-23h' },
};
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const AVAIL_META = {
  ok: { label: 'Disponible', cls: 'ok' },
  maybe: { label: 'Peut-être', cls: 'maybe' },
  no: { label: 'Indisponible', cls: 'no' },
  '': { label: 'Non renseigné', cls: 'missing' },
};

let STORE = {
  rootId: 'dashboard-session-center',
  adventureId: '',
  loaded: false,
  sessions: [],
  selectedKey: '',
  story: [],
  quests: [],
  chars: [],
  avails: [],
  stats: null,
};

function _todayKey() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function _dateLabel(dateKey, { short = false } = {}) {
  if (!dateKey) return 'Date à définir';
  const d = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString('fr-FR', short
    ? { day: '2-digit', month: 'short' }
    : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function _myUidAliases() {
  return new Set([
    STATE.user?.uid,
    ...(Array.isArray(STATE.profile?.previousUids) ? STATE.profile.previousUids : []),
    ...(Array.isArray(STATE.profile?.uidAliases) ? STATE.profile.uidAliases : []),
  ].filter(Boolean));
}

function _groupName(group = {}) {
  return (group.titre || group.nom || group.name || '').trim() || 'Groupe sans nom';
}

function _missionName(mission = {}, fallback = '') {
  return (mission.titre || mission.nom || fallback || '').trim() || 'Mission non reliée';
}

function _sessionHasStats(stats, dateKey) {
  return Object.values(stats?.chars || {}).some(c => c?.byDate?.[dateKey]);
}

function _visibleToCurrentUser(raw = {}, group = null) {
  if (STATE.isAdmin) return true;
  const aliases = _myUidAliases();
  if (Array.isArray(raw.participantUids) && raw.participantUids.length) {
    return raw.participantUids.some(uid => aliases.has(uid));
  }
  const parts = dedupeQuestParticipants(group?.participants || [], { uidAliases: [...aliases] });
  return !parts.length || parts.some(p => aliases.has(p.uid));
}

function _normalizeSessions({ agendaDoc, stats, quests, story }) {
  const questById = new Map((quests || []).map(q => [q.id, q]));
  const missionById = new Map((story || []).map(m => [m.id, m]));
  const map = new Map();
  const agendaSessions = Array.isArray(agendaDoc?.sessions)
    ? agendaDoc.sessions.filter(Boolean)
    : (agendaDoc?.date ? [agendaDoc] : []);

  agendaSessions.forEach((raw, index) => {
    const group = questById.get(raw.questId) || null;
    if (!_visibleToCurrentUser(raw, group)) return;
    const missionId = group?.missionId || raw.missionId || '';
    const mission = missionById.get(missionId) || null;
    const groupId = group?.id || raw.questId || '';
    const key = `agenda:${raw.date || 'undated'}:${groupId || index}:${raw.slot || ''}`;
    map.set(key, {
      key,
      source: 'agenda',
      date: raw.date || '',
      slot: raw.slot || '',
      missionId,
      mission,
      missionLabel: _missionName(mission, raw.missionTitle),
      groupId,
      group,
      groupLabel: group ? _groupName(group) : (raw.questTitle || 'Groupe non relié'),
      raw,
      hasStats: _sessionHasStats(stats, raw.date),
    });
  });

  const statsDates = new Set(Object.keys(stats?.sessions || {}));
  Object.values(stats?.chars || {}).forEach(c => {
    Object.keys(c?.byDate || {}).forEach(date => statsDates.add(date));
  });

  [...statsDates].forEach(date => {
    const raw = stats?.sessions?.[date] || {};
    const group = raw.groupId ? questById.get(raw.groupId) || null : null;
    if (!_visibleToCurrentUser({}, group)) return;
    const mission = raw.missionId ? missionById.get(raw.missionId) || null : null;
    const existing = [...map.values()].find(s =>
      s.date === date && (!raw.groupId || !s.groupId || s.groupId === raw.groupId));
    if (existing) {
      existing.hasStats = true;
      existing.statsRaw = raw;
      if (!existing.missionId && raw.missionId) {
        existing.missionId = raw.missionId;
        existing.mission = mission;
        existing.missionLabel = _missionName(mission, raw.mission);
      }
      return;
    }
    const key = `stats:${date}:${raw.groupId || 'none'}`;
    map.set(key, {
      key,
      source: 'stats',
      date,
      slot: '',
      missionId: raw.missionId || '',
      mission,
      missionLabel: _missionName(mission, raw.mission),
      groupId: raw.groupId || '',
      group,
      groupLabel: group ? _groupName(group) : (raw.group || 'Groupe non relié'),
      raw,
      hasStats: true,
    });
  });

  const today = _todayKey();
  return [...map.values()]
    .map(session => ({
      ...session,
      status: session.date === today
        ? 'today'
        : session.hasStats ? 'completed'
          : session.date && session.date < today ? 'past'
            : 'planned',
    }))
    .sort((a, b) => {
      const aFuture = a.status === 'planned' || a.status === 'today';
      const bFuture = b.status === 'planned' || b.status === 'today';
      if (aFuture !== bFuture) return aFuture ? -1 : 1;
      return aFuture
        ? (a.date || '9999').localeCompare(b.date || '9999')
        : (b.date || '').localeCompare(a.date || '');
    });
}

function _participantData(session) {
  const charById = new Map((STORE.chars || []).map(c => [c.id, c]));
  return dedupeQuestParticipants(session.group?.participants || []).map(p => {
    const char = p.charId ? charById.get(p.charId) : null;
    return {
      ...p,
      ...(char || {}),
      uid: char?.uid || p.uid || '',
      charId: char?.id || p.charId || '',
      nom: char?.nom || p.nom || '?',
    };
  });
}

function _availabilityState(participant, session) {
  if (!session.date || !session.slot) return '';
  const aliases = new Set([participant.uid, participant.id].filter(Boolean));
  const avail = (STORE.avails || []).find(a => aliases.has(a.uid || a.id));
  if (!avail) return '';
  const override = avail.slots?.[session.date]?.[session.slot];
  if (override) return override;
  const day = DAY_KEYS[new Date(`${session.date}T12:00:00`).getDay()];
  return avail.recurring?.[day]?.[session.slot] || '';
}

function _statsForDate(dateKey, allowedCharIds = null) {
  const out = {
    attacks: 0, hits: 0, damage: 0, heal: 0, spells: 0, rolls: 0, ko: 0, participants: 0,
  };
  const allowed = allowedCharIds?.size ? allowedCharIds : null;
  Object.entries(STORE.stats?.chars || {}).forEach(([id, c]) => {
    if (allowed && !allowed.has(id)) return;
    const data = c?.byDate?.[dateKey];
    if (!data) return;
    out.participants += 1;
    const combat = data.combat || {};
    out.attacks += Number(combat.attacks) || 0;
    out.hits += Number(combat.hits) || 0;
    out.damage += Number(combat.dmgDealt) || 0;
    out.heal += Number(combat.heal) || 0;
    out.spells += Number(combat.spellsCast) || 0;
    out.ko += Number(combat.kosDealt) || 0;
    Object.values(data.skills || {}).forEach(skill => {
      out.rolls += Number(skill?.rolls) || 0;
    });
  });
  return out;
}

function _sessionStatusMeta(session) {
  if (session.status === 'today') return { label: "Aujourd'hui", cls: 'today' };
  if (session.status === 'completed') return { label: 'Jouée', cls: 'done' };
  if (session.status === 'past') return { label: 'À clôturer', cls: 'warning' };
  return { label: 'Planifiée', cls: 'planned' };
}

function _sessionSelectorHtml() {
  if (!STORE.sessions.length) return '';
  return `<div class="sc-selector" role="tablist" aria-label="Choisir une séance">
    ${STORE.sessions.slice(0, 14).map(session => {
      const status = _sessionStatusMeta(session);
      return `<button class="sc-session-tab ${session.key === STORE.selectedKey ? 'active' : ''}"
        role="tab" aria-selected="${session.key === STORE.selectedKey}"
        data-action="_scSelectSession" data-key="${_esc(session.key)}">
        <span class="sc-session-tab-date">${_esc(_dateLabel(session.date, { short: true }))}</span>
        <span class="sc-session-tab-name">${_esc(session.groupLabel)}</span>
        <span class="sc-session-tab-status ${status.cls}">${status.label}</span>
      </button>`;
    }).join('')}
  </div>`;
}

function _avatarHtml(participant, size = 38) {
  return characterAvatarHtml(participant, {
    size,
    className: 'sc-avatar',
    title: participant.nom || '?',
    border: '2px solid var(--bg-panel)',
    background: 'rgba(79,140,255,.15)',
  });
}

function _issuesFor(session, participants, availCounts) {
  const issues = [];
  if (!session.missionId) issues.push({ text: 'Mission non reliée', action: 'story' });
  if (!session.groupId) issues.push({ text: 'Groupe non relié', action: 'story' });
  if (!participants.length) issues.push({ text: 'Aucun participant', action: 'story' });
  if (session.status === 'planned' && participants.length && availCounts.missing) {
    issues.push({ text: `${availCounts.missing} disponibilité${availCounts.missing > 1 ? 's' : ''} manquante${availCounts.missing > 1 ? 's' : ''}`, action: 'agenda' });
  }
  if (session.status === 'completed' && !session.missionId) {
    issues.push({ text: 'Statistiques à relier', action: 'stats' });
  }
  return issues;
}

function _renderSelectedSession() {
  const root = document.getElementById(STORE.rootId);
  if (!root) return;
  const session = STORE.sessions.find(s => s.key === STORE.selectedKey) || STORE.sessions[0];
  if (!session) {
    root.innerHTML = `
      <div class="sc-empty sc-empty-session">
        <div class="sc-empty-mark">◇</div>
        <div class="sc-empty-copy">
          <h2>Préparer la prochaine séance</h2>
          <p>Planifie une date, relie un groupe à sa mission, puis le récapitulatif se remplira automatiquement après le VTT.</p>
        </div>
        <div class="sc-empty-actions">
          ${isFeatureEnabled('agenda') ? '<button class="sc-empty-primary" data-action="_scNavigate" data-page="agenda">Planifier une séance</button>' : ''}
          ${isFeatureEnabled('story') ? '<button class="sc-empty-secondary" data-action="_scNavigate" data-page="story">Préparer la trame</button>' : ''}
        </div>
      </div>`;
    return;
  }

  STORE.selectedKey = session.key;
  lsJson.set(`session-center:${STATE.adventure?.id || 'default'}`, session.key);
  const participants = _participantData(session);
  const availCounts = { ok: 0, maybe: 0, no: 0, missing: 0 };
  const participantRows = participants.map(participant => {
    const state = session.status === 'planned' || session.status === 'today'
      ? _availabilityState(participant, session) : '';
    if (state) availCounts[state] += 1;
    else if (session.status === 'planned' || session.status === 'today') availCounts.missing += 1;
    const meta = AVAIL_META[state || ''];
    return `<div class="sc-participant">
      ${_avatarHtml(participant)}
      <span class="sc-participant-name">${_esc(participant.nom)}</span>
      ${(session.status === 'planned' || session.status === 'today')
        ? `<span class="sc-avail ${meta.cls}">${meta.label}</span>`
        : ''}
    </div>`;
  }).join('');

  const allowedIds = new Set(participants.map(p => p.charId).filter(Boolean));
  const stats = _statsForDate(session.date, allowedIds);
  const status = _sessionStatusMeta(session);
  const slot = SLOT_META[session.slot];
  const issues = _issuesFor(session, participants, availCounts);
  const hitRate = stats.attacks ? Math.round(stats.hits / stats.attacks * 100) : 0;
  const missionImage = session.mission?.imageUrl || '';
  const feature = page => isFeatureEnabled(page);

  root.innerHTML = `
    ${_sessionSelectorHtml()}

    <section class="sc-context ${missionImage ? 'has-image' : ''}">
      ${missionImage ? `<div class="sc-context-media"><img src="${_esc(missionImage)}" alt=""></div>` : ''}
      <div class="sc-context-main">
        <div class="sc-context-eyebrow">
          <span class="sc-status ${status.cls}">${status.label}</span>
          <span>${_esc(_dateLabel(session.date))}</span>
          ${slot ? `<span>${slot.label} · ${slot.hours}</span>` : ''}
        </div>
        <h1>${_esc(session.missionLabel)}</h1>
        <div class="sc-context-group">
          <span>${_esc(session.groupLabel)}</span>
          <span class="sc-avatar-stack">${participants.slice(0, 6).map(p => _avatarHtml(p, 30)).join('')}</span>
          <span>${participants.length} participant${participants.length > 1 ? 's' : ''}</span>
        </div>
      </div>
      <div class="sc-primary-actions">
        ${feature('vtt') ? `<button class="sc-enter-table" data-action="_scNavigate" data-page="vtt">
          <span class="sc-enter-table-icon" aria-hidden="true">▶</span>
          <span class="sc-enter-table-copy">
            <small>Table VTT</small>
            <strong>Entrer dans la table</strong>
          </span>
        </button>` : ''}
        ${session.missionId && feature('story') ? `<button class="btn btn-outline" data-action="_scOpenMission" data-id="${_esc(session.missionId)}">Voir la mission</button>` : ''}
      </div>
    </section>

    <nav class="sc-flow" aria-label="Cycle de la séance">
      <button data-action="_scNavigate" data-page="agenda" ${feature('agenda') ? '' : 'disabled'}>
        <span class="sc-flow-num">1</span><span><b>Préparer</b><small>Agenda et groupe</small></span>
      </button>
      <button data-action="_scNavigate" data-page="vtt" ${feature('vtt') ? '' : 'disabled'}>
        <span class="sc-flow-num">2</span><span><b>Jouer</b><small>Table virtuelle</small></span>
      </button>
      <button data-action="_scOpenStats" data-date="${_esc(session.date)}" ${feature('statistiques') ? '' : 'disabled'}>
        <span class="sc-flow-num">3</span><span><b>Conclure</b><small>Statistiques et récap</small></span>
      </button>
    </nav>

    <div class="sc-workspace">
      <section class="sc-pane sc-pane-prep">
        <header><span>Préparation</span><small>Avant la séance</small></header>
        <div class="sc-checks">
          <button class="${session.missionId ? 'done' : 'missing'}" data-action="_scOpenMission" data-id="${_esc(session.missionId)}" ${session.missionId && feature('story') ? '' : 'disabled'}>
            <span>${session.missionId ? '✓' : '!'}</span><b>Mission</b><small>${_esc(session.missionLabel)}</small>
          </button>
          <button class="${session.groupId ? 'done' : 'missing'}" data-action="_scOpenMission" data-id="${_esc(session.missionId)}" ${session.missionId && feature('story') ? '' : 'disabled'}>
            <span>${session.groupId ? '✓' : '!'}</span><b>Groupe</b><small>${_esc(session.groupLabel)}</small>
          </button>
          ${session.status === 'planned' || session.status === 'today' ? `
          <button class="${availCounts.no ? 'warning' : availCounts.missing ? 'missing' : 'done'}" data-action="_scNavigate" data-page="agenda" ${feature('agenda') ? '' : 'disabled'}>
            <span>${availCounts.no ? '!' : availCounts.missing ? '…' : '✓'}</span><b>Disponibilités</b>
            <small>${availCounts.ok} disponibles · ${availCounts.maybe} incertains · ${availCounts.missing} sans réponse</small>
          </button>` : ''}
        </div>
      </section>

      <section class="sc-pane sc-pane-party">
        <header><span>Participants</span><small>${participants.length} personnage${participants.length > 1 ? 's' : ''}</small></header>
        <div class="sc-participants">
          ${participantRows || '<div class="sc-pane-empty">Aucun personnage relié à ce groupe.</div>'}
        </div>
      </section>

      <section class="sc-pane sc-pane-results">
        <header><span>Résultats</span><small>${session.hasStats ? 'Données du VTT' : 'Après la séance'}</small></header>
        ${session.hasStats ? `<div class="sc-metrics">
          <div><strong>${stats.damage}</strong><span>Dégâts</span></div>
          <div><strong>${stats.heal}</strong><span>Soin</span></div>
          <div><strong>${stats.spells}</strong><span>Sorts</span></div>
          <div><strong>${stats.rolls}</strong><span>Jets</span></div>
          <div><strong>${hitRate}%</strong><span>Réussite</span></div>
          <div><strong>${stats.ko}</strong><span>KO</span></div>
        </div>
        ${feature('statistiques') ? `<button class="sc-text-action" data-action="_scOpenStats" data-date="${_esc(session.date)}">Ouvrir le récapitulatif complet →</button>` : ''}`
        : `<div class="sc-pane-empty">Les actions, soins, jets et événements seront rassemblés ici automatiquement.</div>`}
      </section>
    </div>

    <section class="sc-health ${issues.length ? 'has-issues' : 'is-ready'}">
      <header><span>${issues.length ? 'Points à vérifier' : 'Séance correctement reliée'}</span><small>${issues.length ? `${issues.length} action${issues.length > 1 ? 's' : ''}` : 'Aucune incohérence détectée'}</small></header>
      ${issues.length ? `<div class="sc-issues">${issues.map(issue => `
        <button data-action="${issue.action === 'stats' ? '_scOpenStats' : issue.action === 'story' ? '_scOpenMission' : '_scNavigate'}"
          ${issue.action === 'stats' ? `data-date="${_esc(session.date)}"` : issue.action === 'story' ? `data-id="${_esc(session.missionId)}"` : `data-page="${issue.action}"`}>
          <span>!</span>${_esc(issue.text)}<b>Corriger →</b>
        </button>`).join('')}</div>` : ''}
    </section>`;
}

let _mountSeq = 0;

export async function renderSessionCenterInto(rootId, context = {}) {
  const root = document.getElementById(rootId);
  if (!root) return;
  const mountSeq = ++_mountSeq;
  const adventureId = STATE.adventure?.id || 'default';
  if (STORE.adventureId === adventureId && STORE.loaded) {
    STORE.rootId = rootId;
    _renderSelectedSession();
  } else {
    root.innerHTML = appSplashHtml('Chargement des séances…');
  }
  const [agendaDoc, stats, quests, story, chars, avails] = await Promise.all([
    context.agendaDoc !== undefined
      ? Promise.resolve(context.agendaDoc)
      : getDocData('agenda_session', 'next').catch(() => null),
    context.stats !== undefined
      ? Promise.resolve(context.stats)
      : loadStats().catch(() => null),
    context.quests !== undefined
      ? Promise.resolve(context.quests)
      : loadCollection('quests').catch(() => []),
    context.story !== undefined
      ? Promise.resolve(context.story)
      : Promise.resolve(getCachedCollection('story') || loadCollection('story')).catch(() => []),
    context.chars !== undefined
      ? Promise.resolve(context.chars)
      : loadChars().catch(() => []),
    context.avails !== undefined
      ? Promise.resolve(context.avails)
      : loadCollection('availabilities').catch(() => []),
  ]);

  if (mountSeq !== _mountSeq || !document.getElementById(rootId)) return;
  if (context.chars === undefined && Array.isArray(chars) && chars.length) STATE.characters = chars;
  STORE = {
    rootId,
    adventureId,
    loaded: true,
    sessions: _normalizeSessions({ agendaDoc, stats, quests, story }),
    selectedKey: '',
    story: story || [],
    quests: quests || [],
    chars: chars || STATE.characters || [],
    avails: avails || [],
    stats,
  };
  const saved = lsJson.get(`session-center:${adventureId}`, '');
  STORE.selectedKey = STORE.sessions.some(s => s.key === saved) ? saved : (STORE.sessions[0]?.key || '');
  _renderSelectedSession();
}

registerActions({
  _scSelectSession: btn => {
    STORE.selectedKey = btn.dataset.key || '';
    _renderSelectedSession();
  },
  _scNavigate: btn => {
    const page = btn.dataset.page;
    if (page && isFeatureEnabled(page)) navigate(page);
  },
  _scOpenMission: async btn => {
    const id = btn.dataset.id;
    if (!id || !isFeatureEnabled('story')) return;
    await navigate('story');
    const { openStoryDetail } = await import('./story.js');
    openStoryDetail(id);
  },
  _scOpenStats: btn => {
    const date = btn.dataset.date;
    if (!date || !isFeatureEnabled('statistiques')) return;
    requestStatsScope(date);
    navigate('statistiques');
  },
});

// Ancien lien conservé uniquement pour rediriger les favoris et onglets déjà ouverts.
PAGES.sessions = () => navigate('dashboard');
