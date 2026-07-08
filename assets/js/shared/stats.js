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

import { db, doc, getDoc, setDoc, updateDoc, increment, deleteField } from '../config/firebase.js';
import { getCurrentAdventureId } from '../data/firestore.js';

function _statsRef() {
  const aid = getCurrentAdventureId();   // id canonique (même source que le VTT)
  return aid ? doc(db, `adventures/${aid}/stats/main`) : null;
}

// Clé de séance = jour local YYYY-MM-DD. Permet une vue « stats par date »
// sans lecture supplémentaire (les compteurs datés vivent dans le même doc).
export function statsDateKey(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

// Miroir mémoire best-effort du doc (pour le « plus gros coup » : un max ne se
// fait pas avec increment()). Rafraîchi à chaque loadStats / écriture locale.
let _mem = null;

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
  const d = snap?.exists() ? snap.data() : null;
  _mem = d || {};
  return d;
}

// Remise à zéro de toutes les statistiques de l'aventure (MJ).
export async function resetStats() {
  const ref = _statsRef();
  if (!ref) return false;
  try { await setDoc(ref, {}, { merge: false }); _mem = {}; return true; }
  catch { return false; }
}

// Supprime les stats d'UN personnage (ex. jets de test) sans toucher aux autres.
export async function deleteCharStats(charId) {
  const ref = _statsRef();
  if (!ref || !charId) return false;
  try {
    await updateDoc(ref, { [`chars.${charId}`]: deleteField() });
    if (_mem?.chars) delete _mem.chars[charId];
    return true;
  } catch { return false; }
}

// Lien d'une séance (date) → mission de la Trame + groupe de cette mission,
// édité par le MJ. Stocké dans le même doc stats (sessions.{date}) — 0 lecture.
export async function setSessionMission(dateKey, { mission = '', missionId = '', groupId = '', group = '' } = {}) {
  if (!dateKey) return false;
  const entry = { mission: (mission || '').trim(), missionId: missionId || '', groupId: groupId || '', group: (group || '').trim() };
  await bumpStats({ sessions: { [dateKey]: entry } });
  if (_mem) { (_mem.sessions ??= {})[dateKey] = entry; }
  return true;
}

// ── Suppression ciblée de stats (MJ) ────────────────────────────────────────
// Somme brute des miroirs `byDate` d'un perso sur un ensemble de dates.
function _sumByDatesRaw(c, dates) {
  const acc = {};
  for (const dk of dates) {
    const bd = c?.byDate?.[dk]; if (!bd) continue;
    for (const [grp, obj] of Object.entries(bd)) {
      if (!obj || typeof obj !== 'object') continue;
      const a = (acc[grp] ??= {});
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'number') a[k] = (a[k] || 0) + v;
        else if (v && typeof v === 'object') { const a2 = (a[k] ??= {}); for (const [k2, v2] of Object.entries(v)) if (typeof v2 === 'number') a2[k2] = (a2[k2] || 0) + v2; }
      }
    }
  }
  return acc;
}

// Supprime les stats enregistrées pour un ENSEMBLE de dates : soustrait leur
// miroir des totaux campagne (champs sommables) puis retire les entrées byDate
// et la description de séance. Les records "max" (biggestHit) ne sont pas datés
// → non ajustés (cosmétique). Réservé au MJ (règle doc stats).
export async function deleteDatesStats(dates) {
  const ref = _statsRef();
  if (!ref || !Array.isArray(dates) || !dates.length) return false;
  const snap = await getDoc(ref).catch(() => null);
  const d = snap?.exists() ? snap.data() : null;
  if (!d) return false;
  const charsPatch = {};
  for (const [id, c] of Object.entries(d.chars || {})) {
    const relevant = dates.filter(dk => c.byDate?.[dk]);
    if (!relevant.length) continue;
    const sum = _sumByDatesRaw(c, relevant);
    const byDateDel = {}; relevant.forEach(dk => { byDateDel[dk] = deleteField(); });
    charsPatch[id] = { ..._incTree(sum, -1), byDate: byDateDel };
  }
  const sessionsDel = {}; dates.forEach(dk => { sessionsDel[dk] = deleteField(); });
  try {
    await setDoc(ref, { chars: charsPatch, sessions: sessionsDel }, { merge: true });
    _mem = null;   // forcera un re-fetch propre au prochain loadStats
    return true;
  } catch { return false; }
}

export const deleteDateStats = (dateKey) => deleteDatesStats(dateKey ? [dateKey] : []);

// Supprime toutes les stats liées à une mission (toutes ses séances datées).
export async function deleteMissionStats(missionId) {
  const ref = _statsRef();
  if (!ref || !missionId) return false;
  const snap = await getDoc(ref).catch(() => null);
  const d = snap?.exists() ? snap.data() : null;
  if (!d) return false;
  const dates = Object.entries(d.sessions || {}).filter(([, s]) => s?.missionId === missionId).map(([dk]) => dk);
  if (!dates.length) return false;
  return deleteDatesStats(dates);
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
  const dk = statsDateKey();
  const add = (id, name, fields) => {
    if (!id) return;
    const c = (acc.chars[id] ??= { name: name || '', combat: {} });
    if (name) c.name = name;
    const dc = (((c.byDate ??= {})[dk] ??= { combat: {} }).combat);   // miroir par séance
    for (const [k, v] of Object.entries(fields)) {
      c.combat[k] = (c.combat[k] || 0) + v;
      dc[k] = (dc[k] || 0) + v;
    }
  };
  add(attackerId, attackerName, {
    attacks: 1, hits: hit ? 1 : 0, crits: crit ? 1 : 0, fumbles: fumble ? 1 : 0,
    dmgDealt: dmg > 0 ? dmg : 0, kosDealt: ko ? 1 : 0,
  });
  if (targetId && targetId !== attackerId) add(targetId, targetName, {
    attacksTaken: 1, attacksAvoided: hit ? 0 : 1,
    dmgTaken: dmg > 0 ? dmg : 0, kosTaken: ko ? 1 : 0,
  });
  return acc;
}

// Cast d'un sort : +1 sort lancé, +PM dépensés, +1 sur la répartition par sort,
// +soin éventuel. Accumulé dans le même delta réversible que l'attaque.
export function accCastDelta(acc, { casterId, casterName, spellName, pm = 0, heal = 0, tactical = 0, support = 0, affliction = 0 } = {}) {
  if (!casterId) return acc;
  acc.chars ??= {};
  const dk = statsDateKey();
  const c = (acc.chars[casterId] ??= { name: casterName || '', combat: {} });
  if (casterName) c.name = casterName;
  const dEntry = ((c.byDate ??= {})[dk] ??= { combat: {} });
  const bump = (grp, key, val) => {
    (c[grp] ??= {})[key] = (c[grp][key] || 0) + val;
    (dEntry[grp] ??= {})[key] = (dEntry[grp][key] || 0) + val;
  };
  bump('combat', 'spellsCast', 1);
  if (pm > 0)    bump('combat', 'pmSpent', pm);
  if (heal > 0)  bump('combat', 'heal', heal);
  if (tactical > 0)   bump('combat', 'tacticalSpells', tactical);
  if (support > 0)    bump('combat', 'supportSpells', support);
  if (affliction > 0) bump('combat', 'afflictionSpells', affliction);
  if (spellName) bump('spells', spellName, 1);
  return acc;
}

// Applique un delta brut via increment(). sign = +1 (pose) ou −1 (annulation).
// Récursif : tout NOMBRE (à n'importe quelle profondeur : combat, spells, emotes,
// byDate.{date}.combat…) devient un increment ; les chaînes (name) sont conservées.
function _incTree(node, sign) {
  if (typeof node === 'number') return increment(sign * node);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = (typeof v === 'string') ? v : _incTree(v, sign);
    return out;
  }
  return node;
}
export function applyStatsDelta(delta, sign = 1) {
  if (!delta?.chars || !Object.keys(delta.chars).length) return;
  return bumpStats({ chars: _incTree(delta.chars, sign) });
}

// ── Records "max" (plus gros coup infligé / reçu) ────────────────────────────
// increment() ne sait pas faire un max → on compare au miroir mémoire (_mem,
// amorcé d'un seul getDoc par session si besoin) et on n'écrit que si record.
// Non réversible à l'annulation (un record reste un record) — acceptable.
async function _bumpMaxField(charId, charName, field, val) {
  if (!charId || !(val > 0)) return;
  if (!_mem) _mem = (await loadStats()) || {};
  const cur = Number(_mem?.chars?.[charId]?.combat?.[field]) || 0;
  if (val <= cur) return;
  ((((_mem.chars ??= {})[charId] ??= {}).combat ??= {})[field]) = val;
  return bumpStats({ chars: { [charId]: { name: charName || '', combat: { [field]: val } } } });
}
export const bumpBiggestHit   = (charId, name, dmg) => _bumpMaxField(charId, name, 'biggestHit', dmg);
export const bumpBiggestTaken = (charId, name, dmg) => _bumpMaxField(charId, name, 'biggestTaken', dmg);

// ── Soin direct (ex. tick de Régénération) ───────────────────────────────────
// Écriture directe (un HoT par tour ne se « défait » pas proprement à l'annulation).
export function bumpHeal(charId, charName, amount) {
  if (!charId || !(amount > 0)) return;
  const dk = statsDateKey();
  return bumpStats({ chars: { [charId]: {
    name: charName || '',
    combat: { heal: increment(amount) },
    byDate: { [dk]: { combat: { heal: increment(amount) } } },
  } } });
}

// ── Émote utilisée (par perso) ───────────────────────────────────────────────
// Pas d'annulation possible → écriture directe.
export function bumpDamageTaken(charId, charName, amount, { ko = false } = {}) {
  const dmg = Math.max(0, Number(amount) || 0);
  if (!charId || (dmg <= 0 && !ko)) return;
  const dk = statsDateKey();
  const combat = {};
  if (dmg > 0) combat.dmgTaken = increment(dmg);
  if (ko) combat.kosTaken = increment(1);
  return bumpStats({ chars: { [charId]: {
    name: charName || '',
    combat,
    byDate: { [dk]: { combat } },
  } } });
}

export function bumpEmote(charId, charName, emoteName) {
  if (!charId || !emoteName) return;
  const dk = statsDateKey();
  return bumpStats({ chars: { [charId]: {
    name: charName || '',
    emotes: { [emoteName]: increment(1) },
    byDate: { [dk]: { emotes: { [emoteName]: increment(1) } } },
  } } });
}

export function bumpSkill(charId, charName, skill, { crit = false, fumble = false } = {}) {
  if (!charId || !skill) return;
  // Les clés de map (charId, skill) peuvent contenir accents/espaces → on passe
  // par des OBJETS imbriqués (pas des field-paths pointés) pour rester valide.
  const dk = statsDateKey();
  const sk = () => ({ rolls: increment(1), crits: increment(crit ? 1 : 0), fumbles: increment(fumble ? 1 : 0) });
  return bumpStats({ chars: { [charId]: {
    name: charName || '',
    skills: { [skill]: sk() },
    byDate: { [dk]: { skills: { [skill]: sk() } } },
  } } });
}
