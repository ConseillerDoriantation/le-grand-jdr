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
import { _esc, _searchIncludes } from '../../shared/html.js';
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
let _bstSearch        = '';    // filtre texte appliqué au bestiaire
export let _trayTab          = (() => { try { return localStorage.getItem('vtt-tray-tab') || 'scenes'; } catch { return 'scenes'; } })(); // onglet actif du panneau MJ
let _pageSearch       = '';    // filtre texte appliqué à la liste des pages
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
let _trayOnOpen  = _loadTrayPref('on');
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
    if (t.pageId || t.type === 'enemy') return false;
    const key = _tokenEntityKey(t);
    if (!key) return true;
    if (reserveSeen.has(key)) return false;
    reserveSeen.add(key); return true;
  });

  const ae = document.activeElement;
  const focusedSearch = ae?.classList?.contains('vtt-tray-search-input') ? ae.dataset.search : null;
  const caretPos = focusedSearch != null ? ae.selectionStart : null;

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
      <div class="vtt-tray-actions">${dupBtn}${actionBtn}${delBtn}</div>
    </div>`;
  };

  const mkResLine = t => {
    const ld = _live(t);
    const typeIcon = t.type === 'player' ? '🧑' : '👤';
    const col = TYPE_COLOR[t.type] ?? '#888';
    const online = t.type === 'player' && isOnline(t.ownerId);
    const statusDot = t.type === 'player'
      ? `<span class="vtt-res-line-status ${online ? 'is-online' : ''}" title="${online ? 'En ligne' : 'Hors ligne'}"></span>` : '';
    const name = _esc(ld.displayName ?? t.name);
    return `<button class="vtt-res-line" data-vtt-fn="_vttPlace" data-vtt-args="${t.id}" title="Placer ${name}">
      <span class="vtt-res-line-dot" style="border-color:${col};color:${col}">
        ${ld.displayImage ? `<img src="${ld.displayImage}" alt="">` : `<span>${typeIcon}</span>`}
        ${statusDot}
      </span>
      <span class="vtt-res-line-name">${name}</span>
    </button>`;
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
    const searched = reserve.filter(t => !_traySearch || _searchIncludes(_live(t).displayName ?? t.name ?? '', _traySearch));
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
    const list = searched.length
      ? mkBlock('🟢 En ligne', presentPlayers, '_vttToggleOn', _trayOnOpen)
        + mkBlock('🕓 Hors ligne', absentPlayers, '_vttToggleOff', _trayOffOpen)
        + mkBlock('👤 PNJ', npcs, '_vttToggleNpc', _trayNpcOpen)
      : `<div class="vtt-tray-empty">${reserve.length ? 'Aucun résultat' : 'Réserve vide'}</div>`;
    reEl.innerHTML = `
      <div class="vtt-tray-search">
        <span class="vtt-tray-search-ic">🔍</span>
        <input type="text" class="vtt-tray-search-input" data-search="reserve" placeholder="Rechercher un perso…"
          value="${_esc(_traySearch)}" data-vtt-fn="_vttTraySearch" data-vtt-on="input" data-vtt-args="$value">
        ${clrBtn}
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
          const img = b.photoURL || b.photo || b.avatar || b.imageUrl || '';
          const init = (b.nom || '?')[0].toUpperCase();
          return `<button class="vtt-bst-tile" data-vtt-fn="_vttPlaceFromBestiary" data-vtt-args="${b.id}"
              title="${_esc(b.nom || 'Créature')} · PV ${parseInt(b.pvMax) || '?'}">
            ${img ? `<img src="${img}" alt="${_esc(b.nom || '')}">` : `<span class="vtt-bst-icon">${init}</span>`}
            <div class="vtt-bst-name">${_esc((b.nom || 'Créature').slice(0, 10))}</div>
          </button>`;
        }).join('')}</div>`
      : `<div class="vtt-tray-empty">${Object.keys(VS.bestiary).length ? 'Aucun résultat' : 'Bestiaire vide'}</div>`;
    beEl.innerHTML = `
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
// ─ Liste verticale des pages dans le tray (MJ) ─────────────────────
export function _renderPageList() {
  const el=document.getElementById('vtt-tray-pages'); if (!el) return;
  const broadcastId=VS.session.activePageId;
  const all=Object.values(VS.pages).sort((a,b)=>(a.order??0)-(b.order??0));

  // Préserve le focus/caret de la barre de recherche au rerender
  const ae = document.activeElement;
  const searchFocused = ae?.id === 'vtt-page-search' && el.contains(ae);
  const caretPos = searchFocused ? ae.selectionStart : null;
  // Préserve le défilement de la vue Scènes : reconstruire la liste via innerHTML
  // (au switch de page, _renderPageTabs appelle _renderPageList) clampe sinon le
  // scrollTop du parent et fait remonter le panneau tout en haut.
  const _scroller = el.closest('.vtt-tray-view');
  const _sTop = _scroller ? _scroller.scrollTop : 0;

  if (!all.length) {
    el.innerHTML=`<div class="vtt-tray-empty">Aucune page<br><small>Clique ＋ pour créer</small></div>`;
    return;
  }

  const matches = p => _searchIncludes(p.name || '', _pageSearch);
  const q = String(_pageSearch || '').trim();

  // Regroupe par dossier ('' = sans dossier, affiché en dernier)
  const groups = new Map();
  for (const p of all) {
    if (!matches(p)) continue;
    const f = (p.folder||'').trim();
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(p);
  }
  // Ordre des dossiers : ordre MJ persisté (session.pageFolderOrder) puis alpha
  // pour les nouveaux ; '' (sans dossier) toujours en dernier.
  const fOrder = Array.isArray(VS.session.pageFolderOrder) ? VS.session.pageFolderOrder : [];
  const fIdx = f => { const i = fOrder.indexOf(f); return i < 0 ? 1e9 : i; };
  const folders = [...groups.keys()].sort((a,b)=>{
    if (a==='') return 1; if (b==='') return -1;          // sans dossier en dernier
    const d = fIdx(a) - fIdx(b); if (d) return d;
    return a.localeCompare(b,'fr',{sensitivity:'base'});
  });

  const _pageRow = p => {
    const isPlayers=p.id===broadcastId, isMj=p.id===VS.activePage?.id;
    const cls=isMj&&isPlayers?'mj-and-players':isMj?'mj':isPlayers?'players':'';
    return `<div class="vtt-page-item ${cls}" data-page-id="${p.id}" data-vtt-fn="_vttSwitchPage" data-vtt-args="${p.id}" title="${_esc(p.name)} · ${p.cols||24}×${p.rows||18} cases">
      <span class="vtt-page-item-grip" title="Glisser pour déplacer">⠿</span>
      <div class="vtt-page-item-badges">
        ${isMj     ?'<span title="Votre vue">📍</span>':''}
        ${isPlayers?'<span title="Joueurs ici">👥</span>':''}
      </div>
      <div class="vtt-page-item-name">${_esc(p.name)}</div>
      <div class="vtt-page-item-acts">
        <button class="vtt-page-item-btn" data-vtt-fn="_vttSendToPage" data-vtt-args="${p.id}" title="Envoyer tous les joueurs ici">📡</button>
        <button class="vtt-page-item-btn" data-vtt-fn="_vttEditPage" data-vtt-args="${p.id}" title="Renommer / dossier / taille">✏</button>
        <button class="vtt-page-item-btn vtt-page-item-del" data-vtt-fn="_vttDeletePage" data-vtt-args="${p.id}" title="Supprimer">×</button>
      </div>
    </div>`;
  };

  // Une seule "section" implicite (sans dossier) et pas de recherche → pas de header de groupe
  const onlyUngrouped = folders.length === 1 && folders[0] === '';
  let listHtml;
  if (!groups.size) {
    listHtml = `<div class="vtt-tray-empty">Aucune page ne correspond</div>`;
  } else if (onlyUngrouped) {
    listHtml = `<div class="vtt-page-folder-body" data-folder="">${groups.get('').map(_pageRow).join('')}</div>`;
  } else {
    listHtml = folders.map(f => {
      const rows = groups.get(f);
      const label = f || '— Sans dossier —';
      // En recherche, tout est déplié ; sinon respecte l'état persistant
      const closed = !q && _pageFoldClosed.has(f);
      return `<div class="vtt-page-folder${closed?' closed':''}" data-folder="${encodeURIComponent(f)}">
        <div class="vtt-page-folder-hd" data-vtt-fn="_vttPageFolderToggle" data-vtt-args="${encodeURIComponent(f)}">
          <span class="vtt-page-folder-grip" title="Glisser pour réordonner">⠿</span>
          <span class="vtt-page-folder-chev">▸</span>
          <span class="vtt-page-folder-name">${_esc(label)}</span>
          <span class="vtt-page-folder-count">${rows.length}</span>
        </div>
        <div class="vtt-page-folder-body" data-folder="${encodeURIComponent(f)}">${rows.map(_pageRow).join('')}</div>
      </div>`;
    }).join('');
  }

  el.innerHTML = `
    <div class="vtt-page-search-row">
      <input type="text" id="vtt-page-search" class="vtt-page-search" placeholder="🔍 Rechercher une page…"
        autocomplete="off" value="${_esc(_pageSearch)}"
        data-vtt-fn="_vttPageSearch" data-vtt-on="input" data-vtt-args="$value">
      ${_pageSearch?`<button class="vtt-page-search-x" data-vtt-fn="_vttPageSearchClear" title="Effacer">✕</button>`:''}
    </div>
    <div class="vtt-page-list">${listHtml}</div>`;

  if (searchFocused) {
    const inp = document.getElementById('vtt-page-search');
    if (inp) { inp.focus(); if (caretPos != null) { try { inp.setSelectionRange(caretPos, caretPos); } catch {} } }
  }
  // Restaure le défilement après le rebuild (et après un éventuel focus qui pourrait
  // déplacer la vue). Clampé naturellement si le contenu est devenu plus court.
  if (_scroller) _scroller.scrollTop = _sTop;
  // Drag & drop désactivé pendant une recherche (la liste filtrée n'est pas l'ordre réel)
  _initPageSortables(el, { pages: !q, folders: !q && !onlyUngrouped });
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
  const myTok = uid ? Object.values(VS.tokens).find(e => e.data?.ownerId === uid)?.data : null;
  const canInvoke = !!(myTok && VS.activePage && myTok.pageId !== VS.activePage.id);
  const onActivePage = !!(myTok && VS.activePage && myTok.pageId === VS.activePage.id);
  const actionBtn = canInvoke
    ? `<button class="vtt-btn-sm" data-vtt-fn="_vttInvokeMyToken" title="Placer ton token sur cette carte">🧑 Invoquer mon token</button>`
    : onActivePage
    ? `<button class="vtt-btn-sm" data-vtt-fn="_vttRetireMyToken" title="Retirer ton token de la carte">📦 Ranger mon token</button>`
    : '';
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
