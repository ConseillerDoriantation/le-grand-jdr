// ══════════════════════════════════════════════
// NAVIGATION — Router + délégation d'événements
// ══════════════════════════════════════════════

import { STATE, setPage } from './state.js';
import PAGES from '../features/pages.js';
import { unwatchAll } from '../shared/realtime.js';

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

  // VTT : sur mobile, basculer en mode spectateur (lecture seule + chat)
  if (page === 'vtt' && window.innerWidth < 768) {
    try {
      const mod = await import('../features/vtt-spectator.js');
      await mod.renderVttSpectator();
    } catch (err) {
      console.error('[nav] vtt-spectator failed:', err);
      _renderMobileOnly();
    }
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
  document.querySelectorAll('.nav-item[data-navigate]').forEach((el) => {
    const isActive = el.dataset.navigate === page;
    el.classList.toggle('active', isActive);
    // Ouvre automatiquement la section <details> parente si l'item actif y est replié
    if (isActive) {
      const section = el.closest('.sidebar-section');
      if (section && !section.open) section.open = true;
    }
  });
  document.querySelectorAll('.bottom-nav-item[data-page]').forEach((el) =>
    el.classList.toggle('active', el.dataset.page === page)
  );
  document.querySelectorAll('.more-menu-item[data-navigate]').forEach((el) =>
    el.classList.toggle('active', el.dataset.navigate === page)
  );
}

function _renderMobileOnly() {
  const content = document.getElementById('main-content');
  if (!content) return;
  content.innerHTML = `
    <div class="vtt-mobile-only">
      <div style="font-size:3rem">🖥️</div>
      <div style="font-family:'Cinzel',serif;font-size:1.1rem;font-weight:700;color:var(--text)">
        Table Virtuelle
      </div>
      <div style="font-size:.9rem;color:var(--text-muted);max-width:280px;line-height:1.6">
        La Table Virtuelle est disponible uniquement sur ordinateur.
      </div>
    </div>`;
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