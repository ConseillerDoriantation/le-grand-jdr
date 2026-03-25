// ══════════════════════════════════════════════
// INIT FIREBASE
// ══════════════════════════════════════════════
window.addEventListener('firebase-ready', () => {
  const jdr = window._jdr;
  AUTH = jdr.auth;
  DB = jdr.db;
  FS = jdr;

  FS.onAuthStateChanged(AUTH, async user => {
    if (user) {
      STATE.user = user;
      STATE.isAdmin = user.email === FS.ADMIN_EMAIL;
      await loadProfile(user);
      showApp();
      navigate('dashboard');
    } else {
      showAuth();
    }
  });
});

async function loadProfile(user) {
  const ref = FS.doc(DB, 'users', user.uid);
  const snap = await FS.getDoc(ref);
  if (snap.exists()) {
    STATE.profile = snap.data();
  } else {
    STATE.profile = { uid: user.uid, email: user.email, pseudo: user.email.split('@')[0], createdAt: new Date().toISOString() };
    await FS.setDoc(ref, STATE.profile);
  }
}
