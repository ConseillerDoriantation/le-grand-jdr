// ══════════════════════════════════════════════
// LAYOUT — Affichage app / auth
// ══════════════════════════════════════════════

import { STATE } from './state.js';

export function showApp() {
  const authScreen = document.getElementById('auth-screen');
  const app = document.getElementById('app');
  const usernameEl = document.getElementById('header-username');
  const adminBadge = document.getElementById('admin-badge');

  if (authScreen) authScreen.style.display = 'none';
  if (app) app.style.display = 'block';
  if (usernameEl) usernameEl.textContent = STATE.profile?.pseudo || STATE.user?.email || '';
  if (adminBadge) adminBadge.style.display = STATE.isAdmin ? 'inline' : 'none';

  document.querySelectorAll('.admin-only').forEach((el) => {
    el.style.display = STATE.isAdmin ? 'flex' : 'none';
  });
}

export function showAuth() {
  const authScreen = document.getElementById('auth-screen');
  const app = document.getElementById('app');
  if (authScreen) authScreen.style.display = 'flex';
  if (app) app.style.display = 'none';
}
