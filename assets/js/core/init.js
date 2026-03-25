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
  await loadProfile(user);
  showApp();
  navigate('dashboard');
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
  await setDoc(ref, profile, { merge: true });
  setProfile(profile);
}
