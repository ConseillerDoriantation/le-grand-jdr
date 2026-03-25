// assets/js/app.js
// Point d'entrée robuste : le coeur de l'app démarre même si une feature casse.

// ──────────────────────────────────────────────
// 1) Imports coeur obligatoires
// ──────────────────────────────────────────────
import './core/init.js';

import {
  switchAuthTab,
  doLogin,
  doRegister,
  doLogout,
  showAuth,
  showApp,
  initAuth
} from './core/auth.js';

import {
  navigate,
  initEventDelegation
} from './core/navigation.js';

import {
  openModal,
  closeModal,
  closeModalDirect
} from './shared/modal.js';

import {
  showNotif
} from './shared/notifications.js';

// ──────────────────────────────────────────────
// 2) Exposition globale temporaire
// Permet de rester compatible avec les anciens onclick
// ──────────────────────────────────────────────
Object.assign(window, {
  switchAuthTab,
  doLogin,
  doRegister,
  doLogout,
  showAuth,
  showApp,
  navigate,
  openModal,
  closeModal,
  closeModalDirect,
  showNotif
});

// ──────────────────────────────────────────────
// 3) Initialisation coeur
// ──────────────────────────────────────────────
try {
  initAuth();
} catch (error) {
  console.error('[app] initAuth failed:', error);
}

try {
  initEventDelegation();
} catch (error) {
  console.error('[app] initEventDelegation failed:', error);
}

// Overlay modal : clic extérieur
try {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModalDirect();
      }
    });
  }
} catch (error) {
  console.error('[app] modal overlay binding failed:', error);
}

// ──────────────────────────────────────────────
// 4) Chargement des features en mode tolérant
// Une feature cassée ne bloque plus le login
// ──────────────────────────────────────────────
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
  './features/recettes.js',
  './features/bestiary.js',
  './features/photo-cropper.js'
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

loadFeaturesSafely().catch((error) => {
  console.error('[app] feature loader failed:', error);
});
