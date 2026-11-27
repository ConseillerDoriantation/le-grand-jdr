// ══════════════════════════════════════════════════════════════════════════════
// ACHIEVEMENTS.JS — Hauts-Faits
// ✓ Upload + redimensionnement image (ratio libre, max 1400px, fond flou à l'affichage)
// ✓ Hauts-faits sans image affichés correctement (emoji + fond)
// ✓ Drag & drop SortableJS pour réordonner, ordre persisté dans Firestore
// ✓ Ordre partagé pour tous les utilisateurs
// ══════════════════════════════════════════════════════════════════════════════
import Sortable from '../vendor/sortable.esm.js';
import { makeSortable } from '../shared/sortable-helper.js';
import { confirmDelete, tryDoc } from '../shared/crud.js';
import { loadCollection, deleteFromCol, getDocData, saveDoc, updateInCol, batchUpdateInCol } from '../data/firestore.js';
import { watchPageCollection, watchPageDoc } from '../shared/realtime.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { _esc } from '../shared/html.js';
import { STATE } from '../core/state.js';
import { _ensureFeatureCss, navigate } from '../core/navigation.js';
import { attachDropAndResize } from '../shared/image-crop.js';
import { buildFresqueLayout } from '../shared/justified-layout.js';
import { buildChronicle } from './achievements-chronicle-model.js';
import { bindChronicle, chroniclePreset, renderChronicle } from './achievements-chronicle.js';
import { resolveHorizontalSwipe } from '../shared/lightbox-layout.js';
import { getMyCharacters, sortCharactersForDisplay } from '../shared/char-stats.js';
import { characterAvatarHtml, characterPortraitContent } from '../shared/portraits.js';
import { lsJson } from '../shared/local-storage.js';
import PAGES from './pages.js';
import { registerActions } from '../core/actions.js';
import { openCatalogAdmin } from '../shared/catalog-admin.js';
import { catalogReplacementFor } from '../shared/catalog-admin-utils.js';
import { getRouteSub, setRouteSub } from '../shared/route.js';

// ── Constantes ────────────────────────────────────────────────────────────────
const DEFAULT_ACH_CATS = [
  { id:'epique',   label:'Épique',   emoji:'⚔️',  color:'#4f8cff', glow:'rgba(79,140,255,0.18)',  line:'rgba(79,140,255,0.35)', enabled:true },
  { id:'comique',  label:'Comique',  emoji:'🎭',  color:'#e8b84b', glow:'rgba(232,184,75,0.18)',  line:'rgba(232,184,75,0.35)', enabled:true },
  { id:'histoire', label:'Histoire', emoji:'📖',  color:'#22c38e', glow:'rgba(34,195,142,0.18)', line:'rgba(34,195,142,0.35)', enabled:true },
];
let ACH_CATS = DEFAULT_ACH_CATS.map(c => ({ ...c }));
const ACH_CAT_PALETTE = ['#4f8cff', '#e8b84b', '#22c38e', '#b47fff', '#ff5a7e', '#55d6aa', '#f97316', '#f8fafc'];

function _achCategoryId(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || `categorie_${Date.now()}`;
}

function _normalizeAchCategory(raw = {}, index = 0) {
  const base = DEFAULT_ACH_CATS[index] || DEFAULT_ACH_CATS[0];
  const label = String(raw.label || raw.nom || base.label || 'Catégorie').trim();
  const emoji = String(raw.emoji || base.emoji || '🏆').trim();
  const color = String(raw.color || base.color || '#7eb0ff').trim();
  return {
    id: _achCategoryId(raw.id || label),
    label,
    emoji,
    color,
    glow: raw.glow || `${color}29`,
    line: raw.line || `${color}59`,
    enabled: raw.enabled !== false,
  };
}

function _setAchievementCategories(categories = DEFAULT_ACH_CATS) {
  const normalized = (Array.isArray(categories) && categories.length ? categories : DEFAULT_ACH_CATS)
    .map(_normalizeAchCategory)
    .filter(c => c.enabled !== false);
  ACH_CATS = normalized.length ? normalized : DEFAULT_ACH_CATS.map(c => ({ ...c }));
  if (STORE.filter !== 'all' && !ACH_CATS.some(c => c.id === STORE.filter)) STORE.filter = 'all';
}

function _achDefaultCategoryId() {
  return ACH_CATS[0]?.id || DEFAULT_ACH_CATS[0].id;
}

function _achModalCats() {
  return ACH_CATS.map(c => ({ ...c, modalLabel: `${c.emoji || ''} ${c.label || ''}`.trim() }));
}

async function _loadAchievementCategories() {
  const doc = await getDocData('achievements_meta', 'categories').catch(() => null);
  _setAchievementCategories(Array.isArray(doc?.categories) && doc.categories.length ? doc.categories : DEFAULT_ACH_CATS);
  return ACH_CATS;
}

async function _saveAchievementCategories(categories) {
  const normalized = (categories || []).map(_normalizeAchCategory).filter(c => c.enabled !== false);
  await saveDoc('achievements_meta', 'categories', { categories: normalized });
  _setAchievementCategories(normalized);
  return ACH_CATS;
}


const STORE = {
  items:         [],        // hauts-faits affichés (public + secret fusionnés, MJ)
  publicItems:   [],        // miroir de la collection `achievements` (lue par tous)
  secretItems:   [],        // sous-collection `achievements_secret` (MJ-only), [] côté joueur
  missions:      [],        // missions de la Trame disponibles pour les liaisons
  lightboxItems: {},        // { [catId]: item[] } cache lightbox
  filter:        'all',     // 'all' | 'epique' | 'comique' | 'histoire'
  missionFilter: 'all',     // 'all' | '__none' | missionId
  charFilter:    'all',     // 'all' | charId
  charFilters:   [],        // sélection multiple de personnages
  charMatchMode: 'any',     // 'any' = au moins un sélectionné | 'shared' = tous les sélectionnés
  charPickerOpen:false,
  view:          'galerie', // 'galerie' | 'timeline' | 'missions'
  search:        '',
  timelineDesc:  false,     // true = plus récent en haut
  timelineMode:  'recit',
  group:         'none',    // 'none' | 'mission' | 'month'
  density:       'm',       // 's' | 'm' | 'l'
  galleryOrder:  'asc',     // 'asc' | 'desc'
  lastSeen:      '',
  order:         [],        // miroir de l'ordre Firestore
};

let _achRowSortables = [];
let _achDragBlockClick = false;
let _achClickGuardInstalled = false;
let _achKeyboardInstalled = false;
let _achUploader = null;
let _achLightboxKeyHandler = null;
let _achPreferencesKey = '';
const _achRatioCache = new Map();
let _achGalleryResizeObserver = null;
let _achGalleryResizeTimer = null;
let _achObservedGalleryWidth = 0;
let _achRenderedContentEl = null;
let _achLastRenderSignature = '';
let _achRenderEpoch = 0;
let _achLocalMutationDepth = 0;
let _achBulkMode = false;
const _achBulkSelected = new Set();
let _achScrollHost = null;
let _achScrollHandler = null;
let _achScrollRaf = 0;
let _achScrollIdleTimer = null;
let _achScrollTargets = [];
let _achScrollObserver = null;
let _achPageActive = false;
let _achSlideshowTimer = null;
let _achPageDropInstalled = false;
const _achSeries = { files: [], createdIds: [], baseOrder: null, transition: false, chroniclePreset: null };
const _achSeriesPreviewUrls = new Map();
let _achLightboxReturnId = '';
let _achRailCleanup = null;
let _achCardPositionCache = { gallery: null, count: 0, cards: [] };
let _achMiniRenderKey = '';
let _achMiniRenderEl = null;
let _achRailActiveId = '';
let _achRailTrackHeight = 0;
let _achRailThumbHeight = 0;
let _achImageWarmCleanup = null;
let _achChronicle = null;
let _achChronicleModel = null;
let _achChronicleChapterById = new Map();
let _achChronicleCrumb = null;
let _achChronicleDropTarget = null;

let _achSelectCat = () => {};
let _achToggleContrib = () => {};
let _achFilterContrib = () => {};

export function getAchievementsShellState() {
  return {
    items: STORE.items, filter: STORE.filter, missionFilter: STORE.missionFilter,
    view: STORE.view, search: STORE.search, group: STORE.group,
    density: STORE.density, galleryOrder: STORE.galleryOrder,
  };
}

function _achSelectedCharIds() {
  if (Array.isArray(STORE.charFilters) && STORE.charFilters.length) {
    return [...new Set(STORE.charFilters.filter(Boolean))];
  }
  return STORE.charFilter && STORE.charFilter !== 'all' ? [STORE.charFilter] : [];
}

function _achSetSelectedCharIds(ids) {
  const clean = [...new Set((ids || []).filter(Boolean))];
  STORE.charFilters = clean;
  STORE.charFilter = clean.length === 1 ? clean[0] : 'all';
  if (clean.length < 2) STORE.charMatchMode = 'any';
}

function _achPreferencesStorageKey() {
  const adventureId = STATE.adventure?.id || 'default';
  const userId = STATE.user?.uid || 'guest';
  return `grimorium:achievements:prefs:${adventureId}:${userId}`;
}

function _achRestorePreferences() {
  const key = _achPreferencesStorageKey();
  if (_achPreferencesKey === key) return;
  _achPreferencesKey = key;
  const prefs = lsJson.get(key, {});
  STORE.view = ['galerie', 'timeline', 'missions'].includes(prefs?.view) ? prefs.view : 'galerie';
  STORE.timelineDesc = prefs?.timelineDesc === true;
  STORE.timelineMode = prefs?.timelineMode === 'sommaire' ? 'sommaire' : 'recit';
  STORE.group = ['none', 'mission', 'month'].includes(prefs?.group) ? prefs.group : 'none';
  STORE.density = ['s', 'm', 'l'].includes(prefs?.density) ? prefs.density : 'm';
  STORE.galleryOrder = prefs?.order === 'desc' ? 'desc' : 'asc';
  STORE.lastSeen = typeof prefs?.lastSeen === 'string' ? prefs.lastSeen : '';
}

function _achSavePreferences() {
  const key = _achPreferencesStorageKey();
  _achPreferencesKey = key;
  lsJson.set(key, {
    view: ['galerie', 'timeline', 'missions'].includes(STORE.view) ? STORE.view : 'galerie',
    timelineDesc: STORE.timelineDesc === true,
    timelineMode: STORE.timelineMode,
    group: ['none', 'mission', 'month'].includes(STORE.group) ? STORE.group : 'none',
    density: ['s', 'm', 'l'].includes(STORE.density) ? STORE.density : 'm',
    order: STORE.galleryOrder === 'desc' ? 'desc' : 'asc',
    lastSeen: STORE.lastSeen || '',
  });
}

function _achInstallScrollUi() {
  if (_achScrollHandler) _achScrollTargets.forEach(target => target?.removeEventListener?.('scroll', _achScrollHandler));
  if (_achScrollHandler) document.removeEventListener('scroll', _achScrollHandler, true);
  _achScrollTargets = [];
  _achScrollObserver?.disconnect();
  _achScrollObserver = null;
  if (_achScrollRaf) cancelAnimationFrame(_achScrollRaf);
  if (_achScrollIdleTimer) clearTimeout(_achScrollIdleTimer);
  const host = document.getElementById('main-content');
  const command = document.querySelector('.hall-command');
  const mini = document.querySelector('.ach-mini');
  if (!host || !command || !mini) return;
  _achScrollHost = host;
  const setMiniVisible = visible => {
    if (mini.classList.contains('is-visible') === visible) return;
    mini.classList.toggle('is-visible', visible);
    mini.setAttribute('aria-hidden', String(!visible));
  };
  const updateProgress = () => {
    _achScrollRaf = 0;
    if (!document.contains(mini) || !document.contains(command)) return;
    // Le shell utilise selon le navigateur soit #main-content, soit le document
    // comme scroller. La position réelle est plus fiable que les rectangles du
    // bandeau, dont les coordonnées restent parfois figées dans un overflow.
    const { top } = _achScrollMetrics();
    const commandBottom = command.getBoundingClientRect().bottom;
    const miniTop = Number.parseFloat(getComputedStyle(mini).top) || 0;
    // Le bandeau doit être réellement interactif au même instant où il devient
    // visible. La géométrie couvre les restaurations de scroll imbriquées pour
    // lesquelles scrollTop peut encore être à zéro pendant une frame.
    const visible = top > command.offsetHeight + 4 || commandBottom <= miniTop + 4;
    setMiniVisible(visible);
    if (STORE.view === 'timeline') _achChronicle?.sync();
    else _achUpdateRailUi(null, { updateActive: false });
  };
  const updateActiveItem = () => {
    _achScrollIdleTimer = null;
    if (!document.contains(mini)) return;
    if (STORE.view === 'timeline') return;
    const topItem = _achTopVisibleItem();
    _achUpdateMiniBar(topItem);
    _achUpdateRailUi(topItem, { updateProgress: false });
  };
  _achScrollHandler = event => {
    const target = event?.target;
    if (STORE.view === 'timeline' && ![host, window, document, document.scrollingElement].includes(target)) return;
    if (target instanceof HTMLElement && target.scrollHeight > target.clientHeight + 1) _achScrollHost = target;
    if (!_achScrollRaf) _achScrollRaf = requestAnimationFrame(updateProgress);
    if (STORE.view === 'timeline') return;
    if (_achScrollIdleTimer) clearTimeout(_achScrollIdleTimer);
    _achScrollIdleTimer = setTimeout(updateActiveItem, 90);
  };
  _achScrollTargets = [...new Set([host, document.scrollingElement, window].filter(Boolean))];
  _achScrollTargets.forEach(target => target.addEventListener('scroll', _achScrollHandler, { passive: true }));
  // Capture aussi les wrappers scrollables créés par le layout de la page.
  document.addEventListener('scroll', _achScrollHandler, { capture: true, passive: true });
  // Chrome peut restaurer la position d'un conteneur après l'initialisation
  // sans renvoyer d'évènement scroll. Observer le bandeau rend l'état compact
  // indépendant de ce timing et couvre aussi les changements de mise en page.
  if ('IntersectionObserver' in window) {
    const style = getComputedStyle(host);
    const root = host.scrollHeight > host.clientHeight + 1 && /auto|scroll/.test(style.overflowY) ? host : null;
    _achScrollObserver = new IntersectionObserver(([entry]) => {
      if (entry) {
        updateProgress();
        updateActiveItem();
      }
    }, { root, threshold: 0 });
    _achScrollObserver.observe(command);
  }
  updateProgress();
  updateActiveItem();
}

function _achCurrentScrollHost() {
  const main = document.getElementById('main-content');
  const root = document.scrollingElement;
  if (STORE.view === 'timeline' && main?.querySelector('.is-chronicle')) {
    return matchMedia('(min-width:769px)').matches ? main : root;
  }
  if ((_achScrollHost?.scrollTop || 0) > 0) return _achScrollHost;
  if ((main?.scrollTop || 0) > 0) return main;
  if ((root?.scrollTop || 0) > 0) return root;
  if (main && main.scrollHeight > main.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(main).overflowY)) return main;
  return root || main;
}

function _achScrollMetrics() {
  const host = _achCurrentScrollHost();
  if (!host) return { host: null, top: 0, height: window.innerHeight, total: document.documentElement.scrollHeight };
  return {
    host,
    top: host.scrollTop || 0,
    height: host === document.scrollingElement ? window.innerHeight : host.clientHeight,
    total: host.scrollHeight,
  };
}

function _achInvalidateCardPositionCache() {
  _achCardPositionCache = { gallery: null, count: 0, cards: [] };
}

function _achCardPositions(gallery) {
  const elements = [...gallery.querySelectorAll('[data-ach-id]')];
  if (_achCardPositionCache.gallery === gallery && _achCardPositionCache.count === elements.length) {
    return _achCardPositionCache.cards;
  }
  const galleryRect = elements.some(element => element.parentElement !== gallery)
    ? gallery.getBoundingClientRect()
    : null;
  const cards = elements.map(element => {
    if (!galleryRect) {
      const top = Number.parseFloat(element.style.top) || 0;
      const left = Number.parseFloat(element.style.left) || 0;
      const height = Number.parseFloat(element.style.height) || element.offsetHeight;
      return { element, top, bottom: top + height, left };
    }
    const rect = element.getBoundingClientRect();
    return {
      element,
      top: rect.top - galleryRect.top,
      bottom: rect.bottom - galleryRect.top,
      left: rect.left - galleryRect.left,
    };
  }).sort((a, b) => a.top - b.top || a.left - b.left);
  _achCardPositionCache = { gallery, count: elements.length, cards };
  return cards;
}

function _achWarmCardPositionCache(gallery) {
  if (!gallery?.isConnected) return;
  const warm = () => {
    if (gallery.isConnected && _achCardPositionCache.gallery !== gallery) _achCardPositions(gallery);
  };
  if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 350 });
  else setTimeout(warm, 0);
}

function _achInstallImageWarmup(gallery) {
  _achImageWarmCleanup?.();
  _achImageWarmCleanup = null;
  if (!gallery?.isConnected || !('IntersectionObserver' in window)) return;
  const host = document.getElementById('main-content');
  const root = host && host.scrollHeight > host.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(host).overflowY)
    ? host
    : null;
  const queue = [];
  const queued = new WeakSet();
  let active = 0;
  let scheduled = 0;
  let scrolling = false;
  let scrollIdleTimer = null;
  let stopped = false;
  const pump = () => {
    if (stopped || scrolling || active + scheduled >= 2 || !queue.length) return;
    const image = queue.shift();
    scheduled += 1;
    const start = () => {
      scheduled -= 1;
      if (stopped || !image?.isConnected) { pump(); return; }
      if (scrolling) {
        queue.unshift(image);
        return;
      }
      active += 1;
      image.loading = 'eager';
      image.fetchPriority = 'low';
      const decoded = typeof image.decode === 'function' ? image.decode() : Promise.resolve();
      decoded.catch(() => {}).finally(() => {
        active -= 1;
        pump();
      });
      pump();
    };
    if ('requestIdleCallback' in window) requestIdleCallback(start);
    else setTimeout(start, 0);
  };
  const scrollTarget = root || window;
  const onScroll = () => {
    scrolling = true;
    if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(() => {
      scrollIdleTimer = null;
      scrolling = false;
      pump();
    }, 160);
  };
  scrollTarget.addEventListener('scroll', onScroll, { passive: true });
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting || queued.has(entry.target)) return;
      queued.add(entry.target);
      observer.unobserve(entry.target);
      queue.push(entry.target);
    });
    pump();
  }, { root, rootMargin: '1400px 0px', threshold: 0 });
  gallery.querySelectorAll('img.ach-img').forEach(image => observer.observe(image));
  _achImageWarmCleanup = () => {
    stopped = true;
    if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
    queue.length = 0;
    observer.disconnect();
    scrollTarget.removeEventListener('scroll', onScroll);
  };
}

function _achTopVisibleItem() {
  const host = _achCurrentScrollHost();
  const gallery = document.getElementById('ach-gallery');
  if (!host || !gallery) return null;
  const isRoot = host === document.scrollingElement;
  const hostRect = isRoot ? { top: 0, bottom: window.innerHeight } : host.getBoundingClientRect();
  const galleryRect = gallery.getBoundingClientRect();
  const top = hostRect.top + 64 - galleryRect.top;
  const bottom = hostRect.bottom - galleryRect.top;
  const cards = _achCardPositions(gallery);
  if (!cards.length) return null;
  let low = 0;
  let high = cards.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (cards[middle].bottom < top - 240) low = middle + 1;
    else high = middle;
  }
  let closest = null;
  let closestDistance = Infinity;
  for (let index = Math.max(0, low - 2); index < cards.length; index++) {
    const card = cards[index];
    if (card.top > bottom + 240) break;
    const distance = Math.abs(card.top - top);
    if (distance < closestDistance) {
      closest = card.element;
      closestDistance = distance;
    }
  }
  return closest;
}

function _achUpdateMiniBar(topItem = _achTopVisibleItem()) {
  const mini = document.querySelector('.ach-mini');
  if (!mini) return;
  const renderKey = [
    STORE.view, _achChronicleCrumb?.key, _achChronicleCrumb?.label, _achChronicleCrumb?.mission, _achChronicleCrumb?.position,
    topItem?.dataset.achId || '', STORE.filter || 'all', STORE.missionFilter || 'all',
    _achSelectedCharIds().join(','), STORE.charMatchMode || 'any', STORE.search || '',
  ].join('|');
  if (_achMiniRenderEl === mini && _achMiniRenderKey === renderKey) return;
  _achMiniRenderEl = mini;
  _achMiniRenderKey = renderKey;
  const item = topItem ? (STORE.items || []).find(entry => entry.id === topItem.dataset.achId) : null;
  const mission = _missionFor(item);
  const crumb = mini.querySelector('.ach-mini-crumb');
  if (crumb) {
    const month = item ? _achMonthLabel(_achMonthKey(item)) : 'Fresque de campagne';
    const title = STORE.group === 'mission'
      ? (mission?.titre || 'Interlude')
      : STORE.group === 'month'
        ? month
        : [month, mission?.titre].filter(Boolean).join(' · ');
    const art = crumb.querySelector('.ach-mini-art');
    const kicker = crumb.querySelector('.ach-mini-kicker');
    const label = crumb.querySelector('.ach-mini-label');
    const position = crumb.querySelector('.ach-mini-pos');
    if (STORE.view === 'timeline') {
      const session = _achChronicleCrumb;
      crumb.dataset.session = session?.key || '';
      if (art) art.innerHTML = session ? `<b>${session.day}</b><small>${session.month}</small>` : '✦';
      if (kicker) kicker.textContent = session?.mission || 'Chronique';
      if (label) label.textContent = session?.label || 'Chronique de campagne';
      if (position) position.textContent = session?.position || '';
    } else {
      delete crumb.dataset.session;
      if (art) art.innerHTML = mission?.imageUrl ? `<img src="${_esc(mission.imageUrl)}" alt="">` : (item?.emoji || _achCategoryFor(item || {}).emoji || '✦');
      if (kicker) kicker.textContent = mission?.acte || (STORE.group === 'month' ? 'Période' : 'Fresque');
      if (label) label.textContent = title || 'Fresque de campagne';
    }
    if (position && STORE.view !== 'timeline') {
      const visible = _achFilteredItemsForCurrentState({ ordered: true });
      const index = item ? visible.findIndex(entry => entry.id === item.id) : -1;
      position.textContent = index >= 0 ? `${index + 1} / ${visible.length}` : '';
    }
    crumb.dataset.id = item?.id || '';
  }
  const selected = _achSelectedCharIds();
  const chips = [];
  if ((STORE.filter || 'all') !== 'all') {
    const category = ACH_CATS.find(entry => entry.id === STORE.filter);
    chips.push({ kind: 'category', label: `${category?.emoji || ''} ${category?.label || STORE.filter}`.trim() });
  }
  if ((STORE.missionFilter || 'all') !== 'all') chips.push({ kind: 'mission', label: _achMissionFilterLabel() });
  if (selected.length) chips.push({ kind: 'characters', label: selected.length === 1 ? ((STATE.characters || []).find(entry => entry.id === selected[0])?.nom || 'Personnage') : `${selected.length} personnages` });
  if ((STORE.search || '').trim()) chips.push({ kind: 'search', label: `“${STORE.search.trim()}”` });
  const filters = mini.querySelector('#ach-mini-filters');
  if (filters) filters.innerHTML = chips.map(chip => `<button type="button" data-action="_achRemoveMiniFilter" data-filter-kind="${chip.kind}" title="Retirer ce filtre">${_esc(chip.label)} <span>×</span></button>`).join('');
  mini.querySelectorAll('#ach-mini-search-input, #ach-search-input').forEach(input => {
    if (input !== document.activeElement && input.value !== STORE.search) input.value = STORE.search || '';
  });
}

function _achUpdateRailUi(topItem = _achTopVisibleItem(), { updateProgress = true, updateActive = true } = {}) {
  const rail = document.querySelector('.ach-rail');
  const track = rail?.querySelector('.ach-rail-track');
  const { host, top, height, total } = _achScrollMetrics();
  if (!host || !rail || !track) return;
  if (updateProgress) {
    const maxScroll = Math.max(1, total - height);
    const progress = Math.max(0, Math.min(1, top / maxScroll));
    const visibleRatio = Math.max(.08, Math.min(1, height / total));
    const thumb = rail.querySelector('.ach-rail-thumb');
    if (thumb) {
      _achRailTrackHeight ||= track.clientHeight;
      const nextHeight = Math.max(22, Math.round(_achRailTrackHeight * visibleRatio));
      if (_achRailThumbHeight !== nextHeight) {
        _achRailThumbHeight = nextHeight;
        thumb.style.height = `${nextHeight}px`;
      }
      const travel = Math.max(0, _achRailTrackHeight - nextHeight);
      thumb.style.transform = `translate3d(0,${Math.round(progress * travel)}px,0)`;
    }
  }
  if (!updateActive) return;
  const activeId = topItem?.dataset.achId || '';
  if (_achRailActiveId !== activeId) {
    _achRailActiveId = activeId;
    rail.querySelectorAll('[data-ach-rail-id]').forEach(button => button.classList.toggle('active', button.dataset.achRailId === activeId));
  }
}

function _achBindRail() {
  _achRailCleanup?.();
  _achRailCleanup = null;
  _achRailActiveId = '';
  _achRailTrackHeight = 0;
  _achRailThumbHeight = 0;
  const rail = document.querySelector('.ach-rail');
  const track = rail?.querySelector('.ach-rail-track');
  if (!rail || !track) return;
  const seek = clientY => {
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height)));
    const { host, height, total } = _achScrollMetrics();
    host?.scrollTo?.({ top: ratio * Math.max(0, total - height), behavior: 'auto' });
  };
  const down = event => {
    if (event.button !== 0) return;
    track.setPointerCapture?.(event.pointerId);
    seek(event.clientY);
  };
  const move = event => { if (track.hasPointerCapture?.(event.pointerId)) seek(event.clientY); };
  track.addEventListener('pointerdown', down);
  track.addEventListener('pointermove', move);
  _achRailCleanup = () => {
    track.removeEventListener('pointerdown', down);
    track.removeEventListener('pointermove', move);
  };
  _achUpdateRailUi();
}

function _achResetSeries() {
  _achSeriesPreviewUrls.forEach(url => URL.revokeObjectURL(url));
  _achSeriesPreviewUrls.clear();
  _achSeries.files = [];
  _achSeries.createdIds = [];
  _achSeries.baseOrder = null;
  _achSeries.transition = false;
  _achSeries.chroniclePreset = null;
}

function _achSeriesPreview(file) {
  if (!file) return '';
  if (!_achSeriesPreviewUrls.has(file)) _achSeriesPreviewUrls.set(file, URL.createObjectURL(file));
  return _achSeriesPreviewUrls.get(file);
}

async function _achFlushSeriesOrder() {
  if (!_achSeries.createdIds.length || !_achSeries.baseOrder) return;
  const order = [..._achSeries.baseOrder, ..._achSeries.createdIds.filter(id => !_achSeries.baseOrder.includes(id))];
  await _saveOrder(order);
  STORE.order = order;
  _achResetSeries();
}

function _achStartImageSeries(files, preset = {}) {
  if (!STATE.isAdmin) return;
  const images = [...(files || [])].filter(file => file?.type?.startsWith('image/'));
  if (!images.length) return;
  _achResetSeries();
  _achSeries.files = images;
  _achSeries.chroniclePreset = preset;
  openAchievementModal(null, { ...preset, series: true });
}

function _achDropSession(event) {
  const row = (STORE.view === 'timeline' && event?.target?.closest?.('.cr-ses, .cr-next')) || null;
  if (_achChronicleDropTarget === row) return row;
  _achChronicleDropTarget?.classList.remove('drop-on');
  _achChronicleDropTarget = row;
  row?.classList.add('drop-on');
  const hint = document.getElementById('ach-chronicle-drop');
  if (hint) {
    hint.hidden = !row;
    if (row) hint.textContent = row.dataset.key === 'next' ? 'Déposer pour consigner une nouvelle séance'
      : `Déposer sur la séance du ${row.getAttribute('aria-label')}`;
  }
  document.querySelector('.hall-root')?.classList.toggle('ach-drop-on-session', !!row);
  return row;
}

function _achInstallPageImageDrop() {
  if (_achPageDropInstalled) return;
  _achPageDropInstalled = true;
  document.addEventListener('dragover', event => {
    if (!STATE.isAdmin || !document.getElementById('ach-content') || event.target?.closest?.('.achm')) return;
    if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
    event.preventDefault();
    document.querySelector('.hall-root')?.classList.add('ach-drop-active');
    _achDropSession(event);
  });
  document.addEventListener('dragleave', event => {
    if (!event.relatedTarget) {
      document.querySelector('.hall-root')?.classList.remove('ach-drop-active');
      _achDropSession(null);
    }
  });
  document.addEventListener('drop', event => {
    const root = document.querySelector('.hall-root');
    root?.classList.remove('ach-drop-active');
    const allowed = STATE.isAdmin && document.getElementById('ach-content') && !event.target?.closest?.('.achm');
    const row = allowed && _achDropSession(event);
    _achDropSession(null);
    if (!allowed) return;
    event.preventDefault();
    _achStartImageSeries(event.dataTransfer?.files, row ? chroniclePreset(_achChronicleModel, row.dataset.key, _todayISO()) : null);
  });
  document.addEventListener('paste', event => {
    if (!STATE.isAdmin || !document.getElementById('ach-content') || event.target?.matches?.('input,textarea,[contenteditable="true"]')) return;
    const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
    if (files.length) { event.preventDefault(); _achStartImageSeries(files); }
  });
  document.addEventListener('app:modal-closed', () => {
    if (_achSeries.transition) return;
    if (_achSeries.createdIds.length) void _achFlushSeriesOrder();
    else if (_achSeries.files.length) _achResetSeries();
  });
}

function _achCreatedAt(item = {}) {
  const explicit = Date.parse(item.createdAt || '');
  if (Number.isFinite(explicit)) return explicit;
  const fromId = String(item.id || '').match(/^ach_(\d{10,})/);
  if (fromId) return Number(fromId[1]) || 0;
  return parseDate(item.date) || 0;
}

function _achIsNew(item) {
  const seenAt = Date.parse(STORE.lastSeen || '') || 0;
  return !!seenAt && _achCreatedAt(item) > seenAt;
}

function _achMatchesCharSelection(item, selectedIds = _achSelectedCharIds()) {
  if (!selectedIds.length) return true;
  const contribs = Array.isArray(item?.contributeurs) ? item.contributeurs : [];
  if ((STORE.charMatchMode || 'any') === 'shared' && selectedIds.length > 1) {
    return selectedIds.every(id => contribs.includes(id));
  }
  return selectedIds.some(id => contribs.includes(id));
}

function _missionFor(item) {
  return item?.missionId ? (STORE.missions || []).find(m => m.id === item.missionId) : null;
}

function _achSearchHaystack(item) {
  const mission = _missionFor(item);
  const cat = _achCategoryFor(item);
  const chars = (item?.contributeurs || [])
    .map(id => (STATE.characters || []).find(c => c.id === id)?.nom)
    .filter(Boolean);
  return _normalize([
    item?.titre,
    item?.description,
    item?.date,
    item?.emoji,
    cat?.label,
    mission?.titre,
    mission?.acte,
    mission?.date,
    mission?.type === 'event' ? 'événement' : mission ? 'mission' : '',
    ...chars,
  ].filter(Boolean).join(' '));
}

function _achMissionFilterLabel() {
  const val = STORE.missionFilter || 'all';
  if (val === 'all') return 'Toutes les missions';
  if (val === '__none') return 'Sans mission liée';
  return (STORE.missions || []).find(m => m.id === val)?.titre || 'Mission introuvable';
}

// Icône selon le type d'élément de Trame
function _trameIco(m) { return m?.type === 'event' ? '📖' : '🎯'; }

function _achMissionThumbHtml(mission, className, fallback = '🎯') {
  if (mission?.imageUrl) {
    return `<span class="${className}"><img src="${_esc(mission.imageUrl)}" alt="" loading="lazy"></span>`;
  }
  return `<span class="${className} ${className}--empty">${mission ? _trameIco(mission) : fallback}</span>`;
}
// Méta discrète (acte · date) d'un élément de Trame
function _trameMeta(m) {
  return [m?.acte || 'Acte I', m?.date].filter(Boolean).join(' · ');
}

function _missionLinkHtml(item, className = 'ach-mission-link') {
  const mission = _missionFor(item);
  if (!mission) return '';
  return "<button type=\"button\" class=\"" + className + "\" data-action=\"_achOpenMission\" data-id=\"" + mission.id + "\" data-stop-propagation>" + _trameIco(mission) + " " + _esc(mission.titre || 'Mission') + "</button>";
}

function _achLightboxContextHtml(item) {
  const mission = _missionFor(item);
  if (!mission) return '';
  const typeLabel = mission.type === 'event' ? 'Événement' : 'Mission';
  const art = mission.imageUrl
    ? `<span class="ach-lb-context-art"><img src="${_esc(mission.imageUrl)}" alt=""></span>`
    : `<span class="ach-lb-context-art ach-lb-context-art--empty">${_trameIco(mission)}</span>`;
  return `<section class="ach-lb-context">
    <button type="button" class="ach-lb-context-card" data-action="_achOpenMission" data-id="${_esc(mission.id)}">
      ${art}
      <span class="ach-lb-context-body">
        <small>Trame · ${_esc(mission.acte || typeLabel)}</small>
        <b>${_esc(mission.titre || typeLabel)}</b>
      </span>
      <span class="ach-lb-context-go">→</span>
    </button>
  </section>`;
}

function _achLightboxRelatedHtml(item) {
  if (!item?.missionId) return '';
  const visible = STATE.isAdmin ? (STORE.items || []) : (STORE.items || []).filter(a => !a.secret);
  const related = _sortAchievementsByDate(
    visible.filter(a => a.id !== item.id && a.missionId === item.missionId),
    true,
  ).slice(0, 4);
  if (!related.length) return '';
  return `<section class="ach-lb-related">
    <div class="ach-lb-related-title">Dans le même chapitre</div>
    <div class="ach-lb-related-list">
      ${related.map(a => {
        const cat = _achCategoryFor(a);
        return `<button type="button" class="ach-lb-related-item" data-action="_achOpenLightbox" data-id="${_esc(a.id)}" data-stop-propagation title="${_esc(a.titre || 'Haut-Fait')}" style="--c:${cat.color};--c-glow:${cat.glow};--c-line:${cat.line}">
          <span class="ach-lb-related-art">${a.imageUrl ? `<img src="${_esc(a.imageUrl)}" alt="" loading="lazy" decoding="async">` : `<span>${a.emoji || cat.emoji}</span>`}</span>
        </button>`;
      }).join('')}
    </div>
  </section>`;
}

// Normalisation recherche : minuscules sans accents
function _normalize(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ── Sélecteur custom d'élément de Trame (vignette + titre + méta) ─────────────
let _achPickItems = [];   // éléments de Trame proposés (missions + événements)
let _achTogglePick = () => {};
let _achPickSelect = () => {};
let _achPickSearch = () => {};

function _achPickArt(m, size = 34) {
  return m?.imageUrl
    ? `<span class="achm-pick-art"><img src="${_esc(m.imageUrl)}" alt=""></span>`
    : `<span class="achm-pick-art achm-pick-art--ph">${_trameIco(m)}</span>`;
}
function _achPickTriggerHtml(m) {
  if (!m) return `<span class="achm-pick-art achm-pick-art--ph">✦</span>
    <span class="achm-pick-txt"><span class="achm-pick-title">Hors Trame</span></span>
    <span class="achm-pick-caret">▾</span>`;
  return `${_achPickArt(m)}
    <span class="achm-pick-txt">
      <span class="achm-pick-title">${_esc(m.titre || 'Sans titre')}</span>
    </span>
    <span class="achm-pick-caret">▾</span>`;
}
function _achPickOptionHtml(m, selectedId) {
  return `<button type="button" class="achm-pick-opt ${m.id === selectedId ? 'is-active' : ''}"
    data-action="_achPickSelect" data-id="${m.id}">
    ${_achPickArt(m)}
    <span class="achm-pick-txt">
      <span class="achm-pick-title">${_esc(m.titre || 'Sans titre')}</span>
      <span class="achm-pick-meta">${_trameIco(m)} ${m.type === 'event' ? 'Événement' : 'Mission'} · ${_esc(_trameMeta(m))}</span>
    </span>
  </button>`;
}
function _achPickOptionsHtml(items, selectedId) {
  let lastAct = null;
  return items.map(item => {
    const act = item.acte || 'Hors Trame';
    const separator = act !== lastAct ? `<div class="achm-pick-separator">${_esc(act)}</div>` : '';
    lastAct = act;
    return separator + _achPickOptionHtml(item, selectedId);
  }).join('');
}

const ACH_CONTRIB_COLORS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
function _achContribCountLabel(count) {
  return count > 0 ? `${count} sélectionné${count > 1 ? 's' : ''}` : 'Aucun sélectionné';
}
function _achContribOptionHtml(character, selectedIds) {
  const name = character.nom || '?';
  const color = ACH_CONTRIB_COLORS[(name.charCodeAt(0) || 0) % ACH_CONTRIB_COLORS.length];
  const selected = selectedIds.includes(character.id);
  return `<button type="button" class="achm-contrib${selected ? ' is-active' : ''}"
    id="ach-contrib-${_esc(character.id)}" data-action="_achToggleContrib" data-id="${_esc(character.id)}"
    data-search="${_esc(_normalize(name))}" style="--cc:${color}" aria-pressed="${selected}">
    ${characterAvatarHtml(character, {
      size: 42,
      className: 'achm-contrib-avatar',
      border: '2px solid color-mix(in srgb, var(--cc) 42%, transparent)',
      color,
    })}
    <span class="achm-contrib-name">${_esc(name)}</span>
    <span class="achm-contrib-check" aria-hidden="true">✓</span>
  </button>`;
}

async function _achOpenMission(id) {
  document.getElementById('ach-lightbox')?.remove();
  await _ensureFeatureCss('story');
  const { openStoryDetail } = await import('./story.js');
  openStoryDetail(id);
}

// ── MODAL PRINCIPAL ──────────────────────────────────────────────────────────
export async function createAchievementForMission(missionId) {
  if (!STATE.isAdmin || !missionId) return;
  if (!STORE.missions?.length) {
    STORE.missions = await loadCollection('story').catch(() => []);
  }
  await _loadAchievementCategories();
  const mission = (STORE.missions || []).find(item => item.id === missionId);
  openAchievementModal(null, { missionId, date: _toISO(mission?.date) || _todayISO() });
}

export async function openAchievementsForMission(missionId, view = 'galerie') {
  _achRestorePreferences();
  STORE.missionFilter = missionId || 'all';
  STORE.view = ['galerie', 'timeline', 'missions'].includes(view) ? view : 'galerie';
  _achSavePreferences();
  STORE.search = '';
  await navigate('achievements');
}

export function openAchievementModal(id = null, preset = {}) {
  const ex = id ? (STORE.items || []).find(a => a.id === id) : null;
  // Éléments de Trame liables : missions ET événements
  const trame = (STORE.missions || [])
    .filter(m => m.type === 'mission' || m.type === 'event')
    .sort((a, b) =>
      (a.acte || '').localeCompare(b.acte || '') ||
      (a.ordre || 0) - (b.ordre || 0) ||
      (a.date || '').localeCompare(b.date || ''));
  _achPickItems = trame;
  const currentMissionFilter = STORE.missionFilter && !['all', '__none'].includes(STORE.missionFilter)
    ? STORE.missionFilter
    : '';
  const initialMissionId = ex?.missionId ?? preset.missionId ?? (!id ? currentMissionFilter : '');
  const curTrame = initialMissionId ? trame.find(m => m.id === initialMissionId) : null;
  _achUploader?.destroy(); _achUploader = null;

  const modalCats = _achModalCats();
  const curCat = modalCats.find(c => c.id === (ex?.categorie || preset.categorie || _achDefaultCategoryId())) || modalCats[0];
  const initialFocus = ex?.focus || ((Number(ex?.aspectRatio) || 1) < .9 ? '50% 22%' : '50% 40%');
  const characters = sortCharactersForDisplay(STATE.characters || []);
  const contributors = ex?.contributeurs || preset.contributeurs || [];
  const contributorSet = new Set(contributors);
  const suggestionCounts = new Map();
  if (preset.suggestedContributors) {
    preset.suggestedContributors.forEach(charId => { if (!contributorSet.has(charId)) suggestionCounts.set(charId, 1); });
  } else if (initialMissionId) {
    (STORE.items || []).filter(item => item.missionId === initialMissionId).forEach(item => {
      (item.contributeurs || []).forEach(charId => {
        if (!contributorSet.has(charId)) suggestionCounts.set(charId, (suggestionCounts.get(charId) || 0) + 1);
      });
    });
  }
  const suggestedContributors = characters
    .filter(character => suggestionCounts.has(character.id))
    .sort((a, b) => suggestionCounts.get(b.id) - suggestionCounts.get(a.id))
    .slice(0, preset.suggestedContributors ? undefined : 5);

  openModal(id ? (ex?.titre || 'Modifier le Haut-Fait') : 'Ajouter un souvenir', `
    <div class="achm">
      ${preset.context ? `<p class="achm-chronicle-context">${_esc(preset.context)}</p>` : ''}

      ${preset.series && _achSeries.files.length ? `<div class="ach-series"><div><strong>Création en série</strong><span>${_achSeries.files.length} image${_achSeries.files.length > 1 ? 's' : ''} restante${_achSeries.files.length > 1 ? 's' : ''}</span></div><div class="ach-series-queue">${_achSeries.files.slice(0, 7).map((file, index) => `<span class="${index === 0 ? 'active' : ''}" title="${_esc(file.name || `Image ${index + 1}`)}"><img src="${_esc(_achSeriesPreview(file))}" alt=""><b>${index + 1}</b></span>`).join('')}</div><button data-action="_achSkipSeriesImage">Ignorer cette image</button></div>` : ''}

      <div class="achm-scroll">

      <div class="achm-layout">
      <div class="achm-column achm-column--main">

      <!-- ── Identité ──────────────────────────────────────────── -->
      <section class="achm-section achm-section--identity">
        <div class="form-group">
          <label for="ach-titre">Titre <span class="achm-required">Obligatoire</span></label>
          <input class="input-field" id="ach-titre" value="${_esc(ex?.titre || '')}"
            placeholder="Ex. L'œuf de Dragon" required aria-describedby="ach-title-error"
            data-modal-initial-focus autocomplete="off">
          <span class="achm-field-error" id="ach-title-error" hidden>Donnez un titre à ce Haut-Fait.</span>
        </div>
        <div class="form-group">
          <label>Catégorie</label>
          <div class="achm-cats">
            ${modalCats.map(c => `<button type="button" id="ach-cat-${c.id}" class="achm-cat"
              data-action="_achSelectCat" data-id="${c.id}" style="--cc:${c.color}">${c.modalLabel}</button>`).join('')}
          </div>
          <input type="hidden" id="ach-categorie" value="${ex?.categorie || preset.categorie || _achDefaultCategoryId()}">
        </div>
        <div class="achm-grid2 achm-date-trame-row">
          <div class="form-group">
            <label>Date</label>
            <input type="date" class="input-field" id="ach-date"
              value="${id ? _toISO(ex?.date) : (preset.date ?? _todayISO())}">
          </div>
          <div class="form-group achm-trame-field">
            <label>Chapitre de la Trame</label>
            <input type="hidden" id="ach-mission-id" value="${curTrame?.id || ''}">
            <div class="achm-pick" id="ach-pick">
              <button type="button" class="achm-pick-trigger" id="ach-pick-trigger" data-action="_achTogglePick">
                ${_achPickTriggerHtml(curTrame)}
              </button>
              <div class="achm-pick-menu" id="ach-pick-menu" hidden>
                <input class="input-field achm-pick-search" id="ach-pick-search"
                  placeholder="Rechercher une mission ou un événement…" data-input="_achPickSearch" autocomplete="off">
                <div class="achm-pick-list" id="ach-pick-list">
                  <button type="button" class="achm-pick-opt achm-pick-opt--none ${!curTrame ? 'is-active' : ''}"
                    data-action="_achPickSelect" data-id="">
                    <span class="achm-pick-art achm-pick-art--ph">✦</span>
                    <span class="achm-pick-txt"><span class="achm-pick-title">Hors Trame</span><span class="achm-pick-meta">Interlude, séance spéciale</span></span>
                  </button>
                  ${_achPickOptionsHtml(trame, curTrame?.id || '')}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="form-group achm-emoji-field" ${ex?.imageUrl ? 'hidden' : ''}>
          <label for="ach-emoji">Emoji de remplacement <span class="achm-hint">Utilisé sans illustration</span></label>
          <input class="input-field achm-emoji-input" id="ach-emoji"
            value="${_esc(ex?.emoji || '🏆')}" maxlength="8">
        </div>
      </section>

      <!-- ── Récit & lien Trame ───────────────────────────────── -->
      <section class="achm-section achm-section--narrative">
        <div class="form-group">
          <label for="ach-desc">Récit <span class="achm-hint">visible par les joueurs</span></label>
          <textarea class="input-field achm-description" id="ach-desc" rows="5"
            placeholder="Racontez ce qui s'est passé et pourquoi ce moment mérite d'être retenu…">${_esc(ex?.description || '')}</textarea>
        </div>
      </section>

      <!-- ── Illustration ─────────────────────────────────────── -->
      </div>
      <div class="achm-column achm-column--side">
      <section class="achm-section achm-section--illustration">
        <div class="achm-section-t">Illustration <small>Optionnelle</small></div>
        <div class="achm-head" style="--cc:${curCat.color}" ${ex?.imageUrl ? '' : 'hidden'}>
          <div class="achm-head-art" id="ach-head-art">
            <img id="ach-head-img" alt="" ${ex?.imageUrl ? `src="${_esc(ex.imageUrl)}" style="object-position:${_esc(initialFocus)}"` : 'style="display:none"'}>
            <span class="achm-focus-marker" id="ach-focus-marker" style="left:${_esc(initialFocus.split(' ')[0])};top:${_esc(initialFocus.split(' ')[1])};${ex?.imageUrl ? '' : 'display:none'}"></span>
            <span class="achm-head-emoji" id="ach-head-emoji" ${ex?.imageUrl ? 'style="display:none"' : ''}>${_esc(ex?.emoji || '🏆')}</span>
          </div>
          <input type="hidden" id="ach-focus" value="${_esc(initialFocus)}">
        </div>
        <div id="ach-drop-zone" class="achm-drop" ${ex?.imageUrl ? 'hidden' : ''}>
          <div id="ach-drop-preview"></div>
          <div class="achm-drop-meta">JPG · PNG · WebP — max 5 Mo</div>
        </div>
        <div id="ach-img-ready" class="achm-img-ready" style="display:none"></div>
        <div class="achm-image-tools" id="ach-image-tools" ${ex?.imageUrl ? '' : 'hidden'}>
          <span id="ach-image-format">Illustration</span>
          <span id="ach-focus-label">Point focal ${_esc(initialFocus)}</span>
          <button type="button" data-action="_achReplaceImage">Remplacer</button>
          <button type="button" class="is-danger" data-action="_achRemoveImage">Retirer</button>
        </div>
      </section>

      ${STATE.isAdmin ? `
      <section class="achm-section achm-section--visibility">
        <div class="achm-section-t">Visibilité</div>
        <div class="achm-secret achm-featured">
          <input type="checkbox" id="ach-featured" ${ex?.featured ? 'checked' : ''} ${ex?.imageUrl ? '' : 'disabled'}>
          <label for="ach-featured">
            <span class="achm-secret-t">★ Mettre à la une</span>
            <span class="achm-secret-d">Le souvenir pourra occuper un grand bloc dans la fresque.</span>
          </label>
        </div>
        <div class="achm-secret">
          <input type="checkbox" id="ach-secret" ${ex?.secret ? 'checked' : ''}>
          <label for="ach-secret">
            <span class="achm-secret-t">🔒 Haut-Fait secret (MJ uniquement)</span>
            <span class="achm-secret-d">Caché aux joueurs jusqu'à la révélation. Utile pour les prophéties, twists, récompenses surprise.</span>
          </label>
        </div>
      </section>` : ''}

      </div>

      ${characters.length ? `<section class="achm-section achm-section--contributors">
        <div class="achm-section-t">
          Personnages contributeurs
          <small id="ach-contrib-count">${_achContribCountLabel(contributors.length)}</small>
        </div>
        ${characters.length > 6 ? `<input class="input-field achm-contrib-search"
          placeholder="Rechercher un personnage…" data-input="_achFilterContrib"
          autocomplete="off" aria-label="Rechercher un personnage">` : ''}
        <div class="achm-contrib-grid" id="ach-contrib-grid">
          ${characters.map(c => _achContribOptionHtml(c, contributors)).join('')}
        </div>
        ${suggestedContributors.length ? `<div class="achm-contrib-suggest"><div><strong>${preset.suggestedContributors ? 'Personnages de la séance' : 'Souvent présents dans ce chapitre'}</strong><span>${suggestedContributors.map(character => _esc(character.nom || '?')).join(' · ')}</span></div><button type="button" data-action="_achAddSuggestedContributors" data-ids="${suggestedContributors.map(character => _esc(character.id)).join(',')}">Les ajouter</button></div>` : ''}
        <div class="achm-contrib-empty" id="ach-contrib-empty" hidden>Aucun personnage trouvé.</div>
        <input type="hidden" id="ach-contributeurs" value="${contributors.join(',')}">
      </section>` : ''}

      </div>
      </div>

      <footer class="achm-actions">
        ${id ? `<button type="button" class="achm-delete" data-action="_achDeleteFromDrawer" data-id="${_esc(id)}">Supprimer</button>` : '<span></span>'}
        <div class="achm-actions-buttons">
          <button type="button" class="btn btn-outline" data-action="close-modal">Annuler</button>
          ${id ? '' : preset.series && _achSeries.files.length ? '' : `<button type="button" class="btn btn-outline" data-action="saveAchievementContinue">Créer et continuer</button>`}
          <button type="button" class="btn btn-gold achm-save"
            data-action="${preset.series && _achSeries.files.length ? 'saveAchievementContinue' : 'saveAchievement'}" data-id="${id || ''}">
            ${id ? 'Enregistrer' : preset.series && _achSeries.files.length > 1 ? 'Créer et suivant' : 'Créer le Haut-Fait'}
          </button>
        </div>
      </footer>
    </div>
    `,
    {
      icon: '🏆',
      subtitle: id ? 'Modifier le haut-fait' : 'Nouveau haut-fait',
      accent: curCat.glow,
    }
  );

  requestAnimationFrame(() => {
    const scroll = document.querySelector('.achm-scroll');
    if (scroll) scroll.scrollTop = 0;
  });

  // Aperçu live de l'en-tête
  const _headTitle = document.getElementById('ach-head-title');
  const _headEmoji = document.getElementById('ach-head-emoji');
  const _headImg   = document.getElementById('ach-head-img');
  const _headCat   = document.getElementById('ach-head-cat');
  const _headWrap  = document.querySelector('.achm-head');
  document.getElementById('ach-titre')?.addEventListener('input', e => {
    if (_headTitle) _headTitle.textContent = e.target.value.trim() || 'Nouveau Haut-Fait';
    e.target.classList.remove('is-invalid');
    e.target.removeAttribute('aria-invalid');
    const error = document.getElementById('ach-title-error');
    if (error) error.hidden = true;
  });
  document.getElementById('ach-emoji')?.addEventListener('input', e => {
    if (_headEmoji) _headEmoji.textContent = e.target.value.trim() || '🏆';
  });

  // Sélecteur d'élément de Trame (custom)
  _achTogglePick = () => {
    const menu = document.getElementById('ach-pick-menu');
    if (!menu) return;
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    document.getElementById('ach-pick')?.classList.toggle('is-open', willOpen);
    if (willOpen) {
      const s = document.getElementById('ach-pick-search');
      if (s) { s.value = ''; _achPickSearch(''); setTimeout(() => s.focus(), 0); }
    }
  };
  _achPickSelect = (pickId) => {
    const hidden = document.getElementById('ach-mission-id');
    if (hidden) hidden.value = pickId || '';
    const trigger = document.getElementById('ach-pick-trigger');
    if (trigger) trigger.innerHTML = _achPickTriggerHtml(_achPickItems.find(m => m.id === pickId) || null);
    document.querySelectorAll('#ach-pick-list .achm-pick-opt').forEach(b =>
      b.classList.toggle('is-active', (b.dataset.id || '') === (pickId || '')));
    const menu = document.getElementById('ach-pick-menu');
    if (menu) menu.hidden = true;
    document.getElementById('ach-pick')?.classList.remove('is-open');
  };
  _achPickSearch = (raw) => {
    const q = _normalize(raw);
    document.querySelectorAll('#ach-pick-list .achm-pick-opt').forEach(b => {
      if (b.classList.contains('achm-pick-opt--none')) return;
      const m = _achPickItems.find(x => x.id === b.dataset.id);
      const hay = _normalize([m?.titre, m?.acte, m?.date].filter(Boolean).join(' '));
      b.style.display = (!q || hay.includes(q)) ? '' : 'none';
    });
  };

  // Sélecteur catégorie
  _achSelectCat = (catId) => {
    document.getElementById('ach-categorie').value = catId;
    let active = null;
    _achModalCats().forEach(c => {
      const btn = document.getElementById(`ach-cat-${c.id}`);
      const on  = c.id === catId;
      if (on) active = c;
      if (!btn) return;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    // Sync en-tête
    if (active) {
      if (_headCat) _headCat.textContent = active.modalLabel || active.label;
      if (_headWrap) _headWrap.style.setProperty('--cc', active.color);
      document.getElementById('modal-title')?.style.setProperty('--modal-accent', active.glow);
    }
  };
  _achSelectCat(ex?.categorie || preset.categorie || _achDefaultCategoryId());

  document.getElementById('ach-head-art')?.addEventListener('click', event => {
    if (!_headImg?.src || _headImg.style.display === 'none') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100));
    const y = Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100));
    const focus = `${Math.round(x)}% ${Math.round(y)}%`;
    const input = document.getElementById('ach-focus');
    const marker = document.getElementById('ach-focus-marker');
    const label = document.getElementById('ach-focus-label');
    if (input) input.value = focus;
    if (marker) { marker.style.left = `${x}%`; marker.style.top = `${y}%`; }
    if (label) label.textContent = `Point focal ${focus}`;
    _headImg.style.objectPosition = focus;
  });

  _achToggleContrib = (charId) => {
    const hidden = document.getElementById('ach-contributeurs');
    if (!hidden) return;
    const current = hidden.value ? hidden.value.split(',') : [];
    const idx     = current.indexOf(charId);
    const next    = idx >= 0 ? current.filter(x => x !== charId) : [...current, charId];
    hidden.value  = next.join(',');
    const card    = document.getElementById(`ach-contrib-${charId}`);
    if (!card) return;
    const active  = next.includes(charId);
    card.classList.toggle('is-active', active);
    card.setAttribute('aria-pressed', String(active));
    const count = document.getElementById('ach-contrib-count');
    if (count) count.textContent = _achContribCountLabel(next.length);
  };

  _achFilterContrib = (raw) => {
    const query = _normalize(raw);
    let visible = 0;
    document.querySelectorAll('#ach-contrib-grid .achm-contrib').forEach(card => {
      const show = !query || (card.dataset.search || '').includes(query);
      card.hidden = !show;
      if (show) visible++;
    });
    const empty = document.getElementById('ach-contrib-empty');
    if (empty) empty.hidden = visible > 0;
  };

  // ── Upload + redimensionnement (max 1400px, JPEG .88, pas de crop) ────────
  _achUploader = attachDropAndResize({
    dropEl:       document.getElementById('ach-drop-zone'),
    previewEl:    document.getElementById('ach-drop-preview'),
    statusEl:     document.getElementById('ach-img-ready'),
    initialUrl:   ex?.imageUrl || '',
    resize:       { maxW: 1400, quality: 0.88 },
    maxFileSize:  5 * 1024 * 1024,
    onError:      (err) => showNotif(err.message || 'Image trop lourde.', 'error'),
    onResult:     (b64) => {
      // Reflète l'image (ou son retrait) dans l'aperçu d'en-tête
      if (_headImg)   { _headImg.src = b64 || ''; _headImg.style.display = b64 ? '' : 'none'; }
      if (_headEmoji) { _headEmoji.style.display = b64 ? 'none' : ''; }
      const imageFrame = document.querySelector('.achm-head');
      const dropZone = document.getElementById('ach-drop-zone');
      if (imageFrame) imageFrame.hidden = !b64;
      if (dropZone) dropZone.hidden = Boolean(b64);
      const emojiField = document.querySelector('.achm-emoji-field');
      if (emojiField) emojiField.hidden = Boolean(b64);
      const marker = document.getElementById('ach-focus-marker');
      if (marker) marker.style.display = b64 ? '' : 'none';
      const tools = document.getElementById('ach-image-tools');
      if (tools) tools.hidden = !b64;
      const featured = document.getElementById('ach-featured');
      if (featured) { featured.disabled = !b64; if (!b64) featured.checked = false; }
      if (b64) {
        const probe = new Image();
        probe.onload = () => {
          const ratio = probe.naturalWidth / Math.max(1, probe.naturalHeight);
          const label = _achImageFormatLabel(probe.naturalWidth, probe.naturalHeight);
          const format = document.getElementById('ach-image-format');
          if (format) format.textContent = `${label} · ${probe.naturalWidth} × ${probe.naturalHeight}`;
          if (!id && !ex?.focus) {
            const focus = ratio < .9 ? '50% 22%' : '50% 40%';
            const input = document.getElementById('ach-focus');
            const marker = document.getElementById('ach-focus-marker');
            const focusLabel = document.getElementById('ach-focus-label');
            if (input) input.value = focus;
            if (marker) {
              const [x, y] = focus.split(' ');
              marker.style.left = x;
              marker.style.top = y;
            }
            if (focusLabel) focusLabel.textContent = `Point focal ${focus}`;
            if (_headImg) _headImg.style.objectPosition = focus;
          }
        };
        probe.src = b64;
      }
    },
  });
  if (preset.series && _achSeries.files[0]) void _achUploader?.loadFile?.(_achSeries.files[0]);
}

// ── SAUVEGARDER ───────────────────────────────────────────────────────────────
async function saveAchievement(id = '', { continueEditing = false } = {}) {
  let mutationStarted=false;
  let mutationFailed=false;
  let viewportAnchor=null;
  try {
    const titleInput = document.getElementById('ach-titre');
    const titre = titleInput?.value?.trim();
    if (!titre) {
      titleInput?.classList.add('is-invalid');
      titleInput?.setAttribute('aria-invalid', 'true');
      const error = document.getElementById('ach-title-error');
      if (error) error.hidden = false;
      titleInput?.focus();
      titleInput?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      showNotif('Le titre est requis.', 'error');
      return false;
    }
    // La fermeture de la modale rend le focus à son déclencheur et peut faire
    // défiler la page. On capture donc la fresque avant toute mutation/fermeture.
    viewportAnchor=_achCaptureViewportAnchor();

    const uploaded = _achUploader?.getResult();
    const ex = id ? (STORE.items || []).find(a => a.id === id) : null;
    const previousVisibleIds=_achFilteredItemsForCurrentState({ ordered:true }).map(item=>item.id);
    const previousRatio=Number(ex?.aspectRatio)||0;
    const imageUrl = uploaded === null ? '' : (typeof uploaded === 'string' ? uploaded : (ex?.imageUrl || ''));
    const existingRatio = Number(ex?.aspectRatio);
    const previewImg = document.querySelector('#ach-drop-preview img, #ach-head-img');
    let aspectRatio = 1;
    if (imageUrl) {
      if (uploaded === undefined && Number.isFinite(existingRatio) && existingRatio > 0) {
        aspectRatio = existingRatio;
      } else if (previewImg?.naturalWidth && previewImg?.naturalHeight) {
        aspectRatio = previewImg.naturalWidth / previewImg.naturalHeight;
      } else {
        aspectRatio = await _achMeasureImageRatio(imageUrl);
      }
      _achRatioCache.set(imageUrl, aspectRatio);
    }

    const contribRaw = document.getElementById('ach-contributeurs')?.value || '';
    const contributeurs = contribRaw ? contribRaw.split(',').filter(Boolean) : [];
    const payload = {
      titre,
      categorie:    document.getElementById('ach-categorie')?.value || _achDefaultCategoryId(),
      description:  document.getElementById('ach-desc')?.value?.trim()  || '',
      imageUrl,
      aspectRatio,
      emoji:        document.getElementById('ach-emoji')?.value?.trim() || '🏆',
      // Date : on conserve la valeur du champ. En édition, si le champ est vide
      // alors que le haut-fait avait une date legacy non affichable (format FR),
      // on ne l'écrase pas par du vide.
      date:         (() => {
        const v = document.getElementById('ach-date')?.value?.trim() || '';
        if (v) return v;
        return (id && ex?.date && !_toISO(ex.date)) ? ex.date : '';
      })(),
      missionId:    document.getElementById('ach-mission-id')?.value || '',
      contributeurs,
      secret:       !!document.getElementById('ach-secret')?.checked,
      featured:     !!imageUrl && !!document.getElementById('ach-featured')?.checked,
      focus:        document.getElementById('ach-focus')?.value || ex?.focus || '',
      createdAt:    ex?.createdAt || (id && _achCreatedAt(ex) ? new Date(_achCreatedAt(ex)).toISOString() : new Date().toISOString()),
    };

    // Un HF secret vit dans `achievements_secret` (MJ-only) ; sinon dans la
    // collection publique lue par les joueurs.
    const newCol = payload.secret ? 'achievements_secret' : 'achievements';

    let docId = id;
    _achLocalMutationDepth += 1;
    mutationStarted=true;
    if (!id) {
      docId = `ach_${Date.now()}`;
      await saveDoc(newCol, docId, payload);
      if (_achSeries.files.length) {
        _achSeries.baseOrder ||= await _loadOrder();
        _achSeries.createdIds.push(docId);
        STORE.order = [..._achSeries.baseOrder, ..._achSeries.createdIds];
      } else {
        const order = await _loadOrder();
        order.push(docId);
        await _saveOrder(order);
        STORE.order=order;
      }
    } else {
      const oldCol = (ex && ex.secret) ? 'achievements_secret' : 'achievements';
      await saveDoc(newCol, docId, payload);
      // Toggle secret↔public = déplacement : on a écrit la nouvelle collection,
      // on nettoie l'ancienne.
      if (oldCol !== newCol) {
        try { await deleteFromCol(oldCol, docId); }
        catch (e) { console.warn('[ach] nettoyage déplacement', docId, e); }
      }
    }
    _storeUpsert(docId, payload);
    const visibleAfterSave = _achFilteredItemsForCurrentState({ ordered: true }).some(item => item.id === docId);

    const seriesActive = !id && _achSeries.files.length > 0;
    if (seriesActive) _achSeries.files.shift();
    const continueSeries = continueEditing && _achSeries.files.length > 0;
    const nextPreset = continueEditing ? {
      ..._achSeries.chroniclePreset,
      categorie: payload.categorie, date: payload.date, missionId: payload.missionId,
      contributeurs: [...payload.contributeurs], series: continueSeries,
    } : null;
    _achUploader?.destroy(); _achUploader = null;
    _achSeries.transition = seriesActive;
    closeModal();
    if (!id || !_achPatchVisibleCard(docId,previousVisibleIds,previousRatio)) {
      await _achRenderContentPreserveViewport({}, viewportAnchor);
    } else {
      _achRestoreViewportAnchorAfterFrame(viewportAnchor);
    }
    const linkedMission = payload.missionId ? (STORE.missions || []).find(mission => mission.id === payload.missionId) : null;
    showNotif(id ? 'Haut-Fait mis à jour.' : `« ${titre} » ajouté${linkedMission?.titre ? ` · ${linkedMission.titre}` : ''}.`, 'success', id ? {} : {
      duration: 6500,
      action: {
        label: visibleAfterSave ? 'Voir' : 'Afficher',
        onClick: async () => {
          if (!visibleAfterSave) {
            STORE.filter = 'all';
            STORE.missionFilter = 'all';
            STORE.search = '';
            _achSetSelectedCharIds([]);
            await _achRenderContentPreserveViewport({ force: true });
          }
          _achFlashCard(docId);
        },
      },
    });
    if (continueSeries) {
      _achSeries.transition = false;
      openAchievementModal(null, nextPreset);
    } else {
      if (seriesActive) await _achFlushSeriesOrder();
      else if (continueEditing) openAchievementModal(null, nextPreset);
    }
  } catch (e) { mutationFailed=mutationStarted; notifySaveError(e); return false; }
  finally {
    if (mutationStarted && _achLocalMutationDepth>0) _achLocalMutationDepth -= 1;
    if (mutationFailed) void _achRenderContentPreserveViewport({ force:true }, viewportAnchor);
  }
}

// ── ÉDITER ────────────────────────────────────────────────────────────────────
async function editAchievement(id) {
  if (!STORE.items?.length) {
    STORE.publicItems = await loadCollection('achievements').catch(() => []);
    if (STATE.isAdmin) STORE.secretItems = await loadCollection('achievements_secret').catch(() => []);
    STORE.items = _composeItems();
  }
  openAchievementModal(id);
}

// ── SUPPRIMER ─────────────────────────────────────────────────────────────────
async function deleteAchievement(id) {
  let mutationStarted=false;
  let mutationFailed=false;
  try {
    const col = (STORE.secretItems || []).some(a => a.id === id) ? 'achievements_secret' : 'achievements';
    const snapshot = (col === 'achievements_secret' ? STORE.secretItems : STORE.publicItems)?.find(a => a.id === id);
    const previousOrder = [...(STORE.order || [])];
    _achLocalMutationDepth += 1;
    mutationStarted=true;
    if (!await confirmDelete(col, id, 'Supprimer ce haut-fait définitivement ?')) return;
    STORE.publicItems = (STORE.publicItems || []).filter(a => a.id !== id);
    STORE.secretItems = (STORE.secretItems || []).filter(a => a.id !== id);
    if (STORE.items) STORE.items = STORE.items.filter(a => a.id !== id);
    const order = (await _loadOrder()).filter(oid => oid !== id);
    await _saveOrder(order);
    STORE.order = order;
    await _achRenderContentPreserveViewport();
    showNotif('Haut-Fait supprimé.', 'success', snapshot ? {
      duration: 7000,
      action: {
        label: '↶ Annuler',
        onClick: async () => {
          const { id: _ignored, ...data } = snapshot;
          await saveDoc(col, id, data);
          _storeUpsert(id, snapshot);
          const restoredOrder = previousOrder.includes(id) ? previousOrder : [...previousOrder, id];
          await _saveOrder(restoredOrder);
          STORE.order = restoredOrder;
          await _achRenderContentPreserveViewport({ force: true });
          showNotif('Suppression annulée.', 'success');
        },
      },
    } : {});
  } catch (e) { mutationFailed=mutationStarted; notifySaveError(e); }
  finally {
    if (mutationStarted && _achLocalMutationDepth>0) _achLocalMutationDepth -= 1;
    if (mutationFailed) void _achRenderContentPreserveViewport({ force:true });
  }
}

// ── ORDRE ─────────────────────────────────────────────────────────────────────
async function _loadOrder() {
  const doc = await getDocData('achievements_meta', 'order');
  return Array.isArray(doc?.order) ? doc.order : [];
}
const _saveOrder = (order) => tryDoc('achievements_meta', 'order', { order });
function _applyOrder(items, order) {
  if (!order.length) return items;
  const map     = Object.fromEntries(items.map(a => [a.id, a]));
  const ordered = order.filter(id => map[id]).map(id => map[id]);
  const rest    = items.filter(a => !order.includes(a.id));
  return [...ordered, ...rest];
}

// Fusionne la source publique (`achievements`) et secrète (`achievements_secret`,
// MJ-only) en un seul tableau ordonné. Côté joueur, secretItems = [] → no-op.
function _composeItems() {
  return _applyOrder(
    [...(STORE.publicItems || []), ...(STORE.secretItems || [])],
    STORE.order || [],
  );
}

// Upsert local après écriture : retire l'id des deux sources, le replace dans la
// bonne selon `payload.secret`, puis recompose STORE.items.
function _storeUpsert(id, payload) {
  STORE.publicItems = (STORE.publicItems || []).filter(a => a.id !== id);
  STORE.secretItems = (STORE.secretItems || []).filter(a => a.id !== id);
  (payload.secret ? STORE.secretItems : STORE.publicItems).push({ id, ...payload });
  STORE.items = _composeItems();
}

function _sortAchievementsByDate(items, desc = false) {
  return [...items]
    .map((item, idx) => ({ item, idx, ts: parseDate(item.date) }))
    .sort((a, b) => {
      if (!a.ts && !b.ts) return a.idx - b.idx;
      if (!a.ts) return 1;
      if (!b.ts) return -1;
      return desc ? b.ts - a.ts || a.idx - b.idx : a.ts - b.ts || a.idx - b.idx;
    })
    .map(entry => entry.item);
}

function _achCategoryFor(item) {
  return ACH_CATS.find(c => c.id === (item?.categorie || _achDefaultCategoryId())) || ACH_CATS[0];
}

function _achFilteredItemsForCurrentState({ ordered = false } = {}) {
  const filter = STORE.filter || 'all';
  let missionFilter = STORE.missionFilter || 'all';
  if (missionFilter !== 'all' && missionFilter !== '__none' && !(STORE.missions || []).some(m => m.id === missionFilter)) {
    STORE.missionFilter = '__none';
    missionFilter = '__none';
  }

  const selectedCharIds = _achSelectedCharIds();
  const search = _normalize(STORE.search || '');
  const knownMissionIds = new Set((STORE.missions || []).map(m => m.id));

  let filtered = STATE.isAdmin ? [...(STORE.items || [])] : (STORE.items || []).filter(a => !a.secret);
  if (filter !== 'all') filtered = filtered.filter(a => (a.categorie || _achDefaultCategoryId()) === filter);
  if (missionFilter !== 'all') {
    filtered = filtered.filter(a => missionFilter === '__none'
      ? !a.missionId || !knownMissionIds.has(a.missionId)
      : a.missionId === missionFilter);
  }
  if (selectedCharIds.length) filtered = filtered.filter(a => _achMatchesCharSelection(a, selectedCharIds));
  if (search) filtered = filtered.filter(a => _achSearchHaystack(a).includes(search));

  if (!ordered) return filtered;
  if ((STORE.view || 'galerie') === 'timeline') return _sortAchievementsByDate(filtered, !!STORE.timelineDesc);
  if ((STORE.view || 'galerie') === 'missions') return _sortAchievementsByDate(filtered, true);
  const orderedItems = filter === 'all' ? _sortAchievementsByDate(filtered) : filtered;
  return STORE.galleryOrder === 'desc' ? [...orderedItems].reverse() : orderedItems;
}

function _achBulkItems() {
  return (STORE.items || []).filter(item => _achBulkSelected.has(item.id));
}

function _achSyncBulkToggle() {
  const button = document.querySelector('[data-action="_achToggleBulkMode"]');
  if (!button) return;
  button.classList.toggle('is-active', _achBulkMode);
  button.setAttribute('aria-pressed', String(_achBulkMode));
  const label = button.querySelector('[data-ach-bulk-label]');
  if (label) label.textContent = _achBulkMode ? 'Terminer' : 'Sélectionner';
}

function _achBulkBarHtml(filtered = []) {
  if (!STATE.isAdmin || !_achBulkMode) return '';
  const selected = _achBulkItems();
  const count = selected.length;
  const filteredIds = new Set(filtered.map(item => item.id));
  const filteredSelected = filtered.length > 0 && filtered.every(item => _achBulkSelected.has(item.id));
  const categoryOptions = ACH_CATS.map(category =>
    `<option value="${_esc(category.id)}">${_esc(`${category.emoji || ''} ${category.label}`.trim())}</option>`
  ).join('');
  return `<section class="ach-bulkbar" aria-label="Classement groupé des hauts-faits">
    <strong>${count} sélectionné${count !== 1 ? 's' : ''}</strong>
    <button type="button" class="ach-bulklink" data-action="_achBulkSelectFiltered"${filtered.length ? '' : ' disabled'}>${filteredSelected ? 'Retirer les résultats' : `Sélectionner les résultats (${filteredIds.size})`}</button>
    ${count ? '<button type="button" class="ach-bulklink" data-action="_achBulkClear">Effacer</button>' : ''}
    <span></span>
    <label class="ach-bulk-category">
      <span>Classer dans</span>
      <select data-change="_achBulkCategory"${count ? '' : ' disabled'}>
        <option value="">Choisir une catégorie…</option>
        ${categoryOptions}
      </select>
    </label>
    <button type="button" class="ach-bulk-feature" data-action="_achBulkFeatured"${count ? '' : ' disabled'}>★ À la une</button>
    <button type="button" class="ach-bulk-done" data-action="_achToggleBulkMode">Terminer</button>
  </section>`;
}

function _achToggleBulkSelection(id) {
  if (!_achBulkMode || !id) return;
  const focused = document.activeElement?.matches('.cr-hit') && document.activeElement.dataset.id === id;
  if (_achBulkSelected.has(id)) _achBulkSelected.delete(id);
  else _achBulkSelected.add(id);
  _achRenderContentPreserveViewport({ force: true });
  if (focused) document.querySelector(`.cr-hit[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
}

function _achPatchCategoriesLocally(items) {
  const byId = new Map(items.map(item => [item.id, item.categorie]));
  const patch = list => (list || []).map(item => byId.has(item.id)
    ? { ...item, categorie: byId.get(item.id) }
    : item);
  STORE.publicItems = patch(STORE.publicItems);
  STORE.secretItems = patch(STORE.secretItems);
  STORE.items = _composeItems();
}

async function _achPersistCategories(items) {
  const secretIds = new Set((STORE.secretItems || []).map(item => item.id));
  const updates = items.map(item => ({
    col: secretIds.has(item.id) ? 'achievements_secret' : 'achievements',
    id: item.id,
    data: { categorie: item.categorie || _achDefaultCategoryId() },
  }));
  for (let index = 0; index < updates.length; index += 450) {
    await batchUpdateInCol(updates.slice(index, index + 450));
  }
}

async function _achApplyBulkCategory(categoryId) {
  if (!STATE.isAdmin || !_achBulkMode || !ACH_CATS.some(category => category.id === categoryId)) return;
  const selected = _achBulkItems();
  if (!selected.length) return;
  const before = selected.map(item => ({ id: item.id, categorie: item.categorie || _achDefaultCategoryId() }));
  const after = selected.map(item => ({ id: item.id, categorie: categoryId }));
  const category = ACH_CATS.find(item => item.id === categoryId);
  _achLocalMutationDepth += 1;
  try {
    await _achPersistCategories(after);
    _achPatchCategoriesLocally(after);
    _achBulkSelected.clear();
    await _achRenderContentPreserveViewport({ force: true });
    showNotif(`${selected.length} haut${selected.length > 1 ? 's' : ''}-fait${selected.length > 1 ? 's' : ''} classé${selected.length > 1 ? 's' : ''} dans ${category?.label || 'la catégorie'}.`, 'success', {
      duration: 8000,
      action: {
        label: '↶ Annuler',
        onClick: async () => {
          _achLocalMutationDepth += 1;
          try {
            await _achPersistCategories(before);
            _achPatchCategoriesLocally(before);
            await _achRenderContentPreserveViewport({ force: true });
            showNotif('Classement groupé annulé.', 'success');
          } finally {
            _achLocalMutationDepth = Math.max(0, _achLocalMutationDepth - 1);
          }
        },
      },
    });
  } catch (error) {
    notifySaveError(error);
  } finally {
    _achLocalMutationDepth = Math.max(0, _achLocalMutationDepth - 1);
  }
}

function _achPatchFeaturedLocally(updates) {
  const values = new Map(updates.map(item => [item.id, item.featured === true]));
  const patch = list => (list || []).map(item => values.has(item.id) ? { ...item, featured: values.get(item.id) } : item);
  STORE.publicItems = patch(STORE.publicItems);
  STORE.secretItems = patch(STORE.secretItems);
  STORE.items = _composeItems();
}

async function _achToggleFeatured(id) {
  if (!STATE.isAdmin || !id) return;
  const item = (STORE.items || []).find(entry => entry.id === id);
  if (!item) return;
  const featured = item.featured !== true;
  _achLocalMutationDepth += 1;
  try {
    await updateInCol(item.secret ? 'achievements_secret' : 'achievements', id, { featured });
    _achPatchFeaturedLocally([{ id, featured }]);
    await _achRenderContentPreserveViewport({ force: true });
    showNotif(featured ? 'Haut-fait mis à la une.' : 'Haut-fait retiré de la une.', 'success');
  } catch (error) { notifySaveError(error); }
  finally { _achLocalMutationDepth = Math.max(0, _achLocalMutationDepth - 1); }
}

async function _achBulkFeatured() {
  if (!STATE.isAdmin) return;
  const selected = _achBulkItems();
  if (!selected.length) return;
  const featured = selected.some(item => item.featured !== true);
  const updates = selected.map(item => ({ id: item.id, featured }));
  _achLocalMutationDepth += 1;
  try {
    await batchUpdateInCol(selected.map(item => ({ col: item.secret ? 'achievements_secret' : 'achievements', id: item.id, data: { featured } })));
    _achPatchFeaturedLocally(updates);
    _achBulkSelected.clear();
    await _achRenderContentPreserveViewport({ force: true });
    showNotif(`${selected.length} haut${selected.length > 1 ? 's' : ''}-fait${selected.length > 1 ? 's' : ''} ${featured ? 'mis à la une' : 'retirés de la une'}.`, 'success');
  } catch (error) { notifySaveError(error); }
  finally { _achLocalMutationDepth = Math.max(0, _achLocalMutationDepth - 1); }
}

function _achCompactImageSignature(url = '') {
  const value=String(url || '');
  return `${value.length}:${value.slice(0,24)}:${value.slice(-24)}`;
}

function _achRenderSignature() {
  const items=(STORE.items || []).map(item=>[
    item.id, item.titre, item.categorie, item.description, item.date, item.missionId,
    item.emoji, item.secret === true, item.featured === true, item.focus || '', item.createdAt || '', Number(item.aspectRatio)||0,
    (item.contributeurs || []).join(','), _achCompactImageSignature(item.imageUrl),
  ]);
  const missions=(STORE.missions || []).map(item=>[
    item.id, item.titre, item.acte, item.date, item.type, _achCompactImageSignature(item.imageUrl),
  ]);
  return JSON.stringify([
    STORE.filter, STORE.missionFilter, STORE.view, STORE.search,
    STORE.timelineDesc, STORE.timelineMode, STORE.group, STORE.density, STORE.galleryOrder, STORE.lastSeen,
    STORE.charMatchMode, _achSelectedCharIds(), STORE.order,
    _achBulkMode, [..._achBulkSelected].sort(),
    ACH_CATS.map(cat=>[cat.id,cat.label,cat.emoji,cat.color]), items, missions,
  ]);
}

function _achCaptureViewportAnchor() {
  const host=_achCurrentScrollHost();
  const root=document.scrollingElement;
  const isRoot=host===root;
  const hostRect=isRoot
    ? { top:0, bottom:window.innerHeight }
    : (host?.getBoundingClientRect?.() || { top:0, bottom:window.innerHeight });
  const viewportTop=hostRect.top;
  const viewportBottom=hostRect.bottom;
  const candidates=[...document.querySelectorAll('#ach-content [data-ach-id]')];
  const isChronicle = STORE.view === 'timeline' && !!document.querySelector('#ach-content .cr');
  const mini = isChronicle ? document.querySelector('.ach-mini.is-visible') : null;
  const unobstructedTop = mini
    ? Math.max(viewportTop, ...[...mini.children].filter(el => el.offsetHeight).map(el => el.getBoundingClientRect().bottom))
    : viewportTop;
  const visibleIndex=candidates.findIndex(element=>{
    const rect=element.getBoundingClientRect();
    return rect.bottom>unobstructedTop+8 && rect.top<viewportBottom-8;
  });
  const visible=candidates[visibleIndex];
  if (visible) {
    const rect=visible.getBoundingClientRect();
    return {
      id:visible.dataset.achId,
      top:rect.top-viewportTop,
      fallbackIds:(isChronicle
        ? [...candidates.slice(visibleIndex + 1, visibleIndex + 13), ...candidates.slice(Math.max(0, visibleIndex - 12), visibleIndex).reverse()]
        : candidates).map(element=>element.dataset.achId),
      view:STORE.view,
      scrollY:host?.scrollTop ?? window.scrollY,
      host:isRoot ? 'root' : 'main',
    };
  }
  return {
    id:null,
    top:null,
    fallbackIds:[],
    view:STORE.view,
    scrollY:host?.scrollTop ?? window.scrollY,
    host:isRoot ? 'root' : 'main',
  };
}

function _achRestoreViewportAnchor(anchor) {
  if (!anchor || typeof window === 'undefined') return;
  if (anchor.view !== STORE.view && [anchor.view, STORE.view].includes('timeline')) return;
  const root=document.scrollingElement;
  const preferred=anchor.host==='root' ? root : document.getElementById('main-content');
  const host=preferred || _achCurrentScrollHost();
  const isRoot=host===root;
  const hostTop=isRoot ? 0 : (host?.getBoundingClientRect?.().top || 0);
  const ids=[anchor.id, ...(anchor.fallbackIds || [])].filter(Boolean);
  const element=ids.map(id=>document.querySelector(`#ach-content [data-ach-id="${CSS.escape(id)}"]`)).find(Boolean);
  if (element && typeof anchor.top === 'number') {
    const delta=(element.getBoundingClientRect().top-hostTop)-anchor.top;
    if (Math.abs(delta)>1) isRoot ? window.scrollBy(0,delta) : host?.scrollBy(0,delta);
  } else if (Number.isFinite(anchor.scrollY)) {
    isRoot ? window.scrollTo({ top:anchor.scrollY }) : host?.scrollTo({ top:anchor.scrollY });
  }
}

function _achRestoreViewportAnchorAfterFrame(anchor) {
  const schedule=typeof requestAnimationFrame==='function' ? requestAnimationFrame : (callback)=>setTimeout(callback,0);
  schedule(()=>_achRestoreViewportAnchor(anchor));
}

function _achDisconnectGalleryResize() {
  _achGalleryResizeObserver?.disconnect();
  _achGalleryResizeObserver=null;
  if (_achGalleryResizeTimer) clearTimeout(_achGalleryResizeTimer);
  _achGalleryResizeTimer=null;
  _achObservedGalleryWidth=0;
}

function _achGalleryOverviewHtml(items) {
  const count = items.length;
  if (!count) return '';

  const filter = STORE.filter || 'all';
  const missionFilter = STORE.missionFilter || 'all';
  const selectedCharIds = _achSelectedCharIds();
  const search = (STORE.search || '').trim();
  const selectedChars = selectedCharIds
    .map(id => (STATE.characters || []).find(c => c.id === id))
    .filter(Boolean);
  const charLabel = selectedChars.length === 1
    ? selectedChars[0].nom
    : selectedChars.length > 1
      ? `${(STORE.charMatchMode || 'any') === 'shared' ? 'Partagés' : 'Sélection'} : ${selectedChars.length} joueurs`
      : null;
  const filterParts = [
    filter !== 'all' ? _achCategoryFor({ categorie: filter }).label : 'Toutes catégories',
    missionFilter !== 'all' ? _achMissionFilterLabel() : null,
    charLabel,
    search ? `"${search}"` : null,
  ].filter(Boolean);

  const latest = [...items]
    .map((item, idx) => ({ item, idx, ts: parseDate(item.date) }))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0) || a.idx - b.idx)[0]?.item;
  const latestCat = _achCategoryFor(latest);
  const latestDate = _formatDateFr(latest?.date);

  const linkedCount = items.filter(item => item.missionId).length;
  const secretCount = STATE.isAdmin ? items.filter(item => item.secret).length : 0;
  const contribCounts = new Map();
  items.forEach(item => (item.contributeurs || []).forEach(id => {
    contribCounts.set(id, (contribCounts.get(id) || 0) + 1);
  }));
  const topContributor = [...contribCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const topChar = topContributor ? (STATE.characters || []).find(c => c.id === topContributor[0]) : null;

  const catCounts = new Map();
  items.forEach(item => {
    const cat = _achCategoryFor(item);
    catCounts.set(cat.id, (catCounts.get(cat.id) || 0) + 1);
  });
  const mainCat = [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const mainCatDef = mainCat ? _achCategoryFor({ categorie: mainCat[0] }) : ACH_CATS[0];

  return `<section class="ach-overview" aria-label="Resume des hauts-faits affiches">
    <div class="ach-overview-main" style="--c:${mainCatDef.color};--c-glow:${mainCatDef.glow}">
      <div class="ach-overview-kicker">Galerie active</div>
      <div class="ach-overview-count">${count}</div>
      <div class="ach-overview-label">${count > 1 ? 'hauts-faits visibles' : 'haut-fait visible'}</div>
      <div class="ach-overview-filter">${_esc(filterParts.join(' - '))}</div>
    </div>
    <div class="ach-overview-card">
      <div class="ach-overview-icon" style="--c:${latestCat.color};--c-glow:${latestCat.glow}">${latestCat.emoji}</div>
      <div class="ach-overview-copy">
        <span>Dernier haut-fait</span>
        <strong>${_esc(latest?.titre || 'Sans titre')}</strong>
        ${latestDate ? `<em>${_esc(latestDate)}</em>` : ''}
      </div>
    </div>
    <div class="ach-overview-card">
      ${topChar
        ? characterAvatarHtml(topChar, { className: 'ach-overview-avatar', border: '1px solid rgba(126,176,255,.6)', background: 'rgba(126,176,255,.12)', color: '#7eb0ff' })
        : `<div class="ach-overview-icon" style="--c:#7eb0ff;--c-glow:rgba(126,176,255,.18)">👥</div>`}
      <div class="ach-overview-copy">
        <span>Figure marquante</span>
        <strong>${_esc(topChar?.nom || 'Aucun contributeur')}</strong>
        ${topContributor ? `<em>${topContributor[1]} apparition${topContributor[1] > 1 ? 's' : ''}</em>` : ''}
      </div>
    </div>
    <div class="ach-overview-card">
      <div class="ach-overview-icon" style="--c:#55d6aa;--c-glow:rgba(34,195,142,.18)">📖</div>
      <div class="ach-overview-copy">
        <span>Reliés à la Trame</span>
        <strong>${linkedCount}/${count}</strong>
        ${secretCount ? `<em>${secretCount} secret${secretCount > 1 ? 's' : ''} MJ</em>` : '<em>archives publiques</em>'}
      </div>
    </div>
  </section>`;
}

function _refreshAchievementCounters() {
  const all = STORE.items || [];
  const missionFilter = STORE.missionFilter || 'all';
  const knownMissionIds = new Set((STORE.missions || []).map(mission => mission.id));
  const selectedCharIds = _achSelectedCharIds();
  const search = _normalize(STORE.search || '');
  const visible = (STATE.isAdmin ? all : all.filter(a => !a.secret)).filter(item => {
    if (missionFilter !== 'all') {
      const matchesMission = missionFilter === '__none'
        ? !item.missionId || !knownMissionIds.has(item.missionId)
        : item.missionId === missionFilter;
      if (!matchesMission) return false;
    }
    if (selectedCharIds.length && !_achMatchesCharSelection(item, selectedCharIds)) return false;
    if (search && !_achSearchHaystack(item).includes(search)) return false;
    return true;
  });
  const counts = { all: visible.length };
  ACH_CATS.forEach(c => {
    counts[c.id] = visible.filter(a => (a.categorie || _achDefaultCategoryId()) === c.id).length;
  });
  document.querySelectorAll('.hall-filter-card[data-filter]').forEach(el => {
    const num = el.querySelector('.hall-filter-num');
    if (num) num.textContent = counts[el.dataset.filter] ?? 0;
  });
}

function _mergeCategoryOrder(catId, catOrder, globalOrder) {
  const allIds      = (STORE.items || []).map(a => a.id);
  const globalIds   = globalOrder.filter(id => allIds.includes(id));
  const missingIds  = allIds.filter(id => !globalIds.includes(id));
  const fullOrder   = [...globalIds, ...missingIds];
  const catIds     = new Set((STORE.items || [])
    .filter(a => (a.categorie || _achDefaultCategoryId()) === catId)
    .map(a => a.id));
  const cleanOrder = catOrder.filter(id => catIds.has(id));
  const others     = fullOrder.filter(id => !catIds.has(id));
  const lastCatIdx = Math.max(-1, ...fullOrder.map((id, i) => catIds.has(id) ? i : -1));
  const firstOther = fullOrder.find((id, i) => !catIds.has(id) && i > lastCatIdx);

  if (!firstOther) return [...others, ...cleanOrder];

  const idx = others.indexOf(firstOther);
  return [...others.slice(0, idx), ...cleanOrder, ...others.slice(idx)];
}

async function _persistCategoryOrder(catId, orderedIds) {
  const merged = _mergeCategoryOrder(catId, orderedIds, await _loadOrder());
  await _saveOrder(merged);
  STORE.order = merged;
  STORE.items = _applyOrder(STORE.items || [], merged);
  return merged;
}

function _installAchievementClickGuard() {
  if (_achClickGuardInstalled) return;
  _achClickGuardInstalled = true;
  document.addEventListener('click', (e) => {
    if (!_achDragBlockClick) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);
}

function _installAchievementKeyboard() {
  if (_achKeyboardInstalled) return;
  _achKeyboardInstalled = true;
  document.addEventListener('keydown', (event) => {
    if (!document.getElementById('ach-content')) return;
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && document.querySelector('.achm')) {
      event.preventDefault();
      document.querySelector('.achm-save')?.click();
      return;
    }
    if (event.key === 'Escape' && _achBulkMode && !document.querySelector('.achm')) {
      event.preventDefault();
      _achToggleBulkMode();
      return;
    }
    const editing = event.target?.matches?.('input, textarea, select, [contenteditable="true"]');
    if (!editing && event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      document.getElementById('ach-search-input')?.focus();
      return;
    }
    if (!editing && STATE.isAdmin && event.key.toLowerCase() === 'n' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      openAchievementModal();
      return;
    }
    const card = event.target?.closest?.('[data-ach-open-card]');
    if (!card || event.target !== card || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    card.click();
  });
}

function _finishAchievementDrag() {
  document.body.classList.remove('ach-dragging');
  setTimeout(() => { _achDragBlockClick = false; }, 350);
}

function _destroyAchievementSortables() {
  _achRowSortables.forEach(sortable => sortable?.destroy());
  _achRowSortables = [];
}


// ── DRAG & DROP ───────────────────────────────────────────────────────────────
function setupAchievementsDnd(catId) {
  if (!STATE.isAdmin || !catId) {
    _destroyAchievementSortables();
    return;
  }
  const grid = document.getElementById('ach-gallery');
  if (!grid) return;

  _installAchievementClickGuard();
  _destroyAchievementSortables();

  grid.querySelectorAll('.ach-row').forEach(row => {
    _achRowSortables.push(makeSortable(row, {
      prefix: 'ach',
      animation: 120,
      filter: 'button, a, input, select, textarea, .btn, .btn-icon, .ach-admin-btns',
      group: `achievements-${catId}`,
      draggable: '.ach-sortable-item',
      onStart: () => { document.body.classList.add('ach-dragging'); _achDragBlockClick = true; },
      onEnd: async (evt) => {
        _finishAchievementDrag();
        if (evt.oldIndex === evt.newIndex && evt.from === evt.to) return;
        const domOrder = [...grid.querySelectorAll('[data-ach-id]')].map(el => el.dataset.achId);
        await _persistCategoryOrder(catId, domOrder);
        showNotif('Ordre sauvegardé.', 'success');
        await _achRebuildGallery(catId);
      },
    }));
  });
}

// ── LIGHTBOX IMAGE ────────────────────────────────────────────────────────────
// ── JUSTIFIED LAYOUT ENGINE ───────────────────────────────────────────────────

function _achMeasureImageRatio(imageUrl, fallback = 4 / 3) {
  if (!imageUrl) return Promise.resolve(1);
  const cached = _achRatioCache.get(imageUrl);
  if (cached) return Promise.resolve(cached);
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const ratio = img.naturalWidth / img.naturalHeight;
      const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : fallback;
      _achRatioCache.set(imageUrl, safeRatio);
      resolve(safeRatio);
    };
    img.onerror = () => resolve(fallback);
    img.src = imageUrl;
  });
}

// Mesure uniquement les ratios absents des données et du cache de session.
async function _achMeasureRatios(items) {
  return Promise.all(items.map(async item => {
    const storedRatio = Number(item.aspectRatio);
    if (Number.isFinite(storedRatio) && storedRatio > 0) {
      if (item.imageUrl) _achRatioCache.set(item.imageUrl, storedRatio);
      return item;
    }
    return { ...item, aspectRatio: await _achMeasureImageRatio(item.imageUrl) };
  }));
}

// ── HTML d'une carte galerie ──────────────────────────────────────────────────
function _achCardHTML(item, isAdmin) {
  const CHAR_COLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
  const chars     = sortCharactersForDisplay(STATE.characters || []);
  const contribs  = [...new Set(item.contributeurs || [])].map(id => chars.find(c => c.id === id)).filter(Boolean);
  const cat       = _achCategoryFor(item);

  const contribsHtml = contribs.length ? `
    <div class="ach-contribs">
      ${contribs.map(c => {
        const col      = CHAR_COLS[(c.nom?.charCodeAt(0) || 0) % 6];
        return `<div class="ach-contrib" style="border-color:${col}55">
          ${characterAvatarHtml(c, { className: 'ach-contrib-av', border: `1px solid ${col}`, background: `${col}22`, color: col })}
          <span class="ach-contrib-name" style="color:${col}">${_esc(c.nom || '?')}</span>
        </div>`;
      }).join('')}
    </div>` : '';

  const adminHtml = isAdmin && !_achBulkMode ? `<div class="ach-admin-btns">
    <button class="ach-tile-action${item.featured ? ' is-on' : ''}" data-action="_achToggleFeatured" data-id="${item.id}" data-stop-propagation title="${item.featured ? 'Retirer de la une' : 'Mettre à la une'}" aria-label="${item.featured ? 'Retirer de la une' : 'Mettre à la une'}">★</button>
    <button class="ach-tile-action" data-action="editAchievement" data-id="${item.id}" data-stop-propagation title="Modifier" aria-label="Modifier">✎</button>
  </div>` : '';

  const focus = item.focus || ((Number(item.aspectRatio) || 1) < .9 ? '50% 22%' : '50% 40%');
  const imageHtml = item.imageUrl
    ? `${item.featured ? `<span class="ach-fit-bg" aria-hidden="true" style="background-image:url('${_esc(item.imageUrl)}');background-position:${_esc(focus)}"></span>` : ''}<img class="ach-img" src="${_esc(item.imageUrl)}" alt="${_esc(item.nom || item.titre || '')}" loading="lazy" decoding="async" draggable="false" style="object-position:${_esc(focus)}">`
    : `<div class="ach-img-empty"><div class="ach-img-empty-emoji">${item.emoji || cat.emoji}</div><small>${_esc(cat.label)}</small><strong>${_esc(item.titre || 'Haut-Fait')}</strong>${item.description ? `<p>${_esc(item.description)}</p>` : ''}</div>`;

  const secretBadge = (isAdmin && item.secret)
    ? `<div class="ach-secret-badge" title="Caché aux joueurs">Secret</div>` : '';
  const newBadge = _achIsNew(item) ? '<div class="ach-new-badge">Nouveau</div>' : '';
  const selection = isAdmin && _achBulkMode
    ? `<span class="ach-bulk-check${_achBulkSelected.has(item.id) ? ' is-on' : ''}" aria-hidden="true">${_achBulkSelected.has(item.id) ? '✓' : ''}</span>`
    : '';

  const dateDisplay = _formatDateFr(item.date), mission = _missionFor(item);
  return `
    ${newBadge}
    ${secretBadge}
    ${selection}
    ${adminHtml}
    ${imageHtml}
    <div class="ach-meta">
      <div class="ach-meta-kicker"><span style="--dot:${cat.color}"></span>${_esc(cat.label)}${dateDisplay ? ` · ${_esc(dateDisplay)}` : ''}${item.featured ? ' · ★ À la une' : ''}</div>
      <div class="ach-title">${_esc(item.titre || 'Haut-Fait')}</div>
      ${item.description ? `<div class="ach-desc">${_esc(item.description)}</div>` : ''}
      <div class="ach-meta-foot">${contribsHtml}${mission ? `<span class="ach-mission-pill">${_esc(mission.titre || 'Mission')}</span>` : ''}</div>
    </div>`;
}

// ── Rendu justified dans le conteneur ────────────────────────────────────────
async function _achRenderJustified(catId, items, container, preset = {}) {
  const containerW = container.clientWidth || 900;
  const baseHeight = containerW < 560 ? 200 : containerW < 900 ? 220 : containerW < 1300 ? 270 : 300;
  const densityFactor = STORE.density === 's' ? .66 : STORE.density === 'l' ? 1.4 : 1;
  const targetH = Math.round(baseHeight * densityFactor), gap = containerW < 560 ? 5 : 8;
  const layout = buildFresqueLayout(items.map(item => ({ ...item, ratio: Number(item.aspectRatio) || 4 / 3 })), {
    width: containerW, height: targetH, gap, tolerance: .12, features: true,
  });
  const isAdmin = STATE.isAdmin;
  container.style.height = `${layout.height}px`;
  container.style.setProperty('--ach-gap', `${gap}px`);
  container.innerHTML = layout.cells.map((cell, index) => {
    const item = cell.item, category = _achCategoryFor(item), selected = _achBulkSelected.has(item.id);
    return `<div class="ach-item${cell.featured ? ' is-featured' : ''}${cell.crop > .22 ? ' fit' : ''}${_achIsNew(item) ? ' is-new' : ''}${_achBulkMode ? ' is-bulk' : ''}${selected ? ' is-selected' : ''}${item.imageUrl ? '' : ' no-image'}" data-ach-id="${_esc(item.id)}"
      role="button" tabindex="0" data-ach-open-card aria-label="${_achBulkMode ? (selected ? 'Retirer' : 'Ajouter') : 'Ouvrir'} le Haut-Fait ${_esc(item.titre || 'Haut-Fait')}"
      aria-pressed="${_achBulkMode ? String(selected) : 'false'}"
      style="width:${cell.w}px;height:${cell.h}px;left:${cell.x}px;top:${cell.y}px;--c:${category.color};--c-glow:${category.glow};--c-line:${category.line}"
      data-action="${_achBulkMode ? '_achToggleBulkSelection' : '_achOpenLightbox'}" data-id="${_esc(item.id)}">${_achCardHTML(item, isAdmin)}</div>`;
  }).join('') + (isAdmin && layout.tail?.w >= 108 ? `<button type="button" class="ach-tail-add" style="width:${layout.tail.w}px;height:${layout.tail.h}px;left:${layout.tail.x}px;top:${layout.tail.y}px" data-action="_achCreateAtTail" data-mission-id="${_esc(preset.missionId || '')}" data-date="${_esc(preset.date || '')}"><span>+</span> Ajouter ici</button>` : '');
  _achInvalidateCardPositionCache();
}

function _achMonthKey(item) {
  const timestamp = parseDate(item?.date);
  if (!timestamp) return 'sans-date';
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function _achMonthLabel(key) {
  if (key === 'sans-date') return 'Sans date';
  const [year, month] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

function _achChapterGroups(items) {
  if (STORE.group === 'none') return [{ key: 'all', items }];
  const groups = [], byKey = new Map();
  items.forEach(item => {
    const key = STORE.group === 'month' ? _achMonthKey(item) : (item.missionId || `interlude:${_achMonthKey(item)}`);
    let group = byKey.get(key);
    if (!group) { group = { key, items: [] }; byKey.set(key, group); groups.push(group); }
    group.items.push(item);
  });
  return groups;
}

function _achChapterHeaderHtml(group, index) {
  const mission = STORE.group === 'mission' && !group.key.startsWith('interlude:')
    ? (STORE.missions || []).find(item => item.id === group.key)
    : null;
  const title = STORE.group === 'month' ? _achMonthLabel(group.key) : (mission?.titre || 'Interlude');
  const overline = STORE.group === 'mission' ? (mission?.acte || 'Hors Trame') : `Chapitre ${index + 1}`;
  const dates = group.items.map(item => parseDate(item.date)).filter(Boolean).sort((a, b) => a - b);
  const range = dates.length ? `${_formatDateFr(new Date(dates[0]).toISOString().slice(0, 10))}${dates.length > 1 ? ` — ${_formatDateFr(new Date(dates.at(-1)).toISOString().slice(0, 10))}` : ''}` : '';
  const contributorIds = [...new Set(group.items.flatMap(item => item.contributeurs || []))].slice(0, 5);
  const contributors = contributorIds.map(id => (STATE.characters || []).find(character => character.id === id)).filter(Boolean);
  return `<header class="ach-chapter-head"${mission?.imageUrl ? ` style="--chapter-art:url('${_esc(mission.imageUrl)}')"` : ''}>
    <div class="ach-chapter-art">${mission?.imageUrl ? `<img src="${_esc(mission.imageUrl)}" alt="">` : '<span>✦</span>'}</div>
    <div class="ach-chapter-copy"><small>${_esc(overline)}</small><h2>${_esc(title)}</h2><p>${_esc(range)}${range ? ' · ' : ''}${group.items.length} souvenir${group.items.length > 1 ? 's' : ''}</p></div>
    <div class="ach-chapter-avatars">${contributors.map(character => characterAvatarHtml(character, { className: 'ach-chapter-avatar' })).join('')}</div>
    ${STATE.isAdmin ? `<button class="ach-chapter-add" data-action="${mission ? '_achCreateForMission' : 'openAchievementModal'}"${mission ? ` data-mission-id="${_esc(mission.id)}"` : ''}>+ Ajouter</button>` : ''}
  </header>`;
}

async function _achRenderGallerySections(items, root) {
  const groups = _achChapterGroups(items);
  if (STORE.group === 'none') {
    root.className = 'ach-justified';
    await _achRenderJustified(STORE.filter || 'all', items, root);
    return;
  }
  root.className = 'ach-chapters';
  root.style.height = '';
  let previousBand = '';
  root.innerHTML = groups.map((group, index) => {
    const mission = STORE.group === 'mission' && !group.key.startsWith('interlude:')
      ? (STORE.missions || []).find(item => item.id === group.key)
      : null;
    const band = STORE.group === 'mission'
      ? (mission?.acte || 'Hors Trame')
      : (group.key === 'sans-date' ? 'Sans date' : group.key.slice(0, 4));
    const separator = band !== previousBand ? `<div class="ach-chapter-era"><span>${_esc(band)}</span></div>` : '';
    previousBand = band;
    return `${separator}<section class="ach-chapter" data-ach-chapter="${_esc(group.key)}">
      ${_achChapterHeaderHtml(group, index)}<div class="ach-justified ach-chapter-canvas" data-ach-chapter-canvas="${index}"></div>
    </section>`;
  }).join('');
  for (let index = 0; index < groups.length; index++) {
    const canvas = root.querySelector(`[data-ach-chapter-canvas="${index}"]`);
    if (canvas) {
      const missionId = STORE.group === 'mission' && !groups[index].key.startsWith('interlude:') ? groups[index].key : '';
      const dated = groups[index].items.map(item => _toISO(item.date)).filter(Boolean).sort();
      await _achRenderJustified(STORE.filter || 'all', groups[index].items, canvas, { missionId, date: dated.at(-1) || _todayISO() });
    }
  }
}

function _achCanManualSortCurrentGallery() {
  return (STORE.filter || 'all') !== 'all'
    && (STORE.missionFilter || 'all') === 'all'
    && !_achSelectedCharIds().length
    && !_normalize(STORE.search || '');
}

function _achPatchVisibleCard(id, previousIds = [], previousRatio = 0) {
  if ((STORE.view || 'galerie') !== 'galerie') return false;
  const gallery=document.getElementById('ach-gallery');
  const card=gallery?.querySelector(`[data-ach-id="${CSS.escape(id)}"]`);
  const item=(STORE.items || []).find(entry=>entry.id===id);
  if (!gallery || !card || !item) return false;

  const nextItems=_achFilteredItemsForCurrentState({ ordered:true });
  const nextIds=nextItems.map(entry=>entry.id);
  const sameOrder=previousIds.length===nextIds.length && previousIds.every((entry,index)=>entry===nextIds[index]);
  const nextRatio=Number(item.aspectRatio)||0;
  if (!sameOrder || Math.abs(nextRatio-(Number(previousRatio)||0))>.001) return false;

  const cat=_achCategoryFor(item);
  card.classList.toggle('no-desc', !item.description);
  card.style.setProperty('--c',cat.color);
  card.style.setProperty('--c-glow',cat.glow);
  card.style.setProperty('--c-line',cat.line);
  card.innerHTML=_achCardHTML(item,STATE.isAdmin);
  STORE.lightboxItems=Object.fromEntries((STATE.isAdmin ? STORE.items : STORE.items.filter(entry=>!entry.secret)).map(entry=>[entry.id,entry]));
  _refreshAchievementCounters();
  _achRenderControlsExtras();
  _achRenderedContentEl=document.getElementById('ach-content');
  _achLastRenderSignature=_achRenderSignature();
  return true;
}

async function _achRelayoutGallery() {
  const gallery=document.getElementById('ach-gallery');
  if (!gallery?.isConnected || (STORE.view || 'galerie') !== 'galerie') return;
  const width=Math.round(gallery.clientWidth || 0);
  if (!width || Math.abs(width-_achObservedGalleryWidth)<2) return;
  _achObservedGalleryWidth=width;
  const anchor=_achCaptureViewportAnchor();
  _destroyAchievementSortables();
  gallery.classList.add('is-relayout');
  await _achRenderGallerySections(_achFilteredItemsForCurrentState({ ordered:true }), gallery);
  _achWarmCardPositionCache(gallery);
  _achInstallImageWarmup(gallery);
  setupAchievementsDnd(STORE.group === 'none' && _achCanManualSortCurrentGallery() ? STORE.filter : null);
  requestAnimationFrame(()=>_achRestoreViewportAnchor(anchor));
}

function _achObserveGalleryResize(gallery) {
  _achDisconnectGalleryResize();
  _achImageWarmCleanup?.();
  _achImageWarmCleanup = null;
  if (!gallery || typeof ResizeObserver === 'undefined') return;
  _achObservedGalleryWidth=Math.round(gallery.clientWidth || 0);
  _achGalleryResizeObserver=new ResizeObserver(entries=>{
    if (!gallery.isConnected) { _achDisconnectGalleryResize(); return; }
    const width=Math.round(entries[0]?.contentRect?.width || gallery.clientWidth || 0);
    if (!width || Math.abs(width-_achObservedGalleryWidth)<2) return;
    if (_achGalleryResizeTimer) clearTimeout(_achGalleryResizeTimer);
    _achGalleryResizeTimer=setTimeout(()=>{
      _achGalleryResizeTimer=null;
      void _achRelayoutGallery();
    },80);
  });
  _achGalleryResizeObserver.observe(gallery);
}

// ── Rebuild galerie après DnD ─────────────────────────────────────────────────
async function _achRebuildGallery(catId) {
  const grid = document.getElementById('ach-gallery');
  if (!grid) return;
  const itemsById  = Object.fromEntries((STORE.items || []).map(a => [a.id, a]));
  const orderedIds = [...grid.querySelectorAll('[data-ach-id]')].map(el => el.dataset.achId);
  const ordered    = orderedIds.map(id => itemsById[id]).filter(Boolean);
  await _achRenderJustified(catId, ordered, grid);
  setupAchievementsDnd(catId);
}

// ── parseDate helper ──────────────────────────────────────────────────────────
// Accepte plusieurs formats : "15 mars 2024", "15/03/2024", "15-03-2024",
// "2024-03-15" (ISO), "15.03.2024". Retourne le timestamp ms ou 0 si invalide.
const _MOIS = {
  janvier:0, fevrier:1, février:1, mars:2, avril:3, mai:4, juin:5,
  juillet:6, aout:7, août:7, septembre:8, octobre:9, novembre:10,
  decembre:11, décembre:11,
  // formes abrégées courantes
  janv:0, fevr:1, févr:1, juil:6, sept:8, oct:9, nov:10, dec:11, déc:11,
};
function parseDate(str) {
  if (!str) return 0;
  const s = String(str).trim();
  if (!s) return 0;

  // ISO yyyy-mm-dd (ou yyyy/mm/dd)
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime() || 0;

  // dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy (français)
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    return new Date(y, +m[2] - 1, +m[1]).getTime() || 0;
  }

  // "15 mars 2024" — mois en lettres (avec ou sans accent)
  m = s.match(/(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\.?\s+(\d{2,4})/);
  if (m) {
    const moisKey = m[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const moisIdx = _MOIS[moisKey] ?? _MOIS[m[2].toLowerCase()];
    if (moisIdx == null) return 0;
    let y = +m[3]; if (y < 100) y += 2000;
    return new Date(y, moisIdx, +m[1]).getTime() || 0;
  }

  return 0;
}

// ── helpers date : ISO (stockage / input) vs FR (affichage) ──────────────────
function _todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _achImageFormatLabel(width, height) {
  const ratio = Number(width) / Math.max(1, Number(height));
  if (!Number.isFinite(ratio) || ratio <= 0) return 'Format libre';
  const formats = [
    { ratio: 2 / 3, label: 'Portrait 2:3' },
    { ratio: 3 / 4, label: 'Portrait 3:4' },
    { ratio: 1, label: 'Carré 1:1' },
    { ratio: 4 / 3, label: 'Paysage 4:3' },
    { ratio: 3 / 2, label: 'Paysage 3:2' },
    { ratio: 16 / 9, label: 'Paysage 16:9' },
  ];
  const closest = formats.reduce((best, current) =>
    Math.abs(current.ratio - ratio) < Math.abs(best.ratio - ratio) ? current : best
  );
  if (Math.abs(closest.ratio - ratio) <= .09) return closest.label;
  return ratio < .9 ? 'Portrait' : ratio > 1.15 ? 'Paysage' : 'Format libre';
}
function _toISO(str) {
  const ts = parseDate(str);
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _formatDateFr(str) {
  const ts = parseDate(str);
  if (!ts) return str ? String(str) : '';
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function _achMissionComparator(a, b) {
  return (a?.acte || '').localeCompare(b?.acte || '') ||
    (a?.ordre || 0) - (b?.ordre || 0) ||
    (a?.date || '').localeCompare(b?.date || '') ||
    (a?.titre || '').localeCompare(b?.titre || '');
}

function _achMissionContextHtml(missionFilter, count) {
  if (!missionFilter || missionFilter === 'all' || (STORE.view || 'galerie') === 'missions') return '';
  const mission = missionFilter === '__none' ? null : (STORE.missions || []).find(m => m.id === missionFilter);
  const isUnlinked = missionFilter === '__none' || !mission;
  const title = isUnlinked ? 'Sans mission liee' : mission.titre || 'Mission';
  const meta = isUnlinked
    ? 'Hauts-faits a classer dans la Trame'
    : [mission.type === 'event' ? 'Evenement de Trame' : 'Mission de Trame', _trameMeta(mission)].filter(Boolean).join(' - ');
  const art = mission?.imageUrl
    ? `<img src="${_esc(mission.imageUrl)}" alt="">`
    : `<span>${isUnlinked ? '∅' : _trameIco(mission)}</span>`;
  return `<section class="ach-mission-context${isUnlinked ? ' is-unlinked' : ''}">
    <div class="ach-mission-context-art">${art}</div>
    <div class="ach-mission-context-main">
      <small>${_esc(meta)}</small>
      <strong>${_esc(title)}</strong>
      <em>${count} haut${count > 1 ? 's' : ''}-fait${count > 1 ? 's' : ''} affiche${count > 1 ? 's' : ''}</em>
    </div>
    <div class="ach-mission-context-actions">
      <button type="button" data-action="_achSetMissionFilter" data-mission-id="all">Tout revoir</button>
      ${mission ? `<button type="button" data-action="_achSetView" data-val="missions">Voir la mission</button>` : ''}
      ${mission ? `<button type="button" data-action="_achOpenMission" data-id="${_esc(mission.id)}">Trame</button>` : ''}
      ${STATE.isAdmin && mission ? `<button type="button" class="is-primary" data-action="_achCreateForMission" data-mission-id="${_esc(mission.id)}">Ajouter</button>` : ''}
    </div>
  </section>`;
}

function _renderMissionGroups(items) {
  const chars = sortCharactersForDisplay(STATE.characters || []);
  const missions = [...(STORE.missions || [])].sort(_achMissionComparator);
  const missionOrder = new Map(missions.map((m, index) => [m.id, index]));
  const missionsById = new Map(missions.map(m => [m.id, m]));
  const knownMissionIds = new Set(missions.map(m => m.id));
  const missionFilter = STORE.missionFilter || 'all';
  const isIsolated = missionFilter !== 'all';
  const buckets = new Map();

  items.forEach(item => {
    const key = item.missionId && knownMissionIds.has(item.missionId) ? item.missionId : '__none';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  });

  const groups = [...buckets.entries()]
    .map(([key, list]) => ({
      key,
      mission: key === '__none' ? null : missionsById.get(key),
      items: _sortAchievementsByDate(list, true),
    }))
    .sort((a, b) => {
      if (a.key === '__none') return 1;
      if (b.key === '__none') return -1;
      const ia = missionOrder.has(a.key) ? missionOrder.get(a.key) : 9999;
      const ib = missionOrder.has(b.key) ? missionOrder.get(b.key) : 9999;
      if (ia !== ib) return ia - ib;
      return (a.mission?.titre || '').localeCompare(b.mission?.titre || '');
    });

  const groupContribs = (list) => {
    const counts = new Map();
    list.forEach(item => (item.contributeurs || []).forEach(id => counts.set(id, (counts.get(id) || 0) + 1)));
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([id, count]) => ({ char: chars.find(c => c.id === id), count }))
      .filter(x => x.char);
  };

  const miniCard = (item) => {
    const cat = _achCategoryFor(item);
    const date = _formatDateFr(item.date);
    return `<button type="button" class="ach-mission-mini" data-action="_achOpenLightbox" data-id="${_esc(item.id)}" style="--c:${cat.color};--c-glow:${cat.glow};--c-line:${cat.line}">
      <span class="ach-mission-mini-art">
        ${item.imageUrl
          ? `<img src="${_esc(item.imageUrl)}" alt="">`
          : `<span>${item.emoji || cat.emoji}</span>`}
      </span>
      <span class="ach-mission-mini-copy">
        <b>${_esc(item.titre || 'Haut-Fait')}</b>
        <small>${date ? _esc(date) : _esc(cat.label)}</small>
      </span>
    </button>`;
  };

  const backHtml = isIsolated ? `<div class="ach-mission-return">
    <button type="button" data-action="_achSetMissionFilter" data-mission-id="all">← Toutes les missions</button>
    <span>${groups.length ? `${groups[0].items.length} haut${groups[0].items.length > 1 ? 's' : ''}-fait${groups[0].items.length > 1 ? 's' : ''} affiché${groups[0].items.length > 1 ? 's' : ''}` : 'Aucun haut-fait affiché'}</span>
  </div>` : '';

  return `${backHtml}<div class="ach-mission-board">
    ${groups.map(group => {
      const mission = group.mission;
      const count = group.items.length;
      const latest = group.items[0];
      const latestDate = _formatDateFr(latest?.date);
      const catCounts = new Map();
      group.items.forEach(item => {
        const cat = _achCategoryFor(item);
        catCounts.set(cat.id, (catCounts.get(cat.id) || 0) + 1);
      });
      const cats = [...catCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id, n]) => ({ cat: _achCategoryFor({ categorie: id }), n }));
      const contributors = groupContribs(group.items);
      const art = mission?.imageUrl
        ? `<img src="${_esc(mission.imageUrl)}" alt="">`
        : `<span>${mission ? _trameIco(mission) : '∅'}</span>`;
      const title = mission?.titre || 'Sans mission liée';
      const meta = mission ? _trameMeta(mission) : 'Hauts-faits non rattachés à la Trame';
      const actionId = mission ? mission.id : '__none';
      const expanded = isIsolated && actionId === missionFilter;
      const visibleItems = expanded ? group.items : group.items.slice(0, 5);

      return `<article class="ach-mission-group${mission ? '' : ' is-unlinked'}">
        <div class="ach-mission-group-head">
          <span class="ach-mission-group-art">${art}</span>
          <span class="ach-mission-group-main">
            <small>${mission ? (mission.type === 'event' ? 'Événement de Trame' : 'Mission de Trame') : 'Non classés'}</small>
            <strong>${_esc(title)}</strong>
            <em>${_esc(meta || 'Trame')} · ${count} haut${count > 1 ? 's' : ''}-fait${count > 1 ? 's' : ''}${latestDate ? ` · dernier : ${_esc(latestDate)}` : ''}</em>
          </span>
          <span class="ach-mission-group-actions">
            ${mission ? `<button type="button" class="ach-mission-group-btn" data-action="_achOpenMission" data-id="${_esc(mission.id)}">Mission</button>` : ''}
            ${expanded
              ? `<button type="button" class="ach-mission-group-btn" data-action="_achSetMissionFilter" data-mission-id="all">Retour</button>`
              : `<button type="button" class="ach-mission-group-btn" data-action="_achSetMissionFilter" data-mission-id="${_esc(actionId)}">Isoler</button>`}
            ${STATE.isAdmin && mission ? `<button type="button" class="ach-mission-group-btn is-primary" data-action="_achCreateForMission" data-mission-id="${_esc(mission.id)}">Ajouter</button>` : ''}
          </span>
        </div>
        <div class="ach-mission-group-meta">
          <span class="ach-mission-group-cats">
            ${cats.map(({ cat, n }) => `<span style="--c:${cat.color};--c-glow:${cat.glow}">${cat.emoji} ${_esc(cat.label)} <b>${n}</b></span>`).join('')}
          </span>
          <span class="ach-mission-group-players">
            ${contributors.length
              ? contributors.map(({ char, count: n }) => characterAvatarHtml(char, {
                tag: 'span',
                className: 'ach-mission-group-avatar',
                border: '1px solid rgba(126,176,255,.45)',
                background: 'rgba(126,176,255,.12)',
                color: '#7eb0ff',
                title: `${char.nom || 'Personnage'} · ${n}`,
              })).join('')
              : '<small>Aucun contributeur renseigné</small>'}
          </span>
        </div>
        <div class="ach-mission-mini-list">
          ${visibleItems.map(miniCard).join('')}
          ${!expanded && group.items.length > 5 ? `<button type="button" class="ach-mission-more" data-action="_achSetMissionFilter" data-mission-id="${_esc(actionId)}">+${group.items.length - 5}<span>voir tout</span></button>` : ''}
        </div>
      </article>`;
    }).join('')}
  </div>`;
}

// ── Barre additionnelle : chips par perso + sens timeline ────────────────────
function _achRenderControlsExtras() {
  // Les filtres avancés appartiennent à la ligne 2 du bandeau. Le fallback
  // conserve la compatibilité avec un shell mis en cache pendant une navigation.
  const root = document.getElementById('ach-controls-extra') || document.querySelector('.hall-content');
  if (!root) return;
  let bar = document.getElementById('ach-extra-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'ach-extra-bar';
    bar.className = 'ach-extra-bar';
    root.insertBefore(bar, root.firstChild);
  }

  // Filtre perso : seulement ceux qui ont au moins 1 HF visible pour l'utilisateur.
  const all = STORE.items || [];
  const visible = STATE.isAdmin ? all : all.filter(a => !a.secret);
  const counts = new Map();
  visible.forEach(a => (a.contributeurs || []).forEach(cid => counts.set(cid, (counts.get(cid)||0)+1)));
  const chars = sortCharactersForDisplay(STATE.characters || [])
    .filter(c => c?.id)
    .sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0) || (a.nom || '').localeCompare(b.nom || ''));
  const CHAR_COLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
  const charColor = (c) => CHAR_COLS[(c?.nom?.charCodeAt(0) || 0) % CHAR_COLS.length];
  const selectedIds = _achSelectedCharIds();
  const selectedSet = new Set(selectedIds);
  const selectedChars = chars.filter(c => selectedSet.has(c.id));
  const myChars = getMyCharacters(chars, STATE.user?.uid).filter(c => c?.id);
  const myCharIds = myChars.map(c => c.id);
  const myCharsActive = myCharIds.length > 0 && selectedIds.length === myCharIds.length && myCharIds.every(id => selectedSet.has(id));
  const matchMode = selectedIds.length > 1 ? (STORE.charMatchMode || 'any') : 'any';
  const filterLabel = selectedChars.length === 1
    ? selectedChars[0].nom
    : selectedChars.length > 1
      ? `${selectedChars.length} joueurs sélectionnés`
      : 'Tous les joueurs';
  let missionFilter = STORE.missionFilter || 'all';
  if (missionFilter !== 'all' && missionFilter !== '__none' && !(STORE.missions || []).some(m => m.id === missionFilter)) {
    STORE.missionFilter = '__none';
    missionFilter = '__none';
  }
  const missionBase = visible
    .filter(item => (STORE.filter || 'all') === 'all' || (item.categorie || _achDefaultCategoryId()) === STORE.filter)
    .filter(item => !selectedIds.length || _achMatchesCharSelection(item, selectedIds))
    .filter(item => {
      const s = _normalize(STORE.search || '');
      return !s || _achSearchHaystack(item).includes(s);
    });
  const missionCounts = new Map();
  const knownMissionIds = new Set((STORE.missions || []).map(m => m.id));
  let noMissionCount = 0;
  missionBase.forEach(item => {
    if (item.missionId && knownMissionIds.has(item.missionId)) missionCounts.set(item.missionId, (missionCounts.get(item.missionId) || 0) + 1);
    else noMissionCount += 1;
  });
  const missionOptions = (STORE.missions || [])
    .filter(m => missionCounts.get(m.id) || m.id === missionFilter)
    .sort((a, b) =>
      (a.acte || '').localeCompare(b.acte || '') ||
      (a.ordre || 0) - (b.ordre || 0) ||
      (a.date || '').localeCompare(b.date || '') ||
      (a.titre || '').localeCompare(b.titre || ''));
  const missionLabel = _achMissionFilterLabel();
  const activeMission = missionFilter !== 'all' && missionFilter !== '__none'
    ? (STORE.missions || []).find(m => m.id === missionFilter)
    : null;
  let previousAct = null;
  const missionOptionsHtml = missionOptions.map(m => {
    const count = missionCounts.get(m.id) || 0;
    const active = missionFilter === m.id;
    const act = m.acte || 'Hors Trame';
    const separator = act !== previousAct ? `<div class="ach-mission-act">${_esc(act)}</div>` : '';
    previousAct = act;
    const searchValue = _normalize([m.titre, m.acte, m.date, m.type === 'event' ? 'événement' : 'mission'].filter(Boolean).join(' '));
    return `${separator}<button type="button" class="ach-mission-option${active ? ' active' : ''}${count ? '' : ' is-empty'}" data-ach-mission-search="${_esc(searchValue)}" data-action="_achSetMissionFilter" data-mission-id="${_esc(m.id)}">
      ${_achMissionThumbHtml(m, 'ach-mission-option-art')}
      <span class="ach-mission-option-main"><b>${_esc(m.titre || 'Mission')}</b><small>${_esc(_trameMeta(m) || (m.type === 'event' ? 'Événement' : 'Mission'))}</small></span>
      <span class="ach-mission-option-count">${count}</span>
    </button>`;
  }).join('');
  const missionFilterHtml = (missionOptions.length || noMissionCount || missionFilter !== 'all') ? `
    <section class="ach-mission-filter" aria-label="Filtrer les hauts-faits par mission">
      <details class="ach-mission-picker">
        <summary class="ach-mission-summary">
          ${_achMissionThumbHtml(activeMission, 'ach-mission-summary-art', missionFilter === '__none' ? '∅' : '🎯')}
          <span class="ach-mission-summary-copy">
            <b>${_esc(missionLabel)}</b>
          </span>
          <span class="ach-mission-chevron">⌄</span>
        </summary>
        <div class="ach-mission-menu">
          ${missionOptions.length > 5 ? `<label class="ach-mission-search">
            <span aria-hidden="true">⌕</span>
            <input type="search" placeholder="Rechercher une mission…" data-input="_achFilterMissionOptions" autocomplete="off">
          </label>` : ''}
          <button type="button" class="ach-mission-option${missionFilter === 'all' ? ' active' : ''}" data-action="_achSetMissionFilter" data-mission-id="all">
            <span class="ach-mission-option-icon">✦</span>
            <span class="ach-mission-option-main"><b>Toutes les missions</b><small>${missionBase.length} haut${missionBase.length > 1 ? 's' : ''}-fait${missionBase.length > 1 ? 's' : ''}</small></span>
            <span class="ach-mission-option-count">${missionBase.length}</span>
          </button>
          ${noMissionCount || missionFilter === '__none' ? `<button type="button" class="ach-mission-option${missionFilter === '__none' ? ' active' : ''}" data-action="_achSetMissionFilter" data-mission-id="__none">
            <span class="ach-mission-option-icon">∅</span>
            <span class="ach-mission-option-main"><b>Sans mission liée</b><small>Hauts-faits non rattachés à la Trame</small></span>
            <span class="ach-mission-option-count">${noMissionCount}</span>
          </button>` : ''}
          ${missionOptionsHtml}
          <div class="ach-mission-search-empty" hidden>Aucune mission trouvée.</div>
        </div>
      </details>
    </section>` : '';
  const selectedPreview = selectedChars.slice(0, 4).map(c => {
    const col = charColor(c);
    return characterAvatarHtml(c, {
      tag: 'span',
      className: 'ach-player-picker-av',
      border: 'none',
      background: 'transparent',
      color: col,
      fallbackStyle: "font-family:'Cinzel',serif;font-weight:700",
    });
  }).join('');

  const charChips = chars.length ? `
    <section class="ach-player-filter" aria-label="Filtrer les hauts-faits par joueur">
      <details class="ach-player-picker"${STORE.charPickerOpen ? ' open' : ''}>
        <summary class="ach-player-picker-summary">
          ${selectedPreview
            ? `<span class="ach-player-picker-stack">${selectedPreview}${selectedChars.length > 4 ? `<span class="ach-player-picker-more">+${selectedChars.length - 4}</span>` : ''}</span>`
            : '<span class="ach-player-picker-all">Tous</span>'}
          <span class="ach-player-picker-copy">
            <strong>${selectedChars.length ? _esc(filterLabel) : 'Personnages'}</strong>
          </span>
          <span class="ach-player-picker-chevron">⌄</span>
        </summary>
        <div class="ach-player-menu">
          <div class="ach-player-menu-tools">
            <div class="ach-player-shortcuts">
              <button type="button" class="ach-player-clear${!selectedIds.length ? ' active' : ''}"
                data-action="_achClearCharFilters" title="Afficher tous les personnages">
                Tous
              </button>
              ${myCharIds.length ? `<button type="button" class="ach-player-mine${myCharsActive ? ' active' : ''}"
                data-action="_achSelectMyCharacters" title="Sélectionner les personnages de mon compte">
                Mes personnages <span>${myCharIds.length}</span>
              </button>` : ''}
            </div>
            ${selectedIds.length > 1 ? `
              <div class="ach-player-mode" aria-label="Mode de filtre">
                <button type="button" class="${matchMode === 'any' ? 'active' : ''}" data-action="_achSetCharMatchMode" data-mode="any">
                  Chacun
                </button>
                <button type="button" class="${matchMode === 'shared' ? 'active' : ''}" data-action="_achSetCharMatchMode" data-mode="shared">
                  Ensemble
                </button>
              </div>` : ''}
          </div>
          <button type="button" class="ach-player-option${!selectedIds.length?' active':''}" data-charid="all"
            data-action="_achClearCharFilters" title="Tous les personnages">
            <span class="ach-player-option-all">Tous</span>
            <span class="ach-player-option-main">
              <strong>Tous les joueurs</strong>
              <small>${visible.length} haut${visible.length > 1 ? 's' : ''}-fait${visible.length > 1 ? 's' : ''}</small>
            </span>
            <span class="ach-player-option-count">${visible.length}</span>
            <span class="ach-player-option-check">${selectedIds.length ? '+' : '✓'}</span>
          </button>
          ${chars.map(c => {
            const col = charColor(c);
            const isOn = selectedSet.has(c.id);
            const count = counts.get(c.id) || 0;
            return `<button type="button" class="ach-player-option${isOn?' active':''}${count ? '' : ' is-empty'}" data-charid="${_esc(c.id)}"
            data-action="_achToggleCharFilter"
            style="--c:${col}" title="${_esc(c.nom||'?')} - ${count} haut${count>1?'s':''}-fait${count>1?'s':''}">
            ${characterAvatarHtml(c, {
              tag: 'span',
              className: 'ach-player-option-av',
              border: 'none',
              background: 'transparent',
              color: col,
              fallbackStyle: "font-family:'Cinzel',serif;font-weight:700",
            })}
            <span class="ach-player-option-main">
              <strong>${_esc(c.nom||'?')}</strong>
              <small>${count ? `${count} haut${count > 1 ? 's' : ''}-fait${count > 1 ? 's' : ''}` : 'Aucun pour le moment'}</small>
            </span>
            <span class="ach-player-option-count">${count}</span>
            <span class="ach-player-option-check">${isOn ? '✓' : '+'}</span>
          </button>`;
          }).join('')}
        </div>
      </details>
    </section>` : '';

  const hasActiveFilters = (STORE.filter || 'all') !== 'all' ||
    missionFilter !== 'all' ||
    selectedIds.length > 0 ||
    !!(STORE.search || '').trim();
  const resetBtn = hasActiveFilters ? `
    <button class="ach-reset-filters" type="button" data-action="_achResetFilters" title="Réinitialiser tous les filtres">
      Réinitialiser
    </button>` : '';
  const actionsHtml = resetBtn ? `<div class="ach-extra-actions">${resetBtn}</div>` : '';

  bar.innerHTML = charChips + missionFilterHtml + actionsHtml;
  bar.style.display = (missionFilterHtml || charChips || actionsHtml) ? 'flex' : 'none';
}

function _achNewBannerHtml(items) {
  const fresh = items.filter(_achIsNew);
  if (!fresh.length) return '';
  const first = fresh[0], mission = _missionFor(first);
  const previews = fresh.slice(0, 4).map(item => {
    const category = _achCategoryFor(item);
    return `<span>${item.imageUrl ? `<img src="${_esc(item.imageUrl)}" alt="">` : _esc(item.emoji || category.emoji)}</span>`;
  }).join('');
  return `<aside class="ach-new-banner"><div class="ach-new-stack">${previews}</div><div class="ach-new-copy"><strong>${fresh.length} nouveau${fresh.length > 1 ? 'x' : ''} haut${fresh.length > 1 ? 's' : ''}-fait${fresh.length > 1 ? 's' : ''}</strong><small> depuis ta dernière visite${mission?.titre ? ` · ${_esc(mission.titre)}` : ''}</small></div><button data-action="_achShowNew" data-id="${_esc(first.id)}">Voir</button><button data-action="_achMarkSeen">Marquer comme vus</button></aside>`;
}

function _achDisposeChronicle() {
  _achChronicle?.dispose();
  _achChronicle = _achChronicleModel = _achChronicleCrumb = null;
  _achChronicleChapterById.clear();
  if (_achChronicleDropTarget) {
    _achChronicleDropTarget.closest('.hall-root')?.classList.remove('ach-drop-active', 'ach-drop-on-session');
    _achDropSession(null);
  }
}

function _achRenderChronicle(content, all, filtered, hasFilters, bulkBar) {
  const model = buildChronicle(all, STORE.missions, {
    desc: STORE.timelineDesc, isAdmin: STATE.isAdmin, filteredIds: new Set(filtered.map(item => item.id)),
    toDate: item => /^\d{4}-\d{2}-\d{2}$/.test(item.date || '') ? item.date : _toISO(item.date),
  });
  _achChronicleModel = model;
  const ordered = model.visible.flatMap(s => s.shown);
  for (const s of model.visible) for (const item of s.shown) _achChronicleChapterById.set(item.id, s.chapter);
  const root = content.closest('.hall-root');
  const animate = !content.querySelector('.cr');
  const view = renderChronicle(model, {
    categories: ACH_CATS, categoryFor: _achCategoryFor, isNew: _achIsNew, characters: STATE.characters || [],
    isAdmin: STATE.isAdmin, bulk: _achBulkMode, selected: _achBulkSelected, search: STORE.search,
    hasFilters, desc: STORE.timelineDesc, mode: STORE.timelineMode,
    news: _achNewBannerHtml(ordered), bulkBar, animate,
  });
  const compact = root.querySelector('.ach-chronicle-compact');
  compact.innerHTML = view.compact;
  content.innerHTML = view.html;
  root.querySelector('.hall-command-title small').textContent =
    `Chronique de campagne · ${model.sessions.length} séance${model.sessions.length === 1 ? '' : 's'}${model.months ? ` · ${model.months} mois d’aventure` : ''}`;
  root.querySelectorAll('[data-ach-chronicle-mode]').forEach(btn => {
    const active = btn.dataset.achChronicleMode === STORE.timelineMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  const order = root.querySelector('[data-action="_achToggleTimelineDir"]');
  order.textContent = STORE.timelineDesc ? '↓ Plus récents d’abord' : '↑ Plus anciens d’abord';
  order.setAttribute('aria-pressed', String(STORE.timelineDesc));
  _achChronicle = bindChronicle(content, compact, model, {
    getScroll: _achScrollMetrics,
    getInset: () => matchMedia('(min-width:900px)').matches && model.dated.length ? 100 : 56,
    categoryFor: _achCategoryFor,
    onCurrent: current => { _achChronicleCrumb = current; _achUpdateMiniBar(null); },
  });
}

function _achRailHtml(items) {
  if (!items.length) return '';
  const markers = [], seen = new Set();
  let previousBand = '';
  items.forEach(item => {
    const key = STORE.group === 'mission' ? (item.missionId || 'interlude') : _achMonthKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    const mission = _missionFor(item);
    const timestamp = parseDate(item?.date);
    const year = timestamp ? String(new Date(timestamp).getFullYear()) : '';
    const band = STORE.group === 'mission' ? (mission?.acte || 'Hors Trame') : year;
    const showBand = !!band && band !== previousBand;
    previousBand = band || previousBand;
    const month = _achMonthLabel(_achMonthKey(item));
    const label = STORE.group === 'mission'
      ? [mission?.acte, mission?.titre || 'Interlude'].filter(Boolean).join(' · ')
      : STORE.group === 'none'
        ? [month, mission?.titre].filter(Boolean).join(' · ')
        : month;
    markers.push({
      item,
      label,
      fresh: _achIsNew(item),
      band,
      showBand,
    });
  });
  const denominator = Math.max(1, markers.length - 1);
  return `<nav class="ach-rail" aria-label="Frise de navigation">
    <div class="ach-rail-track" aria-label="Faire défiler la fresque">
      <div class="ach-rail-line"></div><div class="ach-rail-thumb"></div>
      ${markers.map((marker, index) => {
        const position = index / denominator * 100;
        const category = _achCategoryFor(marker.item);
        const art = marker.item.imageUrl
          ? `<span class="ach-rail-tip-art"><img src="${_esc(marker.item.imageUrl)}" alt=""></span>`
          : `<span class="ach-rail-tip-art">${_esc(marker.item.emoji || category.emoji)}</span>`;
        return `${marker.showBand ? `<b class="ach-rail-year" style="--rail-y:${position}%">${_esc(marker.band)}</b>` : ''}<button class="${marker.showBand ? 'is-band ' : ''}${marker.fresh ? 'is-new' : ''}" style="--rail-y:${position}%" data-action="_achRailJump" data-id="${_esc(marker.item.id)}" data-ach-rail-id="${_esc(marker.item.id)}" title="${_esc(marker.label)}"><span class="ach-rail-tick"></span><em class="ach-rail-tip">${art}<span><small>${_esc(marker.band)}</small><b>${_esc(marker.label)}</b></span></em></button>`;
      }).join('')}
    </div>
  </nav>`;
}

function _achEndHtml(items = []) {
  const dates = items.map(item => parseDate(item.date)).filter(Boolean).sort((a, b) => a - b);
  const months = dates.length
    ? Math.max(1, (new Date(dates.at(-1)).getFullYear() - new Date(dates[0]).getFullYear()) * 12 + new Date(dates.at(-1)).getMonth() - new Date(dates[0]).getMonth() + 1)
    : 0;
  const characters = new Set(items.flatMap(item => item.contributeurs || [])).size;
  const filtered = (STORE.filter || 'all') !== 'all' || (STORE.missionFilter || 'all') !== 'all' || _achSelectedCharIds().length || !!(STORE.search || '').trim();
  const reverse = STORE.galleryOrder === 'desc';
  return `<footer class="ach-fresque-end"><span>✦</span><strong>${reverse ? 'Tout a commencé ici' : 'À suivre…'}</strong><p>${items.length} souvenir${items.length > 1 ? 's' : ''}${months ? ` · ${months} mois d’aventure` : ''}${characters ? ` · ${characters} personnage${characters > 1 ? 's' : ''}` : ''}</p><div>${STATE.isAdmin && !reverse ? '<button class="is-primary" data-action="openAchievementModal">+ Ajouter la suite</button>' : ''}${filtered ? '<button data-action="_achResetFilters">Voir toute la galerie</button>' : ''}<button data-action="_achScrollTop">Revenir au début</button></div></footer>`;
}

// ── Rendu du contenu (filtre + vue) ──────────────────────────────────────────
async function _achRenderContent({ force=false } = {}) {
  const contentEl = document.getElementById('ach-content');
  if (!contentEl) return;
  const knownIds = new Set((STORE.items || []).map(item => item.id));
  [..._achBulkSelected].forEach(id => { if (!knownIds.has(id)) _achBulkSelected.delete(id); });
  const signature=_achRenderSignature();
  if (!force && _achRenderedContentEl===contentEl && _achLastRenderSignature===signature) return;
  const renderEpoch = ++_achRenderEpoch;
  _achRenderedContentEl=contentEl;
  _achLastRenderSignature=signature;
  _achDisconnectGalleryResize();
  _refreshAchievementCounters();
  _achRenderControlsExtras();

  const all        = STORE.items || [];
  const filter     = STORE.filter || 'all';
  let missionFilter = STORE.missionFilter || 'all';
  if (missionFilter !== 'all' && missionFilter !== '__none' && !(STORE.missions || []).some(m => m.id === missionFilter)) {
    STORE.missionFilter = '__none';
    missionFilter = '__none';
  }
  const selectedCharIds = _achSelectedCharIds();
  const search     = _normalize(STORE.search || '');   // minuscules + sans accents
  const isAdmin    = STATE.isAdmin;

  // 1. Filtre secret (joueurs ne voient pas les HF secrets)
  let filtered = isAdmin ? all : all.filter(a => !a.secret);
  // 2. Filtre catégorie
  if (filter !== 'all') filtered = filtered.filter(a => (a.categorie || _achDefaultCategoryId()) === filter);
  if (missionFilter !== 'all') {
    const knownMissionIds = new Set((STORE.missions || []).map(m => m.id));
    filtered = filtered.filter(a => missionFilter === '__none'
      ? !a.missionId || !knownMissionIds.has(a.missionId)
      : a.missionId === missionFilter);
  }
  // 3. Filtre par perso contributeur
  if (selectedCharIds.length) filtered = filtered.filter(a => _achMatchesCharSelection(a, selectedCharIds));
  // 4. Recherche
  if (search) {
    filtered = filtered.filter(a => _achSearchHaystack(a).includes(search));
  }

  // Map lightbox (limitée aussi pour les joueurs : pas d'ouverture d'un HF secret)
  const visibleForLightbox = isAdmin ? all : all.filter(a => !a.secret);
  STORE.lightboxItems = Object.fromEntries(visibleForLightbox.map(a => [a.id, a]));
  const missionContextHtml = _achMissionContextHtml(missionFilter, filtered.length);
  const bulkBarHtml = _achBulkBarHtml(filtered);
  const hall = contentEl.closest('.hall-root');
  const chronicle = STORE.view === 'timeline';
  hall.classList.toggle('is-chronicle', chronicle);
  _achDisposeChronicle();
  if (chronicle) {
    _destroyAchievementSortables();
    _achRailCleanup?.();
    _achRailCleanup = null;
    _achImageWarmCleanup?.();
    _achImageWarmCleanup = null;
    _achRenderChronicle(contentEl, all, filtered, filter !== 'all' || missionFilter !== 'all' || selectedCharIds.length > 0 || !!search, bulkBarHtml);
    return;
  }
  hall.querySelector('.ach-chronicle-compact').replaceChildren();
  const subtitle = hall.querySelector('.hall-command-title small');
  if (subtitle.dataset.galleryText) subtitle.textContent = subtitle.dataset.galleryText;

  if (!filtered.length) {
    const catDef = ACH_CATS.find(c => c.id === filter);
    const selectedNames = selectedCharIds
      .map(id => (STATE.characters || []).find(c => c.id === id)?.nom)
      .filter(Boolean);
    const charName = selectedNames.length === 1
      ? selectedNames[0]
      : selectedNames.length > 1
        ? ((STORE.charMatchMode || 'any') === 'shared'
          ? `ces ${selectedNames.length} personnages ensemble`
          : `${selectedNames.length} personnages sélectionnés`)
        : null;
    const missionName = missionFilter !== 'all' ? _achMissionFilterLabel() : null;
    let title = 'Aucun haut-fait';
    let sub = STATE.isAdmin ? 'Ajoutez le premier !' : '';
    if (search) { title = 'Aucun résultat'; sub = `pour « ${_esc((STORE.search || '').trim())} »`; }
    else if (missionName) { title = 'Aucun haut-fait'; sub = `pour « ${_esc(missionName)} »`; }
    else if (charName) { title = `Aucun haut-fait`; sub = `pour « ${_esc(charName)} »`; }
    const hasActiveFilters = filter !== 'all' || missionFilter !== 'all' || selectedCharIds.length > 0 || !!search;
    const resetAction = hasActiveFilters
      ? `<button class="btn btn-outline btn-sm" data-action="_achResetFilters">Réinitialiser les filtres</button>`
      : '';
    const createAction = STATE.isAdmin && !search
      ? `<button class="btn btn-gold btn-sm" data-action="openAchievementModal">＋ Créer un haut-fait</button>`
      : '';
    contentEl.innerHTML = `
      ${missionContextHtml}
      ${bulkBarHtml}
      <div class="hall-empty">
        <div class="hall-empty-icon">${catDef?.emoji || '🏆'}</div>
        <div class="hall-empty-title">${title}</div>
        <div class="hall-empty-sub">${sub}</div>
        ${(resetAction || createAction) ? `<div class="hall-empty-actions">${resetAction}${createAction}</div>` : ''}
      </div>`;
    _achUpdateMiniBar();
    return;
  }

  if ((STORE.view || 'galerie') === 'missions') {
    contentEl.innerHTML = _renderMissionGroups(filtered);
    setupAchievementsDnd(null);
    _achUpdateMiniBar();
    return;
  }

  if (filter === 'all') filtered = _sortAchievementsByDate(filtered, STORE.galleryOrder === 'desc');
  else if (STORE.galleryOrder === 'desc') filtered.reverse();

  // Galerie justified
  const galleryEl = document.createElement('div');
  galleryEl.id        = 'ach-gallery';
  galleryEl.className = 'ach-justified';
  contentEl.innerHTML = missionContextHtml + bulkBarHtml + _achNewBannerHtml(filtered);
  contentEl.appendChild(galleryEl);

  await _achRenderGallerySections(filtered, galleryEl);
  if (renderEpoch !== _achRenderEpoch || !document.contains(galleryEl) || contentEl !== document.getElementById('ach-content')) return;
  const canManualSort = !_achBulkMode && STORE.group === 'none' && filter !== 'all' && missionFilter === 'all' && !selectedCharIds.length && !search;
  setupAchievementsDnd(canManualSort ? filter : null);
  _achObserveGalleryResize(galleryEl);
  _achWarmCardPositionCache(galleryEl);
  _achInstallImageWarmup(galleryEl);
  contentEl.insertAdjacentHTML('beforeend', _achEndHtml(filtered) + _achRailHtml(filtered));
  _achBindRail();
  _achUpdateMiniBar();
  _achLastRenderSignature=_achRenderSignature();
}

// ── Actions état (appelées depuis les boutons HTML) ───────────────────────────
function _achRenderContentPreserveViewport(options = {}, capturedAnchor = null) {
  const anchor=capturedAnchor || _achCaptureViewportAnchor();
  const rendered = _achRenderContent(options);
  Promise.resolve(rendered).finally(() => {
    _achRestoreViewportAnchorAfterFrame(anchor);
  });
  return rendered;
}

function _achSetFilter(filter) {
  STORE.filter = filter;
  document.querySelectorAll('.hall-filter-card').forEach(el => {
    const active = el.dataset.filter === filter;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  _achRenderContentPreserveViewport();
};
function _achSetView(view, { syncRoute = true } = {}) {
  if (!['galerie', 'timeline', 'missions'].includes(view)) return;
  const changesScrollHost = view !== STORE.view && (view === 'timeline' || STORE.view === 'timeline');
  if (changesScrollHost) {
    // Les coordonnées d'une carte de Galerie n'ont pas de sens dans le récit.
    // Changer de vue ouvre son bandeau, tandis que les actions dans la vue gardent l'ancre.
    _achCurrentScrollHost()?.scrollTo({ top: 0, behavior: 'instant' });
  }
  if (view === 'missions' && _achBulkMode) {
    _achBulkMode = false;
    _achBulkSelected.clear();
    _achSyncBulkToggle();
  }
  STORE.view = view;
  _achSavePreferences();
  if (syncRoute) setRouteSub('achievements', view);
  document.querySelectorAll('.view-tab').forEach((btn) => {
    const active = btn.dataset.val === view;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (changesScrollHost) {
    const render = _achRenderContent();
    document.getElementById('main-content')?.scrollTo({ top: 0, behavior: 'instant' });
    document.scrollingElement?.scrollTo({ top: 0, behavior: 'instant' });
    _achInstallScrollUi();
    return render;
  }
  return _achRenderContentPreserveViewport();
};
function _achSetGroup(group) {
  if (!['none', 'mission', 'month'].includes(group)) return;
  STORE.group = group;
  _achSavePreferences();
  document.querySelectorAll('[data-ach-group]').forEach(btn => btn.classList.toggle('active', btn.dataset.achGroup === group));
  _achRenderContentPreserveViewport({ force: true });
}
function _achSetDensity(density) {
  if (!['s', 'm', 'l'].includes(density)) return;
  STORE.density = density;
  _achSavePreferences();
  document.querySelectorAll('[data-ach-density]').forEach(btn => btn.classList.toggle('active', btn.dataset.achDensity === density));
  _achRenderContentPreserveViewport({ force: true });
}
function _achSetGalleryOrder(order) {
  STORE.galleryOrder = order === 'desc' ? 'desc' : 'asc';
  _achSavePreferences();
  document.querySelectorAll('[data-ach-order]').forEach(btn => {
    btn.dataset.achOrder = STORE.galleryOrder === 'desc' ? 'asc' : 'desc';
    btn.classList.toggle('active', STORE.galleryOrder === 'desc');
    btn.setAttribute('aria-pressed', String(STORE.galleryOrder === 'desc'));
    btn.textContent = STORE.galleryOrder === 'desc' ? '↓ Plus récents d’abord' : '↑ Plus anciens d’abord';
  });
  _achRenderContentPreserveViewport({ force: true });
}
function _achFlashCard(id) {
  const card = document.querySelector(`[data-ach-id="${CSS.escape(id || '')}"]`);
  if (!card) return;
  const reduced = STORE.view === 'timeline' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  card.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' });
  card.classList.remove('ach-flash');
  requestAnimationFrame(() => card.classList.add('ach-flash'));
  setTimeout(() => card.classList.remove('ach-flash'), 1800);
}
function _achMarkSeen() {
  STORE.lastSeen = new Date().toISOString();
  _achSavePreferences();
  _achRenderContentPreserveViewport({ force: true });
}
function _achScrollTop() {
  document.getElementById('main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  document.scrollingElement?.scrollTo({ top: 0, behavior: 'smooth' });
}
function _achSlideshowChapterKey(item) {
  if (STORE.view === 'timeline') return _achChronicleChapterById.get(item?.id);
  if ((STORE.group || 'none') === 'mission') return item?.missionId || 'interlude';
  if (STORE.group === 'month') return _achMonthKey(item);
  return '';
}
function _achLightboxSequence() {
  return STORE.view === 'timeline' && _achChronicleModel
    ? _achChronicleModel.visible.flatMap(s => s.shown)
    : _achFilteredItemsForCurrentState({ ordered: true });
}
function _achScheduleSlideshow() {
  if (!_achSlideshowTimer) return;
  clearTimeout(_achSlideshowTimer);
  _achSlideshowTimer = setTimeout(_achAdvanceSlideshow, 4000);
}
function _achAdvanceSlideshow() {
  const overlay = document.getElementById('ach-lightbox');
  const currentId = overlay?.dataset.itemId;
  const items = _achLightboxSequence();
  const index = items.findIndex(entry => entry.id === currentId);
  const next = items[index + 1];
  if (!overlay || !next) {
    clearTimeout(_achSlideshowTimer);
    _achSlideshowTimer = null;
    overlay?.classList.remove('is-slideshow');
    overlay?.querySelector('.ach-lb-slideshow')?.classList.remove('active');
    if (overlay) {
      const chronicle = STORE.view === 'timeline';
      const reverse = chronicle ? STORE.timelineDesc : STORE.galleryOrder === 'desc';
      overlay.insertAdjacentHTML('beforeend', `<div class="ach-lb-card ach-lb-card--end"><div><small>${chronicle ? 'Fin de la chronique' : 'Fin de la fresque'}</small><h2>${reverse ? 'Tout a commencé ici' : 'À suivre…'}</h2><p>${items.length} souvenir${items.length > 1 ? 's' : ''} parcouru${items.length > 1 ? 's' : ''}</p><button type="button" data-action="_achRestartSlideshow">Recommencer</button></div></div>`);
    }
    return;
  }
  const current = items[index];
  const changesChapter = _achSlideshowChapterKey(current) !== _achSlideshowChapterKey(next);
  if (changesChapter && (STORE.view === 'timeline' || STORE.group !== 'none')) {
    const chronicle = STORE.view === 'timeline';
    const mission = chronicle ? _achChronicleModel?.chapters.find(c => c.key === _achSlideshowChapterKey(next))?.mission : _missionFor(next);
    const byMonth = !chronicle && STORE.group === 'month';
    const title = byMonth ? _achMonthLabel(_achMonthKey(next)) : (mission?.titre || 'Interlude');
    const overline = byMonth ? 'Nouveau chapitre' : (mission?.acte || 'Hors Trame');
    overlay.insertAdjacentHTML('beforeend', `<div class="ach-lb-card"><div><small>${_esc(overline)}</small><h2>${_esc(title)}</h2><p>La suite de l’aventure</p></div></div>`);
    _achSlideshowTimer = setTimeout(() => _achOpenLightbox(next.id), 1200);
    return;
  }
  _achOpenLightbox(next.id);
}
function _achToggleSlideshow() {
  if (_achSlideshowTimer) {
    clearTimeout(_achSlideshowTimer);
    _achSlideshowTimer = null;
    document.querySelector('.ach-lb-slideshow')?.classList.remove('active');
    document.getElementById('ach-lightbox')?.classList.remove('is-slideshow');
    return;
  }
  document.querySelector('.ach-lb-slideshow')?.classList.add('active');
  document.getElementById('ach-lightbox')?.classList.add('is-slideshow');
  _achSlideshowTimer = -1;
  _achScheduleSlideshow();
}
function _achRestartSlideshow() {
  const first = _achLightboxSequence()[0];
  if (!first) return;
  _achSlideshowTimer = -1;
  _achOpenLightbox(first.id);
}
function _achSkipSeriesImage() {
  if (!_achSeries.files.length) return;
  _achSeries.files.shift();
  if (!_achSeries.files.length) { _achResetSeries(); closeModal(); return; }
  const preset = {
    ..._achSeries.chroniclePreset,
    series: true,
    categorie: document.getElementById('ach-categorie')?.value || _achDefaultCategoryId(),
    date: document.getElementById('ach-date')?.value ?? _todayISO(),
    missionId: document.getElementById('ach-mission-id')?.value || '',
    contributeurs: (document.getElementById('ach-contributeurs')?.value || '').split(',').filter(Boolean),
  };
  _achUploader?.destroy(); _achUploader = null;
  _achSeries.transition = true;
  closeModal();
  _achSeries.transition = false;
  openAchievementModal(null, preset);
}
function _achReplaceImage() {
  _achUploader?.open?.();
}
function _achRemoveImage() {
  _achUploader?.reset?.();
  const featured = document.getElementById('ach-featured');
  if (featured) featured.checked = false;
}
function _achAddSuggestedContributors(rawIds) {
  const ids = String(rawIds || '').split(',').filter(Boolean);
  ids.forEach(id => {
    const hidden = document.getElementById('ach-contributeurs');
    const current = hidden?.value ? hidden.value.split(',').filter(Boolean) : [];
    if (!current.includes(id)) _achToggleContrib(id);
  });
  document.querySelector('.achm-contrib-suggest')?.remove();
}
function _achDeleteFromDrawer(id) {
  if (!id) return;
  _achUploader?.destroy();
  _achUploader = null;
  closeModal();
  void deleteAchievement(id);
}
function _achToggleBulkMode() {
  if (!STATE.isAdmin) return;
  _achBulkMode = !_achBulkMode;
  if (!_achBulkMode) _achBulkSelected.clear();
  if (_achBulkMode && STORE.view === 'missions') {
    STORE.view = 'galerie';
    _achSavePreferences();
    setRouteSub('achievements', 'galerie');
    document.querySelectorAll('.view-tab').forEach((button) => {
      const active = button.dataset.val === 'galerie';
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
  }
  _achSyncBulkToggle();
  _achRenderContentPreserveViewport({ force: true });
}
function _achBulkSelectFiltered() {
  if (!_achBulkMode) return;
  const filtered = _achFilteredItemsForCurrentState();
  const allSelected = filtered.length > 0 && filtered.every(item => _achBulkSelected.has(item.id));
  filtered.forEach(item => {
    if (allSelected) _achBulkSelected.delete(item.id);
    else _achBulkSelected.add(item.id);
  });
  _achRenderContentPreserveViewport({ force: true });
}
function _achBulkClear() {
  _achBulkSelected.clear();
  _achRenderContentPreserveViewport({ force: true });
}
function _achSetMissionFilter(missionId) {
  STORE.missionFilter = missionId || 'all';
  _achRenderContentPreserveViewport();
}
function _achFilterMissionOptions(raw, input) {
  const menu = input?.closest('.ach-mission-menu');
  if (!menu) return;
  const query = _normalize(raw);
  let visible = 0;
  menu.querySelectorAll('[data-ach-mission-search]').forEach(option => {
    const show = !query || (option.dataset.achMissionSearch || '').includes(query);
    option.hidden = !show;
    if (show) visible++;
  });
  const empty = menu.querySelector('.ach-mission-search-empty');
  if (empty) empty.hidden = visible > 0;
}
let _achSearchTimer = null;
function _achSetSearch(val) {
  STORE.search = val;
  document.querySelectorAll('#ach-search-input, #ach-mini-search-input').forEach(input => {
    if (input !== document.activeElement && input.value !== val) input.value = val;
  });
  _achUpdateMiniBar();
  clearTimeout(_achSearchTimer);
  _achSearchTimer = setTimeout(_achRenderContentPreserveViewport, 240);
};
function _achSetCharFilter(charId) {
  STORE.charPickerOpen = true;
  _achSetSelectedCharIds(charId && charId !== 'all' ? [charId] : []);
  document.querySelectorAll('.ach-player-option').forEach(el => {
    el.classList.toggle('active', el.dataset.charid === STORE.charFilter);
  });
  _achRenderContentPreserveViewport();
};
function _achToggleCharFilter(charId) {
  if (!charId || charId === 'all') return _achClearCharFilters();
  STORE.charPickerOpen = true;
  const selected = new Set(_achSelectedCharIds());
  selected.has(charId) ? selected.delete(charId) : selected.add(charId);
  _achSetSelectedCharIds([...selected]);
  document.querySelectorAll('.ach-player-option').forEach(el => {
    el.classList.toggle('active', selected.has(el.dataset.charid));
  });
  _achRenderContentPreserveViewport();
};
function _achClearCharFilters() {
  STORE.charPickerOpen = true;
  _achSetSelectedCharIds([]);
  _achRenderContentPreserveViewport();
};
function _achSelectMyCharacters() {
  const myIds = getMyCharacters(STATE.characters || [], STATE.user?.uid).map(c => c.id).filter(Boolean);
  if (!myIds.length) return;
  STORE.charPickerOpen = true;
  STORE.charMatchMode = 'any';
  _achSetSelectedCharIds(myIds);
  _achRenderContentPreserveViewport();
};
function _achSetCharMatchMode(mode) {
  STORE.charPickerOpen = true;
  STORE.charMatchMode = mode === 'shared' ? 'shared' : 'any';
  _achRenderContentPreserveViewport();
};
function _achToggleTimelineDir() {
  STORE.timelineDesc = !STORE.timelineDesc;
  _achSavePreferences();
  _achRenderContentPreserveViewport();
};
function _achResetFilters() {
  STORE.filter = 'all';
  STORE.missionFilter = 'all';
  STORE.search = '';
  STORE.charPickerOpen = false;
  _achSetSelectedCharIds([]);
  document.querySelectorAll('.hall-filter-card').forEach(el => {
    el.classList.toggle('active', el.dataset.filter === 'all');
  });
  const searchInput = document.getElementById('ach-search-input');
  if (searchInput) searchInput.value = '';
  _achRenderContentPreserveViewport();
};
function _achRemoveMiniFilter(kind) {
  if (kind === 'category') STORE.filter = 'all';
  else if (kind === 'mission') STORE.missionFilter = 'all';
  else if (kind === 'characters') _achSetSelectedCharIds([]);
  else if (kind === 'search') STORE.search = '';
  _achRenderContentPreserveViewport({ force: true });
}
function _achSetChronicleMode(mode) {
  if (!['recit', 'sommaire'].includes(mode) || mode === STORE.timelineMode) return;
  STORE.timelineMode = mode;
  _achSavePreferences();
  _achRenderContentPreserveViewport();
}
function _achChronicleAdd(key) {
  if (!STATE.isAdmin || STORE.view !== 'timeline' || _achBulkMode) return;
  const preset = chroniclePreset(_achChronicleModel, key, _todayISO());
  if (preset) openAchievementModal(null, preset);
}
function _achMiniCrumb(id) {
  if (STORE.view === 'timeline' && id) return _achChronicle?.jump(id);
  if (id) return _achFlashCard(id);
  _achScrollTop();
}
function _achFocusMissionGroup(missionId) {
  if (!missionId) return;
  document.getElementById('ach-lightbox')?.remove();
  STORE.missionFilter = missionId;
  STORE.view = 'missions';
  _achSavePreferences();
  document.querySelectorAll('.view-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.val === 'missions');
  });
  _achRenderContentPreserveViewport();
};
function _achCreateForMission(missionId) {
  if (!STATE.isAdmin || !missionId) return;
  document.getElementById('ach-lightbox')?.remove();
  const mission = (STORE.missions || []).find(item => item.id === missionId);
  openAchievementModal(null, { missionId, date: _toISO(mission?.date) || _todayISO() });
};
function _achCreateAtTail(missionId, date) {
  if (!STATE.isAdmin) return;
  openAchievementModal(null, { missionId: missionId || '', date: date || _todayISO() });
}
function _achEditFromLightbox(itemId) {
  if (!STATE.isAdmin || !itemId) return;
  const overlay = document.getElementById('ach-lightbox');
  overlay?.dispatchEvent(new Event('ach-lb-teardown'));
  overlay?.remove();
  editAchievement(itemId);
};
function _achDeleteFromLightbox(itemId) {
  if (!STATE.isAdmin || !itemId) return;
  const overlay = document.getElementById('ach-lightbox');
  overlay?.dispatchEvent(new Event('ach-lb-teardown'));
  overlay?.remove();
  deleteAchievement(itemId);
};

// ── LIGHTBOX ENRICHIE ─────────────────────────────────────────────────────────
function _achClearLightboxKeyHandler() {
  if (!_achLightboxKeyHandler) return;
  document.removeEventListener('keydown', _achLightboxKeyHandler);
  _achLightboxKeyHandler = null;
}

function _achLightboxStripHtml(items, activeId) {
  const activeIndex = Math.max(0, items.findIndex(entry => entry.id === activeId));
  const windowSize = 25;
  const maxStart = Math.max(0, items.length - windowSize);
  const start = Math.max(0, Math.min(activeIndex - Math.floor(windowSize / 2), maxStart));
  const visibleItems = items.slice(start, start + windowSize);
  let previousGroup = null;
  return visibleItems.map(entry => {
    const group = STORE.view === 'timeline' ? _achChronicleChapterById.get(entry.id)
      : STORE.group === 'mission' ? (entry.missionId || 'interlude') : STORE.group === 'month' ? _achMonthKey(entry) : null;
    const mission = STORE.view === 'timeline' ? _achChronicleModel?.chapters.find(c => c.key === group)?.mission : _missionFor(entry);
    const label = STORE.view === 'timeline' || STORE.group === 'mission' ? (mission?.titre || 'Interlude') : STORE.group === 'month' ? _achMonthLabel(group) : '';
    const separator = group && group !== previousGroup ? `<span class="ach-lb-strip-separator" title="${_esc(label)}"></span>` : '';
    previousGroup = group;
    const category = _achCategoryFor(entry);
    return `${separator}<button class="${entry.id === activeId ? 'active' : ''}" data-action="_achOpenLightbox" data-id="${_esc(entry.id)}" data-stop-propagation title="${_esc(entry.titre || 'Haut-Fait')}">${entry.imageUrl ? `<img src="${_esc(entry.imageUrl)}" alt="" loading="lazy" decoding="async">` : `<span>${entry.emoji || category.emoji}</span>`}</button>`;
  }).join('');
}

function _achRestoreLightboxTile(id) {
  const card = document.querySelector(`[data-ach-id="${CSS.escape(id || '')}"]`);
  const host = document.getElementById('main-content');
  if (!card || !host) return;
  const cardRect = card.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  if (cardRect.bottom < hostRect.top + 60 || cardRect.top > hostRect.bottom) _achFlashCard(id);
  else {
    card.classList.remove('ach-flash');
    requestAnimationFrame(() => card.classList.add('ach-flash'));
    setTimeout(() => card.classList.remove('ach-flash'), 1800);
  }
}

function _achOpenLightbox(itemId) {
  const item = (STORE.lightboxItems || {})[itemId] || (STORE.items || []).find(a => a.id === itemId);
  if (!item || (!STATE.isAdmin && item.secret)) return;
  const cat       = _achCategoryFor(item);
  const CHAR_COLS = ['#4f8cff','#22c38e','#e8b84b','#ff6b6b','#b47fff','#f59e0b'];
  const chars     = sortCharactersForDisplay(STATE.characters || []);
  const contribs  = [...new Set(item.contributeurs || [])].map(id => chars.find(c => c.id === id)).filter(Boolean);
  const navItems = _achLightboxSequence();
  const navIndex = navItems.findIndex(a => a.id === item.id);
  const prevItem = navIndex > 0 ? navItems[navIndex - 1] : null;
  const nextItem = navIndex >= 0 && navIndex < navItems.length - 1 ? navItems[navIndex + 1] : null;

  const existing = document.getElementById('ach-lightbox');
  if (!existing) _achLightboxReturnId = itemId;
  if (existing) {
    existing.dispatchEvent(new Event('ach-lb-teardown'));
    existing.remove();
  }
  _achClearLightboxKeyHandler();

  const contribsHtml = contribs.length ? `
    <section class="ach-lb-contrib-section">
      <div class="ach-lb-section-title">Contributeurs</div>
      <div class="ach-lb-contribs">
      ${contribs.map(c => {
        const col = CHAR_COLS[(c.nom?.charCodeAt(0) || 0) % 6];
        return `<span class="ach-lb-contrib" style="--c:${col}">
          ${characterAvatarHtml(c, { className: 'ach-lb-contrib-av', border: `1px solid ${col}`, background: `${col}22`, color: col })}
          ${_esc(c.nom || '?')}
        </span>`;
      }).join('')}
      </div>
    </section>` : '';

  const dateDisplay = _formatDateFr(item.date);
  const secretHtml = STATE.isAdmin && item.secret ? `<span class="ach-lb-pill ach-lb-pill--secret">Secret MJ</span>` : '';
  const mission = _missionFor(item);
  const adminTools = STATE.isAdmin ? `<div class="ach-lb-admin">
    <button type="button" data-action="_achEditFromLightbox" data-id="${_esc(item.id)}"><span aria-hidden="true">✎</span> Modifier</button>
    <button type="button" class="${item.featured ? 'active' : ''}" data-action="_achToggleFeatured" data-id="${_esc(item.id)}"><span aria-hidden="true">☆</span> ${item.featured ? 'Retirer de la une' : 'Mettre à la une'}</button>
    <button type="button" class="is-danger" data-action="_achDeleteFromLightbox" data-id="${_esc(item.id)}" aria-label="Supprimer" title="Supprimer"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M6 4V2.8h4V4m2 0-.6 9H4.6L4 4m2.4 2.2v4.5m3.2-4.5v4.5"/></svg></button>
  </div>` : '';
  const overlay = document.createElement('div');
  overlay.id = 'ach-lightbox';
  overlay.className = `ach-lightbox-rich${_achSlideshowTimer ? ' is-slideshow' : ''}`;
  overlay.dataset.itemId = item.id;
  const crumbArt = mission?.imageUrl
    ? `<span class="ach-lb-crumb-art"><img src="${_esc(mission.imageUrl)}" alt=""></span>`
    : `<span class="ach-lb-crumb-art">${_esc(item.emoji || cat.emoji)}</span>`;
  overlay.innerHTML = `
    <header class="ach-lb-top">
      <div class="ach-lb-crumb">${crumbArt}<span><small>${_esc(mission?.acte || 'Galerie')}</small><b>${_esc(mission?.titre || 'Hauts-Faits')}</b></span></div>
      <strong class="ach-lb-position">${navIndex + 1} / ${navItems.length}</strong>
      <span class="ach-lb-spacer"></span>
      <button class="ach-lb-slideshow${_achSlideshowTimer ? ' active' : ''}" data-action="_achToggleSlideshow" data-stop-propagation>▶ <span>Diaporama</span></button>
      <button class="ach-lb-close" type="button" aria-label="Fermer" title="Fermer (Échap)">×</button>
    </header>
    <div class="ach-lb-frame" style="--c:${cat.color};--c-glow:${cat.glow};--c-line:${cat.line}">
      <div class="ach-lb-media${item.imageUrl ? '' : ' is-empty'}">
        ${item.imageUrl
          ? `<img class="ach-lb-image-rich" src="${_esc(item.imageUrl)}" alt="${_esc(item.nom || item.titre || '')}" decoding="async" data-ach-zoom title="Cliquer pour zoomer">`
          : `<div class="ach-lb-empty-rich">${item.emoji || cat.emoji}</div>`}
      </div>
      <aside class="ach-lb-info${item.imageUrl ? '' : ' is-empty'}">
        <div class="ach-lb-cat" style="background:${cat.glow};border-color:${cat.line};color:${cat.color}">${cat.emoji} ${cat.label}</div>
        <div class="ach-lb-title">${_esc(item.titre || 'Haut-Fait')}</div>
        <div class="ach-lb-meta-line">${dateDisplay ? `<span class="ach-lb-date">${_esc(dateDisplay)}</span>` : ''}${secretHtml}</div>
        ${item.description ? `<div class="ach-lb-desc">${_esc(item.description)}</div>` : ''}
        ${_achLightboxContextHtml(item)}
        ${contribsHtml || '<div class="ach-lb-muted">Aucun contributeur renseigné.</div>'}
        ${_achLightboxRelatedHtml(item)}
        ${adminTools}
      </aside>
    </div>
    ${prevItem ? `<button class="ach-lb-nav ach-lb-nav--prev" type="button" data-action="_achOpenLightbox" data-id="${_esc(prevItem.id)}" data-stop-propagation title="${_esc(prevItem.titre || 'Haut-fait precedent')}">&lsaquo;</button>` : ''}
    ${nextItem ? `<button class="ach-lb-nav ach-lb-nav--next" type="button" data-action="_achOpenLightbox" data-id="${_esc(nextItem.id)}" data-stop-propagation title="${_esc(nextItem.titre || 'Haut-fait suivant')}">&rsaquo;</button>` : ''}
    <div class="ach-lb-strip" role="list">${_achLightboxStripHtml(navItems, item.id)}</div>
    ${navItems.length > 1 && navIndex >= 0 ? `<div class="ach-lb-progress">${navIndex + 1}<span>/</span>${navItems.length}</div>` : ''}
    <div class="ach-lb-slideshow-progress" aria-hidden="true"><span></span></div>
  `;

  let swipeStart = null;
  overlay.addEventListener('touchstart', event => {
    if (event.touches.length !== 1 || event.target?.closest?.('button, a, input, textarea, select, .ach-lb-media.is-zoomed')) {
      swipeStart = null;
      return;
    }
    const touch = event.touches[0];
    swipeStart = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  overlay.addEventListener('touchend', event => {
    if (!swipeStart || event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    const direction = resolveHorizontalSwipe({
      startX: swipeStart.x,
      startY: swipeStart.y,
      endX: touch.clientX,
      endY: touch.clientY,
    });
    swipeStart = null;
    const target = direction === 'next' ? nextItem : direction === 'previous' ? prevItem : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    _achOpenLightbox(target.id);
  }, { passive: false });
  overlay.addEventListener('touchcancel', () => { swipeStart = null; }, { passive: true });

  const close = () => {
    if (_achSlideshowTimer) { clearTimeout(_achSlideshowTimer); _achSlideshowTimer = null; }
    _achClearLightboxKeyHandler();
    overlay.dispatchEvent(new Event('ach-lb-teardown'));
    overlay.style.opacity = '0';
    const returnId = overlay.dataset.itemId || _achLightboxReturnId;
    setTimeout(() => {
      overlay.remove();
      _achRestoreLightboxTile(returnId);
      _achLightboxReturnId = '';
    }, 160);
  };
  // Les actions de la fiche sont déléguées au document via `data-action`.
  // Ne jamais bloquer leur propagation : seule la zone noire de fond ferme la
  // visionneuse. L'ancien stopPropagation posé sur tout le cadre rendait les
  // boutons Modifier, Supprimer et les raccourcis de mission inopérants.
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });
  const mediaEl = overlay.querySelector('.ach-lb-media');
  const mediaImg = overlay.querySelector('.ach-lb-image-rich');
  // ── Déplacement (pan) à la souris quand l'image est zoomée ──
  // Maintenir le clic gauche et glisser fait défiler la zone visible ; un clic
  // simple (sans glisser) dézoome. Le tactile garde le scroll natif + swipe.
  const PAN_THRESHOLD = 4; // px avant de considérer que c'est un glissement, pas un clic
  let _panActive = false, _panMoved = false, _panX = 0, _panY = 0, _panL = 0, _panT = 0;
  if (mediaImg && mediaEl) {
    mediaImg.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch') return;          // tactile : scroll natif
      if (event.button !== 0) return;                      // clic gauche uniquement
      if (!mediaEl.classList.contains('is-zoomed')) return; // pan seulement en zoomé
      _panActive = true; _panMoved = false;
      _panX = event.clientX; _panY = event.clientY;
      _panL = mediaEl.scrollLeft; _panT = mediaEl.scrollTop;
      mediaImg.setPointerCapture?.(event.pointerId);
      mediaEl.classList.add('is-panning');
      event.preventDefault();
    });
    mediaImg.addEventListener('pointermove', event => {
      if (!_panActive) return;
      const dx = event.clientX - _panX, dy = event.clientY - _panY;
      if (Math.abs(dx) > PAN_THRESHOLD || Math.abs(dy) > PAN_THRESHOLD) _panMoved = true;
      mediaEl.scrollLeft = _panL - dx;
      mediaEl.scrollTop  = _panT - dy;
    });
    const _endPan = event => {
      if (!_panActive) return;
      _panActive = false;
      mediaEl.classList.remove('is-panning');
      mediaImg.releasePointerCapture?.(event.pointerId);
    };
    mediaImg.addEventListener('pointerup', _endPan);
    mediaImg.addEventListener('pointercancel', _endPan);
  }
  mediaImg?.addEventListener('click', event => {
    event.stopPropagation();
    if (!mediaEl) return;
    // Un glissement (pan) vient de se terminer → ne pas dézoomer.
    if (_panMoved) { _panMoved = false; return; }

    const zoomed = mediaEl.classList.toggle('is-zoomed');
    mediaImg.title = zoomed ? 'Cliquer pour dézoomer' : 'Cliquer pour zoomer';
    if (!zoomed) {
      mediaImg.style.removeProperty('width');
      mediaImg.style.removeProperty('height');
      mediaEl.scrollTo({ left: 0, top: 0 });
      return;
    }

    const bounds = mediaEl.getBoundingClientRect();
    const imageRatio = mediaImg.naturalWidth / mediaImg.naturalHeight || 1;
    const frameRatio = bounds.width / bounds.height || 1;
    const fittedWidth = imageRatio >= frameRatio ? bounds.width : bounds.height * imageRatio;
    const fittedHeight = imageRatio >= frameRatio ? bounds.width / imageRatio : bounds.height;
    const zoomFactor = 2;
    const focusX = bounds.width ? (event.clientX - bounds.left) / bounds.width : .5;
    const focusY = bounds.height ? (event.clientY - bounds.top) / bounds.height : .5;

    mediaImg.style.width = `${Math.round(fittedWidth * zoomFactor)}px`;
    mediaImg.style.height = `${Math.round(fittedHeight * zoomFactor)}px`;
    requestAnimationFrame(() => {
      mediaEl.scrollLeft = Math.max(0, focusX * mediaImg.scrollWidth - bounds.width / 2);
      mediaEl.scrollTop = Math.max(0, focusY * mediaImg.scrollHeight - bounds.height / 2);
    });
  });
  overlay.querySelector('.ach-lb-close').addEventListener('click', e => { e.stopPropagation(); close(); });
  overlay.querySelectorAll('.ach-lb-nav').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    _achOpenLightbox(btn.dataset.id);
  }));
  _achLightboxKeyHandler = (e) => {
    if (e.key === 'Escape') return close();
    if (e.key === ' ') { e.preventDefault(); _achToggleSlideshow(); return; }
    if (e.key === 'ArrowLeft' && prevItem) {
      e.preventDefault();
      _achOpenLightbox(prevItem.id);
    }
    if (e.key === 'ArrowRight' && nextItem) {
      e.preventDefault();
      _achOpenLightbox(nextItem.id);
    }
  };
  document.addEventListener('keydown', _achLightboxKeyHandler);
  document.body.appendChild(overlay);
  if (_achSlideshowTimer) _achScheduleSlideshow();
  requestAnimationFrame(() => overlay.querySelector('.ach-lb-strip button.active')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
}

let _achCatalogUsage = [];

async function _loadAchievementCategoryUsage(categories, defaultId) {
  const [publicItems, secretItems] = await Promise.all([
    loadCollection('achievements'),
    loadCollection('achievements_secret').catch(() => []),
  ]);
  STORE.publicItems = publicItems || [];
  STORE.secretItems = secretItems || [];
  STORE.items = _composeItems();
  _achCatalogUsage = [
    ...STORE.publicItems.map(item => ({ item, col: 'achievements', effectiveId: item.categorie || defaultId })),
    ...STORE.secretItems.map(item => ({ item, col: 'achievements_secret', effectiveId: item.categorie || defaultId })),
  ];
  const counts = Object.fromEntries(categories.map(category => [category.id, 0]));
  _achCatalogUsage.forEach(({ effectiveId }) => { if (effectiveId in counts) counts[effectiveId] += 1; });
  return counts;
}

async function _reassignAchievementCategories(changes) {
  const affected = _achCatalogUsage
    .map(entry => ({ entry, to: catalogReplacementFor(entry.effectiveId, changes) }))
    .filter(change => change.to);
  const updates = affected.map(({ entry, to }) => ({ col: entry.col, id: entry.item.id, data: { categorie: to } }));
  for (let index = 0; index < updates.length; index += 450) await batchUpdateInCol(updates.slice(index, index + 450));
  affected.forEach(({ entry, to }) => {
    entry.item.categorie = to;
    entry.effectiveId = to;
  });
  STORE.items = _composeItems();
  STORE.filter = catalogReplacementFor(STORE.filter, changes) || STORE.filter;
}

export async function openAchievementCategoriesAdmin() {
  if (!STATE.isAdmin) return;
  await _loadAchievementCategories();
  return openCatalogAdmin({
    kind: 'achievements', icon: '🏆', accent: '#e8b84b',
    title: 'Catégories de hauts-faits',
    sub: 'Galerie, filtres et création des hauts-faits de cette aventure.',
    noun: ['catégorie', 'catégories'], fem: true,
    item: ['haut-fait', 'hauts-faits'], itemFem: false, all: 'Tous',
    emoji: true, plural: false, idPrefix: 'categorie_',
    defaultNote: 'La première catégorie est proposée par défaut à la création d’un haut-fait.',
    palette: ACH_CAT_PALETTE,
    emojis: ['⚔️','🎭','📖','🏆','👑','💀','🐉','🗺️','🍺','💰','🎲','🔥','❤️','🧙','🏰','⭐','🗡️','🛡️','🌙','🎉','😂','🤝','🧩','📜'],
    load: () => ACH_CATS,
    count: _loadAchievementCategoryUsage,
    setColor: (category, color) => { category.glow = `${color}29`; category.line = `${color}59`; },
    save: _saveAchievementCategories,
    reassign: _reassignAchievementCategories,
    sample: () => {
      const item = STORE.items[0] || {};
      return { title: item.titre || item.title || 'Le pont de Khazad-Bur', subtitle: item.description || 'Un exploit digne de rester dans les mémoires.', meta: item.date || 'Chronique de l’aventure' };
    },
    afterSave: async () => { if (document.getElementById('ach-content')) await _achRenderContentPreserveViewport({ force: true }); },
    onError: notifySaveError,
  });
}
// Ouverture de la lightbox depuis un autre module (ex. fiche mission de la Trame).
// Charge les hauts-faits si nécessaire (collection session-live → 0 lecture en plus).
export async function openAchievementLightbox(id) {
  if (!STORE.missions || !STORE.missions.length) {
    STORE.missions = await loadCollection('story').catch(() => []);
  }
  if (!STORE.items || !STORE.items.length) {
    try {
      STORE.publicItems = await loadCollection('achievements');
      if (STATE.isAdmin) STORE.secretItems = await loadCollection('achievements_secret').catch(() => []);
      STORE.items = _composeItems();
    } catch {}
  }
  _achOpenLightbox(id);
}

// ── OVERRIDE PAGES.ACHIEVEMENTS ───────────────────────────────────────────────
const _origPage = PAGES.achievements.bind(PAGES);
PAGES.achievements = async function() {
  _achDisconnectGalleryResize();
  _achRenderedContentEl=null;
  _achLastRenderSignature='';
  _achBulkMode = false;
  _achBulkSelected.clear();
  _achRestorePreferences();
  const routeView = getRouteSub('achievements');
  if (['galerie', 'timeline', 'missions'].includes(routeView)) STORE.view = routeView;
  let [items, order, story] = await Promise.all([
    loadCollection('achievements'),
    _loadOrder(),
    loadCollection('story').catch(() => []),
    _loadAchievementCategories(),
  ]);

  // Hauts-faits secrets : chargés (MJ uniquement) depuis la sous-collection MJ-only.
  // Migration douce idempotente : tout HF encore marqué secret dans la collection
  // publique est déplacé vers `achievements_secret` (copy-then-delete, ré-exécutable).
  STORE.secretItems = [];
  if (STATE.isAdmin) {
    STORE.secretItems = await loadCollection('achievements_secret').catch(() => []);
    const strays = (items || []).filter(a => a.secret === true);
    if (strays.length) {
      for (const a of strays) {
        const { id: _omit, ...data } = a;
        try {
          await saveDoc('achievements_secret', a.id, data);
          await deleteFromCol('achievements', a.id);
        } catch (e) { console.warn('[ach] migration secret', a.id, e); }
      }
      items = await loadCollection('achievements').catch(() => (items || []).filter(a => a.secret !== true));
      STORE.secretItems = await loadCollection('achievements_secret').catch(() => STORE.secretItems);
    }
  }

  STORE.order       = order;
  STORE.publicItems = items || [];
  STORE.items       = _composeItems();
  STORE.missions    = (story || []).filter(item => item.type === 'mission' || item.type === 'event');
  STORE.filter ??= 'all';
  if (!Array.isArray(STORE.charFilters)) STORE.charFilters = STORE.charFilter && STORE.charFilter !== 'all' ? [STORE.charFilter] : [];
  STORE.charMatchMode = STORE.charMatchMode === 'shared' ? 'shared' : 'any';
  STORE.view = ['galerie', 'timeline', 'missions'].includes(STORE.view) ? STORE.view : 'galerie';
  if (routeView !== STORE.view) setRouteSub('achievements', STORE.view, { replace: true });
  STORE.search ??= '';
  PAGES._achievementsShellState = { ...getAchievementsShellState(), categories: ACH_CATS };

  await _origPage();    // génère le shell (hero + controls + #ach-content)
  _achSyncBulkToggle();
  _installAchievementKeyboard();
  _achInstallPageImageDrop();
  await _achRenderContent();
  _achPageActive = true;
  _achInstallScrollUi();

  // ── Abonnements temps réel ─────────────────────────────────────────────
  // On évite de re-render pendant un drag SortableJS pour ne pas casser
  // l'instance en cours ; les saves admin re-render explicitement après onEnd.
  // unwatchAll() côté navigation s'occupe du cleanup.
  watchPageCollection('ach-items', 'achievements', 'achievements', items => {
    if (document.body.classList.contains('ach-dragging')) return;
    STORE.publicItems = items || [];
    STORE.items = _composeItems();
    if (!_achLocalMutationDepth) _achRenderContentPreserveViewport();
  });

  watchPageCollection('ach-story', 'story', 'achievements', items => {
    STORE.missions = (items || []).filter(item => item.type === 'mission' || item.type === 'event');
    if (!_achLocalMutationDepth) _achRenderContentPreserveViewport();
  });

  watchPageDoc('ach-order', 'achievements_meta', 'order', 'achievements', doc => {
    if (document.body.classList.contains('ach-dragging')) return;
    STORE.order = Array.isArray(doc?.order) ? doc.order : [];
    STORE.items = _composeItems();
    if (!_achLocalMutationDepth) _achRenderContentPreserveViewport();
  });

  watchPageDoc('ach-categories', 'achievements_meta', 'categories', 'achievements', doc => {
    _setAchievementCategories(doc?.categories);
    PAGES._achievementsShellState = { ...getAchievementsShellState(), categories: ACH_CATS };
    if (!_achLocalMutationDepth) _achRenderContentPreserveViewport();
  });
};

document.addEventListener('app:route-sub-changed', (event) => {
  const { page, sub } = event.detail || {};
  if (page !== 'achievements' || !document.getElementById('ach-content')) return;
  if (!['galerie', 'timeline', 'missions'].includes(sub)) return;
  event.preventDefault();
  _achSetView(sub, { syncRoute: false });
});

document.addEventListener('app:page-changed', (event) => {
  const page = event.detail?.page || event.detail?.to || '';
  if (_achPageActive && page && page !== 'achievements') {
    STORE.lastSeen = new Date().toISOString();
    _achSavePreferences();
    _achPageActive = false;
    _achRenderEpoch += 1;
    if (_achScrollRaf) cancelAnimationFrame(_achScrollRaf);
    _achScrollRaf = 0;
    if (_achScrollIdleTimer) clearTimeout(_achScrollIdleTimer);
    _achScrollIdleTimer = null;
    if (_achScrollHandler) _achScrollTargets.forEach(target => target?.removeEventListener?.('scroll', _achScrollHandler));
    if (_achScrollHandler) document.removeEventListener('scroll', _achScrollHandler, true);
    _achScrollTargets = [];
    _achScrollObserver?.disconnect();
    _achScrollObserver = null;
    _achRailCleanup?.();
    _achRailCleanup = null;
    _achDisposeChronicle();
    _achImageWarmCleanup?.();
    _achImageWarmCleanup = null;
    _achScrollHost = null;
    _achScrollHandler = null;
  }
});

registerActions({
  _achToggleBulkMode:    ()    => _achToggleBulkMode(),
  _achToggleBulkSelection: (btn) => _achToggleBulkSelection(btn.dataset.id),
  _achBulkSelectFiltered:()    => _achBulkSelectFiltered(),
  _achBulkClear:         ()    => _achBulkClear(),
  _achBulkFeatured:      ()    => _achBulkFeatured(),
  _achBulkCategory:      (el)  => _achApplyBulkCategory(el.value),
  _achSetSearch:         (el)  => _achSetSearch(el.value),
  _achFilterMissionOptions: (el) => _achFilterMissionOptions(el.value, el),
  _achSetFilter:         (btn) => _achSetFilter(btn.dataset.val),
  _achSetMissionFilter:  (btn) => _achSetMissionFilter(btn.dataset.missionId),
  _achSetView:           (btn) => _achSetView(btn.dataset.val),
  _achSetGroup:          (btn) => _achSetGroup(btn.dataset.achGroup),
  _achSetDensity:        (btn) => _achSetDensity(btn.dataset.achDensity),
  _achSetGalleryOrder:   (btn) => _achSetGalleryOrder(btn.dataset.achOrder),
  _achToggleFeatured:    (btn) => _achToggleFeatured(btn.dataset.id),
  _achShowNew:           (btn) => _achFlashCard(btn.dataset.id),
  _achMarkSeen:          () => _achMarkSeen(),
  _achRailJump:          (btn) => _achFlashCard(btn.dataset.id),
  _achRemoveMiniFilter:  (btn) => _achRemoveMiniFilter(btn.dataset.filterKind),
  _achMiniCrumb:         (btn) => _achMiniCrumb(btn.dataset.session || btn.dataset.id),
  _achScrollTop:         () => _achScrollTop(),
  _achToggleSlideshow:   () => _achToggleSlideshow(),
  _achRestartSlideshow:  () => _achRestartSlideshow(),
  _achSkipSeriesImage:   () => _achSkipSeriesImage(),
  _achReplaceImage:      () => _achReplaceImage(),
  _achRemoveImage:       () => _achRemoveImage(),
  _achAddSuggestedContributors: (btn) => _achAddSuggestedContributors(btn.dataset.ids),
  _achDeleteFromDrawer:  (btn) => _achDeleteFromDrawer(btn.dataset.id),
  openAchievementModal:  ()    => openAchievementModal(),
  openAchievementCategoriesAdmin: () => openAchievementCategoriesAdmin(),
  _achSelectCat:         (btn) => _achSelectCat(btn.dataset.id),
  _achTogglePick:        ()    => _achTogglePick(),
  _achPickSelect:        (btn) => _achPickSelect(btn.dataset.id || ''),
  _achPickSearch:        (el)  => _achPickSearch(el.value),
  _achFilterContrib:     (el)  => _achFilterContrib(el.value),
  _achToggleContrib:     (btn) => _achToggleContrib(btn.dataset.id),
  saveAchievement:       (btn) => saveAchievement(btn.dataset.id || ''),
  saveAchievementContinue: () => saveAchievement('', { continueEditing: true }),
  editAchievement:       (btn) => editAchievement(btn.dataset.id),
  deleteAchievement:     (btn) => deleteAchievement(btn.dataset.id),
  _achOpenLightbox:      (btn) => _achOpenLightbox(btn.dataset.id),
  _achSetCharFilter:     (btn) => _achSetCharFilter(btn.dataset.charid),
  _achToggleCharFilter:  (btn) => _achToggleCharFilter(btn.dataset.charid),
  _achClearCharFilters:  ()    => _achClearCharFilters(),
  _achSelectMyCharacters:()    => _achSelectMyCharacters(),
  _achSetCharMatchMode:  (btn) => _achSetCharMatchMode(btn.dataset.mode),
  _achToggleTimelineDir: ()    => _achToggleTimelineDir(),
  _achSetChronicleMode:  (btn) => _achSetChronicleMode(btn.dataset.achChronicleMode),
  _achChronicleAdd:      (btn) => _achChronicleAdd(btn.dataset.key),
  _achResetFilters:      ()    => _achResetFilters(),
  _achFocusMissionGroup: (btn) => _achFocusMissionGroup(btn.dataset.missionId),
  _achCreateForMission:  (btn) => _achCreateForMission(btn.dataset.missionId),
  _achCreateAtTail:      (btn) => _achCreateAtTail(btn.dataset.missionId, btn.dataset.date),
  _achEditFromLightbox:  (btn) => _achEditFromLightbox(btn.dataset.id),
  _achDeleteFromLightbox:(btn) => _achDeleteFromLightbox(btn.dataset.id),
  _achOpenMission:       (btn) => _achOpenMission(btn.dataset.id),
});
