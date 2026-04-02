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

// ── Exposition sur window ───────────────────────────────────────────────────
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

// ── Chargement des modules features ─────────────────────────────────────────
const featureModules = [
  './features/characters.js',
  './features/shop.js',
  './features/npcs.js',
  './features/story.js',
  './features/bastion.js',
  './features/world.js',
  './features/achievements.js',
  './features/collection.js',
  './features/players.js',
  './features/tutorial.js',
  './features/informations.js',
  './features/recipes.js',
  './features/bestiary.js',
  './features/photo-cropper.js',
  './features/account.js',
];

async function loadFeaturesSafely() {
  const results = await Promise.allSettled(
    featureModules.map((path) => import(path))
  );
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`[app] feature failed: ${featureModules[index]}`, result.reason);
    }
  });
}

loadFeaturesSafely().catch((err) => {
  console.error('[app] loadFeaturesSafely:', err);
});
