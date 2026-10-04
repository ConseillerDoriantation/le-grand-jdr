// ══════════════════════════════════════════════════════════════════════════════
// ACCOUNT.JS — Gestion du compte joueur
// ✓ Modifier pseudo, email, mot de passe
// ✓ Supprimer le compte : vend tous les items boutique → restitue le stock,
//   supprime tous les personnages, puis supprime le compte Firebase
// ══════════════════════════════════════════════════════════════════════════════
import { auth } from '../config/firebase.js';

import {
  updatePassword, deleteUser, verifyBeforeUpdateEmail,
  EmailAuthProvider, GoogleAuthProvider,
  reauthenticateWithCredential, reauthenticateWithPopup,
  linkWithCredential, linkWithPopup,
} from 'firebase/auth';   // résolu par l'import map de index.html

import {
  loadCollection, deleteFromCol, updateInCol,
  getDocDataSilent, saveDoc, loadCharsForAdventure,
  loadAdventureCollection, updateInAdventureCol, deleteFromAdventureCol,
} from '../data/firestore.js';

import { openModal, closeModal, promptModal } from '../shared/modal.js';
import { listGithubFolder, GH_IMAGE_EXTS, prettyNameFromFile, fileKey } from '../shared/github-folder.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { refreshSidebarProfile }  from '../core/layout.js';
import { avatarSrcOf, resolveAvatarUrl } from '../shared/avatar.js';
import { STATE, setAdventure, setProfile }     from '../core/state.js';
import PAGES                     from './pages.js';
import { registerActions }        from '../core/actions.js';
import { _esc, _norm }           from '../shared/html.js';
import { emptyStateHtml }        from '../shared/list-renderer.js';
import { calcOr }                from '../shared/char-stats.js';
import { hasPremiumAccess, planLabel, PREMIUM_LIMITS } from '../shared/premium.js';
import { deleteAdventure, removeSelfFromAdventure } from '../core/adventure.js';

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

async function _liquidateAdventureInventory(adventureId, inventaire = [], shopDocs = null) {
  const shopItems = inventaire.filter(i => i.source === 'boutique' && i.itemId);
  if (!shopItems.length) return 0;
  const docs = shopDocs || await loadAdventureCollection(adventureId, 'shop');
  const shopMap = Object.fromEntries(docs.map(item => [item.id, item]));
  const restockByItem = new Map();
  let totalOr = 0;
  shopItems.forEach(item => {
    totalOr += parseFloat(item.prixVente) || Math.round((parseFloat(item.prixAchat) || 0) * .6);
    const current = shopMap[item.itemId]?.dispo;
    if (current !== undefined && current !== '' && Number(current) >= 0) {
      restockByItem.set(item.itemId, (restockByItem.get(item.itemId) || 0) + 1);
    }
  });
  await Promise.all([...restockByItem].map(([itemId, count]) =>
    updateInAdventureCol(adventureId, 'shop', itemId, {
      dispo: Number(shopMap[itemId].dispo) + count,
    })
  ));
  return totalOr;
}

async function _loadAllOwnCharacters(uid, { strict = false } = {}) {
  const adventures = (STATE.adventures || []).filter(a => a?.id);
  const groups = await Promise.all(adventures.map(async adventure => ({
    adventure,
    characters: await loadCharsForAdventure(adventure.id, uid, { throwOnError: strict }),
  })));
  return groups;
}

async function _purgeCharactersFromAdventure(adventureId, chars = []) {
  if (!chars.length) return { nbPersos: 0, totalOr: 0 };
  const combinedInventory = chars.flatMap(c => c.inventaire || []);
  const needsShop = combinedInventory.some(i => i.source === 'boutique' && i.itemId);
  const shopDocs = needsShop ? await loadAdventureCollection(adventureId, 'shop') : [];
  const totalOr = await _liquidateAdventureInventory(adventureId, combinedInventory, shopDocs);
  for (const character of chars) {
    await deleteFromAdventureCol(adventureId, 'characters', character.id);
  }
  if (STATE.adventure?.id === adventureId) {
    const ids = new Set(chars.map(c => c.id));
    STATE.characters = (STATE.characters || []).filter(c => !ids.has(c.id));
  }
  return { nbPersos: chars.length, totalOr };
}

// ══════════════════════════════════════════════════════════════════════════════
function _accountProviderLabel(user) {
  const providers = (user?.providerData || []).map(p => p.providerId).filter(Boolean);
  if (providers.includes('google.com') && providers.includes('password')) return 'Google + email';
  if (providers.includes('google.com')) return 'Google';
  if (providers.includes('password')) return 'Email + mot de passe';
  return providers[0] || 'Compte Firebase';
}

async function _syncCurrentMemberProfiles(patch = {}) {
  const uid = STATE.user?.uid || auth.currentUser?.uid;
  if (!uid || !patch || !Object.keys(patch).length) return;

  const adventures = Array.isArray(STATE.adventures) ? STATE.adventures : [];
  await Promise.all(adventures.map(async (a) => {
    const inAdv = a?.accessList?.includes(uid) || a?.admins?.includes(uid);
    if (!a?.id || !inAdv) return;
    const update = {};
    Object.entries(patch).forEach(([key, value]) => {
      update[`memberProfiles.${uid}.${key}`] = value || '';
    });
    try {
      await updateInCol('adventures', a.id, update);
      const memberProfiles = {
        ...(a.memberProfiles || {}),
        [uid]: { ...(a.memberProfiles?.[uid] || {}), ...patch },
      };
      a.memberProfiles = memberProfiles;
      if (STATE.adventure?.id === a.id) {
        setAdventure({ ...STATE.adventure, memberProfiles });
      }
    } catch (e) {
      console.warn('[account] sync memberProfile ignored:', a.id, e?.code || e);
    }
  }));
}
const _accountUi = {
  open: null,
  section: 'profile',
  danger: false,
  googleReauthed: false,
  deleting: false,
  characterGroups: null,
  avatarTab: 'characters',
  avatarChoice: null,
};
let _accountObserver = null;

const _ACCOUNT_ICONS = {
  edit: '<svg viewBox="0 0 16 16"><path d="M11 2.5l2.5 2.5L6 12.5H3.5V10z"/></svg>',
  user: '<svg viewBox="0 0 16 16"><circle cx="8" cy="5.5" r="2.8"/><path d="M2.5 14c.8-2.8 3-4.2 5.5-4.2s4.7 1.4 5.5 4.2"/></svg>',
  key: '<svg viewBox="0 0 16 16"><circle cx="5.5" cy="10.5" r="3"/><path d="M7.7 8.3L13.5 2.5M11.5 4.5l1.5 1.5"/></svg>',
  star: '<svg viewBox="0 0 16 16"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg>',
  warn: '<svg viewBox="0 0 16 16"><path d="M8 2l6.5 11.5h-13zM8 6.5v3M8 11.8v.1"/></svg>',
  lock: '<svg viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>',
  eye: '<svg viewBox="0 0 16 16"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
  check: '<svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3L13 4.5"/></svg>',
  copy: '<svg viewBox="0 0 16 16"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M10.5 5V3.5A1 1 0 009.5 2.5h-6a1 1 0 00-1 1v6a1 1 0 001 1H5"/></svg>',
  google: '<svg class="ac-google" viewBox="0 0 16 16"><path d="M15.3 8.2c0-.5 0-1-.1-1.4H8v2.7h4.1a3.5 3.5 0 01-1.5 2.3v1.9H13c1.4-1.3 2.3-3.2 2.3-5.5z"/><path d="M8 15.5c2 0 3.7-.7 5-1.8l-2.4-1.9c-.7.5-1.6.8-2.6.8-2 0-3.7-1.4-4.3-3.2H1.2v2A7.5 7.5 0 008 15.5z" opacity=".7"/><path d="M3.7 9.4a4.5 4.5 0 010-2.8v-2H1.2a7.5 7.5 0 000 6.8z" opacity=".5"/><path d="M8 3.5c1.1 0 2.1.4 2.9 1.1L13 2.5A7.5 7.5 0 001.2 4.6l2.5 2C4.3 4.9 6 3.5 8 3.5z" opacity=".85"/></svg>',
};
const _ai = name => `<span class="ac-ico">${_ACCOUNT_ICONS[name] || ''}</span>`;
const _providerSet = user => new Set((user?.providerData || []).map(p => p.providerId));
const _hasProvider = (user, id) => _providerSet(user).has(id);
const _passwordField = (id, placeholder, autocomplete, { reveal = true } = {}) => {
  const input = `<input class="ac-inp" id="${id}" type="password" placeholder="${placeholder}" autocomplete="${autocomplete}" maxlength="128" data-input="validateAccountForm">`;
  if (!reveal) return input;
  return `<div class="ac-pw">${input}<button type="button" data-action="toggleAccountPassword" data-target="${id}" aria-label="Afficher le mot de passe">${_ai('eye')}</button></div>`;
};
const _formatStorage = mb => mb >= 1024 ? `${mb / 1024} Go` : `${mb} Mo`;
const _pendingEmailKey = uid => `grimorium.pendingEmail.${uid}`;

function _avatarMeta(profile, pseudo) {
  const selected = profile.avatarIcon || '';
  if (!selected) return { label: 'Avatar par défaut', source: 'Initiales de ton pseudo' };
  const character = (_accountUi.characterGroups || []).flatMap(g => g.characters).find(c => _charPortrait(c) === selected);
  if (character) return { label: character.nom || 'Portrait de personnage', source: 'Portrait de personnage' };
  const appAvatar = (_iconCatalog || []).find(icon => icon.url === selected);
  return { label: appAvatar?.label || pseudo, source: appAvatar ? "Avatar de l'app" : 'Portrait du compte' };
}

function _profileSection(profile, user) {
  const pseudo = profile.pseudo || 'Aventurier';
  const currentChars = (STATE.characters || []).filter(c => c.uid === user.uid).length;
  const open = _accountUi.open === 'pseudo';
  const avatar = _avatarMeta(profile, pseudo);
  return `<section class="ac-sec" id="account-profile"><div class="ac-sec-h"><h2>Profil</h2><p>Ce que voient les autres joueurs.</p></div><div class="ac-card">
    <div class="ac-row ${open ? 'open' : ''}"><span class="ac-lb">Pseudo</span>${open ? `
      <div class="ac-form"><label class="ac-f"><span>Nouveau pseudo <i id="acc-pseudo-count">${pseudo.length}/30</i></span><input class="ac-inp" id="acc-pseudo" value="${_esc(pseudo)}" maxlength="40" autocomplete="nickname" data-input="validateAccountForm"></label>
      <div class="ac-preview"><img src="${_esc(avatarSrcOf(profile))}" alt=""><span><b id="acc-pseudo-preview">${_esc(pseudo)}</b><small>Prêt pour la séance de ce soir.</small></span><em>Aperçu chat</em></div>
      <p class="ac-note">Mis à jour sur tes ${currentChars} personnage${currentChars === 1 ? '' : 's'} chargé${currentChars === 1 ? '' : 's'} et dans tes ${(STATE.adventures || []).length} aventure${(STATE.adventures || []).length === 1 ? '' : 's'}.</p>
      <p class="ac-err" id="acc-pseudo-error" hidden></p><div class="ac-form-actions"><button class="ac-btn ghost" data-action="closeAccountEditor">Annuler</button><button class="ac-btn primary" id="acc-pseudo-save" data-action="saveAccountPseudo" disabled>Enregistrer</button></div></div>` : `
      <div class="ac-value"><b>${_esc(pseudo)}</b><small>Ton nom à la table : chat, initiative, listes de joueurs.</small></div><button class="ac-btn" data-action="openAccountEditor" data-editor="pseudo">${_ai('edit')}Modifier</button>`}</div>
    <div class="ac-row"><span class="ac-lb">Avatar</span><div class="ac-value"><span class="ac-avatar-value"><img src="${_esc(avatarSrcOf(profile))}" alt=""><span><b>${_esc(avatar.label)}</b><small>${_esc(avatar.source)}</small></span></span></div><button class="ac-btn" data-action="openAvatarPicker">Changer</button></div>
  </div></section>`;
}

function _connectionSection(user) {
  const email = user.email || STATE.profile?.email || '';
  const hasPassword = _hasProvider(user, 'password');
  const hasGoogle = _hasProvider(user, 'google.com');
  const emailOpen = _accountUi.open === 'email';
  const passwordOpen = _accountUi.open === 'password' || _accountUi.open === 'link-password';
  const pending = localStorage.getItem(_pendingEmailKey(user.uid)) || '';
  const methodBadges = `${hasPassword ? `<span>${_ai('key')}Email + mot de passe</span>` : ''}${hasGoogle ? `<span>${_ai('google')}Google</span>` : ''}`;
  const methodActions = `${!hasGoogle ? `<button class="ac-btn" data-action="linkAccountGoogle">${_ai('google')}Lier Google</button>` : ''}${!hasPassword ? `<button class="ac-btn" data-action="openAccountEditor" data-editor="link-password">${_ai('key')}Ajouter un mot de passe</button>` : ''}`;
  const emailRow = emailOpen
    ? `<div class="ac-row open"><span class="ac-lb">Adresse email</span><div class="ac-form"><p class="ac-note">Actuelle : <b>${_esc(email)}</b></p><label class="ac-f"><span>Nouvelle adresse</span><input class="ac-inp" id="acc-new-email" type="email" inputmode="email" autocomplete="email" maxlength="254" data-input="validateAccountForm"></label><label class="ac-f"><span>Mot de passe actuel</span>${_passwordField('acc-email-password', '••••••••', 'current-password', { reveal: false })}</label><p class="ac-note">Un lien de confirmation sera envoyé à la nouvelle adresse.</p><p class="ac-err" id="acc-email-error" hidden></p><div class="ac-form-actions"><button class="ac-btn ghost" data-action="closeAccountEditor">Annuler</button><button class="ac-btn primary" id="acc-email-save" data-action="saveAccountEmail" disabled>Envoyer le lien</button></div></div></div>`
    : `<div class="ac-row"><span class="ac-lb">Adresse email</span><div class="ac-value"><b>${_esc(email || 'Non renseignée')}</b><small>${pending ? `Confirmation envoyée à ${_esc(pending)}.` : 'Sert à te connecter, recevoir les invitations et récupérer ton compte.'}</small></div>${hasPassword ? `<button class="ac-btn" data-action="openAccountEditor" data-editor="email">${_ai('edit')}Modifier</button>` : `<span class="ac-lock">${_ai('lock')}Géré par Google</span>`}</div>`;
  let passwordLead = '';
  if (hasPassword) passwordLead = `<label class="ac-f"><span>Mot de passe actuel</span>${_passwordField('acc-old-password', '••••••••', 'current-password', { reveal: false })}</label>`;
  else if (!email) passwordLead = '<label class="ac-f"><span>Adresse email</span><input class="ac-inp" id="acc-link-email" type="email" autocomplete="email" data-input="validateAccountForm"></label>';
  else passwordLead = `<p class="ac-note">Le mot de passe sera lié à <b>${_esc(email)}</b>.</p>`;
  const passwordRow = passwordOpen
    ? `<div class="ac-row open"><span class="ac-lb">Mot de passe</span><div class="ac-form">${passwordLead}<label class="ac-f"><span>Nouveau mot de passe</span>${_passwordField('acc-new-password', '', 'new-password')}</label><label class="ac-f"><span>Confirmer</span>${_passwordField('acc-confirm-password', '', 'new-password')}</label><ul class="ac-checks"><li id="acc-check-length"><i>${_ai('check')}</i>6 caractères minimum</li><li id="acc-check-match"><i>${_ai('check')}</i>Les deux saisies correspondent</li>${hasPassword ? `<li id="acc-check-different"><i>${_ai('check')}</i>Différent de l'actuel</li>` : ''}</ul><p class="ac-err" id="acc-password-error" hidden></p><div class="ac-form-actions"><button class="ac-btn ghost" data-action="closeAccountEditor">Annuler</button><button class="ac-btn primary" id="acc-password-save" data-action="saveAccountPassword" disabled>${hasPassword ? 'Mettre à jour' : 'Ajouter cette méthode'}</button></div></div></div>`
    : `<div class="ac-row"><span class="ac-lb">Mot de passe</span><div class="ac-value"><b class="${hasPassword ? '' : 'dim'}">${hasPassword ? '••••••••' : 'Aucun'}</b><small>${hasPassword ? 'Change-le si tu soupçonnes un accès non voulu.' : 'Ton compte utilise actuellement Google.'}</small></div><button class="ac-btn" data-action="openAccountEditor" data-editor="${hasPassword ? 'password' : 'link-password'}">${_ai('edit')}${hasPassword ? 'Modifier' : 'Ajouter'}</button></div>`;
  return `<section class="ac-sec" id="account-connection"><div class="ac-sec-h"><h2>Connexion &amp; sécurité</h2><p>Gère tes méthodes de connexion sans créer de compte en double.</p></div><div class="ac-card"><div class="ac-row"><span class="ac-lb">Méthodes</span><div class="ac-value"><span class="ac-provider-list">${methodBadges}</span><small>Lier les deux méthodes permet d'utiliser le même compte dans les deux cas.</small></div><div class="ac-row-actions">${methodActions}</div></div>${emailRow}${passwordRow}<div class="ac-row"><span class="ac-lb">Identifiant</span><div class="ac-value"><code>${_esc(user.uid)}</code><small>À communiquer au support ou au MJ en cas de souci de rattachement.</small></div><button class="ac-btn ghost" data-action="copyAccountUid">${_ai('copy')}Copier</button></div></div></section>`;
}

function _planSection(profile) {
  const premium = hasPremiumAccess(profile);
  const pages = ['Boutique','Collection','Hauts-Faits','Carte','Guide','Joueurs','Bastion','Recettes','Statistiques'];
  const column = (key, name) => {
    const limits = PREMIUM_LIMITS[key];
    const active = (key === 'premium') === premium;
    return `<div class="ac-plan-column ${active ? 'active' : ''} ${key === 'premium' ? 'premium' : ''}"><div class="ac-plan-title"><b>${name}</b>${active ? '<em>Ton plan</em>' : ''}</div><ul><li>Aventures en tant que MJ <b>Illimitées</b></li><li>Stockage images <b>${_formatStorage(limits.imageStorageMb)}</b></li><li>Stockage musiques <b>${_formatStorage(limits.musicStorageMb)}</b></li><li>Pages bonus <b class="${key === 'free' ? 'off' : ''}">${key === 'free' ? '—' : 'Toutes'}</b></li><li>VTT avancé <b class="${key === 'free' ? 'off' : ''}">${key === 'free' ? '—' : 'Inclus'}</b></li></ul></div>`;
  };
  return `<section class="ac-sec" id="account-plan"><div class="ac-sec-h"><h2>Abonnement</h2><p>Ton plan et ce qu'il inclut.</p></div><div class="ac-card"><div class="ac-plan">${column('free','Gratuit')}${column('premium','Premium')}</div><div class="ac-plan-pages"><span class="ac-kicker">Pages bonus ${premium ? 'débloquées' : '— Premium'}</span><div class="ac-chips ${premium ? '' : 'locked'}">${pages.map(page => `<span>${premium ? '' : _ai('lock')}${page}</span>`).join('')}</div></div><div class="ac-plan-footer"><p>${STATE.isSuperAdmin ? 'Super-admin : Premium attribué automatiquement.' : premium ? 'Premium actif. Accordé par un super-admin.' : "Le passage en Premium se fait pour l'instant auprès d'un super-admin — le paiement en ligne arrive plus tard."}</p></div></div></section>`;
}

function _dangerSection(user) {
  const groups = _accountUi.characterGroups;
  const charCount = groups ? groups.reduce((sum, g) => sum + g.characters.length, 0) : null;
  const owned = (STATE.adventures || []).filter(a => a.createdBy === user.uid);
  const transferable = owned.filter(a => _adventureSuccessor(a, user.uid));
  const deleted = owned.length - transferable.length;
  const hasPassword = _hasProvider(user, 'password');
  const hasGoogle = _hasProvider(user, 'google.com');
  return `<section class="ac-sec" id="account-danger"><div class="ac-sec-h"><h2>Zone sensible</h2></div><div class="ac-card danger"><div class="ac-danger-summary"><div><b>Supprimer mon compte</b><small>Efface définitivement ton compte et tes personnages. Impossible à annuler.</small></div>${_accountUi.danger ? '' : '<button class="ac-btn danger-text" data-action="openAccountDanger">Supprimer le compte…</button>'}</div>${_accountUi.danger ? `<div class="ac-danger-form">${groups ? `<ul class="ac-consequences"><li><b>${charCount}</b> personnage${charCount === 1 ? '' : 's'} supprimé${charCount === 1 ? '' : 's'}, avec fiches et inventaires</li><li><b>${transferable.length}</b> aventure${transferable.length === 1 ? '' : 's'} transférée${transferable.length === 1 ? '' : 's'} au prochain membre</li><li><b>${deleted}</b> aventure${deleted === 1 ? '' : 's'} sans autre membre supprimée${deleted === 1 ? '' : 's'}</li><li><b>✓</b> Objets achetés remis en stock avant le départ</li></ul>` : '<p class="ac-note">Calcul des données concernées…</p>'}${hasGoogle ? `<div class="ac-f"><span>Confirme ton identité</span><button class="ac-google-button ${_accountUi.googleReauthed ? 'confirmed' : ''}" data-action="reauthAccountGoogle">${_accountUi.googleReauthed ? `${_ai('check')}Identité confirmée` : `${_ai('google')}Confirmer avec Google`}</button></div>` : ''}${hasPassword ? `<label class="ac-f"><span>${hasGoogle ? 'Ou confirme avec ton mot de passe' : 'Mot de passe actuel'}</span>${_passwordField('acc-delete-password', '••••••••', 'current-password', { reveal: false })}</label>` : ''}<label class="ac-f"><span>Tape SUPPRIMER pour confirmer</span><input class="ac-inp" id="acc-delete-confirm" placeholder="SUPPRIMER" autocomplete="off" spellcheck="false" data-input="validateAccountForm"></label><p class="ac-err" id="acc-delete-error" hidden></p><div class="ac-form-actions left"><button class="ac-btn danger" id="acc-delete-button" data-action="confirmDeleteAccount" disabled>${_accountUi.deleting ? 'Suppression en cours…' : 'Supprimer définitivement'}</button><button class="ac-btn ghost" data-action="closeAccountDanger">Annuler</button></div></div>` : ''}</div></section>`;
}

async function renderAccount() {
  const content = document.getElementById('main-content');
  const user = auth.currentUser;
  const profile = STATE.profile || {};
  if (!user) { content.innerHTML = emptyStateHtml('', 'Non connecté.'); return; }
  const pending = localStorage.getItem(_pendingEmailKey(user.uid));
  if (pending && user.email?.toLowerCase() === pending.toLowerCase()) localStorage.removeItem(_pendingEmailKey(user.uid));
  const pseudo = profile.pseudo || 'Aventurier';
  const premium = hasPremiumAccess(profile);
  const ownsAdventure = (STATE.adventures || []).some(a => a.createdBy === user.uid || (a.admins || []).includes(user.uid));
  content.innerHTML = `<div class="ac-page"><header class="ac-header"><button class="ac-header-avatar" data-action="openAvatarPicker" aria-label="Changer d'avatar"><img src="${_esc(avatarSrcOf(profile))}" alt=""><span>${_ai('edit')}</span></button><div class="ac-header-text"><span class="ac-kicker">Mon compte</span><h1>${_esc(pseudo)}</h1><p>${_esc(user.email || profile.email || '')}</p><div class="ac-tags"><span class="${premium ? 'premium' : ''}">${_esc(planLabel(profile))}</span>${ownsAdventure ? '<span class="gm">Maître de jeu</span>' : ''}<span>${_esc(_accountProviderLabel(user))}</span></div></div></header><div class="ac-layout"><nav class="ac-nav" aria-label="Sections du compte"><button class="${_accountUi.section === 'profile' ? 'active' : ''}" data-action="goAccountSection" data-section="profile">${_ai('user')}Profil</button><button class="${_accountUi.section === 'connection' ? 'active' : ''}" data-action="goAccountSection" data-section="connection">${_ai('key')}Connexion</button><button class="${_accountUi.section === 'plan' ? 'active' : ''}" data-action="goAccountSection" data-section="plan">${_ai('star')}Abonnement</button><button class="danger-nav ${_accountUi.section === 'danger' ? 'active' : ''}" data-action="goAccountSection" data-section="danger">${_ai('warn')}Zone sensible</button></nav><main class="ac-main">${_profileSection(profile, user)}${_connectionSection(user)}${_planSection(profile)}${_dangerSection(user)}</main></div></div>`;
  _setupAccountObserver();
  validateAccountForm();
}

function _setupAccountObserver() {
  _accountObserver?.disconnect();
  if (!('IntersectionObserver' in window)) return;
  _accountObserver = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    const section = visible.target.id.replace('account-', '');
    _accountUi.section = section;
    document.querySelectorAll('.ac-nav button').forEach(button => button.classList.toggle('active', button.dataset.section === section));
  }, { rootMargin: '-25% 0px -60% 0px', threshold: [0, .2, .6] });
  document.querySelectorAll('.ac-sec').forEach(section => _accountObserver.observe(section));
}

function _adventureSuccessor(adventure, uid) {
  const admins = (adventure.admins || []).filter(id => id && id !== uid);
  if (admins.length) return admins[0];
  return [...(adventure.players || []), ...(adventure.accessList || [])].find(id => id && id !== uid) || null;
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
  const uid = STATE.user?.uid || auth.currentUser?.uid;
  if (!uid) return;
  const [catalog, groups] = await Promise.all([
    _loadIconCatalog(),
    _accountUi.characterGroups ? Promise.resolve(_accountUi.characterGroups) : _loadAllOwnCharacters(uid),
  ]);
  _accountUi.characterGroups = groups;
  _accountUi.avatarChoice = STATE.profile?.avatarIcon || '';
  const chars = groups.flatMap(group => group.characters).filter(_charPortrait);
  _accountUi.avatarTab = catalog.some(icon => icon.url === _accountUi.avatarChoice) ? 'app' : 'characters';
  _renderAvatarPicker(chars, catalog);
}

function _renderAvatarPicker(chars = [], catalog = []) {
  document.querySelector('.ac-avatar-overlay')?.remove();
  const selected = _accountUi.avatarChoice || '';
  const choices = _accountUi.avatarTab === 'characters'
    ? [{ url: '', label: 'Par défaut', fallback: true }, ...chars.map(c => ({ url: _charPortrait(c), label: c.nom || 'Personnage' }))]
    : catalog.map(icon => ({ url: icon.url, label: icon.label || 'Avatar' }));
  const selectedChoice = [...choices, ...catalog.map(icon => ({ url: icon.url, label: icon.label }))].find(choice => choice.url === selected);
  const fallback = (STATE.profile?.pseudo || 'A').trim().slice(0, 1).toUpperCase();
  const preview = selected ? `<img src="${_esc(resolveAvatarUrl(selected))}" alt="">` : `<span>${_esc(fallback)}</span>`;
  const overlay = document.createElement('div');
  overlay.className = 'ac-avatar-overlay';
  overlay.dataset.action = 'closeAvatarPicker';
  overlay.innerHTML = `<div class="ac-avatar-modal" role="dialog" aria-modal="true" aria-labelledby="account-avatar-title"><header><div class="ac-avatar-preview">${preview}</div><div><span class="ac-kicker">Avatar du compte</span><h3 id="account-avatar-title">Choisir un avatar</h3></div><button class="ac-modal-close" data-action="closeAvatarPicker" aria-label="Fermer">×</button></header><div class="ac-avatar-body"><div class="ac-avatar-tabs"><button class="${_accountUi.avatarTab === 'characters' ? 'active' : ''}" data-action="setAvatarTab" data-tab="characters">Mes personnages <i>${chars.length}</i></button><button class="${_accountUi.avatarTab === 'app' ? 'active' : ''}" data-action="setAvatarTab" data-tab="app">Avatars de l'app <i>${catalog.length}</i></button></div><div class="ac-avatar-grid">${choices.length ? choices.map(choice => `<button class="ac-avatar-option ${choice.url === selected ? 'active' : ''}" data-action="selectAccountAvatar" data-url="${_esc(choice.url)}"><span>${choice.fallback ? _esc(fallback) : `<img src="${_esc(resolveAvatarUrl(choice.url))}" alt="" loading="lazy">`}</span><small>${_esc(choice.label)}</small></button>`).join('') : '<p class="ac-avatar-empty">Aucun avatar dans cette sélection.</p>'}</div>${_accountUi.avatarTab === 'characters' ? '<p class="ac-note">Portraits de tes personnages, toutes aventures confondues.</p>' : ''}</div><footer>${STATE.isSuperAdmin ? '<button class="ac-btn ghost" data-action="openAvatarManagerFromPicker">Gérer le catalogue</button>' : ''}<span></span><button class="ac-btn ghost" data-action="closeAvatarPicker">Annuler</button><button class="ac-btn primary" data-action="applyAccountAvatar" ${selected === (STATE.profile?.avatarIcon || '') ? 'disabled' : ''}>Utiliser cet avatar</button></footer><span class="ac-avatar-selected" hidden>${_esc(selectedChoice?.label || 'Par défaut')}</span></div>`;
  document.body.appendChild(overlay);
}

function setAvatarTab(tab) {
  _accountUi.avatarTab = tab === 'app' ? 'app' : 'characters';
  const chars = (_accountUi.characterGroups || []).flatMap(group => group.characters).filter(_charPortrait);
  _renderAvatarPicker(chars, _iconCatalog || []);
}

function selectAccountAvatar(url) {
  _accountUi.avatarChoice = url || '';
  const chars = (_accountUi.characterGroups || []).flatMap(group => group.characters).filter(_charPortrait);
  _renderAvatarPicker(chars, _iconCatalog || []);
}

function closeAvatarPicker(button, event) {
  if (button?.classList?.contains('ac-avatar-overlay') && event?.target !== button) return;
  document.querySelector('.ac-avatar-overlay')?.remove();
}

async function chooseAvatar(url = _accountUi.avatarChoice || '') {
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
    closeAvatarPicker();
    showNotif(url ? 'Avatar mis à jour !' : 'Avatar réinitialisé.', 'success');
    await renderAccount();
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

function _setAccountError(id, message = '') {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = message;
  element.hidden = !message;
}

function _authErrorMessage(error) {
  if (['auth/wrong-password', 'auth/invalid-credential'].includes(error?.code)) return 'Mot de passe incorrect.';
  if (error?.code === 'auth/email-already-in-use') return 'Cette adresse est déjà utilisée par un autre compte.';
  if (error?.code === 'auth/credential-already-in-use') return 'Cette méthode est déjà liée à un autre compte. Contacte le support pour fusionner les données.';
  if (error?.code === 'auth/popup-closed-by-user') return 'La fenêtre Google a été fermée avant la confirmation.';
  if (error?.code === 'auth/requires-recent-login') return 'Ta session est trop ancienne. Reconnecte-toi puis réessaie.';
  if (error?.code === 'auth/weak-password') return 'Le mot de passe est trop faible.';
  return error?.message || 'Une erreur inattendue est survenue.';
}

function openAccountEditor(editor) {
  _accountUi.open = editor;
  renderAccount().then(() => {
    const targets = { pseudo: 'acc-pseudo', email: 'acc-new-email', password: 'acc-old-password', 'link-password': 'acc-new-password' };
    const input = document.getElementById(targets[editor]);
    input?.focus();
    input?.select?.();
  });
}

function closeAccountEditor() {
  _accountUi.open = null;
  renderAccount();
}

function toggleAccountPassword(target) {
  const input = document.getElementById(target);
  if (input) input.type = input.type === 'password' ? 'text' : 'password';
}

function validateAccountForm() {
  if (_accountUi.open === 'pseudo') {
    const input = document.getElementById('acc-pseudo');
    if (input) {
      const value = input.value.trim();
      const count = document.getElementById('acc-pseudo-count');
      const preview = document.getElementById('acc-pseudo-preview');
      if (count) { count.textContent = `${value.length}/30`; count.classList.toggle('over', value.length > 30); }
      if (preview) preview.textContent = value || '…';
      input.classList.toggle('bad', value.length > 30);
      const button = document.getElementById('acc-pseudo-save');
      if (button) button.disabled = !value || value.length > 30 || value === (STATE.profile?.pseudo || 'Aventurier');
    }
  }
  if (_accountUi.open === 'email') {
    const email = document.getElementById('acc-new-email')?.value.trim() || '';
    const password = document.getElementById('acc-email-password')?.value || '';
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    document.getElementById('acc-new-email')?.classList.toggle('bad', !!email && !valid);
    const button = document.getElementById('acc-email-save');
    if (button) button.disabled = !valid || !password || email.toLowerCase() === (auth.currentUser?.email || '').toLowerCase();
  }
  if (_accountUi.open === 'password' || _accountUi.open === 'link-password') {
    const oldValue = document.getElementById('acc-old-password')?.value || '';
    const newValue = document.getElementById('acc-new-password')?.value || '';
    const confirmValue = document.getElementById('acc-confirm-password')?.value || '';
    const lengthOk = newValue.length >= 6;
    const matchOk = !!newValue && newValue === confirmValue;
    const differentOk = _accountUi.open === 'link-password' || (!!newValue && newValue !== oldValue);
    document.getElementById('acc-check-length')?.classList.toggle('ok', lengthOk);
    document.getElementById('acc-check-match')?.classList.toggle('ok', matchOk);
    document.getElementById('acc-check-different')?.classList.toggle('ok', differentOk);
    const linkEmail = document.getElementById('acc-link-email')?.value.trim() || auth.currentUser?.email || '';
    const button = document.getElementById('acc-password-save');
    if (button) button.disabled = !lengthOk || !matchOk || !differentOk || (_accountUi.open === 'password' && !oldValue) || (_accountUi.open === 'link-password' && !linkEmail);
  }
  if (_accountUi.danger) {
    const confirmed = document.getElementById('acc-delete-confirm')?.value.trim() === 'SUPPRIMER';
    const password = document.getElementById('acc-delete-password')?.value || '';
    const identityOk = _accountUi.googleReauthed || !!password;
    const button = document.getElementById('acc-delete-button');
    if (button) button.disabled = !confirmed || !identityOk || !_accountUi.characterGroups || _accountUi.deleting;
  }
}

async function saveAccountPseudo() {
  const user = auth.currentUser;
  const newPseudo = document.getElementById('acc-pseudo')?.value.trim();
  if (!user || !newPseudo || newPseudo.length > 30) return;
  try {
    // Lecture explicite seulement au clic Enregistrer : garantit que toutes les
    // fiches seront mises à jour, sans ajouter de coût au rendu de la page.
    const groups = await _loadAllOwnCharacters(user.uid, { strict: true });
    await updateInCol('users', user.uid, { pseudo: newPseudo });
    setProfile({ ...(STATE.profile || {}), pseudo: newPseudo });
    await _syncCurrentMemberProfiles({ pseudo: newPseudo });
    _accountUi.characterGroups = groups;
    await Promise.all(groups.flatMap(group => group.characters.map(character =>
      updateInAdventureCol(group.adventure.id, 'characters', character.id, { ownerPseudo: newPseudo })
    )));
    (STATE.characters || []).filter(c => c.uid === user.uid).forEach(c => { c.ownerPseudo = newPseudo; });
    _accountUi.open = null;
    showNotif('Pseudo mis à jour.', 'success');
    refreshSidebarProfile();
    await renderAccount();
  } catch (error) {
    console.error('[account] pseudo:', error);
    _setAccountError('acc-pseudo-error', 'Impossible de mettre le pseudo à jour.');
  }
}

async function saveAccountEmail() {
  const user = auth.currentUser;
  const newEmail = document.getElementById('acc-new-email')?.value.trim();
  const password = document.getElementById('acc-email-password')?.value || '';
  if (!user || !newEmail || !password) return;
  if (newEmail.toLowerCase() === (user.email || '').toLowerCase()) {
    _setAccountError('acc-email-error', "C'est déjà ton adresse actuelle.");
    return;
  }
  try {
    _setAccountError('acc-email-error');
    await _reauth(password);
    await verifyBeforeUpdateEmail(user, newEmail);
    localStorage.setItem(_pendingEmailKey(user.uid), newEmail);
    _accountUi.open = null;
    showNotif(`Lien de confirmation envoyé à ${newEmail}.`, 'success');
    await renderAccount();
  } catch (error) {
    console.error('[account] verify email:', error);
    _setAccountError('acc-email-error', _authErrorMessage(error));
  }
}

async function saveAccountPassword() {
  const user = auth.currentUser;
  if (!user) return;
  const oldPassword = document.getElementById('acc-old-password')?.value || '';
  const newPassword = document.getElementById('acc-new-password')?.value || '';
  const confirmation = document.getElementById('acc-confirm-password')?.value || '';
  const linking = _accountUi.open === 'link-password';
  if (newPassword.length < 6 || newPassword !== confirmation) return;
  try {
    _setAccountError('acc-password-error');
    if (linking) {
      const email = document.getElementById('acc-link-email')?.value.trim() || user.email;
      if (!email) throw new Error('Une adresse email est nécessaire.');
      await linkWithCredential(user, EmailAuthProvider.credential(email, newPassword));
    } else {
      await _reauth(oldPassword);
      await updatePassword(user, newPassword);
    }
    await user.reload();
    _accountUi.open = null;
    showNotif(linking ? 'Connexion par email ajoutée.' : 'Mot de passe mis à jour.', 'success');
    await renderAccount();
  } catch (error) {
    console.error('[account] password:', error);
    _setAccountError('acc-password-error', _authErrorMessage(error));
  }
}

async function linkAccountGoogle() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await linkWithPopup(user, provider);
    await user.reload();
    showNotif('Connexion Google liée au compte.', 'success');
    await renderAccount();
  } catch (error) {
    console.error('[account] link google:', error);
    showNotif(_authErrorMessage(error), 'error');
  }
}

async function copyAccountUid() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try { await navigator.clipboard.writeText(uid); showNotif('Identifiant copié.', 'success'); }
  catch { showNotif("Impossible de copier automatiquement l'identifiant.", 'error'); }
}

function goAccountSection(section) {
  _accountUi.section = section;
  document.getElementById(`account-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function openAccountDanger() {
  const user = auth.currentUser;
  if (!user) return;
  _accountUi.danger = true;
  _accountUi.googleReauthed = false;
  _accountUi.characterGroups = null;
  await renderAccount();
  _accountUi.characterGroups = await _loadAllOwnCharacters(user.uid, { strict: true });
  await renderAccount();
  document.getElementById(_hasProvider(user, 'password') ? 'acc-delete-password' : 'acc-delete-confirm')?.focus();
}

function closeAccountDanger() {
  _accountUi.danger = false;
  _accountUi.googleReauthed = false;
  renderAccount();
}

async function reauthAccountGoogle() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await reauthenticateWithPopup(user, provider);
    _accountUi.googleReauthed = true;
    await renderAccount();
  } catch (error) {
    _setAccountError('acc-delete-error', _authErrorMessage(error));
  }
}

function _withoutOwnEmail(emails, ownEmail) {
  const normalized = String(ownEmail || '').trim().toLowerCase();
  return (emails || []).filter(email => String(email || '').trim().toLowerCase() !== normalized);
}

async function _transferOwnedAdventure(adventure, successor, uid) {
  const unique = values => [...new Set(values.filter(Boolean))];
  const memberProfiles = { ...(adventure.memberProfiles || {}) };
  delete memberProfiles[uid];
  await updateInCol('adventures', adventure.id, {
    createdBy: successor,
    admins: unique([successor, ...(adventure.admins || []).filter(id => id !== uid && id !== successor)]),
    players: unique((adventure.players || []).filter(id => id !== uid && id !== successor)),
    accessList: unique([successor, ...(adventure.accessList || []).filter(id => id !== uid)]),
    accessEmails: _withoutOwnEmail(adventure.accessEmails, auth.currentUser?.email),
    memberProfiles,
  });
}

async function confirmDeleteAccount() {
  const user = auth.currentUser;
  const confirmation = document.getElementById('acc-delete-confirm')?.value.trim();
  const password = document.getElementById('acc-delete-password')?.value || '';
  if (!user || confirmation !== 'SUPPRIMER' || (!_accountUi.googleReauthed && !password)) return;
  _accountUi.deleting = true;
  validateAccountForm();
  try {
    if (!_accountUi.googleReauthed) await _reauth(password);
    const groups = _accountUi.characterGroups || await _loadAllOwnCharacters(user.uid, { strict: true });
    const byAdventure = new Map(groups.map(group => [group.adventure.id, group.characters]));
    for (const adventure of [...(STATE.adventures || [])]) {
      const characters = byAdventure.get(adventure.id) || [];
      if (adventure.createdBy === user.uid) {
        const successor = _adventureSuccessor(adventure, user.uid);
        if (!successor) {
          await deleteAdventure(adventure.id);
          continue;
        }
        await _purgeCharactersFromAdventure(adventure.id, characters);
        await _transferOwnedAdventure(adventure, successor, user.uid);
        continue;
      }
      await _purgeCharactersFromAdventure(adventure.id, characters);
      await removeSelfFromAdventure(adventure.id);
    }
    await deleteFromCol('users', user.uid);
    await deleteUser(user);
    showNotif('Compte supprimé. Au revoir.', 'success');
  } catch (error) {
    console.error('[account] delete:', error);
    _accountUi.deleting = false;
    _setAccountError('acc-delete-error', _authErrorMessage(error));
    validateAccountForm();
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
  setAvatarTab:        (btn) => setAvatarTab(btn.dataset.tab),
  selectAccountAvatar:(btn) => selectAccountAvatar(btn.dataset.url || ''),
  applyAccountAvatar:  () => chooseAvatar(),
  closeAvatarPicker:   (btn, event) => closeAvatarPicker(btn, event),
  openAvatarManagerFromPicker: () => { closeAvatarPicker(); openAvatarManager(); },
  openAvatarManager:   () => openAvatarManager(),
  addAvatarIcon:       () => addAvatarIcon(),
  importAvatarsGithub: () => importAvatarsGithub(),
  dedupeAvatarsCatalog: () => dedupeAvatarsCatalog(),
  updateAvatarIcon:    (btn) => updateAvatarIcon(Number(btn.dataset.idx)),
  removeAvatarIcon:    (btn) => removeAvatarIcon(Number(btn.dataset.idx)),
  openAccountEditor:   (btn) => openAccountEditor(btn.dataset.editor),
  closeAccountEditor:  () => closeAccountEditor(),
  toggleAccountPassword: (btn) => toggleAccountPassword(btn.dataset.target),
  validateAccountForm: () => validateAccountForm(),
  saveAccountPseudo:   () => saveAccountPseudo(),
  saveAccountEmail:    () => saveAccountEmail(),
  saveAccountPassword: () => saveAccountPassword(),
  linkAccountGoogle:   () => linkAccountGoogle(),
  copyAccountUid:      () => copyAccountUid(),
  goAccountSection:    (btn) => goAccountSection(btn.dataset.section),
  openAccountDanger:   () => openAccountDanger(),
  closeAccountDanger:  () => closeAccountDanger(),
  reauthAccountGoogle: () => reauthAccountGoogle(),
  confirmDeleteAccount:() => confirmDeleteAccount(),
  _accClose:           () => closeModal(),
});

document.addEventListener('keydown', event => {
  if (!document.querySelector('.ac-page') && !document.querySelector('.ac-avatar-overlay')) return;
  if (event.key === 'Escape') {
    if (document.querySelector('.ac-avatar-overlay')) closeAvatarPicker();
    else if (_accountUi.open) closeAccountEditor();
    else if (_accountUi.danger) closeAccountDanger();
  }
  if (event.key === 'Enter' && event.target?.closest('.ac-form')) {
    const button = event.target.closest('.ac-form').querySelector('.ac-btn.primary:not(:disabled)');
    if (button) { event.preventDefault(); button.click(); }
  }
});
