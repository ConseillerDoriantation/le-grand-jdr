// ══════════════════════════════════════════════════════════════════════════════
// SHARED / CRUD.JS — Helpers pour les opérations CRUD récurrentes
// ══════════════════════════════════════════════════════════════════════════════
import { confirmModal } from './modal.js';
import { updateInCol, addToCol, deleteFromCol, saveDoc } from '../data/firestore.js';
import { notifySaveError } from './notifications.js';

/**
 * Affiche une confirmation puis supprime le document si confirmé.
 * Retourne true si supprimé, false si annulé ou erreur Firestore.
 * L'appelant gère showNotif et le re-render.
 */
export async function confirmDelete(col, id, message, opts = {}) {
  if (!await confirmModal(message, opts)) return false;
  try {
    await deleteFromCol(col, id);
    return true;
  } catch (e) {
    notifySaveError(e);
    return false;
  }
}

/**
 * Persiste un patch Firestore silencieusement.
 * Affiche un toast d'erreur si la sauvegarde échoue, rien si succès.
 * À utiliser pour les sauvegardes inline (toggle, champ unique…).
 * Retourne true si sauvegardé, false si erreur.
 */
export async function trySave(col, id, patch) {
  try {
    await updateInCol(col, id, patch);
    return true;
  } catch (e) {
    notifySaveError(e);
    return false;
  }
}

/**
 * Crée ou met à jour un document Firestore.
 * Si id est fourni → updateInCol (merge). Sinon → addToCol (création auto-id).
 * Retourne true si succès, false si erreur.
 */
export async function tryUpsert(col, id, data) {
  try {
    if (id) await updateInCol(col, id, data);
    else await addToCol(col, data);
    return true;
  } catch (e) {
    notifySaveError(e);
    return false;
  }
}

/**
 * Écrit (set/replace) un document Firestore via saveDoc.
 * Affiche un toast d'erreur si l'écriture échoue.
 * Retourne true si sauvegardé, false si erreur.
 */
export async function tryDoc(col, id, data) {
  try {
    await saveDoc(col, id, data);
    return true;
  } catch (e) {
    notifySaveError(e);
    return false;
  }
}
