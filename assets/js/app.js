// assets/js/app.js

import { pickAdventure, openCreateAdventureModal } from './core/init.js';

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
import { registerActions } from './core/actions.js';

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
// upload-cloudinary expose window._cloudinaryConfigure (bouton 🖼️ du sidebar)
import { openCloudinaryConfigModal } from './shared/upload-cloudinary.js';

// Recherche globale (Ctrl+K / Cmd+K) — auto-init à l'import
import './features/command-palette.js';

// Quick-view perso accessible depuis le dashboard, VTT, etc. — lazy load au 1er clic
async function openQuickView(id) {
  try {
    const { quickViewChar } = await import('./features/characters/quick-view.js');
    quickViewChar(id);
  } catch (e) {
    console.error('[quick-view] load failed:', e);
  }
}

// ── Exposition sur window EN PREMIER ─────────────────────────────────────────
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

// Actions globales déléguées (boutons statiques d'index.html / layout)
registerActions({
  'toggle-theme': () => toggleTheme(),
  openAdventureSwitcher: () => window.openAdventureSwitcher?.(),
  openCreateAdventureModal: () => openCreateAdventureModal(),
  pickAdventure: (btn) => pickAdventure(btn.dataset.id),
  _advSwitchPick: (btn) => { closeModal(); pickAdventure(btn.dataset.id); },
  _layoutCloseModal: () => closeModal(),
  _openQuickView: (btn) => openQuickView(btn.dataset.id),
  cloudinaryConfig: () => openCloudinaryConfigModal(),
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
