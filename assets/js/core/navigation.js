// ══════════════════════════════════════════════
// NAVIGATION — Router + délégation d'événements
// ══════════════════════════════════════════════

import { STATE, setPage } from './state.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from '../features/pages.js';
import { unwatchAll } from '../shared/realtime.js';
import { appSplashHtml } from '../shared/html.js';
import { dispatchAction, dispatchValueAction } from './actions.js';

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
  vtt:          () => import('../features/vtt.js'),
  quests:       () => import('../features/quests.js'),
  agenda:       () => import('../features/agenda.js'),
};

// Garde les modules déjà chargés pour ne pas re-importer
const _loaded = new Set();

// ── Naviguer vers une page ─────────────────────
export async function navigate(page) {
  closeMoreMenu(); // referme le menu mobile quelle que soit la source (clic, clavier, palette)
  _collapseRailAfterNav(); // referme la sidebar déployée (rail) après navigation
  unwatchAll(); // stopper tous les listeners temps réel de la page précédente

  // Reset des inline styles que certaines pages posent sur #main-content
  // (ex. VTT pose overflow/height/paddingBottom et ne nettoie qu'à la
  //  ré-entrée dans la page → casse le scroll des pages suivantes).
  const mc = document.getElementById('main-content');
  if (mc) { mc.style.overflow = ''; mc.style.height = ''; mc.style.paddingBottom = ''; }

  setPage(page);
  _syncNav(page);
  _renderLoading();

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

  // Vérifier après chargement
  if (!PAGES[page]) {
    console.warn(`[nav] page inconnue : ${page}`);
    _renderPageError(page, new Error(`Page "${page}" introuvable`));
    return;
  }

  // Rendre la page
  try {
    await PAGES[page]();
  } catch (err) {
    console.error(`[nav] page "${page}" a planté :`, err);
    _renderPageError(page, err);
  }
}

// ── Repli de la sidebar (mode rail) après navigation ──────────
// La barre se déploie en CSS au survol/focus. Après un clic de navigation, on la
// force à se replier même si la souris/focus reste dessus ; la suppression est
// levée au prochain mouseleave → le survol redéploie normalement ensuite.
// Sur tablette tactile (hover:none) la barre reste figée déployée → on ne touche à rien.
function _collapseRailAfterNav() {
  const sb = document.getElementById('sidebar');
  if (!sb || !window.matchMedia('(hover: hover)').matches) return;
  // Déployée au clavier → on sort le focus, elle se replie d'elle-même.
  if (sb.contains(document.activeElement)) document.activeElement.blur();
  // Déployée au survol → on force le repli tant que la souris reste dessus.
  // IMPORTANT : ne rien faire si la barre n'est PAS survolée (ex. navigation
  // programmatique au boot) — sinon `nav-collapse` resterait collée et bloquerait
  // le 1er survol (il fallait survoler 2 fois).
  if (sb.matches(':hover') && !sb.classList.contains('nav-collapse')) {
    sb.classList.remove('is-expanded');
    sb.classList.add('nav-collapse');
    sb.addEventListener('mouseleave', () => sb.classList.remove('nav-collapse'), { once: true });
  }
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

// ── Délégation d'événements globale ───────────
export function initEventDelegation() {
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
  const bottomPrimaryPages = new Set(['dashboard', 'characters', 'vtt', 'quests']);
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
        onmouseover="this.style.background='var(--bg-card2)'"
        onmouseout="this.style.background='var(--bg-elevated)'">
        🔄 Réessayer
      </button>
    </div>`;
}
