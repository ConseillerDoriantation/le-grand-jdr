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
let _thumbs = new Map();
let _thumbFingerprints = new Map();
let _thumbGeneration = 0;

const _imageFingerprint = value => {
  const src = String(value || '');
  return src ? `${src.length}:${src.slice(0, 64)}` : '';
};

function _makeMissionThumb(src) {
  return new Promise(resolve => {
    if (!src || typeof Image === 'undefined' || typeof document === 'undefined') { resolve(''); return; }
    const image = new Image();
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(value);
    };
    // Une URL distante qui ne répond pas ne doit jamais bloquer la mise à jour
    // du résumé complet (groupes et planning compris).
    const timeout = setTimeout(() => finish(''), 5000);
    if (!String(src).startsWith('data:')) image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 48;
        canvas.height = 36;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(48 / image.naturalWidth, 36 / image.naturalHeight);
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        ctx.drawImage(image, (48 - width) / 2, (36 - height) / 2, width, height);
        finish(canvas.toDataURL('image/jpeg', .6));
      } catch { finish(''); }
    };
    image.onerror = () => finish('');
    image.src = src;
  });
}

async function _refreshMissionThumbs(story, quests) {
  // Attendre les deux sources évite de générer les vignettes des dizaines de
  // missions historiques : seuls les groupes actifs en ont besoin.
  if (!Array.isArray(story) || !Array.isArray(quests)) return;
  const generation = ++_thumbGeneration;
  const ids = new Set(quests
    .filter(quest => quest?.missionId && (quest.statut || 'active') === 'active')
    .map(quest => String(quest.missionId)));
  const missions = story.filter(item => ids.has(String(item?.id || '')));
  for (const id of [..._thumbs.keys()]) if (!ids.has(id)) _thumbs.delete(id);
  for (const id of [..._thumbFingerprints.keys()]) if (!ids.has(id)) _thumbFingerprints.delete(id);
  await Promise.all(missions.map(async mission => {
    const id = String(mission?.id || '');
    if (!id) return;
    const src = String(mission?.imageUrl || '');
    const fingerprint = _imageFingerprint(src);
    if (_thumbFingerprints.get(id) === fingerprint) return;
    if (!src) {
      _thumbFingerprints.set(id, fingerprint);
      _thumbs.delete(id);
      return;
    }
    const thumb = await _makeMissionThumb(src);
    if (generation !== _thumbGeneration) return;
    _thumbFingerprints.set(id, fingerprint);
    if (thumb) _thumbs.set(id, thumb);
    else _thumbs.delete(id);
  }));
  if (generation !== _thumbGeneration) return;
  _data.thumbs = new Map(_thumbs);
}

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
    if (col === 'story' || col === 'quests') _refreshMissionThumbs(_data.story, _data.quests).finally(_schedule);
    else _schedule();
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
  _thumbs = new Map();
  _thumbFingerprints = new Map();
  _thumbGeneration += 1;
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
