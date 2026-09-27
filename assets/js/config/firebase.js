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
         doc, setDoc as sdkSetDoc, getDoc as sdkGetDoc, getDocFromCache as sdkGetDocFromCache,
         collection, collectionGroup, getDocs as sdkGetDocs, getDocsFromServer as sdkGetDocsFromServer,
         addDoc as sdkAddDoc, updateDoc as sdkUpdateDoc, deleteDoc as sdkDeleteDoc,
         writeBatch as sdkWriteBatch, runTransaction as sdkRunTransaction,
         query, where, orderBy, limit,
         onSnapshot as sdkOnSnapshot,
         increment, deleteField,
         serverTimestamp, Timestamp } from 'firebase/firestore';
import { firebaseConfig }          from './firebase-config.js';
import { recordFirestoreRead, recordFirestoreWrite } from '../shared/firestore-metrics.js';

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

function _metricPath(ref) {
  return ref?.path
    || ref?._query?.path?.canonicalString?.()
    || ref?._key?.path?.canonicalString?.()
    || 'inconnu';
}

function _snapshotReadCount(snapshot, first) {
  if (!snapshot || snapshot.metadata?.fromCache) return 0;
  if (typeof snapshot.size === 'number') {
    if (first) return Math.max(1, snapshot.size);
    try { return snapshot.docChanges().length; } catch { return snapshot.size; }
  }
  return 1;
}

async function getDoc(ref) {
  const snapshot = await sdkGetDoc(ref);
  recordFirestoreRead(_metricPath(ref), 1, { cache: snapshot.metadata?.fromCache === true });
  return snapshot;
}

async function getDocFromCache(ref) {
  const snapshot = await sdkGetDocFromCache(ref);
  recordFirestoreRead(_metricPath(ref), 1, { cache: true });
  return snapshot;
}

async function getDocs(ref) {
  const snapshot = await sdkGetDocs(ref);
  recordFirestoreRead(_metricPath(ref), Math.max(1, snapshot.size || 0), { cache: snapshot.metadata?.fromCache === true });
  return snapshot;
}

async function getDocsFromServer(ref) {
  const snapshot = await sdkGetDocsFromServer(ref);
  recordFirestoreRead(_metricPath(ref), Math.max(1, snapshot.size || 0));
  return snapshot;
}

async function setDoc(ref, ...args) {
  const result = await sdkSetDoc(ref, ...args);
  recordFirestoreWrite(_metricPath(ref), 1);
  return result;
}

async function addDoc(ref, ...args) {
  const result = await sdkAddDoc(ref, ...args);
  recordFirestoreWrite(_metricPath(ref), 1);
  return result;
}

async function updateDoc(ref, ...args) {
  const result = await sdkUpdateDoc(ref, ...args);
  recordFirestoreWrite(_metricPath(ref), 1);
  return result;
}

async function deleteDoc(ref) {
  const result = await sdkDeleteDoc(ref);
  recordFirestoreWrite(_metricPath(ref), 1);
  return result;
}

function onSnapshot(ref, ...args) {
  let first = true;
  const wrapNext = next => snapshot => {
    recordFirestoreRead(_metricPath(ref), _snapshotReadCount(snapshot, first), { listener: true });
    first = false;
    return next(snapshot);
  };
  const observerIndex = args.findIndex(value => value && typeof value === 'object' && typeof value.next === 'function');
  if (observerIndex >= 0) {
    const observer = args[observerIndex];
    args[observerIndex] = { ...observer, next: wrapNext(observer.next.bind(observer)) };
  } else {
    const nextIndex = args.findIndex(value => typeof value === 'function');
    if (nextIndex >= 0) args[nextIndex] = wrapNext(args[nextIndex]);
  }
  return sdkOnSnapshot(ref, ...args);
}

function writeBatch(firestore) {
  const batch = sdkWriteBatch(firestore);
  const writes = [];
  const wrapped = {
    set(ref, ...args) { writes.push(_metricPath(ref)); batch.set(ref, ...args); return wrapped; },
    update(ref, ...args) { writes.push(_metricPath(ref)); batch.update(ref, ...args); return wrapped; },
    delete(ref) { writes.push(_metricPath(ref)); batch.delete(ref); return wrapped; },
    async commit() {
      const result = await batch.commit();
      const counts = new Map();
      writes.forEach(path => counts.set(path, (counts.get(path) || 0) + 1));
      counts.forEach((count, path) => recordFirestoreWrite(path, count));
      return result;
    },
  };
  return wrapped;
}

function runTransaction(firestore, updateFunction, options) {
  let committedWrites = [];
  return sdkRunTransaction(firestore, async transaction => {
    const attemptWrites = [];
    const wrapped = Object.create(transaction);
    wrapped.get = async ref => {
      const snapshot = await transaction.get(ref);
      recordFirestoreRead(_metricPath(ref), 1);
      return snapshot;
    };
    wrapped.set = (ref, ...args) => { attemptWrites.push(_metricPath(ref)); transaction.set(ref, ...args); return wrapped; };
    wrapped.update = (ref, ...args) => { attemptWrites.push(_metricPath(ref)); transaction.update(ref, ...args); return wrapped; };
    wrapped.delete = ref => { attemptWrites.push(_metricPath(ref)); transaction.delete(ref); return wrapped; };
    const result = await updateFunction(wrapped);
    committedWrites = attemptWrites;
    return result;
  }, options).then(result => {
    const counts = new Map();
    committedWrites.forEach(path => counts.set(path, (counts.get(path) || 0) + 1));
    counts.forEach((count, path) => recordFirestoreWrite(path, count));
    return result;
  });
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
  doc, setDoc, getDoc, getDocFromCache,
  collection, collectionGroup, getDocs, getDocsFromServer,
  addDoc, updateDoc, deleteDoc,
  writeBatch, runTransaction,
  query, where, orderBy, limit,
  onSnapshot,
  increment, deleteField,
  serverTimestamp, Timestamp,
};
