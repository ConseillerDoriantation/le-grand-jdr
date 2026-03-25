// ══════════════════════════════════════════════
// INIT — Point d'entrée de l'application
// Remplace le pattern window._jdr + 'firebase-ready'
// ══════════════════════════════════════════════

import {
  auth, db, ADMIN_EMAIL,
  onAuthStateChanged,
  doc, setDoc, getDoc,
  collection, getDocs,
  addDoc, updateDoc, deleteDoc,
  query, where, orderBy,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from '../config/firebase.js';

import {
  STATE, setFirebase,
  setUser, setProfile, setAdmin,
} from './state.js';

import { showApp, showAuth } from './layout.js';
import { navigate }          from './navigation.js';

// ── Injection Firebase dans le state ───────────
setFirebase(auth, db, {
  doc, setDoc, getDoc,
  collection, getDocs,
  addDoc, updateDoc, deleteDoc,
  query, where, orderBy,
  ADMIN_EMAIL,
});

// ── Bootstrap auth ─────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    setUser(user);
    setAdmin(user.email === ADMIN_EMAIL);
    await _loadProfile(user);
    showApp();
    navigate('dashboard');
  } else {
    showAuth();
  }
});

// ── Chargement du profil utilisateur ───────────
async function _loadProfile(user) {
  const ref  = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    setProfile(snap.data());
  } else {
    const profile = {
      uid: user.uid, email: user.email,
      pseudo: user.email.split('@')[0],
      createdAt: new Date().toISOString(),
    };
    await setDoc(ref, profile);
    setProfile(profile);
  }
}
