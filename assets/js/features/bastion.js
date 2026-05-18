// ══════════════════════════════════════════════════════════════════════════════
// BASTION — Comptoir multi-activités
//
// Modèle Firestore : adventures/{aid}/bastion/main = {
//   nom, description, lieu, emoji,
//   semaine,                              // # semaine actuelle
//   or, renommee, influence,              // ressources
//   salles: { [slug]: { niveau, builtAt, weeksLeftToBuild, targetNiveau } },
//   coffre: [ { id, nom, quantite, emoji, source, weekAdded } ],
//   historique: [ { week, type, msg } ], // last 30
//   createdAt,
// }
// Une seule source de vérité, sync temps réel via watchDoc.
// ══════════════════════════════════════════════════════════════════════════════

import { STATE } from '../core/state.js';
import { getDocData, saveDoc, updateInCol, loadCollection, getCurrentAdventureId } from '../data/firestore.js';
import { db, doc, setDoc } from '../config/firebase.js';
import { watchDoc } from '../shared/realtime.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { openModal, closeModal, confirmModal } from '../shared/modal.js';
import { _esc, appSplashHtml } from '../shared/html.js';
import { calcOr } from '../shared/char-stats.js';
import { useGold } from '../shared/economy.js';
import PAGES from './pages.js';

// Cache items boutique (rechargé à l'ouverture de l'éditeur)
let _shopItemsCache = null;
let _shopCatsCache  = null;
async function _loadShopItems() {
  if (_shopItemsCache && _shopCatsCache) return _shopItemsCache;
  const [items, cats] = await Promise.all([
    loadCollection('shop').catch(() => []),
    loadCollection('shopCategories').catch(() => []),
  ]);
  _shopItemsCache = items;
  _shopCatsCache  = cats;
  return _shopItemsCache;
}
function _findShopItem(id) {
  return (_shopItemsCache || []).find(it => it.id === id) || null;
}
function _findShopCat(id) {
  return (_shopCatsCache || []).find(c => c.id === id) || null;
}

// ══════════════════════════════════════════════════════════════════════════════
// CATALOGUE DE SALLES
// Chaque salle a 3 niveaux. Production = ce qui est généré chaque semaine.
// ══════════════════════════════════════════════════════════════════════════════
// Le catalogue par défaut est ici. Le MJ peut overrider via b.catalogOverrides.
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
let _bastion = null;

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
    createdAt: Date.now(),
  };
}

// Catalogue effectif = défaut + overrides MJ + salles custom. Pur, ne mute jamais le DEFAULT.
function _getRoomCatalog(b) {
  const ov = b?.catalogOverrides || {};
  const defaults = DEFAULT_ROOM_CATALOG.map(def => {
    const o = ov[def.slug];
    if (!o) return def;
    const niveaux = def.niveaux.map((n, i) => ({ ...n, ...(o.niveaux?.[i] || {}) }));
    return { ...def, ...o, niveaux };
  });
  const customs = (b?.customRooms || []).map(c => ({ ...c, isCustom: true }));
  return [...defaults, ...customs];
}

function _getRoomDef(slug, b) {
  return _getRoomCatalog(b || _bastion).find(r => r.slug === slug);
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

// Calcule le niveau "actuel + en construction = target" affiché
function _roomTargetLabel(slug, b, isUnlimited) {
  const s = b?.salles?.[slug];
  if (!s) return '';
  const lbl = (n) => isUnlimited ? `${n}` : (NIVEAU_LABEL[n] || n);
  if (s.weeksLeftToBuild > 0) {
    return `→ ${lbl(s.targetNiveau)} (${s.weeksLeftToBuild} période)`;
  }
  return `Niv. ${lbl(s.niveau)}`;
}

function _addHistorique(b, type, msg) {
  const e = { week: b.semaine, type, msg, ts: Date.now() };
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
async function _save(b) {
  try {
    await saveDoc('bastion', 'main', b);
  } catch (e) { notifySaveError(e); }
}

function _attachListener() {
  // watchDoc gère lui-même le re-subscribe (kill listener précédent du même nom).
  watchDoc('bastion', 'bastion', 'main', (data) => {
    const isFirst = !_bastion;
    const prevWeek = _bastion?.semaine;
    _bastion = data || _defaultBastion();
    // Notif douce si la semaine a avancé (vu côté joueur après que le MJ a cliqué)
    if (!isFirst && prevWeek != null && _bastion.semaine > prevWeek && !STATE.isAdmin) {
      showNotif(`🕰 Période ${_bastion.semaine} : votre bastion a changé !`, 'success');
    }
    if (STATE.currentPage === 'bastion') _renderPage();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// ACTIONS — MJ
// ══════════════════════════════════════════════════════════════════════════════
window._bastionBuild = async (slug) => {
  if (!STATE.isAdmin) return;
  const b = { ..._bastion } || _defaultBastion();
  const def = _getRoomDef(slug);
  if (!def) return;

  const curNiv = _roomNiveau(b, slug);
  const max = _maxLevel(def);
  if (curNiv >= max) { showNotif('Niveau maximum atteint.', 'error'); return; }
  if (_roomBuilding(b, slug)) { showNotif('Déjà en construction.', 'error'); return; }

  const target = curNiv + 1;
  const niveauDef = _getNiveauData(def, target);

  // Vérif coût
  if ((b.or || 0) < niveauDef.cout) {
    showNotif(`Or insuffisant (${b.or}/${niveauDef.cout} requis).`, 'error');
    return;
  }

  b.or = (b.or || 0) - niveauDef.cout;
  b.salles = { ...(b.salles || {}) };
  b.salles[slug] = {
    niveau: curNiv,                  // niveau actuel inchangé tant que construction pas finie
    targetNiveau: target,
    weeksLeftToBuild: niveauDef.semaines,
    builtAt: b.salles[slug]?.builtAt || null,
  };
  _addHistorique(b, 'construction',
    `🏗 ${def.emoji} ${def.nom} — construction niveau ${def.unlimited ? target : NIVEAU_LABEL[target]} commencée (${niveauDef.semaines} période, ${niveauDef.cout} or)`);

  await _save(b);
  showNotif(`Construction de ${def.nom} ${NIVEAU_LABEL[target]} lancée.`, 'success');
};

window._bastionAdvanceWeek = async () => {
  if (!STATE.isAdmin) return;
  if (!_bastion) return;
  const ok = await confirmModal('▶ Passer à la période suivante ?\n\nProductions appliquées, constructions avancées, salaires payés.', {
    title: '🕰 Passer une période',
    okLabel: '▶ Avancer',
    cancelLabel: 'Annuler',
  }).catch(() => false);
  if (!ok) return;

  const b = JSON.parse(JSON.stringify(_bastion));
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

  await _save(b);
  const summary = [
    totalOrProduit > 0 ? `+${totalOrProduit} or` : null,
    totalItemsProduits > 0 ? `+${totalItemsProduits} item${totalItemsProduits > 1 ? 's' : ''}` : null,
    totalSalaires > 0 ? `−${totalSalaires} salaires` : null,
  ].filter(Boolean).join(' · ') || 'aucune production';
  showNotif(`▶ Période ${b.semaine} — ${summary}`, 'success');
};

window._bastionEditIdentite = async () => {
  if (!STATE.isAdmin) return;
  const b = _bastion || _defaultBastion();
  openModal('🏰 Identité du Bastion', `
    <div class="form-group"><label>Nom</label>
      <input class="input-field" id="bas-nom" value="${_esc(b.nom||'')}"></div>
    <div class="form-group"><label>Emoji / icône</label>
      <input class="input-field" id="bas-emoji" value="${_esc(b.emoji||'🏰')}" maxlength="4" style="max-width:90px;font-size:1.4rem;text-align:center"></div>
    <div class="form-group"><label>Lieu</label>
      <input class="input-field" id="bas-lieu" value="${_esc(b.lieu||'')}" placeholder="ex: Faubourg sud de Belport"></div>
    <div class="form-group"><label>Description</label>
      <textarea class="input-field" id="bas-desc" rows="4" placeholder="Histoire, ambiance, particularités…">${_esc(b.description||'')}</textarea></div>
    <button class="btn btn-gold" style="width:100%" onclick="window._bastionSaveIdentite()">Enregistrer</button>

    <div class="bs-danger-zone">
      <div class="bs-danger-zone-title">⚠ Zone dangereuse</div>
      <p class="bs-danger-zone-desc">
        Remet le Bastion à zéro : nom par défaut, aucun or, aucune salle, aucun employé, coffre vide, chronique effacée, quêtes et overrides supprimés.<br>
        <strong>À utiliser pour repartir d'une feuille blanche.</strong>
      </p>
      <button class="btn btn-outline btn-sm bs-danger-btn" onclick="window._bastionResetAll()">🗑 Réinitialiser tout le Bastion</button>
    </div>
  `);
};

window._bastionResetAll = async () => {
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
    const aid = getCurrentAdventureId();
    await setDoc(doc(db, `adventures/${aid}/bastion/main`), fresh);
    closeModal();
    showNotif('Bastion réinitialisé. Bonne campagne !', 'success');
  } catch (e) { notifySaveError(e); }
};
window._bastionSaveIdentite = async () => {
  if (!STATE.isAdmin) return;
  const b = { ..._bastion };
  b.nom         = document.getElementById('bas-nom')?.value?.trim() || 'Le Bastion';
  b.emoji       = document.getElementById('bas-emoji')?.value?.trim() || '🏰';
  b.lieu        = document.getElementById('bas-lieu')?.value?.trim() || '';
  b.description = document.getElementById('bas-desc')?.value?.trim() || '';
  await _save(b);
  closeModal();
  showNotif('Identité mise à jour.', 'success');
};

// ══════════════════════════════════════════════════════════════════════════════
// ACTIONS — Inventaire (déposer / retirer un objet)
// ══════════════════════════════════════════════════════════════════════════════
window._bastionOpenDeposit = () => {
  const chars = _eligibleChars().filter(c => (c.inventaire || []).length > 0);
  if (!chars.length) { showNotif('Aucun personnage avec inventaire.', 'error'); return; }

  const capacity = _bastionCapacity(_bastion);
  const used = _bastionInvCount(_bastion);
  if (used >= capacity) { showNotif(`Coffre plein (${used}/${capacity}). Améliore l'Entrepôt.`, 'error'); return; }

  const defaultChar = chars.find(c => c.uid === STATE.user?.uid) || chars[0];

  openModal('📥 Déposer un objet au coffre', `
    <div class="form-group">
      <label>Depuis le personnage</label>
      <select class="input-field" id="bas-dep-char" onchange="window._bastionRefreshDepositItems()">
        ${chars.map(c => `<option value="${c.id}"${c.id === defaultChar.id ? ' selected' : ''}>${_esc(c.nom || '?')}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Objet à déposer <span style="font-size:.74rem;color:var(--text-dim);font-weight:400">(coffre : ${used}/${capacity})</span></label>
      <select class="input-field" id="bas-dep-item" onchange="window._bastionRefreshDepositMax()"></select>
    </div>
    <div class="form-group">
      <label>Quantité <span id="bas-dep-info" style="font-size:.72rem;color:var(--text-dim);font-weight:400;margin-left:.4rem"></span></label>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="number" class="input-field" id="bas-dep-qte" min="1" value="1" style="flex:1">
        <button type="button" class="btn btn-outline btn-sm" onclick="window._bastionFillDepositMax()">Tout</button>
      </div>
    </div>
    <button class="btn btn-gold" style="width:100%" onclick="window._bastionDoDeposit()">📥 Déposer</button>
  `);
  window._bastionRefreshDepositItems();
};
window._bastionFillDepositMax = () => {
  const qte = document.getElementById('bas-dep-qte');
  if (qte && qte.max) qte.value = qte.max;
};

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
let _depositGroups = [];

window._bastionRefreshDepositItems = () => {
  const charId = document.getElementById('bas-dep-char')?.value;
  const char = (STATE.characters || []).find(c => c.id === charId);
  const sel = document.getElementById('bas-dep-item');
  if (!sel || !char) return;
  _depositGroups = _groupInventaire(char.inventaire);
  sel.innerHTML = _depositGroups.length
    ? _depositGroups.map((g, i) => `<option value="${i}">${_esc(g.item.nom || '?')} ×${g.totalQte}${g.item.rarete ? ` (${g.item.rarete})` : ''}</option>`).join('')
    : `<option value="">-- Inventaire vide --</option>`;
  window._bastionRefreshDepositMax();
};
window._bastionRefreshDepositMax = () => {
  const gi = parseInt(document.getElementById('bas-dep-item')?.value);
  const qte = document.getElementById('bas-dep-qte');
  const info = document.getElementById('bas-dep-info');
  if (!qte || isNaN(gi)) return;
  const group = _depositGroups[gi];
  if (!group) return;
  const maxQte = group.totalQte;
  qte.max = maxQte;
  qte.value = maxQte;
  if (info) info.textContent = `(stack disponible : ${maxQte})`;
};

window._bastionDoDeposit = async () => {
  const charId = document.getElementById('bas-dep-char')?.value;
  const char = (STATE.characters || []).find(c => c.id === charId);
  const gi = parseInt(document.getElementById('bas-dep-item')?.value);
  const qte = parseInt(document.getElementById('bas-dep-qte')?.value) || 0;
  if (!char || isNaN(gi) || qte <= 0) { showNotif('Sélection invalide.', 'error'); return; }
  const group = _depositGroups[gi];
  if (!group) { showNotif('Objet introuvable.', 'error'); return; }
  if (qte > group.totalQte) { showNotif('Quantité trop élevée.', 'error'); return; }

  const capacity = _bastionCapacity(_bastion);
  const used = _bastionInvCount(_bastion);
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
    await updateInCol('characters', char.id, { inventaire: inv });

    // 2. Ajoute au coffre du bastion (template du groupe en originalItem)
    const item = group.item;
    const b = { ..._bastion };
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
    _addHistorique(b, 'depot_item', `📥 ${_esc(char.nom || 'Un héros')} dépose ${qte}× ${_esc(item.nom || '?')}`);
    await _save(b);

    closeModal();
    showNotif(`✓ ${qte}× ${item.nom} déposé au coffre.`, 'success');
  } catch (e) { notifySaveError(e); }
};

window._bastionOpenWithdrawItem = (coffreId) => {
  const item = (_bastion?.coffre || []).find(c => c.id === coffreId);
  if (!item) return;
  const chars = _eligibleChars();
  if (!chars.length) { showNotif('Aucun personnage destinataire.', 'error'); return; }
  const defaultChar = chars.find(c => c.uid === STATE.user?.uid) || chars[0];

  openModal(`📤 Retirer : ${_esc(item.nom)} ×${item.quantite}`, `
    <div class="form-group">
      <label>Vers le personnage</label>
      <select class="input-field" id="bas-wd-char">
        ${chars.map(c => `<option value="${c.id}"${c.id === defaultChar.id ? ' selected' : ''}>${_esc(c.nom || '?')}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Quantité <span style="font-size:.72rem;color:var(--text-dim);font-weight:400;margin-left:.4rem">(stack : ${item.quantite})</span></label>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="number" class="input-field" id="bas-wd-qte" min="1" max="${item.quantite}" value="${item.quantite}" style="flex:1">
        <button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('bas-wd-qte').value='${item.quantite}'">Tout</button>
      </div>
    </div>
    <button class="btn btn-gold" style="width:100%" onclick="window._bastionDoWithdraw('${coffreId}')">📤 Retirer</button>
  `);
};

window._bastionDoWithdraw = async (coffreId) => {
  const charId = document.getElementById('bas-wd-char')?.value;
  const qte = parseInt(document.getElementById('bas-wd-qte')?.value) || 0;
  const char = (STATE.characters || []).find(c => c.id === charId);
  if (!char || qte <= 0) { showNotif('Sélection invalide.', 'error'); return; }

  const b = { ..._bastion };
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
    await updateInCol('characters', char.id, { inventaire: inv });

    _addHistorique(b, 'retrait_item', `📤 ${_esc(char.nom || 'Un héros')} retire ${qte}× ${_esc(coffreItem.nom || '?')}`);
    await _save(b);

    closeModal();
    showNotif(`✓ ${qte}× ${coffreItem.nom} récupéré.`, 'success');
  } catch (e) { notifySaveError(e); }
};

// ══════════════════════════════════════════════════════════════════════════════
// ACTIONS — Éditeur de salles (MJ uniquement)
// ══════════════════════════════════════════════════════════════════════════════
window._bastionOpenCatalogEditor = () => {
  if (!STATE.isAdmin) return;
  const cat = _getRoomCatalog(_bastion);
  openModal('✏️ Éditer les salles & activités', `
    <p style="font-size:.85rem;color:var(--text-soft);margin-bottom:.8rem">
      Personnalise chaque salle : nom, prix, durée, renommée, productions, bonus.
      Les modifications s'appliquent immédiatement à tous.
    </p>
    <div class="bs-edit-list">
      ${cat.map(def => `
        <div class="bs-edit-row" onclick="window._bastionEditRoom('${def.slug}')">
          <span class="bs-edit-emoji">${def.emoji}</span>
          <div class="bs-edit-info">
            <div class="bs-edit-name">${_esc(def.nom)}${def.isCustom ? ' <span class="bs-edit-tag">custom</span>' : ''}</div>
            <div class="bs-edit-desc">${_esc(def.desc)}</div>
          </div>
          <span class="bs-edit-arrow">✏️</span>
        </div>`).join('')}
    </div>
    <div class="bs-edit-actions" style="margin-top:14px;justify-content:center">
      <button class="btn btn-gold" onclick="window._bastionAddCustomRoom()">＋ Nouvelle salle custom</button>
    </div>
  `);
};

window._bastionAddCustomRoom = async () => {
  if (!STATE.isAdmin) return;
  const slug = `custom_${Date.now().toString(36)}`;
  const newRoom = {
    slug,
    nom: 'Nouvelle salle',
    emoji: '🏠',
    desc: 'À personnaliser.',
    color: '#7eb0ff',
    niveaux: [
      { cout: 200, semaines: 1, renommee: 0,  gainRenommee: 2, prod: { or: 0, items: [] }, bonus: '' },
      { cout: 500, semaines: 2, renommee: 20, gainRenommee: 4, prod: { or: 0, items: [] }, bonus: '' },
      { cout: 1500, semaines: 3, renommee: 50, gainRenommee: 6, prod: { or: 0, items: [] }, bonus: '' },
    ],
  };
  const b = { ..._bastion };
  b.customRooms = [...(b.customRooms || []), newRoom];
  await _save(b);
  closeModal();
  // Ouvre directement l'éditeur de la nouvelle salle pour personnalisation immédiate
  setTimeout(() => window._bastionEditRoom(slug), 200);
};

window._bastionDeleteCustomRoom = async (slug) => {
  if (!STATE.isAdmin) return;
  if (!slug.startsWith('custom_')) { showNotif('Seules les salles custom peuvent être supprimées.', 'error'); return; }
  const ok = await confirmModal('Supprimer définitivement cette salle custom ?\n\nSi elle est construite, l\'entrée dans b.salles persistera (sans effet).', {
    title: '🗑 Supprimer la salle', okLabel: 'Supprimer', cancelLabel: 'Annuler',
  }).catch(() => false);
  if (!ok) return;
  const b = { ..._bastion };
  b.customRooms = (b.customRooms || []).filter(r => r.slug !== slug);
  await _save(b);
  closeModal();
  showNotif('Salle supprimée.', 'success');
};

window._bastionEditRoom = async (slug) => {
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
  _editingItems = [0, 1, 2].map(i => {
    const items = def.niveaux[i]?.prod?.items || [];
    return items.map(it => ({ ...it }));
  });
  // Reset filtres du picker (catégorie + recherche) pour chaque ouverture
  [0, 1, 2].forEach(i => { _pickerFilters[i] = { cat: 'all', search: '' }; });

  const niveauForm = (i) => {
    const n = def.niveaux[i] || {};
    return `
      <details class="bs-edit-niv" ${i === 0 ? 'open' : ''}>
        <summary>Niveau ${NIVEAU_LABEL[i + 1]}</summary>
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
            <div class="loading-mini">Chargement de la boutique…</div>
          </div>
        </div>
        <label class="bs-edit-full">Bonus passif (texte libre)
          <textarea class="input-field" id="ed-bonus-${i}" rows="2">${_esc(n.bonus || '')}</textarea>
        </label>
      </details>`;
  };

  openModal(`✏️ ${def.emoji} ${def.nom} — édition`, `
    <div class="bs-edit-form">
      <div class="bs-edit-id-row">
        <label>Emoji<input type="text" class="input-field" id="ed-emoji" value="${_esc(def.emoji || '')}" maxlength="4" style="max-width:60px;text-align:center;font-size:1.2rem"></label>
        <label style="flex:1">Nom<input type="text" class="input-field" id="ed-nom" value="${_esc(def.nom || '')}"></label>
        <label>Couleur<input type="color" class="input-field" id="ed-color" value="${def.color || '#888'}" style="max-width:60px;padding:2px"></label>
      </div>
      <label class="bs-edit-full">Description<textarea class="input-field" id="ed-desc" rows="2">${_esc(def.desc || '')}</textarea></label>
      ${[0, 1, 2].map(niveauForm).join('')}
      <div class="bs-edit-actions">
        ${def.isCustom
          ? `<button class="btn btn-outline btn-sm" style="color:var(--crimson);border-color:rgba(255,90,126,0.40)" onclick="window._bastionDeleteCustomRoom('${slug}')">🗑 Supprimer</button>`
          : `<button class="btn btn-outline btn-sm" onclick="window._bastionResetRoom('${slug}')">↻ Restaurer défaut</button>`}
        <button class="btn btn-gold" onclick="window._bastionSaveRoom('${slug}')">Enregistrer</button>
      </div>
    </div>
  `);

  // Une fois le shop chargé, on rend les pickers (3 niveaux)
  await shopPromise;
  [0, 1, 2].forEach(_renderItemPicker);
};

// State temporaire de l'éditeur (cleared sur chaque ouverture)
let _editingItems = [[], [], []];

// État des filtres du picker, par niveau
const _pickerFilters = {}; // { [niveauIdx]: { cat, search } }

function _renderItemPicker(i) {
  const list = document.getElementById(`ed-items-list-${i}`);
  const picker = document.getElementById(`ed-items-picker-${i}`);
  if (!list || !picker) return;

  // Liste des items sélectionnés
  list.innerHTML = (_editingItems[i] || []).map((it, idx) => {
    const cat = it.shopItemId && _findShopItem(it.shopItemId)?.categorieId
      ? _findShopCat(_findShopItem(it.shopItemId).categorieId)
      : null;
    return `
    <div class="bs-item-row" data-idx="${idx}">
      <span class="bs-item-emoji">${_esc(it.emoji || '📦')}</span>
      <span class="bs-item-nom">${_esc(it.nom || '?')}${cat ? ` <span class="bs-item-cat">${_esc(cat.nom)}</span>` : ''}${it.shopItemId ? '' : ' <span class="bs-item-free">libre</span>'}</span>
      <input type="number" class="input-field bs-item-qty" value="${it.q || 1}" min="1"
        onchange="window._bastionEditItemQty(${i}, ${idx}, this.value)">
      <button class="bs-item-rm" onclick="window._bastionRemoveItem(${i}, ${idx})" title="Retirer">✕</button>
    </div>`;
  }).join('') || `<div class="bs-items-empty">Aucun item produit à ce niveau.</div>`;

  // Picker : items boutique disponibles
  const shop = _shopItemsCache || [];
  const cats = _shopCatsCache || [];
  if (!shop.length) {
    picker.innerHTML = `<div class="bs-items-empty">Aucun article dans la boutique. Crée des items dans la page Boutique pour les ajouter ici.</div>`;
    return;
  }

  // Init filtres
  if (!_pickerFilters[i]) _pickerFilters[i] = { cat: 'all', search: '' };
  const { cat: filterCat, search } = _pickerFilters[i];

  // Filtre les items selon catégorie + recherche
  let filtered = shop;
  if (filterCat && filterCat !== 'all') {
    if (filterCat === 'none') filtered = filtered.filter(s => !s.categorieId || !_findShopCat(s.categorieId));
    else filtered = filtered.filter(s => s.categorieId === filterCat);
  }
  const q = (search || '').toLowerCase().trim();
  if (q) filtered = filtered.filter(s => (s.nom || '').toLowerCase().includes(q));

  // Compte par catégorie (pour le sélecteur)
  const catCounts = { all: shop.length };
  cats.forEach(c => { catCounts[c.id] = shop.filter(s => s.categorieId === c.id).length; });
  const orphanCount = shop.filter(s => !s.categorieId || !_findShopCat(s.categorieId)).length;

  picker.innerHTML = `
    <div class="bs-pick-filters">
      <select class="input-field bs-pick-cat" id="ed-items-cat-${i}"
        onchange="window._bastionSetPickerCat(${i}, this.value)">
        <option value="all">Toutes les catégories (${catCounts.all})</option>
        ${cats.filter(c => catCounts[c.id] > 0).map(c => `<option value="${c.id}"${c.id === filterCat ? ' selected' : ''}>${_esc((c.emoji || '📂') + ' ' + (c.nom || '?'))} (${catCounts[c.id]})</option>`).join('')}
        ${orphanCount > 0 ? `<option value="none"${filterCat === 'none' ? ' selected' : ''}>📦 Sans catégorie (${orphanCount})</option>` : ''}
      </select>
      <input type="search" class="input-field bs-pick-search" id="ed-items-search-${i}"
        placeholder="🔍 Rechercher…" value="${_esc(search)}"
        oninput="window._bastionSetPickerSearch(${i}, this.value)">
    </div>
    <div class="bs-pick-row">
      <select class="input-field" id="ed-items-shop-${i}" style="flex:2;min-width:0">
        ${filtered.length
          ? `<option value="">— Sélectionner (${filtered.length} ${filtered.length > 1 ? 'résultats' : 'résultat'}) —</option>
             ${filtered.map(s => `<option value="${s.id}">${_esc((s.icone||s.emoji||'📦') + ' ' + (s.nom||'?'))}${s.prix ? ` (${s.prix}o)` : ''}</option>`).join('')}`
          : `<option value="">— Aucun résultat —</option>`}
      </select>
      <input type="number" class="input-field" id="ed-items-q-${i}" value="1" min="1" style="max-width:64px">
      <button type="button" class="btn btn-outline btn-sm" onclick="window._bastionAddShopItem(${i})">+ Ajouter</button>
    </div>
  `;
}

window._bastionSetPickerCat = (i, val) => {
  _pickerFilters[i] = { ...(_pickerFilters[i] || {}), cat: val };
  _renderItemPicker(i);
};
window._bastionSetPickerSearch = (i, val) => {
  // On garde le focus dans le champ : on ne re-render que le <select> des items
  _pickerFilters[i] = { ...(_pickerFilters[i] || {}), search: val };
  // Re-render limité au select pour ne pas perdre le focus du champ recherche
  const shop = _shopItemsCache || [];
  const { cat, search } = _pickerFilters[i];
  let filtered = shop;
  if (cat && cat !== 'all') {
    if (cat === 'none') filtered = filtered.filter(s => !s.categorieId || !_findShopCat(s.categorieId));
    else filtered = filtered.filter(s => s.categorieId === cat);
  }
  const q = (search || '').toLowerCase().trim();
  if (q) filtered = filtered.filter(s => (s.nom || '').toLowerCase().includes(q));
  const sel = document.getElementById(`ed-items-shop-${i}`);
  if (sel) {
    sel.innerHTML = filtered.length
      ? `<option value="">— Sélectionner (${filtered.length} ${filtered.length > 1 ? 'résultats' : 'résultat'}) —</option>
         ${filtered.map(s => `<option value="${s.id}">${_esc((s.icone||s.emoji||'📦') + ' ' + (s.nom||'?'))}${s.prix ? ` (${s.prix}o)` : ''}</option>`).join('')}`
      : `<option value="">— Aucun résultat —</option>`;
  }
};

window._bastionAddShopItem = (i) => {
  const id = document.getElementById(`ed-items-shop-${i}`)?.value;
  const q = parseInt(document.getElementById(`ed-items-q-${i}`)?.value) || 1;
  if (!id) { showNotif('Sélectionne un article.', 'error'); return; }
  const shopItem = _findShopItem(id);
  if (!shopItem) { showNotif('Article introuvable.', 'error'); return; }
  // Si déjà présent → cumul de la quantité
  const existing = _editingItems[i].find(it => it.shopItemId === id);
  if (existing) {
    existing.q = (parseInt(existing.q) || 1) + q;
  } else {
    _editingItems[i].push({
      shopItemId: id,
      nom: shopItem.nom || '?',
      emoji: shopItem.icone || shopItem.emoji || '📦',
      q,
    });
  }
  _renderItemPicker(i);
};

window._bastionRemoveItem = (i, idx) => {
  _editingItems[i].splice(idx, 1);
  _renderItemPicker(i);
};
window._bastionEditItemQty = (i, idx, val) => {
  const q = parseInt(val) || 1;
  if (_editingItems[i][idx]) _editingItems[i][idx].q = Math.max(1, q);
};

window._bastionSaveRoom = async (slug) => {
  if (!STATE.isAdmin) return;

  const override = {
    nom:   document.getElementById('ed-nom')?.value?.trim() || undefined,
    emoji: document.getElementById('ed-emoji')?.value?.trim() || undefined,
    color: document.getElementById('ed-color')?.value || undefined,
    desc:  document.getElementById('ed-desc')?.value?.trim() || undefined,
    niveaux: [0, 1, 2].map(i => {
      // Items proviennent du buffer _editingItems (alimenté par le picker shop)
      const items = (_editingItems[i] || []).map(it => ({
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
      return ov;
    }),
  };

  const b = { ..._bastion };
  // Salle custom : écrit dans b.customRooms ; salle de base : écrit dans catalogOverrides
  const isCustom = slug.startsWith('custom_');
  if (isCustom) {
    b.customRooms = (b.customRooms || []).map(r =>
      r.slug === slug ? { slug, ...override } : r
    );
  } else {
    b.catalogOverrides = { ...(b.catalogOverrides || {}) };
    b.catalogOverrides[slug] = override;
  }
  await _save(b);
  closeModal();
  showNotif('Salle mise à jour.', 'success');
};

window._bastionResetRoom = async (slug) => {
  if (!STATE.isAdmin) return;
  const ok = await confirmModal(`Restaurer « ${slug} » à ses valeurs par défaut ?`, {
    title: '↻ Restaurer défaut', okLabel: 'Restaurer', cancelLabel: 'Annuler',
  }).catch(() => false);
  if (!ok) return;
  const b = { ..._bastion };
  if (b.catalogOverrides?.[slug]) {
    delete b.catalogOverrides[slug];
    b.catalogOverrides = { ...b.catalogOverrides };
  }
  // Pour que le delete passe à travers le merge Firestore : on remet null
  // (le doc Firestore garde un champ null inoffensif)
  b.catalogOverrides[slug] = null;
  await _save(b);
  closeModal();
  showNotif('Restauré.', 'success');
};

// ══════════════════════════════════════════════════════════════════════════════
// ACTIONS — Personnel (employés du bastion)
// b.personnel = [{ id, nom, role, salaire, bonus, hiredAtWeek }]
// Les salaires sont débités du trésor à chaque "Passer la semaine".
// ══════════════════════════════════════════════════════════════════════════════
window._bastionOpenPersonnel = () => {
  const b = _bastion || _defaultBastion();
  const emp = b.personnel || [];
  const totalSalaires = emp.reduce((s, e) => s + (parseInt(e.salaire) || 0), 0);
  const npcs = _npcsCache || [];

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
            ? `<img src="${_esc(npc.imageUrl)}" style="width:100%;height:100%;object-fit:cover">`
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
            ${STATE.isAdmin ? `<button class="bs-emp-fire" onclick="window._bastionFireEmployee('${e.id}')" title="Renvoyer">✕</button>` : ''}
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
          ${STATE.isAdmin ? `<button class="bs-emp-fire" onclick="window._bastionFireEmployee('${e.id}')" title="Renvoyer">✕</button>` : ''}
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
};

// Cache partagé : PNJ chargés pour l'embauche ET pour l'affichage des portraits dans les salles
let _hireNpcsCache = null;
let _npcsCache = null;

async function _loadNpcs() {
  if (_npcsCache) return _npcsCache;
  _npcsCache = await loadCollection('npcs').catch(() => []);
  return _npcsCache;
}

window._bastionOpenHire = async (roomSlug) => {
  if (!STATE.isAdmin) return;
  if (!roomSlug) { showNotif('Aucune salle ciblée.', 'error'); return; }
  const def = _getRoomDef(roomSlug);
  if (!def) return;
  if (def.unlimited) { showNotif('L\'Entrepôt n\'accueille pas de personnel.', 'error'); return; }
  const curNiv = _roomNiveau(_bastion, roomSlug);
  if (curNiv <= 0) { showNotif('Construis cette salle d\'abord.', 'error'); return; }
  const assigned = (_bastion?.personnel || []).filter(e => e.roomSlug === roomSlug).length;
  if (assigned >= curNiv) { showNotif(`${def.nom} est plein (${assigned}/${curNiv}).`, 'error'); return; }

  // Charger PNJ
  const allNpcs = await _loadNpcs();
  _hireNpcsCache = allNpcs;
  // Filtres : Allié uniquement + activité matchant la salle + pas déjà embauché
  const hiredIds = new Set((_bastion?.personnel || []).map(e => e.npcId).filter(Boolean));
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
      ? `<img src="${_esc(n.imageUrl)}" class="bs-hire-card-img">`
      : `<span class="bs-hire-card-init">${(n.nom||'?')[0].toUpperCase()}</span>`;
    return `<div class="bs-hire-card" data-npc-id="${n.id}" onclick="window._bastionSelectHireCard('${n.id}')">
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
      onclick="window._bastionDoHire()" disabled>Sélectionne un allié</button>
  `);
};

window._bastionSelectHireCard = (npcId) => {
  document.querySelectorAll('.bs-hire-card').forEach(c => c.classList.toggle('selected', c.dataset.npcId === npcId));
  const hidden = document.getElementById('bs-hire-selected-npc');
  if (hidden) hidden.value = npcId;
  const btn = document.getElementById('bs-hire-submit');
  if (btn) {
    btn.disabled = false;
    const npc = (_hireNpcsCache || []).find(n => n.id === npcId);
    btn.textContent = npc ? `✓ Embaucher ${npc.nom}` : 'Embaucher';
  }
};

window._bastionDoHire = async () => {
  if (!STATE.isAdmin) return;
  const npcId    = document.getElementById('bs-hire-selected-npc')?.value;
  const roomSlug = document.getElementById('bs-hire-roomSlug')?.value || null;
  if (!npcId) { showNotif('Sélectionne un PNJ.', 'error'); return; }
  if (!roomSlug) { showNotif('Aucune salle ciblée.', 'error'); return; }
  const npc = (_hireNpcsCache || []).find(n => n.id === npcId);
  if (!npc) { showNotif('PNJ introuvable.', 'error'); return; }
  // Sécurité : revérifier slot libre + critères (race possible si plusieurs MJs)
  const def = _getRoomDef(roomSlug);
  const curNiv = _roomNiveau(_bastion, roomSlug);
  const assigned = (_bastion?.personnel || []).filter(e => e.roomSlug === roomSlug).length;
  if (assigned >= curNiv) { showNotif(`${def?.nom || 'Salle'} pleine.`, 'error'); return; }
  if (npc.disposition !== 'Allié') { showNotif(`${npc.nom} n'est pas un Allié.`, 'error'); return; }

  const b = { ..._bastion };
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
  _addHistorique(b, 'hire', `🤝 ${_esc(npc.nom)} rejoint ${_esc(def?.nom || 'le bastion')}`);
  await _save(b);
  closeModal();
  showNotif(`✓ ${npc.nom} affecté à ${def?.nom || 'la salle'}.`, 'success');
};

window._bastionFireEmployee = async (empId) => {
  if (!STATE.isAdmin) return;
  const emp = (_bastion?.personnel || []).find(e => e.id === empId);
  if (!emp) return;
  const ok = await confirmModal(`Renvoyer ${emp.nom} ?`, {
    title: 'Renvoyer un employé', okLabel: 'Renvoyer', cancelLabel: 'Annuler',
  }).catch(() => false);
  if (!ok) return;
  const b = { ..._bastion };
  b.personnel = (b.personnel || []).filter(e => e.id !== empId);
  _addHistorique(b, 'fire', `👋 ${_esc(emp.nom)} quitte le bastion`);
  await _save(b);
  closeModal();
  showNotif(`${emp.nom} a quitté le bastion.`, 'success');
};

window._bastionShowDetails = (slug) => {
  const def = _getRoomDef(slug);
  if (!def) return;
  const b = _bastion || _defaultBastion();
  const curNiv = _roomNiveau(b, slug);
  const buildingTarget = b?.salles?.[slug]?.targetNiveau || 0;

  // Mode unlimited (Entrepôt) → affichage compact
  if (def.unlimited) {
    const nextCost = Math.round((def.baseCost || 100) * Math.pow(def.costMultiplier || 1.1, curNiv));
    const nextCapacity = 20 + (curNiv + 1) * (def.capacitePerLevel || 10);
    openModal(`${def.emoji} ${def.nom} — détails`, `
      <div class="bs-det">
        <p class="bs-det-desc">${_esc(def.desc)}</p>
        <div class="bs-det-levels">
          <div class="bs-det-level bs-det-level--active">
            <div class="bs-det-level-head">
              <span class="bs-det-level-num">Niveau actuel</span>
              <span class="bs-det-level-state">Niv. ${curNiv} / ${def.maxLevel || 99}</span>
            </div>
            <div class="bs-det-level-cost">📦 Capacité actuelle : <strong>${_bastionCapacity(b)} objets</strong></div>
          </div>
          ${curNiv < (def.maxLevel || 99) ? `<div class="bs-det-level">
            <div class="bs-det-level-head">
              <span class="bs-det-level-num">Niveau suivant</span>
              <span class="bs-det-level-state">🔓 Niv. ${curNiv + 1}</span>
            </div>
            <div class="bs-det-level-cost">💰 ${nextCost} or · ⏱ ${def.baseSemaines || 1} période · +${def.capacitePerLevel || 10} capacité (→ ${nextCapacity} total)</div>
          </div>` : `<div class="bs-det-level bs-det-level--locked">
            <div class="bs-det-level-head">
              <span class="bs-det-level-num">Niveau max atteint</span>
              <span class="bs-det-level-state">🔒 Niv. ${def.maxLevel || 99}</span>
            </div>
          </div>`}
        </div>
      </div>
    `);
    return;
  }

  const niveauxHtml = def.niveaux.map((n, i) => {
    const niv = i + 1;
    const state = curNiv >= niv ? 'active' : (buildingTarget === niv ? 'building' : 'locked');
    const prodParts = [];
    if (n.prod.or > 0) prodParts.push(`<span class="bs-det-prod-or">+${n.prod.or} or</span>`);
    for (const item of (n.prod.items || [])) {
      prodParts.push(`<span class="bs-det-prod-item">${item.emoji} ${item.nom}${item.q > 1 ? ` ×${item.q}` : ''}</span>`);
    }
    const stateLabel = state === 'active' ? '✓ Active'
                     : state === 'building' ? '🏗 En construction'
                     : (curNiv >= niv - 1 ? '🔓 Prochaine étape' : '🔒 Verrouillée');
    return `
      <div class="bs-det-level bs-det-level--${state}">
        <div class="bs-det-level-head">
          <span class="bs-det-level-num">Niv. ${NIVEAU_LABEL[niv]}</span>
          <span class="bs-det-level-state">${stateLabel}</span>
        </div>
        <div class="bs-det-level-cost">
          💰 ${n.cout} or · ⏱ ${n.semaines} période
        </div>
        ${prodParts.length ? `<div class="bs-det-level-prod"><span class="bs-det-prod-lbl">Production/période :</span> ${prodParts.join(' · ')}</div>` : ''}
        ${n.bonus ? `<div class="bs-det-level-bonus"><span class="bs-det-bonus-lbl">🎁 Bonus :</span> ${_esc(n.bonus)}</div>` : ''}
      </div>`;
  }).join('');

  openModal(`${def.emoji} ${def.nom} — détails`, `
    <div class="bs-det">
      <p class="bs-det-desc">${_esc(def.desc)}</p>
      <div class="bs-det-levels">${niveauxHtml}</div>
    </div>
  `);
};

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT JSON — backup du bastion
// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// PRÉVISUALISATION MJ — projette l'état dans N semaines sans rien modifier
// ══════════════════════════════════════════════════════════════════════════════
window._bastionOpenPreview = () => {
  if (!STATE.isAdmin) return;
  openModal('🔮 Prévisualisation', `
    <p style="font-size:.85rem;color:var(--text-soft);margin-bottom:.7rem">
      Simule le passage de N semaines sans rien sauvegarder. Utile pour planifier la trésorerie.
    </p>
    <div class="form-group">
      <label>Nombre de périodes à projeter</label>
      <input type="number" class="input-field" id="bs-preview-n" value="4" min="1" max="52"
        oninput="window._bastionRunPreview()">
    </div>
    <div id="bs-preview-result"></div>
  `);
  window._bastionRunPreview();
};

window._bastionRunPreview = () => {
  const n = parseInt(document.getElementById('bs-preview-n')?.value) || 0;
  const out = document.getElementById('bs-preview-result');
  if (!out || !_bastion) return;
  if (n <= 0) { out.innerHTML = ''; return; }

  // Snapshot pur (deep copy) puis simulation sans écriture Firestore
  const b = JSON.parse(JSON.stringify(_bastion));
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
        <div><span class="bs-preview-ico">💰</span>${delta(finalOr, _bastion.or || 0, 'or')}</div>
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
};

window._bastionExportJSON = () => {
  if (!_bastion) { showNotif('Aucune donnée à exporter.', 'error'); return; }
  const payload = {
    type: 'le-grand-jdr.bastion',
    version: 1,
    exportedAt: new Date().toISOString(),
    bastion: _bastion,
  };
  const date = new Date().toISOString().slice(0, 10);
  const slug = (_bastion.nom || 'bastion')
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
};

window._bastionAdjustRessource = async (key, delta) => {
  if (!STATE.isAdmin) return;
  const b = { ..._bastion };
  b[key] = Math.max(0, (b[key] || 0) + delta);
  if (key === 'renommee' || key === 'influence') b[key] = Math.min(100, b[key]);
  // Pas de log : ajustements MJ silencieux
  await _save(b);
};

// ══════════════════════════════════════════════════════════════════════════════
// ACTIONS — Transfert d'or (verser / retirer) — joueurs & MJ
// ══════════════════════════════════════════════════════════════════════════════
// Renvoie la liste des personnages que l'utilisateur peut piloter pour transférer
// (MJ : tous · joueur : ses persos uniquement). Default = perso du joueur connecté.
function _eligibleChars() {
  const all = STATE.characters || [];
  if (STATE.isAdmin) return all;
  return all.filter(c => c.uid === STATE.user?.uid);
}

window._bastionOpenTransfer = (direction) => {
  // direction = 'deposit' | 'withdraw'
  const isDeposit = direction === 'deposit';
  const chars = _eligibleChars();
  if (!chars.length) { showNotif('Aucun personnage disponible.', 'error'); return; }

  // Sélection par défaut : perso du user, sinon premier
  const defaultChar = chars.find(c => c.uid === STATE.user?.uid) || chars[0];
  const bastionOr = _bastion?.or || 0;
  const titre = isDeposit ? '💰 Verser au Bastion' : '💸 Retirer du Trésor commun';
  const cta   = isDeposit ? 'Verser' : 'Retirer';
  const cls   = isDeposit ? 'btn-gold' : 'btn-outline';

  openModal(titre, `
    <div class="form-group">
      <label>Personnage</label>
      <select class="input-field" id="bas-tx-char" onchange="window._bastionRefreshTransfer('${direction}')">
        ${chars.map(c => `<option value="${c.id}"${c.id === defaultChar.id ? ' selected' : ''}>${_esc(c.nom || '?')}${c.uid === STATE.user?.uid ? ' (vous)' : ''}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Montant <span id="bas-tx-info" style="font-size:.74rem;color:var(--text-dim);font-weight:400;margin-left:.5rem"></span></label>
      <input type="number" class="input-field" id="bas-tx-montant" min="1" value="50">
    </div>
    <button class="btn ${cls}" style="width:100%" onclick="window._bastionDoTransfer('${direction}')">${cta}</button>
  `);
  // Init de l'info "Or disponible"
  window._bastionRefreshTransfer(direction);
};

window._bastionRefreshTransfer = (direction) => {
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
    const bastionOr = _bastion?.or || 0;
    info.textContent = `(trésor commun : ${bastionOr})`;
    input.max = bastionOr;
    if (parseInt(input.value) > bastionOr) input.value = bastionOr;
  }
};

window._bastionDoTransfer = async (direction) => {
  const isDeposit = direction === 'deposit';
  const charId = document.getElementById('bas-tx-char')?.value;
  const amount = parseInt(document.getElementById('bas-tx-montant')?.value) || 0;
  const char   = (STATE.characters || []).find(c => c.id === charId);
  if (!char) { showNotif('Personnage introuvable.', 'error'); return; }
  if (amount <= 0) { showNotif('Montant invalide.', 'error'); return; }

  const monOr = calcOr(char);
  const bastionOr = _bastion?.or || 0;
  if (isDeposit && amount > monOr) { showNotif(`${char.nom||'?'} n'a que ${monOr} or.`, 'error'); return; }
  if (!isDeposit && amount > bastionOr) { showNotif(`Le trésor n'a que ${bastionOr} or.`, 'error'); return; }

  try {
    // 1. Mouvement côté perso (via le module economy unifié)
    const reason = isDeposit ? 'Or versé au Bastion' : 'Or retiré du Bastion';
    const delta  = isDeposit ? -amount : +amount;
    const res = await useGold(char.id, delta, reason, { charObj: char });
    if (!res.ok) { showNotif(res.error || 'Erreur transaction', 'error'); return; }

    // 2. Mouvement côté bastion + historique
    const b = { ..._bastion };
    b.or = Math.max(0, (b.or || 0) + (isDeposit ? amount : -amount));
    const verb = isDeposit ? 'verse' : 'retire';
    const ico  = isDeposit ? '💰' : '💸';
    _addHistorique(b, isDeposit ? 'depot' : 'retrait', `${ico} ${char.nom || 'Un héros'} ${verb} ${amount} or${isDeposit ? ' au bastion' : ' du trésor'}`);
    await _save(b);

    closeModal();
    showNotif(`✓ ${amount} or ${isDeposit ? 'versés' : 'retirés'}.`, 'success');
  } catch (e) { notifySaveError(e); }
};

// ══════════════════════════════════════════════════════════════════════════════
// RENDU
// ══════════════════════════════════════════════════════════════════════════════
function _renderHeader(b) {
  const isMj = STATE.isAdmin;
  return `
    <div class="bs-hero">
      <div class="bs-hero-emoji">${_esc(b.emoji || '🏰')}</div>
      <div class="bs-hero-body">
        <div class="bs-hero-eyebrow">Période ${b.semaine || 1}${b.lieu ? ` · ${_esc(b.lieu)}` : ''}</div>
        <h1 class="bs-hero-title">${_esc(b.nom || 'Le Bastion')}</h1>
        ${b.description ? `<p class="bs-hero-desc">${_esc(b.description)}</p>` : ''}
      </div>
      <div class="bs-hero-actions">
        <button class="btn btn-outline btn-sm" onclick="window._bastionOpenPersonnel()">👥 Personnel${b.personnel?.length ? ` <span style="opacity:.7">(${b.personnel.length})</span>` : ''}</button>
        ${isMj ? `<button class="btn btn-outline btn-sm" onclick="window._bastionEditIdentite()">✏️ Identité</button>` : ''}
        ${isMj ? `<button class="btn btn-outline btn-sm" onclick="window._bastionOpenCatalogEditor()">🏛 Éditer salles</button>` : ''}
        ${isMj ? `<button class="btn btn-outline btn-sm" onclick="window._bastionOpenPreview()">🔮 Prévisualiser</button>` : ''}
        ${isMj ? `<button class="btn btn-outline btn-sm" onclick="window._bastionExportJSON()" title="Backup JSON du bastion">💾</button>` : ''}
        ${isMj ? `<button class="btn btn-gold" onclick="window._bastionAdvanceWeek()">▶ Passer la période</button>` : ''}
      </div>
    </div>`;
}

function _renderGauges(b) {
  const hasEligibleChar = _eligibleChars().length > 0;
  const bastionHasOr = (b.or || 0) > 0;

  return `
    <div class="bs-gauges">
      <div class="bs-gauge bs-gauge--or">
        <div class="bs-gauge-icon">💰</div>
        <div class="bs-gauge-info">
          <div class="bs-gauge-lbl">Trésor commun</div>
          <div class="bs-gauge-val">${b.or || 0} <span class="bs-gauge-unit">or</span></div>
        </div>
        <div class="bs-gauge-actions">
          ${hasEligibleChar ? `<button class="bs-gauge-btn" onclick="window._bastionOpenTransfer('deposit')">＋ Verser</button>` : ''}
          ${hasEligibleChar && bastionHasOr ? `<button class="bs-gauge-btn bs-gauge-btn--alt" onclick="window._bastionOpenTransfer('withdraw')">− Retirer</button>` : ''}
        </div>
      </div>
    </div>`;
}

function _renderRoomCard(def, b) {
  const isMj = STATE.isAdmin;
  const curNiv  = _roomNiveau(b, def.slug);
  const building = _roomBuilding(b, def.slug);
  const max = _maxLevel(def);
  const targetNiv = curNiv >= max ? null : curNiv + 1;
  const nextDef = targetNiv ? _getNiveauData(def, targetNiv) : null;
  const isUnlimited = !!def.unlimited;
  const supportsPersonnel = !isUnlimited; // Entrepôt n'a pas de PNJ assignable

  // Etat global de la carte
  const status = building ? 'building' : (curNiv > 0 ? 'active' : 'available');
  const orNotEnough = nextDef && (b.or || 0) < (nextDef.cout || 0);

  const sallesData = b.salles?.[def.slug];

  // Label de niveau (I/II/III pour normales, "1/2/.../99" pour unlimited)
  const niveauLabel = (n) => isUnlimited ? `${n}` : NIVEAU_LABEL[n];

  // Production actuelle (niveau actif)
  let prodHtml = '';
  let bonusHtml = '';
  if (curNiv > 0 && !building) {
    const niveauDef = _getNiveauData(def, curNiv) || {};
    const parts = [];
    if (niveauDef.prod?.or > 0) parts.push(`<span class="bs-prod-or">+${niveauDef.prod.or} or</span>`);
    for (const item of (niveauDef.prod?.items || [])) {
      parts.push(`<span class="bs-prod-item">${item.emoji} ${item.nom}${item.q > 1 ? ` ×${item.q}` : ''}</span>`);
    }
    if (parts.length) prodHtml = `<div class="bs-room-prod"><span class="bs-prod-lbl">Production / période :</span> ${parts.join(' · ')}</div>`;
    if (niveauDef.bonus) bonusHtml = `<div class="bs-room-bonus" title="Bonus passif au groupe">🎁 ${_esc(niveauDef.bonus)}</div>`;
  }

  // Personnel assigné à cette salle (slots = niveau)
  let personnelHtml = '';
  if (supportsPersonnel && curNiv > 0 && !building) {
    const assigned = (b.personnel || []).filter(e => e.roomSlug === def.slug);
    const slots = curNiv; // 1 PNJ par niveau
    const npcs = _hireNpcsCache || _npcsCache || [];
    const cards = assigned.map(e => {
      const npc = e.npcId ? npcs.find(n => n.id === e.npcId) : null;
      const portrait = npc?.imageUrl
        ? `<img src="${npc.imageUrl}" class="bs-emp-mini-img">`
        : `<span class="bs-emp-mini-init">${(e.nom || '?')[0].toUpperCase()}</span>`;
      return `<div class="bs-emp-mini" title="${_esc(e.bonus || 'Aucun passif renseigné')}">
        <div class="bs-emp-mini-av">${portrait}</div>
        <div class="bs-emp-mini-body">
          <div class="bs-emp-mini-name">${_esc(e.nom || '?')}</div>
          ${e.bonus ? `<div class="bs-emp-mini-bonus">🎁 ${_esc(e.bonus)}</div>` : `<div class="bs-emp-mini-role">${_esc(e.role || '')}</div>`}
        </div>
        ${isMj ? `<button class="bs-emp-mini-rm" onclick="window._bastionFireEmployee('${e.id}')" title="Renvoyer">✕</button>` : ''}
      </div>`;
    }).join('');
    const free = slots - assigned.length;
    const addBtn = (isMj && free > 0) ? `<button class="bs-emp-add" onclick="window._bastionOpenHire('${def.slug}')">＋ Embaucher (${free} slot${free > 1 ? 's' : ''} libre${free > 1 ? 's' : ''})</button>` : '';
    personnelHtml = `<div class="bs-room-personnel">
      <div class="bs-room-personnel-hd">👥 Personnel ${assigned.length}/${slots}</div>
      ${cards}
      ${addBtn}
    </div>`;
  }

  // Bandeau de construction en cours
  let buildingHtml = '';
  if (building && sallesData) {
    const totalSem = _getNiveauData(def, sallesData.targetNiveau)?.semaines || 1;
    const done = totalSem - sallesData.weeksLeftToBuild;
    const pct = totalSem > 0 ? Math.round((done / totalSem) * 100) : 0;
    buildingHtml = `<div class="bs-room-building">
      <div class="bs-room-building-lbl">🏗 Construction Niv. ${niveauLabel(sallesData.targetNiveau)} — ${sallesData.weeksLeftToBuild} période(s) restante(s)</div>
      <div class="bs-room-bar"><div class="bs-room-bar-fill" style="width:${pct}%;background:${def.color}"></div></div>
    </div>`;
  }

  // Bouton MJ pour construire / améliorer
  let actionHtml = '';
  if (isMj && !building && targetNiv) {
    const disabled = orNotEnough;
    const tooltip = orNotEnough ? `Or ${b.or||0}/${nextDef.cout} requis`
                  : `Construire niveau ${niveauLabel(targetNiv)} — ${nextDef.semaines} période, ${nextDef.cout} or`;
    actionHtml = `
      <button class="bs-room-action${disabled ? ' bs-room-action--disabled' : ''}"
        ${disabled ? '' : `onclick="window._bastionBuild('${def.slug}')"`}
        title="${_esc(tooltip)}">
        ${curNiv === 0 ? '＋ Construire' : `↑ Améliorer Niv. ${niveauLabel(targetNiv)}`}
        <span class="bs-room-cost">${nextDef.cout} or · ${nextDef.semaines} période</span>
      </button>`;
  } else if (isMj && curNiv >= max) {
    actionHtml = `<div class="bs-room-maxed">✦ Niveau maximum atteint</div>`;
  }

  // Affichage du niveau dans le header
  const nivDisplay = curNiv > 0
    ? `Niv. ${niveauLabel(curNiv)}${isUnlimited ? ` / ${max}` : ''}`
    : 'Non construite';

  return `
    <div class="bs-room bs-room--${status}" style="--c:${def.color}">
      <div class="bs-room-header">
        <span class="bs-room-emoji">${def.emoji}</span>
        <div class="bs-room-title">
          <div class="bs-room-name">${_esc(def.nom)}</div>
          <div class="bs-room-niv">${nivDisplay}${building ? ` · ${_roomTargetLabel(def.slug, b, isUnlimited)}` : ''}</div>
        </div>
        <div class="bs-room-actions-top">
          ${isMj && !isUnlimited ? `<button class="bs-room-edit" onclick="window._bastionEditRoom('${def.slug}')" title="Modifier cette salle">✏️</button>` : ''}
          <button class="bs-room-info" onclick="window._bastionShowDetails('${def.slug}')" title="Voir les niveaux et bonus">ⓘ</button>
        </div>
      </div>
      <div class="bs-room-desc">${_esc(def.desc)}</div>
      ${prodHtml}
      ${bonusHtml}
      ${personnelHtml}
      ${buildingHtml}
      ${actionHtml}
    </div>`;
}

function _renderRooms(b) {
  const isMj = STATE.isAdmin;
  const anyBuilt = Object.values(b.salles || {}).some(s => (s?.niveau || 0) > 0 || s?.weeksLeftToBuild > 0);
  return `
    <section class="bs-section">
      <div class="bs-section-hd">
        <h2 class="bs-section-title">🏛 Salles &amp; activités</h2>
        ${isMj && anyBuilt ? `<button class="btn btn-outline btn-sm bs-reset-btn"
          onclick="window._bastionResetRooms()" title="Réinitialiser toutes les salles construites">
          🔄 Reset salles
        </button>` : ''}
      </div>
      <p class="bs-section-sub">Chaque salle débloque une activité. Construis et améliore selon les priorités du groupe.</p>
      <div class="bs-rooms-grid">
        ${_getRoomCatalog(b).map(def => _renderRoomCard(def, b)).join('')}
      </div>
    </section>`;
}

window._bastionResetRooms = async () => {
  if (!STATE.isAdmin) return;
  const built = Object.entries(_bastion?.salles || {})
    .filter(([_, s]) => (s?.niveau || 0) > 0 || s?.weeksLeftToBuild > 0)
    .length;
  if (!built) { showNotif('Aucune salle à réinitialiser.', 'error'); return; }

  const empCount = (_bastion?.personnel || []).length;
  const detail = `Va effacer la construction de ${built} salle${built > 1 ? 's' : ''}.\n` +
    (empCount > 0 ? `\n⚠ Les ${empCount} employé${empCount > 1 ? 's' : ''} resteront en place mais deviendront « Non assignés ».\n` : '') +
    `\nLe coffre, l'or et la chronique sont conservés.`;

  const ok = await confirmModal(detail, {
    title: '🔄 Réinitialiser les salles',
    okLabel: 'Réinitialiser', cancelLabel: 'Annuler',
  }).catch(() => false);
  if (!ok) return;

  const b = { ..._bastion };
  b.salles = {};
  await _save(b);
  showNotif('Salles réinitialisées.', 'success');
};

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

let _coffreFilter = 'all';   // 'all'|'armes'|'armures'|'potions'|'scrolls'|'bijoux'|'ressources'|'autre'|'mine'
let _coffreSearch = '';

window._bastionSetCoffreFilter = (cat) => { _coffreFilter = cat; _renderPage(); };
window._bastionSetCoffreSearch = (val) => { _coffreSearch = (val || '').toLowerCase().trim(); _renderPage(); };

function _renderCoffre(b) {
  const coffre = (b.coffre || []);
  const capacity = _bastionCapacity(b);
  const used = _bastionInvCount(b);
  const pct = capacity > 0 ? Math.min(100, Math.round(used / capacity * 100)) : 0;
  const hasEligibleChar = _eligibleChars().length > 0;
  const isFull = used >= capacity;

  // Comptes par catégorie (utiles pour les pills)
  const counts = { all: coffre.length, armes:0, armures:0, potions:0, scrolls:0, bijoux:0, ressources:0, autre:0, mine:0 };
  const myCharNoms = new Set((STATE.characters || []).filter(c => c.uid === STATE.user?.uid).map(c => c.nom));
  coffre.forEach(it => {
    counts[_coffreItemCategory(it)]++;
    if (it.source && myCharNoms.size && [...myCharNoms].some(n => (it.source || '').includes(n))) counts.mine++;
  });

  // Header avec capacité + bouton Déposer
  const header = `
    <div class="bs-section-hd">
      <h2 class="bs-section-title">📦 Coffre commun <span class="bs-section-count">${used}/${capacity}</span></h2>
      ${hasEligibleChar ? `<button class="btn btn-outline btn-sm${isFull ? ' bs-btn-disabled' : ''}" ${isFull ? '' : 'onclick="window._bastionOpenDeposit()"'} title="${isFull ? 'Coffre plein — améliore l\'Entrepôt' : 'Déposer un objet'}">📥 Déposer</button>` : ''}
    </div>
    <div class="bs-capacity">
      <div class="bs-capacity-bar"><div class="bs-capacity-fill" style="width:${pct}%;background:${pct >= 90 ? '#ff5a7e' : pct >= 70 ? '#f4c430' : '#22c38e'}"></div></div>
      <div class="bs-capacity-lbl">${used} / ${capacity} objets ${isFull ? '— <strong>plein</strong>' : pct >= 90 ? '— presque plein' : ''}</div>
    </div>`;

  if (!coffre.length) {
    return `<section class="bs-section">${header}
      <div class="bs-coffre-empty">Le coffre est vide. Les productions des salles et les dépôts des joueurs apparaîtront ici.</div>
    </section>`;
  }

  // Barre de filtres
  const CATS = [
    ['all',        'Tout'],
    ['armes',      '⚔️ Armes'],
    ['armures',    '🛡 Armures'],
    ['potions',    '🧪 Potions'],
    ['scrolls',    '📜 Scrolls'],
    ['bijoux',     '💎 Bijoux'],
    ['ressources', '🪵 Ressources'],
    ['autre',      'Autre'],
    ['mine',       '🎒 Mes dépôts'],
  ];
  const filterBar = `
    <div class="bs-coffre-filters">
      <input type="search" class="bs-coffre-search" placeholder="🔍 Rechercher…"
        value="${_esc(_coffreSearch)}"
        oninput="window._bastionSetCoffreSearch(this.value)">
      <div class="bs-coffre-pills">
        ${CATS.filter(([k]) => counts[k] > 0).map(([k, label]) => `
          <button class="bs-coffre-pill${_coffreFilter === k ? ' active' : ''}"
            onclick="window._bastionSetCoffreFilter('${k}')">
            ${label} <span class="bs-coffre-pill-count">${counts[k]}</span>
          </button>`).join('')}
      </div>
    </div>`;

  // Appliquer filtres + recherche
  let filtered = coffre.slice();
  if (_coffreFilter && _coffreFilter !== 'all') {
    if (_coffreFilter === 'mine') {
      filtered = filtered.filter(it => myCharNoms.size && [...myCharNoms].some(n => (it.source || '').includes(n)));
    } else {
      filtered = filtered.filter(it => _coffreItemCategory(it) === _coffreFilter);
    }
  }
  if (_coffreSearch) {
    filtered = filtered.filter(it => (it.nom || '').toLowerCase().includes(_coffreSearch));
  }

  // Tri : plus récents d'abord
  filtered.sort((a, b) => (b.weekAdded || 0) - (a.weekAdded || 0));

  const itemsHtml = filtered.length
    ? filtered.map(item => `
        <div class="bs-coffre-item">
          <div class="bs-coffre-emoji">${_esc(item.emoji || '📦')}</div>
          <div class="bs-coffre-body">
            <div class="bs-coffre-name">${_esc(item.nom)}${item.quantite > 1 ? ` <span class="bs-coffre-qte">×${item.quantite}</span>` : ''}</div>
            <div class="bs-coffre-meta">${_esc(item.source || '')} · période ${item.weekAdded || '?'}</div>
          </div>
          ${hasEligibleChar ? `<button class="bs-coffre-withdraw" onclick="window._bastionOpenWithdrawItem('${item.id}')" title="Retirer">↩</button>` : ''}
        </div>`).join('')
    : `<div class="bs-coffre-empty">Aucun objet ne correspond aux filtres.</div>`;

  return `
    <section class="bs-section">${header}
      ${filterBar}
      <div class="bs-coffre">${itemsHtml}</div>
    </section>`;
}

let _histoExpanded = false;
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
};

window._bastionOpenQuestEditor = (questId) => {
  if (!STATE.isAdmin) return;
  const q = questId ? (_bastion?.bastionQuests || []).find(x => x.id === questId) : null;
  openModal(q ? '✏️ Modifier la quête' : '＋ Nouvelle quête du Bastion', `
    <div class="form-group"><label>Titre</label>
      <input class="input-field" id="bq-titre" value="${_esc(q?.titre || '')}" placeholder="ex: Récupérer le plan de la Forge supérieure"></div>
    <div class="form-group"><label>Description</label>
      <textarea class="input-field" id="bq-desc" rows="3" placeholder="Contexte, conditions, indices…">${_esc(q?.description || '')}</textarea></div>
    <div class="form-group"><label>Récompense</label>
      <input class="input-field" id="bq-recompense" value="${_esc(q?.recompense || '')}" placeholder="ex: +200 or, débloque le Niv. III Forge, +10 renommée"></div>
    <div class="form-group"><label>Statut</label>
      <select class="input-field" id="bq-statut">
        ${Object.entries(BQ_STATUTS).map(([k, v]) => `<option value="${k}"${(q?.statut || 'ouverte') === k ? ' selected' : ''}>${v.emoji} ${v.lbl}</option>`).join('')}
      </select>
    </div>
    <div style="display:flex;gap:.5rem">
      <button class="btn btn-gold" style="flex:1" onclick="window._bastionSaveQuest('${q?.id || ''}')">${q ? 'Enregistrer' : 'Créer'}</button>
      ${q ? `<button class="btn btn-outline btn-sm" style="color:var(--crimson);border-color:rgba(255,90,126,0.40)" onclick="window._bastionDeleteQuest('${q.id}')">🗑 Supprimer</button>` : ''}
    </div>
  `);
};

window._bastionSaveQuest = async (id) => {
  if (!STATE.isAdmin) return;
  const titre = document.getElementById('bq-titre')?.value?.trim();
  if (!titre) { showNotif('Le titre est requis.', 'error'); return; }
  const data = {
    id:          id || `bq_${Date.now().toString(36)}`,
    titre,
    description: document.getElementById('bq-desc')?.value?.trim() || '',
    recompense:  document.getElementById('bq-recompense')?.value?.trim() || '',
    statut:      document.getElementById('bq-statut')?.value || 'ouverte',
    createdAt:   id ? undefined : Date.now(),
  };
  const b = { ..._bastion };
  b.bastionQuests = [...(b.bastionQuests || [])];
  if (id) {
    const idx = b.bastionQuests.findIndex(q => q.id === id);
    if (idx >= 0) b.bastionQuests[idx] = { ...b.bastionQuests[idx], ...data };
  } else {
    b.bastionQuests.push(data);
    _addHistorique(b, 'quest', `📋 Nouvelle quête du Bastion : ${_esc(titre)}`);
  }
  await _save(b);
  closeModal();
  showNotif(id ? 'Quête mise à jour.' : 'Quête créée.', 'success');
};

window._bastionDeleteQuest = async (id) => {
  if (!STATE.isAdmin) return;
  const ok = await confirmModal('Supprimer cette quête définitivement ?', {
    title: '🗑 Supprimer la quête', okLabel: 'Supprimer', cancelLabel: 'Annuler',
  }).catch(() => false);
  if (!ok) return;
  const b = { ..._bastion };
  b.bastionQuests = (b.bastionQuests || []).filter(q => q.id !== id);
  await _save(b);
  closeModal();
  showNotif('Quête supprimée.', 'success');
};

function _renderBastionQuests(b) {
  const quests = (b.bastionQuests || []);
  const isMj = STATE.isAdmin;
  // Filtre : joueurs voient ouvertes + en_cours + terminée récente ; MJ voit tout
  const visible = isMj
    ? quests
    : quests.filter(q => ['ouverte', 'en_cours', 'terminee'].includes(q.statut || 'ouverte'));

  if (!visible.length && !isMj) return '';

  // Tri : ouvertes en premier, puis en_cours, puis terminées, puis échouées
  const order = { ouverte: 0, en_cours: 1, terminee: 2, echouee: 3 };
  const sorted = [...visible].sort((a, b) => (order[a.statut] ?? 0) - (order[b.statut] ?? 0));

  return `
    <section class="bs-section">
      <div class="bs-section-hd">
        <h2 class="bs-section-title">📋 Quêtes du Bastion <span class="bs-section-count">${visible.length}</span></h2>
        ${isMj ? `<button class="btn btn-gold btn-sm" onclick="window._bastionOpenQuestEditor()">＋ Nouvelle</button>` : ''}
      </div>
      ${visible.length ? `<div class="bs-quests-grid">
        ${sorted.map(q => {
          const st = BQ_STATUTS[q.statut || 'ouverte'];
          return `<div class="bs-quest bs-quest--${q.statut || 'ouverte'}" style="--c:${st.color}">
            <div class="bs-quest-hd">
              <div class="bs-quest-title">${_esc(q.titre || '?')}</div>
              <div class="bs-quest-statut">${st.emoji} ${st.lbl}</div>
            </div>
            ${q.description ? `<div class="bs-quest-desc">${_esc(q.description)}</div>` : ''}
            ${q.recompense ? `<div class="bs-quest-recompense">🎁 ${_esc(q.recompense)}</div>` : ''}
            ${isMj ? `<button class="bs-quest-edit" onclick="window._bastionOpenQuestEditor('${q.id}')">✏️ Modifier</button>` : ''}
          </div>`;
        }).join('')}
      </div>` : `<div class="bs-coffre-empty">Aucune quête pour l'instant. ${isMj ? 'Crée la première !' : 'Le MJ n\'a rien posté.'}</div>`}
    </section>`;
}

// Types d'entrées d'historique purement administratives — masqués du rendu
const _ADMIN_HISTO_TYPES = new Set(['mj_adjust', 'edit_catalog', 'reset']);
function _renderHistorique(b) {
  const all = (b.historique || []).filter(e => !_ADMIN_HISTO_TYPES.has(e.type));
  if (!all.length) return '';
  const COLLAPSED = 5;
  const expanded = _histoExpanded;
  const visible = expanded ? all : all.slice(0, COLLAPSED);
  const hidden = all.length - visible.length;

  return `
    <section class="bs-section">
      <div class="bs-section-hd">
        <h2 class="bs-section-title">📜 Chronique <span class="bs-section-count">${all.length}</span></h2>
        ${all.length > COLLAPSED ? `<button class="btn btn-outline btn-sm" onclick="window._bastionToggleHisto()">
          ${expanded ? '⤴ Replier' : `⤵ Tout afficher (+${hidden})`}
        </button>` : ''}
      </div>
      <div class="bs-histo${expanded ? ' bs-histo--scroll' : ''}">
        ${visible.map(e => `
          <div class="bs-histo-row bs-histo-row--${e.type}">
            <span class="bs-histo-week">P${e.week}</span>
            <span class="bs-histo-msg">${_esc(e.msg)}</span>
          </div>`).join('')}
      </div>
    </section>`;
}

window._bastionToggleHisto = () => {
  _histoExpanded = !_histoExpanded;
  _renderPage();
};

function _renderPage() {
  const content = document.getElementById('main-content');
  if (!content) return;
  const b = _bastion || _defaultBastion();
  content.innerHTML = `
    <div class="bs-root">
      ${_renderHeader(b)}
      ${_renderGauges(b)}
      ${_renderBastionQuests(b)}
      ${_renderRooms(b)}
      ${_renderCoffre(b)}
      ${_renderHistorique(b)}
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// POINT D'ENTRÉE
// ══════════════════════════════════════════════════════════════════════════════
async function renderBastionPage() {
  const content = document.getElementById('main-content');
  if (!content) return;
  content.innerHTML = appSplashHtml('Chargement du Bastion…');

  // 1ère lecture (bastion + shop + npcs en parallèle — pour snapshots & portraits)
  _shopItemsCache = null; _npcsCache = null; // reset au cas où on aurait changé d'aventure
  const [data] = await Promise.all([
    getDocData('bastion', 'main'),
    _loadShopItems(),
    _loadNpcs(),
  ]);
  _bastion = data || _defaultBastion();
  _renderPage();

  // Abonnement temps réel (idempotent)
  _attachListener();
}

PAGES.bastion = renderBastionPage;

// ── Exports legacy (pour ne pas casser pages.js ailleurs) ──────────────────
export const BASTION_EVENTS = [];
export function calculerRevenuBastion() {
  return { brut: 0, fondateurs: 0, base: 0, nbAmelios: 0, evt: { id: 'calme', nom: 'Calme', emoji: '☁️', description: '', badgeClass: 'badge-blue', badgeText: '±0', couleur: 'neutral', modificateur: 1, bonus: 0 } };
}
export function getDefaultBastion() { return _defaultBastion(); }

export default renderBastionPage;
