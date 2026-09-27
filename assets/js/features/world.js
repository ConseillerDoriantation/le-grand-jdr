// ══════════════════════════════════════════════════════════════════════════════
// WORLD.JS — Guide (page renommée « Monde » → « Guide » ; id interne `world` conservé)
// ✓ Sections de lore libres (texte riche, image optionnelle)
// ✓ MJ : CRUD sections, réorganisation par drag & drop
// ✓ Joueur : lecture seule, navigation par ancres
// ✓ Firestore : world/main → { sections:[{id,titre,contenu,imageUrl,icone,visible}] }
// ══════════════════════════════════════════════════════════════════════════════
import { getDocData } from '../data/firestore.js';
import { tryDoc } from '../shared/crud.js';
import { openModal, closeModal, confirmModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import { _esc, _nl2br, _norm, _searchIncludes } from '../shared/html.js';
import { lsJson } from '../shared/local-storage.js';
import {
  richTextContentHtml, richTextEditorHtml, bindRichTextEditors, getRichTextHtml,
} from '../shared/rich-text.js';
import { attachDropAndCrop } from '../shared/image-crop.js';
import {
  freePageEditorHtml, bindFreePageEditor, getFreePageData,
  renderFreePageHtml, hasFreePage, freePageToLegacyHtml, compressFreePageImages,
} from '../shared/free-page.js';
import {
  worldPageFor, saveWorldPage, deleteWorldPage, setCachedWorldPage, onWorldPagesChange,
} from '../shared/world-pages.js';
import { STATE } from '../core/state.js';
import { makeSortable } from '../shared/sortable-helper.js';
import PAGES from './pages.js';
import { registerActions } from '../core/actions.js';

// Rétro-compat : le contenu legacy est du texte brut (avec retours ligne) ;
// le nouveau contenu est du HTML rich-text. On détecte la présence d'une balise
// pour décider : texte brut → échappé + <br> ; HTML → tel quel (sanitisé en aval).
// Répare un sur-échappement accumulé : à chaque ancien rendu, un « & » déjà
// échappé était ré-échappé (&amp; → &amp;amp; → …), faisant apparaître "&#39;",
// "&amp;#39;"… On retire ces niveaux en boucle. SÛR : on ne touche un « &amp; »
// QUE s'il précède une autre entité (donc issu d'un sur-échappement) ; un vrai
// « &amp; » (suivi de texte/espace) est laissé intact.
function _collapseOverEscape(s) {
  let prev;
  do {
    prev = s;
    s = s.replace(/&amp;(?=(?:amp;)*(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);)/gi, '&');
  } while (s !== prev);
  return s;
}

function _contentToHtml(raw) {
  let s = String(raw || '');
  if (!s) return '';
  s = _collapseOverEscape(s);  // soigne les contenus déjà corrompus (affichage ET éditeur)
  const hasTag = /<[a-z][\s\S]*?>/i.test(s);
  if (hasTag) return s;

  // Un ancien texte peut contenir des entités HTML sans aucune balise. Il ne
  // faut pas le ré-échapper, mais ses retours à la ligne restent bien du texte
  // et doivent donc devenir des <br> pour être identiques en édition/lecture.
  const hasEntity = /&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(s);
  if (hasEntity) return s.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>');
  return _nl2br(s);
}

// ── État local ────────────────────────────────────────────────────────────────

const STORE = {
  categories: [],   // [{ id, nom, icone, visible }]
  sections:   [],   // [{ id, titre, contenu, imageUrl, icone, visible, categoryId }]
  activeId:   null, // id de la section affichée
};

let _sortables    = [];     // instances SortableJS (une par liste de catégorie)
let _wiCropper    = null;
let _editingContentId = null; // section dont le contenu (diapo) est en édition
let _searchQuery  = '';       // recherche plein texte du bandeau (filtre le sommaire)
let _plainText    = new Map(); // id → texte brut (recherche, temps de lecture) ; vidé à chaque rendu complet
let _tocObserver  = null;     // scroll-spy du plan « Sur cette page »

// Firestore plafonne un doc à 1 048 576 octets. Chaque section a son propre doc
// worldPages/{id} → budget dédié. Marge de sécurité + recompression auto.
const WORLD_PAGE_SAFE_BYTES = 1_000_000;
const _utf8Len = (str) => new TextEncoder().encode(str).length;
async function _fitWorldPage(page) {
  let bytes = _utf8Len(JSON.stringify({ page })), shrunk = false;
  if (bytes <= WORLD_PAGE_SAFE_BYTES) return { page, bytes, fitted: true, shrunk };
  for (const opts of [{ max: 900, quality: .6 }, { max: 720, quality: .5 }, { max: 560, quality: .42 }]) {
    page = await compressFreePageImages(page, opts); shrunk = true;
    bytes = _utf8Len(JSON.stringify({ page }));
    if (bytes <= WORLD_PAGE_SAFE_BYTES) return { page, bytes, fitted: true, shrunk };
  }
  return { page, bytes, fitted: false, shrunk };
}

// Re-render le Guide quand les contenus déportés (worldPages) arrivent — jamais
// pendant une édition (l'éditeur porte l'état non enregistré).
let _worldReactivityBound = false;
function _ensureWorldReactivity() {
  if (_worldReactivityBound) return;
  _worldReactivityBound = true;
  onWorldPagesChange(() => {
    if (_editingContentId) return;
    if (document.getElementById('world-main-content')) { try { renderWorld(); } catch (_) {} }
  });
}

// Texte brut d'une section (deck déporté en priorité, sinon contenu legacy HTML).
function _sectionPlainSource(s) {
  if (_sectionContentMode(s) === 'rich') return s?.contenu || '';
  const deck = worldPageFor(s?.id);
  return hasFreePage(deck) ? freePageToLegacyHtml(deck) : (s?.contenu || '');
}

function _sectionContentMode(s) {
  if (s?.contentMode === 'rich' || s?.contentMode === 'slides') return s.contentMode;
  return hasFreePage(worldPageFor(s?.id)) ? 'slides' : 'rich';
}

// Catégorie par défaut : accueille les sections sans catégorie (legacy / orphelines)
const DEFAULT_CAT = { id: 'general', nom: 'Général', icone: '📖', visible: true };

// ── Icônes disponibles ────────────────────────────────────────────────────────
const ICONES = [
  '📖','🌍','🏔️','🌊','🏙️','🌲','⚔️','🛡️','🔮','💀',
  '👑','⚙️','🌑','☀️','🐉','🗝️','📜','🗺️','🏛️','✨',
];

// ── Chargement ────────────────────────────────────────────────────────────────
async function _load() {
  const doc = await getDocData('world', 'main');
  STORE.categories = Array.isArray(doc?.categories) ? doc.categories.filter(c => c?.id) : [];
  STORE.sections   = (doc?.sections || []).filter(s => s?.id);

  // ── Migration en mémoire (persistée au prochain save admin) ────────────────
  // Garantit au moins une catégorie et rattache toute section orpheline
  // (sans categoryId ou pointant vers une catégorie supprimée) à « Général ».
  const catIds = new Set(STORE.categories.map(c => c.id));
  const hasOrphans = STORE.sections.some(s => !s.categoryId || !catIds.has(s.categoryId));
  if (!STORE.categories.length && (STORE.sections.length || STATE.isAdmin)) {
    STORE.categories = [{ ...DEFAULT_CAT }];
    catIds.add(DEFAULT_CAT.id);
  }
  if (hasOrphans) {
    if (!catIds.has(DEFAULT_CAT.id)) { STORE.categories.unshift({ ...DEFAULT_CAT }); catIds.add(DEFAULT_CAT.id); }
    STORE.sections = STORE.sections.map(s =>
      (s.categoryId && catIds.has(s.categoryId)) ? s : { ...s, categoryId: DEFAULT_CAT.id });
  }

  // Section par défaut si tout est vide (admin only)
  if (!STORE.sections.length && STATE.isAdmin) {
    if (!STORE.categories.length) STORE.categories = [{ ...DEFAULT_CAT }];
    STORE.sections = [{
      id: 'intro', titre: 'Introduction', icone: '📖',
      contenu: 'Le Maître de Jeu partagera ici les informations utiles à la table : règles maison, univers, repères.',
      imageUrl: '', visible: true, categoryId: STORE.categories[0].id,
    }];
  }
}

const _save = () => tryDoc('world', 'main', { categories: STORE.categories, sections: STORE.sections });

function _worldVisibleData() {
  const visibleCats = STORE.categories.filter(c => c.visible !== false || STATE.isAdmin);
  const visibleCatIds = new Set(visibleCats.map(c => c.id));
  const visibleSections = STORE.sections.filter(s =>
    (s.visible !== false && visibleCatIds.has(s.categoryId)) || STATE.isAdmin);
  return { visibleCats, visibleSections };
}

function _worldCategoryFor(section) {
  return STORE.categories.find(c => c.id === section?.categoryId) || DEFAULT_CAT;
}

// Texte brut d'une section, mis en cache le temps d'un rendu. DOMParser = document
// inerte : aucune image chargée ni script exécuté pendant l'extraction.
function _sectionText(s) {
  if (!_plainText.has(s.id)) {
    const doc = new DOMParser().parseFromString(_contentToHtml(_sectionPlainSource(s)), 'text/html');
    _plainText.set(s.id, (doc.body.textContent || '').replace(/\s+/g, ' ').trim());
  }
  return _plainText.get(s.id);
}

function _matchesSearch(s) {
  return !_searchQuery
    || _searchIncludes(s.titre || '', _searchQuery)
    || _searchIncludes(_sectionText(s), _searchQuery);
}

// Extrait autour du terme trouvé dans le contenu (rien si le titre correspond déjà).
function _searchSnippet(s) {
  if (!_searchQuery || _searchIncludes(s.titre || '', _searchQuery)) return '';
  const text = _sectionText(s);
  const hay = _norm(text);
  // Positions alignées seulement si la normalisation conserve la longueur (cas courant).
  const at = hay.length === text.length ? Math.max(0, hay.indexOf(_norm(_searchQuery))) : 0;
  const start = Math.max(0, at - 30);
  const end = Math.min(text.length, start + 90);
  return `${start ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

// Catégories repliées du sommaire : préférence locale, par aventure.
const _collapseKey = () => `jdr-world-collapsed:${STATE.adventure?.id || 'global'}`;
function _collapsedCats() {
  const ids = lsJson.get(_collapseKey(), []);
  return new Set(Array.isArray(ids) ? ids : []);
}
function _setCatCollapsed(catId, collapsed) {
  const ids = _collapsedCats();
  if (collapsed) ids.add(catId); else ids.delete(catId);
  lsJson.set(_collapseKey(), [...ids]);
}

// Sections dans l'ordre du sommaire (catégories, puis sections) → Précédent / Suivant.
function _orderedSections(visibleCats, visibleSections) {
  const ids = new Set(visibleSections.map(s => s.id));
  return visibleCats.flatMap(cat => STORE.sections.filter(s => s.categoryId === cat.id && ids.has(s.id)));
}

function _sectionPosition(s, visibleSections) {
  const siblings = visibleSections.filter(x => x.categoryId === s?.categoryId);
  return { index: siblings.findIndex(x => x.id === s?.id) + 1, total: siblings.length };
}

function _sectionMeta(s) {
  if (_sectionContentMode(s) === 'slides') {
    const deck = worldPageFor(s.id);
    if (!hasFreePage(deck)) return '';
    const n = Array.isArray(deck.slides) ? deck.slides.filter(sl => !sl?.hidden).length : 1;
    return `Diaporama · ${n} diapo${n > 1 ? 's' : ''}`;
  }
  const words = _sectionText(s).split(' ').filter(Boolean).length;
  if (!words) return '';
  const parts = (String(s.contenu || '').match(/<h2[\s>]/gi) || []).length;
  return `≈ ${Math.max(1, Math.round(words / 200))} min de lecture${parts > 1 ? ` · ${parts} parties` : ''}`;
}

function _worldStats(visibleCats, visibleSections) {
  const hidden = STORE.categories.filter(c => c.visible === false).length
    + STORE.sections.filter(s => s.visible === false).length;
  return [
    { label: 'Catégories', value: visibleCats.length },
    { label: 'Sections', value: visibleSections.length },
    ...(STATE.isAdmin && hidden ? [{ label: 'Masquées', value: hidden, cls: ' is-masked' }] : []),
  ];
}

// Icônes au trait (héritent de currentColor). Les emoji restent réservés aux
// icônes choisies par le MJ pour ses catégories / sections.
const _svg = (paths, size = 14) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICO = {
  search:  '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  lock:    '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  plus:    '<path d="M12 5v14M5 12h14"/>',
  pencil:  '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m14 6 4 4"/>',
  trash:   '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  left:    '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  right:   '<path d="M5 12h14M13 6l6 6-6 6"/>',
  up:      '<path d="M12 19V5M6 11l6-6 6 6"/>',
  list:    '<path d="M4 6h16M4 12h16M4 18h10"/>',
};
const GRIP = `<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">${
  [3, 8, 13].map(y => `<circle cx="3" cy="${y}" r="1.3"/><circle cx="7" cy="${y}" r="1.3"/>`).join('')}</svg>`;
const _lockHtml = () => `<span class="world-lock" title="Masquée aux joueurs">${_svg(ICO.lock, 13)}</span>`;

// ── Rendu principal ───────────────────────────────────────────────────────────
async function renderWorld() {
  _ensureWorldReactivity();
  const content = document.getElementById('main-content');
  // Arrivée sur la page (et non re-rendu après une sauvegarde) → recherche remise à zéro.
  if (!document.getElementById('world-main-content')) _searchQuery = '';
  // Le splash pleine page de la navigation reste visible pendant _load (pas de
  // second loader propre — évite le flash splash→spinner, cf. npcs).
  await _load();
  _plainText = new Map();

  // Catégories + section active visibles. Pour un joueur, une section dans une
  // catégorie masquée est elle aussi masquée (cohérence nav ↔ contenu).
  const { visibleCats, visibleSections } = _worldVisibleData();
  if (!STORE.activeId || !visibleSections.find(s => s.id === STORE.activeId)) {
    STORE.activeId = visibleSections[0]?.id || null;
  }
  const activeSection = visibleSections.find(s => s.id === STORE.activeId) || null;
  const activeCat = activeSection ? _worldCategoryFor(activeSection) : null;
  const stats = _worldStats(visibleCats, visibleSections);

  content.innerHTML = `
  <div class="world-shell world-atlas">
    <header class="world-page-top">
      <div class="world-page-top-in">
        <div class="world-page-top-row">
          <div class="world-page-brand">
            <h1>Guide</h1>
            <small id="world-page-context">${_esc(activeCat?.nom || 'Atlas de l’aventure')}</small>
          </div>
          <label class="world-search">
            ${_svg(ICO.search, 15)}
            <input type="search" id="world-search" data-input="worldSearch" value="${_esc(_searchQuery)}"
              placeholder="Rechercher dans le guide…" aria-label="Rechercher dans le guide" autocomplete="off">
          </label>
          <div class="world-page-stats" aria-label="Résumé du Guide">
            ${stats.map(stat => `
              <span class="world-page-stat${stat.cls || ''}"><b>${stat.value}</b> ${_esc(stat.label)}</span>`).join('')}
          </div>
          ${STATE.isAdmin ? `
            <div class="world-page-actions">
              <button type="button" data-action="openWorldSectionModal" class="pill primary">${_svg(ICO.plus, 12)} Nouvelle section</button>
              <button type="button" data-action="openWorldCategoryModal" class="pill">${_svg(ICO.plus, 12)} Catégorie</button>
            </div>` : ''}
        </div>
      </div>
    </header>

    <div class="world-page-body">
      <div class="world-layout" id="world-layout">
        <aside class="world-sidebar">
          <nav class="world-nav-card" id="world-nav-card" aria-label="Sommaire du guide">
            <button type="button" class="world-nav-mobile" id="world-nav-mobile"
              data-action="toggleWorldNavMobile" aria-expanded="false">${_renderMobileNavToggle(activeSection)}</button>
            <div class="world-nav-panel">
              <div class="world-nav-head">
                <div><strong>Sommaire</strong><span id="world-nav-count">${_navCountLabel()}</span></div>
                ${STATE.isAdmin ? `<button type="button" data-action="openWorldCategoryModal" class="world-icon-btn"
                  title="Nouvelle catégorie" aria-label="Nouvelle catégorie">${_svg(ICO.plus, 13)}</button>` : ''}
              </div>
              <div id="world-nav-list" class="world-nav-list">${_renderNavList()}</div>
              ${STATE.isAdmin ? `<div class="world-nav-foot">${GRIP}<span>Glisser-déposer pour réordonner ou changer de catégorie.</span></div>` : ''}
            </div>
          </nav>
        </aside>

        <div class="world-reader">
          <div id="world-main-content">
            ${activeSection ? _renderSection(activeSection, visibleSections) : _renderEmpty()}
          </div>
        </div>

        <aside class="world-toc" id="world-toc" aria-label="Sur cette page" hidden></aside>
      </div>
    </div>
  </div>`;

  _bindNavKeyboard();
  if (STATE.isAdmin) _bindNavDrag();
  _bindWorldContentEditor();
  _refreshWorldToc();
}

// ── Sommaire ──────────────────────────────────────────────────────────────────
function _navCountLabel() {
  const { visibleSections } = _worldVisibleData();
  if (!_searchQuery) return `${visibleSections.length} entrée${visibleSections.length > 1 ? 's' : ''}`;
  const n = visibleSections.filter(_matchesSearch).length;
  return `${n} résultat${n > 1 ? 's' : ''}`;
}

function _renderNavList() {
  const { visibleCats } = _worldVisibleData();
  const collapsed = _collapsedCats();
  const html = visibleCats.map(cat => _renderCategoryGroup(cat, collapsed)).join('');
  if (html) return html;
  return `<div class="world-empty-note">${_searchQuery ? `Aucun résultat pour « ${_esc(_searchQuery)} ».` : 'Aucune catégorie'}</div>`;
}

// ── Groupe catégorie : en-tête repliable + ses sections ──────────────────────
function _renderCategoryGroup(cat, collapsed) {
  const isHidden = cat.visible === false;
  const secs = STORE.sections.filter(s => s.categoryId === cat.id && (s.visible !== false || STATE.isAdmin));
  const shown = _searchQuery ? secs.filter(_matchesSearch) : secs;
  if (_searchQuery && !shown.length) return '';
  // Pendant une recherche, tout est déplié pour montrer les résultats.
  const isCollapsed = !_searchQuery && collapsed.has(cat.id);
  return `<div class="world-cat-group${isHidden ? ' is-hidden' : ''}${isCollapsed ? ' is-collapsed' : ''}" data-cat-id="${_esc(cat.id)}">
    <div class="world-cat-head">
      <button type="button" class="world-cat-toggle" data-action="toggleWorldCategory" data-id="${_esc(cat.id)}"
        aria-expanded="${!isCollapsed}">
        <span class="world-cat-chevron">${_svg(ICO.chevron, 12)}</span>
        <span class="world-cat-icon">${_esc(cat.icone || '📁')}</span>
        <span class="world-cat-name">${_esc(cat.nom || 'Catégorie')}</span>
        ${isHidden ? _lockHtml() : ''}
        <span class="world-cat-count">${shown.length}</span>
      </button>
      ${STATE.isAdmin ? `
      <div class="world-cat-actions">
        <button type="button" data-action="openWorldSectionModal" data-cat-id="${_esc(cat.id)}" data-stop-propagation
          class="world-mini-btn" title="Ajouter une section ici" aria-label="Ajouter une section ici">${_svg(ICO.plus, 12)}</button>
        <button type="button" data-action="openWorldCategoryModal" data-id="${_esc(cat.id)}" data-stop-propagation
          class="world-mini-btn" title="Modifier la catégorie" aria-label="Modifier la catégorie">${_svg(ICO.pencil, 12)}</button>
        <button type="button" data-action="deleteWorldCategory" data-id="${_esc(cat.id)}" data-stop-propagation
          class="world-mini-btn world-mini-btn--danger" title="Supprimer la catégorie" aria-label="Supprimer la catégorie">${_svg(ICO.trash, 12)}</button>
      </div>` : ''}
    </div>
    <div class="world-cat-sections">
      ${shown.map(s => _renderNavItem(s)).join('')}
      ${shown.length === 0 ? `<div class="world-cat-empty">${STATE.isAdmin ? 'Vide — ajoute une section' : '—'}</div>` : ''}
    </div>
  </div>`;
}

// ── Nav item ──────────────────────────────────────────────────────────────────
// <div> (et non <button>) : SortableJS ignore les glisser démarrés sur un bouton.
// L'activation clavier est gérée par _bindNavKeyboard.
function _renderNavItem(s) {
  const isActive = s.id === STORE.activeId;
  const isHidden = s.visible === false;
  const snippet = _searchSnippet(s);
  return `<div
    data-nav-id="${_esc(s.id)}" data-sec-id="${_esc(s.id)}"
    data-action="selectWorldSection" data-id="${_esc(s.id)}" role="button" tabindex="0"${isActive ? ' aria-current="page"' : ''}
    class="world-nav-item${isActive ? ' is-active' : ''}${isHidden ? ' is-hidden' : ''}">
    ${STATE.isAdmin && !_searchQuery ? `<span class="world-nav-grip">${GRIP}</span>` : ''}
    <span class="world-nav-icon">${_esc(s.icone || '📖')}</span>
    <span class="world-nav-text">
      <span class="world-nav-title">${_esc(s.titre || 'Section')}</span>
      ${snippet ? `<small class="world-nav-snippet">${_esc(snippet)}</small>` : ''}
    </span>
    ${isHidden ? _lockHtml() : ''}
    ${STATE.isAdmin ? `
    <div class="world-nav-actions">
      <button type="button" data-action="openWorldSectionModal" data-id="${_esc(s.id)}" data-stop-propagation
        class="world-mini-btn" title="Réglages de la section" aria-label="Réglages de la section">${_svg(ICO.pencil, 12)}</button>
      <button type="button" data-action="deleteWorldSection" data-id="${_esc(s.id)}" data-stop-propagation
        class="world-mini-btn world-mini-btn--danger" title="Supprimer" aria-label="Supprimer la section">${_svg(ICO.trash, 12)}</button>
    </div>` : ''}
  </div>`;
}

function _bindNavKeyboard() {
  document.getElementById('world-nav-list')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = e.target.closest?.('.world-nav-item');
    if (!item || e.target !== item) return;   // les boutons internes gèrent leur propre activation
    e.preventDefault();
    selectWorldSection(item.dataset.id);
  });
}

// Barre mobile « où je suis » : replie le sommaire au-dessus du lecteur.
function _renderMobileNavToggle(section) {
  const { visibleSections } = _worldVisibleData();
  const pos = section ? _sectionPosition(section, visibleSections) : null;
  return `<span class="world-nav-mobile-icon">${_svg(ICO.list, 16)}</span>
    <span class="world-nav-mobile-text">
      <small>Sommaire${section ? ` · ${_esc(_worldCategoryFor(section)?.nom || 'Catégorie')}` : ''}</small>
      <strong>${section ? `${_esc(section.icone || '📖')} ${_esc(section.titre || 'Section')}` : _navCountLabel()}</strong>
    </span>
    ${pos?.index ? `<span class="world-nav-mobile-pos">${pos.index}/${pos.total}</span>` : ''}
    <span class="world-nav-mobile-chevron">${_svg(ICO.chevron, 16)}</span>`;
}

function _setMobileNavOpen(open) {
  document.getElementById('world-nav-card')?.classList.toggle('is-open', open);
  document.getElementById('world-nav-mobile')?.setAttribute('aria-expanded', String(open));
}

function toggleWorldNavMobile() {
  _setMobileNavOpen(!document.getElementById('world-nav-card')?.classList.contains('is-open'));
}

function toggleWorldCategory(btn) {
  const group = btn.closest('.world-cat-group');
  if (!group) return;
  const collapsed = !group.classList.contains('is-collapsed');
  group.classList.toggle('is-collapsed', collapsed);
  btn.setAttribute('aria-expanded', String(!collapsed));
  _setCatCollapsed(group.dataset.catId, collapsed);
}

// Déplie la catégorie d'une section atteinte autrement que par le sommaire (Précédent / Suivant).
function _expandCategoryOf(section) {
  const group = document.querySelector(`.world-cat-group[data-cat-id="${CSS.escape(section.categoryId || '')}"]`);
  if (!group?.classList.contains('is-collapsed')) return;
  group.classList.remove('is-collapsed');
  group.querySelector('.world-cat-toggle')?.setAttribute('aria-expanded', 'true');
  _setCatCollapsed(section.categoryId, false);
}

// Recherche plein texte : ne re-rend que la liste (le champ garde le focus).
function worldSearch(input) {
  _searchQuery = String(input?.value || '').trim();
  const list = document.getElementById('world-nav-list');
  if (!list) return;
  list.innerHTML = _renderNavList();
  const count = document.getElementById('world-nav-count');
  if (count) count.textContent = _navCountLabel();
  if (STATE.isAdmin) _bindNavDrag();
  if (_searchQuery) _setMobileNavOpen(true);
}

// ── Contenu d'une section ─────────────────────────────────────────────────────
function _renderSection(s, visibleSections = null) {
  const isHidden = s.visible === false;
  const cat = _worldCategoryFor(s);
  const sections = visibleSections || _worldVisibleData().visibleSections;
  const pos = _sectionPosition(s, sections);
  const editing = _editingContentId === s.id;
  const slides = _sectionContentMode(s) === 'slides';
  const meta = _sectionMeta(s);
  return `<article class="world-section-panel${isHidden ? ' is-hidden' : ''}${s.imageUrl ? ' has-cover' : ''}">
    ${s.imageUrl ? `
      <div class="world-section-cover">
        <img src="${_esc(s.imageUrl)}" alt="">
      </div>` : ''}

    <header class="world-sec-head">
      <div class="world-sec-headrow">
        <div class="world-section-titleblock">
          <div class="world-section-crumb">
            <span class="world-crumb-chip">${_esc(cat?.icone || '📁')} ${_esc(cat?.nom || 'Catégorie')}</span>
            ${pos.total > 1 ? `<span>Section ${pos.index} sur ${pos.total}</span>` : ''}
          </div>
          <div class="world-section-titleline">
            <span class="world-section-icon">${_esc(s.icone || '📖')}</span>
            <h1>${_esc(s.titre || 'Section')}</h1>
          </div>
          ${meta ? `<div class="world-section-meta">${_esc(meta)}</div>` : ''}
          ${isHidden ? `<span class="world-hidden-badge">${_svg(ICO.lock, 12)} Masquée aux joueurs</span>` : ''}
        </div>
        ${STATE.isAdmin && !editing ? `
        <div class="world-section-actions">
          <button type="button" data-action="worldEditContent" data-id="${_esc(s.id)}"
            class="pill primary">${_svg(ICO.pencil, 13)} ${slides ? 'Modifier le diaporama' : 'Modifier le texte'}</button>
          <button type="button" data-action="openWorldSectionModal" data-id="${_esc(s.id)}"
            class="pill">${_svg(ICO.sliders, 13)} Réglages</button>
          <button type="button" data-action="deleteWorldSection" data-id="${_esc(s.id)}"
            class="pill world-pill-icon world-pill-danger" title="Supprimer la section" aria-label="Supprimer la section">${_svg(ICO.trash, 14)}</button>
        </div>` : ''}
      </div>
    </header>

    ${!editing && !slides ? `<nav class="world-toc-chips" id="world-toc-chips" aria-label="Sur cette page" hidden></nav>` : ''}

    <div class="world-sec-body${slides ? ' is-slides' : ''}">
      ${_renderSectionBody(s)}
    </div>

    ${editing ? '' : _renderSectionPager(s, sections)}
  </article>`;
}

// Corps d'une section : éditeur diapo (admin en édition), sinon deck déporté, sinon
// contenu legacy HTML (rich-text), sinon état vide.
function _renderSectionBody(s) {
  if (_editingContentId === s.id && STATE.isAdmin) return _renderContentEditor(s);
  if (_sectionContentMode(s) === 'rich') {
    if (s.contenu) return richTextContentHtml({ html: _contentToHtml(s.contenu), className: 'world-section-content', attrs: {} });
    return `<div class="world-empty-copy">Aucun contenu.${STATE.isAdmin ? ' <span>Utilise « Modifier le texte » pour rédiger cette section.</span>' : ''}</div>`;
  }
  const deck = worldPageFor(s.id);
  if (hasFreePage(deck)) return renderFreePageHtml({ page: deck, className: 'world-free-page' });
  return `<div class="world-empty-copy">Aucun contenu.${STATE.isAdmin ? ' <span>Utilise « Modifier le diaporama » pour composer cette section.</span>' : ''}</div>`;
}

function _renderContentEditor(s) {
  if (_sectionContentMode(s) === 'rich') {
    return `<div class="world-content-editor world-content-editor--rich">
      ${richTextEditorHtml({
        id: `world-rich-${s.id}`,
        html: _contentToHtml(s.contenu || ''),
        placeholder: 'Rédige le contenu de cette section…',
        minHeight: 360,
      })}
      <div class="world-content-editor-bar">
        <button type="button" class="pill" data-action="worldCancelContent">Annuler</button>
        <button type="button" class="pill primary" data-action="worldSaveContent" data-id="${_esc(s.id)}">Enregistrer le texte</button>
      </div>
    </div>`;
  }
  const deck = worldPageFor(s.id);
  return `<div class="world-content-editor">
    ${freePageEditorHtml({ id: `world-page-${s.id}`, page: deck })}
    <div class="world-content-editor-bar">
      <button type="button" class="pill" data-action="worldCancelContent">Annuler</button>
      <button type="button" class="pill primary" data-action="worldSaveContent" data-id="${_esc(s.id)}">Enregistrer le contenu</button>
    </div>
  </div>`;
}

// Monte l'éditeur free-page fraîchement injecté dans le lecteur (si édition).
function _bindWorldContentEditor() {
  if (!_editingContentId) return;
  const host = document.getElementById('world-main-content');
  if (!host) return;
  const section = STORE.sections.find(s => s.id === _editingContentId);
  if (_sectionContentMode(section) === 'rich') bindRichTextEditors(host);
  else bindFreePageEditor(host);
}

function _renderSectionPager(s, visibleSections) {
  const ordered = _orderedSections(_worldVisibleData().visibleCats, visibleSections);
  const i = ordered.findIndex(x => x.id === s.id);
  if (i < 0) return '';
  const link = (sec, dir) => `
    <button type="button" class="world-pager-link is-${dir}" data-action="worldGoSection" data-id="${_esc(sec.id)}">
      ${dir === 'prev' ? _svg(ICO.left, 18) : ''}
      <span>
        <small>${dir === 'prev' ? 'Précédent' : 'Suivant'}</small>
        <strong>${_esc(sec.icone || '📖')} ${_esc(sec.titre || 'Section')}</strong>
      </span>
      ${dir === 'next' ? _svg(ICO.right, 18) : ''}
    </button>`;
  const prev = ordered[i - 1];
  const next = ordered[i + 1];
  if (!prev && !next) return '';
  return `<nav class="world-pager" aria-label="Navigation entre sections">
    ${prev ? link(prev, 'prev') : ''}${next ? link(next, 'next') : ''}
  </nav>`;
}

function _renderEmpty() {
  return `<div class="world-empty-state">
    <div>📖</div>
    <p>
      ${STATE.isAdmin ? 'Aucune section. Crée la première pour partager règles maison et univers.' : 'Aucun contenu disponible pour l\'instant.'}
    </p>
    ${STATE.isAdmin ? `<button type="button" data-action="openWorldSectionModal" class="pill primary">${_svg(ICO.plus, 12)} Créer la première section</button>` : ''}
  </div>`;
}

// ── Plan « Sur cette page » (texte enrichi, ≥ 2 titres) ──────────────────────
// Rail à droite sur grand écran, puces sous l'en-tête sinon (bascule en CSS).
function _refreshWorldToc() {
  _tocObserver?.disconnect();
  _tocObserver = null;
  const toc = document.getElementById('world-toc');
  const chips = document.getElementById('world-toc-chips');
  const content = document.querySelector('#world-main-content .world-section-content');
  const heads = content ? [...content.querySelectorAll('h2, h3')].filter(h => h.textContent.trim()) : [];
  const show = heads.length >= 2;
  document.getElementById('world-layout')?.classList.toggle('has-toc', show);
  if (toc) { toc.hidden = !show; if (!show) toc.innerHTML = ''; }
  if (chips) chips.hidden = !show;
  if (!show) return;

  heads.forEach((h, i) => { h.id = `world-h-${i}`; });
  const link = (h, cls) => `<button type="button" class="${cls}${h.tagName === 'H3' ? ' is-sub' : ''}"
    data-action="worldScrollTo" data-id="${h.id}">${_esc(h.textContent.trim())}</button>`;
  if (toc) toc.innerHTML = `
    <span class="world-toc-label">Sur cette page</span>
    <div class="world-toc-list">${heads.map(h => link(h, 'world-toc-link')).join('')}</div>
    <button type="button" class="world-toc-top" data-action="worldScrollTo" data-id="world-main-content">${_svg(ICO.up, 12)} Haut de page</button>`;
  // Puces : titres H2 seulement (les H3 alourdiraient la rangée), sauf s'il n'y en a aucun.
  const chipHeads = heads.some(h => h.tagName === 'H2') ? heads.filter(h => h.tagName === 'H2') : heads;
  if (chips) chips.innerHTML = chipHeads.map(h => link(h, 'world-toc-chip')).join('');

  const setActive = (id) => document.querySelectorAll('.world-toc-link, .world-toc-chip')
    .forEach(el => el.classList.toggle('is-active', el.dataset.id === id));
  setActive(heads[0].id);
  if (!('IntersectionObserver' in window)) return;
  _tocObserver = new IntersectionObserver((entries) => {
    const hit = entries.filter(e => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (hit) setActive(hit.target.id);
  }, { rootMargin: '0px 0px -65% 0px' });
  heads.forEach(h => _tocObserver.observe(h));
}

function worldScrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Sélection section ─────────────────────────────────────────────────────────
function _renderReader(section) {
  const main = document.getElementById('world-main-content');
  if (!main || !section) return;
  main.innerHTML = _renderSection(section);
  _bindWorldContentEditor();
  _refreshWorldToc();
}

function selectWorldSection(id) {
  const section = STORE.sections.find(s => s.id === id);
  if (!section) return;
  _editingContentId = null;   // naviguer quitte l'éditeur de contenu
  STORE.activeId = id;
  document.querySelectorAll('[data-nav-id]').forEach(el => {
    const on = el.dataset.navId === id;
    el.classList.toggle('is-active', on);
    if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
  _expandCategoryOf(section);
  const ctx = document.getElementById('world-page-context');
  if (ctx) ctx.textContent = _worldCategoryFor(section)?.nom || 'Atlas de l’aventure';
  const mobile = document.getElementById('world-nav-mobile');
  if (mobile) mobile.innerHTML = _renderMobileNavToggle(section);
  _setMobileNavOpen(false);
  _renderReader(section);
}

// Précédent / Suivant : même sélection, puis retour en haut du lecteur.
function worldGoSection(id) {
  selectWorldSection(id);
  worldScrollTo('world-main-content');
}

// ── Édition du contenu diapo d'une section (mode plein cadre dans le lecteur) ──
function worldEditContent(id) {
  _editingContentId = id;
  STORE.activeId = id;
  _renderReader(STORE.sections.find(s => s.id === id));
}

function worldCancelContent() {
  _editingContentId = null;
  _renderReader(STORE.sections.find(s => s.id === STORE.activeId));
}

async function worldSaveContent(id) {
  const section = STORE.sections.find(s => s.id === id);
  if (_sectionContentMode(section) === 'rich') {
    if (!section) return showNotif('Section introuvable.', 'error');
    section.contenu = getRichTextHtml(`world-rich-${id}`);
    try {
      await _save();
    } catch (e) {
      console.error('[world rich content save]', e);
      return showNotif('Le texte n\'a pas pu être enregistré.', 'error');
    }
    _editingContentId = null;
    showNotif('Texte enregistré.', 'success');
    renderWorld();
    return;
  }
  const page = getFreePageData(document.getElementById(`world-page-${id}`));
  if (!page) return showNotif('Éditeur de contenu indisponible.', 'error');
  const fit = await _fitWorldPage(page);
  if (!fit.fitted) {
    return showNotif(`Ce contenu est trop lourd (~${Math.round(fit.bytes / 1024)} Ko pour une limite de ~${Math.round(WORLD_PAGE_SAFE_BYTES / 1024)} Ko). Retire une image ou une diapo.`, 'error');
  }
  try {
    await saveWorldPage(id, fit.page);
  } catch (e) {
    console.error('[world content save]', e);
    const denied = String(e?.code || '') === 'permission-denied' || /permission|denied|insufficient/i.test(String(e?.message || ''));
    return showNotif(denied
      ? 'Écriture refusée : déploie la règle Firestore « worldPages » (voir docs/firestore-rules.md).'
      : 'Le contenu n\'a pas pu être enregistré.', 'error');
  }
  setCachedWorldPage(id, fit.page);
  _editingContentId = null;
  if (fit.shrunk) showNotif('Images recompressées pour tenir dans la limite Firestore.', 'info');
  showNotif('Contenu enregistré.', 'success');
  renderWorld();
}

// ── Drag & drop des sections (SortableJS, cross-catégorie) ────────────────────
// Une instance Sortable par liste de catégorie, toutes dans le même `group` →
// permet de réordonner ET de déplacer une section d'une catégorie à l'autre.
function _bindNavDrag() {
  _destroySortables();
  // Pas de tri pendant une recherche : la liste filtrée ferait perdre l'ordre des
  // sections masquées par le filtre (_onSectionsReordered relit le DOM).
  if (!STATE.isAdmin || _searchQuery) return;
  document.querySelectorAll('.world-cat-sections').forEach(list => {
    _sortables.push(makeSortable(list, {
      ghostClass: 'world-drag-ghost',
      chosenClass: 'world-drag-chosen',
      group: 'world-sections',
      animation: 160,
      handle: '[data-sec-id]',
      draggable: '[data-sec-id]',
      onEnd: _onSectionsReordered,
    }));
  });
}

function _destroySortables() {
  _sortables.forEach(s => { try { s.destroy(); } catch {} });
  _sortables = [];
}

// Reconstruit l'ordre + la catégorie de chaque section depuis le DOM après un drop.
async function _onSectionsReordered() {
  const byId = new Map(STORE.sections.map(s => [s.id, s]));
  const next = [];
  document.querySelectorAll('.world-cat-group[data-cat-id]').forEach(group => {
    const catId = group.dataset.catId;
    group.querySelectorAll('.world-cat-sections [data-sec-id]').forEach(el => {
      const s = byId.get(el.dataset.secId);
      if (s) next.push({ ...s, categoryId: catId });
    });
  });
  // Sécurité : conserver d'éventuelles sections non rendues (catégorie masquée côté admin = improbable)
  STORE.sections.forEach(s => { if (!next.find(n => n.id === s.id)) next.push(s); });
  STORE.sections = next;
  await _save();
  renderWorld();
}

// ── Modal création / édition section ─────────────────────────────────────────
function openWorldSectionModal(id = null, presetCatId = null) {
  const s = id ? STORE.sections.find(sec => sec.id === id) : null;
  if (!STORE.categories.length) { showNotif('Crée d\'abord une catégorie.', 'error'); return; }
  const selCatId = s?.categoryId || presetCatId || STORE.categories[0]?.id;
  const catOptions = STORE.categories.map(c =>
    `<option value="${c.id}" ${c.id===selCatId?'selected':''}>${_esc(c.icone||'📁')} ${_esc(c.nom||'Catégorie')}</option>`
  ).join('');

  const iconGrid = ICONES.map(ic => `
    <button type="button" id="wi-icon-${ic}" data-action="_selectWorldIcon" data-id="${ic}"
      style="width:34px;height:34px;border-radius:8px;font-size:1.1rem;cursor:pointer;
      border:2px solid ${(s?.icone||'📖')===ic?'var(--gold)':'var(--border)'};
      background:${(s?.icone||'📖')===ic?'rgba(232,184,75,.12)':'var(--bg-elevated)'};
      transition:all .1s;display:flex;align-items:center;justify-content:center">${ic}</button>
  `).join('');

  const selCat  = STORE.categories.find(c => c.id === selCatId);
  const bgStyle = s?.imageUrl ? `background-image:url('${_esc(s.imageUrl).replace(/'/g,'%27')}')` : '';

  openModal('', `
  <div class="mn-shell">

    <!-- ════ HERO : bannière image + titre + eyebrow catégorie ════ -->
    <div class="mn-hero" id="wi-hero">
      <div class="mn-hero-bg" id="wi-hero-bg" style="${bgStyle}"></div>
      <div class="mn-hero-fade"></div>

      <div id="wi-img-drop" class="mn-hero-drop" title="Cliquer ou déposer une image">
        <div id="wi-img-preview" style="display:none"></div>
        <div class="mn-hero-drop-hint">
          <span class="mn-hero-drop-icon">🖼️</span>
          <span>Glisser une image ou cliquer</span>
          ${s?.imageUrl ? `<button type="button" id="wi-img-clear"
            style="background:none;border:none;cursor:pointer;color:#ff8ca7;font-size:.78rem;padding:0 2px"
            title="Retirer l'image">✕</button>` : '<span id="wi-img-clear" hidden></span>'}
        </div>
      </div>

      <div class="mn-hero-content">
        <div class="mn-hero-eyebrow">
          <span id="wi-cat-eyebrow">${_esc(selCat?.icone || '📁')} ${_esc(selCat?.nom || 'Catégorie')}</span>
        </div>
        <input type="text" class="mn-hero-title" id="wi-titre" value="${_esc(s?.titre||'')}"
          placeholder="${s ? 'Titre de la section…' : 'Donne un nom à ta section…'}" autocomplete="off">
      </div>

      <div id="wi-crop-wrap" class="mn-crop-wrap" style="display:none">
        <canvas id="wi-crop-canvas"></canvas>
        <div class="mn-crop-bar">
          <span class="mn-crop-hint">Recadre la bannière</span>
          <button type="button" class="btn btn-gold btn-sm" id="wi-crop-confirm">✂️ Confirmer</button>
          <div id="wi-crop-ok" style="display:none;font-size:.75rem"></div>
        </div>
      </div>
    </div>

    <!-- ════ BODY ════ -->
    <div class="mn-body">
      <input type="hidden" id="wi-id" value="${s?.id||''}">
      <input type="hidden" id="wi-icon" value="${s?.icone||'📖'}">

      <div class="mn-row">
        <label class="mn-label" for="wi-categorie">Catégorie</label>
        <select class="input-field" id="wi-categorie" data-change="_worldSyncEyebrow" style="flex:1">${catOptions}</select>
      </div>

      <div class="mn-field">
        <label class="mn-label">Icône <span class="mn-label-hint">affichée dans la navigation</span></label>
        <div style="display:flex;flex-wrap:wrap;gap:.3rem">${iconGrid}</div>
      </div>

      <div class="mn-field">
        <label class="mn-label">Présentation du contenu</label>
        <div class="world-content-mode" role="radiogroup" aria-label="Présentation du contenu">
          <label class="world-content-mode-option">
            <input type="radio" name="wi-content-mode" value="rich" ${_sectionContentMode(s) === 'rich' ? 'checked' : ''}>
            <span><strong>Texte enrichi</strong><small>Lecture fluide pour du lore, des règles ou des notes.</small></span>
          </label>
          <label class="world-content-mode-option">
            <input type="radio" name="wi-content-mode" value="slides" ${_sectionContentMode(s) === 'slides' ? 'checked' : ''}>
            <span><strong>Diaporama</strong><small>Mise en page libre, images, graphiques et interactions.</small></span>
          </label>
        </div>
        <p class="mn-hint world-content-mode-hint">Le changement de mode conserve les deux versions du contenu.</p>
      </div>

      <label style="display:flex;align-items:center;gap:.6rem;
        padding:.55rem .75rem;background:rgba(255,107,107,.06);border:1px solid rgba(255,107,107,.18);
        border-radius:8px;cursor:pointer;font-size:.84rem;color:var(--text-muted)">
        <input type="checkbox" id="wi-hidden" ${s?.visible===false?'checked':''} style="accent-color:#ff6b6b">
        <span>🔒 Masquée aux joueurs</span>
      </label>
    </div>

    <!-- ════ FOOTER ════ -->
    <div class="mn-footer">
      <span class="mn-footer-hint">📖 Visible par tous les membres de l'aventure</span>
      <div style="display:flex;gap:.5rem">
        <button class="btn btn-outline btn-sm" data-action="_worldClose">Annuler</button>
        <button class="btn btn-gold" data-action="saveWorldSection">${s ? 'Enregistrer' : 'Créer la section'}</button>
      </div>
    </div>

  </div>
  `);

  // Upload + crop bannière → met à jour le fond du hero en live (onResult).
  _wiCropper?.destroy();
  _wiCropper = attachDropAndCrop({
    dropEl:        document.getElementById('wi-img-drop'),
    previewEl:     document.getElementById('wi-img-preview'),
    cropWrapEl:    document.getElementById('wi-crop-wrap'),
    canvasId:      'wi-crop-canvas',
    statusEl:      document.getElementById('wi-crop-ok'),
    confirmBtnEl:  document.getElementById('wi-crop-confirm'),
    clearBtnEl:    document.getElementById('wi-img-clear'),
    initialUrl:    s?.imageUrl || '',
    initialRatio:  { w: 16, h: 6 },
    maxDisplayW:   460,
    previewMaxH:   70,
    output:        { qualities: [0.82, 0.72, 0.60, 0.50] },
    onResult: (b64) => {
      const hero = document.getElementById('wi-hero-bg');
      if (!hero) return;
      hero.style.backgroundImage = b64 ? `url("${String(b64).replace(/"/g,'%22')}")` : '';
    },
  });
}

// Synchronise l'eyebrow du hero avec la catégorie choisie dans le select
function _worldSyncEyebrow() {
  const sel = document.getElementById('wi-categorie');
  const eye = document.getElementById('wi-cat-eyebrow');
  if (!sel || !eye) return;
  const c = STORE.categories.find(cat => cat.id === sel.value);
  eye.textContent = `${c?.icone || '📁'} ${c?.nom || 'Catégorie'}`;
}

function _selectWorldIcon(ic) {
  ICONES.forEach(i => {
    const btn = document.getElementById(`wi-icon-${i}`);
    if (!btn) return;
    btn.style.borderColor = i === ic ? 'var(--gold)' : 'var(--border)';
    btn.style.background  = i === ic ? 'rgba(232,184,75,.12)' : 'var(--bg-elevated)';
  });
  const inp = document.getElementById('wi-icon');
  if (inp) inp.value = ic;
}

async function saveWorldSection() {
  const titre = document.getElementById('wi-titre')?.value?.trim();
  if (!titre) { showNotif('Un titre est requis.', 'error'); return; }

  const id        = document.getElementById('wi-id')?.value || `ws_${Date.now()}`;
  const isNew     = !document.getElementById('wi-id')?.value;
  const icone     = document.getElementById('wi-icon')?.value || '📖';
  const hidden    = document.getElementById('wi-hidden')?.checked || false;
  const categoryId = document.getElementById('wi-categorie')?.value
    || STORE.categories[0]?.id || DEFAULT_CAT.id;
  const contentMode = document.querySelector('input[name="wi-content-mode"]:checked')?.value === 'slides'
    ? 'slides' : 'rich';

  // Résoudre l'image : nouveau crop > existante > effacée
  const existing = STORE.sections.find(s => s.id === id);
  const cropResult = _wiCropper?.getResult();
  let imageUrl = existing?.imageUrl || '';
  if (typeof cropResult === 'string') imageUrl = cropResult;
  else if (cropResult === null)       imageUrl = '';
  _wiCropper?.destroy(); _wiCropper = null;

  // Le contenu n'est plus édité ici (diapo via « Modifier le contenu ») : on
  // préserve l'éventuel contenu legacy HTML jusqu'à sa migration en diapo.
  const contenu = existing?.contenu || '';
  const section = { id, titre, icone, contenu, imageUrl, visible: !hidden, categoryId, contentMode };

  if (isNew) {
    STORE.sections.push(section);
  } else {
    const idx = STORE.sections.findIndex(s => s.id === id);
    if (idx >= 0) STORE.sections[idx] = section;
  }

  await _save();
  STORE.activeId = id;
  closeModal();
  showNotif(isNew ? 'Section créée !' : 'Section mise à jour !', 'success');
  renderWorld();
}

async function deleteWorldSection(id) {
  if (!await confirmModal('Supprimer cette section définitivement ?')) return;
  STORE.sections = STORE.sections.filter(s => s.id !== id);
  if (STORE.activeId === id) STORE.activeId = STORE.sections[0]?.id || null;
  if (_editingContentId === id) _editingContentId = null;
  deleteWorldPage(id);   // nettoie le doc dédié (best-effort)
  await _save();
  showNotif('Section supprimée.', 'success');
  renderWorld();
}

// ── Modal création / édition CATÉGORIE ────────────────────────────────────────
function openWorldCategoryModal(id = null) {
  const c = id ? STORE.categories.find(cat => cat.id === id) : null;

  const iconGrid = ICONES.map(ic => `
    <button type="button" id="wc-icon-${ic}" data-action="_selectWorldCatIcon" data-id="${ic}"
      style="width:34px;height:34px;border-radius:8px;font-size:1.1rem;cursor:pointer;
      border:2px solid ${(c?.icone||'📁')===ic?'var(--gold)':'var(--border)'};
      background:${(c?.icone||'📁')===ic?'rgba(232,184,75,.12)':'var(--bg-elevated)'};
      transition:all .1s;display:flex;align-items:center;justify-content:center">${ic}</button>
  `).join('');

  openModal(c ? `✏️ Modifier la catégorie — ${c.nom||''}` : '+ Nouvelle catégorie', `
    <input type="hidden" id="wc-id" value="${c?.id||''}">
    <input type="hidden" id="wc-icon" value="${c?.icone||'📁'}">

    <div class="form-group">
      <label>Icône</label>
      <div style="display:flex;flex-wrap:wrap;gap:.3rem">${iconGrid}</div>
    </div>

    <div class="form-group">
      <label>Nom de la catégorie</label>
      <input class="input-field" id="wc-nom" value="${_esc(c?.nom||'')}"
        placeholder="Géographie, Histoire, Factions…">
    </div>

    <label style="display:flex;align-items:center;gap:.6rem;margin-bottom:1rem;
      padding:.55rem .75rem;background:rgba(255,107,107,.06);border:1px solid rgba(255,107,107,.18);
      border-radius:8px;cursor:pointer;font-size:.84rem;color:var(--text-muted)">
      <input type="checkbox" id="wc-hidden" ${c?.visible===false?'checked':''}
        style="accent-color:#ff6b6b">
      <span>🔒 Masquée aux joueurs (cache aussi ses sections)</span>
    </label>

    <div style="display:flex;gap:.5rem">
      <button class="btn btn-gold" style="flex:1" data-action="saveWorldCategory">
        ${c ? 'Enregistrer' : 'Créer la catégorie'}
      </button>
      <button class="btn btn-outline btn-sm" data-action="_worldClose">Annuler</button>
    </div>
  `);
}

function _selectWorldCatIcon(ic) {
  ICONES.forEach(i => {
    const btn = document.getElementById(`wc-icon-${i}`);
    if (!btn) return;
    btn.style.borderColor = i === ic ? 'var(--gold)' : 'var(--border)';
    btn.style.background  = i === ic ? 'rgba(232,184,75,.12)' : 'var(--bg-elevated)';
  });
  const inp = document.getElementById('wc-icon');
  if (inp) inp.value = ic;
}

async function saveWorldCategory() {
  const nom = document.getElementById('wc-nom')?.value?.trim();
  if (!nom) { showNotif('Un nom est requis.', 'error'); return; }
  const id     = document.getElementById('wc-id')?.value || `wc_${Date.now()}`;
  const isNew  = !document.getElementById('wc-id')?.value;
  const icone  = document.getElementById('wc-icon')?.value || '📁';
  const hidden = document.getElementById('wc-hidden')?.checked || false;
  const category = { id, nom, icone, visible: !hidden };

  if (isNew) {
    STORE.categories.push(category);
  } else {
    const idx = STORE.categories.findIndex(c => c.id === id);
    if (idx >= 0) STORE.categories[idx] = category;
  }
  await _save();
  closeModal();
  showNotif(isNew ? 'Catégorie créée !' : 'Catégorie mise à jour !', 'success');
  renderWorld();
}

async function deleteWorldCategory(id) {
  const cat = STORE.categories.find(c => c.id === id);
  if (!cat) return;
  const orphans = STORE.sections.filter(s => s.categoryId === id);
  // Catégorie de repli : « Général » si elle existe (et n'est pas celle supprimée),
  // sinon la 1re autre catégorie, sinon « Général » recréée.
  let fallback = STORE.categories.find(c => c.id !== id && c.id === DEFAULT_CAT.id)
              || STORE.categories.find(c => c.id !== id);
  const msg = orphans.length
    ? `Supprimer « ${cat.nom} » ? Ses ${orphans.length} section${orphans.length>1?'s':''} seront déplacées vers « ${fallback?.nom || DEFAULT_CAT.nom} ».`
    : `Supprimer « ${cat.nom} » ?`;
  if (!await confirmModal(msg)) return;

  STORE.categories = STORE.categories.filter(c => c.id !== id);
  if (orphans.length) {
    if (!fallback) { fallback = { ...DEFAULT_CAT }; STORE.categories.unshift(fallback); }
    STORE.sections = STORE.sections.map(s => s.categoryId === id ? { ...s, categoryId: fallback.id } : s);
  }
  await _save();
  showNotif('Catégorie supprimée.', 'success');
  renderWorld();
}

// ── Utilitaires ───────────────────────────────────────────────────────────────
// _esc → importé depuis shared/html.js (_escapeHtml supprimé)

// ── Override PAGES.world ──────────────────────────────────────────────────────
PAGES.world = renderWorld;


registerActions({
  openWorldSectionModal:  (btn) => openWorldSectionModal(btn.dataset.id || undefined, btn.dataset.catId || undefined),
  selectWorldSection:     (btn) => selectWorldSection(btn.dataset.id),
  worldGoSection:         (btn) => worldGoSection(btn.dataset.id),
  worldScrollTo:          (btn) => worldScrollTo(btn.dataset.id),
  worldSearch:            (input) => worldSearch(input),
  toggleWorldCategory:    (btn) => toggleWorldCategory(btn),
  toggleWorldNavMobile:   ()    => toggleWorldNavMobile(),
  deleteWorldSection:     (btn) => deleteWorldSection(btn.dataset.id),
  worldEditContent:       (btn) => worldEditContent(btn.dataset.id),
  worldCancelContent:     ()    => worldCancelContent(),
  worldSaveContent:       (btn) => worldSaveContent(btn.dataset.id),
  saveWorldSection:       ()    => saveWorldSection(),
  _selectWorldIcon:       (btn) => _selectWorldIcon(btn.dataset.id),
  openWorldCategoryModal: (btn) => openWorldCategoryModal(btn.dataset.id || undefined),
  saveWorldCategory:      ()    => saveWorldCategory(),
  deleteWorldCategory:    (btn) => deleteWorldCategory(btn.dataset.id),
  _selectWorldCatIcon:    (btn) => _selectWorldCatIcon(btn.dataset.id),
  _worldSyncEyebrow:      ()    => _worldSyncEyebrow(),
  _worldClose:            ()    => closeModal(),
});
