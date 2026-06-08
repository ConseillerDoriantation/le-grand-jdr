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
  setSuperAdmin,
} from './state.js';

import { setCurrentAdventure, primeSessionData } from '../data/firestore.js';
import { startPresence } from '../shared/presence.js';

const _emailRaw = (email = '') => String(email || '').trim();
const _emailKey = (email = '') => _emailRaw(email).toLowerCase();
const _emailKeys = (email = '') => _uniq([_emailRaw(email), _emailKey(email)]);
const _uniq = (arr = []) => [...new Set((arr || []).filter(Boolean))];

async function _userEmailByUid(uid) {
  if (!uid) return '';
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? _emailRaw(snap.data()?.email) : '';
  } catch (_) {
    return '';
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

function _previousUids() {
  const uid = STATE.user?.uid;
  return _uniq([
    ...(Array.isArray(STATE.profile?.previousUids) ? STATE.profile.previousUids : []),
    ...(Array.isArray(STATE.profile?.uidAliases) ? STATE.profile.uidAliases : []),
  ]).filter(alias => alias && alias !== uid);
}

function _adventureMatchesPreviousUid(adv, previousUids) {
  return previousUids.some(oldUid =>
    (adv.accessList || []).includes(oldUid) ||
    (adv.players || []).includes(oldUid) ||
    (adv.admins || []).includes(oldUid)
  );
}

// ── Charger les aventures accessibles ──────────
// `preferServer` (gate de login) : lecture serveur prioritaire pour ne JAMAIS
// bloquer un joueur sur un cache IndexedDB périmé (il vient d'être ajouté à
// `accessList` côté MJ). En cas d'erreur réseau/permission EN LIGNE, on relaie
// l'erreur (le caller peut retry au lieu d'afficher un faux "pas invité").
// Hors-ligne, on se rabat sur le cache (le joueur déjà venu garde l'accès).
// Sans option : comportement historique (cache OK, erreur avalée en []).
export async function loadUserAdventures(uid, { preferServer = false, email = '' } = {}) {
  const uidQuery = query(collection(db, 'adventures'), where('accessList', 'array-contains', uid));
  const emailKey = _emailKey(email || STATE.profile?.email || STATE.user?.email);
  const emailQuery = emailKey
    ? query(collection(db, 'adventures'), where('accessEmails', 'array-contains', emailKey))
    : null;

  try {
    const snaps = await Promise.all([
      _getDocsSafe(uidQuery, { preferServer }),
      emailQuery ? _getDocsSafe(emailQuery, { preferServer }) : null,
    ]);
    const direct = _mergeAdventureDocs(...snaps);
    if (direct.length) return direct;

    const previousUids = _previousUids();
    if (!previousUids.length && !emailKey) return direct;

    const allSnap = await _getDocsSafe(collection(db, 'adventures'), { preferServer });
    return allSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(adv =>
        _adventureMatchesPreviousUid(adv, previousUids) ||
        (emailKey && (adv.accessEmails || []).includes(emailKey))
      );
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
  const previousUids = _previousUids();

  if (!emailKeys.length && !previousUids.length) return adventures;

  const repaired = [];
  for (const adv of adventures) {
    const accessEmails = adv.accessEmails || [];
    const hasEmailAccess = emailKeys.some(email => accessEmails.includes(email));
    const isAlreadyLinked = (adv.accessList || []).includes(uid);
    const oldUidsInAdventure = previousUids.filter(oldUid =>
      _adventureMatchesPreviousUid(adv, [oldUid])
    );

    if (isAlreadyLinked && !oldUidsInAdventure.length) {
      repaired.push(adv);
      continue;
    }

    let nextAdv = adv;
    const shouldLinkCurrentUid = (hasEmailAccess || oldUidsInAdventure.length > 0) && !isAlreadyLinked;
    if (shouldLinkCurrentUid) {
      const accessList = _uniq([...(adv.accessList || []), uid]);
      const wasAdmin = oldUidsInAdventure.some(oldUid => (adv.admins || []).includes(oldUid));
      const admins = wasAdmin ? _uniq([...(adv.admins || []), uid]) : (adv.admins || []);
      const players = wasAdmin ? (adv.players || []) : _uniq([...(adv.players || []), uid]);
      const nextAccessEmails = _uniq([...accessEmails, ...emailKeys]);

      try {
        await updateDoc(doc(db, 'adventures', adv.id), { accessList, admins, players, accessEmails: nextAccessEmails });
        nextAdv = { ...nextAdv, accessList, admins, players, accessEmails: nextAccessEmails };
      } catch (e) {
        console.warn('[adventure] auto-rattachement compte ignoré', adv.id, e?.code || e);
      }
    }

    for (const oldUid of oldUidsInAdventure) {
      try {
        const charsSnap = await getDocs(
          query(collection(db, 'adventures', adv.id, 'characters'), where('uid', '==', oldUid))
        );
        if (charsSnap.empty) continue;
        const batch = writeBatch(db);
        charsSnap.forEach(d => batch.update(d.ref, { uid }));
        await batch.commit();
      } catch (e) {
        console.warn('[adventure] migration personnages compte ignorée', adv.id, oldUid, e?.code || e);
      }
    }

    repaired.push(nextAdv);
  }

  return repaired;
}

export function selectAdventure(adv) {
  setAdventure(adv);
  // `setCurrentAdventure` tear-down les listeners session de l'aventure
  // précédente avant de changer de scope.
  setCurrentAdventure(adv.id);

  // isAdmin : vrai si admin global (profile.isAdmin) OU admin de cette aventure
  const uid = STATE.user?.uid;
  const isAdvAdmin = Array.isArray(adv.admins) && adv.admins.includes(uid);
  setAdmin(STATE.isSuperAdmin || isAdvAdmin);

  // Démarre les listeners session-live (1 onSnapshot/collection partagée
  // par toutes les pages — coupe la majorité des lectures pour la session).
  // Fire-and-forget : chaque page await sa ready si elle en a besoin.
  primeSessionData();

  // Heartbeat de présence pour cette aventure
  if (uid) startPresence(adv.id, uid);
}

// ── Créer une aventure ──────────────────────────
// Réservé aux super-admins (profile.isAdmin === true)
export async function createAdventure({ nom, emoji = '⚔️', description = '' }) {
  const uid = STATE.user?.uid;
  if (!uid || !STATE.isSuperAdmin) throw new Error('Accès refusé');

  const id  = 'adv_' + Date.now();
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
    status:     'active',
  };

  await setDoc(doc(db, 'adventures', id), adv);
  const created = { id, ...adv };

  // Mettre à jour la liste locale
  setAdventures([...STATE.adventures, created]);
  return created;
}

// ── Ajouter un joueur à une aventure ───────────
export async function addPlayerToAdventure(adventureId, targetUid, asAdmin = false) {
  const uid = STATE.user?.uid;
  if (!uid) throw new Error('Non connecté');

  const ref  = doc(db, 'adventures', adventureId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Aventure introuvable');

  const adv = snap.data();

  // Vérifier qu'on a le droit de modifier
  if (!STATE.isSuperAdmin && !adv.admins?.includes(uid)) {
    throw new Error('Accès refusé — tu n\'es pas admin de cette aventure');
  }

  const players    = adv.players    || [];
  const admins     = adv.admins     || [];
  const accessList = adv.accessList || [];
  const accessEmails = adv.accessEmails || [];
  const targetEmail = await _userEmailByUid(targetUid);

  if (!accessList.includes(targetUid)) accessList.push(targetUid);
  _emailKeys(targetEmail).forEach(email => {
    if (!accessEmails.includes(email)) accessEmails.push(email);
  });
  if (asAdmin) {
    if (!admins.includes(targetUid)) admins.push(targetUid);
  } else {
    if (!players.includes(targetUid)) players.push(targetUid);
  }

  await updateDoc(ref, { players, admins, accessList, accessEmails });

  // Mettre à jour l'aventure locale si c'est la courante
  if (STATE.adventure?.id === adventureId) {
    setAdventure({ ...STATE.adventure, players, admins, accessList, accessEmails });
  }
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
  const targetEmail = await _userEmailByUid(targetUid);
  const targetEmails = _emailKeys(targetEmail);
  const accessEmails = targetEmails.length
    ? (adv.accessEmails || []).filter(e => !targetEmails.includes(e))
    : (adv.accessEmails || []);

  await updateDoc(ref, { players, admins, accessList, accessEmails });

  if (STATE.adventure?.id === adventureId) {
    setAdventure({ ...STATE.adventure, players, admins, accessList, accessEmails });
  }
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
  const newEmail = await _userEmailByUid(newUid);
  const accessEmails = _uniq([...(adv.accessEmails || []), ..._emailKeys(newEmail)]);

  // Re-key des personnages de CETTE aventure (les persos sont une sous-collection
  // scoping par aventure et keyés par `uid`).
  const charsSnap = await getDocs(
    query(collection(db, 'adventures', adventureId, 'characters'), where('uid', '==', oldUid))
  );
  let migrated = 0;
  if (!charsSnap.empty) {
    const batch = writeBatch(db);
    charsSnap.forEach(d => { batch.update(d.ref, { uid: newUid }); migrated++; });
    await batch.commit();
  }

  await updateDoc(ref, { accessList, players, admins, accessEmails });
  if (STATE.adventure?.id === adventureId) {
    setAdventure({ ...STATE.adventure, accessList, players, admins, accessEmails });
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
  if (emoji)       update.emoji       = emoji;
  if (description !== undefined) update.description = description;

  await updateDoc(ref, update);

  // Mettre à jour STATE si c'est l'aventure courante
  if (STATE.adventure?.id === adventureId) {
    setAdventure({ ...STATE.adventure, ...update });
  }
}

// ── Supprimer une aventure (et toutes ses sous-collections) ───────────
export async function deleteAdventure(adventureId) {
  const uid = STATE.user?.uid;
  if (!uid || !STATE.isSuperAdmin) throw new Error('Accès refusé — super-admin uniquement');

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
export async function loadAllUsers() {
  try {
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
  const allUsers = await loadAllUsers();
  const allUids  = allUsers.map(u => u.uid || u.id).filter(Boolean);
  const accessEmails = _uniq(allUsers.flatMap(u => _emailKeys(u.email)));

  // Repérer les super-admins existants (email hardcodé → migration)
  const LEGACY_ADMIN_EMAIL = 'dorianferrer02@gmail.com';
  const adminUids = allUsers
    .filter(u => u.email === LEGACY_ADMIN_EMAIL || u.isAdmin === true)
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
