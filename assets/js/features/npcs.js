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
import { loadCollection, addToCol, updateInCol, deleteFromCol, saveDoc } from '../data/firestore.js';
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
import { loadDamageTypes } from '../shared/damage-types.js';
import { loadRarities, getRarities, RARETE_NAMES, _rareteColor } from '../shared/rarity.js';
import { _getTraits } from './characters/data.js';
import { listPlaces } from './map/data/places.repo.js';
import { listOrganizations } from './map/data/organizations.repo.js';
import { pickImageFile, compressDataUrl } from '../shared/image-upload.js';
import { panZoomCropHTML, attachPanZoomCrop } from '../shared/image-crop.js';
import { confirmDelete, trySave } from '../shared/crud.js';
import { replaceHtmlPreservingView } from '../shared/view-context.js';

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
  { key: 'constitution', short: 'CON' },
  { key: 'intelligence', short: 'INT' },
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
  ['forge', '🔨 Forge'], ['atelier_confection', '🧵 Atelier de confection'],
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
  '🤝','❤️','🖤','💔','🫂',
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

const afx = (n) => AFFINITE[Math.max(0, Math.min(4, n ?? 2))];
// Variables CSS inline pour les couleurs dynamiques d'affinité (consommées par npcs.css).
const _afVars = (af) => `--af:${af.couleur};--af-bg:${af.bg};--af-bd:${af.border}`;
const AFFINITE_TYPES_DOC_ID  = 'npc_affinite_types';
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
let _listView      = 'cat';  // 'cat' (par catégorie) | 'az' (liste à plat A→Z)
let _filterStatus  = '';     // ''=tous | 'mort' | 'disparu' | 'alive' (ni mort ni disparu)
let _filterHidden  = false;  // MJ : n'afficher que les PNJ cachés
let _histEditDelta = 0;
let _npcPanel      = 'dossier';
let _npcSheetTab   = 'combat';   // onglet actif de la fiche PNJ : 'combat' | 'sorts'
let _npcRelSel     = null;       // id du lien d'affinité sélectionné dans le Cercle des relations
let _npcLink       = { npcId: null, charId: null, charNom: '', typeId: null };  // sélection en cours dans le modal « Lier »
let _aftFormState = { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
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
const _getAffiniteType      = (id) => _affiniteTypes.find(t => t.id === id) || null;
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
  const target = consumeTargetEntity('npc');
  _pendingTargetNpcId = target?.id || _pendingTargetNpcId;
  if (_pendingTargetNpcId && _npcs.some(n => n.id === _pendingTargetNpcId)) {
    _activeId = _pendingTargetNpcId;
    _filterSearch = '';
    _filterStatus = '';
    _filterHidden = false;
    _activeOrgFilter = null;
    _pendingTargetNpcId = null;
  }
  if (!_activeId && _npcs.length) _activeId = _npcs[0].id;
  _renderPage(content);
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
    _affiniteTypes = Array.isArray(typesDoc?.types) ? [...typesDoc.types] : [];
    _affiniteTypes.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
    _affiniteSeuils = { ...SEUILS_DEFAULT, ...(seuilsDoc || {}) };
    _refreshList({ keepScroll: true });
    _refreshActivePanel();
  });
}

function _renderPage(content) {
  const filtered = _getFiltered();
  const active   = _npcs.find(n => n.id === _activeId) || filtered[0] || null;

  content.innerHTML = _renderNpcsShell(filtered, active);
  _bindNpcListScroll();
  _scheduleNpcListScrollHint();
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
  return `
  <div class="npc-page npc-page-v2 npc-page-v3">
    <aside class="npc-sidebar npc-roster-panel npc-command-panel">
      <div class="npc-command-head">
        <div>
          <span class="npc-dashboard-kicker">Registre</span>
          <h1>PNJ</h1>
        </div>
        ${STATE.isAdmin ? `<button class="npc-btn-icon npc-btn-icon--gold" data-action="npcCreate" title="Nouveau PNJ">+</button>` : ''}
      </div>

      <label class="npc-searchbox npc-command-search">
        <span>Recherche</span>
        <input id="npc-search" class="input-field" placeholder="Nom, rôle, lieu, organisation..."
          value="${_filterSearch}" data-input="_npcSearch">
      </label>

      ${_renderRosterMetrics(filtered)}

      ${STATE.isAdmin ? `
      <div class="npc-command-actions">
        <button class="npc-primary-btn" data-action="npcCreate">+ Nouveau PNJ</button>
        <button class="npc-secondary-btn" data-action="_openMjStatsView">Stats rapides</button>
      </div>` : ''}

      <div id="npc-list-shell" class="npc-list-shell">
        <div id="npc-list-items" class="npc-list-items">
          ${_buildListHtml(filtered)}
        </div>
      </div>
    </aside>

    <main id="npc-detail-panel" class="npc-detail-panel">
      ${active ? _renderFiche(active) : _renderEmpty()}
    </main>
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

function _renderNavItem(n) {
  const isActive = n.id === _activeId;
  const niv      = _affiniteNiveau(n);
  const af       = afx(niv);
  const orgs = Array.isArray(n.organisations) ? n.organisations.filter(Boolean) : [];
  const place = n.lieu || orgs[0] || '';
  const hasVtt = n.pv || n.pm || n.ca || n.vitesse || Object.keys(n.stats || {}).length || Object.keys(n.equipement || {}).length;
  return `
  <div class="npc-nav-item ${isActive ? 'is-active' : ''} ${n.statut === 'mort' ? 'npc-nav-item--dead' : ''}" style="${_afVars(af)}"
    data-action="selectNpc" data-id="${n.id}" data-npc-id="${n.id}">

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
  // Bastion désactivé pour l'aventure (ou non premium) → aucune info de recrutement.
  if (!isFeatureEnabled('bastion')) return '';
  const adm = STATE.isAdmin;
  // Recrutement autorisé par le MJ pour ce PNJ (défaut = oui, pas de régression).
  const recrutable = n.recrutable !== false;
  // Côté joueur : visible dès Amical (≥3), recrutable seulement une fois Allié (≥4).
  const niv = _affiniteNiveau(n);
  const canSee     = niv >= 3;
  const canRecruit = niv >= 4;
  if (!adm && (!canSee || !recrutable)) return '';  // joueur : rien si non recrutable

  const hasInfo = (n.activites && n.activites.length) || n.passif || n.salaireSuggere;
  if (!adm && !hasInfo) return ''; // joueur : rien à montrer

  const actSet = new Set(n.activites || []);

  // ── Vue MJ : carte éditable (spécialités, passif, salaire, recrutable) ──
  if (adm) {
    const mjFoot = niv < 3
      ? `⚠ Les joueurs ne voient pas encore ce bloc (affinité groupe &lt; Amical).`
      : (recrutable
        ? `🛈 Visible par les joueurs dès <b>Amical</b> · recrutable à <b>Allié</b>.`
        : `🚫 Masqué aux joueurs (marqué « non recrutable »).`);
    return `
    <section class="npc-bastion${recrutable ? '' : ' is-off'}">
      <div class="npc-bastion-head">
        <div class="npc-bastion-title"><span class="npc-bastion-ico">🏰</span><div><h3>Bastion</h3><small>Profil de recrutement</small></div></div>
        <button type="button" class="npc-bastion-recruit${recrutable ? '' : ' off'}" data-action="npcToggleRecrutable" data-id="${n.id}"
          title="Autoriser ou non le recrutement de ce PNJ au Bastion">${recrutable ? '✅ Recrutable' : '🚫 Non recrutable'}</button>
      </div>
      <div class="npc-bastion-body">
        <div class="npc-bastion-block">
          <span class="npc-bastion-lbl">Spécialités / activités</span>
          <div class="npc-bastion-specs">
            ${NPC_ACTIVITES.map(([slug, label]) => `
              <button type="button" class="npc-bastion-spec${actSet.has(slug) ? ' is-on' : ''}" data-action="npcToggleActivite" data-id="${n.id}" data-slug="${slug}">${label}</button>`).join('')}
          </div>
        </div>
        <div class="npc-bastion-grid">
          <div class="npc-bastion-passif">
            <div class="npc-bastion-passif-row">🎁 Passif employé</div>
            <textarea class="npc-inline" data-change="npcInlineSave" data-npc-id="${n.id}" data-field="passif"
              rows="2" placeholder="+20% production Forge · −10% achats…">${_esc(n.passif || '')}</textarea>
          </div>
          <div class="npc-bastion-salaire">
            <span class="npc-bastion-sal-k">Salaire</span>
            <span class="npc-bastion-sal-v"><input type="number" min="0" class="npc-inline" data-change="npcInlineSave"
              data-npc-id="${n.id}" data-field="salaireSuggere" value="${parseInt(n.salaireSuggere) || ''}" placeholder="0"> <small>or/sem.</small></span>
          </div>
        </div>
      </div>
      <div class="npc-bastion-foot mj">${mjFoot}</div>
    </section>`;
  }

  // ── Vue joueur (lecture seule) — gatée par l'affinité ──
  const activites = [...actSet].map(_actLabel);
  const hasEco = n.passif || n.salaireSuggere;
  return `
  <section class="npc-bastion">
    <div class="npc-bastion-head">
      <div class="npc-bastion-title"><span class="npc-bastion-ico">🏰</span><div><h3>${canRecruit ? 'Recrutable au Bastion' : 'Profil bastion'}</h3><small>Bastion</small></div></div>
    </div>
    <div class="npc-bastion-body">
      ${activites.length ? `<div class="npc-bastion-block">
        <span class="npc-bastion-lbl">Spécialités</span>
        <div class="npc-bastion-specs">${activites.map(a => `<span class="npc-bastion-spec is-on">${_esc(a)}</span>`).join('')}</div>
      </div>` : ''}
      ${hasEco ? `<div class="npc-bastion-grid">
        ${n.passif ? `<div class="npc-bastion-passif"><div class="npc-bastion-passif-row">🎁 Passif</div><p>${_esc(n.passif)}</p></div>` : '<div></div>'}
        ${n.salaireSuggere ? `<div class="npc-bastion-salaire"><span class="npc-bastion-sal-k">Salaire</span><span class="npc-bastion-sal-v">${n.salaireSuggere} <small>or/sem.</small></span></div>` : ''}
      </div>` : ''}
    </div>
    <div class="npc-bastion-foot ${canRecruit ? 'ok' : 'lock'}">${canRecruit
      ? `✅ Recrutable — l'affinité du groupe est suffisante (Allié).`
      : `🔒 Recrutable une fois l'affinité du groupe au niveau <b>Allié</b>.`}</div>
  </section>`;
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
  const typeOpts = _affiniteTypes.map(t =>
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
    const chars = sortCharactersForDisplay(STATE.characters || []);
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
            ${_affiniteTypes.map(t => `<option value="${t.id}">${t.emoji || '✨'} ${_esc(_displayText(t.label))}</option>`).join('')}
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
  const af = afx(_affiniteNiveau(n));
  const adm = STATE.isAdmin;
  const level = Math.max(1, parseInt(n.niveau, 10) || 1);
  const { totals } = _npcVitalTotals(n);
  const pvBase = _npcBaseVital(n, 'pv'), pmBase = _npcBaseVital(n, 'pm');
  const deckMax = calcDeckMax(n);
  const deckActifs = _npcSpellList(n).filter(s => s?.actif !== false).length;
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
      <div class="cs-mini"><span class="cs-mini-icon">✦</span><span class="cs-mini-body"><span class="cs-mini-lbl">Deck</span><span class="cs-mini-val">${deckActifs}/${deckMax}</span></span></div>
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
      <button type="button" class="tab-v3 ${tab === 'combat' ? 'active' : ''}" role="tab" aria-selected="${tab === 'combat'}" data-action="npcSetTab" data-tab="combat">
        ${_tico('sword')} Combat</button>
      <button type="button" class="tab-v3 ${tab === 'sorts' ? 'active' : ''}" role="tab" aria-selected="${tab === 'sorts'}" data-action="npcSetTab" data-tab="sorts">
        ${_tico('sparkles')} Sorts <span class="tab-badge">${deckActifs}/${deckMax}</span></button>
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
  // Synthèse « Points de caractéristiques » — identique à la fiche joueur
  // (_buildStatTilesHtml) : total + détail Base/Niveau/Équipement.
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
      <span><small>Équipement</small><b class="${_sum.equipment > 0 ? 'pos' : _sum.equipment < 0 ? 'neg' : ''}">${_signed(_sum.equipment)}</b></span><i>=</i>
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
        const bDisp = bonus > 0 ? `+${bonus}` : bonus < 0 ? String(bonus) : '0';
        return `
          <div class="stat-tile" data-stat="${_esc(s.key)}"
            title="${_esc(NPC_STAT_LABELS[s.key] || s.key)} - Base ${safeBase} + Niveau +${levelUp} + Equip. ${bDisp} = ${total}">
            <header class="stat-tile-head">
              <span class="stat-tile-name">${_esc(NPC_STAT_LABELS[s.key] || s.short)}</span>
              <span class="stat-tile-mod ${mCls}">${mod >= 0 ? '+' + mod : mod}</span>
            </header>
            <div class="stat-tile-total-row">
              <span class="stat-tile-total">${total}</span>
              <span class="stat-tile-total-lbl">Total</span>
            </div>
            <div class="stat-tile-formula">
              <label class="stat-seg stat-seg-base editable" title="Modifier la base PNJ">
                <input type="number" class="npc-inline npc-stat-seg-input" data-change="npcInlineSave"
                  data-npc-id="${_esc(n.id)}" data-field="statBase:${_esc(s.key)}" value="${safeBase}" placeholder="${safeBase}">
                <span class="stat-seg-lbl">Base</span>
              </label>
              <span class="stat-formula-op">+</span>
              <div class="stat-seg stat-seg-niv ${levelUp ? 'has' : 'zero'}">
                <span class="stat-seg-val">+${levelUp}</span>
                <span class="stat-seg-lbl">Niveau</span>
                <span class="stat-seg-ctrls">
                  <button class="stat-lvl-btn" type="button" ${levelUp ? '' : 'disabled'} data-action="npcAllocateStat" data-npc-id="${_esc(n.id)}" data-stat="${_esc(s.key)}" data-delta="-1" title="Retirer un point">−</button>
                  <button class="stat-lvl-btn plus" type="button" ${remaining ? '' : 'disabled'} data-action="npcAllocateStat" data-npc-id="${_esc(n.id)}" data-stat="${_esc(s.key)}" data-delta="1" title="Ajouter un point">+</button>
                </span>
              </div>
              <span class="stat-formula-op">+</span>
              <div class="stat-seg stat-seg-eq ${bCls}">
                <span class="stat-seg-val">${bDisp}</span>
                <span class="stat-seg-lbl">Equip.</span>
              </div>
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

function _npcSetPanel(btn) {
  _npcPanel = btn?.dataset?.panel || 'dossier';
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
    const chars = sortCharactersForDisplay(STATE.characters || []);
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
            ${_affiniteTypes.map(t => `<option value="${t.id}">${t.emoji || '*'} ${_esc(_displayText(t.label))}</option>`).join('')}
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
  const typeOpts = _affiniteTypes.map(t =>
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
    const typeOpts = _affiniteTypes.map(t =>
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
        <span class="npc-hub-addbtn-txt"><b>Lier un joueur à ce PNJ</b><small>Choisis un personnage et sa relation particulière</small></span>
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
  let base = STATE.isAdmin ? _npcs : _npcs.filter(n => n.embauchable !== false);
  if (STATE.isAdmin && _filterHidden) base = base.filter(n => n.embauchable === false);
  if (_filterStatus === 'mort')         base = base.filter(n => n.statut === 'mort');
  else if (_filterStatus === 'disparu') base = base.filter(n => n.statut === 'disparu');
  else if (_filterStatus === 'alive')   base = base.filter(n => n.statut !== 'mort' && n.statut !== 'disparu');
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
export function selectNpc(id) {
  _activeId = id;
  const npc = _npcs.find(item => item.id === id);
  if (npc) recordRecentNavigation({ type: 'npc', id, title: npc.nom || npc.name || '' });

  _refreshList();
  _refreshActivePanel();
}

function _npcSearch(val) {
  _filterSearch = val;
  _refreshList({ keepScroll: false });
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

function _buildListHtml(filtered = _getFiltered()) {
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
  _listView = btn.dataset.view === 'az' ? 'az' : 'cat';
  _activeOrgFilter = null;
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
  await trySave('npcs', id, { statut });
  _refreshActivePanel();
  _refreshList({ keepScroll: true });
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
  const fmt = _weaponFormats.find(f => f.id === item.formatId || f.label === item.format);
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
        <label class="npc-manual-field"><span>Format</span><select id="npc-manual-format">
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
    await deleteFromCol('npcs', id);
    const toDelete = _affiPerso.filter(a => a.npcId === id);
    await Promise.all(toDelete.map(a => deleteFromCol('npc_affinites', a.id)));
    _npcs      = _npcs.filter(n => n.id !== id);
    _affiPerso = _affiPerso.filter(a => a.npcId !== id);
    if (_activeId === id) _activeId = _npcs[0]?.id || null;
    showNotif('PNJ supprimé.', 'success');
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
  return EMOJI_PRESET.map(e => `
    <button type="button" data-emoji="${e}" data-action="_aftSelectEmoji" data-val="${e}"
      style="width:34px;height:34px;border-radius:8px;cursor:pointer;font-size:1.15rem;
      transition:all .12s;background:${e === selectedEmoji ? 'rgba(255,255,255,.15)' : 'transparent'};
      border:1px solid ${e === selectedEmoji ? 'var(--gold)' : 'transparent'};
      transform:${e === selectedEmoji ? 'scale(1.15)' : 'scale(1)'}">${e}</button>`
  ).join('');
}

function _aftColorGrid(selectedColor) {
  return TYPE_COLORS.map(hex => `
    <button type="button" data-color="${hex}" data-action="_aftSelectColor" data-val="${hex}"
      style="width:26px;height:26px;border-radius:7px;cursor:pointer;background:${hex};
      transition:all .12s;
      border:3px solid ${hex === selectedColor ? 'white' : 'transparent'};
      box-shadow:${hex === selectedColor ? `0 0 0 2px ${hex}` : 'none'}"></button>`
  ).join('');
}

function _getAffiniteTypesManagerHtml() {
  const s     = _aftFormState || { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
  const isEdit = !!s.editingId;

  const typesList = _affiniteTypes.length
    ? _affiniteTypes.map(t => {
        const col = t.couleur || TYPE_COLORS[0];
        const isEditing = s.editingId === t.id;
        return `
        <div style="display:flex;align-items:center;gap:.55rem;padding:.5rem .7rem;
          background:${isEditing ? col + '22' : col + '11'};
          border:1px solid ${isEditing ? col + '66' : col + '28'};border-radius:9px;
          transition:all .15s">
          <span style="font-size:1.2rem;flex-shrink:0">${t.emoji || '✨'}</span>
          <span style="flex:1;font-size:.85rem;font-weight:700;color:${col}">${_esc(_displayText(t.label))}</span>
          <div style="display:flex;gap:.25rem">
            <button type="button" data-action="_aftEditType" data-id="${t.id}"
              style="background:${isEditing ? col + '33' : 'none'};border:1px solid ${isEditing ? col : 'var(--border)'};
              border-radius:7px;padding:.3rem .5rem;cursor:pointer;
              color:${isEditing ? col : 'var(--text-dim)'};font-size:.72rem">✏️</button>
            <button type="button" data-action="deleteAffiniteType" data-id="${t.id}"
              style="background:none;border:1px solid rgba(255,107,107,.35);border-radius:7px;
              padding:.3rem .5rem;cursor:pointer;color:#ff6b6b;font-size:.72rem">🗑️</button>
          </div>
        </div>`;
      }).join('')
    : `<div style="padding:.75rem;color:var(--text-dim);font-size:.84rem;text-align:center;
        font-style:italic">Aucune affinité spécifique définie.</div>`;

  return `
  <div style="display:flex;flex-direction:column;gap:.85rem">

    <!-- Liste existants -->
    ${_affiniteTypes.length ? `
    <div style="display:flex;flex-direction:column;gap:.35rem;
      max-height:200px;overflow-y:auto;overflow-x:hidden;padding-right:.25rem">
      ${typesList}
    </div>
    <div style="border-top:1px solid var(--border)"></div>` : typesList}

    <!-- Formulaire inline -->
    <div>
      <div style="font-size:.72rem;font-weight:700;color:${isEdit ? 'var(--gold)' : 'var(--text-dim)'};
        text-transform:uppercase;letter-spacing:1px;margin-bottom:.65rem">
        ${isEdit ? `✏️ Modifier — ${_esc(_displayText(_affiniteTypes.find(t => t.id === s.editingId)?.label || ''))}` : '➕ Ajouter un type'}</div>

      <!-- Emoji -->
      <div style="margin-bottom:.55rem">
        <div style="font-size:.64rem;color:var(--text-dim);text-transform:uppercase;
          letter-spacing:.8px;margin-bottom:.3rem">Emoji</div>
          <div id="aft-emoji-grid" style="display:flex;flex-wrap:wrap;gap:.25rem;
            background:var(--bg-card);border:1px solid var(--border);
            border-radius:10px;padding:.5rem;
            max-height:132px;overflow-y:auto;overflow-x:hidden">
            ${_aftEmojiGrid(s.emoji)}
          </div>
        <input type="hidden" id="aft-emoji-val" value="${s.emoji}">
      </div>

      <!-- Nom -->
      <div style="margin-bottom:.55rem">
        <div style="font-size:.64rem;color:var(--text-dim);text-transform:uppercase;
          letter-spacing:.8px;margin-bottom:.3rem">Nom</div>
        <input class="input-field" id="aft-label" value="${_esc(s.label)}"
          placeholder="Ex: Confident, Rival, Chouchou…"
          style="font-size:.85rem">
      </div>

      <!-- Couleur -->
      <div style="margin-bottom:.7rem">
        <div style="font-size:.64rem;color:var(--text-dim);text-transform:uppercase;
          letter-spacing:.8px;margin-bottom:.3rem">Couleur</div>
        <div id="aft-color-grid" style="display:flex;gap:.4rem;flex-wrap:wrap">
          ${_aftColorGrid(s.couleur)}
        </div>
        <input type="hidden" id="aft-color"      value="${s.couleur}">
        <input type="hidden" id="aft-editing-id" value="${s.editingId}">
      </div>

      <!-- Boutons -->
      <div style="display:flex;gap:.4rem">
        <button data-action="saveAffiniteType" class="btn btn-gold"
          style="flex:1;font-size:.8rem">
          ${isEdit ? '💾 Enregistrer' : '➕ Créer'}</button>
        ${isEdit ? `
        <button data-action="_aftCancelEdit"
          class="btn btn-outline btn-sm" style="font-size:.78rem">Annuler</button>` : ''}
      </div>
    </div>
  </div>`;
}

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
  // Initialise le formulaire à l'état "ajout"
  _aftFormState = { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
  pushModal('🎭 Affinités spécifiques', _getAffiniteTypesManagerHtml(), () => {
    // À la fermeture, rafraîchir la fiche (les types/affinités ont pu changer).
    if (_activeId) _refreshActivePanel();
  });
}

function _refreshAffiniteTypesManager() {
  updateModalContent('🎭 Affinités spécifiques', _getAffiniteTypesManagerHtml());
}

function _aftSelectEmoji(emoji) {
  const inp = document.getElementById('aft-emoji-val');
  if (inp) inp.value = emoji;
  if (_aftFormState) _aftFormState.emoji = emoji;
  document.querySelectorAll('#aft-emoji-grid button').forEach(btn => {
    const sel = btn.dataset.emoji === emoji;
    btn.style.background  = sel ? 'rgba(255,255,255,.15)' : 'transparent';
    btn.style.borderColor = sel ? 'var(--gold)' : 'transparent';
    btn.style.transform   = sel ? 'scale(1.15)' : 'scale(1)';
  });
}

function _aftSelectColor(hex) {
  const inp = document.getElementById('aft-color');
  if (inp) inp.value = hex;
  if (_aftFormState) _aftFormState.couleur = hex;
  document.querySelectorAll('#aft-color-grid button').forEach(btn => {
    const sel = btn.dataset.color === hex;
    btn.style.borderColor = sel ? 'white' : 'transparent';
    btn.style.boxShadow   = sel ? `0 0 0 2px ${hex}` : 'none';
  });
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
  const couleur   = document.getElementById('aft-color')?.value     || TYPE_COLORS[0];
  const editingId = document.getElementById('aft-editing-id')?.value || '';

  if (!label) { showNotif('Donne un nom au type.', 'error'); return; }

  if (editingId) {
    const idx = _affiniteTypes.findIndex(t => t.id === editingId);
    if (idx >= 0) _affiniteTypes[idx] = { ..._affiniteTypes[idx], label, emoji, couleur };
  } else {
    const id = `aft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    _affiniteTypes.push({ id, label, emoji, couleur });
    _affiniteTypes.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
  }

  await saveDoc('npc_affinites', AFFINITE_TYPES_DOC_ID, { types: _affiniteTypes });
  _aftFormState = { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
  showNotif(editingId ? 'Type modifié !' : 'Type créé !', 'success');
  _refreshAffiniteTypesManager();
}

export async function deleteAffiniteType(typeId) {
  if (!await confirmModal('Supprimer ce type d\'affinité ?', {title: 'Confirmation de suppression'})) return;
  _affiniteTypes = _affiniteTypes.filter(t => t.id !== typeId);
  await saveDoc('npc_affinites', AFFINITE_TYPES_DOC_ID, { types: _affiniteTypes });
  if (_aftFormState?.editingId === typeId) {
    _aftFormState = { editingId: '', emoji: EMOJI_PRESET[0], couleur: TYPE_COLORS[0], label: '' };
  }
  showNotif('Type supprimé.', 'success');
  _refreshAffiniteTypesManager();
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

// Clic sur le portrait → choisir une image, compresser, enregistrer (base64).
// Portrait PNJ : on passe par le cropper pan/zoom (comme les persos) pour
// pouvoir cadrer l'image au lieu de la stocker brute.
let _npcPhotoCrop = null;
let _npcPhotoSrc = null; // image originale (avant cadrage) → stockée en imageFull
function _npcSetPhoto(btn) {
  if (!STATE.isAdmin) return;
  const id = btn.dataset.id;
  pickImageFile({ onImage: ({ dataUrl }) => _npcShowCropModal(dataUrl, id) });
}

function _npcShowCropModal(dataUrl, id) {
  _npcPhotoSrc = dataUrl;
  openModal('📷 Cadrer le portrait', `
    ${panZoomCropHTML({ idPrefix: 'npc-crop', viewSize: 300 })}
    <div style="display:flex;gap:.6rem;justify-content:flex-end;width:300px;margin:.8rem auto 0">
      <button class="btn btn-outline" id="npc-photo-cancel">Annuler</button>
      <button class="btn btn-gold" id="npc-photo-save">✅ Enregistrer</button>
    </div>`);
  requestAnimationFrame(() => {
    _npcPhotoCrop?.destroy?.();
    _npcPhotoCrop = attachPanZoomCrop({ idPrefix: 'npc-crop', dataUrl, viewSize: 300, outputSize: 300 });
    document.getElementById('npc-photo-cancel')?.addEventListener('click', () => {
      _npcPhotoCrop?.destroy?.(); _npcPhotoCrop = null; closeModal();
    }, { once: true });
    document.getElementById('npc-photo-save')?.addEventListener('click', () => _npcSaveCroppedPhoto(id));
  });
}

async function _npcSaveCroppedPhoto(id) {
  const dataUrl = _npcPhotoCrop?.getBase64();
  if (!dataUrl) { showNotif('Erreur : cadrage non initialisé.', 'error'); return; }
  // Image pleine (non cadrée) bornée → visible par les joueurs via le portrait.
  const imageFull = _npcPhotoSrc ? await compressDataUrl(_npcPhotoSrc, { max: 1280, quality: 0.8 }) : '';
  const n = _npcs.find(x => x.id === id); if (n) { n.imageUrl = dataUrl; n.imageFull = imageFull; }
  if (await trySave('npcs', id, { imageUrl: dataUrl, imageFull })) {
    _npcPhotoCrop?.destroy?.(); _npcPhotoCrop = null; _npcPhotoSrc = null;
    closeModal();
    showNotif('Portrait enregistré !', 'success');
    _refreshActivePanel(); _refreshList();
  }
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
  await trySave('npcs', id, { embauchable: n.embauchable });
  _refreshActivePanel();
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
  Object.assign(a, patch);
  await trySave('npc_affinites', a.id, patch);
}

// Ajout inline d'une affinité spécifique (personnage + type) — sans modal.
async function _npcAddAffiPerso(btn) {
  if (!STATE.isAdmin) return;
  const npcId = btn.dataset.npcId;
  const charSel = document.getElementById(`afp-char-${npcId}`)?.value;
  const typeId  = document.getElementById(`afp-type-${npcId}`)?.value;
  if (!charSel) { showNotif('Choisis un personnage.', 'error'); return; }
  if (!typeId)  { showNotif('Choisis un type d\'affinité.', 'error'); return; }
  const [charId, charNom] = charSel.split('|');
  const char = (STATE.characters || []).find(c => c.id === charId);
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
    _refreshActivePanel();
  } catch (e) { notifySaveError(e); }
}

// ── Flux « Lier un joueur » : modal visuel en 2 étapes (choix joueur + relation) ──
async function _npcCreateLink(npcId, charId, charNom, typeId) {
  const char = (STATE.characters || []).find(c => c.id === charId);
  const type = _getAffiniteType(typeId);
  const data = {
    npcId, charId, charNom, charPhoto: _charPortraitSrc(char),
    typeId, typeLabel: type?.label || '', note: '', notePublique: '',
  };
  try {
    const newId = await addToCol('npc_affinites', data);
    const entry = { id: newId || `afp_${Date.now()}`, ...data };
    if (!_affiPerso.find(x => x.id === entry.id)) _affiPerso.push(entry);
    _refreshActivePanel();
    return true;
  } catch (e) { notifySaveError(e); return false; }
}

function _npcOpenLinkModal(btn) {
  if (!STATE.isAdmin) return;
  const npcId = btn?.dataset?.npcId;
  const n = _npcs.find(x => x.id === npcId); if (!n) return;
  _npcLink = { npcId, charId: null, charNom: '', typeId: null };
  const linked = new Set(_affiPerso.filter(a => a.npcId === npcId).map(a => a.charId));
  const chars = sortCharactersForDisplay(STATE.characters || []).filter(c => !linked.has(c.id));
  const tiles = chars.length
    ? chars.map(c => `
        <button type="button" class="npc-linkmodal-tile" data-action="npcLinkPickChar" data-char-id="${c.id}" data-char-nom="${_esc(c.nom || '?')}">
          <span class="npc-linkmodal-av">${_charAvatar(c)}</span>
          <span class="npc-linkmodal-nm">${_esc(c.nom || '?')}</span>
          <small>${_esc(c.ownerPseudo || '')}</small>
        </button>`).join('')
    : `<div class="npc-empty-line">Tous les personnages ont déjà un lien avec ce PNJ.</div>`;
  const chips = _affiniteTypes.length
    ? _affiniteTypes.map(t => `
        <button type="button" class="npc-linkmodal-type" data-action="npcLinkPickType" data-type-id="${t.id}" style="--rc:${t.couleur || '#4f8cff'}">
          <span class="npc-linkmodal-type-emo">${t.emoji || '✨'}</span> ${_esc(_displayText(t.label))}</button>`).join('')
    : `<div class="npc-empty-line">Aucun type de relation. Crée-en un via « 🏷 Types ».</div>`;
  openModal(`🔗 Lier un joueur à ${_esc(n.nom || 'ce PNJ')}`, `
    <div class="npc-linkmodal">
      <div class="npc-linkmodal-step">
        <div class="npc-linkmodal-head"><span class="npc-linkmodal-num">1</span> Quel joueur ?</div>
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
    showNotif('Choisis un joueur et une relation.', 'error');
    return;
  }
  const ok = await _npcCreateLink(_npcLink.npcId, _npcLink.charId, _npcLink.charNom, _npcLink.typeId);
  if (ok) { closeModal(); showNotif('Lien créé.', 'success'); }
}

// ── Sélecteur de personnage avec portraits (pour l'ajout d'affinité) ─────────
const _profilePortraitSrc = (p = {}) => p.portraitUrl || p.photo || p.avatar || p.avatarUrl || '';
const _playerProfileForChar = (charId = '', charNom = '') => {
  const byId = charId ? _playerProfiles.find(p =>
    p.charId === charId || p.characterId === charId || p.persoId === charId || p.linkedCharId === charId
  ) : null;
  if (byId) return byId;
  const targetName = _norm(charNom || '');
  return targetName ? _playerProfiles.find(p => _norm(p.nom || p.name || '') === targetName) || null : null;
};
const _charPortraitSrc = (c = {}, profile = null) =>
  c.photo || c.portraitUrl || c.avatar || c.avatarUrl || _profilePortraitSrc(profile) || '';
const _relationCharacterFor = (a = {}) => {
  const chars = [...(STATE.characters || []), ..._relationCharacters];
  const byId = a.charId ? chars.find(x => x.id === a.charId) : null;
  if (byId) return byId;
  const targetName = _norm(a.charNom || '');
  return targetName ? chars.find(x => _norm(x.nom || x.name || '') === targetName) || null : null;
};
const _charAvatar = (c) => _charPortraitSrc(c)
  ? `<img class="npc-charpick-av" src="${_esc(_charPortraitSrc(c))}" alt="">`
  : `<span class="npc-charpick-av npc-charpick-av--ph">${_esc((c.nom || '?')[0].toUpperCase())}</span>`;

const _storedRelationPortraitSrc = (a = {}, profile = null) => {
  const stored = a.charPhoto || a.photo || a.portraitUrl || a.avatar || a.avatarUrl || '';
  if (!stored) return '';
  return stored === profile?.imageUrl ? '' : stored;
};

const _profileCroppedAvatar = (profile = {}) => {
  const src = profile.imageUrl || '';
  if (!src) return '';
  const cc = profile.cardCrop;
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
  const active = _npcs.find(x => x.id === _activeId) || filtered[0] || null;

  if (!_npcs.find(x => x.id === _activeId)) {
    _activeId = active?.id || null;
  }

  replaceHtmlPreservingView(
    panel,
    active ? _renderFiche(active) : _renderEmpty(),
    { includeFocus: true, includeWindow: true }   // préserve aussi le scroll page (plus de saut à chaque interaction)
  );
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


registerActions({
  _npcSearch:                (el) => _npcSearch(el.value),
  npcInlineSave:             (el) => _npcInlineSave(el),
  npcPreviewDerived:         (el) => _npcPreviewDerived(el),
  npcAllocateStat:           (btn) => _npcAllocateStat(btn),
  npcAdjustVital:            (btn) => _npcAdjustVital(btn),
  npcEditLevel:              (btn) => _npcEditLevel(btn),
  npcSetAffiniteNiveau:      (btn) => _npcSetAffiniteNiveau(btn),
  npcRelSelect:              (btn) => { const id = btn?.dataset?.affId || null; _npcRelSel = (id && _npcRelSel !== id) ? id : null; _refreshActivePanel(); },
  npcCharPickFilter:         (el)  => { const q = (el.value || '').trim().toLowerCase(); el.closest('.npc-charpick-panel')?.querySelectorAll('.npc-charpick-opt').forEach(o => { o.style.display = o.textContent.toLowerCase().includes(q) ? '' : 'none'; }); },
  npcOpenLinkModal:          (btn) => _npcOpenLinkModal(btn),
  npcCloseModal:             ()    => closeModal(),
  npcLinkPickChar:           (btn) => { _npcLink.charId = btn.dataset.charId; _npcLink.charNom = btn.dataset.charNom; document.querySelectorAll('.npc-linkmodal-tile').forEach(t => t.classList.toggle('is-sel', t === btn)); _npcLinkUpdateConfirm(); },
  npcLinkPickType:           (btn) => { _npcLink.typeId = btn.dataset.typeId; document.querySelectorAll('.npc-linkmodal-type').forEach(t => t.classList.toggle('is-sel', t === btn)); _npcLinkUpdateConfirm(); },
  npcLinkModalFilter:        (el)  => { const q = (el.value || '').trim().toLowerCase(); document.querySelectorAll('.npc-linkmodal-tile').forEach(t => { t.style.display = t.textContent.toLowerCase().includes(q) ? '' : 'none'; }); },
  npcLinkConfirm:            ()    => _npcLinkConfirm(),
  npcSetTab:                 (btn) => { const t = btn?.dataset?.tab; if (t === 'combat' || t === 'sorts') { _npcSheetTab = t; _refreshActivePanel(); } },
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
  npcSetPanel:               (btn) => _npcSetPanel(btn),
  npcSetPhoto:               (btn) => _npcSetPhoto(btn),
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
  _selectHistEditDelta:    (btn) => _selectHistEditDelta(Number(btn.dataset.val)),
  _openMjStatsView:        ()   => _openMjStatsView(),
  _npcSelectOrg:           (btn) => _npcSelectOrg(btn),
  _npcBackToOrgs:          ()   => _npcBackToOrgs(),
  _mjEditField:            (btn) => _mjEditField(btn.dataset.npcId, btn.dataset.field),
  _mjOpenNpc:              (btn) => _mjOpenNpc(btn.dataset.id),
});
