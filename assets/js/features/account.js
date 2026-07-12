// ══════════════════════════════════════════════════════════════════════════════
// ACCOUNT.JS — Gestion du compte joueur
// ✓ Modifier pseudo, email, mot de passe
// ✓ Supprimer le compte : vend tous les items boutique → restitue le stock,
//   supprime tous les personnages, puis supprime le compte Firebase
// ══════════════════════════════════════════════════════════════════════════════
import { auth } from '../config/firebase.js';

import {
  updateEmail, updatePassword, deleteUser,
  EmailAuthProvider, reauthenticateWithCredential,
} from 'firebase/auth';   // résolu par l'import map de index.html

import {
  loadChars, loadCollection, deleteFromCol, updateInCol,
  getDocDataSilent, saveDoc, loadCharsForAdventure,
} from '../data/firestore.js';

import { openModal, closeModal, promptModal } from '../shared/modal.js';
import { listGithubFolder, GH_IMAGE_EXTS, prettyNameFromFile, fileKey } from '../shared/github-folder.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { refreshSidebarProfile }  from '../core/layout.js';
import { avatarSrcOf, resolveAvatarUrl } from '../shared/avatar.js';
import { STATE, setProfile }     from '../core/state.js';
import PAGES                     from './pages.js';
import { registerActions }        from '../core/actions.js';
import { _esc, _norm }           from '../shared/html.js';
import { emptyStateHtml }        from '../shared/list-renderer.js';
import { calcOr }                from '../shared/char-stats.js';

import { getCharacterById } from '../shared/character-state.js';
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
    const restockByItem = new Map();

    shopItems.forEach((item) => {
      const pv = parseFloat(item.prixVente) || Math.round((parseFloat(item.prixAchat)||0) * 0.6);
      totalOr += pv;

      const shopDoc = shopMap[item.itemId];
      if (!shopDoc) return;
      const cur = shopDoc.dispo !== undefined && shopDoc.dispo !== '' ? parseInt(shopDoc.dispo) : null;
      if (cur !== null && cur >= 0) restockByItem.set(item.itemId, (restockByItem.get(item.itemId) || 0) + 1);
    });

    await Promise.all([...restockByItem.entries()].map(([itemId, count]) => {
      const cur = parseInt(shopMap[itemId]?.dispo);
      return updateInCol('shop', itemId, { dispo: cur + count });
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
function _accountProviderLabel(user) {
  const providers = (user?.providerData || []).map(p => p.providerId).filter(Boolean);
  if (providers.includes('google.com')) return 'Google';
  if (providers.includes('password')) return 'Email + mot de passe';
  return providers[0] || 'Compte Firebase';
}
// RENDU PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
async function renderAccount() {
  const content = document.getElementById('main-content');
  const user    = auth.currentUser;
  const profile = STATE.profile || {};

  if (!user) {
    content.innerHTML = emptyStateHtml('🔒', 'Non connecté.');
    return;
  }

  const chars = await loadChars(user.uid);
  const nbChars = chars.length;
  const pseudo = profile.pseudo || 'Aventurier';
  const email = user.email || '';
  const adventuresCount = Array.isArray(STATE.adventures) ? STATE.adventures.length : 0;
  const roleLabel = STATE.isAdmin ? 'Maître de Jeu' : 'Joueur';
  const providerLabel = _accountProviderLabel(user);

  content.innerHTML = `
  <div class="account-page">
    <section class="account-hero">
      <button class="acc-avatar acc-avatar-btn has-img account-avatar-xl" data-action="openAvatarPicker" title="Changer d'avatar">
        <img src="${_esc(avatarSrcOf(profile))}" alt="" class="acc-avatar-img">
        <span class="acc-avatar-edit" title="Changer d'avatar">📷</span>
      </button>
      <div class="account-hero-main">
        <span class="account-kicker">Compte connecté</span>
        <h1>${_esc(pseudo)}</h1>
        <p>${_esc(email || 'Email non renseigné')}</p>
        <div class="account-badges">
          <span>${STATE.isAdmin ? '🛡️' : '⚔️'} ${_esc(roleLabel)}</span>
          <span>${_esc(providerLabel)}</span>
        </div>
      </div>
      <div class="account-hero-actions">
        <button class="btn btn-gold btn-sm" data-action="openAvatarPicker">Changer l'avatar</button>
        <button class="btn btn-outline btn-sm" data-action="openEditPseudo">Renommer</button>
      </div>
    </section>

    <section class="account-summary">
      <div class="account-summary-card">
        <span>Personnages</span>
        <strong>${nbChars}</strong>
        <small>${nbChars === 1 ? 'fiche liée' : 'fiches liées'}</small>
      </div>
      <div class="account-summary-card">
        <span>Aventures</span>
        <strong>${adventuresCount}</strong>
        <small>${adventuresCount === 1 ? 'campagne' : 'campagnes'}</small>
      </div>
      <div class="account-summary-card">
        <span>Rôle</span>
        <strong>${_esc(roleLabel)}</strong>
        <small>${STATE.isAdmin ? 'gestion active' : 'accès joueur'}</small>
      </div>
      <div class="account-summary-card">
        <span>Connexion</span>
        <strong>${_esc(providerLabel)}</strong>
        <small>sécurité du compte</small>
      </div>
    </section>

    <div class="account-layout">
      <main class="account-main-stack">
        <section class="acc-section account-panel">
          <div class="acc-section-header">
            <span>👤</span>
            <div>
              <div class="acc-section-title">Profil public</div>
              <p>Ces informations servent à t'identifier auprès de la table.</p>
            </div>
          </div>
          <div class="acc-section-body">
            <div class="account-setting-row">
              <div>
                <span class="acc-label">Pseudo</span>
                <strong>${_esc(pseudo || 'Aventurier')}</strong>
                <small>Visible dans l'interface, le chat et les fiches liées.</small>
              </div>
              <button class="acc-edit-btn" data-action="openEditPseudo">Modifier</button>
            </div>
            <div class="account-setting-row">
              <div>
                <span class="acc-label">Avatar</span>
                <strong>Portrait du compte</strong>
                <small>Utilisé dans la navigation et certains sélecteurs.</small>
              </div>
              <button class="acc-edit-btn" data-action="openAvatarPicker">Choisir</button>
            </div>
          </div>
        </section>

        <section class="acc-section account-panel">
          <div class="acc-section-header">
            <span>🔐</span>
            <div>
              <div class="acc-section-title">Connexion & sécurité</div>
              <p>Les modifications sensibles demandent une confirmation.</p>
            </div>
          </div>
          <div class="acc-section-body">
            <div class="account-setting-row">
              <div>
                <span class="acc-label">Adresse email</span>
                <strong>${_esc(email || 'Non renseignée')}</strong>
                <small>Adresse utilisée pour te connecter et récupérer ton compte.</small>
              </div>
              <button class="acc-edit-btn" data-action="openEditEmail">Modifier</button>
            </div>
            <div class="account-setting-row">
              <div>
                <span class="acc-label">Mot de passe</span>
                <strong>••••••••</strong>
                <small>À changer si tu suspectes un accès non voulu.</small>
              </div>
              <button class="acc-edit-btn" data-action="openEditPassword">Modifier</button>
            </div>
          </div>
        </section>
      </main>

      <aside class="account-side-stack">
        <section class="acc-section account-panel account-identity-card">
          <div class="acc-section-header">
            <span>🧭</span>
            <div>
              <div class="acc-section-title">Repères</div>
              <p>Résumé rapide du compte.</p>
            </div>
          </div>
          <div class="acc-section-body">
            <div class="account-meta-line"><span>UID</span><code>${_esc(user.uid)}</code></div>
            <div class="account-meta-line"><span>Profil</span><strong>${_esc(roleLabel)}</strong></div>
            <div class="account-meta-line"><span>Connexion</span><strong>${_esc(providerLabel)}</strong></div>
          </div>
        </section>

        <section class="acc-section account-panel account-danger-panel">
          <div class="acc-section-header">
            <span>⚠️</span>
            <div>
              <div class="acc-section-title">Zone de danger</div>
              <p>Action définitive.</p>
            </div>
          </div>
          <div class="acc-section-body">
            <p>
              La suppression du compte est irréversible. Les personnages seront supprimés et leurs objets boutique remis en stock.
            </p>
            ${nbChars > 0 ? `
            <div class="account-danger-note">
              ${nbChars} personnage${nbChars!==1?'s':''} concerné${nbChars!==1?'s':''}.
            </div>` : ''}
            <button class="acc-danger-btn" data-action="openDeleteAccount">Supprimer mon compte</button>
          </div>
        </section>
      </aside>
    </div>
  </div>
  `;
}
// AVATAR — catalogue d'avatars GLOBAL à l'app + portraits des persos du joueur
// ══════════════════════════════════════════════════════════════════════════════
// Catalogue : app_config/profileIcons (GLOBAL à l'app → partagé par toutes les
// aventures, lecture tout membre connecté, écriture admin). Choix du joueur :
// users/{uid}.avatarIcon (doc global). ⚠️ nécessite (cf. docs/firestore-rules.md) :
//  - la clé `avatarIcon` autorisée dans la règle isUserSelfUpdate ;
//  - une règle lecture/écriture sur la collection globale `app_config`.
const PROFILE_ICONS_DOC = 'profileIcons';
let _iconCatalog = null; // cache session

async function _loadIconCatalog(force = false) {
  if (_iconCatalog && !force) return _iconCatalog;
  const doc = await getDocDataSilent('app_config', PROFILE_ICONS_DOC);
  _iconCatalog = Array.isArray(doc?.icons) ? doc.icons.filter(i => i && i.url) : [];
  return _iconCatalog;
}

// Portrait d'un personnage (mêmes champs que _live côté VTT).
const _charPortrait = (c) => c?.photoURL || c?.photo || c?.avatar || c?.imageUrl || '';

async function openAvatarPicker() {
  const catalog = await _loadIconCatalog(true);
  const cur = STATE.profile?.avatarIcon || '';
  const uid = STATE.user?.uid || auth.currentUser?.uid || '';
  const _lbl = (txt) => `<div style="font-size:.74rem;font-weight:700;color:var(--text-dim);letter-spacing:.02em;margin:.3rem 0 .45rem">${txt}</div>`;
  const _optBtn = (url, label) => `
    <button class="avatar-opt${cur === url ? ' is-sel' : ''}" data-action="chooseAvatar"
      data-url="${_esc(url)}" title="${_esc(label || '')}">
      <img src="${_esc(resolveAvatarUrl(url))}" alt="${_esc(label || '')}" loading="lazy">
    </button>`;

  // Portraits des personnages DU JOUEUR sur TOUTES ses aventures : on lit ses
  // persos (filtrés sur son uid) dans CHACUNE de ses aventures (STATE.adventures),
  // via les index/règles standard — pas de collectionGroup ni d'index spécial. On
  // fusionne avec l'aventure courante (déjà en mémoire), dédoublonne par id, et
  // filtre à ses propres persos ayant un portrait.
  const _advs = Array.isArray(STATE.adventures) ? STATE.adventures : [];
  const _cross = (await Promise.all(_advs.map(a => loadCharsForAdventure(a?.id, uid).catch(() => [])))).flat();
  const _byId = new Map();
  [...(_cross || []), ...(STATE.characters || [])]
    .filter(c => c?.uid === uid && _charPortrait(c))
    .forEach(c => { if (c.id && !_byId.has(c.id)) _byId.set(c.id, c); });
  const myChars = [..._byId.values()];
  const charsSection = myChars.length
    ? _lbl('🧙 Mes personnages') + `<div class="avatar-grid">${myChars.map(c => _optBtn(_charPortrait(c), c.nom || 'Personnage')).join('')}</div>`
    : '';

  const catalogSection = catalog.length
    ? _lbl('🎭 Avatars de l\'app') + `<div class="avatar-grid">${catalog.map(ic => _optBtn(ic.url, ic.label)).join('')}</div>`
    : `<div class="acc-avatar-empty">Aucun avatar disponible pour l'instant.${STATE.isSuperAdmin ? ' Ajoutes-en via « Gérer les avatars ».' : ''}</div>`;

  openModal('🎭 Choisir un avatar', `
    ${charsSection}
    ${catalogSection}
    <div style="display:flex;gap:.5rem;margin-top:.9rem;flex-wrap:wrap;align-items:center">
      ${cur ? `<button class="btn btn-outline btn-sm" data-action="chooseAvatar" data-url="">↩︎ Avatar par défaut</button>` : ''}
      ${STATE.isSuperAdmin ? `<button class="btn btn-outline btn-sm" data-action="openAvatarManager">⚙️ Gérer les avatars</button>` : ''}
      <button class="btn btn-outline btn-sm" style="margin-left:auto" data-action="_accClose">Fermer</button>
    </div>
  `, { subtitle: "Tes personnages ou les avatars de l'app", accent: '#4f8cff' });
}

async function chooseAvatar(url) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await updateInCol('users', user.uid, { avatarIcon: url || '' });
    setProfile({ ...(STATE.profile || {}), avatarIcon: url || '' });
    // Propage l'avatar dans le profil dénormalisé (memberProfiles) de chaque aventure
    // du joueur → visible par les autres (chat, pickers) sans lecture de users/{uid}.
    // Autorisé par la règle isMemberProfileSelfUpdate (on ne touche que sa propre entrée).
    for (const a of (STATE.adventures || [])) {
      const inAdv = a?.accessList?.includes(user.uid) || a?.admins?.includes(user.uid);
      if (!a?.id || !inAdv) continue;
      updateInCol('adventures', a.id, { [`memberProfiles.${user.uid}.avatarIcon`]: url || '' })
        .then(() => { if (a.memberProfiles?.[user.uid]) a.memberProfiles[user.uid].avatarIcon = url || ''; })
        .catch(() => {});
    }
    closeModal();
    showNotif(url ? 'Avatar mis à jour !' : 'Avatar réinitialisé.', 'success');
    renderAccount();
    refreshSidebarProfile();
  } catch (err) {
    console.error('[account] chooseAvatar:', err);
    // Cause probable : règle isUserSelfUpdate n'autorise pas encore `avatarIcon`.
    showNotif("Impossible d'enregistrer l'avatar (règles Firestore à mettre à jour ?).", 'error');
  }
}

// ── Gestionnaire admin du catalogue ──────────────────────────────────────────
function openAvatarManager() {
  if (!STATE.isSuperAdmin) return;   // gestion du catalogue global = super-admin uniquement
  _renderAvatarManager(_iconCatalog || []);
}

function _renderAvatarManager(catalog) {
  const rows = catalog.length
    ? catalog.map((ic, i) => `
      <div class="avatar-mng-row">
        <img src="${_esc(resolveAvatarUrl(ic.url))}" alt="" class="avatar-mng-thumb" loading="lazy">
        <div class="avatar-mng-meta">
          <input class="input-field avatar-mng-input" id="av-edit-label-${i}" value="${_esc(ic.label || '')}" placeholder="Nom (optionnel)">
          <input class="input-field avatar-mng-input avatar-mng-input--url" id="av-edit-url-${i}" value="${_esc(ic.url)}" placeholder="URL de l'image">
        </div>
        <button class="acc-edit-btn" data-action="updateAvatarIcon" data-idx="${i}" title="Enregistrer les modifications">💾</button>
        <button class="acc-edit-btn" data-action="removeAvatarIcon" data-idx="${i}" title="Retirer">🗑️</button>
      </div>`).join('')
    : `<div class="acc-avatar-empty">Aucun avatar. Ajoute le premier ci-dessous.</div>`;

  openModal('⚙️ Gérer les avatars disponibles', `
    <p style="font-size:.78rem;color:var(--text-dim);margin-bottom:.7rem;line-height:1.6">
      URL d'images hébergées (dossier <code>images/</code> du site ou URL complète).
      Les joueurs choisiront leur avatar parmi cette sélection.
    </p>
    <div class="avatar-mng-list">${rows}</div>
    <div class="form-group" style="margin-top:.85rem">
      <label>Ajouter un avatar</label>
      <input class="input-field" id="av-url" placeholder="images/avatars/chevalier.png ou https://…">
      <input class="input-field" id="av-label" placeholder="Nom (optionnel)" style="margin-top:.4rem">
    </div>
    <div style="display:flex;gap:.5rem;margin-top:.6rem">
      <button class="btn btn-gold" style="flex:1" data-action="addAvatarIcon">＋ Ajouter</button>
      <button class="btn btn-outline btn-sm" data-action="openAvatarPicker">‹ Retour</button>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:.85rem 0 .6rem">
    <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" data-action="importAvatarsGithub">📥 Importer un dossier GitHub</button>
      <button class="btn btn-outline btn-sm" data-action="dedupeAvatarsCatalog">🧹 Retirer les doublons</button>
      <span style="font-size:.72rem;color:var(--text-dim);flex-basis:100%">Toutes les images d'un dossier du repo, sans doublon</span>
    </div>
  `, { subtitle: "Catalogue global de l'app", accent: '#e8b84b' });
}

async function _persistCatalog(icons) {
  _iconCatalog = icons;
  await saveDoc('app_config', PROFILE_ICONS_DOC, { icons });
}

async function addAvatarIcon() {
  const url   = document.getElementById('av-url')?.value?.trim();
  const label = document.getElementById('av-label')?.value?.trim() || '';
  if (!url) { showNotif('Indique une URL d\'image.', 'error'); return; }
  if ((_iconCatalog || []).some(i => i.url === url)) { showNotif('Cet avatar est déjà dans la liste.', 'error'); return; }
  const icons = [...(_iconCatalog || []), { url, label }];
  try {
    await _persistCatalog(icons);
    showNotif('Avatar ajouté.', 'success');
    _renderAvatarManager(icons);
  } catch (e) { notifySaveError(e); }
}

// Importe toutes les images d'un dossier du repo GitHub dans le catalogue (dédup
// par URL). Le chemin est mémorisé en localStorage. Réservé au super-admin (le
// manager l'est déjà, cf. openAvatarManager).
async function importAvatarsGithub() {
  const KEY = 'avatar-gh-folder';
  const def = localStorage.getItem(KEY) || 'images/avatar';
  const path = (await promptModal('Dossier du repo à importer (ex : images/avatar) :',
    { title: 'Importer des avatars', default: def, placeholder: 'images/avatar' }))?.trim();
  if (!path) return;
  localStorage.setItem(KEY, path);
  showNotif('Lecture du dossier…', 'info');
  let files;
  try { files = await listGithubFolder(path, { exts: GH_IMAGE_EXTS }); }
  catch (e) { showNotif(e.message, 'error'); return; }
  if (!files.length) { showNotif('Aucune image dans ce dossier.', 'info'); return; }
  // Dédup par NOM DE FICHIER (robuste aux différences de préfixe de chemin :
  // les anciens avatars peuvent être stockés sous une autre forme d'URL).
  const seen = new Set((_iconCatalog || []).map(i => fileKey(i.url)));
  const added = [];
  for (const f of files) {
    const k = fileKey(f.url);
    if (seen.has(k)) continue;
    seen.add(k);
    added.push({ url: f.url, label: prettyNameFromFile(f.name) });
  }
  if (!added.length) { showNotif('Tous ces avatars sont déjà dans la liste.', 'info'); return; }
  const icons = [...(_iconCatalog || []), ...added];
  try {
    await _persistCatalog(icons);
    showNotif(`✅ ${added.length} avatar(s) importé(s).`, 'success');
    _renderAvatarManager(icons);
  } catch (e) { notifySaveError(e); }
}

// Retire les doublons du catalogue (même nom de fichier), en gardant la 1re
// occurrence. Répare les doublons créés par un import antérieur.
async function dedupeAvatarsCatalog() {
  const cat = _iconCatalog || [];
  const seen = new Set();
  const kept = [];
  for (const ic of cat) {
    const k = fileKey(ic.url);
    if (seen.has(k)) continue;
    seen.add(k);
    kept.push(ic);
  }
  const removed = cat.length - kept.length;
  if (!removed) { showNotif('Aucun doublon détecté.', 'info'); return; }
  try {
    await _persistCatalog(kept);
    showNotif(`🧹 ${removed} doublon(s) retiré(s).`, 'success');
    _renderAvatarManager(kept);
  } catch (e) { notifySaveError(e); }
}

// Modifie l'URL / le nom d'un avatar existant (lu depuis les champs de sa ligne).
async function updateAvatarIcon(idx) {
  const url   = document.getElementById(`av-edit-url-${idx}`)?.value?.trim();
  const label = document.getElementById(`av-edit-label-${idx}`)?.value?.trim() || '';
  if (!url) { showNotif('L\'URL ne peut pas être vide.', 'error'); return; }
  if ((_iconCatalog || []).some((ic, i) => i !== idx && ic.url === url)) {
    showNotif('Un autre avatar utilise déjà cette URL.', 'error'); return;
  }
  const icons = (_iconCatalog || []).map((ic, i) => i === idx ? { url, label } : ic);
  try {
    await _persistCatalog(icons);
    showNotif('Avatar modifié.', 'success');
    _renderAvatarManager(icons);
  } catch (e) { notifySaveError(e); }
}

async function removeAvatarIcon(idx) {
  const icons = (_iconCatalog || []).filter((_, i) => i !== idx);
  try {
    await _persistCatalog(icons);
    showNotif('Avatar retiré.', 'success');
    _renderAvatarManager(icons);
  } catch (e) { notifySaveError(e); }
}

// ══════════════════════════════════════════════════════════════════════════════
// MODIFIER PSEUDO
// ══════════════════════════════════════════════════════════════════════════════
function openEditPseudo() {
  const profile = STATE.profile || {};
  openModal('✏️ Modifier le pseudo', `
    <div class="form-group">
      <label>Nouveau pseudo</label>
      <input class="input-field" id="acc-pseudo" value="${_esc(profile.pseudo || '')}"
        placeholder="Ton pseudo d'aventurier...">
    </div>
    <div style="display:flex;gap:.5rem;margin-top:.75rem">
      <button class="btn btn-gold" style="flex:1" data-action="savePseudo">Enregistrer</button>
      <button class="btn btn-outline btn-sm" data-action="_accClose">Annuler</button>
    </div>
  `, { subtitle: 'Ton nom d\'aventurier, visible par la table' });
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
    await updateInCol('users', user.uid, { pseudo: newPseudo });
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
      <button class="btn btn-gold" style="flex:1" data-action="saveEmail">Enregistrer</button>
      <button class="btn btn-outline btn-sm" data-action="_accClose">Annuler</button>
    </div>
  `, { subtitle: 'Mot de passe actuel requis pour confirmer', accent: '#4f8cff' });
}

async function saveEmail() {
  const newEmail = document.getElementById('acc-new-email')?.value?.trim();
  const password = document.getElementById('acc-reauth-pw-email')?.value;
  if (!newEmail || !password) { showNotif('Remplis tous les champs.', 'error'); return; }

  try {
    await _reauth(password);
    await updateEmail(auth.currentUser, newEmail);
    await updateInCol('users', auth.currentUser.uid, { email: newEmail });
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
      <button class="btn btn-gold" style="flex:1" data-action="savePassword">Enregistrer</button>
      <button class="btn btn-outline btn-sm" data-action="_accClose">Annuler</button>
    </div>
  `, { subtitle: 'Mot de passe actuel requis pour confirmer', accent: '#4f8cff' });
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
      <button class="acc-delete-confirm" data-action="confirmDeleteAccount">
        🗑️ Supprimer définitivement
      </button>
      <button class="btn btn-outline btn-sm" data-action="_accClose">Annuler</button>
    </div>
  `, { subtitle: 'Action irréversible', accent: '#ff6b6b' });
}

async function confirmDeleteAccount() {
  const password = document.getElementById('acc-del-pw')?.value;
  const confirm  = document.getElementById('acc-del-confirm')?.value?.trim();

  if (!password)               { showNotif('Mot de passe requis.', 'error'); return; }
  if (confirm !== 'SUPPRIMER') { showNotif('Tape exactement "SUPPRIMER" pour confirmer.', 'error'); return; }

  const user = auth.currentUser;
  if (!user) return;

  // Désactiver le bouton pendant l'opération
  const btn = document.querySelector('[data-action="confirmDeleteAccount"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Suppression en cours...'; }

  try {
    // 1. Réauthentifier
    await _reauth(password);

    // 2. Vendre les items et supprimer les personnages
    const { nbPersos, totalOr } = await _purgeUserCharacters(user.uid);
    console.debug(`[account] ${nbPersos} persos supprimés, ${totalOr} or restitué à la boutique`);

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
    const c = getCharacterById(charId);
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
      console.debug(`[account] deleteChar "${c.nom}" : ${nbItems} items, ${totalOr} or restitués`);
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


registerActions({
  openAvatarPicker:    () => openAvatarPicker(),
  chooseAvatar:        (btn) => chooseAvatar(btn.dataset.url || ''),
  openAvatarManager:   () => openAvatarManager(),
  addAvatarIcon:       () => addAvatarIcon(),
  importAvatarsGithub: () => importAvatarsGithub(),
  dedupeAvatarsCatalog: () => dedupeAvatarsCatalog(),
  updateAvatarIcon:    (btn) => updateAvatarIcon(Number(btn.dataset.idx)),
  removeAvatarIcon:    (btn) => removeAvatarIcon(Number(btn.dataset.idx)),
  openEditPseudo:      () => openEditPseudo(),
  openEditEmail:       () => openEditEmail(),
  openEditPassword:    () => openEditPassword(),
  openDeleteAccount:   () => openDeleteAccount(),
  savePseudo:          () => savePseudo(),
  saveEmail:           () => saveEmail(),
  savePassword:        () => savePassword(),
  confirmDeleteAccount:() => confirmDeleteAccount(),
  _accClose:           () => closeModal(),
});