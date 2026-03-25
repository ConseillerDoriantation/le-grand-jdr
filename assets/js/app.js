// assets/js/app.js
// Point d'entrée unique

import './core/init.js';

import {
  switchAuthTab,
  doLogin,
  doRegister,
  doLogout,
  initAuth,
} from './core/auth.js';

import { showAuth, showApp } from './core/layout.js';
import { navigate, initEventDelegation } from './core/navigation.js';
import { openModal, closeModal, closeModalDirect } from './shared/modal.js';
import { showNotif } from './shared/notifications.js';

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
  showNotif,
});

initAuth();
initEventDelegation();

const overlay = document.getElementById('modal-overlay');
if (overlay) {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModalDirect();
  });
}
