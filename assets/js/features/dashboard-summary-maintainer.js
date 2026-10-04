// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD-SUMMARY-MAINTAINER — Le client MJ tient `settings/dashboardSummary` à jour
// ──────────────────────────────────────────────────────────────────────────────
// Observation PASSIVE : on ne s'accroche qu'aux collections déjà amorcées en
// session-live par les pages du MJ (dashboard, Trame, Hauts-faits, Collection).
// Aucune lecture supplémentaire, sauf si le MJ MODIFIE une source non chargée
// (événement `app:data-written`) : elle est alors amorcée pour que le résumé
// reste exact. Le résumé n'est réécrit (1 écriture) que si son contenu change.
// Les joueurs lisent ce seul document au lieu des trois collections complètes
// (cf. shared/dashboard-summary.js).
// ══════════════════════════════════════════════════════════════════════════════
import { STATE } from '../core/state.js';
import {
  getCachedCollection, subscribeCollection, subscribeDoc, replaceDoc, getCurrentAdventureId,
} from '../data/firestore.js';
import { buildDashboardSummary, sameSummary } from '../shared/dashboard-summary.js';

const SOURCES = ['story', 'achievements', 'collection'];
const WRITE_DELAY_MS = 3000;
const SOURCE_CHECK_MS = 4000;

let _adventureId = null;
let _unsubs = [];
let _observed = new Set();
let _data = {};            // collection → dernières données observées
let _stored;               // doc stocké ; undefined tant qu'il n'est pas connu
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
  if (!next.story || sameSummary(next, _stored)) return;
  const previous = _stored;
  _stored = next;            // évite une 2ᵉ écriture identique avant le snapshot
  replaceDoc('settings', 'dashboardSummary', { ...next, updatedAt: Date.now() }).catch(() => {
    if (_stored === next) _stored = previous;
    _dirty = true;           // réessayé au prochain changement ou flush
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

// S'accroche aux sources déjà chargées. Ne déclenche JAMAIS leur amorçage :
// getCachedCollection ne renvoie une valeur que si le listener live a répondu.
function _observeLoadedSources() {
  if (!_adventureId || _adventureId !== getCurrentAdventureId()) return;
  for (const col of SOURCES) {
    if (!_observed.has(col) && getCachedCollection(col) !== null) _observe(col);
  }
}

// Le MJ vient de modifier une source qu'il n'avait pas chargée (ex. haut-fait
// créé depuis la Trame après une arrivée directe sur une autre page) : sans
// elle, le résumé des joueurs resterait périmé. Seul cas où l'on amorce.
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
  document.addEventListener('app:page-changed', () => _observeLoadedSources());
  document.addEventListener('app:data-written', _onDataWritten);
  document.addEventListener('visibilitychange', () => { if (document.hidden) _flush(); });
  window.addEventListener('pagehide', () => _flush());
  document.addEventListener('app:session-releasing', () => {
    _flush();
    stopDashboardSummaryMaintainer();
  });
}

export function stopDashboardSummaryMaintainer() {
  _unsubs.forEach(unsub => { try { unsub?.(); } catch { /* listener déjà libéré */ } });
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
  // Changement d'aventure : un éventuel résumé en attente de l'ancienne
  // aventure est abandonné (son scope Firestore n'est plus le bon).
  stopDashboardSummaryMaintainer();
  _adventureId = adventureId;
  _bindEvents();
  _unsubs.push(subscribeDoc('settings', 'dashboardSummary', doc => {
    _stored = doc || null;
    if (_dirty) _schedule();
  }, { silent: true }));
  _checkTimer = setInterval(() => { if (!document.hidden) _observeLoadedSources(); }, SOURCE_CHECK_MS);
  _observeLoadedSources();
}
