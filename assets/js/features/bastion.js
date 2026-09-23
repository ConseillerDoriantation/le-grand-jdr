// ══════════════════════════════════════════════════════════════════════════════
// BASTION — Comptoir multi-activités
//
// Modèle Firestore : adventures/{aid}/bastion/main = {
//   nom, description, lieu, emoji,
//   semaine,                              // # semaine actuelle
//   or, renommee, influence,              // ressources
//   roomCatalog: [ { slug, nom, emoji, desc, color, niveaux } ],
//   salles: { [slug]: { niveau, builtAt, weeksLeftToBuild, targetNiveau } },
//   roomInvestmentSpent: { [slug]: number }, // contributions déjà consommées
//   coffre: [ { id, nom, quantite, emoji, source, weekAdded } ],
//   historique: [ { week, type, msg } ], // last 30
//   createdAt,
// }
// Une seule source de vérité, sync temps réel via watchDoc.
// ══════════════════════════════════════════════════════════════════════════════

import { STATE } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { getDocData, getDocDataSilent, updateInCol, loadCollection, loadCollectionWhere, loadRecentCollection, replaceDoc, saveDoc, addToCol, deleteFromCol, mutateInCol } from '../data/firestore.js';
import { tryDoc } from '../shared/crud.js';
import { watchRecent, watchDoc } from '../shared/realtime.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { openModal, closeModal, confirmModal, modalSection } from '../shared/modal.js';
import { _esc, _norm, appSplashHtml, skeletonHtml } from '../shared/html.js';
import { calcOr, getDefaultCharForUser } from '../shared/char-stats.js';
import { getVisibleCharacters } from '../shared/character-state.js';
import { characterAvatarHtml } from '../shared/portraits.js';
import { pickImageFile, compressDataUrl } from '../shared/image-upload.js';
import { applyEmotes, linkify } from './chat/chat-format.js';
import { ALL_EMOJIS, EMOJI_CATEGORIES } from '../shared/emoji-catalog.js';
import { getRouteSub } from '../shared/route.js';
import {
  BASTION_WALL_STATUSES,
  BASTION_WALL_TYPES,
  appendBastionWallComment,
  bastionWallCommentsForPost,
  bastionWallFilterForTarget,
  bastionWallLastActivity,
  bastionWallMentionedCharacters,
  bastionWallNotificationTargets,
  bastionWallReactionCounts,
  bastionWallSeenKey,
  bastionWallUnreadCount,
  normalizeBastionWallPost,
  sortBastionWallPosts,
  toggleBastionWallReaction,
} from '../shared/bastion-wall.js';
import { useGold } from '../shared/economy.js';
import { inventoryHistoryPayload, makeInventoryHistoryEntry } from '../shared/inventory-history.js';
import { shouldRestoreLegacyBastionCatalog } from '../shared/bastion-catalog.js';
import { roomFundingPlan, roomInvestmentAvailable } from '../shared/bastion-investments.js';


const STORE = {
  bastion:        null,          // document bastion principal
  depositGroups:  [],            // groupes de dépôt actifs
  editingItems:   [[], [], []],  // items en édition dans les 3 niveaux
  pickerFilters:  {},            // { [niveauIdx]: { cat, search } }
  shopItemsCache: null,          // cache items boutique (lazy)
  shopCatsCache:  null,          // cache catégories boutique (lazy)
  hireNpcsCache:  null,          // cache PNJ embauchables (lazy)
  npcsCache:      null,          // cache tous les PNJ (lazy)
  hireInProgress: false,
  coffreFilter:   'all',         // 'all'|'armes'|'armures'|…
  coffreSearch:   '',            // recherche normalisée (filtrage)
  coffreSearchRaw:'',            // texte saisi (affichage)
  coffreOpen:     null,          // id de l'objet du coffre déplié pour « Prendre »
  takeQty:        1,             // quantité choisie dans la ligne dépliée
  histoExpanded:  false,
  catalogMigrationInFlight: false,
  addingCustomRoom: false,
  investments: [],             // cagnotte ciblée par salle (1 doc / joueur / perso / salle)
  investmentInProgress: false,
  tab:            null,          // onglet actif : 'salles' | 'mur' | 'coffre' (résolu via _bsGetTab)
  roomSel:        null,          // slug de la salle sélectionnée (fiche de droite)
  roomFilter:     'all',         // 'all'|'built'|'funding'|'building'|'todo'
};


// Cache items boutique (rechargé à l'ouverture de l'éditeur)
async function _loadShopItems() {
  if (STORE.shopItemsCache && STORE.shopCatsCache) return STORE.shopItemsCache;
  const [items, cats] = await Promise.all([
    loadCollection('shop').catch(() => []),
    loadCollection('shopCategories').catch(() => []),
  ]);
  STORE.shopItemsCache = items;
  STORE.shopCatsCache  = cats;
  return STORE.shopItemsCache;
}
function _findShopItem(id) {
  return (STORE.shopItemsCache || []).find(it => it.id === id) || null;
}
function _findShopCat(id) {
  return (STORE.shopCatsCache || []).find(c => c.id === id) || null;
}

// ══════════════════════════════════════════════════════════════════════════════
// CATALOGUE DE SALLES
// Chaque salle a 3 niveaux. Production = ce qui est généré chaque semaine.
// ══════════════════════════════════════════════════════════════════════════════
// Ancien catalogue historique. Il ne doit plus être injecté dans toutes les
// aventures : il sert uniquement à migrer l'aventure originale `le-grand-jdr`.
const LEGACY_BASTION_ADVENTURE_ID = 'le-grand-jdr';
const ROOM_CATALOG_VERSION = 1;
const DEFAULT_ROOM_CATALOG = [
  {
    slug: 'forge', nom: 'Forge', emoji: '🔨',
    desc: 'Armes de corps-à-corps physiques et armures lourdes.',
    color: '#ff9544',
    niveaux: [
      { cout: 200,  semaines: 1, renommee: 0,  prod: { or: 0,  items: [] }, gainRenommee: 3, bonus: 'Réparation gratuite d\'une arme CaC ou armure lourde entre chaque mission.' },
      { cout: 500,  semaines: 2, renommee: 25, prod: { or: 0,  items: [] }, gainRenommee: 5, bonus: '+1 au jet de toucher du groupe pour les armes CaC lors des combats préparés.' },
      { cout: 1500, semaines: 3, renommee: 60, prod: { or: 0,  items: [] }, gainRenommee: 8, bonus: 'Une arme CaC ou une armure lourde du coffre peut être enchantée par session.' },
    ],
  },
  {
    slug: 'atelier_confection', nom: 'Atelier de confection', emoji: '🧵',
    desc: 'Armes à distance physiques et armures intermédiaires.',
    color: '#7eb0ff',
    niveaux: [
      { cout: 200,  semaines: 1, renommee: 0,  prod: { or: 0,  items: [] }, gainRenommee: 3, bonus: 'Cordes/munitions/cuir gratuits pour la prochaine mission.' },
      { cout: 500,  semaines: 2, renommee: 25, prod: { or: 0,  items: [] }, gainRenommee: 5, bonus: '+1 au jet de toucher du groupe pour les armes à distance.' },
      { cout: 1500, semaines: 3, renommee: 60, prod: { or: 0,  items: [] }, gainRenommee: 8, bonus: 'Une arme à distance ou armure intermédiaire du coffre peut être enchantée par session.' },
    ],
  },
  {
    slug: 'atelier_orfevre', nom: 'Atelier d\'orfèvre', emoji: '💎',
    desc: 'Armes magiques et bijoux enchantés.',
    color: '#b47fff',
    niveaux: [
      { cout: 250,  semaines: 2, renommee: 10, prod: { or: 0, items: [] }, gainRenommee: 3, bonus: 'Identification gratuite d\'un objet magique par mission.' },
      { cout: 700,  semaines: 3, renommee: 35, prod: { or: 0, items: [] }, gainRenommee: 5, bonus: 'Un bijou mineur peut être ré-enchanté par session.' },
      { cout: 2000, semaines: 4, renommee: 70, prod: { or: 0, items: [] }, gainRenommee: 8, bonus: 'Création d\'un bijou rare par mois (au choix du groupe).' },
    ],
  },
  {
    slug: 'herboristerie', nom: 'Herboristerie', emoji: '🌿',
    desc: 'Cultive plantes médicinales et distille des potions.',
    color: '#22c38e',
    niveaux: [
      { cout: 150,  semaines: 1, renommee: 0,  prod: { or: 0,  items: [{ nom: 'Potion de soin mineure',  emoji: '🧪', q: 2 }] }, gainRenommee: 2, bonus: 'Chaque joueur démarre la session avec 1 potion mineure gratuite.' },
      { cout: 400,  semaines: 2, renommee: 20, prod: { or: 0,  items: [{ nom: 'Potion de soin',          emoji: '🧪', q: 2 }, { nom: 'Antidote', emoji: '💚', q: 1 }] }, gainRenommee: 4, bonus: 'Immunité au poison commun pour le groupe pendant 1 mission/semaine.' },
      { cout: 1200, semaines: 3, renommee: 55, prod: { or: 0,  items: [{ nom: 'Potion de soin majeure',  emoji: '🧪', q: 2 }, { nom: 'Élixir rare', emoji: '⚗️', q: 1 }] }, gainRenommee: 7, bonus: 'Un élixir d\'amélioration de carac (+1 temporaire) accessible par session.' },
    ],
  },
  {
    slug: 'taverne', nom: 'Taverne', emoji: '🍻',
    desc: 'Génère de l\'or et permet de glaner des rumeurs.',
    color: '#e8b84b',
    niveaux: [
      { cout: 100,  semaines: 1, renommee: 0,  prod: { or: 30,  items: [] }, gainRenommee: 4, bonus: 'Une rumeur fiable par session (info MJ sur les quêtes en cours).' },
      { cout: 300,  semaines: 2, renommee: 15, prod: { or: 70,  items: [{ nom: 'Rumeur', emoji: '💬', q: 1 }] }, gainRenommee: 6, bonus: 'Repos long gratuit dans la taverne (récupération complète PV/PM).' },
      { cout: 900,  semaines: 3, renommee: 45, prod: { or: 150, items: [{ nom: 'Rumeur précieuse', emoji: '💎', q: 1 }] }, gainRenommee: 10, bonus: 'Contact direct avec un PNJ influent par mois (au choix du MJ).' },
    ],
  },
  {
    slug: 'comptoir', nom: 'Comptoir', emoji: '💰',
    desc: 'Réseau marchand : or passif, achats à bon prix.',
    color: '#f4c430',
    niveaux: [
      { cout: 250,  semaines: 1, renommee: 5,  prod: { or: 50,  items: [] }, gainRenommee: 2, bonus: '-5% sur les achats à la boutique pour tout le groupe.' },
      { cout: 700,  semaines: 2, renommee: 30, prod: { or: 120, items: [] }, gainRenommee: 4, bonus: '-10% sur les achats + revente à 60% (au lieu de 50%).' },
      { cout: 2000, semaines: 3, renommee: 65, prod: { or: 300, items: [] }, gainRenommee: 7, bonus: 'Accès à un marché caché : 1 objet rare achetable par mois.' },
    ],
  },
  {
    slug: 'bibliotheque', nom: 'Bibliothèque', emoji: '📜',
    desc: 'Scrolls, savoir arcanique et recherche.',
    color: '#9d6fff',
    niveaux: [
      { cout: 200,  semaines: 2, renommee: 10, prod: { or: 0,  items: [{ nom: 'Scroll mineur', emoji: '📜', q: 1 }] }, gainRenommee: 3, bonus: 'Avantage à 1 jet d\'Intelligence / session pour le groupe.' },
      { cout: 600,  semaines: 3, renommee: 35, prod: { or: 0,  items: [{ nom: 'Scroll commun', emoji: '📜', q: 1 }, { nom: 'Savoir ancien', emoji: '🔮', q: 1 }] }, gainRenommee: 5, bonus: 'Le groupe connaît la faiblesse d\'une créature avant la rencontre.' },
      { cout: 1800, semaines: 4, renommee: 70, prod: { or: 0,  items: [{ nom: 'Scroll rare',   emoji: '📜', q: 1 }, { nom: 'Tome arcanique', emoji: '📕', q: 1 }] }, gainRenommee: 9, bonus: 'Apprentissage d\'un sort supplémentaire au prochain levelup.' },
    ],
  },
  {
    slug: 'entrepot', nom: 'Entrepôt', emoji: '📦',
    desc: 'Étend la capacité de stockage du coffre commun. +10 par niveau, jusqu\'à 99.',
    color: '#a0a8b8',
    // Mode spécial : niveau illimité jusqu'à maxLevel, pas de PNJ assignable
    unlimited: true,
    maxLevel: 99,
    baseCost: 100,             // coût du 1er niveau
    costMultiplier: 1.10,      // x1.10 par niveau (croissance douce)
    baseSemaines: 1,
    capacitePerLevel: 10,      // +10 capacité par niveau
    gainRenommeePerLevel: 1,
    niveaux: [],               // non utilisé
  },
  {
    slug: 'sanctuaire', nom: 'Sanctuaire', emoji: '✨',
    desc: 'Soigne et bénit le groupe entre les sessions.',
    color: '#f0f9ff',
    niveaux: [
      { cout: 250,  semaines: 2, renommee: 15, prod: { or: 0, items: [{ nom: 'Bénédiction mineure', emoji: '✨', q: 1 }] }, gainRenommee: 3, bonus: 'Récupération complète des PV en début de chaque session.' },
      { cout: 700,  semaines: 3, renommee: 40, prod: { or: 0, items: [{ nom: 'Bénédiction', emoji: '✨', q: 1 }, { nom: 'Eau bénite', emoji: '💧', q: 2 }] }, gainRenommee: 5, bonus: 'Résurrection possible 1× par mois (avec coût narratif).' },
      { cout: 1800, semaines: 4, renommee: 75, prod: { or: 0, items: [{ nom: 'Bénédiction majeure', emoji: '🌟', q: 1 }, { nom: 'Relique sacrée', emoji: '🏵️', q: 1 }] }, gainRenommee: 9, bonus: 'Bénédiction permanente (+1 jet de soin choisi) pour le groupe.' },
    ],
  },
  {
    slug: 'voliere', nom: 'Volière', emoji: '🦅',
    desc: 'Messagerie rapide, exploration et reconnaissance.',
    color: '#4f8cff',
    niveaux: [
      { cout: 180,  semaines: 1, renommee: 5,  prod: { or: 0, items: [{ nom: 'Message rapide', emoji: '📨', q: 1 }] }, gainRenommee: 2, bonus: 'Communication instantanée avec un PNJ connu (1×/session).' },
      { cout: 500,  semaines: 2, renommee: 25, prod: { or: 0, items: [{ nom: 'Reconnaissance', emoji: '🗺️', q: 1 }] }, gainRenommee: 4, bonus: 'Carte aérienne d\'une zone d\'exploration (avant la mission).' },
      { cout: 1400, semaines: 3, renommee: 55, prod: { or: 0, items: [{ nom: 'Info stratégique', emoji: '🎯', q: 1 }] }, gainRenommee: 6, bonus: 'Surprise au combat impossible : le groupe agit en premier.' },
    ],
  },
];

const NIVEAU_LABEL = ['', 'I', 'II', 'III'];

// ══════════════════════════════════════════════════════════════════════════════
// STATE + HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function _defaultBastion() {
  return {
    nom: 'Le Bastion',
    description: '',
    lieu: '',
    emoji: '🏰',
    semaine: 1,
    or: 0,
    renommee: 0,
    influence: 0,
    salles: {},     // { [slug]: { niveau, builtAt, weeksLeftToBuild, targetNiveau } }
    coffre: [],     // [ { id, nom, quantite, emoji, source, weekAdded } ]
    historique: [], // last 30
    annonces: [],   // mur des annonces : [ { id, uid, author, type, text, ts } ] — newest first
    roomCatalog: [], // catalogue propre à cette aventure
    roomCatalogVersion: ROOM_CATALOG_VERSION,
    createdAt: Date.now(),
  };
}

function _clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function _isLegacyBastionAdventure() {
  return STATE.adventure?.id === LEGACY_BASTION_ADVENTURE_ID;
}

function _normalizeRoomDef(def = {}) {
  const room = {
    ...def,
    niveaux: Array.isArray(def.niveaux) ? def.niveaux.map(n => ({
      ...n,
      prod: {
        or: parseInt(n?.prod?.or) || 0,
        items: Array.isArray(n?.prod?.items) ? n.prod.items.map(it => ({ ...it })) : [],
      },
    })) : [],
  };
  room.slug = room.slug || `custom_${Date.now().toString(36)}`;
  room.nom = room.nom || 'Salle sans nom';
  room.emoji = room.emoji || '🏠';
  room.desc = room.desc || '';
  room.color = room.color || '#7eb0ff';
  return room;
}

function _legacyRoomCatalogFrom(b = {}) {
  const ov = b?.catalogOverrides || {};
  const defaults = DEFAULT_ROOM_CATALOG.map(def => {
    const o = ov[def.slug];
    if (!o) return _normalizeRoomDef(_clone(def));
    const niveaux = (def.niveaux || []).map((n, i) => ({ ...n, ...(o.niveaux?.[i] || {}) }));
    return _normalizeRoomDef({ ...def, ...o, slug: def.slug, niveaux, isCustom: false });
  });
  const customs = (b?.customRooms || []).map(c => _normalizeRoomDef({ ...c, isCustom: true }));
  return [...defaults, ...customs];
}

function _shouldRestoreLegacyRoomCatalog(source = {}) {
  return shouldRestoreLegacyBastionCatalog(source, {
    isLegacyAdventure: _isLegacyBastionAdventure(),
    legacySlugs: DEFAULT_ROOM_CATALOG.map(room => room.slug),
  });
}

function _normalizeBastionDoc(data) {
  const source = (data && typeof data === 'object') ? data : {};
  const b = { ..._defaultBastion(), ...source };
  const storedCatalog = Array.isArray(source.roomCatalog)
    ? source.roomCatalog.map(_normalizeRoomDef).filter(r => r.slug)
    : null;

  if (storedCatalog?.length) {
    b.roomCatalog = storedCatalog;
    b.roomCatalogVersion = source.roomCatalogVersion || ROOM_CATALOG_VERSION;
    return { bastion: b, migrated: false };
  }

  // Un tableau vide ne doit pas effacer visuellement le catalogue historique.
  // On restaure aussi les aventures non historiques portant encore des traces
  // explicites de l'ancien modèle (salles, overrides, customs ou personnel).
  if (data && _shouldRestoreLegacyRoomCatalog(source)) {
    b.roomCatalog = _legacyRoomCatalogFrom(source);
    b.roomCatalogVersion = ROOM_CATALOG_VERSION;
    b.legacyRoomCatalogMigratedAt = b.legacyRoomCatalogMigratedAt || Date.now();
    return { bastion: b, migrated: true };
  }

  b.roomCatalog = [];
  b.roomCatalogVersion = ROOM_CATALOG_VERSION;
  return { bastion: b, migrated: false };
}

async function _persistBastionCatalogMigration(b) {
  if (!STATE.isAdmin || STORE.catalogMigrationInFlight || !b?.legacyRoomCatalogMigratedAt) return;
  STORE.catalogMigrationInFlight = true;
  try {
    await _save(b);
  } catch (e) {
    console.warn('[bastion] migration catalogue non persistée', e?.code || e);
  } finally {
    STORE.catalogMigrationInFlight = false;
  }
}

// Catalogue effectif = catalogue stocké dans le Bastion courant.
function _getRoomCatalog(b) {
  const catalog = Array.isArray(b?.roomCatalog)
    ? b.roomCatalog.map(_normalizeRoomDef).filter(r => r.slug)
    : [];
  if (catalog.length) return catalog;
  return _shouldRestoreLegacyRoomCatalog(b || {}) ? _legacyRoomCatalogFrom(b || {}) : [];
}

function _getRoomDef(slug, b) {
  return _getRoomCatalog(b || STORE.bastion).find(r => r.slug === slug);
}

// Capacité totale du coffre = base + (niveau Entrepôt × capacitePerLevel)
function _bastionCapacity(b) {
  const BASE = 20;
  const cat = _getRoomCatalog(b);
  const entrepot = cat.find(r => r.slug === 'entrepot');
  if (!entrepot) return BASE;
  const niv = _roomNiveau(b, 'entrepot');
  if (niv <= 0) return BASE;
  // Mode unlimited : capacité linéaire ; sinon, niveau du catalogue
  if (entrepot.unlimited) {
    return BASE + niv * (entrepot.capacitePerLevel || 10);
  }
  return entrepot.niveaux[niv - 1]?.capacite || BASE;
}

// Renvoie les données du niveau (cout, semaines, etc.) — gère unlimited
function _getNiveauData(def, targetNiveau) {
  if (def.unlimited) {
    const mult = def.costMultiplier || 1.1;
    const baseCost = def.baseCost || 100;
    return {
      cout:         Math.round(baseCost * Math.pow(mult, targetNiveau - 1)),
      semaines:     def.baseSemaines || 1,
      renommee:     0,
      gainRenommee: def.gainRenommeePerLevel || 1,
      prod:         { or: 0, items: [] },
      bonus:        `Capacité du coffre : ${20 + targetNiveau * (def.capacitePerLevel || 10)} objets.`,
    };
  }
  return def.niveaux[targetNiveau - 1];
}

// Niveau max d'une salle (3 par défaut, ou maxLevel pour unlimited)
function _maxLevel(def) {
  return def.unlimited ? (def.maxLevel || 99) : 3;
}

// Nombre d'objets actuellement stockés (somme des quantités)
function _bastionInvCount(b) {
  return (b?.coffre || []).reduce((s, it) => s + (it.quantite || 0), 0);
}

// Renvoie le niveau actuellement actif d'une salle (0 = pas construite)
function _roomNiveau(b, slug) {
  return b?.salles?.[slug]?.niveau || 0;
}

// True si la salle est en construction
function _roomBuilding(b, slug) {
  const s = b?.salles?.[slug];
  return !!(s && s.weeksLeftToBuild > 0);
}

function _roomInvestmentAvailable(b, slug) {
  return roomInvestmentAvailable(b, STORE.investments, slug);
}

function _roomInvestmentContributors(slug) {
  const contributors = new Map();
  for (const investment of STORE.investments || []) {
    if (investment?.roomSlug !== slug || !(Number(investment.amount) > 0)) continue;
    const key = investment.charId || investment.uid || investment.id;
    const current = contributors.get(key) || {
      charId: investment.charId || '',
      charName: investment.charName || 'Personnage',
      amount: 0,
    };
    current.amount += Number(investment.amount) || 0;
    contributors.set(key, current);
  }
  return [...contributors.values()].sort((a, b) => b.amount - a.amount || a.charName.localeCompare(b.charName, 'fr'));
}

function _decodeBastionEntities(value = '') {
  let text = String(value ?? '');
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  for (let i = 0; i < 3; i++) {
    const next = text.replace(/&(#(\d+)|#x([0-9a-f]+)|[a-z]+);/gi, (m, body, dec, hex) => {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      return named[body.toLowerCase()] ?? m;
    });
    if (next === text) break;
    text = next;
  }
  return text;
}

function _mojibakeScore(text = '') {
  return (String(text).match(/[ÃÂâð]|�/g) || []).length;
}

function _repairBastionText(value = '') {
  let text = _decodeBastionEntities(value);
  if (!_mojibakeScore(text)) return text;

  if ([...text].every(ch => ch.codePointAt(0) <= 255) && typeof TextDecoder !== 'undefined') {
    try {
      const bytes = Uint8Array.from([...text], ch => ch.codePointAt(0));
      const fixed = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (_mojibakeScore(fixed) < _mojibakeScore(text)) return fixed;
    } catch (_) {}
  }

  const replacements = [
    ['Ã€', 'À'], ['Ã‚', 'Â'], ['Ã‡', 'Ç'], ['Ãˆ', 'È'], ['Ã‰', 'É'], ['ÃŠ', 'Ê'], ['Ã‹', 'Ë'],
    ['ÃŽ', 'Î'], ['Ã', 'Ï'], ['Ã”', 'Ô'], ['Ã™', 'Ù'], ['Ã›', 'Û'], ['Ãœ', 'Ü'],
    ['Ã ', 'à'], ['Ã¢', 'â'], ['Ã§', 'ç'], ['Ã¨', 'è'], ['Ã©', 'é'], ['Ãª', 'ê'], ['Ã«', 'ë'],
    ['Ã®', 'î'], ['Ã¯', 'ï'], ['Ã´', 'ô'], ['Ã¶', 'ö'], ['Ã¹', 'ù'], ['Ã»', 'û'], ['Ã¼', 'ü'],
    ['Å“', 'œ'], ['Å’', 'Œ'], ['Ã¦', 'æ'], ['Ã†', 'Æ'],
    ['Â·', '·'], ['Â«', '«'], ['Â»', '»'], ['Â°', '°'], ['Â²', '²'], ['Â ', ' '],
    ['â€“', '-'], ['â€”', '-'], ['â€¦', '…'], ['â€˜', "'"], ['â€™', "'"], ['â€œ', '"'], ['â€', '"'],
  ];
  for (const [from, to] of replacements) text = text.split(from).join(to);
  return text;
}

function _addHistorique(b, type, msg) {
  const e = { week: b.semaine, type, msg: _repairBastionText(msg), ts: Date.now() };
  b.historique = [e, ...(b.historique || [])].slice(0, 30);
}

function _addToCoffre(b, item, source) {
  // On regroupe par shopItemId si présent, sinon par nom
  const matchKey = (c) => item.shopItemId
    ? c.originalItem?.itemId === item.shopItemId
    : c.nom === item.nom && !c.originalItem?.itemId;
  const existing = (b.coffre || []).find(matchKey);
  if (existing) {
    existing.quantite = (existing.quantite || 0) + (item.q || 1);
    existing.weekAdded = b.semaine;
    return;
  }
  const entry = {
    id: `c_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    nom: item.nom,
    emoji: item.emoji || '📦',
    quantite: item.q || 1,
    source,
    weekAdded: b.semaine,
  };
  // Si l'item est lié à la boutique, snapshot complet → retrait fidèle dans l'inventaire
  if (item.shopItemId) {
    const shopItem = _findShopItem(item.shopItemId);
    if (shopItem) {
      entry.originalItem = { ...shopItem, itemId: shopItem.id, qte: 1 };
    }
  }
  b.coffre = [...(b.coffre || []), entry];
}

// ══════════════════════════════════════════════════════════════════════════════
// FIRESTORE — Sauvegarde + listener temps réel
// ══════════════════════════════════════════════════════════════════════════════
const _save = (b) => tryDoc('bastion', 'main', b);

// Mur des annonces : collection dédiée `bastionAnnonces` (écrivable par les
// membres, contrairement au doc bastion/main réservé au MJ). Chargée en direct.
let _annonces = [];
let _legacyAnnonces = [];
let _wallComments = [];
let _wallRead = null;
const _wallMedia = new Map();
let _wallEmotes = [];
let _wallAdventureId = '';
const _wallUi = {
  draftText: '',
  type: 'message',
  charId: '',
  images: [],
  visible: 12,
  pickerOpen: false,
  filter: 'all',
  reactionPostId: '',
  replyOpen: new Set(),
  replyDrafts: new Map(),
  menuPostId: '',
  editPostId: '',
  editPostText: '',
  editPostType: 'message',
  editCommentId: '',
  editCommentText: '',
  focusedPostId: '',
};

let _wallDraftTimer = null;
let _wallSeenTimer = null;
let _wallSeenWriteAt = 0;

function _wallDraftKey() {
  return `bastion-wall-draft:${STATE.adventure?.id || 'default'}:${STATE.user?.uid || 'anon'}`;
}

function _wallPersistDraft() {
  clearTimeout(_wallDraftTimer);
  _wallDraftTimer = setTimeout(() => {
    try {
      const hasDraft = _wallUi.draftText.trim() || _wallUi.images.length;
      if (!hasDraft) localStorage.removeItem(_wallDraftKey());
      else localStorage.setItem(_wallDraftKey(), JSON.stringify({
        text: _wallUi.draftText,
        type: _wallUi.type,
        charId: _wallUi.charId,
        images: _wallUi.images,
        savedAt: Date.now(),
      }));
    } catch (error) {
      console.warn('[bastion] brouillon local indisponible', error);
    }
  }, 180);
}

function _wallRestoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(_wallDraftKey()) || 'null');
    if (!draft || typeof draft !== 'object') return;
    _wallUi.draftText = String(draft.text || '').slice(0, 4000);
    _wallUi.type = BASTION_WALL_TYPES[draft.type] ? draft.type : 'message';
    _wallUi.charId = String(draft.charId || '');
    _wallUi.images = (Array.isArray(draft.images) ? draft.images : []).filter(Boolean).slice(0, 3);
  } catch { /* brouillon absent ou corrompu */ }
}

function _wallClearDraft() {
  clearTimeout(_wallDraftTimer);
  try { localStorage.removeItem(_wallDraftKey()); } catch { /* stockage privé */ }
}

function _wallTargetFromRoute() {
  const match = getRouteSub('bastion').match(/^post:([\w.-]+)$/);
  return match?.[1] || '';
}

function _wallFocusTarget() {
  const id = _wallTargetFromRoute();
  if (!id || _wallUi.focusedPostId === id) return;
  const card = document.getElementById(`bastion-post-${id}`);
  if (!card) return;
  _wallUi.focusedPostId = id;
  card.classList.add('is-targeted');
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => card.classList.remove('is-targeted'), 3200);
}

function _wallImages(post) {
  if (post.images?.length) return post.images;
  return _wallMedia.get(post.id) || [];
}

function _wallReceivePosts(docs = []) {
  _annonces = sortBastionWallPosts((docs || []).filter(entry =>
    entry.id !== 'main' && (entry.kind === 'post' || entry.text)
  ));
  const targetPost = _annonces.find(post => post.id === _wallTargetFromRoute());
  // Sans cible dans l'URL, `targetPost` vaut undefined : il ne faut surtout pas
  // interpréter cette absence comme une publication terminée. Un lien direct
  // choisit uniquement la vue nécessaire pour rendre sa publication visible.
  _wallUi.filter = bastionWallFilterForTarget(_wallUi.filter, targetPost);
  const targetIndex = _annonces.findIndex(post => post.id === targetPost?.id);
  if (targetIndex >= _wallUi.visible) _wallUi.visible = targetIndex + 1;
  void _wallHydrateMedia(_annonces.slice(0, _wallUi.visible));
  if (STATE.currentPage === 'bastion') _renderPage();
}

async function _wallHydrateMedia(posts = []) {
  const pending = posts.filter(post => post.imageCount > 0 && !post.images?.length && !_wallMedia.has(post.id));
  if (!pending.length) return;
  await Promise.all(pending.map(async post => {
    const media = await getDocDataSilent('bastionWallMedia', post.mediaId || post.id).catch(() => null);
    _wallMedia.set(post.id, (Array.isArray(media?.images) ? media.images : []).filter(Boolean).slice(0, 3));
  }));
  if (STATE.currentPage === 'bastion') _renderPage();
}

function _attachListener() {
  // watchDoc gère lui-même le re-subscribe (kill listener précédent du même nom).
  watchDoc('bastion', 'bastion', 'main', (data) => {
    const isFirst = !STORE.bastion;
    const prevWeek = STORE.bastion?.semaine;
    const normalized = _normalizeBastionDoc(data);
    STORE.bastion = normalized.bastion;
    if (normalized.migrated) void _persistBastionCatalogMigration(STORE.bastion);
    // Notif douce si la semaine a avancé (vu côté joueur après que le MJ a cliqué)
    if (!isFirst && prevWeek != null && STORE.bastion.semaine > prevWeek && !STATE.isAdmin) {
      showNotif(`🕰 Période ${STORE.bastion.semaine} : votre bastion a changé !`, 'success');
    }
    if (STATE.currentPage === 'bastion') _renderPage();
  });
  // Mur social : les nouvelles publications vivent chacune dans leur document.
  // `main.items` reste lu pour afficher les anciennes annonces sans migration
  // destructive ni duplication.
  watchDoc('bastionAnnoncesLegacy', 'bastionAnnonces', 'main', main => {
    _legacyAnnonces = (Array.isArray(main?.items) ? main.items : []).map((item, index) => ({
      ...item,
      id: item.id || `legacy_${index}`,
      legacy: true,
      legacyIndex: index,
    }));
    if (STATE.currentPage === 'bastion') _renderPage();
  });
  watchRecent('bastionAnnonces', 'bastionAnnonces', docs => {
    _wallReceivePosts(docs);
  }, { field: 'ts', max: 80 });
  watchRecent('bastionWallComments', 'bastionWallComments', docs => {
    _wallComments = docs || [];
    if (STATE.currentPage === 'bastion') _renderPage();
  }, { field: 'ts', max: 200, silent: true });
  // Collection structurellement bornée : un document cumulé par
  // joueur/personnage/salle, jamais un document par versement.
  watchRecent('bastionInvestments', 'bastionInvestments', docs => {
    STORE.investments = docs || [];
    if (STATE.currentPage === 'bastion') _renderPage();
  }, { field: 'updatedAt', max: 500, silent: true });
  if (STATE.user?.uid) watchDoc('bastionWallRead', 'bastionWallReads', STATE.user.uid, data => {
    _wallRead = data || null;
  }, { silent: true });
}

// ══════════════════════════════════════════════════════════════════════════════
// ACTIONS — MJ
// ══════════════════════════════════════════════════════════════════════════════
async function _bastionBuild(slug) {
  if (!STATE.isAdmin) return;
  const b = { ...STORE.bastion } || _defaultBastion();
  const def = _getRoomDef(slug);
  if (!def) return;

  const curNiv = _roomNiveau(b, slug);
  const max = _maxLevel(def);
  if (curNiv >= max) { showNotif('Niveau maximum atteint.', 'error'); return; }
  if (_roomBuilding(b, slug)) { showNotif('Déjà en construction.', 'error'); return; }

  const target = curNiv + 1;
  const niveauDef = _getNiveauData(def, target);

  // La cagnotte ciblée est consommée avant le trésor commun. Les contributions
  // restent dans leur journal dédié ; `roomInvestmentSpent` mémorise la part
  // déjà utilisée afin qu'une même pièce d'or ne finance jamais deux niveaux.
  const plan = roomFundingPlan(niveauDef.cout, _roomInvestmentAvailable(b, slug), b.or || 0);
  if (!plan.canFund) {
    showNotif(`Financement insuffisant : ${plan.missing} or manquants.`, 'error');
    return;
  }

  b.or = (b.or || 0) - plan.treasuryUsed;
  b.roomInvestmentSpent = { ...(b.roomInvestmentSpent || {}) };
  b.roomInvestmentSpent[slug] = (Number(b.roomInvestmentSpent[slug]) || 0) + plan.investmentUsed;
  b.salles = { ...(b.salles || {}) };
  b.salles[slug] = {
    niveau: curNiv,                  // niveau actuel inchangé tant que construction pas finie
    targetNiveau: target,
    weeksLeftToBuild: niveauDef.semaines,
    builtAt: b.salles[slug]?.builtAt || null,
    investmentUsed: plan.investmentUsed,
    treasuryUsed: plan.treasuryUsed,
  };
  _addHistorique(b, 'construction',
    `🏗 ${def.emoji} ${def.nom} — construction niveau ${def.unlimited ? target : NIVEAU_LABEL[target]} commencée (${niveauDef.semaines} période, ${niveauDef.cout} or · ${plan.investmentUsed} investis · ${plan.treasuryUsed} trésor)`);

  await _save(b);
  showNotif(`Construction de ${def.nom} ${NIVEAU_LABEL[target]} lancée.`, 'success');
}

// Annule une construction EN COURS : rembourse l'or et remet la salle dans son
// état d'avant le lancement (niveau actuel inchangé, plus de chantier).
async function _bastionCancelBuild(slug) {
  if (!STATE.isAdmin) return;
  const b = JSON.parse(JSON.stringify(STORE.bastion || {}));
  const s = b.salles?.[slug];
  if (!s || !(s.weeksLeftToBuild > 0)) { showNotif('Aucune construction en cours ici.', 'error'); return; }
  const def = _getRoomDef(slug, b);
  const target = s.targetNiveau;
  const niveauDef = def ? _getNiveauData(def, target) : null;
  const legacyRefund = niveauDef?.cout || 0;
  const investmentRefund = Math.max(0, Number(s.investmentUsed) || 0);
  const treasuryRefund = s.treasuryUsed == null
    ? legacyRefund
    : Math.max(0, Number(s.treasuryUsed) || 0);
  const tLabel = def?.unlimited ? `${target}` : (NIVEAU_LABEL[target] || target);
  const ok = await confirmModal(
    `Annuler la construction de ${def?.emoji || ''} ${_esc(def?.nom || slug)} (niveau ${tLabel}) ?\n\n${treasuryRefund} or retourneront au trésor${investmentRefund ? ` et ${investmentRefund} or à la cagnotte de la salle` : ''}.`,
    { title: '✖ Annuler la construction', okLabel: '✖ Annuler la construction', cancelLabel: 'Garder' }
  ).catch(() => false);
  if (!ok) return;

  b.or = (b.or || 0) + treasuryRefund;
  if (investmentRefund > 0) {
    b.roomInvestmentSpent = { ...(b.roomInvestmentSpent || {}) };
    b.roomInvestmentSpent[slug] = Math.max(0, (Number(b.roomInvestmentSpent[slug]) || 0) - investmentRefund);
  }
  const prevNiv = s.niveau || 0;
  // Remet la salle à son niveau d'avant le chantier (0 = non construite). On écrit
  // des valeurs explicites car la sauvegarde est en merge (un delete serait ignoré).
  b.salles = { ...(b.salles || {}) };
  b.salles[slug] = {
    niveau: prevNiv,
    targetNiveau: null,
    weeksLeftToBuild: 0,
    builtAt: s.builtAt || null,
    investmentUsed: 0,
    treasuryUsed: 0,
  };
  _addHistorique(b, 'construction',
    `✖ ${def?.emoji || ''} ${def?.nom || slug} — construction annulée (${treasuryRefund} or au trésor${investmentRefund ? `, ${investmentRefund} or rendus disponibles dans la cagnotte` : ''})`);
  await _save(b);
  showNotif('Construction annulée — financement restauré.', 'success');
}

async function _bastionAdvanceWeek() {
  if (!STATE.isAdmin) return;
  if (!STORE.bastion) return;
  const ok = await confirmModal('▶ Passer à la période suivante ?\n\nProductions appliquées, constructions avancées, salaires payés.', {
    title: '🕰 Passer une période',
    okLabel: '▶ Avancer',
    cancelLabel: 'Annuler',
  }).catch(() => false);
  if (!ok) return;

  // Snapshot de l'état AVANT avancée → permet d'annuler la dernière période.
  // On retire l'éventuel snapshot précédent pour éviter l'imbrication récursive
  // (un seul niveau d'annulation conservé).
  const snapshot = JSON.parse(JSON.stringify(STORE.bastion));
  delete snapshot._undoSnapshot;

  const b = JSON.parse(JSON.stringify(STORE.bastion));
  b.semaine = (b.semaine || 1) + 1;

  let totalOrProduit = 0;
  let totalItemsProduits = 0;
  const events = [];

  // 1. Avancer les constructions
  for (const slug of Object.keys(b.salles || {})) {
    const s = b.salles[slug];
    if (s.weeksLeftToBuild > 0) {
      s.weeksLeftToBuild -= 1;
      if (s.weeksLeftToBuild <= 0) {
        // Construction terminée — on RAZ avec valeurs explicites (saveDoc=merge → un delete serait ignoré)
        s.niveau = s.targetNiveau;
        s.builtAt = b.semaine;
        s.targetNiveau = null;
        s.weeksLeftToBuild = 0;
        const def = _getRoomDef(slug);
        const nivLabel = def.unlimited ? `Niv. ${s.niveau}` : NIVEAU_LABEL[s.niveau];
        events.push(`✅ ${def.emoji} ${def.nom} ${nivLabel} terminée`);
      }
    }
  }

  // 2. Production des salles actives (niveau >= 1, pas en construction)
  for (const slug of Object.keys(b.salles || {})) {
    const s = b.salles[slug];
    if (!s.niveau || s.niveau < 1) continue;
    if (s.weeksLeftToBuild > 0) continue;
    const def = _getRoomDef(slug);
    if (!def) continue;
    const niveauDef = _getNiveauData(def, s.niveau);
    if (!niveauDef || !niveauDef.prod) continue;
    // Or
    if (niveauDef.prod.or > 0) {
      b.or = (b.or || 0) + niveauDef.prod.or;
      totalOrProduit += niveauDef.prod.or;
    }
    // Items
    for (const item of (niveauDef.prod.items || [])) {
      _addToCoffre(b, item, `${def.emoji} ${def.nom}`);
      totalItemsProduits += item.q || 1;
    }
  }

  // 3. Salaires du personnel (débités du trésor, plafonné à 0)
  const totalSalaires = (b.personnel || []).reduce((s, e) => s + (parseInt(e.salaire) || 0), 0);
  if (totalSalaires > 0) {
    const available = b.or || 0;
    const paid = Math.min(available, totalSalaires);
    b.or = available - paid;
    if (paid < totalSalaires) {
      events.push(`⚠ Salaires impayés : ${totalSalaires - paid} or manquants`);
    }
  }

  // 4. Historique
  let msg = `📅 Période ${b.semaine}. `;
  const parts = [];
  if (totalOrProduit > 0) parts.push(`+${totalOrProduit} or`);
  if (totalItemsProduits > 0) parts.push(`+${totalItemsProduits} item${totalItemsProduits > 1 ? 's' : ''}`);
  if (totalSalaires > 0) parts.push(`−${totalSalaires} or salaires`);
  if (events.length) parts.push(events.join(' · '));
  msg += parts.length ? parts.join(', ') : 'aucune production.';
  _addHistorique(b, 'week', msg);

  b._undoSnapshot = snapshot;   // jeton d'annulation de CETTE avancée
  await _save(b);
  const summary = [
    totalOrProduit > 0 ? `+${totalOrProduit} or` : null,
    totalItemsProduits > 0 ? `+${totalItemsProduits} item${totalItemsProduits > 1 ? 's' : ''}` : null,
    totalSalaires > 0 ? `−${totalSalaires} salaires` : null,
  ].filter(Boolean).join(' · ') || 'aucune production';
  showNotif(`▶ Période ${b.semaine} — ${summary}`, 'success');
}

// Annule la DERNIÈRE avancée de période : restaure le snapshot pris juste avant
// (or, productions, salaires, constructions). Un seul niveau d'annulation.
async function _bastionUndoWeek() {
  if (!STATE.isAdmin) return;
  const cur = STORE.bastion;
  if (!cur?._undoSnapshot) { showNotif('Aucune période récente à annuler.', 'error'); return; }
  const ok = await confirmModal(
    `↩ Annuler la dernière période ?\n\nLe bastion revient exactement à son état d'avant le dernier passage de période (or, productions, salaires et constructions inclus).`,
    { title: '↩ Annuler la période', okLabel: '↩ Annuler la période', cancelLabel: 'Garder' }
  ).catch(() => false);
  if (!ok) return;
  const restored = JSON.parse(JSON.stringify(cur._undoSnapshot));
  restored._undoSnapshot = null;   // pas de double annulation (merge → null, pas delete)
  await _save(restored);
  showNotif(`↩ Dernière période annulée — retour à la période ${restored.semaine || 1}.`, 'success');
}

async function _bastionEditIdentite() {
  if (!STATE.isAdmin) return;
  const b = STORE.bastion || _defaultBastion();
  openModal('🏰 Identité du Bastion', `
    ${modalSection('📋 Informations générales', `
      <div class="form-group" style="margin:0 0 .6rem"><label>Nom</label>
        <input class="input-field" id="bas-nom" value="${_esc(b.nom||'')}"></div>
      <div class="form-group" style="margin:0 0 .6rem"><label>Emoji / icône</label>
        <input class="input-field" id="bas-emoji" value="${_esc(b.emoji||'🏰')}" maxlength="4" style="max-width:90px;font-size:1.4rem;text-align:center"></div>
      <div class="form-group" style="margin:0 0 .6rem"><label>Lieu</label>
        <input class="input-field" id="bas-lieu" value="${_esc(b.lieu||'')}" placeholder="ex: Faubourg sud de Belport"></div>
      <div class="form-group" style="margin:0"><label>Description</label>
        <textarea class="input-field" id="bas-desc" rows="4" placeholder="Histoire, ambiance, particularités…">${_esc(b.description||'')}</textarea></div>`)}
    <button class="btn btn-gold" style="width:100%" data-action="_bastionSaveIdentite">Enregistrer</button>

    <div class="bs-danger-zone">
      <div class="bs-danger-zone-title">⚠ Zone dangereuse</div>
      <p class="bs-danger-zone-desc">
        Remet le Bastion à zéro : nom par défaut, aucun or, aucune salle, aucun employé, coffre vide, chronique effacée, quêtes et overrides supprimés.<br>
        <strong>À utiliser pour repartir d'une feuille blanche.</strong>
      </p>
      <button class="btn btn-outline btn-sm bs-danger-btn" data-action="_bastionResetAll">🗑 Réinitialiser tout le Bastion</button>
    </div>
  `, { subtitle: 'Nom, lieu et description du Bastion', accent: '#f4c430' });
}

async function _bastionResetAll() {
  if (!STATE.isAdmin) return;
  const ok = await confirmModal(
    'Cette action est IRRÉVERSIBLE.\n\nElle efface : salles, employés, coffre, or, chronique, quêtes, overrides et salles custom.\n\nElle conserve uniquement la sauvegarde JSON si tu l\'as téléchargée.\n\nContinuer ?',
    { title: '🗑 Réinitialiser tout le Bastion', okLabel: '🗑 Tout effacer', cancelLabel: 'Annuler' }
  ).catch(() => false);
  if (!ok) return;

  const fresh = _defaultBastion();
  try {
    // Écriture COMPLÈTE (pas de merge) : remplace le doc entier.
    // _save() utilise merge:true → les anciens objets imbriqués persisteraient.
    await replaceDoc('bastion', 'main', fresh);
    closeModal();
    showNotif('Bastion réinitialisé. Bonne campagne !', 'success');
  } catch (e) { notifySaveError(e); }
}
async function _bastionSaveIdentite() {
  if (!STATE.isAdmin) return;
  const b = { ...STORE.bastion };
  b.nom         = document.getElementById('bas-nom')?.value?.trim() || 'Le Bastion';
  b.emoji       = document.getElementById('bas-emoji')?.value?.trim() || '🏰';
  b.lieu        = document.getElementById('bas-lieu')?.value?.trim() || '';
  b.description = document.getElementById('bas-desc')?.value?.trim() || '';
  await _save(b);
  closeModal();
  showNotif('Identité mise à jour.', 'success');
}

// ══════════════════════════════════════════════════════════════════════════════
// ACTIONS — Inventaire (déposer / retirer un objet)
// ══════════════════════════════════════════════════════════════════════════════
function _bastionOpenDeposit() {
  let chars = _eligibleChars().filter(c => (c.inventaire || []).length > 0);
  if (!chars.length) { showNotif('Aucun personnage avec inventaire.', 'error'); return; }

  const capacity = _bastionCapacity(STORE.bastion);
  const used = _bastionInvCount(STORE.bastion);
  if (used >= capacity) { showNotif(`Coffre plein (${used}/${capacity}). Améliore l'Entrepôt.`, 'error'); return; }

  // Liste déjà triée par _eligibleChars (joueur alpha → ★ par défaut → nom).
  // Default = le perso ★ de l'utilisateur, sinon son premier, sinon le premier de la liste.
  const defaultChar = getDefaultCharForUser(chars, STATE.user?.uid) || chars[0];

  openModal('📥 Déposer un objet au coffre', `
    ${modalSection('📦 Objet à déposer', `
      <div class="form-group" style="margin:0 0 .6rem">
        <label>Depuis le personnage</label>
        <select class="input-field" id="bas-dep-char" data-change="_bastionRefreshDepositItems">
          ${chars.map(c => `<option value="${c.id}"${c.id === defaultChar.id ? ' selected' : ''}>${_esc(c.nom || '?')}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin:0 0 .6rem">
        <label>Objet à déposer <span style="font-size:.74rem;color:var(--text-dim);font-weight:400">(coffre : ${used}/${capacity})</span></label>
        <select class="input-field" id="bas-dep-item" data-change="_bastionRefreshDepositMax"></select>
      </div>
      <div class="form-group" style="margin:0">
        <label>Quantité <span id="bas-dep-info" style="font-size:.72rem;color:var(--text-dim);font-weight:400;margin-left:.4rem"></span></label>
        <div style="display:flex;gap:6px;align-items:center">
          <input type="number" class="input-field" id="bas-dep-qte" min="1" value="1" style="flex:1">
          <button type="button" class="btn btn-outline btn-sm" data-action="_bastionFillDepositMax">Tout</button>
        </div>
      </div>`)}
    <button class="btn btn-gold" style="width:100%" data-action="_bastionDoDeposit">📥 Déposer</button>
  `, { subtitle: 'Transférer un objet vers le coffre commun', accent: '#f4c430' });
  _bastionRefreshDepositItems();
}
function _bastionFillDepositMax() {
  const qte = document.getElementById('bas-dep-qte');
  if (qte && qte.max) qte.value = qte.max;
}

// Regroupe l'inventaire par (itemId + nom) — même algo que la fiche perso.
// Renvoie [{ key, item: template, totalQte, indices: [realIdx,...] }]
function _groupInventaire(inv) {
  const grouped = [];
  (inv || []).forEach((item, realIdx) => {
    const key = (item.itemId || '') + '||' + (item.nom || '');
    let g = grouped.find(x => x.key === key);
    if (!g) {
      g = { key, item: { ...item, qte: 0 }, totalQte: 0, indices: [] };
      grouped.push(g);
    }
    g.totalQte += parseInt(item.qte) || 1;
    g.indices.push(realIdx);
  });
  return grouped;
}

// Buffer module-level : regroupements actifs dans la modal de dépôt

function _bastionRefreshDepositItems() {
  const charId = document.getElementById('bas-dep-char')?.value;
  const char = (STATE.characters || []).find(c => c.id === charId);
  const sel = document.getElementById('bas-dep-item');
  if (!sel || !char) return;
  STORE.depositGroups = _groupInventaire(char.inventaire);
  sel.innerHTML = STORE.depositGroups.length
    ? STORE.depositGroups.map((g, i) => `<option value="${i}">${_esc(g.item.nom || '?')} ×${g.totalQte}${g.item.rarete ? ` (${g.item.rarete})` : ''}</option>`).join('')
    : `<option value="">-- Inventaire vide --</option>`;
  _bastionRefreshDepositMax();
}
function _bastionRefreshDepositMax() {
  const gi = parseInt(document.getElementById('bas-dep-item')?.value);
  const qte = document.getElementById('bas-dep-qte');
  const info = document.getElementById('bas-dep-info');
  if (!qte || isNaN(gi)) return;
  const group = STORE.depositGroups[gi];
  if (!group) return;
  const maxQte = group.totalQte;
  qte.max = maxQte;
  qte.value = maxQte;
  if (info) info.textContent = `(stack disponible : ${maxQte})`;
}

async function _bastionDoDeposit() {
  const charId = document.getElementById('bas-dep-char')?.value;
  const char = (STATE.characters || []).find(c => c.id === charId);
  const gi = parseInt(document.getElementById('bas-dep-item')?.value);
  const qte = parseInt(document.getElementById('bas-dep-qte')?.value) || 0;
  if (!char || isNaN(gi) || qte <= 0) { showNotif('Sélection invalide.', 'error'); return; }
  const group = STORE.depositGroups[gi];
  if (!group) { showNotif('Objet introuvable.', 'error'); return; }
  if (qte > group.totalQte) { showNotif('Quantité trop élevée.', 'error'); return; }

  const capacity = _bastionCapacity(STORE.bastion);
  const used = _bastionInvCount(STORE.bastion);
  if (used + qte > capacity) { showNotif(`Coffre plein (${used + qte}/${capacity}).`, 'error'); return; }

  try {
    // 1. Décrémente le stack à travers les entrées du groupe (indices décroissants → splice safe)
    const inv = [...(char.inventaire || [])];
    let toRemove = qte;
    const sortedIndices = [...group.indices].sort((a, b) => b - a);
    for (const realIdx of sortedIndices) {
      if (toRemove <= 0) break;
      const entry = inv[realIdx];
      if (!entry) continue;
      const entryQte = parseInt(entry.qte) || 1;
      if (entryQte <= toRemove) {
        inv.splice(realIdx, 1);
        toRemove -= entryQte;
      } else {
        inv[realIdx] = { ...entry, qte: entryQte - toRemove };
        toRemove = 0;
      }
    }
    char.inventaire = inv;
    const depositHistory = inventoryHistoryPayload(char, makeInventoryHistoryEntry('send', group.item, qte, {
      actorUid: STATE.user?.uid || '',
      actorName: STATE.user?.pseudo || STATE.user?.displayName || STATE.user?.email || '',
      source: 'Bastion',
      targetName: 'Coffre commun',
    }));
    char.inventoryHistory = depositHistory.inventoryHistory;
    await updateInCol('characters', char.id, { inventaire: inv, ...depositHistory });

    // 2. Ajoute au coffre du bastion (template du groupe en originalItem)
    const item = group.item;
    const b = { ...STORE.bastion };
    b.coffre = [...(b.coffre || [])];
    const sameKey = (a, c) => (a.nom === c.nom && (a.originalItem?.itemId || null) === (c.itemId || null));
    const existing = b.coffre.find(c => sameKey(c, item));
    if (existing) {
      existing.quantite = (existing.quantite || 0) + qte;
      existing.weekAdded = b.semaine;
    } else {
      b.coffre.push({
        id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        nom: item.nom,
        emoji: item.icone || '📦',
        quantite: qte,
        source: `🎒 ${char.nom || '?'}`,
        weekAdded: b.semaine,
        originalItem: { ...item, qte: 1 },
      });
    }
    _addHistorique(b, 'depot_item', `📥 ${char.nom || 'Un héros'} dépose ${qte}× ${item.nom || '?'}`);
    await _save(b);

    closeModal();
    showNotif(`✓ ${qte}× ${item.nom} déposé au coffre.`, 'success');
  } catch (e) { notifySaveError(e); }
}

async function _bastionDoWithdraw(coffreId) {
  const charId = document.getElementById('bas-wd-char')?.value;
  const qte = parseInt(document.getElementById('bas-wd-qte')?.value) || 0;
  const char = (STATE.characters || []).find(c => c.id === charId);
  if (!char || qte <= 0) { showNotif('Sélection invalide.', 'error'); return; }

  const b = { ...STORE.bastion };
  b.coffre = [...(b.coffre || [])];
  const itemIdx = b.coffre.findIndex(c => c.id === coffreId);
  if (itemIdx < 0) return;
  const coffreItem = b.coffre[itemIdx];
  if (qte > coffreItem.quantite) { showNotif('Quantité indisponible.', 'error'); return; }

  try {
    // 1. Décrémente / retire du coffre
    if (qte === coffreItem.quantite) b.coffre.splice(itemIdx, 1);
    else b.coffre[itemIdx] = { ...coffreItem, quantite: coffreItem.quantite - qte };

    // 2. Ajoute à l'inventaire du perso — N entrées séparées (qte:1) pour rester
    //    cohérent avec le reste du système (sell/send utilisent indices.length).
    const template = coffreItem.originalItem || { nom: coffreItem.nom, icone: coffreItem.emoji };
    const inv = [...(char.inventaire || [])];
    for (let i = 0; i < qte; i++) {
      inv.push({ ...template, qte: 1 });
    }
    char.inventaire = inv;
    const withdrawHistory = inventoryHistoryPayload(char, makeInventoryHistoryEntry('receive', template, qte, {
      actorUid: STATE.user?.uid || '',
      actorName: STATE.user?.pseudo || STATE.user?.displayName || STATE.user?.email || '',
      source: 'Coffre commun',
    }));
    char.inventoryHistory = withdrawHistory.inventoryHistory;
    await updateInCol('characters', char.id, { inventaire: inv, ...withdrawHistory });

    _addHistorique(b, 'retrait_item', `📤 ${char.nom || 'Un héros'} retire ${qte}× ${coffreItem.nom || '?'}`);
    await _save(b);

    closeModal();
    showNotif(`✓ ${qte}× ${coffreItem.nom} récupéré.`, 'success');
  } catch (e) { notifySaveError(e); }
}

// ══════════════════════════════════════════════════════════════════════════════
// ACTIONS — Éditeur de salles (MJ uniquement)
// ══════════════════════════════════════════════════════════════════════════════
function _bastionOpenCatalogEditor() {
  if (!STATE.isAdmin) return;
  const b = STORE.bastion || _defaultBastion();
  const cat = _getRoomCatalog(STORE.bastion);
  const builtCount = cat.filter(def => _roomNiveau(b, def.slug) > 0).length;
  const buildingCount = cat.filter(def => _roomBuilding(b, def.slug)).length;
  const customCount = cat.filter(def => def.isCustom).length;
  const levelPreview = (def) => {
    if (def.unlimited) return `
      <span class="bs-room-manager-fixed">Niveaux illimités · +${def.capacitePerLevel || 10} places par niveau</span>`;
    return `<span class="bs-room-manager-levels">
      ${(def.niveaux || []).slice(0, 3).map((n, i) => `
        <span title="Niveau ${NIVEAU_LABEL[i + 1]}">
          <b>${NIVEAU_LABEL[i + 1]}</b>
          <span>${n.cout || 0} or</span>
          <span>${n.semaines || 1} p.</span>
        </span>`).join('')}
    </span>`;
  };
  const rows = cat.length ? cat.map(def => {
    const level = _roomNiveau(b, def.slug);
    const building = _roomBuilding(b, def.slug);
    const roomState = b.salles?.[def.slug];
    const status = building
      ? `En chantier · ${roomState?.weeksLeftToBuild || 0} p.`
      : level > 0
        ? `Niv. ${def.unlimited ? level : (NIVEAU_LABEL[level] || level)}`
        : 'Disponible';
    const statusClass = building ? 'building' : level > 0 ? 'built' : 'available';
    const cardContent = `
      <span class="bs-room-manager-card-head">
        <span class="bs-room-manager-emoji" style="--room-color:${def.color || '#7eb0ff'}">${def.emoji}</span>
        <span class="bs-room-manager-title">
          <strong>${_esc(def.nom)}</strong>
          <span class="bs-room-manager-status is-${statusClass}">${_esc(status)}</span>
        </span>
        ${def.isCustom ? '<span class="bs-edit-tag">custom</span>' : ''}
      </span>
      <span class="bs-room-manager-description">${_esc(def.desc || 'Aucune description.')}</span>
      ${levelPreview(def)}
      <span class="bs-room-manager-card-foot">
        <span>${def.unlimited ? 'Paramètres automatiques' : 'Coûts et effets des 3 niveaux'}</span>
        <strong>${def.unlimited ? 'Fixe' : 'Modifier →'}</strong>
      </span>`;
    return def.unlimited
      ? `<div class="bs-room-manager-card is-fixed">${cardContent}</div>`
      : `<button type="button" class="bs-room-manager-card" data-action="_bastionEditRoom" data-slug="${def.slug}">${cardContent}</button>`;
  }).join('') : `
    <div class="bs-coffre-empty">
      Aucune salle n'est encore définie pour cette aventure. Crée la première salle du Bastion.
    </div>`;
  openModal('🏛️ Gestion des salles', `
    <div class="bs-room-manager">
      <div class="bs-room-manager-summary" aria-label="Résumé du catalogue">
        <div><strong>${cat.length}</strong><span>plans</span></div>
        <div><strong>${builtCount}</strong><span>construites</span></div>
        <div class="${buildingCount ? 'is-building' : ''}"><strong>${buildingCount}</strong><span>en chantier</span></div>
        <div><strong>${customCount}</strong><span>personnalisées</span></div>
      </div>
      <div class="bs-room-manager-grid">
        ${rows}
      </div>
      <div class="bs-room-manager-actions">
        <span>Les changements s’appliquent à tous les joueurs de l’aventure.</span>
        <button class="btn btn-gold" data-action="_bastionAddCustomRoom">＋ Nouvelle salle</button>
      </div>
    </div>
  `, { subtitle: 'Consulte l’état du Bastion et configure chaque plan depuis un seul endroit.', accent: '#f4c430' });
}

const BASTION_ROOM_TEMPLATES = {
  production: {
    label: 'Production',
    icon: '⚒️',
    nom: 'Atelier',
    emoji: '⚒️',
    desc: 'Produit des ressources utiles au groupe à chaque période.',
    color: '#f59e0b',
    niveaux: [
      { cout: 200, semaines: 1, renommee: 0, gainRenommee: 2, prod: { or: 20, items: [] }, bonus: '' },
      { cout: 500, semaines: 2, renommee: 20, gainRenommee: 4, prod: { or: 50, items: [] }, bonus: '' },
      { cout: 1500, semaines: 3, renommee: 50, gainRenommee: 6, prod: { or: 120, items: [] }, bonus: '' },
    ],
  },
  service: {
    label: 'Service',
    icon: '✨',
    nom: 'Salle de service',
    emoji: '✨',
    desc: 'Débloque une activité de soutien entre deux sessions.',
    color: '#7eb0ff',
    niveaux: [
      { cout: 200, semaines: 1, renommee: 0, gainRenommee: 2, prod: { or: 0, items: [] }, bonus: 'Service mineur disponible.' },
      { cout: 500, semaines: 2, renommee: 20, gainRenommee: 4, prod: { or: 0, items: [] }, bonus: 'Service amélioré.' },
      { cout: 1500, semaines: 3, renommee: 50, gainRenommee: 6, prod: { or: 0, items: [] }, bonus: 'Service majeur disponible.' },
    ],
  },
  stockage: {
    label: 'Stockage',
    icon: '📦',
    nom: 'Réserve',
    emoji: '📦',
    desc: 'Organise les ressources et sécurise les biens du Bastion.',
    color: '#22c38e',
    niveaux: [
      { cout: 150, semaines: 1, renommee: 0, gainRenommee: 1, prod: { or: 0, items: [] }, bonus: '+10 capacité de coffre.' },
      { cout: 400, semaines: 1, renommee: 15, gainRenommee: 3, prod: { or: 0, items: [] }, bonus: '+25 capacité de coffre.' },
      { cout: 1000, semaines: 2, renommee: 35, gainRenommee: 5, prod: { or: 0, items: [] }, bonus: '+50 capacité de coffre.' },
    ],
  },
  recrutement: {
    label: 'Recrutement',
    icon: '👥',
    nom: 'Quartier du personnel',
    emoji: '👥',
    desc: 'Permet d’accueillir, d’organiser et de valoriser le personnel.',
    color: '#b47fff',
    niveaux: [
      { cout: 250, semaines: 1, renommee: 0, gainRenommee: 2, prod: { or: 0, items: [] }, bonus: '1 contact recrutable.' },
      { cout: 650, semaines: 2, renommee: 25, gainRenommee: 4, prod: { or: 0, items: [] }, bonus: 'Réseau de recrutement fiable.' },
      { cout: 1600, semaines: 3, renommee: 55, gainRenommee: 6, prod: { or: 0, items: [] }, bonus: 'Personnel spécialisé plus facile à obtenir.' },
    ],
  },
};

function _bastionTemplate(kind = 'service') {
  return BASTION_ROOM_TEMPLATES[kind] || BASTION_ROOM_TEMPLATES.service;
}

function _bastionFillCreateRoomTemplate(kind = 'service') {
  const tpl = _bastionTemplate(kind);
  document.querySelectorAll('.bs-room-template').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.template === kind);
  });
  const setVal = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value ?? '';
  };
  setVal('bas-room-emoji', tpl.emoji);
  setVal('bas-room-nom', tpl.nom);
  setVal('bas-room-color', tpl.color);
  setVal('bas-room-desc', tpl.desc);
  tpl.niveaux.forEach((n, i) => {
    setVal(`bas-room-cout-${i}`, n.cout || 0);
    setVal(`bas-room-sem-${i}`, n.semaines || 1);
    setVal(`bas-room-prod-${i}`, n.prod?.or || 0);
    setVal(`bas-room-bonus-${i}`, n.bonus || '');
  });
}

function _bastionReadCreateRoom() {
  const nom = document.getElementById('bas-room-nom')?.value?.trim();
  if (!nom) return null;
  return _normalizeRoomDef({
    slug: '',
    isCustom: true,
    nom,
    emoji: document.getElementById('bas-room-emoji')?.value?.trim() || '🏠',
    color: document.getElementById('bas-room-color')?.value || '#7eb0ff',
    desc: document.getElementById('bas-room-desc')?.value?.trim() || '',
    niveaux: [0, 1, 2].map(i => ({
      cout: parseInt(document.getElementById(`bas-room-cout-${i}`)?.value) || 0,
      semaines: Math.max(1, parseInt(document.getElementById(`bas-room-sem-${i}`)?.value) || 1),
      renommee: i === 0 ? 0 : i === 1 ? 20 : 50,
      gainRenommee: i === 0 ? 2 : i === 1 ? 4 : 6,
      prod: { or: parseInt(document.getElementById(`bas-room-prod-${i}`)?.value) || 0, items: [] },
      bonus: document.getElementById(`bas-room-bonus-${i}`)?.value?.trim() || '',
    })),
  });
}

function _bastionCreateRoomHasChanges() {
  const room = _bastionReadCreateRoom();
  const tpl = _bastionTemplate('service');
  if (!room) return true;
  if (room.nom !== tpl.nom || room.emoji !== tpl.emoji || room.color !== tpl.color || room.desc !== tpl.desc) return true;
  return room.niveaux.some((n, i) => {
    const base = tpl.niveaux[i] || {};
    return n.cout !== (base.cout || 0)
      || n.semaines !== (base.semaines || 1)
      || n.prod.or !== (base.prod?.or || 0)
      || n.bonus !== (base.bonus || '');
  });
}

async function _bastionCancelCreateRoom() {
  if (_bastionCreateRoomHasChanges()) {
    const ok = await confirmModal('Abandonner la création de cette salle ?', {
      title: 'Création non enregistrée', okLabel: 'Abandonner', cancelLabel: 'Continuer la création',
    }).catch(() => false);
    if (!ok) return;
  }
  _bastionOpenCatalogEditor();
}

function _bastionAddCustomRoom() {
  if (!STATE.isAdmin) return;
  const tpl = _bastionTemplate('service');
  const levelRow = (n, i) => `
    <div class="bs-room-create-level">
      <strong>Niv. ${NIVEAU_LABEL[i + 1]}</strong>
      <label>Coût<input type="number" class="input-field" id="bas-room-cout-${i}" value="${n.cout || 0}" min="0"></label>
      <label>Périodes<input type="number" class="input-field" id="bas-room-sem-${i}" value="${n.semaines || 1}" min="1"></label>
      <label>Or / période<input type="number" class="input-field" id="bas-room-prod-${i}" value="${n.prod?.or || 0}" min="0"></label>
      <label class="bs-room-create-bonus">Bonus
        <input type="text" class="input-field" id="bas-room-bonus-${i}" value="${_esc(n.bonus || '')}" placeholder="ex: permet de...">
      </label>
    </div>`;

  openModal('＋ Nouvelle salle du Bastion', `
    <div class="bs-room-create">
      <div class="bs-room-create-templates" aria-label="Modèles rapides">
        ${Object.entries(BASTION_ROOM_TEMPLATES).map(([key, item]) => `
          <button type="button" class="bs-room-template${key === 'service' ? ' active' : ''}" data-action="_bastionPickRoomTemplate" data-template="${key}">
            <span>${item.icon}</span>
            <strong>${_esc(item.label)}</strong>
          </button>`).join('')}
      </div>
      <div class="bs-room-create-card">
        <div class="bs-room-create-id">
          <label>Icône<input type="text" class="input-field" id="bas-room-emoji" value="${_esc(tpl.emoji)}" maxlength="4"></label>
          <label>Nom<input type="text" class="input-field" id="bas-room-nom" value="${_esc(tpl.nom)}" placeholder="Nom de la salle"></label>
          <label>Couleur<input type="color" class="input-field" id="bas-room-color" value="${tpl.color}"></label>
        </div>
        <label>Description
          <textarea class="input-field" id="bas-room-desc" rows="3" placeholder="Ce que cette salle apporte au Bastion...">${_esc(tpl.desc)}</textarea>
        </label>
      </div>
      <div class="bs-room-create-levels">
        ${tpl.niveaux.map(levelRow).join('')}
      </div>
      <div class="bs-room-create-actions">
        <button type="button" class="btn btn-outline" data-action="_bastionCancelCreateRoom">← Retour aux salles</button>
        <button type="button" class="btn btn-gold" data-modal-save data-action="_bastionCreateCustomRoom">Créer la salle</button>
      </div>
    </div>
  `, { subtitle: 'Choisis un modèle, ajuste les coûts et les bonus, puis crée la salle.', accent: '#7eb0ff' });
}

async function _bastionCreateCustomRoom() {
  if (!STATE.isAdmin || STORE.addingCustomRoom) return;

  const newRoomData = _bastionReadCreateRoom();
  if (!newRoomData) {
    showNotif('Le nom de la salle est requis.', 'error');
    return;
  }
  const current = STORE.bastion || _defaultBastion();
  const existingSlugs = new Set(_getRoomCatalog(current).map(room => room.slug));
  const slugBase = `custom_${Date.now().toString(36)}`;
  let slug = slugBase;
  let suffix = 2;
  while (existingSlugs.has(slug)) slug = `${slugBase}_${suffix++}`;
  const newRoom = _normalizeRoomDef({ ...newRoomData, slug, isCustom: true });
  const b = {
    ...current,
    roomCatalog: [..._getRoomCatalog(current), newRoom],
  };

  STORE.addingCustomRoom = true;
  try {
    if (!await _save(b)) return;

    // Ne pas attendre le listener Firestore : l'état optimiste garantit que
    // plusieurs ajouts successifs s'accumulent et que l'éditeur trouve tout de
    // suite la salle qui vient d'être créée.
    STORE.bastion = b;
    if (STATE.currentPage === 'bastion') _renderPage();
    _bastionOpenCatalogEditor();
    showNotif('Salle créée.', 'success');
  } finally {
    STORE.addingCustomRoom = false;
  }
}

async function _bastionDeleteCustomRoom(slug) {
  if (!STATE.isAdmin) return;
  if (!slug.startsWith('custom_')) { showNotif('Seules les salles custom peuvent être supprimées.', 'error'); return; }
  const ok = await confirmModal('Supprimer définitivement cette salle custom ?\n\nSi elle est construite, l\'entrée dans b.salles persistera (sans effet).', {
    title: '🗑 Supprimer la salle', okLabel: 'Supprimer', cancelLabel: 'Annuler',
  }).catch(() => false);
  if (!ok) return;
  const b = { ...STORE.bastion };
  b.roomCatalog = _getRoomCatalog(b).filter(r => r.slug !== slug);
  b.customRooms = (b.customRooms || []).filter(r => r.slug !== slug);
  if (!await _save(b)) return;
  STORE.bastion = b;
  if (STATE.currentPage === 'bastion') _renderPage();
  _bastionOpenCatalogEditor();
  showNotif('Salle supprimée.', 'success');
}

async function _bastionEditRoom(slug) {
  if (!STATE.isAdmin) return;
  const def = _getRoomDef(slug);
  if (!def) return;
  if (def.unlimited) {
    showNotif('L\'Entrepôt utilise des paramètres en dur (niveau illimité, +10 capacité/niveau). Non éditable.', 'success');
    return;
  }

  // Charger le shop pour le picker (en parallèle de l'ouverture du modal)
  const shopPromise = _loadShopItems();

  // Buffer module-local de production items en cours d'édition (par niveau)
  // Chaque entrée : { shopItemId?, nom, emoji, q }
  STORE.editingItems = [0, 1, 2].map(i => {
    const items = def.niveaux[i]?.prod?.items || [];
    return items.map(it => ({ ...it }));
  });
  // Reset filtres du picker (catégorie + recherche) pour chaque ouverture
  [0, 1, 2].forEach(i => { STORE.pickerFilters[i] = { cat: 'all', search: '' }; });

  const niveauForm = (i) => {
    const n = def.niveaux[i] || {};
    const itemCount = (n.prod?.items || []).reduce((sum, item) => sum + (parseInt(item.q) || 1), 0);
    return `
      <details class="bs-edit-niv" name="bs-room-levels" ${i === 0 ? 'open' : ''}>
        <summary>
          <span class="bs-edit-niv-title">Niveau ${NIVEAU_LABEL[i + 1]}</span>
          <span class="bs-edit-niv-summary">
            <span>🪙 ${n.cout || 0}</span>
            <span>🕰 ${n.semaines || 1} p.</span>
            ${(n.prod?.or || 0) > 0 ? `<span>＋${n.prod.or} or</span>` : ''}
            ${itemCount > 0 ? `<span>📦 ${itemCount}</span>` : ''}
          </span>
        </summary>
        <div class="bs-edit-niv-grid">
          <label>Coût (or)<input type="number" class="input-field" id="ed-cout-${i}" value="${n.cout || 0}"></label>
          <label>Périodes<input type="number" class="input-field" id="ed-sem-${i}" value="${n.semaines || 1}" min="1"></label>
          <label>Production or/période<input type="number" class="input-field" id="ed-prodor-${i}" value="${n.prod?.or || 0}" min="0"></label>
          ${slug === 'entrepot' ? `<label>Capacité coffre<input type="number" class="input-field" id="ed-cap-${i}" value="${n.capacite || 50}" min="20"></label>` : ''}
        </div>
        <div class="bs-edit-full">
          <label style="font-size:.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;font-weight:600">Production items <span style="font-size:.68rem;color:var(--text-dim);font-weight:400;text-transform:none;letter-spacing:0">(depuis ta boutique)</span></label>
          <div id="ed-items-list-${i}" class="bs-items-list"></div>
          <div class="bs-items-picker" id="ed-items-picker-${i}">
            ${skeletonHtml(4)}
          </div>
        </div>
        <label class="bs-edit-full">Bonus passif (texte libre)
          <textarea class="input-field" id="ed-bonus-${i}" rows="2">${_esc(n.bonus || '')}</textarea>
        </label>
      </details>`;
  };

  openModal(`✏️ ${def.emoji} ${def.nom}`, `
    <div class="bs-room-editor bs-edit-form" style="--room-color:${def.color || '#7eb0ff'}">
      <div class="bs-room-editor-nav">
        <button type="button" class="bs-room-editor-back" data-action="_bastionReturnToCatalog" data-slug="${slug}">← Toutes les salles</button>
        <span>${def.isCustom ? 'Salle personnalisée' : 'Plan du catalogue'}</span>
      </div>
      <div class="bs-room-editor-layout">
        <aside class="bs-room-editor-identity">
          <div class="bs-room-editor-preview">
            <span>${def.emoji}</span>
            <div><strong>${_esc(def.nom)}</strong><small>Aperçu de la salle</small></div>
          </div>
          <div class="bs-edit-id-row">
            <label>Emoji<input type="text" class="input-field" id="ed-emoji" value="${_esc(def.emoji || '')}" maxlength="4"></label>
            <label>Couleur<input type="color" class="input-field" id="ed-color" value="${def.color || '#888'}"></label>
          </div>
          <label class="bs-edit-full">Nom<input type="text" class="input-field" id="ed-nom" value="${_esc(def.nom || '')}"></label>
          <label class="bs-edit-full">Description<textarea class="input-field" id="ed-desc" rows="5">${_esc(def.desc || '')}</textarea></label>
          <div class="bs-room-editor-note">Les coûts, productions et bonus sont communs à tous les joueurs.</div>
        </aside>
        <section class="bs-room-editor-levels">
          <div class="bs-room-editor-levels-head">
            <div><strong>Progression de la salle</strong><span>Ouvre un niveau pour modifier ses paramètres.</span></div>
            <span>3 niveaux</span>
          </div>
          ${[0, 1, 2].map(niveauForm).join('')}
        </section>
      </div>
      <div class="bs-room-editor-actions">
        <button type="button" class="btn btn-outline" data-action="_bastionReturnToCatalog" data-slug="${slug}">← Retour</button>
        <div>
          ${def.isCustom
            ? `<button class="btn btn-outline btn-sm bs-room-editor-danger" data-action="_bastionDeleteCustomRoom" data-slug="${slug}">🗑 Supprimer</button>`
            : `<button class="btn btn-outline btn-sm" data-action="_bastionResetRoom" data-slug="${slug}">↻ <span class="bs-room-action-full">Restaurer défaut</span><span class="bs-room-action-short">Défaut</span></button>`}
          <button class="btn btn-gold" data-action="_bastionSaveRoom" data-slug="${slug}"><span class="bs-room-action-full">Enregistrer les changements</span><span class="bs-room-action-short">Enregistrer</span></button>
        </div>
      </div>
    </div>
  `, { subtitle: 'Identité, construction et production par niveau.', accent: def.color || '#7eb0ff' });

  // Une fois le shop chargé, on rend les pickers (3 niveaux)
  await shopPromise;
  [0, 1, 2].forEach(_renderItemPicker);
}

function _bastionEditorHasChanges(slug) {
  const def = _getRoomDef(slug);
  if (!def || !document.getElementById('ed-nom')) return false;
  if ((document.getElementById('ed-nom')?.value?.trim() || '') !== (def.nom || '')) return true;
  if ((document.getElementById('ed-emoji')?.value?.trim() || '') !== (def.emoji || '')) return true;
  if ((document.getElementById('ed-color')?.value || '') !== (def.color || '#888')) return true;
  if ((document.getElementById('ed-desc')?.value?.trim() || '') !== (def.desc || '')) return true;
  return [0, 1, 2].some(i => {
    const n = def.niveaux[i] || {};
    const items = (n.prod?.items || []).map(it => ({
      shopItemId: it.shopItemId || null,
      nom: it.nom || '?', emoji: it.emoji || '📦', q: parseInt(it.q) || 1,
    }));
    const editingItems = (STORE.editingItems[i] || []).map(it => ({
      shopItemId: it.shopItemId || null,
      nom: it.nom || '?', emoji: it.emoji || '📦', q: parseInt(it.q) || 1,
    }));
    return (parseInt(document.getElementById(`ed-cout-${i}`)?.value) || 0) !== (parseInt(n.cout) || 0)
      || (parseInt(document.getElementById(`ed-sem-${i}`)?.value) || 1) !== (parseInt(n.semaines) || 1)
      || (parseInt(document.getElementById(`ed-prodor-${i}`)?.value) || 0) !== (parseInt(n.prod?.or) || 0)
      || (document.getElementById(`ed-bonus-${i}`)?.value?.trim() || '') !== (n.bonus || '')
      || JSON.stringify(editingItems) !== JSON.stringify(items);
  });
}

async function _bastionReturnToCatalog(slug) {
  if (_bastionEditorHasChanges(slug)) {
    const ok = await confirmModal('Abandonner les modifications de cette salle ?', {
      title: 'Modifications non enregistrées', okLabel: 'Abandonner', cancelLabel: 'Continuer l’édition',
    }).catch(() => false);
    if (!ok) return;
  }
  _bastionOpenCatalogEditor();
}

// State temporaire de l'éditeur (cleared sur chaque ouverture)

// État des filtres du picker, par niveau

function _renderItemPicker(i) {
  const list = document.getElementById(`ed-items-list-${i}`);
  const picker = document.getElementById(`ed-items-picker-${i}`);
  if (!list || !picker) return;

  // Liste des items sélectionnés
  list.innerHTML = (STORE.editingItems[i] || []).map((it, idx) => {
    const cat = it.shopItemId && _findShopItem(it.shopItemId)?.categorieId
      ? _findShopCat(_findShopItem(it.shopItemId).categorieId)
      : null;
    return `
    <div class="bs-item-row" data-idx="${idx}">
      <span class="bs-item-emoji">${_esc(it.emoji || '📦')}</span>
      <span class="bs-item-nom">${_esc(it.nom || '?')}${cat ? ` <span class="bs-item-cat">${_esc(cat.nom)}</span>` : ''}${it.shopItemId ? '' : ' <span class="bs-item-free">libre</span>'}</span>
      <input type="number" class="input-field bs-item-qty" value="${it.q || 1}" min="1"
        data-change="_bastionEditItemQty" data-i="${i}" data-idx="${idx}">
      <button class="bs-item-rm" data-action="_bastionRemoveItem" data-i="${i}" data-idx="${idx}" title="Retirer">✕</button>
    </div>`;
  }).join('') || `<div class="bs-items-empty">Aucun item produit à ce niveau.</div>`;

  // Picker : items boutique disponibles
  const shop = STORE.shopItemsCache || [];
  const cats = STORE.shopCatsCache || [];
  if (!shop.length) {
    picker.innerHTML = `<div class="bs-items-empty">Aucun article dans la boutique. Crée des items dans la page Boutique pour les ajouter ici.</div>`;
    return;
  }

  // Init filtres
  if (!STORE.pickerFilters[i]) STORE.pickerFilters[i] = { cat: 'all', search: '' };
  const { cat: filterCat, search } = STORE.pickerFilters[i];

  // Filtre les items selon catégorie + recherche
  let filtered = shop;
  if (filterCat && filterCat !== 'all') {
    if (filterCat === 'none') filtered = filtered.filter(s => !s.categorieId || !_findShopCat(s.categorieId));
    else filtered = filtered.filter(s => s.categorieId === filterCat);
  }
  const q = _norm(search || '');   // minuscules + sans accents
  if (q) filtered = filtered.filter(s => _norm(s.nom || '').includes(q));

  // Compte par catégorie (pour le sélecteur)
  const catCounts = { all: shop.length };
  cats.forEach(c => { catCounts[c.id] = shop.filter(s => s.categorieId === c.id).length; });
  const orphanCount = shop.filter(s => !s.categorieId || !_findShopCat(s.categorieId)).length;

  picker.innerHTML = `
    <div class="bs-pick-filters">
      <select class="input-field bs-pick-cat" id="ed-items-cat-${i}"
        data-change="_bastionSetPickerCat" data-i="${i}">
        <option value="all">Toutes les catégories (${catCounts.all})</option>
        ${cats.filter(c => catCounts[c.id] > 0).map(c => `<option value="${c.id}"${c.id === filterCat ? ' selected' : ''}>${_esc((c.emoji || '📂') + ' ' + (c.nom || '?'))} (${catCounts[c.id]})</option>`).join('')}
        ${orphanCount > 0 ? `<option value="none"${filterCat === 'none' ? ' selected' : ''}>📦 Sans catégorie (${orphanCount})</option>` : ''}
      </select>
      <input type="search" class="input-field bs-pick-search" id="ed-items-search-${i}"
        placeholder="🔍 Rechercher…" value="${_esc(search)}"
        data-input="_bastionSetPickerSearch" data-i="${i}">
    </div>
    <div class="bs-pick-row">
      <select class="input-field" id="ed-items-shop-${i}" style="flex:2;min-width:0">
        ${filtered.length
          ? `<option value="">— Sélectionner (${filtered.length} ${filtered.length > 1 ? 'résultats' : 'résultat'}) —</option>
             ${filtered.map(s => `<option value="${s.id}">${_esc((s.icone||s.emoji||'📦') + ' ' + (s.nom||'?'))}${s.prix ? ` (${s.prix}o)` : ''}</option>`).join('')}`
          : `<option value="">— Aucun résultat —</option>`}
      </select>
      <input type="number" class="input-field" id="ed-items-q-${i}" value="1" min="1" style="max-width:64px">
      <button type="button" class="btn btn-outline btn-sm" data-action="_bastionAddShopItem" data-i="${i}">+ Ajouter</button>
    </div>
  `;
}

function _bastionSetPickerCat(i, val) {
  STORE.pickerFilters[i] = { ...(STORE.pickerFilters[i] || {}), cat: val };
  _renderItemPicker(i);
}
function _bastionSetPickerSearch(i, val) {
  // On garde le focus dans le champ : on ne re-render que le <select> des items
  STORE.pickerFilters[i] = { ...(STORE.pickerFilters[i] || {}), search: val };
  // Re-render limité au select pour ne pas perdre le focus du champ recherche
  const shop = STORE.shopItemsCache || [];
  const { cat, search } = STORE.pickerFilters[i];
  let filtered = shop;
  if (cat && cat !== 'all') {
    if (cat === 'none') filtered = filtered.filter(s => !s.categorieId || !_findShopCat(s.categorieId));
    else filtered = filtered.filter(s => s.categorieId === cat);
  }
  const q = _norm(search || '');   // minuscules + sans accents
  if (q) filtered = filtered.filter(s => _norm(s.nom || '').includes(q));
  const sel = document.getElementById(`ed-items-shop-${i}`);
  if (sel) {
    sel.innerHTML = filtered.length
      ? `<option value="">— Sélectionner (${filtered.length} ${filtered.length > 1 ? 'résultats' : 'résultat'}) —</option>
         ${filtered.map(s => `<option value="${s.id}">${_esc((s.icone||s.emoji||'📦') + ' ' + (s.nom||'?'))}${s.prix ? ` (${s.prix}o)` : ''}</option>`).join('')}`
      : `<option value="">— Aucun résultat —</option>`;
  }
}

function _bastionAddShopItem(i) {
  const id = document.getElementById(`ed-items-shop-${i}`)?.value;
  const q = parseInt(document.getElementById(`ed-items-q-${i}`)?.value) || 1;
  if (!id) { showNotif('Sélectionne un article.', 'error'); return; }
  const shopItem = _findShopItem(id);
  if (!shopItem) { showNotif('Article introuvable.', 'error'); return; }
  // Si déjà présent → cumul de la quantité
  const existing = STORE.editingItems[i].find(it => it.shopItemId === id);
  if (existing) {
    existing.q = (parseInt(existing.q) || 1) + q;
  } else {
    STORE.editingItems[i].push({
      shopItemId: id,
      nom: shopItem.nom || '?',
      emoji: shopItem.icone || shopItem.emoji || '📦',
      q,
    });
  }
  _renderItemPicker(i);
}

function _bastionRemoveItem(i, idx) {
  STORE.editingItems[i].splice(idx, 1);
  _renderItemPicker(i);
}
function _bastionEditItemQty(i, idx, val) {
  const q = parseInt(val) || 1;
  if (STORE.editingItems[i][idx]) STORE.editingItems[i][idx].q = Math.max(1, q);
}

async function _bastionSaveRoom(slug) {
  if (!STATE.isAdmin) return;
  const sourceDef = _getRoomDef(slug);

  const override = {
    nom:   document.getElementById('ed-nom')?.value?.trim() || undefined,
    emoji: document.getElementById('ed-emoji')?.value?.trim() || undefined,
    color: document.getElementById('ed-color')?.value || undefined,
    desc:  document.getElementById('ed-desc')?.value?.trim() || undefined,
    niveaux: [0, 1, 2].map(i => {
      // Items proviennent du buffer STORE.editingItems (alimenté par le picker shop)
      const items = (STORE.editingItems[i] || []).map(it => ({
        shopItemId: it.shopItemId || null,
        nom: it.nom || '?',
        emoji: it.emoji || '📦',
        q: parseInt(it.q) || 1,
      })).filter(it => it.q > 0);
      const ov = {
        cout:         parseInt(document.getElementById(`ed-cout-${i}`)?.value) || 0,
        semaines:     parseInt(document.getElementById(`ed-sem-${i}`)?.value) || 1,
        prod:         { or: parseInt(document.getElementById(`ed-prodor-${i}`)?.value) || 0, items },
        bonus:        document.getElementById(`ed-bonus-${i}`)?.value?.trim() || '',
      };
      const cap = document.getElementById(`ed-cap-${i}`);
      if (cap) ov.capacite = parseInt(cap.value) || 0;
      return { ...(sourceDef?.niveaux?.[i] || {}), ...ov };
    }),
  };

  const b = { ...STORE.bastion };
  const catalog = _getRoomCatalog(b);
  const current = catalog.find(r => r.slug === slug) || { slug, isCustom: slug.startsWith('custom_') };
  const nextRoom = _normalizeRoomDef({
    ...current,
    ...override,
    slug,
    isCustom: current.isCustom ?? slug.startsWith('custom_'),
  });
  b.roomCatalog = catalog.some(r => r.slug === slug)
    ? catalog.map(r => r.slug === slug ? nextRoom : r)
    : [...catalog, nextRoom];
  if (!await _save(b)) return;
  STORE.bastion = b;
  if (STATE.currentPage === 'bastion') _renderPage();
  _bastionOpenCatalogEditor();
  showNotif('Salle mise à jour.', 'success');
}

async function _bastionResetRoom(slug) {
  if (!STATE.isAdmin) return;
  const ok = await confirmModal(`Restaurer « ${slug} » à ses valeurs par défaut ?`, {
    title: '↻ Restaurer défaut', okLabel: 'Restaurer', cancelLabel: 'Annuler',
  }).catch(() => false);
  if (!ok) return;
  const b = { ...STORE.bastion };
  if (Array.isArray(b.roomCatalog)) {
    const def = DEFAULT_ROOM_CATALOG.find(r => r.slug === slug);
    if (!def) { showNotif('Aucun défaut historique pour cette salle.', 'error'); return; }
    b.roomCatalog = _getRoomCatalog(b).map(r => r.slug === slug ? _normalizeRoomDef(_clone(def)) : r);
  }
  if (b.catalogOverrides?.[slug]) {
    delete b.catalogOverrides[slug];
    b.catalogOverrides = { ...b.catalogOverrides };
  }
  // Pour que le delete passe à travers le merge Firestore : on remet null
  // (le doc Firestore garde un champ null inoffensif)
  b.catalogOverrides = { ...(b.catalogOverrides || {}) };
  b.catalogOverrides[slug] = null;
  if (!await _save(b)) return;
  STORE.bastion = b;
  if (STATE.currentPage === 'bastion') _renderPage();
  _bastionOpenCatalogEditor();
  showNotif('Restauré.', 'success');
}

// ══════════════════════════════════════════════════════════════════════════════
// ACTIONS — Personnel (employés du bastion)
// b.personnel = [{ id, nom, role, salaire, bonus, hiredAtWeek }]
// Les salaires sont débités du trésor à chaque "Passer la semaine".
// ══════════════════════════════════════════════════════════════════════════════
function _bastionOpenPersonnel() {
  const b = STORE.bastion || _defaultBastion();
  const emp = b.personnel || [];
  const totalSalaires = emp.reduce((s, e) => s + (parseInt(e.salaire) || 0), 0);
  const npcs = STORE.npcsCache || [];

  if (!emp.length) {
    openModal('👥 Personnel', `
      <div class="bs-coffre-empty">Aucun employé. Construis une salle puis utilise le bouton "＋ Embaucher" sur sa carte.</div>
    `);
    return;
  }

  // ── Stats globales ──────────────────────────────────────────────────────
  const treasuryCoverage = totalSalaires > 0 ? Math.floor((b.or || 0) / totalSalaires) : Infinity;
  const coverColor = treasuryCoverage === Infinity ? '#22c38e'
                  : treasuryCoverage >= 8 ? '#22c38e'
                  : treasuryCoverage >= 3 ? '#f4c430'
                  : '#ff5a7e';

  // ── Aperçu par salle (toutes les salles construites + non assignés)
  const allBuiltRooms = Object.keys(b.salles || {})
    .filter(slug => (b.salles[slug]?.niveau || 0) > 0 && !(_getRoomDef(slug)?.unlimited))
    .map(slug => ({ slug, def: _getRoomDef(slug), niv: b.salles[slug].niveau }));
  const unassigned = emp.filter(e => !e.roomSlug || !allBuiltRooms.find(r => r.slug === e.roomSlug));

  const roomCards = allBuiltRooms.map(({ slug, def, niv }) => {
    const list = emp.filter(e => e.roomSlug === slug);
    const filled = list.length;
    const slots = niv;
    const status = filled >= slots ? 'full' : filled > 0 ? 'partial' : 'empty';
    const empHtml = list.length
      ? list.map(e => {
          const npc = e.npcId ? npcs.find(n => n.id === e.npcId) : null;
          const portrait = npc?.imageUrl
            ? `<img src="${_esc(npc.imageUrl)}" alt="${_esc(npc.nom || e.nom || '')}" style="width:100%;height:100%;object-fit:cover">`
            : (e.nom || '?')[0].toUpperCase();
          const since = (b.semaine || 1) - (e.hiredAtWeek || b.semaine || 1);
          return `<div class="bs-emp">
            <div class="bs-emp-avatar">${portrait}</div>
            <div class="bs-emp-body">
              <div class="bs-emp-name">${_esc(e.nom || '?')}</div>
              <div class="bs-emp-role">${_esc(e.role || 'Employé')}</div>
              ${e.bonus ? `<div class="bs-emp-role" style="font-style:italic">🎁 ${_esc(e.bonus)}</div>` : ''}
              <div class="bs-emp-salary">💰 ${e.salaire || 0} or/période · ⏱ ${since} période</div>
            </div>
            ${STATE.isAdmin ? `<button class="bs-emp-fire" data-action="_bastionFireEmployee" data-id="${e.id}" title="Renvoyer">✕</button>` : ''}
          </div>`;
        }).join('')
      : '';
    const empty = filled < slots
      ? `<div class="bs-perso-empty-slot">⊕ ${slots - filled} slot${slots - filled > 1 ? 's' : ''} libre${slots - filled > 1 ? 's' : ''}</div>`
      : '';
    return `<div class="bs-perso-room bs-perso-room--${status}" style="--c:${def?.color || 'var(--border)'}">
      <div class="bs-perso-room-hd">
        <div class="bs-perso-room-title">
          ${def?.emoji || '❔'} <strong>${_esc(def?.nom || slug)}</strong>
          <span class="bs-perso-room-niv">Niv. ${NIVEAU_LABEL[niv] || niv}</span>
        </div>
        <div class="bs-perso-room-count">${filled}/${slots}</div>
      </div>
      ${empHtml ? `<div class="bs-personnel">${empHtml}</div>` : ''}
      ${empty}
    </div>`;
  }).join('');

  // ── Section "non assignés" pour les anciens employés
  const unassignedSection = unassigned.length ? `
    <div class="bs-perso-room bs-perso-room--orphan">
      <div class="bs-perso-room-hd">
        <div class="bs-perso-room-title">❔ <strong>Non assignés</strong> <span class="bs-perso-room-niv" style="color:var(--text-dim)">orphelin</span></div>
        <div class="bs-perso-room-count">${unassigned.length}</div>
      </div>
      <div class="bs-personnel">${unassigned.map(e => `
        <div class="bs-emp">
          <div class="bs-emp-avatar">${(e.nom || '?')[0].toUpperCase()}</div>
          <div class="bs-emp-body">
            <div class="bs-emp-name">${_esc(e.nom || '?')}</div>
            <div class="bs-emp-role">${_esc(e.role || '')}</div>
            <div class="bs-emp-salary">💰 ${e.salaire || 0} or/période</div>
          </div>
          ${STATE.isAdmin ? `<button class="bs-emp-fire" data-action="_bastionFireEmployee" data-id="${e.id}" title="Renvoyer">✕</button>` : ''}
        </div>`).join('')}</div>
    </div>` : '';

  openModal(`👥 Personnel (${emp.length})`, `
    <div class="bs-perso-stats">
      <div class="bs-perso-stat"><span class="bs-perso-stat-ico">👥</span><strong>${emp.length}</strong><span>employé${emp.length > 1 ? 's' : ''}</span></div>
      <div class="bs-perso-stat"><span class="bs-perso-stat-ico">💰</span><strong>${totalSalaires}</strong><span>or / période</span></div>
      <div class="bs-perso-stat" style="color:${coverColor}">
        <span class="bs-perso-stat-ico">⏱</span>
        <strong>${treasuryCoverage === Infinity ? '∞' : treasuryCoverage}</strong>
        <span>périodes de trésorerie</span>
      </div>
    </div>
    <div class="bs-perso-grid">
      ${roomCards}
      ${unassignedSection}
    </div>
    <p style="font-size:.74rem;color:var(--text-dim);font-style:italic;margin-top:.7rem;text-align:center">
      Pour embaucher, va sur la carte de la salle dans "Salles & activités".
    </p>
  `);
}

// Cache partagé : PNJ chargés pour l'embauche ET pour l'affichage des portraits dans les salles

async function _loadNpcs() {
  if (STORE.npcsCache) return STORE.npcsCache;
  STORE.npcsCache = await loadCollection('npcs').catch(() => []);
  return STORE.npcsCache;
}

async function _bastionOpenHire(roomSlug) {
  if (!STATE.isAdmin) return;
  if (!roomSlug) { showNotif('Aucune salle ciblée.', 'error'); return; }
  const def = _getRoomDef(roomSlug);
  if (!def) return;
  if (def.unlimited) { showNotif('L\'Entrepôt n\'accueille pas de personnel.', 'error'); return; }
  const curNiv = _roomNiveau(STORE.bastion, roomSlug);
  if (curNiv <= 0) { showNotif('Construis cette salle d\'abord.', 'error'); return; }
  const assigned = (STORE.bastion?.personnel || []).filter(e => e.roomSlug === roomSlug).length;
  if (assigned >= curNiv) { showNotif(`${def.nom} est plein (${assigned}/${curNiv}).`, 'error'); return; }

  // Charger PNJ
  const allNpcs = await _loadNpcs();
  STORE.hireNpcsCache = allNpcs;
  // Filtres : Allié uniquement + activité matchant la salle + pas déjà embauché
  const hiredIds = new Set((STORE.bastion?.personnel || []).map(e => e.npcId).filter(Boolean));
  const eligible = allNpcs.filter(n =>
    n.disposition === 'Allié' &&
    (n.activites || []).includes(roomSlug) &&
    !hiredIds.has(n.id)
  ).sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));

  if (!eligible.length) {
    openModal(`👥 Embaucher pour ${def.emoji} ${def.nom}`, `
      <p style="font-size:.85rem;color:var(--text-soft)">
        Aucun PNJ recrutable pour <strong style="color:${def.color}">${_esc(def.nom)}</strong>.
      </p>
      <p style="font-size:.78rem;color:var(--text-muted);margin-top:.4rem">
        Critères : disposition <strong>Allié</strong> + activité <em>${_esc(def.nom)}</em> cochée dans la fiche du PNJ + pas déjà employé ailleurs.
      </p>
    `);
    return;
  }

  // Génère les cards d'aperçu sous le select
  const cardsHtml = eligible.map(n => {
    const portrait = n.imageUrl
      ? `<img src="${_esc(n.imageUrl)}" alt="${_esc(n.nom || '')}" class="bs-hire-card-img">`
      : `<span class="bs-hire-card-init">${(n.nom||'?')[0].toUpperCase()}</span>`;
    return `<div class="bs-hire-card" data-npc-id="${n.id}" data-action="_bastionSelectHireCard" data-id="${n.id}">
      <div class="bs-hire-card-av">${portrait}</div>
      <div class="bs-hire-card-body">
        <div class="bs-hire-card-name">${_esc(n.nom || '?')}</div>
        ${n.role ? `<div class="bs-hire-card-role">${_esc(n.role)}</div>` : ''}
        ${n.passif ? `<div class="bs-hire-card-bonus">🎁 ${_esc(n.passif)}</div>` : ''}
        <div class="bs-hire-card-salary">💰 ${n.salaireSuggere || 0} or / période</div>
      </div>
    </div>`;
  }).join('');

  openModal(`👥 Embaucher pour ${def.emoji} ${def.nom}`, `
    <p style="font-size:.85rem;color:var(--text-soft);margin-bottom:.4rem">
      Slot ${assigned + 1} / ${curNiv} · Choisis un allié spécialisé pour <strong style="color:${def.color}">${_esc(def.nom)}</strong> :
    </p>
    <div class="bs-hire-cards">${cardsHtml}</div>
    <input type="hidden" id="bs-hire-roomSlug" value="${roomSlug}">
    <input type="hidden" id="bs-hire-selected-npc" value="">
    <button class="btn btn-gold" style="width:100%;margin-top:.6rem" id="bs-hire-submit"
      data-action="_bastionDoHire" disabled>Sélectionne un allié</button>
  `);
}

function _bastionSelectHireCard(npcId) {
  document.querySelectorAll('.bs-hire-card').forEach(c => c.classList.toggle('selected', c.dataset.npcId === npcId));
  const hidden = document.getElementById('bs-hire-selected-npc');
  if (hidden) hidden.value = npcId;
  const btn = document.getElementById('bs-hire-submit');
  if (btn) {
    btn.disabled = false;
    const npc = (STORE.hireNpcsCache || []).find(n => n.id === npcId);
    btn.textContent = npc ? `✓ Embaucher ${npc.nom}` : 'Embaucher';
  }
}

async function _bastionDoHire() {
  if (STORE.hireInProgress) return;
  if (!STATE.isAdmin) return;
  STORE.hireInProgress = true;
  const npcId    = document.getElementById('bs-hire-selected-npc')?.value;
  const roomSlug = document.getElementById('bs-hire-roomSlug')?.value || null;
  if (!npcId) { showNotif('Sélectionne un PNJ.', 'error'); return; }
  if (!roomSlug) { showNotif('Aucune salle ciblée.', 'error'); return; }
  const npc = (STORE.hireNpcsCache || []).find(n => n.id === npcId);
  if (!npc) { showNotif('PNJ introuvable.', 'error'); return; }
  // Sécurité : revérifier slot libre + critères (race possible si plusieurs MJs)
  const def = _getRoomDef(roomSlug);
  const curNiv = _roomNiveau(STORE.bastion, roomSlug);
  const assigned = (STORE.bastion?.personnel || []).filter(e => e.roomSlug === roomSlug).length;
  if (assigned >= curNiv) { showNotif(`${def?.nom || 'Salle'} pleine.`, 'error'); return; }
  if (npc.disposition !== 'Allié') { showNotif(`${npc.nom} n'est pas un Allié.`, 'error'); return; }

  const b = { ...STORE.bastion };
  b.personnel = [...(b.personnel || []), {
    id:       `emp_${Date.now().toString(36)}`,
    nom:      npc.nom || '?',
    role:     npc.role || '',
    salaire:  parseInt(npc.salaireSuggere) || 0,
    bonus:    npc.passif || '',
    npcId,
    roomSlug,
    hiredAtWeek: b.semaine || 1,
  }];
  _addHistorique(b, 'hire', `🤝 ${npc.nom || '?'} rejoint ${def?.nom || 'le bastion'}`);
  try {
    await _save(b);
    closeModal();
    showNotif(`✓ ${npc.nom} affecté à ${def?.nom || 'la salle'}.`, 'success');
  } finally {
    STORE.hireInProgress = false;
  }
}

async function _bastionFireEmployee(empId) {
  if (!STATE.isAdmin) return;
  const emp = (STORE.bastion?.personnel || []).find(e => e.id === empId);
  if (!emp) return;
  const ok = await confirmModal(`Renvoyer ${emp.nom} ?`, {
    title: 'Renvoyer un employé', okLabel: 'Renvoyer', cancelLabel: 'Annuler',
  }).catch(() => false);
  if (!ok) return;
  const b = { ...STORE.bastion };
  b.personnel = (b.personnel || []).filter(e => e.id !== empId);
  _addHistorique(b, 'fire', `👋 ${emp.nom || '?'} quitte le bastion`);
  await _save(b);
  closeModal();
  showNotif(`${emp.nom} a quitté le bastion.`, 'success');
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT JSON — backup du bastion
// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// PRÉVISUALISATION MJ — projette l'état dans N semaines sans rien modifier
// ══════════════════════════════════════════════════════════════════════════════
function _bastionOpenPreview() {
  if (!STATE.isAdmin) return;
  openModal('🔮 Prévisualisation', `
    <p style="font-size:.85rem;color:var(--text-soft);margin-bottom:.7rem">
      Simule le passage de N semaines sans rien sauvegarder. Utile pour planifier la trésorerie.
    </p>
    <div class="form-group">
      <label>Nombre de périodes à projeter</label>
      <input type="number" class="input-field" id="bs-preview-n" value="4" min="1" max="52"
        data-input="_bastionRunPreview">
    </div>
    <div id="bs-preview-result"></div>
  `);
  _bastionRunPreview();
}

function _bastionRunPreview() {
  const n = parseInt(document.getElementById('bs-preview-n')?.value) || 0;
  const out = document.getElementById('bs-preview-result');
  if (!out || !STORE.bastion) return;
  if (n <= 0) { out.innerHTML = ''; return; }

  // Snapshot pur (deep copy) puis simulation sans écriture Firestore
  const b = JSON.parse(JSON.stringify(STORE.bastion));
  const trace = []; // log compact des changements significatifs

  for (let w = 1; w <= n; w++) {
    b.semaine = (b.semaine || 1) + 1;
    // Constructions
    for (const slug of Object.keys(b.salles || {})) {
      const s = b.salles[slug];
      if (s.weeksLeftToBuild > 0) {
        s.weeksLeftToBuild -= 1;
        if (s.weeksLeftToBuild <= 0) {
          s.niveau = s.targetNiveau;
          s.targetNiveau = null;
          s.weeksLeftToBuild = 0;
          const def = _getRoomDef(slug);
          const nivLabel = def?.unlimited ? `Niv. ${s.niveau}` : NIVEAU_LABEL[s.niveau];
          trace.push({ week: b.semaine, msg: `✅ ${def?.emoji || ''} ${def?.nom || slug} ${nivLabel}` });
        }
      }
    }
    // Productions
    let weekOr = 0, weekItems = 0;
    for (const slug of Object.keys(b.salles || {})) {
      const s = b.salles[slug];
      if (!s.niveau || s.weeksLeftToBuild > 0) continue;
      const def = _getRoomDef(slug);
      const nv = _getNiveauData(def, s.niveau);
      if (!nv?.prod) continue;
      if (nv.prod.or > 0) { b.or = (b.or || 0) + nv.prod.or; weekOr += nv.prod.or; }
      (nv.prod.items || []).forEach(it => { weekItems += (it.q || 1); });
    }
    // Salaires
    const totalSalaires = (b.personnel || []).reduce((s, e) => s + (parseInt(e.salaire) || 0), 0);
    const paid = Math.min(b.or || 0, totalSalaires);
    b.or = (b.or || 0) - paid;
    const unpaid = totalSalaires - paid;
    if (unpaid > 0) trace.push({ week: b.semaine, msg: `⚠ Salaires impayés : ${unpaid} or manquants` });
  }

  // Snapshot final
  const finalOr = b.or || 0;
  const capacity = _bastionCapacity(b);
  const personnelCount = (b.personnel || []).length;
  const totalSalaires = (b.personnel || []).reduce((s, e) => s + (parseInt(e.salaire) || 0), 0);

  // Constructions terminées vs en cours
  const finished = trace.filter(t => t.msg.startsWith('✅'));
  const stillBuilding = Object.entries(b.salles || {})
    .filter(([_, s]) => s.weeksLeftToBuild > 0)
    .map(([slug, s]) => {
      const def = _getRoomDef(slug);
      return `${def?.emoji || ''} ${def?.nom || slug} : ${s.weeksLeftToBuild} période`;
    });
  const warnings = trace.filter(t => t.msg.startsWith('⚠'));

  const delta = (cur, init, label) => {
    const d = cur - init;
    const sign = d > 0 ? `<span style="color:var(--emerald,#22c38e)">+${d}</span>`
               : d < 0 ? `<span style="color:var(--crimson,#ff5a7e)">${d}</span>`
               : `<span style="color:var(--text-dim)">±0</span>`;
    return `<strong>${cur}</strong> ${label} ${sign}`;
  };

  out.innerHTML = `
    <div class="bs-preview-result">
      <div class="bs-preview-summary">
        <div><span class="bs-preview-ico">📅</span>Période ${b.semaine}</div>
        <div><span class="bs-preview-ico">💰</span>${delta(finalOr, STORE.bastion.or || 0, 'or')}</div>
        <div><span class="bs-preview-ico">📦</span><strong>${capacity}</strong> capacité</div>
        <div><span class="bs-preview-ico">👥</span><strong>${personnelCount}</strong> employés (${totalSalaires} or/période)</div>
      </div>

      ${finished.length ? `<div class="bs-preview-block">
        <div class="bs-preview-lbl">✅ Constructions terminées (${finished.length})</div>
        ${finished.map(t => `<div class="bs-preview-line">P${t.week} · ${_esc(t.msg)}</div>`).join('')}
      </div>` : ''}

      ${stillBuilding.length ? `<div class="bs-preview-block">
        <div class="bs-preview-lbl">🏗 Encore en construction</div>
        ${stillBuilding.map(s => `<div class="bs-preview-line">${_esc(s)}</div>`).join('')}
      </div>` : ''}

      ${warnings.length ? `<div class="bs-preview-block bs-preview-block--warn">
        <div class="bs-preview-lbl">⚠ Alertes (${warnings.length})</div>
        ${warnings.slice(0, 10).map(t => `<div class="bs-preview-line">P${t.week} · ${_esc(t.msg)}</div>`).join('')}
        ${warnings.length > 10 ? `<div class="bs-preview-line" style="font-style:italic;color:var(--text-dim)">… et ${warnings.length - 10} de plus</div>` : ''}
      </div>` : ''}

      <p style="font-size:.74rem;color:var(--text-dim);font-style:italic;margin-top:.6rem">
        ⓘ Simulation uniquement — rien n'est sauvegardé. Pour appliquer, utilise "▶ Passer la période" autant de fois que nécessaire.
      </p>
    </div>
  `;
}

function _bastionExportJSON() {
  if (!STORE.bastion) { showNotif('Aucune donnée à exporter.', 'error'); return; }
  const payload = {
    type: 'le-grand-jdr.bastion',
    version: 1,
    exportedAt: new Date().toISOString(),
    bastion: STORE.bastion,
  };
  const date = new Date().toISOString().slice(0, 10);
  const slug = (STORE.bastion.nom || 'bastion')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bastion';
  const filename = `${slug}-${date}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { try { document.body.removeChild(a); } catch {} URL.revokeObjectURL(url); }, 100);
  showNotif(`💾 ${filename} téléchargé`, 'success');
}

async function _bastionAdjustRessource(key, delta) {
  if (!STATE.isAdmin) return;
  const b = { ...STORE.bastion };
  b[key] = Math.max(0, (b[key] || 0) + delta);
  if (key === 'renommee' || key === 'influence') b[key] = Math.min(100, b[key]);
  // Pas de log : ajustements MJ silencieux
  await _save(b);
}

// ══════════════════════════════════════════════════════════════════════════════
// ACTIONS — Transfert d'or (verser / retirer) — joueurs & MJ
// ══════════════════════════════════════════════════════════════════════════════
// Renvoie la liste des personnages que l'utilisateur peut piloter pour transférer
// (MJ : tous · joueur : ses persos uniquement). Default = perso du joueur connecté.
function _eligibleChars() {
  return getVisibleCharacters({ sorted: true });
}

function _bastionOpenTransfer(direction) {
  // direction = 'deposit' | 'withdraw'
  const isDeposit = direction === 'deposit';
  let chars = _eligibleChars();
  if (!chars.length) { showNotif('Aucun personnage disponible.', 'error'); return; }

  // Sélection par défaut : perso du user, sinon premier
  // Liste déjà triée par _eligibleChars (joueur alpha → ★ par défaut → nom).
  // Default = le perso ★ de l'utilisateur, sinon son premier, sinon le premier de la liste.
  const defaultChar = getDefaultCharForUser(chars, STATE.user?.uid) || chars[0];
  const bastionOr = STORE.bastion?.or || 0;
  const titre = isDeposit ? '💰 Verser au Bastion' : '💸 Retirer du Trésor commun';
  const cta   = isDeposit ? 'Verser' : 'Retirer';
  const cls   = isDeposit ? 'btn-gold' : 'btn-outline';

  openModal(titre, `
    <div class="form-group">
      <label>Personnage</label>
      <select class="input-field" id="bas-tx-char" data-change="_bastionRefreshTransfer" data-direction="${direction}">
        ${chars.map(c => `<option value="${c.id}"${c.id === defaultChar.id ? ' selected' : ''}>${_esc(c.nom || '?')}${c.uid === STATE.user?.uid ? ' (vous)' : ''}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Montant <span id="bas-tx-info" style="font-size:.74rem;color:var(--text-dim);font-weight:400;margin-left:.5rem"></span></label>
      <input type="number" class="input-field" id="bas-tx-montant" min="1" value="50">
    </div>
    <button class="btn ${cls}" style="width:100%" data-action="_bastionDoTransfer" data-dir="${direction}">${cta}</button>
  `);
  // Init de l'info "Or disponible"
  _bastionRefreshTransfer(direction);
}

function _bastionRefreshTransfer(direction) {
  const isDeposit = direction === 'deposit';
  const charId = document.getElementById('bas-tx-char')?.value;
  const char   = (STATE.characters || []).find(c => c.id === charId);
  const info   = document.getElementById('bas-tx-info');
  const input  = document.getElementById('bas-tx-montant');
  if (!char || !info || !input) return;

  if (isDeposit) {
    const monOr = calcOr(char);
    info.textContent = `(or de ${char.nom||'?'} : ${monOr})`;
    input.max = monOr;
    if (parseInt(input.value) > monOr) input.value = monOr;
  } else {
    const bastionOr = STORE.bastion?.or || 0;
    info.textContent = `(trésor commun : ${bastionOr})`;
    input.max = bastionOr;
    if (parseInt(input.value) > bastionOr) input.value = bastionOr;
  }
}

async function _bastionDoTransfer(direction) {
  const isDeposit = direction === 'deposit';
  const charId = document.getElementById('bas-tx-char')?.value;
  const amount = parseInt(document.getElementById('bas-tx-montant')?.value) || 0;
  const char   = (STATE.characters || []).find(c => c.id === charId);
  if (!char) { showNotif('Personnage introuvable.', 'error'); return; }
  if (amount <= 0) { showNotif('Montant invalide.', 'error'); return; }

  const monOr = calcOr(char);
  const bastionOr = STORE.bastion?.or || 0;
  if (isDeposit && amount > monOr) { showNotif(`${char.nom||'?'} n'a que ${monOr} or.`, 'error'); return; }
  if (!isDeposit && amount > bastionOr) { showNotif(`Le trésor n'a que ${bastionOr} or.`, 'error'); return; }

  try {
    // 1. Mouvement côté perso (via le module economy unifié)
    const reason = isDeposit ? 'Or versé au Bastion' : 'Or retiré du Bastion';
    const delta  = isDeposit ? -amount : +amount;
    const res = await useGold(char.id, delta, reason, { charObj: char });
    if (!res.ok) { showNotif(res.error || 'Erreur transaction', 'error'); return; }

    // 2. Mouvement côté bastion + historique
    const b = { ...STORE.bastion };
    b.or = Math.max(0, (b.or || 0) + (isDeposit ? amount : -amount));
    const verb = isDeposit ? 'verse' : 'retire';
    const ico  = isDeposit ? '💰' : '💸';
    _addHistorique(b, isDeposit ? 'depot' : 'retrait', `${ico} ${char.nom || 'Un héros'} ${verb} ${amount} or${isDeposit ? ' au bastion' : ' du trésor'}`);
    await _save(b);

    closeModal();
    showNotif(`✓ ${amount} or ${isDeposit ? 'versés' : 'retirés'}.`, 'success');
  } catch (e) { notifySaveError(e); }
}

// ══════════════════════════════════════════════════════════════════════════════
// ACTIONS — Investissement ciblé dans une salle (joueurs & MJ)
// ══════════════════════════════════════════════════════════════════════════════
function _investmentDocId(uid, charId, roomSlug) {
  return [uid, charId, roomSlug]
    .map(value => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_'))
    .join('__');
}


function _bastionRefreshInvestment(slug) {
  const charId = document.getElementById('bas-invest-char')?.value;
  const char = _eligibleChars().find(entry => entry.id === charId);
  const input = document.getElementById('bas-invest-amount');
  const info = document.getElementById('bas-invest-info');
  const def = _getRoomDef(slug);
  if (!char || !input || !info || !def) return;
  const nextDef = _getNiveauData(def, _roomNiveau(STORE.bastion, slug) + 1);
  const remaining = Math.max(0, (Number(nextDef?.cout) || 0) - _roomInvestmentAvailable(STORE.bastion, slug));
  const balance = calcOr(char);
  const max = Math.max(0, Math.min(balance, remaining));
  input.max = max;
  if ((Number(input.value) || 0) > max) input.value = max;
  info.textContent = `${char.nom || 'Ce personnage'} possède ${balance} or · maximum possible : ${max} or`;
}

function _bastionFillInvestment(slug) {
  _bastionRefreshInvestment(slug);
  const input = document.getElementById('bas-invest-amount');
  if (input) input.value = input.max || 0;
}

async function _bastionDoInvest(slug) {
  if (STORE.investmentInProgress) return;
  const b = STORE.bastion || _defaultBastion();
  const def = _getRoomDef(slug, b);
  if (!def || _roomBuilding(b, slug)) {
    showNotif('Cette salle est déjà en construction.', 'error');
    return;
  }
  const charId = document.getElementById('bas-invest-char')?.value;
  const char = _eligibleChars().find(entry => entry.id === charId);
  const amount = Math.floor(Number(document.getElementById('bas-invest-amount')?.value) || 0);
  const nextDef = _getNiveauData(def, _roomNiveau(b, slug) + 1);
  const remaining = Math.max(0, (Number(nextDef?.cout) || 0) - _roomInvestmentAvailable(b, slug));
  if (!char) { showNotif('Personnage introuvable.', 'error'); return; }
  if (amount <= 0 || amount > remaining || amount > calcOr(char)) {
    showNotif('Montant invalide ou supérieur à l’or disponible.', 'error');
    _bastionRefreshInvestment(slug);
    return;
  }

  STORE.investmentInProgress = true;
  const uid = STATE.user?.uid || '';
  const docId = _investmentDocId(uid, char.id, slug);
  const debit = await useGold(char.id, -amount, `Investissement Bastion : ${def.nom}`, { charObj: char });
  if (!debit.ok) {
    STORE.investmentInProgress = false;
    showNotif(debit.error || 'Impossible de débiter cet or.', 'error');
    return;
  }

  try {
    const now = Date.now();
    const saved = await mutateInCol('bastionInvestments', docId, current => ({
      uid,
      charId: char.id,
      charName: char.nom || 'Personnage',
      roomSlug: slug,
      amount: Math.max(0, Number(current?.amount) || 0) + amount,
      createdAt: current?.createdAt || now,
      updatedAt: now,
    }));
    const local = { id: docId, ...saved };
    const index = STORE.investments.findIndex(entry => entry.id === docId);
    if (index >= 0) STORE.investments.splice(index, 1, local);
    else STORE.investments.push(local);
    closeModal();
    _renderPage();
    showNotif(`${char.nom} investit ${amount} or dans ${def.nom}.`, 'success');
  } catch (error) {
    const rollback = await useGold(char.id, amount, `Remboursement : investissement ${def.nom} non enregistré`, { charObj: char });
    if (!rollback.ok) console.error('[bastion] remboursement investissement échoué', rollback.error);
    notifySaveError(error);
  } finally {
    STORE.investmentInProgress = false;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDU
// ══════════════════════════════════════════════════════════════════════════════
// ── Onglets (coquille de page, construite comme l'Agenda) ────────────────────
const _BS_TABS = [
  ['salles', '🧱', 'Salles'],
  ['mur',    '📣', 'Mur'],
  ['coffre', '📦', 'Coffre'],
];
const _BS_TAB_KEY = 'bs-tab';

function _bsGetTab() {
  if (STORE.tab && _BS_TABS.some(([k]) => k === STORE.tab)) return STORE.tab;
  try {
    const t = localStorage.getItem(_BS_TAB_KEY);
    if (_BS_TABS.some(([k]) => k === t)) { STORE.tab = t; return t; }
  } catch { /* stockage privé indisponible */ }
  return 'salles';
}
function _bastionSetTab(tab) {
  if (!_BS_TABS.some(([k]) => k === tab)) return;
  STORE.tab = tab;
  try { localStorage.setItem(_BS_TAB_KEY, tab); } catch { /* stockage privé indisponible */ }
  _renderPage();
}

// Perso courant du scope « Je joue » (source unique = _wallUi.charId, défaut = perso ★).
function _bastionScopeChar() {
  const chars = _eligibleChars();
  if (!chars.length) return null;
  return chars.find(c => c.id === _wallUi.charId)
    || getDefaultCharForUser(chars, STATE.user?.uid)
    || chars[0];
}

// Nombre de publications du mur non lues (badge rouge de l'onglet Mur).
function _bastionWallUnread() {
  let seen = Number(_wallRead?.seenAt) || 0;
  try { seen = Math.max(seen, Number(localStorage.getItem(bastionWallSeenKey(STATE.adventure?.id, STATE.user?.uid))) || 0); } catch { /* privé */ }
  return bastionWallUnreadCount(_wallAllPosts(), seen, STATE.user?.uid);
}

function _renderHeader(b) {
  const isMj = STATE.isAdmin;
  const chars = _eligibleChars();
  const hasChar = chars.length > 0;
  const bastionOr = b.or || 0;

  // Compteurs d'onglets.
  const catalog = _getRoomCatalog(b);
  const built = catalog.filter(def => _roomNiveau(b, def.slug) > 0).length;
  const activePosts = _wallAllPosts().filter(p => p.status !== 'cancelled').length;
  const unread = _bastionWallUnread();
  const used = _bastionInvCount(b);
  const capacity = _bastionCapacity(b);
  const tabCounts = {
    salles: `${built}/${catalog.length}`,
    mur: `${activePosts}`,
    coffre: `${used}/${capacity}`,
  };
  const activeTab = _bsGetTab();

  // Menu « Période ▾ » — regroupe TOUTES les actions MJ ; joueur = Personnel + Historique.
  const histoCount = (b.historique || []).filter(entry => !_ADMIN_HISTO_TYPES.has(entry.type)).length;
  const menuItems = isMj
    ? [
        `<button data-action="_bastionAdvanceWeek">▶ Passer la période</button>`,
        b._undoSnapshot ? `<button data-action="_bastionUndoWeek">↩ Annuler la période</button>` : '',
        `<hr class="bs-menu-sep">`,
        `<button data-action="_bastionEditIdentite">✏️ Identité du Bastion</button>`,
        `<button data-action="_bastionOpenCatalogEditor">🏛 Éditer les salles</button>`,
        `<button data-action="_bastionOpenPersonnel">👥 Personnel${b.personnel?.length ? ` (${b.personnel.length})` : ''}</button>`,
        `<button data-action="_bastionOpenQuestEditor">📋 Quêtes du Bastion</button>`,
        `<button data-action="_bastionOpenPreview">🔮 Prévisualiser la période</button>`,
        `<button data-action="_bastionOpenHistory">📜 Historique${histoCount ? ` (${histoCount})` : ''}</button>`,
        `<button data-action="_bastionExportJSON">💾 Exporter (JSON)</button>`,
      ]
    : [
        `<button data-action="_bastionOpenPersonnel">👥 Personnel${b.personnel?.length ? ` (${b.personnel.length})` : ''}</button>`,
        `<button data-action="_bastionOpenHistory">📜 Historique${histoCount ? ` (${histoCount})` : ''}</button>`,
      ];

  return `
    <header class="ag-top bs-top">
      <div class="ag-top-in">
        <div class="ag-top-row">
          <div class="ag-brand">
            <span aria-hidden="true" style="font-size:20px">${_esc(b.emoji || '🏰')}</span>
            <h1>${_esc(b.nom || 'Le Bastion')}</h1>
            <small>${b.lieu ? _esc(b.lieu) : 'Quartier général'}</small>
          </div>
          <div style="flex:1"></div>
          <div class="ag-scope bs-scope">
            <div class="ag-sc-btn"><small>Période</small><span>${b.semaine || 1}</span></div>
            <div class="ag-sc-btn"><small>Trésor</small><span>${bastionOr} or</span></div>
          </div>
          ${hasChar ? `<div class="bs-scope-tx">
            <button class="btn btn-outline btn-sm" data-action="_bastionOpenTransfer" data-dir="deposit">＋ Verser</button>
            ${bastionOr > 0 ? `<button class="btn btn-outline btn-sm" data-action="_bastionOpenTransfer" data-dir="withdraw">− Retirer</button>` : ''}
          </div>` : ''}
          <details class="ag-menu bs-menu">
            <summary class="ag-menu-btn" title="Actions du Bastion" aria-label="Actions du Bastion">⋯</summary>
            <div class="ag-menu-pop">${menuItems.filter(Boolean).join('')}</div>
          </details>
        </div>
        <nav class="ag-tabs bs-tabs" aria-label="Sections du Bastion">
          ${_BS_TABS.map(([k, ic, lbl]) => {
            const on = k === activeTab;
            const badge = k === 'mur' && unread > 0 ? `<span class="bs-tab-badge">${unread}</span>` : '';
            return `<button class="ag-tab${on ? ' is-on' : ''}" data-action="_bastionSetTab" data-tab="${k}" aria-pressed="${on}">
              <span aria-hidden="true">${ic}</span> ${lbl}
              <span class="ag-tab-cnt">${tabCounts[k]}</span>${badge}
            </button>`;
          }).join('')}
        </nav>
      </div>
    </header>`;
}

function _bastionProductionSummary(b) {
  const summary = { or: 0, items: [], rooms: [] };
  _getRoomCatalog(b).forEach(def => {
    const niv = _roomNiveau(b, def.slug);
    if (niv <= 0 || _roomBuilding(b, def.slug)) return;
    const data = _getNiveauData(def, niv) || {};
    const prod = data.prod || {};
    const items = (prod.items || []).map(item => ({ ...item, room: def.nom }));
    summary.or += Number(prod.or) || 0;
    summary.items.push(...items);
    if ((prod.or || 0) > 0 || items.length) {
      summary.rooms.push({ def, niv, prod });
    }
  });
  return summary;
}

// Pastilles de niveau (I·II·III, hachurée = cible en chantier) ; Entrepôt = texte.
function _roomPips(def, b) {
  if (def.unlimited) {
    const niv = _roomNiveau(b, def.slug);
    return `<span class="bs-pips-unl">Niv. ${niv} · ${_bastionCapacity(b)} pl.</span>`;
  }
  const cur = _roomNiveau(b, def.slug);
  const building = _roomBuilding(b, def.slug);
  const target = b?.salles?.[def.slug]?.targetNiveau || 0;
  let pips = '';
  for (let n = 1; n <= 3; n++) {
    const on = n <= cur, build = building && n === target;
    pips += `<i class="bs-pip${on ? ' on' : ''}${build ? ' build' : ''}"></i>`;
  }
  return `<span class="bs-pips" aria-label="Niveau ${cur}/3">${pips}</span>`;
}

// Prédicat de filtre (partagé rendu + compteurs).
function _roomMatchesFilter(def, b, f) {
  if (f === 'all') return true;
  const cur = _roomNiveau(b, def.slug);
  const building = _roomBuilding(b, def.slug);
  if (f === 'building') return building;
  if (f === 'built')    return cur > 0 && !building;
  if (f === 'todo')     return cur === 0 && !building;
  if (f === 'funding') {
    if (building || cur >= _maxLevel(def)) return false;
    const invested = _roomInvestmentAvailable(b, def.slug);
    const cost = _getNiveauData(def, cur + 1)?.cout || 0;
    return invested > 0 && invested < cost;
  }
  return true;
}

// Ligne compacte : icône, nom + pastilles, ce qu'elle apporte (2 lignes), état.
function _renderRoomRow(def, b) {
  const cur = _roomNiveau(b, def.slug);
  const building = _roomBuilding(b, def.slug);
  const max = _maxLevel(def);
  const isUnl = !!def.unlimited;
  const selected = STORE.roomSel === def.slug;

  let apporte;
  if (cur > 0) {
    const nd = _getNiveauData(def, cur) || {};
    const parts = [];
    if (nd.prod?.or > 0) parts.push(`+${nd.prod.or} or`);
    for (const it of (nd.prod?.items || [])) parts.push(`${it.emoji || ''} ${it.nom}${it.q > 1 ? ` ×${it.q}` : ''}`);
    if (isUnl) parts.push(`Capacité ${_bastionCapacity(b)}`);
    apporte = `<div class="bs-rr-prod">${parts.length ? _esc(parts.join(' · ')) : '—'}</div>`
      + (nd.bonus ? `<div class="bs-rr-bonus">🎁 ${_esc(nd.bonus)}</div>` : '');
  } else {
    apporte = `<div class="bs-rr-prod bs-rr-muted">Non construite</div>`;
  }

  let state;
  if (building) {
    state = `<div class="bs-rr-state is-build">🏗 ${b.salles[def.slug].weeksLeftToBuild} pér.</div>`;
  } else if (cur >= max) {
    state = `<div class="bs-rr-state is-max">✦ Max</div>`;
  } else {
    const nd = _getNiveauData(def, cur + 1) || { cout: 0 };
    const invested = _roomInvestmentAvailable(b, def.slug);
    const shown = Math.min(invested, nd.cout);
    const pct = nd.cout > 0 ? Math.min(100, Math.round(shown / nd.cout * 100)) : 0;
    state = `<div class="bs-rr-state is-fund">
      <span>${shown}/${nd.cout} or</span>
      <i class="bs-rr-bar"><b style="width:${pct}%;background:${def.color}"></b></i>
    </div>`;
  }

  return `<button type="button" class="bs-room-row${selected ? ' is-selected' : ''}${building ? ' is-building' : ''}" style="--c:${def.color}"
      data-action="_bastionSelectRoom" data-slug="${_esc(def.slug)}" aria-pressed="${selected}">
    <span class="bs-rr-emoji">${def.emoji}</span>
    <div class="bs-rr-main">
      <div class="bs-rr-top"><span class="bs-rr-name">${_esc(def.nom)}</span>${_roomPips(def, b)}</div>
      ${apporte}
    </div>
    ${state}
  </button>`;
}

// Fiche collante : en-tête, Ce qu'elle apporte, Cotisation (+ chantier MJ), Paliers, Personnel.
function _renderRoomDetail(def, b) {
  if (!def) return `<div class="bs-fiche bs-fiche-empty">Sélectionne une salle pour voir ses détails.</div>`;
  const isMj = STATE.isAdmin;
  const cur = _roomNiveau(b, def.slug);
  const building = _roomBuilding(b, def.slug);
  const max = _maxLevel(def);
  const isUnl = !!def.unlimited;
  const nivLbl = (n) => isUnl ? `${n}` : (NIVEAU_LABEL[n] || n);
  const target = cur >= max ? null : cur + 1;
  const nextDef = target ? _getNiveauData(def, target) : null;

  const header = `<div class="bs-fiche-hd">
    <span class="bs-fiche-emoji">${def.emoji}</span>
    <div class="bs-fiche-ttl">
      <h3>${_esc(def.nom)}</h3>
      <small>${cur > 0 ? `Niv. ${nivLbl(cur)}${isUnl ? ` / ${max}` : ''}` : 'Non construite'}${building ? ` · 🏗 → ${nivLbl(b.salles[def.slug].targetNiveau)}` : ''}</small>
    </div>
    ${isMj && !isUnl ? `<button class="btn btn-outline btn-sm" data-action="_bastionEditRoom" data-slug="${_esc(def.slug)}">✏️ Modifier</button>` : ''}
  </div>`;

  // Ce qu'elle apporte (niveau actuel, sinon aperçu niveau I).
  const showNiv = cur > 0 ? cur : 1;
  const apDef = _getNiveauData(def, showNiv) || {};
  const apParts = [];
  if (apDef.prod?.or > 0) apParts.push(`<li>🪙 +${apDef.prod.or} or / période</li>`);
  for (const it of (apDef.prod?.items || [])) apParts.push(`<li>${it.emoji || '📦'} ${_esc(it.nom)}${it.q > 1 ? ` ×${it.q}` : ''} / période</li>`);
  if (isUnl) apParts.push(`<li>📦 Capacité du coffre : ${20 + showNiv * (def.capacitePerLevel || 10)} objets</li>`);
  if (apDef.bonus) apParts.push(`<li>🎁 ${_esc(apDef.bonus)}</li>`);
  const apporte = `<div class="bs-fiche-sec">
    <h4>Ce qu'elle apporte${cur > 0 ? '' : ' (niveau I)'}</h4>
    <ul class="bs-fiche-list">${apParts.join('') || '<li class="bs-rr-muted">Aucun effet direct.</li>'}</ul>
  </div>`;

  // Cotisation vers le niveau suivant (ou encart chantier).
  let fund;
  if (building) {
    const s = b.salles[def.slug];
    const totalSem = _getNiveauData(def, s.targetNiveau)?.semaines || 1;
    const pct = totalSem > 0 ? Math.round((totalSem - s.weeksLeftToBuild) / totalSem * 100) : 0;
    fund = `<div class="bs-fiche-sec">
      <h4>🏗 Chantier en cours</h4>
      <div class="bs-fiche-fundbar"><i style="width:${pct}%;background:${def.color}"></i></div>
      <p class="bs-fiche-note">Niv. ${nivLbl(s.targetNiveau)} — ${s.weeksLeftToBuild} période(s) restante(s).</p>
      ${isMj ? `<button class="btn btn-outline btn-sm bs-fiche-cancel" data-action="_bastionCancelBuild" data-slug="${_esc(def.slug)}">✖ Annuler le chantier</button>` : ''}
    </div>`;
  } else if (nextDef) {
    const invested = _roomInvestmentAvailable(b, def.slug);
    const shown = Math.min(invested, nextDef.cout);
    const remaining = Math.max(0, nextDef.cout - invested);
    const pct = nextDef.cout > 0 ? Math.min(100, Math.round(shown / nextDef.cout * 100)) : 100;
    const contributors = _roomInvestmentContributors(def.slug);
    const chars = _eligibleChars();
    const scope = _bastionScopeChar();
    const plan = roomFundingPlan(nextDef.cout, invested, b.or || 0);
    const contribHtml = contributors.length
      ? `<div class="bs-fiche-contribs">${contributors.map(c => `<span><b>${_esc(c.charName)}</b> ${c.amount} or</span>`).join('')}</div>`
      : `<p class="bs-fiche-note">Aucune contribution pour l'instant.</p>`;
    const investCtrls = (chars.length && remaining > 0) ? `
      <div class="bs-fiche-invest">
        <select class="input-field" id="bas-invest-char" data-change="_bastionRefreshInvestment" data-slug="${_esc(def.slug)}" aria-label="Personnage qui cotise">
          ${chars.map(c => `<option value="${c.id}"${scope && c.id === scope.id ? ' selected' : ''}>${_esc(c.nom || '?')}</option>`).join('')}
        </select>
        <div class="bs-fiche-quick">
          <input type="number" class="input-field" id="bas-invest-amount" min="1" placeholder="Montant en or…" aria-label="Montant à cotiser">
          <button type="button" class="bs-fiche-fill" data-action="_bastionFillInvestment" data-slug="${_esc(def.slug)}">Compléter</button>
        </div>
        <small id="bas-invest-info" class="bs-fiche-note"></small>
        <button type="button" class="btn btn-gold btn-sm bs-fiche-go" data-action="_bastionDoInvest" data-slug="${_esc(def.slug)}">🤝 Cotiser le montant</button>
      </div>`
      : (remaining === 0 ? `<p class="bs-fiche-note">✓ Niveau entièrement financé.</p>` : `<p class="bs-fiche-note">Aucun personnage disponible pour cotiser.</p>`);
    const buildBtn = isMj
      ? (plan.canFund
          ? `<button class="btn btn-gold bs-fiche-build" data-action="_bastionBuild" data-slug="${_esc(def.slug)}">🏗 Lancer le chantier · Niv. ${nivLbl(target)}<span>${plan.investmentUsed} investis + ${plan.treasuryUsed} trésor</span></button>`
          : `<div class="bs-fiche-note">${plan.missing} or manquants (cagnotte + trésor) pour lancer le chantier.</div>`)
      : '';
    fund = `<div class="bs-fiche-sec">
      <h4>🤝 Cotisation → Niv. ${nivLbl(target)}</h4>
      <div class="bs-fiche-fundhead"><strong>${shown} / ${nextDef.cout} or</strong><span>${nextDef.semaines} période(s)</span></div>
      <div class="bs-fiche-fundbar"><i style="width:${pct}%;background:${def.color}"></i></div>
      ${contribHtml}
      ${investCtrls}
      ${buildBtn}
    </div>`;
  } else {
    fund = `<div class="bs-fiche-sec"><h4>Niveau maximum</h4><p class="bs-fiche-note">✦ Cette salle est au niveau maximum.</p></div>`;
  }

  // Paliers.
  let paliers;
  if (!isUnl) {
    const target2 = b?.salles?.[def.slug]?.targetNiveau || 0;
    paliers = `<div class="bs-fiche-sec"><h4>Paliers</h4><div class="bs-fiche-tiers">
      ${def.niveaux.map((nd, i) => {
        const n = i + 1;
        const st = n <= cur ? 'done' : (building && n === target2 ? 'build' : (n === cur + 1 ? 'next' : 'todo'));
        const prod = [];
        if (nd.prod?.or > 0) prod.push(`+${nd.prod.or} or`);
        for (const it of (nd.prod?.items || [])) prod.push(`${it.emoji || ''}${it.q > 1 ? `×${it.q}` : ''}`);
        return `<div class="bs-tier is-${st}">
          <div class="bs-tier-h"><b>Niv. ${NIVEAU_LABEL[n]}</b><span>${nd.cout} or · ${nd.semaines} pér.</span></div>
          <div class="bs-tier-b">${prod.length ? _esc(prod.join(' · ')) : ''}${nd.bonus ? `<em>🎁 ${_esc(nd.bonus)}</em>` : ''}</div>
        </div>`;
      }).join('')}
    </div></div>`;
  } else {
    paliers = `<div class="bs-fiche-sec"><h4>Paliers</h4><p class="bs-fiche-note">Chaque niveau ajoute +${def.capacitePerLevel || 10} de capacité (jusqu'à ${max}). Coût de base ${def.baseCost || 100} or, ×${def.costMultiplier || 1.1} par niveau.</p></div>`;
  }

  // Personnel (hors Entrepôt).
  let personnel = '';
  if (!isUnl) {
    const assigned = (b.personnel || []).filter(e => e.roomSlug === def.slug);
    const slots = cur;
    const npcs = STORE.hireNpcsCache || STORE.npcsCache || [];
    const cards = assigned.map(e => {
      const npc = e.npcId ? npcs.find(n => n.id === e.npcId) : null;
      const portrait = npc?.imageUrl
        ? `<img src="${npc.imageUrl}" alt="${_esc(npc.nom || e.nom || '')}" class="bs-emp-mini-img">`
        : `<span class="bs-emp-mini-init">${(e.nom || '?')[0].toUpperCase()}</span>`;
      return `<div class="bs-emp-mini" title="${_esc(e.bonus || 'Aucun passif renseigné')}">
        <div class="bs-emp-mini-av">${portrait}</div>
        <div class="bs-emp-mini-body">
          <div class="bs-emp-mini-name">${_esc(e.nom || '?')}</div>
          ${e.bonus ? `<div class="bs-emp-mini-bonus">🎁 ${_esc(e.bonus)}</div>` : `<div class="bs-emp-mini-role">${_esc(e.role || '')}</div>`}
        </div>
        ${isMj ? `<button class="bs-emp-mini-rm" data-action="_bastionFireEmployee" data-id="${e.id}" title="Renvoyer">✕</button>` : ''}
      </div>`;
    }).join('');
    const free = Math.max(0, slots - assigned.length);
    const addBtn = (isMj && free > 0 && cur > 0) ? `<button class="bs-emp-add" data-action="_bastionOpenHire" data-slug="${_esc(def.slug)}">＋ Embaucher (${free} libre${free > 1 ? 's' : ''})</button>` : '';
    personnel = `<div class="bs-fiche-sec"><h4>👥 Personnel${cur > 0 ? ` ${assigned.length}/${slots}` : ''}</h4>
      ${cur > 0 ? ((cards + addBtn) || '<p class="bs-fiche-note">Aucun employé.</p>') : '<p class="bs-fiche-note">Construis la salle pour affecter du personnel.</p>'}
    </div>`;
  }

  return `<div class="bs-fiche" style="--c:${def.color}">${header}${apporte}${fund}${paliers}${personnel}</div>`;
}

function _bastionSelectRoom(slug) { STORE.roomSel = slug; _renderPage(); }
function _bastionSetRoomFilter(f) { STORE.roomFilter = f; _renderPage(); }

function _renderRooms(b) {
  const isMj = STATE.isAdmin;
  const catalog = _getRoomCatalog(b);

  // Résout la salle sélectionnée (défaut : 1re construite, sinon 1re du catalogue).
  let sel = catalog.find(d => d.slug === STORE.roomSel);
  if (!sel) sel = catalog.find(d => _roomNiveau(b, d.slug) > 0) || catalog[0] || null;
  STORE.roomSel = sel?.slug || null;

  const F = STORE.roomFilter || 'all';
  const filtered = catalog.filter(def => _roomMatchesFilter(def, b, F));

  // Bandeau « Chaque période » : production + capacité du coffre.
  const prod = _bastionProductionSummary(b);
  const prodParts = [];
  if (prod.or > 0) prodParts.push(`🪙 +${prod.or} or`);
  if (prod.items.length) prodParts.push(`📦 ${prod.items.length} objet${prod.items.length > 1 ? 's' : ''}`);
  const used = _bastionInvCount(b), capacity = _bastionCapacity(b);
  const topBar = `<div class="bs-salles-top">
    <div class="bs-salles-top-cell"><small>Chaque période</small><strong>${prodParts.length ? prodParts.join(' · ') : 'Aucune production'}</strong></div>
    <div class="bs-salles-top-cell"><small>Coffre</small><strong>${used} / ${capacity} objets</strong></div>
  </div>`;

  const FILTERS = [['all', 'Toutes'], ['built', 'Construites'], ['funding', 'En cotisation'], ['building', 'En chantier'], ['todo', 'À construire']];
  const filterBar = `<div class="bs-salles-filters" role="group" aria-label="Filtrer les salles">
    ${FILTERS.map(([k, lbl]) => {
      const n = catalog.filter(d => _roomMatchesFilter(d, b, k)).length;
      return `<button type="button" class="bs-salles-filter${F === k ? ' is-on' : ''}" data-action="_bastionSetRoomFilter" data-filter="${k}" aria-pressed="${F === k}">${lbl}<span class="bs-salles-filter-n">${n}</span></button>`;
    }).join('')}
  </div>`;

  const listHtml = filtered.length
    ? filtered.map(def => _renderRoomRow(def, b)).join('')
    : `<div class="bs-coffre-empty">Aucune salle dans ce filtre.</div>`;
  const addRow = isMj ? `<button type="button" class="bs-room-row bs-room-row--add" data-action="_bastionAddCustomRoom">＋ Nouvelle salle / activité</button>` : '';

  return `
    <section class="bs-section bs-salles">
      <div class="bs-section-hd">
        <h2 class="bs-section-title">🏛 Salles &amp; activités</h2>
        ${isMj && catalog.some(d => _roomNiveau(b, d.slug) > 0 || _roomBuilding(b, d.slug)) ? `<button class="btn btn-outline btn-sm bs-reset-btn"
          data-action="_bastionResetRooms" title="Réinitialiser toutes les salles construites">🔄 Reset salles</button>` : ''}
      </div>
      ${topBar}
      ${filterBar}
      <div class="bs-salles-layout">
        <div class="bs-salles-list">${listHtml}${addRow}</div>
        <aside class="bs-salles-fiche">${_renderRoomDetail(sel, b)}</aside>
      </div>
    </section>`;
}

async function _bastionResetRooms() {
  if (!STATE.isAdmin) return;
  const built = Object.entries(STORE.bastion?.salles || {})
    .filter(([_, s]) => (s?.niveau || 0) > 0 || s?.weeksLeftToBuild > 0)
    .length;
  if (!built) { showNotif('Aucune salle à réinitialiser.', 'error'); return; }

  const empCount = (STORE.bastion?.personnel || []).length;
  const detail = `Va effacer la construction de ${built} salle${built > 1 ? 's' : ''}.\n` +
    (empCount > 0 ? `\n⚠ Les ${empCount} employé${empCount > 1 ? 's' : ''} resteront en place mais deviendront « Non assignés ».\n` : '') +
    `\nLe coffre, l'or et la chronique sont conservés.`;

  const ok = await confirmModal(detail, {
    title: '🔄 Réinitialiser les salles',
    okLabel: 'Réinitialiser', cancelLabel: 'Annuler',
  }).catch(() => false);
  if (!ok) return;

  const b = { ...STORE.bastion };
  b.salles = {};
  await _save(b);
  showNotif('Salles réinitialisées.', 'success');
}

// Catégorise un item du coffre pour le filtrage. Heuristique :
//   1. item.originalItem.type / .categorie  → cohérent avec la boutique
//   2. fallback sur emoji
//   3. fallback "autre"
function _coffreItemCategory(item) {
  const o = item.originalItem || {};
  const t = (o.type || o.categorie || '').toLowerCase();
  if (/arm[eo]|épée|lance|hache|dague|arc|baton/.test(t)) return 'armes';
  if (/armure|bouclier|casque|cape|gantelet/.test(t)) return 'armures';
  if (/potion|élixir|breuvage|antidote/.test(t)) return 'potions';
  if (/scroll|parchemin|grimoire|tome/.test(t)) return 'scrolls';
  if (/bijou|anneau|collier|amulette/.test(t)) return 'bijoux';
  if (/ressource|matér|minera/.test(t)) return 'ressources';
  // Fallback emoji
  const e = item.emoji || '';
  if (/⚔️|🗡|🏹|🪓|🔪|🛠/.test(e)) return 'armes';
  if (/🛡|🎽|👢|👑/.test(e)) return 'armures';
  if (/🧪|💚|⚗️/.test(e)) return 'potions';
  if (/📜|📕|🔮/.test(e)) return 'scrolls';
  if (/💎|💍|🏵️/.test(e)) return 'bijoux';
  return 'autre';
}


function _bastionSetCoffreFilter(cat) { STORE.coffreFilter = cat; _renderPage(); }
function _bastionSetCoffreSearch(val) {
  STORE.coffreSearchRaw = val || '';
  STORE.coffreSearch = _norm(val || '');
  _renderPage();
  const el = document.getElementById('bas-coffre-q');
  if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch { /* noop */ } }
}

// Catégories du coffre : libellé, couleur, emoji (chips + icône de repli).
const _COFFRE_CATS = {
  armes:      { l: 'Armes',      c: '#ff6b4a', e: '⚔️' },
  armures:    { l: 'Armures',    c: '#4f8cff', e: '🛡' },
  potions:    { l: 'Potions',    c: '#22c38e', e: '🧪' },
  scrolls:    { l: 'Scrolls',    c: '#9d6fff', e: '📜' },
  bijoux:     { l: 'Bijoux',     c: '#e8b84b', e: '💎' },
  ressources: { l: 'Ressources', c: '#a0a8b8', e: '🪵' },
  autre:      { l: 'Autre',      c: '#7a8699', e: '📦' },
};

function _bastionCoffreOpen(id) { STORE.coffreOpen = STORE.coffreOpen === id ? null : id; STORE.takeQty = 1; _renderPage(); }
function _bastionCoffreQty(delta, max) {
  STORE.takeQty = Math.max(1, Math.min(Number(max) || 1, (STORE.takeQty || 1) + Number(delta)));
  _renderPage();
}
// Retrait en ligne : réutilise _bastionDoWithdraw (lit #bas-wd-char / #bas-wd-qte).
async function _bastionCoffreTake(id) {
  STORE.coffreOpen = null;
  await _bastionDoWithdraw(id);
  if (STATE.currentPage === 'bastion') _renderPage();
}
function _bastionCoffreExpand() { STORE.roomSel = 'entrepot'; _bastionSetTab('salles'); }

function _renderCoffre(b) {
  const coffre = (b.coffre || []);
  const capacity = _bastionCapacity(b);
  const used = _bastionInvCount(b);
  const pct = capacity > 0 ? Math.min(100, Math.round(used / capacity * 100)) : 0;
  const nearFull = pct > 85;
  const isFull = used >= capacity;
  const chars = _eligibleChars();
  const hasEligibleChar = chars.length > 0;
  const scope = _bastionScopeChar();
  const prod = _bastionProductionSummary(b);

  const myNoms = new Set(getVisibleCharacters().map(c => c.nom));
  const isMine = (it) => it.source && myNoms.size && [...myNoms].some(n => (it.source || '').includes(n));
  const counts = { all: coffre.length, mine: 0 };
  for (const k of Object.keys(_COFFRE_CATS)) counts[k] = 0;
  coffre.forEach(it => { counts[_coffreItemCategory(it)]++; if (isMine(it)) counts.mine++; });

  // Bande haute : Or + Capacité.
  const entrepotNiv = _roomNiveau(b, 'entrepot');
  const band = `<div class="bs-v-band">
    <div class="bs-v-cell">
      <div class="bs-v-kv"><span class="bs-v-lbl">Or du Bastion</span><span class="bs-v-val">${b.or || 0} <small>or</small></span>${prod.or > 0 ? `<span class="bs-v-sub">+${prod.or} or à la fin de la période</span>` : ''}</div>
      ${hasEligibleChar ? `<div class="bs-v-acts"><button class="bs-w-btn" data-action="_bastionOpenTransfer" data-dir="deposit">Déposer</button>${(b.or || 0) > 0 ? `<button class="bs-w-btn" data-action="_bastionOpenTransfer" data-dir="withdraw">Retirer</button>` : ''}</div>` : ''}
    </div>
    <div class="bs-v-cell">
      <div class="bs-v-kv"><span class="bs-v-lbl">Capacité</span><span class="bs-v-val">${used} <small>/ ${capacity} places</small></span>
        <div class="bs-v-bar" style="--bc:${nearFull ? 'var(--crimson, #ff5a7e)' : 'var(--gold)'}"><i style="width:${pct}%"></i></div>
        <span class="bs-v-sub">Entrepôt niv. ${entrepotNiv} · <a data-action="_bastionCoffreExpand">agrandir</a></span></div>
    </div>
  </div>`;

  // Outils : recherche + filtres + Déposer.
  const CATS = ['all', ...Object.keys(_COFFRE_CATS), 'mine'];
  const CAT_LABEL = (k) => k === 'all' ? 'Tout' : k === 'mine' ? '🎒 Mes dépôts' : `${_COFFRE_CATS[k].e} ${_COFFRE_CATS[k].l}`;
  const tools = `<div class="bs-v-tools">
    <label class="bs-v-search">🔍<input id="bas-coffre-q" type="search" placeholder="Chercher un objet…" value="${_esc(STORE.coffreSearchRaw)}" data-input="_bastionSetCoffreSearch"></label>
    <div class="bs-w-fchips">
      ${CATS.filter(k => k === 'all' || counts[k] > 0).map(k => `<button class="bs-w-fchip${STORE.coffreFilter === k ? ' on' : ''}"${_COFFRE_CATS[k] ? ` style="--tc:${_COFFRE_CATS[k].c}"` : ''} data-action="_bastionSetCoffreFilter" data-filter="${k}">${_COFFRE_CATS[k] ? '<i></i>' : ''}${CAT_LABEL(k)}<span>${counts[k]}</span></button>`).join('')}
    </div>
    ${hasEligibleChar ? `<button class="bs-w-btn bs-w-go bs-v-deposit" data-action="_bastionOpenDeposit" ${isFull ? 'disabled title="Coffre plein — améliore l\'Entrepôt"' : ''}>＋ Déposer un objet</button>` : ''}
  </div>`;

  // Filtrage + tri.
  let filtered = coffre.slice();
  if (STORE.coffreFilter === 'mine') filtered = filtered.filter(isMine);
  else if (STORE.coffreFilter !== 'all') filtered = filtered.filter(it => _coffreItemCategory(it) === STORE.coffreFilter);
  if (STORE.coffreSearch) filtered = filtered.filter(it => _norm(it.nom || '').includes(STORE.coffreSearch));
  filtered.sort((a, b2) => (b2.weekAdded || 0) - (a.weekAdded || 0));

  const rows = filtered.map(item => {
    const k = _COFFRE_CATS[_coffreItemCategory(item)] || _COFFRE_CATS.autre;
    const open = STORE.coffreOpen === item.id;
    const maxQ = item.quantite || 1;
    const takeRow = open ? `<div class="bs-v-take">
      <span class="bs-v-take-lbl">Prendre</span>
      <span class="bs-v-step"><button data-action="_bastionCoffreQty" data-delta="-1" data-max="${maxQ}">−</button><span>${STORE.takeQty}</span><button data-action="_bastionCoffreQty" data-delta="1" data-max="${maxQ}">+</button></span>
      <span class="bs-v-take-info">sur ${maxQ} · va à <b>${_esc(scope?.nom || '?')}</b></span>
      <select class="input-field bs-v-take-char" id="bas-wd-char" aria-label="Personnage destinataire">${chars.map(c => `<option value="${c.id}"${scope && c.id === scope.id ? ' selected' : ''}>${_esc(c.nom || '?')}</option>`).join('')}</select>
      <input type="hidden" id="bas-wd-qte" value="${STORE.takeQty}">
      <button class="bs-w-btn bs-w-go bs-w-sm" data-action="_bastionCoffreTake" data-id="${_esc(item.id)}">Confirmer</button>
    </div>` : '';
    return `<div class="bs-v-row${open ? ' open' : ''}">
      <span class="bs-v-ic">${_esc(item.emoji || k.e)}</span>
      <span class="bs-v-nm">${_esc(item.nom)}</span>
      <span class="bs-v-cat"><span class="bs-w-chip t" style="--tc:${k.c}"><i></i>${k.l}</span></span>
      <span class="bs-v-q">×${maxQ}</span>
      <span class="bs-v-by">${_esc(item.source || '—')}</span>
      <span class="bs-v-per">pér. ${item.weekAdded || '?'}</span>
      <span class="bs-v-act">${hasEligibleChar ? `<button class="bs-w-btn bs-w-sm" data-action="_bastionCoffreOpen" data-id="${_esc(item.id)}">${open ? 'Annuler' : 'Prendre'}</button>` : ''}</span>
    </div>${takeRow}`;
  }).join('');

  const table = `<div class="bs-w-card bs-v-table">
    <div class="bs-v-row hd"><span></span><span>Objet</span><span class="bs-v-cat">Catégorie</span><span class="bs-v-q">Qté</span><span class="bs-v-by">Déposé par</span><span class="bs-v-per">Arrivée</span><span></span></div>
    ${rows || `<div class="bs-v-empty">${coffre.length ? 'Aucun objet ne correspond.' : 'Le coffre est vide. Les productions des salles et les dépôts des joueurs apparaîtront ici.'}</div>`}
  </div>`;

  // Besace du perso courant + mouvements récents (historique hors admin).
  const besace = scope ? _groupInventaire(scope.inventaire) : [];
  const besaceHtml = besace.length
    ? besace.map(g => `<div class="bs-v-mv"><span class="bs-v-mv-ic">${_esc(g.item.icone || g.item.emoji || '📦')}</span><span class="bs-v-mv-tx">${_esc(g.item.nom || '?')}<small>×${g.totalQte}${g.item.rarete ? ` · ${_esc(g.item.rarete)}` : ''}</small></span><button class="bs-w-btn bs-w-sm" data-action="_bastionOpenDeposit"${isFull ? ' disabled' : ''}>Déposer</button></div>`).join('')
    : `<p class="bs-side-empty">Inventaire vide.</p>`;
  const moves = (b.historique || []).filter(e => !_ADMIN_HISTO_TYPES.has(e.type)).slice(0, 10);
  const movesHtml = moves.length
    ? moves.map(e => `<div class="bs-v-mv"><span class="bs-v-mv-tx bs-v-mv-full">${_esc(e.msg || '')}<small>période ${e.week ?? '?'}</small></span></div>`).join('')
    : `<p class="bs-side-empty">Aucun mouvement récent.</p>`;

  return `<div class="bs-v-layout">
    <div class="bs-v-main">${band}${tools}${table}</div>
    <aside class="bs-mur-side">
      <div class="bs-side-card"><h3 class="bs-side-h">🎒 Ma besace${scope ? ` · ${_esc(scope.nom)}` : ''} <span>${besace.length}</span></h3>${besaceHtml}</div>
      <div class="bs-side-card"><h3 class="bs-side-h">🔁 Mouvements récents</h3>${movesHtml}</div>
    </aside>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// QUÊTES DU BASTION
// Stockées dans `b.bastionQuests = [{ id, titre, description, recompense, statut, createdAt }]`
// statut : 'ouverte' | 'en_cours' | 'terminee' | 'echouee'
// ══════════════════════════════════════════════════════════════════════════════
const BQ_STATUTS = {
  ouverte:   { lbl: 'Ouverte',     color: '#7eb0ff', emoji: '📋' },
  en_cours:  { lbl: 'En cours',    color: '#e8b84b', emoji: '⚙️' },
  terminee:  { lbl: 'Terminée',    color: '#22c38e', emoji: '✅' },
  echouee:   { lbl: 'Échouée',     color: '#ff5a7e', emoji: '❌' },
}

function _bastionOpenQuestEditor(questId) {
  if (!STATE.isAdmin) return;
  const q = questId ? (STORE.bastion?.bastionQuests || []).find(x => x.id === questId) : null;
  openModal(q ? '✏️ Modifier la quête' : '＋ Nouvelle quête du Bastion', `
    <div class="form-group"><label>Titre</label>
      <input class="input-field" id="bq-titre" value="${_esc(q?.titre || '')}" placeholder="ex: Récupérer le plan de la Forge supérieure"></div>
    <div class="form-group"><label>Description</label>
      <textarea class="input-field" id="bq-desc" rows="3" placeholder="Contexte, conditions, indices…">${_esc(q?.description || '')}</textarea></div>
    <div class="form-group"><label>Récompense</label>
      <input class="input-field" id="bq-recompense" value="${_esc(q?.recompense || '')}" placeholder="ex: +200 or, débloque le Niv. III Forge, +10 renommée"></div>
    <div class="form-group"><label>Statut</label>
      <div class="bs-quest-statut-seg" role="group" aria-label="Statut de la quête">
        ${Object.entries(BQ_STATUTS).map(([k, v]) => {
          const on = (q?.statut || 'ouverte') === k;
          return `<button type="button" class="bs-quest-statut-opt${on ? ' is-on' : ''}" style="--c:${v.color}"
            data-action="_bastionSetQuestStatut" data-statut="${k}" aria-pressed="${on ? 'true' : 'false'}">
            <span class="bs-quest-statut-emoji">${v.emoji}</span><span>${v.lbl}</span>
          </button>`;
        }).join('')}
      </div>
      <input type="hidden" id="bq-statut" value="${q?.statut || 'ouverte'}">
    </div>
    <div style="display:flex;gap:.5rem">
      <button class="btn btn-gold" style="flex:1" data-action="_bastionSaveQuest" data-id="${q?.id || ''}">${q ? 'Enregistrer' : 'Créer'}</button>
      ${q ? `<button class="btn btn-outline btn-sm" style="color:var(--crimson);border-color:rgba(255,90,126,0.40)" data-action="_bastionDeleteQuest" data-id="${q.id}">🗑 Supprimer</button>` : ''}
    </div>
  `);
}

// Sélecteur segmenté de statut (sans re-render → conserve la saisie du formulaire).
function _bastionSetQuestStatut(btn) {
  const statut = btn?.dataset?.statut || 'ouverte';
  const hidden = document.getElementById('bq-statut');
  if (hidden) hidden.value = statut;
  document.querySelectorAll('.bs-quest-statut-opt').forEach(el => {
    const on = el.dataset.statut === statut;
    el.classList.toggle('is-on', on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

async function _bastionSaveQuest(id) {
  if (!STATE.isAdmin) return;
  const titre = document.getElementById('bq-titre')?.value?.trim();
  if (!titre) { showNotif('Le titre est requis.', 'error'); return; }
  const data = {
    id:          id || `bq_${Date.now().toString(36)}`,
    titre,
    description: document.getElementById('bq-desc')?.value?.trim() || '',
    recompense:  document.getElementById('bq-recompense')?.value?.trim() || '',
    statut:      document.getElementById('bq-statut')?.value || 'ouverte',
  };
  // À la création uniquement : Firestore refuse `undefined` (l'édition conserve createdAt).
  if (!id) data.createdAt = Date.now();
  const b = { ...STORE.bastion };
  b.bastionQuests = [...(b.bastionQuests || [])];
  if (id) {
    const idx = b.bastionQuests.findIndex(q => q.id === id);
    if (idx >= 0) b.bastionQuests[idx] = { ...b.bastionQuests[idx], ...data };
  } else {
    b.bastionQuests.push(data);
    _addHistorique(b, 'quest', `📋 Nouvelle quête du Bastion : ${titre}`);
  }
  await _save(b);
  closeModal();
  showNotif(id ? 'Quête mise à jour.' : 'Quête créée.', 'success');
}

async function _bastionDeleteQuest(id) {
  if (!STATE.isAdmin) return;
  const ok = await confirmModal('Supprimer cette quête définitivement ?', {
    title: '🗑 Supprimer la quête', okLabel: 'Supprimer', cancelLabel: 'Annuler',
  }).catch(() => false);
  if (!ok) return;
  const b = { ...STORE.bastion };
  b.bastionQuests = (b.bastionQuests || []).filter(q => q.id !== id);
  await _save(b);
  closeModal();
  showNotif('Quête supprimée.', 'success');
}

// Types d'entrées d'historique purement administratives — masqués du rendu
const _ADMIN_HISTO_TYPES = new Set(['mj_adjust', 'edit_catalog', 'reset']);
function _renderHistorique(b) {
  const isMj = STATE.isAdmin;
  // On garde l'index ORIGINAL (dans b.historique) pour pouvoir supprimer la bonne ligne.
  const all = (b.historique || [])
    .map((e, idx) => ({ e, idx }))
    .filter(({ e }) => !_ADMIN_HISTO_TYPES.has(e.type));
  if (!all.length) return '';
  return `<div class="bs-history-modal">
      <p>Historique automatique des constructions, dépôts et périodes du Bastion.</p>
      <div class="bs-histo bs-histo--scroll">
        ${all.map(({ e, idx }) => `
          <div class="bs-histo-row bs-histo-row--${e.type}">
            <span class="bs-histo-week">P${e.week}</span>
            <span class="bs-histo-msg">${_esc(_repairBastionText(e.msg))}</span>
            ${isMj ? `<button class="bs-histo-del" data-action="_bastionDeleteHisto" data-idx="${idx}" title="Supprimer cette ligne">🗑</button>` : ''}
          </div>`).join('')}
      </div>
    </div>`;
}

function _bastionOpenHistory() {
  const html = _renderHistorique(STORE.bastion || _defaultBastion());
  if (!html) { showNotif('La chronique du Bastion est encore vide.', 'info'); return; }
  openModal('📜 Chronique du Bastion', html, {
    subtitle: 'Historique administratif · consultable à la demande',
    accent: '#8aa4c8',
  });
}

// Supprime une ligne de la chronique (MJ). idx = index dans b.historique complet.
async function _bastionDeleteHisto(idx) {
  if (!STATE.isAdmin) return;
  const b = JSON.parse(JSON.stringify(STORE.bastion || {}));
  if (!Array.isArray(b.historique) || idx < 0 || idx >= b.historique.length) return;
  b.historique.splice(idx, 1);
  await _save(b);
  if ((b.historique || []).some(entry => !_ADMIN_HISTO_TYPES.has(entry.type))) _bastionOpenHistory();
  else closeModal();
}

// ══════════════════════════════════════════════════════════════════════════════
// MUR DES ANNONCES — communication entre joueurs (messages, quêtes, offres, demandes)
// ══════════════════════════════════════════════════════════════════════════════
function _annonceTimeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.floor(s / 60); if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60); if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24); if (d < 7) return `il y a ${d} j`;
  return new Date(ts).toLocaleDateString('fr-FR');
}

function _wallCharacters() {
  return getVisibleCharacters({ sorted: true });
}

function _wallEnsureCharacter() {
  const chars = _wallCharacters();
  if (!chars.some(char => char.id === _wallUi.charId)) {
    _wallUi.charId = getDefaultCharForUser(chars, STATE.user?.uid)?.id || chars[0]?.id || '';
  }
  return chars;
}

function _wallIdentity(charId = _wallUi.charId) {
  const uid = STATE.user?.uid || '';
  const char = _wallCharacters().find(item => item.id === charId);
  if (char) return {
    uid,
    charId: char.id,
    charName: char.nom || 'Personnage',
    charImage: /^https?:/i.test(char.photo || char.image || '') ? (char.photo || char.image) : '',
  };
  // Le MJ peut modérer et publier sans devoir créer un personnage factice.
  if (STATE.isAdmin && uid) return {
    uid,
    charId: `user:${uid}`,
    charName: STATE.profile?.pseudo || 'Maître du jeu',
    charImage: '',
  };
  return null;
}

function _wallAvatar(identity, size = 38) {
  const char = (STATE.characters || []).find(item => item.id === identity?.charId);
  return characterAvatarHtml(char || {
    nom: identity?.charName || 'Personnage',
    photo: identity?.charImage || '',
  }, { size, className: 'bs-wall-avatar' });
}

function _wallText(text) {
  return applyEmotes(linkify(_esc(text || '')), _wallEmotes).replace(/\n/g, '<br>');
}

function _wallAllPosts() {
  return sortBastionWallPosts([..._annonces, ..._legacyAnnonces]);
}

function _wallPostById(id) {
  return _wallAllPosts().find(post => post.id === id) || null;
}

function _wallMarkSeen() {
  if (STATE.currentPage !== 'bastion') return;
  const key = bastionWallSeenKey(STATE.adventure?.id, STATE.user?.uid);
  const seenAt = Date.now();
  const known = Math.max(Number(_wallRead?.seenAt) || 0, _wallSeenWriteAt);
  try { localStorage.setItem(key, String(seenAt)); } catch { /* stockage privé indisponible */ }
  if (!STATE.user?.uid) return;
  if (seenAt - known < 5000) {
    clearTimeout(_wallSeenTimer);
    _wallSeenTimer = setTimeout(_wallMarkSeen, 5050 - (seenAt - known));
    return;
  }
  _wallSeenWriteAt = seenAt;
  void saveDoc('bastionWallReads', STATE.user.uid, {
    uid: STATE.user.uid,
    seenAt,
    lastActivityAt: bastionWallLastActivity(_wallAllPosts(), _wallComments),
    updatedAt: seenAt,
  }, { silent: true }).catch(error => console.debug('[bastion] lecture conservée localement', error?.code || error));
}

function _wallMentionSuggestions() {
  const match = _wallUi.draftText.match(/(?:^|\s)@([^@\n]{0,40})$/u);
  if (!match) return '';
  const query = _norm(match[1] || '');
  const suggestions = (STATE.characters || [])
    .filter(character => character?.nom && character.id !== _wallUi.charId)
    .filter(character => !query || _norm(character.nom).includes(query))
    .slice(0, 6);
  if (!suggestions.length) return '';
  return `<div class="bs-wall-mention-suggestions"><small>Mentionner</small>${suggestions.map(character => `<button type="button" data-action="_bastionWallMention" data-name="${_esc(character.nom)}">${_wallAvatar({ charId: character.id, charName: character.nom, charImage: character.photo || '' }, 24)}<span>${_esc(character.nom)}</span></button>`).join('')}</div>`;
}

function _wallComposerMedia() {
  if (!_wallUi.images.length) return '';
  return `<div class="bs-wall-compose-media">
    ${_wallUi.images.map((src, index) => `<figure><img src="${_esc(src)}" alt="Image ${index + 1}"><button type="button" data-action="_bastionWallRemoveImage" data-index="${index}" aria-label="Retirer l'image ${index + 1}">×</button></figure>`).join('')}
  </div>`;
}

function _wallPicker() {
  if (!_wallUi.pickerOpen) return '';
  return `<div class="bs-wall-picker" id="bs-wall-picker" aria-label="Émojis et émotes">
    ${_wallEmotes.length ? `<section><strong>Émotes de l’aventure</strong><div class="bs-wall-picker-row bs-wall-picker-emotes">${_wallEmotes.map(emote => `<button type="button" data-action="_bastionWallInsert" data-token=":${_esc(emote.name)}:" title=":${_esc(emote.name)}:"><img src="${_esc(emote.url)}" alt=":${_esc(emote.name)}:" loading="lazy"></button>`).join('')}</div></section>` : ''}
    ${EMOJI_CATEGORIES.map(category => `<section><strong>${_esc(category.label)}</strong><div class="bs-wall-picker-row">${category.emojis.map(token => `<button type="button" data-action="_bastionWallInsert" data-token="${token}" title="${token}">${token}</button>`).join('')}</div></section>`).join('')}
  </div>`;
}

function _wallReactionVisual(token) {
  const emote = _wallEmotes.find(item => `:${item.name}:` === token);
  return emote
    ? `<img class="bs-wall-reaction-emote" src="${_esc(emote.url)}" alt="${_esc(token)}" loading="lazy">`
    : _esc(token);
}

function _wallReactionPicker(postId) {
  if (_wallUi.reactionPostId !== postId) return '';
  const emotes = _wallEmotes.length ? `<section><strong>Émotes de l’aventure</strong><div class="bs-wall-reaction-grid bs-wall-reaction-grid-emotes">${_wallEmotes.map(emote => {
    const token = `:${emote.name}:`;
    return `<button type="button" data-action="_bastionWallReact" data-id="${_esc(postId)}" data-reaction="${_esc(token)}" title="${_esc(token)}"><img src="${_esc(emote.url)}" alt="${_esc(token)}" loading="lazy"></button>`;
  }).join('')}</div></section>` : '';
  const emojis = EMOJI_CATEGORIES.map(category => `<section><strong>${_esc(category.label)}</strong><div class="bs-wall-reaction-grid">${category.emojis.map(token => `<button type="button" data-action="_bastionWallReact" data-id="${_esc(postId)}" data-reaction="${token}" title="${token}">${token}</button>`).join('')}</div></section>`).join('');
  return `<div class="bs-wall-reaction-picker" aria-label="Choisir une réaction">${emotes}${emojis}</div>`;
}

// Sous-titre d'un post : classe/métier du personnage (si connu) + ancienneté.
function _wallCharSub(charId, ago) {
  const c = (STATE.characters || []).find(x => x.id === charId);
  const role = c?.classe || c?.class || c?.metier || c?.role || c?.race || '';
  return role ? `${_esc(role)} · ${ago}` : ago;
}

function _wallComposer() {
  _wallEnsureCharacter();
  const identity = _wallIdentity();
  if (!identity) {
    return `<div class="bs-w-card bs-w-compose"><div class="bs-wall-no-character"><strong>Choisis ton identité</strong><p>Il faut un personnage de cette aventure pour écrire, réagir ou répondre sur le mur.</p><button class="btn btn-outline" data-navigate="characters">Voir mes personnages</button></div></div>`;
  }
  const PH = {
    message: 'Une nouvelle à partager avec le Bastion ?',
    quete:   'Décris la quête : objectif, lieu, récompense…',
    offre:   'Que proposes-tu ? Objet, service, prix…',
    demande: 'De quoi as-tu besoin ?',
  };
  const typeBtns = Object.entries(BASTION_WALL_TYPES).map(([id, type]) =>
    `<button type="button" class="bs-w-tpick${_wallUi.type === id ? ' on' : ''}" style="--tc:${type.color}" data-action="_bastionSetAnnonceType" data-type="${id}" aria-pressed="${_wallUi.type === id}"><i></i>${_esc(type.label)}</button>`
  ).join('');
  const canPost = _wallUi.draftText.trim() || _wallUi.images.length;

  return `<div class="bs-w-card bs-w-compose">
    <div class="bs-w-compose-row">
      ${_wallAvatar(identity, 36)}
      <div id="bs-annonce-text" class="bs-w-editor" contenteditable="true" role="textbox" aria-multiline="true" data-input="_bastionWallDraft" data-placeholder="${_esc(PH[_wallUi.type] || PH.message)}">${applyEmotes(_esc(_wallUi.draftText), _wallEmotes)}</div>
    </div>
    <div id="bs-wall-mention-slot">${_wallMentionSuggestions()}</div>
    <div id="bs-wall-media-preview">${_wallComposerMedia()}</div>
    ${_wallPicker()}
    <div class="bs-w-compose-ft">
      ${typeBtns}
      <div class="bs-w-compose-tools">
        <button type="button" class="bs-w-tool" data-action="_bastionWallTogglePicker" aria-expanded="${_wallUi.pickerOpen}" title="Émojis & émotes">☺</button>
        <button type="button" class="bs-w-tool" data-action="_bastionWallAddImage" ${_wallUi.images.length >= 3 ? 'disabled' : ''} title="Ajouter une image">▧${_wallUi.images.length ? ` ${_wallUi.images.length}/3` : ''}</button>
      </div>
      <button type="button" class="bs-w-btn bs-w-go" data-action="_bastionPostAnnonce" ${canPost ? '' : 'disabled'}>Publier</button>
    </div>
  </div>`;
}

function _wallCommentHtml(comment, post) {
  const canDelete = STATE.isAdmin || comment.uid === STATE.user?.uid;
  const isEditing = _wallUi.editCommentId === comment.id;
  return `<div class="bs-w-cmt">
    ${_wallAvatar(comment, 24)}
    <div class="bs-w-cmt-body">${isEditing
      ? `<b>${_esc(comment.charName || 'Personnage')}</b><textarea rows="2" maxlength="1200" data-input="_bastionWallEditCommentDraft">${_esc(_wallUi.editCommentText)}</textarea><div class="bs-w-edit-actions"><button type="button" data-action="_bastionWallCancelCommentEdit">Annuler</button><button type="button" class="bs-w-btn" data-action="_bastionWallSaveComment" data-comment="${_esc(comment.id)}">Enregistrer</button></div>`
      : `<span><b>${_esc(comment.charName || 'Personnage')}</b>${_wallText(comment.text)}<small>${_annonceTimeAgo(comment.ts)}${comment.editedAt ? ' · Modifié' : ''}</small></span>`}</div>
    ${canDelete && !post.legacy && !comment.legacy && !isEditing ? `<div class="bs-w-cmt-tools"><button type="button" data-action="_bastionWallEditComment" data-id="${_esc(post.id)}" data-comment="${_esc(comment.id)}" title="Modifier">✎</button><button type="button" data-action="_bastionWallDeleteComment" data-id="${_esc(post.id)}" data-comment="${_esc(comment.id)}" title="Supprimer">×</button></div>` : ''}
  </div>`;
}

function _wallPostMenu(post) {
  if (_wallUi.menuPostId !== post.id) return '';
  // Les publications antérieures à la refonte sont stockées ensemble dans
  // bastionAnnonces/main. Seul le MJ peut réécrire ce document historique : on
  // lui expose donc la suppression, sans proposer les actions incompatibles
  // avec ce format (édition, statut, épinglage).
  if (post.legacy) return STATE.isAdmin ? `<div class="bs-wall-post-menu" role="menu">
    <button type="button" class="is-danger" data-action="_bastionDeleteAnnonce" data-id="${_esc(post.id)}">🗑 Supprimer cette ancienne publication</button>
  </div>` : '';
  const mine = post.uid === STATE.user?.uid;
  const statusActions = post.type === 'message' ? '' : Object.entries(BASTION_WALL_STATUSES)
    .filter(([id]) => id !== post.status)
    .map(([id, status]) => `<button type="button" data-action="_bastionWallSetStatus" data-id="${_esc(post.id)}" data-status="${id}">${status.icon} ${status.label}</button>`).join('');
  return `<div class="bs-wall-post-menu" role="menu">
    ${mine || STATE.isAdmin ? `<button type="button" data-action="_bastionWallEditPost" data-id="${_esc(post.id)}">✎ Modifier</button>` : ''}
    ${STATE.isAdmin ? `<button type="button" data-action="_bastionWallPin" data-id="${_esc(post.id)}">${post.pinned ? '⌁ Désépingler' : '⌂ Épingler en haut'}</button>` : ''}
    ${mine || STATE.isAdmin ? statusActions : ''}
    <button type="button" class="is-danger" data-action="_bastionDeleteAnnonce" data-id="${_esc(post.id)}">🗑 Supprimer</button>
  </div>`;
}

function _wallPostEdit(post) {
  if (_wallUi.editPostId !== post.id) return '';
  const options = Object.entries(BASTION_WALL_TYPES).map(([id, type]) => `<option value="${id}" ${_wallUi.editPostType === id ? 'selected' : ''}>${type.icon} ${type.label}</option>`).join('');
  return `<div class="bs-wall-post-edit"><textarea rows="4" maxlength="4000" data-input="_bastionWallEditPostDraft">${_esc(_wallUi.editPostText)}</textarea><div><select data-change="_bastionWallEditPostType">${options}</select><span></span><button type="button" data-action="_bastionWallCancelPostEdit">Annuler</button><button type="button" class="btn btn-gold" data-action="_bastionWallSavePost" data-id="${_esc(post.id)}">Enregistrer</button></div></div>`;
}

function _wallCard(post) {
  const type = BASTION_WALL_TYPES[post.type] || BASTION_WALL_TYPES.message;
  const status = BASTION_WALL_STATUSES[post.status] || BASTION_WALL_STATUSES.active;
  const identity = _wallIdentity();
  const canDelete = STATE.isAdmin || (!post.legacy && post.uid && post.uid === STATE.user?.uid);
  const counts = bastionWallReactionCounts(post);
  const mine = identity ? post.reactions?.[identity.charId]?.emoji : '';
  const comments = bastionWallCommentsForPost(post, _wallComments);
  const replyOpen = _wallUi.replyOpen.has(post.id);
  const author = { charId: post.charId, charName: post.charName || post.author || 'Personnage', charImage: post.charImage || '' };
  const images = _wallImages(post);
  const media = images.length ? `<div class="bs-wall-media bs-wall-media-${images.length}">${images.map((_src, index) => `<button type="button" data-action="_bastionOpenPostImage" data-id="${_esc(post.id)}" data-index="${index}" aria-label="Agrandir l'image ${index + 1}"><img src="${_esc(images[index])}" alt="Image jointe à la publication"></button>`).join('')}</div>` : (post.imageCount ? '<div class="bs-wall-media-loading">Chargement des images…</div>' : '');
  const countedReactions = Object.entries(counts).map(([reaction, count]) => !post.legacy && identity
    ? `<button type="button" class="bs-w-rx${mine === reaction ? ' mine' : ''}" data-action="_bastionWallReact" data-id="${_esc(post.id)}" data-reaction="${_esc(reaction)}" title="Réagir avec ${_esc(reaction)}">${_wallReactionVisual(reaction)} <span>${count}</span></button>`
    : `<span class="bs-w-rx">${_wallReactionVisual(reaction)} ${count}</span>`).join('');
  const canResolve = post.type !== 'message' && !post.legacy && (post.uid === STATE.user?.uid || STATE.isAdmin);
  const tags = `${post.pinned ? '<span class="bs-w-chip">📌 Épinglé</span>' : ''}`
    + `${post.status !== 'active' ? `<span class="bs-w-chip">${status.icon} ${status.label}</span>` : ''}`
    + `<span class="bs-w-chip t" style="--tc:${type.color}"><i></i>${type.label}</span>`
    + `${canDelete ? `<button type="button" class="bs-w-menu-btn" data-action="_bastionWallToggleMenu" data-id="${_esc(post.id)}" aria-label="Gérer cette publication" aria-expanded="${_wallUi.menuPostId === post.id}">•••</button>${_wallPostMenu(post)}` : ''}`;

  return `<article id="bastion-post-${_esc(post.id)}" class="bs-w-card bs-w-post${post.status === 'resolved' ? ' done' : ''}${post.pinned ? ' is-pinned' : ''}" style="--tc:${type.color}">
    <div class="bs-w-post-hd">
      ${_wallAvatar(author, 34)}
      <div class="bs-w-who"><b>${_esc(author.charName)}</b><small>${_wallCharSub(post.charId, _annonceTimeAgo(post.ts))}${post.editedAt ? ' · Modifié' : ''}${post.legacy ? ' · archive' : ''}</small></div>
      <div class="bs-w-tags">${tags}</div>
    </div>
    ${_wallPostEdit(post) || `${post.text ? `<div class="bs-w-post-tx">${_wallText(post.text)}</div>` : ''}${media}`}
    ${comments.length ? `<div class="bs-w-cmts">${comments.slice(replyOpen ? 0 : -1).map(comment => _wallCommentHtml(comment, post)).join('')}${comments.length > 1 && !replyOpen ? `<button class="bs-w-morecmt" data-action="_bastionWallToggleReply" data-id="${_esc(post.id)}">Voir les ${comments.length} réponses</button>` : ''}</div>` : ''}
    ${replyOpen && identity && !post.legacy ? `<div class="bs-w-reply">${_wallAvatar(identity, 28)}<textarea rows="1" maxlength="1200" data-input="_bastionWallReplyDraft" data-id="${_esc(post.id)}" placeholder="Répondre à ${_esc(author.charName)}…">${_esc(_wallUi.replyDrafts.get(post.id) || '')}</textarea><button type="button" class="bs-w-btn" data-action="_bastionWallReply" data-id="${_esc(post.id)}">Envoyer</button></div>` : ''}
    ${_wallReactionPicker(post.id)}
    <div class="bs-w-post-ft">
      ${countedReactions}
      ${!post.legacy && identity ? `<span class="bs-w-rx-add"><button type="button" class="bs-w-rx bs-w-rx-open${_wallUi.reactionPostId === post.id ? ' active' : ''}" data-action="_bastionWallToggleReactions" data-id="${_esc(post.id)}" title="Ajouter une réaction">${mine ? '↺' : '+'}</button></span>` : ''}
      <button type="button" class="bs-w-lk" data-action="_bastionWallToggleReply" data-id="${_esc(post.id)}">💬 ${comments.length || ''} ${replyOpen ? 'Masquer' : 'Répondre'}</button>
      <span class="bs-w-rt">
        ${STATE.isAdmin ? `<button type="button" class="bs-w-lk" data-action="_bastionWallPin" data-id="${_esc(post.id)}">${post.pinned ? 'Désépingler' : 'Épingler'}</button>` : ''}
        ${canResolve ? `<button type="button" class="bs-w-lk" data-action="_bastionWallSetStatus" data-id="${_esc(post.id)}" data-status="${post.status === 'resolved' ? 'active' : 'resolved'}">${post.status === 'resolved' ? 'Rouvrir' : 'Clore'}</button>` : ''}
      </span>
    </div>
  </article>`;
}

function _renderAnnonces() {
  const posts = _wallAllPosts();
  const filtered = _wallUi.filter === 'all'
    ? posts.filter(post => post.status === 'active')
    : _wallUi.filter === 'archive'
      ? posts.filter(post => post.status !== 'active')
      : posts.filter(post => post.type === _wallUi.filter && post.status === 'active');
  const visible = filtered.slice(0, _wallUi.visible);
  const activeCount = posts.filter(p => p.status === 'active').length;
  const archiveCount = posts.filter(p => p.status !== 'active').length;
  const filters = `<div class="bs-w-fchips" role="group" aria-label="Filtrer les publications">
    <button type="button" class="bs-w-fchip${_wallUi.filter === 'all' ? ' on' : ''}" data-action="_bastionWallSetFilter" data-filter="all" aria-pressed="${_wallUi.filter === 'all'}">Actifs<span>${activeCount}</span></button>
    ${Object.entries(BASTION_WALL_TYPES).map(([id, type]) => `<button type="button" class="bs-w-fchip${_wallUi.filter === id ? ' on' : ''}" style="--tc:${type.color}" data-action="_bastionWallSetFilter" data-filter="${id}" aria-pressed="${_wallUi.filter === id}"><i></i>${_esc(type.label)}<span>${posts.filter(p => p.type === id && p.status === 'active').length}</span></button>`).join('')}
    <button type="button" class="bs-w-fchip${_wallUi.filter === 'archive' ? ' on' : ''}" data-action="_bastionWallSetFilter" data-filter="archive" aria-pressed="${_wallUi.filter === 'archive'}">◷ Historique<span>${archiveCount}</span></button>
  </div>`;
  const emptyState = !posts.length
    ? 'Le mur est encore silencieux. Publie le premier message du Bastion.'
    : _wallUi.filter === 'archive'
      ? `Aucune publication dans l’historique.<button type="button" class="bs-w-lk" data-action="_bastionWallSetFilter" data-filter="all">Voir les actifs</button>`
      : _wallUi.filter === 'all'
        ? `Aucune publication active.<button type="button" class="bs-w-lk" data-action="_bastionWallSetFilter" data-filter="archive">Voir l’historique</button>`
        : `Aucune publication active de ce type.<button type="button" class="bs-w-lk" data-action="_bastionWallSetFilter" data-filter="all">Voir tous les actifs</button>`;
  if (posts.length) queueMicrotask(_wallMarkSeen);
  return `<div class="bs-w-feedwrap">
    ${_wallComposer()}
    ${filters}
    <div class="bs-w-feed">${visible.map(_wallCard).join('') || `<div class="bs-w-card bs-w-empty">${emptyState}</div>`}${filtered.length > visible.length ? `<button class="bs-w-more" data-action="_bastionWallMore">Afficher ${Math.min(12, filtered.length - visible.length)} publications de plus</button>` : ''}</div>
  </div>`;
}

// Élément cliquable de la colonne droite : renvoie vers le post dans le fil.
function _wallSideItem(p) {
  const type = BASTION_WALL_TYPES[p.type] || BASTION_WALL_TYPES.message;
  const author = p.charName || p.author || 'Personnage';
  const preview = (p.text || '').replace(/\s+/g, ' ').trim().slice(0, 70);
  return `<button type="button" class="bs-side-item" data-action="_bastionWallJump" data-id="${_esc(p.id)}" style="--c:${type.color}">
    <span class="bs-side-ic">${type.icon}</span>
    <span class="bs-side-txt"><b>${_esc(author)}</b><small>${_esc(preview || type.label)}</small></span>
  </button>`;
}

// Fiche de lecture d'une quête du Bastion (accessible à tous ; MJ peut éditer).
function _bastionShowQuest(id) {
  const q = (STORE.bastion?.bastionQuests || []).find(x => x.id === id);
  if (!q) return;
  const st = BQ_STATUTS[q.statut || 'ouverte'] || BQ_STATUTS.ouverte;
  openModal(`${st.emoji} ${_esc(q.titre || 'Quête du Bastion')}`, `
    <div class="bs-quest-view">
      <div class="bs-quest-view-statut" style="--c:${st.color}">${st.emoji} ${st.lbl}</div>
      <p class="bs-quest-view-desc"${q.description ? '' : ' style="color:var(--text-dim)"'}>${q.description ? _esc(q.description) : 'Aucune description fournie.'}</p>
      ${q.recompense ? `<div class="bs-quest-view-reward">🎁 ${_esc(q.recompense)}</div>` : ''}
      ${STATE.isAdmin ? `<button class="btn btn-outline" style="width:100%;margin-top:.7rem" data-action="_bastionOpenQuestEditor" data-id="${_esc(q.id)}">✏️ Modifier la quête</button>` : ''}
    </div>
  `, { accent: st.color });
}

// Colonne droite du Mur : quêtes ouvertes (quêtes MJ lecture seule + posts type
// Quête) et offres/demandes. Clic = défilement + surbrillance du post concerné.
function _renderWallSidebar(b) {
  const isMj = STATE.isAdmin;
  const active = _wallAllPosts().filter(p => p.status === 'active');
  const questPosts = active.filter(p => p.type === 'quete');
  const offers = active.filter(p => p.type === 'offre' || p.type === 'demande');
  const mjQuests = (b.bastionQuests || []).filter(q => ['ouverte', 'en_cours'].includes(q.statut || 'ouverte'));

  const questItems = [
    ...mjQuests.map(q => {
      const st = BQ_STATUTS[q.statut || 'ouverte'] || BQ_STATUTS.ouverte;
      return `<button type="button" class="bs-side-item bs-side-item--mj" data-action="_bastionShowQuest" data-id="${_esc(q.id)}" style="--c:${st.color}">
        <span class="bs-side-ic" title="Quête du MJ">${st.emoji}</span>
        <span class="bs-side-txt"><b>${_esc(q.titre || '?')}</b><small>${q.recompense ? `🎁 ${_esc(q.recompense)}` : st.lbl}</small></span>
        <span class="bs-side-tag">MJ</span>
      </button>`;
    }),
    ...questPosts.map(_wallSideItem),
  ];
  const offerItems = offers.map(_wallSideItem);

  return `
    <div class="bs-side-card">
      <h3 class="bs-side-h">📋 Quêtes ouvertes <span>${questItems.length}</span></h3>
      ${questItems.length ? questItems.join('') : '<p class="bs-side-empty">Aucune quête ouverte.</p>'}
    </div>
    <div class="bs-side-card">
      <h3 class="bs-side-h">🪙 Offres &amp; demandes <span>${offerItems.length}</span></h3>
      ${offerItems.length ? offerItems.join('') : '<p class="bs-side-empty">Rien à échanger pour l’instant.</p>'}
    </div>`;
}

// Ouvre le fil sur le post ciblé (ajuste filtre + pagination) puis le met en avant.
function _bastionWallJump(id) {
  const post = _wallPostById(id);
  if (!post) return;
  _wallUi.filter = bastionWallFilterForTarget(_wallUi.filter, post);
  const active = _wallAllPosts();
  const f = _wallUi.filter;
  const filtered = f === 'all' ? active.filter(p => p.status === 'active')
    : f === 'archive' ? active.filter(p => p.status !== 'active')
      : active.filter(p => p.type === f && p.status === 'active');
  const idx = filtered.findIndex(p => p.id === id);
  if (idx >= 0) _wallUi.visible = Math.max(_wallUi.visible, idx + 1);
  _renderPage();
  requestAnimationFrame(() => {
    const card = document.getElementById(`bastion-post-${id}`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('is-targeted');
    setTimeout(() => card.classList.remove('is-targeted'), 3200);
  });
}

function _bastionSetAnnonceType(btn) {
  _wallUi.type = BASTION_WALL_TYPES[btn.dataset.type] ? btn.dataset.type : 'message';
  _wallPersistDraft();
  document.querySelectorAll('.bs-annonce-type').forEach(el => {
    const active = el === btn;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', String(active));
  });
}

function _bastionWallDraft(el) {
  let text = '';
  const walk = node => node.childNodes.forEach(child => {
    if (child.nodeType === 3) text += child.nodeValue;
    else if (child.nodeName === 'IMG') text += child.dataset.emote || '';
    else if (child.nodeName === 'BR') text += '\n';
    else {
      const before = text.length;
      walk(child);
      if (child.nodeName === 'DIV' && text.length > before && !text.endsWith('\n')) text += '\n';
    }
  });
  walk(el);
  _wallUi.draftText = text.trim().slice(0, 4000);
  document.querySelector('.bs-wall-publish')?.toggleAttribute('disabled', !_wallUi.draftText.trim() && !_wallUi.images.length);
  const slot = document.getElementById('bs-wall-mention-slot');
  if (slot) slot.innerHTML = _wallMentionSuggestions();
  _wallPersistDraft();
}

function _bastionWallMention(btn) {
  const name = String(btn.dataset.name || '').trim();
  if (!name) return;
  _wallUi.draftText = _wallUi.draftText.replace(/(?:^|\s)@[^@\n]{0,40}$/u, match => `${/^\s/u.test(match) ? match[0] : ''}@${name} `).slice(0, 4000);
  const editor = document.getElementById('bs-annonce-text');
  if (editor) {
    editor.innerHTML = applyEmotes(_esc(_wallUi.draftText), _wallEmotes).replace(/\n/g, '<br>');
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  const slot = document.getElementById('bs-wall-mention-slot');
  if (slot) slot.innerHTML = '';
  _wallPersistDraft();
}

function _bastionWallInsert(btn) {
  const editor = document.getElementById('bs-annonce-text');
  if (!editor) return;
  const token = btn.dataset.token || '';
  const emote = _wallEmotes.find(item => `:${item.name}:` === token);
  const node = emote ? Object.assign(document.createElement('img'), {
    className: 'chat-emote-inline', src: emote.url, alt: token, title: token,
  }) : document.createTextNode(token);
  if (emote) node.dataset.emote = token;
  editor.focus();
  const selection = window.getSelection();
  if (selection?.rangeCount && editor.contains(selection.anchorNode)) {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  } else editor.appendChild(node);
  _bastionWallDraft(editor);
}

function _bastionWallTogglePicker() {
  _wallUi.pickerOpen = !_wallUi.pickerOpen;
  _renderPage();
  document.getElementById('bs-annonce-text')?.focus();
}

function _bastionWallRefreshMedia() {
  const slot = document.getElementById('bs-wall-media-preview');
  if (slot) slot.innerHTML = _wallComposerMedia();
  document.querySelector('.bs-wall-publish')?.toggleAttribute('disabled', !_wallUi.draftText.trim() && !_wallUi.images.length);
}

function _bastionWallAddImage() {
  if (_wallUi.images.length >= 3) return;
  pickImageFile({ onImage: async ({ dataUrl }) => {
    const compressed = await compressDataUrl(dataUrl, { max: 960, quality: .72 });
    if (_wallUi.images.reduce((sum, image) => sum + image.length, 0) + compressed.length > 680000) {
      showNotif('Ces images sont trop lourdes ensemble. Retire-en une ou choisis une image plus légère.', 'error');
      return;
    }
    _wallUi.images.push(compressed);
    _bastionWallRefreshMedia();
    _wallPersistDraft();
  }});
}

async function _wallCreateNotifications(targetUids, { postId, actor, kind, text }) {
  const targets = [...new Set((targetUids || []).filter(uid => uid && uid !== STATE.user?.uid))];
  if (!targets.length) return;
  const ts = Date.now();
  await Promise.all(targets.map(targetUid => addToCol('bastionWallNotifications', {
    targetUid,
    actorUid: STATE.user?.uid || '',
    actorCharId: actor?.charId || '',
    actorName: actor?.charName || 'Personnage',
    postId,
    kind,
    text: String(text || '').replace(/\s+/g, ' ').trim().slice(0, 180),
    ts,
  }, { silent: true }).catch(error => console.debug('[bastion] notification distante indisponible', error?.code || error))));
}

async function _bastionPostAnnonce() {
  const identity = _wallIdentity();
  const text = _wallUi.draftText.trim().slice(0, 4000);
  if (!identity) { showNotif('Choisis un personnage pour publier.', 'error'); return; }
  if (!text && !_wallUi.images.length) { showNotif('Ajoute un message ou une image avant de publier.', 'error'); return; }
  const button = document.querySelector('.bs-wall-publish');
  if (button) button.disabled = true;
  let mediaId = '';
  try {
    const images = [..._wallUi.images];
    if (images.length) {
      mediaId = await addToCol('bastionWallMedia', {
        uid: STATE.user?.uid || '',
        images,
        ts: Date.now(),
      }, { silent: true }).catch(() => '');
    }
    const compressedPreview = images[0]
      ? await compressDataUrl(images[0], { max: 160, quality: .4 }).catch(() => '')
      : '';
    const imagePreview = compressedPreview.length <= 80_000 ? compressedPreview : '';
    const postPayload = {
      kind: 'post', ...identity, type: _wallUi.type, text,
      mediaId, imageCount: images.length, imagePreview,
      ...(!mediaId && images.length ? { images } : {}),
      status: 'active', pinned: false, commentCount: 0,
      reactions: {}, ts: Date.now(),
    };
    const postId = await addToCol('bastionAnnonces', postPayload);
    // Ne dépend pas du délai de reconnexion du listener : le post enregistré
    // apparaît immédiatement, puis le snapshot serveur reprend la main.
    _annonces = sortBastionWallPosts([
      { id: postId, ...postPayload, createdAt: new Date().toISOString() },
      ..._annonces.filter(post => post.id !== postId),
    ]);
    const mentioned = bastionWallMentionedCharacters(text, STATE.characters || []);
    await _wallCreateNotifications(mentioned.map(character => character.uid), {
      postId, actor: identity, kind: 'mention', text,
    });
    _wallUi.draftText = ''; _wallUi.images = []; _wallUi.pickerOpen = false;
    _wallUi.filter = 'all';
    _wallUi.visible = 12;
    _wallClearDraft();
    if (STATE.currentPage === 'bastion') _renderPage();
    showNotif('Publication ajoutée au mur.', 'success');
  } catch (error) {
    if (mediaId) void deleteFromCol('bastionWallMedia', mediaId).catch(() => {});
    notifySaveError(error, 'Impossible de publier sur le mur.');
    if (button) button.disabled = false;
  }
}

async function _bastionDeleteAnnonce(id) {
  const post = _wallPostById(id);
  const canDelete = post && (STATE.isAdmin || (!post.legacy && post.uid === STATE.user?.uid));
  if (!canDelete) { showNotif('Tu ne peux supprimer que tes publications.', 'error'); return; }
  const confirmed = await confirmModal('Supprimer définitivement cette publication et toutes ses réponses ?', { title: 'Supprimer la publication', confirmLabel: 'Supprimer', danger: true }).catch(() => false);
  if (!confirmed) return;
  if (post.legacy) {
    const items = _legacyAnnonces.filter(item => item.id !== id).map(({ legacy, legacyIndex, ...item }) => {
      // Ne pas transformer les identifiants d'affichage générés par la refonte
      // en données persistées sur toutes les annonces historiques restantes.
      if (item.id === `legacy_${legacyIndex}`) delete item.id;
      return item;
    });
    if (!await tryDoc('bastionAnnonces', 'main', { items })) return;
    _legacyAnnonces = _legacyAnnonces.filter(item => item.id !== id);
  } else {
    const [comments, notifications] = await Promise.all([
      loadCollectionWhere('bastionWallComments', 'postId', '==', id).catch(() => []),
      loadCollectionWhere('bastionWallNotifications', 'postId', '==', id).catch(() => []),
    ]);
    await Promise.all([
      ...comments.map(comment => deleteFromCol('bastionWallComments', comment.id)),
      ...notifications.map(notification => deleteFromCol('bastionWallNotifications', notification.id).catch(() => {})),
    ]);
    if (post.mediaId) await deleteFromCol('bastionWallMedia', post.mediaId).catch(() => {});
    await deleteFromCol('bastionAnnonces', id);
    _annonces = _annonces.filter(item => item.id !== id);
    _wallComments = _wallComments.filter(comment => comment.postId !== id);
  }
  _wallUi.menuPostId = '';
  if (STATE.currentPage === 'bastion') _renderPage();
  showNotif(post.legacy ? 'Ancienne publication supprimée.' : 'Publication supprimée.', 'success');
}

async function _bastionWallMutate(id, mutator) {
  await mutateInCol('bastionAnnonces', id, current => {
    if (!current) return null;
    const next = mutator(current);
    const { id: _ignored, ...stored } = next;
    return stored;
  });
}

async function _bastionWallReact(btn) {
  const identity = _wallIdentity(); if (!identity) return;
  const allowed = [...ALL_EMOJIS, ..._wallEmotes.map(emote => `:${emote.name}:`)];
  await _bastionWallMutate(btn.dataset.id, post => {
    const next = toggleBastionWallReaction(post, identity, btn.dataset.reaction, allowed);
    return { ...post, reactions: next.reactions, updatedAt: next.updatedAt };
  });
  _wallUi.reactionPostId = '';
}

function _bastionWallEditPost(id) {
  const post = _wallPostById(id);
  if (!post || (post.uid !== STATE.user?.uid && !STATE.isAdmin) || post.legacy) return;
  _wallUi.menuPostId = '';
  _wallUi.editPostId = id;
  _wallUi.editPostText = post.text || '';
  _wallUi.editPostType = post.type || 'message';
  _renderPage();
  document.querySelector(`#bastion-post-${CSS.escape(id)} .bs-wall-post-edit textarea`)?.focus();
}

async function _bastionWallSavePost(id) {
  const post = _wallPostById(id);
  const text = _wallUi.editPostText.trim().slice(0, 4000);
  if (!post || (!text && !post.imageCount && !post.images?.length)) return;
  const oldMentionUids = new Set(bastionWallMentionedCharacters(post.text, STATE.characters || []).map(character => character.uid));
  const newMentions = bastionWallMentionedCharacters(text, STATE.characters || []).filter(character => !oldMentionUids.has(character.uid));
  const nextType = BASTION_WALL_TYPES[_wallUi.editPostType] ? _wallUi.editPostType : 'message';
  await updateInCol('bastionAnnonces', id, {
    text,
    type: nextType,
    ...(nextType === 'message' && post.status !== 'active' ? { status: 'active' } : {}),
    editedAt: Date.now(),
    updatedAt: Date.now(),
  });
  await _wallCreateNotifications(newMentions.map(character => character.uid), {
    postId: id,
    actor: _wallIdentity(),
    kind: 'mention',
    text,
  });
  _wallUi.editPostId = '';
  if (STATE.currentPage === 'bastion') _renderPage();
  showNotif('Publication modifiée.', 'success');
}

async function _bastionWallSetStatus(id, status) {
  const post = _wallPostById(id);
  if (!post || !BASTION_WALL_STATUSES[status] || (post.uid !== STATE.user?.uid && !STATE.isAdmin)) return;
  await updateInCol('bastionAnnonces', id, { status, updatedAt: Date.now() });
  _wallUi.menuPostId = '';
  if (STATE.currentPage === 'bastion') _renderPage();
  showNotif(status === 'active' ? 'Publication rouverte.' : status === 'resolved' ? 'Publication marquée comme résolue.' : 'Publication annulée.', 'success');
}

async function _bastionWallPin(id) {
  if (!STATE.isAdmin) return;
  const post = _wallPostById(id); if (!post) return;
  await updateInCol('bastionAnnonces', id, { pinned: !post.pinned, updatedAt: Date.now() });
  _wallUi.menuPostId = '';
  if (STATE.currentPage === 'bastion') _renderPage();
}

function _bastionWallToggleReply(id) {
  _wallUi.reactionPostId = '';
  if (_wallUi.replyOpen.has(id)) _wallUi.replyOpen.delete(id); else _wallUi.replyOpen.add(id);
  _renderPage();
  document.querySelector(`.bs-wall-reply textarea[data-id="${CSS.escape(id)}"]`)?.focus();
}

async function _bastionWallReply(id) {
  const identity = _wallIdentity();
  const text = String(_wallUi.replyDrafts.get(id) || '').trim().slice(0, 1200);
  const post = _wallPostById(id);
  if (!identity || !text || !post) return;
  const ts = Date.now();
  const commentPayload = { ...identity, postId: id, text, ts };
  const commentId = await addToCol('bastionWallComments', commentPayload, { silent: true }).catch(() => '');
  if (commentId) {
    await _bastionWallMutate(id, current => ({
      ...current,
      commentCount: Math.max(0, Number(current.commentCount) || 0) + 1,
      updatedAt: ts,
    })).catch(() => {});
  } else {
    // Transition douce : les règles historiques autorisaient les réponses dans
    // le post. On conserve ce chemin jusqu'au déploiement des nouvelles règles.
    await _bastionWallMutate(id, current => {
      const next = appendBastionWallComment(current, { ...commentPayload, id: `c_${ts}_${Math.random().toString(36).slice(2, 6)}` });
      return { ...current, comments: next.comments, updatedAt: next.updatedAt };
    });
  }
  const mentioned = bastionWallMentionedCharacters(text, STATE.characters || []);
  const targets = bastionWallNotificationTargets({
    post,
    comments: bastionWallCommentsForPost(post, _wallComments),
    mentioned,
    actorUid: STATE.user?.uid,
  });
  await _wallCreateNotifications(targets, { postId: id, actor: identity, kind: 'reply', text });
  _wallUi.replyDrafts.delete(id);
  _wallUi.replyOpen.add(id);
  if (STATE.currentPage === 'bastion') _renderPage();
  return commentId;
}

async function _bastionWallDeleteComment(btn) {
  const comment = _wallComments.find(item => item.id === btn.dataset.comment);
  if (!comment || (!STATE.isAdmin && comment.uid !== STATE.user?.uid)) return;
  await deleteFromCol('bastionWallComments', comment.id);
  await _bastionWallMutate(btn.dataset.id, current => ({
    ...current,
    commentCount: Math.max(0, (Number(current.commentCount) || 1) - 1),
    updatedAt: Date.now(),
  })).catch(() => {});
}

function _bastionWallEditComment(btn) {
  const comment = _wallComments.find(item => item.id === btn.dataset.comment);
  if (!comment || (!STATE.isAdmin && comment.uid !== STATE.user?.uid)) return;
  _wallUi.editCommentId = comment.id;
  _wallUi.editCommentText = comment.text || '';
  _renderPage();
  document.querySelector('.bs-wall-comment textarea')?.focus();
}

async function _bastionWallSaveComment(commentId) {
  const comment = _wallComments.find(item => item.id === commentId);
  const text = _wallUi.editCommentText.trim().slice(0, 1200);
  if (!comment || !text || (!STATE.isAdmin && comment.uid !== STATE.user?.uid)) return;
  await updateInCol('bastionWallComments', commentId, { text, editedAt: Date.now() });
  const oldMentionUids = new Set(bastionWallMentionedCharacters(comment.text, STATE.characters || []).map(character => character.uid));
  const newMentions = bastionWallMentionedCharacters(text, STATE.characters || []).filter(character => !oldMentionUids.has(character.uid));
  await _wallCreateNotifications(newMentions.map(character => character.uid), {
    postId: comment.postId,
    actor: _wallIdentity(),
    kind: 'mention',
    text,
  });
  _wallUi.editCommentId = '';
  if (STATE.currentPage === 'bastion') _renderPage();
}

function _bastionOpenPostImage(btn) {
  const post = _wallPostById(btn.dataset.id);
  const image = post ? _wallImages(post)[Number(btn.dataset.index)] : '';
  if (image) openModal('Image de la publication', `<div class="bs-wall-image-modal"><img src="${_esc(image)}" alt="Image de la publication"></div>`, { size: 'wide' });
}

async function _loadWallEmotes() {
  const data = await getDocData('world', 'vtt_emotes').catch(() => null);
  _wallEmotes = Array.isArray(data?.emotes) ? data.emotes.filter(emote => emote?.name && emote?.url) : [];
}

// Contenu de l'onglet actif (une seule section à la fois → fin du long scroll).
function _bsTabBody(b, tab) {
  if (tab === 'coffre') return _renderCoffre(b);
  if (tab === 'mur') return `<div class="bs-mur-layout">
    <div class="bs-mur-feed">${_renderAnnonces()}</div>
    <aside class="bs-mur-side">${_renderWallSidebar(b)}</aside>
  </div>`;
  return _renderRooms(b);   // 'salles' par défaut
}

function _renderPage() {
  const content = document.getElementById('main-content');
  if (!content) return;
  const b = STORE.bastion || _defaultBastion();
  const tab = _bsGetTab();
  content.innerHTML = `
    <div class="bs-root-v2 bs-page">
      ${_renderHeader(b)}
      <div class="bs-wrap bs-tab-body" data-tab="${tab}">
        ${_bsTabBody(b, tab)}
      </div>
    </div>`;
  if (tab === 'mur') requestAnimationFrame(_wallFocusTarget);
  // Renseigne l'info « or dispo / max » des contrôles de cotisation inline.
  if (tab === 'salles' && STORE.roomSel) requestAnimationFrame(() => _bastionRefreshInvestment(STORE.roomSel));
}

// ══════════════════════════════════════════════════════════════════════════════
// POINT D'ENTRÉE
// ══════════════════════════════════════════════════════════════════════════════
async function renderBastionPage() {
  const content = document.getElementById('main-content');
  if (!content) return;
  content.innerHTML = appSplashHtml('Chargement du Bastion…');

  const adventureId = STATE.adventure?.id || 'default';
  if (_wallAdventureId !== adventureId) {
    clearTimeout(_wallSeenTimer);
    _wallSeenWriteAt = 0;
    _wallAdventureId = adventureId;
    _annonces = [];
    _legacyAnnonces = [];
    _wallComments = [];
    _wallRead = null;
    _wallMedia.clear();
    _wallEmotes = [];
    _wallUi.draftText = '';
    _wallUi.type = 'message';
    _wallUi.charId = '';
    _wallUi.images = [];
    _wallUi.visible = 12;
    _wallUi.pickerOpen = false;
    _wallUi.filter = 'all';
    _wallUi.reactionPostId = '';
    _wallUi.replyOpen.clear();
    _wallUi.replyDrafts.clear();
    _wallUi.menuPostId = '';
    _wallUi.editPostId = '';
    _wallUi.editCommentId = '';
    _wallUi.focusedPostId = '';
    STORE.investments = [];
    STORE.investmentInProgress = false;
    _wallRestoreDraft();
  }

  // Lien profond vers une publication → ouvre directement l'onglet Mur.
  if (_wallTargetFromRoute()) STORE.tab = 'mur';

  STORE.shopItemsCache = null; STORE.npcsCache = null; // reset au cas où on aurait changé d'aventure

  // Seul le doc `bastion/main` est essentiel au 1er rendu (il est amorcé tôt à
  // l'entrée d'aventure → résolution rapide). shop + npcs ne servent qu'aux noms
  // d'objets du coffre et aux portraits du personnel : on les charge EN ARRIÈRE-PLAN.
  // Leur prime "à froid" attend le snapshot serveur (potentiellement long) — les
  // attendre ici bloquait le rendu / loader. Garde anti-blocage : timeout 6 s sur
  // le doc → rendu avec le défaut, le listener temps réel corrigera.
  const TIMEOUT = Symbol('timeout');
  try {
    const data = await Promise.race([
      getDocData('bastion', 'main').catch(() => null),
      new Promise(r => setTimeout(() => r(TIMEOUT), 2500)),
    ]);
    if (data === TIMEOUT) {
      console.warn('[bastion] doc lent (>2.5s) — coquille rendue, le listener corrigera');
      STORE.bastion = STORE.bastion || _defaultBastion();
    } else {
      const normalized = _normalizeBastionDoc(data);
      STORE.bastion = normalized.bastion;
      if (normalized.migrated) void _persistBastionCatalogMigration(STORE.bastion);
    }
    _renderPage();
  } catch (e) {
    console.error('[bastion] échec de chargement/rendu', e);
    STORE.bastion = STORE.bastion || _defaultBastion();
    try {
      _renderPage();
    } catch (e2) {
      console.error('[bastion] échec du rendu de secours', e2);
      content.innerHTML = `<div class="bs-root" style="padding:2rem;text-align:center;color:var(--text-muted)">
        ⚠️ Le Bastion n'a pas pu se charger.<br><small>Détails dans la console.</small></div>`;
    }
  }

  // Premier chargement déterministe du mur. L'abonnement posé juste après
  // conserve ensuite la liste à jour, mais le rendu initial n'en dépend plus.
  void loadRecentCollection('bastionAnnonces', { field: 'ts', max: 80 })
    .then(docs => {
      if (STATE.currentPage === 'bastion' && !_annonces.length) _wallReceivePosts(docs);
    })
    .catch(error => console.debug('[bastion] chargement initial du mur indisponible', error?.code || error));

  // Abonnement temps réel (idempotent) — corrige/complète les données affichées.
  _attachListener();

  // Secondaire : noms d'objets du coffre + portraits du personnel. Non bloquant —
  // re-render une fois prêt si on est toujours sur la page.
  Promise.all([_loadShopItems(), _loadNpcs(), _loadWallEmotes()])
    .then(() => { if (STATE.currentPage === 'bastion') _renderPage(); })
    .catch(e => console.error('[bastion] chargement shop/npcs', e));
}

registerActions({
  _bastionRefreshDepositItems: () => _bastionRefreshDepositItems(),
  _bastionRefreshDepositMax:   () => _bastionRefreshDepositMax(),
  _bastionEditItemQty: (el) => _bastionEditItemQty(Number(el.dataset.i), Number(el.dataset.idx), el.value),
  _bastionSetPickerCat:    (el) => _bastionSetPickerCat(Number(el.dataset.i), el.value),
  _bastionSetPickerSearch: (el) => _bastionSetPickerSearch(Number(el.dataset.i), el.value),
  _bastionRunPreview:      () => _bastionRunPreview(),
  _bastionRefreshTransfer: (el) => _bastionRefreshTransfer(el.dataset.direction),
  _bastionSetCoffreSearch: (el) => _bastionSetCoffreSearch(el.value),
  _bastionSaveIdentite:     () => _bastionSaveIdentite(),
  _bastionResetAll:         () => _bastionResetAll(),
  _bastionFillDepositMax:   () => _bastionFillDepositMax(),
  _bastionDoDeposit:        () => _bastionDoDeposit(),
  _bastionDoWithdraw:       (btn) => _bastionDoWithdraw(btn.dataset.id),
  _bastionEditRoom:         (btn) => _bastionEditRoom(btn.dataset.slug),
  _bastionReturnToCatalog:  (btn) => _bastionReturnToCatalog(btn.dataset.slug),
  _bastionAddCustomRoom:    () => _bastionAddCustomRoom(),
  _bastionCancelCreateRoom: () => _bastionCancelCreateRoom(),
  _bastionPickRoomTemplate: (btn) => _bastionFillCreateRoomTemplate(btn.dataset.template || 'service'),
  _bastionCreateCustomRoom: () => _bastionCreateCustomRoom(),
  _bastionCloseModal:       () => closeModal(),
  _bastionDeleteCustomRoom: (btn) => _bastionDeleteCustomRoom(btn.dataset.slug),
  _bastionResetRoom:        (btn) => _bastionResetRoom(btn.dataset.slug),
  _bastionSaveRoom:         (btn) => _bastionSaveRoom(btn.dataset.slug),
  _bastionRemoveItem:       (btn) => _bastionRemoveItem(Number(btn.dataset.i), Number(btn.dataset.idx)),
  _bastionAddShopItem:      (btn) => _bastionAddShopItem(Number(btn.dataset.i)),
  _bastionFireEmployee:     (btn) => _bastionFireEmployee(btn.dataset.id),
  _bastionSelectHireCard:   (btn) => _bastionSelectHireCard(btn.dataset.id),
  _bastionDoHire:           () => _bastionDoHire(),
  _bastionDoTransfer:       (btn) => _bastionDoTransfer(btn.dataset.dir),
  _bastionRefreshInvestment:(el) => _bastionRefreshInvestment(el.dataset.slug),
  _bastionFillInvestment:   (btn) => _bastionFillInvestment(btn.dataset.slug),
  _bastionDoInvest:         (btn) => _bastionDoInvest(btn.dataset.slug),
  _bastionOpenPersonnel:    () => _bastionOpenPersonnel(),
  _bastionEditIdentite:     () => _bastionEditIdentite(),
  _bastionOpenCatalogEditor:() => _bastionOpenCatalogEditor(),
  _bastionOpenPreview:      () => _bastionOpenPreview(),
  _bastionExportJSON:       () => _bastionExportJSON(),
  _bastionAdvanceWeek:      () => _bastionAdvanceWeek(),
  _bastionUndoWeek:         () => _bastionUndoWeek(),
  _bastionOpenTransfer:     (btn) => _bastionOpenTransfer(btn.dataset.dir),
  _bastionOpenHire:         (btn) => _bastionOpenHire(btn.dataset.slug),
  _bastionBuild:            (btn) => _bastionBuild(btn.dataset.slug),
  _bastionCancelBuild:      (btn) => _bastionCancelBuild(btn.dataset.slug),
  _bastionResetRooms:       () => _bastionResetRooms(),
  _bastionOpenDeposit:      () => _bastionOpenDeposit(),
  _bastionSetTab:           (btn) => _bastionSetTab(btn.dataset.tab),
  _bastionSelectRoom:       (btn) => _bastionSelectRoom(btn.dataset.slug),
  _bastionSetRoomFilter:    (btn) => _bastionSetRoomFilter(btn.dataset.filter),
  _bastionShowQuest:        (btn) => _bastionShowQuest(btn.dataset.id),
  _bastionSetCoffreFilter:  (btn) => _bastionSetCoffreFilter(btn.dataset.filter),
  _bastionCoffreOpen:       (btn) => _bastionCoffreOpen(btn.dataset.id),
  _bastionCoffreQty:        (btn) => _bastionCoffreQty(btn.dataset.delta, btn.dataset.max),
  _bastionCoffreTake:       (btn) => _bastionCoffreTake(btn.dataset.id),
  _bastionCoffreExpand:     () => _bastionCoffreExpand(),
  _bastionSaveQuest:        (btn) => _bastionSaveQuest(btn.dataset.id || ''),
  _bastionSetQuestStatut:   (btn) => _bastionSetQuestStatut(btn),
  _bastionDeleteQuest:      (btn) => _bastionDeleteQuest(btn.dataset.id),
  _bastionOpenQuestEditor:  (btn) => _bastionOpenQuestEditor(btn.dataset.id || undefined),
  _bastionOpenHistory:      () => _bastionOpenHistory(),
  _bastionDeleteHisto:      (btn) => _bastionDeleteHisto(Number(btn.dataset.idx)),
  _bastionSetAnnonceType:   (btn) => _bastionSetAnnonceType(btn),
  _bastionWallDraft:        (el) => _bastionWallDraft(el),
  _bastionWallMention:      (btn) => _bastionWallMention(btn),
  _bastionWallTogglePicker: () => _bastionWallTogglePicker(),
  _bastionWallInsert:       (btn) => _bastionWallInsert(btn),
  _bastionWallAddImage:     () => _bastionWallAddImage(),
  _bastionWallRemoveImage:  (btn) => { _wallUi.images.splice(Number(btn.dataset.index), 1); _bastionWallRefreshMedia(); _wallPersistDraft(); },
  _bastionPostAnnonce:      () => _bastionPostAnnonce(),
  _bastionDeleteAnnonce:    (btn) => _bastionDeleteAnnonce(btn.dataset.id),
  _bastionWallReact:        (btn) => _bastionWallReact(btn),
  _bastionWallToggleMenu:   (btn) => { _wallUi.menuPostId = _wallUi.menuPostId === btn.dataset.id ? '' : btn.dataset.id; _renderPage(); },
  _bastionWallEditPost:     (btn) => _bastionWallEditPost(btn.dataset.id),
  _bastionWallEditPostDraft:(el) => { _wallUi.editPostText = el.value || ''; },
  _bastionWallEditPostType: (el) => { _wallUi.editPostType = el.value || 'message'; },
  _bastionWallCancelPostEdit:() => { _wallUi.editPostId = ''; _renderPage(); },
  _bastionWallSavePost:     (btn) => _bastionWallSavePost(btn.dataset.id),
  _bastionWallSetStatus:    (btn) => _bastionWallSetStatus(btn.dataset.id, btn.dataset.status),
  _bastionWallPin:          (btn) => _bastionWallPin(btn.dataset.id),
  _bastionWallToggleReactions: (btn) => { _wallUi.reactionPostId = _wallUi.reactionPostId === btn.dataset.id ? '' : btn.dataset.id; _renderPage(); },
  _bastionWallToggleReply:  (btn) => _bastionWallToggleReply(btn.dataset.id),
  _bastionWallReplyDraft:   (el) => _wallUi.replyDrafts.set(el.dataset.id, el.value || ''),
  _bastionWallReply:        (btn) => _bastionWallReply(btn.dataset.id),
  _bastionWallEditComment:  (btn) => _bastionWallEditComment(btn),
  _bastionWallEditCommentDraft: (el) => { _wallUi.editCommentText = el.value || ''; },
  _bastionWallCancelCommentEdit: () => { _wallUi.editCommentId = ''; _renderPage(); },
  _bastionWallSaveComment:  (btn) => _bastionWallSaveComment(btn.dataset.comment),
  _bastionWallDeleteComment:(btn) => _bastionWallDeleteComment(btn),
  _bastionOpenPostImage:    (btn) => _bastionOpenPostImage(btn),
  _bastionWallJump:         (btn) => _bastionWallJump(btn.dataset.id),
  _bastionWallMore:         () => { _wallUi.visible += 12; _renderPage(); },
  _bastionWallSetFilter:    (btn) => { _wallUi.filter = btn.dataset.filter || 'all'; _wallUi.visible = 12; _renderPage(); },
});

// ── Exports legacy (pour ne pas casser pages.js ailleurs) ──────────────────
export const BASTION_EVENTS = [];
export function calculerRevenuBastion() {
  return { brut: 0, fondateurs: 0, base: 0, nbAmelios: 0, evt: { id: 'calme', nom: 'Calme', emoji: '☁️', description: '', badgeClass: 'badge-blue', badgeText: '±0', couleur: 'neutral', modificateur: 1, bonus: 0 } };
}
export function getDefaultBastion() { return _defaultBastion(); }

export default renderBastionPage;
