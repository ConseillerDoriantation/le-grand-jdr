// ══════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t,i) => t.classList.toggle('active', (tab==='login'?i===0:i===1)));
  document.getElementById('tab-login').style.display = tab==='login'?'block':'none';
  document.getElementById('tab-register').style.display = tab==='register'?'block':'none';
  document.getElementById('auth-error').textContent = '';
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pwd = document.getElementById('login-password').value;
  if (!email||!pwd) return setAuthError('Remplis tous les champs.');
  try {
    await FS.signInWithEmailAndPassword(AUTH, email, pwd);
  } catch(e) {
    setAuthError(getAuthError(e.code));
  }
}

async function doRegister() {
  const pseudo = document.getElementById('reg-pseudo').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pwd = document.getElementById('reg-password').value;
  if (!pseudo||!email||!pwd) return setAuthError('Remplis tous les champs.');
  if (pwd.length < 6) return setAuthError('Mot de passe trop court (6 car. min).');
  try {
    const cred = await FS.createUserWithEmailAndPassword(AUTH, email, pwd);
    await FS.setDoc(FS.doc(DB,'users',cred.user.uid), { uid:cred.user.uid, email, pseudo, createdAt: new Date().toISOString() });
  } catch(e) {
    setAuthError(getAuthError(e.code));
  }
}

async function doLogout() {
  await FS.signOut(AUTH);
}

function setAuthError(msg) { document.getElementById('auth-error').textContent = msg; }
function getAuthError(code) {
  const map = { 'auth/invalid-email':'Email invalide.','auth/user-not-found':'Compte introuvable.','auth/wrong-password':'Mot de passe incorrect.','auth/email-already-in-use':'Email déjà utilisé.','auth/weak-password':'Mot de passe trop faible.','auth/invalid-credential':'Email ou mot de passe incorrect.' };
  return map[code] || 'Erreur: ' + code;
}

function showAuth() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}
function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('header-username').textContent = STATE.profile?.pseudo || STATE.user?.email;
  if (STATE.isAdmin) {
    document.getElementById('admin-badge').style.display = 'inline';
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'flex');
    // more-menu admin items use div, not flex
    document.querySelectorAll('.more-menu .admin-only').forEach(el => el.style.display = 'flex');
  }
}
