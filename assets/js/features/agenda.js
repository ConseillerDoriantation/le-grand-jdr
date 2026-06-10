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
import { openModal, closeModal } from '../shared/modal.js';
import PAGES from './pages.js';
import { registerActions } from '../core/actions.js';

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
  showNotif('Pattern récurrent appliqué', 'success');
}
async function clearOverrides() {
  if (!_ag.myAvail) return;
  if (!confirm('Effacer toutes tes dispos ponctuelles (les patterns récurrents sont conservés) ?')) return;
  _ag.myAvail.slots = {};
  _scheduleSave();
  _renderCalendar();
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
  const myQuests = _planningGroups().filter(q => {
    if ((q.statut || 'active') !== 'active') return false; // seulement les groupes « En cours »
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
    if (!sugs.length) {
      return `<div class="ag-quest-card">
        <div class="ag-quest-hd">
          <span class="ag-quest-title">${_esc(q.titre || q.nom || 'Quête')}</span>
          <span class="ag-quest-count">${parts.length} participant${parts.length>1?'s':''}</span>
        </div>
        <div class="ag-quest-empty">Pas encore de créneau compatible. Demande aux joueurs de remplir leurs dispos.</div>
      </div>`;
    }
    return `<div class="ag-quest-card">
      <div class="ag-quest-hd">
        <span class="ag-quest-title">${_esc(q.titre || q.nom || 'Quête')}</span>
        <span class="ag-quest-count">${parts.length} participant${parts.length>1?'s':''}</span>
      </div>
      <div class="ag-sug-list">
        ${sugs.map((s, idx) => {
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
        }).join('')}
      </div>
    </div>`;
  }).join('');

  // Garder en mémoire la dernière computation pour le détail modal
  _ag._lastSugs = Object.fromEntries(myQuests.map(q => [q.id, _computeQuestSuggestions(q)]));
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

async function validateSlot(questId, iso, slotId) {
  if (!STATE.isAdmin) return;
  const quest = _ag.quests.find(q => q.id === questId);
  if (_isSlotValidated(questId, iso, slotId)) { closeModal(); return; }
  const entry = {
    questId,
    questTitle:  quest?.titre || quest?.nom || 'Groupe',
    date:        iso,
    slot:        slotId,
    // Membres du groupe concerné : seuls eux (+ le MJ) verront la séance.
    participantUids: _questParticipants(quest).map(p => p.uid).filter(Boolean),
    validatedAt: Date.now(),
    validatedBy: STATE.user?.uid || null,
  };
  try {
    await _saveSessions([..._validatedSessions(), entry]);
    closeModal();
    showNotif('✓ Créneau validé. Visible par le groupe concerné (et le MJ).', 'success');
    _renderSessionBanner();
    _renderSuggestions();
  } catch (e) {
    if (e?.code === 'permission-denied') {
      showNotif('⚠ Règle Firestore manquante pour agenda_session (voir doc).', 'error');
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
      ${multi ? `<div class="ag-banner-listhd">📌 ${sessions.length} créneaux validés</div>` : ''}
      ${sessions.map(s => {
        const fmt = _formatSession(s);
        if (!fmt) return '';
        return `<div class="ag-banner">
          <div class="ag-banner-ico">🎲</div>
          <div class="ag-banner-body">
            <div class="ag-banner-eyebrow">${multi ? 'Séance validée' : 'Prochaine séance validée'}</div>
            <div class="ag-banner-title">${_esc(fmt.dateFr)} — ${fmt.slotLabel} <span class="ag-banner-hours">${fmt.slotHours}</span></div>
            ${fmt.questTitle ? `<div class="ag-banner-quest">Groupe : ${_esc(fmt.questTitle)}</div>` : ''}
          </div>
          ${STATE.isAdmin ? `<button class="ag-banner-btn" data-action="_agUnvalidateSlot" data-quest-id="${_esc(s.questId || '')}" data-iso="${_esc(s.date || '')}" data-slot-id="${_esc(s.slot || '')}" title="Retirer ce créneau">✕</button>` : ''}
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
  `);
}
function cycleRecurringSlot(dayId, slotId, btn) {
  _cycleRecurring(dayId, slotId);
  const state = _ag.myAvail?.recurring?.[dayId]?.[slotId] || '';
  btn.className = `ag-rec-cell ag-slot--${state||'none'}`;
  btn.textContent = STATE_EMOJI[state] || '⚪';
  btn.title = STATE_LABELS[state] || 'Non renseigné';
  _renderCalendar();
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
  if (btn) btn.textContent = _ag.groupView ? '🙈 Masquer' : '👁 Afficher';
  _renderGroupView();
}
function setGroupFilter(groupId) {
  _ag.groupFilter = groupId || null;
  _renderGroupView();
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
  if (!confirm(`Supprimer définitivement ${legacy.length} ancienne(s) quête(s) autonome(s) ? La planification se base désormais sur les groupes de la Trame.`)) return;
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
  _ag.users       = [];
  _ag.nextSession = null;
  _ag.myAvail     = { slots: {}, recurring: {} };

  content.innerHTML = `
    <div class="ag-root">

      <div class="ag-hero">
        <div class="ag-hero-text">
          <h1 class="ag-hero-title">📅 Agenda du groupe</h1>
          <p class="ag-hero-sub">Marque tes dispos, on calcule les meilleurs créneaux pour vos prochaines sessions.</p>
        </div>
        <div class="ag-hero-actions">
          <button class="btn btn-gold" data-action="_agOpenRecurringEditor">📆 Mon planning récurrent</button>
          <span id="ag-legacy-cleanup"></span>
        </div>
      </div>

      <div id="ag-session-banner"></div>

      <section class="ag-section">
        <h2 class="ag-section-title">🎯 Sessions compatibles</h2>
        <p class="ag-section-sub">Top 5 créneaux par groupe « En cours » de la Trame, selon les dispos de leurs membres.</p>
        <div id="ag-suggestions" class="ag-suggestions"></div>
      </section>

      <section class="ag-section">
        <div class="ag-section-hd">
          <h2 class="ag-section-title">🗓 Mon calendrier</h2>
          <div class="ag-section-actions">
            <button class="btn btn-outline btn-sm" data-action="_agClearOverrides" title="Efface les dispos ponctuelles (les patterns récurrents restent)">🧹 Effacer ponctuelles</button>
          </div>
        </div>
        <p class="ag-section-sub">Clic sur un créneau pour cycler : <span class="ag-legend">⚪</span> rien → <span class="ag-legend ag-slot--ok">✅</span> ok → <span class="ag-legend ag-slot--maybe">❓</span> peut-être → <span class="ag-legend ag-slot--no">❌</span> non. Les créneaux <em>récurrents</em> sont automatiquement appliqués.</p>
        <div id="ag-calendar" class="ag-calendar"></div>
      </section>

      <section class="ag-section">
        <div class="ag-section-hd">
          <h2 class="ag-section-title">👥 Dispos du groupe</h2>
          <div class="ag-section-actions">
            <button class="btn btn-outline btn-sm" id="ag-group-toggle" data-action="_agToggleGroupView">👁 Afficher</button>
          </div>
        </div>
        <div id="ag-group-view" class="ag-group-view"></div>
      </section>

    </div>
  `;

  _renderSessionBanner();
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
    _renderSuggestions();
    _renderGroupView();
  });

  watchPageCollection('agenda-quests', 'quests', 'agenda', data => {
    _ag.quests = data;
    _scheduleQuestParticipantCleanup();
    _renderSuggestions();
    _renderGroupView();
    _renderLegacyCleanup();
  });

  watchPageCollection('agenda-users', 'users', 'agenda', data => {
    _ag.users = data;
    _scheduleQuestParticipantCleanup();
    _renderSuggestions();
    _renderGroupView();
  });

  watchPageDoc('agenda-session', 'agenda_session', 'next', 'agenda', data => {
    _ag.nextSession = data;
    _renderSessionBanner();
    _renderSuggestions();
  });
}

PAGES.agenda = renderAgendaPage;

registerActions({
  _agShowSugDetail:         (btn) => showSuggestionDetail(btn.dataset.id, Number(btn.dataset.idx)),
  _agUnvalidateSlot:        (btn) => unvalidateSlot(btn.dataset.questId, btn.dataset.iso, btn.dataset.slotId),
  _agValidateSlot:          (btn) => validateSlot(btn.dataset.questId, btn.dataset.iso, btn.dataset.slotId),
  _agCycle:                 (btn) => cycleAgendaSlot(btn.dataset.iso, btn.dataset.slot),
  _agRecCycle:              (btn) => cycleRecurringSlot(btn.dataset.day, btn.dataset.slot, btn),
  _agSetRecurringPattern:   (btn) => setRecurringPattern(btn.dataset.pattern),
  _agOpenRecurringEditor:   ()    => openRecurringEditor(),
  _agToggleGroupView:       ()    => toggleGroupView(),
  _agSetGroupFilter:        (btn) => setGroupFilter(btn.dataset.group),
  _agDeleteLegacyQuests:    ()    => deleteLegacyQuests(),
  _agClearOverrides:        ()    => clearOverrides(),
});
export default renderAgendaPage;
