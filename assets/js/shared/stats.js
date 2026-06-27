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

// Cast d'un sort : +1 sort lancé, +PM dépensés, +1 sur la répartition par sort,
// +soin éventuel. Accumulé dans le même delta réversible que l'attaque.
export function accCastDelta(acc, { casterId, casterName, spellName, pm = 0, heal = 0 } = {}) {
  if (!casterId) return acc;
  acc.chars ??= {};
  const c = (acc.chars[casterId] ??= { name: casterName || '', combat: {} });
  if (casterName) c.name = casterName;
  c.combat.spellsCast = (c.combat.spellsCast || 0) + 1;
  if (pm > 0)   c.combat.pmSpent = (c.combat.pmSpent || 0) + pm;
  if (heal > 0) c.combat.heal    = (c.combat.heal || 0) + heal;
  if (spellName) { c.spells ??= {}; c.spells[spellName] = (c.spells[spellName] || 0) + 1; }
  return acc;
}

// Applique un delta brut via increment(). sign = +1 (pose) ou −1 (annulation).
// Générique : chaque groupe de compteurs (combat, spells, emotes…) est traité.
export function applyStatsDelta(delta, sign = 1) {
  if (!delta?.chars || !Object.keys(delta.chars).length) return;
  const chars = {};
  for (const [id, c] of Object.entries(delta.chars)) {
    const out = { name: c.name || '' };
    for (const [grp, counters] of Object.entries(c)) {
      if (grp === 'name' || !counters || typeof counters !== 'object') continue;
      const g = {};
      for (const [k, v] of Object.entries(counters)) g[k] = increment(sign * (Number(v) || 0));
      out[grp] = g;
    }
    chars[id] = out;
  }
  return bumpStats({ chars });
}

// ── Émote utilisée (par perso) ───────────────────────────────────────────────
// Pas d'annulation possible → écriture directe.
export function bumpEmote(charId, charName, emoteName) {
  if (!charId || !emoteName) return;
  return bumpStats({ chars: { [charId]: { name: charName || '', emotes: { [emoteName]: increment(1) } } } });
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
