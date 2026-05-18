// ══════════════════════════════════════════════════════════════════════════════
// economy.js — Couche unifiée de gestion de l'or des personnages
//
// Tous les achats / ventes / dépôts / retraits passent par useGold() ou
// useGoldMulti(). Garanties :
//   - 1 seul updateInCol Firestore par opération (atomique avec extraPayload)
//   - libellé cohérent dans le livre de compte
//   - vérification de solde si dépense
//   - mise à jour locale de c.compte + refreshOrDisplay
//
// Usage simple (une ligne dans le compte) :
//   await useGold(charId, -100, 'Achat : Épée long');
//
// Usage avancé (plusieurs lignes, payload combiné avec inventaire/équipement) :
//   await useGoldMulti(charId, [
//     { delta: +50, reason: 'Vente : Potion' },
//     { delta: +10, reason: 'Reprise améliorations' },
//   ], { extraPayload: { inventaire: newInv } });
// ══════════════════════════════════════════════════════════════════════════════
import { STATE } from '../core/state.js';
import { updateInCol } from '../data/firestore.js';
import { calcOr } from './char-stats.js';

const _today = () => new Date().toLocaleDateString('fr-FR');

function _findChar(charId, override) {
  if (override) return override;
  return (STATE.characters || []).find(x => x.id === charId) || STATE.activeChar || null;
}

/**
 * Coeur du module : applique N entrées de compte + un payload optionnel
 * (inventaire, equipement, statsBonus, etc.) en UN SEUL updateInCol.
 *
 * @param {string} charId
 * @param {Array<{delta:number, reason:string, date?:string}>} entries
 * @param {object} [opts]
 * @param {object} [opts.charObj] — pour éviter une recherche dans STATE
 * @param {object} [opts.extraPayload] — fusionné dans updateInCol
 * @param {boolean} [opts.refreshUI=true] — appelle window.refreshOrDisplay
 * @param {boolean} [opts.allowOverdraft=false] — autorise solde négatif
 * @returns {Promise<{ok:boolean, newBalance?:number, error?:string}>}
 */
async function _applyGold(charId, entries, opts = {}) {
  const c = _findChar(charId, opts.charObj);
  if (!c) return { ok: false, error: 'Personnage introuvable' };
  if (!Array.isArray(entries) || !entries.length) {
    return { ok: false, error: 'Aucune entrée fournie' };
  }

  const totalDelta = entries.reduce((s, e) => s + (Number(e?.delta) || 0), 0);

  // Vérifie le solde si dépense nette (sauf si overdraft autorisé)
  if (totalDelta < 0 && !opts.allowOverdraft) {
    const solde = calcOr(c);
    if (solde + totalDelta < 0) {
      return { ok: false, error: `Solde insuffisant (${solde} or, manque ${Math.abs(solde + totalDelta)})` };
    }
  }

  const compte = { recettes: [], depenses: [], ...(c.compte || {}) };
  const newRecettes = [...(compte.recettes || [])];
  const newDepenses = [...(compte.depenses || [])];

  for (const e of entries) {
    const delta = Number(e?.delta) || 0;
    if (delta === 0) continue;
    const date    = e.date || _today();
    const libelle = String(e.reason || 'Transaction').slice(0, 100);
    const montant = Math.abs(delta);
    if (delta > 0) newRecettes.push({ date, libelle, montant });
    else           newDepenses.push({ date, libelle, montant });
  }

  const newCompte = { ...compte, recettes: newRecettes, depenses: newDepenses };
  const payload = { compte: newCompte, ...(opts.extraPayload || {}) };

  try {
    await updateInCol('characters', c.id, payload);
    c.compte = newCompte;
    // Applique aussi le extra payload localement pour rester en phase
    if (opts.extraPayload) Object.assign(c, opts.extraPayload);
    if (opts.refreshUI !== false) {
      try { window.refreshOrDisplay?.(c); } catch {}
    }
    return { ok: true, newBalance: calcOr(c) };
  } catch (e) {
    console.error('[economy] write failed', e);
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Cas simple : une ligne de compte.
 * delta > 0 → recette ; delta < 0 → dépense ; delta == 0 → no-op.
 */
export async function useGold(charId, delta, reason, opts = {}) {
  return _applyGold(charId, [{ delta, reason }], opts);
}

/**
 * Plusieurs lignes en une seule écriture (utile pour vente + reprise upgrade).
 */
export async function useGoldMulti(charId, entries, opts = {}) {
  return _applyGold(charId, entries, opts);
}

/**
 * Transfert d'or d'un perso vers un autre.
 * Atomique du point de vue de l'UX : si le crédit échoue, on roll back le débit.
 */
export async function transferGold(fromCharId, toCharId, amount, reason = 'Transfert') {
  const a = Math.abs(Number(amount) || 0);
  if (a <= 0) return { ok: false, error: 'Montant invalide' };
  if (fromCharId === toCharId) return { ok: false, error: 'Source et destination identiques' };

  const fromChar = _findChar(fromCharId);
  const toChar   = _findChar(toCharId);
  if (!fromChar || !toChar) return { ok: false, error: 'Personnage introuvable' };

  const fromName = fromChar.nom || '?';
  const toName   = toChar.nom   || '?';

  const debit = await useGold(fromCharId, -a, `${reason} → ${toName}`);
  if (!debit.ok) return debit;
  const credit = await useGold(toCharId, +a, `${reason} ← ${fromName}`);
  if (!credit.ok) {
    // Rollback : restitue l'or au sender pour cohérence
    await useGold(fromCharId, +a, '↻ Rollback transfert échoué');
    return credit;
  }
  return { ok: true };
}

/**
 * Solde courant d'un perso (sucre pour calcOr depuis l'extérieur).
 */
export function getGold(charId) {
  const c = _findChar(charId);
  return c ? calcOr(c) : 0;
}
