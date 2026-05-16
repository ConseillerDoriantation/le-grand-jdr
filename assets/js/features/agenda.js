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
import { loadCollection, saveDoc, getDocDataSilent, deleteFromCol } from '../data/firestore.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { _esc } from '../shared/html.js';
import { openModal, closeModal } from '../shared/modal.js';
import PAGES from './pages.js';

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
  try {
    const payload = {
      uid:        STATE.user.uid,
      pseudo:     STATE.profile?.pseudo || STATE.user.email || '?',
      recurring:  _ag.myAvail.recurring || {},
      slots:      _ag.myAvail.slots     || {},
      updatedAt:  Date.now(),
    };
    await saveDoc('availabilities', STATE.user.uid, payload);
    // Reflète localement dans allAvails pour le matching live
    const idx = _ag.allAvails.findIndex(a => a.uid === STATE.user.uid);
    if (idx >= 0) _ag.allAvails[idx] = { id: STATE.user.uid, ...payload };
    else _ag.allAvails.push({ id: STATE.user.uid, ...payload });
    _renderSuggestions();
    _renderGroupView();
  } catch (e) { notifySaveError(e); }
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
window._agSetRecurringPattern = (preset) => {
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
};
window._agClearOverrides = async () => {
  if (!_ag.myAvail) return;
  if (!confirm('Effacer toutes tes dispos ponctuelles (les patterns récurrents sont conservés) ?')) return;
  _ag.myAvail.slots = {};
  _scheduleSave();
  _renderCalendar();
  showNotif('Dispos ponctuelles effacées', 'success');
};

// ── Calcul des suggestions par quête ──────────────────────────────────────
function _computeQuestSuggestions(quest, daysAhead = 28) {
  const parts = Array.isArray(quest.participants) ? quest.participants : [];
  if (parts.length === 0) return [];

  const availByUid = Object.fromEntries(_ag.allAvails.map(a => [a.uid || a.id, a]));
  const today = _today();
  const slots = [];

  for (let i = 0; i < daysAhead; i++) {
    const date = _addDays(today, i);
    const iso = _toISO(date);
    for (const slot of SLOTS) {
      const detail = parts.map(p => {
        const av = availByUid[p.uid];
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
  const myUid = STATE.user?.uid;
  const myQuests = (_ag.quests || []).filter(q => {
    if (q.statut && q.statut !== 'active') return false;
    if (STATE.isAdmin) return true; // MJ voit tout
    return Array.isArray(q.participants) && q.participants.some(p => p.uid === myUid);
  });

  if (!myQuests.length) {
    el.innerHTML = `<div class="ag-empty">
      <div class="ag-empty-ico">🎯</div>
      <div class="ag-empty-title">Aucune quête active à planifier</div>
      <div class="ag-empty-sub">Rejoins une quête pour voir les créneaux compatibles ici.</div>
    </div>`;
    return;
  }

  el.innerHTML = myQuests.map(q => {
    const sugs = _computeQuestSuggestions(q);
    if (!sugs.length) {
      return `<div class="ag-quest-card">
        <div class="ag-quest-hd">
          <span class="ag-quest-title">${_esc(q.titre || q.nom || 'Quête')}</span>
          <span class="ag-quest-count">${(q.participants||[]).length} participant${(q.participants||[]).length>1?'s':''}</span>
        </div>
        <div class="ag-quest-empty">Pas encore de créneau compatible. Demande aux joueurs de remplir leurs dispos.</div>
      </div>`;
    }
    return `<div class="ag-quest-card">
      <div class="ag-quest-hd">
        <span class="ag-quest-title">${_esc(q.titre || q.nom || 'Quête')}</span>
        <span class="ag-quest-count">${(q.participants||[]).length} participant${(q.participants||[]).length>1?'s':''}</span>
      </div>
      <div class="ag-sug-list">
        ${sugs.map((s, idx) => {
          const isFull = s.okCount === s.total;
          const isValidated = _isSessionMatch(_ag.nextSession, q.id, s.iso, s.slot.id);
          const cls = (isValidated ? 'ag-sug--validated ' : '') + (isFull ? 'ag-sug--full' : 'ag-sug--partial');
          const dateStr = _formatDateFr(s.date);
          return `<div class="ag-sug ${cls}" data-sug-idx="${idx}" data-quest-id="${q.id}"
            onclick="window._agShowSugDetail('${q.id}',${idx})">
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

window._agShowSugDetail = (questId, idx) => {
  const sug = _ag._lastSugs?.[questId]?.[idx];
  const quest = _ag.quests.find(q => q.id === questId);
  if (!sug || !quest) return;
  const date = _formatDateFr(sug.date);
  const isValidated = _isSessionMatch(_ag.nextSession, questId, sug.iso, sug.slot.id);

  const mjActions = STATE.isAdmin ? `
    <div class="ag-detail-actions">
      ${isValidated
        ? `<button class="btn btn-outline" onclick="window._agUnvalidateSession()">✕ Annuler la validation</button>`
        : `<button class="btn btn-gold" onclick="window._agValidateSlot('${questId}','${sug.iso}','${sug.slot.id}')">✓ Valider ce créneau</button>`}
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
};

// ── Helpers session validée ──────────────────────────────────────────────
function _isSessionMatch(session, questId, iso, slotId) {
  if (!session) return false;
  return session.questId === questId && session.date === iso && session.slot === slotId;
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

window._agValidateSlot = async (questId, iso, slotId) => {
  if (!STATE.isAdmin) return;
  const quest = _ag.quests.find(q => q.id === questId);
  try {
    const payload = {
      questId,
      questTitle:  quest?.titre || quest?.nom || 'Quête',
      date:        iso,
      slot:        slotId,
      validatedAt: Date.now(),
      validatedBy: STATE.user?.uid || null,
    };
    await saveDoc('agenda_session', 'next', payload);
    _ag.nextSession = payload;
    closeModal();
    showNotif('✓ Créneau validé. Visible sur le dashboard de tous.', 'success');
    _renderSessionBanner();
    _renderSuggestions();
  } catch (e) {
    if (e?.code === 'permission-denied') {
      showNotif('⚠ Règle Firestore manquante pour agenda_session (voir doc).', 'error');
    } else {
      notifySaveError(e);
    }
  }
};
window._agUnvalidateSession = async () => {
  if (!STATE.isAdmin) return;
  try {
    await deleteFromCol('agenda_session', 'next');
    _ag.nextSession = null;
    closeModal();
    showNotif('Validation annulée.', 'success');
    _renderSessionBanner();
    _renderSuggestions();
  } catch (e) {
    if (e?.code === 'permission-denied') {
      showNotif('⚠ Règle Firestore manquante pour agenda_session.', 'error');
    } else { notifySaveError(e); }
  }
};

function _renderSessionBanner() {
  const el = document.getElementById('ag-session-banner');
  if (!el) return;
  const s = _ag.nextSession;
  if (!s) { el.innerHTML = ''; el.style.display = 'none'; return; }
  const fmt = _formatSession(s);
  if (!fmt) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = `
    <div class="ag-banner">
      <div class="ag-banner-ico">🎲</div>
      <div class="ag-banner-body">
        <div class="ag-banner-eyebrow">Prochaine séance validée</div>
        <div class="ag-banner-title">${_esc(fmt.dateFr)} — ${fmt.slotLabel} <span class="ag-banner-hours">${fmt.slotHours}</span></div>
        ${fmt.questTitle ? `<div class="ag-banner-quest">Quête : ${_esc(fmt.questTitle)}</div>` : ''}
      </div>
      ${STATE.isAdmin ? `<button class="ag-banner-btn" onclick="window._agUnvalidateSession()" title="Annuler la validation">✕</button>` : ''}
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
                  onclick="window._agCycle('${iso}','${s.id}')"
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

window._agCycle = (iso, slotId) => {
  _cycleSlot(iso, slotId);
  _renderCalendar();
};

// ── Modal pattern récurrent ───────────────────────────────────────────────
window._agOpenRecurringEditor = () => {
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
              onclick="window._agRecCycle('${d.id}','${s.id}',this)"
              title="${STATE_LABELS[state]||'Non renseigné'}">${STATE_EMOJI[state]||'⚪'}</button>`;
          }).join('')}
        </div>`).join('')}
    </div>
    <div class="ag-rec-presets">
      <div class="ag-rec-presets-lbl">Raccourcis :</div>
      <button class="btn btn-outline btn-sm" onclick="window._agSetRecurringPattern('evenings')">🌙 Toutes mes soirées</button>
      <button class="btn btn-outline btn-sm" onclick="window._agSetRecurringPattern('weekends')">📅 Tous mes weekends</button>
      <button class="btn btn-outline btn-sm" onclick="window._agSetRecurringPattern('fri-eve')">🎲 Vendredi soir</button>
      <button class="btn btn-outline btn-sm" onclick="window._agSetRecurringPattern('reset')">🚫 Reset</button>
    </div>
  `);
};
window._agRecCycle = (dayId, slotId, btn) => {
  _cycleRecurring(dayId, slotId);
  const state = _ag.myAvail?.recurring?.[dayId]?.[slotId] || '';
  btn.className = `ag-rec-cell ag-slot--${state||'none'}`;
  btn.textContent = STATE_EMOJI[state] || '⚪';
  btn.title = STATE_LABELS[state] || 'Non renseigné';
  _renderCalendar();
  _renderSuggestions();
};

// ── Vue groupe (qui est dispo quand) ──────────────────────────────────────
function _renderGroupView() {
  const el = document.getElementById('ag-group-view');
  if (!el) return;
  if (!_ag.groupView) { el.innerHTML = ''; return; }

  const today = _today();
  const firstDay = _addDays(today, -((today.getDay() + 6) % 7));
  const days = [];
  for (let i = 0; i < 14; i++) days.push(_addDays(firstDay, i));

  // Liste des joueurs avec une dispo (sinon ajouter ceux des users)
  const playerUids = new Set(_ag.allAvails.map(a => a.uid || a.id));
  // Ajouter aussi les joueurs de l'aventure qui n'ont pas (encore) de doc
  (_ag.users || []).forEach(u => playerUids.add(u.id || u.uid));
  const players = [..._ag.users || [], ..._ag.allAvails.filter(a => !(_ag.users||[]).some(u => (u.id||u.uid) === (a.uid||a.id))).map(a => ({ id: a.uid||a.id, pseudo: a.pseudo }))]
    .filter((p, i, arr) => arr.findIndex(x => (x.id||x.uid) === (p.id||p.uid)) === i)
    .filter(p => (p.id||p.uid) !== STATE.user?.uid); // hors moi (j'ai déjà mon calendrier)

  if (!players.length) { el.innerHTML = ''; return; }

  el.innerHTML = `
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
            const av = _ag.allAvails.find(a => (a.uid||a.id) === uid);
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
window._agToggleGroupView = () => {
  _ag.groupView = !_ag.groupView;
  const btn = document.getElementById('ag-group-toggle');
  if (btn) btn.textContent = _ag.groupView ? '👁 Masquer la vue groupe' : '👥 Voir les dispos du groupe';
  _renderGroupView();
};

// ── Page principale ───────────────────────────────────────────────────────
async function renderAgendaPage() {
  const content = document.getElementById('main-content');
  if (!content) return;
  content.innerHTML = `<div class="loading"><div class="spinner"></div> Chargement de l'agenda…</div>`;

  // Charge en parallèle
  const [avails, quests, users, nextSession] = await Promise.all([
    loadCollection('availabilities').catch(() => []),
    loadCollection('quests').catch(() => []),
    loadCollection('users').catch(() => []),
    getDocDataSilent('agenda_session', 'next'),
  ]);

  _ag.allAvails   = avails;
  _ag.quests      = quests;
  _ag.users       = users;
  _ag.nextSession = nextSession;
  _ag.myAvail     = avails.find(a => (a.uid || a.id) === STATE.user?.uid) || { slots: {}, recurring: {} };

  content.innerHTML = `
    <div class="ag-root">

      <div class="ag-hero">
        <div class="ag-hero-text">
          <h1 class="ag-hero-title">📅 Agenda du groupe</h1>
          <p class="ag-hero-sub">Marque tes dispos, on calcule les meilleurs créneaux pour vos prochaines sessions.</p>
        </div>
        <div class="ag-hero-actions">
          <button class="btn btn-gold" onclick="window._agOpenRecurringEditor()">📆 Mon planning récurrent</button>
          <button class="btn btn-outline" id="ag-group-toggle" onclick="window._agToggleGroupView()">👥 Voir les dispos du groupe</button>
        </div>
      </div>

      <div id="ag-session-banner"></div>

      <section class="ag-section">
        <h2 class="ag-section-title">🎯 Sessions compatibles</h2>
        <p class="ag-section-sub">Top 5 créneaux par quête, basés sur les dispos de tous les participants.</p>
        <div id="ag-suggestions" class="ag-suggestions"></div>
      </section>

      <section class="ag-section">
        <div class="ag-section-hd">
          <h2 class="ag-section-title">🗓 Mon calendrier</h2>
          <div class="ag-section-actions">
            <button class="btn btn-outline btn-sm" onclick="window._agClearOverrides()" title="Efface les dispos ponctuelles (les patterns récurrents restent)">🧹 Effacer ponctuelles</button>
          </div>
        </div>
        <p class="ag-section-sub">Clic sur un créneau pour cycler : <span class="ag-legend">⚪</span> rien → <span class="ag-legend ag-slot--ok">✅</span> ok → <span class="ag-legend ag-slot--maybe">❓</span> peut-être → <span class="ag-legend ag-slot--no">❌</span> non. Les créneaux <em>récurrents</em> sont automatiquement appliqués.</p>
        <div id="ag-calendar" class="ag-calendar"></div>
      </section>

      <section class="ag-section">
        <div id="ag-group-view" class="ag-group-view"></div>
      </section>

    </div>
  `;

  _renderSessionBanner();
  _renderSuggestions();
  _renderCalendar();
  _renderGroupView();
}

PAGES.agenda = renderAgendaPage;
export default renderAgendaPage;
