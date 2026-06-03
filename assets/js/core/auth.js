// ══════════════════════════════════════════════
// AUTH — Connexion / Inscription / Déconnexion
// ══════════════════════════════════════════════

import {
  auth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
} from '../config/firebase.js';

import { setProfile } from './state.js';
import { unwatchAll } from '../shared/realtime.js';
import { releaseSessionData, saveDoc } from '../data/firestore.js';
export { showApp, showAuth } from './layout.js';

function clearAuthError() {
  const errorBox = document.getElementById('auth-error');
  if (errorBox) errorBox.textContent = '';
}

let _authUiBound = false;

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
    'auth/missing-email': 'Email manquant.',
    'auth/network-request-failed': 'Erreur réseau. Réessaie.',
    'auth/too-many-requests': 'Trop de tentatives. Réessaie plus tard.',
    'auth/popup-closed-by-user': 'Fenêtre Google fermée avant la fin.',
    'auth/popup-blocked': 'Fenêtre Google bloquée par le navigateur.',
    'auth/cancelled-popup-request': '',
    'auth/account-exists-with-different-credential':
      'Un compte existe déjà avec cet email. Connecte-toi avec l’email/mot de passe.',
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
  return document.querySelector('[data-action="login"]');
}

function getRegisterButton() {
  return document.querySelector('[data-action="register"]');
}

function getLoginTabButton() {
  return document.querySelector('[data-action="auth-tab-login"]');
}

function getRegisterTabButton() {
  return document.querySelector('[data-action="auth-tab-register"]');
}

export function switchAuthTab(tab) {
  const isLogin = tab === 'login';

  const loginTab = getLoginTabButton();
  const registerTab = getRegisterTabButton();
  const loginPanel = document.getElementById('tab-login');
  const registerPanel = document.getElementById('tab-register');

  if (loginTab) loginTab.classList.toggle('active', isLogin);
  if (registerTab) registerTab.classList.toggle('active', !isLogin);

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

  await saveDoc('users', user.uid, profile);
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
    console.error('[auth] doLogin error:', error);
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
    showNotif('Compte créé avec succès.', 'success');
  } catch (error) {
    console.error('[auth] doRegister error:', error);
    setAuthError(getAuthError(error));
  } finally {
    setButtonLoading(button, false);
  }
}

export async function doPasswordReset() {
  clearAuthError();

  const email = document.getElementById('login-email')?.value?.trim() || '';

  if (!email) {
    setAuthError('Saisis ton email pour recevoir le lien de réinitialisation.');
    document.getElementById('login-email')?.focus();
    return;
  }

  const link = document.querySelector('[data-action="forgot-pw"]');
  const originalText = link?.textContent;

  try {
    if (link) { link.style.pointerEvents = 'none'; link.textContent = 'Envoi...'; }
    await sendPasswordResetEmail(auth, email);
    showNotif(
      `Un email de réinitialisation a été envoyé à ${email}.`,
      'success'
    );
  } catch (error) {
    console.error('[auth] doPasswordReset error:', error);
    setAuthError(getAuthError(error));
  } finally {
    if (link) { link.style.pointerEvents = ''; link.textContent = originalText; }
  }
}

export async function doGoogleLogin() {
  clearAuthError();

  const button = document.querySelector('[data-action="google-login"]');

  try {
    setButtonLoading(button, true, 'Connexion...');
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
    clearAuthError();
  } catch (error) {
    console.error('[auth] doGoogleLogin error:', error);
    setAuthError(getAuthError(error));
  } finally {
    setButtonLoading(button, false);
  }
}

export async function doLogout() {
  try {
    // Stoppe d'abord les abonnements temps réel pour éviter les
    // "Accès refusé" lorsque l'auth est révoquée.
    try { unwatchAll(); } catch {}
    try { releaseSessionData(); } catch {}
    await signOut(auth);
  } catch (error) {
    console.error('[auth] doLogout error:', error);
    setAuthError(getAuthError(error));
  }
}

function handleAuthKeydown(event) {
  if (event.key !== 'Enter') return;

  const authScreen = document.getElementById('auth-screen');
  if (!authScreen || authScreen.style.display === 'none') return;

  const registerVisible =
    document.getElementById('tab-register')?.style.display !== 'none';

  if (registerVisible) doRegister();
  else doLogin();
}

export function bindAuthUI() {
  if (_authUiBound) return;
  _authUiBound = true;

  const loginBtn = getLoginButton();
  const registerBtn = getRegisterButton();
  const googleBtn = document.querySelector('[data-action="google-login"]');
  const loginTab = getLoginTabButton();
  const registerTab = getRegisterTabButton();
  const logoutBtn = document.querySelector('[data-action="logout"]');
  const forgotLink = document.querySelector('[data-action="forgot-pw"]');

  if (loginBtn) {
    loginBtn.addEventListener('click', (e) => {
      e.preventDefault();
      doLogin();
    });
  }

  if (registerBtn) {
    registerBtn.addEventListener('click', (e) => {
      e.preventDefault();
      doRegister();
    });
  }

  if (googleBtn) {
    googleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      doGoogleLogin();
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      doLogout();
    });
  }

  if (loginTab) {
    loginTab.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthTab('login');
    });
  }

  if (registerTab) {
    registerTab.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthTab('register');
    });
  }

  if (forgotLink) {
    forgotLink.addEventListener('click', (e) => {
      e.preventDefault();
      doPasswordReset();
    });
  }

  document.addEventListener('keydown', handleAuthKeydown);
}

export function initAuth() {
  bindAuthUI();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuth, { once: true });
} else {
  initAuth();
}
