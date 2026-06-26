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
let _musicSearch   = ''; // filtre texte unique (vue unifiée), persisté en session
let _musicCloseOut = null;
let _musicProgTimer = null;
let _musicSortables = [];   // instances Sortable actives
let _previewEl     = null;  // aperçu local MJ (non diffusé)
let _lastAppliedSeek = 0;   // dernier seekVersion appliqué (évite de re-seeker à chaque resync)

// ── Refs Firestore (sons / playlists / état musique) ────────────────
const _sonsCol       = ()  => collection(db, `adventures/${aid()}/vttSons`);
const _sonRef        = id  => doc(db, `adventures/${aid()}/vttSons/${id}`);
const _playlistsCol  = ()  => collection(db, `adventures/${aid()}/vttPlaylists`);
const _playlistRef   = id  => doc(db, `adventures/${aid()}/vttPlaylists/${id}`);
const _musicStateRef = ()  => doc(db, `adventures/${aid()}/vtt/music`);

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
  if (panel) { panel.dataset.open='0'; panel.style.display='none'; }
  document.getElementById('vtt-music-trigger')?.classList.remove('active');
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

// État replié/déplié des catégories — persisté localement (par utilisateur)
const _CAT_COLLAPSE_KEY = 'vtt:musicCollapsed';
function _loadCollapseMap() {
  try { return JSON.parse(localStorage.getItem(_CAT_COLLAPSE_KEY) || '{}') || {}; }
  catch { return {}; }
}
function _isCatCollapsed(catId) { return !!_loadCollapseMap()[catId]; }
function _setCatCollapsed(catId, collapsed) {
  const map = _loadCollapseMap();
  if (collapsed) map[catId] = true; else delete map[catId];
  try { localStorage.setItem(_CAT_COLLAPSE_KEY, JSON.stringify(map)); } catch {}
}
function _vttToggleMusicCat(catId) {
  const cat = document.querySelector(`.vtt-music-cat[data-cat-id="${CSS.escape(catId)}"]`);
  if (!cat) return;
  const collapsed = cat.dataset.collapsed === '1';
  cat.dataset.collapsed = collapsed ? '0' : '1';
  _setCatCollapsed(catId, !collapsed);
}
function _vttToggleAllMusicCats() {
  const cats = document.querySelectorAll('.vtt-music-body .vtt-music-cat');
  if (!cats.length) return;
  const collapseAll = [...cats].some(c => c.dataset.collapsed !== '1');
  cats.forEach(c => {
    c.dataset.collapsed = collapseAll ? '1' : '0';
    _setCatCollapsed(c.dataset.catId, collapseAll);
  });
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
  panel.dataset.open='1'; panel.style.display='flex';
  document.getElementById('vtt-music-trigger')?.classList.add('active');
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
  // Mémorise le défilement de la liste : le re-render via innerHTML (ex. au
  // changement de musique) la remettrait sinon en haut.
  const prevScroll = panel.querySelector('.vtt-music-body')?.scrollTop || 0;
  const mj = STATE.isAdmin;
  const ms = _musicState;
  const playing = !!(ms.playing && ms.currentSoundId);
  const curSound = playing ? _sounds.find(s=>s.id===ms.currentSoundId) : null;

  // Joueurs : panel minimal — uniquement en lecture + volume
  if (!mj) {
    panel.innerHTML = `
      <div class="vtt-music-hd">
        <span>🎵 Musique</span>
        <button class="vtt-ms-close" data-vtt-fn="_vttToggleMusic">✕</button>
      </div>
      ${_renderNowPlaying(curSound, ms)}`;
  } else {
    panel.innerHTML = `
      <div class="vtt-music-hd">
        <span>🎵 Sons &amp; Musique</span>
        <button class="vtt-ms-close" data-vtt-fn="_vttToggleMusic">✕</button>
      </div>
      <div class="vtt-music-body">${_renderMusicList(mj)}</div>
      ${_renderNowPlaying(curSound, ms)}`;
  }

  // Bind champ de recherche — filtre unique persisté en session
  const sf = panel.querySelector('#vtt-music-search');
  if (sf) {
    sf.value = _musicSearch || '';
    sf.oninput = e => {
      _musicSearch = e.target.value;
      _applyMusicFilter(e.target.value);
    };
    _applyMusicFilter(sf.value);
  }
  // Bind volume slider local — préférence par utilisateur (localStorage)
  const vsl = panel.querySelector('#vtt-music-vol');
  if (vsl) {
    vsl.value = Math.round(_getUserVolume() * 100);
    vsl.oninput = e => {
      const v = _setUserVolume(+e.target.value / 100);
      if (_audioEl)   _audioEl.volume = v;
      if (_previewEl) _previewEl.volume = v;
    };
  }
  // Barre de progression
  clearInterval(_musicProgTimer);
  if (_audioEl && !_audioEl.paused) {
    _musicProgTimer = setInterval(_updateMusicProg, 500);
  }
  // Sortables + clic droit sur les catégories (MJ uniquement — vue unifiée).
  // Le contextmenu est lié en direct car l'en-tête porte déjà un data-vtt-fn
  // (toggle au clic) et le dispatcher ne gère qu'un handler par élément.
  if (mj) {
    _initMusicSortable();
    panel.querySelectorAll('.vtt-music-pl-hd').forEach(hd => {
      hd.oncontextmenu = e => {
        e.preventDefault();
        const plId = hd.closest('.vtt-music-cat')?.dataset.catId;
        if (plId) _vttPlaylistCtxMenu(e, plId);
      };
    });
  }

  // Restaure le défilement capturé avant le re-render.
  const body = panel.querySelector('.vtt-music-body');
  if (body) body.scrollTop = prevScroll;
}

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

// Filtre la vue unifiée par texte : masque les catégories sans match,
// auto-déplie les catégories qui en ont un. Préserve l'état persisté quand
// le champ est vidé. NB: on utilise style.display car les items portent
// `display: flex` (classe) qui bat la règle UA `[hidden]{display:none}`.
function _applyMusicFilter(query) {
  const q = _norm(query || '');
  const root = document.querySelector('.vtt-music-body'); if (!root) return;
  const text = el => _norm(el?.textContent || '');
  const show = (el, ok) => { if (el) el.style.display = ok ? '' : 'none'; };

  root.querySelectorAll('.vtt-music-cat').forEach(cat => {
    const catId = cat.dataset.catId;
    const catNameEl = cat.querySelector('.vtt-music-cat-name');
    const catMatch = !q || text(catNameEl).includes(q);
    const sons = cat.querySelectorAll('[data-sound-id]');
    let anySonMatch = false;
    sons.forEach(s => {
      const nameEl = s.querySelector('.vtt-music-pool-name, .vtt-music-pl-sname');
      const ok = !q || catMatch || text(nameEl).includes(q);
      show(s, ok);
      if (ok && q) anySonMatch = true;
    });
    if (q) {
      const visible = catMatch || anySonMatch;
      show(cat, visible);
      // Force déplie pendant une recherche (sans toucher au localStorage)
      if (visible) cat.dataset.collapsed = '0';
    } else {
      show(cat, true);
      cat.dataset.collapsed = _isCatCollapsed(catId) ? '1' : '0';
    }
  });
}

// Rendu unifié : pool "Non classés" + playlists, tous pliables.
function _renderMusicList(mj) {
  let h = `<div class="vtt-music-search-row">
    <input type="search" id="vtt-music-search" class="vtt-music-search"
      placeholder="🔍 Rechercher un son ou une catégorie…" autocomplete="off">
    <button class="vtt-music-collapse-all" data-vtt-fn="_vttToggleAllMusicCats" title="Tout replier / déplier">⇕</button>
  </div>`;

  if (mj) {
    const hideOn = !!_musicState.hideTitle;
    h += `<div class="vtt-music-son-actions-row">
      <button class="vtt-music-upload-btn" data-vtt-fn="_vttAddSonUrl" style="flex:1" title="Ajouter un son via URL">＋ URL</button>
      <button class="vtt-music-upload-btn" data-vtt-fn="_vttImportGithubRelease" style="flex:1.4" title="Importer depuis une release GitHub">📥 GitHub</button>
      <button class="vtt-music-upload-btn" data-vtt-fn="_vttCreatePlaylist" style="flex:1.2" title="Créer une nouvelle catégorie/playlist">＋ Catégorie</button>
    </div>
    <div class="vtt-music-son-actions-row">
      <button class="vtt-music-upload-btn${hideOn?' on':''}" data-vtt-fn="_vttMusicToggleHideTitle" style="flex:1"
        title="${hideOn?'Les joueurs ne voient pas le nom des musiques — clic pour réafficher':'Masquer le nom des musiques aux joueurs'}">
        ${hideOn?'🙈 Titres masqués aux joueurs':'👁 Titres visibles par les joueurs'}</button>
    </div>`;
  }

  if (!_sounds.length && !_playlists.length) {
    const msg = _musicCatalogLoading ? 'Chargement des sons…' : 'Aucun son — ajoutez une URL ou importez depuis GitHub';
    return h + `<div class="vtt-music-empty">${msg}</div>`;
  }

  // "Non classés" : sons absents de toute playlist
  const usedIds = new Set(_playlists.flatMap(pl => pl.soundIds || []));
  const poolSounds = _sounds.filter(s => !usedIds.has(s.id));
  if (poolSounds.length) {
    const collapsed = _isCatCollapsed('pool');
    h += `<div class="vtt-music-cat" data-cat-id="pool" data-collapsed="${collapsed?1:0}">
      <div class="vtt-music-cat-hd" data-vtt-fn="_vttToggleMusicCat" data-vtt-args="pool">
        <span class="vtt-music-cat-chevron"></span>
        <span class="vtt-music-cat-name">📦 Non classés</span>
        <span class="vtt-music-pl-cnt">${poolSounds.length}</span>
      </div>
      <div class="vtt-music-cat-body">
        <div class="vtt-music-pool" id="vtt-music-pool">
          ${poolSounds.map(s => _renderSonRow(s, null, mj)).join('')}
        </div>
      </div>
    </div>`;
  }

  if (_playlists.length) {
    h += `<div class="vtt-music-cats" id="vtt-music-cats">` + _playlists.map(pl => {
      const active = _musicState.playing && _musicState.currentPlaylistId===pl.id;
      const sounds = (pl.soundIds||[]).map(sid=>_sounds.find(s=>s.id===sid)).filter(Boolean);
      const collapsed = _isCatCollapsed(pl.id);
      return `<div class="vtt-music-cat vtt-music-pl-item${active?' is-playing':''}" data-cat-id="${pl.id}" data-collapsed="${collapsed?1:0}">
        <div class="vtt-music-cat-hd vtt-music-pl-hd" data-vtt-fn="_vttToggleMusicCat" data-vtt-args="${pl.id}" title="Clic droit : renommer / couleur / supprimer · glisser ⠿ pour réordonner">
          ${mj?'<span class="vtt-music-cat-grip" data-vtt-fn="_vttNoop" title="Glisser pour réordonner">⠿</span>':''}
          <span class="vtt-music-cat-chevron"></span>
          <span class="vtt-music-pl-dot" style="background:${pl.color||'#6366f1'}"></span>
          <span class="vtt-music-pl-name vtt-music-cat-name">${_esc(pl.name)}</span>
          <span class="vtt-music-pl-cnt">${sounds.length}</span>
          <div class="vtt-music-son-acts" data-vtt-fn="_vttNoop">
            <button class="vtt-mact${active&&!_musicState.shuffle?' on':''}" data-vtt-fn="_vttPlayPlaylist" data-vtt-args="${pl.id}|false" title="Lire en ordre">▶</button>
            <button class="vtt-mact${active&&_musicState.shuffle?' on':''}" data-vtt-fn="_vttPlayPlaylist" data-vtt-args="${pl.id}|true" title="Aléatoire">🔀</button>
            ${mj?`<button class="vtt-mact vtt-mact-del" data-vtt-fn="_vttDeletePlaylist" data-vtt-args="${pl.id}" title="Supprimer">🗑</button>`:''}
          </div>
        </div>
        <div class="vtt-music-cat-body">
          <div class="vtt-music-pl-sounds vtt-pl-drop" id="vtt-pl-drop-${pl.id}" data-pl-id="${pl.id}">
            ${sounds.map(s => _renderSonRow(s, pl.id, mj)).join('')}
            ${!sounds.length?`<div class="vtt-music-pl-empty-drop">Glisser des sons ici</div>`:''}
          </div>
        </div>
      </div>`;
    }).join('') + `</div>`;
  }

  return h;
}

// Ligne d'un son (utilisée dans pool et dans chaque playlist)
// plId=null → son dans le pool "Non classés"
function _renderSonRow(s, plId, mj) {
  const ms = _musicState;
  const isPool = !plId;
  const isCurrent = ms.playing && ms.currentSoundId === s.id;
  const inSingleMode = isCurrent && !ms.currentPlaylistId;
  const inThisPlaylist = isCurrent && ms.currentPlaylistId === plId;
  const rowActive = inSingleMode || inThisPlaylist;
  const playOn = inSingleMode && !ms.loop;
  const loopOn = inSingleMode && !!ms.loop;
  const rowClass = isPool ? 'vtt-music-pool-item' : 'vtt-music-pl-sound';
  const nameClass = isPool ? 'vtt-music-pool-name' : 'vtt-music-pl-sname';
  const ctx = mj
    ? `data-vtt-fn="_vttSoundCtxMenu" data-vtt-on="contextmenu" data-vtt-args="$event|${s.id}${isPool?'':`|${plId}`}"`
    : '';
  const delBtn = mj
    ? (isPool
        ? `<button class="vtt-mact vtt-mact-del" data-vtt-fn="_vttDeleteSound" data-vtt-args="${s.id}" title="Supprimer définitivement">🗑</button>`
        : `<button class="vtt-mact vtt-mact-del" data-vtt-fn="_vttRemoveSoundFromPlaylist" data-vtt-args="${plId}|${s.id}" title="Retirer de la catégorie">✕</button>`)
    : '';
  return `<div class="${rowClass}${rowActive?' is-playing':''}" data-sound-id="${s.id}" title="${_esc(s.name)}" ${ctx}>
    ${mj?'<span class="vtt-music-pool-grip">⠿</span>':''}
    <span class="${nameClass}">${_esc(s.name)}</span>
    <button class="vtt-mact${playOn?' on':''}" data-vtt-fn="_vttPlaySound" data-vtt-args="${s.id}|false" title="Lire">${playOn && !ms.paused?'⏸':'▶'}</button>
    <button class="vtt-mact${loopOn?' on':''}" data-vtt-fn="_vttPlaySound" data-vtt-args="${s.id}|true" title="Boucle">🔁</button>
    <button class="vtt-mact vtt-mact-preview" data-vtt-fn="_vttPreview" data-vtt-args="${s.id}|$this" title="Aperçu local (MJ)">🎧</button>
    ${delBtn}
  </div>`;
}

// ── Initialisation Sortable ────────────────────────────────────────
function _initMusicSortable() {
  _musicSortables.forEach(s => s.destroy()); _musicSortables = [];

  // Réordonnancement des catégories (playlists) par glisser-déposer (poignée ⠿).
  const catsEl = document.getElementById('vtt-music-cats');
  if (catsEl) {
    const scrollEl = document.querySelector('.vtt-music-body') || true;
    _musicSortables.push(new Sortable(catsEl, {
      group: 'vtt-cats',
      animation: 120,
      ghostClass: 'vtt-sort-ghost',
      draggable: '.vtt-music-pl-item',
      handle: '.vtt-music-cat-grip',
      // Drag fiable dans un panneau scrollable : fallback maison + auto-scroll
      // explicite + ghost détaché du body (sinon clippé par l'overflow du panneau).
      forceFallback: true,
      fallbackOnBody: true,
      scroll: scrollEl,
      scrollSensitivity: 90,
      scrollSpeed: 18,
      bubbleScroll: true,
      onUpdate: async () => {
        const ids = [...catsEl.querySelectorAll('.vtt-music-pl-item')].map(e => e.dataset.catId).filter(Boolean);
        await Promise.all(ids.map((id, i) => updateDoc(_playlistRef(id), { order: i }).catch(() => {})));
      },
    }));
  }

  const pool = document.getElementById('vtt-music-pool');
  if (pool) {
    _musicSortables.push(new Sortable(pool, {
      group: { name: 'vtt-sounds', pull: 'clone', put: false },
      sort: false,
      animation: 120,
      ghostClass: 'vtt-sort-ghost',
      filter: '.vtt-mact',
      handle: '.vtt-music-pool-grip,.vtt-music-pool-name',
    }));
  }

  document.querySelectorAll('.vtt-pl-drop').forEach(el => {
    const plId = el.dataset.plId;
    _musicSortables.push(new Sortable(el, {
      group: { name: 'vtt-sounds', pull: false, put: true },
      animation: 120,
      ghostClass: 'vtt-sort-ghost',
      filter: '.vtt-music-pl-empty-drop,.vtt-mact',
      handle: '.vtt-music-pool-grip,.vtt-music-pl-sname',
      onAdd: async evt => {
        const soundId = evt.item.dataset.soundId;
        evt.item.remove(); // Sortable a cloné → on supprime, Firestore va re-render
        const pl = _playlists.find(p=>p.id===plId); if (!pl||!soundId) return;
        if ((pl.soundIds||[]).includes(soundId)) return;
        await updateDoc(_playlistRef(plId), { soundIds:[...(pl.soundIds||[]), soundId] }).catch(()=>{});
      },
      onUpdate: async evt => {
        const pl = _playlists.find(p=>p.id===plId); if (!pl) return;
        const items = [...el.querySelectorAll('[data-sound-id]')];
        const newOrder = items.map(i=>i.dataset.soundId).filter(Boolean);
        await updateDoc(_playlistRef(plId), { soundIds: newOrder }).catch(()=>{});
      },
    }));
  });
}

function _renderNowPlaying(curSound, ms) {
  const mj = STATE.isAdmin;
  const pl = ms.currentPlaylistId ? _playlists.find(p=>p.id===ms.currentPlaylistId) : null;
  const hidden = !!ms.hideTitle;
  // Titre masqué : les joueurs voient un libellé générique ; le MJ voit toujours
  // le vrai titre, avec un marqueur 🙈 indiquant qu'il est caché côté joueurs.
  const nameHtml = curSound
    ? ((!mj && hidden)
        ? '🎵 <em>Ambiance en cours…</em>'
        : `🎵 ${_esc(curSound.name)}${pl?` · <em>${_esc(pl.name)}</em>`:''}${ms.loop?' 🔁':''}${ms.shuffle?' 🔀':''}${mj && hidden ? ' <span class="vtt-music-np-hidetag" title="Titre masqué aux joueurs">🙈</span>' : ''}`)
    : '<span style="color:var(--text-dim)">— Rien en lecture —</span>';
  return `<div class="vtt-music-np">
    <div class="vtt-music-np-name">${nameHtml}</div>
    ${curSound ? `<div class="vtt-music-prog-row">
      <div class="vtt-music-prog-bar"${mj?' data-vtt-fn="_vttSeek" data-vtt-args="$event|$this"':''} style="${mj?'':'cursor:default'}">
        <div class="vtt-music-prog-fill" id="vtt-music-prog-fill" style="width:0%"></div>
      </div>
      <span class="vtt-music-prog-time" id="vtt-music-prog-time">0:00 / 0:00</span>
    </div>` : ''}
    <div class="vtt-music-ctrl-row">
      ${mj && curSound ? `
        <button class="vtt-music-ctrl" data-vtt-fn="_vttToggleMusicPause" title="${ms.paused?'Reprendre':'Pause'}">${ms.paused?'▶':'⏸'}</button>
        ${pl?`<button class="vtt-music-ctrl" data-vtt-fn="_vttMusicNext" title="Suivant">⏭</button>`:''}
        <button class="vtt-music-ctrl" data-vtt-fn="_vttStopMusic" title="Arrêter">⏹</button>
      ` : ''}
      <label class="vtt-music-vol-lbl">🔊<input type="range" id="vtt-music-vol" class="vtt-music-vol-inp" min="0" max="100" step="1"></label>
    </div>
  </div>`;
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
  // Toggle si même son sans playlist
  if (ms.playing && ms.currentSoundId===soundId && !ms.currentPlaylistId && !!ms.loop===!!loop)
    return _vttStopMusic();
  await _setMusicState({ playing:true, paused:false, currentSoundId:soundId,
    currentPlaylistId:null, loop:!!loop, shuffle:false,
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
  await _setMusicState({ playing:true, paused:false,
    currentSoundId:pl.soundIds[order[0]], currentPlaylistId:playlistId,
    loop:false, shuffle:!!shuffle, shuffleOrder:order, playlistIndex:0,
    startedAt:serverTimestamp() });
}

async function _vttMusicNext() {
  const ms = _musicState;
  if (!ms.currentPlaylistId) return;
  const pl = _playlists.find(p=>p.id===ms.currentPlaylistId); if (!pl) return;
  const order = ms.shuffleOrder || pl.soundIds.map((_,i)=>i);
  const nextIdx = ((ms.playlistIndex||0) + 1) % order.length;
  await _setMusicState({ ...ms, playlistIndex:nextIdx,
    currentSoundId:pl.soundIds[order[nextIdx]], startedAt:serverTimestamp() });
}

async function _vttToggleMusicPause() {
  const paused = !_musicState.paused;
  if (_audioEl) { paused ? _audioEl.pause() : _audioEl.play().catch(()=>{}); }
  await _setMusicState({ ..._musicState, paused });
}

async function _vttStopMusic() {
  _killAudio();
  await _setMusicState({ playing:false, paused:false, currentSoundId:null, currentPlaylistId:null });
}

// MJ : masque / affiche le titre de la piste en cours côté joueurs.
async function _vttMusicToggleHideTitle() {
  if (!STATE.isAdmin) return;
  await _setMusicState({ hideTitle: !_musicState.hideTitle });
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

// Reset complet de l'état musique au teardown de la VTT (appelé depuis vtt.js).
function _resetMusicState() {
  _killAudio();
  _sounds = []; _playlists = []; _musicState = {};
  _musicCatalogStarted = false; _musicCatalogLoading = false; _musicCatalogReady = null;
  _musicSoundLoads.clear();
  _lastAppliedSeek = 0;
}

async function _setMusicState(patch) {
  if (!aid()) return;
  await setDoc(_musicStateRef(), patch, {merge:true}).catch(()=>{});
}

// ── Sync lecture ────────────────────────────────────────────────────
function _syncMusicPlayback(ms) {
  _musicState = ms;
  const panel = document.getElementById('vtt-music-panel');

  if (!ms.playing || !ms.currentSoundId) {
    _killAudio();
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

  // Nouveau son
  _killAudio();
  const el = new Audio(sound.url);
  el.dataset.soundId = ms.currentSoundId;
  el.volume = _getUserVolume();
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

  el.play().catch(err => {
    if (err.name === 'NotAllowedError')
      showNotif('🔇 Cliquez sur la page pour activer le son', 'info');
    else
      console.error('[vtt music] play() error:', err.name, err.message);
  });
  _audioEl = el;
  if (panel?.dataset.open==='1') _renderMusicPanel();
}

// ── Menu contextuel son ──────────────────────────────────────────────
// currentPlId : playlist d'où vient le clic (undefined = pool)
function _vttSoundCtxMenu(e, soundId, currentPlId) {
  if (!_playlists.length) return;
  const sound = _sounds.find(s=>s.id===soundId); if (!sound) return;

  const items = [];

  // Playlists cibles (exclut celle d'où il vient s'il y est déjà)
  const targets = _playlists.filter(pl =>
    pl.id !== currentPlId && !(pl.soundIds||[]).includes(soundId)
  );
  if (targets.length) {
    items.push({ label: `<span style="color:var(--text-dim);font-size:.65rem">Ajouter à…</span>`, fn: null });
    targets.forEach(pl => items.push({
      label: `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${pl.color||'#6366f1'};margin-right:.4rem"></span>${_esc(pl.name)}`,
      fn: () => _vttAddSoundToPlaylist(pl.id, soundId),
    }));
  }

  // Retirer de la playlist courante
  if (currentPlId) {
    if (items.length) items.push('---');
    items.push({ label: '✕ Retirer de cette playlist', fn: () => _vttRemoveSoundFromPlaylist(currentPlId, soundId) });
  }

  if (items.length) _showCtxMenu(e.clientX, e.clientY, items);
}

// ── Menu contextuel catégorie/playlist (MJ) — clic droit sur l'en-tête ──
function _vttPlaylistCtxMenu(e, plId) {
  const pl = _playlists.find(p => p.id === plId); if (!pl) return;
  _showCtxMenu(e.clientX, e.clientY, [
    { label: '✏️ Renommer / couleur', fn: () => _vttRenamePlaylist(plId) },
    { label: '🗑 Supprimer', fn: () => _vttDeletePlaylist(plId) },
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
  for (const pl of _playlists.filter(p=>(p.soundIds||[]).includes(soundId)))
    await updateDoc(_playlistRef(pl.id), { soundIds:(pl.soundIds||[]).filter(id=>id!==soundId) }).catch(()=>{});
  await deleteDoc(_sonRef(soundId)).catch(()=>{});
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
  const pl = _playlists.find(p=>p.id===plId); if (!pl) return;
  if ((pl.soundIds||[]).includes(soundId)) return;
  await updateDoc(_playlistRef(plId), { soundIds:[...(pl.soundIds||[]), soundId] }).catch(()=>{});
}

async function _vttRemoveSoundFromPlaylist(plId, soundId) {
  const pl = _playlists.find(p=>p.id===plId); if (!pl) return;
  await updateDoc(_playlistRef(plId), { soundIds:(pl.soundIds||[]).filter(id=>id!==soundId) }).catch(()=>{});
}

export {
  _applyMusicFilter,
  _closeMusicPanel,
  _fmtTime,
  _getUserVolume,
  _initMusicSortable,
  _isCatCollapsed,
  _killAudio,
  _resetMusicState,
  _loadCollapseMap,
  _loadMusicSoundById,
  _musicStateRef,
  _renderMusicList,
  _renderMusicPanel,
  _renderNowPlaying,
  _renderSonRow,
  _setCatCollapsed,
  _setMusicState,
  _setUserVolume,
  _sortSoundsByCreatedAt,
  _startMusicCatalogListeners,
  _stopPreview,
  _syncMusicPlayback,
  _updateMusicProg,
  _vttAddSonUrl,
  _vttAddSoundToPlaylist,
  _vttCreatePlaylist,
  _vttCreatePlaylistConfirm,
  _vttDeletePlaylist,
  _vttDeleteSound,
  _vttImportGithubRelease,
  _vttMusicNext,
  _vttMusicToggleHideTitle,
  _vttPlColorSelect,
  _vttRenamePlaylistConfirm,
  _vttPlayPlaylist,
  _vttPlaySound,
  _vttPreview,
  _vttRemoveSoundFromPlaylist,
  _vttSeek,
  _vttSoundCtxMenu,
  _vttStopMusic,
  _vttToggleAllMusicCats,
  _vttToggleMusic,
  _vttToggleMusicCat,
  _vttToggleMusicPause,
};
