// ══════════════════════════════════════════════
// AUTH — Connexion / Inscription / Déconnexion
// ══════════════════════════════════════════════

import {
  auth,
  db,
  doc,
  setDoc,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from '../config/firebase.js';

import { STATE, setProfile } from './state.js';
export { showApp, showAuth } from './layout.js';

function clearAuthError() {
  const errorBox = document.getElementById('auth-error');
  if (errorBox) errorBox.textContent = '';
}

export function setAuthError(message) {
  const errorBox = document.getElementById('auth-error');
  if (errorBox) errorBox.textContent = message || '';
}

export function getAuthError(error) {
  const code = error?.code || '';
  const message = error?.message || '';

  const map = {
    'auth/invalid-email': 'Email invalide.',
    'auth/user-not-found': 'Compte introuvable.',
    'auth/wrong-password': 'Mot de passe incorrect.',
    'auth/invalid-credential': 'Email ou mot de passe incorrect.',
    'auth/email-already-in-use': 'Cet email est déjà utilisé.',
    'auth/weak-password': 'Mot de passe trop faible.',
    'auth/missing-password': 'Mot de passe manquant.',
    'auth/network-request-failed': 'Erreur réseau. Réessaie.',
    'auth/too-many-requests': 'Trop de tentatives. Réessaie plus tard.',
  };

  return map[code] || message || 'Erreur inconnue pendant l’authentification.';
}

function setButtonLoading(button, isLoading, loadingText) {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = loadingText;
    return;
  }
  button.disabled = false;
  button.textContent = button.dataset.originalText || button.textContent;
}

function getLoginButton() {
  return document.querySelector('[data-action="login"]') || document.querySelector('#tab-login .btn-primary');
}

function getRegisterButton() {
  return document.querySelector('[data-action="register"]') || document.querySelector('#tab-register .btn-primary');
}

export function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  document.querySelectorAll('.auth-tab').forEach((el, index) => {
    el.classList.toggle('active', isLogin ? index === 0 : index === 1);
  });
  const loginPanel = document.getElementById('tab-login');
  const registerPanel = document.getElementById('tab-register');
  if (loginPanel) loginPanel.style.display = isLogin ? 'block' : 'none';
  if (registerPanel) registerPanel.style.display = isLogin ? 'none' : 'block';
  clearAuthError();
}

async function saveProfile(user, pseudo) {
  const profile = {
    uid: user.uid,
    email: user.email,
    pseudo: pseudo || user.email?.split('@')[0] || 'Aventurier',
    createdAt: new Date().toISOString(),
  };
  await setDoc(doc(db, 'users', user.uid), profile, { merge: true });
  setProfile(profile);
}

export async function doLogin() {
  clearAuthError();
  const email = document.getElementById('login-email')?.value?.trim() || '';
  const password = document.getElementById('login-password')?.value || '';

  if (!email || !password) {
    setAuthError('Remplis tous les champs.');
    return;
  }

  const button = getLoginButton();
  try {
    setButtonLoading(button, true, 'Connexion...');
    await signInWithEmailAndPassword(auth, email, password);
    clearAuthError();
  } catch (error) {
    console.error('doLogin error:', error);
    setAuthError(getAuthError(error));
  } finally {
    setButtonLoading(button, false);
  }
}

export async function doRegister() {
  clearAuthError();
  const pseudo = document.getElementById('reg-pseudo')?.value?.trim() || '';
  const email = document.getElementById('reg-email')?.value?.trim() || '';
  const password = document.getElementById('reg-password')?.value || '';

  if (!pseudo || !email || !password) {
    setAuthError('Remplis tous les champs.');
    return;
  }
  if (password.length < 6) {
    setAuthError('Mot de passe trop court (6 caractères minimum).');
    return;
  }

  const button = getRegisterButton();
  try {
    setButtonLoading(button, true, 'Création...');
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await saveProfile(credential.user, pseudo);
    clearAuthError();
    window.showNotif?.('Compte créé avec succès.', 'success');
  } catch (error) {
    console.error('doRegister error:', error);
    setAuthError(getAuthError(error));
  } finally {
    setButtonLoading(button, false);
  }
}

export async function doLogout() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('doLogout error:', error);
    setAuthError(getAuthError(error));
  }
}

function handleAuthKeydown(event) {
  if (event.key !== 'Enter') return;
  const authScreen = document.getElementById('auth-screen');
  if (!authScreen || authScreen.style.display === 'none') return;
  const registerVisible = document.getElementById('tab-register')?.style.display !== 'none';
  if (registerVisible) doRegister();
  else doLogin();
}

export function bindAuthUI() {
  if (window.__authUiBound) return;
  window.__authUiBound = true;

  document.addEventListener('keydown', handleAuthKeydown);
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'login') { event.preventDefault(); doLogin(); return; }
    if (action === 'register') { event.preventDefault(); doRegister(); return; }
    if (action === 'logout') { event.preventDefault(); doLogout(); return; }
    if (action === 'auth-tab-login') { event.preventDefault(); switchAuthTab('login'); return; }
    if (action === 'auth-tab-register') { event.preventDefault(); switchAuthTab('register'); }
  });
}

export function initAuth() {
  bindAuthUI();
  Object.assign(window, {
    switchAuthTab,
    doLogin,
    doRegister,
    doLogout,
  });
}
