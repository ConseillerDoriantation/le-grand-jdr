// ══════════════════════════════════════════════════════════════════════════════
// SHARED / CHAR-STATS.JS — Calculs de statistiques des personnages
// Source unique de vérité : toutes les features importent d'ici.
//   import { getMod, calcCA, calcPVMax, calcPMMax, calcOr } from '../shared/char-stats.js';
// ══════════════════════════════════════════════════════════════════════════════

// ── Métadonnées des statistiques ──────────────────────────────────────────────
export const STAT_META = [
  { key: 'force',        label: 'Force',        color: '#ff6b6b' },
  { key: 'dexterite',    label: 'Dextérité',    color: '#22c38e' },
  { key: 'intelligence', label: 'Intelligence', color: '#4f8cff' },
  { key: 'constitution', label: 'Constitution', color: '#f59e0b' },
  { key: 'sagesse',      label: 'Sagesse',      color: '#b47fff' },
  { key: 'charisme',     label: 'Charisme',     color: '#fd6c9e' },
];

export const ITEM_STAT_META = [
  { full: 'force',        store: 'fo',  aliases: ['for'], short: 'For', label: 'Force' },
  { full: 'dexterite',    store: 'dex', short: 'Dex', label: 'Dextérité' },
  { full: 'intelligence', store: 'in',  short: 'Int', label: 'Intelligence' },
  { full: 'sagesse',      store: 'sa',  short: 'Sag', label: 'Sagesse' },
  { full: 'constitution', store: 'co',  short: 'Con', label: 'Constitution' },
  { full: 'charisme',     store: 'ch',  short: 'Cha', label: 'Charisme' },
];

export const ITEM_STAT_BY_FULL  = Object.fromEntries(ITEM_STAT_META.map(s => [s.full,  s]));
export const ITEM_STAT_BY_STORE = Object.fromEntries(
  ITEM_STAT_META.flatMap(s => [s.store, ...(s.aliases || [])].map(store => [store, s]))
);

/** Retourne le label court d'une stat (ex: 'dexterite' → 'Dex'). */
export function statShort(key) {
  return ITEM_STAT_BY_FULL[key]?.short || '';
}

/**
 * Lit le bonus de base d'un item, sans tenir compte des améliorations
 * (`upgrades.statBonus`). Utile pour la revente / boutique / recettes
 * où l'on veut la valeur originale de l'item.
 */
export function getItemBaseStatBonus(item = {}, statOrStore = '') {
  const meta = ITEM_STAT_BY_FULL[statOrStore] || ITEM_STAT_BY_STORE[statOrStore];
  if (!meta) return 0;
  const stores = [meta.store, ...(meta.aliases || [])];
  for (const store of stores) {
    if (item?.[store] === undefined || item?.[store] === '') continue;
    const val = parseInt(item[store]);
    return Number.isNaN(val) ? 0 : val;
  }
  return 0;
}

/**
 * Lit la portion d'amélioration d'un bonus de stat (`upgrades.statBonus[store]`).
 * Renvoie 0 si l'item n'a pas d'améliorations.
 */
export function getItemUpgradeStatBonus(item = {}, statOrStore = '') {
  const meta = ITEM_STAT_BY_FULL[statOrStore] || ITEM_STAT_BY_STORE[statOrStore];
  if (!meta) return 0;
  const v = parseInt(item?.upgrades?.statBonus?.[meta.store]);
  return Number.isNaN(v) ? 0 : v;
}

/**
 * Bonus d'effet d'amélioration (anneaux : +N à l'effet flat).
 */
export function getItemEffectBonus(item = {}) {
  const v = parseInt(item?.upgrades?.effectBonus);
  return Number.isNaN(v) ? 0 : v;
}

/**
 * Texte d'effet d'un item avec amélioration appliquée.
 * Si l'effet contient un nombre (ex: "+1 vitesse", "1 CA"), il est incrémenté
 * de `effectBonus` directement (ex: "+2 vitesse" au palier 1, "+3 vitesse" au 2).
 * Sinon, fallback sur un suffixe descriptif "(renforcé +N)".
 */
export function getItemEffectText(item = {}) {
  const base  = item?.effet || '';
  const bonus = getItemEffectBonus(item);
  if (bonus <= 0) return base;

  // Tente d'incrémenter le premier nombre positif trouvé dans le texte.
  // Ex: "+1 vitesse"  → "+2 vitesse" au palier 1
  //     "1 vitesse"   → "2 vitesse"
  //     "Vitesse +1"  → "Vitesse +2"
  const m = base.match(/(?<![\d.])(\+?)(\d+)(?![\d.])/);
  if (m) {
    const sign  = m[1] || '';
    const value = parseInt(m[2]);
    const newVal = value + bonus;
    return base.replace(m[0], `${sign}${newVal}`);
  }

  // Fallback : pas de nombre trouvé, suffixe descriptif
  const suffix = base ? ` (renforcé +${bonus})` : `Effet renforcé +${bonus}`;
  return base + suffix;
}

/**
 * Lit un bonus de stat sur un item en acceptant les anciens alias boutique
 * (notamment `for` pour Force) et le format canonique d'équipement (`fo`).
 * Inclut automatiquement les améliorations issues de `item.upgrades.statBonus`.
 */
export function getItemStatBonus(item = {}, statOrStore = '') {
  return getItemBaseStatBonus(item, statOrStore) + getItemUpgradeStatBonus(item, statOrStore);
}

// ── Calculs de base ───────────────────────────────────────────────────────────

/**
 * Modificateur d'une stat pour un personnage (plafonné à score 22 → +6).
 */
export function getMod(c, key) {
  const base  = (c?.stats  || {})[key] || 8;
  const bonus = (c?.statsBonus || {})[key] || 0;
  const total = Math.min(22, base + bonus);
  return Math.floor((total - 10) / 2);
}

/**
 * Même logique que getMod mais sans objet personnage (score brut).
 */
export function getModFromScore(score) {
  return Math.floor((Math.min(22, score) - 10) / 2);
}

/**
 * Classe d'Armure effective du personnage.
 * Base selon type d'armure Torse + Dex + bonus équipements + bouclier.
 */
export function calcCA(c) {
  const equip = c?.equipement || {};
  const torse = equip['Torse']?.typeArmure || '';
  let caBase = 8;
  if (torse === 'Légère')        caBase = 10;
  else if (torse === 'Intermédiaire') caBase = 12;
  else if (torse === 'Lourde')   caBase = 14;

  const caEquip = Object.values(equip).reduce((s, it) => s + (it?.ca || 0), 0);
  // Bonus dérivé "caBonus" configurable par item (boucliers, amulettes, etc.)
  const caBonusDerived = computeEquipDerivedBonus(equip).caBonus;
  // Fallback rétrocompat : un bouclier sans caBonus défini garde +2
  const mainS  = equip['Main secondaire'];
  const stypeS = (mainS?.sousType || mainS?.nom || '').toLowerCase();
  const isShield = stypeS.includes('bouclier') || stypeS.includes('shield');
  const shieldHasOwnBonus = Number.isFinite(parseInt(mainS?.caBonus)) && parseInt(mainS.caBonus) !== 0;
  const bouclierFallback = (isShield && !shieldHasOwnBonus) ? 2 : 0;

  return caBase + getMod(c, 'dexterite') + caEquip + caBonusDerived + bouclierFallback;
}

/** Vitesse de déplacement (base + bonus items équipés). */
export function calcVitesse(c) {
  const base = 3 + getMod(c, 'force');
  const bonus = computeEquipDerivedBonus(c?.equipement).vitesseBonus;
  return Math.max(0, base + bonus);
}

/** Initiative (mod Dex + bonus items équipés). */
export function calcInitiative(c) {
  const base = getMod(c, 'dexterite');
  const bonus = computeEquipDerivedBonus(c?.equipement).initiativeBonus;
  return base + bonus;
}

/** Capacité maximale du deck de sorts. */
export function calcDeckMax(c) {
  const modIn  = getMod(c, 'intelligence');
  const niveau = c?.niveau || 1;
  const base   = 3 + Math.min(0, modIn) + Math.floor(Math.max(0, modIn) * Math.pow(Math.max(0, niveau - 1), 0.75));
  const equipBonus = computeEquipDerivedBonus(c?.equipement).deckBonus;
  return Math.max(0, base + equipBonus);
}

/**
 * PV maximum.
 * Bonus positif : +modCon par niveau gagné.
 * Malus négatif : appliqué une seule fois (pas multiplié par niveau).
 * Bonus items équipés : ajouté à la fin.
 */
export function calcPVMax(c) {
  const modCo = getMod(c, 'constitution');
  const niv   = c?.niveau || 1;
  const progression = modCo > 0 ? Math.floor(modCo * (niv - 1)) : modCo;
  const equipBonus = computeEquipDerivedBonus(c?.equipement).pvMaxBonus;
  return Math.max(1, (c?.pvBase || 10) + progression + equipBonus);
}

/**
 * PM maximum (même logique que PV avec Sagesse + bonus items équipés).
 */
export function calcPMMax(c) {
  const modSa = getMod(c, 'sagesse');
  const niv   = c?.niveau || 1;
  const progression = modSa > 0 ? Math.floor(modSa * (niv - 1)) : modSa;
  const equipBonus = computeEquipDerivedBonus(c?.equipement).pmMaxBonus;
  return Math.max(0, (c?.pmBase || 10) + progression + equipBonus);
}

/**
 * Or disponible du personnage : recettes − dépenses.
 * Supporte à la fois le format livre de compte (recettes/dépenses) et le champ `or` direct.
 */
export function calcOr(c) {
  const compte = c?.compte || { recettes: [], depenses: [] };
  const totalR = (compte.recettes || []).reduce((s, r) => s + (parseFloat(r?.montant) || 0), 0);
  const totalD = (compte.depenses || []).reduce((s, d) => s + (parseFloat(d?.montant) || 0), 0);
  if (totalR > 0 || totalD > 0) return Math.max(0, Math.round((totalR - totalD) * 100) / 100);
  // Fallback champ direct (ancien format)
  return Math.max(0, parseInt(c?.or) || 0);
}

/**
 * Palier XP requis pour le niveau donné.
 */
export function calcPalier(niveau) {
  return 100 * niveau * niveau;
}

/** Pourcentage borné 0–100. */
export function pct(cur, max) {
  return max > 0 ? Math.max(0, Math.min(100, Math.round((cur / max) * 100))) : 0;
}

// ── Maîtrise ─────────────────────────────────────────────────────────────────

/**
 * Bonus de maîtrise d'un personnage pour un item donné.
 * Cherche dans c.maitrises le type qui correspond à item.sousType / item.typeArme.
 */
export function getMaitriseBonus(c, item = {}) {
  if (!c?.maitrises?.length) return 0;

  const candidates = new Set();
  const add = v => { if (v && v.trim()) candidates.add(v.toLowerCase().trim()); };

  add(item.sousType);
  add(item.typeArme);

  if (!item.sousType && Number.isInteger(item.sourceInvIndex)) {
    const invItem = (c.inventaire || [])[item.sourceInvIndex];
    if (invItem) { add(invItem.sousType); add(invItem.typeArme); }
  }

  if (!candidates.size) return 0;

  let best = 0;
  for (const m of c.maitrises) {
    const mType = (m.typeArme || '').toLowerCase().trim();
    if (!mType) continue;
    for (const cand of candidates) {
      if (cand === mType || cand.includes(mType) || mType.includes(cand)) {
        best = Math.max(best, parseInt(m.niveau) || 0);
        break;
      }
    }
  }
  return best;
}

/**
 * Retourne les bonus de stats conférés par les équipements.
 */
export function computeEquipStatsBonus(equip = {}) {
  const bonus = { force: 0, dexterite: 0, intelligence: 0, sagesse: 0, constitution: 0, charisme: 0 };
  Object.values(equip).forEach(it => {
    if (!it) return;
    ITEM_STAT_META.forEach(meta => {
      bonus[meta.full] += getItemStatBonus(it, meta.full);
    });
  });
  return bonus;
}

/**
 * Collecte les entrées de bonus de stat d'un item (format boutique).
 */
export function collectItemBonusEntries(item = {}) {
  return ITEM_STAT_META
    .map(s => ({ meta: s, val: getItemStatBonus(item, s.full) }))
    .filter(({ val }) => val !== 0);
}

/**
 * Formate les bonus de stats d'un item en texte court ("+2 For +1 Dex").
 */
export function formatItemBonusText(item = {}) {
  return collectItemBonusEntries(item)
    .map(({ meta, val }) => `${val > 0 ? '+' : ''}${val} ${meta.short}`)
    .join(' ');
}

// ═══════════════════════════════════════════════════════════════════
// BONUS DÉRIVÉS — PV/PM max, Vitesse, Initiative, Compétences de dés
// ═══════════════════════════════════════════════════════════════════
// Chaque item peut définir :
//   - pvMaxBonus, pmMaxBonus, vitesseBonus, initiativeBonus  (nombres)
//   - skillBonuses: { "Intimidation": 1, "Perception": 2, ... }
// Ces bonus s'ajoutent au calcul de base quand l'item est équipé.

const DERIVED_BONUS_KEYS = ['pvMaxBonus', 'pmMaxBonus', 'vitesseBonus', 'initiativeBonus', 'caBonus', 'deckBonus'];

/** Lit le palier d'amélioration "effet" appliqué à l'item (Artisan). */
function _effectUpgrade(it) {
  const v = parseInt(it?.upgrades?.effectBonus);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Ajoute le palier d'amélioration à une valeur de bonus (positive uniquement). */
function _bumpBonus(val, upgrade) {
  if (!Number.isFinite(val) || val <= 0 || upgrade <= 0) return val;
  return val + upgrade;
}

/** Agrège les bonus dérivés de tous les items équipés (avec amélioration Artisan). */
export function computeEquipDerivedBonus(equip = {}) {
  const out = { pvMaxBonus: 0, pmMaxBonus: 0, vitesseBonus: 0, initiativeBonus: 0, caBonus: 0, deckBonus: 0 };
  Object.values(equip || {}).forEach(it => {
    if (!it) return;
    const up = _effectUpgrade(it);
    DERIVED_BONUS_KEYS.forEach(k => {
      const v = parseInt(it[k]);
      if (Number.isFinite(v)) out[k] += _bumpBonus(v, up);
    });
  });
  return out;
}

/** Bonus total sur une compétence de dés (par nom) provenant des items équipés. */
export function computeEquipSkillBonus(equip = {}, skillName = '') {
  if (!skillName) return 0;
  let total = 0;
  Object.values(equip || {}).forEach(it => {
    if (!it?.skillBonuses) return;
    const v = parseInt(it.skillBonuses[skillName]);
    if (Number.isFinite(v)) total += _bumpBonus(v, _effectUpgrade(it));
  });
  return total;
}

/** Map complète des bonus de compétences agrégés depuis les items équipés. */
export function computeEquipAllSkillBonuses(equip = {}) {
  const out = {};
  Object.values(equip || {}).forEach(it => {
    if (!it?.skillBonuses) return;
    const up = _effectUpgrade(it);
    Object.entries(it.skillBonuses).forEach(([name, val]) => {
      const v = parseInt(val);
      if (!Number.isFinite(v) || v === 0) return;
      const bumped = _bumpBonus(v, up);
      out[name] = (out[name] || 0) + bumped;
    });
  });
  return out;
}

// ══════════════════════════════════════════════════════════════════
// TRI & PERSONNAGE PAR DÉFAUT
// Source unique de vérité pour ordonner les personnages partout
// dans l'app (char-switch, groupes, players, VTT, etc.).
//
// Règles :
//   1. Joueurs regroupés par pseudo (ordre alpha FR).
//   2. À l'intérieur d'un joueur : personnage `isDefault=true` en tête,
//      puis ordre alpha sur le nom.
//   3. Tiebreak final : id (stable).
//
// Le champ `isDefault` est stocké directement sur le doc personnage
// (boolean). Un seul personnage par joueur peut l'avoir à true ;
// setDefaultCharacter() s'occupe de désactiver les autres.
// ══════════════════════════════════════════════════════════════════
export function sortCharactersForDisplay(chars = []) {
  return [...(chars || [])].sort((a, b) => {
    const pa = (a?.ownerPseudo || '').toLowerCase();
    const pb = (b?.ownerPseudo || '').toLowerCase();
    if (pa !== pb) {
      if (!pa) return 1;
      if (!pb) return -1;
      return pa.localeCompare(pb, 'fr');
    }
    // Même joueur : default en premier
    const da = a?.isDefault ? 0 : 1;
    const db = b?.isDefault ? 0 : 1;
    if (da !== db) return da - db;
    // Puis nom alpha
    const na = (a?.nom || '').toLowerCase();
    const nb = (b?.nom || '').toLowerCase();
    if (na !== nb) return na.localeCompare(nb, 'fr');
    return (a?.id || '').localeCompare(b?.id || '');
  });
}

/** Retourne le personnage par défaut d'un joueur, ou son premier sinon. */
export function getDefaultCharForUser(chars = [], uid = '') {
  if (!uid) return null;
  const mine = (chars || []).filter(c => c?.uid === uid);
  if (!mine.length) return null;
  return mine.find(c => c?.isDefault) || sortCharactersForDisplay(mine)[0];
}

// ── Exposition globale (pour les appels depuis HTML inline) ───────────────────
Object.assign(window, { getMod, calcCA, calcVitesse, calcInitiative, calcDeckMax, calcPVMax, calcPMMax, calcOr, calcPalier, pct, computeEquipDerivedBonus, computeEquipSkillBonus, computeEquipAllSkillBonuses, sortCharactersForDisplay, getDefaultCharForUser });
