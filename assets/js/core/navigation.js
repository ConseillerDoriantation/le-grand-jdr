// ══════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════
function navigate(page) {
  STATE.currentPage = page;
  // Sync sidebar
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.getAttribute('onclick')?.includes(`'${page}'`));
  });
  // Sync bottom nav
  document.querySelectorAll('.bottom-nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  // Sync more menu
  document.querySelectorAll('.more-menu-item').forEach(el => {
    el.classList.toggle('active', el.getAttribute('onclick')?.includes(`'${page}'`));
  });
  closeMoreMenu();
  const content = document.getElementById('main-content');
  content.innerHTML = '<div class="loading"><div class="spinner"></div> Chargement...</div>';
  PAGES[page]?.();
}
