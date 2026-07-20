// ══════════════════════════════════════════════
// ADVENTURE — Gestion des aventures
// Chargement, sélection, création, gestion joueurs
// ══════════════════════════════════════════════

import {
  db,
  doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, getDocs, getDocsFromServer,
  writeBatch,
  query, where,
} from '../config/firebase.js';

import {
  STATE,
  setAdventure,
  setAdventures,
  setAdmin,
  setProfile,
} from './state.js';

import { setCurrentAdventure, primeSessionData } from '../data/firestore.js';
import { startPresence } from '../shared/presence.js';
import { initChat } from '../features/chat.js';
import { initCharacterPages } from '../shared/character-pages.js';
import { DEFAULT_ENABLED } from '../shared/features.js';
// Caches module-level de « défauts MJ » scopés par aventure (types de dégâts,
// formats d'arme, matrices de sorts, conditions, améliorations, picker boutique) :
// à vider au changement d'aventure sinon les données d'une aventure « fuient » sur
// la suivante (l'app est une SPA, ces caches survivent au logout/switch).
import { invalidateDamageTypesCache } from '../shared/damage-types.js';
import { invalidateWeaponFormatsCache } from '../shared/weapon-formats.js';
import { invalidateSpellMatricesCache } from '../shared/spell-matrices.js';
import { invalidateUpgradeSettingsCache } from '../shared/upgrade-settings.js';
import { invalidateCharacterRulesCache, loadCharacterRules } from '../shared/character-rules.js';
import { invalidateEquipmentSlotsCache, loadEquipmentSlots } from '../shared/equipment-slots.js';
import { invalidateArmorSetSettingsCache, loadArmorSetSettings } from '../shared/armor-set-settings.js';
import { invalidateSpellSystemCache, loadSpellSystem } from '../shared/spell-system.js';
import { invalidateShopPickerCache } from '../shared/shop-picker.js';
import { clearConditionLibraryCache } from '../shared/conditions.js';
import { invalidateRaritiesCache, loadRarities } from '../shared/rarity.js';
import { hasPremiumAccess } from '../shared/premium.js';

function _invalidateScopedCaches() {
  invalidateDamageTypesCache();
  invalidateWeaponFormatsCache();
  invalidateSpellMatricesCache();
  invalidateUpgradeSettingsCache();
  invalidateCharacterRulesCache();
  invalidateEquipmentSlotsCache();
  invalidateArmorSetSettingsCache();
  invalidateSpellSystemCache();
  invalidateShopPickerCache();
  clearConditionLibraryCache();
  invalidateRaritiesCache();
}

const _emailRaw = (email = '') => String(email || '').trim();
const _emailKey = (email = '') => _emailRaw(email).toLowerCase();
const _emailKeys = (email = '') => _uniq([_emailRaw(email), _emailKey(email)]);
const _uniq = (arr = []) => [...new Set((arr || []).filter(Boolean))];
// Profil dénormalisé de l'utilisateur courant pour `memberProfiles` {uid:{pseudo,email}}.
// L'email y est déjà présent au niveau de l'aventure (accessEmails) : on n'expose rien
// de nouveau, on ajoute juste le mapping uid→(pseudo,email) que les règles `users`
// (anti-moisson) empêchent sinon de reconstituer côté MJ non super-admin.
const _selfEmail   = () => _emailRaw(STATE.profile?.email || STATE.user?.email);
const _selfProfile = () => ({
  pseudo: STATE.profile?.pseudo || _selfEmail() || 'Aventurier',
  email:  _selfEmail(),
  // Avatar dénormalisé : permet d'afficher la photo des membres (chat, pickers)
  // sans lire users/{uid} (verrouillé anti-moisson pour un MJ non super-admin).
  avatarIcon: STATE.profile?.avatarIcon || '',
});

async function _userEmailByUid(uid) {
  if (!uid) return '';
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? _emailRaw(snap.data()?.email) : '';
  } catch (_) {
    return '';
  }
}

async function _userProfileByUid(uid) {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const data = snap.data() || {};
    return {
      pseudo: data.pseudo || data.email || '',
      email: _emailRaw(data.email),
    };
  } catch (_) {
    return null;
  }
}

function _profileEmailOf(profiles = {}, uid = '') {
  const p = profiles?.[uid];
  if (!p || typeof p === 'string') return '';
  return _emailRaw(p.email);
}

function _sameEmail(a = '', b = '') {
  return Boolean(_emailKey(a) && _emailKey(a) === _emailKey(b));
}

function _uidAliasesForCurrentUser(uid = STATE.user?.uid) {
  return _uniq([
    uid,
    ...(Array.isArray(STATE.profile?.previousUids) ? STATE.profile.previousUids : []),
    ...(Array.isArray(STATE.profile?.uidAliases) ? STATE.profile.uidAliases : []),
  ]);
}

async function _appendPreviousUidToProfile(uid, oldUid) {
  if (!uid || !oldUid || uid === oldUid) return false;
  try {
    const ref = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return false;
    const data = snap.data() || {};
    const previousUids = _uniq([...(Array.isArray(data.previousUids) ? data.previousUids : []), oldUid]);
    await updateDoc(ref, { previousUids });
    if (STATE.user?.uid === uid) setProfile({ ...(STATE.profile || {}), previousUids });
    return true;
  } catch (e) {
    console.warn('[adventure] previousUid cible non mémorisé', uid, oldUid, e?.code || e);
    return false;
  }
}

function _findSameEmailUid(adv, uid, email) {
  if (!adv || !uid || !_emailKey(email)) return '';
  const profiles = adv.memberProfiles || {};
  const absorbed = new Set(Object.keys(adv.accountRelinks || {}));
  const candidates = _uniq([
    ...(adv.accessList || []),
    ...(adv.players || []),
    ...(adv.admins || []),
    ...Object.keys(profiles),
  ]);

  return candidates.find(otherUid => {
    if (!otherUid || otherUid === uid || absorbed.has(otherUid)) return false;
    return _sameEmail(_profileEmailOf(profiles, otherUid), email);
  }) || '';
}

function _replaceUidInList(arr = [], oldUid, newUid) {
  const hadEither = (arr || []).includes(oldUid) || (arr || []).includes(newUid);
  const out = (arr || []).filter(u => u !== oldUid && u !== newUid);
  if (hadEither) out.push(newUid);
  return _uniq(out);
}

async function _migrateSelfCharacters(adventureId, oldUid, newUid) {
  const charsSnap = await getDocs(
    query(collection(db, 'adventures', adventureId, 'characters'), where('uid', '==', oldUid))
  );
  if (charsSnap.empty) return 0;
  const batch = writeBatch(db);
  let migrated = 0;
  charsSnap.forEach(d => {
    batch.update(d.ref, { uid: newUid });
    migrated++;
  });
  await batch.commit();
  return migrated;
}

async function _selfMergeSameEmailAccount(adv, oldUid) {
  const uid = STATE.user?.uid;
  if (!uid || !adv?.id || !oldUid || oldUid === uid) return adv;

  const self = _selfProfile();
  const oldProfile = adv.memberProfiles?.[oldUid] || {};
  if (!_sameEmail(self.email, oldProfile.email)) return adv;

  const accessList = _replaceUidInList(adv.accessList, oldUid, uid);
  const players    = _replaceUidInList(adv.players, oldUid, uid);
  const admins     = _replaceUidInList(adv.admins, oldUid, uid);
  const accessEmails = _uniq([...(adv.accessEmails || []), ..._emailKeys(self.email), ..._emailKeys(oldProfile.email)]);
  const memberProfiles = { ...(adv.memberProfiles || {}) };
  memberProfiles[uid] = {
    ...(typeof oldProfile === 'object' ? oldProfile : {}),
    ...self,
    email: self.email || oldProfile.email || '',
  };
  delete memberProfiles[oldUid];

  const accountRelinks = { ...(adv.accountRelinks || {}) };
  delete accountRelinks[uid];
  Object.entries(accountRelinks).forEach(([from, to]) => {
    if (to === oldUid) delete accountRelinks[from];
  });
  accountRelinks[oldUid] = uid;
  const lastSelfRelink = {
    from: oldUid,
    to: uid,
    email: self.email || '',
    at: new Date().toISOString(),
  };

  try {
    await updateDoc(doc(db, 'adventures', adv.id), {
      accessList,
      players,
      admins,
      accessEmails,
      memberProfiles,
      accountRelinks,
      lastSelfRelink,
    });
    try {
      await _migrateSelfCharacters(adv.id, oldUid, uid);
    } catch (e) {
      console.warn('[adventure] migration des personnages du compte fantôme ignorée', adv.id, oldUid, e?.code || e);
    }
    return { ...adv, accessList, players, admins, accessEmails, memberProfiles, accountRelinks, lastSelfRelink };
  } catch (e) {
    console.warn('[adventure] fusion automatique de compte ignorée', adv.id, oldUid, e?.code || e);
    return adv;
  }
}

async function _getDocsSafe(q, { preferServer = false } = {}) {
  if (preferServer) {
    try {
      return await getDocsFromServer(q);
    } catch (e) {
      if (navigator.onLine !== false) throw e;
      console.warn('[adventure] hors-ligne, lecture depuis le cache', e?.code || e);
    }
  }
  return getDocs(q);
}

function _mergeAdventureDocs(...snaps) {
  const map = new Map();
  snaps.filter(Boolean).forEach(snap => {
    snap.docs.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
  });
  return [...map.values()];
}

// ── Charger les aventures accessibles ──────────
// `preferServer` (gate de login) : lecture serveur prioritaire pour ne JAMAIS
// bloquer un joueur sur un cache IndexedDB périmé (il vient d'être ajouté à
// `accessList` côté MJ). En cas d'erreur réseau/permission EN LIGNE, on relaie
// l'erreur (le caller peut retry au lieu d'afficher un faux "pas invité").
// Hors-ligne, on se rabat sur le cache (le joueur déjà venu garde l'accès).
// Sans option : comportement historique (cache OK, erreur avalée en []).
export async function loadUserAdventures(uid, { preferServer = false, email = '' } = {}) {
  const uidAliases = _uidAliasesForCurrentUser(uid);
  const uidQueries = uidAliases.map(alias =>
    query(collection(db, 'adventures'), where('accessList', 'array-contains', alias))
  );
  const emailKey = _emailKey(email || STATE.profile?.email || STATE.user?.email);
  const emailQuery = emailKey
    ? query(collection(db, 'adventures'), where('accessEmails', 'array-contains', emailKey))
    : null;

  try {
    const snaps = await Promise.all([
      ...uidQueries.map(q => _getDocsSafe(q, { preferServer })),
      emailQuery ? _getDocsSafe(emailQuery, { preferServer }) : null,
    ]);
    return _mergeAdventureDocs(...snaps);
  } catch (e) {
    console.error('[adventure] loadUserAdventures', e);
    if (preferServer && navigator.onLine !== false) throw e;
    return [];
  }
}

// ── Sélectionner une aventure ──────────────────
// Met à jour STATE, active le scope Firestore, retourne true si OK
export async function repairCurrentUserAdventureLinks(adventures = []) {
  const uid = STATE.user?.uid;
  if (!uid || !Array.isArray(adventures) || !adventures.length) return adventures;

  const emailKeys = _emailKeys(STATE.profile?.email || STATE.user?.email);
  const self = _selfProfile();

  const repaired = [];
  for (const adv of adventures) {
    let cur = adv;

    // 0. Fusion automatique : si le joueur revient avec un nouvel uid mais que
    // l'ancien uid porte le même email dans memberProfiles, on remplace l'ancien
    // uid par le nouveau au lieu de créer un second membre fantôme.
    const previousUid = _findSameEmailUid(cur, uid, self.email);
    if (previousUid) {
      cur = await _selfMergeSameEmailAccount(cur, previousUid);
    }

    // 1. Auto-rattachement : email invité mais uid pas encore dans accessList.
    // EXCEPTION : un uid ABSORBÉ (déjà fusionné vers un autre compte via
    // accountRelinks) ne doit JAMAIS se ré-inscrire — sinon le compte fantôme
    // ressuscite à chaque connexion et le MJ doit refaire la fusion en boucle.
    // Ce login-là doit rester "hors aventure" (la vraie correction = 1 seul uid
    // par email côté Firebase, ou reconnexion avec la méthode conservée).
    const accessEmails = cur.accessEmails || [];
    const isAbsorbed = Boolean((cur.accountRelinks || {})[uid]);
    const hasEmailAccess = emailKeys.some(email => accessEmails.includes(email));
    if (!isAbsorbed && hasEmailAccess && !(cur.accessList || []).includes(uid)) {
      const accessList = _uniq([...(cur.accessList || []), uid]);
      const players = _uniq([...(cur.players || []), uid]);
      try {
        await updateDoc(doc(db, 'adventures', cur.id), { accessList, players });
        cur = { ...cur, accessList, players };
      } catch (e) {
        console.warn('[adventure] auto-rattachement compte ignoré', cur.id, e?.code || e);
      }
    }

    // 2. Self-heal du profil dénormalisé : chaque membre écrit/rafraîchit SA propre
    // entrée memberProfiles (pseudo à jour pour l'affichage MJ), y compris pour les
    // aventures créées avant l'introduction de memberProfiles. Idempotent : n'écrit
    // que si absent ou périmé (0 écriture aux logins suivants).
    const isMember = (cur.accessList || []).includes(uid) || (cur.admins || []).includes(uid);
    const mine = cur.memberProfiles?.[uid];
    if (isMember && (!mine || mine.pseudo !== self.pseudo || mine.email !== self.email || (mine.avatarIcon || '') !== self.avatarIcon)) {
      const memberProfiles = { ...(cur.memberProfiles || {}), [uid]: self };
      try {
        await updateDoc(doc(db, 'adventures', cur.id), { memberProfiles });
        cur = { ...cur, memberProfiles };
      } catch (e) {
        console.warn('[adventure] self-heal memberProfile ignoré', cur.id, e?.code || e);
      }
    }

    repaired.push(cur);
  }

  return repaired;
}

export async function selectAdventure(adv) {
  const uid = STATE.user?.uid;
  let selected = adv;
  if (uid && adv?.createdBy === uid && hasPremiumAccess() && adv.premiumAccess !== true) {
    selected = {
      ...adv,
      premiumAccess: true,
      premiumOwnerUid: uid,
      premiumGrantedAt: new Date().toISOString(),
    };
    updateDoc(doc(db, 'adventures', adv.id), {
      premiumAccess: true,
      premiumOwnerUid: uid,
      premiumGrantedAt: selected.premiumGrantedAt,
    }).catch(e => console.warn('[adventure] premium sync ignored', e?.code || e));
  }

  setAdventure(selected);
  // `setCurrentAdventure` tear-down les listeners session de l'aventure
  // précédente avant de changer de scope.
  setCurrentAdventure(selected.id);

  // Vider les caches « défauts MJ » de l'aventure précédente (sinon ses types de
  // dégâts / formats d'arme / etc. restent affichés dans la nouvelle aventure).
  _invalidateScopedCaches();

  // isAdmin : vrai si admin global (profile.isAdmin) OU admin de cette aventure
  const isAdvAdmin = Array.isArray(selected.admins) && selected.admins.includes(uid);
  setAdmin(STATE.isSuperAdmin || isAdvAdmin);

  // Raretés scopées par aventure : valeurs standards par défaut, personnalisation
  // possible via world/rarities.
  void loadRarities().catch(e =>
    console.warn('[adventure] raretés non chargées', e?.code || e)
  );

  // Les calculs de personnage doivent etre prets avant le premier rendu.
  // Chaque aventure possede son propre document world/character_rules.
  await loadCharacterRules().catch(e =>
    console.warn('[adventure] regles de personnage non chargees', e?.code || e)
  );

  // La fiche, la boutique et le VTT partagent les slots de cette aventure.
  await loadEquipmentSlots().catch(e =>
    console.warn('[adventure] emplacements d\'equipement non charges', e?.code || e)
  );

  await loadArmorSetSettings().catch(e =>
    console.warn('[adventure] bonus de set non charges', e?.code || e)
  );

  await loadSpellSystem().catch(e =>
    console.warn('[adventure] systeme de sorts non charge', e?.code || e)
  );

  // Démarre les listeners session-live (1 onSnapshot/collection partagée
  // par toutes les pages — coupe la majorité des lectures pour la session).
  // Fire-and-forget : chaque page await sa ready si elle en a besoin.
  primeSessionData();

  // Bios « diapo » déportées dans characterPages/{charId} (budget 1 Mo propre).
  // Abonnement session-live unique, ré-armé à chaque changement d'aventure.
  initCharacterPages();

  // Heartbeat de présence pour cette aventure
  if (uid) startPresence(selected.id, uid);

  // Chat flottant de l'aventure (bulle en bas à droite, sur toutes les pages)
  if (uid) initChat(uid);
}

// ── Créer une aventure ──────────────────────────
// Ouvert à tout utilisateur connecté : le créateur en devient l'unique MJ.
// (Les règles Firestore imposent createdBy/admins/accessList == [uid] à la création.)
export async function createAdventure({ nom, emoji = '⚔️', description = '' }) {
  const uid = STATE.user?.uid;
  if (!uid) throw new Error('Non connecté');

  const id  = 'adv_' + Date.now();
  const premiumAccess = hasPremiumAccess();
  const adv = {
    nom,
    emoji,
    description,
    createdAt:  new Date().toISOString(),
    createdBy:  uid,
    admins:     [uid],
    players:    [],
    accessList: [uid],
    accessEmails: _emailKeys(STATE.profile?.email || STATE.user?.email),
    invitedEmails: [],
    // Profils dénormalisés {uid:{pseudo,email}} : permet au MJ (même non super-admin)
    // d'afficher/gérer ses membres sans lire users/{uid} (verrouillé anti-moisson).
    memberProfiles: { [uid]: _selfProfile() },
    // Fonctionnalités actives par défaut (le MJ ajuste ensuite via Gérer).
    enabledFeatures: [...DEFAULT_ENABLED],
    premiumAccess,
    ...(premiumAccess ? {
      premiumOwnerUid: uid,
      premiumGrantedAt: new Date().toISOString(),
    } : {}),
    status:     'active',
  };

  await setDoc(doc(db, 'adventures', id), adv);

  // Système de sorts : une NOUVELLE aventure démarre en « classique » (positionnement
  // D&D-first ; les runes = contenu optionnel activable dans la config). Écrit
  // explicitement : le fallback runtime reste 'runes' pour les aventures legacy
  // sans doc (elles ne changent pas). Best-effort : sans ce doc, fallback runes.
  setDoc(doc(db, 'adventures', id, 'world', 'spell_system'), { version: 1, mode: 'classic' })
    .catch((e) => console.warn('[adventure] spell_system par défaut non écrit', e?.code || e));

  const created = { id, ...adv };

  // Mettre à jour la liste locale
  setAdventures([...STATE.adventures, created]);
  return created;
}

// ── Invitations par email ──────────────────────
// Modèle : `invitedEmails` = invitations EN ATTENTE (aucun accès ouvert tant que
// l'invité n'a pas accepté). Accepter = déplacer son email invited→access + s'ajouter
// à accessList/players. Séparé de `accessEmails` (membres réellement rattachés) pour
// un vrai flux accepter/refuser. Emails stockés en raw+lower (`_emailKeys`) comme
// accessEmails : requête `array-contains` (lower) + règle `token.email` (raw).

// MJ : ajoute un email aux invitations en attente.
export async function inviteByEmail(adventureId, email) {
  const uid  = STATE.user?.uid;
  if (!uid) throw new Error('Non connecté');
  const keys = _emailKeys(email);
  if (!keys.length) throw new Error('Email invalide');

  const ref  = doc(db, 'adventures', adventureId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Aventure introuvable');
  const adv = snap.data();
  if (!STATE.isSuperAdmin && !adv.admins?.includes(uid)) {
    throw new Error('Accès refusé — réservé au MJ de cette aventure');
  }

  const accessEmails = adv.accessEmails || [];
  if (keys.some(k => accessEmails.includes(k))) throw new Error('Ce joueur est déjà membre de l\'aventure');

  const invitedEmails = _uniq([...(adv.invitedEmails || []), ...keys]);
  if (invitedEmails.length === (adv.invitedEmails || []).length) throw new Error('Cet email est déjà invité');

  await updateDoc(ref, { invitedEmails });
  if (STATE.adventure?.id === adventureId) {
    setAdventure({ ...STATE.adventure, invitedEmails });
  }
}

// MJ : annule une invitation en attente.
export async function cancelInvite(adventureId, email) {
  const uid  = STATE.user?.uid;
  if (!uid) throw new Error('Non connecté');
  const keys = _emailKeys(email);

  const ref  = doc(db, 'adventures', adventureId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Aventure introuvable');
  const adv = snap.data();
  if (!STATE.isSuperAdmin && !adv.admins?.includes(uid)) {
    throw new Error('Accès refusé');
  }

  const invitedEmails = (adv.invitedEmails || []).filter(e => !keys.includes(e));
  await updateDoc(ref, { invitedEmails });
  if (STATE.adventure?.id === adventureId) {
    setAdventure({ ...STATE.adventure, invitedEmails });
  }
}

// Charger les invitations EN ATTENTE de l'utilisateur (invité mais pas encore membre).
export async function loadUserInvitations(email = '') {
  const emailKey = _emailKey(email || STATE.profile?.email || STATE.user?.email);
  if (!emailKey) return [];
  try {
    const snap = await getDocs(
      query(collection(db, 'adventures'), where('invitedEmails', 'array-contains', emailKey))
    );
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(adv => !(adv.accessEmails || []).includes(emailKey)); // déjà accepté → pas une invitation
  } catch (e) {
    console.error('[adventure] loadUserInvitations', e);
    return [];
  }
}

// Invité : accepte → son email passe invited→access, son uid rejoint accessList/players.
export async function acceptInvitation(adventure) {
  const uid = STATE.user?.uid;
  if (!uid) throw new Error('Non connecté');
  const myKeys  = _emailKeys(STATE.profile?.email || STATE.user?.email);
  const rawEmail = _emailRaw(STATE.profile?.email || STATE.user?.email);

  const ref  = doc(db, 'adventures', adventure.id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Aventure introuvable');
  const adv = snap.data();

  const invited = adv.invitedEmails || [];
  if (!myKeys.some(k => invited.includes(k))) throw new Error('Invitation introuvable ou expirée');

  const invitedEmails = invited.filter(e => !myKeys.includes(e));
  // On garde le raw token email en tête pour matcher la règle `token.email in accessEmails`.
  const accessEmails  = _uniq([...(adv.accessEmails || []), rawEmail, ...myKeys]);
  const accessList    = _uniq([...(adv.accessList || []), uid]);
  const players       = _uniq([...(adv.players || []), uid]);
  // L'invité dépose SON profil (règle isInviteAccept : uniquement sa propre entrée).
  const memberProfiles = { ...(adv.memberProfiles || {}), [uid]: _selfProfile() };

  await updateDoc(ref, { invitedEmails, accessEmails, accessList, players, memberProfiles });

  const joined = { ...adv, id: adventure.id, invitedEmails, accessEmails, accessList, players, memberProfiles };
  const others = STATE.adventures.filter(a => a.id !== adventure.id);
  setAdventures([...others, joined]);
  return joined;
}

// Invité : refuse → retire simplement son email des invitations.
export async function declineInvitation(adventure) {
  const uid = STATE.user?.uid;
  if (!uid) throw new Error('Non connecté');
  const myKeys = _emailKeys(STATE.profile?.email || STATE.user?.email);

  const ref  = doc(db, 'adventures', adventure.id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const adv = snap.data();

  const invitedEmails = (adv.invitedEmails || []).filter(e => !myKeys.includes(e));
  await updateDoc(ref, { invitedEmails });
}

// ── Retirer un joueur d'une aventure ───────────
export async function removePlayerFromAdventure(adventureId, targetUid) {
  const uid = STATE.user?.uid;
  if (!uid) throw new Error('Non connecté');

  const ref  = doc(db, 'adventures', adventureId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Aventure introuvable');

  const adv = snap.data();
  if (!STATE.isSuperAdmin && !adv.admins?.includes(uid)) {
    throw new Error('Accès refusé');
  }

  // Ne pas retirer le créateur
  if (targetUid === adv.createdBy) throw new Error('Impossible de retirer le créateur');

  const players    = (adv.players    || []).filter(u => u !== targetUid);
  const admins     = (adv.admins     || []).filter(u => u !== targetUid);
  const accessList = (adv.accessList || []).filter(u => u !== targetUid);
  // Email du membre pour révoquer aussi son accès par email : d'abord le profil
  // dénormalisé (marche pour un MJ non super-admin), sinon lecture users/{uid}.
  const targetEmail  = adv.memberProfiles?.[targetUid]?.email || await _userEmailByUid(targetUid);
  const targetEmails = _emailKeys(targetEmail);
  const accessEmails = targetEmails.length
    ? (adv.accessEmails || []).filter(e => !targetEmails.includes(e))
    : (adv.accessEmails || []);
  const memberProfiles = { ...(adv.memberProfiles || {}) };
  delete memberProfiles[targetUid];

  await updateDoc(ref, { players, admins, accessList, accessEmails, memberProfiles });

  if (STATE.adventure?.id === adventureId) {
    setAdventure({ ...STATE.adventure, players, admins, accessList, accessEmails, memberProfiles });
  }
}

// Persos de l'utilisateur courant dans une aventure — requête directe one-shot
// (comme relinkPlayerAccount) : évite le cache-live `ready` qui peut bloquer sur
// une collection perso vide (1er snapshot cache vide en ligne, serveur en attente).
export async function loadMyCharacters(adventureId) {
  const uid = STATE.user?.uid;
  if (!uid) return [];
  const snap = await getDocs(
    query(collection(db, 'adventures', adventureId, 'characters'), where('uid', '==', uid))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Quitter une aventure (le membre se retire lui-même) ─────────────────────
// Retire l'utilisateur courant de accessList/players/admins + son email de
// accessEmails (sinon repairCurrentUserAdventureLinks le ré-ajouterait au login)
// + son entrée memberProfiles. Refusé au créateur (il doit supprimer l'aventure).
// La suppression du personnage est gérée par l'appelant (features/aventures.js →
// purgeCharacter). Autorisé côté règles par isSelfLeave.
export async function removeSelfFromAdventure(adventureId) {
  const uid = STATE.user?.uid;
  if (!uid) throw new Error('Non connecté');

  const ref  = doc(db, 'adventures', adventureId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Aventure introuvable');
  const adv = snap.data();

  if (adv.createdBy === uid) {
    throw new Error('Le créateur ne peut pas quitter son aventure — supprime-la à la place.');
  }

  const players    = (adv.players    || []).filter(u => u !== uid);
  const admins     = (adv.admins     || []).filter(u => u !== uid);
  const accessList = (adv.accessList || []).filter(u => u !== uid);
  const myKeys     = _emailKeys(STATE.profile?.email || STATE.user?.email);
  const accessEmails = myKeys.length
    ? (adv.accessEmails || []).filter(e => !myKeys.includes(e))
    : (adv.accessEmails || []);
  const memberProfiles = { ...(adv.memberProfiles || {}) };
  delete memberProfiles[uid];

  await updateDoc(ref, { players, admins, accessList, accessEmails, memberProfiles });

  setAdventures(STATE.adventures.filter(a => a.id !== adventureId));
  if (STATE.adventure?.id === adventureId) setAdventure(null);
}

// ── Réassociation d'un compte (changement d'identifiant Firebase) ──────────
// Cas réel : un joueur revient avec un NOUVEL uid pour le même email (compte
// Google/mot-de-passe dupliqué — cf. "compte en double"). Son ancien uid est
// encore dans accessList et possède ses personnages, mais son nouvel uid n'y est
// plus → il tombe sur "En attente d'invitation".
// Le MJ migre l'ancien uid → le nouveau : accessList/players/admins de l'aventure
// + re-key des personnages (sous-collection). Réservé MJ — autorisé par les règles
// (update adventure = isAdvAdmin ; update characters = isAdvAdmin/isAdmin).
// Retourne { migrated } = nb de personnages transférés.
export async function relinkPlayerAccount(adventureId, oldUid, newUid) {
  const uid = STATE.user?.uid;
  if (!uid) throw new Error('Non connecté');
  if (!oldUid || !newUid || oldUid === newUid) throw new Error('Identifiants invalides');

  const ref  = doc(db, 'adventures', adventureId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Aventure introuvable');
  const adv = snap.data();
  if (!STATE.isSuperAdmin && !adv.admins?.includes(uid)) {
    throw new Error('Accès refusé — réservé au MJ de cette aventure');
  }

  // Remplace oldUid par newUid dans une liste (dédoublonne, n'ajoute newUid que
  // si oldUid y était présent).
  const repl = (arr) => {
    const out = (arr || []).filter(u => u !== oldUid && u !== newUid);
    if ((arr || []).includes(oldUid)) out.push(newUid);
    return out;
  };
  const accessList = repl(adv.accessList);
  const players    = repl(adv.players);
  const admins     = repl(adv.admins);
  const newProfile = await _userProfileByUid(newUid);
  const newEmail = newProfile?.email || '';
  await _appendPreviousUidToProfile(newUid, oldUid);
  const accessEmails = _uniq([...(adv.accessEmails || []), ..._emailKeys(newEmail)]);
  // Re-key du profil dénormalisé oldUid→newUid (conserve le pseudo affiché).
  const memberProfiles = { ...(adv.memberProfiles || {}) };
  if (memberProfiles[oldUid]) {
    memberProfiles[newUid] = {
      ...memberProfiles[oldUid],
      ...(newProfile?.pseudo ? { pseudo: newProfile.pseudo } : {}),
      ...(newEmail ? { email: _emailRaw(newEmail) } : {}),
    };
    delete memberProfiles[oldUid];
  }
  const accountRelinks = { ...(adv.accountRelinks || {}) };
  delete accountRelinks[newUid];
  Object.entries(accountRelinks).forEach(([from, to]) => {
    if (to === oldUid) delete accountRelinks[from];
  });
  accountRelinks[oldUid] = newUid;

  // Re-key des personnages de CETTE aventure (les persos sont une sous-collection
  // scoping par aventure et keyés par `uid`).
  const charsSnap = await getDocs(
    query(collection(db, 'adventures', adventureId, 'characters'), where('uid', '==', oldUid))
  );
  let migrated = 0;
  if (!charsSnap.empty) {
    const batch = writeBatch(db);
    const charPatch = {
      uid: newUid,
      ...(newProfile?.pseudo ? { ownerPseudo: newProfile.pseudo } : {}),
    };
    charsSnap.forEach(d => { batch.update(d.ref, charPatch); migrated++; });
    await batch.commit();
  }
  if (Array.isArray(STATE.characters) && migrated > 0) {
    STATE.characters = STATE.characters.map(c => c?.uid === oldUid
      ? {
          ...c,
          uid: newUid,
          ...(newProfile?.pseudo ? { ownerPseudo: newProfile.pseudo } : {}),
        }
      : c);
  }

  await updateDoc(ref, { accessList, players, admins, accessEmails, memberProfiles, accountRelinks });
  if (STATE.adventure?.id === adventureId) {
    setAdventure({ ...STATE.adventure, accessList, players, admins, accessEmails, memberProfiles, accountRelinks });
  }

  return { migrated };
}

// ── Mettre à jour nom / emoji / description ────
export async function updateAdventureMeta(adventureId, { nom, emoji, description }) {
  const uid = STATE.user?.uid;
  if (!uid) throw new Error('Non connecté');

  const ref  = doc(db, 'adventures', adventureId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Aventure introuvable');

  const adv = snap.data();
  if (!STATE.isSuperAdmin && !adv.admins?.includes(uid)) {
    throw new Error('Accès refusé');
  }

  const update = {};
  if (nom)         update.nom         = nom;
  if (emoji !== undefined) update.emoji = emoji;
  if (description !== undefined) update.description = description;

  await updateDoc(ref, update);

  // Mettre à jour STATE si c'est l'aventure courante
  if (STATE.adventure?.id === adventureId) {
    setAdventure({ ...STATE.adventure, ...update });
  }
}

// ── Fonctionnalités actives de l'aventure (toggles MJ) ─────────────────
// `keys` = tableau des clés de page activées. Réservé au MJ (règle isAdvAdmin).
export async function setAdventureFeatures(adventureId, keys) {
  const uid = STATE.user?.uid;
  if (!uid) throw new Error('Non connecté');

  const ref  = doc(db, 'adventures', adventureId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Aventure introuvable');
  if (!STATE.isSuperAdmin && !snap.data().admins?.includes(uid)) {
    throw new Error('Accès refusé — réservé au MJ de cette aventure');
  }

  const enabledFeatures = _uniq(keys);
  const update = { enabledFeatures };
  if (hasPremiumAccess()) {
    update.premiumAccess = true;
    update.premiumOwnerUid = uid;
    update.premiumGrantedAt = new Date().toISOString();
  }
  await updateDoc(ref, update);
  if (STATE.adventure?.id === adventureId) {
    setAdventure({ ...STATE.adventure, ...update });
  }
  return enabledFeatures;
}

// ── Supprimer une aventure (et toutes ses sous-collections) ───────────
// Autorisé au MJ de l'aventure (créateur/admin) ou au super-admin — cohérent avec
// la règle Firestore `delete: isAdvAdmin`.
export async function deleteAdventure(adventureId) {
  const uid = STATE.user?.uid;
  if (!uid) throw new Error('Non connecté');

  if (!STATE.isSuperAdmin) {
    const snap = await getDoc(doc(db, 'adventures', adventureId));
    if (!snap.exists()) throw new Error('Aventure introuvable');
    if (!snap.data().admins?.includes(uid)) {
      throw new Error('Accès refusé — réservé au MJ de cette aventure');
    }
  }

  const SUBCOLLECTIONS = [
    'shop', 'shopCategories', 'story', 'story_meta',
    'places', 'organizations', 'place_types', 'map_lieux',
    'npcs', 'npc_affinites', 'settings',
    'achievements', 'achievements_meta',
    'bestiary', 'bestiary_meta', 'bestiary_tracker', 'bestiaire',
    'collection', 'collectionSettings',
    'players', 'world',
    'recettes', 'recipes', 'combat_styles', 'order',
    'bastion', 'characters',
  ];

  // Supprimer chaque sous-collection en batches
  for (const col of SUBCOLLECTIONS) {
    try {
      const snap = await getDocs(collection(db, 'adventures', adventureId, col));
      if (snap.empty) continue;
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = writeBatch(db);
        snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (e) {
      console.warn(`[deleteAdventure] ${col} ignoré :`, e.message);
    }
  }

  // Supprimer le document aventure lui-même
  await deleteDoc(doc(db, 'adventures', adventureId));

  // Mettre à jour STATE
  setAdventures(STATE.adventures.filter(a => a.id !== adventureId));
  if (STATE.adventure?.id === adventureId) {
    setAdventure(null);
  }
}

// ── Promouvoir joueur → admin ───────────────────
export async function promoteToAdmin(adventureId, targetUid) {
  const ref  = doc(db, 'adventures', adventureId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const adv = snap.data();
  const admins     = adv.admins     || [];
  const players    = (adv.players   || []).filter(u => u !== targetUid);
  const accessList = adv.accessList || [];
  const accessEmails = adv.accessEmails || [];
  const targetEmail = await _userEmailByUid(targetUid);
  if (!admins.includes(targetUid)) admins.push(targetUid);
  if (!accessList.includes(targetUid)) accessList.push(targetUid);
  _emailKeys(targetEmail).forEach(email => {
    if (!accessEmails.includes(email)) accessEmails.push(email);
  });
  await updateDoc(ref, { admins, players, accessList, accessEmails });
  if (STATE.adventure?.id === adventureId) {
    setAdventure({ ...STATE.adventure, admins, players, accessList, accessEmails });
  }
}

// ── Charger tous les utilisateurs (super-admin) ─
export async function loadAllUsers(scopeAdventure = null, { forceAll = false } = {}) {
  try {
    if (STATE.isSuperAdmin || forceAll) {
      const snap = await getDocs(collection(db, 'users'));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    const adv = scopeAdventure || STATE.adventure;
    const uids = _uniq([
      ...(adv?.admins || []),
      ...(adv?.players || []),
      ...(adv?.accessList || []),
      STATE.user?.uid,
    ]);
    const docs = await Promise.all(uids.map(async (uid) => {
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
      } catch (_) {
        return null;
      }
    }));
    return docs.filter(Boolean);
  } catch (e) {
    console.error('[adventure] loadAllUsers', e);
    return [];
  }
}

// ── Migration : créer l'aventure "Le Grand JDR" et y rattacher tout ─────────
// Lance la migration depuis l'écran admin — copie toutes les collections
// plates vers adventures/le-grand-jdr/{collection} et associe tous les users.
export async function runMigration(onProgress) {
  const COLLECTIONS = [
    // Boutique
    'shop', 'shopCategories',
    // Trame
    'story', 'story_meta',
    // Carte
    'places', 'organizations', 'place_types', 'map_lieux',
    // PNJ
    'npcs', 'npc_affinites', 'settings',
    // Hauts-faits
    'achievements', 'achievements_meta',
    // Bestiaire
    'bestiary', 'bestiary_meta', 'bestiary_tracker', 'bestiaire',
    // Collection
    'collection', 'collectionSettings',
    // Autres contenus MJ
    'players', 'world',
    'recettes', 'recipes', 'combat_styles', 'order',
    // Bastion
    'bastion',
    // Personnages (en dernier — dépendent des autres)
    'characters',
  ];
  const ADV_ID = 'le-grand-jdr';
  const uid    = STATE.user?.uid;

  onProgress?.('Création de l\'aventure "Le Grand JDR"…');

  // 1. Créer l'aventure si elle n'existe pas
  const advRef  = doc(db, 'adventures', ADV_ID);
  const advSnap = await getDoc(advRef);

  // Charger tous les utilisateurs pour les ajouter à l'aventure
  const allUsers = await loadAllUsers(null, { forceAll: true });
  const allUids  = allUsers.map(u => u.uid || u.id).filter(Boolean);
  const accessEmails = _uniq(allUsers.flatMap(u => _emailKeys(u.email)));

  // Repérer les super-admins existants via le rôle utilisateur.
  const adminUids = allUsers
    .filter(u => u.isAdmin === true)
    .map(u => u.uid || u.id)
    .filter(Boolean);

  if (!adminUids.includes(uid)) adminUids.push(uid);

  const playerUids = allUids.filter(u => !adminUids.includes(u));

  if (!advSnap.exists()) {
    await setDoc(advRef, {
      nom:         'Le Grand JDR',
      emoji:       '⚔️',
      description: 'L\'aventure originale.',
      createdAt:   new Date().toISOString(),
      createdBy:   uid,
      admins:      adminUids,
      players:     playerUids,
      accessList:  allUids,
      accessEmails,
      status:      'active',
    });
  } else {
    // Mettre à jour la liste des joueurs sans écraser les admins existants
    await updateDoc(advRef, {
      players:    playerUids,
      accessList: allUids,
      accessEmails,
    });
  }

  // 2. Marquer les admins existants comme isAdmin dans leur profil
  for (const aUid of adminUids) {
    try {
      await updateDoc(doc(db, 'users', aUid), { isAdmin: true });
    } catch (_) { /* ignore si doc absent */ }
  }

  // 3. Copier chaque collection vers la sous-collection de l'aventure
  // On utilise des batches de 400 max pour ne pas saturer la file Firestore
  const BATCH_SIZE = 400;
  let total = 0;

  for (const col of COLLECTIONS) {
    onProgress?.(`Migration : ${col}…`);
    try {
      const snap = await getDocs(collection(db, col));
      if (snap.empty) continue;

      // Découper en tranches de BATCH_SIZE
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const slice = docs.slice(i, i + BATCH_SIZE);
        for (const d of slice) {
          const destRef = doc(db, 'adventures', ADV_ID, col, d.id);
          batch.set(destRef, d.data(), { merge: true });
        }
        await batch.commit();
        total += slice.length;
      }
    } catch (e) {
      console.warn(`[migration] ${col} ignoré :`, e.message);
      onProgress?.(`⚠️ ${col} ignoré : ${e.message}`);
    }
  }

  onProgress?.(`✅ Migration terminée — ${total} documents copiés.`);
  return { total, adventureId: ADV_ID };
}
