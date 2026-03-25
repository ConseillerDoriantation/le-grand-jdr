// ══════════════════════════════════════════════
// SIDEBAR & MOBILE NAV
// ══════════════════════════════════════════════
function toggleSidebar() {
  const s = document.getElementById('sidebar');
  const o = document.getElementById('sidebar-overlay');
  const open = s.classList.toggle('open');
  o.classList.toggle('show', open);
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('show');
}
function toggleMoreMenu() {
  const m = document.getElementById('more-menu');
  m.classList.toggle('show');
}
function closeMoreMenu() {
  document.getElementById('more-menu')?.classList.remove('show');
}
// Close more-menu on outside tap
document.addEventListener('click', e => {
  const menu = document.getElementById('more-menu');
  if (menu?.classList.contains('show') && !menu.contains(e.target) && !e.target.closest('.bottom-nav-item')) {
    menu.classList.remove('show');
  }
});
