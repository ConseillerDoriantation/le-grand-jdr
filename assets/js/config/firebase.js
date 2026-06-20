// ══════════════════════════════════════════════
// CONFIG FIREBASE — ES Module pur
// Aucun effet de bord sur window.*
// ══════════════════════════════════════════════

// Specifiers bare résolus par l'import map de index.html (version du SDK centralisée là-bas).
import { initializeApp }          from 'firebase/app';
import { getAuth,
         createUserWithEmailAndPassword,
         signInWithEmailAndPassword,
         signOut,
         onAuthStateChanged,
         GoogleAuthProvider,
         signInWithPopup,
         sendPasswordResetEmail } from 'firebase/auth';
import { initializeFirestore,
         persistentLocalCache,
         persistentMultipleTabManager,
         doc, setDoc, getDoc,
         collection, getDocs, getDocsFromServer,
         addDoc, updateDoc, deleteDoc,
         writeBatch,
         query, where, orderBy, limit,
         onSnapshot,
         increment,
         serverTimestamp, Timestamp } from 'firebase/firestore';
import { firebaseConfig }          from './firebase-config.js';

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Persistance IndexedDB : Firestore sert les lectures depuis le cache local
// avant tout aller-retour réseau. Combiné avec onSnapshot, ça permet aux pages
// déjà visitées de réafficher leurs données instantanément, et coupe la
// majorité des lectures facturées entre sessions / reloads.
// `persistentMultipleTabManager` rend le cache compatible avec plusieurs onglets.
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (e) {
  // Fallback (navigateur sans IndexedDB, mode privé restrictif, etc.)
  console.warn('[firebase] persistance IndexedDB indisponible, fallback mémoire :', e?.message || e);
  db = initializeFirestore(app, {});
}


export {
  auth, db,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
  doc, setDoc, getDoc,
  collection, getDocs, getDocsFromServer,
  addDoc, updateDoc, deleteDoc,
  writeBatch,
  query, where, orderBy, limit,
  onSnapshot,
  increment,
  serverTimestamp, Timestamp,
};
