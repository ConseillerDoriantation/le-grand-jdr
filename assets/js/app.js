// assets/js/app.js

import './core/init.js';

import {
  initAuth,
  switchAuthTab,
  doLogin,
  doRegister,
  doLogout,
} from './core/auth.js';

import {
  navigate,
  initEventDelegation,
} from './core/navigation.js';

import {
  openModal,
  closeModal,
  closeModalDirect,
} from './shared/modal.js';

import { showNotif }              from './shared/notifications.js';
import { initTheme, toggleTheme } from './shared/theme.js';

// ── Modules chargés au boot (nécessaires immédiatement) ──────────────────────
// uploadImage  : expose window.previewUploadPng/Jpeg (utilisé dans tout le HTML)
// character-photo: expose window.openCharacterPhotoPicker (utilisé dès la fiche perso)
import './features/uploadImage.js';
import './features/character-photo.js';

// ── Exposition sur window EN PREMIER ─────────────────────────────────────────
// toggleTheme doit être disponible avant le rendu
// car index.html utilise onclick="toggleTheme()"
Object.assign(window, {
  switchAuthTab,
  doLogin,
  doRegister,
  doLogout,
  navigate,
  openModal,
  closeModal,
  closeModalDirect,
  showNotif,
  toggleTheme,
});

// ── Thème ────────────────────────────────────────────────────────────────────
try {
  initTheme();
} catch (err) {
  console.error('[app] initTheme:', err);
}

// ── Auth ─────────────────────────────────────────────────────────────────────
try {
  initAuth();
} catch (err) {
  console.error('[app] initAuth:', err);
}

// ── Délégation d'événements ──────────────────────────────────────────────────
try {
  initEventDelegation();
} catch (err) {
  console.error('[app] initEventDelegation:', err);
}

// ── Modal overlay clic externe ───────────────────────────────────────────────
try {
  document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModalDirect();
  });
} catch (err) {
  console.error('[app] modal overlay:', err);
}

// ── Les features sont chargées en lazy via navigation.js ─────────────────────
// Chaque page charge son module uniquement à la première navigation.
// Voir : core/navigation.js → loadFeature()
