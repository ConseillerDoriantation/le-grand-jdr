// ══════════════════════════════════════════════════════════════════════════════
// ACCOUNT.JS — Gestion du compte joueur
// ✓ Modifier pseudo, email, mot de passe
// ✓ Supprimer le compte : vend tous les items boutique → restitue le stock,
//   supprime tous les personnages, puis supprime le compte Firebase
// ══════════════════════════════════════════════════════════════════════════════
import {
  auth, db, doc, setDoc, getDoc, updateDoc,
  signInWithEmailAndPassword,
  signOut,
} from '../config/firebase.js';

import {
  updateEmail, updatePassword, deleteUser,
  EmailAuthProvider, reauthenticateWithCredential,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

import {
  loadChars, loadCollection, deleteFromCol, updateInCol,
} from '../data/firestore.js';

import { openModal, closeModal } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { STATE, setProfile }     from '../core/state.js';
import PAGES                     from './pages.js';
import { _esc, _norm }           from '../shared/html.js';
import { calcOr }                from '../shared/char-stats.js';

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/** Réauthentifie l'utilisateur — requis par Firebase avant opérations sensibles */
async function _reauth(password) {
  const user = auth.currentUser;
  if (!user) throw new Error('Non connecté.');
  const cred = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, cred);
}

/**
 * Vend tous les items boutique d'un inventaire :
 * - Réincrémente le stock dans la collection 'shop'
 * - Retourne le total d'or récupéré
 */
async function _liquidateInventory(inventaire = []) {
  try {
    const shopItems = inventaire.filter(i => i.source === 'boutique' && i.itemId);
    if (!shopItems.length) return 0;

    // Charger les items boutique une seule fois
    const shopDocs = await loadCollection('shop');
    const shopMap  = {};
    shopDocs.forEach(d => { shopMap[d.id] = d; });

    let totalOr = 0;

    await Promise.all(shopItems.map(async (item) => {
      const pv = parseFloat(item.prixVente) || Math.round((parseFloat(item.prixAchat)||0) * 0.6);
      totalOr += pv;

      // Réincrémenter le stock
      const shopDoc = shopMap[item.itemId];
      if (shopDoc) {
        const cur = shopDoc.dispo !== undefined && shopDoc.dispo !== '' ? parseInt(shopDoc.dispo) : null;
        if (cur !== null && cur >= 0) {
          await updateInCol('shop', item.itemId, { dispo: cur + 1 });
        }
      }
    }));

    return totalOr;
  } catch (e) { notifySaveError(e); }
}

/**
 * Supprime tous les personnages d'un utilisateur et vend leurs items boutique.
 * Retourne le résumé { nbPersos, totalOr }
 */
async function _purgeUserCharacters(uid) {
  try {
    const chars = await loadChars(uid);
    let totalOr = 0;

    await Promise.all(chars.map(async (c) => {
      totalOr += await _liquidateInventory(c.inventaire || []);
      await deleteFromCol('characters', c.id);
    }));

    // Mettre à jour STATE.characters
    STATE.characters = (STATE.characters || []).filter(c => c.uid !== uid);

    return { nbPersos: chars.length, totalOr };
  } catch (e) { notifySaveError(e); }
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDU PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
async function renderAccount() {
  const content = document.getElementById('main-content');
  const user    = auth.currentUser;
  const profile = STATE.profile || {};

  if (!user) {
    content.innerHTML = `<div class="empty-state"><div class="icon">🔒</div><p>Non connecté.</p></div>`;
    return;
  }

  // Compter les personnages
  const chars = await loadChars(user.uid);
  const nbChars = chars.length;

  content.innerHTML = `
  <style>
    .acc-section {
      background:var(--bg-card);border:1px solid var(--border);border-radius:14px;
      overflow:hidden;margin-bottom:1.25rem;
    }
    .acc-section-header {
      padding:.85rem 1.1rem;border-bottom:1px solid var(--border);
      background:rgba(0,0,0,.1);display:flex;align-items:center;gap:.6rem;
    }
    .acc-section-title {
      font-family:'Cinzel',serif;font-size:.88rem;color:var(--text);font-weight:600;
      letter-spacing:.5px;
    }
    .acc-section-body { padding:1.1rem; }
    .acc-field { margin-bottom:.85rem; }
    .acc-field:last-child { margin-bottom:0; }
    .acc-label { font-size:.72rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.7px;margin-bottom:.3rem; }
    .acc-value { font-size:.9rem;color:var(--text-muted); }
    .acc-inline { display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap; }
    .acc-edit-btn {
      font-size:.72rem;background:rgba(232,184,75,.08);border:1px solid rgba(232,184,75,.3);
      border-radius:8px;padding:4px 12px;cursor:pointer;color:var(--gold);
      transition:all .15s;flex-shrink:0;
    }
    .acc-edit-btn:hover { background:rgba(232,184,75,.18); }
    .acc-danger-btn {
      font-size:.82rem;background:rgba(255,107,107,.06);border:1px solid rgba(255,107,107,.25);
      border-radius:10px;padding:.6rem 1.2rem;cursor:pointer;color:#ff6b6b;
      transition:all .15s;width:100%;margin-top:.5rem;
    }
    .acc-danger-btn:hover { background:rgba(255,107,107,.14);border-color:rgba(255,107,107,.5); }
    .acc-avatar {
      width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,var(--gold-dim),var(--gold));
      display:flex;align-items:center;justify-content:center;
      font-family:'Cinzel',serif;font-size:1.6rem;color:#0b1118;font-weight:700;
      flex-shrink:0;
    }
  </style>

  <!-- ═══ HEADER ═══════════════════════════════════════════════════════════ -->
  <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem">
    <div class="acc-avatar">${(profile.pseudo||'?')[0].toUpperCase()}</div>
    <div>
      <h1 style="font-family:'Cinzel',serif;font-size:1.5rem;color:var(--gold);letter-spacing:1px;margin:0">${profile.pseudo||'Aventurier'}</h1>
      <div style="font-size:.78rem;color:var(--text-dim);margin-top:.2rem">${user.email}</div>
      <div style="font-size:.72rem;color:var(--text-dim);margin-top:.1rem">${STATE.isAdmin?'🛡️ Maître de Jeu':'⚔️ Joueur'} · ${nbChars} personnage${nbChars!==1?'s':''}</div>
    </div>
  </div>

  <!-- ═══ INFORMATIONS ════════════════════════════════════════════════════ -->
  <div class="acc-section">
    <div class="acc-section-header">
      <span style="font-size:1rem">👤</span>
      <div class="acc-section-title">Informations du compte</div>
    </div>
    <div class="acc-section-body">

      <div class="acc-field">
        <div class="acc-inline">
          <div>
            <div class="acc-label">Pseudo</div>
            <div class="acc-value">${profile.pseudo||'—'}</div>
          </div>
          <button class="acc-edit-btn" onclick="openEditPseudo()">✏️ Modifier</button>
        </div>
      </div>

      <div style="height:1px;background:var(--border);margin:.6rem 0"></div>

      <div class="acc-field">
        <div class="acc-inline">
          <div>
            <div class="acc-label">Adresse email</div>
            <div class="acc-value">${user.email}</div>
          </div>
          <button class="acc-edit-btn" onclick="openEditEmail()">✏️ Modifier</button>
        </div>
      </div>

      <div style="height:1px;background:var(--border);margin:.6rem 0"></div>

      <div class="acc-field">
        <div class="acc-inline">
          <div>
            <div class="acc-label">Mot de passe</div>
            <div class="acc-value">••••••••</div>
          </div>
          <button class="acc-edit-btn" onclick="openEditPassword()">✏️ Modifier</button>
        </div>
      </div>

    </div>
  </div>

  <!-- ═══ ZONE DANGER ══════════════════════════════════════════════════════ -->
  <div class="acc-section" style="border-color:rgba(255,107,107,.2)">
    <div class="acc-section-header" style="background:rgba(255,107,107,.06)">
      <span style="font-size:1rem">⚠️</span>
      <div class="acc-section-title" style="color:#ff6b6b">Zone de danger</div>
    </div>
    <div class="acc-section-body">
      <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:.75rem;line-height:1.6">
        La suppression du compte est <strong style="color:#ff6b6b">irréversible</strong>.
        Tous tes personnages seront supprimés et leurs objets boutique seront automatiquement
        remis en stock.
      </p>
      ${nbChars > 0 ? `
      <div style="background:rgba(255,107,107,.06);border:1px solid rgba(255,107,107,.2);border-radius:8px;padding:.6rem .85rem;margin-bottom:.75rem;font-size:.78rem;color:#ff6b6b">
        ⚠️ ${nbChars} personnage${nbChars!==1?'s':''} seront supprimés.
        Leurs objets boutique seront remis en vente automatiquement.
      </div>` : ''}
      <button class="acc-danger-btn" onclick="openDeleteAccount()">
        🗑️ Supprimer mon compte
      </button>
    </div>
  </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════════════
// MODIFIER PSEUDO
// ══════════════════════════════════════════════════════════════════════════════
function openEditPseudo() {
  const profile = STATE.profile || {};
  openModal('✏️ Modifier le pseudo', `
    <div class="form-group">
      <label>Nouveau pseudo</label>
      <input class="input-field" id="acc-pseudo" value="${profile.pseudo||''}"
        placeholder="Ton pseudo d'aventurier...">
    </div>
    <div style="display:flex;gap:.5rem;margin-top:.75rem">
      <button class="btn btn-gold" style="flex:1" onclick="savePseudo()">Enregistrer</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);
  setTimeout(() => {
    const el = document.getElementById('acc-pseudo');
    el?.focus(); el?.select();
  }, 60);
}

async function savePseudo() {
  const newPseudo = document.getElementById('acc-pseudo')?.value?.trim();
  if (!newPseudo) { showNotif('Le pseudo ne peut pas être vide.', 'error'); return; }
  if (newPseudo.length > 30) { showNotif('Pseudo trop long (30 caractères max).', 'error'); return; }

  const user = auth.currentUser;
  if (!user) return;

  try {
    await updateDoc(doc(db, 'users', user.uid), { pseudo: newPseudo });
    const newProfile = { ...(STATE.profile||{}), pseudo: newPseudo };
    setProfile(newProfile);

    // Mettre à jour ownerPseudo sur tous les personnages du joueur
    const chars = (STATE.characters||[]).filter(c => c.uid === user.uid);
    await Promise.all(chars.map(c => updateInCol('characters', c.id, { ownerPseudo: newPseudo })));
    chars.forEach(c => { c.ownerPseudo = newPseudo; });

    closeModal();
    showNotif(`Pseudo mis à jour : ${newPseudo}`, 'success');
    renderAccount();
  } catch (err) {
    console.error('[account] savePseudo:', err);
    showNotif('Erreur lors de la mise à jour.', 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MODIFIER EMAIL
// ══════════════════════════════════════════════════════════════════════════════
function openEditEmail() {
  openModal('📧 Modifier l\'email', `
    <p style="font-size:.8rem;color:var(--text-dim);margin-bottom:.75rem">
      Une confirmation sera requise. Ton mot de passe actuel est nécessaire.
    </p>
    <div class="form-group">
      <label>Nouvel email</label>
      <input class="input-field" id="acc-new-email" type="email" placeholder="nouveau@email.com">
    </div>
    <div class="form-group">
      <label>Mot de passe actuel</label>
      <input class="input-field" id="acc-reauth-pw-email" type="password" placeholder="••••••••">
    </div>
    <div style="display:flex;gap:.5rem;margin-top:.75rem">
      <button class="btn btn-gold" style="flex:1" onclick="saveEmail()">Enregistrer</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);
}

async function saveEmail() {
  const newEmail = document.getElementById('acc-new-email')?.value?.trim();
  const password = document.getElementById('acc-reauth-pw-email')?.value;
  if (!newEmail || !password) { showNotif('Remplis tous les champs.', 'error'); return; }

  try {
    await _reauth(password);
    await updateEmail(auth.currentUser, newEmail);
    await updateDoc(doc(db, 'users', auth.currentUser.uid), { email: newEmail });
    const newProfile = { ...(STATE.profile||{}), email: newEmail };
    setProfile(newProfile);
    closeModal();
    showNotif('Email mis à jour !', 'success');
    renderAccount();
  } catch (err) {
    console.error('[account] saveEmail:', err);
    if (err.code === 'auth/email-already-in-use') showNotif('Cet email est déjà utilisé.', 'error');
    else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') showNotif('Mot de passe incorrect.', 'error');
    else showNotif('Erreur : ' + (err.message||'inconnue'), 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MODIFIER MOT DE PASSE
// ══════════════════════════════════════════════════════════════════════════════
function openEditPassword() {
  openModal('🔐 Modifier le mot de passe', `
    <div class="form-group">
      <label>Mot de passe actuel</label>
      <input class="input-field" id="acc-old-pw" type="password" placeholder="••••••••">
    </div>
    <div class="form-group">
      <label>Nouveau mot de passe</label>
      <input class="input-field" id="acc-new-pw" type="password" placeholder="6 caractères minimum">
    </div>
    <div class="form-group">
      <label>Confirmer le nouveau mot de passe</label>
      <input class="input-field" id="acc-new-pw2" type="password" placeholder="••••••••">
    </div>
    <div style="display:flex;gap:.5rem;margin-top:.75rem">
      <button class="btn btn-gold" style="flex:1" onclick="savePassword()">Enregistrer</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);
}

async function savePassword() {
  const oldPw  = document.getElementById('acc-old-pw')?.value;
  const newPw  = document.getElementById('acc-new-pw')?.value;
  const newPw2 = document.getElementById('acc-new-pw2')?.value;

  if (!oldPw || !newPw || !newPw2) { showNotif('Remplis tous les champs.', 'error'); return; }
  if (newPw.length < 6)            { showNotif('Minimum 6 caractères.', 'error'); return; }
  if (newPw !== newPw2)            { showNotif('Les mots de passe ne correspondent pas.', 'error'); return; }

  try {
    await _reauth(oldPw);
    await updatePassword(auth.currentUser, newPw);
    closeModal();
    showNotif('Mot de passe mis à jour !', 'success');
  } catch (err) {
    console.error('[account] savePassword:', err);
    if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential')
      showNotif('Mot de passe actuel incorrect.', 'error');
    else
      showNotif('Erreur : ' + (err.message||'inconnue'), 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SUPPRIMER LE COMPTE
// ══════════════════════════════════════════════════════════════════════════════
function openDeleteAccount() {
  openModal('🗑️ Supprimer le compte', `
    <div style="background:rgba(255,107,107,.08);border:1px solid rgba(255,107,107,.25);
      border-radius:10px;padding:.85rem 1rem;margin-bottom:1rem;font-size:.82rem;line-height:1.7">
      <strong style="color:#ff6b6b;display:block;margin-bottom:.4rem">⚠️ Cette action est irréversible.</strong>
      <ul style="margin:0;padding-left:1.2rem;color:var(--text-muted)">
        <li>Tous tes personnages seront supprimés</li>
        <li>Leurs objets boutique seront automatiquement remis en stock</li>
        <li>Ton compte et tes données seront définitivement effacés</li>
      </ul>
    </div>
    <div class="form-group">
      <label>Confirme avec ton mot de passe</label>
      <input class="input-field" id="acc-del-pw" type="password" placeholder="••••••••">
    </div>
    <div class="form-group">
      <label>Tape <strong style="color:#ff6b6b">SUPPRIMER</strong> pour confirmer</label>
      <input class="input-field" id="acc-del-confirm" placeholder="SUPPRIMER">
    </div>
    <div style="display:flex;gap:.5rem;margin-top:.75rem">
      <button style="flex:1;background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.35);
        border-radius:10px;padding:.65rem;cursor:pointer;color:#ff6b6b;font-size:.85rem;font-weight:600;
        transition:all .15s" onmouseover="this.style.background='rgba(255,107,107,.2)'"
        onmouseout="this.style.background='rgba(255,107,107,.1)'"
        onclick="confirmDeleteAccount()">
        🗑️ Supprimer définitivement
      </button>
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Annuler</button>
    </div>
  `);
}

async function confirmDeleteAccount() {
  const password = document.getElementById('acc-del-pw')?.value;
  const confirm  = document.getElementById('acc-del-confirm')?.value?.trim();

  if (!password)               { showNotif('Mot de passe requis.', 'error'); return; }
  if (confirm !== 'SUPPRIMER') { showNotif('Tape exactement "SUPPRIMER" pour confirmer.', 'error'); return; }

  const user = auth.currentUser;
  if (!user) return;

  // Désactiver le bouton pendant l'opération
  const btn = document.querySelector('[onclick="confirmDeleteAccount()"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Suppression en cours...'; }

  try {
    // 1. Réauthentifier
    await _reauth(password);

    // 2. Vendre les items et supprimer les personnages
    const { nbPersos, totalOr } = await _purgeUserCharacters(user.uid);
    console.log(`[account] ${nbPersos} persos supprimés, ${totalOr} or restitué à la boutique`);

    // 3. Supprimer le document profil dans Firestore
    try {
      await deleteFromCol('users', user.uid);
    } catch { /* peut ne pas exister */ }

    // 4. Supprimer le compte Firebase Auth
    await deleteUser(user);

    // 5. La déconnexion est automatique après deleteUser — onAuthStateChanged s'en charge
    showNotif('Compte supprimé. Au revoir !', 'success');

  } catch (err) {
    console.error('[account] confirmDeleteAccount:', err);
    if (btn) { btn.disabled = false; btn.textContent = '🗑️ Supprimer définitivement'; }
    if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential')
      showNotif('Mot de passe incorrect.', 'error');
    else if (err.code === 'auth/requires-recent-login')
      showNotif('Session expirée — reconnecte-toi d\'abord.', 'error');
    else
      showNotif('Erreur : ' + (err.message||'inconnue'), 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SUPPRESSION D'UN PERSONNAGE (appelé depuis characters.js)
// Vend les items boutique avant suppression
// ══════════════════════════════════════════════════════════════════════════════
async function deleteCharWithRefund(charId) {
  try {
    const c = STATE.characters?.find(x => x.id === charId) || STATE.activeChar;
    if (!c) return false;

    const inv       = c.inventaire || [];
    const boutique  = inv.filter(i => i.source === 'boutique' && i.itemId);
    const nbItems   = boutique.length;

    const confirmMsg = nbItems > 0
      ? `Supprimer "${c.nom||'ce personnage'}" ?\n\n${nbItems} objet${nbItems>1?'s':''} de boutique ${nbItems>1?'seront remis':'sera remis'} en stock.`
      : `Supprimer "${c.nom||'ce personnage'}" ?`;

    if (!await confirmModal(confirmMsg)) return false;

    // Vendre/restituer les items boutique
    if (nbItems > 0) {
      const totalOr = await _liquidateInventory(inv);
      console.log(`[account] deleteChar "${c.nom}" : ${nbItems} items, ${totalOr} or restitués`);
    }

    await deleteFromCol('characters', charId);
    STATE.characters = (STATE.characters||[]).filter(x => x.id !== charId);
    showNotif(`Personnage "${c.nom||'?'}" supprimé.${nbItems>0?` (${nbItems} objet${nbItems>1?'s':''} remis en stock)`:''}`, 'success');
    return true;
  } catch (e) { notifySaveError(e); }
}

// ══════════════════════════════════════════════════════════════════════════════
// OVERRIDE PAGES + EXPORTS
// ══════════════════════════════════════════════════════════════════════════════
PAGES.account = renderAccount;

Object.assign(window, {
  renderAccount,
  openEditPseudo,  savePseudo,
  openEditEmail,   saveEmail,
  openEditPassword, savePassword,
  openDeleteAccount, confirmDeleteAccount,
  deleteCharWithRefund,
  _liquidateInventory,
});