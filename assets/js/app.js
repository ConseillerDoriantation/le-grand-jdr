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
import { openAdventureSwitcher }  from './core/layout.js';
import { initTheme, toggleTheme } from './shared/theme.js';

// ── Modules chargés au boot (nécessaires immédiatement) ──────────────────────
// character-photo : enregistre à l'import un handler de clic délégué pour les
//   actions data-action="open-character-photo" / "delete-character-photo".
import './features/character-photo.js';
// inline-compat : écouteurs délégués remplaçant les handlers inline (hover, Entrée/
//   Échap sur champs, onerror d'image…) → prérequis CSP stricte. Voir docs/security.md §3.
import './shared/inline-compat.js';
// a11y : aria-label auto (title → aria-label) sur les boutons icône-seule, pour
//   les lecteurs d'écran. Auto-init + observer le rendu dynamique.
import './shared/a11y.js';
// upload-cloudinary : openCloudinaryConfigModal, câblé via l'action `cloudinaryConfig`.
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
  openAdventureSwitcher: () => openAdventureSwitcher(),
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

// ── Molette sur <input type="number"> ────────────────────────────────────────
// Par défaut, scroller la molette sur un champ numérique focalisé fait varier sa
// valeur (incrément/décrément) — comportement indésirable dans toute l'app.
// On retire le focus au moindre scroll : la valeur ne change pas et la page
// continue de défiler normalement. Couvre aussi les inputs créés dynamiquement.
try {
  document.addEventListener('wheel', (e) => {
    const el = e.target;
    if (el instanceof HTMLInputElement && el.type === 'number' && el === document.activeElement) {
      el.blur();
    }
  }, { passive: true });
} catch (err) {
  console.error('[app] wheel guard:', err);
}

// ── PWA : enregistre le service worker (installable + lecture hors-ligne) ─────
// Après 'load' pour ne pas concurrencer le démarrage. Échec silencieux (contexte
// non sécurisé, navigateur sans SW…). Stratégie réseau-first → aucune régression
// de fraîcheur en ligne (cf. sw.js à la racine).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) =>
      console.warn('[pwa] service worker non enregistré :', err?.message || err));
  });
}

// ── Les features sont chargées en lazy via navigation.js ─────────────────────
// Chaque page charge son module uniquement à la première navigation.
// Voir : core/navigation.js → loadFeature()
