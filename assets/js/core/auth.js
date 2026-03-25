// ══════════════════════════════════════════════
// AUTH — Connexion / Inscription / Déconnexion
// ══════════════════════════════════════════════
// assets/js/core/auth.js

function getJdr() {
  return window._jdr || {};
}

function getAuthInstance() {
  const jdr = getJdr();
  return jdr.auth || null;
}

function getDbInstance() {
  const jdr = getJdr();
  return jdr.db || null;
}

function getState() {
  if (window.STATE && typeof window.STATE === 'object') return window.STATE;
  if (window.APP_STATE && typeof window.APP_STATE === 'object') return window.APP_STATE;
  return null;
}

function getProfileRef(db, uid) {
  const jdr = getJdr();
  if (!jdr.doc) return null;
  return jdr.doc(db, 'users', uid);
}

function notify(message, type = 'error') {
  if (typeof window.showNotif === 'function') {
    window.showNotif(message, type);
    return;
  }

  const errorBox = document.getElementById('auth-error');
  if (errorBox) {
    errorBox.textContent = message || '';
  }
}

function clearAuthError() {
  const errorBox = document.getElementById('auth-error');
  if (errorBox) {
    errorBox.textContent = '';
  }
}

export function setAuthError(message) {
  const errorBox = document.getElementById('auth-error');
  if (errorBox) {
    errorBox.textContent = message || '';
  }
}

export function getAuthError(error) {
  const code = error && error.code ? error.code : '';
  const message = error && error.message ? error.message : '';

  const map = {
    'auth/invalid-email': 'Email invalide.',
    'auth/user-not-found': 'Compte introuvable.',
    'auth/wrong-password': 'Mot de passe incorrect.',
    'auth/invalid-credential': 'Email ou mot de passe incorrect.',
    'auth/email-already-in-use': 'Cet email est déjà utilisé.',
    'auth/weak-password': 'Mot de passe trop faible.',
    'auth/missing-password': 'Mot de passe manquant.',
    'auth/network-request-failed': 'Erreur réseau. Réessaie.',
    'auth/too-many-requests': 'Trop de tentatives. Réessaie plus tard.'
  };

  return map[code] || message || 'Erreur inconnue pendant l’authentification.';
}

function setButtonLoading(button, isLoading, loadingText) {
  if (!button) return;

  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = loadingText;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

function getLoginButton() {
  return (
    document.querySelector('[data-action="login"]') ||
    document.querySelector('#tab-login .btn-primary') ||
    null
  );
}

function getRegisterButton() {
  return (
    document.querySelector('[data-action="register"]') ||
    document.querySelector('#tab-register .btn-primary') ||
    null
  );
}

export function switchAuthTab(tab) {
  const isLogin = tab === 'login';

  const tabs = document.querySelectorAll('.auth-tab');
  tabs.forEach((el, index) => {
    el.classList.toggle('active', isLogin ? index === 0 : index === 1);
  });

  const loginPanel = document.getElementById('tab-login');
  const registerPanel = document.getElementById('tab-register');

  if (loginPanel) {
    loginPanel.style.display = isLogin ? 'block' : 'none';
  }

  if (registerPanel) {
    registerPanel.style.display = isLogin ? 'none' : 'block';
  }

  clearAuthError();
}

async function signInWithFirebase(auth, email, password) {
  const jdr = getJdr();

  if (typeof jdr.signInWithEmailAndPassword === 'function') {
    return jdr.signInWithEmailAndPassword(auth, email, password);
  }

  if (auth && typeof auth.signInWithEmailAndPassword === 'function') {
    return auth.signInWithEmailAndPassword(email, password);
  }

  throw new Error('Firebase Auth non initialisé.');
}

async function createUserWithFirebase(auth, email, password) {
  const jdr = getJdr();

  if (typeof jdr.createUserWithEmailAndPassword === 'function') {
    return jdr.createUserWithEmailAndPassword(auth, email, password);
  }

  if (auth && typeof auth.createUserWithEmailAndPassword === 'function') {
    return auth.createUserWithEmailAndPassword(email, password);
  }

  throw new Error('Firebase Auth non initialisé.');
}

async function signOutWithFirebase(auth) {
  const jdr = getJdr();

  if (typeof jdr.signOut === 'function') {
    return jdr.signOut(auth);
  }

  if (auth && typeof auth.signOut === 'function') {
    return auth.signOut();
  }

  throw new Error('Firebase Auth non initialisé.');
}

async function saveProfile(user, pseudo) {
  const jdr = getJdr();
  const db = getDbInstance();

  if (!user || !db || !jdr.setDoc || !jdr.doc) return;

  const profile = {
    uid: user.uid,
    email: user.email,
    pseudo: pseudo || (user.email ? user.email.split('@')[0] : 'Aventurier'),
    createdAt: new Date().toISOString()
  };

  await jdr.setDoc(getProfileRef(db, user.uid), profile, { merge: true });

  const state = getState();
  if (state) {
    state.profile = profile;
  }
}

export async function doLogin() {
  clearAuthError();

  const auth = getAuthInstance();
  if (!auth) {
    setAuthError('Firebase Auth n’est pas initialisé.');
    return;
  }

  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');

  const email = emailInput ? emailInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';

  if (!email || !password) {
    setAuthError('Remplis tous les champs.');
    return;
  }

  const button = getLoginButton();

  try {
    setButtonLoading(button, true, 'Connexion...');
    await signInWithFirebase(auth, email, password);
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

  const auth = getAuthInstance();
  if (!auth) {
    setAuthError('Firebase Auth n’est pas initialisé.');
    return;
  }

  const pseudoInput = document.getElementById('reg-pseudo');
  const emailInput = document.getElementById('reg-email');
  const passwordInput = document.getElementById('reg-password');

  const pseudo = pseudoInput ? pseudoInput.value.trim() : '';
  const email = emailInput ? emailInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';

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
    const credential = await createUserWithFirebase(auth, email, password);
    await saveProfile(credential.user, pseudo);
    clearAuthError();
    notify('Compte créé avec succès.', 'success');
  } catch (error) {
    console.error('doRegister error:', error);
    setAuthError(getAuthError(error));
  } finally {
    setButtonLoading(button, false);
  }
}

export async function doLogout() {
  const auth = getAuthInstance();
  if (!auth) {
    setAuthError('Firebase Auth n’est pas initialisé.');
    return;
  }

  try {
    await signOutWithFirebase(auth);
  } catch (error) {
    console.error('doLogout error:', error);
    setAuthError(getAuthError(error));
  }
}

export function showAuth() {
  const authScreen = document.getElementById('auth-screen');
  const app = document.getElementById('app');

  if (authScreen) authScreen.style.display = 'flex';
  if (app) app.style.display = 'none';

  clearAuthError();
}

export function showApp() {
  const authScreen = document.getElementById('auth-screen');
  const app = document.getElementById('app');
  const headerUsername = document.getElementById('header-username');
  const adminBadge = document.getElementById('admin-badge');

  if (authScreen) authScreen.style.display = 'none';
  if (app) app.style.display = 'block';

  const state = getState();
  if (headerUsername && state) {
    headerUsername.textContent =
      (state.profile && state.profile.pseudo) ||
      (state.user && state.user.email) ||
      '';
  }

  if (adminBadge) {
    adminBadge.style.display = state && state.isAdmin ? 'inline' : 'none';
  }

  document.querySelectorAll('.admin-only').forEach((el) => {
    el.style.display = state && state.isAdmin ? 'flex' : 'none';
  });
}

function handleAuthKeydown(event) {
  if (event.key !== 'Enter') return;

  const authScreen = document.getElementById('auth-screen');
  if (!authScreen || authScreen.style.display === 'none') return;

  const registerPanel = document.getElementById('tab-register');
  const isRegisterVisible =
    registerPanel && registerPanel.style.display !== 'none';

  if (isRegisterVisible) {
    doRegister();
  } else {
    doLogin();
  }
}

export function bindAuthUI() {
  document.addEventListener('keydown', handleAuthKeydown);

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;

    if (action === 'login') {
      event.preventDefault();
      doLogin();
      return;
    }

    if (action === 'register') {
      event.preventDefault();
      doRegister();
      return;
    }

    if (action === 'logout') {
      event.preventDefault();
      doLogout();
      return;
    }

    if (action === 'auth-tab-login') {
      event.preventDefault();
      switchAuthTab('login');
      return;
    }

    if (action === 'auth-tab-register') {
      event.preventDefault();
      switchAuthTab('register');
    }
  });
}

export function initAuth() {
  bindAuthUI();

  // Compatibilité avec l’ancien HTML encore en onclick=""
  window.switchAuthTab = switchAuthTab;
  window.doLogin = doLogin;
  window.doRegister = doRegister;
  window.doLogout = doLogout;
  window.showAuth = showAuth;
  window.showApp = showApp;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuth, { once: true });
} else {
  initAuth();
}
