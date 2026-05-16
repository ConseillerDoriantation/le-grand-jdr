// ═══════════════════════════════════════════════════════════════════
// VTT — Table de Jeu Virtuelle
//
// PRINCIPE : chaque personnage ET chaque PNJ possède déjà son token.
// Pas de création manuelle — les tokens sont auto-générés et resten
// en sync bidirectionnel avec les fiches (HP, nom, photo).
// ═══════════════════════════════════════════════════════════════════

import { STATE } from '../core/state.js';
import Sortable from '../vendor/sortable.esm.js';
import { getCurrentAdventureId, getDocData, saveDoc, loadCollection } from '../data/firestore.js';
import {
  db, doc, getDoc, collection, addDoc, updateDoc, deleteDoc,
  setDoc, onSnapshot, serverTimestamp, writeBatch,
} from '../config/firebase.js';
import { getMod, getModFromScore, calcVitesse, calcCA, calcPVMax, calcPMMax, getMaitriseBonus, statShort, computeEquipStatsBonus, getItemStatBonus } from '../shared/char-stats.js';
import { getArmorSetData } from './characters/data.js';
import { loadWeaponFormats } from '../shared/weapon-formats.js';
import { loadDamageTypes, getDamageTypeRules, getDamageTypeById } from '../shared/damage-types.js';
import { loadSpellMatrices, getInvokedArm } from '../shared/spell-matrices.js';
import { showNotif } from '../shared/notifications.js';
import {
  fogInit, fogSetPgRef, fogUpdate, fogUpdateSoon, fogRenderWalls,
  fogIsEditMode, fogToggleEditMode, fogSetEditTool, fogWallBlocksPath,
} from './vtt-fog.js';
import { openModal, closeModalDirect, confirmModal } from '../shared/modal.js';
import { _esc } from '../shared/html.js';
import { lsJson } from '../shared/local-storage.js';
import { DICE_SKILLS_DEFAULT, DICE_SKILLS_STORAGE_KEY } from '../shared/dice-skills.js';
import PAGES from './pages.js';

// ── Constantes ──────────────────────────────────────────────────────
const CELL        = 70;
const MIN_SCALE   = 0.15;
const MAX_SCALE   = 4;

const TYPE_COLOR  = { player:'#4f8cff', enemy:'#ef4444', npc:'#a78bfa' };
const hpColor     = r => r > 0.5 ? '#22c38e' : r > 0.25 ? '#f59e0b' : '#ef4444';

// ── État module ─────────────────────────────────────────────────────
let _stage   = null, _layers = {}, _unsubs = [], _resizeObs = null;
let _session = {}, _pages = {}, _tokens = {};
let _characters = {};   // characterId → character doc
let _npcs       = {};   // npcId → npc doc
let _bestiary   = {};   // beastId → creature doc (bestiaire)
let _bstTracker = {};   // creatureId → tracker joueur (pvActuel, pmActuel, caEstimee…)
let _activePage = null;
let _tool       = 'select';
let _selected   = null, _attackSrc = null, _moveHL = [];
let _mtCtx      = null; // contexte multi-cibles actif { srcId, opt, optIdx, targets[], maxTargets, lines Map }
let _mtPending  = null; // cibles validées en attente du roll : string[]
let _zoneCtx    = null; // contexte zone AoE { srcId, tgtId, opt, optIdx, wPx, hPx, x, y, placed }
let _zonePreview= null; // Konva.Group prévisualisation zone
let _selectedMulti  = new Set();   // ids des tokens en multi-sélection
let _multiDragOrigin= null;        // { [id]: {x,y} } positions au début du drag groupé
let _middlePanActive= false;       // true pendant le pan caméra au clic molette
let _suppressTokenClickUntil = 0;   // bloque le click synthétique après clic droit/molette
let _autoSyncDone = false;   // empêche la double-création de tokens
let _weaponFormats = null;   // cache formats d'armes (damageType, etc.)
let _damageTypes   = null;   // cache types de dégâts (règles de combat)
let _spellMatrices = null;   // cache matrices MJ (armes invoquées, combos config)
let _imgTr      = null;      // Transformer pour images BG (sous tokens)
let _imgTrFg    = null;      // Transformer pour images FG (au-dessus des tokens)
let _selImg     = null;      // id de l'image sélectionnée
let _mapMode    = false;     // true = édition carte activée (images déplaçables)
let _emotes     = [];        // [{id, name, url}] chargées depuis world/vtt_emotes
// ── Bibliothèque de cartes ─────────────────────────────────────────
let _mapLib      = { folders: [], images: [] };
let _mapLibUnsub = null;
let _libFolder   = null;   // null = racine, string = folderId ouvert
let _libOpen     = true;   // section collapsible dans le tray
const _mapLibRef = () => doc(db, `adventures/${_aid()}/vtt/mapLibrary`);

// ── Butin ─────────────────────────────────────────────────────────
let _loot            = { stash: [], loot: [] };
let _lootUnsub       = null;
let _lootCloseOutside = null;
const _lootRef  = () => doc(db, `adventures/${_aid()}/vtt/loot`);
// ── Lanceur de dés libre ───────────────────────────────────────────
let _diceFormula   = {};        // { faces→count } ex: { 20:2, 6:1 }
let _diceFreeBonus = 0;
let _diceFreeMode  = 'normal';  // 'advantage'|'normal'|'disadvantage'
let _diceCloseOut  = null;
let _diceSkills = [];        // [{name, stat}] chargées depuis world/dice_skills
// — Musique / sons
let _sounds        = [];     // [{id, name, url, createdAt}]
let _playlists     = [];     // [{id, name, color, soundIds[]}]
let _musicState    = {};     // état Firestore courant
let _audioEl       = null;   // HTMLAudioElement actif
let _musicTab      = 'sons'; // 'sons' | 'playlists'
let _musicSearch   = { sons: '', playlists: '' }; // filtre par onglet, persisté en session
let _musicCloseOut = null;
let _musicProgTimer = null;
let _musicSortables = [];   // instances Sortable actives
let _previewEl     = null;  // aperçu local MJ (non diffusé)
let _rollMode   = 'normal';  // 'advantage' | 'normal' | 'disadvantage'
let _rollBonus  = 0;         // bonus contextuel temporaire (anneau, sort, etc.)
const _renderedPings     = new Set();
const _renderedReactions = new Set();

// ── Outils de dessin & règle ────────────────────────────────────────
const CELL_M = 1.5;          // 1 case = 1.5 mètre
let _annotations      = {};   // id → { data, shape }
let _selectedAnnotId  = null; // id de l'annotation sélectionnée (sélection simple)
let _selectedAnnotIds = new Set(); // multi-sélection annotations
let _annotTransformer = null; // Konva Transformer pour resize/rotation
let _annotGroupDragOrigins = null; // { [id]: {x,y} } pour déplacement groupé annotations
let _skipAnnotRebuild = new Set(); // ids dont le onSnapshot doit sauter le rebuild (transform local)

// Marquee (lasso rectangle)
let _marqueeActive  = false;
let _marqueeOrigin  = null;   // world coords du départ
let _marqueeLastWp  = null;   // dernière position pendant le drag
let _marqueeShape   = null;   // Konva Rect visuel
let _suppressNextClick = false; // empêche le click de désélectionner après un marquee

// Ping (remonté au niveau module pour accès depuis les fonctions externes)
let _pingTimer  = null;
let _pingOrigin = null;
let _drawHistory  = [];      // ids des annotations créées dans la session (pour Ctrl+Z)
let _drawing      = false;   // tracé en cours
let _drawPts      = [];      // points crayon libre (world coords)
let _drawOrigin   = null;    // point de départ pour formes
let _drawLive     = null;    // forme Konva live (avant sauvegarde)
let _drawColor    = '#ef4444';
let _drawWidth    = 2;
let _drawShape    = 'pencil'; // 'pencil'|'line'|'rect'|'circle'
let _drawFill     = false;
let _rulerActive  = false;
let _rulerOrigin  = null;
let _rulerHideTimer = null;

// Mapping abréviation compétence → clé getMod
const _STAT_KEY = { FOR:'force', DEX:'dexterite', CON:'constitution', INT:'intelligence', SAG:'sagesse', CHA:'charisme' };
const _STAT_COLOR = { FOR:'#ef4444', DEX:'#22c38e', CON:'#f59e0b', INT:'#4f8cff', SAG:'#b47fff', CHA:'#fd6c9e' };
const _STAT_RGB   = { FOR:'239,68,68', DEX:'34,195,142', CON:'245,158,11', INT:'79,140,255', SAG:'180,127,255', CHA:'253,108,158' };
const _MS_STATS   = [
  { key:'force',        abbr:'FOR' }, { key:'dexterite',    abbr:'DEX' },
  { key:'constitution', abbr:'CON' }, { key:'intelligence', abbr:'INT' },
  { key:'sagesse',      abbr:'SAG' }, { key:'charisme',     abbr:'CHA' },
];

const _numOr = (value, fallback = null) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};
const _signed = n => n > 0 ? `+${n}` : `${n}`;
const _npcStatScore = (npc, key) => _numOr(npc?.stats?.[key], 8);
const _npcStatMod = (npc, key) => getModFromScore(_npcStatScore(npc, key));
const _npcCombat = (npc = {}) => npc?.combat || {};
const _tokenStatMod = (t, statKey) => {
  if (!t || !statKey) return 0;
  if (t.characterId) {
    const c = _characters[t.characterId];
    return c ? getMod(c, statKey) : 0;
  }
  if (t.npcId) return _npcStatMod(_npcs[t.npcId] || {}, statKey);
  if (t.beastId) {
    const b = _bestiary[t.beastId];
    const score = b?.stats?.[statKey] ?? 10;
    return Math.floor((Math.min(22, score) - 10) / 2);
  }
  return 0;
};

// ── État présence & mini-fiche ──────────────────────────────────────
let _presence     = {};   // uid → { uid, pseudo }
let _presHeartbeat= null; // intervalId du heartbeat
let _presRefresh  = null; // intervalId du rafraîchissement présence
let _emoteCloseOutside = null; // listener mousedown fermeture picker émotes
let _trayReserveOpen  = false; // section réserve ouverte/fermée dans le tray MJ
let _trayFilter       = 'all'; // filtre actif : 'all'|'player'|'npc'|'enemy'
let _miniUid      = null; // uid du joueur dont la mini-fiche est ouverte
let _miniCharId   = null; // characterId sélectionné dans la mini-fiche
let _miniTab      = 'combat'; // onglet actif de la mini-fiche

// ── Timer de session ────────────────────────────────────────────────
// Stocké dans _session.timer = { startedAt:ms, accumulated:ms, running:bool, label:string }
let _timerTick = null; // intervalId pour rafraîchir l'affichage

// ── Combat tracker (overlay haut-gauche sur le canvas) ──────────────
let _combatTab = 'allies'; // 'allies' (joueurs + PNJ) | 'enemies' (MJ only)

// ── Refs Firestore ──────────────────────────────────────────────────
const _aid     = ()   => getCurrentAdventureId();
const _sesRef  = ()   => doc(db,  `adventures/${_aid()}/vtt/session`);
const _pgsCol  = ()   => collection(db, `adventures/${_aid()}/vttPages`);
const _toksCol = ()   => collection(db, `adventures/${_aid()}/vttTokens`);
const _chrsCol = ()   => collection(db, `adventures/${_aid()}/characters`);
const _npcsCol = ()   => collection(db, `adventures/${_aid()}/npcs`);
const _pgRef   = (id) => doc(db, `adventures/${_aid()}/vttPages/${id}`);
const _tokRef  = (id) => doc(db, `adventures/${_aid()}/vttTokens/${id}`);
const _chrRef  = (id) => doc(db, `adventures/${_aid()}/characters/${id}`);
const _npcRef  = (id) => doc(db, `adventures/${_aid()}/npcs/${id}`);
const _bstCol        = ()    => collection(db, `adventures/${_aid()}/bestiary`);
const _bstTrackerRef = (uid) => doc(db, `adventures/${_aid()}/bestiary_tracker/${uid}`);
const _logCol      = ()  => collection(db, `adventures/${_aid()}/vttLog`);
const _castingCol  = ()  => collection(db, `adventures/${_aid()}/vttCasting`);
const _castingRef  = uid => doc(db, `adventures/${_aid()}/vttCasting/${uid}`);
const _pingsCol     = ()  => collection(db, `adventures/${_aid()}/vttPings`);
const _pingRef      = uid => doc(db, `adventures/${_aid()}/vttPings/${uid}`);
const _reactionsCol = ()  => collection(db, `adventures/${_aid()}/vttEmoteReactions`);
const _reactionRef  = uid => doc(db, `adventures/${_aid()}/vttEmoteReactions/${uid}`);
const _annotCol      = ()  => collection(db, `adventures/${_aid()}/vttAnnotations`);
const _annotRef      = id  => doc(db, `adventures/${_aid()}/vttAnnotations/${id}`);
const _sonsCol       = ()  => collection(db, `adventures/${_aid()}/vttSons`);
const _sonRef        = id  => doc(db, `adventures/${_aid()}/vttSons/${id}`);
const _playlistsCol  = ()  => collection(db, `adventures/${_aid()}/vttPlaylists`);
const _playlistRef   = id  => doc(db, `adventures/${_aid()}/vttPlaylists/${id}`);
const _musicStateRef = ()  => doc(db, `adventures/${_aid()}/vtt/music`);

// ═══════════════════════════════════════════════════════════════════
// DONNÉES EFFECTIVES — fusion token + entité liée
// C'est ici que la sync temps réel prend tout son sens :
// HP/nom/image viennent toujours de la fiche source.
// ═══════════════════════════════════════════════════════════════════
function _live(t) {
  if (!t) return null;
  const c = t.characterId ? _characters[t.characterId] : null;
  const n = t.npcId       ? _npcs[t.npcId]             : null;
  const b = t.beastId     ? _bestiary[t.beastId]       : null;
  const e = c || n || b;

  if (!e) return {
    ...t,
    displayName:     t.name,
    displayImage:    t.imageUrl ?? null,
    displayHp:       t.hp    ?? 20,
    displayHpMax:    t.hpMax ?? 20,
    displayMovement: t.movement ?? 6,
    displayAttack:   t.attack   ?? 5,
    displayAttackDice: t.attackDice || '1d6',
    displayDefense:  t.defense  ?? 0,
    displayRange:    t.range    ?? 1,
    displayTokenW:   Math.max(1, Math.min(5, t.tokenW ?? t.tokenSize ?? 1)),
    displayTokenH:   Math.max(1, Math.min(5, t.tokenH ?? t.tokenSize ?? 1)),
  };

  const npcHpMax = n ? _numOr(e.pv, _numOr(e.hpMax, _numOr(e.pvMax, 20))) : null;
  const npcPmMax = n ? _numOr(e.pmMax, _numOr(e.pm, null)) : null;
  const npcPmCur = n ? _numOr(e.pmCurrent, npcPmMax) : null;
  const npcCombat = n ? _npcCombat(e) : {};
  const npcWeapon = npcCombat.weapon || {};

  const hpMax = c ? (calcPVMax(c) || c.pvBase || 20)
              : b ? (_numOr(b.pvMax, 20))
              : n ? npcHpMax
              : (_numOr(e.hpMax, _numOr(e.pvMax, _numOr(e.pv, 20))));

  // Pour les créatures du bestiaire : HP suivi sur le TOKEN (pas sur la fiche template)
  const hpCurrent = c ? (c.hp ?? hpMax)
                  : n ? (_numOr(n.hp, hpMax))
                  : (t.hp ?? hpMax); // bestiaire + tokens custom

  // Formule de dégâts : arme équipée > première attaque bestiary > override token > fallback
  const weapon      = c?.equipement?.['Main principale'];
  const weapStats   = weapon?.degatsStats?.length ? weapon.degatsStats : [weapon?.degatsStat || 'force'];
  const toucherStat = (weapon?.toucherStats?.[0] || weapon?.toucherStat || weapStats[0]);
  const weapMod     = c ? weapStats.reduce((sum, s) => sum + getMod(c, s), 0) : 0;
  const toucherMod  = c ? getMod(c, toucherStat) : 0;
  const setBonus    = c ? (getArmorSetData(c).modifiers.toucherBonus || 0) : 0;
  const weapDice  = weapon?.degats
    ? (weapMod !== 0 ? `${weapon.degats}${weapMod>0?'+':''}${weapMod}` : weapon.degats)
    : null;
  const beastDice = b?.attaques?.[0]?.degats || null;
  const npcDice   = npcWeapon.degats || npcCombat.damage || e.attackDice || null;
  const atkDice   = t.attackDice || weapDice || beastDice || npcDice
    || (c ? `1d6${weapMod>=0?'+':''}${weapMod}` : null)
    || (typeof t.attack==='string' ? t.attack : null)
    || '1d6';

  const result = {
    ...t,
    // Ennemis : le nom du token (instance) prime sur le nom générique du bestiaire
    // Joueurs/PNJ : le nom de la fiche prime (toujours à jour)
    displayName:       b ? (t.name || b.nom) : (e.nom || t.name),
    displayImage:      e.photoURL || e.photo || e.avatar || e.imageUrl || t.imageUrl || null,
    displayHp:         hpCurrent,
    displayHpMax:      hpMax,
    displayPm:         c ? (c.pm ?? calcPMMax(c)) : n ? npcPmCur : null,
    displayPmMax:      c ? calcPMMax(c) : n ? npcPmMax : null,
    displayMovement: (() => {
      const baseMv = t.movement ?? (c ? calcVitesse(c) : (b ? (_numOr(b.vitesse, 4)) : (_numOr(e.vitesse, _numOr(e.deplacement, 6)))));
      const r = _session?.combat?.round ?? 0;
      const moveDelta = (t.buffs || [])
        .filter(bf => (bf.type === 'move_bonus' || bf.type === 'move_debuff')
          && (bf.expiresAtRound == null || r === 0 || r <= bf.expiresAtRound))
        .reduce((sum, bf) => sum + (bf.bonus || 0), 0);
      return Math.max(0, baseMv + moveDelta);
    })(),
    displayAttack:     t.attack   ?? (c ? toucherMod+setBonus : (b ? (_numOr(b.attaques?.[0]?.toucher, 5)) : (_numOr(e.bonusAttaque, _numOr(e.attack, _numOr(npcWeapon.toucher, (npcWeapon.toucherStat || npcWeapon.statAttaque) ? _npcStatMod(e, npcWeapon.toucherStat || npcWeapon.statAttaque) : e.stats?.force != null ? _npcStatMod(e, 'force') : 5)))))),
    displayAttackDice: atkDice,
    displayDefense:    (t.defense ?? (c ? calcCA(c) : (b ? (_numOr(b.ca, 10)) : (_numOr(e.ca, _numOr(e.defense, 0)))))) + (() => {
      const r = _session?.combat?.round ?? 0;
      return (t.buffs || []).filter(bf => bf.type === 'ca' && (bf.expiresAtRound == null || r === 0 || r <= bf.expiresAtRound))
        .reduce((sum, bf) => sum + (bf.bonus || 0), 0);
    })(),
    _activeCaBuff: (() => {
      const r = _session?.combat?.round ?? 0;
      return (t.buffs || []).find(bf => bf.type === 'ca' && (bf.expiresAtRound == null || r === 0 || r <= bf.expiresAtRound)) || null;
    })(),
    // Pour un perso : arme équipée > override admin (t.range > 1) > défaut 1
    // Pour bestiaire/custom : t.range > 1ère attaque bestiary > défaut 1
    // Bonus de portée temporaire (buff range_bonus = Allonge magique etc.)
    displayRange: (() => {
      const baseRange = c
        ? (t.range > 1 ? t.range : (weapon?.portee ? parseInt(weapon.portee)||1 : 1))
        : b
          ? (t.range > 1 ? t.range : (_numOr(b.attaques?.[0]?.portee, 1)))
          : n
            ? (t.range > 1 ? t.range : (_numOr(npcCombat.range, _numOr(npcWeapon.portee, 1))))
            : (t.range ?? 1);
      const r = _session?.combat?.round ?? 0;
      const rangeBonus = (t.buffs || [])
        .filter(bf => bf.type === 'range_bonus' && (bf.expiresAtRound == null || r === 0 || r <= bf.expiresAtRound))
        .reduce((sum, bf) => sum + (bf.bonus || 0), 0);
      return baseRange + rangeBonus;
    })(),
    _beast:            b,   // référence directe pour _buildAttackOptions
    displayTokenW:     Math.max(1, Math.min(5, t.tokenW ?? t.tokenSize ?? b?.tokenW ?? b?.tokenSize ?? 1)),
    displayTokenH:     Math.max(1, Math.min(5, t.tokenH ?? t.tokenSize ?? b?.tokenH ?? b?.tokenSize ?? 1)),
  };

  // Joueur sur token ennemi : remplace HP et CA par les estimations du tracker.
  // Sans estimation = null → affichage "?/?" sur le token (ne révèle pas les vraies valeurs MJ).
  if (!STATE.isAdmin && t.type === 'enemy') {
    if (b) {
      const track  = _bstTracker[t.beastId] || {};
      const estMax = track.pvActuel !== undefined ? parseInt(track.pvActuel) : null;
      if (estMax !== null) {
        // pvCombatHp est stocké sur le token lui-même (écrit lors des attaques joueur).
        // Tous les clients le reçoivent via le onSnapshot vttTokens existant.
        // null → token frais ou jamais frappé par un joueur → afficher pleins PV estimés.
        const pvCombatHp = t.pvCombatHp != null
          ? Math.max(0, parseInt(t.pvCombatHp) || 0) : null;
        if (pvCombatHp !== null) {
          result.displayHp = pvCombatHp;           // suivi de groupe via token (prioritaire)
        } else if (t.hp !== null) {
          result.displayHp = Math.min(hpCurrent, estMax); // HP réel borné à l'estimation
        } else {
          result.displayHp = estMax;               // token frais = pleins PV estimés
        }
        result.displayHpMax = estMax;
      } else {
        result.displayHp    = null;
        result.displayHpMax = null;
      }
      if (track.caEstimee !== undefined) result.displayDefense = parseInt(track.caEstimee) || 0;
    } else {
      // Ennemi sans fiche bestiaire → HP toujours inconnus pour les joueurs
      result.displayHp    = null;
      result.displayHpMax = null;
    }
  }

  return result;
}

// HP écrit sur la fiche source (bidirectionnel)
async function _setHp(t, newHp) {
  const v = Math.max(0, newHp);
  if (t.characterId) await updateDoc(_chrRef(t.characterId), { hp: v });
  else if (t.npcId)  await updateDoc(_npcRef(t.npcId),       { hp: v });
  else               await updateDoc(_tokRef(t.id),          { hp: v });
}

/**
 * Déclenche un JS Sa de concentration auto sur tous les buffs canalisés du token
 * qui vient de subir des dégâts. À appeler depuis tout point qui inflige des dégâts
 * hors `_vttRollAttack` (édition manuelle, DoT, environnement…).
 * Retourne un tableau de notes pour log/notif.
 */
async function _vttTriggerConcentrationSave(td, damageAmount) {
  if (!td || damageAmount <= 0) return [];
  const buffs = (td.buffs || []).filter(b => b?.canalisePersistant && b?.concentrationDD != null);
  if (!buffs.length) return [];
  const sagMod = _tokenStatMod(td, 'sagesse');
  const tgtName = _live(td).displayName ?? td.name;
  const notes = [];
  let removed = [];
  for (const cb of buffs) {
    const dd = cb.concentrationDD;
    const roll = Math.floor(Math.random() * 20) + 1;
    const tot = roll + sagMod;
    const success = roll === 20 || (roll !== 1 && tot >= dd);
    const rollStr = `JS Sa ${roll}${sagMod>=0?'+':''}${sagMod}=${tot} vs DD${dd}`;
    if (success) {
      notes.push(`🧠 ${rollStr} · ${cb.sortLabel} tenu (${tgtName})`);
    } else {
      notes.push(`💢 ${rollStr} ÉCHEC · ${cb.sortLabel} rompu sur ${tgtName}`);
      removed.push(cb);
      // Supprime les summons canalisés liés
      const summonsToKill = Object.values(_tokens).filter(e =>
        e?.data?.summonOwnerId === (cb.casterId || td.id) && e?.data?.summonCanalise
      );
      for (const s of summonsToKill) await deleteDoc(_tokRef(s.data.id)).catch(() => {});
    }
  }
  if (removed.length) {
    const remaining = (td.buffs || []).filter(b => !removed.includes(b));
    await updateDoc(_tokRef(td.id), { buffs: remaining }).catch(() => {});
  }
  return notes;
}

// ═══════════════════════════════════════════════════════════════════
// AUTO-SYNC TOKENS — crée les tokens manquants pour persos et PNJ
// ═══════════════════════════════════════════════════════════════════
let _charsReady = false, _npcsReady = false, _toksReady = false, _bstsReady = false;

function _maybeSyncAutoTokens() {
  if (!STATE.isAdmin || _autoSyncDone) return;
  if (!_charsReady || !_npcsReady || !_toksReady || !_bstsReady) return;
  _autoSyncDone = true;
  _syncAutoTokens();
}

async function _syncAutoTokens() {
  // Index des entités déjà tokenisées
  const byChar  = new Set();
  const byNpc   = new Set();
  for (const { data } of Object.values(_tokens)) {
    if (data.characterId) byChar.add(data.characterId);
    if (data.npcId)       byNpc.add(data.npcId);
  }

  const toCreate = [];
  const toDelete = []; // tokens orphelins (personnage/PNJ supprimé)

  for (const c of Object.values(_characters)) {
    if (!byChar.has(c.id)) toCreate.push({
      name: c.nom || 'Personnage', type: 'player',
      characterId: c.id, npcId: null, beastId: null, ownerId: c.uid || null,
    });
  }
  for (const n of Object.values(_npcs)) {
    if (!byNpc.has(n.id)) toCreate.push({
      name: n.nom || 'PNJ', type: 'npc',
      characterId: null, npcId: n.id, beastId: null, ownerId: null,
    });
  }
  // Les ennemis ne sont PAS auto-créés depuis le bestiaire :
  // ils sont placés manuellement depuis la section Bestiaire du tray.

  // Tokens orphelins : personnage ou PNJ introuvable
  for (const { data } of Object.values(_tokens)) {
    if      (data.characterId && !_characters[data.characterId]) toDelete.push(data.id);
    else if (data.npcId       && !_npcs[data.npcId])             toDelete.push(data.id);
  }

  if (!toCreate.length && !toDelete.length) return;

  const batch = writeBatch(db);
  for (const base of toCreate) {
    const ref = doc(_toksCol());
    batch.set(ref, {
      ...base,
      pageId: null, col: 0, row: 0,
      visible: false, imageUrl: null,
      movement: null, range: 1, attack: null, defense: null,
      hp: null, hpMax: null,
      movedThisTurn: false, attackedThisTurn: false,
      createdAt: serverTimestamp(),
    });
  }
  for (const id of toDelete) batch.delete(_tokRef(id));
  await batch.commit().catch(e => console.error('[vtt] auto-sync tokens:', e));
}

// ═══════════════════════════════════════════════════════════════════
// KONVA — chargement dynamique CDN
// ═══════════════════════════════════════════════════════════════════
async function _loadKonva() {
  if (window.Konva) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = './assets/js/vendor/konva-10.3.0.min.js';
    s.onload = res; s.onerror = () => rej(new Error('Konva.js introuvable'));
    document.head.appendChild(s);
  });
}

// ═══════════════════════════════════════════════════════════════════
// NETTOYAGE
// ═══════════════════════════════════════════════════════════════════
function _cleanup() {
  _unsubs.forEach(u => u?.());
  _unsubs = []; _stage?.destroy(); _stage = null; _layers = {};
  _resizeObs?.disconnect(); _resizeObs = null;
  if (_presHeartbeat) {
    clearInterval(_presHeartbeat); _presHeartbeat = null;
    // Supprimer le doc de présence immédiatement pour que les autres voient le départ
    const _uid = STATE.user?.uid;
    if (_uid) { try { deleteDoc(_pingRef(_uid)).catch(()=>{}); } catch(e){} }
  }
  if (_presRefresh)      { clearInterval(_presRefresh);    _presRefresh   = null; }
  _timerStopTick();
  if (_emoteCloseOutside){ document.removeEventListener('mousedown', _emoteCloseOutside, true); _emoteCloseOutside = null; }
  if (_mapLibUnsub) { _mapLibUnsub(); _mapLibUnsub = null; }
  _mapLib = { folders: [], images: [] }; _libFolder = null;
  if (_lootUnsub) { _lootUnsub(); _lootUnsub = null; }
  if (_lootCloseOutside) { document.removeEventListener('mousedown', _lootCloseOutside, true); _lootCloseOutside = null; }
  _loot = { stash: [], loot: [] };
  _mtClear(true);
  _presence = {}; _miniUid = null; _miniCharId = null;
  _tokens = {}; _pages = {}; _characters = {}; _npcs = {}; _bestiary = {}; _bstTracker = {};
  _session = {}; _activePage = null; _selected = null; _attackSrc = null;
  _moveHL = []; _autoSyncDone = false; _renderedPings.clear(); _renderedReactions.clear();
  _selectedMulti.clear(); _multiDragOrigin = null;
  _annotations = {}; _drawing = false; _drawLive = null; _drawHistory = [];
  _selectedAnnotId = null; _selectedAnnotIds.clear(); _annotTransformer = null;
  _annotGroupDragOrigins = null;
  _marqueeActive = false; _marqueeOrigin = null; _marqueeLastWp = null;
  _marqueeShape = null; _suppressNextClick = false;
  _pingTimer = null; _pingOrigin = null;
  _rulerActive = false; _rulerOrigin = null; _rulerNodes = null; _rulerLastCell = null; _rulerHoverDot = null;
  if (_rulerHideTimer) { clearTimeout(_rulerHideTimer); _rulerHideTimer = null; }
  if (_mjRulerPendingTimer) { clearTimeout(_mjRulerPendingTimer); _mjRulerPendingTimer = null; }
  _mjRulerLastWrite = 0; _mjRulerBroadcasting = false; _mjRulerRemote = null;
  _charsReady = false; _npcsReady = false; _toksReady = false; _bstsReady = false;
  _imgTr = null; _imgTrFg = null; _selImg = null; _mapMode = false;
  _hideCtxMenu();
  document.removeEventListener('keydown', _keyHandler);
  const mc = document.getElementById('main-content');
  if (mc) { mc.style.overflow = ''; mc.style.height = ''; mc.style.paddingBottom = ''; }
}

// ═══════════════════════════════════════════════════════════════════
// CANVAS
// ═══════════════════════════════════════════════════════════════════
function _initCanvas(container) {
  const K = window.Konva;
  K.dragButtons = [0, 2]; // Drag autorisé au clic gauche et droit (tokens/images/annotations).
  _stage = new K.Stage({ container, width: container.clientWidth, height: container.clientHeight });
  // Konva recommande max 3-5 layers. On consolide bg+map dans `backLayer` et
  // mapFg+ping dans `frontLayer` via des Konva.Group — l'ordre interne préserve
  // le z-order, et chaque "_layers.X" garde son API (add/find/destroyChildren/listening).
  // batchDraw() est forwardé vers le layer parent.
  // Ordre visuel : bg → map → grid → draw → token → mapFg → ping (5 layers Konva).
  const backLayer  = new K.Layer();
  const frontLayer = new K.Layer();
  const _asLayer = (group, parentLayer) => {
    group.batchDraw = () => parentLayer.batchDraw();
    return group;
  };
  _layers.bg    = _asLayer(new K.Group({ listening: false }), backLayer);
  _layers.map   = _asLayer(new K.Group({ listening: false }), backLayer);
  _layers.grid  = new K.Layer({ listening: true });
  _layers.draw  = new K.Layer();                     // annotations (entre grille et tokens)
  _layers.walls = new K.Layer({ listening: true });  // murs/portes/fenêtres/lumières
  _layers.token = new K.Layer();
  _layers.fog   = new K.Layer({ listening: false }); // masque de brouillard
  _layers.mapFg = _asLayer(new K.Group({ listening: false }), frontLayer);
  _layers.ping  = _asLayer(new K.Group({ listening: false }), frontLayer);
  backLayer.add(_layers.bg, _layers.map);
  frontLayer.add(_layers.mapFg, _layers.ping);
  // fog AVANT walls : les murs/portes/lumières restent toujours lisibles au-dessus du brouillard
  _stage.add(backLayer, _layers.grid, _layers.draw, _layers.token, _layers.fog, _layers.walls, frontLayer);
  fogInit(_stage, _layers, CELL);
  fogSetPgRef(id => _pgRef(id));

  // Transformers pour redimensionner les images (MJ uniquement)
  if (STATE.isAdmin) {
    const trCfg = {
      rotateEnabled: false, keepRatio: false,
      borderStroke: '#4f8cff', borderStrokeWidth: 2,
      anchorStroke: '#4f8cff', anchorFill: '#fff',
      anchorSize: 10, anchorCornerRadius: 3,
    };
    _imgTr   = new K.Transformer(trCfg); _layers.map.add(_imgTr);
    _imgTrFg = new K.Transformer(trCfg); _layers.mapFg.add(_imgTrFg);
  }

  // Transformer annotations — disponible pour tous (chaque joueur interagit avec ses propres dessins)
  _annotTransformer = new K.Transformer({
    rotateEnabled: true, keepRatio: false,
    borderStroke: '#ffe600', borderStrokeWidth: 1,
    anchorStroke: '#ffe600', anchorFill: '#1a1a2e', anchorSize: 8, anchorCornerRadius: 2,
  });
  _layers.draw.add(_annotTransformer);

  // Listener natif window : règle + marquee (bypass Konva, garanti même hors drag)
  const _nativeMoveHandler = e => {
    if (!_stage) return;
    const rect = container.getBoundingClientRect();
    const inCanvas = e.clientX >= rect.left && e.clientX <= rect.right &&
                     e.clientY >= rect.top  && e.clientY <= rect.bottom;
    const wp = inCanvas
      ? _stageToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      : null;

    // Règle (free-hover, reste dans le canvas)
    if (wp && _tool === 'ruler' && _rulerActive) _updateRuler(wp);
    else if (!wp && _rulerHoverDot) _hideRulerHover();

    // Marquee : suivi pendant le drag (peut sortir légèrement du canvas)
    if (_tool === 'select' && _marqueeOrigin) {
      const trackWp = wp ?? _marqueeLastWp; // utiliser la dernière pos connue si hors canvas
      if (!trackWp) return;
      if (!_marqueeActive) {
        const dx = trackWp.x - _marqueeOrigin.x, dy = trackWp.y - _marqueeOrigin.y;
        if (Math.hypot(dx, dy) > 8) {
          _marqueeActive = true;
          if (_pingTimer) { clearTimeout(_pingTimer); _pingTimer = null; }
          _clearMultiSelect();
          _deselectAnnot();
          const K = window.Konva;
          _marqueeShape = new K.Rect({
            x: _marqueeOrigin.x, y: _marqueeOrigin.y, width: 0, height: 0,
            stroke: '#4f8cff', strokeWidth: 1.5, fill: 'rgba(79,140,255,0.1)',
            dash: [6, 3], listening: false, name: 'marquee',
          });
          _layers.ping.add(_marqueeShape);
        }
      }
      if (_marqueeActive && wp) {
        _marqueeLastWp = wp;
        const x = Math.min(_marqueeOrigin.x, wp.x), y = Math.min(_marqueeOrigin.y, wp.y);
        _marqueeShape?.setAttrs({ x, y,
          width:  Math.abs(wp.x - _marqueeOrigin.x),
          height: Math.abs(wp.y - _marqueeOrigin.y) });
        _layers.ping?.batchDraw();
      }
    }
  };
  window.addEventListener('mousemove', _nativeMoveHandler);
  _unsubs.push(() => window.removeEventListener('mousemove', _nativeMoveHandler));

  _stage.on('wheel', e => {
    e.evt.preventDefault();
    const old = _stage.scaleX();
    const dir = e.evt.deltaY < 0 ? 1 : -1;
    const sc  = Math.min(MAX_SCALE, Math.max(MIN_SCALE, old * (1 + dir * 0.1)));
    const ptr = _stage.getPointerPosition();
    _stage.scale({ x:sc, y:sc });
    _stage.position({ x: ptr.x - (ptr.x-_stage.x())*(sc/old), y: ptr.y - (ptr.y-_stage.y())*(sc/old) });
  });

  let _pan = false, _po = null, _rightStageDown = null;

  // Pan caméra au clic molette. K.dragButtons=[0] empêche déjà tout drag de
  // tokens/images/annotations sur autre que clic gauche, donc pas besoin de
  // toucher .draggable() ici.
  const _startMiddlePan = e => {
    if (e.button !== 1) return;
    if (!_stage) return;
    e.preventDefault();
    if (_middlePanActive) return;

    _middlePanActive = true;
    _pan = true;
    _po = { x: e.clientX - _stage.x(), y: e.clientY - _stage.y() };

    const onMove = ev => {
      if ((ev.buttons & 4) === 0) { onUp(); return; }
      ev.preventDefault();
      _stage.position({ x: ev.clientX - _po.x, y: ev.clientY - _po.y });
    };
    const onUp = () => {
      _middlePanActive = false;
      _pan = false;
      _po = null;
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup',   onUp,   true);
      window.removeEventListener('blur',      onUp,   true);
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup',   onUp,   true);
    window.addEventListener('blur',      onUp,   true);
  };
  const _preventMiddleAuxClick = e => {
    if (e.button === 1) e.preventDefault();
  };
  container.addEventListener('mousedown', _startMiddlePan, true);
  container.addEventListener('auxclick',  _preventMiddleAuxClick, true);
  _unsubs.push(() => {
    container.removeEventListener('mousedown', _startMiddlePan, true);
    container.removeEventListener('auxclick',  _preventMiddleAuxClick, true);
  });

  _stage.on('mousedown', e => {
    if (fogIsEditMode()) return; // éditeur de murs gère ses propres events
    if (e.evt.button===2) {
      e.evt.preventDefault();
      // Règle : clic droit = annulation immédiate (en cours ou figée), sans changer d'outil.
      if (_tool === 'ruler' && (_rulerActive || _rulerNodes)) {
        _clearRuler();
        _rightStageDown = null;
        return;
      }
      // Pan caméra au clic droit UNIQUEMENT sur stage vide.
      // Sur un token/image/annotation, on laisse Konva gérer le drag (K.dragButtons=[0,2]).
      if (e.target === _stage) {
        _pan = true; _po = { x:e.evt.clientX-_stage.x(), y:e.evt.clientY-_stage.y() };
        _rightStageDown = { x:e.evt.clientX, y:e.evt.clientY };
      }
    }
    if (e.evt.button===0) {
      const rect0 = _stage.container().getBoundingClientRect();
      const np = { x: e.evt.clientX - rect0.left, y: e.evt.clientY - rect0.top };
      // Règle : 1er clic = départ, 2e clic = fin (pas besoin de maintenir)
      if (_tool === 'ruler') {
        if (_pingTimer) { clearTimeout(_pingTimer); _pingTimer = null; }
        const wp = _stageToWorld(np);
        if (!_rulerActive) _startRuler(wp);
        else               _endRuler();
        return;
      }
      // Dessin : cliquer-glisser
      if (_tool === 'draw') {
        if (_pingTimer) { clearTimeout(_pingTimer); _pingTimer = null; }
        _startDraw(_stageToWorld(np));
        return;
      }
      // Clic normal → ping (+ départ marquee en mode select)
      if (e.target===_stage) {
        if (_tool === 'select') _marqueeOrigin = _stageToWorld(np);
        _pingOrigin = { ...np };
        _pingTimer = setTimeout(() => {
          _pingTimer = null;
          if (_marqueeActive) return; // pas de ping si le lasso est en cours
          const sc = _stage.scaleX(), sp = _stage.position();
          _emitPing((_pingOrigin.x - sp.x) / sc, (_pingOrigin.y - sp.y) / sc);
        }, 300);
      }
    }
  });
  _stage.on('mousemove', e => {
    if (_pan && _po) _stage.position({ x:e.evt.clientX-_po.x, y:e.evt.clientY-_po.y });
    // Coordonnées canvas-relatives à partir de l'événement natif (plus fiable que getPointerPosition)
    const rect = _stage.container().getBoundingClientRect();
    const stagePtr = { x: e.evt.clientX - rect.left, y: e.evt.clientY - rect.top };
    if (_pingTimer && _pingOrigin) {
      const dx = stagePtr.x - _pingOrigin.x, dy = stagePtr.y - _pingOrigin.y;
      if (dx*dx + dy*dy > 64) { clearTimeout(_pingTimer); _pingTimer = null; }
    }
    const wp = _stageToWorld(stagePtr);
    if (_tool === 'ruler' && _rulerActive)      _updateRuler(wp);
    else if (_tool === 'ruler')                 _showRulerHover(wp);
    if (_tool === 'draw'  && _drawing && !_pan) _updateDraw(wp);
    if (_zoneCtx) _zoneUpdatePreview(wp);
  });
  _stage.on('mouseup', () => {
    _pan = false;
    if (_pingTimer) { clearTimeout(_pingTimer); _pingTimer = null; }
    if (_marqueeActive) { _endMarquee(); _suppressNextClick = true; }
    _marqueeOrigin = null;
    if (_tool === 'draw' && _drawing) _endDraw();
  });
  _stage.on('contextmenu', e => {
    e.evt.preventDefault();
    if (e.target !== _stage) return;
    if (_tool === 'ruler') return; // clic droit en mode règle = annulation, pas de désélection
    const moved = _rightStageDown
      ? Math.hypot(e.evt.clientX - _rightStageDown.x, e.evt.clientY - _rightStageDown.y) > 6
      : false;
    _rightStageDown = null;
    if (!moved) { _deselect(); _deselectAnnot(); }
  });
  _stage.on('click', e => {
    if (e.evt.button !== 0) return; // ignore middle/right (pan caméra)
    if (e.target===_stage) {
      if (_suppressNextClick) { _suppressNextClick = false; return; }
      if (_zoneCtx) { _zoneCtx.placed = !_zoneCtx.placed; return; }
      _deselect(); _deselectAnnot();
    }
  });

  _resizeObs = new ResizeObserver(() => {
    if (!_stage) return;
    _stage.width(container.clientWidth); _stage.height(container.clientHeight);
  });
  _resizeObs.observe(container);
}

function _drawGrid() {
  if (!_stage||!_activePage) return;
  const K = window.Konva;
  _layers.bg.destroyChildren();
  _layers.grid.find('Line').forEach(n=>n.destroy());
  const { cols, rows } = _activePage;
  const W=cols*CELL, H=rows*CELL;
  // Fond sur la couche bg (sous les images)
  _layers.bg.add(new K.Rect({ x:0,y:0,width:W,height:H,fill:'#12121f',listening:false }));
  _layers.bg.batchDraw();
  // Lignes de grille sur la couche grid (au-dessus des images)
  const s = { stroke:'rgba(255,255,255,0.22)',strokeWidth:1,listening:false };
  for (let c=0;c<=cols;c++) _layers.grid.add(new K.Line({ points:[c*CELL,0,c*CELL,H], ...s }));
  for (let r=0;r<=rows;r++) _layers.grid.add(new K.Line({ points:[0,r*CELL,W,r*CELL], ...s }));
  _layers.grid.batchDraw();
}

function _renderMapImages() {
  if (!_activePage) return;
  const K = window.Konva;
  // Nettoyer les images des deux couches (sans détruire les transformers)
  _layers.map.find('Image').forEach(n=>n.destroy());
  _layers.mapFg?.find('Image').forEach(n=>n.destroy());
  if (_imgTr)   { _imgTr.nodes([]);   }
  if (_imgTrFg) { _imgTrFg.nodes([]); }
  _selImg = null;

  for (const img of (_activePage.backgroundImages??[])) {
    const isFg   = img.layer === 'fg';
    const tgtLyr = isFg ? _layers.mapFg : _layers.map;
    const tr     = isFg ? _imgTrFg      : _imgTr;

    const el = new Image(); el.crossOrigin='anonymous';
    el.onload = () => {
      if (!_activePage) return; // page changée entre temps
      const ki = new K.Image({
        image:el, x:img.x*CELL, y:img.y*CELL,
        width:img.w*CELL, height:img.h*CELL,
        name:`img-${img.id}`,
      });

      if (STATE.isAdmin) {
        // Drag activé uniquement en mode édition carte
        ki.draggable(_mapMode);
        ki.on('dragmove', () => {
          ki.x(Math.round(ki.x()/CELL)*CELL);
          ki.y(Math.round(ki.y()/CELL)*CELL);
        });
        ki.on('dragend', () => {
          _patchImg(img.id, { x:Math.round(ki.x()/CELL), y:Math.round(ki.y()/CELL) });
        });

        // Clic → sélectionner l'image (seulement en mode édition carte)
        ki.on('click', e => {
          if (e.evt.button !== 0) return; // ignore middle/right (pan caméra)
          if (!_mapMode) return;
          e.cancelBubble = true;
          _tokens[_selected]?.shape?.findOne('.sel')?.visible(false);
          _selected=null; _clearHL(); _renderInspector(null); _layers.token.batchDraw();
          _selImg = img.id;
          // Vider l'autre transformer
          const otherTr = isFg ? _imgTr : _imgTrFg;
          otherTr?.nodes([]);
          if (tr?.getParent()) { tr.nodes([ki]); tr.moveToTop(); }
          tgtLyr.batchDraw();
        });

        // Fin de redimensionnement → snap + sauvegarde
        ki.on('transformend', () => {
          const w=Math.max(1,Math.round(ki.width()*ki.scaleX()/CELL));
          const h=Math.max(1,Math.round(ki.height()*ki.scaleY()/CELL));
          const x=Math.round(ki.x()/CELL), y=Math.round(ki.y()/CELL);
          ki.width(w*CELL); ki.height(h*CELL);
          ki.scaleX(1); ki.scaleY(1);
          ki.x(x*CELL); ki.y(y*CELL);
          tgtLyr.batchDraw();
          _patchImg(img.id, { x, y, w, h });
        });

        // Clic-droit → menu contextuel
        ki.on('contextmenu', e => {
          e.evt.preventDefault();
          if (!_mapMode) return;
          _showCtxMenu(e.evt.clientX, e.evt.clientY, [
            {
              label: isFg ? '⬇ Arrière-plan (sous les tokens)' : '⬆ Premier plan (au-dessus des tokens)',
              fn: () => _patchImg(img.id, { layer: isFg ? 'bg' : 'fg' }),
            },
            '---',
            {
              label: '🗑 Supprimer cette image',
              fn: () => {
                const imgs=(_activePage.backgroundImages??[]).filter(i=>i.id!==img.id);
                updateDoc(_pgRef(_activePage.id),{backgroundImages:imgs}).catch(()=>{});
              },
            },
          ]);
        });
      }

      tgtLyr.add(ki);
      if (tr?.getParent()) tr.moveToTop();
      tgtLyr.batchDraw();
    };
    el.src = img.url;
  }
}
async function _patchImg(imgId, patch) {
  if (!_activePage) return;
  await updateDoc(_pgRef(_activePage.id), {
    backgroundImages: (_activePage.backgroundImages??[]).map(i=>i.id===imgId?{...i,...patch}:i)
  }).catch(()=>{});
}

// ═══════════════════════════════════════════════════════════════════
// TOKENS — shapes Konva
// ═══════════════════════════════════════════════════════════════════
function _buildShape(t) {
  const K  = window.Konva;
  const ld = _live(t);
  const sw = ld.displayTokenW || 1, sh = ld.displayTokenH || 1;
  // Rayons ellipse (proportionnels à la bounding box) ; r = rayon vertical, sert d'ancre Y aux barres.
  const rx = CELL*sw*0.42, ry = CELL*sh*0.42, r = ry, bW = CELL*sw*0.9;
  const hpKnown = ld.displayHp !== null && ld.displayHpMax !== null;
  const hp  = hpKnown ? ld.displayHp  : 0;
  const hpm = hpKnown ? ld.displayHpMax : 1;
  const rat = hpKnown ? (hpm>0 ? Math.max(0,hp/hpm) : 1) : 0.5;
  const g = new K.Group({ x:t.col*CELL+sw*CELL/2, y:t.row*CELL+sh*CELL/2, id:`tok-${t.id}` });
  g.setAttr('tokenW', sw);
  g.setAttr('tokenH', sh);
  // ── Forme de base (ellipse, équivalente à un cercle quand W===H) ──
  g.add(new K.Ellipse({ radiusX:rx, radiusY:ry, fill:TYPE_COLOR[t.type]??'#888', opacity:.9 }));
  // ── Anneaux sélection / attaque ───────────────────────────────────
  g.add(new K.Ellipse({ radiusX:rx+4, radiusY:ry+4, stroke:'#fff',    strokeWidth:3, fill:'transparent',visible:false,name:'sel' }));
  g.add(new K.Ellipse({ radiusX:rx+4, radiusY:ry+4, stroke:'#ef4444', strokeWidth:3, dash:[5,3],fill:'transparent',visible:false,name:'atk' }));
  // ── Barre HP (texte superposé sur la barre) ───────────────────────
  const BH=9; // hauteur barre HP
  g.add(new K.Rect({ x:-bW/2, y:r+4, width:bW, height:BH, fill:'#0d1117', cornerRadius:4, listening:false }));
  g.add(new K.Rect({ x:-bW/2, y:r+4, width:Math.max(2,bW*rat), height:BH, fill:hpKnown?hpColor(rat):'#555', cornerRadius:4, listening:false, name:'hp-fill' }));
  g.add(new K.Text({ x:-bW/2, y:r+4, width:bW, height:BH, align:'center', verticalAlign:'middle',
    text:hpKnown?`${hp}/${hpm}`:'?/?', fontSize:8, fontStyle:'bold', fill:'#fff',
    shadowColor:'#000', shadowBlur:2, shadowOpacity:.9,
    fontFamily:'Inter,sans-serif', listening:false, name:'hp-val' }));
  // ── Barre PM (joueurs + PNJ avec PM renseignés, texte superposé) ──
  const _pm0=ld.displayPm;
  let _lblY=r+BH+8;
  if (_pm0!=null) {
    const pmMax0=ld.displayPmMax??1, pmRat0=pmMax0>0?Math.max(0,_pm0/pmMax0):1;
    const PMH=8;
    g.add(new K.Rect({ x:-bW/2, y:r+BH+6, width:bW, height:PMH, fill:'#0d1117', cornerRadius:4, listening:false }));
    g.add(new K.Rect({ x:-bW/2, y:r+BH+6, width:Math.max(2,bW*pmRat0), height:PMH, fill:'#9b6dff', cornerRadius:4, listening:false, name:'pm-fill' }));
    g.add(new K.Text({ x:-bW/2, y:r+BH+6, width:bW, height:PMH, align:'center', verticalAlign:'middle',
      text:`✨${_pm0}/${pmMax0}`, fontSize:7, fontStyle:'bold', fill:'#fff',
      shadowColor:'#000', shadowBlur:2, shadowOpacity:.9,
      fontFamily:'Inter,sans-serif', listening:false, name:'pm-val' }));
    _lblY=r+BH+PMH+10;
  }
  // ── Badge CA (coin haut-droit) + indicateur buff ─────────────────
  const _buff = ld._activeCaBuff;
  const _buffed = !!_buff;
  const _round  = _session?.combat?.round ?? 0;
  const _toursLeft = _buff
    ? (_buff.expiresAtRound != null && _round > 0 ? _buff.expiresAtRound - _round + 1 : _buff.totalDuration ?? '∞')
    : null;
  const _caX = rx*.7, _caY = -ry*.7;
  g.add(new K.Circle({ x:_caX, y:_caY, radius:10,
    fill: _buffed ? 'rgba(30,27,80,0.95)' : 'rgba(15,15,25,0.9)',
    stroke: _buffed ? '#818cf8' : '#64748b',
    strokeWidth: _buffed ? 2.5 : 1.5,
    listening:false, name:'ca-bg' }));
  g.add(new K.Text({ x:_caX-10, y:_caY-6, width:20, height:12,
    text:`🛡${ld.displayDefense??0}`, fontSize:9, fontStyle:'bold',
    fill: _buffed ? '#c4b5fd' : '#e2e8f0',
    fontFamily:'Inter,sans-serif', align:'center', listening:false, name:'ca-lbl' }));
  if (_buffed) {
    g.add(new K.Text({ x:_caX-10, y:_caY+5, width:20, height:9,
      text:`${_toursLeft}↺`, fontSize:7, fontStyle:'bold',
      fill:'#818cf8', fontFamily:'Inter,sans-serif', align:'center', listening:false, name:'ca-buff-turns' }));
  }
  // ── Nom ───────────────────────────────────────────────────────────
  g.add(new K.Text({ text:ld.displayName??t.name, x:-bW/2, y:_lblY,
    width:bW, align:'center', fontSize:11, fontStyle:'bold', fill:'#fff',
    fontFamily:'Inter,sans-serif', name:'lbl',
    shadowColor:'#000', shadowBlur:4, shadowOpacity:1 }));

  // ── Image clippée à l'ellipse (équivalent cercle quand W===H) ─────
  const imgSrc = ld.displayImage;
  if (imgSrc) {
    const clipGrp = new K.Group({ clipFunc: ctx => { ctx.ellipse(0,0,rx,ry,0,0,Math.PI*2,false); }, listening:false });
    const el=new Image(); el.crossOrigin='anonymous';
    el.onload = () => {
      clipGrp.add(new K.Image({ image:el, x:-rx, y:-ry, width:rx*2, height:ry*2, listening:false }));
      clipGrp.zIndex(2); _layers.token.batchDraw();
    };
    el.src = imgSrc;
    g.add(clipGrp); clipGrp.zIndex(2);
  }

  const canDrag = STATE.isAdmin || t.ownerId===STATE.user?.uid;
  let rightDown = null;
  if (canDrag) {
    g.draggable(true);
    g.on('mousedown', e => {
      if (e.evt.button === 2) rightDown = { x:e.evt.clientX, y:e.evt.clientY, dragged:false };
    });
    // ─ Début du drag : mémoriser les positions du groupe ─
    g.on('dragstart', () => {
      if (rightDown) rightDown.dragged = true;
      // En mode placement de zone ou de ciblage multi-cibles : pas de déplacement de token
      // (le sort doit rester prioritaire — un drag accidentel ne déplace pas le PJ)
      if (_zoneCtx || _mtCtx) {
        g.stopDrag();
        g.position({ x:t.col*CELL+sw*CELL/2, y:t.row*CELL+sh*CELL/2 });
        _layers.token?.batchDraw();
        return;
      }
      if (_middlePanActive) {
        g.stopDrag();
        g.position({ x:t.col*CELL+sw*CELL/2, y:t.row*CELL+sh*CELL/2 });
        _layers.token?.batchDraw();
        return;
      }
      if (_selectedMulti.has(t.id) && _selectedMulti.size>1) {
        _multiDragOrigin={};
        for (const id of _selectedMulti) {
          const s=_tokens[id]?.shape;
          if (s) _multiDragOrigin[id]={x:s.x(),y:s.y()};
        }
      } else { _multiDragOrigin=null; }
    });
    // ─ Pendant le drag : snap + déplacer le groupe ─
    g.on('dragmove', () => {
      if (rightDown) rightDown.dragged = true;
      const sx=Math.round((g.x()-sw*CELL/2)/CELL)*CELL+sw*CELL/2;
      const sy=Math.round((g.y()-sh*CELL/2)/CELL)*CELL+sh*CELL/2;
      g.position({x:sx,y:sy});
      if (_multiDragOrigin && _selectedMulti.has(t.id)) {
        const dx=sx-_multiDragOrigin[t.id].x, dy=sy-_multiDragOrigin[t.id].y;
        for (const [id,orig] of Object.entries(_multiDragOrigin)) {
          if (id===t.id) continue;
          const s=_tokens[id]?.shape; if (!s) continue;
          const d2=_tokenDims(_tokens[id].data);
          s.position({
            x:Math.round((orig.x+dx-d2.w*CELL/2)/CELL)*CELL+d2.w*CELL/2,
            y:Math.round((orig.y+dy-d2.h*CELL/2)/CELL)*CELL+d2.h*CELL/2,
          });
        }
        _layers.token.batchDraw();
      }
    });
    // ─ Fin du drag : commit Firestore ─
    g.on('dragend', async () => {
      const pg=_activePage; if (!pg) return;
      if (_multiDragOrigin && _selectedMulti.has(t.id) && _selectedMulti.size>1) {
        // Batch : sauver tous les tokens du groupe
        const batch=writeBatch(db);
        for (const id of _selectedMulti) {
          const s=_tokens[id]?.shape; if (!s) continue;
          const d2=_tokenDims(_tokens[id].data);
          const nc=Math.max(0,Math.min(pg.cols-d2.w,Math.round((s.x()-d2.w*CELL/2)/CELL)));
          const nr=Math.max(0,Math.min(pg.rows-d2.h,Math.round((s.y()-d2.h*CELL/2)/CELL)));
          s.position({x:nc*CELL+d2.w*CELL/2,y:nr*CELL+d2.h*CELL/2});
          batch.update(_tokRef(id),{col:nc,row:nr});
        }
        _layers.token.batchDraw();
        await batch.commit().catch(()=>showNotif('Erreur déplacement groupe','error'));
        _multiDragOrigin=null; return;
      }
      // Token seul
      const c=Math.max(0,Math.min(pg.cols-sw,Math.round((g.x()-sw*CELL/2)/CELL)));
      const r=Math.max(0,Math.min(pg.rows-sh,Math.round((g.y()-sh*CELL/2)/CELL)));
      if (!STATE.isAdmin && _session?.combat?.active) {
        const cur=_tokens[t.id]?.data;
        if (cur) {
          const d=Math.abs(c-cur.col)+Math.abs(r-cur.row);
          const maxMvt=(_live(cur).displayMovement??6)+(cur.bonusMvt||0);
          const rem=maxMvt-(cur.movedCells||0);
          if (d > rem) {
            showNotif(rem<=0 ? 'Plus de mouvement ce tour !' : `Trop loin ! (${rem} case${rem!==1?'s':''} restante${rem!==1?'s':''})`, 'error');
            g.position({x:cur.col*CELL+sw*CELL/2,y:cur.row*CELL+sh*CELL/2}); _layers.token.batchDraw(); return;
          }
        }
      }
      // Blocage par les murs (joueurs seulement)
      if (!STATE.isAdmin && (_activePage?.walls||[]).length) {
        const cur=_tokens[t.id]?.data;
        if (cur && fogWallBlocksPath(cur.col, cur.row, c, r, _activePage.walls)) {
          showNotif('🧱 Chemin bloqué !', 'error');
          g.position({x:cur.col*CELL+sw*CELL/2,y:cur.row*CELL+sh*CELL/2}); _layers.token.batchDraw(); return;
        }
      }
      g.position({x:c*CELL+sw*CELL/2,y:r*CELL+sh*CELL/2}); _layers.token.batchDraw();
      const patch={col:c,row:r};
      if (!STATE.isAdmin&&_session?.combat?.active) {
        const cur=_tokens[t.id]?.data;
        const d=Math.abs(c-(cur?.col??c))+Math.abs(r-(cur?.row??r));
        patch.movedCells=(cur?.movedCells||0)+d;
        patch.movedThisTurn=true;
      }
      await updateDoc(_tokRef(t.id),patch).catch(()=>showNotif('Erreur déplacement','error'));
      // Mise à jour optimiste + refresh des zones (déplacement et attaque)
      const _entry=_tokens[t.id];
      if (_entry?.data) {
        _entry.data.col=c; _entry.data.row=r;
        if (patch.movedCells!==undefined)   _entry.data.movedCells=patch.movedCells;
        if (patch.movedThisTurn!==undefined) _entry.data.movedThisTurn=patch.movedThisTurn;
      }
      _refreshRanges(t.id, _entry?.data);
      fogUpdateSoon(_activePage, _tokens, STATE.isAdmin);
    });
  }

  const _isAttackTargetInRange = (srcId, tgtId) => {
    const src = _tokens[srcId]?.data;
    const tgt = _tokens[tgtId]?.data;
    if (!src || !tgt) return false;
    const options = _buildAttackOptions(src);
    if (options.some(o => _tokenAttackDistance(src, tgt, o.portee) <= o.portee)) return true;
    const dist = _tokenAttackDistance(src, tgt);
    const maxRange = options.length ? Math.max(...options.map(o => o.portee)) : 0;
    showNotif(`Hors de portée (${dist} case${dist>1?'s':''}, portée max ${maxRange})`, 'error');
    return false;
  };

  const handleTokenAction = (e, opts = {}) => {
    e.cancelBubble = true;
    if (_tool === 'ruler' || _tool === 'draw') return; // outils de dessin ignorent les tokens
    if (e.evt.shiftKey && (STATE.isAdmin||t.ownerId===STATE.user?.uid)) {
      // Shift+clic : ajouter / retirer du groupe multi-sélection
      _toggleMultiSelect(t.id); return;
    }
    _clearMultiSelect();

    // Mode zone AoE actif → le clic verrouille / déverrouille le placement
    if (_zoneCtx && t.id !== _zoneCtx.srcId) {
      _zoneCtx.placed = !_zoneCtx.placed;
      return;
    }

    // Mode ciblage multi-cibles actif → basculer la cible
    if (_mtCtx && t.id !== _mtCtx.srcId) {
      _mtToggleTarget(t.id);
      return;
    }

    if (_attackSrc) {
      // Attaquant désigné → clic sur n'importe quel token (y compris soi-même) = attaque/soin
      // Vérification portée uniquement pour les cibles différentes
      if (_attackSrc !== t.id && opts.deselectOutOfRange && !_isAttackTargetInRange(_attackSrc, t.id)) {
        _deselect();
        return;
      }
      _execAttack(_attackSrc, t.id);
    } else {
      // Sélectionner le token (si token propre, montre la portée d'attaque)
      _select(t.id);
    }
  };

  g.on('click', e => {
    if (e.evt.button !== 0) return; // le clic droit court passe par contextmenu
    handleTokenAction(e);
  });

  g.on('contextmenu', e => {
    e.evt.preventDefault();
    e.cancelBubble = true;
    const moved = rightDown
      ? rightDown.dragged || Math.hypot(e.evt.clientX - rightDown.x, e.evt.clientY - rightDown.y) > 6
      : false;
    rightDown = null;
    if (moved) return;
    handleTokenAction(e, { deselectOutOfRange: true });
  });

  return g;
}

function _patchShape(id) {
  const e=_tokens[id]; if (!e?.shape) return;
  const ld=_live(e.data); const g=e.shape;
  const hasPmBar   = !!g.findOne('.pm-val');
  const hasCaBuff  = !!g.findOne('.ca-buff-turns');
  const needsCaBuff = !!ld._activeCaBuff;
  const sw = ld.displayTokenW || 1, sh = ld.displayTokenH || 1;
  // Si la taille a changé (modif bestiaire ou override), reconstruire
  const sizeMismatch = (g.getAttr('tokenW') || 1) !== sw || (g.getAttr('tokenH') || 1) !== sh;
  if ((ld.displayPm != null) !== hasPmBar || hasCaBuff !== needsCaBuff || sizeMismatch) {
    const shape = _buildShape(e.data);
    g.destroy();
    _tokens[id] = { ...e, shape };
    _layers.token?.add(shape);
    if (_selected === id) shape.findOne('.sel')?.visible(true);
    if (_attackSrc === id) shape.findOne('.atk')?.visible(true);
    _layers.token?.batchDraw();
    return;
  }
  g.to({ x:e.data.col*CELL+sw*CELL/2, y:e.data.row*CELL+sh*CELL/2, duration:0.12 });
  const hpKnownU = ld.displayHp !== null && ld.displayHpMax !== null;
  const hp=hpKnownU?ld.displayHp:0, hpm=hpKnownU?ld.displayHpMax:1;
  const rat=hpKnownU?(hpm>0?Math.max(0,hp/hpm):1):0.5, bW=CELL*sw*0.9;
  const fill=g.findOne('.hp-fill');
  if (fill){fill.width(bW*rat);fill.fill(hpKnownU?hpColor(rat):'#555');}
  g.findOne('.hp-val')?.text(hpKnownU?`${hp}/${hpm}`:'?/?');
  // PM
  const _pm=ld.displayPm;
  if (_pm!=null) {
    const pmMax=ld.displayPmMax??1, pmRat=pmMax>0?Math.max(0,_pm/pmMax):1;
    g.findOne('.pm-fill')?.width(bW*pmRat);
    g.findOne('.pm-val')?.text(`✨${_pm}/${pmMax}`);
  }
  // CA + buff
  const _buff   = ld._activeCaBuff;
  const _buffed = !!_buff;
  const _round  = _session?.combat?.round ?? 0;
  g.findOne('.ca-lbl')?.text(`🛡${ld.displayDefense??0}`);
  g.findOne('.ca-lbl')?.fill(_buffed ? '#c4b5fd' : '#e2e8f0');
  g.findOne('.ca-bg')?.stroke(_buffed ? '#818cf8' : '#64748b');
  g.findOne('.ca-bg')?.strokeWidth(_buffed ? 2.5 : 1.5);
  g.findOne('.ca-bg')?.fill(_buffed ? 'rgba(30,27,80,0.95)' : 'rgba(15,15,25,0.9)');
  if (_buff) {
    const tl = _buff.expiresAtRound != null && _round > 0 ? _buff.expiresAtRound - _round + 1 : _buff.totalDuration ?? '∞';
    g.findOne('.ca-buff-turns')?.text(`${tl}↺`);
  }
  g.findOne('.lbl')?.text(ld.displayName??e.data.name);
  g.visible(!!(e.data.visible||STATE.isAdmin));
  _layers.token?.batchDraw();
}

// ── Sélection ───────────────────────────────────────────────────────
function _select(id) {
  if (_imgTr&&_selImg) { _imgTr.nodes([]); _selImg=null; _layers.map?.batchDraw(); }
  _tokens[_selected]?.shape?.findOne('.sel')?.visible(false);
  _tokens[_attackSrc]?.shape?.findOne('.atk')?.visible(false);
  _attackSrc=null; _clearHL();
  _selected=id;
  _tokens[id]?.shape?.findOne('.sel')?.visible(true);
  _layers.token.batchDraw();
  const data=_tokens[id]?.data;
  _renderInspector(data??null);
  // Clic sur un token allié/propre : portée de déplacement (bleu) + portée d'attaque (rouge)
  if (data&&(STATE.isAdmin||data.ownerId===STATE.user?.uid)) {
    _attackSrc=id;
    _tokens[id]?.shape?.findOne('.atk')?.visible(true);
    _layers.token.batchDraw();
    _showMoveRange(data);    // cases bleues cliquables (déplacement)
    _showAttackRange(data);  // cases rouges par-dessus (visuel portée)
  }
}

function _deselect() {
  _tokens[_selected]?.shape?.findOne('.sel')?.visible(false);
  _tokens[_attackSrc]?.shape?.findOne('.atk')?.visible(false);
  _selected=null; _attackSrc=null; _clearHL(); _clearMultiSelect(); _renderInspector(null);
  if (_imgTr)   { _imgTr.nodes([]); _layers.map?.batchDraw(); }
  if (_imgTrFg) { _imgTrFg.nodes([]); _layers.mapFg?.batchDraw(); }
  _selImg=null;
  _layers.token?.batchDraw();
}

// ── Portée de mouvement ─────────────────────────────────────────────
function _showMoveRange(t) {
  _clearHL(); if (!_activePage) return;
  const K=window.Konva, ld=_live(t);
  const inCombat = !!_session?.combat?.active;
  const maxMvt = (ld.displayMovement??6) + (t.bonusMvt||0);
  const mv = (inCombat && !STATE.isAdmin) ? Math.max(0, maxMvt - (t.movedCells||0)) : (ld.displayMovement??6);
  const sw = ld.displayTokenW || 1, sh = ld.displayTokenH || 1;
  const {cols,rows}=_activePage;
  // Pas de check collision : le drag & drop laisse passer, l'affichage doit faire pareil.
  for (let dc=-mv;dc<=mv;dc++) for (let dr=-mv;dr<=mv;dr++) {
    if (Math.abs(dc)+Math.abs(dr)>mv) continue;
    const c=t.col+dc,r=t.row+dr;
    if (c<0||r<0||c+sw>cols||r+sh>rows||(!dc&&!dr)) continue;
    const rect=new K.Rect({ x:c*CELL,y:r*CELL,width:CELL,height:CELL,
      fill:'rgba(79,140,255,0.28)', stroke:'rgba(79,140,255,0.70)', strokeWidth:1.5, listening:true });
    const tc=c, tr=r;
    const moveSelectedHere = async e => {
      // En mode placement de zone ou de ciblage multi-cibles : le sort est prioritaire
      // on bascule placed pour zone et on annule le déplacement
      if (_zoneCtx) {
        e.cancelBubble = true;
        _zoneCtx.placed = !_zoneCtx.placed;
        return;
      }
      if (_mtCtx) { e.cancelBubble = true; return; }
      e.cancelBubble = true;
      if (_selected) await _moveTo(_selected, tc, tr);
    };
    rect.on('click', e => { if (e.evt.button!==0) return; moveSelectedHere(e); });
    rect.on('contextmenu', e => { e.evt.preventDefault(); moveSelectedHere(e); });
    _layers.grid.add(rect); _moveHL.push(rect);
  }
  _layers.grid.batchDraw();
}
function _clearHL() { _moveHL.forEach(r=>r.destroy()); _moveHL=[]; _layers.grid?.batchDraw(); }

/**
 * Refresh immédiat des zones de déplacement + attaque du token sélectionné.
 * Appeler après chaque commit de mouvement pour garder l'interface active.
 * @param {string} id - token id
 * @param {object} [overrideData] - données à jour si l'objet Firestore n'est pas encore mis à jour
 */
function _refreshRanges(id, overrideData) {
  if (!id || id !== _selected) { _clearHL(); return; }
  const data = overrideData ?? _tokens[id]?.data;
  if (!data) { _clearHL(); return; }
  if (!STATE.isAdmin && data.ownerId !== STATE.user?.uid) { _clearHL(); return; }
  _showMoveRange(data);   // _clearHL() est appelé en tête de _showMoveRange
  _showAttackRange(data);
  _renderInspector(data); // actualise les compteurs (mouvement restant, etc.)
}

// ── Pings ────────────────────────────────────────────────────────────
async function _emitPing(wx, wy) {
  const uid = STATE.user?.uid; if (!uid || !_activePage) return;
  const authorName = STATE.profile?.pseudo || STATE.profile?.prenom || 'Joueur';
  const color = '#ffe600'; // jaune néon — visible sur toutes les cartes
  try {
    await setDoc(_pingRef(uid), {
      x: wx, y: wy, pageId: _activePage.id,
      authorName, color, createdAt: serverTimestamp(),
    });
  } catch(e) { console.warn('[vtt] ping:', e); }
}

function _animatePing({ id, x, y, color }, pingKey) {
  if (!_layers.ping) return;
  const K = window.Konva;
  const g = new K.Group({ x, y, listening: false });

  // Halo blanc central (flash d'impact)
  const flash = new K.Circle({ radius: 28, fill: 'white', opacity: 0.9,
    shadowColor: 'white', shadowBlur: 30, shadowOpacity: 1 });
  // Point coloré persistant
  const dot   = new K.Circle({ radius: 16, fill: color, opacity: 1,
    shadowColor: color, shadowBlur: 20, shadowOpacity: 1 });
  // 4 anneaux expansifs
  const mkRing = (sw, op) => new K.Circle({ radius: 24, stroke: color, strokeWidth: sw,
    fill: 'transparent', opacity: op, shadowColor: color, shadowBlur: 12, shadowOpacity: 0.8 });
  const ring1 = mkRing(5, 1);
  const ring2 = mkRing(4, 0.85);
  const ring3 = mkRing(3, 0.65);
  const ring4 = mkRing(2, 0.45);
  g.add(flash, ring1, ring2, ring3, ring4, dot);
  _layers.ping.add(g);
  _layers.ping.batchDraw();

  const upd = () => _layers.ping?.batchDraw();
  // Flash s'efface rapidement
  new K.Tween({ node: flash, duration: 0.35, radius: 50, opacity: 0, easing: K.Easings.EaseOut, onUpdate: upd }).play();
  // Anneaux s'expandent en cascade
  new K.Tween({ node: ring1, duration: 1.2,           radius: 120, opacity: 0, easing: K.Easings.EaseOut, onUpdate: upd }).play();
  new K.Tween({ node: ring2, duration: 1.4, delay: 0.12, radius: 170, opacity: 0, easing: K.Easings.EaseOut, onUpdate: upd }).play();
  new K.Tween({ node: ring3, duration: 1.6, delay: 0.24, radius: 220, opacity: 0, easing: K.Easings.EaseOut, onUpdate: upd }).play();
  new K.Tween({ node: ring4, duration: 1.8, delay: 0.36, radius: 280, opacity: 0, easing: K.Easings.EaseOut, onUpdate: upd }).play();
  // Point disparaît en dernier
  new K.Tween({ node: dot, duration: 0.5, delay: 1.5, opacity: 0, easing: K.Easings.EaseIn,
    onFinish: () => { g.destroy(); _layers.ping?.batchDraw(); } }).play();

  setTimeout(() => _renderedPings.delete(pingKey), 4000);
}

function _renderPings(pings) {
  for (const p of pings) {
    const pingKey = `${p.id}_${p.createdAt?.toMillis?.() ?? 0}`;
    if (_renderedPings.has(pingKey)) continue;
    _renderedPings.add(pingKey);
    _animatePing(p, pingKey);
  }
}

// ── Réaction émote style stream — toujours bas-droite, indépendant du zoom ──
function _showEmoteBubble(tokenId, emoteUrl, emoteName, key) {
  if (_renderedReactions.has(key)) return;
  _renderedReactions.add(key);

  // Injecter le CSS une seule fois
  if (!document.getElementById('vtt-emote-anim-css')) {
    const s = document.createElement('style');
    s.id = 'vtt-emote-anim-css';
    s.textContent = `
      @keyframes vttEmoteRise {
        0%   { transform: scale(0.1)  translateY(0px);   opacity: 0; }
        12%  { transform: scale(1.22) translateY(0px);   opacity: 1; }
        22%  { transform: scale(1)    translateY(0px);   opacity: 1; }
        78%  { transform: scale(1)    translateY(-155px);opacity: 1; }
        100% { transform: scale(0.08) translateY(-180px);opacity: 0; }
      }
      .vtt-emote-bubble {
        position: absolute; bottom: 0; right: 0;
        width: 104px; height: 104px; border-radius: 50%;
        background: #fff;
        box-shadow: 0 6px 22px rgba(0,0,0,0.5);
        overflow: hidden;
        animation: vttEmoteRise 3.6s cubic-bezier(.22,.8,.46,1) forwards;
        pointer-events: none;
      }
      .vtt-emote-bubble img {
        width: 96px; height: 96px;
        object-fit: cover; border-radius: 50%;
        position: absolute; top: 4px; left: 4px;
      }
    `;
    document.head.appendChild(s);
  }

  // Créer ou réutiliser l'overlay (coin bas-droit du canvas, z-index au-dessus de la vignette)
  const wrap = document.getElementById('vtt-canvas-wrap');
  if (!wrap) return;
  let overlay = document.getElementById('vtt-emote-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'vtt-emote-overlay';
    overlay.style.cssText = 'position:absolute;bottom:18px;right:18px;width:0;height:0;pointer-events:none;z-index:20;overflow:visible';
    wrap.appendChild(overlay);
  }

  const bubble = document.createElement('div');
  bubble.className = 'vtt-emote-bubble';
  const img = document.createElement('img');
  img.src = emoteUrl; img.alt = emoteName;
  bubble.appendChild(img);
  overlay.appendChild(bubble);
  bubble.addEventListener('animationend', () => bubble.remove(), { once: true });
}

// ── Multi-sélection ─────────────────────────────────────────────
function _clearMultiSelect() {
  for (const id of _selectedMulti) {
    if (id!==_selected) _tokens[id]?.shape?.findOne('.sel')?.visible(false);
  }
  _selectedMulti.clear();
  _layers.token?.batchDraw();
}

function _toggleMultiSelect(id) {
  // Inclure le token principal courant dans la multi-sélection
  if (_selected && !_selectedMulti.has(_selected)) {
    _selectedMulti.add(_selected);
    _tokens[_selected]?.shape?.findOne('.sel')?.visible(true);
  }
  if (_selectedMulti.has(id)) {
    _selectedMulti.delete(id);
    _tokens[id]?.shape?.findOne('.sel')?.visible(false);
  } else {
    _selectedMulti.add(id);
    _tokens[id]?.shape?.findOne('.sel')?.visible(true);
    _selected = id;
    _renderInspector(_tokens[id]?.data??null);
  }
  _layers.token?.batchDraw();
}

/** Surbrillance rouge des cases à portée d'attaque de t (sans clear — le caller nettoie). */
function _showAttackRange(t) {
  if (!_activePage) return;
  const K=window.Konva;
  const options=_buildAttackOptions(t);
  const maxRange=options.length?Math.max(...options.map(o=>o.portee)):(_live(t).displayRange??1);
  // Pure mêlée (portée max = 1) → Chebyshev (8 dirs, inclut diagonales). Sinon Manhattan (losange).
  const meleeOnly = maxRange === 1;
  const {cols,rows}=_activePage;
  const sd = _tokenDims(t);
  for (let c=0; c<cols; c++) for (let r=0; r<rows; r++) {
    // Ignorer les cases occupées par le token source lui-même
    if (c>=t.col && c<t.col+sd.w && r>=t.row && r<t.row+sd.h) continue;
    // Distance entre la case (c,r) et la bounding box du token source
    const dx = Math.max(0, Math.max(c, t.col) - Math.min(c, t.col + sd.w - 1));
    const dy = Math.max(0, Math.max(r, t.row) - Math.min(r, t.row + sd.h - 1));
    const dist = meleeOnly ? Math.max(dx, dy) : (dx + dy);
    if (dist > maxRange) continue;
    const rect=new K.Rect({ x:c*CELL,y:r*CELL,width:CELL,height:CELL,
      fill:'rgba(239,68,68,0.22)', stroke:'rgba(239,68,68,0.65)', strokeWidth:1.5, listening:false });
    _layers.grid.add(rect); _moveHL.push(rect);
  }
  _layers.grid.batchDraw();
}
async function _moveTo(id, col, row) {
  const cur = _tokens[id]?.data;
  // Blocage par les murs (joueurs seulement)
  if (!STATE.isAdmin && (_activePage?.walls||[]).length) {
    if (cur && fogWallBlocksPath(cur.col, cur.row, col, row, _activePage.walls)) {
      showNotif('🧱 Chemin bloqué !', 'error');
      return;
    }
  }
  // Limite de mouvement en combat (joueurs seulement)
  if (!STATE.isAdmin && _session?.combat?.active && cur) {
    const d = Math.abs(col - cur.col) + Math.abs(row - cur.row);
    const maxMvt = (_live(cur).displayMovement ?? 6) + (cur.bonusMvt || 0);
    const rem = maxMvt - (cur.movedCells || 0);
    if (d > rem) {
      showNotif(rem <= 0 ? 'Plus de mouvement ce tour !' : `Trop loin ! (${rem} case${rem!==1?'s':''} restante${rem!==1?'s':''})`, 'error');
      return;
    }
  }
  const patch = {col, row};
  if (!STATE.isAdmin && _session?.combat?.active && cur) {
    const d = Math.abs(col - cur.col) + Math.abs(row - cur.row);
    patch.movedCells = (cur.movedCells || 0) + d;
    patch.movedThisTurn = true;
  }
  await updateDoc(_tokRef(id), patch).catch(() => showNotif('Déplacement refusé', 'error'));

  // Mise à jour optimiste : ne pas attendre le snapshot Firestore pour rafraîchir les zones
  const entry = _tokens[id];
  if (entry?.data) {
    entry.data.col = col;
    entry.data.row = row;
    if (patch.movedCells  !== undefined) entry.data.movedCells  = patch.movedCells;
    if (patch.movedThisTurn !== undefined) entry.data.movedThisTurn = patch.movedThisTurn;
  }
  _refreshRanges(id, entry?.data);
}

// ═══════════════════════════════════════════════════════════════════
// ATTAQUE — sélection arme/sort puis confirmation
// ═══════════════════════════════════════════════════════════════════

/** Parse "2d6+3", "1d8", "1d4-1" → lance et retourne le total. */
// Parse "NdM[+K]" ou nombre fixe → { n, sides, mod } ou null si non-formule.
function _parseDice(formula) {
  if (!formula) return null;
  const m = String(formula).match(/^(\d+)[dD](\d+)([+-]\d+)?$/);
  return m ? { n:+m[1], sides:+m[2], mod:+(m[3]||0) } : null;
}

function _rollDice(formula) {
  const p = _parseDice(formula);
  if (!p) return Math.max(1, parseInt(formula)||1);
  let total = 0;
  for (let i=0; i<p.n; i++) total += Math.floor(Math.random()*p.sides)+1;
  return total + p.mod;
}

/** Valeur maximale possible d'une formule de dés (ex: "2d6+3" → 15). */
function _maxDice(formula) {
  const p = _parseDice(formula);
  return p ? p.n * p.sides + p.mod : Math.max(1, parseInt(formula)||1);
}

/**
 * Formule de dégâts calculée d'un sort offensif.
 * Miroir local de _calcSortDegats (spells.js) — évite le cross-import.
 * Inclut : dés de base + runes Puissance/Protection + chaînage + maîtrise arme principale.
 */
function _vttSortDmgFormula(s, c) {
  const mainP   = c?.equipement?.['Main principale'];
  const armeDeg = mainP?.degats || '1d6';
  let base = (s.degats || '').trim();
  if (!base || base.toLowerCase() === '= arme') base = armeDeg;
  const runes    = s.runes || [];
  const nbPuiss  = runes.filter(r => r === 'Puissance').length;
  const nbProt   = runes.filter(r => r === 'Protection').length;
  const totalPP  = nbPuiss + nbProt;
  const bonusVal = totalPP > 1 ? (totalPP - 1) * 2 : 0;
  const maitrise = getMaitriseBonus(c, mainP || {});
  const m = base.match(/^(\d+)(d\d+)(.*)$/i);
  if (m) {
    let r = `${parseInt(m[1]) + totalPP}${m[2]}${m[3]}`;
    const tot = bonusVal + maitrise;
    if (tot > 0) r += ` +${tot}`; else if (tot < 0) r += ` ${tot}`;
    return r;
  }
  let r = base;
  if (totalPP > 0) r += ` +${totalPP}d6`;
  const tot = bonusVal + maitrise;
  if (tot > 0) r += ` +${tot}`; else if (tot < 0) r += ` ${tot}`;
  return r;
}

/**
 * Formule de soin calculée d'un sort défensif (mode soin).
 * Miroir local de _calcSortSoin (spells.js).
 * Inclut : 1d4 base + runes Protection + chaînage + maîtrise + mod de stat.
 * Stat utilisée :
 *  - Noyau magique avec arme magique équipée → stat d'attaque de l'arme
 *  - Noyau magique sans arme magique (Poings) → Intelligence
 *  - Noyau physique / pas de noyau → Constitution
 */
function _vttSortSoinFormula(s, c) {
  const mainP    = c?.equipement?.['Main principale'];
  const maitrise = getMaitriseBonus(c, mainP || {});
  const runes    = s.runes || [];
  const nbProt   = runes.filter(r => r === 'Protection').length;
  const chainSoin = nbProt > 1 ? nbProt - 1 : 0;
  const base     = (s.soin || '').trim();

  // Détermine la stat de soin selon la nature du noyau (magique vs physique)
  const dmgTypes = _damageTypes;
  const noyauTypeId = s?.noyauTypeId;
  const isMagic = !!(dmgTypes && noyauTypeId && dmgTypes.find(x => x.id === noyauTypeId)?.isMagic);
  let statKey = 'constitution';
  if (isMagic) {
    const fmt = _weaponFormats?.find(f => f.label === mainP?.format);
    const isMagicWeapon = fmt?.isMagic === true && mainP?.nom;
    statKey = isMagicWeapon ? (mainP.statAttaque || mainP.toucherStat || 'intelligence') : 'intelligence';
  }
  const statMod = c ? getMod(c, statKey) : 0;

  const totalFlat = maitrise + statMod;
  const flatStr = totalFlat > 0 ? ` +${totalFlat}` : totalFlat < 0 ? ` ${totalFlat}` : '';
  if (!base || base.toLowerCase() === '= base') {
    let r = `${1 + nbProt}d4`;
    if (chainSoin > 0) r += ` +${chainSoin * 2}`;
    return r + flatStr;
  }
  if (nbProt > 0) {
    const m = base.match(/^(\d+)(d\d+)(.*)$/i);
    if (m) {
      let r = `${parseInt(m[1]) + nbProt}${m[2]}${m[3]}`;
      if (chainSoin > 0) r += ` +${chainSoin * 2}`;
      return r + flatStr;
    }
    return base;
  }
  return flatStr ? base + flatStr : base;
}

/** Parse le bonus CA numérique depuis la chaîne libre (ex: "CA +2 (2 tours)" → 2). */
function _parseCaBonus(caStr) {
  const m = (caStr || '+2').match(/([+-]?\d+)/);
  return m ? (parseInt(m[1]) || 2) : 2;
}

/** Durée totale du sort en tours = dureeBase + bonus runes Durée. Miroir local.
 *  Fallbacks :
 *   - parse "X tours" dans le champ ca (override manuel)
 *   - 2 tours par défaut si le sort comporte une rune persistante (Ench, Aff,
 *     Protection mode CA, Invocation, ou Amplification seule = sort de terrain)
 */
function _sortDureeVtt(s) {
  const runes  = s?.runes || [];
  const nbDur  = runes.filter(r => r === 'Durée').length;
  const base   = (s?.dureeBase >= 1) ? +s.dureeBase : 0;
  let bonus = 0;
  for (let i = 0; i < nbDur; i++) bonus += 2 + i;
  if (base + bonus > 0) return base + bonus;
  // Fallback 1 : lire "X tours" dans le champ ca (ex : "CA +2 (2 tours)")
  const m = String(s?.ca || '').match(/(\d+)\s*tours?/i);
  if (m) return parseInt(m[1]);
  // Fallback 2 : 2 tours par défaut si rune persistante détectée
  const protMode = s?.protectionMode || 'ca';
  const hasProtCA = runes.includes('Protection') && protMode === 'ca';
  const hasEnch   = runes.includes('Enchantement');
  const hasAff    = runes.includes('Affliction');
  const hasInv    = runes.includes('Invocation');
  const nbAmp     = runes.filter(r => r === 'Amplification').length;
  const nbP       = runes.filter(r => r === 'Puissance').length;
  const nbProt    = runes.filter(r => r === 'Protection').length;
  const isTerrain = nbAmp > 0 && nbP === 0 && nbProt === 0;
  if (hasProtCA || hasEnch || hasAff || hasInv || isTerrain) return 2;
  return null;
}

/**
 * Nombre de cibles d'un sort (rune Dispersion).
 * Miroir local de _calcSortCibles (spells.js).
 * 0 rune = 1 cible ; N runes = 2N cibles (chaînage).
 */
function _vttSortCibles(s) {
  const runes = s?.runes || [];
  const nbDisp = runes.filter(r => r === 'Dispersion').length;
  if (nbDisp === 0) return 1;
  const nbAmp = runes.filter(r => r === 'Amplification').length;
  const nbAff = runes.filter(r => r === 'Affliction').length;
  const nbInv = runes.filter(r => r === 'Invocation').length;
  // Combos qui absorbent la Dispersion :
  //  - Amp + Disp → zone élargie (pas de cibles supplémentaires)
  //  - Aff + Inv + Disp → invocations multiples (sentinelles) → pas de cibles supplémentaires
  if (nbAmp > 0) return 1;
  if (nbAff > 0 && nbInv > 0) return 1;
  return 2 * nbDisp; // 1 base + N + (N-1) chaînage = 2N
}

/** Sépare "NdM +K +L" en { rawDice:"NdM", fixed:K+L }. */
function _splitDiceFormula(str) {
  const s = String(str || '').replace(/\s+/g, '');
  const dm = s.match(/^(\d+d\d+)/i);
  if (!dm) return { rawDice: str, fixed: 0 };
  const rawDice = dm[1];
  let fixed = 0;
  const re = /([+-])(\d+)/g;
  let m;
  while ((m = re.exec(s.slice(rawDice.length))) !== null) {
    fixed += m[1] === '+' ? parseInt(m[2]) : -parseInt(m[2]);
  }
  return { rawDice, fixed };
}

// Métadonnées d'affichage des interactions de dégâts (icône, couleur, label).
// Palette neutre côté attaquant : aucune couleur ne sous-entend "bon / mauvais"
// pour ne pas tromper le joueur (la valeur ½ / ×2 / 0 / +N reste la source
// de lecture).
const DMG_INTERACTIONS = {
  'Résistance': { icon: '🛡️', color: '#4f8cff', short: '½'   }, // bleu défensif
  'Immunité':   { icon: '🚫', color: '#94a3b8', short: 'Imm.' }, // gris ardoise (mur)
  'Absorption': { icon: '💚', color: '#b47fff', short: 'Abs.' }, // violet (anormal, soigne)
  'Faiblesse':  { icon: '💢', color: '#f59e0b', short: '×2'  }, // orange chaud
};

/**
 * Applique l'interaction du profil de dégâts d'une créature (immun./absorp./faib./résist.).
 * - Si dmgTotal vaut 0 (raté sans missEffect), l'interaction n'est PAS appliquée :
 *   on n'invente pas 1 dégât minimum sur une attaque qui n'a rien fait.
 * - Absorption : renvoie un dmgTotal négatif (le call site soustrait ⇒ soin).
 *   Le plafonnement à pvMax est laissé au call site.
 */
function _applyDamageTypeInteraction(dmgTotal, typeId, beast) {
  if (!beast) return { dmgTotal, interaction: null };
  const effectiveTypeId = typeId || 'physique';
  const has = (arr) => Array.isArray(arr) && arr.includes(effectiveTypeId);

  if (has(beast.immunites))   return { dmgTotal: 0, interaction: 'Immunité' };
  // Pour les autres interactions : pas d'effet si dmgTotal est nul.
  if (dmgTotal <= 0) return { dmgTotal, interaction: null };
  if (has(beast.absorptions)) return { dmgTotal: -dmgTotal,                       interaction: 'Absorption' };
  if (has(beast.faiblesses))  return { dmgTotal: dmgTotal * 2,                    interaction: 'Faiblesse' };
  if (has(beast.resistances)) return { dmgTotal: Math.max(1, Math.floor(dmgTotal / 2)), interaction: 'Résistance' };
  return { dmgTotal, interaction: null };
}

/** Récupère l'interaction prévue (sans modifier de valeur) pour preview. */
function _previewDamageInteraction(typeId, beast) {
  if (!beast) return null;
  const id = typeId || 'physique';
  if (Array.isArray(beast.immunites)   && beast.immunites.includes(id))   return 'Immunité';
  if (Array.isArray(beast.absorptions) && beast.absorptions.includes(id)) return 'Absorption';
  if (Array.isArray(beast.faiblesses)  && beast.faiblesses.includes(id))  return 'Faiblesse';
  if (Array.isArray(beast.resistances) && beast.resistances.includes(id)) return 'Résistance';
  return null;
}

// Dimensions du token en cases (W × H). Compat : si seul tokenSize est défini, on l'applique aux deux.
const _tokenDims = t => {
  const b = t?.beastId ? _bestiary[t.beastId] : null;
  const w = t?.tokenW ?? t?.tokenSize ?? b?.tokenW ?? b?.tokenSize ?? 1;
  const h = t?.tokenH ?? t?.tokenSize ?? b?.tokenH ?? b?.tokenSize ?? 1;
  return { w: Math.max(1, Math.min(5, w)), h: Math.max(1, Math.min(5, h)) };
};
// Distance d'attaque entre bounding boxes WxH (0 = adjacent / chevauchement de côté).
// portee === 1 (mêlée) → Chebyshev (8 directions, inclut diagonales).
// portee > 1 ou non précisé → Manhattan (losange, 4 directions).
const _tokenAttackDistance = (src, tgt, portee = null) => {
  const s = _tokenDims(src), g = _tokenDims(tgt);
  const dx = Math.max(0, Math.max(src.col, tgt.col) - Math.min(src.col + s.w - 1, tgt.col + g.w - 1));
  const dy = Math.max(0, Math.max(src.row, tgt.row) - Math.min(src.row + s.h - 1, tgt.row + g.h - 1));
  return portee === 1 ? Math.max(dx, dy) : dx + dy;
};

/**
 * Détecte les modificateurs spéciaux d'un sort (combos, lacération, chance, déplacement…).
 * Miroir local des helpers de spells.js — évite cross-import features/characters.
 * Renvoie null si aucun mod actif, sinon un objet avec les flags pertinents.
 */
function _vttSpellMods(s) {
  if (!s) return null;
  const runes = s.runes || [];
  const counts = {};
  runes.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  const nbP    = counts.Puissance     || 0;
  const nbProt = counts.Protection    || 0;
  const nbLac  = counts.Lacération    || 0;
  const nbCh   = counts.Chance        || 0;
  const nbReac = counts.Réaction      || 0;
  const nbEnch = counts.Enchantement  || 0;
  const nbInv  = counts.Invocation    || 0;
  const nbAff  = counts.Affliction    || 0;
  const nbAmp  = counts.Amplification || 0;
  const nbDur  = counts.Durée         || 0;
  const nbConc = counts.Concentration || 0;
  const nbDisp = counts.Dispersion    || 0;
  const protMode = s.protectionMode || 'ca';

  // Stats propres de la Sentinelle (combo Affliction + Invocation)
  const _chainProt = nbProt > 1 ? (nbProt - 1) : 0;
  const _chainP    = nbP > 1 ? (nbP - 1) * 2 : 0;
  const sentinelDice  = 1 + nbP;
  const sentinelDmg   = _chainP > 0 ? `${sentinelDice}d4 +${_chainP}` : `${sentinelDice}d4`;
  const sentinelHp    = 10 + 5 * nbProt + _chainProt;
  const sentinelCa    = 10 + 2 * nbProt + _chainProt;
  const sentinelRangeM = nbAmp === 0 ? 1 : (4 * nbAmp - 1);

  const mods = {
    // Drain : Puissance + Protection → soigne le lanceur d'un % des dégâts
    // Formule : 25% + 25% × nbProt → Prot×1=50% · ×2=75% · ×3=100% · ×4=125%
    drain: (nbP > 0 && nbProt > 0)
      ? { pct: 0.25 + 0.25 * nbProt, nbProt } : null,
    // Lacération : -CA brut sur la cible (plafonné en jeu : 2 joueur · 4 élite/boss)
    laceration: nbLac > 0
      ? { runes: nbLac, reduction: 2*nbLac - 1, max: 2, maxElite: 4 } : null,
    // Chance : étend la plage critique (RC 20 → 21-2N..20)
    chance: nbCh > 0
      ? { rc: 20 - (2*nbCh - 1) } : null,
    // Concentration : DD du JS Sagesse en cas de dégâts reçus
    concentration: nbConc > 0
      ? { dd: 11 + 2 * (nbConc - 1), runes: nbConc } : null,
    // Déplacement : push / pull, distance en cases (1 case ≈ 1.5m)
    deplacement: s.deplacement?.mode
      ? { mode: s.deplacement.mode, distance: Math.max(1, Math.ceil((parseInt(s.deplacement.distance)||1) / CELL_M)) }
      : null,
    // Allonge magique : Ench + Amp + slot arme → portée étendue (au lieu d'une zone)
    allonge: (nbEnch > 0 && nbAmp > 0 && (s.enchantSlot || 'arme') === 'arme')
      ? { meters: 4*nbAmp - 1, cells: Math.ceil((4*nbAmp - 1) / CELL_M) } : null,
    // Enchantement slot=arme : bonus dégâts sur les attaques d'arme de la cible (allié)
    // Formule auto : (1+Puiss)d4 +2 — appliquée pendant 2 tours par défaut
    // ⚠️ Absorbé par le combo Arme invoquée (Ench + Inv) → on ne le déclenche pas alors
    enchantArmeDmg: (nbEnch > 0 && nbInv === 0 && (s.enchantSlot || 'arme') === 'arme')
      ? {
          formula: (s.enchantDegats || '').trim() || `${1 + nbP}d4 +2`,
          element: s.noyauTypeId || null,
          nbCibles: nbEnch === 1 ? 1 : nbEnch + 1,
        } : null,
    // Enchantement slot=pieds : bonus mouvement (cases supplémentaires)
    // Auto : +2 cases / rune Puissance, ou +1 par défaut
    enchantPieds: (nbEnch > 0 && nbInv === 0 && s.enchantSlot === 'pieds')
      ? { bonusCells: Math.max(1, nbP * 2 || 1), nbCibles: nbEnch === 1 ? 1 : nbEnch + 1 } : null,
    // Enchantement slot=tete / torse : effet libre (matrice), buff générique
    enchantGeneric: (nbEnch > 0 && nbInv === 0 && (s.enchantSlot === 'tete' || s.enchantSlot === 'torse'))
      ? { slot: s.enchantSlot, effect: s.enchantEffect || '', nbCibles: nbEnch === 1 ? 1 : nbEnch + 1 } : null,
    // Affliction : JS Sa DD 11 (modulable selon nb runes Concentration)
    // Slot détermine la nature : torse=DoT · pieds=mouvement · tete=sensoriel · arme=combat
    // ⚠️ Absorbé par le combo Sentinelle (Aff + Inv) → l'affliction est portée par la sentinelle
    // ⚠️ Absorbé par le combo Aura punitive (Prot + Aff sans Puiss) → l'affliction est gérée par l'aura
    affliction: (nbAff > 0 && nbInv === 0 && !(nbProt > 0 && nbP === 0))
      ? {
          slot: s.afflictionSlot || 'arme',
          effect: s.afflictionEffect || '',
          element: s.noyauTypeId || null,
          dd: 11,
          // Stat de sauvegarde selon le slot (heuristique simple)
          saveStat: s.afflictionSlot === 'torse' ? 'constitution'
                  : s.afflictionSlot === 'pieds' ? 'force'
                  : s.afflictionSlot === 'tete'  ? 'sagesse'
                  : 'dexterite',
        } : null,
    // Aura punitive : Protection + Affliction sans Puissance (sinon Drain prime)
    // Au cast, applique l'affliction Torse de l'élément à tous les ennemis dans la zone Manhattan
    auraPunitive: (nbProt > 0 && nbAff > 0 && nbP === 0)
      ? {
          radius: nbProt,                    // portée Manhattan = nb runes Protection
          element: s.noyauTypeId || null,
          dd: 11,
          saveStat: 'constitution',           // torse → Constitution
        } : null,
    // Sort suspendu : Réaction + Durée. Stocke le sort pour déclenchement hors-tour
    sortSuspendu: (nbReac > 0 && nbDur > 0)
      ? { graceTurns: nbDur + 1 } : null,
    // Coup de chance : Chance + Réaction. Permet de relancer un d20 d'attaque raté
    coupChance: (nbCh > 0 && nbReac > 0)
      ? { charges: nbCh } : null,
    // Bouclier réactif : Réaction + Protection (CA) → annule 1 attaque (sans bonus CA)
    bouclierReactif: (nbReac > 0 && nbProt > 0 && protMode === 'ca')
      ? { nbProt, tier: nbProt >= 3 ? 'boss' : nbProt === 2 ? 'elite' : 'mob' } : null,
    // Arme invoquée : Ench + Invocation → token allié temporaire (2 tours)
    armeInvoquee: (nbEnch > 0 && nbInv > 0)
      ? { elementId: s.noyauTypeId || null, nbPuissance: nbP } : null,
    // Sentinelle : Affliction + Invocation → token stationnaire (stats propres, 2 tours)
    // Dispersion permet d'invoquer plusieurs sentinelles : 1 base + 2N pour N runes (chaînage standard)
    sentinelle: (nbAff > 0 && nbInv > 0)
      ? {
          slot: s.afflictionSlot || 'arme',
          elementId: s.noyauTypeId || null,
          effect: s.afflictionEffect || '',
          dmgDice: sentinelDmg,
          hp: sentinelHp, ca: sentinelCa,
          rangeCells: Math.max(1, Math.ceil(sentinelRangeM / CELL_M)),
          rangeMeters: sentinelRangeM,
          nbInvocations: nbDisp > 0 ? 2 * nbDisp : 1,
          nbP, nbProt, nbAmp,
        } : null,
    // Canalisé persistant : Durée + Concentration → durée liée à la concentration
    canalisePersistant: (nbDur > 0 && nbConc > 0)
      ? { graceTurns: nbDur + 1, dd: 11 + 2 * (nbConc - 1) } : null,
  };

  // Renvoie null si aucun mod actif (évite de polluer opt.mods inutilement)
  const any = Object.values(mods).some(v => v !== null);
  return any ? mods : null;
}

/** Rang d'un attaquant pour comparaisons de tier (PJ = 'classique' par défaut). */
function _attackerRank(src) {
  if (!src) return 'classique';
  if (src.beastId) return String(_bestiary[src.beastId]?.rang || 'classique').toLowerCase();
  if (src.npcId)   return String(_npcs[src.npcId]?.rang || 'classique').toLowerCase();
  if (src.characterId) return 'classique'; // PJ : tier classique par défaut
  return 'classique';
}

/** Le bouclier réactif (tier) bloque-t-il une attaque venant d'un rang donné ?
 *  tier=mob  → bloque rang ≤ classique/mob
 *  tier=elite→ bloque rang ≤ élite
 *  tier=boss → bloque tous les rangs
 */
function _shieldBlocks(shieldTier, attackerRank) {
  const RANK = { 'classique': 1, 'mob': 1, 'élite': 2, 'elite': 2, 'boss': 3 };
  const r = RANK[String(attackerRank).toLowerCase()] || 1;
  const t = RANK[String(shieldTier).toLowerCase()] || 1;
  return r <= t;
}

/**
 * Déplace une cible de N cases dans la direction (push) ou opposée (pull) au lanceur.
 * Snap grille, s'arrête au premier blocage (autre token sur la case, hors-page).
 * Renvoie le nombre de cases effectivement parcourues.
 */
async function _vttApplyDeplacement(src, tgtData, mode, distance) {
  if (!src || !tgtData || !distance) return 0;
  // Vecteur source → cible (toujours en cellules, repère grille)
  const dCol = tgtData.col - src.col;
  const dRow = tgtData.row - src.row;
  const len  = Math.hypot(dCol, dRow);
  if (len < 0.001) return 0;
  // Direction unitaire en cellules ; push = sens cible→loin, pull = inverse
  const sign = mode === 'pull' ? -1 : 1;
  const stepC = Math.sign(Math.round((dCol / len) * sign));
  const stepR = Math.sign(Math.round((dRow / len) * sign));
  if (stepC === 0 && stepR === 0) return 0;

  let nc = tgtData.col, nr = tgtData.row;
  let moved = 0;
  for (let i = 0; i < distance; i++) {
    const tryC = nc + stepC, tryR = nr + stepR;
    // Collision avec un autre token sur la même page
    const collide = Object.values(_tokens).some(e => {
      const d = e?.data;
      if (!d || d.id === tgtData.id || d.pageId !== tgtData.pageId) return false;
      const dim = _tokenDims(d);
      return tryC >= d.col && tryC < d.col + dim.w && tryR >= d.row && tryR < d.row + dim.h;
    });
    if (collide) break;
    nc = tryC; nr = tryR; moved++;
  }
  if (moved > 0) {
    await updateDoc(_tokRef(tgtData.id), { col: nc, row: nr }).catch(() => {});
  }
  return moved;
}

/**
 * Crée un token "convoqué" (sentinelle, arme invoquée, etc.) sur la page active.
 * - kind: 'sentinelle' | 'arme_invoquee'
 * - center: { col, row } position désirée (sera ajustée si occupée pour arme invoquée)
 * - Le token : 10 PV / CA 10 par défaut, owner = lanceur, durée 2 tours (expiresAtRound)
 * - Persisté en Firestore via _toksCol, visible par tous, contrôlable par l'owner
 */
async function _vttSpawnSummon({ kind, srcId, col, row, opt, durationTurns = 2 }) {
  if (!_activePage) return null;
  const src = _tokens[srcId]?.data; if (!src) return null;
  const round = _session?.combat?.round ?? 0;
  const baseRound = Math.max(1, round);
  if (kind !== 'sentinelle') return null; // seul kind supporté désormais

  // Sentinelle : snap dans les bornes de la page
  const targetCol = Math.max(0, Math.min(_activePage.cols - 1, col));
  const targetRow = Math.max(0, Math.min(_activePage.rows - 1, row));

  const ownerName = _live(src).displayName ?? src.name;
  const baseName  = `🪤 Sentinelle de ${ownerName}`;

  // Stats propres de la sentinelle (calculées en amont dans _vttSpellMods)
  const st = opt?.mods?.sentinelle || {};
  const attackDice = st.dmgDice || '1d4';
  const hp = st.hp || 10;
  const ca = st.ca || 10;
  const rangeCells = st.rangeCells || 1;

  // Bonus au toucher = stat de spell du lanceur (mod) + 5 baseline
  // Permet à la sentinelle de toucher à peu près comme une attaque de sort du lanceur
  let attackBonus = 5;
  if (src.characterId) {
    const c = _characters[src.characterId];
    if (c) {
      const mainP   = c?.equipement?.['Main principale'];
      const statKey = mainP?.toucherStat || mainP?.statAttaque || 'force';
      attackBonus = (getMod(c, statKey) || 0) + 5;
    }
  } else if (src.npcId) {
    attackBonus = (_npcStatMod(_npcs[src.npcId] || {}, 'force') || 0) + 5;
  }

  // Seuil critique hérité du sort (combo Chance)
  const chanceRc = opt?.mods?.chance?.rc ?? 20;

  const tokenData = {
    name: baseName,
    type: 'npc',                       // allié contrôlable
    characterId: null, npcId: null, beastId: null,
    ownerId: src.characterId ? STATE.user?.uid || null : null,
    summonOwnerId: srcId,              // lien vers le lanceur (contrôle + cleanup)
    summonKind: kind,
    summonExpiresAtRound: baseRound + durationTurns - 1,
    summonCanalise: !!opt?.mods?.canalisePersistant,
    summonConcentrationDD: opt?.mods?.canalisePersistant?.dd || opt?.mods?.concentration?.dd || null,
    // Stats héritées du sort qui l'a invoquée — utilisées par _buildAttackOptions
    summonChanceRc: chanceRc,
    // Élément : priorité au noyau du sort (st.elementId), sinon damageTypeId de l'option offensive, sinon null
    summonElementId: st.elementId || opt?.damageTypeId || null,
    summonNbPuissance: st.nbP || 0,
    summonNbProtection: st.nbProt || 0,
    summonNbAmplification: st.nbAmp || 0,
    pageId: _activePage.id,
    col: targetCol, row: targetRow,
    visible: true,
    hp, hpMax: hp,
    defense: ca,
    movement: 0,                       // sentinelle stationnaire
    range: rangeCells,
    attackDice,
    attack: attackBonus,
    imageUrl: null,
    movedThisTurn: false, attackedThisTurn: false,
    createdAt: serverTimestamp(),
  };

  const ref = doc(_toksCol());
  await setDoc(ref, tokenData).catch(() => {});
  return { id: ref.id, ...tokenData };
}

/**
 * Helper commun : champs de buff partagés (durée, canalisation, source).
 * Évite la duplication entre les différents types d'enchantements/afflictions.
 */
function _buffShared(opt, srcId) {
  const round = _session?.combat?.round ?? 0;
  const baseRound = Math.max(1, round);
  const dur = opt.sortDuree ?? 2;
  const isCanalise = !!opt.mods?.canalisePersistant;
  const concDD = opt.mods?.concentration?.dd ?? (isCanalise ? 11 : null);
  // Firestore rejette `undefined` — on omet les champs au lieu de les mettre à undefined
  return {
    startRound: round,
    totalDuration: isCanalise ? null : dur,
    expiresAtRound: isCanalise ? null : baseRound + dur - 1,
    casterId: srcId || null,
    sortLabel: opt.label || '',
    ...(isCanalise ? { canalisePersistant: true, concentrationDD: concDD } : {}),
  };
}

/** Applique les buffs d'enchantement (arme/pieds/tête/torse) sur les alliés ciblés. */
async function _vttApplyEnchantBuffs(srcId, targetIds, opt) {
  const shared = _buffShared(opt, srcId);
  const buffs = [];
  if (opt.mods?.enchantArmeDmg) {
    buffs.push({ ...shared, type: 'dmg_bonus', slot: 'arme', icon: '⚔️',
      formula: opt.mods.enchantArmeDmg.formula, element: opt.mods.enchantArmeDmg.element });
  }
  if (opt.mods?.enchantPieds) {
    buffs.push({ ...shared, type: 'move_bonus', slot: 'pieds', icon: '👢',
      bonus: opt.mods.enchantPieds.bonusCells });
  }
  if (opt.mods?.enchantGeneric) {
    buffs.push({ ...shared, type: 'enchantment',
      slot: opt.mods.enchantGeneric.slot, effect: opt.mods.enchantGeneric.effect,
      icon: opt.mods.enchantGeneric.slot === 'tete' ? '👁️' : '👕' });
  }
  if (!buffs.length) return;
  const types = new Set(buffs.map(b => b.type));
  for (const tid of targetIds) {
    const td = _tokens[tid]?.data; if (!td) continue;
    const existing = (td.buffs || []).filter(b => !(types.has(b.type) && b.sortLabel === opt.label));
    await updateDoc(_tokRef(tid), { buffs: [...existing, ...buffs] }).catch(() => {});
  }
}

const _STAT_SHORT = { force:'For', dexterite:'Dex', constitution:'Con', sagesse:'Sag', intelligence:'Int', charisme:'Cha' };

/** Applique une affliction : JS Sa de la cible, buff selon slot si échec. */
async function _vttApplyAfflictions(srcId, targetIds, opt) {
  const aff = opt.mods?.affliction; if (!aff) return;
  const shared = _buffShared(opt, srcId);
  const statShortStr = _STAT_SHORT[aff.saveStat] || aff.saveStat;
  for (const tid of targetIds) {
    const td = _tokens[tid]?.data; if (!td) continue;
    const saveMod = _tokenStatMod(td, aff.saveStat);
    const roll = Math.floor(Math.random() * 20) + 1;
    const tot = roll + saveMod;
    const success = roll === 20 || (roll !== 1 && tot >= aff.dd);
    const tgtName = _live(td).displayName ?? td.name;
    const rollStr = `JS ${statShortStr} ${roll}${saveMod>=0?'+':''}${saveMod}=${tot} vs DD${aff.dd}`;
    if (success) {
      showNotif(`🛡️ ${tgtName} résiste · ${rollStr}`, 'info');
      continue;
    }
    let newBuff;
    if (aff.slot === 'torse') {
      // DoT : 1d4+2 dégâts/tour au début du tour de la cible
      newBuff = { ...shared, type: 'dot', slot: 'torse', icon: '🩸',
        formula: '1d4 +2', element: aff.element, effect: aff.effect };
    } else if (aff.slot === 'pieds') {
      // Débuff mouvement : -2 cases par défaut
      newBuff = { ...shared, type: 'move_debuff', slot: 'pieds', icon: '👢',
        bonus: -2, effect: aff.effect };
    } else {
      // Tête (sensoriel) / Arme (combat) : effet libre, à interpréter par le MJ
      newBuff = { ...shared, type: 'affliction',
        slot: aff.slot, effect: aff.effect, element: aff.element,
        icon: aff.slot === 'tete' ? '👁️' : '⚔️' };
    }
    const existing = (td.buffs || []).filter(b => !(b.type === newBuff.type && b.sortLabel === opt.label));
    await updateDoc(_tokRef(tid), { buffs: [...existing, newBuff] }).catch(() => {});
    showNotif(`💢 ${tgtName} subit ${opt.label} · ${rollStr} (échec)`, 'success');
  }
}

/** Construit la liste des options d'attaque pour un token (arme / attaques bestiaire / sorts). */
function _buildAttackOptions(t) {
  const ld = _live(t);
  const c  = t.characterId ? _characters[t.characterId] : null;
  const b  = ld._beast || null;
  const options = [];

  // ── Token convoqué (sentinelle) : utilise ses stats propres stockées au spawn ─
  // Les combos Chance/Puissance hérités du sort sont propagés via les champs summon*
  if (t.summonKind === 'sentinelle') {
    const sentinelMods = {
      // Réinjecte le combo Chance hérité pour que _vttRollAttack utilise le bon RC
      chance: (t.summonChanceRc && t.summonChanceRc < 20) ? { rc: t.summonChanceRc } : null,
    };
    options.push({
      id: 'summon_attack',
      icon: '🪤',
      label: 'Attaque sentinelle',
      rawDice: t.attackDice || '1d4',
      dice:    t.attackDice || '1d4',
      portee:  t.range ?? 1,
      pmCost:  0,
      toucher: t.attack ?? 5,           // bonus toucher hérité du lanceur
      dmgStatMod: 0,
      dmgStatLabel: '—',
      maitriseBonus: 0,
      halfOnMiss: false,
      typeRules: getDamageTypeRules(_damageTypes, t.summonElementId || 'physique'),
      damageTypeId:    t.summonElementId || 'physique',
      damageTypeIcon:  getDamageTypeById(_damageTypes, t.summonElementId || 'physique')?.icon || '',
      damageTypeColor: getDamageTypeById(_damageTypes, t.summonElementId || 'physique')?.color || '',
      mods: sentinelMods,
    });
    return options;
  }

  // ── Créature du bestiaire : ses attaques nommées ──
  if (b?.attaques?.length) {
    b.attaques.forEach((atk, idx) => {
      if (!atk.degats) return;
      const atkTypeId = atk.damageTypeId || null;
      const atkTypeObj = atkTypeId ? getDamageTypeById(_damageTypes, atkTypeId) : null;
      const atkTypeRules = atkTypeId ? getDamageTypeRules(_damageTypes, atkTypeId) : getDamageTypeRules(_damageTypes, 'physique');
      options.push({
        id:      `beast_${idx}`,
        icon:    '👹',
        label:   atk.nom || `Attaque ${idx+1}`,
        dice:    atk.degats,
        toucher: atk.toucher !== undefined && atk.toucher !== '' ? parseInt(atk.toucher)||0 : null,
        portee:  parseInt(atk.portee)||1,
        pmCost:  0,
        typeRules: atkTypeRules,
        damageTypeId: atkTypeId,
        damageTypeIcon: atkTypeObj?.icon || '',
        damageTypeColor: atkTypeObj?.color || '',
      });
    });
    if (options.length) return options;
  }

  // ── PNJ : stats saisies dans la fiche PNJ ──
  if (!c && t.npcId) {
    const n = _npcs[t.npcId] || {};
    const combat = _npcCombat(n);
    const weapon = combat.weapon || {};
    const dmgStat = (Array.isArray(weapon.degatsStats) && weapon.degatsStats.length
      ? weapon.degatsStats[0]
      : (weapon.degatsStat || weapon.statAttaque || 'force'));
    const dmgMod = _npcStatMod(n, dmgStat);
    options.push({
      id: 'npc_attack',
      icon: '⚔️',
      label: weapon.nom || combat.weaponName || 'Attaque',
      rawDice: t.attackDice || weapon.degats || combat.damage || n.attackDice || '1d6',
      dice: t.attackDice || weapon.degats || combat.damage || n.attackDice || '1d6',
      portee: ld.displayRange ?? 1,
      pmCost: 0,
      toucher: ld.displayAttack ?? 5,
      dmgStatMod: dmgMod,
      dmgStatLabel: statShort(dmgStat) || dmgStat,
      maitriseBonus: 0,
      halfOnMiss: false,
      traits: Array.isArray(weapon.traits) ? weapon.traits : [],
      damageTypeId: 'physique',
      damageTypeIcon: '💪',
      damageTypeColor: '#9ca3af',
    });
    return options;
  }

  // ── Arme invoquée active (buff weapon_replace) : remplace l'arme principale ──
  const _r0 = _session?.combat?.round ?? 0;
  const wReplace = (t.buffs || []).find(b => b?.type === 'weapon_replace'
    && (b.expiresAtRound == null || _r0 === 0 || _r0 <= b.expiresAtRound));

  // ── Arme principale du personnage (ou attaque générique) ──
  const weapon       = c?.equipement?.['Main principale'];
  const isUnarmed    = !wReplace && !weapon?.nom;
  // Stats actives : buff weapon_replace > équipement > poings
  const wDmgStats    = wReplace ? [wReplace.statDegats || 'force']
                                : isUnarmed ? ['force']
                                  : (weapon?.degatsStats?.length ? weapon.degatsStats : [weapon?.degatsStat || 'force']);
  const wTchStat     = wReplace ? (wReplace.statToucher || 'force')
                                : isUnarmed ? 'force'
                                  : (weapon?.toucherStats?.[0] || weapon?.toucherStat || wDmgStats[0]);
  const wDmgMod      = c ? wDmgStats.reduce((sum, s) => sum + getMod(c, s), 0) : 0;
  const wDmgStatLabel= wDmgStats.map(s => statShort(s) || s).join('+');
  const wTchMod      = c ? getMod(c, wTchStat)  : 0;
  const wSetBonus    = c ? (getArmorSetData(c).modifiers.toucherBonus || 0) : 0;
  const wMaitrise    = c && !wReplace && weapon ? getMaitriseBonus(c, weapon) : 0;
  // Règles de type de dégâts (missEffect, armorPen, dmgBonus)
  const wReplaceTypeId = wReplace?.element || 'physique';
  const fmt        = wReplace ? null : _weaponFormats?.find(f => f.label === weapon?.format);
  const isMagicW   = wReplace ? true : fmt?.isMagic === true;
  const typeRules  = wReplace
    ? getDamageTypeRules(_damageTypes, wReplaceTypeId)
    : (isMagicW
        ? getDamageTypeRules(_damageTypes, 'physique')
        : getDamageTypeRules(_damageTypes, fmt?.damageType || 'physique'));

  // Formule dés finale : arme invoquée → buff.weaponDice + mod stat ; sinon comportement actuel
  const wDmgDiceRaw = wReplace ? wReplace.weaponDice
                                : (isUnarmed ? '2d4' : (weapon?.degats || '1d6'));
  const wDmgDiceFinal = wReplace
    ? `${wReplace.weaponDice}${wDmgMod!==0?(wDmgMod>0?'+':'')+wDmgMod:''}`
    : (isUnarmed ? `2d4${wDmgMod!==0?(wDmgMod>0?'+':'')+wDmgMod:''}` : (ld.displayAttackDice || '1d6'));
  const wLabel = wReplace ? `⚔️ ${wReplace.weaponName} (invoquée)`
                          : (isUnarmed ? 'Coup de poing' : (weapon.nom || 'Attaque de base'));
  const wPortee = wReplace ? Math.max(1, wReplace.weaponRange || 1) : (ld.displayRange ?? 1);

  options.push({
    id:               'weapon',
    icon:             wReplace ? '🔮' : (isUnarmed ? '👊' : '⚔️'),
    label:            wLabel,
    rawDice:          wDmgDiceRaw,
    dice:             wDmgDiceFinal,
    portee:           wPortee,
    pmCost:           0,
    toucherMod:       wTchMod,
    toucherSetBonus:  wSetBonus,
    toucherStatLabel: statShort(wTchStat) || wTchStat,
    dmgStatMod:       wDmgMod,
    dmgStatLabel:     wDmgStatLabel,
    maitriseBonus:    wMaitrise,
    typeRules,
    damageTypeId:     wReplace ? wReplaceTypeId : (isMagicW ? null : (fmt?.damageType || 'physique')),
    damageTypeIcon:   wReplace ? (getDamageTypeById(_damageTypes, wReplaceTypeId)?.icon || '✨')
                                : (isMagicW ? '' : (getDamageTypeById(_damageTypes, fmt?.damageType || 'physique')?.icon || '')),
    damageTypeColor:  wReplace ? (getDamageTypeById(_damageTypes, wReplaceTypeId)?.color || '')
                                : (isMagicW ? '' : (getDamageTypeById(_damageTypes, fmt?.damageType || 'physique')?.color || '')),
    isMagicWeapon:    !!wReplace || (isMagicW && !isUnarmed),
    charElements:     wReplace ? [wReplaceTypeId] : ((isMagicW && !isUnarmed) ? (c?.elements || []) : []),
    isInvokedWeapon:  !!wReplace,
  });

  // ── Tous les sorts actifs du deck ──
  if (c?.deck_sorts?.length) {
    const mainP2      = c?.equipement?.['Main principale'];
    const sStatKey    = mainP2?.statAttaque || mainP2?.toucherStat || 'force';
    const sStatMod    = getMod(c, sStatKey);
    const sStatLbl    = statShort(sStatKey) || sStatKey;
    // Réduction PM du set léger (spellPmDelta est négatif pour le set léger → coût réduit)
    const spellPmDelta = c ? (getArmorSetData(c).modifiers.spellPmDelta || 0) : 0;

    c.deck_sorts.forEach((s, idx) => {
      if (!s.actif) return;
      const baseRange = parseInt(s.portee) || ld.displayRange || 1;
      const mods      = _vttSpellMods(s);
      // Allonge magique : ne modifie pas la portée du sort lui-même (c'est un enchantement
      // qui s'applique à l'arme de la cible via un buff `range_bonus` posé au cast, durée
      // 2 tours par défaut — voir branche d'application dans _vttRollAttack).
      const portee    = baseRange;
      let zoneW       = mods?.allonge ? 0 : (s.zoneW || 0);
      let zoneH       = mods?.allonge ? 0 : (s.zoneH || 0);
      // Sentinelle : force une zone (min 1×1) pour pouvoir choisir l'emplacement
      if (mods?.sentinelle && (zoneW <= 0 || zoneH <= 0)) {
        zoneW = Math.max(1, zoneW || 1);
        zoneH = Math.max(1, zoneH || 1);
      }
      const types     = Array.isArray(s.types) && s.types.length ? s.types
                      : (s.typeSoin ? ['defensif'] : (s.noyau ? ['offensif'] : ['utilitaire']));
      const protMode  = s.protectionMode || 'ca';
      const nbCibles  = _vttSortCibles(s);

      // Coût PM : applique le delta du set, puis vérifie si cible gratuite (multi-cibles)
      // ou si le sort vient d'être déclenché depuis un suspended_spell (gratuit one-shot).
      const basePm     = Math.max(0, (parseInt(s.pm) || 0) + spellPmDelta);
      const freeKey    = `${t.id}_${idx}`;
      const freeCasts  = _multiCastFree.get(freeKey) || 0;
      const isOneShot  = _freeNextCast.has(freeKey);
      const cout       = (freeCasts > 0 || isOneShot) ? 0 : basePm;

      // Infos catégorie pour le tri dans le modal VTT
      const sortCats = c.sort_cats || [];
      const sortCat  = s.catId ? sortCats.find(ct => ct.id === s.catId) : null;
      const _catMeta = { catId: s.catId || null, catLabel: sortCat?.nom || null, catColor: sortCat?.couleur || null };

      if (types.includes('offensif')) {
        const fullFormula    = _vttSortDmgFormula(s, c);
        const { rawDice: sRawDice, fixed: sFixed } = _splitDiceFormula(fullFormula);
        const spellTypeId    = s.noyauTypeId || null;
        const spellTypeRules = spellTypeId
          ? getDamageTypeRules(_damageTypes, spellTypeId)
          : { missEffect: 'half', armorPen: 0, dmgBonus: 0 };
        const spellTypeObj   = spellTypeId ? getDamageTypeById(_damageTypes, spellTypeId) : null;
        options.push({
          id: `sort_${idx}`, icon: '✨', label: s.nom || `Sort ${idx+1}`,
          rawDice: sRawDice, dice: fullFormula,
          portee, pmCost: cout, basePm, sortIdx: idx, nbCibles,
          zoneW, zoneH, mods,
          typeRules: spellTypeRules,
          damageTypeId: spellTypeId,
          damageTypeIcon: spellTypeObj?.icon || '',
          damageTypeColor: spellTypeObj?.color || '',
          toucherMod: wTchMod, toucherSetBonus: wSetBonus,
          toucherStatLabel: statShort(wTchStat) || wTchStat,
          dmgStatMod: sStatMod, dmgStatLabel: sStatLbl,
          maitriseBonus: sFixed,
          ..._catMeta,
        });

      } else if (types.includes('defensif') && protMode === 'soin') {
        const soinFormula = _vttSortSoinFormula(s, c);
        const { rawDice: sRawDice, fixed: sFixed } = _splitDiceFormula(soinFormula);
        options.push({
          id: `sort_${idx}`, icon: '💚', label: s.nom || `Sort ${idx+1}`,
          rawDice: sRawDice, dice: soinFormula,
          portee, pmCost: cout, basePm, sortIdx: idx, nbCibles,
          zoneW, zoneH, mods,
          isHeal: true, halfOnMiss: false, maitriseBonus: sFixed,
          ..._catMeta,
        });

      } else if (types.includes('defensif') && protMode === 'ca') {
        options.push({
          id: `sort_${idx}`, icon: '🛡️', label: s.nom || `Sort ${idx+1}`,
          dice: s.ca || 'CA +2 (2 tours)',
          portee, pmCost: cout, basePm, sortIdx: idx, nbCibles,
          zoneW, zoneH, mods,
          isCaSort: true, halfOnMiss: false,
          caBonus: _parseCaBonus(s.ca), sortDuree: _sortDureeVtt(s),
          ..._catMeta,
        });

      } else {
        options.push({
          id: `sort_${idx}`, icon: '✨', label: s.nom || `Sort ${idx+1}`,
          dice: s.effet ? s.effet.slice(0, 40) : '—',
          portee, pmCost: cout, basePm, sortIdx: idx, nbCibles,
          zoneW, zoneH, mods,
          isUtil: true, halfOnMiss: false,
          ..._catMeta,
        });
      }
    });
  }

  return options;
}

// Cache des options d'attaque — évite tout JSON/HTML dans les onclick
const _atkOptsCache = {};
// Contexte de l'attaque en cours (multi-étapes)
let _atkCtx = null;
// Sorts multi-cibles : casts gratuits restants — key: "${tokenId}_${sortIdx}"
const _multiCastFree = new Map();
// Sorts gratuits one-shot (déclenchement d'un sort suspendu) — Set<"${tokenId}_${sortIdx}">
const _freeNextCast = new Set();
// Flag : true pendant l'exécution d'un sort suspendu (évite la re-suspension en boucle)
let _suspendedTriggerActive = false;

/** Affiche le modal de sélection d'attaque. */
async function _execAttack(srcId, tgtId) {
  const src=_tokens[srcId]?.data, tgt=_tokens[tgtId]?.data;
  if (!src||!tgt) return;
  const lS=_live(src), lT=_live(tgt);
  const dist=_tokenAttackDistance(src, tgt);

  const options = _buildAttackOptions(src);
  const inRange = options.filter(o => _tokenAttackDistance(src, tgt, o.portee) <= o.portee);
  if (!inRange.length) {
    showNotif(`Hors de portée (${dist} case${dist>1?'s':''}, portée max ${Math.max(...options.map(o=>o.portee))})`, 'error');
    return;
  }

  // Stocke les options dans un cache indexé — pas de JSON dans les onclick
  const cacheKey = `${srcId}__${tgtId}`;
  _atkOptsCache[cacheKey] = inRange;

  const pm = lS.displayPm, pmMax = lS.displayPmMax;
  const pmBar = (pm!=null)
    ? `<div class="vtt-atk-pm-bar">
        <span style="color:#b47fff">✨</span>
        <div class="vtt-atk-pm-track"><div class="vtt-atk-pm-fill" style="width:${pmMax>0?Math.round(pm/pmMax*100):0}%"></div></div>
        <span style="font-size:.72rem;color:#b47fff;font-weight:700">${pm}/${pmMax}</span>
      </div>` : '';

  // Séparer armes et sorts
  const weaponOpts = inRange.filter(o => o.sortIdx === undefined);
  const spellOpts  = inRange.filter(o => o.sortIdx !== undefined);

  // Grouper les sorts par catégorie (ordre des sort_cats du personnage)
  const srcChar   = _characters[src.characterId] || null;
  const sortCats  = srcChar?.sort_cats || [];
  const hasCats   = sortCats.length > 0 && spellOpts.some(o => o.catId);

  // Construire une map catId → opts (préserve l'ordre des sort_cats)
  const catMap = new Map();
  spellOpts.forEach(o => {
    const cId = o.catId || '__none';
    if (!catMap.has(cId)) catMap.set(cId, []);
    catMap.get(cId).push(o);
  });
  // Ordre : catégories connues d'abord (dans l'ordre du joueur), puis __none
  const catOrder = [
    ...sortCats.filter(c => catMap.has(c.id)),
    ...(catMap.has('__none') ? [{ id: '__none', nom: null, couleur: '#6b7280' }] : []),
  ];

  // Rendu d'un bouton option
  const _optBtn = (o, i) => `
    <button class="vtt-attack-opt" onclick="window._vttPickOpt('${srcId}','${tgtId}',${i})">
      <span class="vtt-attack-opt-icon">${o.icon}</span>
      <div class="vtt-attack-opt-body">
        <div class="vtt-attack-opt-name">${_esc(o.label)}</div>
        <div class="vtt-attack-opt-meta">
          🎲 ${_esc(o.rawDice || o.dice)}
          · 🎯 ${o.portee}c
          ${o.isMagicWeapon ? `· <span style="color:#c084fc">🔮 élément</span>` : ''}
          ${!o.isMagicWeapon && o.damageTypeIcon ? `· <span style="color:${o.damageTypeColor||'#9ca3af'}">${o.damageTypeIcon}</span>` : ''}
          ${(o.zoneW>0||o.zoneH>0)?`· <span style="color:#fde047">📐 ${o.zoneW}×${o.zoneH}c</span>`:(o.nbCibles||1)>1?`· <span style="color:#4f8cff">×${o.nbCibles}</span>`:''}
          ${o.pmCost>0?`· <span style="color:#b47fff">✨${o.pmCost}PM</span>`:o.pmCost===0&&o.basePm>0?`· <span style="color:#22c38e">✨ gratuit</span>`:''}
          ${o.traits?.length ? `· <span style="color:var(--text-dim)">${o.traits.slice(0,2).map(_esc).join(', ')}</span>` : ''}
        </div>
      </div>
    </button>`;

  // Construire le HTML des options groupées
  let optsHtml = '';

  // ── Armes ──
  if (weaponOpts.length) {
    if (spellOpts.length) {
      optsHtml += `<div class="vtt-opt-cat-hdr" style="--cat-col:#94a3b8"><span>⚔️ Physique</span></div>`;
    }
    optsHtml += weaponOpts.map(o => _optBtn(o, inRange.indexOf(o))).join('');
  }

  // ── Sorts (groupés ou non) ──
  if (spellOpts.length) {
    if (hasCats) {
      catOrder.forEach(cat => {
        const catOpts = catMap.get(cat.id) || [];
        if (!catOpts.length) return;
        if (cat.nom) {
          optsHtml += `<div class="vtt-opt-cat-hdr" style="--cat-col:${cat.couleur}">
            <span>${_esc(cat.nom)}</span>
            <span class="vtt-opt-cat-count">${catOpts.length}</span>
          </div>`;
        } else if (catMap.size > 1 || weaponOpts.length) {
          // Sorts sans catégorie — n'afficher l'en-tête que si d'autres groupes existent
          optsHtml += `<div class="vtt-opt-cat-hdr" style="--cat-col:#6b7280"><span>✨ Autres sorts</span></div>`;
        }
        optsHtml += catOpts.map(o => _optBtn(o, inRange.indexOf(o))).join('');
      });
    } else {
      // Pas de catégories : afficher un en-tête "Sorts" seulement si des armes sont aussi présentes
      if (weaponOpts.length) {
        optsHtml += `<div class="vtt-opt-cat-hdr" style="--cat-col:#818cf8"><span>✨ Sorts</span></div>`;
      }
      optsHtml += spellOpts.map(o => _optBtn(o, inRange.indexOf(o))).join('');
    }
  }

  // ── Section Courir (si combat actif et pas encore utilisé) ──────────
  const inCombat = !!_session?.combat?.active;
  const couru    = (src.bonusMvt || 0) > 0;
  const canEditSrc = STATE.isAdmin || src.ownerId === STATE.user?.uid;
  const courirHtml = (inCombat && !couru && canEditSrc)
    ? `<div class="vtt-opt-cat-hdr" style="--cat-col:#4ade80"><span>🏃 Déplacement</span></div>
       <button class="vtt-attack-opt" onclick="window._vttCourir('${srcId}');window._closeActionModal?.()">
         <span class="vtt-attack-opt-icon">🏃</span>
         <div class="vtt-attack-opt-body">
           <div class="vtt-attack-opt-name">Courir</div>
           <div class="vtt-attack-opt-meta" style="color:#4ade80">+${lS.displayMovement??6} cases de mouvement ce tour</div>
         </div>
       </button>`
    : '';

  openModal('⚔️ Choisir une action', `
    <div class="vtt-form">
      <div class="vtt-atk-modal-hd">
        <span><strong>${_esc(lS.displayName??src.name)}</strong></span>
        <span style="color:var(--text-dim)">→</span>
        <strong style="color:#ef4444">${_esc(lT.displayName??tgt.name)}</strong>
        <span class="vtt-atk-dist">${dist}c</span>
      </div>
      ${pmBar}
      <div class="vtt-attack-opts">${optsHtml}${courirHtml}</div>
      <div style="text-align:right;margin-top:.5rem">
        <button class="btn-secondary" data-action="close-modal">Annuler</button>
      </div>
    </div>`);
}

window._vttPickOpt = (srcId, tgtId, idx) => {
  const opt = _atkOptsCache[`${srcId}__${tgtId}`]?.[+idx];
  if (!opt) return;
  closeModalDirect();

  // Arme magique : choisir l'élément avant de continuer
  if (opt.isMagicWeapon) {
    _mtPending = null; // sécurité
    _showElementPicker(srcId, tgtId, +idx);
    return;
  }

  // Sort à zone AoE : entrer en mode placement (sauf si on revient d'une validation)
  if ((opt.zoneW > 0 || opt.zoneH > 0) && opt.sortIdx !== undefined && !_mtPending) {
    _startZonePlacement(srcId, tgtId, opt, +idx);
    return;
  }

  // Sort multi-cibles : entrer en mode de sélection (sauf si on revient d'une validation)
  if ((opt.nbCibles || 1) > 1 && opt.sortIdx !== undefined && !_mtPending) {
    _startMultiTarget(srcId, tgtId, opt, +idx);
    return;
  }

  const src=_tokens[srcId]?.data, tgt=_tokens[tgtId]?.data;
  if (!src||!tgt) return;
  const lS=_live(src), lT=_live(tgt);
  // Si on arrive d'une validation multi-cibles, stocker les cibles dans le contexte
  const allTargets = _mtPending && _mtPending.length > 0 ? [..._mtPending] : null;
  _mtPending = null;
  _atkCtx = { srcId, tgtId, opt, lS, lT, allTargets };

  const dist    = _tokenAttackDistance(src, tgt);
  const atkBase = opt.toucher !== null && opt.toucher !== undefined ? opt.toucher : (lS.displayAttack ?? 5);
  const sn      = n => n>0?`+${n}`:n<0?`${n}`:'';
  const tag     = (txt, col='var(--text-dim)') =>
    `<span style="font-size:.6rem;color:${col};margin-left:.05rem">(${txt})</span>`;

  // ── Formule toucher ────────────────────────────────────────────────
  let toucherFormula;
  if (opt.toucherMod !== undefined) {
    const p = [`<code style="font-size:.88rem;color:var(--gold)">1d20</code>`];
    if (opt.toucherMod !== 0)
      p.push(`<span style="font-size:.85rem;color:var(--gold)">${sn(opt.toucherMod)}</span>${tag(opt.toucherStatLabel)}`);
    if (opt.toucherSetBonus > 0)
      p.push(`<span style="font-size:.85rem;color:#22c38e">+${opt.toucherSetBonus}</span>${tag('Set','#22c38e')}`);
    toucherFormula = p.join(' ');
  } else {
    toucherFormula = `<code style="font-size:.88rem;color:var(--gold)">1d20</code>`
      + (atkBase!==0 ? ` <span style="font-size:.82rem;color:var(--text-muted)">${sn(atkBase)}</span>` : '');
  }

  // ── Formule dégâts / soin ────────────────────────────────────────────
  const dmgAccent = opt.isHeal ? '#22c38e' : '#ef4444';
  let degatsFormula;
  if (opt.rawDice !== undefined) {
    const p = [`<code style="font-size:.88rem;color:${dmgAccent}">${opt.rawDice}</code>`];
    if (opt.dmgStatMod)
      p.push(`<span style="font-size:.85rem;color:${dmgAccent}">${sn(opt.dmgStatMod)}</span>${tag(opt.dmgStatLabel)}`);
    if (opt.maitriseBonus > 0)
      p.push(`<span style="font-size:.85rem;color:#f59e0b">+${opt.maitriseBonus}</span>${tag('Maîtrise')}`);
    degatsFormula = p.join(' ');
  } else {
    degatsFormula = `<code style="font-size:.88rem;color:${dmgAccent}">${_esc(opt.dice)}</code>`;
  }

  const inpStyle = `width:52px;padding:4px 6px;text-align:center;font-size:.88rem;border-radius:7px;
    border:1px solid var(--border);background:var(--bg-base,var(--bg));color:var(--text);font-family:inherit`;

  // Bloc central conditionnel selon le type
  const isCastOnly = opt.isCaSort || opt.isUtil;
  const btnColor   = opt.isHeal ? '#22c38e' : isCastOnly ? '#b47fff' : 'var(--gold,#f59e0b)';
  const btnFg      = opt.isHeal || isCastOnly ? '#fff' : '#1a1a1a';
  const btnLabel   = opt.isHeal ? '💚 Soigner !' : isCastOnly ? '✨ Activer !' : '🎲 Lancer !';

  // ── Preview d'interaction (immunité / résistance / faiblesse / absorption) ──
  // Aperçu donné pour l'attaque offensive uniquement, et seulement si la cible
  // est une créature liée au bestiaire (les joueurs n'ont pas de profil).
  let interactionPreviewHtml = '';
  if (!isCastOnly && !opt.isHeal && opt.damageTypeId) {
    const targetIdsPrev = (_atkCtx?.allTargets?.length ? _atkCtx.allTargets : [tgtId]);
    const buckets = {}; // interactionLabel → count
    for (const tid of targetIdsPrev) {
      const td = _tokens[tid]?.data;
      if (!td || td.type !== 'enemy' || !td.beastId) continue;
      const inter = _previewDamageInteraction(opt.damageTypeId, _bestiary[td.beastId]);
      if (inter) buckets[inter] = (buckets[inter] || 0) + 1;
    }
    const entries = Object.entries(buckets);
    if (entries.length) {
      const isMulti = targetIdsPrev.length > 1;
      const badges = entries.map(([label, n]) => {
        const meta = DMG_INTERACTIONS[label] || { icon: 'ℹ️', color: 'var(--text-dim)', short: '' };
        return `<span style="display:inline-flex;align-items:center;gap:.25rem;font-size:.7rem;font-weight:700;
                  color:${meta.color};background:${meta.color}1a;border:1px solid ${meta.color}55;
                  padding:.18rem .45rem;border-radius:999px">
                  ${meta.icon} ${_esc(label)}${isMulti ? ` ×${n}` : ''}
                  <span style="font-size:.6rem;font-weight:400;opacity:.8">${meta.short}</span>
                </span>`;
      }).join(' ');
      interactionPreviewHtml = `<div style="grid-column:1/-1;display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;
        font-size:.65rem;color:var(--text-dim);padding:.3rem .1rem 0">
        <span>🎯 Cible :</span>${badges}
      </div>`;
    }
  }

  const centerBlock = isCastOnly ? `
    <div style="background:var(--bg-elevated);border-radius:10px;padding:.85rem;margin-bottom:.85rem;
                display:flex;align-items:center;gap:.6rem">
      <span style="font-size:1.2rem">${opt.icon}</span>
      <span style="font-size:.82rem;color:var(--text);flex:1">${degatsFormula}</span>
    </div>
  ` : opt.isHeal ? `
    <div style="background:var(--bg-elevated);border-radius:10px;padding:.7rem .85rem;margin-bottom:.85rem">
      <div style="display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;row-gap:.6rem;column-gap:.5rem">
        <div style="grid-column:1/3"></div>
        <span style="font-size:.55rem;text-align:center;color:var(--text-dim)">±mod</span>
        <span style="font-size:.55rem;text-align:center;color:var(--text-dim)">+dés</span>
        <span style="font-size:.68rem;color:#22c38e;white-space:nowrap">💚 Soin</span>
        <div style="display:flex;align-items:center;gap:.28rem;flex-wrap:wrap;min-width:0">${degatsFormula}</div>
        <input type="number" id="atk-bonus-dmg" value="0" style="${inpStyle}" placeholder="0" title="Bonus / malus flat au soin">
        <input type="number" id="atk-bonus-dmg-dice" value="0" min="-9" max="20" style="${inpStyle}" placeholder="0" title="Dés bonus au soin (même type de dé)">
      </div>
    </div>
  ` : `
    <div style="background:var(--bg-elevated);border-radius:10px;padding:.7rem .85rem;margin-bottom:.85rem">
      <div style="display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;row-gap:.6rem;column-gap:.5rem">
        <div style="grid-column:1/3"></div>
        <span style="font-size:.55rem;text-align:center;color:var(--text-dim)">±mod</span>
        <span style="font-size:.55rem;text-align:center;color:var(--text-dim)">+dés</span>
        <span style="font-size:.68rem;color:var(--text-dim);white-space:nowrap">🎯 Toucher</span>
        <div style="display:flex;align-items:center;gap:.28rem;flex-wrap:wrap;min-width:0">${toucherFormula}</div>
        <input type="number" id="atk-bonus-hit" value="0" style="${inpStyle}" placeholder="0" title="Bonus flat au toucher">
        <input type="number" id="atk-bonus-hit-dice" value="0" min="-9" max="20" style="${inpStyle}" placeholder="0" title="d20 supplémentaires au toucher (sommés)">

        <div style="grid-column:1/-1;height:1px;background:var(--border);margin:-.1rem 0"></div>

        <span style="font-size:.68rem;color:var(--text-dim);white-space:nowrap">⚔️ Dégâts</span>
        <div style="display:flex;align-items:center;gap:.28rem;flex-wrap:wrap;min-width:0">
          ${opt.damageTypeIcon ? `<span style="font-size:.85rem;color:${opt.damageTypeColor||'#9ca3af'}">${opt.damageTypeIcon}</span>` : ''}
          ${degatsFormula}
        </div>
        <input type="number" id="atk-bonus-dmg" value="0" style="${inpStyle}" placeholder="0" title="Bonus flat aux dégâts">
        <input type="number" id="atk-bonus-dmg-dice" value="0" min="-9" max="20" style="${inpStyle}" placeholder="0" title="Dés supplémentaires aux dégâts (même type)">
        ${ (opt.typeRules?.missEffect === 'half') ? `<div style="grid-column:1/-1;display:flex;align-items:center;gap:.3rem;
          font-size:.65rem;color:#b47fff;padding:.25rem .1rem 0">
          <span>✦</span><span>½ dégâts garantis même en cas d'échec</span>
        </div>` : (opt.typeRules?.missEffect === 'full') ? `<div style="grid-column:1/-1;display:flex;align-items:center;gap:.3rem;
          font-size:.65rem;color:#f97316;padding:.25rem .1rem 0">
          <span>✦</span><span>Dégâts complets même en cas d'échec</span>
        </div>` : ''}
        ${interactionPreviewHtml}
      </div>
    </div>

    <!-- Sélecteur de mode -->
    <div style="margin-bottom:.85rem">
      <div style="font-size:.6rem;text-transform:uppercase;letter-spacing:.09em;color:var(--text-dim);margin-bottom:.4rem">Mode de lancer</div>
      <div style="display:flex;gap:2px;background:var(--border);border-radius:9px;padding:3px">
        <button id="atk-mode-dis" onclick="window._vttSetMode('dis')"
          style="flex:1;padding:.5rem .3rem;border:none;border-radius:6px;cursor:pointer;font-family:inherit;
                 font-size:.7rem;line-height:1.35;background:transparent;color:var(--text-dim);transition:none">
          <div style="font-size:.9rem">⬇</div>Désavantage
        </button>
        <button id="atk-mode-normal" onclick="window._vttSetMode('normal')"
          style="flex:1;padding:.5rem .3rem;border:none;border-radius:6px;cursor:pointer;font-family:inherit;
                 font-size:.75rem;font-weight:700;background:var(--bg-elevated);color:var(--text)">
          Normal
        </button>
        <button id="atk-mode-adv" onclick="window._vttSetMode('adv')"
          style="flex:1;padding:.5rem .3rem;border:none;border-radius:6px;cursor:pointer;font-family:inherit;
                 font-size:.7rem;line-height:1.35;background:transparent;color:var(--text-dim);transition:none">
          <div style="font-size:.9rem">⬆</div>Avantage
        </button>
      </div>
    </div>
  `;

  openModal(`${opt.icon} ${opt.label}`, `
    <div class="vtt-form" style="min-width:260px;max-width:340px">

      <!-- En-tête : retour + attaquant → cible(s) -->
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.85rem">
        <button onclick="window._vttBackToAtk()"
          style="flex-shrink:0;display:flex;align-items:center;gap:.25rem;background:none;
                 border:1px solid var(--border);border-radius:7px;color:var(--text-dim);
                 cursor:pointer;font-family:inherit;font-size:.75rem;padding:.3rem .55rem;
                 white-space:nowrap">
          ← Retour
        </button>
        <div style="flex:1;min-width:0;text-align:center;overflow:hidden;text-overflow:ellipsis;font-size:.82rem">
          <strong>${_esc(lS.displayName??src.name)}</strong>
          <span style="color:var(--text-dim);margin:0 .3rem">→</span>
          ${allTargets && allTargets.length > 1
            ? `<strong style="color:#4f8cff">🎯 ${allTargets.length} cibles</strong>`
            : `<strong style="color:${opt.isHeal?'#22c38e':'#ef4444'}">${_esc(lT.displayName??tgt.name)}</strong>`}
        </div>
        <span style="flex-shrink:0;font-size:.62rem;color:var(--text-dim);background:var(--bg-elevated);
                     padding:.18rem .45rem;border-radius:999px">${dist}c</span>
      </div>
      ${allTargets && allTargets.length > 1 ? `
      <div style="display:flex;flex-wrap:wrap;gap:.3rem;margin-bottom:.7rem">
        ${allTargets.map(id => {
          const td = _tokens[id]?.data;
          const nm = td ? (_live(td).displayName ?? td.name ?? id) : id;
          return `<span style="font-size:.65rem;padding:.15rem .45rem;border-radius:999px;
            background:rgba(79,140,255,.12);border:1px solid rgba(79,140,255,.3);color:#4f8cff">${_esc(nm)}</span>`;
        }).join('')}
      </div>` : ''}

      ${centerBlock}

      <!-- Infos zone / multi-cibles + PM -->
      ${(opt.zoneW>0||opt.zoneH>0) || (opt.nbCibles||1) > 1 || opt.pmCost > 0 || (opt.pmCost===0 && opt.basePm>0) ? `
      <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.7rem">
        ${(opt.zoneW>0||opt.zoneH>0)?`<span style="font-size:.7rem;color:#f97316;display:flex;align-items:center;gap:.25rem">
          📐 Zone <strong style="color:#fde047">${opt.zoneW}×${opt.zoneH} cases</strong>
          · <strong>${allTargets?.length||1}</strong> cible${(allTargets?.length||1)>1?'s':''}
          ${opt.pmCost===0&&opt.basePm>0?'<span style="color:#22c38e;font-size:.65rem">(PM déjà payé)</span>':''}
        </span>`:''}
        ${!(opt.zoneW>0||opt.zoneH>0)&&(opt.nbCibles||1)>1?`<span style="font-size:.7rem;color:#4f8cff;display:flex;align-items:center;gap:.25rem">
          🎯 <strong>${opt.nbCibles}</strong> cibles différentes
          ${opt.pmCost===0&&opt.basePm>0?'<span style="color:#22c38e;font-size:.65rem">(PM déjà payé)</span>':''}
        </span>`:''}
        ${opt.pmCost>0?`<span style="font-size:.7rem;color:#b47fff">✨ ${opt.pmCost} PM</span>`:''}
        ${opt.pmCost===0&&opt.basePm>0&&(opt.nbCibles||1)<=1&&!(opt.zoneW>0||opt.zoneH>0)?`<span style="font-size:.7rem;color:#22c38e">✨ Gratuit</span>`:''}
      </div>` : ''}

      <!-- Bouton Lancer -->
      <input type="hidden" id="atk-mode" value="normal">
      <button onclick="window._vttRollAttack()"
        style="width:100%;height:46px;border:none;border-radius:10px;cursor:pointer;font-family:inherit;
               font-size:.95rem;font-weight:700;letter-spacing:.02em;
               background:${btnColor};color:${btnFg}">
        ${btnLabel}
      </button>

    </div>`);
};

window._vttCancelAtk      = () => { _atkCtx=null; closeModalDirect(); };
window._closeActionModal  = () => closeModalDirect();

/** Affiche le sélecteur d'élément pour une arme magique. */
function _showElementPicker(srcId, tgtId, optIdx) {
  const opt = _atkOptsCache[`${srcId}__${tgtId}`]?.[optIdx];
  if (!opt) return;
  const src = _tokens[srcId]?.data, tgt = _tokens[tgtId]?.data;
  if (!src || !tgt) return;
  const lS = _live(src), lT = _live(tgt);

  const charElements  = opt.charElements || [];
  const availableTypes = (_damageTypes || []).filter(t => charElements.includes(t.id));

  // Si aucun élément disponible → frappe physique par défaut
  if (availableTypes.length === 0) {
    const physRules = getDamageTypeRules(_damageTypes, 'physique');
    const physType  = getDamageTypeById(_damageTypes, 'physique');
    _atkOptsCache[`${srcId}__${tgtId}`][optIdx] = {
      ...opt, isMagicWeapon: false,
      typeRules: physRules,
      damageTypeIcon: physType?.icon || '',
      damageTypeColor: physType?.color || '',
    };
    // Proceed directly — re-call _vttPickOpt now that isMagicWeapon is false
    window._vttPickOpt(srcId, tgtId, optIdx);
    return;
  }

  openModal(`${opt.icon} ${opt.label} — Élément`, `
    <div class="vtt-form" style="min-width:260px;max-width:340px">
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.85rem">
        <button onclick="window._vttBackToAtk()"
          style="flex-shrink:0;display:flex;align-items:center;gap:.25rem;background:none;
                 border:1px solid var(--border);border-radius:7px;color:var(--text-dim);
                 cursor:pointer;font-family:inherit;font-size:.75rem;padding:.3rem .55rem;
                 white-space:nowrap">← Retour</button>
        <div style="flex:1;min-width:0;text-align:center;overflow:hidden;text-overflow:ellipsis;
                    white-space:nowrap;font-size:.82rem">
          <strong>${_esc(lS.displayName??src.name)}</strong>
          <span style="color:var(--text-dim);margin:0 .3rem">→</span>
          <strong style="color:#ef4444">${_esc(lT.displayName??tgt.name)}</strong>
        </div>
      </div>
      <div style="font-size:.72rem;color:var(--text-dim);margin-bottom:.6rem;text-align:center">
        🔮 Choisir l'élément de l'attaque
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:.45rem">
        ${availableTypes.map(t => `
          <button onclick="window._vttPickElement('${srcId}','${tgtId}',${optIdx},'${t.id}')"
            style="padding:.55rem .4rem;border-radius:10px;cursor:pointer;font-family:inherit;
                   border:2px solid ${t.color||'var(--border)'};
                   background:${t.color||'var(--border)'}18;
                   color:${t.color||'var(--text)'};font-weight:700;font-size:.82rem;
                   display:flex;align-items:center;justify-content:center;gap:.25rem;
                   transition:background .12s">
            <span>${t.icon||''}</span><span>${_esc(t.label)}</span>
          </button>`).join('')}
      </div>
      <div style="text-align:right;margin-top:.75rem">
        <button class="btn-secondary" data-action="close-modal">Annuler</button>
      </div>
    </div>`);
}

window._vttPickElement = (srcId, tgtId, optIdx, elementId) => {
  const cacheKey = `${srcId}__${tgtId}`;
  const opt = _atkOptsCache[cacheKey]?.[+optIdx];
  if (!opt) return;
  const typeRules  = getDamageTypeRules(_damageTypes, elementId);
  const elemType   = getDamageTypeById(_damageTypes, elementId);
  _atkOptsCache[cacheKey][+optIdx] = {
    ...opt,
    isMagicWeapon:    false,
    typeRules,
    damageTypeId:     elementId,
    damageTypeIcon:   elemType?.icon  || '',
    damageTypeColor:  elemType?.color || '',
  };
  closeModalDirect();
  window._vttPickOpt(srcId, tgtId, +optIdx);
};

/** Retourne à la liste de sélection d'attaque sans annuler le combat. */
window._vttBackToAtk  = () => {
  const ctx = _atkCtx;
  closeModalDirect();
  _atkCtx = null;
  if (ctx) _execAttack(ctx.srcId, ctx.tgtId);
};

/** Met à jour le toggle Désavantage / Normal / Avantage. */
window._vttSetMode = (mode) => {
  const cfg = {
    dis:    { bg:'rgba(239,68,68,.18)',  color:'#f87171', weight:'700' },
    normal: { bg:'var(--bg-elevated)',   color:'var(--text)', weight:'700' },
    adv:    { bg:'rgba(34,195,142,.18)', color:'#22c38e', weight:'700' },
  };
  const off = { bg:'transparent', color:'var(--text-dim)', weight:'400' };
  ['dis','normal','adv'].forEach(m => {
    const el = document.getElementById(`atk-mode-${m}`);
    if (!el) return;
    const s = m === mode ? cfg[m] : off;
    el.style.background  = s.bg;
    el.style.color       = s.color;
    el.style.fontWeight  = s.weight;
  });
  const inp = document.getElementById('atk-mode');
  if (inp) inp.value = mode;
};

// ═══════════════════════════════════════════════════════════════════
// MULTI-CIBLAGE — sélection visuelle pour les sorts multi-cibles
// ═══════════════════════════════════════════════════════════════════

/** Centre pixel d'un token dans le repère Konva (tient compte de la taille W×H). */
function _tokenCenter(t) {
  const d = _tokenDims(t);
  return { x: t.col * CELL + d.w * CELL / 2, y: t.row * CELL + d.h * CELL / 2 };
}

/** Dessine une ligne pointillée src→tgt sur le layer token. */
function _mtDrawLine(srcData, tgtData, color) {
  const K = window.Konva; if (!K || !_layers.token) return null;
  const s = _tokenCenter(srcData), t = _tokenCenter(tgtData);
  const line = new K.Line({
    points: [s.x, s.y, t.x, t.y],
    stroke: color || '#c084fc',
    strokeWidth: 2.5,
    dash: [10, 6],
    lineCap: 'round',
    opacity: 0.9,
    listening: false,
    name: 'mt-line',
  });
  _layers.token.add(line);
  _layers.token.batchDraw();
  return line;
}

/** Supprime toutes les lignes du contexte local. */
function _mtClearLines() {
  if (!_mtCtx?.lines) return;
  _mtCtx.lines.forEach(l => l.destroy());
  _mtCtx.lines.clear();
  _layers.token?.batchDraw();
}

/** Supprime les lignes distantes (broadcast). */
function _clearRemoteLines() {
  _layers.token?.find('.remote-mt-line').forEach(l => l.destroy());
  _layers.token?.batchDraw();
}

/** Affiche ou met à jour le HUD flottant. */
function _mtRefreshHud() {
  const existing = document.getElementById('vtt-mt-hud');
  if (existing) existing.remove();
  if (!_mtCtx) return;

  const { opt, targets, maxTargets } = _mtCtx;
  const names = targets.map(id => {
    const td = _tokens[id]?.data;
    return td ? (_live(td).displayName ?? td.name ?? id) : id;
  });
  const remaining = maxTargets - targets.length;

  const div = document.createElement('div');
  div.id = 'vtt-mt-hud';
  div.className = 'vtt-mt-hud';
  div.innerHTML = `
    <div class="vtt-mt-hud-header">
      <span>${opt.icon} <strong>${_esc(opt.label)}</strong></span>
      <span class="vtt-mt-hud-count">${targets.length} / ${maxTargets}</span>
    </div>
    <div class="vtt-mt-hud-chips">
      ${names.map(n => `<span class="vtt-mt-chip vtt-mt-chip--sel">${_esc(n)}</span>`).join('')}
      ${remaining > 0 ? `<span class="vtt-mt-chip vtt-mt-chip--empty">+${remaining} cible${remaining > 1 ? 's' : ''}</span>` : ''}
    </div>
    <div class="vtt-mt-hud-hint">Cliquez sur les tokens cibles · Entrée = valider</div>
    <div class="vtt-mt-hud-actions">
      <button class="vtt-mt-btn-cancel" onclick="window._mtCancel()">✕ Annuler</button>
      <button class="vtt-mt-btn-validate" onclick="window._mtValidate()"
        ${targets.length === 0 ? 'disabled' : ''}>✓ Valider (${targets.length})</button>
    </div>`;
  document.body.appendChild(div);

  // Entrée = valider
  const _hudKey = e => { if (e.key === 'Enter') window._mtValidate(); if (e.key === 'Escape') window._mtCancel(); };
  div._hudKey = _hudKey;
  document.addEventListener('keydown', _hudKey, { once: false });
  div._removeKey = () => document.removeEventListener('keydown', _hudKey);
}

/** Broadcast l'état du ciblage à tous les clients via Firestore. */
async function _mtBroadcast() {
  const uid = STATE.user?.uid || 'anon';
  if (!_mtCtx) {
    await setDoc(_castingRef(uid), { active: false }, { merge: true }).catch(() => {});
    return;
  }
  const { srcId, targets, opt } = _mtCtx;
  await setDoc(_castingRef(uid), {
    active: true, srcId, targets,
    spellName: opt.label, spellIcon: opt.icon,
    pageId: _activePage?.id || null,
    updatedAt: Date.now(),
  }).catch(() => {});
}

/** Supprime lignes, HUD, contexte et broadcast. */
function _mtClear(broadcast = true) {
  _zoneClear();
  const hud = document.getElementById('vtt-mt-hud');
  if (hud?._removeKey) hud._removeKey();
  hud?.remove();
  _mtClearLines();
  _mtCtx = null;
  if (broadcast) {
    const uid = STATE.user?.uid || 'anon';
    setDoc(_castingRef(uid), { active: false }, { merge: true }).catch(() => {});
  }
}

/** Entre en mode ciblage pour un sort multi-cibles. */
function _startMultiTarget(srcId, firstTgtId, opt, optIdx) {
  _mtClear(false);
  _mtCtx = { srcId, opt, optIdx, targets: [firstTgtId], maxTargets: opt.nbCibles, lines: new Map() };

  const srcData = _tokens[srcId]?.data, tgtData = _tokens[firstTgtId]?.data;
  if (srcData && tgtData) {
    const line = _mtDrawLine(srcData, tgtData);
    if (line) _mtCtx.lines.set(firstTgtId, line);
  }

  _mtRefreshHud();
  _mtBroadcast();
}

/** Bascule une cible dans/hors de la sélection. */
function _mtToggleTarget(tgtId) {
  if (!_mtCtx) return;
  const { srcId, targets, maxTargets, lines } = _mtCtx;
  const idx = targets.indexOf(tgtId);

  if (idx !== -1) {
    targets.splice(idx, 1);
    lines.get(tgtId)?.destroy();
    lines.delete(tgtId);
    _layers.token?.batchDraw();
  } else {
    if (targets.length >= maxTargets) {
      showNotif(`Maximum ${maxTargets} cibles pour ce sort`, 'error');
      return;
    }
    const srcData = _tokens[srcId]?.data, tgtData = _tokens[tgtId]?.data;
    if (srcData && tgtData) {
      const portee = _mtCtx.opt.portee || 1;
      const dist = _tokenAttackDistance(srcData, tgtData, portee);
      if (dist > portee) {
        showNotif(`Hors de portée (${dist}c — portée du sort : ${portee}c)`, 'error');
        return;
      }
    }
    targets.push(tgtId);
    if (srcData && tgtData) {
      const line = _mtDrawLine(srcData, tgtData);
      if (line) lines.set(tgtId, line);
    }
  }

  _mtRefreshHud();
  _mtBroadcast();
}

window._mtCancel = () => { _mtClear(); showNotif('Ciblage annulé', 'info'); };

window._mtValidate = () => {
  if (!_mtCtx || _mtCtx.targets.length === 0) return;
  const { srcId, opt, optIdx, targets } = _mtCtx;

  // Stocker les cibles avant de vider le contexte
  _mtPending = [...targets];
  _mtClear(true);

  // Rouvrir le modal d'attaque pour cette sélection (en sautant le re-ciblage)
  // On utilise la première cible comme tgtId pour l'affichage modal
  const firstTgt = targets[0];
  const cacheKey = `${srcId}__${firstTgt}`;
  // Le cache peut ne pas exister pour firstTgt si ce n'est pas la cible initiale
  // → on reconstruire le cache pour cette cible
  const src = _tokens[srcId]?.data; if (!src) { _mtPending = null; return; }
  const tgtData = _tokens[firstTgt]?.data; if (!tgtData) { _mtPending = null; return; }
  const options = _buildAttackOptions(src);
  const inRange = options.filter(o => _tokenAttackDistance(src, tgtData, o.portee) <= o.portee);
  _atkOptsCache[cacheKey] = inRange;

  // Appeler _vttPickOpt — _mtPending non null empêche la re-entrée en mode ciblage
  window._vttPickOpt(srcId, firstTgt, optIdx);
};

// ── Zone AoE ──────────────────────────────────────────────────────────

/** Supprime la prévisualisation zone et son HUD. */
function _zoneClear() {
  const hud = document.getElementById('vtt-zone-hud');
  if (hud?._removeKey) hud._removeKey();
  hud?.remove();
  _zonePreview?.destroy();
  _zonePreview = null;
  _zoneCtx = null;
  _layers.token?.batchDraw();
}

/** (Re)Construit le rectangle Konva de prévisualisation. */
function _buildZonePreview() {
  if (!_zoneCtx || !_layers.token) return;
  _zonePreview?.destroy();
  const K = window.Konva;
  const { wPx, hPx, x, y } = _zoneCtx;
  const group = new K.Group({ x, y, listening: false, name: 'zone-preview' });
  group.add(new K.Rect({
    x: -wPx / 2, y: -hPx / 2,
    width: wPx, height: hPx,
    fill: 'rgba(253,224,71,0.22)',
    stroke: '#fde047',
    strokeWidth: 3, dash: [10, 5],
    cornerRadius: 3, listening: false,
  }));
  // Halo intérieur pour la lisibilité sur fond clair ou sombre
  group.add(new K.Rect({
    x: -wPx / 2 + 2, y: -hPx / 2 + 2,
    width: wPx - 4, height: hPx - 4,
    fill: 'transparent',
    stroke: 'rgba(253,224,71,0.45)',
    strokeWidth: 1, listening: false,
  }));
  group.add(new K.Text({
    x: -wPx / 2 + 5, y: -hPx / 2 + 4,
    text: `${_zoneCtx.opt.zoneW}×${_zoneCtx.opt.zoneH}c`,
    fill: '#fde047', fontSize: 11, fontStyle: 'bold', listening: false,
  }));
  _layers.token.add(group);
  _zonePreview = group;
  _layers.token.batchDraw();
}

/** Déplace la prévisualisation si la zone n'est pas posée. */
function _zoneUpdatePreview(wp) {
  if (!_zoneCtx || !_zonePreview || _zoneCtx.placed) return;
  const { wPx, hPx } = _zoneCtx;
  // Snapper le coin haut-gauche sur la grille (pas le centre)
  const snapX = Math.round((wp.x - wPx / 2) / CELL) * CELL + wPx / 2;
  const snapY = Math.round((wp.y - hPx / 2) / CELL) * CELL + hPx / 2;
  _zoneCtx.x = snapX; _zoneCtx.y = snapY;
  _zonePreview.position({ x: snapX, y: snapY });
  _layers.token.batchDraw();
}

/** Affiche le HUD de placement de zone. */
function _showZoneHud() {
  document.getElementById('vtt-zone-hud')?.remove();
  const opt = _zoneCtx.opt;
  const hud = document.createElement('div');
  hud.id = 'vtt-zone-hud';
  hud.className = 'vtt-mt-hud';
  hud.innerHTML = `
    <div class="vtt-mt-hud-header">
      <span>${_esc(opt.icon || '✨')} ${_esc(opt.label)}</span>
      <span class="vtt-mt-hud-count" style="color:#fde047;background:rgba(253,224,71,.12);border-color:rgba(253,224,71,.35)">📐 ${opt.zoneW}×${opt.zoneH} cases</span>
    </div>
    <div class="vtt-zone-hint">
      Déplacez · Clic = poser/reprendre · <kbd>R</kbd> = tourner · <kbd>Entrée</kbd> = valider
    </div>
    <div class="vtt-mt-hud-actions">
      <button class="vtt-mt-btn-cancel"   onclick="window._zoneCancel()">✕ Annuler</button>
      <button class="vtt-mt-btn-validate" onclick="window._zoneValidate()">✓ Valider</button>
    </div>`;
  const onKey = e => {
    if (e.key === 'Enter')              { e.preventDefault(); window._zoneValidate(); }
    if (e.key === 'Escape')             window._zoneCancel();
    if (e.key === 'r' || e.key === 'R') window._zoneRotate();
  };
  document.addEventListener('keydown', onKey);
  hud._removeKey = () => document.removeEventListener('keydown', onKey);
  document.body.appendChild(hud);
}

/** Entre en mode placement de zone pour un sort AoE. */
function _startZonePlacement(srcId, tgtId, opt, optIdx) {
  _zoneClear();
  _mtCtx = null; // annuler multi-cibles sans broadcast (zone prend la main)
  const wPx = opt.zoneW * CELL;  // zoneW/H = nombre de cases
  const hPx = opt.zoneH * CELL;
  // Sort d'invocation avec Dispersion : N placements successifs
  const nbInvoc = opt?.mods?.sentinelle?.nbInvocations || 1;
  _zoneCtx = {
    srcId, tgtId, opt, optIdx, wPx, hPx, x: 0, y: 0, placed: false,
    invocationsTotal: nbInvoc,
    invocationsDone: 0,
  };
  _buildZonePreview();
  _showZoneHud();
}

window._zoneCancel = () => { _zoneClear(); showNotif('Zone annulée', 'info'); };

window._zoneRotate = () => {
  if (!_zoneCtx) return;
  [_zoneCtx.wPx, _zoneCtx.hPx] = [_zoneCtx.hPx, _zoneCtx.wPx];
  _buildZonePreview();
  _zonePreview?.position({ x: _zoneCtx.x, y: _zoneCtx.y });
  _layers.token?.batchDraw();
};

window._zoneValidate = async () => {
  if (!_zoneCtx) return;
  const { srcId, opt, wPx, hPx, x, y } = _zoneCtx;

  // Vérification portée : centre de la zone vs lanceur
  const srcData = _tokens[srcId]?.data;
  if (srcData) {
    const sc = _tokenCenter(srcData);
    const distCells = Math.hypot(x - sc.x, y - sc.y) / CELL;
    if (distCells > (opt.portee || 1) + 0.5) {
      showNotif(`Zone hors de portée (${Math.round(distCells)}c — portée : ${opt.portee}c)`, 'error');
      return;
    }
  }

  // Détection des tokens dans le rectangle (centré sur x, y)
  const x1 = x - wPx / 2, x2 = x + wPx / 2;
  const y1 = y - hPx / 2, y2 = y + hPx / 2;
  const targets = Object.values(_tokens)
    .filter(e => {
      if (!e.data || e.data.pageId !== _activePage?.id) return false;
      if (!e.data.visible && !STATE.isAdmin) return false;
      // Exclure le lanceur seulement pour les sorts offensifs (soin/buff zone peut se cibler)
      if (e.data.id === srcId && !opt.isHeal && !opt.isCaSort && !opt.isUtil) return false;
      const tc = _tokenCenter(e.data);
      return tc.x >= x1 && tc.x <= x2 && tc.y >= y1 && tc.y <= y2;
    })
    .map(e => e.data.id);

  // ── Combo Sentinelle : spawn d'un token au centre de la zone ────────
  // Le token apparaît même sans cible présente (le piège attend les ennemis)
  // Avec Dispersion, plusieurs sentinelles peuvent être posées en boucle.
  if (opt?.mods?.sentinelle) {
    const col = Math.round((x - wPx / 2) / CELL);
    const row = Math.round((y - hPx / 2) / CELL);
    await _vttSpawnSummon({ kind: 'sentinelle', srcId, col, row, opt, durationTurns: 2 });
    _zoneCtx.invocationsDone = (_zoneCtx.invocationsDone || 0) + 1;
    const total = _zoneCtx.invocationsTotal || 1;
    const done  = _zoneCtx.invocationsDone;
    if (done < total) {
      // Reste des sentinelles à placer : on re-prépare le placement
      showNotif(`🪤 Sentinelle ${done}/${total} posée — place la suivante`, 'info');
      _zoneCtx.placed = false;
      // Rafraîchit le HUD pour montrer la progression
      _zoneCtx.opt = {
        ..._zoneCtx.opt,
        label: `${opt.label} (${done + 1}/${total})`,
      };
      _showZoneHud();
      // Reposionne la prévisualisation au centre du stage actuel
      _zonePreview?.position({ x: _zoneCtx.x, y: _zoneCtx.y });
      _layers.token?.batchDraw();
      return; // reste en mode placement
    }
    showNotif(`🪤 ${total} sentinelle${total > 1 ? 's' : ''} posée${total > 1 ? 's' : ''}`, 'success');
    // Si aucune cible présente, on s'arrête là (sentinelles posées, pas d'attaque)
    if (!targets.length) {
      _zoneClear();
      return;
    }
  } else if (!targets.length) {
    showNotif('Aucune cible dans la zone', 'error');
    return;
  }

  const { optIdx } = _zoneCtx;
  _zoneClear();

  // Flux identique à multi-cibles : stocker les cibles, ouvrir la modale d'attaque
  _mtPending = targets;
  const firstTgt = targets[0];
  const src = _tokens[srcId]?.data; if (!src) { _mtPending = null; return; }
  if (!_tokens[firstTgt]?.data) { _mtPending = null; return; }
  // Le sort zone est mis seul dans le cache à l'index 0 (portée déjà vérifiée sur la zone)
  _atkOptsCache[`${srcId}__${firstTgt}`] = [opt];
  window._vttPickOpt(srcId, firstTgt, 0);
};

/** Rendu des lignes de ciblage distantes (broadcast Firestore). */
function _renderRemoteCastings(docs) {
  if (!_layers.token) return;
  _clearRemoteLines();
  const myUid = STATE.user?.uid;
  docs.forEach(d => {
    const c = d.data();
    if (!c.active || c.pageId !== _activePage?.id || d.id === myUid) return;
    const srcEntry = Object.values(_tokens).find(e => e.data?.id === c.srcId);
    if (!srcEntry) return;
    (c.targets || []).forEach(tgtId => {
      const tgtEntry = Object.values(_tokens).find(e => e.data?.id === tgtId);
      if (!tgtEntry) return;
      const K = window.Konva;
      const s = _tokenCenter(srcEntry.data), t = _tokenCenter(tgtEntry.data);
      const line = new K.Line({
        points: [s.x, s.y, t.x, t.y],
        stroke: '#4f8cff', strokeWidth: 2,
        dash: [10, 6], lineCap: 'round',
        opacity: 0.55, listening: false, name: 'remote-mt-line',
      });
      _layers.token.add(line);
    });
  });
  _layers.token.batchDraw();
}

window._vttRollAttack = async () => {
  const ctx = _atkCtx; if (!ctx) return;
  const mode     = document.getElementById('atk-mode')?.value || 'normal';
  const bonusHit     = parseInt(document.getElementById('atk-bonus-hit')?.value)||0;
  const bonusDmg     = parseInt(document.getElementById('atk-bonus-dmg')?.value)||0;
  const bonusHitDice = parseInt(document.getElementById('atk-bonus-hit-dice')?.value)||0;
  const bonusDmgDice = parseInt(document.getElementById('atk-bonus-dmg-dice')?.value)||0;
  closeModalDirect();
  _atkCtx = null;

  const { srcId, tgtId, opt, lS, lT, allTargets } = ctx;
  const src=_tokens[srcId]?.data, tgt=_tokens[tgtId]?.data;
  if (!src||!tgt) return;
  // Liste des cibles : multi si allTargets, sinon cible unique
  const targetIds = allTargets && allTargets.length > 0 ? allTargets : [tgtId];

  const authorName = STATE.profile?.pseudo||STATE.profile?.prenom||STATE.user?.displayName||'MJ';
  const _deductPm  = async () => {
    if (opt.pmCost > 0 && src.characterId) {
      const c = _characters[src.characterId];
      if (c) await updateDoc(_chrRef(src.characterId), {pm: Math.max(0, (c.pm ?? calcPMMax(c)) - opt.pmCost)});
    }
  };
  const _markAttacked = async () => {
    if (_session?.combat?.active) await updateDoc(_tokRef(src.id), {attackedThisTurn:true}).catch(()=>{});
  };
  const _cleanup = () => {
    _tokens[srcId]?.shape?.findOne('.atk')?.visible(false);
    _tokens[_selected]?.shape?.findOne('.sel')?.visible(false);
    _selected=null; _attackSrc=null; _clearHL(); _renderInspector(null);
    _layers.token?.batchDraw();
  };

  /** Met à jour _multiCastFree et retourne le nombre de cibles restantes. */
  const _handleMultiCast = () => {
    if ((opt.nbCibles||1) <= 1 || opt.sortIdx === undefined) return 0;
    const freeKey = `${srcId}_${opt.sortIdx}`;
    const already = _multiCastFree.get(freeKey);
    if (already == null) {
      // Première cible (PM payé) : enregistrer les casts gratuits restants
      _multiCastFree.set(freeKey, opt.nbCibles - 1);
      setTimeout(() => _multiCastFree.delete(freeKey), 120_000);
      return opt.nbCibles - 1;
    }
    // Cast gratuit : décrémenter
    const nv = already - 1;
    nv > 0 ? _multiCastFree.set(freeKey, nv) : _multiCastFree.delete(freeKey);
    return nv;
  };
  const _ciblSuffix = r => r > 0 ? ` · 🎯 ${r} cible${r>1?'s':''} restante${r>1?'s':''}` : '';

  try {

    // ── Vérification PM ──────────────────────────────────────────────
    if (opt.pmCost > 0 && src.characterId) {
      const cPm = _characters[src.characterId];
      if (cPm) {
        const actualPm = cPm.pm ?? calcPMMax(cPm);
        if (actualPm < opt.pmCost) {
          showNotif(`⚠ PM insuffisants (${actualPm}/${opt.pmCost} requis)`, 'error');
          return;
        }
      }
    }

    // ── Combo Sort suspendu : on stocke l'opt + cible et on n'exécute pas l'effet ──
    // Le sort sera déclenché plus tard via le bouton dans l'inspector du porteur.
    if (opt.mods?.sortSuspendu && !_suspendedTriggerActive) {
      await _deductPm();
      const sharedSusp = _buffShared(opt, srcId);
      const suspBuff = {
        ...sharedSusp,
        type: 'suspended_spell',
        sortIdx: opt.sortIdx ?? null,
        tgtId: tgtId,
        icon: '🔮',
      };
      const existing = (src.buffs || []).filter(b => !(b.type === 'suspended_spell' && b.sortLabel === opt.label));
      await updateDoc(_tokRef(srcId), { buffs: [...existing, suspBuff] }).catch(() => {});
      showNotif(`🔮 ${opt.label} suspendu — à déclencher hors de votre tour`, 'success');
      _cleanup();
      return;
    }

    // ── Combo Coup de chance : applique le buff lucky_reroll au lanceur ──
    if (opt.mods?.coupChance) {
      const sharedLuck = _buffShared(opt, srcId);
      const luckBuff = {
        ...sharedLuck,
        type: 'lucky_reroll',
        charges: opt.mods.coupChance.charges,
        icon: '🍀',
      };
      const existing = (src.buffs || []).filter(b => !(b.type === 'lucky_reroll' && b.sortLabel === opt.label));
      await updateDoc(_tokRef(srcId), { buffs: [...existing, luckBuff] }).catch(() => {});
    }

    // ── Combo Aura punitive : applique l'affliction Torse aux ennemis dans la zone ──
    if (opt.mods?.auraPunitive) {
      const aura = opt.mods.auraPunitive;
      const radius = Math.max(1, aura.radius || 1);
      // Cibles dans la zone Manhattan radius autour du porteur (hors lanceur lui-même)
      const inZone = Object.values(_tokens).filter(e => {
        const d = e?.data; if (!d || d.id === srcId) return false;
        if (d.pageId !== _activePage?.id) return false;
        const dist = _tokenAttackDistance(src, d);
        return dist <= radius;
      });
      // Forge un opt "affliction torse" virtuel pour réutiliser _vttApplyAfflictions
      const auraOpt = {
        ...opt,
        mods: {
          ...opt.mods,
          affliction: {
            slot: 'torse',
            effect: opt.mods.affliction?.effect || '',
            element: aura.element,
            dd: aura.dd,
            saveStat: aura.saveStat,
          },
        },
      };
      await _vttApplyAfflictions(srcId, inZone.map(e => e.data.id), auraOpt);
      showNotif(`🌀 Aura punitive · ${inZone.length} ennemi${inZone.length > 1 ? 's' : ''} dans la zone`, 'success');
    }

    // ── Combo Arme invoquée : remplace temporairement l'arme principale ───
    // Le lanceur "manifeste" une arme magique (selon la matrice MJ de l'élément)
    // pour la durée du sort (2 tours par défaut). Pas de token séparé : le PJ utilise
    // simplement cette arme à la place de son équipement habituel pendant l'effet.
    if (opt.mods?.armeInvoquee) {
      const shared = _buffShared(opt, srcId);
      const arm    = getInvokedArm(_spellMatrices, opt.mods.armeInvoquee.elementId);
      const baseDmg = arm?.degats || '1d8';
      const nbP     = opt.mods.armeInvoquee.nbPuissance || 0;
      let armDice = baseDmg;
      if (nbP > 0) {
        const m = baseDmg.match(/^(\d+)(d\d+)(.*)$/i);
        armDice = m ? `${parseInt(m[1]) + nbP}${m[2]}${m[3]}` : `${baseDmg} +${nbP}d6`;
      }
      const wrBuff = {
        ...shared,
        type: 'weapon_replace',
        icon: '⚔️',
        weaponName:  arm?.weapon || 'Arme invoquée',
        weaponDice:  armDice,
        weaponRange: arm?.portee || 1,
        statToucher: arm?.statToucher || 'force',
        statDegats:  arm?.statDegats  || 'force',
        element:     opt.mods.armeInvoquee.elementId || null,
        note:        arm?.note || '',
      };
      const existing = (src.buffs || []).filter(b => !(b.type === 'weapon_replace' && b.sortLabel === opt.label));
      await updateDoc(_tokRef(srcId), { buffs: [...existing, wrBuff] }).catch(() => {});
      showNotif(`⚔️ ${wrBuff.weaponName} équipée (${armDice})`, 'success');
    }

    // ── Combo Allonge magique : applique un buff de portée +X cases sur les cibles ──
    // L'enchantement s'applique aux alliés (slot=arme) pour 2 tours par défaut.
    if (opt.mods?.allonge) {
      const shared = _buffShared(opt, srcId);
      const rangeBuff = { ...shared, type: 'range_bonus', icon: '🏹',
        bonus: opt.mods.allonge.cells, bonusMeters: opt.mods.allonge.meters };
      for (const tid of (allTargets && allTargets.length ? allTargets : [tgtId])) {
        const td = _tokens[tid]?.data; if (!td) continue;
        const existing = (td.buffs || []).filter(b => !(b.type === 'range_bonus' && b.sortLabel === opt.label));
        await updateDoc(_tokRef(tid), { buffs: [...existing, rangeBuff] }).catch(() => {});
      }
    }

    // ── Enchantements (slot arme / pieds / tête / torse) : buffs sur alliés ──
    if (opt.mods?.enchantArmeDmg || opt.mods?.enchantPieds || opt.mods?.enchantGeneric) {
      await _vttApplyEnchantBuffs(srcId, allTargets && allTargets.length ? allTargets : [tgtId], opt);
    }

    // ── Afflictions : JS Sa de la cible, buff (DoT, débuff mouvement, etc.) sur échec ──
    if (opt.mods?.affliction) {
      await _vttApplyAfflictions(srcId, allTargets && allTargets.length ? allTargets : [tgtId], opt);
    }

    // ── CA / Utilitaire : consommer PM, appliquer buff, loguer ─────────
    if (opt.isCaSort || opt.isUtil) {
      await _deductPm();
      await _markAttacked();
      const rCa = _handleMultiCast();

      // Appliquer le buff CA sur chaque cible (ou bouclier réactif si combo détecté)
      const buffResults = [];
      const isShieldReactive = !!opt.mods?.bouclierReactif;
      if (opt.isCaSort) {
        const round = _session?.combat?.round ?? 0;
        const dur   = opt.sortDuree ?? null;
        const baseRound = Math.max(1, round); // traiter round 0 comme round 1
        // Canalisé persistant : pas d'expiration automatique (jusqu'à rupture concentration)
      const isCanalise = !!opt.mods?.canalisePersistant;
      const concDD = opt.mods?.concentration?.dd ?? (isCanalise ? 11 : null);
      // Firestore : pas de `undefined` → spread conditionnel pour les champs facultatifs
      const _canFields = isCanalise ? { canalisePersistant: true, concentrationDD: concDD } : {};
      const newBuff = isShieldReactive ? {
          // Bouclier réactif : annule 1 attaque (pas de bonus CA)
          type: 'shield_reactive',
          tier: opt.mods.bouclierReactif.tier,         // 'mob' | 'elite' | 'boss'
          nbProt: opt.mods.bouclierReactif.nbProt,
          charges: 1,
          totalDuration: isCanalise ? null : dur,
          startRound: round,
          expiresAtRound: isCanalise ? null : (dur != null ? baseRound + dur - 1 : null),
          casterId: srcId,
          sortLabel: opt.label,
          icon: '🛡️',
          ..._canFields,
        } : {
          type: 'ca',
          bonus: opt.caBonus ?? 2,
          totalDuration: isCanalise ? null : dur,
          startRound: round,
          expiresAtRound: isCanalise ? null : (dur != null ? baseRound + dur - 1 : null),
          casterId: srcId,
          sortLabel: opt.label,
          icon: isCanalise ? '🧠' : '🛡',
          ..._canFields,
        };
        const buffType = newBuff.type;
        for (const curTgtId of targetIds) {
          const curTgtData = _tokens[curTgtId]?.data; if (!curTgtData) continue;
          // Filtre les buffs existants du même sort (anti-stack)
          const existingBuffs = (curTgtData.buffs || []).filter(b => !(b.type === buffType && b.sortLabel === opt.label));
          await updateDoc(_tokRef(curTgtId), { buffs: [...existingBuffs, newBuff] }).catch(()=>{});
          buffResults.push(_live(curTgtData).displayName ?? curTgtData.name);
        }
      }

      const targetsLabel = buffResults.length > 1
        ? buffResults.join(', ')
        : (lT.displayName ?? tgt.name);
      await addDoc(_logCol(), {
        type: 'cast',
        authorId: STATE.user?.uid||null, authorName,
        casterName: lS.displayName??src.name,
        characterImage: lS.displayImage||null,
        targetName: targetsLabel,
        optLabel: opt.label, pmCost: opt.pmCost,
        castEffect: opt.dice,
        createdAt: serverTimestamp(),
      }).catch(()=>{});
      const buffInfo = opt.isCaSort ? ` (+${opt.caBonus??2} CA${opt.sortDuree ? `, ${opt.sortDuree}t` : ''})` : '';
      showNotif(`✨ ${opt.label} activé !${buffInfo}${_ciblSuffix(rCa)}`, 'success');
      return;
    }

    // ── Helper : formule de dés effective (bonus dés dégâts) ────────
    const _effectiveDmgDice = formula => {
      if (!bonusDmgDice) return formula;
      const p = _parseDice(formula);
      if (!p) return formula;
      const newN = Math.max(1, p.n + bonusDmgDice);
      return `${newN}d${p.sides}` + (p.mod !== 0 ? (p.mod > 0 ? `+${p.mod}` : `${p.mod}`) : '');
    };

    // ── Soin : roll partagé, appliqué à toutes les cibles ───────────
    if (opt.isHeal) {
      const diceToRoll   = opt.rawDice || opt.dice;
      const effectiveDice = _effectiveDmgDice(diceToRoll);
      const healFixed    = (opt.maitriseBonus || 0) + bonusDmg;
      const healRaw      = _rollDice(effectiveDice);
      const healTotal  = Math.max(1, healRaw + healFixed);
      await _deductPm();
      await _markAttacked();

      // Appliquer à chaque cible
      const healResults = [];
      for (const curTgtId of targetIds) {
        const curTgtData = _tokens[curTgtId]?.data; if (!curTgtData) continue;
        const lCur = _live(curTgtData);
        const curHp = lCur.displayHp ?? 20, hpMax = lCur.displayHpMax ?? 20;
        const newHp = Math.min(hpMax, curHp + healTotal);
        await _setHp(curTgtData, newHp);
        healResults.push({ name: lCur.displayName ?? curTgtData.name, newHp, hpMax });
      }

      const isMultiHeal = healResults.length > 1;
      if (isMultiHeal) {
        await addDoc(_logCol(), {
          type: 'attack-multi', isHeal: true,
          authorId: STATE.user?.uid||null, authorName,
          attackerName: lS.displayName??src.name,
          characterImage: lS.displayImage||null,
          optLabel: opt.label,
          isCrit: false, isFumble: false, advMode: mode,
          hitD20: null, hitTotal: null,
          dmgFormula: opt.dice, dmgRawDice: opt.rawDice||null,
          dmgEffectiveDice: bonusDmgDice ? effectiveDice : null,
          dmgMaitriseBonus: opt.maitriseBonus??0,
          dmgRaw: healRaw, dmgBonus: bonusDmg, dmgBonusDice: bonusDmgDice||null,
          targets: healResults.map(r => ({ ...r, hit: true, halfDmg: false, dmgTotal: healTotal, targetCA: null })),
          createdAt: serverTimestamp(),
        }).catch(()=>{});
        showNotif(`💚 ${healTotal} PV soignés → ${healResults.map(r=>r.name).join(', ')}`, 'success');
      } else {
        const r = healResults[0];
        if (r) {
          await addDoc(_logCol(), {
            type:'attack', isHeal:true,
            authorId: STATE.user?.uid||null, authorName,
            attackerName: lS.displayName??src.name,
            characterImage: lS.displayImage||null,
            defenderName: r.name,
            optLabel: opt.label,
            dmgFormula: opt.dice, dmgRawDice: opt.rawDice||null,
            dmgEffectiveDice: bonusDmgDice ? effectiveDice : null,
            dmgMaitriseBonus: opt.maitriseBonus??0,
            dmgRaw: healRaw, dmgBonus: bonusDmg, dmgBonusDice: bonusDmgDice||null,
            dmgTotal: healTotal, newHp: r.newHp, hpMax: r.hpMax,
            createdAt: serverTimestamp(),
          }).catch(()=>{});
          showNotif(`💚 ${healTotal} PV soignés → ${r.name}`, 'success');
        }
      }
      return;
    }

    // ── Bouclier réactif : check des cibles, consomme charges, marque les "blocked" ──
    const attackerRank = _attackerRank(src);
    const blockedTargets = new Set();
    {
      const curRound = _session?.combat?.round ?? 0;
      for (const tid of targetIds) {
        const td = _tokens[tid]?.data;
        const buffs = td?.buffs || [];
        const shield = buffs.find(b =>
          b?.type === 'shield_reactive'
          && (b.charges == null || b.charges > 0)
          && (b.expiresAtRound == null || b.expiresAtRound >= curRound)
          && _shieldBlocks(b.tier, attackerRank)
        );
        if (!shield) continue;
        blockedTargets.add(tid);
        // Consommer la charge (1 charge → retire le buff ; >1 → décrémente)
        const remaining = (shield.charges == null) ? 0 : Math.max(0, shield.charges - 1);
        const newBuffs = remaining > 0
          ? buffs.map(b => b === shield ? { ...b, charges: remaining } : b)
          : buffs.filter(b => b !== shield);
        await updateDoc(_tokRef(tid), { buffs: newBuffs }).catch(() => {});
      }
    }

    // ── Attaque offensive — un seul roll d20, appliqué à chaque cible ──
    const roll1    = Math.floor(Math.random()*20)+1;
    const roll2    = mode !== 'normal' ? Math.floor(Math.random()*20)+1 : null;
    let d20        = mode === 'adv' ? Math.max(roll1, roll2)
                   : mode === 'dis' ? Math.min(roll1, roll2)
                   : roll1;
    // Combo Chance : RC abaissée (19-20, 17-20…) — élargit la plage critique
    const critThreshold = Math.max(2, Math.min(20, opt.mods?.chance?.rc ?? 20));
    let isCrit   = d20 >= critThreshold;
    let isFumble = d20 === 1;

    // ── Combo Coup de chance : relance si le d20 est sous le seuil de touche estimé ──
    // On vérifie le buff lucky_reroll sur le lanceur. Si charge dispo ET (fumble ou attaque
    // probablement ratée), on relance. Critère pragmatique : on relance si d20 < 10 (non-crit).
    const luckyReroll = (src.buffs || []).find(b =>
      b?.type === 'lucky_reroll' && (b.charges || 0) > 0
      && (b.expiresAtRound == null || (_session?.combat?.round ?? 0) === 0 || (_session?.combat?.round ?? 0) <= b.expiresAtRound)
    );
    let luckUsed = false;
    if (luckyReroll && !isCrit && d20 < 10) {
      const newRoll = Math.floor(Math.random() * 20) + 1;
      if (newRoll > d20) {
        d20 = newRoll;
        isCrit   = d20 >= critThreshold;
        isFumble = d20 === 1;
      }
      luckUsed = true;
      // Décrémente / retire le buff
      const remaining = luckyReroll.charges - 1;
      const newBuffs = remaining > 0
        ? (src.buffs || []).map(b => b === luckyReroll ? { ...b, charges: remaining } : b)
        : (src.buffs || []).filter(b => b !== luckyReroll);
      await updateDoc(_tokRef(srcId), { buffs: newBuffs }).catch(() => {});
    }
    const atkBase  = opt.toucher !== null && opt.toucher !== undefined ? opt.toucher : (lS.displayAttack ?? 5);
    // Dés supplémentaires au toucher (sommés au total)
    const extraHitRolls = [];
    let extraHitSum = 0;
    if (bonusHitDice !== 0) {
      const cnt = Math.abs(bonusHitDice);
      for (let k = 0; k < cnt; k++) {
        const r = Math.floor(Math.random() * 20) + 1;
        extraHitRolls.push(r);
        extraHitSum += bonusHitDice > 0 ? r : -r;
      }
    }
    const hitTotal = d20 + atkBase + bonusHit + extraHitSum;
    const rules      = opt.typeRules || {};
    const armorPen   = rules.armorPen || 0;
    const typeDmgBon = rules.dmgBonus || 0;
    const missEffect = rules.missEffect || 'none';

    const diceToRoll    = opt.rawDice || opt.dice;
    const effectiveDice = _effectiveDmgDice(diceToRoll);
    const dmgFixed      = opt.rawDice !== undefined ? ((opt.dmgStatMod || 0) + (opt.maitriseBonus || 0)) : 0;
    const totalFixed  = dmgFixed + bonusDmg + typeDmgBon;

    // ── Dés tirés UNE SEULE fois, partagés entre toutes les cibles ──────
    let sharedDmgRaw = 0, sharedDmgTotalHit = 0, sharedDmgTotalHalf = 0;
    let sharedCritNormalMax = 0, sharedCritRaw2 = 0, sharedCritFixed2 = 0;
    if (!isFumble) {
      if (isCrit) {
        sharedCritNormalMax = _maxDice(effectiveDice) + totalFixed;
        sharedCritRaw2      = _rollDice(effectiveDice);
        sharedCritFixed2    = totalFixed;
        sharedDmgRaw        = sharedCritRaw2;
        sharedDmgTotalHit   = sharedCritNormalMax + sharedCritRaw2 + sharedCritFixed2;
      } else {
        sharedDmgRaw      = _rollDice(effectiveDice);
        sharedDmgTotalHit = Math.max(1, sharedDmgRaw + totalFixed);
      }
      if (missEffect === 'half')  sharedDmgTotalHalf = Math.max(1, Math.floor(sharedDmgTotalHit / 2));
      else if (missEffect === 'full') sharedDmgTotalHalf = sharedDmgTotalHit;
    }

    // ── Bonus dégâts depuis buffs d'enchantement arme actifs sur le lanceur ──
    // Ne s'applique qu'aux attaques d'arme (id='weapon' ou 'npc_attack' ou bestiaire)
    // pour éviter de doubler les dégâts sur les sorts qui scalent déjà sur l'arme.
    const _isWeaponAttack = opt.id === 'weapon' || opt.id === 'npc_attack' || opt.id?.startsWith?.('beast_');
    let buffDmgBonus = 0;
    const buffDmgNotes = [];
    if (_isWeaponAttack && !isFumble) {
      const round_eff = _session?.combat?.round ?? 0;
      const srcDmgBuffs = (src.buffs || []).filter(b =>
        b.type === 'dmg_bonus' && b.slot === 'arme'
        && (b.expiresAtRound == null || round_eff === 0 || round_eff <= b.expiresAtRound)
      );
      for (const buff of srcDmgBuffs) {
        if (!buff.formula) continue;
        const rolled = _rollDice(buff.formula);
        buffDmgBonus += rolled;
        buffDmgNotes.push(`${buff.icon ?? '⚔️'} +${rolled} (${buff.sortLabel}: ${buff.formula})`);
      }
      if (buffDmgBonus > 0) {
        sharedDmgTotalHit += buffDmgBonus;
        if (sharedDmgTotalHalf > 0) sharedDmgTotalHalf += Math.floor(buffDmgBonus / 2);
      }
    }

    await _deductPm();
    await _markAttacked();

    // ── Appliquer les HP + collecter résultats par cible ──────────────
    const targetResults = [];
    for (const curTgtId of targetIds) {
      const curTgtData = _tokens[curTgtId]?.data;
      if (!curTgtData) continue;
      const lCurTgt = _live(curTgtData);

      const rawCA    = lCurTgt.displayDefense ?? 10;
      const targetCA = armorPen > 0 ? Math.round(rawCA * (1 - armorPen / 100)) : rawCA;
      // Bouclier réactif : annule complètement l'attaque (pas de touche, pas de demi-dégâts, pas de fumble visuel)
      const isBlocked = blockedTargets.has(curTgtId);
      const hit      = isBlocked ? false : (isCrit ? true : isFumble ? false : hitTotal >= targetCA);
      const halfDmg  = !isBlocked && !hit && missEffect !== 'none' && !isFumble;
      let dmgTotal   = hit ? sharedDmgTotalHit : halfDmg ? sharedDmgTotalHalf : 0;
      let interaction = null;

      const curHp = lCurTgt.displayHp ?? 20, hpMax = lCurTgt.displayHpMax ?? 20;
      let newHp = curHp;
      // Valeur AVANT interaction du profil de la créature (pour log "10 → 5").
      let dmgPre = dmgTotal;
      let dmgReduction = 0;
      if (hit || halfDmg) {
        if (curTgtData.type === 'enemy' && curTgtData.beastId) {
          const bEnt    = _bestiary[curTgtData.beastId];
          const result  = _applyDamageTypeInteraction(dmgTotal, opt.damageTypeId, bEnt);
          dmgTotal      = result.dmgTotal;
          interaction   = result.interaction;

          const realMax = _numOr(bEnt?.pvMax, 20);
          const realCur = curTgtData.hp !== null ? _numOr(curTgtData.hp, realMax) : realMax;
          // Plafonner par realMax pour éviter qu'une absorption (dmgTotal négatif)
          // ne soigne au-dessus du PV max de la créature.
          newHp = Math.max(0, Math.min(realMax, realCur - dmgTotal));
          const prevEst = curTgtData.pvCombatHp != null ? Math.max(0, parseInt(curTgtData.pvCombatHp)||0) : (lCurTgt.displayHpMax??realMax);
          const newEst  = Math.max(0, Math.min(realMax, prevEst - dmgTotal));
          await updateDoc(_tokRef(curTgtData.id), { hp: newHp, pvCombatHp: newEst });
        } else {
          // Set Lourd : réduction de 2 dégâts par coup, minimum 1 dégât
          if (dmgTotal > 0 && curTgtData.characterId) {
            const tgtChar = STATE.characters.find(x => x.id === curTgtData.characterId);
            if (tgtChar) {
              dmgReduction = getArmorSetData(tgtChar).modifiers.damageReduction || 0;
              if (dmgReduction > 0) dmgTotal = Math.max(1, dmgTotal - dmgReduction);
            }
          }
          newHp = Math.max(0, curHp - dmgTotal);
          await _setHp(curTgtData, newHp);
        }
      }
      targetResults.push({ name: lCurTgt.displayName ?? curTgtData.name, targetCA, hit, halfDmg, dmgTotal, dmgPre, dmgReduction, newHp, hpMax, interaction, shieldBlocked: isBlocked, _data: curTgtData });
    }

    // ── Combos post-attaque (Lacération, Déplacement, Drain, Concentration) ──
    const _mods = opt.mods || null;
    const modNotes = []; // notes textuelles pour la notif/log

    // ── JS Concentration auto : pour chaque cible qui a subi des dégâts et qui
    //    porte un sort canalisé actif, lance un JS Sagesse vs concentrationDD.
    //    En cas d'échec, retire le buff canalisé (et ses summons liés).
    for (const r of targetResults) {
      if (!(r.hit || r.halfDmg) || r.dmgTotal <= 0) continue;
      const td = r._data; if (!td?.buffs?.length) continue;
      const canalisedBuffs = td.buffs.filter(b => b?.canalisePersistant && b?.concentrationDD != null);
      if (!canalisedBuffs.length) continue;
      // Modificateur de Sagesse du PJ porteur (PNJ/Bestiaire : fallback +0)
      let sagMod = 0;
      if (td.characterId) {
        const cTgt = _characters[td.characterId];
        if (cTgt) sagMod = getMod(cTgt, 'sagesse');
      } else if (td.npcId) {
        sagMod = _npcStatMod(_npcs[td.npcId] || {}, 'sagesse');
      }
      for (const cb of canalisedBuffs) {
        const dd = cb.concentrationDD;
        const roll = Math.floor(Math.random() * 20) + 1;
        const tot = roll + sagMod;
        const success = roll === 20 || (roll !== 1 && tot >= dd);
        const tgtName = _live(td).displayName ?? td.name;
        if (success) {
          modNotes.push(`🧠 JS Sa ${roll}${sagMod>=0?'+':''}${sagMod}=${tot} vs DD${dd} · concentration tenue (${tgtName})`);
        } else {
          modNotes.push(`💢 JS Sa ${roll}${sagMod>=0?'+':''}${sagMod}=${tot} vs DD${dd} ÉCHEC · ${cb.sortLabel} rompu sur ${tgtName}`);
          // Retire le buff canalisé
          const remaining = (td.buffs || []).filter(b => b !== cb);
          await updateDoc(_tokRef(td.id), { buffs: remaining }).catch(() => {});
          // Supprime les summons liés (sentinelle/arme invoquée) du même lanceur si canalisés
          const summonsToKill = Object.values(_tokens).filter(e =>
            e?.data?.summonOwnerId === (cb.casterId || td.id)
            && e?.data?.summonCanalise
          );
          for (const s of summonsToKill) {
            await deleteDoc(_tokRef(s.data.id)).catch(() => {});
          }
        }
      }
    }

    if (_mods) {
      const round = _session?.combat?.round ?? 0;
      const baseRound = Math.max(1, round);

      for (const r of targetResults) {
        const wasHit = r.hit || r.halfDmg;
        if (!wasHit || !r._data) continue;
        const curTgtData = r._data;

        // ── Lacération : -CA brut sur la cible (plafonné selon rang) ────
        if (_mods.laceration) {
          const lac = _mods.laceration;
          const beast = curTgtData.beastId ? _bestiary[curTgtData.beastId] : null;
          const rang = (beast?.rang || 'classique').toLowerCase();
          const cap = (rang === 'elite' || rang === 'élite' || rang === 'boss') ? lac.maxElite : lac.max;
          const reduction = Math.min(lac.reduction, cap);
          const sortLabel = `Lacération · ${opt.label}`;
          const newBuff = {
            type: 'ca', bonus: -reduction,
            totalDuration: 2, startRound: round,
            expiresAtRound: baseRound + 2 - 1,
            sortLabel, icon: '🩸',
          };
          const existingBuffs = (curTgtData.buffs || []).filter(b => !(b.type === 'ca' && b.sortLabel === sortLabel));
          await updateDoc(_tokRef(curTgtData.id), { buffs: [...existingBuffs, newBuff] }).catch(() => {});
          modNotes.push(`🩸 CA −${reduction} → ${r.name}`);
        }

        // ── Déplacement (push/pull) ────────────────────────────────────
        if (_mods.deplacement && r.newHp > 0) {
          const moved = await _vttApplyDeplacement(src, curTgtData, _mods.deplacement.mode, _mods.deplacement.distance);
          if (moved > 0) {
            const verb = _mods.deplacement.mode === 'pull' ? '↙ tiré' : '↗ poussé';
            modNotes.push(`${verb} ${moved}c → ${r.name}`);
          }
        }
      }

      // ── Drain : soigne le lanceur d'un % des dégâts infligés ──
      // Formule : pct = 25% + 25% × nbProt (50/75/100/125% pour Prot×1/2/3/4)
      // Peut dépasser 100% des PV manquants (cap à hpMax), mais pas de surcharge
      if (_mods.drain && targetResults.some(r => r.hit || r.halfDmg)) {
        const totalDealt = targetResults.reduce((acc, r) => {
          if (!(r.hit || r.halfDmg)) return acc;
          // Utilise dmgPre (avant interaction immunité/absorption) pour le drain
          const base = (r.dmgPre != null && r.dmgPre > 0) ? r.dmgPre : Math.max(0, r.dmgTotal);
          return acc + base;
        }, 0);
        const healAmt = Math.max(1, Math.floor(totalDealt * _mods.drain.pct));
        const srcLive = _live(src);
        const srcHp = srcLive.displayHp ?? 20;
        const srcHpMax = srcLive.displayHpMax ?? 20;
        const newSrcHp = Math.min(srcHpMax, srcHp + healAmt);
        if (newSrcHp > srcHp) {
          await _setHp(src, newSrcHp);
          const pctLabel = Math.round(_mods.drain.pct * 100);
          modNotes.push(`🩸 Drain ${pctLabel}% → +${healAmt} PV (${srcLive.displayName ?? src.name})`);
        }
      }
    }

    // ── Un seul message dans le log ────────────────────────────────────
    // Strip _data (référence token interne, non sérialisable Firestore)
    const cleanResults = targetResults.map(({ _data, ...rest }) => rest);
    const isMulti = cleanResults.length > 1;
    if (isMulti) {
      await addDoc(_logCol(), {
        type: 'attack-multi',
        authorId: STATE.user?.uid||null, authorName,
        attackerName: lS.displayName??src.name,
        characterImage: lS.displayImage||null,
        optLabel: opt.label,
        isCrit, isFumble, advMode: mode,
        hitD20: d20, hitD20rolls: roll2 !== null ? [roll1, roll2] : [roll1],
        hitBase: atkBase, hitBonus: bonusHit, hitTotal,
        hitToucherMod: opt.toucherMod??null, hitToucherSetBonus: opt.toucherSetBonus??0,
        hitToucherStatLabel: opt.toucherStatLabel??null,
        dmgFormula: opt.dice, dmgRawDice: opt.rawDice||null,
        dmgEffectiveDice: bonusDmgDice ? effectiveDice : null,
        dmgStatMod: opt.dmgStatMod??null, dmgStatLabel: opt.dmgStatLabel??null,
        dmgMaitriseBonus: opt.maitriseBonus??0,
        dmgRaw: sharedDmgRaw, dmgBonus: bonusDmg, dmgBonusDice: bonusDmgDice||null,
        dmgFull: sharedDmgTotalHit, dmgFullHalf: sharedDmgTotalHalf,
        bonusHitDice: bonusHitDice||null, extraHitRolls: extraHitRolls.length ? extraHitRolls : null,
        critNormalMax: sharedCritNormalMax, critRaw2: sharedCritRaw2, critFixed2: sharedCritFixed2,
        damageTypeId: opt.damageTypeId||null, damageTypeIcon: opt.damageTypeIcon||null,
        damageTypeColor: opt.damageTypeColor||null,
        targets: cleanResults,
        createdAt: serverTimestamp(),
      }).catch(()=>{});
    } else {
      const r = cleanResults[0];
      if (r) await addDoc(_logCol(), {
        type: 'attack',
        authorId: STATE.user?.uid||null, authorName,
        attackerName: lS.displayName??src.name,
        characterImage: lS.displayImage||null,
        defenderName: r.name,
        optLabel: opt.label,
        isCrit, isFumble, advMode: mode,
        hitD20: d20, hitD20rolls: roll2 !== null ? [roll1, roll2] : [roll1],
        hitBase: atkBase, hitBonus: bonusHit, hitTotal,
        hitToucherMod: opt.toucherMod??null, hitToucherSetBonus: opt.toucherSetBonus??0,
        hitToucherStatLabel: opt.toucherStatLabel??null,
        targetCA: r.targetCA, hit: r.hit,
        dmgFormula: opt.dice, dmgRawDice: opt.rawDice||null,
        dmgEffectiveDice: bonusDmgDice ? effectiveDice : null,
        dmgStatMod: opt.dmgStatMod??null, dmgStatLabel: opt.dmgStatLabel??null,
        dmgMaitriseBonus: opt.maitriseBonus??0,
        dmgRaw: sharedDmgRaw, dmgBonus: bonusDmg, dmgBonusDice: bonusDmgDice||null,
        dmgTotal: r.dmgTotal, dmgFull: sharedDmgTotalHit, dmgPre: r.dmgPre ?? r.dmgTotal, dmgReduction: r.dmgReduction || 0,
        bonusHitDice: bonusHitDice||null, extraHitRolls: extraHitRolls.length ? extraHitRolls : null,
        critNormalMax: sharedCritNormalMax, critRaw2: sharedCritRaw2, critFixed2: sharedCritFixed2,
        halfDmg: r.halfDmg, newHp: r.newHp, hpMax: r.hpMax,
        damageTypeId: opt.damageTypeId||null, damageTypeIcon: opt.damageTypeIcon||null,
        damageTypeColor: opt.damageTypeColor||null,
        interaction: r.interaction || null,
        createdAt: serverTimestamp(),
      }).catch(()=>{});
    }

    // Notif consolidée
    const notifParts = cleanResults.map(r => {
      const nm = r.name;
      const interMeta = r.interaction ? DMG_INTERACTIONS[r.interaction] : null;
      const interTag  = interMeta ? ` ${interMeta.icon}${interMeta.short}` : '';
      const dmgLabel = r.dmgTotal < 0 ? `+${Math.abs(r.dmgTotal)}` : r.dmgTotal;
      return r.shieldBlocked ? `🛡️ Bouclier réactif · ${nm}`
           : isFumble       ? `💀 Fumble`
           : r.interaction === 'Immunité' && r.hit ? `🚫 Immunisé · ${nm}`
           : r.halfDmg     ? `✦ ${dmgLabel}(½)${interTag} → ${nm}`
           : !r.hit        ? `🎯 Raté vs ${nm}`
           : r.newHp===0   ? `💀 ${nm} tombe !`
           : isCrit        ? `💥 ${dmgLabel}${interTag} → ${nm}`
                           : `⚔️ ${dmgLabel}${interTag} → ${nm}`;
    });
    // Ajoute les notes de combo (Lacération, Déplacement, Drain) à la notif
    if (modNotes.length) notifParts.push(...modNotes);
    if (buffDmgNotes.length) notifParts.push(...buffDmgNotes);
    if (luckUsed) notifParts.unshift(`🍀 Coup de chance utilisé (d20 → ${d20})`);
    const anyHit = cleanResults.some(r => r.hit || r.halfDmg);
    showNotif(notifParts.join(' · '), anyHit ? 'success' : 'error');

  } catch (err) {
    console.error('[VTT] Erreur attaque', err);
    showNotif(`Erreur attaque : ${err?.message || err}`, 'error');
  }
  finally {
    // Consomme un éventuel "free cast one-shot" (déclenchement d'un sort suspendu)
    if (opt.sortIdx !== undefined) {
      _freeNextCast.delete(`${srcId}_${opt.sortIdx}`);
    }
    // Reset du flag de déclenchement de sort suspendu (le cast est terminé)
    _suspendedTriggerActive = false;
    _cleanup();
  }
};

// ═══════════════════════════════════════════════════════════════════
// INSPECTOR
// ═══════════════════════════════════════════════════════════════════
// Coalesce les rafales de snapshots (chrs/npcs/bsts/toks) → 1 render par tick
let _inspectorDirty = false;
function _renderInspectorSoon() {
  if (_inspectorDirty) return;
  _inspectorDirty = true;
  queueMicrotask(() => {
    _inspectorDirty = false;
    const t = _selected ? (_tokens[_selected]?.data ?? null) : null;
    _renderInspector(t);
  });
}

function _renderInspector(t) {
  const el=document.getElementById('vtt-inspector'); if (!el) return;
  // Multi-sélection active
  if (_selectedMulti.size>1) {
    const types=[..._selectedMulti].map(id=>_tokens[id]?.data?.type).filter(Boolean);
    const uniq=t=>({player:'🧑 Joueurs',enemy:'👹 Ennemis',npc:'👤 PNJ'})[t]||t;
    const typeStr=[...new Set(types)].map(uniq).join(' · ');
    el.innerHTML=`<div class="vtt-ins-multi">
      <div style="font-size:2rem;text-align:center">↖↖</div>
      <div class="vtt-ins-name" style="text-align:center">${_selectedMulti.size} tokens</div>
      <div class="vtt-ins-type" style="text-align:center">${typeStr}</div>
      <div style="font-size:.72rem;color:var(--text-dim);text-align:center;margin-top:.5rem;line-height:1.4">
        Glisse un token pour<br>déplacer tout le groupe
      </div>
    </div>`;
    return;
  }
  if (!t) { el.innerHTML=`<div class="vtt-ins-empty"><div style="font-size:1.8rem">🎲</div>Sélectionne un token</div>`; return; }
  const ld=_live(t);
  const hp=ld.displayHp??20, hpm=ld.displayHpMax??20;
  const rat=hpm>0?Math.max(0,hp/hpm):1;
  const icon={player:'🧑',enemy:'👹',npc:'👤'}[t.type]??'🎭';
  const lbl={player:'Joueur',enemy:'Ennemi',npc:'PNJ'}[t.type]??t.type;
  const img=ld.displayImage;
  const linked=t.characterId||t.npcId;

  const pageOpts=STATE.isAdmin
    ? Object.values(_pages).filter(p=>p.id!==t.pageId)
        .map(p=>`<option value="${p.id}">${p.name}</option>`).join('') : '';

  // ── Helpers rendu stats ──────────────────────────────────────────
  const _bar = (lbl, cur, max, col, editHtml='') => {
    const pct = max > 0 ? Math.round(Math.max(0, cur) / max * 100) : 0;
    const val = editHtml
      ? editHtml + '<span style="color:var(--text-muted)"> / '+max+'</span>'
      : '<span>'+cur+' / '+max+'</span>';
    return '<div class="vtt-ins-bar-row">' +
      '<span class="vtt-ins-bar-lbl">'+lbl+'</span>' +
      '<div class="vtt-ins-bar-track"><div class="vtt-ins-bar-fill" style="width:'+pct+'%;background:'+col+'"></div></div>' +
      '<span class="vtt-ins-bar-val">'+val+'</span>' +
    '</div>';
  };
  const _stat = (icon, lbl, val, full=false) =>
    '<div class="vtt-ins-stat'+(full?' full':'')+'">'+
      '<span class="vtt-ins-stat-label">'+icon+' '+lbl+'</span>'+
      '<span class="vtt-ins-stat-val">'+val+'</span>'+
    '</div>';

  // Précalcul du bloc stats (évite l'imbrication de backticks dans le template)
  let statsHtml;
  if (!STATE.isAdmin && t.type === 'enemy' && t.beastId) {
    const track    = _bstTracker[t.beastId] || {};
    const pvMax    = track.pvActuel !== undefined ? parseInt(track.pvActuel) : null;
    // ld.displayHp est déjà calculé par _live() avec t.hp + borne pvActuel
    const pvCur    = ld.displayHp !== null ? ld.displayHp : pvMax;
    const pvPct    = pvMax > 0 ? Math.round((pvCur??pvMax) / pvMax * 100) : 0;
    const pvBarCol = pvPct > 50 ? '#22c38e' : pvPct > 25 ? '#f59e0b' : '#ef4444';
    const caLabel  = track.caEstimee  !== undefined ? String(track.caEstimee)  : '?';
    const vitLabel = track.vitEstimee !== undefined ? String(track.vitEstimee)+' cases' : '?';
    const pos      = t.pageId ? 'Col '+t.col+' · Lig '+t.row : 'Non placé';
    statsHtml =
      '<div class="vtt-ins-bars">' +
        (pvMax !== null
          ? _bar('PV', pvCur??pvMax, pvMax, pvBarCol)
          : '<div class="vtt-ins-bar-row"><span class="vtt-ins-bar-lbl">PV</span><span style="color:var(--text-muted);font-size:.75rem;grid-column:2/-1">inconnus</span></div>') +
      '</div>' +
      '<div class="vtt-ins-stats">' +
        _stat('🛡', 'CA est.', caLabel) +
        _stat('🏃', 'Vitesse', vitLabel) +
        _stat('⚔️', 'Attaque', '?') +
        _stat('🎯', 'Portée', '?') +
        _stat('📍', 'Position', pos, true) +
      '</div>' +
      '<div style="font-size:.62rem;color:var(--text-dim);font-style:italic">Valeurs issues de ton bestiaire personnel</div>';
  } else {
    const pos    = t.pageId ? 'Col '+t.col+' · Lig '+t.row : 'Non placé';
    const pm     = ld.displayPm    ?? null;
    const pmMax  = ld.displayPmMax ?? null;
    const npcCombat = t.npcId ? _npcCombat(_npcs[t.npcId]) : {};
    const npcWeapon = npcCombat.weapon || {};
    const atkLabel = t.npcId
      ? (npcWeapon.nom || npcCombat.weaponName ? (npcWeapon.nom || npcCombat.weaponName) + ' · ' : '') + (ld.displayAttackDice || '1d6') + _signed(ld.displayAttack ?? 0)
      : (ld.displayAttackDice || (ld.displayAttack??5));
    const _canEditToken = STATE.isAdmin || t.ownerId === STATE.user?.uid;
    const _inCombat = !!_session?.combat?.active;
    const pvEditHtml = _canEditToken
      ? '<input class="vtt-ins-input" type="number" value="'+hp+'" min="0" max="'+hpm+'" onchange="window._vttSetHp(\''+t.id+'\',+this.value)">'
      : null;
    const pmEditHtml = (_canEditToken && pm !== null && pmMax !== null)
      ? '<input class="vtt-ins-input" type="number" value="'+pm+'" min="0" max="'+pmMax+'" onchange="window._vttSetPm(\''+t.id+'\',+this.value)">'
      : null;
    statsHtml =
      '<div class="vtt-ins-bars">' +
        _bar('PV', hp, hpm, hpColor(rat), pvEditHtml) +
        (pm !== null && pmMax !== null ? _bar('PM', pm, pmMax, '#b47fff', pmEditHtml) : '') +
      '</div>' +
      '<div class="vtt-ins-stats">' +
        (() => {
          const baseMvt = ld.displayMovement ?? 6;
          const maxMvt  = baseMvt + (t.bonusMvt||0);
          const rem     = _inCombat ? Math.max(0, maxMvt - (t.movedCells||0)) : null;
          const mvLabel = _inCombat ? `${rem} / ${maxMvt} cases` : `${baseMvt} cases`;
          const remColor = _inCombat ? (rem===0?'#f87171':rem<=2?'#f59e0b':'#4ade80') : 'inherit';
          return `<div class="vtt-ins-stat"><span class="vtt-ins-stat-icon">🏃</span>`+
            `<span class="vtt-ins-stat-lbl">Mouvement</span>`+
            `<span class="vtt-ins-stat-val" style="color:${remColor}">${mvLabel}</span></div>`;
        })() +
        _stat('⚔️', 'Attaque', atkLabel) +
        _stat('🛡', 'CA', ld.displayDefense??0) +
        _stat('🎯', 'Portée', (ld.displayRange??1)+' case(s)') +
        _stat('📍', 'Position', pos, true) +
        (t.attackedThisTurn
          ? '<div class="vtt-ins-stat full" style="gap:.4rem;flex-wrap:wrap">'+
              '<span class="vtt-ins-badge vtt-ins-badge-atk">✓ A attaqué</span>'+
            '</div>'
          : '') +
      '</div>';
  }

  // ── Effets actifs (buffs, debuffs, DoT, enchantements, afflictions…) ──
  const _r = _session?.combat?.round ?? 0;
  const _activeBuffs = (t.buffs || []).filter(bf =>
    bf?.expiresAtRound == null || _r === 0 || _r <= bf.expiresAtRound);
  const _buffsHtml = _activeBuffs.length ? (() => {
    const _BUFF_LABEL = {
      ca: 'Bonus CA', dot: 'Dégâts/tour', dmg_bonus: 'Dégâts bonus',
      move_bonus: 'Mouvement +', move_debuff: 'Mouvement −',
      range_bonus: 'Portée +', shield_reactive: 'Bouclier réactif',
      enchantment: 'Enchantement', affliction: 'Affliction',
    };
    const items = _activeBuffs.map((bf, i) => {
      const ic = bf.icon || '✨';
      const lbl = bf.sortLabel || _BUFF_LABEL[bf.type] || bf.type || 'Effet';
      // Calcul durée restante
      let durStr;
      if (bf.canalisePersistant) durStr = '∞ canalisé';
      else if (bf.expiresAtRound != null && _r > 0) durStr = `${bf.expiresAtRound - _r + 1}t`;
      else if (bf.totalDuration != null) durStr = `${bf.totalDuration}t`;
      else durStr = '∞';
      // Détail (bonus, formule, slot, charges)
      const detail = bf.type === 'dmg_bonus' ? `+${bf.formula}`
                   : bf.type === 'move_bonus' || bf.type === 'move_debuff' ? `${bf.bonus > 0 ? '+' : ''}${bf.bonus} c`
                   : bf.type === 'range_bonus' ? `+${bf.bonus} c`
                   : bf.type === 'ca' ? `${bf.bonus >= 0 ? '+' : ''}${bf.bonus} CA`
                   : bf.type === 'dot' ? `${bf.formula} / tour`
                   : bf.type === 'shield_reactive' ? `${bf.charges || 1} charge · ${bf.tier}`
                   : bf.effect ? bf.effect.slice(0, 24) : '';
      const rmBtn = STATE.isAdmin
        ? `<button class="vtt-buff-rm" onclick="window._vttRemoveBuff('${t.id}',${i})" title="Retirer">✕</button>` : '';
      // Sort suspendu : bouton ▶ pour le déclencher (porteur ou MJ)
      const canTrigger = bf.type === 'suspended_spell' && (STATE.isAdmin || t.ownerId === STATE.user?.uid);
      const trigBtn = canTrigger
        ? `<button class="vtt-buff-trigger" onclick="window._vttTriggerSuspendedSpell('${t.id}',${i})" title="Déclencher le sort suspendu">▶</button>` : '';
      return `<div class="vtt-buff-item" title="${_esc(lbl)}${detail?' · '+_esc(detail):''}">
        <span class="vtt-buff-ic">${ic}</span>
        <span class="vtt-buff-lbl">${_esc(lbl)}</span>
        ${detail ? `<span class="vtt-buff-detail">${_esc(detail)}</span>` : ''}
        <span class="vtt-buff-dur">${durStr}</span>
        ${trigBtn}${rmBtn}
      </div>`;
    }).join('');
    const addBtn = STATE.isAdmin
      ? `<button class="vtt-btn-sm" onclick="window._vttAddBuffPrompt('${t.id}')" title="Ajouter un effet manuel">＋</button>` : '';
    return `<div class="vtt-ins-section">
      <div class="vtt-ins-section-title">✨ Effets actifs ${addBtn}</div>
      <div class="vtt-buff-list">${items}</div>
    </div>`;
  })() : (STATE.isAdmin
    ? `<div class="vtt-ins-section">
        <div class="vtt-ins-section-title">✨ Effets actifs <button class="vtt-btn-sm" onclick="window._vttAddBuffPrompt('${t.id}')">＋</button></div>
        <div style="font-size:.72rem;color:var(--text-dim);font-style:italic">Aucun effet actif</div>
      </div>` : '');

  el.innerHTML=`
    <div class="vtt-ins-header">
      ${img?`<img src="${img}" class="vtt-ins-avatar" alt="">`
           :`<div class="vtt-ins-avatar-icon" style="background:${TYPE_COLOR[t.type]??'#888'}">${icon}</div>`}
      <div style="min-width:0">
        <div class="vtt-ins-name">${ld.displayName??t.name}</div>
        <div class="vtt-ins-type">${icon} ${lbl}${linked?' · 🔗':''}</div>
      </div>
    </div>
    ${statsHtml}
    ${_buffsHtml}
    ${(() => {
      const inCombat = !!_session?.combat?.active;
      const canEdit  = STATE.isAdmin || t.ownerId === STATE.user?.uid;
      if (!inCombat || !canEdit || (t.type !== 'player' && t.type !== 'npc')) return '';
      const ld2  = _live(t);
      const base = ld2.displayMovement ?? 6;
      const couru = (t.bonusMvt||0) > 0;
      return `<div class="vtt-ins-section">
        <div class="vtt-ins-section-title">⚔️ Actions de combat</div>
        <div class="vtt-combat-actions">
          <button class="vtt-combat-action-btn${couru?' used':''}"
            onclick="window._vttCourir('${t.id}')"
            ${couru?'disabled':''}>
            <span class="vtt-ca-icon">🏃</span>
            <span class="vtt-ca-body">
              <span class="vtt-ca-name">Courir</span>
              <span class="vtt-ca-desc">${couru?'Déjà utilisé':'Ajoute +'+base+' cases de mouvement'}</span>
            </span>
          </button>
        </div>
      </div>`;
    })()}
    ${(t.type==='player'||t.type==='npc') && _diceSkills.length && (STATE.isAdmin||t.ownerId===STATE.user?.uid) ? (() => {
      const btns = _diceSkills.map(s => {
        const statKey = _STAT_KEY[s.stat] || '';
        const mod  = _tokenStatMod(t, statKey);
        const modStr = mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : '±0';
        const col  = _STAT_COLOR[s.stat] || 'var(--text-dim)';
        return `<button class="vtt-skill-btn" onclick="window._vttRollSkill('${s.name.replace(/'/g,"\\'")}','${s.stat}')">
          <span class="vtt-sk-name">${s.name}</span>
          <span class="vtt-sk-mod" style="color:${col}">${s.stat ? s.stat+' '+modStr : '—'}</span>
        </button>`;
      }).join('');
      return `<div class="vtt-ins-section">
        <div class="vtt-ins-section-title">🎲 Jets de compétences</div>
        <div class="vtt-roll-mode-row">
          <button class="vtt-roll-mode-btn${_rollMode==='disadvantage'?' active':''}" data-mode="disadvantage" onclick="window._vttSetRollMode('disadvantage')" title="Désavantage — prend le plus bas des 2 dés">⬇ Désav.</button>
          <button class="vtt-roll-mode-btn${_rollMode==='normal'?' active':''}" data-mode="normal" onclick="window._vttSetRollMode('normal')" title="Jet classique — 1d20">⚪ Normal</button>
          <button class="vtt-roll-mode-btn${_rollMode==='advantage'?' active':''}" data-mode="advantage" onclick="window._vttSetRollMode('advantage')" title="Avantage — prend le plus haut des 2 dés">⬆ Avantage</button>
        </div>
        <div class="vtt-roll-bonus-row">
          <span class="vtt-roll-bonus-lbl">Bonus contextuel</span>
          <button class="vtt-roll-bonus-adj" onclick="window._vttAdjBonus(-1)">−</button>
          <span class="vtt-roll-bonus-val${_rollBonus!==0?' nonzero':''}" id="vtt-bonus-val">${_rollBonus>0?'+'+_rollBonus:_rollBonus}</span>
          <button class="vtt-roll-bonus-adj" onclick="window._vttAdjBonus(1)">+</button>
          <button class="vtt-roll-bonus-reset" onclick="window._vttAdjBonus(0,true)" title="Réinitialiser">↺</button>
        </div>
        <div class="vtt-ins-skills">${btns}</div>
      </div>`;
    })() : ''}
    ${STATE.isAdmin&&pageOpts?`
      <div class="vtt-ins-section">
        <div class="vtt-ins-section-title">Envoyer le joueur vers</div>
        <select class="vtt-ins-select" onchange="window._vttMoveTokenToPage('${t.id}',this.value);this.value=''">
          <option value="">— choisir une page —</option>${pageOpts}
        </select>
      </div>` :''}
    ${STATE.isAdmin?`
      <div class="vtt-ins-actions">
        <button class="vtt-btn-sm" onclick="window._vttEditToken('${t.id}')" title="Modifier les stats combat">⚙️ Stats</button>
        <button class="vtt-btn-sm" onclick="window._vttToggleVisible('${t.id}')" title="Visibilité joueurs">${t.visible?'👁':'🙈'}</button>
        ${_session?.combat?.active?`<button class="vtt-btn-sm" onclick="window._vttResetTurn('${t.id}')" title="Réinitialiser le tour de ce token">↺ Tour</button>`:''}

        ${t.pageId?`<button class="vtt-btn-sm" onclick="window._vttRetireToken('${t.id}')" title="Retirer de la carte">↩</button>`:''}
        ${(t.buffs||[]).length?`<button class="vtt-btn-sm vtt-btn-danger" onclick="window._vttClearBuffs('${t.id}')" title="Supprimer tous les buffs actifs">🗑 Buffs</button>`:''}
      </div>` :''}`;
}

// ═══════════════════════════════════════════════════════════════════
// TRAY — panneau latéral MJ
// ═══════════════════════════════════════════════════════════════════
window._vttToggleTrayReserve = () => { _trayReserveOpen = !_trayReserveOpen; _renderTray(); };
window._vttTrayFilter = f => { _trayFilter = f; _renderTray(); };

// Coalesce les rafales de snapshots (chrs/npcs/bsts/toks au mount) → 1 render par tick
let _trayDirty = false;
function _renderTraySoon() {
  if (_trayDirty) return;
  _trayDirty = true;
  queueMicrotask(() => { _trayDirty = false; _renderTray(); });
}

function _renderTray() {
  if (!STATE.isAdmin) { _renderPageTabs(); return; }
  _renderPageList();
  const el = document.getElementById('vtt-tray-tokens'); if (!el) return;

  const all      = Object.values(_tokens).map(e => e.data);
  const onPage   = all.filter(t => t.pageId === _activePage?.id);
  const reserve  = all.filter(t => !t.pageId && t.type !== 'enemy');
  const inCombat = !!_session?.combat?.active;

  // Tokens placés sur d'autres pages (perso/PNJ seulement, déduplication par entité,
  // et on cache les persos déjà présents sur la page active).
  const entityOnCurrent = new Set();
  for (const t of onPage) {
    if (t.characterId) entityOnCurrent.add('c:' + t.characterId);
    if (t.npcId)       entityOnCurrent.add('n:' + t.npcId);
  }
  const elsewhereRaw = all.filter(t =>
    t.pageId && t.pageId !== _activePage?.id
    && t.type !== 'enemy'
    && (t.characterId || t.npcId)
    && !entityOnCurrent.has((t.characterId ? 'c:' + t.characterId : 'n:' + t.npcId))
  );
  const elsewhereSeen = new Set();
  const elsewhere = elsewhereRaw.filter(t => {
    const k = t.characterId ? 'c:' + t.characterId : 'n:' + t.npcId;
    if (elsewhereSeen.has(k)) return false;
    elsewhereSeen.add(k);
    return true;
  });

  // Filtre par type
  const applyFilter = arr => _trayFilter === 'all' ? arr : arr.filter(t => t.type === _trayFilter);

  // ── Item liste (sur la page) ──────────────────────────────────────
  const mkItem = (t, placed) => {
    const ld = _live(t);
    const hpKnownL = ld.displayHp !== null && ld.displayHpMax !== null;
    const hp = hpKnownL ? ld.displayHp : 0, hpm = hpKnownL ? ld.displayHpMax : 1;
    const rat = hpKnownL ? (hpm > 0 ? Math.max(0, hp / hpm) : 1) : 0.5;
    const typeIcon = t.type === 'player' ? '🧑' : t.type === 'npc' ? '👤' : '👹';
    const dupBtn = t.type === 'enemy'
      ? `<button class="vtt-tray-btn" onclick="event.stopPropagation();window._vttDuplicateToken('${t.id}')" title="Dupliquer">＋</button>` : '';
    const delBtn = t.type === 'enemy'
      ? `<button class="vtt-tray-btn vtt-tray-btn-del" onclick="event.stopPropagation();window._vttDeleteToken('${t.id}')" title="Supprimer">×</button>` : '';
    const actionBtn = !placed
      ? `<button class="vtt-tray-btn" onclick="event.stopPropagation();window._vttPlace('${t.id}')" title="Placer">▶</button>`
      : `<button class="vtt-tray-btn" onclick="event.stopPropagation();window._vttRetireToken('${t.id}')" title="Retirer">↩</button>`;
    // HP fraction visible pour les ennemis en combat
    const hpFrac = inCombat && t.type === 'enemy' && hpKnownL
      ? `<span class="vtt-tray-hp-frac" style="color:${hpColor(rat)}">${hp}/${hpm}</span>` : '';
    return `<div class="vtt-tray-item ${_selected === t.id ? 'active' : ''}" onclick="window._vttSelectFromTray('${t.id}')">
      <div class="vtt-tray-dot" style="background:${TYPE_COLOR[t.type] ?? '#888'}">
        ${ld.displayImage
          ? `<img src="${ld.displayImage}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
          : `<span style="font-size:.65rem">${typeIcon}</span>`}
      </div>
      <div class="vtt-tray-info">
        <div class="vtt-tray-name">${_esc(ld.displayName ?? t.name)}</div>
        <div class="vtt-tray-hp-row">
          <div class="vtt-tray-hp-bar" style="flex:1"><div style="width:${Math.round(rat * 100)}%;height:100%;background:${hpKnownL ? hpColor(rat) : '#555'};border-radius:2px"></div></div>
          ${hpFrac}
        </div>
      </div>
      <div class="vtt-tray-actions">${dupBtn}${actionBtn}${delBtn}</div>
    </div>`;
  };

  // ── Chip compact (réserve) ────────────────────────────────────────
  const mkChip = t => {
    const ld = _live(t);
    const typeIcon = t.type === 'player' ? '🧑' : '👤';
    const col = TYPE_COLOR[t.type] ?? '#888';
    return `<button class="vtt-res-chip" onclick="window._vttPlace('${t.id}')"
        title="Placer ${_esc(ld.displayName ?? t.name)}">
      <div class="vtt-res-chip-dot" style="border-color:${col};color:${col}">
        ${ld.displayImage
          ? `<img src="${ld.displayImage}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
          : `<span>${typeIcon}</span>`}
      </div>
      <span class="vtt-res-chip-name">${_esc(ld.displayName ?? t.name)}</span>
    </button>`;
  };

  // ── Pills de filtre ───────────────────────────────────────────────
  const filterPills = `<div class="vtt-tray-filters">
    ${[['all','Tout'],['player','🧑'],['npc','👤'],['enemy','👹']].map(([v,l]) =>
      `<button class="vtt-tray-fp${_trayFilter === v ? ' active' : ''}" onclick="window._vttTrayFilter('${v}')">${l}</button>`
    ).join('')}
  </div>`;

  // ── Sur la page — groupé par type ────────────────────────────────
  const filteredPage = applyFilter(onPage);
  let pageSec = '';
  if (!filteredPage.length) {
    pageSec = `<div class="vtt-tray-empty">${_trayFilter === 'all' ? 'Aucun token sur cette page' : 'Aucun ici'}</div>`;
  } else {
    const pagePlayers = filteredPage.filter(t => t.type === 'player');
    const pageNpcs    = filteredPage.filter(t => t.type === 'npc');
    let   pageEnemies = filteredPage.filter(t => t.type === 'enemy');

    // En combat : ennemis triés par HP% croissant (blessés en premier)
    if (inCombat && pageEnemies.length > 1) {
      pageEnemies = [...pageEnemies].sort((a, b) => {
        const la = _live(a), lb = _live(b);
        const ra = (la.displayHp ?? 1) / Math.max(1, la.displayHpMax ?? 1);
        const rb = (lb.displayHp ?? 1) / Math.max(1, lb.displayHpMax ?? 1);
        return ra - rb; // plus blessé = plus haut
      });
    }

    const multiType = [pagePlayers, pageNpcs, pageEnemies].filter(g => g.length).length > 1;
    const mkGrp = (icon, label, items) => {
      if (!items.length) return '';
      const hdr = multiType ? `<div class="vtt-tray-sublabel">${icon} ${label}</div>` : '';
      return hdr + items.map(t => mkItem(t, true)).join('');
    };
    pageSec = mkGrp('🧑', 'Joueurs', pagePlayers)
            + mkGrp('👤', 'PNJ', pageNpcs)
            + mkGrp('👹', 'Ennemis', pageEnemies);
  }

  // ── Sur d'autres pages — chips avec "+" pour dupliquer ici ───────
  const filteredElsewhere = applyFilter(elsewhere);
  let elsewhereSec = '';
  if (filteredElsewhere.length) {
    const mkElsewhereChip = t => {
      const ld = _live(t);
      const typeIcon = t.type === 'player' ? '🧑' : '👤';
      const col = TYPE_COLOR[t.type] ?? '#888';
      const pageName = _pages[t.pageId]?.name || '?';
      return `<button class="vtt-res-chip vtt-res-chip--elsewhere" onclick="window._vttDuplicateOnPage('${t.id}')"
          title="${_esc(ld.displayName ?? t.name)} — sur « ${_esc(pageName)} ». Clic = placer aussi ici (HP partagés).">
        <div class="vtt-res-chip-dot" style="border-color:${col};color:${col}">
          ${ld.displayImage
            ? `<img src="${ld.displayImage}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
            : `<span>${typeIcon}</span>`}
          <span class="vtt-res-chip-plus">+</span>
        </div>
        <span class="vtt-res-chip-name">${_esc(ld.displayName ?? t.name)}</span>
        <span class="vtt-res-chip-sub">${_esc(pageName)}</span>
      </button>`;
    };
    elsewhereSec = `<div class="vtt-tray-sect">
      <div class="vtt-tray-sect-hd">
        <span>🗂 Sur d'autres pages</span>
        <span class="vtt-tray-count">${filteredElsewhere.length}</span>
      </div>
      <div class="vtt-reserve-grid">${filteredElsewhere.map(mkElsewhereChip).join('')}</div>
    </div>`;
  }

  // ── Réserve — grid compacte, toujours visible ────────────────────
  const filteredRes = applyFilter(reserve);
  let reserveSec = '';
  if (filteredRes.length) {
    const resPlayers = filteredRes.filter(t => t.type === 'player');
    const resNpcs    = filteredRes.filter(t => t.type === 'npc');
    const multiResType = resPlayers.length > 0 && resNpcs.length > 0;
    const resHtml = (multiResType
      ? (resPlayers.length ? `<div class="vtt-tray-sublabel">🧑 Joueurs</div><div class="vtt-reserve-grid">${resPlayers.map(mkChip).join('')}</div>` : '')
        + (resNpcs.length ? `<div class="vtt-tray-sublabel">👤 PNJ</div><div class="vtt-reserve-grid">${resNpcs.map(mkChip).join('')}</div>` : '')
      : `<div class="vtt-reserve-grid">${filteredRes.map(mkChip).join('')}</div>`);
    reserveSec = `<div class="vtt-tray-sect">
      <div class="vtt-tray-sect-hd">
        <span>📦 Réserve</span>
        <span class="vtt-tray-count">${filteredRes.length}</span>
      </div>
      ${resHtml}
    </div>`;
  }

  // ── Bestiaire ─────────────────────────────────────────────────────
  const showBst = _trayFilter === 'all' || _trayFilter === 'enemy';
  const bsts = Object.values(_bestiary);
  const bstGrid = showBst
    ? (bsts.length
        ? bsts.map(b => {
            const img = b.photoURL || b.photo || b.avatar || b.imageUrl || '';
            const init = (b.nom || '?')[0].toUpperCase();
            return `<button class="vtt-bst-tile" onclick="window._vttPlaceFromBestiary('${b.id}')"
                title="${_esc(b.nom || 'Créature')} · PV ${parseInt(b.pvMax) || '?'}">
              ${img ? `<img src="${img}" alt="${_esc(b.nom || '')}">` : `<span class="vtt-bst-icon">${init}</span>`}
              <div class="vtt-bst-name">${_esc((b.nom || 'Créature').slice(0, 8))}</div>
            </button>`;
          }).join('')
        : `<div class="vtt-tray-empty">Bestiaire vide</div>`)
    : '';

  el.innerHTML = `
    ${filterPills}
    <div class="vtt-tray-sect">
      <div class="vtt-tray-sect-hd">
        <span>🗺 Sur la page</span>
        <span class="vtt-tray-count">${filteredPage.length}${filteredPage.length !== onPage.length ? `/${onPage.length}` : ''}</span>
      </div>
      ${pageSec}
    </div>
    ${elsewhereSec}
    ${reserveSec}
    ${showBst ? `<div class="vtt-tray-sect">
      <div class="vtt-tray-sect-hd" style="justify-content:space-between">
        <span>👹 Bestiaire</span>
        <button class="vtt-tray-add-btn" onclick="window._vttCreateEnemy()" title="Créer un ennemi">＋</button>
      </div>
      <div class="vtt-bst-grid">${bstGrid}</div>
    </div>` : ''}
  `;
}

// ═══════════════════════════════════════════════════════════════════
// PAGES
// ═══════════════════════════════════════════════════════════════════
// ─ Liste verticale des pages dans le tray (MJ) ─────────────────────
function _renderPageList() {
  const el=document.getElementById('vtt-tray-pages'); if (!el) return;
  const broadcastId=_session.activePageId;
  const sorted=Object.values(_pages).sort((a,b)=>(a.order??0)-(b.order??0));

  if (!sorted.length) {
    el.innerHTML=`<div class="vtt-tray-empty">Aucune page<br><small>Clique ＋ pour créer</small></div>`;
    return;
  }
  el.innerHTML=sorted.map(p=>{
    const isPlayers=p.id===broadcastId, isMj=p.id===_activePage?.id;
    const cls=isMj&&isPlayers?'mj-and-players':isMj?'mj':isPlayers?'players':'';
    return `
    <div class="vtt-page-item ${cls}" onclick="window._vttSwitchPage('${p.id}')" title="${p.cols||24}×${p.rows||18} cases">
      <div class="vtt-page-item-badges">
        ${isMj     ?'<span title="Votre vue">📍</span>':''}
        ${isPlayers?'<span title="Joueurs ici">👥</span>':''}
      </div>
      <div class="vtt-page-item-name">${p.name}</div>
      <div class="vtt-page-item-acts">
        <button class="vtt-page-item-btn" onclick="event.stopPropagation();window._vttSendToPage('${p.id}')" title="Envoyer tous les joueurs ici">📡</button>
        <button class="vtt-page-item-btn" onclick="event.stopPropagation();window._vttEditPage('${p.id}')" title="Renommer / redimensionner">✏</button>
        <button class="vtt-page-item-btn vtt-page-item-del" onclick="event.stopPropagation();window._vttDeletePage('${p.id}')" title="Supprimer">×</button>
      </div>
    </div>`;
  }).join('');
}

// ─ Indicateur de page courant pour les joueurs (lecture seule) ──────
function _renderPageTabs() {
  if (STATE.isAdmin) { _renderPageList(); return; } // MJ : liste dans le tray
  const el=document.getElementById('vtt-page-tabs'); if (!el) return;
  // Les joueurs ne naviguent pas — ils voient juste le nom de leur page courante
  const name = _activePage?.name ?? '…';
  const uid  = STATE.user?.uid;
  const myTok = uid ? Object.values(_tokens).find(e => e.data?.ownerId === uid)?.data : null;
  const canInvoke = !!(myTok && _activePage && myTok.pageId !== _activePage.id);
  const invokeBtn = canInvoke
    ? `<button class="vtt-btn-sm" onclick="window._vttInvokeMyToken()" title="Placer ton token sur cette carte">🧑 Invoquer mon token</button>`
    : '';
  el.innerHTML = `<span class="vtt-page-current-label">📍 ${_esc(name)}</span>${invokeBtn}`;
}

async function _switchPage(pageId) {
  const page=_pages[pageId]; if (!page) return;
  _activePage=page;
  // Ne pas détruire _layers.map entièrement : _imgTr (Transformer) y vit.
  // _renderMapImages() et _renderAllTokens() gèrent leur propre nettoyage.
  _layers.token?.destroyChildren(); _clearHL();
  _drawGrid(); _renderMapImages(); _renderAllTokens(); _renderAnnotLayer();
  fogRenderWalls(page, STATE.isAdmin);
  fogUpdateSoon(page, _tokens, STATE.isAdmin);
  _renderPageTabs(); _renderTray(); _deselect();
  _renderCombatTracker();
  _renderMjRulerRemote(_session?.mjRuler);
  // Le MJ navigue librement — les joueurs ne suivent que via 📡 Envoyer
}

function _renderAllTokens() {
  if (!_activePage) return;
  _layers.token?.destroyChildren();
  for (const e of Object.values(_tokens)) {
    const t=e.data;
    if (t.pageId!==_activePage.id) continue;
    if (!t.visible&&!STATE.isAdmin) continue;
    const shape=_buildShape(t);
    _tokens[t.id]={...e,shape}; _layers.token.add(shape);
  }
  _layers.token?.batchDraw();
}

// ═══════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════
// OUTILS — RÈGLE & ANNOTATIONS
// ═══════════════════════════════════════════════════════════════════

// Conversion coords écran → monde
function _stageToWorld(ptr) {
  const sc = _stage.scaleX(), sp = _stage.position();
  return { x: (ptr.x - sp.x) / sc, y: (ptr.y - sp.y) / sc };
}

// ── Règle ──────────────────────────────────────────────────────────
// Comptage Manhattan (|dc|+|dr|) : cohérent avec _moveTo / _showMoveRange.
// Les extrémités sont snappées au centre de la case sous le curseur.
const RULER_COLOR = '#ffe600';
const RULER_LABEL_OFFSET = { x: 6, y: -18 };
const _fmtRulerCells = n => `${n} case${n !== 1 ? 's' : ''} · ${(n * CELL_M).toFixed(1)}m`;
const _snapToCellCenter = wp => {
  const c = Math.floor(wp.x / CELL), r = Math.floor(wp.y / CELL);
  return { c, r, x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 };
};
const _rulerLabelPos = (x1, y1, x2, y2) => ({
  x: (x1 + x2) / 2 + RULER_LABEL_OFFSET.x,
  y: (y1 + y2) / 2 + RULER_LABEL_OFFSET.y,
});
// Crée line + label + dot d'origine, regroupés pour destruction unique.
function _buildRulerNodes(K, name, opacity = 1) {
  const group = new K.Group({ listening: false, name });
  const line = new K.Line({
    points: [0, 0, 0, 0], stroke: RULER_COLOR, strokeWidth: 2, dash: [8, 4],
    lineCap: 'round', opacity, listening: false,
  });
  const dot = new K.Circle({
    x: 0, y: 0, radius: 4, fill: RULER_COLOR, opacity,
    shadowColor: '#000', shadowBlur: 4, shadowOpacity: 0.7, listening: false,
  });
  const label = new K.Text({
    x: 0, y: 0, text: '', fill: RULER_COLOR, fontSize: 13, fontStyle: 'bold',
    shadowColor: '#000', shadowBlur: 6, shadowOpacity: 0.9,
    shadowOffset: { x: 1, y: 1 }, opacity, listening: false,
  });
  group.add(line, dot, label);
  return { group, line, dot, label };
}
function _setRulerNodes(nodes, x1, y1, x2, y2, text) {
  nodes.line.points([x1, y1, x2, y2]);
  nodes.dot.position({ x: x1, y: y1 });
  const p = _rulerLabelPos(x1, y1, x2, y2);
  nodes.label.text(text);
  nodes.label.position(p);
}

let _rulerNodes = null;     // nodes locaux (MJ ou joueur, pour l'utilisateur courant)
let _rulerLastCell = null;  // dernière case survolée — court-circuite si inchangée
let _rulerHoverDot = null;  // aperçu de la case de départ avant le 1er clic

function _showRulerHover(wp) {
  if (!_layers.ping || _rulerNodes) { _hideRulerHover(); return; } // pas d'aperçu si une règle est déjà visible
  const o = _snapToCellCenter(wp);
  if (!_rulerHoverDot) {
    const K = window.Konva;
    _rulerHoverDot = new K.Circle({
      radius: 5, fill: RULER_COLOR, opacity: 0.45,
      stroke: '#000', strokeWidth: 1, listening: false, name: 'ruler-hover',
    });
    _layers.ping.add(_rulerHoverDot);
  }
  _rulerHoverDot.position({ x: o.x, y: o.y });
  _layers.ping.batchDraw();
}
function _hideRulerHover() {
  if (!_rulerHoverDot) return;
  _rulerHoverDot.destroy();
  _rulerHoverDot = null;
  _layers.ping?.batchDraw();
}

function _startRuler(wp) {
  const K = window.Konva;
  _clearRuler();
  _hideRulerHover();
  const o = _snapToCellCenter(wp);
  _rulerActive = true;
  _rulerOrigin = o;
  _rulerLastCell = { c: o.c, r: o.r };
  _rulerNodes = _buildRulerNodes(K, 'ruler');
  _setRulerNodes(_rulerNodes, o.x, o.y, o.x, o.y, _fmtRulerCells(0));
  _layers.ping.add(_rulerNodes.group);
  _layers.ping.batchDraw();
  _broadcastMjRuler(o.x, o.y, 0);
}
function _updateRuler(wp) {
  if (!_rulerNodes || !_rulerOrigin) return;
  const e = _snapToCellCenter(wp);
  // Court-circuit : pas de redraw ni de broadcast si la case n'a pas changé.
  if (_rulerLastCell && e.c === _rulerLastCell.c && e.r === _rulerLastCell.r) return;
  _rulerLastCell = { c: e.c, r: e.r };
  const cells = Math.abs(e.c - _rulerOrigin.c) + Math.abs(e.r - _rulerOrigin.r);
  _setRulerNodes(_rulerNodes, _rulerOrigin.x, _rulerOrigin.y, e.x, e.y, _fmtRulerCells(cells));
  _layers.ping.batchDraw();
  _broadcastMjRuler(e.x, e.y, cells);
}
function _endRuler() {
  _rulerActive = false;
  if (_rulerHideTimer) clearTimeout(_rulerHideTimer);
  _rulerHideTimer = setTimeout(_clearRuler, 5000);
}
function _clearRuler() {
  if (_rulerHideTimer) { clearTimeout(_rulerHideTimer); _rulerHideTimer = null; }
  _rulerNodes?.group.destroy();
  _rulerNodes = null;
  _rulerActive = false; _rulerOrigin = null; _rulerLastCell = null;
  _layers.ping?.batchDraw();
  _clearMjRulerBroadcast();
}

// Diffusion de la règle du MJ (visible par tous les joueurs via _session.mjRuler).
// Throttle pour lisser les écritures Firestore.
const MJ_RULER_THROTTLE = 120;
let _mjRulerLastWrite = 0;
let _mjRulerPendingTimer = null;
let _mjRulerBroadcasting = false; // évite un setDoc(null) inutile si jamais diffusé
function _broadcastMjRuler(x2, y2, cells) {
  if (!STATE.isAdmin || !_activePage || !_rulerOrigin) return;
  const payload = {
    pageId: _activePage.id,
    x1: _rulerOrigin.x, y1: _rulerOrigin.y,
    x2, y2, cells,
  };
  const now = Date.now();
  const wait = Math.max(0, MJ_RULER_THROTTLE - (now - _mjRulerLastWrite));
  if (_mjRulerPendingTimer) { clearTimeout(_mjRulerPendingTimer); _mjRulerPendingTimer = null; }
  const flush = () => {
    _mjRulerPendingTimer = null;
    _mjRulerLastWrite = Date.now();
    _mjRulerBroadcasting = true;
    setDoc(_sesRef(), { mjRuler: payload }, { merge: true }).catch(() => {});
  };
  if (wait === 0) flush();
  else _mjRulerPendingTimer = setTimeout(flush, wait);
}
function _clearMjRulerBroadcast() {
  if (!STATE.isAdmin) return;
  if (_mjRulerPendingTimer) { clearTimeout(_mjRulerPendingTimer); _mjRulerPendingTimer = null; }
  if (!_mjRulerBroadcasting) return; // rien n'a été diffusé → pas de write à effacer
  _mjRulerLastWrite = 0;
  _mjRulerBroadcasting = false;
  setDoc(_sesRef(), { mjRuler: null }, { merge: true }).catch(() => {});
}

// Rendu de la règle MJ chez les joueurs — mise à jour en place, sans destroy/rebuild.
let _mjRulerRemote = null;
function _renderMjRulerRemote(data) {
  if (STATE.isAdmin) return; // le MJ voit déjà sa règle locale
  if (!_layers.ping) return;
  const visible = data && _activePage && data.pageId === _activePage.id;
  if (!visible) {
    if (_mjRulerRemote) {
      _mjRulerRemote.group.destroy();
      _mjRulerRemote = null;
      _layers.ping.batchDraw();
    }
    return;
  }
  if (!_mjRulerRemote) {
    _mjRulerRemote = _buildRulerNodes(window.Konva, 'mj-ruler', 0.85);
    _layers.ping.add(_mjRulerRemote.group);
  }
  const cells = data.cells ?? 0;
  _setRulerNodes(_mjRulerRemote, data.x1, data.y1, data.x2, data.y2,
    `MJ : ${_fmtRulerCells(cells)}`);
  _layers.ping.batchDraw();
}

// ── Annotations ────────────────────────────────────────────────────
function _buildAnnotShape(K, data) {
  const col  = data.color || '#ef4444';
  const fill = data.fill ? col + '30' : 'transparent';
  // listening sera ajusté par _updateAnnotDraggable selon l'outil et la propriété
  const base = { stroke: col, strokeWidth: data.strokeWidth || 2,
    lineCap:'round', lineJoin:'round', name:'annot', listening: false };
  let shape;
  if (data.type === 'freehand' || data.type === 'line') {
    shape = new K.Line({ ...base, points: data.points || [],
      x: data.offsetX||0, y: data.offsetY||0,
      tension: data.type === 'freehand' ? 0.3 : 0, fill:'transparent' });
  } else if (data.type === 'rect') {
    const rw = data.w||10, rh = data.h||10;
    shape = new K.Rect({ ...base, x:data.x||0, y:data.y||0,
      width:rw, height:rh, fill, cornerRadius:3,
      // centered:true = x,y est le centre → offsetX/Y pour pivoter sur place
      ...(data.centered ? { offsetX: rw/2, offsetY: rh/2 } : {}) });
  } else if (data.type === 'circle') {
    shape = new K.Circle({ ...base, x:data.x||0, y:data.y||0, radius:data.r||10, fill });
  }
  if (!shape) return null;
  shape._annotId = data.id;

  // Restaurer rotation / scale sauvegardés
  if (data.rotation) shape.rotation(data.rotation);
  if (data.scaleX)   shape.scaleX(data.scaleX);
  if (data.scaleY)   shape.scaleY(data.scaleY);

  // MJ peut tout modifier, joueur seulement ses propres dessins
  const canEdit = STATE.isAdmin || data.createdBy === STATE.user?.uid;

  if (canEdit) {
    // Clic gauche → sélectionner (mode select uniquement)
    shape.on('click', e => {
      if (e.evt.button !== 0) return; // ignore middle/right (pan caméra)
      if (_tool !== 'select') return;
      e.cancelBubble = true;
      if (e.evt.shiftKey) {
        // Shift+clic : toggle dans la multi-sélection
        if (_selectedAnnotIds.has(data.id)) _selectedAnnotIds.delete(data.id);
        else _selectedAnnotIds.add(data.id);
      } else {
        _selectedAnnotIds.clear();
        _selectedAnnotIds.add(data.id);
        _selectedAnnotId = data.id;
      }
      _applyAnnotTransformer();
    });
    // Clic-droit → supprimer la sélection (mode select uniquement)
    shape.on('contextmenu', e => {
      if (_tool !== 'select') return;
      e.evt.preventDefault(); e.cancelBubble = true;
      // Supprimer toutes les annotations sélectionnées (ou juste celle-ci si pas sélectionnée)
      const toDelete = _selectedAnnotIds.has(data.id) ? [..._selectedAnnotIds] : [data.id];
      toDelete.forEach(id => deleteDoc(_annotRef(id)).catch(() => {}));
      _deselectAnnot();
    });
    // Début de drag groupé
    shape.on('dragstart', () => {
      if (_selectedAnnotIds.has(data.id) && _selectedAnnotIds.size > 1) {
        _annotGroupDragOrigins = {};
        for (const id of _selectedAnnotIds) {
          const s = _annotations[id]?.shape;
          if (s) _annotGroupDragOrigins[id] = { x: s.x(), y: s.y() };
        }
      } else { _annotGroupDragOrigins = null; }
    });
    // Déplacement groupé
    shape.on('dragmove', () => {
      if (!_annotGroupDragOrigins || !_selectedAnnotIds.has(data.id)) return;
      const orig = _annotGroupDragOrigins[data.id];
      if (!orig) return;
      const dx = shape.x() - orig.x, dy = shape.y() - orig.y;
      for (const [id, o] of Object.entries(_annotGroupDragOrigins)) {
        if (id === data.id) continue;
        _annotations[id]?.shape?.position({ x: o.x + dx, y: o.y + dy });
      }
      _layers.draw.batchDraw();
    });
    // Fin de drag → sauvegarder position(s)
    shape.on('dragend', () => {
      const idsToSave = (_annotGroupDragOrigins && _selectedAnnotIds.has(data.id))
        ? [..._selectedAnnotIds] : [data.id];
      for (const id of idsToSave) {
        const s = _annotations[id]?.shape, ann = _annotations[id]?.data;
        if (!s || !ann) continue;
        // Marquer skip rebuild pour éviter le saut visuel au retour onSnapshot
        _skipAnnotRebuild.add(id);
        const update = (ann.type === 'freehand' || ann.type === 'line')
          ? { offsetX: s.x(), offsetY: s.y() }
          : { x: s.x(), y: s.y() };
        if (ann.type !== 'freehand' && ann.type !== 'line') {
          ann.x = s.x(); ann.y = s.y();
        }
        updateDoc(_annotRef(id), update).catch(() => {});
      }
      _annotGroupDragOrigins = null;
    });
    // Fin de transformation (rotate/resize) → sauvegarder
    shape.on('transformend', () => {
      // Marquer cet id pour éviter le destroy/rebuild local dans onSnapshot
      _skipAnnotRebuild.add(data.id);

      if (data.centered) {
        // Normaliser scale dans les dimensions pour que le rebuild distant soit correct
        const newW = Math.max(1, shape.width()  * shape.scaleX());
        const newH = Math.max(1, shape.height() * shape.scaleY());
        shape.width(newW); shape.height(newH);
        shape.scaleX(1);   shape.scaleY(1);
        shape.offsetX(newW / 2); shape.offsetY(newH / 2);
        // Mettre à jour data en place (la closure reste valide)
        data.w = newW; data.h = newH; data.scaleX = 1; data.scaleY = 1;
      }
      data.rotation = shape.rotation();
      data.x = shape.x();
      data.y = shape.y();

      const patch = {
        rotation: shape.rotation(),
        scaleX: shape.scaleX(), scaleY: shape.scaleY(),
        x: shape.x(), y: shape.y(),
        ...(data.centered ? { centered: true, w: data.w, h: data.h } : {}),
      };
      updateDoc(_annotRef(data.id), patch).catch(() => {});
    });
  }
  return shape;
}

// ── Sélection groupée annotations ──────────────────────────────────
function _applyAnnotTransformer() {
  if (!_annotTransformer) return;
  const shapes = [..._selectedAnnotIds].map(id => _annotations[id]?.shape).filter(Boolean);
  _annotTransformer.nodes(shapes);
  _layers.draw?.batchDraw();
}

function _inRect(cx, cy, r) {
  return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
}

function _selectByRect(r) {
  _clearMultiSelect();
  _deselectAnnot();
  const uid = STATE.user?.uid;

  // Tokens sur la page active
  for (const [id, {data: t}] of Object.entries(_tokens)) {
    if (!t || t.pageId !== _activePage?.id) continue;
    const { x: cx, y: cy } = _tokenCenter(t);
    if (_inRect(cx, cy, r)) {
      _selectedMulti.add(id);
      _tokens[id]?.shape?.findOne('.sel')?.visible(true);
    }
  }

  // Annotations interactives sur la page active
  for (const [id, e] of Object.entries(_annotations)) {
    if (!e.data || e.data.pageId !== _activePage?.id || !e.shape) continue;
    if (!STATE.isAdmin && e.data.createdBy !== uid) continue;
    const bb = e.shape.getClientRect({ relativeTo: _stage });
    const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
    if (_inRect(cx, cy, r)) _selectedAnnotIds.add(id);
  }

  _applyAnnotTransformer();
  if (_selectedMulti.size > 0) _renderInspector(null);
  else if (_selectedAnnotIds.size > 0) _renderInspector(null);
  _layers.token?.batchDraw();
}

function _endMarquee() {
  _marqueeActive = false;
  _marqueeShape?.destroy(); _marqueeShape = null;
  _layers.ping?.batchDraw();
  if (!_marqueeLastWp || !_marqueeOrigin) { _marqueeLastWp = null; return; }
  const r = {
    x: Math.min(_marqueeOrigin.x, _marqueeLastWp.x),
    y: Math.min(_marqueeOrigin.y, _marqueeLastWp.y),
    w: Math.abs(_marqueeLastWp.x - _marqueeOrigin.x),
    h: Math.abs(_marqueeLastWp.y - _marqueeOrigin.y),
  };
  _marqueeLastWp = null;
  if (r.w < 5 && r.h < 5) return;
  _selectByRect(r);
}

function _deselectAnnot() {
  _selectedAnnotId = null;
  _selectedAnnotIds.clear();
  if (_annotTransformer) { _annotTransformer.nodes([]); _layers.draw?.batchDraw(); }
}

function _renderAnnotLayer() {
  if (!_layers.draw || !_activePage) return;
  const K = window.Konva;
  Object.values(_annotations).forEach(e => { e.shape?.destroy(); e.shape = null; });
  for (const [id, e] of Object.entries(_annotations)) {
    if (e.data.pageId !== _activePage.id) continue;
    const shape = _buildAnnotShape(K, e.data);
    if (shape) { _annotations[id].shape = shape; _layers.draw.add(shape); }
  }
  _updateAnnotDraggable();
  _layers.draw.batchDraw();
}

function _updateAnnotDraggable() {
  if (!_layers.draw) return;
  const inSelect = _tool === 'select';
  const uid = STATE.user?.uid;
  Object.values(_annotations).forEach(e => {
    if (!e.shape) return;
    const canEdit = STATE.isAdmin || e.data.createdBy === uid;
    const active  = inSelect && canEdit;
    e.shape.draggable(active);
    e.shape.listening(active);
  });
  if (inSelect) _applyAnnotTransformer(); // maintenir le transformer sur la sélection courante
  _layers.draw.batchDraw();
}

// ── Draw live (crayon + formes) ────────────────────────────────────
function _startDraw(wp) {
  const K = window.Konva;
  _drawOrigin = wp;
  const base = { stroke:_drawColor, strokeWidth:_drawWidth, lineCap:'round', lineJoin:'round', listening:false, name:'draw-live' };
  const fill  = _drawFill ? _drawColor+'30' : 'transparent';
  if (_drawShape === 'pencil') {
    _drawPts = [wp.x, wp.y];
    _drawLive = new K.Line({ ...base, points:_drawPts, tension:0.3 });
  } else if (_drawShape === 'line') {
    _drawLive = new K.Line({ ...base, points:[wp.x,wp.y,wp.x,wp.y] });
  } else if (_drawShape === 'rect') {
    _drawLive = new K.Rect({ ...base, x:wp.x, y:wp.y, width:0, height:0, fill, cornerRadius:3 });
  } else if (_drawShape === 'circle') {
    _drawLive = new K.Circle({ ...base, x:wp.x, y:wp.y, radius:0, fill });
  }
  if (_drawLive) { _layers.draw.add(_drawLive); }
  _drawing = true;
}
function _updateDraw(wp) {
  if (!_drawLive || !_drawOrigin) return;
  if (_drawShape === 'pencil') {
    _drawPts.push(wp.x, wp.y);
    _drawLive.points([..._drawPts]);
  } else if (_drawShape === 'line') {
    _drawLive.points([_drawOrigin.x, _drawOrigin.y, wp.x, wp.y]);
  } else if (_drawShape === 'rect') {
    const x = Math.min(_drawOrigin.x, wp.x), y = Math.min(_drawOrigin.y, wp.y);
    _drawLive.setAttrs({ x, y, width:Math.abs(wp.x-_drawOrigin.x), height:Math.abs(wp.y-_drawOrigin.y) });
  } else if (_drawShape === 'circle') {
    _drawLive.radius(Math.hypot(wp.x-_drawOrigin.x, wp.y-_drawOrigin.y));
  }
  _layers.draw.batchDraw();
}
async function _endDraw() {
  _drawing = false;
  if (!_drawLive || !_activePage) { _drawLive?.destroy(); _drawLive=null; return; }
  let data;
  if (_drawShape === 'pencil' && _drawPts.length >= 6) {
    data = { type:'freehand', points:_drawPts, offsetX:0, offsetY:0 };
  } else if (_drawShape === 'line') {
    const pts = _drawLive.points();
    if (Math.hypot(pts[2]-pts[0], pts[3]-pts[1]) < 3) { _drawLive.destroy(); _drawLive=null; return; }
    data = { type:'line', points:pts, offsetX:0, offsetY:0 };
  } else if (_drawShape === 'rect') {
    if (_drawLive.width() < 3 && _drawLive.height() < 3) { _drawLive.destroy(); _drawLive=null; return; }
    const rw = _drawLive.width(), rh = _drawLive.height();
    // x, y = centre du rect — l'ancrage est le centre pour que la rotation pivote sur place
    data = { type:'rect', x: _drawLive.x() + rw/2, y: _drawLive.y() + rh/2, w: rw, h: rh, fill:_drawFill, centered:true };
  } else if (_drawShape === 'circle') {
    if (_drawLive.radius() < 3) { _drawLive.destroy(); _drawLive=null; return; }
    data = { type:'circle', x:_drawLive.x(), y:_drawLive.y(), r:_drawLive.radius(), fill:_drawFill };
  }
  const liveCopy = _drawLive;
  _drawLive = null;
  if (!data) { liveCopy.destroy(); _layers.draw.batchDraw(); return; }
  data = { ...data, pageId:_activePage.id, color:_drawColor, strokeWidth:_drawWidth,
    createdBy: STATE.user?.uid||null, createdAt: serverTimestamp() };
  const id = 'a' + Date.now() + Math.random().toString(36).slice(2,5);
  try {
    await setDoc(_annotRef(id), data);
    _drawHistory.push(id); // permet Ctrl+Z
    liveCopy.destroy(); // l'onSnapshot va recréer la version persistée
  } catch(err) {
    console.error('[VTT] Annotation save error:', err?.code, err?.message);
    showNotif('Erreur sauvegarde annotation — vérifiez les règles Firestore', 'error');
    // Garder liveCopy visible temporairement (non persistée)
  }
  _layers.draw.batchDraw();
}

// SYNC FIRESTORE — onSnapshot sur 5 collections
// ═══════════════════════════════════════════════════════════════════
function _initListeners() {
  if (!_aid()) return;

  // 1. Session
  _unsubs.push(onSnapshot(_sesRef(), snap => {
    _session=snap.exists()?snap.data():{};
    _renderPageTabs();
    if (!STATE.isAdmin) {
      const uid=STATE.user?.uid;
      const target=_session.playerPages?.[uid]??_session.activePageId;
      if (target&&_pages[target]&&_activePage?.id!==target) _switchPage(target);
    }
    _renderTimer();
    _renderCombatTracker();
    _renderMjRulerRemote(_session.mjRuler);
  },()=>{}));

  // 2. Pages
  _unsubs.push(onSnapshot(_pgsCol(), snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type==='removed') delete _pages[ch.doc.id];
      else {
        _pages[ch.doc.id]={id:ch.doc.id,...ch.doc.data()};
        if (_activePage?.id===ch.doc.id) {
          _activePage=_pages[ch.doc.id];
          _renderMapImages();
          fogRenderWalls(_activePage, STATE.isAdmin);
          fogUpdateSoon(_activePage, _tokens, STATE.isAdmin);
        }
      }
    });
    _renderPageTabs();
    if (!_activePage&&Object.keys(_pages).length>0) {
      const uid=STATE.user?.uid;
      const target=(_session.playerPages?.[uid]??_session.activePageId)
        ||Object.values(_pages).sort((a,b)=>(a.order??0)-(b.order??0))[0]?.id;
      if (target&&_pages[target]) _switchPage(target);
    }
  },()=>{}));

  // 3. Personnages — source de vérité des HP joueurs
  _unsubs.push(onSnapshot(_chrsCol(), snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type==='removed') {
        delete _characters[ch.doc.id];
        // Supprimer le token lié si la session VTT est ouverte
        const tok = Object.values(_tokens).find(e => e.data.characterId === ch.doc.id);
        if (tok) deleteDoc(_tokRef(tok.data.id)).catch(() => {});
      } else {
        _characters[ch.doc.id]={id:ch.doc.id,...ch.doc.data()};
      }
    });
    // Refresh des shapes liés
    const changed=new Set(snap.docChanges().map(c=>c.doc.id));
    for (const [id,e] of Object.entries(_tokens)) {
      if (e.data.characterId&&changed.has(e.data.characterId)) {
        _patchShape(id); if (_selected===id) _renderInspectorSoon();
      }
    }
    _renderTraySoon();
    _charsReady=true; _maybeSyncAutoTokens();
    if (_miniUid) _renderMiniSheet(_miniUid); // refresh mini-fiche en temps réel
  },()=>{}));

  // 4. PNJ — source de vérité des HP PNJ
  _unsubs.push(onSnapshot(_npcsCol(), snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type==='removed') delete _npcs[ch.doc.id];
      else _npcs[ch.doc.id]={id:ch.doc.id,...ch.doc.data()};
    });
    const changed=new Set(snap.docChanges().map(c=>c.doc.id));
    for (const [id,e] of Object.entries(_tokens)) {
      if (e.data.npcId&&changed.has(e.data.npcId)) {
        _patchShape(id); if (_selected===id) _renderInspectorSoon();
      }
    }
    _renderTraySoon();
    _npcsReady=true; _maybeSyncAutoTokens();
  },()=>{}));

  // 5. Bestiaire — source de vérité des créatures ennemies
  _unsubs.push(onSnapshot(_bstCol(), snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type==='removed') delete _bestiary[ch.doc.id];
      else _bestiary[ch.doc.id]={id:ch.doc.id,...ch.doc.data()};
    });
    const changed=new Set(snap.docChanges().map(c=>c.doc.id));
    for (const [id,e] of Object.entries(_tokens)) {
      if (e.data.beastId&&changed.has(e.data.beastId)) {
        _patchShape(id); if (_selected===id) _renderInspectorSoon();
      }
    }
    _renderTraySoon();
    _bstsReady=true; _maybeSyncAutoTokens();
  },()=>{}));

  // 5b. Tracker bestiaire joueur (estimations personnelles)
  if (!STATE.isAdmin) {
    const uid = STATE.user?.uid;
    if (uid) {
      _unsubs.push(onSnapshot(_bstTrackerRef(uid), snap => {
        _bstTracker = snap.exists() ? (snap.data().data || {}) : {};
        // Mettre à jour la barre HP de tous les tokens ennemis sur le canvas
        for (const [id, e] of Object.entries(_tokens)) {
          if (e.data?.type === 'enemy' && e.data?.beastId) _patchShape(id);
        }
        // Rafraîchit l'inspector si un token ennemi est sélectionné
        if (_selected) {
          const td = _tokens[_selected]?.data;
          if (td?.type === 'enemy') _renderInspectorSoon();
        }
      }, () => {}));
    }
  }

  // 6. Tokens
  _unsubs.push(onSnapshot(_toksCol(), snap => {
    snap.docChanges().forEach(ch => {
      const id=ch.doc.id, data={id,...ch.doc.data()};
      if (ch.type==='removed') {
        _tokens[id]?.shape?.destroy(); delete _tokens[id];
        if (_selected===id) _deselect();
        _layers.token?.batchDraw(); return;
      }
      const prev=_tokens[id];
      if (prev) {
        const changedPage=prev.data.pageId!==data.pageId;
        prev.data=data;
        if (changedPage) {
          prev.shape?.destroy(); prev.shape=null;
          if (_activePage&&data.pageId===_activePage.id&&(data.visible||STATE.isAdmin)) {
            const shape=_buildShape(data);
            _tokens[id]={data,shape}; _layers.token?.add(shape); _layers.token?.batchDraw();
          } else {
            _tokens[id]={data,shape:null};
          }
        } else {
          _patchShape(id);
        }
        if (_selected===id) { _renderInspectorSoon(); _refreshRanges(id); }
      } else {
        _tokens[id]={data,shape:null};
        if (_activePage&&data.pageId===_activePage.id&&(data.visible||STATE.isAdmin)) {
          const shape=_buildShape(data);
          _tokens[id].shape=shape;
          _layers.token?.add(shape); _layers.token?.batchDraw();
        }
      }
    });
    _renderTraySoon();
    _renderCombatTrackerSoon();
    _toksReady=true; _maybeSyncAutoTokens();
    // Recalcul fog si un token joueur a bougé
    if (snap.docChanges().some(ch => ch.doc.data()?.type === 'player'))
      fogUpdateSoon(_activePage, _tokens, STATE.isAdmin);
  },()=>{}));

  // 7. Annotations (dessins + formes)
  _unsubs.push(onSnapshot(_annotCol(), snap => {
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        // Retirer du transformer avant destroy
        if (_selectedAnnotIds.has(id)) {
          _selectedAnnotIds.delete(id);
          _annotTransformer?.nodes([]);
        }
        _annotations[id]?.shape?.destroy();
        delete _annotations[id];
        if (_selectedAnnotId === id) { _selectedAnnotId = null; }
      } else {
        const newData = { id, ...ch.doc.data() };
        if (_skipAnnotRebuild.has(id)) {
          // Transform local : le shape visuel est déjà correct — juste mettre à jour les données
          _skipAnnotRebuild.delete(id);
          if (_annotations[id]) Object.assign(_annotations[id].data, newData);
        } else {
          if (_annotations[id]) {
            // Vider le transformer avant de détruire l'ancien shape
            if (_selectedAnnotIds.has(id)) _annotTransformer?.nodes([]);
            _annotations[id].shape?.destroy();
          }
          _annotations[id] = { data: newData, shape: null };
          // Rendre sur la page active seulement
          if (_activePage && newData.pageId === _activePage.id) {
            const K = window.Konva;
            const shape = _buildAnnotShape(K, newData);
            if (shape) { _annotations[id].shape = shape; _layers.draw?.add(shape); }
          }
        }
      }
    });
    _updateAnnotDraggable();
    // Réappliquer le transformer sur les shapes reconstruits
    if (_selectedAnnotIds.size > 0) _applyAnnotTransformer();
    _layers.draw?.batchDraw();
  }, () => {}));

  // 8. Ciblage multi-sorts temps réel (lignes pointillées broadcast)
  _unsubs.push(onSnapshot(_castingCol(), snap => {
    _renderRemoteCastings(snap.docs);
  }, () => {}));

  // 9. Pings + présence temps réel
  _unsubs.push(onSnapshot(_pingsCol(), snap => {
    const now = Date.now();

    // Présence : actif si lastSeen < 2 min (double filtrage : ici + render)
    _presence = {};
    snap.docs.forEach(d => {
      const pres = d.data().pres;
      if (!pres?.lastSeen) return;
      const ts = pres.lastSeen?.toMillis?.() ?? (typeof pres.lastSeen === 'number' ? pres.lastSeen : 0);
      if (ts > 0 && now - ts < 120_000) _presence[d.id] = { uid: d.id, pseudo: pres.pseudo || '?', lastSeen: ts };
    });
    _renderPresenceCol();

    // Pings visuels (< 5 s)
    const pings = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.pageId === _activePage?.id && p.createdAt && (now - p.createdAt.toMillis()) < 5000);
    _renderPings(pings);
  }, () => {})); // silencieux si pas de règle Firestore

  // 10. Réactions émotes temps réel
  _unsubs.push(onSnapshot(_reactionsCol(), snap => {
    const now = Date.now();
    snap.docs.forEach(d => {
      const r = { id: d.id, ...d.data() };
      if (!r.emoteUrl) return;
      // createdAt stocké comme nombre (ms) — pas de serverTimestamp
      const ts = typeof r.createdAt === 'number' ? r.createdAt : r.createdAt?.toMillis?.() ?? now;
      if (now - ts > 12000) return; // ignorer les réactions de plus de 12s
      const key = `${r.id}_${ts}`;
      // _renderedReactions.has(key) bloque le double affichage pour l'émetteur
      _showEmoteBubble(r.tokenId, r.emoteUrl, r.emoteName, key);
    });
  }, err => {
    console.error('[vtt] réactions émotes — erreur listener:', err);
  }));

  // 11. Chat / Log de dés
  _unsubs.push(onSnapshot(_logCol(), snap => {
    const msgs=snap.docs
      .map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(a.createdAt?.toMillis?.()??0)-(b.createdAt?.toMillis?.()??0))
      .slice(-60);
    _renderChatLog(msgs);
  }, e => {
    console.error('[vtt] chat listener:', e);
    const el=document.getElementById('vtt-chat-log');
    if (el) el.innerHTML=`<div class="vtt-log-entry vtt-log-roll" style="color:#ef4444">⚠ Accès refusé — ajouter <code>vttLog</code> aux règles Firestore</div>`;
  }));

  // Bibliothèque de cartes (MJ only)
  if (STATE.isAdmin) {
    _mapLibUnsub = onSnapshot(_mapLibRef(), snap => {
      _mapLib = snap.exists() ? snap.data() : {};
      if (!Array.isArray(_mapLib.folders)) _mapLib.folders = [];
      if (!Array.isArray(_mapLib.images))  _mapLib.images  = [];
      _renderLibSection();
    }, () => {});
  }

  // Butin d'aventure
  _lootUnsub = onSnapshot(_lootRef(), snap => {
    _loot = snap.exists() ? snap.data() : {};
    if (!Array.isArray(_loot.stash)) _loot.stash = [];
    if (!Array.isArray(_loot.loot))  _loot.loot  = [];
    _renderLootPanel();
  }, () => {});

  // 12. Sons VTT
  _unsubs.push(onSnapshot(_sonsCol(), snap => {
    _sounds = snap.docs
      .map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(a.createdAt?.toMillis?.()??0)-(b.createdAt?.toMillis?.()??0));
    if (document.getElementById('vtt-music-panel')?.dataset.open==='1') _renderMusicPanel();
  }, ()=>{}));

  // 13. Playlists VTT
  _unsubs.push(onSnapshot(_playlistsCol(), snap => {
    _playlists = snap.docs
      .map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(a.createdAt?.toMillis?.()??0)-(b.createdAt?.toMillis?.()??0));
    if (document.getElementById('vtt-music-panel')?.dataset.open==='1') _renderMusicPanel();
  }, ()=>{}));

  // 14. État musique — sync pour tous les clients
  _unsubs.push(onSnapshot(_musicStateRef(), snap => {
    _syncMusicPlayback(snap.exists() ? snap.data() : {});
  }, ()=>{}));
}

// ═══════════════════════════════════════════════════════════════════
// MENU CONTEXTUEL (clic-droit images)
// ═══════════════════════════════════════════════════════════════════
let _ctxClose = null;
const _CTX_ACTIONS = {};

function _hideCtxMenu() {
  document.getElementById('vtt-ctx-menu')?.remove();
  if (_ctxClose) { document.removeEventListener('mousedown', _ctxClose); _ctxClose=null; }
}

function _showCtxMenu(x, y, items) {
  _hideCtxMenu();
  const el=document.createElement('div');
  el.id='vtt-ctx-menu'; el.className='vtt-ctx-menu';
  let idx=0;
  el.innerHTML=items.map(item=>{
    if (item==='---') return '<div class="vtt-ctx-sep"></div>';
    const i=idx++;
    _CTX_ACTIONS[i]=item.fn;
    return `<div class="vtt-ctx-item" data-i="${i}">${item.label}</div>`;
  }).join('');
  el.addEventListener('click', e=>{
    const i=e.target.closest('.vtt-ctx-item')?.dataset.i;
    if (i!=null) { _CTX_ACTIONS[+i]?.(); _hideCtxMenu(); }
  });
  // Positionner en évitant de sortir de l'écran
  el.style.cssText=`left:${x}px;top:${y}px;visibility:hidden`;
  document.body.appendChild(el);
  const r=el.getBoundingClientRect(), vw=window.innerWidth, vh=window.innerHeight;
  const left = r.right  > vw ? Math.max(0, x - r.width)  : x;
  const top  = r.bottom > vh ? Math.max(0, y - r.height) : y;
  el.style.cssText=`left:${left}px;top:${top}px;`;
  _ctxClose=e=>{ if (!el.contains(e.target)) _hideCtxMenu(); };
  setTimeout(()=>document.addEventListener('mousedown',_ctxClose), 0);
}

// ── Mode édition carte ───────────────────────────────────────────
function _setMapMode(on) {
  _mapMode=on;
  _layers.map?.listening(on);
  _layers.mapFg?.listening(on);
  // Mettre à jour le draggable de toutes les images existantes
  const toggle = lyr => lyr?.find('Image').forEach(ki=>ki.draggable(on));
  toggle(_layers.map); toggle(_layers.mapFg);
  if (!on) {
    _imgTr?.nodes([]); _imgTrFg?.nodes([]); _selImg=null;
    _layers.map?.batchDraw(); _layers.mapFg?.batchDraw();
    _hideCtxMenu();
  }
  const btn=document.getElementById('vtt-map-mode-btn');
  if (btn) { btn.classList.toggle('active',on); btn.textContent=on?'🗺 Carte ✏':'🗺 Carte 🔒'; }
}
window._vttToggleMapMode = () => _setMapMode(!_mapMode);

// ═══════════════════════════════════════════════════════════════════
// CHAT & LOG DE DÉS
// ═══════════════════════════════════════════════════════════════════
// ── Émotes ──────────────────────────────────────────────────────────
async function _loadEmotes() {
  // 1. Tenter le path scopé à l'aventure (path normal)
  try {
    const data = await getDocData('world', 'vtt_emotes');
    if (data?.emotes?.length) { _emotes = data.emotes; return; }
  } catch(e) { console.warn('[vtt] emotes (adventure path) :', e.message); }

  // 2. Fallback : path global world/vtt_emotes (migration ancien stockage)
  try {
    const snap = await getDoc(doc(db, 'world', 'vtt_emotes'));
    _emotes = snap.data()?.emotes || [];
    if (_emotes.length) console.info('[vtt] emotes chargées depuis le path global (migration)');
  } catch(e) {
    console.warn('[vtt] emotes (global path) :', e.message);
    _emotes = [];
  }
}

// Initialiser immédiatement : localStorage (ordre perso) > défauts
_diceSkills = lsJson.get(DICE_SKILLS_STORAGE_KEY, [...DICE_SKILLS_DEFAULT]);

async function _loadDiceSkills() {
  try {
    const data = await getDocData('world', 'dice_skills');
    if (data?.skills?.length) _diceSkills = data.skills;
  } catch { /* garde le cache local */ }
  // Re-render l'inspector si un token est déjà sélectionné
  if (_selected) _renderInspector(_tokens[_selected]?.data ?? null);
}

window._vttSetRollMode = mode => {
  _rollMode = mode;
  // Mettre à jour les boutons visuellement sans re-render complet
  document.querySelectorAll('.vtt-roll-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
};

window._vttAdjBonus = (delta, reset = false) => {
  _rollBonus = reset ? 0 : Math.max(-20, Math.min(20, _rollBonus + delta));
  const el = document.getElementById('vtt-bonus-val');
  if (el) {
    el.textContent = _rollBonus > 0 ? `+${_rollBonus}` : `${_rollBonus}`;
    el.classList.toggle('nonzero', _rollBonus !== 0);
  }
};

window._vttRollSkill = async (skillName, stat) => {
  const t = _tokens[_selected]?.data;
  if (!t) return;
  if (!STATE.isAdmin && t.ownerId !== STATE.user?.uid) return; // joueur ne peut lancer que son propre token
  const c = t?.characterId ? _characters[t.characterId] : null;
  const n = t?.npcId ? _npcs[t.npcId] : null;
  const statKey = _STAT_KEY[stat] || '';
  const mod = _tokenStatMod(t, statKey);
  const d20 = () => Math.floor(Math.random() * 20) + 1;

  let d1 = d20(), d2, roll;
  if (_rollMode === 'advantage')    { d2 = d20(); roll = Math.max(d1, d2); }
  else if (_rollMode === 'disadvantage') { d2 = d20(); roll = Math.min(d1, d2); }
  else                              { roll = d1; }

  const total   = roll + mod + _rollBonus;
  const isCrit  = roll === 20, isFumble = roll === 1;
  const authorName    = STATE.profile?.pseudo || STATE.profile?.prenom || 'Joueur';
  const characterName = c?.nom || n?.nom || t?.name || null;
  const characterImage = c?.photoURL || c?.photo || c?.avatar || n?.photoURL || n?.photo || n?.avatar || n?.imageUrl || null;
  try {
    await addDoc(_logCol(), {
      type: 'roll',
      authorId: STATE.user?.uid || null,
      authorName, characterName, characterImage,
      rollMode: _rollMode,
      rollDice: d2 !== undefined ? [d1, d2] : [d1],
      rollRaw: roll, rollMod: mod, rollBonus: _rollBonus || 0,
      rollResult: total,
      rollSkill: skillName, rollStat: stat,
      isCrit, isFumble,
      createdAt: serverTimestamp(),
    });
  } catch(e) { showNotif('Erreur jet : ' + e.message, 'error'); }
};

async function _saveEmotes(list) {
  _emotes = list;
  try { await saveDoc('world', 'vtt_emotes', { emotes: list }); }
  catch(e) { showNotif('Erreur sauvegarde émotes : ' + e.message, 'error'); }
}

// Convertit les balises :nom: en <img> dans un texte déjà échappé
function _applyEmotes(escaped) {
  for (const em of _emotes) {
    const key = `:${_esc(em.name)}:`;
    const img = `<img class="vtt-emote-inline" src="${em.url}" alt="${key}" title="${key}">`;
    escaped = escaped.split(key).join(img);
  }
  return escaped;
}

// Favoris émotes — stockés en localStorage
const _getFavs = () => lsJson.get('vtt-emote-favs', []);
const _setFavs = v => lsJson.set('vtt-emote-favs', v);

function _emoteGridHtml(list, favSet=new Set()) {
  if (!list.length) return '<div class="vtt-emote-empty-grid">Aucune émote trouvée</div>';
  return list.map(em => {
    const safe = em.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const isFav = favSet.has(em.name);
    return `<div class="vtt-emote-item-wrap">
      <button class="vtt-emote-item" onclick="window._vttPickEmote('${safe}')" title=":${_esc(em.name)}:">
        <img src="${em.url}" alt="${_esc(em.name)}" loading="lazy">
        <span>${_esc(em.name)}</span>
      </button>
      <button class="vtt-emote-fav-btn${isFav?' active':''}" onclick="window._vttToggleFav('${safe}')" title="${isFav?'Retirer des favoris':'Ajouter aux favoris'}">${isFav?'★':'☆'}</button>
    </div>`;
  }).join('');
}

function _renderEmotePicker() {
  const el = document.getElementById('vtt-emote-picker');
  if (!el) return;
  if (!_emotes.length) {
    el.innerHTML = '<div class="vtt-emote-picker-search"><span style="padding:.5rem;display:block;font-size:.75rem;color:var(--text-muted)">Aucune émote — à configurer dans la Console MJ</span></div>';
    return;
  }
  const favSet = new Set(_getFavs());
  const favEmotes = _emotes.filter(e => favSet.has(e.name));
  const favBlock = favEmotes.length
    ? `<div id="vtt-emote-fav-section">
        <div class="vtt-emote-section-lbl gold">⭐ Favoris</div>
        <div class="vtt-emote-grid" id="vtt-emote-fav-grid">${_emoteGridHtml(favEmotes, favSet)}</div>
      </div>
      <div class="vtt-emote-section-lbl">Toutes</div>`
    : `<div id="vtt-emote-fav-section" style="display:none"></div>`;
  el.innerHTML = `
    <div class="vtt-emote-picker-search">
      <input type="text" id="vtt-emote-search" placeholder="🔍 Rechercher…" autocomplete="off"
        oninput="window._vttFilterEmotes(this.value)">
    </div>
    <div class="vtt-emote-picker-body">
      ${favBlock}
      <div class="vtt-emote-grid" id="vtt-emote-grid">${_emoteGridHtml(_emotes, favSet)}</div>
    </div>`;
  setTimeout(() => document.getElementById('vtt-emote-search')?.focus(), 40);
}

window._vttFilterEmotes = (q) => {
  const favSet = new Set(_getFavs());
  const grid = document.getElementById('vtt-emote-grid'); if (!grid) return;
  const filtered = q.trim() ? _emotes.filter(e => e.name.includes(q.trim().toLowerCase())) : _emotes;
  grid.innerHTML = _emoteGridHtml(filtered, favSet);
  const favSection = document.getElementById('vtt-emote-fav-section');
  if (favSection) favSection.style.display = q.trim() ? 'none' : '';
};

window._vttToggleFav = (name) => {
  const favs = _getFavs();
  const idx = favs.indexOf(name);
  if (idx >= 0) favs.splice(idx, 1); else favs.push(name);
  _setFavs(favs);
  // Re-render en préservant la query de recherche
  const q = document.getElementById('vtt-emote-search')?.value || '';
  _renderEmotePicker();
  if (q) {
    const input = document.getElementById('vtt-emote-search');
    if (input) { input.value = q; _vttFilterEmotes(q); }
  }
};

function _closeEmotePicker() {
  const el  = document.getElementById('vtt-emote-picker');
  const btn = document.querySelector('.vtt-emote-trigger');
  el?.classList.remove('open');
  btn?.classList.remove('open');
  if (_emoteCloseOutside) {
    document.removeEventListener('mousedown', _emoteCloseOutside, true);
    _emoteCloseOutside = null;
  }
}

window._vttToggleEmotePicker = () => {
  const el  = document.getElementById('vtt-emote-picker');
  const btn = document.querySelector('.vtt-emote-trigger');
  if (!el) return;
  const open = el.classList.toggle('open');
  btn?.classList.toggle('open', open);
  if (open) {
    _renderEmotePicker();
    _emoteCloseOutside = (e) => {
      const float = document.querySelector('.vtt-emote-float');
      if (float && !float.contains(e.target)) _closeEmotePicker();
    };
    document.addEventListener('mousedown', _emoteCloseOutside, true);
  } else {
    _closeEmotePicker();
  }
};

window._vttPickEmote = async (name) => {
  const uid = STATE.user?.uid; if (!uid) return;
  const em = _emotes.find(e => e.name === name); if (!em) return;
  // Le picker reste ouvert — l'utilisateur ferme manuellement

  // Clé partagée locale + Firestore : même timestamp → _renderedReactions évite le double affichage
  const ts = Date.now();
  const key = `${uid}_${ts}`;

  // Affichage local immédiat
  _showEmoteBubble(null, em.url, name, key);

  // Propagation aux autres joueurs via Firestore
  let tokenId = _selected;
  if (!tokenId) {
    const own = Object.values(_tokens).find(e => e.data.ownerId === uid);
    tokenId = own?.data?.id ?? null;
  }
  setDoc(_reactionRef(uid), {
    tokenId, emoteName: name, emoteUrl: em.url,
    pageId: _activePage?.id ?? null,
    createdAt: ts,           // nombre (ms) — même valeur que la clé locale
  }).catch(err => {
    console.error('[vtt] émote temps réel — écriture refusée. Vérifier vttEmoteReactions dans Firestore.', err);
  });
};

window._ouvrirGestionEmotes = async () => {
  await _loadEmotes();
  const { default: Sortable } = await import('../vendor/sortable.esm.js');

  // ── Helper upload ImgBB ──────────────────────────────────────────
  const _getEmoteAlbum = () => localStorage.getItem('vtt-imgbb-emote-album') || '';
  const _setEmoteAlbum = v => v ? localStorage.setItem('vtt-imgbb-emote-album', v) : localStorage.removeItem('vtt-imgbb-emote-album');

  const _uploadImgbb = async (file) => {
    const key = _getImgbbKey();
    if (!key) throw new Error('Clé ImgBB non configurée (bouton 🔑 dans le VTT)');
    const b64 = await new Promise((res, rej) => {
      const rd = new FileReader(); rd.onload = () => res(rd.result.split(',')[1]); rd.onerror = rej;
      rd.readAsDataURL(file);
    });
    const fd = new FormData(); fd.append('key', key); fd.append('image', b64);
    const album = _getEmoteAlbum();
    if (album) fd.append('album', album);
    const resp = await fetch('https://api.imgbb.com/1/upload', { method:'POST', body:fd });
    const json = await resp.json();
    if (!json.success) throw new Error(json.error?.message || 'ImgBB error');
    return json.data.url;
  };

  // ── Rendu de la grille de cartes ─────────────────────────────────
  const _cardsHtml = (list) => list.length
    ? `<div id="emote-cards-grid" class="vtt-emote-cards">${
        list.map((em, i) => `
          <div class="vtt-emote-card" data-i="${i}">
            <span class="vtt-emote-card-drag" title="Déplacer">⠿</span>
            <img src="${em.url}" alt="${_esc(em.name)}">
            <span class="vtt-emote-card-name" title=":${_esc(em.name)}:">:${_esc(em.name)}:</span>
            <div class="vtt-emote-card-actions">
              <button class="vtt-ec-btn vtt-ec-edit" onclick="window._vttEditEmote(${i})" title="Modifier">✏</button>
              <button class="vtt-ec-btn vtt-ec-del"  onclick="window._vttDeleteEmote(${i})" title="Supprimer">✕</button>
            </div>
          </div>`).join('')
      }</div>`
    : '<div style="color:var(--text-dim);font-size:.8rem;padding:.5rem 0">Aucune émote pour l\'instant.</div>';

  const _inpStyle = 'width:100%;box-sizing:border-box;background:var(--bg-elevated);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:.8rem;padding:.3rem .5rem';

  openModal('😄 Gestion des Émotes', `
    <div style="display:flex;flex-direction:column;gap:.85rem;padding:.3rem 0">
      <div style="font-size:.72rem;color:var(--text-muted)">Maintenez ⠿ pour réordonner par glisser-déposer. Cliquez ✏ pour modifier.</div>
      <div id="emote-manage-list">${_cardsHtml(_emotes)}</div>
      <div id="emote-edit-zone"></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:0">
      <div style="display:flex;align-items:center;gap:.6rem">
        <label style="font-size:.75rem;color:var(--text-muted);white-space:nowrap">📁 Album ImgBB</label>
        <input type="text" id="emote-album-id" placeholder="ID de l'album (optionnel)" value="${_getEmoteAlbum()}" style="${_inpStyle};flex:1" oninput="(v=>v?localStorage.setItem('vtt-imgbb-emote-album',v):localStorage.removeItem('vtt-imgbb-emote-album'))(this.value.trim())">
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:0">
      <div style="font-weight:600;font-size:.85rem">➕ Ajouter une émote</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">
        <div class="form-group" style="margin:0">
          <label style="font-size:.75rem;color:var(--text-muted)">Nom (ex: <code>rire</code>)</label>
          <input type="text" id="emote-add-name" placeholder="nomemote" style="${_inpStyle}">
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:.75rem;color:var(--text-muted)">Fichier <span style="opacity:.6">(ou URL ci-dessous)</span></label>
          <input type="file" id="emote-add-file" accept="image/*" style="font-size:.78rem;margin-top:.25rem">
        </div>
      </div>
      <div class="form-group" style="margin:0">
        <label style="font-size:.75rem;color:var(--text-muted)">URL directe <span style="opacity:.6">(si déjà hébergé sur ImgBB)</span></label>
        <input type="text" id="emote-add-url" placeholder="https://i.ibb.co/…" style="${_inpStyle}">
      </div>
      <div style="display:flex;align-items:center;gap:.7rem">
        <button class="btn btn-primary" style="flex:1" onclick="window._vttAddEmote()">➕ Ajouter l'émote</button>
        <span id="emote-add-status" style="font-size:.78rem;color:var(--text-dim);flex:1;min-height:1rem"></span>
      </div>
    </div>`);

  // ── SortableJS ───────────────────────────────────────────────────
  const _initSort = () => {
    const grid = document.getElementById('emote-cards-grid'); if (!grid) return;
    new Sortable(grid, {
      animation: 180, handle: '.vtt-emote-card-drag',
      ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen',
      onEnd: async (evt) => {
        if (evt.oldIndex === evt.newIndex) return;
        const list = [..._emotes];
        const [moved] = list.splice(evt.oldIndex, 1);
        list.splice(evt.newIndex, 0, moved);
        await _saveEmotes(list);
        showNotif('Ordre sauvegardé', 'success');
      },
    });
  };
  _initSort();

  // ── Rafraîchit la grille ─────────────────────────────────────────
  const _refresh = (clearEdit = true) => {
    const el = document.getElementById('emote-manage-list'); if (!el) return;
    el.innerHTML = _cardsHtml(_emotes); _initSort();
    if (clearEdit) { const ez = document.getElementById('emote-edit-zone'); if (ez) ez.innerHTML = ''; }
  };

  // ── Supprimer ────────────────────────────────────────────────────
  window._vttDeleteEmote = async (i) => {
    if (!await confirmModal(`Supprimer :${_emotes[i]?.name}: ?`)) return;
    const list = [..._emotes]; list.splice(i, 1);
    await _saveEmotes(list); _refresh();
    showNotif('Émote supprimée', 'success');
  };

  // ── Ouvrir le panneau d'édition (horizontal, sous la grille) ─────
  window._vttEditEmote = (i) => {
    const em = _emotes[i]; if (!em) return;
    // Mettre en évidence la carte sélectionnée
    document.querySelectorAll('.vtt-emote-card').forEach(c => c.classList.remove('is-editing'));
    document.querySelector(`.vtt-emote-card[data-i="${i}"]`)?.classList.add('is-editing');
    // Remplir la zone d'édition
    const ez = document.getElementById('emote-edit-zone'); if (!ez) return;
    ez.innerHTML = `
      <div class="vtt-ec-panel">
        <img class="vtt-ec-panel-preview" id="ec-preview-${i}" src="${em.url}" alt="${_esc(em.name)}">
        <div class="vtt-ec-panel-fields">
          <div class="vtt-ec-panel-title">✏ Modifier <span style="font-family:monospace">:${_esc(em.name)}:</span></div>
          <div class="vtt-ec-panel-row">
            <label>Nouveau nom</label>
            <input type="text" id="ec-name-${i}" value="${_esc(em.name)}" autocomplete="off"
              onkeydown="if(event.key==='Enter') window._vttSaveEmote(${i})">
          </div>
          <div class="vtt-ec-panel-row">
            <label>Nouvelle image <span style="opacity:.6">(optionnel)</span></label>
            <input type="file" id="ec-file-${i}" accept="image/*"
              onchange="const f=this.files?.[0];if(f){const u=URL.createObjectURL(f);document.getElementById('ec-preview-${i}').src=u}">
          </div>
          <div class="vtt-ec-panel-btns">
            <button class="vtt-ec-save"   onclick="window._vttSaveEmote(${i})">✓ Enregistrer</button>
            <button class="vtt-ec-cancel" onclick="document.getElementById('emote-edit-zone').innerHTML='';document.querySelectorAll('.vtt-emote-card').forEach(c=>c.classList.remove('is-editing'))">✕ Annuler</button>
          </div>
        </div>
      </div>`;
    document.getElementById(`ec-name-${i}`)?.focus();
  };

  // ── Sauvegarder l'édition ────────────────────────────────────────
  window._vttSaveEmote = async (i) => {
    const nameEl = document.getElementById(`ec-name-${i}`);
    const fileEl = document.getElementById(`ec-file-${i}`);
    const newName = nameEl?.value.trim().replace(/\s+/g, '_').toLowerCase();
    if (!newName) { showNotif('Nom requis', 'error'); return; }
    const list = [..._emotes];
    const em = { ...list[i], name: newName };
    if (fileEl?.files?.[0]) {
      showNotif('Upload en cours…', 'info');
      try { em.url = await _uploadImgbb(fileEl.files[0]); }
      catch(e) { showNotif('⚠ ' + e.message, 'error'); return; }
    }
    list[i] = em;
    await _saveEmotes(list); _refresh();
    showNotif(`✓ :${newName}: mis à jour`, 'success');
  };

  // ── Ajouter ──────────────────────────────────────────────────────
  window._vttAddEmote = async () => {
    const nameEl   = document.getElementById('emote-add-name');
    const fileEl   = document.getElementById('emote-add-file');
    const urlEl    = document.getElementById('emote-add-url');
    const statusEl = document.getElementById('emote-add-status');
    const name = nameEl?.value.trim().replace(/\s+/g, '_').toLowerCase();
    const file = fileEl?.files?.[0];
    const directUrl = urlEl?.value.trim();
    if (!name) { if (statusEl) statusEl.textContent = '⚠ Nom requis'; return; }
    if (!file && !directUrl) { if (statusEl) statusEl.textContent = '⚠ Fichier ou URL requis'; return; }
    let url;
    if (file) {
      if (statusEl) statusEl.textContent = '⏳ Upload…';
      try { url = await _uploadImgbb(file); }
      catch(e) { if (statusEl) statusEl.textContent = '⚠ ' + e.message; return; }
    } else {
      url = directUrl;
    }
    await _saveEmotes([..._emotes, { id: Date.now().toString(), name, url }]);
    if (statusEl) statusEl.textContent = `✓ :${name}: ajoutée !`;
    if (nameEl) nameEl.value = '';
    if (fileEl) fileEl.value = '';
    if (urlEl)  urlEl.value  = '';
    _refresh();
  };
};

function _renderChatLog(msgs) {
  const el=document.getElementById('vtt-chat-log'); if (!el) return;
  const myUid=STATE.user?.uid;

  // Portrait 22px : image si dispo, sinon initiale colorée
  const _portrait = (url, name, color='var(--gold)') => url
    ? `<img class="vtt-log-portrait" src="${url}" alt="${_esc(name||'')}" onerror="this.style.visibility='hidden'">`
    : `<div class="vtt-log-portrait" style="background:${color}">${_esc((name||'?')[0].toUpperCase())}</div>`;

  // Timestamp HH:MM depuis le serverTimestamp Firestore
  const _ts = m => {
    const ms = m.createdAt?.toMillis?.();
    if (!ms) return '';
    const d = new Date(ms);
    return `<span class="vtt-log-time">${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}</span>`;
  };

  // Groupe badge + timestamp aligné à droite dans un header flex
  const _right = (badge, ts) => {
    const inner = [badge, ts].filter(Boolean).join('');
    return inner ? `<span style="margin-left:auto;display:flex;align-items:center;gap:.25rem">${inner}</span>` : '';
  };

  el.innerHTML=msgs.map((m, i)=>{
    const isMe=m.authorId===myUid;
    const who=`<span class="vtt-log-who${isMe?' me':''}">${_esc(m.authorName||'?')}</span>`;
    const ts = _ts(m);

    if (m.type==='cast') {
      // Sort CA / utilitaire — pas de jet de dés
      const pmStr = m.pmCost > 0
        ? `<span style="font-size:.65rem;color:#b47fff">−${m.pmCost} PM</span>` : '';
      const castWho = m.casterName || m.authorName || '?';
      return `<div class="vtt-log-entry vtt-log-roll"
          style="border-left:3px solid #b47fff;padding:.3rem .3rem .3rem .5rem;background:rgba(180,127,255,.05);border-radius:0 6px 6px 0">
        <div style="display:flex;align-items:center;gap:.35rem;flex-wrap:wrap">
          ${_portrait(m.characterImage, castWho, '#b47fff')}
          <span style="font-weight:700;font-size:.78rem;color:var(--text)">${_esc(castWho)}</span>
          <span style="font-size:.72rem;color:var(--text-dim)">✨</span>
          <strong style="font-size:.82rem">${_esc(m.optLabel||'')}</strong>
          <span style="color:var(--text-dim);font-size:.65rem">→ ${_esc(m.targetName||'')}</span>
          ${pmStr}
          ${_right('', ts)}
        </div>
        ${m.castEffect && m.castEffect !== '—' ? `<div style="font-size:.68rem;color:var(--text-dim);margin-top:.15rem;padding-left:calc(22px + .35rem)">${_esc(m.castEffect)}</div>` : ''}
      </div>`;
    }
    if (m.type==='attack' && m.isHeal) {
      // Sort de soin
      const sn  = n => n>0?`+${n}`:n<0?`${n}`:'';
      const sub = t => `<span style="font-size:.6rem;color:var(--text-dim)">(${t})</span>`;
      const baseDice = _esc(m.dmgEffectiveDice || m.dmgRawDice || m.dmgFormula || '');
      const mods = [
        m.dmgMaitriseBonus > 0 ? `+${m.dmgMaitriseBonus}` + sub('Maîtrise') : '',
        m.dmgBonus ? sn(m.dmgBonus) + sub('bonus') : '',
        m.dmgBonusDice ? sn(m.dmgBonusDice) + sub('dés') : '',
      ].filter(Boolean).join(' ');
      const healWho = m.attackerName || m.authorName || '?';
      const detailId = `vtt-d-${i}`;
      const detailHtml = `<div style="font-size:.65rem;color:var(--text-dim)">${baseDice}(${m.dmgRaw}) ${mods} = ${m.dmgTotal}</div>`;
      return `<div class="vtt-log-entry vtt-log-roll"
          style="border-left:3px solid #22c38e;padding:.3rem .3rem .3rem .5rem;background:rgba(34,195,142,.05);border-radius:0 6px 6px 0">
        <div style="display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;margin-bottom:.2rem">
          ${_portrait(m.characterImage, healWho, '#22c38e')}
          <span style="font-weight:700;font-size:.78rem;color:var(--text)">${_esc(healWho)}</span>
          <span style="color:var(--text-dim);font-size:.72rem">→</span>
          <strong style="font-size:.82rem">${_esc(m.defenderName||'')}</strong>
          <span style="color:var(--text-dim);font-size:.65rem">· ${_esc(m.optLabel||'')}</span>
          ${_right('', ts)}
        </div>
        <div style="display:flex;align-items:center;gap:.3rem;flex-wrap:wrap;padding-left:calc(22px + .35rem)">
          <span style="font-size:.78rem">💚</span>
          <strong style="font-size:1.05rem;color:#22c38e;letter-spacing:-.01em">${m.dmgTotal}</strong>
          <span style="font-size:.72rem;color:#22c38e">PV soignés</span>
          <button class="vtt-log-detail-btn" onclick="(e=>{const d=document.getElementById('${detailId}');const o=d.style.display!=='none';d.style.display=o?'none':'block';e.currentTarget.classList.toggle('open',!o)})(event)">détail</button>
        </div>
        <div id="${detailId}" style="display:none;padding-left:calc(22px + .35rem);margin-top:.15rem">${detailHtml}</div>
      </div>`;
    }
    if (m.type==='attack-multi') {
      const sn  = n => n>0?`+${n}`:n<0?`${n}`:'';
      const sub = t => `<span style="font-size:.6rem;color:var(--text-dim)">(${t})</span>`;
      const isCrit = m.isCrit, isFumble = m.isFumble;
      const borderCol = isCrit ? '#f59e0b' : isFumble ? '#7f1d1d' : '#b47fff';
      const bgRgb     = isCrit ? '245,158,11' : isFumble ? '127,29,29' : '180,127,255';
      const accentCol = isCrit ? '#f59e0b' : m.targets?.some(r=>r.hit) ? '#22c38e' : '#ef4444';
      const resultBadge = isCrit
        ? `<span style="font-size:.68rem;font-weight:700;color:#f59e0b">💥 CRITIQUE</span>`
        : isFumble ? `<span style="font-size:.68rem;font-weight:700;color:#ef4444">💀 FUMBLE</span>` : '';
      const rolls    = Array.isArray(m.hitD20rolls) && m.hitD20rolls.length > 1 ? m.hitD20rolls : null;
      const advBadge = m.advMode==='adv'
        ? `<span style="font-size:.62rem;font-weight:700;color:#22c38e" title="Avantage">⬆</span>`
        : m.advMode==='dis'
        ? `<span style="font-size:.62rem;font-weight:700;color:#ef4444" title="Désavantage">⬇</span>` : '';
      // Détail : dé gardé en gras, dé rejeté barré
      const diceDisp = rolls
        ? (() => { const dropped=rolls.find(r=>r!==m.hitD20)??rolls[1];
            return `d20[<strong>${m.hitD20}</strong>&thinsp;<span style="text-decoration:line-through;color:var(--text-dim)">${dropped}</span>]`; })()
        : `d20[${m.hitD20}]`;
      const extraHitDisp = m.extraHitRolls?.length
        ? ' ' + m.extraHitRolls.map(r=>`+d20[${r}]`).join(' ') : '';
      const hitFormula = (m.hitToucherStatLabel != null
        ? [diceDisp,
           m.hitToucherMod ? sn(m.hitToucherMod)+sub(m.hitToucherStatLabel) : '',
           m.hitToucherSetBonus > 0 ? `+${m.hitToucherSetBonus}`+sub('Set') : '',
           m.hitBonus ? sn(m.hitBonus)+sub('bonus') : '',
          ].filter(Boolean).join(' ')
        : `${diceDisp} ${sn(m.hitBase)}${m.hitBonus?' '+sn(m.hitBonus)+sub('bonus'):''}`)
        + extraHitDisp;
      // Formule dégâts commune
      const baseDice = _esc(m.dmgEffectiveDice || m.dmgRawDice || m.dmgFormula || '');
      const dmgMods  = [
        m.dmgStatMod ? sn(m.dmgStatMod)+sub(m.dmgStatLabel||'') : '',
        m.dmgMaitriseBonus > 0 ? `+${m.dmgMaitriseBonus}`+sub('Maîtrise') : '',
        m.dmgBonus ? sn(m.dmgBonus)+sub('bonus') : '',
        m.dmgBonusDice ? sn(m.dmgBonusDice)+sub('dés') : '',
      ].filter(Boolean).join(' ');
      const dmgFormStr = isCrit && m.critNormalMax
        ? `max(${m.critNormalMax}) + ${baseDice}(${m.dmgRaw}) ${dmgMods}`
        : `${baseDice}(${m.dmgRaw}) ${dmgMods}`;
      const atkWho = m.attackerName || m.authorName || '?';
      const detailId = `vtt-d-${i}`;
      // Grille des cibles
      const targetsHtml = (m.targets || []).map(r => {
        const inter   = r.interaction && DMG_INTERACTIONS[r.interaction];
        const baseCol = r.hit ? '#22c38e' : r.halfDmg ? '#b47fff' : '#6b7280';
        // Valeur dégâts : rouge standard ; vert si soin (absorption) ; violet si demi-dégâts.
        const dmgCol  = r.interaction === 'Absorption' ? '#22c38e'
                      : r.halfDmg                      ? '#b47fff'
                                                        : '#ef4444';
        const hitIcon = r.hit ? '✓' : r.halfDmg ? '✦' : '✗';
        const finalSign = r.dmgTotal < 0 ? `+${-r.dmgTotal}` : r.dmgTotal;
        const preSign   = r.dmgPre != null && r.dmgPre !== r.dmgTotal ? (r.dmgPre < 0 ? `+${-r.dmgPre}` : r.dmgPre) : null;
        const preBlock  = preSign != null
          ? `<span style="font-size:.65rem;color:var(--text-muted,var(--text-dim))">${preSign}</span><span style="font-size:.6rem;color:${dmgCol};margin:0 2px">→</span>`
          : '';
        const dmgStr = (r.hit || r.halfDmg)
          ? `${preBlock}<strong style="color:${dmgCol}">${finalSign}</strong>${r.halfDmg?' <span style="font-size:.6rem;color:#b47fff">½</span>':''}${r.newHp===0?' 💀':''}`
          : '';
        const interBadge = inter
          ? `<span title="${_esc(r.interaction)}" style="display:inline-flex;align-items:center;font-size:.58rem;color:${inter.color};background:${inter.color}1a;border:1px solid ${inter.color}55;padding:0 4px;border-radius:5px;gap:2px;font-weight:600">${inter.icon}<span>${inter.short}</span></span>`
          : '';
        const setLBadge = r.dmgReduction > 0
          ? `<span title="Set Lourd −${r.dmgReduction}" style="display:inline-flex;align-items:center;font-size:.58rem;color:#60a5fa;background:#60a5fa1a;border:1px solid #60a5fa55;padding:0 4px;border-radius:5px;gap:2px;font-weight:600">🛡<span>−${r.dmgReduction}</span></span>`
          : '';
        return `<div style="display:flex;align-items:center;gap:.3rem;padding:.1rem 0">
          <span style="font-size:.72rem;color:${baseCol};font-weight:700;width:.85rem;text-align:center">${hitIcon}</span>
          <span style="font-size:.72rem;flex:1;color:var(--text-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(r.name)}</span>
          ${interBadge}${setLBadge}
          <span style="font-size:.62rem;color:var(--text-dim)">CA${r.targetCA}</span>
          ${dmgStr ? `<span style="font-size:.75rem;display:inline-flex;align-items:center;gap:1px">${dmgStr}</span>` : ''}
        </div>`;
      }).join('');
      return `<div class="vtt-log-entry vtt-log-roll"
          style="border-left:3px solid ${borderCol};padding:.3rem .3rem .3rem .5rem;background:rgba(${bgRgb},.05);border-radius:0 6px 6px 0">
        <div style="display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;margin-bottom:.2rem">
          ${_portrait(m.characterImage, atkWho, borderCol)}
          <span style="font-weight:700;font-size:.78rem;color:var(--text)">${_esc(atkWho)}</span>
          <span style="color:var(--text-dim);font-size:.72rem">✨</span>
          <strong style="font-size:.82rem">${_esc(m.optLabel||'')}</strong>
          <span style="font-size:.65rem;color:#b47fff">🎯 ${(m.targets||[]).length} cibles</span>
          ${_right(resultBadge, ts)}
        </div>
        <div style="display:flex;align-items:center;gap:.3rem;flex-wrap:wrap;padding-left:calc(22px + .35rem)">
          <span style="font-size:.72rem">🎯</span>
          <strong style="font-size:1rem;color:${accentCol}">${m.hitTotal}</strong>
          ${advBadge}
          <button class="vtt-log-detail-btn" onclick="(e=>{const d=document.getElementById('${detailId}');const o=d.style.display!=='none';d.style.display=o?'none':'block';e.currentTarget.classList.toggle('open',!o)})(event)">détail</button>
        </div>
        <div style="padding-left:calc(22px + .35rem);margin-top:.25rem;border-top:1px solid rgba(255,255,255,.06);padding-top:.2rem">
          ${targetsHtml}
        </div>
        <div id="${detailId}" style="display:none;padding-left:calc(22px + .35rem);margin-top:.2rem;border-top:1px solid rgba(255,255,255,.06);padding-top:.2rem">
          <div style="font-size:.65rem;color:var(--text-dim)">🎯 ${hitFormula} = <strong style="color:${accentCol}">${m.hitTotal}</strong></div>
          <div style="font-size:.65rem;color:var(--text-dim);margin-top:.1rem">⚔️ ${dmgFormStr}</div>
        </div>
      </div>`;
    }
    if (m.type==='attack') {
      const sn  = n => n>0?`+${n}`:n<0?`${n}`:'';
      const sub = t => `<span style="font-size:.6rem;color:var(--text-dim)">(${t})</span>`;

      // Couleurs selon résultat
      const isCrit   = m.isCrit;
      const isFumble = m.isFumble;
      const isHalf   = m.halfDmg;
      const borderCol = isCrit   ? '#f59e0b'
                      : isFumble ? '#7f1d1d'
                      : isHalf   ? '#b47fff'
                      : m.hit    ? '#22c38e' : '#6b7280';
      const bgRgb     = isCrit   ? '245,158,11'
                      : isFumble ? '127,29,29'
                      : isHalf   ? '180,127,255'
                      : m.hit    ? '34,195,142' : '107,114,128';
      const accentCol = isCrit   ? '#f59e0b'
                      : m.hit    ? '#22c38e' : '#ef4444';

      const resultBadge = isCrit
        ? `<span style="font-size:.68rem;font-weight:700;color:#f59e0b">💥 CRITIQUE</span>`
        : isFumble
        ? `<span style="font-size:.68rem;font-weight:700;color:#ef4444">💀 FUMBLE</span>`
        : '';

      const rolls    = Array.isArray(m.hitD20rolls) && m.hitD20rolls.length > 1 ? m.hitD20rolls : null;
      const advBadge = m.advMode==='adv'
        ? `<span style="font-size:.62rem;font-weight:700;color:#22c38e" title="Avantage">⬆</span>`
        : m.advMode==='dis'
        ? `<span style="font-size:.62rem;font-weight:700;color:#ef4444" title="Désavantage">⬇</span>` : '';
      // Détail : dé gardé en gras, dé rejeté barré
      const diceDisp = rolls
        ? (() => { const dropped=rolls.find(r=>r!==m.hitD20)??rolls[1];
            return `d20[<strong>${m.hitD20}</strong>&thinsp;<span style="text-decoration:line-through;color:var(--text-dim)">${dropped}</span>]`; })()
        : `d20[${m.hitD20}]`;
      const extraHitDisp = m.extraHitRolls?.length
        ? ' ' + m.extraHitRolls.map(r=>`+d20[${r}]`).join(' ') : '';
      const hitFormula = (m.hitToucherStatLabel != null
        ? [
            diceDisp,
            m.hitToucherMod       ? sn(m.hitToucherMod)    + sub(m.hitToucherStatLabel) : '',
            m.hitToucherSetBonus > 0 ? `+${m.hitToucherSetBonus}` + sub('Set') : '',
            m.hitBonus            ? sn(m.hitBonus) + sub('bonus') : '',
          ].filter(Boolean).join(' ')
        : `${diceDisp} ${sn(m.hitBase)}${m.hitBonus?' '+sn(m.hitBonus)+sub('bonus'):''}`)
        + extraHitDisp;

      const detailId = `vtt-d-${i}`;

      // Ligne dégâts résumée + détail formule
      let dmgSummary = '', dmgDetailHtml = '';
      if (m.hit || m.halfDmg) {
        const baseDice = _esc(m.dmgEffectiveDice || m.dmgRawDice || m.dmgFormula || '');
        const mods = [
          m.dmgStatMod       ? sn(m.dmgStatMod)       + sub(m.dmgStatLabel||'') : '',
          m.dmgMaitriseBonus > 0 ? `+${m.dmgMaitriseBonus}` + sub('Maîtrise') : '',
          m.dmgBonus         ? sn(m.dmgBonus)          + sub('bonus') : '',
          m.dmgBonusDice     ? sn(m.dmgBonusDice)      + sub('dés') : '',
        ].filter(Boolean).join(' ');

        // Formule brute (sans aucune réduction). Le ÷2 et la résistance/etc. sont
        // affichés sur des lignes séparées, plus lisibles.
        const dmgFormulaRaw = (isCrit && m.critNormalMax)
          ? `max<span style="font-size:.6rem;color:var(--text-dim)">(${m.critNormalMax})</span> + ${baseDice}(${m.dmgRaw}) ${mods}`
          : `${baseDice}(${m.dmgRaw}) ${mods}`;

        const interMeta = m.interaction && DMG_INTERACTIONS[m.interaction];
        // Couleur dégâts : standard rouge ; vert seulement quand l'absorption transforme en soin ;
        // violet quand demi-dégâts (échec garanti d'arme/sort magique).
        const dmgColor  = m.interaction === 'Absorption' ? '#22c38e'
                        : m.halfDmg                      ? '#b47fff'
                                                          : '#ef4444';
        const dmgSign   = m.dmgTotal < 0 ? `+${-m.dmgTotal}` : m.dmgTotal;
        const preSign   = m.dmgPre != null && m.dmgPre !== m.dmgTotal ? (m.dmgPre < 0 ? `+${-m.dmgPre}` : m.dmgPre) : null;
        const headIcon  = m.interaction === 'Absorption' ? '💚'
                        : m.interaction === 'Immunité'   ? '🚫'
                                                          : '⚔️';
        const dmgSuffix = m.interaction === 'Absorption' ? 'PV soignés'
                        : m.interaction === 'Immunité'   ? 'aucun dégât'
                        : m.newHp === 0                  ? '💀'
                        : m.halfDmg                      ? '✦ ½'
                                                          : 'dégâts';
        const interTag = interMeta
          ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:.66rem;color:${interMeta.color};background:${interMeta.color}1a;border:1px solid ${interMeta.color}55;padding:1px 6px;border-radius:999px;font-weight:600">${interMeta.icon} ${_esc(m.interaction)} ${interMeta.short}</span>`
          : '';
        // Sommaire compact : "(pre →) final dégâts" + badge.
        const preBlock = preSign != null
          ? `<span style="font-size:.82rem;color:var(--text-muted,var(--text-dim));font-weight:500">${preSign}</span><span style="font-size:.78rem;color:${dmgColor};margin:0 .12rem">→</span>`
          : '';
        dmgSummary = `<div style="display:flex;align-items:center;gap:.3rem;flex-wrap:wrap;padding-left:calc(22px + .35rem);margin-top:.15rem">
          <span style="font-size:.78rem">${headIcon}</span>
          ${preBlock}
          <strong style="font-size:1.05rem;color:${dmgColor};letter-spacing:-.01em">${dmgSign}</strong>
          <span style="font-size:.72rem;color:${dmgColor}">${dmgSuffix}</span>
          ${interTag}
        </div>`;

        // ── Détail : chaîne d'opérations simple, une étape par ligne ──────
        // Calcule le total brut (avant échec ½ ET avant interaction) :
        // logs récents = champ `dmgFull` direct ; logs anciens = recomposé.
        const isCritLog = isCrit || (m.critNormalMax > 0);
        const fullValComputed = isCritLog
          ? (m.critNormalMax || 0) + (m.dmgRaw || 0) + (m.critFixed2 || 0)
          : (m.dmgRaw || 0) + (m.dmgStatMod || 0) + (m.dmgMaitriseBonus || 0) + (m.dmgBonus || 0);
        const fullVal = m.dmgFull ?? Math.max(1, fullValComputed);
        const halfVal = m.halfDmg ? Math.max(1, Math.floor(fullVal / 2)) : null;
        const interInVal = halfVal ?? fullVal;
        const fmtN = v => v < 0 ? `+${-v}` : `${v}`;

        // ── Détail : "reçu" du calcul, lecture verticale top-down ─────────
        // Une ligne par étape, libellé + opérateur à gauche, résultat aligné à droite.
        // La dernière ligne (valeur finale) est surlignée dans la couleur de l'effet.
        const rows = [];
        const totalRows = 1
          + (halfVal != null && halfVal !== fullVal ? 1 : 0)
          + (interMeta && m.dmgTotal !== interInVal ? 1 : 0)
          + (m.dmgReduction > 0 ? 1 : 0);

        const row = ({ label, op, val, color, isFinal }) => `
          <div style="display:grid;grid-template-columns:1fr auto;align-items:baseline;column-gap:.6rem;
            padding:${isFinal ? '.2rem .5rem' : '.1rem .5rem'};
            ${isFinal ? `background:${color}14;border-radius:6px` : ''}">
            <div style="display:flex;align-items:baseline;gap:.4rem;min-width:0">
              <span style="color:${color || 'var(--text-dim)'};font-weight:${isFinal||!color?'700':'600'};font-size:.66rem;flex-shrink:0">${op}</span>
              <span style="color:var(--text-soft,var(--text));font-size:.68rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}</span>
            </div>
            <strong style="color:${color || '#ef4444'};font-size:${isFinal?'1rem':'.82rem'};font-variant-numeric:tabular-nums;min-width:1.6rem;text-align:right;line-height:1">${val}</strong>
          </div>
        `;

        // Ligne 1 — Brut (formule complète + total)
        rows.push(row({
          label: dmgFormulaRaw,
          op:    '🎲',
          val:   fullVal,
          color: totalRows === 1 ? '#ef4444' : null,
          isFinal: totalRows === 1,
        }));

        // Ligne 2 — Échec ½ (si applicable)
        if (halfVal != null && halfVal !== fullVal) {
          const isFinal = !(interMeta && m.dmgTotal !== interInVal) && !(m.dmgReduction > 0);
          rows.push(row({
            label: 'Échec ½ (arme magique)',
            op:    '✦',
            val:   halfVal,
            color: '#b47fff',
            isFinal,
          }));
        }

        // Ligne 3 — Interaction du profil de la créature (si applicable)
        if (interMeta && m.dmgTotal !== interInVal) {
          const factorLabel = m.interaction === 'Résistance' ? '½ Résistance'
                            : m.interaction === 'Faiblesse'  ? '×2 Faiblesse'
                            : m.interaction === 'Immunité'   ? 'Immunité'
                            : m.interaction === 'Absorption' ? 'Absorption (soin)'
                                                                : m.interaction;
          rows.push(row({
            label: factorLabel,
            op:    interMeta.icon,
            val:   fmtN(m.dmgTotal),
            color: dmgColor,
            isFinal: !(m.dmgReduction > 0),
          }));
        }

        // Ligne 4 — Set Lourd : réduction dégâts (si applicable)
        if (m.dmgReduction > 0) {
          rows.push(row({
            label: `Set Lourd −${m.dmgReduction} (min. 1)`,
            op:    '🛡',
            val:   fmtN(m.dmgTotal),
            color: '#60a5fa',
            isFinal: true,
          }));
        }

        dmgDetailHtml = `<div style="margin-top:.25rem;display:flex;flex-direction:column;gap:.05rem">
          ${rows.join('')}
        </div>`;
      }

      const atkWho = m.attackerName || m.authorName || '?';
      return `<div class="vtt-log-entry vtt-log-roll"
          style="border-left:3px solid ${borderCol};padding:.3rem .3rem .3rem .5rem;background:rgba(${bgRgb},.05);border-radius:0 6px 6px 0">
        <div style="display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;margin-bottom:.2rem">
          ${_portrait(m.characterImage, atkWho, borderCol)}
          <span style="font-weight:700;font-size:.78rem;color:var(--text)">${_esc(atkWho)}</span>
          <span style="color:var(--text-dim);font-size:.72rem">→</span>
          <strong style="font-size:.82rem">${_esc(m.defenderName||'')}</strong>
          <span style="color:var(--text-dim);font-size:.65rem">· ${_esc(m.optLabel||'')}</span>
          ${_right(resultBadge, ts)}
        </div>
        <div style="display:flex;align-items:center;gap:.3rem;flex-wrap:wrap;padding-left:calc(22px + .35rem)">
          <span style="font-size:.78rem">🎯</span>
          <strong style="font-size:1.05rem;color:${accentCol};letter-spacing:-.01em">${m.hitTotal}</strong>
          <span style="font-size:.88rem;color:${accentCol};font-weight:700">${m.hit?'✓':'✗'}</span>
          ${advBadge}
          <button class="vtt-log-detail-btn" onclick="(e=>{const d=document.getElementById('${detailId}');const o=d.style.display!=='none';d.style.display=o?'none':'block';e.currentTarget.classList.toggle('open',!o)})(event)">détail</button>
        </div>
        ${dmgSummary}
        <div id="${detailId}" style="display:none;padding-left:calc(22px + .35rem);margin-top:.2rem;border-top:1px solid rgba(255,255,255,.06);padding-top:.2rem">
          <div style="font-size:.65rem;color:var(--text-dim)">🎯 ${hitFormula} = <strong style="color:${accentCol}">${m.hitTotal}</strong></div>
          ${dmgDetailHtml}
        </div>
      </div>`;
    }
    if (m.type==='dice-free') {
      const totalCol = m.total>=20?'#22c38e':m.total<=3?'#ef4444':'var(--text)';
      const modeLabel = m.mode==='advantage'
        ? `<span style="font-size:.6rem;font-weight:700;color:#22c38e">⬆ Avantage</span>`
        : m.mode==='disadvantage'
        ? `<span style="font-size:.6rem;font-weight:700;color:#ef4444">⬇ Désav.</span>` : '';
      const detail = (m.groups||[]).map(g => {
        if (g.kept!=null) {
          const dropped = g.rolls.find(r=>r!==g.kept)??g.rolls[1];
          return `d${g.faces}[<strong>${g.kept}</strong>&thinsp;<span style="color:var(--text-dim);text-decoration:line-through">${dropped}</span>]`;
        }
        return `${g.count}d${g.faces}[${g.rolls.join(', ')}]`;
      });
      if (m.bonus) detail.push(m.bonus>0
        ?`<span style="color:var(--gold)">+${m.bonus}</span>`
        :`<span style="color:#ef4444">${m.bonus}</span>`);
      return `<div class="vtt-log-entry vtt-log-roll" style="border-left:3px solid var(--gold);padding:.3rem .3rem .3rem .5rem;background:rgba(255,210,0,.04);border-radius:0 6px 6px 0">
        <div style="display:flex;align-items:center;gap:.35rem;margin-bottom:.1rem">
          ${who} <span style="font-size:.65rem;color:var(--text-dim)">🎲</span>
          <code style="font-size:.68rem;background:rgba(255,255,255,.07);padding:0 .3rem;border-radius:4px">${_esc(m.formula||'')}</code>
          ${modeLabel} ${_right('',ts)}
        </div>
        <div style="display:flex;align-items:baseline;gap:.3rem;flex-wrap:wrap;padding-left:calc(22px + .35rem)">
          <span style="font-size:.68rem;color:var(--text-dim)">${detail.join(' · ')}</span>
          <span style="font-size:.7rem;color:var(--text-dim)">=</span>
          <strong style="font-size:1.1rem;color:${totalCol}">${m.total}</strong>
        </div>
      </div>`;
    }
    if (m.type==='roll') {
      const rollWho  = m.characterName || m.authorName || '?';
      const statCol  = _STAT_COLOR[m.rollStat] || 'var(--gold)';
      const statRgb  = _STAT_RGB[m.rollStat]   || '255,210,0';
      const resultCol = m.isCrit ? '#ffd700' : m.isFumble ? '#ef4444' : 'var(--text)';
      const modStr   = m.rollMod > 0 ? `+${m.rollMod}` : m.rollMod < 0 ? `${m.rollMod}` : '';
      const bonusStr = m.rollBonus > 0 ? `+${m.rollBonus}` : m.rollBonus < 0 ? `${m.rollBonus}` : '';
      const badge = m.isCrit
        ? `<span style="font-size:.65rem;font-weight:700;color:#ffd700">✨ CRITIQUE</span>`
        : m.isFumble
        ? `<span style="font-size:.65rem;font-weight:700;color:#ef4444">💀 FUMBLE</span>`
        : '';
      const modeIcon = m.rollMode==='advantage'
        ? `<span style="font-size:.6rem;font-weight:700;color:#22c38e">⬆ Avantage</span>`
        : m.rollMode==='disadvantage'
        ? `<span style="font-size:.6rem;font-weight:700;color:#ef4444">⬇ Désav.</span>`
        : '';
      const diceStr = m.rollDice?.length === 2
        ? (() => {
            const [a, b] = m.rollDice;
            const kept = m.rollRaw, dropped = a === kept ? b : a;
            return `[<strong>${kept}</strong>,<span style="color:var(--text-dim);text-decoration:line-through">${dropped}</span>]`;
          })()
        : `[${m.rollRaw}]`;
      if (m.rollSkill) {
        return `<div class="vtt-log-entry vtt-log-roll" style="border-left:3px solid ${statCol};background:rgba(${statRgb},.06);border-radius:0 6px 6px 0;padding:.3rem .3rem .3rem .5rem">
          <div style="display:flex;align-items:center;gap:.35rem;margin-bottom:.2rem">
            ${_portrait(m.characterImage, rollWho, statCol)}
            <span style="font-weight:700;font-size:.78rem;color:var(--text)">${_esc(rollWho)}</span>
            <span style="font-size:.65rem;color:var(--text-dim)">🎲</span>
            <span style="font-size:.72rem;font-weight:600;color:${statCol}">${_esc(m.rollSkill)}</span>
            <span style="font-size:.6rem;color:var(--text-dim)">${m.rollStat||''}</span>
            ${modeIcon}
            ${_right(badge, ts)}
          </div>
          <div style="display:flex;align-items:baseline;gap:.3rem;flex-wrap:wrap;padding-left:calc(22px + .35rem)">
            <span style="font-size:.7rem;color:var(--text-dim)">${diceStr}</span>
            ${modStr ? `<span style="font-size:.7rem;color:${statCol}">${modStr}</span>` : ''}
            ${bonusStr ? `<span style="font-size:.7rem;color:var(--gold)" title="bonus contextuel">${bonusStr}</span>` : ''}
            <span style="font-size:.72rem;color:var(--text-dim)">=</span>
            <strong style="font-size:1.05rem;color:${resultCol}">${m.rollResult}</strong>
          </div>
        </div>`;
      }
      // Jet libre (sans token)
      return `<div class="vtt-log-entry vtt-log-roll" style="border-left:3px solid var(--gold);padding:.3rem .3rem .3rem .5rem;background:rgba(255,210,0,.04);border-radius:0 6px 6px 0">
        <div style="display:flex;align-items:center;gap:.35rem">
          ${who} <span style="font-size:.65rem;color:var(--text-dim)">🎲</span>
          <em style="font-size:.68rem;color:var(--text-dim)">${_esc(m.rollFormula||'')}</em>
          ${modeIcon}
          <span style="font-size:.72rem;color:var(--text-dim)">→</span>
          <strong style="color:${resultCol}">${m.rollResult}</strong>
          ${_right(badge, ts)}
        </div>
      </div>`;
    }
    // Message chat simple
    return `<div class="vtt-log-entry vtt-log-msg" style="display:flex;align-items:baseline;gap:.25rem">
      ${who}<span style="flex:1">${_applyEmotes(_esc(m.text||''))}</span>${ts}
    </div>`;
  }).join('');
  el.scrollTop=el.scrollHeight;
}

window._vttSendChat = async () => {
  const input=document.getElementById('vtt-chat-input');
  const text=input?.value.trim(); if (!text) return;
  input.value='';
  const authorName=STATE.profile?.pseudo||STATE.profile?.prenom||STATE.user?.displayName||'Joueur';
  try {
    await addDoc(_logCol(),{
      type:'chat', authorId:STATE.user?.uid||null, authorName, text, createdAt:serverTimestamp(),
    });
  } catch(e) {
    if (input) input.value=text; // restaurer le texte si échec
    console.error('[vtt] chat send:', e);
    const reason=e.code==='permission-denied'
      ? 'Règles Firestore : ajouter vttLog (voir docs/firestore-rules.md)'
      : e.message;
    showNotif(`Erreur chat : ${reason}`,'error');
  }
};

// ═══════════════════════════════════════════════════════════════════
// ACTIONS GLOBALES
// ═══════════════════════════════════════════════════════════════════
window._vttTool       = t => _setTool(_tool === t ? 'select' : t);
// ── Courir : double le mouvement de base pour ce tour ───────────────
window._vttCourir = async id => {
  const tok = _tokens[id]?.data;
  if (!tok || !_session?.combat?.active) return;
  if (tok.bonusMvt > 0) { showNotif('Course déjà utilisée ce tour', 'error'); return; }
  const bonus = _live(tok).displayMovement ?? 6;
  await updateDoc(_tokRef(id), { bonusMvt: bonus }).catch(() => showNotif('Erreur', 'error'));
  showNotif(`🏃 Course ! +${bonus} cases de mouvement`, 'success');
};

// ── Déplacement clavier (flèches + pavé numérique) ──────────────────
async function _moveSelectedBy(dc, dr) {
  if (!_selected || !_activePage || _tool !== 'select') return;
  const tok = _tokens[_selected]?.data;
  if (!tok || tok.pageId !== _activePage.id) return;
  const ld  = _live(tok);
  const sw  = ld.displayTokenW || 1, sh = ld.displayTokenH || 1;
  const nc  = Math.max(0, Math.min(_activePage.cols - sw, tok.col + dc));
  const nr  = Math.max(0, Math.min(_activePage.rows - sh, tok.row + dr));
  if (nc === tok.col && nr === tok.row) return;
  await _moveTo(_selected, nc, nr);
  fogUpdateSoon(_activePage, _tokens, STATE.isAdmin);
}

window._vttFogTool    = t => fogSetEditTool(t, _activePage);
window._vttToggleFog  = async () => {
  if (!_activePage) return;
  const next = !_activePage.fogEnabled;
  await updateDoc(_pgRef(_activePage.id), { fogEnabled: next }).catch(() => showNotif('Erreur fog','error'));
};
window._vttSwitchPage = id => _switchPage(id);

// ── Outils de dessin ────────────────────────────────────────────────
window._vttDrawShape = shape => {
  _drawShape = shape;
  ['pencil','line','rect','circle'].forEach(s => {
    document.getElementById(`vtt-ds-${s}`)?.classList.toggle('active', s === shape);
  });
};
window._vttDrawColor = color => {
  _drawColor = color;
  document.querySelectorAll('.vtt-draw-color').forEach(b => b.classList.toggle('active', b.dataset.color === color));
};
window._vttDrawWidth = w => {
  _drawWidth = w;
  document.querySelectorAll('.vtt-draw-wbtn').forEach(b => b.classList.toggle('active', +b.dataset.w === w));
};
window._vttToggleDrawFill = () => {
  _drawFill = !_drawFill;
  const btn = document.getElementById('vtt-draw-fill-btn');
  if (btn) { btn.textContent = _drawFill ? '◼' : '◻'; btn.classList.toggle('active', _drawFill); }
};
window._vttClearAnnots = async () => {
  if (!_activePage) return;
  if (!await confirmModal('Effacer toutes les annotations de cette page ?')) return;
  const toDelete = Object.values(_annotations).filter(e => e.data.pageId === _activePage.id);
  await Promise.all(toDelete.map(e => deleteDoc(_annotRef(e.data.id)).catch(()=>{})));
};

window._vttAddPage = () => {
  openModal('➕ Nouvelle page', `
    <div class="vtt-form">
      <div class="form-group"><label>Nom</label>
        <input id="vpf-name" type="text" placeholder="ex : Forêt Sombre" autofocus></div>
      <div class="vtt-form-row">
        <div class="form-group"><label>Colonnes (largeur)</label>
          <input id="vpf-cols" type="number" value="24" min="8" max="200"></div>
        <div class="form-group"><label>Lignes (hauteur)</label>
          <input id="vpf-rows" type="number" value="18" min="8" max="200"></div>
      </div>
      <small style="color:var(--text-dim);font-size:.72rem">1 case = ${CELL}px · ex : 30×22 pour une grande carte</small>
      <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">
        <button class="btn-secondary" data-action="close-modal">Annuler</button>
        <button class="btn-primary" onclick="window._vttConfirmAddPage()">Créer</button>
      </div>
    </div>`);
};
window._vttConfirmAddPage = async () => {
  const name=(document.getElementById('vpf-name')?.value||'').trim();
  const cols=Math.max(8,Math.min(200,parseInt(document.getElementById('vpf-cols')?.value)||24));
  const rows=Math.max(8,Math.min(200,parseInt(document.getElementById('vpf-rows')?.value)||18));
  if (!name) { showNotif('Nom requis','error'); return; }
  closeModalDirect();
  await addDoc(_pgsCol(),{name,cols,rows,backgroundImages:[],order:Object.keys(_pages).length,createdAt:serverTimestamp()})
    .catch(()=>showNotif('Erreur création page','error'));
};

window._vttEditPage = id => {
  const p=_pages[id]; if (!p) return;
  openModal('✏️ Modifier la page', `
    <div class="vtt-form">
      <div class="form-group"><label>Nom</label>
        <input id="vpe-name" type="text" value="${p.name}" autofocus></div>
      <div class="vtt-form-row">
        <div class="form-group"><label>Colonnes</label>
          <input id="vpe-cols" type="number" value="${p.cols||24}" min="8" max="200"></div>
        <div class="form-group"><label>Lignes</label>
          <input id="vpe-rows" type="number" value="${p.rows||18}" min="8" max="200"></div>
      </div>
      <div class="form-group" style="margin-top:.5rem">
        <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer">
          <input type="checkbox" id="vpe-fog" ${p.fogEnabled?'checked':''}>
          <span>👁 Éclairage dynamique (brouillard de guerre)</span>
        </label>
      </div>
      <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">
        <button class="btn-secondary" data-action="close-modal">Annuler</button>
        <button class="btn-primary" onclick="window._vttConfirmEditPage('${id}')">Enregistrer</button>
      </div>
    </div>`);
};
window._vttConfirmEditPage = async id => {
  const name=(document.getElementById('vpe-name')?.value||'').trim();
  const cols=Math.max(8,Math.min(200,parseInt(document.getElementById('vpe-cols')?.value)||24));
  const rows=Math.max(8,Math.min(200,parseInt(document.getElementById('vpe-rows')?.value)||18));
  if (!name) { showNotif('Nom requis','error'); return; }
  const fogEnabled = document.getElementById('vpe-fog')?.checked ?? false;
  closeModalDirect();
  await updateDoc(_pgRef(id),{name,cols,rows,fogEnabled}).catch(()=>showNotif('Erreur','error'));
  if (_activePage?.id===id) { _activePage={..._activePage,name,cols,rows,fogEnabled}; _drawGrid(); }
};

window._vttDeletePage = async id => {
  if (!await confirmModal('Supprimer cette page ?',{title:'Supprimer ?',danger:true})) return;
  await deleteDoc(_pgRef(id)).catch(()=>{});
};

// Envoyer tous les joueurs vers une page spécifique (depuis la liste)
window._vttSendToPage = async pageId => {
  const p=_pages[pageId]; if (!p) return;
  await setDoc(_sesRef(),{activePageId:pageId},{merge:true}).catch(()=>{});
  showNotif(`📡 Tous les joueurs → « ${p.name} »`,'success');
};

// Placer un token sur la page active (depuis le tray)
window._vttPlace = async tokenId => {
  if (!_activePage) { showNotif('Crée d\'abord une page','error'); return; }
  const cC=Math.floor(_activePage.cols/2), cR=Math.floor(_activePage.rows/2);
  await updateDoc(_tokRef(tokenId),{pageId:_activePage.id,col:cC,row:cR,visible:true})
    .catch(()=>showNotif('Erreur placement','error'));
};
// Dupliquer un perso/PNJ déjà placé sur une autre page → nouveau token sur la page active.
// Le HP/PM/stats sont partagés via la fiche perso ; les buffs et état de tour restent par-instance.
window._vttDuplicateOnPage = async srcTokenId => {
  if (!STATE.isAdmin) return;
  if (!_activePage) { showNotif('Crée d\'abord une page','error'); return; }
  const src = _tokens[srcTokenId]?.data;
  if (!src) { showNotif('Token introuvable','error'); return; }
  if (src.type === 'enemy') { window._vttDuplicateToken?.(srcTokenId); return; }
  const cC = Math.floor(_activePage.cols/2), cR = Math.floor(_activePage.rows/2);
  try {
    await addDoc(_toksCol(), {
      name: src.name || 'Token',
      type: src.type,
      characterId: src.characterId || null,
      npcId:       src.npcId       || null,
      beastId:     src.beastId     || null,
      ownerId:     src.ownerId     || null,
      pageId: _activePage.id, col: cC, row: cR,
      visible: true,
      imageUrl: src.imageUrl || null,
      movement: src.movement ?? null, range: src.range ?? 1,
      attack: src.attack ?? null, attackDice: src.attackDice || null,
      defense: src.defense ?? null,
      hp: src.hp ?? null, hpMax: src.hpMax ?? null,
      tokenW: src.tokenW ?? null, tokenH: src.tokenH ?? null,
      buffs: [],
      movedThisTurn: false, attackedThisTurn: false, movedCells: 0, bonusMvt: 0,
      createdAt: serverTimestamp(),
    });
    showNotif('+ Placé sur cette page','success');
  } catch (e) {
    console.error('[vtt] duplicate-on-page:', e);
    showNotif('Erreur duplication','error');
  }
};
// Retirer un token de la carte.
// Si plusieurs tokens partagent la même entité (perso/PNJ dupliqué), on supprime celui-ci ;
// sinon on le renvoie en réserve.
window._vttRetireToken = async tokenId => {
  const t = _tokens[tokenId]?.data; if (!t) return;
  const key = t.characterId || t.npcId; // les ennemis (beastId) sont gérés par _vttDeleteToken
  let isDuplicate = false;
  if (key) {
    let count = 0;
    for (const e of Object.values(_tokens)) {
      const d = e.data;
      if ((d.characterId && d.characterId === t.characterId) ||
          (d.npcId && d.npcId === t.npcId)) count++;
      if (count > 1) { isDuplicate = true; break; }
    }
  }
  if (isDuplicate) {
    await deleteDoc(_tokRef(tokenId)).catch(()=>{});
  } else {
    await updateDoc(_tokRef(tokenId),{pageId:null,visible:false}).catch(()=>{});
  }
  if (_selected===tokenId) _deselect();
};
// Le joueur invoque son propre token sur la carte active
window._vttInvokeMyToken = async () => {
  if (!_activePage) { showNotif('Aucune carte active','error'); return; }
  const uid = STATE.user?.uid; if (!uid) return;
  const tok = Object.values(_tokens).find(e => e.data?.ownerId === uid)?.data;
  if (!tok) { showNotif('Aucun token associé à ton personnage','error'); return; }
  const cC = Math.floor(_activePage.cols/2), cR = Math.floor(_activePage.rows/2);
  await updateDoc(_tokRef(tok.id),{pageId:_activePage.id,col:cC,row:cR,visible:true})
    .catch(err => { console.error('[vtt] invocation:', err); showNotif('Erreur invocation','error'); });
};
// Déplacer le token vers une autre page
window._vttMoveTokenToPage = async (tokenId,pageId) => {
  if (!pageId) return;
  await updateDoc(_tokRef(tokenId),{pageId}).catch(()=>{});
};
// Sélectionner depuis le tray (place si non placé)
window._vttSelectFromTray = id => {
  const t=_tokens[id]?.data; if (!t) return;
  if (!t.pageId&&STATE.isAdmin) { window._vttPlace(id); return; }
  if (t.pageId===_activePage?.id) _select(id);
};
window._vttToggleVisible = async id => {
  const t=_tokens[id]?.data; if (!t) return;
  await updateDoc(_tokRef(id),{visible:!t.visible}).catch(()=>{});
};
window._vttClearBuffs = async id => {
  if (!STATE.isAdmin) return;
  const t=_tokens[id]?.data; if (!t) return;
  await updateDoc(_tokRef(id),{buffs:[]}).catch(()=>{});
  showNotif('Buffs supprimés.','success');
};
/** Déclenche un sort suspendu : marque le sort gratuit puis ouvre le modal d'attaque. */
window._vttTriggerSuspendedSpell = async (tokenId, buffIdx) => {
  const t = _tokens[tokenId]?.data; if (!t?.buffs?.length) return;
  if (!STATE.isAdmin && t.ownerId !== STATE.user?.uid) return;
  // Index visible (parmi les buffs actifs) → index réel dans t.buffs
  const r = _session?.combat?.round ?? 0;
  const activeIdxs = t.buffs.map((bf, i) => ({ bf, i }))
    .filter(({ bf }) => bf?.expiresAtRound == null || r === 0 || r <= bf.expiresAtRound)
    .map(({ i }) => i);
  const realIdx = activeIdxs[buffIdx];
  const buff = t.buffs[realIdx];
  if (!buff || buff.type !== 'suspended_spell') return;
  // Marque le sort comme gratuit pour le prochain cast
  if (buff.sortIdx != null) _freeNextCast.add(`${tokenId}_${buff.sortIdx}`);
  // Retire le buff suspendu
  const remaining = t.buffs.filter((_, i) => i !== realIdx);
  await updateDoc(_tokRef(tokenId), { buffs: remaining }).catch(() => {});
  // Active le flag pour éviter la re-suspension immédiate
  _suspendedTriggerActive = true;
  try {
    await _execAttack(tokenId, buff.tgtId || tokenId);
  } finally {
    // Le flag reste actif jusqu'à la fin du modal — désactivé par sécurité après 30s
    setTimeout(() => { _suspendedTriggerActive = false; }, 30_000);
  }
};

/** Retire un buff à l'index donné (MJ uniquement). */
window._vttRemoveBuff = async (tokenId, idx) => {
  if (!STATE.isAdmin) return;
  const t = _tokens[tokenId]?.data; if (!t || !Array.isArray(t.buffs)) return;
  // Recalcule l'index parmi les buffs actifs (pour matcher l'affichage)
  const r = _session?.combat?.round ?? 0;
  const activeIndexes = t.buffs
    .map((bf, i) => ({ bf, i }))
    .filter(({ bf }) => bf?.expiresAtRound == null || r === 0 || r <= bf.expiresAtRound)
    .map(({ i }) => i);
  const realIdx = activeIndexes[idx];
  if (realIdx == null) return;
  const newBuffs = t.buffs.filter((_, i) => i !== realIdx);
  await updateDoc(_tokRef(tokenId), { buffs: newBuffs }).catch(() => {});
  showNotif('Effet retiré', 'info');
};

/** Ouvre une modale simple pour ajouter manuellement un effet sur le token (MJ). */
window._vttAddBuffPrompt = async (tokenId) => {
  if (!STATE.isAdmin) return;
  const t = _tokens[tokenId]?.data; if (!t) return;
  const TYPES = [
    { v:'ca',          ic:'🛡', lbl:'Bonus CA',         needsBonus:true },
    { v:'dot',         ic:'🩸', lbl:'DoT (dégâts/tour)', needsFormula:true },
    { v:'dmg_bonus',   ic:'⚔️', lbl:'Dégâts bonus arme', needsFormula:true },
    { v:'move_bonus',  ic:'👢', lbl:'Mouvement +',       needsBonus:true },
    { v:'move_debuff', ic:'👢', lbl:'Mouvement −',       needsBonus:true },
    { v:'range_bonus', ic:'🏹', lbl:'Portée +',          needsBonus:true },
    { v:'enchantment', ic:'✨', lbl:'Enchantement (libre)', needsEffect:true },
    { v:'affliction',  ic:'💀', lbl:'Affliction (libre)',   needsEffect:true },
  ];
  const opts = TYPES.map(t => `<option value="${t.v}">${t.ic} ${t.lbl}</option>`).join('');
  openModal(`✨ Ajouter un effet sur ${t.name}`, `
    <div class="vtt-form" style="display:flex;flex-direction:column;gap:.7rem">
      <div class="form-group">
        <label>Type d'effet</label>
        <select id="vab-type" class="input-field">${opts}</select>
      </div>
      <div class="form-group">
        <label>Label / nom du sort</label>
        <input id="vab-label" class="input-field" placeholder="ex : Brûlure (Feu)" value="Effet manuel">
      </div>
      <div class="form-group" id="vab-bonus-row">
        <label>Valeur numérique (positive ou négative)</label>
        <input id="vab-bonus" class="input-field" type="number" value="2">
      </div>
      <div class="form-group" id="vab-formula-row" style="display:none">
        <label>Formule de dés</label>
        <input id="vab-formula" class="input-field" placeholder="ex : 1d4 +2" value="1d4 +2">
      </div>
      <div class="form-group" id="vab-effect-row" style="display:none">
        <label>Effet (texte libre)</label>
        <input id="vab-effect" class="input-field" placeholder="ex : Aveuglé, désavantage attaque…">
      </div>
      <div class="form-group">
        <label>Durée (tours · vide = permanent)</label>
        <input id="vab-dur" class="input-field" type="number" value="2" min="0">
      </div>
      <button class="btn btn-gold" onclick="window._vttConfirmAddBuff('${tokenId}')">Ajouter</button>
    </div>
    <script>
      document.getElementById('vab-type').onchange = e => {
        const meta = ${JSON.stringify(TYPES)}.find(x => x.v === e.target.value);
        document.getElementById('vab-bonus-row').style.display   = meta.needsBonus   ? '' : 'none';
        document.getElementById('vab-formula-row').style.display = meta.needsFormula ? '' : 'none';
        document.getElementById('vab-effect-row').style.display  = meta.needsEffect  ? '' : 'none';
      };
    </script>
  `);
};

window._vttConfirmAddBuff = async (tokenId) => {
  if (!STATE.isAdmin) return;
  const t = _tokens[tokenId]?.data; if (!t) return;
  const type    = document.getElementById('vab-type')?.value || 'ca';
  const label   = document.getElementById('vab-label')?.value?.trim() || 'Effet manuel';
  const bonus   = parseInt(document.getElementById('vab-bonus')?.value) || 0;
  const formula = document.getElementById('vab-formula')?.value?.trim() || '';
  const effect  = document.getElementById('vab-effect')?.value?.trim() || '';
  const durRaw  = document.getElementById('vab-dur')?.value;
  const dur     = durRaw === '' ? null : Math.max(0, parseInt(durRaw) || 0);
  const round = _session?.combat?.round ?? 0;
  const baseRound = Math.max(1, round);
  const ICONS = { ca:'🛡', dot:'🩸', dmg_bonus:'⚔️', move_bonus:'👢', move_debuff:'👢', range_bonus:'🏹', enchantment:'✨', affliction:'💀' };
  const newBuff = {
    type, bonus, formula: formula || undefined, effect: effect || undefined,
    sortLabel: label, icon: ICONS[type] || '✨',
    startRound: round, totalDuration: dur,
    expiresAtRound: dur != null && dur > 0 ? baseRound + dur - 1 : null,
    casterId: null,
  };
  // Slot par défaut pour les types qui en dépendent (dmg_bonus → arme, move_* → pieds)
  if (type === 'dmg_bonus')                       newBuff.slot = 'arme';
  if (type === 'move_bonus' || type === 'move_debuff') newBuff.slot = 'pieds';
  const existing = (t.buffs || []);
  await updateDoc(_tokRef(tokenId), { buffs: [...existing, newBuff] }).catch(() => {});
  closeModalDirect();
  showNotif(`${newBuff.icon} ${label} appliqué`, 'success');
};

window._vttSetHp = async (tokenId,hp) => {
  const t=_tokens[tokenId]?.data; if (!t) return;
  // Détecte une perte de PV pour déclencher un JS de concentration auto
  const lT = _live(t);
  const prevHp = lT.displayHp ?? t.hp ?? null;
  const newHp  = Math.max(0, hp);
  const delta  = prevHp != null ? Math.max(0, prevHp - newHp) : 0;
  await _setHp(t,hp).catch(()=>{});
  if (delta > 0) {
    const notes = await _vttTriggerConcentrationSave(t, delta);
    notes.forEach(msg => showNotif(msg, msg.startsWith('💢') ? 'error' : 'info'));
  }
};
window._vttSetPm = async (tokenId,pm) => {
  const t=_tokens[tokenId]?.data; if (!t) return;
  const v=Math.max(0,pm);
  if (t.characterId) await updateDoc(_chrRef(t.characterId),{pm:v}).catch(()=>{});
  else if (t.npcId)  await updateDoc(_npcRef(t.npcId),{pmCurrent:v}).catch(()=>{});
};

window._vttMsSetXp = async (charId, uid, xp) => {
  if (!_msCanEdit(uid)) return;
  const c = _characters[charId]; if (!c) return;
  const val = Math.max(0, Math.round(xp));
  await updateDoc(_chrRef(charId), { exp: val }).catch(() => {});
  c.exp = val;
  _renderMiniSheet(uid);
};

window._vttMsAddXp = async (charId, uid, delta) => {
  if (!_msCanEdit(uid)) return;
  const c = _characters[charId]; if (!c) return;
  const d = Math.round(delta);
  if (!d || d <= 0) return;
  const newXp = Math.max(0, (parseInt(c.exp) || 0) + d);
  await updateDoc(_chrRef(charId), { exp: newXp }).catch(() => {});
  c.exp = newXp;
  _renderMiniSheet(uid);
};

window._vttMsSetNiveau = async (charId, uid, niveau) => {
  if (!_msCanEdit(uid)) return;
  const c = _characters[charId]; if (!c) return;
  const val = Math.max(1, Math.min(20, Math.round(niveau)));
  await updateDoc(_chrRef(charId), { niveau: val }).catch(() => {});
  c.niveau = val;
  _renderMiniSheet(uid);
};
window._vttEditToken = id => _openStatsModal(_tokens[id]?.data??null);

/** Réinitialise le déplacement et les actions d'un token (MJ, tour individuel). */
window._vttResetTurn = async id => {
  if (!STATE.isAdmin) return;
  await updateDoc(_tokRef(id), { movedThisTurn: false, movedCells: 0, bonusMvt: 0, attackedThisTurn: false })
    .catch(() => showNotif('Erreur reset tour', 'error'));
  showNotif('Tour réinitialisé', 'success');
};

window._vttAddImageUrl = async () => {
  const url=prompt('URL de l\'image :')?.trim(); if (!url||!_activePage) return;
  const imgs=[...(_activePage.backgroundImages??[]),{id:Date.now().toString(),url,x:0,y:0,w:_activePage.cols,h:_activePage.rows}];
  await updateDoc(_pgRef(_activePage.id),{backgroundImages:imgs}).catch(()=>{});
};
window._vttUploadClick = () => document.getElementById('vtt-img-input')?.click();

window._vttToggleCombat = async () => {
  if (!STATE.isAdmin) return;
  const active=!_session?.combat?.active;
  await setDoc(_sesRef(),{combat:{active,round:active?1:0}},{merge:true});
  if (active) {
    const b=writeBatch(db);
    Object.keys(_tokens).forEach(id=>b.update(_tokRef(id),{movedThisTurn:false,movedCells:0,bonusMvt:0,attackedThisTurn:false}));
    await b.commit().catch(()=>{});
    showNotif('⚔️ Combat démarré !','success');
  } else showNotif('Combat terminé.','success');
};
window._vttNextRound = async () => {
  if (!STATE.isAdmin||!_session?.combat?.active) return;
  const round=(_session.combat.round??1)+1;
  await setDoc(_sesRef(),{combat:{active:true,round}},{merge:true});

  // ── Application des DoT en début de round (avant le cleanup des buffs) ──
  // Chaque buff de type 'dot' inflige sa formule à son porteur
  const dotNotifs = [];
  for (const id of Object.keys(_tokens)) {
    const td = _tokens[id]?.data;
    const dots = (td?.buffs || []).filter(b => b.type === 'dot'
      && (b.expiresAtRound == null || round <= b.expiresAtRound));
    if (!dots.length) continue;
    let total = 0;
    for (const dot of dots) {
      total += _rollDice(dot.formula || '1d4 +2');
    }
    if (total <= 0) continue;
    const lT = _live(td);
    const curHp = lT.displayHp ?? td.hp ?? 20;
    const newHp = Math.max(0, curHp - total);
    await _setHp(td, newHp).catch(() => {});
    dotNotifs.push(`🩸 ${total} dégâts DoT → ${lT.displayName ?? td.name}`);
    // JS de concentration auto si la cible porte un sort canalisé
    const concNotes = await _vttTriggerConcentrationSave(td, total);
    dotNotifs.push(...concNotes);
  }

  const b=writeBatch(db);
  const expiredNotifs = [];
  Object.keys(_tokens).forEach(id => {
    const tokData = _tokens[id]?.data;
    if (!tokData) return;
    // ── Cleanup auto des tokens summons expirés (sentinelle, arme invoquée) ──
    // Les summons non-canalisés expirent à round > summonExpiresAtRound.
    // Les summons canalisés (summonCanalise: true) persistent tant que la
    // concentration tient — supprimés via le JS Sa raté.
    if (tokData.summonExpiresAtRound != null && !tokData.summonCanalise && round > tokData.summonExpiresAtRound) {
      expiredNotifs.push(`${tokData.summonKind === 'sentinelle' ? '🪤' : '⚔️'} ${tokData.name} dissipé`);
      b.delete(_tokRef(id));
      return; // skip buff cleanup pour token supprimé
    }
    const updates = { movedThisTurn: false, movedCells: 0, bonusMvt: 0, attackedThisTurn: false };
    if (tokData.buffs?.length) {
      const remaining = tokData.buffs.filter(bf => {
        const isExpired =
          // cas normal : expiresAtRound calculé
          (bf.expiresAtRound != null && round > bf.expiresAtRound) ||
          // fallback : anciens buffs (expiresAtRound null) avec totalDuration+startRound
          (bf.expiresAtRound == null && bf.totalDuration != null && bf.startRound != null &&
           round - Math.max(1, bf.startRound) >= bf.totalDuration);
        if (isExpired) {
          expiredNotifs.push(`${bf.icon ?? '✨'} ${bf.sortLabel ?? 'Buff'} expiré sur ${_live(tokData).displayName ?? tokData.name}`);
          return false;
        }
        return true;
      });
      if (remaining.length !== tokData.buffs.length) updates.buffs = remaining;
    }
    b.update(_tokRef(id), updates);
  });
  await b.commit().catch(()=>{});
  dotNotifs.forEach(msg => showNotif(msg, 'error'));
  expiredNotifs.forEach(msg => showNotif(msg, 'info'));
  showNotif(`Round ${round} !`, 'success');
};

// ── Modal stats combat (override des stats auto) ────────────────────
function _openStatsModal(t) {
  if (!t) return;
  const ld=_live(t);
  openModal('⚙️ Stats de combat', `
    <div class="vtt-form">
      <div class="vtt-form-row">
        <div class="form-group"><label>🏃 Mouvement</label><input id="vsf-mv"    type="number" value="${t.movement??''}"  placeholder="${ld.displayMovement??6} (auto)"></div>
        <div class="form-group"><label>🎯 Portée</label>   <input id="vsf-range" type="number" value="${t.range??1}"       min="0"></div>
      </div>
      <div class="vtt-form-row">
        <div class="form-group"><label>⚔️ Attaque</label>  <input id="vsf-atk"   type="number" value="${t.attack??''}"    placeholder="${ld.displayAttack??5} (auto)"></div>
        <div class="form-group"><label>🛡 CA/Défense</label><input id="vsf-def"  type="number" value="${t.defense??''}"   placeholder="${ld.displayDefense??0} (auto)"></div>
      </div>
      <div class="form-group"><label>📐 Taille token (cases L × H)</label>
        <div style="display:flex;gap:.5rem;align-items:center">
          <select id="vsf-tokenW" class="input-field" style="flex:1">
            <option value=""${t.tokenW==null?' selected':''}>Auto (${ld.displayTokenW||1})</option>
            ${[1,2,3,4,5].map(n => `<option value="${n}"${t.tokenW===n?' selected':''}>${n}</option>`).join('')}
          </select>
          <span style="color:var(--text-dim)">×</span>
          <select id="vsf-tokenH" class="input-field" style="flex:1">
            <option value=""${t.tokenH==null?' selected':''}>Auto (${ld.displayTokenH||1})</option>
            ${[1,2,3,4,5].map(n => `<option value="${n}"${t.tokenH===n?' selected':''}>${n}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group"><label>URL image (optionnel)</label>
        <input id="vsf-img" type="text" value="${t.imageUrl??''}" placeholder="Remplace la photo du perso">
      </div>
      <label class="vtt-check-label"><input id="vsf-visible" type="checkbox" ${t.visible?'checked':''}> Visible par les joueurs</label>
      <small style="color:var(--text-dim);font-size:.7rem;margin-top:.25rem">
        Laisser vide pour utiliser les stats calculées depuis la fiche de personnage.
      </small>
      <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">
        <button class="btn-secondary" data-action="close-modal">Annuler</button>
        <button class="btn-primary" onclick="window._vttSaveStats('${t.id}')">💾 Enregistrer</button>
      </div>
    </div>`);
}
// ── Création d'ennemis personnalisés ────────────────────────────────
window._vttCreateEnemy = () => {
  openModal('👹 Créer un ennemi', `
    <div class="vtt-form">
      <div class="form-group"><label>Nom</label>
        <input id="ve-name" type="text" placeholder="ex : Gobelin" autofocus></div>
      <div class="vtt-form-row">
        <div class="form-group"><label>PV Max</label>
          <input id="ve-hp" type="number" value="20" min="1"></div>
        <div class="form-group"><label>CA / Défense</label>
          <input id="ve-ca" type="number" value="10" min="0"></div>
      </div>
      <div class="vtt-form-row">
        <div class="form-group"><label>⚔️ Dégâts (dés)</label>
          <input id="ve-atk" type="text" value="1d6" placeholder="1d6, 2d4+2…"></div>
        <div class="form-group"><label>🏃 Mouvement</label>
          <input id="ve-mv" type="number" value="4" min="1"></div>
      </div>
      <div class="vtt-form-row">
        <div class="form-group"><label>🎯 Portée (cases)</label>
          <input id="ve-range" type="number" value="1" min="1"></div>
        <div class="form-group"><label>Nombre à créer</label>
          <input id="ve-count" type="number" value="1" min="1" max="20"></div>
      </div>
      <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">
        <button class="btn-secondary" data-action="close-modal">Annuler</button>
        <button class="btn-primary" onclick="window._vttConfirmCreateEnemy()">Créer</button>
      </div>
    </div>`);
};
window._vttConfirmCreateEnemy = async () => {
  const name  = (document.getElementById('ve-name')?.value||'').trim() || 'Ennemi';
  const hp    = Math.max(1, parseInt(document.getElementById('ve-hp')?.value)||20);
  const ca    = parseInt(document.getElementById('ve-ca')?.value)||10;
  const atk   = document.getElementById('ve-atk')?.value.trim()||'1d6';
  const mv    = Math.max(1, parseInt(document.getElementById('ve-mv')?.value)||4);
  const range = Math.max(1, parseInt(document.getElementById('ve-range')?.value)||1);
  const count = Math.min(20, Math.max(1, parseInt(document.getElementById('ve-count')?.value)||1));
  closeModalDirect();
  const batch = writeBatch(db);
  for (let i=0; i<count; i++) {
    const ref = doc(_toksCol());
    batch.set(ref, {
      name: count>1 ? `${name} ${i+1}` : name,
      type: 'enemy', characterId: null, npcId: null, ownerId: null,
      pageId: _activePage?.id||null,
      col: _activePage ? Math.min(_activePage.cols-1, Math.floor(_activePage.cols/2)+i) : i,
      row: _activePage ? Math.floor(_activePage.rows/2) : 0,
      visible: true,
      hp, hpMax: hp, attackDice: atk, defense: ca, movement: mv, range,
      imageUrl: null, movedThisTurn: false, attackedThisTurn: false,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit().catch(()=>showNotif('Erreur création','error'));
  showNotif(`👹 ${count>1?`${count} ennemis créés`:'Ennemi créé'} !`,'success');
};

// Créer une nouvelle instance indépendante d'un ennemi (PV séparés)
window._vttDuplicateToken = async tokenId => {
  const t=_tokens[tokenId]?.data; if (!t) return;
  const baseName=t.name.replace(/ \d+$/, '');
  const sameGroup=Object.values(_tokens).filter(e=>
    t.beastId ? e.data.beastId===t.beastId
              : (e.data.name||'').replace(/ \d+$/,'')===baseName
  );
  const usedNums=new Set(sameGroup.map(e=>{const m=(e.data.name||'').match(/\s(\d+)$/);return m?parseInt(m[1]):1;}));
  let num=1; while(usedNums.has(num))num++;
  const { id:_tid, createdAt:_ca, ...base } = t;
  const ref=doc(_toksCol());
  await setDoc(ref, {
    ...base,
    name: num===1 ? baseName : `${baseName} ${num}`,
    hp: null,   // PV frais depuis le template bestiaire
    pageId: _activePage?.id||null,
    col: _activePage ? Math.min(_activePage.cols-1,(t.col||0)+sameGroup.length) : 0,
    row: t.row||0,
    visible: true,
    movedThisTurn: false, attackedThisTurn: false,
    createdAt: serverTimestamp(),
  }).catch(()=>showNotif('Erreur duplication','error'));
  showNotif(`👹 ${baseName} ${num} créé !`,'success');
};

// Placer une instance depuis le bestiaire (crée + place sur la page active)
window._vttPlaceFromBestiary = async beastId => {
  if (!_activePage) return showNotif('Aucune page active — ouvre une page d\'abord','error');
  const b=_bestiary[beastId]; if (!b) return;
  // Purger les tokens fantômes (anciens auto-créés, non placés, non modifiés)
  const ghosts=Object.values(_tokens).filter(e=>e.data.beastId===beastId&&!e.data.pageId&&e.data.hp==null);
  if (ghosts.length) {
    const batch=writeBatch(db);
    ghosts.forEach(g=>batch.delete(_tokRef(g.data.id)));
    await batch.commit().catch(()=>{});
  }
  // Trouver le premier numéro libre parmi les tokens actifs
  const active=Object.values(_tokens).filter(e=>e.data.beastId===beastId&&(e.data.pageId||e.data.hp!=null));
  const usedNums=new Set(active.map(e=>{const m=(e.data.name||'').match(/\s(\d+)$/);return m?parseInt(m[1]):1;}));
  let num=1; while(usedNums.has(num))num++;
  const name=num===1?(b.nom||'Créature'):`${b.nom} ${num}`;
  const sw = Math.max(1, Math.min(5, b.tokenW || b.tokenSize || 1));
  const sh = Math.max(1, Math.min(5, b.tokenH || b.tokenSize || 1));
  const cx=Math.floor(_activePage.cols/2), cy=Math.floor(_activePage.rows/2);
  const ref=doc(_toksCol());
  await setDoc(ref,{
    name, type:'enemy',
    characterId:null, npcId:null, beastId,
    ownerId:null,
    pageId:_activePage.id,
    col:Math.max(0,Math.min(_activePage.cols-sw,cx+active.length)),
    row:Math.max(0,Math.min(_activePage.rows-sh,cy)),
    visible:true,
    imageUrl:null, movement:null, range:1, attack:null, defense:null,
    hp:null, hpMax:null,
    movedThisTurn:false, attackedThisTurn:false,
    createdAt:serverTimestamp(),
  }).catch(()=>showNotif('Erreur placement','error'));
  showNotif(`👹 ${name} placé !`,'success');
};

// Supprimer définitivement un token ennemi
window._vttDeleteToken = async tokenId => {
  const t=_tokens[tokenId]?.data; if (!t||t.type!=='enemy') return;
  if (!confirm(`Supprimer définitivement "${t.name}" ?`)) return;
  await deleteDoc(_tokRef(tokenId)).catch(()=>showNotif('Erreur suppression','error'));
  showNotif(`🗑 ${t.name} supprimé`,'success');
};

window._vttSaveStats = async id => {
  const mv  = document.getElementById('vsf-mv')?.value;
  const rng = document.getElementById('vsf-range')?.value;
  const atk = document.getElementById('vsf-atk')?.value;
  const def = document.getElementById('vsf-def')?.value;
  const img = document.getElementById('vsf-img')?.value.trim();
  const vis = document.getElementById('vsf-visible')?.checked;
  const tw = document.getElementById('vsf-tokenW')?.value;
  const th = document.getElementById('vsf-tokenH')?.value;
  const patch = {
    movement: mv  ? +mv  : null,
    range:    rng ? +rng : 1,
    attack:   atk ? +atk : null,
    defense:  def ? +def : null,
    imageUrl: img || null,
    visible:  vis ?? true,
    tokenW:   tw ? Math.max(1, Math.min(5, parseInt(tw)||1)) : null,
    tokenH:   th ? Math.max(1, Math.min(5, parseInt(th)||1)) : null,
  };
  // Clamper la position dans la nouvelle bounding box (héritage bête si override null)
  const cur = _tokens[id]?.data;
  if (cur && _activePage) {
    const b = cur.beastId ? _bestiary[cur.beastId] : null;
    const sw = patch.tokenW ?? b?.tokenW ?? b?.tokenSize ?? 1;
    const sh = patch.tokenH ?? b?.tokenH ?? b?.tokenSize ?? 1;
    patch.col = Math.max(0, Math.min(_activePage.cols - sw, cur.col ?? 0));
    patch.row = Math.max(0, Math.min(_activePage.rows - sh, cur.row ?? 0));
  }
  await updateDoc(_tokRef(id),patch).catch(()=>showNotif('Erreur','error'));
  closeModalDirect();
  showNotif('Stats mises à jour','success');
};

// ── Upload via ImgBB ────────────────────────────────────────────────
// Clé API stockée en localStorage (jamais dans le code)
const _IMGBB_KEY_LS = 'vtt-imgbb-key';

function _getImgbbKey() { return localStorage.getItem(_IMGBB_KEY_LS)||''; }

window._vttSetImgbbKey = () => {
  const current = _getImgbbKey();
  const key = prompt('Clé API ImgBB (imgbb.com → Get API key) :', current)?.trim();
  if (key === null) return;
  if (key) { localStorage.setItem(_IMGBB_KEY_LS, key); showNotif('Clé ImgBB enregistrée ✓','success'); }
  else      { localStorage.removeItem(_IMGBB_KEY_LS); showNotif('Clé ImgBB supprimée','success'); }
};

async function _handleUpload(file) {
  if (!file||!_activePage) return;
  const key = _getImgbbKey();
  if (!key) {
    showNotif('Configure ta clé ImgBB d\'abord (bouton 🔑)','error');
    return;
  }
  showNotif('Upload en cours…','success');
  try {
    const b64 = await new Promise((res,rej)=>{
      const r=new FileReader(); r.onload=()=>res(r.result.split(',')[1]); r.onerror=rej; r.readAsDataURL(file);
    });
    const form=new FormData();
    form.append('key', key);
    form.append('image', b64);
    const resp = await fetch('https://api.imgbb.com/1/upload', { method:'POST', body:form });
    const json = await resp.json();
    if (!json.success) throw new Error(json.error?.message||'ImgBB error');
    const url = json.data.url;
    const imgs=[...(_activePage.backgroundImages??[]),{id:Date.now().toString(),url,x:0,y:0,w:_activePage.cols,h:_activePage.rows}];
    await updateDoc(_pgRef(_activePage.id),{backgroundImages:imgs});
    // Sauver dans la bibliothèque
    const entry = { id: crypto.randomUUID(), url, name: file.name, folderId: _libFolder || null };
    const updLib = { folders: _mapLib.folders||[], images: [...(_mapLib.images||[]), entry] };
    setDoc(_mapLibRef(), updLib).catch(()=>{});
    showNotif('Image ajoutée !','success');
  } catch(e) { console.error(e); showNotif('Erreur upload : '+e.message,'error'); }
}

// ── Outil + clavier ─────────────────────────────────────────────────
function _setTool(tool) {
  _tool = tool;
  document.querySelectorAll('.vtt-tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  // Draw bar
  const drawBar = document.getElementById('vtt-draw-bar');
  if (drawBar) drawBar.style.display = tool === 'draw' ? 'flex' : 'none';
  // Walls bar
  const wallsBar = document.getElementById('vtt-walls-bar');
  if (wallsBar) wallsBar.style.display = tool === 'walls' ? 'flex' : 'none';
  // Curseur
  const wrap = document.getElementById('vtt-canvas-wrap');
  if (wrap) wrap.style.cursor = (tool === 'ruler' || tool === 'draw' || tool === 'walls') ? 'crosshair' : '';
  // Éditeur de murs
  fogToggleEditMode(tool === 'walls', _activePage);
  if (tool === 'walls') fogRenderWalls(_activePage, true);
  else if (_activePage) fogRenderWalls(_activePage, STATE.isAdmin); // quitter édition → redraw normal
  // Règle : effacer si on quitte
  if (tool !== 'ruler') { _clearRuler(); _hideRulerHover(); }
  // Désélection annotation si on quitte le mode select
  if (tool !== 'select') _deselectAnnot();
  // Draggability des annotations
  _updateAnnotDraggable();
}
// Directions : flèches (4 cardinales) + pavé numérique (8 dirs)
const _MOVE_KEYS = {
  'ArrowLeft':  {dc:-1,dr: 0}, 'ArrowRight': {dc: 1,dr: 0},
  'ArrowUp':    {dc: 0,dr:-1}, 'ArrowDown':  {dc: 0,dr: 1},
};
const _NUMPAD_KEYS = {
  'Numpad4':{dc:-1,dr: 0}, 'Numpad6':{dc: 1,dr: 0},
  'Numpad8':{dc: 0,dr:-1}, 'Numpad2':{dc: 0,dr: 1},
  'Numpad7':{dc:-1,dr:-1}, 'Numpad9':{dc: 1,dr:-1},
  'Numpad1':{dc:-1,dr: 1}, 'Numpad3':{dc: 1,dr: 1},
};

function _keyHandler(e) {
  if (!document.getElementById('vtt-canvas-wrap')) return;
  if (e.target.matches('input,textarea,select')) return;
  if (e.key==='Escape') { if (_tool !== 'select') _setTool('select'); else _deselect(); }
  // Raccourci R : bascule l'outil règle (sans modificateur, hors saisie)
  if ((e.key==='r' || e.key==='R') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    window._vttTool('ruler');
  }
  if ((e.key==='Delete'||e.key==='Backspace') && _tool==='select') {
    // 1) Annotations sélectionnées
    if (_selectedAnnotIds.size > 0) {
      e.preventDefault();
      [..._selectedAnnotIds].forEach(id => deleteDoc(_annotRef(id)).catch(()=>{}));
      _deselectAnnot();
    }
    // 2) Image de carte sélectionnée (MJ, mode édition)
    else if (STATE.isAdmin && _selImg && _mapMode && _activePage) {
      e.preventDefault();
      const imgs = (_activePage.backgroundImages ?? []).filter(i => i.id !== _selImg);
      updateDoc(_pgRef(_activePage.id), { backgroundImages: imgs }).catch(()=>{});
      _selImg = null;
      _imgTr?.nodes([]); _imgTrFg?.nodes([]);
      _layers.map?.batchDraw(); _layers.mapFg?.batchDraw();
    }
    // 3) Tokens sélectionnés → retrait du canvas (pageId=null)
    else {
      const ids = _selectedMulti.size > 0 ? [..._selectedMulti] : (_selected ? [_selected] : []);
      if (ids.length) {
        e.preventDefault();
        const uid = STATE.user?.uid;
        for (const id of ids) {
          const t = _tokens[id]?.data; if (!t) continue;
          if (STATE.isAdmin || t.ownerId === uid) {
            updateDoc(_tokRef(id), { pageId: null, visible: false }).catch(()=>{});
          }
        }
        _deselect();
      }
    }
  }
  // Ctrl+Z : annuler le dernier tracé de la session
  if ((e.ctrlKey||e.metaKey) && e.key==='z' && !e.shiftKey) {
    e.preventDefault();
    const lastId = _drawHistory.pop();
    if (lastId) deleteDoc(_annotRef(lastId)).catch(()=>{});
  }
  // Flèches / pavé numérique : déplacer le token sélectionné
  if (!e.ctrlKey && !e.metaKey && !e.altKey && _selected) {
    const dir = _MOVE_KEYS[e.key] ?? _NUMPAD_KEYS[e.code];
    if (dir) {
      e.preventDefault(); // empêche le scroll de la page
      _moveSelectedBy(dir.dc, dir.dr);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// BIBLIOTHÈQUE DE CARTES
// ═══════════════════════════════════════════════════════════════════

async function _saveMapLib() {
  await setDoc(_mapLibRef(), { folders: _mapLib.folders, images: _mapLib.images });
}

function _renderLibSection() {
  const el = document.getElementById('vtt-tray-library');
  if (!el) return;

  if (!_libOpen) { el.innerHTML = ''; return; }

  const folders = _mapLib.folders || [];
  const images  = _mapLib.images  || [];
  const curFolder = _libFolder ? folders.find(f => f.id === _libFolder) : null;
  const visible = _libFolder
    ? images.filter(i => i.folderId === _libFolder)
    : images.filter(i => !i.folderId);

  const folderChips = !_libFolder ? folders.map(f => {
    const cnt = images.filter(i => i.folderId === f.id).length;
    return `<div class="vtt-lib-folder-chip" onclick="window._vttLibOpenFolder('${f.id}')">
      <span>📁 ${_esc(f.name)}</span>
      <span class="vtt-lib-chip-cnt">${cnt}</span>
      <button class="vtt-icon-btn" onclick="event.stopPropagation();window._vttLibDelFolder('${f.id}')" title="Supprimer le dossier">✕</button>
    </div>`;
  }).join('') : '';

  const imgGrid = visible.length
    ? `<div class="vtt-lib-grid">${visible.map(img => `
        <div class="vtt-lib-card" title="${_esc(img.name||'')}">
          <img src="${img.url}" loading="lazy" onerror="this.parentNode.classList.add('vtt-lib-card--err')">
          <div class="vtt-lib-card-ov">
            <button onclick="window._vttLibPlace('${img.id}')" title="Placer sur la carte">▶</button>
            ${folders.length && !_libFolder ? `<button onclick="window._vttLibMoveMenu('${img.id}',event)" title="Déplacer dans un dossier">📁</button>` : ''}
            ${_libFolder ? `<button onclick="window._vttLibMoveRoot('${img.id}')" title="Retirer du dossier">↩</button>` : ''}
            <button onclick="window._vttLibDelImg('${img.id}')" title="Supprimer">🗑</button>
          </div>
          <div class="vtt-lib-card-name">${_esc(img.name||'image')}</div>
        </div>`).join('')}</div>`
    : `<div class="vtt-tray-empty">Aucune image${_libFolder ? ' dans ce dossier' : ''}</div>`;

  el.innerHTML = `
    ${_libFolder
      ? `<button class="vtt-lib-back" onclick="window._vttLibOpenFolder(null)">← ${_esc(curFolder?.name||'Racine')}</button>`
      : folderChips}
    ${imgGrid}`;
}

window._vttLibOpenFolder  = (id) => { _libFolder = id; _renderLibSection(); };
window._vttLibToggle      = ()  => { _libOpen = !_libOpen; _renderLibSection();
  document.getElementById('vtt-lib-toggle')?.classList.toggle('open', _libOpen); };

window._vttLibNewFolder   = () => {
  const name = prompt('Nom du dossier :')?.trim();
  if (!name) return;
  _mapLib.folders.push({ id: crypto.randomUUID(), name });
  _saveMapLib();
};

window._vttLibDelFolder   = (id) => {
  // Retirer les images du dossier (les remettre en racine)
  _mapLib.images  = _mapLib.images.map(i => i.folderId === id ? { ...i, folderId: null } : i);
  _mapLib.folders = _mapLib.folders.filter(f => f.id !== id);
  if (_libFolder === id) _libFolder = null;
  _saveMapLib();
};

window._vttLibDelImg      = (id) => {
  _mapLib.images = _mapLib.images.filter(i => i.id !== id);
  _saveMapLib();
};

window._vttLibMoveRoot    = (id) => {
  _mapLib.images = _mapLib.images.map(i => i.id === id ? { ...i, folderId: null } : i);
  _saveMapLib();
};

window._vttLibMoveMenu    = (imgId, evt) => {
  evt.stopPropagation();
  // Mini popup de sélection de dossier
  const existing = document.getElementById('vtt-lib-move-popup');
  if (existing) { existing.remove(); return; }
  const popup = document.createElement('div');
  popup.id = 'vtt-lib-move-popup';
  popup.className = 'vtt-lib-move-popup';
  popup.innerHTML = _mapLib.folders.map(f =>
    `<div class="vtt-lib-move-opt" onclick="window._vttLibMoveTo('${imgId}','${f.id}');document.getElementById('vtt-lib-move-popup')?.remove()">📁 ${_esc(f.name)}</div>`
  ).join('') || '<div style="padding:.4rem;font-size:.75rem;color:var(--text-dim)">Aucun dossier</div>';
  const rect = evt.currentTarget.getBoundingClientRect();
  popup.style.top  = (rect.bottom + 4) + 'px';
  popup.style.left = rect.left + 'px';
  document.body.appendChild(popup);
  const close = (e) => { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('mousedown', close, true); } };
  setTimeout(() => document.addEventListener('mousedown', close, true), 10);
};

window._vttLibMoveTo      = (imgId, folderId) => {
  _mapLib.images = _mapLib.images.map(i => i.id === imgId ? { ...i, folderId } : i);
  _saveMapLib();
};

window._vttLibPlace       = (imgId) => {
  if (!_activePage) { showNotif('Aucune page active', 'error'); return; }
  const img = _mapLib.images.find(i => i.id === imgId);
  if (!img) return;
  const imgs = [...(_activePage.backgroundImages??[]), {
    id: Date.now().toString(), url: img.url, x: 0, y: 0,
    w: _activePage.cols, h: _activePage.rows,
  }];
  updateDoc(_pgRef(_activePage.id), { backgroundImages: imgs })
    .then(() => showNotif('Image placée sur la carte', 'success'))
    .catch(() => showNotif('Erreur lors du placement', 'error'));
};

// ═══════════════════════════════════════════════════════════════════
// BUTIN D'AVENTURE
// ═══════════════════════════════════════════════════════════════════

async function _saveLoot() {
  await setDoc(_lootRef(), { stash: _loot.stash, loot: _loot.loot });
}

function _renderLootPanel() {
  const panel = document.getElementById('vtt-loot-panel');
  if (!panel || panel.dataset.open !== '1') return;
  const mj = STATE.isAdmin;

  const _itemRow = (item, zone) => {
    const rarColor = { commune:'#9ca3af', peu_commune:'#22c38e', rare:'#4f8cff', tres_rare:'#b47fff', legendaire:'#f59e0b' }[item.rarete] || '#9ca3af';
    return `<div class="vtt-loot-row" data-id="${item.id}">
      ${mj ? `<span class="vtt-loot-drag" title="${zone === 'stash' ? 'Glisser vers le butin' : 'Glisser vers la réserve'}">⠿</span>` : ''}
      <span class="vtt-loot-dot" style="background:${rarColor}"></span>
      <span class="vtt-loot-name">${_esc(item.nom)}</span>
      <span class="vtt-loot-qty">×${item.qty}</span>
      ${zone === 'stash' && mj ? `<button class="vtt-icon-btn" onclick="window._vttLootRemoveStash('${item.id}')" title="Retirer">✕</button>` : ''}
      ${zone === 'loot'  && mj ? `<button class="vtt-icon-btn" onclick="window._vttLootRemoveLoot('${item.id}')" title="Retirer">✕</button>` : ''}
      ${zone === 'loot' ? `<button class="vtt-loot-take-btn" onclick="window._vttLootPickQty('${item.id}')">Prendre</button>` : ''}
    </div>`;
  };

  panel.innerHTML = `
    ${mj ? `
    <div class="vtt-loot-section">
      <div class="vtt-loot-sec-hd">
        <span>🔒 Réserve MJ</span>
        <button class="vtt-btn-sm" onclick="window._vttLootOpenShop()">＋ Ajouter</button>
      </div>
      <div class="vtt-loot-list" id="vtt-stash-list">
        ${_loot.stash.length ? _loot.stash.map(i => _itemRow(i, 'stash')).join('') : '<div class="vtt-loot-empty">Vide — ajoutez des objets</div>'}
      </div>
    </div>
    <div class="vtt-loot-divider">↕ Glisser entre réserve et butin</div>
    ` : ''}
    <div class="vtt-loot-section">
      <div class="vtt-loot-sec-hd">
        <span>💰 Butin disponible</span>
        ${mj ? `<button class="vtt-btn-sm vtt-btn-danger" onclick="window._vttLootClear()">🗑</button>` : ''}
      </div>
      <div class="vtt-loot-list" id="vtt-loot-list">
        ${_loot.loot.length ? _loot.loot.map(i => _itemRow(i, 'loot')).join('') : '<div class="vtt-loot-empty">Aucun butin</div>'}
      </div>
    </div>`;

  if (mj) _initLootSortable();
}

function _initLootSortable() {
  const stashEl = document.getElementById('vtt-stash-list');
  const lootEl  = document.getElementById('vtt-loot-list');
  if (!stashEl || !lootEl) return;
  import('../vendor/sortable.esm.js').then(({ default: Sortable }) => {
    Sortable.create(stashEl, {
      group: { name: 'vtt-loot', pull: 'clone', put: true },
      animation: 150,
      handle: '.vtt-loot-drag',
      sort: false,
      ghostClass: 'vtt-loot-ghost',
      onAdd(evt) {
        // Item glissé depuis le butin vers la réserve
        const id = evt.item.dataset.id;
        evt.item.remove();
        const src = _loot.loot.find(i => i.id === id);
        if (!src) return;
        const existing = _loot.stash.find(i => i.itemId === src.itemId);
        if (existing) { existing.qty += src.qty; }
        else { _loot.stash.push({ ...src, id: crypto.randomUUID() }); }
        _loot.loot = _loot.loot.filter(i => i.id !== id);
        _saveLoot();
      },
    });
    Sortable.create(lootEl, {
      group: { name: 'vtt-loot', pull: true, put: true },
      animation: 150,
      handle: '.vtt-loot-drag',
      sort: false,
      ghostClass: 'vtt-loot-ghost',
      onAdd(evt) {
        // Item glissé depuis la réserve vers le butin
        const id = evt.item.dataset.id;
        evt.item.remove();
        const src = _loot.stash.find(i => i.id === id);
        if (!src) return;
        const existing = _loot.loot.find(i => i.itemId === src.itemId);
        if (existing) { existing.qty += src.qty; }
        else { _loot.loot.push({ ...src, id: crypto.randomUUID() }); }
        _loot.stash = _loot.stash.filter(i => i.id !== id);
        _saveLoot();
      },
    });
  });
}

function _closeLootPanel() {
  const panel = document.getElementById('vtt-loot-panel');
  const btn   = document.getElementById('vtt-loot-trigger');
  if (panel) { panel.dataset.open = '0'; panel.style.display = 'none'; }
  btn?.classList.remove('active');
  if (_lootCloseOutside) {
    document.removeEventListener('mousedown', _lootCloseOutside, true);
    _lootCloseOutside = null;
  }
}

window._vttToggleLoot = () => {
  const panel = document.getElementById('vtt-loot-panel');
  if (!panel) return;
  const open = panel.dataset.open === '1';
  if (open) { _closeLootPanel(); return; }
  panel.dataset.open = '1';
  panel.style.display = 'flex';
  document.getElementById('vtt-loot-trigger')?.classList.add('active');
  _renderLootPanel();
  _lootCloseOutside = (e) => {
    const float = document.querySelector('.vtt-loot-float');
    if (float && !float.contains(e.target)) _closeLootPanel();
  };
  document.addEventListener('mousedown', _lootCloseOutside, true);
};

window._vttLootRemoveStash = (id) => {
  _loot.stash = _loot.stash.filter(i => i.id !== id);
  _saveLoot();
};

window._vttLootRemoveLoot = (id) => {
  _loot.loot = _loot.loot.filter(i => i.id !== id);
  _saveLoot();
};

window._vttLootClear = () => {
  _loot.loot = [];
  _saveLoot();
};

// MJ : choisir un item de la boutique à ajouter au stash
window._vttLootOpenShop = async () => {
  const [items, cats] = await Promise.all([loadCollection('shop'), loadCollection('shopCategories')]);
  const catMap = Object.fromEntries((cats||[]).map(c => [c.id, c]));
  let filtered = [...items];

  const render = (q = '') => {
    const q2 = q.toLowerCase().trim();
    const list = q2 ? filtered.filter(i => i.nom?.toLowerCase().includes(q2)) : filtered;
    const rows = list.slice(0, 40).map(item => {
      const cat = catMap[item.categorieId];
      const rarColor = { commune:'#9ca3af', peu_commune:'#22c38e', rare:'#4f8cff', tres_rare:'#b47fff', legendaire:'#f59e0b' }[item.rarete] || '#9ca3af';
      return `<div class="vtt-shop-row" onclick="window._vttLootPickFromShop('${item.id}')">
        <span class="vtt-loot-dot" style="background:${rarColor}"></span>
        <span class="vtt-shop-name">${_esc(item.nom||'?')}</span>
        <span class="vtt-shop-cat">${_esc(cat?.nom||'')}</span>
      </div>`;
    }).join('') || '<div style="padding:.5rem;color:var(--text-muted);font-size:.78rem">Aucun résultat</div>';
    const el = document.getElementById('vtt-shop-list');
    if (el) el.innerHTML = rows;
  };

  window._vttLootShopSearch = (q) => render(q);
  window._vttLootPickFromShop = (itemId) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    openModal(`Ajouter "${_esc(item.nom)}" au stash`, `
      <div style="padding:.5rem 0">
        <label style="font-size:.83rem;color:var(--text-muted)">Quantité</label>
        <input id="vtt-loot-qty-input" type="number" min="1" value="1"
          style="width:80px;margin-left:.5rem;padding:.3rem .5rem;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text);font-size:.9rem">
      </div>
      <button class="btn-primary" style="width:100%;margin-top:.5rem"
        onclick="window._vttLootConfirmAdd('${item.id}')">Ajouter au stash</button>`,
    );
  };
  window._vttLootConfirmAdd = (itemId) => {
    const item = items.find(i => i.id === itemId);
    const qty  = Math.max(1, parseInt(document.getElementById('vtt-loot-qty-input')?.value) || 1);
    if (!item) return;
    const prixVente = Math.round((item.prix || 0) * 0.5);
    const entry = {
      id: crypto.randomUUID(), itemId: item.id,
      nom: item.nom || '?', qty,
      rarete: item.rarete || 'commune',
      template: catMap[item.categorieId]?.template || 'classique',
      categorieId: item.categorieId || '',
      prixAchat: item.prix || 0, prixVente,
      format: item.format || '', degats: item.degats || '',
      degatsStat: item.degatsStat || '', toucherStat: item.toucherStat || '',
      ca: item.ca || '', effet: item.effet || '', description: item.description || '',
      slotArmure: item.slotArmure || '', typeArmure: item.typeArmure || '',
      slotBijou: item.slotBijou || '', sousType: item.sousType || '',
      portee: item.portee || '', traits: Array.isArray(item.traits) ? [...item.traits] : [],
      fo: parseInt(item.fo ?? item.for)||0, for: parseInt(item.for ?? item.fo)||0,
      dex: parseInt(item.dex)||0, in: parseInt(item.in)||0,
      sa: parseInt(item.sa)||0, co: parseInt(item.co)||0, ch: parseInt(item.ch)||0,
    };
    // Fusionner si même item déjà dans le stash
    const existing = _loot.stash.find(s => s.itemId === item.id);
    if (existing) { existing.qty += qty; } else { _loot.stash.push(entry); }
    _saveLoot();
    closeModalDirect();
    showNotif(`×${qty} "${item.nom}" ajouté au stash`, 'success');
  };

  openModal('🎒 Ajouter au stash MJ', `
    <div style="margin-bottom:.5rem">
      <input type="text" placeholder="🔍 Rechercher…" oninput="window._vttLootShopSearch(this.value)"
        style="width:100%;padding:.4rem .7rem;border-radius:8px;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text);font-size:.85rem;box-sizing:border-box">
    </div>
    <div id="vtt-shop-list" style="max-height:340px;overflow-y:auto;display:flex;flex-direction:column;gap:2px"></div>`,
  );
  setTimeout(() => render(), 50);
};

// Joueur : choisir la quantité qu'il prend
window._vttLootPickQty = (id) => {
  const item = _loot.loot.find(i => i.id === id);
  if (!item) return;
  const uid  = STATE.user?.uid;
  const myChars = Object.values(_characters).filter(c => c.uid === uid);
  if (!myChars.length) { showNotif('Aucun personnage trouvé', 'error'); return; }

  const charOptions = myChars.map(c =>
    `<option value="${c.id}">${_esc(c.nom || c.pseudo || '?')}</option>`).join('');

  openModal(`Prendre — ${_esc(item.nom)}`, `
    <div style="display:flex;flex-direction:column;gap:.7rem;padding:.3rem 0">
      ${myChars.length > 1 ? `
        <div>
          <label style="font-size:.83rem;color:var(--text-muted);display:block;margin-bottom:.3rem">Personnage</label>
          <select id="vtt-take-char" style="width:100%;padding:.35rem .6rem;border-radius:8px;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text);font-size:.85rem">
            ${charOptions}
          </select>
        </div>` : `<input type="hidden" id="vtt-take-char" value="${myChars[0].id}">`}
      <div>
        <label style="font-size:.83rem;color:var(--text-muted);display:block;margin-bottom:.3rem">Quantité (max ${item.qty})</label>
        <input id="vtt-take-qty" type="number" min="1" max="${item.qty}" value="1"
          style="width:80px;padding:.35rem .6rem;border-radius:8px;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text);font-size:.9rem">
      </div>
      <button class="btn-primary" onclick="window._vttLootConfirmTake('${id}')">Prendre</button>
    </div>`);
};

window._vttLootConfirmTake = async (id) => {
  const item    = _loot.loot.find(i => i.id === id);
  if (!item) return;
  const charId  = document.getElementById('vtt-take-char')?.value;
  const qty     = Math.min(item.qty, Math.max(1, parseInt(document.getElementById('vtt-take-qty')?.value) || 1));
  const char    = _characters[charId];
  if (!char || !charId) { showNotif('Personnage introuvable', 'error'); return; }

  const inv = Array.isArray(char.inventaire) ? [...char.inventaire] : [];
  for (let k = 0; k < qty; k++) {
    inv.push({
      nom: item.nom, source: 'butin', itemId: item.itemId || '',
      categorieId: item.categorieId || '', template: item.template || 'classique',
      qte: '1', prixAchat: item.prixAchat || 0, prixVente: item.prixVente || 0,
      format: item.format || '', rarete: item.rarete || '',
      degats: item.degats || '', degatsStat: item.degatsStat || '',
      degatsStats: item.degatsStats || [], toucherStat: item.toucherStat || '',
      ca: item.ca || '', effet: item.effet || '', description: item.description || '',
      slotArmure: item.slotArmure || '', typeArmure: item.typeArmure || '',
      slotBijou: item.slotBijou || '', sousType: item.sousType || '',
      portee: item.portee || '', traits: Array.isArray(item.traits) ? [...item.traits] : [],
      fo: (item.fo ?? item.for) || 0, for: (item.for ?? item.fo) || 0,
      dex: item.dex||0, in: item.in||0,
      sa: item.sa||0, co: item.co||0, ch: item.ch||0,
    });
  }

  // Réduire ou retirer du butin
  if (item.qty - qty <= 0) {
    _loot.loot = _loot.loot.filter(i => i.id !== id);
  } else {
    item.qty -= qty;
  }

  try {
    await Promise.all([
      updateDoc(_chrRef(charId), { inventaire: inv }),
      _saveLoot(),
    ]);
    char.inventaire = inv;
    closeModalDirect();
    showNotif(`×${qty} "${item.nom}" envoyé dans l'inventaire de ${_esc(char.nom || char.pseudo || '?')} !`, 'success');
  } catch { showNotif('Erreur lors de la prise du butin', 'error'); }
};

// ═══════════════════════════════════════════════════════════════════
// LANCEUR DE DÉS LIBRE
// ═══════════════════════════════════════════════════════════════════
const _ALL_DICE = [4, 6, 8, 10, 12, 20, 100];

function _closeDicePanel() {
  const panel = document.getElementById('vtt-dice-panel');
  const btn   = document.getElementById('vtt-dice-trigger');
  if (panel) { panel.dataset.open='0'; panel.style.display='none'; }
  btn?.classList.remove('active');
  if (_diceCloseOut) { document.removeEventListener('mousedown', _diceCloseOut, true); _diceCloseOut=null; }
}

window._vttToggleDice = () => {
  const panel = document.getElementById('vtt-dice-panel'); if (!panel) return;
  if (panel.dataset.open==='1') { _closeDicePanel(); return; }
  panel.dataset.open='1'; panel.style.display='flex';
  document.getElementById('vtt-dice-trigger')?.classList.add('active');
  _renderDicePanel();
  _diceCloseOut = e => { const f=document.querySelector('.vtt-dice-float'); if(f&&!f.contains(e.target)) _closeDicePanel(); };
  document.addEventListener('mousedown', _diceCloseOut, true);
};

window._vttDiceAddDie    = f => { _diceFormula[f]=(_diceFormula[f]||0)+1; _renderDicePanel(); };
window._vttDiceRemoveDie = f => { if(_diceFormula[f]>1) _diceFormula[f]--; else delete _diceFormula[f]; _renderDicePanel(); };
window._vttDiceClear     = () => { _diceFormula={}; _diceFreeBonus=0; _renderDicePanel(); };
window._vttDiceBonusStep = d => { _diceFreeBonus=(_diceFreeBonus||0)+d; _renderDicePanel(); };
window._vttDiceBonusSet  = v => { _diceFreeBonus=isNaN(v)?0:+v; };
window._vttDiceMode      = m => { _diceFreeMode=m; _renderDicePanel(); };

function _renderDicePanel() {
  const el = document.getElementById('vtt-dice-panel'); if (!el) return;
  const faces = Object.keys(_diceFormula).map(Number).sort((a,b)=>b-a);
  const hasDice = faces.some(f => _diceFormula[f]>0);
  const hasD20single = _diceFormula[20]===1;

  // Formule lisible
  const fmtParts = faces.map(f=>`${_diceFormula[f]}d${f===100?'%':f}`);
  if (_diceFreeBonus>0) fmtParts.push(`+${_diceFreeBonus}`);
  else if (_diceFreeBonus<0) fmtParts.push(String(_diceFreeBonus));
  const formulaStr = fmtParts.join(' + ') || '—';

  el.innerHTML = `
    <div class="vtt-dice-hd">
      <span>🎲 Lancer des dés</span>
      <button class="vtt-icon-btn" onclick="window._vttToggleDice()" title="Fermer">✕</button>
    </div>
    <div class="vtt-dice-grid">
      ${_ALL_DICE.map(f => {
        const cnt = _diceFormula[f]||0;
        return `<button class="vtt-dice-die-btn${cnt?' active':''}"
          onclick="window._vttDiceAddDie(${f})"
          oncontextmenu="event.preventDefault();window._vttDiceRemoveDie(${f})"
          title="Clic : ajouter · Clic droit : retirer">
          d${f===100?'%':f}${cnt?`<span class="vtt-dice-die-cnt">×${cnt}</span>`:''}
        </button>`;
      }).join('')}
    </div>
    <div class="vtt-dice-formula-row">
      <code class="vtt-dice-formula-str">${formulaStr}</code>
      ${hasDice?`<button class="vtt-dice-clear-btn" onclick="window._vttDiceClear()">✕</button>`:''}
    </div>
    <div class="vtt-dice-bonus-row">
      <span class="vtt-dice-bonus-lbl">Bonus</span>
      <button class="vtt-icon-btn" onclick="window._vttDiceBonusStep(-1)">−</button>
      <input id="vtt-dice-bonus-inp" type="number" class="vtt-dice-bonus-inp" value="${_diceFreeBonus}"
        oninput="window._vttDiceBonusSet(+this.value)">
      <button class="vtt-icon-btn" onclick="window._vttDiceBonusStep(+1)">＋</button>
    </div>
    ${hasD20single ? `<div class="vtt-dice-mode-row">
      <button class="vtt-roll-mode-btn${_diceFreeMode==='disadvantage'?' active':''}" onclick="window._vttDiceMode('disadvantage')">⬇ Désav.</button>
      <button class="vtt-roll-mode-btn${_diceFreeMode==='normal'?' active':''}" onclick="window._vttDiceMode('normal')">⚪ Normal</button>
      <button class="vtt-roll-mode-btn${_diceFreeMode==='advantage'?' active':''}" onclick="window._vttDiceMode('advantage')">⬆ Avantage</button>
    </div>` : ''}
    <button class="vtt-dice-roll-btn" onclick="window._vttDiceRoll()"
      ${!hasDice&&!_diceFreeBonus?'disabled':''}>
      🎲 Lancer !
    </button>`;
}

window._vttDiceRoll = () => {
  const faces = Object.keys(_diceFormula).map(Number).sort((a,b)=>b-a);
  if (!faces.length && !_diceFreeBonus) return;
  const authorName = STATE.profile?.pseudo||STATE.profile?.prenom||STATE.user?.displayName||'Joueur';

  const groups = [];
  let total = 0;
  for (const f of faces) {
    const count = _diceFormula[f]; if (!count) continue;
    const rolls = []; let subtotal = 0;
    let kept;
    if (f===20 && count===1 && _diceFreeMode!=='normal') {
      const r1=Math.floor(Math.random()*20)+1, r2=Math.floor(Math.random()*20)+1;
      kept = _diceFreeMode==='advantage' ? Math.max(r1,r2) : Math.min(r1,r2);
      rolls.push(r1,r2); subtotal=kept;
    } else {
      for(let i=0;i<count;i++){ const r=Math.floor(Math.random()*f)+1; rolls.push(r); subtotal+=r; }
    }
    const g = { faces:f, count, rolls, subtotal };
    if (kept !== undefined) g.kept = kept;
    groups.push(g);
    total += subtotal;
  }
  total += (_diceFreeBonus||0);

  const fmtParts = faces.map(f=>`${_diceFormula[f]}d${f===100?'%':f}`);
  if (_diceFreeBonus>0) fmtParts.push(`+${_diceFreeBonus}`);
  else if (_diceFreeBonus<0) fmtParts.push(String(_diceFreeBonus));
  const formula = fmtParts.join('+');

  addDoc(_logCol(), {
    type:'dice-free', authorId:STATE.user?.uid||null, authorName,
    formula, groups, bonus:_diceFreeBonus||0, mode:_diceFreeMode, total,
    createdAt:serverTimestamp(),
  }).catch(()=>{});
  showNotif(`🎲 ${formula} = ${total}`, 'success');
  _closeDicePanel();
};

// ═══════════════════════════════════════════════════════════════════
// MUSIQUE / SONS
// ═══════════════════════════════════════════════════════════════════

function _closeMusicPanel() {
  const panel = document.getElementById('vtt-music-panel');
  if (panel) { panel.dataset.open='0'; panel.style.display='none'; }
  document.getElementById('vtt-music-trigger')?.classList.remove('active');
  if (_musicCloseOut) { document.removeEventListener('mousedown', _musicCloseOut, true); _musicCloseOut=null; }
  clearInterval(_musicProgTimer); _musicProgTimer=null;
  _musicSortables.forEach(s => s.destroy()); _musicSortables=[];
  _stopPreview();
}

function _stopPreview() {
  if (_previewEl) { _previewEl.pause(); _previewEl.src=''; _previewEl=null; }
  document.querySelectorAll('.vtt-mact-preview.on').forEach(b => b.classList.remove('on'));
}

// Préférence de volume locale à chaque utilisateur, persistée entre sessions
// pour ne pas être réinitialisée à chaque nouvelle musique.
const _USER_VOL_KEY = 'vtt:musicVolume';
function _getUserVolume() {
  const v = parseFloat(localStorage.getItem(_USER_VOL_KEY));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.7;
}
function _setUserVolume(v) {
  const clamped = Math.max(0, Math.min(1, v));
  try { localStorage.setItem(_USER_VOL_KEY, String(clamped)); } catch(e){}
  return clamped;
}

window._vttPreview = (soundId, btn) => {
  const sound = _sounds.find(s=>s.id===soundId); if (!sound) return;
  // Même son → stop
  if (_previewEl && _previewEl.dataset.soundId===soundId) { _stopPreview(); return; }
  _stopPreview();
  const el = new Audio(sound.url);
  el.dataset.soundId = soundId;
  el.volume = _getUserVolume();
  el.addEventListener('ended', _stopPreview);
  el.play().catch(() => showNotif('Impossible de lire ce son', 'error'));
  _previewEl = el;
  btn?.classList.add('on');
};

window._vttToggleMusic = () => {
  const panel = document.getElementById('vtt-music-panel'); if (!panel) return;
  if (panel.dataset.open==='1') { _closeMusicPanel(); return; }
  panel.dataset.open='1'; panel.style.display='flex';
  document.getElementById('vtt-music-trigger')?.classList.add('active');
  _renderMusicPanel();
  _musicCloseOut = e => {
    const f = document.querySelector('.vtt-music-float');
    const ctx = document.getElementById('vtt-ctx-menu');
    if (f && !f.contains(e.target) && !ctx?.contains(e.target)) _closeMusicPanel();
  };
  document.addEventListener('mousedown', _musicCloseOut, true);
};

window._vttMusicTab = t => { _musicTab=t; _renderMusicPanel(); };

// ── Rendu du panel ──────────────────────────────────────────────────
function _renderMusicPanel() {
  const panel = document.getElementById('vtt-music-panel'); if (!panel) return;
  const mj = STATE.isAdmin;
  const ms = _musicState;
  const playing = !!(ms.playing && ms.currentSoundId);
  const curSound = playing ? _sounds.find(s=>s.id===ms.currentSoundId) : null;

  // Joueurs : panel minimal — uniquement en lecture + volume
  if (!mj) {
    panel.innerHTML = `
      <div class="vtt-music-hd">
        <span>🎵 Musique</span>
        <button class="vtt-ms-close" onclick="window._vttToggleMusic()">✕</button>
      </div>
      ${_renderNowPlaying(curSound, ms)}`;
  } else {
    panel.innerHTML = `
      <div class="vtt-music-hd">
        <span>🎵 Sons &amp; Musique</span>
        <button class="vtt-ms-close" onclick="window._vttToggleMusic()">✕</button>
      </div>
      <div class="vtt-music-tabs">
        <button class="vtt-music-tab${_musicTab==='sons'?' active':''}" onclick="window._vttMusicTab('sons')">Sons</button>
        <button class="vtt-music-tab${_musicTab==='playlists'?' active':''}" onclick="window._vttMusicTab('playlists')">Playlists</button>
      </div>
      <div class="vtt-music-body">${_musicTab==='sons' ? _renderSonsTab(mj) : _renderPlaylistsTab(mj)}</div>
      ${_renderNowPlaying(curSound, ms)}`;
  }

  // Bind champ de recherche — état persisté par onglet
  const sf = panel.querySelector('#vtt-music-search');
  if (sf) {
    sf.value = _musicSearch[_musicTab] || '';
    sf.oninput = e => {
      _musicSearch[_musicTab] = e.target.value;
      _applyMusicFilter(e.target.value, _musicTab);
    };
    if (sf.value) _applyMusicFilter(sf.value, _musicTab);
  }
  // Bind volume slider local — préférence par utilisateur (localStorage)
  const vsl = panel.querySelector('#vtt-music-vol');
  if (vsl) {
    vsl.value = Math.round(_getUserVolume() * 100);
    vsl.oninput = e => {
      const v = _setUserVolume(+e.target.value / 100);
      if (_audioEl)   _audioEl.volume = v;
      if (_previewEl) _previewEl.volume = v;
    };
  }
  // Barre de progression
  clearInterval(_musicProgTimer);
  if (_audioEl && !_audioEl.paused) {
    _musicProgTimer = setInterval(_updateMusicProg, 500);
  }
  // Sortables (MJ + onglet playlists uniquement)
  if (mj && _musicTab === 'playlists') _initMusicSortable();
}

function _updateMusicProg() {
  if (!_audioEl) return;
  const fill = document.getElementById('vtt-music-prog-fill');
  const time = document.getElementById('vtt-music-prog-time');
  const d = _audioEl.duration || 0;
  const c = _audioEl.currentTime || 0;
  if (fill) fill.style.width = d ? `${(c/d)*100}%` : '0%';
  if (time) time.textContent = `${_fmtTime(c)} / ${_fmtTime(d)}`;
}

function _fmtTime(s) {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s/60), sec = Math.floor(s%60);
  return `${m}:${String(sec).padStart(2,'0')}`;
}

function _musicSearchInput(placeholder) {
  return `<div class="vtt-music-search-row">
    <input type="search" id="vtt-music-search" class="vtt-music-search"
      placeholder="${placeholder}" autocomplete="off">
  </div>`;
}

// Filtre les éléments du panel à l'aide des classes existantes — pas de re-render
// pour préserver le focus du champ et l'état des Sortable.
function _applyMusicFilter(query, tab) {
  const q = (query || '').trim().toLowerCase();
  const root = document.querySelector('.vtt-music-body'); if (!root) return;
  const match = el => (el?.textContent || '').toLowerCase().includes(q);

  if (tab === 'sons') {
    root.querySelectorAll('.vtt-music-son-item').forEach(el => {
      el.hidden = q && !match(el.querySelector('.vtt-music-son-name'));
    });
    return;
  }
  // Playlists : pool + playlists (avec filtrage des sons internes)
  root.querySelectorAll('.vtt-music-pool-item').forEach(el => {
    el.hidden = q && !match(el.querySelector('.vtt-music-pool-name'));
  });
  root.querySelectorAll('.vtt-music-pl-item').forEach(pl => {
    const plMatch = !q || match(pl.querySelector('.vtt-music-pl-name'));
    const sounds = pl.querySelectorAll('.vtt-music-pl-sound');
    if (plMatch) {
      pl.hidden = false;
      sounds.forEach(s => { s.hidden = false; });
      return;
    }
    let anyMatch = false;
    sounds.forEach(s => {
      const ok = match(s.querySelector('.vtt-music-pl-sname'));
      s.hidden = !ok; if (ok) anyMatch = true;
    });
    pl.hidden = !anyMatch;
  });
}

function _renderSonsTab(mj) {
  let h = _musicSearchInput('🔍 Rechercher un son…');
  if (mj) h += `
    <div class="vtt-music-son-actions-row">
      <button class="vtt-music-upload-btn" onclick="window._vttAddSonUrl()" style="flex:1">＋ URL</button>
      <button class="vtt-music-upload-btn" onclick="window._vttImportGithubRelease()" style="flex:2">📥 Importer depuis GitHub</button>
    </div>`;
  if (!_sounds.length) return h + `<div class="vtt-music-empty">Aucun son — ajoutez une URL ou importez depuis GitHub</div>`;
  return h + `<div class="vtt-music-list">${_sounds.map(s => {
    const active = _musicState.playing && _musicState.currentSoundId===s.id && !_musicState.currentPlaylistId;
    return `<div class="vtt-music-son-item${active?' is-playing':''}">
      <span class="vtt-music-son-name" title="${_esc(s.name)}">${_esc(s.name)}</span>
      <div class="vtt-music-son-acts">
        <button class="vtt-mact${active&&!_musicState.loop?' on':''}" onclick="window._vttPlaySound('${s.id}',false)" title="Lire">${active&&!_musicState.paused&&!_musicState.loop?'⏸':'▶'}</button>
        <button class="vtt-mact${active&&_musicState.loop?' on':''}" onclick="window._vttPlaySound('${s.id}',true)" title="Boucle">🔁</button>
        ${mj?`<button class="vtt-mact vtt-mact-del" onclick="window._vttDeleteSound('${s.id}')" title="Supprimer">🗑</button>`:''}
      </div>
    </div>`;
  }).join('')}</div>`;
}

function _renderPlaylistsTab(mj) {
  let h = _musicSearchInput('🔍 Rechercher une playlist ou un son…');
  if (mj) h += `<button class="vtt-music-upload-btn" onclick="window._vttCreatePlaylist()">＋ Nouvelle playlist</button>`;

  // Pool — sons non encore placés dans une playlist
  if (mj) {
    const usedIds = new Set(_playlists.flatMap(pl => pl.soundIds || []));
    const poolSounds = _sounds.filter(s => !usedIds.has(s.id));
    if (poolSounds.length) {
      h += `<div class="vtt-music-pool-hd">📦 Non classés (${poolSounds.length})</div>
      <div class="vtt-music-pool" id="vtt-music-pool">
        ${poolSounds.map(s=>`<div class="vtt-music-pool-item" data-sound-id="${s.id}" title="${_esc(s.name)}" oncontextmenu="event.preventDefault();window._vttSoundCtxMenu(event,'${s.id}')">
          <span class="vtt-music-pool-grip">⠿</span>
          <span class="vtt-music-pool-name">${_esc(s.name)}</span>
          <button class="vtt-mact vtt-mact-preview" onclick="event.stopPropagation();window._vttPreview('${s.id}',this)" title="Aperçu">🎧</button>
        </div>`).join('')}
      </div>`;
    } else if (_sounds.length) {
      h += `<div class="vtt-music-pool-hd">📦 Non classés</div>
      <div class="vtt-music-empty" style="padding:.3rem .5rem">Tous les sons sont classés ✓</div>`;
    } else {
      h += `<div class="vtt-music-empty">Aucun son — ajoutez-en dans l'onglet Sons</div>`;
    }
  }

  if (!_playlists.length) return h + `<div class="vtt-music-empty" style="margin-top:.4rem">Aucune playlist</div>`;

  h += _playlists.map(pl => {
    const active = _musicState.playing && _musicState.currentPlaylistId===pl.id;
    const sounds = (pl.soundIds||[]).map(sid=>_sounds.find(s=>s.id===sid)).filter(Boolean);
    return `<div class="vtt-music-pl-item${active?' is-playing':''}">
      <div class="vtt-music-pl-hd">
        <span class="vtt-music-pl-dot" style="background:${pl.color||'#6366f1'}"></span>
        <span class="vtt-music-pl-name">${_esc(pl.name)}</span>
        <span class="vtt-music-pl-cnt">${sounds.length}</span>
        <div class="vtt-music-son-acts">
          <button class="vtt-mact${active&&!_musicState.shuffle?' on':''}" onclick="window._vttPlayPlaylist('${pl.id}',false)" title="Lire en ordre">▶</button>
          <button class="vtt-mact${active&&_musicState.shuffle?' on':''}" onclick="window._vttPlayPlaylist('${pl.id}',true)" title="Aléatoire">🔀</button>
          ${mj?`<button class="vtt-mact vtt-mact-del" onclick="window._vttDeletePlaylist('${pl.id}')" title="Supprimer">🗑</button>`:''}
        </div>
      </div>
      <div class="vtt-music-pl-sounds vtt-pl-drop" id="vtt-pl-drop-${pl.id}" data-pl-id="${pl.id}">
        ${sounds.map(s=>`<div class="vtt-music-pl-sound" data-sound-id="${s.id}" ${mj?`oncontextmenu="event.preventDefault();window._vttSoundCtxMenu(event,'${s.id}','${pl.id}')"`:''}">
          ${mj?'<span class="vtt-music-pool-grip">⠿</span>':''}
          <span class="vtt-music-pl-sname">${_esc(s.name)}</span>
          <button class="vtt-mact vtt-mact-preview" onclick="event.stopPropagation();window._vttPreview('${s.id}',this)" title="Aperçu">🎧</button>
          ${mj?`<button class="vtt-mact vtt-mact-del" onclick="window._vttRemoveSoundFromPlaylist('${pl.id}','${s.id}')" title="Retirer">✕</button>`:''}
        </div>`).join('')}
        ${!sounds.length?`<div class="vtt-music-pl-empty-drop">Glisser des sons ici</div>`:''}
      </div>
    </div>`;
  }).join('');
  return h;
}

// ── Initialisation Sortable ────────────────────────────────────────
function _initMusicSortable() {
  _musicSortables.forEach(s => s.destroy()); _musicSortables = [];

  const pool = document.getElementById('vtt-music-pool');
  if (pool) {
    _musicSortables.push(new Sortable(pool, {
      group: { name: 'vtt-sounds', pull: 'clone', put: false },
      sort: false,
      animation: 120,
      ghostClass: 'vtt-sort-ghost',
    }));
  }

  document.querySelectorAll('.vtt-pl-drop').forEach(el => {
    const plId = el.dataset.plId;
    _musicSortables.push(new Sortable(el, {
      group: { name: 'vtt-sounds', pull: false, put: true },
      animation: 120,
      ghostClass: 'vtt-sort-ghost',
      filter: '.vtt-music-pl-empty-drop,.vtt-mact',
      onAdd: async evt => {
        const soundId = evt.item.dataset.soundId;
        evt.item.remove(); // Sortable a cloné → on supprime, Firestore va re-render
        const pl = _playlists.find(p=>p.id===plId); if (!pl||!soundId) return;
        if ((pl.soundIds||[]).includes(soundId)) return;
        await updateDoc(_playlistRef(plId), { soundIds:[...(pl.soundIds||[]), soundId] }).catch(()=>{});
      },
      onUpdate: async evt => {
        const pl = _playlists.find(p=>p.id===plId); if (!pl) return;
        const items = [...el.querySelectorAll('[data-sound-id]')];
        const newOrder = items.map(i=>i.dataset.soundId).filter(Boolean);
        await updateDoc(_playlistRef(plId), { soundIds: newOrder }).catch(()=>{});
      },
    }));
  });
}

function _renderNowPlaying(curSound, ms) {
  const mj = STATE.isAdmin;
  const pl = ms.currentPlaylistId ? _playlists.find(p=>p.id===ms.currentPlaylistId) : null;
  return `<div class="vtt-music-np">
    <div class="vtt-music-np-name">${curSound
      ? `🎵 ${_esc(curSound.name)}${pl?` · <em>${_esc(pl.name)}</em>`:''}${ms.loop?' 🔁':''}${ms.shuffle?' 🔀':''}`
      : '<span style="color:var(--text-dim)">— Rien en lecture —</span>'
    }</div>
    ${curSound ? `<div class="vtt-music-prog-row">
      <div class="vtt-music-prog-bar"${mj?' onclick="window._vttSeek(event,this)"':''} style="${mj?'':'cursor:default'}">
        <div class="vtt-music-prog-fill" id="vtt-music-prog-fill" style="width:0%"></div>
      </div>
      <span class="vtt-music-prog-time" id="vtt-music-prog-time">0:00 / 0:00</span>
    </div>` : ''}
    <div class="vtt-music-ctrl-row">
      ${mj && curSound ? `
        <button class="vtt-music-ctrl" onclick="window._vttToggleMusicPause()" title="${ms.paused?'Reprendre':'Pause'}">${ms.paused?'▶':'⏸'}</button>
        ${pl?`<button class="vtt-music-ctrl" onclick="window._vttMusicNext()" title="Suivant">⏭</button>`:''}
        <button class="vtt-music-ctrl" onclick="window._vttStopMusic()" title="Arrêter">⏹</button>
      ` : ''}
      <label class="vtt-music-vol-lbl">🔊<input type="range" id="vtt-music-vol" class="vtt-music-vol-inp" min="0" max="100" step="1"></label>
    </div>
  </div>`;
}

// ── Seek sur clic barre de progression ─────────────────────────────
window._vttSeek = (e, bar) => {
  if (!_audioEl || !_audioEl.duration) return;
  const rect = bar.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  _audioEl.currentTime = ratio * _audioEl.duration;
  _updateMusicProg();
};

// ── Lecture / contrôles ─────────────────────────────────────────────
window._vttPlaySound = async (soundId, loop) => {
  const ms = _musicState;
  // Toggle si même son sans playlist
  if (ms.playing && ms.currentSoundId===soundId && !ms.currentPlaylistId && !!ms.loop===!!loop)
    return window._vttStopMusic();
  await _setMusicState({ playing:true, paused:false, currentSoundId:soundId,
    currentPlaylistId:null, loop:!!loop, shuffle:false,
    startedAt:serverTimestamp() });
};

window._vttPlayPlaylist = async (playlistId, shuffle) => {
  const pl = _playlists.find(p=>p.id===playlistId);
  if (!pl || !pl.soundIds?.length) return;
  const ms = _musicState;
  // Toggle si même playlist + même mode
  if (ms.playing && ms.currentPlaylistId===playlistId && !!ms.shuffle===!!shuffle)
    return window._vttStopMusic();
  // Ordre (Fisher-Yates si shuffle)
  const order = pl.soundIds.map((_,i)=>i);
  if (shuffle) {
    for (let i=order.length-1;i>0;i--) {
      const j=Math.floor(Math.random()*(i+1));
      [order[i],order[j]]=[order[j],order[i]];
    }
  }
  await _setMusicState({ playing:true, paused:false,
    currentSoundId:pl.soundIds[order[0]], currentPlaylistId:playlistId,
    loop:false, shuffle:!!shuffle, shuffleOrder:order, playlistIndex:0,
    startedAt:serverTimestamp() });
};

window._vttMusicNext = async () => {
  const ms = _musicState;
  if (!ms.currentPlaylistId) return;
  const pl = _playlists.find(p=>p.id===ms.currentPlaylistId); if (!pl) return;
  const order = ms.shuffleOrder || pl.soundIds.map((_,i)=>i);
  const nextIdx = ((ms.playlistIndex||0) + 1) % order.length;
  await _setMusicState({ ...ms, playlistIndex:nextIdx,
    currentSoundId:pl.soundIds[order[nextIdx]], startedAt:serverTimestamp() });
};

window._vttToggleMusicPause = async () => {
  const paused = !_musicState.paused;
  if (_audioEl) { paused ? _audioEl.pause() : _audioEl.play().catch(()=>{}); }
  await _setMusicState({ ..._musicState, paused });
};

window._vttStopMusic = async () => {
  _killAudio();
  await _setMusicState({ playing:false, paused:false, currentSoundId:null, currentPlaylistId:null });
};

function _killAudio() {
  if (_audioEl) {
    _audioEl.pause();
    if (_audioEl._endedHandler)  _audioEl.removeEventListener('ended', _audioEl._endedHandler);
    if (_audioEl._errorHandler)  _audioEl.removeEventListener('error', _audioEl._errorHandler);
    _audioEl.src=''; _audioEl=null;
  }
  clearInterval(_musicProgTimer); _musicProgTimer=null;
}

async function _setMusicState(patch) {
  if (!_aid()) return;
  await setDoc(_musicStateRef(), patch, {merge:true}).catch(()=>{});
}

// ── Sync lecture ────────────────────────────────────────────────────
function _syncMusicPlayback(ms) {
  _musicState = ms;
  const panel = document.getElementById('vtt-music-panel');

  if (!ms.playing || !ms.currentSoundId) {
    _killAudio();
    if (panel?.dataset.open==='1') _renderMusicPanel();
    return;
  }

  if (ms.paused) {
    if (_audioEl && !_audioEl.paused) _audioEl.pause();
    if (panel?.dataset.open==='1') _renderMusicPanel();
    return;
  }

  const sound = _sounds.find(s=>s.id===ms.currentSoundId);
  if (!sound) { if (panel?.dataset.open==='1') _renderMusicPanel(); return; }

  // Même son déjà en lecture → pas de restart
  if (_audioEl && _audioEl.dataset.soundId===ms.currentSoundId && !_audioEl.paused && !_audioEl.ended) {
    _audioEl.loop = ms.loop ?? false;
    if (panel?.dataset.open==='1') _renderMusicPanel();
    return;
  }

  // Nouveau son
  _killAudio();
  const el = new Audio(sound.url);
  el.dataset.soundId = ms.currentSoundId;
  el.volume = _getUserVolume();
  el.loop = ms.loop ?? false;

  // Sync temps (non-loop uniquement)
  if (ms.startedAt && !ms.loop) {
    el.addEventListener('loadedmetadata', () => {
      const elapsed = (Date.now() - (ms.startedAt?.toMillis?.() ?? Date.now())) / 1000;
      if (elapsed < el.duration - 0.5) el.currentTime = elapsed;
    }, {once:true});
  }

  // Auto-avance playlist (MJ uniquement pour éviter les doublons)
  if (ms.currentPlaylistId && STATE.isAdmin) {
    el._endedHandler = () => window._vttMusicNext();
    el.addEventListener('ended', el._endedHandler);
  }

  // Erreur de chargement (URL inaccessible, format non supporté…)
  el._errorHandler = () => {
    const codes = {1:'Chargement interrompu', 2:'Erreur réseau', 3:'Décodage impossible', 4:'URL inaccessible'};
    const msg = codes[el.error?.code] ?? 'Erreur audio inconnue';
    console.error('[vtt music] audio error:', el.error?.code, el.error?.message, sound.url);
    showNotif(`🔇 ${msg} — vérifier l'URL du son`, 'error');
    _killAudio();
    if (document.getElementById('vtt-music-panel')?.dataset.open==='1') _renderMusicPanel();
  };
  el.addEventListener('error', el._errorHandler, {once:true});

  // Démarre le timer de progression seulement quand les métadonnées sont chargées
  el.addEventListener('loadedmetadata', () => {
    _updateMusicProg();
    if (!_musicProgTimer) _musicProgTimer = setInterval(_updateMusicProg, 500);
  }, {once:true});

  el.play().catch(err => {
    if (err.name === 'NotAllowedError')
      showNotif('🔇 Cliquez sur la page pour activer le son', 'info');
    else
      console.error('[vtt music] play() error:', err.name, err.message);
  });
  _audioEl = el;
  if (panel?.dataset.open==='1') _renderMusicPanel();
}

// ── Menu contextuel son ──────────────────────────────────────────────
// currentPlId : playlist d'où vient le clic (undefined = pool)
window._vttSoundCtxMenu = (e, soundId, currentPlId) => {
  if (!_playlists.length) return;
  const sound = _sounds.find(s=>s.id===soundId); if (!sound) return;

  const items = [];

  // Playlists cibles (exclut celle d'où il vient s'il y est déjà)
  const targets = _playlists.filter(pl =>
    pl.id !== currentPlId && !(pl.soundIds||[]).includes(soundId)
  );
  if (targets.length) {
    items.push({ label: `<span style="color:var(--text-dim);font-size:.65rem">Ajouter à…</span>`, fn: null });
    targets.forEach(pl => items.push({
      label: `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${pl.color||'#6366f1'};margin-right:.4rem"></span>${_esc(pl.name)}`,
      fn: () => window._vttAddSoundToPlaylist(pl.id, soundId),
    }));
  }

  // Retirer de la playlist courante
  if (currentPlId) {
    if (items.length) items.push('---');
    items.push({ label: '✕ Retirer de cette playlist', fn: () => window._vttRemoveSoundFromPlaylist(currentPlId, soundId) });
  }

  if (items.length) _showCtxMenu(e.clientX, e.clientY, items);
};

// ── Import GitHub Release ────────────────────────────────────────────
window._vttImportGithubRelease = async () => {
  const LS_REPO = 'vtt-music-gh-repo', LS_TAG = 'vtt-music-gh-tag';
  const defRepo = localStorage.getItem(LS_REPO) || 'ConseillerDoriantation/le-grand-jdr';
  const defTag  = localStorage.getItem(LS_TAG)  || 'sounds-v1';
  const repo = prompt('Repo GitHub (owner/repo) :', defRepo)?.trim(); if (!repo) return;
  const tag  = prompt('Tag de la release :', defTag)?.trim();          if (!tag)  return;
  localStorage.setItem(LS_REPO, repo); localStorage.setItem(LS_TAG, tag);

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`);
    if (!res.ok) { showNotif(`Release introuvable (${res.status})`, 'error'); return; }
    const data = await res.json();
    const audioExts = /\.(mp3|ogg|wav|flac|m4a|aac)$/i;
    const assets = (data.assets||[]).filter(a => audioExts.test(a.name));
    if (!assets.length) { showNotif('Aucun fichier audio dans cette release', 'info'); return; }

    const existingUrls = new Set(_sounds.map(s => s.url));
    const newAssets = assets.filter(a => !existingUrls.has(a.browser_download_url));
    if (!newAssets.length) { showNotif('Tous ces sons sont déjà importés', 'info'); return; }

    for (const a of newAssets) {
      const name = a.name.replace(/\.[^.]+$/, '').replace(/[._-]+/g, ' ').trim();
      await addDoc(_sonsCol(), { name, url: a.browser_download_url, createdAt: serverTimestamp(), addedBy: STATE.user?.uid||null });
    }
    showNotif(`✅ ${newAssets.length} son(s) importé(s)`, 'success');
  } catch(e) {
    console.error('[vtt music] github import:', e);
    showNotif('Erreur lors de l\'import GitHub', 'error');
  }
};

// ── Ajout d'un son par URL ───────────────────────────────────────────
window._vttAddSonUrl = async () => {
  const url  = prompt('URL directe du fichier audio (mp3, ogg, wav…) :')?.trim();
  if (!url) return;
  const name = prompt('Nom du son :', url.split('/').pop()?.replace(/\.[^.]+$/,'') || 'Son')?.trim();
  if (!name) return;
  await addDoc(_sonsCol(), { name, url, createdAt:serverTimestamp(), addedBy:STATE.user?.uid||null });
  showNotif(`✅ "${name}" ajouté`, 'success');
};

window._vttDeleteSound = async soundId => {
  const s = _sounds.find(x=>x.id===soundId); if (!s) return;
  if (!await confirmModal(`Supprimer "${s.name}" ?`)) return;
  if (_musicState.currentSoundId===soundId) await window._vttStopMusic();
  for (const pl of _playlists.filter(p=>(p.soundIds||[]).includes(soundId)))
    await updateDoc(_playlistRef(pl.id), { soundIds:(pl.soundIds||[]).filter(id=>id!==soundId) }).catch(()=>{});
  await deleteDoc(_sonRef(soundId)).catch(()=>{});
};

// ── Playlists ───────────────────────────────────────────────────────
window._vttCreatePlaylist = () => {
  const colors = ['#6366f1','#22c38e','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899'];
  const defColor = colors[_playlists.length % colors.length];
  openModal('Nouvelle playlist', `
    <div style="display:flex;flex-direction:column;gap:.9rem">
      <div>
        <label class="vtt-pl-modal-lbl">Nom</label>
        <input id="vtt-pl-name-inp" type="text" class="vtt-pl-modal-inp"
          placeholder="Ex : Donjon, Combat, Ambiance…"
          onkeydown="if(event.key==='Enter')window._vttCreatePlaylistConfirm()">
      </div>
      <div>
        <label class="vtt-pl-modal-lbl">Couleur</label>
        <div class="vtt-pl-color-row">
          ${colors.map(c=>`<button type="button" class="vtt-pl-color-btn${c===defColor?' sel':''}"
            data-color="${c}" style="background:${c}"
            onclick="document.querySelectorAll('.vtt-pl-color-btn').forEach(b=>b.classList.remove('sel'));this.classList.add('sel')">
          </button>`).join('')}
        </div>
      </div>
      <button class="vtt-pl-modal-submit" onclick="window._vttCreatePlaylistConfirm()">Créer la playlist</button>
    </div>`);
  setTimeout(() => { document.getElementById('vtt-pl-name-inp')?.focus(); }, 60);
};

window._vttCreatePlaylistConfirm = async () => {
  const name  = document.getElementById('vtt-pl-name-inp')?.value?.trim(); if (!name) return;
  const color = document.querySelector('.vtt-pl-color-btn.sel')?.dataset.color || '#6366f1';
  closeModalDirect();
  await addDoc(_playlistsCol(), { name, color, soundIds:[], createdAt:serverTimestamp() });
};

window._vttDeletePlaylist = async plId => {
  const pl = _playlists.find(p=>p.id===plId); if (!pl) return;
  if (!await confirmModal(`Supprimer la playlist "${pl.name}" ?`)) return;
  if (_musicState.currentPlaylistId===plId) await window._vttStopMusic();
  await deleteDoc(_playlistRef(plId)).catch(()=>{});
};

window._vttAddSoundToPlaylist = async (plId, soundId) => {
  if (!soundId) return;
  const pl = _playlists.find(p=>p.id===plId); if (!pl) return;
  if ((pl.soundIds||[]).includes(soundId)) return;
  await updateDoc(_playlistRef(plId), { soundIds:[...(pl.soundIds||[]), soundId] }).catch(()=>{});
};

window._vttRemoveSoundFromPlaylist = async (plId, soundId) => {
  const pl = _playlists.find(p=>p.id===plId); if (!pl) return;
  await updateDoc(_playlistRef(plId), { soundIds:(pl.soundIds||[]).filter(id=>id!==soundId) }).catch(()=>{});
};

// ═══════════════════════════════════════════════════════════════════
// TIMER DE SESSION — partagé via _session.timer, visible par tous
// ═══════════════════════════════════════════════════════════════════
function _timerElapsedMs() {
  const t = _session?.timer;
  if (!t) return 0;
  const acc = +t.accumulated || 0;
  if (t.running && t.startedAt) return acc + Math.max(0, Date.now() - (+t.startedAt));
  return acc;
}
function _timerFmt(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}
function _renderTimer() {
  const el = document.getElementById('vtt-timer');
  if (!el) return;
  const t = _session?.timer || {};
  const mj = STATE.isAdmin;
  const running = !!t.running;
  const label = (t.label || '').toString().slice(0, 40);
  const ms = _timerElapsedMs();
  const idle = ms === 0 && !running && !label;

  // Joueur sans timer actif et sans label → on cache
  if (!mj && idle) { el.innerHTML = ''; el.classList.remove('vtt-timer--on'); return; }

  el.classList.toggle('vtt-timer--on', running);
  el.classList.toggle('vtt-timer--paused', !running && ms > 0);
  el.innerHTML = `
    <span class="vtt-timer-ico" title="${running ? 'En cours' : (ms > 0 ? 'En pause' : 'Arrêté')}">${running ? '⏱️' : (ms > 0 ? '⏸️' : '⏱️')}</span>
    <span class="vtt-timer-val">${_timerFmt(ms)}</span>
    ${label ? `<span class="vtt-timer-label" title="${_esc(label)}">${_esc(label)}</span>` : ''}
    ${mj ? `
      <span class="vtt-timer-ctrls">
        <button class="vtt-timer-btn" onclick="window._vttTimerToggle()" title="${running ? 'Mettre en pause' : (ms > 0 ? 'Reprendre' : 'Démarrer')}">${running ? '⏸' : '▶'}</button>
        <button class="vtt-timer-btn" onclick="window._vttTimerReset()" title="Réinitialiser">↺</button>
        <button class="vtt-timer-btn" onclick="window._vttTimerLabel()" title="Modifier le libellé (Combat, Repos, Énigme…)">🏷</button>
      </span>` : ''}
  `;
}
function _timerStartTick() {
  if (_timerTick) return;
  _timerTick = setInterval(() => {
    if (_session?.timer?.running) _renderTimer();
  }, 1000);
}
function _timerStopTick() {
  if (_timerTick) { clearInterval(_timerTick); _timerTick = null; }
}

window._vttTimerToggle = async () => {
  if (!STATE.isAdmin) return;
  const t = _session?.timer || {};
  const now = Date.now();
  if (t.running && t.startedAt) {
    const acc = (+t.accumulated || 0) + Math.max(0, now - (+t.startedAt));
    await setDoc(_sesRef(), { timer: { ...t, running: false, accumulated: acc, startedAt: null } }, { merge: true }).catch(()=>{});
  } else {
    await setDoc(_sesRef(), { timer: { accumulated: +t.accumulated || 0, label: t.label || '', running: true, startedAt: now } }, { merge: true }).catch(()=>{});
  }
};
window._vttTimerReset = async () => {
  if (!STATE.isAdmin) return;
  const ok = await confirmModal('Réinitialiser le minuteur à 00:00 ?', { title: '↺ Reset minuteur', okLabel: 'Réinitialiser', cancelLabel: 'Annuler' }).catch(()=>false);
  if (!ok) return;
  const t = _session?.timer || {};
  await setDoc(_sesRef(), { timer: { running: false, accumulated: 0, startedAt: null, label: t.label || '' } }, { merge: true }).catch(()=>{});
};
window._vttTimerLabel = async () => {
  if (!STATE.isAdmin) return;
  const cur = _session?.timer?.label || '';
  const next = prompt('Libellé du minuteur (laisser vide pour effacer) :', cur);
  if (next === null) return;
  const t = _session?.timer || {};
  await setDoc(_sesRef(), { timer: { ...t, label: next.trim().slice(0, 40) } }, { merge: true }).catch(()=>{});
};

// ═══════════════════════════════════════════════════════════════════
// COMBAT TRACKER — overlay haut-gauche, visible quand combat actif
// ═══════════════════════════════════════════════════════════════════
function _trackerPortrait(ld, t) {
  // Photo prioritaire : fiche perso/PNJ via _live (champ displayImage)
  const url = ld.displayImage || null;
  if (url) return `<img class="vct-photo" src="${url}" alt="">`;
  const init = ((ld.displayName || t.name || '?').trim()[0] || '?').toUpperCase();
  return `<div class="vct-photo vct-photo-init">${init}</div>`;
}
function _trackerRow(t) {
  const ld = _live(t);
  const moved = !!t.movedThisTurn || (t.movedCells || 0) > 0;
  const acted = !!t.attackedThisTurn;
  const done  = moved && acted;
  const partial = moved !== acted;
  const cls = done ? 'vct-row--done' : (partial ? 'vct-row--partial' : 'vct-row--todo');
  const name = _esc(ld.displayName || t.name || '—');
  return `
    <div class="vct-row ${cls}" data-tok="${t.id}" onclick="window._vttTrackerFocus('${t.id}')" title="Cliquer pour centrer sur ce token">
      ${_trackerPortrait(ld, t)}
      <div class="vct-info">
        <div class="vct-name">${name}</div>
        <div class="vct-status">
          <span class="vct-pill ${moved ? 'vct-pill--on' : ''}" title="Déplacement effectué">🏃 ${moved ? '✓' : '·'}</span>
          <span class="vct-pill ${acted ? 'vct-pill--on' : ''}" title="Action effectuée">⚔ ${acted ? '✓' : '·'}</span>
        </div>
      </div>
    </div>`;
}
function _renderCombatTracker() {
  const el = document.getElementById('vtt-combat-tracker');
  if (!el) return;
  const active = !!_session?.combat?.active;
  const mj = STATE.isAdmin;

  // Combat inactif :
  //   - MJ → carte compacte avec bouton "Démarrer le combat"
  //   - Joueur → masqué
  if (!active) {
    if (!mj) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'block';
    el.innerHTML = `
      <div class="vct-header vct-header--idle">
        <div class="vct-title">
          <span class="vct-title-ico">⚔️</span>
          <span class="vct-title-txt vct-title-txt--idle">Combat</span>
        </div>
        <button class="vct-mj-btn vct-mj-btn--start" onclick="window._vttToggleCombat()" title="Démarrer le combat — reset déplacement & action de tous les tokens">▶ Démarrer</button>
      </div>`;
    return;
  }
  el.style.display = 'block';

  const round = _session?.combat?.round ?? 1;
  const pageId = _activePage?.id;
  const onPage = Object.values(_tokens).map(x => x?.data || x).filter(t => t && t.pageId === pageId);
  const allies = onPage.filter(t => t.type === 'player' || t.type === 'npc');
  const enemies = onPage.filter(t => t.type === 'enemy');

  // tab par défaut "allies" — joueurs non-MJ ne voient pas l'onglet ennemis
  const tab = (!mj && _combatTab === 'enemies') ? 'allies' : _combatTab;
  const list = tab === 'enemies' ? enemies : allies;

  // tri : joueurs d'abord, puis PNJ ; ennemis par HP% croissant
  if (tab === 'allies') {
    list.sort((a, b) => {
      const r = (a.type === 'player' ? 0 : 1) - (b.type === 'player' ? 0 : 1);
      if (r !== 0) return r;
      const na = _live(a).displayName || a.name || '';
      const nb = _live(b).displayName || b.name || '';
      return na.localeCompare(nb);
    });
  }

  const rows = list.length
    ? list.map(_trackerRow).join('')
    : `<div class="vct-empty">${tab === 'enemies' ? 'Aucun ennemi sur la page' : 'Aucun token allié sur la page'}</div>`;

  el.innerHTML = `
    <div class="vct-header">
      <div class="vct-title">
        <span class="vct-title-ico">⚔️</span>
        <span class="vct-title-txt">Combat</span>
        <span class="vct-round">Tour ${round}</span>
      </div>
      ${mj ? `
        <div class="vct-mj-ctrls">
          <button class="vct-mj-btn" onclick="window._vttNextRound()" title="Tour suivant — reset déplacement & action">▶ Tour</button>
          <button class="vct-mj-btn vct-mj-btn--danger" onclick="window._vttToggleCombat()" title="Terminer le combat">⏹</button>
        </div>` : ''}
    </div>
    ${mj ? `
      <div class="vct-tabs">
        <button class="vct-tab ${tab==='allies' ? 'active' : ''}" onclick="window._vttCombatTab('allies')">👥 Joueurs &amp; PNJ <span class="vct-tab-count">${allies.length}</span></button>
        <button class="vct-tab ${tab==='enemies' ? 'active' : ''}" onclick="window._vttCombatTab('enemies')">👹 Ennemis <span class="vct-tab-count">${enemies.length}</span></button>
      </div>` : ''}
    <div class="vct-list">${rows}</div>
  `;
}
// Re-render groupé via microtask (évite les multi-rerender lors d'un batch reset)
let _trackerDirty = false;
function _renderCombatTrackerSoon() {
  if (_trackerDirty) return;
  _trackerDirty = true;
  queueMicrotask(() => { _trackerDirty = false; _renderCombatTracker(); });
}

window._vttCombatTab = (tab) => {
  if (tab !== 'allies' && tab !== 'enemies') return;
  if (tab === 'enemies' && !STATE.isAdmin) return;
  _combatTab = tab;
  _renderCombatTracker();
};
window._vttTrackerFocus = (tokId) => {
  // Centrer/sélectionner le token cliqué
  const t = _tokens[tokId]?.data;
  if (!t) return;
  if (STATE.isAdmin || t.type !== 'enemy') {
    try { _select(tokId); } catch {}
  }
};

// ═══════════════════════════════════════════════════════════════════
// HTML
// ═══════════════════════════════════════════════════════════════════
function _buildHtml() {
  const mj=STATE.isAdmin;
  return `
<div class="vtt-root" id="vtt-root">
  <div class="vtt-toolbar">
    ${mj?'':`<div id="vtt-page-tabs" class="vtt-page-tabs"></div>`}
    <div class="vtt-tool-group vtt-right">
      ${mj?`
        <button class="vtt-btn-sm" id="vtt-map-mode-btn" onclick="window._vttToggleMapMode()" title="Verrouille / déverrouille le calque des cartes en arrière-plan">🗺 Carte</button>
        <label  class="vtt-btn-sm vtt-upload-lbl" title="Upload une image via ImgBB — sauvegardée dans la bibliothèque">⬆ Upload<input type="file" id="vtt-img-input" accept="image/*" hidden></label>
        <button class="vtt-btn-sm" onclick="window._vttSetImgbbKey()" title="Configurer la clé API ImgBB">🔑</button>`:''}
    </div>
  </div>

  <div class="vtt-body">
    <div class="vtt-presence-col" id="vtt-presence-col">
      <div class="vtt-pres-hd" title="Joueurs en ligne">👥</div>
      <div id="vtt-pres-list" class="vtt-pres-list"></div>
    </div>
    <div class="vtt-mini-panel" id="vtt-mini-panel"></div>
    ${mj?`
    <div class="vtt-tray" id="vtt-tray">
      <div class="vtt-tray-section">
        <div class="vtt-tray-section-hd">
          <span>Pages</span>
          <button class="vtt-tray-add-btn" onclick="window._vttAddPage()" title="Nouvelle page">＋</button>
        </div>
        <div id="vtt-tray-pages"><div class="vtt-tray-empty">Chargement…</div></div>
      </div>
      <div class="vtt-tray-section">
        <div id="vtt-tray-tokens"></div>
      </div>
      <div class="vtt-tray-section vtt-tray-section--lib">
        <div class="vtt-tray-section-hd vtt-tray-collapsible" onclick="window._vttLibToggle()">
          <span>📁 Bibliothèque</span>
          <div style="display:flex;gap:3px;align-items:center">
            <button class="vtt-tray-add-btn" onclick="event.stopPropagation();window._vttLibNewFolder()" title="Nouveau dossier">📁</button>
            <span id="vtt-lib-toggle" class="vtt-tray-count open">▲</span>
          </div>
        </div>
        <div id="vtt-tray-library"></div>
      </div>
    </div>`:''}
    <div class="vtt-canvas-wrap" id="vtt-canvas-wrap"></div>
    <div class="vtt-right-col" id="vtt-right-col">
      <div class="vtt-inspector" id="vtt-inspector">
        <div class="vtt-ins-empty"><div style="font-size:1.8rem">🎲</div>Sélectionne un token</div>
      </div>
      <div class="vtt-chat">
        <div class="vtt-chat-hd">💬 Chat &amp; Dés</div>
        <div class="vtt-chat-log" id="vtt-chat-log"></div>
        <div class="vtt-chat-input-row">
          <input type="text" id="vtt-chat-input" class="vtt-chat-input" placeholder="Message…"
            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
            onkeydown="if(event.key==='Enter')window._vttSendChat()">
          <button class="vtt-chat-send" onclick="window._vttSendChat()" title="Envoyer">↵</button>
        </div>
      </div>
    </div>
  </div>
  <div class="vtt-hint">Clic token allié → portée · Clic ennemi → attaque · Échap désélect. · Molette zoom · Clic-droit pan${mj?' · Clic image → redimensionner':''}</div>
</div>`;
}

// ═══════════════════════════════════════════════════════════════════
// POINT D'ENTRÉE
// ═══════════════════════════════════════════════════════════════════
export async function renderVttPage() {
  _cleanup();
  const content=document.getElementById('main-content');
  if (!content) return;
  content.innerHTML='<div class="loading"><div class="spinner"></div> Chargement de la table…</div>';
  content.style.overflow='hidden';
  content.style.height='100vh';
  content.style.paddingBottom='0';
  // Lancer en parallèle : téléchargement Konva + reads Firestore non critiques
  const _konvaP   = _loadKonva();
  const _emotesP  = _loadEmotes();
  const _skillsP  = _loadDiceSkills();
  const _formatsP = Promise.all([loadWeaponFormats(), loadDamageTypes()]);
  try { await _konvaP; }
  catch {
    content.innerHTML='<div style="padding:2rem;color:var(--text-dim)">Impossible de charger Konva.js.</div>';
    content.style.overflow=''; return;
  }
  content.innerHTML=_buildHtml();
  const wrap=document.getElementById('vtt-canvas-wrap');
  if (!wrap) return;
  _initCanvas(wrap);
  _timerStartTick();
  // Floats injectés APRÈS Konva pour être au-dessus des canvas layers
  const _tf = document.createElement('div');
  _tf.className = 'vtt-tool-float';
  _tf.innerHTML = `
    <div class="vtt-tool-float-tools">
      <button class="vtt-tool active" data-tool="select" onclick="window._vttTool('select')" title="↖ Sélection">↖</button>
      <button class="vtt-tool" data-tool="ruler"  onclick="window._vttTool('ruler')"  title="📏 Règle (R) — clic gauche pour mesurer · clic droit pour annuler">📏</button>
      <button class="vtt-tool" data-tool="draw"   onclick="window._vttTool('draw')"   title="✏️ Dessin">✏️</button>
      ${STATE.isAdmin?`<button class="vtt-tool" data-tool="walls" onclick="window._vttTool('walls')" title="🧱 Murs / Éclairage dynamique">🧱</button>`:''}
    </div>
    <div id="vtt-draw-bar" class="vtt-draw-bar" style="display:none">
      <button class="vtt-draw-btn active" id="vtt-ds-pencil"  onclick="window._vttDrawShape('pencil')"  title="Crayon libre">✏️</button>
      <button class="vtt-draw-btn"        id="vtt-ds-line"    onclick="window._vttDrawShape('line')"    title="Ligne">╱</button>
      <button class="vtt-draw-btn"        id="vtt-ds-rect"    onclick="window._vttDrawShape('rect')"    title="Rectangle">⬜</button>
      <button class="vtt-draw-btn"        id="vtt-ds-circle"  onclick="window._vttDrawShape('circle')"  title="Cercle">⬭</button>
      <div class="vtt-draw-sep"></div>
      ${['#ef4444','#f59e0b','#22c38e','#4f8cff','#b47fff','#ffffff','#1a1a2e'].map((c,i)=>
        `<button class="vtt-draw-color${i===0?' active':''}" data-color="${c}" onclick="window._vttDrawColor('${c}')" style="background:${c}" title="${c}"></button>`
      ).join('')}
      <div class="vtt-draw-sep"></div>
      ${[2,4,8].map((w,i)=>
        `<button class="vtt-draw-wbtn${i===0?' active':''}" data-w="${w}" onclick="window._vttDrawWidth(${w})" title="${w}px">${w}</button>`
      ).join('')}
      <div class="vtt-draw-sep"></div>
      <button class="vtt-draw-btn" id="vtt-draw-fill-btn" onclick="window._vttToggleDrawFill()" title="Remplissage (rect/cercle)">◻</button>
      ${STATE.isAdmin?`<div class="vtt-draw-sep"></div><button class="vtt-btn-sm vtt-btn-danger" onclick="window._vttClearAnnots()" title="Effacer toutes les annotations">🗑</button>`:''}
    </div>
    ${STATE.isAdmin?`
    <div id="vtt-walls-bar" class="vtt-walls-bar" style="display:none">
      <span class="vtt-walls-bar-label">Outil :</span>
      <button class="vtt-btn-sm active" data-fog-tool="wall"   onclick="window._vttFogTool('wall')"   title="Tracer un mur">🧱 Mur</button>
      <button class="vtt-btn-sm"        data-fog-tool="door"   onclick="window._vttFogTool('door')"   title="Tracer une porte">🚪 Porte</button>
      <button class="vtt-btn-sm"        data-fog-tool="window" onclick="window._vttFogTool('window')" title="Tracer une fenêtre">🪟 Fenêtre</button>
      <button class="vtt-btn-sm"        data-fog-tool="light"  onclick="window._vttFogTool('light')"  title="Placer une source lumineuse">💡 Lumière</button>
      <button class="vtt-btn-sm"        data-fog-tool="eraser" onclick="window._vttFogTool('eraser')" title="Effacer (clic sur segment ou source)">🗑 Effacer</button>
      <div class="vtt-tb-sep"></div>
      <button class="vtt-btn-sm" id="vtt-fog-toggle" onclick="window._vttToggleFog()" title="Activer / désactiver le brouillard de guerre sur cette page" style="color:#9ca3af">👁 Éclairage OFF</button>
      <div class="vtt-walls-bar-hint">Clic grille = tracer · Clic-droit = annuler · Clic segment = menu</div>
    </div>`:''}`;
  wrap.appendChild(_tf);

  // ─── Overlay haut-gauche : Timer + Combat tracker ──────────────────
  const _ovTL = document.createElement('div');
  _ovTL.className = 'vtt-overlay-tl';
  _ovTL.innerHTML = `
    <div id="vtt-timer" class="vtt-timer" aria-live="polite"></div>
    <div id="vtt-combat-tracker" class="vtt-combat-tracker" style="display:none"></div>
  `;
  wrap.appendChild(_ovTL);
  _renderTimer();
  _renderCombatTracker();
  const _ef = document.createElement('div');
  _ef.className = 'vtt-emote-float';
  _ef.innerHTML = `<div class="vtt-emote-picker" id="vtt-emote-picker"></div>
    <button class="vtt-emote-trigger" onclick="window._vttToggleEmotePicker()" title="Émotes">😄</button>`;
  wrap.appendChild(_ef);
  // Float Butin (bas-gauche du canvas)
  const _lf = document.createElement('div');
  _lf.className = 'vtt-loot-float';
  _lf.innerHTML = `
    <div class="vtt-loot-panel" id="vtt-loot-panel" data-open="0" style="display:none"></div>
    <button class="vtt-loot-trigger" id="vtt-loot-trigger" onclick="window._vttToggleLoot()" title="Butin d'aventure">💰</button>`;
  wrap.appendChild(_lf);
  // Float Lanceur de dés (bas-gauche du canvas, 3e bouton)
  const _drf = document.createElement('div');
  _drf.className = 'vtt-dice-float';
  _drf.innerHTML = `
    <div class="vtt-dice-panel" id="vtt-dice-panel" data-open="0" style="display:none"></div>
    <button class="vtt-dice-trigger" id="vtt-dice-trigger" onclick="window._vttToggleDice()" title="Lancer des dés libres">🎲</button>`;
  wrap.appendChild(_drf);
  // Float Musique (bas-gauche du canvas, 4e bouton)
  const _mf = document.createElement('div');
  _mf.className = 'vtt-music-float';
  _mf.innerHTML = `
    <div class="vtt-music-panel" id="vtt-music-panel" data-open="0" style="display:none"></div>
    <button class="vtt-music-trigger" id="vtt-music-trigger" onclick="window._vttToggleMusic()" title="Sons &amp; Musique">🎵</button>`;
  wrap.appendChild(_mf);
  document.addEventListener('keydown',_keyHandler);
  document.getElementById('vtt-img-input')?.addEventListener('change',e=>{
    const f=e.target.files?.[0]; if (f) _handleUpload(f); e.target.value='';
  });
  // Récupérer les promesses lancées en amont (parallèles à Konva)
  _emotesP.then(() => {
    _renderEmotePicker();
    // Précharge + décode en mémoire pour affichage instantané au clic
    _emotes.forEach(em => {
      const img = new Image();
      img.src = em.url;
      img.decode().catch(() => {}); // ignore erreurs réseau / format
    });
  });
  _formatsP.then(([f, d]) => { _weaponFormats = f; _damageTypes = d; });
  // Précharge les matrices MJ (combos, armes invoquées) pour les sorts en combat
  loadSpellMatrices().then(m => { _spellMatrices = m; }).catch(() => {});
  // _skillsP : _loadDiceSkills met à jour _diceSkills et rerend l'inspector si besoin
  void _skillsP;
  _initListeners();
  // Présence : heartbeat toutes les 45 s
  const _presUid = STATE.user?.uid;
  if (_presUid) {
    const _presWrite = () => {
      const pseudo = STATE.profile?.pseudo || STATE.user?.email?.split('@')[0] || '?';
      setDoc(_pingRef(_presUid), { pres: { pseudo, lastSeen: serverTimestamp() } }, { merge: true }).catch(() => {});
    };
    _presWrite();
    _presHeartbeat = setInterval(_presWrite, 45_000);
    // Fermeture navigateur : tentative de suppression (best-effort)
    const _onUnload = () => { deleteDoc(_pingRef(_presUid)).catch(()=>{}); };
    window.addEventListener('beforeunload', _onUnload, { once: true });
  }
  // Filet de sécurité : re-rendre la présence toutes les 30s pour expirer les entrants inactifs
  _presRefresh = setInterval(_renderPresenceCol, 30_000);
}

// ═══════════════════════════════════════════════════════════════════
// PRÉSENCE — joueurs actifs sur le VTT
// ═══════════════════════════════════════════════════════════════════

function _renderPresenceCol() {
  const list = document.getElementById('vtt-pres-list');
  if (!list) return;
  const now = Date.now();
  const players = Object.values(_presence).filter(p => now - (p.lastSeen ?? 0) < 120_000);
  if (!players.length) {
    list.innerHTML = '<div class="vtt-pres-empty">—</div>';
    return;
  }
  const myUid = STATE.user?.uid;
  list.innerHTML = players.map(p => {
    const chars = Object.values(_characters).filter(c => c.uid === p.uid);
    const char  = chars.find(c => c.id === _miniCharId) || chars[0];
    const img   = char?.photoURL || char?.photo || char?.avatar || null;
    const init  = (char?.nom || p.pseudo || '?')[0].toUpperCase();
    const isOpen = _miniUid === p.uid;
    const isSelf = p.uid === myUid;
    return `<div class="vtt-pres-entry${isOpen?' is-open':''}${isSelf?' is-self':''}"
      onclick="window._vttToggleMiniSheet('${p.uid}')"
      title="${p.pseudo}${char?.nom ? ' · '+char.nom : ''}">
      <div class="vtt-pres-avatar"${img?` style="background-image:url('${img}')"`:''}>
        ${img ? '' : `<span>${init}</span>`}
        ${isSelf ? '<div class="vtt-pres-self-dot"></div>' : ''}
      </div>
      <div class="vtt-pres-name">${p.pseudo}</div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════
// MINI-FICHE PERSONNAGE — 4 onglets
// ═══════════════════════════════════════════════════════════════════

const _MS_SLOTS = [
  'Main principale','Hors-main','Tête','Torse','Bottes',
  'Amulette','Anneau gauche','Anneau droit','Cou','Dos',
];

// ─── Helpers locaux ───────────────────────────────────────────────

function _msCatItem(item) {
  const t = item?.template || '';
  if (t === 'arme'   || item?.degats)                     return 'arme';
  if (t === 'armure' || item?.slotArmure || item?.typeArmure) return 'armure';
  if (t === 'bijou'  || item?.slotBijou)                  return 'bijou';
  if (t === 'consommable')                                return 'consommable';
  return 'divers';
}

function _msBuildEquipItem(slot, item, invIndex) {
  if (!item) return null;
  const isWeapon = slot.startsWith('Main');
  const base = {
    nom: item.nom||'',
    fo: getItemStatBonus(item, 'force'), dex: getItemStatBonus(item, 'dexterite'),
    in: getItemStatBonus(item, 'intelligence'), sa:  getItemStatBonus(item, 'sagesse'),
    co: getItemStatBonus(item, 'constitution'), ch:  getItemStatBonus(item, 'charisme'),
    sourceInvIndex: invIndex, itemId: item.itemId||'',
  };
  if (isWeapon) {
    const statAtk = item.toucherStat || item.statAttaque
      || (String(item.format||'').includes('Mag.') ? 'intelligence'
          : String(item.format||'').includes('Dist.') ? 'dexterite' : 'force');
    return { ...base,
      degats: item.degats||'', degatsStat: item.degatsStat||statAtk,
      toucherStat: statAtk, typeArme: item.typeArme||'',
      portee: item.portee||'', particularite: item.particularite||item.effet||'',
      format: item.format||'' };
  }
  return { ...base,
    ca: parseInt(item.ca)||0, typeArmure: item.typeArmure||'',
    slotArmure: item.slotArmure||'', slotBijou: item.slotBijou||'' };
}

function _msCanEdit(uid) { return STATE.isAdmin || STATE.user?.uid === uid; }

// Reproduit la logique de compatibilité de characters/equipment.js
function _msItemFitsSlot(item, slot, equip, idx) {
  if (!item?.nom) return false;
  // Déjà équipé dans un autre slot → exclu
  if (Object.entries(equip).some(([s, e]) => s !== slot && e?.sourceInvIndex === idx)) return false;

  const tpl = item.template || '';

  // ── Armes ────────────────────────────────────────────────────────
  if (slot.startsWith('Main')) {
    if (tpl === 'arme') return true;
    const WFMT = new Set([
      'Arme 1M CaC Phy.','Arme 2M CaC Phy.','Arme 2M Dist Phy.',
      'Arme 2M CaC Mag.','Arme 2M Dist Mag.','Arme Secondaire (Bouclier, Torche...)',
    ]);
    if (item.format && WFMT.has(item.format)) return true;
    const combined = [item.type, item.sousType, item.nom, item.categorie]
      .map(v => (v||'').toLowerCase()).join(' ');
    return ['arme','weapon','épée','lance','hache','arc','arbalète','dague',
      'baguette','baton','bouclier','shield','torche','masse','marteau',
      'fléau','rapière','cimeterre','sabre'].some(k => combined.includes(k));
  }

  // ── Armures (Tête / Torse / Bottes) ─────────────────────────────
  // Note : slotArmure stocké = 'Tête', 'Torse', 'Pieds' (pas 'Bottes')
  const ARMOR_MAP = { 'Tête':'Tête', 'Torse':'Torse', 'Bottes':'Pieds' };
  if (ARMOR_MAP[slot] !== undefined) {
    if (tpl === 'armure' || item.slotArmure) {
      return item.slotArmure === ARMOR_MAP[slot] || item.slotArmure === slot;
    }
    const t = (item.type||'').toLowerCase();
    return ['armure','armor','casque','torse','cuirasse','botte','chapeau'].some(k => t.includes(k));
  }

  // ── Bijoux / accessoires ─────────────────────────────────────────
  if (['Amulette','Anneau gauche','Anneau droit','Cou','Dos'].includes(slot)) {
    if (!item.slotBijou) return tpl === 'bijou';
    if (item.slotBijou === slot) return true;
    // 'Anneau' générique → compatible avec les deux emplacements bague
    if (item.slotBijou === 'Anneau' && (slot === 'Anneau gauche' || slot === 'Anneau droit')) return true;
    return false;
  }

  return false;
}

// ─── Handlers exposés ────────────────────────────────────────────

window._vttMsTab = (tab) => { _miniTab = tab; if (_miniUid) _renderMiniSheet(_miniUid); };

window._vttMsEquip = async (charId, uid, slot, invIndex) => {
  if (!_msCanEdit(uid)) return;
  const c = _characters[charId]; if (!c) return;
  invIndex = parseInt(invIndex);
  const item = (c.inventaire||[])[invIndex]; if (!item) return;
  const equip = { ...(c.equipement||{}) };
  // Libère l'item s'il était déjà équipé ailleurs
  Object.keys(equip).forEach(s => { if (s !== slot && equip[s]?.sourceInvIndex === invIndex) delete equip[s]; });
  const built = _msBuildEquipItem(slot, item, invIndex); if (!built) return;
  equip[slot] = built;
  const bonus = computeEquipStatsBonus(equip);
  try {
    await updateDoc(_chrRef(charId), { equipement: equip, statsBonus: bonus });
    showNotif(`${item.nom} → ${slot}`, 'success');
  } catch(e) { showNotif('Erreur sauvegarde', 'error'); }
};

window._vttMsUnequip = async (charId, uid, slot) => {
  if (!_msCanEdit(uid)) return;
  const c = _characters[charId]; if (!c) return;
  const equip = { ...(c.equipement||{}) };
  const nom = equip[slot]?.nom || slot;
  delete equip[slot];
  const bonus = computeEquipStatsBonus(equip);
  try {
    await updateDoc(_chrRef(charId), { equipement: equip, statsBonus: bonus });
    showNotif(`${nom} retiré`, 'success');
  } catch(e) { showNotif('Erreur sauvegarde', 'error'); }
};

// Appelé par le <select> de l'onglet Équipement
window._vttMsSlotChange = (sel, charId, uid, slotIdx) => {
  const slot = _MS_SLOTS[parseInt(slotIdx)]; if (!slot) return;
  const val = sel.value;
  if (val === '') window._vttMsUnequip(charId, uid, slot);
  else            window._vttMsEquip(charId, uid, slot, parseInt(val));
};

// Ouvre une modale pour choisir le slot cible depuis l'inventaire
window._vttMsEquipPicker = (charId, uid, invIndex) => {
  if (!_msCanEdit(uid)) return;
  const c = _characters[charId]; if (!c) return;
  invIndex = parseInt(invIndex);
  const item = (c.inventaire||[])[invIndex]; if (!item) return;
  const equip = c.equipement||{};
  // Seuls les slots compatibles avec cet item (sans check "usedElsewhere" pour qu'on puisse déplacer)
  const slots = _MS_SLOTS.filter(s => _msItemFitsSlot(item, s, {}, invIndex));
  if (!slots.length) { showNotif('Aucun slot compatible pour cet objet', 'info'); return; }
  if (slots.length === 1) { window._vttMsEquip(charId, uid, slots[0], invIndex); return; }
  openModal(`⚔️ Équiper "${item.nom}"`, `
    <div style="display:flex;flex-direction:column;gap:.4rem">
      ${slots.map(s => `<button class="btn btn-outline"
        onclick="closeModal();window._vttMsEquip('${charId}','${uid}',${JSON.stringify(s)},${invIndex})">${s}</button>`).join('')}
      <button class="btn btn-outline btn-sm" style="margin-top:.3rem" onclick="closeModal()">Annuler</button>
    </div>`);
};

// Déséquipe un item depuis l'inventaire (tous les slots où il est équipé)
window._vttMsUnequipAll = async (charId, uid, invIndex) => {
  if (!_msCanEdit(uid)) return;
  invIndex = parseInt(invIndex);
  const c = _characters[charId]; if (!c) return;
  const equip = { ...(c.equipement||{}) };
  Object.keys(equip).forEach(s => { if (equip[s]?.sourceInvIndex === invIndex) delete equip[s]; });
  const bonus = computeEquipStatsBonus(equip);
  try {
    await updateDoc(_chrRef(charId), { equipement: equip, statsBonus: bonus });
    showNotif('Déséquipé', 'success');
  } catch(e) { showNotif('Erreur sauvegarde', 'error'); }
};

// Active / désactive un sort
window._vttToggleMsSort = async (charId, uid, idx) => {
  if (!_msCanEdit(uid)) return;
  const c = _characters[charId]; if (!c) return;
  const sorts = [...(c.deck_sorts||[])];
  if (!sorts[idx]) return;
  sorts[idx] = { ...sorts[idx], actif: !sorts[idx].actif };
  try { await updateDoc(_chrRef(charId), { deck_sorts: sorts }); }
  catch(e) { showNotif('Erreur sauvegarde', 'error'); }
};

// Modale pour choisir le destinataire d'un objet
window._vttMsSendPicker = (charId, uid, invIndex) => {
  if (!_msCanEdit(uid)) return;
  invIndex = parseInt(invIndex);
  const c = _characters[charId]; if (!c) return;
  const item = (c.inventaire||[])[invIndex]; if (!item) return;
  const targets = Object.entries(_presence)
    .filter(([pUid]) => pUid !== uid)
    .flatMap(([pUid, p]) =>
      Object.values(_characters)
        .filter(ch => ch.uid === pUid)
        .map(ch => ({ pUid, charId: ch.id, charNom: ch.nom||p.pseudo, pseudo: p.pseudo }))
    );
  if (!targets.length) { showNotif('Aucun joueur présent à qui envoyer l\'objet', 'info'); return; }
  openModal(`📦 Envoyer "${item.nom||'objet'}"`, `
    <div style="display:flex;flex-direction:column;gap:.5rem">
      <p style="margin:0;font-size:.85rem;color:var(--text-dim)">Destinataire :</p>
      ${targets.map(t => `<button class="btn btn-outline" style="text-align:left"
        onclick="closeModal();window._vttMsConfirmSend('${charId}','${uid}',${invIndex},'${t.charId}')">
        ${t.pseudo} → ${t.charNom}</button>`).join('')}
      <button class="btn btn-outline btn-sm" style="margin-top:.3rem" onclick="closeModal()">Annuler</button>
    </div>`);
};

// Effectue le transfert d'objet entre deux personnages
window._vttMsConfirmSend = async (senderCharId, senderUid, invIndex, recipCharId) => {
  invIndex = parseInt(invIndex);
  const sender = _characters[senderCharId]; if (!sender) return;
  const recip  = _characters[recipCharId];  if (!recip)  return;
  const senderInv = [...(sender.inventaire||[])];
  const item = senderInv[invIndex]; if (!item) return;
  senderInv.splice(invIndex, 1);
  // Ajuste les sourceInvIndex dans l'équipement du sender
  const senderEquip = { ...(sender.equipement||{}) };
  Object.keys(senderEquip).forEach(s => {
    const e = senderEquip[s]; if (!e) return;
    if (e.sourceInvIndex === invIndex)    delete senderEquip[s];
    else if (e.sourceInvIndex > invIndex) senderEquip[s] = { ...e, sourceInvIndex: e.sourceInvIndex - 1 };
  });
  const senderBonus = computeEquipStatsBonus(senderEquip);
  const recipInv = [...(recip.inventaire||[]), { ...item }];
  try {
    await updateDoc(_chrRef(senderCharId), { inventaire: senderInv, equipement: senderEquip, statsBonus: senderBonus });
    await updateDoc(_chrRef(recipCharId),  { inventaire: recipInv });
    showNotif(`${item.nom||'Objet'} envoyé à ${recip.nom||'joueur'}`, 'success');
  } catch(e) { console.error('[vtt] send item', e); showNotif('Erreur envoi', 'error'); }
};

// ─── Rendus par onglet ────────────────────────────────────────────

function _msTabCombat(c, uid, canEdit) {
  const pvMax = calcPVMax(c), pmMax = calcPMMax(c);
  const pvCur = c?.hp ?? pvMax, pmCur = c?.pm ?? pmMax;
  const pvPct = pvMax > 0 ? Math.round(Math.max(0, pvCur) / pvMax * 100) : 0;
  const pmPct = pmMax > 0 ? Math.round(Math.max(0, pmCur) / pmMax * 100) : 0;
  const pvCol = pvPct > 50 ? '#22c38e' : pvPct > 25 ? '#f59e0b' : '#ef4444';

  const statsHtml = _MS_STATS.map(s => {
    const base  = (c?.stats||{})[s.key]      || 8;
    const bonus = (c?.statsBonus||{})[s.key] || 0;
    const total = Math.min(22, base + bonus);
    const mod   = getMod(c, s.key);
    const col   = _STAT_COLOR[s.abbr];
    return `<div class="vtt-ms-stat">
      <span class="vtt-ms-stat-abbr" style="color:${col}">${s.abbr}</span>
      <span class="vtt-ms-stat-val">${total}</span>
      <span class="vtt-ms-stat-mod" style="color:${col}">${mod>=0?'+'+mod:mod}</span>
    </div>`;
  }).join('');

  const weapon = c?.equipement?.['Main principale'];
  const weaponHtml = weapon?.nom ? (() => {
    const wDmgStat = weapon.degatsStat || weapon.degatStat || 'force';
    const wTchStat = weapon.toucherStat || weapon.statAttaque || 'force';
    const setBonus = getArmorSetData(c).modifiers.toucherBonus || 0;
    const maitrise = getMaitriseBonus(c, weapon);
    const dmgMod   = getMod(c, wDmgStat);
    const tchTotal = getMod(c, wTchStat) + maitrise + setBonus;
    return `<div class="vtt-ms-weapon">
      <div class="vtt-ms-weapon-nom">⚔️ ${weapon.nom}</div>
      <div class="vtt-ms-weapon-stats">
        <span>🎲 ${weapon.degats||'—'}${dmgMod!==0?' '+(dmgMod>=0?'+'+dmgMod:dmgMod):''}</span>
        <span>🎯 ${tchTotal>=0?'+'+tchTotal:tchTotal}</span>
      </div>
    </div>`;
  })() : '';

  const setData = getArmorSetData(c);
  const setHtml = setData?.active ? `<div class="vtt-ms-setbonus">✨ Set ${setData.type}</div>` : '';

  return `
    <div class="vtt-ms-bars">
      <div class="vtt-ms-bar-row">
        <span class="vtt-ms-bar-lbl">❤ PV</span>
        <div class="vtt-ms-bar-track"><div class="vtt-ms-bar-fill" style="width:${pvPct}%;background:${pvCol}"></div></div>
        <span class="vtt-ms-bar-num">${pvCur}/${pvMax}</span>
      </div>
      <div class="vtt-ms-bar-row">
        <span class="vtt-ms-bar-lbl">💧 PM</span>
        <div class="vtt-ms-bar-track"><div class="vtt-ms-bar-fill" style="width:${pmPct}%;background:#4f8cff"></div></div>
        <span class="vtt-ms-bar-num">${pmCur}/${pmMax}</span>
      </div>
    </div>
    <div class="vtt-ms-grid">${statsHtml}</div>
    <div class="vtt-ms-defenses">
      <div class="vtt-ms-def-item"><span>🛡 CA</span><strong>${calcCA(c)}</strong></div>
      <div class="vtt-ms-def-item"><span>⚡ Vit.</span><strong>${calcVitesse(c)}</strong></div>
      <div class="vtt-ms-def-item"><span>🎯 Maît.</span><strong>+${getMaitriseBonus(c)}</strong></div>
    </div>
    ${weaponHtml}${setHtml}
    ${_msXpSection(c, uid, canEdit)}`;
}

function _msXpSection(c, uid, canEdit) {
  const xp     = parseInt(c?.exp)    || 0;
  const niv    = parseInt(c?.niveau) || 1;
  const palier = calcPalier(niv);
  const pct    = palier > 0 ? Math.min(100, Math.round(xp / palier * 100)) : 0;

  if (canEdit) {
    return `
    <div class="vtt-ms-xp">
      <div class="vtt-ms-xp-row">
        <span class="vtt-ms-xp-label">⭐ XP</span>
        <input class="vtt-ms-xp-input" type="number" value="${xp}" min="0"
          onchange="window._vttMsSetXp('${c.id}','${uid}',+this.value)"
          onkeydown="if(event.key==='Enter'){window._vttMsSetXp('${c.id}','${uid}',+this.value);this.blur();event.preventDefault()}"
          title="XP total — Entrée pour valider">
        <span class="vtt-ms-xp-sep">/ ${palier}</span>
        <span class="vtt-ms-xp-niv">Niv.</span>
        <input class="vtt-ms-niv-input" type="number" value="${niv}" min="1" max="20"
          onchange="window._vttMsSetNiveau('${c.id}','${uid}',+this.value)">
      </div>
      <div class="vtt-ms-xp-row vtt-ms-xp-add-row">
        <span class="vtt-ms-xp-add-icon">+</span>
        <input class="vtt-ms-xp-input vtt-ms-xp-delta-input" type="number" min="1" placeholder="gagné"
          id="vtt-xp-delta-${c.id}-${uid}"
          onkeydown="if(event.key==='Enter'){window._vttMsAddXp('${c.id}','${uid}',+this.value);event.preventDefault()}"
          title="XP à ajouter — Entrée pour valider">
      </div>
      <div class="vtt-ms-bar-track"><div class="vtt-ms-bar-fill" style="width:${pct}%;background:#f59e0b"></div></div>
    </div>`;
  }
  return `
    <div class="vtt-ms-xp">
      <div class="vtt-ms-xp-row">
        <span class="vtt-ms-xp-label">⭐ XP</span>
        <span class="vtt-ms-xp-val">${xp} / ${palier}</span>
        <span class="vtt-ms-xp-badge">Niv. ${niv}</span>
      </div>
      <div class="vtt-ms-bar-track"><div class="vtt-ms-bar-fill" style="width:${pct}%;background:#f59e0b"></div></div>
    </div>`;
}

function _msTabEquipement(c, uid, canEdit) {
  const equip = c?.equipement||{}, inv = c?.inventaire||[];
  return `<div class="vtt-ms-slots">${_MS_SLOTS.map((slot, slotIdx) => {
    const equipped    = equip[slot];
    const equippedIdx = equipped?.sourceInvIndex ?? -1;
    const opts = inv.map((item, i) => {
      if (!_msItemFitsSlot(item, slot, equip, i)) return '';
      return `<option value="${i}"${equippedIdx===i?' selected':''}>${item.nom}${(item.qte||1)>1?' ×'+item.qte:''}</option>`;
    }).join('');
    return `<div class="vtt-ms-slot-row">
      <span class="vtt-ms-slot-lbl">${slot}</span>
      <div class="vtt-ms-slot-ctrl">${canEdit
        ? `<select class="vtt-ms-slot-sel" onchange="window._vttMsSlotChange(this,'${c.id}','${uid}',${slotIdx})">
             <option value="">— vide —</option>${opts}</select>`
        : `<span class="vtt-ms-slot-val">${equipped?.nom||'—'}</span>`}
      </div>
    </div>`;
  }).join('')}</div>`;
}

function _msTabSorts(c, uid, canEdit) {
  const sorts = c?.deck_sorts||[];
  if (!sorts.length) return '<div class="vtt-ms-empty">Aucun sort</div>';
  return `<div class="vtt-ms-sorts">${sorts.map((s, i) => {
    const types = Array.isArray(s.types) ? s.types.join(' · ') : (s.types||'');
    return `<div class="vtt-ms-sort${s.actif?' is-actif':''}">
      ${canEdit
        ? `<button class="vtt-ms-sort-toggle" onclick="window._vttToggleMsSort('${c.id}','${uid}',${i})" title="${s.actif?'Désactiver':'Activer'}">${s.actif?'✅':'⬜'}</button>`
        : `<span class="vtt-ms-sort-dot${s.actif?' on':''}">${s.actif?'●':'○'}</span>`}
      <div class="vtt-ms-sort-info">
        <span class="vtt-ms-sort-nom">${s.nom||'Sort'}</span>
        <div class="vtt-ms-sort-meta">
          ${s.pm?`<span class="vtt-ms-sort-pm">${s.pm} PM</span>`:''}
          ${types?`<span class="vtt-ms-sort-types">${types}</span>`:''}
        </div>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function _msTabInventaire(c, uid, canEdit) {
  const inv = c?.inventaire||[];
  if (!inv.length) return '<div class="vtt-ms-empty">Inventaire vide</div>';
  const groups = { arme:[], armure:[], bijou:[], consommable:[], divers:[] };
  inv.forEach((item, i) => { if (item?.nom) groups[_msCatItem(item)].push({ item, i }); });
  const CAT_LABEL = { arme:'⚔️ Armes', armure:'🛡 Armures', bijou:'💍 Bijoux', consommable:'🧪 Consommables', divers:'📦 Divers' };
  const equip = c?.equipement||{};
  let html = '<div class="vtt-ms-inv">';
  for (const [cat, entries] of Object.entries(groups)) {
    if (!entries.length) continue;
    html += `<div class="vtt-ms-inv-cat">${CAT_LABEL[cat]} <span class="vtt-ms-inv-cnt">(${entries.length})</span></div>`;
    for (const { item, i } of entries) {
      const isEq = Object.values(equip).some(e => e?.sourceInvIndex === i);
      html += `<div class="vtt-ms-inv-item${isEq?' is-equipped':''}">
        <div class="vtt-ms-inv-main">
          <span class="vtt-ms-inv-nom">${item.nom}</span>
          ${(item.qte||1)>1?`<span class="vtt-ms-inv-qte">×${item.qte}</span>`:''}
          ${isEq?'<span class="vtt-ms-inv-badge">équipé</span>':''}
        </div>
        ${item.degats?`<div class="vtt-ms-inv-detail">${item.degats}${item.typeArme?' · '+item.typeArme:''}</div>`:''}
        ${item.typeArmure&&!item.degats?`<div class="vtt-ms-inv-detail">${item.typeArmure}</div>`:''}
        ${canEdit?`<div class="vtt-ms-inv-actions">
          ${(cat==='arme'||cat==='armure'||cat==='bijou')&&!isEq
            ?`<button class="vtt-ms-inv-btn" onclick="window._vttMsEquipPicker('${c.id}','${uid}',${i})" title="Équiper">⚔️</button>`
            :isEq?`<button class="vtt-ms-inv-btn" onclick="window._vttMsUnequipAll('${c.id}','${uid}',${i})" title="Déséquiper">🔓</button>`:''}
          <button class="vtt-ms-inv-btn" onclick="window._vttMsSendPicker('${c.id}','${uid}',${i})" title="Envoyer">📤</button>
        </div>`:''}
      </div>`;
    }
  }
  html += '</div>';
  return html;
}

// ─── Rendu principal ─────────────────────────────────────────────

function _renderMiniSheet(uid) {
  const panel = document.getElementById('vtt-mini-panel');
  if (!panel) return;

  const pres = _presence[uid];
  if (!uid || !pres) { panel.classList.remove('open'); panel.innerHTML = ''; return; }

  const chars = Object.values(_characters).filter(c => c.uid === uid);
  if (!chars.length) {
    panel.classList.add('open');
    panel.innerHTML = `<div class="vtt-ms-empty">Aucun personnage lié pour ${pres.pseudo}.</div>`;
    return;
  }

  const validId = chars.find(c => c.id === _miniCharId) ? _miniCharId : chars[0].id;
  _miniCharId = validId;
  const c = chars.find(c => c.id === validId);
  const canEdit = _msCanEdit(uid);

  const img      = c?.photoURL || c?.photo || c?.avatar || null;
  const init     = (c?.nom || '?')[0].toUpperCase();
  const subtitle = [c?.race, c?.titreActuel||c?.titre, c?.niveau ? 'Niv.'+c.niveau : ''].filter(Boolean).join(' · ');

  const selectorHtml = chars.length > 1
    ? `<div class="vtt-ms-selector">${chars.map(ch =>
        `<button class="vtt-ms-sel-btn${ch.id===validId?' active':''}"
          onclick="window._vttSelectMiniChar('${uid}','${ch.id}')">${ch.nom||'Perso'}</button>`
      ).join('')}</div>`
    : '';

  const TABS = [
    { key:'combat', icon:'⚔️', label:'Combat'  },
    { key:'equip',  icon:'🛡',  label:'Équip.'  },
    { key:'sorts',  icon:'✨',  label:'Sorts'   },
    { key:'inv',    icon:'🎒',  label:'Invent.' },
  ];
  const tabBarHtml = `<div class="vtt-ms-tabbar">${TABS.map(t =>
    `<button class="vtt-ms-tab${_miniTab===t.key?' active':''}" onclick="window._vttMsTab('${t.key}')">${t.icon} ${t.label}</button>`
  ).join('')}</div>`;

  const tabHtml =
      _miniTab === 'combat' ? _msTabCombat(c, uid, canEdit)
    : _miniTab === 'equip'  ? _msTabEquipement(c, uid, canEdit)
    : _miniTab === 'sorts'  ? _msTabSorts(c, uid, canEdit)
    :                         _msTabInventaire(c, uid, canEdit);

  panel.classList.add('open');
  panel.innerHTML = `
    <div class="vtt-ms-header">
      ${img
        ? `<img class="vtt-ms-avatar" src="${img}" alt="">`
        : `<div class="vtt-ms-avatar-init">${init}</div>`}
      <div class="vtt-ms-info">
        <div class="vtt-ms-name">${c?.nom||'Personnage'}</div>
        ${subtitle ? `<div class="vtt-ms-sub">${subtitle}</div>` : ''}
        <div class="vtt-ms-player">👤 ${pres.pseudo}</div>
      </div>
      <button class="vtt-ms-close" onclick="window._vttToggleMiniSheet('${uid}')" title="Fermer">✕</button>
    </div>
    ${selectorHtml}
    ${tabBarHtml}
    <div class="vtt-ms-tab-content">${tabHtml}</div>`;
}

window._vttToggleMiniSheet = (uid) => {
  if (_miniUid === uid) {
    _miniUid = null; _miniCharId = null;
    const panel = document.getElementById('vtt-mini-panel');
    if (panel) { panel.classList.remove('open'); panel.innerHTML = ''; }
  } else {
    _miniUid = uid; _miniCharId = null;
    _renderMiniSheet(uid);
  }
  _renderPresenceCol();
};

window._vttSelectMiniChar = (uid, charId) => {
  _miniCharId = charId;
  _renderMiniSheet(uid);
};

PAGES.vtt=renderVttPage;
