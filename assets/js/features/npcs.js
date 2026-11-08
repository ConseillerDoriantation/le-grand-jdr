// ══════════════════════════════════════════════════════════════════════════════
// NPCS.JS — PNJ & Affinités
// ✓ Fiches PNJ : nom, rôle, lieu, description, portrait reconnaissable
// ✓ Affinité groupe   : jauge (lecture) + modal événement (delta cumulé)
// ✓ Affinités spécifiques : emoji + couleur + label, créées par l'admin
//     → quick add inline dans la fiche
//     → gestionnaire intégré (ajout / modif dans la même modal)
// ✓ Firestore :
//     npcs/{id}                          → fiche PNJ + affinité groupe
//     npc_affinites/{id}                 → relation individuelle PNJ ↔ joueur
//     npc_affinites/npc_affinite_types   → types d'affinités {id,label,emoji,couleur}
//     npc_affinites/npc_affinite_seuils  → seuils valeur→niveau
// ══════════════════════════════════════════════════════════════════════════════
import { loadCollection, addToCol, updateInCol, deleteFromCol, saveDoc, batchSaveInCol } from '../data/firestore.js';
import { watchPageCollection } from '../shared/realtime.js';
import { openModal, closeModal, pushModal, popModal, updateModalContent, confirmModal } from '../shared/modal.js';
import { showNotif, notifySaveError } from '../shared/notifications.js';
import { STATE } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { isFeatureEnabled } from '../shared/features.js';
import PAGES from './pages.js';
import { _esc, _norm, _searchIncludes } from '../shared/html.js';
import { consumeTargetEntity } from '../shared/entity-navigation.js';
import { recordRecentNavigation } from '../shared/recent-navigation.js';
import { getItemStatBonus, sortCharactersForDisplay, getMyCharacters, getModFromScore,
  computeEquipStatsBonus, computeEquipDerivedBonus, formatItemBonusText,
  calcPVMax, calcPMMax, calcCA, calcVitesse, calcDeckMax } from '../shared/char-stats.js';
// Réutilisation DU moteur de sorts perso pour l'onglet Sorts des PNJ (rendu
// identique). Le moteur devient « hôte-agnostique » via setNpcSpellHost/clearSpellHost.
import { renderCharDeck as _renderSpellDeck, setNpcSpellHost, clearSpellHost } from './characters/spells.js';
// Actions de gestion du deck (définies dans forms.js) — enregistrées ici pour être
// disponibles sur la page PNJ même sans avoir ouvert de fiche perso.
import { toggleSort as _spellToggle, duplicateSort as _spellDuplicate, setSortValidation as _spellSetVal, deleteSort as _spellDelete } from './characters/forms.js';
import {
  buildEquippedItemFromInventory,
  getArmorSetData,
  getArmorSetChipText,
  getArmorTypeMeta,
  getMainWeapon,
  normalizeStatKey,
} from '../shared/equipment-utils.js';
import { getArmorTypeOptions } from '../shared/armor-set-settings.js';
import { loadWeaponFormats } from '../shared/weapon-formats.js';
import { resolveWeaponFamily } from '../shared/weapon-family.js';
import { loadDamageTypes } from '../shared/damage-types.js';
import { getDeckUsage } from '../shared/spell-deck.js';
import { loadRarities, getRarities, RARETE_NAMES, _rareteColor } from '../shared/rarity.js';
import { _getTraits } from './characters/data.js';
import { listPlaces } from './map/data/places.repo.js';
import { listOrganizations } from './map/data/organizations.repo.js';
import { pickImageFile, compressDataUrl } from '../shared/image-upload.js';
import { panZoomCropHTML, attachPanZoomCrop } from '../shared/image-crop.js';
import { confirmDelete, trySave } from '../shared/crud.js';
import { replaceHtmlPreservingView } from '../shared/view-context.js';
import { getRouteSub, setRouteSub } from '../shared/route.js';
import { lsJson } from '../shared/local-storage.js';
import { makeSortable } from '../shared/sortable-helper.js';

// ── Stats PNJ (admin) ────────────────────────────────────────────────────────
// Les vitales/caractéristiques saisies sont les valeurs DE BASE. Les objets
// équipés (n.equipement, même forme que les persos joueurs) ajoutent leurs
// bonus par-dessus, calculés via les helpers purs de char-stats.js. Un PNJ sans
// équipement affiche donc exactement ses valeurs de base (rétro-compat).
const NPC_VITALS = [
  { key: 'pv',      field: 'pvBase', label: 'PV',   icon: '❤️', editable: true },
  { key: 'pm',      field: 'pmBase', label: 'PM',   icon: '✨', editable: true },
  { key: 'ca',      label: 'CA',      icon: '🛡️' },
  { key: 'vitesse', label: 'Vit.',    icon: '👟' },
];
const NPC_STATS = [
  { key: 'force',        short: 'FOR' },
  { key: 'dexterite',    short: 'DEX' },
  { key: 'intelligence', short: 'INT' },
  { key: 'constitution', short: 'CON' },
  { key: 'sagesse',      short: 'SAG' },
  { key: 'charisme',     short: 'CHA' },
];
const NPC_STAT_LABELS = {
  force: 'Force',
  dexterite: 'Dexterite',
  constitution: 'Constitution',
  intelligence: 'Intelligence',
  sagesse: 'Sagesse',
  charisme: 'Charisme',
};
const NPC_BASE_STATS = Object.fromEntries(NPC_STATS.map(s => [s.key, 10]));
const NPC_BASE_VITALS = { pv: 20, pm: 0, ca: 10, vitesse: 6 };
const NPC_COMBAT_DEFAULT = { weaponName: '', damage: '', range: null };
const NPC_UI_ICON_PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="m3 3 18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  pin: '<path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  role: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  sword: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6M16 16l4 4M19 21l2-2"/>',
  sparkles: '<path d="m12 3 1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="m18.5 15.5.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  book: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  bastion: '<path d="M4 10V4h4v3h3V4h4v3h3V4h2v16H4z"/><path d="M8 20v-6h8v6M4 10h16"/>',
  tag: '<path d="M20 13 13 20 4 11V4h7z"/><circle cx="8.5" cy="8.5" r="1.5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
};
const _npcUiIcon = (name, className = '') => `<svg class="npc-rd-icon${className ? ` ${className}` : ''}" viewBox="0 0 24 24" aria-hidden="true">${NPC_UI_ICON_PATHS[name] || ''}</svg>`;
// `actions` est l'ancien stockage des capacités PNJ. Le nouvel onglet Sorts
// utilise `deck_sorts`, tout en gardant les anciennes actions lisibles tant
// qu'un PNJ n'a pas encore enregistré son deck au nouveau format.
const _npcSpellList = (n = {}) => Array.isArray(n.deck_sorts)
  ? n.deck_sorts
  : (Array.isArray(n.actions) ? n.actions : []);
// Emplacements d'équipement PNJ — identiques aux persos joueurs. `kind` pilote
// le filtrage des objets boutique éligibles au slot.
const NPC_EQUIP_SLOTS = [
  { slot: 'Main principale', icon: '⚔️', kind: 'weapon' },
  { slot: 'Main secondaire', icon: '🗡️', kind: 'weapon' },
  { slot: 'Tête',            icon: '🪖', kind: 'armor', armVal: 'Tête' },
  { slot: 'Torse',           icon: '🛡️', kind: 'armor', armVal: 'Torse' },
  { slot: 'Bottes',          icon: '🥾', kind: 'armor', armVal: 'Pieds' },
  { slot: 'Amulette',        icon: '📿', kind: 'bijou' },
  { slot: 'Anneau',          icon: '💍', kind: 'bijou' },
  { slot: 'Objet magique',   icon: '🔮', kind: 'bijou' },
];
const NPC_ACTIVITES = [
  ['forge', '🔨 Forge'], ['atelier_confection', '🧵 Confection'],
  ['atelier_orfevre', '💎 Orfèvre'], ['herboristerie', '🌿 Herboristerie'],
  ['taverne', '🍻 Taverne'], ['comptoir', '💰 Comptoir'],
  ['bibliotheque', '📜 Bibliothèque'], ['sanctuaire', '✨ Sanctuaire'],
  ['voliere', '🦅 Volière'],
];
const _actLabel = (slug) => (NPC_ACTIVITES.find(([s]) => s === slug) || [, slug])[1];

const _modStr = (v) => { const m = getModFromScore(Number(v) || 8); return m >= 0 ? `+${m}` : String(m); };
const _signedNum = (n) => n > 0 ? `+${n}` : String(n);
const _npcBaseStats = (n = {}) => ({ ...NPC_BASE_STATS, ...(n.stats || {}) });
const _npcBaseVital = (n = {}, key) => {
  const raw = key === 'pv' ? (n?.pvBase ?? n?.pv)
    : key === 'pm' ? (n?.pmBase ?? n?.pm)
      : n?.[key];
  const v = parseInt(raw, 10);
  return Number.isFinite(v) ? v : NPC_BASE_VITALS[key];
};
const _npcEffectiveStat = (n = {}, key) => {
  const base = parseInt(_npcBaseStats(n)[key], 10);
  const safeBase = Number.isFinite(base) ? base : 10;
  const bonus = computeEquipStatsBonus(n?.equipement || {})[key] || 0;
  return safeBase + bonus;
};
const _npcEffectiveMod = (n = {}, key) => getModFromScore(_npcEffectiveStat(n, key));
const _npcCalcEntity = (n = {}, equipement = n?.equipement || {}) => ({
  ...n,
  niveau: Math.max(1, parseInt(n?.niveau, 10) || 1),
  pvBase: _npcBaseVital(n, 'pv'),
  pmBase: _npcBaseVital(n, 'pm'),
  stats: _npcBaseStats(n),
  statsBonus: computeEquipStatsBonus(equipement),
  equipement,
});
const _npcVitalTotals = (n = {}) => {
  const { equip, sBonus, dBonus, caEquip, setData } = _npcEquipEffect(n);
  const totalEntity = _npcCalcEntity(n, equip);
  const nakedEntity = _npcCalcEntity(n, {});
  const totals = {
    pv: calcPVMax(totalEntity), pm: calcPMMax(totalEntity),
    ca: calcCA(totalEntity), vitesse: calcVitesse(totalEntity),
  };
  const withoutEquipment = {
    pv: calcPVMax(nakedEntity), pm: calcPMMax(nakedEntity),
    ca: calcCA(nakedEntity), vitesse: calcVitesse(nakedEntity),
  };
  const bases = { pv: _npcBaseVital(n, 'pv'), pm: _npcBaseVital(n, 'pm'), ca: withoutEquipment.ca, vitesse: withoutEquipment.vitesse };
  const equipBonus = Object.fromEntries(Object.keys(totals).map(key => [key, totals[key] - withoutEquipment[key]]));
  const levelBonus = { pv: withoutEquipment.pv - bases.pv, pm: withoutEquipment.pm - bases.pm, ca: 0, vitesse: 0 };
  return { equip, sBonus, dBonus, caEquip, setData, bases, levelBonus, equipBonus, totals };
};
const _npcWeaponInfo = (n = {}) => {
  const weapon = getMainWeapon({ equipement: n?.equipement || {} });
  const dmgStats = Array.isArray(weapon?.degatsStats) && weapon.degatsStats.length
    ? weapon.degatsStats
    : [weapon?.degatsStat || weapon?.statAttaque || 'force'];
  const touchStat = weapon?.toucherStats?.[0] || weapon?.toucherStat || weapon?.statAttaque || dmgStats[0] || 'force';
  const dmgMod = dmgStats.reduce((sum, key) => sum + _npcEffectiveMod(n, key), 0);
  const dmgDice = weapon?.degats || '2d4';
  const damage = `${dmgDice}${dmgMod ? _signedNum(dmgMod) : ''}`;
  return {
    weapon,
    damage,
    range: parseInt(weapon?.portee, 10) || 1,
    touch: _npcEffectiveMod(n, touchStat) + (getArmorSetData({ equipement: n?.equipement || {} }).modifiers?.toucherBonus || 0),
    dmgStatLabel: dmgStats.map(s => statShortNpc(s)).join('+'),
    touchStatLabel: statShortNpc(touchStat),
  };
};
const statShortNpc = (key) => (NPC_STATS.find(s => s.key === key)?.short || key || '').toUpperCase();
const _readNumberOrNull = (id) => {
  const raw = document.getElementById(id)?.value?.trim();
  if (!raw) return null;
  const v = parseInt(raw, 10);
  return Number.isFinite(v) ? v : null;
};
const _readText = (id) => document.getElementById(id)?.value?.trim() || '';
const _npcCombat = (npc) => ({ ...NPC_COMBAT_DEFAULT, ...(npc?.combat || {}) });
const _isShopWeapon = (item = {}) => item.template === 'arme' || item.degats;
const _weaponLabel = (item = {}) => [item.nom, item.sousType || item.typeArme].filter(Boolean).join(' · ');
const _weaponByLabel = (label) => _shopWeapons.find(w => _weaponLabel(w) === label) || null;
const _searchPart = (value) => {
  if (Array.isArray(value)) return value.map(_searchPart).join(' ');
  if (value && typeof value === 'object') return Object.values(value).map(_searchPart).join(' ');
  return value === null || value === undefined ? '' : String(value);
};
const _npcSearchText = (n = {}) => _norm([
  n.nom,
  n.role,
  n.lieu,
  n.organisations,
  n.description,
  n.combat?.weaponName,
  n.combat?.weapon,
  n.combat?.damage,
].map(_searchPart).join(' '));
const _npcMatchesSearch = (n, query) => _searchIncludes(_npcSearchText(n), query);
const _serializeShopWeapon = (item = {}) => ({
  itemId: item.id || item.itemId || '',
  nom: item.nom || '',
  degats: item.degats || '',
  degatsStat: item.degatsStat || item.statAttaque || '',
  degatsStats: Array.isArray(item.degatsStats) ? [...item.degatsStats] : (item.degatsStat ? [item.degatsStat] : []),
  toucherStat: item.toucherStat || item.statAttaque || '',
  statAttaque: item.statAttaque || item.toucherStat || '',
  typeArme: item.typeArme || item.sousType || '',
  sousType: item.sousType || '',
  mains: item.mains || '',
  portee: item.portee || '',
  traits: _getTraits(item),
  format: item.format || '',
  formatId: item.formatId || '',
  damageTypeId: item.damageTypeId || '',
  elementId: item.elementId || '',
  toucher: item.toucher || '',
  particularite: item.particularite || item.effet || '',
  stats: item.stats || '',
  fo: getItemStatBonus(item, 'force'),
  dex: getItemStatBonus(item, 'dexterite'),
  in: getItemStatBonus(item, 'intelligence'),
  sa: getItemStatBonus(item, 'sagesse'),
  co: getItemStatBonus(item, 'constitution'),
  ch: getItemStatBonus(item, 'charisme'),
});

// ── Affinité groupe — 5 niveaux fixes ────────────────────────────────────────
const AFFINITE = [
  { niveau: 0, label: "Hostile",  couleur: '#ff4757', bg: 'rgba(255,71,87,.12)',   border: 'rgba(255,71,87,.3)',   icon: '💢', desc: 'Cherche activement à nuire au groupe' },
  { niveau: 1, label: 'Méfiant',  couleur: '#ff9f43', bg: 'rgba(255,159,67,.1)',   border: 'rgba(255,159,67,.28)', icon: '👁️', desc: 'Prudent, peu coopératif' },
  { niveau: 2, label: 'Neutre',   couleur: '#a0aec0', bg: 'rgba(160,174,192,.08)', border: 'rgba(160,174,192,.22)',icon: '😐', desc: 'Ni ami ni ennemi' },
  { niveau: 3, label: 'Amical',   couleur: '#4f8cff', bg: 'rgba(79,140,255,.1)',   border: 'rgba(79,140,255,.28)', icon: '🤝', desc: 'Bienveillant, prêt à aider' },
  { niveau: 4, label: 'Allié',    couleur: '#22c38e', bg: 'rgba(34,195,142,.1)',   border: 'rgba(34,195,142,.28)', icon: '⚔️', desc: 'Loyal, combattra aux côtés du groupe' },
];

// ── Émojis et couleurs pour les affinités spécifiques ────────────────────────
const EMOJI_PRESET = [
  '🤝','❤️','🖤','💔','💘','🫂','🙏','🫡',
  '😊','😏','🤔','😐','🤨','😤','😒','😨','💢',
  '⚔️','🗡️','🛡️','☠️','🩸','👹',
  '😈','👑','🏆','🎖️','🪖','⚖️',
  '🔮','🧙','🧛','🧝','🧟','🪄','📜',
  '👁️','🧠','🤫','🗝️','🎪',
  '🌿','🌲','🌙','⛈️','❄️',
  '🐉','🦅','🐺','🐍',
  '🎭','🎲','📖','🧭','⛓️',
  '💎','🔥','⚡'
];

const TYPE_COLORS = ['#d63031','#e74c3c','#ff6b6b','#ff7675','#ff4757','#e84393','#fd79a8','#ff6f91','#ff9ff3',
  '#e17055','#ff9f43','#ffb142','#e8b84b','#fdcb6e','#ffeaa7','#f6e58d','#6ab04c','#2ecc71','#22c38e','#00b894',
  '#55efc4','#7bed9f','#00cec9','#0abde3','#81ecec','#48dbfb','#00a8ff','#4f8cff','#0984e3','#3742fa','#6c5ce7',
  '#9c88ff','#a29bfe','#b47fff','#8e44ad','#636e72','#2d3436'
];
const DEFAULT_AFFINITE_TYPE = {
  id: '__relation__', label: 'Relation', emoji: '🔗', couleur: '#4f8cff', builtin: true,
};
// Catalogue proposé à une aventure qui n'a encore jamais enregistré ses types.
// Dès que le MJ modifie ou supprime un type, le document existe (même vide) et
// devient la source de vérité : les valeurs par défaut ne réapparaissent donc pas.
const DEFAULT_AFFINITE_TYPES = [
  { id: 'aft_attache',      label: 'Attaché',      emoji: '❤️', couleur: '#e63946', order: 10 },
  { id: 'aft_confiance',    label: 'Confiance',    emoji: '🤝', couleur: '#2a6fdb', order: 20 },
  { id: 'aft_reconnaissant',label: 'Reconnaissant',emoji: '🙏', couleur: '#e9a23b', order: 30 },
  { id: 'aft_respecte',     label: 'Respecte',     emoji: '🫡', couleur: '#3d5a80', order: 40 },
  { id: 'aft_apprecie',     label: 'Apprécie',     emoji: '😊', couleur: '#7fb069', order: 50 },
  { id: 'aft_complice',     label: 'Complice',     emoji: '😏', couleur: '#9b5de5', order: 60 },
  { id: 'aft_admire',       label: 'Admire',       emoji: '✨', couleur: '#f4c430', order: 70 },
  { id: 'aft_epris',        label: 'Épris',        emoji: '💘', couleur: '#ff5da2', order: 80 },
  { id: 'aft_intrigue',     label: 'Intrigué',     emoji: '🤔', couleur: '#48cae4', order: 90 },
  { id: 'aft_neutre',       label: 'Neutre',       emoji: '😐', couleur: '#9aa0a6', order: 100 },
  { id: 'aft_mefiant',      label: 'Méfiant',      emoji: '🤨', couleur: '#b08968', order: 110 },
  { id: 'aft_decu',         label: 'Déçu',         emoji: '💔', couleur: '#6c7a89', order: 120 },
  { id: 'aft_rancune',      label: 'Rancune',      emoji: '😤', couleur: '#7b2d26', order: 130 },
  { id: 'aft_meprise',      label: 'Méprise',      emoji: '😒', couleur: '#5e4b56', order: 140 },
  { id: 'aft_craint',       label: 'Craint',       emoji: '😨', couleur: '#9d8df1', order: 150 },
  { id: 'aft_hostile',      label: 'Hostile',      emoji: '💢', couleur: '#c1121f', order: 160 },
];
const _sortAffiniteTypes = (types = []) => [...types].sort((a, b) => {
  const ao = Number(a?.order), bo = Number(b?.order);
  if (Number.isFinite(ao) || Number.isFinite(bo)) {
    if (!Number.isFinite(ao)) return 1;
    if (!Number.isFinite(bo)) return -1;
    if (ao !== bo) return ao - bo;
  }
  return (a?.label || '').localeCompare(b?.label || '', 'fr', { sensitivity: 'base' });
});
const _defaultAffiniteTypes = () => DEFAULT_AFFINITE_TYPES.map(type => ({ ...type }));
const AFFINITE_TYPE_PALETTE = ['#ff5a7e', '#ff4757', '#ff9544', '#f4c430', '#22c38e', '#34d399', '#7dd3fc', '#4f8cff', '#9d6fff', '#bca0ff', '#a0aec0'];

// Une fiche PNJ reste un document Firestore unique. La galerie est donc bornée
// et chaque variante est recompressée : plusieurs portraits ne doivent jamais
// faire approcher silencieusement la limite de 1 Mio du document.
const NPC_MAX_PORTRAITS = 6;
const NPC_PORTRAIT_BYTES = 36_000;
const NPC_PORTRAIT_FULL_BYTES = 55_000;

const afx = (n) => AFFINITE[Math.max(0, Math.min(4, n ?? 2))];
// Variables CSS inline pour les couleurs dynamiques d'affinité (consommées par npcs.css).
const _afVars = (af) => `--af:${af.couleur};--af-bg:${af.bg};--af-bd:${af.border}`;
const AFFINITE_TYPES_DOC_ID  = 'npc_affinite_types';
const AFFINITE_TYPES_DEFAULTS_VERSION = 1;
const AFFINITE_SEUILS_DOC_ID = 'npc_affinite_seuils';
const ORG_ICONS_DOC_ID       = 'npc_org_icons'; // { icons: { [orgName]: emoji } }

// Seuils par défaut (mode valeur) — chaque seuil = borne basse incluse du palier
const SEUILS_DEFAULT = { hostile: -50, mefiant: -10, neutre: 0, amical: 30, allie: 100 };
const SEUILS_KEYS    = ['hostile', 'mefiant', 'neutre', 'amical', 'allie'];

// ── État local ────────────────────────────────────────────────────────────────
let _npcs           = [];
let _affiPerso      = [];   // [{id, npcId, charId, charNom, typeId, typeLabel, note, notePublique}]
let _affiniteTypes  = [];   // [{id, label, emoji, couleur}]
let _affiniteSeuils = { ...SEUILS_DEFAULT };
// Dernier état d'affinité effectivement rendu. Firestore émet aussi nos propres
// écritures dans le listener temps réel : cette signature évite de reconstruire
// deux fois la fiche pour une seule interaction locale.
let _npcAffiRenderedSignature = '';
let _places        = [];   // [{ id, name }] — alimente l'autocomplete Lieu
let _organisations = [];   // [{ id, name }] — alimente la sélection Organisations
let _orgIcons      = {};   // { [orgName]: emoji } — émoji personnalisé par catégorie (MJ)
let _shopWeapons   = [];   // armes issues de la boutique pour l'espace combat PNJ
let _shopItems     = [];   // tous les objets boutique (armes/armures/bijoux) — équipement PNJ
let _weaponFormats = [];
let _damageTypes   = [];
let _rarities      = [];
let _relationCharacters = []; // cache characters pour retrouver les portraits côté joueur
let _playerProfiles = [];  // profils publics de la page Joueurs, utiles pour les portraits visibles côté joueur
let _activeId      = null;
let _pendingTargetNpcId = null;
let _filterSearch  = '';
let _activeOrgFilter = null;
let _listView      = 'org';  // 'org' | 'place' | 'az'
let _filterStatus  = '';     // ''=tous | 'mort' | 'disparu' | 'alive' (ni mort ni disparu)
let _filterHidden  = false;  // MJ : n'afficher que les PNJ cachés
let _filterIncomplete = false;
let _filterMine = false;
let _histEditDelta = 0;
let _npcPanel      = 'fiche';
let _npcSheetTab   = 'fiche';   // onglet actif conservé quand on change de PNJ
let _npcRelSel     = null;       // id du lien d'affinité sélectionné dans le Cercle des relations
let _npcLink       = { npcId: null, charId: null, charNom: '', typeId: null };  // sélection en cours dans le modal « Lier »
let _aftFormState = { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
let _npcView = 'mj';
let _npcPreviewUid = '';
let _npcExpressOpen = false;
let _npcExpressName = '';
let _npcCollapsedGroups = new Set(lsJson.get('npc:collapsed-groups', []));
let _npcCrossFilter = 'notables';
let _npcCrossSearch = '';
let _npcCrossSort = 'name';
let _npcCrossOpen = '';
const _npcExpandedHistories = new Set();
let _npcSavedFlashTimer = null;
let _npcHeaderObserver = null;
let _npcTabsResizeObserver = null;
let _affiniteDefaultsWritePending = false;
let _affiniteTypesSortable = null;

const NPC_ROUTE_SHEET_TABS = ['fiche', 'combat', 'sorts'];
const NPC_ROUTE_ALIASES = {
  dossier: 'fiche', relations: 'fiche', chronologie: 'fiche', tactique: 'combat',
};

function _npcRouteSub(id = _activeId, sheetTab = _npcSheetTab) {
  if (!id) return '';
  const safeTab = NPC_ROUTE_SHEET_TABS.includes(sheetTab) ? sheetTab : 'fiche';
  return `${id}/${safeTab}`;
}

function _applyNpcRoute(sub) {
  const parts = String(sub || '').split('/').filter(Boolean);
  const id = parts[0];
  if (!id || !_npcs.some(npc => npc.id === id)) return false;
  const requested = parts.length >= 3 ? parts[1] : (parts[1] || 'fiche');
  const sheetTab = NPC_ROUTE_ALIASES[requested] || requested;
  _activeId = id;
  _npcPanel = 'fiche';
  _npcSheetTab = NPC_ROUTE_SHEET_TABS.includes(sheetTab) ? sheetTab : 'fiche';
  _filterSearch = '';
  _filterStatus = '';
  _filterHidden = false;
  _filterIncomplete = false;
  _filterMine = false;
  _activeOrgFilter = null;
  return true;
}

function _syncNpcRoute({ replace = false } = {}) {
  setRouteSub('npcs', _npcRouteSub(), { replace });
}
let _equipPickerState = {
  npcId: '', slot: '', q: '', sort: 'name', filtersOpen: true,
  filters: { type: '', rarity: '', stat: '', damage: '', trait: '', feature: '', availability: '' },
};

// ── Chargement ────────────────────────────────────────────────────────────────
// `npcs` et `shop` sont session-live → 0 lecture facturée. `npc_affinites` est
// piloté entièrement par le watch plus bas (collection unique avec docs spéciaux
// types/seuils + relations PJ↔PNJ). `places` et `organizations` restent un fetch
// page-scoped (1 lecture initiale, servi du cache IndexedDB sur cache chaud).
async function _load() {
  const [npcs, places, orgs, shopItems, relationCharacters, playerProfiles, weaponFormats, damageTypes, rarities] = await Promise.all([
    loadCollection('npcs'),
    listPlaces().catch(() => []),
    listOrganizations().catch(() => []),
    loadCollection('shop').catch(() => []),
    loadCollection('characters').catch(() => []),
    loadCollection('players').catch(() => []),
    loadWeaponFormats().catch(() => []),
    loadDamageTypes().catch(() => []),
    loadRarities().catch(() => []),
  ]);
  _npcs           = npcs || [];
  _places        = (places || []).filter(p => p?.name).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  _organisations = (orgs   || []).filter(o => o?.name).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  _shopItems     = (shopItems || []).slice().sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr'));
  _shopWeapons   = _shopItems.filter(_isShopWeapon);
  _relationCharacters = relationCharacters || [];
  _playerProfiles = playerProfiles || [];
  _weaponFormats = weaponFormats || [];
  _damageTypes = damageTypes || [];
  _rarities = rarities?.length ? rarities : getRarities();
}

// ── Helpers types ─────────────────────────────────────────────────────────────
const _affiniteTypeChoices  = () => [
  DEFAULT_AFFINITE_TYPE,
  ..._affiniteTypes.filter(t => t?.id && t.id !== DEFAULT_AFFINITE_TYPE.id),
];
const _getAffiniteType      = (id) => _affiniteTypeChoices().find(t => t.id === id) || null;
const _getAffiniteTypeLabel = (id, fb = '') => _getAffiniteType(id)?.label   || fb || '';
const _getAffiniteTypeColor = (id) => _getAffiniteType(id)?.couleur || TYPE_COLORS[0];
const _getAffiniteTypeEmoji = (id) => _getAffiniteType(id)?.emoji   || '✨';
const _decodeHtmlEntities = (v = '') => String(v)
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n) || 0))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16) || 0))
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');
const _displayText = (v = '') => _decodeHtmlEntities(v).trim();
// Vue résumée pour les chips d'affinité spécifique. Le label reste brut ici :
// l'échappement HTML se fait uniquement au rendu final pour éviter les doubles entités.
const _typeView = (a) => ({
  emoji: _getAffiniteTypeEmoji(a.typeId),
  color: _getAffiniteTypeColor(a.typeId),
  label: _displayText(_getAffiniteTypeLabel(a.typeId, a.typeLabel)) || '—',
});

// ── Helpers affinité (mode groupe vs valeur) ─────────────────────────────────
// En mode "valeur", le niveau est dérivé de la valeur cumulée et des seuils.
const _niveauFromValeur = (v, s = _affiniteSeuils) => {
  const x = Number(v) || 0;
  if (x >= (s.allie   ?? SEUILS_DEFAULT.allie))   return 4;
  if (x >= (s.amical  ?? SEUILS_DEFAULT.amical))  return 3;
  if (x >= (s.neutre  ?? SEUILS_DEFAULT.neutre))  return 2;
  if (x >= (s.mefiant ?? SEUILS_DEFAULT.mefiant)) return 1;
  return 0;
};
const _affiniteNiveau = (n) => {
  const a = n?.affinite || {};
  return a.mode === 'valeur' ? _niveauFromValeur(a.valeur) : (a.niveau ?? 2);
};
const _affiniteMode = (n) => n?.affinite?.mode === 'valeur' ? 'valeur' : 'groupe';

const NPC_SENT_TO_LEVEL = { ennemi: 0, mefiance: 1, neutre: 2, allie: 3, lien: 4 };
const NPC_LEVEL_TO_SENT = ['ennemi', 'mefiance', 'neutre', 'allie', 'lien'];
const NPC_LEVEL_LABELS = ['Hostile', 'Méfiant', 'Neutre', 'Amical', 'Allié'];

function _npcCharacterOwnerUid(c = {}) {
  return c.uid || c.ownerUid || c.userId || c.ownerId || '';
}

function _npcMyCharacters() {
  const uid = STATE.isAdmin && _npcView === 'player'
    ? (_npcPreviewUid || _npcCharacterOwnerUid(_npcLinkableCharacters()[0]))
    : STATE.user?.uid;
  return uid ? getMyCharacters(_npcLinkableCharacters(), uid) : [];
}

function _npcPlayerChoices() {
  const byUid = new Map();
  _npcLinkableCharacters().forEach(c => {
    const uid = _npcCharacterOwnerUid(c);
    if (!uid || byUid.has(uid)) return;
    const profile = _playerProfiles.find(p => (p.uid || p.userId || p.id) === uid);
    byUid.set(uid, profile?.pseudo || profile?.displayName || c.ownerPseudo || c.ownerName || c.joueur || 'Joueur');
  });
  return [...byUid.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
}

function _npcExceptionFor(npcId, charId) {
  return _affiPerso.find(a => a.npcId === npcId && a.charId === charId) || null;
}

function _npcFeelingFor(npcId, character) {
  return (character?.relations || []).find(r => r?.npcId === npcId) || null;
}

function _npcExceptionLevel(n, exception, { player = false } = {}) {
  if (!exception || (player && exception.secret)) return null;
  const raw = exception.niveau;
  return raw === null || raw === undefined || raw === ''
    ? null
    : Math.max(0, Math.min(4, parseInt(raw, 10)));
}

function _npcCombatUntouched(n = {}) {
  const stats = _npcBaseStats(n);
  return Math.max(1, parseInt(n.niveau, 10) || 1) === 1
    && NPC_STATS.every(s => Number(stats[s.key] ?? 10) === 10)
    && !Object.keys(n.equipement || {}).length
    && !_npcSpellList(n).length;
}

function _npcMissing(n = {}) {
  const items = [];
  if (!(n.description || '').trim()) items.push('Description');
  if (!(n.lieu || '').trim() && !(n.organisations || []).filter(Boolean).length) items.push('Lieu ou organisation');
  if (_npcCombatUntouched(n)) items.push('Combat');
  return items;
}

function _npcIsPlayerView() {
  return !STATE.isAdmin || _npcView === 'player';
}

function _npcFlashSaved() {
  const el = document.getElementById('npc-rd-saved');
  if (!el) return;
  el.classList.add('is-on');
  clearTimeout(_npcSavedFlashTimer);
  _npcSavedFlashTimer = setTimeout(() => el.classList.remove('is-on'), 1500);
}

function _npcAffiUiSignature() {
  const links = _affiPerso.map(link => [
    link.id || '', link.npcId || '', link.charId || '', link.niveau ?? null,
    !!link.secret, link.typeId || '', link.typeLabel || '',
    link.notePublique || '', link.note || '',
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const types = _affiniteTypes.map(type => [
    type.id || '', type.label || '', type.emoji || '', type.couleur || '', Number(type.order) || 0,
  ]);
  const thresholds = SEUILS_KEYS.map(key => [key, Number(_affiniteSeuils[key]) || 0]);
  const icons = Object.entries(_orgIcons || {}).sort(([a], [b]) => a.localeCompare(b, 'fr'));
  return JSON.stringify({ links, types, thresholds, icons });
}

function _bindNpcStickyIdentity() {
  _npcHeaderObserver?.disconnect();
  _npcTabsResizeObserver?.disconnect();
  const header = document.querySelector('.npc-rd-sheethead');
  const tabs = document.querySelector('.npc-rd-tabs');
  const sheet = tabs?.closest('.npc-rd-sheet');
  const detail = tabs?.closest('.npc-rd-detail');
  if (!header || !tabs || !sheet || !detail || typeof IntersectionObserver !== 'function') return;
  const syncGeometry = () => {
    const rect = detail.getBoundingClientRect();
    tabs.style.setProperty('--npc-tabs-left', `${Math.max(0, rect.left)}px`);
    tabs.style.setProperty('--npc-tabs-width', `${Math.max(0, rect.width)}px`);
  };
  syncGeometry();
  if (typeof ResizeObserver === 'function') {
    _npcTabsResizeObserver = new ResizeObserver(syncGeometry);
    _npcTabsResizeObserver.observe(detail);
  }
  _npcHeaderObserver = new IntersectionObserver(([entry]) => {
    const fixed = !entry.isIntersecting && entry.boundingClientRect.bottom <= 0;
    if (fixed) syncGeometry();
    tabs.classList.toggle('is-condensed', fixed);
    tabs.classList.toggle('is-fixed', fixed);
    sheet.classList.toggle('has-fixed-tabs', fixed);
  }, { threshold: 0 });
  _npcHeaderObserver.observe(header);
}

function _npcHighlight(text = '') {
  const safe = _esc(text);
  const q = (_filterSearch || '').trim();
  if (!q) return safe;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(`(${escaped})`, 'ig'), '<mark>$1</mark>');
}

// ── Delta picker (partagé entre modal événement et édition d'historique) ─────
const _DELTA_PRESETS = [-2, -1, 0, 1, 2];
const _deltaActiveBg = (v) => v < 0 ? 'rgba(255,107,107,.18)' : v > 0 ? 'rgba(34,195,142,.18)' : 'rgba(255,255,255,.1)';
const _deltaBorderColor = (v) => v < 0 ? 'rgba(255,107,107,.3)' : v > 0 ? 'rgba(34,195,142,.3)' : 'var(--border)';
const _deltaTextColor = (v) => v < 0 ? '#ff6b6b' : v > 0 ? '#22c38e' : 'var(--text-dim)';

// Rend les boutons -2/-1/0/+1/+2. `current` = preset déjà actif (ou null).
// `actionName` = nom de l'action data-action à déclencher avec data-val="${v}".
function _deltaPresetsHtml(idPrefix, current, actionName, { size = 32 } = {}) {
  return _DELTA_PRESETS.map(v => {
    const active = v === current;
    return `<button type="button" id="${idPrefix}-${v}"
      data-action="${actionName}" data-val="${v}"
      style="width:${size}px;height:${size}px;border-radius:8px;cursor:pointer;font-size:.8rem;
      font-weight:700;transition:all .12s;
      border:${active ? '2px' : '1px'} solid ${_deltaBorderColor(v)};
      background:${active ? _deltaActiveBg(v) : 'var(--bg-elevated)'};
      color:${_deltaTextColor(v)}">${v > 0 ? '+' + v : v}</button>`;
  }).join('');
}

// Met à jour visuellement le preset actif après changement.
function _highlightDeltaPreset(idPrefix, v) {
  _DELTA_PRESETS.forEach(d => {
    const btn = document.getElementById(`${idPrefix}-${d}`);
    if (!btn) return;
    const active = d === v;
    btn.style.background  = active ? _deltaActiveBg(d) : 'var(--bg-elevated)';
    btn.style.borderWidth = active ? '2px' : '1px';
  });
}

// Persiste { affinite } sur un PNJ + met à jour le cache local + UI.
async function _persistAffinite(npcId, affinite, msg, { close = true } = {}) {
  if (!await trySave('npcs', npcId, { affinite })) return;
  const idx = _npcs.findIndex(x => x.id === npcId);
  if (idx >= 0) _npcs[idx] = { ..._npcs[idx], affinite };
  if (close) closeModal();
  showNotif(msg, 'success');
  _refreshActivePanel();
  _refreshList();
}

// En mode 'valeur', applique un changement de valeur cumulée et recalcule le niveau.
// `deltaChange` = différence à appliquer (suppression: -delta, édition: nouv-anc).
function _withValeurDelta(n, baseAffinite, deltaChange) {
  if (_affiniteMode(n) !== 'valeur' || !deltaChange) return baseAffinite;
  const valeur = (Number(n.affinite?.valeur) || 0) + deltaChange;
  return { ...baseAffinite, valeur, niveau: _niveauFromValeur(valeur) };
}

// ── Rendu principal ───────────────────────────────────────────────────────────
export async function renderNpcs() {
  const content = document.getElementById('main-content');
  // Pas de loader propre ici : la navigation affiche déjà le splash pleine page
  // (cf. _renderLoading dans navigation.js). En ajouter un second = flash splash→
  // spinner disgracieux. Le splash reste visible pendant _load, puis _renderPage.
  await _load();
  _npcView = STATE.isAdmin ? (_npcView === 'player' ? 'player' : 'mj') : 'player';
  if (!_npcPreviewUid) _npcPreviewUid = STATE.user?.uid || _npcPlayerChoices()[0]?.[0] || '';
  const target = consumeTargetEntity('npc');
  const targetId = target?.id || '';
  _pendingTargetNpcId = target?.id || _pendingTargetNpcId;
  if (_pendingTargetNpcId && _npcs.some(n => n.id === _pendingTargetNpcId)) {
    _activeId = _pendingTargetNpcId;
    _filterSearch = '';
    _filterStatus = '';
    _filterHidden = false;
    _activeOrgFilter = null;
    _pendingTargetNpcId = null;
  }
  if (!targetId) _applyNpcRoute(getRouteSub('npcs'));
  if (!_npcs.some(npc => npc.id === _activeId)) _activeId = _npcs[0]?.id || null;
  _syncNpcRoute({ replace: true });
  _renderPage(content);
  _npcAffiRenderedSignature = _npcAffiUiSignature();
  _bindCharPickOutside();

  // ── Abonnements temps réel ─────────────────────────────────────────────
  // Pour `npcs` (session-live) le watch ne refait aucune lecture facturée.
  // Pour `npc_affinites` (page-scoped), le watch sert aussi de fetch initial
  // → pas de double-read.
  watchPageCollection('npcs-list', 'npcs', 'npcs', data => {
    _npcs = data;
    if (_pendingTargetNpcId && _npcs.some(n => n.id === _pendingTargetNpcId)) {
      _activeId = _pendingTargetNpcId;
      _filterSearch = '';
      _filterStatus = '';
      _filterHidden = false;
      _activeOrgFilter = null;
      _pendingTargetNpcId = null;
      _syncNpcRoute({ replace: true });
    }
    _refreshList({ keepScroll: true });
    _refreshActivePanel();
  });

  // Une seule subscription pour la collection npc_affinites : on y range
  // les relations PNJ↔joueur + les 2 docs spéciaux (types, seuils).
  watchPageCollection('npcs-affi', 'npc_affinites', 'npcs', data => {
    _affiPerso = data.filter(a => a.id !== AFFINITE_TYPES_DOC_ID && a.id !== AFFINITE_SEUILS_DOC_ID && a.id !== ORG_ICONS_DOC_ID);
    const typesDoc  = data.find(a => a.id === AFFINITE_TYPES_DOC_ID);
    const seuilsDoc = data.find(a => a.id === AFFINITE_SEUILS_DOC_ID);
    _orgIcons = data.find(a => a.id === ORG_ICONS_DOC_ID)?.icons || {};
    const storedTypes = Array.isArray(typesDoc?.types) ? typesDoc.types.map(type => ({ ...type })) : null;
    const needsDefaultMigration = !!typesDoc
      && Number(typesDoc.defaultsVersion || 0) < AFFINITE_TYPES_DEFAULTS_VERSION;
    if (needsDefaultMigration) {
      // Migration unique des aventures qui avaient déjà leur propre catalogue :
      // on ajoute seulement les libellés manquants. Le marqueur de version évite
      // qu'un type supprimé volontairement ne revienne ensuite.
      const merged = [...(storedTypes || [])];
      const labels = new Set(merged.map(type => _norm(type.label || '')));
      _defaultAffiniteTypes().forEach(type => {
        if (!labels.has(_norm(type.label))) merged.push(type);
      });
      _affiniteTypes = _sortAffiniteTypes(merged);
      if (STATE.isAdmin && !_affiniteDefaultsWritePending) {
        _affiniteDefaultsWritePending = true;
        saveDoc('npc_affinites', AFFINITE_TYPES_DOC_ID, {
          types: _affiniteTypes,
          defaultsVersion: AFFINITE_TYPES_DEFAULTS_VERSION,
        }).catch(error => console.error('[npcs] initialisation des types de relation', error))
          .finally(() => { _affiniteDefaultsWritePending = false; });
      }
    } else {
      // Document absent = première utilisation. Un document versionné avec un
      // tableau vide signifie au contraire que le MJ a tout supprimé.
      _affiniteTypes = _sortAffiniteTypes(storedTypes ?? _defaultAffiniteTypes());
    }
    _affiniteSeuils = { ...SEUILS_DEFAULT, ...(seuilsDoc || {}) };
    _refreshNpcAffiUi({ list: true });
  });
}

function _renderPage(content) {
  const filtered = _getFiltered();
  const selected = _npcs.find(n => n.id === _activeId) || null;
  const active   = (_npcIsPlayerView() && selected?.embauchable === false ? null : selected) || filtered[0] || null;
  if (active && active.id !== _activeId) _activeId = active.id;

  content.innerHTML = _renderNpcsShell(filtered, active);
  _bindNpcListScroll();
  _scheduleNpcListScrollHint();
  _bindNpcStickyIdentity();
  return;

  content.innerHTML = `
  <div class="npc-page">

    <!-- ═══ SIDEBAR ═════════════════════════════════════════════════════ -->
    <aside class="npc-sidebar">
      <div class="npc-side-card">
        <div class="npc-side-head">
          <div>
            <div class="npc-side-title">👥 PNJ</div>
            <div class="npc-side-sub">${_npcs.length} personnage${_npcs.length > 1 ? 's' : ''}</div>
          </div>
          ${STATE.isAdmin ? `<button class="npc-btn-icon" data-action="npcCreate" title="Nouveau PNJ">+</button>` : ''}
        </div>

        <input id="npc-search" class="input-field" placeholder="🔍 Rechercher…"
          value="${_filterSearch}" data-input="_npcSearch" style="font-size:.8rem;padding:.4rem .6rem">

        ${STATE.isAdmin ? `
        <button class="npc-mj-btn" data-action="_openMjStatsView"
          title="Toutes les stats des PNJ en un coup d'œil — PV/PM ajustables">
          📊 Stats en un coup d'œil
        </button>` : ''}
      </div>

      <div id="npc-list-shell" class="npc-list-shell">
        <div id="npc-list-items" class="npc-list-items">
          ${_buildListHtml(filtered)}
        </div>
      </div>
    </aside>

    <!-- ═══ FICHE PRINCIPALE ═════════════════════════════════════════════ -->
    <div id="npc-detail-panel">
      ${active ? _renderFiche(active) : _renderEmpty()}
    </div>
  </div>`;
  _bindNpcListScroll();
  _scheduleNpcListScrollHint();
}

function _renderNpcsShell(filtered, active) {
  const playerChoices = _npcPlayerChoices();
  const playerMode = _npcIsPlayerView();
  return `
  <div class="npc-rd-page${playerMode ? ' is-player' : ''}">
    <header class="npc-rd-topbar">
      <div class="npc-rd-brand"><strong>PNJ</strong><span>REGISTRE · ${filtered.length} PERSONNAGE${filtered.length > 1 ? 'S' : ''} NON JOUEUR${filtered.length > 1 ? 'S' : ''}</span></div>
      <div class="npc-rd-toptools">
        <span id="npc-rd-saved" class="npc-rd-saved">✓ Enregistré</span>
        ${STATE.isAdmin ? `<div class="npc-rd-segment" aria-label="Point de vue">
          <button type="button" class="${_npcView === 'mj' ? 'is-on' : ''}" data-action="npcSetView" data-view="mj">Vue MJ</button>
          <button type="button" class="${_npcView === 'player' ? 'is-on' : ''}" data-action="npcSetView" data-view="player">Aperçu joueur</button>
        </div>
        ${_npcView === 'player' ? `<select class="npc-rd-player-select" aria-label="Joueur prévisualisé" data-change="npcSetPreviewPlayer">
          ${playerChoices.map(([uid, name]) => `<option value="${_esc(uid)}" ${uid === _npcPreviewUid ? 'selected' : ''}>${_esc(name)}</option>`).join('')}
        </select>` : ''}
        ${_npcView === 'mj' ? `<button type="button" class="npc-rd-topbtn" data-action="openAffiniteTypesManager">${_npcUiIcon('tag')} Affinités spécifiques</button>
          <button type="button" class="npc-rd-topbtn" data-action="_openMjStatsView">▦ Stats rapides</button>` : ''}` : ''}
      </div>
    </header>
    <div class="npc-rd-workspace">
      <aside class="npc-rd-roster" aria-label="Registre des PNJ">
        ${STATE.isAdmin && _npcView === 'mj' ? `<button type="button" class="npc-rd-new" data-action="npcExpressToggle">＋ Nouveau PNJ <kbd>N</kbd></button>
          ${_npcExpressOpen ? _renderNpcExpressForm() : ''}` : ''}
        <label class="npc-rd-search"><span>⌕</span><input id="npc-search" type="search" placeholder="Nom, rôle, lieu, organisation…" value="${_esc(_filterSearch)}" data-input="_npcSearch"><kbd>/</kbd></label>
        <div class="npc-rd-selects">
          <select aria-label="Organisation" data-change="npcSetOrgFilter">
            <option value="">Toutes les organisations</option>
            ${_npcKnownOrganizations().map(org => `<option value="${_esc(org)}" ${org === _activeOrgFilter ? 'selected' : ''}>${_esc(org)}</option>`).join('')}
          </select>
          <select aria-label="Regrouper" data-change="npcSetGroupBy">
            <option value="org" ${_listView === 'org' ? 'selected' : ''}>Par organisation</option>
            <option value="place" ${_listView === 'place' ? 'selected' : ''}>Par lieu</option>
            <option value="az" ${_listView === 'az' ? 'selected' : ''}>A → Z</option>
          </select>
        </div>
        <div id="npc-list-shell" class="npc-rd-list-shell">
          <div id="npc-list-items" class="npc-rd-list">${_buildListHtml(filtered)}</div>
        </div>
        <footer class="npc-rd-roster-foot"><b>${filtered.length}</b> affiché${filtered.length > 1 ? 's' : ''}<span><kbd>↑</kbd><kbd>↓</kbd> parcourir · <kbd>/</kbd> chercher${STATE.isAdmin && _npcView === 'mj' ? ' · <kbd>N</kbd> nouveau' : ''}</span></footer>
      </aside>
      <main id="npc-detail-panel" class="npc-rd-detail">
        ${active ? _renderFiche(active) : _renderEmpty()}
      </main>
    </div>
    <datalist id="npc-rd-places">${_places.map(p => `<option value="${_esc(p.name)}"></option>`).join('')}</datalist>
    <datalist id="npc-rd-orgs">${_npcKnownOrganizations().map(o => `<option value="${_esc(o)}"></option>`).join('')}</datalist>
  </div>`;
}

function _npcKnownOrganizations() {
  const names = new Set(_organisations.map(o => o.name).filter(Boolean));
  _npcs.forEach(n => (n.organisations || []).forEach(o => o && names.add(o)));
  return [...names].sort((a, b) => a.localeCompare(b, 'fr'));
}

function _renderNpcExpressForm() {
  return `<div class="npc-rd-express">
    <input id="npc-express-name" type="text" placeholder="Nom du PNJ" value="${_esc(_npcExpressName)}" data-input="npcExpressName" data-keydown="npcExpressKey">
    <input id="npc-express-role" type="text" placeholder="Rôle (facultatif)" data-keydown="npcExpressKey">
    <button type="button" data-action="npcExpressCreate">Créer ↵</button>
  </div>`;
}

function _renderPageKpis(filtered) {
  const total = _npcs.length;
  const visible = STATE.isAdmin ? _npcs.filter(n => n.embauchable !== false).length : filtered.length;
  const allies = filtered.filter(n => _affiniteNiveau(n) >= 4).length;
  const bastion = filtered.filter(n => (n.activites || []).length || n.passif || n.salaireSuggere).length;
  const vttReady = filtered.filter(n =>
    n.pv || n.pm || n.ca || n.vitesse || Object.keys(n.stats || {}).length || Object.keys(n.equipement || {}).length
  ).length;
  const cells = [
    ['Total', total],
    ['Visibles', visible],
    ['Alliés', allies],
    ['VTT', vttReady],
    ['Bastion', bastion],
  ];
  if (STATE.isAdmin) cells.push(['Cachés', _npcs.filter(n => n.embauchable === false).length]);
  return cells.map(([label, value]) => `
    <div class="npc-dashboard-stat">
      <strong>${value}</strong>
      <span>${label}</span>
    </div>`).join('');
}

// ── Nav item ──────────────────────────────────────────────────────────────────
function _renderDashboardFocus(n) {
  const af = afx(_affiniteNiveau(n));
  const orgs = Array.isArray(n.organisations) ? n.organisations.filter(Boolean) : [];
  const status = NPC_STATUTS[n.statut]?.lbl || 'Vivant';
  const hasVtt = n.pv || n.pm || n.ca || n.vitesse || Object.keys(n.stats || {}).length || Object.keys(n.equipement || {}).length;
  return `
    <div class="npc-dashboard-focus" style="${_afVars(af)}">
      <div class="npc-dashboard-focus-avatar">
        ${n.imageUrl ? `<img src="${n.imageUrl}" alt="">` : `<span>${_esc((n.nom || '?')[0].toUpperCase())}</span>`}
      </div>
      <div class="npc-dashboard-focus-main">
        <span>Sélection</span>
        <strong>${_esc(n.nom || 'PNJ sans nom')}</strong>
        <small>${_esc([n.role, n.lieu].filter(Boolean).join(' - ') || 'Dossier à compléter')}</small>
      </div>
      <div class="npc-dashboard-focus-tags">
        <em>${af.icon} ${af.label}</em>
        <em>${_esc(status)}</em>
        ${hasVtt ? '<em>VTT</em>' : ''}
        ${orgs[0] ? `<em>${_esc(orgs[0])}</em>` : ''}
      </div>
    </div>`;
}

function _renderRosterMetrics(filtered) {
  const visible = filtered.length;
  const allies = filtered.filter(n => _affiniteNiveau(n) >= 4).length;
  const hidden = STATE.isAdmin ? filtered.filter(n => n.embauchable === false).length : 0;
  const ready = filtered.filter(n => n.pv || n.pm || n.ca || n.vitesse || Object.keys(n.stats || {}).length || Object.keys(n.equipement || {}).length).length;
  return `
    <div class="npc-roster-metrics">
      <span><b>${visible}</b> affichés</span>
      <span><b>${allies}</b> alliés</span>
      <span><b>${ready}</b> VTT</span>
      ${STATE.isAdmin ? `<span><b>${hidden}</b> cachés</span>` : ''}
    </div>`;
}

function _renderNavItemLegacy(n) {
  const isActive = n.id === _activeId;
  const niv      = _affiniteNiveau(n);
  const af       = afx(niv);
  const orgs = Array.isArray(n.organisations) ? n.organisations.filter(Boolean) : [];
  const place = n.lieu || orgs[0] || '';
  const hasVtt = n.pv || n.pm || n.ca || n.vitesse || Object.keys(n.stats || {}).length || Object.keys(n.equipement || {}).length;
  return `
  <div class="npc-nav-item ${isActive ? 'is-active' : ''} ${n.statut === 'mort' ? 'npc-nav-item--dead' : ''}" style="${_afVars(af)}"
    data-action="selectNpc" data-id="${n.id}" data-npc-id="${n.id}"
    data-nav-page="npcs" data-nav-sub="${_esc(_npcRouteSub(n.id))}">

    <div class="npc-nav-avatar">
      ${n.imageUrl
        ? `<img src="${n.imageUrl}" alt="">`
        : `<span>${(n.nom || '?')[0].toUpperCase()}</span>`}
    </div>

    <div class="npc-nav-body">
      <div class="npc-nav-name">${_esc(n.nom || '?')}${NPC_STATUTS[n.statut] ? ` <span class="npc-status-tag" title="${NPC_STATUTS[n.statut].lbl}">${NPC_STATUTS[n.statut].ico}</span>` : ''}${STATE.isAdmin && n.embauchable === false ? ` <span class="npc-hidden-tag" title="Caché aux joueurs">🚫</span>` : ''}</div>
      <div class="npc-nav-sub">${_esc([n.role, place].filter(Boolean).join(' - ') || 'Profil à compléter')}</div>
      <div class="npc-nav-affi">
        <div class="npc-nav-dots">
          ${AFFINITE.map((a, i) => `<div class="npc-nav-dot" ${i <= niv ? `style="background:${a.couleur}"` : ''}></div>`).join('')}
        </div>
        <span class="npc-nav-affi-lbl">${af.label}</span>
        ${STATE.isAdmin && hasVtt ? `<span class="npc-nav-vtt">VTT</span>` : ''}
      </div>
    </div>

  </div>`;
}

function _renderNavItem(n) {
  const active = n.id === _activeId;
  const playerView = _npcIsPlayerView();
  const level = _affiniteNiveau(n);
  const af = afx(level);
  const missing = _npcMissing(n);
  const myFeelings = _npcMyCharacters().map(c => _npcFeelingFor(n.id, c)).filter(Boolean);
  const feelingLevel = myFeelings.find(f => f.sent)?.sent ? NPC_SENT_TO_LEVEL[myFeelings.find(f => f.sent).sent] : null;
  const rolePlace = [n.role, n.lieu].filter(Boolean).join(' · ');
  const initial = _esc((n.nom || '?')[0].toUpperCase());
  return `<button type="button" class="npc-rd-row${active ? ' is-active' : ''}${n.statut === 'mort' ? ' is-dead' : ''}" style="--row-aff:${af.couleur}" data-action="selectNpc" data-id="${_esc(n.id)}" data-nav-page="npcs" data-nav-sub="${_esc(_npcRouteSub(n.id))}">
    <span class="npc-rd-row-avatar">${n.imageUrl ? `<img src="${_esc(n.imageUrl)}" alt="">` : initial}${n.statut === 'mort' ? '<i>☠</i>' : n.statut === 'disparu' ? '<i>?</i>' : ''}</span>
    <span class="npc-rd-row-copy"><b>${_npcHighlight(n.nom || 'Sans nom')}${n.isNew ? '<em>nouveau</em>' : ''}</b><small>${missing.length && STATE.isAdmin && _npcView === 'mj' ? '<mark>à compléter · </mark>' : ''}${_npcHighlight(rolePlace || 'Profil à compléter')}</small></span>
    ${STATE.isAdmin && _npcView === 'mj' && n.embauchable === false ? '<span class="npc-rd-hidden" title="Caché des joueurs">⊘</span>' : ''}
    <span class="npc-rd-row-aff" style="background:${playerView && feelingLevel != null ? AFFINITE[feelingLevel].couleur : af.couleur}" title="${playerView ? (feelingLevel == null ? 'Pas de ressenti' : AFFINITE[feelingLevel].label) : af.label}">${playerView ? '♥' : ''}</span>
  </button>`;
}

// ══ Fiche PNJ — composants ════════════════════════════════════════════════════

// Portrait + identité (portrait reconnaissable, pas de bannière dans le corps)
function _renderNpcVttSnapshot(n) {
  if (!STATE.isAdmin) return '';
  const { equip, dBonus, caEquip } = _npcEquipEffect(n);
  const mainW = equip['Main principale'];
  const combat = _npcCombat(n);
  const vitalEquip = {
    pv: dBonus.pvMaxBonus,
    pm: dBonus.pmMaxBonus,
    ca: caEquip + dBonus.caBonus,
    vitesse: dBonus.vitesseBonus,
  };
  const total = (key) => (Number(n?.[key]) || 0) + (vitalEquip[key] || 0);
  const dmg = mainW?.degats || combat.weapon?.degats || combat.damage || '-';
  const range = mainW?.portee || combat.range || combat.weapon?.portee || '-';
  const weapon = mainW?.nom || combat.weaponName || combat.weapon?.nom || 'Aucune arme';
  return `
    <div class="npc-vtt-strip">
      <span><b>${total('pv') || '-'}</b> PV</span>
      <span><b>${total('pm') || '-'}</b> PM</span>
      <span><b>${total('ca') || '-'}</b> CA</span>
      <span><b>${total('vitesse') || '-'}</b> m</span>
      <span class="npc-vtt-strip-wide"><b>${_esc(dmg)}</b> ${_esc(weapon)}</span>
      <span><b>${_esc(range)}</b> portée</span>
    </div>`;
}

function _renderFicheHeader(n) {
  const af  = afx(_affiniteNiveau(n));
  const adm = STATE.isAdmin;
  const initial = (n.nom || '?')[0].toUpperCase();
  const portInner = n.imageUrl ? `<img src="${n.imageUrl}" alt="">` : `<span>${initial}</span>`;

  const portraitEl = n.imageUrl
    ? `<button class="npc-hero-portrait npc-portrait-btn npc-portrait-btn--view"
         data-action="npcViewPhoto" data-id="${n.id}" title="Voir l'image complète">
         ${portInner}</button>`
    : (adm
        ? `<button class="npc-hero-portrait npc-portrait-btn is-empty"
           data-action="npcSetPhoto" data-id="${n.id}" title="Ajouter un portrait">${portInner}</button>`
        : `<div class="npc-hero-portrait npc-hero-portrait--ph">${initial}</div>`);
  const editBadge = adm
    ? `<button class="npc-portrait-edit" data-action="npcSetPhoto" data-id="${n.id}" title="${n.imageUrl ? 'Changer le portrait' : 'Ajouter un portrait'}">📷</button>`
    : '';
  const portrait = `<div class="npc-portrait-box">${portraitEl}${editBadge}</div>`;

  const nameEl = adm
    ? `<input class="npc-inline npc-inline-name" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="nom" value="${_esc(n.nom || '')}" placeholder="Nom du PNJ">`
    : `<h2 class="npc-hero-name">${_esc(n.nom || '?')}</h2>`;
  const roleEl = adm
    ? `<input class="npc-inline npc-inline-role" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="role" value="${_esc(n.role || '')}" placeholder="Rôle (Forgeron, Garde…)">`
    : (n.role ? `<div class="npc-hero-role">${_esc(n.role)}</div>` : '');
  const lieuEl = adm
    ? `<input class="npc-inline npc-inline-lieu" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="lieu" value="${_esc(n.lieu || '')}" placeholder="📍 Lieu…">`
    : (n.lieu ? `<span class="npc-chip">📍 ${_esc(n.lieu)}</span>` : '');
  const orgsEl = adm
    ? `<input class="npc-inline npc-inline-lieu" style="max-width:240px" data-change="npcSaveOrgs" data-npc-id="${n.id}" value="${_esc((n.organisations || []).join(', '))}" placeholder="🏛️ Organisations (séparées par virgules)">`
    : (Array.isArray(n.organisations) && n.organisations.length ? `<span class="npc-chip">🏛️ ${n.organisations.map(_esc).join(', ')}</span>` : '');

  return `
  <div class="npc-hero" style="${_afVars(af)}">
    ${portrait}
    <div class="npc-hero-id">
      ${nameEl}
      ${roleEl}
      <div class="npc-hero-meta">
        <span class="npc-chip npc-chip--af">${af.icon} ${af.label}</span>
        ${lieuEl}
        ${orgsEl}
      </div>
      ${_renderNpcVttSnapshot(n)}
    </div>
    ${adm ? `
    <div class="npc-hero-actions">
      <button class="npc-mini-btn npc-mini-btn--danger" data-action="deleteNpc" data-id="${n.id}" title="Supprimer ce PNJ">🗑️ Supprimer</button>
      <button class="npc-mini-btn ${n.embauchable === false ? 'npc-mini-btn--off' : ''}" data-action="npcToggleEmbauchable" data-id="${n.id}" title="Visibilité côté joueurs (les PNJ cachés n'apparaissent pas dans leur liste)">${n.embauchable !== false ? '👁️ Visible joueurs' : '🚫 Caché joueurs'}</button>
    </div>` : ''}
  </div>`;
}

// Bloc "Profil bastion" : visible MJ toujours, joueur seulement si disposition = Allié
function _renderBastionProfil(n) {
  if (!isFeatureEnabled('bastion')) return '';
  const adm = STATE.isAdmin;
  const recrutable = n.recrutable !== false;
  const niv = _affiniteNiveau(n);
  const canSee     = niv >= 3;
  const canRecruit = niv >= 4;
  if (!adm && (!canSee || !recrutable)) return '';
  const hasInfo = (n.activites && n.activites.length) || n.passif || n.salaireSuggere;
  if (!adm && !hasInfo) return '';
  const actSet = new Set(n.activites || []);
  if (adm) {
    const visibility = !recrutable
      ? 'Masqué des joueurs · recrutement désactivé.'
      : niv < 3
        ? 'Masqué des joueurs · visible à partir d’Amical.'
        : 'Visible des joueurs · recrutable une fois Allié.';
    return `<section class="npc-rd-bastion${recrutable ? '' : ' is-off'}">
      <header class="npc-rd-bastion-head"><div><h2>${_npcUiIcon('bastion')} Bastion</h2><p>Profil de recrutement</p></div><button type="button" class="npc-rd-bastion-toggle${recrutable ? ' is-on' : ''}" data-action="npcToggleRecrutable" data-id="${_esc(n.id)}" aria-pressed="${recrutable}" title="Autoriser ou non le recrutement de ce PNJ"><i></i><span>${recrutable ? 'Recrutable' : 'Non recrutable'}</span></button></header>
      <div class="npc-rd-bastion-activities" aria-label="Activités du Bastion">${NPC_ACTIVITES.map(([slug, label]) => `<button type="button" class="${actSet.has(slug) ? 'is-on' : ''}" data-action="npcToggleActivite" data-id="${_esc(n.id)}" data-slug="${_esc(slug)}">${_esc(label)}</button>`).join('')}</div>
      <div class="npc-rd-bastion-fields"><label><span>Passif d’employé</span><input type="text" class="npc-inline" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="passif" value="${_esc(n.passif || '')}" placeholder="Réparations d’armes gratuites pour le groupe"></label><label class="npc-rd-bastion-salary"><span>Salaire</span><span><input type="number" min="0" class="npc-inline" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="salaireSuggere" value="${parseInt(n.salaireSuggere, 10) || ''}" placeholder="0"><small>or / sem.</small></span></label></div>
      <footer>${visibility}</footer>
    </section>`;
  }
  const activites = [...actSet].map(_actLabel);
  return `<section class="npc-rd-bastion is-readonly"><header class="npc-rd-bastion-head"><div><h2>${_npcUiIcon('bastion')} Bastion</h2><p>Profil de recrutement</p></div><span class="npc-rd-bastion-state${canRecruit ? ' is-on' : ''}">${canRecruit ? 'Recrutable' : 'Bientôt recrutable'}</span></header>${activites.length ? `<div class="npc-rd-bastion-activities">${activites.map(label => `<span class="is-on">${_esc(label)}</span>`).join('')}</div>` : ''}<div class="npc-rd-bastion-fields">${n.passif ? `<div><span>Passif d’employé</span><p>${_esc(n.passif)}</p></div>` : ''}${n.salaireSuggere ? `<div class="npc-rd-bastion-salary"><span>Salaire</span><b>${parseInt(n.salaireSuggere, 10) || 0} <small>or / sem.</small></b></div>` : ''}</div><footer>${canRecruit ? 'Ce PNJ peut rejoindre le Bastion.' : 'Recrutable une fois Allié.'}</footer></section>`;
}

// Jauge d'affinité groupe (lecture seule — la modification passe par les événements)
function _renderAffiniteGroupe(n) {
  const niv = _affiniteNiveau(n);
  const af  = afx(niv);

  const segments = AFFINITE.map((a, i) => {
    const cls = i === niv ? 'is-current' : i < niv ? 'is-filled' : '';
    const vars = `--seg:${a.couleur};--seg-fill:${a.couleur}88;--seg-bd:${a.couleur}44`;
    return `<div class="npc-af-seg ${cls}" style="${vars}">
      <div class="npc-af-seg-bar"></div>
      <div class="npc-af-seg-lbl">${a.label}</div>
    </div>`;
  }).join('');

  const valeur = Number(n.affinite?.valeur) || 0;

  return `
  <div class="npc-card" style="${_afVars(af)}">
    <div class="npc-card-hd">
      <div class="npc-card-title">Affinité du groupe &amp; événements</div>
      ${STATE.isAdmin ? `
      <button class="npc-card-act npc-card-act--ghost" data-action="openAffiniteSeuilsModal" title="Configurer les seuils valeur → niveau">⚙️ Seuils</button>` : ''}
    </div>

    <div class="npc-af-gauge">${segments}</div>

    <div class="npc-af-state">
      <span class="npc-af-state-ico">${af.icon}</span>
      <div style="flex:1">
        <span class="npc-af-state-name">${af.label}</span>
        <span class="npc-af-state-desc"> — ${af.desc}</span>
      </div>
      ${STATE.isAdmin ? `<span class="npc-af-val" title="Valeur cumulée">${valeur > 0 ? '+' + valeur : valeur}</span>` : ''}
    </div>

    ${STATE.isAdmin
      ? `<div class="npc-edit-block" style="margin-top:.5rem">
          <span class="npc-edit-lbl">Note d'affinité</span>
          <textarea class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="affinite.note"
            rows="2" placeholder="Contexte de la relation au groupe…">${_esc(n.affinite?.note || '')}</textarea>
        </div>
        <div class="npc-edit-block" style="margin-top:.5rem">
          <span class="npc-edit-lbl">Ajouter un événement</span>
          <div class="npc-event-row">
            <input type="number" class="npc-inline npc-event-delta" id="afg-d-${n.id}" placeholder="±N" title="Variation d'affinité (ex : +2, -1)">
            <input type="text" class="npc-inline npc-event-text" id="afg-e-${n.id}" placeholder="Ex : A aidé lors de la défense de la ville…">
            <button class="npc-event-btn" data-action="npcAddEvent" data-id="${n.id}">＋ Ajouter</button>
          </div>
        </div>`
      : (n.affinite?.note ? `<div class="npc-af-note">« ${_esc(n.affinite.note)} »</div>` : '')}

    ${_renderHistorique(n)}
  </div>`;
}

// Historique des événements — bloc interne (intégré à la carte affinité)
function _renderHistorique(n) {
  const histo = n.affinite?.historique || [];
  if (!histo.length) return '';

  return `
  <div class="npc-histo">
    <div class="npc-card-hd" style="margin-top:.65rem;margin-bottom:.4rem">
      <div class="npc-card-title">Historique des événements</div>
      <span style="font-size:.64rem;color:var(--text-dim)">${histo.length} év.</span>
    </div>

    <div class="npc-histo-list">
      ${histo.slice().reverse().map((h, reversedIndex) => {
        const realIndex = histo.length - 1 - reversedIndex;
        const d = h.delta || 0;
        const col = d > 0 ? '#22c38e' : d < 0 ? '#ff6b6b' : '#a0aec0';
        const bg  = d > 0 ? 'rgba(34,195,142,.1)' : d < 0 ? 'rgba(255,107,107,.1)' : 'rgba(255,255,255,.04)';
        const vars = `--h-bg:${bg};--h-c:${col};--h-c-bg:${col}20;--h-c-bd:${col}44`;

        return `<div class="npc-histo-row" style="${vars}">
          <span class="npc-histo-delta">${d > 0 ? '+' + d : d < 0 ? d : '~'}</span>
          <span class="npc-histo-text">${h.texte ? _esc(h.texte) : '<em style="color:var(--text-dim)">(sans titre)</em>'}</span>
          ${h.date ? `<span class="npc-histo-date">${h.date}</span>` : ''}
          ${STATE.isAdmin ? `
          <div class="npc-rel-actions" style="margin-left:.2rem">
            <button class="npc-icon-btn" data-action="editHistoriqueEntry" data-npc-id="${n.id}" data-idx="${realIndex}">✏️</button>
            <button class="npc-icon-btn npc-icon-btn--danger" data-action="deleteHistoriqueEntry" data-npc-id="${n.id}" data-idx="${realIndex}">🗑️</button>
          </div>` : ''}
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

// Chip affinité spécifique — vue admin
function _renderRelationChip(a, npcId) {
  const { emoji, color } = _typeView(a);
  const vars = `--rc:${color};--rc-bg:${color}12;--rc-bd:${color}30`;
  const typeOpts = _affiniteTypeChoices().map(t =>
    `<option value="${t.id}" ${t.id === a.typeId ? 'selected' : ''}>${t.emoji || '✨'} ${_esc(_displayText(t.label))}</option>`).join('');
  return `
  <div class="npc-rel-chip npc-rel-chip--edit" style="${vars}">
    <span class="npc-rel-emoji">${emoji}</span>
    <div class="npc-rel-body">
      <div class="npc-rel-editrow">
        <select class="npc-select npc-rel-typesel" data-change="npcAffiField" data-aff-id="${a.id}" data-field="typeId">${typeOpts}</select>
        <span class="npc-rel-target">${_affiTargetAvatar(a)}${_esc(a.charNom || '?')}</span>
      </div>
      <input class="npc-inline" data-change="npcAffiField" data-aff-id="${a.id}" data-field="notePublique"
        value="${_esc(a.notePublique || '')}" placeholder="🌐 Note publique…">
      <input class="npc-inline" data-change="npcAffiField" data-aff-id="${a.id}" data-field="note"
        value="${_esc(a.note || '')}" placeholder="🔒 Note privée…">
    </div>
    <div class="npc-rel-actions">
      <button class="npc-icon-btn npc-icon-btn--danger" data-action="deleteAffinitePerso" data-id="${a.id}">🗑️</button>
    </div>
  </div>`;
}

// Chip affinité spécifique — vue joueur (sa propre relation)
function _renderRelationChipPlayer(a) {
  const { emoji, color, label } = _typeView(a);
  const vars = `--rc:${color};--rc-bg:${color}12;--rc-bd:${color}30`;
  return `
  <div class="npc-rel-chip" style="${vars}">
    <span class="npc-rel-emoji">${emoji}</span>
    <div class="npc-rel-body">
      <div class="npc-rel-label">${_esc(label)}</div>
      <div class="npc-rel-target">${_affiTargetAvatar(a)}${_esc(a.charNom || '?')}</div>
      ${a.notePublique ? `<div class="npc-rel-note">🌐 ${_esc(a.notePublique)}</div>` : ''}
      ${a.note ? `<div class="npc-rel-note">🔒 ${_esc(a.note)}</div>` : ''}
    </div>
  </div>`;
}

// Chip affinité spécifique — vue joueur (lien d'un autre PJ, note publique uniquement)
function _renderRelationChipPublic(a) {
  const { emoji, color, label } = _typeView(a);
  const vars = `--rc:${color};--rc-bg:${color}10;--rc-bd:${color}28`;
  return `
  <div class="npc-rel-chip" style="${vars}">
    <span class="npc-rel-emoji" style="opacity:.85">${emoji}</span>
    <div class="npc-rel-body">
      <div class="npc-rel-label">${_esc(label)}</div>
      <div class="npc-rel-target">${_affiTargetAvatar(a)}${_esc(a.charNom || '?')}</div>
      ${(a.notePublique || '').trim() ? `<div class="npc-rel-note">🌐 ${_esc(a.notePublique)}</div>` : ''}
    </div>
  </div>`;
}

// Panneau des relations (colonne droite)
function _renderRelationsPanel(n) {
  const persoList = _affiPerso.filter(a => a.npcId === n.id);
  const myChars   = getMyCharacters(STATE.characters, STATE.user?.uid);
  const myAffi    = persoList.filter(a => myChars.some(c => c.id === a.charId));

  if (STATE.isAdmin) {
    const chars = _npcLinkableCharacters();
    return `
    <div class="npc-card">
      <div class="npc-card-hd">
        <div class="npc-card-title">Affinités spécifiques</div>
        <button class="npc-card-act npc-card-act--ghost" data-action="openAffiniteTypesManager">⚙️ Types</button>
      </div>
      <div class="npc-rel-list npc-rel-scroll">
        ${persoList.length
          ? persoList.map(a => _renderRelationChip(a, n.id)).join('')
          : `<div class="npc-empty-line">Aucune affinité spécifique</div>`}
      </div>
      <div class="npc-edit-block" style="margin-top:.55rem">
        <span class="npc-edit-lbl">Ajouter une affinité</span>
        <div class="npc-affi-add">
          <div class="npc-charpick">
            <input type="hidden" id="afp-char-${n.id}" value="">
            <button type="button" class="npc-charpick-trigger" data-action="npcCharPickToggle" data-npc-id="${n.id}">
              <span class="npc-charpick-current"><span class="npc-charpick-ph">Choisir un personnage…</span></span>
              <span class="npc-charpick-caret">▾</span>
            </button>
            <div class="npc-charpick-panel">
              ${chars.length ? chars.map(c => `
                <button type="button" class="npc-charpick-opt" data-action="npcCharPickSelect"
                  data-npc-id="${n.id}" data-char-id="${c.id}" data-char-nom="${_esc(c.nom || '?')}">
                  ${_charAvatar(c)}
                  <span class="npc-charpick-opt-txt"><b>${_esc(c.nom || '?')}</b><small>${_esc(c.ownerPseudo || '?')}</small></span>
                </button>`).join('')
                : `<div class="npc-empty-line">Aucun personnage</div>`}
            </div>
          </div>
          <select class="npc-select" id="afp-type-${n.id}">
            <option value="">— Type —</option>
            ${_affiniteTypeChoices().map(t => `<option value="${t.id}">${t.emoji || '✨'} ${_esc(_displayText(t.label))}</option>`).join('')}
          </select>
          <button class="npc-event-btn" data-action="npcAddAffiPerso" data-npc-id="${n.id}">＋ Ajouter</button>
        </div>
      </div>
    </div>`;
  }

  // Côté joueur : on montre toutes les affinités spécifiques du PNJ.
  // Ses propres personnages d'abord (avec note perso), puis les liens avec les
  // autres PJ (type + cible + note publique seulement, jamais la note privée MJ).
  const others = persoList.filter(a => !myChars.some(c => c.id === a.charId));
  if (!persoList.length) return '';

  const ownPanel = myAffi.length ? `
  <div class="npc-card" style="background:rgba(79,140,255,.06);border-color:rgba(79,140,255,.2)">
    <div class="npc-card-hd"><div class="npc-card-title" style="color:var(--gold)">✨ Ta relation avec ce PNJ</div></div>
    <div class="npc-rel-list">${myAffi.map(a => _renderRelationChipPlayer(a)).join('')}</div>
  </div>` : '';

  const othersPanel = others.length ? `
  <div class="npc-card">
    <div class="npc-card-hd"><div class="npc-card-title">Affinités spécifiques</div></div>
    <div class="npc-rel-list">${others.map(a => _renderRelationChipPublic(a)).join('')}</div>
  </div>` : '';

  return ownPanel + othersPanel;
}

// Fiche principale assemblée
function _renderFicheLegacy(n) {
  const desc = STATE.isAdmin
    ? `<div class="npc-edit-block">
        <span class="npc-edit-lbl">Description</span>
        <textarea class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="description"
          rows="3" placeholder="Apparence, personnalité, secrets…">${_esc(n.description || '')}</textarea>
      </div>`
    : (n.description ? `<div class="npc-desc">${_esc(n.description)}</div>` : '');
  // Statut narratif (MJ) — segmenté Vivant / Mort / Disparu.
  const statutSel = STATE.isAdmin ? `
    <div class="npc-statut-bar">
      <span class="npc-edit-lbl">Statut</span>
      <div class="npc-statut-seg">
        ${[['', '💚 Vivant'], ['mort', '☠️ Mort'], ['disparu', '❓ Disparu']].map(([v, lbl]) =>
          `<button type="button" class="npc-statut-btn ${(n.statut || '') === v ? 'is-on' : ''}" data-action="npcSetStatut" data-id="${n.id}" data-statut="${v}">${lbl}</button>`).join('')}
      </div>
    </div>` : '';
  // Notes MJ — jamais rendues côté joueur (réservées à l'admin).
  const noteMJ = STATE.isAdmin ? `
    <div class="npc-edit-block npc-note-mj">
      <span class="npc-edit-lbl">🔒 Notes MJ <span class="npc-note-mj-hint">(jamais visible des joueurs)</span></span>
      <textarea class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="noteMJ"
        rows="3" placeholder="Intrigue, vraie identité, twist, objectif secret…">${_esc(n.noteMJ || '')}</textarea>
    </div>` : '';
  // Colonne principale (affinité + événements, puis stats) et colonne latérale
  // (affinités spécifiques, bastion). L'historique est intégré à la carte affinité.
  const main = [_renderAffiniteGroupe(n), _renderStatsPanel(n)].filter(Boolean).join('');
  const side = [_renderRelationsPanel(n), _renderBastionProfil(n)].filter(Boolean).join('');

  const body = side
    ? `<div class="npc-cols">
         <div class="npc-col">${main}</div>
         <div class="npc-col">${side}</div>
       </div>`
    : main;

  return `
  <div class="npc-fiche">
    ${_renderFicheHeader(n)}
    <div class="npc-body">
      ${statutSel}
      ${noteMJ ? `<div class="npc-topgrid">${desc}${noteMJ}</div>` : desc}
      ${body}
    </div>
  </div>`;
}

function _renderFicheV3(n) {
  const desc = STATE.isAdmin
    ? `<textarea class="npc-inline npc-field-textarea" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="description"
          rows="4" placeholder="Apparence, personnalite, secrets...">${_esc(n.description || '')}</textarea>`
    : (n.description ? `<div class="npc-desc">${_esc(n.description)}</div>` : '<div class="npc-empty-line">Aucune description publique.</div>');

  const statutSel = STATE.isAdmin ? `
    <div class="npc-statut-bar npc-statut-bar--panel">
      <span class="npc-edit-lbl">Statut narratif</span>
      <div class="npc-statut-seg">
        ${[['', 'Vivant'], ['mort', 'Mort'], ['disparu', 'Disparu']].map(([v, lbl]) =>
          `<button type="button" class="npc-statut-btn ${(n.statut || '') === v ? 'is-on' : ''}" data-action="npcSetStatut" data-id="${n.id}" data-statut="${v}">${lbl}</button>`).join('')}
      </div>
    </div>` : '';

  const noteMJ = STATE.isAdmin ? `
    <textarea class="npc-inline npc-field-textarea npc-note-mj-field" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="noteMJ"
      rows="4" placeholder="Intrigue, vraie identite, objectif secret...">${_esc(n.noteMJ || '')}</textarea>` : '';

  const dossier = `
    <div class="npc-dossier-grid">
      <section class="npc-dossier-card npc-dossier-card--story">
        <div class="npc-dossier-title">
          <span>Dossier public</span>
          ${STATE.isAdmin ? '<small>Visible par les joueurs</small>' : ''}
        </div>
        ${desc}
      </section>
      ${STATE.isAdmin ? `
      <section class="npc-dossier-card npc-dossier-card--gm">
        <div class="npc-dossier-title">
          <span>Pilotage MJ</span>
          <small>Privé</small>
        </div>
        ${statutSel}
        <div class="npc-edit-block npc-note-mj">
          <span class="npc-edit-lbl">Notes MJ</span>
          ${noteMJ}
        </div>
      </section>` : ''}
    </div>`;

  const main = [_renderAffiniteGroupe(n), _renderStatsPanel(n)].filter(Boolean).join('');
  const side = [_renderRelationsPanel(n), _renderBastionProfil(n)].filter(Boolean).join('');

  const body = side
    ? `<div class="npc-cols">
         <div class="npc-col npc-col--main">${main}</div>
         <div class="npc-col npc-col--side">${side}</div>
       </div>`
    : main;

  return `
  <div class="npc-fiche">
    ${_renderFicheHeader(n)}
    <div class="npc-body">
      ${dossier}
      ${body}
    </div>
  </div>`;
}

function _renderFiche(n) {
  const playerView = _npcIsPlayerView();
  const af = afx(_affiniteNiveau(n));
  if (playerView) clearSpellHost();
  if (!playerView && _npcSheetTab === 'sorts') {
    n.deck_sorts = _npcSpellList(n).map(spell => spell && typeof spell === 'object' && typeof spell.actif !== 'boolean'
      ? { ...spell, actif: true }
      : spell);
    n.__spellCol = 'npcs';
    setNpcSpellHost(n, () => _refreshActivePanel());
  } else clearSpellHost();

  const body = playerView
    ? _renderNpcPlayerSheet(n)
    : _npcSheetTab === 'combat'
      ? _renderNpcCombatRedesign(n)
      : _npcSheetTab === 'sorts'
        ? _renderNpcSpellsRedesign(n)
        : _renderNpcDossierRedesign(n);
  return `<article class="npc-rd-sheet npc-sheet cs-v3" style="${_afVars(af)}">
    ${_renderNpcRedesignHeader(n, playerView)}
    ${playerView ? '' : _renderNpcRedesignTabs(n)}
    <div class="npc-rd-body">${body}</div>
  </article>`;
}

function _renderNpcRedesignHeader(n, playerView) {
  const af = afx(_affiniteNiveau(n));
  const orgs = (n.organisations || []).filter(Boolean);
  const exceptions = _affiPerso.filter(a => a.npcId === n.id && _npcExceptionLevel(n, a) != null).length;
  const initial = _esc((n.nom || '?')[0].toUpperCase());
  const portrait = n.imageUrl ? `<img src="${_esc(n.imageUrl)}" alt="">` : `<span>${initial}</span>`;
  const status = n.statut === 'mort' ? 'Mort' : n.statut === 'disparu' ? 'Disparu' : 'Vivant';
  const portraitNode = n.imageUrl
    ? `<button type="button" class="npc-rd-portrait" data-action="npcViewPhoto" data-id="${_esc(n.id)}" title="Voir le portrait">${portrait}</button>`
    : playerView
      ? `<div class="npc-rd-portrait is-empty" aria-hidden="true">${portrait}</div>`
      : `<button type="button" class="npc-rd-portrait is-empty" data-action="npcSetPhoto" data-id="${_esc(n.id)}" title="Choisir un portrait">${portrait}</button>`;
  const portraitCount = _npcPortraitEntries(n).length;
  const portraitBlock = `<div class="npc-rd-portrait-wrap">
    ${portraitNode}
    ${playerView ? '' : `<button type="button" class="npc-rd-portrait-manage" data-action="npcSetPhoto" data-id="${_esc(n.id)}" title="Gérer les portraits (${portraitCount})" aria-label="Gérer les portraits de ${_esc(n.nom || 'ce PNJ')}">${_npcUiIcon('plus')}<span>${portraitCount}</span></button>`}
  </div>`;
  return `<header class="npc-rd-sheethead">
    ${portraitBlock}
    <div class="npc-rd-identity">
      ${playerView
        ? `<h1>${_esc(n.nom || 'PNJ')}</h1>`
        : `<input class="npc-inline npc-rd-name" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="nom" value="${_esc(n.nom || '')}" placeholder="Nom du PNJ">`}
      <div class="npc-rd-meta">
        ${playerView
          ? `${n.role ? `<span class="npc-rd-field">${_npcUiIcon('role')}${_esc(n.role)}</span>` : ''}${n.lieu ? `<span class="npc-rd-field">${_npcUiIcon('pin')}${_esc(n.lieu)}</span>` : ''}${orgs.map(o => `<span>${_orgIcon(o)} ${_esc(o)}</span>`).join('')}`
          : `<label class="npc-rd-field">${_npcUiIcon('role')}<input class="npc-inline" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="role" value="${_esc(n.role || '')}" placeholder="Rôle"></label>
             <label class="npc-rd-field">${_npcUiIcon('pin')}<input class="npc-inline" list="npc-rd-places" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="lieu" value="${_esc(n.lieu || '')}" placeholder="Lieu"></label>
             ${orgs.map(o => `<span class="npc-rd-orgchip">${_orgIcon(o)} ${_esc(o)} <button type="button" data-action="npcRemoveOrg" data-id="${_esc(n.id)}" data-org="${_esc(o)}">×</button></span>`).join('')}
             <label class="npc-rd-field npc-rd-addorg">${_npcUiIcon('plus')}<input class="npc-inline" list="npc-rd-orgs" data-change="npcAddOrg" data-id="${_esc(n.id)}" placeholder="Organisation"></label>`}
      </div>
      <div class="npc-rd-statusline">
        ${playerView ? `<span>${status}</span>` : `<div class="npc-rd-segment">${[['', 'Vivant'], ['mort', 'Mort'], ['disparu', 'Disparu']].map(([value, label]) => `<button type="button" class="${(n.statut || '') === value ? 'is-on' : ''}" data-action="npcSetStatut" data-id="${_esc(n.id)}" data-statut="${value}">${label}</button>`).join('')}</div>`}
        ${playerView
          ? `<span class="npc-rd-level">Niv. ${Math.max(1, parseInt(n.niveau, 10) || 1)}</span><span class="npc-rd-posture">${_renderNpcLevelChip(_affiniteNiveau(n))}<span>envers le groupe</span></span>`
          : `<button type="button" class="npc-rd-level" data-action="npcSetTab" data-tab="combat">Niv. <b>${Math.max(1, parseInt(n.niveau, 10) || 1)}</b></button><button type="button" class="npc-rd-posture" data-action="npcGoPosture">${_renderNpcLevelChip(_affiniteNiveau(n))}<span>envers le groupe${exceptions ? ` · <b>${exceptions}</b> exception${exceptions > 1 ? 's' : ''}` : ''}</span></button>`}
      </div>
    </div>
    ${!playerView ? `<div class="npc-rd-head-actions">
      <button type="button" class="npc-rd-visible${n.embauchable === false ? ' is-hidden' : ''}" data-action="npcToggleEmbauchable" data-id="${_esc(n.id)}">${_npcUiIcon(n.embauchable === false ? 'eyeOff' : 'eye')}<span>${n.embauchable === false ? 'Caché des joueurs' : 'Visible des joueurs'}</span></button>
      <button type="button" class="npc-rd-delete" data-action="deleteNpc" data-id="${_esc(n.id)}" title="Supprimer ce PNJ" aria-label="Supprimer ce PNJ">${_npcUiIcon('trash')}</button>
    </div>` : ''}
  </header>`;
}

function _renderNpcRedesignTabs(n) {
  const spells = _npcSpellList(n);
  const deck = getDeckUsage(spells.map(s => typeof s?.actif === 'boolean' ? s : { ...s, actif: true }));
  const counts = {
    fiche: _affiPerso.filter(a => a.npcId === n.id).length,
    combat: `niv. ${Math.max(1, parseInt(n.niveau, 10) || 1)}`,
    sorts: `${deck.used}/${calcDeckMax(n)}`,
  };
  return `<nav class="npc-rd-tabs" role="tablist" aria-label="Sections de la fiche">
    <span class="npc-rd-tab-identity">${n.imageUrl ? `<img src="${_esc(n.imageUrl)}" alt="">` : `<i>${_esc((n.nom || '?')[0].toUpperCase())}</i>`}<b>${_esc(n.nom || 'PNJ')}</b></span>
    ${[['fiche', 'book', 'Dossier & relations'], ['combat', 'sword', 'Combat'], ['sorts', 'sparkles', 'Sorts']].map(([id, icon, label], idx) => `<button type="button" role="tab" aria-selected="${_npcSheetTab === id}" class="${_npcSheetTab === id ? 'is-on' : ''}" data-action="npcSetTab" data-tab="${id}" data-nav-page="npcs" data-nav-sub="${_esc(_npcRouteSub(n.id, id))}">${_npcUiIcon(icon)}${label}<small>${counts[id]}</small><kbd>${idx + 1}</kbd></button>`).join('')}
  </nav>`;
}

function _renderNpcDossierRedesign(n) {
  const missing = _npcMissing(n);
  return `${missing.length ? `<div class="npc-rd-missing"><b>À compléter</b>${missing.map(item => `<button type="button" data-action="npcGoMissing" data-target="${item}">＋ ${_esc(item)}</button>`).join('')}</div>` : ''}
    <div class="npc-rd-dual">
      <section class="npc-rd-card"><div class="npc-rd-cardhead"><div><h2>Ce que les joueurs savent</h2><p>Apparence, réputation, ce qu’on raconte de lui.</p></div><span>⊙ Visible des joueurs</span></div><textarea id="npc-rd-description" class="npc-inline npc-rd-textarea" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="description" placeholder="Ce que les joueurs peuvent savoir…">${_esc(n.description || '')}</textarea></section>
      <section class="npc-rd-card is-private"><div class="npc-rd-cardhead"><div><h2>▣ Notes MJ</h2><p>Secrets, objectifs, vraie identité.</p></div><span>Jamais montré aux joueurs</span></div><textarea class="npc-inline npc-rd-textarea" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="noteMJ" placeholder="Notes privées…">${_esc(n.noteMJ || '')}</textarea></section>
    </div>
    ${_renderNpcPosture(n)}
    ${_renderNpcCrossRelations(n, true)}
    ${_renderBastionProfil(n)}`;
}

function _renderNpcPosture(n) {
  const level = _affiniteNiveau(n);
  const af = afx(level);
  const aff = n.affinite || {};
  const fullHistory = Array.isArray(aff.historique) ? aff.historique : [];
  const history = (_npcExpandedHistories.has(n.id) ? fullHistory : fullHistory.slice(-4)).map((entry, index) => ({
    ...entry,
    _index: _npcExpandedHistories.has(n.id) ? index : Math.max(0, fullHistory.length - 4) + index,
  })).reverse();
  const exceptionCount = _affiPerso.filter(a => a.npcId === n.id && _npcExceptionLevel(n, a) != null).length;
  const inherited = Math.max(0, _npcLinkableCharacters().length - exceptionCount);
  const thresholdLabel = index => index === 0
    ? `< ${Number(_affiniteSeuils.mefiant) || 0}`
    : `≥ ${Number([0, _affiniteSeuils.mefiant, _affiniteSeuils.neutre, _affiniteSeuils.amical, _affiniteSeuils.allie][index]) || 0}`;
  const currentValue = Number(aff.valeur) || 0;
  const nextThresholds = [
    ['Méfiant', Number(_affiniteSeuils.mefiant) || 0],
    ['Neutre', Number(_affiniteSeuils.neutre) || 0],
    ['Amical', Number(_affiniteSeuils.amical) || 0],
    ['Allié', Number(_affiniteSeuils.allie) || 0],
  ];
  const nextThreshold = nextThresholds.find(([, value]) => currentValue < value);
  const nextThresholdText = nextThreshold ? `${nextThreshold[0]} à ${nextThreshold[1] >= 0 ? '+' : ''}${nextThreshold[1]}` : 'palier maximum';
  return `<section id="npc-rd-posture" class="npc-rd-card npc-rd-posture-card">
    <div class="npc-rd-cardhead"><div><h2>Posture envers le groupe</h2><p>Les cas particuliers se règlent personnage par personnage, plus bas.</p></div>
      <div class="npc-rd-posture-mode"><span>Réglage</span><div class="npc-rd-segment"><button type="button" class="${_affiniteMode(n) === 'groupe' ? 'is-on' : ''}" data-action="npcSetAffiniteMode" data-id="${_esc(n.id)}" data-mode="groupe">Direct</button><button type="button" class="${_affiniteMode(n) === 'valeur' ? 'is-on' : ''}" data-action="npcSetAffiniteMode" data-id="${_esc(n.id)}" data-mode="valeur">Par événements</button></div>${_affiniteMode(n) === 'valeur' ? `<button type="button" class="npc-rd-seuils" data-action="openAffiniteSeuilsModal">${_npcUiIcon('cog')} Seuils</button>` : ''}</div>
    </div>
    <div class="npc-rd-scale">${AFFINITE.map((item, idx) => `<button type="button" class="${idx === level ? 'is-on' : ''}" style="--scale:${item.couleur}" data-action="npcSetAffiniteNiveau" data-id="${_esc(n.id)}" data-niveau="${idx}" ${_affiniteMode(n) === 'valeur' ? 'disabled' : ''}><span><i></i><b>${item.label}</b></span>${_affiniteMode(n) === 'valeur' ? `<small>${thresholdLabel(idx)}</small>` : ''}</button>`).join('')}</div>
    <div class="npc-rd-posture-summary">${_renderNpcLevelChip(level)}<span>${af.desc}</span>${_affiniteMode(n) === 'valeur' ? `<span class="npc-rd-posture-value">valeur <b>${currentValue >= 0 ? '+' : ''}${currentValue}</b> · prochain palier : ${nextThresholdText}</span>` : ''}<small>${_npcUiIcon('users')} vaut pour <b>${inherited}</b> perso${inherited > 1 ? 's' : ''} sur ${_npcLinkableCharacters().length}${exceptionCount ? ` · ${exceptionCount} exception${exceptionCount > 1 ? 's' : ''}` : ''}</small></div>
    <textarea class="npc-inline npc-rd-posture-note" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="affinite.note" placeholder="Note de posture…">${_esc(aff.note || '')}</textarea>
    <div class="npc-rd-journal"><div class="npc-rd-journal-title"><b>${_npcUiIcon('clock')} Journal de la relation</b><span>${_affiniteMode(n) === 'valeur' ? 'Chaque événement déplace la valeur.' : 'En réglage direct, le journal garde la trace sans déplacer la posture.'}</span></div>
      <div class="npc-rd-event-form"><div class="npc-rd-event-deltas" role="group" aria-label="Variation">${[-2, -1, 0, 1, 2].map(v => `<button type="button" class="${_histEditDelta === v ? 'is-on ' : ''}${v > 0 ? 'is-pos' : v < 0 ? 'is-neg' : ''}" data-action="npcEventDelta" data-value="${v}">${v > 0 ? `+${v}` : v || '±0'}</button>`).join('')}</div><input id="npc-rd-event-text" type="text" data-npc-id="${_esc(n.id)}" placeholder="Ce qui vient de se passer…" autocomplete="off"><button type="button" class="npc-rd-event-add" data-action="npcAddRelationEvent" data-id="${_esc(n.id)}">Ajouter</button></div>
      <div class="npc-rd-event-list">${history.length ? history.map(entry => { const delta = Number(entry.delta) || 0; return `<div><b class="npc-rd-delta${delta < 0 ? ' is-neg' : delta > 0 ? ' is-pos' : ''}">${delta > 0 ? `+${delta}` : delta || '±0'}</b><span>${_esc(entry.texte || entry.text || '')}</span><time>${_esc(entry.date || '')}</time><button type="button" class="npc-rd-event-delete" data-action="npcDeleteRelationEvent" data-id="${_esc(n.id)}" data-index="${entry._index}" title="Supprimer cet événement" aria-label="Supprimer cet événement">${_npcUiIcon('trash')}</button></div>`; }).join('') : '<p class="npc-rd-event-empty">Aucun événement pour l’instant.</p>'}</div>
      ${fullHistory.length > 4 ? `<button type="button" class="npc-rd-history-more" data-action="npcToggleRelationHistory" data-id="${_esc(n.id)}">${_npcExpandedHistories.has(n.id) ? 'Réduire' : `Tout afficher · ${fullHistory.length}`}</button>` : ''}
    </div>
  </section>`;
}

function _npcCrossRows(n) {
  return _npcLinkableCharacters().map(character => {
    const exception = _npcExceptionFor(n.id, character.id);
    const feeling = _npcFeelingFor(n.id, character);
    const exLevel = _npcExceptionLevel(n, exception);
    const feelingLevel = feeling?.sent ? NPC_SENT_TO_LEVEL[feeling.sent] ?? null : null;
    return { character, exception, feeling, exLevel, feelingLevel };
  });
}

function _renderNpcDistributions(n, rows) {
  const inheritedLevel = _affiniteNiveau(n);
  const npcCounts = [0, 0, 0, 0, 0];
  const feelingCounts = [0, 0, 0, 0, 0];
  let inherited = 0;
  let noFeeling = 0;
  rows.forEach(row => {
    const shownLevel = row.exLevel == null ? inheritedLevel : row.exLevel;
    if (row.exLevel == null) inherited += 1; else npcCounts[shownLevel] += 1;
    if (row.feelingLevel == null) noFeeling += 1; else feelingCounts[row.feelingLevel] += 1;
  });
  const segment = (count, level, className = '') => count
    ? `<span class="${className}" style="--dist:${AFFINITE[level].couleur};flex:${count}" title="${count} · ${_esc(AFFINITE[level].label)}"></span>`
    : '';
  const key = (count, level, { inherited: isInherited = false } = {}) => count
    ? `<span><i class="${isInherited ? 'is-inherited' : ''}" style="--dist:${AFFINITE[level].couleur}"></i><b>${count}</b> ${_esc(AFFINITE[level].label)}${isInherited ? ' · posture du groupe' : ''}</span>`
    : '';
  const npcSegments = `${segment(inherited, inheritedLevel, 'is-inherited')}${npcCounts.map((count, level) => segment(count, level)).join('')}`;
  const feelingSegments = `${feelingCounts.map((count, level) => segment(count, level)).join('')}${noFeeling ? `<span class="is-none" style="flex:${noFeeling}" title="${noFeeling} sans avis"></span>` : ''}`;
  const npcKeys = `${key(inherited, inheritedLevel, { inherited: true })}${npcCounts.map((count, level) => key(count, level)).join('')}`;
  const feelingKeys = `${feelingCounts.map((count, level) => key(count, level)).join('')}${noFeeling ? `<span><i class="is-none"></i><b>${noFeeling}</b> sans avis</span>` : ''}`;
  return `<div class="npc-rd-distribution">
    <span class="npc-rd-dist-label">${_esc(n.nom || 'PNJ')} → persos</span><div class="npc-rd-dist-bar">${npcSegments}</div><div class="npc-rd-dist-keys">${npcKeys}</div>
    <span class="npc-rd-dist-label">Persos → ${_esc(n.nom || 'PNJ')}</span><div class="npc-rd-dist-bar">${feelingSegments}</div><div class="npc-rd-dist-keys">${feelingKeys}</div>
  </div>`;
}

function _renderNpcTypeChip(exception, { pick = false } = {}) {
  if (!exception?.typeId) return '';
  return `<span class="npc-rd-typechip${pick ? ' is-pick' : ''}" style="--tc:${_esc(_getAffiniteTypeColor(exception.typeId))}">${_esc(_getAffiniteTypeEmoji(exception.typeId))} ${_esc(_getAffiniteTypeLabel(exception.typeId, exception.typeLabel))}</span>`;
}

function _renderNpcCrossRelations(n, admin) {
  const all = _npcCrossRows(n).map(row => !admin && row.exception?.secret
    ? { ...row, exception: null, exLevel: null }
    : row);
  let rows = all.filter(row => {
    if (_npcCrossFilter === 'exceptions') return !!row.exception;
    if (_npcCrossFilter === 'feelings') return !!row.feeling;
    if (_npcCrossFilter === 'notables') return !!row.exception || !!row.feeling;
    return true;
  });
  const q = _norm(_npcCrossSearch);
  if (q) rows = rows.filter(row => _norm([row.character.nom, row.character.ownerPseudo, row.feeling?.sentiment, row.exception?.typeLabel].join(' ')).includes(q));
  const myCharacterIds = admin ? null : new Set(_npcMyCharacters().map(character => character.id));
  rows.sort((a, b) => {
    if (!admin) {
      const ownOrder = Number(myCharacterIds.has(b.character.id)) - Number(myCharacterIds.has(a.character.id));
      if (ownOrder) return ownOrder;
    }
    if (_npcCrossSort === 'player') return (a.character.ownerPseudo || '').localeCompare(b.character.ownerPseudo || '', 'fr');
    if (_npcCrossSort === 'discord') {
      const da = Math.abs((a.exLevel ?? _affiniteNiveau(n)) - (a.feelingLevel ?? _affiniteNiveau(n)));
      const db = Math.abs((b.exLevel ?? _affiniteNiveau(n)) - (b.feelingLevel ?? _affiniteNiveau(n)));
      if (db !== da) return db - da;
    }
    return (a.character.nom || '').localeCompare(b.character.nom || '', 'fr');
  });
  const quiet = all.length - rows.length;
  const filterChoices = admin
    ? [['notables', 'Notables'], ['exceptions', 'Exceptions'], ['feelings', 'Ressentis'], ['all', 'Tous']]
    : [['notables', 'Avec un lien'], ['all', 'Tous']];
  return `<section class="npc-rd-card npc-rd-cross" id="npc-rd-cross-relations" data-npc-id="${_esc(n.id)}">
    <div class="npc-rd-cardhead"><div><h2>Regards croisés</h2><p>Ce que ${_esc(n.nom || 'ce PNJ')} pense de chaque personnage, et ce que chacun pense de lui.</p></div>${admin ? `<div class="npc-rd-card-actions"><button type="button" class="npc-rd-outline" data-action="openAffiniteTypesManager">${_npcUiIcon('tag')} Gérer les types</button><button type="button" class="npc-rd-outline" data-action="npcShowAllRelations">＋ Exception pour…</button></div>` : ''}</div>
    ${_renderNpcDistributions(n, all)}
    <div class="npc-rd-cross-tools"><label>${_npcUiIcon('search')}<input type="search" placeholder="Personnage ou joueur…" value="${_esc(_npcCrossSearch)}" data-input="npcCrossSearch"></label><div class="npc-rd-cross-filters">${filterChoices.map(([id, label]) => `<button type="button" class="${_npcCrossFilter === id ? 'is-on' : ''}" data-action="npcCrossFilter" data-filter="${id}">${label} <b>${id === 'notables' ? all.filter(r => r.exception || r.feeling).length : id === 'exceptions' ? all.filter(r => r.exception).length : id === 'feelings' ? all.filter(r => r.feeling).length : all.length}</b></button>`).join('')}</div><select data-change="npcCrossSort" aria-label="Trier les relations"><option value="name" ${_npcCrossSort === 'name' ? 'selected' : ''}>Nom</option><option value="player" ${_npcCrossSort === 'player' ? 'selected' : ''}>Joueur</option>${admin ? `<option value="discord" ${_npcCrossSort === 'discord' ? 'selected' : ''}>Désaccords d’abord</option>` : ''}</select></div>
    <div class="npc-rd-cross-table"><div class="npc-rd-cross-head"><span>Personnage</span><span>${_esc(n.nom || 'PNJ')} → perso</span><span>Perso → ${_esc(n.nom || 'PNJ')}</span><span></span></div>${rows.map(row => _renderNpcCrossRow(n, row, admin)).join('') || '<p class="npc-rd-empty">Aucune relation dans ce filtre.</p>'}</div>
    ${quiet > 0 && _npcCrossFilter === 'notables' && !_npcCrossSearch ? `<div class="npc-rd-quiet"><span class="npc-rd-avatar-stack">${all.filter(row => !row.exception && !row.feeling).slice(0, 5).map(row => { const src = _charPortraitSrc(row.character, _playerProfileForChar(row.character.id, row.character.nom)); return src ? `<img src="${_esc(src)}" alt="">` : `<i>${_esc((row.character.nom || '?')[0])}</i>`; }).join('')}</span><span><b>${quiet}</b> autres personnages suivent la posture du groupe et n’ont rien noté.</span><button type="button" data-action="npcShowAllRelations">Afficher tous</button></div>` : ''}
  </section>`;
}

function _renderNpcLevelChip(level, { inherited = false, secret = false } = {}) {
  if (level == null) return '<span class="npc-rd-none">—</span>';
  return `<span class="npc-rd-levelchip${inherited ? ' is-inherited' : ''}" style="--lv:${AFFINITE[level].couleur}"><i></i>${AFFINITE[level].label}${inherited ? ' · groupe' : ''}${secret ? ' ▣' : ''}</span>`;
}

function _renderNpcCrossRow(n, row, admin) {
  const { character: c, exception: e, feeling: f, exLevel, feelingLevel } = row;
  const open = _npcCrossOpen === c.id;
  const profile = _playerProfileForChar(c.id, c.nom);
  const src = _charPortraitSrc(c, profile);
  const exShown = exLevel == null ? _affiniteNiveau(n) : exLevel;
  return `<div class="npc-rd-cross-row${open ? ' is-open' : ''}">
    <button type="button" class="npc-rd-cross-summary${admin ? ' is-clickable' : ''}" data-action="npcCrossOpen" data-char-id="${_esc(c.id)}" aria-expanded="${open}">
      <span class="npc-rd-person">${src ? `<img src="${_esc(src)}" alt="">` : `<i>${_esc((c.nom || '?')[0])}</i>`}<b>${_esc(c.nom || '?')}<small>${_esc(c.ownerPseudo || c.ownerName || '')}</small></b></span>
      <span class="npc-rd-cross-cell">${_renderNpcLevelChip(exShown, { inherited: exLevel == null })}${_renderNpcTypeChip(e)}${e?.secret ? `<i class="npc-rd-secret" title="Exception cachée aux joueurs">${_npcUiIcon('lock')}</i>` : ''}${e?.notePublique ? `<em>${_esc(e.notePublique)}</em>` : ''}</span>
      <span class="npc-rd-cross-cell">${_renderNpcLevelChip(feelingLevel)}${f?.sentiment ? `<span class="npc-rd-feeling-label">« ${_esc(f.sentiment)} »</span>` : ''}${f?.note ? `<em>${_esc(f.note)}</em>` : ''}</span>
      <span class="npc-rd-cross-chevron">${admin ? _npcUiIcon('chev') : ''}</span>
    </button>
    ${open && admin ? _renderNpcCrossEditor(n, c, e, f, true) : ''}
  </div>`;
}

function _renderNpcCrossEditor(n, c, e, f, admin) {
  const exLevel = _npcExceptionLevel(n, e);
  const feelingLevel = f?.sent ? NPC_SENT_TO_LEVEL[f.sent] ?? null : null;
  const owner = c.ownerPseudo || c.ownerName || c.joueur || 'le joueur';
  const exceptionScale = `<div class="npc-rd-inline-scale npc-rd-inline-scale--six">
    <button type="button" class="is-inherit ${exLevel == null ? 'is-on' : ''}" style="--scale:${AFFINITE[_affiniteNiveau(n)].couleur}" data-action="npcSetExceptionLevel" data-npc-id="${_esc(n.id)}" data-char-id="${_esc(c.id)}" data-value=""><b>Comme le groupe</b><small>${_esc(AFFINITE[_affiniteNiveau(n)].label)}</small></button>
    ${AFFINITE.map((item, idx) => `<button type="button" class="${exLevel === idx ? 'is-on' : ''}" style="--scale:${item.couleur}" data-action="npcSetExceptionLevel" data-npc-id="${_esc(n.id)}" data-char-id="${_esc(c.id)}" data-value="${idx}"><span><i></i>${_esc(item.label)}</span></button>`).join('')}
  </div>`;
  const feelingScale = `<div class="npc-rd-inline-scale npc-rd-inline-scale--six">
    <button type="button" class="is-none ${feelingLevel == null ? 'is-on' : ''}" data-action="npcSetFeelingLevel" data-npc-id="${_esc(n.id)}" data-char-id="${_esc(c.id)}" data-value="">Pas d’avis</button>
    ${AFFINITE.map((item, idx) => `<button type="button" class="${feelingLevel === idx ? 'is-on' : ''}" style="--scale:${item.couleur}" data-action="npcSetFeelingLevel" data-npc-id="${_esc(n.id)}" data-char-id="${_esc(c.id)}" data-value="${NPC_LEVEL_TO_SENT[idx]}"><span><i></i>${_esc(item.label)}</span></button>`).join('')}
  </div>`;
  const relationTypes = _affiniteTypeChoices();
  return `<div class="npc-rd-cross-editor${admin ? '' : ' is-player'}">
    ${admin ? `<div class="npc-rd-editor-col"><div class="npc-rd-editor-head"><h3>${_esc(n.nom || 'PNJ')} envers ${_esc(c.nom || 'ce personnage')}</h3>${e ? `<button type="button" class="npc-rd-danger-link" data-action="npcRemoveException" data-id="${_esc(e.id)}">Retirer l’exception</button>` : ''}</div>
      ${exceptionScale}
      <div class="npc-rd-editor-label">Nature du lien <span>· optionnel</span></div><div class="npc-rd-type-picker">${_affiniteTypeChoices().map(type => `<button type="button" class="npc-rd-typechip is-pick${e?.typeId === type.id ? ' is-on' : ''}" style="--tc:${_esc(type.couleur || TYPE_COLORS[0])}" data-action="npcSetExceptionType" data-npc-id="${_esc(n.id)}" data-char-id="${_esc(c.id)}" data-value="${_esc(type.id)}">${_esc(type.emoji || '')} ${_esc(type.label)}</button>`).join('')}</div>
      <label>Ce que les joueurs voient<input type="text" value="${_esc(e?.notePublique || '')}" data-change="npcSaveException" data-field="notePublique" data-npc-id="${_esc(n.id)}" data-char-id="${_esc(c.id)}" placeholder="Ex. : lui doit 40 po depuis l’hiver."></label>
      <label><span>${_npcUiIcon('lock')} Note MJ secrète</span><input class="is-secret" type="text" value="${_esc(e?.note || '')}" data-change="npcSaveException" data-field="note" data-npc-id="${_esc(n.id)}" data-char-id="${_esc(c.id)}" placeholder="Ce que ${_esc(n.nom || 'ce PNJ')} cache…"></label>
      <label class="npc-rd-check"><input type="checkbox" data-change="npcSaveException" data-field="secret" data-npc-id="${_esc(n.id)}" data-char-id="${_esc(c.id)}" ${e?.secret ? 'checked' : ''}> Exception cachée aux joueurs</label>
    </div>` : ''}
    <div class="npc-rd-editor-col"><div class="npc-rd-editor-head"><h3>${_esc(c.nom || 'Personnage')} envers ${_esc(n.nom || 'ce PNJ')}</h3><small>rempli par ${_esc(owner)} · visible par tout le groupe</small></div>
      ${feelingScale}
      ${feelingLevel == null ? '<p class="npc-rd-hint">Commence par situer cette relation sur l’échelle. L’étiquette et la note suivent.</p>' : `<div class="npc-rd-editor-label">Étiquette <span>· type défini ou texte personnalisé</span></div><div class="npc-rd-type-picker">${relationTypes.map(type => `<button type="button" class="npc-rd-typechip is-pick${f?.sentiment === type.label ? ' is-on' : ''}" style="--tc:${_esc(type.couleur || TYPE_COLORS[0])}" data-action="npcSetFeelingSuggestion" data-npc-id="${_esc(n.id)}" data-char-id="${_esc(c.id)}" data-value="${_esc(type.label)}">${_esc(type.emoji || '')} ${_esc(type.label)}</button>`).join('')}</div><label>Étiquette personnalisée<input type="text" value="${_esc(f?.sentiment || '')}" data-change="npcSaveFeeling" data-field="sentiment" data-npc-id="${_esc(n.id)}" data-char-id="${_esc(c.id)}" placeholder="Mentor, rival, dette, client…"></label><label>Note<textarea rows="2" data-change="npcSaveFeeling" data-field="note" data-npc-id="${_esc(n.id)}" data-char-id="${_esc(c.id)}" placeholder="Ce que ${_esc(c.nom || 'ce personnage')} en pense vraiment…">${_esc(f?.note || '')}</textarea></label>`}
    </div>
  </div>`;
}

function _renderNpcCombatRedesign(n) {
  const { totals, bases, equipBonus } = _npcVitalTotals(n);
  const weapon = _npcWeaponInfo(n);
  const deck = getDeckUsage(_npcSpellList(n).map(s => typeof s?.actif === 'boolean' ? s : { ...s, actif: true }));
  const initiative = _npcEffectiveMod(n, 'dexterite');
  const statSpent = Object.values(n.statsLevelUps || {}).reduce((sum, value) => sum + (parseInt(value, 10) || 0), 0);
  const statBudget = Math.max(0, (parseInt(n.niveau, 10) || 1) - 1);
  const resource = (kind, label, current, max, field) => `<div class="npc-rd-current"><div><span>${label}</span><b>${current} / ${max}</b></div><div class="npc-rd-meter"><i style="width:${max ? Math.round(current / max * 100) : 0}%"></i></div><div><button type="button" data-action="npcAdjustCurrent" data-id="${_esc(n.id)}" data-field="${field}" data-delta="-1">−</button><button type="button" data-action="npcAdjustCurrent" data-id="${_esc(n.id)}" data-field="${field}" data-delta="1">＋</button><button type="button" data-action="npcResetCurrent" data-id="${_esc(n.id)}" data-field="${field}">↺</button></div></div>`;
  const hp = Math.max(0, Math.min(totals.pv, Number.isFinite(Number(n.hp)) ? Number(n.hp) : totals.pv));
  const pm = Math.max(0, Math.min(totals.pm, Number.isFinite(Number(n.pmCurrent)) ? Number(n.pmCurrent) : totals.pm));
  return `<section class="npc-rd-combat-strip">${[
      ['PV', totals.pv, `${bases.pv} base ${equipBonus.pv ? _signedNum(equipBonus.pv) + ' éq.' : ''}`],
      ['PM', totals.pm, `${bases.pm} base ${equipBonus.pm ? _signedNum(equipBonus.pm) + ' éq.' : ''}`],
      ['CA', totals.ca, `${bases.ca} base ${equipBonus.ca ? _signedNum(equipBonus.ca) + ' éq.' : ''}`],
      ['Vitesse', `${totals.vitesse} m`, `${bases.vitesse} base`],
      ['Initiative', _signedNum(initiative), 'DEX'], ['Toucher', _signedNum(weapon.touch), weapon.touchStatLabel],
      ['Dégâts', weapon.damage, weapon.weapon?.nom || 'Sans arme'], ['Deck', `${deck.used}/${calcDeckMax(n)}`, 'sorts préparés'],
    ].map(([label, value, sub]) => `<div><small>${label}</small><b>${value}</b><span>${_esc(sub)}</span></div>`).join('')}</section>
    <section class="npc-rd-card"><div class="npc-rd-cardhead"><div><h2>Niveau & ressources</h2><p>${statBudget - statSpent >= 0 ? `${statBudget - statSpent} point${statBudget - statSpent > 1 ? 's' : ''} à répartir` : `${statSpent - statBudget} point${statSpent - statBudget > 1 ? 's' : ''} en trop`}</p></div><label class="npc-rd-level-input">Niveau <input class="npc-inline" type="number" min="1" max="99" value="${Math.max(1, parseInt(n.niveau, 10) || 1)}" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="niveau"></label></div>
      <div class="npc-rd-base-res"><label>PV de base<input class="npc-inline" type="number" min="1" value="${_npcBaseVital(n, 'pv')}" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="pvBase"><small>max ${totals.pv}</small></label><label>PM de base<input class="npc-inline" type="number" min="0" value="${_npcBaseVital(n, 'pm')}" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="pmBase"><small>max ${totals.pm}</small></label></div>
      <div class="npc-rd-current-grid">${resource('hp', 'PV actuels · VTT', hp, totals.pv, 'hp')}${resource('pm', 'PM actuels · VTT', pm, totals.pm, 'pmCurrent')}</div>
    </section>
    <section class="npc-rd-card"><div class="npc-rd-cardhead"><div><h2>Caractéristiques</h2><p>Base, progression de niveau et équipement.</p></div></div><div class="npc-rd-stats">${NPC_STATS.map(stat => {
      const base = Number(_npcBaseStats(n)[stat.key]) || 10;
      const lvl = Number(n.statsLevelUps?.[stat.key]) || 0;
      const eq = computeEquipStatsBonus(n.equipement || {})[stat.key] || 0;
      const total = _npcEffectiveStat(n, stat.key);
      return `<div><span>${stat.short}</span><b>${total}</b><em>${_modStr(total)}</em><label>base <input class="npc-inline" type="number" min="1" max="30" value="${Math.max(1, base - lvl)}" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="statBase:${stat.key}"></label><small>niv. ${_signedNum(lvl)} · éq. ${_signedNum(eq)}</small><div><button type="button" data-action="npcAllocateStat" data-npc-id="${_esc(n.id)}" data-stat="${stat.key}" data-delta="-1" ${lvl <= 0 ? 'disabled' : ''}>−</button><button type="button" data-action="npcAllocateStat" data-npc-id="${_esc(n.id)}" data-stat="${stat.key}" data-delta="1" ${statSpent >= statBudget ? 'disabled' : ''}>＋</button></div></div>`;
    }).join('')}</div></section>
    <section class="npc-rd-card"><div class="npc-rd-cardhead"><div><h2>Équipement</h2><p>Les bonus sont intégrés aux valeurs calculées.</p></div></div>${_renderNpcEquip(n, _npcVitalTotals(n).equip, { dmg: weapon.damage, range: `${weapon.range}c` })}</section>`;
}

function _renderNpcSpellsRedesign(n) {
  return `<section class="npc-rd-card npc-rd-spells"><div class="npc-rd-cardhead"><div><h2>Deck de sorts</h2><p>Même éditeur que les personnages. Seuls les sorts préparés sont utilisables dans le VTT.</p></div></div>${_renderSpellDeck(n, true)}</section>`;
}

function _renderNpcBastionPlayer(n) {
  if (!isFeatureEnabled('bastion') || n.recrutable === false || _affiniteNiveau(n) < 3) return '';
  const activities = (n.activites || []).map(_actLabel);
  if (!activities.length && !n.passif && !n.salaireSuggere) return '';
  const canRecruit = _affiniteNiveau(n) >= 4;
  return `<section class="npc-rd-bastion is-readonly"><header class="npc-rd-bastion-head"><div><h2>${_npcUiIcon('bastion')} Bastion</h2><p>Profil de recrutement</p></div><span class="npc-rd-bastion-state${canRecruit ? ' is-on' : ''}">${canRecruit ? 'Recrutable' : 'Bientôt recrutable'}</span></header>${activities.length ? `<div class="npc-rd-bastion-activities">${activities.map(label => `<span class="is-on">${_esc(label)}</span>`).join('')}</div>` : ''}<div class="npc-rd-bastion-fields">${n.passif ? `<div><span>Passif d’employé</span><p>${_esc(n.passif)}</p></div>` : ''}${n.salaireSuggere ? `<div class="npc-rd-bastion-salary"><span>Salaire</span><b>${parseInt(n.salaireSuggere, 10) || 0} <small>or / sem.</small></b></div>` : ''}</div><footer>${canRecruit ? 'Ce PNJ peut rejoindre le Bastion.' : 'Recrutable une fois Allié.'}</footer></section>`;
}

function _renderNpcPlayerSheet(n) {
  const myChars = _npcMyCharacters();
  const myRows = _npcCrossRows(n).filter(row => myChars.some(c => c.id === row.character.id));
  return `<section class="npc-rd-card npc-rd-known"><small>Ce que l’on sait de ${_esc(n.nom || 'ce PNJ')}</small><p>${_esc(n.description || 'Rien de particulier n’est encore connu.')}</p></section>
    <section class="npc-rd-card"><div class="npc-rd-cardhead"><div><h2>Toi et ${_esc(n.nom || 'ce PNJ')}</h2><p>Ton ressenti est visible par tout le groupe et par le MJ.</p></div></div>${myRows.length ? myRows.map(row => `<div class="npc-rd-player-relation"><div class="npc-rd-player-relhead"><b>${_esc(row.character.nom || '?')}</b><span>${_renderNpcLevelChip(_npcExceptionLevel(n, row.exception, { player: true }) ?? _affiniteNiveau(n), { inherited: _npcExceptionLevel(n, row.exception, { player: true }) == null })}</span></div>${_renderNpcCrossEditor(n, row.character, row.exception, row.feeling, false)}</div>`).join('') : '<p class="npc-rd-empty">Aucun personnage lié à ce compte.</p>'}</section>
    ${_renderNpcCrossRelations(n, false)}
    ${_renderNpcBastionPlayer(n)}`;
}

function _renderFicheLegacyCurrent(n) {
  const af = afx(_affiniteNiveau(n));
  const adm = STATE.isAdmin;
  const level = Math.max(1, parseInt(n.niveau, 10) || 1);
  const { totals } = _npcVitalTotals(n);
  const pvBase = _npcBaseVital(n, 'pv'), pmBase = _npcBaseVital(n, 'pm');
  const deckMax = calcDeckMax(n);
  const deckUsage = getDeckUsage(_npcSpellList(n).map(spell => (
    spell && typeof spell.actif !== 'boolean' ? { ...spell, actif: true } : spell
  )));
  const deckActifs = deckUsage.used;
  const deckFree = deckUsage.free;
  const orgs = Array.isArray(n.organisations) ? n.organisations.filter(Boolean) : [];
  const initial = (n.nom || '?')[0].toUpperCase();
  const portraitInner = n.imageUrl ? `<img src="${_esc(n.imageUrl)}" alt="">` : `<span>${initial}</span>`;
  // Clic sur le portrait → voir l'image entière si présente, sinon (MJ) en choisir une.
  const portraitAct = n.imageUrl
    ? `data-action="npcViewPhoto" data-id="${_esc(n.id)}" title="Voir l'image complète"`
    : (adm ? `data-action="npcSetPhoto" data-id="${_esc(n.id)}" title="Ajouter un portrait"` : '');
  const bastion = _renderBastionProfil(n);

  // Barre vitale façon fiche perso : valeur actuelle (stepper) / max calculé + PV/PM de base modifiables.
  const vital = (kind, icon, label, max, base) => {
    const field = kind === 'pv' ? 'pvActuel' : 'pmActuel';
    const cur = Number.isFinite(n[field]) ? Math.max(0, Math.min(n[field], max)) : max;
    const pct = max > 0 ? Math.max(0, Math.min(100, Math.round(cur / max * 100))) : 0;
    const lbl = kind === 'pv' ? 'PV' : 'PM';
    const barCls = kind === 'pv' ? `vital-bar-fill${pct < 25 ? ' danger' : ''}` : 'vital-bar-fill';
    return `
    <div class="vital ${kind === 'pv' ? 'hp' : 'mp'}${kind === 'pv' && pct < 25 ? ' danger' : ''}">
      <div class="vital-icon">${icon}</div>
      <div class="vital-body">
        <div class="vital-head">
          <span class="vital-label">${label}</span>
          <span class="vital-num"><span>${cur}</span><span class="npc-vital-max">/ ${max}</span></span>
        </div>
        <div class="vital-bar"><div class="${barCls}" style="width:${pct}%"></div></div>
        <div class="vital-ctrls">
          ${adm
            ? `<div class="vital-current-control">
                <span class="vital-control-label">Valeur actuelle</span>
                <span class="vital-stepper">
                  <button class="vital-btn" data-action="npcAdjustVital" data-field="${field}" data-delta="-1" data-id="${_esc(n.id)}" title="Retirer 1 ${lbl}">−</button>
                  <button class="vital-btn plus" data-action="npcAdjustVital" data-field="${field}" data-delta="1" data-id="${_esc(n.id)}" title="Ajouter 1 ${lbl}">+</button>
                </span>
              </div>
              <label class="cs-vital-base-btn npc-vital-base" title="Modifier les ${lbl} de base">
                <span class="cs-vital-base-copy"><span>${lbl} de base</span></span>
                <input class="npc-inline npc-vital-base-inp" type="number" min="${kind === 'pv' ? 1 : 0}" max="999"
                  data-input="npcPreviewDerived" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="${kind}Base" value="${base}">
                <span class="cs-vital-base-edit" aria-hidden="true">✎</span>
              </label>`
            : `<div class="cs-vital-base-readonly"><span>${lbl} de base</span><strong>${base}</strong></div>`}
        </div>
      </div>
    </div>`;
  };

  const sidebar = `<aside class="id-side npc-id-side" data-aura="blue">
    <div class="id-identity">
      ${adm ? `<div class="id-actions-mini npc-id-actions" aria-label="Actions du PNJ">
        <button class="npc-photo-btn" title="Changer le portrait" data-action="npcSetPhoto" data-id="${_esc(n.id)}" aria-label="Changer le portrait"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button>
        <button class="id-default-btn${n.embauchable === false ? '' : ' is-on'}" title="${n.embauchable !== false ? 'Visible par les joueurs' : 'Caché des joueurs'}" data-action="npcToggleEmbauchable" data-id="${_esc(n.id)}">👁</button>
        <button class="id-del-btn" title="Supprimer ce PNJ" data-action="deleteNpc" data-id="${_esc(n.id)}">⌫</button>
      </div>` : ''}
      <div class="id-portrait-wrap">
        <div class="id-portrait" ${portraitAct}>${portraitInner}</div>
        <div class="id-lvl-badge">${adm
          ? `<button type="button" class="id-lvl-edit" data-action="npcEditLevel" data-id="${_esc(n.id)}" title="Modifier le niveau" style="background:none;border:none;color:inherit;font:inherit;letter-spacing:inherit;cursor:pointer;padding:0">Niv. <strong>${level}</strong></button>`
          : `Niv. <strong>${level}</strong>`}</div>
      </div>
      <div class="id-name-row">${adm
        ? `<input class="npc-inline id-name npc-id-name-inp" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="nom" value="${_esc(n.nom || '')}" placeholder="Nom du PNJ">`
        : `<span class="id-name">${_esc(n.nom || '?')}</span>`}</div>
      <span class="npc-id-relation" style="--tag:${af.couleur}">${af.icon} ${_esc(af.label)}</span>
      ${adm ? `<div class="npc-id-statut">
        ${[['', 'Vivant'], ['mort', 'Mort'], ['disparu', 'Disparu']].map(([v, lbl]) =>
          `<button type="button" class="${(n.statut || '') === v ? 'is-on' : ''}" data-action="npcSetStatut" data-id="${_esc(n.id)}" data-statut="${v}">${lbl}</button>`).join('')}
      </div>` : ''}
      <div class="npc-id-pills">${adm
        ? `<input class="npc-id-pill pill-role" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="role" value="${_esc(n.role || '')}" placeholder="+ Rôle" title="Rôle">
           <input class="npc-id-pill pill-lieu" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="lieu" value="${_esc(n.lieu || '')}" placeholder="+ Lieu" title="Lieu">
           <input class="npc-id-pill pill-orga" data-change="npcSaveOrgs" data-npc-id="${_esc(n.id)}" value="${_esc(orgs.join(', '))}" placeholder="+ Organisation" title="Organisation(s)">`
        : `${n.role ? `<span class="npc-id-pill pill-role">${_esc(n.role)}</span>` : ''}
           ${n.lieu ? `<span class="npc-id-pill pill-lieu">${_esc(n.lieu)}</span>` : ''}
           ${orgs.length ? `<span class="npc-id-pill pill-orga">${_esc(orgs.join(', '))}</span>` : ''}`}
      </div>
    </div>
    ${vital('pv', '❤', 'Points de Vie', totals.pv, pvBase)}
    ${vital('pm', '✦', 'Points de Magie', totals.pm, pmBase)}
    <div class="cs-mini-grid cs-mini-grid-3">
      <div class="cs-mini"><span class="cs-mini-icon">🛡️</span><span class="cs-mini-body"><span class="cs-mini-lbl">CA</span><span class="cs-mini-val" data-npc-derived="ca">${totals.ca}</span></span></div>
      <div class="cs-mini"><span class="cs-mini-icon">🏃</span><span class="cs-mini-body"><span class="cs-mini-lbl">Vit.</span><span class="cs-mini-val" data-npc-derived="vitesse">${totals.vitesse}m</span></span></div>
      <div class="cs-mini"><span class="cs-mini-icon">✦</span><span class="cs-mini-body"><span class="cs-mini-lbl">Deck</span><span class="cs-mini-val">${deckActifs}/${deckMax}${deckFree ? ` +${deckFree}` : ''}</span></span></div>
    </div>
    ${adm
      ? `<div class="npc-id-notes">
          <label class="npc-id-note"><span>Description publique</span><textarea class="npc-inline" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="description" rows="2" placeholder="Ce que les joueurs peuvent savoir…">${_esc(n.description || '')}</textarea></label>
          <label class="npc-id-note"><span>Notes MJ privées</span><textarea class="npc-inline npc-note-mj-field" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="noteMJ" rows="2" placeholder="Secrets, objectifs…">${_esc(n.noteMJ || '')}</textarea></label>
        </div>`
      : (n.description ? `<p class="npc-profile-public-desc">${_esc(n.description)}</p>` : '')}
  </aside>`;

  const tab = _npcSheetTab === 'sorts' ? 'sorts' : 'combat';
  const _tico = (id) => `<span class="tab-ico" aria-hidden="true"><svg class="cs-tab-svg"><use href="./assets/img/icons.svg#icon-${id}"/></svg></span>`;
  const tabsBar = `
    <nav class="tabs-v3 npc-sheet-tabs" role="tablist" aria-label="Sections du PNJ">
      <button type="button" class="tab-v3 ${tab === 'combat' ? 'active' : ''}" role="tab" aria-selected="${tab === 'combat'}" data-action="npcSetTab" data-tab="combat" data-nav-page="npcs" data-nav-sub="${_esc(_npcRouteSub(_activeId, 'combat'))}">
        ${_tico('sword')} Combat</button>
      <button type="button" class="tab-v3 ${tab === 'sorts' ? 'active' : ''}" role="tab" aria-selected="${tab === 'sorts'}" data-action="npcSetTab" data-tab="sorts" data-nav-page="npcs" data-nav-sub="${_esc(_npcRouteSub(_activeId, 'sorts'))}">
        ${_tico('sparkles')} Sorts <span class="tab-badge">${deckActifs}/${deckMax}${deckFree ? ` +${deckFree}` : ''}</span></button>
    </nav>`;
  // Onglet Sorts actif → le PNJ devient l'hôte du moteur de sorts (édition +
  // enregistrement sur son doc). Sinon on relâche l'hôte (comportement joueur).
  if (adm && tab === 'sorts') {
    // Le moteur partagé attend `deck_sorts`. Cette normalisation en mémoire
    // rend aussi les anciennes actions PNJ éditables sans écriture automatique.
    // Avant l'existence du Deck, `actif` n'était pas stocké : ces sorts étaient
    // disponibles en combat et doivent donc apparaître préparés dans l'interface.
    n.deck_sorts = _npcSpellList(n).map(spell => (
      spell && typeof spell === 'object' && typeof spell.actif !== 'boolean'
        ? { ...spell, actif: true }
        : spell
    ));
    n.__spellCol = 'npcs';
    setNpcSpellHost(n, () => _refreshActivePanel());
  } else {
    clearSpellHost();
  }
  const tabBody = tab === 'sorts' ? _renderNpcSpellsTab(n) : _renderNpcEquipmentSection(n);

  // Le Cercle des relations reste DANS la colonne, mais dans une zone à part
  // (fond/matière distincts + retrait) pour ne pas lire comme une énième carte.
  const social = `<div class="npc-hub-wrap">${_renderNpcRelationHub(n, af)}</div>`;

  const main = `<div class="main-col npc-main-col">
    ${adm ? `<section class="npc-character-stats">${_renderNpcStatsBanner(n)}</section>` : ''}
    ${adm ? tabsBar : ''}
    ${adm ? `<div class="npc-tab-body">${tabBody}</div>` : ''}
    ${social}
    ${bastion}
  </div>`;

  return `
  <article class="npc-sheet cs-v3" style="${_afVars(af)}">
    <div class="sheet npc-sheet-grid">
      ${sidebar}
      ${main}
    </div>
  </article>`;
}
function _renderNpcSectionHead(kicker, title, meta = '') {
  return `
    <div class="npc-section-head">
      <div>
        <small>${_esc(kicker)}</small>
        <strong>${_esc(title)}</strong>
      </div>
      ${meta ? `<span>${_esc(meta)}</span>` : ''}
    </div>`;
}

function _renderNpcStatsSection(n) {
  return `
    <section class="npc-character-stats">
      ${_renderNpcDerivedControls(n)}
      ${_renderNpcStatsBanner(n)}
    </section>`;
}

function _renderNpcDerivedControls(n) {
  const { totals } = _npcVitalTotals(n);
  const level = Math.max(1, parseInt(n?.niveau, 10) || 1);
  return `
    <div class="npc-derived-controls">
      <label class="npc-derived-field is-level">
        <span>Niveau</span>
        <input type="number" min="1" max="99" class="npc-inline" data-input="npcPreviewDerived" data-change="npcInlineSave"
          data-npc-id="${_esc(n.id)}" data-field="niveau" value="${level}">
      </label>
      <label class="npc-derived-field">
        <span>PV de base</span>
        <input type="number" min="1" class="npc-inline" data-input="npcPreviewDerived" data-change="npcInlineSave"
          data-npc-id="${_esc(n.id)}" data-field="pvBase" value="${_npcBaseVital(n, 'pv')}">
        <small><b data-npc-derived="pv">${totals.pv}</b> max</small>
      </label>
      <label class="npc-derived-field">
        <span>PM de base</span>
        <input type="number" min="0" class="npc-inline" data-input="npcPreviewDerived" data-change="npcInlineSave"
          data-npc-id="${_esc(n.id)}" data-field="pmBase" value="${_npcBaseVital(n, 'pm')}">
        <small><b data-npc-derived="pm">${totals.pm}</b> max</small>
      </label>
      <div class="npc-derived-field is-calculated"><span>Classe d'armure</span><b data-npc-derived="ca">${totals.ca}</b><small>Calcul aventure</small></div>
      <div class="npc-derived-field is-calculated"><span>Vitesse</span><b data-npc-derived="vitesse">${totals.vitesse}</b><small>Calcul aventure</small></div>
    </div>`;
}

function _renderNpcEquipmentSection(n) {
  const { equip } = _npcVitalTotals(n);
  const weaponInfo = _npcWeaponInfo(n);
  // Les actions VTT du PNJ vivent désormais dans l'onglet Sorts (deck) → plus de
  // bloc « Actions PNJ » ici, qui faisait doublon.
  return `
    <section class="npc-character-combat">
      ${_renderNpcEquip(n, equip, { dmg: weaponInfo.damage, range: `${weaponInfo.range}c` })}
    </section>`;
}

// Onglet Sorts du PNJ = MÊME rendu que la fiche perso (renderCharDeck), mais
// l'entité hôte est le PNJ : ses sorts vivent sur son doc (npcs/{id}.deck_sorts).
// L'hôte est posé dans _renderFiche (setNpcSpellHost) → toute édition (ajout,
// runes, PM, catégories…) opère sur le PNJ et enregistre dans la collection npcs.
function _renderNpcSpellsTab(n) {
  return `<section class="npc-character-combat npc-spells-tab">${_renderSpellDeck(n, STATE.isAdmin)}</section>`;
}

function _renderNpcProfileHeader(n, af) {
  const adm = STATE.isAdmin;
  const initial = (n.nom || '?')[0].toUpperCase();
  const orgs = Array.isArray(n.organisations) ? n.organisations.filter(Boolean) : [];
  const status = NPC_STATUTS[n.statut]?.lbl || 'Vivant';
  const relationCount = _affiPerso.filter(a => a.npcId === n.id).length;
  const timelineCount = Array.isArray(n.affinite?.historique) ? n.affinite.historique.length : 0;
  const actionCount = Array.isArray(n.actions) ? n.actions.length : 0;
  const portraitInner = n.imageUrl ? `<img src="${n.imageUrl}" alt="">` : `<span>${initial}</span>`;
  const portrait = n.imageUrl
    ? `<button class="npc-profile-portrait" data-action="npcViewPhoto" data-id="${_esc(n.id)}" title="Voir l'image complete">${portraitInner}</button>`
    : (adm
      ? `<button class="npc-profile-portrait" data-action="npcSetPhoto" data-id="${_esc(n.id)}" title="Ajouter un portrait">${portraitInner}</button>`
      : `<div class="npc-profile-portrait">${portraitInner}</div>`);
  const vitals = adm ? (() => {
    const { equipBonus, totals } = _npcVitalTotals(n);
    return `<div class="npc-profile-vitals">
      ${NPC_VITALS.map(v => {
        const base = _npcBaseVital(n, v.key);
        const bonus = equipBonus[v.key] || 0;
        return `<div>
          <span>${_esc(v.label)}</span>
          <b>${totals[v.key]}</b>
          <small>${base}${bonus ? ` ${_signedNum(bonus)}` : ''}</small>
        </div>`;
      }).join('')}
    </div>`;
  })() : '';
  const statusControls = adm ? `
    <div class="npc-profile-status">
      ${[['', 'Vivant'], ['mort', 'Mort'], ['disparu', 'Disparu']].map(([v, lbl]) =>
        `<button type="button" class="${(n.statut || '') === v ? 'is-on' : ''}" data-action="npcSetStatut" data-id="${_esc(n.id)}" data-statut="${v}">${lbl}</button>`).join('')}
    </div>` : '';
  const notes = adm ? `
    <div class="npc-profile-notes">
      <label>
        <span>Description publique</span>
        <textarea class="npc-inline" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="description" rows="2" placeholder="Ce que les joueurs peuvent savoir...">${_esc(n.description || '')}</textarea>
      </label>
      <label>
        <span>Notes MJ privees</span>
        <textarea class="npc-inline npc-note-mj-field" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="noteMJ" rows="2" placeholder="Secrets, objectifs, revelations...">${_esc(n.noteMJ || '')}</textarea>
      </label>
    </div>` : (n.description ? `<p class="npc-profile-public-desc">${_esc(n.description)}</p>` : '');
  return `
    <header class="npc-profile-head${adm ? '' : ' is-public'}">
      <div class="npc-profile-portrait-wrap">
        ${portrait}
        <span class="npc-profile-relation" style="--tag:${af.couleur}">${af.icon} ${_esc(af.label)}</span>
      </div>
      <div class="npc-profile-core">
        <div class="npc-profile-title-row">
          <div class="npc-profile-title">
            ${adm
              ? `<input class="npc-inline npc-profile-name" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="nom" value="${_esc(n.nom || '')}" placeholder="Nom du PNJ">`
              : `<h2 class="npc-profile-name">${_esc(n.nom || '?')}</h2>`}
            <div class="npc-profile-subtitle">${_esc([n.role, n.lieu].filter(Boolean).join(' - ') || 'Dossier a completer')}</div>
          </div>
          ${adm ? `
          <div class="npc-profile-actions">
            <button type="button" class="${n.embauchable === false ? 'is-muted' : ''}" data-action="npcToggleEmbauchable" data-id="${_esc(n.id)}" title="${n.embauchable !== false ? 'Visible joueurs' : 'Cache joueurs'}">&#128065;</button>
            <button type="button" data-action="npcSetPhoto" data-id="${_esc(n.id)}" title="${n.imageUrl ? 'Changer le portrait' : 'Ajouter un portrait'}">&#128247;</button>
            <button type="button" class="is-danger" data-action="deleteNpc" data-id="${_esc(n.id)}" title="Supprimer">X</button>
          </div>` : ''}
        </div>
        ${adm ? `
        <div class="npc-profile-fields">
          <label><span>Role</span><input class="npc-inline" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="role" value="${_esc(n.role || '')}" placeholder="Role"></label>
          <label><span>Lieu</span><input class="npc-inline" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="lieu" value="${_esc(n.lieu || '')}" placeholder="Lieu"></label>
          <label><span>Organisations</span><input class="npc-inline" data-change="npcSaveOrgs" data-npc-id="${_esc(n.id)}" value="${_esc(orgs.join(', '))}" placeholder="Organisation, faction..."></label>
        </div>` : (orgs.length ? `<div class="npc-profile-orgs">${orgs.slice(0, 5).map(o => `<span>${_esc(o)}</span>`).join('')}</div>` : '')}
        <div class="npc-profile-facts">
          <span>${_esc(status)}</span>
          <span>${relationCount} relation${relationCount > 1 ? 's' : ''}</span>
          <span>${timelineCount} evenement${timelineCount > 1 ? 's' : ''}</span>
          ${adm ? `<span>${actionCount} action${actionCount > 1 ? 's' : ''} VTT</span>` : ''}
          ${n.embauchable === false && adm ? '<span>Cache joueurs</span>' : ''}
        </div>
        ${statusControls}
        ${notes}
      </div>
      ${vitals}
    </header>`;
}

function _renderNpcStatsBanner(n) {
  const stats = _npcBaseStats(n);
  const levelUps = n?.statsLevelUps || {};
  const equipBonus = computeEquipStatsBonus(n?.equipement || {});
  const level = Math.max(1, parseInt(n?.niveau, 10) || 1);
  const spent = NPC_STATS.reduce((sum, stat) => sum + (parseInt(levelUps[stat.key], 10) || 0), 0);
  const remaining = Math.max(0, level - 1 - spent);
  // Synthèse et tuiles calquées sur la fiche personnage. Le PNJ conserve
  // toutefois son champ « base » éditable directement par le MJ.
  const _sum = NPC_STATS.reduce((t, stat) => {
    const stored = parseInt(stats[stat.key], 10);
    const val = Number.isFinite(stored) ? stored : 10;
    const lvl = Math.max(0, parseInt(levelUps[stat.key], 10) || 0);
    const eq = equipBonus[stat.key] || 0;
    t.base += val - lvl; t.level += lvl; t.equipment += eq; t.total += val + eq;
    return t;
  }, { base: 0, level: 0, equipment: 0, total: 0 });
  const _signed = v => v > 0 ? `+${v}` : String(v);
  const summaryHtml = `<div class="stats-summary" title="Somme des six caractéristiques du PNJ">
    <div class="stats-summary-title"><span>Points de caractéristiques</span><strong>${_sum.total}</strong></div>
    <div class="stats-summary-formula" aria-label="Base ${_sum.base}, niveau ${_sum.level}, équipement ${_sum.equipment}, total ${_sum.total}">
      <span><small>Base</small><b>${_sum.base}</b></span><i>+</i>
      <span><small>Niveau</small><b>${_signed(_sum.level)}</b></span><i>+</i>
      <span><small>Équip.</small><b class="${_sum.equipment > 0 ? 'pos' : _sum.equipment < 0 ? 'neg' : ''}">${_signed(_sum.equipment)}</b></span><i>=</i>
      <span class="is-total"><small>Total</small><b>${_sum.total}</b></span>
    </div>
  </div>`;
  return `
    <div class="stats-banner">
      ${summaryHtml}
      ${NPC_STATS.map(s => {
        const stored = parseInt(stats[s.key], 10);
        const safeStored = Number.isFinite(stored) ? stored : 10;
        const levelUp = Math.max(0, parseInt(levelUps[s.key], 10) || 0);
        const safeBase = safeStored - levelUp;
        const bonus = equipBonus[s.key] || 0;
        const total = safeStored + bonus;
        const mod = _npcEffectiveMod(n, s.key);
        const mCls = mod > 0 ? 'pos' : mod < 0 ? 'neg' : 'zero';
        const bCls = bonus > 0 ? 'pos' : bonus < 0 ? 'neg' : 'zero';
        const bDisp = bonus > 0 ? `+${bonus}` : bonus < 0 ? String(bonus) : '+0';
        const canPlus = remaining > 0;
        const canMinus = levelUp > 0;
        const full = _esc(NPC_STAT_LABELS[s.key] || s.key);
        return `
          <div class="stat-tile${canPlus ? ' is-alloc' : ''}" data-stat="${_esc(s.key)}"
            title="${full} — base ${safeBase} + niveau +${levelUp} + équip. ${bDisp} = ${total}">
            ${canPlus ? `<span class="stat-alloc" title="${remaining} point(s) de niveau à dépenser">${remaining}</span>` : ''}
            <span class="stat-tile-abbr">${_esc(s.short)}</span>
            <span class="stat-tile-total">${total}</span>
            <span class="stat-tile-mod ${mCls}">${mod >= 0 ? '+' + mod : mod}</span>
            <span class="stat-tile-detail">
              <label class="npc-stat-base-detail" title="MJ — modifier la base de ${full}">base
                <input type="number" class="npc-inline npc-stat-base-input" data-change="npcInlineSave"
                  data-npc-id="${_esc(n.id)}" data-field="statBase:${_esc(s.key)}" value="${safeBase}" aria-label="Valeur de base — ${full}">
              </label>
              <span>eq <b class="${bCls}">${bDisp}</b></span>
            </span>
            <div class="stat-lvl-ctrls" role="group" aria-label="Points de niveau — ${full}">
              <button class="stat-lvl-btn minus" type="button" ${canMinus ? '' : 'disabled'} data-action="npcAllocateStat" data-npc-id="${_esc(n.id)}" data-stat="${_esc(s.key)}" data-delta="-1" title="Retirer 1 point de niveau" aria-label="Retirer 1 point de niveau sur ${full}">−</button>
              <span class="stat-lvl-val" title="Points de niveau alloués"><small>niv</small> <b>${levelUp > 0 ? '+' : ''}${levelUp}</b></span>
              <button class="stat-lvl-btn plus" type="button" ${canPlus ? '' : 'disabled'} data-action="npcAllocateStat" data-npc-id="${_esc(n.id)}" data-stat="${_esc(s.key)}" data-delta="1" title="Dépenser 1 point de niveau" aria-label="Ajouter 1 point de niveau sur ${full}">+</button>
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

function _npcPanelDefs() {
  const defs = [
    { id: 'dossier', label: 'Dossier', hint: 'carnet' },
    ...(STATE.isAdmin ? [{ id: 'tactique', label: 'Tactique', hint: 'VTT' }] : []),
    { id: 'relations', label: 'Relations', hint: 'liens' },
    { id: 'chronologie', label: 'Chronologie', hint: 'journal' },
  ];
  if (!defs.some(d => d.id === _npcPanel)) _npcPanel = defs[0].id;
  return defs;
}

function _renderNpcPanelTabs() {
  return `
    <nav class="tabs-v3 npc-tabs-v3" role="tablist" aria-label="Sections de la fiche PNJ">
      ${_npcPanelDefs().map(tab => `
        <button type="button" class="${_npcPanel === tab.id ? 'is-active' : ''}" data-action="npcSetPanel" data-panel="${tab.id}"
          data-nav-page="npcs" data-nav-sub="${_esc(_npcRouteSub(_activeId, NPC_ROUTE_ALIASES[tab.id] || _npcSheetTab))}"
          role="tab" aria-selected="${_npcPanel === tab.id}">
          <span>${_esc(tab.label)}</span>
          <small>${_esc(tab.hint)}</small>
        </button>`).join('')}
    </nav>`;
}

function _renderNpcPanelContent(n, af) {
  const panel = _npcPanelDefs().some(d => d.id === _npcPanel) ? _npcPanel : 'dossier';
  if (panel === 'tactique') return _renderNpcTacticalDesk(n) || _renderNpcEmptyPanel('Tactique indisponible.');
  if (panel === 'relations') {
    const html = `${_renderNpcRelationDesk(n, af)}${_renderNpcPeopleDesk(n) || ''}`;
    return html || _renderNpcEmptyPanel('Aucune relation connue pour ce PNJ.');
  }
  if (panel === 'chronologie') return _renderNpcTimelineDesk(n);
  return _renderNpcDossierOverview(n, af) || _renderNpcEmptyPanel('Aucune information publique pour ce PNJ.');
}

function _renderNpcEmptyPanel(text) {
  return `<section class="npc-work-card npc-empty-panel">${_esc(text)}</section>`;
}

function _npcSetPanel(panel, { syncRoute = true } = {}) {
  _npcPanel = 'fiche';
  _npcSheetTab = NPC_ROUTE_ALIASES[panel] || (NPC_ROUTE_SHEET_TABS.includes(panel) ? panel : 'fiche');
  if (syncRoute) _syncNpcRoute();
  _refreshActivePanel();
}

function _npcSetSheetTab(sheetTab, { syncRoute = true } = {}) {
  if (!NPC_ROUTE_SHEET_TABS.includes(sheetTab)) return;
  _npcSheetTab = sheetTab;
  if (syncRoute) _syncNpcRoute();
  _refreshActivePanel();
}

function _renderNpcDossierOverview(n, af) {
  const story = _renderNpcStoryDesk(n);
  const timeline = _renderNpcTimelinePreview(n);
  return `
    <div class="npc-dossier-overview">
      <div class="npc-overview-main">
        ${story || ''}
      </div>
      <aside class="npc-overview-side">
        ${_renderNpcSignalCard(n, af)}
        ${timeline}
      </aside>
    </div>`;
}

function _renderNpcSignalCard(n, af) {
  const orgs = Array.isArray(n.organisations) ? n.organisations.filter(Boolean) : [];
  const relationCount = _affiPerso.filter(a => a.npcId === n.id).length;
  const histoCount = Array.isArray(n.affinite?.historique) ? n.affinite.historique.length : 0;
  const actionCount = Array.isArray(n.actions) ? n.actions.length : 0;
  const infos = [
    ['Relation', `${af.icon} ${af.label}`],
    ['Relations perso.', relationCount],
    ['Chronique', histoCount],
    ...(STATE.isAdmin ? [['Actions VTT', actionCount]] : []),
  ];
  return `
    <section class="npc-work-card npc-signal-card">
      <div class="npc-work-card-head">
        <div><small>Synthese</small><strong>Ce qu'il faut retenir</strong></div>
      </div>
      <div class="npc-signal-grid">
        ${infos.map(([label, value]) => `<div><span>${_esc(label)}</span><b>${_esc(value)}</b></div>`).join('')}
      </div>
      ${orgs.length ? `<div class="npc-signal-orgs">${orgs.slice(0, 6).map(o => `<span>${_esc(o)}</span>`).join('')}</div>` : ''}
    </section>`;
}

function _renderNpcTimelinePreview(n) {
  const histo = Array.isArray(n.affinite?.historique) ? n.affinite.historique : [];
  const latest = histo.slice().reverse().slice(0, 4);
  return `
    <section class="npc-work-card npc-timeline-preview">
      <div class="npc-work-card-head">
        <div><small>Derniers faits</small><strong>${histo.length ? `${histo.length} entree${histo.length > 1 ? 's' : ''}` : 'Aucune entree'}</strong></div>
        <button type="button" class="npc-card-act npc-card-act--ghost" data-action="npcSetPanel" data-panel="chronologie">Ouvrir</button>
      </div>
      <div class="npc-preview-list">
        ${latest.length ? latest.map(h => {
          const delta = Number(h.delta) || 0;
          return `<div class="npc-preview-row">
            <b class="${delta > 0 ? 'is-good' : delta < 0 ? 'is-bad' : ''}">${delta > 0 ? '+' + delta : delta || '~'}</b>
            <span>${_esc(h.texte || 'Evenement sans titre')}</span>
          </div>`;
        }).join('') : '<p>Aucun evenement pour le moment.</p>'}
      </div>
    </section>`;
}

function _renderNpcIdentityPanel(n, af) {
  const adm = STATE.isAdmin;
  const initial = (n.nom || '?')[0].toUpperCase();
  const portraitInner = n.imageUrl ? `<img src="${n.imageUrl}" alt="">` : `<span>${initial}</span>`;
  const portraitMain = n.imageUrl
    ? `<button class="npc-dossier-portrait npc-dossier-portrait--btn" data-action="npcViewPhoto" data-id="${n.id}" title="Voir l'image complete">${portraitInner}</button>`
    : (adm
        ? `<button class="npc-dossier-portrait npc-dossier-portrait--btn" data-action="npcSetPhoto" data-id="${n.id}" title="Ajouter un portrait">${portraitInner}</button>`
        : `<div class="npc-dossier-portrait">${portraitInner}</div>`);
  const orgs = Array.isArray(n.organisations) ? n.organisations.filter(Boolean) : [];
  const status = NPC_STATUTS[n.statut]?.lbl || 'Vivant';
  const relationCount = _affiPerso.filter(a => a.npcId === n.id).length;
  const timelineCount = Array.isArray(n.affinite?.historique) ? n.affinite.historique.length : 0;
  const hasVtt = n.pv || n.pm || n.ca || n.vitesse || Object.keys(n.stats || {}).length || Object.keys(n.equipement || {}).length || (n.actions || []).length;
  return `
    <section class="npc-identity-card">
      <div class="npc-identity-actions">
        ${adm ? `<button class="npc-mini-btn ${n.embauchable === false ? 'npc-mini-btn--off' : ''}" data-action="npcToggleEmbauchable" data-id="${n.id}">${n.embauchable !== false ? 'Visible joueurs' : 'Cache joueurs'}</button>` : ''}
        ${adm ? `<button class="npc-mini-btn npc-mini-btn--danger" data-action="deleteNpc" data-id="${n.id}">Supprimer</button>` : ''}
      </div>
      <div class="npc-dossier-portrait-box">
        ${portraitMain}
        ${adm ? `<button class="npc-portrait-edit" data-action="npcSetPhoto" data-id="${n.id}" title="${n.imageUrl ? 'Changer le portrait' : 'Ajouter un portrait'}">📷</button>` : ''}
      </div>
      <div class="npc-identity-nameblock">
        ${adm
          ? `<input class="npc-inline npc-identity-name" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="nom" value="${_esc(n.nom || '')}" placeholder="Nom du PNJ">`
          : `<h2 class="npc-identity-name">${_esc(n.nom || '?')}</h2>`}
        <div class="npc-identity-sub">${_esc([n.role, n.lieu].filter(Boolean).join(' - ') || 'Dossier a completer')}</div>
      </div>
      <div class="npc-identity-pills">
        <span>${af.icon} ${af.label}</span>
        <span>${_esc(status)}</span>
        ${hasVtt ? '<span>VTT pret</span>' : ''}
        ${n.embauchable === false && adm ? '<span>Cache</span>' : ''}
      </div>
      ${adm ? `
      <div class="npc-identity-fields">
        <label><span>Role</span><input class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="role" value="${_esc(n.role || '')}" placeholder="Role"></label>
        <label><span>Lieu</span><input class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="lieu" value="${_esc(n.lieu || '')}" placeholder="Lieu"></label>
        <label class="is-wide"><span>Organisations</span><input class="npc-inline" data-change="npcSaveOrgs" data-npc-id="${n.id}" value="${_esc(orgs.join(', '))}" placeholder="Organisations"></label>
      </div>` : (orgs.length ? `<div class="npc-identity-orgs">${orgs.slice(0, 4).map(o => `<span>${_esc(o)}</span>`).join('')}</div>` : '')}
      <div class="npc-identity-facts">
        <div><b>${relationCount}</b><span>relations</span></div>
        <div><b>${timelineCount}</b><span>evenements</span></div>
        <div><b>${hasVtt ? 'oui' : 'non'}</b><span>vtt</span></div>
      </div>
    </section>`;
}

function _renderNpcWorkHeader(n, af) {
  const adm = STATE.isAdmin;
  const initial = (n.nom || '?')[0].toUpperCase();
  const portraitInner = n.imageUrl ? `<img src="${n.imageUrl}" alt="">` : `<span>${initial}</span>`;
  const portraitMain = n.imageUrl
    ? `<button class="npc-work-portrait npc-work-portrait--btn" data-action="npcViewPhoto" data-id="${n.id}" title="Voir l'image complète">${portraitInner}</button>`
    : (adm
        ? `<button class="npc-work-portrait npc-work-portrait--btn" data-action="npcSetPhoto" data-id="${n.id}" title="Ajouter un portrait">${portraitInner}</button>`
        : `<div class="npc-work-portrait">${portraitInner}</div>`);
  const portrait = `<div class="npc-work-portrait-box">${portraitMain}${adm ? `<button class="npc-portrait-edit" data-action="npcSetPhoto" data-id="${n.id}" title="${n.imageUrl ? 'Changer le portrait' : 'Ajouter un portrait'}">📷</button>` : ''}</div>`;
  const orgs = Array.isArray(n.organisations) ? n.organisations.filter(Boolean) : [];
  const status = NPC_STATUTS[n.statut]?.lbl || 'Vivant';
  return `
    <header class="npc-work-head">
      ${portrait}
      <div class="npc-work-id">
        ${adm
          ? `<input class="npc-inline npc-work-name" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="nom" value="${_esc(n.nom || '')}" placeholder="Nom du PNJ">`
          : `<h2 class="npc-work-name">${_esc(n.nom || '?')}</h2>`}
        <div class="npc-work-fields">
          ${adm
            ? `<input class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="role" value="${_esc(n.role || '')}" placeholder="Rôle">
               <input class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="lieu" value="${_esc(n.lieu || '')}" placeholder="Lieu">
               <input class="npc-inline" data-change="npcSaveOrgs" data-npc-id="${n.id}" value="${_esc(orgs.join(', '))}" placeholder="Organisations">`
            : `<span>${_esc(n.role || 'Rôle inconnu')}</span><span>${_esc(n.lieu || 'Lieu inconnu')}</span>${orgs.length ? `<span>${orgs.map(_esc).join(', ')}</span>` : ''}`}
        </div>
        <div class="npc-work-tags">
          <span>${af.icon} ${af.label}</span>
          <span>${_esc(status)}</span>
          ${orgs.slice(0, 2).map(o => `<span>${_esc(o)}</span>`).join('')}
          ${n.embauchable === false && adm ? '<span>Caché joueurs</span>' : ''}
        </div>
      </div>
      ${adm ? `
      <div class="npc-work-actions">
        <button class="npc-mini-btn ${n.embauchable === false ? 'npc-mini-btn--off' : ''}" data-action="npcToggleEmbauchable" data-id="${n.id}">${n.embauchable !== false ? 'Visible joueurs' : 'Caché joueurs'}</button>
        <button class="npc-mini-btn npc-mini-btn--danger" data-action="deleteNpc" data-id="${n.id}">Supprimer</button>
      </div>` : ''}
    </header>`;
}

function _renderNpcRelationDesk(n, af) {
  const niv    = _affiniteNiveau(n);
  const valeur = Number(n.affinite?.valeur) || 0;
  const isValeur = _affiniteMode(n) === 'valeur';
  const editable = STATE.isAdmin && !isValeur;   // clic = régler le niveau (mode groupe)
  const segments = AFFINITE.map((a, i) => {
    const cls = `npc-rel-seg${i <= niv ? ' is-on' : ''}${i === niv ? ' is-current' : ''}`;
    if (editable) {
      return `<button type="button" class="${cls}" style="--seg:${a.couleur}"
        data-action="npcSetAffiniteNiveau" data-id="${n.id}" data-niveau="${i}"
        title="${a.icon} ${_esc(a.label)} — définir">${a.label}</button>`;
    }
    return `<span class="${cls}" style="--seg:${a.couleur}">${a.label}</span>`;
  }).join('');
  return `
    <section class="npc-work-card npc-work-card--relation" style="${_afVars(af)}">
      <div class="npc-work-card-head">
        <div><small>Relation groupe</small><strong>${af.icon} ${af.label}</strong></div>
        ${STATE.isAdmin ? `<button class="npc-card-act npc-card-act--ghost" data-action="openAffiniteSeuilsModal" title="Seuils d'affinité (mode valeur)">Seuils</button>` : ''}
      </div>
      <div class="npc-relation-scale">${segments}</div>
      ${editable ? `<div class="npc-relation-hint">Clique un niveau pour définir la posture du PNJ envers le groupe.</div>` : ''}
      <div class="npc-relation-state">
        <p>${_esc(af.desc || '')}</p>
        ${STATE.isAdmin && isValeur ? `<b title="Valeur d'affinité cumulée">${valeur > 0 ? '+' + valeur : valeur}</b>` : ''}
      </div>
      ${STATE.isAdmin ? `
      <div class="npc-relation-edit">
        <textarea class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="affinite.note"
          rows="2" placeholder="Note de relation (pourquoi cette posture, ce qui pourrait la changer...)">${_esc(n.affinite?.note || '')}</textarea>
      </div>` : (n.affinite?.note ? `<div class="npc-af-note">${_esc(n.affinite.note)}</div>` : '')}
    </section>`;
}

function _renderNpcStoryDesk(n) {
  if (STATE.isAdmin) {
    return `
      <section class="npc-work-card npc-work-card--story">
        <div class="npc-work-card-head"><div><small>Carnet</small><strong>Public et privé</strong></div></div>
        <div class="npc-story-split">
          <label><span>Description publique</span><textarea class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="description" rows="6" placeholder="Ce que les joueurs peuvent savoir...">${_esc(n.description || '')}</textarea></label>
          <label><span>Notes MJ</span><textarea class="npc-inline npc-note-mj-field" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="noteMJ" rows="6" placeholder="Secrets, objectifs, révélations...">${_esc(n.noteMJ || '')}</textarea></label>
        </div>
        <div class="npc-statut-bar npc-statut-bar--panel">
          <span class="npc-edit-lbl">Statut</span>
          <div class="npc-statut-seg">
            ${[['', 'Vivant'], ['mort', 'Mort'], ['disparu', 'Disparu']].map(([v, lbl]) =>
              `<button type="button" class="npc-statut-btn ${(n.statut || '') === v ? 'is-on' : ''}" data-action="npcSetStatut" data-id="${n.id}" data-statut="${v}">${lbl}</button>`).join('')}
          </div>
        </div>
      </section>`;
  }
  return n.description ? `<section class="npc-work-card npc-work-card--story"><div class="npc-desc">${_esc(n.description)}</div></section>` : '';
}

function _renderNpcTimelineDesk(n) {
  const histo = n.affinite?.historique || [];
  return `
    <section class="npc-work-card npc-work-card--timeline">
      <div class="npc-work-card-head"><div><small>Chronologie</small><strong>${histo.length ? `${histo.length} événements` : 'Aucun événement'}</strong></div></div>
      ${STATE.isAdmin ? `
      <div class="npc-timeline-compose">
        <input type="number" class="npc-inline npc-event-delta" id="afg-d-${n.id}" placeholder="+/-" title="Variation d'affinité">
        <input type="text" class="npc-inline npc-event-text" id="afg-e-${n.id}" placeholder="Ce qui vient de se passer dans l'histoire...">
        <button class="npc-event-btn" data-action="npcAddEvent" data-id="${n.id}">Ajouter à la chronologie</button>
      </div>` : ''}
      <div class="npc-work-timeline">
        ${histo.length ? histo.slice().reverse().map((h, reversedIndex) => {
          const realIndex = histo.length - 1 - reversedIndex;
          const d = Number(h.delta) || 0;
          return `<div class="npc-work-timeline-row">
            <b class="${d > 0 ? 'is-good' : d < 0 ? 'is-bad' : ''}">${d > 0 ? '+' + d : d || '~'}</b>
            <span>${h.texte ? _esc(h.texte) : 'Événement sans titre'}</span>
            ${h.date ? `<small>${_esc(h.date)}</small>` : ''}
            ${STATE.isAdmin ? `<button class="npc-icon-btn" data-action="editHistoriqueEntry" data-npc-id="${n.id}" data-idx="${realIndex}">Edit</button>` : ''}
          </div>`;
        }).join('') : '<div class="npc-work-timeline-empty">Aucun événement pour le moment. Ajoute le premier directement ici.</div>'}
      </div>
    </section>`;
}

function _renderNpcTacticalDesk(n) {
  if (!STATE.isAdmin) return '';
  const stats = _npcBaseStats(n);
  const { equip, sBonus, setData, equipBonus, totals } = _npcVitalTotals(n);
  const weaponInfo = _npcWeaponInfo(n);
  const vitals = NPC_VITALS.map(v => {
    const base = _npcBaseVital(n, v.key);
    const bonus = equipBonus[v.key] || 0;
    return `<label class="npc-tactic-cell">
      <span>${v.label}</span>
      <input type="number" class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="${v.key}" value="${base}" placeholder="${base}">
      <em title="Total avec equipement">${totals[v.key]}${bonus ? ` (${_signedNum(bonus)})` : ''}</em>
    </label>`;
  }).join('');
  const statCells = NPC_STATS.map(s => {
    const score = stats[s.key];
    const bonus = sBonus[s.key] || 0;
    const effScore = _npcEffectiveStat(n, s.key);
    return `<label class="npc-tactic-cell npc-tactic-cell--stat">
      <span>${s.short}</span>
      <input type="number" class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="stat:${s.key}" value="${score}" placeholder="${score}">
      <small>${_modStr(effScore)}${bonus ? ` (${_signedNum(bonus)})` : ''}</small>
    </label>`;
  }).join('');
  return `
    <section class="npc-work-card npc-work-card--tactic">
      <div class="npc-work-card-head"><div><small>VTT</small><strong>Fiche tactique</strong></div><span>${_esc(weaponInfo.damage)} / ${_esc(weaponInfo.range)}c</span></div>
      <div class="npc-tactic-summary">
        <div><small>Arme</small><b>${_esc(weaponInfo.weapon?.nom || 'Poings')}</b><span>${_esc(weaponInfo.damage)} (${_esc(weaponInfo.dmgStatLabel || 'FOR')})</span></div>
        <div><small>Toucher</small><b>${_signedNum(weaponInfo.touch)}</b><span>${_esc(weaponInfo.touchStatLabel || 'FOR')}</span></div>
        <div><small>Set</small><b>${setData?.isActive ? 'Actif' : 'Aucun'}</b><span>${_esc(getArmorSetChipText(setData) || 'pas de set complet')}</span></div>
      </div>
      <div class="npc-tactic-section">
        <div class="npc-tactic-section-title"><span>Ressources</span><small>base + equipement</small></div>
        <div class="npc-tactic-grid">${vitals}</div>
      </div>
      <div class="npc-tactic-section">
        <div class="npc-tactic-section-title"><span>Caracteristiques</span><small>score + modificateur</small></div>
        <div class="npc-tactic-grid npc-tactic-grid--stats">${statCells}</div>
      </div>
      ${_renderNpcEquip(n, equip, { dmg: weaponInfo.damage, range: `${weaponInfo.range}c` })}
      ${_renderNpcActionsDesk(n)}
    </section>`;
}

function _npcCalcChar(n = {}) {
  const equip = n.equipement || {};
  return {
    id: n.id || 'npc',
    nom: n.nom || 'PNJ',
    niveau: Math.max(1, parseInt(n.niveau, 10) || 1),
    stats: _npcBaseStats(n),
    statsBonus: computeEquipStatsBonus(equip),
    equipement: equip,
    maitrises: {},
    sort_cats: [],
    deck_sorts: Array.isArray(n.actions) ? n.actions : [],
    elements: [],
  };
}

function _npcActionModeLabel(a = {}) {
  return ({ action: 'Action', action_bonus: 'Bonus', reaction: 'Reaction' })[a.actionMode] || 'Action';
}

function _npcActionEffectLabel(a = {}) {
  if (a.designMode === 'classic') {
    if (a.classicEffect === 'damage') return a.degats || 'Degats';
    if (a.classicEffect === 'heal') return a.soin || 'Soin';
    if (a.classicEffect === 'summon') return 'Invocation';
    return a.effet || 'Utilitaire';
  }
  if (a.degats) return a.degats;
  if (a.soin) return a.soin;
  if (a.ca) return a.ca;
  return a.effet || 'Effet tactique';
}

function _renderNpcActionsDesk(n) {
  const actions = Array.isArray(n.actions) ? n.actions : [];
  return `
    <div class="npc-actions-block">
      <div class="npc-actions-head">
        <div><span class="npc-edit-lbl">Actions PNJ</span><small>${actions.length} action${actions.length > 1 ? 's' : ''} utilisable${actions.length > 1 ? 's' : ''} dans le VTT</small></div>
        <button class="npc-action-add" type="button" data-action="npcEditAction" data-npc-id="${_esc(n.id)}" data-idx="-1">+ Action</button>
      </div>
      <div class="npc-action-list">
        ${actions.length ? actions.map((a, idx) => {
          const pm = Number.isFinite(parseInt(a.pmOverride)) ? parseInt(a.pmOverride) : (parseInt(a.pm) || 0);
          const range = Number.isFinite(parseInt(a.portee)) ? `${parseInt(a.portee)}c` : 'portee arme';
          return `
            <article class="npc-action-card">
              <div class="npc-action-main">
                <strong>${_esc(a.nom || `Action ${idx + 1}`)}</strong>
                <span>${_esc(_npcActionEffectLabel(a))}</span>
              </div>
              <div class="npc-action-metas">
                <span>${_esc(_npcActionModeLabel(a))}</span>
                <span>${pm} PM</span>
                <span>${_esc(range)}</span>
              </div>
              <div class="npc-action-tools">
                <button type="button" data-action="npcEditAction" data-npc-id="${_esc(n.id)}" data-idx="${idx}">Modifier</button>
                <button type="button" class="is-danger" data-action="npcDeleteAction" data-npc-id="${_esc(n.id)}" data-idx="${idx}">X</button>
              </div>
            </article>`;
        }).join('') : '<div class="npc-action-empty">Aucune action. Ajoute ici les techniques, sorts ou pouvoirs que ce PNJ pourra utiliser dans le VTT.</div>'}
      </div>
    </div>`;
}

function _renderNpcPeopleDesk(n) {
  const blocks = [_renderNpcSpecificRelationsDesk(n), _renderBastionProfil(n)].filter(Boolean).join('');
  return blocks ? `<div class="npc-people-stack">${blocks}</div>` : '';
}

function _renderNpcSpecificRelationsDesk(n) {
  const persoList = _affiPerso.filter(a => a.npcId === n.id);
  const myChars = getMyCharacters(STATE.characters, STATE.user?.uid);
  const myAffi = persoList.filter(a => myChars.some(c => c.id === a.charId));

  if (STATE.isAdmin) {
    const chars = _npcLinkableCharacters();
    return `
      <section class="npc-work-card npc-work-card--links">
        <div class="npc-work-card-head">
          <div><small>Liens personnels</small><strong>${persoList.length ? `${persoList.length} relations` : 'Aucune relation'}</strong></div>
          <button class="npc-card-act npc-card-act--ghost" data-action="openAffiniteTypesManager">Types</button>
        </div>
        <div class="npc-link-board npc-link-board--compact">
          ${persoList.length ? persoList.map(a => _renderNpcRelationCard(a)).join('') : '<div class="npc-link-empty">Aucun lien spécifique. Ajoute une relation avec un personnage pour donner du relief au PNJ.</div>'}
        </div>
        <div class="npc-link-composer">
          <div class="npc-charpick">
            <input type="hidden" id="afp-char-${n.id}" value="">
            <button type="button" class="npc-charpick-trigger" data-action="npcCharPickToggle" data-npc-id="${n.id}">
              <span class="npc-charpick-current"><span class="npc-charpick-ph">Choisir un personnage...</span></span>
              <span class="npc-charpick-caret">▾</span>
            </button>
            <div class="npc-charpick-panel">
              ${chars.length ? chars.map(c => `
                <button type="button" class="npc-charpick-opt" data-action="npcCharPickSelect"
                  data-npc-id="${n.id}" data-char-id="${c.id}" data-char-nom="${_esc(c.nom || '?')}">
                  ${_charAvatar(c)}
                  <span class="npc-charpick-opt-txt"><b>${_esc(c.nom || '?')}</b><small>${_esc(c.ownerPseudo || '?')}</small></span>
                </button>`).join('') : '<div class="npc-empty-line">Aucun personnage</div>'}
            </div>
          </div>
          <select class="npc-select" id="afp-type-${n.id}">
            <option value="">Type de relation</option>
            ${_affiniteTypeChoices().map(t => `<option value="${t.id}">${t.emoji || '*'} ${_esc(_displayText(t.label))}</option>`).join('')}
          </select>
          <button class="npc-event-btn" data-action="npcAddAffiPerso" data-npc-id="${n.id}">Lier</button>
        </div>
      </section>`;
  }

  const others = persoList.filter(a => !myChars.some(c => c.id === a.charId));
  if (!persoList.length) return '';
  return `
    <section class="npc-work-card npc-work-card--links">
      <div class="npc-work-card-head"><div><small>Liens personnels</small><strong>Relations connues</strong></div></div>
      ${myAffi.length ? `<div class="npc-link-board npc-link-board--own npc-link-board--compact">${myAffi.map(a => _renderNpcRelationCard(a, { playerView: true })).join('')}</div>` : ''}
      ${others.length ? `<div class="npc-link-board npc-link-board--compact">${others.map(a => _renderNpcRelationCard(a, { publicOnly: true })).join('')}</div>` : ''}
    </section>`;
}

function _renderNpcRelationCard(a, { publicOnly = false, playerView = false } = {}) {
  const { emoji, color, label } = _typeView(a);
  const vars = `--rc:${color};--rc-bg:${color}12;--rc-bd:${color}34`;
  const typeOpts = _affiniteTypeChoices().map(t =>
    `<option value="${t.id}" ${t.id === a.typeId ? 'selected' : ''}>${t.emoji || '*'} ${_esc(_displayText(t.label))}</option>`).join('');
  const publicNote = (a.notePublique || '').trim();
  const privateNote = (a.note || '').trim();
  return `
    <article class="npc-link-card${playerView ? ' is-own' : ''}" style="${vars}">
      <div class="npc-link-avatar">${_affiTargetAvatar(a)}</div>
      <div class="npc-link-content">
        <div class="npc-link-top">
          <strong>${_esc(a.charNom || '?')}</strong>
          <span>${emoji} ${_esc(label || 'Relation')}</span>
        </div>
        ${STATE.isAdmin && !publicOnly ? `
          <select class="npc-select npc-link-type" data-change="npcAffiField" data-aff-id="${a.id}" data-field="typeId">${typeOpts}</select>
          <input class="npc-inline" data-change="npcAffiField" data-aff-id="${a.id}" data-field="notePublique" value="${_esc(a.notePublique || '')}" placeholder="Note publique">
          <input class="npc-inline npc-link-secret" data-change="npcAffiField" data-aff-id="${a.id}" data-field="note" value="${_esc(a.note || '')}" placeholder="Note privée MJ">`
          : `
          ${publicNote ? `<p>${_esc(publicNote)}</p>` : ''}
          ${playerView && privateNote ? `<p class="npc-link-secret-text">${_esc(privateNote)}</p>` : ''}`}
      </div>
      ${STATE.isAdmin && !publicOnly ? `<button class="npc-icon-btn npc-icon-btn--danger npc-link-delete" data-action="deleteAffinitePerso" data-id="${a.id}">X</button>` : ''}
    </article>`;
}

// ── Cercle des relations : hub radial (PNJ au centre, liens particuliers en orbite) ──
// Ne montre QUE les relations spécifiques définies (_affiPerso), pas tous les joueurs.
// Centre = posture groupe (échelle cliquable) + note groupe. Clic sur un joueur =
// panneau détail pour éditer son lien. Historique en pied, repliable.
const _HUB_VB = { w: 1000, h: 560, cx: 500, cy: 262, rx: 330, ry: 182 };
function _renderNpcRelationHub(n, af) {
  const adm = STATE.isAdmin;
  const niv = _affiniteNiveau(n);
  const editableScale = adm && _affiniteMode(n) !== 'valeur';
  const links = _affiPerso.filter(a => a.npcId === n.id);
  const k = links.length;
  const V = _HUB_VB;
  const initial = (n.nom || '?')[0].toUpperCase();

  const pos = links.map((_, i) => {
    const ang = (-90 + i * (360 / Math.max(1, k))) * Math.PI / 180;
    const x = V.cx + V.rx * Math.cos(ang);
    const y = V.cy + V.ry * Math.sin(ang);
    return { x, y, xPct: (x / V.w * 100).toFixed(2), yPct: (y / V.h * 100).toFixed(2) };
  });

  const spokes = links.map((a, i) => {
    const { color } = _typeView(a);
    return `<line x1="${V.cx}" y1="${V.cy}" x2="${pos[i].x.toFixed(0)}" y2="${pos[i].y.toFixed(0)}" stroke="${color}" stroke-width="3" opacity=".5"/>`;
  }).join('');

  const nodes = links.map((a, i) => {
    const { emoji, color, label } = _typeView(a);
    const sel = _npcRelSel === a.id;
    return `<button type="button" class="npc-hub-node${sel ? ' is-sel' : ''}" style="--x:${pos[i].xPct}%;--y:${pos[i].yPct}%;--rc:${color}"
      ${adm ? `data-action="npcRelSelect" data-aff-id="${a.id}"` : ''} title="${_esc(a.charNom || '?')} — ${_esc(label)}">
      <span class="npc-hub-av">${_affiTargetAvatar(a)}</span>
      <span class="npc-hub-nodelabel">
        <span class="npc-hub-nm">${_esc(a.charNom || '?')}</span>
        <span class="npc-hub-rel">${emoji} ${_esc(label)}</span>
      </span>
    </button>`;
  }).join('');

  const scale = AFFINITE.map((a, i) => {
    const cls = `npc-hub-seg${i <= niv ? ' on' : ''}${i === niv ? ' cur' : ''}`;
    return editableScale
      ? `<button type="button" class="${cls}" style="--seg:${a.couleur}" data-action="npcSetAffiniteNiveau" data-id="${n.id}" data-niveau="${i}" title="${a.icon} ${_esc(a.label)}"></button>`
      : `<span class="${cls}" style="--seg:${a.couleur}" title="${_esc(a.label)}"></span>`;
  }).join('');

  const center = `
    <div class="npc-hub-core">
      <div class="npc-hub-ring">${n.imageUrl ? `<img src="${_esc(n.imageUrl)}" alt="">` : `<span class="npc-hub-ini">${initial}</span>`}</div>
      <div class="npc-hub-under">
        <div class="npc-hub-who">${_esc(n.nom || '?')}</div>
        <div class="npc-hub-scale">${scale}</div>
        <div class="npc-hub-postxt">${af.icon} ${_esc(af.label)} envers le groupe</div>
      </div>
    </div>`;

  // Panneau détail contextuel : lien sélectionné (édition) ou note de posture groupe.
  const sel = adm ? links.find(a => a.id === _npcRelSel) : null;
  let detail = '';
  if (sel) {
    const { color } = _typeView(sel);
    const typeOpts = _affiniteTypeChoices().map(t =>
      `<option value="${t.id}" ${t.id === sel.typeId ? 'selected' : ''}>${t.emoji || '*'} ${_esc(_displayText(t.label))}</option>`).join('');
    detail = `
      <div class="npc-hub-detail" style="--rc:${color}">
        <div class="npc-hub-detail-top">
          <span class="npc-hub-detail-av">${_affiTargetAvatar(sel)}</span>
          <div class="npc-hub-detail-who"><strong>${_esc(sel.charNom || '?')}</strong><small>relation particulière avec ${_esc(n.nom || 'ce PNJ')}</small></div>
          <button class="npc-hub-detail-del" data-action="deleteAffinitePerso" data-id="${sel.id}" title="Supprimer ce lien">🗑</button>
          <button class="npc-hub-detail-close" data-action="npcRelSelect" data-aff-id="" title="Fermer">✕</button>
        </div>
        <div class="npc-hub-detail-grid">
          <label class="npc-hub-fld"><span>Type de relation</span>
            <select class="npc-select npc-hub-typesel" data-change="npcAffiField" data-aff-id="${sel.id}" data-field="typeId">${typeOpts}</select></label>
          <label class="npc-hub-fld"><span>Note publique</span>
            <input class="npc-inline" data-change="npcAffiField" data-aff-id="${sel.id}" data-field="notePublique" value="${_esc(sel.notePublique || '')}" placeholder="Ce que les joueurs voient…"></label>
          <label class="npc-hub-fld"><span>Note privée MJ</span>
            <input class="npc-inline" data-change="npcAffiField" data-aff-id="${sel.id}" data-field="note" value="${_esc(sel.note || '')}" placeholder="Secret du MJ…"></label>
        </div>
      </div>`;
  } else if (adm) {
    detail = `
      <div class="npc-hub-detail npc-hub-detail--group">
        <label class="npc-hub-fld"><span>Posture groupe — note générale (ex. « Apprécie le groupe », ce qui pourrait la changer…)</span>
          <textarea class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="affinite.note" rows="2" placeholder="Comment le PNJ se comporte avec l'ensemble du groupe…">${_esc(n.affinite?.note || '')}</textarea></label>
      </div>`;
  } else if (n.affinite?.note) {
    detail = `<div class="npc-hub-detail npc-hub-detail--group"><p>${_esc(n.affinite.note)}</p></div>`;
  }

  const usedTypeIds = [...new Set(links.map(a => a.typeId).filter(Boolean))];
  const legend = usedTypeIds.length ? `
    <div class="npc-hub-legend">
      ${usedTypeIds.map(id => {
        const t = _getAffiniteType(id); if (!t) return '';
        return `<span><i style="background:${_getAffiniteTypeColor(id)}"></i>${_getAffiniteTypeEmoji(id)} ${_esc(_displayText(t.label))}</span>`;
      }).join('')}
      ${adm ? `<span class="npc-hub-legend-hint">Clique un joueur pour éditer son lien</span>` : ''}
    </div>` : '';

  const composer = adm
    ? `<button type="button" class="npc-hub-addbtn" data-action="npcOpenLinkModal" data-npc-id="${n.id}">
        <span class="npc-hub-addbtn-ico">🔗</span>
        <span class="npc-hub-addbtn-txt"><b>Lier un personnage à ce PNJ</b><small>Choisis un personnage et sa relation particulière</small></span>
        <span class="npc-hub-addbtn-plus">＋</span>
      </button>`
    : '';

  const histoCount = Array.isArray(n.affinite?.historique) ? n.affinite.historique.length : 0;
  const chrono = `<details class="npc-hub-chrono"><summary>🕓 Historique d'affinité${histoCount ? ` (${histoCount})` : ''}</summary>${_renderNpcTimelineDesk(n)}</details>`;

  return `
    <section class="npc-hub" style="${_afVars(af)}">
      <div class="npc-hub-head">
        <div class="npc-hub-title"><span class="npc-hub-glyph">◈</span><div><h3>Cercle des relations</h3><small>${_esc(n.nom || 'PNJ')} — liens particuliers</small></div></div>
        <div class="npc-hub-posture">
          <span class="npc-hub-posture-lbl">Envers le groupe</span>
          <span class="npc-hub-pill"><span class="npc-hub-pill-dot"></span>${af.icon} ${_esc(af.label)}</span>
          ${adm ? `<div class="npc-hub-tools">
            <button type="button" class="npc-hub-tool" data-action="openAffiniteTypesManager" title="Créer et éditer les types de relation">🏷 Types</button>
            <button type="button" class="npc-hub-tool" data-action="openAffiniteSeuilsModal" title="Seuils d'affinité (mode valeur)">⚙ Seuils</button>
          </div>` : ''}
        </div>
      </div>
      <div class="npc-hub-stage${k ? '' : ' is-empty'}">
        <svg class="npc-hub-svg" viewBox="0 0 ${V.w} ${V.h}" preserveAspectRatio="none">${spokes}</svg>
        ${center}
        ${nodes}
        ${k ? '' : `<div class="npc-hub-empty">Aucune relation particulière.${adm ? ' Lie un joueur ci-dessous pour tracer un lien précis.' : ''}</div>`}
      </div>
      ${legend}
      ${detail}
      <div class="npc-hub-foot">${composer}${chrono}</div>
    </section>`;
}

function _renderEmpty() {
  return `
  <div class="npc-fiche-empty">
    <div class="npc-fiche-empty-ico">👥</div>
    <p style="color:var(--text-dim);font-style:italic">
      ${STATE.isAdmin ? 'Aucun PNJ. Cliquez sur + pour en créer un.' : 'Aucun PNJ disponible.'}</p>
    ${STATE.isAdmin ? `<button data-action="npcCreate" class="btn btn-gold btn-sm"
      style="margin-top:1rem">+ Créer le premier PNJ</button>` : ''}
  </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _getFiltered() {
  // Visibilité joueurs : un PNJ avec embauchable === false est caché (toggle
  // « 🚫 Caché joueurs » de la fiche). Le MJ voit tout. (Filtrage UI ; la vraie
  // confidentialité passerait par les règles Firestore — cf. note.)
  const playerView = _npcIsPlayerView();
  let base = playerView ? _npcs.filter(n => n.embauchable !== false) : _npcs;
  if (!playerView && _filterHidden) base = base.filter(n => n.embauchable === false);
  if (!playerView && _filterIncomplete) base = base.filter(n => _npcMissing(n).length > 0);
  if (playerView && _filterMine) {
    const mine = new Set(_npcMyCharacters().map(c => c.id));
    base = base.filter(n => _affiPerso.some(a => a.npcId === n.id && mine.has(a.charId) && !a.secret)
      || _npcMyCharacters().some(c => _npcFeelingFor(n.id, c)));
  }
  if (_filterStatus === 'mort')         base = base.filter(n => n.statut === 'mort');
  else if (_filterStatus === 'disparu') base = base.filter(n => n.statut === 'disparu');
  else if (_filterStatus === 'alive')   base = base.filter(n => n.statut !== 'mort' && n.statut !== 'disparu');
  if (_activeOrgFilter) base = base.filter(n => (n.organisations || []).includes(_activeOrgFilter));
  return base.filter(n => _npcMatchesSearch(n, _filterSearch));
}

// Barre de contrôles : bascule de vue (Catégories / A→Z) + filtres rapides.
function _renderListControls() {
  const viewBtn = (v, lbl) => `<button type="button" class="npc-lc-btn ${_listView === v ? 'is-on' : ''}" data-action="npcSetListView" data-view="${v}">${lbl}</button>`;
  const statBtn = (v, lbl, title) => `<button type="button" class="npc-lc-chip ${_filterStatus === v ? 'is-on' : ''}" data-action="npcSetStatusFilter" data-status="${v}" title="${title}">${lbl}</button>`;
  return `<div class="npc-list-controls">
    <div class="npc-lc-seg">${viewBtn('cat', '📁 Catégories')}${viewBtn('az', '🔤 A→Z')}</div>
    <div class="npc-lc-filters">
      ${statBtn('', 'Tous', 'Tous les statuts')}
      ${statBtn('mort', '☠️', 'Morts seulement')}
      ${statBtn('disparu', '❓', 'Disparus seulement')}
      ${STATE.isAdmin ? `<button type="button" class="npc-lc-chip ${_filterHidden ? 'is-on' : ''}" data-action="npcToggleHiddenFilter" title="N'afficher que les PNJ cachés">🚫</button>` : ''}
    </div>
  </div>`;
}

function _renderFlatList(filtered) {
  const sorted = [...filtered].sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }));
  return `<div class="npc-list-modebar"><span>A→Z</span><span>${sorted.length} PNJ</span></div>
    <div class="npc-flat-list">${sorted.map(_renderNavItem).join('')}</div>`;
}

// ── Sélection & filtres ───────────────────────────────────────────────────────
export function selectNpc(id, { syncRoute = true, replace = false } = {}) {
  if (!_npcs.some(item => item.id === id)) return;
  _activeId = id;
  const npc = _npcs.find(item => item.id === id);
  if (npc) recordRecentNavigation({ type: 'npc', id, title: npc.nom || npc.name || '' });

  if (syncRoute) _syncNpcRoute({ replace });

  _refreshList();
  _refreshActivePanel();
}

// Frappe dans la recherche PNJ : l'état répond tout de suite, la reconstruction
// de la liste (déjà ciblée sur #npc-list-items, input intact) est débouncée pour
// coalescer une frappe rapide sur un gros casting.
let _npcSearchTimer = null;
function _npcSearch(val) {
  _filterSearch = val;
  clearTimeout(_npcSearchTimer);
  _npcSearchTimer = setTimeout(() => { _npcSearchTimer = null; _refreshList({ keepScroll: false }); }, 120);
}

function _refreshList({ keepScroll = true } = {}) {
  const list = document.getElementById('npc-list-items');
  if (!list) { renderNpcs(); return; }
  const scrollTop = keepScroll ? list.scrollTop : 0;
  list.innerHTML = _buildListHtml();
  list.scrollTop = scrollTop;
  _scheduleNpcListScrollHint();
}

function _bindNpcListScroll() {
  const list = document.getElementById('npc-list-items');
  if (list) list.onscroll = () => _updateNpcListScrollHint(list);
}

function _scheduleNpcListScrollHint() {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => _updateNpcListScrollHint());
    return;
  }
  _updateNpcListScrollHint();
}

function _updateNpcListScrollHint(list = document.getElementById('npc-list-items')) {
  const shell = document.getElementById('npc-list-shell');
  if (!shell || !list) return;

  const maxScroll = list.scrollHeight - list.clientHeight;
  const canScroll = maxScroll > 4;
  const atTop = list.scrollTop <= 2;
  const atBottom = list.scrollTop >= maxScroll - 2;

  shell.classList.toggle('is-scrollable', canScroll);
  shell.classList.toggle('can-scroll-up', canScroll && !atTop);
  shell.classList.toggle('can-scroll-down', canScroll && !atBottom);
}


// ── Groupement par organisation (navigation par catégories) ──────────────────
// Statut narratif d'un PNJ (défaut = vivant : aucune valeur stockée).
const NPC_STATUTS = {
  mort:    { lbl: 'Mort',    ico: '☠️' },
  disparu: { lbl: 'Disparu', ico: '❓' },
};

const NO_ORG_KEY = '__no_org__';

function _groupNpcsByOrg(npcs) {
  // Map<orgName, npc[]> — préserve l'ordre des _organisations connues, "Sans
  // organisation" en dernier. Les NPCs avec plusieurs orgs apparaissent dans
  // chaque groupe correspondant.
  const groups = new Map();
  _organisations.forEach(o => groups.set(o.name, []));
  npcs.forEach(n => {
    const orgs = (Array.isArray(n.organisations) ? n.organisations : []).filter(Boolean);
    if (!orgs.length) return; // traité ci-dessous
    orgs.forEach(orgName => {
      if (!groups.has(orgName)) groups.set(orgName, []); // org orpheline (renommée/supprimée)
      groups.get(orgName).push(n);
    });
  });
  // "Sans organisation" toujours en dernier.
  groups.set(NO_ORG_KEY, npcs.filter(n =>
    !Array.isArray(n.organisations) || !n.organisations.filter(Boolean).length
  ));
  // Tri alphabétique des PNJ à l'intérieur de chaque groupe (nom, insensible à la casse/accents)
  for (const arr of groups.values()) {
    arr.sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }));
  }
  return groups;
}

function _orgLabel(orgName) {
  return orgName === NO_ORG_KEY ? 'Sans organisation' : orgName;
}

function _orgIcon(orgName) {
  if (orgName === NO_ORG_KEY) return '👤';
  return _orgIcons[orgName] || '🏛️';
}

function _visibleOrgEntries(groups) {
  return [...groups.entries()].filter(([, items]) => items.length > 0);
}

function _renderOrgIndex(entries) {
  const groupCount = entries.length;
  const totalCount = entries.reduce((sum, [, items]) => sum + items.length, 0);
  return `
    <div class="npc-list-modebar">
      <span>Catégories</span>
      <span>${groupCount} groupe${groupCount > 1 ? 's' : ''} · ${totalCount} PNJ</span>
    </div>
    <div class="npc-org-index">
      ${entries.map(([orgName, items]) => _renderOrgIndexItem(orgName, items)).join('')}
    </div>`;
}

function _renderOrgIndexItem(orgName, npcs) {
  const isNoOrg   = orgName === NO_ORG_KEY;
  const label     = _orgLabel(orgName);
  const safeKey   = _esc(orgName);
  const hasActiveNpc = _activeId && npcs.some(n => n.id === _activeId);

  return `<button type="button" data-org-key="${safeKey}" title="${_esc(label)}"
    class="npc-org-card ${hasActiveNpc ? 'is-active' : ''}"
    data-action="_npcSelectOrg">
    <span class="npc-org-card-main">
      <span class="npc-org-icon">${_orgIcon(orgName)}</span>
      <span class="npc-org-card-text">
        <strong>${_esc(label)}</strong>
      </span>
    </span>
    <span class="npc-org-count">${npcs.length}</span>
  </button>`;
}

function _renderOrgDrilldown(orgName, npcs) {
  const label = _orgLabel(orgName);
  const count = npcs.length;
  return `
    <div class="npc-drill-head">
      <button type="button" class="npc-drill-back" data-action="_npcBackToOrgs">‹</button>
      <span class="npc-drill-title">
        <strong>${_orgIcon(orgName)} ${_esc(label)}</strong>
        <small>${count} PNJ</small>
      </span>
      ${STATE.isAdmin && orgName !== NO_ORG_KEY
        ? `<button type="button" class="npc-org-emoji-btn" data-action="npcEditOrgIcon" data-org="${_esc(orgName)}" title="Changer l'emoji de la catégorie">${_orgIcon(orgName)} ✎</button>`
        : ''}
    </div>
    <div class="npc-drill-list">
      ${npcs.map(n => _renderNavItem(n)).join('')}
    </div>`;
}

function _renderSearchResults(entries, total) {
  return `
    <div class="npc-list-modebar">
      <span>Résultats</span>
      <span>${total} PNJ</span>
    </div>
    ${entries.map(([orgName, items]) => `
      <div class="npc-search-group">
        <div class="npc-search-group-title">
          <span>${_orgIcon(orgName)} ${_esc(_orgLabel(orgName))}</span>
          <span>${items.length}</span>
        </div>
        ${items.map(n => _renderNavItem(n)).join('')}
      </div>
    `).join('')}`;
}

function _buildListHtmlLegacy(filtered = _getFiltered()) {
  // Drilldown d'une catégorie (vue Catégories, hors recherche) : sous-vue propre.
  if (_activeOrgFilter && _listView === 'cat' && !_filterSearch.trim()) {
    const selected = _groupNpcsByOrg(filtered).get(_activeOrgFilter) || [];
    if (selected.length) return _renderOrgDrilldown(_activeOrgFilter, selected);
    _activeOrgFilter = null;
  }
  const controls = _renderListControls();
  if (filtered.length === 0) {
    const why = _filterSearch.trim() ? ' trouvé' : (_filterStatus || _filterHidden) ? ' (filtre actif)' : '';
    return controls + `<div style="padding:1.5rem;text-align:center;color:var(--text-dim);
        font-size:.8rem;font-style:italic">Aucun PNJ${why}</div>`;
  }
  if (_filterSearch.trim()) {
    const entries = _visibleOrgEntries(_groupNpcsByOrg(filtered));
    return controls + _renderSearchResults(entries, filtered.length);
  }
  if (_listView === 'az') return controls + _renderFlatList(filtered);
  const entries = _visibleOrgEntries(_groupNpcsByOrg(filtered));
  return controls + _renderOrgIndex(entries);
}

function _npcGroupEntries(list) {
  const sorted = [...list].sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' }));
  if (_listView === 'az') {
    const groups = new Map();
    sorted.forEach(n => {
      const key = (n.nom || '?')[0].toUpperCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    });
    return [...groups.entries()].map(([key, items]) => ({ key: `az:${key}`, label: key, icon: '', items }));
  }
  if (_listView === 'place') {
    const groups = new Map();
    sorted.forEach(n => {
      const key = n.lieu || 'Sans lieu';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    });
    return [...groups.entries()].sort((a, b) => a[0] === 'Sans lieu' ? 1 : b[0] === 'Sans lieu' ? -1 : a[0].localeCompare(b[0], 'fr'))
      .map(([key, items]) => ({ key: `place:${key}`, label: key, icon: key === 'Sans lieu' ? '⌖' : '⌖', items }));
  }
  return _visibleOrgEntries(_groupNpcsByOrg(sorted)).map(([key, items]) => ({
    key: `org:${key}`, label: _orgLabel(key), icon: _orgIcon(key), org: key, items,
  }));
}

function _buildListHtml(filtered = _getFiltered()) {
  const playerView = _npcIsPlayerView();
  const all = playerView ? _npcs.filter(n => n.embauchable !== false) : _npcs;
  const myCharacterIds = new Set(_npcMyCharacters().map(c => c.id));
  const linkedToMe = playerView ? all.filter(n => (
    _affiPerso.some(a => a.npcId === n.id && myCharacterIds.has(a.charId) && !a.secret)
    || _npcMyCharacters().some(c => _npcFeelingFor(n.id, c))
  )).length : 0;
  const count = status => status === 'alive'
    ? all.filter(n => n.statut !== 'mort' && n.statut !== 'disparu').length
    : all.filter(n => n.statut === status).length;
  const chips = `<div class="npc-rd-statusfilters">
    <button type="button" class="${!_filterStatus ? 'is-on' : ''}" data-action="npcSetStatusFilter" data-status="">Tous</button>
    <button type="button" class="${_filterStatus === 'alive' ? 'is-on' : ''}" data-action="npcSetStatusFilter" data-status="alive">Vivants</button>
    <button type="button" class="${_filterStatus === 'mort' ? 'is-on' : ''}" data-action="npcSetStatusFilter" data-status="mort">☠ ${count('mort')}</button>
    <button type="button" class="${_filterStatus === 'disparu' ? 'is-on' : ''}" data-action="npcSetStatusFilter" data-status="disparu">? ${count('disparu')}</button>
    ${playerView
      ? `<button type="button" class="${_filterMine ? 'is-on' : ''}" data-action="npcToggleMine">♥ Liés à moi ${linkedToMe}</button>`
      : `<button type="button" class="${_filterIncomplete ? 'is-on' : ''}" data-action="npcToggleIncomplete">À compléter ${all.filter(n => _npcMissing(n).length).length}</button><button type="button" class="${_filterHidden ? 'is-on' : ''}" data-action="npcToggleHiddenFilter">⊘ ${all.filter(n => n.embauchable === false).length}</button>`}
  </div>`;
  if (!filtered.length) {
    return `${chips}<div class="npc-rd-noresult"><p>Aucun PNJ trouvé.</p>${STATE.isAdmin && _npcView === 'mj' && _filterSearch.trim() ? `<button type="button" data-action="npcCreateFromSearch">Créer « ${_esc(_filterSearch.trim())} »</button>` : ''}</div>`;
  }
  const groups = _npcGroupEntries(filtered);
  return `${chips}<div class="npc-rd-groups">${groups.map(group => {
    const closed = _npcCollapsedGroups.has(group.key);
    return `<section class="npc-rd-group${closed ? ' is-closed' : ''}">
      <div class="npc-rd-grouphead"><button type="button" data-action="npcToggleGroup" data-key="${_esc(group.key)}"><span>${closed ? '▸' : '▾'}</span>${group.icon ? `<i>${group.icon}</i>` : ''}<b>${_esc(group.label)}</b><small>${group.items.length}</small></button>${STATE.isAdmin && group.org && group.org !== NO_ORG_KEY ? `<button type="button" class="npc-rd-group-emoji" data-action="npcEditOrgIcon" data-org="${_esc(group.org)}" title="Changer l’emoji">✎</button>` : ''}</div>
      ${closed ? '' : `<div>${group.items.map(_renderNavItem).join('')}</div>`}
    </section>`;
  }).join('')}</div>`;
}

function _npcSelectOrg(btn) {
  const key = btn?.dataset?.orgKey;
  if (key == null) return;
  _activeOrgFilter = key;
  _refreshList({ keepScroll: false });
}

function _npcBackToOrgs() {
  _activeOrgFilter = null;
  _refreshList({ keepScroll: false });
}

function _npcSetListView(btn) {
  _listView = ['org', 'place', 'az'].includes(btn.dataset.view) ? btn.dataset.view : 'org';
  _refreshList({ keepScroll: false });
}
function _npcSetStatusFilter(btn) {
  _filterStatus = btn.dataset.status || '';
  _refreshList({ keepScroll: false });
}
function _npcToggleHiddenFilter() {
  _filterHidden = !_filterHidden;
  _refreshList({ keepScroll: false });
}

async function _npcSetStatut(btn) {
  if (!STATE.isAdmin) return;
  const id = btn.dataset.id; const statut = btn.dataset.statut || '';
  const n = _npcs.find(x => x.id === id); if (!n) return;
  n.statut = statut;
  if (await trySave('npcs', id, { statut })) {
    _npcFlashSaved();
    _refreshActivePanel();
    _refreshList({ keepScroll: true });
  }
}

// ── Émoji personnalisé par catégorie (organisation) ───────────────────────────
const ORG_ICON_PALETTE = ['🏛️','⚔️','🛡️','👑','💰','🏰','⛪','🗡️','🏴‍☠️','🐉','🌲','⚜️','🔮','🧙','🐺','🦅','🌟','🔥','❄️','💀','🎭','📜','⚖️','🍺','⚒️','🏹','🌹','🕯️','👁️','🦁','🌊','🪙'];

function _npcEditOrgIcon(btn) {
  if (!STATE.isAdmin) return;
  const org = btn.dataset.org; if (!org) return;
  const cur = _orgIcons[org] || '';
  openModal(`🎨 Emoji de « ${_esc(org)} »`, `
    <div class="npc-emoji-pick">
      <div class="npc-emoji-grid">
        ${ORG_ICON_PALETTE.map(e => `<button type="button" class="npc-emoji-opt ${e === cur ? 'is-on' : ''}" data-action="npcPickOrgIcon" data-org="${_esc(org)}" data-emoji="${e}">${e}</button>`).join('')}
      </div>
      <div class="npc-emoji-free">
        <input type="text" class="input-field" id="npc-emoji-input" maxlength="8" value="${_esc(cur)}" placeholder="…ou colle ton propre emoji" autocomplete="off">
        <button class="btn btn-gold btn-sm" data-action="npcApplyOrgIconInput" data-org="${_esc(org)}">OK</button>
      </div>
      <div class="npc-emoji-foot">
        <button class="btn btn-outline btn-sm" data-action="npcResetOrgIcon" data-org="${_esc(org)}">↺ Émoji par défaut (🏛️)</button>
      </div>
    </div>`);
}

async function _saveOrgIcon(org, emoji) {
  if (!STATE.isAdmin || !org) return;
  // On stocke '' (= défaut) plutôt que de supprimer la clé : compatible avec un
  // saveDoc en merge, et _orgIcon retombe sur 🏛️ pour une valeur vide.
  _orgIcons = { ..._orgIcons, [org]: (emoji || '').trim() };
  try {
    await saveDoc('npc_affinites', ORG_ICONS_DOC_ID, { icons: _orgIcons });
    closeModal();
    _npcFlashSaved();
    _refreshList({ keepScroll: true });
  } catch (e) { console.error('[org icon]', e); showNotif("Échec de l'enregistrement de l'emoji.", 'error'); }
}

function _npcPickOrgIcon(btn)       { _saveOrgIcon(btn.dataset.org, btn.dataset.emoji); }
function _npcResetOrgIcon(btn)      { _saveOrgIcon(btn.dataset.org, ''); }
function _npcApplyOrgIconInput(btn) { _saveOrgIcon(btn.dataset.org, document.getElementById('npc-emoji-input')?.value || ''); }

// ── Équipement PNJ ────────────────────────────────────────────────────────────
const _isShield = (i = {}) => (i.sousType || i.nom || '').toLowerCase().includes('bouclier');

// Objets boutique éligibles à un slot donné.
function _shopItemsForSlot(def) {
  if (def.kind === 'weapon') return _shopItems.filter(i => _isShopWeapon(i) || _isShield(i));
  if (def.kind === 'armor')  return _shopItems.filter(i => i.slotArmure === def.armVal);
  return _shopItems.filter(i => i.slotBijou === def.slot);
}

// Contribution agrégée de l'équipement (bonus de stats + bonus dérivés + CA).
function _npcEquipEffect(n) {
  const equip   = n?.equipement || {};
  const sBonus  = computeEquipStatsBonus(equip);
  const dBonus  = computeEquipDerivedBonus(equip);
  const caEquip = Object.values(equip).reduce((s, it) => s + (parseInt(it?.ca) || 0), 0);
  const setData = getArmorSetData({ equipement: equip });
  return { equip, sBonus, dBonus, caEquip, setData };
}

// Petits badges de bonus pour l'objet équipé dans un slot.
function _npcEquipBadges(eq, def) {
  const parts = [];
  if (def.kind === 'armor' && eq.typeArmure) {
    const meta = getArmorTypeMeta(eq.typeArmure);
    parts.push(`Set ${meta?.label || eq.typeArmure}`);
  } else if (def.kind === 'weapon') {
    const type = eq.format || eq.typeArme || eq.sousType || eq.type;
    if (type) parts.push(type);
  } else {
    const type = eq.slotBijou || eq.type || eq.template;
    if (type) parts.push(type);
  }
  if (def.kind === 'weapon' && eq.degats) parts.push(`🗡️ ${eq.degats}`);
  const bonusText = formatItemBonusText(eq);
  if (bonusText) parts.push(bonusText);
  const ca = (parseInt(eq.ca) || 0) + (parseInt(eq.caBonus) || 0);
  if (ca) parts.push(`CA ${ca > 0 ? '+' : ''}${ca}`);
  [['pvMaxBonus', 'PV'], ['pmMaxBonus', 'PM'], ['vitesseBonus', 'Vit']].forEach(([k, lbl]) => {
    const v = parseInt(eq[k]) || 0;
    if (v) parts.push(`${lbl} ${v > 0 ? '+' : ''}${v}`);
  });
  return parts.map((p, idx) => `<span class="npc-eq-badge${idx === 0 ? ' npc-eq-badge--type' : ''}">${_esc(p)}</span>`).join('');
}

function _npcEquipSearchText(item = {}) {
  return _norm([
    item.nom,
    item.type,
    item.template,
    item.sousType,
    item.typeArme,
    item.typeArmure,
    item.slotArmure,
    item.slotBijou,
    item.rarete,
    item.degats,
    item.effet,
    item.particularite,
    item.description,
    formatItemBonusText(item),
    item.traits,
    item.skillBonuses,
    item.damageProfile,
    item.actions,
    item.pvMaxBonus,
    item.pmMaxBonus,
    item.vitesseBonus,
    item.initiativeBonus,
    item.caBonus,
    item.prix,
    item.dispo,
  ].map(_searchPart).join(' '));
}

const _npcEquipFeatureLabels = {
  ca: 'Classe d’armure', pv: 'PV max', pm: 'PM max', speed: 'Vitesse', initiative: 'Initiative',
  skill: 'Compétences', resistance: 'Résistance', immunity: 'Immunité', absorption: 'Absorption',
  weakness: 'Faiblesse', action: 'Actions', effect: 'Effet spécial', magic: 'Magique',
};
const _npcUnique = values => [...new Set((values || []).map(v => String(v || '').trim()).filter(Boolean))]
  .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base', numeric: true }));
const _npcRarityValue = (item = {}) => {
  const direct = parseInt(item.rarete, 10);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const wanted = _norm(item.rarete || '');
  return _rarities.find(r => _norm(r.name) === wanted)?.value || 0;
};
const _npcRarityMeta = (item = {}) => {
  const value = _npcRarityValue(item);
  const configured = _rarities.find(r => r.value === value);
  const name = configured?.name || RARETE_NAMES[value] || (item.rarete ? String(item.rarete) : '');
  return { value, name, color: configured?.color || (name ? _rareteColor(name) : '') };
};
const _npcEquipTypes = (item = {}, def = {}) => _npcUnique(def.kind === 'weapon'
  ? [item.format, item.sousType, item.typeArme, item.type]
  : def.kind === 'armor'
    ? [item.typeArmure]
    : [item.slotBijou, item.type]);
const _npcEquipStats = (item = {}) => _npcUnique([
  normalizeStatKey(item.toucherStat),
  ...(Array.isArray(item.degatsStats) ? item.degatsStats : [item.degatsStat, item.statAttaque]).map(normalizeStatKey),
  ...NPC_STATS.filter(stat => getItemStatBonus(item, stat.key)).map(stat => stat.key),
]);
const _npcEquipFeatures = (item = {}, def = {}) => {
  const values = [];
  if ((parseInt(item.ca) || 0) + (parseInt(item.caBonus) || 0)) values.push('ca');
  if (parseInt(item.pvMaxBonus) || 0) values.push('pv');
  if (parseInt(item.pmMaxBonus) || 0) values.push('pm');
  if (parseInt(item.vitesseBonus) || 0) values.push('speed');
  if (parseInt(item.initiativeBonus) || 0) values.push('initiative');
  if (Object.values(item.skillBonuses || {}).some(v => parseInt(v) || 0)) values.push('skill');
  if (item.damageProfile?.resistances?.length) values.push('resistance');
  if (item.damageProfile?.immunites?.length) values.push('immunity');
  if (item.damageProfile?.absorptions?.length) values.push('absorption');
  if (item.damageProfile?.faiblesses?.length) values.push('weakness');
  if (Array.isArray(item.actions) && item.actions.length) values.push('action');
  if (item.effet || item.particularite || item.description) values.push('effect');
  const fmt = resolveWeaponFamily(_weaponFormats, item);
  const dmgType = _damageTypes.find(t => t.id === (item.damageTypeId || item.elementId));
  if (def.kind === 'weapon' && (fmt?.isMagic || dmgType?.isMagic)) values.push('magic');
  return _npcUnique(values);
};

function _npcEquipFacetData(items, def) {
  return {
    types: _npcUnique(items.flatMap(item => _npcEquipTypes(item, def))),
    rarities: [...new Set(items.map(_npcRarityValue).filter(Boolean))].sort((a, b) => a - b),
    stats: _npcUnique(items.flatMap(_npcEquipStats)),
    damages: _npcUnique(items.map(item => item.degats)),
    traits: _npcUnique(items.flatMap(item => _getTraits(item) || [])),
    features: _npcUnique(items.flatMap(item => _npcEquipFeatures(item, def))),
    availabilities: _npcUnique(items.map(item => item.dispo)),
  };
}

function _npcEquipMatchesFilters(item, def, state) {
  const f = state.filters || {};
  const query = _norm(state.q || '');
  if (query && !_searchIncludes(_npcEquipSearchText(item), query)) return false;
  if (f.type && !_npcEquipTypes(item, def).includes(f.type)) return false;
  if (f.rarity && String(_npcRarityValue(item)) !== String(f.rarity)) return false;
  if (f.stat && !_npcEquipStats(item).includes(f.stat)) return false;
  if (f.damage && String(item.degats || '') !== f.damage) return false;
  if (f.trait && !(_getTraits(item) || []).includes(f.trait)) return false;
  if (f.feature && !_npcEquipFeatures(item, def).includes(f.feature)) return false;
  if (f.availability && String(item.dispo || '') !== f.availability) return false;
  return true;
}

function _npcDamageAverage(formula = '') {
  const match = String(formula).toLowerCase().match(/(\d*)d(\d+)(?:\s*([+-])\s*(\d+))?/);
  if (!match) return parseFloat(formula) || 0;
  const count = parseInt(match[1], 10) || 1;
  const faces = parseInt(match[2], 10) || 0;
  const flat = (parseInt(match[4], 10) || 0) * (match[3] === '-' ? -1 : 1);
  return count * (faces + 1) / 2 + flat;
}

function _npcSortEquipItems(items, sort) {
  const list = [...items];
  const byName = (a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' });
  if (sort === 'rarity') return list.sort((a, b) => _npcRarityValue(b) - _npcRarityValue(a) || byName(a, b));
  if (sort === 'damage') return list.sort((a, b) => _npcDamageAverage(b.degats) - _npcDamageAverage(a.degats) || byName(a, b));
  if (sort === 'ca') return list.sort((a, b) => ((parseInt(b.ca) || 0) + (parseInt(b.caBonus) || 0)) - ((parseInt(a.ca) || 0) + (parseInt(a.caBonus) || 0)) || byName(a, b));
  if (sort === 'price_asc') return list.sort((a, b) => (parseFloat(a.prix) || 0) - (parseFloat(b.prix) || 0) || byName(a, b));
  if (sort === 'price_desc') return list.sort((a, b) => (parseFloat(b.prix) || 0) - (parseFloat(a.prix) || 0) || byName(a, b));
  return list.sort(byName);
}

const _npcFacetOptions = (values, current, label, valueLabel = value => value) => `
  <option value="">${_esc(label)}</option>
  ${values.map(value => `<option value="${_esc(value)}" ${String(value) === String(current) ? 'selected' : ''}>${_esc(valueLabel(value))}</option>`).join('')}`;
const _npcStatLabel = key => NPC_STAT_LABELS[key] || key;
const _npcStatTone = key => {
  const normalized = normalizeStatKey(key);
  return NPC_STATS.some(stat => stat.key === normalized) ? `stat-tone stat-${normalized}` : '';
};
const _npcDerivedTone = key => ({
  pvMaxBonus: 'derived-tone derived-pv',
  pmMaxBonus: 'derived-tone derived-pm',
  vitesseBonus: 'derived-tone derived-speed',
  initiativeBonus: 'derived-tone derived-init',
  caBonus: 'derived-tone derived-ca',
}[key] || '');

function _npcEquipCardHtml(item, def, current, npcId, slot) {
  const built = buildEquippedItemFromInventory(def.slot, item, null) || { ...item };
  const preview = { ...item, ...built };
  const rarity = _npcRarityMeta(item);
  const image = item.image || item.imageUrl || '';
  const selected = current?.itemId === item.id;
  const types = _npcEquipTypes(item, def);
  const stats = _npcEquipStats(item);
  const traits = _getTraits(item) || [];
  const derived = [
    ['pvMaxBonus', 'PV'], ['pmMaxBonus', 'PM'], ['vitesseBonus', 'Vit.'],
    ['initiativeBonus', 'Init.'], ['caBonus', 'CA'],
  ].flatMap(([key, label]) => {
    const value = parseInt(item[key]) || 0;
    return value ? [{ label: `${label} ${value > 0 ? '+' : ''}${value}`, cls: _npcDerivedTone(key) }] : [];
  });
  const statBonuses = NPC_STATS.flatMap(stat => {
    const value = getItemStatBonus(item, stat.key);
    return value ? [{ label: `${stat.short} ${value > 0 ? '+' : ''}${value}`, cls: _npcStatTone(stat.key) }] : [];
  });
  const skillCount = Object.values(item.skillBonuses || {}).filter(v => parseInt(v) || 0).length;
  const profileCount = Object.values(item.damageProfile || {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
  const facts = def.kind === 'weapon'
    ? [
      item.degats && { label: `🎲 ${item.degats}`, cls: 'is-damage' },
      item.toucherStat && { label: `Toucher ${_npcStatLabel(normalizeStatKey(item.toucherStat))}`, cls: _npcStatTone(item.toucherStat) },
      item.portee && { label: `Portée ${item.portee}`, cls: 'is-range' },
    ]
    : def.kind === 'armor'
      ? [((parseInt(preview.ca) || 0) + (parseInt(preview.caBonus) || 0)) && {
        label: `🛡️ CA +${(parseInt(preview.ca) || 0) + (parseInt(preview.caBonus) || 0)}`,
        cls: 'derived-tone derived-ca',
      }]
      : [];
  const extra = [
    ...statBonuses,
    ...derived,
    skillCount ? { label: `${skillCount} compétence${skillCount > 1 ? 's' : ''}`, cls: 'is-skill' } : null,
    profileCount ? { label: `${profileCount} protection${profileCount > 1 ? 's' : ''}`, cls: 'is-protection' } : null,
  ].filter(Boolean);
  const effect = item.particularite || item.effet || item.description || '';
  const commerce = [item.dispo, item.prix != null && item.prix !== '' ? `${item.prix} 🪙` : ''].filter(Boolean).join(' · ');
  return `
    <button type="button" class="npc-equip-result${selected ? ' is-selected' : ''}"
      style="--equip-accent:${_esc(rarity.color || '#4f8cff')}"
      data-action="npcPickEquipItem" data-npc-id="${_esc(npcId)}" data-slot="${_esc(slot)}" data-item-id="${_esc(item.id)}">
      <span class="npc-equip-result-visual ${image ? 'has-image' : ''}">
        ${image ? `<img src="${_esc(image)}" alt="">` : `<span>${def.icon}</span>`}
      </span>
      <span class="npc-equip-result-body">
        <span class="npc-equip-result-top">
          <span class="npc-equip-result-main">
            <strong>${_esc(item.nom || 'Objet sans nom')}</strong>
            <small>${_esc([types.slice(0, 2).join(' · ') || 'Équipement compatible', commerce].filter(Boolean).join(' · '))}</small>
          </span>
          ${rarity.name ? `<span class="npc-equip-rarity" style="--rarity:${_esc(rarity.color || '#9ca3af')}">${_esc(rarity.name)}</span>` : ''}
        </span>
        ${facts.filter(Boolean).length ? `<span class="npc-equip-result-facts">${facts.filter(Boolean).map(fact => `<b class="${fact.cls || ''}">${_esc(fact.label)}</b>`).join('')}</span>` : ''}
        ${extra.length ? `<span class="npc-eq-badges">${extra.slice(0, 9).map(entry => `<span class="npc-eq-badge ${entry.cls || ''}">${_esc(entry.label)}</span>`).join('')}</span>` : '<span class="npc-equip-no-bonus">Aucun bonus direct</span>'}
        ${(stats.length || traits.length) ? `<span class="npc-equip-result-tags">
          ${stats.slice(0, 4).map(stat => `<i class="${_npcStatTone(stat)}">${_esc(_npcStatLabel(stat))}</i>`).join('')}
          ${traits.slice(0, 3).map(trait => `<i>${_esc(trait)}</i>`).join('')}
          ${stats.length + traits.length > 7 ? `<i>+${stats.length + traits.length - 7}</i>` : ''}
        </span>` : ''}
        ${effect ? `<span class="npc-equip-result-effect">${_esc(effect)}</span>` : ''}
      </span>
      <span class="npc-equip-result-cta">${selected ? '✓ Équipé' : 'Équiper'}</span>
    </button>`;
}

function _npcEquipPreviewBadges(item, def) {
  const built = buildEquippedItemFromInventory(def.slot, item, null) || { ...item };
  built.itemId = item.id || item.itemId || '';
  built.nom = built.nom || item.nom || '';
  return _npcEquipBadges(built, def);
}

function _npcEquipPickerTitle() {
  const def = NPC_EQUIP_SLOTS.find(s => s.slot === _equipPickerState.slot);
  return `Équiper ${def?.slot || 'PNJ'}`;
}

function _renderEquipPickerHtml() {
  const { npcId, slot, q, filters, sort, filtersOpen } = _equipPickerState;
  const n = _npcs.find(x => x.id === npcId);
  const def = NPC_EQUIP_SLOTS.find(s => s.slot === slot);
  if (!n || !def) return '<div class="npc-equip-picker-empty">Emplacement introuvable.</div>';

  const equip = n.equipement || {};
  const current = equip[slot] || null;
  const all = _shopItemsForSlot(def);
  const facets = _npcEquipFacetData(all, def);
  const filtered = _npcSortEquipItems(all.filter(item => _npcEquipMatchesFilters(item, def, _equipPickerState)), sort);
  const shown = filtered.slice(0, 80);
  const more = Math.max(0, filtered.length - shown.length);
  const activeFilters = Object.entries(filters || {}).filter(([, value]) => value);

  return `
    <div class="npc-equip-picker">
      <div class="npc-equip-picker-head">
        <div>
          <div class="npc-equip-picker-slot">${def.icon} ${_esc(def.slot)}</div>
          <div class="npc-equip-picker-current">${current ? `Actuel : <b>${_esc(current.nom || 'Objet équipé')}</b>` : 'Aucun objet équipé'}</div>
        </div>
        <div class="npc-equip-picker-head-actions">
          <button class="btn btn-outline btn-sm" data-action="npcOpenManualEquip"
            data-npc-id="${_esc(npcId)}" data-slot="${_esc(slot)}">${current ? 'Personnaliser' : 'Créer manuellement'}</button>
          ${current ? `<button class="btn btn-outline btn-sm is-danger" data-action="npcClearEquipSlot"
            data-npc-id="${_esc(npcId)}" data-slot="${_esc(slot)}">Retirer</button>` : ''}
        </div>
      </div>

      <div class="npc-equip-picker-searchrow">
        <span aria-hidden="true">🔎</span>
        <input class="input-field npc-equip-search" data-input="npcEquipPickerSearch"
          value="${_esc(q || '')}" placeholder="Nom, effet, compétence, trait…" autocomplete="off">
        ${q ? `<button type="button" data-action="npcEquipPickerClearSearch" title="Effacer la recherche">✕</button>` : ''}
      </div>

      <div class="npc-equip-filter-panel${filtersOpen ? '' : ' is-collapsed'}">
        <div class="npc-equip-filter-head">
          <button type="button" class="npc-equip-filter-toggle" data-action="npcEquipPickerToggleFilters" aria-expanded="${filtersOpen ? 'true' : 'false'}">
            <span>${filtersOpen ? '▾' : '▸'}</span><strong>Filtres${activeFilters.length ? ` · ${activeFilters.length} actif${activeFilters.length > 1 ? 's' : ''}` : ''}</strong>
          </button>
          ${filtersOpen ? (activeFilters.length ? `<button type="button" data-action="npcEquipPickerReset">Tout réinitialiser</button>` : '<span>Combine plusieurs critères</span>') : '<span>Type, rareté, stats, dégâts…</span>'}
        </div>
        ${filtersOpen ? `<div class="npc-equip-filter-grid">
          <label><span>Type</span><select data-change="npcEquipPickerFilter" data-filter="type">${_npcFacetOptions(facets.types, filters.type, 'Tous les types')}</select></label>
          <label><span>Rareté</span><select data-change="npcEquipPickerFilter" data-filter="rarity">
            <option value="">Toutes les raretés</option>
            ${facets.rarities.map(value => { const rarity = _rarities.find(r => r.value === value); return `<option value="${value}" ${String(value) === String(filters.rarity) ? 'selected' : ''}>${_esc(rarity?.name || RARETE_NAMES[value] || `Rareté ${value}`)}</option>`; }).join('')}
          </select></label>
          <label><span>Caractéristique</span><select data-change="npcEquipPickerFilter" data-filter="stat">${_npcFacetOptions(facets.stats, filters.stat, 'Toutes les caractéristiques', _npcStatLabel)}</select></label>
          ${def.kind === 'weapon' ? `<label><span>Dégâts</span><select data-change="npcEquipPickerFilter" data-filter="damage">${_npcFacetOptions(facets.damages, filters.damage, 'Toutes les formules')}</select></label>` : ''}
          <label><span>Trait</span><select data-change="npcEquipPickerFilter" data-filter="trait">${_npcFacetOptions(facets.traits, filters.trait, 'Tous les traits')}</select></label>
          <label><span>Atout</span><select data-change="npcEquipPickerFilter" data-filter="feature">
            <option value="">Tous les atouts</option>
            ${facets.features.map(value => `<option value="${_esc(value)}" ${value === filters.feature ? 'selected' : ''}>${_esc(_npcEquipFeatureLabels[value] || value)}</option>`).join('')}
          </select></label>
          ${facets.availabilities.length ? `<label><span>Disponibilité</span><select data-change="npcEquipPickerFilter" data-filter="availability">${_npcFacetOptions(facets.availabilities, filters.availability, 'Toutes les disponibilités')}</select></label>` : ''}
          <label><span>Trier</span><select data-change="npcEquipPickerSort">
            <option value="name" ${sort === 'name' ? 'selected' : ''}>Nom A → Z</option>
            <option value="rarity" ${sort === 'rarity' ? 'selected' : ''}>Rareté décroissante</option>
            ${def.kind === 'weapon' ? `<option value="damage" ${sort === 'damage' ? 'selected' : ''}>Dégâts moyens</option>` : ''}
            ${def.kind === 'armor' ? `<option value="ca" ${sort === 'ca' ? 'selected' : ''}>CA décroissante</option>` : ''}
            <option value="price_asc" ${sort === 'price_asc' ? 'selected' : ''}>Prix croissant</option>
            <option value="price_desc" ${sort === 'price_desc' ? 'selected' : ''}>Prix décroissant</option>
          </select></label>
        </div>` : ''}
      </div>
      <div class="npc-equip-picker-meta">
        <strong>${filtered.length}</strong> objet${filtered.length !== 1 ? 's' : ''} trouvé${filtered.length !== 1 ? 's' : ''} sur ${all.length}
        ${more ? `<span>${more} autres disponibles en affinant la recherche</span>` : ''}
      </div>

      <div class="npc-equip-results">
        ${shown.length ? shown.map(item => _npcEquipCardHtml(item, def, current, npcId, slot)).join('') : `
          <div class="npc-equip-picker-empty">
            <b>Aucun objet ne correspond à tous ces critères.</b>
            <span>Retire un filtre, change la recherche ou crée cet équipement manuellement.</span>
            <button type="button" class="btn btn-outline btn-sm" data-action="npcEquipPickerReset">Réinitialiser les filtres</button>
          </div>`}
      </div>
    </div>`;
}

function _npcOpenEquipPicker(btn) {
  if (!STATE.isAdmin || !btn) return;
  _equipPickerState = {
    npcId: btn.dataset.npcId || '', slot: btn.dataset.slot || '', q: '', sort: 'name',
    filtersOpen: !window.matchMedia?.('(max-width: 560px)').matches,
    filters: { type: '', rarity: '', stat: '', damage: '', trait: '', feature: '', availability: '' },
  };
  openModal(_npcEquipPickerTitle(), _renderEquipPickerHtml(), { subtitle: 'Catalogue compatible et équipement personnalisé' });
  requestAnimationFrame(() => document.querySelector('.npc-equip-search')?.focus());
}

function _npcRerenderEquipPicker({ focusSearch = false, caret = null } = {}) {
  updateModalContent(_npcEquipPickerTitle(), _renderEquipPickerHtml(), { subtitle: 'Catalogue compatible et équipement personnalisé' });
  if (!focusSearch) return;
  requestAnimationFrame(() => {
    const next = document.querySelector('.npc-equip-search');
    if (!next) return;
    next.focus();
    if (caret != null) try { next.setSelectionRange(caret, caret); } catch {}
  });
}

function _npcEquipPickerSearch(el) {
  if (!el) return;
  const caret = el.selectionStart || 0;
  _equipPickerState.q = el.value || '';
  _npcRerenderEquipPicker({ focusSearch: true, caret });
}

function _npcEquipPickerFilter(el) {
  const key = el?.dataset?.filter;
  if (!key || !(key in (_equipPickerState.filters || {}))) return;
  _equipPickerState.filters[key] = el.value || '';
  _npcRerenderEquipPicker();
}

function _npcEquipPickerSort(el) {
  _equipPickerState.sort = el?.value || 'name';
  _npcRerenderEquipPicker();
}

function _npcEquipPickerToggleFilters() {
  _equipPickerState.filtersOpen = !_equipPickerState.filtersOpen;
  _npcRerenderEquipPicker();
}

function _npcEquipPickerReset({ keepSearch = false } = {}) {
  if (!keepSearch) _equipPickerState.q = '';
  _equipPickerState.filters = { type: '', rarity: '', stat: '', damage: '', trait: '', feature: '', availability: '' };
  _equipPickerState.sort = 'name';
  _npcRerenderEquipPicker({ focusSearch: keepSearch });
}

function _npcEquipPickerClearSearch() {
  _equipPickerState.q = '';
  _npcRerenderEquipPicker({ focusSearch: true, caret: 0 });
}

const _npcManualInput = (id, label, value = '', opts = '', cls = '') => `
  <label class="npc-manual-field ${cls}"><span>${_esc(label)}</span><input id="${id}" value="${_esc(value ?? '')}" ${opts}></label>`;
const _npcManualNumber = (id, label, value = 0, cls = '') => _npcManualInput(id, label, value || '', 'type="number" step="1"', cls);
const _npcManualStatOptions = (selected = '', emptyLabel = 'Aucune') => `
  <option value="">${_esc(emptyLabel)}</option>
  ${NPC_STATS.map(stat => `<option value="${stat.key}" ${stat.key === selected ? 'selected' : ''}>${stat.short} · ${_esc(NPC_STAT_LABELS[stat.key])}</option>`).join('')}`;
const _npcManualCheckedValues = name => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(input => input.value).filter(Boolean);

function _npcManualInitialItem(n, slot) {
  const equipped = n?.equipement?.[slot] || {};
  const source = equipped.itemId ? _shopItems.find(item => item.id === equipped.itemId) : null;
  return { ...(source || {}), ...equipped };
}

function _npcManualProfileField(key, label, current = []) {
  const selected = new Set(Array.isArray(current) ? current : []);
  return `
    <fieldset class="npc-manual-profile-field">
      <legend>${_esc(label)}</legend>
      <div class="npc-manual-profile-options">
        ${_damageTypes.map(type => `<label><input type="checkbox" name="npc-manual-profile-${key}" value="${_esc(type.id)}" ${selected.has(type.id) ? 'checked' : ''}><span>${type.icon || ''} ${_esc(type.label || type.id)}</span></label>`).join('')}
      </div>
    </fieldset>`;
}

function _renderManualEquipHtml(n, def, item) {
  const rarityValue = _npcRarityValue(item);
  const damageStats = new Set(Array.isArray(item.degatsStats) && item.degatsStats.length
    ? item.degatsStats.map(normalizeStatKey) : [normalizeStatKey(item.degatsStat || item.statAttaque)].filter(Boolean));
  const traits = (_getTraits(item) || []).join('\n');
  const skills = Object.entries(item.skillBonuses || {}).map(([name, value]) => `${name}: ${value}`).join('\n');
  const armorTypes = _npcUnique([...getArmorTypeOptions({ includeDisabled: false }), item.typeArmure]);
  const formats = _npcUnique([..._weaponFormats.map(format => format.label), item.format]);
  const rarityChoices = _rarities.length ? _rarities : [1, 2, 3, 4, 5].map(value => ({ value, name: RARETE_NAMES[value] || `Rareté ${value}` }));
  const bonusStep = def.kind === 'bijou' ? 2 : 3;
  const traitsStep = bonusStep + 1;
  const profileStep = traitsStep + 1;
  const weaponFields = def.kind === 'weapon' ? `
    <section class="npc-manual-section is-slot-specific">
      <div class="npc-manual-section-head"><span>2</span><div><b>Attaque de l’arme</b><small>Ces valeurs alimentent directement le VTT.</small></div></div>
      <div class="npc-manual-grid npc-manual-grid--weapon">
        <label class="npc-manual-field"><span>Type d’arme</span><select id="npc-manual-format">
          <option value="">Format libre / non défini</option>
          ${formats.map(value => `<option value="${_esc(value)}" ${value === item.format ? 'selected' : ''}>${_esc(value)}</option>`).join('')}
        </select></label>
        ${_npcManualInput('npc-manual-subtype', 'Type d’arme', item.sousType || item.typeArme || '', 'placeholder="Épée, arc, bâton…"')}
        ${_npcManualInput('npc-manual-damage', 'Formule de dégâts', item.degats || '', 'placeholder="1d8+2"')}
        ${_npcManualNumber('npc-manual-range', 'Portée (cases)', parseInt(item.portee, 10) || 1)}
        <label class="npc-manual-field"><span>Caractéristique de toucher</span><select id="npc-manual-touch-stat">${_npcManualStatOptions(item.toucherStat || item.statAttaque || '')}</select></label>
        <label class="npc-manual-field"><span>Type de dégâts imposé</span><select id="npc-manual-damage-type">
          <option value="">Automatique selon le format</option>
          ${_damageTypes.map(type => `<option value="${_esc(type.id)}" ${type.id === (item.damageTypeId || item.elementId) ? 'selected' : ''}>${type.icon || ''} ${_esc(type.label || type.id)}</option>`).join('')}
        </select></label>
      </div>
      <fieldset class="npc-manual-stat-picks"><legend>Caractéristiques ajoutées aux dégâts</legend>
        ${NPC_STATS.map(stat => `<label class="${_npcStatTone(stat.key)}"><input type="checkbox" name="npc-manual-damage-stat" value="${stat.key}" ${damageStats.has(stat.key) ? 'checked' : ''}><span><b>${stat.short}</b><small>${_esc(NPC_STAT_LABELS[stat.key])}</small></span></label>`).join('')}
      </fieldset>
    </section>` : '';
  const armorFields = def.kind === 'armor' ? `
    <section class="npc-manual-section is-slot-specific">
      <div class="npc-manual-section-head"><span>2</span><div><b>Protection de l’armure</b><small>Le type participe aux bonus de set de l’aventure.</small></div></div>
      <div class="npc-manual-grid">
        <label class="npc-manual-field"><span>Type d’armure</span><select id="npc-manual-armor-type">
          <option value="">Sans type de set</option>
          ${armorTypes.map(value => `<option value="${_esc(value)}" ${value === item.typeArmure ? 'selected' : ''}>${_esc(value)}</option>`).join('')}
        </select></label>
        ${_npcManualNumber('npc-manual-ca', 'CA de l’armure', parseInt(item.ca, 10) || 0)}
      </div>
    </section>` : '';
  return `
    <form class="npc-equip-manual" data-npc-id="${_esc(n.id)}" data-slot="${_esc(def.slot)}" onsubmit="return false">
      <div class="npc-manual-intro">
        <span class="npc-manual-intro-icon">${def.icon}</span>
        <div><b>${_esc(def.slot)}</b><span>Équipement propre à ${_esc(n.nom || 'ce PNJ')} · aucun article boutique ne sera créé.</span></div>
      </div>

      <section class="npc-manual-section">
        <div class="npc-manual-section-head"><span>1</span><div><b>Identité</b><small>Ce que tu retrouveras immédiatement sur la fiche.</small></div></div>
        <div class="npc-manual-grid">
          ${_npcManualInput('npc-manual-name', 'Nom de l’équipement', item.nom || '', 'required placeholder="Nom obligatoire"')}
          <label class="npc-manual-field"><span>Rareté</span><select id="npc-manual-rarity">
            <option value="">Non définie</option>
            ${rarityChoices.map(rarity => `<option value="${rarity.value}" ${rarity.value === rarityValue ? 'selected' : ''}>${_esc(rarity.name)}</option>`).join('')}
          </select></label>
        </div>
      </section>

      ${weaponFields}${armorFields}

      <section class="npc-manual-section">
        <div class="npc-manual-section-head"><span>${bonusStep}</span><div><b>Bonus</b><small>Valeurs ajoutées tant que l’objet reste équipé.</small></div></div>
        <div class="npc-manual-subtitle">Caractéristiques</div>
        <div class="npc-manual-bonus-grid">
          ${NPC_STATS.map(stat => _npcManualNumber(`npc-manual-stat-${stat.key}`, `${stat.short} · ${NPC_STAT_LABELS[stat.key]}`, getItemStatBonus(item, stat.key), _npcStatTone(stat.key))).join('')}
        </div>
        <div class="npc-manual-subtitle">Valeurs dérivées</div>
        <div class="npc-manual-bonus-grid">
          ${_npcManualNumber('npc-manual-pv', 'PV max', parseInt(item.pvMaxBonus) || 0, 'derived-tone derived-pv')}
          ${_npcManualNumber('npc-manual-pm', 'PM max', parseInt(item.pmMaxBonus) || 0, 'derived-tone derived-pm')}
          ${_npcManualNumber('npc-manual-speed', 'Vitesse', parseInt(item.vitesseBonus) || 0, 'derived-tone derived-speed')}
          ${_npcManualNumber('npc-manual-init', 'Initiative', parseInt(item.initiativeBonus) || 0, 'derived-tone derived-init')}
          ${_npcManualNumber('npc-manual-ca-bonus', 'CA supplémentaire', parseInt(item.caBonus) || 0, 'derived-tone derived-ca')}
        </div>
        <label class="npc-manual-field is-wide"><span>Bonus de compétences</span><textarea id="npc-manual-skills" rows="3" placeholder="Perception: 2&#10;Intimidation: 1">${_esc(skills)}</textarea><small>Une compétence par ligne, sous la forme Nom: bonus.</small></label>
      </section>

      <section class="npc-manual-section">
        <div class="npc-manual-section-head"><span>${traitsStep}</span><div><b>Traits et effet</b><small>Informations visibles sur la carte équipée.</small></div></div>
        <div class="npc-manual-grid">
          <label class="npc-manual-field"><span>Traits</span><textarea id="npc-manual-traits" rows="4" placeholder="Un trait par ligne">${_esc(traits)}</textarea></label>
          <label class="npc-manual-field"><span>Effet / particularité</span><textarea id="npc-manual-effect" rows="4" placeholder="Réaction, passif, condition…">${_esc(item.particularite || item.effet || item.description || '')}</textarea></label>
        </div>
      </section>

      <details class="npc-manual-section npc-manual-profiles" ${item.damageProfile ? 'open' : ''}>
        <summary><span>${profileStep}</span><div><b>Interactions de dégâts</b><small>Optionnel · résistances, immunités, absorptions et faiblesses.</small></div></summary>
        <div class="npc-manual-profile-grid">
          ${_npcManualProfileField('resistances', 'Résistances', item.damageProfile?.resistances)}
          ${_npcManualProfileField('immunites', 'Immunités', item.damageProfile?.immunites)}
          ${_npcManualProfileField('absorptions', 'Absorptions', item.damageProfile?.absorptions)}
          ${_npcManualProfileField('faiblesses', 'Faiblesses', item.damageProfile?.faiblesses)}
        </div>
      </details>

      <div class="npc-manual-footer">
        <button type="button" class="btn btn-outline" data-action="npcManualEquipCancel">Retour au catalogue</button>
        <button type="button" class="btn btn-gold" data-action="npcSaveManualEquip" data-npc-id="${_esc(n.id)}" data-slot="${_esc(def.slot)}">Enregistrer et équiper</button>
      </div>
    </form>`;
}

function _npcOpenManualEquip(btn) {
  if (!STATE.isAdmin || !btn) return;
  const n = _npcs.find(entry => entry.id === btn.dataset.npcId);
  const def = NPC_EQUIP_SLOTS.find(entry => entry.slot === btn.dataset.slot);
  if (!n || !def) return;
  const item = _npcManualInitialItem(n, def.slot);
  pushModal(`Créer · ${def.slot}`, _renderManualEquipHtml(n, def, item), () => _npcRerenderEquipPicker(), {
    subtitle: 'Équipement personnalisé du PNJ',
  });
  requestAnimationFrame(() => document.getElementById('npc-manual-name')?.focus());
}

function _npcParseSkillBonuses(value = '') {
  const result = {};
  String(value).split(/\r?\n|;/).forEach(line => {
    const match = line.trim().match(/^(.+?)\s*[:=]\s*([+-]?\d+)$/);
    if (!match) return;
    const amount = parseInt(match[2], 10) || 0;
    if (amount) result[match[1].trim()] = amount;
  });
  return result;
}

const _npcManualNum = id => parseInt(document.getElementById(id)?.value, 10) || 0;

async function _npcSaveManualEquip(btn) {
  if (!STATE.isAdmin || !btn) return;
  const n = _npcs.find(entry => entry.id === btn.dataset.npcId);
  const def = NPC_EQUIP_SLOTS.find(entry => entry.slot === btn.dataset.slot);
  const nameInput = document.getElementById('npc-manual-name');
  const name = nameInput?.value?.trim() || '';
  if (!n || !def) return;
  if (!name) {
    showNotif('Donne un nom à cet équipement.', 'warning');
    nameInput?.focus();
    return;
  }

  const previous = _npcManualInitialItem(n, def.slot);
  const statAliases = { force: 'fo', dexterite: 'dex', constitution: 'co', intelligence: 'in', sagesse: 'sa', charisme: 'ch' };
  const item = {
    nom: name,
    itemId: '',
    manual: true,
    rarete: _npcManualNum('npc-manual-rarity') || '',
    traits: String(document.getElementById('npc-manual-traits')?.value || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean),
    particularite: document.getElementById('npc-manual-effect')?.value?.trim() || '',
    skillBonuses: _npcParseSkillBonuses(document.getElementById('npc-manual-skills')?.value || ''),
    pvMaxBonus: _npcManualNum('npc-manual-pv'),
    pmMaxBonus: _npcManualNum('npc-manual-pm'),
    vitesseBonus: _npcManualNum('npc-manual-speed'),
    initiativeBonus: _npcManualNum('npc-manual-init'),
    caBonus: _npcManualNum('npc-manual-ca-bonus'),
    image: previous.image || '',
    actions: Array.isArray(previous.actions) ? previous.actions.map(action => ({ ...action })) : [],
  };
  NPC_STATS.forEach(stat => { item[statAliases[stat.key]] = _npcManualNum(`npc-manual-stat-${stat.key}`); });
  const damageProfile = {};
  ['resistances', 'immunites', 'absorptions', 'faiblesses'].forEach(key => {
    const values = _npcManualCheckedValues(`npc-manual-profile-${key}`);
    if (values.length) damageProfile[key] = values;
  });
  if (Object.keys(damageProfile).length) item.damageProfile = damageProfile;

  if (def.kind === 'weapon') {
    item.format = document.getElementById('npc-manual-format')?.value || '';
    item.formatId = _weaponFormats.find(format => format.label === item.format)?.id || '';
    item.sousType = document.getElementById('npc-manual-subtype')?.value?.trim() || '';
    item.typeArme = item.sousType;
    item.degats = document.getElementById('npc-manual-damage')?.value?.trim() || '';
    item.portee = Math.max(0, _npcManualNum('npc-manual-range'));
    item.toucherStat = document.getElementById('npc-manual-touch-stat')?.value || '';
    item.damageTypeId = document.getElementById('npc-manual-damage-type')?.value || '';
    item.degatsStats = [...document.querySelectorAll('input[name="npc-manual-damage-stat"]:checked')].map(input => input.value);
    item.degatsStat = item.degatsStats[0] || '';
    item.statAttaque = item.toucherStat || item.degatsStat || '';
  } else if (def.kind === 'armor') {
    item.typeArmure = document.getElementById('npc-manual-armor-type')?.value || '';
    item.slotArmure = def.armVal || def.slot;
    item.ca = _npcManualNum('npc-manual-ca');
  } else {
    item.slotBijou = def.slot;
  }

  const equip = { ...(n.equipement || {}), [def.slot]: item };
  const statsBonus = computeEquipStatsBonus(equip);
  if (!(await trySave('npcs', n.id, { equipement: equip, statsBonus }))) return;
  n.equipement = equip;
  n.statsBonus = statsBonus;
  showNotif(`${name} équipé sur ${def.slot}.`, 'success');
  popModal();
  closeModal();
  _refreshActivePanel();
}

const _npcSlotLabel = (def = {}) => ({
  'Main principale': 'Main principale',
  'Main secondaire': 'Main secondaire',
  'TÃªte': 'Tete',
  'Torse': 'Torse',
  'Bottes': 'Bottes',
  'Amulette': 'Amulette',
  'Anneau': 'Anneau',
  'Objet magique': 'Objet magique',
})[def.slot] || def.slot || '';

const _npcSlotIcon = (def = {}) => {
  if (def.kind === 'weapon') return def.slot === 'Main secondaire' ? '&#128481;&#65039;' : '&#9876;&#65039;';
  if (def.kind === 'armor') return '&#129686;';
  return '&#128142;';
};

function _npcBonusChips(item = {}, def = {}) {
  const chips = [];
  if (def.kind === 'weapon' && item.format) chips.push({ lbl: item.format, cls: '' });
  const rarity = _npcRarityMeta(item);
  if (rarity.name) chips.push({ lbl: rarity.name, cls: 'rarity' });
  if (item.manual) chips.push({ lbl: 'Personnalisé', cls: 'manual' });
  // Le type d'armure est déjà affiché dans l'en-tête de la carte : ne pas le
  // répéter dans les bonus juste en dessous.
  const caTotal = (parseInt(item.ca) || 0) + (parseInt(item.caBonus) || 0);
  if (caTotal) chips.push({ lbl: `CA ${caTotal > 0 ? '+' : ''}${caTotal}`, cls: 'derived-tone derived-ca' });
  NPC_STATS.forEach(s => {
    let v = 0;
    try { v = getItemStatBonus(item, s.key); } catch {}
    if (v) chips.push({ lbl: `${s.short} ${v > 0 ? '+' : ''}${v}`, cls: `${v > 0 ? 'pos' : 'neg'} ${_npcStatTone(s.key)}` });
  });
  [['pvMaxBonus', 'PV'], ['pmMaxBonus', 'PM'], ['vitesseBonus', 'Vit.'], ['initiativeBonus', 'Init.']].forEach(([key, label]) => {
    const v = parseInt(item[key]) || 0;
    if (v) chips.push({ lbl: `${label} ${v > 0 ? '+' : ''}${v}`, cls: _npcDerivedTone(key) });
  });
  return chips.map(chip => `<span class="badge-chip ${chip.cls || ''}"${chip.style || ''}>${_esc(chip.lbl)}</span>`).join('');
}

function _npcDisplayTraits(item = {}) {
  return (_getTraits?.(item) || [])
    .map(trait => String(trait || '').trim())
    .filter(trait => trait && !['-', '--', '—'].includes(trait));
}

function _npcTraitHtml(trait) {
  const long = trait.length > 42 ? ' is-long' : '';
  return `<span class="trait${long}">${_esc(trait)}</span>`;
}

function _npcWeaponParts(n, item = {}) {
  const dmgStats = Array.isArray(item.degatsStats) && item.degatsStats.length
    ? item.degatsStats
    : [item.degatsStat || item.statAttaque || 'force'];
  const touchStat = item.toucherStats?.[0] || item.toucherStat || item.statAttaque || dmgStats[0] || 'force';
  const setBonus = getArmorSetData({ equipement: n?.equipement || {} }).modifiers?.toucherBonus || 0;
  const touch = _npcEffectiveMod(n, touchStat) + setBonus;
  const dmgMod = dmgStats.reduce((sum, key) => sum + _npcEffectiveMod(n, key), 0);
  const dice = item.degats || '2d4';
  return {
    touchRoll: `1d20${touch ? _signedNum(touch) : ''}`,
    damageRoll: `${dice}${dmgMod ? _signedNum(dmgMod) : ''}`,
    touchSub: `${statShortNpc(touchStat)}${setBonus ? ` - Set ${_signedNum(setBonus)}` : ''}`,
    damageSub: dmgStats.map(statShortNpc).join('+'),
    range: parseInt(item.portee, 10) || 1,
  };
}

function _renderNpcEquipLikeCharacter(n, equip = {}) {
  const setData = getArmorSetData({ equipement: equip || {} });
  const setText = getArmorSetChipText(setData);
  const weaponDefs = NPC_EQUIP_SLOTS.filter(def => def.kind === 'weapon');
  const armorDefs = NPC_EQUIP_SLOTS.filter(def => def.kind !== 'weapon');
  const primarySlot = 'Main principale';
  const renderWeapon = (def) => {
    const raw = equip[def.slot] || {};
    const isDefault = def.slot === primarySlot && !raw.nom;
    const item = isDefault ? (_npcWeaponInfo(n).weapon || {}) : raw;
    if (!item.nom && !isDefault) {
      return `<div class="weap-card npc-weap-card empty" style="opacity:.65;border-style:dashed">
        <div class="weap-head">
          <div>
            <div class="weap-slot">${_npcSlotIcon(def)} ${_esc(_npcSlotLabel(def))}</div>
            <div class="weap-name muted">- Vide -</div>
          </div>
          <button class="weap-edit" data-action="npcOpenEquipPicker" data-npc-id="${_esc(n.id)}" data-slot="${_esc(def.slot)}" title="Equiper">&#9998;</button>
        </div>
      </div>`;
    }
    const parts = _npcWeaponParts(n, item);
    const traits = item.nom ? _npcDisplayTraits(item) : [];
    const badges = _npcBonusChips(item, def);
    return `<div class="weap-card npc-weap-card ${def.slot === primarySlot ? 'main' : ''}">
      <div class="weap-head">
        <div>
          <div class="weap-slot">${_npcSlotIcon(def)} ${_esc(_npcSlotLabel(def))}</div>
          <div class="weap-name">${_esc(item.nom || 'Poings')}${isDefault ? ' <span class="def">par defaut</span>' : ''}</div>
        </div>
        <div class="npc-eq-toolbar">
          ${item.format ? `<span class="weap-format">${_esc(item.format)}</span>` : ''}
          <button class="weap-edit" data-action="npcOpenEquipPicker" data-npc-id="${_esc(n.id)}" data-slot="${_esc(def.slot)}" title="Changer">&#9998;</button>
          ${!isDefault && raw.nom ? `<button class="weap-edit is-danger" data-action="npcClearEquipSlot" data-npc-id="${_esc(n.id)}" data-slot="${_esc(def.slot)}" title="Vider">X</button>` : ''}
        </div>
      </div>
      <div class="weap-rolls">
        <div class="weap-roll">
          <span class="weap-roll-lbl">Toucher</span>
          <span class="weap-roll-val touch">${_esc(parts.touchRoll)}</span>
          <span class="weap-roll-sub">${_esc(parts.touchSub)}</span>
        </div>
        <div class="weap-rolls-sep"></div>
        <div class="weap-roll">
          <span class="weap-roll-lbl">Degats</span>
          <span class="weap-roll-val dmg">${_esc(parts.damageRoll)}</span>
          <span class="weap-roll-sub">${_esc(parts.damageSub)}</span>
        </div>
      </div>
      ${badges ? `<div class="weap-badges">${badges}</div>` : ''}
      ${(parts.range || traits.length || item.particularite) ? `<div class="weap-meta">
        <span>Portee ${_esc(parts.range)}c</span>
        ${item.particularite ? `<div class="weap-particularite">${_esc(item.particularite)}</div>` : ''}
        ${traits.length ? `<div class="weap-traits">${traits.map(_npcTraitHtml).join('')}</div>` : ''}
      </div>` : ''}
    </div>`;
  };
  const renderArmor = (def) => {
    const item = equip[def.slot] || {};
    if (!item.nom) {
      return `<div class="armor-card empty npc-armor-card">
        <div class="armor-slot">
          <span>${_npcSlotIcon(def)} ${_esc(_npcSlotLabel(def))}</span>
          <button class="weap-edit" data-action="npcOpenEquipPicker" data-npc-id="${_esc(n.id)}" data-slot="${_esc(def.slot)}" title="Equiper">&#9998;</button>
        </div>
        <div class="armor-name muted">- Vide -</div>
      </div>`;
    }
    const typeMeta = def.kind === 'armor' && item.typeArmure ? getArmorTypeMeta(item.typeArmure) : null;
    const typePill = item.typeArmure
      ? `<span class="armor-type-pill ${typeMeta?.tone || 'neutral'}" ${typeMeta?.color ? `style="--armor-type-color:${_esc(typeMeta.color)}"` : ''}>${_esc(typeMeta?.label || item.typeArmure)}</span>`
      : '';
    const badges = _npcBonusChips(item, def);
    const traits = _npcDisplayTraits(item);
    return `<div class="armor-card equipped npc-armor-card">
      <div class="armor-slot">
        <span class="armor-slot-name">${_npcSlotIcon(def)} ${_esc(_npcSlotLabel(def))}</span>
        <span class="armor-slot-right">
          ${typePill}
          <button class="weap-edit" data-action="npcOpenEquipPicker" data-npc-id="${_esc(n.id)}" data-slot="${_esc(def.slot)}" title="Changer">&#9998;</button>
          <button class="weap-edit is-danger" data-action="npcClearEquipSlot" data-npc-id="${_esc(n.id)}" data-slot="${_esc(def.slot)}" title="Vider">X</button>
        </span>
      </div>
      <div class="armor-name">${_esc(item.nom)}</div>
      ${badges ? `<div class="armor-badges">${badges}</div>` : ''}
      ${traits.length ? `<div class="armor-traits">${traits.map(_npcTraitHtml).join('')}</div>` : ''}
    </div>`;
  };
  const setBadge = setText ? `<span class="set-badge ${setData.isActive ? 'active' : ''}" title="${_esc(setText)}">
    <span class="set-badge-ico">&#127793;</span><b>Set ${setData.equippedCount || 0}/${setData.trackedSlots?.length || 0}</b>${setData.isActive ? `<span class="set-badge-fx">${_esc(setText)}</span>` : ''}
  </span>` : '';
  return `
    <div class="npc-eq-block npc-eq-block--character">
      <div class="section npc-equipment-section npc-equipment-section--weapons">
        <div class="section-head">
          <div class="section-title"><span class="ico">&#9876;&#65039;</span> Armes &eacute;quip&eacute;es</div>
          <button class="section-action" data-action="npcOpenEquipPicker" data-npc-id="${_esc(n.id)}" data-slot="${_esc(primarySlot)}">+ &Eacute;quiper</button>
        </div>
        <div class="weap-grid">${weaponDefs.map(renderWeapon).join('')}</div>
      </div>
      <div class="section npc-equipment-section npc-equipment-section--armor">
        <div class="section-head">
          <div class="section-title"><span class="ico">&#129686;</span> Armures & Accessoires</div>
          <div class="armor-section-tools">${setBadge}</div>
        </div>
        <div class="armor-grid armor-grid--equipment">${armorDefs.map(renderArmor).join('')}</div>
        ${setText && !setData.isActive ? `<div class="set-hint">${_esc(setText)}</div>` : ''}
      </div>
    </div>`;
}

function _renderNpcEquip(n, equip, summary) {
  return _renderNpcEquipLikeCharacter(n, equip, summary);

  const setData = getArmorSetData({ equipement: equip || {} });
  const setText = getArmorSetChipText(setData);
  const setLine = setText ? `
    <div class="npc-setline${setData.isActive ? ' is-active' : ''}">
      <b>${setData.isActive ? 'Set actif' : 'Set incomplet'}</b>
      <span>${_esc(setText)}</span>
      ${setData.activeEffect ? `<em>${_esc(setData.activeEffect)}</em>` : ''}
    </div>` : '';
  const modernSlotCard = (def) => {
    const eq = equip[def.slot] || null;
    const opts = _shopItemsForSlot(def);
    const badges = eq ? _npcEquipBadges(eq, def) : '';
    const itemType = eq ? (def.kind === 'armor'
      ? (eq.typeArmure || eq.slotArmure || eq.type)
      : def.kind === 'weapon'
        ? (eq.format || eq.typeArme || eq.sousType || eq.type)
        : (eq.slotBijou || eq.type || eq.template)) : '';
    const itemSub = eq ? [itemType, eq.slotArmure || eq.slotBijou].filter(Boolean).join(' - ') : '';
    return `
      <div class="npc-eq-cell${eq ? ' is-on' : ''}">
        <div class="npc-eq-slot">
          <span>${def.icon} ${_esc(def.slot)}</span>
          <small>${opts.length} choix</small>
        </div>
        <div class="npc-eq-current${eq ? '' : ' is-empty'}">
          <strong>${eq ? _esc(eq.nom || 'Objet équipé') : 'Vide'}</strong>
          <span>${eq ? _esc(itemSub || 'Objet boutique') : 'Aucun objet équipé'}</span>
        </div>
        ${badges ? `<div class="npc-eq-badges">${badges}</div>` : ''}
        <div class="npc-eq-actions">
          <button class="npc-eq-pick-btn" type="button" data-action="npcOpenEquipPicker"
            data-npc-id="${_esc(n.id)}" data-slot="${_esc(def.slot)}">
            Choisir
          </button>
          ${eq ? `
            <button class="npc-eq-clear-btn" type="button" title="Vider l'emplacement" data-action="npcClearEquipSlot"
              data-npc-id="${_esc(n.id)}" data-slot="${_esc(def.slot)}">
              X
            </button>` : ''}
        </div>
      </div>`;
  };
  return `
    <div class="npc-eq-block">
      <div class="npc-eq-hd">
        <span class="npc-edit-lbl">Équipement</span>
        <span class="npc-eq-combat">${_esc(summary.dmg)} - portée ${_esc(summary.range)}</span>
      </div>
      ${setLine}
      <div class="npc-eq-grid">${NPC_EQUIP_SLOTS.map(modernSlotCard).join('')}</div>
    </div>`;

  const slotCard = (def) => {
    const eq   = equip[def.slot] || null;
    const opts = _shopItemsForSlot(def);
    const options = ['<option value="">— Vide —</option>']
      .concat(opts.map(i => `<option value="${i.id}" ${eq?.itemId === i.id ? 'selected' : ''}>${_esc(i.nom || '?')}</option>`))
      .join('');
    const badges = eq ? _npcEquipBadges(eq, def) : '';
    return `
      <div class="npc-eq-cell${eq ? ' is-on' : ''}">
        <div class="npc-eq-slot">${def.icon} ${def.slot}</div>
        <select class="npc-select npc-eq-sel" data-change="npcEquipSlot" data-npc-id="${n.id}" data-slot="${_esc(def.slot)}">
          ${options}
        </select>
        ${badges ? `<div class="npc-eq-badges">${badges}</div>` : ''}
      </div>`;
  };
  return `
    <div class="npc-eq-block">
      <div class="npc-eq-hd">
        <span class="npc-edit-lbl">🎒 Équipement</span>
        <span class="npc-eq-combat">🗡️ ${_esc(summary.dmg)} · ⌖ ${_esc(summary.range)}</span>
      </div>
      <div class="npc-eq-grid">${NPC_EQUIP_SLOTS.map(slotCard).join('')}</div>
    </div>`;
}

function _renderStatsPanel(n) {
  if (!STATE.isAdmin) return ''; // bloc réservé MJ
  const stats = n?.stats || {};
  const { equip, sBonus, dBonus, caEquip } = _npcEquipEffect(n);
  const legacyWeaponInfo = _npcWeaponInfo(n);
  const mainW = { degats: legacyWeaponInfo.damage, portee: `${legacyWeaponInfo.range}c` };
  const combat = { weapon: {}, damage: legacyWeaponInfo.damage, range: `${legacyWeaponInfo.range}c` };

  // Résumé combat : arme équipée en Main principale, sinon arme legacy (combat).
  const weaponInfo = _npcWeaponInfo(n);
  const dmg    = mainW?.degats || combat.weapon?.degats || combat.damage || '—';
  const range  = mainW?.portee || combat.range || combat.weapon?.portee || '—';

  // Vitaux : base saisie + contribution équipement = total.
  const vitalEquip = {
    pv:      dBonus.pvMaxBonus,
    pm:      dBonus.pmMaxBonus,
    ca:      caEquip + dBonus.caBonus,
    vitesse: dBonus.vitesseBonus,
  };
  const vitals = NPC_VITALS.map(v => {
    const base  = n?.[v.key];
    const bonus = vitalEquip[v.key] || 0;
    const total = (Number(base) || 0) + bonus;
    return `
    <div class="npc-stat-cell">
      <div class="npc-stat-k">${v.icon} ${v.label}</div>
      <input type="number" class="npc-inline" data-change="npcInlineSave"
        data-npc-id="${n.id}" data-field="${v.key}" value="${base ?? ''}" placeholder="—"
        title="Valeur de base (hors équipement)">
      ${bonus ? `<div class="npc-stat-mod" title="Base ${Number(base) || 0} + équipement ${bonus > 0 ? '+' : ''}${bonus}">= ${total} <span class="npc-eq-plus">(${bonus > 0 ? '+' : ''}${bonus})</span></div>` : ''}
    </div>`;
  }).join('');

  const statCells = NPC_STATS.map(s => {
    const score = stats[s.key];
    const bonus = sBonus[s.key] || 0;
    const effScore = score != null ? (Number(score) || 0) + bonus : null;
    return `
    <div class="npc-stat-cell">
      <div class="npc-stat-k">${s.short}</div>
      <input type="number" class="npc-inline" data-change="npcInlineSave"
        data-npc-id="${n.id}" data-field="stat:${s.key}" value="${score ?? ''}" placeholder="—"
        title="Score de base (hors équipement)">
      <div class="npc-stat-mod">${effScore != null ? `${_modStr(effScore)}${bonus ? ` <span class="npc-eq-plus">(${bonus > 0 ? '+' : ''}${bonus})</span>` : ''}` : '&nbsp;'}</div>
    </div>`;
  }).join('');

  return `
    <div class="npc-card npc-stats-card">
      <div class="npc-card-hd">
        <div class="npc-card-title">🛡️ Combat &amp; stats <span style="font-weight:400;color:var(--text-dim)">(MJ)</span></div>
      </div>
      <div class="npc-stat-grid">${vitals}</div>
      <div class="npc-stat-grid npc-stat-grid--6">${statCells}</div>
      ${_renderNpcEquip(n, equip, { dmg, range })}
    </div>`;
}

// Équipe / retire un objet boutique sur un slot PNJ, recalcule le bonus de stats.
async function _npcEquipSlot(el) {
  if (!STATE.isAdmin || !el) return;
  await _npcApplyEquipSlot(el.dataset.npcId, el.dataset.slot, el.value);
}

async function _npcPickEquipItem(btn) {
  if (!STATE.isAdmin || !btn) return;
  await _npcApplyEquipSlot(btn.dataset.npcId, btn.dataset.slot, btn.dataset.itemId, { closePicker: true });
}

async function _npcClearEquipSlot(btn) {
  if (!STATE.isAdmin || !btn) return;
  await _npcApplyEquipSlot(btn.dataset.npcId, btn.dataset.slot, '', { closePicker: !!btn.closest('.npc-equip-picker') });
}

async function _npcApplyEquipSlot(id, slot, itemId, { closePicker = false } = {}) {
  if (!STATE.isAdmin) return;
  const n = _npcs.find(x => x.id === id); if (!n || !slot) return;
  const equip = { ...(n.equipement || {}) };
  if (!itemId) {
    delete equip[slot];
  } else {
    const item = _shopItems.find(i => i.id === itemId);
    if (!item) return;
    const built = buildEquippedItemFromInventory(slot, item, null);
    if (!built) return;
    built.itemId = item.id; // identité boutique (buildEquipped… lit item.itemId, absent ici)
    // Les PNJ n'ont pas d'inventaire source à relire plus tard : conserver ici
    // les métadonnées utiles au catalogue, au VTT et aux actions d'équipement.
    built.rarete = item.rarete || '';
    built.image = item.image || item.imageUrl || '';
    built.formatId = item.formatId || '';
    built.damageTypeId = item.damageTypeId || item.elementId || '';
    built.actions = Array.isArray(item.actions) ? item.actions.map(action => ({ ...action })) : [];
    equip[slot] = built;
  }
  const statsBonus = computeEquipStatsBonus(equip);
  n.equipement = equip; n.statsBonus = statsBonus;
  if (await trySave('npcs', id, { equipement: equip, statsBonus })) {
    showNotif(itemId ? 'Équipement mis à jour.' : 'Emplacement vidé.', 'success');
  }
  if (closePicker) closeModal();
  _refreshActivePanel();
}

// ── Vue MJ : tableau condensé de tous les PNJ avec stats ────────────────────
async function _npcPersistActions(n, actions) {
  const clean = Array.isArray(actions) ? actions.map(a => ({ ...a, actif: true })) : [];
  n.actions = clean;
  if (await trySave('npcs', n.id, { actions: clean })) {
    showNotif('Actions du PNJ mises a jour.', 'success');
    _refreshActivePanel();
  }
}

async function _npcEditAction(btn) {
  if (!STATE.isAdmin || !btn) return;
  const n = _npcs.find(x => x.id === btn.dataset.npcId);
  if (!n) return;
  const idx = parseInt(btn.dataset.idx, 10);
  const holder = { nom: n.nom || 'PNJ', actions: Array.isArray(n.actions) ? n.actions.map(a => ({ ...a })) : [] };
  const { editItemSpell } = await import('./characters/spells.js');
  editItemSpell(holder, Number.isFinite(idx) ? idx : -1, async (updated) => {
    await _npcPersistActions(n, updated?.actions || []);
  }, _npcCalcChar(n));
}

async function _npcDeleteAction(btn) {
  if (!STATE.isAdmin || !btn) return;
  const n = _npcs.find(x => x.id === btn.dataset.npcId);
  const idx = parseInt(btn.dataset.idx, 10);
  if (!n || !Number.isFinite(idx)) return;
  if (!await confirmModal('Supprimer cette action PNJ ?', { title: 'Confirmation' })) return;
  const actions = Array.isArray(n.actions) ? [...n.actions] : [];
  actions.splice(idx, 1);
  await _npcPersistActions(n, actions);
}

const _mjVitalCellInner = (v) => v == null ? '—' : String(v);
const _mjStatCellInner  = (s) => s == null ? '—'
  : `${s}<br><span style="font-size:.6rem;color:var(--text-muted)">${_modStr(s)}</span>`;

function _renderMjStatsRow(n) {
  const af    = afx(_affiniteNiveau(n));
  const stats = n.stats || {};

  const vitalCells = NPC_VITALS.map(v => `
    <td data-mj-cell="${n.id}-${v.key}"
      data-action="_mjEditField" data-npc-id="${n.id}" data-field="${v.key}"
      title="Cliquer pour modifier ${v.label}"
      style="cursor:pointer;text-align:center;padding:.4rem .25rem;font-weight:700;
      color:${n[v.key] == null ? 'var(--text-dim)' : 'var(--text)'};
      background:rgba(232,184,75,.05)">${_mjVitalCellInner(n[v.key])}</td>`).join('');

  const statCells = NPC_STATS.map(s => `
    <td data-mj-cell="${n.id}-stats.${s.key}"
      data-action="_mjEditField" data-npc-id="${n.id}" data-field="stats.${s.key}"
      title="Cliquer pour modifier ${s.short}"
      style="cursor:pointer;text-align:center;padding:.4rem .2rem;line-height:1.1;
      color:${stats[s.key] == null ? 'var(--text-dim)' : 'var(--text)'};
      background:rgba(232,184,75,.05)">${_mjStatCellInner(stats[s.key])}</td>`).join('');

  return `
    <tr style="border-bottom:1px solid rgba(255,255,255,.04)"
      data-hov-bg="rgba(255,255,255,.02)">
      <td style="padding:.35rem;text-align:left;cursor:pointer;color:var(--text);
        max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
        data-action="_mjOpenNpc" data-id="${n.id}" title="Ouvrir la fiche">
        <span style="display:inline-block;width:6px;height:6px;border-radius:50%;
          background:${af.couleur};margin-right:.4rem;vertical-align:middle"></span>
        <strong>${_esc(n.nom || '?')}</strong>
      </td>
      ${vitalCells}
      ${statCells}
    </tr>`;
}

let _mjFilter = '';

function _mjFilteredNpcs() {
  return _npcs.filter(n => _npcMatchesSearch(n, _mjFilter));
}

function _renderMjStatsTbody() {
  const list = _mjFilteredNpcs();
  if (!list.length) {
    return `<tr><td colspan="${1 + NPC_VITALS.length + NPC_STATS.length}"
      style="text-align:center;padding:2rem;color:var(--text-dim);font-style:italic">
      ${_npcs.length ? `Aucun PNJ pour « ${_esc(_mjFilter)} »` : 'Aucun PNJ'}</td></tr>`;
  }
  return list.map(_renderMjStatsRow).join('');
}

function _mjStatsFilter(val) {
  _mjFilter = val || '';
  const tbody = document.querySelector('#mj-stats-table tbody');
  if (tbody) tbody.innerHTML = _renderMjStatsTbody();
}

function _openMjStatsView() {
  if (!STATE.isAdmin) return;
  _mjFilter = '';

  openModal('📊 Stats des PNJ', `
    <input id="mj-stats-search" class="input-field"
      placeholder="🔍 Rechercher par nom ou organisation…"
      data-input="_mjStatsFilter"
      style="font-size:.85rem;padding:.45rem .7rem;margin-bottom:.65rem">
    <div style="overflow-x:auto;margin:0 -.5rem">
      <table id="mj-stats-table" style="width:100%;border-collapse:collapse;font-size:.78rem">
        <thead>
          <tr style="border-bottom:1px solid var(--border);color:var(--text-muted)">
            <th style="text-align:left;padding:.4rem .35rem;font-weight:600">PNJ</th>
            ${NPC_VITALS.map(v =>
              `<th style="text-align:center;padding:.4rem .25rem;font-weight:600;width:42px"
                title="${v.label}">${v.icon}</th>`).join('')}
            ${NPC_STATS.map(s =>
              `<th style="text-align:center;padding:.4rem .2rem;font-weight:700;width:34px;
                font-size:.68rem;letter-spacing:.04em">${s.short}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${_renderMjStatsTbody()}</tbody>
      </table>
    </div>
    <div style="margin-top:.65rem;font-size:.7rem;color:var(--text-dim);font-style:italic;text-align:center">
      Clic sur n'importe quelle valeur pour la modifier (Entrée = valider, Échap = annuler) <br> • Clic sur le nom d'un PNJ pour ouvrir sa fiche
    </div>
  `, { subtitle: 'Édition rapide des caractéristiques', accent: '#4f8cff' });
}

function _restoreMjStatsModal() {
  const search = document.getElementById('mj-stats-search');
  if (search) search.value = _mjFilter;
  const tbody = document.querySelector('#mj-stats-table tbody');
  if (tbody) tbody.innerHTML = _renderMjStatsTbody();
}


function _mjOpenNpc(id) {
  closeModal();
  selectNpc(id);
}

function _mjEditField(id, field) {
  const cell = document.querySelector(`[data-mj-cell="${id}-${field}"]`);
  if (!cell) return;

  const isStat   = field.startsWith('stats.');
  const statKey  = isStat ? field.slice(6) : null;
  const renderInner = isStat ? _mjStatCellInner : _mjVitalCellInner;
  const prevHtml = cell.innerHTML;

  const npc  = _npcs.find(n => n.id === id);
  const prev = isStat ? (npc?.stats || {})[statKey] : npc?.[field];

  const input = document.createElement('input');
  input.type  = 'number';
  input.value = prev ?? '';
  input.style.cssText = 'width:42px;text-align:center;background:var(--bg-elevated);'
    + 'border:1px solid var(--gold);color:var(--text);border-radius:4px;'
    + 'padding:1px 3px;font-size:.85rem;outline:none';
  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();
  input.select();

  const setCellContent = (val) => {
    cell.innerHTML = renderInner(val);
    cell.style.color = val == null ? 'var(--text-dim)' : 'var(--text)';
  };

  let cancelled = false;
  const save = async () => {
    if (cancelled) return;
    cancelled = true;
    const raw = input.value.trim();
    const v   = raw === '' ? null : parseInt(raw, 10);
    const newVal = (raw === '' || !Number.isFinite(v)) ? null : v;
    try {
      await updateInCol('npcs', id, { [field]: newVal });
      const idx = _npcs.findIndex(n => n.id === id);
      if (idx >= 0) {
        if (isStat) {
          _npcs[idx] = {
            ..._npcs[idx],
            stats: { ...(_npcs[idx].stats || {}), [statKey]: newVal },
          };
        } else {
          _npcs[idx] = { ..._npcs[idx], [field]: newVal };
        }
      }
      setCellContent(newVal);
      if (_activeId === id) _refreshActivePanel();
    } catch (e) {
      console.error('[mj edit]', e);
      showNotif('Erreur de sauvegarde.', 'error');
      cell.innerHTML = prevHtml;
    }
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { cancelled = true; cell.innerHTML = prevHtml; input.blur(); }
  });
}

export async function deleteNpc(id) {
  try {
    if (!await confirmModal('Supprimer ce PNJ et toutes ses affinités ?', { title: 'Confirmation de suppression' })) return false;
    const snapshot = _npcs.find(n => n.id === id);
    if (!snapshot) return false;
    await deleteFromCol('npcs', id);
    const toDelete = _affiPerso.filter(a => a.npcId === id);
    await Promise.all(toDelete.map(a => deleteFromCol('npc_affinites', a.id)));
    _npcs      = _npcs.filter(n => n.id !== id);
    _affiPerso = _affiPerso.filter(a => a.npcId !== id);
    if (_activeId === id) _activeId = _npcs[0]?.id || null;
    _syncNpcRoute({ replace: true });
    showNotif('PNJ supprimé.', 'success', {
      duration: 7000,
      action: {
        label: '↶ Annuler',
        onClick: async () => {
          const npcData = { ...snapshot }; delete npcData.id;
          await saveDoc('npcs', id, npcData);
          await Promise.all(toDelete.map(async affinity => {
            const affinityData = { ...affinity }; delete affinityData.id;
            await saveDoc('npc_affinites', affinity.id, affinityData);
          }));
          if (!_npcs.some(n => n.id === snapshot.id)) _npcs.push(snapshot);
          toDelete.forEach(affinity => {
            if (!_affiPerso.some(item => item.id === affinity.id)) _affiPerso.push(affinity);
          });
          _activeId = id;
          _syncNpcRoute({ replace: true });
          _renderPage(document.getElementById('main-content'));
          showNotif('Suppression annulée.', 'success');
        },
      },
    });
    _renderPage(document.getElementById('main-content'));
    return true;
  } catch (e) { notifySaveError(e); return false; }
}


// ── Modal de configuration des seuils (mode valeur) ──────────────────────────
export function openAffiniteSeuilsModal() {
  if (!STATE.isAdmin) return;
  const s = _affiniteSeuils;
  const rows = SEUILS_KEYS.map((key, i) => {
    const a = AFFINITE[i];
    return `
      <div style="display:flex;align-items:center;gap:.6rem;padding:.4rem .55rem;
        background:${a.bg};border:1px solid ${a.border};border-radius:8px;margin-bottom:.4rem">
        <span style="font-size:1rem">${a.icon}</span>
        <span style="flex:1;font-size:.82rem;font-weight:600;color:${a.couleur}">${a.label}</span>
        <span style="font-size:.7rem;color:var(--text-dim)">à partir de</span>
        <input type="number" id="afs-${key}" class="input-field" value="${s[key] ?? SEUILS_DEFAULT[key]}"
          style="width:90px;text-align:center;font-weight:700">
      </div>`;
  }).join('');

  pushModal('⚙️ Seuils d\'affinité (mode valeur)', `
    <div style="font-size:.74rem;color:var(--text-dim);margin-bottom:.7rem;line-height:1.5">
      Chaque seuil = valeur minimale (incluse) pour atteindre ce niveau.<br>
      Les seuils s'appliquent à tous les PNJ en mode valeur.
    </div>
    ${rows}
    <div style="display:flex;gap:.5rem;margin-top:.85rem">
      <button class="btn btn-gold" style="flex:1" data-action="saveAffiniteSeuils">Enregistrer</button>
      <button class="btn btn-outline btn-sm" data-action="resetAffiniteSeuils">Valeurs par défaut</button>
      <button class="btn btn-outline btn-sm" data-action="close-modal">Annuler</button>
    </div>
  `);
}

export function resetAffiniteSeuils() {
  SEUILS_KEYS.forEach(k => {
    const el = document.getElementById(`afs-${k}`);
    if (el) el.value = SEUILS_DEFAULT[k];
  });
}

export async function saveAffiniteSeuils() {
  if (!STATE.isAdmin) return;
  const next = {};
  for (const k of SEUILS_KEYS) {
    const raw = document.getElementById(`afs-${k}`)?.value;
    const v   = parseInt(raw, 10);
    next[k] = Number.isFinite(v) ? v : SEUILS_DEFAULT[k];
  }
  // Cohérence : ordre croissant strict — sinon le mapping valeur→niveau devient ambigu.
  for (let i = 1; i < SEUILS_KEYS.length; i++) {
    if (next[SEUILS_KEYS[i]] <= next[SEUILS_KEYS[i - 1]]) {
      showNotif('Les seuils doivent être strictement croissants.', 'error');
      return;
    }
  }
  await saveDoc('npc_affinites', AFFINITE_SEUILS_DOC_ID, next);
  _affiniteSeuils = next;
  closeModal();
  showNotif('Seuils enregistrés !', 'success');
  _refreshActivePanel();
  _refreshList();
}

// ══ Gestionnaire des affinités spécifiques ════════════════════════════════════
// Formulaire inline — pas de push modal enfant

function _aftEmojiGrid(selectedEmoji) {
  return EMOJI_PRESET.map(emoji => `<button type="button" class="npc-rd-emoji-option${emoji === selectedEmoji ? ' is-on' : ''}" data-emoji="${emoji}" data-action="_aftSelectEmoji" data-val="${emoji}" aria-label="Choisir ${emoji}" aria-pressed="${emoji === selectedEmoji}">${emoji}</button>`).join('');
}

function _aftColorGrid(selectedColor) {
  return AFFINITE_TYPE_PALETTE.map(hex => `<button type="button" class="npc-rd-type-swatch${hex === selectedColor ? ' is-on' : ''}" style="--sw:${hex}" data-color="${hex}" data-action="_aftSelectColor" data-val="${hex}" aria-label="Couleur ${hex}" aria-pressed="${hex === selectedColor}"></button>`).join('');
}

function _aftNormalizeHex(raw = '') {
  const value = String(raw).trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) return `#${[...value.slice(1)].map(char => char + char).join('')}`.toLowerCase();
  return '';
}

function _getAffiniteTypesManagerHtml() {
  const s     = _aftFormState || { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
  const isEdit = !!s.editingId;
  const types = _affiniteTypeChoices();
  const typesList = types.map(type => {
    const usage = _affiPerso.filter(link => link.typeId === type.id).length;
    const builtin = type.id === DEFAULT_AFFINITE_TYPE.id;
    return `<div class="npc-rd-type-row${s.editingId === type.id ? ' is-editing' : ''}${builtin ? ' is-builtin' : ''}" style="--tc:${_esc(type.couleur || TYPE_COLORS[0])}" data-type-id="${_esc(type.id)}" data-sortable="${!builtin}">
      ${builtin ? '<span class="npc-rd-type-drag is-locked" title="Type système">••</span>' : '<span class="npc-rd-type-drag" title="Glisser pour réordonner" aria-label="Glisser pour réordonner">⠿</span>'}
      <span class="npc-rd-typechip">${_esc(type.emoji || '✨')} ${_esc(_displayText(type.label))}</span><small>${usage} lien${usage > 1 ? 's' : ''}${builtin ? ' · par défaut' : ''}</small><span class="npc-rd-type-row-actions">${builtin ? '' : `<button type="button" data-action="_aftEditType" data-id="${_esc(type.id)}" title="Modifier ${_esc(type.label)}" aria-label="Modifier ${_esc(type.label)}">${_npcUiIcon('edit')}</button><button type="button" class="is-danger" data-action="deleteAffiniteType" data-id="${_esc(type.id)}" title="Supprimer ${_esc(type.label)}" aria-label="Supprimer ${_esc(type.label)}">${_npcUiIcon('trash')}</button>`}</span></div>`;
  }).join('');
  return `<div class="npc-rd-types-modal">
    <p>La nature d’une exception : Mentor, Rival, Dette… Ces mêmes types sont proposés aux joueurs pour décrire leur ressenti, avec une étiquette libre possible.</p>
    <div class="npc-rd-type-list">${typesList}</div>
    <section class="npc-rd-type-form"><header><b>${isEdit ? 'Modifier le type' : 'Nouveau type'}</b>${isEdit ? `<span>${_esc(_displayText(_affiniteTypes.find(type => type.id === s.editingId)?.label || ''))}</span>` : ''}</header>
      <div class="npc-rd-type-form-row"><div class="npc-rd-type-emoji"><label><span>Emoji</span><input id="aft-emoji-val" value="${_esc(s.emoji)}" maxlength="4" aria-label="Emoji du type"></label><details><summary>Choisir</summary><div id="aft-emoji-grid">${_aftEmojiGrid(s.emoji)}</div></details></div><label><span>Nom</span><input id="aft-label" value="${_esc(s.label)}" placeholder="Protecteur, Rival, Dette…" autocomplete="off"></label></div>
      <div class="npc-rd-type-colors"><span>Couleur</span><span id="aft-color-grid">${_aftColorGrid(s.couleur)}</span><div class="npc-rd-custom-color"><label><span>Sélecteur</span><input type="color" id="aft-color-picker" value="${_esc(s.couleur)}" data-input="_aftColorPickerInput" aria-label="Choisir une couleur personnalisée"></label><label><span>Hexadécimal</span><input type="text" id="aft-color-hex" value="${_esc(s.couleur)}" maxlength="7" spellcheck="false" data-input="_aftColorHexInput" data-change="_aftColorHexCommit" placeholder="#4f8cff"></label></div></div>
      <input type="hidden" id="aft-color" value="${_esc(s.couleur)}"><input type="hidden" id="aft-editing-id" value="${_esc(s.editingId)}">
      <footer>${isEdit ? `<button type="button" class="npc-rd-type-cancel" data-action="_aftCancelEdit">Annuler</button>` : ''}<button type="button" class="npc-rd-type-save" data-action="saveAffiniteType">${isEdit ? 'Enregistrer' : 'Ajouter le type'}</button></footer>
    </section>
  </div>`;
}

function _destroyAffiniteTypesSortable() {
  try { _affiniteTypesSortable?.destroy?.(); } catch {}
  _affiniteTypesSortable = null;
}

async function _persistAffiniteTypesOrder(list) {
  if (!STATE.isAdmin || !list) return;
  const ids = [...list.querySelectorAll('.npc-rd-type-row[data-sortable="true"][data-type-id]')]
    .map(row => row.dataset.typeId)
    .filter(Boolean);
  const previousIds = _affiniteTypes.map(type => type.id);
  if (ids.length !== previousIds.length || ids.every((id, index) => id === previousIds[index])) return;

  const previous = _affiniteTypes.map(type => ({ ...type }));
  const byId = new Map(previous.map(type => [type.id, type]));
  const reordered = ids.map(id => byId.get(id)).filter(Boolean)
    .map((type, index) => ({ ...type, order: (index + 1) * 10 }));
  _affiniteTypes = reordered;
  try {
    await saveDoc('npc_affinites', AFFINITE_TYPES_DOC_ID, {
      types: reordered,
      defaultsVersion: AFFINITE_TYPES_DEFAULTS_VERSION,
    });
    showNotif('Ordre des types enregistré.', 'success');
  } catch (error) {
    _affiniteTypes = previous;
    notifySaveError(error);
  }
  _refreshAffiniteTypesManager();
  _refreshActivePanel();
}

function _mountAffiniteTypesSortable() {
  _destroyAffiniteTypesSortable();
  const list = document.querySelector('.npc-rd-types-modal .npc-rd-type-list');
  if (!STATE.isAdmin || !list || list.querySelectorAll('[data-sortable="true"]').length < 2) return;
  _affiniteTypesSortable = makeSortable(list, {
    prefix: 'npc-rd-type',
    draggable: '.npc-rd-type-row[data-sortable="true"]',
    handle: '.npc-rd-type-drag:not(.is-locked)',
    filter: 'button, input, select, textarea, .is-builtin',
    animation: 120,
    fallbackTolerance: 3,
    onStart: () => list.classList.add('is-sorting'),
    onEnd: () => {
      list.classList.remove('is-sorting');
      void _persistAffiniteTypesOrder(list);
    },
    onUnchoose: () => list.classList.remove('is-sorting'),
  });
}

function _scheduleAffiniteTypesSortable() {
  requestAnimationFrame(_mountAffiniteTypesSortable);
}

document.addEventListener('app:modal-closed', _destroyAffiniteTypesSortable);

export async function deleteHistoriqueEntry(npcId, index) {
  const n = _npcs.find(x => x.id === npcId);
  if (!n || !STATE.isAdmin) return;

  if (!await confirmModal('Supprimer cet événement de l\'historique ?', {title: 'Confirmation de suppression' })) return;

  const historique = [...(n.affinite?.historique || [])];
  const removed = historique[index];
  historique.splice(index, 1);

  // En mode valeur, on annule l'impact du delta supprimé sur la valeur cumulée.
  const affinite = _withValeurDelta(n, { ...(n.affinite || {}), historique }, -(removed?.delta || 0));
  await _persistAffinite(npcId, affinite, 'Événement supprimé.', { close: false });
}

// Modifier / Supprimer les entrées des historiques des NPCS
export function editHistoriqueEntry(npcId, index) {
  const n = _npcs.find(x => x.id === npcId);
  if (!n || !STATE.isAdmin) return;

  const historique = n.affinite?.historique || [];
  const entry = historique[index];
  if (!entry) return;

  openModal(`✏️ Modifier l'événement — ${_esc(n.nom)}`, `
    <div class="form-group">
      <label>Texte</label>
      <textarea class="input-field" id="hist-edit-text" rows="3"
        placeholder="Décris l’événement...">${_esc(entry.texte || '')}</textarea>
    </div>

    <div class="form-group">
      <label>Impact</label>
      <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
        <div style="display:flex;gap:.35rem">
          ${_deltaPresetsHtml('hist-edit-delta', entry.delta || 0, '_selectHistEditDelta', { size: 36 })}
        </div>
        <input type="number" id="hist-edit-delta-custom"
          value="${_DELTA_PRESETS.includes(entry.delta || 0) ? '' : (entry.delta || 0)}"
          placeholder="±N"
          data-input="_setHistEditDeltaFromInput"
          style="width:64px;text-align:center;font-weight:700;padding:.4rem;
          background:var(--bg-elevated);border:1px solid var(--border);
          border-radius:8px;color:var(--text);font-size:.8rem">
      </div>
    </div>

    <div style="display:flex;gap:.5rem;margin-top:.75rem">
      <button class="btn btn-gold" style="flex:1"
        data-action="saveHistoriqueEntry" data-npc-id="${npcId}" data-idx="${index}">Enregistrer</button>
      <button class="btn btn-outline btn-sm" data-action="close-modal">Annuler</button>
    </div>
  `);

  _histEditDelta = entry.delta || 0;
}

function _selectHistEditDelta(v) {
  _histEditDelta = v;
  _highlightDeltaPreset('hist-edit-delta', v);
  const inp = document.getElementById('hist-edit-delta-custom');
  if (inp) inp.value = '';
}

function _setHistEditDeltaFromInput(raw) {
  const v = parseInt(raw, 10);
  _histEditDelta = Number.isFinite(v) ? v : 0;
  _highlightDeltaPreset('hist-edit-delta', _histEditDelta);
}

export async function saveHistoriqueEntry(npcId, index) {
  const n = _npcs.find(x => x.id === npcId);
  if (!n || !STATE.isAdmin) return;

  const texte = document.getElementById('hist-edit-text')?.value?.trim() || '';
  if (!texte) {
    showNotif('Le texte de l’événement est requis.', 'error');
    return;
  }

  const historique = [...(n.affinite?.historique || [])];
  if (!historique[index]) return;

  const oldDelta = historique[index].delta || 0;
  const newDelta = _histEditDelta || 0;

  historique[index] = {
    ...historique[index],
    texte,
    delta: newDelta,
  };

  // En mode valeur, on rejoue la différence de delta sur la valeur cumulée.
  const affinite = _withValeurDelta(n, { ...(n.affinite || {}), historique }, newDelta - oldDelta);
  await _persistAffinite(npcId, affinite, 'Événement modifié.');
}

// Affinités spéciales
export function openAffiniteTypesManager() {
  _aftFormState = { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
  openModal('Types de relation', _getAffiniteTypesManagerHtml());
  _scheduleAffiniteTypesSortable();
}

function _refreshAffiniteTypesManager() {
  _destroyAffiniteTypesSortable();
  updateModalContent('Types de relation', _getAffiniteTypesManagerHtml());
  _scheduleAffiniteTypesSortable();
}

function _aftSelectEmoji(emoji) {
  const inp = document.getElementById('aft-emoji-val');
  if (inp) inp.value = emoji;
  if (_aftFormState) _aftFormState.emoji = emoji;
  document.querySelectorAll('#aft-emoji-grid button').forEach(btn => {
    const sel = btn.dataset.emoji === emoji;
    btn.classList.toggle('is-on', sel);
    btn.setAttribute('aria-pressed', String(sel));
  });
}

function _aftApplyColor(hex) {
  const normalized = _aftNormalizeHex(hex);
  if (!normalized) return false;
  const inp = document.getElementById('aft-color');
  const picker = document.getElementById('aft-color-picker');
  const text = document.getElementById('aft-color-hex');
  if (inp) inp.value = normalized;
  if (picker) picker.value = normalized;
  if (text && document.activeElement !== text) text.value = normalized;
  if (_aftFormState) _aftFormState.couleur = normalized;
  document.querySelectorAll('#aft-color-grid button').forEach(btn => {
    const sel = btn.dataset.color?.toLowerCase() === normalized;
    btn.classList.toggle('is-on', sel);
    btn.setAttribute('aria-pressed', String(sel));
  });
  return true;
}

function _aftSelectColor(hex) { _aftApplyColor(hex); }
function _aftColorPickerInput(el) { _aftApplyColor(el?.value); }
function _aftColorHexInput(el) { if (_aftNormalizeHex(el?.value)) _aftApplyColor(el.value); }
function _aftColorHexCommit(el) {
  const normalized = _aftNormalizeHex(el?.value);
  if (!normalized) {
    showNotif('Utilise une couleur hexadécimale comme #4f8cff.', 'error');
    if (el) el.value = document.getElementById('aft-color')?.value || TYPE_COLORS[0];
    return;
  }
  _aftApplyColor(normalized);
  if (el) el.value = normalized;
}

function _aftEditType(typeId) {
  const t = _affiniteTypes.find(x => x.id === typeId);
  if (!t) return;
  _aftFormState = {
    editingId: typeId,
    emoji:     t.emoji   || EMOJI_PRESET[0],
    couleur:   t.couleur || TYPE_COLORS[0],
    label:     t.label   || '',
  };
  _refreshAffiniteTypesManager();
}

function _aftCancelEdit() {
  _aftFormState = { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
  _refreshAffiniteTypesManager();
}

export async function saveAffiniteType() {
  const label     = document.getElementById('aft-label')?.value?.trim();
  const emoji     = document.getElementById('aft-emoji-val')?.value || EMOJI_PRESET[0];
  const couleur   = _aftNormalizeHex(document.getElementById('aft-color-hex')?.value || document.getElementById('aft-color')?.value) || '';
  const editingId = document.getElementById('aft-editing-id')?.value || '';

  if (!label) { showNotif('Donne un nom au type.', 'error'); return; }
  if (!couleur) { showNotif('La couleur hexadécimale est invalide.', 'error'); return; }
  if (_affiniteTypeChoices().some(type => type.id !== editingId && _norm(type.label) === _norm(label))) {
    showNotif('Un type porte déjà ce nom.', 'error');
    return;
  }
  const nextTypes = _affiniteTypes.map(type => ({ ...type }));
  if (editingId) {
    const idx = nextTypes.findIndex(t => t.id === editingId);
    if (idx >= 0) nextTypes[idx] = { ...nextTypes[idx], label, emoji, couleur };
  } else {
    const id = `aft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const lastOrder = nextTypes.reduce((max, type) => Math.max(max, Number(type?.order) || 0), 0);
    nextTypes.push({ id, label, emoji, couleur, order: lastOrder + 10 });
  }
  const sortedTypes = _sortAffiniteTypes(nextTypes);
  try {
    await saveDoc('npc_affinites', AFFINITE_TYPES_DOC_ID, {
      types: sortedTypes,
      defaultsVersion: AFFINITE_TYPES_DEFAULTS_VERSION,
    });
  } catch (error) {
    notifySaveError(error);
    return;
  }
  _affiniteTypes = sortedTypes;
  _aftFormState = { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
  showNotif(editingId ? 'Type modifié !' : 'Type créé !', 'success');
  _refreshAffiniteTypesManager();
  _refreshActivePanel();
}

export async function deleteAffiniteType(typeId) {
  const type = _affiniteTypes.find(item => item.id === typeId);
  if (!type) return;
  const affected = _affiPerso.filter(link => link.typeId === typeId).map(link => ({ ...link }));
  if (!await confirmModal(`Supprimer « ${type.label} » ?${affected.length ? ` Le type sera retiré de ${affected.length} lien${affected.length > 1 ? 's' : ''}.` : ''}`, { title: 'Supprimer le type de relation' })) return;
  const previousTypes = _affiniteTypes.map(item => ({ ...item }));
  const nextTypes = _affiniteTypes.filter(item => item.id !== typeId);
  const updates = [
    { col: 'npc_affinites', id: AFFINITE_TYPES_DOC_ID, data: {
      types: nextTypes,
      defaultsVersion: AFFINITE_TYPES_DEFAULTS_VERSION,
    } },
    ...affected.map(link => ({ col: 'npc_affinites', id: link.id, data: { typeId: '', typeLabel: '' } })),
  ];
  try {
    await batchSaveInCol(updates);
  } catch (error) {
    notifySaveError(error);
    return;
  }
  _affiniteTypes = nextTypes;
  _affiPerso = _affiPerso.map(link => link.typeId === typeId ? { ...link, typeId: '', typeLabel: '' } : link);
  if (_aftFormState?.editingId === typeId) {
    _aftFormState = { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
  }
  showNotif(`Type « ${type.label} » supprimé.`, 'success', {
    duration: 7000,
    action: {
      label: '↶ Annuler',
      onClick: async () => {
        try {
          await batchSaveInCol([
            { col: 'npc_affinites', id: AFFINITE_TYPES_DOC_ID, data: {
              types: previousTypes,
              defaultsVersion: AFFINITE_TYPES_DEFAULTS_VERSION,
            } },
            ...affected.map(link => { const { id, ...data } = link; return { col: 'npc_affinites', id, data }; }),
          ]);
          _affiniteTypes = previousTypes;
          const restored = new Map(affected.map(link => [link.id, link]));
          _affiPerso = _affiPerso.map(link => restored.get(link.id) || link);
          _refreshAffiniteTypesManager();
          _refreshActivePanel();
          showNotif('Suppression annulée.', 'success');
        } catch (error) { notifySaveError(error); }
      },
    },
  });
  _refreshAffiniteTypesManager();
  _refreshActivePanel();
}

// ══ Modal affinité individuelle (édition) ════════════════════════════════════




// ── Édition inline depuis la fiche (admin) ───────────────────────────────────
// Sauvegarde directe Firestore champ par champ (déclenchée par l'event `change`,
// càd au blur / Entrée). Gère les champs simples, numériques, stats imbriquées.
async function _npcInlineSave(el) {
  if (!STATE.isAdmin || !el) return;
  const id = el.dataset.npcId, field = el.dataset.field;
  const n = _npcs.find(x => x.id === id);
  if (!n || !field) return;

  const NUM_FIELDS = ['pv', 'pm', 'pvBase', 'pmBase', 'niveau', 'ca', 'vitesse', 'salaireSuggere'];
  const toNum = (raw) => {
    const t = (raw ?? '').toString().trim();
    if (t === '') return null;
    const v = parseInt(t, 10);
    return Number.isFinite(v) ? v : null;
  };

  let patch;
  if (field.startsWith('statBase:')) {
    const key = field.slice(9);
    const stats = { ...(n.stats || {}) };
    const levelUp = Math.max(0, parseInt(n.statsLevelUps?.[key], 10) || 0);
    const v = toNum(el.value);
    if (v == null) delete stats[key]; else stats[key] = v + levelUp;
    n.stats = stats; patch = { stats };
  } else if (field.startsWith('stat:')) {
    const key = field.slice(5);
    const stats = { ...(n.stats || {}) };
    const v = toNum(el.value);
    if (v == null) delete stats[key]; else stats[key] = v;
    n.stats = stats; patch = { stats };
  } else if (field === 'affinite.note') {
    const affinite = { ...(n.affinite || {}), note: (el.value || '').trim() };
    n.affinite = affinite; patch = { affinite };
  } else if (NUM_FIELDS.includes(field)) {
    const v = toNum(el.value);
    const safe = field === 'niveau' ? Math.max(1, v || 1) : v;
    n[field] = safe; patch = { [field]: safe };
  } else {
    const v = (el.value || '').trim();
    n[field] = v; patch = { [field]: v };
  }

  const saved = await trySave('npcs', id, patch);
  if (saved) {
    _npcFlashSaved();
    _refreshActivePanel();
    if (['nom', 'role', 'lieu'].includes(field)) _refreshList({ keepScroll: true });
  }
}

function _npcPreviewDerived(el) {
  const n = _npcs.find(item => item.id === el?.dataset?.npcId);
  const field = el?.dataset?.field;
  if (!n || !['niveau', 'pvBase', 'pmBase'].includes(field)) return;
  const value = parseInt(el.value, 10);
  const preview = { ...n, [field]: Number.isFinite(value) ? value : (field === 'niveau' ? 1 : 0) };
  const { totals } = _npcVitalTotals(preview);
  const scope = el.closest('.npc-character-stats');
  Object.entries(totals).forEach(([key, total]) => {
    const target = scope?.querySelector(`[data-npc-derived="${key}"]`);
    if (target) target.textContent = total;
  });
}

async function _npcAllocateStat(btn) {
  if (!STATE.isAdmin) return;
  const n = _npcs.find(item => item.id === btn?.dataset?.npcId);
  const key = btn?.dataset?.stat;
  const delta = parseInt(btn?.dataset?.delta, 10) || 0;
  if (!n || !NPC_STATS.some(stat => stat.key === key) || !delta) return;
  const level = Math.max(1, parseInt(n.niveau, 10) || 1);
  const levelUps = { ...(n.statsLevelUps || {}) };
  const current = Math.max(0, parseInt(levelUps[key], 10) || 0);
  const spent = NPC_STATS.reduce((sum, stat) => sum + (parseInt(levelUps[stat.key], 10) || 0), 0);
  if (delta > 0 && spent >= level - 1) return;
  if (delta < 0 && current <= 0) return;
  const stats = { ..._npcBaseStats(n), [key]: (_npcBaseStats(n)[key] || 10) + delta };
  levelUps[key] = Math.max(0, current + delta);
  n.stats = stats;
  n.statsLevelUps = levelUps;
  if (await trySave('npcs', n.id, { stats, statsLevelUps: levelUps })) _refreshActivePanel();
}

// Stepper « Valeur actuelle » PV/PM du PNJ (comme la fiche perso). Le courant est
// borné à [0, max calculé] ; par défaut (jamais touché) il vaut le max.
async function _npcAdjustVital(btn) {
  if (!STATE.isAdmin) return;
  const id = btn?.dataset?.id, field = btn?.dataset?.field;
  const delta = parseInt(btn?.dataset?.delta, 10) || 0;
  const n = _npcs.find(x => x.id === id);
  if (!n || !delta || !['pvActuel', 'pmActuel'].includes(field)) return;
  const { totals } = _npcVitalTotals(n);
  const max = field === 'pvActuel' ? totals.pv : totals.pm;
  const cur = Number.isFinite(n[field]) ? Math.max(0, Math.min(n[field], max)) : max;
  const next = Math.max(0, Math.min(max, cur + delta));
  if (next === cur) return;
  n[field] = next;
  if (await trySave('npcs', id, { [field]: next })) _refreshActivePanel();
}

// Posture du PNJ envers le groupe : clic sur un segment de l'échelle (mode groupe).
async function _npcSetAffiniteNiveau(btn) {
  if (!STATE.isAdmin) return;
  const id = btn?.dataset?.id;
  const k = Math.max(0, Math.min(4, parseInt(btn?.dataset?.niveau, 10)));
  const n = _npcs.find(x => x.id === id);
  if (!n || !Number.isFinite(k)) return;
  if (_affiniteMode(n) === 'valeur') return;   // en mode valeur, l'échelle est dérivée (chronologie)
  const affinite = { ...(n.affinite || {}), mode: 'groupe', niveau: k };
  n.affinite = affinite;
  if (await trySave('npcs', id, { affinite })) {
    _npcFlashSaved();
    _refreshActivePanel();
    _refreshList({ keepScroll: true });
  }
}

// Niveau du PNJ : badge « Niv. N » propre → clic = édition inline (input) qui
// réutilise le save/preview standard, puis re-render de la fiche.
function _npcEditLevel(btn) {
  if (!STATE.isAdmin) return;
  const badge = btn?.closest('.id-lvl-badge');
  const n = _npcs.find(x => x.id === btn?.dataset?.id);
  if (!badge || !n) return;
  const cur = Math.max(1, parseInt(n.niveau, 10) || 1);
  badge.innerHTML = `Niv. <input class="npc-inline npc-lvl-inp" type="number" min="1" max="99" value="${cur}"
    data-input="npcPreviewDerived" data-change="npcInlineSave" data-npc-id="${_esc(n.id)}" data-field="niveau">`;
  const inp = badge.querySelector('input');
  inp?.focus(); inp?.select();
}

// Galerie de portraits PNJ. Les anciennes fiches ne possèdent que imageUrl /
// imageFull : elles sont exposées comme une première entrée « legacy » puis
// migrées naturellement lors du premier ajout ou de la première suppression.
function _npcPortraitEntries(n = {}) {
  const portraits = (Array.isArray(n.portraits) ? n.portraits : [])
    .filter(item => item?.imageUrl)
    .map((item, index) => ({
      id: String(item.id || `portrait_${index + 1}`),
      imageUrl: String(item.imageUrl || ''),
      imageFull: String(item.imageFull || item.imageUrl || ''),
    }));
  if (n.imageUrl && !portraits.some(item => item.imageUrl === n.imageUrl)) {
    portraits.unshift({ id: 'legacy', imageUrl: n.imageUrl, imageFull: n.imageFull || n.imageUrl });
  }
  return portraits.slice(0, NPC_MAX_PORTRAITS);
}

function _npcActivePortrait(n = {}) {
  const portraits = _npcPortraitEntries(n);
  return portraits.find(item => item.id === n.activePortraitId)
    || portraits.find(item => item.imageUrl === n.imageUrl)
    || portraits[0]
    || null;
}

async function _npcCompactPortrait(portrait) {
  let imageUrl = portrait.imageUrl || '';
  let imageFull = portrait.imageFull || imageUrl;
  if (imageUrl.startsWith('data:image/') && imageUrl.length > NPC_PORTRAIT_BYTES) {
    imageUrl = await compressDataUrl(imageUrl, {
      max: 320, quality: 0.78, maxBytes: NPC_PORTRAIT_BYTES, minSide: 220,
    }) || imageUrl;
  }
  if (imageFull.startsWith('data:image/') && imageFull.length > NPC_PORTRAIT_FULL_BYTES) {
    imageFull = await compressDataUrl(imageFull, {
      max: 960, quality: 0.72, maxBytes: NPC_PORTRAIT_FULL_BYTES, minSide: 320,
    }) || imageUrl;
  }
  if (imageFull.length > NPC_PORTRAIT_FULL_BYTES * 1.15) imageFull = imageUrl;
  return { ...portrait, imageUrl, imageFull };
}

const _npcPortraitModalTitle = (n = {}) => `Portraits de ${n.nom || 'ce PNJ'}`;

function _npcPortraitManagerHtml(n) {
  const portraits = _npcPortraitEntries(n);
  const active = _npcActivePortrait(n);
  const cards = portraits.map((portrait, index) => {
    const selected = portrait.id === active?.id;
    return `<article class="npc-rd-portrait-card${selected ? ' is-active' : ''}">
      <button type="button" class="npc-rd-portrait-choice" data-action="npcSelectPortrait" data-id="${_esc(n.id)}" data-portrait-id="${_esc(portrait.id)}" aria-pressed="${selected}" title="${selected ? 'Portrait actuellement utilisé' : 'Utiliser ce portrait'}">
        <img src="${_esc(portrait.imageUrl)}" alt="Portrait ${index + 1} de ${_esc(n.nom || 'ce PNJ')}">
        <span>${selected ? 'Actif · VTT' : `Portrait ${index + 1}`}</span>
      </button>
      <button type="button" class="npc-rd-portrait-remove" data-action="npcDeletePortrait" data-id="${_esc(n.id)}" data-portrait-id="${_esc(portrait.id)}" title="Supprimer ce portrait" aria-label="Supprimer le portrait ${index + 1}">${_npcUiIcon('trash')}</button>
    </article>`;
  }).join('');
  const canAdd = portraits.length < NPC_MAX_PORTRAITS;
  return `<div class="npc-rd-portrait-manager">
    <p>Le portrait actif est utilisé sur la fiche, dans le chat et sur le token du VTT. Le changement est immédiat pour tous les joueurs.</p>
    <div class="npc-rd-portrait-gallery">${cards || '<div class="npc-rd-portrait-empty">Aucun portrait enregistré.</div>'}
      ${canAdd ? `<button type="button" class="npc-rd-portrait-add" data-action="npcAddPortrait" data-id="${_esc(n.id)}"><b>＋</b><span>Ajouter un portrait</span><small>${portraits.length}/${NPC_MAX_PORTRAITS}</small></button>` : ''}
    </div>
    ${canAdd ? '' : `<small class="npc-rd-portrait-limit">Limite de ${NPC_MAX_PORTRAITS} portraits atteinte. Supprime une image pour en ajouter une autre.</small>`}
  </div>`;
}

function _npcRefreshPortraitManager(n) {
  updateModalContent(_npcPortraitModalTitle(n), _npcPortraitManagerHtml(n), { icon: '◉', subtitle: 'Galerie et portrait actif' });
}

// Clic sur le bouton appareil photo → gestionnaire de galerie. L'ajout passe
// ensuite par le cropper pan/zoom commun au reste de l'application.
let _npcPhotoCrop = null;
let _npcPhotoSrc = null; // image originale (avant cadrage) → stockée en imageFull
function _npcSetPhoto(btn) {
  if (!STATE.isAdmin) return;
  const n = _npcs.find(item => item.id === btn?.dataset?.id);
  if (!n) return;
  openModal(_npcPortraitModalTitle(n), _npcPortraitManagerHtml(n), { icon: '◉', subtitle: 'Galerie et portrait actif' });
}

function _npcAddPortrait(btn) {
  if (!STATE.isAdmin) return;
  const n = _npcs.find(item => item.id === btn?.dataset?.id);
  if (!n) return;
  if (_npcPortraitEntries(n).length >= NPC_MAX_PORTRAITS) {
    showNotif(`Un PNJ peut conserver jusqu’à ${NPC_MAX_PORTRAITS} portraits.`, 'error');
    return;
  }
  pickImageFile({ onImage: ({ dataUrl }) => _npcShowCropModal(dataUrl, n.id) });
}

function _npcShowCropModal(dataUrl, id) {
  _npcPhotoSrc = dataUrl;
  pushModal('Cadrer le portrait', `
    ${panZoomCropHTML({ idPrefix: 'npc-crop', viewSize: 300 })}
    <div style="display:flex;gap:.6rem;justify-content:flex-end;width:300px;margin:.8rem auto 0">
      <button class="btn btn-outline" id="npc-photo-cancel">Annuler</button>
      <button class="btn btn-gold" id="npc-photo-save">Ajouter le portrait</button>
    </div>`, null, { icon: '◉', subtitle: 'Déplacer et zoomer dans le cadre', onDismiss: () => {
      _npcPhotoCrop?.destroy?.(); _npcPhotoCrop = null; _npcPhotoSrc = null;
    }});
  requestAnimationFrame(() => {
    _npcPhotoCrop?.destroy?.();
    _npcPhotoCrop = attachPanZoomCrop({ idPrefix: 'npc-crop', dataUrl, viewSize: 300, outputSize: 300 });
    document.getElementById('npc-photo-cancel')?.addEventListener('click', () => {
      popModal();
    }, { once: true });
    document.getElementById('npc-photo-save')?.addEventListener('click', () => _npcSaveCroppedPhoto(id));
  });
}

async function _npcSaveCroppedPhoto(id) {
  const rawCrop = _npcPhotoCrop?.getBase64();
  const n = _npcs.find(x => x.id === id);
  if (!rawCrop || !n) { showNotif('Erreur : cadrage non initialisé.', 'error'); return; }

  const imageUrl = await compressDataUrl(rawCrop, {
    max: 320, quality: 0.78, maxBytes: NPC_PORTRAIT_BYTES, minSide: 220,
  });
  let imageFull = _npcPhotoSrc ? await compressDataUrl(_npcPhotoSrc, {
    max: 960, quality: 0.72, maxBytes: NPC_PORTRAIT_FULL_BYTES, minSide: 320,
  }) : '';
  if (!imageUrl) { showNotif('Cette image ne peut pas être compressée.', 'error'); return; }
  if (!imageFull || imageFull.length > NPC_PORTRAIT_FULL_BYTES * 1.15) imageFull = imageUrl;

  const portraits = await Promise.all(_npcPortraitEntries(n).map(_npcCompactPortrait));
  if (portraits.length >= NPC_MAX_PORTRAITS) {
    showNotif(`La limite de ${NPC_MAX_PORTRAITS} portraits est atteinte.`, 'error');
    return;
  }
  const portrait = {
    id: `portrait_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    imageUrl,
    imageFull,
  };
  const nextPortraits = [...portraits, portrait];
  const patch = { portraits: nextPortraits, activePortraitId: portrait.id, imageUrl, imageFull };
  if (await trySave('npcs', id, patch)) {
    Object.assign(n, patch);
    _npcPhotoCrop?.destroy?.(); _npcPhotoCrop = null; _npcPhotoSrc = null;
    popModal();
    _npcRefreshPortraitManager(n);
    showNotif('Portrait ajouté et sélectionné.', 'success');
    _refreshActivePanel(); _refreshList();
  }
}

async function _npcSelectPortrait(btn) {
  if (!STATE.isAdmin) return;
  const n = _npcs.find(item => item.id === btn?.dataset?.id);
  const portrait = _npcPortraitEntries(n).find(item => item.id === btn?.dataset?.portraitId);
  if (!n || !portrait || _npcActivePortrait(n)?.id === portrait.id) return;
  const patch = {
    activePortraitId: portrait.id,
    imageUrl: portrait.imageUrl,
    imageFull: portrait.imageFull || portrait.imageUrl,
  };
  if (!await trySave('npcs', n.id, patch)) return;
  Object.assign(n, patch);
  _npcRefreshPortraitManager(n);
  _refreshActivePanel(); _refreshList();
  showNotif('Portrait actif mis à jour sur la fiche et le VTT.', 'success');
}

async function _npcDeletePortrait(btn) {
  if (!STATE.isAdmin) return;
  const n = _npcs.find(item => item.id === btn?.dataset?.id);
  if (!n) return;
  const portraits = _npcPortraitEntries(n);
  const removed = portraits.find(item => item.id === btn?.dataset?.portraitId);
  if (!removed || !await confirmModal('Supprimer définitivement ce portrait ?', { title: 'Supprimer le portrait' })) return;
  const nextPortraits = portraits.filter(item => item.id !== removed.id);
  const current = _npcActivePortrait(n);
  const nextActive = current?.id === removed.id ? (nextPortraits[0] || null) : current;
  const patch = {
    portraits: nextPortraits,
    activePortraitId: nextActive?.id || '',
    imageUrl: nextActive?.imageUrl || '',
    imageFull: nextActive?.imageFull || nextActive?.imageUrl || '',
  };
  if (!await trySave('npcs', n.id, patch)) return;
  Object.assign(n, patch);
  _npcRefreshPortraitManager(n);
  _refreshActivePanel(); _refreshList();
  showNotif('Portrait supprimé.', 'success');
}

// Lightbox : affiche l'image pleine (non cadrée) du PNJ — accessible à TOUS
// (joueurs compris). Fallback sur le portrait cadré pour les anciens PNJ sans
// imageFull. Clic n'importe où ou Échap pour fermer.
function _npcViewPhoto(btn) {
  const n = _npcs.find(x => x.id === btn.dataset.id); if (!n) return;
  const src = n.imageFull || n.imageUrl; if (!src) return;
  document.getElementById('npc-img-lightbox')?.remove();
  const ov = document.createElement('div');
  ov.id = 'npc-img-lightbox';
  ov.className = 'npc-img-lightbox';
  ov.innerHTML = `<img src="${src}" alt="${_esc(n.nom || '')}"><button class="npc-img-lightbox-close" title="Fermer (Échap)">✕</button>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
}

// Organisations en texte libre séparé par des virgules → tableau.
async function _npcSaveOrgs(el) {
  if (!STATE.isAdmin) return;
  const n = _npcs.find(x => x.id === el.dataset.npcId); if (!n) return;
  const orgs = (el.value || '').split(',').map(s => s.trim()).filter(Boolean);
  n.organisations = orgs;
  await trySave('npcs', el.dataset.npcId, { organisations: orgs });
}

// Toggle d'une activité bastion (pastille cliquable).
async function _npcToggleActivite(btn) {
  if (!STATE.isAdmin) return;
  const id = btn.dataset.id, slug = btn.dataset.slug;
  const n = _npcs.find(x => x.id === id); if (!n) return;
  const set = new Set(n.activites || []);
  set.has(slug) ? set.delete(slug) : set.add(slug);
  const activites = [...set];
  n.activites = activites;
  btn.classList.toggle('is-on');
  await trySave('npcs', id, { activites });
}

// Toggle visibilité joueurs du profil bastion.
async function _npcToggleEmbauchable(btn) {
  if (!STATE.isAdmin) return;
  const id = btn.dataset.id;
  const n = _npcs.find(x => x.id === id); if (!n) return;
  const current = n.embauchable !== false;   // défaut = visible (true)
  n.embauchable = !current;
  if (await trySave('npcs', id, { embauchable: n.embauchable })) {
    _npcFlashSaved();
    _refreshActivePanel();
    _refreshList({ keepScroll: true });
  }
}

// Toggle : ce PNJ peut-il être recruté au Bastion ? (défaut = oui)
async function _npcToggleRecrutable(btn) {
  if (!STATE.isAdmin) return;
  const id = btn.dataset.id;
  const n = _npcs.find(x => x.id === id); if (!n) return;
  n.recrutable = !(n.recrutable !== false);
  await trySave('npcs', id, { recrutable: n.recrutable });
  _refreshActivePanel();
}

// Sélection d'arme (boutique) en inline.
async function _npcSetWeapon(el) {
  if (!STATE.isAdmin) return;
  const id = el.dataset.npcId;
  const n = _npcs.find(x => x.id === id); if (!n) return;
  const w = el.value ? _shopWeapons.find(x => x.id === el.value) : null;
  const weapon = w ? _serializeShopWeapon(w) : null;
  const combat = weapon ? { weapon, weaponName: weapon.nom || '', damage: weapon.degats || '', range: null } : null;
  n.combat = combat;
  await trySave('npcs', id, { combat });
  _refreshActivePanel();
}

// Ajout d'un événement d'affinité directement depuis la fiche (sans modal).
// Réplique la logique de l'ancien saveAffiniteGroupe : cumul en mode 'valeur',
// niveau dérivé des seuils, entrée datée dans l'historique.
async function _npcAddEvent(btn) {
  if (!STATE.isAdmin) return;
  const id = btn.dataset.id;
  const n = _npcs.find(x => x.id === id); if (!n) return;
  const dEl = document.getElementById(`afg-d-${id}`);
  const eEl = document.getElementById(`afg-e-${id}`);
  const delta = parseInt(dEl?.value, 10) || 0;
  const texte = (eEl?.value || '').trim();
  if (delta === 0 && !texte) { showNotif('Indique une variation et/ou un intitulé.', 'error'); return; }
  if (delta !== 0 && !texte) { showNotif('Ajoute un intitulé pour conserver la variation.', 'error'); return; }

  const curHisto = n.affinite?.historique || [];
  const newHisto = [...curHisto, { date: new Date().toLocaleDateString('fr-FR'), texte, delta }];
  let affinite;
  if (delta !== 0 || _affiniteMode(n) === 'valeur') {
    const valeur = (Number(n.affinite?.valeur) || 0) + delta;
    affinite = { ...(n.affinite || {}), mode: 'valeur', valeur, niveau: _niveauFromValeur(valeur), historique: newHisto };
  } else {
    affinite = { ...(n.affinite || {}), historique: newHisto };
  }
  n.affinite = affinite;
  await _persistAffinite(id, affinite, 'Événement ajouté !', { close: false });
}

// Édition inline d'une affinité spécifique existante (type / notes).
async function _npcAffiField(el) {
  if (!STATE.isAdmin) return;
  const a = _affiPerso.find(x => x.id === el.dataset.affId); if (!a) return;
  const field = el.dataset.field;
  const patch = {};
  if (field === 'typeId') {
    const type = _getAffiniteType(el.value);
    patch.typeId = el.value; patch.typeLabel = type?.label || '';
  } else {
    patch[field] = (el.value || '').trim();
  }
  const previous = { ...a };
  Object.assign(a, patch);
  _refreshNpcAffiUi({ summary: true, npcId: a.npcId, charId: a.charId });
  if (!await trySave('npc_affinites', a.id, patch)) {
    Object.assign(a, previous);
    _refreshNpcAffiUi({ summary: true, npcId: a.npcId, charId: a.charId });
  }
}

// Ajout inline d'une affinité spécifique (personnage + type) — sans modal.
function _npcLinkableCharacters() {
  const byId = new Map();
  // Le cache propre à la page est chargé dans _load(). STATE.characters reste
  // prioritaire lorsqu'il est disponible, car il porte les mutations locales
  // les plus récentes. Aucun accès Firestore supplémentaire n'est déclenché ici.
  for (const character of _relationCharacters || []) {
    if (character?.id) byId.set(character.id, character);
  }
  for (const character of STATE.characters || []) {
    if (character?.id) byId.set(character.id, character);
  }
  return sortCharactersForDisplay([...byId.values()]);
}

const _npcLinkCharacter = (charId) => _npcLinkableCharacters().find(c => c.id === charId) || null;

async function _npcAddAffiPerso(btn) {
  if (!STATE.isAdmin) return;
  const npcId = btn.dataset.npcId;
  const charSel = document.getElementById(`afp-char-${npcId}`)?.value;
  const typeId  = document.getElementById(`afp-type-${npcId}`)?.value;
  if (!charSel) { showNotif('Choisis un personnage.', 'error'); return; }
  if (!typeId)  { showNotif('Choisis un type d\'affinité.', 'error'); return; }
  const [charId, charNom] = charSel.split('|');
  const char = _npcLinkCharacter(charId);
  const type = _getAffiniteType(typeId);
  const data = {
    npcId,
    charId,
    charNom,
    charPhoto: _charPortraitSrc(char),
    typeId,
    typeLabel: type?.label || '',
    note: '',
    notePublique: '',
  };
  try {
    const newId = await addToCol('npc_affinites', data);
    const entry = { id: newId || `afp_${Date.now()}`, ...data };
    if (!_affiPerso.find(x => x.id === entry.id)) _affiPerso.push(entry);
    _refreshNpcAffiUi({ list: true });
  } catch (e) { notifySaveError(e); }
}

// ── Flux « Lier un personnage » : modal en 2 étapes (personnage + relation) ───
async function _npcCreateLink(npcId, charId, charNom, typeId) {
  const char = _npcLinkCharacter(charId);
  const type = _getAffiniteType(typeId);
  const data = {
    npcId, charId, charNom, charPhoto: _charPortraitSrc(char),
    typeId, typeLabel: type?.label || '', note: '', notePublique: '',
  };
  try {
    const newId = await addToCol('npc_affinites', data);
    const entry = { id: newId || `afp_${Date.now()}`, ...data };
    if (!_affiPerso.find(x => x.id === entry.id)) _affiPerso.push(entry);
    _refreshNpcAffiUi({ list: true });
    return true;
  } catch (e) { notifySaveError(e); return false; }
}

function _npcOpenLinkModal(btn) {
  if (!STATE.isAdmin) return;
  const npcId = btn?.dataset?.npcId;
  const n = _npcs.find(x => x.id === npcId); if (!n) return;
  const hasCustomTypes = _affiniteTypes.length > 0;
  _npcLink = {
    npcId, charId: null, charNom: '',
    typeId: hasCustomTypes ? null : DEFAULT_AFFINITE_TYPE.id,
  };
  const linked = new Set(_affiPerso.filter(a => a.npcId === npcId).map(a => a.charId));
  const chars = _npcLinkableCharacters().filter(c => !linked.has(c.id));
  const tiles = chars.length
    ? chars.map(c => `
        <button type="button" class="npc-linkmodal-tile" data-action="npcLinkPickChar" data-char-id="${c.id}" data-char-nom="${_esc(c.nom || '?')}">
          <span class="npc-linkmodal-av">${_charAvatar(c)}</span>
          <span class="npc-linkmodal-nm">${_esc(c.nom || '?')}</span>
          <small>${_esc(c.ownerPseudo || '')}</small>
        </button>`).join('')
    : `<div class="npc-empty-line">Tous les personnages ont déjà un lien avec ce PNJ.</div>`;
  const chips = _affiniteTypeChoices().map(t => `
        <button type="button" class="npc-linkmodal-type${t.id === _npcLink.typeId ? ' is-sel' : ''}" data-action="npcLinkPickType" data-type-id="${t.id}" style="--rc:${t.couleur || '#4f8cff'}">
          <span class="npc-linkmodal-type-emo">${t.emoji || '✨'}</span> ${_esc(_displayText(t.label))}</button>`).join('');
  openModal(`🔗 Lier un personnage à ${_esc(n.nom || 'ce PNJ')}`, `
    <div class="npc-linkmodal">
      <div class="npc-linkmodal-step">
        <div class="npc-linkmodal-head"><span class="npc-linkmodal-num">1</span> Quel personnage ?</div>
        <input type="text" class="npc-linkmodal-search" data-input="npcLinkModalFilter" placeholder="🔍 Rechercher un personnage…" autocomplete="off">
        <div class="npc-linkmodal-grid">${tiles}</div>
      </div>
      <div class="npc-linkmodal-step">
        <div class="npc-linkmodal-head"><span class="npc-linkmodal-num">2</span> Quelle relation particulière ?</div>
        <div class="npc-linkmodal-types">${chips}</div>
      </div>
      <div class="npc-linkmodal-actions">
        <button type="button" class="btn btn-outline" data-action="npcCloseModal">Annuler</button>
        <button type="button" class="btn btn-gold npc-linkmodal-confirm" data-action="npcLinkConfirm" disabled>🔗 Créer le lien</button>
      </div>
    </div>`);
}

function _npcLinkUpdateConfirm() {
  const btn = document.querySelector('.npc-linkmodal-confirm');
  if (btn) btn.disabled = !(_npcLink.charId && _npcLink.typeId);
}

async function _npcLinkConfirm() {
  if (!_npcLink.npcId || !_npcLink.charId || !_npcLink.typeId) {
    showNotif('Choisis un personnage et une relation.', 'error');
    return;
  }
  const ok = await _npcCreateLink(_npcLink.npcId, _npcLink.charId, _npcLink.charNom, _npcLink.typeId);
  if (ok) { closeModal(); showNotif('Lien créé.', 'success'); }
}

// ── Sélecteur de personnage avec portraits (pour l'ajout d'affinité) ─────────
const _profilePortraitSrc = (p = {}) =>
  p?.portraitUrl || p?.photo || p?.avatar || p?.avatarUrl || '';
const _playerProfileForChar = (charId = '', charNom = '') => {
  const byId = charId ? _playerProfiles.find(p =>
    p.charId === charId || p.characterId === charId || p.persoId === charId || p.linkedCharId === charId
  ) : null;
  if (byId) return byId;
  const targetName = _norm(charNom || '');
  return targetName ? _playerProfiles.find(p => _norm(p.nom || p.name || '') === targetName) || null : null;
};
const _charPortraitSrc = (c = {}, profile = null) =>
  c?.photo || c?.portraitUrl || c?.avatar || c?.avatarUrl || _profilePortraitSrc(profile);
const _relationCharacterFor = (a = {}) => {
  const chars = [...(STATE.characters || []), ..._relationCharacters];
  const byId = a.charId ? chars.find(x => x.id === a.charId) : null;
  if (byId) return byId;
  const targetName = _norm(a.charNom || '');
  return targetName ? chars.find(x => _norm(x.nom || x.name || '') === targetName) || null : null;
};
const _charAvatar = (c) => {
  const src = _charPortraitSrc(c);
  return src
    ? `<img class="npc-charpick-av" src="${_esc(src)}" alt="">`
    : `<span class="npc-charpick-av npc-charpick-av--ph">${_esc((c?.nom || '?')[0].toUpperCase())}</span>`;
};

const _storedRelationPortraitSrc = (a = {}, profile = null) => {
  const stored = a.charPhoto || a.photo || a.portraitUrl || a.avatar || a.avatarUrl || '';
  if (!stored) return '';
  return stored === profile?.imageUrl ? '' : stored;
};

const _profileCroppedAvatar = (profile = {}) => {
  const src = profile?.imageUrl || '';
  if (!src) return '';
  const cc = profile?.cardCrop;
  const imgStyle = cc
    ? `position:absolute;left:${(cc.offX * 100).toFixed(2)}%;top:${(cc.offY * 100).toFixed(2)}%;width:${(cc.imgW * 100).toFixed(2)}%;height:auto;max-width:none`
    : 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center top';
  return `<span class="npc-rel-av npc-rel-av--crop"><img src="${_esc(src)}" alt="" loading="lazy" decoding="async" style="${imgStyle}"></span>`;
};

// Avatar du personnage cible d'une affinité spécifique (retrouvé via charId).
const _affiTargetAvatar = (a) => {
  const c = _relationCharacterFor(a);
  const profile = _playerProfileForChar(a.charId, a.charNom);
  const src = _charPortraitSrc(c, profile) || _storedRelationPortraitSrc(a, profile);
  return src
    ? `<img class="npc-rel-av" src="${_esc(src)}" alt="" loading="lazy" decoding="async">`
    : _profileCroppedAvatar(profile) || `<span class="npc-rel-av npc-rel-av--ph">${_esc((a.charNom || '?')[0].toUpperCase())}</span>`;
};

function _npcCharPickToggle(btn) {
  const pick = btn.closest('.npc-charpick'); if (!pick) return;
  const willOpen = !pick.classList.contains('is-open');
  document.querySelectorAll('.npc-charpick.is-open').forEach(p => p.classList.remove('is-open'));
  if (willOpen) pick.classList.add('is-open');
}

function _npcCharPickSelect(btn) {
  const npcId = btn.dataset.npcId;
  const pick = btn.closest('.npc-charpick'); if (!pick) return;
  const hidden = document.getElementById(`afp-char-${npcId}`);
  if (hidden) hidden.value = `${btn.dataset.charId}|${btn.dataset.charNom}`;
  const cur = pick.querySelector('.npc-charpick-current');
  if (cur) {
    const av = btn.querySelector('.npc-charpick-av')?.outerHTML || '';
    cur.innerHTML = `${av}<span class="npc-charpick-selname">${_esc(btn.dataset.charNom || '?')}</span>`;
  }
  pick.classList.remove('is-open');
}

// Ferme les sélecteurs ouverts sur clic extérieur (lié une seule fois).
let _charPickBound = false;
function _bindCharPickOutside() {
  if (_charPickBound) return;
  _charPickBound = true;
  document.addEventListener('click', (e) => {
    if (e.target.closest('.npc-charpick')) return;
    document.querySelectorAll('.npc-charpick.is-open').forEach(p => p.classList.remove('is-open'));
  });
}

// Création inline : crée un PNJ vierge et le sélectionne (plus besoin de modal).
async function _npcCreate() {
  if (!STATE.isAdmin) return;
  try {
    const data = {
      nom: 'Nouveau PNJ',
      role: '',
      lieu: '',
      organisations: [],
      description: '',
      imageUrl: '',
      imageFull: '',
      portraits: [],
      activePortraitId: '',
      embauchable: true,
      activites: [],
      niveau: 1,
      pvBase: NPC_BASE_VITALS.pv,
      pmBase: NPC_BASE_VITALS.pm,
      hp: NPC_BASE_VITALS.pv,
      pmCurrent: NPC_BASE_VITALS.pm,
      stats: { ...NPC_BASE_STATS },
      statsLevelUps: {},
      equipement: {},
      statsBonus: {},
      actions: [],
      deck_sorts: [],
    };
    const newId = await addToCol('npcs', data);
    const entry = { id: newId || `npc_${Date.now()}`, ...data };
    if (!_npcs.find(n => n.id === entry.id)) _npcs.push(entry);
    _activeId = entry.id;
    _syncNpcRoute();
    _renderPage(document.getElementById('main-content'));
    showNotif('PNJ créé — modifie-le directement dans la fiche.', 'success');
  } catch (e) { notifySaveError(e); }
}

function _refreshActivePanel() {
  const panel = document.getElementById('npc-detail-panel');
  if (!panel) return;

  // Ne pas casser une édition inline en cours : le watch temps réel se déclenche
  // sur nos propres écritures. Si un champ inline du panneau a le focus, on diffère
  // le re-render (il se fera au prochain refresh une fois l'édition terminée).
  const ae = document.activeElement;
  if (ae && panel.contains(ae) && ae.classList?.contains('npc-inline')) return;

  const filtered = _getFiltered();
  const selected = _npcs.find(x => x.id === _activeId) || null;
  const active = (_npcIsPlayerView() && selected?.embauchable === false ? null : selected) || filtered[0] || null;

  if (!_npcs.find(x => x.id === _activeId)) {
    _activeId = active?.id || null;
    _syncNpcRoute({ replace: true });
  }

  replaceHtmlPreservingView(
    panel,
    active ? _renderFiche(active) : _renderEmpty(),
    { includeFocus: true, includeWindow: true }   // préserve aussi le scroll page (plus de saut à chaque interaction)
  );
  requestAnimationFrame(_bindNpcStickyIdentity);
}

function _refreshNpcCrossRelationsSection(npcId = _activeId) {
  const section = document.getElementById('npc-rd-cross-relations');
  const npc = _npcs.find(item => item.id === npcId);
  if (!section || !npc || section.dataset.npcId !== npc.id) return false;

  const scratch = document.createElement('div');
  scratch.innerHTML = _renderNpcCrossRelations(npc, STATE.isAdmin && !_npcIsPlayerView());
  const next = scratch.firstElementChild;
  if (!next) return false;
  replaceHtmlPreservingView(section, next.innerHTML, { includeFocus: true, includeWindow: true });
  return true;
}

function _refreshNpcCrossSummary(npcId, charId) {
  const npc = _npcs.find(item => item.id === npcId);
  const current = document.querySelector(`.npc-rd-cross-summary[data-char-id="${CSS.escape(charId || '')}"]`);
  if (!npc || !current) return false;
  const admin = STATE.isAdmin && !_npcIsPlayerView();
  let row = _npcCrossRows(npc).find(item => item.character.id === charId);
  if (!row) return false;
  if (!admin && row.exception?.secret) row = { ...row, exception: null, exLevel: null };

  const scratch = document.createElement('div');
  scratch.innerHTML = _renderNpcCrossRow(npc, row, admin);
  const next = scratch.querySelector('.npc-rd-cross-summary');
  if (!next) return false;
  // Le formulaire ouvert reste physiquement en place : un blur/change ne peut
  // donc plus supprimer le bouton que l'utilisateur est justement en train de cliquer.
  current.innerHTML = next.innerHTML;
  return true;
}

function _refreshNpcAffiUi({ list = false, targeted = false, summary = false, npcId = '', charId = '' } = {}) {
  const signature = _npcAffiUiSignature();
  if (signature === _npcAffiRenderedSignature) return false;
  _npcAffiRenderedSignature = signature;
  if (list) _refreshList({ keepScroll: true });
  if (summary && _refreshNpcCrossSummary(npcId, charId)) return true;
  if (!targeted || !_refreshNpcCrossRelationsSection()) _refreshActivePanel();
  return true;
}

function _npcSetView(btn) {
  if (!STATE.isAdmin) return;
  _npcView = btn?.dataset?.view === 'player' ? 'player' : 'mj';
  if (_npcView === 'player' && !_npcPreviewUid) _npcPreviewUid = _npcPlayerChoices()[0]?.[0] || '';
  _filterHidden = false;
  _filterIncomplete = false;
  _filterMine = false;
  _renderPage(document.getElementById('main-content'));
}

function _npcSetPreviewPlayer(el) {
  if (!STATE.isAdmin) return;
  _npcPreviewUid = el?.value || '';
  _filterMine = false;
  _renderPage(document.getElementById('main-content'));
}

function _npcSetOrgFilter(el) {
  _activeOrgFilter = el?.value || null;
  _refreshList({ keepScroll: false });
}

function _npcSetGroupBy(el) {
  _listView = ['org', 'place', 'az'].includes(el?.value) ? el.value : 'org';
  _refreshList({ keepScroll: false });
}

function _npcToggleGroup(btn) {
  const key = btn?.dataset?.key;
  if (!key) return;
  if (_npcCollapsedGroups.has(key)) _npcCollapsedGroups.delete(key);
  else _npcCollapsedGroups.add(key);
  lsJson.set('npc:collapsed-groups', [..._npcCollapsedGroups]);
  _refreshList({ keepScroll: true });
}

function _npcToggleIncomplete() {
  _filterIncomplete = !_filterIncomplete;
  _refreshList({ keepScroll: false });
}

function _npcToggleMine() {
  _filterMine = !_filterMine;
  _refreshList({ keepScroll: false });
}

function _npcExpressToggle(force = null) {
  if (!STATE.isAdmin || _npcView !== 'mj') return;
  _npcExpressOpen = force == null ? !_npcExpressOpen : !!force;
  _renderPage(document.getElementById('main-content'));
  if (_npcExpressOpen) requestAnimationFrame(() => document.getElementById('npc-express-name')?.focus());
}

function _npcCreateFromSearch() {
  _npcExpressName = _filterSearch.trim();
  _filterSearch = '';
  _npcExpressOpen = true;
  _renderPage(document.getElementById('main-content'));
  requestAnimationFrame(() => document.getElementById('npc-express-role')?.focus());
}

function _npcBasePayload({ nom = 'Nouveau PNJ', role = '', organisations = [] } = {}) {
  return {
    nom, role, lieu: '', organisations, description: '', noteMJ: '',
    imageUrl: '', imageFull: '', portraits: [], activePortraitId: '', embauchable: true,
    activites: [], niveau: 1, pvBase: NPC_BASE_VITALS.pv, pmBase: NPC_BASE_VITALS.pm,
    hp: NPC_BASE_VITALS.pv, pmCurrent: NPC_BASE_VITALS.pm, stats: { ...NPC_BASE_STATS },
    statsLevelUps: {}, equipement: {}, statsBonus: {}, actions: [], deck_sorts: [],
    affinite: { mode: 'groupe', niveau: 2, valeur: 0, note: '', historique: [] },
  };
}

async function _npcExpressCreate({ withoutRole = false } = {}) {
  if (!STATE.isAdmin) return;
  const nameInput = document.getElementById('npc-express-name');
  const roleInput = document.getElementById('npc-express-role');
  const nom = (nameInput?.value || _npcExpressName || '').trim();
  const role = withoutRole ? '' : (roleInput?.value || '').trim();
  if (!nom) { nameInput?.focus(); return; }
  const data = _npcBasePayload({ nom, role, organisations: _activeOrgFilter ? [_activeOrgFilter] : [] });
  try {
    const id = await addToCol('npcs', data);
    const entry = { id: id || `npc_${Date.now()}`, ...data, isNew: true };
    _npcs.push(entry);
    _activeId = entry.id;
    _npcExpressName = '';
    _filterSearch = '';
    _syncNpcRoute();
    _renderPage(document.getElementById('main-content'));
    requestAnimationFrame(() => document.getElementById('npc-express-name')?.focus());
    showNotif(`« ${nom} » créé.`, 'success');
    _npcFlashSaved();
  } catch (error) { notifySaveError(error); }
}

async function _npcSetAffiniteMode(btn) {
  if (!STATE.isAdmin) return;
  const n = _npcs.find(item => item.id === btn?.dataset?.id);
  const mode = btn?.dataset?.mode === 'valeur' ? 'valeur' : 'groupe';
  if (!n || _affiniteMode(n) === mode) return;
  const currentLevel = _affiniteNiveau(n);
  const thresholdKeys = ['hostile', 'mefiant', 'neutre', 'amical', 'allie'];
  const affinite = {
    ...(n.affinite || {}), mode, niveau: currentLevel,
    ...(mode === 'valeur' ? { valeur: Number(_affiniteSeuils[thresholdKeys[currentLevel]]) || 0 } : {}),
  };
  n.affinite = affinite;
  if (await trySave('npcs', n.id, { affinite })) { _npcFlashSaved(); _refreshActivePanel(); _refreshList(); }
}

function _npcEventDelta(btn) {
  _histEditDelta = Number(btn?.dataset?.value) || 0;
  document.querySelectorAll('.npc-rd-event-deltas button').forEach(el => el.classList.toggle('is-on', Number(el.dataset.value) === _histEditDelta));
}

async function _npcAddRelationEvent(btn) {
  if (!STATE.isAdmin) return;
  const n = _npcs.find(item => item.id === btn?.dataset?.id);
  const text = document.getElementById('npc-rd-event-text')?.value.trim() || '';
  if (!n || !text) return;
  const before = _affiniteNiveau(n);
  const history = [...(n.affinite?.historique || []), {
    delta: _histEditDelta,
    texte: text,
    date: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
  }];
  const affinite = { ...(n.affinite || {}), historique: history };
  if (_affiniteMode(n) === 'valeur') {
    affinite.valeur = (Number(affinite.valeur) || 0) + _histEditDelta;
    affinite.niveau = _niveauFromValeur(affinite.valeur);
  }
  n.affinite = affinite;
  if (await trySave('npcs', n.id, { affinite })) {
    const after = _affiniteNiveau(n);
    _npcFlashSaved();
    _refreshActivePanel();
    _refreshList();
    showNotif(before !== after ? `${AFFINITE[before].label} → ${AFFINITE[after].label}` : 'Événement ajouté.', 'success');
  }
}

function _npcToggleRelationHistory(btn) {
  const id = btn?.dataset?.id;
  if (!id) return;
  _npcExpandedHistories.has(id) ? _npcExpandedHistories.delete(id) : _npcExpandedHistories.add(id);
  _refreshActivePanel();
}

async function _npcDeleteRelationEvent(btn) {
  if (!STATE.isAdmin) return;
  const n = _npcs.find(item => item.id === btn?.dataset?.id);
  const index = parseInt(btn?.dataset?.index, 10);
  const beforeAffinite = n ? { ...(n.affinite || {}), historique: [...(n.affinite?.historique || [])] } : null;
  const previous = beforeAffinite?.historique || [];
  if (!n || !Number.isInteger(index) || index < 0 || index >= previous.length) return;
  const removed = previous[index];
  const historique = previous.filter((_, itemIndex) => itemIndex !== index);
  const base = { ...beforeAffinite, historique };
  const affinite = _withValeurDelta(n, base, -(Number(removed?.delta) || 0));
  n.affinite = affinite;
  if (!await trySave('npcs', n.id, { affinite })) {
    n.affinite = beforeAffinite;
    return;
  }
  _npcFlashSaved();
  _refreshActivePanel();
  showNotif('Événement supprimé.', 'success', {
    duration: 7000,
    action: {
      label: '↶ Annuler',
      onClick: async () => {
        const restored = { ...beforeAffinite, historique: previous };
        if (await trySave('npcs', n.id, { affinite: restored })) {
          n.affinite = restored;
          _npcFlashSaved();
          _refreshActivePanel();
        }
      },
    },
  });
}

function _npcGoPosture() {
  if (_npcIsPlayerView()) return;
  if (_npcSheetTab !== 'fiche') {
    _npcSheetTab = 'fiche';
    _syncNpcRoute();
    _refreshActivePanel();
  }
  requestAnimationFrame(() => document.getElementById('npc-rd-posture')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function _npcGoMissing(btn) {
  const target = btn?.dataset?.target || '';
  if (target === 'Combat') return _npcSetSheetTab('combat');
  document.getElementById(target === 'Description' ? 'npc-rd-description' : 'npc-rd-places')?.focus();
}

function _npcCrossFilterSet(btn) {
  _npcCrossFilter = btn?.dataset?.filter || 'notables';
  _npcCrossOpen = '';
  _refreshActivePanel();
}

let _npcCrossSearchTimer = null;
function _npcCrossSearchInput(el) {
  _npcCrossSearch = el?.value || '';
  clearTimeout(_npcCrossSearchTimer);
  _npcCrossSearchTimer = setTimeout(() => _refreshActivePanel(), 120);
}

function _npcCrossSortSet(el) { _npcCrossSort = el?.value || 'name'; _refreshActivePanel(); }
function _npcCrossOpenRow(btn) {
  if (!STATE.isAdmin || _npcIsPlayerView()) return;
  _npcCrossOpen = _npcCrossOpen === btn?.dataset?.charId ? '' : btn?.dataset?.charId || '';
  _refreshActivePanel();
}
function _npcShowAllRelations() { _npcCrossFilter = 'all'; _npcCrossOpen = ''; _refreshActivePanel(); }

function _npcSetExceptionLevel(btn) {
  return _npcSaveException({
    dataset: { npcId: btn?.dataset?.npcId, charId: btn?.dataset?.charId, field: 'niveau' },
    value: btn?.dataset?.value || '',
  });
}

function _npcSetExceptionType(btn) {
  const current = _npcExceptionFor(btn?.dataset?.npcId, btn?.dataset?.charId)?.typeId || '';
  const value = current === (btn?.dataset?.value || '') ? '' : (btn?.dataset?.value || '');
  return _npcSaveException({
    dataset: { npcId: btn?.dataset?.npcId, charId: btn?.dataset?.charId, field: 'typeId' },
    value,
  });
}

function _npcSetFeelingLevel(btn) {
  return _npcSaveFeeling({
    dataset: { npcId: btn?.dataset?.npcId, charId: btn?.dataset?.charId, field: 'sent' },
    value: btn?.dataset?.value || '',
  });
}

function _npcSetFeelingSuggestion(btn) {
  const current = _npcFeelingFor(btn?.dataset?.npcId, _npcLinkCharacter(btn?.dataset?.charId))?.sentiment || '';
  const value = current === (btn?.dataset?.value || '') ? '' : (btn?.dataset?.value || '');
  return _npcSaveFeeling({
    dataset: { npcId: btn?.dataset?.npcId, charId: btn?.dataset?.charId, field: 'sentiment' },
    value,
  });
}

async function _npcSaveException(el) {
  if (!STATE.isAdmin) return;
  const npcId = el?.dataset?.npcId, charId = el?.dataset?.charId, field = el?.dataset?.field;
  const character = _npcLinkCharacter(charId);
  if (!npcId || !character || !field) return;
  const choiceAction = !el?.tagName;
  let entry = _npcExceptionFor(npcId, charId);
  const value = field === 'secret' ? !!el.checked
    : field === 'niveau' ? (el.value === '' ? null : Math.max(0, Math.min(4, parseInt(el.value, 10))))
      : (el.value || '').trim();
  const patch = { [field]: value };
  if (field === 'typeId') patch.typeLabel = _getAffiniteType(value)?.label || '';
  const hasData = candidate => candidate && (
    _npcExceptionLevel(npcId, candidate) != null
    || !!candidate.typeId
    || !!String(candidate.notePublique || '').trim()
    || !!String(candidate.note || '').trim()
  );
  const candidate = {
    ...(entry || { niveau: null, secret: false, typeId: null, typeLabel: '', notePublique: '', note: '' }),
    ...patch,
  };
  if (!hasData(candidate)) {
    if (entry) {
      await deleteFromCol('npc_affinites', entry.id);
      _affiPerso = _affiPerso.filter(item => item.id !== entry.id);
      _npcFlashSaved();
      _refreshNpcAffiUi({ list: true });
    }
    return;
  }
  if (!entry) {
    const data = { npcId, charId, charNom: character.nom || '', charPhoto: _charPortraitSrc(character), niveau: null, secret: false, typeId: null, typeLabel: '', notePublique: '', note: '', ...patch };
    try {
      const id = await addToCol('npc_affinites', data);
      entry = { id: id || `aff_${Date.now()}`, ...data };
      if (!_affiPerso.some(item => item.id === entry.id)) _affiPerso.push(entry);
    } catch (error) { notifySaveError(error); return; }
    // La création change aussi les compteurs de la fiche : rendu complet une
    // seule fois, sauf si le snapshot local Firestore l'a déjà fait.
    _refreshNpcAffiUi({ list: true });
  } else {
    const previous = { ...entry };
    Object.assign(entry, patch);
    // Un bouton doit refléter immédiatement sa sélection. La sortie d'un champ
    // ne touche en revanche qu'au résumé afin de laisser le clic suivant aboutir.
    _refreshNpcAffiUi({
      targeted: choiceAction,
      summary: !choiceAction,
      npcId,
      charId,
    });
    if (!await trySave('npc_affinites', entry.id, patch)) {
      Object.assign(entry, previous);
      _refreshNpcAffiUi({
        targeted: choiceAction,
        summary: !choiceAction,
        npcId,
        charId,
      });
      return;
    }
  }
  _npcFlashSaved();
}

async function _npcRemoveException(btn) {
  const id = btn?.dataset?.id;
  if (!id) return;
  await deleteAffinitePerso(id);
  _npcCrossOpen = '';
}

async function _npcSaveFeeling(el) {
  const npcId = el?.dataset?.npcId, charId = el?.dataset?.charId, field = el?.dataset?.field;
  const character = _npcLinkCharacter(charId);
  const n = _npcs.find(item => item.id === npcId);
  if (!character || !n || !field) return;
  if (!STATE.isAdmin && _npcCharacterOwnerUid(character) !== STATE.user?.uid) return;
  const choiceAction = !el?.tagName;
  const previousRelations = Array.isArray(character.relations) ? character.relations : [];
  const relations = previousRelations.slice();
  const index = relations.findIndex(r => r?.npcId === npcId);
  const previous = index >= 0 ? relations[index] : null;
  const value = (el.value || '').trim();
  const next = {
    ...(previous || {}), npcId, nom: n.nom || 'PNJ', img: n.imageUrl || '',
    sent: previous?.sent || '', sentiment: previous?.sentiment || '', note: previous?.note || '',
    [field]: value,
  };
  if (!next.sent && !next.sentiment && !next.note && !next.role) {
    if (index >= 0) relations.splice(index, 1);
  } else if (index >= 0) relations[index] = next;
  else relations.push(next);
  character.relations = relations;
  if (choiceAction) {
    if (!_refreshNpcCrossRelationsSection(npcId)) _refreshActivePanel();
  } else if (!_refreshNpcCrossSummary(npcId, charId)) {
    _refreshActivePanel();
  }
  if (!await trySave('characters', charId, { relations })) {
    character.relations = previousRelations;
    if (choiceAction) {
      if (!_refreshNpcCrossRelationsSection(npcId)) _refreshActivePanel();
    } else if (!_refreshNpcCrossSummary(npcId, charId)) {
      _refreshActivePanel();
    }
    return;
  }
  _npcFlashSaved();
  if (_filterMine) _refreshList({ keepScroll: true });
}

async function _npcAddOrg(el) {
  if (!STATE.isAdmin) return;
  const n = _npcs.find(item => item.id === el?.dataset?.id);
  const value = (el?.value || '').trim();
  if (!n || !value) return;
  const organisations = [...new Set([...(n.organisations || []), value])];
  n.organisations = organisations;
  if (await trySave('npcs', n.id, { organisations })) { _npcFlashSaved(); _refreshActivePanel(); _refreshList(); }
}

async function _npcRemoveOrg(btn) {
  if (!STATE.isAdmin) return;
  const n = _npcs.find(item => item.id === btn?.dataset?.id);
  if (!n) return;
  const organisations = (n.organisations || []).filter(org => org !== btn.dataset.org);
  n.organisations = organisations;
  if (await trySave('npcs', n.id, { organisations })) { _npcFlashSaved(); _refreshActivePanel(); _refreshList(); }
}

async function _npcAdjustCurrent(btn) {
  if (!STATE.isAdmin) return;
  const n = _npcs.find(item => item.id === btn?.dataset?.id);
  const field = btn?.dataset?.field;
  const delta = parseInt(btn?.dataset?.delta, 10) || 0;
  if (!n || !['hp', 'pmCurrent'].includes(field) || !delta) return;
  const totals = _npcVitalTotals(n).totals;
  const max = field === 'hp' ? totals.pv : totals.pm;
  const current = Number.isFinite(Number(n[field])) ? Number(n[field]) : max;
  const value = Math.max(0, Math.min(max, current + delta));
  n[field] = value;
  if (await trySave('npcs', n.id, { [field]: value })) { _npcFlashSaved(); _refreshActivePanel(); }
}

async function _npcResetCurrent(btn) {
  if (!STATE.isAdmin) return;
  const n = _npcs.find(item => item.id === btn?.dataset?.id);
  const field = btn?.dataset?.field;
  if (!n || !['hp', 'pmCurrent'].includes(field)) return;
  const totals = _npcVitalTotals(n).totals;
  const value = field === 'hp' ? totals.pv : totals.pm;
  n[field] = value;
  if (await trySave('npcs', n.id, { [field]: value })) { _npcFlashSaved(); _refreshActivePanel(); }
}



export async function deleteAffinitePerso(id) {
  const snapshot = _affiPerso.find(a => a.id === id);
  if (!await confirmDelete('npc_affinites', id, 'Supprimer cette affinité ?', {
    title: 'Confirmation de suppression',
    snapshot,
    successMessage: 'Affinité supprimée.',
    onRestore: (restored) => { _affiPerso.push(restored); _refreshActivePanel(); },
  })) return;
  _affiPerso = _affiPerso.filter(a => a.id !== id);
  _refreshActivePanel();
}

// ── Override PAGES.npcs ───────────────────────────────────────────────────────
PAGES.npcs = renderNpcs;

// Retour/Avance entre deux PNJ ou deux panneaux : on réutilise les données déjà
// en mémoire et les abonnements existants, sans remonter la page ni relire Firestore.
document.addEventListener('app:route-sub-changed', event => {
  if (event.detail?.page !== 'npcs' || !document.querySelector('.npc-rd-page')) return;
  if (!_applyNpcRoute(event.detail.sub)) return;
  event.preventDefault();
  _refreshList({ keepScroll: true });
  _refreshActivePanel();
});

document.addEventListener('keydown', event => {
  if (!document.querySelector('.npc-rd-page')) return;
  const target = event.target;
  const typing = target?.matches?.('input, textarea, select, [contenteditable="true"]');
  if (target?.id === 'npc-express-name' && event.key === 'Enter') {
    event.preventDefault();
    if (event.shiftKey) _npcExpressCreate({ withoutRole: true });
    else document.getElementById('npc-express-role')?.focus();
    return;
  }
  if (target?.id === 'npc-express-role' && event.key === 'Enter') {
    event.preventDefault();
    _npcExpressCreate();
    return;
  }
  if (target?.id === 'npc-rd-event-text' && event.key === 'Enter') {
    event.preventDefault();
    _npcAddRelationEvent({ dataset: { id: target.dataset.npcId } });
    return;
  }
  if (event.key === 'Escape' && _npcExpressOpen) {
    event.preventDefault();
    _npcExpressOpen = false;
    _npcExpressName = '';
    _renderPage(document.getElementById('main-content'));
    return;
  }
  if (!typing && event.key === '/') {
    event.preventDefault();
    document.getElementById('npc-search')?.focus();
    return;
  }
  if (!typing && event.key.toLowerCase() === 'n' && STATE.isAdmin && _npcView === 'mj') {
    event.preventDefault();
    _npcExpressToggle(true);
    return;
  }
  if (!typing && /^[1-3]$/.test(event.key) && STATE.isAdmin && _npcView === 'mj') {
    event.preventDefault();
    _npcSetSheetTab(NPC_ROUTE_SHEET_TABS[Number(event.key) - 1]);
    return;
  }
  if ((!typing || target?.id === 'npc-search') && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
    const list = [...new Map(_getFiltered().map(n => [n.id, n])).values()];
    if (!list.length) return;
    event.preventDefault();
    const index = Math.max(0, list.findIndex(n => n.id === _activeId));
    const next = event.key === 'ArrowDown' ? Math.min(list.length - 1, index + 1) : Math.max(0, index - 1);
    selectNpc(list[next].id);
    requestAnimationFrame(() => document.querySelector(`.npc-rd-row[data-id="${CSS.escape(list[next].id)}"]`)?.scrollIntoView({ block: 'nearest' }));
  }
});


registerActions({
  _npcSearch:                (el) => _npcSearch(el.value),
  npcSetView:                (btn) => _npcSetView(btn),
  npcSetPreviewPlayer:       (el) => _npcSetPreviewPlayer(el),
  npcSetOrgFilter:           (el) => _npcSetOrgFilter(el),
  npcSetGroupBy:             (el) => _npcSetGroupBy(el),
  npcToggleGroup:            (btn) => _npcToggleGroup(btn),
  npcToggleIncomplete:       () => _npcToggleIncomplete(),
  npcToggleMine:             () => _npcToggleMine(),
  npcExpressToggle:          () => _npcExpressToggle(),
  npcExpressName:            (el) => { _npcExpressName = el.value; },
  npcExpressCreate:          () => _npcExpressCreate(),
  npcCreateFromSearch:       () => _npcCreateFromSearch(),
  npcInlineSave:             (el) => _npcInlineSave(el),
  npcPreviewDerived:         (el) => _npcPreviewDerived(el),
  npcAllocateStat:           (btn) => _npcAllocateStat(btn),
  npcAdjustVital:            (btn) => _npcAdjustVital(btn),
  npcEditLevel:              (btn) => _npcEditLevel(btn),
  npcSetAffiniteNiveau:      (btn) => _npcSetAffiniteNiveau(btn),
  npcSetAffiniteMode:        (btn) => _npcSetAffiniteMode(btn),
  npcEventDelta:             (btn) => _npcEventDelta(btn),
  npcAddRelationEvent:       (btn) => _npcAddRelationEvent(btn),
  npcToggleRelationHistory:  (btn) => _npcToggleRelationHistory(btn),
  npcDeleteRelationEvent:    (btn) => _npcDeleteRelationEvent(btn),
  npcGoPosture:              () => _npcGoPosture(),
  npcGoMissing:              (btn) => _npcGoMissing(btn),
  npcCrossFilter:            (btn) => _npcCrossFilterSet(btn),
  npcCrossSearch:            (el) => _npcCrossSearchInput(el),
  npcCrossSort:              (el) => _npcCrossSortSet(el),
  npcCrossOpen:              (btn) => _npcCrossOpenRow(btn),
  npcShowAllRelations:       () => _npcShowAllRelations(),
  npcSetExceptionLevel:      (btn) => _npcSetExceptionLevel(btn),
  npcSetExceptionType:       (btn) => _npcSetExceptionType(btn),
  npcSetFeelingLevel:        (btn) => _npcSetFeelingLevel(btn),
  npcSetFeelingSuggestion:   (btn) => _npcSetFeelingSuggestion(btn),
  npcSaveException:          (el) => _npcSaveException(el),
  npcRemoveException:        (btn) => _npcRemoveException(btn),
  npcSaveFeeling:            (el) => _npcSaveFeeling(el),
  npcAddOrg:                 (el) => _npcAddOrg(el),
  npcRemoveOrg:              (btn) => _npcRemoveOrg(btn),
  npcAdjustCurrent:          (btn) => _npcAdjustCurrent(btn),
  npcResetCurrent:           (btn) => _npcResetCurrent(btn),
  npcRelSelect:              (btn) => { const id = btn?.dataset?.affId || null; _npcRelSel = (id && _npcRelSel !== id) ? id : null; _refreshActivePanel(); },
  npcCharPickFilter:         (el)  => { const q = (el.value || '').trim().toLowerCase(); el.closest('.npc-charpick-panel')?.querySelectorAll('.npc-charpick-opt').forEach(o => { o.style.display = o.textContent.toLowerCase().includes(q) ? '' : 'none'; }); },
  npcOpenLinkModal:          (btn) => _npcOpenLinkModal(btn),
  npcCloseModal:             ()    => closeModal(),
  npcLinkPickChar:           (btn) => { _npcLink.charId = btn.dataset.charId; _npcLink.charNom = btn.dataset.charNom; document.querySelectorAll('.npc-linkmodal-tile').forEach(t => t.classList.toggle('is-sel', t === btn)); _npcLinkUpdateConfirm(); },
  npcLinkPickType:           (btn) => { _npcLink.typeId = btn.dataset.typeId; document.querySelectorAll('.npc-linkmodal-type').forEach(t => t.classList.toggle('is-sel', t === btn)); _npcLinkUpdateConfirm(); },
  npcLinkModalFilter:        (el)  => { const q = (el.value || '').trim().toLowerCase(); document.querySelectorAll('.npc-linkmodal-tile').forEach(t => { t.style.display = t.textContent.toLowerCase().includes(q) ? '' : 'none'; }); },
  npcLinkConfirm:            ()    => _npcLinkConfirm(),
  npcSetTab:                 (btn) => _npcSetSheetTab(btn?.dataset?.tab),
  // Deck de sorts PNJ (hôte-aware via forms.js) — dispo sur la page PNJ.
  toggleSort:                (btn) => _spellToggle(Number(btn.dataset.idx), btn),
  duplicateSort:             (btn) => _spellDuplicate(Number(btn.dataset.idx)),
  setSortValidation:         (btn) => _spellSetVal(Number(btn.dataset.idx), btn.dataset.val),
  deleteSort:                (btn) => _spellDelete(Number(btn.dataset.idx)),
  npcSaveOrgs:               (el) => _npcSaveOrgs(el),
  npcSetWeapon:              (el) => _npcSetWeapon(el),
  npcEquipSlot:              (el) => _npcEquipSlot(el),
  npcOpenEquipPicker:        (btn) => _npcOpenEquipPicker(btn),
  npcEquipPickerSearch:      (el) => _npcEquipPickerSearch(el),
  npcEquipPickerFilter:      (el) => _npcEquipPickerFilter(el),
  npcEquipPickerSort:        (el) => _npcEquipPickerSort(el),
  npcEquipPickerToggleFilters: () => _npcEquipPickerToggleFilters(),
  npcEquipPickerReset:       () => _npcEquipPickerReset(),
  npcEquipPickerClearSearch: () => _npcEquipPickerClearSearch(),
  npcPickEquipItem:          (btn) => _npcPickEquipItem(btn),
  npcClearEquipSlot:         (btn) => _npcClearEquipSlot(btn),
  npcOpenManualEquip:        (btn) => _npcOpenManualEquip(btn),
  npcSaveManualEquip:        (btn) => _npcSaveManualEquip(btn),
  npcManualEquipCancel:      () => popModal(),
  npcEditAction:             (btn) => _npcEditAction(btn),
  npcDeleteAction:           (btn) => _npcDeleteAction(btn),
  npcSetPanel:               (btn) => _npcSetPanel(btn?.dataset?.panel),
  npcSetPhoto:               (btn) => _npcSetPhoto(btn),
  npcAddPortrait:            (btn) => _npcAddPortrait(btn),
  npcSelectPortrait:         (btn) => _npcSelectPortrait(btn),
  npcDeletePortrait:         (btn) => _npcDeletePortrait(btn),
  npcViewPhoto:              (btn) => _npcViewPhoto(btn),
  npcSetStatut:              (btn) => _npcSetStatut(btn),
  npcSetListView:            (btn) => _npcSetListView(btn),
  npcSetStatusFilter:        (btn) => _npcSetStatusFilter(btn),
  npcToggleHiddenFilter:     ()    => _npcToggleHiddenFilter(),
  npcEditOrgIcon:            (btn) => _npcEditOrgIcon(btn),
  npcPickOrgIcon:            (btn) => _npcPickOrgIcon(btn),
  npcResetOrgIcon:           (btn) => _npcResetOrgIcon(btn),
  npcApplyOrgIconInput:      (btn) => _npcApplyOrgIconInput(btn),
  npcToggleActivite:         (btn) => _npcToggleActivite(btn),
  npcToggleEmbauchable:      (btn) => _npcToggleEmbauchable(btn),
  npcToggleRecrutable:       (btn) => _npcToggleRecrutable(btn),
  npcAddEvent:               (btn) => _npcAddEvent(btn),
  npcAffiField:              (el) => _npcAffiField(el),
  npcAddAffiPerso:           (btn) => _npcAddAffiPerso(btn),
  npcCharPickToggle:         (btn) => _npcCharPickToggle(btn),
  npcCharPickSelect:         (btn) => _npcCharPickSelect(btn),
  npcCreate:                 () => _npcCreate(),
  _mjStatsFilter:            (el) => _mjStatsFilter(el.value),
  _setHistEditDeltaFromInput:(el) => _setHistEditDeltaFromInput(el.value),
  deleteNpc:               (btn) => deleteNpc(btn.dataset.id),
  _deleteNpcThenClose:     (btn) => deleteNpc(btn.dataset.id).then(ok => { if (ok) closeModal(); }),
  selectNpc:               (btn) => selectNpc(btn.dataset.id),
  deleteAffinitePerso:     (btn) => deleteAffinitePerso(btn.dataset.id),
  openAffiniteTypesManager:()   => openAffiniteTypesManager(),
  saveAffiniteSeuils:      ()   => saveAffiniteSeuils(),
  resetAffiniteSeuils:     ()   => resetAffiniteSeuils(),
  openAffiniteSeuilsModal: ()   => openAffiniteSeuilsModal(),
  editHistoriqueEntry:     (btn) => editHistoriqueEntry(btn.dataset.npcId, Number(btn.dataset.idx)),
  deleteHistoriqueEntry:   (btn) => deleteHistoriqueEntry(btn.dataset.npcId, Number(btn.dataset.idx)),
  saveHistoriqueEntry:     (btn) => saveHistoriqueEntry(btn.dataset.npcId, Number(btn.dataset.idx)),
  deleteAffiniteType:      (btn) => deleteAffiniteType(btn.dataset.id),
  saveAffiniteType:        ()   => saveAffiniteType(),
  _aftCancelEdit:          ()   => _aftCancelEdit(),
  _aftEditType:            (btn) => _aftEditType(btn.dataset.id),
  _aftSelectEmoji:         (btn) => _aftSelectEmoji(btn.dataset.val),
  _aftSelectColor:         (btn) => _aftSelectColor(btn.dataset.val),
  _aftColorPickerInput:    (el) => _aftColorPickerInput(el),
  _aftColorHexInput:       (el) => _aftColorHexInput(el),
  _aftColorHexCommit:      (el) => _aftColorHexCommit(el),
  _selectHistEditDelta:    (btn) => _selectHistEditDelta(Number(btn.dataset.val)),
  _openMjStatsView:        ()   => _openMjStatsView(),
  _npcSelectOrg:           (btn) => _npcSelectOrg(btn),
  _npcBackToOrgs:          ()   => _npcBackToOrgs(),
  _mjEditField:            (btn) => _mjEditField(btn.dataset.npcId, btn.dataset.field),
  _mjOpenNpc:              (btn) => _mjOpenNpc(btn.dataset.id),
});
