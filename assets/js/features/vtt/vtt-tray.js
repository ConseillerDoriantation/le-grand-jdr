// ══════════════════════════════════════════════════════════════════════════════
// VTT-TRAY.JS — Panneau latéral MJ (réserve, scène, bestiaire) + gestion des pages
// ══════════════════════════════════════════════════════════════════════════════
// Extrait de vtt.js (découpage, voir docs/vtt-decomposition.md).
// Rendu du tray MJ (tokens en scène, réserve joueurs/PNJ, bestiaire), liste des
// pages (dossiers, drag&drop, recherche) et bascule de page (_switchPage).
// État de filtre/onglet persisté via localStorage. _trayTab est exporté en
// live-binding (lu par le constructeur du panneau dans vtt.js).
// Imports circulaires runtime vers vtt.js (rendu carte/tokens au switch) — OK car
// appelés à l'exécution, pas au chargement du module.
// ══════════════════════════════════════════════════════════════════════════════
import { STATE } from '../../core/state.js';
import { VS } from './vtt-state.js';
import Sortable from '../../vendor/sortable.esm.js';
import { db, setDoc, writeBatch } from '../../config/firebase.js';
import { showNotif } from '../../shared/notifications.js';
import { _esc, _searchIncludes, normalizeImageUrl } from '../../shared/html.js';
import { githubRawUrl } from '../../shared/github-folder.js';
import { _sesRef, _pgRef } from './vtt-refs.js';
import { TYPE_COLOR, hpColor } from './vtt-constants.js';
import { _live } from './vtt-effective.js';
import { _tokenEntityKey, _vttPanelError } from './vtt-utils.js';
import { _drawGrid, _renderMapImages } from './vtt-render.js';
import { fogRenderWalls, fogUpdateSoon } from './vtt-fog.js';
import { _renderCombatTracker } from './vtt-combat-tracker.js';
import { _renderMjRulerRemote } from './vtt-ruler.js';
import { _renderLibSection } from './vtt-maplib.js';
import { _MAP_IMG_DEPS, _renderAllTokens, _renderAnnotLayer, _clearHL, _deselect } from './vtt.js';

let _trayFilter       = 'all'; // filtre actif : 'all'|'player'|'npc'|'enemy'
let _traySearch       = '';    // filtre texte appliqué à la réserve
let _reserveFilter    = (() => { try { return localStorage.getItem('vtt-reserve-filter') || 'all'; } catch { return 'all'; } })();
let _bstSearch        = '';    // filtre texte appliqué au bestiaire
export let _trayTab          = (() => { try { return localStorage.getItem('vtt-tray-tab') || 'scenes'; } catch { return 'scenes'; } })(); // onglet actif du panneau MJ
let _pageSearch       = '';    // filtre texte appliqué à la liste des pages
let _pageFolderFilter = (() => { try { return localStorage.getItem('vtt-page-folder-filter') || 'all'; } catch { return 'all'; } })();
const _pageFavs = (() => {
  try { return new Set(JSON.parse(localStorage.getItem('vtt-page-favs') || '[]')); } catch { return new Set(); }
})();
const _loadPageRecents = () => {
  try { return JSON.parse(localStorage.getItem('vtt-page-recents') || '[]').filter(Boolean); } catch { return []; }
};
const _savePageFavs = () => { try { localStorage.setItem('vtt-page-favs', JSON.stringify([..._pageFavs])); } catch {} };
const _savePageRecents = ids => { try { localStorage.setItem('vtt-page-recents', JSON.stringify(ids.slice(0, 8))); } catch {} };
const _savePageFolderFilter = () => { try { localStorage.setItem('vtt-page-folder-filter', _pageFolderFilter); } catch {} };
const _pageFoldClosed = (() => { // dossiers de pages repliés (persistés)
  try { return new Set(JSON.parse(localStorage.getItem('vtt-page-folds') || '[]')); } catch { return new Set(); }
})();
const _savePageFolds = () => { try { localStorage.setItem('vtt-page-folds', JSON.stringify([..._pageFoldClosed])); } catch {} };
// Sous-sections togglables (en ligne reste toujours visible) — persistées
// par navigateur via localStorage, défaut : repliées (le MJ regarde d'abord
// les joueurs présents).
const _loadTrayPref = (k, dflt = false) => {
  try { const v = localStorage.getItem('vtt-tray-' + k); return v == null ? dflt : v === '1'; }
  catch { return dflt; }
}
const _saveTrayPref = (k, v) => { try { localStorage.setItem('vtt-tray-' + k, v ? '1' : '0'); } catch {} };
const _saveReserveFilter = () => { try { localStorage.setItem('vtt-reserve-filter', _reserveFilter); } catch {} };
let _trayOnOpen  = _loadTrayPref('on', true); // « En ligne » ouvert par défaut (joueurs présents à invoquer)
let _trayOffOpen = _loadTrayPref('off');
let _trayNpcOpen = _loadTrayPref('npc');

// Reset du filtre de recherche réserve (appelé par le teardown de vtt.js).
export function _resetTraySearch() { _traySearch = ''; }

// ═══════════════════════════════════════════════════════════════════
// TRAY — panneau latéral MJ
// ═══════════════════════════════════════════════════════════════════
export function _vttTrayFilter(f) { _trayFilter = f; _renderTraySoon(); }
export function _vttTraySearch(v) { _traySearch = String(v || ''); _renderTraySoon(); }
export function _vttTrayClearSearch() { _traySearch = ''; _renderTraySoon(); }
export function _vttReserveFilter(f) { _reserveFilter = f || 'all'; _saveReserveFilter(); _renderTraySoon(); }
export function _vttBstSearch(v) { _bstSearch = String(v || ''); _renderTraySoon(); }
export function _vttBstClearSearch() { _bstSearch = ''; _renderTraySoon(); }
// Onglets du panneau MJ (Scènes / Réserve / Bestiaire / Images) — affiche une vue à la fois.
export function _vttTrayTab(tab) {
  _trayTab = tab;
  try { localStorage.setItem('vtt-tray-tab', tab); } catch (_) {}
  document.querySelectorAll('#vtt-tray .vtt-tray-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('#vtt-tray .vtt-tray-view').forEach(v => v.classList.toggle('active', v.dataset.view === tab));
}
export function _vttToggleOn() { _trayOnOpen  = !_trayOnOpen;  _saveTrayPref('on',  _trayOnOpen);  _renderTraySoon(); }
export function _vttToggleOff() { _trayOffOpen = !_trayOffOpen; _saveTrayPref('off', _trayOffOpen); _renderTraySoon(); }
export function _vttToggleNpc() { _trayNpcOpen = !_trayNpcOpen; _saveTrayPref('npc', _trayNpcOpen); _renderTraySoon(); }

// Coalesce les rafales de snapshots (chrs/npcs/bsts/toks au mount) → 1 render par tick
let _trayDirty = false;
export function _renderTraySoon() {
  if (_trayDirty) return;
  _trayDirty = true;
  queueMicrotask(() => { _trayDirty = false; _renderTray(); });
}

export function _renderTray() {
  try { return _renderTrayImpl(); }
  catch (e) { _vttPanelError('Panneau MJ', e, 'vtt-tray'); }
}
export function _renderTrayImpl() {
  if (!STATE.isAdmin) { _renderPageTabs(); return; }
  // Préserve la position de défilement de la vue Scènes : sans ça, reconstruire
  // la liste des pages + les tokens de scène (au changement de scène) fait
  // remonter le panneau tout en haut.
  const _scenesView = document.querySelector('#vtt-tray .vtt-tray-view[data-view="scenes"]');
  const _scenesScroll = _scenesView ? _scenesView.scrollTop : 0;
  _renderPageList();
  _renderLibSection();

  const onlineTs = Date.now();
  const isOnline = uid => !!(uid && VS.presence[uid] && onlineTs - (VS.presence[uid].lastSeen || 0) < 120_000);
  const inCombat = !!VS.session?.combat?.active;

  const all     = Object.values(VS.tokens).map(e => e.data);
  const onPage  = all.filter(t => t.pageId === VS.activePage?.id);
  const reserveSeen = new Set();
  const reserve = all.filter(t => {
    // Réserve = persos/PNJ qui ne sont PAS sur la scène courante (sur une autre
    // page ou non placés) → le MJ peut les (ré)invoquer ici. Les ennemis sont
    // propres à chaque scène (jamais en réserve).
    if (t.type === 'enemy' || t.pageId === VS.activePage?.id) return false;
    const key = _tokenEntityKey(t);
    if (!key) return true;
    if (reserveSeen.has(key)) return false;
    reserveSeen.add(key); return true;
  });

  const ae = document.activeElement;
  const focusedSearch = ae?.classList?.contains('vtt-tray-search-input') ? ae.dataset.search : null;
  const caretPos = focusedSearch != null ? ae.selectionStart : null;
  const sourceBtn = (t, compact = false) => {
    let args = '', title = '';
    if (t.characterId) {
      args = `char|${t.characterId}|combat`;
      title = 'Ouvrir la fiche personnage';
    } else if (t.npcId) {
      args = `npc|${t.npcId}`;
      title = 'Ouvrir le PNJ source';
    } else if (t.beastId) {
      args = `bestiary|${t.beastId}`;
      title = 'Ouvrir la créature source';
    }
    return args
      ? `<span class="vtt-tray-source-btn${compact ? ' is-compact' : ''}" data-vtt-fn="_vttOpenSource" data-vtt-args="${_esc(args)}" title="${_esc(title)}">↗</span>`
      : '';
  };

  const mkItem = (t) => {
    const ld = _live(t);
    const hpKnownL = ld.displayHp !== null && ld.displayHpMax !== null;
    const hp = hpKnownL ? ld.displayHp : 0, hpm = hpKnownL ? ld.displayHpMax : 1;
    const rat = hpKnownL ? (hpm > 0 ? Math.max(0, hp / hpm) : 1) : 0.5;
    const typeIcon = t.type === 'player' ? '🧑' : t.type === 'npc' ? '👤' : '👹';
    const dupBtn = t.type === 'enemy'
      ? `<button class="vtt-tray-btn" data-vtt-fn="_vttDuplicateToken" data-vtt-args="${t.id}" title="Dupliquer">＋</button>` : '';
    const delBtn = t.type === 'enemy'
      ? `<button class="vtt-tray-btn vtt-tray-btn-del" data-vtt-fn="_vttDeleteToken" data-vtt-args="${t.id}" title="Supprimer">×</button>` : '';
    const actionBtn = `<button class="vtt-tray-btn" data-vtt-fn="_vttRetireToken" data-vtt-args="${t.id}" title="Retirer de la scène">↩</button>`;
    const hpFrac = inCombat && t.type === 'enemy' && hpKnownL
      ? `<span class="vtt-tray-hp-frac" style="color:${hpColor(rat)}">${hp}/${hpm}</span>` : '';
    return `<div class="vtt-tray-item ${VS.selected === t.id ? 'active' : ''}" data-vtt-fn="_vttSelectFromTray" data-vtt-args="${t.id}">
      <div class="vtt-tray-dot" style="background:${TYPE_COLOR[t.type] ?? '#888'}">
        ${ld.displayImage
          ? `<img src="${ld.displayImage}" alt="${_esc(ld.displayName || '')}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
          : `<span style="font-size:.65rem">${typeIcon}</span>`}
      </div>
      <div class="vtt-tray-info">
        <div class="vtt-tray-name">${_esc(ld.displayName ?? t.name)}</div>
        <div class="vtt-tray-hp-row">
          <div class="vtt-tray-hp-bar" style="flex:1"><div style="width:${Math.round(rat * 100)}%;height:100%;background:${hpKnownL ? hpColor(rat) : '#555'};border-radius:2px"></div></div>
          ${hpFrac}
        </div>
      </div>
      <div class="vtt-tray-actions">${sourceBtn(t)}${dupBtn}${actionBtn}${delBtn}</div>
    </div>`;
  };

  const mkResLine = t => {
    const ld = _live(t);
    const typeIcon = t.type === 'player' ? '🧑' : '👤';
    const col = TYPE_COLOR[t.type] ?? '#888';
    const online = t.type === 'player' && isOnline(t.ownerId);
    const pageName = t.pageId && t.pageId !== VS.activePage?.id ? (VS.pages[t.pageId]?.name || 'autre scène') : '';
    const hpKnown = ld.displayHp !== null && ld.displayHpMax !== null;
    const hpTxt = hpKnown ? `${ld.displayHp}/${ld.displayHpMax}` : '';
    const tags = [
      t.type === 'player' ? (online ? 'en ligne' : 'hors ligne') : 'PNJ',
      pageName ? `sur ${pageName}` : 'réserve',
      hpTxt ? `PV ${hpTxt}` : '',
    ].filter(Boolean);
    const statusDot = t.type === 'player'
      ? `<span class="vtt-res-line-status ${online ? 'is-online' : ''}" title="${online ? 'En ligne' : 'Hors ligne'}"></span>` : '';
    const name = _esc(ld.displayName ?? t.name);
    return `<div class="vtt-res-line ${pageName ? 'is-elsewhere' : ''}" role="button" tabindex="0" draggable="true" data-vtt-drag="token:${t.id}" data-vtt-fn="_vttPlace" data-vtt-args="${t.id}" title="Placer ${name} (clic = centre · glisser sur la carte = à l'endroit voulu)">
      <span class="vtt-res-line-dot" style="border-color:${col};color:${col}">
        ${ld.displayImage ? `<img src="${ld.displayImage}" alt="">` : `<span>${typeIcon}</span>`}
        ${statusDot}
      </span>
      <span class="vtt-res-line-main">
        <span class="vtt-res-line-name">${name}</span>
        <span class="vtt-res-line-meta">${tags.map(x => `<i>${_esc(x)}</i>`).join('')}</span>
      </span>
      <span class="vtt-res-line-actions">
        ${sourceBtn(t, true)}
        <span class="vtt-res-line-place" title="Placer sur la scène">＋</span>
      </span>
    </div>`;
  };

  const scEl = document.getElementById('vtt-scene-tokens');
  if (scEl) {
    if (!onPage.length) {
      scEl.innerHTML = `<div class="vtt-tray-empty">Aucun token sur cette scène</div>`;
    } else {
      const players = onPage.filter(t => t.type === 'player');
      const npcs    = onPage.filter(t => t.type === 'npc');
      let   enemies = onPage.filter(t => t.type === 'enemy');
      if (inCombat && enemies.length > 1) {
        enemies = [...enemies].sort((a, b) => {
          const la = _live(a), lb = _live(b);
          return ((la.displayHp ?? 1) / Math.max(1, la.displayHpMax ?? 1)) - ((lb.displayHp ?? 1) / Math.max(1, lb.displayHpMax ?? 1));
        });
      }
      const multi = [players, npcs, enemies].filter(g => g.length).length > 1;
      const grp = (icon, label, items) => !items.length ? ''
        : (multi ? `<div class="vtt-tray-sublabel">${icon} ${label}</div>` : '') + items.map(mkItem).join('');
      scEl.innerHTML = grp('🧑', 'Joueurs', players) + grp('👤', 'PNJ', npcs) + grp('👹', 'Ennemis', enemies);
    }
  }

  const reEl = document.getElementById('vtt-reserve-body');
  if (reEl) {
    const sortByName = arr => [...arr].sort((a, b) =>
      (_live(a).displayName ?? a.name ?? '').localeCompare(_live(b).displayName ?? b.name ?? '', 'fr', { sensitivity: 'base' }));
    const counts = {
      all: reserve.length,
      online: reserve.filter(t => t.type === 'player' && isOnline(t.ownerId)).length,
      offline: reserve.filter(t => t.type === 'player' && !isOnline(t.ownerId)).length,
      npc: reserve.filter(t => t.type === 'npc').length,
      elsewhere: reserve.filter(t => t.pageId && t.pageId !== VS.activePage?.id).length,
    };
    const filterMatch = t => {
      if (_reserveFilter === 'online') return t.type === 'player' && isOnline(t.ownerId);
      if (_reserveFilter === 'offline') return t.type === 'player' && !isOnline(t.ownerId);
      if (_reserveFilter === 'npc') return t.type === 'npc';
      if (_reserveFilter === 'elsewhere') return !!(t.pageId && t.pageId !== VS.activePage?.id);
      return true;
    };
    const searched = reserve.filter(t =>
      filterMatch(t)
      && (!_traySearch || _searchIncludes(`${_live(t).displayName ?? t.name ?? ''} ${VS.pages[t.pageId]?.name || ''}`, _traySearch)));
    const presentPlayers = sortByName(searched.filter(t => t.type === 'player' && isOnline(t.ownerId)));
    const absentPlayers  = sortByName(searched.filter(t => t.type === 'player' && !isOnline(t.ownerId)));
    const npcs           = sortByName(searched.filter(t => t.type === 'npc'));
    const forceOpen = !!_traySearch;
    const mkBlock = (label, items, toggleFn, open) => {
      if (!items.length) return '';
      const isOpen = open || forceOpen;
      return `<div class="vtt-tray-sublabel vtt-tray-sub-toggle" data-vtt-fn="${toggleFn}">`
        + `<span class="vtt-tray-sub-caret">${isOpen ? '▾' : '▸'}</span>${label} `
        + `<span class="vtt-tray-sublabel-n">${items.length}</span></div>`
        + (isOpen ? items.map(mkResLine).join('') : '');
    };
    const clrBtn = _traySearch ? `<button class="vtt-tray-search-clr" data-vtt-fn="_vttTrayClearSearch" title="Effacer">✕</button>` : '';
    const filterChip = (key, label, count) => `<button class="vtt-res-filter ${_reserveFilter === key ? 'active' : ''}" data-vtt-fn="_vttReserveFilter" data-vtt-args="${key}">${label}<b>${count}</b></button>`;
    const list = searched.length
      ? mkBlock('🟢 En ligne', presentPlayers, '_vttToggleOn', _trayOnOpen)
        + mkBlock('🕓 Hors ligne', absentPlayers, '_vttToggleOff', _trayOffOpen)
        + mkBlock('👤 PNJ', npcs, '_vttToggleNpc', _trayNpcOpen)
      : `<div class="vtt-tray-empty">${reserve.length ? 'Aucun résultat' : 'Réserve vide'}</div>`;
    reEl.innerHTML = `
      <div class="vtt-res-head">
        <div>
          <strong>Réserve</strong>
          <span>${searched.length}/${reserve.length} disponibles</span>
        </div>
      </div>
      <div class="vtt-tray-search">
        <span class="vtt-tray-search-ic">🔍</span>
        <input type="text" class="vtt-tray-search-input" data-search="reserve" placeholder="Rechercher perso, PNJ, scène…"
          value="${_esc(_traySearch)}" data-vtt-fn="_vttTraySearch" data-vtt-on="input" data-vtt-args="$value">
        ${clrBtn}
      </div>
      <div class="vtt-res-filters">
        ${filterChip('all', 'Tous', counts.all)}
        ${filterChip('online', 'En ligne', counts.online)}
        ${filterChip('offline', 'Hors ligne', counts.offline)}
        ${filterChip('npc', 'PNJ', counts.npc)}
        ${counts.elsewhere ? filterChip('elsewhere', 'Ailleurs', counts.elsewhere) : ''}
      </div>
      <div class="vtt-res-scroll">${list}</div>`;
  }

  const beEl = document.getElementById('vtt-bestiary-body');
  if (beEl) {
    const bsts = Object.values(VS.bestiary)
      .filter(b => !_bstSearch || _searchIncludes(b.nom || '', _bstSearch))
      .sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }));
    const clrBtn = _bstSearch ? `<button class="vtt-tray-search-clr" data-vtt-fn="_vttBstClearSearch" title="Effacer">✕</button>` : '';
    const grid = bsts.length
      ? `<div class="vtt-bst-grid">${bsts.map(b => {
          const img = normalizeImageUrl(b.imageUrl || b.photoURL || b.photo || b.avatar || b.portraitUrl || '');
          const init = (b.nom || '?')[0].toUpperCase();
          const pv = parseInt(b.pvMax ?? b.pv ?? b.hpMax ?? 0, 10) || '?';
          const ca = parseInt(b.ca ?? b.defense ?? 0, 10) || '?';
          const vit = parseInt(b.vitesse ?? b.speed ?? b.movement ?? 0, 10) || 0;
          const family = b.type || b.famille || b.categorie || '';
          return `<div class="vtt-bst-tile" role="button" tabindex="0" draggable="true" data-vtt-drag="beast:${b.id}" data-vtt-fn="_vttPlaceFromBestiary" data-vtt-args="${b.id}"
              title="${_esc(b.nom || 'Créature')} · PV ${pv} · clic = centre · glisser sur la carte = à l'endroit voulu">
            <span class="vtt-tray-source-btn is-compact" data-vtt-fn="_vttOpenSource" data-vtt-args="bestiary|${_esc(b.id)}" title="Ouvrir la créature source">↗</span>
            <div class="vtt-bst-portrait">${img ? `<img src="${_esc(img)}" alt="${_esc(b.nom || '')}" loading="lazy">` : `<span class="vtt-bst-icon">${_esc(init)}</span>`}</div>
            <div class="vtt-bst-info">
              <div class="vtt-bst-name">${_esc(b.nom || 'Créature')}</div>
              ${family ? `<div class="vtt-bst-type">${_esc(family)}</div>` : ''}
            </div>
            <div class="vtt-bst-meta">
              <span>${pv} PV</span>
              <span>${ca} CA</span>
              ${vit ? `<span>${vit} m</span>` : ''}
            </div>
          </div>`;
        }).join('')}</div>`
      : `<div class="vtt-tray-empty">${Object.keys(VS.bestiary).length ? 'Aucun résultat' : 'Bestiaire vide'}</div>`;
    beEl.innerHTML = `
      <div class="vtt-bst-head">
        <strong>Bestiaire</strong>
        <span>${bsts.length}/${Object.keys(VS.bestiary).length} créatures</span>
      </div>
      <div class="vtt-tray-search">
        <span class="vtt-tray-search-ic">🔍</span>
        <input type="text" class="vtt-tray-search-input" data-search="bestiary" placeholder="Rechercher une créature…"
          value="${_esc(_bstSearch)}" data-vtt-fn="_vttBstSearch" data-vtt-on="input" data-vtt-args="$value">
        ${clrBtn}
      </div>
      <div class="vtt-bst-scroll">${grid}</div>`;
  }

  if (focusedSearch != null) {
    const inp = document.querySelector(`.vtt-tray-search-input[data-search="${focusedSearch}"]`);
    if (inp) { inp.focus(); if (caretPos != null) { try { inp.setSelectionRange(caretPos, caretPos); } catch (_) {} } }
  }

  // Restaure le défilement après tous les rebuilds de la vue Scènes (clampé si la
  // nouvelle scène est plus courte — comportement attendu).
  if (_scenesView) _scenesView.scrollTop = _scenesScroll;
}

// ═══════════════════════════════════════════════════════════════════
// PAGES
// ═══════════════════════════════════════════════════════════════════
function _pageTokens(pageId) {
  const toks = Object.values(VS.tokens || {}).map(e => e?.data || e).filter(t => t?.pageId === pageId);
  return {
    total: toks.length,
    players: toks.filter(t => t.type === 'player').length,
    npcs: toks.filter(t => t.type === 'npc').length,
    enemies: toks.filter(t => t.type === 'enemy').length,
  };
}

function _pageFolderLabel(folder) {
  return (folder || '').trim() || 'Sans dossier';
}

function _pageSmartSort(a, b) {
  const aFav = _pageFavs.has(a.id), bFav = _pageFavs.has(b.id);
  if (aFav !== bFav) return aFav ? -1 : 1;
  return (a.order ?? 0) - (b.order ?? 0);
}

function _pageThumbUrl(p) {
  const imgs = Array.isArray(p?.backgroundImages) ? p.backgroundImages : [];
  const img = imgs.find(x => x?.url) || imgs[0];
  const raw = String(img?.url || '').trim();
  if (!raw) return '';
  if (/^\.?\/?images\/maps\//i.test(raw)) return githubRawUrl(raw);
  return normalizeImageUrl(raw);
}

function _pageCard(p, broadcastId, { compact = false } = {}) {
  const isPlayers = p.id === broadcastId;
  const isMj = p.id === VS.activePage?.id;
  const fav = _pageFavs.has(p.id);
  const stats = _pageTokens(p.id);
  const bgCount = Array.isArray(p.backgroundImages) ? p.backgroundImages.length : 0;
  const thumb = _pageThumbUrl(p);
  const cls = isMj && isPlayers ? 'mj-and-players' : isMj ? 'mj' : isPlayers ? 'players' : '';
  const status = [
    isMj ? '<span class="vtt-page-status is-mj" title="Votre vue">MJ</span>' : '',
    isPlayers ? '<span class="vtt-page-status is-live" title="Scène envoyée aux joueurs">Live</span>' : '',
    p.fogEnabled ? '<span class="vtt-page-status is-fog" title="Éclairage dynamique actif">Fog</span>' : '',
  ].join('');
  return `<div class="vtt-page-item ${cls} ${compact ? 'is-compact' : ''}" data-page-id="${p.id}" data-vtt-fn="_vttSwitchPage" data-vtt-args="${p.id}" title="${_esc(p.name)} · ${p.cols||24}×${p.rows||18} cases">
    <span class="vtt-page-item-grip" title="Glisser pour déplacer">⠿</span>
    <div class="vtt-page-thumb ${thumb ? '' : 'is-empty'}">
      ${thumb ? `<img src="${_esc(thumb)}" alt="" loading="lazy">` : '<span>∅</span>'}
    </div>
    <div class="vtt-page-item-main">
      <div class="vtt-page-item-top">
        <span class="vtt-page-item-name">${_esc(p.name)}</span>
        <button class="vtt-page-fav-btn ${fav ? 'active' : ''}" data-vtt-fn="_vttPageFavToggle" data-vtt-args="${p.id}" title="${fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}">★</button>
      </div>
      <div class="vtt-page-item-meta">
        <span>${_esc(_pageFolderLabel(p.folder))}</span>
        <span>${p.cols||24}×${p.rows||18}</span>
        ${bgCount ? `<span>${bgCount} img</span>` : ''}
        ${stats.players ? `<span title="Joueurs sur cette scène">🧑 ${stats.players}</span>` : ''}
        ${stats.npcs ? `<span title="PNJ sur cette scène">👤 ${stats.npcs}</span>` : ''}
        ${stats.enemies ? `<span title="Ennemis sur cette scène">👹 ${stats.enemies}</span>` : ''}
        ${!stats.total ? '<span class="muted">vide</span>' : ''}
      </div>
    </div>
    <div class="vtt-page-item-side">
      <div class="vtt-page-item-status">${status}</div>
      <div class="vtt-page-item-acts">
        <button class="vtt-page-item-btn primary" data-vtt-fn="_vttSendToPage" data-vtt-args="${p.id}" title="Envoyer tous les joueurs ici">📡</button>
        <button class="vtt-page-item-btn" data-vtt-fn="_vttEditPage" data-vtt-args="${p.id}" title="Renommer / dossier / taille">✏</button>
        <button class="vtt-page-item-btn vtt-page-item-del" data-vtt-fn="_vttDeletePage" data-vtt-args="${p.id}" title="Supprimer">×</button>
      </div>
    </div>
  </div>`;
}

// ─ Navigateur de scènes dans le tray (MJ) ──────────────────────────
export function _renderPageList() {
  const el=document.getElementById('vtt-tray-pages'); if (!el) return;
  const broadcastId=VS.session.activePageId;
  const all=Object.values(VS.pages).sort((a,b)=>(a.order??0)-(b.order??0));

  const ae = document.activeElement;
  const searchFocused = ae?.id === 'vtt-page-search' && el.contains(ae);
  const caretPos = searchFocused ? ae.selectionStart : null;
  const _listTop = el.querySelector('.vtt-page-list')?.scrollTop ?? 0;

  if (!all.length) {
    el.innerHTML=`<div class="vtt-tray-empty">Aucune page<br><small>Clique ＋ pour créer</small></div>`;
    return;
  }

  const q = String(_pageSearch || '').trim();
  const foldersRaw = [...new Set(all.map(p => (p.folder||'').trim()))];
  const fOrder = Array.isArray(VS.session.pageFolderOrder) ? VS.session.pageFolderOrder : [];
  const fIdx = f => { const i = fOrder.indexOf(f); return i < 0 ? 1e9 : i; };
  const orderedFolders = foldersRaw.sort((a,b)=>{
    if (a==='') return 1; if (b==='') return -1;
    const d = fIdx(a) - fIdx(b); if (d) return d;
    return a.localeCompare(b,'fr',{sensitivity:'base'});
  });
  if (_pageFolderFilter !== 'all' && !orderedFolders.includes(_pageFolderFilter)) {
    _pageFolderFilter = 'all';
    _savePageFolderFilter();
  }

  const matches = p => {
    const folder = (p.folder || '').trim();
    if (_pageFolderFilter !== 'all' && folder !== _pageFolderFilter) return false;
    if (!q) return true;
    return _searchIncludes(`${p.name || ''} ${folder}`, q);
  };

  const filtered = all.filter(matches);
  const current = VS.activePage?.id ? VS.pages[VS.activePage.id] : null;
  const broadcast = broadcastId ? VS.pages[broadcastId] : null;
  const recentIds = _loadPageRecents();
  const recents = recentIds.map(id => VS.pages[id]).filter(Boolean).filter(p => p.id !== current?.id && p.id !== broadcast?.id).slice(0, 3);
  const favs = [..._pageFavs].map(id => VS.pages[id]).filter(Boolean).filter(p => p.id !== current?.id && p.id !== broadcast?.id).sort(_pageSmartSort).slice(0, 3);
  const quick = [current, broadcast, ...favs, ...recents].filter(Boolean);
  const seenQuick = new Set();
  const quickUnique = quick.filter(p => {
    if (seenQuick.has(p.id)) return false;
    seenQuick.add(p.id);
    return true;
  });

  const folderChips = [
    `<button class="vtt-page-folder-chip ${_pageFolderFilter === 'all' ? 'active' : ''}" data-vtt-fn="_vttPageFolderFilter" data-vtt-args="all">Toutes <b>${all.length}</b></button>`,
    ...orderedFolders.map(f => {
      const count = all.filter(p => (p.folder||'').trim() === f).length;
      const arg = encodeURIComponent(f);
      return `<button class="vtt-page-folder-chip ${_pageFolderFilter === f ? 'active' : ''}" data-vtt-fn="_vttPageFolderFilter" data-vtt-args="${arg}" title="${_esc(_pageFolderLabel(f))}">${_esc(_pageFolderLabel(f))} <b>${count}</b></button>`;
    })
  ].join('');

  const groups = new Map();
  for (const p of filtered) {
    const f = (p.folder||'').trim();
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(p);
  }
  const folders = [...groups.keys()].sort((a,b)=>{
    if (a==='') return 1; if (b==='') return -1;
    const d = fIdx(a) - fIdx(b); if (d) return d;
    return a.localeCompare(b,'fr',{sensitivity:'base'});
  });

  const onlyUngrouped = folders.length === 1 && folders[0] === '';
  const flatFiltered = q || _pageFolderFilter !== 'all';
  let listHtml;
  if (!groups.size) {
    listHtml = `<div class="vtt-tray-empty">Aucune page ne correspond</div>`;
  } else if (flatFiltered || onlyUngrouped) {
    listHtml = `<div class="vtt-page-folder-body" data-folder="${_pageFolderFilter === 'all' ? '' : encodeURIComponent(_pageFolderFilter)}">${filtered.sort(_pageSmartSort).map(p => _pageCard(p, broadcastId)).join('')}</div>`;
  } else {
    listHtml = folders.map(f => {
      const rows = groups.get(f).sort((a,b)=>(a.order??0)-(b.order??0));
      const label = _pageFolderLabel(f);
      const closed = !q && _pageFoldClosed.has(f);
      const stats = rows.reduce((acc, p) => {
        const s = _pageTokens(p.id);
        acc.tokens += s.total; acc.players += s.players; acc.enemies += s.enemies;
        return acc;
      }, { tokens:0, players:0, enemies:0 });
      return `<div class="vtt-page-folder${closed?' closed':''}" data-folder="${encodeURIComponent(f)}">
        <div class="vtt-page-folder-hd" data-vtt-fn="_vttPageFolderToggle" data-vtt-args="${encodeURIComponent(f)}">
          <span class="vtt-page-folder-grip" title="Glisser pour réordonner">⠿</span>
          <span class="vtt-page-folder-chev">▸</span>
          <span class="vtt-page-folder-name">${_esc(label)}</span>
          <span class="vtt-page-folder-mini">${stats.tokens ? `${stats.tokens} tok.` : 'vide'}</span>
          <span class="vtt-page-folder-count">${rows.length}</span>
        </div>
        <div class="vtt-page-folder-body" data-folder="${encodeURIComponent(f)}">${rows.map(p => _pageCard(p, broadcastId)).join('')}</div>
      </div>`;
    }).join('');
  }

  el.innerHTML = `
    <div class="vtt-page-command">
      <div class="vtt-page-command-top">
        <div>
          <strong>Scènes</strong>
          <span>${filtered.length}/${all.length} pages</span>
        </div>
        <button class="vtt-page-command-add" data-vtt-fn="_vttAddPage" title="Nouvelle page">＋</button>
      </div>
      <div class="vtt-page-search-row">
        <input type="text" id="vtt-page-search" class="vtt-page-search" placeholder="Rechercher nom, dossier…"
          autocomplete="off" value="${_esc(_pageSearch)}"
          data-vtt-fn="_vttPageSearch" data-vtt-on="input" data-vtt-args="$value">
        ${_pageSearch?`<button class="vtt-page-search-x" data-vtt-fn="_vttPageSearchClear" title="Effacer">✕</button>`:''}
      </div>
      <div class="vtt-page-folder-chips">${folderChips}</div>
    </div>
    ${quickUnique.length ? `<div class="vtt-page-quick">
      <div class="vtt-page-quick-title">Accès rapide</div>
      ${quickUnique.map(p => _pageCard(p, broadcastId, { compact:true })).join('')}
    </div>` : ''}
    <div class="vtt-page-list">${listHtml}</div>`;

  if (searchFocused) {
    const inp = document.getElementById('vtt-page-search');
    if (inp) { inp.focus(); if (caretPos != null) { try { inp.setSelectionRange(caretPos, caretPos); } catch {} } }
  }
  const _newList = el.querySelector('.vtt-page-list');
  if (_newList) _newList.scrollTop = _listTop;
  _initPageSortables(el, { pages: !q && _pageFolderFilter === 'all', folders: !q && _pageFolderFilter === 'all' && !onlyUngrouped });
}

let _pageSortables = [];
export function _destroyPageSortables() {
  _pageSortables.forEach(s => { try { s.destroy(); } catch {} });
  _pageSortables = [];
}
// Initialise le drag & drop : pages (entre dossiers) + dossiers (réordonner).
export function _initPageSortables(el, { pages = true, folders = true } = {}) {
  _destroyPageSortables();
  // Pages : chaque corps de dossier est une zone de dépôt partagée
  if (pages) el.querySelectorAll('.vtt-page-folder-body').forEach(body => {
    _pageSortables.push(new Sortable(body, {
      group: 'vtt-pages', animation: 150, handle: '.vtt-page-item-grip',
      draggable: '.vtt-page-item', ghostClass: 'vtt-page-ghost', fallbackOnBody: true,
      onEnd: () => _onPageDrop(el),
    }));
  });
  // Dossiers : réordonner via la poignée de l'en-tête (hors recherche / mono-dossier)
  if (folders) {
    const list = el.querySelector('.vtt-page-list');
    if (list) _pageSortables.push(new Sortable(list, {
      group: 'vtt-folders', animation: 150, handle: '.vtt-page-folder-grip',
      draggable: '.vtt-page-folder', ghostClass: 'vtt-page-ghost',
      onEnd: () => _onFolderDrop(el),
    }));
  }
}

// Persiste folder + order de toutes les pages d'après l'ordre DOM après un drop.
export async function _onPageDrop(el) {
  const batch = writeBatch(db);
  let order = 0, changed = 0;
  el.querySelectorAll('.vtt-page-folder-body').forEach(body => {
    const folder = decodeURIComponent(body.dataset.folder || '');
    body.querySelectorAll('.vtt-page-item').forEach(item => {
      const id = item.dataset.pageId; const p = VS.pages[id]; if (!p) { order++; return; }
      if ((p.folder||'') !== folder || (p.order??0) !== order) {
        batch.update(_pgRef(id), { folder, order });
        changed++;
      }
      order++;
    });
  });
  if (changed) await batch.commit().catch(() => showNotif('Erreur déplacement', 'error'));
}

// Persiste l'ordre des dossiers (session.pageFolderOrder) d'après l'ordre DOM.
export async function _onFolderDrop(el) {
  const order = [...el.querySelectorAll('.vtt-page-folder')]
    .map(f => decodeURIComponent(f.dataset.folder || ''))
    .filter(f => f !== '');
  await setDoc(_sesRef(), { pageFolderOrder: order }, { merge: true }).catch(e => { console.error('[vtt] ordre dossiers', e); showNotif("Échec de l'enregistrement de l'ordre des dossiers", 'error'); });
}

export function _vttPageSearch(v) { _pageSearch = String(v || ''); _renderPageList(); }
export function _vttPageSearchClear() { _pageSearch = ''; _renderPageList(); }
export function _vttPageFolderFilter(f) {
  _pageFolderFilter = f === 'all' ? 'all' : decodeURIComponent(f || '');
  _savePageFolderFilter();
  _renderPageList();
}
export function _vttPageFavToggle(pageId) {
  if (!pageId) return;
  if (_pageFavs.has(pageId)) _pageFavs.delete(pageId);
  else _pageFavs.add(pageId);
  _savePageFavs();
  _renderPageList();
}
export function _vttPageFolderToggle(f) {
  // Dossier vide ('') : le dispatcher ne passe aucun arg (data-vtt-args="") → f undefined.
  const key = f ? decodeURIComponent(f) : '';
  if (_pageFoldClosed.has(key)) _pageFoldClosed.delete(key); else _pageFoldClosed.add(key);
  _savePageFolds();
  _renderPageList();
}

// ─ Indicateur de page courant pour les joueurs (lecture seule) ──────
export function _renderPageTabs() {
  if (STATE.isAdmin) { _renderPageList(); return; } // MJ : liste dans le tray
  const el=document.getElementById('vtt-page-tabs'); if (!el) return;
  // Les joueurs ne naviguent pas — ils voient juste le nom de leur page courante
  const name = VS.activePage?.name ?? '…';
  const uid  = STATE.user?.uid;
  // Tous les persos du joueur (un token par personnage) → on raisonne sur
  // l'ensemble, pas le premier : un joueur multi-persos peut avoir un perso sur
  // la carte ET un autre en réserve → les deux boutons coexistent.
  const myToks = uid ? Object.values(VS.tokens).filter(e => e.data?.ownerId === uid).map(e => e.data) : [];
  const multi = myToks.length > 1;
  const canInvoke = !!(VS.activePage && myToks.some(t => t.pageId !== VS.activePage.id));
  const canRetire = !!(VS.activePage && myToks.some(t => t.pageId === VS.activePage.id));
  const invokeLbl = multi ? '🧑 Invoquer un perso' : '🧑 Invoquer mon token';
  const retireLbl = multi ? '📦 Ranger un perso'   : '📦 Ranger mon token';
  const actionBtn =
    (canInvoke ? `<button class="vtt-btn-sm" data-vtt-fn="_vttInvokeMyToken" title="Placer un personnage sur cette carte">${invokeLbl}</button>` : '') +
    (canRetire ? `<button class="vtt-btn-sm" data-vtt-fn="_vttRetireMyToken" title="Retirer un personnage de la carte">${retireLbl}</button>` : '');
  el.innerHTML = `<span class="vtt-page-current-label">📍 ${_esc(name)}</span>${actionBtn}`;
}

export async function _switchPage(pageId) {
  const page=VS.pages[pageId]; if (!page) return;
  if (STATE.isAdmin) {
    const recents = [pageId, ..._loadPageRecents().filter(id => id !== pageId && VS.pages[id])];
    _savePageRecents(recents);
  }
  VS.activePage=page;
  // Ne pas détruire VS.layers.map entièrement : VS.imgTr (Transformer) y vit.
  // _renderMapImages() et _renderAllTokens() gèrent leur propre nettoyage.
  VS.layers.token?.destroyChildren(); _clearHL();
  _drawGrid(); _renderMapImages(_MAP_IMG_DEPS); _renderAllTokens(); _renderAnnotLayer();
  fogRenderWalls(page, STATE.isAdmin);
  fogUpdateSoon(page, VS.tokens, STATE.isAdmin);
  _renderPageTabs(); _renderTray(); _deselect();
  _renderCombatTracker();
  _renderMjRulerRemote(VS.session?.mjRuler);
  // Le MJ navigue librement — les joueurs ne suivent que via 📡 Envoyer
}
