// ══════════════════════════════════════════════
// NAVIGATION — Router + délégation d'événements
// Supprime les onclick inline dans index.html
// ══════════════════════════════════════════════

import { STATE, setPage } from './state.js';
import PAGES from '../features/pages.js';
// ── Naviguer vers une page ─────────────────────
export function navigate(page) {
  if (!PAGES[page]) return console.warn(`[nav] page inconnue : ${page}`);
  setPage(page);
  _syncNav(page);
  _renderLoading();
  PAGES[page]();
}

// ── Sidebar ────────────────────────────────────
export function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('open');
  document.getElementById('sidebar-overlay')?.classList.toggle('show',
    document.getElementById('sidebar')?.classList.contains('open')
  );
}
export function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('show');
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
    const menu = document.getElementById('more-menu');
    if (menu?.classList.contains('show') &&
        !menu.contains(e.target) &&
        !e.target.closest('.bottom-nav-item')) {
      closeMoreMenu();
    }
    if (e.target.closest('#btn-menu'))         { toggleSidebar(); return; }
    if (e.target.matches('#sidebar-overlay'))  { closeSidebar();  return; }
    const navEl = e.target.closest('[data-navigate]');
    if (navEl) {
      navigate(navEl.dataset.navigate);
      closeSidebar(); closeMoreMenu(); return;
    }
    if (e.target.closest('[data-toggle-more]')) { toggleMoreMenu(); return; }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') import('../shared/modal.js').then(m => m.closeModalDirect());
  });
}

// ── Synchronisation de l'état actif ───────────
function _syncNav(page) {
  document.querySelectorAll('.nav-item[data-navigate]').forEach(el =>
    el.classList.toggle('active', el.dataset.navigate === page)
  );
  document.querySelectorAll('.bottom-nav-item[data-page]').forEach(el =>
    el.classList.toggle('active', el.dataset.page === page)
  );
  document.querySelectorAll('.more-menu-item[data-navigate]').forEach(el =>
    el.classList.toggle('active', el.dataset.navigate === page)
  );
}

function _renderLoading() {
  const content = document.getElementById('main-content');
  if (content) content.innerHTML =
    '<div class="loading"><div class="spinner"></div> Chargement…</div>';
}
