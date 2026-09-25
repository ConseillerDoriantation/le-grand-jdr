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
import { db, setDoc, updateDoc, writeBatch } from '../../config/firebase.js';
import { showNotif } from '../../shared/notifications.js';
import { _esc, _searchIncludes, normalizeImageUrl } from '../../shared/html.js';
import { promptModal } from '../../shared/modal.js';
import { githubPagesUrl } from '../../shared/github-folder.js';
import { _sesRef, _pgRef, _tokRef } from './vtt-refs.js';
import { TYPE_COLOR, hpColor } from './vtt-constants.js';
import { _live } from './vtt-effective.js';
import { _showCtxMenu, _tokenEntityKey, _vttPanelError } from './vtt-utils.js';
import { _drawGrid, _renderMapImages } from './vtt-render.js';
import { fogRenderWalls, fogUpdateSoon } from './vtt-fog.js';
import { _renderCombatTracker } from './vtt-combat-tracker.js';
import { _renderMjRulerRemote } from './vtt-ruler.js';
import { _renderLibSection } from './vtt-maplib.js';
import { _MAP_IMG_DEPS, _renderAllTokens, _renderAnnotLayer, _clearHL, _deselect, _canControlToken } from './vtt.js';
import { isTemporarySummonToken, reserveSummonTokens } from './vtt-summon-utils.js';
import { controlledCharacterTokens, invocableCharacterTokens } from './vtt-token-control.js';

let _trayFilter       = 'all'; // filtre actif : 'all'|'player'|'npc'|'enemy'
let _traySearch       = '';    // filtre texte appliqué à la réserve
let _reserveFilter    = (() => { try { const value = localStorage.getItem('vtt-reserve-filter') || 'all'; return value === 'online' ? 'player' : value; } catch { return 'all'; } })();
let _bstSearch        = '';    // filtre texte appliqué au bestiaire
export let _trayTab          = (() => { try { return localStorage.getItem('vtt-tray-tab') || 'reserve'; } catch { return 'reserve'; } })(); // onglet actif du panneau MJ
let _reserveLayout = 'grid';
const _reservePicked = new Set();
let _pageSearch       = '';    // filtre texte appliqué à la liste des pages
let _pageFolderFilter = (() => { try { return localStorage.getItem('vtt-page-folder-filter') || 'all'; } catch { return 'all'; } })();
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
export function _vttReserveLayout(layout) {
  _reserveLayout = layout === 'list' ? 'list' : 'grid';
  try { localStorage.setItem('vtt-reserve-layout', _reserveLayout); } catch {}
  _renderTraySoon();
}
export function _vttReservePick(id, event = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (_reservePicked.has(id)) _reservePicked.delete(id); else _reservePicked.add(id);
  _renderTraySoon();
}
export function _vttReserveClearPicked() { _reservePicked.clear(); _renderTraySoon(); }

function _reserveFreeCells(count) {
  const page = VS.activePage;
  if (!page) return [];
  const occupied = new Set(Object.values(VS.tokens || {})
    .map(entry => entry?.data)
    .filter(token => token?.pageId === page.id)
    .map(token => `${token.col || 0},${token.row || 0}`));
  const result = [];
  const cx = Math.floor(page.cols / 2), cy = Math.floor(page.rows / 2);
  for (let radius = 0; result.length < count && radius <= Math.max(page.cols, page.rows); radius++) {
    for (let dy = -radius; dy <= radius && result.length < count; dy++) {
      for (let dx = -radius; dx <= radius && result.length < count; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const col = cx + dx, row = cy + dy, key = `${col},${row}`;
        if (col < 0 || row < 0 || col >= page.cols || row >= page.rows || occupied.has(key)) continue;
        occupied.add(key); result.push({ col, row });
      }
    }
  }
  return result;
}
async function _placeReserveTokens(ids) {
  if (!STATE.isAdmin || !VS.activePage || !ids.length) return;
  const cells = _reserveFreeCells(ids.length);
  const results = await Promise.allSettled(ids.map((id, index) => {
    const cell = cells[index] || { col:Math.floor(VS.activePage.cols / 2), row:Math.floor(VS.activePage.rows / 2) };
    return updateDoc(_tokRef(id), { pageId:VS.activePage.id, col:cell.col, row:cell.row, visible:true });
  }));
  const failed = results.filter(result => result.status === 'rejected').length;
  if (failed) showNotif(`${failed} placement${failed > 1 ? 's' : ''} impossible${failed > 1 ? 's' : ''}.`, 'error');
  _reservePicked.clear();
  _renderTraySoon();
}
export function _vttReserveCard(id, event = null) {
  if (event?.shiftKey) return _vttReservePick(id, event);
  return _placeReserveTokens([id]);
}
export function _vttReservePlacePicked() { return _placeReserveTokens([..._reservePicked]); }
export function _vttPlaceOnlineReserve() {
  const now = Date.now();
  const ids = Object.values(VS.tokens || {}).map(entry => entry?.data).filter(token =>
    token?.type === 'player' && token.pageId !== VS.activePage?.id && token.ownerId
      && VS.presence[token.ownerId] && now - (VS.presence[token.ownerId].lastSeen || 0) < 120_000
  ).map(token => token.id);
  return _placeReserveTokens([...new Set(ids)]);
}
export function _vttBstSearch(v) { _bstSearch = String(v || ''); _renderTraySoon(); }
export function _vttBstClearSearch() { _bstSearch = ''; _renderTraySoon(); }
// Onglets du panneau MJ (Scènes / Réserve / Bestiaire / Images) — affiche une vue à la fois.
export function _vttTrayTab(tab) {
  _trayTab = tab;
  try { localStorage.setItem('vtt-tray-tab', tab); } catch (_) {}
  document.querySelectorAll('#vtt-tray .vtt-tray-tab').forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('#vtt-tray .vtt-tray-view').forEach((v) => {
    const active = v.dataset.view === tab;
    v.classList.toggle('active', active);
    v.hidden = !active;
  });
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
  const blockedSummons = reserveSummonTokens(all);
  const reserveSeen = new Set();
  const reserve = all.filter(t => {
    // Réserve = persos/PNJ qui ne sont PAS sur la scène courante (sur une autre
    // page ou non placés) → le MJ peut les (ré)invoquer ici. Les ennemis sont
    // propres à chaque scène (jamais en réserve).
    if (t.type === 'enemy' || isTemporarySummonToken(t) || t.pageId === VS.activePage?.id) return false;
    const key = _tokenEntityKey(t);
    if (!key) return true;
    if (reserveSeen.has(key)) return false;
    reserveSeen.add(key); return true;
  });
  const edgeReserveCount = document.getElementById('vtt-edge-reserve-count');
  if (edgeReserveCount) edgeReserveCount.textContent = String(reserve.length);

  const ae = document.activeElement;
  const focusedSearch = ae?.classList?.contains('vtt-tray-search-input') ? ae.dataset.search : null;
  const caretPos = focusedSearch != null ? ae.selectionStart : null;
  const tokenInitial = (token, liveData = _live(token)) => String(liveData?.displayName || token?.name || '?').trim().charAt(0).toUpperCase() || '?';
  const playerLabel = token => {
    const character = token?.characterId ? VS.characters?.[token.characterId] : null;
    const profile = token?.ownerId ? STATE.adventure?.memberProfiles?.[token.ownerId] : null;
    return profile?.pseudo || character?.ownerPseudo || VS.presence?.[token?.ownerId]?.pseudo || 'Joueur';
  };
  const sortTokensByName = tokens => [...tokens].sort((a, b) =>
    (_live(a).displayName ?? a.name ?? '').localeCompare(_live(b).displayName ?? b.name ?? '', 'fr', { sensitivity:'base' }));

  const mkItem = (t) => {
    const ld = _live(t);
    const hpKnownL = ld.displayHp !== null && ld.displayHpMax !== null;
    const hp = hpKnownL ? ld.displayHp : 0, hpm = hpKnownL ? ld.displayHpMax : 1;
    const rat = hpKnownL ? (hpm > 0 ? Math.max(0, hp / hpm) : 1) : 1;
    const isSummon = isTemporarySummonToken(t);
    const actionBtn = t.type === 'enemy'
      ? `<button class="vtt-scene-token-remove" data-vtt-fn="_vttDeleteToken" data-vtt-args="${t.id}" title="Supprimer de la scène">×</button>`
      : `<button class="vtt-scene-token-remove" data-vtt-fn="_vttRetireToken" data-vtt-args="${t.id}" title="${isSummon ? 'Dissiper cette invocation' : 'Renvoyer en réserve'}">${isSummon ? '×' : '↩'}</button>`;
    return `<div class="vtt-scene-token ${VS.selected === t.id ? 'active' : ''}" data-vtt-fn="_vttSelectFromTray" data-vtt-args="${t.id}" title="${_esc(ld.displayName ?? t.name)}${hpKnownL ? ` · PV ${hp}/${hpm}` : ''}">
      <div class="vtt-scene-token-ring" style="--hp:${Math.round(rat * 100)}%;--hc:${hpKnownL ? hpColor(rat) : '#64748b'};--tc:${TYPE_COLOR[t.type] ?? '#888'}">
      <div class="vtt-tray-dot">
        ${ld.displayImage
          ? `<img src="${ld.displayImage}" alt="${_esc(ld.displayName || '')}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
          : `<span>${_esc(tokenInitial(t, ld))}</span>`}
      </div>
      </div>
      ${actionBtn}
    </div>`;
  };

  const mkResLine = t => {
    const ld = _live(t);
    const col = TYPE_COLOR[t.type] ?? '#888';
    const online = t.type === 'player' && isOnline(t.ownerId);
    const pageName = t.pageId && t.pageId !== VS.activePage?.id ? (VS.pages[t.pageId]?.name || 'autre scène') : '';
    const hpKnown = ld.displayHp !== null && ld.displayHpMax !== null;
    const level = t.characterId ? Number(VS.characters?.[t.characterId]?.niveau || VS.characters?.[t.characterId]?.level || 0) : 0;
    const subline = t.type === 'player' ? `${playerLabel(t)}${level ? ` · Nv ${level}` : ''}` : 'PNJ';
    const statusDot = t.type === 'player'
      ? `<span class="vtt-res-line-status ${online ? 'is-online' : ''}" title="${online ? 'En ligne' : 'Hors ligne'}"></span>` : '';
    const name = _esc(ld.displayName ?? t.name);
    return `<div class="vtt-res-line ${pageName ? 'is-elsewhere' : ''}${t.type === 'player' && !online ? ' is-offline' : ''}${_reservePicked.has(t.id) ? ' is-picked' : ''}" role="button" tabindex="0" draggable="true" data-vtt-drag="token:${t.id}" data-vtt-fn="_vttReserveCard" data-vtt-args="${t.id}|$event" title="Placer ${name} (clic · Maj+clic pour sélectionner · glisser sur la carte)">
      ${pageName ? `<span class="vtt-res-where" title="Actuellement sur ${_esc(pageName)}">sur ${_esc(pageName)}</span>` : ''}
      <button type="button" class="vtt-res-check" data-vtt-fn="_vttReservePick" data-vtt-args="${t.id}|$event" title="Sélectionner" aria-pressed="${_reservePicked.has(t.id)}">✓</button>
      <span class="vtt-res-line-dot" style="border-color:${col};color:${col}">
        ${ld.displayImage ? `<img src="${ld.displayImage}" alt="${name}">` : `<span>${_esc(tokenInitial(t, ld))}</span>`}
        ${statusDot}
      </span>
      <span class="vtt-res-line-main">
        <span class="vtt-res-line-name">${name}</span>
        <span class="vtt-res-line-meta"><i>${_esc(subline)}</i></span>
        ${hpKnown ? `<span class="vtt-res-hp"><i style="width:${Math.round((ld.displayHp / Math.max(1, ld.displayHpMax)) * 100)}%;background:${hpColor(ld.displayHp / Math.max(1, ld.displayHpMax))}"></i></span>` : '<span class="vtt-res-hp"></span>'}
      </span>
      <span class="vtt-res-line-actions">
        <span class="vtt-res-line-place" title="Placer sur la scène">＋ <em>Placer</em></span>
      </span>
    </div>`;
  };

  const scEl = document.getElementById('vtt-scene-tokens');
  if (scEl) {
    const countEl = document.getElementById('vtt-scene-token-count');
    if (countEl) countEl.textContent = String(onPage.length);
    const pageEl = document.getElementById('vtt-scene-token-page');
    if (pageEl) pageEl.textContent = VS.activePage?.name || '';
    if (!onPage.length) {
      scEl.innerHTML = `<div class="vtt-tray-empty">Aucun token sur cette scène</div>`;
    } else {
      const players = sortTokensByName(onPage.filter(t => t.type === 'player'));
      const npcs    = sortTokensByName(onPage.filter(t => t.type === 'npc'));
      let   enemies = onPage.filter(t => t.type === 'enemy');
      if (inCombat && enemies.length > 1) {
        enemies = [...enemies].sort((a, b) => {
          const la = _live(a), lb = _live(b);
          return ((la.displayHp ?? 1) / Math.max(1, la.displayHpMax ?? 1)) - ((lb.displayHp ?? 1) / Math.max(1, lb.displayHpMax ?? 1));
        });
      } else enemies = sortTokensByName(enemies);
      const multi = [players, npcs, enemies].filter(g => g.length).length > 1;
      const grp = (label, items) => !items.length ? ''
        : `<div class="vtt-scene-token-group"><label>${label}</label><div>${items.map(mkItem).join('')}</div></div>`;
      scEl.innerHTML = grp('Joueurs', players) + grp('PNJ', npcs) + grp('Ennemis', enemies);
    }
  }

  const reEl = document.getElementById('vtt-reserve-body');
  if (reEl) {
    const counts = {
      all: reserve.length,
      online: reserve.filter(t => t.type === 'player' && isOnline(t.ownerId)).length,
      offline: reserve.filter(t => t.type === 'player' && !isOnline(t.ownerId)).length,
      npc: reserve.filter(t => t.type === 'npc').length,
      elsewhere: reserve.filter(t => t.pageId && t.pageId !== VS.activePage?.id).length,
    };
    const filterMatch = t => {
      if (_reserveFilter === 'player') return t.type === 'player';
      if (_reserveFilter === 'offline') return t.type === 'player' && !isOnline(t.ownerId);
      if (_reserveFilter === 'npc') return t.type === 'npc';
      if (_reserveFilter === 'elsewhere') return !!(t.pageId && t.pageId !== VS.activePage?.id);
      return true;
    };
    const searched = reserve.filter(t =>
      filterMatch(t)
      && (!_traySearch || _searchIncludes(`${_live(t).displayName ?? t.name ?? ''} ${VS.pages[t.pageId]?.name || ''}`, _traySearch)));
    const presentPlayers = sortTokensByName(searched.filter(t => t.type === 'player' && isOnline(t.ownerId)));
    const absentPlayers  = sortTokensByName(searched.filter(t => t.type === 'player' && !isOnline(t.ownerId)));
    const npcs           = sortTokensByName(searched.filter(t => t.type === 'npc'));
    const mkBlock = (label, items) => {
      if (!items.length) return '';
      return `<div class="vtt-res-group-title">${label} · ${items.length}</div>` + items.map(mkResLine).join('');
    };
    const clrBtn = _traySearch ? `<button class="vtt-tray-search-clr" data-vtt-fn="_vttTrayClearSearch" title="Effacer">✕</button>` : '';
    const filterChip = (key, label, count) => `<button class="vtt-res-filter ${_reserveFilter === key ? 'active' : ''}" data-vtt-fn="_vttReserveFilter" data-vtt-args="${key}">${label}<b>${count}</b></button>`;
    const list = searched.length
      ? mkBlock('Joueurs en ligne', presentPlayers)
        + mkBlock('Joueurs hors ligne', absentPlayers)
        + mkBlock('PNJ', npcs)
      : `<div class="vtt-tray-empty">${reserve.length ? 'Aucun résultat' : 'Réserve vide'}</div>`;
    const onlineReserveCount = reserve.filter(t => t.type === 'player' && isOnline(t.ownerId)).length;
    const selectionBar = _reservePicked.size ? `<div class="vtt-res-selection"><span><b>${_reservePicked.size}</b> sélectionné${_reservePicked.size > 1 ? 's' : ''}</span><button data-vtt-fn="_vttReserveClearPicked">Annuler</button><button class="primary" data-vtt-fn="_vttReservePlacePicked">＋ Placer</button></div>` : '';
    reEl.innerHTML = `
      <div class="vtt-res-head">
        <strong>En réserve</strong><span>${reserve.length}</span><i></i>
        ${onlineReserveCount ? `<button type="button" class="vtt-res-place-online" data-vtt-fn="_vttPlaceOnlineReserve">＋ Placer les joueurs en ligne · ${onlineReserveCount}</button>` : ''}
      </div>
      ${blockedSummons.length ? `<div class="vtt-res-summon-warning"><span>🐾 ${blockedSummons.length} invocation${blockedSummons.length > 1 ? 's' : ''} bloquée${blockedSummons.length > 1 ? 's' : ''}</span><button type="button" data-vtt-fn="_vttClearReserveSummons">Dissiper</button></div>` : ''}
      <div class="vtt-tray-search">
        <svg class="vtt-tray-search-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/></svg>
        <input type="text" class="vtt-tray-search-input" data-search="reserve" placeholder="Nom, joueur, scène…"
          value="${_esc(_traySearch)}" data-vtt-fn="_vttTraySearch" data-vtt-on="input" data-vtt-args="$value">
        ${clrBtn}
      </div>
      <div class="vtt-res-filters">
        ${filterChip('all', 'Tous', counts.all)}
        ${filterChip('player', 'Joueurs', counts.online + counts.offline)}
        ${filterChip('npc', 'PNJ', counts.npc)}
        ${counts.elsewhere ? filterChip('elsewhere', 'Ailleurs', counts.elsewhere) : ''}
      </div>
      <div class="vtt-res-scroll vtt-res-cards is-grid${_reservePicked.size ? ' is-selecting' : ''}">${list}</div>
      ${selectionBar}`;
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
            <div class="vtt-bst-portrait">${img ? `<img src="${_esc(img)}" alt="${_esc(b.nom || '')}" loading="lazy">` : `<span class="vtt-bst-icon">${_esc(init)}</span>`}</div>
            <div class="vtt-bst-info">
              <div class="vtt-bst-name">${_esc(b.nom || 'Créature')}</div>
              ${family ? `<div class="vtt-bst-type">${_esc(family)}</div>` : ''}
              <div class="vtt-bst-meta">
                <span><i>PV</i> ${pv}</span>
                <span><i>CA</i> ${ca}</span>
                ${vit ? `<span><i>VIT</i> ${vit} m</span>` : ''}
              </div>
            </div>
          </div>`;
        }).join('')}</div>`
      : `<div class="vtt-tray-empty">${Object.keys(VS.bestiary).length ? 'Aucun résultat' : 'Bestiaire vide'}</div>`;
    beEl.innerHTML = `
      <div class="vtt-bst-head">
        <strong>Bestiaire</strong>
        <span>${bsts.length}/${Object.keys(VS.bestiary).length}</span>
        <i></i>
        <button type="button" class="vtt-bst-create" data-vtt-fn="_vttCreateEnemy"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Créer</button>
      </div>
      <div class="vtt-tray-search">
        <svg class="vtt-tray-search-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/></svg>
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
  return (a.order ?? 0) - (b.order ?? 0);
}

function _pageThumbUrl(p) {
  const imgs = Array.isArray(p?.backgroundImages) ? p.backgroundImages : [];
  const img = imgs.find(x => x?.url) || imgs[0];
  const raw = String(img?.sourcePath || img?.url || '').trim();
  if (!raw) return '';
  if (/^\.?\/?images\/maps\//i.test(raw) || /(?:raw\.githubusercontent\.com|github\.com\/[^/]+\/[^/]+\/(?:blob|tree))\//i.test(raw)) {
    return githubPagesUrl(raw);
  }
  return normalizeImageUrl(String(img?.url || raw).trim());
}

function _pageCard(p, broadcastId, { showFolder = false } = {}) {
  const isPlayers = p.id === broadcastId;
  const isMj = p.id === VS.activePage?.id;
  const stats = _pageTokens(p.id);
  const bgCount = Array.isArray(p.backgroundImages) ? p.backgroundImages.length : 0;
  const thumb = _pageThumbUrl(p);
  const cls = isMj && isPlayers ? 'mj-and-players' : isMj ? 'mj' : isPlayers ? 'players' : '';
  const status = [
    isMj ? '<span class="vtt-page-status is-mj" title="Votre vue">VOUS</span>' : '',
    isPlayers ? '<span class="vtt-page-status is-live" title="Scène envoyée aux joueurs">● JOUEURS</span>' : '',
    p.fogEnabled ? '<span class="vtt-page-status is-fog" title="Éclairage dynamique actif">◐ ÉCLAIRAGE</span>' : '',
  ].join('');
  const tokenSummary = stats.total
    ? `<span title="${stats.players} joueur(s), ${stats.npcs} PNJ, ${stats.enemies} ennemi(s)">♟ ${stats.total}</span>`
    : '';
  const sendIcon = '<svg class="vtt-page-action-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2"/><path d="M8 8a5.6 5.6 0 0 0 0 8M16 8a5.6 5.6 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/></svg>';
  return `<div class="vtt-page-item ${cls}" data-page-id="${p.id}" data-vtt-fn="_vttSwitchPage" data-vtt-args="${p.id}" title="Ouvrir ${_esc(p.name)}">
    <span class="vtt-page-item-grip" title="Glisser pour déplacer">⠿</span>
    <div class="vtt-page-thumb ${thumb ? '' : 'is-empty'}">
      ${thumb ? `<img src="${_esc(thumb)}" alt="Aperçu de ${_esc(p.name)}" loading="lazy">` : '<span class="vtt-page-thumb-grid" aria-hidden="true"></span>'}
    </div>
    <div class="vtt-page-item-main">
      <div class="vtt-page-item-top">
        <span class="vtt-page-item-name">${_esc(p.name)}</span>
      </div>
      <div class="vtt-page-item-meta">
        ${showFolder ? `<span class="is-folder">${_esc(_pageFolderLabel(p.folder))}</span>` : ''}
        <span>${p.cols||24} × ${p.rows||18}</span>
        <span>${bgCount ? `${bgCount} carte${bgCount > 1 ? 's' : ''}` : 'Sans carte'}</span>
        ${tokenSummary}
      </div>
      <div class="vtt-page-item-status">${status}</div>
    </div>
    <div class="vtt-page-item-side">
      ${isPlayers ? '' : `<button class="vtt-page-item-menu vtt-page-item-send" data-vtt-fn="_vttSendToPage" data-vtt-args="${p.id}" title="Envoyer les joueurs sur cette scène" aria-label="Envoyer les joueurs sur ${_esc(p.name)}">${sendIcon}</button>`}
      <button class="vtt-page-item-menu" data-vtt-fn="_vttPageMenu" data-vtt-args="$event|${p.id}" title="Autres actions de la scène" aria-label="Actions pour ${_esc(p.name)}" aria-haspopup="menu">•••</button>
    </div>
  </div>`;
}

function _pageMenuItems(pageId) {
  const page = VS.pages[pageId];
  if (!page) return [];
  return [
    { label:'📡 Envoyer aux joueurs', action:'_vttSendToPage', args:pageId },
    { label:'✏️ Modifier la scène', action:'_vttEditPage', args:pageId },
    { label:'⧉ Dupliquer sans les tokens', action:'_vttDuplicatePage', args:pageId },
    '---',
    { label:'🗑️ Supprimer la scène', action:'_vttDeletePage', args:pageId },
  ];
}

export function _vttPageMenu(e, pageId) {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  const anchor = e?.target?.closest?.('.vtt-page-item-menu, .vtt-page-item') || e?.currentTarget;
  const rect = anchor?.getBoundingClientRect?.();
  _showCtxMenu(e?.clientX || rect?.left || 0, e?.clientY || rect?.bottom || 0, _pageMenuItems(pageId));
}

function _bindPageContextMenus(el) {
  el.querySelectorAll('.vtt-page-item').forEach(card => {
    card.oncontextmenu = e => _vttPageMenu(e, card.dataset.pageId);
  });
  el.querySelectorAll('[data-page-folder-context]').forEach(header => {
    header.oncontextmenu = e => {
      e.preventDefault();
      e.stopPropagation();
      const encoded = header.dataset.pageFolderContext || '';
      const folder = encoded ? decodeURIComponent(encoded) : '';
      const closed = _pageFoldClosed.has(folder);
      _showCtxMenu(e.clientX, e.clientY, [
        { label:`Dossier · ${_esc(_pageFolderLabel(folder))}` },
        { label:'＋ Nouvelle scène ici', action:'_vttAddPage', args:encoded },
        { label:folder ? '✏️ Renommer le dossier' : '📁 Ranger dans un dossier', action:'_vttPageFolderRename', args:encoded },
        '---',
        { label:closed ? '▾ Déplier le dossier' : '▸ Replier le dossier', action:'_vttPageFolderToggle', args:encoded },
      ]);
    };
  });
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
    el.innerHTML=`<div class="vtt-tray-empty">Aucune scène<br><small>Crée ta première scène avec ＋ Nouvelle</small></div>`;
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
  const mjPage = VS.activePage;
  const playersPage = VS.pages[broadcastId];
  const sameLivePage = !!(mjPage?.id && mjPage.id === broadcastId);
  const liveSummary = `
    <div class="vtt-page-live-summary${sameLivePage ? ' is-synced' : ''}">
      <button type="button" class="vtt-page-live-card is-mj" ${mjPage ? `data-vtt-fn="_vttSwitchPage" data-vtt-args="${mjPage.id}" title="Ouvrir votre scène"` : 'disabled'}>
        <small><i></i>Votre vue</small><strong>${_esc(mjPage?.name || 'Aucune scène')}</strong>
      </button>
      <button type="button" class="vtt-page-live-card is-players" ${playersPage ? `data-vtt-fn="_vttSwitchPage" data-vtt-args="${playersPage.id}" title="Ouvrir la scène des joueurs"` : 'disabled'}>
        <small><i></i>Joueurs</small><strong>${_esc(playersPage?.name || 'Aucune scène envoyée')}</strong>
      </button>
    </div>`;
  const folderChips = [
    `<button class="vtt-page-folder-chip ${_pageFolderFilter === 'all' ? 'active' : ''}" data-vtt-fn="_vttPageFolderFilter" data-vtt-args="all">Toutes <b>${all.length}</b></button>`,
    ...orderedFolders.map(f => {
      const count = all.filter(p => (p.folder||'').trim() === f).length;
      const arg = encodeURIComponent(f);
      return `<button class="vtt-page-folder-chip ${_pageFolderFilter === f ? 'active' : ''}" data-vtt-fn="_vttPageFolderFilter" data-vtt-args="${arg}" data-page-folder-context="${arg}" title="Filtrer · clic droit pour ajouter une scène">${_esc(_pageFolderLabel(f))} <b>${count}</b></button>`;
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
    listHtml = `<div class="vtt-tray-empty">Aucune scène ne correspond</div>`;
  } else if (flatFiltered || onlyUngrouped) {
    listHtml = `<div class="vtt-page-folder-body" data-folder="${_pageFolderFilter === 'all' ? '' : encodeURIComponent(_pageFolderFilter)}">${filtered.sort(_pageSmartSort).map(p => _pageCard(p, broadcastId, { showFolder:q && _pageFolderFilter === 'all' })).join('')}</div>`;
  } else {
    listHtml = folders.map(f => {
      const rows = groups.get(f).sort((a,b)=>(a.order??0)-(b.order??0));
      const label = _pageFolderLabel(f);
      const closed = !q && _pageFoldClosed.has(f);
      return `<div class="vtt-page-folder${closed?' closed':''}" data-folder="${encodeURIComponent(f)}">
        <div class="vtt-page-folder-hd" data-vtt-fn="_vttPageFolderToggle" data-vtt-args="${encodeURIComponent(f)}" data-page-folder-context="${encodeURIComponent(f)}" title="Ouvrir ou fermer · clic droit pour les actions">
          <span class="vtt-page-folder-grip" title="Glisser pour réordonner">⠿</span>
          <span class="vtt-page-folder-chev">▸</span>
          <span class="vtt-page-folder-name">${_esc(label)}</span>
          <span class="vtt-page-folder-count">${rows.length} scène${rows.length > 1 ? 's' : ''}</span>
          <button class="vtt-page-folder-add" data-vtt-fn="_vttAddPage" data-vtt-args="${encodeURIComponent(f)}" title="Ajouter une scène dans ${_esc(label)}" aria-label="Ajouter une scène dans ${_esc(label)}">＋</button>
        </div>
        <div class="vtt-page-folder-body" data-folder="${encodeURIComponent(f)}">${rows.map(p => _pageCard(p, broadcastId)).join('')}</div>
      </div>`;
    }).join('');
  }

  el.innerHTML = `
    <div class="vtt-page-scenes-shell">
      ${liveSummary}
      <div class="vtt-page-command-top">
        <div>
          <strong>Scènes</strong>
          <span>${filtered.length === all.length ? all.length : `${filtered.length}/${all.length}`}</span>
        </div>
        <div class="vtt-page-command-actions">
          <button class="vtt-page-command-add" data-vtt-fn="_vttAddPage" ${_pageFolderFilter === 'all' ? '' : `data-vtt-args="${encodeURIComponent(_pageFolderFilter)}"`} title="Nouvelle scène${_pageFolderFilter === 'all' ? '' : ` dans ${_esc(_pageFolderLabel(_pageFolderFilter))}`}" aria-label="Créer une nouvelle scène"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Nouvelle</button>
        </div>
      </div>
      <div class="vtt-page-search-row">
        <svg class="vtt-page-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/></svg>
        <input type="text" id="vtt-page-search" class="vtt-page-search" placeholder="Rechercher nom, dossier…"
          autocomplete="off" value="${_esc(_pageSearch)}"
          data-vtt-fn="_vttPageSearch" data-vtt-on="input" data-vtt-args="$value">
        ${_pageSearch?`<button class="vtt-page-search-x" data-vtt-fn="_vttPageSearchClear" title="Effacer">✕</button>`:''}
      </div>
      <div class="vtt-page-folder-chips">${folderChips}</div>
      <div class="vtt-page-list">${listHtml}</div>
    </div>`;

  if (searchFocused) {
    const inp = document.getElementById('vtt-page-search');
    if (inp) { inp.focus(); if (caretPos != null) { try { inp.setSelectionRange(caretPos, caretPos); } catch {} } }
  }
  const _newList = el.querySelector('.vtt-page-list');
  if (_newList) _newList.scrollTop = _listTop;
  _bindPageContextMenus(el);
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

export function _vttPageFoldersMenu(e) {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  const anchor = e?.target?.closest?.('.vtt-page-command-menu') || e?.currentTarget;
  const rect = anchor?.getBoundingClientRect?.();
  _showCtxMenu(e?.clientX || rect?.left || 0, e?.clientY || rect?.bottom || 0, [
    { label:'Gestion des dossiers' },
    { label:'▾ Tout déplier', fn:() => {
      _pageFoldClosed.clear();
      _savePageFolds();
      _renderPageList();
    } },
    { label:'▸ Tout replier', fn:() => {
      Object.values(VS.pages).forEach(page => _pageFoldClosed.add((page.folder || '').trim()));
      _savePageFolds();
      _renderPageList();
    } },
  ]);
}

export async function _vttPageFolderRename(encodedFolder = '') {
  const folder = encodedFolder ? decodeURIComponent(encodedFolder) : '';
  const pages = Object.values(VS.pages).filter(page => (page.folder || '').trim() === folder);
  if (!pages.length) return;
  const nextValue = await promptModal(
    folder
      ? `Nouveau nom pour « ${_esc(folder)} ». Si ce dossier existe déjà, les scènes seront regroupées.`
      : 'Choisis le dossier dans lequel ranger ces scènes.',
    {
      title:folder ? '📁 Renommer le dossier' : '📁 Ranger les scènes',
      default:folder,
      placeholder:'Nom du dossier',
      confirmLabel:folder ? 'Renommer' : 'Ranger',
      required:true,
    },
  );
  if (nextValue == null) return;
  const next = String(nextValue).trim();
  if (!next || next === folder) return;
  const batch = writeBatch(db);
  pages.forEach(page => batch.update(_pgRef(page.id), { folder:next }));
  const order = [...new Set((VS.session.pageFolderOrder || [])
    .map(item => item === folder ? next : item)
    .filter(Boolean))];
  if (!order.includes(next)) order.push(next);
  batch.set(_sesRef(), { pageFolderOrder:order }, { merge:true });
  try {
    await batch.commit();
    _pageFoldClosed.delete(folder);
    _pageFolderFilter = _pageFolderFilter === folder ? next : _pageFolderFilter;
    _savePageFolds();
    _savePageFolderFilter();
    showNotif(`${pages.length} scène${pages.length > 1 ? 's' : ''} rangée${pages.length > 1 ? 's' : ''} dans « ${next} ».`, 'success');
  } catch (error) {
    console.error('[vtt] renommage dossier de scènes', error);
    showNotif('Impossible de renommer ce dossier.', 'error');
  }
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
  const myToks = uid ? controlledCharacterTokens(VS.tokens, token => _canControlToken(token, uid)) : [];
  const multi = myToks.length > 1;
  // Personnages déjà présents sur la scène (placés par le MJ ou soi) : on n'offre
  // pas de les ré-invoquer, sinon un doublon si un 2ᵉ token du perso traîne en réserve.
  const canInvoke = !!(VS.activePage && invocableCharacterTokens(
    VS.tokens,
    VS.activePage.id,
    token => _canControlToken(token, uid),
  ).length);
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
