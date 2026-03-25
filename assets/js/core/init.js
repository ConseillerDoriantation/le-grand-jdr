// ══════════════════════════════════════════════
// INIT — Bootstrap Firebase + listener d'auth
// ══════════════════════════════════════════════

import {
  auth, db, ADMIN_EMAIL,
  onAuthStateChanged,
  doc, setDoc, getDoc,
} from '../config/firebase.js';

import {
  STATE,
  setFirebase,
  setUser,
  setProfile,
  setAdmin,
} from './state.js';

import { showApp, showAuth } from './layout.js';
import { navigate } from './navigation.js';

setFirebase(auth, db, {
  doc,
  setDoc,
  getDoc,
  ADMIN_EMAIL,
});

let authListenerBound = false;

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
    pseudo: user.email ? user.email.split('@')[0] : 'Aventurier',
    createdAt: new Date().toISOString(),
  };

  await setDoc(ref, profile, { merge: true });
  setProfile(profile);
}

export function initAppAuthListener() {
  if (authListenerBound) return;
  authListenerBound = true;

  onAuthStateChanged(auth, async (user) => {
    try {
      if (user) {
        setUser(user);
        setAdmin(user.email === ADMIN_EMAIL);
        await loadProfile(user);
        showApp();
        navigate(STATE.currentPage || 'dashboard');
      } else {
        setUser(null);
        setProfile(null);
        setAdmin(false);
        showAuth();
      }
    } catch (error) {
      console.error('[init] auth bootstrap failed:', error);
      showAuth();
    }
  });
}

initAppAuthListener();
