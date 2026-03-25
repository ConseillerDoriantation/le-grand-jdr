// ══════════════════════════════════════════════
// LAYOUT — Affichage app / auth
// ══════════════════════════════════════════════

import { STATE } from './state.js';

export function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display         = 'block';

  const usernameEl = document.getElementById('header-username');
  if (usernameEl) usernameEl.textContent = STATE.profile?.pseudo ?? STATE.user?.email ?? '';

  if (STATE.isAdmin) {
    document.getElementById('admin-badge')?.style.setProperty('display', 'inline');
    document.querySelectorAll('.admin-only').forEach(el => (el.style.display = 'flex'));
  }
}

export function showAuth() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display         = 'none';
}
