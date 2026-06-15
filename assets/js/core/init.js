import {
  auth,
  db,
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

import { showAppLoading, showAuth, showAdventurePicker, showAdventureLoadError } from "./layout.js";
import { navigate } from "./navigation.js";
import { loadUserAdventures, repairCurrentUserAdventureLinks, selectAdventure } from "./adventure.js";
import { unwatchAll } from "../shared/realtime.js";
import { stopPresence } from "../shared/presence.js";
import { releaseSessionData } from "../data/firestore.js";

// Fonction disponible tot pour le picker, avant le lazy-load de aventures.js
const LAST_ADV_KEY = 'jdr-last-adventure';

export async function pickAdventure(adventureId) {
  const adv = STATE.adventures.find(a => a.id === adventureId);
  if (!adv) return;
  localStorage.setItem(LAST_ADV_KEY, adventureId);
  selectAdventure(adv);
  const { hideAdventurePicker } = await import('./layout.js');
  hideAdventurePicker();
  showAppLoading();
  await navigate('dashboard');
}

// openCreateAdventureModal est fourni par aventures.js (lazy).
// Pour le cas "zéro aventure" où aventures.js n'est pas encore chargé,
// on charge le module à la demande.
export async function openCreateAdventureModal() {
  const { openCreateAdventureModal: openModalLazy } = await import('../features/aventures.js');
  openModalLazy();
}

setFirebase(auth, db, {
  doc, setDoc, getDoc,
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged,
});


// ── Auth state ─────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Stoppe tous les abonnements Firestore avant de perdre l'auth
    // (sinon les listeners tirent avec auth=null → "Accès refusé")
    unwatchAll();
    releaseSessionData();
    stopPresence();
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

  // Super-admin = rôle serveur users/{uid}.isAdmin. Pas de bootstrap par email côté client.
  const isSuperAdmin = STATE.profile?.isAdmin === true;
  setSuperAdmin(isSuperAdmin);

  showAppLoading();

  // Pré-télécharger Konva en arrière-plan (utilisé par le VTT)
  // Chemin doit rester synchro avec assets/js/features/vtt.js (_loadKonva)
  // `prefetch` (pas `preload`) car la ressource n'est consommée qu'à la
  // navigation vers le VTT : `preload` déclencherait un warning navigateur
  // si l'utilisateur n'ouvre pas le VTT dans les premières secondes.
  if (!document.getElementById('preload-konva')) {
    const _kp = document.createElement('link');
    _kp.id = 'preload-konva';
    _kp.rel = 'prefetch';
    _kp.as = 'script';
    _kp.href = './assets/js/vendor/konva-10.3.0.min.js';
    document.head.appendChild(_kp);
  }

  // ── Charger les aventures accessibles ──────────
  await loadAndRouteAdventures(user);
});

// Charge les aventures du joueur et route vers le dashboard / le sélecteur.
// Robuste contre les faux "pas invité" au login :
//   – attend que le token Firestore soit prêt (sinon 1re requête sans token → refus) ;
//   – lit côté SERVEUR en priorité (ignore un cache IndexedDB périmé) ;
//   – retente quelques fois sur erreur transitoire ;
//   – sur échec persistant : écran "Réessayer", JAMAIS "En attente d'invitation".
// Exposée pour pouvoir être rappelée par le bouton "Réessayer".
async function loadAndRouteAdventures(user) {
  showAppLoading('Chargement de tes aventures…');

  // Le token peut ne pas encore être attaché à la 1re requête juste après login.
  try { await user.getIdToken(); } catch (_) { /* non bloquant */ }

  let adventures = null;
  for (let attempt = 0; attempt < 3 && adventures === null; attempt++) {
    try {
      adventures = await loadUserAdventures(user.uid, { preferServer: true, email: STATE.profile?.email || user.email });
    } catch (error) {
      console.warn(`[init] loadUserAdventures tentative ${attempt + 1} échouée:`, error?.code || error);
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
        try { await user.getIdToken(true); } catch (_) { /* force refresh token */ }
      }
    }
  }

  // Erreur réseau/permission persistante : le joueur est peut-être bien membre.
  // On ne l'envoie PAS vers "pas invité" — on propose un vrai retry.
  if (adventures === null) {
    showAdventureLoadError(() => loadAndRouteAdventures(user));
    return;
  }

  adventures = await repairCurrentUserAdventureLinks(adventures);
  setAdventures(adventures);

  if (adventures.length === 0) {
    // Sélecteur vide : super-admin → migration/création ; joueur → "En attente".
    showAdventurePicker([]);
    return;
  }

  if (adventures.length === 1) {
    selectAdventure(adventures[0]);
    showAppLoading();
    await navigate('dashboard');
    return;
  }

  // Plusieurs aventures → essayer de restaurer la dernière utilisée
  const lastId  = localStorage.getItem(LAST_ADV_KEY);
  const lastAdv = lastId && adventures.find(a => a.id === lastId);
  if (lastAdv) {
    selectAdventure(lastAdv);
    showAppLoading();
    await navigate('dashboard');
    return;
  }

  // Pas de mémorisation → sélecteur
  showAdventurePicker(adventures);
}

// ── Charger le profil utilisateur ──────────────
async function loadProfile(user) {
  const ref  = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    setProfile(snap.data());
    return;
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
