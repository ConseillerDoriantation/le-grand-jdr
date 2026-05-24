// ══════════════════════════════════════════════
// CONFIG FIREBASE — ES Module pur
// Aucun effet de bord sur window.*
// ══════════════════════════════════════════════

import { initializeApp }          from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth,
         createUserWithEmailAndPassword,
         signInWithEmailAndPassword,
         signOut,
         onAuthStateChanged,
         GoogleAuthProvider,
         signInWithPopup }        from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { initializeFirestore,
         persistentLocalCache,
         persistentMultipleTabManager,
         doc, setDoc, getDoc,
         collection, getDocs,
         addDoc, updateDoc, deleteDoc,
         writeBatch,
         query, where, orderBy, limit,
         onSnapshot,
         serverTimestamp }         from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey:            'AIzaSyAetYIzoPMnXwL9TjKLjzKCGyrjwFgBNxU',
  authDomain:        'le-grand-jdr.firebaseapp.com',
  projectId:         'le-grand-jdr',
  storageBucket:     'le-grand-jdr.firebasestorage.app',
  messagingSenderId: '641426541133',
  appId:             '1:641426541133:web:c4c55d900ae6304bcf6a04',
};

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

// ⚠️  Côté client uniquement — la vraie protection est dans les règles Firestore.
//    Voir docs/firestore-rules.md
const ADMIN_EMAIL = 'dorianferrer02@gmail.com';

export {
  auth, db, ADMIN_EMAIL,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  doc, setDoc, getDoc,
  collection, getDocs,
  addDoc, updateDoc, deleteDoc,
  writeBatch,
  query, where, orderBy, limit,
  onSnapshot,
  serverTimestamp,
};
