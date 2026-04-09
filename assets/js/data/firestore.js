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

// ── Gestionnaire d'erreur centralisé ───────────
// Affiche un toast si showNotif est disponible, sinon console.error uniquement.
// code : code Firebase (ex: 'permission-denied', 'unavailable')
// ctx  : contexte lisible (ex: 'loadCollection(shop)')
function _handleFirestoreError(e, ctx) {
  console.error(`[firestore] ${ctx}`, e);

  const notify = window.showNotif;
  if (!notify) return;

  const code = e?.code || '';

  if (code === 'permission-denied') {
    notify(`Accès refusé — ${ctx}`, 'error');
  } else if (code === 'unavailable' || code === 'deadline-exceeded') {
    notify('Connexion perdue. Vérifie ta connexion internet.', 'error');
  } else if (code === 'not-found') {
    // Silencieux — document absent est souvent attendu
  } else {
    notify(`Erreur base de données (${ctx})`, 'error');
  }
}

// ── Collections ────────────────────────────────
export async function loadCollection(col) {
  try {
    const snap = await getDocs(collection(db, col));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    _handleFirestoreError(e, `loadCollection(${col})`);
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
    _handleFirestoreError(e, `loadCollectionWhere(${col})`);
    return [];
  }
}

// ── Documents ──────────────────────────────────
export async function getDocData(col, id) {
  try {
    const snap = await getDoc(doc(db, col, id));
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    _handleFirestoreError(e, `getDocData(${col}/${id})`);
    return null;
  }
}

export async function saveDoc(col, id, data) {
  try {
    await setDoc(doc(db, col, id), data, { merge: true });
  } catch (e) {
    _handleFirestoreError(e, `saveDoc(${col}/${id})`);
    throw e; // Remonter pour que l'appelant sache que ça a échoué
  }
}

export async function addToCol(col, data) {
  try {
    const ref = await addDoc(collection(db, col), {
      ...data,
      createdAt: new Date().toISOString(),
    });
    return ref.id;
  } catch (e) {
    _handleFirestoreError(e, `addToCol(${col})`);
    throw e;
  }
}

export async function updateInCol(col, id, data) {
  try {
    await updateDoc(doc(db, col, id), data);
  } catch (e) {
    _handleFirestoreError(e, `updateInCol(${col}/${id})`);
    throw e;
  }
}

export async function deleteFromCol(col, id) {
  try {
    await deleteDoc(doc(db, col, id));
  } catch (e) {
    _handleFirestoreError(e, `deleteFromCol(${col}/${id})`);
    throw e;
  }
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
    _handleFirestoreError(e, 'loadChars');
    return [];
  }
}

export async function countUserChars(uid = null) {
  const chars = await loadChars(uid);
  return chars.length;
}
