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
//       skills: { [skill]: { rolls, crits, fumbles,
//                   trackedRolls, naturalTotal, resultTotal } },
//       // (phase 2) attacks, hits, crits, fumbles, dmgDealt, dmgTaken,
//       //           biggestHit, heal, kosDealt, kosTaken, pmSpent, spellsCast,
//       //           spells:{}, emotes:{}
//       // Moyennes non rétroactives : damageEvents/damageTotal,
//       // attackRolls/attackRollTotal et attackResultRolls/attackResultTotal
//       // sont incrémentés avec les mêmes actions.
//     }
//   }
// Les stats GLOBALES (table) = somme des chars, calculée à l'affichage.
// ══════════════════════════════════════════════════════════════════════════════

import { db, doc, getDoc, setDoc, updateDoc, increment, deleteField } from '../config/firebase.js';
import { getCurrentAdventureId } from '../data/firestore.js';
import { buildCombatCorrectionDeltas } from './stats-corrections.js';

function _statsRef() {
  const aid = getCurrentAdventureId();   // id canonique (même source que le VTT)
  return aid ? doc(db, `adventures/${aid}/stats/main`) : null;
}

// Jour local YYYY-MM-DD. Les données historiques l'utilisent comme clé ; les
// nouvelles séances VTT disposent en plus d'un identifiant unique par démarrage.
export function statsDateKey(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

// Une date n'est pas une identité de séance : plusieurs groupes peuvent jouer
// le même jour. Le VTT pose ce contexte lorsqu'une session live est démarrée.
// Hors session live, on conserve le stockage historique `byDate`.
let _activeSession = null;

export function makeStatsSessionKey(dateKey = statsDateKey(), startedAt = Date.now()) {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || '')) ? String(dateKey) : statsDateKey();
  const stamp = Math.max(0, Math.trunc(Number(startedAt) || Date.now())).toString(36);
  return `${safeDate}__${stamp}`;
}

export function setActiveStatsSession(session = null) {
  const key = String(session?.key || '').trim();
  const date = String(session?.date || '').trim();
  _activeSession = key ? { key, date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : statsDateKey() } : null;
}

export function getActiveStatsSession() {
  return _activeSession ? { ..._activeSession } : null;
}

function _statsBucket() {
  if (_activeSession) return { field: 'bySession', key: _activeSession.key, date: _activeSession.date };
  const date = statsDateKey();
  return { field: 'byDate', key: date, date };
}

function _sessionEntryForChar(char, sessionKey) {
  if (!char || !sessionKey) return { field: '', value: null };
  if (char.bySession?.[sessionKey]) return { field: 'bySession', value: char.bySession[sessionKey] };
  if (char.byDate?.[sessionKey]) return { field: 'byDate', value: char.byDate[sessionKey] };
  return { field: '', value: null };
}

// Miroir mémoire best-effort du doc (pour le « plus gros coup » : un max ne se
// fait pas avec increment()). Rafraîchi à chaque loadStats / écriture locale.
let _mem = null;

// Écriture générique : `patch` peut contenir des increment(n) imbriqués.
// setDoc(merge:true) fusionne en profondeur ET crée le doc s'il n'existe pas.
async function bumpStats(patch) {
  const ref = _statsRef();
  if (!ref || !patch) return false;
  try { await setDoc(ref, patch, { merge: true }); return true; }
  catch { return false; }
}

export async function registerStatsSession({ key = '', date = '', startedAt = Date.now() } = {}) {
  const sessionKey = String(key || '').trim();
  if (!sessionKey) return false;
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : statsDateKey();
  const previous = _mem?.sessions?.[sessionKey] || {};
  const entry = { ...previous, date: dateKey, startedAt: Math.max(0, Math.trunc(Number(startedAt) || Date.now())) };
  const saved = await bumpStats({ sessions: { [sessionKey]: entry } });
  if (saved && _mem) (_mem.sessions ??= {})[sessionKey] = entry;
  return saved;
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

// Supprime les statistiques d'UN personnage pour UNE séance uniquement.
// Les compteurs datés sont soustraits de ses totaux de campagne, mais la séance,
// son lien mission/groupe et les statistiques des autres personnages restent.
// Le cutoff empêche le journal VTT historique de reconstruire les moyennes que
// le MJ vient volontairement de retirer ; les nouvelles actions restent suivies.
export async function deleteCharDateStats(charId, dateKey) {
  const ref = _statsRef();
  if (!ref || !charId || !dateKey) return false;
  const snap = await getDoc(ref).catch(() => null);
  const data = snap?.exists() ? snap.data() : null;
  const char = data?.chars?.[charId];
  const bucket = _sessionEntryForChar(char, dateKey);
  if (!bucket.value) return false;
  const sum = _sumByDatesRaw(char, [dateKey]);
  try {
    await setDoc(ref, { chars: { [charId]: {
      ..._incTree(sum, -1),
      [bucket.field]: { [dateKey]: deleteField() },
      vttLogCutoffs: { [dateKey]: Date.now() },
    } } }, { merge: true });
    _mem = null;
    return true;
  } catch { return false; }
}

// Lien d'une séance (date) → mission de la Trame + groupe de cette mission,
// édité par le MJ. Stocké dans le même doc stats (sessions.{sessionKey}) — 0 lecture.
export async function setSessionMission(dateKey, { mission = '', missionId = '', groupId = '', group = '' } = {}) {
  if (!dateKey) return false;
  const previous = _mem?.sessions?.[dateKey] || {};
  const inferredDate = /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : String(dateKey).slice(0, 10);
  const entry = {
    ...previous,
    date: previous.date || (/^\d{4}-\d{2}-\d{2}$/.test(inferredDate) ? inferredDate : ''),
    mission: (mission || '').trim(), missionId: missionId || '',
    groupId: groupId || '', group: (group || '').trim(),
  };
  const saved = await bumpStats({ sessions: { [dateKey]: entry } });
  if (saved && _mem) (_mem.sessions ??= {})[dateKey] = entry;
  return saved;
}

// ── Suppression ciblée de stats (MJ) ────────────────────────────────────────
// Somme brute des miroirs `byDate` / `bySession` d'un perso.
function _sumByDatesRaw(c, dates) {
  const acc = {};
  for (const dk of dates) {
    const bd = _sessionEntryForChar(c, dk).value; if (!bd) continue;
    for (const [grp, obj] of Object.entries(bd)) {
      if (!obj || typeof obj !== 'object') continue;
      const a = (acc[grp] ??= {});
      for (const [k, v] of Object.entries(obj)) {
        // Les records sont des maxima datés, pas des compteurs sommables : les
        // soustraire du record campagne produirait une valeur incohérente.
        if (grp === 'combat' && (k === 'biggestHit' || k === 'biggestTaken')) continue;
        if (typeof v === 'number') a[k] = (a[k] || 0) + v;
        else if (v && typeof v === 'object') { const a2 = (a[k] ??= {}); for (const [k2, v2] of Object.entries(v)) if (typeof v2 === 'number') a2[k2] = (a2[k2] || 0) + v2; }
      }
    }
  }
  return acc;
}

// Supprime les stats enregistrées pour un ENSEMBLE de dates : soustrait leur
// miroir des totaux campagne (champs sommables) puis retire les entrées de séance
// et la description de séance. Les records « max » ne sont pas soustraits comme
// des compteurs ; le journal permet de retrouver le maximum des scopes restants.
// Réservé au MJ (règle doc stats).
export async function deleteDatesStats(dates) {
  const ref = _statsRef();
  if (!ref || !Array.isArray(dates) || !dates.length) return false;
  const snap = await getDoc(ref).catch(() => null);
  const d = snap?.exists() ? snap.data() : null;
  if (!d) return false;
  const charsPatch = {};
  for (const [id, c] of Object.entries(d.chars || {})) {
    const relevant = dates.filter(dk => _sessionEntryForChar(c, dk).value);
    if (!relevant.length) continue;
    const sum = _sumByDatesRaw(c, relevant);
    const byDateDel = {}, bySessionDel = {};
    relevant.forEach(dk => {
      if (_sessionEntryForChar(c, dk).field === 'bySession') bySessionDel[dk] = deleteField();
      else byDateDel[dk] = deleteField();
    });
    charsPatch[id] = { ..._incTree(sum, -1) };
    if (Object.keys(byDateDel).length) charsPatch[id].byDate = byDateDel;
    if (Object.keys(bySessionDel).length) charsPatch[id].bySession = bySessionDel;
  }
  const sessionsDel = {}; dates.forEach(dk => { sessionsDel[dk] = deleteField(); });
  try {
    await setDoc(ref, { chars: charsPatch, sessions: sessionsDel }, { merge: true });
    _mem = null;   // forcera un re-fetch propre au prochain loadStats
    return true;
  } catch { return false; }
}

export const deleteDateStats = (dateKey) => deleteDatesStats(dateKey ? [dateKey] : []);

// Correction MJ ciblée sur une séance et un personnage. Chaque différence est
// répercutée sur le miroir daté ET sur le total campagne, afin que tous les scopes
// restent cohérents. Les totaux servant aux moyennes suivent les dégâts corrigés.
export async function correctDateCombatStats(charId, dateKey, values = {}) {
  const ref = _statsRef();
  if (!ref || !charId || !dateKey) return false;
  const snap = await getDoc(ref).catch(() => null);
  const data = snap?.exists() ? snap.data() : null;
  const bucket = _sessionEntryForChar(data?.chars?.[charId], dateKey);
  const current = bucket.value?.combat;
  if (!current) return false;

  const deltas = buildCombatCorrectionDeltas(current, values);
  const patch = {};
  for (const [field, delta] of Object.entries(deltas)) {
    patch[`chars.${charId}.combat.${field}`] = increment(delta);
    patch[`chars.${charId}.${bucket.field}.${dateKey}.combat.${field}`] = increment(delta);
  }
  // Une valeur validée manuellement devient prioritaire sur la reconstruction
  // du journal pour cette séance, afin d'éviter une double correction au reload.
  if (Object.hasOwn(values, 'dmgTaken')) patch[`chars.${charId}.${bucket.field}.${dateKey}.combat.manualDamageTaken`] = 1;
  if (Object.hasOwn(values, 'dmgDealt')) patch[`chars.${charId}.${bucket.field}.${dateKey}.combat.manualDamageDealt`] = 1;
  if (!Object.keys(patch).length) return true;
  try {
    await updateDoc(ref, patch);
    _mem = null;
    return true;
  } catch {
    return false;
  }
}

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
export function accAttackDelta(acc, { attackerId, attackerName, targetId, targetName, hit, crit, fumble, roll = null, result = null, dmg = 0, ko = false, countAction = true } = {}) {
  acc.chars ??= {};
  const bucket = _statsBucket();
  const add = (id, name, fields) => {
    if (!id) return;
    const c = (acc.chars[id] ??= { name: name || '', combat: {} });
    if (name) c.name = name;
    const dc = (((c[bucket.field] ??= {})[bucket.key] ??= { combat: {} }).combat);   // miroir par séance
    for (const [k, v] of Object.entries(fields)) {
      c.combat[k] = (c.combat[k] || 0) + v;
      dc[k] = (dc[k] || 0) + v;
    }
  };
  const trackedRoll = roll !== null && roll !== '' && Number.isFinite(Number(roll)) ? Number(roll) : null;
  const trackedResult = result !== null && result !== '' && Number.isFinite(Number(result)) ? Number(result) : null;
  const trackedDamage = dmg > 0 ? Number(dmg) : 0;
  add(attackerId, attackerName, {
    attacks: countAction ? 1 : 0,
    hits: countAction && hit ? 1 : 0,
    crits: countAction && crit ? 1 : 0,
    fumbles: countAction && fumble ? 1 : 0,
    attackRolls: countAction && trackedRoll != null ? 1 : 0,
    attackRollTotal: countAction ? (trackedRoll || 0) : 0,
    attackResultRolls: countAction && trackedResult != null ? 1 : 0,
    attackResultTotal: countAction ? (trackedResult || 0) : 0,
    dmgDealt: trackedDamage, damageEvents: trackedDamage > 0 ? 1 : 0,
    damageTotal: trackedDamage, kosDealt: ko ? 1 : 0,
  });
  if (targetId && targetId !== attackerId) add(targetId, targetName, {
    attacksTaken: 1, attacksAvoided: hit ? 0 : 1,
    dmgTaken: trackedDamage, damageTakenEvents: trackedDamage > 0 ? 1 : 0,
    damageTakenTotal: trackedDamage, kosTaken: ko ? 1 : 0,
  });
  return acc;
}

// Cast d'un sort : +1 sort lancé, +PM dépensés, +1 sur la répartition par sort,
// +soin éventuel. Accumulé dans le même delta réversible que l'attaque.
export function accCastDelta(acc, {
  casterId, casterName, spellName, pm = 0, heal = 0, mana = 0,
  tactical = 0, support = 0, affliction = 0, control = 0,
  natural = null, result = null, crit = false, fumble = false,
} = {}) {
  if (!casterId) return acc;
  acc.chars ??= {};
  const bucket = _statsBucket();
  const c = (acc.chars[casterId] ??= { name: casterName || '', combat: {} });
  if (casterName) c.name = casterName;
  const dEntry = ((c[bucket.field] ??= {})[bucket.key] ??= { combat: {} });
  const bump = (grp, key, val) => {
    (c[grp] ??= {})[key] = (c[grp][key] || 0) + val;
    (dEntry[grp] ??= {})[key] = (dEntry[grp][key] || 0) + val;
  };
  bump('combat', 'spellsCast', 1);
  if (pm > 0)    bump('combat', 'pmSpent', pm);
  if (heal > 0)  bump('combat', 'heal', heal);
  if (mana > 0)  bump('combat', 'manaHealed', mana);
  if (tactical > 0)   bump('combat', 'tacticalSpells', tactical);
  if (support > 0)    bump('combat', 'supportSpells', support);
  if (affliction > 0) bump('combat', 'afflictionSpells', affliction);
  if (control > 0)    bump('combat', 'controlSpells', control);
  const trackedNatural = natural !== null && natural !== '' && Number.isFinite(Number(natural)) ? Number(natural) : null;
  const trackedResult = result !== null && result !== '' && Number.isFinite(Number(result)) ? Number(result) : null;
  if (trackedNatural != null) {
    bump('combat', 'supplementalRolls', 1);
    bump('combat', 'supplementalNaturalTotal', trackedNatural);
    if (trackedResult != null) {
      bump('combat', 'supplementalResultRolls', 1);
      bump('combat', 'supplementalResultTotal', trackedResult);
    }
    if (crit) bump('combat', 'supplementalCrits', 1);
    if (fumble) bump('combat', 'supplementalFumbles', 1);
  }
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
  // Capture le périmètre avant la lecture réseau : terminer la session pendant
  // ce court délai ne doit pas déplacer le record vers le jour générique.
  const bucket = _statsBucket();
  if (!_mem) _mem = (await loadStats()) || {};
  const cur = Number(_mem?.chars?.[charId]?.combat?.[field]) || 0;
  const dateCur = Number(_mem?.chars?.[charId]?.[bucket.field]?.[bucket.key]?.combat?.[field]) || 0;
  if (val <= cur && val <= dateCur) return;
  const char = ((_mem.chars ??= {})[charId] ??= {});
  const patch = { chars: { [charId]: { name: charName || '' } } };
  if (val > cur) {
    (char.combat ??= {})[field] = val;
    patch.chars[charId].combat = { [field]: val };
  }
  if (val > dateCur) {
    (((char[bucket.field] ??= {})[bucket.key] ??= {}).combat ??= {})[field] = val;
    patch.chars[charId][bucket.field] = { [bucket.key]: { combat: { [field]: val } } };
  }
  return bumpStats(patch);
}
export const bumpBiggestHit   = (charId, name, dmg) => _bumpMaxField(charId, name, 'biggestHit', dmg);
export const bumpBiggestTaken = (charId, name, dmg) => _bumpMaxField(charId, name, 'biggestTaken', dmg);

// ── Soin direct (ex. tick de Régénération) ───────────────────────────────────
// Écriture directe (un HoT par tour ne se « défait » pas proprement à l'annulation).
export function bumpHeal(charId, charName, amount) {
  if (!charId || !(amount > 0)) return;
  const bucket = _statsBucket();
  return bumpStats({ chars: { [charId]: {
    name: charName || '',
    combat: { heal: increment(amount) },
    [bucket.field]: { [bucket.key]: { combat: { heal: increment(amount) } } },
  } } });
}

// ── Émote utilisée (par perso) ───────────────────────────────────────────────
// Pas d'annulation possible → écriture directe.
export function bumpDamageTaken(charId, charName, amount, { ko = false } = {}) {
  const dmg = Math.max(0, Number(amount) || 0);
  if (!charId || (dmg <= 0 && !ko)) return;
  const bucket = _statsBucket();
  const combat = {};
  if (dmg > 0) combat.dmgTaken = increment(dmg);
  if (ko) combat.kosTaken = increment(1);
  return bumpStats({ chars: { [charId]: {
    name: charName || '',
    combat,
    [bucket.field]: { [bucket.key]: { combat } },
  } } });
}

export function bumpEmote(charId, charName, emoteName) {
  if (!charId || !emoteName) return;
  const bucket = _statsBucket();
  return bumpStats({ chars: { [charId]: {
    name: charName || '',
    emotes: { [emoteName]: increment(1) },
    [bucket.field]: { [bucket.key]: { emotes: { [emoteName]: increment(1) } } },
  } } });
}

export function bumpSkill(charId, charName, skill, { crit = false, fumble = false, natural = null, total = null } = {}) {
  if (!charId || !skill) return;
  // Les clés de map (charId, skill) peuvent contenir accents/espaces → on passe
  // par des OBJETS imbriqués (pas des field-paths pointés) pour rester valide.
  const bucket = _statsBucket();
  const hasDetail = natural !== null && natural !== '' && total !== null && total !== ''
    && Number.isFinite(Number(natural)) && Number.isFinite(Number(total));
  const sk = () => ({
    rolls: increment(1),
    crits: increment(crit ? 1 : 0),
    fumbles: increment(fumble ? 1 : 0),
    trackedRolls: increment(hasDetail ? 1 : 0),
    naturalTotal: increment(hasDetail ? Number(natural) : 0),
    resultTotal: increment(hasDetail ? Number(total) : 0),
  });
  return bumpStats({ chars: { [charId]: {
    name: charName || '',
    skills: { [skill]: sk() },
    [bucket.field]: { [bucket.key]: { skills: { [skill]: sk() } } },
  } } });
}
