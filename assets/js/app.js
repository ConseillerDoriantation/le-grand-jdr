// ══════════════════════════════════════════════
// APP.JS — Point d'entrée unique
// Remplace les 15+ balises <script defer> dans
// index.html par un seul <script type="module">
// ══════════════════════════════════════════════

// ── 1. Bootstrap Firebase + auth listener ──────
import './core/init.js';

// ── 2. Auth UI ─────────────────────────────────
import { switchAuthTab, doLogin, doRegister, doLogout } from './core/auth.js';

// ── 3. Navigation + délégation d'événements ────
import { navigate, initEventDelegation } from './core/navigation.js';

// ── 4. Shared ──────────────────────────────────
import { openModal, closeModal, closeModalDirect } from './shared/modal.js';
import { showNotif }                               from './shared/notifications.js';

// ── 5. Features ────────────────────────────────
import './features/characters.js';
import './features/shop.js';
import './features/npcs.js';
import './features/story.js';
import './features/bastion.js';
import './features/world.js';
import './features/achievements.js';
import './features/collection.js';
import './features/players.js';
import './features/tutorial.js';
import './features/informations.js';
import './features/recettes.js';
import './features/bestiary.js';
import './features/photo-cropper.js';

// ── 6. Exposition temporaire sur window ────────
// A supprimer progressivement au fur et a mesure
// que les onclick inline sont migres vers data-action
Object.assign(window, {
  switchAuthTab, doLogin, doRegister, doLogout,
  navigate,
  openModal, closeModal, closeModalDirect,
  showNotif,
});

// ── 7. Delegation d'evenements ─────────────────
initEventDelegation();

// ── 8. Overlay modal (clic exterieur) ──────────
document.getElementById('modal-overlay')
  ?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) {
      closeModalDirect();
    }
  });
