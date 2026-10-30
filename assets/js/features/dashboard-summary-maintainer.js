// Le client MJ maintient le résumé v2 lu par le tableau de bord des joueurs.
// Story et quests restent observés passivement lorsqu'ils sont déjà amorcés ;
// le document agenda, compact, est le seul abonnement nécessaire en permanence.

import { STATE } from '../core/state.js';
import {
  getCachedCollection, subscribeCollection, subscribeDoc, replaceDoc, getCurrentAdventureId,
} from '../data/firestore.js';
import { buildDashboardSummary, sameSummary } from '../shared/dashboard-summary.js';

const SOURCES = ['story', 'quests'];
const WRITE_DELAY_MS = 3000;
const SOURCE_CHECK_MS = 4000;

let _adventureId = null;
let _unsubs = [];
let _observed = new Set();
let _data = {};
let _stored;
let _writeTimer = null;
let _checkTimer = null;
let _dirty = false;
let _eventsBound = false;

function _flush() {
  clearTimeout(_writeTimer);
  _writeTimer = null;
  if (!_dirty || _stored === undefined || !_adventureId || _adventureId !== getCurrentAdventureId()) return;
  _dirty = false;
  const next = buildDashboardSummary(_data, _stored);
  if (!Array.isArray(next.groups) || !Array.isArray(next.sessions) || sameSummary(next, _stored)) return;
  const previous = _stored;
  _stored = next;
  replaceDoc('settings', 'dashboardSummary', { ...next, updatedAt: Date.now() }).catch(() => {
    if (_stored === next) _stored = previous;
    _dirty = true;
  });
}

function _schedule() {
  _dirty = true;
  clearTimeout(_writeTimer);
  _writeTimer = setTimeout(_flush, WRITE_DELAY_MS);
}

function _observe(col) {
  _observed.add(col);
  _unsubs.push(subscribeCollection(col, data => {
    _data[col] = Array.isArray(data) ? data : [];
    _schedule();
  }));
  if (_observed.size === SOURCES.length && _checkTimer) {
    clearInterval(_checkTimer);
    _checkTimer = null;
  }
}

function _observeLoadedSources() {
  if (!_adventureId || _adventureId !== getCurrentAdventureId()) return;
  for (const col of SOURCES) {
    if (!_observed.has(col) && getCachedCollection(col) !== null) _observe(col);
  }
}

function _onDataWritten(event) {
  const col = event?.detail?.col;
  if (!_adventureId || _adventureId !== getCurrentAdventureId()) return;
  if (!SOURCES.includes(col) || _observed.has(col)) return;
  if (event.detail.path !== `adventures/${_adventureId}/${col}`) return;
  _observe(col);
}

function _bindEvents() {
  if (_eventsBound) return;
  _eventsBound = true;
  document.addEventListener('app:page-changed', _observeLoadedSources);
  document.addEventListener('app:data-written', _onDataWritten);
  document.addEventListener('visibilitychange', () => { if (document.hidden) _flush(); });
  window.addEventListener('pagehide', _flush);
  document.addEventListener('app:session-releasing', () => {
    _flush();
    stopDashboardSummaryMaintainer();
  });
}

export function stopDashboardSummaryMaintainer() {
  _unsubs.forEach(unsub => { try { unsub?.(); } catch { /* déjà détaché */ } });
  _unsubs = [];
  _observed = new Set();
  _data = {};
  _stored = undefined;
  _dirty = false;
  clearTimeout(_writeTimer);
  _writeTimer = null;
  if (_checkTimer) clearInterval(_checkTimer);
  _checkTimer = null;
  _adventureId = null;
}

export function startDashboardSummaryMaintainer() {
  if (!STATE.isAdmin) return;
  const adventureId = getCurrentAdventureId();
  if (!adventureId) return;
  if (_adventureId === adventureId) { _observeLoadedSources(); return; }
  stopDashboardSummaryMaintainer();
  _adventureId = adventureId;
  _bindEvents();
  _unsubs.push(subscribeDoc('settings', 'dashboardSummary', doc => {
    _stored = doc || null;
    if (_dirty) _schedule();
  }, { silent: true }));
  _unsubs.push(subscribeDoc('agenda_session', 'next', doc => {
    _data.agenda = doc;
    _schedule();
  }, { silent: true }));
  _checkTimer = setInterval(() => { if (!document.hidden) _observeLoadedSources(); }, SOURCE_CHECK_MS);
  _observeLoadedSources();
}
