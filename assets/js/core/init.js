import {
  auth,
  db,
  ADMIN_EMAIL,
  onAuthStateChanged,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "../config/firebase.js";

import {
  STATE,
  setFirebase,
  setUser,
  setProfile,
  setAdmin,
  setSuperAdmin,
  setAdventures,
} from "./state.js";

import { showApp, showAuth, showAdventurePicker } from "./layout.js";
import { navigate } from "./navigation.js";
import { loadUserAdventures, selectAdventure, runMigration } from "./adventure.js";

// Exposer pickAdventure tôt (avant lazy-load de aventures.js)
// pour que le picker HTML puisse l'appeler
const LAST_ADV_KEY = 'jdr-last-adventure';

window.pickAdventure = async (adventureId) => {
  const adv = STATE.adventures.find(a => a.id === adventureId);
  if (!adv) return;
  localStorage.setItem(LAST_ADV_KEY, adventureId);
  selectAdventure(adv);
  const { hideAdventurePicker } = await import('./layout.js');
  hideAdventurePicker();
  showApp();
  await navigate('dashboard');
};

// openCreateAdventureModal est fourni par aventures.js (lazy).
// Pour le cas "zéro aventure" où aventures.js n'est pas encore chargé,
// on charge le module à la demande.
window.openCreateAdventureModal = async () => {
  if (!window._openCreateAdventureModalImpl) {
    await import('../features/aventures.js');
  }
  window._openCreateAdventureModalImpl?.();
};

setFirebase(auth, db, {
  doc, setDoc, getDoc,
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, ADMIN_EMAIL,
});

window.STATE = STATE;

// ── Auth state ─────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    setUser(null);
    setProfile(null);
    setAdmin(false);
    setSuperAdmin(false);
    setAdventures([]);
    showAuth();
    return;
  }

  setUser(user);

  try {
    await loadProfile(user);
  } catch (error) {
    console.error("[init] loadProfile failed:", error);
    setProfile({
      uid:    user.uid,
      email:  user.email,
      pseudo: user.email?.split('@')[0] || 'Aventurier',
    });
  }

  // Super-admin = profile.isAdmin OU email legacy hardcodé (bootstrap)
  const isSuperAdmin = STATE.profile?.isAdmin === true || user.email === ADMIN_EMAIL;
  setSuperAdmin(isSuperAdmin);

  showApp();

  // ── Charger les aventures accessibles ──────────
  try {
    const adventures = await loadUserAdventures(user.uid);
    setAdventures(adventures);

    if (adventures.length === 0) {
      // Affiche le sélecteur vide :
      // – super-admin → bouton "Récupérer mes données" + "Créer une aventure"
      // – joueur      → message "En attente d'invitation"
      showAdventurePicker([]);
      return;
    }

    if (adventures.length === 1) {
      selectAdventure(adventures[0]);
      showApp();
      await navigate('dashboard');
      return;
    }

    // Plusieurs aventures → essayer de restaurer la dernière utilisée
    const lastId  = localStorage.getItem(LAST_ADV_KEY);
    const lastAdv = lastId && adventures.find(a => a.id === lastId);
    if (lastAdv) {
      selectAdventure(lastAdv);
      showApp();
      await navigate('dashboard');
      return;
    }

    // Pas de mémorisation → sélecteur
    showAdventurePicker(adventures);
  } catch (error) {
    console.error("[init] loadUserAdventures failed:", error);
    showAdventurePicker([]);
  }
});

// ── Charger le profil utilisateur ──────────────
async function loadProfile(user) {
  const ref  = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    setProfile(snap.data());
    return;
  }

  // Chercher si un profil existe déjà pour cet email (doublon)
  try {
    const q        = query(collection(db, "users"), where("email", "==", user.email));
    const existing = await getDocs(q);
    if (!existing.empty) {
      const existingData = existing.docs[0].data();
      const profile = { ...existingData, uid: user.uid };
      await setDoc(ref, profile, { merge: true });
      setProfile(profile);
      return;
    }
  } catch (error) {
    console.error("[init] email duplicate check failed:", error);
  }

  // Nouveau joueur
  const profile = {
    uid:       user.uid,
    email:     user.email,
    pseudo:    user.email?.split('@')[0] || 'Aventurier',
    isAdmin:   false,
    createdAt: new Date().toISOString(),
  };

  try {
    await setDoc(ref, profile, { merge: true });
  } catch (error) {
    console.error("[init] setDoc profile failed:", error);
  }

  setProfile(profile);
}

// ── Migration depuis le picker ─────────────────
// Appelé par le bouton "Récupérer mes données" sur l'écran sélecteur vide.
// Aussi déclenché automatiquement si super-admin et zéro aventures.
async function _runMigrationFromPicker(uid) {
  const logEl  = document.getElementById('picker-migrate-log');
  const btnEl  = document.querySelector('[onclick="window._runMigrationFromPicker?.()"]');

  if (logEl) { logEl.style.display = 'block'; logEl.innerHTML = ''; }
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '⏳ Migration en cours…'; }

  const log = (msg) => {
    console.info('[migration]', msg);
    if (logEl) { logEl.innerHTML += `<div>${msg}</div>`; logEl.scrollTop = logEl.scrollHeight; }
  };

  try {
    log('Démarrage de la migration…');
    await runMigration(log);

    log('Chargement de l\'aventure…');
    const adventures = await loadUserAdventures(uid);
    setAdventures(adventures);

    if (adventures.length > 0) {
      selectAdventure(adventures[0]);
      showApp();
      await navigate('dashboard');
    } else {
      log('⚠️ Migration terminée mais aventure introuvable — recharge la page.');
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = '🔄 Réessayer'; }
    }
  } catch (e) {
    console.error('[init] Migration échouée :', e);
    log(`❌ Erreur : ${e.message}`);
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = '🔄 Réessayer'; }
  }
}

// Exposer pour le bouton HTML du picker
window._runMigrationFromPicker = () => _runMigrationFromPicker(STATE.user?.uid);
