// ══════════════════════════════════════════════════════════════════════════════
// VTT-MUSIC.JS — Sons & musique d'ambiance de la Table de Jeu Virtuelle
// ══════════════════════════════════════════════════════════════════════════════
// Extrait de vtt.js (Phase 1 du découpage, voir docs/vtt-decomposition.md).
// État local (sons, playlists, lecture) ; lit l'état partagé via VS.
// Points entrants depuis vtt.js : _syncMusicPlayback (listener Firestore),
// _killAudio (teardown), handlers _vtt* (registre VTT_ACTIONS).
// ══════════════════════════════════════════════════════════════════════════════

import { db, doc, collection, addDoc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, Timestamp } from '../../config/firebase.js';
import Sortable from '../../vendor/sortable.esm.js';
import { STATE } from '../../core/state.js';
import { VS, aid } from './vtt-state.js';
import { _esc, _norm } from '../../shared/html.js';
import { openModal, confirmModal, closeModalDirect, promptModal } from '../../shared/modal.js';
import { showNotif } from '../../shared/notifications.js';
import { _showCtxMenu } from './vtt-utils.js';   // menu contextuel générique (leaf)

// ── État local musique ──────────────────────────────────────────────
// — Musique / sons
let _sounds        = [];     // [{id, name, url, createdAt}]
let _playlists     = [];     // [{id, name, color, soundIds[]}]
let _musicState    = {};     // état Firestore courant
let _musicCatalogStarted = false;
let _musicCatalogLoading = false;
let _musicCatalogReady   = null;
let _musicSoundLoads     = new Map(); // soundId → Promise lecture doc ciblée
let _audioEl       = null;   // HTMLAudioElement actif
let _musicSearch   = ''; // filtre texte de recherche, persisté en session
let _musicSel      = 'all'; // sélection du rail : 'all' | 'pool' | <playlistId>
let _musicResizeObs = null; // ResizeObserver → bascule .compact selon la largeur
let _musicCloseOut = null;
let _musicProgTimer = null;
let _musicSortables = [];   // instances Sortable actives
let _previewEl     = null;  // aperçu local MJ (non diffusé)
let _ambienceEl    = null;  // 2ᵉ canal : ambiance en boucle, jouée EN PLUS de la musique
let _lastAppliedSeek = 0;   // dernier seekVersion appliqué (évite de re-seeker à chaque resync)
let _autoplayArmed = false; // reprise auto au 1er geste si l'autoplay est bloqué (refresh)

// ── Refs Firestore (sons / playlists / état musique) ────────────────
const _sonsCol       = ()  => collection(db, `adventures/${aid()}/vttSons`);
const _sonRef        = id  => doc(db, `adventures/${aid()}/vttSons/${id}`);
const _playlistsCol  = ()  => collection(db, `adventures/${aid()}/vttPlaylists`);
const _playlistRef   = id  => doc(db, `adventures/${aid()}/vttPlaylists/${id}`);
const _musicStateRef = ()  => doc(db, `adventures/${aid()}/vtt/music`);

// ── Sprite SVG du panneau (injecté une fois) + helper d'icône ────────
const _MUSIC_SPRITE = `<svg id="vtt-ms-sprite" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="i-play" viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z"/></symbol>
<symbol id="i-pause" viewBox="0 0 24 24"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></symbol>
<symbol id="i-prev" viewBox="0 0 24 24"><path d="M18 6v12L9 12z"/><line x1="6" y1="6" x2="6" y2="18"/></symbol>
<symbol id="i-next" viewBox="0 0 24 24"><path d="M6 6v12l9-6z"/><line x1="18" y1="6" x2="18" y2="18"/></symbol>
<symbol id="i-stop" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></symbol>
<symbol id="i-loop" viewBox="0 0 24 24"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></symbol>
<symbol id="i-shuffle" viewBox="0 0 24 24"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></symbol>
<symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></symbol>
<symbol id="i-eyeoff" viewBox="0 0 24 24"><path d="M9.9 5.2A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.6 3.4"/><path d="M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><line x1="2" y1="2" x2="22" y2="22"/></symbol>
<symbol id="i-fog" viewBox="0 0 24 24"><path d="M3 8h13a3 3 0 1 0-3-3"/><path d="M3 12h17a3 3 0 1 1-3 3"/><path d="M3 16h8"/></symbol>
<symbol id="i-phones" viewBox="0 0 24 24"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/></symbol>
<symbol id="i-more" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/></symbol>
<symbol id="i-x" viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></symbol>
<symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/></symbol>
<symbol id="i-plus" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></symbol>
<symbol id="i-note" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></symbol>
<symbol id="i-inbox" viewBox="0 0 24 24"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/></symbol>
<symbol id="i-grip" viewBox="0 0 24 24"><circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="18" r="1" fill="currentColor"/><circle cx="15" cy="18" r="1" fill="currentColor"/></symbol>
</defs></svg>`;
function _ensureMusicSprite() {
  if (!document.getElementById('vtt-ms-sprite')) {
    const wrap = document.createElement('div');
    wrap.innerHTML = _MUSIC_SPRITE;
    document.body.appendChild(wrap.firstElementChild);
  }
}
// Icône SVG du panneau musique (classe .i pour le style commun de vtt.css).
const _mi = (n, cls = '') => `<svg class="i ${cls}"><use href="#i-${n}"></use></svg>`;
const _MS_WAVE = `<span class="wave"><i></i><i></i><i></i></span>`;

function _vttPlColorSelect(btn) {
  document.querySelectorAll('.vtt-pl-color-btn').forEach(b => b.classList.remove('sel'));
  btn.classList.add('sel');
}

// ═══════════════════════════════════════════════════════════════════
// MUSIQUE / SONS
// ═══════════════════════════════════════════════════════════════════

function _sortSoundsByCreatedAt(list) {
  return [...(list || [])].sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
}

function _startMusicCatalogListeners() {
  if (_musicCatalogStarted) return _musicCatalogReady || Promise.resolve();
  _musicCatalogStarted = true;
  _musicCatalogLoading = true;

  _musicCatalogReady = new Promise(resolve => {
    let soundsReady = false;
    let playlistsReady = false;
    const done = () => {
      if (!soundsReady || !playlistsReady) return;
      _musicCatalogLoading = false;
      if (document.getElementById('vtt-music-panel')?.dataset.open === '1') _renderMusicPanel();
      if (_musicState?.currentSoundId) _syncMusicPlayback(_musicState);
      resolve();
    };

    VS.unsubs.push(onSnapshot(_sonsCol(), snap => {
      _sounds = _sortSoundsByCreatedAt(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      soundsReady = true;
      if (document.getElementById('vtt-music-panel')?.dataset.open === '1') _renderMusicPanel();
      done();
    }, err => { console.warn('[vtt music] lecture vttSons refusée/échouée:', err?.code || err); soundsReady = true; done(); }));

    VS.unsubs.push(onSnapshot(_playlistsCol(), snap => {
      _playlists = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        // Ordre manuel (drag) prioritaire ; à défaut, ancienneté de création.
        .sort((a, b) => ((a.order ?? 1e9) - (b.order ?? 1e9))
          || ((a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0)));
      playlistsReady = true;
      if (document.getElementById('vtt-music-panel')?.dataset.open === '1') _renderMusicPanel();
      done();
    }, err => { console.warn('[vtt music] lecture vttPlaylists refusée/échouée:', err?.code || err); playlistsReady = true; done(); }));
  });

  return _musicCatalogReady;
}

function _loadMusicSoundById(soundId) {
  if (!soundId) return Promise.resolve(null);
  const existing = _sounds.find(s => s.id === soundId);
  if (existing) return Promise.resolve(existing);
  if (_musicSoundLoads.has(soundId)) return _musicSoundLoads.get(soundId);

  const promise = getDoc(_sonRef(soundId))
    .then(snap => {
      if (!snap.exists()) return null;
      const sound = { id: snap.id, ...snap.data() };
      _sounds = _sortSoundsByCreatedAt([..._sounds.filter(s => s.id !== sound.id), sound]);
      return sound;
    })
    .catch(e => {
      console.debug('[vtt music] son introuvable:', soundId, e?.code || e);
      return null;
    })
    .finally(() => _musicSoundLoads.delete(soundId));
  _musicSoundLoads.set(soundId, promise);
  return promise;
}

function _closeMusicPanel() {
  const panel = document.getElementById('vtt-music-panel');
  if (panel) { panel.dataset.open='0'; panel.style.display='none'; panel.setAttribute('aria-hidden', 'true'); }
  const trigger = document.getElementById('vtt-music-trigger');
  trigger?.classList.remove('active');
  trigger?.setAttribute('aria-expanded', 'false');
  if (_musicCloseOut) { document.removeEventListener('mousedown', _musicCloseOut, true); _musicCloseOut=null; }
  clearInterval(_musicProgTimer); _musicProgTimer=null;
  _musicSortables.forEach(s => s.destroy()); _musicSortables=[];
  _stopPreview();
}

function _stopPreview() {
  if (_previewEl) { _previewEl.pause(); _previewEl.src=''; _previewEl=null; }
  document.querySelectorAll('.vtt-mact-preview.on').forEach(b => b.classList.remove('on'));
}

// Préférence de volume locale à chaque utilisateur, persistée entre sessions
// pour ne pas être réinitialisée à chaque nouvelle musique.
const _USER_VOL_KEY = 'vtt:musicVolume';
function _getUserVolume() {
  const v = parseFloat(localStorage.getItem(_USER_VOL_KEY));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.7;
}
function _setUserVolume(v) {
  const clamped = Math.max(0, Math.min(1, v));
  try { localStorage.setItem(_USER_VOL_KEY, String(clamped)); } catch(e){}
  return clamped;
}

// Volume du canal Ambiance (par utilisateur, indépendant de la musique). Défaut
// plus bas : l'ambiance reste en fond sous la musique principale.
const _AMB_VOL_KEY = 'vtt:ambienceVolume';
function _getAmbienceVolume() {
  const v = parseFloat(localStorage.getItem(_AMB_VOL_KEY));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.5;
}
function _setAmbienceVolume(v) {
  const clamped = Math.max(0, Math.min(1, v));
  try { localStorage.setItem(_AMB_VOL_KEY, String(clamped)); } catch(e){}
  if (_ambienceEl) { if (_ambienceEl._fadeTimer) { clearInterval(_ambienceEl._fadeTimer); _ambienceEl._fadeTimer = null; } _ambienceEl.volume = clamped; }
  return clamped;
}

// Icône visibilité joueurs : œil (visible) / œil barré (masqué). SVG monochrome
// (currentColor) — remplace l'ancien émoji 🙈.
function _eyeSvg(off) {
  const p = off
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  return `<svg class="vtt-eye" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}


function _vttPreview(soundId, btn) {
  const sound = _sounds.find(s=>s.id===soundId); if (!sound) return;
  // Même son → stop
  if (_previewEl && _previewEl.dataset.soundId===soundId) { _stopPreview(); return; }
  _stopPreview();
  const el = new Audio(sound.url);
  el.dataset.soundId = soundId;
  el.volume = _getUserVolume();
  el.addEventListener('ended', _stopPreview);
  el.play().catch(() => showNotif('Impossible de lire ce son', 'error'));
  _previewEl = el;
  btn?.classList.add('on');
}

function _vttToggleMusic() {
  const panel = document.getElementById('vtt-music-panel'); if (!panel) return;
  if (panel.dataset.open==='1') { _closeMusicPanel(); return; }
  panel.dataset.open='1'; panel.style.display='flex'; panel.setAttribute('aria-hidden', 'false');
  const trigger = document.getElementById('vtt-music-trigger');
  trigger?.classList.add('active');
  trigger?.setAttribute('aria-expanded', 'true');
  if (STATE.isAdmin) void _startMusicCatalogListeners();
  _renderMusicPanel();
  _musicCloseOut = e => {
    const f = document.querySelector('.vtt-music-float');
    const ctx = document.getElementById('vtt-ctx-menu');
    if (f && !f.contains(e.target) && !ctx?.contains(e.target)) _closeMusicPanel();
  };
  document.addEventListener('mousedown', _musicCloseOut, true);
}

// ── Rendu du panel ──────────────────────────────────────────────────
function _renderMusicPanel() {
  const panel = document.getElementById('vtt-music-panel'); if (!panel) return;
  _ensureMusicSprite();
  const mj = STATE.isAdmin;
  const ms = _musicState;
  const playing = !!(ms.playing && ms.currentSoundId);
  const curSound = playing ? _sounds.find(s => s.id === ms.currentSoundId) : null;
  const live = playing && !ms.paused;

  // Mémorise défilement liste + rail + focus/caret de la recherche (re-render).
  const prevScroll = document.getElementById('vtt-music-list')?.scrollTop || 0;
  const prevRailScroll = document.getElementById('vtt-music-rail')?.scrollTop || 0;
  const searchActive = document.activeElement === document.getElementById('vtt-music-search');
  const caret = searchActive ? document.getElementById('vtt-music-search').selectionStart : null;

  panel.classList.toggle('player', !mj);
  _applyMusicCompact();

  const header = `<header class="vtt-ms-hd">
    <h2>${mj ? 'Sons &amp; musique' : 'Musique'}</h2>
    ${live ? '<span class="pill live"><i></i>Diffusé à la table</span>' : ''}
    <span class="grow"></span>
    ${mj ? `<button class="ib${ms.hideTitle ? ' on' : ''}" data-vtt-fn="_vttMusicToggleHideTitle" data-tip="${ms.hideTitle ? 'Réafficher les titres' : 'Masquer tous les titres'}" aria-label="Masquer les titres">${_mi(ms.hideTitle ? 'eyeoff' : 'eye')}</button>
    <button class="ib" data-vtt-fn="_vttMusicToolsMenu" data-vtt-args="$event" data-tip="Outils" aria-haspopup="menu" aria-label="Outils">${_mi('more')}</button>` : ''}
    <button class="ib" data-vtt-fn="_vttToggleMusic" data-tip="Fermer · Échap" aria-label="Fermer">${_mi('x')}</button>
  </header>`;

  panel.innerHTML = header + _renderAir(curSound, ms, mj)
    + (mj ? `<div class="lib">${_renderRail()}${_renderTracks()}</div>
      <footer class="ft"><span><kbd>Espace</kbd>pause</span><span><kbd>←</kbd><kbd>→</kbd>piste</span><span><kbd>/</kbd>chercher</span><span class="grow"></span><span>Glisser un son sur une playlist pour l'y ranger</span></footer>` : '');

  // Reflet « en cours » sur le bouton de la barre de session.
  document.getElementById('vtt-music-trigger')?.classList.toggle('live', live);

  // Recherche : re-render complet (focus + caret restaurés ci-dessous).
  const sf = document.getElementById('vtt-music-search');
  if (sf) {
    sf.value = _musicSearch || '';
    sf.oninput = e => { _musicSearch = e.target.value; _renderMusicPanel(); };
  }
  // Faders : volume local (musique) + ambiance, préférences par utilisateur.
  const bindFader = (id, outId, get, set) => {
    const el = document.getElementById(id); if (!el) return;
    const pct = Math.round(get() * 100);
    el.value = pct; el.style.setProperty('--v', pct + '%');
    const out = document.getElementById(outId); if (out) out.textContent = pct;
    el.oninput = e => {
      const p = +e.target.value;
      e.target.style.setProperty('--v', p + '%');
      const o = document.getElementById(outId); if (o) o.textContent = p;
      set(p / 100);
    };
  };
  bindFader('vtt-music-vol', 'vtt-music-vol-out', _getUserVolume, (v) => {
    const nv = _setUserVolume(v);
    if (_audioEl) { if (_audioEl._fadeTimer) { clearInterval(_audioEl._fadeTimer); _audioEl._fadeTimer = null; } _audioEl.volume = nv; }
    if (_previewEl) _previewEl.volume = nv;
  });
  bindFader('vtt-music-amb-vol', 'vtt-music-amb-out', _getAmbienceVolume, (v) => _setAmbienceVolume(v));

  // Raccourcis clavier (scopés au panneau) : Espace = pause · ←/→ = piste ·
  // « / » = focus recherche.
  panel.onkeydown = (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (mj && e.key === '/') { e.preventDefault(); document.getElementById('vtt-music-search')?.focus(); return; }
    if (!_musicState.currentSoundId) return;
    if (e.code === 'Space') { e.preventDefault(); _vttToggleMusicPause(); }
    else if (e.key === 'ArrowRight' && _musicState.currentPlaylistId) { e.preventDefault(); _vttMusicNext(); }
    else if (e.key === 'ArrowLeft'  && _musicState.currentPlaylistId) { e.preventDefault(); _vttMusicPrev(); }
  };

  // Barre de progression (rafraîchie tant qu'une piste joue).
  clearInterval(_musicProgTimer);
  if (_audioEl && !_audioEl.paused) _musicProgTimer = setInterval(_updateMusicProg, 500);

  // DnD + clic droit (piste → menu son ; entrée de rail playlist → menu playlist).
  if (mj) {
    _initMusicSortable();
    panel.querySelectorAll('.t[data-sound-id]').forEach(row => {
      // Clic sur la ligne = lecture, sauf sur un bouton ou juste après un drag.
      row.onclick = e => {
        if (_musicDragActive || e.target.closest('button, a, input')) return;
        _vttPlaySound(row.dataset.soundId, false);
      };
      row.oncontextmenu = e => {
        e.preventDefault();
        _vttSoundCtxMenu(e, row.dataset.soundId, row.dataset.plctx || undefined);
      };
    });
    panel.querySelectorAll('.pl[data-pl-id]').forEach(el => {
      el.oncontextmenu = e => { e.preventDefault(); _vttPlaylistCtxMenu(e, el.dataset.plId); };
    });
    _queueDurations();
  }

  // Restaure défilement (liste + rail) + focus/caret de la recherche.
  const list = document.getElementById('vtt-music-list');
  if (list) list.scrollTop = prevScroll;
  const railEl = document.getElementById('vtt-music-rail');
  if (railEl) railEl.scrollTop = prevRailScroll;
  if (searchActive) {
    const n = document.getElementById('vtt-music-search');
    if (n) { n.focus(); try { n.setSelectionRange(caret, caret); } catch { /* noop */ } }
  }
}

// Bascule automatique en disposition compacte selon la largeur disponible.
let _musicResizeBound = false;
function _applyMusicCompact() {
  const panel = document.getElementById('vtt-music-panel'); if (!panel) return;
  panel.classList.toggle('compact', STATE.isAdmin && window.innerWidth < 660);
  if (!_musicResizeBound) {
    _musicResizeBound = true;
    let raf = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const p = document.getElementById('vtt-music-panel');
        if (p && p.dataset.open === '1') p.classList.toggle('compact', STATE.isAdmin && window.innerWidth < 660);
      });
    });
  }
}

function _setMusicSel(sel) { _musicSel = sel; _musicSearch = ''; _renderMusicPanel(); }

function _updateMusicProg() {
  if (!_audioEl) return;
  const fill = document.getElementById('vtt-music-prog-fill');
  const time = document.getElementById('vtt-music-prog-time');
  const d = _audioEl.duration || 0;
  const c = _audioEl.currentTime || 0;
  if (fill) fill.style.width = d ? `${(c/d)*100}%` : '0%';
  if (time) time.textContent = `${_fmtTime(c)} / ${_fmtTime(d)}`;
}

function _fmtTime(s) {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s/60), sec = Math.floor(s%60);
  return `${m}:${String(sec).padStart(2,'0')}`;
}

// Durée d'une piste : champ Firestore `duration`, sinon cache client (rempli en
// arrière-plan), sinon « … » (chargement) ou « — » (échec/inconnu).
const _durCache = new Map();   // soundId → secondes
const _durQueue = [];          // file d'attente de rattrapage (MJ)
let _durBusy = false;
function _msDur(s) {
  const d = (s && s.duration > 0) ? s.duration : _durCache.get(s?.id);
  return d > 0 ? _fmtTime(d) : (_durCache.get(s?.id) === 0 ? '—' : '…');
}
// Rattrapage lazy des durées manquantes (MJ) : charge les métadonnées audio une
// par une, mémorise en cache + écrit `duration` dans vttSons (1 écriture/son).
function _queueDurations() {
  if (!STATE.isAdmin) return;
  for (const s of _sounds) {
    if (s && s.url && !(s.duration > 0) && !_durCache.has(s.id) && !_durQueue.includes(s.id)) _durQueue.push(s.id);
  }
  _pumpDurations();
}
function _pumpDurations() {
  if (_durBusy || _musicDragActive) return;   // pas de chargements pendant un drag
  // Ne pas concurrencer une piste en cours de chargement (changement de musique).
  if (_audioEl && _audioEl.readyState < 2) { setTimeout(_pumpDurations, 500); return; }
  const id = _durQueue.shift();
  if (!id) return;
  const s = _sounds.find(x => x.id === id);
  if (!s || !s.url) { _pumpDurations(); return; }
  _durBusy = true;
  const a = new Audio();
  a.preload = 'metadata';
  let done = false;
  const finish = (dur) => {
    if (done) return; done = true;
    try { a.src = ''; } catch { /* noop */ }
    const rounded = dur > 0 ? Math.round(dur) : 0;
    _durCache.set(id, rounded);
    // IMPORTANT : on N'ÉCRIT PAS dans vttSons ici. Un updateDoc déclencherait le
    // onSnapshot(vttSons) → re-render complet du panneau, en boucle sur chaque son
    // (lags, DnD cassé, lecture lente tant que la file n'est pas vidée). Le cache
    // suffit pour l'affichage ; il est reconstitué à chaque session (aucune écriture).
    // Mise à jour CIBLÉE des cellules durée (pas de re-render).
    const txt = rounded > 0 ? _fmtTime(rounded) : '—';
    try { document.querySelectorAll(`.vtt-music-panel .t[data-sound-id="${(window.CSS && CSS.escape) ? CSS.escape(id) : id}"] .dur`).forEach(c => { c.textContent = txt; }); } catch { /* noop */ }
    _durBusy = false;
    setTimeout(_pumpDurations, 180);
  };
  a.addEventListener('loadedmetadata', () => finish(a.duration || 0));
  a.addEventListener('error', () => finish(0));
  setTimeout(() => finish(a.duration || 0), 9000);   // garde-fou réseau
  a.src = s.url;
}

// Anti-« clic-lecture » après un glisser-déposer (le clic de fin de drag doit
// être ignoré). Posé par Sortable onStart, relâché peu après onEnd.
let _musicDragActive = false;
function _vttMusicSelectRail(sel) { _setMusicSel(sel); }

// Rail gauche : Tous / Non classés / séparateur / playlists.
function _renderRail() {
  const used = new Set(_playlists.flatMap(p => p.soundIds || []));
  const poolCount = _sounds.filter(s => !used.has(s.id)).length;
  const railRow = (sel, name, color, count, icon, plId) => {
    const playing = plId && _musicState.playing && _musicState.currentPlaylistId === plId && !_musicState.paused;
    return `<div class="pl${_musicSel === sel ? ' sel' : ''}" data-vtt-fn="_vttMusicSelectRail" data-vtt-args="${sel}"${plId ? ` data-drop="${plId}" data-pl-id="${plId}"` : ''} tabindex="0">
      ${icon ? _mi(icon) : `<span class="dot" style="background:${color || '#6366f1'}"></span>`}
      <span class="nm">${_esc(name)}</span>${playing ? _MS_WAVE : ''}<span class="ct">${count}</span>
      ${plId ? `<span class="pl-acts">
        <button class="ib sm" data-vtt-fn="_vttPlayPlaylist" data-vtt-args="${plId}|false" data-tip="Lire">${_mi('play')}</button>
        <button class="ib sm" data-vtt-fn="_vttPlayPlaylist" data-vtt-args="${plId}|true" data-tip="Aléatoire">${_mi('shuffle')}</button>
        <button class="ib sm" data-vtt-fn="_vttPlaylistCtxMenu" data-vtt-args="$event|${plId}" data-tip="Options" aria-haspopup="menu">${_mi('more')}</button>
      </span>` : ''}
    </div>`;
  };
  return `<aside class="rail">
    <div class="rail-hd">Bibliothèque</div>
    <div class="pls" id="vtt-music-rail">
      ${railRow('all', 'Tous les sons', null, _sounds.length, 'note', null)}
      ${railRow('pool', 'Non classés', null, poolCount, 'inbox', null)}
      <div class="pl-sep"></div>
      ${_playlists.map(p => railRow(p.id, p.name, p.color, (p.soundIds || []).length, null, p.id)).join('')}
    </div>
    <button class="rail-add" data-vtt-fn="_vttCreatePlaylist">${_mi('plus')}Nouvelle playlist</button>
  </aside>`;
}

// Colonne droite : recherche + Ajouter + en-tête de sélection + liste de pistes.
function _renderTracks() {
  const mj = STATE.isAdmin;
  const q = _norm((_musicSearch || '').trim());
  const snd = id => _sounds.find(s => s.id === id);
  const poolSounds = () => { const used = new Set(_playlists.flatMap(p => p.soundIds || [])); return _sounds.filter(s => !used.has(s.id)); };

  let head = '', body = '', listAttr = '';
  if (!_sounds.length && !_playlists.length) {
    head = `<div class="sec-hd"><h3>Bibliothèque</h3></div>`;
    body = `<div class="empty">${_musicCatalogLoading ? 'Chargement des sons…' : 'Aucun son — ajoutez une URL ou importez depuis GitHub.'}</div>`;
  } else if (q) {
    head = `<div class="sec-hd"><h3>Résultats</h3></div>`;
    const match = s => s && _norm(s.name).includes(q);
    const groups = [
      ..._playlists.map(p => ({ t: p.name, c: p.color || '#6366f1', ctx: p.id, items: (_norm(p.name).includes(q) ? (p.soundIds || []) : (p.soundIds || []).filter(id => match(snd(id)))).map(snd).filter(Boolean) })),
      { t: 'Non classés', c: 'var(--text-dim)', ctx: 'pool', items: poolSounds().filter(match) },
    ].filter(g => g.items.length);
    body = groups.length
      ? groups.map(g => `<div class="grp"><span class="dot" style="background:${g.c}"></span>${_esc(g.t)}</div>` + g.items.map((s, i) => _trackRow(s, g.ctx, i, mj)).join('')).join('')
      : `<div class="empty">Aucun son ne correspond à « ${_esc(_musicSearch)} ».</div>`;
  } else if (_musicSel === 'all') {
    head = `<div class="sec-hd"><h3>Tous les sons</h3><span class="pill">${_sounds.length}</span></div>`;
    body = _sounds.length ? _sounds.map((s, i) => _trackRow(s, 'all', i, mj)).join('') : `<div class="empty">Aucun son.</div>`;
  } else if (_musicSel === 'pool') {
    const ps = poolSounds();
    head = `<div class="sec-hd"><h3>Non classés</h3><span class="pill">${ps.length}</span></div>`;
    body = ps.length ? ps.map((s, i) => _trackRow(s, 'pool', i, mj)).join('') : `<div class="empty">Tous les sons sont rangés.</div>`;
  } else {
    const p = _playlists.find(x => x.id === _musicSel);
    if (!p) { _musicSel = 'all'; return _renderTracks(); }
    const active = _musicState.playing && _musicState.currentPlaylistId === p.id;
    head = `<div class="sec-hd"><span class="dot" style="background:${p.color || '#6366f1'}"></span><h3>${_esc(p.name)}</h3>
      <button class="btn${active ? ' ghost' : ''}" data-vtt-fn="_vttPlayPlaylist" data-vtt-args="${p.id}|false">${_mi(active && !_musicState.paused ? 'pause' : 'play')}${active ? (_musicState.paused ? 'Reprendre' : 'En cours') : 'Lire'}</button>
      <button class="ib${active && _musicState.shuffle ? ' on' : ''}" data-vtt-fn="_vttPlayPlaylist" data-vtt-args="${p.id}|true" data-tip="Lecture aléatoire">${_mi('shuffle')}</button>
      <button class="ib" data-vtt-fn="_vttPlaylistCtxMenu" data-vtt-args="$event|${p.id}" data-tip="Renommer, couleur, supprimer" aria-haspopup="menu">${_mi('more')}</button></div>`;
    const sounds = (p.soundIds || []).map(snd).filter(Boolean);
    body = sounds.length ? sounds.map((s, i) => _trackRow(s, p.id, i, mj)).join('') : `<div class="empty">Glissez des sons ici depuis « Tous les sons ».</div>`;
    listAttr = ` data-pl-id="${p.id}"`;
  }

  const tools = `<div class="tr-hd">
    <label class="search">${_mi('search')}<input id="vtt-music-search" type="search" placeholder="Rechercher un son, une playlist…" value="${_esc(_musicSearch || '')}" autocomplete="off"><kbd>/</kbd></label>
    ${mj ? `<button class="btn" data-vtt-fn="_vttMusicAddMenu" data-vtt-args="$event" aria-haspopup="menu">${_mi('plus')}Ajouter</button>` : ''}
  </div>`;
  return `<div class="tracks">${tools}${head}<div class="list" id="vtt-music-list"${listAttr}>${body}</div></div>`;
}

// Ligne de piste. ctx : 'all' | 'pool' | <playlistId>. Clic = lecture.
function _trackRow(s, ctx, i, mj) {
  const ms = _musicState;
  const inPlaylist = (ctx !== 'all' && ctx !== 'pool') ? ctx : null;
  const isCurrent = ms.playing && ms.currentSoundId === s.id &&
    (inPlaylist ? ms.currentPlaylistId === inPlaylist : (ctx === 'all' || !ms.currentPlaylistId));
  const paused = !!ms.paused;
  const isAmb = ms.ambienceSoundId === s.id;
  const titleHidden = s.hideTitle === true;
  const previewing = _previewEl && _previewEl.dataset.soundId === s.id;
  return `<div class="t${isCurrent ? ' cur' : ''}${isAmb ? ' isamb' : ''}" data-sound-id="${s.id}"${inPlaylist ? ` data-plctx="${inPlaylist}"` : ''} title="${_esc(s.name)}">
    <span class="n"><span class="num">${i + 1}</span><span class="ph">${_mi(isCurrent && !paused ? 'pause' : 'play')}</span>${_MS_WAVE}</span>
    <span class="nm"><span>${_esc(s.name)}</span>${mj && titleHidden ? _mi('eyeoff') : ''}${isAmb ? '<span class="ambtag">AMBIANCE</span>' : ''}</span>
    ${mj ? `<span class="qa">
      <button class="ib sm" data-vtt-fn="_vttPlaySound" data-vtt-args="${s.id}|true" data-tip="Jouer en boucle">${_mi('loop')}</button>
      <button class="ib sm amb${isAmb ? ' on' : ''}" data-vtt-fn="_vttPlayAmbience" data-vtt-args="${s.id}" data-tip="${isAmb ? "Couper l'ambiance" : 'En ambiance (par-dessus)'}">${_mi('fog')}</button>
      <button class="ib sm prev${previewing ? ' on' : ''}" data-vtt-fn="_vttPreview" data-vtt-args="${s.id}|$this" data-tip="Pré-écoute (vous seul)">${_mi('phones')}</button>
      <button class="ib sm" data-vtt-fn="_vttSoundCtxMenu" data-vtt-args="$event|${s.id}${inPlaylist ? '|' + inPlaylist : ''}" data-tip="Plus" aria-haspopup="menu">${_mi('more')}</button>
    </span>` : ''}
    <span class="dur">${_msDur(s)}</span>
  </div>`;
}

// ── Initialisation Sortable ────────────────────────────────────────
function _initMusicSortable() {
  _musicSortables.forEach(s => s.destroy()); _musicSortables = [];
  // Ghost détaché du body (sinon clippé par l'overflow du panneau) + auto-scroll.
  const scrollEl = document.querySelector('.vtt-music-panel .lib') || document.getElementById('vtt-music-panel') || true;
  const dragOpts = {
    forceFallback: true, fallbackOnBody: true, fallbackClass: 'vtt-ms-drag',
    animation: 0, fallbackTolerance: 6, delay: 0,
    scroll: scrollEl, scrollSensitivity: 60, scrollSpeed: 10, bubbleScroll: true,
    onStart: () => { _musicDragActive = true; },
    onEnd: () => { setTimeout(() => { _musicDragActive = false; _pumpDurations(); }, 60); },
  };

  // Rail : réordonner les playlists + chaque entrée = zone de dépôt d'un son.
  const rail = document.getElementById('vtt-music-rail');
  if (rail) {
    _musicSortables.push(new Sortable(rail, {
      ...dragOpts, ghostClass: 'vtt-sort-ghost',
      draggable: '.pl[data-pl-id]', filter: '.ib,.pl-acts',
      onUpdate: async () => {
        const ids = [...rail.querySelectorAll('.pl[data-pl-id]')].map(e => e.dataset.plId).filter(Boolean);
        await Promise.all(ids.map((id, i) => updateDoc(_playlistRef(id), { order: i }).catch(() => {})));
      },
    }));
    rail.querySelectorAll('.pl[data-drop]').forEach(el => {
      const plId = el.dataset.drop;
      _musicSortables.push(new Sortable(el, {
        group: { name: 'vtt-sounds', pull: false, put: true }, sort: false, animation: 0, ghostClass: 'vtt-sort-ghost',
        onAdd: async evt => {
          const soundId = evt.item.dataset.soundId; evt.item.remove();
          const pl = _playlists.find(p => p.id === plId); if (!pl || !soundId) return;
          if ((pl.soundIds || []).includes(soundId)) { showNotif('Déjà dans cette playlist.', 'info'); return; }
          await updateDoc(_playlistRef(plId), { soundIds: [...(pl.soundIds || []), soundId] }).catch(() => {});
        },
      }));
    });
  }

  // Liste de pistes : source (clone → dépôt sur le rail) + réordonnancement
  // interne uniquement quand une playlist est sélectionnée (data-pl-id).
  const list = document.getElementById('vtt-music-list');
  const plId = list?.dataset.plId || null;
  if (list) {
    _musicSortables.push(new Sortable(list, {
      ...dragOpts, ghostClass: 'vtt-sort-ghost',
      group: { name: 'vtt-sounds', pull: 'clone', put: false }, sort: !!plId,
      draggable: '.t[data-sound-id]', filter: '.ib,.btn,.qa,.grp,.empty,.sec-hd',
      onUpdate: async () => {
        if (!plId) return;
        const ids = [...list.querySelectorAll('.t[data-sound-id]')].map(e => e.dataset.soundId).filter(Boolean);
        await updateDoc(_playlistRef(plId), { soundIds: ids }).catch(() => {});
      },
    }));
  }
}

// Zone Diffusion : canal Musique + canal Ambiance + table de mixage (faders).
function _renderAir(curSound, ms, mj) {
  const pl = ms.currentPlaylistId ? _playlists.find(p => p.id === ms.currentPlaylistId) : null;
  const hiddenForSound = typeof ms.currentTitleHidden === 'boolean' ? ms.currentTitleHidden : curSound?.hideTitle === true;
  const hidden = !!ms.hideTitle || hiddenForSound;
  const paused = !!ms.paused;

  // ── Canal Musique ──
  let title;
  if (!curSound) title = `<div class="np-title idle"><b>Rien en lecture</b></div>`;
  else if (!mj && hidden) title = `<div class="np-title">${_MS_WAVE}<b>Ambiance en cours…</b></div>`;
  else title = `<div class="np-title">${_MS_WAVE}<b>${_esc(curSound.name)}</b>${mj && hidden ? `<span class="masked">${_mi('eyeoff')}Masqué</span>` : ''}</div>`;

  const src = (curSound && mj)
    ? `<div class="np-src">${pl
        ? `<span class="dot" style="background:${pl.color || '#6366f1'}"></span>${_esc(pl.name)} <em>· ${(pl.soundIds || []).indexOf(curSound.id) + 1}/${(pl.soundIds || []).length}${ms.shuffle ? ' · aléatoire' : ''}</em>`
        : `<em>Piste seule${ms.loop ? ' · en boucle' : ''}</em>`}</div>`
    : '';

  const prog = curSound ? `<div class="prog">
      <div class="vtt-music-prog-bar prog-bar"${mj ? ' data-vtt-fn="_vttSeek" data-vtt-args="$event|$this"' : ' style="cursor:default"'}><div><b class="vtt-music-prog-fill" id="vtt-music-prog-fill" style="width:0%"></b></div></div>
      <time class="vtt-music-prog-time" id="vtt-music-prog-time">0:00 / 0:00</time>
    </div>` : '';

  const ctrls = (mj && curSound) ? `<div class="ctrls">
      ${pl ? `<button class="ib" data-vtt-fn="_vttMusicPrev" data-tip="Précédent · ←">${_mi('prev')}</button>` : ''}
      <button class="play" data-vtt-fn="_vttToggleMusicPause" aria-label="${paused ? 'Reprendre' : 'Pause'}">${_mi(paused ? 'play' : 'pause')}</button>
      ${pl ? `<button class="ib" data-vtt-fn="_vttMusicNext" data-tip="Suivant · →">${_mi('next')}</button>` : ''}
      <span class="sep"></span>
      ${pl
        ? `<button class="ib${ms.shuffle ? ' on' : ''}" data-vtt-fn="_vttPlayPlaylist" data-vtt-args="${pl.id}|true" data-tip="Aléatoire">${_mi('shuffle')}</button>`
        : `<button class="ib${ms.loop ? ' on' : ''}" data-vtt-fn="_vttToggleLoop" data-tip="Boucle">${_mi('loop')}</button>`}
      <button class="ib${hiddenForSound ? ' on' : ''}" data-vtt-fn="_vttMusicToggleSoundTitle" data-vtt-args="${curSound.id}" data-tip="${hiddenForSound ? 'Afficher le titre aux joueurs' : 'Masquer le titre aux joueurs'}">${_mi(hiddenForSound ? 'eyeoff' : 'eye')}</button>
      <button class="ib" data-vtt-fn="_vttStopMusic" data-tip="Arrêter">${_mi('stop')}</button>
    </div>` : '';

  const music = `<div class="ch music${paused ? ' paused' : ''}"><span class="ch-tag">Musique</span><div class="ch-main">${title}${src}${prog}</div>${ctrls}</div>`;

  // ── Canal Ambiance ── (toujours visible MJ ; joueur : seulement si active)
  const ambId = ms.ambienceSoundId || null;
  const ambSound = ambId ? _sounds.find(s => s.id === ambId) : null;
  const ambName = ambSound ? (mj ? _esc(ambSound.name) : 'Ambiance') : 'Aucune ambiance';
  const amb = (mj || ambSound)
    ? `<div class="ch amb"><span class="ch-tag">Ambiance</span><div class="amb-row${ambSound ? '' : ' idle'}">${ambSound ? _MS_WAVE : ''}<b>${ambName}</b></div>${mj && ambSound ? `<button class="ib sm" data-vtt-fn="_vttStopAmbience" data-tip="Couper l'ambiance">${_mi('stop')}</button>` : '<span></span>'}</div>`
    : '';

  // ── Table de mixage (faders par utilisateur, localStorage) ──
  const fader = (id, outId, cls, lbl) => `<div class="fader ${cls}"><output id="${outId}">0</output><input type="range" id="${id}" min="0" max="100" step="1" style="--v:0%" aria-label="Volume ${lbl}"><label>${lbl}</label></div>`;
  const mix = `<div class="mix">${fader('vtt-music-vol', 'vtt-music-vol-out', 'm', 'Mus.')}${(mj || ambSound) ? fader('vtt-music-amb-vol', 'vtt-music-amb-out', 'a', 'Amb.') : ''}</div>`;

  return `<div class="air"><div class="air-chs">${music}${amb}</div>${mix}</div>`;
}

// ── Seek sur clic barre de progression (MJ) ────────────────────────
// Clic = sauter à la position cliquée. Pour une piste partagée non bouclée,
// on rediffuse la position à toute la table en réécrivant `startedAt` (le
// mécanisme de sync existant) + un `seekVersion` qui fait re-seeker les clients
// déjà en lecture. Boucle / pause → seek local au MJ uniquement.
async function _vttSeek(e, bar) {
  if (!STATE.isAdmin || !_audioEl || !_audioEl.duration) return;
  const rect = bar.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const target = ratio * _audioEl.duration;
  _audioEl.currentTime = target;   // feedback immédiat côté MJ
  _updateMusicProg();
  if (_musicState.loop || _musicState.paused) return;   // pas de sync pertinente → local
  _lastAppliedSeek = (_musicState.seekVersion || 0) + 1; // déjà appliqué localement
  await _setMusicState({
    startedAt: Timestamp.fromMillis(Date.now() - Math.round(target * 1000)),
    seekVersion: _lastAppliedSeek,
  });
}

// ── Lecture / contrôles ─────────────────────────────────────────────
async function _vttPlaySound(soundId, loop) {
  const ms = _musicState;
  const sound = _sounds.find(s => s.id === soundId);
  // Toggle si même son sans playlist
  if (ms.playing && ms.currentSoundId===soundId && !ms.currentPlaylistId && !!ms.loop===!!loop)
    return _vttStopMusic();
  await _setMusicState({ playing:true, paused:false, currentSoundId:soundId,
    currentPlaylistId:null, loop:!!loop, shuffle:false,
    currentTitleHidden:sound?.hideTitle === true,
    startedAt:serverTimestamp() });
}

async function _vttPlayPlaylist(playlistId, shuffle) {
  const pl = _playlists.find(p=>p.id===playlistId);
  if (!pl || !pl.soundIds?.length) return;
  const ms = _musicState;
  // Toggle si même playlist + même mode
  if (ms.playing && ms.currentPlaylistId===playlistId && !!ms.shuffle===!!shuffle)
    return _vttStopMusic();
  // Ordre (Fisher-Yates si shuffle)
  const order = pl.soundIds.map((_,i)=>i);
  if (shuffle) {
    for (let i=order.length-1;i>0;i--) {
      const j=Math.floor(Math.random()*(i+1));
      [order[i],order[j]]=[order[j],order[i]];
    }
  }
  const soundId = pl.soundIds[order[0]];
  const sound = _sounds.find(s => s.id === soundId);
  await _setMusicState({ playing:true, paused:false,
    currentSoundId:soundId, currentPlaylistId:playlistId,
    loop:false, shuffle:!!shuffle, shuffleOrder:order, playlistIndex:0,
    currentTitleHidden:sound?.hideTitle === true,
    startedAt:serverTimestamp() });
}

async function _vttMusicNext() {
  const ms = _musicState;
  if (!ms.currentPlaylistId) return;
  const pl = _playlists.find(p=>p.id===ms.currentPlaylistId); if (!pl) return;
  const order = ms.shuffleOrder || pl.soundIds.map((_,i)=>i);
  const nextIdx = ((ms.playlistIndex||0) + 1) % order.length;
  const soundId = pl.soundIds[order[nextIdx]];
  const sound = _sounds.find(s => s.id === soundId);
  await _setMusicState({ ...ms, playlistIndex:nextIdx,
    currentSoundId:soundId, currentTitleHidden:sound?.hideTitle === true,
    startedAt:serverTimestamp() });
}

async function _vttMusicPrev() {
  const ms = _musicState;
  if (!ms.currentPlaylistId) return;
  const pl = _playlists.find(p=>p.id===ms.currentPlaylistId); if (!pl) return;
  const order = ms.shuffleOrder || pl.soundIds.map((_,i)=>i);
  const prevIdx = ((ms.playlistIndex||0) - 1 + order.length) % order.length;
  const soundId = pl.soundIds[order[prevIdx]];
  const sound = _sounds.find(s => s.id === soundId);
  await _setMusicState({ ...ms, playlistIndex:prevIdx,
    currentSoundId:soundId, currentTitleHidden:sound?.hideTitle === true,
    startedAt:serverTimestamp() });
}

// Bascule la boucle du son courant (mode single uniquement — appliquée en direct
// via _syncMusicPlayback sans redémarrer la piste).
async function _vttToggleLoop() {
  const ms = _musicState;
  if (!ms.currentSoundId || ms.currentPlaylistId) return;
  await _setMusicState({ loop: !ms.loop });
}

async function _vttToggleMusicPause() {
  const paused = !_musicState.paused;
  if (_audioEl) { paused ? _audioEl.pause() : _audioEl.play().catch(()=>{}); }
  await _setMusicState({ ..._musicState, paused });
}

async function _vttStopMusic() {
  // Pas de _killAudio() ici : l'arrêt passe par l'état → _syncMusicPlayback applique
  // un fondu de sortie (identique pour le MJ et les joueurs).
  await _setMusicState({ playing:false, paused:false, currentSoundId:null, currentPlaylistId:null });
}

// MJ : lance/arrête un son sur le canal Ambiance (boucle, en plus de la musique).
// Re-cliquer sur le son d'ambiance courant l'arrête.
async function _vttPlayAmbience(soundId) {
  if (!STATE.isAdmin) return;
  const next = _musicState.ambienceSoundId === soundId ? null : soundId;
  await _setMusicState({ ambienceSoundId: next });
}
async function _vttStopAmbience() {
  if (!STATE.isAdmin) return;
  await _setMusicState({ ambienceSoundId: null });
}

// MJ : masque / affiche tous les titres côté joueurs.
async function _vttMusicToggleHideTitle() {
  if (!STATE.isAdmin) return;
  await _setMusicState({ hideTitle: !_musicState.hideTitle });
}

// MJ : masque / affiche uniquement le titre de la piste choisie côté joueurs.
async function _vttMusicToggleSoundTitle(soundId) {
  if (!STATE.isAdmin) return;
  const sound = _sounds.find(s => s.id === soundId);
  if (!sound) return;
  const hideTitle = sound.hideTitle !== true;
  try {
    await updateDoc(_sonRef(soundId), { hideTitle });
    if (_musicState.currentSoundId === soundId) {
      await _setMusicState({ currentTitleHidden: hideTitle });
    }
    showNotif(hideTitle ? 'Titre masqué aux joueurs' : 'Titre affiché aux joueurs', 'success');
  } catch (error) {
    console.error('[vtt music] title visibility:', error);
    showNotif('Impossible de modifier la visibilité du titre', 'error');
  }
}

function _killAudio() {
  if (_audioEl) {
    _audioEl.pause();
    if (_audioEl._endedHandler)  _audioEl.removeEventListener('ended', _audioEl._endedHandler);
    if (_audioEl._errorHandler)  _audioEl.removeEventListener('error', _audioEl._errorHandler);
    _audioEl.src=''; _audioEl=null;
  }
  clearInterval(_musicProgTimer); _musicProgTimer=null;
}

function _killAmbience() {
  if (_ambienceEl) {
    if (_ambienceEl._fadeTimer) clearInterval(_ambienceEl._fadeTimer);
    if (_ambienceEl._errorHandler) _ambienceEl.removeEventListener('error', _ambienceEl._errorHandler);
    _ambienceEl.pause(); _ambienceEl.src=''; _ambienceEl=null;
  }
}

// Autoplay bloqué (ex. après un rafraîchissement de page : le navigateur exige
// un geste utilisateur avant de jouer du son). On arme une reprise unique au
// premier geste (clic/touche/toucher) qui relance la piste + l'ambiance en
// attente — plus besoin de relancer la musique à la main.
function _armAutoplayResume() {
  if (_autoplayArmed) return;
  _autoplayArmed = true;
  const events = ['pointerdown', 'keydown', 'touchstart'];
  const resume = () => {
    _autoplayArmed = false;
    events.forEach(ev => document.removeEventListener(ev, resume, true));
    // Les éléments existent déjà (créés mais bloqués) : un simple play() suffit,
    // le fondu d'entrée se déclenche sur l'évènement 'playing'.
    if (_audioEl && _audioEl.paused && _musicState?.playing && !_musicState?.paused) _audioEl.play().catch(() => {});
    if (_ambienceEl && _ambienceEl.paused) _ambienceEl.play().catch(() => {});
  };
  events.forEach(ev => document.addEventListener(ev, resume, true));
}

// ── Fondus (fade in/out + crossfade) ─────────────────────────────────
const _FADE_MS     = 700;   // musique principale
const _AMB_FADE_MS = 900;   // ambiance (un peu plus douce)

// Rampe linéaire du volume d'un élément audio vers `target` sur `ms`.
function _fade(el, target, ms, onDone) {
  if (!el) { onDone?.(); return; }
  if (el._fadeTimer) { clearInterval(el._fadeTimer); el._fadeTimer = null; }
  const start = el.volume;
  const t0 = performance.now();
  if (ms <= 0 || start === target) { el.volume = Math.max(0, Math.min(1, target)); onDone?.(); return; }
  el._fadeTimer = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    el.volume = Math.max(0, Math.min(1, start + (target - start) * k));
    if (k >= 1) { clearInterval(el._fadeTimer); el._fadeTimer = null; onDone?.(); }
  }, 40);
}

// Fait disparaître un élément (fade → 0) puis le libère. Détache ses handlers
// pour que sa fin/erreur pendant le fondu ne déclenche pas l'auto-avance.
function _fadeOutAndDispose(el, ms) {
  if (!el) return;
  if (el._endedHandler) el.removeEventListener('ended', el._endedHandler);
  if (el._errorHandler) el.removeEventListener('error', el._errorHandler);
  _fade(el, 0, ms, () => { try { el.pause(); el.src = ''; } catch {} });
}

// Fondu de sortie de la piste principale courante, puis nettoyage.
function _fadeOutCurrent(ms) {
  const el = _audioEl;
  clearInterval(_musicProgTimer); _musicProgTimer = null;
  _audioEl = null;
  _fadeOutAndDispose(el, ms);
}

// Applique l'état ambiance (ms.ambienceSoundId) au 2ᵉ canal audio, indépendamment
// de la musique principale (elle peut jouer ou non). En boucle, volume dédié.
function _syncAmbience(ms) {
  const id = ms?.ambienceSoundId || null;
  if (!id) { const el = _ambienceEl; _ambienceEl = null; _fadeOutAndDispose(el, _AMB_FADE_MS); return; }
  // Même ambiance déjà en cours → rien à faire (juste garder le volume à jour).
  if (_ambienceEl && _ambienceEl.dataset.soundId === id && !_ambienceEl.ended) {
    if (!_ambienceEl._fadeTimer) _ambienceEl.volume = _getAmbienceVolume();
    return;
  }
  const sound = _sounds.find(s => s.id === id);
  if (!sound) {
    // Joueur (ou catalogue pas encore prêt) : charge le son ciblé puis réessaie.
    const loader = STATE.isAdmin
      ? _startMusicCatalogListeners().then(() => _sounds.find(s => s.id === id) || null)
      : _loadMusicSoundById(id);
    loader.then(found => { if (found && _musicState?.ambienceSoundId === id) _syncAmbience(_musicState); });
    return;
  }
  const old = _ambienceEl;
  const el = new Audio(sound.url);
  el.dataset.soundId = id;
  el.loop = true;
  el.volume = 0;   // fondu d'entrée
  // Handler nommé + stocké sur l'élément : _fadeOutAndDispose / _killAmbience le
  // retirent avant `src=''` pour ne pas déclencher une fausse « injouable » à l'arrêt.
  const onAmbErr = () => {
    console.error('[vtt music] ambiance audio error:', el.error?.code, sound.url);
    if (STATE.isAdmin) showNotif(`🔇 Ambiance « ${sound.name} » injouable — vérifier l'URL`, 'error');
    _killAmbience();
  };
  el._errorHandler = onAmbErr;
  el.addEventListener('error', onAmbErr, { once: true });
  el.addEventListener('playing', () => _fade(el, _getAmbienceVolume(), _AMB_FADE_MS), { once:true });
  el.play().catch(err => {
    if (err.name === 'NotAllowedError') _armAutoplayResume();   // reprise auto silencieuse
    else console.error('[vtt music] ambiance play():', err.name, err.message);
  });
  _ambienceEl = el;
  if (old && old !== el) _fadeOutAndDispose(old, _AMB_FADE_MS);   // crossfade
}

// Reset de l'état musique au (re)montage de la VTT (appelé depuis vtt.js).
// `keepAudio` : conserve la lecture en cours à travers un remontage de la table
// (retour sur l'onglet). La musique ne se coupe donc pas : les éléments audio
// survivent, et _syncMusicPlayback les reconnaît (dataset.soundId) sans les
// recréer. On préserve aussi _lastAppliedSeek pour éviter un re-seek parasite.
// Le catalogue/état est quand même réinitialisé → les listeners se ré-abonnent
// proprement, puis la lecture est reconciliée sans redémarrage.
function _resetMusicState(keepAudio = false) {
  if (!keepAudio) {
    _killAudio();
    _killAmbience();
    _lastAppliedSeek = 0;
  }
  _sounds = []; _playlists = []; _musicState = {};
  _musicCatalogStarted = false; _musicCatalogLoading = false; _musicCatalogReady = null;
  _musicSoundLoads.clear();
}

// Écriture « fire-and-forget » : on N'ATTEND PAS l'accusé serveur. Le onSnapshot
// local (_syncMusicPlayback) applique l'effet immédiatement ; attendre setDoc
// bloquait les boutons (spinner infini) sur réseau lent. L'écriture part quand
// même en arrière-plan et se propage aux autres clients.
function _setMusicState(patch) {
  if (!aid()) return Promise.resolve();
  setDoc(_musicStateRef(), patch, { merge: true }).catch(() => {});
  return Promise.resolve();
}

// ── Sync lecture ────────────────────────────────────────────────────
function _syncMusicPlayback(ms) {
  _musicState = ms;
  const panel = document.getElementById('vtt-music-panel');

  // Canal Ambiance : géré à chaque changement d'état, indépendamment de la
  // musique principale (l'ambiance continue même si la musique est arrêtée).
  _syncAmbience(ms);

  if (!ms.playing || !ms.currentSoundId) {
    _fadeOutCurrent(_FADE_MS);   // fondu de sortie plutôt qu'une coupure sèche
    if (panel?.dataset.open==='1') _renderMusicPanel();
    return;
  }

  if (ms.paused) {
    if (_audioEl && !_audioEl.paused) _audioEl.pause();
    if (panel?.dataset.open==='1') _renderMusicPanel();
    return;
  }

  const sound = _sounds.find(s=>s.id===ms.currentSoundId);
  if (!sound) {
    const loader = STATE.isAdmin
      ? _startMusicCatalogListeners().then(() => _sounds.find(s => s.id === ms.currentSoundId) || null)
      : _loadMusicSoundById(ms.currentSoundId);
    loader.then(found => {
      if (found && _musicState?.currentSoundId === ms.currentSoundId) _syncMusicPlayback(_musicState);
      else if (panel?.dataset.open==='1') _renderMusicPanel();
    });
    if (panel?.dataset.open==='1') _renderMusicPanel();
    return;
  }

  // Même son déjà en lecture → pas de restart
  if (_audioEl && _audioEl.dataset.soundId===ms.currentSoundId && !_audioEl.paused && !_audioEl.ended) {
    _audioEl.loop = ms.loop ?? false;
    // Seek diffusé par le MJ : on rejoue à la position partagée. Gate par
    // seekVersion → un seul saut par seek (pas de re-seek à chaque resync).
    const sv = ms.seekVersion || 0;
    if (sv !== _lastAppliedSeek) {
      _lastAppliedSeek = sv;
      if (!ms.loop && ms.startedAt && _audioEl.duration) {
        const pos = (Date.now() - (ms.startedAt?.toMillis?.() ?? Date.now())) / 1000;
        if (pos >= 0 && pos < _audioEl.duration - 0.3) _audioEl.currentTime = pos;
      }
    }
    if (panel?.dataset.open==='1') _renderMusicPanel();
    return;
  }

  // Nouveau son — crossfade avec l'ancien (fondu de sortie) + fondu d'entrée.
  const _prevEl = _audioEl;
  clearInterval(_musicProgTimer); _musicProgTimer = null;
  const el = new Audio(sound.url);
  el.dataset.soundId = ms.currentSoundId;
  el.volume = 0;                 // montée au démarrage réel (voir 'playing')
  el.loop = ms.loop ?? false;
  _lastAppliedSeek = ms.seekVersion || 0; // la position initiale est déjà gérée via startedAt

  // Sync temps (non-loop uniquement)
  if (ms.startedAt && !ms.loop) {
    el.addEventListener('loadedmetadata', () => {
      const elapsed = (Date.now() - (ms.startedAt?.toMillis?.() ?? Date.now())) / 1000;
      if (elapsed < el.duration - 0.5) el.currentTime = elapsed;
    }, {once:true});
  }

  // Auto-avance playlist (MJ uniquement pour éviter les doublons)
  if (ms.currentPlaylistId && STATE.isAdmin) {
    el._endedHandler = () => _vttMusicNext();
    el.addEventListener('ended', el._endedHandler);
  }

  // Erreur de chargement (URL inaccessible, format non supporté…)
  el._errorHandler = () => {
    const codes = {1:'Chargement interrompu', 2:'Erreur réseau', 3:'Décodage impossible', 4:'URL inaccessible'};
    const msg = codes[el.error?.code] ?? 'Erreur audio inconnue';
    console.error('[vtt music] audio error:', el.error?.code, el.error?.message, sound.url);
    showNotif(`🔇 ${msg} — vérifier l'URL du son`, 'error');
    _killAudio();
    if (document.getElementById('vtt-music-panel')?.dataset.open==='1') _renderMusicPanel();
  };
  el.addEventListener('error', el._errorHandler, {once:true});

  // Démarre le timer de progression seulement quand les métadonnées sont chargées
  el.addEventListener('loadedmetadata', () => {
    _updateMusicProg();
    if (!_musicProgTimer) _musicProgTimer = setInterval(_updateMusicProg, 500);
  }, {once:true});

  // Fondu d'entrée au démarrage réel de la lecture.
  el.addEventListener('playing', () => _fade(el, _getUserVolume(), _FADE_MS), { once:true });

  el.play().catch(err => {
    if (err.name === 'NotAllowedError')
      _armAutoplayResume();   // reprise auto SILENCIEUSE au 1er geste (aucun message)
    else
      console.error('[vtt music] play() error:', err.name, err.message);
  });
  _audioEl = el;
  if (_prevEl && _prevEl !== el) _fadeOutAndDispose(_prevEl, _FADE_MS);   // crossfade
  if (panel?.dataset.open==='1') _renderMusicPanel();
}

// ── Menu contextuel son ──────────────────────────────────────────────
// currentPlId : playlist d'où vient le clic (undefined = pool)
function _vttSoundCtxMenu(e, soundId, currentPlId) {
  const sound = _sounds.find(s=>s.id===soundId); if (!sound) return;
  const ms = _musicState;
  const inSingle = ms.playing && ms.currentSoundId === soundId && !ms.currentPlaylistId;
  const isAmb = ms.ambienceSoundId === soundId;

  const items = [
    { label: inSingle && !ms.loop ? '⏹ Arrêter' : '▶ Lire', fn: () => _vttPlaySound(soundId, false) },
    { label: inSingle && ms.loop ? '⏹ Arrêter la boucle' : '🔁 Jouer en boucle', fn: () => _vttPlaySound(soundId, true) },
    { label: isAmb ? '⏹ Arrêter l’ambiance' : '🌫 Jouer en ambiance', fn: () => _vttPlayAmbience(soundId) },
    '---',
    {
      label: sound.hideTitle === true ? `${_eyeSvg(false)} Afficher le titre aux joueurs` : `${_eyeSvg(true)} Masquer le titre aux joueurs`,
      fn: () => _vttMusicToggleSoundTitle(soundId),
    },
  ];

  // Playlists cibles (exclut celle d'où il vient s'il y est déjà)
  const targets = _playlists.filter(pl =>
    pl.id !== currentPlId && !(pl.soundIds||[]).includes(soundId)
  );
  if (targets.length) {
    items.push('---');
    items.push({ label: `<span style="color:var(--text-dim);font-size:.65rem">Ajouter à…</span>`, fn: null });
    targets.forEach(pl => items.push({
      label: `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${pl.color||'#6366f1'};margin-right:.4rem"></span>${_esc(pl.name)}`,
      fn: () => _vttAddSoundToPlaylist(pl.id, soundId),
    }));
  }

  items.push('---');
  if (currentPlId) {
    items.push({ label: '✕ Retirer de cette playlist', fn: () => _vttRemoveSoundFromPlaylist(currentPlId, soundId) });
  }
  items.push({ label: '🗑 Supprimer définitivement', fn: () => _vttDeleteSound(soundId) });

  _showCtxMenu(e.clientX, e.clientY, items);
}

// ── Menu contextuel catégorie/playlist (MJ) — clic droit sur l'en-tête ──
function _vttPlaylistCtxMenu(e, plId) {
  const pl = _playlists.find(p => p.id === plId); if (!pl) return;
  _showCtxMenu(e.clientX, e.clientY, [
    { label: '✏️ Renommer / couleur', fn: () => _vttRenamePlaylist(plId) },
    { label: '🗑 Supprimer', fn: () => _vttDeletePlaylist(plId) },
  ]);
}

// Menu déroulant « ＋ » (barre de recherche) : ajouter un son / importer / catégorie.
function _vttMusicAddMenu(e) {
  if (!STATE.isAdmin) return;
  _showCtxMenu(e.clientX, e.clientY, [
    { label: '🔗 Ajouter un son par URL', fn: () => _vttAddSonUrl() },
    { label: '📥 Importer depuis GitHub', fn: () => _vttImportGithubRelease() },
    '---',
    { label: '📁 Nouvelle catégorie', fn: () => _vttCreatePlaylist() },
  ]);
}

// Menu déroulant « ⋯ » (en-tête) : outils MJ (masquage global, nettoyage).
function _vttMusicToolsMenu(e) {
  if (!STATE.isAdmin) return;
  const hideOn = !!_musicState.hideTitle;
  _showCtxMenu(e.clientX, e.clientY, [
    { label: hideOn ? `${_eyeSvg(false)} Réafficher tous les titres aux joueurs` : `${_eyeSvg(true)} Masquer tous les titres aux joueurs`, fn: () => _vttMusicToggleHideTitle() },
    { label: '🧹 Nettoyer les sons manquants', fn: () => _vttCleanMissingSounds() },
  ]);
}

// ── Import GitHub Release ────────────────────────────────────────────
async function _vttImportGithubRelease() {
  const LS_REPO = 'vtt-music-gh-repo', LS_TAG = 'vtt-music-gh-tag';
  const defRepo = localStorage.getItem(LS_REPO) || 'ConseillerDoriantation/le-grand-jdr';
  const defTag  = localStorage.getItem(LS_TAG)  || 'sounds-v1';
  const repo = (await promptModal('Repo GitHub (owner/repo) :', { title: 'Importer depuis GitHub', default: defRepo, placeholder: 'owner/repo' }))?.trim(); if (!repo) return;
  const tag  = (await promptModal('Tag de la release :', { title: 'Importer depuis GitHub', default: defTag }))?.trim();          if (!tag)  return;
  localStorage.setItem(LS_REPO, repo); localStorage.setItem(LS_TAG, tag);

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`);
    if (!res.ok) { showNotif(`Release introuvable (${res.status})`, 'error'); return; }
    const data = await res.json();
    const audioExts = /\.(mp3|ogg|wav|flac|m4a|aac)$/i;
    const assets = (data.assets||[]).filter(a => audioExts.test(a.name));
    if (!assets.length) { showNotif('Aucun fichier audio dans cette release', 'info'); return; }

    const existingUrls = new Set(_sounds.map(s => s.url));
    const newAssets = assets.filter(a => !existingUrls.has(a.browser_download_url));
    if (!newAssets.length) { showNotif('Tous ces sons sont déjà importés', 'info'); return; }

    for (const a of newAssets) {
      const name = a.name.replace(/\.[^.]+$/, '').replace(/[._-]+/g, ' ').trim();
      await addDoc(_sonsCol(), { name, url: a.browser_download_url, createdAt: serverTimestamp(), addedBy: STATE.user?.uid||null });
    }
    showNotif(`✅ ${newAssets.length} son(s) importé(s)`, 'success');
  } catch(e) {
    console.error('[vtt music] github import:', e);
    showNotif('Erreur lors de l\'import GitHub', 'error');
  }
}

// ── Ajout d'un son par URL ───────────────────────────────────────────
async function _vttAddSonUrl() {
  const url  = (await promptModal('URL directe du fichier audio (mp3, ogg, wav…) :', { title: 'Ajouter un son', placeholder: 'https://…/son.mp3', required: true }))?.trim();
  if (!url) return;
  const name = (await promptModal('Nom du son :', { title: 'Ajouter un son', default: url.split('/').pop()?.replace(/\.[^.]+$/,'') || 'Son' }))?.trim();
  if (!name) return;
  await addDoc(_sonsCol(), { name, url, createdAt:serverTimestamp(), addedBy:STATE.user?.uid||null });
  showNotif(`✅ "${name}" ajouté`, 'success');
}

async function _vttDeleteSound(soundId) {
  const s = _sounds.find(x=>x.id===soundId); if (!s) return;
  if (!await confirmModal(`Supprimer "${s.name}" ?`)) return;
  if (_musicState.currentSoundId===soundId) await _vttStopMusic();
  if (_musicState.ambienceSoundId===soundId) await _setMusicState({ ambienceSoundId:null });
  for (const pl of _playlists.filter(p=>(p.soundIds||[]).includes(soundId)))
    await updateDoc(_playlistRef(pl.id), { soundIds:(pl.soundIds||[]).filter(id=>id!==soundId) }).catch(()=>{});
  await deleteDoc(_sonRef(soundId)).catch(()=>{});
}

// Teste si une URL audio est encore joignable via un élément Audio (marche en
// cross-origin, contrairement à fetch bloqué par CORS sur GitHub Pages/releases).
// Résout true=OK, false=fichier introuvable/erreur, 'timeout'=non vérifiable.
function _probeSoundUrl(url, timeoutMs = 10000) {
  return new Promise(resolve => {
    if (!url) { resolve(false); return; }
    const a = new Audio();
    let done = false;
    const finish = (v) => {
      if (done) return; done = true; clearTimeout(t);
      a.onloadedmetadata = a.oncanplay = a.onerror = null;
      try { a.src = ''; a.removeAttribute('src'); a.load(); } catch {}
      resolve(v);
    };
    const t = setTimeout(() => finish('timeout'), timeoutMs);
    a.preload = 'metadata';
    a.onloadedmetadata = () => finish(true);
    a.oncanplay       = () => finish(true);
    a.onerror         = () => finish(false);
    try { a.src = url; a.load(); } catch { finish(false); }
  });
}

// Nettoyage MJ : détecte les sons dont le fichier source n'existe plus (ex.
// supprimé du dépôt GitHub) et les retire de la bibliothèque + des playlists.
async function _vttCleanMissingSounds() {
  if (!STATE.isAdmin) return;
  if (!_sounds.length) { showNotif('Aucun son à vérifier.', 'info'); return; }
  showNotif(`Vérification de ${_sounds.length} son(s)…`, 'info');
  const results = await Promise.all(_sounds.map(async s => ({ s, state: await _probeSoundUrl(s.url) })));
  const dead = results.filter(r => r.state === false).map(r => r.s);
  const uncertain = results.filter(r => r.state === 'timeout').length;
  if (!dead.length) {
    showNotif(uncertain
      ? `Aucun son manquant détecté (${uncertain} non vérifiable·s).`
      : '✅ Tous les sons sont disponibles.', 'success');
    return;
  }
  const list = dead.map(s => `• ${_esc(s.name)}`).join('<br>');
  const ok = await confirmModal(
    `<b>${dead.length} son(s) introuvable(s)</b> (fichier supprimé côté source) seront retirés de la bibliothèque et des playlists :<br><br>${list}` +
    (uncertain ? `<br><br><small>${uncertain} son(s) non vérifiable(s) — conservé(s).</small>` : ''),
    { title: '🧹 Nettoyer les sons manquants', confirmLabel: 'Supprimer', icon: '🗑️' });
  if (!ok) return;
  let removed = 0;
  for (const s of dead) {
    if (_musicState.currentSoundId === s.id) await _vttStopMusic();
    if (_musicState.ambienceSoundId === s.id) await _setMusicState({ ambienceSoundId:null });
    for (const pl of _playlists.filter(p => (p.soundIds||[]).includes(s.id)))
      await updateDoc(_playlistRef(pl.id), { soundIds:(pl.soundIds||[]).filter(id=>id!==s.id) }).catch(()=>{});
    if (await deleteDoc(_sonRef(s.id)).then(() => true).catch(() => false)) removed++;
  }
  showNotif(`🧹 ${removed} son(s) supprimé(s).`, 'success');
}

// ── Playlists ───────────────────────────────────────────────────────
const PL_COLORS = ['#6366f1','#22c38e','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899'];
let _musicEditPlId = null;   // catégorie en cours d'édition (modal renommage)

// Corps de modal commun à la création et au renommage (nom + sélecteur couleur).
function _plModalBody(name, color, submitFn, submitLabel) {
  return `
    <div style="display:flex;flex-direction:column;gap:.9rem">
      <div>
        <label class="vtt-pl-modal-lbl">Nom</label>
        <input id="vtt-pl-name-inp" type="text" class="vtt-pl-modal-inp"
          placeholder="Ex : Donjon, Combat, Ambiance…" value="${_esc(name || '')}"
          data-vtt-fn="${submitFn}" data-vtt-on="keydown-enter">
      </div>
      <div>
        <label class="vtt-pl-modal-lbl">Couleur</label>
        <div class="vtt-pl-color-row">
          ${PL_COLORS.map(c=>`<button type="button" class="vtt-pl-color-btn${c===color?' sel':''}"
            data-color="${c}" style="background:${c}"
            data-vtt-fn="_vttPlColorSelect" data-vtt-args="$this">
          </button>`).join('')}
        </div>
      </div>
      <button class="vtt-pl-modal-submit" data-vtt-fn="${submitFn}">${submitLabel}</button>
    </div>`;
}

function _vttCreatePlaylist() {
  const defColor = PL_COLORS[_playlists.length % PL_COLORS.length];
  openModal('Nouvelle playlist', _plModalBody('', defColor, '_vttCreatePlaylistConfirm', 'Créer la playlist'));
  setTimeout(() => { document.getElementById('vtt-pl-name-inp')?.focus(); }, 60);
}

async function _vttCreatePlaylistConfirm() {
  const name  = document.getElementById('vtt-pl-name-inp')?.value?.trim(); if (!name) return;
  const color = document.querySelector('.vtt-pl-color-btn.sel')?.dataset.color || '#6366f1';
  closeModalDirect();
  await addDoc(_playlistsCol(), { name, color, soundIds:[], order:_playlists.length, createdAt:serverTimestamp() });
}

async function _vttDeletePlaylist(plId) {
  const pl = _playlists.find(p=>p.id===plId); if (!pl) return;
  if (!await confirmModal(`Supprimer la playlist "${pl.name}" ?`)) return;
  if (_musicState.currentPlaylistId===plId) await _vttStopMusic();
  await deleteDoc(_playlistRef(plId)).catch(()=>{});
}

function _vttRenamePlaylist(plId) {
  const pl = _playlists.find(p => p.id === plId); if (!pl) return;
  _musicEditPlId = plId;
  openModal('Modifier la catégorie', _plModalBody(pl.name || '', pl.color || '#6366f1', '_vttRenamePlaylistConfirm', 'Enregistrer'));
  setTimeout(() => { const i = document.getElementById('vtt-pl-name-inp'); i?.focus(); i?.select(); }, 60);
}

async function _vttRenamePlaylistConfirm() {
  const plId = _musicEditPlId; if (!plId) return;
  const pl = _playlists.find(p => p.id === plId); if (!pl) return;
  const name  = document.getElementById('vtt-pl-name-inp')?.value?.trim(); if (!name) return;
  const color = document.querySelector('.vtt-pl-color-btn.sel')?.dataset.color || pl.color || '#6366f1';
  closeModalDirect();
  _musicEditPlId = null;
  if (name === pl.name && color === pl.color) return;
  await updateDoc(_playlistRef(plId), { name, color }).catch(() => showNotif('Erreur lors de l\'enregistrement', 'error'));
}

async function _vttAddSoundToPlaylist(plId, soundId) {
  if (!soundId) return;
  const pl = _playlists.find(p=>p.id===plId);
  const sound = _sounds.find(s=>s.id===soundId);
  if (!pl || !sound) {
    showNotif('Playlist ou son introuvable', 'error');
    return;
  }
  const previousIds = [...(pl.soundIds || [])];
  if (previousIds.includes(soundId)) {
    showNotif(`« ${sound.name} » est déjà dans ${pl.name}`, 'info');
    return;
  }

  // Retour immédiat : "Non classés" est calculé depuis les playlists, le son
  // doit donc en disparaître dès le choix du menu, sans attendre le snapshot.
  const nextIds = [...previousIds, soundId];
  pl.soundIds = nextIds;
  try { _renderMusicPanel(); }
  catch (error) { console.warn('[vtt music] rafraîchissement optimiste:', error); }
  try {
    // setDoc + merge reste valide même si le document affiché vient encore du
    // cache local et n'existe plus côté serveur ; updateDoc échouait alors.
    await setDoc(_playlistRef(plId), { soundIds: nextIds }, { merge:true });
    showNotif(`✅ « ${sound.name} » ajouté à ${pl.name}`, 'success');
  } catch (error) {
    pl.soundIds = previousIds;
    try { _renderMusicPanel(); } catch {}
    console.error('[vtt music] ajout à la playlist:', error);
    // Surface la raison réelle (permission-denied, not-found, hors-ligne…) pour diagnostiquer.
    const why = error?.code || error?.message || String(error);
    showNotif(`Ajout impossible : ${why}`, 'error');
  }
}

async function _vttRemoveSoundFromPlaylist(plId, soundId) {
  if (!STATE.isAdmin) return;
  const pl = _playlists.find(p=>p.id===plId); if (!pl) return;
  const previousIds = [...(pl.soundIds || [])];
  const nextIds = previousIds.filter(id=>id!==soundId);
  pl.soundIds = nextIds;
  _renderMusicPanel();
  try {
    await updateDoc(_playlistRef(plId), { soundIds: nextIds });
  } catch (error) {
    pl.soundIds = previousIds;
    _renderMusicPanel();
    console.error('[vtt music] retrait de la playlist:', error);
    showNotif('Impossible de retirer ce son de la playlist', 'error');
  }
}

export {
  _closeMusicPanel,
  _fmtTime,
  _getUserVolume,
  _initMusicSortable,
  _killAudio,
  _resetMusicState,
  _loadMusicSoundById,
  _musicStateRef,
  _renderMusicPanel,
  _setMusicState,
  _setUserVolume,
  _sortSoundsByCreatedAt,
  _startMusicCatalogListeners,
  _stopPreview,
  _syncMusicPlayback,
  _updateMusicProg,
  _vttAddSonUrl,
  _vttCleanMissingSounds,
  _vttPlayAmbience,
  _vttStopAmbience,
  _vttPlaylistCtxMenu,
  _vttMusicAddMenu,
  _vttMusicToolsMenu,
  _vttAddSoundToPlaylist,
  _vttCreatePlaylist,
  _vttCreatePlaylistConfirm,
  _vttDeletePlaylist,
  _vttDeleteSound,
  _vttImportGithubRelease,
  _vttMusicNext,
  _vttMusicPrev,
  _vttToggleLoop,
  _vttMusicToggleHideTitle,
  _vttMusicToggleSoundTitle,
  _vttMusicSelectRail,
  _vttPlColorSelect,
  _vttRenamePlaylistConfirm,
  _vttPlayPlaylist,
  _vttPlaySound,
  _vttPreview,
  _vttRemoveSoundFromPlaylist,
  _vttSeek,
  _vttSoundCtxMenu,
  _vttStopMusic,
  _vttToggleMusic,
  _vttToggleMusicPause,
};
