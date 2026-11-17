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
import { PRESENCE_TTL_MS } from '../../shared/presence-ttl.js';
import { VS } from './vtt-state.js';
import Sortable from '../../vendor/sortable.esm.js';
import { db, setDoc, updateDoc, writeBatch } from '../../config/firebase.js';
import { showNotif } from '../../shared/notifications.js';
import { _esc, _searchIncludes, normalizeImageUrl } from '../../shared/html.js';
import { promptModal } from '../../shared/modal.js';
import { resolveMapImageUrl } from './vtt-map-library-utils.js';
import { _sesRef, _pgRef, _tokRef } from './vtt-refs.js';
import { TYPE_COLOR, hpColor } from './vtt-constants.js';
import { _live } from './vtt-effective.js';
import { _showCtxMenu, _tokenEntityKey, _vttPanelError } from './vtt-utils.js';
import { _drawGrid, _renderMapImages } from './vtt-render.js';
import { fogRenderWalls, fogUpdateSoon } from './vtt-fog.js';
import { _renderCombatTracker } from './vtt-combat-tracker.js';
import { _renderMjRulerRemote } from './vtt-ruler.js';
import { _renderLibSection } from './vtt-maplib.js';
import { _MAP_IMG_DEPS, _renderAllTokens, _renderAnnotLayer, _clearHL, _deselect, _canControlToken, _vttPageChanged, _loadBestiaryCatalog } from './vtt.js';
import { isTemporarySummonToken, reserveSummonTokens } from './vtt-summon-utils.js';
import { controlledCharacterTokens, invocableCharacterTokens } from './vtt-token-control.js';

let _trayFilter       = 'all'; // filtre actif : 'all'|'player'|'npc'|'enemy'
let _traySearch       = '';    // filtre texte appliqué à la réserve
let _reserveFilter    = (() => { try { const value = localStorage.getItem('vtt-reserve-filter') || 'all'; return value === 'online' ? 'player' : value; } catch { return 'all'; } })();
let _bstSearch        = '';    // filtre texte appliqué au bestiaire
let _distributionFilter = 'all'; // all | player | npc | bestiary | improvised
export let _trayTab          = (() => { try { return localStorage.getItem('vtt-tray-tab') || 'reserve'; } catch { return 'reserve'; } })(); // onglet actif du panneau MJ
let _reserveLayout = 'grid';
const _reservePicked = new Set();
let _pageSearch       = '';    // filtre texte appliqué à la liste des pages
let _pageFolderFilter = (() => { try { return localStorage.getItem('vtt-page-folder-filter') || 'all'; } catch { return 'all'; } })();
let _reelCompact      = (() => { try { return localStorage.getItem('vtt-bar-mode') === 'compact'; } catch { return false; } })();
let _reelSortable     = null;
let _reelPopoverSortables = [];
let _reelPopoverOutsideHandler = null;
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
export function _vttDistributionSearch(v) {
  _traySearch = String(v || '');
  _bstSearch = _traySearch;
  _renderTraySoon();
}
export function _vttDistributionFilter(filter) {
  _distributionFilter = ['player', 'npc', 'bestiary', 'improvised'].includes(filter) ? filter : 'all';
  _reserveFilter = _distributionFilter === 'player' ? 'player' : (_distributionFilter === 'npc' || _distributionFilter === 'improvised' ? 'npc' : 'all');
  _renderTraySoon();
}
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
      && VS.presence[token.ownerId] && now - (VS.presence[token.ownerId].lastSeen || 0) < PRESENCE_TTL_MS
  ).map(token => token.id);
  return _placeReserveTokens([...new Set(ids)]);
}

export async function _vttRevealPageTokens() {
  if (!STATE.isAdmin || !VS.activePage) return;
  const hidden = Object.values(VS.tokens || {})
    .map(entry => entry?.data)
    .filter(token => token?.pageId === VS.activePage.id && token.visible === false);
  if (!hidden.length) return;
  const setVisible = async visible => {
    const batch = writeBatch(db);
    hidden.forEach(token => batch.update(_tokRef(token.id), { visible }));
    await batch.commit();
  };
  try {
    await setVisible(true);
    showNotif(`${hidden.length} token${hidden.length > 1 ? 's' : ''} révélé${hidden.length > 1 ? 's' : ''}.`, 'success', {
      duration: 7000,
      action: {
        label: 'Annuler',
        onClick: async () => {
          await setVisible(false);
          showNotif('Visibilité restaurée.', 'info');
        },
      },
    });
  } catch (error) {
    console.error('[vtt] révélation groupée', error);
    showNotif('Impossible de révéler tous les tokens.', 'error');
  }
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
  if (tab === 'bestiary') void _loadBestiaryCatalog();
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
  // La nouvelle Distribution expose le bestiaire en permanence : charge le
  // catalogue dès que ce panneau existe, sans ajouter de listener Firestore.
  if (_trayTab === 'bestiary' || document.getElementById('vtt-distribution')) void _loadBestiaryCatalog();
  // Préserve la position de défilement de la vue Scènes : sans ça, reconstruire
  // la liste des pages + les tokens de scène (au changement de scène) fait
  // remonter le panneau tout en haut.
  const _scenesView = document.querySelector('#vtt-tray .vtt-tray-view[data-view="scenes"]');
  const _scenesScroll = _scenesView ? _scenesView.scrollTop : 0;
  _renderPageList();
  _renderLibSection();

  const onlineTs = Date.now();
  const isOnline = uid => !!(uid && VS.presence[uid] && onlineTs - (VS.presence[uid].lastSeen || 0) < PRESENCE_TTL_MS);
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
  const distributionCount = document.getElementById('vtt-distribution-count');
  if (distributionCount) distributionCount.textContent = `${onPage.length} en scène · ${reserve.length} à placer`;
  const distributionCounts = {
    all: all.length + Object.keys(VS.bestiary || {}).length,
    player: all.filter(token => token.type === 'player').length,
    npc: all.filter(token => token.type === 'npc' && !token.improvised).length,
    bestiary: Object.keys(VS.bestiary || {}).length,
    improvised: all.filter(token => !!token.improvised).length,
  };
  document.querySelectorAll('[data-vtt-distribution-filter]').forEach(button => {
    const active = button.dataset.vttDistributionFilter === _distributionFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    const count = button.querySelector('b');
    if (count) count.textContent = String(distributionCounts[button.dataset.vttDistributionFilter] || 0);
  });

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
    return `<div class="vtt-scene-token ${VS.selected === t.id ? 'active' : ''}${t.visible === false ? ' is-hidden' : ''}" data-vtt-fn="_vttSelectFromTray" data-vtt-args="${t.id}" title="${_esc(ld.displayName ?? t.name)}${hpKnownL ? ` · PV ${hp}/${hpm}` : ''}${t.visible === false ? ' · Caché aux joueurs' : ''}">
      <div class="vtt-scene-token-ring" style="--hp:${Math.round(rat * 100)}%;--hc:${hpKnownL ? hpColor(rat) : '#64748b'};--tc:${TYPE_COLOR[t.type] ?? '#888'}">
      <div class="vtt-tray-dot">
        ${ld.displayImage
          ? `<img src="${ld.displayImage}" alt="${_esc(ld.displayName || '')}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
          : `<span>${_esc(tokenInitial(t, ld))}</span>`}
      </div>
      </div>
      ${t.visible === false ? '<span class="vtt-scene-token-hidden" title="Caché aux joueurs">◉̸</span>' : ''}
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
    const npc = t.npcId ? VS.npcs?.[t.npcId] : null;
    const subline = t.type === 'player'
      ? `${playerLabel(t)}${level ? ` · Nv ${level}` : ''}`
      : [t.role || npc?.role || (t.improvised ? 'Figurant' : 'PNJ'), npc?.lieu].filter(Boolean).join(' · ');
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
      const revealEl = document.getElementById('vtt-scene-reveal-all');
      const hiddenCount = onPage.filter(token => token.visible === false).length;
      if (revealEl) {
        revealEl.hidden = !hiddenCount;
        revealEl.innerHTML = `Tout révéler <b>${hiddenCount}</b>`;
      }
    const pageEl = document.getElementById('vtt-scene-token-page');
    if (pageEl) pageEl.textContent = VS.activePage?.name || '';
    const visibleOnPage = onPage.filter(token => {
      if (_distributionFilter === 'player') return token.type === 'player';
      if (_distributionFilter === 'npc') return token.type === 'npc' && !token.improvised;
      if (_distributionFilter === 'bestiary') return token.type === 'enemy' && !token.improvised;
      if (_distributionFilter === 'improvised') return !!token.improvised;
      return true;
    }).filter(token => !_traySearch || _searchIncludes(`${_live(token).displayName ?? token.name ?? ''} ${token.role || ''}`, _traySearch));
    if (!visibleOnPage.length) {
      scEl.innerHTML = `<div class="vtt-tray-empty">Aucun token sur cette scène</div>`;
    } else {
      const players = sortTokensByName(visibleOnPage.filter(t => t.type === 'player'));
      const npcs    = sortTokensByName(visibleOnPage.filter(t => t.type === 'npc'));
      let   enemies = visibleOnPage.filter(t => t.type === 'enemy');
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
    const showReserve = _distributionFilter !== 'bestiary';
    const filterMatch = t => {
      if (_distributionFilter === 'player') return t.type === 'player';
      if (_distributionFilter === 'npc') return t.type === 'npc' && !t.improvised;
      if (_distributionFilter === 'improvised') return !!t.improvised;
      if (_reserveFilter === 'offline') return t.type === 'player' && !isOnline(t.ownerId);
      if (_reserveFilter === 'elsewhere') return !!(t.pageId && t.pageId !== VS.activePage?.id);
      return true;
    };
    const searched = reserve.filter(t =>
      filterMatch(t)
      && (!_traySearch || _searchIncludes(`${_live(t).displayName ?? t.name ?? ''} ${t.role || ''} ${VS.npcs?.[t.npcId]?.role || ''} ${VS.npcs?.[t.npcId]?.lieu || ''} ${playerLabel(t)} ${VS.pages[t.pageId]?.name || ''}`, _traySearch)));
    const presentPlayers = sortTokensByName(searched.filter(t => t.type === 'player' && isOnline(t.ownerId)));
    const absentPlayers  = sortTokensByName(searched.filter(t => t.type === 'player' && !isOnline(t.ownerId)));
    const npcs           = sortTokensByName(searched.filter(t => t.type === 'npc' && !t.improvised));
    const improvised     = sortTokensByName(searched.filter(t => !!t.improvised));
    const mkBlock = (label, items) => {
      if (!items.length) return '';
      return `<div class="vtt-res-group-title">${label} · ${items.length}</div>` + items.map(mkResLine).join('');
    };
    const list = searched.length
      ? mkBlock('Joueurs en ligne', presentPlayers)
        + mkBlock('Joueurs hors ligne', absentPlayers)
        + mkBlock('PNJ', npcs)
        + mkBlock('Figurants', improvised)
      : `<div class="vtt-tray-empty">${reserve.length ? 'Aucun résultat' : 'Réserve vide'}</div>`;
    const onlineReserveCount = reserve.filter(t => t.type === 'player' && isOnline(t.ownerId)).length;
    const selectionBar = _reservePicked.size ? `<div class="vtt-res-selection"><span><b>${_reservePicked.size}</b> sélectionné${_reservePicked.size > 1 ? 's' : ''}</span><button data-vtt-fn="_vttReserveClearPicked">Annuler</button><button class="primary" data-vtt-fn="_vttReservePlacePicked">＋ Placer</button></div>` : '';
    reEl.hidden = !showReserve;
    reEl.innerHTML = showReserve ? `
      ${blockedSummons.length ? `<div class="vtt-res-summon-warning"><span>🐾 ${blockedSummons.length} invocation${blockedSummons.length > 1 ? 's' : ''} bloquée${blockedSummons.length > 1 ? 's' : ''}</span><button type="button" data-vtt-fn="_vttClearReserveSummons">Dissiper</button></div>` : ''}
      <div class="vtt-res-scroll vtt-res-cards is-list${_reservePicked.size ? ' is-selecting' : ''}">${list}</div>
      ${selectionBar}` : '';

    const bringEl = document.getElementById('vtt-bring-group');
    if (bringEl) {
      const onlineReserve = reserve.filter(t => t.type === 'player' && isOnline(t.ownerId));
      const pageNames = [...new Set(onlineReserve.map(token => VS.pages?.[token.pageId]?.name).filter(Boolean))];
      bringEl.hidden = !onlineReserveCount || !['all','player'].includes(_distributionFilter);
      bringEl.innerHTML = !bringEl.hidden ? `<div class="vtt-bring-avatars">${onlineReserve.slice(0,4).map(token => { const ld = _live(token); const initial = tokenInitial(token, ld); return `<span>${ld.displayImage ? `<img src="${_esc(ld.displayImage)}" alt="">` : _esc(initial)}</span>`; }).join('')}</div><span><b>${onlineReserveCount} joueur${onlineReserveCount > 1 ? 's' : ''} en ligne</b><small>${pageNames.length === 1 ? `sur ${_esc(pageNames[0])}` : pageNames.length > 1 ? `sur ${pageNames.length} autres scènes` : 'à placer sur cette scène'}</small></span><button type="button" data-vtt-fn="_vttBringOnlinePlayers">Amener</button>` : '';
    }
  }

  const beEl = document.getElementById('vtt-bestiary-body');
  if (beEl) {
    const showBestiary = _distributionFilter === 'all' || _distributionFilter === 'bestiary';
    beEl.hidden = !showBestiary;
    const bsts = Object.values(VS.bestiary)
      .filter(b => !_bstSearch || _searchIncludes(b.nom || '', _bstSearch))
      .sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }));
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

export function _pageThumbUrl(p) {
  const imgs = Array.isArray(p?.backgroundImages) ? p.backgroundImages : [];
  for (const image of imgs) {
    const resolved = resolveMapImageUrl(image);
    if (resolved) return resolved;
  }
  return '';
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

export function _pageMenuItems(pageId) {
  const page = VS.pages[pageId];
  if (!page) return [];
  return [
    { label:'📡 Envoyer aux joueurs', action:'_vttSendToPage', args:pageId },
    { label:'▣ Changer la carte…', action:'_vttReplacePageMap', args:pageId },
    { label:'📁 Déplacer vers…', action:'_vttPageMoveMenu', args:`$event|${pageId}` },
    { label:'✏️ Modifier la scène', action:'_vttEditPage', args:pageId },
    { label:'⧉ Dupliquer sans les tokens', action:'_vttDuplicatePage', args:pageId },
    '---',
    { label:'🗑️ Supprimer la scène', action:'_vttDeletePage', args:pageId },
  ];
}

export function _vttPageMoveMenu(event, pageId) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const page = VS.pages?.[pageId];
  if (!page) return;
  const folders = [...new Set(Object.values(VS.pages || {}).map(item => (item.folder || '').trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'}));
  const rect = event?.currentTarget?.getBoundingClientRect?.();
  _showCtxMenu(event?.clientX || rect?.left || 0, event?.clientY || rect?.bottom || 0, [
    { label:'Déplacer la scène' },
    { label:`${!page.folder ? '✓ ' : ''}Sans dossier`, action:'_vttMovePageToFolder', args:`${pageId}|` },
    ...folders.map(folder => ({ label:`${(page.folder || '').trim() === folder ? '✓ ' : ''}${folder}`, action:'_vttMovePageToFolder', args:`${pageId}|${encodeURIComponent(folder)}` })),
  ]);
}

export async function _vttMovePageToFolder(pageId, encodedFolder = '') {
  const page = VS.pages?.[pageId]; if (!page) return;
  const folder = encodedFolder ? decodeURIComponent(encodedFolder) : '';
  if ((page.folder || '').trim() === folder) return;
  const siblings = Object.values(VS.pages || {}).filter(item => (item.folder || '').trim() === folder);
  try {
    await updateDoc(_pgRef(pageId), { folder, order:siblings.length });
    Object.assign(page, { folder, order:siblings.length });
    _renderSceneReel();
    showNotif(`Scène déplacée vers « ${_pageFolderLabel(folder)} ».`, 'success');
  } catch (error) {
    console.error('[vtt] déplacement scène', error);
    showNotif('Impossible de déplacer la scène.', 'error');
  }
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

export function _vttReelFolder(folder) {
  _pageFolderFilter = folder === 'all' ? 'all' : decodeURIComponent(folder || '');
  _savePageFolderFilter();
  _renderSceneReel();
}

export function _vttReelFolderMenu(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const all = Object.values(VS.pages || {});
  const ordered = [...new Set([
    ...(VS.session?.pageFolderOrder || []).filter(Boolean),
    ...all.map(page => (page.folder || '').trim()).filter(Boolean).sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'})),
  ])];
  const rect = event?.currentTarget?.getBoundingClientRect?.();
  _showCtxMenu(event?.clientX || rect?.left || 0, event?.clientY || rect?.bottom || 0, [
    { label:`${_pageFolderFilter === 'all' ? '✓ ' : ''}Toutes les scènes · ${all.length}`, action:'_vttReelFolder', args:'all' },
    ...ordered.map(folder => ({ label:`${_pageFolderFilter === folder ? '✓ ' : ''}${folder} · ${all.filter(page => (page.folder || '').trim() === folder).length}`, action:'_vttReelFolder', args:encodeURIComponent(folder) })),
    ...(all.some(page => !(page.folder || '').trim()) ? [{ label:`${_pageFolderFilter === '' ? '✓ ' : ''}Sans dossier · ${all.filter(page => !(page.folder || '').trim()).length}`, action:'_vttReelFolder', args:'' }] : []),
  ]);
}

export function _vttReelToggle() {
  _closeScenePopover();
  _reelCompact = !_reelCompact;
  try { localStorage.setItem('vtt-bar-mode', _reelCompact ? 'compact' : 'strip'); } catch {}
  _renderPageTabs();
}

function _closeScenePopover() {
  const popover = document.getElementById('vtt-scene-popover');
  if (popover) popover.hidden = true;
  _reelPopoverSortables.forEach(sortable => { try { sortable.destroy(); } catch {} });
  _reelPopoverSortables = [];
  if (_reelPopoverOutsideHandler) {
    document.removeEventListener('pointerdown', _reelPopoverOutsideHandler, true);
    _reelPopoverOutsideHandler = null;
  }
}

export async function _vttOpenSceneFromPopover(pageId) {
  _closeScenePopover();
  await _switchPage(pageId);
}

export function _vttSceneStep(direction = '1') {
  const pages = Object.values(VS.pages || {})
    .filter(page => _pageFolderFilter === 'all' || (page.folder || '').trim() === _pageFolderFilter)
    .sort(_pageSmartSort);
  if (!pages.length) return;
  const index = Math.max(0, pages.findIndex(page => page.id === VS.activePage?.id));
  const step = Number(direction) < 0 ? -1 : 1;
  _switchPage(pages[(index + step + pages.length) % pages.length].id);
}

export function _vttReelAll() {
  const popover = document.getElementById('vtt-scene-popover');
  if (!popover) return;
  if (!popover.hidden) {
    _closeScenePopover();
    return;
  }
  const pages = Object.values(VS.pages || {});
  const folderOrder = [...new Set([
    ...(VS.session?.pageFolderOrder || []).filter(Boolean),
    ...pages.map(page => (page.folder || '').trim()).filter(Boolean).sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'})),
    '',
  ])];
  const sceneCard = page => {
    const thumb = _pageThumbUrl(page);
    const isActive = page.id === VS.activePage?.id;
    const isPlayers = page.id === VS.session?.activePageId;
    const sendIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2"/><path d="M8 8a5.6 5.6 0 0 0 0 8M16 8a5.6 5.6 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/></svg>';
    return `<article class="vtt-scene-popover-card" data-page-id="${page.id}" data-scene-search="${_esc(`${page.name || ''} ${page.folder || ''}`.toLowerCase())}">
      <button type="button" class="vtt-scene-popover-open${isActive ? ' active' : ''}" data-vtt-fn="_vttOpenSceneFromPopover" data-vtt-args="${page.id}" style="${thumb ? `background-image:url('${_esc(thumb)}')` : ''}">
        ${isPlayers ? '<small>Joueurs</small>' : ''}<b>${_esc(page.name || 'Scène')}</b>
      </button>
      <span class="vtt-scene-popover-actions">${isPlayers ? '' : `<button type="button" data-vtt-fn="_vttSendToPage" data-vtt-args="${page.id}" title="Envoyer les joueurs">${sendIcon}</button>`}<button type="button" data-vtt-fn="_vttPageMenu" data-vtt-args="$event|${page.id}" aria-label="Actions">•••</button></span>
    </article>`;
  };
  const grouped = folderOrder.map(folder => ({
    folder,
    pages:pages.filter(page => (page.folder || '').trim() === folder).sort(_pageSmartSort),
  })).filter(group => group.pages.length);
  const searchIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/></svg>';
  const plusIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  popover.innerHTML = `<div class="vtt-scene-popover-head"><h3>Scènes</h3><label class="vtt-scene-popover-search">${searchIcon}<input type="search" placeholder="Rechercher une scène, un dossier…" data-vtt-fn="_vttScenePopoverSearch" data-vtt-on="input" data-vtt-args="$value"></label><button type="button" class="vtt-scene-popover-new" data-vtt-fn="_vttAddPage">${plusIcon}Nouvelle</button><button type="button" class="vtt-scene-popover-close" data-vtt-fn="_vttReelAll" aria-label="Fermer">×</button></div>
    <div class="vtt-scene-popover-body"><div class="vtt-scene-popover-folders">${grouped.map(group => `<section class="vtt-scene-popover-folder" data-folder="${encodeURIComponent(group.folder)}"><h4><i>⋮⋮</i><span>${_esc(_pageFolderLabel(group.folder))}</span><b>${group.pages.length}</b><em></em></h4><div class="vtt-scene-popover-grid">${group.pages.map(sceneCard).join('')}</div></section>`).join('')}</div><div class="vtt-scene-popover-empty" hidden>Aucune scène ne correspond.<button type="button" data-vtt-fn="_vttAddPage">${plusIcon}Créer une scène</button></div></div>`;
  popover.hidden = false;
  _reelPopoverSortables.forEach(sortable => { try { sortable.destroy(); } catch {} });
  _reelPopoverSortables = [];
  const persistPages = async () => {
    const batch = writeBatch(db);
    let changed = 0;
    popover.querySelectorAll('.vtt-scene-popover-folder').forEach(section => {
      const folder = decodeURIComponent(section.dataset.folder || '');
      section.querySelectorAll('.vtt-scene-popover-card[data-page-id]').forEach((card, order) => {
        const page = VS.pages?.[card.dataset.pageId];
        if (!page || ((page.folder || '').trim() === folder && (page.order ?? 0) === order)) return;
        Object.assign(page, { folder, order });
        batch.update(_pgRef(page.id), { folder, order });
        changed++;
      });
    });
    if (changed) await batch.commit().catch(error => { console.error('[vtt] rangement scènes', error); showNotif('Impossible de ranger les scènes.', 'error'); });
  };
  popover.querySelectorAll('.vtt-scene-popover-grid').forEach(grid => _reelPopoverSortables.push(new Sortable(grid, {
    group:'vtt-scene-popover-pages', animation:140, draggable:'.vtt-scene-popover-card', onEnd:persistPages,
  })));
  const foldersEl = popover.querySelector('.vtt-scene-popover-folders');
  if (foldersEl) _reelPopoverSortables.push(new Sortable(foldersEl, {
    animation:140, draggable:'.vtt-scene-popover-folder', handle:'h4',
    onEnd:async () => {
      const order = [...foldersEl.querySelectorAll('.vtt-scene-popover-folder')].map(section => decodeURIComponent(section.dataset.folder || '')).filter(Boolean);
      await setDoc(_sesRef(), { pageFolderOrder:order }, { merge:true }).catch(error => { console.error('[vtt] ordre dossiers', error); showNotif("Impossible d'enregistrer l'ordre des dossiers.", 'error'); });
    },
  }));
  window.setTimeout(() => {
    _reelPopoverOutsideHandler = event => {
      if (popover.hidden || popover.contains(event.target) || event.target?.closest?.('[data-vtt-fn="_vttReelAll"]')) return;
      _closeScenePopover();
    };
    document.addEventListener('pointerdown', _reelPopoverOutsideHandler, true);
    popover.querySelector('input')?.focus();
  }, 0);
}

export function _vttScenePopoverSearch(value) {
  const q = String(value || '').trim().toLocaleLowerCase('fr');
  document.querySelectorAll('#vtt-scene-popover [data-scene-search]').forEach(card => {
    card.hidden = !!q && !String(card.dataset.sceneSearch || '').includes(q);
  });
  document.querySelectorAll('#vtt-scene-popover .vtt-scene-popover-folder').forEach(section => {
    section.hidden = ![...section.querySelectorAll('[data-scene-search]')].some(card => !card.hidden);
  });
  const empty = document.querySelector('#vtt-scene-popover .vtt-scene-popover-empty');
  if (empty) empty.hidden = [...document.querySelectorAll('#vtt-scene-popover [data-scene-search]')].some(card => !card.hidden);
}

export function _vttRegieMenu(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const rect = event?.currentTarget?.getBoundingClientRect?.();
  const playerPage = VS.pages?.[VS.session?.activePageId];
  const items = [
    { label:'📡 Envoyer les joueurs', action:'_vttSendToPage', args:VS.activePage?.id || '' },
    { label:'♟ Envoyer et amener le groupe', action:'_vttSendAndBring', args:VS.activePage?.id || '' },
  ];
  if (playerPage && playerPage.id !== VS.activePage?.id) {
    items.push('---', { label:`↩ Revenir sur « ${playerPage.name || 'scène joueurs'} »`, action:'_vttSwitchPage', args:playerPage.id });
  }
  _showCtxMenu(event?.clientX || rect?.left || 0, event?.clientY || rect?.bottom || 0, items);
}

export function _renderSceneReel() {
  const el = document.getElementById('vtt-scene-reel');
  if (!el || !STATE.isAdmin) return;
  const all = Object.values(VS.pages || {}).sort(_pageSmartSort);
  const folders = [...new Set([
    ...(VS.session?.pageFolderOrder || []).filter(Boolean),
    ...all.map(page => (page.folder || '').trim()),
  ])].filter(folder => all.some(page => (page.folder || '').trim() === folder));
  if (_pageFolderFilter !== 'all' && !folders.includes(_pageFolderFilter)) _pageFolderFilter = 'all';
  const pages = all.filter(page => _pageFolderFilter === 'all' || (page.folder || '').trim() === _pageFolderFilter);
  const currentFolderLabel = _pageFolderFilter === 'all' ? 'Toutes les scènes' : _pageFolderLabel(_pageFolderFilter);
  const currentFolderCount = _pageFolderFilter === 'all' ? all.length : pages.length;
  const sendIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2"/><path d="M8 8a5.6 5.6 0 0 0 0 8M16 8a5.6 5.6 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/></svg>';
  const folderIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h6l2-2h9v13h-17z"/></svg>';
  const downIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>';
  const gridIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/></svg>';
  const upIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5"/></svg>';
  const cards = pages.map(page => {
    const thumb = _pageThumbUrl(page);
    const isMj = page.id === VS.activePage?.id;
    const isPlayers = page.id === VS.session?.activePageId;
    return `<article class="vtt-reel-card${isMj ? ' is-active' : ''}${isPlayers ? ' is-players' : ''}" data-page-id="${page.id}">
      <button type="button" class="vtt-reel-open" data-vtt-fn="_vttSwitchPage" data-vtt-args="${page.id}" style="${thumb ? `background-image:url('${_esc(thumb)}')` : ''}" aria-label="Ouvrir ${_esc(page.name || 'la scène')}"><b>${_esc(page.name || 'Scène')}</b><em${isPlayers ? '' : ' hidden'}>Joueurs</em></button>
      <span class="vtt-reel-actions"><button type="button" class="vtt-reel-send" data-vtt-fn="_vttSendToPage" data-vtt-args="${page.id}" title="Envoyer les joueurs"${isPlayers ? ' hidden' : ''}>${sendIcon}</button><button type="button" data-vtt-fn="_vttPageMenu" data-vtt-args="$event|${page.id}" title="Actions">•••</button></span>
    </article>`;
  }).join('');
  el.hidden = _reelCompact;
  const structureKey = JSON.stringify({
    filter:_pageFolderFilter,
    pages:pages.map(page => [page.id, page.name || '', _pageThumbUrl(page), page.order ?? 0, (page.folder || '').trim()]),
  });
  if (el.dataset.structureKey === structureKey && el.querySelector('.vtt-reel-track')) {
    el.querySelectorAll('.vtt-reel-card[data-page-id]').forEach(card => {
      const isActive = card.dataset.pageId === VS.activePage?.id;
      const isPlayers = card.dataset.pageId === VS.session?.activePageId;
      card.classList.toggle('is-active', isActive);
      card.classList.toggle('is-players', isPlayers);
      const badge = card.querySelector('.vtt-reel-open em');
      const send = card.querySelector('.vtt-reel-send');
      if (badge) badge.hidden = !isPlayers;
      if (send) send.hidden = isPlayers;
    });
    requestAnimationFrame(() => el.querySelector('.vtt-reel-card.is-active')?.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'nearest' }));
    return;
  }
  el.dataset.structureKey = structureKey;
  el.innerHTML = `<button type="button" class="vtt-reel-folder" data-vtt-fn="_vttReelFolderMenu" data-vtt-args="$event" title="Changer de dossier"><small>Dossier · ${currentFolderCount}</small><span>${folderIcon}<b>${_esc(currentFolderLabel)}</b>${downIcon}</span></button>
    <div class="vtt-reel-track" id="vtt-reel-track">${cards}<button type="button" class="vtt-reel-new" data-vtt-fn="_vttAddPage"${_pageFolderFilter === 'all' ? '' : ` data-vtt-args="${encodeURIComponent(_pageFolderFilter)}"`}><span>＋</span><b>Nouvelle scène</b></button></div>
    <div class="vtt-reel-tools"><button type="button" data-vtt-fn="_vttReelAll" title="Toutes les scènes">${gridIcon}</button><button type="button" data-vtt-fn="_vttReelToggle" title="Réduire la pellicule">${upIcon}</button></div>`;
  try { _reelSortable?.destroy(); } catch {}
  _reelSortable = null;
  const track = document.getElementById('vtt-reel-track');
  if (track && pages.length > 1) {
    _reelSortable = new Sortable(track, {
      animation: 140,
      direction: 'horizontal',
      draggable: '.vtt-reel-card',
      ghostClass: 'vtt-reel-sortable-ghost',
      chosenClass: 'vtt-reel-sortable-chosen',
      onEnd: async () => {
        const grouped = new Map();
        track.querySelectorAll('.vtt-reel-card[data-page-id]').forEach(card => {
          const page = VS.pages?.[card.dataset.pageId];
          if (!page) return;
          const folder = (page.folder || '').trim();
          if (!grouped.has(folder)) grouped.set(folder, []);
          grouped.get(folder).push(page);
        });
        const batch = writeBatch(db);
        let changed = 0;
        grouped.forEach(items => items.forEach((page, order) => {
          if ((page.order ?? 0) === order) return;
          page.order = order;
          batch.update(_pgRef(page.id), { order });
          changed++;
        }));
        if (changed) await batch.commit().catch(error => {
          console.error('[vtt] ordre pellicule', error);
          showNotif("Impossible d'enregistrer l'ordre des scènes.", 'error');
        });
      },
    });
  }
  requestAnimationFrame(() => el.querySelector('.vtt-reel-card.is-active')?.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'nearest' }));
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
  const el=document.getElementById('vtt-page-tabs'); if (!el) return;
  const paint = (key, html) => {
    if (el.dataset.renderKey === key) return;
    el.dataset.renderKey = key;
    el.innerHTML = html;
  };
  if (STATE.isAdmin) {
    const active = VS.activePage;
    const players = VS.pages?.[VS.session?.activePageId];
    const synced = !!(active?.id && active.id === players?.id);
    const root = document.getElementById('vtt-root');
    root?.toggleAttribute('data-vtt-preview', !synced);
    if (root) root.dataset.reelCompact = _reelCompact ? '1' : '0';
    const state = synced
      ? `<span class="vtt-regie-state is-live${_reelCompact ? ' is-compact' : ''}"><i></i><b>En direct</b>${_reelCompact ? '' : `<em>·</em><strong>${_esc(active?.name || 'Aucune scène')}</strong>`}<small>Les joueurs voient ta scène</small></span>`
      : `<span class="vtt-regie-state is-preview${_reelCompact ? ' is-compact' : ''}"><i></i><b>Aperçu</b>${_reelCompact ? '' : `<em>·</em><strong>${_esc(active?.name || 'Aucune scène')}</strong>`}<small>Joueurs sur <button type="button" data-vtt-fn="_vttSwitchPage" data-vtt-args="${players?.id || ''}">${_esc(players?.name || 'aucune scène')}</button></small></span><button type="button" class="vtt-regie-send" data-vtt-fn="_vttSendToPage" data-vtt-args="${active?.id || ''}">Envoyer les joueurs</button><button type="button" class="vtt-regie-more" data-vtt-fn="_vttRegieMenu" data-vtt-args="$event" aria-label="Plus d’options">⌄</button>`;
    if (_reelCompact) {
      const thumb = _pageThumbUrl(active);
      const leftIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 7-5 5 5 5"/></svg>';
      const rightIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 7 5 5-5 5"/></svg>';
      const downIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>';
      const stripIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 6v12M16 6v12"/></svg>';
      paint(`mj|compact|${active?.id || ''}|${active?.name || ''}|${thumb}|${players?.id || ''}|${players?.name || ''}|${synced}`, `<div class="vtt-regie-compact"><button type="button" class="vtt-regie-compact-step" data-vtt-fn="_vttSceneStep" data-vtt-args="-1" aria-label="Scène précédente">${leftIcon}</button><button type="button" data-vtt-fn="_vttReelAll" class="vtt-regie-compact-scene"><span style="${thumb ? `background-image:url('${_esc(thumb)}')` : ''}"></span><b>${_esc(active?.name || 'Aucune scène')}</b>${downIcon}</button><button type="button" class="vtt-regie-compact-step" data-vtt-fn="_vttSceneStep" data-vtt-args="1" aria-label="Scène suivante">${rightIcon}</button><button type="button" class="vtt-regie-compact-expand" data-vtt-fn="_vttReelToggle" title="Afficher la pellicule">${stripIcon}</button></div>${state}`);
    } else {
      paint(`mj|strip|${active?.id || ''}|${active?.name || ''}|${players?.id || ''}|${players?.name || ''}|${synced}`, state);
    }
    _renderSceneReel();
    return;
  }
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
  paint(`player|${VS.activePage?.id || ''}|${name}|${canInvoke}|${canRetire}|${multi}`, `<span class="vtt-page-current-label">📍 ${_esc(name)}</span>${actionBtn}`);
}

export async function _switchPage(pageId) {
  const page=VS.pages[pageId]; if (!page) return;
  VS.activePage=page;
  _vttPageChanged();
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
