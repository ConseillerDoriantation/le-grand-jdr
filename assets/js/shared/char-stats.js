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
  { full: 'force',        store: 'fo',  short: 'Fo',  label: 'Force' },
  { full: 'dexterite',    store: 'dex', short: 'Dex', label: 'Dextérité' },
  { full: 'intelligence', store: 'in',  short: 'Int', label: 'Intelligence' },
  { full: 'sagesse',      store: 'sa',  short: 'Sag', label: 'Sagesse' },
  { full: 'constitution', store: 'co',  short: 'Con', label: 'Constitution' },
  { full: 'charisme',     store: 'ch',  short: 'Cha', label: 'Charisme' },
];

export const ITEM_STAT_BY_FULL  = Object.fromEntries(ITEM_STAT_META.map(s => [s.full,  s]));
export const ITEM_STAT_BY_STORE = Object.fromEntries(ITEM_STAT_META.map(s => [s.store, s]));

/** Retourne le label court d'une stat (ex: 'dexterite' → 'Dex'). */
export function statShort(key) {
  return ITEM_STAT_BY_FULL[key]?.short || '';
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

  const mainS  = equip['Main secondaire'];
  const stypeS = (mainS?.sousType || mainS?.nom || '').toLowerCase();
  const bouclierBonus = (stypeS.includes('bouclier') || stypeS.includes('shield')) ? 2 : 0;

  return caBase + getMod(c, 'dexterite') + caEquip + bouclierBonus;
}

/** Vitesse de déplacement. */
export function calcVitesse(c) {
  return 3 + getMod(c, 'force');
}

/** Capacité maximale du deck de sorts. */
export function calcDeckMax(c) {
  const modIn  = getMod(c, 'intelligence');
  const niveau = c?.niveau || 1;
  return 3 + Math.min(0, modIn) + Math.floor(Math.max(0, modIn) * Math.pow(Math.max(0, niveau - 1), 0.75));
}

/**
 * PV maximum.
 * Bonus positif : +modCon par niveau gagné.
 * Malus négatif : appliqué une seule fois (pas multiplié par niveau).
 */
export function calcPVMax(c) {
  const modCo = getMod(c, 'constitution');
  const niv   = c?.niveau || 1;
  const progression = modCo > 0 ? Math.floor(modCo * (niv - 1)) : modCo;
  return Math.max(1, (c?.pvBase || 10) + progression);
}

/**
 * PM maximum (même logique que PV avec Sagesse).
 */
export function calcPMMax(c) {
  const modSa = getMod(c, 'sagesse');
  const niv   = c?.niveau || 1;
  const progression = modSa > 0 ? Math.floor(modSa * (niv - 1)) : modSa;
  return Math.max(0, (c?.pmBase || 10) + progression);
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
  const MAP = { fo: 'force', dex: 'dexterite', in: 'intelligence', sa: 'sagesse', co: 'constitution', ch: 'charisme' };
  Object.values(equip).forEach(it => {
    if (!it) return;
    Object.entries(MAP).forEach(([store, full]) => {
      bonus[full] += parseInt(it[store]) || 0;
    });
  });
  return bonus;
}

/**
 * Collecte les entrées de bonus de stat d'un item (format boutique).
 */
export function collectItemBonusEntries(item = {}) {
  return ITEM_STAT_META
    .map(s => ({ meta: s, val: parseInt(item[s.store]) || 0 }))
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

// ── Exposition globale (pour les appels depuis HTML inline) ───────────────────
Object.assign(window, { getMod, calcCA, calcVitesse, calcDeckMax, calcPVMax, calcPMMax, calcOr, calcPalier, pct });
