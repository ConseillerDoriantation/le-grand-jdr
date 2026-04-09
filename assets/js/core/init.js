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
} from "./state.js";

import { showApp, showAuth } from "./layout.js";
import { navigate } from "./navigation.js";

setFirebase(auth, db, {
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
  onAuthStateChanged,
  ADMIN_EMAIL,
});

// STATE est importé directement via ES modules — pas besoin de l'exposer sur window.

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
    console.error("[init] loadProfile failed:", error);
    setProfile({
      uid: user.uid,
      email: user.email,
      pseudo: (user.email && user.email.split("@")[0]) || "Aventurier",
    });
  }

  showApp();

  try {
    await navigate("dashboard");
  } catch (error) {
    console.error("[init] navigate(dashboard) failed:", error);
    const content = document.getElementById("main-content");

    if (content) {
      content.innerHTML =
        '<div class="card"><div class="card-header">Bienvenue</div><p>Connexion reussie, mais le tableau de bord na pas pu etre affiche.</p></div>';
    }
  }
});

async function loadProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    setProfile(snap.data());
    return;
  }

  // Aucun document pour cet UID — chercher si un doc avec le même email existe déjà
  // (évite les doublons quand quelqu'un crée deux comptes Auth avec le même email)
  try {
    const q = query(collection(db, "users"), where("email", "==", user.email));
    const existing = await getDocs(q);
    if (!existing.empty) {
      // Un profil existe déjà pour cet email — le réutiliser et le migrer vers ce nouvel UID
      const existingData = existing.docs[0].data();
      const profile = { ...existingData, uid: user.uid };
      await setDoc(ref, profile, { merge: true });
      setProfile(profile);
      return;
    }
  } catch (error) {
    console.error("[init] email duplicate check failed:", error);
  }

  // Vraiment nouveau joueur — créer le profil
  const profile = {
    uid: user.uid,
    email: user.email,
    pseudo: (user.email && user.email.split("@")[0]) || "Aventurier",
    createdAt: new Date().toISOString(),
  };

  try {
    await setDoc(ref, profile, { merge: true });
  } catch (error) {
    console.error("[init] setDoc profile failed:", error);
  }

  setProfile(profile);
}
