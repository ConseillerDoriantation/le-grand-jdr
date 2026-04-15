// ══════════════════════════════════════════════
// ADVENTURE — Gestion des aventures
// Chargement, sélection, création, gestion joueurs
// ══════════════════════════════════════════════

import {
  db,
  doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, getDocs,
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

import { setCurrentAdventure } from '../data/firestore.js';

// ── Charger les aventures accessibles ──────────
export async function loadUserAdventures(uid) {
  try {
    const q    = query(collection(db, 'adventures'), where('accessList', 'array-contains', uid));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('[adventure] loadUserAdventures', e);
    return [];
  }
}

// ── Sélectionner une aventure ──────────────────
// Met à jour STATE, active le scope Firestore, retourne true si OK
export function selectAdventure(adv) {
  setAdventure(adv);
  setCurrentAdventure(adv.id);

  // isAdmin : vrai si admin global (profile.isAdmin) OU admin de cette aventure
  const uid = STATE.user?.uid;
  const isAdvAdmin = Array.isArray(adv.admins) && adv.admins.includes(uid);
  setAdmin(STATE.isSuperAdmin || isAdvAdmin);
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

  if (!accessList.includes(targetUid)) accessList.push(targetUid);
  if (asAdmin) {
    if (!admins.includes(targetUid)) admins.push(targetUid);
  } else {
    if (!players.includes(targetUid)) players.push(targetUid);
  }

  await updateDoc(ref, { players, admins, accessList });

  // Mettre à jour l'aventure locale si c'est la courante
  if (STATE.adventure?.id === adventureId) {
    setAdventure({ ...STATE.adventure, players, admins, accessList });
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

  await updateDoc(ref, { players, admins, accessList });

  if (STATE.adventure?.id === adventureId) {
    setAdventure({ ...STATE.adventure, players, admins, accessList });
  }
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
    'players', 'world', 'informations', 'tutorial',
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
  if (!admins.includes(targetUid)) admins.push(targetUid);
  if (!accessList.includes(targetUid)) accessList.push(targetUid);
  await updateDoc(ref, { admins, players, accessList });
  if (STATE.adventure?.id === adventureId) {
    setAdventure({ ...STATE.adventure, admins, players, accessList });
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
    'players', 'world', 'informations', 'tutorial',
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
      status:      'active',
    });
  } else {
    // Mettre à jour la liste des joueurs sans écraser les admins existants
    await updateDoc(advRef, {
      players:    playerUids,
      accessList: allUids,
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
