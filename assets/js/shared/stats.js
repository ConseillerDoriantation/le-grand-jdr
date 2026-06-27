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
  if (!ref || !patch) return;
  await setDoc(ref, patch, { merge: true }).catch(() => {});
}

export async function loadStats() {
  const ref = _statsRef();
  if (!ref) return null;
  const snap = await getDoc(ref).catch(() => null);
  return snap?.exists() ? snap.data() : null;
}

// ── Jet de compétence (Athlétisme, Acrobaties…) ──────────────────────────────
// Comptabilise 1 jet, + crit (20 nat) et + échec critique (1 nat). La réussite
// n'est pas auto-déterminée (pas de DD systématique) → on ne compte pas succès/échec.
// ── Attaque (arme / sort offensif) ───────────────────────────────────────────
// Pour pouvoir ANNULER une action (et réverser ses stats), on accumule un delta
// en NOMBRES BRUTS (sérialisable → stockable dans le log), puis on l'applique
// avec un signe (+1 pose l'action, −1 l'annule). On ne compte que les PJ.
//
// `acc` = { chars: { [id]: { name, combat: {…compteurs nombres…} } } }
export function accAttackDelta(acc, { attackerId, attackerName, targetId, targetName, hit, crit, fumble, dmg = 0, ko = false } = {}) {
  acc.chars ??= {};
  const add = (id, name, fields) => {
    if (!id) return;
    const c = (acc.chars[id] ??= { name: name || '', combat: {} });
    if (name) c.name = name;
    for (const [k, v] of Object.entries(fields)) c.combat[k] = (c.combat[k] || 0) + v;
  };
  add(attackerId, attackerName, {
    attacks: 1, hits: hit ? 1 : 0, crits: crit ? 1 : 0, fumbles: fumble ? 1 : 0,
    dmgDealt: dmg > 0 ? dmg : 0, kosDealt: ko ? 1 : 0,
  });
  if (targetId && targetId !== attackerId) add(targetId, targetName, {
    dmgTaken: dmg > 0 ? dmg : 0, kosTaken: ko ? 1 : 0,
  });
  return acc;
}

// Applique un delta brut via increment(). sign = +1 (pose) ou −1 (annulation).
export function applyStatsDelta(delta, sign = 1) {
  if (!delta?.chars || !Object.keys(delta.chars).length) return;
  const chars = {};
  for (const [id, c] of Object.entries(delta.chars)) {
    const combat = {};
    for (const [k, v] of Object.entries(c.combat || {})) combat[k] = increment(sign * (Number(v) || 0));
    chars[id] = { name: c.name || '', combat };
  }
  return bumpStats({ chars });
}

export function bumpSkill(charId, charName, skill, { crit = false, fumble = false } = {}) {
  if (!charId || !skill) return;
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
