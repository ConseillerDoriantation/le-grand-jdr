// ══════════════════════════════════════════════════════════════════════════════
// SHARED / CRUD.JS — Helpers pour les opérations CRUD récurrentes
// ══════════════════════════════════════════════════════════════════════════════
import { confirmModal } from './modal.js';
import { deleteFromCol } from '../data/firestore.js';

/**
 * Affiche une confirmation puis supprime le document si confirmé.
 * Retourne true si supprimé, false si annulé.
 * Le appelant gère showNotif et le re-render.
 *
 * @param {string} col      - Collection Firestore
 * @param {string} id       - ID du document
 * @param {string} message  - Texte de confirmation
 * @param {object} [opts]   - Options passées à confirmModal (title, okLabel…)
 */
export async function confirmDelete(col, id, message, opts = {}) {
  if (!await confirmModal(message, opts)) return false;
  await deleteFromCol(col, id);
  return true;
}
