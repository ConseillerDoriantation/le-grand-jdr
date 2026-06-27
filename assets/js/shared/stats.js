// ══════════════════════════════════════════════════════════════════════════════
// STATS.JS — Statistiques d'aventure (compteurs incrémentaux)
// ──────────────────────────────────────────────────────────────────────────────
// Un seul doc par aventure : adventures/{aid}/stats/main. À chaque action
// (jet de compétence, attaque, soin, émote…) on INCRÉMENTE des compteurs via
// FieldValue.increment — pas de read-modify-write, sûr en concurrence et quasi
// gratuit en quota (1 petite écriture / action, 1 seule lecture pour la page).
//
// Modèle (tout en compteurs) :
//   chars: {
//     [charId]: {
//       name,                                   // dénormalisé pour l'affichage
//       skills: { [skill]: { rolls, crits, fumbles } },
//       // (phase 2) attacks, hits, crits, fumbles, dmgDealt, dmgTaken,
//       //           biggestHit, heal, kosDealt, kosTaken, pmSpent, spellsCast,
//       //           spells:{}, emotes:{}
//     }
//   }
// Les stats GLOBALES (table) = somme des chars, calculée à l'affichage.
// ══════════════════════════════════════════════════════════════════════════════

import { db, doc, getDoc, setDoc, increment } from '../config/firebase.js';
import { getCurrentAdventureId } from '../data/firestore.js';

function _statsRef() {
  const aid = getCurrentAdventureId();   // id canonique (même source que le VTT)
  return aid ? doc(db, `adventures/${aid}/stats/main`) : null;
}

// Écriture générique : `patch` peut contenir des increment(n) imbriqués.
// setDoc(merge:true) fusionne en profondeur ET crée le doc s'il n'existe pas.
async function bumpStats(patch) {
  const ref = _statsRef();
  if (!ref || !patch) { console.warn('[stats] bumpStats annulé — pas de ref (aventure?) ou patch vide', { aid: getCurrentAdventureId() }); return; }
  try {
    await setDoc(ref, patch, { merge: true });
    console.debug('[stats] bumpStats OK →', ref.path);
  } catch (e) {
    console.error('[stats] bumpStats ÉCHEC →', ref.path, e?.code || e?.message || e);
  }
}

export async function loadStats() {
  const ref = _statsRef();
  if (!ref) { console.warn('[stats] loadStats — pas de ref (aventure?)'); return null; }
  try {
    const snap = await getDoc(ref);
    console.debug('[stats] loadStats →', ref.path, 'exists:', snap.exists(), snap.exists() ? snap.data() : null);
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.error('[stats] loadStats ÉCHEC →', ref.path, e?.code || e?.message || e);
    return null;
  }
}

// ── Jet de compétence (Athlétisme, Acrobaties…) ──────────────────────────────
// Comptabilise 1 jet, + crit (20 nat) et + échec critique (1 nat). La réussite
// n'est pas auto-déterminée (pas de DD systématique) → on ne compte pas succès/échec.
export function bumpSkill(charId, charName, skill, { crit = false, fumble = false } = {}) {
  console.debug('[stats] bumpSkill', { charId, charName, skill, crit, fumble });
  if (!charId || !skill) { console.warn('[stats] bumpSkill ignoré — charId/skill manquant'); return; }
  // Les clés de map (charId, skill) peuvent contenir accents/espaces → on passe
  // par des OBJETS imbriqués (pas des field-paths pointés) pour rester valide.
  return bumpStats({
    chars: { [charId]: {
      name: charName || '',
      skills: { [skill]: {
        rolls:   increment(1),
        crits:   increment(crit   ? 1 : 0),
        fumbles: increment(fumble ? 1 : 0),
      } },
    } },
  });
}
