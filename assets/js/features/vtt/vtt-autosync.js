// ==============================================================================
// VTT — Auto-synchronisation des tokens
// ------------------------------------------------------------------------------
// Crée les tokens manquants pour chaque perso et PNJ de l'aventure (1 token par
// entité, pas de création manuelle), nettoie les doublons de réserve. Déclenchée
// quand chars + npcs + tokens sont tous chargés (marqueurs posés par les snapshots
// de vtt.js). Extrait de vtt.js (cf. docs/vtt-decomposition.md).
// ==============================================================================
import { VS } from './vtt-state.js';
import { STATE } from '../../core/state.js';
import { db, doc, writeBatch, serverTimestamp } from '../../config/firebase.js';
import { _tokRef, _toksCol } from './vtt-refs.js';
import { _tokenEntityKey } from './vtt-utils.js';
import { _renderTraySoon } from './vtt.js'; // circ. (rendu du tray, runtime)

let _autoSyncDone = false;   // empêche la double-création de tokens
export let _charsReady = false;
let _npcsReady = false, _toksReady = false;

// Marqueurs de disponibilité (appelés par les snapshots de vtt.js) : déclenchent
// la synchro quand chars + npcs + tokens sont tous chargés.
export function _markCharsReady() { _charsReady = true; _maybeSyncAutoTokens(); }
export function _markNpcsReady()  { _npcsReady  = true; _maybeSyncAutoTokens(); }
export function _markToksReady()  { _toksReady  = true; _maybeSyncAutoTokens(); }
export function _resetAutoSync()  { _autoSyncDone = false; _charsReady = false; _npcsReady = false; _toksReady = false; }

export function _maybeSyncAutoTokens() {
  if (!STATE.isAdmin || _autoSyncDone) return;
  if (!_charsReady || !_npcsReady || !_toksReady) return;
  _autoSyncDone = true;
  _syncAutoTokens();
}

let _reserveCleanupRunning = false;

export async function _cleanupReserveDuplicates() {
  if (!STATE.isAdmin || _reserveCleanupRunning) return;
  const seen = new Map();
  const duplicateIds = [];
  const reserve = Object.values(VS.tokens)
    .map(e => e.data)
    .filter(t => !t.pageId && _tokenEntityKey(t))
    .sort((a, b) => {
      const aAuto = a.id?.startsWith('auto_') ? 0 : 1;
      const bAuto = b.id?.startsWith('auto_') ? 0 : 1;
      return aAuto - bAuto || String(a.id).localeCompare(String(b.id));
    });
  for (const t of reserve) {
    const key = _tokenEntityKey(t);
    if (seen.has(key)) duplicateIds.push(t.id);
    else seen.set(key, t.id);
  }
  if (!duplicateIds.length) return;

  _reserveCleanupRunning = true;
  try {
    const batch = writeBatch(db);
    duplicateIds.forEach(id => batch.delete(_tokRef(id)));
    await batch.commit();
    duplicateIds.forEach(id => { VS.tokens[id]?.shape?.destroy(); delete VS.tokens[id]; });
    _renderTraySoon();
  } catch (e) {
    console.error('[vtt] cleanup reserve duplicates:', e);
  } finally {
    _reserveCleanupRunning = false;
  }
}

export async function _syncAutoTokens() {
  // ─ 1. Scanner les tokens existants : tokens orphelins + doublons réserve ─
  // Règle : un perso/PNJ peut avoir plusieurs tokens *placés* sur des pages
  // différentes (cf. _vttDuplicateOnPage), mais UN SEUL token en réserve
  // (pageId === null). Les doublons en réserve viennent de syncs concurrents
  // historiques (multi-tab / multi-admin) avant l'introduction des IDs
  // déterministes ci-dessous.
  const hasAnyToken     = new Set();  // 'c:<id>' | 'n:<id>' : a au moins 1 token
  const reserveSeen     = new Map();  // 'c:<id>' | 'n:<id>' → 1er token réserve gardé
  const toDelete        = [];
  const toFixOwner      = [];         // { id, ownerId } : ownerId désynchro de character.uid

  for (const { data } of Object.values(VS.tokens)) {
    let key = null;
    if (data.characterId) key = 'c:' + data.characterId;
    else if (data.npcId)  key = 'n:' + data.npcId;
    if (!key) continue;

    // Orphelin : l'entité a été supprimée → drop quoi qu'il arrive
    if (data.characterId && !VS.characters[data.characterId]) { toDelete.push(data.id); continue; }
    if (data.npcId       && !VS.npcs[data.npcId])             { toDelete.push(data.id); continue; }

    hasAnyToken.add(key);

    // Réconciliation propriétaire : le token d'un perso doit refléter
    // character.uid (réassignation de compte / correction d'association),
    // sinon le joueur n'est pas reconnu « en ligne » et ne peut pas bouger son
    // token (la règle vttTokens compare ownerId à l'uid).
    if (data.characterId) {
      const want = VS.characters[data.characterId]?.uid || null;
      if ((data.ownerId || null) !== want) toFixOwner.push({ id: data.id, ownerId: want });
    }

    // Doublons réserve : on garde le 1er rencontré, on drop les autres
    if (!data.pageId) {
      if (reserveSeen.has(key)) toDelete.push(data.id);
      else                      reserveSeen.set(key, data);
    }
  }

  // ─ 2. Identifier les entités sans aucun token → à créer ──────────────
  const toCreate = [];
  for (const c of Object.values(VS.characters)) {
    if (!hasAnyToken.has('c:' + c.id)) toCreate.push({
      detId: `auto_c_${c.id}`,
      name: c.nom || 'Personnage', type: 'player',
      characterId: c.id, npcId: null, beastId: null, ownerId: c.uid || null,
    });
  }
  for (const n of Object.values(VS.npcs)) {
    if (!hasAnyToken.has('n:' + n.id)) toCreate.push({
      detId: `auto_n_${n.id}`,
      name: n.nom || 'PNJ', type: 'npc',
      characterId: null, npcId: n.id, beastId: null, ownerId: null,
    });
  }
  // Les ennemis ne sont PAS auto-créés depuis le bestiaire : ils sont placés
  // manuellement depuis la section Bestiaire du tray.

  if (!toCreate.length && !toDelete.length && !toFixOwner.length) return;

  const batch = writeBatch(db);
  for (const { detId, ...base } of toCreate) {
    // ID déterministe (auto_c_<id> / auto_n_<id>) : si deux syncs concurrents
    // (multi-tab, multi-admin) créent en même temps, `batch.set` écrase au
    // lieu de dupliquer → garantie d'unicité au niveau Firestore.
    batch.set(doc(_toksCol(), detId), {
      ...base,
      pageId: null, col: 0, row: 0,
      visible: false, imageUrl: null,
      movement: null, range: 1, attack: null, defense: null,
      hp: null, hpMax: null,
      movedThisTurn: false, attackedThisTurn: false, bonusActionThisTurn: false, reactionThisTurn: false,
      createdAt: serverTimestamp(),
    });
  }
  for (const id of new Set(toDelete)) batch.delete(_tokRef(id));
  for (const { id, ownerId } of toFixOwner) batch.update(_tokRef(id), { ownerId });
  await batch.commit().catch(e => console.error('[vtt] auto-sync tokens:', e));
}

