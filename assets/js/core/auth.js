// ══════════════════════════════════════════════
// AUTH — Connexion / Inscription / Déconnexion
// ══════════════════════════════════════════════

import {
  auth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from '../config/firebase.js';

import { db }          from '../config/firebase.js';
import { doc, setDoc } from '../config/firebase.js';

// ── Basculer les onglets connexion/inscription ──
export function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t, i) =>
    t.classList.toggle('active', tab === 'login' ? i === 0 : i === 1)
  );
  document.getElementById('tab-login').style.display    = tab === 'login'    ? 'block' : 'none';
  document.getElementById('tab-register').style.display = tab === 'register' ? 'block' : 'none';
  _setAuthError('');
}

// ── Connexion ──────────────────────────────────
export async function doLogin() {
  const email = document.getElementById('login-email')?.value.trim();
  const pwd   = document.getElementById('login-password')?.value;
  if (!email || !pwd) return _setAuthError('Remplis tous les champs.');
  try {
    await signInWithEmailAndPassword(auth, email, pwd);
  } catch (e) { _setAuthError(_getAuthError(e.code)); }
}

// ── Inscription ────────────────────────────────
export async function doRegister() {
  const pseudo = document.getElementById('reg-pseudo')?.value.trim();
  const email  = document.getElementById('reg-email')?.value.trim();
  const pwd    = document.getElementById('reg-password')?.value;
  if (!pseudo || !email || !pwd) return _setAuthError('Remplis tous les champs.');
  if (pwd.length < 6) return _setAuthError('Mot de passe trop court (6 car. min).');
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pwd);
    await setDoc(doc(db, 'users', cred.user.uid), {
      uid: cred.user.uid, email, pseudo,
      createdAt: new Date().toISOString(),
    });
  } catch (e) { _setAuthError(_getAuthError(e.code)); }
}

// ── Déconnexion ────────────────────────────────
export async function doLogout() {
  await signOut(auth);
}

// ── Helpers privés ─────────────────────────────
function _setAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (el) el.textContent = msg;
}

function _getAuthError(code) {
  const map = {
    'auth/invalid-email':        'Email invalide.',
    'auth/user-not-found':       'Compte introuvable.',
    'auth/wrong-password':       'Mot de passe incorrect.',
    'auth/email-already-in-use': 'Email déjà utilisé.',
    'auth/weak-password':        'Mot de passe trop faible.',
    'auth/invalid-credential':   'Email ou mot de passe incorrect.',
  };
  return map[code] ?? `Erreur : ${code}`;
}refactor(auth): proper ES module imports
