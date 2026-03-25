// ══════════════════════════════════════════════
// FIRESTORE HELPERS
// ══════════════════════════════════════════════
async function loadCollection(col) {
  try {
    const snap = await FS.getDocs(FS.collection(DB, col));
    return snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch { return []; }
}
async function loadCollectionOrdered(col, field) {
  try {
    const snap = await FS.getDocs(FS.query(FS.collection(DB, col), FS.orderBy(field)));
    return snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch { return loadCollection(col); }
}
async function getDocData(col, id) {
  try {
    const snap = await FS.getDoc(FS.doc(DB, col, id));
    return snap.exists() ? snap.data() : null;
  } catch { return null; }
}
async function saveDoc(col, id, data) {
  await FS.setDoc(FS.doc(DB, col, id), data, {merge:true});
}
async function addToCol(col, data) {
  const ref = await FS.addDoc(FS.collection(DB, col), {...data, createdAt: new Date().toISOString()});
  return ref.id;
}
async function updateInCol(col, id, data) {
  await FS.updateDoc(FS.doc(DB, col, id), data);
}
async function deleteFromCol(col, id) {
  await FS.deleteDoc(FS.doc(DB, col, id));
}
async function countUserChars() {
  try {
    const uid = STATE.isAdmin ? null : STATE.user.uid;
    if (uid) {
      const snap = await FS.getDocs(FS.query(FS.collection(DB,'characters'),FS.where('uid','==',uid)));
      return snap.size;
    } else {
      const snap = await FS.getDocs(FS.collection(DB,'characters'));
      return snap.size;
    }
  } catch { return 0; }
}
async function loadChars(uid) {
  try {
    let q;
    if (uid) q = FS.query(FS.collection(DB,'characters'),FS.where('uid','==',uid));
    else q = FS.collection(DB,'characters');
    const snap = await FS.getDocs(q);
    return snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch { return []; }
}

// ══════════════════════════════════════════════
