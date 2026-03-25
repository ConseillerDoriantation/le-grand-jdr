// ══════════════════════════════════════════════
// LAYOUT — Affichage app / auth
// ══════════════════════════════════════════════

import { STATE } from './state.js';

export function showApp() {
  document.getElementById('auth-screen')?.style.setProperty('display', 'none');
  document.getElementById('app')?.style.setProperty('display', 'block');

  const usernameEl = document.getElementById('header-username');
  if (usernameEl) usernameEl.textContent = STATE.profile?.pseudo ?? STATE.user?.email ?? '';

  const adminBadge = document.getElementById('admin-badge');
  if (adminBadge) adminBadge.style.display = STATE.isAdmin ? 'inline' : 'none';

  document.querySelectorAll('.admin-only').forEach((el) => {
    el.style.display = STATE.isAdmin ? 'flex' : 'none';
  });
}

export function showAuth() {
  document.getElementById('auth-screen')?.style.setProperty('display', 'flex');
  document.getElementById('app')?.style.setProperty('display', 'none');
}
