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
import { saveDoc, replaceDoc, deleteFromCol } from '../data/firestore.js';
import { watchPageCollection, watchPageDoc } from '../shared/realtime.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { _esc, appSplashHtml } from '../shared/html.js';
import { openModal, closeModal, confirmModal } from '../shared/modal.js';
import { navigate } from '../core/navigation.js';
import PAGES, { requestStatsScope } from './pages.js';
import { registerActions } from '../core/actions.js';
import { characterAvatarHtml } from '../shared/portraits.js';
import { mergeRecurringPreset, suggestionPresentation, weekDatesFrom } from './agenda-utils.js';
import { agendaSessionsFromDoc, isAgendaSessionUpcoming, moveAgendaSession } from '../shared/agenda-sessions.js';

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
const CYCLE = STATES;                       // clic = cycle vide → dispo → peut-être → indispo
const STATE_LABELS = { '': 'Non renseigné', ok: 'Disponible', maybe: 'Peut-être', no: 'Indisponible' };
const STATE_EMOJI  = { '': '⚪', ok: '✅', maybe: '❓', no: '❌' };
const STATE_PIP    = { '': '·', ok: '✓', maybe: '?', no: '✕' };
// Pinceau : la dernière couleur posée (ou une couleur verrouillée). Sert au
// glissé et au remplissage en lot ; le clic simple fait toujours le cycle.
const BRUSHES = [
  { v: 'ok',    label: 'Dispo',     key: '1' },
  { v: 'maybe', label: 'Peut-être', key: '2' },
  { v: 'no',    label: 'Indispo',   key: '3' },
  { v: '',      label: 'Effacer',   key: '4' },
];
// Palette de teintes de groupe, dérivée de tokens (jamais de couleur en dur).
const GROUP_TINTS = ['var(--ember)', 'var(--arcane)', 'var(--emerald)', 'var(--gold)', 'var(--amber)', 'var(--crimson)', 'var(--blue)'];

// ── State global module ───────────────────────────────────────────────────
let _ag = {
  myAvail:    null,             // ma dispo (objet Firestore)
  allAvails:  [],               // toutes les dispos (pour matching)
  quests:     [],               // toutes les quêtes
  users:      [],               // tous les utilisateurs (pour pseudos)
  groupView:  false,            // toggle vue groupe (legacy, conservé)
  groupFilter:null,             // scope groupe planifié (null = tous)
  saveTimer:  null,             // debounce sauvegarde
  saveStatusTimer: null,        // masque le statut après une sauvegarde réussie
  saveRevision: 0,              // évite qu'une ancienne écriture masque une édition plus récente
  savePending: false,           // une écriture est en attente (à flusher au pagehide)
  myAvailLoaded: false,         // ma dispo sauvegardée a été chargée une fois (pas ré-adoptée ensuite)
  nextSession:null,             // séance validée par le MJ (doc agenda_session/next)
  calMonthOffset: 0,            // mois affiché (0 = mois courant)
  calWeekOffset: 0,             // (legacy) semaine affichée sur petit écran
  // ── UI refonte ──
  tab:        'planning',       // planning | cand | players
  role:       'mj',             // mj | player (aperçu ; écritures gardées par STATE.isAdmin)
  recOpen:    false,            // semaine type dépliée
  brush:      'ok',             // couleur du pinceau
  armed:      false,            // pinceau verrouillé (chaque clic pose la couleur)
  dragging:   false,            // glissé en cours
  dragVal:    null,             // valeur posée pendant le glissé
  lastRow:    null,             // dernière ligne peinte (anti-répétition)
  cmp:        [],               // clés de créneaux comparés (2-3)
  inputBound: false,            // listeners pinceau/tooltip installés une seule fois
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
function _formatDatePill(d) {
  // « sam. 12 sept. » compact pour les pastilles de créneaux
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
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

function _slotSource(avail, date, slotId) {
  const iso = _toISO(date);
  if (avail?.slots?.[iso]?.[slotId]) return 'explicit';
  if (avail?.recurring?.[_weekdayKey(date)]?.[slotId]) return 'recurring';
  return 'none';
}

// ── Sauvegarde (debouncée) ────────────────────────────────────────────────
function _setSaveStatus(state = '') {
  const el = document.getElementById('ag-save-status');
  if (!el) return;
  clearTimeout(_ag.saveStatusTimer);
  const config = {
    pending: { text: 'Modifications…', icon: '●' },
    saving:  { text: 'Enregistrement…', icon: '↻' },
    saved:   { text: 'Enregistré', icon: '✓' },
    error:   { text: 'Échec de sauvegarde', icon: '!' },
  }[state];
  el.className = `ag-save-status${state ? ` is-${state}` : ''}`;
  el.innerHTML = config ? `<span aria-hidden="true">${config.icon}</span> ${config.text}` : '';
  if (state === 'error') el.title = 'La sauvegarde a échoué. Modifie un créneau pour réessayer.';
  else el.removeAttribute('title');
  if (state === 'saved') {
    const revision = _ag.saveRevision;
    _ag.saveStatusTimer = setTimeout(() => {
      if (revision === _ag.saveRevision) _setSaveStatus('');
    }, 1800);
  }
}

function _cloneAvailabilityMap(map = {}) {
  return Object.fromEntries(Object.entries(map || {}).map(([key, value]) => [key, { ...(value || {}) }]));
}

function _scheduleSave() {
  clearTimeout(_ag.saveTimer);
  const revision = ++_ag.saveRevision;
  _ag.savePending = true;
  _setSaveStatus('pending');
  _ag.saveTimer = setTimeout(() => _saveAvail(revision), 600);
}
async function _saveAvail(revision = _ag.saveRevision) {
  if (!_ag.myAvail || !STATE.user) return;
  if (revision === _ag.saveRevision) _setSaveStatus('saving');
  const payload = {
    uid:        STATE.user.uid,
    pseudo:     STATE.profile?.pseudo || STATE.user.email || '?',
    recurring:  _cloneAvailabilityMap(_ag.myAvail.recurring),
    slots:      _cloneAvailabilityMap(_ag.myAvail.slots),
    updatedAt:  Date.now(),
  };
  // replaceDoc (setDoc SANS merge) : le merge Firestore fait un deep-merge des
  // maps → retirer un créneau de `slots` ne l'effaçait jamais côté serveur. On
  // écrit le doc complet, donc l'écrasement est correct ET propage les suppressions.
  try {
    await replaceDoc('availabilities', STATE.user.uid, payload);
  } catch (e) {
    notifySaveError(e);
    if (revision === _ag.saveRevision) _setSaveStatus('error');
    return;
  }
  if (revision === _ag.saveRevision) _ag.savePending = false;
  // Reflète localement dans allAvails pour le matching live
  const idx = _ag.allAvails.findIndex(a => a.uid === STATE.user.uid);
  if (idx >= 0) _ag.allAvails[idx] = { id: STATE.user.uid, ...payload };
  else _ag.allAvails.push({ id: STATE.user.uid, ...payload });
  if (revision === _ag.saveRevision) _setSaveStatus('saved');
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

// Setters « impose une valeur » (pinceau) — pas de sauvegarde par cellule :
// le commit a lieu au pointerup / lot (1 écriture Firestore, jamais 21).
function _setSlotVal(dateISO, slotId, val) {
  if (!_ag.myAvail) _ag.myAvail = { slots: {}, recurring: {} };
  _ag.myAvail.slots = _ag.myAvail.slots || {};
  _ag.myAvail.slots[dateISO] = _ag.myAvail.slots[dateISO] || {};
  if (val) _ag.myAvail.slots[dateISO][slotId] = val;
  else delete _ag.myAvail.slots[dateISO][slotId];
  if (Object.keys(_ag.myAvail.slots[dateISO]).length === 0) delete _ag.myAvail.slots[dateISO];
}
function _setRecVal(dayId, slotId, val) {
  if (!_ag.myAvail) _ag.myAvail = { slots: {}, recurring: {} };
  _ag.myAvail.recurring = _ag.myAvail.recurring || {};
  _ag.myAvail.recurring[dayId] = _ag.myAvail.recurring[dayId] || {};
  if (val) _ag.myAvail.recurring[dayId][slotId] = val;
  else delete _ag.myAvail.recurring[dayId][slotId];
  if (Object.keys(_ag.myAvail.recurring[dayId]).length === 0) delete _ag.myAvail.recurring[dayId];
}

// ── Actions rapides ───────────────────────────────────────────────────────
async function setRecurringPattern(preset) {
  if (!_ag.myAvail) _ag.myAvail = { slots: {}, recurring: {} };
  if (preset === 'reset') {
    const hasRecurring = Object.keys(_ag.myAvail.recurring || {}).length > 0;
    if (!hasRecurring) return;
    if (!await confirmModal('Réinitialiser toute ta semaine type ? Tes exceptions ponctuelles seront conservées.', {
      title: 'Planning récurrent',
      confirmLabel: 'Réinitialiser',
    })) return;
    _ag.myAvail.recurring = {};
  } else {
    _ag.myAvail.recurring = mergeRecurringPreset(_ag.myAvail.recurring, preset);
  }
  _scheduleSave();
  _renderCalendar();
  _renderAgendaOverview();
  _renderSuggestions();
  _syncRecurringEditor();
  showNotif(preset === 'reset' ? 'Semaine type réinitialisée' : 'Disponibilités ajoutées à la semaine type', 'success');
}
async function clearOverrides() {
  if (!_ag.myAvail) return;
  if (!Object.keys(_ag.myAvail.slots || {}).length) {
    showNotif('Aucune exception ponctuelle à effacer', 'info');
    return;
  }
  if (!await confirmModal('Effacer toutes tes exceptions ponctuelles ? Ton planning récurrent sera conservé.', { title: 'Disponibilités', confirmLabel: 'Effacer' })) return;
  _ag.myAvail.slots = {};
  clearTimeout(_ag.saveTimer);
  await _saveAvail(++_ag.saveRevision);   // sauvegarde immédiate : un reload rapide ne ré-ajoute pas
  _renderCalendar();
  _renderAgendaOverview();
  showNotif('Exceptions ponctuelles effacées', 'success');
}

// ── Calcul des suggestions par quête ──────────────────────────────────────
function _computeQuestSuggestions(quest, daysAhead = 28, limit = 6) {
  const parts = _questParticipants(quest);
  if (parts.length === 0) return [];

  const today = _today();
  const slots = [];
  // Résout la dispo de chaque participant UNE seule fois (résolution d'alias =
  // coûteuse) au lieu de la refaire pour chaque créneau (28 jours × 3 moments).
  const avails = parts.map(p => ({ p, av: _availabilityForUid(p.uid) }));

  for (let i = 0; i < daysAhead; i++) {
    const date = _addDays(today, i);
    const iso = _toISO(date);
    for (const slot of SLOTS) {
      const detail = avails.map(({ p, av }) => ({ uid: p.uid, nom: p.nom, state: _slotState(av, date, slot.id) }));
      const okCount    = detail.filter(d => d.state === 'ok').length;
      const maybeCount = detail.filter(d => d.state === 'maybe').length;
      const noCount    = detail.filter(d => d.state === 'no').length;
      const missingCount = Math.max(0, parts.length - okCount - maybeCount - noCount);
      // un slot avec au moins un "no" est exclu
      if (noCount > 0) continue;
      // On conserve les pistes où quelqu'un est au moins disponible ou hésitant ;
      // le score et le libellé distinguent ensuite majorité réelle et réponses manquantes.
      if (okCount === 0 && maybeCount === 0) continue;
      slots.push({
        date, iso, slot, detail,
        okCount, maybeCount, noCount, missingCount, total: parts.length,
        score: okCount * 10 + maybeCount * 2 - missingCount * 3 - i * 0.1,
      });
    }
  }

  slots.sort((a, b) => b.score - a.score);
  return slots.slice(0, limit);
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

  const MX_SYM = { ok: '✓', maybe: '?', no: '✕', '': '' };
  if (!_ag._sugPick) _ag._sugPick = {};
  const legend = `<div class="ag-sg-legend">
    <span class="ag-sg-lg ag-sg-lg--ok">Dispo</span>
    <span class="ag-sg-lg ag-sg-lg--maybe">Peut-être</span>
    <span class="ag-sg-lg ag-sg-lg--no">Non</span>
    <span class="ag-sg-lg ag-sg-lg--none">Pas répondu</span>
  </div>`;

  const computed = {}; // réutilisé pour _ag._lastSugs → pas de double calcul
  const cards = myQuests.map(q => {
    const sugs = computed[q.id] = _computeQuestSuggestions(q);
    const parts = _questParticipants(q);
    const manualBtn = STATE.isAdmin
      ? `<button type="button" class="ag-quest-manual" data-action="_agOpenManualSession" data-quest-id="${_esc(q.id)}" title="Fixer une séance sans attendre les disponibilités">+ Date libre</button>`
      : '';
    const head = `<div class="ag-quest-hd">
      <div class="ag-quest-main">
        <span class="ag-quest-title">${_esc(q.titre || q.nom || 'Quête')}</span>
        <span class="ag-quest-count">${parts.length} participant${parts.length>1?'s':''}</span>
      </div>
      ${manualBtn}
    </div>`;
    if (!sugs.length) {
      return `<div class="ag-quest-card">${head}
        <div class="ag-quest-empty">Pas encore de créneau compatible.${STATE.isAdmin ? ' Fixe une date libre sans attendre les dispos.' : ''}</div>
      </div>`;
    }
    // ── Dates candidates cliquables + créneau vedette avec portraits ──
    const cols = sugs.slice(0, 6);
    const sel = Math.min(Math.max(_ag._sugPick[q.id] || 0, 0), cols.length - 1);
    const chips = cols.map((s, idx) => {
      const status = suggestionPresentation(s, _isSlotValidated(q.id, s.iso, s.slot.id));
      const cls = (idx === sel ? 'is-sel ' : '') + `st-${status.key}`;
      return `<button type="button" class="ag-sg-chip ${cls}" data-action="_agPickSug" data-id="${q.id}" data-idx="${idx}"
        title="${_esc(_formatDateFr(s.date))} — ${s.slot.label} · ${s.okCount}/${s.total} disponibles · ${status.label}">
        <span class="ag-sg-chip-d">${_esc(_formatDatePill(s.date))}</span>
        <span class="ag-sg-chip-s">${s.slot.emoji}</span>
        <span class="ag-sg-chip-n">${s.okCount}/${s.total}${status.key === 'val' ? ' ✓' : ''}</span>
      </button>`;
    }).join('');

    const s = cols[sel];
    const isVal = _isSlotValidated(q.id, s.iso, s.slot.id);
    const status = suggestionPresentation(s, isVal);
    const roster = parts.map((p, j) => {
      const st = s.detail[j]?.state || '';
      return `<div class="ag-sg-av ag-sg-av--${st || 'none'}" title="${_esc(p.nom || '?')} — ${STATE_LABELS[st] || 'Pas répondu'}">
        <div class="ag-sg-avwrap">${_participantAvatar(p, 38)}${MX_SYM[st] ? `<span class="ag-sg-badge">${MX_SYM[st]}</span>` : ''}</div>
        <span class="ag-sg-avname">${_esc(p.nom || '?')}</span>
      </div>`;
    }).join('');
    const mjBtn = STATE.isAdmin
      ? (isVal
          ? `<button type="button" class="ag-sg-act ag-sg-act--off" data-action="_agUnvalidateSlot" data-quest-id="${q.id}" data-iso="${s.iso}" data-slot-id="${s.slot.id}">✕ Retirer</button>`
          : `<button type="button" class="ag-sg-act" data-action="_agValidateSlot" data-quest-id="${q.id}" data-iso="${s.iso}" data-slot-id="${s.slot.id}">✓ Valider ce créneau</button>`)
      : '';

    return `<div class="ag-quest-card ag-sg-card">${head}
      <div class="ag-sg-dates">${chips}</div>
      <div class="ag-sg-hero st-${status.key}">
        <div class="ag-sg-heroline">
          <span class="ag-sg-herodate">${_esc(_formatDateFr(s.date))}</span>
          <span class="ag-sg-heroslot">${s.slot.emoji} ${s.slot.label}</span>
          <span class="ag-sg-heroscore">${s.okCount}/${s.total}${s.maybeCount ? ` <i>+${s.maybeCount} peut-être</i>` : ''}${s.missingCount ? ` <small>· ${s.missingCount} sans réponse</small>` : ''}</span>
          <span class="ag-sg-status st-${status.key}">${status.label}</span>
        </div>
        <div class="ag-sg-roster">${roster}</div>
        ${mjBtn}
      </div>
    </div>`;
  }).join('');
  el.innerHTML = legend + cards;

  _ag._lastSugs = computed; // détail modal réutilise le calcul déjà fait
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
        ${sug.missingCount ? `<span class="ag-detail-stat"><strong>${sug.missingCount}</strong> sans réponse</span>` : ''}
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
  return agendaSessionsFromDoc(_ag.nextSession);
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

// État d'une SÉANCE, indépendant de la mission : à venir / aujourd'hui / passée
// / jouée. Le MJ marque « jouée » d'un clic. Cet état ne réclame JAMAIS la
// clôture de la mission (autre cycle, cf. _missionHint) : une séance peut être
// finie sans que la mission le soit.
function _sessionState(s = {}) {
  const d = _dateFromISO(s.date || '');
  if (!d) return { key: 'past', label: 'Passée', tone: 'past' };
  const today = _today();
  if (d > today) return { key: 'upcoming', label: 'À venir', tone: 'planned' };
  if (s.done && (d < today || s.doneAt)) return { key: 'done', label: 'Jouée', tone: 'done' };
  if (d.getTime() === today.getTime()) return { key: 'today', label: "Aujourd'hui", tone: 'today' };
  if (d < today) return { key: 'past', label: 'Passée', tone: 'past' };
  return { key: 'past', label: 'Passée', tone: 'past' };
}

// Une séance est « à venir » (zone principale) si elle n'est pas jouée et que sa
// date n'est pas passée. Tout le reste (passé, jouée) part dans l'historique
// replié → le rail ne grossit plus indéfiniment.
function _sessionIsUpcoming(s = {}) {
  return isAgendaSessionUpcoming(s, _toISO(_today()));
}

// Info mission (secondaire, non bloquante) : simple lien vers la trame, jamais
// un rappel « à clôturer » posé sur la séance.
function _missionHint(quest = {}) {
  if (!quest?.missionId) return null;
  const closure = _sessionClosureState(quest);
  return { closed: closure.closed, label: closure.closed ? 'Mission clôturée' : 'Mission en cours' };
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

async function _handleExistingValidation(questId, iso, slotId, { close = false } = {}) {
  const existing = _validatedSessions().find(s => _sessionKey(s) === `${questId}|${iso}|${slotId}`);
  if (!existing) return false;

  const date = _dateFromISO(iso);
  if (date && date >= _today()) {
    const quest = _ag.quests.find(q => q.id === questId);
    const restored = await _mutateSession(questId, iso, slotId, {
      done: false,
      doneAt: null,
      questTitle: quest?.titre || quest?.nom || existing.questTitle || 'Groupe',
      participantUids: _questParticipants(quest).map(p => p.uid).filter(Boolean),
    });
    if (restored) {
      closeModal();
      showNotif(existing.done
        ? 'Séance reprogrammée dans les prochaines séances.'
        : 'Programmation confirmée dans les prochaines séances.', 'success');
    }
    return true;
  }

  const state = _sessionState(existing);
  _renderSessions();
  showNotif(state.key === 'past' || state.key === 'done'
    ? 'Ce créneau est déjà validé, mais classé dans l’historique des séances.'
    : 'Ce créneau est déjà validé pour ce groupe.', 'info');
  if (close) closeModal();
  return true;
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
  if (await _handleExistingValidation(questId, iso, slotId, { close: true })) return;
  const entry = _buildSessionEntry(questId, iso, slotId);
  try {
    await _saveSessions([..._validatedSessions(), entry]);
    closeModal();
    showNotif('✓ Créneau validé. Visible par le groupe concerné (et le MJ).', 'success');
    _renderSessions();
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
  if (await _handleExistingValidation(questId, iso, slotId)) return;
  const entry = _buildSessionEntry(questId, iso, slotId, { manual: true });
  try {
    await _saveSessions([..._validatedSessions(), entry]);
    closeModal();
    showNotif('Date libre validée pour le groupe.', 'success');
    _renderSessions();
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
    _renderSessions();
    _renderAgendaOverview();
    _renderSuggestions();
  } catch (e) {
    if (e?.code === 'permission-denied') {
      showNotif('⚠ Règle Firestore manquante pour agenda_session.', 'error');
    } else { notifySaveError(e); }
  }
}

// ── Cycle de vie d'une séance (MJ) : jouée / rétablie, et édition date+créneau ──
// La séance est identifiée par sa clé questId|date|slot. Éditer la date/créneau
// change la clé → on repère l'entrée par son ancienne clé puis on la remplace.
async function _mutateSession(questId, iso, slotId, patch) {
  if (!STATE.isAdmin) return false;
  const k = `${questId}|${iso}|${slotId}`;
  const next = _validatedSessions().map(s => (_sessionKey(s) === k ? { ...s, ...patch } : s));
  try {
    await _saveSessions(next);
    _renderSessions();
    _renderAgendaOverview();
    _renderSuggestions();
    return true;
  } catch (e) {
    if (e?.code === 'permission-denied') showNotif('⚠ Règle Firestore manquante pour agenda_session.', 'error');
    else notifySaveError(e);
    return false;
  }
}

async function markSessionDone(questId, iso, slotId, done) {
  const ok = await _mutateSession(questId, iso, slotId, {
    done: Boolean(done),
    doneAt: done ? Date.now() : null,
  });
  if (ok) showNotif(done ? '✓ Séance marquée jouée (rangée dans l’historique).' : 'Séance remise à venir.', done ? 'success' : 'info');
}

function openEditSessionModal(questId, iso, slotId) {
  if (!STATE.isAdmin) return;
  const s = _validatedSessions().find(x => _sessionKey(x) === `${questId}|${iso}|${slotId}`);
  if (!s) return;
  const quest = _ag.quests.find(q => q.id === questId);
  const title = quest?.titre || quest?.nom || s.questTitle || 'Groupe';
  openModal(`Modifier la séance · ${_esc(title)}`, `
    <div class="ag-manual">
      <label class="ag-manual-field">
        <span>Date</span>
        <input id="ag-edit-date" class="ag-manual-input" type="date" value="${_esc(iso)}">
      </label>
      <label class="ag-manual-field">
        <span>Créneau</span>
        <select id="ag-edit-slot" class="ag-manual-input">
          ${SLOTS.map(x => `<option value="${x.id}" ${x.id === slotId ? 'selected' : ''}>${x.emoji} ${_esc(x.label)} · ${_esc(x.hours)}</option>`).join('')}
        </select>
      </label>
      <div class="ag-detail-actions">
        <button type="button" class="btn btn-outline" data-action="_agCloseModal">Annuler</button>
        <button type="button" class="btn btn-gold" data-action="_agConfirmEditSession" data-quest-id="${_esc(questId)}" data-iso="${_esc(iso)}" data-slot-id="${_esc(slotId)}">Enregistrer</button>
      </div>
    </div>
  `);
}

async function confirmEditSession(questId, oldIso, oldSlot) {
  if (!STATE.isAdmin) return;
  const newIso = document.getElementById('ag-edit-date')?.value || '';
  const newSlot = document.getElementById('ag-edit-slot')?.value || '';
  if (!_dateFromISO(newIso)) { showNotif('Choisis une date valide.', 'error'); return; }
  if (!SLOTS.some(x => x.id === newSlot)) { showNotif('Choisis un créneau valide.', 'error'); return; }
  if (newIso === oldIso && newSlot === oldSlot) { closeModal(); return; }
  const sessions = _validatedSessions();
  const reopensSession = _dateFromISO(newIso) >= _today();
  const moved = moveAgendaSession({ sessions }, {
    questId,
    date: oldIso,
    slot: oldSlot,
  }, {
    date: newIso,
    slot: newSlot,
  }, {
    reopen: reopensSession,
  });
  if (moved.duplicate) {
    showNotif('Une séance existe déjà sur ce créneau pour ce groupe.', 'error');
    return;
  }
  if (!moved.moved) {
    showNotif('Cette séance a changé entre-temps. Recharge l’agenda avant de recommencer.', 'error');
    return;
  }
  try {
    await _saveSessions(moved.sessions);
    closeModal();
    showNotif(moved.reopened ? 'Séance déplacée et remise dans les prochaines séances.' : 'Séance mise à jour.', 'success');
    _renderSessions();
    _renderAgendaOverview();
    _renderSuggestions();
  } catch (e) {
    if (e?.code === 'permission-denied') showNotif('⚠ Règle Firestore manquante pour agenda_session.', 'error');
    else notifySaveError(e);
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

function _renderSessions() {
  _renderSessionBanner();
  _renderSessionHistory();
}

function _sessionCardHtml(s, primary) {
  const fmt = _formatSession(s);
  if (!fmt) return '';
  const quest = _sessionQuest(s) || {};
  const participants = _questParticipants(quest);
  const av = _sessionAvailabilitySummary(quest, s.date, s.slot);
  const state = _sessionState(s);
  const mission = _missionHint(quest);
  const group = quest?.titre || quest?.nom || fmt.questTitle || 'Groupe';
  const admin = STATE.isAdmin;
  const dq = `data-quest-id="${_esc(s.questId || '')}" data-iso="${_esc(s.date || '')}" data-slot-id="${_esc(s.slot || '')}"`;
  return `<article class="ag-sess ag-sess--${state.tone}${primary ? ' ag-sess--primary' : ''}">
    <div class="ag-sess-when">
      <div class="ag-sess-date">${_esc(fmt.dateFr)}</div>
      <div class="ag-sess-slot">${fmt.slotLabel} · ${_esc(fmt.slotHours)}</div>
    </div>
    <div class="ag-sess-row">
      <span class="ag-sess-state ag-sess-state--${state.tone}">${_esc(state.label)}</span>
      ${s.manual ? `<span class="ag-sess-tag">Date MJ</span>` : ''}
      ${mission ? `<button type="button" class="ag-sess-tag ag-sess-tag--link" data-action="_agOpenMission" data-mission-id="${_esc(quest.missionId)}" title="Ouvrir la mission dans la trame">${mission.closed ? '🏁' : '📖'} ${_esc(mission.label)}</button>` : ''}
    </div>
    <div class="ag-sess-group">${_esc(group)}</div>
    <div class="ag-sess-people">
      <span class="ag-sess-avatars" aria-label="${participants.length} participants">
        ${participants.length
          ? participants.slice(0, 6).map(p => _participantAvatar(p, 24)).join('') + (participants.length > 6 ? `<span class="ag-sess-more">+${participants.length - 6}</span>` : '')
          : `<span class="ag-sess-empty">Aucun participant</span>`}
      </span>
      <span class="ag-sess-avail" title="Disponibilités : dispo / peut-être / non">
        <b class="is-ok">${av.ok}</b><i>/</i><b class="is-maybe">${av.maybe}</b><i>/</i><b class="is-no">${av.no}</b>
      </span>
    </div>
    <div class="ag-sess-acts">
      <button type="button" class="ag-sess-btn ag-sess-btn--go" data-action="_agGoVtt">Table</button>
      <button type="button" class="ag-sess-btn" data-action="_agOpenStats" data-date="${_esc(s.date || '')}">Stats</button>
      ${admin ? `
        <button type="button" class="ag-sess-btn" data-action="_agMarkDone" ${dq} title="Marquer la séance jouée (déplace dans l'historique)">✓ Jouée</button>
        <button type="button" class="ag-sess-btn" data-action="_agEditSession" ${dq} title="Modifier la date ou le créneau">✎</button>
        <button type="button" class="ag-sess-btn ag-sess-btn--del" data-action="_agUnvalidateSlot" ${dq} title="Supprimer la séance">🗑</button>
      ` : ''}
    </div>
  </article>`;
}

function _renderSessionBanner() {
  const el = document.getElementById('ag-session-banner');
  if (!el) return;
  const sessions = _validatedSessions()
    .filter(_sessionVisibleToMe)
    .filter(_sessionIsUpcoming)
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.slot || '').localeCompare(b.slot || ''));
  if (!sessions.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = `
    <div class="ag-sess-block">
      <div class="ag-sess-hd"><span class="ag-sess-hd-t">Prochaines séances</span><span class="ag-sess-hd-n">${sessions.length}</span></div>
      <div class="ag-sess-cards">
        ${sessions.map((s, i) => _sessionCardHtml(s, i === 0)).join('')}
      </div>
    </div>`;
}

// Historique : séances passées ou marquées jouées. Compact et replié par défaut
// pour ne pas envahir le rail quand elles s'accumulent sur une campagne.
function _renderSessionHistory() {
  const el = document.getElementById('ag-session-history');
  if (!el) return;
  const sessions = _validatedSessions()
    .filter(_sessionVisibleToMe)
    .filter(s => !_sessionIsUpcoming(s))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.slot || '').localeCompare(a.slot || ''));
  if (!sessions.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  const admin = STATE.isAdmin;
  el.innerHTML = `
    <details class="ag-hist">
      <summary class="ag-hist-sum">
        <span class="ag-hist-sum-t">Historique des séances</span>
        <span class="ag-hist-n">${sessions.length}</span>
      </summary>
      <div class="ag-hist-list">
        ${sessions.map(s => {
          const fmt = _formatSession(s);
          if (!fmt) return '';
          const quest = _sessionQuest(s) || {};
          const state = _sessionState(s);
          const group = quest?.titre || quest?.nom || fmt.questTitle || 'Groupe';
          const dq = `data-quest-id="${_esc(s.questId || '')}" data-iso="${_esc(s.date || '')}" data-slot-id="${_esc(s.slot || '')}"`;
          return `<div class="ag-hist-row ag-hist-row--${state.tone}">
            <span class="ag-hist-state ag-hist-state--${state.tone}">${_esc(state.label)}</span>
            <span class="ag-hist-when">${_esc(fmt.dateFr)} <em>${fmt.slotLabel}</em></span>
            <span class="ag-hist-group">${_esc(group)}</span>
            ${admin ? `<span class="ag-hist-acts">
              ${state.key === 'done'
                ? `<button type="button" class="ag-hist-btn" data-action="_agMarkUndone" ${dq} title="Remettre à venir">↩</button>`
                : `<button type="button" class="ag-hist-btn" data-action="_agMarkDone" ${dq} title="Marquer jouée">✓</button>`}
              <button type="button" class="ag-hist-btn" data-action="_agEditSession" ${dq} title="Modifier">✎</button>
              <button type="button" class="ag-hist-btn ag-hist-btn--del" data-action="_agUnvalidateSlot" ${dq} title="Supprimer">🗑</button>
            </span>` : ''}
          </div>`;
        }).join('')}
      </div>
    </details>`;
}


// ── Rendu : calendrier personnel ──────────────────────────────────────────
// ── Navigation par mois (partagée calendrier perso + vue groupe) ──────────
function _displayedMonth() {
  const t = _today();
  const base = new Date(t.getFullYear(), t.getMonth() + (_ag.calMonthOffset || 0), 1);
  base.setHours(0, 0, 0, 0);
  return base;
}
function _monthLabel(base) {
  const s = base.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function _agMonthNav() {
  const isNow = (_ag.calMonthOffset || 0) === 0;
  // Bouton « Aujourd'hui » toujours présent (désactivé sur le mois courant) :
  // sinon son apparition décalerait la flèche « › » et provoquerait des clics ratés.
  return `<div class="ag-monthnav">
    <button type="button" class="ag-monthnav-btn" data-action="_agCalNav" data-delta="-1" title="Mois précédent" aria-label="Mois précédent">‹</button>
    <div class="ag-monthnav-title">${_monthLabel(_displayedMonth())}</div>
    <button type="button" class="ag-monthnav-btn" data-action="_agCalNav" data-delta="1" title="Mois suivant" aria-label="Mois suivant">›</button>
    <button type="button" class="ag-monthnav-today" data-action="_agCalNav" data-today="1" ${isNow ? 'disabled aria-disabled="true"' : ''}>Aujourd'hui</button>
  </div>`;
}

function _mobileWeekLabel(days = []) {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return '';
  const firstMonth = first.toLocaleDateString('fr-FR', { month: 'short' });
  const lastMonth = last.toLocaleDateString('fr-FR', { month: 'short' });
  if (first.getMonth() === last.getMonth()) return `${first.getDate()}–${last.getDate()} ${lastMonth}`;
  return `${first.getDate()} ${firstMonth} – ${last.getDate()} ${lastMonth}`;
}

function _agWeekNav(days) {
  const isNow = (_ag.calWeekOffset || 0) === 0;
  return `<div class="ag-weeknav">
    <button type="button" class="ag-monthnav-btn" data-action="_agCalWeekNav" data-delta="-1" aria-label="Semaine précédente">‹</button>
    <div class="ag-weeknav-title">${_esc(_mobileWeekLabel(days))}</div>
    <button type="button" class="ag-monthnav-btn" data-action="_agCalWeekNav" data-delta="1" aria-label="Semaine suivante">›</button>
    <button type="button" class="ag-monthnav-today" data-action="_agCalWeekNav" data-today="1" ${isNow ? 'disabled aria-disabled="true"' : ''}>Cette semaine</button>
  </div>`;
}

function _calendarSlotButton(date, slot, { mobile = false } = {}) {
  const state = _slotState(_ag.myAvail, date, slot.id);
  const source = _slotSource(_ag.myAvail, date, slot.id);
  const isPast = date < _today();
  const sourceLabel = source === 'explicit'
    ? 'Exception ponctuelle'
    : source === 'recurring' ? 'Planning récurrent' : 'Aucune valeur par défaut';
  const label = `${_formatDateFr(date)}, ${slot.label} : ${STATE_LABELS[state] || 'Non renseigné'} — ${sourceLabel}`;
  const classes = [
    'ag-cal-slot',
    `ag-slot--${state || 'none'}`,
    source === 'explicit' ? 'ag-slot--explicit' : '',
    source === 'recurring' ? 'ag-slot--recurring' : '',
    mobile ? 'ag-cal-mobile-slot' : '',
  ].filter(Boolean).join(' ');
  const content = mobile
    ? `<span class="ag-cal-mobile-slot-name"><span aria-hidden="true">${slot.emoji}</span> ${slot.label}</span><span class="ag-cal-mobile-slot-state" aria-hidden="true">${STATE_EMOJI[state] || '⚪'}</span>`
    : `<span class="ag-cal-slot-ico" aria-hidden="true">${slot.emoji}</span>`;
  return `<button type="button" class="${classes}"
    data-action="_agCycle" data-iso="${_toISO(date)}" data-slot="${slot.id}"
    title="${_esc(label)}" aria-label="${_esc(label)}" ${isPast ? 'disabled' : ''}>${content}</button>`;
}

function _renderCalendar() {
  const el = document.getElementById('ag-calendar');
  if (!el) return;
  const today = _today();
  const base = _displayedMonth();
  const month = base.getMonth();
  const monthEnd = new Date(base.getFullYear(), month + 1, 0); monthEnd.setHours(0, 0, 0, 0);
  // Grille = semaines (lundi→dimanche) couvrant le mois affiché
  const gridStart = _addDays(base, -((base.getDay() + 6) % 7));
  const lastMonday = _addDays(monthEnd, -((monthEnd.getDay() + 6) % 7));
  const weekCount = Math.round((lastMonday - gridStart) / (7 * 86400000)) + 1;
  const weeks = [];
  for (let w = 0; w < weekCount; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) week.push(_addDays(gridStart, w * 7 + d));
    weeks.push(week);
  }

  const mobileDays = weekDatesFrom(today, _ag.calWeekOffset || 0);

  el.innerHTML = `
    <div class="ag-cal-desktop">
      ${_agMonthNav()}
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
            const outMonth = d.getMonth() !== month;
            return `<div class="ag-cal-cell${isToday ? ' ag-cal-cell--today' : ''}${isPast ? ' ag-cal-cell--past' : ''}${outMonth ? ' ag-cal-cell--out' : ''}">
              <div class="ag-cal-date">${d.getDate()}</div>
              <div class="ag-cal-slots">${SLOTS.map(s => _calendarSlotButton(d, s)).join('')}</div>
            </div>`;
          }).join('')}
        </div>
      `).join('')}
    </div>
    <div class="ag-cal-mobile">
      ${_agWeekNav(mobileDays)}
      <div class="ag-cal-mobile-days">
        ${mobileDays.map(d => {
          const iso = _toISO(d);
          const isToday = iso === _toISO(today);
          const isPast = d < today;
          return `<div class="ag-cal-mobile-day${isToday ? ' is-today' : ''}${isPast ? ' is-past' : ''}">
            <div class="ag-cal-mobile-date">
              <strong>${d.toLocaleDateString('fr-FR', { weekday: 'long' })}</strong>
              <span>${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}${isToday ? ' · Aujourd’hui' : ''}</span>
            </div>
            <div class="ag-cal-mobile-slots">${SLOTS.map(s => _calendarSlotButton(d, s, { mobile: true })).join('')}</div>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

function cycleAgendaSlot(iso, slotId) {
  _cycleSlot(iso, slotId);
  _renderCalendar();
  _renderAgendaOverview();
}

// ── Modal pattern récurrent ───────────────────────────────────────────────
function _syncRecurringButton(btn, dayId, slotId) {
  if (!btn) return;
  const state = _ag.myAvail?.recurring?.[dayId]?.[slotId] || '';
  const day = DAYS.find(item => item.id === dayId);
  const slot = SLOTS.find(item => item.id === slotId);
  btn.className = `ag-rec-cell ag-slot--${state || 'none'}`;
  btn.textContent = STATE_EMOJI[state] || '⚪';
  btn.title = STATE_LABELS[state] || 'Non renseigné';
  btn.setAttribute('aria-label', `${day?.long || dayId}, ${slot?.label || slotId} : ${STATE_LABELS[state] || 'Non renseigné'}`);
}

function _syncRecurringEditor() {
  document.querySelectorAll('.ag-rec-cell[data-day][data-slot]').forEach(btn => {
    _syncRecurringButton(btn, btn.dataset.day, btn.dataset.slot);
  });
}

function openRecurringEditor() {
  const rec = _ag.myAvail?.recurring || {};
  openModal('📆 Mon planning récurrent', `
    <div class="ag-rec-intro">
      Définis tes dispos par défaut pour chaque jour de la semaine.<br>
      <span style="color:var(--text-dim);font-size:.8rem">Tu pourras toujours modifier une date précise dans le calendrier. Les changements sont enregistrés automatiquement.</span>
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
              data-action="_agRecCycle" data-day="${d.id}" data-slot="${s.id}"
              title="${STATE_LABELS[state]||'Non renseigné'}"
              aria-label="${d.long}, ${s.label} : ${STATE_LABELS[state]||'Non renseigné'}">${STATE_EMOJI[state]||'⚪'}</button>`;
          }).join('')}
        </div>`).join('')}
    </div>
    <div class="ag-rec-presets">
      <div class="ag-rec-presets-lbl">Ajouter à ma semaine :</div>
      <button class="btn btn-outline btn-sm" data-action="_agSetRecurringPattern" data-pattern="evenings">🌙 Toutes mes soirées</button>
      <button class="btn btn-outline btn-sm" data-action="_agSetRecurringPattern" data-pattern="weekends">📅 Tous mes week-ends</button>
      <button class="btn btn-outline btn-sm" data-action="_agSetRecurringPattern" data-pattern="fri-eve">🎲 Vendredi soir</button>
      <button class="btn btn-outline btn-sm ag-rec-reset" data-action="_agSetRecurringPattern" data-pattern="reset">Réinitialiser la semaine</button>
    </div>
  `, { subtitle: 'Tes disponibilités par défaut, semaine type', accent: '#22c38e' });
}
function cycleRecurringSlot(dayId, slotId, btn) {
  _cycleRecurring(dayId, slotId);
  _syncRecurringButton(btn, dayId, slotId);
  _renderCalendar();
  _renderAgendaOverview();
  _renderSuggestions();
}

// ── Vue groupe (qui est dispo quand) ──────────────────────────────────────
function _renderGroupView() {
  const el = document.getElementById('ag-group-view');
  if (!el) return;
  el.hidden = !_ag.groupView;
  if (!_ag.groupView) { el.innerHTML = ''; return; }

  const today = _today();
  const todayIso = _toISO(today);
  const base = _displayedMonth();
  const monthEnd = new Date(base.getFullYear(), base.getMonth() + 1, 0); monthEnd.setHours(0, 0, 0, 0);
  const days = [];
  for (let d = new Date(base); d <= monthEnd; d = _addDays(d, 1)) days.push(new Date(d));

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
  const header = _agMonthNav() + filtersHtml;

  if (!players.length) {
    el.innerHTML = header + `<div class="ag-quest-empty" style="margin-top:.6rem">Aucun joueur dans ce groupe (hors toi).</div>`;
    return;
  }

  const dayCls = d => {
    const iso = _toISO(d);
    let c = 'ag-grp-daycell';
    if (iso === todayIso) c += ' ag-grp-daycell--today';
    else if (d < today) c += ' ag-grp-daycell--past';
    if ((d.getDay() + 6) % 7 === 0) c += ' ag-grp-daycell--wk'; // lundi = début de semaine
    return c;
  };

  el.innerHTML = header + `
    <div class="ag-grp-scroll">
      <table class="ag-grp-table">
        <thead>
          <tr>
            <th class="ag-grp-namecell">Joueur</th>
            ${days.map(d => `<th class="${dayCls(d)}">
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
                return `<td class="${dayCls(d)}"><div class="ag-grp-slots">${cells}</div></td>`;
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
  if (btn) {
    btn.textContent = _ag.groupView ? 'Masquer' : 'Afficher';
    btn.setAttribute('aria-expanded', String(_ag.groupView));
  }
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
  if (btn) { btn.textContent = 'Masquer'; btn.setAttribute('aria-expanded', 'true'); }
  _renderGroupView();
  document.getElementById('ag-group-view')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Bouton MJ de nettoyage des anciennes quêtes autonomes (sans missionId).
function _renderLegacyCleanup() {
  const el = document.getElementById('ag-legacy-cleanup');
  if (!el) return;
  const n = STATE.isAdmin ? _legacyQuests().length : 0;
  el.innerHTML = n
    ? `<button class="btn btn-outline btn-sm" data-action="_agDeleteLegacyQuests" title="Supprimer les anciennes quêtes (on planifie désormais via les groupes de la Trame)">🧹 Supprimer ${n} ancienne${n > 1 ? 's' : ''} quête${n > 1 ? 's' : ''}</button>`
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

// ══════════════════════════════════════════════════════════════════════════
// RENDU REFONTE — bandeau collant + 3 onglets (Planning / Créneaux / Joueurs).
// Un seul calendrier, deux lectures : jauge de convergence en fond, pastille
// « ma réponse » en avant-plan. Saisie clic-cycle + pinceau au glissé.
// (Les anciennes fonctions de rendu ci-dessus restent inertes — leurs cibles
//  DOM n'existent plus dans la nouvelle coquille — et sont réassignées à
//  _agRerender en bas de fichier pour que les mutations de séance rafraîchissent
//  la nouvelle UI. Le modèle de séances / la sauvegarde / les helpers sont
//  intégralement conservés.)
// ══════════════════════════════════════════════════════════════════════════

const _agEl = id => document.getElementById(id);
const _cap = s => (s || '').charAt(0).toUpperCase() + (s || '').slice(1);
const _fShort = d => d ? d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
const _fLong  = d => d ? d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
const _isWE = d => d.getDay() === 0 || d.getDay() === 6;
const _agMJ = () => STATE.isAdmin && _ag.role !== 'player';
const _agIsMe = uid => _myUidAliases().includes(uid);

// ── Scope (groupe planifié) ──────────────────────────────────────────────
function _agVisibleGroups() {
  return _activePlanningGroups().filter(q => STATE.isAdmin || _questHasMe(q));
}
function _agActiveGroup() {
  if (!_ag.groupFilter) return null;
  const g = _agVisibleGroups().find(q => q.id === _ag.groupFilter);
  if (!g) { _ag.groupFilter = null; return null; }
  return g;
}
function _agScopeMembers() {
  const g = _agActiveGroup();
  if (g) return _questParticipants(g);
  const byKey = new Map();
  _agVisibleGroups().forEach(q => _questParticipants(q).forEach(p => {
    const k = _uidIdentityKey(p.uid);
    if (!byKey.has(k)) byKey.set(k, p);
  }));
  return [...byKey.values()];
}
function _agGroupColor(quest) {
  const id = String(quest?.id || '');
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return GROUP_TINTS[h % GROUP_TINTS.length];
}
function _agHasAnswered(uid) { return _participantHasAvailability({ uid }); }
function _agAgo(ts) {
  const ms = typeof ts === 'number' ? ts : (ts?.toMillis ? ts.toMillis() : (ts?.seconds ? ts.seconds * 1000 : Number(ts)));
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 3600)  return `il y a ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}

// ── Grille du mois affiché (réutilise _displayedMonth / _agMonthNav / _agCalNav) ──
function _agMonthWeeks() {
  const b = _displayedMonth();
  const end = new Date(b.getFullYear(), b.getMonth() + 1, 0); end.setHours(0, 0, 0, 0);
  const start = _addDays(b, -((b.getDay() + 6) % 7));
  const lastMon = _addDays(end, -((end.getDay() + 6) % 7));
  const n = Math.round((lastMon - start) / 604800000) + 1, out = [];
  for (let w = 0; w < n; w++) out.push(Array.from({ length: 7 }, (_, i) => _addDays(start, w * 7 + i)));
  return out;
}
function _agMonthDays() {
  const b = _displayedMonth();
  const end = new Date(b.getFullYear(), b.getMonth() + 1, 0), out = [];
  for (let d = new Date(b); d <= end; d = _addDays(d, 1)) out.push(new Date(d));
  return out;
}

// ── Convergence (rendu, pas calcul métier) ────────────────────────────────
// Pour MOI, on lit mon édition en cours (_ag.myAvail) et non ma dispo
// sauvegardée : la jauge réagit immédiatement au pinceau, comme la pastille.
function _agSlotStateFor(p, d, slotId) {
  const av = _agIsMe(p.uid) ? _ag.myAvail : _availabilityForUid(p.uid);
  return _slotState(av, d, slotId);
}
function _agConv(members, d, slotId) {
  const detail = members.map(p => ({ uid: p.uid, nom: p.nom, p, st: _agSlotStateFor(p, d, slotId) }));
  const c = { total: members.length, ok: 0, maybe: 0, no: 0, missing: 0, detail };
  detail.forEach(x => { if (x.st === 'ok') c.ok++; else if (x.st === 'maybe') c.maybe++; else if (x.st === 'no') c.no++; else c.missing++; });
  c.width = c.total ? Math.round(((c.ok + c.maybe * 0.5) / c.total) * 100) : 0;
  return c;
}
// Couleur = TAUX de disponibilité (dégradé), pas un binaire « un no = rouge » :
// ingérable à grande échelle (un seul indispo sur 22 rendait tout rouge). Le
// rouge ne reste que pour les créneaux où très peu de gens peuvent.
function _agConvColor(c) {
  if (!c.total || (!c.ok && !c.maybe)) return 'var(--surface-3)';  // personne dispo → neutre
  if (c.ok === c.total) return 'var(--emerald)';                   // tout le monde dispo
  const r = (c.ok + c.maybe * 0.5) / c.total;                      // = width / 100
  if (r >= 0.7)  return 'var(--emerald)';
  if (r >= 0.45) return 'color-mix(in srgb, var(--emerald) 72%, transparent)';
  if (r >= 0.30) return 'var(--amber)';
  if (r >= 0.15) return 'color-mix(in srgb, var(--amber) 65%, transparent)';
  return 'color-mix(in srgb, var(--crimson) 45%, transparent)';   // très peu de dispos
}
// Candidats du groupe sur le mois affiché — réutilise le scoring de
// _computeQuestSuggestions (même exclusion « un no », même pondération).
function _agCandidates(quest, limit = 8) {
  const base = _displayedMonth();
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0); end.setHours(0, 0, 0, 0);
  const today = _today();
  if (end < today) return [];
  const daysAhead = Math.round((end - today) / 86400000) + 1;
  if (daysAhead < 1) return [];
  const bm = base.getMonth(), by = base.getFullYear();
  return _computeQuestSuggestions(quest, daysAhead, 9999)
    .filter(s => s.date.getMonth() === bm && s.date.getFullYear() === by && s.date >= today)
    .slice(0, limit);
}

// ── Avatars (characterAvatarHtml, jamais d'initiales colorées ad hoc) ─────
function _agAv(p, size = 22) {
  return characterAvatarHtml(p, { size, className: 'ag-av', title: p.nom || p.pseudo || '?', border: '0', background: 'var(--surface-3)' });
}
function _agRav(p, st, size = 24) {
  return `<span class="ag-rav${st ? '' : ' is-dimmed'}" title="${_esc(p.nom || '?')} — ${STATE_LABELS[st]}">${_agAv(p, size)}<i class="ag-bdg is-${st || 'none'}">${STATE_PIP[st]}</i></span>`;
}

// ── Rendu global ──────────────────────────────────────────────────────────
function _agRerender() {
  if (_ag.dragging) return;              // ne pas casser un geste de peinture en cours
  if (!_agEl('ag-root')) return;
  _agRenderTop();
  _agRenderView();
}
function _agRenderView() {
  document.querySelectorAll('.ag-view').forEach(v => v.classList.toggle('is-on', v.id === `ag-v-${_ag.tab}`));
  if (_ag.tab === 'planning') _agRenderPlanning();
  else if (_ag.tab === 'cand') _agRenderCand();
  else _agRenderPlayers();
}

// ── Bandeau collant ───────────────────────────────────────────────────────
function _agRenderTop() {
  const g = _agActiveGroup();
  const groups = _agVisibleGroups();

  const kicker = _agEl('ag-kicker');
  if (kicker) kicker.textContent = g ? (g.titre || g.nom || 'Groupe') : 'Toute la campagne';

  const scope = _agEl('ag-scope');
  if (scope) scope.innerHTML = `
    <label class="ag-sc-btn${g ? ' is-on' : ''}">
      <small>Groupe planifié</small>
      <select data-change="_agSetGroup" aria-label="Groupe planifié">
        <option value="">Tous les groupes (${groups.length})</option>
        ${groups.map(q => `<option value="${_esc(q.id)}" ${q.id === _ag.groupFilter ? 'selected' : ''}>${_esc(q.titre || q.nom || 'Groupe')}</option>`).join('')}
      </select>
    </label>`;

  const role = _agEl('ag-role');
  if (role) role.innerHTML = STATE.isAdmin ? `
    <button class="ag-segm-btn${_ag.role === 'mj' ? ' is-on' : ''}" data-action="_agSetRole" data-role="mj">Vue MJ</button>
    <button class="ag-segm-btn${_ag.role === 'player' ? ' is-on' : ''}" data-action="_agSetRole" data-role="player">Vue joueur</button>` : '';

  const nCand = g ? _agCandidates(g, 9999).length : groups.reduce((n, q) => n + _agCandidates(q, 9999).length, 0);
  const nUpcoming = _validatedSessions().filter(_sessionVisibleToMe).filter(_sessionIsUpcoming).filter(s => !g || s.questId === g.id).length;
  const tabs = _agEl('ag-tabs');
  if (tabs) tabs.innerHTML = [
    ['planning', 'Planning', nUpcoming],
    ['cand', 'Créneaux possibles', nCand],
    ['players', 'Joueurs', _agScopeMembers().length],
  ].map(([id, lbl, n]) => `<button class="ag-tab${_ag.tab === id ? ' is-on' : ''}" data-action="_agSetTab" data-tab="${id}">${lbl}<span class="ag-tab-cnt">${n}</span></button>`).join('');

  const menu = _agEl('ag-menu');
  if (menu) {
    const nLegacy = STATE.isAdmin ? _legacyQuests().length : 0;
    menu.innerHTML = `
      <details class="ag-menu">
        <summary class="ag-menu-btn" title="Outils">⋯</summary>
        <div class="ag-menu-pop">
          <button type="button" data-action="_agClearOverrides">Effacer mes dispos ponctuelles</button>
          ${nLegacy ? `<button type="button" data-action="_agDeleteLegacyQuests">🧹 Supprimer ${nLegacy} ancienne${nLegacy > 1 ? 's' : ''} quête${nLegacy > 1 ? 's' : ''}</button>` : ''}
        </div>
      </details>`;
  }
}

// ── Onglet Planning ───────────────────────────────────────────────────────
function _agKpi(label, val, sub) {
  return `<div class="ag-kpi"><span>${label}</span><div class="ag-kpi-v">${val}</div><div class="ag-kpi-l">${sub}</div></div>`;
}
function _agRenderPlanning() {
  const host = _agEl('ag-v-planning'); if (!host) return;
  const g = _agActiveGroup();
  const members = _agScopeMembers();
  const groups = _agVisibleGroups();
  const answered = members.filter(p => _agHasAnswered(p.uid)).length;
  const mine = _ag.myAvail || { slots: {}, recurring: {} };
  const nMine = Object.values(mine.slots || {}).reduce((n, d) => n + Object.keys(d).length, 0);
  const nRec = Object.values(mine.recurring || {}).reduce((n, d) => n + Object.keys(d).length, 0);
  const base = _displayedMonth();
  const monthName = base.toLocaleDateString('fr-FR', { month: 'long' });
  const load = _validatedSessions().filter(_sessionVisibleToMe).filter(s => {
    const d = _dateFromISO(s.date);
    return d && d.getMonth() === base.getMonth() && d.getFullYear() === base.getFullYear() && (!g || s.questId === g.id);
  }).length;
  const best = g ? _computeQuestSuggestions(g, 28, 1)[0]
    : groups.map(q => _computeQuestSuggestions(q, 28, 1)[0]).filter(Boolean).sort((a, b) => b.score - a.score)[0];
  const ready = groups.filter(q => { const p = _questParticipants(q); return p.length > 0 && p.every(x => _agHasAnswered(x.uid)); }).length;
  const upcoming = _validatedSessions().filter(_sessionVisibleToMe).filter(_sessionIsUpcoming).filter(s => !g || s.questId === g.id)
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.slot || '').localeCompare(b.slot || ''));
  // Séances passées non jouées (tous groupes, pour être trouvables) → à replacer.
  const pastMisplaced = _agMJ()
    ? _validatedSessions().filter(_sessionVisibleToMe).filter(s => _sessionState(s).key === 'past')
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.slot || '').localeCompare(a.slot || ''))
    : [];

  const kpis = `<div class="ag-kpirow">
    <div class="ag-kpi ag-kpi--roster">
      <span>Qui a répondu</span>
      <div class="ag-kpi-v">${answered}<small>/${members.length}</small></div>
      <div class="ag-kpi-roster">${members.length
        ? members.map(p => `<span class="${_agHasAnswered(p.uid) ? '' : 'is-miss'}" title="${_esc(p.nom || '?')}${_agHasAnswered(p.uid) ? '' : ' — pas répondu'}">${_agAv(p, 22)}</span>`).join('')
        : '<small class="ag-dim">Aucun joueur dans le scope</small>'}</div>
    </div>
    ${_agKpi('Séances calées', load, `sur ${monthName}${g ? '' : ' · tous groupes'}`)}
    ${_agKpi('Groupes prêts', `${ready}<small>/${groups.length}</small>`, 'toutes les réponses reçues')}
    ${_agKpi('Meilleur créneau', best ? `${best.okCount}<small>/${best.total}</small>` : '—', best ? `${_esc(_cap(_fShort(best.date)))} · ${best.slot.emoji} ${_esc(best.slot.label)}` : 'aucun créneau exploitable')}
    ${_agKpi('Ma saisie', nMine + nRec, `${nMine} ponctuelle${nMine > 1 ? 's' : ''} · ${nRec} en semaine type`)}
  </div>`;

  const strip = upcoming.length ? `<section class="ag-sec">
    <div class="ag-sec-hd"><div><span class="ag-k">Confirmé</span><h2>Prochaines séances</h2></div>
      <small>${upcoming.length} séance${upcoming.length > 1 ? 's' : ''}${g ? ' pour ce groupe' : ', tous groupes'}</small></div>
    <div class="ag-strip">${upcoming.map((s, i) => _agSessCard(s, i === 0)).join('')}</div>
  </section>` : '';

  const pastSec = pastMisplaced.length ? `<section class="ag-sec">
    <div class="ag-sec-hd"><div><span class="ag-k">Date passée sans être jouée — reprogramme, marque jouée, ou retire</span><h2>Séances à replacer</h2></div>
      <small>${pastMisplaced.length} séance${pastMisplaced.length > 1 ? 's' : ''}</small></div>
    <div class="ag-pastlist">${pastMisplaced.map(_agPastRow).join('')}</div>
  </section>` : '';

  const cal = `<section class="ag-sec">
    <div class="ag-sec-hd">
      <div><span class="ag-k">Tes disponibilités · clique ou glisse pour les poser (la convergence du groupe est dans « Créneaux » et « Joueurs »)</span><h2>Mon calendrier</h2></div>
      <div class="ag-sec-hd-tools">
        ${_agMonthNav()}
        <button class="ag-pill${_ag.recOpen ? ' is-on' : ''}" data-action="_agToggleRec" title="Mes dispos par défaut, appliquées à toutes les semaines">⟳ Ma semaine type</button>
      </div>
    </div>
    ${_agTools()}
    <div class="ag-hintbar">Les en-têtes <b>Lun/Mar…</b> remplissent la colonne du mois avec le pinceau, le label de semaine remplit la ligne.${_agMJ() ? ' Un <b>clic droit</b> sur un créneau y pose ou retire une séance du groupe scopé.' : ''}</div>
    ${_ag.recOpen ? _agRecBar() : ''}
    <div class="ag-cal" id="ag-cal"></div>
    <div class="ag-leg">
      <span><i style="--lc:var(--emerald)"></i> Disponible</span>
      <span><i style="--lc:var(--amber)"></i> Peut-être</span>
      <span><i style="--lc:var(--crimson)"></i> Indisponible</span>
      <span><i style="--lc:var(--surface-sunken)"></i> Pas renseigné</span>
      <span><i class="ag-leg-pip is-ok is-exp">✓</i> Exception à ma semaine type</span>
    </div>
  </section>`;

  host.innerHTML = `<section class="ag-sec">${kpis}</section>${strip}${pastSec}${cal}`;
  _agRenderCal();
}

// Barre pinceau + statut de sauvegarde (piloté par _setSaveStatus).
function _agTools() {
  const tint = { ok: 'var(--emerald)', maybe: 'var(--amber)', no: 'var(--crimson)', '': 'var(--surface-3)' };
  const b = BRUSHES.find(x => x.v === _ag.brush) || BRUSHES[0];
  return `<div class="ag-tools" id="ag-tools">
    <span class="ag-tools-lbl">Pinceau</span>
    ${BRUSHES.map(x => `<button type="button" class="ag-br${_ag.brush === x.v ? (_ag.armed ? ' is-armed' : ' is-on') : ''}" data-action="_agBrush" data-brush="${x.v}" style="--bc:${tint[x.v]}" title="${_ag.armed && _ag.brush === x.v ? 'Revenir au cycle au clic' : `Verrouiller « ${x.label} »`}"><i></i>${x.label}<kbd>${x.key}</kbd></button>`).join('')}
    <span class="ag-tools-st" style="--bc:${tint[b.v]}">
      ${_ag.armed
        ? `<span class="ag-pin">Verrouillé</span> chaque clic pose <b>${b.label}</b> <button type="button" class="ag-unarm" data-action="_agUnarm">Cycle <kbd>Échap</kbd></button>`
        : `<b>Clic</b> = cycle · <b>glissé</b> pose <b>${b.label}</b>`}
    </span>
    <span class="ag-save-status" id="ag-save-status" role="status" aria-live="polite"></span>
  </div>`;
}

// Semaine type dépliable (inline, ex-modale).
function _agRecBar() {
  const rec = (_ag.myAvail || {}).recurring || {};
  return `<div class="ag-recbar">
    <div class="ag-recbar-lbl" title="Valeur par défaut de chaque semaine. Une exception datée reste prioritaire."><i>⟳</i><b>Sem.<br>type</b></div>
    ${DAYS.map((dy, i) => `<div class="ag-rcol${i > 4 ? ' is-we' : ''}"><b>${dy.label}</b>
      ${SLOTS.map(sl => { const st = rec[dy.id]?.[sl.id] || '';
        return `<div class="ag-recrow" data-day="${dy.id}" data-slot="${sl.id}" title="${dy.long} · ${sl.label} — ${STATE_LABELS[st]}"><i class="ag-sr-g">${sl.label[0]}</i><span class="ag-rp is-${st || 'none'}">${STATE_PIP[st]}</span></div>`; }).join('')}
    </div>`).join('')}
  </div>`;
}

function _agRenderCal() {
  const el = _agEl('ag-cal'); if (!el) return;
  const g = _agActiveGroup(), members = _agScopeMembers();
  const base = _displayedMonth(), month = base.getMonth();
  const today = _today(), todayISO = _toISO(today);
  // Portraits des membres dispos : en vue groupe, OU pour un joueur (son
  // périmètre = ses groupes, borné). Masqué si le scope est trop large
  // (ex. MJ « Tous » = 22). Dispos résolues une fois (alias = coûteux).
  const otherMembers = members.filter(p => !_agIsMe(p.uid));
  const showWho = (!!g || !STATE.isAdmin) && otherMembers.length > 0 && otherMembers.length <= 14;
  const others = showWho ? otherMembers.map(p => ({ p, av: _availabilityForUid(p.uid) })) : [];
  el.innerHTML = `
    <div class="ag-cal-hd"><div class="ag-cal-corner"></div>
      ${DAYS.map((d, i) => `<button type="button" class="ag-cal-dow${i > 4 ? ' is-we' : ''}" data-action="_agFillCol" data-col="${i}" title="Peindre tous les ${d.long.toLowerCase()}s du mois (re-clic : effacer)">${d.label}</button>`).join('')}
    </div>
    ${_agMonthWeeks().map((week, wi) => `<div class="ag-cal-wk">
      <button type="button" class="ag-wk-lbl" data-action="_agFillWeek" data-week="${wi}" title="Peindre toute la semaine (re-clic : effacer)"><span>${week[0].getDate()}/${week[0].getMonth() + 1}</span><span>↓</span></button>
      ${week.map(d => {
        const s = _toISO(d), past = d < today, out = d.getMonth() !== month, isToday = s === todayISO;
        const sess = _validatedSessions().filter(_sessionVisibleToMe).filter(x => (!g || x.questId === g.id) && x.date === s);
        return `<div class="ag-cell${out ? ' is-out' : ''}${_isWE(d) ? ' is-we' : ''}${isToday ? ' is-today' : ''}${past ? ' is-past' : ''}">
          <div class="ag-cell-hd"><b>${d.getDate()}</b>${isToday ? '<span class="ag-tdy">auj.</span>' : ''}</div>
          ${SLOTS.map(sl => {
            const my = _slotState(_ag.myAvail, d, sl.id), exp = _slotSource(_ag.myAvail, d, sl.id) === 'explicit';
            const val = g && _isSlotValidated(g.id, s, sl.id);
            let who = '';
            if (showWho) {
              const okm = others.filter(o => _slotState(o.av, d, sl.id) === 'ok');
              who = okm.slice(0, 3).map(o => _agAv(o.p, 15)).join('') + (okm.length > 3 ? `<span class="ag-sr-more">+${okm.length - 3}</span>` : '');
            }
            return `<div class="ag-slotrow is-${my || 'none'}${val ? ' has-sess' : ''}${past ? ' is-locked' : ''}" data-iso="${s}" data-slot="${sl.id}" title="${_esc(_fLong(d))} · ${_esc(sl.label)} — ${STATE_LABELS[my]}${exp ? ' (exception ponctuelle)' : ''}">
              <i class="ag-sr-g">${sl.label[0]}</i>
              <span class="ag-sr-fill"></span>
              <span class="ag-sr-who">${who}</span>
              <span class="ag-sr-pip is-${my || 'none'}${exp ? ' is-exp' : ''}">${STATE_PIP[my]}</span>
            </div>`;
          }).join('')}
          ${sess.length ? `<div class="ag-cell-sess">${sess.map(x => { const gg = _sessionQuest(x) || {}, sl = SLOTS.find(y => y.id === x.slot) || SLOTS[0];
            return `<span class="ag-stag" style="--gc:${_agGroupColor(gg)}"><b>${sl.emoji}</b>${_esc((gg.titre || gg.nom || 'Séance').split(' ').slice(-1)[0])}</span>`; }).join('')}</div>` : ''}
        </div>`;
      }).join('')}
    </div>`).join('')}`;
}

function _agSessCard(s, first) {
  const fmt = _formatSession(s); if (!fmt) return '';
  const quest = _sessionQuest(s) || {}, d = _dateFromISO(s.date), sl = SLOTS.find(x => x.id === s.slot) || SLOTS[0];
  const members = _questParticipants(quest);
  const c = _agConv(members, d, s.slot);
  const days = d ? Math.round((d - _today()) / 86400000) : 0;
  const admin = _agMJ();
  const dq = `data-quest-id="${_esc(s.questId || '')}" data-iso="${_esc(s.date || '')}" data-slot-id="${_esc(s.slot || '')}"`;
  const when = days === 0 ? 'Aujourd’hui' : days === 1 ? 'Demain' : days > 1 ? `Dans ${days} jours` : 'Bientôt';
  const mission = _missionHint(quest);
  return `<article class="ag-ss${first ? ' is-next' : ''}" style="--gc:${_agGroupColor(quest)}">
    <div class="ag-ss-top"><b>${when}</b>${s.manual ? '<span class="ag-tg">Date MJ</span>' : ''}${mission ? `<button type="button" class="ag-tg ag-tg--link" data-action="_agOpenMission" data-mission-id="${_esc(quest.missionId)}" title="Ouvrir la mission">${mission.closed ? '🏁' : '📖'}</button>` : ''}</div>
    <div class="ag-ss-when">${_esc(_cap(_fLong(d)))}<em>${sl.emoji} ${_esc(sl.label)} · ${_esc(sl.hours)}</em></div>
    <div class="ag-ss-grp">${_esc(quest.titre || quest.nom || fmt.questTitle || 'Groupe')}</div>
    <div class="ag-ss-foot">
      <span class="ag-avstack">${members.slice(0, 6).map(p => _agAv(p, 20)).join('')}</span>
      <span class="ag-ss-cnt"><b>${c.ok}</b>/${c.total} dispo${c.no ? ` · ${c.no} ✕` : ''}</span>
    </div>
    <div class="ag-ss-acts">
      <button type="button" class="ag-ss-btn ag-ss-btn--go" data-action="_agGoVtt">Table</button>
      <button type="button" class="ag-ss-btn" data-action="_agOpenStats" data-date="${_esc(s.date || '')}">Stats</button>
      ${admin ? `
        <button type="button" class="ag-ss-btn" data-action="_agMarkDone" ${dq} title="Marquer jouée">✓ Jouée</button>
        <button type="button" class="ag-ss-btn" data-action="_agEditSession" ${dq} title="Modifier">✎</button>
        <button type="button" class="ag-ss-btn is-del" data-action="_agUnvalidateSlot" ${dq} title="Supprimer">🗑</button>` : ''}
    </div>
  </article>`;
}

// Séance datée dans le passé sans être jouée → à reprogrammer (MJ).
function _agPastRow(s) {
  const fmt = _formatSession(s); if (!fmt) return '';
  const quest = _sessionQuest(s) || {};
  const dq = `data-quest-id="${_esc(s.questId || '')}" data-iso="${_esc(s.date || '')}" data-slot-id="${_esc(s.slot || '')}"`;
  return `<div class="ag-pastrow" style="--gc:${_agGroupColor(quest)}">
    <span class="ag-pastrow-when">${_esc(_cap(fmt.dateFr))}<em>${fmt.slotLabel}</em></span>
    <span class="ag-pastrow-grp">${_esc(quest.titre || quest.nom || fmt.questTitle || 'Groupe')}</span>
    <span class="ag-ss-acts">
      <button type="button" class="ag-ss-btn ag-ss-btn--go" data-action="_agEditSession" ${dq} title="Choisir une nouvelle date">Reprogrammer</button>
      <button type="button" class="ag-ss-btn" data-action="_agMarkDone" ${dq} title="Marquer jouée">✓ Jouée</button>
      <button type="button" class="ag-ss-btn is-del" data-action="_agUnvalidateSlot" ${dq} title="Supprimer la séance">🗑</button>
    </span>
  </div>`;
}

// ── Onglet Créneaux possibles ─────────────────────────────────────────────
function _agRenderCand() {
  const host = _agEl('ag-v-cand'); if (!host) return;
  const g = _agActiveGroup(), list = g ? [g] : _agVisibleGroups();
  host.innerHTML = `
    <section class="ag-sec">
      <div class="ag-sec-hd"><div><span class="ag-k">Classés par convergence · un créneau où quelqu’un est indisponible n’apparaît pas</span><h2>Créneaux possibles</h2></div>${_agMonthNav()}</div>
      ${list.length ? list.map(q => _agCandGroup(q, g ? 8 : 4)).join('') : '<div class="ag-card ag-empty"><b>Aucun groupe planifié</b>Crée un groupe sur une mission de la Trame.</div>'}
    </section>
    ${_agRenderCmp()}`;
}
function _agCandGroup(g, limit) {
  const cands = _agCandidates(g, limit);
  const parts = _questParticipants(g);
  const missing = parts.filter(p => !_agHasAnswered(p.uid));
  const admin = _agMJ();
  return `<div class="ag-cgrp">
    <div class="ag-cgrp-hd" style="--gc:${_agGroupColor(g)}"><span class="ag-dot"></span><b>${_esc(g.titre || g.nom || 'Groupe')}</b>
      <small>${parts.length} joueur${parts.length > 1 ? 's' : ''}</small><span class="ag-spacer"></span>
      ${missing.length ? `<small class="ag-warn">${missing.map(p => _esc(p.nom || '?')).join(', ')} n’${missing.length > 1 ? 'ont' : 'a'} pas répondu</small>` : '<small class="ag-ok">Toutes les réponses reçues</small>'}
      ${admin ? `<button type="button" class="ag-mini" data-action="_agDateLibre" data-quest-id="${_esc(g.id)}">＋ Date libre</button>` : ''}</div>
    <div class="ag-card">${cands.length ? cands.map((c, i) => _agCandRow(g, c, i)).join('') : `<div class="ag-empty"><b>Aucun créneau compatible sur ${_monthLabel(_displayedMonth()).toLowerCase()}</b>${admin ? 'Pose une date libre ou change de mois.' : 'Complète tes dispos ou change de mois.'}</div>`}</div>
  </div>`;
}
function _agCandRow(g, c, i) {
  const key = `${g.id}|${c.iso}|${c.slot.id}`, sel = _ag.cmp.includes(key), val = _isSlotValidated(g.id, c.iso, c.slot.id);
  const total = c.total || 1, missing = typeof c.missingCount === 'number' ? c.missingCount : (total - c.okCount - c.maybeCount);
  const pct = n => Math.round(n / total * 100);
  const order = { ok: 0, maybe: 1, '': 2, no: 3 };
  const byUid = new Map(_questParticipants(g).map(p => [p.uid, p]));  // participant complet = portrait
  const det = [...c.detail].sort((a, b) => order[a.state] - order[b.state]);
  const admin = _agMJ();
  return `<div class="ag-cand${sel ? ' is-sel' : ''}">
    <div class="ag-c-rk">${i + 1}</div>
    <div class="ag-c-when"><b>${_esc(_cap(_fShort(c.date)))}</b><small>${c.slot.emoji} ${_esc(c.slot.label)} · ${_esc(c.slot.hours)}</small></div>
    <div class="ag-c-bar">
      <span class="ag-cbar"><i class="is-ok" style="width:${pct(c.okCount)}%"></i><i class="is-mb" style="width:${pct(c.maybeCount)}%"></i><i class="is-ms" style="width:${pct(missing)}%"></i></span>
      <small><b>${c.okCount}</b>/${total} dispo${c.maybeCount ? ` · ${c.maybeCount} peut-être` : ''}${missing ? ` · ${missing} sans réponse` : ''}</small>
    </div>
    <div class="ag-c-who">${det.map(d => _agRav(byUid.get(d.uid) || { uid: d.uid, nom: d.nom }, d.state)).join('')}</div>
    <div class="ag-c-act">
      <button type="button" class="ag-mini${sel ? ' is-on' : ''}" data-action="_agCmp" data-key="${key}">${sel ? '✓ Comparé' : 'Comparer'}</button>
      ${admin ? `<button type="button" class="ag-mini ${val ? 'is-done' : 'is-go'}" data-action="_agProgram" data-quest-id="${_esc(g.id)}" data-iso="${c.iso}" data-slot-id="${c.slot.id}">${val ? '✓ Programmée' : 'Programmer'}</button>` : ''}
    </div>
  </div>`;
}
function _agRenderCmp() {
  if (_ag.cmp.length < 2) return _ag.cmp.length === 1
    ? `<div class="ag-note"><span>⚖</span><div>Sélectionne un <b>deuxième créneau</b> pour les comparer côte à côte, joueur par joueur.</div></div>` : '';
  const cols = _ag.cmp.map(k => { const [gid, iso, slotId] = k.split('|');
    return { gid, iso, slotId, d: _dateFromISO(iso), slot: SLOTS.find(s => s.id === slotId) || SLOTS[0] }; });
  const g = _agVisibleGroups().find(q => q.id === cols[0].gid) || _agActiveGroup();
  if (!g) return '';
  const members = _questParticipants(g);
  return `<div class="ag-cmp">
    <div class="ag-cmp-hd"><b>Comparer ${cols.length} créneaux</b><small>${_esc(g.titre || g.nom || '')}</small><span class="ag-spacer"></span><button type="button" class="ag-mini" data-action="_agCmpClear">Vider</button></div>
    <div class="ag-cmp-scroll"><table class="ag-ct"><thead><tr><th>Joueur</th>
      ${cols.map(c => `<th><b>${_esc(_cap(_fShort(c.d)))}</b><small>${c.slot.emoji} ${_esc(c.slot.label)}</small></th>`).join('')}</tr></thead>
      <tbody>
        ${members.map(p => `<tr><td><span class="ag-who2">${_agAv(p, 20)}${_esc(p.nom || '?')}</span></td>
          ${cols.map(c => { const st = _slotState(_availabilityForUid(p.uid), c.d, c.slotId);
            return `<td><span class="ag-cpip is-${st || 'none'}" title="${STATE_LABELS[st]}">${STATE_PIP[st]}</span></td>`; }).join('')}</tr>`).join('')}
        <tr class="ag-ct-tot"><td>Total disponibles</td>
          ${cols.map(c => { const cc = _agConv(members, c.d, c.slotId);
            return `<td><span class="ag-ctot${cc.ok === cc.total ? '' : ' is-part'}"><b>${cc.ok}</b>/${cc.total}</span></td>`; }).join('')}</tr>
      </tbody></table></div>
  </div>`;
}

// ── Onglet Joueurs ────────────────────────────────────────────────────────
function _agRenderPlayers() {
  const host = _agEl('ag-v-players'); if (!host) return;
  const members = _agScopeMembers(), days = _agMonthDays(), g = _agActiveGroup();
  const today = _today(), todayISO = _toISO(today);
  host.innerHTML = `
    <section class="ag-sec">
      <div class="ag-sec-hd"><div><span class="ag-k">Trois barres par jour : matin · après-midi · soir${g ? '' : ' — toute la campagne'}</span><h2>Qui est dispo quand</h2></div>${_agMonthNav()}</div>
      <div class="ag-pt-wrap"><table class="ag-pt"><thead><tr><th class="ag-nm">Joueur</th>
        ${days.map(d => `<th class="ag-d${_isWE(d) ? ' is-we' : ''}${_toISO(d) === todayISO ? ' is-tdy' : ''}">${d.getDate()}<span>${DAYS[(d.getDay() + 6) % 7].label[0]}</span></th>`).join('')}</tr></thead>
        <tbody>
          ${members.length ? members.map(p => {
            let o = 0, m = 0, n = 0;
            const av = _availabilityForUid(p.uid);
            const cells = days.map(d => {
              const bars = SLOTS.map(s => { const st = _slotState(av, d, s.id);
                if (st === 'ok') o++; else if (st === 'maybe') m++; else if (st === 'no') n++;
                return `<i class="is-${st || 'none'}"></i>`; }).join('');
              return `<td class="ag-d${_isWE(d) ? ' is-we' : ''}${_toISO(d) === todayISO ? ' is-tdy' : ''}${d < today ? ' is-past' : ''}" title="${_esc(_fShort(d))}"><span class="ag-dp">${bars}</span></td>`;
            }).join('');
            const gs = _agVisibleGroups().filter(q => _questParticipants(q).some(x => _uidIdentityKey(x.uid) === _uidIdentityKey(p.uid)));
            const answered = _agHasAnswered(p.uid);
            return `<tr><td class="ag-nm"><div class="ag-plid">
              ${_agAv(p, 30)}
              <div class="ag-plid-txt"><b>${_esc(p.nom || '?')}${_agIsMe(p.uid) ? ' <span class="ag-me">moi</span>' : ''}</b>
                <small><span class="ag-gdots">${gs.map(q => `<i style="--gc:${_agGroupColor(q)}" title="${_esc(q.titre || q.nom || '')}"></i>`).join('')}</span>${answered ? _esc(_agAgo(av?.updatedAt)) : '<span class="ag-tagno">pas répondu</span>'}</small></div>
              <span class="ag-plsum"><span class="is-o"><b>${o}</b>✓</span><span class="is-m"><b>${m}</b>?</span><span class="is-n"><b>${n}</b>✕</span></span>
            </div></td>${cells}</tr>`;
          }).join('') : `<tr><td class="ag-nm ag-dim">Aucun joueur dans le scope</td>${days.map(() => '<td class="ag-d"></td>').join('')}</tr>`}
        </tbody></table></div>
      <div class="ag-note"><span>💡</span><div>Les lignes sans réponse sont les seules à bloquer une programmation : leurs créneaux comptent comme « sans réponse » et font chuter le score de convergence.</div></div>
    </section>`;
}

// ── Tooltip détail créneau ────────────────────────────────────────────────
let _agTipT = null;
function _agShowTip(row) {
  const tip = _agEl('ag-tip'); if (!tip) return;
  const d = _dateFromISO(row.dataset.iso), slotId = row.dataset.slot;
  const sl = SLOTS.find(s => s.id === slotId) || SLOTS[0], g = _agActiveGroup(), members = _agScopeMembers();
  const c = _agConv(members, d, slotId);
  const order = { ok: 0, maybe: 1, '': 2, no: 3 };
  const det = [...c.detail].sort((a, b) => order[a.st] - order[b.st]);
  const val = g && _isSlotValidated(g.id, row.dataset.iso, slotId);
  tip.innerHTML = `<div class="ag-tip-hd"><b>${_esc(_fShort(d))}</b><span>${sl.emoji} ${_esc(sl.label)}</span></div>
    <div class="ag-tip-sub">${_esc(g ? (g.titre || g.nom) : 'Toute la table')} · <b>${c.ok}/${c.total} dispo</b>${c.no ? ` · ${c.no} indispo` : ''}</div>
    ${det.map(x => `<div class="ag-tip-row is-${x.st || 'none'}">${_agAv(x.p || { uid: x.uid, nom: x.nom }, 18)}<span>${_esc(x.nom || '?')}</span><em>${STATE_LABELS[x.st]}</em></div>`).join('')}
    <div class="ag-tip-ft">${val ? '✓ Séance déjà programmée sur ce créneau' : (_ag.armed ? `Clic : pose ${(BRUSHES.find(x => x.v === _ag.brush) || {}).label}` : 'Clic : cycle · glissé : pinceau')}</div>`;
  const r = row.getBoundingClientRect();
  tip.style.top = `${Math.min(Math.max(8, r.top - 6), window.innerHeight - tip.offsetHeight - 12)}px`;
  tip.style.left = `${r.right + 260 > window.innerWidth ? Math.max(8, r.left - 254) : r.right + 8}px`;
  tip.classList.add('is-on');
}
function _agHideTip() { const t = _agEl('ag-tip'); if (t) t.classList.remove('is-on'); }

// ── Toast léger ───────────────────────────────────────────────────────────
let _agToastT = null;
function _agToast(msg) {
  const el = _agEl('ag-toast'); if (!el) return;
  el.textContent = msg; el.classList.add('is-on');
  clearTimeout(_agToastT); _agToastT = setTimeout(() => el.classList.remove('is-on'), 2400);
}

// ── Saisie : cycle au clic + pinceau au glissé ────────────────────────────
const _agRowIsRec = row => row.classList.contains('ag-recrow');
function _agCurOf(row) {
  if (_agRowIsRec(row)) return ((_ag.myAvail || {}).recurring || {})[row.dataset.day]?.[row.dataset.slot] || '';
  return _slotState(_ag.myAvail, _dateFromISO(row.dataset.iso), row.dataset.slot);
}
function _agApply(row, val) {
  if (_agRowIsRec(row)) {
    _setRecVal(row.dataset.day, row.dataset.slot, val);
    const rp = row.querySelector('.ag-rp'); if (rp) { rp.className = `ag-rp is-${val || 'none'}`; rp.textContent = STATE_PIP[val]; }
    row.title = row.title.replace(/—.*$/, `— ${STATE_LABELS[val]}`);
    return;
  }
  _setSlotVal(row.dataset.iso, row.dataset.slot, val);
  const d = _dateFromISO(row.dataset.iso), slot = row.dataset.slot;
  const my = _slotState(_ag.myAvail, d, slot), exp = _slotSource(_ag.myAvail, d, slot) === 'explicit';
  row.classList.remove('is-ok', 'is-maybe', 'is-no', 'is-none');
  row.classList.add(`is-${my || 'none'}`);
  const pip = row.querySelector('.ag-sr-pip'); if (pip) { pip.className = `ag-sr-pip is-${my || 'none'}${exp ? ' is-exp' : ''}`; pip.textContent = STATE_PIP[my]; }
}
function _agClickValue(row) {
  const cur = _agCurOf(row);
  if (_ag.armed) return cur === _ag.brush ? '' : _ag.brush;
  return CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
}
function _agPaintBulk(rows) {
  rows = rows.filter(r => !r.classList.contains('is-locked'));
  if (!rows.length) return;
  const val = rows.every(r => _agCurOf(r) === _ag.brush) ? '' : _ag.brush;
  rows.forEach(r => _agApply(r, val));
  _scheduleSave();
  _agRenderPlanning();
  const b = BRUSHES.find(x => x.v === val);
  _agToast(`${rows.length} créneaux · ${(b ? b.label : 'Effacer').toLowerCase()}`);
}
function _agSetBrush(v) {
  if (_ag.armed && _ag.brush === v) _ag.armed = false;
  else { _ag.brush = v; _ag.armed = true; }
  _agRefreshTools();
}
function _agRefreshTools() {
  const old = _agEl('ag-tools'); if (!old) return;
  old.outerHTML = _agTools();
}
// MJ — pose / retire une séance du groupe scopé (clic droit sur un créneau).
function _agToggleSessionScoped(row) {
  const g = _agActiveGroup();
  if (!g) { _agToast('Choisis d’abord un groupe dans le bandeau pour programmer une séance.'); return; }
  const iso = row.dataset.iso, slot = row.dataset.slot;
  if (_isSlotValidated(g.id, iso, slot)) unvalidateSlot(g.id, iso, slot);
  else validateSlot(g.id, iso, slot);
}

// Listeners installés une seule fois, gardés à la page Agenda.
function _agInstallInput() {
  if (_ag.inputBound) return;
  _ag.inputBound = true;
  const inAgenda = () => !!_agEl('ag-root');
  const findRow = t => t && t.closest && t.closest('.ag-slotrow,.ag-recrow');

  // Flush d'une écriture debouncée non partie (ex. effacer puis recharger vite) :
  // la persistance offline Firestore la file, elle survit au reload.
  window.addEventListener('pagehide', () => {
    if (_ag.savePending) { clearTimeout(_ag.saveTimer); _saveAvail(_ag.saveRevision); }
  });

  document.addEventListener('pointerdown', e => {
    if (!inAgenda() || e.button === 2) return;
    const row = findRow(e.target);
    if (!row || row.classList.contains('is-locked')) return;
    e.preventDefault(); _agHideTip();
    const val = _agClickValue(row);
    _agApply(row, val);
    if (!_ag.armed) { _ag.brush = val; _agRefreshTools(); }
    _ag.dragging = true; _ag.dragVal = val; _ag.lastRow = row;
  });
  document.addEventListener('pointermove', e => {
    if (!_ag.dragging) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const row = el && el.closest && el.closest('.ag-slotrow,.ag-recrow');
    if (row && !row.classList.contains('is-locked') && row !== _ag.lastRow) { _ag.lastRow = row; _agApply(row, _ag.dragVal); }
  });
  document.addEventListener('pointerup', () => {
    if (!_ag.dragging) return;
    _ag.dragging = false; _ag.lastRow = null;
    _scheduleSave();
    _agRenderPlanning();
  });
  document.addEventListener('contextmenu', e => {
    if (!inAgenda() || !_agMJ()) return;
    const row = e.target.closest && e.target.closest('.ag-slotrow');
    if (!row || row.classList.contains('is-locked')) return;
    e.preventDefault(); _agHideTip();
    _agToggleSessionScoped(row);
  });
  document.addEventListener('pointerover', e => {
    if (!inAgenda() || _ag.dragging) return;
    const row = e.target.closest && e.target.closest('.ag-slotrow');
    if (!row) return;
    clearTimeout(_agTipT); _agTipT = setTimeout(() => _agShowTip(row), 240);
  });
  document.addEventListener('pointerout', e => {
    if (e.target.closest && e.target.closest('.ag-slotrow')) { clearTimeout(_agTipT); _agHideTip(); }
  });
  document.addEventListener('keydown', e => {
    if (!inAgenda() || _ag.tab !== 'planning') return;
    const tag = e.target.tagName || '';
    if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'Escape') { if (_ag.armed) { _ag.armed = false; _agRefreshTools(); } return; }
    const b = BRUSHES.find(x => x.key === e.key);
    if (b) { e.preventDefault(); _ag.brush = b.v; _ag.armed = true; _agRefreshTools(); }
  });
}

// ── Page principale ───────────────────────────────────────────────────────
async function renderAgendaPage() {
  const content = document.getElementById('main-content');
  if (!content) return;
  content.innerHTML = appSplashHtml("Chargement de l'agenda…");

  // Pas de fetch initial : on s'appuie entièrement sur les watches ci-dessous.
  _ag.allAvails   = [];
  _ag.quests      = [];
  _ag.users       = _membersFromAdventure();
  _ag.nextSession = null;
  _ag.myAvail     = { slots: {}, recurring: {} };
  _ag.cmp = []; _ag.dragging = false;
  _ag.myAvailLoaded = false; _ag.savePending = false;
  if (!STATE.isAdmin) _ag.role = 'player';

  content.innerHTML = `
    <div class="ag-root" id="ag-root">
      <div class="ag-top" id="ag-top">
        <div class="ag-top-in">
          <div class="ag-top-row">
            <div class="ag-brand"><h1>Agenda</h1><small id="ag-kicker">Planification</small></div>
            <span class="ag-spacer"></span>
            <div class="ag-scope" id="ag-scope"></div>
            <div class="ag-segm" id="ag-role"></div>
            <span id="ag-menu"></span>
          </div>
          <div class="ag-tabs" id="ag-tabs"></div>
        </div>
      </div>
      <div class="ag-wrap">
        <div class="ag-view is-on" id="ag-v-planning"></div>
        <div class="ag-view" id="ag-v-cand"></div>
        <div class="ag-view" id="ag-v-players"></div>
      </div>
      <div class="ag-tip" id="ag-tip"></div>
      <div class="ag-toast" id="ag-toast"></div>
    </div>`;

  _agInstallInput();
  _agRerender();

  // ── Abonnements temps réel ───────────────────────────────────────────────
  // Le 1er fire fait le rendu initial. quests + agenda_session sont session-live
  // (0 lecture) ; availabilities est page-scoped (1 fetch initial puis deltas).
  // `_ag.myAvail` est piloté par mes clics (debounce 600ms) — on ne l'écrase pas
  // en cours d'édition.
  watchPageCollection('agenda-avails', 'availabilities', 'agenda', data => {
    _ag.allAvails = data;
    // On charge ma dispo sauvegardée UNE seule fois (au 1er fire, si je n'ai pas
    // déjà édité). Ensuite mes éditions font foi → un effacement n'est jamais
    // ré-écrasé par un fire ultérieur.
    if (!_ag.myAvailLoaded) {
      _ag.myAvailLoaded = true;
      const localEmpty = !Object.keys(_ag.myAvail?.slots || {}).length && !Object.keys(_ag.myAvail?.recurring || {}).length;
      if (localEmpty && !_ag.savePending) {
        const mine = _availabilityForUid(STATE.user?.uid);
        if (mine) _ag.myAvail = mine;
      }
    }
    _scheduleQuestParticipantCleanup();
    _agRerender();
  });

  watchPageCollection('agenda-quests', 'quests', 'agenda', data => {
    _ag.quests = data;
    _scheduleQuestParticipantCleanup();
    _agRerender();
  });

  watchPageDoc('agenda-session', 'agenda_session', 'next', 'agenda', data => {
    _ag.nextSession = data;
    _agRerender();
  });
}

PAGES.agenda = renderAgendaPage;

// Les anciennes fonctions de rendu (cibles DOM disparues) sont réassignées :
// les mutations de séance (validate/edit/move…) qui les appellent rafraîchissent
// désormais la nouvelle UI par onglets.
_renderSessions        = _agRerender;
_renderAgendaOverview  = _agRerender;
_renderSuggestions     = _agRerender;
_renderCalendar        = _agRerender;
_renderGroupView       = _agRerender;

registerActions({
  // ── Séances (outils MJ conservés) ──
  _agValidateManualSlot:    (btn) => validateManualSlot(btn.dataset.questId),
  _agCloseModal:            ()    => closeModal(),
  _agUnvalidateSlot:        (btn) => unvalidateSlot(btn.dataset.questId, btn.dataset.iso, btn.dataset.slotId),
  _agMarkDone:              (btn) => markSessionDone(btn.dataset.questId, btn.dataset.iso, btn.dataset.slotId, true),
  _agEditSession:           (btn) => openEditSessionModal(btn.dataset.questId, btn.dataset.iso, btn.dataset.slotId),
  _agConfirmEditSession:    (btn) => confirmEditSession(btn.dataset.questId, btn.dataset.iso, btn.dataset.slotId),
  _agValidateSlot:          (btn) => validateSlot(btn.dataset.questId, btn.dataset.iso, btn.dataset.slotId),
  _agGoVtt:                 ()    => navigate('vtt'),
  _agOpenMission:           (btn) => _openAgendaMission(btn.dataset.missionId),
  _agOpenStats:             (btn) => _openAgendaStats(btn.dataset.date),
  _agDeleteLegacyQuests:    ()    => deleteLegacyQuests(),
  _agClearOverrides:        ()    => clearOverrides(),
  _agDateLibre:             (btn) => openManualSessionModal(btn.dataset.questId),
  // ── Refonte : bandeau / onglets / calendrier ──
  _agSetGroup:              (el)  => { _ag.groupFilter = (el.value || '') || null; _ag.cmp = []; _agRerender(); },
  _agSetTab:                (btn) => { _ag.tab = btn.dataset.tab; _agRerender(); },
  _agSetRole:               (btn) => { if (!STATE.isAdmin) return; _ag.role = btn.dataset.role; _agRerender(); },
  _agCalNav:                (btn) => { _ag.calMonthOffset = btn.dataset.today ? 0 : (_ag.calMonthOffset || 0) + Number(btn.dataset.delta || 0); _ag.cmp = []; _agRerender(); },
  _agToggleRec:             ()    => { _ag.recOpen = !_ag.recOpen; _agRenderPlanning(); },
  _agBrush:                 (btn) => _agSetBrush(btn.dataset.brush),
  _agUnarm:                 ()    => { _ag.armed = false; _agRefreshTools(); },
  _agFillCol:               (btn) => { const i = Number(btn.dataset.col);
    _agPaintBulk([...document.querySelectorAll('.ag-cal-wk')].map(w => w.children[i + 1]).filter(Boolean)
      .filter(c => !c.classList.contains('is-out')).flatMap(c => [...c.querySelectorAll('.ag-slotrow')])); },
  _agFillWeek:              (btn) => { const wk = btn.closest('.ag-cal-wk'); if (wk) _agPaintBulk([...wk.querySelectorAll('.ag-slotrow')]); },
  _agCmp:                   (btn) => { const k = btn.dataset.key;
    if (_ag.cmp.includes(k)) _ag.cmp = _ag.cmp.filter(x => x !== k);
    else { if (_ag.cmp.length && _ag.cmp[0].split('|')[0] !== k.split('|')[0]) _ag.cmp = []; _ag.cmp = [..._ag.cmp, k].slice(-3); }
    _agRenderCand(); },
  _agCmpClear:              ()    => { _ag.cmp = []; _agRenderCand(); },
  _agProgram:               (btn) => { const { questId, iso, slotId } = btn.dataset;
    if (_isSlotValidated(questId, iso, slotId)) unvalidateSlot(questId, iso, slotId); else validateSlot(questId, iso, slotId); },
});
export default renderAgendaPage;
