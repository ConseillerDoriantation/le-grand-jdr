// ══════════════════════════════════════════════
// NAVIGATION — Router + délégation d'événements
// ══════════════════════════════════════════════

import { STATE, setPage } from './state.js';
import PAGES from '../features/pages.js';

// ── Naviguer vers une page ─────────────────────
export function navigate(page) {
  if (!PAGES[page]) {
    console.warn(`[nav] page inconnue : ${page}`);
    return;
  }
  setPage(page);
  _syncNav(page);
  _renderLoading();
  PAGES[page]();
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

    // Navigation via data-navigate (sidebar, bottom-nav, more-menu, boutons inline)
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
    if (action === 'logout')          { window.doLogout?.();                    return; }
    if (action === 'login')           { e.preventDefault(); window.doLogin?.(); return; }
    if (action === 'register')        { e.preventDefault(); window.doRegister?.(); return; }
    if (action === 'auth-tab-login')  { window.switchAuthTab?.('login');        return; }
    if (action === 'auth-tab-register') { window.switchAuthTab?.('register');   return; }
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
