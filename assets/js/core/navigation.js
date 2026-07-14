// ══════════════════════════════════════════════
// NAVIGATION — Router + délégation d'événements
// ══════════════════════════════════════════════

import { STATE, setPage } from './state.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from '../features/pages.js';
import { loadChars } from '../data/firestore.js';
import { unwatchAll } from '../shared/realtime.js';
import { sortCharactersForDisplay } from '../shared/char-stats.js';
import { appSplashHtml } from '../shared/html.js';
import { dispatchAction, dispatchValueAction } from './actions.js';
import { isFeatureEnabled } from '../shared/features.js';
import { parseRoute, routeUrl } from '../shared/route.js';

// ── Carte page → module feature chargé en lazy ────────────────────────────
// Chaque module est importé une seule fois : le navigateur le met en cache
// automatiquement, les navigations suivantes vers la même page sont instantanées.
const FEATURE_MAP = {
  characters:   () => import('../features/characters.js'),
  shop:         () => import('../features/shop.js'),
  npcs:         () => import('../features/npcs.js'),
  story:        () => import('../features/story.js'),
  bastion:      () => import('../features/bastion.js'),
  world:        () => import('../features/world.js'),
  achievements: () => import('../features/achievements.js'),
  collection:   () => import('../features/collection.js'),
  players:      () => import('../features/players.js'),
  recettes:     () => import('../features/recipes.js'),
  bestiaire:    () => import('../features/bestiary.js'),
  account:      () => import('../features/account.js'),
  map:          () => import('../features/map.js'),
  aventures:    () => import('../features/aventures.js'),
  histoire:     () => import('../features/histoire.js'),
  vtt:          () => import('../features/vtt/vtt.js'),
  agenda:       () => import('../features/agenda.js'),
  sessions:     () => import('../features/session-center.js'),
};

// Garde les modules déjà chargés pour ne pas re-importer
const _loaded = new Set();

const CHARACTER_DATA_PAGES = new Set([
  'characters',
  'shop',
  'npcs',
  'story',
  'histoire',
  'bastion',
  'achievements',
  'players',
  'bestiaire',
  'statistiques',
  'sessions',
  'agenda',
  'recettes',
  'collection',
  'account',
  'aventures',
  'admin',
]);
let _charactersReadyPromise = null;

async function _ensureCharactersReady(page) {
  if (!CHARACTER_DATA_PAGES.has(page) || !STATE.adventure?.id) return;
  const key = STATE.adventure.id;
  if (_charactersReadyPromise?.key === key) return _charactersReadyPromise.promise;

  const promise = loadChars()
    .then(chars => {
      STATE.characters = sortCharactersForDisplay(Array.isArray(chars) ? chars : []);
    })
    .catch(err => {
      console.warn('[nav] personnages indisponibles pour la page', page, err?.code || err);
    })
    .finally(() => {
      if (_charactersReadyPromise?.key === key) _charactersReadyPromise = null;
    });
  _charactersReadyPromise = { key, promise };
  return promise;
}

// ── CSS chargé en lazy par feature ────────────────────────────────────────
// Les feuilles spécifiques à une page sont retirées de index.html et chargées
// à la 1re navigation vers la page, en parallèle de son module JS. Restent
// eager : le global, les primitives partagées, quick-view, palette et print.
// Les widgets personnage nécessaires au VTT sont embarqués dans vtt.css.
// Les autres features chargent uniquement leurs feuilles dédiées.
const FEATURE_CSS = {
  dashboard:  ['quests.css', 'bastion.css', 'dashboard.css'],
  // shop.css : les modales admin rendues depuis la fiche perso (types de dégâts,
  // formats d'arme, styles de combat, matrices de sorts) réutilisent les styles
  // partagés `.sh-admin-*` / `.sh-dmg-*` définis dans shop.css → sinon, ouvertes
  // hors boutique, elles s'affichent sans mise en forme. Chargeur dédoublonné.
  characters: ['characters.css', 'shop.css'],
  shop:       ['shop.css'],
  // Console MJ : admin.css pour la page elle-même. Les CSS des modales (empruntées
  // à d'autres features) sont chargées à l'ouverture de chaque modale via
  // _adminLazyOpen (pages.js) — inutile de tirer vtt.css/histoire.css avant besoin.
  admin:      ['admin.css'],
  statistiques: ['admin.css', 'stats.css'],
  npcs:       ['npcs.css'],
  story:      ['histoire.css'],
  histoire:   ['histoire.css'],
  // Composant modal partagé `.mn-*` (hero/champs/footer) défini dans histoire.css
  // et réutilisé par ces pages → sinon leur modale s'affiche sans style.
  world:      ['histoire.css'],
  collection: ['histoire.css'],
  players:    ['histoire.css'],
  bastion:    ['bastion.css'],
  vtt:        ['vtt.css?v=20260630-max-v2'],
  // shop-picker.css : le picker de butins (shared/shop-picker.js) utilise des
  // classes `vtt-loot-*` qui ne vivent sinon que dans vtt.css → sans lui, la
  // modale d'ajout de butin s'affiche sans style hors VTT.
  bestiaire:  ['bestiary.css', 'shop-picker.css'],
  agenda:     ['agenda.css', 'recipes.css'],
  sessions:   ['session-center.css'],
  recettes:   ['recipes.css'],
  account:    ['account.css'],
};
const _cssLoaded = new Set();
function _loadCss(file) {
  if (_cssLoaded.has(file)) return Promise.resolve();
  _cssLoaded.add(file);
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `./assets/css/${file}`;
    link.onload = () => resolve();
    link.onerror = () => { console.warn('[nav] CSS feature non chargée :', file); resolve(); };
    document.head.appendChild(link);
  });
}
export function _ensureFeatureCss(page) {
  const files = FEATURE_CSS[page];
  return files ? Promise.all(files.map(_loadCss)) : Promise.resolve();
}

// ── Deep-link : une page = une URL (#page[/sous-route]) ───────────────────
// L'app est une SPA sans URL de page : sans ça, un onglet ouvert au clic molette
// retomberait toujours sur le dashboard. Le hash rend chaque page adressable
// (partageable, rechargeable) ; l'aventure, elle, est déjà restaurée au boot via
// localStorage (`jdr-last-adventure`). La sous-route (onglet) est gérée par la
// feature elle-même via shared/route.js.

// Page connue = feature lazy OU page déjà enregistrée dans PAGES (dashboard, admin…).
export function isKnownPage(page) {
  return Boolean(page && (FEATURE_MAP[page] || PAGES[page]));
}

// Deep-link d'ouverture : lu UNE fois au chargement du module, consommé à la 1re
// navigation. Évite qu'un hash resté dans l'onglet (logout/relogin, changement
// d'aventure) ne détourne les navigations suivantes vers dashboard.
let _bootPage = isKnownPage(parseRoute().page) ? parseRoute().page : null;
export function consumeBootPage(fallback = 'dashboard') {
  const page = _bootPage;
  _bootPage = null;
  return page || fallback;
}

function _syncHash(page) {
  // Même page → on laisse l'URL intacte : sa sous-route (onglet en cours, ou
  // deep-link pas encore consommé par la feature) doit survivre au rendu.
  // Page différente → l'ancienne sous-route n'a plus de sens, on repart propre.
  // replaceState : pas d'entrée d'historique (le bouton Retour ne change pas de
  // comportement) et pas de `hashchange`.
  if (parseRoute().page === page) return;
  history.replaceState(null, '', routeUrl(page));
}

// ── Naviguer vers une page ─────────────────────
export async function navigate(page) {
  closeMoreMenu(); // referme le menu mobile quelle que soit la source (clic, clavier, palette)
  _collapseRailAfterNav(); // referme la sidebar déployée (rail) après navigation

  // Garde : une feature désactivée pour l'aventure courante (lien direct, palette,
  // page devenue off) → on redirige vers le tableau de bord au lieu de l'ouvrir.
  if (!isFeatureEnabled(page)) {
    showNotif('Cette fonctionnalité n\'est pas activée pour cette aventure.', 'info');
    page = 'dashboard';
  }

  unwatchAll(); // stopper tous les listeners temps réel de la page précédente

  // Reset des inline styles que certaines pages posent sur #main-content
  // (ex. VTT: overflow/height/paddingBottom ; map: padding/height).
  const mc = document.getElementById('main-content');
  if (mc) {
    mc.style.overflow = '';
    mc.style.height = '';
    mc.style.padding = '';
    mc.style.paddingBottom = '';
    mc.dataset.page = page;
  }

  setPage(page);
  _syncHash(page);
  _syncNav(page);
  _renderLoading();

  // CSS lazy de la page : lancé en parallèle de l'import JS, attendu avant le
  // rendu (évite le flash sans style). Instantané si déjà chargé (cache).
  const cssReady = _ensureFeatureCss(page);

  // Charger la feature en lazy si nécessaire (une seule fois)
  // On le fait AVANT de vérifier PAGES[page] car certaines features
  // s'y enregistrent elles-mêmes au chargement (ex: account.js, world.js)
  if (FEATURE_MAP[page] && !_loaded.has(page)) {
    try {
      await FEATURE_MAP[page]();
      _loaded.add(page);
    } catch (err) {
      console.error(`[nav] chargement feature "${page}" échoué :`, err);
      _renderPageError(page, err);
      return;
    }
  }
  await cssReady;

  // Vérifier après chargement
  if (!PAGES[page]) {
    console.warn(`[nav] page inconnue : ${page}`);
    _renderPageError(page, new Error(`Page "${page}" introuvable`));
    return;
  }

  // Rendre la page
  try {
    await _ensureCharactersReady(page);
    await PAGES[page]();
  } catch (err) {
    console.error(`[nav] page "${page}" a planté :`, err);
    _renderPageError(page, err);
  }
}

// ── Nettoyage de la sidebar après navigation ──────────
// La sidebar desktop est stable ; on retire seulement les anciennes classes de rail
// pour éviter qu'un état hérité d'une version précédente modifie son rendu.
function _collapseRailAfterNav() {
  const sb = document.getElementById('sidebar');
  if (!sb) return;
  sb.classList.remove('is-expanded', 'nav-collapse');
}

// ── More-menu mobile ───────────────────────────
function _setMoreExpanded(open) {
  document.querySelectorAll('[data-toggle-more]').forEach((b) =>
    b.setAttribute('aria-expanded', String(open)));
}
export function toggleMoreMenu() {
  const menu = document.getElementById('more-menu');
  if (!menu) return;
  _setMoreExpanded(menu.classList.toggle('show'));
}
export function closeMoreMenu() {
  const menu = document.getElementById('more-menu');
  if (menu) menu.classList.remove('show');
  _setMoreExpanded(false);
}

// ── Ouverture dans un nouvel onglet ───────────
// Les cibles de nav sont des <button>/<div> (pas des <a href>) : le navigateur ne
// sait pas les ouvrir seul. On reproduit son comportement natif (clic molette,
// Ctrl/⌘+clic) en ouvrant le deep-link correspondant. Deux marqueurs :
//   `data-navigate="shop"`          → une page (sidebar, bottom-nav, « Plus », dashboard) ;
//   `data-nav-sub="char_17/sorts"`  → un onglet DANS la page courante (fiche perso…),
//                                     `data-nav-page` si l'onglet vise une autre page.
const NAV_TARGETS = '[data-navigate],[data-nav-sub]';

function _newTabUrl(target) {
  const subEl = target?.closest?.('[data-nav-sub]');
  // L'onglet l'emporte : il est plus spécifique que la page qui le contient.
  const page  = subEl
    ? (subEl.dataset.navPage || STATE.currentPage)
    : target?.closest?.('[data-navigate]')?.dataset.navigate;
  if (!isKnownPage(page) || !isFeatureEnabled(page)) return null;
  return routeUrl(page, subEl?.dataset.navSub || '');
}

function _openInNewTab(url) {
  window.open(url, '_blank', 'noopener');
  closeMoreMenu();
}

// ── Délégation d'événements globale ───────────
export function initEventDelegation() {
  // Clic molette : mousedown pour couper l'auto-scroll du navigateur, auxclick
  // pour l'action (mouseup molette).
  document.addEventListener('mousedown', (e) => {
    if (e.button === 1 && e.target.closest(NAV_TARGETS)) e.preventDefault();
  });
  document.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const url = _newTabUrl(e.target);
    if (url) { e.preventDefault(); _openInNewTab(url); }
  });

  // Deep-link modifié à la main (URL éditée, lien collé dans l'onglet courant).
  // Ignoré tant qu'aucune aventure n'est active : le boot s'en charge déjà.
  // On re-navigue même à page égale : la feature relira sa sous-route au rendu.
  window.addEventListener('hashchange', () => {
    const { page } = parseRoute();
    if (!STATE.adventure || !isKnownPage(page)) return;
    navigate(page);
  });

  document.addEventListener('click', (e) => {
    // Fermer le more-menu si clic en dehors
    const menu = document.getElementById('more-menu');
    if (
      menu?.classList.contains('show') &&
      !menu.contains(e.target) &&
      !e.target.closest('[data-toggle-more]')
    ) {
      closeMoreMenu();
    }

    // Ctrl/⌘+clic sur une page ou un onglet → nouvel onglet, comme un vrai lien.
    // Avant tout le reste : les onglets portent aussi un `data-action` qui, sinon,
    // basculerait l'onglet dans la page courante.
    if (e.ctrlKey || e.metaKey) {
      const url = _newTabUrl(e.target);
      if (url) { e.preventDefault(); _openInNewTab(url); return; }
    }

    // Navigation via data-navigate
    const navEl = e.target.closest('[data-navigate]');
    if (navEl) {
      navigate(navEl.dataset.navigate);
      closeMoreMenu();
      return;
    }

    // Toggle more-menu mobile
    if (e.target.closest('[data-toggle-more]')) {
      toggleMoreMenu();
      return;
    }

    // Fermeture de modal
    if (e.target.closest('[data-action="close-modal"]')) {
      import('../shared/modal.js').then((m) => m.closeModalDirect());
      return;
    }

    // Actions auth déléguées + registry central
    const actionBtn = e.target.closest('[data-action]');
    const action = actionBtn?.dataset.action;
    if (action === 'logout')            { doLogout();                       return; }
    if (action === 'login')             { e.preventDefault(); doLogin();    return; }
    if (action === 'register')          { e.preventDefault(); doRegister(); return; }
    if (action === 'auth-tab-login')    { switchAuthTab('login');           return; }
    if (action === 'auth-tab-register') { switchAuthTab('register');        return; }
    if (action === 'toggle-pw') {
      const btn = e.target.closest('[data-action="toggle-pw"]');
      const input = btn && document.getElementById(btn.dataset.target);
      if (input) {
        const shown = input.type === 'text';
        input.type = shown ? 'password' : 'text';
        btn.classList.toggle('pw-toggle--on', !shown);
        btn.setAttribute('aria-label', shown ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
      }
      return;
    }

    // Dispatch vers le registry central des features
    if (actionBtn && dispatchAction(actionBtn, e)) return;
  });

  // Actions sur change / input (selects, checkboxes, champs texte…)
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (el) dispatchValueAction(el, e, 'change');
  });
  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-input]');
    if (el) dispatchValueAction(el, e, 'input');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      import('../shared/modal.js').then((m) => m.closeModalDirect());
      closeMoreMenu();
      return;
    }
    // Activation clavier des cibles de navigation non natives (<a> sans href, <div>).
    // Les <button> gèrent Entrée/Espace nativement (→ event click).
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      const el = e.target.closest('[data-navigate]');
      if (el && el.tagName !== 'BUTTON') {
        e.preventDefault();
        navigate(el.dataset.navigate);
        closeMoreMenu();
      }
    }
  });

  _initNavA11y();
}

// Rend focusables/activables au clavier les cibles de nav qui ne sont pas des
// <button> natifs (sidebar : <a> sans href, ligne de marque <div>).
function _initNavA11y() {
  document.querySelectorAll('[data-navigate]').forEach((el) => {
    if (el.tagName === 'BUTTON') return;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    if (!el.hasAttribute('role'))     el.setAttribute('role', 'link');
  });
}

// ── Synchronisation de l'état actif de la nav ─
function _setActive(el, isActive) {
  el.classList.toggle('active', isActive);
  if (isActive) el.setAttribute('aria-current', 'page');
  else el.removeAttribute('aria-current');
}
function _syncNav(page) {
  document.querySelectorAll('.sidebar-section.has-active, .sidebar-priority.has-active').forEach((el) => {
    el.classList.remove('has-active');
  });
  document.querySelectorAll('.nav-item[data-navigate]').forEach((el) => {
    const isActive = el.dataset.navigate === page;
    _setActive(el, isActive);
    if (isActive) {
      const section = el.closest('.sidebar-section, .sidebar-priority');
      section?.classList.add('has-active');
      if (section?.tagName === 'DETAILS' && !section.open) section.open = true;
    }
  });
  const bottomPrimaryPages = new Set(['dashboard', 'characters', 'vtt', 'story']);
  document.querySelectorAll('.bottom-nav-item[data-page]').forEach((el) =>
    _setActive(el, el.dataset.page === page)
  );
  document.querySelectorAll('[data-toggle-more]').forEach((el) => {
    el.classList.toggle('active', !bottomPrimaryPages.has(page));
  });
  document.querySelectorAll('.more-menu-item[data-navigate], .more-feature[data-navigate]').forEach((el) =>
    _setActive(el, el.dataset.navigate === page)
  );
}

function _renderLoading() {
  const content = document.getElementById('main-content');
  if (!content) return;
  content.innerHTML = appSplashHtml();
}

function _renderPageError(page, err) {
  const content = document.getElementById('main-content');
  if (!content) return;
  const isOffline = !navigator.onLine;
  const isPerm    = err?.code === 'permission-denied';
  const icon      = isOffline ? '📡' : isPerm ? '🔒' : '⚠️';
  const title     = isOffline ? 'Connexion perdue'
                  : isPerm    ? 'Accès refusé'
                  :             'Erreur de chargement';
  const detail    = isOffline
                  ? 'Vérifie ta connexion internet et réessaie.'
                  : isPerm
                  ? "Tu n'as pas accès à cette page."
                  : 'Une erreur inattendue s\'est produite.';
  content.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
      min-height:40vh;gap:1rem;text-align:center;padding:2rem">
      <div style="font-size:2.5rem">${icon}</div>
      <div style="font-family:'Cinzel',serif;font-size:1.1rem;font-weight:700;
        color:var(--text)">${title}</div>
      <div style="font-size:.88rem;color:var(--text-muted);max-width:360px;line-height:1.6">
        ${detail}
      </div>
      <button data-navigate="${page}"
        style="margin-top:.5rem;padding:.5rem 1.5rem;border-radius:10px;cursor:pointer;
          font-size:.85rem;font-weight:600;border:1px solid var(--border-strong);
          background:var(--bg-elevated);color:var(--text-muted);transition:background .12s"
        data-hov-bg="var(--bg-card2)">
        🔄 Réessayer
      </button>
    </div>`;
}
