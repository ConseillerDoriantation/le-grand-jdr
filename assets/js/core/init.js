// ══════════════════════════════════════════════
// INIT — Bootstrap Firebase + auth state listener
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
import { navigate } from './navigation.js';

setFirebase(auth, db, {
  doc, setDoc, getDoc,
  collection, getDocs,
  addDoc, updateDoc, deleteDoc,
  query, where, orderBy,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  ADMIN_EMAIL,
});

window.STATE = STATE;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    setUser(null);
    setProfile(null);
    setAdmin(false);
    showAuth();
    return;
  }

  setUser(user);
  setAdmin(user.email === ADMIN_EMAIL);

  try {
    await loadProfile(user);
  } catch (error) {
    console.error('[init] loadProfile failed:', error);
    setProfile({
      uid: user.uid,
      email: user.email,
      pseudo: user.email?.split('@')[0] || 'Aventurier',
    });
  }

  showApp();

  try {
    await navigate('dashboard');
  } catch (error) {
    console.error('[init] navigate(dashboard) failed:', error);
    const content = document.getElementById('main-content');
    if (content) {
      content.innerHTML = `<div class="card"><div class="card-header">Bienvenue</div><p>Connexion réussie, mais le tableau de bord n'a pas pu être affiché.</p></div>`;  }
});

async function loadProfile(user) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    setProfile(snap.data());
    return;
  }

  const profile = {
    uid: user.uid,
    email: user.email,
    pseudo: user.email?.split('@')[0] || 'Aventurier',
    createdAt: new Date().toISOString(),
  };
  try {
    await setDoc(ref, profile, { merge: true });
  } catch (error) {
    console.error('[init] setDoc profile failed:', error);
  }
  setProfile(profile);
}
