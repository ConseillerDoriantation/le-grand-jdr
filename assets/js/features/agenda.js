// ═══════════════════════════════════════════════════════════════════
// AGENDA — Disponibilités joueurs + propositions de session
//
// Données Firestore :
//   availabilities/{uid} = {
//     uid, pseudo, updatedAt,
//     recurring: { mon:{m,a,s}, tue:{...}, ..., sun:{...} },  // pattern hebdo
//     slots:     { 'yyyy-mm-dd': { m:'ok'|'maybe'|'no', a:..., s:... } } // overrides date
//   }
//
// État slot : '' (rien) | 'ok' | 'maybe' | 'no'
// 3 créneaux/jour : m=matin 9-13h, a=après-midi 14-18h, s=soir 19-23h
// ═══════════════════════════════════════════════════════════════════

import { STATE } from '../core/state.js';
import { saveDoc, deleteFromCol } from '../data/firestore.js';
import { tryDoc } from '../shared/crud.js';
import { watchPageCollection, watchPageDoc } from '../shared/realtime.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { _esc, appSplashHtml } from '../shared/html.js';
import { openModal, closeModal, confirmModal } from '../shared/modal.js';
import { navigate } from '../core/navigation.js';
import PAGES, { requestStatsScope } from './pages.js';
import { registerActions } from '../core/actions.js';
import { characterAvatarHtml } from '../shared/portraits.js';

// ── Constantes ────────────────────────────────────────────────────────────
const SLOTS = [
  { id: 'm', label: 'Matin',  emoji: '🌞', hours: '9h–13h' },
  { id: 'a', label: 'Aprem',  emoji: '☀️', hours: '14h–18h' },
  { id: 's', label: 'Soir',   emoji: '🌙', hours: '19h–23h' },
];
const DAYS = [
  { id: 'mon', label: 'Lun', long: 'Lundi'    },
  { id: 'tue', label: 'Mar', long: 'Mardi'    },
  { id: 'wed', label: 'Mer', long: 'Mercredi' },
  { id: 'thu', label: 'Jeu', long: 'Jeudi'    },
  { id: 'fri', label: 'Ven', long: 'Vendredi' },
  { id: 'sat', label: 'Sam', long: 'Samedi'   },
  { id: 'sun', label: 'Dim', long: 'Dimanche' },
];
const STATES = ['', 'ok', 'maybe', 'no'];
const STATE_LABELS = { '': 'Non renseigné', ok: 'Disponible', maybe: 'Peut-être', no: 'Indisponible' };
const STATE_EMOJI  = { '': '⚪', ok: '✅', maybe: '❓', no: '❌' };
const WEEKS_AHEAD = 4;

// ── State global module ───────────────────────────────────────────────────
let _ag = {
  myAvail:    null,             // ma dispo (objet Firestore)
  allAvails:  [],               // toutes les dispos (pour matching)
  quests:     [],               // toutes les quêtes
  users:      [],               // tous les utilisateurs (pour pseudos)
  groupView:  false,            // toggle vue groupe
  groupFilter:null,             // null = tous · sinon id de quête (= groupe de joueurs)
  saveTimer:  null,             // debounce sauvegarde
  nextSession:null,             // séance validée par le MJ (doc agenda_session/next)
};

// ── Helpers date ──────────────────────────────────────────────────────────
function _toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _today() { const d = new Date(); d.setHours(0,0,0,0); return d; }
function _addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function _weekdayKey(d) {
  // JS getDay() : 0=dim, 1=lun … 6=sam. On veut id 'mon','tue',...
  const map = ['sun','mon','tue','wed','thu','fri','sat'];
  return map[d.getDay()];
}
function _formatDateFr(d) {
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}
function _formatDateShort(d) {
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}
function _dateFromISO(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return null;
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function _uniq(arr = []) {
  return [...new Set((arr || []).filter(Boolean))];
}
function _emailKey(email = '') {
  return String(email || '').trim().toLowerCase();
}
function _userUid(u) {
  return (u && (u.uid || u.id)) || '';
}
function _userAliases(u) {
  if (!u) return [];
  return _uniq([
    u.id,
    u.uid,
    ...(Array.isArray(u.previousUids) ? u.previousUids : []),
    ...(Array.isArray(u.uidAliases) ? u.uidAliases : []),
  ]);
}
function _userForUid(uid) {
  if (!uid) return null;
  return (_ag.users || []).find(u => _userAliases(u).includes(uid)) || null;
}
// Membres de l'aventure courante sous forme d'objets {id,uid,pseudo,email}, dérivés
// du doc aventure (memberProfiles + tableaux d'uid) — sans lire la collection `users`.
function _membersFromAdventure() {
  const adv = STATE.adventure;
  if (!adv) return [];
  const profiles = adv.memberProfiles || {};
  const uids = _uniq([...(adv.admins || []), ...(adv.players || []), ...(adv.accessList || [])]);
  return uids.map(uid => {
    const p = profiles[uid];
    const prof = (p && typeof p === 'object') ? p : {};
    return { id: uid, uid, pseudo: prof.pseudo || '', email: prof.email || '' };
  });
}
function _uidIdentityKey(uid) {
  const user = _userForUid(uid);
  const email = _emailKey(user?.email);
  return email ? `email:${email}` : `uid:${uid || ''}`;
}
function _aliasesForIdentity(key) {
  const aliases = new Set();
  (_ag.users || []).forEach(u => {
    const uid = _userUid(u);
    if (!uid || _uidIdentityKey(uid) !== key) return;
    _userAliases(u).forEach(alias => aliases.add(alias));
  });
  (_ag.allAvails || []).forEach(a => {
    const uid = a.uid || a.id;
    if (uid && _uidIdentityKey(uid) === key) aliases.add(uid);
  });
  return aliases;
}
function _availabilityForUid(uid) {
  const key = _uidIdentityKey(uid);
  const aliases = _aliasesForIdentity(key);
  const candidates = (_ag.allAvails || []).filter(a => aliases.has(a.uid || a.id));
  if (!candidates.length) return null;
  return candidates.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
}
function _canonicalUserForIdentity(key) {
  const users = (_ag.users || []).filter(u => {
    const uid = _userUid(u);
    return uid && _uidIdentityKey(uid) === key;
  });
  if (!users.length) return null;
  const current = users.find(u => _userUid(u) === STATE.user?.uid);
  if (current) return current;
  return users.sort((a, b) => _userAliases(b).length - _userAliases(a).length)[0];
}
function _normalizedParticipant(p = {}) {
  const key = _uidIdentityKey(p.uid);
  const av = _availabilityForUid(p.uid);
  const user = _canonicalUserForIdentity(key);
  const uid = av?.uid || av?.id || _userUid(user) || p.uid;
  return {
    ...p,
    uid,
    nom: p.nom || user?.pseudo || av?.pseudo || '?',
  };
}
function _dedupeParticipants(parts = []) {
  const byKey = new Map();
  (Array.isArray(parts) ? parts : []).forEach(raw => {
    if (!raw?.uid) return;
    const p = _normalizedParticipant(raw);
    const key = _uidIdentityKey(raw.uid);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, p);
      return;
    }
    const pHasAvail = !!_availabilityForUid(p.uid);
    const prevHasAvail = !!_availabilityForUid(prev.uid);
    if (p.uid === STATE.user?.uid || (pHasAvail && !prevHasAvail)) byKey.set(key, { ...prev, ...p });
  });
  return [...byKey.values()];
}
function _questParticipants(quest = {}) {
  return _dedupeParticipants(quest.participants || []);
}
// Groupes de planification = groupes issus de la Trame (quêtes liées à une mission,
// statut « En cours »). Les anciennes quêtes autonomes (sans missionId) sont ignorées.
function _planningGroups() {
  return (_ag.quests || []).filter(q => q && q.missionId);
}
function _activePlanningGroups() {
  return _planningGroups().filter(q => (q.statut || 'active') === 'active');
}
// Anciennes quêtes autonomes (sans missionId) — à supprimer (on se base sur la Trame).
function _legacyQuests() {
  return (_ag.quests || []).filter(q => q && !q.missionId);
}
function _myUidAliases() {
  return _uniq([
    STATE.user?.uid,
    ...(Array.isArray(STATE.profile?.previousUids) ? STATE.profile.previousUids : []),
    ...(Array.isArray(STATE.profile?.uidAliases) ? STATE.profile.uidAliases : []),
  ]);
}
function _questHasMe(quest = {}) {
  const aliases = new Set(_myUidAliases());
  return (quest.participants || []).some(p => aliases.has(p?.uid));
}
function _participantHasAvailability(p = {}) {
  const av = _availabilityForUid(p.uid);
  if (!av) return false;
  return Boolean(
    Object.keys(av.slots || {}).length ||
    Object.keys(av.recurring || {}).length
  );
}
function _participantAvatar(p = {}, size = 28) {
  return characterAvatarHtml(p, {
    size,
    className: 'ag-avatar',
    title: p.nom || p.pseudo || '?',
    border: '2px solid rgba(255,255,255,.08)',
    background: 'rgba(79,140,255,.14)',
  });
}
function _formatBestSuggestion(sug) {
  if (!sug) return 'Aucun créneau exploitable';
  const date = sug.date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${date} · ${sug.slot.emoji} ${sug.slot.label}`;
}
let _cleanupTimer = null;
function _scheduleQuestParticipantCleanup() {
  if (!_ag.quests?.length || !_ag.users?.length) return;
  clearTimeout(_cleanupTimer);
  _cleanupTimer = setTimeout(_cleanupQuestParticipants, 300);
}
async function _cleanupQuestParticipants() {
  let changed = false;
  for (const q of _ag.quests || []) {
    const before = Array.isArray(q.participants) ? q.participants : [];
    const after = _dedupeParticipants(before);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    try {
      await saveDoc('quests', q.id, { participants: after });
      q.participants = after;
      changed = true;
    } catch (e) {
      console.warn('[agenda] nettoyage participants ignoré', q.id, e?.code || e);
    }
  }
  if (changed) {
    _renderAgendaOverview();
    _renderSuggestions();
    _renderGroupView();
  }
}

// ── Lecture : récupère l'état d'un slot (avec fallback récurrent) ─────────
function _slotState(avail, date, slotId) {
  if (!avail) return '';
  const iso = _toISO(date);
  const override = avail.slots?.[iso];
  if (override && override[slotId]) return override[slotId];
  // Fallback récurrent
  const wd = _weekdayKey(date);
  return avail.recurring?.[wd]?.[slotId] || '';
}

// ── Sauvegarde (debouncée) ────────────────────────────────────────────────
function _scheduleSave() {
  clearTimeout(_ag.saveTimer);
  _ag.saveTimer = setTimeout(_saveAvail, 600);
}
async function _saveAvail() {
  if (!_ag.myAvail || !STATE.user) return;
  const payload = {
    uid:        STATE.user.uid,
    pseudo:     STATE.profile?.pseudo || STATE.user.email || '?',
    recurring:  _ag.myAvail.recurring || {},
    slots:      _ag.myAvail.slots     || {},
    updatedAt:  Date.now(),
  };
  if (!await tryDoc('availabilities', STATE.user.uid, payload)) return;
  // Reflète localement dans allAvails pour le matching live
  const idx = _ag.allAvails.findIndex(a => a.uid === STATE.user.uid);
  if (idx >= 0) _ag.allAvails[idx] = { id: STATE.user.uid, ...payload };
  else _ag.allAvails.push({ id: STATE.user.uid, ...payload });
  _renderAgendaOverview();
  _renderSuggestions();
  _renderGroupView();
}

// ── Mutation : change l'état d'un slot pour une date donnée ───────────────
function _cycleSlot(dateISO, slotId) {
  if (!_ag.myAvail) _ag.myAvail = { slots: {}, recurring: {} };
  _ag.myAvail.slots = _ag.myAvail.slots || {};
  _ag.myAvail.slots[dateISO] = _ag.myAvail.slots[dateISO] || {};
  const cur = _ag.myAvail.slots[dateISO][slotId] || '';
  const next = STATES[(STATES.indexOf(cur) + 1) % STATES.length];
  if (next === '') delete _ag.myAvail.slots[dateISO][slotId];
  else _ag.myAvail.slots[dateISO][slotId] = next;
  // si l'objet date est vide, on le supprime
  if (Object.keys(_ag.myAvail.slots[dateISO]).length === 0) delete _ag.myAvail.slots[dateISO];
  _scheduleSave();
}
function _cycleRecurring(dayId, slotId) {
  if (!_ag.myAvail) _ag.myAvail = { slots: {}, recurring: {} };
  _ag.myAvail.recurring = _ag.myAvail.recurring || {};
  _ag.myAvail.recurring[dayId] = _ag.myAvail.recurring[dayId] || {};
  const cur = _ag.myAvail.recurring[dayId][slotId] || '';
  const next = STATES[(STATES.indexOf(cur) + 1) % STATES.length];
  if (next === '') delete _ag.myAvail.recurring[dayId][slotId];
  else _ag.myAvail.recurring[dayId][slotId] = next;
  if (Object.keys(_ag.myAvail.recurring[dayId]).length === 0) delete _ag.myAvail.recurring[dayId];
  _scheduleSave();
}

// ── Actions rapides ───────────────────────────────────────────────────────
function setRecurringPattern(preset) {
  if (!_ag.myAvail) _ag.myAvail = { slots: {}, recurring: {} };
  _ag.myAvail.recurring = {};
  const apply = (days, slots) => days.forEach(d => {
    _ag.myAvail.recurring[d] = _ag.myAvail.recurring[d] || {};
    slots.forEach(s => { _ag.myAvail.recurring[d][s] = 'ok'; });
  });
  if (preset === 'evenings')  apply(DAYS.map(d => d.id), ['s']);
  if (preset === 'weekends')  apply(['sat', 'sun'], ['m', 'a', 's']);
  if (preset === 'fri-eve')   apply(['fri'], ['s']);
  if (preset === 'reset')     _ag.myAvail.recurring = {};
  _scheduleSave();
  _renderCalendar();
  _renderAgendaOverview();
  showNotif('Pattern récurrent appliqué', 'success');
}
async function clearOverrides() {
  if (!_ag.myAvail) return;
  if (!await confirmModal('Effacer toutes tes dispos ponctuelles (les patterns récurrents sont conservés) ?', { title: 'Disponibilités', confirmLabel: 'Effacer' })) return;
  _ag.myAvail.slots = {};
  _scheduleSave();
  _renderCalendar();
  _renderAgendaOverview();
  showNotif('Dispos ponctuelles effacées', 'success');
}

// ── Calcul des suggestions par quête ──────────────────────────────────────
function _computeQuestSuggestions(quest, daysAhead = 28) {
  const parts = _questParticipants(quest);
  if (parts.length === 0) return [];

  const today = _today();
  const slots = [];

  for (let i = 0; i < daysAhead; i++) {
    const date = _addDays(today, i);
    const iso = _toISO(date);
    for (const slot of SLOTS) {
      const detail = parts.map(p => {
        const av = _availabilityForUid(p.uid);
        return { uid: p.uid, nom: p.nom, state: _slotState(av, date, slot.id) };
      });
      const okCount    = detail.filter(d => d.state === 'ok').length;
      const maybeCount = detail.filter(d => d.state === 'maybe').length;
      const noCount    = detail.filter(d => d.state === 'no').length;
      // un slot avec au moins un "no" est exclu
      if (noCount > 0) continue;
      // on garde seulement les slots où la majorité est ok
      if (okCount === 0 && maybeCount === 0) continue;
      slots.push({
        date, iso, slot, detail,
        okCount, maybeCount, total: parts.length,
        score: okCount * 10 - maybeCount * 1 - i * 0.1, // privilégie # ok, puis proximité, pénalise maybe
      });
    }
  }

  slots.sort((a, b) => b.score - a.score);
  return slots.slice(0, 5);
}

// ── Rendu : suggestions ──────────────────────────────────────────────────
function _renderSuggestions() {
  const el = document.getElementById('ag-suggestions');
  if (!el) return;
  const myQuests = _activePlanningGroups().filter(q => {
    if (STATE.isAdmin) return true; // MJ voit tout
    return _questHasMe(q);
  });

  if (!myQuests.length) {
    el.innerHTML = `<div class="ag-empty">
      <div class="ag-empty-ico">🎯</div>
      <div class="ag-empty-title">Aucun groupe « En cours » à planifier</div>
      <div class="ag-empty-sub">Crée/rejoins un groupe sur une mission de la Trame pour voir les créneaux compatibles ici.</div>
    </div>`;
    return;
  }

  el.innerHTML = myQuests.map(q => {
    const sugs = _computeQuestSuggestions(q);
    const parts = _questParticipants(q);
    const manualBtn = STATE.isAdmin
      ? `<button type="button" class="ag-quest-manual" data-action="_agOpenManualSession" data-quest-id="${_esc(q.id)}" title="Fixer une séance sans attendre les disponibilités">+ Date libre</button>`
      : '';
    const renderSuggestion = (s, idx) => {
      const isFull = s.okCount === s.total;
      const isValidated = _isSlotValidated(q.id, s.iso, s.slot.id);
      const cls = (isValidated ? 'ag-sug--validated ' : '') + (isFull ? 'ag-sug--full' : 'ag-sug--partial');
      const dateStr = _formatDateFr(s.date);
      return `<div class="ag-sug ${cls}" data-sug-idx="${idx}" data-quest-id="${q.id}"
        data-action="_agShowSugDetail" data-id="${q.id}" data-idx="${idx}">
        <div class="ag-sug-rank">${isValidated ? '✓' : (idx + 1)}</div>
        <div class="ag-sug-body">
          <div class="ag-sug-date">${_esc(dateStr)} <span class="ag-sug-slot">${s.slot.emoji} ${s.slot.label}</span>${isValidated ? ' <span class="ag-sug-badge">Validée</span>' : ''}</div>
          <div class="ag-sug-people">
            ${s.detail.map(d => `<span class="ag-sug-chip ag-sug-chip--${d.state||'none'}" title="${_esc(d.nom||'?')} : ${STATE_LABELS[d.state]||'?'}">${STATE_EMOJI[d.state]||'⚪'} ${_esc((d.nom||'?').slice(0,8))}</span>`).join('')}
          </div>
        </div>
        <div class="ag-sug-score">
          <span class="ag-sug-score-val">${s.okCount}/${s.total}</span>
          ${s.maybeCount ? `<span class="ag-sug-score-maybe">+${s.maybeCount}?</span>` : ''}
        </div>
      </div>`;
    };
    if (!sugs.length) {
      return `<div class="ag-quest-card">
        <div class="ag-quest-hd">
          <div class="ag-quest-main">
            <span class="ag-quest-title">${_esc(q.titre || q.nom || 'Quête')}</span>
            <span class="ag-quest-count">${parts.length} participant${parts.length>1?'s':''}</span>
          </div>
          ${manualBtn}
        </div>
        <div class="ag-quest-empty">Pas encore de créneau compatible. Le MJ peut fixer une date libre sans attendre les dispos.</div>
      </div>`;
    }
    return `<div class="ag-quest-card">
      <div class="ag-quest-hd">
        <div class="ag-quest-main">
          <span class="ag-quest-title">${_esc(q.titre || q.nom || 'Quête')}</span>
          <span class="ag-quest-count">${parts.length} participant${parts.length>1?'s':''}</span>
        </div>
        ${manualBtn}
      </div>
      <div class="ag-sug-list">
        ${renderSuggestion(sugs[0], 0)}
        ${sugs.length > 1 ? `<details class="ag-sug-more">
          <summary>Autres créneaux <span>${sugs.length - 1}</span></summary>
          <div class="ag-sug-more-list">${sugs.slice(1).map((s, i) => renderSuggestion(s, i + 1)).join('')}</div>
        </details>` : ''}
      </div>
    </div>`;
  }).join('');

  // Garder en mémoire la dernière computation pour le détail modal
  _ag._lastSugs = Object.fromEntries(myQuests.map(q => [q.id, _computeQuestSuggestions(q)]));
}

function _renderAgendaOverview() {
  const el = document.getElementById('ag-overview');
  if (!el) return;

  const visibleGroups = _activePlanningGroups().filter(q => STATE.isAdmin || _questHasMe(q));
  const sessions = _validatedSessions().filter(_sessionVisibleToMe);
  const memberKeys = new Map();
  visibleGroups.forEach(q => _questParticipants(q).forEach(p => {
    const key = _uidIdentityKey(p.uid);
    if (!memberKeys.has(key)) memberKeys.set(key, p);
  }));
  const members = [...memberKeys.values()];
  const withAvail = members.filter(_participantHasAvailability).length;
  const completeGroups = visibleGroups.filter(q => {
    const parts = _questParticipants(q);
    return parts.length > 0 && parts.every(_participantHasAvailability);
  }).length;
  const myFilledSlots = Object.values(_ag.myAvail?.slots || {}).reduce((sum, day) => sum + Object.keys(day || {}).length, 0);
  const myRecurringSlots = Object.values(_ag.myAvail?.recurring || {}).reduce((sum, day) => sum + Object.keys(day || {}).length, 0);

  const groupCards = visibleGroups.map(q => {
    const parts = _questParticipants(q);
    const filled = parts.filter(_participantHasAvailability).length;
    const missing = parts.filter(p => !_participantHasAvailability(p));
    const best = _computeQuestSuggestions(q, 28)[0];
    const isReady = parts.length > 0 && filled === parts.length && Boolean(best);
    return `
      <article class="ag-team-card${isReady ? ' is-ready' : ''}">
        <div class="ag-team-top">
          <div class="ag-team-title">${_esc(q.titre || q.nom || 'Groupe')}</div>
          <span class="ag-team-count">${filled}/${parts.length || 0}</span>
        </div>
        <div class="ag-team-avatars">
          ${parts.length
            ? parts.slice(0, 7).map(p => `<span class="${_participantHasAvailability(p) ? '' : 'is-missing'}">${_participantAvatar(p, 28)}</span>`).join('')
            : `<span class="ag-team-empty">Aucun membre</span>`}
          ${parts.length > 7 ? `<span class="ag-team-more">+${parts.length - 7}</span>` : ''}
        </div>
        ${parts.length ? `<div class="ag-team-names">${parts.slice(0, 4).map(p => _esc(p.nom || '?')).join(', ')}${parts.length > 4 ? ` +${parts.length - 4}` : ''}</div>` : ''}
        <div class="ag-team-best">
          <span>${best ? 'Meilleur créneau' : 'À compléter'}</span>
          <strong>${_esc(_formatBestSuggestion(best))}</strong>
        </div>
        ${missing.length ? `<div class="ag-team-missing">${missing.slice(0, 3).map(p => _esc(p.nom || '?')).join(', ')} ${missing.length > 3 ? `+${missing.length - 3}` : ''}</div>` : ''}
        <button type="button" class="ag-team-link" data-action="_agFocusGroup" data-group="${_esc(q.id)}">Voir les dispos</button>
      </article>`;
  }).join('');

  el.innerHTML = `
    <section class="ag-side-card ag-side-card--summary">
      <div class="ag-side-label">Pilotage</div>
      <div class="ag-kpis">
        <div class="ag-kpi"><strong>${visibleGroups.length}</strong><span>groupes actifs</span></div>
        <div class="ag-kpi"><strong>${completeGroups}</strong><span>groupes complets</span></div>
        <div class="ag-kpi"><strong>${withAvail}/${members.length || 0}</strong><span>joueurs renseignés</span></div>
        <div class="ag-kpi"><strong>${sessions.length}</strong><span>séances validées</span></div>
      </div>
      <div class="ag-my-status">
        <span>Mes dispos</span>
        <strong>${myFilledSlots} ponctuelle${myFilledSlots > 1 ? 's' : ''} · ${myRecurringSlots} récurrente${myRecurringSlots > 1 ? 's' : ''}</strong>
      </div>
    </section>
    <section class="ag-side-card">
      <div class="ag-side-head">
        <div>
          <div class="ag-side-label">Groupes à planifier</div>
          <div class="ag-side-sub">${STATE.isAdmin ? 'Tous les groupes actifs' : 'Tes groupes actifs'}</div>
        </div>
        <button class="ag-side-link" type="button" data-navigate="story">Trame →</button>
      </div>
      <div class="ag-team-list">
        ${groupCards || `<div class="ag-side-empty">Aucun groupe actif à planifier.</div>`}
      </div>
    </section>`;
}

function showSuggestionDetail(questId, idx) {
  const sug = _ag._lastSugs?.[questId]?.[idx];
  const quest = _ag.quests.find(q => q.id === questId);
  if (!sug || !quest) return;
  const date = _formatDateFr(sug.date);
  const isValidated = _isSlotValidated(questId, sug.iso, sug.slot.id);

  const mjActions = STATE.isAdmin ? `
    <div class="ag-detail-actions">
      ${isValidated
        ? `<button class="btn btn-outline" data-action="_agUnvalidateSlot" data-quest-id="${questId}" data-iso="${sug.iso}" data-slot-id="${sug.slot.id}">✕ Retirer ce créneau</button>`
        : `<button class="btn btn-gold" data-action="_agValidateSlot" data-quest-id="${questId}" data-iso="${sug.iso}" data-slot-id="${sug.slot.id}">✓ Valider ce créneau</button>`}
    </div>` : '';

  openModal(`🗓 ${_esc(quest.titre || 'Quête')}${isValidated ? ' — ✓ Validée' : ''}`, `
    <div class="ag-detail">
      <div class="ag-detail-date">${_esc(date)} — ${sug.slot.emoji} <strong>${sug.slot.label}</strong> <span style="color:var(--text-dim);font-weight:400;font-size:.85rem">(${sug.slot.hours})</span></div>
      <div class="ag-detail-stats">
        <span class="ag-detail-stat ag-detail-stat--ok"><strong>${sug.okCount}</strong> dispo${sug.okCount>1?'s':''}</span>
        ${sug.maybeCount ? `<span class="ag-detail-stat ag-detail-stat--maybe"><strong>${sug.maybeCount}</strong> peut-être</span>` : ''}
        <span class="ag-detail-stat ag-detail-stat--total">sur <strong>${sug.total}</strong></span>
      </div>
      <div class="ag-detail-list">
        ${sug.detail.map(d => `<div class="ag-detail-row ag-detail-row--${d.state||'none'}">
          <span class="ag-detail-emoji">${STATE_EMOJI[d.state]||'⚪'}</span>
          <span class="ag-detail-name">${_esc(d.nom||'?')}</span>
          <span class="ag-detail-state">${STATE_LABELS[d.state]||'Non renseigné'}</span>
        </div>`).join('')}
      </div>
      ${mjActions}
    </div>
  `);
}

// ── Helpers séances validées (plusieurs créneaux possibles) ───────────────
// agenda_session/next contient désormais { sessions: [ {questId,date,slot,…} ] }.
// Rétro-compat : ancien doc à plat {date,slot} → traité comme une liste de 1.
function _validatedSessions() {
  const ns = _ag.nextSession;
  if (!ns) return [];
  if (Array.isArray(ns.sessions)) return ns.sessions.filter(Boolean);
  if (ns.date && ns.slot) return [ns];
  return [];
}
function _sessionKey(s) { return `${s?.questId || ''}|${s?.date || ''}|${s?.slot || ''}`; }
function _isSlotValidated(questId, iso, slotId) {
  const k = `${questId}|${iso}|${slotId}`;
  return _validatedSessions().some(s => _sessionKey(s) === k);
}
async function _saveSessions(sessions) {
  if (sessions.length) {
    await saveDoc('agenda_session', 'next', { sessions });
    _ag.nextSession = { sessions };
  } else {
    await deleteFromCol('agenda_session', 'next');
    _ag.nextSession = null;
  }
}
function _formatSession(s) {
  if (!s || !s.date) return null;
  const slot = SLOTS.find(x => x.id === s.slot);
  const d = new Date(s.date + 'T12:00:00');
  return {
    dateFr: d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
    slotLabel: slot ? `${slot.emoji} ${slot.label}` : '',
    slotHours: slot?.hours || '',
    questTitle: s.questTitle || '',
  };
}

function _sessionQuest(s = {}) {
  return (_ag.quests || []).find(q => q.id === s.questId) || null;
}

function _agNormKey(value = '') {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function _agIsTerminalOutcome(value) {
  const key = _agNormKey(value);
  return ['terminee', 'termine', 'reussie', 'reussite', 'echouee', 'echec', 'abandonnee'].includes(key);
}

function _sessionClosureState(quest = {}) {
  const notes = String(quest?.notesReussite || quest?.notes || quest?.resolutionNotes || '').trim();
  const hasOutcome =
    _agIsTerminalOutcome(quest?.statut) ||
    (quest?.reussite !== undefined && quest?.reussite !== null && String(quest.reussite).trim() !== '');
  const closed = Boolean(hasOutcome && notes);
  return {
    closed,
    hasOutcome,
    hasNotes: Boolean(notes),
    label: closed ? 'Cloturee' : hasOutcome ? 'Notes a finaliser' : 'A cloturer',
    tone: closed ? 'done' : hasOutcome ? 'warn' : 'todo',
  };
}

function _sessionAvailabilitySummary(quest = {}, iso = '', slotId = '') {
  const date = _dateFromISO(iso);
  const members = _questParticipants(quest);
  const totals = { ok: 0, maybe: 0, no: 0, missing: 0 };
  if (!date || !slotId || !members.length) return totals;
  members.forEach(p => {
    const state = _slotState(_availabilityForUid(p.uid), date, slotId);
    if (state === 'ok') totals.ok += 1;
    else if (state === 'maybe') totals.maybe += 1;
    else if (state === 'no') totals.no += 1;
    else totals.missing += 1;
  });
  return totals;
}

function _sessionStateForDate(s = {}, quest = {}) {
  const closure = _sessionClosureState(quest);
  if (closure.closed) return closure;
  const d = _dateFromISO(s.date || '');
  const played = d && d < _today();
  if (!played && !closure.hasOutcome) return { ...closure, label: 'Planifiee', tone: 'planned' };
  return closure;
}

async function _openAgendaMission(missionId) {
  await navigate('story');
  if (!missionId) return;
  try {
    const story = await import('./story.js');
    story.openStoryDetail?.(missionId);
  } catch (e) {
    console.warn('[agenda] ouverture mission impossible', e);
  }
}

function _openAgendaStats(date) {
  requestStatsScope(date || null);
  navigate('statistiques');
}

function _buildSessionEntry(questId, iso, slotId, { manual = false } = {}) {
  const quest = _ag.quests.find(q => q.id === questId);
  return {
    questId,
    questTitle: quest?.titre || quest?.nom || 'Groupe',
    date: iso,
    slot: slotId,
    manual: Boolean(manual),
    participantUids: _questParticipants(quest).map(p => p.uid).filter(Boolean),
    validatedAt: Date.now(),
    validatedBy: STATE.user?.uid || null,
  };
}

function openManualSessionModal(questId) {
  if (!STATE.isAdmin) return;
  const quest = _ag.quests.find(q => q.id === questId);
  if (!quest) return;
  const todayISO = _toISO(_today());
  const participants = _questParticipants(quest);
  openModal(`Date libre · ${_esc(quest.titre || quest.nom || 'Groupe')}`, `
    <div class="ag-manual">
      <div class="ag-manual-note">
        Cette séance sera validée pour le groupe même si les joueurs n'ont pas rempli leurs disponibilités.
      </div>
      <label class="ag-manual-field">
        <span>Date</span>
        <input id="ag-manual-date" class="ag-manual-input" type="date" min="${todayISO}" value="${todayISO}">
      </label>
      <label class="ag-manual-field">
        <span>Créneau</span>
        <select id="ag-manual-slot" class="ag-manual-input">
          ${SLOTS.map(s => `<option value="${s.id}">${s.emoji} ${_esc(s.label)} · ${_esc(s.hours)}</option>`).join('')}
        </select>
      </label>
      <div class="ag-manual-members">
        <div class="ag-manual-members-title">${participants.length} participant${participants.length > 1 ? 's' : ''}</div>
        <div class="ag-manual-avatars">
          ${participants.length
            ? participants.map(p => _participantAvatar(p, 30)).join('')
            : `<span class="ag-manual-empty">Aucun membre dans ce groupe.</span>`}
        </div>
      </div>
      <div class="ag-detail-actions">
        <button type="button" class="btn btn-outline" data-action="_agCloseModal">Annuler</button>
        <button type="button" class="btn btn-gold" data-action="_agValidateManualSlot" data-quest-id="${_esc(questId)}">Valider cette date</button>
      </div>
    </div>
  `);
}

async function validateSlot(questId, iso, slotId) {
  if (!STATE.isAdmin) return;
  if (_isSlotValidated(questId, iso, slotId)) { closeModal(); return; }
  const entry = _buildSessionEntry(questId, iso, slotId);
  try {
    await _saveSessions([..._validatedSessions(), entry]);
    closeModal();
    showNotif('✓ Créneau validé. Visible par le groupe concerné (et le MJ).', 'success');
    _renderSessionBanner();
    _renderAgendaOverview();
    _renderSuggestions();
  } catch (e) {
    if (e?.code === 'permission-denied') {
      showNotif('⚠ Règle Firestore manquante pour agenda_session (voir doc).', 'error');
    } else {
      notifySaveError(e);
    }
  }
}

async function validateManualSlot(questId) {
  if (!STATE.isAdmin) return;
  const iso = document.getElementById('ag-manual-date')?.value || '';
  const slotId = document.getElementById('ag-manual-slot')?.value || '';
  if (!_dateFromISO(iso)) {
    showNotif('Choisis une date valide.', 'error');
    return;
  }
  if (!SLOTS.some(s => s.id === slotId)) {
    showNotif('Choisis un créneau valide.', 'error');
    return;
  }
  if (_isSlotValidated(questId, iso, slotId)) {
    showNotif('Ce créneau est déjà validé pour ce groupe.', 'info');
    return;
  }
  const entry = _buildSessionEntry(questId, iso, slotId, { manual: true });
  try {
    await _saveSessions([..._validatedSessions(), entry]);
    closeModal();
    showNotif('Date libre validée pour le groupe.', 'success');
    _renderSessionBanner();
    _renderAgendaOverview();
    _renderSuggestions();
  } catch (e) {
    if (e?.code === 'permission-denied') {
      showNotif('Règle Firestore manquante pour agenda_session.', 'error');
    } else {
      notifySaveError(e);
    }
  }
}

async function unvalidateSlot(questId, iso, slotId) {
  if (!STATE.isAdmin) return;
  const k = `${questId}|${iso}|${slotId}`;
  const next = _validatedSessions().filter(s => _sessionKey(s) !== k);
  try {
    await _saveSessions(next);
    closeModal();
    showNotif('Créneau retiré.', 'info');
    _renderSessionBanner();
    _renderAgendaOverview();
    _renderSuggestions();
  } catch (e) {
    if (e?.code === 'permission-denied') {
      showNotif('⚠ Règle Firestore manquante pour agenda_session.', 'error');
    } else { notifySaveError(e); }
  }
}

// Une séance validée n'est visible que par les membres du groupe concerné
// (participantUids) et le MJ. Fallback : pas de groupe enregistré → visible
// par tous (compat séances validées avant cette feature).
function _sessionVisibleToMe(s) {
  if (STATE.isAdmin) return true;
  const uids = s?.participantUids;
  if (!Array.isArray(uids) || !uids.length) return true;
  return _myUidAliases().some(uid => uids.includes(uid));
}

function _renderSessionBanner() {
  const el = document.getElementById('ag-session-banner');
  if (!el) return;
  const sessions = _validatedSessions()
    .filter(_sessionVisibleToMe)
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.slot || '').localeCompare(b.slot || ''));
  if (!sessions.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  const multi = sessions.length > 1;
  el.innerHTML = `
    <div class="ag-banner-list">
      ${multi ? `<div class="ag-banner-listhd">Sessions validées (${sessions.length})</div>` : ''}
      ${sessions.map(s => {
        const fmt = _formatSession(s);
        if (!fmt) return '';
        const quest = _sessionQuest(s) || {};
        const participants = _questParticipants(quest);
        const av = _sessionAvailabilitySummary(quest, s.date, s.slot);
        const state = _sessionStateForDate(s, quest);
        const groupTitle = quest?.titre || quest?.nom || fmt.questTitle || 'Groupe';
        return `<div class="ag-banner ag-session-card ag-session-card--${state.tone}">
          <div class="ag-session-date">
            <div class="ag-banner-eyebrow">${multi ? 'Session' : 'Prochaine session'}</div>
            <div class="ag-banner-title">${_esc(fmt.dateFr)}</div>
            <div class="ag-banner-hours">${fmt.slotLabel} ${_esc(fmt.slotHours)}</div>
          </div>
          <div class="ag-session-main">
            <div class="ag-session-top">
              <span class="ag-session-state ag-session-state--${state.tone}">${_esc(state.label)}</span>
              ${s.manual ? `<span class="ag-session-pill">Date MJ</span>` : ''}
            </div>
            <div class="ag-banner-quest">${_esc(groupTitle)}</div>
            <div class="ag-session-avatars" aria-label="${participants.length} participants">
              ${participants.length
                ? participants.slice(0, 6).map(p => _participantAvatar(p, 26)).join('') + (participants.length > 6 ? `<span class="ag-session-more">+${participants.length - 6}</span>` : '')
                : `<span class="ag-session-empty">Aucun participant</span>`}
            </div>
          </div>
          <div class="ag-session-readiness" title="Disponibilités sur ce créneau">
            <span class="is-ok">${av.ok} ok</span>
            <span class="is-maybe">${av.maybe} ?</span>
            <span class="is-no">${av.no} non</span>
            <span class="is-missing">${av.missing} sans dispo</span>
          </div>
          <div class="ag-session-actions">
            <button type="button" class="ag-session-action ag-session-action--primary" data-action="_agGoVtt">Table</button>
            ${quest?.missionId ? `<button type="button" class="ag-session-action" data-action="_agOpenMission" data-mission-id="${_esc(quest.missionId)}">${state.closed ? 'Voir clôture' : 'Mission'}</button>` : ''}
            <button type="button" class="ag-session-action" data-action="_agOpenStats" data-date="${_esc(s.date || '')}">Stats</button>
            ${STATE.isAdmin ? `<button class="ag-banner-btn" data-action="_agUnvalidateSlot" data-quest-id="${_esc(s.questId || '')}" data-iso="${_esc(s.date || '')}" data-slot-id="${_esc(s.slot || '')}" title="Retirer ce créneau">×</button>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

// ── Rendu : calendrier personnel ──────────────────────────────────────────
function _renderCalendar() {
  const el = document.getElementById('ag-calendar');
  if (!el) return;
  const today = _today();
  // Démarre au lundi de la semaine courante
  const firstDay = _addDays(today, -((today.getDay() + 6) % 7));
  const weeks = [];
  for (let w = 0; w < WEEKS_AHEAD; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) week.push(_addDays(firstDay, w * 7 + d));
    weeks.push(week);
  }

  el.innerHTML = `
    <div class="ag-cal-header">
      <div class="ag-cal-corner"></div>
      ${DAYS.map(d => `<div class="ag-cal-dayhdr">${d.label}</div>`).join('')}
    </div>
    ${weeks.map(week => `
      <div class="ag-cal-week">
        <div class="ag-cal-weeklbl">${_formatDateShort(week[0])}<br>—<br>${_formatDateShort(week[6])}</div>
        ${week.map(d => {
          const iso = _toISO(d);
          const isToday = iso === _toISO(today);
          const isPast = d < today;
          return `<div class="ag-cal-cell${isToday ? ' ag-cal-cell--today' : ''}${isPast ? ' ag-cal-cell--past' : ''}">
            <div class="ag-cal-date">${d.getDate()}</div>
            <div class="ag-cal-slots">
              ${SLOTS.map(s => {
                const state = _slotState(_ag.myAvail, d, s.id);
                const isExplicit = !!_ag.myAvail?.slots?.[iso]?.[s.id];
                return `<button class="ag-cal-slot ag-slot--${state||'none'}${isExplicit ? ' ag-slot--explicit' : ''}"
                  data-iso="${iso}" data-slot="${s.id}"
                  data-action="_agCycle" data-iso="${iso}" data-slot="${s.id}"
                  title="${s.emoji} ${s.label} (${s.hours}) — ${STATE_LABELS[state]||'Non renseigné'}${isExplicit?'':' (récurrent)'}">
                  <span class="ag-cal-slot-ico">${s.emoji}</span>
                </button>`;
              }).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>
    `).join('')}
  `;
}

function cycleAgendaSlot(iso, slotId) {
  _cycleSlot(iso, slotId);
  _renderCalendar();
  _renderAgendaOverview();
}

// ── Modal pattern récurrent ───────────────────────────────────────────────
function openRecurringEditor() {
  const rec = _ag.myAvail?.recurring || {};
  openModal('📆 Mon planning récurrent', `
    <div class="ag-rec-intro">
      Définis tes dispos par défaut pour chaque jour de la semaine.<br>
      <span style="color:var(--text-dim);font-size:.8rem">Tu pourras toujours surcharger une date précise dans le calendrier.</span>
    </div>
    <div class="ag-rec-table">
      <div class="ag-rec-hd">
        <div></div>
        ${SLOTS.map(s => `<div class="ag-rec-slot-hd"><span>${s.emoji}</span><small>${s.label}</small></div>`).join('')}
      </div>
      ${DAYS.map(d => `
        <div class="ag-rec-row">
          <div class="ag-rec-daylbl">${d.long}</div>
          ${SLOTS.map(s => {
            const state = rec[d.id]?.[s.id] || '';
            return `<button class="ag-rec-cell ag-slot--${state||'none'}"
              data-day="${d.id}" data-slot="${s.id}"
              data-action="_agRecCycle" data-day="${d.id}" data-slot="${s.id}"
              title="${STATE_LABELS[state]||'Non renseigné'}">${STATE_EMOJI[state]||'⚪'}</button>`;
          }).join('')}
        </div>`).join('')}
    </div>
    <div class="ag-rec-presets">
      <div class="ag-rec-presets-lbl">Raccourcis :</div>
      <button class="btn btn-outline btn-sm" data-action="_agSetRecurringPattern" data-pattern="evenings">🌙 Toutes mes soirées</button>
      <button class="btn btn-outline btn-sm" data-action="_agSetRecurringPattern" data-pattern="weekends">📅 Tous mes weekends</button>
      <button class="btn btn-outline btn-sm" data-action="_agSetRecurringPattern" data-pattern="fri-eve">🎲 Vendredi soir</button>
      <button class="btn btn-outline btn-sm" data-action="_agSetRecurringPattern" data-pattern="reset">🚫 Reset</button>
    </div>
  `, { subtitle: 'Tes disponibilités par défaut, semaine type', accent: '#22c38e' });
}
function cycleRecurringSlot(dayId, slotId, btn) {
  _cycleRecurring(dayId, slotId);
  const state = _ag.myAvail?.recurring?.[dayId]?.[slotId] || '';
  btn.className = `ag-rec-cell ag-slot--${state||'none'}`;
  btn.textContent = STATE_EMOJI[state] || '⚪';
  btn.title = STATE_LABELS[state] || 'Non renseigné';
  _renderCalendar();
  _renderAgendaOverview();
  _renderSuggestions();
}

// ── Vue groupe (qui est dispo quand) ──────────────────────────────────────
function _renderGroupView() {
  const el = document.getElementById('ag-group-view');
  if (!el) return;
  if (!_ag.groupView) { el.innerHTML = ''; return; }

  const today = _today();
  const firstDay = _addDays(today, -((today.getDay() + 6) % 7));
  const days = [];
  for (let i = 0; i < 14; i++) days.push(_addDays(firstDay, i));

  const playersByIdentity = new Map();
  [...(_ag.users || []), ...(_ag.allAvails || [])].forEach(raw => {
    const uid = raw.uid || raw.id;
    if (!uid) return;
    const key = _uidIdentityKey(uid);
    const av = _availabilityForUid(uid);
    const user = _canonicalUserForIdentity(key);
    const canonicalUid = av?.uid || av?.id || _userUid(user) || uid;
    const prev = playersByIdentity.get(key);
    const player = {
      id: canonicalUid,
      uid: canonicalUid,
      pseudo: user?.pseudo || av?.pseudo || raw.pseudo || '?',
    };
    if (!prev || canonicalUid === STATE.user?.uid || (!prev.hasAvail && av)) {
      playersByIdentity.set(key, { ...player, hasAvail: !!av });
    }
  });
  let players = [...playersByIdentity.values()]
    .filter(p => !_myUidAliases().includes(p.uid)); // hors moi (j'ai déjà mon calendrier)

  // ── Compartimentation : groupes « En cours » de la Trame (quêtes liées). ──
  const quests = _planningGroups().filter(q => (q.statut || 'active') === 'active' && _questParticipants(q).length);
  // Si le groupe filtré n'existe plus, revenir à « Tous »
  if (_ag.groupFilter && !quests.some(q => q.id === _ag.groupFilter)) _ag.groupFilter = null;
  if (_ag.groupFilter) {
    const q = quests.find(x => x.id === _ag.groupFilter);
    const memberKeys = new Set(_questParticipants(q).map(p => _uidIdentityKey(p.uid)));
    players = players.filter(p => memberKeys.has(_uidIdentityKey(p.id || p.uid)));
  }

  const filtersHtml = quests.length ? `
    <div class="ag-grp-filters">
      <button type="button" class="ag-grp-filter ${!_ag.groupFilter ? 'is-active' : ''}"
        data-action="_agSetGroupFilter" data-group="">👥 Tous</button>
      ${quests.map(q => `<button type="button" class="ag-grp-filter ${_ag.groupFilter===q.id ? 'is-active' : ''}"
        data-action="_agSetGroupFilter" data-group="${_esc(q.id)}">${_esc(q.titre||q.nom||'Quête')}
        <span class="ag-grp-filter-count">${_questParticipants(q).length}</span></button>`).join('')}
    </div>` : '';

  if (!players.length) {
    el.innerHTML = filtersHtml + `<div class="ag-quest-empty" style="margin-top:.6rem">Aucun joueur dans ce groupe (hors toi).</div>`;
    return;
  }

  el.innerHTML = filtersHtml + `
    <div class="ag-grp-scroll">
      <table class="ag-grp-table">
        <thead>
          <tr>
            <th class="ag-grp-namecell">Joueur</th>
            ${days.map(d => `<th class="ag-grp-daycell">
              <div class="ag-grp-dlabel">${DAYS[(d.getDay()+6)%7].label}</div>
              <div class="ag-grp-dnum">${d.getDate()}/${d.getMonth()+1}</div>
            </th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${players.map(p => {
            const uid = p.id || p.uid;
            const av = _availabilityForUid(uid);
            return `<tr>
              <td class="ag-grp-namecell">${_esc(p.pseudo || '?')}</td>
              ${days.map(d => {
                const cells = SLOTS.map(s => {
                  const st = _slotState(av, d, s.id);
                  return `<span class="ag-grp-slot ag-slot--${st||'none'}" title="${s.label} : ${STATE_LABELS[st]||'?'}"></span>`;
                }).join('');
                return `<td class="ag-grp-daycell"><div class="ag-grp-slots">${cells}</div></td>`;
              }).join('')}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}
function toggleGroupView() {
  _ag.groupView = !_ag.groupView;
  const btn = document.getElementById('ag-group-toggle');
  if (btn) btn.textContent = _ag.groupView ? 'Masquer' : 'Afficher';
  _renderGroupView();
}
function setGroupFilter(groupId) {
  _ag.groupFilter = groupId || null;
  _renderGroupView();
}
function focusGroupAvailability(groupId) {
  _ag.groupView = true;
  _ag.groupFilter = groupId || null;
  const btn = document.getElementById('ag-group-toggle');
  if (btn) btn.textContent = 'Masquer';
  _renderGroupView();
  document.getElementById('ag-group-view')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Bouton MJ de nettoyage des anciennes quêtes autonomes (sans missionId).
function _renderLegacyCleanup() {
  const el = document.getElementById('ag-legacy-cleanup');
  if (!el) return;
  const n = STATE.isAdmin ? _legacyQuests().length : 0;
  el.innerHTML = n
    ? `<button class="btn btn-outline" data-action="_agDeleteLegacyQuests" title="Supprimer les anciennes quêtes (on planifie désormais via les groupes de la Trame)">🧹 Supprimer ${n} ancienne${n > 1 ? 's' : ''} quête${n > 1 ? 's' : ''}</button>`
    : '';
}

async function deleteLegacyQuests() {
  if (!STATE.isAdmin) return;
  const legacy = _legacyQuests();
  if (!legacy.length) return;
  if (!await confirmModal(`Supprimer définitivement ${legacy.length} ancienne(s) quête(s) autonome(s) ?<br><span style="opacity:.75;font-size:.85em">La planification se base désormais sur les groupes de la Trame.</span>`, { title: 'Anciennes quêtes', confirmLabel: 'Supprimer' })) return;
  let done = 0;
  for (const q of legacy) {
    try { await deleteFromCol('quests', q.id); done++; }
    catch (e) { console.warn('[agenda] suppression quête', q.id, e?.code || e); }
  }
  showNotif(done ? `${done} ancienne(s) quête(s) supprimée(s).` : 'Aucune suppression.', done ? 'success' : 'error');
  // La subscription temps réel met à jour _ag.quests et les rendus.
}

// ── Page principale ───────────────────────────────────────────────────────
async function renderAgendaPage() {
  const content = document.getElementById('main-content');
  if (!content) return;
  content.innerHTML = appSplashHtml("Chargement de l'agenda…");

  // Pas de fetch initial : on s'appuie entièrement sur les watches ci-dessous.
  // - quests + agenda_session sont session-live (0 lecture supplémentaire).
  // - availabilities + users sont page-scoped, le 1er fire des watches fait
  //   le rendu initial. Avec la persistance IndexedDB, c'est instantané sur
  //   cache chaud (et 1 seule lecture quand il faut aller au serveur).
  _ag.allAvails   = [];
  _ag.quests      = [];
  // Membres/pseudos dérivés du doc aventure (memberProfiles) — plus de lecture de
  // la collection globale `users` (refusée au MJ NON super-admin par les règles).
  _ag.users       = _membersFromAdventure();
  _ag.nextSession = null;
  _ag.myAvail     = { slots: {}, recurring: {} };

  content.innerHTML = `
    <div class="ag-root">

      <header class="ag-hero">
        <div class="ag-hero-text">
          <div class="ag-eyebrow">Planification</div>
          <h1 class="ag-hero-title">Agenda</h1>
          <p class="ag-hero-sub">Disponibilités, groupes de trame et validation des prochaines séances.</p>
        </div>
        <div class="ag-hero-actions">
          <button class="ag-primary-action" data-action="_agOpenRecurringEditor">📆 Planning récurrent</button>
          <span id="ag-legacy-cleanup"></span>
        </div>
      </header>

      <div class="ag-layout">
        <aside class="ag-rail">
          <div id="ag-session-banner"></div>
          <div id="ag-overview"></div>
        </aside>

        <main class="ag-workbench">
          <section class="ag-section ag-panel ag-calendar-panel">
            <div class="ag-section-hd">
              <div>
                <h2 class="ag-section-title">Mon calendrier</h2>
                <p class="ag-section-sub">Clique un créneau pour passer de libre à peut-être, indisponible, puis non renseigné.</p>
              </div>
              <div class="ag-section-actions">
                <button class="btn btn-outline btn-sm" data-action="_agClearOverrides" title="Efface les dispos ponctuelles (les patterns récurrents restent)">Effacer ponctuelles</button>
              </div>
            </div>
            <div class="ag-state-strip" aria-hidden="true">
              <span><i class="ag-legend ag-slot--ok">✓</i> Disponible</span>
              <span><i class="ag-legend ag-slot--maybe">?</i> Peut-être</span>
              <span><i class="ag-legend ag-slot--no">×</i> Indisponible</span>
              <span><i class="ag-legend ag-slot--none"></i> Non renseigné</span>
            </div>
            <div id="ag-calendar" class="ag-calendar"></div>
          </section>

          <section class="ag-section ag-panel">
            <div class="ag-section-hd">
              <div>
                <h2 class="ag-section-title">Créneaux recommandés</h2>
                <p class="ag-section-sub">Les meilleurs choix par groupe actif, classés selon les disponibilités des membres.</p>
              </div>
            </div>
            <div id="ag-suggestions" class="ag-suggestions"></div>
          </section>

          <section class="ag-section ag-panel ag-group-panel">
            <div class="ag-section-hd">
              <div>
                <h2 class="ag-section-title">Vue de groupe</h2>
                <p class="ag-section-sub">Lecture détaillée sur deux semaines, utile pour départager un créneau.</p>
              </div>
              <div class="ag-section-actions">
                <button class="btn btn-outline btn-sm" id="ag-group-toggle" data-action="_agToggleGroupView">Afficher</button>
              </div>
            </div>
            <div id="ag-group-view" class="ag-group-view"></div>
          </section>
        </main>
      </div>

    </div>
  `;

  _renderSessionBanner();
  _renderAgendaOverview();
  _renderSuggestions();
  _renderCalendar();
  _renderGroupView();

  // ── Abonnements temps réel ───────────────────────────────────────────────
  // Le 1er fire fait le rendu initial. Pour quests + agenda_session qui sont
  // session-live (cf. firestore.js), c'est servi du cache mémoire → 0 lecture.
  // Pour availabilities + users : 1 fetch initial puis deltas seulement.
  // Note: `_ag.myAvail` est piloté par mes propres clics (debounce 600ms),
  // on ne le touche pas dans les watches pour ne pas écraser une édition en cours.
  watchPageCollection('agenda-avails', 'availabilities', 'agenda', data => {
    _ag.allAvails = data;
    if (_ag.myAvail && (!_ag.myAvail.slots || !Object.keys(_ag.myAvail.slots).length)) {
      const mine = _availabilityForUid(STATE.user?.uid);
      if (mine) _ag.myAvail = mine;
    }
    _scheduleQuestParticipantCleanup();
    _renderCalendar();
    _renderAgendaOverview();
    _renderSuggestions();
    _renderGroupView();
  });

  watchPageCollection('agenda-quests', 'quests', 'agenda', data => {
    _ag.quests = data;
    _scheduleQuestParticipantCleanup();
    _renderAgendaOverview();
    _renderSuggestions();
    _renderGroupView();
    _renderLegacyCleanup();
  });

  // (Pseudos des membres : dérivés du doc aventure via _membersFromAdventure() —
  // plus d'abonnement à la collection globale `users`, qui n'est listable que par
  // le super-admin global et provoquait un "Accès refusé" + chargement infini chez
  // un MJ non super-admin.)

  watchPageDoc('agenda-session', 'agenda_session', 'next', 'agenda', data => {
    _ag.nextSession = data;
    _renderSessionBanner();
    _renderAgendaOverview();
    _renderSuggestions();
  });
}

PAGES.agenda = renderAgendaPage;

registerActions({
  _agShowSugDetail:         (btn) => showSuggestionDetail(btn.dataset.id, Number(btn.dataset.idx)),
  _agOpenManualSession:     (btn) => openManualSessionModal(btn.dataset.questId),
  _agValidateManualSlot:    (btn) => validateManualSlot(btn.dataset.questId),
  _agCloseModal:            ()    => closeModal(),
  _agUnvalidateSlot:        (btn) => unvalidateSlot(btn.dataset.questId, btn.dataset.iso, btn.dataset.slotId),
  _agValidateSlot:          (btn) => validateSlot(btn.dataset.questId, btn.dataset.iso, btn.dataset.slotId),
  _agGoVtt:                 ()    => navigate('vtt'),
  _agOpenMission:           (btn) => _openAgendaMission(btn.dataset.missionId),
  _agOpenStats:             (btn) => _openAgendaStats(btn.dataset.date),
  _agCycle:                 (btn) => cycleAgendaSlot(btn.dataset.iso, btn.dataset.slot),
  _agRecCycle:              (btn) => cycleRecurringSlot(btn.dataset.day, btn.dataset.slot, btn),
  _agSetRecurringPattern:   (btn) => setRecurringPattern(btn.dataset.pattern),
  _agOpenRecurringEditor:   ()    => openRecurringEditor(),
  _agToggleGroupView:       ()    => toggleGroupView(),
  _agSetGroupFilter:        (btn) => setGroupFilter(btn.dataset.group),
  _agFocusGroup:            (btn) => focusGroupAvailability(btn.dataset.group),
  _agDeleteLegacyQuests:    ()    => deleteLegacyQuests(),
  _agClearOverrides:        ()    => clearOverrides(),
});
export default renderAgendaPage;
