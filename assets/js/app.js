// assets/js/app.js

import { pickAdventure, openCreateAdventureModal, acceptAdventureInvitation, declineAdventureInvitation } from './core/init.js';

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
import { initGlobalQol } from './shared/global-qol.js';
import { initDiagnostics } from './shared/diagnostics.js';
import { initDisplayPreferences } from './shared/display-preferences.js';

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
async function openQuickView(id, list) {
  try {
    const { quickViewChar } = await import('./features/characters/quick-view.js');
    quickViewChar(id, Array.isArray(list) ? { list } : undefined);
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
  acceptInvitation: (btn) => acceptAdventureInvitation(btn.dataset.id),
  declineInvitation: (btn) => declineAdventureInvitation(btn.dataset.id),
  _advSwitchPick: (btn) => { closeModal(); pickAdventure(btn.dataset.id); },
  _layoutCloseModal: () => closeModal(),
  _openQuickView: (btn) => openQuickView(btn.dataset.id, btn.dataset.list?.split(',').filter(Boolean)),
  cloudinaryConfig: () => openCloudinaryConfigModal(),
});

// ── Préférences d'affichage locales ──────────────────────────────────────────
try {
  initDisplayPreferences();
} catch (err) {
  console.error('[app] initDisplayPreferences:', err);
}

// ── Diagnostic local (aucune donnée métier) ─────────────────────────────────
try {
  initDiagnostics();
} catch (err) {
  console.error('[app] initDiagnostics:', err);
}

// ── Thème ────────────────────────────────────────────────────────────────────
try {
  initTheme();
} catch (err) {
  console.error('[app] initTheme:', err);
}

try {
  initGlobalQol();
} catch (err) {
  console.error('[app] initGlobalQol:', err);
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
  let updateAnnounced = false;
  let hadController = Boolean(navigator.serviceWorker.controller);
  const announceUpdate = () => {
    if (updateAnnounced) return;
    updateAnnounced = true;
    document.dispatchEvent(new CustomEvent('app:update-available'));
  };

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'APP_UPDATE_AVAILABLE') announceUpdate();
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Le premier claim installe simplement la PWA ; les suivants correspondent
    // à une nouvelle version du service worker.
    if (hadController) announceUpdate();
    hadController = true;
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');
      let lastCheck = 0;
      const checkForUpdate = () => {
        if (document.hidden || !navigator.onLine || Date.now() - lastCheck < 5 * 60_000) return;
        lastCheck = Date.now();
        // update() couvre sw.js ; la lecture légère d'index.html permet au SW de
        // comparer le déploiement courant même si seul le code applicatif change.
        registration.update().catch(() => {});
        fetch('./index.html', { cache: 'no-store' }).catch(() => {});
      };
      checkForUpdate();
      document.addEventListener('visibilitychange', checkForUpdate);
      setInterval(checkForUpdate, 15 * 60_000);
    } catch (err) {
      console.warn('[pwa] service worker non enregistré :', err?.message || err);
    }
  });
}

// ── Les features sont chargées en lazy via navigation.js ─────────────────────
// Chaque page charge son module uniquement à la première navigation.
// Voir : core/navigation.js → loadFeature()
