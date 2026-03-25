// ══════════════════════════════════════════════
// FIRESTORE — Couche d'accès aux données
// Tous les appels DB passent ici.
// ══════════════════════════════════════════════

import {
  db,
  doc, setDoc, getDoc,
  collection, getDocs,
  addDoc, updateDoc, deleteDoc,
  query, where, orderBy,
} from '../config/firebase.js';

// ── Collections ────────────────────────────────
export async function loadCollection(col) {
  try {
    const snap = await getDocs(collection(db, col));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error(`[firestore] loadCollection(${col})`, e);
    return [];
  }
}

export async function loadCollectionOrdered(col, field) {
  try {
    const snap = await getDocs(query(collection(db, col), orderBy(field)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    return loadCollection(col);
  }
}

export async function loadCollectionWhere(col, field, op, value) {
  try {
    const snap = await getDocs(query(collection(db, col), where(field, op, value)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('[firestore] loadCollectionWhere', e);
    return [];
  }
}

// ── Documents ──────────────────────────────────
export async function getDocData(col, id) {
  try {
    const snap = await getDoc(doc(db, col, id));
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.error(`[firestore] getDocData(${col}/${id})`, e);
    return null;
  }
}

export async function saveDoc(col, id, data) {
  await setDoc(doc(db, col, id), data, { merge: true });
}

export async function addToCol(col, data) {
  const ref = await addDoc(collection(db, col), {
    ...data,
    createdAt: new Date().toISOString(),
  });
  return ref.id;
}

export async function updateInCol(col, id, data) {
  await updateDoc(doc(db, col, id), data);
}

export async function deleteFromCol(col, id) {
  await deleteDoc(doc(db, col, id));
}

// ── Spécifique personnages ─────────────────────
export async function loadChars(uid = null) {
  try {
    const q = uid
      ? query(collection(db, 'characters'), where('uid', '==', uid))
      : collection(db, 'characters');
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('[firestore] loadChars', e);
    return [];
  }
}

export async function countUserChars(uid = null) {
  const chars = await loadChars(uid);
  return chars.length;
}
