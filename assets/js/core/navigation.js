// ══════════════════════════════════════════════
// NAVIGATION — Router + délégation d'événements
// ══════════════════════════════════════════════

import { STATE, setPage } from './state.js';
import PAGES from '../features/pages.js';

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
  tutorial:     () => import('../features/tutorial.js'),
  informations: () => import('../features/informations.js'),
  recettes:     () => import('../features/recipes.js'),
  bestiaire:    () => import('../features/bestiary.js'),
  account:      () => import('../features/account.js'),
  map:          () => import('../features/map.js'),
};

// Garde les modules déjà chargés pour ne pas re-importer
const _loaded = new Set();

// ── Naviguer vers une page ─────────────────────
export async function navigate(page) {
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

// ── More-menu mobile ───────────────────────────
export function toggleMoreMenu() {
  document.getElementById('more-menu')?.classList.toggle('show');
}
export function closeMoreMenu() {
  document.getElementById('more-menu')?.classList.remove('show');
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

    // Actions auth déléguées
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'logout')            { window.doLogout?.();                       return; }
    if (action === 'login')             { e.preventDefault(); window.doLogin?.();    return; }
    if (action === 'register')          { e.preventDefault(); window.doRegister?.(); return; }
    if (action === 'auth-tab-login')    { window.switchAuthTab?.('login');           return; }
    if (action === 'auth-tab-register') { window.switchAuthTab?.('register');        return; }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      import('../shared/modal.js').then((m) => m.closeModalDirect());
      closeMoreMenu();
    }
  });
}

// ── Synchronisation de l'état actif de la nav ─
function _syncNav(page) {
  document.querySelectorAll('.nav-item[data-navigate]').forEach((el) =>
    el.classList.toggle('active', el.dataset.navigate === page)
  );
  document.querySelectorAll('.bottom-nav-item[data-page]').forEach((el) =>
    el.classList.toggle('active', el.dataset.page === page)
  );
  document.querySelectorAll('.more-menu-item[data-navigate]').forEach((el) =>
    el.classList.toggle('active', el.dataset.navigate === page)
  );
}

function _renderLoading() {
  const content = document.getElementById('main-content');
  if (content) {
    content.innerHTML =
      '<div class="loading"><div class="spinner"></div> Chargement…</div>';
  }
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
      <button onclick="navigate('${page}')"
        style="margin-top:.5rem;padding:.5rem 1.5rem;border-radius:10px;cursor:pointer;
          font-size:.85rem;font-weight:600;border:1px solid var(--border-strong);
          background:var(--bg-elevated);color:var(--text-muted);transition:background .12s"
        onmouseover="this.style.background='var(--bg-card2)'"
        onmouseout="this.style.background='var(--bg-elevated)'">
        🔄 Réessayer
      </button>
    </div>`;
}